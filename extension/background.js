const BASE='https://gangabass.duckdns.org/portal38-api';
function allowed(tab){try{const u=new URL(tab.url);return u.origin==='https://gangabass.github.io'&&u.pathname.startsWith('/portal38/');}catch{return false;}}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 (async()=>{
  if(message.type==='start'){
   if(!sender.tab||!allowed({url:sender.url})||message.base!==BASE||typeof message.key!=='string'||message.key.length<24||!/^[a-f0-9-]{36}$/.test(message.requestId))throw Error('Недопустимый запрос приложения.');
   const old=(await chrome.storage.session.get('pending')).pending;
   if(old&&old.expires>Date.now())throw Error('Завершите предыдущий вход или отмените его в помощнике.');
   await chrome.storage.session.set({pending:{tabId:sender.tab.id,requestId:message.requestId,key:message.key,base:BASE,expires:Date.now()+15*60000}});
   await chrome.tabs.create({url:'https://portal38.is-mis.ru/esia/auth'});return {ok:true};
  }
  if(sender.tab||sender.id!==chrome.runtime.id)throw Error('Недопустимый отправитель.');
  if(message.type==='cancel'){await chrome.storage.session.remove('pending');return {ok:true};}
  if(message.type==='finish'){
   const pending=(await chrome.storage.session.get('pending')).pending;
   if(!pending||pending.expires<Date.now()){await chrome.storage.session.remove('pending');throw Error('Время подключения истекло. Начните вход из приложения заново.');}
   const check=await chrome.tabs.sendMessage(pending.tabId,{type:'check'});if(!check?.allowed)throw Error('Откройте исходную вкладку приложения и начните заново.');
   const cookies=(await chrome.cookies.getAll({domain:'portal38.is-mis.ru'})).filter(c=>c.domain.replace(/^\./,'')==='portal38.is-mis.ru'&&!c.partitionKey).map(({name,value,domain,path,secure,expirationDate,hostOnly})=>({name,value,domain,path,secure,expirationDate,hostOnly}));
   const response=await fetch(BASE+'/api/session/esia',{method:'POST',headers:{Authorization:`Bearer ${pending.key}`,'Content-Type':'application/json'},body:JSON.stringify({cookies}),signal:AbortSignal.timeout(90000)});
   const result=await response.json();if(!response.ok)throw Error(result.error||'Сервер отклонил сессию.');
   await chrome.tabs.sendMessage(pending.tabId,{type:'result',requestId:pending.requestId,result});
   await chrome.storage.session.remove('pending');await chrome.tabs.update(pending.tabId,{active:true});return {ok:true};
  }
  throw Error('Неизвестная команда.');
 })().then(reply,error=>reply({error:error.message}));return true;
});
