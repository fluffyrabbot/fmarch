import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertCapacityOverloadReport,
  assertPublicSearchCharacterizationReport,
  capacityOverloadBudgets,
  percentile,
  requestSummary,
} from "./capacity_overload_contract.mjs";

test("public search characterization requires bounded cold and warm samples", () => {
  const profile = {
    filter: "all",
    cold: { status: 200, elapsedMs: 10, resultCount: 20, hasNextPage: true },
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
    version: 1,
    status: "passed",
    fixtureDocuments: 100_000,
    cacheBoundary: "first-application-request",
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

test("staging search SLO is tied to the regression corpus and privacy boundary", async () => {
  const slo = JSON.parse(
    await readFile(
      new URL("../docs/ops/public-search-staging-slo.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(slo.version, 3);
  assert.equal(slo.environment, "staging");
  assert.equal(slo.route, "/search");
  assert.deepEqual(slo.railway_target, {
    project_id: "9d285d67-c11b-4508-9efb-fad042787b4c",
    environment_id: "e109e500-2a4c-48a3-96f2-e92a9edb63e4",
    service_id: "18b6f450-3739-4f21-8e01-f58c63cec834",
    domain: "fmarch-staging.up.railway.app",
  });
  assert.equal(slo.latency.event, "public_search_completed");
  assert.equal(slo.latency.objective_ms, capacityOverloadBudgets.crawlerP95Ms);
  assert.equal(slo.latency.minimum_non_empty_samples, 1);
  assert.deepEqual(slo.latency.traffic_classes, ["external", "staging_canary"]);
  assert.equal(slo.availability.minimum_samples, 100);
  assert.equal(slo.availability.minimum_observed_window_buckets, 7);
  assert.equal(slo.availability.deployment_history_limit, 500);
  assert.equal(slo.canary.requests_per_run, slo.latency.minimum_samples);
  assert.equal(slo.canary.minimum_non_empty_responses, 1);
  assert.deepEqual(slo.canary.source_corpus, {
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
    slo.canary.cases.reduce((count, item) => count + item.repetitions, 0),
    slo.canary.requests_per_run,
  );
  const publicPlatformHttp = await readFile(
    new URL("../crates/api/src/public_platform_http.rs", import.meta.url),
    "utf8",
  );
  for (const boundedValue of [
    slo.canary.header_name,
    slo.canary.header_value,
    slo.canary.traffic_class,
  ]) {
    assert.equal(
      publicPlatformHttp.includes(`"${boundedValue}"`),
      true,
      `API canary classification drifted from ${boundedValue}`,
    );
  }
  assert.equal(
    slo.capacity_assumption.maximum_public_search_documents,
    capacityOverloadBudgets.crawlerDocuments,
  );
  assert.equal(slo.capacity_assumption.recharacterize_before_exceeding, true);
  assert.deepEqual(slo.privacy.forbidden_fields, [
    "query",
    "query_hash",
    "cursor",
    "principal_id",
    "viewer_principal_id",
    "request_path",
  ]);
  assert.equal(slo.feature_decision.prefix_or_fuzzy_matching, "deferred");
  assert.equal(slo.feature_decision.multilingual_stemming, "deferred");
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
        fixtureDocuments: capacityOverloadBudgets.crawlerDocuments,
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
              p95Ms: 20,
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
