export function formatInputDate(iso){return iso?iso.split('-').reverse().join('.'):'';}
export function parseInputDate(value){
 const match=/^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value);
 if(!match)return '';
 const [,day,month,year]=match,iso=`${year}-${month}-${day}`;
 const date=new Date(`${iso}T12:00:00Z`);
 return !Number.isNaN(date.valueOf())&&date.toISOString().slice(0,10)===iso?iso:'';
}
export function installDatePickers(root){
 const upgrade=()=>root.querySelectorAll('input[type="date"]').forEach(input=>{
  const field=document.createElement('span');field.className='date-field';
  const text=document.createElement('input');text.type='text';text.inputMode='numeric';text.placeholder='ДД.ММ.ГГГГ';text.required=input.required;text.value=formatInputDate(input.value);text.setAttribute('aria-label',input.closest('label')?.querySelector('span')?.textContent||'Дата');
  const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='▦';button.setAttribute('aria-label','Открыть календарь');
  input.before(field);field.append(text,button,input);input.type='hidden';
  const validate=()=>{if(input.name==='dateTo')input.min=input.form?.elements.namedItem('dateFrom')?.value||input.min;const iso=parseInputDate(text.value);text.setCustomValidity(!iso?'Введите дату в формате ДД.ММ.ГГГГ':iso<input.min?'Дата раньше допустимой':input.max&&iso>input.max?'Дата позже допустимой':'');input.value=iso;};
  text.addEventListener('input',()=>{validate();if(input.name==='dateFrom')input.form?.dispatchEvent(new Event('date-range-change'));});
  input.form?.addEventListener('date-range-change',validate);
  validate();
  text.addEventListener('change',()=>{validate();input.dispatchEvent(new Event('change',{bubbles:true}));});
  button.addEventListener('click',()=>{
   validate();
   const dialog=document.createElement('dialog');dialog.className='date-calendar';dialog.lang='ru-RU';dialog.setAttribute('aria-label','Выбор даты');
   let current=new Date(`${input.value||input.min||new Date().toISOString().slice(0,10)}T12:00:00Z`);current.setUTCDate(1);
   const close=()=>{dialog.close();dialog.remove();button.focus();};
   const draw=()=>{
    const year=current.getUTCFullYear(),month=current.getUTCMonth();
    dialog.innerHTML='<div class="calendar-heading"><button type="button" class="secondary" aria-label="Предыдущий месяц">‹</button><strong aria-live="polite"></strong><button type="button" class="secondary" aria-label="Следующий месяц">›</button></div><div class="calendar-grid"></div><button type="button" class="secondary calendar-close">Закрыть</button>';
    dialog.querySelector('strong').textContent=new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric',timeZone:'UTC'}).format(current);
    const arrows=dialog.querySelectorAll('.calendar-heading button');arrows.forEach((arrow,i)=>arrow.onclick=()=>{current.setUTCMonth(month+(i?1:-1));draw();dialog.querySelectorAll('.calendar-heading button')[i].focus();});
    const grid=dialog.querySelector('.calendar-grid');
    for(const day of ['Пн','Вт','Ср','Чт','Пт','Сб','Вс']){const label=document.createElement('span');label.textContent=day;grid.append(label);}
    for(let i=0;i<(current.getUTCDay()+6)%7;i++)grid.append(document.createElement('span'));
    const count=new Date(Date.UTC(year,month+1,0)).getUTCDate();
    for(let day=1;day<=count;day++){
     const iso=`${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
     const pick=document.createElement('button');pick.type='button';pick.textContent=day;pick.className='secondary';pick.disabled=Boolean(input.min&&iso<input.min||input.max&&iso>input.max);pick.setAttribute('aria-label',formatInputDate(iso));if(iso===input.value)pick.setAttribute('aria-pressed','true');
     pick.onclick=()=>{input.value=iso;text.value=formatInputDate(iso);validate();input.form?.dispatchEvent(new Event('date-range-change'));close();input.dispatchEvent(new Event('change',{bubbles:true}));};grid.append(pick);
    }
    dialog.querySelector('.calendar-close').onclick=close;
   };
   dialog.addEventListener('cancel',event=>{event.preventDefault();close();});draw();document.body.append(dialog);dialog.showModal();
  });
 });
 new MutationObserver(upgrade).observe(root,{childList:true,subtree:true});upgrade();
}
