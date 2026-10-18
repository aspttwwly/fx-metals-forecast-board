import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { reviewRows, reviewCsv } from '../src/method-review.js';
import { formatPrice } from '../src/number-policy.js';
import { versionedView } from '../src/forecast-versions.js';

const root = new URL('../', import.meta.url);
const load = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const data = await load('public/data/research/USDCHF-weekly-review.json');

test('five-place display ignores floating roundoff but does not round stored evidence', () => {
  assert.equal(formatPrice(0.8806999999999998, 'USDCHF'), '0.88070');
  assert.equal(formatPrice(160.123456, 'USDJPY'), '160.12346');
  assert.equal(formatPrice(4123.456, 'XAUUSD'), '4,123.46');
  assert.equal(formatPrice(-1e-16, 'USDCHF'), '0.00000');
  assert.equal(formatPrice(Infinity), '--');
  const row = data.rows[0];
  assert.ok(reviewCsv(data, row.horizon).includes(String(row.candidate)));
  assert.notEqual(data.metrics.candidate.mae, Number(formatPrice(data.metrics.candidate.mae)));
});

test('all 13 historical horizons retain 54 unique original pairs with unchanged total metrics', () => {
  const before = JSON.stringify(data);
  for (let h=1; h<=13; h++) {
    assert.equal(reviewRows(data,h).length,54);
    assert.equal(reviewCsv(data,h).split('\n').length,55);
    assert.ok(reviewRows(data,h).every(r=>r.horizon===h && r.origin<r.target));
  }
  assert.equal(JSON.stringify(data),before);
  assert.throws(()=>reviewRows({...data, rows:data.rows.slice(1)},13));
  assert.throws(()=>reviewRows(data,52));
  assert.throws(()=>reviewRows({...data,productionIntegration:true},13));
});

test('displayed failed review matches raw paired errors and cannot replace formal data', () => {
  for (const key of ['old','candidate','naive']) {
    const mae=data.rows.reduce((sum,r)=>sum+Math.abs(r[key]-r.actual),0)/702;
    assert.ok(Math.abs(mae-data.metrics[key].mae)<1e-14);
  }
  assert.ok(data.metrics.candidate.mae>data.metrics.old.mae);
  assert.equal(data.decision,'KEEP_CURRENT_METHOD');
  assert.equal(data.productionIntegration,false);
  assert.equal(data.eligibleForExecution,false);
  assert.equal(data.independentBlindValidation,false);
});

test('all ten instruments have the current frozen weekly batch and preserve the 13-week prefix at 52', async () => {
  const manifest=await load('public/data/manifest.json');
  assert.equal(manifest.symbols.length,10);
  for (const {symbol} of manifest.symbols) {
    const current=await load(`public/data/${symbol}.json`);
    const short=versionedView(current,null,'V0.1.2','weekly',13,'issued',13);
    const long=versionedView(current,null,'V0.1.2','weekly',52,'issued',13);
    assert.equal(current.rollingReference.weekly.runId,'20261018T030453_9cc03a18');
    assert.deepEqual(short.series,long.series.slice(0,short.series.length));
    assert.equal(long.selectedEnd.date,'2027-10-15');
    assert.equal(long.evidenceMode,'issued');
  }
});
