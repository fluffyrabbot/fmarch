import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildPublicSearchStagingSloReceipt,
  parseRailwayNdjson,
} from "./public_search_staging_slo.mjs";

const now = new Date("2026-08-26T03:00:00.000Z");
const commit = "64acfec8927edc7c9cb4f130fdfe4eff81c80966";

async function stagingSlo() {
  return JSON.parse(
    await readFile(
      new URL("../docs/ops/public-search-staging-slo.json", import.meta.url),
      "utf8",
    ),
  );
}

function deployment({
  createdAt = "2026-08-18T03:00:00.000Z",
  commitHash = commit,
  status = "SUCCESS",
} = {}) {
  return {
    id: "deployment-exact",
    status,
    createdAt,
    meta: { commitHash },
  };
}

function applicationRows({ elapsedMs = 100, count = 20, extra = "" } = {}) {
  return Array.from({ length: count }, (_, index) => ({
    timestamp: new Date(now.getTime() - (index + 1) * 10_000).toISOString(),
    message:
      `\u001b[2m2026-08-26T02:59:00Z\u001b[0m ` +
      `event="public_search_completed" filter="${index % 2 === 0 ? "all" : "games"}" ` +
      `page="${index % 3 === 0 ? "continuation" : "first"}" limit=20 ` +
      `result_count=${index % 2 === 0 ? 10 : 20} has_next_page=${index % 2 !== 0} ` +
      `selectivity_signal_basis_points=${index % 2 === 0 ? 5000 : 10000} ` +
      `elapsed_ms=${elapsedMs + index} ${extra}`,
  }));
}

function httpRows({ good = 99, bad = 1 } = {}) {
  return [
    ...Array.from({ length: good }, (_, index) => httpRow(index, 200)),
    ...Array.from({ length: bad }, (_, index) => httpRow(good + index, 503)),
    {
      ...httpRow(good + bad + 1, 503),
      deploymentId: "another-deployment",
    },
    {
      ...httpRow(good + bad + 2, 503),
      path: "/readyz",
    },
  ];
}

function httpRow(index, httpStatus) {
  return {
    timestamp: new Date(now.getTime() - (index + 1) * 3_600_000).toISOString(),
    path: "/search",
    deploymentId: "deployment-exact",
    httpStatus,
    requestId: `raw-request-${index}`,
    srcIp: "192.0.2.1",
    clientUa: "must-not-persist",
  };
}

test("exact staging evidence passes with full windows and bounded aggregates", async () => {
  const receipt = buildPublicSearchStagingSloReceipt({
    slo: await stagingSlo(),
    deployment: deployment(),
    applicationLogRows: applicationRows(),
    httpLogRows: httpRows(),
    expectedCommit: commit,
    now,
  });

  assert.equal(receipt.status, "passed");
  assert.equal(receipt.deployment.exactCommitAttributed, true);
  assert.equal(receipt.latency.sampleCount, 20);
  assert.equal(receipt.latency.observedMs, 118);
  assert.deepEqual(receipt.latency.byFilter, { all: 10, games: 10 });
  assert.deepEqual(receipt.latency.bySelectivityBand, {
    "partial-page": 10,
    "full-page-with-more": 10,
  });
  assert.equal(receipt.availability.sampleCount, 100);
  assert.equal(receipt.availability.observedRatio, 0.99);
  const serialized = JSON.stringify(receipt);
  assert.equal(serialized.includes("raw-request"), false);
  assert.equal(serialized.includes("192.0.2.1"), false);
  assert.equal(serialized.includes("must-not-persist"), false);
});

test("privacy or latency regressions fail instead of becoming insufficient", async () => {
  const rows = applicationRows({ elapsedMs: 800 });
  rows[0].message += ' query="secret search text"';
  const receipt = buildPublicSearchStagingSloReceipt({
    slo: await stagingSlo(),
    deployment: deployment(),
    applicationLogRows: rows,
    httpLogRows: httpRows(),
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

test("fresh or traffic-free deployments produce explicit insufficient evidence", async () => {
  const receipt = buildPublicSearchStagingSloReceipt({
    slo: await stagingSlo(),
    deployment: deployment({ createdAt: "2026-08-26T02:55:00.000Z" }),
    applicationLogRows: [],
    httpLogRows: [],
    expectedCommit: commit,
    now,
  });

  assert.equal(receipt.status, "insufficient");
  assert.equal(receipt.latency.sampleCount, 0);
  assert.equal(receipt.availability.sampleCount, 0);
  assert.equal(receipt.privacy.status, "insufficient");
});

test("commit attribution mismatch is a hard failure", async () => {
  const receipt = buildPublicSearchStagingSloReceipt({
    slo: await stagingSlo(),
    deployment: deployment({ commitHash: "different-commit" }),
    applicationLogRows: applicationRows(),
    httpLogRows: httpRows(),
    expectedCommit: commit,
    now,
  });

  assert.equal(receipt.status, "failed");
  assert.equal(receipt.deployment.exactCommitAttributed, false);
});

test("Railway NDJSON parsing rejects partial or non-JSON evidence", () => {
  assert.deepEqual(parseRailwayNdjson('', "test logs"), []);
  assert.deepEqual(parseRailwayNdjson('{"a":1}\n{"b":2}\n', "test logs"), [
    { a: 1 },
    { b: 2 },
  ]);
  assert.throws(
    () => parseRailwayNdjson('{"a":1}\nnot-json', "test logs"),
    /test logs row 2 was not JSON/,
  );
});
