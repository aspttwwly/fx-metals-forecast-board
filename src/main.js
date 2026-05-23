const manifestUrl = "/data/manifest.json";
const state = {
  manifest: null,
  data: null,
  symbol: null,
  pinnedSymbol: null,
  requestId: 0,
  zoomStart: 0,
  zoomEnd: 100,
};

const els = {
  instruments: document.querySelector("[data-instruments]"),
  chart: document.querySelector("[data-chart]"),
  tooltip: document.querySelector("[data-tooltip]"),
  table: document.querySelector("[data-table]"),
  riskDialog: document.querySelector("[data-risk-dialog]"),
  dockState: document.querySelector("[data-dock-state]"),
  zoomStart: document.querySelector("[data-zoom-start]"),
  zoomEnd: document.querySelector("[data-zoom-end]"),
  zoomWindow: document.querySelector("[data-zoom-window]"),
  zoomFrom: document.querySelector("[data-zoom-from]"),
  zoomTo: document.querySelector("[data-zoom-to]"),
  zoomReset: document.querySelector("[data-zoom-reset]"),
  zoomPanel: document.querySelector("[data-zoom-panel]"),
};

const formatDate = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function parseDate(value) {
  return new Date(`${value}T00:00:00`);
}

function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 2 : abs >= 10 ? 4 : 5;
  return Number(value).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatSigned(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatNumber(value)}`;
}

function formatShortDate(value) {
  return formatDate.format(parseDate(value)).slice(0, 7);
}

function text(selector, value) {
  const node = document.querySelector(selector);
  if (node) node.textContent = value;
}

function field(name, value) {
  document.querySelectorAll(`[data-field="${name}"]`).forEach((node) => {
    node.textContent = value;
  });
}

function summary(name, value) {
  document.querySelectorAll(`[data-summary="${name}"]`).forEach((node) => {
    node.textContent = value;
  });
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to fetch ${url}`);
  return response.json();
}

function currentRouteSymbol() {
  const slug = decodeURIComponent(location.pathname).split("/").filter(Boolean)[0];
  const known = state.manifest?.symbols.map((item) => item.symbol) || [];
  return known.includes(slug) ? slug : state.manifest.defaultSymbol;
}

function groupSymbols() {
  return Object.entries(state.manifest.groups).map(([group, symbols]) => ({
    group,
    symbols: symbols.map((symbol) => state.manifest.symbols.find((item) => item.symbol === symbol)),
  }));
}

function allSymbols() {
  return state.manifest.symbols.map((item) => item.symbol);
}

function renderInstrumentRail() {
  const symbols = groupSymbols().flatMap(({ group, symbols }) =>
    symbols.map((item) => ({ ...item, group })),
  );

  els.instruments.innerHTML = symbols
    .map(
      (item) => `
        <button class="instrument-button" type="button" data-symbol="${item.symbol}" aria-label="${item.name}" aria-pressed="false">
          <span class="shape" aria-hidden="true"></span>
          <strong>${item.symbol}</strong>
          <small>${item.group} · ${directionGlyph(item.direction)}</small>
        </button>
      `,
    )
    .join("");

  els.instruments.addEventListener("click", (event) => {
    const button = event.target.closest("[data-symbol]");
    if (!button) return;
    pinSymbol(button.dataset.symbol);
  });

  const handlePreview = (event) => {
    const button = event.target.closest("[data-symbol]");
    if (!button || state.pinnedSymbol) return;
    previewSymbol(button.dataset.symbol);
  };

  els.instruments.addEventListener("pointerover", handlePreview);
  els.instruments.addEventListener("mouseover", handlePreview);

  els.instruments.addEventListener("focusin", (event) => {
    const button = event.target.closest("[data-symbol]");
    if (!button || state.pinnedSymbol) return;
    previewSymbol(button.dataset.symbol);
  });
}

function directionGlyph(direction) {
  if (direction === "上行") return "UP";
  if (direction === "下行") return "DN";
  return "FL";
}

function navigateTo(symbol) {
  if (!symbol) return;
  if (decodeURIComponent(location.pathname).split("/").filter(Boolean)[0] !== symbol) {
    history.pushState({}, "", `/${symbol}`);
  }
  if (symbol !== state.symbol) {
    loadSymbol(symbol, { source: "pinned" });
  }
}

function previewSymbol(symbol) {
  if (!symbol || symbol === state.symbol) return;
  loadSymbol(symbol, { source: "preview" });
}

function pinSymbol(symbol) {
  if (!symbol) return;
  if (state.pinnedSymbol === symbol) {
    state.pinnedSymbol = null;
    updateActiveInstrument();
    return;
  }

  state.pinnedSymbol = symbol;
  navigateTo(symbol);
  updateActiveInstrument();
}

function updateActiveInstrument() {
  document.querySelectorAll("[data-symbol]").forEach((node) => {
    node.classList.toggle("active", node.dataset.symbol === state.symbol);
    node.classList.toggle("pinned", node.dataset.symbol === state.pinnedSymbol);
    node.setAttribute("aria-pressed", String(node.dataset.symbol === state.pinnedSymbol));
  });

  if (els.dockState) {
    els.dockState.textContent = state.pinnedSymbol
      ? `已固定 ${state.pinnedSymbol}`
      : "悬停预览 / 点击固定";
  }
}

function siblingSymbol(delta) {
  const symbols = allSymbols();
  const index = symbols.indexOf(state.symbol);
  return symbols[(index + delta + symbols.length) % symbols.length];
}

function buildDisplaySeries(data) {
  const start = parseDate("2021-01-01").getTime();
  return data.series
    .map((point) => ({ ...point, time: parseDate(point.date).getTime() }))
    .filter((point) => point.time >= start);
}

function zoomSeries(series) {
  if (!series.length || (state.zoomStart <= 0 && state.zoomEnd >= 100)) return series;

  const xMin = Math.min(...series.map((point) => point.time));
  const xMax = Math.max(...series.map((point) => point.time));
  const span = xMax - xMin || 1;
  const startTime = xMin + span * (state.zoomStart / 100);
  const endTime = xMin + span * (state.zoomEnd / 100);
  const firstIndex = series.findIndex((point) => point.time >= startTime);
  const lastIndex = series.findLastIndex((point) => point.time <= endTime);

  if (firstIndex < 0 || lastIndex < 0 || firstIndex > lastIndex) return series;
  return series.slice(Math.max(0, firstIndex - 1), Math.min(series.length, lastIndex + 2));
}

function zoomDateAt(series, percent) {
  if (!series.length) return "--";
  const xMin = Math.min(...series.map((point) => point.time));
  const xMax = Math.max(...series.map((point) => point.time));
  const time = xMin + (xMax - xMin || 1) * (percent / 100);
  return formatDate.format(new Date(time)).slice(0, 7);
}

function syncZoomUi(series) {
  if (!els.zoomStart || !els.zoomEnd) return;

  els.zoomStart.value = String(state.zoomStart);
  els.zoomEnd.value = String(state.zoomEnd);
  els.zoomWindow.style.left = `${state.zoomStart}%`;
  els.zoomWindow.style.right = `${100 - state.zoomEnd}%`;
  els.zoomFrom.textContent = zoomDateAt(series, state.zoomStart);
  els.zoomTo.textContent = zoomDateAt(series, state.zoomEnd);
}

function extent(series) {
  const values = [];
  series.forEach((point) => {
    ["actual", "forecast", "lower", "upper"].forEach((key) => {
      if (point[key] !== null && point[key] !== undefined) values.push(point[key]);
    });
  });

  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min || Math.abs(max) || 1) * 0.12;
  return [min - pad, max + pad];
}

function linePath(points, x, y, key) {
  return points
    .filter((point) => point[key] !== null && point[key] !== undefined)
    .map((point, index) => `${index === 0 ? "M" : "L"} ${x(point.time).toFixed(2)} ${y(point[key]).toFixed(2)}`)
    .join(" ");
}

function bandBoundaryPath(points, x, y, key) {
  return points
    .filter((point) => point[key] !== null && point[key] !== undefined && point.forecast !== null)
    .map((point, index) => `${index === 0 ? "M" : "L"} ${x(point.time).toFixed(2)} ${y(point[key]).toFixed(2)}`)
    .join(" ");
}

function futureForecastPath(points, x, y, latestTime) {
  const valid = points.filter(
    (point) => point.forecast !== null && point.forecast !== undefined && point.time >= latestTime,
  );
  if (valid.length < 2) return "";
  return valid
    .map((point, index) => `${index === 0 ? "M" : "L"} ${x(point.time).toFixed(2)} ${y(point.forecast).toFixed(2)}`)
    .join(" ");
}

function areaPath(points, x, y, lowerKey, upperKey, mix = 1) {
  const valid = points.filter(
    (point) => point.lower !== null && point.upper !== null && point.forecast !== null,
  );
  if (!valid.length) return "";

  const top = valid.map((point) => {
    const upper = point.forecast + (point.upper - point.forecast) * mix;
    return `${x(point.time).toFixed(2)} ${y(upper).toFixed(2)}`;
  });
  const bottom = valid
    .map((point) => {
      const lower = point.forecast - (point.forecast - point.lower) * mix;
      return `${x(point.time).toFixed(2)} ${y(lower).toFixed(2)}`;
    })
    .reverse();

  return `M ${top[0]} L ${top.slice(1).join(" L ")} L ${bottom.join(" L ")} Z`;
}

function axisTicks(min, max, count) {
  const step = (max - min) / Math.max(count - 1, 1);
  return Array.from({ length: count }, (_, index) => min + step * index);
}

function renderChart(data) {
  const fullSeries = buildDisplaySeries(data);
  const series = zoomSeries(fullSeries);
  syncZoomUi(fullSeries);

  const width = 1120;
  const height = 430;
  const pad = { top: 24, right: 24, bottom: 36, left: 66 };
  const chartWidth = width - pad.left - pad.right;
  const chartHeight = height - pad.top - pad.bottom;
  const xMin = Math.min(...series.map((point) => point.time));
  const xMax = Math.max(...series.map((point) => point.time));
  const [yMin, yMax] = extent(series);
  const latestTime = parseDate(data.latestActual.date).getTime();

  const x = (value) => pad.left + ((value - xMin) / (xMax - xMin || 1)) * chartWidth;
  const y = (value) => pad.top + (1 - (value - yMin) / (yMax - yMin || 1)) * chartHeight;

  const yTicks = axisTicks(yMin, yMax, 4);
  const xTicks = axisTicks(xMin, xMax, 5);
  const actualPath = linePath(series, x, y, "actual");
  const forecastPath = linePath(series, x, y, "forecast");
  const futurePath = futureForecastPath(series, x, y, latestTime);
  const futureX = Math.max(pad.left, Math.min(pad.left + chartWidth, x(latestTime)));
  const latestActualPoint = series.find((point) => point.date === data.latestActual.date && point.actual !== null);
  const futureForecastPoint = series.find((point) => point.future && point.forecast !== null);

  els.chart.setAttribute("viewBox", `0 0 ${width} ${height}`);
  els.chart.innerHTML = `
    <defs>
      <pattern id="future-hatch" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="10" stroke="rgba(22,22,22,0.16)" stroke-width="1" />
      </pattern>
      <pattern id="band-hatch-wide" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)">
        <line x1="0" y1="0" x2="0" y2="14" stroke="rgba(22,22,22,0.16)" stroke-width="1" />
      </pattern>
      <filter id="future-glow" x="-20%" y="-80%" width="140%" height="260%">
        <feGaussianBlur stdDeviation="4" result="blur" />
        <feColorMatrix in="blur" type="matrix" values="0 0 0 0 0.1 0 0 0 0 0.42 0 0 0 0 1 0 0 0 0.95 0" result="glow" />
        <feMerge>
          <feMergeNode in="glow" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <filter id="actual-glow" x="-120%" y="-120%" width="340%" height="340%">
        <feGaussianBlur stdDeviation="5" result="blur" />
        <feColorMatrix in="blur" type="matrix" values="1 0 0 0 1 0 0 0 0 0.08 0 0 0 0 0.06 0 0 0 0.9 0" result="glow" />
        <feMerge>
          <feMergeNode in="glow" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
    <rect class="future-zone" fill="url(#future-hatch)" x="${futureX}" y="${pad.top}" width="${pad.left + chartWidth - futureX}" height="${chartHeight}" />
    ${yTicks
      .map(
        (tick) => `
          <line class="grid-line" x1="${pad.left}" x2="${pad.left + chartWidth}" y1="${y(tick)}" y2="${y(tick)}" />
          <text class="axis-label" x="${pad.left - 12}" y="${y(tick) + 4}" text-anchor="end">${formatNumber(tick)}</text>
        `,
      )
      .join("")}
    ${xTicks
      .map((tick) => {
        const label = formatDate.format(new Date(tick)).slice(0, 7);
        return `<text class="axis-label" x="${x(tick)}" y="${height - 10}" text-anchor="middle">${label}</text>`;
      })
      .join("")}
    <path class="forecast-band" fill="url(#band-hatch-wide)" d="${areaPath(series, x, y, "lower", "upper", 1)}"></path>
    <path class="forecast-band-edge" d="${bandBoundaryPath(series, x, y, "upper")}"></path>
    <path class="forecast-band-edge" d="${bandBoundaryPath(series, x, y, "lower")}"></path>
    <path class="actual-line" d="${actualPath}"></path>
    <path class="forecast-line" d="${forecastPath}"></path>
    ${futurePath ? `<path class="future-flow future-flow-shadow" d="${futurePath}" filter="url(#future-glow)"></path>` : ""}
    ${futurePath ? `<path class="future-flow" d="${futurePath}"></path>` : ""}
    ${
      latestActualPoint
        ? `
          <circle class="actual-current-glow" cx="${x(latestActualPoint.time)}" cy="${y(latestActualPoint.actual)}" r="10" filter="url(#actual-glow)"></circle>
          <circle class="actual-current-point" cx="${x(latestActualPoint.time)}" cy="${y(latestActualPoint.actual)}" r="4.8"></circle>
        `
        : ""
    }
    ${
      futureForecastPoint
        ? `<circle class="forecast-point" cx="${x(futureForecastPoint.time)}" cy="${y(futureForecastPoint.forecast)}" r="5"></circle>`
        : ""
    }
  `;

  wireTooltip(series, { width, height, pad, xMin, xMax, x, y });
}

function wireTooltip(series, scale) {
  const wrap = els.chart.parentElement;
  const { pad, xMin, xMax } = scale;

  wrap.onmousemove = (event) => {
    const rect = els.chart.getBoundingClientRect();
    const localX = ((event.clientX - rect.left) / rect.width) * scale.width;
    if (localX < pad.left || localX > scale.width - pad.right) {
      els.tooltip.hidden = true;
      return;
    }
    const time = xMin + ((localX - pad.left) / (scale.width - pad.left - pad.right)) * (xMax - xMin);
    const nearest = series.reduce((best, point) => {
      const current = Math.abs(point.time - time);
      return current < best.distance ? { point, distance: current } : best;
    }, { point: series[0], distance: Infinity }).point;

    els.tooltip.innerHTML = `
      <strong>${nearest.date}</strong>
      实际 ${formatNumber(nearest.actual)}<br />
      预测 ${formatNumber(nearest.forecast)}
    `;
    els.tooltip.hidden = false;
    els.tooltip.style.left = `${Math.min(event.clientX - rect.left + 16, rect.width - 180)}px`;
    els.tooltip.style.top = `${Math.max(event.clientY - rect.top - 28, 8)}px`;
  };

  wrap.onmouseleave = () => {
    els.tooltip.hidden = true;
  };
}

function renderTable(data) {
  const rows = data.series
    .filter((point) => point.actual !== null || point.forecast !== null)
    .slice(-14)
    .reverse();

  els.table.innerHTML = rows
    .map(
      (point) => `
        <tr>
          <td>${point.date}</td>
          <td>${formatNumber(point.actual)}</td>
          <td>${formatNumber(point.forecast)}</td>
          <td>${formatNumber(point.lower)}</td>
          <td>${formatNumber(point.upper)}</td>
        </tr>
      `,
    )
    .join("");
}

function renderSummary(data) {
  const actual = `${data.latestActual.date} / ${formatNumber(data.latestActual.value)}`;
  const forecast = `${data.nextForecast.date} / ${formatNumber(data.nextForecast.value)}`;
  const updated = formatDate.format(parseDate(data.sourceUpdatedAt.slice(0, 10)));
  const generated = formatDate.format(parseDate(data.generatedAt));
  const directionCard = document.querySelector("[data-direction-card]");

  field("symbol", `${data.symbol}`);
  field("latestActual", formatNumber(data.latestActual.value));
  field("nextForecast", formatNumber(data.nextForecast.value));
  field("direction", data.direction);
  field("deviation", formatSigned(data.deviation));
  summary("actual", actual);
  summary("forecast", forecast);
  summary("version", data.modelVersion);
  summary("generated", generated);
  summary("note", `${data.name}：下一期较最新收盘${data.direction} ${formatSigned(data.deviation)}`);
  text('[data-meta="updated"]', updated);

  directionCard.classList.toggle("down", data.direction === "下行");
  directionCard.classList.toggle("flat", data.direction === "持平");

  document.querySelector('[data-download="forecast"]').href = data.files.forecast;
  document.querySelector('[data-download="history"]').href = data.files.history;
  document.querySelector('[data-download="forecast"]').setAttribute("download", `${data.symbol}_forecast.xlsx`);
  document.querySelector('[data-download="history"]').setAttribute("download", `${data.symbol}_diff_0th_diff.xlsx`);
}

async function loadSymbol(symbol, options = {}) {
  const requestId = ++state.requestId;
  state.symbol = symbol;
  updateActiveInstrument();
  const data = await fetchJson(`/data/${symbol}.json`);
  if (requestId !== state.requestId) return;
  state.data = data;
  updateActiveInstrument();
  renderSummary(state.data);
  renderChart(state.data);
  renderTable(state.data);
  document.title = `${symbol} / 汇率与贵金属预测观察`;
}

function bindUi() {
  document.querySelector("[data-prev]").addEventListener("click", () => pinSymbol(siblingSymbol(-1)));
  document.querySelector("[data-next]").addEventListener("click", () => pinSymbol(siblingSymbol(1)));
  document.querySelector("[data-open-risk]")?.addEventListener("click", () => els.riskDialog.showModal());
  window.addEventListener("popstate", () => {
    state.pinnedSymbol = currentRouteSymbol();
    loadSymbol(state.pinnedSymbol, { source: "pinned" });
  });
  window.addEventListener("resize", () => {
    if (state.data) renderChart(state.data);
  });

  const setZoom = (changedSide) => {
    const minSpan = 8;
    let start = Number(els.zoomStart.value);
    let end = Number(els.zoomEnd.value);

    if (end - start < minSpan) {
      if (changedSide === "start") start = end - minSpan;
      if (changedSide === "end") end = start + minSpan;
    }

    state.zoomStart = Math.max(0, Math.min(start, 100 - minSpan));
    state.zoomEnd = Math.min(100, Math.max(end, minSpan));

    if (state.zoomEnd - state.zoomStart < minSpan) {
      state.zoomEnd = Math.min(100, state.zoomStart + minSpan);
    }

    renderChart(state.data);
  };

  els.zoomStart.addEventListener("input", () => setZoom("start"));
  els.zoomEnd.addEventListener("input", () => setZoom("end"));
  els.zoomReset.addEventListener("click", () => {
    state.zoomStart = 0;
    state.zoomEnd = 100;
    renderChart(state.data);
  });

  const hideChartTooltip = (event) => {
    els.tooltip.hidden = true;
    event.stopPropagation();
  };

  ["pointerenter", "pointermove", "mousemove", "mousedown", "touchstart"].forEach((eventName) => {
    els.zoomPanel.addEventListener(eventName, hideChartTooltip);
  });
}

async function init() {
  state.manifest = await fetchJson(manifestUrl);
  renderInstrumentRail();
  bindUi();

  const symbol = currentRouteSymbol();
  if (location.pathname === "/") history.replaceState({}, "", `/${symbol}`);
  await loadSymbol(symbol, { source: "initial" });
}

init().catch((error) => {
  document.body.innerHTML = `<main class="load-error"><h1>数据加载失败</h1><p>${error.message}</p></main>`;
});
