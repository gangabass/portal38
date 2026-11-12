// Serialize this operation with all other operations for the portal account.
export function rulesToPause(rules,accountId,appointment){
  return rules.filter(r=>r.accountId===accountId&&r.personId===appointment.personId&&
    (appointment.specialtyId==='*'||r.specialtyId===appointment.specialtyId)&&
    ['active','error','blocked','needs_review'].includes(r.status)).map(r=>({...r,status:'paused',slots:[],message:'Отслеживание на паузе: выполнялась отмена записи. Продолжить можно вручную.'}));
}
export function isBookedAppointment(rule,accountId,appointment){
  return rule.accountId===accountId&&rule.personId===appointment.personId&&rule.status==='booked'&&
    Boolean(appointment.doctorId&&appointment.startsAt)&&rule.appointment?.doctorId===appointment.doctorId&&Date.parse(rule.appointment.startsAt)===Date.parse(appointment.startsAt);
}
