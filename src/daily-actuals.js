// Observation-only overlay. Never supplies training targets or forecast errors.
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function dailyObservation(data) {
  const payload = data.dailyActuals;
  if (!payload) return { available: false, rows: [], latest: null };
  if (payload.schema !== 'fx-daily-actuals/v1' || payload.symbol !== data.symbol
      || payload.scope !== 'DAILY_OBSERVED_DISPLAY_ONLY' || payload.frequency !== 'daily'
      || payload.sourceId !== `market-raw/${data.symbol}` || !Array.isArray(payload.rows)
      || !validDate(payload.issueDate) || !validDate(payload.sourceDataCutoff)
      || !validDate(payload.rawDataCutoff) || payload.sourceDataCutoff >= payload.issueDate
      || payload.sourceDataCutoff > payload.rawDataCutoff) {
    throw new Error('日行情来源不符；未混入周/月预测');
  }
  let previous = '';
  for (const row of payload.rows) {
    if (!validDate(row.date) || !Number.isFinite(row.close) || row.close <= 0
        || row.date <= previous || row.date >= payload.issueDate || row.date > payload.sourceDataCutoff) {
      throw new Error('日行情日期或价格异常；未用于展示或评分');
    }
    previous = row.date;
  }
  const latest = payload.rows.at(-1);
  if (!latest || latest.date !== payload.sourceDataCutoff
      || latest.date !== payload.latest?.date || latest.close !== payload.latest?.close) {
    throw new Error('日行情截止与最新收盘不一致');
  }
  return { available: true, rows: payload.rows, latest, sourceId: payload.sourceId };
}

export function observedDisplaySeries(data) {
  const observation = dailyObservation(data);
  const points = new Map(data.series.map(row => [row.date, { ...row, dailyClose: null }]));
  for (const row of observation.rows) {
    if (row.date < (data.historyStart || '2021-01-01')) continue;
    const point = points.get(row.date) || { date: row.date, actual: null, forecast: null,
      historicalForecast: null, lower: null, upper: null, future: false, dailyOnly: true };
    points.set(row.date, { ...point, dailyClose: row.close });
  }
  return [...points.values()].sort((a,b) => a.date.localeCompare(b.date));
}

export function dailyActualsCsv(data) {
  const observation = dailyObservation(data);
  const quoted = value => `"${String(value ?? '').replaceAll('"','""')}"`;
  const rows = observation.rows.filter(row => row.date >= (data.historyStart || '2021-01-01'));
  return '\ufeff' + [['symbol','date','daily_close','scope','source_cutoff'],
    ...rows.map(row => [data.symbol,row.date,row.close,'DAILY_OBSERVED_DISPLAY_ONLY',data.dailyActuals.sourceDataCutoff])]
    .map(row => row.map(quoted).join(',')).join('\r\n');
}
