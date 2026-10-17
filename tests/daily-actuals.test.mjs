import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyObservation, observedDisplaySeries, dailyActualsCsv } from '../src/daily-actuals.js';

function fixture() {
  return { symbol:'USDCNH', historyStart:'2026-09-30', latestActual:{date:'2026-09-30',value:6.7},
    quality:{mae:0.1}, series:[
      {date:'2026-09-30',actual:6.7,forecast:null,historicalForecast:6.6,future:false},
      {date:'2026-10-15',actual:null,forecast:6.8,future:true},
      {date:'2026-10-31',actual:null,forecast:6.9,future:true}],
    dailyActuals:{schema:'fx-daily-actuals/v1',symbol:'USDCNH',frequency:'daily',
      scope:'DAILY_OBSERVED_DISPLAY_ONLY',sourceId:'market-raw/USDCNH',
      sourceDataCutoff:'2026-10-15',rawDataCutoff:'2026-10-16',issueDate:'2026-10-16',
      latest:{date:'2026-10-15',close:6.71},rows:[
        {date:'2026-09-29',close:6.72},{date:'2026-09-30',close:6.71},
        {date:'2026-10-14',close:6.72},{date:'2026-10-15',close:6.71}]}};
}

test('daily observations do not alter anchors, period actuals, forecasts or scores',()=>{
  for (const version of ['V0.1.0','V0.1.1']) for(const frequency of ['weekly','monthly']) {
    const data={...fixture(),appVersion:version,frequencyKey:frequency};
    const before=JSON.stringify(data), rows=observedDisplaySeries(data);
    assert.equal(rows.find(r=>r.date==='2026-09-30').actual,6.7);
    assert.equal(rows.find(r=>r.date==='2026-09-30').dailyClose,6.71);
    assert.equal(rows.find(r=>r.date==='2026-10-15').actual,null);
    assert.equal(rows.find(r=>r.date==='2026-10-15').forecast,6.8);
    assert.deepEqual(rows.find(r=>r.date==='2026-10-14'),{
      date:'2026-10-14',actual:null,forecast:null,historicalForecast:null,lower:null,upper:null,
      future:false,dailyOnly:true,dailyClose:6.72});
    assert.equal(rows.find(r=>r.date==='2026-10-31').dailyClose,null);
    assert.equal(rows.some(r=>r.date==='2026-09-29'),false);
    assert.equal(JSON.stringify(data),before);
  }
});

test('missing daily payload stays explicitly unavailable, not substituted from period actuals',()=>{
  const data=fixture(); delete data.dailyActuals;
  assert.deepEqual(dailyObservation(data),{available:false,rows:[],latest:null});
  assert.ok(observedDisplaySeries(data).every(r=>r.dailyClose===null));
  assert.ok(dailyActualsCsv(data).includes('daily_close'));
});

test('malformed daily dates, provenance, prices and cutoff fail closed',()=>{
  const mutations=[
    p=>{delete p.issueDate;},p=>{p.issueDate='2026-02-30';},p=>{p.sourceDataCutoff='2026-10-16';},
    p=>{p.rawDataCutoff='2026-10-14';},p=>{p.frequency='monthly';},p=>{p.sourceId='unknown';},
    p=>{p.symbol='EURUSD';},p=>{p.rows[1].date='2026-02-30';},p=>{p.rows[1].date=p.rows[0].date;},
    p=>{p.rows[0].close=NaN;},p=>{p.rows[0].close=0;},p=>{p.rows=[];},
    p=>{p.latest.close=6;},p=>{p.rows.at(-1).date='2026-10-16';}];
  for(const mutate of mutations){const data=fixture();mutate(data.dailyActuals);assert.throws(()=>dailyObservation(data));}
});

test('daily CSV is observation-only and scoped separately from forecast comparison CSV',()=>{
  const csv=dailyActualsCsv(fixture());
  assert.ok(csv.startsWith('\ufeff'));assert.ok(csv.includes('DAILY_OBSERVED_DISPLAY_ONLY'));
  assert.ok(csv.includes('2026-10-15'));assert.ok(!csv.includes('2026-09-29'));
  assert.ok(!csv.includes('forecast'));assert.ok(!csv.includes('error'));
});
