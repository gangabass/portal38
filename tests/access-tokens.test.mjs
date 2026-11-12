import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {Store} from '../server/store.mjs';import {createAccessTokens,billingMonth} from '../server/access-tokens.mjs';import {createSessions} from '../server/sessions.mjs';import {guardBookingAccess} from '../server/access-guard.mjs';
function fixture(fn){const dir=mkdtempSync(join(tmpdir(),'portal38-tokens-')),store=new Store(dir,'ef'.repeat(32));return Promise.resolve().then(()=>fn(store)).finally(()=>{store.db.close();rmSync(dir,{recursive:true,force:true});});}
const legacy='legacy-access-token-with-enough-length';
test('access tokens migrate existing objects once; secrets are hashed, shown only on creation and never recreated after deletion',()=>fixture(store=>{
 store.put('accounts','a',{id:'a'});store.put('rules','r',{id:'r',accountId:'a',status:'active'});store.put('sessions','s',{id:'s',accountId:'a'});
 const tokens=createAccessTokens(store,legacy),old=tokens.find(legacy);assert.equal(old.type,'premium');assert.equal(store.get('rules','r').accessTokenId,old.id);assert.equal(store.get('sessions','s').accessTokenId,old.id);
 const issued=tokens.create({name:'Client',type:'standard'});assert.equal(tokens.find(issued.secret).id,issued.id);assert.equal(issued.type,'standard');
 const serialized=JSON.stringify(tokens.list());assert.equal(serialized.includes(issued.secret),false);assert.equal(serialized.includes('secretHash'),false);assert.equal(JSON.stringify(store.list('accessTokens')).includes(issued.secret),false);
 tokens.update(issued.id,{status:'paused',type:'premium'});assert.equal(tokens.find(issued.secret),null);assert.equal(tokens.active(issued.id),false);
 tokens.update(issued.id,{status:'active'});assert.equal(tokens.find(issued.secret).type,'premium');
 tokens.remove(old.id);const after=createAccessTokens(store,legacy);assert.equal(after.find(legacy),null);assert.equal(after.list().length,1);assert.equal(store.get('rules','r').status,'active');
 assert.throws(()=>tokens.update(issued.id,{secretHash:'override'}));assert.throws(()=>tokens.create({name:'X',type:'third'}));
}));
test('pause blocks already-issued sessions, resume restores them, deletion revokes them, and pause during portal verification rejects sign-in',()=>fixture(async store=>{
 const tokens=createAccessTokens(store,legacy),issued=tokens.create({name:'Client',type:'standard'}),sessions=createSessions(store,async()=>({cookies:{}}),tokens);
 const login=await sessions.login('alice','verified',issued.id);assert.equal(sessions.resolve(login.token).accessTokenId,issued.id);
 tokens.update(issued.id,{status:'paused'});assert.equal(sessions.resolve(login.token),null);await assert.rejects(sessions.login('bob','verified',issued.id));
 tokens.update(issued.id,{status:'active'});assert.ok(sessions.resolve(login.token));
 const racing=createSessions(store,async()=>{tokens.update(issued.id,{status:'paused'});return {cookies:{}};},tokens);await assert.rejects(racing.login('bob','verified',issued.id));assert.equal(store.list('accounts').length,1);
 tokens.update(issued.id,{status:'active'});tokens.remove(issued.id);assert.equal(sessions.resolve(login.token),null);assert.equal(store.list('sessions').length,0);
}));
test('pause during slot preparation prevents the booking mutation and durable submit marker for both booking modes',()=>fixture(async store=>{
 const tokens=createAccessTokens(store,legacy),issued=tokens.create({name:'Client',type:'standard'});let sent=0,marked=0;
 const portal=guardBookingAccess({async book(rule,slot,{beforeSubmit}){tokens.update(issued.id,{status:'paused'});await beforeSubmit(slot);sent++;return {confirmed:true};}},tokens);
 await assert.rejects(portal.book({accessTokenId:issued.id},{id:'slot'},{beforeSubmit:()=>marked++}),e=>e.outcome==='not_sent');assert.equal(sent,0);assert.equal(marked,0);
}));

test('one client token binds exactly one portal account; a second active token cannot claim that account',()=>fixture(async store=>{
 const tokens=createAccessTokens(store,legacy),a=tokens.create({name:'A',type:'standard'}),b=tokens.create({name:'B',type:'premium'}),sessions=createSessions(store,async()=>({cookies:{}}),tokens);
 const first=await sessions.login('alice','ok',a.id);await assert.rejects(sessions.login('bob','ok',a.id));await assert.rejects(sessions.login('alice','ok',b.id));assert.equal(store.list('accounts').length,1);
 tokens.remove(a.id);const replacement=await sessions.login('alice','ok',b.id);assert.equal(replacement.account.id,first.account.id);assert.equal(sessions.resolve(replacement.token).accessTokenId,b.id);
}));
test('both tariff limits apply; quota reservations survive unknown outcomes and rule deletion; Irkutsk month resets counters',()=>fixture(async store=>{
 const tokens=createAccessTokens(store,legacy),sessions=createSessions(store,async()=>({cookies:{}}),tokens);
 for(const [type,count,trackers] of [['standard',10,2],['premium',30,5]]){
  const t=tokens.create({name:type,type}),login=await sessions.login(type,'ok',t.id),rule={id:type,accountId:login.account.id,accessTokenId:t.id,personId:'1',status:'active',createdAt:'2026-01-01'};store.put('rules',rule.id,rule);
  for(let i=1;i<trackers;i++)store.put('rules',type+i,{...rule,id:type+i});assert.throws(()=>tokens.assertTrackerSlot(t.id));
  store.put('rules',type+'paused',{...rule,id:type+'paused',status:'paused'});assert.throws(()=>tokens.assertTrackerSlot(t.id,type+'paused'));
  for(let i=0;i<count;i++){const key=tokens.reserve(t.id,rule,{doctorId:'d',startsAt:'2030-01-'+String(i+1).padStart(2,'0')+'T10:00:00+08:00'});if(i<count-1)tokens.settle(key,'confirmed');}
  assert.equal(tokens.usage(t.id).bookings,count-1);assert.equal(tokens.usage(t.id).pending,1);assert.throws(()=>tokens.reserve(t.id,rule,{doctorId:'d',startsAt:'2031-01-01T10:00:00+08:00'}));
  store.delete('rules',rule.id);assert.equal(tokens.usage(t.id).bookings,count-1);
  assert.equal(tokens.usage(t.id,Date.parse('2099-01-01T00:00:00+08:00')).bookings,0);
 }
}));
test('usage ledger handles confirmation, definite rejection, uncertain submission, and failed durable markers',()=>fixture(async store=>{
 const tokens=createAccessTokens(store,legacy),t=tokens.create({name:'A',type:'standard'}),sessions=createSessions(store,async()=>({cookies:{}}),tokens),login=await sessions.login('alice','ok',t.id);
 const rule={id:'r',accountId:login.account.id,accessTokenId:t.id,personId:'1',status:'active'},slot={doctorId:'d',startsAt:'2030-01-01T10:00:00+08:00'};store.put('rules',rule.id,rule);
 let mode='confirmed';const portal=guardBookingAccess({async book(r,s,{beforeSubmit}){await beforeSubmit(s);if(mode==='unknown')throw Object.assign(Error('Network'),{outcome:'unknown'});if(mode==='rejected')throw Object.assign(Error('Rejected'),{outcome:'rejected'});return {confirmed:true};}},tokens);
 await portal.book(rule,slot);assert.equal(tokens.usage(t.id).bookings,1);
 mode='rejected';await assert.rejects(portal.book(rule,{...slot,doctorId:'2'}));assert.equal(tokens.usage(t.id).pending,0);
 mode='unknown';await assert.rejects(portal.book(rule,{...slot,doctorId:'3'}));assert.equal(tokens.usage(t.id).pending,1);
 await assert.rejects(portal.book(rule,{...slot,doctorId:'4'},{beforeSubmit(){throw Error('Disk full');}}));assert.equal(tokens.usage(t.id).pending,1);
 const pending=store.list('bookingUsage').find(r=>r.status==='pending');store.put('bookingUsage',pending.id,{...pending,at:Date.now()-120001});tokens.reconcile(rule,[{personId:'1',status:'active',unclassified:true}]);assert.equal(tokens.usage(t.id).pending,1);tokens.reconcile(rule,[]);assert.equal(tokens.usage(t.id).pending,0);assert.equal(tokens.usage(t.id).bookings,1);
}));

test('billing month changes at midnight in Irkutsk; tariff downgrade pauses excess trackers without altering them',()=>fixture(store=>{
 assert.equal(billingMonth(Date.parse('2030-01-31T15:59:59Z')),'2030-01');assert.equal(billingMonth(Date.parse('2030-01-31T16:00:00Z')),'2030-02');
 const tokens=createAccessTokens(store,legacy),t=tokens.create({name:'A',type:'premium'});
 for(let i=0;i<5;i++)store.put('rules','r'+i,{id:'r'+i,accessTokenId:t.id,status:'active',createdAt:'2030-01-0'+(i+1)});
 tokens.update(t.id,{type:'standard'});assert.equal(tokens.ruleIssue(store.get('rules','r0')),'');assert.match(tokens.ruleIssue(store.get('rules','r2')),/отслеживаний/);assert.equal(store.get('rules','r2').status,'active');tokens.update(t.id,{type:'premium'});assert.equal(tokens.ruleIssue(store.get('rules','r2')),'');
}));

test('disconnecting an account does not let its token bind another login or reset monthly usage',()=>fixture(async store=>{
 const tokens=createAccessTokens(store,legacy),t=tokens.create({name:'A',type:'standard'}),sessions=createSessions(store,async()=>({cookies:{}}),tokens),first=await sessions.login('alice','ok',t.id);
 const rule={id:'r',accountId:first.account.id,accessTokenId:t.id,personId:'1',status:'active'};store.put('rules',rule.id,rule);const reservation=tokens.reserve(t.id,rule,{doctorId:'d',startsAt:'2030-01-01T10:00:00+08:00'});tokens.settle(reservation,'confirmed');
 store.delete('accounts',first.account.id);store.delete('rules',rule.id);await assert.rejects(sessions.login('bob','ok',t.id));const restored=await sessions.login('alice','ok',t.id);assert.equal(restored.account.id,first.account.id);assert.equal(tokens.usage(t.id).bookings,1);
}));
