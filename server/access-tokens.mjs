import {randomBytes,randomUUID,createHash} from 'node:crypto';
export const tokenHash=value=>createHash('sha256').update(value).digest('hex');
export const tokenTypes=[{id:'standard',name:'Обычный',monthlyBookings:10,concurrentTrackers:2},{id:'premium',name:'Премиум',monthlyBookings:30,concurrentTrackers:5}];
export const trackingStatuses=['active','error','booking','needs_review'];
export function billingMonth(now=Date.now()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Irkutsk',year:'numeric',month:'2-digit'}).format(new Date(now));}
export function createAccessTokens(store,legacyKey){
 const plan=id=>tokenTypes.find(p=>p.id===store.get('accessTokens',id)?.type);
 const active=id=>store.get('accessTokens',id)?.status==='active';
 const tracked=id=>store.list('rules').filter(r=>r.accessTokenId===id&&trackingStatuses.includes(r.status)).sort((a,b)=>(a.createdAt||'').localeCompare(b.createdAt||'')||a.id.localeCompare(b.id));
 const usage=(id,now=Date.now())=>{const month=billingMonth(now),records=store.list('bookingUsage').filter(r=>r.accessTokenId===id&&r.month===month);return {month,bookings:records.filter(r=>r.status==='confirmed').length,pending:records.filter(r=>r.status==='pending').length,trackers:tracked(id).length};};
 const publicToken=t=>({id:t.id,name:t.name,type:t.type,status:t.status,hint:t.hint,createdAt:t.createdAt,updatedAt:t.updatedAt,accounts:t.boundAccountId&&store.get('accounts',t.boundAccountId)?1:0,rules:store.list('rules').filter(r=>r.accessTokenId===t.id).length,limits:plan(t.id),usage:usage(t.id)});
 if(!store.get('settings','access-tokens-migrated')){
  const id=randomUUID(),now=new Date().toISOString();
  store.put('accessTokens',id,{id,name:'Первоначальный доступ',type:'premium',status:'active',secretHash:tokenHash(legacyKey),hint:'…'+legacyKey.slice(-6),createdAt:now,updatedAt:now});
  store.put('settings','access-tokens-migrated',{id:'access-tokens-migrated',legacyId:id});
 }
 const legacyId=store.get('settings','access-tokens-migrated').legacyId;
 for(const kind of ['sessions','rules','push','outbox'])for(const item of store.list(kind))if(!item.accessTokenId)store.put(kind,item.id,{...item,accessTokenId:legacyId});
 for(const a of store.list('accounts'))if(!a.accessTokenIds)store.put('accounts',a.id,{...a,accessTokenIds:[legacyId],primaryAccessTokenId:legacyId});
 const legacy=store.get('accessTokens',legacyId),legacyAccount=store.list('accounts').find(a=>a.primaryAccessTokenId===legacyId);
 if(legacy&&!legacy.boundAccountId&&legacyAccount)store.put('accessTokens',legacyId,{...legacy,boundAccountId:legacyAccount.id,...(legacyAccount.credentials?.login?{boundLoginHash:tokenHash(legacyAccount.credentials.login.trim())}:{})});
 const assertActive=id=>{if(!active(id))throw Error('Токен доступа приостановлен или удалён.');};
 const slotKey=(id,rule,slot)=>tokenHash([id,rule.accountId,rule.personId,slot.doctorId,slot.startsAt].join(':'));
 return {
  types:tokenTypes,active,usage,
  list(){return store.list('accessTokens').filter(t=>t.status!=='deleted').map(publicToken);},
  find(secret){if(typeof secret!=='string'||secret.length<24||secret.length>300)return null;const digest=tokenHash(secret);return store.list('accessTokens').find(t=>t.secretHash===digest&&t.status==='active')||null;},
  accountIdForLogin(id,login){const t=store.get('accessTokens',id);return t?.boundLoginHash===tokenHash(login)?t.boundAccountId:null;},
  owns(id,accountId){return active(id)&&store.get('accessTokens',id)?.boundAccountId===accountId;},
  assertBinding(id,account){assertActive(id);const t=store.get('accessTokens',id);if(t.boundAccountId&&t.boundAccountId!==account.id)throw Error('Этот токен уже привязан к другому аккаунту портала.');const old=account.primaryAccessTokenId;if(old&&old!==id&&store.get('accessTokens',old)?.status!=='deleted')throw Error('Аккаунт уже привязан к другому токену. Обратитесь к администратору.');},
  bind(id,account){this.assertBinding(id,account);const t=store.get('accessTokens',id);store.put('accessTokens',id,{...t,boundAccountId:account.id,boundLoginHash:tokenHash(account.credentials.login.trim())});if(account.primaryAccessTokenId&&account.primaryAccessTokenId!==id)for(const r of store.list('rules'))if(r.accountId===account.id)store.put('rules',r.id,{...r,accessTokenId:id});},
  create({name,type}){if(typeof name!=='string'||!name.trim()||name.trim().length>100||!tokenTypes.some(t=>t.id===type))throw Error('Укажите название токена и тариф.');const secret='p38_'+randomBytes(32).toString('base64url'),id=randomUUID(),now=new Date().toISOString(),t={id,name:name.trim(),type,status:'active',secretHash:tokenHash(secret),hint:'…'+secret.slice(-6),createdAt:now,updatedAt:now};store.put('accessTokens',id,t);return {...publicToken(t),secret};},
  update(id,patch){const t=store.get('accessTokens',id);if(!t||t.status==='deleted')throw Error('Токен не найден.');if(!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).some(k=>!['name','type','status'].includes(k)))throw Error('Неизвестные параметры токена.');if(patch.status!==undefined&&!['active','paused'].includes(patch.status))throw Error('Некорректное состояние токена.');if(patch.type!==undefined&&!tokenTypes.some(t=>t.id===patch.type))throw Error('Некорректный тариф.');if(patch.name!==undefined&&(typeof patch.name!=='string'||!patch.name.trim()||patch.name.trim().length>100))throw Error('Укажите название токена.');const next={...t,...patch,...(patch.name!==undefined?{name:patch.name.trim()}:{}),updatedAt:new Date().toISOString()};store.put('accessTokens',id,next);return publicToken(next);},
  remove(id){const t=store.get('accessTokens',id);if(!t||t.status==='deleted')throw Error('Токен не найден.');store.put('accessTokens',id,{...t,status:'deleted',updatedAt:new Date().toISOString()});for(const s of store.list('sessions'))if(s.accessTokenId===id)store.delete('sessions',s.id);for(const item of store.list('outbox'))if(item.accessTokenId===id)store.delete('outbox',item.id);},
  assertTrackerSlot(id,excludeId){assertActive(id);if(tracked(id).filter(r=>r.id!==excludeId).length>=plan(id).concurrentTrackers)throw Error('Достигнут лимит одновременных отслеживаний. Поставьте одно на паузу или смените тариф.');},
  ruleIssue(rule){if(!active(rule.accessTokenId))return 'Токен доступа приостановлен или удалён.';const p=plan(rule.accessTokenId),u=usage(rule.accessTokenId);if(trackingStatuses.includes(rule.status)&&tracked(rule.accessTokenId).findIndex(r=>r.id===rule.id)>=p.concurrentTrackers)return 'Достигнут лимит одновременных отслеживаний по тарифу.';if(u.bookings+u.pending>=p.monthlyBookings)return 'Месячный лимит записей исчерпан. Отслеживание продолжится в следующем месяце.';return '';},
  reserve(id,rule,slot,now=Date.now()){
   assertActive(id);if(!this.owns(id,rule.accountId))throw Error('Токен не принадлежит аккаунту.');
   const fingerprint=slotKey(id,rule,slot),key=randomUUID(),existing=store.list('bookingUsage').find(r=>r.fingerprint===fingerprint&&r.status==='pending');if(existing)throw Error('Результат этой попытки записи уже учитывается. Проверьте картотеку.');
   const issue=this.ruleIssue(rule);if(issue)throw Error(issue);
   store.put('bookingUsage',key,{id:key,fingerprint,accessTokenId:id,accountId:rule.accountId,ruleId:rule.id,personId:rule.personId,doctorId:slot.doctorId,startsAt:slot.startsAt,month:billingMonth(now),at:now,status:'pending'});return key;
  },
  settle(key,outcome){const record=key&&store.get('bookingUsage',key);if(!record)return;if(outcome==='confirmed')store.put('bookingUsage',key,{...record,status:'confirmed'});else if(outcome==='rejected')store.delete('bookingUsage',key);},
  reconcile(rule,appointments){const attempts=store.list('bookingUsage').filter(r=>r.ruleId===rule.id&&r.status==='pending');for(const r of attempts){const match=appointments.some(a=>a.personId===r.personId&&a.doctorId===r.doctorId&&a.status==='active'&&Date.parse(a.startsAt)===Date.parse(r.startsAt));if(match)this.settle(r.id,'confirmed');else if(Date.now()-r.at>=120000)this.settle(r.id,'rejected');}}
 };
}
