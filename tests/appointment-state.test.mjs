import test from 'node:test';
import assert from 'node:assert/strict';
import {hasAppointmentConflict} from '../src/appointment-state.mjs';
import {createAppointmentsDialog} from '../src/appointments-dialog.mjs';

test('form conflict belongs to the selected person and an active future appointment',()=>{
 const selected={personId:'1',specialtyId:'s'},now=Date.parse('2030-01-01T00:00:00Z');
 const record={personId:'1',specialtyId:'s',status:'active',startsAt:'2030-01-02T10:00:00+08:00'};
 assert.equal(hasAppointmentConflict(selected,[record],now),true);
 for(const change of [{personId:'2'},{specialtyId:'other'},{status:'cancelled'},{startsAt:'2029-12-31T10:00:00+08:00'}])assert.equal(hasAppointmentConflict(selected,[{...record,...change}],now),false);
 assert.equal(hasAppointmentConflict({...selected,specialtyId:''},[{...record,specialtyId:'*'}],now),false);
 assert.equal(hasAppointmentConflict(selected,[{...record,specialtyId:'*',startsAt:null}],now),true);
 assert.equal(hasAppointmentConflict(selected,[],now),false);
});

test('opening and refreshing the appointment dialog updates the form even when the list is empty',async()=>{
 const original=globalThis.document,handlers={},changes=[];
 const dialog={setAttribute(){},addEventListener(type,handler){handlers[type]=handler;},showModal(){this.open=true;},querySelector(){return null;}};
 globalThis.document={createElement:()=>dialog,body:{append(){}},activeElement:null};
 try{
  let records=[{id:'record',personId:'1',status:'active'}];
  const ui=createAppointmentsDialog({api:async path=>path.endsWith('/people')?[{id:'1',name:'Person'}]:records,post:()=>assert.fail('No mutation expected'),formatDate:String,onChanged:context=>changes.push(context)});
  await ui.open({accounts:[{id:'a'}],accountId:'a',personId:'1'});
  assert.deepEqual(changes,[{accountId:'a',personId:'1',appointments:records}]);
  records=[];
  await handlers.click({target:{closest:()=>({dataset:{dialog:'refresh'}})}});
  assert.deepEqual(changes.at(-1),{accountId:'a',personId:'1',appointments:[]});
 }finally{globalThis.document=original;}
});
