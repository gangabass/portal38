import http from 'node:http';
import {randomUUID,timingSafeEqual,createHash} from 'node:crypto';
import webpush from 'web-push';
import {Store} from './store.mjs';
import {PortalAccount} from './adapter.mjs';
import {BookingError,bookingFailure,matchesBookedSlot} from './booking-state.mjs';
import {publicAppointment} from './parsers.mjs';
import {rulesToPause,isBookedAppointment} from './cancellation.mjs';
import {validateRule,conflicts,runRule,selectSlots} from './domain.mjs';
const env=process.env,store=new Store(env.DATA_DIR||'./data',env.ENCRYPTION_KEY);
if(!env.FAMILY_ACCESS_KEY||env.FAMILY_ACCESS_KEY.length<24)throw Error('Configure FAMILY_ACCESS_KEY (at least 24 characters)');
const origins=(env.ALLOWED_ORIGINS||'').split(',').filter(Boolean),locks=new Map();
const pushEnabled=Boolean(env.VAPID_PUBLIC_KEY&&env.VAPID_PRIVATE_KEY&&env.VAPID_SUBJECT);
if(pushEnabled)webpush.setVapidDetails(env.VAPID_SUBJECT,env.VAPID_PUBLIC_KEY,env.VAPID_PRIVATE_KEY);
const accountPublic=a=>({id:a.id,label:a.label});
const unresolved=r=>store.list('rules').some(other=>other.id!==r.id&&other.accountId===r.accountId&&other.personId===r.personId&&other.specialtyId===r.specialtyId&&['booking','needs_review'].includes(other.status));
async function withAccount(id,fn){
  const previous=locks.get(id)||Promise.resolve();let release;const gate=new Promise(r=>release=r);const pending=previous.catch(()=>{}).then(()=>gate);locks.set(id,pending);await previous.catch(()=>{});
  try{const a=store.get('accounts',id);if(!a)throw Error('Аккаунт не найден');const portal=new PortalAccount(a.credentials,a.cookies);try{return await fn(portal,a);}finally{if(store.get('accounts',id))store.put('accounts',id,{...a,cookies:portal.cookies});}}
  finally{release();if(locks.get(id)===pending)locks.delete(id);}
}
function notify(message){store.put('outbox',message.tag,{id:message.tag,message,createdAt:Date.now()});}
async function sendPush(){
  if(!pushEnabled)return;
  for(const item of store.list('outbox')){
    if(Date.now()-item.createdAt>3600000){store.delete('outbox',item.id);continue;}
    const delivered=item.delivered||[];let retry=false;
    for(const s of store.list('push')){
      if(delivered.includes(s.id))continue;
      try{await webpush.sendNotification(s.subscription,JSON.stringify({...item.message,url:env.APP_URL||'https://gangabass.github.io/portal38/'}),{TTL:300,timeout:15000});delivered.push(s.id);}
      catch(e){if([404,410].includes(e.statusCode))store.delete('push',s.id);else retry=true;}
    }
    if(!retry||Date.now()-item.createdAt>3600000)store.delete('outbox',item.id);else store.put('outbox',item.id,{...item,delivered});
  }
}
let ticking=false;
async function tick(){if(ticking)return;ticking=true;
  try{for(const rule of store.list('rules').filter(r=>['active','error'].includes(r.status))){
    await withAccount(rule.accountId,async portal=>{
      const fresh=store.get('rules',rule.id);if(!fresh||!['active','error'].includes(fresh.status))return;
      if(unresolved(fresh)){store.put('rules',fresh.id,{...fresh,status:'blocked',slots:[],message:'Другая попытка записи не подтверждена. Проверьте картотеку на портале.'});return;}
      try{await runRule(fresh,{portal,previousIds:(fresh.slots||[]).map(s=>s.id),save:r=>store.put('rules',r.id,r),notify});}
      catch{const current=store.get('rules',rule.id);if(current&&['active','error','booking'].includes(current.status))store.put('rules',rule.id,{...current,status:current.status==='booking'?'needs_review':'error',message:current.status==='booking'?'Проверьте картотеку на портале: результат записи не подтверждён.':'Не удалось проверить портал. Повторим через минуту.',checkedAt:new Date().toISOString()});}
    }).catch(()=>{});
  }await sendPush();}finally{ticking=false;}}
for(const r of store.list('rules'))if(r.status==='booking')store.put('rules',r.id,{...r,status:'needs_review',message:'Сервер перезапущен во время записи. Проверьте картотеку на портале.'});
const timer=setInterval(()=>tick().catch(()=>console.error('Monitoring cycle failed')),60000);timer.unref();
const hash=s=>createHash('sha256').update(s).digest();
async function body(req){let chunks=[],size=0;for await(const c of req){size+=c.length;if(size>65536)throw Error('Слишком большой запрос');chunks.push(c);}return JSON.parse(Buffer.concat(chunks).toString()||'{}');}
const attempts=new Map();
const server=http.createServer(async(req,res)=>{
  const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin'};
  const origin=req.headers.origin;
  const send=(status,data)=>{res.writeHead(status,headers);res.end(JSON.stringify(data));};
  if(origin&&!origins.includes(origin))return send(403,{error:'Origin не разрешён'});
  if(origin)headers['Access-Control-Allow-Origin']=origin;
  if(req.method==='OPTIONS'){headers['Access-Control-Allow-Headers']='Authorization, Content-Type';headers['Access-Control-Allow-Methods']='GET, POST, DELETE, PATCH, OPTIONS';res.writeHead(204,headers);return res.end();}
  const url=new URL(req.url,'http://localhost'),path=url.pathname;
  if(path==='/api/health'&&req.method==='GET')return send(200,{ok:true,service:'portal38',bookingVerified:false});
  const key=(req.headers.authorization||'').replace(/^Bearer /,'');
  const ip=req.socket.remoteAddress,attempt=attempts.get(ip);
  if(attempt&&attempt.until>Date.now()&&attempt.count>=20)return send(429,{error:'Слишком много попыток. Подождите минуту.'});
  if(!timingSafeEqual(hash(key),hash(env.FAMILY_ACCESS_KEY))){if(attempts.size>1000)attempts.clear();attempts.set(ip,{until:Date.now()+60000,count:attempt&&attempt.until>Date.now()?attempt.count+1:1});return send(401,{error:'Неверный семейный ключ доступа'});}
  try{
    let m;
    if(path==='/api/accounts'&&req.method==='GET')return send(200,store.list('accounts').map(accountPublic));
    if(path==='/api/accounts'&&req.method==='POST'){
      const b=await body(req);if(![b.label,b.login,b.password].every(x=>typeof x==='string'&&x.trim()&&x.length<=300))throw Error('Введите название, логин и пароль');
      if(store.list('accounts').length>=5)throw Error('Достигнут лимит семейных аккаунтов');
      const portal=new PortalAccount({login:b.login,password:b.password});const people=await portal.people();const id=randomUUID();
      store.put('accounts',id,{id,label:b.label,credentials:{login:b.login,password:b.password},cookies:portal.cookies});return send(201,{id,label:b.label,people});
    }
    if((m=path.match(/^\/api\/accounts\/([\w-]+)$/))&&req.method==='DELETE')return await withAccount(m[1],async()=>{for(const r of store.list('rules').filter(r=>r.accountId===m[1]))store.delete('rules',r.id);store.delete('accounts',m[1]);return send(200,{ok:true});});
    if((m=path.match(/^\/api\/accounts\/([\w-]+)\/(people|specialties|doctors|appointments)$/))&&req.method==='GET')return await withAccount(m[1],async portal=>{
      const personId=url.searchParams.get('personId'),specialtyId=url.searchParams.get('specialtyId');
      if(m[2]!=='people'&&!/^\d+$/.test(personId||''))throw Error('Выберите человека');
      if(m[2]==='doctors'&&!/^\d+$/.test(specialtyId||''))throw Error('Выберите специальность');
      const data=await portal[m[2]](...(m[2]==='people'?[]:[personId,...(m[2]==='doctors'?[specialtyId]:[])]));
      return send(200,m[2]==='appointments'?data.map(publicAppointment):data);
    });
    if((m=path.match(/^\/api\/accounts\/([\w-]+)\/appointments\/([a-f0-9]{64})\/cancel$/))&&req.method==='POST'){
      const b=await body(req);if(!/^\d+$/.test(b.personId||'')||b.confirm!==true)throw Error('Выберите человека и подтвердите отмену записи.');
      const accountId=m[1],appointmentId=m[2];
      return await withAccount(accountId,async portal=>{
        const current=await portal.appointments(b.personId),appointment=current.find(a=>a.id===appointmentId);
        if(!appointment)return send(409,{error:'Запись уже отсутствует в активных записях. Обновите список.'});
        if(!appointment.canCancel)return send(409,{error:'Отмена этой записи недоступна на портале.'});
        const paused=rulesToPause(store.list('rules'),accountId,appointment);
        for(const rule of paused){store.put('rules',rule.id,rule);store.delete('outbox','rule-'+rule.id);}
        try{
          const result=await portal.cancelAppointment(b.personId,appointmentId);
          for(const rule of store.list('rules'))if(isBookedAppointment(rule,accountId,appointment))store.put('rules',rule.id,{...rule,status:'cancelled',appointment:{...rule.appointment,status:'cancelled'},message:'Запись отменена на портале.'});
          return send(200,{ok:true,appointments:result.appointments.map(publicAppointment),pausedRules:paused.length});
        }catch{return send(409,{error:'Не удалось подтвердить отмену. Обновите список записей перед новой попыткой. Связанные отслеживания поставлены на паузу.'});}
      });
    }
    if(path==='/api/rules'&&req.method==='GET')return send(200,store.list('rules'));
    if(path==='/api/rules'&&req.method==='POST'){
      const b=await body(req);validateRule(b);if(unresolved(b))throw Error('Сначала проверьте результат предыдущей попытки записи в картотеке.');
      if(store.list('rules').length>=20)throw Error('Достигнут лимит правил');
      return await withAccount(b.accountId,async portal=>{
        const people=await portal.people(),specialties=await portal.specialties(b.personId),doctors=await portal.doctors(b.personId,b.specialtyId);
        const clinic=doctors.find(d=>d.clinic.id===b.clinicId)?.clinic;
        if(!clinic||b.doctorIds.some(id=>!doctors.some(d=>d.id===id&&d.clinic.id===b.clinicId)))throw Error('Проверьте поликлинику и врачей');
        const current=await portal.appointments(b.personId);
        if(conflicts(b,current).length) return send(409,{error:'Уже есть активная запись по этой специальности либо запись, требующая проверки. Две записи невозможны.',appointments:current});
        const r={id:randomUUID(),accountId:b.accountId,personId:b.personId,clinicId:b.clinicId,specialtyId:b.specialtyId,doctorIds:b.doctorIds,weekdays:b.weekdays,dateFrom:b.dateFrom,dateTo:b.dateTo,timeFrom:b.timeFrom,timeTo:b.timeTo,autoBook:b.autoBook,status:'active',personName:people.find(p=>p.id===b.personId)?.name,specialtyName:specialties.find(s=>s.id===b.specialtyId)?.name,clinic,doctorNames:doctors.filter(d=>b.doctorIds.includes(d.id)).map(d=>d.name),slots:[],createdAt:new Date().toISOString()};
        store.put('rules',r.id,r);send(201,r);
      });
    }
    if((m=path.match(/^\/api\/rules\/([\w-]+)(?:\/(book|recheck))?$/))){
      const r=store.get('rules',m[1]);if(!r)return send(404,{error:'Правило не найдено'});
      return await withAccount(r.accountId,async portal=>{
        const latest=store.get('rules',r.id);if(!latest)return send(404,{error:'Правило удалено'});
        if(!m[2]&&req.method==='DELETE'){store.delete('rules',r.id);return send(200,{ok:true});}
        if(!m[2]&&req.method==='PATCH'){
          const b=await body(req);if(!['active','paused'].includes(b.status))throw Error('Некорректное состояние');
          if(['booked','booking','needs_review'].includes(latest.status))throw Error('Сначала проверьте результат на портале. Для новой попытки создайте новое правило.');
          store.put('rules',r.id,{...latest,status:b.status,message:'',slots:[]});return send(200,{ok:true});
        }
        if(m[2]==='recheck'&&req.method==='POST'){
          if(!['needs_review','blocked'].includes(latest.status))throw Error('Правило не требует проверки результата.');
          const b=await body(req),appointments=await portal.appointments(latest.personId);
          const candidates=[...(latest.slots||[]),...(latest.lastBookingAttempt?.slotId?[{id:latest.lastBookingAttempt.slotId,personId:latest.personId,doctorId:latest.lastBookingAttempt.doctorId,startsAt:latest.lastBookingAttempt.startsAt}]:[])];
          const matched=appointments.find(a=>candidates.some(slot=>matchesBookedSlot(a,slot)));
          if(matched){const slot=candidates.find(s=>matchesBookedSlot(matched,s));store.put('rules',latest.id,{...latest,status:'booked',slots:[],appointment:{...slot,doctorName:matched.doctorName,status:'active',portalAppointmentId:matched.id},message:'Запись подтверждена по картотеке.'});return send(200,{ok:true,status:'booked'});}
          if(conflicts(latest,appointments).length)return send(409,{error:'В картотеке есть активная запись по этой специальности. Отслеживание не возобновлено.'});
          const lastAttempt=Date.parse(latest.lastBookingAttempt?.at||latest.checkedAt||'');
          if(Number.isFinite(lastAttempt)&&Date.now()-lastAttempt<120000)return send(409,{error:'Предыдущая попытка была недавно. Подождите две минуты и проверьте результат снова.'});
          if(b.resume!==true)return send(200,{ok:true,status:latest.status,canResume:true});
          store.put('rules',latest.id,{...latest,status:'active',slots:[],message:'В картотеке записи нет. Отслеживание возобновлено.',checkedAt:new Date().toISOString()});return send(200,{ok:true,status:'active'});
        }
        if(m[2]==='book'&&req.method==='POST'){
          if(unresolved(latest))throw Error('Сначала проверьте результат предыдущей попытки записи в картотеке.');
          if(!['active','error'].includes(latest.status)||latest.autoBook)throw Error('Ручная запись для этого правила недоступна');
          const b=await body(req),slot=selectSlots(latest,latest.slots||[]).find(s=>s.id===b.slotId);if(!slot)throw Error('Талон недоступен. Обновите список.');
          let submitted=false;
          try{
            const result=await portal.book(latest,slot,{beforeSubmit:async()=>{store.put('rules',r.id,{...latest,status:'booking',message:'Проверяем результат записи…',lastBookingAttempt:{stage:'submit',outcome:'pending',slotId:slot.id,doctorId:slot.doctorId,startsAt:slot.startsAt,at:new Date().toISOString()}});submitted=true;}});
            if(!result.confirmed)throw new BookingError('confirmation_missing','unknown','confirm','Результат не подтверждён');
            store.put('rules',r.id,{...latest,status:'booked',slots:[],appointment:result.appointment,message:'Запись подтверждена'});return send(200,{ok:true});
          }catch(error){const failure=bookingFailure({...latest,lastBookingAttempt:{slotId:slot.id,doctorId:slot.doctorId,startsAt:slot.startsAt}},error,{submitted});store.put('rules',r.id,failure);return send(409,{error:failure.message});}
        }
        return send(404,{error:'Маршрут не найден'});
      });
    }
    if(path==='/api/push/config'&&req.method==='GET')return send(200,{enabled:pushEnabled,publicKey:env.VAPID_PUBLIC_KEY||''});
    if(path==='/api/push/subscription'&&req.method==='POST'){
      if(!pushEnabled)throw Error('Push пока не настроен на сервере');
      const b=await body(req),s=b.subscription;let u;try{u=new URL(s?.endpoint);}catch{throw Error('Некорректная push-подписка');}
      if(u.protocol!=='https:'||u.port||u.username||u.password||!['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'].some(h=>u.hostname===h||u.hostname.endsWith('.'+h))||!s.keys?.p256dh||!s.keys?.auth)throw Error('Неподдерживаемая push-подписка');
      const id=createHash('sha256').update(s.endpoint).digest('hex');store.put('push',id,{id,subscription:s});return send(200,{id});
    }
    if(path==='/api/push/subscription'&&req.method==='DELETE'){const b=await body(req);store.delete('push',b.id||'');return send(200,{ok:true});}
    if(path==='/api/push/test'&&req.method==='POST'){notify({title:'Portal38',body:'Уведомления работают',tag:'test'});await sendPush();return send(200,{ok:true});}
    send(404,{error:'Маршрут не найден'});
  }catch(e){const message=/[А-Яа-яЁё]/.test(e.message)?e.message:'Не удалось выполнить запрос. Проверьте настройки сервера и доступность портала.';send(400,{error:message});}
});
server.listen(Number(env.PORT||3002),env.HOST||'127.0.0.1',()=>{console.log('Portal38 API listening',server.address().port);tick().catch(()=>console.error('Initial monitoring cycle failed'));});
process.on('SIGTERM',()=>{clearInterval(timer);server.close(()=>process.exit(0));});
