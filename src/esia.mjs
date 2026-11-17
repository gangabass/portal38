export function startEsia({base,key,onSuccess,onError,onStarted}){
 const requestId=crypto.randomUUID();let acknowledged=false;
 const cleanup=()=>{clearTimeout(timer);clearTimeout(expiry);window.removeEventListener('message',receive);};
 const receive=event=>{
  if(event.source!==window||event.origin!==location.origin||event.data?.source!=='portal38-helper'||event.data.requestId!==requestId)return;
  if(event.data.type==='started'){acknowledged=true;clearTimeout(timer);onStarted();}
  if(event.data.type==='error'){cleanup();onError(event.data.error);}
  if(event.data.type==='result'){cleanup();if(typeof event.data.result?.token==='string')onSuccess(event.data.result);else onError('Не получена сессия приложения.');}
 };
 const timer=setTimeout(()=>{if(!acknowledged){cleanup();onError('Установите помощник ЕСИА по инструкции под кнопкой входа, затем перезагрузите страницу.');}},2500);
 const expiry=setTimeout(()=>{cleanup();onError('Время входа истекло. Начните заново.');},15*60000);
 window.addEventListener('message',receive);window.postMessage({source:'portal38-app',type:'esia-start',requestId,base,key},location.origin);return cleanup;
}
