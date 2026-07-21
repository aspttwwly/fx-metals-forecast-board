const VISIT_TOTAL_KEY = "visits:total";
const VISIT_UPDATED_KEY = "visits:updatedAt";
const SYMBOL_PREFIX = "visits:symbol:";
const PROTECTED_VIEWS = new Set(["constellation", "terrain"]);
const PROTECTED_DOWNLOADS = new Set([
  "/data/files/latest_terrain_snapshot.xlsx",
  "/data/files/latest_trade_signals.xlsx",
]);

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function normalizeSymbol(value) {
  return typeof value === "string" && /^[A-Z0-9]{3,12}$/.test(value) ? value : null;
}

function constantTimeEqual(left, right) {
  const a = String(left ?? "");
  const b = String(right ?? "");
  const length = Math.max(a.length, b.length);
  let different = a.length ^ b.length;
  for (let index = 0; index < length; index += 1) {
    different |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return different === 0;
}

function hasValidCredentials(request, env) {
  const header = request.headers.get("Authorization") || "";
  if (!header.startsWith("Basic ") || !env.SITE_USER || !env.SITE_PASSWORD) return false;
  try {
    const decoded = atob(header.slice(6));
    const separator = decoded.indexOf(":");
    if (separator < 0) return false;
    const user = decoded.slice(0, separator);
    const password = decoded.slice(separator + 1);
    return constantTimeEqual(user, env.SITE_USER) && constantTimeEqual(password, env.SITE_PASSWORD);
  } catch {
    return false;
  }
}

function requiresAuthentication(url) {
  if (PROTECTED_VIEWS.has(url.searchParams.get("view"))) return true;
  if (url.pathname.startsWith("/data/terrain/")) return true;
  return PROTECTED_DOWNLOADS.has(url.pathname);
}

function unauthorized() {
  return new Response("需要用户名和密码才能访问 Constellation / Terrain。", {
    status: 401,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "WWW-Authenticate": 'Basic realm="FX Advanced Research", charset="UTF-8"',
    },
  });
}

async function readNumber(store, key) {
  const value = await store.get(key);
  const number = Number(value || "0");
  return Number.isFinite(number) ? number : 0;
}

async function handleVisits(request, env) {
  const store = env.VISIT_COUNTER;
  if (!store) {
    return json({ error: "VISIT_COUNTER KV binding is missing" }, 503);
  }

  if (request.method !== "GET" && request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let symbol = null;
  let total = await readNumber(store, VISIT_TOTAL_KEY);
  let symbolTotal = null;

  if (request.method === "POST") {
    try {
      const payload = await request.json();
      symbol = normalizeSymbol(payload?.symbol);
    } catch {
      symbol = null;
    }

    total += 1;
    await store.put(VISIT_TOTAL_KEY, String(total));

    if (symbol) {
      const symbolKey = `${SYMBOL_PREFIX}${symbol}`;
      symbolTotal = (await readNumber(store, symbolKey)) + 1;
      await store.put(symbolKey, String(symbolTotal));
    }

    await store.put(VISIT_UPDATED_KEY, new Date().toISOString());
  } else {
    const url = new URL(request.url);
    symbol = normalizeSymbol(url.searchParams.get("symbol"));
    if (symbol) {
      symbolTotal = await readNumber(store, `${SYMBOL_PREFIX}${symbol}`);
    }
  }

  return json({
    total,
    symbol,
    symbolTotal,
    updatedAt: await store.get(VISIT_UPDATED_KEY),
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (requiresAuthentication(url) && !hasValidCredentials(request, env)) {
      return unauthorized();
    }

    if (url.pathname === "/api/visits") {
      return handleVisits(request, env);
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ error: "Not found" }, 404);
    }

    return env.ASSETS.fetch(request);
  },
};
