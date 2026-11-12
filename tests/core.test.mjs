import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {matches,selectSlots,conflicts,validateRule,runRule} from '../server/domain.mjs';import {Store} from '../server/store.mjs';
import {parsePeople,parseDoctors,parseSpecialties,parseSlots,parseAppointments,portalDate} from '../server/parsers.mjs';
const now=Date.parse('2030-01-01T00:00:00Z');
const rule={id:'r1',accountId:'a1',personId:'p1',clinicId:'c1',specialtyId:'s1',doctorIds:[],weekdays:[1,2,3,4,5],dateFrom:'2030-01-01',dateTo:'2030-01-31',timeFrom:'09:00',timeTo:'18:00',autoBook:false,status:'active'};
const slot={id:'t1',personId:'p1',clinicId:'c1',specialtyId:'s1',doctorId:'d1',doctorName:'Врач',startsAt:'2030-01-02T10:00:00+08:00'};
test('filters by person, clinic, specialty, doctor, weekday and Irkutsk time',()=>{
 assert.equal(matches(rule,slot,now),true);
 for(const change of [{personId:'p2'},{clinicId:'c2'},{specialtyId:'s2'},{startsAt:'2030-01-02T19:00:00+08:00'},{startsAt:'2030-01-05T10:00:00+08:00'},{startsAt:'2029-12-31T10:00:00+08:00'}])assert.equal(matches(rule,{...slot,...change},now),false);
 assert.equal(matches({...rule,doctorIds:['other']},slot,now),false);
 assert.equal(matches(rule,{...slot,startsAt:'2030-01-02T02:00:00Z'},now),true);
});
test('selects earliest among all doctors, without string timezone sorting',()=>{
 const early={...slot,id:'early',startsAt:'2030-01-02T01:00:00Z'},late={...slot,id:'late',startsAt:'2030-01-02T11:00:00+08:00'};
 assert.deepEqual(selectSlots(rule,[late,early],now).map(s=>s.id),['early','late']);
});
test('same specialty conflicts even with different requested doctor and clinic',()=>{
 const appointment={...slot,status:'active',clinicId:'other',doctorId:'other'};
 assert.equal(conflicts({...rule,doctorIds:['d1']},[appointment],now).length,1);
 assert.equal(conflicts(rule,[{...appointment,personId:'p2'}],now).length,0);
 assert.equal(conflicts(rule,[{...appointment,specialtyId:'*'}],now).length,1);
});
test('rejects malformed dates, empty weekdays and backwards time',()=>{
 assert.doesNotThrow(()=>validateRule(rule));
 for(const change of [{dateFrom:'2030-02-30'},{weekdays:[]},{timeTo:'07:00'},{autoBook:'false'}])assert.throws(()=>validateRule({...rule,...change}));
});
test('blocked rule never fetches slots or books',async()=>{
 const saved=[];await runRule(rule,{now,portal:{appointments:async()=>[{...slot,status:'active'}],slots:()=>assert.fail(),book:()=>assert.fail()},save:r=>saved.push(r),notify:()=>assert.fail()});assert.equal(saved[0].status,'blocked');
});
test('manual rule displays every slot and only notifies new ones',async()=>{
 const saved=[],notifications=[];await runRule(rule,{now,previousIds:['t1'],portal:{appointments:async()=>[],slots:async()=>[slot,{...slot,id:'t2'}]},save:r=>saved.push(r),notify:m=>notifications.push(m)});
 assert.equal(saved[0].slots.length,2);assert.equal(notifications.length,1);assert.match(notifications[0].body,/1/);
});
test('booking state is persisted before mutation, success stops rule',async()=>{
 const saved=[],booked=[];await runRule({...rule,autoBook:true},{now,portal:{appointments:async()=>[],slots:async()=>[slot,{...slot,id:'later',startsAt:'2030-01-03T10:00:00+08:00'}],book:async(r,s,{beforeSubmit})=>{await beforeSubmit(s);assert.equal(saved.at(-1).status,'booking');booked.push(s.id);return {confirmed:true,appointment:s};}},save:r=>saved.push(r),notify:()=>{}});
 assert.deepEqual(booked,['t1']);assert.equal(saved.at(-1).status,'booked');
});
test('ambiguous booking result stops automatic retries',async()=>{
 let saved;await runRule({...rule,autoBook:true},{now,portal:{appointments:async()=>[],slots:async()=>[slot],book:async()=>({confirmed:false})},save:r=>saved=r,notify:()=>assert.fail()});assert.equal(saved.status,'needs_review');
});
test('encrypted database persists without plaintext and authenticates metadata',()=>{
 const dir=mkdtempSync(join(tmpdir(),'portal38-'));try{const store=new Store(dir,'ab'.repeat(32));store.put('accounts','a1',{password:'a-unique-secret',person:'private-name'});assert.equal(store.get('accounts','a1').password,'a-unique-secret');assert.equal(readFileSync(join(dir,'portal38.db-wal')).includes(Buffer.from('a-unique-secret')),false);const row=store.db.prepare('SELECT value FROM objects').get();assert.throws(()=>store.decode('accounts','different',row.value));store.db.close();const reopened=new Store(dir,'ab'.repeat(32));assert.equal(reopened.get('accounts','a1').person,'private-name');reopened.db.close();}finally{rmSync(dir,{recursive:true,force:true});}
});
test('people and specialties use string IDs and deduplicate',()=>{
 assert.deepEqual(parsePeople('<div class="header"><h2>Тестовый человек</h2><a href="/service/record/9999999999999999999/profiles"></a></div>'),[{id:'9999999999999999999',name:'Тестовый человек'}]);
 assert.equal(parseSpecialties('<a href="/service/record/1/0/2/doctors">Невролог</a><a href="/service/record/1/0/2/doctors">Невролог</a>').length,1);
});
test('clinic is identified by hospital and address; slots require exact person and ordinary type',()=>{
 const doctors=parseDoctors('<div class="docsInLpuTableDescr"><a href="/service/hospitals/view/12">Клиника</a><span class="lpu-address">Тестовая, 1</span></div><div class="doc-row" data-medstafffact_id="d1"><span class="doc-name"><a href="/service/record/p1/d1/timetable">Врач</a></span></div>');assert.equal(doctors.length,1);
 const make=(person='p1',type='1')=>`<span class="lpuAddr">Тестовая, 1</span><table class="timeTable"><tr><td class="free" data-timetablegraf_id="12" data-person_id="${person}" data-medstafffact_id="d1" data-timetabletype_id="${type}" data-timetablegraf_begtime="2030-01-02 10:00:00"></td></tr></table>`;
 assert.equal(parseSlots(make(),rule,doctors[0]).length,1);assert.equal(parseSlots(make('p2'),rule,doctors[0]).length,0);assert.equal(parseSlots(make('p1','13'),rule,doctors[0]).length,0);
 assert.throws(()=>parseSlots(make().replace('Тестовая, 1','Другая, 2'),rule,doctors[0]));
});
test('unknown current appointments block booking instead of silently allowing it',()=>{
 assert.equal(parseAppointments('<dd id="cur_records_p1"><div>Неизвестная запись</div></dd>','p1')[0].specialtyId,'*');
 assert.deepEqual(parseAppointments('<dd id="cur_records_p1"></dd>','p1'),[]);assert.throws(()=>parseAppointments('<p>Sign in</p>','p1'));
 assert.equal(portalDate('2030-01-02 10:15:00.000'),'2030-01-02T10:15:00+08:00');
});
import {normalizeAddress} from '../server/parsers.mjs';
test('portal address variants normalize without merging different buildings',()=>{
 assert.equal(normalizeAddress('ИРКУТСК, БАУМАНА, 206'),normalizeAddress('г Иркутск, ул Баумана, д 206'));
 assert.notEqual(normalizeAddress('Иркутск, Баумана, 206'),normalizeAddress('г Иркутск, ул Баумана, д 206, корп а'));
});
test('expired rules stop checking the portal',async()=>{
 let saved;await runRule({...rule,dateTo:'2029-12-31'},{now,portal:{appointments:()=>assert.fail()},save:r=>saved=r,notify:()=>assert.fail()});assert.equal(saved.status,'expired');assert.deepEqual(saved.slots,[]);
});
import {clinicOptions,defaultClinicId} from '../src/clinic-selection.mjs';
test('people carry their own attached hospital from the adjacent card only',()=>{
 const html='<div><div class="header"><h2>Первый</h2><a href="/service/record/1/profiles"></a></div><div class="inner"><p><a href="/service/hospitals/view/12">Поликлиника 12</a></p></div></div><div><div class="header"><h2>Второй</h2><a href="/service/record/2/profiles"></a></div><div class="inner"><p><a href="/service/hospitals/view/34">Поликлиника 34</a></p></div></div>';
 assert.deepEqual(parsePeople(html).map(p=>p.attachedClinic.hospitalId),['12','34']);
});
test('one missing clinic address does not discard the complete specialty list',()=>{
 const group=(id,name,address,doctor)=>`<div class="Lpuunit"><div class="docsInLpuTableDescr"><a href="/service/hospitals/view/${id}">${name}</a><span class="lpu-address">${address}</span></div><div class="doc-row" data-medstafffact_id="${doctor}"><span class="doc-name"><a href="/service/record/1/${doctor}/timetable">Врач</a></span></div></div>`;
 const ds=parseDoctors(group('12','Прикреплённая','Тестовая, 1','101')+group('34','Отделение А','','102')+group('34','Отделение Б','','103'));
 assert.equal(ds.length,3);assert.equal(ds[1].clinic.address,'');assert.notEqual(ds[1].clinic.id,ds[2].clinic.id);
});
test('attached clinic is preselected over other clinics regardless of order',()=>{
 const people=[{id:'1',attachedClinic:{hospitalId:'12',name:'Своя поликлиника'}},{id:'2',attachedClinic:{hospitalId:'34',name:'Другая'}}];
 const doctors=[{clinic:{id:'other',hospitalId:'34',name:'Другая',address:'Б, 2'}},{clinic:{id:'own',hospitalId:'12',name:'Своя',address:'А, 1'}}];
 assert.equal(defaultClinicId(people,'1',doctors),'own');assert.equal(defaultClinicId(people,'2',doctors),'other');
 assert.equal(clinicOptions(people,'1',doctors)[0].id,'own');
 assert.equal(defaultClinicId(people,'1',[]),'attached-12');
 assert.equal(defaultClinicId([{id:'3'}],'3',doctors),'');
});
