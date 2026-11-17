for(const type of ['finish','cancel'])document.getElementById(type).onclick=async()=>{
 const buttons=[...document.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);const status=document.getElementById('status');status.textContent=type==='finish'?'Проверяем сессию портала…':'';
 try{const r=await chrome.runtime.sendMessage({type});if(r.error)throw Error(r.error);status.textContent=type==='finish'?'Готово. Вернитесь в приложение.':'Подключение отменено.';}catch(e){status.textContent=e.message;}finally{buttons.forEach(b=>b.disabled=false);}
};