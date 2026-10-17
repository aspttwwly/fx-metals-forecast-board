import test from 'node:test';
import assert from 'node:assert/strict';
import {versionedView} from '../src/forecast-versions.js';
import {forecastCsv} from '../src/forecast-frequency.js';

const fixture=()=>({symbol:'AUDUSD',series:[],rollingReference:{monthly:{
  modelVersion:'V0.1.2',policyVersion:'test-rolling',runId:'monthly-only',issuedAt:'2026-10-01T12:00:00+08:00',
  sourceDataCutoff:'2026-09-30',latestActual:{date:'2026-09-30',value:100},selection:{decision:'KEEP_OLD'},
  series:Array.from({length:13},(_,h)=>({date:new Date(Date.UTC(2026,9+h,0)).toISOString().slice(0,10),
    horizon:h,forecast:100+h,actual:h===0?100:null,future:h>0}))}}});

test('rolling display slices the full frozen monthly path and never inherits old metrics',()=>{
  const base=fixture();base.forecastEvidence={current:{mae:.01}};const frozen=JSON.stringify(base);
  const short=versionedView(base,null,'V0.1.2','monthly',3,'backtest',1);
  const long=versionedView(base,null,'V0.1.2','monthly',12,'issued',3);
  assert.deepEqual(short.series,long.series.slice(0,4));
  assert.deepEqual(short.qualityMetrics,{});assert.equal(short.evidenceMode,'issued');
  assert.equal(short.forecastEvidence,null);assert.equal(JSON.stringify(base),frozen);
  assert.match(short.comparisonNote,/继续使用旧参数/);
});
test('unissued frequency cannot silently borrow the other frequency or version',()=>{
  assert.throws(()=>versionedView(fixture(),null,'V0.1.2','weekly',13),/尚未发行/);
});
test('rolling CSV retains its own frequency issue time and policy at every horizon',()=>{
  const data=versionedView(fixture(),null,'V0.1.2','monthly',12);
  const csv=forecastCsv(data);assert.equal(csv.split('\r\n').length,13);
  assert.equal((csv.match(/ROLLING_REFERENCE_AS_ISSUED/g)||[]).length,12);
  assert.equal((csv.match(/test-rolling/g)||[]).length,12);
  assert.equal((csv.match(/2026-10-01T12:00:00/g)||[]).length,12);
});
