import {createAccessTokens} from '../server/access-tokens.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {once} from 'node:events';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';import {Store} from '../server/store.mjs';
test('personal API sessions isolate accounts, rules, mutations and push; shared token has no data access',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'portal38-api-')),key='test-family-access-key-with-enough-length',adminKey='separate-test-administrator-key-long-enough',encryption='cd'.repeat(32);
 const token='a'.repeat(43),otherToken='b'.repeat(43),expiredToken='c'.repeat(43);const seed=new Store(dir,encryption);for(const [value,accountId,expiresAt] of [[token,'test-account',Date.now()+86400000],[otherToken,'other-account',Date.now()+86400000],[expiredToken,'test-account',Date.now()-1]]){const id=createHash('sha256').update(value).digest('hex');seed.put('sessions',id,{id,accountId,createdAt:Date.now(),expiresAt});}seed.put('accounts','other-account',{id:'other-account',label:'Чужой',credentials:{login:'other',password:'other'}});seed.put('rules','other-rule',{id:'other-rule',accountId:'other-account',status:'paused'});seed.put('push','other-push',{id:'other-push',accountId:'other-account',subscription:{}});seed.put('accounts','test-account',{id:'test-account',label:'Тест',credentials:{login:'not-real',password:'not-real'}});seed.put('rules','pending',{id:'pending',accountId:'test-account',personId:'1',specialtyId:'2',status:'booking'});const grants=createAccessTokens(seed,key),legacyId=grants.find(key).id,otherGrant=grants.create({name:'Other client',type:'premium'});seed.put('accessTokens',legacyId,{...seed.get('accessTokens',legacyId),boundAccountId:'test-account'});seed.put('accessTokens',otherGrant.id,{...seed.get('accessTokens',otherGrant.id),boundAccountId:'other-account'});seed.put('accounts','other-account',{...seed.get('accounts','other-account'),primaryAccessTokenId:otherGrant.id,accessTokenIds:[otherGrant.id]});for(const kind of ['sessions','rules','push'])for(const item of seed.list(kind))if(item.accountId==='other-account')seed.put(kind,item.id,{...item,accessTokenId:otherGrant.id});seed.db.close();
 const child=spawn(process.execPath,['server/index.mjs'],{cwd:process.cwd(),env:{...process.env,PORT:'0',HOST:'127.0.0.1',DATA_DIR:dir,ENCRYPTION_KEY:encryption,FAMILY_ACCESS_KEY:key,ADMIN_ACCESS_KEY:adminKey,ALLOWED_ORIGINS:'https://family.example',VAPID_PUBLIC_KEY:'',VAPID_PRIVATE_KEY:''},stdio:['ignore','pipe','pipe']});
 try{
  const port=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Server did not start')),10000);child.stdout.on('data',b=>{const m=b.toString().match(/listening (\d+)/);if(m){clearTimeout(timer);resolve(m[1]);}});child.once('exit',()=>{clearTimeout(timer);reject(Error('Server exited'));});});
  const base=`http://127.0.0.1:${port}/api/`,headers={Authorization:`Bearer ${token}`};
  assert.equal((await fetch(base+'health')).status,200);
  for(const value of [key,token,'incorrect'])assert.equal((await fetch(base+'admin/tokens',{headers:{Authorization:`Bearer ${value}`}})).status,401);
  const adminHeaders={Authorization:`Bearer ${adminKey}`,'Content-Type':'application/json'};
  const adminData=await (await fetch(base+'admin/tokens',{headers:adminHeaders})).json();assert.deepEqual(adminData.types.map(t=>t.name),['Обычный','Премиум']);assert.equal(adminData.tokens.length,2);
  const issuedResponse=await fetch(base+'admin/tokens',{method:'POST',headers:adminHeaders,body:JSON.stringify({name:'API client',type:'standard'})});assert.equal(issuedResponse.status,201);const issued=await issuedResponse.json();assert.ok(issued.secret);
  const listing=await (await fetch(base+'admin/tokens',{headers:adminHeaders})).text();assert.equal(listing.includes(issued.secret),false);assert.equal(listing.includes('secretHash'),false);
  assert.equal((await fetch(base+'admin/tokens/'+issued.id,{method:'PATCH',headers:adminHeaders,body:JSON.stringify({type:'premium',status:'paused'})})).status,200);
  const managedLegacyId=legacyId;
  assert.equal((await fetch(base+'admin/tokens/'+managedLegacyId,{method:'PATCH',headers:adminHeaders,body:JSON.stringify({status:'paused'})})).status,200);
  assert.equal((await fetch(base+'rules',{headers})).status,401);
  assert.equal((await fetch(base+'admin/tokens/'+managedLegacyId,{method:'PATCH',headers:adminHeaders,body:JSON.stringify({status:'active'})})).status,200);
  assert.equal((await fetch(base+'rules',{headers})).status,200);
  assert.equal((await fetch(base+'admin/tokens/'+issued.id,{method:'DELETE',headers:adminHeaders})).status,200);
  assert.equal((await (await fetch(base+'admin/tokens',{headers:adminHeaders})).json()).tokens.length,2);

  assert.equal((await fetch(base+'accounts')).status,401);
  for(const path of ['accounts','rules','push/config'])assert.equal((await fetch(base+path,{headers:{Authorization:`Bearer ${key}`}})).status,401);
  assert.equal((await fetch(base+'accounts',{headers:{Authorization:`Bearer ${expiredToken}`}})).status,401);
  assert.equal((await fetch(base+'session',{method:'POST',headers:{Authorization:'Bearer incorrect','Content-Type':'application/json'},body:JSON.stringify({login:'x',password:'x'})})).status,401);
  assert.equal((await fetch(base+'session',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:'{}'})).status,401);
  for(const [path,method,body] of [['accounts/other-account/people','GET'],['accounts/other-account/specialties?personId=1','GET'],['accounts/other-account/doctors?personId=1&specialtyId=2','GET'],['accounts/other-account/appointments?personId=1','GET'],['accounts/other-account','DELETE'],['accounts/other-account/appointments/'+'a'.repeat(64)+'/cancel','POST',{personId:'1',confirm:true}],['rules/other-rule','PATCH',{status:'active'}],['rules/other-rule','DELETE'],['rules/other-rule/book','POST',{slotId:'s'}],['rules/other-rule/recheck','POST',{resume:true}],['rules','POST',{accountId:'other-account'}]])assert.equal((await fetch(base+path,{method,headers:{...headers,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})})).status,404,path);
  assert.deepEqual(await (await fetch(base+'accounts',{headers:{Authorization:`Bearer ${otherToken}`}})).json(),[{id:'other-account',label:'Чужой'}]);
  assert.equal((await fetch(base+'accounts',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}'})).status,405);
  assert.equal((await fetch(base+'push/subscription',{method:'DELETE',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({id:'other-push'})})).status,200);
  const inspect=new Store(dir,encryption);assert.equal(inspect.get('push','other-push').accountId,'other-account');inspect.db.close();
  const cancelPath=base+'accounts/test-account/appointments/'+'a'.repeat(64)+'/cancel';
  assert.equal((await fetch(cancelPath,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
  assert.equal((await fetch(cancelPath,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({personId:'1',confirm:false})})).status,400);
  assert.equal((await fetch(base+'accounts',{headers:{...headers,Origin:'https://evil.example'}})).status,403);
  const options=await fetch(base+'rules',{method:'OPTIONS',headers:{Origin:'https://family.example'}});assert.equal(options.status,204);assert.equal(options.headers.get('access-control-allow-origin'),'https://family.example');
  const accounts=await (await fetch(base+'accounts',{headers})).json();assert.deepEqual(accounts,[{id:'test-account',label:'Тест'}]);
  const rules=await (await fetch(base+'rules',{headers})).json();assert.equal(rules.length,1);assert.equal(rules[0].status,'needs_review');
  assert.equal((await fetch(base+'rules',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({accountId:'test-account'})})).status,400);
  const push=await (await fetch(base+'push/config',{headers})).json();assert.equal(push.enabled,false);
  assert.equal((await fetch(base+'accounts/test-account',{method:'DELETE',headers})).status,200);
  assert.equal((await fetch(base+'accounts',{headers})).status,401);
  const otherHeaders={Authorization:`Bearer ${otherToken}`};assert.equal((await fetch(base+'rules',{headers:otherHeaders})).status,200);
  assert.equal((await fetch(base+'session',{method:'DELETE',headers:otherHeaders})).status,200);assert.equal((await fetch(base+'rules',{headers:otherHeaders})).status,401);
 }finally{const exited=once(child,'exit');child.kill();await exited;rmSync(dir,{recursive:true,force:true});}
});
