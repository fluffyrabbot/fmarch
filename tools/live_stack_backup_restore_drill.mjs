import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  commandTargetPrincipalAliases,
  seedCommandPlanForGame,
} from "./dev_test_game.mjs";
import { runFmarchMigrations, serverRuntimeEnvironment } from "./run_fmarch_migrations.mjs";
import { createLocalProofAuth } from "./local_proof_auth.mjs";
import {
  fixturePrincipalAuthorityId,
  fixturePrincipalTransport,
} from "./principal_fixture.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = path.resolve(
  process.env.FMARCH_PROOF_ARTIFACT_DIR ??
    path.join(repoRoot, "target", "live-stack-backup-restore-drill"),
);
const configuredMediaRoot = process.env.FMARCH_MEDIA_ROOT;
if (configuredMediaRoot !== undefined && configuredMediaRoot.trim() === "") {
  throw new Error("FMARCH_MEDIA_ROOT must not be empty");
}
const proofPath = path.join(artifactDir, "local-backup-restore-proof.json");
const dumpPath = path.join(artifactDir, "local-live-stack.dump");
const migrationUrl = process.env.DATABASE_MIGRATION_URL;
const restoreMigrationUrl = process.env.DATABASE_RESTORE_MIGRATION_URL;
const runnerOwnsDatabases =
  process.env.FMARCH_PROOF_LANE_ID === "test:live-stack-backup-restore-drill";
if (runnerOwnsDatabases && configuredMediaRoot !== undefined) {
  throw new Error("runner-owned backup/restore drill may not override FMARCH_MEDIA_ROOT");
}
const host = "127.0.0.1";
const game = randomUUID();
let rootAdminSessionToken;
let hostSessionToken;
let playerSessionToken;
let adminSessionToken;
const privateChannelId = "private:mafia_day_chat";
const privatePostBody = "Backup restore private-channel proof post";
const seedSessionTokens = new Map();
const localProofAuthByApiBase = new Map();

if (!migrationUrl) {
  throw new Error(
    "DATABASE_MIGRATION_URL is required, e.g. postgres://fmarch:fmarch@localhost:5544/fmarch",
  );
}
if (runnerOwnsDatabases && !restoreMigrationUrl) {
  throw new Error(
    "runner-owned backup/restore drill requires DATABASE_RESTORE_MIGRATION_URL",
  );
}

let sourceDatabase;
let restoredDatabase;
let sourceServer;
let restoredServer;

try {
  await mkdir(artifactDir, { recursive: true });
  await rm(dumpPath, { force: true });

  sourceDatabase = runnerOwnsDatabases
    ? runnerOwnedDatabase(migrationUrl)
    : await createScratchDatabase(migrationUrl, "source");
  const sourceAuthority = await runFmarchMigrations({
    cwd: repoRoot,
    migrationUrl: sourceDatabase.migrationUrl,
  });
  sourceDatabase.applicationUrl = sourceAuthority.applicationUrl;
  const sourceApi = await startApi(sourceAuthority.applicationUrl, "source");
  const seedEvidence = await seedSourceGame(sourceApi);
  const sourceFingerprint = await databaseFingerprint(sourceAuthority.applicationUrl);

  await runProcess("pg_dump", [
    "--format=custom",
    "--no-owner",
    "--no-acl",
    "--file",
    dumpPath,
    sourceAuthority.migrationUrl,
  ]);
  // A restore drill is a sequential authority transfer, not a two-stack load test.
  // Both disposable databases deliberately share the cluster-wide application
  // role, so keeping the source pool alive can exhaust that role's connection
  // limit before the restored API starts.
  await stopChild(sourceServer);
  sourceServer = undefined;

  restoredDatabase = runnerOwnsDatabases
    ? runnerOwnedDatabase(restoreMigrationUrl)
    : await createScratchDatabase(migrationUrl, "restored");
  await runProcess("pg_restore", [
    "--dbname",
    restoredDatabase.migrationUrl,
    "--no-owner",
    "--no-acl",
    dumpPath,
  ]);
  const restoredAuthority = await runFmarchMigrations({
    cwd: repoRoot,
    migrationUrl: restoredDatabase.migrationUrl,
  });
  restoredDatabase.applicationUrl = restoredAuthority.applicationUrl;
  const applicationAuthority = await assertRestoredApplicationAuthority(
    restoredAuthority.applicationUrl,
    restoredAuthority.roleNames.application,
  );
  const restoredFingerprint = await databaseFingerprint(restoredAuthority.applicationUrl);
  assertDeepEqual(restoredFingerprint, sourceFingerprint, "restored database fingerprint");

  const restoredApi = await startApi(restoredAuthority.applicationUrl, "restored");
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
    applicationAuthority,
    databaseRoles: {
      migration: new URL(restoredAuthority.migrationUrl).username,
      application: restoredAuthority.roleNames.application,
      keyAdmin: restoredAuthority.roleNames.keyAdmin,
    },
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
  if (sourceDatabase !== undefined && !sourceDatabase.runnerOwned) {
    await dropScratchDatabase(sourceDatabase);
  }
  if (restoredDatabase !== undefined && !restoredDatabase.runnerOwned) {
    await dropScratchDatabase(restoredDatabase);
  }
}

async function seedSourceGame(apiBaseUrl) {
  // The disposable dev endpoint is the root fixture's only authority mint.
  // This keeps auth_account creation behind the classic-method invariant.
  const rootSession = await fetchJson(`${apiBaseUrl}/auth/local-proof/sessions`, {
    method: "POST",
    headers: localProofHeaders(apiBaseUrl, { "content-type": "application/json" }),
    body: JSON.stringify({
      principal_id: fixturePrincipalAuthorityId("root_admin"),
      expires_at: 4102444800,
      global_capabilities: ["GlobalAdmin"],
    }),
  });
  if (typeof rootSession.session_token !== "string" || rootSession.session_token === "") {
    throw new Error("root fixture session response omitted its issued token");
  }
  rootAdminSessionToken = rootSession.session_token;
  seedSessionTokens.set("root_admin", rootAdminSessionToken);

  const seedPlan = [
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
  ];
  const authenticatedPrincipals = new Set(seedPlan.map(([principalId]) => principalId));
  for (const [, command] of seedPlan) {
    for (const targetPrincipal of commandTargetPrincipalAliases(command)) {
      authenticatedPrincipals.add(targetPrincipal);
    }
  }
  for (const principalId of authenticatedPrincipals) {
    await seedSessionToken(apiBaseUrl, principalId);
  }

  const seedCommands = [];
  for (const [principalId, command] of seedPlan) {
    seedCommands.push(
      await sendCommand(apiBaseUrl, seedCommands.length + 1, principalId, command),
    );
  }

  await seedSessionToken(apiBaseUrl, "admin_a");
  const grants = {
    admin: await createLocalProofSession({
      apiBaseUrl,
      principalId: "admin_a",
      globalCapabilities: ["GlobalAdmin"],
    }),
    host: await createLocalProofSession({
      apiBaseUrl,
      principalId: "host_h",
    }),
    player: await createLocalProofSession({
      apiBaseUrl,
      principalId: "player-mira",
    }),
  };
  adminSessionToken = grants.admin.sessionToken;
  hostSessionToken = grants.host.sessionToken;
  playerSessionToken = grants.player.sessionToken;
  const grantedSessions = Object.fromEntries(
    Object.entries(grants).map(([role, grant]) => [
      role,
      {
        principalId: grant.principalId,
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
      "Source DB is seeded through the real Rust auth and /commands APIs; fixture aliases become UUID authority only at account, session, and command transports. The restored process rejects source local-proof sessions because their persisted instance id differs, and roles reauthenticate through durable classic methods.",
  };
}

async function assertRestoredApi(apiBaseUrl) {
  const staleSessionStatuses = await Promise.all(
    [hostSessionToken, playerSessionToken, adminSessionToken].map(async (sessionToken) => {
      const response = await fetch(`${apiBaseUrl}/auth/session`, {
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      return response.status;
    }),
  );
  if (!staleSessionStatuses.every((status) => status === 401)) {
    throw new Error(
      `restored process accepted foreign-instance local-proof sessions: ${staleSessionStatuses.join(",")}`,
    );
  }
  hostSessionToken = await loginRestoredAccount(apiBaseUrl, "host_h");
  playerSessionToken = await loginRestoredAccount(apiBaseUrl, "player-mira");
  adminSessionToken = await loginRestoredAccount(apiBaseUrl, "admin_a");

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
    sourceLocalProofSessionsRejectedByRestoredInstance: true,
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
  applicationAuthority,
  databaseRoles,
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
    ["restored-application-ddl-denied", applicationAuthority.ddl.status === "passed"],
    [
      "restored-application-trigger-disable-denied",
      applicationAuthority.triggerDisable.status === "passed",
    ],
    [
      "restored-application-sqlx-mutation-denied",
      applicationAuthority.sqlxMutation.status === "passed",
    ],
  ].map(([id, passed]) => ({ id, status: passed ? "passed" : "failed" }));
  const status = checks.every((check) => check.status === "passed") ? "passed" : "failed";

  return {
    version: 1,
    status,
    scope: "local-live-stack-backup-restore-drill",
    productionReady: false,
    proofBoundary:
      "Local disposable Postgres databases only. Proves pg_dump/pg_restore preserves a seeded live-stack event log, rebuildable projection rows, and local opaque session capability lookup for one scratch game; owner-only restore reconciliation re-establishes an application role that cannot perform DDL, disable triggers, or mutate SQLx history. It does not prove hosted backups, point-in-time recovery, encryption-key escrow, cross-region restore, multi-node failover, beta release readiness, or human runbook execution.",
    game,
    artifact: {
      proof: path.relative(repoRoot, proofPath),
      dump: path.relative(repoRoot, dumpPath),
    },
    databases: {
      source: sourceDatabase.name,
      restored: restoredDatabase.name,
      lifecycle: sourceDatabase.runnerOwned && restoredDatabase.runnerOwned
        ? "runner-owned-disposable-per-drill-run"
        : "created-and-dropped-per-drill-run",
      roles: databaseRoles,
    },
    api: {
      source: sourceApi,
      restored: restoredApi,
    },
    seed: seedEvidence,
    restoredApiEvidence,
    applicationAuthority,
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
            SELECT root.persona_id,
                   root.registered_seq,
                   public.current_public_name,
                   public.renamed_seq,
                   binding.lifecycle AS binding_lifecycle
            FROM game_persona root
            JOIN game_persona_public public
              ON public.game_id = root.game_id
             AND public.persona_id = root.persona_id
            LEFT JOIN game_persona_subject_binding binding
              ON binding.game_id = root.game_id
             AND binding.persona_id = root.persona_id
            WHERE root.game_id = ${sqlLiteral(game)}::uuid
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
          FROM (SELECT source_seq, stream_seq, channel_id, author_kind, author_slot_id, phase_id, body, body_private FROM thread_view WHERE game_id = ${sqlLiteral(game)}::uuid) rows
        ),
        'private_channel_member', (
          SELECT COALESCE(jsonb_agg(to_jsonb(rows) ORDER BY channel_id, slot_id), '[]'::jsonb)
          FROM (SELECT channel_id, kind, slot_id, source, private FROM private_channel_member WHERE game_id = ${sqlLiteral(game)}::uuid) rows
        )
      ),
      'authSessions', (
        SELECT jsonb_build_object(
          'total', COUNT(*),
          'principals', COALESCE(jsonb_agg(principal_id ORDER BY principal_id), '[]'::jsonb)
        )
        FROM auth_session
        WHERE principal_id IN (${[
          "root_admin",
          "admin_a",
          "host_h",
          "player-mira",
        ]
          .map((alias) => `${sqlLiteral(fixturePrincipalAuthorityId(alias))}::uuid`)
          .join(", ")})
      )
    ) AS fingerprint;
  `);
}

async function assertRestoredApplicationAuthority(applicationUrl, expectedRole) {
  const actualRole = await queryJson(
    applicationUrl,
    "SELECT to_jsonb(current_user) AS current_user",
  );
  if (actualRole !== expectedRole) {
    throw new Error(
      `restored application connection used ${JSON.stringify(actualRole)}, expected ${expectedRole}`,
    );
  }

  const ddl = await expectSqlDenied({
    applicationUrl,
    id: "ddl",
    sql: "CREATE TABLE public.fmarch_application_ddl_probe (id BIGINT)",
    expected: /permission denied for schema public/u,
  });
  const triggerDisable = await expectSqlDenied({
    applicationUrl,
    id: "trigger-disable",
    sql: "ALTER TABLE public.events DISABLE TRIGGER ALL",
    expected: /(?:must be owner of table events|permission denied for table events)/u,
  });
  const sqlxMutation = await expectSqlDenied({
    applicationUrl,
    id: "sqlx-mutation",
    sql: "UPDATE public._sqlx_migrations SET success = success WHERE FALSE",
    expected: /permission denied for table _sqlx_migrations/u,
  });

  return {
    status: "passed",
    role: expectedRole,
    ddl,
    triggerDisable,
    sqlxMutation,
  };
}

async function expectSqlDenied({ applicationUrl, id, sql, expected }) {
  const result = await runProcessResult("psql", [
    applicationUrl,
    "-X",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    sql,
  ]);
  if (result.code === 0) {
    throw new Error(`restored application authority unexpectedly allowed ${id}`);
  }
  if (!expected.test(result.output)) {
    throw new Error(
      `restored application ${id} failed for the wrong reason:\n${result.output}`,
    );
  }
  return { status: "passed", denial: "insufficient_privilege" };
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

  return { name, adminUrl: admin.toString(), migrationUrl: scratch.toString() };
}

function runnerOwnedDatabase(migrationUrl) {
  const name = decodeURIComponent(new URL(migrationUrl).pathname).replace(/^\/+/, "");
  if (!name) {
    throw new Error("runner-owned backup/restore database URL must name a database");
  }
  return { name, migrationUrl, runnerOwned: true };
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

async function startApi(applicationUrl, label) {
  const port = await freePort();
  const baseUrl = `http://${host}:${port}`;
  const localProofAuth = createLocalProofAuth();
  localProofAuthByApiBase.set(baseUrl, localProofAuth);
  const mediaRoot =
    configuredMediaRoot === undefined
      ? path.join(artifactDir, `media-store-${label}`)
      : path.resolve(repoRoot, configuredMediaRoot);
  await mkdir(mediaRoot, { recursive: true, mode: 0o700 });
  const child = spawn("cargo", ["run", "-p", "server"], {
    cwd: repoRoot,
    env: localProofAuth.serverEnvironment({
      ...serverRuntimeEnvironment({ applicationUrl }),
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
      RUST_LOG: process.env.RUST_LOG ?? "warn",
    }),
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

// The strict wire rejects any actor field in the envelope. This local proof
// therefore mints a debug-only session for each fixture principal.
async function seedSessionToken(apiBaseUrl, principalId) {
  if (principalId === "root_admin") {
    if (typeof rootAdminSessionToken !== "string" || rootAdminSessionToken === "") {
      throw new Error("root fixture session was not created");
    }
    return rootAdminSessionToken;
  }
  const cached = seedSessionTokens.get(principalId);
  if (cached !== undefined) {
    return cached;
  }
  const globalCapabilities =
    principalId === "host_h" || principalId === "admin_a" ? ["GlobalAdmin"] : [];
  const authorityPrincipalId = fixturePrincipalAuthorityId(principalId);
  await fetchJson(`${apiBaseUrl}/auth/accounts`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${rootAdminSessionToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      account_id: `backup-restore-${principalId}@local.fmarch.test`,
      password: `backup restore seed password ${principalId}`,
      principal_id: authorityPrincipalId,
      global_capabilities: globalCapabilities,
    }),
  });
  const localProofSession = await fetchJson(`${apiBaseUrl}/auth/local-proof/sessions`, {
    method: "POST",
    headers: localProofHeaders(apiBaseUrl, { "content-type": "application/json" }),
    body: JSON.stringify({
      principal_id: authorityPrincipalId,
      expires_at: 4102444800,
      global_capabilities: globalCapabilities,
    }),
  });
  if (
    typeof localProofSession.session_token !== "string" ||
    localProofSession.session_token === ""
  ) {
    throw new Error(`local proof session for ${principalId} returned no session_token`);
  }
  seedSessionTokens.set(principalId, localProofSession.session_token);
  return localProofSession.session_token;
}

async function sendCommand(apiBaseUrl, id, principalId, command) {
  const sessionToken = await seedSessionToken(apiBaseUrl, principalId);
  const commandId = randomUUID();
  const maxAttempts = 16;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const url = `${apiBaseUrl}/commands`;
    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${sessionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        v: 2,
        id,
        body: {
          kind: "Command",
          body: {
            command_id: commandId,
            command: fixturePrincipalTransport(command, "backup restore command transport"),
          },
        },
      }),
    });
    const result = await response.json();
    if (response.ok) {
      if (result.body?.kind !== "Ack") {
        throw new Error(`command rejected: ${JSON.stringify(result)}`);
      }
      return {
        principalId,
        kind: Object.keys(command)[0],
        streamSeqs: result.body.body.stream_seqs,
      };
    }
    const reject = result.body;
    const retryableConflict =
      (response.status === 409 || response.status === 503) &&
      reject?.kind === "Reject" &&
      reject.body?.retryable === true;
    if (!retryableConflict) {
      throw new Error(`HTTP ${response.status} from ${url}: ${JSON.stringify(result)}`);
    }
    if (attempt === maxAttempts) {
      throw new Error(
        `command exhausted ${maxAttempts} exact-command retries: ${JSON.stringify(result)}`,
      );
    }
    await delay(Math.min(250, 25 * attempt) + ((id * 17 + attempt * 13) % 23));
  }
  throw new Error("unreachable command retry state");
}

async function createLocalProofSession({
  apiBaseUrl,
  principalId,
  globalCapabilities = [],
}) {
  const authorityPrincipalId = fixturePrincipalAuthorityId(principalId);
  const session = await fetchJson(`${apiBaseUrl}/auth/local-proof/sessions`, {
    method: "POST",
    headers: localProofHeaders(apiBaseUrl, { "content-type": "application/json" }),
    body: JSON.stringify({
      principal_id: authorityPrincipalId,
      expires_at: 4102444800,
      global_capabilities: globalCapabilities,
    }),
  });
  return {
    sessionToken: session.session_token,
    principalId: session.principal_id,
    capabilityKinds: capabilityKinds(session),
  };
}

function localProofHeaders(apiBaseUrl, headers = {}) {
  const authority = localProofAuthByApiBase.get(apiBaseUrl);
  if (authority === undefined) {
    throw new Error(`no local-proof authority is bound to ${apiBaseUrl}`);
  }
  return authority.requestHeaders(headers);
}

async function loginRestoredAccount(apiBaseUrl, principalId) {
  const session = await fetchJson(`${apiBaseUrl}/auth/accounts/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      account_id: `backup-restore-${principalId}@local.fmarch.test`,
      password: `backup restore seed password ${principalId}`,
    }),
  });
  if (typeof session.session_token !== "string" || session.session_token === "") {
    throw new Error(`restored account login for ${principalId} returned no session_token`);
  }
  return session.session_token;
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

async function runProcess(command, args) {
  const result = await runProcessResult(command, args);
  if (result.code !== 0) {
    throw new Error(`${command} failed with exit ${result.code}:\n${result.output}`);
  }
  return result.output;
}

async function runProcessResult(command, args) {
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
  return { code, output };
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

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sanitizeDatabaseName(name) {
  const sanitized = name.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase();
  const prefix = sanitized === "" ? "fmarch" : sanitized;
  return prefix.slice(0, 20);
}
