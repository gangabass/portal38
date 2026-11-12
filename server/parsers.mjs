import {load} from 'cheerio';
import {createHash} from 'node:crypto';
export const text = s => String(s||'').replace(/\s+/g,' ').trim();
export function portalDate(s) {
  let m=String(s||'').match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if(m)return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]||'00'}+08:00`;
  m=String(s||'').match(/(\d{2})\.(\d{2})\.(\d{4}).*?(\d{2}):(\d{2})/);
  return m?`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:00+08:00`:null;
}
export function parsePeople(html) {
  const $=load(html),people=[];
  $('.header').each((i,e)=>{const href=$(e).find('a[href$="/profiles"]').attr('href'),id=href?.match(/record\/(\d+)\/profiles$/)?.[1];if(id){
    const person={id,name:text($(e).find('h2').text())};
    const link=$(e).next('.inner').find('p a[href*="/service/hospitals/view/"]').first();
    const hospitalId=link.attr('href')?.match(/\/(\d+)$/)?.[1];
    if(hospitalId)person.attachedClinic={hospitalId,name:text(link.text())};
    people.push(person);
  }});
  return people;
}
export function parseSpecialties(html) {
  const $=load(html),map=new Map();
  $('a[href]').each((i,e)=>{const m=$(e).attr('href').match(/record\/\d+\/0\/(\d+)\/doctors$/);if(m)map.set(m[1],{id:m[1],name:text($(e).text())});});
  return [...map.values()];
}
export function parseDoctors(html) {
  const $=load(html),doctors=[];
  $('.doc-row').each((i,e)=>{const row=$(e),header=row.prevAll('.docsInLpuTableDescr').first(),a=row.find('.doc-name a'),id=row.attr('data-medstafffact_id');
    if(!id || row.hasClass('row-isPays') || row.find('.isPays i.paid').length)return;
    const address=text(header.find('.lpu-address').text()),hospitalId=header.find('a[href]').attr('href')?.match(/\/(\d+)$/)?.[1];
    if(!hospitalId)throw Error('Не удалось определить поликлинику врача. Формат портала изменился.');
    const name=text(header.find('a').first().text());
    const clinic={id:`${hospitalId}-${createHash('sha256').update(address||`unit:${name}`).digest('hex').slice(0,12)}`,hospitalId,name,address};
    doctors.push({id,name:text(a.text()),clinic,url:a.attr('href'),specialtyName:text(row.find('.profile').text())});
  }); return doctors;
}
export function parseSlots(html,rule,doctor) {
  const $=load(html),slots=[];
  if(!$('.timeTable').length)throw Error('Календарь врача недоступен или формат страницы изменился.');
  // Never assume that a timetable belongs to the chosen clinic.
  const address=text($('.lpuAddr').first().text());
  if(!doctor.clinic.address)throw Error('У выбранного отделения на портале не указан адрес. Требуется проверка поликлиники.');
  if(!address || normalizeAddress(address)!==normalizeAddress(doctor.clinic.address))throw Error('Адрес календаря отличается от выбранной поликлиники. Требуется проверка.');
  $('td.free[data-timetablegraf_id]').each((i,e)=>{const a=$(e).attr(),startsAt=portalDate(a['data-timetablegraf_begtime']);
    if(a['data-person_id']!==rule.personId||a['data-medstafffact_id']!==doctor.id||!startsAt)return;
    // Only ordinary in-person appointments; remote consultations need additional consent fields.
    if(a['data-timetabletype_id']!=='1')return;
    slots.push({id:a['data-timetablegraf_id'],personId:rule.personId,doctorId:doctor.id,doctorName:doctor.name,clinicId:doctor.clinic.id,specialtyId:rule.specialtyId,startsAt,url:doctor.url});
  });return slots;
}
export function parseAppointments(html,personId,specialties=[]) {
  if(!/^\d+$/.test(personId)&&!/^p\d+$/.test(personId))throw Error('Некорректный идентификатор человека.');
  const $=load(html),container=$('#cur_records_'+personId);
  if(!container.length)throw Error('Не удалось получить текущие записи человека.');
  const content=text(container.text());if(!content)return [];
  const wrappers=container.find('.serviceWrapper').toArray();
  const records=(wrappers.length?wrappers:[container[0]]).map(e=>{
    const row=$(e),service=row.find('.serviceContent').first();
    const links=row.find('.doc a[href]');
    let specialtyId=null,doctorId=null,specialtyName='',doctorName='';
    links.each((i,a)=>{const href=$(a).attr('href'),spec=href.match(/record\/(\d+)\/0\/(\d+)\/doctors(?:[?#]|$)/),doc=href.match(/record\/(\d+)\/(\d+)\/timetable(?:[?#]|$)/);
      if(spec&&spec[1]===personId){specialtyId=spec[2];specialtyName=text($(a).text());}
      if(doc&&doc[1]===personId){doctorId=doc[2];doctorName=text($(a).text());}
    });
    if(!doctorName)doctorName=text(links.not('[href*="/doctors"]').last().text());
    const summary=text(row.text());
    if(!specialtyId){const found=specialties.filter(s=>summary.toLocaleLowerCase('ru').includes(s.name.toLocaleLowerCase('ru')));if(found.length===1){specialtyId=found[0].id;specialtyName=found[0].name;}}
    const button=row.find('.btnCancelRecord, .btnCancelRecordMedservice').first();
    const portalRecordId=button.attr('rel')||row.find('.btnPrintRecord[rel],.btnEditNotify[rel],.notify_info[rel],.more[rel]').first().attr('rel')||null;
    const cancelKind=button.hasClass('btnCancelRecordMedservice')?'medservice':'record';
    const sourceSystem=service.attr('data-source_system')||'';
    const validId=/^\d+$/.test(portalRecordId||'');
    const personLinks=row.find('a[href]').map((i,a)=>$(a).attr('href').match(/\/service\/record\/(\d+)\//)?.[1]).get().filter(Boolean);
    const belongsToPerson=personLinks.every(id=>id===personId);
    const disabled=button.hasClass('disabled')||button.is('[disabled]')||button.attr('aria-disabled')==='true';
    const dateLabel=text(row.find('.date').first().text());
    const startsAt=portalDate(dateLabel);
    const id=createHash('sha256').update([personId,cancelKind,sourceSystem,portalRecordId||summary].join(':')).digest('hex');
    return {id,personId,specialtyId:specialtyId||'*',specialtyName,doctorId,doctorName,clinicName:text(row.find('.lpu').first().text()),dateLabel,startsAt,status:'active',summary,unclassified:!specialtyId,canCancel:button.length>0&&validId&&!disabled&&belongsToPerson,portalRecordId,cancelKind,sourceSystem};
  });
  return records;
}
export function publicAppointment(a){
  const {portalRecordId,cancelKind,sourceSystem,...result}=a;return result;
}
export function normalizeAddress(value) {
  const aliases={'корп':'корпус','к':'корпус','пр':'проспект','пркт':'проспект','пер':'переулок','стр':'строение'};
  return String(value||'').toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/пр-кт/g,'проспект').split(/[^\p{L}\p{N}]+/u).filter(t=>t&&!['г','город','ул','улица','д','дом'].includes(t)).map(t=>aliases[t]||t).join(' ');
}
