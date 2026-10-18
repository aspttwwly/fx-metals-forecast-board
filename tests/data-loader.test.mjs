import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { createDataLoader } from '../src/data-loader.js';
import { versionedView } from '../src/forecast-versions.js';
import { readFile } from 'node:fs/promises';

const hash = value => createHash('sha256').update(value).digest('hex');
const path = '/data/AUDCNH.json';
function fixture() {
  let at = 1000, body = JSON.stringify({ symbol: 'AUDCNH', rows: [1, 2] });
  let resource = body, delay = null;
  const calls = [];
  const index = () => ({ schema: 'fx-browser-data-index/v1', revision: hash(body), resources: { [path]: { sha256: hash(body), bytes: Buffer.byteLength(body) } } });
  const loader = createDataLoader({ now: () => at, digest: value => webcrypto.subtle.digest('SHA-256', value),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url === '/data/browser-index.json') return new Response(JSON.stringify(index()));
      if (delay) await delay;
      return new Response(resource);
    } });
  return { loader, calls, tick: () => { at += 60_001; }, set: value => { body = JSON.stringify(value); resource = body; }, corrupt: () => { resource = '{}'; }, delay: value => { delay = value; } };
}
test('concurrent and repeat reads share one verified parsed object', async () => {
  const f = fixture();
  let finish;
  f.delay(new Promise(resolve => { finish = resolve; }));
  const first = f.loader.load(path), second = f.loader.load(path);
  finish();
  const [a, b] = await Promise.all([first, second]);
  assert.strictEqual(a, b);
  assert.strictEqual(a, await f.loader.load(path));
  assert.equal(f.calls.length, 2); // One index + one asset, including concurrent reads.
  assert.ok(Object.isFrozen(a.rows));
});
test('stale index check is coalesced and unchanged payload is not downloaded', async () => {
  const f = fixture();
  await f.loader.load(path);
  f.tick();
  await Promise.all([f.loader.load(path), f.loader.load(path)]);
  assert.equal(f.calls.length, 3);
  assert.equal(f.calls.at(-1).url, '/data/browser-index.json');
  assert.equal(f.calls.at(-1).options.cache, 'no-store');
});
test('changed hash fetches the new version without reusing old values', async () => {
  const f = fixture();
  const old = await f.loader.load(path);
  f.set({ symbol: 'AUDCNH', rows: [3] });
  f.tick();
  const current = await f.loader.load(path);
  assert.notStrictEqual(old, current);
  assert.deepEqual(current.rows, [3]);
  assert.equal(f.calls.filter(row => row.url.startsWith(path)).length, 2);
});
test('length/hash mismatch is rejected, failures are evicted and recovery works', async () => {
  const f = fixture();
  f.corrupt();
  await assert.rejects(f.loader.load(path), /integrity check failed/);
  assert.equal(f.calls.filter(row => row.url.startsWith(path)).length, 2);
  f.set({ symbol: 'AUDCNH', rows: [1, 2] });
  assert.deepEqual((await f.loader.load(path)).rows, [1, 2]);
});
test('publication changes during asset fetch are resolved by fresh index, never unverified data', async () => {
  let body = '{"v":1}', calls = 0;
  const loader = createDataLoader({ digest: value => webcrypto.subtle.digest('SHA-256', value), fetchImpl: async url => {
    if (url === '/data/browser-index.json') return new Response(JSON.stringify({ schema: 'fx-browser-data-index/v1', revision: hash(body), resources: { [path]: { sha256: hash(body), bytes: body.length } } }));
    calls++;
    body = '{"v":2}';
    return new Response(body);
  } });
  const [first, second] = await Promise.all([loader.load(path), loader.load(path)]);
  assert.equal(first.v, 2);
  assert.strictEqual(first, second);
  assert.equal(calls, 2);
});
test('failed index is not silently replaced by stale cached data', async () => {
  let failed = false;
  const f = fixture();
  const loader = createDataLoader({ fetchImpl: async () => { if (failed) throw new Error('offline'); return new Response('{}'); } });
  await assert.rejects(loader.load(path), /Invalid data index/);
  failed = true;
  await assert.rejects(loader.load(path), /offline/);
  assert.equal(f.calls.length, 0);
});
test('verified frozen production payload supports all versions and frequency/horizon views', async () => {
  const data = JSON.parse(await readFile(new URL('../public/data/AUDCNH.json', import.meta.url), 'utf8'));
  const legacy = JSON.parse(await readFile(new URL('../public/data/versions/v0.1.0/AUDCNH.json', import.meta.url), 'utf8'));
  function freeze(value) { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); } return value; }
  freeze(data); freeze(legacy);
  for (const version of ['V0.1.0', 'V0.1.1', 'V0.1.2']) {
    for (const frequency of version === 'V0.1.0' ? ['weekly'] : ['weekly', 'monthly']) {
      for (const horizon of frequency === 'monthly' ? [3, 12] : version === 'V0.1.0' ? [13] : [13, 52]) {
        assert.doesNotThrow(() => versionedView(data, legacy, version, frequency, horizon, 'issued', frequency === 'monthly' ? 3 : 13));
      }
    }
  }
});
