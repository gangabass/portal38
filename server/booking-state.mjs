export class BookingError extends Error{
 constructor(code,outcome,stage,message,cause){super(message,{cause});this.name='BookingError';Object.assign(this,{code,outcome,stage,httpStatus:cause?.status});}
}
export function bookingFailure(rule,error,{submitted=false,now=Date.now()}={}){
 const outcome=error.outcome||(submitted?'unknown':'not_sent'),code=error.code||'request_failed';
 const status=outcome==='unknown'?'needs_review':['existing_appointment','parameters_changed','portal_preflight_rejected'].includes(code)?'blocked':code==='slot_unavailable'?'active':'error';
 const message=outcome==='unknown'?'Не удалось подтвердить результат запроса записи. Проверьте картотеку; автоматический повтор остановлен.':code==='slot_unavailable'?'Талон уже недоступен. Продолжаем поиск.':status==='blocked'?(error.message||'Портал не разрешил запись на выбранный талон.'):'Запрос записи не отправлялся: не удалось завершить проверку. Повторим через минуту.';
 return {...rule,status,slots:[],message,checkedAt:new Date(now).toISOString(),lastBookingAttempt:{...(rule.lastBookingAttempt||{}),outcome,code,stage:error.stage||(submitted?'submit':'prepare'),httpStatus:error.httpStatus||null,portalNotice:error.portalNotice||null,at:new Date(now).toISOString()}};
}
export function matchesBookedSlot(appointment,slot){
 return appointment.personId===slot.personId&&appointment.status==='active'&&appointment.doctorId===slot.doctorId&&Boolean(appointment.startsAt)&&Date.parse(appointment.startsAt)===Date.parse(slot.startsAt);
}
