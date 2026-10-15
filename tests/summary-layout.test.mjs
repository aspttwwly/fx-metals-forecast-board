import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const sidebar = html.match(/<aside class="summary-panel">([\s\S]*?)<\/aside>/)[1];
const details = sidebar.match(/<details\b([^>]*)>([\s\S]*?)<\/details>/);

test("fixed-origin evidence labels match weekly deduplication and non-overlap admission", () => {
  assert.match(html, /新版成熟预测周/);
  assert.doesNotMatch(html, /当前记录（未去重）/);
  assert.match(main, /按每周最早发布版去重，排除旧政策/);
  assert.match(main, /非重叠最小组至少/);
  assert.doesNotMatch(main, /此处当前记录数含同周重复|线上准入门槛暂未改变/);
});

test("technical summary details are collapsed by default and remain keyboard accessible", () => {
  assert.ok(details);
  assert.doesNotMatch(details[1], /\bopen\b/);
  assert.match(details[2], /<summary>参数与运行详情<\/summary>/);
  assert.match(details[2], /tabindex="0"/);
  for (const [kind, key] of [
    ["summary", "version"], ["summary", "generated"],
    ["monitor", "runDate"], ["monitor", "params"], ["monitor", "candidateParams"],
    ["monitor", "rollbackTarget"], ["monitor", "revisions"],
  ]) {
    const binding = `data-${kind}="${key}"`;
    assert.ok(details[2].includes(binding), binding);
    assert.equal(sidebar.split(binding).length - 1, 1, `${binding} must stay uniquely bound`);
  }
});

test("admission, data freshness and evidence warnings remain outside the collapsed details", () => {
  const visible = sidebar.replace(details[0], "");
  for (const key of ["dataCutoff", "jev", "parameterState", "oos", "jevService", "note"]) {
    assert.ok(visible.includes(`data-monitor="${key}"`), key);
  }
  for (const key of ["actual", "forecast", "note"]) {
    assert.ok(visible.includes(`data-summary="${key}"`), key);
  }
});
