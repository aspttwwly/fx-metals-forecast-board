const manifestUrl = "/data/manifest.json";
const visitEndpoint = "/api/visits";
const localVisitKey = "fxForecastBoard.visitCount.v1";
const qualityPanelOffsetKey = "fxForecastBoard.qualityPanelOffset.v2";
const viewPreferenceKey = "fxForecastBoard.interface.v1";
const atlasModePreferenceKey = "fxForecastBoard.atlasMode.v1";

const state = {
  manifest: null,
  data: null,
  symbol: null,
  pinnedSymbol: null,
  requestId: 0,
  visitTracked: false,
  qualityOffset: { x: 0, y: 0 },
  zoomStart: 0,
  zoomEnd: 100,
  view: "observatory",
  atlasWeek: 0,
  atlasData: new Map(),
  atlasBaselines: new Map(),
  atlasTimer: null,
  atlasCamera: { yaw: -0.5, pitch: 0.28, zoom: 1 },
  atlasDragging: null,
  atlasAutoOrbit: false,
  atlasOrbitFrame: null,
  atlasRenderFrame: null,
  atlasMode: "market",
  terrainRange: "3Y",
  terrainMode: "price",
  terrainScaleMode: "local",
  terrainZoomStart: 0,
  terrainZoomEnd: 100,
  terrainSplit: 0.26,
  terrainSplitDragging: false,
  terrainRenderFrame: null,
  terrainSeriesCache: new Map(),
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
  qualityPanel: document.querySelector("[data-quality-panel]"),
  visitCount: document.querySelector("[data-visit-count]"),
  constellationView: document.querySelector("[data-constellation-view]"),
  atlasSvg: document.querySelector("[data-atlas-svg]"),
  atlasNodes: document.querySelector("[data-atlas-nodes]"),
  atlasWeek: document.querySelector("[data-atlas-week]"),
  atlasWeekmarks: document.querySelector("[data-atlas-weekmarks]"),
  atlasPlay: document.querySelector("[data-atlas-play]"),
  atlasField: document.querySelector("[data-atlas-field]"),
  atlasReset: document.querySelector("[data-atlas-reset]"),
  atlasAuto: document.querySelector("[data-atlas-auto]"),
  atlasZoom: document.querySelector("[data-atlas-zoom]"),
  atlasZoomIn: document.querySelector("[data-atlas-zoom-in]"),
  atlasZoomOut: document.querySelector("[data-atlas-zoom-out]"),
  terrainView: document.querySelector("[data-terrain-view]"),
  terrainChart: document.querySelector("[data-terrain-chart]"),
  terrainField: document.querySelector("[data-terrain-field]"),
  terrainTooltip: document.querySelector("[data-terrain-tooltip]"),
  terrainSymbols: document.querySelector("[data-terrain-symbols]"),
  terrainZoomStart: document.querySelector("[data-terrain-zoom-start]"),
  terrainZoomEnd: document.querySelector("[data-terrain-zoom-end]"),
  terrainZoomSlider: document.querySelector("[data-terrain-zoom-slider]"),
  terrainZoomDates: document.querySelector("[data-terrain-zoom-dates]"),
  terrainZoomSummary: document.querySelector("[data-terrain-zoom-summary]"),
  terrainZoomReset: document.querySelector("[data-terrain-zoom-reset]"),
  terrainSplitter: document.querySelector("[data-terrain-splitter]"),
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

function formatInteger(value) {
  if (!Number.isFinite(value)) return "--";
  return Math.round(value).toLocaleString("en-US");
}

function formatPercent(value, digits = 1) {
  if (!Number.isFinite(value)) return "--";
  return `${value.toFixed(digits)}%`;
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

function terrain(name, value) {
  document.querySelectorAll(`[data-terrain="${name}"]`).forEach((node) => {
    node.textContent = value;
  });
}

function quality(name, value) {
  document.querySelectorAll(`[data-quality="${name}"]`).forEach((node) => {
    node.textContent = value;
  });
}

function atlas(name, value) {
  document.querySelectorAll(`[data-atlas="${name}"]`).forEach((node) => {
    node.textContent = value;
  });
}

function terrainPage(name, value) {
  document.querySelectorAll(`[data-terrain-page="${name}"]`).forEach((node) => {
    node.textContent = value;
  });
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to fetch ${url}`);
  return response.json();
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function calculateSeriesQuality(series, limit = 52) {
  const comparable = series.filter(
    (point) => !point.future && isFiniteNumber(point.actual) && isFiniteNumber(point.forecast),
  );
  const recent = comparable.slice(-limit);
  const absoluteErrors = recent.map((point) => Math.abs(point.actual - point.forecast));
  const percentageErrors = recent
    .filter((point) => Math.abs(point.actual) > Number.EPSILON)
    .map((point) => Math.abs((point.actual - point.forecast) / point.actual));
  const bandChecks = recent.filter(
    (point) => isFiniteNumber(point.lower) && isFiniteNumber(point.upper),
  );
  const covered = bandChecks.filter((point) => point.actual >= point.lower && point.actual <= point.upper).length;
  const mae = mean(absoluteErrors);
  const mape = mean(percentageErrors);
  const rmse = absoluteErrors.length
    ? Math.sqrt(mean(absoluteErrors.map((value) => value * value)))
    : null;
  const coverage = bandChecks.length ? covered / bandChecks.length : null;

  return {
    samples: recent.length,
    mae,
    mape,
    rmse,
    coverage,
  };
}

function calculateForecastQuality(data) {
  return calculateSeriesQuality(data.series, 52);
}

function qualityGrade(metrics) {
  if (!metrics.samples || !Number.isFinite(metrics.mape)) return "样本不足";
  const mape = metrics.mape * 100;
  const coverage = Number.isFinite(metrics.coverage) ? metrics.coverage * 100 : null;

  if (mape <= 1.5 && (coverage === null || coverage >= 72)) return "较高";
  if (mape <= 3.5 && (coverage === null || coverage >= 58)) return "中等";
  return "偏低";
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function qualityScore(metrics) {
  if (!metrics.samples || !Number.isFinite(metrics.mape)) return 32;
  const errorScore = clamp(100 - metrics.mape * 100 * 18, 18, 98);
  const coverageScore = Number.isFinite(metrics.coverage) ? metrics.coverage * 100 : 58;
  return clamp(errorScore * 0.68 + coverageScore * 0.32, 18, 96);
}

function standardDeviation(values) {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function percentileRank(values, value) {
  const valid = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!valid.length || !Number.isFinite(value)) return 0.5;
  const below = valid.filter((item) => item < value).length;
  const equal = valid.filter((item) => item === value).length;
  return clamp((below + equal * 0.5) / valid.length, 0, 1);
}

function uncertaintyPercent(point) {
  if (!isFiniteNumber(point?.forecast) || !point.forecast || !isFiniteNumber(point.lower) || !isFiniteNumber(point.upper)) return null;
  return (Math.abs(point.upper - point.lower) / Math.abs(point.forecast)) * 50;
}

function buildAtlasBaseline(data) {
  const actual = data.series.filter((point) => !point.future && isFiniteNumber(point.actual)).slice(-53);
  const returns = actual.slice(1).map((point, index) => ((point.actual / actual[index].actual) - 1) * 100);
  const realizedVolatility = Math.max(standardDeviation(returns), 0.05);

  const comparable = data.series.filter(
    (point) => !point.future && isFiniteNumber(point.actual) && isFiniteNumber(point.forecast),
  );
  const qualityHistory = [];
  for (let end = 16; end <= comparable.length; end += 4) {
    qualityHistory.push(qualityScore(calculateSeriesQuality(comparable.slice(0, end), 52)));
  }
  const uncertaintyHistory = data.series
    .filter((point) => !point.future)
    .map(uncertaintyPercent)
    .filter(Number.isFinite);

  return { realizedVolatility, qualityHistory, uncertaintyHistory };
}

function renderQuality(data) {
  const metrics = calculateForecastQuality(data);

  quality("grade", qualityGrade(metrics));
  quality("mape", Number.isFinite(metrics.mape) ? formatPercent(metrics.mape * 100, 2) : "--");
  quality("mae", Number.isFinite(metrics.mae) ? formatNumber(metrics.mae) : "--");
  quality("rmse", Number.isFinite(metrics.rmse) ? formatNumber(metrics.rmse) : "--");
  quality("coverage", Number.isFinite(metrics.coverage) ? formatPercent(metrics.coverage * 100, 0) : "--");
  quality("note", `${metrics.samples || 0} 个历史重叠样本 / 最近 52 期窗口`);
}

function updateVisitCount(value, scope = "") {
  if (!els.visitCount) return;
  const label = scope ? `${formatInteger(value)} ${scope}` : formatInteger(value);
  els.visitCount.setAttribute("aria-label", label);
  els.visitCount.textContent = formatInteger(value);
}

function trackLocalVisit() {
  try {
    const current = Number(localStorage.getItem(localVisitKey) || "0");
    const next = Number.isFinite(current) ? current + 1 : 1;
    localStorage.setItem(localVisitKey, String(next));
    updateVisitCount(next, "本机");
  } catch {
    updateVisitCount(1, "本机");
  }
}

async function trackVisit(symbol) {
  if (state.visitTracked || !els.visitCount) return;
  state.visitTracked = true;

  try {
    const response = await fetch(visitEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol, path: location.pathname, at: new Date().toISOString() }),
    });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.includes("application/json")) throw new Error("Visit endpoint unavailable");
    const payload = await response.json();
    if (!Number.isFinite(payload.total)) throw new Error("Visit endpoint returned no total");
    updateVisitCount(payload.total);
  } catch {
    trackLocalVisit();
  }
}

function applyQualityPanelOffset() {
  if (!els.qualityPanel) return;
  els.qualityPanel.style.setProperty("--quality-x", `${state.qualityOffset.x}px`);
  els.qualityPanel.style.setProperty("--quality-y", `${state.qualityOffset.y}px`);
}

function restoreQualityPanelOffset() {
  try {
    const saved = JSON.parse(localStorage.getItem(qualityPanelOffsetKey) || "null");
    if (Number.isFinite(saved?.x) && Number.isFinite(saved?.y)) {
      state.qualityOffset = { x: saved.x, y: saved.y };
    }
  } catch {
    state.qualityOffset = { x: 0, y: 0 };
  }

  applyQualityPanelOffset();
}

function saveQualityPanelOffset() {
  try {
    localStorage.setItem(qualityPanelOffsetKey, JSON.stringify(state.qualityOffset));
  } catch {
    // Dragging still works for the current page even when storage is unavailable.
  }
}

function clampQualityOffset(x, y) {
  const panel = els.qualityPanel;
  const wrap = panel?.parentElement;
  if (!panel || !wrap) return { x, y };

  const panelRect = panel.getBoundingClientRect();
  const wrapRect = wrap.getBoundingClientRect();
  const baseLeft = panelRect.left - state.qualityOffset.x;
  const baseTop = panelRect.top - state.qualityOffset.y;
  const minX = wrapRect.left - baseLeft + 8;
  const maxX = wrapRect.right - baseLeft - panelRect.width - 8;
  const minY = wrapRect.top - baseTop + 8;
  const maxY = wrapRect.bottom - baseTop - panelRect.height - 8;

  return {
    x: Math.min(Math.max(x, minX), maxX),
    y: Math.min(Math.max(y, minY), maxY),
  };
}

function bindQualityPanelDrag() {
  const panel = els.qualityPanel;
  if (!panel) return;
  restoreQualityPanelOffset();

  let drag = null;
  panel.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: state.qualityOffset.x,
      originY: state.qualityOffset.y,
    };
    panel.classList.add("dragging");
    panel.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  panel.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    state.qualityOffset = clampQualityOffset(
      drag.originX + event.clientX - drag.startX,
      drag.originY + event.clientY - drag.startY,
    );
    applyQualityPanelOffset();
  });

  const endDrag = (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag = null;
    panel.classList.remove("dragging");
    saveQualityPanelOffset();
  };

  panel.addEventListener("pointerup", endDrag);
  panel.addEventListener("pointercancel", endDrag);
  panel.addEventListener("dblclick", () => {
    state.qualityOffset = { x: 0, y: 0 };
    applyQualityPanelOffset();
    saveQualityPanelOffset();
  });
}

function currentRouteView(usePreference = true) {
  const requested = new URL(location.href).searchParams.get("view");
  if (["observatory", "constellation", "terrain"].includes(requested)) return requested;
  if (!usePreference) return "observatory";
  try {
    const saved = localStorage.getItem(viewPreferenceKey);
    return ["observatory", "constellation", "terrain"].includes(saved) ? saved : "observatory";
  } catch {
    return "observatory";
  }
}

function currentAtlasMode(usePreference = true) {
  const requested = new URL(location.href).searchParams.get("space");
  if (["market", "tunnel"].includes(requested)) return requested;
  if (!usePreference) return "market";
  try {
    const saved = localStorage.getItem(atlasModePreferenceKey);
    return ["market", "tunnel"].includes(saved) ? saved : "market";
  } catch {
    return "market";
  }
}

function setAtlasMode(mode, options = {}) {
  state.atlasMode = mode === "tunnel" ? "tunnel" : "market";
  document.querySelectorAll("[data-atlas-mode]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.atlasMode === state.atlasMode));
  });
  els.constellationView?.classList.toggle("mode-tunnel", state.atlasMode === "tunnel");
  try {
    localStorage.setItem(atlasModePreferenceKey, state.atlasMode);
  } catch {
    // Local persistence is optional.
  }
  if (options.updateRoute !== false) {
    const url = new URL(location.href);
    if (state.atlasMode === "tunnel") url.searchParams.set("space", "tunnel");
    else url.searchParams.delete("space");
    history.replaceState({ view: state.view, space: state.atlasMode }, "", `${url.pathname}${url.search}${url.hash}`);
  }
  if (state.atlasData.size) renderAtlas();
}

function routeUrl(symbol = state.symbol, view = state.view) {
  const url = new URL(location.href);
  url.pathname = `/${symbol || state.manifest?.defaultSymbol || "USDCNH"}`;
  if (view === "constellation") {
    url.searchParams.set("view", "constellation");
    if (state.atlasMode === "tunnel") url.searchParams.set("space", "tunnel");
    else url.searchParams.delete("space");
  } else if (view === "terrain") {
    url.searchParams.set("view", "terrain");
    url.searchParams.delete("space");
  } else {
    url.searchParams.delete("view");
    url.searchParams.delete("space");
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

function updateDocumentTitle() {
  document.title = state.view === "constellation"
    ? `${state.symbol || "市场"} / 资产预测空间`
    : state.view === "terrain"
      ? `${state.symbol || "市场"} / GMMA 等高线`
      : `${state.symbol || "市场"} / 汇率与贵金属预测观察`;
}

async function setView(view, options = {}) {
  const next = ["constellation", "terrain"].includes(view) ? view : "observatory";
  const previous = state.view;
  state.view = next;
  updateDocumentTitle();
  document.body.dataset.view = next;
  els.constellationView.hidden = next !== "constellation";
  if (els.terrainView) els.terrainView.hidden = next !== "terrain";
  document.querySelectorAll("[data-view-switch]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.viewSwitch === next));
  });
  try {
    localStorage.setItem(viewPreferenceKey, next);
  } catch {
    // Browsing with storage disabled should not block the interface.
  }

  if (options.updateRoute !== false) {
    const method = options.replace ? "replaceState" : "pushState";
    history[method]({ view: next }, "", routeUrl(state.symbol, next));
  }

  if (next === "constellation") {
    await ensureAtlasData();
    renderAtlas();
  } else if (next === "terrain") {
    stopAtlasPulse();
    stopAtlasAutoOrbit();
    await ensureTerrainSeries(state.data);
    renderTerrainPage(state.data);
  } else {
    stopAtlasPulse();
    stopAtlasAutoOrbit();
  }

  if (previous !== next && options.scroll !== false) {
    window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
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
    history.pushState({ view: state.view }, "", routeUrl(symbol, state.view));
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
  ["terrain", "tradeSignals"].forEach((key) => {
    const link = document.querySelector(`[data-download="${key}"]`);
    if (!link) return;
    link.hidden = !data.files[key];
    if (data.files[key]) link.href = data.files[key];
  });

  renderTerrainCard(data);
}

function terrainStateLabel(value) {
  return ({ UP: "上升地形", DOWN: "下降地形", NEUTRAL: "中性地形", UNAVAILABLE: "暂无数据" })[value] || "暂无数据";
}

function tradeDirectionLabel(value) {
  return ({ LONG: "做多", SHORT: "做空", FLAT: "观望" })[value] || "--";
}

function terrainActionLabel(value) {
  return ({
    CONFIRM: "同向确认",
    BLOCK_STRONG_CONFLICT: "强冲突拦截",
    REDUCE_CONFLICT: "反向降仓",
    REDUCE_NEUTRAL: "中性降仓",
    NO_SIGNAL: "无交易信号",
    BYPASS: "过滤已关闭",
  })[value] || "等待信号";
}

function terrainActionNote(value, alignment) {
  if (value === "BLOCK_STRONG_CONFLICT") return "四周策略方向与强地形趋势相反，本期执行信号已拦截。";
  if (value === "REDUCE_CONFLICT") return "四周策略方向与地形相反但强度未达拦截线，本期保留方向并降低仓位。";
  if (value === "CONFIRM") return "四周策略方向与地形趋势一致，按地形强度配置执行仓位。";
  if (value === "NO_SIGNAL") return "预测变化未达到开仓阈值，本期保持观望。";
  if (alignment === "DISABLED") return "地形过滤当前关闭，仅展示诊断数据。";
  return "地形结构不明确，本期采用保守仓位。";
}

function renderTerrainCard(data) {
  const card = document.querySelector("[data-terrain-card]");
  const gateBar = document.querySelector("[data-terrain-gate]");
  const terrainData = data.terrain;
  const trade = data.tradeSignal;
  if (!card || !terrainData || !trade) {
    card?.classList.remove("is-up", "is-down", "is-blocked", "is-flat");
    terrain("state", "暂无地形数据");
    terrain("action", "--");
    terrain("direction", "--");
    terrain("gate", "--");
    terrain("coherence", "--");
    terrain("size", "--");
    terrain("levels", "--");
    terrain("date", "--");
    terrain("note", "等待策略地形数据");
    if (gateBar) gateBar.style.width = "0%";
    return;
  }

  const gate = isFiniteNumber(terrainData.gate) ? clamp(terrainData.gate, 0, 1) : 0;
  const multiplier = isFiniteNumber(trade.sizeMultiplier) ? clamp(trade.sizeMultiplier, 0, 1) : 0;
  const coherence = isFiniteNumber(terrainData.coherence) ? `${Math.round(terrainData.coherence)}/6` : "--";
  const rawDirection = tradeDirectionLabel(trade.rawDirection);
  const finalDirection = tradeDirectionLabel(trade.direction);

  card.classList.toggle("is-up", terrainData.state === "UP");
  card.classList.toggle("is-down", terrainData.state === "DOWN");
  card.classList.toggle("is-blocked", trade.action === "BLOCK_STRONG_CONFLICT");
  card.classList.toggle("is-flat", trade.direction === "FLAT");
  terrain("state", terrainStateLabel(terrainData.state));
  terrain("action", terrainActionLabel(trade.action));
  terrain("direction", `${rawDirection} → ${finalDirection}`);
  terrain("gate", formatPercent(gate * 100, 1));
  terrain("coherence", coherence);
  terrain("size", formatPercent(multiplier * 100, 1));
  terrain("levels", `${formatNumber(trade.takeProfit)} / ${formatNumber(trade.stopLoss)}`);
  terrain("date", terrainData.date || trade.terrainDate || "--");
  terrain("note", terrainActionNote(trade.action, trade.alignment));
  if (gateBar) gateBar.style.width = `${Math.max(2, gate * 100).toFixed(1)}%`;
}

function terrainBaseHistory(data) {
  const source = Array.isArray(data?.terrainSeries) ? data.terrainSeries : [];
  const limit = state.terrainRange === "1Y" ? 260 : state.terrainRange === "3Y" ? 780 : source.length;
  return source.slice(-limit).map((point) => ({ ...point, time: parseDate(point.date).getTime() }));
}

function terrainHistory(data) {
  const source = terrainBaseHistory(data);
  if (source.length < 2) return source;
  const startIndex = Math.floor((state.terrainZoomStart / 100) * (source.length - 1));
  const endIndex = Math.ceil((state.terrainZoomEnd / 100) * (source.length - 1));
  return source.slice(startIndex, Math.max(startIndex + 2, endIndex + 1));
}

function updateTerrainZoomControl(data) {
  const source = terrainBaseHistory(data);
  const start = clamp(state.terrainZoomStart, 0, 95);
  const end = clamp(state.terrainZoomEnd, start + 5, 100);
  state.terrainZoomStart = start;
  state.terrainZoomEnd = end;
  if (els.terrainZoomStart) els.terrainZoomStart.value = String(start);
  if (els.terrainZoomEnd) els.terrainZoomEnd.value = String(end);
  els.terrainZoomSlider?.style.setProperty("--terrain-zoom-start", `${start}%`);
  els.terrainZoomSlider?.style.setProperty("--terrain-zoom-end", `${end}%`);
  if (!source.length) {
    if (els.terrainZoomDates) els.terrainZoomDates.textContent = "--";
    if (els.terrainZoomSummary) els.terrainZoomSummary.textContent = "暂无历史地形数据";
    return;
  }
  const startIndex = Math.floor((start / 100) * (source.length - 1));
  const endIndex = Math.ceil((end / 100) * (source.length - 1));
  const visibleCount = Math.max(1, endIndex - startIndex + 1);
  if (els.terrainZoomDates) els.terrainZoomDates.textContent = `${source[startIndex].date} — ${source[endIndex].date}`;
  if (els.terrainZoomSummary) els.terrainZoomSummary.textContent = start === 0 && end === 100 ? `显示全部 · ${source.length} 个交易日` : `已放大 · ${visibleCount} / ${source.length} 个交易日`;
}

function scheduleTerrainChartRender() {
  if (state.terrainRenderFrame) window.cancelAnimationFrame(state.terrainRenderFrame);
  state.terrainRenderFrame = window.requestAnimationFrame(() => {
    state.terrainRenderFrame = null;
    if (state.data && state.view === "terrain") renderTerrainChart(state.data);
  });
}

function setTerrainZoomWindow(changedSide) {
  const minSpan = 5;
  let start = Number(els.terrainZoomStart?.value ?? state.terrainZoomStart);
  let end = Number(els.terrainZoomEnd?.value ?? state.terrainZoomEnd);
  if (end - start < minSpan) {
    if (changedSide === "start") start = end - minSpan;
    else end = start + minSpan;
  }
  state.terrainZoomStart = clamp(start, 0, 100 - minSpan);
  state.terrainZoomEnd = clamp(end, minSpan, 100);
  updateTerrainZoomControl(state.data);
  scheduleTerrainChartRender();
}

function resetTerrainZoom() {
  state.terrainZoomStart = 0;
  state.terrainZoomEnd = 100;
}

function updateTerrainSplitFromPointer(clientY) {
  const rect = els.terrainChart?.getBoundingClientRect();
  if (!rect?.height) return;
  const svgY = ((clientY - rect.top) / rect.height) * 650;
  state.terrainSplit = clamp((svgY - 30) / (458 - 30), 0.18, 0.58);
  scheduleTerrainChartRender();
}

function bindTerrainHeightSplitter() {
  const splitter = els.terrainSplitter;
  if (!splitter) return;
  const stopDragging = (event) => {
    if (!state.terrainSplitDragging) return;
    state.terrainSplitDragging = false;
    document.body.classList.remove("is-terrain-splitting");
    if (event?.pointerId !== undefined && splitter.hasPointerCapture?.(event.pointerId)) splitter.releasePointerCapture(event.pointerId);
  };
  const startDragging = (event) => {
    event.preventDefault();
    state.terrainSplitDragging = true;
    document.body.classList.add("is-terrain-splitting");
    if (event.pointerId !== undefined) splitter.setPointerCapture?.(event.pointerId);
    updateTerrainSplitFromPointer(event.clientY);
  };
  const continueDragging = (event) => {
    if (!state.terrainSplitDragging) return;
    event.preventDefault();
    updateTerrainSplitFromPointer(event.clientY);
  };
  splitter.addEventListener("pointerdown", startDragging);
  splitter.addEventListener("mousedown", (event) => {
    if (!state.terrainSplitDragging) startDragging(event);
  });
  window.addEventListener("pointermove", continueDragging, { passive: false });
  window.addEventListener("mousemove", continueDragging, { passive: false });
  window.addEventListener("pointerup", stopDragging);
  window.addEventListener("mouseup", stopDragging);
  window.addEventListener("pointercancel", stopDragging);
  splitter.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    state.terrainSplit = clamp(state.terrainSplit + (event.key === "ArrowDown" ? 0.02 : -0.02), 0.18, 0.58);
    renderTerrainChart(state.data);
  });
}

async function ensureTerrainSeries(data) {
  if (!data || Array.isArray(data.terrainSeries)) return;
  if (state.terrainSeriesCache.has(data.symbol)) {
    data.terrainSeries = state.terrainSeriesCache.get(data.symbol);
    return;
  }
  if (!data.terrainSeriesUrl) {
    data.terrainSeries = [];
    return;
  }
  const payload = await fetchJson(data.terrainSeriesUrl);
  const series = Array.isArray(payload?.series) ? payload.series : [];
  state.terrainSeriesCache.set(data.symbol, series);
  data.terrainSeries = series;
}

function terrainPath(points, x, y, getter) {
  return points
    .map((point, index) => `${index ? "L" : "M"} ${x(point.time).toFixed(2)} ${y(getter(point)).toFixed(2)}`)
    .join(" ");
}

function terrainRibbon(points, x, y, lower, upper) {
  if (!points.length) return "";
  const top = points.map((point, index) => `${index ? "L" : "M"} ${x(point.time).toFixed(2)} ${y(upper(point)).toFixed(2)}`).join(" ");
  const bottom = points.slice().reverse().map((point) => `L ${x(point.time).toFixed(2)} ${y(lower(point)).toFixed(2)}`).join(" ");
  return `${top} ${bottom} Z`;
}

function renderTerrainSymbols() {
  if (!els.terrainSymbols || !state.manifest) return;
  els.terrainSymbols.innerHTML = state.manifest.symbols.map((item) => {
    const terrainState = item.terrain?.state || "NEUTRAL";
    const label = terrainState === "UP" ? "上升" : terrainState === "DOWN" ? "下降" : "中性";
    return `<button type="button" data-symbol="${item.symbol}" class="${terrainState.toLowerCase()}" aria-pressed="${item.symbol === state.symbol}"><strong>${item.symbol}</strong><span>${label}</span></button>`;
  }).join("");
}

function numericQuantile(values, q) {
  const sorted = values.filter(isFiniteNumber).slice().sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const mix = position - lower;
  return sorted[lower] * (1 - mix) + sorted[upper] * mix;
}

function densityColor(value) {
  const stops = [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]];
  const scaled = clamp(value, 0, 1) * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(scaled));
  const mix = scaled - index;
  return stops[index].map((channel, channelIndex) => Math.round(channel + (stops[index + 1][channelIndex] - channel) * mix));
}

function divergingColor(value) {
  const strength = clamp(Math.abs(value), 0, 1);
  const base = value >= 0 ? [190, 42, 70] : [50, 88, 190];
  return `rgba(${base[0]},${base[1]},${base[2]},${(0.08 + strength * 0.82).toFixed(3)})`;
}

function buildScalarField(history, mode, yMin, yMax, columns = 340, bins = 170) {
  const count = Math.min(columns, history.length);
  const sampled = Array.from({ length: count }, (_, index) => history[Math.round(index * (history.length - 1) / Math.max(count - 1, 1))]);
  const field = Array.from({ length: bins }, () => Array(count).fill(0));
  let maxDensity = 0;
  sampled.forEach((point, column) => {
    const centers = [...point.fast, ...point.slow].map((ema) => mode === "density" ? ema - point.close : ema);
    const spanFallback = Math.max((yMax - yMin) * 0.012, 1e-8);
    const sigma = Math.max((point.atr || 0) * (mode === "density" ? 0.35 : 0.60), spanFallback);
    for (let row = 0; row < bins; row += 1) {
      const yValue = yMin + (row / Math.max(bins - 1, 1)) * (yMax - yMin);
      let density = 0;
      centers.forEach((center) => {
        const distance = (yValue - center) / sigma;
        density += Math.exp(-0.5 * distance * distance);
      });
      field[row][column] = density;
      maxDensity = Math.max(maxDensity, density);
    }
  });
  field.forEach((row) => row.forEach((value, index) => { row[index] = maxDensity > 0 ? value / maxDensity : 0; }));
  return { field, sampled, bins, columns: count };
}

function drawScalarField(canvas, scalar, bounds) {
  const context = canvas.getContext("2d");
  canvas.width = 1160;
  canvas.height = 650;
  context.clearRect(0, 0, canvas.width, canvas.height);
  const plotWidth = bounds.historyRight - bounds.left;
  const plotHeight = bounds.bottom - bounds.top;
  const cellWidth = plotWidth / scalar.columns;
  const cellHeight = plotHeight / scalar.bins;
  scalar.field.forEach((row, rowIndex) => {
    row.forEach((value, columnIndex) => {
      const [r, g, b] = densityColor(value);
      context.fillStyle = `rgba(${r},${g},${b},${(0.10 + value * 0.78).toFixed(3)})`;
      context.fillRect(bounds.left + columnIndex * cellWidth, bounds.bottom - (rowIndex + 1) * cellHeight, cellWidth + 1, cellHeight + 1);
    });
  });

  context.lineWidth = 0.65;
  [0.20, 0.40, 0.60, 0.80].forEach((level) => {
    context.strokeStyle = `rgba(18,22,18,${0.18 + level * 0.32})`;
    context.beginPath();
    for (let column = 0; column < scalar.columns - 1; column += 1) {
      for (let row = 0; row < scalar.bins - 1; row += 1) {
        const corners = [scalar.field[row][column], scalar.field[row][column + 1], scalar.field[row + 1][column + 1], scalar.field[row + 1][column]];
        const points = [];
        const x0 = bounds.left + column * cellWidth;
        const x1 = x0 + cellWidth;
        const y0 = bounds.bottom - row * cellHeight;
        const y1 = y0 - cellHeight;
        const edge = (a, b, ax, ay, bx, by) => {
          if ((a < level && b >= level) || (a >= level && b < level)) {
            const mix = (level - a) / (b - a);
            points.push([ax + (bx - ax) * mix, ay + (by - ay) * mix]);
          }
        };
        edge(corners[0], corners[1], x0, y0, x1, y0);
        edge(corners[1], corners[2], x1, y0, x1, y1);
        edge(corners[2], corners[3], x1, y1, x0, y1);
        edge(corners[3], corners[0], x0, y1, x0, y0);
        for (let index = 0; index + 1 < points.length; index += 2) {
          context.moveTo(points[index][0], points[index][1]);
          context.lineTo(points[index + 1][0], points[index + 1][1]);
        }
      }
    }
    context.stroke();
  });

  const barX = 1113;
  const gradient = context.createLinearGradient(0, bounds.bottom, 0, bounds.top);
  [0, 0.25, 0.5, 0.75, 1].forEach((stop) => {
    const [r, g, b] = densityColor(stop);
    gradient.addColorStop(stop, `rgb(${r},${g},${b})`);
  });
  context.fillStyle = gradient;
  context.fillRect(barX, bounds.top, 13, bounds.bottom - bounds.top);
}

function ridgeContourPath(history, x, y, scoreNorm, level, sign) {
  let path = "";
  let drawing = false;
  history.forEach((point, index) => {
    const height = scoreNorm[index];
    if (height < level || !point.atr) {
      drawing = false;
      return;
    }
    const offset = point.atr * 0.60 * Math.sqrt(Math.max(0, -2 * Math.log(level / Math.max(height, 1e-6))));
    const command = drawing ? "L" : "M";
    path += `${command} ${x(point.time).toFixed(2)} ${y(point.close + sign * offset).toFixed(2)} `;
    drawing = true;
  });
  return path;
}

function renderTerrainChart(data) {
  if (!els.terrainChart || !els.terrainField) return;
  const history = terrainHistory(data);
  if (!history.length) {
    els.terrainChart.innerHTML = `<text x="580" y="325" text-anchor="middle" class="terrain-empty">暂无 GMMA 历史地形数据</text>`;
    els.terrainField.getContext("2d")?.clearRect(0, 0, els.terrainField.width, els.terrainField.height);
    return;
  }

  const mode = state.terrainMode;
  const width = 1160;
  const left = 72;
  const right = 62;
  const actualTop = 30;
  const priceBottom = 458;
  const splitY = actualTop + clamp(state.terrainSplit, 0.18, 0.58) * (priceBottom - actualTop);
  const actualBottom = splitY - 17;
  const top = splitY + 17;
  const layerTop = 510;
  const layerBottom = 594;
  const anchor = history[history.length - 1];
  const future = futureSeries(data).map((point) => ({ ...point, time: parseDate(point.date).getTime() }));
  const futurePlot = [{ date: anchor.date, time: anchor.time, forecast: anchor.close, lower: anchor.close, upper: anchor.close }, ...future];
  const showFuture = state.terrainZoomEnd === 100 && futurePlot.length > 1 && mode === "price";
  const endTime = showFuture ? futurePlot[futurePlot.length - 1].time : anchor.time;
  const startTime = history[0].time;
  const plotRight = width - right;
  const x = (time) => left + ((time - startTime) / Math.max(endTime - startTime, 1)) * (plotRight - left);
  const historyRight = x(anchor.time);

  let actualMin = Math.min(...history.map((point) => point.close));
  let actualMax = Math.max(...history.map((point) => point.close));
  const actualPad = Math.max((actualMax - actualMin) * 0.10, Math.abs(actualMax) * 0.001);
  actualMin -= actualPad;
  actualMax += actualPad;
  const actualY = (value) => actualBottom - ((value - actualMin) / Math.max(actualMax - actualMin, 1e-12)) * (actualBottom - actualTop);
  const actualPath = terrainPath(history, x, actualY, (point) => point.close);

  const scaleHistory = state.terrainScaleMode === "global" ? terrainBaseHistory(data) : history;
  const deviations = scaleHistory.flatMap((point) => [...point.fast, ...point.slow].map((ema) => ema - point.close));
  const priceValues = scaleHistory.flatMap((point) => [point.close, ...point.fast, ...point.slow]);
  const futurePrices = futurePlot.flatMap((point) => [point.forecast, point.lower, point.upper]).filter(isFiniteNumber);
  let yMin;
  let yMax;
  if (mode === "density") {
    yMin = state.terrainScaleMode === "global" ? Math.min(...deviations) : numericQuantile(deviations, 0.01);
    yMax = state.terrainScaleMode === "global" ? Math.max(...deviations) : numericQuantile(deviations, 0.99);
    const pad = Math.max((yMax - yMin) * (state.terrainScaleMode === "global" ? 0.06 : 0.12), 1e-8);
    yMin -= pad;
    yMax += pad;
  } else {
    yMin = Math.min(...priceValues, ...futurePrices);
    yMax = Math.max(...priceValues, ...futurePrices);
    const pad = Math.max((yMax - yMin) * 0.08, Math.abs(yMax) * 0.002);
    yMin -= pad;
    yMax += pad;
  }
  const y = (value) => priceBottom - ((value - yMin) / Math.max(yMax - yMin, 1e-12)) * (priceBottom - top);
  const scalar = buildScalarField(history, mode, yMin, yMax);
  drawScalarField(els.terrainField, scalar, { left, historyRight, top, bottom: priceBottom });

  const scores = history.map((point) => point.score || 0);
  const scoreLo = numericQuantile(scores, 0.05);
  const scoreHi = Math.max(numericQuantile(scores, 0.95), scoreLo + 1e-12);
  const scoreNorm = scores.map((value) => clamp((value - scoreLo) / (scoreHi - scoreLo), 0, 1));
  const yTicks = axisTicks(yMin, yMax, 5);
  const xTicks = Array.from({ length: 6 }, (_, index) => startTime + ((endTime - startTime) * index) / 5);

  const ridgeLines = mode === "price" ? [0.25, 0.45, 0.65, 0.85].flatMap((level) => [-1, 1].map((sign) => `<path class="terrain-ridge level-${String(level).replace(".", "-")}" d="${ridgeContourPath(history, x, y, scoreNorm, level, sign)}"></path>`)).join("") : "";
  const closeSegments = mode === "price" ? history.slice(0, -1).map((point, index) => {
    const next = history[index + 1];
    const signedGate = (point.gate || 0) * Math.sign(point.trend || 0);
    const color = signedGate >= 0 ? `rgba(190,42,70,${(0.35 + Math.abs(signedGate) * 0.65).toFixed(3)})` : `rgba(50,88,190,${(0.35 + Math.abs(signedGate) * 0.65).toFixed(3)})`;
    return `<line class="terrain-energy-segment" x1="${x(point.time)}" y1="${y(point.close)}" x2="${x(next.time)}" y2="${y(next.close)}" stroke="${color}" stroke-width="${(0.9 + scoreNorm[index] * 2.4).toFixed(2)}"></line>`;
  }).join("") : "";

  const areaScales = Array.from({ length: 6 }, (_, layer) => Math.max(numericQuantile(history.map((point) => Math.abs(point.area?.[layer] || 0)), 0.95), 1e-12));
  const weights = [0.35, 0.25, 0.18, 0.12, 0.07, 0.03];
  const layerStride = Math.max(1, Math.ceil(history.length / 190));
  const layerCells = [];
  for (let index = 0; index < history.length; index += layerStride) {
    const point = history[index];
    const next = history[Math.min(index + layerStride, history.length - 1)];
    const master = Math.sign(point.d?.[0] || 0);
    for (let layer = 0; layer < 6; layer += 1) {
      const aligned = Math.sign(point.d?.[layer] || 0) === master && master !== 0;
      const magnitude = clamp(Math.abs(point.area?.[layer] || 0) / areaScales[layer], 0, 1) * weights[layer] / weights[0];
      const signed = (aligned ? magnitude : -magnitude) * Math.sign(point.trend || 0);
      const cellY = layerTop + (5 - layer) * ((layerBottom - layerTop) / 6);
      layerCells.push(`<rect x="${x(point.time)}" y="${cellY}" width="${Math.max(1, x(next.time) - x(point.time) + 0.6)}" height="${(layerBottom - layerTop) / 6 + 0.4}" fill="${divergingColor(signed)}"></rect>`);
    }
  }

  const emaDeviationLines = "";
  const futureBand = showFuture ? terrainRibbon(futurePlot, x, y, (point) => point.lower, (point) => point.upper) : "";
  const futureLine = showFuture ? terrainPath(futurePlot, x, y, (point) => point.forecast) : "";

  els.terrainChart.innerHTML = `
    <title>${data.symbol} GMMA 标量密度、能量山脊与未来预测</title>
    <desc>顶部独立显示实际行情，主图区显示十二条 GMMA 经高斯核转换后的标量密度，底部 A1 至 A6 显示转换能量贡献。鼠标悬停可读取具体日期。</desc>
    <defs>
      <linearGradient id="terrain-future-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c18b21" stop-opacity="0.25"></stop><stop offset="1" stop-color="#c18b21" stop-opacity="0.04"></stop></linearGradient>
      <clipPath id="terrain-main-clip"><rect x="${left}" y="${top}" width="${plotRight - left}" height="${priceBottom - top}"></rect></clipPath>
    </defs>
    <rect class="terrain-actual-panel" x="${left}" y="${actualTop}" width="${historyRight - left}" height="${actualBottom - actualTop}"></rect>
    <text class="terrain-actual-label" x="${left}" y="${actualTop - 10}">ACTUAL MARKET / 实际行情走势</text>
    <text class="terrain-actual-axis" x="${left - 10}" y="${actualTop + 5}" text-anchor="end">${formatNumber(actualMax)}</text>
    <text class="terrain-actual-axis" x="${left - 10}" y="${actualBottom}" text-anchor="end">${formatNumber(actualMin)}</text>
    ${yTicks.map((tick) => `<line class="terrain-grid" x1="${left}" x2="${plotRight}" y1="${y(tick)}" y2="${y(tick)}"></line><text class="terrain-axis-label" x="${left - 10}" y="${y(tick) + 4}" text-anchor="end">${mode === "density" ? formatSigned(tick) : formatNumber(tick)}</text>`).join("")}
    ${xTicks.map((tick) => `<line class="terrain-grid vertical" x1="${x(tick)}" x2="${x(tick)}" y1="${actualTop}" y2="${layerBottom}"></line><text class="terrain-axis-label" x="${x(tick)}" y="${layerBottom + 27}" text-anchor="middle">${new Date(tick).toISOString().slice(0, 7)}</text>`).join("")}
    <text class="terrain-scale-label" x="${plotRight}" y="${top - 10}" text-anchor="end">Y-SCALE / ${state.terrainScaleMode === "global" ? "GLOBAL EXTREMES" : "LOCAL DETAIL"}</text>
    <g clip-path="url(#terrain-main-clip)">
      ${emaDeviationLines}${ridgeLines}${closeSegments}
      ${mode === "density" ? `<line class="terrain-zero" x1="${left}" x2="${historyRight}" y1="${y(0)}" y2="${y(0)}"></line>` : ""}
      ${showFuture ? `<path class="terrain-future-band" d="${futureBand}"></path><path class="terrain-future-line" d="${futureLine}"></path>` : ""}
    </g>
    <line class="terrain-now" x1="${historyRight}" x2="${historyRight}" y1="${actualTop}" y2="${layerBottom}"></line>
    <text class="terrain-now-label" x="${historyRight - 7}" y="${top + 14}" text-anchor="end">${state.terrainZoomEnd === 100 ? "NOW" : "WINDOW END"}</text>
    <g class="terrain-layer-energy">${layerCells.join("")}</g>
    ${Array.from({ length: 6 }, (_, index) => `<text class="terrain-layer-label" x="${left - 9}" y="${layerTop + (5 - index + 0.72) * ((layerBottom - layerTop) / 6)}" text-anchor="end">A${index + 1}</text>`).join("")}
    <text class="terrain-gate-label" x="${left}" y="${layerTop - 12}">LAYER ENERGY / 蓝=下降贡献 · 红=上升贡献</text>
    <text class="terrain-density-label" x="1131" y="${top + 8}">1.0</text><text class="terrain-density-label" x="1131" y="${priceBottom}">0</text><text class="terrain-density-label vertical" x="1149" y="${(top + priceBottom) / 2}">DENSITY</text>
    <path class="terrain-actual-halo" d="${actualPath}"></path>
    <path class="terrain-actual-line" d="${actualPath}"></path>
    <circle class="terrain-actual-last" cx="${historyRight}" cy="${actualY(anchor.close)}" r="4.5"></circle>
    <text class="terrain-actual-value" x="${historyRight - 8}" y="${actualY(anchor.close) - 8}" text-anchor="end">${formatNumber(anchor.close)}</text>
    <line class="terrain-cursor" data-terrain-cursor x1="0" x2="0" y1="${actualTop}" y2="${layerBottom}" hidden></line>
    <circle class="terrain-hover-marker" data-terrain-hover-marker cx="0" cy="0" r="5" hidden></circle>
  `;
  if (els.terrainSplitter) {
    els.terrainSplitter.style.top = `${(splitY / 650) * 100}%`;
    els.terrainSplitter.setAttribute("aria-label", `上下拖动调整图形高度。实际行情约 ${Math.round(actualBottom - actualTop)}，等高线约 ${Math.round(priceBottom - top)}`);
  }

  const cursor = els.terrainChart.querySelector("[data-terrain-cursor]");
  const hoverMarker = els.terrainChart.querySelector("[data-terrain-hover-marker]");
  els.terrainChart.onmousemove = (event) => {
    const rect = els.terrainChart.getBoundingClientRect();
    const svgX = ((event.clientX - rect.left) / rect.width) * width;
    const ratio = clamp((svgX - left) / Math.max(historyRight - left, 1), 0, 1);
    const point = history[Math.round(ratio * (history.length - 1))];
    const cursorX = x(point.time);
    cursor.hidden = false;
    cursor.setAttribute("x1", cursorX);
    cursor.setAttribute("x2", cursorX);
    hoverMarker.hidden = false;
    hoverMarker.setAttribute("cx", cursorX);
    hoverMarker.setAttribute("cy", actualY(point.close));
    els.terrainTooltip.innerHTML = `<strong>${point.date}</strong><span>收盘 ${formatNumber(point.close)}</span><span>地形强度 ${formatPercent(point.gate * 100, 1)}</span><span>转化能量/ATR ${formatNumber(point.energyAtr)}</span><span>一致度 ${point.coherence}/6</span>`;
    els.terrainTooltip.hidden = false;
    els.terrainTooltip.style.left = `${clamp(event.clientX - rect.left + 14, 8, rect.width - 180)}px`;
    els.terrainTooltip.style.top = `${clamp(event.clientY - rect.top - 82, 8, rect.height - 110)}px`;
  };
  els.terrainChart.onmouseleave = () => {
    cursor.hidden = true;
    hoverMarker.hidden = true;
    els.terrainTooltip.hidden = true;
  };
}

function renderTerrainPage(data) {
  if (!data || !els.terrainView) return;
  const terrainData = data.terrain;
  const trade = data.tradeSignal;
  terrainPage("symbol", data.symbol);
  terrainPage("subtitle", `${data.name} · 日频 GMMA 历史 / 周频未来预测`);
  terrainPage("state", terrainStateLabel(terrainData?.state));
  terrainPage("action", terrainActionLabel(trade?.action));
  terrainPage("direction", `${tradeDirectionLabel(trade?.rawDirection)} → ${tradeDirectionLabel(trade?.direction)}`);
  terrainPage("gate", isFiniteNumber(terrainData?.gate) ? formatPercent(terrainData.gate * 100, 1) : "--");
  terrainPage("coherence", isFiniteNumber(terrainData?.coherence) ? `${Math.round(terrainData.coherence)}/6` : "--");
  terrainPage("energy", isFiniteNumber(terrainData?.energyAtr) ? formatNumber(terrainData.energyAtr) : "--");
  terrainPage("score", isFiniteNumber(terrainData?.trendScore) ? formatNumber(terrainData.trendScore) : "--");
  terrainPage("size", isFiniteNumber(trade?.sizeMultiplier) ? formatPercent(trade.sizeMultiplier * 100, 1) : "--");
  terrainPage("regime", isFiniteNumber(terrainData?.regimeAge) ? `${Math.round(terrainData.regimeAge)} 个交易日` : "--");
  terrainPage("target", formatNumber(trade?.targetPrice));
  terrainPage("levels", `${formatNumber(trade?.takeProfit)} / ${formatNumber(trade?.stopLoss)}`);
  terrainPage("note", terrainActionNote(trade?.action, trade?.alignment));
  els.terrainView.classList.toggle("is-up", terrainData?.state === "UP");
  els.terrainView.classList.toggle("is-down", terrainData?.state === "DOWN");
  document.querySelectorAll("[data-terrain-range]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.terrainRange === state.terrainRange)));
  document.querySelectorAll("[data-terrain-mode]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.terrainMode === state.terrainMode)));
  document.querySelectorAll("[data-terrain-scale]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.terrainScale === state.terrainScaleMode)));
  renderTerrainSymbols();
  updateTerrainZoomControl(data);
  renderTerrainChart(data);
}

function futureSeries(data) {
  return data.series.filter((point) => point.future && isFiniteNumber(point.forecast));
}

function atlasPoint(data, weekIndex) {
  const future = futureSeries(data);
  const point = future[Math.min(weekIndex, Math.max(0, future.length - 1))];
  if (!point) return null;
  const metrics = calculateForecastQuality(data);
  const baseline = state.atlasBaselines.get(data.symbol) || buildAtlasBaseline(data);
  const move = ((point.forecast / data.latestActual.value) - 1) * 100;
  const uncertainty = uncertaintyPercent(point) ?? 0;
  const confidence = clamp(qualityScore(metrics) - weekIndex * 2.2 - uncertainty * 1.2, 8, 96);
  const qualityPercentile = percentileRank(baseline.qualityHistory, confidence);
  const uncertaintyPercentile = percentileRank(baseline.uncertaintyHistory, uncertainty);
  const xSignal = move / baseline.realizedVolatility;
  const ySignal = (qualityPercentile - 0.5) * 2;
  const zSignal = (uncertaintyPercentile - 0.5) * 2;
  return {
    data,
    point,
    metrics,
    move,
    uncertainty,
    confidence,
    xSignal,
    ySignal,
    zSignal,
    qualityPercentile,
    uncertaintyPercentile,
    weekIndex,
  };
}

function atlasSnapshots(weekIndex = state.atlasWeek) {
  return allSymbols()
    .map((symbol) => state.atlasData.get(symbol))
    .filter(Boolean)
    .map((data) => atlasPoint(data, weekIndex))
    .filter(Boolean);
}

function atlasMoveExtent(snapshots) {
  const moves = snapshots.map((snapshot) => Math.abs(snapshot.xSignal));
  return Math.max(1.25, Math.ceil(Math.max(...moves, 0) * 1.15 * 4) / 4);
}

function atlasSpaceExtents(snapshots) {
  return {
    x: atlasMoveExtent(snapshots),
  };
}

function atlasWorldPoint(snapshot, extents) {
  return {
    x: (clamp(snapshot.xSignal, -extents.x, extents.x) / extents.x) * 370,
    y: clamp(snapshot.ySignal, -1, 1) * 220,
    z: clamp(snapshot.zSignal, -1, 1) * 250,
  };
}

function projectWorldPoint(world) {
  const { yaw, pitch, zoom } = state.atlasCamera;
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  const rotatedX = world.x * cosYaw - world.z * sinYaw;
  const yawDepth = world.x * sinYaw + world.z * cosYaw;
  const rotatedY = world.y * cosPitch - yawDepth * sinPitch;
  const depth = world.y * sinPitch + yawDepth * cosPitch;
  const perspective = clamp(860 / (860 - depth * 0.72), 0.62, 1.7);
  return {
    x: 500 + rotatedX * zoom * perspective,
    y: 310 - rotatedY * zoom * perspective,
    depth,
    scale: perspective,
  };
}

function projectAtlasPoint(snapshot, extents) {
  return projectWorldPoint(atlasWorldPoint(snapshot, extents));
}

function worldPath(points) {
  return points.map((point, index) => {
    const position = projectWorldPoint(point);
    return `${index ? "L" : "M"}${position.x.toFixed(1)},${position.y.toFixed(1)}`;
  }).join(" ");
}

function atlasTrailPath(data, extents) {
  return futureSeries(data)
    .map((_, index) => atlasPoint(data, index))
    .filter(Boolean)
    .map((snapshot, index) => {
      const position = projectAtlasPoint(snapshot, extents);
      return `${index ? "L" : "M"}${position.x.toFixed(1)},${position.y.toFixed(1)}`;
    })
    .join(" ");
}

function atlasSceneGrid() {
  const lines = [];
  [-360, -180, 0, 180, 360].forEach((x) => {
    lines.push(`<path class="atlas-grid-3d" d="${worldPath([{ x, y: -220, z: -250 }, { x, y: -220, z: 250 }])}"></path>`);
  });
  [-250, -125, 0, 125, 250].forEach((z) => {
    lines.push(`<path class="atlas-grid-3d" d="${worldPath([{ x: -370, y: -220, z }, { x: 370, y: -220, z }])}"></path>`);
  });

  const axes = [
    { key: "X", className: "x", points: [{ x: -410, y: 0, z: 0 }, { x: 410, y: 0, z: 0 }] },
    { key: "Y", className: "y", points: [{ x: 0, y: -250, z: 0 }, { x: 0, y: 250, z: 0 }] },
    { key: "Z", className: "z", points: [{ x: 0, y: 0, z: -290 }, { x: 0, y: 0, z: 290 }] },
  ];
  const axisMarkup = axes.map((axis) => {
    const negative = projectWorldPoint(axis.points[0]);
    const positive = projectWorldPoint(axis.points[1]);
    return `
      <path class="atlas-axis-3d ${axis.className}" d="${worldPath(axis.points)}"></path>
      <text class="atlas-axis-label-3d ${axis.className}" x="${negative.x}" y="${negative.y - 8}">${axis.key}−</text>
      <text class="atlas-axis-label-3d ${axis.className}" x="${positive.x}" y="${positive.y - 8}">${axis.key}+</text>
    `;
  }).join("");
  return `${lines.join("")}${axisMarkup}`;
}

function setAtlasSpaceCopy(mode) {
  const tunnel = mode === "tunnel";
  text("[data-atlas-space-title]", tunnel ? "TIME TUNNEL / 历史—未来" : "MARKET COORDINATES / 市场坐标");
  document.querySelector('[data-atlas-axis="x"]').textContent = tunnel ? "T−历史 / T+未来" : "X−看跌 / X+看涨";
  document.querySelector('[data-atlas-axis="y"]').textContent = tunnel ? "Y−下跌 / Y+上涨" : "Y−弱 / Y+强";
  document.querySelector('[data-atlas-axis="z"]').textContent = tunnel ? "Z−低估 / Z+高估" : "Z−确定 / Z+不确定";
  document.querySelector('[data-atlas-key="x"]').textContent = tunnel ? "T" : "X";
  document.querySelector('[data-atlas-key="y"]').textContent = "Y";
  document.querySelector('[data-atlas-key="z"]').textContent = "Z";
  document.querySelectorAll("[data-atlas-mode]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.atlasMode === mode));
  });
  els.constellationView?.classList.toggle("mode-tunnel", tunnel);
}

function projectedPolygon(points) {
  return points.map((point) => {
    const projected = projectWorldPoint(point);
    return `${projected.x.toFixed(1)},${projected.y.toFixed(1)}`;
  }).join(" ");
}

function buildTimeTunnel(data) {
  const historical = data.series
    .filter((point) => !point.future && isFiniteNumber(point.actual))
    .slice(-52);
  const future = futureSeries(data);
  const reference = data.latestActual.value;
  const toReturn = (value) => isFiniteNumber(value) ? ((value / reference) - 1) * 100 : null;

  const historyRecords = historical.map((point, index) => ({
    point,
    step: index - historical.length + 1,
    actualReturn: toReturn(point.actual),
    forecastReturn: toReturn(point.forecast),
    error: isFiniteNumber(point.forecast) && point.actual ? ((point.forecast / point.actual) - 1) * 100 : null,
  }));
  const futureRecords = future.map((point, index) => ({
    point,
    step: index + 1,
    forecastReturn: toReturn(point.forecast),
    lowerReturn: toReturn(point.lower),
    upperReturn: toReturn(point.upper),
    uncertainty: uncertaintyPercent(point) ?? 0,
  }));
  const yValues = historyRecords.flatMap((item) => [item.actualReturn, item.forecastReturn])
    .concat(futureRecords.flatMap((item) => [item.forecastReturn, item.lowerReturn, item.upperReturn]))
    .filter(Number.isFinite);
  const zValues = historyRecords.map((item) => Math.abs(item.error)).filter(Number.isFinite)
    .concat(futureRecords.map((item) => item.uncertainty).filter(Number.isFinite));
  const yExtent = Math.max(1, Math.max(...yValues.map(Math.abs), 0) * 1.08);
  const zExtent = Math.max(0.25, Math.max(...zValues, 0) * 1.08);
  const historyDenominator = Math.max(1, historical.length - 1);
  const futureDenominator = Math.max(1, future.length);
  const timeX = (step) => step <= 0 ? (step / historyDenominator) * 370 : (step / futureDenominator) * 370;
  const priceY = (value) => (clamp(value ?? 0, -yExtent, yExtent) / yExtent) * 220;
  const errorZ = (value) => (clamp(value ?? 0, -zExtent, zExtent) / zExtent) * 220;

  return {
    historical,
    future,
    historyRecords,
    futureRecords,
    yExtent,
    zExtent,
    actualWorld: historyRecords.map((item) => ({ x: timeX(item.step), y: priceY(item.actualReturn), z: 0 })),
    historyForecastWorld: historyRecords.filter((item) => Number.isFinite(item.forecastReturn) && Number.isFinite(item.error))
      .map((item) => ({ x: timeX(item.step), y: priceY(item.forecastReturn), z: errorZ(item.error) })),
    futureWorld: futureRecords.map((item) => ({ x: timeX(item.step), y: priceY(item.forecastReturn), z: 0 })),
    futureUpperWorld: futureRecords.map((item) => ({ x: timeX(item.step), y: priceY(item.upperReturn), z: errorZ(item.uncertainty) })),
    futureLowerWorld: futureRecords.map((item) => ({ x: timeX(item.step), y: priceY(item.lowerReturn), z: errorZ(-item.uncertainty) })),
    timeX,
    priceY,
    errorZ,
  };
}

function timeTunnelSceneGrid() {
  const lines = [];
  [-220, -110, 0, 110, 220].forEach((z) => {
    lines.push(`<path class="atlas-grid-3d tunnel" d="${worldPath([{ x: -390, y: -220, z }, { x: 390, y: -220, z }])}"></path>`);
  });
  [-220, 0, 220].forEach((y) => {
    lines.push(`<path class="atlas-grid-3d tunnel" d="${worldPath([{ x: -390, y, z: -220 }, { x: 390, y, z: -220 }])}"></path>`);
  });
  const zeroPlane = projectedPolygon([
    { x: 0, y: -235, z: -235 },
    { x: 0, y: 235, z: -235 },
    { x: 0, y: 235, z: 235 },
    { x: 0, y: -235, z: 235 },
  ]);
  const axes = [
    { labels: ["T−", "T+"], className: "x", points: [{ x: -410, y: 0, z: 0 }, { x: 410, y: 0, z: 0 }] },
    { labels: ["Y−", "Y+"], className: "y", points: [{ x: 0, y: -250, z: 0 }, { x: 0, y: 250, z: 0 }] },
    { labels: ["Z−", "Z+"], className: "z", points: [{ x: 0, y: 0, z: -250 }, { x: 0, y: 0, z: 250 }] },
  ].map((axis) => {
    const negative = projectWorldPoint(axis.points[0]);
    const positive = projectWorldPoint(axis.points[1]);
    return `
      <path class="atlas-axis-3d ${axis.className}" d="${worldPath(axis.points)}"></path>
      <text class="atlas-axis-label-3d ${axis.className}" x="${negative.x}" y="${negative.y - 8}">${axis.labels[0]}</text>
      <text class="atlas-axis-label-3d ${axis.className}" x="${positive.x}" y="${positive.y - 8}">${axis.labels[1]}</text>
    `;
  }).join("");
  return `<polygon class="tunnel-now-plane" points="${zeroPlane}"></polygon>${lines.join("")}${axes}`;
}

function selectedAtlasSnapshot() {
  const selected = state.atlasData.get(state.symbol) || state.atlasData.values().next().value;
  return selected ? atlasPoint(selected, state.atlasWeek) : null;
}

function renderAtlasFocus(snapshot, snapshots) {
  if (!snapshot) return;
  const { data, point, move, confidence } = snapshot;
  const index = allSymbols().indexOf(data.symbol) + 1;
  const lower = isFiniteNumber(point.lower) ? formatNumber(point.lower) : "--";
  const upper = isFiniteNumber(point.upper) ? formatNumber(point.upper) : "--";
  const direction = move > 0.01 ? "上行" : move < -0.01 ? "下行" : "近乎持平";

  atlas("index", `${String(index).padStart(2, "0")} / ${String(snapshots.length).padStart(2, "0")}`);
  atlas("group", data.group);
  atlas("symbol", data.symbol);
  atlas("name", data.name);
  atlas("actual", formatNumber(data.latestActual.value));
  atlas("forecast", formatNumber(point.forecast));
  atlas("move", `${move > 0 ? "+" : ""}${formatPercent(move, 2)}`);
  atlas("confidence", `${Math.round(confidence)} / 100`);
  atlas("uncertainty", formatPercent(snapshot.uncertainty, 2));
  atlas("range", `${lower} — ${upper}`);
  const yRelative = snapshot.ySignal * 50;
  const zRelative = snapshot.zSignal * 50;
  atlas("coordinate", `X ${snapshot.xSignal > 0 ? "+" : ""}${snapshot.xSignal.toFixed(2)}σ / Y ${yRelative >= 0 ? "+" : ""}${yRelative.toFixed(0)} / Z ${zRelative >= 0 ? "+" : ""}${zRelative.toFixed(0)}`);
  atlas("date", point.date);
  atlas("note", `${point.date} 的模型路径指向${direction}，标准化方向强度为 ${snapshot.xSignal > 0 ? "+" : ""}${snapshot.xSignal.toFixed(2)}σ。Y ${yRelative >= 0 ? "+" : ""}${yRelative.toFixed(0)} 表示可靠性相对常态，Z ${zRelative >= 0 ? "+" : ""}${zRelative.toFixed(0)} 表示不确定性相对常态。`);

  const focus = document.querySelector(".atlas-focus");
  focus?.classList.toggle("is-up", move >= 0);
  focus?.classList.toggle("is-down", move < 0);
}

function renderAtlasControls(currentDate) {
  atlas("horizon", `WEEK ${String(state.atlasWeek + 1).padStart(2, "0")}`);
  atlas("date", currentDate || "--");
  atlas("updated", state.manifest.updatedAt.slice(0, 10).replaceAll("-", "."));
  const yawDegrees = Math.round((state.atlasCamera.yaw * 180) / Math.PI);
  const pitchDegrees = Math.round((state.atlasCamera.pitch * 180) / Math.PI);
  atlas("camera", `YAW ${yawDegrees}° / PITCH ${pitchDegrees}° / ${state.atlasCamera.zoom.toFixed(1)}×`);
  atlas("zoom", `${Math.round(state.atlasCamera.zoom * 100)}%`);
  if (els.atlasZoom) els.atlasZoom.value = String(Math.round(state.atlasCamera.zoom * 100));
  els.atlasWeek.value = String(state.atlasWeek);
  els.atlasWeekmarks.innerHTML = Array.from({ length: Number(els.atlasWeek.max) + 1 }, (_, index) => `
    <button type="button" data-atlas-week-jump="${index}" class="${index === state.atlasWeek ? "active" : ""}">
      W${String(index + 1).padStart(2, "0")}
    </button>
  `).join("");
}

function renderTimeTunnel(snapshots, selected) {
  const data = state.atlasData.get(state.symbol) || state.atlasData.values().next().value;
  if (!data || !selected) return;
  const tunnel = buildTimeTunnel(data);
  const bandPoints = tunnel.futureUpperWorld.concat([...tunnel.futureLowerWorld].reverse());
  const band = projectedPolygon(bandPoints);
  const connectorStep = Math.max(1, Math.floor(tunnel.historyRecords.length / 13));
  const errorConnectors = tunnel.historyRecords.map((item, index) => {
    if (index % connectorStep !== 0 || !Number.isFinite(item.forecastReturn) || !Number.isFinite(item.error)) return "";
    const actual = tunnel.actualWorld[index];
    const forecast = {
      x: tunnel.timeX(item.step),
      y: tunnel.priceY(item.forecastReturn),
      z: tunnel.errorZ(item.error),
    };
    const errorClass = item.error >= 0 ? " over" : " under";
    return `<path class="tunnel-error-link${errorClass}" d="${worldPath([actual, forecast])}"></path>`;
  }).join("");
  const selectedFutureIndex = Math.min(state.atlasWeek, Math.max(0, tunnel.futureWorld.length - 1));
  const selectedFuture = tunnel.futureWorld[selectedFutureIndex];
  const selectedUpper = tunnel.futureUpperWorld[selectedFutureIndex];
  const selectedLower = tunnel.futureLowerWorld[selectedFutureIndex];
  const selectionCross = selectedFuture && selectedUpper && selectedLower
    ? `<path class="tunnel-selection-cross" d="${worldPath([selectedLower, selectedUpper])}"></path>`
    : "";

  els.atlasSvg.innerHTML = `
    <defs>
      <linearGradient id="tunnel-band-gradient" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#ad8cff" stop-opacity="0.04" />
        <stop offset="1" stop-color="#ad8cff" stop-opacity="0.28" />
      </linearGradient>
    </defs>
    ${timeTunnelSceneGrid()}
    ${bandPoints.length ? `<polygon class="tunnel-future-band" points="${band}"></polygon>` : ""}
    ${errorConnectors}
    <path class="tunnel-actual-path" d="${worldPath(tunnel.actualWorld)}"></path>
    <path class="tunnel-history-forecast" d="${worldPath(tunnel.historyForecastWorld)}"></path>
    <path class="tunnel-future-path ${selected.move >= 0 ? "up" : "down"}" d="${worldPath(tunnel.futureWorld)}"></path>
    <path class="tunnel-boundary upper" d="${worldPath(tunnel.futureUpperWorld)}"></path>
    <path class="tunnel-boundary lower" d="${worldPath(tunnel.futureLowerWorld)}"></path>
    ${selectionCross}
  `;

  const currentWorld = tunnel.actualWorld[tunnel.actualWorld.length - 1];
  const currentPosition = currentWorld ? projectWorldPoint(currentWorld) : null;
  const futurePosition = selectedFuture ? projectWorldPoint(selectedFuture) : null;
  els.atlasNodes.innerHTML = `
    ${currentPosition ? `
      <div class="tunnel-marker actual" style="--atlas-x:${(currentPosition.x / 10).toFixed(2)}%;--atlas-y:${(currentPosition.y / 6.2).toFixed(2)}%">
        <i></i><strong>NOW / ACTUAL</strong><small>${formatNumber(data.latestActual.value)}</small>
      </div>
    ` : ""}
    ${futurePosition ? `
      <div class="tunnel-marker forecast ${selected.move >= 0 ? "up" : "down"}" style="--atlas-x:${(futurePosition.x / 10).toFixed(2)}%;--atlas-y:${(futurePosition.y / 6.2).toFixed(2)}%">
        <i></i><strong>W${String(state.atlasWeek + 1).padStart(2, "0")} / FORECAST</strong><small>${formatNumber(selected.point.forecast)}</small>
      </div>
    ` : ""}
  `;

  renderAtlasFocus(selected, snapshots);
  const historicalErrors = tunnel.historyRecords.map((item) => Math.abs(item.error)).filter(Number.isFinite);
  atlas("up-count", String(tunnel.historyRecords.length));
  atlas("down-count", String(tunnel.futureRecords.length));
  atlas("avg-move", formatPercent(mean(historicalErrors) || 0, 2));
  text('[data-atlas-stat="one"]', "历史周数");
  text('[data-atlas-stat="two"]', "未来周数");
  text('[data-atlas-stat="three"]', "历史平均绝对误差");
  text('[data-atlas-stat="note"]', "白线为历史实际，金线为历史预测；连接线表示已实现误差，未来半透明空间表示预测区间。");
  renderAtlasControls(selected.point.date);
}

function renderAtlas() {
  if (!state.atlasData.size || !els.atlasSvg || !els.atlasNodes) return;
  const snapshots = atlasSnapshots();
  const selected = selectedAtlasSnapshot();
  setAtlasSpaceCopy(state.atlasMode);
  els.atlasField?.classList.toggle("tunnel-mode", state.atlasMode === "tunnel");
  if (state.atlasMode === "tunnel") {
    renderTimeTunnel(snapshots, selected);
    return;
  }
  const extents = atlasSpaceExtents(snapshots);

  const trails = snapshots.map((snapshot) => {
    const active = snapshot.data.symbol === state.symbol ? " active" : "";
    const direction = snapshot.move >= 0 ? " up" : " down";
    return `<path class="atlas-trail${active}${direction}" d="${atlasTrailPath(snapshot.data, extents)}"></path>`;
  }).join("");

  els.atlasSvg.innerHTML = `
    <defs>
      <filter id="atlas-blur"><feGaussianBlur stdDeviation="12" /></filter>
      <radialGradient id="atlas-core-up"><stop offset="0" stop-color="#ffffff"/><stop offset="0.24" stop-color="#93fff0"/><stop offset="1" stop-color="#19d7bb"/></radialGradient>
      <radialGradient id="atlas-core-down"><stop offset="0" stop-color="#ffffff"/><stop offset="0.24" stop-color="#ffb1d9"/><stop offset="1" stop-color="#ff3f92"/></radialGradient>
    </defs>
    ${atlasSceneGrid()}
    ${trails}
  `;

  const projectedNodes = snapshots.map((snapshot) => ({
    snapshot,
    position: projectAtlasPoint(snapshot, extents),
  })).sort((left, right) => left.position.depth - right.position.depth);

  els.atlasNodes.innerHTML = projectedNodes.map(({ snapshot, position }) => {
    const active = snapshot.data.symbol === state.symbol ? " active" : "";
    const direction = snapshot.move >= 0 ? " up" : " down";
    const size = clamp(58 + snapshot.uncertainty * 9, 58, 92);
    const glow = clamp(16 + snapshot.uncertainty * 9, 18, 54);
    const depthScale = clamp(position.scale, 0.68, 1.42);
    const depthOpacity = clamp(0.5 + depthScale * 0.42, 0.68, 1);
    return `
      <button class="atlas-node${active}${direction}" type="button" data-symbol="${snapshot.data.symbol}"
        style="--atlas-x:${(position.x / 10).toFixed(2)}%;--atlas-y:${(position.y / 6.2).toFixed(2)}%;--atlas-size:${size.toFixed(1)}px;--atlas-glow:${glow.toFixed(1)}px;--atlas-depth-scale:${depthScale.toFixed(3)};--atlas-depth-opacity:${depthOpacity.toFixed(3)}"
        aria-label="${snapshot.data.name}，预期变化 ${formatPercent(snapshot.move, 2)}，可信度 ${Math.round(snapshot.confidence)}，不确定性 ${formatPercent(snapshot.uncertainty, 2)}">
        <span class="atlas-node-core"></span>
        <strong>${snapshot.data.symbol}</strong>
        <small>${snapshot.move > 0 ? "+" : ""}${formatPercent(snapshot.move, 2)}</small>
      </button>
    `;
  }).join("");

  updateActiveInstrument();
  renderAtlasFocus(selected, snapshots);
  const up = snapshots.filter((item) => item.move >= 0).length;
  const averageMove = mean(snapshots.map((item) => Math.abs(item.move))) || 0;
  atlas("up-count", String(up).padStart(2, "0"));
  atlas("down-count", String(snapshots.length - up).padStart(2, "0"));
  atlas("avg-move", formatPercent(averageMove, 2));
  text('[data-atlas-stat="one"]', "上行信号");
  text('[data-atlas-stat="two"]', "下行信号");
  text('[data-atlas-stat="three"]', "平均绝对变化");
  text('[data-atlas-stat="note"]', "X、Y、Z 均以品种自身历史常态为零点；正负代表相对常态的方向与偏离。");
  renderAtlasControls(selected?.point.date);
}

async function ensureAtlasData() {
  if (state.atlasData.size === allSymbols().length) return;
  const records = await Promise.all(allSymbols().map(async (symbol) => [symbol, await fetchJson(`/data/${symbol}.json`)]));
  state.atlasData = new Map(records);
  state.atlasBaselines = new Map(records.map(([symbol, data]) => [symbol, buildAtlasBaseline(data)]));
  const maxWeeks = Math.max(...records.map(([, data]) => futureSeries(data).length), 1);
  els.atlasWeek.max = String(maxWeeks - 1);
}

function scheduleAtlasRender() {
  if (state.atlasRenderFrame) return;
  state.atlasRenderFrame = window.requestAnimationFrame(() => {
    state.atlasRenderFrame = null;
    renderAtlas();
  });
}

function stopAtlasAutoOrbit() {
  state.atlasAutoOrbit = false;
  if (state.atlasOrbitFrame) window.cancelAnimationFrame(state.atlasOrbitFrame);
  state.atlasOrbitFrame = null;
  els.atlasAuto?.classList.remove("active");
  if (els.atlasAuto) els.atlasAuto.textContent = "◎ AUTO ORBIT";
}

function toggleAtlasAutoOrbit() {
  if (state.atlasAutoOrbit) {
    stopAtlasAutoOrbit();
    return;
  }
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  state.atlasAutoOrbit = true;
  els.atlasAuto?.classList.add("active");
  if (els.atlasAuto) els.atlasAuto.textContent = "Ⅱ PAUSE ORBIT";
  let previousTime = 0;
  const orbit = (time) => {
    if (!state.atlasAutoOrbit) return;
    if (previousTime && time - previousTime < 30) {
      state.atlasOrbitFrame = window.requestAnimationFrame(orbit);
      return;
    }
    const delta = previousTime ? Math.min(32, time - previousTime) : 16;
    previousTime = time;
    state.atlasCamera.yaw += delta * 0.00022;
    renderAtlas();
    state.atlasOrbitFrame = window.requestAnimationFrame(orbit);
  };
  state.atlasOrbitFrame = window.requestAnimationFrame(orbit);
}

function resetAtlasCamera() {
  stopAtlasAutoOrbit();
  state.atlasCamera = { yaw: -0.5, pitch: 0.28, zoom: 1 };
  renderAtlas();
}

function setAtlasZoom(value) {
  state.atlasCamera.zoom = clamp(value, 0.45, 2);
  scheduleAtlasRender();
}

function bindAtlasOrbitControls() {
  const field = els.atlasField;
  if (!field) return;

  field.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button, input")) return;
    stopAtlasAutoOrbit();
    state.atlasDragging = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      yaw: state.atlasCamera.yaw,
      pitch: state.atlasCamera.pitch,
    };
    field.classList.add("dragging");
    field.setPointerCapture?.(event.pointerId);
  });

  field.addEventListener("pointermove", (event) => {
    const drag = state.atlasDragging;
    if (!drag || drag.pointerId !== event.pointerId) return;
    state.atlasCamera.yaw = drag.yaw + (event.clientX - drag.x) * 0.009;
    state.atlasCamera.pitch = clamp(drag.pitch + (event.clientY - drag.y) * 0.008, -1.52, 1.52);
    scheduleAtlasRender();
  });

  const endDrag = (event) => {
    if (!state.atlasDragging || state.atlasDragging.pointerId !== event.pointerId) return;
    state.atlasDragging = null;
    field.classList.remove("dragging");
    field.releasePointerCapture?.(event.pointerId);
  };
  field.addEventListener("pointerup", endDrag);
  field.addEventListener("pointercancel", endDrag);

  field.addEventListener("wheel", (event) => {
    event.preventDefault();
    stopAtlasAutoOrbit();
    setAtlasZoom(state.atlasCamera.zoom * Math.exp(-event.deltaY * 0.0012));
  }, { passive: false });

  field.addEventListener("dblclick", (event) => {
    if (event.target.closest("button")) return;
    resetAtlasCamera();
  });

  field.addEventListener("keydown", (event) => {
    const step = 0.12;
    if (event.key === "ArrowLeft") state.atlasCamera.yaw -= step;
    else if (event.key === "ArrowRight") state.atlasCamera.yaw += step;
    else if (event.key === "ArrowUp") state.atlasCamera.pitch = clamp(state.atlasCamera.pitch - step, -1.52, 1.52);
    else if (event.key === "ArrowDown") state.atlasCamera.pitch = clamp(state.atlasCamera.pitch + step, -1.52, 1.52);
    else if (event.key === "+" || event.key === "=") state.atlasCamera.zoom = clamp(state.atlasCamera.zoom + 0.1, 0.45, 2);
    else if (event.key === "-" || event.key === "_") state.atlasCamera.zoom = clamp(state.atlasCamera.zoom - 0.1, 0.45, 2);
    else if (event.key === "0") resetAtlasCamera();
    else return;
    event.preventDefault();
    scheduleAtlasRender();
  });

  els.atlasReset?.addEventListener("click", resetAtlasCamera);
  els.atlasAuto?.addEventListener("click", toggleAtlasAutoOrbit);
  els.atlasZoom?.addEventListener("input", () => {
    stopAtlasAutoOrbit();
    setAtlasZoom(Number(els.atlasZoom.value) / 100);
  });
  els.atlasZoomIn?.addEventListener("click", () => {
    stopAtlasAutoOrbit();
    setAtlasZoom(state.atlasCamera.zoom + 0.1);
  });
  els.atlasZoomOut?.addEventListener("click", () => {
    stopAtlasAutoOrbit();
    setAtlasZoom(state.atlasCamera.zoom - 0.1);
  });
}

function stopAtlasPulse() {
  if (state.atlasTimer) window.clearInterval(state.atlasTimer);
  state.atlasTimer = null;
  els.atlasPlay?.classList.remove("active");
  if (els.atlasPlay) els.atlasPlay.querySelector("span").textContent = "▶";
}

function toggleAtlasPulse() {
  if (state.atlasTimer) {
    stopAtlasPulse();
    return;
  }
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  els.atlasPlay.classList.add("active");
  els.atlasPlay.querySelector("span").textContent = "Ⅱ";
  state.atlasTimer = window.setInterval(() => {
    state.atlasWeek = (state.atlasWeek + 1) % (Number(els.atlasWeek.max) + 1);
    renderAtlas();
  }, 1700);
}

async function loadSymbol(symbol, options = {}) {
  const requestId = ++state.requestId;
  if (state.symbol !== symbol) resetTerrainZoom();
  state.symbol = symbol;
  updateActiveInstrument();
  const data = await fetchJson(`/data/${symbol}.json`);
  if (requestId !== state.requestId) return;
  state.data = data;
  updateActiveInstrument();
  renderSummary(state.data);
  renderQuality(state.data);
  renderChart(state.data);
  renderTable(state.data);
  if (state.view === "constellation" && state.atlasData.size) renderAtlas();
  if (state.view === "terrain") {
    await ensureTerrainSeries(state.data);
    renderTerrainPage(state.data);
  }
  updateDocumentTitle();
}

function bindUi() {
  document.querySelector("[data-prev]").addEventListener("click", () => pinSymbol(siblingSymbol(-1)));
  document.querySelector("[data-next]").addEventListener("click", () => pinSymbol(siblingSymbol(1)));
  document.querySelector("[data-open-risk]")?.addEventListener("click", () => els.riskDialog.showModal());
  document.querySelectorAll("[data-view-switch]").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.viewSwitch));
  });
  document.querySelectorAll("[data-atlas-mode]").forEach((button) => {
    button.addEventListener("click", () => setAtlasMode(button.dataset.atlasMode));
  });
  document.querySelectorAll("[data-terrain-range]").forEach((button) => {
    button.addEventListener("click", () => {
      state.terrainRange = button.dataset.terrainRange;
      resetTerrainZoom();
      renderTerrainPage(state.data);
    });
  });
  document.querySelectorAll("[data-terrain-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      state.terrainMode = button.dataset.terrainMode === "density" ? "density" : "price";
      renderTerrainPage(state.data);
    });
  });
  document.querySelectorAll("[data-terrain-scale]").forEach((button) => {
    button.addEventListener("click", () => {
      state.terrainScaleMode = button.dataset.terrainScale === "global" ? "global" : "local";
      renderTerrainPage(state.data);
    });
  });
  els.terrainZoomStart?.addEventListener("input", () => setTerrainZoomWindow("start"));
  els.terrainZoomEnd?.addEventListener("input", () => setTerrainZoomWindow("end"));
  els.terrainZoomReset?.addEventListener("click", () => {
    resetTerrainZoom();
    renderTerrainPage(state.data);
  });
  bindTerrainHeightSplitter();
  document.querySelector("[data-terrain-prev]")?.addEventListener("click", () => navigateTo(siblingSymbol(-1)));
  document.querySelector("[data-terrain-next]")?.addEventListener("click", () => navigateTo(siblingSymbol(1)));
  els.terrainSymbols?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-symbol]");
    if (button) navigateTo(button.dataset.symbol);
  });
  els.atlasNodes?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-symbol]");
    if (!button) return;
    state.pinnedSymbol = button.dataset.symbol;
    navigateTo(button.dataset.symbol);
    updateActiveInstrument();
    renderAtlas();
  });
  els.atlasWeek?.addEventListener("input", () => {
    stopAtlasPulse();
    state.atlasWeek = Number(els.atlasWeek.value);
    renderAtlas();
  });
  els.atlasWeekmarks?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-atlas-week-jump]");
    if (!button) return;
    stopAtlasPulse();
    state.atlasWeek = Number(button.dataset.atlasWeekJump);
    renderAtlas();
  });
  els.atlasPlay?.addEventListener("click", toggleAtlasPulse);
  bindAtlasOrbitControls();
  bindQualityPanelDrag();
  window.addEventListener("popstate", async () => {
    const routeView = currentRouteView(false);
    state.atlasMode = currentAtlasMode(false);
    state.pinnedSymbol = currentRouteSymbol();
    await loadSymbol(state.pinnedSymbol, { source: "pinned" });
    await setView(routeView, { updateRoute: false });
  });
  window.addEventListener("resize", () => {
    if (state.data) renderChart(state.data);
    if (state.view === "constellation" && state.atlasData.size) renderAtlas();
    if (state.view === "terrain" && state.data) renderTerrainChart(state.data);
    state.qualityOffset = clampQualityOffset(state.qualityOffset.x, state.qualityOffset.y);
    applyQualityPanelOffset();
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
    els.qualityPanel?.addEventListener(eventName, hideChartTooltip);
  });
}

async function init() {
  state.manifest = await fetchJson(manifestUrl);
  state.view = currentRouteView();
  state.atlasMode = currentAtlasMode();
  renderInstrumentRail();
  bindUi();

  const symbol = currentRouteSymbol();
  if (location.pathname === "/") history.replaceState({ view: state.view }, "", routeUrl(symbol, state.view));
  await loadSymbol(symbol, { source: "initial" });
  await setView(state.view, { updateRoute: false });
  await trackVisit(symbol);
}

init().catch((error) => {
  document.body.innerHTML = `<main class="load-error"><h1>数据加载失败</h1><p>${error.message}</p></main>`;
});
