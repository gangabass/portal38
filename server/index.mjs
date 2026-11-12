import http from 'node:http';
import {randomUUID,timingSafeEqual,createHash} from 'node:crypto';
import webpush from 'web-push';
import {Store} from './store.mjs';
import {guardBookingAccess} from './access-guard.mjs';
import {createAccessTokens} from './access-tokens.mjs';
import {createSessions,ownedPushSubscriptions} from './sessions.mjs';
import {PortalAccount} from './adapter.mjs';
import {BookingError,bookingFailure,matchesBookedSlot} from './booking-state.mjs';
import {publicAppointment} from './parsers.mjs';
import {rulesToPause,isBookedAppointment} from './cancellation.mjs';
import {validateRule,conflicts,runRule,selectSlots} from './domain.mjs';
const env=process.env,store=new Store(env.DATA_DIR||'./data',env.ENCRYPTION_KEY);
if(!env.FAMILY_ACCESS_KEY||env.FAMILY_ACCESS_KEY.length<24)throw Error('Configure FAMILY_ACCESS_KEY (at least 24 characters)');
const accessTokens=createAccessTokens(store,env.FAMILY_ACCESS_KEY);
const origins=(env.ALLOWED_ORIGINS||'').split(',').filter(Boolean),locks=new Map();
const pushEnabled=Boolean(env.VAPID_PUBLIC_KEY&&env.VAPID_PRIVATE_KEY&&env.VAPID_SUBJECT);
if(pushEnabled)webpush.setVapidDetails(env.VAPID_SUBJECT,env.VAPID_PUBLIC_KEY,env.VAPID_PRIVATE_KEY);
const sessions=createSessions(store,async credentials=>{const portal=new PortalAccount(credentials);await portal.people();return {cookies:portal.cookies};},accessTokens);
const accountPublic=a=>({id:a.id,label:a.label});
const unresolved=r=>store.list('rules').some(other=>other.id!==r.id&&other.accountId===r.accountId&&other.personId===r.personId&&other.specialtyId===r.specialtyId&&['booking','needs_review'].includes(other.status));
async function withAccount(id,fn){
  const previous=locks.get(id)||Promise.resolve();let release;const gate=new Promise(r=>release=r);const pending=previous.catch(()=>{}).then(()=>gate);locks.set(id,pending);await previous.catch(()=>{});
  try{const a=store.get('accounts',id);if(!a)throw Error('Аккаунт не найден');const portal=guardBookingAccess(new PortalAccount(a.credentials,a.cookies),accessTokens);try{return await fn(portal,a);}finally{const current=store.get('accounts',id);if(current)store.put('accounts',id,{...current,cookies:portal.cookies});}}
  finally{release();if(locks.get(id)===pending)locks.delete(id);}
}
function notify(message,accountId,accessTokenId){if(!accountId||!accessTokens.active(accessTokenId))return;store.put('outbox',message.tag,{id:message.tag,accountId,accessTokenId,message,createdAt:Date.now()});}
async function sendPush(){
  if(!pushEnabled)return;
  for(const item of store.list('outbox')){
    if(!item.accountId||!accessTokens.active(item.accessTokenId)||Date.now()-item.createdAt>3600000){store.delete('outbox',item.id);continue;}
    const delivered=item.delivered||[];let retry=false;
    for(const s of ownedPushSubscriptions(store,item.accountId)){
      if(delivered.includes(s.id)||s.accessTokenId!==item.accessTokenId||!accessTokens.active(s.accessTokenId))continue;
      try{await webpush.sendNotification(s.subscription,JSON.stringify({...item.message,url:env.APP_URL||'https://gangabass.github.io/portal38/'}),{TTL:300,timeout:15000});delivered.push(s.id);}
      catch(e){if([404,410].includes(e.statusCode))store.delete('push',s.id);else retry=true;}
    }
    if(!retry||Date.now()-item.createdAt>3600000)store.delete('outbox',item.id);else store.put('outbox',item.id,{...item,delivered});
  }
}
let ticking=false;
async function tick(){if(ticking)return;ticking=true;
  try{
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Irkutsk',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());for(const r of store.list('rules'))if(['active','error'].includes(r.status)&&r.dateTo&&r.dateTo<today)store.put('rules',r.id,{...r,status:'expired',slots:[],message:'Период поиска завершён.'});
    const pendingGroups=new Map();for(const p of store.list('bookingUsage').filter(p=>p.status==='pending'&&Date.now()-p.at>=120000&&accessTokens.active(p.accessTokenId))){const key=p.accountId+':'+p.personId;const group=pendingGroups.get(key)||{accountId:p.accountId,personId:p.personId,ruleIds:new Set()};group.ruleIds.add(p.ruleId);pendingGroups.set(key,group);}
    for(const group of pendingGroups.values())await withAccount(group.accountId,async portal=>{const appointments=await portal.appointments(group.personId);for(const id of group.ruleIds)accessTokens.reconcile({id},appointments);}).catch(()=>{});
    for(const rule of store.list('rules').filter(r=>['active','error'].includes(r.status)&&!accessTokens.ruleIssue(r))){
    await withAccount(rule.accountId,async portal=>{
      const fresh=store.get('rules',rule.id);if(!fresh||!['active','error'].includes(fresh.status)||accessTokens.ruleIssue(fresh))return;
      if(unresolved(fresh)){store.put('rules',fresh.id,{...fresh,status:'blocked',slots:[],message:'Другая попытка записи не подтверждена. Проверьте картотеку на портале.'});return;}
      try{await runRule(fresh,{portal,previousIds:(fresh.slots||[]).map(s=>s.id),save:r=>store.put('rules',r.id,r),notify:message=>notify(message,fresh.accountId,fresh.accessTokenId)});}
      catch{const current=store.get('rules',rule.id);if(current&&['active','error','booking'].includes(current.status))store.put('rules',rule.id,{...current,status:current.status==='booking'?'needs_review':'error',message:current.status==='booking'?'Проверьте картотеку на портале: результат записи не подтверждён.':'Не удалось проверить портал. Повторим через минуту.',checkedAt:new Date().toISOString()});}
    }).catch(()=>{});
  }await sendPush();}finally{ticking=false;}}
for(const r of store.list('rules'))if(r.status==='booking')store.put('rules',r.id,{...r,status:'needs_review',message:'Сервер перезапущен во время записи. Проверьте картотеку на портале.'});
const timer=setInterval(()=>tick().catch(()=>console.error('Monitoring cycle failed')),60000);timer.unref();
function assertAccess(id){if(!accessTokens.active(id))throw new BookingError('access_disabled','not_sent','access','Токен доступа приостановлен или удалён.');}
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
  if((path.startsWith('/api/admin')||path==='/api/session')&&attempt&&attempt.until>Date.now()&&attempt.count>=20)return send(429,{error:'Слишком много попыток. Подождите минуту.'});
  const rejectLogin=()=>{if(attempts.size>1000)attempts.clear();attempts.set(ip,{until:Date.now()+60000,count:attempt&&attempt.until>Date.now()?attempt.count+1:1});};
  if(path==='/api/admin'||path.startsWith('/api/admin/')){
    if(!env.ADMIN_ACCESS_KEY||env.ADMIN_ACCESS_KEY.length<24)return send(503,{error:'Администратор не настроен.'});
    if(!timingSafeEqual(hash(key),hash(env.ADMIN_ACCESS_KEY))){rejectLogin();return send(401,{error:'Неверный ключ администратора.'});}
    try{
      if(path==='/api/admin/tokens'&&req.method==='GET')return send(200,{tokens:accessTokens.list(),types:accessTokens.types});
      if(path==='/api/admin/tokens'&&req.method==='POST')return send(201,accessTokens.create(await body(req)));
      const target=path.match(/^\/api\/admin\/tokens\/([\w-]+)$/);
      if(target&&req.method==='PATCH')return send(200,accessTokens.update(target[1],await body(req)));
      if(target&&req.method==='DELETE'){accessTokens.remove(target[1]);return send(200,{ok:true});}
      return send(404,{error:'Маршрут не найден'});
    }catch(e){return send(400,{error:e.message});}
  }
  if(path==='/api/session'&&req.method==='POST'){
    const grant=accessTokens.find(key);
    if(!grant){rejectLogin();return send(401,{error:'Неверный токен доступа к сервису'});}
    try{const b=await body(req);const result=await sessions.login(b.login,b.password,grant.id);attempts.delete(ip);return send(201,result);}
    catch(e){rejectLogin();return send(401,{error:/^(Этот токен уже привязан|Аккаунт уже привязан|Токен доступа)/.test(e.message)?e.message:'Не удалось войти на портал. Проверьте логин и пароль либо повторите позже.'});}
  }
  const session=sessions.resolve(key);
  if(!session)return send(401,{error:'Войдите с личным логином и паролем портала.'});
  const accountId=session.accountId;
  // Enforce ownership before dispatching any read or mutation, including guessed URLs.
  const targetAccount=path.match(/^\/api\/accounts\/([\w-]+)/)?.[1];
  if(targetAccount&&targetAccount!==accountId)return send(404,{error:'Аккаунт не найден'});
  const targetRule=path.match(/^\/api\/rules\/([\w-]+)/)?.[1];
  if(targetRule&&store.get('rules',targetRule)?.accountId!==accountId)return send(404,{error:'Правило не найдено'});
  try{
    let m;
    if(path==='/api/session'&&req.method==='DELETE'){sessions.revoke(key);return send(200,{ok:true});}
    if(path==='/api/access'&&req.method==='GET'){const t=accessTokens.list().find(t=>t.id===session.accessTokenId);return send(200,{name:t.name,type:t.type,typeName:accessTokens.types.find(v=>v.id===t.type).name,limits:t.limits,usage:t.usage});}
    if(path==='/api/accounts'&&req.method==='GET')return send(200,[accountPublic(store.get('accounts',accountId))]);
    if(path==='/api/accounts'&&req.method==='POST')return send(405,{error:'Для другого аккаунта выйдите и войдите с его логином портала.'});
    if((m=path.match(/^\/api\/accounts\/([\w-]+)$/))&&req.method==='DELETE')return await withAccount(m[1],async()=>{for(const r of store.list('rules').filter(r=>r.accountId===m[1]))store.delete('rules',r.id);for(const kind of ['sessions','push','outbox'])for(const item of store.list(kind))if(item.accountId===m[1])store.delete(kind,item.id);store.delete('accounts',m[1]);return send(200,{ok:true});});
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
    if(path==='/api/rules'&&req.method==='GET')return send(200,store.list('rules').filter(r=>r.accountId===accountId).map(r=>({...r,accessPaused:!accessTokens.active(r.accessTokenId),quotaMessage:['active','error','booking','needs_review'].includes(r.status)?accessTokens.ruleIssue(r):''})));
    if(path==='/api/rules'&&req.method==='POST'){
      const b=await body(req);if(b.accountId!==accountId)return send(404,{error:'Аккаунт не найден'});validateRule(b);accessTokens.assertTrackerSlot(session.accessTokenId);if(unresolved(b))throw Error('Сначала проверьте результат предыдущей попытки записи в картотеке.');
      if(store.list('rules').filter(r=>r.accountId===accountId).length>=20)throw Error('Достигнут лимит правил');
      return await withAccount(b.accountId,async portal=>{
        const people=await portal.people(),specialties=await portal.specialties(b.personId),doctors=await portal.doctors(b.personId,b.specialtyId);
        const clinic=doctors.find(d=>d.clinic.id===b.clinicId)?.clinic;
        if(!clinic||b.doctorIds.some(id=>!doctors.some(d=>d.id===id&&d.clinic.id===b.clinicId)))throw Error('Проверьте поликлинику и врачей');
        const current=await portal.appointments(b.personId);
        if(conflicts(b,current).length) return send(409,{error:'Уже есть активная запись по этой специальности либо запись, требующая проверки. Две записи невозможны.',appointments:current});
        const r={id:randomUUID(),accessTokenId:session.accessTokenId,accountId:b.accountId,personId:b.personId,clinicId:b.clinicId,specialtyId:b.specialtyId,doctorIds:b.doctorIds,weekdays:b.weekdays,dateFrom:b.dateFrom,dateTo:b.dateTo,timeFrom:b.timeFrom,timeTo:b.timeTo,autoBook:b.autoBook,status:'active',personName:people.find(p=>p.id===b.personId)?.name,specialtyName:specialties.find(s=>s.id===b.specialtyId)?.name,clinic,doctorNames:doctors.filter(d=>b.doctorIds.includes(d.id)).map(d=>d.name),slots:[],createdAt:new Date().toISOString()};
        accessTokens.assertTrackerSlot(session.accessTokenId);store.put('rules',r.id,r);send(201,r);
      });
    }
    if((m=path.match(/^\/api\/rules\/([\w-]+)(?:\/(book|recheck))?$/))){
      const r=store.get('rules',m[1]);if(!r)return send(404,{error:'Правило не найдено'});
      return await withAccount(r.accountId,async portal=>{
        const latest=store.get('rules',r.id);if(!latest)return send(404,{error:'Правило удалено'});
        if(!m[2]&&req.method==='DELETE'){store.delete('rules',r.id);return send(200,{ok:true});}
        if((m[2]||req.method==='PATCH')&&!accessTokens.active(latest.accessTokenId))return send(403,{error:'Токен этого отслеживания приостановлен или удалён.'});
        if(!m[2]&&req.method==='PATCH'){
          const b=await body(req);if(!['active','paused'].includes(b.status))throw Error('Некорректное состояние');
          if(['booked','booking','needs_review'].includes(latest.status))throw Error('Сначала проверьте результат на портале. Для новой попытки создайте новое правило.');
          if(b.status==='active')accessTokens.assertTrackerSlot(latest.accessTokenId,latest.id);
          store.put('rules',r.id,{...latest,status:b.status,message:'',slots:[]});return send(200,{ok:true});
        }
        if(m[2]==='recheck'&&req.method==='POST'){
          if(!['needs_review','blocked'].includes(latest.status))throw Error('Правило не требует проверки результата.');
          const b=await body(req),appointments=await portal.appointments(latest.personId);
          accessTokens.reconcile(latest,appointments);
          const candidates=[...(latest.slots||[]),...(latest.lastBookingAttempt?.slotId?[{id:latest.lastBookingAttempt.slotId,personId:latest.personId,doctorId:latest.lastBookingAttempt.doctorId,startsAt:latest.lastBookingAttempt.startsAt}]:[])];
          const matched=appointments.find(a=>candidates.some(slot=>matchesBookedSlot(a,slot)));
          if(matched){const slot=candidates.find(s=>matchesBookedSlot(matched,s));store.put('rules',latest.id,{...latest,status:'booked',slots:[],appointment:{...slot,doctorName:matched.doctorName,status:'active',portalAppointmentId:matched.id},message:'Запись подтверждена по картотеке.'});return send(200,{ok:true,status:'booked'});}
          if(conflicts(latest,appointments).length)return send(409,{error:'В картотеке есть активная запись по этой специальности. Отслеживание не возобновлено.'});
          const lastAttempt=Date.parse(latest.lastBookingAttempt?.at||latest.checkedAt||'');
          if(Number.isFinite(lastAttempt)&&Date.now()-lastAttempt<120000)return send(409,{error:'Предыдущая попытка была недавно. Подождите две минуты и проверьте результат снова.'});
          if(b.resume!==true)return send(200,{ok:true,status:latest.status,canResume:true});
          accessTokens.assertTrackerSlot(latest.accessTokenId,latest.id);store.put('rules',latest.id,{...latest,status:'active',slots:[],message:'В картотеке записи нет. Отслеживание возобновлено.',checkedAt:new Date().toISOString()});return send(200,{ok:true,status:'active'});
        }
        if(m[2]==='book'&&req.method==='POST'){
          if(unresolved(latest))throw Error('Сначала проверьте результат предыдущей попытки записи в картотеке.');
          if(!['active','error'].includes(latest.status)||latest.autoBook)throw Error('Ручная запись для этого правила недоступна');
          const b=await body(req),slot=selectSlots(latest,latest.slots||[]).find(s=>s.id===b.slotId);if(!slot)throw Error('Талон недоступен. Обновите список.');
          let submitted=false;
          try{
            const result=await portal.book(latest,slot,{beforeSubmit:async()=>{assertAccess(latest.accessTokenId);store.put('rules',r.id,{...latest,status:'booking',message:'Проверяем результат записи…',lastBookingAttempt:{stage:'submit',outcome:'pending',slotId:slot.id,doctorId:slot.doctorId,startsAt:slot.startsAt,at:new Date().toISOString()}});submitted=true;}});
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
      const id=createHash('sha256').update(s.endpoint).digest('hex');store.put('push',id,{id,accountId,accessTokenId:session.accessTokenId,subscription:s});return send(200,{id});
    }
    if(path==='/api/push/subscription'&&req.method==='DELETE'){const b=await body(req);if(store.get('push',b.id||'')?.accountId===accountId)store.delete('push',b.id);return send(200,{ok:true});}
    if(path==='/api/push/test'&&req.method==='POST'){notify({title:'Portal38',body:'Уведомления работают',tag:'test-'+accountId},accountId,session.accessTokenId);await sendPush();return send(200,{ok:true});}
    send(404,{error:'Маршрут не найден'});
  }catch(e){const message=/[А-Яа-яЁё]/.test(e.message)?e.message:'Не удалось выполнить запрос. Проверьте настройки сервера и доступность портала.';send(400,{error:message});}
});
server.listen(Number(env.PORT||3002),env.HOST||'127.0.0.1',()=>{console.log('Portal38 API listening',server.address().port);tick().catch(()=>console.error('Initial monitoring cycle failed'));});
process.on('SIGTERM',()=>{clearInterval(timer);server.close(()=>process.exit(0));});
