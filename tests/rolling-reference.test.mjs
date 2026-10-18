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
test('rolling as-issued quality and historical points accumulate within their own horizon',()=>{
  const base=fixture(), batch=base.rollingReference.monthly;
  batch.issuedActuals=[{date:'2026-08-31',actual:99}];
  batch.issuedComparisons=[{origin:'2026-07-31',target:'2026-08-31',horizon:1,actual:99,forecast:98}];
  batch.qualityByHorizon=[{horizon:1,sampleCount:1,mae:1,rmse:1},{horizon:3,sampleCount:0,mae:null,rmse:null}];
  const one=versionedView(base,null,'V0.1.2','monthly',3,'issued',1);
  const three=versionedView(base,null,'V0.1.2','monthly',12,'issued',3);
  assert.equal(one.qualityMetrics.n,1); assert.equal(three.qualityMetrics.n,0);
  assert.equal(one.series[0].historicalForecast,98);assert.equal(three.series[0].historicalForecast,null);
  assert.deepEqual(one.series.filter(r=>r.future),three.series.filter(r=>r.future).slice(0,3));
});
test('rolling CSV retains its own frequency issue time and policy at every horizon',()=>{
  const data=versionedView(fixture(),null,'V0.1.2','monthly',12);
  const csv=forecastCsv(data);assert.equal(csv.split('\r\n').length,13);
  assert.equal((csv.match(/ROLLING_REFERENCE_AS_ISSUED/g)||[]).length,12);
  assert.equal((csv.match(/test-rolling/g)||[]).length,12);
  assert.equal((csv.match(/2026-10-01T12:00:00/g)||[]).length,12);
});
test('temporary reciprocal is labelled and its anchor is not a realised actual',()=>{
  const base=fixture(), batch=base.rollingReference.monthly;
  base.symbol='AUDCNH';
  batch.referenceInput={label:'临时参考：Alpha Vantage CNHAUD 倒数；AUDCNH 正向行情仍缺测。',derivedSessions:['2026-09-30']};
  batch.latestActual.valueRole='DERIVED_REFERENCE_ANCHOR';batch.series[0].actual=null;
  const short=versionedView(base,null,'V0.1.2','monthly',3);
  const long=versionedView(base,null,'V0.1.2','monthly',12);
  assert.match(short.comparisonNote,/CNHAUD 倒数/);assert.match(short.comparisonNote,/未获交易执行资格/);
  assert.match(short.qualityLabel,/临时来源参考/);assert.equal(short.series[0].actual,null);
  assert.deepEqual(short.series,long.series.slice(0,4));
});
