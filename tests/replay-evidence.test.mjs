import assert from "node:assert/strict";
import test from "node:test";
import { evidenceRows, recentEvidence, replayNumber, replayPercent } from "../src/replay-evidence.js";

test("unavailable metrics are not formatted as zeros", () => {
  assert.equal(replayNumber(null), "--");
  assert.equal(replayPercent(undefined), "--");
  assert.equal(replayPercent(0), "0.0%");
});

test("results include error, direction, baseline skill and overlap counts", () => {
  const html = evidenceRows([{horizon: 4, n: 13, rmse: 0.024, mae: 0.017, direction: 8 / 13,
    direction_correct: 8, skill_naive: -0.2, skill_drift4: 0.1, nonoverlap_n_range: [3, 4],
    recent: {status: "INSUFFICIENT"}}]);
  for (const value of ["0.02400", "0.01700", "61.5%", "8/13", "-20.0%", "+10.0%", "3–4", "待满 26 周"]) assert.ok(html.includes(value), value);
});

test("recent comparison reports observed metrics rather than a significance claim", () => {
  const text = recentEvidence({n: 30, recent: {status: "WATCH", prior: {rmse: .01}, latest: {rmse: .02}, skill_delta: -.2, direction_delta: -.1}});
  assert.ok(text.includes("近期走弱"));
  assert.ok(text.includes("0.01000 → 0.02000"));
  assert.ok(text.includes("-20.0%"));
  assert.ok(!text.includes("显著"));
});

test("dynamic labels are escaped", () => {
  assert.ok(!evidenceRows([{horizon: '<img src=x>', n: 0}]).includes("<img"));
});
