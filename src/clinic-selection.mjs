// Keep the attachment visible even if this specialty is unavailable there.
export function clinicOptions(people,personId,doctors){
  const attached=people.find(p=>p.id===personId)?.attachedClinic;
  const clinics=[...new Map(doctors.map(d=>[d.clinic.id,{...d.clinic,attached:d.clinic.hospitalId===attached?.hospitalId}])).values()];
  if(attached&&!clinics.some(c=>c.attached))clinics.unshift({id:`attached-${attached.hospitalId}`,hospitalId:attached.hospitalId,name:attached.name,address:'',attached:true});
  return clinics.sort((a,b)=>Number(b.attached)-Number(a.attached));
}
export function defaultClinicId(people,personId,doctors){
  return clinicOptions(people,personId,doctors).find(c=>c.attached)?.id||'';
}
