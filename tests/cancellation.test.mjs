import test from 'node:test';import assert from 'node:assert/strict';
import {PortalAccount} from '../server/adapter.mjs';
import {parseAppointments,publicAppointment} from '../server/parsers.mjs';
import {rulesToPause,isBookedAppointment} from '../server/cancellation.mjs';
const record=({id='123',source='pm_main',person='1',spec='17',doctor='999',kind='record',disabled=false,button=true}={})=>`<div class="service order"><div class="serviceWrapper"><div class="serviceContent" data-source_system="${source}"><div class="place"><ul><li class="doc"><a href="/service/record/${person}/0/${spec}/doctors">Педиатр</a><a href="/service/record/${person}/${doctor}/timetable">Тестовый врач</a></li><li class="lpu">Тестовая поликлиника</li><li class="date">20.11.2030 ср 10:30</li></ul></div><a class="btnPrintRecord" rel="${id}">Печать</a>${button?`<a class="${kind==='record'?'btnCancelRecord':'btnCancelRecordMedservice'}${disabled?' disabled':''}" rel="${id}">Отменить</a>`:''}</div></div></div>`;
const page=(records='',csrf=true)=>`${csrf?'<meta name="csrf-token" content="test-csrf-token">':''}<dd id="cur_records_1">${records}</dd><dd id="cur_records_2"></dd>`;
function mockPortal({kind='record',after='',response='{}',csrf=true}={}){
 const before=page(record({kind}),csrf),portal=new PortalAccount({});let requests=0;const calls=[];
 portal.assertPerson=async id=>{if(id!=='1')throw Error('Человек не найден');};
 portal.cards=async()=>requests? page(after):before;
 portal.appointments=async id=>parseAppointments(await portal.cards(),id);
 portal.request=async(path,options)=>{requests++;calls.push({path,options});if(response instanceof Error)throw response;return response;};
 return {portal,calls,id:parseAppointments(before,'1')[0].id};
}
test('each active appointment has its own identity and exact specialty',()=>{
 const records=parseAppointments(page(record()+record({id:'124',spec:'22'})),'1');
 assert.equal(records.length,2);assert.notEqual(records[0].id,records[1].id);assert.deepEqual(records.map(a=>a.specialtyId),['17','22']);
 assert.equal(records[0].doctorId,'999');assert.equal(records[0].startsAt,'2030-11-20T10:30:00+08:00');assert.equal(records[0].canCancel,true);
 assert.equal(records[0].clinicName,'Тестовая поликлиника');
 const visible=publicAppointment(records[0]);for(const key of ['portalRecordId','sourceSystem','cancelKind'])assert.equal(key in visible,false);
});
test('disabled or absent cancel buttons cannot be used, print button only identifies',()=>{
 const disabled=parseAppointments(page(record({disabled:true})),'1')[0],noButton=parseAppointments(page(record({button:false})),'1')[0];
 assert.equal(disabled.canCancel,false);assert.equal(noButton.canCancel,false);assert.equal(noButton.portalRecordId,'123');assert.equal(noButton.id,disabled.id);
});
test('record from another person never supplies this person specialty or doctor',()=>{
 const a=parseAppointments(page(record({person:'2'})),'1')[0];assert.equal(a.specialtyId,'*');assert.equal(a.doctorId,null);assert.equal(a.canCancel,false);
});
test('cancel request uses portal-owned record ID, source and CSRF and verifies absence',async()=>{
 const {portal,calls,id}=mockPortal();const result=await portal.cancelAppointment('1',id);
 assert.equal(calls.length,1);assert.equal(calls[0].path,'/service/record/cancelRecord/123');assert.equal(calls[0].options.method,'POST');
 assert.equal(calls[0].options.body.get('csrf'),'test-csrf-token');assert.equal(calls[0].options.body.get('source_system'),'pm_main');assert.deepEqual(result.appointments,[]);
});
test('alternate medservice cancellation uses its own endpoint',async()=>{
 const {portal,calls,id}=mockPortal({kind:'medservice'});await portal.cancelAppointment('1',id);
 assert.equal(calls[0].path,'/service/record/cancelRecordMedservice/123');assert.equal(calls[0].options.body.has('source_system'),false);
});
test('unknown appointment, wrong person and missing CSRF never send mutation',async()=>{
 for(const which of ['unknown','person','csrf']){const {portal,calls,id}=mockPortal({csrf:which!=='csrf'});await assert.rejects(portal.cancelAppointment(which==='person'?'2':'1',which==='unknown'?'not-found':id));assert.equal(calls.length,0);}
});
test('disabled cancellation is rejected before remote request',async()=>{
 const {portal,calls}=mockPortal();portal.cards=async()=>page(record({disabled:true}));const id=parseAppointments(await portal.cards(),'1')[0].id;
 await assert.rejects(portal.cancelAppointment('1',id));assert.equal(calls.length,0);
});
test('portal rejection, persistent record and uncertain network result never confirm cancellation',async()=>{
 for(const options of [{response:'{"success":false}'},{after:record()},{after:record({button:false})},{response:new Error('Network timed out')}]){
  const {portal,calls,id}=mockPortal(options);await assert.rejects(portal.cancelAppointment('1',id));assert.equal(calls.length,1);
 }
});
test('pauses only related person, account and specialty; unknown specialty pauses all for person',()=>{
 const rules=[{id:'1',accountId:'a',personId:'1',specialtyId:'17',status:'active',slots:[{}]},{id:'2',accountId:'a',personId:'2',specialtyId:'17',status:'active'},{id:'3',accountId:'b',personId:'1',specialtyId:'17',status:'active'},{id:'4',accountId:'a',personId:'1',specialtyId:'22',status:'active'},{id:'5',accountId:'a',personId:'1',specialtyId:'17',status:'booked'}];
 const changes=rulesToPause(rules,'a',{personId:'1',specialtyId:'17'});assert.deepEqual(changes.map(r=>r.id),['1']);assert.equal(changes[0].status,'paused');assert.deepEqual(changes[0].slots,[]);
 assert.deepEqual(rulesToPause(rules,'a',{personId:'1',specialtyId:'*'}).map(r=>r.id),['1','4']);assert.equal(rules[0].status,'active');
});
test('booked history changes only when exact doctor and date match',()=>{
 const r={accountId:'a',personId:'1',status:'booked',appointment:{doctorId:'9',startsAt:'2030-11-20T10:30:00+08:00'}},a={personId:'1',doctorId:'9',startsAt:'2030-11-20T02:30:00Z'};
 assert.equal(isBookedAppointment(r,'a',a),true);assert.equal(isBookedAppointment(r,'b',a),false);assert.equal(isBookedAppointment(r,'a',{...a,doctorId:'8'}),false);assert.equal(isBookedAppointment(r,'a',{...a,startsAt:null}),false);
});
