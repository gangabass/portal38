import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createSessions,ownedPushSubscriptions} from '../server/sessions.mjs';import {Store} from '../server/store.mjs';

test('portal verification claims only the matching legacy account and preserves rules; sessions are opaque, revocable and expire',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'portal38-sessions-')),store=new Store(dir,'ce'.repeat(32));
 try{
  store.put('accounts','existing',{id:'existing',label:'Existing',credentials:{login:'alice',password:'old'},cookies:{old:'cookie'}});
  store.put('accounts','other',{id:'other',credentials:{login:'bob',password:'other'}});
  store.put('rules','rule',{id:'rule',accountId:'existing',status:'paused'});
  let calls=0;
  const sessions=createSessions(store,async credentials=>{calls++;assert.equal(credentials.login,'alice');if(credentials.password!=='valid')throw Error('Portal rejected');return {cookies:{fresh:'cookie'}};});
  await assert.rejects(sessions.login('alice','invalid'));
  assert.equal(store.list('sessions').length,0);assert.equal(store.get('accounts','existing').credentials.password,'old');
  const result=await sessions.login('alice','valid');assert.equal(calls,2);assert.equal(result.account.id,'existing');
  assert.equal(store.list('accounts').length,2);assert.equal(store.get('rules','rule').status,'paused');
  assert.equal(sessions.resolve(result.token).accountId,'existing');assert.equal(sessions.resolve('shared-service-access-token'),null);
  assert.equal(JSON.stringify(store.list('sessions')).includes(result.token),false);
  sessions.revoke(result.token);assert.equal(sessions.resolve(result.token),null);
  const next=await sessions.login('alice','valid'),record=store.list('sessions')[0];store.put('sessions',record.id,{...record,expiresAt:Date.now()-1});assert.equal(sessions.resolve(next.token),null);
  assert.equal(store.get('accounts','other').credentials.password,'other');
 }finally{store.db.close();rmSync(dir,{recursive:true,force:true});}
});

test('new portal users get separate accounts; push selection never includes another account or legacy unowned devices',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'portal38-isolation-')),store=new Store(dir,'df'.repeat(32));
 try{
  const sessions=createSessions(store,async()=>({cookies:{}}));
  const a=await sessions.login('alice','verified'),b=await sessions.login('bob','verified');
  assert.notEqual(a.account.id,b.account.id);assert.notEqual(a.token,b.token);
  for(const [id,accountId] of [['a',a.account.id],['b',b.account.id],['legacy',undefined]])store.put('push',id,{id,accountId});
  assert.deepEqual(ownedPushSubscriptions(store,a.account.id).map(s=>s.id),['a']);
  assert.deepEqual(ownedPushSubscriptions(store,b.account.id).map(s=>s.id),['b']);assert.deepEqual(ownedPushSubscriptions(store,undefined),[]);
  store.delete('accounts',b.account.id);assert.equal(sessions.resolve(b.token),null);assert.equal(sessions.resolve(a.token).accountId,a.account.id);
 }finally{store.db.close();rmSync(dir,{recursive:true,force:true});}
});
