export function replayNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(5) : "--";
}

export function replayPercent(value, signed = false) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return `${signed && value > 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
}

export function recentEvidence(row) {
  const recent = row.recent || {};
  if (recent.status === "INSUFFICIENT" || !recent.latest) return `待满 26 周（当前 ${row.n || 0}）`;
  return `${recent.status === "WATCH" ? "近期走弱，需观察" : "未触发走弱阈值"} · RMSE ${replayNumber(recent.prior.rmse)} → ${replayNumber(recent.latest.rmse)} · 相对朴素改善变化 ${replayPercent(recent.skill_delta, true)} · 方向变化 ${replayPercent(recent.direction_delta, true)}`;
}

const escape = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const terrainLabel = (key) => ({NO_SIGNAL: "无方向信号", CONFIRM: "顺势确认", REDUCE_CONFLICT: "逆势减仓", REDUCE_NEUTRAL: "中性减仓", BLOCK_STRONG_CONFLICT: "强冲突拦截", BYPASS: "未启用"})[key] || key;

export function evidenceRows(rows = []) {
  return rows.map((row) => `<tr>
    <td>${escape(row.horizon)} 周</td><td>${escape(row.n ?? 0)}</td>
    <td>${(row.nonoverlap_n_range || [0, 0]).map(escape).join("–")}</td>
    <td>${replayNumber(row.rmse)}</td><td>${replayNumber(row.mae)}</td>
    <td>${replayPercent(row.direction)}${row.n ? `<small class="admission-reason">${row.direction_correct}/${row.n} 命中</small>` : ""}</td>
    <td>${replayPercent(row.skill_naive, true)}</td><td>${replayPercent(row.skill_drift4, true)}</td>
    <td class="replay-recent">${escape(recentEvidence(row))}</td>
  </tr>`).join("") || '<tr><td colspan="9">尚无可评分结果</td></tr>';
}

export function renderReplayEvidence(data) {
  const card = document.querySelector("[data-replay-card]");
  if (!card) return;
  const payload = data.replayEvidence;
  const text = (key, value) => card.querySelector(`[data-replay="${key}"]`).textContent = value;
  text("symbol", data.symbol);
  if (!payload) {
    text("status", "尚未生成双轨证据");
    text("historical", "等待历史回放结果");
    text("live", "等待真实周频汇总");
    text("protocol", "不以旧模型回测替代当前完整链条验证。");
    text("limitations", "历史回放与每日真实留存分开，不能直接解除线上准入限制。");
    card.querySelectorAll("[data-replay-table]").forEach((node) => { node.innerHTML = evidenceRows(); });
    card.querySelector("[data-replay-diagnostics]").innerHTML = "";
    return;
  }
  const historical = payload.historical || {};
  const live = payload.live || {};
  const progress = historical.progress || {};
  const status = {RUNNING: "补测运行中", COMPLETE: "补测完成", FAILED: "补测失败，请检查本地日志", QUEUED: "排队等待"};
  const updated = payload.updatedAt ? new Intl.DateTimeFormat("zh-CN", {timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"}).format(new Date(payload.updatedAt)) : "--";
  text("status", `${status[payload.status] || "补测准备中"} · 快照 ${updated}`);
  text("historical", `${status[progress.status] || "准备中"} · 已回放 ${historical.completed_origins || 0}/${historical.planned_origins || 0} 周（含预热 ${historical.warmup_completed || 0}/${payload.warmupWeeks || 0} 周）${progress.origin ? ` · 当前 ${progress.origin}` : ""}`);
  text("live", `真实快照 ${live.raw_vintages || 0} 次 → 合格 ${live.eligible_unique_weeks || 0} 个预测周；排除未完整周或时点不合格 ${live.excluded_ineligible || 0} 次，同周重复 ${live.duplicate_vintages_not_counted || 0} 次。数据截至 ${live.cutoff || "--"}。`);
  text("protocol", `评分起点 ${payload.scoreStart || "--"} 至 ${payload.scoreEnd || "--"}；冻结行情截至 ${payload.cutoff || "--"}。只统计已成熟目标。参数每 13 周重新选择，18/24/36 月窗口、2 个固定 seed、24 轮退火、3 折独立递推特征；每周保存完整链条当时输出。${payload.purpose === "SMOKE_TEST" ? "当前为试跑，不代表正式补测。" : ""}`);
  text("limitations", (payload.limitations || []).join(" "));
  card.querySelector('[data-replay-table="historical"]').innerHTML = evidenceRows(historical.horizons);
  card.querySelector('[data-replay-table="live"]').innerHTML = evidenceRows(live.horizons);
  card.querySelector("[data-replay-diagnostics]").innerHTML = (historical.horizons || []).map((row) => `<tr>
    <td>${escape(row.horizon)} 周</td><td>${replayNumber(row.rolling?.rmse)}</td><td>${replayPercent(row.rolling?.skill_naive, true)}</td>
    <td>${Object.entries(row.terrain_actions || {}).map(([key, count]) => `${escape(terrainLabel(key))}: ${escape(count)}`).join(" / ") || "--"}</td>
    <td>${row.execution_n || 0} / ${row.n || 0}</td><td>${replayPercent(row.execution_direction_accuracy)}</td>
  </tr>`).join("");
}
