import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  assertCapacityOverloadReport,
  assertPublicSearchCharacterizationReport,
  capacityOverloadBudgets as budgets,
  requestSummary,
} from "./capacity_overload_contract.mjs";
import {
  seededSetupRoster,
  seedSetupCommandPlanForGame,
} from "./dev_test_game_setup_bootstrap_scenario.mjs";
import { decodeServerEnvelopeFrame } from "../frontend/src/lib/app/live-transport.mjs";
import { runFmarchMigrations, serverRuntimeEnvironment } from "./run_fmarch_migrations.mjs";
import { createLocalProofAuth } from "./local_proof_auth.mjs";
import {
  fixturePrincipalAuthorityId,
  fixturePrincipalTransport,
} from "./principal_fixture.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultMigrationUrl =
  "postgres://fmarch:fmarch@127.0.0.1:5544/fmarch_capacity_overload";
const defaultOutput = path.join(
  repoRoot,
  "target",
  "capacity-overload",
  "report.json",
);
const defaultSearchCharacterizationOutput = path.join(
  repoRoot,
  "target",
  "public-search-characterization",
  "report.json",
);
const serverBinary = path.join(repoRoot, "target", "debug", "server");
const mediaRoot = path.join(repoRoot, "target", "capacity-overload", "media");
const runId = randomUUID().replaceAll("-", "");
const largeThreadGame = randomUUID();
const crawlerDiscussionScope = randomUUID();
const crawlerGameScope = randomUUID();
const postBurstGame = randomUUID();
const postPrefix = `capacity-post-${runId}`;
const wsPostPrefix = `capacity-ws-${runId}`;
const seedSessionTokens = new Map();
const localProofAuth = createLocalProofAuth();

let server;
let serverOutput = "";
let websocketClients = [];

export async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  if (args.help) {
    printUsage();
    return 0;
  }
  const migrationUrl =
    args.migrationUrl ?? env.DATABASE_MIGRATION_URL ?? defaultMigrationUrl;
  const searchDocuments = parsePositiveInteger(
    args.searchDocuments ?? env.FMARCH_SEARCH_DOCUMENTS ?? budgets.crawlerDocuments,
    "search document count",
  );
  if (!args.searchCharacterization && searchDocuments !== budgets.crawlerDocuments) {
    throw new Error(
      "--search-documents is reserved for --search-characterization; the regression proof fixture is fixed",
    );
  }
  const outputPath = path.resolve(
    args.output ??
      (env.FMARCH_PROOF_ARTIFACT_DIR
        ? path.join(env.FMARCH_PROOF_ARTIFACT_DIR, "report.json")
        : args.searchCharacterization
          ? defaultSearchCharacterizationOutput
          : defaultOutput),
  );
  const psql = findPsql(env);
  if (!existsSync(serverBinary)) {
    throw new Error("target/debug/server is missing; run cargo build -p server first");
  }
  await mkdir(path.dirname(outputPath), { recursive: true });
  await mkdir(mediaRoot, { recursive: true });

  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const authority = await runFmarchMigrations({ cwd: repoRoot, migrationUrl, env });
  const databaseUrl = authority.applicationUrl;
  try {
    await startServer({ baseUrl, port, databaseUrl, env });
    await seedPostBurstGame(baseUrl);
    await seedReadFixtures({ psql, databaseUrl, searchDocuments });

    if (args.searchCharacterization) {
      const report = await characterizePublicSearch({
        baseUrl,
        psql,
        databaseUrl,
        searchDocuments,
      });
      assertPublicSearchCharacterizationReport(report);
      await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
      console.log(
        `public-search characterization passed: ${path.relative(repoRoot, outputPath)}`,
      );
      console.log(JSON.stringify(report.cacheProfiles, null, 2));
      return 0;
    }

    const scenarios = {};
    scenarios.largeThreadFirstRead = await proveLargeThreadFirstRead({
      baseUrl,
      psql,
      databaseUrl,
    });
    scenarios.anonymousCrawler = await proveAnonymousCrawler({ baseUrl, psql, databaseUrl });
    scenarios.adversarialPublicSearch = await proveAdversarialPublicSearch({
      baseUrl,
      psql,
      databaseUrl,
    });
    scenarios.singleGamePostBurst = await proveSingleGamePostBurst({ baseUrl });
    scenarios.slowWebsocketConsumers = await proveSlowWebsocketConsumers({
      baseUrl,
    });
    scenarios.httpAdmission = await proveHttpAdmission({
      baseUrl,
      psql,
      databaseUrl,
    });
    scenarios.callerRateLimit = await proveCallerRateLimit({ baseUrl });

    const report = {
      proof: "fmarch-capacity-overload",
      version: 1,
      status: "passed",
      generatedAt: new Date().toISOString(),
      budgets,
      configuration: {
        databaseMaxConnections: 10,
        databaseAcquireTimeoutMs: 250,
        databaseStatementTimeoutMs: 4_000,
        databaseLockTimeoutMs: 2_000,
        httpMaxInFlight: 8,
        httpQueueTimeoutMs: 75,
        httpRequestTimeoutMs: 5_000,
        websocketMaxConnections: budgets.websocketConnections,
        liveProjectionCapacity: 2,
        liveProjectionDeliveryDelayMs: 100,
      },
      scenarios,
      proofBoundary:
        "Repo-local Postgres and one debug server process. Exercises indexed large-thread first reads, 100k-document anonymous search pressure, deterministic cursor pagination across a production projection write, concurrent search plus command-driven writes, selective GIN plans, search-specific database saturation and recovery, concurrent writes to one real game stream, bounded slow-live-consumer recovery, HTTP/WS 503 admission, and caller-scoped auth 429 behavior. Local latency budgets detect gross regressions; they are not hosted production SLO evidence or capacity planning for a specific machine size.",
    };
    try {
      assertCapacityOverloadReport(report);
    } catch (error) {
      const failedReport = {
        ...report,
        status: "failed",
        failure: error instanceof Error ? error.message : String(error),
      };
      await writeFile(outputPath, `${JSON.stringify(failedReport, null, 2)}\n`);
      throw error;
    }
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`capacity/overload proof passed: ${path.relative(repoRoot, outputPath)}`);
    console.log(JSON.stringify(scenarioSummary(report), null, 2));
    return 0;
  } finally {
    closeWebsockets();
    await stopServer();
    await cleanupReadFixtures({ psql, databaseUrl }).catch((error) => {
      console.warn(`capacity fixture cleanup failed: ${error.message}`);
    });
  }
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help" || value === "-h") {
      args.help = true;
    } else if (value === "--migration-url") {
      args.migrationUrl = requireValue(argv, ++index, value);
    } else if (value === "--output") {
      args.output = requireValue(argv, ++index, value);
    } else if (value === "--search-characterization") {
      args.searchCharacterization = true;
    } else if (value === "--search-documents") {
      args.searchDocuments = requireValue(argv, ++index, value);
    } else {
      throw new Error(`unknown argument: ${value}`);
    }
  }
  return args;
}

async function startServer({ baseUrl, port, databaseUrl, env }) {
  server = spawn(serverBinary, [], {
    cwd: repoRoot,
    env: localProofAuth.serverEnvironment({
      ...serverRuntimeEnvironment({ applicationUrl: databaseUrl, env }),
      FMARCH_BIND: `127.0.0.1:${port}`,
      FMARCH_MEDIA_ROOT: mediaRoot,
      FMARCH_DB_MAX_CONNECTIONS: "10",
      FMARCH_DB_ACQUIRE_TIMEOUT_MS: "250",
      FMARCH_DB_STATEMENT_TIMEOUT_MS: "4000",
      FMARCH_DB_LOCK_TIMEOUT_MS: "2000",
      FMARCH_DB_IDLE_TRANSACTION_TIMEOUT_MS: "10000",
      FMARCH_HTTP_MAX_IN_FLIGHT: "8",
      FMARCH_HTTP_QUEUE_TIMEOUT_MS: "75",
      FMARCH_HTTP_REQUEST_TIMEOUT_MS: "5000",
      FMARCH_HTTP_RETRY_AFTER_SECONDS: "1",
      FMARCH_WS_MAX_CONNECTIONS: String(budgets.websocketConnections),
      FMARCH_LIVE_PROJECTION_CAPACITY: "2",
      FMARCH_LIVE_PROJECTION_DELIVERY_DELAY_MS: "100",
      FMARCH_AUTH_SOURCE_RATE_LIMIT_MAX_FAILURES: "3",
      FMARCH_AUTH_RATE_LIMIT_LOCKOUT_SECONDS: "60",
      FMARCH_TRUST_AUTH_SOURCE_HEADER: "1",
      RUST_LOG: env.RUST_LOG ?? "warn",
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", recordServerOutput);
  server.stderr.on("data", recordServerOutput);
  await waitForHealth(baseUrl);
}

async function seedReadFixtures({ psql, databaseUrl, searchDocuments }) {
  const uuidExpression = sqlUuidFromMd5(`'${runId}' || value::TEXT`);
  const profileUuidExpression = sqlUuidFromMd5(`'${runId}-profile-' || value::TEXT`);
  const discussionDocuments = Math.floor(searchDocuments / 3);
  const gameDocuments = Math.floor(searchDocuments / 3);
  const profileDocuments = searchDocuments - discussionDocuments - gameDocuments;
  await runPsql(
    psql,
    databaseUrl,
    `
      INSERT INTO game_index (
        game_id, pack_key, pack_version, pack_content_hash, status, phase_id,
        created_seq, started_seq, completed_seq, updated_seq
      )
      SELECT '${largeThreadGame}', pack_key, pack_version, content_hash,
             'active', 'D01', 1, 1, NULL, ${budgets.largeThreadRows}
      FROM pack_artifact
      ORDER BY pack_key, pack_version, content_hash
      LIMIT 1;
      INSERT INTO thread_view (
        game_id, source_seq, stream_seq, channel_id, author_kind, author_slot_id,
        phase_id, body, body_private, occurred_at, media
      )
      SELECT '${largeThreadGame}', value, value,
             'main',
             'host_narrator', NULL,
             'D01',
             'large thread fixture post ' || value,
             NULL,
             value, '[]'::JSONB
      FROM generate_series(1, ${budgets.largeThreadRows}) AS value;
      INSERT INTO game_index (
        game_id, pack_key, pack_version, pack_content_hash, status, phase_id,
        created_seq, started_seq, completed_seq, updated_seq
      )
      SELECT ${uuidExpression}, artifact.pack_key, artifact.pack_version,
             artifact.content_hash, 'active', 'D01', value, value, NULL,
             ${budgets.largeThreadRows} + value
      FROM generate_series(1, ${budgets.crawlerGames}) AS value
      CROSS JOIN LATERAL (
        SELECT pack_key, pack_version, content_hash
        FROM pack_artifact
        ORDER BY pack_key, pack_version, content_hash
        LIMIT 1
      ) AS artifact;
      INSERT INTO publication_surface (
        surface_id, search_group, title, href, visible, updated_seq
      ) VALUES
        ('${crawlerDiscussionScope}', 'discussions', 'Capacityword discussion fixture',
         '/capacity/${runId}/discussions', TRUE, ${discussionDocuments}),
        ('${crawlerGameScope}', 'games', 'Capacityword game fixture',
         '/capacity/${runId}/games', TRUE, ${gameDocuments});
      INSERT INTO public_search_document (
        surface_id, document_type, source_seq, title_text, body, href,
        author_profile_id, published_at, updated_seq, visible
      )
      VALUES
        ('${crawlerDiscussionScope}', 'discussion', 0,
         'capacityword discussion fixture', '',
         '/capacity/${runId}/discussions', NULL, 0, ${discussionDocuments}, TRUE),
        ('${crawlerGameScope}', 'game', 0,
         'capacityword game fixture', '',
         '/capacity/${runId}/games', NULL, 0, ${gameDocuments}, TRUE);
      INSERT INTO public_search_document (
        surface_id, document_type, source_seq, title_text, body, href,
        author_profile_id, published_at, updated_seq, visible
      )
      SELECT '${crawlerDiscussionScope}', 'discussion_post', value, '',
             'capacityword bounded discussion fixture ' || value ||
               CASE WHEN value % 10 = 0 THEN ' mediumword' ELSE '' END ||
               CASE WHEN value % 50 = 0 THEN ' cursorboundaryword' ELSE '' END ||
               CASE WHEN value % 100 = 0 THEN ' selectiveword' ELSE '' END,
             '/capacity/${runId}/discussions/' || value,
             NULL, value, value, TRUE
      FROM generate_series(1, ${discussionDocuments - 1}) AS value;
      INSERT INTO public_search_document (
        surface_id, document_type, source_seq, title_text, body, href,
        author_profile_id, published_at, updated_seq, visible
      )
      SELECT '${crawlerGameScope}', 'game_post', value, '',
             'capacityword bounded game fixture ' || value ||
               CASE WHEN value % 10 = 0 THEN ' mediumword' ELSE '' END ||
               CASE WHEN value % 50 = 0 THEN ' cursorboundaryword' ELSE '' END ||
               CASE WHEN value % 100 = 0 THEN ' selectiveword' ELSE '' END,
             '/capacity/${runId}/games/' || value,
             NULL, value, value, TRUE
      FROM generate_series(1, ${gameDocuments - 1}) AS value;
      INSERT INTO publication_surface (
        surface_id, search_group, title, href, visible, updated_seq
      )
      SELECT ${profileUuidExpression}, 'profiles',
             'Capacityword profile fixture ' || value,
             '/capacity/${runId}/profiles/' || value,
             TRUE, value
      FROM generate_series(1, ${profileDocuments}) AS value;
      INSERT INTO public_search_document (
        surface_id, document_type, source_seq, title_text, body, href,
        author_profile_id, published_at, updated_seq, visible
      )
      SELECT ${profileUuidExpression}, 'profile', 0,
             'capacityword profile fixture ' || value ||
               CASE WHEN value % 10 = 0 THEN ' mediumword' ELSE '' END ||
               CASE WHEN value % 50 = 0 THEN ' cursorboundaryword' ELSE '' END ||
               CASE WHEN value % 100 = 0 THEN ' selectiveword' ELSE '' END,
             '', '/capacity/${runId}/profiles/' || value,
             NULL, value, value, TRUE
      FROM generate_series(1, ${profileDocuments}) AS value;
      ANALYZE thread_view;
      ANALYZE game_index;
      ANALYZE public_search_document;
    `,
  );
}

async function proveLargeThreadFirstRead({ baseUrl, psql, databaseUrl }) {
  const records = [];
  let nextBeforeSeq;
  let responseMaxRows = 0;
  for (let index = 0; index < 12; index += 1) {
    const cursor = index % 2 === 1 && nextBeforeSeq ? `&before_seq=${nextBeforeSeq}` : "";
    const record = await timedFetch(
      `${baseUrl}/games/${largeThreadGame}?limit=${budgets.largeThreadPageLimit}${cursor}`,
    );
    assert(record.status === 200, `large-thread read returned ${record.status}`);
    responseMaxRows = Math.max(responseMaxRows, record.body.posts?.length ?? 0);
    nextBeforeSeq = record.body.next_before_seq ?? nextBeforeSeq;
    records.push(record);
  }
  const plan = await explainThreadPage({ psql, databaseUrl });
  const summary = requestSummary(records);
  return {
    status: "passed",
    fixtureRows: budgets.largeThreadRows,
    responseMaxRows,
    ...summary,
    threadRowsScanned: plan.threadRowsScanned,
    indexNames: plan.indexNames,
  };
}

async function explainThreadPage({ psql, databaseUrl }) {
  const result = await runPsql(
    psql,
    databaseUrl,
    `EXPLAIN (ANALYZE, FORMAT JSON)
     SELECT game_id, source_seq, stream_seq, channel_id, author_kind,
            author_slot_id, phase_id, body, media, occurred_at
     FROM thread_view
     WHERE game_id = '${largeThreadGame}'
       AND channel_id = 'main'
       AND NOT EXISTS (
         SELECT 1 FROM moderation_target_state AS moderation
         WHERE moderation.surface_id = thread_view.game_id
           AND moderation.source_seq = thread_view.source_seq
           AND moderation.visibility = 'hidden'
       )
     ORDER BY source_seq DESC
     LIMIT ${budgets.largeThreadPageLimit + 1};`,
    { tuplesOnly: true },
  );
  const document = JSON.parse(result.stdout.trim());
  const nodes = flattenPlan(document[0].Plan);
  const threadNodes = nodes.filter((node) => node["Relation Name"] === "thread_view");
  return {
    threadRowsScanned: Math.max(
      0,
      ...threadNodes.map((node) => Number(node["Actual Rows"] ?? 0)),
    ),
    indexNames: [
      ...new Set(nodes.map((node) => node["Index Name"]).filter(Boolean)),
    ],
  };
}

async function proveAnonymousCrawler({ baseUrl, psql, databaseUrl }) {
  const firstPage = await fetchJson(`${baseUrl}/games?limit=50`);
  const cursor = firstPage.next_cursor;
  assert(cursor, "crawler game fixture did not produce a next cursor");
  const filters = ["all", "discussions", "profiles", "games"];
  const searchCursors = Object.fromEntries(
    await Promise.all(
      filters.map(async (filter) => {
        const page = await fetchJson(
          `${baseUrl}/search?q=capacityword&filter=${filter}&limit=20`,
        );
        assert(page.next_cursor, `${filter} search fixture did not produce a next cursor`);
        return [filter, page.next_cursor];
      }),
    ),
  );
  const searchTargets = Array.from(
    { length: budgets.crawlerSearchRequests },
    (_, index) => {
      const filter = filters[index % filters.length];
      const useCursor = Math.floor(index / filters.length) % 2 === 1;
      const cursorQuery = useCursor
        ? `&cursor=${encodeURIComponent(searchCursors[filter])}`
        : "";
      return {
        kind: "search",
        filter,
        url: `${baseUrl}/search?q=capacityword&filter=${filter}&limit=20${cursorQuery}`,
      };
    },
  );
  const gameTargets = Array.from(
    { length: budgets.crawlerGameRequests },
    (_, index) => ({
      kind: "gameIndex",
      url:
        index % 2 === 0
          ? `${baseUrl}/games?limit=50`
          : `${baseUrl}/games?limit=50&cursor=${encodeURIComponent(cursor)}`,
    }),
  );
  const targets = Array.from({ length: budgets.crawlerRequests }, (_, index) =>
    index % 2 === 0
      ? searchTargets[index / 2]
      : gameTargets[Math.floor(index / 2)],
  );
  const records = await mapConcurrent(
    targets,
    budgets.crawlerConcurrency,
    async (target) => ({
      ...(await timedFetchWithRetryableAdmission(target.url)),
      kind: target.kind,
      filter: target.filter,
    }),
  );
  const searchPlans = Object.fromEntries(
    await Promise.all(
      [
        ["commonAll", "capacityword", "all"],
        ["mediumAll", "mediumword", "all"],
        ["selectiveAll", "selectiveword", "all"],
        ["selectiveDiscussions", "selectiveword", "discussions"],
        ["selectiveProfiles", "selectiveword", "profiles"],
        ["selectiveGames", "selectiveword", "games"],
      ].map(async ([name, query, filter]) => [
        name,
        await explainPublicSearch({ psql, databaseUrl, query, filter }),
      ]),
    ),
  );
  for (const record of records) {
    assert(record.status === 200, `crawler request returned ${record.status}`);
    assert(
      (record.body.results?.length ?? 0) <= 20,
      "search response exceeded its page bound",
    );
    assert((record.body.games?.length ?? 0) <= 50, "game response exceeded its page bound");
  }
  return {
    status: "passed",
    fixtureDocuments: budgets.crawlerDocuments,
    fixtureGames: budgets.crawlerGames,
    concurrency: budgets.crawlerConcurrency,
    retryable503s: records.reduce(
      (total, record) => total + record.retryable503s,
      0,
    ),
    search: requestSummary(records.filter((record) => record.kind === "search")),
    searchByFilter: Object.fromEntries(
      filters.map((filter) => [
        filter,
        requestSummary(
          records.filter(
            (record) => record.kind === "search" && record.filter === filter,
          ),
        ),
      ]),
    ),
    gameIndex: requestSummary(records.filter((record) => record.kind === "gameIndex")),
    searchPlans,
    ...requestSummary(records),
  };
}

async function characterizePublicSearch({
  baseUrl,
  psql,
  databaseUrl,
  searchDocuments,
}) {
  const cases = [
    ["commonAll", "capacityword", "all"],
    ["mediumAll", "mediumword", "all"],
    ["selectiveAll", "selectiveword", "all"],
    ["selectiveDiscussions", "selectiveword", "discussions"],
    ["selectiveProfiles", "selectiveword", "profiles"],
    ["selectiveGames", "selectiveword", "games"],
  ];
  const cacheProfiles = {};
  for (const [name, query, filter] of cases) {
    const url = `${baseUrl}/search?q=${query}&filter=${filter}&limit=20`;
    const firstRequest = await timedFetch(url);
    assert(
      firstRequest.status === 200,
      `${name} first search returned ${firstRequest.status}`,
    );
    assert(
      (firstRequest.body.results?.length ?? 0) <= 20,
      `${name} first search exceeded its page bound`,
    );
    const warm = [];
    for (let sample = 0; sample < 5; sample += 1) {
      const record = await timedFetch(url);
      assert(record.status === 200, `${name} warm search returned ${record.status}`);
      assert(
        (record.body.results?.length ?? 0) <= 20,
        `${name} warm search exceeded its page bound`,
      );
      warm.push(record);
    }
    cacheProfiles[name] = {
      filter,
      firstRequest: {
        status: firstRequest.status,
        elapsedMs: Number(firstRequest.elapsedMs.toFixed(3)),
        resultCount: firstRequest.body.results?.length ?? 0,
        hasNextPage: Boolean(firstRequest.body.next_cursor),
      },
      warm: requestSummary(warm),
    };
  }
  const searchPlans = Object.fromEntries(
    await Promise.all(
      cases.map(async ([name, query, filter]) => [
        name,
        await explainPublicSearch({ psql, databaseUrl, query, filter }),
      ]),
    ),
  );
  return {
    proof: "fmarch-public-search-characterization",
    version: 2,
    status: "passed",
    generatedAt: new Date().toISOString(),
    fixtureDocuments: searchDocuments,
    pageLimit: 20,
    warmSamplesPerCase: 5,
    cacheBoundary: "first-application-request-after-fixture-install",
    cacheProfiles,
    searchPlans,
    proofBoundary:
      "Repo-local Postgres and one debug server process. firstRequest is the first application request for each query/filter after fixture installation; PostgreSQL shared buffers and the host page cache are intentionally not flushed, so this is not cold-storage evidence. Warm measurements are five immediate sequential repetitions. Query text is fixture-only and is not persisted in the report.",
  };
}

async function proveAdversarialPublicSearch({ baseUrl, psql, databaseUrl }) {
  const firstUrl = `${baseUrl}/search?q=cursorboundaryword&filter=all&limit=20`;
  const firstPage = await fetchJson(firstUrl);
  const repeatedFirstPage = await fetchJson(firstUrl);
  assert(firstPage.next_cursor, "adversarial search fixture did not produce a cursor");
  assert(
    JSON.stringify(firstPage) === JSON.stringify(repeatedFirstPage),
    "unchanged search state did not return a deterministic first page",
  );
  const firstKeys = new Set(firstPage.results.map(searchResultKey));
  const secondPage = await fetchJson(
    `${firstUrl}&cursor=${encodeURIComponent(firstPage.next_cursor)}`,
  );
  const secondKeys = new Set(secondPage.results.map(searchResultKey));
  assert(
    [...firstKeys].every((key) => !secondKeys.has(key)),
    "search cursor repeated a first-page result",
  );

  const boundaryWrite = await submitPostWithRetry({
    baseUrl,
    index: 0,
    prefix: `${"cursorboundaryword ".repeat(12)}${runId}`,
  });
  const continuationAfterWrite = await fetchJson(
    `${firstUrl}&cursor=${encodeURIComponent(firstPage.next_cursor)}`,
  );
  const continuationAfterWriteKeys = new Set(
    continuationAfterWrite.results.map(searchResultKey),
  );
  assert(
    [...firstKeys].every((key) => !continuationAfterWriteKeys.has(key)),
    "a projection write caused an old cursor to repeat a first-page result",
  );
  const freshFirstPage = await fetchJson(firstUrl);
  const freshFirstKeys = new Set(freshFirstPage.results.map(searchResultKey));
  assert(
    [...freshFirstKeys].some((key) => !firstKeys.has(key)),
    "a committed searchable projection write was absent from a fresh first page",
  );

  const writeIndexes = Array.from(
    { length: budgets.searchWritePosts },
    (_, index) => index,
  );
  const readIndexes = Array.from(
    { length: budgets.searchReadRequests },
    (_, index) => index,
  );
  const [writes, reads] = await Promise.all([
    mapConcurrent(writeIndexes, budgets.searchWriteConcurrency, (index) =>
      submitPostWithRetry({
        baseUrl,
        index,
        prefix: `adversarialsearchword ${runId}`,
      }),
    ),
    mapConcurrent(readIndexes, budgets.searchReadConcurrency, () =>
      timedFetchWithRetryableAdmission(
        `${baseUrl}/search?q=adversarialsearchword&filter=all&limit=20`,
      ),
    ),
  ]);
  assert(
    reads.every((record) => record.status === 200),
    "search failed while production commands were updating its projection",
  );
  const finalPage = await fetchJson(
    `${baseUrl}/search?q=adversarialsearchword&filter=all&limit=20`,
  );
  assert(
    finalPage.results.length === budgets.searchWritePosts &&
      finalPage.next_cursor === null,
    `concurrent projection writes produced ${finalPage.results.length}/${budgets.searchWritePosts} searchable results`,
  );

  const selectivePlans = await Promise.all(
    [
      ["all", "selectiveword"],
      ["discussions", "selectiveword"],
      ["profiles", "selectiveword"],
      ["games", "selectiveword"],
    ].map(async ([filter, query]) => ({
      filter,
      ...(await explainPublicSearch({ psql, databaseUrl, query, filter })),
    })),
  );
  const selectivePlanIndexCoverage = selectivePlans.filter((plan) =>
    plan.indexNames.includes("public_search_document_vector_idx"),
  ).length;
  assert(
    selectivePlanIndexCoverage === selectivePlans.length,
    "selective search/filter plan lost the partial GIN index",
  );

  const searchAdmission = await proveSearchAdmission({
    baseUrl,
    psql,
    databaseUrl,
  });
  return {
    status: "passed",
    staticPagination: {
      repeatedFirstPageEqual: true,
      firstSecondPagesDisjoint: true,
      cursorSurvivedInsert: true,
      freshPageObservedInsert: true,
      boundaryWriteAcked: boundaryWrite.kind === "Ack",
    },
    projectionWriteRace: {
      attemptedWrites: budgets.searchWritePosts,
      writeConcurrency: budgets.searchWriteConcurrency,
      acked: writes.filter((record) => record.kind === "Ack").length,
      streamConflictRetries: writes.reduce(
        (sum, record) => sum + record.streamConflictRetries,
        0,
      ),
      retryableWrite503s: writes.reduce(
        (sum, record) => sum + record.retryable503s,
        0,
      ),
      readRequests: reads.length,
      readConcurrency: budgets.searchReadConcurrency,
      retryableRead503s: reads.reduce(
        (sum, record) => sum + record.retryable503s,
        0,
      ),
      readStatuses: requestSummary(reads).statuses,
      finalResultCount: finalPage.results.length,
    },
    selectivePlanIndexCoverage,
    searchAdmission,
  };
}

async function proveSearchAdmission({ baseUrl, psql, databaseUrl }) {
  const lock = spawnPsql(
    psql,
    databaseUrl,
    "BEGIN; LOCK TABLE public_search_document IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(1.2); COMMIT;",
  );
  await waitForTableLock({
    psql,
    databaseUrl,
    relation: "public_search_document",
  });
  const blocked = Array.from({ length: 8 }, () =>
    timedFetch(`${baseUrl}/search?q=selectiveword&filter=all&limit=1`),
  );
  await delay(50);
  const rejected = await timedFetch(
    `${baseUrl}/search?q=selectiveword&filter=all&limit=1`,
  );
  const health = await timedFetch(`${baseUrl}/healthz`);
  await processResult(lock);
  const released = await Promise.all(blocked);
  assert(
    released.every((record) => record.status === 200),
    "blocked search requests did not recover",
  );
  assert(rejected.status === 503, `saturated search returned ${rejected.status}`);
  assert(health.status === 200, `search saturation health check returned ${health.status}`);
  return {
    occupiedRequests: blocked.length,
    recoveredRequests: released.length,
    rejectedStatus: rejected.status,
    retryAfter: rejected.headers["retry-after"],
    healthStatus: health.status,
  };
}

function searchResultKey(result) {
  return JSON.stringify([
    result?.kind ?? null,
    result?.href ?? null,
    result?.title ?? null,
    result?.published_at ?? null,
    result?.excerpt ?? null,
  ]);
}

async function explainPublicSearch({ psql, databaseUrl, query, filter }) {
  const source = await readFile(
    path.join(repoRoot, "crates", "projections", "sql", "public_search.sql"),
    "utf8",
  );
  const bindings = new Map([
    [8, "21"],
    [7, "NULL"],
    [6, "NULL"],
    [5, "NULL"],
    [4, "NULL"],
    [3, "NULL"],
    [2, sqlLiteral(filter)],
    [1, sqlLiteral(query)],
  ]);
  let statement = source;
  for (const [parameter, value] of bindings) {
    statement = statement.replaceAll(`$${parameter}`, value);
  }
  const result = await runPsql(
    psql,
    databaseUrl,
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement}`,
    { tuplesOnly: true },
  );
  const document = JSON.parse(result.stdout.trim());
  const plan = document[0].Plan;
  const nodes = flattenPlan(plan);
  const searchNodes = nodes.filter(
    (node) => node["Relation Name"] === "public_search_document",
  );
  return {
    returnedRows: Number(plan["Actual Rows"] ?? 0),
    matchedRows: Math.max(
      0,
      ...searchNodes.map(actualPlanRows),
    ),
    examinedRows: Math.max(
      0,
      ...searchNodes.map(
        (node) =>
          (Number(node["Actual Rows"] ?? 0) +
            Number(node["Rows Removed by Filter"] ?? 0)) *
          Number(node["Actual Loops"] ?? 1),
      ),
    ),
    nodeTypes: [...new Set(searchNodes.map((node) => node["Node Type"]).filter(Boolean))],
    indexNames: [
      ...new Set(nodes.map((node) => node["Index Name"]).filter(Boolean)),
    ],
  };
}

async function proveSingleGamePostBurst({ baseUrl }) {
  // The setup game is created before direct read-fixture installation so its
  // verified, content-addressed PackArtifact can back every synthetic row.
  // This scenario measures only the burst itself.
  await seedSessionToken(baseUrl, "player-mira");
  const records = await mapConcurrent(
    Array.from({ length: budgets.postBurstRequests }, (_, index) => index),
    budgets.postBurstConcurrency,
    async (index) =>
      await submitPostWithRetry({
        baseUrl,
        index,
        prefix: postPrefix,
      }),
  );
  const page = await fetchJson(`${baseUrl}/games/${postBurstGame}?limit=100`);
  const projectedPosts = page.posts.filter((post) => post.body.startsWith(postPrefix)).length;
  return {
    status: "passed",
    attempted: budgets.postBurstRequests,
    concurrency: budgets.postBurstConcurrency,
    acked: records.filter((record) => record.kind === "Ack").length,
    projectedPosts,
    retryable503s: records.reduce((sum, record) => sum + record.retryable503s, 0),
    streamConflictRetries: records.reduce(
      (sum, record) => sum + record.streamConflictRetries,
      0,
    ),
    ...requestSummary(
      records.map((record) => ({ status: 200, elapsedMs: record.elapsedMs })),
    ),
  };
}

async function seedPostBurstGame(baseUrl) {
  for (const principalId of ["host_h", ...seededSetupRoster.map((row) => row.user)]) {
    await seedSessionToken(baseUrl, principalId);
  }
  for (const [principalId, command] of seedSetupCommandPlanForGame(postBurstGame)) {
    const seeded = await sendCommand(baseUrl, principalId, command);
    assert(seeded.kind === "Ack", `game seed rejected: ${JSON.stringify(seeded)}`);
  }
}

async function proveSlowWebsocketConsumers({ baseUrl }) {
  const wsUrl = baseUrl.replace(/^http/, "ws");
  const states = Array.from({ length: budgets.websocketConnections }, () => ({
    resyncs: 0,
  }));
  const tickets = await Promise.all(
    states.map(async () =>
      await issueWebsocketTicket(baseUrl, "player-mira", postBurstGame, "main"),
    ),
  );
  const excessTicket = await issueWebsocketTicket(
    baseUrl,
    "player-mira",
    postBurstGame,
    "main",
  );
  websocketClients = await Promise.all(
    states.map(
      (state, index) =>
        new Promise((resolve, reject) => {
          const socket = new WebSocket(
            `${wsUrl}/ws?ticket=${encodeURIComponent(tickets[index])}&audience=fmarch-live`,
          );
          socket.binaryType = "arraybuffer";
          socket.addEventListener("open", () => resolve(socket), { once: true });
          socket.addEventListener("error", () => reject(new Error("websocket open failed")), {
            once: true,
          });
          socket.addEventListener("message", async (event) => {
            try {
              const envelope = await decodeServerEnvelopeFrame(event.data);
              if (
                envelope?.body?.kind === "Delta" &&
                envelope?.body?.body?.kind === "ResyncRequired"
              ) {
                state.resyncs += 1;
              }
            } catch {
              // Malformed/non-CBOR frames are outside the typed server protocol.
            }
          });
        }),
    ),
  );

  const rejectedHandshake = await rawWebsocketHandshake(new URL(baseUrl), excessTicket);
  assert(
    rejectedHandshake.status === 503,
    `excess websocket handshake returned ${rejectedHandshake.status}`,
  );

  await Promise.all(
    Array.from({ length: budgets.websocketBurstPosts }, (_, index) =>
      submitPostWithRetry({ baseUrl, index, prefix: wsPostPrefix }),
    ),
  );
  await waitUntil(
    () => states.every((state) => state.resyncs >= 1),
    8_000,
    "slow websocket consumers did not receive ResyncRequired",
  );
  return {
    status: "passed",
    connected: websocketClients.length,
    burstPosts: budgets.websocketBurstPosts,
    resyncConnections: states.filter((state) => state.resyncs >= 1).length,
    resyncFrames: states.reduce((sum, state) => sum + state.resyncs, 0),
    rejectedHandshakeStatus: rejectedHandshake.status,
    retryAfter: rejectedHandshake.headers["retry-after"],
  };
}

async function proveHttpAdmission({ baseUrl, psql, databaseUrl }) {
  const lock = spawnPsql(
    psql,
    databaseUrl,
    "BEGIN; LOCK TABLE game_index IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(1.2); COMMIT;",
  );
  await waitForTableLock({ psql, databaseUrl, relation: "game_index" });
  const blocked = Array.from({ length: 8 }, () => timedFetch(`${baseUrl}/games?limit=1`));
  await delay(50);
  const rejected = await timedFetch(`${baseUrl}/games?limit=1`);
  const health = await timedFetch(`${baseUrl}/healthz`);
  await processResult(lock);
  const released = await Promise.all(blocked);
  assert(released.every((record) => record.status === 200), "blocked requests did not recover");
  assert(rejected.status === 503, `saturated request returned ${rejected.status}`);
  assert(health.status === 200, `saturated health check returned ${health.status}`);
  return {
    status: "passed",
    occupiedRequests: blocked.length,
    recoveredRequests: released.length,
    rejectedStatus: rejected.status,
    retryAfter: rejected.headers["retry-after"],
    healthStatus: health.status,
  };
}

async function proveCallerRateLimit({ baseUrl }) {
  const url = `${baseUrl}/auth/accounts/login`;
  const options = {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-fmarch-auth-source": `capacity-proof-${runId}`,
    },
    body: JSON.stringify({
      account_id: `missing-${runId}`,
      password: "not-the-correct-password-123!",
    }),
  };
  const first = await timedFetch(url, options);
  const second = await timedFetch(url, options);
  const limited = await timedFetch(url, options);
  assert(first.status === 401 && second.status === 401, "auth failures did not precede 429");
  assert(limited.status === 429, `caller rate limit returned ${limited.status}`);
  return {
    status: "passed",
    precedingStatuses: [first.status, second.status],
    statusCode: limited.status,
    retryAfter: limited.headers["retry-after"],
  };
}

async function submitPostWithRetry({ baseUrl, index, prefix }) {
  const started = performance.now();
  const commandId = randomUUID();
  const maxAttempts = budgets.postBurstRequests * 2;
  let retryable503s = 0;
  let streamConflictRetries = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await sendCommand(
      baseUrl,
      "player-mira",
      {
        SubmitPost: {
          game: postBurstGame,
          channel_id: "main",
          actor_slot: "slot-7",
          body: `${prefix}-${index}`,
        },
      },
      { tolerateRetryable: true, commandId },
    );
    if (response.httpStatus === 409 || response.httpStatus === 503) {
      const serverMessage = response.body?.body;
      const reject =
        serverMessage?.kind === "Reject" ? serverMessage.body : response.body;
      if (reject?.retryable !== true) {
        throw new Error(`post burst received non-retryable conflict: ${JSON.stringify(response)}`);
      }
      if (reject.error === "StreamConflict") {
        streamConflictRetries += 1;
      } else {
        retryable503s += 1;
      }
      await delay(
        Math.min(75, 5 * attempt) + ((index * 17 + attempt * 13) % 23),
      );
      continue;
    }
    if (response.kind === "Ack") {
      return {
        kind: "Ack",
        elapsedMs: performance.now() - started,
        retryable503s,
        streamConflictRetries,
      };
    }
    if (response.kind === "Reject" && response.body?.error === "StreamConflict") {
      streamConflictRetries += 1;
      await delay(10 * attempt);
      continue;
    }
    throw new Error(`post burst rejected: ${JSON.stringify(response)}`);
  }
  throw new Error(
    `post burst exhausted ${maxAttempts} exact-command retries for ${prefix}-${index} ` +
      `(admission=${retryable503s}, stream_conflict=${streamConflictRetries})`,
  );
}

// The strict wire rejects any actor field in the envelope; seed and burst
// commands act as a principal by presenting that principal's dev session as
// the bearer.
async function seedSessionToken(baseUrl, principalId) {
  const cached = seedSessionTokens.get(principalId);
  if (cached !== undefined) {
    return cached;
  }
  const response = await fetch(`${baseUrl}/auth/local-proof/sessions`, {
    method: "POST",
    headers: localProofAuth.requestHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({
      principal_id: fixturePrincipalAuthorityId(principalId),
      expires_at: 4_102_444_800,
      global_capabilities: ["GlobalAdmin"],
    }),
  });
  const body = await response.json();
  assert(
    response.status === 200 && typeof body.session_token === "string",
    `dev session mint for ${principalId} returned ${response.status}`,
  );
  const accountResponse = await fetch(`${baseUrl}/auth/accounts`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${body.session_token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      account_id: `${principalId}@capacity.fmarch.test`,
      password: `capacity-proof-account-${principalId}`,
      principal_id: fixturePrincipalAuthorityId(principalId),
      global_capabilities: ["GlobalAdmin"],
    }),
  });
  assert(
    accountResponse.ok || accountResponse.status === 409,
    `account seed for ${principalId} returned ${accountResponse.status}`,
  );
  seedSessionTokens.set(principalId, body.session_token);
  return body.session_token;
}

async function issueWebsocketTicket(baseUrl, principalId, game, channel) {
  const sessionToken = await seedSessionToken(baseUrl, principalId);
  const response = await fetch(`${baseUrl}/auth/websocket-tickets`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${sessionToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      audience: "fmarch-live",
      game,
      channel,
      after_seq: 0,
    }),
  });
  const body = await response.json();
  assert(
    response.status === 200 && typeof body.ticket === "string",
    `websocket ticket mint for ${principalId} returned ${response.status}`,
  );
  return body.ticket;
}

async function sendCommand(
  baseUrl,
  principalId,
  command,
  { tolerateRetryable = false, commandId = randomUUID() } = {},
) {
  const sessionToken = await seedSessionToken(baseUrl, principalId);
  const response = await fetch(`${baseUrl}/commands`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${sessionToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      v: 2,
      id: Date.now(),
      body: {
        kind: "Command",
        body: {
          command_id: commandId,
          command: fixturePrincipalTransport(command, "capacity command transport"),
        },
      },
    }),
  });
  const body = await response.json();
  if ((response.status === 409 || response.status === 503) && tolerateRetryable) {
    return {
      httpStatus: response.status,
      headers: Object.fromEntries(response.headers),
      body,
    };
  }
  assert(response.status === 200, `command HTTP status was ${response.status}`);
  return { httpStatus: response.status, ...body.body };
}

async function timedFetch(url, options = {}) {
  const started = performance.now();
  const response = await fetch(url, options);
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers),
    body,
    elapsedMs: performance.now() - started,
  };
}

async function timedFetchWithRetryableAdmission(url, options = {}) {
  const started = performance.now();
  let retryable503s = 0;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const record = await timedFetch(url, options);
    if (record.status !== 503 || attempt === 6) {
      return {
        ...record,
        elapsedMs: performance.now() - started,
        retryable503s,
      };
    }
    retryable503s += 1;
    await delay(25 * attempt);
  }
  throw new Error("unreachable admission retry state");
}

async function fetchJson(url, options = {}) {
  const record = await timedFetch(url, options);
  assert(record.status >= 200 && record.status < 300, `${url} returned ${record.status}`);
  return record.body;
}

async function mapConcurrent(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await mapper(items[index], index);
      }
    }),
  );
  return results;
}

async function rawWebsocketHandshake(baseUrl, ticket) {
  return await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: baseUrl.hostname, port: Number(baseUrl.port) });
    let response = "";
    socket.setTimeout(3_000, () => socket.destroy(new Error("websocket handshake timed out")));
    socket.once("connect", () => {
      socket.write(
        [
          `GET /ws?ticket=${encodeURIComponent(ticket)}&audience=fmarch-live HTTP/1.1`,
          `Host: ${baseUrl.host}`,
          "Connection: Upgrade",
          "Upgrade: websocket",
          "Sec-WebSocket-Version: 13",
          "Sec-WebSocket-Key: Y2FwYWNpdHktcHJvb2Yta2V5",
          "",
          "",
        ].join("\r\n"),
      );
    });
    socket.on("data", (chunk) => {
      response += chunk.toString();
      if (response.includes("\r\n\r\n")) {
        socket.end();
      }
    });
    socket.once("error", reject);
    socket.once("close", () => {
      const [head] = response.split("\r\n\r\n");
      const lines = head.split("\r\n");
      const status = Number(lines[0]?.split(" ")[1]);
      const headers = Object.fromEntries(
        lines.slice(1).map((line) => {
          const separator = line.indexOf(":");
          return [
            line.slice(0, separator).toLowerCase(),
            line.slice(separator + 1).trim(),
          ];
        }),
      );
      resolve({ status, headers });
    });
  });
}

async function waitForHealth(baseUrl) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server?.exitCode !== null) {
      throw new Error(`server exited before health check\n${serverOutput.slice(-4000)}`);
    }
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) return;
    } catch {
      // The server is still migrating or binding.
    }
    await delay(100);
  }
  throw new Error(`server did not become healthy\n${serverOutput.slice(-4000)}`);
}

async function waitForTableLock({ psql, databaseUrl, relation }) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const result = await runPsql(
      psql,
      databaseUrl,
      `SELECT COUNT(*) FROM pg_locks WHERE relation = '${relation}'::regclass AND mode = 'AccessExclusiveLock' AND granted`,
      { tuplesOnly: true },
    );
    if (Number(result.stdout.trim()) >= 1) return;
    await delay(25);
  }
  throw new Error(`timed out waiting for ${relation} lock`);
}

async function waitUntil(predicate, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(25);
  }
  throw new Error(message);
}

async function cleanupReadFixtures({ psql, databaseUrl }) {
  if (!psql) return;
  const uuidExpression = sqlUuidFromMd5(`'${runId}' || value::TEXT`);
  await runPsql(
    psql,
    databaseUrl,
    `DELETE FROM publication_surface
     WHERE surface_id IN ('${crawlerDiscussionScope}', '${crawlerGameScope}')
        OR href LIKE ${sqlLiteral(`/capacity/${runId}/profiles/%`)};
     DELETE FROM thread_view WHERE game_id = '${largeThreadGame}';
     DELETE FROM game_index
     WHERE game_id = '${largeThreadGame}'
        OR game_id IN (
          SELECT ${uuidExpression}
          FROM generate_series(1, ${budgets.crawlerGames}) AS value
        );`,
  );
}

function findPsql(env) {
  const candidates = [
    env.PG_BIN && path.join(env.PG_BIN, "psql"),
    "/opt/homebrew/opt/postgresql@16/bin/psql",
    "/usr/local/opt/postgresql@16/bin/psql",
    "/opt/homebrew/bin/psql",
    "/usr/local/bin/psql",
    "/usr/bin/psql",
  ].filter(Boolean);
  return candidates.find(existsSync) ?? "psql";
}

async function runPsql(psql, databaseUrl, sql, { tuplesOnly = false } = {}) {
  return await processResult(
    spawnPsql(psql, databaseUrl, sql, { tuplesOnly }),
  );
}

function spawnPsql(psql, databaseUrl, sql, { tuplesOnly = false } = {}) {
  const args = [databaseUrl, "-v", "ON_ERROR_STOP=1"];
  if (tuplesOnly) args.push("-tA");
  args.push("-c", sql);
  const child = spawn(psql, args, { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] });
  child.capturedStdout = "";
  child.capturedStderr = "";
  child.stdout.on("data", (chunk) => {
    child.capturedStdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    child.capturedStderr += chunk.toString();
  });
  return child;
}

async function processResult(child) {
  return await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve({ stdout: child.capturedStdout, stderr: child.capturedStderr });
      } else {
        reject(
          new Error(
            `process exited with ${code ?? signal}\nstdout:\n${child.capturedStdout}\nstderr:\n${child.capturedStderr}`,
          ),
        );
      }
    });
  });
}

function flattenPlan(plan) {
  return [plan, ...(plan.Plans ?? []).flatMap(flattenPlan)];
}

function actualPlanRows(plan) {
  return Number(plan["Actual Rows"] ?? 0) * Number(plan["Actual Loops"] ?? 1);
}

function sqlUuidFromMd5(expression) {
  return `(SUBSTR(MD5(${expression}), 1, 8) || '-' || SUBSTR(MD5(${expression}), 9, 4) || '-' || SUBSTR(MD5(${expression}), 13, 4) || '-' || SUBSTR(MD5(${expression}), 17, 4) || '-' || SUBSTR(MD5(${expression}), 21, 12))::UUID`;
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function scenarioSummary(report) {
  return Object.fromEntries(
    Object.entries(report.scenarios).map(([name, scenario]) => [
      name,
      {
        status: scenario.status,
        p95Ms: scenario.p95Ms,
        statusCode: scenario.statusCode ?? scenario.rejectedStatus,
      },
    ]),
  );
}

function recordServerOutput(chunk) {
  serverOutput += chunk.toString();
}

function closeWebsockets() {
  for (const socket of websocketClients) {
    try {
      socket.close();
    } catch {
      // Best-effort proof cleanup.
    }
  }
  websocketClients = [];
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  server.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => server.once("exit", resolve)),
    delay(3_000).then(() => server.kill("SIGKILL")),
  ]);
}

async function freePort() {
  return await new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", () => {
      const address = socket.address();
      socket.close(() => resolve(address.port));
    });
  });
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function parsePositiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 100_000) {
    throw new Error(`${label} must be a safe integer of at least 100000`);
  }
  return parsed;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function printUsage() {
  console.log(`Usage: node tools/capacity_overload_proof.mjs [options]

Options:
  --migration-url URL  Owner Postgres URL (default: DATABASE_MIGRATION_URL)
  --output PATH        Artifact path (default depends on mode)
  --search-characterization
                       Run only public-search first/warm request and plan characterization
  --search-documents N Search fixture size for characterization (default: 100000)
  --help               Show this help
`);
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  main().then((code) => process.exit(code)).catch(async (error) => {
    closeWebsockets();
    await stopServer();
    if (serverOutput) error.serverOutput = serverOutput.slice(-4000);
    console.error(error);
    process.exit(1);
  });
}
