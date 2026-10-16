import test from 'node:test';
import assert from 'node:assert/strict';
import {versionedView,comparisonCsv,recentComparison} from '../src/forecast-versions.js';
import {forecastCsv} from '../src/forecast-frequency.js';
import {readFileSync} from 'node:fs';

function fixture() {
  const origin='2026-09-25';
  const week=Array.from({length:53},(_,h)=>({date:new Date(Date.UTC(2026,8,25+7*h)).toISOString().slice(0,10),horizon:h,actual:h?null:7,forecast:7+h*.01,future:h>0}));
  const month=Array.from({length:13},(_,h)=>({date:new Date(Date.UTC(2026,9+h,0)).toISOString().slice(0,10),horizon:h,actual:h?null:8,forecast:8-h*.03,future:h>0}));
  const base={symbol:'TEST',latestActual:{date:origin,value:7},series:[{date:'2025-01-03',actual:6,forecast:null,future:false},...week.slice(0,14)],
    modelAdmission:{status:'BLOCKED'},files:{},longHorizon:{issuedAt:'2026-10-15',sourceDataCutoff:'2026-10-14',weekly:{originDate:origin,prefixDisplayEqual:true,series:week},
      monthly:{status:'RESEARCH_ONLY',latestActual:{date:'2026-09-30',value:8},series:[{date:'2025-01-31',actual:7,forecast:null,future:false},...month]}}};
  base.walkforward={runId:'fixture',updatedAt:'2026-10-15T01:00:00Z',cutoff:'2026-10-14',frequencies:{}};
  for(const [freq,points,anchor] of [['weekly',week,7],['monthly',month,8]]) {
    base.walkforward.frequencies[freq]={status:'COMPLETE',completed:33,total:33,protocol:'test-protocol',
      rows:[{origin:freq==='weekly'?'2024-10-04':'2024-10-31',target:freq==='weekly'?'2025-01-03':'2025-01-31',horizon:freq==='weekly'?13:3,forecast:6.1,actual:freq==='weekly'?6:7}],
      metrics:[{horizon:freq==='weekly'?13:3,n:1,rmse:.1,mae:.1,mape:.01}],
      latest:{origin:points[0].date,anchor,forecast:points.map(r=>({...r,forecast:r.forecast+1})),parameters:{window:36}}};
  }
  return base;
}
test('V0 preserves original curve and never invents monthly or long-week output',()=>{
  const cur=fixture(),legacy=structuredClone(cur); legacy.series[0].forecast=6.2;
  const before=JSON.stringify(legacy),view=versionedView(cur,legacy,'V0.1.0','weekly',13);
  assert.equal(view.series[0].historicalForecast,6.2); assert.equal(view.series[0].actual,6);
  assert.equal(JSON.stringify(legacy),before); assert.equal(view.evidenceMode,'legacy');
  assert.throws(()=>versionedView(cur,legacy,'V0.1.0','monthly',3));
  assert.throws(()=>versionedView(cur,legacy,'V0.1.0','weekly',52));
  assert.throws(()=>versionedView(cur,null,'V0.1.0','weekly',13));
});
test('completed replay has historical target alignment and uses its own same-rule future',()=>{
  const cur=fixture(),before=JSON.stringify(cur),v=versionedView(cur,null,'V0.1.1','monthly',3);
  assert.equal(v.series.find(r=>r.date==='2025-01-31').historicalForecast,6.1);
  assert.ok(Math.abs(v.nextForecast.value-8.97)<1e-12); assert.equal(v.trainStart,'2023-10-31');
  assert.equal(v.qualityMetrics.n,1); assert.equal(v.modelAdmission,null);
  assert.equal(v.forecastScope,'WALKFORWARD_RESEARCH_CURRENT'); assert.equal(JSON.stringify(cur),before);
  assert.match(comparisonCsv(v),/2024-10-31/); assert.match(forecastCsv(v),/test-protocol/);
  assert.match(forecastCsv(v),/WALKFORWARD_RESEARCH_CURRENT/); assert.doesNotMatch(forecastCsv(v),/MONTHLY_RESEARCH"/);
});
test('same research vintage first thirteen numbers are invariant at fifty-two',()=>{
  const cur=fixture();
  const a=versionedView(cur,null,'V0.1.1','weekly',13).series.filter(r=>r.future);
  const b=versionedView(cur,null,'V0.1.1','weekly',52).series.filter(r=>r.future);
  assert.equal(a.length,13); assert.equal(b.length,52); assert.deepEqual(a,b.slice(0,13));
});

test('monthly cutoff follows the displayed forecast source, not the newer issued batch',()=>{
  const cur=fixture();cur.longHorizon.sourceDataCutoff='2026-10-15';
  const before=JSON.stringify(cur);
  const replay=versionedView(cur,null,'V0.1.1','monthly',3,'backtest');
  const issued=versionedView(cur,null,'V0.1.1','monthly',3,'issued');
  assert.equal(replay.displaySourceCutoff,'2026-10-14');
  assert.equal(issued.displaySourceCutoff,'2026-10-15');
  assert.equal(replay.firstTarget,'2025-01-31');
  assert.match(replay.comparisonNote,/目标窗口自 2025-01-01，首个成熟目标 2025-01-31/);
  assert.equal(versionedView(cur,null,'V0.1.1','weekly',13).firstTarget,'2025-01-03');
  assert.equal(JSON.stringify(cur),before);
  cur.walkforward.frequencies.monthly.latest.origin='2026-08-31';
  assert.equal(versionedView(cur,null,'V0.1.1','monthly',3).displaySourceCutoff,'2026-10-15');
  const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
  assert.match(main,/data-monthly="sourceCutoff".*selected\.displaySourceCutoff/);
});
test('partial replay never overwrites original future and describes incompleteness',()=>{
  const cur=fixture();cur.walkforward.frequencies.weekly.status='RUNNING';
  const v=versionedView(cur,null,'V0.1.1','weekly',13);
  assert.equal(v.nextForecast.value,7.01); assert.match(v.comparisonNote,/尚不完整/);
});
test('a completed but stale replay cannot replace a newer current forecast',()=>{
  const cur=fixture();cur.walkforward.frequencies.weekly.latest.origin='2026-09-18';
  const v=versionedView(cur,null,'V0.1.1','weekly',13);
  assert.equal(v.latestActual.date,'2026-09-25');assert.equal(v.nextForecast.value,7.01);
  assert.match(v.comparisonNote,/落后/);
});
test('issued evidence excludes all replay rows, but displays genuine matured records',()=>{
  const cur=fixture();let v=versionedView(cur,null,'V0.1.1','weekly',13,'issued');
  assert.equal(v.series.filter(r=>Number.isFinite(r.historicalForecast)).length,0);
  cur.issuedComparisons={weekly:[{origin:'2024-10-04',target:'2025-01-03',horizon:13,forecast:6.2,actual:6}]};
  v=versionedView(cur,null,'V0.1.1','weekly',13,'issued');
  assert.equal(v.series[0].historicalForecast,6.2);assert.equal(v.qualityMetrics.n,1);
  assert.ok(Math.abs(v.qualityMetrics.rmse-.2)<1e-12);assert.equal(v.nextForecast.value,7.01);
});
test('recent comparison needs two complete windows of the same horizon',()=>{
  assert.match(recentComparison([],3,'monthly'),/待满 12/);
  const rows=Array.from({length:12},(_,i)=>({target:String(i).padStart(2,'0'),horizon:3,actual:10,anchor:9,forecast:i<6?10:8}));
  assert.match(recentComparison(rows,3,'monthly'),/提示观察/);
  assert.match(recentComparison(rows,1,'monthly'),/当前 0/);
});

test('version history windows start on target dates, originals remain unchanged',()=>{
  const cur=fixture(),old=structuredClone(cur);
  const before=[{date:'2023-12-29',actual:5,forecast:5.1,future:false},
    {date:'2024-01-05',actual:5.5,forecast:5.6,future:false}];
  old.series.unshift(...before);cur.series.unshift(...before);
  const original=JSON.stringify(old);
  const v0=versionedView(cur,old,'V0.1.0','weekly',13,'issued');
  const v1=versionedView(cur,old,'V0.1.1','weekly',13);
  assert.equal(v0.series[0].date,'2024-01-05');assert.equal(v0.series[0].historicalForecast,5.6);
  assert.equal(v1.series[0].date,'2025-01-03');assert.equal(JSON.stringify(old),original);
});

test('V0 backfill and original archive are distinct, neither borrows V1 rows',()=>{
  const cur=fixture(),old=structuredClone(cur);old.series[0].forecast=99;
  cur.legacyBackfill={runId:'legacy-test',cutoff:'2026-10-14',frequencies:{weekly:{status:'RUNNING',completed:30,total:184,
    rows:[{version:'V0.1.0',backfill:'V0',origin:'2023-10-06',target:'2024-01-05',horizon:13,actual:5,forecast:5.3}],
    metrics:[{horizon:13,n:1,rmse:.3}]}}};
  const replay=versionedView(cur,old,'V0.1.0','weekly',13,'backtest');
  assert.equal(replay.series[0].date,'2024-01-05');assert.equal(replay.series[0].historicalForecast,5.3);
  assert.equal(replay.series.find(r=>r.date==='2025-01-03').historicalForecast,null);
  assert.equal(replay.qualityMetrics.n,1);assert.equal(replay.nextForecast.value,7.01);
  assert.match(comparisonCsv(replay),/LEGACY_WALKFORWARD_BACKFILL/);assert.match(comparisonCsv(replay),/legacy-test/);
  assert.equal(versionedView(cur,old,'V0.1.0','weekly',13,'issued').series[0].historicalForecast,99);
  cur.legacyBackfill.frequencies.weekly.rows[0].version='V0.1.1';
  assert.throws(()=>versionedView(cur,old,'V0.1.0','weekly',13,'backtest'),/来源不符/);
});

test('zero completed selected targets are explained instead of fabricated',()=>{
  const cur=fixture();cur.walkforward.frequencies.weekly.rows=[];cur.walkforward.frequencies.weekly.status='RUNNING';
  const view=versionedView(cur,null,'V0.1.1','weekly',13);
  assert.match(view.comparisonNote,/尚未生成历史预测/);
  assert.equal(view.series.filter(r=>Number.isFinite(r.historicalForecast)).length,0);
});

test('sparse historical predictions have visible point marks, not just single-move paths',()=>{
  const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
  assert.match(main,/filter\(point=>Number\.isFinite\(point\.historicalForecast\)\).*historical-forecast-point/);
});
