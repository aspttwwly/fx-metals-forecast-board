import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { forecastBatchPresentation, forecastBoundaryLayout } from '../src/forecast-batches.js';

function fixture(frequency = 'weekly', horizon = 13) {
  const monthly = frequency === 'monthly';
  const origin = monthly ? '2026-09-30' : '2026-10-09';
  const actual = monthly ? 157.903 : 158.322;
  return {
    appVersion: 'V0.1.1', frequencyKey: frequency, selectedHorizon: horizon,
    evidenceMode: 'backtest', forecastScope: 'WALKFORWARD_RESEARCH_CURRENT',
    latestActual: { date: origin, value: actual }, qualityMetrics: { n: 93, rmse: 8.781673075120066 },
    series: [{ date: origin, actual, forecast: actual, historicalForecast: monthly ? 163.24731577898118 : 168.1168995479348,
      predictionOrigin: monthly ? '2026-06-30' : '2026-07-10', comparisonHorizon: horizon, future: false },
    { date: monthly ? '2026-10-31' : '2026-10-16', forecast: 158.6297544847629, actual: null, future: true }],
  };
}

function deepFreeze(value) {
  Object.values(value).filter(item => item && typeof item === 'object').forEach(deepFreeze);
  return Object.freeze(value);
}

test('same-date historical forecast and new actual h0 remain separate, with error unchanged', () => {
  const view = deepFreeze(fixture());
  const before = JSON.stringify(view), error = view.series[0].historicalForecast - view.series[0].actual;
  const presentation = forecastBatchPresentation(view);
  assert.equal(presentation.actualAnchor, true);
  assert.equal(presentation.anchorValue, 158.322);
  assert.equal(presentation.historyLabel, '历史回测 · h13');
  assert.equal(presentation.futureLabel, '本期研究预测');
  assert.match(presentation.description, /固定 h=13/);
  assert.match(presentation.description, /h=1…13/);
  assert.match(presentation.description, /不是历史预测，不计入误差/);
  assert.equal(view.series[0].historicalForecast, 168.1168995479348);
  assert.equal(view.series[0].historicalForecast - view.series[0].actual, error);
  assert.equal(JSON.stringify(view), before);
});

test('small weekly/monthly horizons distinguish fixed history from current path without stale h13 copy', () => {
  for (const [frequency, horizon, unit] of [['weekly',1,'周'],['weekly',4,'周'],['monthly',1,'个月'],['monthly',3,'个月'],['monthly',12,'个月'],['weekly',52,'周']]) {
    const presentation = forecastBatchPresentation(fixture(frequency,horizon));
    assert.equal(presentation.historyLabel, `历史回测 · h${horizon}`);
    assert.ok(presentation.description.includes(`第 ${horizon} ${unit}预测（固定 h=${horizon}）`));
    assert.ok(presentation.description.includes(horizon === 1 ? `第 1 ${unit}（h=1）` : `第 1–${horizon} ${unit}（h=1…${horizon}）`));
    assert.doesNotMatch(presentation.description, /h=1…1[^0-9]/);
  }
});

test('explicit historical horizon remains fixed when future presentation changes', () => {
  const short={...fixture('monthly',3),comparisonHorizon:3};
  const long={...fixture('monthly',12),comparisonHorizon:3};
  const before=JSON.stringify([short,long]);
  const a=forecastBatchPresentation(deepFreeze(short));
  const b=forecastBatchPresentation(deepFreeze(long));
  assert.equal(a.historyLabel,'历史回测 · h3');
  assert.equal(b.historyLabel,a.historyLabel);
  assert.match(a.description,/第 3 个月预测（固定 h=3）/);
  assert.match(b.description,/第 3 个月预测（固定 h=3）/);
  assert.match(a.description,/h=1…3/);
  assert.match(b.description,/h=1…12/);
  const changed=forecastBatchPresentation({...long,comparisonHorizon:12});
  assert.equal(changed.historyLabel,'历史回测 · h12');
  assert.match(changed.description,/第 12 个月预测（固定 h=12）/);
  assert.match(changed.description,/h=1…12/);
  assert.equal(JSON.stringify([short,long]),before);
});

test('original V0 mixed history and retained connection point are never relabeled fixed-h or actual-anchor', () => {
  const view = fixture();
  view.appVersion = 'V0.1.0'; view.evidenceMode = 'legacy'; view.forecastScope = 'LEGACY_SNAPSHOT';
  view.series[0].forecast = 158.68;
  const presentation = forecastBatchPresentation(deepFreeze(view));
  assert.equal(presentation.actualAnchor, false);
  assert.equal(presentation.anchorValue, 158.68);
  assert.equal(presentation.historyLabel, '原版历史 · 混合期限');
  assert.equal(presentation.futureLabel, '原版未来留存');
  assert.match(presentation.description, /不作为固定期限评分/);
  assert.doesNotMatch(presentation.description, /固定 h=|h=0 是/);
  assert.equal(presentation.boundaryLabel, '原版留存分界');
  const backfill = forecastBatchPresentation({...view,evidenceMode:'backtest'});
  assert.equal(backfill.historyLabel,'旧版回补 · h13');
  assert.equal(backfill.futureLabel,'原版未来留存');
});

test('empty real issued history stays empty and is not described as research history', () => {
  const view = fixture('monthly',3);
  view.evidenceMode = 'issued'; view.forecastScope = 'MONTHLY_RESEARCH_AS_ISSUED';
  view.series[0].historicalForecast = null;
  const presentation = forecastBatchPresentation(deepFreeze(view));
  assert.equal(presentation.historyLabel,'历史发布 · h3');
  assert.equal(presentation.futureLabel,'本期发布预测');
  assert.match(presentation.description,/暂无成熟真实发布点；不以回测替代/);
  assert.equal(view.series[0].historicalForecast,null);
});

test('nonmatching or missing h0 is not falsely labeled as known actual price', () => {
  const view = fixture(); view.series[0].forecast = 159;
  assert.equal(forecastBatchPresentation(view).actualAnchor,false);
  view.series[0].forecast = null;
  assert.equal(forecastBatchPresentation(view).anchorValue,null);
});

test('approved reciprocal anchor stays explicitly temporary without becoming an actual or changing issued values', () => {
  const view = fixture();
  view.appVersion='V0.1.2'; view.evidenceMode='issued'; view.forecastScope='ROLLING_REFERENCE_AS_ISSUED';
  view.latestActual.valueRole='DERIVED_REFERENCE_ANCHOR';
  view.referenceInput={derivedSessions:[view.latestActual.date]};
  view.series[0].actual=null; view.series[0].historicalForecast=null;
  const before=JSON.stringify(view);
  const result=forecastBatchPresentation(deepFreeze(view));
  assert.equal(result.temporaryAnchor,true);
  assert.equal(result.actualAnchor,false);
  assert.equal(result.anchorValue,view.latestActual.value);
  assert.match(result.heading,/临时倒数预测起点/);
  assert.match(result.boundaryLabel,/临时倒数起点/);
  assert.equal(result.futureLabel,'本期临时参考预测');
  assert.match(result.description,/Alpha Vantage CNHAUD 倒数/);
  assert.match(result.description,/并非 AUDCNH 正向实际收盘/);
  assert.equal(JSON.stringify(view),before);
  const normal=fixture('monthly',3);
  assert.equal(forecastBatchPresentation(normal).temporaryAnchor,false);
  assert.equal(forecastBatchPresentation(normal).actualAnchor,true);
});

test('monthly h0 arithmetic noise is labeled correctly without rounding or changing source values', () => {
  const view = fixture('monthly',3);
  view.series[0].actual = 157.903;
  view.series[0].forecast = 157.90299999999993;
  const before = JSON.stringify(view);
  assert.equal(forecastBatchPresentation(deepFreeze(view)).actualAnchor,true);
  assert.equal(JSON.stringify(view),before);
  const changed = structuredClone(view); changed.series[0].forecast = 157.902999;
  assert.equal(forecastBatchPresentation(changed).actualAnchor,false);
});

test('batch boundary follows date coordinates, stays inside narrow plot and disappears outside zoom', () => {
  for (const time of [0,1,5,9,10]) {
    const layout = forecastBoundaryLayout(time,0,10,66,256);
    assert.equal(layout.x,66+time*19);
    assert.ok(layout.labelLeft >= 66);
    assert.ok(layout.labelLeft+layout.labelWidth <= 256);
  }
  assert.equal(forecastBoundaryLayout(-1,0,10,66,256),null);
  assert.equal(forecastBoundaryLayout(11,0,10,66,256),null);
  assert.equal(forecastBoundaryLayout(1,1,1,66,256),null);
});

test('rendering retains separate historical values and explicitly marks the batch rather than joining curves', () => {
  const main = readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
  assert.match(main,/linePath\(series\.filter\(point => !point\.dailyOnly\), x, y, "historicalForecast"\)/);
  assert.match(main,/futureForecastPath\(series, x, y, latestTime\)/);
  assert.match(main,/forecast-batch-boundary/);
  assert.match(main,/forecast-batch-anchor/);
  assert.match(main,/历史差值.*historicalForecast-nearest\.actual/);
  assert.match(main,/本期 h=0 实际价锚点/);
});

test('legend and explanation use normal wrapping flow, different line styles and reduced-motion support', () => {
  const html = readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const css = readFileSync(new URL('../src/styles.css',import.meta.url),'utf8');
  assert.match(html, /class="chart-context"[\s\S]*?id="forecast-batch-note"[\s\S]*?<div class="chart-wrap">/);
  assert.match(html, /aria-describedby="forecast-batch-note"/);
  assert.match(css,/\.future-flow\s*\{[^}]*stroke-dasharray: none;[^}]*animation: none;/);
  assert.match(css,/\.observatory-only \.forecast-line\s*\{[^}]*stroke-dasharray:7 4/);
  assert.match(css,/\.chart-context \.chart-legend\s*\{[^}]*position:static;[^}]*max-width:100%/);
  assert.match(css,/\.chart-context \.chart-legend span\s*\{[^}]*white-space:normal/);
  assert.match(css,/@media \(prefers-reduced-motion:reduce\)[\s\S]*\.future-flow[^}]*animation:none !important/);
});
