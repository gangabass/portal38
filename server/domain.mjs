export const ZONE = 'Asia/Irkutsk';
export function localDate(value) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)).map(p=>[p.type,p.value]));
  return {date:`${parts.year}-${parts.month}-${parts.day}`, time:`${parts.hour}:${parts.minute}`, weekday:new Date(`${parts.year}-${parts.month}-${parts.day}T12:00:00+08:00`).getUTCDay()};
}
export function validateRule(r) {
  if (!r || ![r.accountId,r.personId,r.clinicId,r.specialtyId].every(x=>typeof x==='string' && x.length>0 && x.length<200)) throw Error('Выберите аккаунт, человека, поликлинику и специальность.');
  if (!Array.isArray(r.doctorIds) || !r.doctorIds.every(x=>typeof x==='string' && x.length>0)) throw Error('Некорректный список врачей.');
  if (!Array.isArray(r.weekdays) || !r.weekdays.length || !r.weekdays.every(x=>Number.isInteger(x)&&x>=0&&x<=6)) throw Error('Выберите дни недели.');
  const validDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s||'') && !isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0,10)===s;
  if (!validDate(r.dateFrom)||!validDate(r.dateTo)||r.dateFrom>r.dateTo) throw Error('Проверьте диапазон дат.');
  if (![r.timeFrom,r.timeTo].every(x=>/^([01]\d|2[0-3]):[0-5]\d$/.test(x||'')) || r.timeFrom>r.timeTo) throw Error('Проверьте интервал времени.');
  if (typeof r.autoBook!=='boolean') throw Error('Укажите режим записи.');
  return r;
}
export function matches(rule, slot, now=Date.now()) {
  if (Date.parse(slot.startsAt)<=now || !Number.isFinite(Date.parse(slot.startsAt))) return false;
  const local=localDate(slot.startsAt);
  return slot.personId===rule.personId && slot.clinicId===rule.clinicId && slot.specialtyId===rule.specialtyId && (!rule.doctorIds.length||rule.doctorIds.includes(slot.doctorId)) && local.date>=rule.dateFrom && local.date<=rule.dateTo && rule.weekdays.includes(local.weekday) && local.time>=rule.timeFrom && local.time<=rule.timeTo;
}
export function selectSlots(rule, slots, now=Date.now()) {
  return slots.filter(s=>matches(rule,s,now)).sort((a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt)||a.id.localeCompare(b.id));
}
export function conflicts(rule, appointments, now=Date.now()) {
  // Portal restriction applies to the specialty even when a specific doctor is requested.
  return appointments.filter(a=>a.personId===rule.personId && (a.specialtyId===rule.specialtyId||a.specialtyId==='*') && a.status==='active' && (!a.startsAt||Date.parse(a.startsAt)>now));
}
export async function runRule(rule, {portal,save,notify,previousIds=[],now=Date.now()}) {
  if(localDate(now).date>rule.dateTo){await save({...rule,status:'expired',slots:[],message:'Период поиска завершён.',checkedAt:new Date(now).toISOString()});return;}
  if (conflicts(rule,await portal.appointments(rule.personId),now).length) {
    await save({...rule,status:'blocked',slots:[],message:'Уже есть активная запись по этой специальности. Две записи невозможны.',checkedAt:new Date(now).toISOString()}); return;
  }
  const slots=selectSlots(rule,await portal.slots(rule),now);
  if (rule.autoBook && slots.length) {
    // Persist before the remote mutation. An uncertain result must never be retried automatically.
    await save({...rule,status:'booking',slots,checkedAt:new Date(now).toISOString(),message:'Проверяем результат записи…'});
    const result=await portal.book(rule,slots[0]);
    if (!result.confirmed) throw Error('Результат записи не подтверждён. Проверьте записи на портале.');
    await save({...rule,status:'booked',slots:[],appointment:result.appointment,message:'Запись подтверждена',checkedAt:new Date(now).toISOString()});
    await notify({title:'Вы записаны к врачу',body:slots[0].doctorName,tag:`booked-${rule.id}`}); return;
  }
  await save({...rule,status:'active',slots,checkedAt:new Date(now).toISOString(),message:slots.length?`Подходящих талонов: ${slots.length}`:'Подходящих талонов пока нет'});
  const fresh=slots.filter(s=>!previousIds.includes(s.id));
  if (fresh.length) await notify({title:'Есть свободное время',body:`Новых подходящих талонов: ${fresh.length}. Откройте приложение.`,tag:`rule-${rule.id}`});
}
