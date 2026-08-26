import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildPublicSearchStagingSentinelReceipt,
  parseRailwayNdjson,
} from "./public_search_staging_sentinel_contract.mjs";

const now = new Date("2026-08-26T03:00:00.000Z");
const commit = "64acfec8927edc7c9cb4f130fdfe4eff81c80966";

async function stagingSentinel() {
  return JSON.parse(
    await readFile(
      new URL("../docs/ops/public-search-staging-sentinel.json", import.meta.url),
      "utf8",
    ),
  );
}

function deployment({
  id = "deployment-exact",
  createdAt = "2026-08-26T02:55:00.000Z",
  commitHash = commit,
  status = "SUCCESS",
} = {}) {
  return { id, status, createdAt, meta: { commitHash } };
}

function applicationRows({ elapsedMs = 100, count = 20, extra = "" } = {}) {
  return Array.from({ length: count }, (_, index) => ({
    timestamp: new Date(now.getTime() - (index + 1) * 10_000).toISOString(),
    message:
      `\u001b[2m2026-08-26T02:59:00Z\u001b[0m ` +
      `event="public_search_completed" filter="${index % 2 === 0 ? "all" : "games"}" ` +
      `page="${index % 3 === 0 ? "continuation" : "first"}" ` +
      `traffic_class="${index % 2 === 0 ? "staging_canary" : "external"}" limit=20 ` +
      `result_count=${index % 2 === 0 ? 10 : 20} has_next_page=${index % 2 !== 0} ` +
      `selectivity_signal_basis_points=${index % 2 === 0 ? 5000 : 10000} ` +
      `elapsed_ms=${elapsedMs + index} ${extra}`,
  }));
}

test("post-deploy sentinel passes exact attribution, latency, shape, and privacy", async () => {
  const receipt = buildPublicSearchStagingSentinelReceipt({
    contract: await stagingSentinel(),
    deployment: deployment(),
    applicationLogRows: applicationRows(),
    expectedCommit: commit,
    now,
  });

  assert.equal(receipt.status, "passed");
  assert.equal(receipt.latency.scope, "exact-deployment-post-canary");
  assert.equal(receipt.latency.observedMs, 118);
  assert.deepEqual(receipt.latency.byTrafficClass, {
    staging_canary: 10,
    external: 10,
  });
  assert.equal("availability" in receipt, false);
  assert.equal(JSON.stringify(receipt).includes("raw-request"), false);
});

test("privacy and latency regressions are hard failures", async () => {
  const rows = applicationRows({ elapsedMs: 800 });
  rows[0].message += ' query="secret search text"';
  const receipt = buildPublicSearchStagingSentinelReceipt({
    contract: await stagingSentinel(),
    deployment: deployment(),
    applicationLogRows: rows,
    expectedCommit: commit,
    now,
  });

  assert.equal(receipt.status, "failed");
  assert.equal(receipt.privacy.violationCount, 1);
  assert.equal(
    receipt.checks.find((check) => check.id === "latency-objective").status,
    "failed",
  );
  assert.equal(JSON.stringify(receipt).includes("secret search text"), false);
});

test("missing or empty-only post-deploy samples are insufficient", async () => {
  const contract = await stagingSentinel();
  const missing = buildPublicSearchStagingSentinelReceipt({
    contract,
    deployment: deployment(),
    applicationLogRows: [],
    expectedCommit: commit,
    now,
  });
  assert.equal(missing.status, "insufficient");

  const emptyOnly = buildPublicSearchStagingSentinelReceipt({
    contract,
    deployment: deployment(),
    applicationLogRows: applicationRows().map((row) => ({
      ...row,
      message: row.message.replace(
        /result_count=\d+ has_next_page=(?:true|false) selectivity_signal_basis_points=\d+/,
        "result_count=0 has_next_page=false selectivity_signal_basis_points=0",
      ),
    })),
    expectedCommit: commit,
    now,
  });
  assert.equal(emptyOnly.status, "insufficient");
});

test("commit attribution mismatch is a hard failure", async () => {
  const receipt = buildPublicSearchStagingSentinelReceipt({
    contract: await stagingSentinel(),
    deployment: deployment({ commitHash: "different-commit" }),
    applicationLogRows: applicationRows(),
    expectedCommit: commit,
    now,
  });

  assert.equal(receipt.status, "failed");
  assert.equal(receipt.deployment.exactCommitAttributed, false);
});

test("Railway NDJSON parsing rejects partial or non-JSON evidence", () => {
  assert.deepEqual(parseRailwayNdjson("", "test logs"), []);
  assert.deepEqual(parseRailwayNdjson('{"a":1}\n{"b":2}\n', "test logs"), [
    { a: 1 },
    { b: 2 },
  ]);
  assert.throws(
    () => parseRailwayNdjson('{"a":1}\nnot-json', "test logs"),
    /test logs row 2 was not JSON/,
  );
});
