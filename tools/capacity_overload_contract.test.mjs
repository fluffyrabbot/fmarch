import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "./capacity_http_retry.test.mjs";

import {
  assertCapacityOverloadReport,
  assertPublicSearchCharacterizationReport,
  capacityOverloadBudgets,
  capacityOverloadProfiles,
  capacityProfileEnvironment,
  percentile,
  requestSummary,
} from "./capacity_overload_contract.mjs";
import { createCapacityAuthSourceAuthority } from "./capacity_auth_source_authority.mjs";

test("capacity auth-source authority binds signed requests to fail-closed server config", () => {
  const signingKey = "capacity-proof-auth-source-signing-key-at-least-32-bytes";
  const authority = createCapacityAuthSourceAuthority(signingKey);
  assert.deepEqual(
    authority.serverEnvironment({
      PRESERVED: "yes",
      FMARCH_AUTH_SOURCE_SIGNING_KEY: "ambient-key-must-not-win",
      FMARCH_TRUST_AUTH_SOURCE_HEADER: "1",
    }),
    {
      PRESERVED: "yes",
      FMARCH_AUTH_SOURCE_SIGNING_KEY: signingKey,
      FMARCH_TRUST_AUTH_SOURCE_HEADER: "0",
    },
  );
  assert.deepEqual(
    authority.requestHeaders(
      "Capacity-Proof-Caller",
      { accept: "application/json" },
      1_750_000_000_000,
    ),
    {
      accept: "application/json",
      "x-fmarch-auth-source": "Capacity-Proof-Caller",
      "x-fmarch-auth-source-timestamp": "1750000000",
      "x-fmarch-auth-source-signature": createHmac("sha256", signingKey)
        .update("1750000000\ncapacity-proof-caller")
        .digest("hex"),
    },
  );
  assert.throws(
    () => createCapacityAuthSourceAuthority("too-short"),
    /at least 32 bytes/,
  );
});

test("public search characterization requires bounded first and warm samples", () => {
  const profile = {
    filter: "all",
    firstRequest: { status: 200, elapsedMs: 10, resultCount: 20, hasNextPage: true },
    warm: { requests: 5, statuses: { 200: 5 }, p50Ms: 5, p95Ms: 8, maxMs: 8 },
  };
  const plan = {
    returnedRows: 21,
    matchedRows: 1_000,
    examinedRows: 100_000,
    nodeTypes: ["Bitmap Heap Scan"],
    indexNames: ["public_search_document_vector_idx"],
  };
  const names = [
    "commonAll",
    "mediumAll",
    "selectiveAll",
    "selectiveDiscussions",
    "selectiveProfiles",
    "selectiveGames",
  ];
  const report = {
    proof: "fmarch-public-search-characterization",
    version: 2,
    status: "passed",
    fixtureDocuments: 100_000,
    cacheBoundary: "first-application-request-after-fixture-install",
    cacheProfiles: Object.fromEntries(names.map((name) => [name, profile])),
    searchPlans: Object.fromEntries(names.map((name) => [name, plan])),
  };
  assert.equal(assertPublicSearchCharacterizationReport(report), report);
  assert.throws(
    () =>
      assertPublicSearchCharacterizationReport({
        ...report,
        cacheProfiles: {
          ...report.cacheProfiles,
          commonAll: { ...profile, warm: { ...profile.warm, requests: 4 } },
        },
      }),
    /warm sample count drifted/,
  );
});

test("staging search sentinel is exact-commit bounded and has no rolling availability claim", async () => {
  const sentinel = JSON.parse(
    await readFile(
      new URL("../docs/ops/public-search-staging-sentinel.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(sentinel.version, 1);
  assert.equal(sentinel.kind, "post_deploy_sentinel");
  assert.equal(sentinel.environment, "staging");
  assert.equal(sentinel.route, "/search");
  assert.equal("availability" in sentinel, false);
  assert.deepEqual(sentinel.railway_target, {
    project_id: "9d285d67-c11b-4508-9efb-fad042787b4c",
    environment_id: "e109e500-2a4c-48a3-96f2-e92a9edb63e4",
    service_id: "18b6f450-3739-4f21-8e01-f58c63cec834",
    domain: "fmarch-staging.up.railway.app",
  });
  assert.equal(sentinel.latency.event, "public_search_completed");
  assert.equal(sentinel.latency.objective_ms, capacityOverloadBudgets.crawlerP95Ms);
  assert.equal(sentinel.latency.minimum_non_empty_samples, 1);
  assert.deepEqual(sentinel.latency.traffic_classes, ["external", "staging_canary"]);
  assert.equal(sentinel.canary.requests_per_run, sentinel.latency.minimum_samples);
  assert.equal(sentinel.canary.minimum_non_empty_responses, 1);
  assert.deepEqual(sentinel.canary.source_corpus, {
    version: 1,
    owner_command: "fmarch-staging-search-corpus reconcile",
    case_id: "game-corpus-v1",
    game_id: "7f46d8a2-9f5d-4d3b-8b9e-7c40a74c1001",
    pack: "mafiascum",
    lifecycle: "active",
    expected_result_href: "/games/7f46d8a2-9f5d-4d3b-8b9e-7c40a74c1001",
    minimum_matching_responses: 1,
  });
  assert.equal(
    sentinel.canary.cases.reduce((count, item) => count + item.repetitions, 0),
    sentinel.canary.requests_per_run,
  );
  const publicPlatformHttp = await readFile(
    new URL("../crates/api/src/public_platform_http.rs", import.meta.url),
    "utf8",
  );
  for (const boundedValue of [
    sentinel.canary.header_name,
    sentinel.canary.header_value,
    sentinel.canary.traffic_class,
  ]) {
    assert.equal(
      publicPlatformHttp.includes(`"${boundedValue}"`),
      true,
      `API canary classification drifted from ${boundedValue}`,
    );
  }
  assert.equal(
    sentinel.capacity_assumption.maximum_public_search_documents,
    capacityOverloadBudgets.crawlerDocuments,
  );
  assert.equal(sentinel.capacity_assumption.recharacterize_before_exceeding, true);
  assert.deepEqual(sentinel.privacy.forbidden_fields, [
    "query",
    "query_hash",
    "cursor",
    "principal_id",
    "viewer_principal_id",
    "request_path",
  ]);
  assert.equal(sentinel.feature_decision.prefix_or_fuzzy_matching, "deferred");
  assert.equal(sentinel.feature_decision.multilingual_stemming, "deferred");
});

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

function validCapacityReport() {
  return {
    proof: "fmarch-capacity-overload",
    version: 2,
    status: "passed",
    configuration: {
      profiles: structuredClone(capacityOverloadProfiles),
      profileSequence: ["throughput", "saturation"],
    },
    budgets: capacityOverloadBudgets,
    scenarios: {
      largeThreadFirstRead: {
        status: "passed",
        profile: "throughput",
        fixtureRows: capacityOverloadBudgets.largeThreadRows,
        responseMaxRows: 100,
        p95Ms: 10,
        threadRowsScanned: 101,
        indexNames: ["thread_view_page_idx"],
      },
      anonymousCrawler: {
        status: "passed",
        profile: "throughput",
        fixtureDocuments: capacityOverloadBudgets.crawlerDocuments,
        fixtureGames: capacityOverloadBudgets.crawlerGames,
        concurrency: capacityOverloadBudgets.crawlerConcurrency,
        requests: capacityOverloadBudgets.crawlerRequests,
        statuses: { 200: capacityOverloadBudgets.crawlerRequests },
        p95Ms: 20,
        search: {
          requests: capacityOverloadBudgets.crawlerSearchRequests,
          statuses: { 200: capacityOverloadBudgets.crawlerSearchRequests },
          p95Ms: 20,
        },
        searchByFilter: Object.fromEntries(
          ["all", "discussions", "profiles", "games"].map((filter) => [
            filter,
            {
              requests: capacityOverloadBudgets.crawlerSearchRequests / 4,
              statuses: {
                200: capacityOverloadBudgets.crawlerSearchRequests / 4,
              },
              p50Ms: 10,
              p95Ms: 20,
              maxMs: 30,
            },
          ]),
        ),
        gameIndex: {
          requests: capacityOverloadBudgets.crawlerGameRequests,
          statuses: { 200: capacityOverloadBudgets.crawlerGameRequests },
          p95Ms: 20,
        },
        searchPlans: Object.fromEntries(
          [
            "commonAll",
            "mediumAll",
            "selectiveAll",
            "selectiveDiscussions",
            "selectiveProfiles",
            "selectiveGames",
          ].map((name) => [
            name,
            {
              returnedRows: 21,
              matchedRows: 100,
              examinedRows: capacityOverloadBudgets.crawlerDocuments,
              nodeTypes: ["Bitmap Heap Scan"],
              indexNames: ["public_search_document_vector_idx"],
            },
          ]),
        ),
      },
      adversarialPublicSearch: {
        status: "passed",
        profile: "throughput",
        staticPagination: {
          repeatedFirstPageEqual: true,
          firstSecondPagesDisjoint: true,
          cursorSurvivedInsert: true,
          freshPageObservedInsert: true,
          boundaryWriteAcked: true,
        },
        projectionWriteRace: {
          attemptedWrites: capacityOverloadBudgets.searchWritePosts,
          writeConcurrency: capacityOverloadBudgets.searchWriteConcurrency,
          acked: capacityOverloadBudgets.searchWritePosts,
          readRequests: capacityOverloadBudgets.searchReadRequests,
          readConcurrency: capacityOverloadBudgets.searchReadConcurrency,
          readStatuses: { 200: capacityOverloadBudgets.searchReadRequests },
          finalResultCount: capacityOverloadBudgets.searchWritePosts,
        },
        selectivePlanIndexCoverage: 4,
      },
      searchAdmission: {
        status: "passed",
        profile: "saturation",
        occupiedRequests: 8,
        recoveredRequests: 8,
        rejectedStatus: 503,
        retryAfter: "1",
        healthStatus: 200,
      },
      singleGamePostBurst: {
        status: "passed",
        profile: "throughput",
        attempted: capacityOverloadBudgets.postBurstRequests,
        concurrency: capacityOverloadBudgets.postBurstConcurrency,
        acked: capacityOverloadBudgets.postBurstRequests,
        projectedPosts: capacityOverloadBudgets.postBurstRequests,
        p95Ms: 30,
      },
      slowWebsocketConsumers: {
        status: "passed",
        profile: "saturation",
        connected: capacityOverloadBudgets.websocketConnections,
        resyncConnections: capacityOverloadBudgets.websocketConnections,
        resyncFrames: capacityOverloadBudgets.websocketConnections,
        closedConnections: capacityOverloadBudgets.websocketConnections,
        recoveredConnections: capacityOverloadBudgets.websocketConnections,
        rejectedHandshakeStatus: 503,
        retryAfter: "1",
      },
      httpAdmission: {
        status: "passed",
        profile: "saturation",
        occupiedRequests: 8,
        recoveredRequests: 8,
        rejectedStatus: 503,
        retryAfter: "1",
        healthStatus: 200,
      },
      callerRateLimit: {
        status: "passed",
        profile: "throughput",
        statusCode: 429,
        retryAfter: "60",
        isolatedSourceStatus: 401,
      },
    },
  };
}

test("capacity report contract requires bounded reads, recovery, 429, and 503", () => {
  const report = validCapacityReport();

  assert.equal(assertCapacityOverloadReport(report), report);
  for (const field of ["resyncFrames", "closedConnections", "recoveredConnections"]) {
    const incomplete = structuredClone(report);
    incomplete.scenarios.slowWebsocketConsumers[field] = 0;
    assert.throws(() => assertCapacityOverloadReport(incomplete), /terminal recovery evidence missing/);
  }

  for (const metric of ["p50Ms", "maxMs"]) {
    const drifted = structuredClone(report);
    drifted.scenarios.anonymousCrawler.searchByFilter.all[metric] =
      metric === "p50Ms"
        ? capacityOverloadBudgets.crawlerFilterP50Ms + 1
        : capacityOverloadBudgets.crawlerFilterMaxMs + 1;
    assert.throws(
      () => assertCapacityOverloadReport(drifted),
      /all search workload drifted or exceeded its local proof budget/,
    );
  }
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
  const collapsedAuthSources = structuredClone(report);
  collapsedAuthSources.scenarios.callerRateLimit.isolatedSourceStatus = 429;
  assert.throws(
    () => assertCapacityOverloadReport(collapsedAuthSources),
    /independent signed caller inherited another caller's rate limit/,
  );
});

test("capacity server profiles use production HTTP admission only for throughput", async () => {
  const throughput = capacityProfileEnvironment("throughput");
  assert.deepEqual(throughput, {
    FMARCH_DB_MAX_CONNECTIONS: "10",
    FMARCH_DB_ACQUIRE_TIMEOUT_MS: "250",
    FMARCH_DB_STATEMENT_TIMEOUT_MS: "4000",
    FMARCH_DB_LOCK_TIMEOUT_MS: "2000",
    FMARCH_DB_IDLE_TRANSACTION_TIMEOUT_MS: "10000",
    FMARCH_HTTP_MAX_IN_FLIGHT: "128",
    FMARCH_HTTP_QUEUE_TIMEOUT_MS: "50",
    FMARCH_HTTP_REQUEST_TIMEOUT_MS: "40000",
    FMARCH_HTTP_RETRY_AFTER_SECONDS: "1",
    FMARCH_SHUTDOWN_DRAIN_TIMEOUT_MS: "45000",
    FMARCH_WS_MAX_CONNECTIONS: "4",
    FMARCH_LIVE_PROJECTION_CAPACITY: "2",
    FMARCH_LIVE_PROJECTION_DELIVERY_DELAY_MS: "100",
    FMARCH_AUTH_SOURCE_RATE_LIMIT_MAX_FAILURES: "3",
    FMARCH_AUTH_RATE_LIMIT_LOCKOUT_SECONDS: "60",
  });
  assert.deepEqual(capacityProfileEnvironment("saturation"), {
    ...throughput,
    FMARCH_HTTP_MAX_IN_FLIGHT: "8",
    FMARCH_HTTP_QUEUE_TIMEOUT_MS: "75",
  });
  assert.throws(() => capacityProfileEnvironment("missing"), /unknown capacity profile/);
  const serverSource = await readFile(new URL("../crates/server/src/main.rs", import.meta.url), "utf8");
  for (const name of ["FMARCH_HTTP_MAX_IN_FLIGHT", "FMARCH_HTTP_QUEUE_TIMEOUT_MS", "FMARCH_HTTP_RETRY_AFTER_SECONDS"]) {
    assert.match(serverSource, new RegExp(`bounded_env\\("${name}",\\s*${throughput[name]},`), `${name} default drifted from the throughput profile`);
  }
});

test("capacity report rejects missing or changed applied profiles and scenario assignments", () => {
  const mutations = [
    (report) => { report.version = 1; },
    (report) => { delete report.configuration.profiles; },
    (report) => { delete report.configuration.profiles.saturation; },
    (report) => { report.configuration.profiles.extra = {}; },
    (report) => { report.configuration.profiles.throughput.httpMaxInFlight = 8; },
    (report) => { report.configuration.profiles.throughput.httpQueueTimeoutMs = 75; },
    (report) => { report.configuration.profiles.saturation.httpMaxInFlight = 128; },
    (report) => { report.configuration.profiles.throughput.databaseMaxConnections = 16; },
    (report) => { report.configuration.profiles.saturation.authSourceProvenance = "unsigned"; },
    (report) => { delete report.configuration.profileSequence; },
    (report) => { report.configuration.profileSequence.reverse(); },
    (report) => { delete report.scenarios.searchAdmission; },
    (report) => { report.scenarios.extra = { status: "passed", profile: "throughput" }; },
  ];
  for (const mutate of mutations) {
    const report = validCapacityReport();
    mutate(report);
    assert.throws(() => assertCapacityOverloadReport(report), /version|profiles|sequence|scenario set/);
  }
  for (const name of Object.keys(validCapacityReport().scenarios)) {
    const otherProfile = validCapacityReport().scenarios[name].profile === "throughput" ? "saturation" : "throughput";
    for (const replacement of [undefined, "unknown", otherProfile]) {
      const report = validCapacityReport();
      report.scenarios[name].profile = replacement;
      assert.throws(() => assertCapacityOverloadReport(report), /profile assignment drifted/);
    }
  }
});

test("capacity report cannot redefine workload or latency budgets to pass", () => {
  for (const name of Object.keys(capacityOverloadBudgets)) {
    for (const value of [undefined, capacityOverloadBudgets[name] - 1, capacityOverloadBudgets[name] + 1]) {
      const report = validCapacityReport();
      report.budgets = { ...report.budgets, [name]: value };
      assert.throws(() => assertCapacityOverloadReport(report), /workload or latency budgets drifted/);
    }
  }
  for (const [scenario, field] of [
    ["anonymousCrawler", "fixtureDocuments"],
    ["anonymousCrawler", "fixtureGames"],
    ["anonymousCrawler", "concurrency"],
    ["singleGamePostBurst", "attempted"],
    ["singleGamePostBurst", "concurrency"],
  ]) {
    const report = validCapacityReport();
    report.scenarios[scenario][field] -= 1;
    assert.throws(() => assertCapacityOverloadReport(report), /fixture|workload|concurrency/);
  }
  for (const field of ["writeConcurrency", "readConcurrency"]) {
    const report = validCapacityReport();
    report.scenarios.adversarialPublicSearch.projectionWriteRace[field] -= 1;
    assert.throws(() => assertCapacityOverloadReport(report), /projection-write evidence drifted/);
  }
});

test("both saturation scenarios require all eight admitted requests to recover", () => {
  for (const scenario of ["searchAdmission", "httpAdmission"]) {
    for (const field of ["occupiedRequests", "recoveredRequests"]) {
      const report = validCapacityReport();
      report.scenarios[scenario][field] = 7;
      assert.throws(() => assertCapacityOverloadReport(report), /saturation/);
    }
  }
});
