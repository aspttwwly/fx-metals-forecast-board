import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

// Build metadata only: original data bytes and consumer API contracts stay unchanged.
export async function writeBrowserDataIndex(dist) {
  const manifest = JSON.parse(await readFile(join(dist, 'data/manifest.json'), 'utf8'));
  const paths = ['/data/manifest.json'];
  for (const { symbol } of manifest.symbols) {
    if (!/^[A-Z0-9]{3,12}$/.test(symbol)) throw new Error('Invalid public symbol');
    paths.push(`/data/${symbol}.json`, `/data/versions/v0.1.0/${symbol}.json`);
  }
  const resources = {};
  for (const path of paths.sort()) {
    const bytes = await readFile(join(dist, path.slice(1)));
    resources[path] = { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
  }
  const revision = createHash('sha256').update(JSON.stringify(resources)).digest('hex');
  await writeFile(join(dist, 'data/browser-index.json'), JSON.stringify({ schema: 'fx-browser-data-index/v1', revision, resources }));
}
