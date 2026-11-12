export function hasAppointmentConflict(selection,appointments,now=Date.now()){
 if(!selection.personId||!selection.specialtyId)return false;
 return appointments.some(a=>a.personId===selection.personId&&a.status==='active'&&(a.specialtyId===selection.specialtyId||a.specialtyId==='*')&&(!a.startsAt||Date.parse(a.startsAt)>now));
}
