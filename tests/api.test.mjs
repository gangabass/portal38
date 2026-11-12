import test from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {once} from 'node:events';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {Store} from '../server/store.mjs';
test('API authorization, CORS, safe restart and account deletion',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'portal38-api-')),key='test-family-access-key-with-enough-length',encryption='cd'.repeat(32);
 const seed=new Store(dir,encryption);seed.put('accounts','test-account',{id:'test-account',label:'Тест',credentials:{login:'not-real',password:'not-real'}});seed.put('rules','pending',{id:'pending',accountId:'test-account',personId:'1',specialtyId:'2',status:'booking'});seed.db.close();
 const child=spawn(process.execPath,['server/index.mjs'],{cwd:process.cwd(),env:{...process.env,PORT:'0',HOST:'127.0.0.1',DATA_DIR:dir,ENCRYPTION_KEY:encryption,FAMILY_ACCESS_KEY:key,ALLOWED_ORIGINS:'https://family.example',VAPID_PUBLIC_KEY:'',VAPID_PRIVATE_KEY:''},stdio:['ignore','pipe','pipe']});
 try{
  const port=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Server did not start')),10000);child.stdout.on('data',b=>{const m=b.toString().match(/listening (\d+)/);if(m){clearTimeout(timer);resolve(m[1]);}});child.once('exit',()=>{clearTimeout(timer);reject(Error('Server exited'));});});
  const base=`http://127.0.0.1:${port}/api/`,headers={Authorization:`Bearer ${key}`};
  assert.equal((await fetch(base+'health')).status,200);
  assert.equal((await fetch(base+'accounts')).status,401);
  const cancelPath=base+'accounts/test-account/appointments/'+'a'.repeat(64)+'/cancel';
  assert.equal((await fetch(cancelPath,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
  assert.equal((await fetch(cancelPath,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({personId:'1',confirm:false})})).status,400);
  assert.equal((await fetch(base+'accounts',{headers:{...headers,Origin:'https://evil.example'}})).status,403);
  const options=await fetch(base+'rules',{method:'OPTIONS',headers:{Origin:'https://family.example'}});assert.equal(options.status,204);assert.equal(options.headers.get('access-control-allow-origin'),'https://family.example');
  const accounts=await (await fetch(base+'accounts',{headers})).json();assert.deepEqual(accounts,[{id:'test-account',label:'Тест'}]);
  const rules=await (await fetch(base+'rules',{headers})).json();assert.equal(rules[0].status,'needs_review');
  assert.equal((await fetch(base+'rules',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}'})).status,400);
  const push=await (await fetch(base+'push/config',{headers})).json();assert.equal(push.enabled,false);
  assert.equal((await fetch(base+'accounts/test-account',{method:'DELETE',headers})).status,200);
  assert.deepEqual(await (await fetch(base+'accounts',{headers})).json(),[]);
  assert.deepEqual(await (await fetch(base+'rules',{headers})).json(),[]);
 }finally{const exited=once(child,'exit');child.kill();await exited;rmSync(dir,{recursive:true,force:true});}
});
