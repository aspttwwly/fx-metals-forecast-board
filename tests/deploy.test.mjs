import test from "node:test";
import assert from "node:assert/strict";
import { deployWithRetry } from "../scripts/deploy.mjs";

test("the observed post-upload Cloudflare 504 is retried and can recover", () => {
  const responses = [
    { status: 1, stderr: "Received a malformed response from the API\nGET /accounts/example/workers/workers/board -> 504 Gateway Timeout" },
    { status: 0, stdout: "Deployed board triggers" },
  ];
  const waits = [];
  const result = deployWithRetry({ run: () => responses.shift(), wait: ms => waits.push(ms), log: () => {} });
  assert.equal(result.exitCode, 0);
  assert.equal(result.attempts.length, 2);
  assert.deepEqual(waits, [5000]);
});

test("repeated gateway failure remains a failed build after bounded retries", () => {
  const result = deployWithRetry({ run: () => ({ status: 1, stderr: "GET /workers/board -> 504 Gateway Timeout" }),
    wait: () => {}, log: () => {} });
  assert.equal(result.exitCode, 1);
  assert.equal(result.attempts.length, 3);
});

test("authentication and build configuration failures are not retried", () => {
  for (const stderr of ["GET /workers/board -> 403 Forbidden", "The name in your Wrangler configuration file must match"]) {
    const result = deployWithRetry({ run: () => ({ status: 1, stderr }),
      wait: () => { throw new Error("must not retry"); }, log: () => {} });
    assert.equal(result.exitCode, 1);
    assert.equal(result.attempts.length, 1);
  }
});
