import test from 'node:test';
import assert from 'node:assert/strict';
import {formatInputDate,parseInputDate} from '../src/date-picker.mjs';
test('Russian dates round trip without swapping month and day',()=>{
 assert.equal(formatInputDate('2026-11-14'),'14.11.2026');
 assert.equal(parseInputDate('05.12.2026'),'2026-12-05');
 assert.equal(parseInputDate('29.02.2024'),'2024-02-29');
 for(const value of ['29.02.2026','31.04.2026','12.31.2026','','2026-11-14'])assert.equal(parseInputDate(value),'');
});
