import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { seedCommandPlanForGame } from "./dev_test_game.mjs";
import { runFmarchMigrations } from "./run_fmarch_migrations.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = path.join(repoRoot, "target", "live-stack-backup-restore-drill");
const configuredMediaRoot = process.env.FMARCH_MEDIA_ROOT;
if (configuredMediaRoot !== undefined && configuredMediaRoot.trim() === "") {
  throw new Error("FMARCH_MEDIA_ROOT must not be empty");
}
const proofPath = path.join(artifactDir, "local-backup-restore-proof.json");
const dumpPath = path.join(artifactDir, "local-live-stack.dump");
const databaseUrl = process.env.DATABASE_URL;
const host = "127.0.0.1";
const game = randomUUID();
const rootAdminSessionToken = canonicalSessionToken(`backup-restore-root-admin-${game}`);
let hostSessionToken;
let playerSessionToken;
let adminSessionToken;
const privateChannelId = "private:mafia_day_chat";
const privatePostBody = "Backup restore private-channel proof post";
const seedSessionTokens = new Map();

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required, e.g. postgres://fmarch:fmarch@localhost:5544/fmarch",
  );
}

let sourceDatabase;
let restoredDatabase;
let sourceServer;
let restoredServer;

try {
  await mkdir(artifactDir, { recursive: true });
  await rm(dumpPath, { force: true });

  sourceDatabase = await createScratchDatabase(databaseUrl, "source");
  const sourceApi = await startApi(sourceDatabase.url, "source");
  const seedEvidence = await seedSourceGame(sourceApi);
  const sourceFingerprint = await databaseFingerprint(sourceDatabase.url);

  await runProcess("pg_dump", [
    "--format=custom",
    "--no-owner",
    "--no-acl",
    "--file",
    dumpPath,
    sourceDatabase.url,
  ]);

  restoredDatabase = await createScratchDatabase(databaseUrl, "restored");
  await runProcess("pg_restore", [
    "--dbname",
    restoredDatabase.url,
    "--no-owner",
    "--no-acl",
    dumpPath,
  ]);
  const restoredFingerprint = await databaseFingerprint(restoredDatabase.url);
  assertDeepEqual(restoredFingerprint, sourceFingerprint, "restored database fingerprint");

  const restoredApi = await startApi(restoredDatabase.url, "restored");
  const restoredApiEvidence = await assertRestoredApi(restoredApi);

  const proof = buildProof({
    sourceDatabase,
    restoredDatabase,
    sourceFingerprint,
    restoredFingerprint,
    sourceApi,
    restoredApi,
    seedEvidence,
    restoredApiEvidence,
  });
  await writeFile(proofPath, `${JSON.stringify(proof, null, 2)}\n`);
  console.log(`wrote ${path.relative(repoRoot, proofPath)}`);
} finally {
  if (sourceServer !== undefined) {
    await stopChild(sourceServer);
  }
  if (restoredServer !== undefined) {
    await stopChild(restoredServer);
  }
  if (sourceDatabase !== undefined) {
    await dropScratchDatabase(sourceDatabase);
  }
  if (restoredDatabase !== undefined) {
    await dropScratchDatabase(restoredDatabase);
  }
}

async function seedSourceGame(apiBaseUrl) {
  // The root GlobalAdmin session must exist before the seed loop: every seed
  // command now authenticates through a session granted by this root token.
  await runSql(sourceDatabase.url, `
    INSERT INTO platform_principal (
      principal_user_id, status, global_capabilities, created_at, disabled_at
    ) VALUES ('root_admin', 'active', ARRAY[]::TEXT[], 0, NULL)
    ON CONFLICT (principal_user_id) DO NOTHING;
  `);
  await runSql(sourceDatabase.url, `
    INSERT INTO auth_account (
      account_id,
      principal_user_id,
      password_hash,
      created_at,
      disabled_at,
      global_capabilities
    )
    VALUES (
      'backup-restore-root@local.fmarch.test',
      'root_admin',
      'seed-only-not-a-real-hash',
      0,
      NULL,
      ARRAY['GlobalAdmin']::TEXT[]
    )
    ON CONFLICT (account_id) DO NOTHING;
  `);
  await runSql(sourceDatabase.url, `
    INSERT INTO auth_session (
      token_hash,
      principal_user_id,
      created_at,
      expires_at,
      revoked_at,
      global_capabilities,
      idle_expires_at,
      assurance,
      authenticated_at
    )
    VALUES (
      ${sqlLiteral(hashSessionToken(rootAdminSessionToken))},
      'root_admin',
      0,
      4102444800,
      NULL,
      ARRAY['GlobalAdmin']::TEXT[],
      4102444800,
      'admin_grant',
      0
    )
    ON CONFLICT (token_hash) DO UPDATE SET
      principal_user_id = EXCLUDED.principal_user_id,
      expires_at = EXCLUDED.expires_at,
      revoked_at = NULL,
      global_capabilities = EXCLUDED.global_capabilities;
  `);

  const seedCommands = [];
  for (const [principalUserId, command] of [
    ...seedCommandPlanForGame(game),
    ["host_h", { LockThread: { game } }],
    ["host_h", { UnlockThread: { game } }],
    [
      "player-mira",
      {
        SubmitPost: {
          game,
          channel_id: privateChannelId,
          actor_slot: "slot-7",
          body: privatePostBody,
        },
      },
    ],
  ]) {
    seedCommands.push(
      await sendCommand(apiBaseUrl, seedCommands.length + 1, principalUserId, command),
    );
  }

  await seedSessionToken(apiBaseUrl, "admin_a");
  const grants = {
    admin: await createGrantedSession({
      apiBaseUrl,
      principalUserId: "admin_a",
      globalCapabilities: ["GlobalAdmin"],
    }),
    host: await createGrantedSession({
      apiBaseUrl,
      principalUserId: "host_h",
    }),
    player: await createGrantedSession({
      apiBaseUrl,
      principalUserId: "player-mira",
    }),
  };
  adminSessionToken = grants.admin.sessionToken;
  hostSessionToken = grants.host.sessionToken;
  playerSessionToken = grants.player.sessionToken;
  const grantedSessions = Object.fromEntries(
    Object.entries(grants).map(([role, grant]) => [
      role,
      {
        principalUserId: grant.principalUserId,
        capabilityKinds: grant.capabilityKinds,
      },
    ]),
  );

  return {
    game,
    seedCommandCount: seedCommands.length,
    seedCommandKinds: seedCommands.map((command) => command.kind),
    grantedSessions,
    boundary:
      "Source DB is seeded through the real Rust /commands API plus /auth/session-grants; the root GlobalAdmin token is inserted directly into the disposable local auth_session table.",
  };
}

async function assertRestoredApi(apiBaseUrl) {
  const hostSession = await fetchJson(
    `${apiBaseUrl}/auth/session?game=${game}`,
    {
      headers: { authorization: `Bearer ${hostSessionToken}` },
    },
  );
  const playerSession = await fetchJson(
    `${apiBaseUrl}/auth/session?game=${game}`,
    {
      headers: { authorization: `Bearer ${playerSessionToken}` },
    },
  );
  const adminSession = await fetchJson(`${apiBaseUrl}/auth/session`, {
    headers: { authorization: `Bearer ${adminSessionToken}` },
  });
  assertCapability(hostSession, "HostOf");
  assertCapability(playerSession, "SlotOccupant");
  assertCapability(adminSession, "GlobalAdmin");

  const hostConsoleState = await fetchJson(
    `${apiBaseUrl}/games/${game}/host-console-state?slot_id=slot-7`,
    { headers: { authorization: `Bearer ${hostSessionToken}` } },
  );
  if (hostConsoleState.phase?.phase_id !== "D01" || hostConsoleState.phase?.locked !== false) {
    throw new Error(
      `restored host console phase mismatch: ${JSON.stringify(hostConsoleState.phase)}`,
    );
  }

  const votecount = await fetchJson(`${apiBaseUrl}/games/${game}/votecount`);
  if (
    !votecount.some(
      (row) =>
        row.body?.candidate_slot === "slot_5" &&
        row.body?.phase_id === "D01" &&
        row.body?.count === 3,
    )
  ) {
    throw new Error(`restored votecount missing slot_5 wagon: ${JSON.stringify(votecount)}`);
  }

  const thread = await fetchJson(
    `${apiBaseUrl}/games/${game}?limit=25`,
    { headers: { authorization: `Bearer ${playerSessionToken}` } },
  );
  if (
    !thread.posts?.some((post) =>
      post.body?.includes("Seeded browser test-game thread post from dev:test-game."),
    )
  ) {
    throw new Error(`restored main thread missing seeded post: ${JSON.stringify(thread)}`);
  }

  const privateThread = await fetchJson(
    `${apiBaseUrl}/games/${game}/channels/${encodeURIComponent(
      privateChannelId,
    )}/thread?limit=25`,
    { headers: { authorization: `Bearer ${playerSessionToken}` } },
  );
  if (!privateThread.posts?.some((post) => post.body === privatePostBody)) {
    throw new Error(
      `restored private thread missing proof post: ${JSON.stringify(privateThread)}`,
    );
  }

  return {
    status: "passed",
    restoredSessions: {
      host: capabilityKinds(hostSession),
      player: capabilityKinds(playerSession),
      admin: capabilityKinds(adminSession),
    },
    hostConsolePhase: hostConsoleState.phase,
    votecount,
    mainThreadPostCount: thread.posts.length,
    privateThreadPostCount: privateThread.posts.length,
  };
}

function buildProof({
  sourceDatabase,
  restoredDatabase,
  sourceFingerprint,
  restoredFingerprint,
  sourceApi,
  restoredApi,
  seedEvidence,
  restoredApiEvidence,
}) {
  const checks = [
    ["dump-created", sourceFingerprint.events.total > 0],
    ["event-log-restored", restoredFingerprint.events.total === sourceFingerprint.events.total],
    [
      "projection-fingerprints-restored",
      JSON.stringify(restoredFingerprint.projections) ===
        JSON.stringify(sourceFingerprint.projections),
    ],
    [
      "auth-sessions-restored",
      restoredFingerprint.authSessions.total === sourceFingerprint.authSessions.total,
    ],
    ["restored-api-capabilities", restoredApiEvidence.status === "passed"],
  ].map(([id, passed]) => ({ id, status: passed ? "passed" : "failed" }));
  const status = checks.every((check) => check.status === "passed") ? "passed" : "failed";

  return {
    version: 1,
    status,
    scope: "local-live-stack-backup-restore-drill",
    productionReady: false,
    proofBoundary:
      "Local disposable Postgres databases only. Proves pg_dump/pg_restore preserves a seeded live-stack event log, rebuildable projection rows, and local opaque session capability lookup for one scratch game. It does not prove hosted backups, point-in-time recovery, encryption-key escrow, cross-region restore, multi-node failover, beta release readiness, or human runbook execution.",
    game,
    artifact: {
      proof: path.relative(repoRoot, proofPath),
      dump: path.relative(repoRoot, dumpPath),
    },
    databases: {
      source: sourceDatabase.name,
      restored: restoredDatabase.name,
      lifecycle: "created-and-dropped-per-drill-run",
    },
    api: {
      source: sourceApi,
      restored: restoredApi,
    },
    seed: seedEvidence,
    restoredApiEvidence,
    checks,
    fingerprints: {
      source: sourceFingerprint,
      restored: restoredFingerprint,
    },
  };
}

async function databaseFingerprint(url) {
  return await queryJson(url, `
    SELECT jsonb_build_object(
      'events', (
        SELECT jsonb_build_object(
          'total', COALESCE(SUM(count), 0),
          'kinds', COALESCE(jsonb_object_agg(kind, count ORDER BY kind), '{}'::jsonb)
        )
        FROM (
          SELECT kind, COUNT(*) AS count
          FROM events
          WHERE stream_id = ${sqlLiteral(game)}::uuid
          GROUP BY kind
        ) event_counts
      ),
      'projections', jsonb_build_object(
        'phase_state', (
          SELECT COALESCE(jsonb_agg(to_jsonb(rows) ORDER BY phase_id), '[]'::jsonb)
          FROM (SELECT phase_id, locked, deadline FROM phase_state WHERE game_id = ${sqlLiteral(game)}::uuid) rows
        ),
        'game_personas', (
          SELECT COALESCE(jsonb_agg(to_jsonb(rows) ORDER BY persona_id), '[]'::jsonb)
          FROM (
            SELECT public.persona_id, public.current_public_name, private.principal_user_id
            FROM game_persona_public public
            JOIN game_persona_private private
              ON private.game_id = public.game_id
             AND private.persona_id = public.persona_id
            WHERE public.game_id = ${sqlLiteral(game)}::uuid
          ) rows
        ),
        'slot_occupancy_epochs', (
          SELECT COALESCE(jsonb_agg(to_jsonb(rows) ORDER BY slot_id, began_seq), '[]'::jsonb)
          FROM (
            SELECT occupancy_id, transition_id, slot_id, persona_id, began_seq, ended_seq,
                   start_reason, end_reason
            FROM slot_occupancy_epoch
            WHERE game_id = ${sqlLiteral(game)}::uuid
          ) rows
        ),
        'slot_state', (
          SELECT COALESCE(jsonb_agg(to_jsonb(rows) ORDER BY slot_id), '[]'::jsonb)
          FROM (SELECT slot_id, alive, role_revealed, alignment_revealed, status, private FROM slot_state WHERE game_id = ${sqlLiteral(game)}::uuid) rows
        ),
        'vote_ballot', (
          SELECT COALESCE(jsonb_agg(to_jsonb(rows) ORDER BY actor_slot), '[]'::jsonb)
          FROM (SELECT phase_id, actor_slot, target FROM vote_ballot WHERE game_id = ${sqlLiteral(game)}::uuid) rows
        ),
        'thread_view', (
          SELECT COALESCE(jsonb_agg(to_jsonb(rows) ORDER BY source_seq), '[]'::jsonb)
          FROM (SELECT source_seq, stream_seq, channel_id, author_slot, author_user, phase_id, body, body_private FROM thread_view WHERE game_id = ${sqlLiteral(game)}::uuid) rows
        ),
        'private_channel_member', (
          SELECT COALESCE(jsonb_agg(to_jsonb(rows) ORDER BY channel_id, slot_id), '[]'::jsonb)
          FROM (SELECT channel_id, kind, slot_id, source, private FROM private_channel_member WHERE game_id = ${sqlLiteral(game)}::uuid) rows
        )
      ),
      'authSessions', (
        SELECT jsonb_build_object(
          'total', COUNT(*),
          'principals', COALESCE(jsonb_agg(principal_user_id ORDER BY principal_user_id), '[]'::jsonb)
        )
        FROM auth_session
        WHERE principal_user_id IN ('root_admin', 'admin_a', 'host_h', 'player-mira')
      )
    ) AS fingerprint;
  `);
}

async function createScratchDatabase(sourceDatabaseUrl, label) {
  const source = new URL(sourceDatabaseUrl);
  const admin = new URL(sourceDatabaseUrl);
  admin.pathname = "/postgres";
  const scratch = new URL(sourceDatabaseUrl);
  const sourceName = source.pathname.replace(/^\/+/, "") || "fmarch";
  const name = `${sanitizeDatabaseName(sourceName)}_restore_${label}_${process.pid}_${Date.now()}`;
  scratch.pathname = `/${name}`;

  await runProcess("psql", [
    admin.toString(),
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    `CREATE DATABASE "${name}"`,
  ]);

  return { name, adminUrl: admin.toString(), url: scratch.toString() };
}

async function dropScratchDatabase({ adminUrl, name }) {
  await runProcess("psql", [
    adminUrl,
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${sqlLiteral(name)}`,
  ]);
  await runProcess("psql", [
    adminUrl,
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    `DROP DATABASE IF EXISTS "${name}"`,
  ]);
}

async function startApi(url, label) {
  await runFmarchMigrations({ cwd: repoRoot, databaseUrl: url });
  const port = await freePort();
  const baseUrl = `http://${host}:${port}`;
  const mediaRoot =
    configuredMediaRoot === undefined
      ? path.join(artifactDir, `media-store-${label}`)
      : path.resolve(repoRoot, configuredMediaRoot);
  await mkdir(mediaRoot, { recursive: true, mode: 0o700 });
  const child = spawn("cargo", ["run", "-p", "server"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      DATABASE_URL: url,
      FMARCH_BIND: `${host}:${port}`,
      FMARCH_MEDIA_ROOT: mediaRoot,
      FMARCH_EVENT_WRAP_KEY:
        process.env.FMARCH_EVENT_WRAP_KEY ??
        "backup-restore-proof-key-at-least-32-bytes",
      FMARCH_EVENT_WRAP_KID:
        process.env.FMARCH_EVENT_WRAP_KID ?? "backup-restore-proof-wrap-v1",
      FMARCH_EVENT_ARCHIVE_KEY:
        process.env.FMARCH_EVENT_ARCHIVE_KEY ??
        "backup-restore-proof-archive-key-at-least-32-bytes",
      FMARCH_EVENT_ARCHIVE_KID:
        process.env.FMARCH_EVENT_ARCHIVE_KID ?? "backup-restore-proof-archive-v1",
      FMARCH_AUTH_SOURCE_SIGNING_KEY:
        process.env.FMARCH_AUTH_SOURCE_SIGNING_KEY ??
        "backup-restore-proof-signing-key-at-least-32-bytes",
      // This drill owns a local debug server and seeds classic credentials.
      // Keep the deterministic identity gateway explicit here rather than
      // depending on a caller to remember a dev-only auth switch.
      FMARCH_DEV_AUTH: "1",
      RUST_LOG: process.env.RUST_LOG ?? "warn",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (label === "source") {
    sourceServer = child;
  } else {
    restoredServer = child;
  }
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  await waitForHealth(baseUrl, {
    label: `${label} Rust API`,
    beforeRetry: () => {
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(
          `${label} Rust API exited before healthcheck:\n${output.slice(-4000)}`,
        );
      }
    },
  });
  return baseUrl;
}

// The strict wire rejects any actor field in the envelope; seed commands act
// as a principal by presenting a granted session for that principal instead.
async function seedSessionToken(apiBaseUrl, principalUserId) {
  if (principalUserId === "root_admin") {
    return rootAdminSessionToken;
  }
  const cached = seedSessionTokens.get(principalUserId);
  if (cached !== undefined) {
    return cached;
  }
  const globalCapabilities =
    principalUserId === "host_h" ? ["GlobalAdmin"] : [];
  await fetchJson(`${apiBaseUrl}/auth/accounts`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${rootAdminSessionToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      account_id: `backup-restore-${principalUserId}@local.fmarch.test`,
      password: `backup restore seed password ${principalUserId}`,
      principal_user_id: principalUserId,
      global_capabilities: globalCapabilities,
    }),
  });
  const granted = await fetchJson(`${apiBaseUrl}/auth/session-grants`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${rootAdminSessionToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      principal_user_id: principalUserId,
      expires_at: 4102444800,
      global_capabilities: globalCapabilities,
    }),
  });
  if (typeof granted.session_token !== "string" || granted.session_token === "") {
    throw new Error(`session grant for ${principalUserId} returned no session_token`);
  }
  seedSessionTokens.set(principalUserId, granted.session_token);
  return granted.session_token;
}

async function sendCommand(apiBaseUrl, id, principalUserId, command) {
  const sessionToken = await seedSessionToken(apiBaseUrl, principalUserId);
  const result = await fetchJson(`${apiBaseUrl}/commands`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${sessionToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      v: 1,
      id,
      body: {
        kind: "Command",
        body: {
          command_id: randomUUID(),
          command,
        },
      },
    }),
  });
  if (result.body?.kind !== "Ack") {
    throw new Error(`command rejected: ${JSON.stringify(result)}`);
  }
  return {
    principalUserId,
    kind: Object.keys(command)[0],
    streamSeqs: result.body.body.stream_seqs,
  };
}

async function createGrantedSession({
  apiBaseUrl,
  principalUserId,
  globalCapabilities = [],
}) {
  const session = await fetchJson(`${apiBaseUrl}/auth/session-grants`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${rootAdminSessionToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      principal_user_id: principalUserId,
      expires_at: 4102444800,
      global_capabilities: globalCapabilities,
    }),
  });
  return {
    sessionToken: session.session_token,
    principalUserId: session.principal_user_id,
    capabilityKinds: capabilityKinds(session),
  };
}

async function queryJson(url, sql) {
  const output = await runProcess("psql", [
    url,
    "-X",
    "--tuples-only",
    "--no-align",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    sql,
  ]);
  return JSON.parse(output.trim());
}

async function runSql(url, sql) {
  return await runProcess("psql", [url, "-v", "ON_ERROR_STOP=1", "-c", sql]);
}

async function runProcess(command, args) {
  const child = spawn(command, args, {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", resolve);
  });
  if (code !== 0) {
    throw new Error(`${command} ${args[0]} failed with exit ${code}:\n${output}`);
  }
  return output;
}

async function fetchJson(url, options = {}, timeoutMs = 15000) {
  const response = await fetchWithTimeout(url, options, timeoutMs);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

async function waitForHealth(baseUrl, { label, beforeRetry }) {
  const started = Date.now();
  const deadline = started + 240000;
  while (Date.now() < deadline) {
    beforeRetry();
    try {
      const response = await fetchWithTimeout(`${baseUrl}/healthz`, {}, 1000);
      if (response.ok) {
        return;
      }
    } catch {
      // The Rust server may still be compiling, migrating, or binding.
    }
    await delay(250);
  }
  throw new Error(`${label} did not become healthy at ${baseUrl}/healthz`);
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill("SIGINT");
  const stopped = await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(5000).then(() => "timeout"),
  ]);
  if (stopped === "timeout") {
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("exit", resolve));
  }
}

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      server.close(() => {
        if (address === null || typeof address !== "object") {
          reject(new Error("free port server did not expose an address"));
        } else {
          resolve(address.port);
        }
      });
    });
  });
}

function assertCapability(session, kind) {
  const kinds = capabilityKinds(session);
  if (!kinds.includes(kind)) {
    throw new Error(`session missing ${kind}: ${JSON.stringify(session)}`);
  }
}

function capabilityKinds(session) {
  return (session.capabilities ?? []).map((capability) => capability.kind);
}

function assertDeepEqual(actual, expected, label) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${label} mismatch\nactual: ${actualJson}\nexpected: ${expectedJson}`);
  }
}

function hashSessionToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function canonicalSessionToken(seed) {
  return `fmss_${hashSessionToken(seed)}`;
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sanitizeDatabaseName(name) {
  const sanitized = name.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase();
  const prefix = sanitized === "" ? "fmarch" : sanitized;
  return prefix.slice(0, 20);
}
