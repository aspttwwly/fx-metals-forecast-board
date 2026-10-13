import test from "node:test";
import assert from "node:assert/strict";
import { jevStatusLabel, jevReviewView } from "../src/model-monitor.js";

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

test("review card distinguishes category confidence and flags thin OOS evidence", () => {
  const view = jevReviewView({ jevStatus: "SHADOW_EVALUATED", reviewNeed: "evidence_building",
    reviewConfidence: 1, mainIssue: "oos_deterioration", mainIssueConfidence: 0.53,
    legacyAssessment: "underperforming", legacyAssessmentConfidence: 0,
    jevModel: "jev-1.13.0", jevReviewedAtUtc: "2026-10-13T14:36:00+00:00", oosObservations: 3 });
  assert.equal(view.review.confidence, "100%");
  assert.equal(view.issue.confidence, "53%");
  assert.equal(view.legacy.confidence, "0%");
  assert.match(view.time, /2026.*10.*13.*22:36:00/);
  assert.match(view.note, /仅 3 期/);
  assert.match(view.note, /既定规则/);
  assert.match(view.confidenceNote, /并非涨跌概率/);
});

test("failed or missing review never presents stale opinions as current", () => {
  const view = jevReviewView({ jevStatus: "API_ERROR", reviewNeed: "routine", reviewConfidence: 0.99,
    mainIssue: "none", mainIssueConfidence: 0.9, jevModel: "old-model" });
  assert.equal(view.review.label, "本次无有效意见");
  assert.equal(view.review.confidence, "--");
  assert.equal(view.model, "未提供");
  assert.equal(view.time, "暂无复核时间");
  assert.equal(jevReviewView().status, "尚未完成影子复核");
});

test("legacy payload and invalid confidence/time never imply an invented probability", () => {
  for (const confidence of [null, undefined, "0.8", true, -1, 2, NaN, Infinity]) {
    const view = jevReviewView({ jevStatus: "SHADOW_EVALUATED", reviewNeed: "watch",
      reviewConfidence: confidence, jevReviewedAtUtc: "2026-10-13" });
    assert.equal(view.review.confidence, "未提供");
    assert.equal(view.time, "暂无复核时间");
  }
});
