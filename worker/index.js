const VISIT_TOTAL_KEY = "visits:total";
const VISIT_UPDATED_KEY = "visits:updatedAt";
const SYMBOL_PREFIX = "visits:symbol:";

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

const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

function withSecurityHeaders(response) {
  const patched = new Response(response.body, response);
  for (const [key, value] of Object.entries(securityHeaders)) {
    patched.headers.set(key, value);
  }
  return patched;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/visits") {
      return withSecurityHeaders(await handleVisits(request, env));
    }

    if (url.pathname.startsWith("/api/")) {
      return withSecurityHeaders(json({ error: "Not found" }, 404));
    }

    return withSecurityHeaders(await env.ASSETS.fetch(request));
  },
};
