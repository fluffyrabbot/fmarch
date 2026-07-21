export const capacityOverloadBudgets = Object.freeze({
  largeThreadRows: 10_000,
  largeThreadPageLimit: 100,
  largeThreadP95Ms: 500,
  largeThreadMaxScannedRows: 202,
  crawlerDocuments: 10_000,
  crawlerGames: 1_000,
  crawlerRequests: 80,
  crawlerConcurrency: 16,
  crawlerP95Ms: 750,
  postBurstRequests: 24,
  postBurstConcurrency: 12,
  postBurstP95Ms: 3_000,
  websocketConnections: 4,
  websocketBurstPosts: 12,
});

export function percentile(values, percentileValue) {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }
  const sorted = values.map(Number).sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1),
  );
  return Number(sorted[index].toFixed(3));
}

export function requestSummary(records) {
  const elapsed = records.map((record) => record.elapsedMs);
  const statuses = {};
  for (const record of records) {
    statuses[record.status] = (statuses[record.status] ?? 0) + 1;
  }
  return {
    requests: records.length,
    statuses,
    p50Ms: percentile(elapsed, 50),
    p95Ms: percentile(elapsed, 95),
    maxMs: percentile(elapsed, 100),
  };
}

export function assertCapacityOverloadReport(report) {
  assert(report?.proof === "fmarch-capacity-overload", "proof id drifted");
  assert(report?.version === 1, "proof version drifted");
  assert(report?.status === "passed", "capacity proof did not pass");

  const scenarios = report.scenarios ?? {};
  for (const name of [
    "largeThreadColdRead",
    "anonymousCrawler",
    "singleGamePostBurst",
    "slowWebsocketConsumers",
    "httpAdmission",
    "callerRateLimit",
  ]) {
    assert(scenarios[name]?.status === "passed", `${name} did not pass`);
  }

  assert(
    scenarios.largeThreadColdRead.fixtureRows >= report.budgets.largeThreadRows,
    "large-thread fixture is too small",
  );
  assert(
    scenarios.largeThreadColdRead.responseMaxRows <=
      report.budgets.largeThreadPageLimit,
    "large-thread response exceeded its page bound",
  );
  assert(
    scenarios.largeThreadColdRead.p95Ms <= report.budgets.largeThreadP95Ms,
    "large-thread p95 exceeded its local proof budget",
  );
  assert(
    scenarios.largeThreadColdRead.threadRowsScanned <=
      report.budgets.largeThreadMaxScannedRows,
    "large-thread plan scanned too many thread rows",
  );
  assert(
    scenarios.largeThreadColdRead.indexNames.includes("thread_view_page_idx"),
    "large-thread plan did not use the paging index",
  );

  assert(
    scenarios.anonymousCrawler.requests === report.budgets.crawlerRequests,
    "crawler request count drifted",
  );
  assert(
    scenarios.anonymousCrawler.p95Ms <= report.budgets.crawlerP95Ms,
    "crawler p95 exceeded its local proof budget",
  );
  assert(
    Object.keys(scenarios.anonymousCrawler.statuses).every(
      (status) => Number(status) === 200,
    ),
    "crawler workload returned a non-200 response",
  );

  assert(
    scenarios.singleGamePostBurst.acked === report.budgets.postBurstRequests,
    "post burst did not commit every requested post",
  );
  assert(
    scenarios.singleGamePostBurst.projectedPosts ===
      report.budgets.postBurstRequests,
    "post burst projection count drifted",
  );
  assert(
    scenarios.singleGamePostBurst.p95Ms <= report.budgets.postBurstP95Ms,
    "post burst p95 exceeded its local proof budget",
  );

  assert(
    scenarios.slowWebsocketConsumers.connected ===
      report.budgets.websocketConnections,
    "websocket connection fixture drifted",
  );
  assert(
    scenarios.slowWebsocketConsumers.resyncConnections ===
      report.budgets.websocketConnections,
    "not every slow websocket received bounded resync recovery",
  );
  assert(
    scenarios.slowWebsocketConsumers.rejectedHandshakeStatus === 503,
    "excess websocket handshake was not rejected with 503",
  );
  assert(
    scenarios.slowWebsocketConsumers.retryAfter === "1",
    "websocket overload response omitted Retry-After",
  );

  assert(
    scenarios.httpAdmission.rejectedStatus === 503 &&
      scenarios.httpAdmission.retryAfter === "1",
    "HTTP saturation was not an intentional retryable 503",
  );
  assert(
    scenarios.httpAdmission.healthStatus === 200,
    "health check did not survive HTTP saturation",
  );
  assert(
    scenarios.callerRateLimit.statusCode === 429 &&
      Number(scenarios.callerRateLimit.retryAfter) >= 1,
    "caller-scoped rate limit was not an intentional retryable 429",
  );
  return report;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
