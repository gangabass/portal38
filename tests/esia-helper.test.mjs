import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('browser helper transfers only portal cookies to fixed API and returns app session only to initiating tab',async()=>{
 let listener,pending,posted,delivered,opened;
 const chrome={runtime:{id:'helper',onMessage:{addListener:fn=>listener=fn}},storage:{session:{get:async()=>({pending}),set:async v=>pending=v.pending,remove:async()=>pending=undefined}},cookies:{getAll:async()=>[{name:'portal',value:'secret',domain:'portal38.is-mis.ru',path:'/',secure:true},{name:'unrelated',value:'no',domain:'.is-mis.ru',path:'/'}]},tabs:{create:async v=>opened=v,sendMessage:async(id,m)=>{assert.equal(id,7);if(m.type==='check')return {allowed:true};delivered=m;},update:async()=>{}}};
 vm.runInNewContext(readFileSync(new URL('../extension/background.js',import.meta.url),'utf8'),{chrome,URL,Date,AbortSignal,fetch:async(url,options)=>{posted={url,options};return {ok:true,json:async()=>({token:'app-session',account:{id:'account'}})};}});
 const send=(message,sender)=>new Promise(resolve=>listener(message,sender,resolve));
 const sender={id:'helper',url:'https://gangabass.github.io/portal38/',tab:{id:7}},base='https://gangabass.duckdns.org/portal38-api',key='service-key-with-24-characters',requestId='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
 assert.ok((await send({type:'start',base:'https://evil.example',key,requestId},sender)).error);assert.equal(pending,undefined);
 assert.equal((await send({type:'start',base,key,requestId},sender)).ok,true);assert.equal(opened.url,'https://portal38.is-mis.ru/esia/auth');
 assert.ok((await send({type:'finish'},sender)).error);assert.equal(posted,undefined);
 assert.equal((await send({type:'finish'},{id:'helper'})).ok,true);assert.equal(posted.url,base+'/api/session/esia');
 assert.equal(posted.options.headers.Authorization,'Bearer '+key);assert.equal(JSON.parse(posted.options.body).cookies.length,1);
 assert.equal(delivered.result.token,'app-session');assert.equal(delivered.requestId,requestId);assert.equal(pending,undefined);
 await send({type:'start',base,key,requestId},sender);pending.expires=0;
 assert.ok((await send({type:'finish'},{id:'helper'})).error);assert.equal(pending,undefined);
});
