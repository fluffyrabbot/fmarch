import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  assertCapacityOverloadReport,
  capacityOverloadBudgets as budgets,
  requestSummary,
} from "./capacity_overload_contract.mjs";
import { seedSetupCommandPlanForGame } from "./dev_test_game_setup_bootstrap_scenario.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultDatabaseUrl =
  "postgres://fmarch:fmarch@127.0.0.1:5544/fmarch_capacity_overload";
const defaultOutput = path.join(
  repoRoot,
  "target",
  "capacity-overload",
  "report.json",
);
const serverBinary = path.join(repoRoot, "target", "debug", "server");
const mediaRoot = path.join(repoRoot, "target", "capacity-overload", "media");
const runId = randomUUID().replaceAll("-", "");
const largeThreadGame = randomUUID();
const crawlerScope = randomUUID();
const postBurstGame = randomUUID();
const postPrefix = `capacity-post-${runId}`;
const wsPostPrefix = `capacity-ws-${runId}`;

let server;
let serverOutput = "";
let websocketClients = [];

export async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  if (args.help) {
    printUsage();
    return 0;
  }
  const databaseUrl = args.databaseUrl ?? env.DATABASE_URL ?? defaultDatabaseUrl;
  const outputPath = path.resolve(args.output ?? defaultOutput);
  const psql = findPsql(env);
  if (!existsSync(serverBinary)) {
    throw new Error("target/debug/server is missing; run cargo build -p server first");
  }
  await mkdir(path.dirname(outputPath), { recursive: true });
  await mkdir(mediaRoot, { recursive: true });

  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await startServer({ baseUrl, port, databaseUrl, env });
    await seedReadFixtures({ psql, databaseUrl });

    const scenarios = {};
    scenarios.largeThreadColdRead = await proveLargeThreadColdRead({
      baseUrl,
      psql,
      databaseUrl,
    });
    scenarios.anonymousCrawler = await proveAnonymousCrawler({ baseUrl });
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
        "Repo-local Postgres and one debug server process. Exercises indexed large-thread cold loads, anonymous board/search pressure, concurrent writes to one real game stream, bounded slow-live-consumer recovery, HTTP/WS 503 admission, and caller-scoped auth 429 behavior. Local latency budgets detect gross regressions; they are not hosted production SLO evidence or capacity planning for a specific machine size.",
    };
    assertCapacityOverloadReport(report);
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
    } else if (value === "--database-url") {
      args.databaseUrl = requireValue(argv, ++index, value);
    } else if (value === "--output") {
      args.output = requireValue(argv, ++index, value);
    } else {
      throw new Error(`unknown argument: ${value}`);
    }
  }
  return args;
}

async function startServer({ baseUrl, port, databaseUrl, env }) {
  server = spawn(serverBinary, [], {
    cwd: repoRoot,
    env: {
      ...env,
      DATABASE_URL: databaseUrl,
      FMARCH_BIND: `127.0.0.1:${port}`,
      FMARCH_MEDIA_ROOT: mediaRoot,
      FMARCH_DB_MAX_CONNECTIONS: "10",
      FMARCH_DB_ACQUIRE_TIMEOUT_MS: "250",
      FMARCH_DB_STATEMENT_TIMEOUT_MS: "4000",
      FMARCH_DB_LOCK_TIMEOUT_MS: "2000",
      FMARCH_DB_IDLE_TRANSACTION_TIMEOUT_MS: "5000",
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
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", recordServerOutput);
  server.stderr.on("data", recordServerOutput);
  await waitForHealth(baseUrl);
}

async function seedReadFixtures({ psql, databaseUrl }) {
  const pack = sqlLiteral(`capacity-proof-${runId}`);
  const uuidExpression = sqlUuidFromMd5(`'${runId}' || value::TEXT`);
  await runPsql(
    psql,
    databaseUrl,
    `
      INSERT INTO game_index (
        game_id, pack, status, phase_id, created_seq, started_seq, completed_seq, updated_seq
      ) VALUES (
        '${largeThreadGame}', ${pack}, 'active', 'D01', 1, 1, NULL, ${budgets.largeThreadRows}
      );
      INSERT INTO thread_view (
        game_id, source_seq, stream_seq, channel_id, author_slot, author_user,
        phase_id, body, occurred_at, media
      )
      SELECT '${largeThreadGame}', value, value,
             CASE WHEN value % 5 = 0 THEN 'main' ELSE 'private:capacity-' || (value % 4) END,
             NULL, 'capacity-reader',
             'D01', 'large thread fixture post ' || value, value, '[]'::JSONB
      FROM generate_series(1, ${budgets.largeThreadRows}) AS value;
      INSERT INTO game_index (
        game_id, pack, status, phase_id, created_seq, started_seq, completed_seq, updated_seq
      )
      SELECT ${uuidExpression}, ${pack}, 'active', 'D01', value, value, NULL,
             ${budgets.largeThreadRows} + value
      FROM generate_series(1, ${budgets.crawlerGames}) AS value;
      INSERT INTO public_search_document (
        document_kind, document_key, scope_kind, scope_id, title, body, href,
        updated_seq, published_at
      )
      SELECT CASE WHEN value % 2 = 0 THEN 'game_post' ELSE 'discussion_post' END,
             '${runId}-' || value,
             CASE WHEN value % 2 = 0 THEN 'game' ELSE 'discussion' END,
             '${crawlerScope}',
             'Capacity document ' || value,
             'capacityword bounded crawler fixture ' || value,
             '/capacity/' || value,
             value,
             value
      FROM generate_series(1, ${budgets.crawlerDocuments}) AS value;
      ANALYZE thread_view;
      ANALYZE game_index;
      ANALYZE public_search_document;
    `,
  );
}

async function proveLargeThreadColdRead({ baseUrl, psql, databaseUrl }) {
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
     SELECT game_id, source_seq, stream_seq, channel_id, author_slot,
            author_user, phase_id, body, media, occurred_at
     FROM thread_view
     WHERE game_id = '${largeThreadGame}'
       AND channel_id = 'main'
       AND NOT EXISTS (
         SELECT 1 FROM moderation_target_state AS moderation
         WHERE moderation.target_kind = 'game_post'
           AND moderation.scope_id = thread_view.game_id
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

async function proveAnonymousCrawler({ baseUrl }) {
  const firstPage = await fetchJson(`${baseUrl}/games?limit=50`);
  const cursor = firstPage.next_cursor;
  assert(cursor, "crawler game fixture did not produce a next cursor");
  const urls = Array.from({ length: budgets.crawlerRequests }, (_, index) =>
    index % 3 === 0
      ? `${baseUrl}/search?q=capacityword&limit=20`
      : index % 3 === 1
        ? `${baseUrl}/games?limit=50`
        : `${baseUrl}/games?limit=50&cursor=${encodeURIComponent(cursor)}`,
  );
  const records = await mapConcurrent(
    urls,
    budgets.crawlerConcurrency,
    async (url) => await timedFetch(url),
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
    ...requestSummary(records),
  };
}

async function proveSingleGamePostBurst({ baseUrl }) {
  for (const [principalUserId, command] of seedSetupCommandPlanForGame(postBurstGame)) {
    const seeded = await sendCommand(baseUrl, principalUserId, command);
    assert(seeded.kind === "Ack", `game seed rejected: ${JSON.stringify(seeded)}`);
  }
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

async function proveSlowWebsocketConsumers({ baseUrl }) {
  const wsUrl = baseUrl.replace(/^http/, "ws");
  const states = Array.from({ length: budgets.websocketConnections }, () => ({
    resyncs: 0,
  }));
  websocketClients = await Promise.all(
    states.map(
      (state) =>
        new Promise((resolve, reject) => {
          const socket = new WebSocket(
            `${wsUrl}/ws?game=${postBurstGame}&principal_user_id=player-mira&channel=main`,
          );
          socket.addEventListener("open", () => resolve(socket), { once: true });
          socket.addEventListener("error", () => reject(new Error("websocket open failed")), {
            once: true,
          });
          socket.addEventListener("message", (event) => {
            try {
              const envelope = JSON.parse(String(event.data));
              if (
                envelope?.body?.kind === "Delta" &&
                envelope?.body?.body?.kind === "ResyncRequired"
              ) {
                state.resyncs += 1;
              }
            } catch {
              // Non-JSON frames are not part of the typed server protocol.
            }
          });
        }),
    ),
  );

  const rejectedHandshake = await rawWebsocketHandshake(new URL(baseUrl));
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
      session_token: `capacity-session-${runId}`,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
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
  let retryable503s = 0;
  let streamConflictRetries = 0;
  for (let attempt = 1; attempt <= 12; attempt += 1) {
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
      { tolerate503: true },
    );
    if (response.httpStatus === 503) {
      retryable503s += 1;
      await delay(25 * attempt);
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
  throw new Error(`post burst exhausted retries for ${prefix}-${index}`);
}

async function sendCommand(
  baseUrl,
  principalUserId,
  command,
  { tolerate503 = false } = {},
) {
  const response = await fetch(`${baseUrl}/commands`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      v: 1,
      id: Date.now(),
      body: {
        kind: "Command",
        body: {
          command_id: randomUUID(),
          principal_user_id: principalUserId,
          command,
        },
      },
    }),
  });
  const body = await response.json();
  if (response.status === 503 && tolerate503) {
    return { httpStatus: 503, headers: Object.fromEntries(response.headers), body };
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

async function rawWebsocketHandshake(baseUrl) {
  return await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: baseUrl.hostname, port: Number(baseUrl.port) });
    let response = "";
    socket.setTimeout(3_000, () => socket.destroy(new Error("websocket handshake timed out")));
    socket.once("connect", () => {
      socket.write(
        [
          `GET /ws?game=${postBurstGame}&principal_user_id=player-mira&channel=main HTTP/1.1`,
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
  const pack = sqlLiteral(`capacity-proof-${runId}`);
  await runPsql(
    psql,
    databaseUrl,
    `DELETE FROM public_search_document WHERE scope_id = '${crawlerScope}';
     DELETE FROM thread_view WHERE game_id = '${largeThreadGame}';
     DELETE FROM game_index WHERE pack = ${pack};`,
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function printUsage() {
  console.log(`Usage: node tools/capacity_overload_proof.mjs [options]

Options:
  --database-url URL  Postgres database URL (default: DATABASE_URL)
  --output PATH       Proof artifact path (default: target/capacity-overload/report.json)
  --help              Show this help
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
