import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { consumerAssetPath } from "./worker/index.js";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const root = process.env.FX_PREVIEW_DIST === "1" ? join(projectRoot, "dist") : projectRoot;
const publicRoot = join(root, "public");
const runtimeRoot = join(projectRoot, ".runtime");
const visitsFile = join(runtimeRoot, "visits.json");
const port = Number(process.env.PORT || 4173);

const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const clean = normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  return clean === "/" ? "/index.html" : clean;
}

function resolveFile(urlPath) {
  const clean = safePath(urlPath);
  const candidates = [
    resolve(root, `.${clean}`),
    resolve(publicRoot, `.${clean}`),
  ];

  for (const candidate of candidates) {
    if (!candidate.startsWith(root) || !existsSync(candidate)) continue;
    const stat = statSync(candidate);
    if (stat.isFile()) return candidate;
  }

  return join(root, "index.html");
}

function readVisitStore() {
  if (!existsSync(visitsFile)) return { total: 0, bySymbol: {}, updatedAt: null };

  try {
    const store = JSON.parse(readFileSync(visitsFile, "utf-8"));
    return {
      total: Number(store.total) || 0,
      bySymbol: store.bySymbol && typeof store.bySymbol === "object" ? store.bySymbol : {},
      updatedAt: store.updatedAt || null,
    };
  } catch {
    return { total: 0, bySymbol: {}, updatedAt: null };
  }
}

function writeVisitStore(store) {
  mkdirSync(runtimeRoot, { recursive: true });
  writeFileSync(visitsFile, JSON.stringify(store, null, 2), "utf-8");
}

function readRequestBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 16_384) {
        req.destroy();
        rejectBody(new Error("Request body too large"));
      }
    });
    req.on("end", () => resolveBody(body));
    req.on("error", rejectBody);
  });
}

async function handleVisitRequest(req, res) {
  const cleanPath = decodeURIComponent((req.url || "/").split("?")[0]).replace(/\\/g, "/");
  if (cleanPath !== "/api/visits") return false;

  if (req.method !== "GET" && req.method !== "POST") {
    res.writeHead(405, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      Allow: "GET, POST",
    });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return true;
  }

  const store = readVisitStore();
  let symbol = null;

  if (req.method === "POST") {
    try {
      const body = await readRequestBody(req);
      const payload = body ? JSON.parse(body) : {};
      symbol = typeof payload.symbol === "string" ? payload.symbol : null;
    } catch {
      symbol = null;
    }

    store.total += 1;
    if (symbol) store.bySymbol[symbol] = (Number(store.bySymbol[symbol]) || 0) + 1;
    store.updatedAt = new Date().toISOString();
    writeVisitStore(store);
  }

  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(
    JSON.stringify({
      total: store.total,
      symbol,
      symbolTotal: symbol ? Number(store.bySymbol[symbol]) || 0 : null,
      updatedAt: store.updatedAt,
    }),
  );
  return true;
}

createServer(async (req, res) => {
  if (await handleVisitRequest(req, res)) return;

  const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
  if (requestUrl.pathname.startsWith("/api/v1/")) {
    const assetPath = consumerAssetPath(requestUrl.pathname);
    const methodAllowed = req.method === "GET" || req.method === "HEAD";
    const candidate = assetPath && !requestUrl.search ? resolveFile(assetPath) : null;
    const available = candidate && extname(candidate) === ".json";
    const status = !methodAllowed ? 405 : available ? 200 : 404;
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff", ...(!methodAllowed ? { Allow: "GET, HEAD" } : {}) });
    if (req.method === "HEAD") res.end();
    else if (status === 200) createReadStream(candidate).pipe(res);
    else res.end(JSON.stringify({ error: status === 405 ? "Method not allowed" : "Forecast generation is not available" }));
    return;
  }

  const file = resolveFile(req.url || "/");
  const type = types[extname(file)] || "application/octet-stream";

  res.writeHead(200, {
    "Content-Type": type,
    "Cache-Control": "no-store",
  });

  createReadStream(file).pipe(res);
}).listen(port, "127.0.0.1", () => {
  console.log(`Forecast board running at http://127.0.0.1:${port}/USDCNH`);
});
