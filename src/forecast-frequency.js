// Pure display transforms: choosing a period never trains or alters a prediction.
export const FREQUENCIES = Object.freeze({
  weekly: { label: "周频", unit: "周", min: 1, max: 52, defaultHorizon: 13 },
  monthly: { label: "月频", unit: "个月", min: 1, max: 12, defaultHorizon: 3 },
});

export function validateHorizon(frequency, value) {
  const spec = FREQUENCIES[frequency];
  const numeric = Number(value);
  if (!spec || String(value).trim() === "" || !Number.isInteger(numeric) || numeric < spec.min || numeric > spec.max) {
    throw new Error(`请输入 ${spec?.min || 1}–${spec?.max || 12} 的整数`);
  }
  return numeric;
}

export function selectForecast(base, frequency = "weekly", value = 13) {
  const horizon = validateHorizon(frequency, value);
  let data = { ...base, frequencyKey: frequency, selectedHorizon: horizon };
  if (frequency === "monthly") {
    const monthly = base.longHorizon?.monthly;
    if (!monthly || monthly.status !== "RESEARCH_ONLY") {
      throw new Error(monthly?.reason || "月频数据尚未生成；未使用周频结果替代");
    }
    data = { ...data, ...monthly, frequency: "月频", series: monthly.series.map(row => ({...row})),
      forecastScope: "MONTHLY_RESEARCH_AS_ISSUED", sourceUpdatedAt: base.longHorizon.issuedAt,
      generatedAt: base.longHorizon.issuedAt.slice(0, 10),
      modelMonitor: null, modelAdmission: null, parameterLifecycle: null,
      forecastEvidence: null, replayEvidence: null, terrain: null, tradeSignal: null,
      files: {}, researchNote: monthly.note };
  } else {
    data.series = base.series.map(row => ({...row}));
    if (horizon > 13) {
      const weekly = base.longHorizon?.weekly;
      if (!weekly || !weekly.prefixDisplayEqual || weekly.originDate !== base.latestActual.date) {
        throw new Error("长周频数据尚未就绪；保留原 13 周，不外插伪造远期值");
      }
      const oldDates = new Set(data.series.map(row => row.date));
      const future = weekly.series.filter(row => row.horizon > 13 && !oldDates.has(row.date));
      data.series.push(...future.map(row => ({...row})));
      data.researchNote = "前 13 周保持原预测；14–52 周为研究扩展，未独立验证，不沿用 h4 指标或交易准入；远期未提供校准区间。";
    } else {
      data.researchNote = "原周频预测；周期输入只改变显示范围，不重新训练或寻优。";
    }
  }
  data.series.sort((a,b) => a.date.localeCompare(b.date));
  const future = data.series.filter(row => row.future && Number.isFinite(row.forecast));
  if (future.length < horizon) throw new Error(`数据不足：仅有 ${future.length} 期，不能展示 ${horizon} 期`);
  const visible = future.slice(0, horizon);
  const end = visible.at(-1).date;
  data.series = data.series.filter(row => !row.future || row.date <= end);
  data.nextForecast = {date: visible[0].date, value: visible[0].forecast};
  data.selectedEnd = {date: end, value: visible.at(-1).forecast};
  data.deviation = data.nextForecast.value - data.latestActual.value;
  data.direction = data.deviation > 0 ? "上行" : data.deviation < 0 ? "下行" : "持平";
  return data;
}

export function forecastCsv(data, kind = "forecast") {
  const spec = FREQUENCIES[data.frequencyKey];
  const rows = data.series.filter(row => kind === "history" ? row.actual != null : row.future && row.forecast != null);
  const header = ["symbol", "frequency", "date", "horizon", "actual", "forecast", "model_version", "policy_version", "scope", "issued_at", "source_cutoff", "app_version", "evidence_source", "replay_run_id"];
  const quoted = value => `"${String(value ?? "").replaceAll('"','""')}"`;
  const replay=data.forecastScope==='WALKFORWARD_RESEARCH_CURRENT';
  const lines = rows.map((row,index) => [data.symbol, spec.label, row.date, kind === "forecast" ? index+1 : "",
    row.actual, kind === "forecast" ? row.forecast : "", data.modelVersion,
    replay ? data.policyVersion : data.frequencyKey === "monthly" ? data.policyVersion : index >= 13 && kind === "forecast" ? data.longHorizon?.weekly?.policyVersion : data.forecastEvidence?.current?.policyVersion,
    replay ? data.forecastScope : data.frequencyKey === "monthly" ? "MONTHLY_RESEARCH" : index >= 13 && kind === "forecast" ? "WEEKLY_RESEARCH_EXTENSION" : data.forecastScope,
    replay ? '' : data.frequencyKey === "monthly" || (index >= 13 && kind === "forecast") ? data.longHorizon?.issuedAt : data.sourceUpdatedAt,
    replay ? data.walkforward?.cutoff : data.longHorizon?.sourceDataCutoff || data.modelMonitor?.sourceDataCutoff,
    data.appVersion,data.evidenceMode,replay?data.replayRunId:'']);
  return "\ufeff" + [header, ...lines].map(row => row.map(quoted).join(",")).join("\r\n");
}
