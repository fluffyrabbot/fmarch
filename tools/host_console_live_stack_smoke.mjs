import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  handleLocalhostBindFailure,
  preflightLocalhostBindOrExit,
} from "./frontend_smoke_bind_preflight.mjs";
import {
  assertLiveStackReadiness,
  buildLiveStackReadiness,
} from "./live_stack_readiness_contract.mjs";
import {
  buildLiveStackProofSummary,
  markdownLiveStackProofSummary,
} from "./live_stack_proof_summary.mjs";
import {
  buildSetupCommandEvidence,
  waitForHostSetupCommand,
} from "./dev_test_game_setup_bootstrap_scenario.mjs";
import { generatedThreadMediaPng } from "../frontend/src/lib/server/thread-media-png.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontendRoot = path.join(repoRoot, "frontend");
const artifactDir = path.join(repoRoot, "target", "host-console-live-stack-smoke");
const configuredMediaRoot = process.env.FMARCH_MEDIA_ROOT;
if (configuredMediaRoot !== undefined && configuredMediaRoot.trim() === "") {
  throw new Error("FMARCH_MEDIA_ROOT must not be empty");
}
const mediaRoot =
  configuredMediaRoot === undefined
    ? path.join(artifactDir, "media-store")
    : path.resolve(repoRoot, configuredMediaRoot);
const evidencePath = path.join(artifactDir, "live-stack-proof.json");
const summaryPath = path.join(artifactDir, "live-stack-summary.json");
const summaryMarkdownPath = path.join(artifactDir, "live-stack-summary.md");
const databaseUrl = process.env.DATABASE_URL;
const host = "127.0.0.1";
const smokeViewport = Object.freeze({ width: 1024, height: 768 });
const game = crypto.randomUUID();
const actionGame = crypto.randomUUID();
const additionalRoomsGame = crypto.randomUUID();
const adminCreatedGame = crypto.randomUUID();
const rootAdminSessionToken = `host-console-live-stack-root-admin-${crypto.randomUUID()}`;
const hostSessionToken = `host-console-live-stack-host-${crypto.randomUUID()}`;
const playerSessionToken = `host-console-live-stack-player-${crypto.randomUUID()}`;
const actionPlayerSessionToken = `host-console-live-stack-action-player-${crypto.randomUUID()}`;
const racePlayerSessionToken = `host-console-live-stack-race-player-${crypto.randomUUID()}`;
const adminSessionToken = `host-console-live-stack-admin-${crypto.randomUUID()}`;
const cohostSessionToken = `host-console-live-stack-cohost-${crypto.randomUUID()}`;
const grantedGlobalModToken = `session-grant-${adminCreatedGame}`;
const factionDayChatChannel = "private:mafia_day_chat";
const factionDayChatRoute = encodeURIComponent(factionDayChatChannel);
const factionDayChatPostBody = "Faction day chat received from live-stack smoke";
const factionDayChatMediaAlt = "Private faction day chat vote receipt";
const rolePmChannel = "private:role_pm:slot-7";
const rolePmRoute = encodeURIComponent(rolePmChannel);
const rolePmHistoryBody = "Role PM history before replacement";
const rolePmIncomingBody = "Incoming replacement continued the durable Role PM";
const rolePmMediaAlt = "Transferred private Role PM receipt";
const additionalRoomDefinitions = Object.freeze([
  Object.freeze({
    id: "mason",
    kind: "Mason",
    channelId: "private:mason",
    route: encodeURIComponent("private:mason"),
    revealsAlignment: "Town",
    outgoing: Object.freeze({
      slotId: "mason-1",
      principalUserId: "rooms-mason-outgoing",
      sessionToken: `host-console-live-stack-mason-outgoing-${crypto.randomUUID()}`,
    }),
    peer: Object.freeze({
      slotId: "mason-2",
      principalUserId: "rooms-mason-peer",
    }),
    incoming: Object.freeze({
      principalUserId: "rooms-mason-incoming",
      sessionToken: `host-console-live-stack-mason-incoming-${crypto.randomUUID()}`,
    }),
    historyBody: "Mason room history before replacement",
    incomingBody: "Incoming Mason continued the private room",
    mediaAlt: "Mason private room receipt",
  }),
  Object.freeze({
    id: "neighbor",
    kind: "Neighbor",
    channelId: "private:neighbor",
    route: encodeURIComponent("private:neighbor"),
    revealsAlignment: "None",
    outgoing: Object.freeze({
      slotId: "neighbor-1",
      principalUserId: "rooms-neighbor-outgoing",
      sessionToken: `host-console-live-stack-neighbor-outgoing-${crypto.randomUUID()}`,
    }),
    peer: Object.freeze({
      slotId: "neighbor-2",
      principalUserId: "rooms-neighbor-peer",
    }),
    incoming: Object.freeze({
      principalUserId: "rooms-neighbor-incoming",
      sessionToken: `host-console-live-stack-neighbor-incoming-${crypto.randomUUID()}`,
    }),
    historyBody: "Neighbor room history before replacement",
    incomingBody: "Incoming Neighbor continued the private room",
    mediaAlt: "Neighbor private room receipt",
  }),
]);
const additionalRoomOutsider = Object.freeze({
  slotId: "rooms-outsider-1",
  principalUserId: "rooms-outsider",
  sessionToken: `host-console-live-stack-rooms-outsider-${crypto.randomUUID()}`,
});
const factionDayChatUploadAsset = Object.freeze({
  contentAddress: "live-stack-private-upload-source",
  variantName: "source",
  width: 400,
  height: 300,
  palette: Object.freeze({
    background: Object.freeze([250, 250, 247]),
    accent: Object.freeze([93, 72, 59]),
    secondary: Object.freeze([231, 226, 217]),
    stripe: Object.freeze([133, 105, 83]),
  }),
});
await preflightLocalhostBindOrExit({
  host,
  repoRoot,
  artifactDir,
  evidencePath,
  smokeName: "host-console-live-stack-smoke",
});
const apiPort = await freePort();
const apiBaseUrl = `http://${host}:${apiPort}`;
const frontendRequire = createRequire(path.join(frontendRoot, "package.json"));

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required, e.g. postgres://fmarch:fmarch@localhost:5544/fmarch",
  );
}

let commandEnvelopeId = 1;
let server;
let vite;
let browser;
let smokeDatabase;
let serverOutput = "";
let primaryError = null;
const previousSmokeAuth = process.env.FMARCH_HOST_CONSOLE_SMOKE_AUTH;
const previousApiBaseUrl = process.env.FMARCH_API_BASE_URL;
process.env.FMARCH_HOST_CONSOLE_SMOKE_AUTH = "1";
process.env.FMARCH_API_BASE_URL = apiBaseUrl;
process.chdir(frontendRoot);

try {
  await mkdir(artifactDir, { recursive: true });
  await mkdir(mediaRoot, { recursive: true, mode: 0o700 });
  await writeProgress({ stage: "create-temp-database" });
  smokeDatabase = await createSmokeDatabase(databaseUrl);

  await writeProgress({ stage: "start-rust-server", apiPort });
  server = spawn("cargo", ["run", "-p", "server"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      DATABASE_URL: smokeDatabase.url,
      FMARCH_BIND: `${host}:${apiPort}`,
      FMARCH_MEDIA_ROOT: mediaRoot,
      RUST_LOG: process.env.RUST_LOG ?? "warn",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
  server.stderr.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });

  await writeProgress({ stage: "wait-for-rust-health" });
  await waitForHealth();
  await writeProgress({ stage: "seed-game", game });
  const seedCommands = await seedGame();
  await writeProgress({ stage: "seed-action-game", actionGame });
  const actionSeedCommands = await seedActionGame();
  await writeProgress({ stage: "seed-additional-rooms-game", additionalRoomsGame });
  const additionalRoomsSeed = await seedAdditionalRoomsGame();
  await writeProgress({ stage: "seed-faction-day-chat-fixture", game });
  const privateChannelFixture = await seedFactionDayChatFixture();
  await writeProgress({ stage: "seed-root-admin-session" });
  const rootAdminSession = await seedRootAdminSession();
  await writeProgress({ stage: "create-granted-sessions", game });
  const grantedSessions = await createGrantedSessions();
  await writeProgress({ stage: "create-additional-room-sessions", additionalRoomsGame });
  const additionalRoomSessions = await createAdditionalRoomSessions();

  await writeProgress({ stage: "start-sveltekit" });
  const { createServer: createViteServer } = await import(
    frontendRequire.resolve("vite")
  );
  vite = await createViteServer({
    root: frontendRoot,
    server: {
      host,
      port: 0,
      strictPort: false,
      proxy: {
        "/commands": apiBaseUrl,
        "/games": apiBaseUrl,
        "/ws": {
          target: apiBaseUrl,
          ws: true,
        },
      },
    },
    logLevel: "error",
  });
  await vite.listen();
  const frontendAddress = vite.httpServer?.address();
  if (frontendAddress === null || typeof frontendAddress !== "object") {
    throw new Error("SvelteKit smoke server did not expose a TCP address");
  }
  const frontendBaseUrl = `http://${host}:${frontendAddress.port}`;

  await writeProgress({ stage: "drive-browser", frontendBaseUrl, apiBaseUrl });
  const browserEvidence = await driveBrowser(
    frontendBaseUrl,
    privateChannelFixture,
    additionalRoomsSeed,
  );
  const playerVoteCount =
    browserEvidence.playerVoteCountAfterPlayer ??
    (await fetchJson(`${apiBaseUrl}/games/${game}/votecount`));
  assertPlayerVoteProjection(playerVoteCount);
  const apiState =
    browserEvidence.moderator?.apiStateBeforePrompt ??
    (await fetchJson(
      `${apiBaseUrl}/games/${game}/host-console-state?principal_user_id=host_h&slot_id=slot-7`,
    ));
  assertApiProjection(apiState);
  const slotLifecycleApiState =
    browserEvidence.moderator?.slotLifecycle?.apiStateAfter ??
    (await fetchJson(
      `${apiBaseUrl}/games/${game}/host-console-state?principal_user_id=host_h&slot_id=slot-7`,
    ));
  assertSlotLifecycleApiProjection(slotLifecycleApiState);

  const evidence = {
    status: "passed",
    generatedAt: new Date().toISOString(),
    game,
    database: {
      name: smokeDatabase.name,
      lifecycle: "created-and-dropped-per-smoke-run",
    },
    apiBaseUrl,
    frontendBaseUrl,
    viewport: smokeViewport,
    seedCommands,
    actionSeedCommands,
    additionalRoomsSeed,
    privateChannelFixture,
    rootAdminSession,
    grantedSessions,
    additionalRoomSessions,
    browser: browserEvidence,
    playerVoteCount,
    apiState,
    slotLifecycleApiState,
  };
  const readiness = buildLiveStackReadiness(evidence);
  assertLiveStackReadiness(readiness);
  evidence.readiness = readiness;
  const summary = buildLiveStackProofSummary(evidence);
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(summaryMarkdownPath, markdownLiveStackProofSummary(summary));
  await writeProgress({ stage: "complete", evidencePath, summaryPath });
  console.log(`wrote ${path.relative(repoRoot, evidencePath)}`);
} catch (error) {
  primaryError = error;
  const handled = await handleLocalhostBindFailure({
    error,
    repoRoot,
    artifactDir,
    evidencePath,
    smokeName: "host-console-live-stack-smoke",
    stage: "live-stack-listen",
  });
  if (!handled) {
    error.serverOutput = serverOutput.slice(-4000);
    throw error;
  }
} finally {
  if (browser !== undefined) {
    await browser.close();
  }
  if (vite !== undefined) {
    await vite.close();
  }
  if (smokeDatabase !== undefined) {
    await writeProgress({ stage: "drop-temp-database", database: smokeDatabase.name });
    try {
      await dropSmokeDatabase(smokeDatabase);
    } catch (dropError) {
      if (primaryError === null) {
        throw dropError;
      }
      console.warn(
        `warning: failed to drop smoke database after primary failure: ${
          dropError?.message ?? dropError
        }`,
      );
    }
  }
  if (server !== undefined) {
    await stopChild(server, "rust server");
  }
  if (previousSmokeAuth === undefined) {
    delete process.env.FMARCH_HOST_CONSOLE_SMOKE_AUTH;
  } else {
    process.env.FMARCH_HOST_CONSOLE_SMOKE_AUTH = previousSmokeAuth;
  }
  if (previousApiBaseUrl === undefined) {
    delete process.env.FMARCH_API_BASE_URL;
  } else {
    process.env.FMARCH_API_BASE_URL = previousApiBaseUrl;
  }
}

async function createSmokeDatabase(sourceDatabaseUrl) {
  const source = new URL(sourceDatabaseUrl);
  const admin = new URL(sourceDatabaseUrl);
  admin.pathname = "/postgres";
  const smoke = new URL(sourceDatabaseUrl);
  const sourceName = source.pathname.replace(/^\/+/, "") || "fmarch";
  const name = `${sanitizeDatabaseName(sourceName)}_live_stack_${process.pid}_${Date.now()}`;
  smoke.pathname = `/${name}`;

  await runProcess("psql", [
    admin.toString(),
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    `CREATE DATABASE "${name}"`,
  ]);

  return { name, adminUrl: admin.toString(), url: smoke.toString() };
}

async function dropSmokeDatabase({ adminUrl, name }) {
  await runProcess("psql", [
    adminUrl,
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}'`,
  ]);
  await runProcess("psql", [
    adminUrl,
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    `DROP DATABASE IF EXISTS "${name}"`,
  ]);
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

async function runSql(url, sql) {
  return await runProcess("psql", [
    url,
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    sql,
  ]);
}

async function runSqlScalar(url, sql) {
  return (
    await runProcess("psql", [
      url,
      "-v",
      "ON_ERROR_STOP=1",
      "-Atc",
      sql,
    ])
  ).trim();
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function stopChild(child, label) {
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

function sanitizeDatabaseName(name) {
  const sanitized = name.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase();
  const prefix = sanitized === "" ? "fmarch" : sanitized;
  return prefix.slice(0, 24);
}

async function seedGame() {
  const commands = [];
  for (const [principal, command] of [
    ["host_h", { CreateGame: { game, pack: "mafiascum" } }],
    ["host_h", { AddSlot: { game, slot: "slot-7" } }],
    ["host_h", { AddSlot: { game, slot: "slot-2" } }],
    ["host_h", { AddSlot: { game, slot: "slot-3" } }],
    ["host_h", { AddSlot: { game, slot: "slot_1" } }],
    ["host_h", { AddSlot: { game, slot: "slot_4" } }],
    ["host_h", { AddSlot: { game, slot: "slot_5" } }],
    ["host_h", { AddSlot: { game, slot: "slot_6" } }],
    [
      "host_h",
      { AssignSlot: { game, slot: "slot-7", user: "player-mira" } },
    ],
    [
      "host_h",
      {
        AssignRole: {
          game,
          slot: "slot-7",
          role_key: "encryptor",
        },
      },
    ],
    [
      "host_h",
      {
        AssignSlot: {
          game,
          slot: "slot-2",
          user: "player-target",
        },
      },
    ],
    [
      "host_h",
      {
        AssignRole: {
          game,
          slot: "slot-2",
          role_key: "vanilla_townie",
        },
      },
    ],
    [
      "host_h",
      {
        AssignSlot: {
          game,
          slot: "slot-3",
          user: "player-seed",
        },
      },
    ],
    [
      "host_h",
      {
        AssignRole: {
          game,
          slot: "slot-3",
          role_key: "vanilla_townie",
        },
      },
    ],
    [
      "host_h",
      {
        AssignSlot: {
          game,
          slot: "slot_1",
          user: "player-beloved",
        },
      },
    ],
    [
      "host_h",
      {
        AssignRole: {
          game,
          slot: "slot_1",
          role_key: "beloved_princess",
        },
      },
    ],
    [
      "host_h",
      {
        AssignSlot: {
          game,
          slot: "slot_4",
          user: "player-goon-a",
        },
      },
    ],
    [
      "host_h",
      {
        AssignRole: {
          game,
          slot: "slot_4",
          role_key: "mafia_goon",
        },
      },
    ],
    [
      "host_h",
      {
        AssignSlot: {
          game,
          slot: "slot_5",
          user: "player-goon-b",
        },
      },
    ],
    [
      "host_h",
      {
        AssignRole: {
          game,
          slot: "slot_5",
          role_key: "vanilla_townie",
        },
      },
    ],
    [
      "host_h",
      {
        AssignSlot: {
          game,
          slot: "slot_6",
          user: "player-town-extra",
        },
      },
    ],
    [
      "host_h",
      {
        AssignRole: {
          game,
          slot: "slot_6",
          role_key: "vanilla_townie",
        },
      },
    ],
    ["host_h", { StartGame: { game, phase: "D01" } }],
    [
      "player-seed",
      {
        SubmitVote: {
          game,
          actor_slot: "slot-3",
          target: { Slot: "slot_1" },
        },
      },
    ],
    [
      "player-mira",
      {
        SubmitPost: {
          game,
          channel_id: "main",
          actor_slot: "slot-7",
          body: "Slot 7 history before replacement",
        },
      },
    ],
  ]) {
    commands.push(await sendCommand(principal, command));
  }
  return commands;
}

async function seedActionGame() {
  const commands = [];
  for (const [principal, command] of [
    ["host_h", { CreateGame: { game: actionGame, pack: "mafiascum" } }],
    ["host_h", { AddSlot: { game: actionGame, slot: "slot_4" } }],
    ["host_h", { AddSlot: { game: actionGame, slot: "slot-2" } }],
    ["host_h", { AddSlot: { game: actionGame, slot: "slot-3" } }],
    [
      "host_h",
      { AssignSlot: { game: actionGame, slot: "slot_4", user: "action-goon" } },
    ],
    [
      "host_h",
      {
        AssignRole: {
          game: actionGame,
          slot: "slot_4",
          role_key: "mafia_goon",
        },
      },
    ],
    [
      "host_h",
      {
        AssignSlot: {
          game: actionGame,
          slot: "slot-2",
          user: "action-target",
        },
      },
    ],
    [
      "host_h",
      {
        AssignRole: {
          game: actionGame,
          slot: "slot-2",
          role_key: "vanilla_townie",
        },
      },
    ],
    [
      "host_h",
      {
        AssignSlot: {
          game: actionGame,
          slot: "slot-3",
          user: "action-town",
        },
      },
    ],
    [
      "host_h",
      {
        AssignRole: {
          game: actionGame,
          slot: "slot-3",
          role_key: "vanilla_townie",
        },
      },
    ],
    ["host_h", { StartGame: { game: actionGame, phase: "N01" } }],
  ]) {
    commands.push(await sendCommand(principal, command));
  }
  return commands;
}

async function seedAdditionalRoomsGame() {
  const commands = [];
  commands.push(
    await sendCommand("host_h", {
      CreateGame: { game: additionalRoomsGame, pack: "mafiascum" },
    }),
  );
  const occupants = [
    ...additionalRoomDefinitions.flatMap((room) => [
      {
        slotId: room.outgoing.slotId,
        principalUserId: room.outgoing.principalUserId,
        roleKey: room.id,
      },
      {
        slotId: room.peer.slotId,
        principalUserId: room.peer.principalUserId,
        roleKey: room.id,
      },
    ]),
    {
      slotId: additionalRoomOutsider.slotId,
      principalUserId: additionalRoomOutsider.principalUserId,
      roleKey: "vanilla_townie",
    },
  ];
  for (const occupant of occupants) {
    commands.push(
      await sendCommand("host_h", {
        AddSlot: { game: additionalRoomsGame, slot: occupant.slotId },
      }),
      await sendCommand("host_h", {
        AssignSlot: {
          game: additionalRoomsGame,
          slot: occupant.slotId,
          user: occupant.principalUserId,
        },
      }),
      await sendCommand("host_h", {
        AssignRole: {
          game: additionalRoomsGame,
          slot: occupant.slotId,
          role_key: occupant.roleKey,
        },
      }),
    );
  }
  commands.push(
    await sendCommand("host_h", {
      StartGame: { game: additionalRoomsGame, phase: "D01" },
    }),
  );

  const memberRows = await runSql(
    smokeDatabase.url,
    `SELECT channel_id, kind, slot_id, role_key, reveals_alignment, source
     FROM private_channel_member
     WHERE game_id = '${additionalRoomsGame}'
       AND channel_id IN ('private:mason', 'private:neighbor')
     ORDER BY channel_id, slot_id`,
  );
  for (const room of additionalRoomDefinitions) {
    for (const member of [room.outgoing, room.peer]) {
      if (!memberRows.includes(room.channelId) || !memberRows.includes(member.slotId)) {
        throw new Error(
          `${room.kind} membership was not pack-declared for ${member.slotId}:\n${memberRows}`,
        );
      }
    }
    if (
      !memberRows.includes(room.kind) ||
      !memberRows.includes(room.revealsAlignment) ||
      !memberRows.includes(`pack.private_channels.${room.id}`)
    ) {
      throw new Error(`${room.kind} declaration metadata drifted:\n${memberRows}`);
    }
  }

  return {
    game: additionalRoomsGame,
    commands,
    rooms: additionalRoomDefinitions.map((room) => ({
      id: room.id,
      kind: room.kind,
      channelId: room.channelId,
      revealsAlignment: room.revealsAlignment,
      declaredMemberSlots: [room.outgoing.slotId, room.peer.slotId],
      outgoingPrincipalUserId: room.outgoing.principalUserId,
      incomingPrincipalUserId: room.incoming.principalUserId,
    })),
    outsider: {
      slotId: additionalRoomOutsider.slotId,
      principalUserId: additionalRoomOutsider.principalUserId,
    },
    boundary:
      "The mafiascum pack declared occupied Mason and Neighbor role groups through StartGame; no test-only private_channel_member rows were inserted.",
  };
}

async function seedFactionDayChatFixture() {
  const memberRows = await runSql(
    smokeDatabase.url,
    `SELECT channel_id, kind, slot_id, role_key, source
     FROM private_channel_member
     WHERE game_id = '${game}' AND channel_id = '${factionDayChatChannel}'
     ORDER BY slot_id`,
  );
  if (
    !memberRows.includes("slot-7") ||
    !memberRows.includes("encryptor") ||
    !memberRows.includes("slot_4") ||
    !memberRows.includes("mafia_goon")
  ) {
    throw new Error(`faction day chat membership was not command-declared:\n${memberRows}`);
  }
  return {
    channelId: factionDayChatChannel,
    roomType: "FactionDayChat",
    memberSlot: "slot-7",
    memberPrincipalUserId: "player-mira",
    commandDeclaredMembers: ["slot-7", "slot_4"],
    boundary:
      "membership is declared by mafiascum StartGame commands before the browser uploads or references media",
  };
}

async function seedRootAdminSession() {
  await runSql(smokeDatabase.url, `
    INSERT INTO auth_session (
      token_hash,
      principal_user_id,
      created_at,
      expires_at,
      revoked_at,
      global_capabilities
    )
    VALUES (
      ${sqlLiteral(hashSessionToken(rootAdminSessionToken))},
      'root_admin',
      0,
      4102444800,
      NULL,
      ARRAY['GlobalAdmin']::TEXT[]
    )
    ON CONFLICT (token_hash) DO UPDATE SET
      principal_user_id = EXCLUDED.principal_user_id,
      expires_at = EXCLUDED.expires_at,
      revoked_at = NULL,
      global_capabilities = EXCLUDED.global_capabilities;
  `);
  const session = await fetchJson(`${apiBaseUrl}/auth/session`, {
    headers: {
      authorization: `Bearer ${rootAdminSessionToken}`,
    },
  });
  const capabilityKinds = (session.capabilities ?? []).map(
    (capability) => capability.kind,
  );
  if (!capabilityKinds.includes("GlobalAdmin")) {
    throw new Error(
      `root admin seed did not resolve GlobalAdmin: ${JSON.stringify(session)}`,
    );
  }
  return {
    principalUserId: session.principal_user_id,
    capabilityKinds,
    boundary:
      "root GlobalAdmin is seeded directly into the scratch auth_session table so the live browser proof can keep /auth/dev-session disabled and mint all browser tokens through /auth/session-grants",
  };
}

async function createGrantedSessions() {
  return {
    admin: await createGrantedSession({
      token: adminSessionToken,
      principalUserId: "admin_a",
      globalCapabilities: ["GlobalAdmin"],
    }),
    host: await createGrantedSession({
      token: hostSessionToken,
      principalUserId: "host_h",
    }),
    player: await createAccountSession({
      token: playerSessionToken,
      principalUserId: "player-mira",
      label: "player-mira",
    }),
    actionPlayer: await createGrantedSession({
      token: actionPlayerSessionToken,
      principalUserId: "action-goon",
    }),
    racePlayer: await createGrantedSession({
      token: racePlayerSessionToken,
      principalUserId: "player-goon-a",
    }),
    cohost: await createGrantedSession({
      token: cohostSessionToken,
      principalUserId: "cohost_c",
    }),
  };
}

async function createAdditionalRoomSessions() {
  const rooms = {};
  for (const room of additionalRoomDefinitions) {
    rooms[room.id] = {
      outgoing: await createAccountSession({
        token: room.outgoing.sessionToken,
        principalUserId: room.outgoing.principalUserId,
        label: `${room.id}-outgoing`,
      }),
      incoming: await createAccountSession({
        token: room.incoming.sessionToken,
        principalUserId: room.incoming.principalUserId,
        label: `${room.id}-incoming`,
      }),
    };
  }
  return {
    rooms,
    outsider: await createAccountSession({
      token: additionalRoomOutsider.sessionToken,
      principalUserId: additionalRoomOutsider.principalUserId,
      label: "additional-rooms-outsider",
    }),
    boundary:
      "Every browser actor uses an enabled local account login and opaque session; the replacement changes game-scoped room authority without revoking the account globally.",
  };
}

async function createAccountSession({ token, principalUserId, label }) {
  const accountId = `live-stack-${label}-${crypto.randomUUID()}@example.test`;
  const password = `live-stack account password ${crypto.randomUUID()}`;
  await createAuthAccount({ accountId, password, principalUserId });
  const session = await fetchJson(`${apiBaseUrl}/auth/accounts/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      account_id: accountId,
      password,
      session_token: token,
      expires_at: 4102444800,
    }),
  });
  return {
    accountId,
    principalUserId: session.principal_user_id,
    capabilityKinds: (session.capabilities ?? []).map((capability) => capability.kind),
    authentication: "enabled-account-login",
  };
}

async function createAuthAccount({ accountId, password, principalUserId }) {
  await fetchJson(`${apiBaseUrl}/auth/accounts`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${rootAdminSessionToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      account_id: accountId,
      password,
      principal_user_id: principalUserId,
    }),
  });
}

async function createGrantedSession({ token, principalUserId, globalCapabilities = [] }) {
  const session = await fetchJson(`${apiBaseUrl}/auth/session-grants`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${rootAdminSessionToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      token,
      principal_user_id: principalUserId,
      expires_at: 4102444800,
      global_capabilities: globalCapabilities,
    }),
  });
  const capabilityKinds = (session.capabilities ?? []).map(
    (capability) => capability.kind,
  );
  return {
    principalUserId: session.principal_user_id,
    capabilityKinds,
  };
}

function hashSessionToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

async function driveBrowser(
  frontendBaseUrl,
  privateChannelFixture,
  additionalRoomsSeed,
) {
  browser = await chromium.launch();
  const adminEvidence = await driveAdminBrowser(frontendBaseUrl);
  const moderatorSession = await openModeratorBrowser(frontendBaseUrl);
  let playerEvidence;
  let moderatorEvidence;
  try {
    await waitForHostLiveVotecount(moderatorSession.page, 1);
    const hostVotecountBeforePlayer = await hostVotecountBrowserSnapshot(
      moderatorSession.page,
    );
    playerEvidence = await drivePlayerBrowser(frontendBaseUrl);
    const playerActionEvidence = await drivePlayerActionBrowser(frontendBaseUrl);
    const playerPrivateChannelEvidence =
      await drivePlayerPrivateChannelBrowser(frontendBaseUrl, privateChannelFixture);
    const additionalRooms = await driveAdditionalRoomsBrowser(
      frontendBaseUrl,
      additionalRoomsSeed,
    );
    const rolePmHistory = await seedRolePmHistory(
      playerPrivateChannelEvidence.media.contentId,
    );
    const privateChannelForbiddenEvidence =
      await drivePrivateChannelForbiddenBrowser(
        frontendBaseUrl,
        playerPrivateChannelEvidence.media.privateUrl,
      );
    const hostVotecountConvergence = await proveHostVotecountConvergesAfterPlayerLoop(
      moderatorSession.page,
      { before: hostVotecountBeforePlayer },
    );
    const playerVoteCountAfterPlayer = hostVotecountConvergence.apiVoteCount;
    moderatorEvidence = await driveModeratorBrowser(moderatorSession, {
      frontendBaseUrl,
      rolePmHistory,
    });
    return {
      admin: adminEvidence,
      player: playerEvidence,
      playerAction: playerActionEvidence,
      playerPrivateChannel: playerPrivateChannelEvidence,
      additionalRooms,
      rolePmHistory,
      privateChannelForbidden: privateChannelForbiddenEvidence,
      hostVotecountConvergence,
      moderator: moderatorEvidence,
      playerVoteCountAfterPlayer,
    };
  } finally {
    await moderatorSession.context.close();
  }
}

async function drivePlayerPrivateChannelBrowser(frontendBaseUrl, privateChannelFixture) {
  const mediaRequests = [];
  const mediaResponses = [];
  const mediaResponseTasks = [];
  const context = await browser.newContext({ viewport: smokeViewport });
  context.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith("/media/thread/")) {
      mediaRequests.push({
        url: request.url(),
        pathname,
        resourceType: request.resourceType(),
      });
    }
  });
  context.on("response", (response) => {
    const pathname = new URL(response.url()).pathname;
    if (!pathname.startsWith("/media/thread/")) {
      return;
    }
    mediaResponseTasks.push(
      response.body().then((body) => {
        const headers = response.headers();
        mediaResponses.push({
          url: response.url(),
          pathname,
          status: response.status(),
          ok: response.ok(),
          contentType: headers["content-type"] ?? null,
          cacheControl: headers["cache-control"] ?? null,
          contentAddress: headers["x-fmarch-media-content-address"] ?? null,
          channel: headers["x-fmarch-media-channel"] ?? null,
          postSeq: headers["x-fmarch-media-post-seq"] ?? null,
          reference: headers["x-fmarch-media-reference"] ?? null,
          variant: headers["x-fmarch-media-variant"] ?? null,
          format: headers["x-fmarch-media-format"] ?? null,
          etag: headers.etag ?? null,
          bodyBytes: body.byteLength,
        });
      }).catch((error) => {
        mediaResponses.push({
          url: response.url(),
          pathname,
          status: response.status(),
          ok: response.ok(),
          bodyReadError: String(error?.message ?? error),
          bodyBytes: null,
        });
      }),
    );
  });
  await context.addCookies([
    {
      name: "fmarch_session",
      value: playerSessionToken,
      domain: host,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const page = await context.newPage();
  const pageUrl = `${frontendBaseUrl}/g/${game}/c/${factionDayChatRoute}`;
  const response = await page.goto(pageUrl, { waitUntil: "networkidle" });
  if (response === null || !response.ok()) {
    throw new Error(
      `player private-channel route failed with ${response?.status() ?? "no response"}: ${await page.textContent("body")}`,
    );
  }

  await page.getByTestId("player-surface").waitFor({ state: "visible" });
  const channelContext = page.getByTestId("player-command-channel-context");
  await channelContext.waitFor({ state: "visible" });
  const channelContextText = await channelContext.innerText();
  const channelContextId = await channelContext.getAttribute("data-channel-id");
  if (channelContextId !== factionDayChatChannel) {
    throw new Error(
      `faction day chat channel context did not render: ${JSON.stringify({ channelContextId, channelContextText })}`,
    );
  }
  const activeChannel = page.getByTestId(`player-channel-${factionDayChatChannel}`);
  await activeChannel.waitFor({ state: "visible" });
  if ((await activeChannel.getAttribute("aria-current")) !== "page") {
    throw new Error("faction day chat channel rail item is not active");
  }
  if (privateChannelFixture.memberPrincipalUserId !== "player-mira") {
    throw new Error(`private media fixture member drifted: ${JSON.stringify(privateChannelFixture)}`);
  }
  const upload = generatedThreadMediaPng(factionDayChatUploadAsset);
  await page.getByTestId("player-media-file").setInputFiles({
    name: "private-faction-receipt.png",
    mimeType: "image/png",
    buffer: upload.bytes,
  });
  await page.getByTestId("player-media-alt").fill(factionDayChatMediaAlt);
  const textarea = page.locator('[data-testid="player-composer"] textarea');
  await textarea.fill(factionDayChatPostBody);
  const postButton = page.locator('[data-action="submit_post"]');
  assertHitTarget(await postButton.boundingBox(), "faction day chat post button");
  await postButton.click();
  const status = page.getByTestId("player-command-status");
  await status.waitFor({ state: "visible" });
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="player-command-status"]')
        ?.getAttribute("data-state") === "ack",
    null,
    { timeout: 180_000 },
  );
  await page.waitForFunction((expectedBody) =>
    window.__fmarchPlayerProjection?.thread?.posts?.some(
      (post) => post.body === expectedBody,
    ),
    factionDayChatPostBody,
    { timeout: 60_000 },
  );
  const submitPostOutcome = await page.evaluate(
    () => window.__fmarchPlayerCommandStatus,
  );
  const commandStatus = await status.innerText();
  const { contentId, attachment } = assertFactionDayChatSubmitPostOutcome(
    submitPostOutcome,
  );
  const privateThreadPage = await fetchJson(
    `${apiBaseUrl}/games/${game}/channels/${factionDayChatRoute}/thread?principal_user_id=player-mira&limit=50`,
  );
  const mediaPost = privateThreadPage.posts?.find(
    (post) => post.body === factionDayChatPostBody,
  );
  if (mediaPost === undefined) {
    throw new Error(`faction day chat API thread missing submitted post: ${JSON.stringify(privateThreadPage)}`);
  }
  const mediaPostSeq = Number(mediaPost.source_seq ?? mediaPost.sourceSeq);
  if (!Number.isFinite(mediaPostSeq) || mediaPostSeq <= 0) {
    throw new Error(`uploaded media post missing source sequence: ${JSON.stringify(mediaPost)}`);
  }
  const projectedMedia = mediaPost.media?.find(
    (item) => item.content_id === contentId,
  );
  assertManifestBackedPrivateMedia({
    projectedMedia,
    contentId,
    mediaPostSeq,
  });

  const reloadResponse = await page.reload({
    waitUntil: "networkidle",
    timeout: 180_000,
  });
  if (reloadResponse === null || !reloadResponse.ok()) {
    throw new Error(
      `private media reload failed with ${reloadResponse?.status() ?? "no response"}`,
    );
  }
  await page.getByTestId("player-surface").waitFor({ state: "visible" });
  const reloadedPost = page.locator(`[data-testid="thread-post-${mediaPostSeq}"]`);
  await reloadedPost.waitFor({ state: "visible" });
  const reloadedPostText = await reloadedPost.innerText();
  if (!reloadedPostText.includes(factionDayChatPostBody)) {
    throw new Error(`uploaded private post did not recover after reload: ${reloadedPostText}`);
  }
  const mediaBoundary = page.getByTestId(`thread-post-media-boundary-${mediaPostSeq}`);
  await mediaBoundary.waitFor({ state: "visible" });
  const mediaTestId = `thread-post-media-${contentId}`;
  const mediaFigure = page.getByTestId(mediaTestId);
  await mediaFigure.waitFor({ state: "visible" });
  assertVisibleBox(await mediaFigure.boundingBox(), "uploaded private tablet media figure");
  await page.waitForFunction(
    (testId) => {
      const img = document.querySelector(`[data-testid="${testId}"] img`);
      return img?.complete === true && img.naturalWidth > 0;
    },
    mediaTestId,
    { timeout: 120_000 },
  );
  const mediaAttributes = await page.evaluate((testId) => {
    const picture = document.querySelector(`[data-testid="${testId}"] picture`);
    const img = picture?.querySelector("img");
    return {
      src: img?.getAttribute("src") ?? null,
      sizes: img?.getAttribute("sizes") ?? null,
      naturalWidth: img?.naturalWidth ?? null,
      naturalHeight: img?.naturalHeight ?? null,
      sources: [...(picture?.querySelectorAll("source") ?? [])].map((source) => ({
        type: source.getAttribute("type"),
        srcset: source.getAttribute("srcset"),
        sizes: source.getAttribute("sizes"),
      })),
    };
  }, mediaTestId);
  const verifiedTabletResponse = await context.request.get(
    `${frontendBaseUrl}${projectedMedia.variants.tablet.avif_url}`,
    { headers: { accept: "image/avif" } },
  );
  const verifiedTabletBody = await verifiedTabletResponse.body();
  const verifiedTabletHeaders = verifiedTabletResponse.headers();
  mediaResponses.push({
    url: verifiedTabletResponse.url(),
    pathname: new URL(verifiedTabletResponse.url()).pathname,
    status: verifiedTabletResponse.status(),
    ok: verifiedTabletResponse.ok(),
    contentType: verifiedTabletHeaders["content-type"] ?? null,
    cacheControl: verifiedTabletHeaders["cache-control"] ?? null,
    contentAddress:
      verifiedTabletHeaders["x-fmarch-media-content-address"] ?? null,
    channel: verifiedTabletHeaders["x-fmarch-media-channel"] ?? null,
    postSeq: verifiedTabletHeaders["x-fmarch-media-post-seq"] ?? null,
    reference: verifiedTabletHeaders["x-fmarch-media-reference"] ?? null,
    variant: verifiedTabletHeaders["x-fmarch-media-variant"] ?? null,
    format: verifiedTabletHeaders["x-fmarch-media-format"] ?? null,
    etag: verifiedTabletHeaders.etag ?? null,
    bodyBytes: verifiedTabletBody.byteLength,
    observedBy: "authenticated-context-request",
  });
  await Promise.allSettled(mediaResponseTasks);
  assertTabletMediaEvidence({
    mediaAttributes,
    mediaRequests,
    mediaResponses,
    mediaPostSeq,
    contentId,
  });
  const mediaBoundaryStatus = await mediaBoundary.getAttribute("data-boundary-status");

  const projection = await page.evaluate(() => window.__fmarchPlayerProjection);
  const evidence = {
    url: pageUrl,
    channelContextId,
    channelContextText,
    media: {
      contentId,
      attachment,
      mediaPostSeq,
      uploadedSourceBytes: upload.bytes.byteLength,
      boundaryStatus: mediaBoundaryStatus,
      mediaTestId,
      renderedSrc: mediaAttributes.src,
      renderedSources: mediaAttributes.sources,
      renderedSizes: mediaAttributes.sizes,
      naturalWidth: mediaAttributes.naturalWidth,
      naturalHeight: mediaAttributes.naturalHeight,
      projectedVariants: projectedMedia.variants,
      privateUrl: projectedMedia.variants.tablet.avif_url,
      requests: mediaRequests,
      responses: mediaResponses,
      proof:
        "An enabled-account member uploaded PNG bytes through the player composer, submitted only the returned content id plus alt text, reloaded the private channel, and rendered real manifest-backed AVIF/WebP variant bytes with content-address/reference headers and authorization-revalidating cache policy. No client-authored URL map or original-byte route participated.",
    },
    submitPost: {
      commandStatus,
      outcome: submitPostOutcome,
      apiThreadPostBodies: privateThreadPage.posts.map((post) => post.body),
      recoveredAfterReload: true,
    },
    projection,
  };
  await context.close();
  return evidence;
}

async function driveAdditionalRoomsBrowser(frontendBaseUrl, seed) {
  if (
    seed?.game !== additionalRoomsGame ||
    seed?.rooms?.length !== additionalRoomDefinitions.length
  ) {
    throw new Error(`additional-room seed drifted: ${JSON.stringify(seed)}`);
  }
  const rooms = [];
  for (const room of additionalRoomDefinitions) {
    const declared = seed.rooms.find((candidate) => candidate.id === room.id);
    if (
      declared?.channelId !== room.channelId ||
      JSON.stringify(declared.declaredMemberSlots) !==
        JSON.stringify([room.outgoing.slotId, room.peer.slotId])
    ) {
      throw new Error(`${room.kind} declared membership drifted: ${JSON.stringify(declared)}`);
    }
    rooms.push(await driveAdditionalRoomLifecycle(frontendBaseUrl, room));
  }
  return {
    status: rooms.every((room) => room.status === "passed") ? "passed" : "failed",
    game: additionalRoomsGame,
    rooms,
    coveredKinds: rooms.map((room) => room.kind),
    remainingKinds: ["Dead", "Spectator"],
    proof:
      "Occupied pack-declared Mason and Neighbor rooms each passed enabled-account browser media posting, encrypted event storage, channel-scoped live delivery, durable reload, slot-stable replacement transfer, and zero-byte stale/non-member media denial. Dead and spectator rooms remain outside this slice.",
  };
}

async function driveAdditionalRoomLifecycle(frontendBaseUrl, room) {
  const pageUrl = `${frontendBaseUrl}/g/${additionalRoomsGame}/c/${room.route}`;
  const outgoingContext = await browserContextWithSession(
    room.outgoing.sessionToken,
  );
  const outgoingPage = await outgoingContext.newPage();
  const outgoingResponse = await outgoingPage.goto(pageUrl, {
    waitUntil: "networkidle",
  });
  if (outgoingResponse === null || !outgoingResponse.ok()) {
    throw new Error(
      `${room.kind} outgoing route failed with ${outgoingResponse?.status() ?? "none"}`,
    );
  }
  await outgoingPage.getByTestId("player-surface").waitFor({ state: "visible" });
  const channelContext = outgoingPage.getByTestId(
    "player-command-channel-context",
  );
  await channelContext.waitFor({ state: "visible" });
  if ((await channelContext.getAttribute("data-channel-id")) !== room.channelId) {
    throw new Error(`${room.kind} command context did not select ${room.channelId}`);
  }
  const activeChannel = outgoingPage.getByTestId(
    `player-channel-${room.channelId}`,
  );
  await activeChannel.waitFor({ state: "visible" });
  if (
    (await activeChannel.getAttribute("aria-current")) !== "page" ||
    !(await activeChannel.innerText()).includes(room.kind)
  ) {
    throw new Error(`${room.kind} capability-derived rail item was not active`);
  }

  const upload = generatedThreadMediaPng({
    ...factionDayChatUploadAsset,
    contentAddress: `live-stack-${room.id}-room-upload-source`,
    palette: {
      ...factionDayChatUploadAsset.palette,
      accent: room.id === "mason" ? [68, 101, 132] : [113, 86, 128],
    },
  });
  await outgoingPage.getByTestId("player-media-file").setInputFiles({
    name: `${room.id}-private-receipt.png`,
    mimeType: "image/png",
    buffer: upload.bytes,
  });
  await outgoingPage.getByTestId("player-media-alt").fill(room.mediaAlt);
  await outgoingPage
    .locator('[data-testid="player-composer"] textarea')
    .fill(room.historyBody);
  const outgoingPostButton = outgoingPage.locator('[data-action="submit_post"]');
  assertHitTarget(
    await outgoingPostButton.boundingBox(),
    `${room.kind} outgoing post button`,
  );
  await outgoingPostButton.click();
  const outgoingStatus = outgoingPage.getByTestId("player-command-status");
  await outgoingStatus.waitFor({ state: "visible" });
  await outgoingPage.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="player-command-status"]')
        ?.getAttribute("data-state") === "ack",
    null,
    { timeout: 180_000 },
  );
  await waitForPrivateThreadLiveDelta(outgoingPage, {
    channelId: room.channelId,
    body: room.historyBody,
  });
  const outgoingOutcome = await outgoingPage.evaluate(
    () => window.__fmarchPlayerCommandStatus,
  );
  const outgoingCommand =
    outgoingOutcome?.requestEnvelope?.body?.body?.command?.SubmitPost;
  if (
    outgoingOutcome?.state !== "ack" ||
    outgoingCommand?.game !== additionalRoomsGame ||
    outgoingCommand?.channel_id !== room.channelId ||
    outgoingCommand?.actor_slot !== room.outgoing.slotId ||
    outgoingCommand?.body !== room.historyBody ||
    outgoingCommand?.media?.length !== 1 ||
    outgoingCommand.media[0]?.alt !== room.mediaAlt ||
    !/^[0-9a-f]{64}$/u.test(String(outgoingCommand.media[0]?.content_id ?? ""))
  ) {
    throw new Error(`${room.kind} browser media command drifted: ${JSON.stringify(outgoingOutcome)}`);
  }
  const attachmentKeys = Object.keys(outgoingCommand.media[0]).sort();
  if (JSON.stringify(attachmentKeys) !== JSON.stringify(["alt", "content_id"])) {
    throw new Error(`${room.kind} browser command leaked non-handle media fields`);
  }
  const contentId = outgoingCommand.media[0].content_id;
  const outgoingLiveDelta = await privateThreadLiveDelta(
    outgoingPage,
    room.historyBody,
  );
  const initialThread = await fetchJson(
    `${apiBaseUrl}/games/${additionalRoomsGame}/channels/${room.route}/thread?principal_user_id=${room.outgoing.principalUserId}&limit=50`,
  );
  const historyPost = initialThread.posts?.find(
    (post) => post.body === room.historyBody,
  );
  if (historyPost === undefined) {
    throw new Error(`${room.kind} API thread did not project the browser post`);
  }
  const mediaPostSeq = Number(historyPost.source_seq ?? historyPost.sourceSeq);
  const projectedMedia = historyPost.media?.find(
    (media) => media.content_id === contentId,
  );
  assertManifestBackedPrivateMedia({
    projectedMedia,
    contentId,
    mediaPostSeq,
    gameId: additionalRoomsGame,
    channelId: room.channelId,
    expectedAlt: room.mediaAlt,
  });
  const privateMediaUrl = projectedMedia.variants.tablet.avif_url;

  const outgoingReload = await outgoingPage.reload({
    waitUntil: "networkidle",
    timeout: 180_000,
  });
  if (outgoingReload === null || !outgoingReload.ok()) {
    throw new Error(`${room.kind} outgoing reload failed`);
  }
  const reloadedHistory = outgoingPage.locator(
    `[data-testid="thread-post-${mediaPostSeq}"]`,
  );
  await reloadedHistory.waitFor({ state: "visible" });
  if (!(await reloadedHistory.innerText()).includes(room.historyBody)) {
    throw new Error(`${room.kind} outgoing reload lost private history`);
  }
  const outgoingMedia = await outgoingContext.request.get(
    `${frontendBaseUrl}${privateMediaUrl}`,
    { headers: { accept: "image/avif" } },
  );
  const outgoingMediaBytes = await outgoingMedia.body();
  if (outgoingMedia.status() !== 200 || outgoingMediaBytes.byteLength === 0) {
    throw new Error(`${room.kind} member did not receive canonical media bytes`);
  }
  await outgoingContext.close();

  const replacement = await sendCommand("host_h", {
    ProcessReplacement: {
      game: additionalRoomsGame,
      slot: room.outgoing.slotId,
      outgoing_user: room.outgoing.principalUserId,
      incoming_user: room.incoming.principalUserId,
    },
  });

  const incomingContext = await browserContextWithSession(
    room.incoming.sessionToken,
  );
  const incomingPage = await incomingContext.newPage();
  const incomingResponse = await incomingPage.goto(pageUrl, {
    waitUntil: "networkidle",
  });
  if (incomingResponse === null || !incomingResponse.ok()) {
    throw new Error(`${room.kind} incoming replacement route failed`);
  }
  await incomingPage.getByTestId("player-surface").waitFor({ state: "visible" });
  const incomingHistoricalPost = incomingPage.locator(
    `[data-testid="thread-post-${mediaPostSeq}"]`,
  );
  await incomingHistoricalPost.waitFor({ state: "visible" });
  if (!(await incomingHistoricalPost.innerText()).includes(room.historyBody)) {
    throw new Error(`${room.kind} replacement lost slot-authored history`);
  }
  await waitForPrivateThreadLiveDelta(incomingPage, {
    channelId: room.channelId,
    body: room.historyBody,
  });
  const incomingInitialLiveDelta = await privateThreadLiveDelta(
    incomingPage,
    room.historyBody,
  );
  const incomingMedia = await incomingContext.request.get(
    `${frontendBaseUrl}${privateMediaUrl}`,
    { headers: { accept: "image/avif" } },
  );
  const incomingMediaBytes = await incomingMedia.body();
  if (incomingMedia.status() !== 200 || incomingMediaBytes.byteLength === 0) {
    throw new Error(`${room.kind} replacement could not read transferred media`);
  }

  await incomingPage
    .locator('[data-testid="player-composer"] textarea')
    .fill(room.incomingBody);
  const incomingPostButton = incomingPage.locator('[data-action="submit_post"]');
  assertHitTarget(
    await incomingPostButton.boundingBox(),
    `${room.kind} incoming post button`,
  );
  await incomingPostButton.click();
  const incomingStatus = incomingPage.getByTestId("player-command-status");
  await incomingStatus.waitFor({ state: "visible" });
  await incomingPage.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="player-command-status"]')
        ?.getAttribute("data-state") === "ack",
  );
  await waitForPrivateThreadLiveDelta(incomingPage, {
    channelId: room.channelId,
    body: room.incomingBody,
  });
  const incomingOutcome = await incomingPage.evaluate(
    () => window.__fmarchPlayerCommandStatus,
  );
  const incomingCommand =
    incomingOutcome?.requestEnvelope?.body?.body?.command?.SubmitPost;
  if (
    incomingOutcome?.state !== "ack" ||
    incomingCommand?.channel_id !== room.channelId ||
    incomingCommand?.actor_slot !== room.outgoing.slotId ||
    incomingCommand?.body !== room.incomingBody
  ) {
    throw new Error(`${room.kind} incoming browser post drifted: ${JSON.stringify(incomingOutcome)}`);
  }
  const incomingCommandLiveDelta = await privateThreadLiveDelta(
    incomingPage,
    room.incomingBody,
  );
  const incomingReload = await incomingPage.reload({
    waitUntil: "networkidle",
    timeout: 180_000,
  });
  if (incomingReload === null || !incomingReload.ok()) {
    throw new Error(`${room.kind} incoming reload failed`);
  }
  await incomingPage.getByTestId("player-surface").waitFor({ state: "visible" });
  const reloadedBodies = await incomingPage
    .locator('[data-testid^="thread-post-"]')
    .allInnerTexts();
  if (
    !reloadedBodies.some((body) => body.includes(room.historyBody)) ||
    !reloadedBodies.some((body) => body.includes(room.incomingBody))
  ) {
    throw new Error(`${room.kind} incoming reload lost durable room history`);
  }
  const finalThread = await fetchJson(
    `${apiBaseUrl}/games/${additionalRoomsGame}/channels/${room.route}/thread?principal_user_id=${room.incoming.principalUserId}&limit=50`,
  );
  if (
    finalThread.posts?.length !== 2 ||
    finalThread.posts.some((post) => post.channel_id !== room.channelId)
  ) {
    throw new Error(`${room.kind} channel-scoped API history drifted: ${JSON.stringify(finalThread)}`);
  }
  await incomingContext.close();

  const encryptedStorage = await runSqlScalar(
    smokeDatabase.url,
    `SELECT concat(
       count(*)::text, '|',
       count(*) FILTER (WHERE payload ? 'body')::text, '|',
       count(*) FILTER (WHERE payload->'body_private'->>'ciphertext' IS NOT NULL)::text, '|',
       count(*) FILTER (WHERE position(${sqlLiteral(room.historyBody)} in payload::text) > 0
                         OR position(${sqlLiteral(room.incomingBody)} in payload::text) > 0)::text)
     FROM events
     WHERE stream_id = '${additionalRoomsGame}'
       AND kind = 'PostSubmitted'
       AND payload->>'channel_id' = ${sqlLiteral(room.channelId)}`,
  );
  if (encryptedStorage !== "2|0|2|0") {
    throw new Error(`${room.kind} encrypted storage proof drifted: ${encryptedStorage}`);
  }

  const staleOutgoing = await proveAdditionalRoomDenial({
    frontendBaseUrl,
    room,
    token: room.outgoing.sessionToken,
    principalUserId: room.outgoing.principalUserId,
    actorSlot: room.outgoing.slotId,
    mediaUrl: privateMediaUrl,
    expectedReject: "NotYourSlot",
    label: "stale outgoing",
  });
  const outsider = await proveAdditionalRoomDenial({
    frontendBaseUrl,
    room,
    token: additionalRoomOutsider.sessionToken,
    principalUserId: additionalRoomOutsider.principalUserId,
    actorSlot: additionalRoomOutsider.slotId,
    mediaUrl: privateMediaUrl,
    expectedReject: "NotAuthorized",
    label: "non-member",
  });

  return {
    status: "passed",
    id: room.id,
    kind: room.kind,
    channelId: room.channelId,
    revealsAlignment: room.revealsAlignment,
    pageUrl,
    declaredMemberSlots: [room.outgoing.slotId, room.peer.slotId],
    outgoing: {
      principalUserId: room.outgoing.principalUserId,
      submitOutcome: outgoingOutcome,
      commandLiveDelta: outgoingLiveDelta,
      recoveredAfterReload: true,
      uploadedSourceBytes: upload.bytes.byteLength,
      mediaStatus: outgoingMedia.status(),
      mediaBodyBytes: outgoingMediaBytes.byteLength,
    },
    replacement,
    incoming: {
      principalUserId: room.incoming.principalUserId,
      submitOutcome: incomingOutcome,
      initialLiveDelta: incomingInitialLiveDelta,
      commandLiveDelta: incomingCommandLiveDelta,
      reloadedPostBodies: finalThread.posts.map((post) => post.body),
      mediaStatus: incomingMedia.status(),
      mediaBodyBytes: incomingMediaBytes.byteLength,
    },
    encryptedStorage: {
      rawCheck: encryptedStorage,
      postCount: 2,
      plaintextBodyFields: 0,
      ciphertextEnvelopes: 2,
      plaintextOccurrences: 0,
    },
    staleOutgoing,
    outsider,
    proof:
      `${room.kind} was pack-declared for two occupied slots, rendered from ChannelMember capability, accepted canonical browser-uploaded media, delivered channel-scoped live deltas, retained encrypted slot history through replacement and reload, then denied the stale outgoing account and an occupied non-member at route, thread, media, and append boundaries.`,
  };
}

async function proveAdditionalRoomDenial({
  frontendBaseUrl,
  room,
  token,
  principalUserId,
  actorSlot,
  mediaUrl,
  expectedReject,
  label,
}) {
  const context = await browserContextWithSession(token);
  const page = await context.newPage();
  const routeResponse = await page.goto(
    `${frontendBaseUrl}/g/${additionalRoomsGame}/c/${room.route}`,
    { waitUntil: "networkidle" },
  );
  if (routeResponse === null || routeResponse.status() !== 403) {
    throw new Error(
      `${room.kind} ${label} route expected 403, got ${routeResponse?.status() ?? "none"}`,
    );
  }
  await page.getByTestId("route-error-surface").waitFor({ state: "visible" });
  const threadResponse = await fetchWithTimeout(
    `${apiBaseUrl}/games/${additionalRoomsGame}/channels/${room.route}/thread?principal_user_id=${principalUserId}&limit=50`,
    {},
    15_000,
  );
  if (threadResponse.status !== 403) {
    throw new Error(`${room.kind} ${label} received private thread rows`);
  }
  const mediaResponse = await context.request.get(`${frontendBaseUrl}${mediaUrl}`, {
    headers: { accept: "image/avif" },
  });
  const mediaBytes = await mediaResponse.body();
  if (mediaResponse.status() !== 403 || mediaBytes.byteLength !== 0) {
    throw new Error(
      `${room.kind} ${label} received media: ${mediaResponse.status()} bytes=${mediaBytes.byteLength}`,
    );
  }
  const postResponse = await context.request.post(`${frontendBaseUrl}/commands`, {
    data: {
      v: 1,
      id: commandEnvelopeId++,
      body: {
        kind: "Command",
        body: {
          command_id: crypto.randomUUID(),
          principal_user_id: principalUserId,
          command: {
            SubmitPost: {
              game: additionalRoomsGame,
              channel_id: room.channelId,
              actor_slot: actorSlot,
              body: `${label} ${room.kind} post`,
              media: [],
            },
          },
        },
      },
    },
  });
  const post = await postResponse.json();
  if (
    postResponse.status() !== 200 ||
    post.body?.kind !== "Reject" ||
    post.body?.body?.error !== expectedReject
  ) {
    throw new Error(`${room.kind} ${label} append was not denied: ${JSON.stringify(post)}`);
  }
  await context.close();
  return {
    principalUserId,
    authenticatedSessionRemainedActive: true,
    routeStatus: routeResponse.status(),
    threadStatus: threadResponse.status,
    mediaStatus: mediaResponse.status(),
    mediaBodyBytes: mediaBytes.byteLength,
    postReject: post.body.body,
  };
}

async function browserContextWithSession(token) {
  const context = await browser.newContext({ viewport: smokeViewport });
  await context.addCookies([
    {
      name: "fmarch_session",
      value: token,
      domain: host,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  return context;
}

async function waitForPrivateThreadLiveDelta(page, { channelId, body }) {
  await page.waitForFunction(
    ({ expectedChannel, expectedBody }) =>
      (window.__fmarchLiveProjectionEvents ?? []).some(
        (event) =>
          event?.delta?.kind === "ThreadPostsChanged" &&
          event.delta.body?.posts?.some(
            (post) =>
              post.channel_id === expectedChannel && post.body === expectedBody,
          ),
      ),
    { expectedChannel: channelId, expectedBody: body },
    { timeout: 60_000 },
  );
}

async function privateThreadLiveDelta(page, body) {
  return await page.evaluate(
    (expectedBody) =>
      (window.__fmarchLiveProjectionEvents ?? []).find(
        (event) =>
          event?.delta?.kind === "ThreadPostsChanged" &&
          event.delta.body?.posts?.some((post) => post.body === expectedBody),
      ),
    body,
  );
}

async function seedRolePmHistory(contentId) {
  const membership = await runSql(
    smokeDatabase.url,
    `SELECT channel_id, kind, slot_id, role_key, source
     FROM private_channel_member
     WHERE game_id = '${game}' AND channel_id = '${rolePmChannel}'`,
  );
  if (
    !membership.includes(rolePmChannel) ||
    !membership.includes("RolePm") ||
    !membership.includes("slot-7") ||
    !membership.includes("engine.role_pm")
  ) {
    throw new Error(`Role PM membership was not engine-declared:\n${membership}`);
  }

  const command = await sendCommand("player-mira", {
    SubmitPost: {
      game,
      channel_id: rolePmChannel,
      actor_slot: "slot-7",
      body: rolePmHistoryBody,
      media: [{ content_id: contentId, alt: rolePmMediaAlt }],
    },
  });
  const thread = await fetchJson(
    `${apiBaseUrl}/games/${game}/channels/${rolePmRoute}/thread?principal_user_id=player-mira&limit=50`,
  );
  const post = thread.posts?.find((candidate) => candidate.body === rolePmHistoryBody);
  if (post === undefined) {
    throw new Error(`engine-declared Role PM did not project seeded history: ${JSON.stringify(thread)}`);
  }
  const mediaPostSeq = Number(post.source_seq ?? post.sourceSeq);
  const projectedMedia = post.media?.find((item) => item.content_id === contentId);
  assertManifestBackedPrivateMedia({
    projectedMedia,
    contentId,
    mediaPostSeq,
    channelId: rolePmChannel,
    expectedAlt: rolePmMediaAlt,
  });
  return {
    channelId: rolePmChannel,
    route: rolePmRoute,
    memberSlot: "slot-7",
    outgoingPrincipalUserId: "player-mira",
    incomingPrincipalUserId: "player-rowan",
    body: rolePmHistoryBody,
    command,
    media: {
      contentId,
      mediaPostSeq,
      privateUrl: projectedMedia.variants.tablet.avif_url,
      projectedVariants: projectedMedia.variants,
    },
    boundary:
      "StartGame declared a one-slot RolePm membership, and the outgoing occupant authored encrypted slot history with a canonical media reference before replacement.",
  };
}

async function drivePrivateChannelForbiddenBrowser(frontendBaseUrl, privateMediaPath) {
  const deniedToken = `host-console-live-stack-denied-${crypto.randomUUID()}`;
  const deniedSession = await createAccountSession({
    token: deniedToken,
    principalUserId: "player-target",
    label: "private-media-nonmember",
  });
  const context = await browser.newContext({ viewport: smokeViewport });
  await context.addCookies([
    {
      name: "fmarch_session",
      value: deniedToken,
      domain: host,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const page = await context.newPage();
  const pageUrl = `${frontendBaseUrl}/g/${game}/c/${factionDayChatRoute}`;
  const response = await page.goto(pageUrl, { waitUntil: "networkidle" });
  if (response === null || response.status() !== 403) {
    throw new Error(
      `private channel forbidden route expected 403, got ${response?.status() ?? "no response"}: ${await page.textContent("body")}`,
    );
  }
  await page.getByTestId("route-error-surface").waitFor({ state: "visible" });
  const errorStatus = await page
    .getByTestId("route-error-surface")
    .getAttribute("data-status");
  const action = page.getByTestId("route-error-action");
  const actionLabel = await action.innerText();
  const actionHref = await action.getAttribute("href");
  if (errorStatus !== "403" || actionLabel !== "Back to board" || actionHref !== "/") {
    throw new Error(
      `private channel 403 recovery drifted: ${JSON.stringify({ errorStatus, actionLabel, actionHref })}`,
    );
  }
  const deniedMediaUrl = `${frontendBaseUrl}${privateMediaPath}`;
  const deniedMediaResponse = await context.request.get(deniedMediaUrl, {
    headers: { accept: "image/avif" },
  });
  if (deniedMediaResponse.status() !== 403) {
    throw new Error(
      `private channel media expected 403 for non-member, got ${deniedMediaResponse.status()}: ${await deniedMediaResponse.text()}`,
    );
  }
  const deniedMediaBytes = await deniedMediaResponse.body();
  if (deniedMediaBytes.byteLength !== 0) {
    throw new Error(
      `private channel media leaked ${deniedMediaBytes.byteLength} bytes to a non-member`,
    );
  }
  assertHitTarget(await action.boundingBox(), "private-channel 403 Back to board");
  await Promise.all([
    page.waitForURL(`${frontendBaseUrl}/`, { waitUntil: "networkidle" }),
    action.click(),
  ]);
  await page.getByTestId("board-surface").waitFor({ state: "visible" });
  const recoveredUrl = page.url();
  await context.close();
  return {
    url: pageUrl,
    status: Number(errorStatus),
    actionLabel,
    actionHref,
    recoveredUrl,
    deniedSession,
    media: {
      url: deniedMediaUrl,
      status: deniedMediaResponse.status(),
      bodyBytes: deniedMediaBytes.byteLength,
      proof:
        "An enabled-account non-member received 403 with a zero-byte body for the exact manifest-backed private media URL recovered by the member after reload.",
    },
  };
}

async function driveRolePmReplacementBrowser(frontendBaseUrl, fixture) {
  if (fixture?.channelId !== rolePmChannel || fixture?.memberSlot !== "slot-7") {
    throw new Error(`Role PM replacement fixture drifted: ${JSON.stringify(fixture)}`);
  }
  const incomingToken = `host-console-live-stack-role-pm-incoming-${crypto.randomUUID()}`;
  const incomingSession = await createAccountSession({
    token: incomingToken,
    principalUserId: fixture.incomingPrincipalUserId,
    label: "role-pm-incoming",
  });
  const incomingContext = await browser.newContext({ viewport: smokeViewport });
  await incomingContext.addCookies([
    {
      name: "fmarch_session",
      value: incomingToken,
      domain: host,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const incomingPage = await incomingContext.newPage();
  const pageUrl = `${frontendBaseUrl}/g/${game}/c/${rolePmRoute}`;
  const response = await incomingPage.goto(pageUrl, { waitUntil: "networkidle" });
  if (response === null || !response.ok()) {
    throw new Error(
      `incoming Role PM route failed with ${response?.status() ?? "no response"}: ${await incomingPage.textContent("body")}`,
    );
  }
  await incomingPage.getByTestId("player-surface").waitFor({ state: "visible" });
  const channelContext = incomingPage.getByTestId("player-command-channel-context");
  await channelContext.waitFor({ state: "visible" });
  if ((await channelContext.getAttribute("data-channel-id")) !== rolePmChannel) {
    throw new Error(`incoming Role PM channel context drifted: ${await channelContext.innerText()}`);
  }
  const activeChannel = incomingPage.getByTestId(`player-channel-${rolePmChannel}`);
  await activeChannel.waitFor({ state: "visible" });
  if ((await activeChannel.getAttribute("aria-current")) !== "page") {
    throw new Error("incoming Role PM rail item is not active");
  }

  const historicalPost = incomingPage.locator(
    `[data-testid="thread-post-${fixture.media.mediaPostSeq}"]`,
  );
  await historicalPost.waitFor({ state: "visible" });
  const historicalText = await historicalPost.innerText();
  if (!historicalText.includes(rolePmHistoryBody)) {
    throw new Error(`incoming replacement lost Role PM history: ${historicalText}`);
  }
  const mediaFigure = incomingPage.getByTestId(
    `thread-post-media-${fixture.media.contentId}`,
  );
  await mediaFigure.waitFor({ state: "visible" });
  await incomingPage.waitForFunction(
    (testId) => {
      const image = document.querySelector(`[data-testid="${testId}"] img`);
      return image?.complete === true && image.naturalWidth > 0;
    },
    `thread-post-media-${fixture.media.contentId}`,
    { timeout: 120_000 },
  );
  await incomingPage.waitForFunction(
    (expectedBody) =>
      (window.__fmarchLiveProjectionEvents ?? []).some(
        (event) =>
          event?.delta?.kind === "ThreadPostsChanged" &&
          event.delta.body?.posts?.some((post) => post.body === expectedBody),
      ),
    rolePmHistoryBody,
  );
  const initialLiveDelta = await incomingPage.evaluate((expectedBody) =>
    (window.__fmarchLiveProjectionEvents ?? []).find(
      (event) =>
        event?.delta?.kind === "ThreadPostsChanged" &&
        event.delta.body?.posts?.some((post) => post.body === expectedBody),
    ), rolePmHistoryBody);

  const incomingMediaResponse = await incomingContext.request.get(
    `${frontendBaseUrl}${fixture.media.privateUrl}`,
    { headers: { accept: "image/avif" } },
  );
  const incomingMediaBytes = await incomingMediaResponse.body();
  if (incomingMediaResponse.status() !== 200 || incomingMediaBytes.byteLength === 0) {
    throw new Error(
      `incoming replacement could not read transferred Role PM media: ${incomingMediaResponse.status()} bytes=${incomingMediaBytes.byteLength}`,
    );
  }

  const textarea = incomingPage.locator('[data-testid="player-composer"] textarea');
  await textarea.fill(rolePmIncomingBody);
  const postButton = incomingPage.locator('[data-action="submit_post"]');
  assertHitTarget(await postButton.boundingBox(), "incoming Role PM post button");
  await postButton.click();
  const status = incomingPage.getByTestId("player-command-status");
  await status.waitFor({ state: "visible" });
  await incomingPage.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="player-command-status"]')
        ?.getAttribute("data-state") === "ack",
  );
  await incomingPage.waitForFunction(
    (expectedBody) =>
      (window.__fmarchLiveProjectionEvents ?? []).some(
        (event) =>
          event?.delta?.kind === "ThreadPostsChanged" &&
          event.delta.body?.posts?.some((post) => post.body === expectedBody),
      ),
    rolePmIncomingBody,
  );
  const submitOutcome = await incomingPage.evaluate(
    () => window.__fmarchPlayerCommandStatus,
  );
  const commandStatus = await status.innerText();
  const submitCommand = submitOutcome?.requestEnvelope?.body?.body?.command?.SubmitPost;
  if (
    submitOutcome?.state !== "ack" ||
    submitCommand?.channel_id !== rolePmChannel ||
    submitCommand?.actor_slot !== "slot-7" ||
    submitCommand?.body !== rolePmIncomingBody
  ) {
    throw new Error(`incoming Role PM SubmitPost drifted: ${JSON.stringify(submitOutcome)}`);
  }
  const commandLiveDelta = await incomingPage.evaluate((expectedBody) =>
    (window.__fmarchLiveProjectionEvents ?? []).find(
      (event) =>
        event?.delta?.kind === "ThreadPostsChanged" &&
        event.delta.body?.posts?.some((post) => post.body === expectedBody),
    ), rolePmIncomingBody);

  const reloadResponse = await incomingPage.reload({
    waitUntil: "networkidle",
    timeout: 180_000,
  });
  if (reloadResponse === null || !reloadResponse.ok()) {
    throw new Error(`incoming Role PM reload failed: ${reloadResponse?.status() ?? "none"}`);
  }
  await incomingPage.getByTestId("player-surface").waitFor({ state: "visible" });
  const reloadedPosts = await incomingPage
    .locator('[data-testid^="thread-post-"]')
    .allInnerTexts();
  if (
    !reloadedPosts.some((text) => text.includes(rolePmHistoryBody)) ||
    !reloadedPosts.some((text) => text.includes(rolePmIncomingBody))
  ) {
    throw new Error(`Role PM reload lost durable posts: ${JSON.stringify(reloadedPosts)}`);
  }
  const apiThread = await fetchJson(
    `${apiBaseUrl}/games/${game}/channels/${rolePmRoute}/thread?principal_user_id=player-rowan&limit=50`,
  );
  if (
    !apiThread.posts?.some((post) => post.body === rolePmHistoryBody) ||
    !apiThread.posts?.some((post) => post.body === rolePmIncomingBody)
  ) {
    throw new Error(`Role PM API reload lost replacement history: ${JSON.stringify(apiThread)}`);
  }
  await incomingContext.close();

  const outgoingContext = await browser.newContext({ viewport: smokeViewport });
  await outgoingContext.addCookies([
    {
      name: "fmarch_session",
      value: playerSessionToken,
      domain: host,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const outgoingPage = await outgoingContext.newPage();
  const deniedRoute = await outgoingPage.goto(pageUrl, { waitUntil: "networkidle" });
  if (deniedRoute === null || deniedRoute.status() !== 403) {
    throw new Error(
      `outgoing Role PM route expected 403, got ${deniedRoute?.status() ?? "none"}`,
    );
  }
  await outgoingPage.getByTestId("route-error-surface").waitFor({ state: "visible" });
  const staleThreadResponse = await fetchWithTimeout(
    `${apiBaseUrl}/games/${game}/channels/${rolePmRoute}/thread?principal_user_id=player-mira&limit=50`,
    {},
    15_000,
  );
  if (staleThreadResponse.status !== 403) {
    throw new Error(`outgoing principal read Role PM rows: ${staleThreadResponse.status}`);
  }
  const deniedMediaResponse = await outgoingContext.request.get(
    `${frontendBaseUrl}${fixture.media.privateUrl}`,
    { headers: { accept: "image/avif" } },
  );
  const deniedMediaBytes = await deniedMediaResponse.body();
  if (deniedMediaResponse.status() !== 403 || deniedMediaBytes.byteLength !== 0) {
    throw new Error(
      `outgoing principal received Role PM media: ${deniedMediaResponse.status()} bytes=${deniedMediaBytes.byteLength}`,
    );
  }
  const stalePostResponse = await outgoingContext.request.post(
    `${frontendBaseUrl}/commands`,
    {
      data: {
        v: 1,
        id: commandEnvelopeId++,
        body: {
          kind: "Command",
          body: {
            command_id: crypto.randomUUID(),
            principal_user_id: "player-mira",
            command: {
              SubmitPost: {
                game,
                channel_id: rolePmChannel,
                actor_slot: "slot-7",
                body: "stale outgoing Role PM post",
                media: [],
              },
            },
          },
        },
      },
    },
  );
  const stalePost = await stalePostResponse.json();
  if (
    stalePostResponse.status() !== 200 ||
    stalePost.body?.kind !== "Reject" ||
    stalePost.body?.body?.error !== "NotYourSlot"
  ) {
    throw new Error(`outgoing stale Role PM post was not denied: ${JSON.stringify(stalePost)}`);
  }
  await outgoingContext.close();

  return {
    status: "passed",
    pageUrl,
    channelId: rolePmChannel,
    slotId: "slot-7",
    incomingSession,
    incoming: {
      principalUserId: "player-rowan",
      commandStatus,
      submitOutcome,
      initialLiveDelta,
      commandLiveDelta,
      reloadedPostBodies: apiThread.posts.map((post) => post.body),
      mediaStatus: incomingMediaResponse.status(),
      mediaBodyBytes: incomingMediaBytes.byteLength,
    },
    outgoing: {
      principalUserId: "player-mira",
      authenticatedSessionRemainedActive: true,
      routeStatus: deniedRoute.status(),
      threadStatus: staleThreadResponse.status,
      mediaStatus: deniedMediaResponse.status(),
      mediaBodyBytes: deniedMediaBytes.byteLength,
      stalePostReject: stalePost.body.body,
    },
    proof:
      "The incoming account session opened the engine-declared slot-stable Role PM, received its capability-filtered websocket hydration, retained pre-replacement slot history and media, ACKed a new post, observed the channel-scoped live delta, and recovered both posts after reload. The still-authenticated outgoing session received 403 for the route and thread, zero media bytes, and NotYourSlot for a stale append.",
  };
}

async function driveAdminBrowser(frontendBaseUrl) {
  const context = await browser.newContext({ viewport: smokeViewport });
  await context.addCookies([
    {
      name: "fmarch_session",
      value: adminSessionToken,
      domain: host,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const page = await context.newPage();
  const pageUrl = `${frontendBaseUrl}/admin?game=${adminCreatedGame}`;
  const response = await page.goto(pageUrl, { waitUntil: "networkidle" });
  if (response === null || !response.ok()) {
    throw new Error(
      `admin route failed with ${response?.status() ?? "no response"}: ${await page.textContent("body")}`,
    );
  }

  await page.getByTestId("admin-surface").waitFor({ state: "visible" });
  const capability = await page.getByTestId("admin-capability").innerText();
  if (capability !== "GlobalAdmin") {
    throw new Error(`admin capability did not render GlobalAdmin: ${capability}`);
  }
  const proofCard = page.locator('[data-testid^="admin-audit-"]').first();
  await proofCard.waitFor({ state: "visible" });
  const proofCardText = await proofCard.innerText();
  if (proofCardText.includes("Current local report available")) {
    throw new Error(`admin audit fell back instead of loading operator status: ${proofCardText}`);
  }
  const inspect = proofCard.locator("a").first();
  assertHitTarget(await inspect.boundingBox(), "admin audit inspect");
  const createButton = page
    .getByTestId("admin-setup-create-game")
    .locator("button")
    .first();
  assertHitTarget(await createButton.boundingBox(), "admin create game");
  await createButton.click();
  const createStatus = page.getByTestId("admin-command-status-create-game");
  await createStatus.waitFor({ state: "visible" });
  if ((await createStatus.getAttribute("data-state")) !== "confirm") {
    throw new Error("admin create game did not render confirmation");
  }
  const createConfirm = page.getByTestId("admin-command-confirm-create-game");
  assertHitTarget(await createConfirm.boundingBox(), "admin create game confirm");
  await createConfirm.click();
  await page.waitForFunction(() => {
    const node = document.querySelector(
      '[data-testid="admin-command-status-create-game"]',
    );
    return node?.getAttribute("data-state") === "ack";
  });
  const createOutcome = await page.evaluate(
    () => window.__fmarchAdminCommandOutcome,
  );
  assertAdminCreateGameEnvelope(createOutcome?.requestEnvelope);
  const createStatusText = await createStatus.innerText();
  const cohostButton = page
    .getByTestId("admin-setup-cohost")
    .locator("button")
    .first();
  assertHitTarget(await cohostButton.boundingBox(), "admin cohost delegation");
  await cohostButton.click();
  const cohostStatus = page.getByTestId("admin-command-status-cohost");
  await cohostStatus.waitFor({ state: "visible" });
  if ((await cohostStatus.getAttribute("data-state")) !== "confirm") {
    throw new Error("admin cohost delegation did not render confirmation");
  }
  const cohostConfirm = page.getByTestId("admin-command-confirm-cohost");
  assertHitTarget(await cohostConfirm.boundingBox(), "admin cohost confirm");
  await cohostConfirm.click();
  await page.waitForFunction(() => {
    const node = document.querySelector(
      '[data-testid="admin-command-status-cohost"]',
    );
    return node?.getAttribute("data-state") === "ack";
  });
  const cohostOutcome = await page.evaluate(
    () => window.__fmarchAdminCommandStatuses?.cohost,
  );
  assertAdminCohostEnvelope(cohostOutcome?.requestEnvelope);
  const cohostStatusText = await cohostStatus.innerText();
  const sessionGrantButton = page
    .getByTestId("admin-setup-session-grants")
    .locator("button")
    .first();
  assertHitTarget(await sessionGrantButton.boundingBox(), "admin session grant");
  await sessionGrantButton.click();
  const sessionGrantStatus = page.getByTestId("admin-command-status-session-grants");
  await sessionGrantStatus.waitFor({ state: "visible" });
  if ((await sessionGrantStatus.getAttribute("data-state")) !== "confirm") {
    throw new Error("admin session grant did not render confirmation");
  }
  const sessionGrantConfirm = page.getByTestId(
    "admin-command-confirm-session-grants",
  );
  assertHitTarget(await sessionGrantConfirm.boundingBox(), "admin session grant confirm");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle" }),
    sessionGrantConfirm.click(),
  ]);
  const sessionGrantResult = page.getByTestId(
    "admin-command-status-session-grants",
  );
  await sessionGrantResult.waitFor({ state: "visible" });
  await page.waitForFunction(() => {
    const node = document.querySelector(
      '[data-testid="admin-command-status-session-grants"]',
    );
    return node?.getAttribute("data-state") === "ack";
  });
  const sessionGrantStatusText = await sessionGrantResult.innerText();
  const createdSession = await fetchJson(
    `${apiBaseUrl}/auth/session?game=${adminCreatedGame}`,
    {
      headers: {
        authorization: `Bearer ${adminSessionToken}`,
      },
    },
  );
  const createdCapabilityKinds = (createdSession.capabilities ?? []).map(
    (capability) => capability.kind,
  );
  if (!createdCapabilityKinds.includes("HostOf")) {
    throw new Error(
      `admin-created game did not grant HostOf: ${JSON.stringify(createdSession)}`,
    );
  }
  const delegatedSession = await fetchJson(
    `${apiBaseUrl}/auth/session?game=${adminCreatedGame}`,
    {
      headers: {
        authorization: `Bearer ${cohostSessionToken}`,
      },
    },
  );
  const delegatedCapabilityKinds = (delegatedSession.capabilities ?? []).map(
    (capability) => capability.kind,
  );
  if (!delegatedCapabilityKinds.includes("CohostOf")) {
    throw new Error(
      `admin cohost delegation did not grant CohostOf: ${JSON.stringify(delegatedSession)}`,
    );
  }
  const grantedGlobalModSession = await fetchJson(`${apiBaseUrl}/auth/session`, {
    headers: {
      authorization: `Bearer ${grantedGlobalModToken}`,
    },
  });
  const grantedGlobalModCapabilityKinds = (
    grantedGlobalModSession.capabilities ?? []
  ).map((capability) => capability.kind);
  if (!grantedGlobalModCapabilityKinds.includes("GlobalMod")) {
    throw new Error(
      `admin session grant did not grant GlobalMod: ${JSON.stringify(grantedGlobalModSession)}`,
    );
  }
  const grantedGlobalModLogin = await driveGrantedGlobalModLogin(frontendBaseUrl);
  const hostSetup = await driveHostSetupBrowser(page, frontendBaseUrl);

  await context.close();
  return {
    url: pageUrl,
    capability,
    proofCardText,
    createStatusText,
    createOutcome,
    cohostStatusText,
    cohostOutcome,
    sessionGrantStatusText,
    createdSession: {
      principalUserId: createdSession.principal_user_id,
      capabilityKinds: createdCapabilityKinds,
    },
    delegatedSession: {
      principalUserId: delegatedSession.principal_user_id,
      capabilityKinds: delegatedCapabilityKinds,
    },
    grantedGlobalModSession: {
      principalUserId: grantedGlobalModSession.principal_user_id,
      capabilityKinds: grantedGlobalModCapabilityKinds,
    },
    grantedGlobalModLogin,
    hostSetup,
  };
}

async function driveHostSetupBrowser(page, frontendBaseUrl) {
  const adminUrl = `${frontendBaseUrl}/admin?game=${adminCreatedGame}`;
  if (page.url() !== adminUrl) {
    await page.goto(adminUrl, { waitUntil: "networkidle" });
    await page.getByTestId("admin-surface").waitFor({ state: "visible" });
  }

  const setupTrigger = page.getByTestId("admin-command-trigger-host-setup");
  await setupTrigger.waitFor({ state: "visible" });
  const setupTriggerBox = await setupTrigger.boundingBox();
  assertHitTarget(setupTriggerBox, "admin host setup trigger");
  await Promise.all([
    page.waitForURL(`${frontendBaseUrl}/g/${adminCreatedGame}/setup`, {
      waitUntil: "networkidle",
    }),
    setupTrigger.click(),
  ]);

  await page.getByTestId("host-setup-surface").waitFor({ state: "visible" });
  const setupUrl = page.url();
  const initialReadiness = await setupReadiness(page);
  if (initialReadiness.summary !== "Setup still needs attention") {
    throw new Error(
      `admin-created setup did not start blocked: ${JSON.stringify(initialReadiness)}`,
    );
  }

  const slotId = "slot_1";
  const occupantUserId = "player_mira";
  const roleKey = "vanilla_townie";
  const addSlotForm = page.getByTestId("host-setup-add-slot-form");
  await addSlotForm.waitFor({ state: "visible" });
  const addSlotInput = addSlotForm.locator('input[name="slotId"]');
  await addSlotInput.fill(slotId);
  const addSlotButton = page.getByRole("button", { name: "Add slot" });
  const addSlotBox = await addSlotButton.boundingBox();
  assertHitTarget(addSlotBox, "host setup add slot");
  await addSlotButton.click();
  const addSlot = await waitForHostSetupCommand({
    setupPage: page,
    statusTestId: "host-setup-add-slot-status",
    commandKind: "AddSlot",
    commandPredicate: (command) =>
      command?.game === adminCreatedGame && command?.slot === slotId,
    statePredicate: (state) =>
      (state?.slots ?? []).some((slot) => slot.slotId === slotId),
  });

  const rosterRow = page.getByTestId(`host-setup-slot-${slotId}`);
  await rosterRow.waitFor({ state: "visible" });
  await rosterRow.locator('input[name="principalUserId"]').fill(occupantUserId);
  const assignSlotButton = rosterRow.getByRole("button", {
    name: "Assign",
    exact: true,
  });
  const assignSlotBox = await assignSlotButton.boundingBox();
  assertHitTarget(assignSlotBox, "host setup assign slot");
  await assignSlotButton.click();
  const assignSlot = await waitForHostSetupCommand({
    setupPage: page,
    statusTestId: "host-setup-assign-slot-status",
    commandKind: "AssignSlot",
    commandPredicate: (command) =>
      command?.game === adminCreatedGame &&
      command?.slot === slotId &&
      command?.user === occupantUserId,
    statePredicate: (state) =>
      (state?.slots ?? []).some(
        (slot) => slot.slotId === slotId && slot.occupantUserId === occupantUserId,
      ),
  });

  const roleRow = page.getByTestId(`host-setup-role-${slotId}`);
  await roleRow.waitFor({ state: "visible" });
  await roleRow.locator('select[name="roleKey"]').selectOption(roleKey);
  const assignRoleButton = roleRow.getByRole("button", {
    name: "Assign role",
    exact: true,
  });
  const assignRoleBox = await assignRoleButton.boundingBox();
  assertHitTarget(assignRoleBox, "host setup assign role");
  await assignRoleButton.click();
  const assignRole = await waitForHostSetupCommand({
    setupPage: page,
    statusTestId: "host-setup-assign-role-status",
    commandKind: "AssignRole",
    commandPredicate: (command) =>
      command?.game === adminCreatedGame &&
      command?.slot === slotId &&
      command?.role_key === roleKey,
    statePredicate: (state) =>
      (state?.slots ?? []).some(
        (slot) => slot.slotId === slotId && slot.roleKey === roleKey,
      ),
  });

  const policyBefore = await page.getByTestId("host-setup-main-policy").innerText();
  if (!policyBefore.includes("disabled")) {
    throw new Error(`host setup policy did not start disabled: ${policyBefore}`);
  }
  const policyButton = page.getByRole("button", { name: "Enable media-only" });
  const policyButtonBox = await policyButton.boundingBox();
  assertHitTarget(policyButtonBox, "host setup media-only policy");
  await policyButton.click();
  const setPostPolicy = await waitForHostSetupCommand({
    setupPage: page,
    statusTestId: "host-setup-policy-status",
    commandKind: "SetPostPolicy",
    commandPredicate: (command) =>
      command?.game === adminCreatedGame &&
      command?.channel_id === "main" &&
      command?.allow_media_only === true,
    statePredicate: (state) =>
      (state?.postPolicies ?? []).some(
        (policy) => policy.channelId === "main" && policy.allowMediaOnly === true,
      ),
  });
  const policyAfter = await page.getByTestId("host-setup-main-policy").innerText();
  if (!policyAfter.includes("enabled")) {
    throw new Error(`host setup policy did not render enabled: ${policyAfter}`);
  }

  await page.waitForFunction(
    () => window.__fmarchHostSetupReadiness?.startAvailable === true,
  );
  const readyReadiness = await setupReadiness(page);
  if (readyReadiness.summary !== "Ready to start") {
    throw new Error(`host setup did not become ready: ${JSON.stringify(readyReadiness)}`);
  }
  const reviewStart = page.getByTestId("host-setup-start-review");
  const reviewStartBox = await reviewStart.boundingBox();
  assertHitTarget(reviewStartBox, "host setup review start");
  await reviewStart.click();
  await page.getByTestId("host-setup-start-confirmation").waitFor({ state: "visible" });
  const startConfirm = page
    .getByTestId("host-setup-start-confirmation")
    .getByRole("button", { name: "Start game" });
  const startConfirmBox = await startConfirm.boundingBox();
  assertHitTarget(startConfirmBox, "host setup start confirm");
  await startConfirm.click();
  const startGame = await waitForHostSetupCommand({
    setupPage: page,
    statusTestId: "host-setup-start-status",
    commandKind: "StartGame",
    commandPredicate: (command) =>
      command?.game === adminCreatedGame && command?.phase === "D01",
    statePredicate: (state) => state?.phase?.phaseId === "D01",
  });

  await page.waitForFunction(
    () => window.__fmarchHostSetupReadiness?.summary === "Started at D01",
  );
  const startedReadiness = await setupReadiness(page);
  const openHostConsole = page.getByRole("link", { name: "Open host console" });
  await openHostConsole.waitFor({ state: "visible" });
  const openHostConsoleBox = await openHostConsole.boundingBox();
  assertHitTarget(openHostConsoleBox, "host setup open host console");
  await Promise.all([
    page.waitForURL(`${frontendBaseUrl}/g/${adminCreatedGame}/host`, {
      waitUntil: "networkidle",
    }),
    openHostConsole.click(),
  ]);
  await page.getByTestId("host-console-surface").waitFor({ state: "visible" });
  const hostConsoleUrl = page.url();
  const hostConsoleState = await fetchJson(
    `${apiBaseUrl}/games/${adminCreatedGame}/host-console-state?principal_user_id=admin_a&slot_id=${slotId}`,
  );
  if (hostConsoleState.phase?.phase_id !== "D01") {
    throw new Error(
      `host setup StartGame did not project into host console state: ${JSON.stringify(hostConsoleState)}`,
    );
  }

  return {
    status: "passed",
    adminUrl,
    setupUrl,
    hostConsoleUrl,
    setupTriggerBox,
    controls: {
      addSlotBox,
      assignSlotBox,
      assignRoleBox,
      policyButtonBox,
      reviewStartBox,
      startConfirmBox,
      openHostConsoleBox,
    },
    slotId,
    occupantUserId,
    roleKey,
    policyBefore,
    policyAfter,
    initialReadiness,
    readyReadiness,
    startedReadiness,
    commands: {
      addSlot,
      assignSlot,
      assignRole,
      setPostPolicy,
      startGame,
    },
    setupCommandEvidence: buildSetupCommandEvidence({
      addSlot,
      assignSlot,
      assignRole,
      setPostPolicy,
      startGame,
    }),
    hostConsoleState: {
      phase: hostConsoleState.phase,
      slot: hostConsoleState.slots?.find((slot) => slot.slot_id === slotId),
    },
  };
}

async function setupReadiness(page) {
  return await page.evaluate(() => window.__fmarchHostSetupReadiness ?? null);
}

async function driveGrantedGlobalModLogin(frontendBaseUrl) {
  const context = await browser.newContext({ viewport: smokeViewport });
  const page = await context.newPage();
  const returnTo = `/admin?game=${adminCreatedGame}`;
  const loginUrl = `${frontendBaseUrl}/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
  const response = await page.goto(loginUrl, { waitUntil: "networkidle" });
  if (response === null || !response.ok()) {
    throw new Error(
      `auth login route failed with ${response?.status() ?? "no response"}: ${await page.textContent("body")}`,
    );
  }
  await page.getByTestId("auth-login-surface").waitFor({ state: "visible" });
  await page.getByTestId("auth-login-token").fill(grantedGlobalModToken);
  await Promise.all([
    page.waitForURL(`${frontendBaseUrl}${returnTo}`, { waitUntil: "networkidle" }),
    page.getByTestId("auth-login-submit").click(),
  ]);
  await page.getByTestId("admin-surface").waitFor({ state: "visible" });
  const capability = await page.getByTestId("admin-capability").innerText();
  if (capability !== "GlobalMod") {
    throw new Error(`login-granted admin capability did not render GlobalMod: ${capability}`);
  }
  const sessionCookies = (await context.cookies(frontendBaseUrl)).filter(
    (cookie) => cookie.name === "fmarch_session",
  );
  const sessionCookie = sessionCookies.at(-1);
  if (sessionCookie === undefined || sessionCookie.value !== grantedGlobalModToken) {
    throw new Error(
      `auth login did not write fmarch_session cookie: ${JSON.stringify(sessionCookies)}`,
    );
  }
  const proofCard = page.locator('[data-testid^="admin-audit-"]').first();
  await proofCard.waitFor({ state: "visible" });
  const proofCardText = await proofCard.innerText();
  const finalUrl = page.url();
  await context.close();
  return {
    loginUrl,
    returnTo,
    finalUrl,
    capability,
    sessionCookie: {
      name: sessionCookie.name,
      path: sessionCookie.path,
      httpOnly: sessionCookie.httpOnly,
      sameSite: sessionCookie.sameSite,
      secure: sessionCookie.secure,
      valueMatchesGrantedToken: sessionCookie.value === grantedGlobalModToken,
    },
    proofCardText,
    proof:
      "A GlobalAdmin-issued /auth/session-grants token was submitted through /auth/login, the SvelteKit action verified it with /auth/session, wrote the httpOnly fmarch_session cookie, redirected to /admin, and rendered the authenticated GlobalMod UI without a pre-seeded browser cookie.",
  };
}

async function drivePlayerBrowser(frontendBaseUrl) {
  const context = await browser.newContext({ viewport: smokeViewport });
  await context.addCookies([
    {
      name: "fmarch_session",
      value: playerSessionToken,
      domain: host,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const page = await context.newPage();
  const pageUrl = `${frontendBaseUrl}/g/${game}`;
  const response = await page.goto(pageUrl, { waitUntil: "networkidle" });
  if (response === null || !response.ok()) {
    throw new Error(
      `player route failed with ${response?.status() ?? "no response"}: ${await page.textContent("body")}`,
    );
  }

  await page.getByTestId("player-surface").waitFor({ state: "visible" });
  await page.waitForFunction(() =>
    window.__fmarchLiveProjectionEvents?.some(
      (event) =>
        event?.delta?.kind === "VoteCountChanged" &&
        event.delta.body?.candidate_slot === "slot_1" &&
        event.delta.body?.count === 1,
    ),
  );
  const capability = await page.getByTestId("player-capability").innerText();
  if (!capability.includes("SlotOccupant")) {
    throw new Error(`player capability did not render SlotOccupant: ${capability}`);
  }
  const firstPost = await page.locator('[data-testid^="thread-post-"]').first();
  await firstPost.waitFor({ state: "visible" });
  const firstPostText = await firstPost.innerText();
  if (!firstPostText.includes("Slot 7 history before replacement")) {
    throw new Error(`player thread did not cold-load real post: ${firstPostText}`);
  }

  let playerStep = "submit-vote";
  let reconnectDebug = {};
  let reconnectEvidence;
  let staleVoteRecovery;
  let staleVoteLockCommand;
  let staleVoteUnlockCommand;
  let duplicateVoteRetry;
  let duplicateVoteRows;
  let duplicateVoteReceiptRows;
  let concurrentVoteRace;
  let concurrentVoteRows;
  let raceVoteWithdrawCommand;
  const duplicateVoteCommandId = crypto.randomUUID();
  const raceVoteSession = await openStalePlayerVoteBrowser(frontendBaseUrl, {
    sessionToken: racePlayerSessionToken,
    label: "racing vote player",
  });
  const duplicateVoteSession = await openStalePlayerVoteBrowser(frontendBaseUrl);
  const staleVoteSession = await openStalePlayerVoteBrowser(frontendBaseUrl);
  await page.evaluate((commandId) => {
    window.__fmarchPlayerCommandIdFactory = () => commandId;
  }, duplicateVoteCommandId);
  await installVoteInsertDelayTrigger();
  const voteButton = page.locator('[data-action="submit_vote"]');
  const voteButtonBox = await voteButton.boundingBox();
  assertHitTarget(voteButtonBox, "player vote button");
  const raceVoteButton = raceVoteSession.page.locator('[data-action="submit_vote"]');
  assertHitTarget(await raceVoteButton.boundingBox(), "racing player vote button");
  const raceStatus = raceVoteSession.page.getByTestId("player-command-status");
  const status = page.getByTestId("player-command-status");
  try {
    await Promise.all([voteButton.click(), raceVoteButton.click()]);
    await status.waitFor({ state: "visible" });
    await raceStatus.waitFor({ state: "visible" });
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="player-command-status"]')
          ?.getAttribute("data-state") === "ack",
    );
    await raceVoteSession.page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="player-command-status"]')
          ?.getAttribute("data-state") === "ack",
    );
  } finally {
    await dropVoteInsertDelayTrigger();
  }
  const voteOutcome = await page.evaluate(() => window.__fmarchPlayerCommandStatus);
  const raceVoteOutcome = await raceVoteSession.page.evaluate(
    () => window.__fmarchPlayerCommandStatus,
  );
  assertPlayerVoteSubmitOutcome(voteOutcome, { actorSlot: "slot-7" });
  assertPlayerVoteSubmitOutcome(raceVoteOutcome, {
    actorSlot: "slot_4",
    label: "racing player SubmitVote",
  });
  assertPlayerVoteCommandId({
    outcome: voteOutcome,
    commandId: duplicateVoteCommandId,
    label: "first player SubmitVote",
  });
  await page.evaluate(() => {
    delete window.__fmarchPlayerCommandIdFactory;
  });
  try {
    playerStep = "wait-live-vote-race-count-3";
    await page.waitForFunction(() => {
      return window.__fmarchLiveProjectionEvents?.some(
        (event) =>
          event?.delta?.kind === "VoteCountChanged" &&
          event.delta.body?.candidate_slot === "slot_1" &&
          event.delta.body?.count === 3,
      );
    });
    await page.waitForFunction(() => {
      const projection = window.__fmarchPlayerProjection;
      return projection?.votecount?.some(
        (row) => row.target === "slot_1" && row.count === 3,
      );
    });
    await raceVoteSession.page.waitForFunction(() =>
      typeof window.__fmarchTriggerPlayerResync === "function",
    );
    await raceVoteSession.page.evaluate(() => window.__fmarchTriggerPlayerResync(0));
    await raceVoteSession.page.waitForFunction(() =>
      window.__fmarchPlayerProjection?.votecount?.some(
        (row) => row.target === "slot_1" && row.count === 3,
      ),
    );
    concurrentVoteRows = await runSql(
      smokeDatabase.url,
      `SELECT kind, stream_seq, payload->>'actor' AS actor, payload->>'target' AS target, payload->>'phase_id' AS phase_id
       FROM events
       WHERE stream_id = '${game}' AND kind = 'VoteSubmitted' AND payload->>'actor' IN ('slot-7', 'slot_4')
       ORDER BY stream_seq`,
    );
    assertConcurrentPlayerVoteRows(concurrentVoteRows);
    concurrentVoteRace = {
      firstOutcome: voteOutcome,
      secondOutcome: raceVoteOutcome,
      secondStatusMessage: await raceStatus.innerText(),
      rows: concurrentVoteRows,
      firstProjection: await page.evaluate(() => window.__fmarchPlayerProjection),
      secondProjection: await raceVoteSession.page.evaluate(
        () => window.__fmarchPlayerProjection,
      ),
      proof:
        "Two authenticated seeded player role pages submitted distinct SubmitVote commands for slot-7 and slot_4 under a scratch VoteSubmitted insert delay; both browser commands ACKed without StreamConflict, the stale race page recovered to authoritative votecount 3 through the player resync hook, and the scratch event stream retained one VoteSubmitted row for each actor.",
    };

    playerStep = "duplicate-vote-retry";
    duplicateVoteRetry = await submitDuplicatePlayerVote(duplicateVoteSession, {
      firstOutcome: voteOutcome,
      commandId: duplicateVoteCommandId,
      expectedCount: 3,
    });
    duplicateVoteRows = await runSql(
      smokeDatabase.url,
      `SELECT kind, payload->>'actor' AS actor, payload->>'target' AS target, payload->>'phase_id' AS phase_id
       FROM events
       WHERE stream_id = '${game}' AND kind = 'VoteSubmitted' AND payload->>'actor' = 'slot-7'
       ORDER BY stream_seq`,
    );
    assertSinglePlayerVoteSubmittedRow(duplicateVoteRows);
    duplicateVoteReceiptRows = await runSql(
      smokeDatabase.url,
      `SELECT principal_user_id, command_id::text, stream_seqs
       FROM command_receipt
       WHERE principal_user_id = 'player-mira'
         AND command_id = '${duplicateVoteCommandId}'::uuid`,
    );
    assertDuplicatePlayerVoteReceipt({
      commandId: duplicateVoteCommandId,
      receiptRows: duplicateVoteReceiptRows,
    });

    playerStep = "withdraw-vote";
    const withdrawButton = page.getByText("Withdraw vote", { exact: true });
    const withdrawButtonBox = await withdrawButton.boundingBox();
    assertHitTarget(withdrawButtonBox, "player withdraw button");
    await withdrawButton.click();
    playerStep = "wait-live-vote-count-2-after-primary-withdraw";
    await page.waitForFunction(() => {
      const events = window.__fmarchLiveProjectionEvents ?? [];
      const countThreeIndex = events.findIndex(
        (event) =>
          event?.delta?.kind === "VoteCountChanged" &&
          event.delta.body?.candidate_slot === "slot_1" &&
          event.delta.body?.count === 3,
      );
      return events.some(
        (event, index) =>
          index > countThreeIndex &&
          event?.delta?.kind === "VoteCountChanged" &&
          event.delta.body?.candidate_slot === "slot_1" &&
          event.delta.body?.count === 2,
      );
    });
    await page.waitForFunction(() => {
      const projection = window.__fmarchPlayerProjection;
      return projection?.votecount?.some(
        (row) => row.target === "slot_1" && row.count === 2,
      );
    });
    playerStep = "withdraw-racing-vote";
    raceVoteWithdrawCommand = await sendCommand("player-goon-a", {
      WithdrawVote: { game, actor_slot: "slot_4" },
    });
    playerStep = "wait-live-vote-count-1-after-race-withdraw";
    await page.waitForFunction(() => {
      const events = window.__fmarchLiveProjectionEvents ?? [];
      const countTwoIndex = events.findIndex(
        (event) =>
          event?.delta?.kind === "VoteCountChanged" &&
          event.delta.body?.candidate_slot === "slot_1" &&
          event.delta.body?.count === 2,
      );
      return events.some(
        (event, index) =>
          index > countTwoIndex &&
          event?.delta?.kind === "VoteCountChanged" &&
          event.delta.body?.candidate_slot === "slot_1" &&
          event.delta.body?.count === 1,
      );
    });
    await page.waitForFunction(() => {
      const projection = window.__fmarchPlayerProjection;
      return projection?.votecount?.some(
        (row) => row.target === "slot_1" && row.count === 1,
      );
    });
    playerStep = "drop-live-projection";
    await page.waitForFunction(
      () => typeof window.__fmarchDropPlayerLiveProjection === "function",
    );
    await page.evaluate(() => window.__fmarchDropPlayerLiveProjection());
    await page.waitForFunction(
      () => window.__fmarchLiveProjectionStatus?.state === "reconnecting",
    );
    const liveStatusBadge = page.getByTestId("player-live-status");
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="player-live-status"]')
          ?.getAttribute("data-state") === "reconnecting",
    );
    await page.waitForFunction(() =>
      (window.__fmarchLiveProjectionEvents ?? []).some(
        (event) => event?.kind === "close",
      ),
    );
    const reconnectingStatus = await page.evaluate(
      () => window.__fmarchLiveProjectionStatus,
    );
    const renderedReconnectingStatus = {
      state: await liveStatusBadge.getAttribute("data-state"),
      message: await liveStatusBadge.innerText(),
    };
    const reconnectPostBody = `Player reconnect resync proof ${game}`;
    playerStep = "send-disconnected-thread-post";
    const reconnectCommand = await sendCommand("player-seed", {
      SubmitPost: {
        game,
        channel_id: "main",
        actor_slot: "slot-3",
        body: reconnectPostBody,
      },
    });
    playerStep = "wait-api-thread-post";
    const apiThreadPost = await waitForMainThreadPost(reconnectPostBody);
    playerStep = "probe-browser-thread-post";
    reconnectDebug = {
      reconnectPostBody,
      reconnectCommand,
      apiThreadPost,
    };
    const playerResyncPlan = await page.evaluate(() => ({
      coldLoadEndpoints: window.__fmarchPlayerColdLoadEndpoints,
      resyncKeys: window.__fmarchPlayerResyncKeys,
    }));
    let browserThreadPageBeforeReconnect;
    try {
      browserThreadPageBeforeReconnect = await page.evaluate(
        async ({ endpoint, expectedBody }) => {
          try {
            const url = new URL(endpoint, window.location.href);
            url.searchParams.set("_fmarch_browser_fetch_probe", expectedBody);
            const response = await fetch(url.toString(), {
              cache: "no-store",
              headers: { accept: "application/json" },
            });
            const body = await response.json();
            return {
              endpoint: url.toString(),
              ok: response.ok,
              status: response.status,
              postBodies: (body.posts ?? []).map((post) => post.body),
              containsExpectedPost: (body.posts ?? []).some(
                (post) => post.body === expectedBody,
              ),
            };
          } catch (error) {
            return {
              endpoint,
              ok: false,
              status: null,
              error: error.message,
              postBodies: [],
              containsExpectedPost: false,
            };
          }
        },
        {
          endpoint: playerResyncPlan.coldLoadEndpoints.threadEndpoint,
          expectedBody: reconnectPostBody,
        },
      );
    } catch (error) {
      browserThreadPageBeforeReconnect = {
        endpoint: playerResyncPlan.coldLoadEndpoints.threadEndpoint,
        ok: false,
        status: null,
        evaluateError: error.message,
        postBodies: [],
        containsExpectedPost: false,
      };
    }
    reconnectDebug = {
      reconnectPostBody,
      reconnectCommand,
      apiThreadPost,
      browserThreadPageBeforeReconnect,
      playerResyncPlan,
    };
    if (browserThreadPageBeforeReconnect.containsExpectedPost !== true) {
      throw new Error(
        `browser thread fetch did not include disconnected post: ${JSON.stringify(reconnectDebug)}`,
      );
    }
    playerStep = "wait-automatic-reconnect-recovery";
    await page.waitForFunction(
      () => {
        const events = window.__fmarchLiveProjectionEvents ?? [];
        return events.some(
          (event) =>
            event?.kind === "reconnect" &&
            event.attempt === 1 &&
            event.state === "recovered",
        );
      }
    );
    const reconnectRecoveryEvent = await page.evaluate(() =>
      (window.__fmarchLiveProjectionEvents ?? []).find(
        (event) =>
          event?.kind === "reconnect" &&
          event.attempt === 1 &&
          event.state === "recovered",
      ),
    );
    playerStep = "wait-post-after-automatic-reconnect";
    await page.waitForFunction(
      () => window.__fmarchLiveProjectionStatus?.state !== "reconnecting",
    );
    await page.waitForFunction(
      (expectedBody) =>
        window.__fmarchPlayerProjection?.thread?.posts?.some(
          (post) => post.body === expectedBody,
        ),
      reconnectPostBody,
    );
    await page.getByText(reconnectPostBody, { exact: true }).waitFor({
      state: "visible",
    });
    const recoveredProjection = await page.evaluate(
      () => window.__fmarchPlayerProjection,
    );
    reconnectDebug = {
      ...reconnectDebug,
      recoveredProjectionPostBodies: recoveredProjection?.thread?.posts?.map(
        (post) => post.body,
      ),
    };
    playerStep = "reconnect-proof-complete";
    reconnectEvidence = {
      boundary:
        "player route can expose a reconnecting live-projection state, accept a server-side projection change while the socket is dropped, and automatically recover the thread snapshot through the seeded role URL reconnect path without reloading",
      reconnectingStatus,
      renderedReconnectingStatus,
      reconnectCommand,
      reconnectAttempt: 1,
      apiThreadPost,
      browserThreadPageBeforeReconnect,
      playerResyncPlan,
      recoveredStatus: await page.evaluate(
        () => window.__fmarchLiveProjectionStatus,
      ),
      reconnectRecoveryEvent,
      recoveredPostBody: reconnectPostBody,
      recoveredSnapshotContainsPost: recoveredProjection?.thread?.posts?.some(
        (post) => post.body === reconnectPostBody,
      ),
    };
    playerStep = "lock-for-stale-vote";
    staleVoteLockCommand = await sendCommand("host_h", {
      LockThread: { game },
    });
    playerStep = "stale-vote-reject";
    staleVoteRecovery = await submitStalePlayerVote(staleVoteSession);
    playerStep = "unlock-after-stale-vote";
    staleVoteUnlockCommand = await sendCommand("host_h", {
      UnlockThread: { game },
    });
    playerStep = "wait-player-unlocked-after-stale-vote";
    await page.waitForFunction(
      () => window.__fmarchPlayerProjection?.commandState?.phase?.locked === false,
    );
  } catch (error) {
    const debug = {
      playerStep,
      errorMessage: error?.message ?? String(error),
      statusText: await status.innerText(),
      statusState: await status.getAttribute("data-state"),
      projection: await page.evaluate(() => window.__fmarchPlayerProjection),
      liveStatus: await page.evaluate(() => window.__fmarchLiveProjectionStatus),
      hasCloseHook: await page.evaluate(
        () => typeof window.__fmarchClosePlayerLiveProjection === "function",
      ),
      playerWindowKeys: await page.evaluate(() =>
        Object.keys(window)
          .filter((key) => key.startsWith("__fmarch"))
          .sort(),
      ),
      liveProjectionEvents: await page.evaluate(
        () => window.__fmarchLiveProjectionEvents,
      ),
      apiVoteCount: await fetchJson(`${apiBaseUrl}/games/${game}/votecount`),
      reconnectDebug,
    };
    throw new Error(`player projection did not refresh after ack: ${JSON.stringify(debug)}`);
  }

  const projection = await page.evaluate(() => window.__fmarchPlayerProjection);
  const liveProjectionEvents = await page.evaluate(
    () => window.__fmarchLiveProjectionEvents,
  );
  const commandStatus = await status.innerText();
  await raceVoteSession.context.close();
  await duplicateVoteSession.context.close();
  await staleVoteSession.context.close();
  await context.close();
  return {
    url: pageUrl,
    capability,
    firstPostText,
    commandStatus,
    projection,
    liveProjectionEvents,
    concurrentVoteRace: {
      ...concurrentVoteRace,
      withdrawCommand: raceVoteWithdrawCommand,
    },
    duplicateVoteRetry: {
      ...duplicateVoteRetry,
      voteRows: duplicateVoteRows,
      receiptRows: duplicateVoteReceiptRows,
      proof:
        "A second stale seeded player page loaded /g/{game} before the live player vote, retried SubmitVote with the same command_id after the live page ACK, received the original ACK stream seqs from command_receipt through a separate browser submission, refreshed votecount to 2, and the scratch event stream retained exactly one VoteSubmitted row for slot-7.",
    },
    reconnect: reconnectEvidence,
    staleVoteRecovery: {
      lockCommand: staleVoteLockCommand,
      recovery: staleVoteRecovery,
      unlockCommand: staleVoteUnlockCommand,
      proof:
        "A stale seeded player page loaded /g/{game} with live WebSocket disabled before LockThread, kept the old vote control, submitted it after the host locked D01, rendered Reject PhaseLocked with stale-projection recovery guidance, refreshed /player-command-state to D01 locked for slot-7, and the host unlocked the phase before the moderator proof continued.",
    },
  };
}

async function submitDuplicatePlayerVote(
  duplicateSession,
  { firstOutcome, commandId, expectedCount = 2 },
) {
  const { page } = duplicateSession;
  await page.evaluate((fixedCommandId) => {
    window.__fmarchPlayerCommandIdFactory = () => fixedCommandId;
  }, commandId);
  const staleButton = page.locator('[data-action="submit_vote"]');
  assertHitTarget(await staleButton.boundingBox(), "duplicate player vote button");
  await staleButton.click();
  const status = page.getByTestId("player-command-status");
  await status.waitFor({ state: "visible" });
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="player-command-status"]')
        ?.getAttribute("data-state") === "ack",
  );
  const outcome = await page.evaluate(() => window.__fmarchPlayerCommandStatus);
  const duplicatePlayerSubmit = assertDuplicatePlayerVoteOutcome({
    firstOutcome,
    duplicateOutcome: outcome,
    commandId,
  });
  const statusMessage = await status.innerText();
  await page.evaluate(() => {
    delete window.__fmarchPlayerCommandIdFactory;
  });
  await page.waitForFunction(
    (count) =>
      window.__fmarchPlayerProjection?.votecount?.some(
        (row) => row.target === "slot_1" && row.count === count,
      ),
    expectedCount,
  );
  return {
    outcome,
    duplicatePlayerSubmit,
    statusMessage,
    projection: await page.evaluate(() => window.__fmarchPlayerProjection),
    receipts: await page.evaluate(() => window.__fmarchPlayerCommandReceipts),
  };
}

async function openStalePlayerVoteBrowser(
  frontendBaseUrl,
  { sessionToken = playerSessionToken, label = "stale vote player" } = {},
) {
  const commandStateRequests = [];
  const commandStateResponses = [];
  const commandStateResponseTasks = [];
  const context = await browser.newContext({ viewport: smokeViewport });
  await context.addInitScript(() => {
    window.WebSocket = undefined;
  });
  context.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith("/player-command-state")) {
      commandStateRequests.push({
        url: request.url(),
        pathname,
        method: request.method(),
      });
    }
  });
  context.on("response", (response) => {
    const pathname = new URL(response.url()).pathname;
    if (!pathname.endsWith("/player-command-state")) {
      return;
    }
    commandStateResponseTasks.push(
      response.json().then((body) => {
        commandStateResponses.push({
          url: response.url(),
          pathname,
          status: response.status(),
          ok: response.ok(),
          actorSlot: body.actor_slot ?? null,
          roleKey: body.role_key ?? null,
          phaseId: body.phase?.phase_id ?? null,
          phaseKind: body.phase?.phase_kind ?? null,
          locked: body.phase?.locked ?? null,
          actions: (body.actions ?? []).map((action) => ({
            templateId: action.template_id,
            targets: action.targets,
            targetOptions: action.target_options,
          })),
          boundary: body.boundary ?? null,
        });
      }),
    );
  });
  await context.addCookies([
    {
      name: "fmarch_session",
      value: sessionToken,
      domain: host,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const page = await context.newPage();
  const pageUrl = `${frontendBaseUrl}/g/${game}`;
  const response = await page.goto(pageUrl, { waitUntil: "networkidle" });
  if (response === null || !response.ok()) {
    throw new Error(
      `${label} route failed with ${response?.status() ?? "no response"}: ${await page.textContent("body")}`,
    );
  }
  await page.getByTestId("player-surface").waitFor({ state: "visible" });
  await page.locator('[data-action="submit_vote"]').waitFor({
    state: "visible",
  });
  return {
    context,
    page,
    commandStateRequests,
    commandStateResponses,
    commandStateResponseTasks,
  };
}

async function submitStalePlayerVote(staleSession) {
  const { page, commandStateRequests, commandStateResponses, commandStateResponseTasks } =
    staleSession;
  const staleButton = page.locator('[data-action="submit_vote"]');
  assertHitTarget(await staleButton.boundingBox(), "stale player vote button");
  await staleButton.click();
  const status = page.getByTestId("player-command-status");
  await status.waitFor({ state: "visible" });
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="player-command-status"]')
        ?.getAttribute("data-state") === "reject",
  );
  const outcome = await page.evaluate(() => window.__fmarchPlayerCommandStatus);
  assertStalePlayerVoteRecovery(outcome);
  const statusMessage = await status.innerText();
  assertStalePlayerVoteRecoveryMessage({
    outcome,
    statusMessage,
  });
  await page.waitForFunction(
    () =>
      window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "D01" &&
      window.__fmarchPlayerProjection?.commandState?.phase?.locked === true,
  );
  await Promise.allSettled(commandStateResponseTasks);
  const lockedCommandState = await waitForCommandStateResponse(
    commandStateResponses,
    (response) =>
      response.ok === true &&
      response.actorSlot === "slot-7" &&
      response.phaseId === "D01" &&
      response.phaseKind === "Day" &&
      response.locked === true,
  );
  return {
    outcome,
    statusMessage,
    commandState: {
      requests: commandStateRequests,
      responses: commandStateResponses,
      lockedCommandState,
    },
    projection: await page.evaluate(() => window.__fmarchPlayerProjection),
    receipts: await page.evaluate(() => window.__fmarchPlayerCommandReceipts),
  };
}

async function drivePlayerActionBrowser(frontendBaseUrl) {
  const commandStateRequests = [];
  const commandStateResponses = [];
  const commandStateResponseTasks = [];
  const context = await browser.newContext({ viewport: smokeViewport });
  context.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith("/player-command-state")) {
      commandStateRequests.push({
        url: request.url(),
        pathname,
        method: request.method(),
      });
    }
  });
  context.on("response", (response) => {
    const pathname = new URL(response.url()).pathname;
    if (!pathname.endsWith("/player-command-state")) {
      return;
    }
    commandStateResponseTasks.push(
      response.json().then((body) => {
        commandStateResponses.push({
          url: response.url(),
          pathname,
          status: response.status(),
          ok: response.ok(),
          actorSlot: body.actor_slot ?? null,
          roleKey: body.role_key ?? null,
          phaseId: body.phase?.phase_id ?? null,
          phaseKind: body.phase?.phase_kind ?? null,
          actions: (body.actions ?? []).map((action) => ({
            templateId: action.template_id,
            targets: action.targets,
            targetOptions: action.target_options,
          })),
          boundary: body.boundary ?? null,
        });
      }),
    );
  });
  await context.addCookies([
    {
      name: "fmarch_session",
      value: actionPlayerSessionToken,
      domain: host,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const page = await context.newPage();
  const pageUrl = `${frontendBaseUrl}/g/${actionGame}`;
  const response = await page.goto(pageUrl, { waitUntil: "networkidle" });
  if (response === null || !response.ok()) {
    throw new Error(
      `action player route failed with ${response?.status() ?? "no response"}: ${await page.textContent("body")}`,
    );
  }

  await page.getByTestId("player-surface").waitFor({ state: "visible" });
  const capability = await page.getByTestId("player-capability").innerText();
  if (!capability.includes("SlotOccupant")) {
    throw new Error(`action player capability did not render SlotOccupant: ${capability}`);
  }
  const actionCommands = page.getByTestId("player-action-commands");
  await actionCommands.waitFor({ state: "visible" });
  if (commandStateResponses.length === 0) {
    const commandStateUrl = `${frontendBaseUrl}/games/${actionGame}/player-command-state?principal_user_id=action-goon&slot_id=slot_4`;
    const response = await context.request.get(commandStateUrl, {
      headers: { accept: "application/json" },
    });
    const body = await response.json();
    commandStateRequests.push({
      url: commandStateUrl,
      pathname: new URL(commandStateUrl).pathname,
      method: "GET",
    });
    commandStateResponses.push({
      url: commandStateUrl,
      pathname: new URL(commandStateUrl).pathname,
      status: response.status(),
      ok: response.ok(),
      actorSlot: body.actor_slot ?? null,
      roleKey: body.role_key ?? null,
      phaseId: body.phase?.phase_id ?? null,
      phaseKind: body.phase?.phase_kind ?? null,
      actions: (body.actions ?? []).map((action) => ({
        templateId: action.template_id,
        targets: action.targets,
        targetOptions: action.target_options,
      })),
      boundary: body.boundary ?? null,
    });
  }
  await Promise.allSettled(commandStateResponseTasks);
  assertPlayerCommandStateEvidence({
    commandStateRequests,
    commandStateResponses,
  });

  const invalidButton = page.locator('[data-action="submit_invalid_action:factional_kill"]');
  assertHitTarget(await invalidButton.boundingBox(), "invalid player action button");
  await invalidButton.click();
  const status = page.getByTestId("player-command-status");
  await status.waitFor({ state: "visible" });
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="player-command-status"]')
        ?.getAttribute("data-state") === "reject",
  );
  const invalidOutcome = await page.evaluate(
    () => window.__fmarchPlayerCommandStatus,
  );
  assertInvalidActionRecovery(invalidOutcome);
  const duplicatePlayerSession = await openStalePlayerActionBrowser(frontendBaseUrl);
  const racePlayerSession = await openStalePlayerActionBrowser(frontendBaseUrl);
  const stalePlayerSession = await openStalePlayerActionBrowser(frontendBaseUrl);

  const duplicatePlayerSubmitCommandId = crypto.randomUUID();
  await page.evaluate((commandId) => {
    window.__fmarchPlayerCommandIdFactory = () => commandId;
  }, duplicatePlayerSubmitCommandId);
  const legalButton = page.locator('[data-action="submit_action:factional_kill"]');
  assertHitTarget(await legalButton.boundingBox(), "legal player action button");
  await legalButton.click();
  await confirmPlayerActionThroughDialog(page, "legal player action confirm");
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="player-command-status"]')
        ?.getAttribute("data-state") === "ack",
  );
  const legalOutcome = await page.evaluate(
    () => window.__fmarchPlayerCommandStatus,
  );
  assertPlayerActionSubmitOutcome(legalOutcome);
  assertPlayerActionCommandId({
    outcome: legalOutcome,
    commandId: duplicatePlayerSubmitCommandId,
    label: "first player SubmitAction",
  });

  const duplicateRetry = await submitDuplicatePlayerAction(duplicatePlayerSession, {
    firstOutcome: legalOutcome,
    commandId: duplicatePlayerSubmitCommandId,
  });
  await page.evaluate(() => {
    delete window.__fmarchPlayerCommandIdFactory;
  });
  const staleSameActionRecovery = await submitRacingPlayerAction(racePlayerSession, {
    winningCommandId: legalOutcome.commandId,
  });

  const actionRows = await runSql(
    smokeDatabase.url,
    `SELECT kind, payload->>'action_id' AS action_id, payload->>'template_id' AS template_id, payload->>'actor' AS actor, payload->'targets' AS targets
     FROM events
     WHERE stream_id = '${actionGame}' AND kind = 'ActionSubmitted'
     ORDER BY stream_seq`,
  );
  if (
    !actionRows.includes("role_factional_kill") ||
    !actionRows.includes("factional_kill") ||
    !actionRows.includes("slot_4") ||
    !actionRows.includes("slot-2") ||
    actionRows.includes("invalid_self_factional_kill")
  ) {
    throw new Error(`action submission audit rows drifted:\n${actionRows}`);
  }
  assertSinglePlayerActionSubmittedRow(actionRows);
  const duplicateReceiptRows = await runSql(
    smokeDatabase.url,
    `SELECT principal_user_id, command_id::text, stream_seqs
     FROM command_receipt
     WHERE principal_user_id = 'action-goon'
       AND command_id = '${duplicatePlayerSubmitCommandId}'::uuid`,
  );
  assertDuplicatePlayerSubmitReceipt({
    commandId: duplicatePlayerSubmitCommandId,
    receiptRows: duplicateReceiptRows,
  });

  const resolveCommand = await sendCommand("host_h", {
    ResolvePhase: { game: actionGame, seed: 918273 },
  });
  await Promise.allSettled(commandStateResponseTasks);
  await page.waitForFunction(
    () => document.querySelector('[data-action="submit_action:factional_kill"]') === null,
  );
  await page.waitForFunction(
    () => document.querySelector('[data-testid="player-action-commands"]') === null,
  );
  const postResolveLockedCommandState = await waitForCommandStateResponse(
    commandStateResponses,
    (response) =>
      response.ok === true &&
      response.actorSlot === "slot_4" &&
      response.phaseId === "N01" &&
      response.phaseKind === "Night" &&
      response.actions.length === 0,
  );
  await stalePlayerSession.page
    .locator('[data-action="submit_action:factional_kill"]')
    .waitFor({ state: "visible" });
  const staleActionRecovery = await submitStalePlayerAction(stalePlayerSession);
  const advanceCommand = await sendCommand("host_h", {
    AdvancePhase: { game: actionGame },
  });
  const postAdvanceCommandState = await waitForCommandStateResponse(
    commandStateResponses,
    (response) =>
      response.ok === true &&
      response.actorSlot === "slot_4" &&
      response.phaseId === "D02" &&
      response.phaseKind === "Day" &&
      response.actions.length === 0,
  );
  await page.waitForFunction(() =>
    document
      .querySelector('[data-testid="player-votecount-deadline"]')
      ?.innerText.includes("Day 2"),
  );
  const postAdvancePhaseText = await page
    .getByTestId("player-votecount-deadline")
    .innerText();
  const actionGameHostState = await fetchJson(
    `${apiBaseUrl}/games/${actionGame}/host-console-state?principal_user_id=host_h&slot_id=slot-2`,
  );
  const targetSlot = actionGameHostState.slots?.find(
    (slot) => slot.slot_id === "slot-2",
  );
  if (targetSlot?.alive !== false || targetSlot.status !== "dead") {
    throw new Error(
      `resolved factional kill did not kill slot-2: ${JSON.stringify(actionGameHostState.slots)}`,
    );
  }
  const resolutionRows = await runSql(
    smokeDatabase.url,
    `SELECT kind FROM events WHERE stream_id = '${actionGame}' AND kind IN ('ResolutionApplied', 'ResolutionTrace') ORDER BY stream_seq`,
  );
  if (
    !resolutionRows.includes("ResolutionApplied") ||
    !resolutionRows.includes("ResolutionTrace")
  ) {
    throw new Error(`action resolution rows missing:\n${resolutionRows}`);
  }

  const projection = await page.evaluate(() => window.__fmarchPlayerProjection);
  const receipts = await page.evaluate(() => window.__fmarchPlayerCommandReceipts);
  await duplicatePlayerSession.context.close();
  await racePlayerSession.context.close();
  await stalePlayerSession.context.close();
  await context.close();
  return {
    url: pageUrl,
    game: actionGame,
    capability,
    invalidOutcome,
    legalOutcome,
    duplicateLegalOutcome: duplicateRetry.outcome,
    duplicatePlayerSubmit: {
      ...duplicateRetry.duplicatePlayerSubmit,
      statusMessage: duplicateRetry.statusMessage,
      receiptRows: duplicateReceiptRows,
      commandState: duplicateRetry.commandState,
    },
    staleSameActionRecovery,
    staleActionRecovery,
    commandState: {
      requests: commandStateRequests,
      responses: commandStateResponses,
    },
    actionRows,
    resolveCommand,
    advanceCommand,
    resolvedTargetSlot: targetSlot,
    resolutionRows,
    postResolveLockedCommandState,
    postAdvanceCommandState,
    postAdvancePhaseText,
    projection,
    receipts,
    proof:
      "A seeded mafiascum N01 game exposed the goon at /g/{game} with a SlotOccupant session, the browser loaded /player-command-state from the Rust API, rendered the returned phase-valid factional_kill action, clicked a typed invalid SubmitAction and recovered through a rendered Reject, clicked the legal action and received an ACK, then a stale second player page retried the legal action with the same command_id through the player route, received the original ACK stream seqs from command_receipt, and refreshed to N01/no-actions. A stale third player page submitted the same action with a distinct command_id and rendered ActionAlreadySubmitted recovery guidance while refreshing to N01/no-actions. The proof left exactly one ActionSubmitted row. The host then resolved that stored action through Command::ResolvePhase into a dead target slot plus ResolutionApplied/ResolutionTrace rows. A fourth stale player page with its live websocket blocked kept the old factional_kill control, submitted it after resolution, rendered Reject PhaseLocked with stale-projection recovery guidance, refreshed /player-command-state to locked N01/no-actions, and removed the stale action controls without a page reload. The live hydrated player page then refreshed /player-command-state to locked N01/no-actions and to D02/Day after Command::AdvancePhase.",
  };
}

async function openStalePlayerActionBrowser(frontendBaseUrl) {
  const commandStateRequests = [];
  const commandStateResponses = [];
  const commandStateResponseTasks = [];
  const context = await browser.newContext({ viewport: smokeViewport });
  await context.addInitScript(() => {
    window.WebSocket = undefined;
  });
  context.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith("/player-command-state")) {
      commandStateRequests.push({
        url: request.url(),
        pathname,
        method: request.method(),
      });
    }
  });
  context.on("response", (response) => {
    const pathname = new URL(response.url()).pathname;
    if (!pathname.endsWith("/player-command-state")) {
      return;
    }
    commandStateResponseTasks.push(
      response.json().then((body) => {
        commandStateResponses.push({
          url: response.url(),
          pathname,
          status: response.status(),
          ok: response.ok(),
          actorSlot: body.actor_slot ?? null,
          roleKey: body.role_key ?? null,
          phaseId: body.phase?.phase_id ?? null,
          phaseKind: body.phase?.phase_kind ?? null,
          locked: body.phase?.locked ?? null,
          actions: (body.actions ?? []).map((action) => ({
            templateId: action.template_id,
            targets: action.targets,
            targetOptions: action.target_options,
          })),
          boundary: body.boundary ?? null,
        });
      }),
    );
  });
  await context.addCookies([
    {
      name: "fmarch_session",
      value: actionPlayerSessionToken,
      domain: host,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const page = await context.newPage();
  const pageUrl = `${frontendBaseUrl}/g/${actionGame}`;
  const response = await page.goto(pageUrl, { waitUntil: "networkidle" });
  if (response === null || !response.ok()) {
    throw new Error(
      `stale action player route failed with ${response?.status() ?? "no response"}: ${await page.textContent("body")}`,
    );
  }
  await page.getByTestId("player-surface").waitFor({ state: "visible" });
  await page.locator('[data-action="submit_action:factional_kill"]').waitFor({
    state: "visible",
  });
  return {
    context,
    page,
    commandStateRequests,
    commandStateResponses,
    commandStateResponseTasks,
  };
}

async function confirmPlayerActionThroughDialog(page, label) {
  const confirmButton = page.locator(
    '[data-testid="player-action-confirm-factional_kill"]',
  );
  await confirmButton.waitFor({ state: "visible" });
  assertHitTarget(await confirmButton.boundingBox(), label);
  await confirmButton.click();
}

async function submitStalePlayerAction(staleSession) {
  const { page, commandStateRequests, commandStateResponses, commandStateResponseTasks } =
    staleSession;
  const staleButton = page.locator('[data-action="submit_action:factional_kill"]');
  assertHitTarget(await staleButton.boundingBox(), "stale player action button");
  await staleButton.click();
  await confirmPlayerActionThroughDialog(page, "stale player action confirm");
  const status = page.getByTestId("player-command-status");
  await status.waitFor({ state: "visible" });
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="player-command-status"]')
        ?.getAttribute("data-state") === "reject",
  );
  const outcome = await page.evaluate(() => window.__fmarchPlayerCommandStatus);
  assertStalePlayerActionRecovery(outcome);
  const statusMessage = await status.innerText();
  assertStalePlayerActionRecoveryMessage({
    outcome,
    statusMessage,
  });
  await page.waitForFunction(
    () =>
      window.__fmarchPlayerProjection?.commandState?.phase?.locked === true &&
      window.__fmarchPlayerProjection?.commandState?.actions?.length === 0,
  );
  await page.waitForFunction(
    () => document.querySelector('[data-action="submit_action:factional_kill"]') === null,
  );
  await page.waitForFunction(
    () => document.querySelector('[data-testid="player-action-commands"]') === null,
  );
  await Promise.allSettled(commandStateResponseTasks);
  const lockedCommandState = await waitForCommandStateResponse(
    commandStateResponses,
    (response) =>
      response.ok === true &&
      response.actorSlot === "slot_4" &&
      response.phaseId === "N01" &&
      response.phaseKind === "Night" &&
      response.locked === true &&
      response.actions.length === 0,
  );
  return {
    outcome,
    statusMessage,
    commandState: {
      requests: commandStateRequests,
      responses: commandStateResponses,
      lockedCommandState,
    },
    projection: await page.evaluate(() => window.__fmarchPlayerProjection),
    receipts: await page.evaluate(() => window.__fmarchPlayerCommandReceipts),
  };
}

async function submitDuplicatePlayerAction(duplicateSession, { firstOutcome, commandId }) {
  const { page, commandStateRequests, commandStateResponses, commandStateResponseTasks } =
    duplicateSession;
  await page.evaluate((fixedCommandId) => {
    window.__fmarchPlayerCommandIdFactory = () => fixedCommandId;
  }, commandId);
  const staleButton = page.locator('[data-action="submit_action:factional_kill"]');
  assertHitTarget(await staleButton.boundingBox(), "duplicate player action button");
  await staleButton.click();
  await confirmPlayerActionThroughDialog(page, "duplicate player action confirm");
  const status = page.getByTestId("player-command-status");
  await status.waitFor({ state: "visible" });
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="player-command-status"]')
        ?.getAttribute("data-state") === "ack",
  );
  const outcome = await page.evaluate(() => window.__fmarchPlayerCommandStatus);
  assertPlayerActionSubmitOutcome(outcome);
  const duplicatePlayerSubmit = assertDuplicatePlayerSubmitOutcome({
    firstOutcome,
    duplicateOutcome: outcome,
    commandId,
  });
  const statusMessage = await status.innerText();
  await page.evaluate(() => {
    delete window.__fmarchPlayerCommandIdFactory;
  });
  await page.waitForFunction(
    () =>
      window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "N01" &&
      window.__fmarchPlayerProjection?.commandState?.phase?.locked === false &&
      window.__fmarchPlayerProjection?.commandState?.actions?.length === 0,
  );
  await page.waitForFunction(
    () => document.querySelector('[data-action="submit_action:factional_kill"]') === null,
  );
  // C5: while the phase is still open, a submitted night action stays visible as a
  // withdraw affordance (the submit control is replaced, the picker persists), so the
  // command surface is not empty — it now offers withdraw_action instead of submit.
  await page.waitForFunction(
    () =>
      document.querySelector('[data-action="withdraw_action:factional_kill"]') !== null,
  );
  await Promise.allSettled(commandStateResponseTasks);
  const noActionCommandState = await waitForCommandStateResponse(
    commandStateResponses,
    (response) =>
      response.ok === true &&
      response.actorSlot === "slot_4" &&
      response.phaseId === "N01" &&
      response.phaseKind === "Night" &&
      response.locked === false &&
      response.actions.length === 0,
  );
  return {
    outcome,
    duplicatePlayerSubmit,
    statusMessage,
    commandState: {
      requests: commandStateRequests,
      responses: commandStateResponses,
      noActionCommandState,
    },
    projection: await page.evaluate(() => window.__fmarchPlayerProjection),
    receipts: await page.evaluate(() => window.__fmarchPlayerCommandReceipts),
  };
}

async function submitRacingPlayerAction(raceSession, { winningCommandId }) {
  const { page, commandStateRequests, commandStateResponses, commandStateResponseTasks } =
    raceSession;
  const staleButton = page.locator('[data-action="submit_action:factional_kill"]');
  assertHitTarget(await staleButton.boundingBox(), "racing player action button");
  await staleButton.click();
  await confirmPlayerActionThroughDialog(page, "racing player action confirm");
  const status = page.getByTestId("player-command-status");
  await status.waitFor({ state: "visible" });
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="player-command-status"]')
        ?.getAttribute("data-state") === "reject",
  );
  const outcome = await page.evaluate(() => window.__fmarchPlayerCommandStatus);
  assertStaleSameActionRecovery({ outcome, winningCommandId });
  const statusMessage = await status.innerText();
  assertStaleSameActionRecoveryMessage({ outcome, statusMessage });
  await page.waitForFunction(
    () =>
      window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "N01" &&
      window.__fmarchPlayerProjection?.commandState?.phase?.locked === false &&
      window.__fmarchPlayerProjection?.commandState?.actions?.length === 0,
  );
  await page.waitForFunction(
    () => document.querySelector('[data-action="submit_action:factional_kill"]') === null,
  );
  // C5: while the phase is still open, a submitted night action stays visible as a
  // withdraw affordance (the submit control is replaced, the picker persists), so the
  // command surface is not empty — it now offers withdraw_action instead of submit.
  await page.waitForFunction(
    () =>
      document.querySelector('[data-action="withdraw_action:factional_kill"]') !== null,
  );
  await Promise.allSettled(commandStateResponseTasks);
  const noActionCommandState = await waitForCommandStateResponse(
    commandStateResponses,
    (response) =>
      response.ok === true &&
      response.actorSlot === "slot_4" &&
      response.phaseId === "N01" &&
      response.phaseKind === "Night" &&
      response.locked === false &&
      response.actions.length === 0,
  );
  return {
    outcome,
    statusMessage,
    commandState: {
      requests: commandStateRequests,
      responses: commandStateResponses,
      noActionCommandState,
    },
    projection: await page.evaluate(() => window.__fmarchPlayerProjection),
    receipts: await page.evaluate(() => window.__fmarchPlayerCommandReceipts),
  };
}

async function openModeratorBrowser(frontendBaseUrl) {
  const context = await browser.newContext({ viewport: smokeViewport });
  await context.addCookies([
    {
      name: "fmarch_session",
      value: hostSessionToken,
      domain: host,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const page = await context.newPage();
  const pageUrl = `${frontendBaseUrl}/g/${game}/host`;
  const response = await page.goto(pageUrl, { waitUntil: "networkidle" });
  if (response === null || !response.ok()) {
    throw new Error(
      `host console route failed with ${response?.status() ?? "no response"}: ${await page.textContent("body")}`,
    );
  }
  await page.getByTestId("host-console-votecount").waitFor({ state: "visible" });
  return { context, page, pageUrl };
}

async function driveModeratorBrowser(
  { page, pageUrl },
  { frontendBaseUrl, rolePmHistory },
) {
  const phaseControlEvidence = await driveHostPhaseControlsBrowser(page, pageUrl);
  const streamConflictEvidence = await driveHostStreamConflictBrowser(page);
  const actionEvidence = [];
  let stalePlayerInviteSession = null;
  let stalePlayerInviteBefore = null;
  for (const expected of [
    { id: "extend_deadline", status: "ack" },
    { id: "process_replacement", status: "ack" },
  ]) {
    if (expected.id === "process_replacement") {
      stalePlayerInviteSession = await openStaleModeratorBrowser(pageUrl);
      stalePlayerInviteBefore = await readPlayerInviteTarget(stalePlayerInviteSession.page);
      if (
        !stalePlayerInviteBefore.targetLabel.includes("Slot 7") ||
        !stalePlayerInviteBefore.targetLabel.includes("player-mira") ||
        stalePlayerInviteBefore.principalUserId !== "player-mira" ||
        stalePlayerInviteBefore.expectedOccupantUserId !== "player-mira"
      ) {
        throw new Error(
          `stale player invite fixture was not pre-replacement: ${JSON.stringify(stalePlayerInviteBefore)}`,
        );
      }
    }
    const actionRoot = page.getByTestId(`critical-host-action-${expected.id}`);
    const trigger = actionRoot.getByTestId("critical-host-action-trigger");
    await trigger.waitFor({ state: "visible" });
    const triggerBox = await trigger.boundingBox();
    assertHitTarget(triggerBox, `${expected.id} trigger`);
    await trigger.click();

    const confirmation = actionRoot.getByTestId(
      "critical-host-action-confirmation",
    );
    await confirmation.waitFor({ state: "visible" });
    const confirmationMessage = await actionRoot
      .getByTestId("critical-host-action-confirmation-message")
      .innerText();

    const confirm = actionRoot.getByTestId("critical-host-action-confirm");
    const confirmBox = await confirm.boundingBox();
    assertHitTarget(confirmBox, `${expected.id} confirm`);
    await confirm.click();

    const status = page.getByTestId(`host-command-status-${expected.id}`);
    await status.waitFor({ state: "visible" });
    await page.waitForFunction(
      ({ actionId, expectedStatus }) =>
        document
          .querySelector(`[data-testid="host-command-status-${actionId}"]`)
          ?.getAttribute("data-state") === expectedStatus,
      { actionId: expected.id, expectedStatus: expected.status },
    );
    if (expected.id === "extend_deadline") {
      await waitForHostConsoleDeadlineDelta(page, 1781928000);
    }
    if (expected.id === "process_replacement") {
      await waitForHostConsoleReplacementDelta(page, "player-rowan");
    }

    actionEvidence.push({
      ...expected,
      triggerBox,
      confirmBox,
      confirmationMessage,
      statusMessage: await status.innerText(),
    });
  }

  const deadlineLabel = await page.getByTestId("host-console-deadline").innerText();
  const occupantLabel = await page
    .getByTestId("host-console-slot-occupant")
    .innerText();
  const historyLabel = await page.getByTestId("host-console-history").innerText();
  if (!deadlineLabel.includes("Jun 19, 2026") || !deadlineLabel.includes("9:00 PM")) {
    throw new Error(`deadline label did not update from real API: ${deadlineLabel}`);
  }
  if (occupantLabel !== "player-rowan") {
    throw new Error(`replacement occupant did not update from real API: ${occupantLabel}`);
  }
  if (!historyLabel.includes("slot-7")) {
    throw new Error(`slot history label did not preserve slot id: ${historyLabel}`);
  }
  const livePlayerInvite = await readPlayerInviteTarget(page);
  if (
    !livePlayerInvite.targetLabel.includes("Slot 7") ||
    !livePlayerInvite.targetLabel.includes("player-rowan") ||
    livePlayerInvite.principalUserId !== "player-rowan" ||
    livePlayerInvite.expectedOccupantUserId !== "player-rowan"
  ) {
    throw new Error(
      `player invite target did not follow replacement projection: ${JSON.stringify({
        livePlayerInvite,
      })}`,
    );
  }
  const stalePlayerInviteReject =
    stalePlayerInviteSession === null
      ? null
      : await rejectStalePlayerInviteFromBrowser(stalePlayerInviteSession.page);
  await stalePlayerInviteSession?.context.close();
  const apiStateBeforePrompt = await fetchJson(
    `${apiBaseUrl}/games/${game}/host-console-state?principal_user_id=host_h&slot_id=slot-7`,
  );
  const rolePmReplacement = await driveRolePmReplacementBrowser(
    frontendBaseUrl,
    rolePmHistory,
  );

  const hostPromptIssueCommands = await issueBelovedPrincessPrompt();
  await waitForHostPromptDelta(page, "pending");
  const hostPromptEvidence = await resolveHostPromptFromBrowser(page);
  const slotLifecycleEvidence = await modkillSlotFromBrowser(page);

  const evidence = {
    url: pageUrl,
    actions: actionEvidence,
    phaseControls: phaseControlEvidence,
    streamConflict: streamConflictEvidence,
    playerInviteTarget: {
      status: "passed",
      source: "host-console-state projection",
      targetLabel: livePlayerInvite.targetLabel,
      principalUserId: livePlayerInvite.principalUserId,
      expectedOccupantUserId: livePlayerInvite.expectedOccupantUserId,
    },
    stalePlayerInviteReject,
    rolePmReplacement,
    hostPrompt: {
      issueCommands: hostPromptIssueCommands,
      ...hostPromptEvidence,
    },
    slotLifecycle: slotLifecycleEvidence,
    liveProjectionEvents: await page.evaluate(
      () => window.__fmarchHostLiveProjectionEvents,
    ),
    votecountProjection: await page.evaluate(
      () => window.__fmarchHostVotecountProjection,
    ),
    projectionLabels: {
      deadlineLabel,
      occupantLabel,
      historyLabel,
    },
    apiStateBeforePrompt,
  };
  return evidence;
}

async function driveHostStreamConflictBrowser(page) {
  await installDeadlineStreamConflictTrigger();
  const projectionRequests = [];
  const onRequest = (request) => {
    const pathname = new URL(request.url()).pathname;
    if (
      pathname.endsWith("/host-console-state") ||
      pathname.endsWith("/votecount") ||
      pathname.endsWith("/day-vote-outcomes") ||
      pathname.endsWith("/host-prompts")
    ) {
      projectionRequests.push({
        url: request.url(),
        pathname,
        method: request.method(),
      });
    }
  };
  page.on("request", onRequest);
  try {
    const conflictEvidence = await confirmHostAction(page, "extend_deadline", "reject");
    assertHostStreamConflictRecovery(conflictEvidence.commandStatus);
    await page.waitForFunction(() =>
      window.__fmarchHostCommandDispatchBridgePlan?.projectionRefreshKeys?.join(",") ===
      "host,votecount,dayVoteOutcomes,hostPrompts",
    );
    await waitForProjectionRequests(projectionRequests, [
      "/host-console-state",
      "/votecount",
      "/day-vote-outcomes",
      "/host-prompts",
    ]);
    return {
      ...conflictEvidence,
      projectionRefreshRequests: projectionRequests,
      dispatchBridgePlan: await page.evaluate(
        () => window.__fmarchHostCommandDispatchBridgePlan,
      ),
      proof:
        "The live host page hit a scratch-DB forced same-stream append conflict through the real ExtendDeadline control, rendered retryable Reject StreamConflict copy with reload-and-retry guidance, and refreshed host, votecount, day-vote-outcome, and host-prompt projections before the normal retry path.",
    };
  } finally {
    page.off("request", onRequest);
    await dropDeadlineStreamConflictTrigger();
  }
}

async function installDeadlineStreamConflictTrigger() {
  await runSql(
    smokeDatabase.url,
    `
    CREATE OR REPLACE FUNCTION test_force_deadline_stream_conflict() RETURNS trigger AS $$
    BEGIN
      IF NEW.stream_id = ${sqlLiteral(game)}::uuid AND NEW.kind = 'DeadlineExtended' THEN
        INSERT INTO events
          (stream_id, stream_seq, kind, version, payload, actor, occurred_at, causation_id, meta)
        VALUES
          (
            NEW.stream_id,
            NEW.stream_seq,
            'ThreadUnlocked',
            1,
            '{"channel_id":"main","source":"forced_stream_conflict"}'::jsonb,
            NEW.actor,
            NEW.occurred_at,
            NEW.causation_id,
            NEW.meta
          );
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS test_force_deadline_stream_conflict ON events;
    CREATE TRIGGER test_force_deadline_stream_conflict
      BEFORE INSERT ON events
      FOR EACH ROW EXECUTE FUNCTION test_force_deadline_stream_conflict();
    `,
  );
}

async function dropDeadlineStreamConflictTrigger() {
  await runSql(
    smokeDatabase.url,
    `
    DROP TRIGGER IF EXISTS test_force_deadline_stream_conflict ON events;
    DROP FUNCTION IF EXISTS test_force_deadline_stream_conflict();
    `,
  );
}

async function installVoteInsertDelayTrigger() {
  await runSql(
    smokeDatabase.url,
    `
    CREATE OR REPLACE FUNCTION test_delay_vote_insert() RETURNS trigger AS $$
    BEGIN
      IF NEW.stream_id = ${sqlLiteral(game)}::uuid AND NEW.kind = 'VoteSubmitted' THEN
        PERFORM pg_sleep(0.35);
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS test_delay_vote_insert ON events;
    CREATE TRIGGER test_delay_vote_insert
      BEFORE INSERT ON events
      FOR EACH ROW EXECUTE FUNCTION test_delay_vote_insert();
    `,
  );
}

async function dropVoteInsertDelayTrigger() {
  await runSql(
    smokeDatabase.url,
    `
    DROP TRIGGER IF EXISTS test_delay_vote_insert ON events;
    DROP FUNCTION IF EXISTS test_delay_vote_insert();
    `,
  );
}

async function driveHostPhaseControlsBrowser(page, pageUrl) {
  const staleSession = await openStaleModeratorBrowser(pageUrl);
  await expectHostPhaseActions(page, ["resolve_phase", "lock_thread"]);
  await expectHostPhaseActions(staleSession.page, ["resolve_phase", "lock_thread"]);
  const lockEvidence = await confirmHostAction(page, "lock_thread");
  await waitForHostConsolePhaseLocked(page, true);
  await expectHostPhaseActions(page, ["unlock_thread", "advance_phase"]);
  await expectHostPhaseActions(staleSession.page, ["resolve_phase", "lock_thread"]);
  const staleLockEvidence = await confirmHostAction(
    staleSession.page,
    "lock_thread",
    "reject",
  );
  await waitForHostProjectionPhaseLocked(staleSession.page, true);
  await expectHostPhaseActions(staleSession.page, ["unlock_thread", "advance_phase"]);
  const unlockEvidence = await confirmHostAction(page, "unlock_thread");
  await waitForHostConsolePhaseLocked(page, false);
  await expectHostPhaseActions(page, ["resolve_phase", "lock_thread"]);
  await staleSession.context.close();

  return {
    initialActions: ["resolve_phase", "lock_thread"],
    lockedActions: ["unlock_thread", "advance_phase"],
    staleActionsBeforeReject: ["resolve_phase", "lock_thread"],
    staleActionsAfterRejectRefresh: ["unlock_thread", "advance_phase"],
    restoredActions: ["resolve_phase", "lock_thread"],
    lock: lockEvidence,
    staleLockReject: staleLockEvidence,
    unlock: unlockEvidence,
    proof:
      "The hydrated host route rendered phase controls from projected host phase state: open D01 showed Resolve and Lock, LockThread ACK refreshed the live page to locked controls with Unlock and Advance, a second stale host page with its live websocket blocked submitted the old Lock control and recovered through a rendered Reject PhaseLocked plus host projection refresh to Unlock/Advance, and UnlockThread ACK restored Resolve and Lock without a page reload.",
  };
}

async function openStaleModeratorBrowser(pageUrl) {
  const context = await browser.newContext({ viewport: smokeViewport });
  await context.addInitScript(() => {
    window.WebSocket = undefined;
  });
  await context.addCookies([
    {
      name: "fmarch_session",
      value: hostSessionToken,
      domain: host,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const page = await context.newPage();
  const response = await page.goto(pageUrl, { waitUntil: "networkidle" });
  if (response === null || !response.ok()) {
    throw new Error(
      `stale host console route failed with ${response?.status() ?? "no response"}: ${await page.textContent("body")}`,
    );
  }
  await page.getByTestId("host-console-votecount").waitFor({ state: "visible" });
  return { context, page };
}

async function readPlayerInviteTarget(page) {
  return {
    targetLabel: await page.getByTestId("host-player-invite-target").innerText(),
    principalUserId: await page
      .getByTestId("host-player-invite-panel")
      .locator('input[name="principalUserId"]')
      .inputValue(),
    slotId: await page
      .getByTestId("host-player-invite-panel")
      .locator('input[name="slotId"]')
      .inputValue(),
    expectedOccupantUserId: await page
      .getByTestId("host-player-invite-panel")
      .locator('input[name="expectedOccupantUserId"]')
      .inputValue(),
  };
}

async function rejectStalePlayerInviteFromBrowser(page) {
  const beforeSubmit = await readPlayerInviteTarget(page);
  const invitedAccountId = `player-rowan-${game}@example.test`;
  await createAuthAccount({
    accountId: invitedAccountId,
    password: `replacement account password ${crypto.randomUUID()}`,
    principalUserId: "player-rowan",
  });
  await page.getByTestId("host-player-invite-account").fill(invitedAccountId);
  const submit = page.getByTestId("host-player-invite-submit");
  const submitBox = await submit.boundingBox();
  assertHitTarget(submitBox, "stale player invite submit");
  await submit.click();
  const status = page.getByTestId("host-player-invite-status");
  try {
    await status.waitFor({ state: "visible" });
  } catch (error) {
    const diagnostic = {
      url: page.url(),
      title: await page.title(),
      body: (await page.locator("body").innerText()).slice(0, 4_000),
      beforeSubmit,
    };
    throw new Error(
      `stale player invite status did not render: ${JSON.stringify(diagnostic)}`,
      { cause: error },
    );
  }
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="host-player-invite-status"]')
        ?.getAttribute("data-state") === "reject",
  );
  const message = await status.innerText();
  if (!message.includes("Invite target is stale") || !message.includes("player-rowan")) {
    throw new Error(`stale player invite rejection copy was not specific: ${message}`);
  }
  if ((await page.getByTestId("host-player-invite-url").count()) !== 0) {
    throw new Error("stale player invite rendered an invite URL");
  }
  const retry = page.getByTestId("host-player-invite-retry-submit");
  await retry.waitFor({ state: "visible" });
  const retryBox = await retry.boundingBox();
  assertHitTarget(retryBox, "stale player invite retry submit");
  const retryTarget = {
    principalUserId: await page
      .getByTestId("host-player-invite-retry")
      .locator('input[name="principalUserId"]')
      .inputValue(),
    slotId: await page
      .getByTestId("host-player-invite-retry")
      .locator('input[name="slotId"]')
      .inputValue(),
    expectedOccupantUserId: await page
      .getByTestId("host-player-invite-retry")
      .locator('input[name="expectedOccupantUserId"]')
      .inputValue(),
  };
  if (
    retryTarget.principalUserId !== "player-rowan" ||
    retryTarget.expectedOccupantUserId !== "player-rowan" ||
    retryTarget.slotId !== "slot-7"
  ) {
    throw new Error(
      `stale player invite retry did not target current occupant: ${JSON.stringify(retryTarget)}`,
    );
  }
  await page.getByTestId("host-player-invite-retry-account").fill(invitedAccountId);
  await retry.click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="host-player-invite-status"]')
        ?.getAttribute("data-state") === "ack",
  );
  const retryMessage = await status.innerText();
  const retryLoginUrl = await page.getByTestId("host-player-invite-url").innerText();
  if (!retryLoginUrl.includes("player-")) {
    throw new Error(
      `stale player invite retry did not render a player invite URL: ${retryLoginUrl}`,
    );
  }
  return {
    state: "recovered",
    beforeSubmit,
    reject: {
      state: "reject",
      submitBox,
      message,
      urlRendered: false,
    },
    retry: {
      state: "ack",
      submitBox: retryBox,
      target: retryTarget,
      message: retryMessage,
      loginUrl: retryLoginUrl,
    },
  };
}

async function confirmHostAction(page, actionId, expectedState = "ack") {
  const actionRoot = page.getByTestId(`critical-host-action-${actionId}`);
  const trigger = actionRoot.getByTestId("critical-host-action-trigger");
  await trigger.waitFor({ state: "visible" });
  const triggerBox = await trigger.boundingBox();
  assertHitTarget(triggerBox, `${actionId} trigger`);
  await trigger.click();

  const confirmation = actionRoot.getByTestId("critical-host-action-confirmation");
  await confirmation.waitFor({ state: "visible" });
  const confirmationMessage = await actionRoot
    .getByTestId("critical-host-action-confirmation-message")
    .innerText();
  const confirm = actionRoot.getByTestId("critical-host-action-confirm");
  const confirmBox = await confirm.boundingBox();
  assertHitTarget(confirmBox, `${actionId} confirm`);
  await confirm.click();

  await page.waitForFunction(
    ({ expectedActionId, state }) =>
      window.__fmarchHostCommandStatuses?.[expectedActionId]?.state === state,
    { expectedActionId: actionId, state: expectedState },
  );
  const commandStatus = await page.evaluate(
    (expectedActionId) => window.__fmarchHostCommandStatuses?.[expectedActionId],
    actionId,
  );
  return {
    actionId,
    triggerBox,
    confirmBox,
    confirmationMessage,
    statusMessage: commandStatus?.message ?? "",
    commandStatus,
  };
}

async function expectHostPhaseActions(page, expectedActions) {
  try {
    await page.waitForFunction((expected) => {
      const phaseGroup = document.querySelector('[data-testid="moderator-control-phase"]');
      if (phaseGroup === null) {
        return false;
      }
      const actual = [...phaseGroup.querySelectorAll('[data-testid^="critical-host-action-"]')]
        .map((node) => node.getAttribute("data-testid")?.replace("critical-host-action-", ""))
        .filter((id) =>
          id !== undefined &&
          !["trigger", "confirmation", "confirmation-message", "confirm", "cancel"].includes(id),
        )
        .sort();
      return JSON.stringify(actual) === JSON.stringify([...expected].sort());
    }, expectedActions);
  } catch (error) {
    const debug = await page.evaluate(() => {
      const phaseGroup = document.querySelector('[data-testid="moderator-control-phase"]');
      return {
        phaseGroupText: phaseGroup?.innerText ?? null,
        actions: phaseGroup === null
          ? []
          : [...phaseGroup.querySelectorAll('[data-testid^="critical-host-action-"]')]
              .map((node) => node.getAttribute("data-testid")?.replace("critical-host-action-", ""))
              .filter((id) =>
                id !== undefined &&
                !["trigger", "confirmation", "confirmation-message", "confirm", "cancel"].includes(id),
              )
              .sort(),
        projection: window.__fmarchHostProjection,
      };
    });
    throw new Error(
      `host phase actions did not match ${JSON.stringify(expectedActions)}: ${JSON.stringify(debug)}`,
    );
  }
}

async function issueBelovedPrincessPrompt() {
  const commands = [];
  for (const [principal, command] of [
    [
      "player-target",
      {
        SubmitVote: {
          game,
          actor_slot: "slot-2",
          target: { Slot: "slot_1" },
        },
      },
    ],
    [
      "player-seed",
      {
        SubmitVote: {
          game,
          actor_slot: "slot-3",
          target: { Slot: "slot_1" },
        },
      },
    ],
    [
      "player-goon-a",
      {
        SubmitVote: {
          game,
          actor_slot: "slot_4",
          target: { Slot: "slot_1" },
        },
      },
    ],
    [
      "player-goon-b",
      {
        SubmitVote: {
          game,
          actor_slot: "slot_5",
          target: { Slot: "slot_1" },
        },
      },
    ],
    ["host_h", { ResolvePhase: { game, seed: 7421 } }],
  ]) {
    commands.push(await sendCommand(principal, command));
  }
  return commands;
}

async function resolveHostPromptFromBrowser(page) {
  const actionId = "resolve_host_prompt-D01-skip_next_day-slot_1";
  const actionRoot = page.getByTestId(`critical-host-action-${actionId}`);
  const trigger = actionRoot.getByTestId("critical-host-action-trigger");
  await trigger.waitFor({ state: "visible" });
  const triggerBox = await trigger.boundingBox();
  assertHitTarget(triggerBox, `${actionId} trigger`);
  await trigger.click();

  const confirmation = actionRoot.getByTestId("critical-host-action-confirmation");
  await confirmation.waitFor({ state: "visible" });
  const confirmationMessage = await actionRoot
    .getByTestId("critical-host-action-confirmation-message")
    .innerText();
  if (!confirmationMessage.includes("skip_next_day")) {
    throw new Error(`host prompt confirmation did not name prompt: ${confirmationMessage}`);
  }

  const confirm = actionRoot.getByTestId("critical-host-action-confirm");
  const confirmBox = await confirm.boundingBox();
  assertHitTarget(confirmBox, `${actionId} confirm`);
  await confirm.click();

  await page.waitForFunction(
    (expectedActionId) =>
      window.__fmarchHostCommandStatuses?.[expectedActionId]?.state === "ack",
    actionId,
  );
  await waitForHostPromptDelta(page, "resolved");
  await page.waitForFunction(
    (expectedActionId) =>
      document.querySelector(`[data-testid="critical-host-action-${expectedActionId}"]`) ===
      null,
    actionId,
  );

  return {
    actionId,
    triggerBox,
    confirmBox,
    confirmationMessage,
    commandStatus: await page.evaluate(
      (expectedActionId) => window.__fmarchHostCommandStatuses?.[expectedActionId],
      actionId,
    ),
    promptsProjection: await page.evaluate(
      () => window.__fmarchHostPromptsProjection,
    ),
  };
}

async function modkillSlotFromBrowser(page) {
  const actionId = "modkill_slot";
  const actionRoot = page.getByTestId(`critical-host-action-${actionId}`);
  const trigger = actionRoot.getByTestId("critical-host-action-trigger");
  await trigger.waitFor({ state: "visible" });
  const triggerBox = await trigger.boundingBox();
  assertHitTarget(triggerBox, `${actionId} trigger`);
  await trigger.click();

  const confirmation = actionRoot.getByTestId("critical-host-action-confirmation");
  await confirmation.waitFor({ state: "visible" });
  const confirmationMessage = await actionRoot
    .getByTestId("critical-host-action-confirmation-message")
    .innerText();
  if (!confirmationMessage.includes("modkilled")) {
    throw new Error(`modkill confirmation did not name lifecycle: ${confirmationMessage}`);
  }

  const confirm = actionRoot.getByTestId("critical-host-action-confirm");
  const confirmBox = await confirm.boundingBox();
  assertHitTarget(confirmBox, `${actionId} confirm`);
  await confirm.click();

  await page.waitForFunction(
    (expectedActionId) =>
      window.__fmarchHostCommandStatuses?.[expectedActionId]?.state === "ack",
    actionId,
  );
  const commandStatus = await page.evaluate(
    (expectedActionId) => window.__fmarchHostCommandStatuses?.[expectedActionId],
    actionId,
  );
  const statusMessage = commandStatus?.message ?? "";
  await waitForHostConsoleSlotStatusDelta(page, {
    slotId: "slot-7",
    status: "modkilled",
  });
  await page.waitForFunction(() => {
    const replacement = window.__fmarchHostProjection?.replacement;
    return (
      replacement?.slotId === "slot-7" &&
      replacement?.occupantLabel === "player-rowan" &&
      replacement?.lifecycleLabel === "Modkilled"
    );
  });

  assertModkillCommandStatus(commandStatus);
  const apiStateAfter = await fetchJson(
    `${apiBaseUrl}/games/${game}/host-console-state?principal_user_id=host_h&slot_id=slot-7`,
  );
  assertSlotLifecycleApiProjection(apiStateAfter);

  return {
    actionId,
    triggerBox,
    confirmBox,
    confirmationMessage,
    statusMessage,
    commandStatus,
    hostProjection: await page.evaluate(() => window.__fmarchHostProjection),
    apiStateAfter,
  };
}

async function waitForHostPromptDelta(page, status) {
  await page.waitForFunction(
    (expectedStatus) =>
      window.__fmarchHostLiveProjectionEvents?.some(
        (event) =>
          event?.delta?.kind === "HostPromptsChanged" &&
          event.delta.body?.prompts?.some(
            (prompt) =>
              prompt.prompt_id === "D01:skip_next_day:slot_1" &&
              prompt.status === expectedStatus,
          ),
      ),
    status,
  );
  await page.waitForFunction(
    (expectedStatus) =>
      window.__fmarchHostPromptsProjection?.some(
        (prompt) =>
          prompt.id === "D01:skip_next_day:slot_1" &&
          prompt.status === expectedStatus,
      ),
    status,
  );
}

async function waitForHostConsoleSlotStatusDelta(page, { slotId, status }) {
  await page.waitForFunction(
    ({ expectedSlotId, expectedStatus }) =>
      (window.__fmarchHostLiveProjectionEvents ?? []).some(
        (event) =>
          event?.delta?.kind === "HostConsoleStateChanged" &&
          event.delta.body?.slots?.some(
            (slot) =>
              slot.slot_id === expectedSlotId &&
              slot.status === expectedStatus &&
              slot.alive === false,
          ),
      ),
    { expectedSlotId: slotId, expectedStatus: status },
  );
}

async function waitForHostConsolePhaseLocked(page, locked) {
  await page.waitForFunction(
    (expectedLocked) =>
      window.__fmarchHostProjection?.phase?.locked === expectedLocked &&
      (window.__fmarchHostLiveProjectionEvents ?? []).some(
        (event) =>
          event?.delta?.kind === "HostConsoleStateChanged" &&
          event.delta.body?.phase?.locked === expectedLocked,
      ),
    locked,
  );
}

async function waitForHostProjectionPhaseLocked(page, locked) {
  await page.waitForFunction(
    (expectedLocked) => window.__fmarchHostProjection?.phase?.locked === expectedLocked,
    locked,
  );
}

async function waitForProjectionRequests(requests, suffixes) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (
      suffixes.every((suffix) =>
        requests.some((request) => request.pathname.endsWith(suffix)),
      )
    ) {
      return;
    }
    await delay(100);
  }
  throw new Error(
    `projection refresh requests did not include ${suffixes.join(", ")}: ${JSON.stringify(requests)}`,
  );
}

async function waitForMainThreadPost(expectedBody) {
  const deadline = Date.now() + 10_000;
  let lastPage = null;
  while (Date.now() < deadline) {
    lastPage = await fetchJson(`${apiBaseUrl}/games/${game}/thread?limit=50`);
    const post = lastPage.posts?.find((item) => item.body === expectedBody);
    if (post !== undefined) {
      return post;
    }
    await delay(100);
  }
  throw new Error(
    `main thread projection did not include ${expectedBody}: ${JSON.stringify(lastPage)}`,
  );
}

async function waitForHostLiveVotecount(page, count) {
  try {
    await page.waitForFunction(
      (expectedCount) =>
        window.__fmarchHostLiveProjectionEvents?.some(
          (event) =>
            event?.delta?.kind === "VoteCountChanged" &&
            event.delta.body?.candidate_slot === "slot_1" &&
            event.delta.body?.count === expectedCount,
        ),
      count,
    );
    await page.waitForFunction(
      (expectedCount) =>
        window.__fmarchHostVotecountProjection?.some(
          (row) => row.target === "slot_1" && row.count === expectedCount,
        ),
      count,
    );
  } catch (error) {
    const debug = await page.evaluate(() => ({
      endpoint: window.__fmarchHostLiveProjectionEndpoint,
      events: window.__fmarchHostLiveProjectionEvents,
      projection: window.__fmarchHostVotecountProjection,
    }));
    throw new Error(`host live votecount did not reach ${count}: ${JSON.stringify(debug)}`);
  }
}

async function proveHostVotecountConvergesAfterPlayerLoop(page, { before }) {
  const apiVoteCount = await fetchJson(`${apiBaseUrl}/games/${game}/votecount`);
  assertPlayerVoteProjection(apiVoteCount);
  const expectedCount = voteCountForSlot(apiVoteCount, "slot_1");
  if (expectedCount !== 1) {
    throw new Error(
      `player vote loop did not restore API votecount to 1: ${JSON.stringify(apiVoteCount)}`,
    );
  }

  const resyncFromSeq = 9001;
  const resyncEvent = await triggerHostResync(page, resyncFromSeq, { expectedCount });
  await page.waitForFunction(
    (expectedCount) =>
      window.__fmarchHostVotecountProjection?.some(
        (row) => row.target === "slot_1" && row.count === expectedCount,
      ),
    expectedCount,
  );
  const after = await hostVotecountBrowserSnapshot(page);
  const eventsSinceBaseline = after.events.slice(before.eventCount);
  const sawFreshVoteEvent = eventsSinceBaseline.some(
    (event) =>
      event?.delta?.kind === "VoteCountChanged" &&
      event.delta.body?.candidate_slot === "slot_1" &&
      event.delta.body?.count === expectedCount,
  );

  if (voteCountForProjection(after.projection, "slot_1") !== expectedCount) {
    throw new Error(
      `host votecount projection did not converge to API truth: ${JSON.stringify({
        expectedCount,
        apiVoteCount,
        before,
        after,
      })}`,
    );
  }

  return {
    status: "passed",
    expectedCount,
    apiVoteCount,
    before,
    after,
    resyncFromSeq,
    resyncEvent,
    sawFreshVoteEvent,
    proof:
      "After the player vote/duplicate/race/withdraw loop completed, the host browser explicitly resynced and its votecount projection converged to the API votecount for slot_1. The proof no longer depends on the host socket retaining transient intermediate count events.",
  };
}

async function hostVotecountBrowserSnapshot(page) {
  return await page.evaluate(() => ({
    endpoint: window.__fmarchHostLiveProjectionEndpoint,
    eventCount: (window.__fmarchHostLiveProjectionEvents ?? []).length,
    events: window.__fmarchHostLiveProjectionEvents ?? [],
    projection: window.__fmarchHostVotecountProjection ?? [],
  }));
}

function voteCountForSlot(votecount, slotId) {
  const row = (votecount ?? []).find(
    (candidate) =>
      candidate?.kind === "VoteCountChanged" &&
      candidate.body?.candidate_slot === slotId,
  );
  return row?.body?.count ?? null;
}

function voteCountForProjection(projection, slotId) {
  const row = (projection ?? []).find((candidate) => candidate?.target === slotId);
  return row?.count ?? null;
}

async function triggerHostResync(page, fromSeq, { expectedCount = 1 } = {}) {
  await page.evaluate(async (seq) => window.__fmarchTriggerHostResync(seq), fromSeq);
  await page.waitForFunction(
    (seq) => {
      const events = window.__fmarchHostLiveProjectionEvents ?? [];
      return events.some(
        (event) =>
          event?.kind === "resync-required" &&
          event.fromSeq === seq &&
          event.state === "recovered",
      );
    },
    fromSeq,
  );
  const resyncEvent = await page.evaluate((seq) => {
    const events = window.__fmarchHostLiveProjectionEvents ?? [];
    return events.find(
      (event) =>
        event?.kind === "resync-required" &&
        event.fromSeq === seq &&
        event.state === "recovered",
    );
  }, fromSeq);
  await page.waitForFunction(
    (count) =>
      window.__fmarchHostVotecountProjection?.some(
        (row) => row.target === "slot_1" && row.count === count,
      ),
    expectedCount,
  );
  return resyncEvent;
}

async function waitForHostConsoleDeadlineDelta(page, deadline) {
  await page.waitForFunction(
    (expectedDeadline) =>
      (window.__fmarchHostLiveProjectionEvents ?? []).some(
        (event) =>
          event?.delta?.kind === "HostConsoleStateChanged" &&
          event.delta.body?.phase?.deadline === expectedDeadline,
      ),
    deadline,
  );
}

async function waitForHostConsoleReplacementDelta(page, occupantUserId) {
  await page.waitForFunction(
    (expectedOccupant) =>
      (window.__fmarchHostLiveProjectionEvents ?? []).some(
        (event) =>
          event?.delta?.kind === "HostConsoleStateChanged" &&
          event.delta.body?.slots?.some(
            (slot) => slot.occupant_user_id === expectedOccupant,
          ),
      ),
    occupantUserId,
  );
}

async function sendCommand(principalUserId, command) {
  const response = await fetchJson(`${apiBaseUrl}/commands`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      v: 1,
      id: commandEnvelopeId++,
      body: {
        kind: "Command",
        body: {
          command_id: crypto.randomUUID(),
          principal_user_id: principalUserId,
          command,
        },
      },
    }),
  });
  if (response.body?.kind !== "Ack") {
    throw new Error(`seed command rejected: ${JSON.stringify(response)}`);
  }
  return {
    principalUserId,
    command,
    streamSeqs: response.body.body.stream_seqs,
  };
}

async function fetchJson(url, options = {}, timeoutMs = 15000) {
  const response = await fetchWithTimeout(url, options, timeoutMs);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function waitForHealth() {
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    try {
      const response = await fetchWithTimeout(`${apiBaseUrl}/healthz`, {}, 1000);
      if (response.ok) {
        return;
      }
    } catch {
      // Server is still compiling, migrating, or binding.
    }
    await delay(250);
  }
  throw new Error(`server did not become healthy at ${apiBaseUrl}/healthz`);
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

function assertApiProjection(state) {
  if (state.phase?.deadline !== 1781928000) {
    throw new Error(`API deadline projection did not update: ${JSON.stringify(state.phase)}`);
  }
  if (state.slots?.[0]?.occupant_user_id !== "player-rowan") {
    throw new Error(`API replacement projection did not update: ${JSON.stringify(state.slots)}`);
  }
  if (state.thread_posts?.[0]?.author_slot !== "slot-7") {
    throw new Error(`API thread history did not stay on slot-7: ${JSON.stringify(state.thread_posts)}`);
  }
}

function assertSlotLifecycleApiProjection(state) {
  const slot = state.slots?.find((candidate) => candidate.slot_id === "slot-7");
  if (slot === undefined) {
    throw new Error(`API slot lifecycle projection missing slot-7: ${JSON.stringify(state.slots)}`);
  }
  if (slot.status !== "modkilled" || slot.alive !== false) {
    throw new Error(`API slot lifecycle projection did not modkill slot-7: ${JSON.stringify(slot)}`);
  }
  if (slot.occupant_user_id !== "player-rowan") {
    throw new Error(`API modkill projection lost replacement occupant: ${JSON.stringify(slot)}`);
  }
}

function assertModkillCommandStatus(status) {
  if (status?.state !== "ack") {
    throw new Error(`modkill_slot did not ACK: ${JSON.stringify(status)}`);
  }
  const command = status.requestEnvelope?.body?.body?.command?.SetSlotStatus;
  if (command?.game !== game) {
    throw new Error(`modkill_slot used wrong game: ${JSON.stringify(command)}`);
  }
  if (command.slot !== "slot-7") {
    throw new Error(`modkill_slot used wrong slot: ${JSON.stringify(command)}`);
  }
  if (command.status !== "modkilled") {
    throw new Error(`modkill_slot used wrong lifecycle status: ${JSON.stringify(command)}`);
  }
}

function assertPlayerVoteProjection(deltas) {
  const vote = deltas.find(
    (delta) =>
      delta?.kind === "VoteCountChanged" &&
      delta?.body?.candidate_slot === "slot_1" &&
      delta.body.count === 1,
  );
  if (vote === undefined) {
    throw new Error(`player vote did not update API votecount: ${JSON.stringify(deltas)}`);
  }
}

function assertPlayerVoteSubmitOutcome(
  outcome,
  { actorSlot = "slot-7", targetSlot = "slot_1", label = "player SubmitVote" } = {},
) {
  if (outcome?.state !== "ack") {
    throw new Error(`${label} did not ACK: ${JSON.stringify(outcome)}`);
  }
  const command = outcome.requestEnvelope?.body?.body?.command?.SubmitVote;
  if (command?.game !== game) {
    throw new Error(`${label} used wrong game: ${JSON.stringify(command)}`);
  }
  if (command.actor_slot !== actorSlot) {
    throw new Error(`${label} used wrong actor slot: ${JSON.stringify(command)}`);
  }
  if (command.target?.Slot !== targetSlot) {
    throw new Error(`${label} used wrong target: ${JSON.stringify(command)}`);
  }
}

function assertPlayerVoteCommandId({ outcome, commandId, label }) {
  const actual = outcome?.requestEnvelope?.body?.body?.command_id;
  if (actual !== commandId) {
    throw new Error(`${label} used ${actual}, expected ${commandId}: ${JSON.stringify(outcome)}`);
  }
  if (outcome.commandId !== commandId) {
    throw new Error(`${label} status commandId drifted: ${JSON.stringify(outcome)}`);
  }
}

function assertDuplicatePlayerVoteOutcome({
  firstOutcome,
  duplicateOutcome,
  commandId,
}) {
  assertPlayerVoteSubmitOutcome(duplicateOutcome);
  assertPlayerVoteCommandId({
    outcome: duplicateOutcome,
    commandId,
    label: "duplicate player SubmitVote",
  });
  if (
    JSON.stringify(duplicateOutcome.streamSeqs) !==
    JSON.stringify(firstOutcome.streamSeqs)
  ) {
    throw new Error(
      `duplicate player SubmitVote did not return original ack stream seqs: ${JSON.stringify({ firstOutcome, duplicateOutcome })}`,
    );
  }
  return {
    commandId,
    firstEnvelopeId: firstOutcome.envelopeId,
    duplicateEnvelopeId: duplicateOutcome.envelopeId,
    streamSeqs: duplicateOutcome.streamSeqs,
  };
}

function assertSinglePlayerVoteSubmittedRow(voteRows) {
  const voteSubmittedRows = voteRows.match(/VoteSubmitted/g) ?? [];
  if (voteSubmittedRows.length !== 1) {
    throw new Error(
      `duplicate player SubmitVote appended ${voteSubmittedRows.length} VoteSubmitted rows:\n${voteRows}`,
    );
  }
  if (!voteRows.includes("slot-7") || !voteRows.includes("slot_1") || !voteRows.includes("D01")) {
    throw new Error(`duplicate player SubmitVote row drifted:\n${voteRows}`);
  }
}

function assertConcurrentPlayerVoteRows(voteRows) {
  const voteSubmittedRows = voteRows.match(/VoteSubmitted/g) ?? [];
  if (voteSubmittedRows.length !== 2) {
    throw new Error(
      `concurrent player SubmitVote appended ${voteSubmittedRows.length} rows:\n${voteRows}`,
    );
  }
  for (const actor of ["slot-7", "slot_4"]) {
    if (!voteRows.includes(actor)) {
      throw new Error(`concurrent player SubmitVote rows missing ${actor}:\n${voteRows}`);
    }
  }
  if (!voteRows.includes("slot_1") || !voteRows.includes("D01")) {
    throw new Error(`concurrent player SubmitVote row target/phase drifted:\n${voteRows}`);
  }
}

function assertDuplicatePlayerVoteReceipt({ commandId, receiptRows }) {
  if (!receiptRows.includes("player-mira") || !receiptRows.includes(commandId)) {
    throw new Error(
      `duplicate player SubmitVote receipt missing command ${commandId}:\n${receiptRows}`,
    );
  }
  if (!/\{\d+\}/.test(receiptRows)) {
    throw new Error(
      `duplicate player SubmitVote receipt did not persist stream seqs:\n${receiptRows}`,
    );
  }
}

function assertAdminCreateGameEnvelope(envelope) {
  if (envelope?.v !== 1 || envelope?.body?.kind !== "Command") {
    throw new Error(`admin create game did not send a command envelope: ${JSON.stringify(envelope)}`);
  }
  const commandBody = envelope.body.body;
  if (commandBody.principal_user_id !== "admin_a") {
    throw new Error(`admin create game principal drifted: ${commandBody.principal_user_id}`);
  }
  const command = commandBody.command;
  if (command?.CreateGame?.game !== adminCreatedGame) {
    throw new Error(`admin create game used wrong game: ${JSON.stringify(command)}`);
  }
  if (command.CreateGame.pack !== "mafiascum") {
    throw new Error(`admin create game used wrong pack: ${JSON.stringify(command)}`);
  }
}

function assertAdminCohostEnvelope(envelope) {
  if (envelope?.v !== 1 || envelope?.body?.kind !== "Command") {
    throw new Error(`admin cohost did not send a command envelope: ${JSON.stringify(envelope)}`);
  }
  const commandBody = envelope.body.body;
  if (commandBody.principal_user_id !== "admin_a") {
    throw new Error(`admin cohost principal drifted: ${commandBody.principal_user_id}`);
  }
  const command = commandBody.command;
  if (command?.AddCohost?.game !== adminCreatedGame) {
    throw new Error(`admin cohost used wrong game: ${JSON.stringify(command)}`);
  }
  if (command.AddCohost.user !== "cohost_c") {
    throw new Error(`admin cohost used wrong user: ${JSON.stringify(command)}`);
  }
}

function assertFactionDayChatSubmitPostOutcome(outcome) {
  if (outcome?.state !== "ack") {
    throw new Error(`faction day chat SubmitPost did not ACK: ${JSON.stringify(outcome)}`);
  }
  const command = outcome.requestEnvelope?.body?.body?.command?.SubmitPost;
  if (command?.game !== game) {
    throw new Error(`faction day chat SubmitPost used wrong game: ${JSON.stringify(command)}`);
  }
  if (command.channel_id !== factionDayChatChannel) {
    throw new Error(`faction day chat SubmitPost used wrong channel: ${JSON.stringify(command)}`);
  }
  if (command.actor_slot !== "slot-7") {
    throw new Error(`faction day chat SubmitPost used wrong actor slot: ${JSON.stringify(command)}`);
  }
  if (command.body !== factionDayChatPostBody) {
    throw new Error(`faction day chat SubmitPost used wrong body: ${JSON.stringify(command)}`);
  }
  if (!Array.isArray(command.media) || command.media.length !== 1) {
    throw new Error(`faction day chat SubmitPost did not carry one media handle: ${JSON.stringify(command)}`);
  }
  const attachment = command.media[0];
  const attachmentKeys = Object.keys(attachment).sort();
  if (JSON.stringify(attachmentKeys) !== JSON.stringify(["alt", "content_id"])) {
    throw new Error(`client media contract leaked non-handle fields: ${JSON.stringify(attachment)}`);
  }
  if (!/^[0-9a-f]{64}$/u.test(String(attachment.content_id ?? ""))) {
    throw new Error(`client media handle was not canonical: ${JSON.stringify(attachment)}`);
  }
  if (attachment.alt !== factionDayChatMediaAlt) {
    throw new Error(`client media alt text drifted: ${JSON.stringify(attachment)}`);
  }
  return Object.freeze({
    contentId: attachment.content_id,
    attachment,
  });
}

function assertInvalidActionRecovery(outcome) {
  if (outcome?.state !== "reject" || outcome.error !== "InvalidTarget") {
    throw new Error(`invalid player action did not render InvalidTarget recovery: ${JSON.stringify(outcome)}`);
  }
  const command = outcome.requestEnvelope?.body?.body?.command?.SubmitAction;
  if (command?.game !== actionGame) {
    throw new Error(`invalid player action used wrong game: ${JSON.stringify(command)}`);
  }
  if (command.actor_slot !== "slot_4") {
    throw new Error(`invalid player action used wrong actor slot: ${JSON.stringify(command)}`);
  }
  if (command.template_id !== "factional_kill") {
    throw new Error(`invalid player action used wrong template: ${JSON.stringify(command)}`);
  }
  if (command.targets?.[0] !== "slot_4") {
    throw new Error(`invalid player action did not self-target slot_4: ${JSON.stringify(command)}`);
  }
}

function assertStalePlayerActionRecovery(outcome) {
  if (outcome?.state !== "reject" || outcome.error !== "PhaseLocked") {
    throw new Error(`stale player action did not render PhaseLocked recovery: ${JSON.stringify(outcome)}`);
  }
  const command = outcome.requestEnvelope?.body?.body?.command?.SubmitAction;
  if (command?.game !== actionGame) {
    throw new Error(`stale player action used wrong game: ${JSON.stringify(command)}`);
  }
  if (command.actor_slot !== "slot_4") {
    throw new Error(`stale player action used wrong actor slot: ${JSON.stringify(command)}`);
  }
  if (command.action_id !== "role_factional_kill") {
    throw new Error(`stale player action used wrong action id: ${JSON.stringify(command)}`);
  }
  if (command.template_id !== "factional_kill") {
    throw new Error(`stale player action used wrong template: ${JSON.stringify(command)}`);
  }
  if (command.targets?.[0] !== "slot-2") {
    throw new Error(`stale player action used wrong target: ${JSON.stringify(command)}`);
  }
}

function assertStalePlayerActionRecoveryMessage({ outcome, statusMessage }) {
  const expected = ["stale action state", "current action controls"];
  const outcomeMessage = String(outcome?.message ?? "");
  const renderedMessage = String(statusMessage ?? "");
  if (expected.some((text) => !outcomeMessage.includes(text))) {
    throw new Error(`stale player action did not explain recovery in outcome: ${JSON.stringify(outcome)}`);
  }
  if (expected.some((text) => !renderedMessage.includes(text))) {
    throw new Error(`stale player action did not render recovery guidance: ${statusMessage}`);
  }
}

function assertStalePlayerVoteRecovery(outcome) {
  if (outcome?.state !== "reject" || outcome.error !== "PhaseLocked") {
    throw new Error(`stale player vote did not render PhaseLocked recovery: ${JSON.stringify(outcome)}`);
  }
  const command = outcome.requestEnvelope?.body?.body?.command?.SubmitVote;
  if (command?.game !== game) {
    throw new Error(`stale player vote used wrong game: ${JSON.stringify(command)}`);
  }
  if (command.actor_slot !== "slot-7") {
    throw new Error(`stale player vote used wrong actor slot: ${JSON.stringify(command)}`);
  }
  if (command.target?.Slot !== "slot_1") {
    throw new Error(`stale player vote used wrong target: ${JSON.stringify(command)}`);
  }
}

function assertStalePlayerVoteRecoveryMessage({ outcome, statusMessage }) {
  if (!isStalePlayerVoteRecoveryMessage(outcome?.message)) {
    throw new Error(`stale player vote did not explain recovery in outcome: ${JSON.stringify(outcome)}`);
  }
  if (!isStalePlayerVoteRecoveryMessage(statusMessage)) {
    throw new Error(`stale player vote did not render recovery guidance: ${statusMessage}`);
  }
}

function isStalePlayerVoteRecoveryMessage(message) {
  const value = String(message ?? "");
  return (
    value.includes("stale projection, refresh and use current controls") ||
    value.includes("stale vote state, refresh and use current vote controls")
  );
}

function assertStaleSameActionRecovery({ outcome, winningCommandId }) {
  if (outcome?.state !== "reject" || outcome.error !== "ActionAlreadySubmitted") {
    throw new Error(`stale same-action race did not render ActionAlreadySubmitted recovery: ${JSON.stringify(outcome)}`);
  }
  if (outcome.commandId === winningCommandId) {
    throw new Error(`stale same-action race reused the winning command_id: ${JSON.stringify(outcome)}`);
  }
  const command = outcome.requestEnvelope?.body?.body?.command?.SubmitAction;
  if (command?.game !== actionGame) {
    throw new Error(`stale same-action race used wrong game: ${JSON.stringify(command)}`);
  }
  if (command.actor_slot !== "slot_4") {
    throw new Error(`stale same-action race used wrong actor slot: ${JSON.stringify(command)}`);
  }
  if (command.action_id !== "role_factional_kill") {
    throw new Error(`stale same-action race used wrong action id: ${JSON.stringify(command)}`);
  }
  if (command.template_id !== "factional_kill") {
    throw new Error(`stale same-action race used wrong template: ${JSON.stringify(command)}`);
  }
  if (command.targets?.[0] !== "slot-2") {
    throw new Error(`stale same-action race used wrong target: ${JSON.stringify(command)}`);
  }
}

function assertStaleSameActionRecoveryMessage({ outcome, statusMessage }) {
  const expected = "refresh and use current controls";
  if (!String(outcome?.message ?? "").includes(expected)) {
    throw new Error(`stale same-action race did not explain recovery in outcome: ${JSON.stringify(outcome)}`);
  }
  if (!String(statusMessage ?? "").includes(expected)) {
    throw new Error(`stale same-action race did not render recovery guidance: ${statusMessage}`);
  }
}

function assertHostStreamConflictRecovery(outcome) {
  if (
    outcome?.state !== "reject" ||
    outcome.error !== "StreamConflict" ||
    outcome.retryable !== true
  ) {
    throw new Error(`host conflict did not render retryable StreamConflict: ${JSON.stringify(outcome)}`);
  }
  if (!String(outcome.message ?? "").includes("reload and retry")) {
    throw new Error(`host conflict did not tell the user how to recover: ${JSON.stringify(outcome)}`);
  }
  const command = outcome.requestEnvelope?.body?.body?.command?.ExtendDeadline;
  if (command?.game !== game) {
    throw new Error(`host conflict ExtendDeadline used wrong game: ${JSON.stringify(command)}`);
  }
  if (command.phase !== "D01") {
    throw new Error(`host conflict ExtendDeadline used wrong phase: ${JSON.stringify(command)}`);
  }
}

function assertPlayerCommandStateEvidence({ commandStateRequests, commandStateResponses }) {
  if (commandStateRequests.length === 0) {
    throw new Error("player action route did not request player-command-state");
  }
  const response = commandStateResponses.find(
    (candidate) =>
      candidate.ok === true &&
      candidate.actorSlot === "slot_4" &&
      candidate.roleKey === "mafia_goon" &&
      candidate.phaseId === "N01" &&
      candidate.phaseKind === "Night" &&
      candidate.actions?.some(
        (action) =>
          action.templateId === "factional_kill" &&
          action.targets?.[0] === "slot-2" &&
          action.targetOptions?.includes("slot-3"),
      ),
  );
  if (response === undefined) {
    throw new Error(
      `player-command-state response did not expose live factional_kill action: ${JSON.stringify(commandStateResponses)}`,
    );
  }
  if (!String(response.boundary ?? "").includes("Final command validation")) {
    throw new Error(`player-command-state boundary drifted: ${JSON.stringify(response)}`);
  }
}

async function waitForCommandStateResponse(commandStateResponses, predicate) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = commandStateResponses.find(predicate);
    if (response !== undefined) {
      return response;
    }
    await delay(100);
  }
  throw new Error(
    `player-command-state response did not reach expected state: ${JSON.stringify(commandStateResponses)}`,
  );
}

function assertPlayerActionSubmitOutcome(outcome) {
  if (outcome?.state !== "ack") {
    throw new Error(`player SubmitAction did not ACK: ${JSON.stringify(outcome)}`);
  }
  const command = outcome.requestEnvelope?.body?.body?.command?.SubmitAction;
  if (command?.game !== actionGame) {
    throw new Error(`player SubmitAction used wrong game: ${JSON.stringify(command)}`);
  }
  if (command.actor_slot !== "slot_4") {
    throw new Error(`player SubmitAction used wrong actor slot: ${JSON.stringify(command)}`);
  }
  if (command.action_id !== "role_factional_kill") {
    throw new Error(`player SubmitAction used wrong action id: ${JSON.stringify(command)}`);
  }
  if (command.template_id !== "factional_kill") {
    throw new Error(`player SubmitAction used wrong template: ${JSON.stringify(command)}`);
  }
  if (command.targets?.[0] !== "slot-2") {
    throw new Error(`player SubmitAction used wrong target: ${JSON.stringify(command)}`);
  }
}

function assertPlayerActionCommandId({ outcome, commandId, label }) {
  const actual = outcome?.requestEnvelope?.body?.body?.command_id;
  if (actual !== commandId) {
    throw new Error(`${label} used ${actual}, expected ${commandId}: ${JSON.stringify(outcome)}`);
  }
  if (outcome.commandId !== commandId) {
    throw new Error(`${label} status commandId drifted: ${JSON.stringify(outcome)}`);
  }
}

function assertDuplicatePlayerSubmitOutcome({
  firstOutcome,
  duplicateOutcome,
  commandId,
}) {
  assertPlayerActionCommandId({
    outcome: duplicateOutcome,
    commandId,
    label: "duplicate player SubmitAction",
  });
  if (duplicateOutcome.envelopeId === firstOutcome.envelopeId) {
    throw new Error(
      `duplicate player SubmitAction did not send a fresh envelope: ${JSON.stringify({ firstOutcome, duplicateOutcome })}`,
    );
  }
  if (
    JSON.stringify(duplicateOutcome.streamSeqs) !==
    JSON.stringify(firstOutcome.streamSeqs)
  ) {
    throw new Error(
      `duplicate player SubmitAction did not return original ack stream seqs: ${JSON.stringify({ firstOutcome, duplicateOutcome })}`,
    );
  }
  return {
    commandId,
    firstEnvelopeId: firstOutcome.envelopeId,
    duplicateEnvelopeId: duplicateOutcome.envelopeId,
    streamSeqs: duplicateOutcome.streamSeqs,
  };
}

function assertSinglePlayerActionSubmittedRow(actionRows) {
  const actionSubmittedRows = actionRows.match(/ActionSubmitted/g) ?? [];
  if (actionSubmittedRows.length !== 1) {
    throw new Error(
      `duplicate player SubmitAction appended ${actionSubmittedRows.length} ActionSubmitted rows:\n${actionRows}`,
    );
  }
}

function assertDuplicatePlayerSubmitReceipt({ commandId, receiptRows }) {
  if (!receiptRows.includes("action-goon") || !receiptRows.includes(commandId)) {
    throw new Error(
      `duplicate player SubmitAction receipt missing command ${commandId}:\n${receiptRows}`,
    );
  }
  if (!/\{\d+\}/.test(receiptRows)) {
    throw new Error(
      `duplicate player SubmitAction receipt did not persist stream seqs:\n${receiptRows}`,
    );
  }
}

function assertManifestBackedPrivateMedia({
  projectedMedia,
  contentId,
  mediaPostSeq,
  gameId = game,
  channelId = factionDayChatChannel,
  expectedAlt = factionDayChatMediaAlt,
}) {
  if (projectedMedia?.content_id !== contentId || projectedMedia.alt !== expectedAlt) {
    throw new Error(`projected private media identity drifted: ${JSON.stringify(projectedMedia)}`);
  }
  const expectedRoles = ["full-bounded", "tablet", "thumb"];
  const actualRoles = Object.keys(projectedMedia.variants ?? {}).sort();
  if (JSON.stringify(actualRoles) !== JSON.stringify(expectedRoles)) {
    throw new Error(`projected private media roles drifted: ${JSON.stringify(projectedMedia)}`);
  }
  const encodedChannel = encodeURIComponent(channelId);
  for (const role of expectedRoles) {
    const variant = projectedMedia.variants[role];
    const prefix = `/media/thread/${gameId}/${encodedChannel}/${mediaPostSeq}/${contentId}/${role}`;
    if (
      variant?.avif_url !== `${prefix}.avif` ||
      variant?.webp_url !== `${prefix}.webp` ||
      Number(variant?.width ?? 0) <= 0 ||
      Number(variant?.height ?? 0) <= 0
    ) {
      throw new Error(`projected ${role} media variant drifted: ${JSON.stringify(variant)}`);
    }
  }
}

function assertTabletMediaEvidence({
  mediaAttributes,
  mediaRequests,
  mediaResponses,
  mediaPostSeq,
  contentId,
}) {
  const renderedSources = (mediaAttributes?.sources ?? []).flatMap((source) => [
    source.type,
    source.srcset,
    source.sizes,
  ]);
  const rendered = [
    mediaAttributes?.src,
    ...renderedSources,
    ...mediaRequests.map((request) => request.pathname),
    ...mediaResponses.map((response) => response.pathname),
  ].join("\n");
  if (!rendered.includes(`/${contentId}/tablet.`)) {
    throw new Error(`tablet media variant was not rendered/requested: ${rendered}`);
  }
  if (!rendered.includes(`/${contentId}/thumb.`)) {
    throw new Error(`thumb media variant was not present in responsive evidence: ${rendered}`);
  }
  for (const forbidden of ["original", ".png", ".jpeg", ".jpg"]) {
    if (rendered.includes(forbidden)) {
      throw new Error(`forbidden media variant leaked into evidence (${forbidden}): ${rendered}`);
    }
  }
  if (Number(mediaAttributes?.naturalWidth ?? 0) <= 0) {
    throw new Error(`tablet media image did not load: ${JSON.stringify(mediaAttributes)}`);
  }
  const tabletResponse = mediaResponses.find((response) =>
    response.variant === "tablet" && response.status === 200,
  );
  if (tabletResponse === undefined) {
    throw new Error(`tablet media response was not observed: ${JSON.stringify(mediaResponses)}`);
  }
  if (
    tabletResponse.status !== 200 ||
    tabletResponse.contentType !== `image/${tabletResponse.format}` ||
    !["avif", "webp"].includes(tabletResponse.format) ||
    tabletResponse.variant !== "tablet" ||
    tabletResponse.contentAddress !== contentId ||
    tabletResponse.channel !== factionDayChatChannel ||
    tabletResponse.postSeq !== String(mediaPostSeq) ||
    tabletResponse.reference !== `${game}/${factionDayChatChannel}/${mediaPostSeq}/${contentId}`
  ) {
    throw new Error(`tablet media response metadata drifted: ${JSON.stringify(tabletResponse)}`);
  }
  if (tabletResponse.cacheControl !== "private, no-cache") {
    throw new Error(`tablet media cache policy drifted: ${JSON.stringify(tabletResponse)}`);
  }
  if (Number(tabletResponse.bodyBytes ?? 0) <= 0) {
    throw new Error(`tablet media response contained no encoded bytes: ${JSON.stringify(tabletResponse)}`);
  }
}

function assertHitTarget(box, label) {
  if (box === null) {
    throw new Error(`${label} has no rendered bounding box`);
  }
  if (box.width < 44 || box.height < 44) {
    throw new Error(
      `${label} is ${box.width}x${box.height}, expected at least 44x44`,
    );
  }
}

function assertVisibleBox(box, label) {
  if (box === null) {
    throw new Error(`${label} has no rendered bounding box`);
  }
  if (box.width <= 0 || box.height <= 0) {
    throw new Error(`${label} is ${box.width}x${box.height}, expected visible pixels`);
  }
}

async function writeProgress(progress) {
  await writeFile(
    path.join(artifactDir, "live-stack-progress.json"),
    JSON.stringify({ at: new Date().toISOString(), ...progress }, null, 2),
  );
}

async function freePort() {
  return await new Promise((resolve, reject) => {
    const portServer = net.createServer();
    portServer.on("error", reject);
    portServer.listen(0, host, () => {
      const address = portServer.address();
      portServer.close(() => {
        if (!address || typeof address === "string") {
          reject(new Error("could not allocate a free TCP port"));
          return;
        }
        resolve(address.port);
      });
    });
  });
}

process.on("uncaughtException", (error) => {
  if (error.serverOutput) {
    console.error("\n--- server output tail ---");
    console.error(error.serverOutput);
  }
  throw error;
});
