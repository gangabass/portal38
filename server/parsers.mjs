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
  $('.header').each((i,e)=>{const href=$(e).find('a[href$="/profiles"]').attr('href'),id=href?.match(/record\/(\d+)\/profiles$/)?.[1];if(id)people.push({id,name:text($(e).find('h2').text())});});
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
    if(!hospitalId||!address)throw Error('Не удалось определить поликлинику врача. Формат портала изменился.');
    const clinic={id:`${hospitalId}-${createHash('sha256').update(address).digest('hex').slice(0,12)}`,hospitalId,name:text(header.find('a').first().text()),address};
    doctors.push({id,name:text(a.text()),clinic,url:a.attr('href'),specialtyName:text(row.find('.profile').text())});
  }); return doctors;
}
export function parseSlots(html,rule,doctor) {
  const $=load(html),slots=[];
  if(!$('.timeTable').length)throw Error('Календарь врача недоступен или формат страницы изменился.');
  // Never assume that a timetable belongs to the chosen clinic.
  const address=text($('.lpuAddr').first().text());
  if(!address || normalizeAddress(address)!==normalizeAddress(doctor.clinic.address))throw Error('Адрес календаря отличается от выбранной поликлиники. Требуется проверка.');
  $('td.free[data-timetablegraf_id]').each((i,e)=>{const a=$(e).attr(),startsAt=portalDate(a['data-timetablegraf_begtime']);
    if(a['data-person_id']!==rule.personId||a['data-medstafffact_id']!==doctor.id||!startsAt)return;
    // Only ordinary in-person appointments; remote consultations need additional consent fields.
    if(a['data-timetabletype_id']!=='1')return;
    slots.push({id:a['data-timetablegraf_id'],personId:rule.personId,doctorId:doctor.id,doctorName:doctor.name,clinicId:doctor.clinic.id,specialtyId:rule.specialtyId,startsAt,url:doctor.url});
  });return slots;
}
export function parseAppointments(html,personId,specialties=[]) {
  const $=load(html),container=$(`#cur_records_${personId}`);
  if(!container.length)throw Error('Не удалось получить текущие записи человека.');
  const content=text(container.text());if(!content)return [];
  const normalized=content.toLocaleLowerCase('ru');
  const found=specialties.filter(s=>normalized.includes(s.name.toLocaleLowerCase('ru')));
  // Unrecognized current records block new booking until their specialty can be established.
  return [{personId,specialtyId:found.length===1?found[0].id:'*',status:'active',startsAt:null,summary:content,unclassified:found.length!==1}];
}
export function normalizeAddress(value) {
  const aliases={'корп':'корпус','к':'корпус','пр':'проспект','пркт':'проспект','пер':'переулок','стр':'строение'};
  return String(value||'').toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/пр-кт/g,'проспект').split(/[^\p{L}\p{N}]+/u).filter(t=>t&&!['г','город','ул','улица','д','дом'].includes(t)).map(t=>aliases[t]||t).join(' ');
}
