import test from 'node:test';import assert from 'node:assert/strict';
import {PortalAccount} from '../server/adapter.mjs';import {parseAppointments,portalDate} from '../server/parsers.mjs';import {BookingError,bookingFailure,matchesBookedSlot} from '../server/booking-state.mjs';import {runRule} from '../server/domain.mjs';
const now=Date.parse('2030-11-01T00:00:00Z');
const rule={id:'r',accountId:'a',personId:'1',clinicId:'c',specialtyId:'17',doctorIds:['9'],weekdays:[0,1,2,3,4,5,6],dateFrom:'2030-11-01',dateTo:'2030-12-01',timeFrom:'08:00',timeTo:'20:00',autoBook:true,status:'active'};
const slot={id:'100000',personId:'1',doctorId:'9',doctorName:'Врач',clinicId:'c',specialtyId:'17',startsAt:'2030-11-20T10:30:00+08:00'};
const cards='<dd id="cur_records_1"><div class="serviceWrapper"><div class="serviceContent"><li class="doc"><a href="/service/record/1/0/17/doctors">Педиатр</a><a href="/service/record/1/9/timetable">Врач</a></li><li class="date">20 ноября 2030, среда 10:30</li><a class="btnCancelRecord" rel="200000">Отмена</a></div></div></dd>';
const info={Person_id:'1',MedStaffFact_id:'9',TimetableGraf_id:'100000',TimeTableType_id:'1'};
function fake({prepareFailure=null,submitFailure=null,unavailable=false,vanishAfterDiscovery=false,confirmation='ok',infoChange={}}={}){
 const p=new PortalAccount({}),calls=[];let submitted=false,reads=0,slotReads=0;
 p.appointments=async()=>{if(!submitted)return [];reads++;if(confirmation==='none'||confirmation==='late'&&reads===1)return [];if(confirmation==='failure')throw Error('Cards unavailable');return parseAppointments(cards,'1');};
 p.slots=async()=>{slotReads++;return unavailable||vanishAfterDiscovery&&slotReads>1?[]:[slot];};
 p.request=async(path,options)=>{calls.push(path);if(path.endsWith('getRegAgreeRecordData')){if(prepareFailure)throw prepareFailure;return JSON.stringify({...info,...infoChange});}if(path.includes('/record?')){if(submitFailure)throw submitFailure;submitted=true;return '<p>Переход в картотеку</p>';}throw Error('Unexpected request');};
 const book=p.book.bind(p);p.book=(r,s,options)=>book(r,s,{...options,confirmationDelayMs:0});return {p,calls,get submitted(){return submitted;}};
}
test('Russian appointment dates and distinct portal record IDs confirm the chosen slot',async()=>{
 assert.equal(portalDate('20 ноября 2030, среда 10:30'),slot.startsAt);assert.equal(portalDate('2 января 2030, среда 9:05'),'2030-01-02T09:05:00+08:00');
 const f=fake();let marked=false;const result=await f.p.book(rule,slot,{beforeSubmit:()=>marked=true});assert.equal(marked,true);assert.equal(result.confirmed,true);assert.notEqual(result.appointment.portalAppointmentId,slot.id);assert.equal(f.calls.filter(x=>x.includes('/record?')).length,1);
});
test('vanished candidate never marks booking or sends a booking request',async()=>{
 const f=fake({unavailable:true});let marked=false;await assert.rejects(f.p.book(rule,slot,{beforeSubmit:()=>marked=true}),e=>e.code==='slot_unavailable'&&e.outcome==='not_sent');assert.equal(marked,false);assert.equal(f.calls.length,0);
});
test('preflight network error and changed parameters do not stop as an ambiguous mutation',async()=>{
 for(const options of [{prepareFailure:new Error('Timeout')},{infoChange:{TimetableGraf_id:'different'}}]){const f=fake(options);let marked=false;await assert.rejects(f.p.book(rule,slot,{beforeSubmit:()=>marked=true}),e=>e.outcome==='not_sent');assert.equal(marked,false);assert.equal(f.submitted,false);}
});
test('failed durable marker aborts before the remote mutation',async()=>{
 const f=fake();await assert.rejects(f.p.book(rule,slot,{beforeSubmit:()=>{throw Error('Storage failed');}}));assert.equal(f.calls.some(x=>x.includes('/record?')),false);
});
test('uncertain mutation is never automatically retried',async()=>{
 const f=fake({submitFailure:new Error('Network timed out')});await assert.rejects(f.p.book(rule,slot),e=>e.code==='submit_failed'&&e.outcome==='unknown'&&e.stage==='submit');assert.equal(f.calls.filter(x=>x.includes('/record?')).length,1);
});
test('confirmation retries only reads and can recognize a delayed portal update',async()=>{
 const f=fake({confirmation:'late'});const result=await f.p.book(rule,slot);assert.equal(result.confirmed,true);assert.equal(f.calls.filter(x=>x.includes('/record?')).length,1);
});
test('missing confirmation and failed verification stop without resubmitting',async()=>{
 for(const confirmation of ['none','failure']){const f=fake({confirmation});await assert.rejects(f.p.book(rule,slot),e=>e.outcome==='unknown'&&e.stage==='confirm');assert.equal(f.calls.filter(x=>x.includes('/record?')).length,1);}
});
test('autobook success persists marker only after preflight and sends success push once',async()=>{
 const f=fake(),saved=[],push=[];await runRule(rule,{now,portal:f.p,save:r=>saved.push(r),notify:m=>push.push(m)});assert.deepEqual(saved.map(r=>r.status),['booking','booked']);assert.equal(push.length,1);assert.equal(push[0].title,'Вы записаны к врачу');
});
test('autobook resumes search after preflight failure, but unknown mutations stop',async()=>{
 for(const [options,status,stage] of [[{vanishAfterDiscovery:true},'active','availability'],[{prepareFailure:Error('Timeout')},'error','prepare'],[{submitFailure:Error('Timeout')},'needs_review','submit']]){const f=fake(options);let saved;await runRule(rule,{now,portal:f.p,save:r=>saved=r,notify:()=>assert.fail()});assert.equal(saved.status,status);assert.equal(saved.lastBookingAttempt.stage,stage);}
});
test('booking confirmation requires exact person, doctor and date',()=>{
 const appointment=parseAppointments(cards,'1')[0];assert.equal(matchesBookedSlot(appointment,slot),true);
 for(const change of [{doctorId:'8'},{personId:'2'},{startsAt:null},{startsAt:'2030-11-21T10:30:00+08:00'}])assert.equal(matchesBookedSlot({...appointment,...change},slot),false);
 const error=new BookingError('preflight_failed','not_sent','prepare','',Object.assign(Error('HTTP'),{status:503}));assert.equal(bookingFailure(rule,error).lastBookingAttempt.httpStatus,503);
});
