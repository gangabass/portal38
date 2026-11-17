import {Portal,ROOT} from './portal.mjs';
import {parsePeople,parseSpecialties,parseDoctors,parseSlots,parseAppointments,bookingNotice} from './parsers.mjs';
import {conflicts,selectSlots} from './domain.mjs';
import {load} from 'cheerio';
import {BookingError,matchesBookedSlot} from './booking-state.mjs';
export class PortalAccount extends Portal {
  async findPolicyPerson(data){
    const people=await this.people();
    for(const person of people){
      const $=load(await this.request('/user/person_edit/'+person.id));
      if(String($('[name="ins-num"]').val()||'').replace(/\s/g,'')!==data.policy)continue;
      const normalize=s=>String(s||'').trim().toLocaleLowerCase('ru');
      if(normalize($('[name="surname"]').val())!==normalize(data.lastName)||normalize($('[name="first_name"]').val())!==normalize(data.firstName)||Number($('[name="day"]').val())!==Number(data.birthDate.slice(8))||Number($('[name="month"]').val())!==Number(data.birthDate.slice(5,7))||String($('[name="year"]').val())!==data.birthDate.slice(0,4))throw Error('Данные полиса не совпадают с картотекой. Проверьте введённые данные.');
      return person;
    }
    return null;
  }
  async addPerson(data){
    // Existing matching records also recover a prior submission with an uncertain response.
    this.peopleCache=null;
    const existing=await this.findPolicyPerson(data);if(existing)return existing;
    const $=load(await this.request('/user/person_add')),form=$('form').filter((i,x)=>$(x).find('[name="ins-num"]').length).first();
    const csrf=form.find('[name="csrf"]').val();
    if(!csrf||!form.find('[name="surname"]').length||!form.find('[name="first_name"]').length)throw Error('Форма добавления человека изменилась. Обратитесь к администратору.');
    const body=new URLSearchParams({csrf,surname:data.lastName,first_name:data.firstName,second_name:data.middleName||'',day:String(Number(data.birthDate.slice(8))),month:String(Number(data.birthDate.slice(5,7))),year:data.birthDate.slice(0,4),'territory-id':'0','town-id':'0','street-id':'0',house:'',corpus:'',flat:'',polis_type:'1','ins-num':data.policy,rules_accept:'on','register-submit':'Сохранить'});
    try{await this.request('/user/person_add',{method:'POST',body});}catch{throw Error('Результат добавления пока неизвестен. Повторите регистрацию: сначала проверим картотеку.');}
    this.peopleCache=null;
    const person=await this.findPolicyPerson(data);
    if(!person)throw Error('Портал не подтвердил добавление человека. Проверьте полис, ФИО и дату рождения.');
    return person;
  }
  async cards() {
    let html=await this.request('/user/cards');
    if(!load(html)('a[href*=logout]').length) html=await this.login();
    return html;
  }
  async people(){if(this.peopleCache&&Date.now()-this.peopleCacheAt<30000)return this.peopleCache;this.peopleCache=parsePeople(await this.cards());this.peopleCacheAt=Date.now();return this.peopleCache;}
  async specialties(personId){await this.assertPerson(personId);return parseSpecialties(await this.request(`/service/record/${personId}/profiles`));}
  async assertPerson(id){if(!(await this.people()).some(p=>p.id===id))throw Error('Человек не найден в картотеке аккаунта.');}
  async doctors(personId,specialtyId){
    const specialties=await this.specialties(personId);
    if(!specialties.some(s=>s.id===specialtyId))throw Error('Специальность недоступна для этого человека.');
    return parseDoctors(await this.request(`/service/record/${personId}/0/${specialtyId}/doctors?per_page=999999&type=by_lpu&show_other_mo=1`));
  }
  async appointments(personId){const specialties=await this.specialties(personId);return parseAppointments(await this.cards(),personId,specialties);}
  async cancelAppointment(personId,appointmentId){
    await this.assertPerson(personId);
    const html=await this.cards(),records=parseAppointments(html,personId);
    const appointment=records.find(a=>a.id===appointmentId);
    if(!appointment)throw Error('Запись больше не найдена среди активных записей этого человека. Обновите список.');
    if(!appointment.canCancel)throw Error('Портал не разрешает отменить эту запись онлайн.');
    const csrf=load(html)('meta[name="csrf-token"]').attr('content');
    if(!csrf)throw Error('Не удалось получить подтверждение сессии портала. Обновите список записей.');
    const endpoint=appointment.cancelKind==='medservice'?'cancelRecordMedservice':'cancelRecord';
    const body=new URLSearchParams({csrf});
    if(appointment.cancelKind==='record')body.set('source_system',appointment.sourceSystem);
    const response=JSON.parse(await this.request('/service/record/'+endpoint+'/'+appointment.portalRecordId,{method:'POST',headers:{'X-Requested-With':'XMLHttpRequest'},body}));
    if(response?.success===false||response?.error||response?.error_msg)throw Error('Портал отклонил отмену записи. Обновите список и проверьте её состояние.');
    const remaining=await this.appointments(personId);
    if(remaining.some(a=>a.id===appointmentId||(a.portalRecordId===appointment.portalRecordId&&a.sourceSystem===appointment.sourceSystem)||(!a.portalRecordId&&!a.doctorId)||(a.doctorId&&a.doctorId===appointment.doctorId&&(!a.startsAt||!appointment.startsAt||a.startsAt===appointment.startsAt))))throw Error('Отмена не подтверждена: запись пока остаётся активной на портале. Обновите список.');
    return {appointment,appointments:remaining};
  }
  async slots(rule){
    const person=(await this.people()).find(p=>p.id===rule.personId);if(!person)throw Error('Человек не найден в картотеке аккаунта.');
    const doctors=(await this.doctors(rule.personId,rule.specialtyId)).filter(d=>d.clinic.id===rule.clinicId&&(!rule.doctorIds.length||rule.doctorIds.includes(d.id)));
    const slots=[];
    for(const doctor of doctors)slots.push(...parseSlots(await this.request(doctor.url),rule,doctor,person));
    return slots;
  }
  async prepareBooking(rule,slot){
    try{
      if(conflicts(rule,await this.appointments(rule.personId)).length)throw new BookingError('existing_appointment','not_sent','appointments','Уже есть активная запись. Две записи невозможны.');
      const current=selectSlots(rule,await this.slots({...rule,doctorIds:[slot.doctorId]})).find(s=>s.id===slot.id);
      if(!current)throw new BookingError('slot_unavailable','not_sent','availability','Талон уже недоступен.');
      const info=JSON.parse(await this.request('/service/record/getRegAgreeRecordData',{method:'POST',headers:{'X-Requested-With':'XMLHttpRequest',Referer:ROOT+`/service/record/${rule.personId}/${slot.doctorId}/timetable`},body:new URLSearchParams({MedStaffFact_id:slot.doctorId,Person_id:rule.personId,TimetableGraf_id:slot.id})}));
      if(info.error_msg||info.error_code)throw new BookingError('portal_preflight_rejected','not_sent','parameters','Портал не разрешил записаться на выбранный талон. Запрос записи не отправлялся.');
      if(String(info.Person_id)!==rule.personId||String(info.MedStaffFact_id)!==slot.doctorId||String(info.TimetableGraf_id)!==slot.id||String(info.TimeTableType_id)!=='1')throw new BookingError('parameters_changed','not_sent','parameters','Параметры талона изменились. Запрос записи не отправлялся.');
      return current;
    }catch(error){if(error instanceof BookingError)throw error;throw new BookingError('preflight_failed','not_sent','prepare','Не удалось проверить талон перед записью.',error);}
  }
  async book(rule,slot,{beforeSubmit=async()=>{},confirmationDelayMs=1000}={}){
    const current=await this.prepareBooking(rule,slot);
    await beforeSubmit(current);
    let notice='';
    try{
      const response=await this.request(`/service/record/${rule.personId}/${slot.id}/record?email_notify=1&notify_time=24&doctor_id=${slot.doctorId}`,{headers:{Referer:ROOT+`/service/record/${rule.personId}/${slot.doctorId}/timetable`,'Cache-Control':'no-cache'}});
      notice=bookingNotice(response);
    }catch(error){throw new BookingError('submit_failed','unknown','submit','Не удалось выяснить результат запроса записи.',error);}
    try{
      for(let attempt=0;attempt<3;attempt++){
        if(attempt)await new Promise(resolve=>setTimeout(resolve,confirmationDelayMs));
        const records=await this.appointments(rule.personId);
        const appointment=records.find(a=>matchesBookedSlot(a,current));
        if(appointment)return {confirmed:true,appointment:{...current,status:'active',portalAppointmentId:appointment.id}};
      }
      const ageRejected=/только детей до года/i.test(notice);
      const error=new BookingError(ageRejected?'age_restricted':'confirmation_missing',ageRejected?'rejected':'unknown',ageRejected?'submit':'confirm',ageRejected?'Портал отклонил талон с возрастным ограничением.':'Запрос выполнен, но запись не найдена в картотеке.');error.portalNotice=notice;throw error;
    }catch(error){if(error instanceof BookingError)throw error;throw new BookingError('confirmation_failed','unknown','confirm','Не удалось проверить картотеку после запроса записи.',error);}
  }
}
