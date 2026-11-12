import {Portal,ROOT} from './portal.mjs';
import {parsePeople,parseSpecialties,parseDoctors,parseSlots,parseAppointments} from './parsers.mjs';
import {conflicts,selectSlots} from './domain.mjs';
import {load} from 'cheerio';
export class PortalAccount extends Portal {
  async cards() {
    let html=await this.request('/user/cards');
    if(!load(html)('a[href*=logout]').length) html=await this.login();
    if(!parsePeople(html).length)throw Error('В картотеке не найдено людей.');
    return html;
  }
  async people(){return parsePeople(await this.cards());}
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
    if(remaining.some(a=>a.id===appointmentId||(a.portalRecordId===appointment.portalRecordId&&a.sourceSystem===appointment.sourceSystem)||(a.doctorId&&a.doctorId===appointment.doctorId&&a.startsAt&&a.startsAt===appointment.startsAt)))throw Error('Отмена не подтверждена: запись пока остаётся активной на портале. Обновите список.');
    return {appointment,appointments:remaining};
  }
  async slots(rule){
    const doctors=(await this.doctors(rule.personId,rule.specialtyId)).filter(d=>d.clinic.id===rule.clinicId&&(!rule.doctorIds.length||rule.doctorIds.includes(d.id)));
    const slots=[];
    for(const doctor of doctors)slots.push(...parseSlots(await this.request(doctor.url),rule,doctor));
    return slots;
  }
  async book(rule,slot){
    if(conflicts(rule,await this.appointments(rule.personId)).length)throw Error('Уже есть активная запись. Две записи невозможны.');
    const current=selectSlots(rule,await this.slots({...rule,doctorIds:[slot.doctorId]})).find(s=>s.id===slot.id);
    if(!current)throw Error('Талон уже недоступен. Обновите список.');
    const info=JSON.parse(await this.request('/service/record/getRegAgreeRecordData',{method:'POST',headers:{'X-Requested-With':'XMLHttpRequest'},body:new URLSearchParams({MedStaffFact_id:slot.doctorId,Person_id:rule.personId,TimetableGraf_id:slot.id})}));
    if(String(info.Person_id)!==rule.personId||String(info.MedStaffFact_id)!==slot.doctorId||String(info.TimetableGraf_id)!==slot.id||String(info.TimeTableType_id)!=='1')throw Error('Портал не подтвердил параметры выбранного талона.');
    await this.request(`/service/record/${rule.personId}/${slot.id}/record?email_notify=1&notify_time=24&doctor_id=${slot.doctorId}`);
    const $=load(await this.cards()),card=$(`#cur_records_${rule.personId}`);
    // Only an exact slot identifier in current records confirms success.
    const confirmed=card.html()?.includes(slot.id)===true;
    return {confirmed,appointment:{...slot,status:'active'}};
  }
}
