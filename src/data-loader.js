const indexedPath = /^\/data\/(?:manifest|[A-Z0-9]{3,12}|versions\/v0\.1\.0\/[A-Z0-9]{3,12})\.json$/;
const hex = (bytes) => Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');

export function createDataLoader({ fetchImpl = (...args) => fetch(...args), now = Date.now,
  digest = buffer => crypto.subtle.digest('SHA-256', buffer), indexTtlMs = 60_000 } = {}) {
  let index = null, indexCheckedAt = 0, indexPending = null;
  const values = new Map(), pending = new Map();
  async function checkedResponse(url, options) {
    const response = await fetchImpl(url, options);
    if (!response.ok) throw new Error(`Unable to fetch ${url}`);
    return response;
  }
  async function getIndex(force = false) {
    if (indexPending) return indexPending;
    if (!force && index && now() - indexCheckedAt < indexTtlMs) return index;
    indexPending = (async () => {
      const candidate = await (await checkedResponse('/data/browser-index.json', { cache: 'no-store' })).json();
      if (candidate.schema !== 'fx-browser-data-index/v1' || !/^[a-f0-9]{64}$/.test(candidate.revision) || !candidate.resources) throw new Error('Invalid data index');
      const entries = Object.entries(candidate.resources);
      if (!entries.length || entries.length > 64 || entries.some(([path, entry]) => !indexedPath.test(path) || !/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 1)) throw new Error('Invalid data index entry');
      index = candidate;
      indexCheckedAt = now();
      const hashes = new Set(entries.map(([, entry]) => entry.sha256));
      for (const hash of values.keys()) if (!hashes.has(hash)) values.delete(hash);
      return index;
    })();
    try { return await indexPending; } finally { indexPending = null; }
  }
  async function loadIndexed(url, retry = true) {
    const current = await getIndex();
    const entry = current.resources[url];
    if (!entry) throw new Error(`Data not present in current index: ${url}`);
    if (values.has(entry.sha256)) return values.get(entry.sha256);
    if (pending.has(entry.sha256)) return pending.get(entry.sha256);
    const request = (async () => {
      try {
        const response = await checkedResponse(`${url}?sha256=${entry.sha256}`, { cache: retry ? 'default' : 'reload' });
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength !== entry.bytes || hex(await digest(buffer)) !== entry.sha256) throw new Error(`Data integrity check failed: ${url}`);
        const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer));
        // Never expose a mutable cache object to renderers or other consumers.
        freeze(value);
        values.set(entry.sha256, value);
        return value;
      } catch (error) {
        if (!retry) throw error;
        // Publication may have changed between reading the index and its asset.
        pending.delete(entry.sha256);
        await getIndex(true);
        return loadIndexed(url, false);
      }
    })();
    pending.set(entry.sha256, request);
    try { return await request; }
    finally {
      if (pending.get(entry.sha256) === request) pending.delete(entry.sha256);
    }
  }
  function freeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.freeze(value);
      for (const child of Object.values(value)) freeze(child);
    }
    return value;
  }
  return {
    load: url => indexedPath.test(url) ? loadIndexed(url) : checkedResponse(url).then(response => response.json()),
    refresh: () => getIndex(true),
  };
}
