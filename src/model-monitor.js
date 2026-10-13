export function jevStatusLabel(monitor = {}) {
  if (monitor.jevStatus === "SHADOW_EVALUATED") return "影子复核已完成";
  if (monitor.jevStatus === "UNAVAILABLE_NO_KEY") return "未配置 JEV 密钥";
  if (monitor.jevErrorCode === "REGION_UNAVAILABLE" || monitor.jevHttpStatus === 451) {
    return "JEV 当前地区不可用（HTTP 451）";
  }
  if (monitor.jevStatus === "API_ERROR") {
    const code = Number(monitor.jevHttpStatus);
    return Number.isInteger(code) && code >= 400 && code <= 599
      ? `JEV 调用失败（HTTP ${code}）` : "JEV 调用失败";
  }
  if (monitor.jevStatus === "INVALID_RESPONSE") return "JEV 返回结果无效";
  return "尚未完成影子复核";
}

const reviewLabels = {
  routine: "常规观察", watch: "加密观察", investigate: "建议人工调查",
  evidence_building: "当前证据积累中", insufficient_evidence: "证据不足",
};
const issueLabels = {
  oos_deterioration: "冻结 OOS 表现变化（待核实）",
  forecast_revision: "预测修订与方向翻转", component_disagreement: "预测组件分歧",
  legacy_accuracy: "旧基础模型准确性", data_quality: "数据或流程质量",
  insufficient_evidence: "证据不足，暂不能归因", none: "未发现明显问题",
};
const legacyLabels = {
  competitive: "历史模型具竞争力", mixed: "历史模型表现混合",
  underperforming: "历史模型落后基准", insufficient_evidence: "历史证据不足",
};

function confidenceLabel(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? `${(value * 100).toFixed(0)}%` : "未提供";
}

export function jevReviewView(monitor = {}) {
  const evaluated = monitor.jevStatus === "SHADOW_EVALUATED";
  const reviewed = typeof monitor.jevReviewedAtUtc === "string"
    && /(Z|[+-]\d{2}:\d{2})$/.test(monitor.jevReviewedAtUtc)
    ? new Date(monitor.jevReviewedAtUtc) : null;
  const time = reviewed && Number.isFinite(reviewed.getTime())
    ? new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).format(reviewed) : "暂无复核时间";
  const answer = (labels, key, value) => evaluated && Object.hasOwn(labels, key)
    ? { label: labels[key], confidence: confidenceLabel(value) }
    : { label: evaluated ? "未提供" : "本次无有效意见", confidence: "--" };
  const notes = ["复核范围：当前品种的预测证据与模型风险；三维空间和 GMMA 暂无专属复核。"];
  if (evaluated && monitor.reviewNeed === "evidence_building") {
    notes.push("样本不足时，复核等级按既定规则显示“证据积累中”。");
  }
  if (evaluated && monitor.mainIssue === "oos_deterioration"
      && (monitor.oosObservations == null || Number(monitor.oosObservations) < 13)) {
    notes.push(`冻结 OOS ${monitor.oosObservations == null ? "样本数未知" : `仅 ${monitor.oosObservations} 期` }，未满 13 期；此项仅为调查线索，不能据此确认模型恶化。`);
  }
  return {
    status: jevStatusLabel(monitor),
    review: answer(reviewLabels, monitor.reviewNeed, monitor.reviewConfidence),
    issue: answer(issueLabels, monitor.mainIssue, monitor.mainIssueConfidence),
    legacy: answer(legacyLabels, monitor.legacyAssessment, monitor.legacyAssessmentConfidence),
    model: evaluated && typeof monitor.jevModel === "string" ? monitor.jevModel : "未提供",
    time, note: notes.join(" "),
    confidenceNote: "JEV 置信度表示它对上述分类意见的把握程度，并非涨跌概率、预测胜率或收益保证。",
  };
}
