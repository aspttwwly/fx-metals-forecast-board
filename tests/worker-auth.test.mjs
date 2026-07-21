import assert from "node:assert/strict";
import test from "node:test";

import worker from "../worker/index.js";


const credentials = Buffer.from("roy:test-password").toString("base64");
const env = {
  SITE_USER: "roy",
  SITE_PASSWORD: "test-password",
  ASSETS: {
    fetch: async () => new Response("asset", { status: 200 }),
  },
};

async function request(path, authenticated = false) {
  const headers = authenticated ? { Authorization: `Basic ${credentials}` } : {};
  return worker.fetch(new Request(`https://example.com${path}`, { headers }), env);
}

test("Observatory and its base JSON remain public", async () => {
  assert.equal((await request("/USDCNH")).status, 200);
  assert.equal((await request("/data/USDCNH.json")).status, 200);
  assert.equal((await request("/data/manifest.json")).status, 200);
});

test("Constellation and Terrain routes require Basic authentication", async () => {
  for (const path of ["/USDCNH?view=constellation", "/USDCNH?view=terrain"]) {
    const anonymous = await request(path);
    assert.equal(anonymous.status, 401);
    assert.match(anonymous.headers.get("WWW-Authenticate"), /^Basic /);
    assert.equal((await request(path, true)).status, 200);
  }
});

test("Terrain JSON and advanced workbooks cannot bypass the page login", async () => {
  for (const path of [
    "/data/terrain/USDCNH.json",
    "/data/files/latest_terrain_snapshot.xlsx",
    "/data/files/latest_trade_signals.xlsx",
  ]) {
    assert.equal((await request(path)).status, 401);
    assert.equal((await request(path, true)).status, 200);
  }
});

test("Wrong credentials are rejected", async () => {
  const response = await worker.fetch(new Request("https://example.com/USDCNH?view=terrain", {
    headers: { Authorization: `Basic ${Buffer.from("roy:wrong").toString("base64")}` },
  }), env);
  assert.equal(response.status, 401);
});
