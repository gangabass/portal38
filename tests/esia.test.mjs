import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../server/store.mjs';
import {createSessions} from '../server/sessions.mjs';
import {createAccessTokens} from '../server/access-tokens.mjs';
import {PortalAccount} from '../server/adapter.mjs';
import {importCookies,normalizeCookies,cookieHeader,setCookies} from '../server/cookies.mjs';

test('ESIA session preserves existing account/rules, removes password, rejects other accounts and paused grants',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'portal38-esia-')),store=new Store(dir,'ef'.repeat(32));
 try{
  const grants=createAccessTokens(store,'service-key-with-at-least-24-characters'),id=grants.find('service-key-with-at-least-24-characters').id;
  const sessions=createSessions(store,async()=>({cookies:{old:'session'}}),grants,async cookies=>{if(cookies.bad)throw Error('Invalid portal session');return {login:cookies.login,cookies:[{name:'session',value:'verified'}]};});
  const first=await sessions.login('alice@example.org','secret',id);
  store.put('rules','saved',{id:'saved',accountId:first.account.id,status:'paused'});
  const next=await sessions.importPortal({login:'alice@example.org'},id);
  assert.equal(next.account.id,first.account.id);assert.equal(sessions.resolve(first.token).accountId,next.account.id);
  assert.deepEqual(store.get('accounts',next.account.id).credentials,{login:'alice@example.org'});
  assert.equal(store.get('accounts',next.account.id).authMethod,'esia');assert.equal(store.get('rules','saved').status,'paused');
  await assert.rejects(sessions.importPortal({login:'bob@example.org'},id),/уже привязан/);
  await assert.rejects(sessions.importPortal({bad:true},id));assert.equal(store.list('accounts').length,1);
  const other=grants.create({name:'Other',type:'standard'});await assert.rejects(sessions.importPortal({login:'alice@example.org'},other.id),/уже привязан/);
  grants.update(id,{status:'paused'});await assert.rejects(sessions.importPortal({login:'alice@example.org'},id));
  grants.update(id,{status:'active'});
  const racing=createSessions(store,async()=>({cookies:{}}),grants,async()=>{grants.update(id,{status:'paused'});return {login:'alice@example.org',cookies:[]};});
  await assert.rejects(racing.importPortal([],id));assert.equal(store.list('accounts').length,1);
 }finally{store.db.close();rmSync(dir,{recursive:true,force:true});}
});

test('imported cookies enforce host, header safety, expiry and path; response rotation/deletion preserves isolation',()=>{
 const now=Date.now(),c={name:'session',value:'value',domain:'.portal38.is-mis.ru',path:'/',expirationDate:now/1000+60};
 for(const bad of [{...c,domain:'esia.gosuslugi.ru'},{...c,value:'bad\r\nInjected: true'},{...c,name:'bad;name'},{...c,path:'invalid'}])assert.throws(()=>importCookies([bad]));
 const jar=importCookies([c,{...c,name:'gone',expirationDate:1},{...c,path:'/user',value:'profile'}],now);
 assert.equal(cookieHeader(jar,new URL('https://portal38.is-mis.ru/user/cards'),now),'session=profile; session=value');
 assert.equal(cookieHeader(jar,new URL('https://portal38.is-mis.ru/username'),now),'session=value');
 assert.equal(cookieHeader(jar,new URL('https://esia.gosuslugi.ru/'),now),'');
 assert.equal(cookieHeader(jar,new URL('https://portal38.is-mis.ru/'),now+120000),'');
 setCookies(jar,['session=rotated; Path=/; Secure','session=deleted; Path=/user; Max-Age=0','foreign=no; Domain=gosuslugi.ru; Path=/'],new URL('https://portal38.is-mis.ru/user/cards'),now);
 assert.equal(cookieHeader(jar,new URL('https://portal38.is-mis.ru/user/cards'),now),'session=rotated');
 assert.equal(cookieHeader(normalizeCookies({legacy:'value'}),new URL('https://portal38.is-mis.ru/')),'legacy=value');
});

test('expired passwordless portal sessions ask for ESIA reauthentication without submitting credentials',async()=>{
 const portal=new PortalAccount({login:'alice'},[]);let calls=0;
 portal.request=async path=>{calls++;assert.equal(path,'/user/cards');return '<html>Sign in</html>';};
 await assert.rejects(portal.cards(),e=>e.code==='portal_session_expired');assert.equal(calls,1);
});
