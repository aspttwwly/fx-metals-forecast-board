import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function isTransientDeployFailure(output) {
  if (/authentication error|invalid api token|permission denied|->\s*(401|403)\b/i.test(output)) return false;
  return /->\s*(429|500|502|503|504)\b|\b(?:502|503|504)\s+(?:bad gateway|service unavailable|gateway timeout)|ETIMEDOUT|ECONNRESET|EAI_AGAIN|fetch failed/i.test(output);
}

export function deployWithRetry({ run = spawnSync, log = console.log,
  wait = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
  maxAttempts = 3 } = {}) {
  const attempts = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    log(`Cloudflare deploy attempt ${attempt}/${maxAttempts}`);
    const result = run(process.execPath, [resolve(root, "node_modules/wrangler/bin/wrangler.js"), "deploy"], {
      cwd: root, encoding: "utf8", timeout: 240_000, maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    });
    const output = [result.stdout, result.stderr, result.error?.message].filter(Boolean).join("\n");
    if (output) log(output);
    const exitCode = result.status ?? 1;
    const retryable = exitCode !== 0 && (result.error?.code === "ETIMEDOUT" || isTransientDeployFailure(output));
    attempts.push({ attempt, exitCode, retryable });
    if (exitCode === 0 || !retryable || attempt === maxAttempts) return { exitCode, attempts };
    const delay = attempt * 5_000;
    log(`Cloudflare returned a temporary error; retrying the same artifacts in ${delay / 1000}s.`);
    wait(delay);
  }
  throw new Error("maxAttempts must be positive");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const startedAt = new Date().toISOString();
  const result = deployWithRetry();
  const receiptDir = resolve(root, ".runtime/deploy-receipts");
  mkdirSync(receiptDir, { recursive: true });
  const receiptPath = resolve(receiptDir, `${startedAt.replaceAll(":", "-")}.json`);
  writeFileSync(receiptPath, JSON.stringify({ startedAt, endedAt: new Date().toISOString(),
    status: result.exitCode === 0 ? "SUCCESS" : "FAILED", ...result }, null, 2));
  console.log(`Deploy receipt: ${receiptPath}`);
  process.exitCode = result.exitCode;
}
