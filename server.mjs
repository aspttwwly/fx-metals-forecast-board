import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicRoot = join(root, "public");
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

createServer((req, res) => {
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
