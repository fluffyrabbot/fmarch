export const capacityOverloadBudgets = Object.freeze({
  largeThreadRows: 10_000,
  largeThreadPageLimit: 100,
  largeThreadP95Ms: 500,
  largeThreadMaxScannedRows: 202,
  crawlerDocuments: 100_000,
  crawlerGames: 1_000,
  crawlerRequests: 80,
  crawlerSearchRequests: 40,
  crawlerGameRequests: 40,
  crawlerConcurrency: 16,
  crawlerP95Ms: 750,
  crawlerFilterP50Ms: 750,
  crawlerFilterMaxMs: 1_250,
  searchWritePosts: 12,
  searchWriteConcurrency: 6,
  searchReadRequests: 24,
  searchReadConcurrency: 8,
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

export function assertPublicSearchCharacterizationReport(report) {
  assert(
    report?.proof === "fmarch-public-search-characterization",
    "search characterization proof id drifted",
  );
  assert(report?.version === 2, "search characterization version drifted");
  assert(report?.status === "passed", "search characterization did not pass");
  assert(
    Number.isInteger(report.fixtureDocuments) && report.fixtureDocuments >= 100_000,
    "search characterization fixture is too small",
  );
  assert(
    report.cacheBoundary === "first-application-request-after-fixture-install",
    "search characterization cache boundary drifted",
  );
  for (const name of [
    "commonAll",
    "mediumAll",
    "selectiveAll",
    "selectiveDiscussions",
    "selectiveProfiles",
    "selectiveGames",
  ]) {
    const profile = report.cacheProfiles?.[name];
    assert(profile?.firstRequest?.status === 200, `${name} first request failed`);
    assert(
      profile?.firstRequest?.resultCount <= 20,
      `${name} first response exceeded page bound`,
    );
    assert(profile?.warm?.requests === 5, `${name} warm sample count drifted`);
    assert(
      profile?.warm?.statuses?.[200] === 5 &&
        Object.keys(profile.warm.statuses).length === 1,
      `${name} warm request failed`,
    );
    const plan = report.searchPlans?.[name];
    assert(plan?.returnedRows <= 21, `${name} plan exceeded the fetch bound`);
    assert(
      plan?.examinedRows <= report.fixtureDocuments + 10,
      `${name} plan examined more rows than the fixture contains`,
    );
  }
  return report;
}

export function assertCapacityOverloadReport(report) {
  assert(report?.proof === "fmarch-capacity-overload", "proof id drifted");
  assert(report?.version === 1, "proof version drifted");
  assert(report?.status === "passed", "capacity proof did not pass");

  const scenarios = report.scenarios ?? {};
  for (const name of [
    "largeThreadFirstRead",
    "anonymousCrawler",
    "adversarialPublicSearch",
    "singleGamePostBurst",
    "slowWebsocketConsumers",
    "httpAdmission",
    "callerRateLimit",
  ]) {
    assert(scenarios[name]?.status === "passed", `${name} did not pass`);
  }

  assert(
    scenarios.largeThreadFirstRead.fixtureRows >= report.budgets.largeThreadRows,
    "large-thread fixture is too small",
  );
  assert(
    scenarios.largeThreadFirstRead.responseMaxRows <=
      report.budgets.largeThreadPageLimit,
    "large-thread response exceeded its page bound",
  );
  assert(
    scenarios.largeThreadFirstRead.p95Ms <= report.budgets.largeThreadP95Ms,
    "large-thread p95 exceeded its local proof budget",
  );
  assert(
    scenarios.largeThreadFirstRead.threadRowsScanned <=
      report.budgets.largeThreadMaxScannedRows,
    "large-thread plan scanned too many thread rows",
  );
  assert(
    scenarios.largeThreadFirstRead.indexNames.includes("thread_view_page_idx"),
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
    scenarios.anonymousCrawler.search.requests ===
      report.budgets.crawlerSearchRequests &&
      scenarios.anonymousCrawler.search.p95Ms <= report.budgets.crawlerP95Ms,
    "search crawler workload drifted or exceeded its local proof budget",
  );
  for (const filter of ["all", "discussions", "profiles", "games"]) {
    const summary = scenarios.anonymousCrawler.searchByFilter?.[filter];
    assert(
      summary?.requests === report.budgets.crawlerSearchRequests / 4 &&
        summary.p50Ms <= report.budgets.crawlerFilterP50Ms &&
        summary.maxMs <= report.budgets.crawlerFilterMaxMs,
      `${filter} search workload drifted or exceeded its local proof budget`,
    );
  }
  assert(
    scenarios.anonymousCrawler.gameIndex.requests ===
      report.budgets.crawlerGameRequests &&
      scenarios.anonymousCrawler.gameIndex.p95Ms <= report.budgets.crawlerP95Ms,
    "game-index crawler workload drifted or exceeded its local proof budget",
  );
  for (const [name, plan] of Object.entries(
    scenarios.anonymousCrawler.searchPlans ?? {},
  )) {
    assert(
      plan.returnedRows <= 21 &&
        plan.matchedRows <= scenarios.anonymousCrawler.fixtureDocuments &&
        plan.examinedRows <= scenarios.anonymousCrawler.fixtureDocuments + 10,
      `${name} search plan exceeded its bounded result/document path: ${JSON.stringify(plan)}`,
    );
  }
  assert(
    Object.keys(scenarios.anonymousCrawler.searchPlans ?? {}).length === 6,
    "search selectivity/group plan matrix drifted",
  );
  assert(
    Object.keys(scenarios.anonymousCrawler.statuses).every(
      (status) => Number(status) === 200,
    ),
    "crawler workload returned a non-200 response",
  );

  assert(
    scenarios.adversarialPublicSearch.staticPagination.repeatedFirstPageEqual &&
      scenarios.adversarialPublicSearch.staticPagination.firstSecondPagesDisjoint &&
      scenarios.adversarialPublicSearch.staticPagination.cursorSurvivedInsert &&
      scenarios.adversarialPublicSearch.staticPagination.freshPageObservedInsert &&
      scenarios.adversarialPublicSearch.staticPagination.boundaryWriteAcked,
    "search pagination was not stable before and across a projection write",
  );
  assert(
    scenarios.adversarialPublicSearch.projectionWriteRace.acked ===
      report.budgets.searchWritePosts &&
      scenarios.adversarialPublicSearch.projectionWriteRace.attemptedWrites ===
        report.budgets.searchWritePosts &&
      scenarios.adversarialPublicSearch.projectionWriteRace.readRequests ===
        report.budgets.searchReadRequests &&
      scenarios.adversarialPublicSearch.projectionWriteRace.finalResultCount ===
        report.budgets.searchWritePosts,
    "concurrent search/projection-write evidence drifted",
  );
  assert(
    Object.keys(
      scenarios.adversarialPublicSearch.projectionWriteRace.readStatuses,
    ).every((status) => Number(status) === 200),
    "concurrent projection writes caused a failed search response",
  );
  assert(
    scenarios.adversarialPublicSearch.selectivePlanIndexCoverage === 4,
    "the selective search/filter matrix did not retain the GIN path",
  );
  assert(
    scenarios.adversarialPublicSearch.searchAdmission.rejectedStatus === 503 &&
      scenarios.adversarialPublicSearch.searchAdmission.retryAfter === "1" &&
      scenarios.adversarialPublicSearch.searchAdmission.healthStatus === 200 &&
      scenarios.adversarialPublicSearch.searchAdmission.recoveredRequests === 8,
    "search-specific database saturation did not remain bounded and recoverable",
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
