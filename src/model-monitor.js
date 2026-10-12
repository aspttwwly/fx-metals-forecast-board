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
