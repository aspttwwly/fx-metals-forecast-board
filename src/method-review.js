import { formatPrice } from './number-policy.js?v=20261018-display-v1';

export const REVIEW_URL = '/data/research/USDCHF-weekly-review.json';

export function reviewRows(data, horizon) {
  if (data?.schema !== 'fx-method-review-display/v1' || data.symbol !== 'USDCHF' ||
      data.frequency !== 'weekly' || data.decision !== 'KEEP_CURRENT_METHOD' ||
      data.productionIntegration !== false || data.rows?.length !== 702) throw new Error('方法回放证据不完整');
  if (!Number.isInteger(horizon) || horizon < 1 || horizon > 13) throw new Error('回放期限应为1—13周');
  const rows = data.rows.filter(row => row.horizon === horizon).sort((a, b) => a.target.localeCompare(b.target));
  if (rows.length !== 54 || new Set(rows.map(row => row.origin)).size !== 54 ||
      rows.some(row => !/^\d{4}-\d{2}-\d{2}$/.test(row.target) ||
        ['actual', 'old', 'candidate'].some(key => !Number.isFinite(row[key]) || row[key] <= 0))) throw new Error('回放配对数据不完整');
  return rows;
}

export function reviewCsv(data, horizon) {
  return ['origin,target,horizon,actual,baseline,candidate,scope',
    ...reviewRows(data, horizon).map(r => [r.origin,r.target,r.horizon,r.actual,r.old,r.candidate,'RECENT_REUSED_HISTORICAL_REPLAY'].join(','))].join('\n');
}

const price = value => formatPrice(value, 'USDCHF');
const percent = value => `${(value * 100).toFixed(2)}%`;

function chart(rows, horizon) {
  const width = 1000, height = 320, left = 76, right = 22, top = 18, bottom = 43;
  const values = rows.flatMap(r => [r.actual, r.old, r.candidate]);
  const min = Math.min(...values), max = Math.max(...values), pad = Math.max((max - min) * .12, .00001);
  const lo = min - pad, hi = max + pad;
  const x = index => left + index * (width - left - right) / (rows.length - 1);
  const y = value => top + (hi - value) * (height - top - bottom) / (hi - lo);
  const grid = Array.from({length: 5}, (_, i) => {
    const value = lo + (hi - lo) * i / 4, yy = y(value);
    return `<line x1="${left}" y1="${yy}" x2="${width-right}" y2="${yy}" stroke="#dbe2e8"/><text x="${left-10}" y="${yy+4}" text-anchor="end">${price(value)}</text>`;
  }).join('');
  const lines = [['actual','#172a38',''],['old','#1769ff',''],['candidate','#b45508','6 4']].map(([key,color,dash]) =>
    `<path d="${rows.map((r,i)=>`${i?'L':'M'}${x(i)},${y(r[key])}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="${dash}"/>`).join('');
  const ticks = [0,13,26,40,53].map(i=>`<text x="${x(i)}" y="${height-14}" text-anchor="${i===0?'start':i===53?'end':'middle'}">${rows[i].target}</text>`).join('');
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="USDCHF提前${horizon}周的历史预测与实际收盘对比"><title>同一预测期限、54个历史起点：真实收盘、方法基线、未通过候选</title>${grid}${lines}${ticks}</svg>`;
}

export function renderMethodReview(container, data, horizon = 13, failure = null) {
  if (failure || !data) {
    container.innerHTML = '<h2>USDCHF · 方法回放对比</h2><p role="status">回放证据暂不可用，当前正式参考预测不受影响。</p>';
    return;
  }
  const rows = reviewRows(data, horizon);
  const labels = [['old','方法基线'],['candidate','未通过候选'],['naive','价格不变基准']];
  container.innerHTML = `
    <div class="evidence-card__head"><h2>USDCHF · 方法回放对比</h2><strong class="review-rejected">未通过 · 保留 V0.1.2</strong></div>
    <p class="evidence-card__note">候选为“关闭既有偏差修正＋近12个月条件残差”。基线与候选各完成106个起点，其中52个预热、54个计分；以下主指标按1—13周等权，合计702个配对点。</p>
    <div class="evidence-table-scroll"><table class="evidence-table"><thead><tr><th>完整方法对照</th><th>MAE</th><th>RMSE</th><th>方向命中率</th></tr></thead><tbody>${labels.map(([key,label]) => `<tr><td>${label}</td><td>${price(data.metrics[key].mae)}</td><td>${price(data.metrics[key].rmse)}</td><td>${percent(data.metrics[key].directionAccuracy)}</td></tr>`).join('')}</tbody></table></div>
    <p class="review-verdict">候选MAE增加 ${data.changes.maeIncreasePercent.toFixed(2)}%，RMSE增加 ${data.changes.rmseIncreasePercent.toFixed(2)}%，方向命中率下降 ${Math.abs(data.changes.directionChangePercentagePoints).toFixed(2)} 个百分点；前、后半段MAE分别增加 ${data.changes.halfMaeIncreasePercent.map(x=>x.toFixed(2)+'%').join('、')}。</p>
    <p class="evidence-card__note">换参要求：MAE至少降低3%，RMSE不增加，方向不下降，前后段稳定，至少52个完整起点。本轮四项表现要求均未通过；条件残差只在6/702个计分点启用。方向按相对起点的涨跌符号匹配，不变价基准仅在实际也持平时命中。</p>
    <div class="review-controls"><label>图表预测期限 <select data-review-horizon aria-label="图表预测期限">${Array.from({length:13},(_,i)=>`<option value="${i+1}" ${i+1===horizon?'selected':''}>提前 ${i+1} 周</option>`).join('')}</select></label><span>固定期限对照 · 图表切换不改变上方整体验收结果</span></div>
    <div class="review-legend"><span class="review-actual">真实收盘</span><span class="review-baseline">方法基线回放</span><span class="review-candidate">未通过候选回放</span></div>
    <div class="review-chart">${chart(rows,horizon)}</div>
    <details><summary>查看这54个历史起点的配对数值</summary><div class="evidence-table-scroll review-rows"><table class="evidence-table"><thead><tr><th>历史预测起点</th><th>目标日期</th><th>实际收盘</th><th>方法基线</th><th>未通过候选</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${r.origin}</td><td>${r.target}</td><td>${price(r.actual)}</td><td>${price(r.old)}</td><td>${price(r.candidate)}</td></tr>`).join('')}</tbody></table></div><button type="button" data-review-export>下载当前期限配对 CSV（原始精度）</button></details>
    <p class="evidence-card__note">计分起点：2025-07-11—2026-07-17，目标行情截至2026-10-16。Orange Pi留存的Alpha Vantage UTC行情用于这次研究；上方正式参考预测继续使用既有数据源政策。历史曾用于研究，首次到达与修订版本未知。这是事后回放，不是当年发布档案、当前固定参数验证或交易准入。</p>`;
  container.querySelector('[data-review-horizon]').addEventListener('change', event => renderMethodReview(container, data, Number(event.target.value)));
  container.querySelector('[data-review-export]').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([reviewCsv(data, horizon)], {type:'text/csv;charset=utf-8'}));
    const a = document.createElement('a'); a.href = url; a.download = `USDCHF_method_review_h${horizon}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}
