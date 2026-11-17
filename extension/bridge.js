window.addEventListener('message',async event=>{
 if(event.source!==window||event.origin!==location.origin||event.data?.source!=='portal38-app'||event.data.type!=='esia-start')return;
 const {requestId,key,base}=event.data;
 try{const result=await chrome.runtime.sendMessage({type:'start',requestId,key,base});if(result?.error)throw Error(result.error);window.postMessage({source:'portal38-helper',requestId,type:'started'},location.origin);}
 catch(e){window.postMessage({source:'portal38-helper',requestId,type:'error',error:e.message||'Не удалось запустить помощник ЕСИА. Перезагрузите приложение.'},location.origin);}
});
chrome.runtime.onMessage.addListener((message,sender,reply)=>{if(message.type==='check'){reply({allowed:location.origin==='https://gangabass.github.io'&&location.pathname.startsWith('/portal38/')});return;}if(message.type==='result')window.postMessage({source:'portal38-helper',...message},location.origin);});
