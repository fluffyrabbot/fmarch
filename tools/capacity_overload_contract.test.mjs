import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCapacityOverloadReport,
  capacityOverloadBudgets,
  percentile,
  requestSummary,
} from "./capacity_overload_contract.mjs";

test("percentile and request summaries are deterministic", () => {
  assert.equal(percentile([9, 1, 3, 7, 5], 50), 5);
  assert.deepEqual(
    requestSummary([
      { status: 200, elapsedMs: 10 },
      { status: 200, elapsedMs: 20 },
      { status: 503, elapsedMs: 30 },
    ]),
    {
      requests: 3,
      statuses: { 200: 2, 503: 1 },
      p50Ms: 20,
      p95Ms: 30,
      maxMs: 30,
    },
  );
});

test("capacity report contract requires bounded reads, recovery, 429, and 503", () => {
  const report = {
    proof: "fmarch-capacity-overload",
    version: 1,
    status: "passed",
    budgets: capacityOverloadBudgets,
    scenarios: {
      largeThreadColdRead: {
        status: "passed",
        fixtureRows: capacityOverloadBudgets.largeThreadRows,
        responseMaxRows: 100,
        p95Ms: 10,
        threadRowsScanned: 101,
        indexNames: ["thread_view_page_idx"],
      },
      anonymousCrawler: {
        status: "passed",
        requests: capacityOverloadBudgets.crawlerRequests,
        statuses: { 200: capacityOverloadBudgets.crawlerRequests },
        p95Ms: 20,
      },
      singleGamePostBurst: {
        status: "passed",
        acked: capacityOverloadBudgets.postBurstRequests,
        projectedPosts: capacityOverloadBudgets.postBurstRequests,
        p95Ms: 30,
      },
      slowWebsocketConsumers: {
        status: "passed",
        connected: capacityOverloadBudgets.websocketConnections,
        resyncConnections: capacityOverloadBudgets.websocketConnections,
        rejectedHandshakeStatus: 503,
        retryAfter: "1",
      },
      httpAdmission: {
        status: "passed",
        rejectedStatus: 503,
        retryAfter: "1",
        healthStatus: 200,
      },
      callerRateLimit: {
        status: "passed",
        statusCode: 429,
        retryAfter: "60",
      },
    },
  };

  assert.equal(assertCapacityOverloadReport(report), report);
  assert.throws(
    () =>
      assertCapacityOverloadReport({
        ...report,
        scenarios: {
          ...report.scenarios,
          httpAdmission: {
            ...report.scenarios.httpAdmission,
            rejectedStatus: 500,
          },
        },
      }),
    /intentional retryable 503/,
  );
});
