export function createAppointmentsDialog({api,post,onChanged,formatDate}){
 const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const dialog=document.createElement('dialog');dialog.className='appointments-dialog';document.body.append(dialog);
 let accounts=[],people=[],accountId='',personId='',records=[],loading=false,busy=false,error='',message='',generation=0,opener=null;
 const person=()=>people.find(p=>p.id===personId);
 const options=(items,id,label)=>`<option value="">${label}</option>`+items.map(p=>`<option value="${escape(p.id)}" ${p.id===id?'selected':''}>${escape(p.name||p.label)}</option>`).join('');
 function render(){
  dialog.innerHTML=`<div class="modal-header"><div><div class="eyebrow">Моя картотека</div><h2 id="appointments-title">Активные записи</h2></div><button type="button" class="secondary" data-dialog="close" aria-label="Закрыть диалог" ${busy?'disabled':''}>✕</button></div><div class="row"><label class="field"><span>Аккаунт портала</span><select name="account" ${loading||busy?'disabled':''}>${options(accounts,accountId,'Выберите аккаунт')}</select></label><label class="field"><span>Кого записали</span><select name="person" ${loading||busy||!people.length?'disabled':''}>${options(people,personId,'Выберите человека')}</select></label></div><div class="modal-toolbar"><p class="hint">Актуальные записи с медицинского портала.</p><button type="button" class="secondary" data-dialog="refresh" ${!personId||loading||busy?'disabled':''}>Обновить</button></div><div aria-live="polite">${error?`<p class="warning" role="alert">${escape(error)}</p>`:''}${message?`<p class="notice">${escape(message)}</p>`:''}${loading?'<p class="modal-empty" role="status">Загружаем записи с портала…</p>':error&&!records.length?'<p class="modal-empty">Список записей не получен. Нажмите «Обновить».</p>':!personId?'<p class="modal-empty">Выберите человека, чтобы посмотреть его записи.</p>':!records.length?'<div class="modal-empty"><h3>Активных записей нет</h3><p class="hint">Когда появится запись к врачу, она отобразится здесь.</p></div>':records.map(a=>`<article class="appointment-card"><span class="badge">Активная запись</span><h3>${escape(a.specialtyName||'Запись на приём')}</h3>${a.doctorName?`<p class="appointment-doctor">${escape(a.doctorName)}</p>`:''}<p><strong>${escape(a.dateLabel||(a.startsAt?formatDate(a.startsAt):'Дата не указана на портале'))}</strong></p>${a.clinicName?`<p class="hint">${escape(a.clinicName)}</p>`:''}${!a.doctorName&&!a.clinicName?`<p class="hint">${escape(a.summary)}</p>`:''}<div class="appointment-actions">${a.canCancel?`<button type="button" class="danger" data-dialog="cancel" data-id="${escape(a.id)}" ${busy?'disabled':''}>${busy?'Подождите…':'Отменить запись'}</button>`:'<span class="hint">Отмена в приложении недоступна.</span><a href="https://portal38.is-mis.ru/user/cards" target="_blank" rel="noopener noreferrer">Открыть на портале</a>'}</div></article>`).join('')}</div><p class="hint">Перед отменой попросим подтверждение. Связанные отслеживания будут поставлены на паузу.</p>`;
  dialog.setAttribute('aria-labelledby','appointments-title');
 }
 async function loadRecords(){
  const version=++generation,context={accountId,personId};loading=true;error='';records=[];render();
  try{const data=await api(`accounts/${accountId}/appointments?personId=${encodeURIComponent(personId)}`);if(version===generation){records=data;await onChanged({...context,appointments:data});}}
  catch(err){if(version===generation)error=err.message;}
  finally{if(version===generation){loading=false;render();}}
 }
 async function loadPeople(selected=''){
  const version=++generation;loading=true;people=[];personId='';records=[];error='';message='';render();
  try{const data=await api(`accounts/${accountId}/people`);if(version!==generation)return;people=data;personId=people.some(p=>p.id===selected)?selected:people.length===1?people[0].id:'';}
  catch(err){if(version===generation)error=err.message;}
  finally{if(version===generation){loading=false;render();}}
  if(version===generation&&personId)await loadRecords();
 }
 function close(){if(busy)return;generation++;dialog.close();opener?.focus();}
 dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 dialog.addEventListener('change',async event=>{if(busy)return;message='';if(event.target.name==='account'){accountId=event.target.value;if(accountId)await loadPeople();else{generation++;people=[];records=[];personId='';render();}}if(event.target.name==='person'){personId=event.target.value;if(personId)await loadRecords();else{generation++;records=[];render();}}});
 dialog.addEventListener('click',async event=>{
  const button=event.target.closest('[data-dialog]');if(!button||busy)return;
  if(button.dataset.dialog==='close')return close();
  if(button.dataset.dialog==='refresh'){message='';return loadRecords();}
  if(button.dataset.dialog!=='cancel')return;
  const appointment=records.find(a=>a.id===button.dataset.id);if(!appointment?.canCancel)return;
  const details=[person()?.name,appointment.specialtyName,appointment.doctorName,appointment.dateLabel||(appointment.startsAt?formatDate(appointment.startsAt):''),appointment.clinicName].filter(Boolean).join('\n');
  if(!confirm(`Отменить эту запись на портале?\n\n${details}\n\nСвязанные отслеживания будут поставлены на паузу.`))return;
  busy=true;error='';message='';render();
  try{const result=await post(`accounts/${accountId}/appointments/${appointment.id}/cancel`,{personId,confirm:true});records=result.appointments;message=result.pausedRules?'Запись отменена. Связанные отслеживания поставлены на паузу.':'Запись отменена на портале.';await onChanged({accountId,personId,appointments:records});}
  catch(err){error=err.message;records=[];let updated=false;try{records=await api(`accounts/${accountId}/appointments?personId=${encodeURIComponent(personId)}`);updated=true;}catch{error+=' Не удалось обновить список. Нажмите «Обновить».';}await onChanged({accountId,personId,...(updated?{appointments:records}:{})});}
  finally{busy=false;render();dialog.querySelector('[data-dialog="refresh"]')?.focus();}
 });
 return {async open(context){if(busy)return;accounts=context.accounts;accountId=accounts.some(a=>a.id===context.accountId)?context.accountId:accounts[0]?.id||'';opener=document.activeElement;error='';message='';people=[];records=[];personId='';render();if(!dialog.open)dialog.showModal();if(accountId)await loadPeople(context.personId);}};
}
