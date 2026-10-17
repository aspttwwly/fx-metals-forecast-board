// Presentation only: never replace a historical prediction with the current h0 anchor.
export function forecastBatchPresentation(data) {
  const unit = data.frequencyKey === 'monthly' ? '个月' : '周';
  const horizon = data.selectedHorizon;
  const historyHorizon = data.comparisonHorizon ?? horizon;
  const legacy = data.appVersion === 'V0.1.0';
  const mixedHistory = legacy && data.evidenceMode === 'legacy';
  const research = data.forecastScope === 'WALKFORWARD_RESEARCH_CURRENT';
  const origin = data.latestActual.date;
  const anchor = data.series.find(point => point.date === origin);
  const actualAnchor = !legacy && Number.isFinite(anchor?.actual)
    && Number.isFinite(anchor?.forecast)
    // Permit only floating-point arithmetic noise; do not round or rewrite either field.
    && Math.abs(anchor.forecast - anchor.actual) <= 4 * Number.EPSILON * Math.max(1, Math.abs(anchor.actual), Math.abs(anchor.forecast));
  const future = data.series.filter(point => point.future && Number.isFinite(point.forecast));
  const historicalCount = data.series.filter(point => Number.isFinite(point.historicalForecast)).length;
  const historySource = data.evidenceMode === 'backtest'
    ? (legacy ? '旧版回补' : '历史回测') : (mixedHistory ? '原版历史' : '历史发布');
  const historyLabel = `${historySource} · ${mixedHistory ? '混合期限' : `h${historyHorizon}`}`;
  const futureLabel = legacy ? '原版未来留存' : research ? '本期研究预测' : '本期发布预测';
  const historyDescription = mixedHistory
    ? '历史虚线保留原版混合期限预测，不作为固定期限评分。'
    : `历史虚线：各历史起点的第 ${historyHorizon} ${unit}预测（固定 h=${historyHorizon}），不是同一批路径。`;
  const span = horizon === 1 ? `第 1 ${unit}（h=1）` : `第 1–${horizon} ${unit}（h=1…${horizon}）`;
  const futureDescription = legacy
    ? '未来实线保留原版发布路径及连接点，不改写为实际价。'
    : `${futureLabel}实线：${origin} 起点的${span}。${actualAnchor
      ? 'h=0 是已知实际价锚点，不是历史预测，不计入误差。'
      : '连接点沿用该批次原值，不替换历史预测。'}`;
  const emptyHistory = historicalCount ? '' : data.evidenceMode === 'issued'
    ? ' 所选期限暂无成熟真实发布点；不以回测替代。' : ' 所选期限暂无已完成历史预测点。';
  return {
    origin, actualAnchor, hasFuture: future.length > 0,
    anchorValue: Number.isFinite(anchor?.forecast) ? anchor.forecast : null,
    historyLabel, futureLabel,
    boundaryLabel: legacy ? '原版留存分界' : actualAnchor ? '本期起点 · h0 实际价' : '本期预测分界',
    heading: legacy ? `原版留存分界 · ${origin}` : `本期预测起点 · ${origin}${actualAnchor ? ' · h=0 实际价锚点' : ''}`,
    description: `${historyDescription}${futureDescription}${emptyHistory}`,
  };
}

// A zoomed-away origin must not be pinned to the plot edge as if it were visible.
export function forecastBoundaryLayout(originTime, xMin, xMax, plotLeft, plotRight) {
  if (![originTime, xMin, xMax, plotLeft, plotRight].every(Number.isFinite)
      || xMax <= xMin || plotRight <= plotLeft || originTime < xMin || originTime > xMax) return null;
  const x = plotLeft + (originTime - xMin) / (xMax - xMin) * (plotRight - plotLeft);
  const labelWidth = Math.min(156, plotRight - plotLeft);
  const labelLeft = Math.max(plotLeft, Math.min(x - labelWidth / 2, plotRight - labelWidth));
  return { x, labelLeft, labelWidth, labelCenter: labelLeft + labelWidth / 2 };
}
