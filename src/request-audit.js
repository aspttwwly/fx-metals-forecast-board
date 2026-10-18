// Opt-in, local-to-this-tab diagnostics. No requests, response cloning or telemetry.
export function startRequestAudit() {
  const records = { schema: "fx-browser-request-audit/v1", startedAt: new Date().toISOString(), fetches: [], resources: [] };
  const panel = document.createElement("details");
  panel.id = "request-audit";
  panel.open = true;
  panel.style.cssText = "margin:24px;padding:16px;background:#fff;color:#111;border:1px solid #888;position:relative;z-index:2";
  const title = document.createElement("summary");
  title.textContent = "请求量验收（仅本页记录）";
  const output = document.createElement("pre");
  output.id = "request-audit-log";
  output.style.cssText = "max-height:260px;overflow:auto;white-space:pre-wrap;font-size:12px";
  panel.append(title, output);
  document.body.append(panel);
  const pathOf = (value) => {
    const url = new URL(value, location.href);
    return url.origin === location.origin ? url.pathname : `${url.origin}${url.pathname}`;
  };
  function render() {
    output.textContent = JSON.stringify(records);
  }
  const originalFetch = window.fetch.bind(window);
  window.fetch = async function(input, options) {
    const row = { path: pathOf(typeof input === "string" || input instanceof URL ? input : input.url), method: options?.method || input?.method || "GET", startTime: performance.now(), status: "pending" };
    records.fetches.push(row);
    render();
    try {
      const response = await originalFetch(input, options);
      row.status = response.status;
      return response;
    } catch (error) {
      row.status = "failed";
      throw error;
    } finally {
      row.duration = performance.now() - row.startTime;
      render();
    }
  };
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      records.resources.push({ path: pathOf(entry.name), initiatorType: entry.initiatorType,
        startTime: entry.startTime, duration: entry.duration,
        transferSize: entry.transferSize, encodedBodySize: entry.encodedBodySize, decodedBodySize: entry.decodedBodySize,
        responseStatus: entry.responseStatus ?? null });
    }
    render();
  });
  observer.observe({ type: "resource", buffered: true });
  render();
}
