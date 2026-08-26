import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildPublicSearchStagingSloReceipt,
  parseRailwayNdjson,
} from "./public_search_staging_evidence_contract.mjs";

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
  id = "deployment-exact",
  createdAt = "2026-08-25T03:00:00.000Z",
  commitHash = commit,
  status = "SUCCESS",
} = {}) {
  return { id, status, createdAt, meta: { commitHash } };
}

function deploymentHistory(current = deployment()) {
  return [
    current,
    deployment({
      id: "deployment-prior",
      createdAt: "2026-08-10T03:00:00.000Z",
      commitHash: "prior-commit",
    }),
  ];
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

function httpRows({ good = 99, bad = 1 } = {}) {
  return [
    ...Array.from({ length: good }, (_, index) =>
      httpRow(index, 200, index % 2 === 0 ? "deployment-exact" : "deployment-prior"),
    ),
    ...Array.from({ length: bad }, (_, index) =>
      httpRow(good + index, 503, "deployment-prior"),
    ),
    { ...httpRow(good + bad + 1, 503), path: "/readyz" },
  ];
}

function httpRow(index, httpStatus, deploymentId = "deployment-exact") {
  return {
    timestamp: new Date(now.getTime() - (index + 1) * 5_400_000).toISOString(),
    path: "/search",
    deploymentId,
    httpStatus,
    requestId: `raw-request-${index}`,
    srcIp: "192.0.2.1",
    clientUa: "must-not-persist",
  };
}

test("exact latency and rolling service availability pass independently", async () => {
  const current = deployment();
  const receipt = buildPublicSearchStagingSloReceipt({
    slo: await stagingSlo(),
    deployment: current,
    deploymentHistory: deploymentHistory(current),
    applicationLogRows: applicationRows(),
    httpLogRows: httpRows(),
    expectedCommit: commit,
    now,
  });

  assert.equal(receipt.status, "passed");
  assert.equal(receipt.latency.scope, "exact-deployment");
  assert.equal(receipt.latency.observedMs, 118);
  assert.deepEqual(receipt.latency.byTrafficClass, {
    staging_canary: 10,
    external: 10,
  });
  assert.equal(receipt.availability.scope, "service-across-deployments");
  assert.equal(receipt.availability.serviceHistoryCoverageRatio, 1);
  assert.equal(receipt.availability.observedWindowBuckets.length, 7);
  assert.equal(receipt.availability.sampleCount, 100);
  assert.equal(receipt.availability.observedRatio, 0.99);
  assert.equal(receipt.availability.deploymentCohorts.length, 2);
  const serialized = JSON.stringify(receipt);
  assert.equal(serialized.includes("raw-request"), false);
  assert.equal(serialized.includes("192.0.2.1"), false);
  assert.equal(serialized.includes("must-not-persist"), false);
});

test("privacy or latency regressions are hard failures", async () => {
  const rows = applicationRows({ elapsedMs: 800 });
  rows[0].message += ' query="secret search text"';
  const current = deployment();
  const receipt = buildPublicSearchStagingSloReceipt({
    slo: await stagingSlo(),
    deployment: current,
    deploymentHistory: deploymentHistory(current),
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

test("a fresh deployment can have full service availability evidence", async () => {
  const current = deployment({ createdAt: "2026-08-26T02:55:00.000Z" });
  const receipt = buildPublicSearchStagingSloReceipt({
    slo: await stagingSlo(),
    deployment: current,
    deploymentHistory: deploymentHistory(current),
    applicationLogRows: [],
    httpLogRows: httpRows(),
    expectedCommit: commit,
    now,
  });

  assert.equal(receipt.status, "insufficient");
  assert.equal(receipt.latency.deploymentCoverageRatio < 1, true);
  assert.equal(receipt.availability.serviceHistoryCoverageRatio, 1);
  assert.equal(
    receipt.checks.find((check) => check.id === "availability-objective").status,
    "passed",
  );
});

test("unknown deployment samples fail service attribution", async () => {
  const current = deployment();
  const rows = httpRows();
  rows[0].deploymentId = "not-in-service-history";
  const receipt = buildPublicSearchStagingSloReceipt({
    slo: await stagingSlo(),
    deployment: current,
    deploymentHistory: deploymentHistory(current),
    applicationLogRows: applicationRows(),
    httpLogRows: rows,
    expectedCommit: commit,
    now,
  });

  assert.equal(receipt.status, "failed");
  assert.equal(receipt.availability.unknownDeploymentSampleCount, 1);
});

test("a same-day request burst cannot satisfy a seven-day availability SLO", async () => {
  const current = deployment();
  const burstRows = httpRows().map((row, index) => ({
    ...row,
    timestamp: new Date(now.getTime() - (index + 1) * 10_000).toISOString(),
  }));
  const receipt = buildPublicSearchStagingSloReceipt({
    slo: await stagingSlo(),
    deployment: current,
    deploymentHistory: deploymentHistory(current),
    applicationLogRows: applicationRows(),
    httpLogRows: burstRows,
    expectedCommit: commit,
    now,
  });

  assert.equal(receipt.status, "insufficient");
  assert.equal(receipt.availability.sampleCount, 100);
  assert.equal(receipt.availability.observedWindowBuckets.length, 1);
  assert.equal(
    receipt.checks.find(
      (check) => check.id === "availability-sample-window-coverage",
    ).status,
    "insufficient",
  );
});

test("commit attribution mismatch is a hard failure", async () => {
  const current = deployment({ commitHash: "different-commit" });
  const receipt = buildPublicSearchStagingSloReceipt({
    slo: await stagingSlo(),
    deployment: current,
    deploymentHistory: deploymentHistory(current),
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
