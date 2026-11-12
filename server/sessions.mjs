import {randomBytes,randomUUID,createHash} from 'node:crypto';
const digest=value=>createHash('sha256').update(value).digest('hex');
const lifetime=90*86400000;
export function createSessions(store,verify,accessTokens=null){
 return {
  async login(login,password,accessTokenId){
   if(accessTokens&&!accessTokens.active(accessTokenId))throw Error('Токен доступа приостановлен или удалён.');
   if(![login,password].every(x=>typeof x==='string'&&x.trim()&&x.length<=300))throw Error('Введите логин и пароль портала.');
   login=login.trim();
   const verified=await verify({login,password});
   // No account is discovered, created or changed until the portal accepts the credentials.
   if(accessTokens&&!accessTokens.active(accessTokenId))throw Error('Токен доступа приостановлен или удалён.');
   const existing=store.list('accounts').find(a=>a.credentials.login.trim()===login);
   const account={...existing,id:existing?.id||accessTokens?.accountIdForLogin(accessTokenId,login)||randomUUID(),label:existing?.label||'Мой аккаунт',credentials:{login,password},cookies:verified.cookies,...(accessTokenId?{accessTokenIds:[...new Set([...(existing?.accessTokenIds||[]),accessTokenId])]}:{})};
   if(accessTokens){accessTokens.assertBinding(accessTokenId,account);accessTokens.bind(accessTokenId,account);account.primaryAccessTokenId=accessTokenId;}
   store.put('accounts',account.id,account);
   const token=randomBytes(32).toString('base64url'),id=digest(token),now=Date.now();
   for(const s of store.list('sessions'))if(s.expiresAt<=now)store.delete('sessions',s.id);
   const previous=store.list('sessions').filter(s=>s.accountId===account.id).sort((a,b)=>a.createdAt-b.createdAt);
   for(const s of previous.slice(0,Math.max(0,previous.length-19)))store.delete('sessions',s.id);
   store.put('sessions',id,{id,accountId:account.id,...(accessTokenId?{accessTokenId}:{}),createdAt:now,expiresAt:now+lifetime});
   return {token,account:{id:account.id,label:account.label}};
  },
  resolve(token){
   if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))return null;
   const id=digest(token),s=store.get('sessions',id);
   if(!s)return null;
   if(accessTokens&&!accessTokens.owns(s.accessTokenId,s.accountId))return null;
   if(s.expiresAt<=Date.now()||!store.get('accounts',s.accountId)){store.delete('sessions',id);return null;}
   if(s.expiresAt-Date.now()<lifetime-86400000)store.put('sessions',id,{...s,expiresAt:Date.now()+lifetime});
   return s;
  },
  revoke(token){store.delete('sessions',digest(token));}
 };
}
export function ownedPushSubscriptions(store,accountId){return accountId?store.list('push').filter(s=>s.accountId===accountId):[];}
