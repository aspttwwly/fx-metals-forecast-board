import assert from "node:assert/strict";
import test from "node:test";
import worker, { consumerAssetPath } from "../worker/index.js";

const sha = "a".repeat(64);
const seen = [];
const env = { ASSETS: { fetch: async request => {
  seen.push(new URL(request.url).pathname);
  return new Response(request.method === "HEAD" ? null : '{"schemaVersion":1}', {
    status: 200, headers: { "Content-Type": "application/json" },
  });
} } };
const request = (path, method = "GET", runtime = env) => worker.fetch(new Request(`https://example.com${path}`, { method }), runtime);

test("only manifest and immutable SHA objects map to public consumer assets", async () => {
  seen.length = 0;
  const manifest = await request("/api/v1/manifest.json");
  assert.equal(manifest.status, 200);
  assert.equal(manifest.headers.get("Cache-Control"), "no-store");
  const body = await request(`/api/v1/data/${sha}.json`);
  assert.equal(body.status, 200);
  assert.match(body.headers.get("Cache-Control"), /immutable/);
  assert.equal(body.headers.get("ETag"), `"${sha}"`);
  assert.deepEqual(seen, ["/data/api-v1/manifest.json", `/data/api-v1/data/${sha}.json`]);
  assert.equal(body.headers.get("Access-Control-Allow-Credentials"), null);
});

test("API is read-only and supports bodyless HEAD", async () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    const result = await request("/api/v1/manifest.json", method);
    assert.equal(result.status, 405);
    assert.equal(result.headers.get("Allow"), "GET, HEAD");
  }
  const head = await request(`/api/v1/data/${sha}.json`, "HEAD");
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
});

test("arbitrary URL/file traversal and malformed hashes are rejected", async () => {
  for (const path of ["/api/v1/.env", "/api/v1/https://other.test/a.json", "/api/v1/data/../../.env",
    "/api/v1/data/%2e%2e%2fsecret.json", "/api/v1/data/%5c..%5c.env", `/api/v1/data/${sha.toUpperCase()}.json`,
    `/api/v1/data/${sha}.json/extra`, "/api/v1/manifest.json?path=/data/terrain/USDCNH.json"]) {
    assert.equal(consumerAssetPath(path), null);
    if (!path.includes("/../../")) assert.equal((await request(path)).status, 404);
  }
});

test("missing immutable objects/SPA HTML fail safely instead of a false generation", async () => {
  const fallback = { ASSETS: { fetch: async () => new Response("<html>SPA</html>", {
    status: 200, headers: { "Content-Type": "text/html" },
  }) } };
  assert.equal((await request(`/api/v1/data/${sha}.json`, "GET", fallback)).status, 404);
});

test("consumer routing does not relax existing advanced authentication", async () => {
  for (const path of ["/USDJPY?view=terrain", "/USDJPY?view=constellation", "/data/terrain/USDJPY.json",
    "/data/files/latest_trade_signals.xlsx", "/data/files/latest_terrain_snapshot.xlsx"]) {
    assert.equal((await request(path)).status, 401);
  }
});
