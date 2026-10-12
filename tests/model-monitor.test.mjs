import test from "node:test";
import assert from "node:assert/strict";
import { jevStatusLabel } from "../src/model-monitor.js";

test("region failure stays visible even while governance is evidence-building", () => {
  assert.equal(jevStatusLabel({ jevStatus: "API_ERROR", jevHttpStatus: 451,
    governanceStatus: "EVIDENCE_BUILDING" }), "JEV 当前地区不可用（HTTP 451）");
});
test("legacy errors without details remain explicit failures", () => {
  assert.equal(jevStatusLabel({ jevStatus: "API_ERROR" }), "JEV 调用失败");
  assert.equal(jevStatusLabel({ jevStatus: "INVALID_RESPONSE" }), "JEV 返回结果无效");
});
test("success, missing key and missing report stay distinct", () => {
  assert.equal(jevStatusLabel({ jevStatus: "SHADOW_EVALUATED" }), "影子复核已完成");
  assert.equal(jevStatusLabel({ jevStatus: "UNAVAILABLE_NO_KEY" }), "未配置 JEV 密钥");
  assert.equal(jevStatusLabel({}), "尚未完成影子复核");
});
