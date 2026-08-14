import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { runFmarchMigrations } from "./run_fmarch_migrations.mjs";
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
  DAY_EVENT_ROOM_SCOPE,
  createDayEventRoomFixture,
  createDayEventRoomSessions as createDayEventRoomScenarioSessions,
  driveDayEventRoomBrowser as driveDayEventRoomScenario,
  seedDayEventRoom as seedDayEventRoomScenario,
} from "./live_stack/day_event_room_scenario.mjs";
import {
  createLiveStackAuth,
  createLiveStackCommandSender,
  hashSessionToken,
} from "./live_stack/auth_commands.mjs";
import {
  createLiveStackViteLogger,
  createLiveStackFixtureTools,
  sqlLiteral,
} from "./live_stack/fixture.mjs";
import {
  buildSetupCommandEvidence,
  selectHostSetupStage,
  waitForHostSetupCommand,
} from "./dev_test_game_setup_bootstrap_scenario.mjs";
import { generatedThreadMediaPng } from "../frontend/src/lib/server/thread-media-png.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontendRoot = path.join(repoRoot, "frontend");
const configuredScope = process.env.FMARCH_LIVE_STACK_SCOPE;
if (
  configuredScope !== undefined &&
  configuredScope !== "" &&
  configuredScope !== DAY_EVENT_ROOM_SCOPE
) {
  throw new Error(`unsupported FMARCH_LIVE_STACK_SCOPE: ${configuredScope}`);
}
const dayEventRoomOnly =
  configuredScope === DAY_EVENT_ROOM_SCOPE;
const smokeName = dayEventRoomOnly
  ? "host-console-day-event-room-live-stack"
  : "host-console-live-stack-smoke";
const artifactDir = path.join(repoRoot, "target", smokeName);
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
const {
  createScratchDatabase,
  dropScratchDatabase,
  freePort,
  runSql,
  runSqlScalar,
  stopChild,
  writeProgress,
} = createLiveStackFixtureTools({
  artifactDir,
  cwd: repoRoot,
  host,
});
const smokeViewport = Object.freeze({ width: 1024, height: 768 });
const game = crypto.randomUUID();
const actionGame = crypto.randomUUID();
const additionalRoomsGame = crypto.randomUUID();
const deadChatGame = crypto.randomUUID();
const spectatorGame = crypto.randomUUID();
const dayEventRoomFixture = createDayEventRoomFixture();
const dayEventRoomGame = dayEventRoomFixture.game;
const adminCreatedGame = crypto.randomUUID();
const rootAdminSessionToken = canonicalSessionToken(
  `host-console-live-stack-root-admin-${crypto.randomUUID()}`,
);
const hostSessionToken = `host-console-live-stack-host-${crypto.randomUUID()}`;
const playerSessionToken = `host-console-live-stack-player-${crypto.randomUUID()}`;
const rolePmIncomingSessionToken = `host-console-live-stack-role-pm-incoming-${crypto.randomUUID()}`;
const actionPlayerSessionToken = `host-console-live-stack-action-player-${crypto.randomUUID()}`;
const racePlayerSessionToken = `host-console-live-stack-race-player-${crypto.randomUUID()}`;
const seedPlayerSessionToken = `host-console-live-stack-seed-player-${crypto.randomUUID()}`;
const targetPlayerSessionToken = `host-console-live-stack-target-player-${crypto.randomUUID()}`;
const goonBSessionToken = `host-console-live-stack-goon-b-${crypto.randomUUID()}`;
const adminSessionToken = `host-console-live-stack-admin-${crypto.randomUUID()}`;
const cohostSessionToken = `host-console-live-stack-cohost-${crypto.randomUUID()}`;
const dayEventRoomOutgoing = dayEventRoomFixture.outgoing;
const dayEventRoomIncoming = dayEventRoomFixture.incoming;
const dayEventRoomId = dayEventRoomFixture.eventId;
const dayEventRoomChannel = dayEventRoomFixture.channelId;
const factionDayChatChannel = "private:mafia_day_chat";
const factionDayChatRoute = encodeURIComponent(factionDayChatChannel);
const factionDayChatPostBody = "Faction day chat received from live-stack smoke";
const factionDayChatMediaAlt = "Private faction day chat vote receipt";
const rolePmChannel = "private:role_pm:slot-7";
const rolePmRoute = encodeURIComponent(rolePmChannel);
const rolePmHistoryBody = "Role PM history before replacement";
const rolePmIncomingBody = "Incoming replacement continued the durable Role PM";
const rolePmMediaAlt = "Transferred private Role PM receipt";
const rolePmIncomingAccountId = `player-rowan-${game}@example.test`;
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
const deadChatDefinition = Object.freeze({
  channelId: "dead",
  route: "dead",
  outgoing: Object.freeze({
    slotId: "dead-slot",
    principalUserId: "dead-chat-outgoing",
    sessionToken: `host-console-live-stack-dead-outgoing-${crypto.randomUUID()}`,
  }),
  incoming: Object.freeze({
    principalUserId: "dead-chat-incoming",
    sessionToken: `host-console-live-stack-dead-incoming-${crypto.randomUUID()}`,
  }),
  living: Object.freeze({
    slotId: "living-slot",
    principalUserId: "dead-chat-living",
    sessionToken: `host-console-live-stack-dead-living-${crypto.randomUUID()}`,
  }),
  historyBody: "Dead-chat history before replacement",
  incomingBody: "Incoming dead occupant continued the room",
  mediaAlt: "Dead-chat private receipt",
});
const spectatorDefinition = Object.freeze({
  channelId: "spectator",
  route: "spectator",
  principalUserId: "spectator-room-user",
  sessionToken: `host-console-live-stack-spectator-${crypto.randomUUID()}`,
  historyBody: "Host notice preserved for spectators",
  liveBody: "Second host notice delivered live to spectators",
  mediaAlt: "Spectator room notice receipt",
});
const accountOnlyFixturePrincipals = Object.freeze([
  "player-beloved",
  "player-town-extra",
  "action-target",
  "action-town",
  ...additionalRoomDefinitions.map((room) => room.peer.principalUserId),
]);
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
  smokeName,
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
const issuedSessionTokens = new Map([[rootAdminSessionToken, rootAdminSessionToken]]);
const liveStackAuth = createLiveStackAuth({
  apiBaseUrl,
  fetchJson,
  rootAdminSessionToken,
});
const { createAuthAccount } = liveStackAuth;
const createAccountSession = async ({ sessionAlias, ...options }) =>
  registerIssuedSession(sessionAlias, await liveStackAuth.createAccountSession(options));
const createGrantedSession = async ({ sessionAlias, ...options }) =>
  registerIssuedSession(sessionAlias, await liveStackAuth.createGrantedSession(options));
const sendCommand = createLiveStackCommandSender({
  apiBaseUrl,
  fetchJson,
  nextEnvelopeId: () => commandEnvelopeId++,
  sessionTokenForPrincipal: (principalUserId) =>
    resolveSessionToken(({
      host_h: hostSessionToken,
      admin_a: adminSessionToken,
      "player-mira": playerSessionToken,
      "player-rowan": rolePmIncomingSessionToken,
      "player-seed": seedPlayerSessionToken,
      "player-target": targetPlayerSessionToken,
      "player-goon-a": racePlayerSessionToken,
      "player-goon-b": goonBSessionToken,
      "action-goon": actionPlayerSessionToken,
    })[principalUserId]),
});
let server;
let vite;
let browser;
let smokeDatabase;
let subjectKeyRoot;
let serverOutput = "";
let primaryError = null;
const moderatorSocketDiagnostics = [];
const moderatorTicketDiagnostics = [];
const moderatorConsoleDiagnostics = [];
const previousSmokeAuth = process.env.FMARCH_HOST_CONSOLE_SMOKE_AUTH;
const previousApiBaseUrl = process.env.FMARCH_API_BASE_URL;
const previousApiInternalUrl = process.env.FMARCH_API_INTERNAL_URL;
process.env.FMARCH_HOST_CONSOLE_SMOKE_AUTH = "1";
delete process.env.FMARCH_API_BASE_URL;
process.env.FMARCH_API_INTERNAL_URL = apiBaseUrl;
process.chdir(frontendRoot);

try {
  await mkdir(artifactDir, { recursive: true });
  subjectKeyRoot = await mkdtemp(path.join(artifactDir, "subject-authority-"));
  await mkdir(mediaRoot, { recursive: true, mode: 0o700 });
  await writeProgress({ stage: "create-temp-database" });
  smokeDatabase = await createScratchDatabase(databaseUrl);
  await runFmarchMigrations({ cwd: repoRoot, databaseUrl: smokeDatabase.url });

  await writeProgress({ stage: "start-rust-server", apiPort });
  server = spawn("cargo", ["run", "-p", "server"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      DATABASE_URL: smokeDatabase.url,
      FMARCH_BIND: `${host}:${apiPort}`,
      FMARCH_MEDIA_ROOT: mediaRoot,
      FMARCH_SUBJECT_KEY_DIR: subjectKeyRoot,
      FMARCH_EVENT_ENCRYPTION_KEY:
        process.env.FMARCH_EVENT_ENCRYPTION_KEY ??
        "host-console-live-proof-key-at-least-32-bytes",
      FMARCH_EVENT_ENCRYPTION_KID:
        process.env.FMARCH_EVENT_ENCRYPTION_KID ?? "host-console-live-proof-v1",
      FMARCH_AUTH_SOURCE_SIGNING_KEY:
        process.env.FMARCH_AUTH_SOURCE_SIGNING_KEY ??
        "host-console-live-proof-signing-key-at-least-32-bytes",
      FMARCH_DB_MAX_CONNECTIONS:
        process.env.FMARCH_DB_MAX_CONNECTIONS ?? "48",
      FMARCH_HTTP_REQUEST_TIMEOUT_MS:
        process.env.FMARCH_HTTP_REQUEST_TIMEOUT_MS ?? "180000",
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
  await writeProgress({ stage: "seed-root-admin-session" });
  const rootAdminSession = await seedRootAdminSession();
  let grantedSessions;
  let seedCommands = null;
  let actionSeedCommands = null;
  let additionalRoomsSeed = null;
  let deadChatSeed = null;
  let spectatorSeed = null;
  let privateChannelFixture = null;
  let additionalRoomSessions = null;
  let deadChatSessions = null;
  let spectatorSession = null;
  let accountOnlyPrincipals = [];
  if (dayEventRoomOnly) {
    await writeProgress({ stage: "create-day-event-room-host-session", dayEventRoomGame });
    grantedSessions = {
      host: await createGrantedSession({
        sessionAlias: hostSessionToken,
        principalUserId: "host_h",
        globalCapabilities: ["GlobalAdmin"],
      }),
    };
  } else {
    await writeProgress({ stage: "create-granted-sessions", game });
    grantedSessions = await createGrantedSessions();
    await writeProgress({ stage: "provision-account-only-fixture-principals" });
    accountOnlyPrincipals = await provisionAccountOnlyFixturePrincipals();
    await writeProgress({ stage: "create-additional-room-sessions", additionalRoomsGame });
    additionalRoomSessions = await createAdditionalRoomSessions();
    await writeProgress({ stage: "create-dead-chat-sessions", deadChatGame });
    deadChatSessions = await createDeadChatSessions();
    await writeProgress({ stage: "create-spectator-session", spectatorGame });
    spectatorSession = await createSpectatorSession();
    await writeProgress({ stage: "seed-admin-setup-game", game: adminCreatedGame });
    await sendCommand("admin_a", {
      CreateGame: { game: adminCreatedGame, pack: "mafiascum" },
    });
    await writeProgress({ stage: "seed-game", game });
    seedCommands = await seedGame();
    await writeProgress({ stage: "seed-action-game", actionGame });
    actionSeedCommands = await seedActionGame();
    await writeProgress({ stage: "seed-additional-rooms-game", additionalRoomsGame });
    additionalRoomsSeed = await seedAdditionalRoomsGame();
    await writeProgress({ stage: "seed-dead-chat-game", deadChatGame });
    deadChatSeed = await seedDeadChatGame();
    await writeProgress({ stage: "seed-spectator-game", spectatorGame });
    spectatorSeed = await seedSpectatorGame();
    await writeProgress({ stage: "seed-faction-day-chat-fixture", game });
    privateChannelFixture = await seedFactionDayChatFixture();
  }
  await writeProgress({ stage: "create-day-event-room-sessions", dayEventRoomGame });
  const dayEventRoomSessions = await createDayEventRoomScenarioSessions({
    fixture: dayEventRoomFixture,
    createAccountSession,
  });
  await writeProgress({ stage: "seed-day-event-room-game", dayEventRoomGame });
  const dayEventRoomSeed = await seedDayEventRoomScenario({
    fixture: dayEventRoomFixture,
    sendCommand,
  });

  await writeProgress({ stage: "start-sveltekit" });
  const { createLogger, createServer: createViteServer } = await import(
    frontendRequire.resolve("vite")
  );
  vite = await createViteServer({
    root: frontendRoot,
    server: {
      host,
      port: 0,
      strictPort: false,
      proxy: {
        "/games": apiBaseUrl,
        "/ws": {
          target: apiBaseUrl,
          ws: true,
        },
      },
    },
    logLevel: "error",
    customLogger: createLiveStackViteLogger({
      logger: createLogger("error"),
    }),
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
    deadChatSeed,
    spectatorSeed,
    dayEventRoomSeed,
  );
  const playerVoteCount = dayEventRoomOnly
    ? null
    : browserEvidence.playerVoteCountAfterPlayer ??
      (await fetchJson(`${apiBaseUrl}/games/${game}/votecount`));
  if (!dayEventRoomOnly) assertPlayerVoteProjection(playerVoteCount);
  const apiState = dayEventRoomOnly
    ? null
    : browserEvidence.moderator?.apiStateBeforePrompt ??
      (await fetchJson(
        `${apiBaseUrl}/games/${game}/host-console-state?slot_id=slot-7`,
        { headers: { authorization: `Bearer ${hostSessionToken}` } },
      ));
  if (!dayEventRoomOnly) assertApiProjection(apiState);
  const slotLifecycleApiState = dayEventRoomOnly
    ? null
    : browserEvidence.moderator?.slotLifecycle?.apiStateAfter ??
      (await fetchJson(
        `${apiBaseUrl}/games/${game}/host-console-state?slot_id=slot-7`,
        { headers: { authorization: `Bearer ${hostSessionToken}` } },
      ));
  if (!dayEventRoomOnly) assertSlotLifecycleApiProjection(slotLifecycleApiState);

  const evidence = {
    status: "passed",
    generatedAt: new Date().toISOString(),
    game: dayEventRoomOnly ? dayEventRoomGame : game,
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
    deadChatSeed,
    spectatorSeed,
    dayEventRoomSeed,
    privateChannelFixture,
    rootAdminSession,
    grantedSessions,
    accountOnlyPrincipals,
    additionalRoomSessions,
    deadChatSessions,
    spectatorSession,
    dayEventRoomSessions,
    browser: browserEvidence,
    playerVoteCount,
    apiState,
    slotLifecycleApiState,
  };
  const readiness = dayEventRoomOnly
    ? {
        status: "passed",
        scope: "day-event-room",
        proof: browserEvidence.dayEventRoom.proof,
      }
    : buildLiveStackReadiness(evidence);
  if (!dayEventRoomOnly) assertLiveStackReadiness(readiness);
  evidence.readiness = readiness;
  const summary = dayEventRoomOnly
    ? readiness
    : buildLiveStackProofSummary(evidence);
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(
    summaryMarkdownPath,
    dayEventRoomOnly
      ? `# DayEvent room live-stack proof\n\n${readiness.proof}\n`
      : markdownLiveStackProofSummary(summary),
  );
  await writeProgress({ stage: "complete", evidencePath, summaryPath });
  console.log(`wrote ${path.relative(repoRoot, evidencePath)}`);
} catch (error) {
  primaryError = error;
  await writeProgress({
    stage: "failed",
    error: String(error?.stack ?? error),
  });
  const handled = await handleLocalhostBindFailure({
    error,
    repoRoot,
    artifactDir,
    evidencePath,
    smokeName,
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
  if (server !== undefined) {
    await stopChild(server, "rust server");
  }
  if (smokeDatabase !== undefined) {
    await writeProgress({
      stage: primaryError === null ? "drop-temp-database" : "failed",
      database: smokeDatabase.name,
      ...(primaryError === null
        ? {}
        : { error: String(primaryError?.stack ?? primaryError) }),
    });
    try {
      await dropScratchDatabase(smokeDatabase);
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
  if (subjectKeyRoot !== undefined) {
    await rm(subjectKeyRoot, { recursive: true, force: true });
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
  if (previousApiInternalUrl === undefined) {
    delete process.env.FMARCH_API_INTERNAL_URL;
  } else {
    process.env.FMARCH_API_INTERNAL_URL = previousApiInternalUrl;
  }
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
      { SeatPersona: { game, slot: "slot-7", principal_user_id: "player-mira" , public_name: "player-mira" } },
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
        SeatPersona: {
          game,
          slot: "slot-2",
          principal_user_id: "player-target", public_name: "player-target",
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
        SeatPersona: {
          game,
          slot: "slot-3",
          principal_user_id: "player-seed", public_name: "player-seed",
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
        SeatPersona: {
          game,
          slot: "slot_1",
          principal_user_id: "player-beloved", public_name: "player-beloved",
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
        SeatPersona: {
          game,
          slot: "slot_4",
          principal_user_id: "player-goon-a", public_name: "player-goon-a",
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
        SeatPersona: {
          game,
          slot: "slot_5",
          principal_user_id: "player-goon-b", public_name: "player-goon-b",
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
        SeatPersona: {
          game,
          slot: "slot_6",
          principal_user_id: "player-town-extra", public_name: "player-town-extra",
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
      { SeatPersona: { game: actionGame, slot: "slot_4", principal_user_id: "action-goon" , public_name: "action-goon" } },
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
        SeatPersona: {
          game: actionGame,
          slot: "slot-2",
          principal_user_id: "action-target", public_name: "action-target",
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
        SeatPersona: {
          game: actionGame,
          slot: "slot-3",
          principal_user_id: "action-town", public_name: "action-town",
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
        SeatPersona: {
          game: additionalRoomsGame,
          slot: occupant.slotId,
          principal_user_id: occupant.principalUserId, public_name: occupant.principalUserId,
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
    `SELECT channel_id, kind, slot_id, source
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

async function seedDeadChatGame() {
  const commands = [];
  commands.push(
    await sendCommand("host_h", {
      CreateGame: { game: deadChatGame, pack: "mafiascum" },
    }),
  );
  for (const occupant of [deadChatDefinition.outgoing, deadChatDefinition.living]) {
    commands.push(
      await sendCommand("host_h", {
        AddSlot: { game: deadChatGame, slot: occupant.slotId },
      }),
      await sendCommand("host_h", {
        SeatPersona: {
          game: deadChatGame,
          slot: occupant.slotId,
          principal_user_id: occupant.principalUserId, public_name: occupant.principalUserId,
        },
      }),
      await sendCommand("host_h", {
        AssignRole: {
          game: deadChatGame,
          slot: occupant.slotId,
          role_key: "vanilla_townie",
        },
      }),
    );
  }
  commands.push(
    await sendCommand("host_h", {
      StartGame: { game: deadChatGame, phase: "D01" },
    }),
  );
  return {
    game: deadChatGame,
    commands,
    deadSlot: deadChatDefinition.outgoing.slotId,
    livingSlot: deadChatDefinition.living.slotId,
    boundary:
      "The dead-chat game begins with two living occupied slots; browser proof performs the real dead, replacement, and restored-alive transitions without fixture authority rows.",
  };
}

async function seedSpectatorGame() {
  const commands = [
    await sendCommand("host_h", {
      CreateGame: { game: spectatorGame, pack: "mafiascum" },
    }),
  ];
  return {
    game: spectatorGame,
    channelId: spectatorDefinition.channelId,
    commands,
    boundary:
      "The spectator room is fixed by platform policy and becomes readable only through a host-issued SpectatorOf(game) grant; no player slot is created for this account.",
  };
}

async function seedFactionDayChatFixture() {
  const memberRows = await runSql(
    smokeDatabase.url,
    `SELECT channel_id, kind, slot_id, source
     FROM private_channel_member
     WHERE game_id = '${game}' AND channel_id = '${factionDayChatChannel}'
     ORDER BY slot_id`,
  );
  if (
    !memberRows.includes("slot-7") ||
    !memberRows.includes("slot_4") ||
    !memberRows.includes("FactionDayChat") ||
    !memberRows.includes("pack.private_channels.mafia_day_chat")
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
    INSERT INTO platform_principal (
      principal_user_id, status, global_capabilities, created_at, disabled_at
    ) VALUES ('root_admin', 'active', ARRAY[]::TEXT[], 0, NULL)
    ON CONFLICT (principal_user_id) DO NOTHING;
  `);
  await runSql(smokeDatabase.url, `
    INSERT INTO auth_account (
      account_id,
      principal_user_id,
      password_hash,
      created_at,
      disabled_at,
      global_capabilities
    )
    VALUES (
      'host-console-root-admin@local.fmarch.test',
      'root_admin',
      'seed-only-not-a-real-hash',
      0,
      NULL,
      ARRAY['GlobalAdmin']::TEXT[]
    )
    ON CONFLICT (account_id) DO NOTHING;
  `);
  await runSql(smokeDatabase.url, `
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
      global_capabilities = EXCLUDED.global_capabilities,
      idle_expires_at = EXCLUDED.idle_expires_at;
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

function registerIssuedSession(requestedToken, session) {
  issuedSessionTokens.set(requestedToken, session.sessionToken);
  const { sessionToken: _sessionToken, ...evidence } = session;
  return evidence;
}

function resolveSessionToken(token) {
  return issuedSessionTokens.get(token) ?? token;
}

async function createGrantedSessions() {
  return {
    admin: await createGrantedSession({
      sessionAlias: adminSessionToken,
      principalUserId: "admin_a",
      globalCapabilities: ["GlobalAdmin"],
    }),
    host: await createGrantedSession({
      sessionAlias: hostSessionToken,
      principalUserId: "host_h",
      globalCapabilities: ["GlobalAdmin"],
    }),
    player: await createAccountSession({
      sessionAlias: playerSessionToken,
      principalUserId: "player-mira",
      label: "player-mira",
    }),
    rolePmIncoming: await createAccountSession({
      sessionAlias: rolePmIncomingSessionToken,
      principalUserId: "player-rowan",
      label: "role-pm-incoming",
      accountId: rolePmIncomingAccountId,
    }),
    actionPlayer: await createGrantedSession({
      sessionAlias: actionPlayerSessionToken,
      principalUserId: "action-goon",
    }),
    racePlayer: await createGrantedSession({
      sessionAlias: racePlayerSessionToken,
      principalUserId: "player-goon-a",
    }),
    seedPlayer: await createGrantedSession({
      sessionAlias: seedPlayerSessionToken,
      principalUserId: "player-seed",
    }),
    targetPlayer: await createGrantedSession({
      sessionAlias: targetPlayerSessionToken,
      principalUserId: "player-target",
    }),
    goonB: await createGrantedSession({
      sessionAlias: goonBSessionToken,
      principalUserId: "player-goon-b",
    }),
    cohost: await createGrantedSession({
      sessionAlias: cohostSessionToken,
      principalUserId: "cohost_c",
    }),
  };
}

async function provisionAccountOnlyFixturePrincipals() {
  for (const principalUserId of accountOnlyFixturePrincipals) {
    await createAuthAccount({
      accountId: `live-stack-fixture-${principalUserId}-${crypto.randomUUID()}@example.test`,
      password: `live-stack fixture password ${principalUserId} ${crypto.randomUUID()}`,
      principalUserId,
    });
  }
  return [...accountOnlyFixturePrincipals];
}

async function createAdditionalRoomSessions() {
  const rooms = {};
  for (const room of additionalRoomDefinitions) {
    rooms[room.id] = {
      outgoing: await createAccountSession({
        sessionAlias: room.outgoing.sessionToken,
        principalUserId: room.outgoing.principalUserId,
        label: `${room.id}-outgoing`,
      }),
      incoming: await createAccountSession({
        sessionAlias: room.incoming.sessionToken,
        principalUserId: room.incoming.principalUserId,
        label: `${room.id}-incoming`,
      }),
    };
  }
  return {
    rooms,
    outsider: await createAccountSession({
      sessionAlias: additionalRoomOutsider.sessionToken,
      principalUserId: additionalRoomOutsider.principalUserId,
      label: "additional-rooms-outsider",
    }),
    boundary:
      "Every browser actor uses an enabled local account login and opaque session; the replacement changes game-scoped room authority without revoking the account globally.",
  };
}

async function createDeadChatSessions() {
  return {
    outgoing: await createAccountSession({
      sessionAlias: deadChatDefinition.outgoing.sessionToken,
      principalUserId: deadChatDefinition.outgoing.principalUserId,
      label: "dead-chat-outgoing",
    }),
    incoming: await createAccountSession({
      sessionAlias: deadChatDefinition.incoming.sessionToken,
      principalUserId: deadChatDefinition.incoming.principalUserId,
      label: "dead-chat-incoming",
    }),
    living: await createAccountSession({
      sessionAlias: deadChatDefinition.living.sessionToken,
      principalUserId: deadChatDefinition.living.principalUserId,
      label: "dead-chat-living",
    }),
    boundary:
      "All dead-chat actors retain enabled accounts; only current slot lifecycle and occupancy derive or revoke DeadViewer(game).",
  };
}

async function createSpectatorSession() {
  return await createAccountSession({
    sessionAlias: spectatorDefinition.sessionToken,
    principalUserId: spectatorDefinition.principalUserId,
    label: "spectator-room",
  });
}

async function driveBrowser(
  frontendBaseUrl,
  privateChannelFixture,
  additionalRoomsSeed,
  deadChatSeed,
  spectatorSeed,
  dayEventRoomSeed,
) {
  browser = await chromium.launch();
  if (dayEventRoomOnly) {
    return {
      dayEventRoom: await driveDayEventRoomScenario({
        apiBaseUrl,
        browser,
        fetchJson,
        fixture: dayEventRoomFixture,
        frontendBaseUrl,
        seed: dayEventRoomSeed,
        sendCommand,
        sessionTokenFor: resolveSessionToken,
        hostSessionToken: resolveSessionToken(hostSessionToken),
        viewport: smokeViewport,
      }),
    };
  }
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
    const deadChat = await driveDeadChatBrowser(frontendBaseUrl, deadChatSeed);
    const spectator = await driveSpectatorBrowser(frontendBaseUrl, spectatorSeed);
    const dayEventRoom = await driveDayEventRoomScenario({
      apiBaseUrl,
      browser,
      fetchJson,
      fixture: dayEventRoomFixture,
      frontendBaseUrl,
      seed: dayEventRoomSeed,
      sendCommand,
      sessionTokenFor: resolveSessionToken,
      hostSessionToken: resolveSessionToken(hostSessionToken),
      viewport: smokeViewport,
    });
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
      deadChat,
      spectator,
      dayEventRoom,
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
      value: resolveSessionToken(playerSessionToken),
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
  await page.getByTestId("player-media-composer").evaluate((node) => {
    node.open = true;
  });
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
    `${apiBaseUrl}/games/${game}/channels/${factionDayChatRoute}/thread?limit=50`,
    { headers: { authorization: `Bearer ${playerSessionToken}` } },
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
    remainingKinds: [],
    proof:
      "Occupied pack-declared Mason and Neighbor rooms each passed enabled-account browser media posting, encrypted event storage, channel-scoped live delivery, durable reload, slot-stable replacement transfer, and zero-byte stale/non-member media denial. Dead chat and spectator access are proven by lifecycle-specific evidence; no supported room family remains incomplete.",
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
  await outgoingPage.getByTestId("player-media-composer").evaluate((node) => {
    node.open = true;
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
    `${apiBaseUrl}/games/${additionalRoomsGame}/channels/${room.route}/thread?limit=50`,
    { headers: { authorization: `Bearer ${room.outgoing.sessionToken}` } },
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
      outgoing_persona_id: await hostSlotPersonaId(
        additionalRoomsGame,
        room.outgoing.slotId,
      ),
      incoming_principal_user_id: room.incoming.principalUserId,
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
    `${apiBaseUrl}/games/${additionalRoomsGame}/channels/${room.route}/thread?limit=50`,
    { headers: { authorization: `Bearer ${room.incoming.sessionToken}` } },
  );
  if (
    finalThread.posts?.length !== 2 ||
    finalThread.posts.some((post) => post.channel_id !== room.channelId)
  ) {
    throw new Error(`${room.kind} channel-scoped API history drifted: ${JSON.stringify(finalThread)}`);
  }
  await incomingContext.close();

  const encryptedStorage = await proveSealedPostStorage({
    gameId: additionalRoomsGame,
    posts: finalThread.posts,
    plaintextBodies: [room.historyBody, room.incomingBody],
    label: `${room.kind} encrypted storage`,
  });

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
    `${apiBaseUrl}/games/${additionalRoomsGame}/channels/${room.route}/thread?limit=50`,
    { headers: { authorization: `Bearer ${resolveSessionToken(token)}` } },
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

async function driveDeadChatBrowser(frontendBaseUrl, seed) {
  if (
    seed?.game !== deadChatGame ||
    seed?.deadSlot !== deadChatDefinition.outgoing.slotId ||
    seed?.livingSlot !== deadChatDefinition.living.slotId
  ) {
    throw new Error(`dead-chat seed drifted: ${JSON.stringify(seed)}`);
  }

  const preDeathOutgoing = await proveDeadChatDenial({
    frontendBaseUrl,
    token: deadChatDefinition.outgoing.sessionToken,
    principalUserId: deadChatDefinition.outgoing.principalUserId,
    actorSlot: deadChatDefinition.outgoing.slotId,
    expectedReject: "NotAuthorized",
    label: "pre-death outgoing",
  });
  const preDeathLiving = await proveDeadChatDenial({
    frontendBaseUrl,
    token: deadChatDefinition.living.sessionToken,
    principalUserId: deadChatDefinition.living.principalUserId,
    actorSlot: deadChatDefinition.living.slotId,
    expectedReject: "NotAuthorized",
    label: "pre-death living",
  });

  const death = await sendCommand("host_h", {
    SetSlotStatus: {
      game: deadChatGame,
      slot: deadChatDefinition.outgoing.slotId,
      status: "dead",
    },
  });
  const deadSession = await fetchJson(`${apiBaseUrl}/auth/session?game=${deadChatGame}`, {
    headers: {
      authorization: `Bearer ${deadChatDefinition.outgoing.sessionToken}`,
    },
  });
  if (
    !(deadSession.capabilities ?? []).some(
      (capability) =>
        capability.kind === "DeadViewer" &&
        capability.body?.game === deadChatGame,
    )
  ) {
    throw new Error(`real death did not derive DeadViewer: ${JSON.stringify(deadSession)}`);
  }

  const pageUrl = `${frontendBaseUrl}/g/${deadChatGame}/c/dead`;
  const outgoingContext = await browserContextWithSession(
    deadChatDefinition.outgoing.sessionToken,
  );
  const outgoingPage = await outgoingContext.newPage();
  const outgoingResponse = await outgoingPage.goto(pageUrl, {
    waitUntil: "networkidle",
  });
  if (outgoingResponse === null || !outgoingResponse.ok()) {
    throw new Error(
      `dead occupant route failed with ${outgoingResponse?.status() ?? "none"}`,
    );
  }
  await outgoingPage.getByTestId("player-surface").waitFor({ state: "visible" });
  const channelContext = outgoingPage.getByTestId(
    "player-command-channel-context",
  );
  await channelContext.waitFor({ state: "visible" });
  const actorState = await outgoingPage.evaluate(() => ({
    alive: window.__fmarchPlayerProjection?.commandState?.actorAlive,
    status: window.__fmarchPlayerProjection?.commandState?.actorStatus,
  }));
  if (
    (await channelContext.getAttribute("data-channel-id")) !== "dead" ||
    actorState.alive !== false ||
    actorState.status !== "dead"
  ) {
    throw new Error("dead-chat browser command context did not retain dead actor state");
  }
  const activeChannel = outgoingPage.getByTestId("player-channel-dead");
  await activeChannel.waitFor({ state: "visible" });
  if (
    (await activeChannel.getAttribute("aria-current")) !== "page" ||
    !(await activeChannel.innerText()).includes("Dead chat")
  ) {
    throw new Error("DeadViewer capability did not expose the active dead-chat rail item");
  }
  const outgoingPostButton = outgoingPage.locator('[data-action="submit_post"]');
  if (!(await outgoingPostButton.isEnabled())) {
    throw new Error("dead-chat post control remained disabled for a dead occupant");
  }

  const upload = generatedThreadMediaPng({
    ...factionDayChatUploadAsset,
    contentAddress: "live-stack-dead-chat-upload-source",
    palette: {
      ...factionDayChatUploadAsset.palette,
      accent: [88, 91, 112],
    },
  });
  await outgoingPage.getByTestId("player-media-composer").evaluate((node) => {
    node.open = true;
  });
  await outgoingPage.getByTestId("player-media-file").setInputFiles({
    name: "dead-chat-receipt.png",
    mimeType: "image/png",
    buffer: upload.bytes,
  });
  await outgoingPage
    .getByTestId("player-media-alt")
    .fill(deadChatDefinition.mediaAlt);
  await outgoingPage
    .locator('[data-testid="player-composer"] textarea')
    .fill(deadChatDefinition.historyBody);
  assertHitTarget(await outgoingPostButton.boundingBox(), "dead-chat outgoing post button");
  await outgoingPostButton.click();
  await outgoingPage.getByTestId("player-command-status").waitFor({ state: "visible" });
  await outgoingPage.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="player-command-status"]')
        ?.getAttribute("data-state") === "ack",
    null,
    { timeout: 180_000 },
  );
  await waitForPrivateThreadLiveDelta(outgoingPage, {
    channelId: "dead",
    body: deadChatDefinition.historyBody,
  });
  const outgoingOutcome = await outgoingPage.evaluate(
    () => window.__fmarchPlayerCommandStatus,
  );
  const outgoingCommand =
    outgoingOutcome?.requestEnvelope?.body?.body?.command?.SubmitPost;
  if (
    outgoingOutcome?.state !== "ack" ||
    outgoingCommand?.game !== deadChatGame ||
    outgoingCommand?.channel_id !== "dead" ||
    outgoingCommand?.actor_slot !== deadChatDefinition.outgoing.slotId ||
    outgoingCommand?.body !== deadChatDefinition.historyBody ||
    outgoingCommand?.media?.length !== 1 ||
    outgoingCommand.media[0]?.alt !== deadChatDefinition.mediaAlt ||
    !/^[0-9a-f]{64}$/u.test(String(outgoingCommand.media[0]?.content_id ?? ""))
  ) {
    throw new Error(`dead-chat browser media command drifted: ${JSON.stringify(outgoingOutcome)}`);
  }
  if (
    JSON.stringify(Object.keys(outgoingCommand.media[0]).sort()) !==
    JSON.stringify(["alt", "content_id"])
  ) {
    throw new Error("dead-chat browser command leaked non-handle media fields");
  }
  const contentId = outgoingCommand.media[0].content_id;
  const outgoingLiveDelta = await privateThreadLiveDelta(
    outgoingPage,
    deadChatDefinition.historyBody,
  );
  const initialThread = await fetchJson(
    `${apiBaseUrl}/games/${deadChatGame}/channels/dead/thread?limit=50`,
    { headers: { authorization: `Bearer ${deadChatDefinition.outgoing.sessionToken}` } },
  );
  const historyPost = initialThread.posts?.find(
    (post) => post.body === deadChatDefinition.historyBody,
  );
  if (historyPost === undefined) {
    throw new Error(`dead-chat API thread missed browser history: ${JSON.stringify(initialThread)}`);
  }
  const mediaPostSeq = Number(historyPost.source_seq ?? historyPost.sourceSeq);
  const projectedMedia = historyPost.media?.find(
    (media) => media.content_id === contentId,
  );
  assertManifestBackedPrivateMedia({
    projectedMedia,
    contentId,
    mediaPostSeq,
    gameId: deadChatGame,
    channelId: "dead",
    expectedAlt: deadChatDefinition.mediaAlt,
  });
  const privateMediaUrl = projectedMedia.variants.tablet.avif_url;

  const outgoingReload = await outgoingPage.reload({
    waitUntil: "networkidle",
    timeout: 180_000,
  });
  if (outgoingReload === null || !outgoingReload.ok()) {
    throw new Error("dead-chat outgoing reload failed");
  }
  const reloadedHistory = outgoingPage.locator(
    `[data-testid="thread-post-${mediaPostSeq}"]`,
  );
  await reloadedHistory.waitFor({ state: "visible" });
  if (!(await reloadedHistory.innerText()).includes(deadChatDefinition.historyBody)) {
    throw new Error("dead-chat outgoing reload lost encrypted history");
  }
  const outgoingMedia = await outgoingContext.request.get(
    `${frontendBaseUrl}${privateMediaUrl}`,
    { headers: { accept: "image/avif" } },
  );
  const outgoingMediaBytes = await outgoingMedia.body();
  if (outgoingMedia.status() !== 200 || outgoingMediaBytes.byteLength === 0) {
    throw new Error("dead occupant did not receive canonical dead-chat media bytes");
  }
  await outgoingContext.close();

  const replacement = await sendCommand("host_h", {
    ProcessReplacement: {
      game: deadChatGame,
      slot: deadChatDefinition.outgoing.slotId,
      outgoing_persona_id: await hostSlotPersonaId(
        deadChatGame,
        deadChatDefinition.outgoing.slotId,
      ),
      incoming_principal_user_id: deadChatDefinition.incoming.principalUserId,
    },
  });
  const incomingContext = await browserContextWithSession(
    deadChatDefinition.incoming.sessionToken,
  );
  const incomingPage = await incomingContext.newPage();
  const incomingResponse = await incomingPage.goto(pageUrl, {
    waitUntil: "networkidle",
  });
  if (incomingResponse === null || !incomingResponse.ok()) {
    throw new Error("incoming dead-slot replacement route failed");
  }
  await incomingPage.getByTestId("player-surface").waitFor({ state: "visible" });
  const incomingHistoricalPost = incomingPage.locator(
    `[data-testid="thread-post-${mediaPostSeq}"]`,
  );
  await incomingHistoricalPost.waitFor({ state: "visible" });
  if (!(await incomingHistoricalPost.innerText()).includes(deadChatDefinition.historyBody)) {
    throw new Error("incoming dead-slot replacement lost dead-chat history");
  }
  await waitForPrivateThreadLiveDelta(incomingPage, {
    channelId: "dead",
    body: deadChatDefinition.historyBody,
  });
  const incomingInitialLiveDelta = await privateThreadLiveDelta(
    incomingPage,
    deadChatDefinition.historyBody,
  );
  const incomingMedia = await incomingContext.request.get(
    `${frontendBaseUrl}${privateMediaUrl}`,
    { headers: { accept: "image/avif" } },
  );
  const incomingMediaBytes = await incomingMedia.body();
  if (incomingMedia.status() !== 200 || incomingMediaBytes.byteLength === 0) {
    throw new Error("incoming dead occupant could not read transferred media");
  }

  await incomingPage
    .locator('[data-testid="player-composer"] textarea')
    .fill(deadChatDefinition.incomingBody);
  const incomingPostButton = incomingPage.locator('[data-action="submit_post"]');
  if (!(await incomingPostButton.isEnabled())) {
    throw new Error("incoming dead occupant did not receive an enabled post control");
  }
  assertHitTarget(await incomingPostButton.boundingBox(), "dead-chat incoming post button");
  await incomingPostButton.click();
  await incomingPage.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="player-command-status"]')
        ?.getAttribute("data-state") === "ack",
  );
  await waitForPrivateThreadLiveDelta(incomingPage, {
    channelId: "dead",
    body: deadChatDefinition.incomingBody,
  });
  const incomingOutcome = await incomingPage.evaluate(
    () => window.__fmarchPlayerCommandStatus,
  );
  const incomingCommand =
    incomingOutcome?.requestEnvelope?.body?.body?.command?.SubmitPost;
  if (
    incomingOutcome?.state !== "ack" ||
    incomingCommand?.channel_id !== "dead" ||
    incomingCommand?.actor_slot !== deadChatDefinition.outgoing.slotId ||
    incomingCommand?.body !== deadChatDefinition.incomingBody
  ) {
    throw new Error(`incoming dead-chat post drifted: ${JSON.stringify(incomingOutcome)}`);
  }
  const incomingCommandLiveDelta = await privateThreadLiveDelta(
    incomingPage,
    deadChatDefinition.incomingBody,
  );
  const incomingReload = await incomingPage.reload({
    waitUntil: "networkidle",
    timeout: 180_000,
  });
  if (incomingReload === null || !incomingReload.ok()) {
    throw new Error("incoming dead-chat reload failed");
  }
  await incomingPage.getByTestId("player-surface").waitFor({ state: "visible" });
  const finalThread = await fetchJson(
    `${apiBaseUrl}/games/${deadChatGame}/channels/dead/thread?limit=50`,
    { headers: { authorization: `Bearer ${deadChatDefinition.incoming.sessionToken}` } },
  );
  if (
    finalThread.posts?.length !== 2 ||
    finalThread.posts.some((post) => post.channel_id !== "dead") ||
    !finalThread.posts.some((post) => post.body === deadChatDefinition.historyBody) ||
    !finalThread.posts.some((post) => post.body === deadChatDefinition.incomingBody)
  ) {
    throw new Error(`dead-chat reload/API history drifted: ${JSON.stringify(finalThread)}`);
  }
  await incomingContext.close();

  const encryptedStorage = await proveSealedPostStorage({
    gameId: deadChatGame,
    posts: finalThread.posts,
    plaintextBodies: [
      deadChatDefinition.historyBody,
      deadChatDefinition.incomingBody,
    ],
    label: "dead-chat encrypted storage",
  });

  const staleOutgoing = await proveDeadChatDenial({
    frontendBaseUrl,
    token: deadChatDefinition.outgoing.sessionToken,
    principalUserId: deadChatDefinition.outgoing.principalUserId,
    actorSlot: deadChatDefinition.outgoing.slotId,
    mediaUrl: privateMediaUrl,
    expectedReject: "NotYourSlot",
    label: "stale outgoing",
  });
  const living = await proveDeadChatDenial({
    frontendBaseUrl,
    token: deadChatDefinition.living.sessionToken,
    principalUserId: deadChatDefinition.living.principalUserId,
    actorSlot: deadChatDefinition.living.slotId,
    mediaUrl: privateMediaUrl,
    expectedReject: "NotAuthorized",
    label: "living account",
  });

  const restoration = await sendCommand("host_h", {
    SetSlotStatus: {
      game: deadChatGame,
      slot: deadChatDefinition.outgoing.slotId,
      status: "alive",
    },
  });
  const restoredAlive = await proveDeadChatDenial({
    frontendBaseUrl,
    token: deadChatDefinition.incoming.sessionToken,
    principalUserId: deadChatDefinition.incoming.principalUserId,
    actorSlot: deadChatDefinition.outgoing.slotId,
    mediaUrl: privateMediaUrl,
    expectedReject: "NotAuthorized",
    label: "restored-alive account",
  });
  const restoredSession = await fetchJson(
    `${apiBaseUrl}/auth/session?game=${deadChatGame}`,
    {
      headers: {
        authorization: `Bearer ${deadChatDefinition.incoming.sessionToken}`,
      },
    },
  );
  if (
    (restoredSession.capabilities ?? []).some(
      (capability) => capability.kind === "DeadViewer",
    )
  ) {
    throw new Error(`alive restoration retained DeadViewer: ${JSON.stringify(restoredSession)}`);
  }

  return {
    status: "passed",
    game: deadChatGame,
    channelId: "dead",
    preDeath: {
      outgoing: preDeathOutgoing,
      living: preDeathLiving,
    },
    death,
    derivedCapability: "DeadViewer(game)",
    outgoing: {
      principalUserId: deadChatDefinition.outgoing.principalUserId,
      submitOutcome: outgoingOutcome,
      commandLiveDelta: outgoingLiveDelta,
      recoveredAfterReload: true,
      uploadedSourceBytes: upload.bytes.byteLength,
      mediaStatus: outgoingMedia.status(),
      mediaBodyBytes: outgoingMediaBytes.byteLength,
    },
    replacement,
    incoming: {
      principalUserId: deadChatDefinition.incoming.principalUserId,
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
    living,
    restoration,
    restoredAlive,
    proof:
      "A real dead transition derived DeadViewer for the current occupant, enabled only dead-chat posting, accepted canonical browser-uploaded media, delivered channel-scoped initial and command deltas, retained encrypted slot history through reload and replacement, denied living and stale accounts at route/thread/media/append boundaries, then a real alive restoration revoked the same surfaces with zero media bytes.",
  };
}

async function driveSpectatorBrowser(frontendBaseUrl, seed) {
  if (
    seed?.game !== spectatorGame ||
    seed?.channelId !== spectatorDefinition.channelId
  ) {
    throw new Error(`spectator seed drifted: ${JSON.stringify(seed)}`);
  }

  const pageUrl = `${frontendBaseUrl}/g/${spectatorGame}/c/${spectatorDefinition.route}`;
  const preGrantContext = await browserContextWithSession(
    spectatorDefinition.sessionToken,
  );
  const preGrantPage = await preGrantContext.newPage();
  const preGrantRoute = await preGrantPage.goto(pageUrl, {
    waitUntil: "networkidle",
  });
  if (preGrantRoute === null || preGrantRoute.status() !== 403) {
    throw new Error(
      `pre-grant spectator route expected 403, got ${preGrantRoute?.status() ?? "none"}`,
    );
  }
  const preGrantThread = await preGrantContext.request.get(
    `${frontendBaseUrl}/api/gameplay/games/${spectatorGame}/channels/spectator/thread?limit=50`,
  );
  if (preGrantThread.status() !== 403) {
    throw new Error(`pre-grant spectator received thread rows (${preGrantThread.status()})`);
  }
  await preGrantContext.close();

  const grant = await sendCommand("host_h", {
    GrantSpectator: {
      game: spectatorGame,
      user: spectatorDefinition.principalUserId,
    },
  });
  const session = await fetchJson(`${apiBaseUrl}/auth/session?game=${spectatorGame}`, {
    headers: { authorization: `Bearer ${spectatorDefinition.sessionToken}` },
  });
  if (
    !(session.capabilities ?? []).some(
      (capability) =>
        capability.kind === "SpectatorOf" &&
        capability.body?.game === spectatorGame,
    )
  ) {
    throw new Error(`spectator grant did not resolve SpectatorOf: ${JSON.stringify(session)}`);
  }

  const upload = generatedThreadMediaPng({
    ...factionDayChatUploadAsset,
    contentAddress: "live-stack-spectator-notice-source",
    palette: {
      ...factionDayChatUploadAsset.palette,
      accent: [55, 98, 89],
    },
  });
  const uploadResponse = await fetchWithTimeout(
    `${apiBaseUrl}/media/uploads`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${resolveSessionToken(spectatorDefinition.sessionToken)}`,
        "content-type": "image/png",
      },
      body: upload.bytes,
    },
    180_000,
  );
  if (!uploadResponse.ok) {
    throw new Error(`spectator notice upload failed with ${uploadResponse.status}`);
  }
  const uploaded = await uploadResponse.json();
  const historyNotice = await sendCommand("host_h", {
    PublishSpectatorPost: {
      game: spectatorGame,
      body: spectatorDefinition.historyBody,
      media: [{ content_id: uploaded.content_id, alt: spectatorDefinition.mediaAlt }],
    },
  });

  const context = await browserContextWithSession(spectatorDefinition.sessionToken);
  const page = await context.newPage();
  const response = await page.goto(pageUrl, { waitUntil: "networkidle" });
  if (response === null || !response.ok()) {
    throw new Error(`spectator role URL failed with ${response?.status() ?? "none"}`);
  }
  await page.getByTestId("player-surface").waitFor({ state: "visible" });
  const activeChannel = page.getByTestId("player-channel-spectator");
  await activeChannel.waitFor({ state: "visible" });
  if ((await activeChannel.getAttribute("aria-current")) !== "page") {
    throw new Error("SpectatorOf did not expose the active spectator room rail item");
  }
  if ((await page.getByTestId("player-composer").count()) !== 0) {
    throw new Error("spectator route exposed a player composer");
  }
  if ((await page.getByTestId("player-role-card").count()) !== 0) {
    throw new Error("spectator route exposed a player role card");
  }
  if (
    (await page.getByTestId("player-command-receipt").count()) !== 0 ||
    (await page.getByTestId("player-action-submission-checkpoint").count()) !== 0
  ) {
    throw new Error("spectator route exposed player command or action state");
  }

  const thread = await fetchJson(
    `${apiBaseUrl}/games/${spectatorGame}/channels/spectator/thread?limit=50`,
    { headers: { authorization: `Bearer ${spectatorDefinition.sessionToken}` } },
  );
  const historyPost = thread.posts?.find(
    (post) => post.body === spectatorDefinition.historyBody,
  );
  if (historyPost === undefined) {
    throw new Error(`spectator history was absent: ${JSON.stringify(thread)}`);
  }
  const mediaPostSeq = Number(historyPost.source_seq ?? historyPost.sourceSeq);
  const projectedMedia = historyPost.media?.find(
    (media) => media.content_id === uploaded.content_id,
  );
  assertManifestBackedPrivateMedia({
    projectedMedia,
    contentId: uploaded.content_id,
    mediaPostSeq,
    gameId: spectatorGame,
    channelId: spectatorDefinition.channelId,
    expectedAlt: spectatorDefinition.mediaAlt,
  });
  const mediaUrl = projectedMedia.variants.tablet.avif_url;
  const loadedHistory = page.locator(`[data-testid="thread-post-${mediaPostSeq}"]`);
  await loadedHistory.waitFor({ state: "visible" });
  if (!(await loadedHistory.innerText()).includes(spectatorDefinition.historyBody)) {
    throw new Error("spectator role URL did not render host history");
  }
  await waitForPrivateThreadLiveDelta(page, {
    channelId: spectatorDefinition.channelId,
    body: spectatorDefinition.historyBody,
  });
  const initialLiveDelta = await privateThreadLiveDelta(
    page,
    spectatorDefinition.historyBody,
  );
  const allowedMedia = await context.request.get(`${frontendBaseUrl}${mediaUrl}`, {
    headers: { accept: "image/avif" },
  });
  const allowedMediaBytes = await allowedMedia.body();
  if (allowedMedia.status() !== 200 || allowedMediaBytes.byteLength === 0) {
    throw new Error("spectator did not receive canonical room media bytes");
  }

  const liveNotice = await sendCommand("host_h", {
    PublishSpectatorPost: {
      game: spectatorGame,
      body: spectatorDefinition.liveBody,
      media: [],
    },
  });
  await waitForPrivateThreadLiveDelta(page, {
    channelId: spectatorDefinition.channelId,
    body: spectatorDefinition.liveBody,
  });
  const liveDelta = await privateThreadLiveDelta(page, spectatorDefinition.liveBody);
  const finalThread = await fetchJson(
    `${apiBaseUrl}/games/${spectatorGame}/channels/spectator/thread?limit=50`,
    { headers: { authorization: `Bearer ${spectatorDefinition.sessionToken}` } },
  );
  if (
    finalThread.posts?.length !== 2 ||
    finalThread.posts.some(
      (post) => post.channel_id !== spectatorDefinition.channelId,
    ) ||
    !finalThread.posts.some(
      (post) => post.body === spectatorDefinition.historyBody,
    ) ||
    !finalThread.posts.some((post) => post.body === spectatorDefinition.liveBody)
  ) {
    throw new Error(
      `spectator channel-scoped API history drifted: ${JSON.stringify(finalThread)}`,
    );
  }
  const encryptedStorage = await proveSealedPostStorage({
    gameId: spectatorGame,
    posts: finalThread.posts,
    plaintextBodies: [
      spectatorDefinition.historyBody,
      spectatorDefinition.liveBody,
    ],
    label: "spectator encrypted storage",
  });
  const reload = await page.reload({ waitUntil: "networkidle", timeout: 180_000 });
  if (reload === null || !reload.ok()) {
    throw new Error("spectator role URL reload failed");
  }
  await page.getByTestId("player-surface").waitFor({ state: "visible" });
  const reloadedLive = page.locator(`text=${spectatorDefinition.liveBody}`);
  await reloadedLive.waitFor({ state: "visible" });

  const postAttempt = await context.request.post(`${frontendBaseUrl}/commands`, {
    data: {
      v: 1,
      id: commandEnvelopeId++,
      body: {
        kind: "Command",
        body: {
          command_id: crypto.randomUUID(),
          command: {
            SubmitPost: {
              game: spectatorGame,
              channel_id: "spectator",
              actor_slot: "invented-spectator-slot",
              body: "spectator append attempt",
              media: [],
            },
          },
        },
      },
    },
  });
  const postReject = await postAttempt.json();
  if (postReject.body?.kind !== "Reject" || postReject.body?.body?.error !== "NotAuthorized") {
    throw new Error(`spectator append did not reject at the read-only boundary: ${JSON.stringify(postReject)}`);
  }

  const deniedEndpoints = {};
  for (const [id, path] of Object.entries({
    dead: `/g/${spectatorGame}/c/dead`,
    rolePm: `/g/${spectatorGame}/c/${encodeURIComponent("private:role_pm:any")}`,
    faction: `/g/${spectatorGame}/c/${encodeURIComponent("private:mafia_day_chat")}`,
    main: `/g/${spectatorGame}`,
  })) {
    const denied = await page.goto(`${frontendBaseUrl}${path}`, { waitUntil: "networkidle" });
    if (denied === null || denied.status() !== 403) {
      throw new Error(`spectator ${id} route expected 403, got ${denied?.status() ?? "none"}`);
    }
    deniedEndpoints[id] = denied.status();
  }
  for (const [id, path] of Object.entries({
    notifications: `/api/gameplay/games/${spectatorGame}/notifications`,
    investigations: `/api/gameplay/games/${spectatorGame}/investigation-results`,
    commandState: `/api/gameplay/games/${spectatorGame}/player-command-state`,
  })) {
    const denied = await context.request.get(`${frontendBaseUrl}${path}`);
    if (denied.status() !== 403) {
      throw new Error(`spectator ${id} endpoint expected 403, got ${denied.status()}`);
    }
    deniedEndpoints[id] = denied.status();
  }

  const revoke = await sendCommand("host_h", {
    RevokeSpectator: {
      game: spectatorGame,
      user: spectatorDefinition.principalUserId,
    },
  });
  const revokedRoute = await page.goto(pageUrl, { waitUntil: "networkidle" });
  if (revokedRoute === null || revokedRoute.status() !== 403) {
    throw new Error(`revoked spectator route expected 403, got ${revokedRoute?.status() ?? "none"}`);
  }
  const revokedThread = await context.request.get(
    `${frontendBaseUrl}/api/gameplay/games/${spectatorGame}/channels/spectator/thread?limit=50`,
  );
  if (revokedThread.status() !== 403) {
    throw new Error(`revoked spectator received thread rows (${revokedThread.status()})`);
  }
  const revokedMedia = await context.request.get(`${frontendBaseUrl}${mediaUrl}`, {
    headers: { accept: "image/avif" },
  });
  const revokedMediaBytes = await revokedMedia.body();
  if (revokedMedia.status() !== 403 || revokedMediaBytes.byteLength !== 0) {
    throw new Error(
      `revoked spectator media denial drifted: ${revokedMedia.status()} bytes=${revokedMediaBytes.byteLength}`,
    );
  }
  const revokedPostAttempt = await context.request.post(`${frontendBaseUrl}/commands`, {
    data: {
      v: 1,
      id: commandEnvelopeId++,
      body: {
        kind: "Command",
        body: {
          command_id: crypto.randomUUID(),
          command: {
            SubmitPost: {
              game: spectatorGame,
              channel_id: "spectator",
              actor_slot: "invented-spectator-slot",
              body: "revoked spectator append attempt",
              media: [],
            },
          },
        },
      },
    },
  });
  const revokedPostReject = await revokedPostAttempt.json();
  if (
    revokedPostReject.body?.kind !== "Reject" ||
    revokedPostReject.body?.body?.error !== "NotAuthorized"
  ) {
    throw new Error(
      `revoked spectator append did not reject: ${JSON.stringify(revokedPostReject)}`,
    );
  }
  const sessionAfterRevoke = await fetchJson(`${apiBaseUrl}/auth/session`, {
    headers: { authorization: `Bearer ${spectatorDefinition.sessionToken}` },
  });
  if (sessionAfterRevoke.principal_user_id !== spectatorDefinition.principalUserId) {
    throw new Error(
      `spectator account session did not remain active: ${JSON.stringify(sessionAfterRevoke)}`,
    );
  }
  await context.close();

  return {
    status: "passed",
    game: spectatorGame,
    channelId: spectatorDefinition.channelId,
    derivedCapability: "SpectatorOf(game)",
    preGrant: {
      routeStatus: preGrantRoute.status(),
      threadStatus: preGrantThread.status(),
    },
    grant,
    historyNotice,
    liveNotice,
    initialMediaBodyBytes: allowedMediaBytes.byteLength,
    initialLiveDelta,
    liveDelta,
    reloadedPostBodies: [spectatorDefinition.historyBody, spectatorDefinition.liveBody],
    appendReject: postReject.body.body,
    encryptedStorage: {
      rawCheck: encryptedStorage,
      postCount: 2,
      plaintextBodyFields: 0,
      ciphertextEnvelopes: 2,
      plaintextOccurrences: 0,
    },
    deniedEndpoints,
    revoke,
    revoked: {
      routeStatus: revokedRoute.status(),
      threadStatus: revokedThread.status(),
      mediaStatus: revokedMedia.status(),
      mediaBodyBytes: revokedMediaBytes.byteLength,
      appendReject: revokedPostReject.body.body,
      accountSessionActive: true,
    },
    proof:
      "A host-issued SpectatorOf(game) grant exposed only the read-only spectator role URL. The enabled account received host-authored encrypted history, canonical media, a channel-scoped live notice, and durable reload; it had no composer or role card, could not append or read player-private surfaces, and grant revocation closed route/thread/media with zero media bytes.",
  };
}

async function proveDeadChatDenial({
  frontendBaseUrl,
  token,
  principalUserId,
  actorSlot,
  mediaUrl = null,
  expectedReject,
  label,
}) {
  const context = await browserContextWithSession(token);
  const page = await context.newPage();
  const routeResponse = await page.goto(
    `${frontendBaseUrl}/g/${deadChatGame}/c/dead`,
    { waitUntil: "networkidle" },
  );
  if (routeResponse === null || routeResponse.status() !== 403) {
    throw new Error(
      `dead-chat ${label} route expected 403, got ${routeResponse?.status() ?? "none"}`,
    );
  }
  await page.getByTestId("route-error-surface").waitFor({ state: "visible" });
  const threadResponse = await fetchWithTimeout(
    `${apiBaseUrl}/games/${deadChatGame}/channels/dead/thread?limit=50`,
    { headers: { authorization: `Bearer ${resolveSessionToken(token)}` } },
    15_000,
  );
  if (threadResponse.status !== 403) {
    throw new Error(`dead-chat ${label} received private thread rows`);
  }
  let mediaStatus = null;
  let mediaBodyBytes = 0;
  if (mediaUrl !== null) {
    const mediaResponse = await context.request.get(`${frontendBaseUrl}${mediaUrl}`, {
      headers: { accept: "image/avif" },
    });
    const mediaBytes = await mediaResponse.body();
    mediaStatus = mediaResponse.status();
    mediaBodyBytes = mediaBytes.byteLength;
    if (mediaStatus !== 403 || mediaBodyBytes !== 0) {
      throw new Error(
        `dead-chat ${label} received media: ${mediaStatus} bytes=${mediaBodyBytes}`,
      );
    }
  }
  const postResponse = await context.request.post(`${frontendBaseUrl}/commands`, {
    data: {
      v: 1,
      id: commandEnvelopeId++,
      body: {
        kind: "Command",
        body: {
          command_id: crypto.randomUUID(),
          command: {
            SubmitPost: {
              game: deadChatGame,
              channel_id: "dead",
              actor_slot: actorSlot,
              body: `${label} dead-chat post`,
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
    throw new Error(`dead-chat ${label} append was not denied: ${JSON.stringify(post)}`);
  }
  await context.close();
  return {
    principalUserId,
    authenticatedSessionRemainedActive: true,
    routeStatus: routeResponse.status(),
    threadStatus: threadResponse.status,
    mediaStatus,
    mediaBodyBytes,
    postReject: post.body.body,
  };
}

async function browserContextWithSession(token) {
  const context = await browser.newContext({ viewport: smokeViewport });
  await context.addCookies([
    {
      name: "fmarch_session",
      value: resolveSessionToken(token),
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
    `SELECT channel_id, kind, slot_id, source
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
    `${apiBaseUrl}/games/${game}/channels/${rolePmRoute}/thread?limit=50`,
    { headers: { authorization: `Bearer ${playerSessionToken}` } },
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
  const deniedToken = targetPlayerSessionToken;
  const deniedSession = {
    principalUserId: "player-target",
    authentication: "existing-enabled-account-session",
  };
  const context = await browser.newContext({ viewport: smokeViewport });
  await context.addCookies([
    {
      name: "fmarch_session",
      value: resolveSessionToken(deniedToken),
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
  const incomingContext = await browser.newContext({ viewport: smokeViewport });
  await incomingContext.addCookies([
    {
      name: "fmarch_session",
      value: resolveSessionToken(rolePmIncomingSessionToken),
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
    `${apiBaseUrl}/games/${game}/channels/${rolePmRoute}/thread?limit=50`,
    { headers: { authorization: `Bearer ${resolveSessionToken(rolePmIncomingSessionToken)}` } },
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
      value: resolveSessionToken(playerSessionToken),
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
    `${apiBaseUrl}/games/${game}/channels/${rolePmRoute}/thread?limit=50`,
    { headers: { authorization: `Bearer ${resolveSessionToken(playerSessionToken)}` } },
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
    incomingSession: {
      accountId: rolePmIncomingAccountId,
      principalUserId: fixture.incomingPrincipalUserId,
      authentication: "enabled-account-login",
    },
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
      value: resolveSessionToken(adminSessionToken),
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
  if (!["GlobalAdmin", "Site administrator"].includes(capability)) {
    throw new Error(`admin capability did not render GlobalAdmin: ${capability}`);
  }
  const supportingEvidence = page.getByTestId("admin-supporting-evidence");
  await supportingEvidence.evaluate((node) => {
    node.open = true;
  });
  const proofCard = page.locator('[data-testid^="admin-audit-"]').first();
  await proofCard.waitFor({ state: "visible" });
  const proofCardText = await proofCard.innerText();
  if (proofCardText.includes("Current local report available")) {
    throw new Error(`admin audit fell back instead of loading operator status: ${proofCardText}`);
  }
  const inspect = proofCard.locator("a").first();
  assertHitTarget(await inspect.boundingBox(), "admin audit inspect");
  const auditInspectHref = await inspect.getAttribute("href");
  const hostSetup = await driveHostSetupBrowser(page, frontendBaseUrl);

  await context.close();
  return {
    url: pageUrl,
    capability,
    proofCardText,
    auditInspectHref,
    hostSetup,
  };
}

async function driveHostSetupBrowser(page, frontendBaseUrl) {
  const adminUrl = `${frontendBaseUrl}/admin?game=${adminCreatedGame}`;
  if (page.url() !== adminUrl) {
    await page.goto(adminUrl, { waitUntil: "networkidle" });
    await page.getByTestId("admin-surface").waitFor({ state: "visible" });
  }

  await page.getByTestId("admin-inbox-task-setup-host-setup").click();
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
  const principalUserId = "player-mira";
  const publicName = "Mira";
  const roleKey = "vanilla_townie";
  const addSlotForm = page.getByTestId("host-setup-add-slot-form");
  await addSlotForm.waitFor({ state: "visible" });
  const addSlotInput = addSlotForm.locator('input[name="slotId"]');
  if ((await addSlotInput.inputValue()) !== slotId) {
    throw new Error("fresh setup route did not derive slot_1 as its next seat");
  }
  const addSlotButton = addSlotForm.getByRole("button", {
    name: "Add next seat",
  });
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
  await rosterRow
    .locator('input[name="principalUserId"]')
    .fill(principalUserId);
  await rosterRow.locator('input[name="publicName"]').fill(publicName);
  const assignSlotButton = rosterRow.getByRole("button", {
    name: "Assign player",
    exact: true,
  });
  const assignSlotBox = await assignSlotButton.boundingBox();
  assertHitTarget(assignSlotBox, "host setup assign slot");
  await assignSlotButton.click();
  const assignSlot = await waitForHostSetupCommand({
    setupPage: page,
    statusTestId: "host-setup-assign-slot-status",
    commandKind: "SeatPersona",
    commandPredicate: (command) =>
      command?.game === adminCreatedGame &&
      command?.slot === slotId &&
      command?.principal_user_id === principalUserId &&
      command?.public_name === publicName,
    statePredicate: (state) =>
      (state?.slots ?? []).some(
        (slot) =>
          slot.slotId === slotId &&
          slot.assignedPrincipalUserId === principalUserId,
      ),
  });

  await selectHostSetupStage(page, "roles");
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

  await selectHostSetupStage(page, "rules");
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
  await selectHostSetupStage(page, "review");
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
    `${apiBaseUrl}/games/${adminCreatedGame}/host-console-state?slot_id=${slotId}`,
    {
      headers: { authorization: `Bearer ${adminSessionToken}` },
    },
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
    principalUserId,
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

async function drivePlayerBrowser(frontendBaseUrl) {
  const context = await browser.newContext({ viewport: smokeViewport });
  await context.addCookies([
    {
      name: "fmarch_session",
      value: resolveSessionToken(playerSessionToken),
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
  if (!/^SLOTOCCUPANT\([^)]+\)$/iu.test(capability)) {
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
      () => window.__fmarchPlayerCommandStatus?.state === "ack",
    );
    await raceVoteSession.page.waitForFunction(
      () => window.__fmarchPlayerCommandStatus?.state === "ack",
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
      `SELECT 'VoteSubmitted' AS acknowledged_command,
              actor_slot AS actor,
              target,
              phase_id
       FROM vote_ballot
       WHERE game_id = '${game}'
         AND actor_slot IN ('slot-7', 'slot_4')
       ORDER BY actor_slot`,
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
        "Two authenticated seeded player role pages submitted distinct SubmitVote commands for slot-7 and slot_4 under a scratch append delay; both browser commands ACKed without StreamConflict, the vote_ballot projection retained one current ballot for each actor, and the stale race page recovered to authoritative votecount 3 through the player resync hook.",
    };

    playerStep = "duplicate-vote-retry";
    duplicateVoteRetry = await submitDuplicatePlayerVote(duplicateVoteSession, {
      firstOutcome: voteOutcome,
      commandId: duplicateVoteCommandId,
      expectedCount: 3,
    });
    duplicateVoteRows = await runSql(
      smokeDatabase.url,
      `SELECT 'VoteSubmitted' AS acknowledged_command,
              actor_slot AS actor,
              target,
              phase_id
       FROM vote_ballot
       WHERE game_id = '${game}'
         AND actor_slot = 'slot-7'`,
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
        "A second stale seeded player page loaded /g/{game} before the live player vote, retried SubmitVote with the same command_id after the live page ACK, received the original ACK stream seqs from command_receipt through a separate browser submission, refreshed votecount to 2, and vote_ballot retained exactly one current ballot for slot-7.",
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
      value: resolveSessionToken(sessionToken),
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
      value: resolveSessionToken(actionPlayerSessionToken),
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
  if (!/^SLOTOCCUPANT\([^)]+\)$/iu.test(capability)) {
    throw new Error(`action player capability did not render SlotOccupant: ${capability}`);
  }
  const actionCommands = page.getByTestId("player-action-commands");
  await actionCommands.waitFor({ state: "visible" });
  if (commandStateResponses.length === 0) {
    const commandStateUrl = `${frontendBaseUrl}/api/gameplay/games/${actionGame}/player-command-state?slot_id=slot_4`;
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

  const duplicateReceiptRows = await runSql(
    smokeDatabase.url,
    `SELECT 'ActionSubmitted' AS acknowledged_command,
            principal_user_id,
            command_id::text,
            stream_seqs
     FROM command_receipt
     WHERE principal_user_id = 'action-goon'
       AND command_id = '${duplicatePlayerSubmitCommandId}'::uuid`,
  );
  const actionRows = [
    duplicateReceiptRows,
    JSON.stringify(
      legalOutcome.requestEnvelope?.body?.body?.command?.SubmitAction ?? null,
    ),
    JSON.stringify(duplicateRetry.commandState.noActionCommandState),
  ].join("\n");
  if (
    !actionRows.includes("role_factional_kill") ||
    !actionRows.includes("factional_kill") ||
    !actionRows.includes("slot_4") ||
    !actionRows.includes("slot-2") ||
    actionRows.includes("invalid_self_factional_kill")
  ) {
    throw new Error(`action submission boundary evidence drifted:\n${actionRows}`);
  }
  assertSinglePlayerActionSubmittedRow(actionRows);
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
    window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "D02",
  );
  const phaseHeading = page.getByTestId("player-game-bar").locator("h1");
  await phaseHeading.waitFor({ state: "visible" });
  const postAdvancePhaseText = await phaseHeading.innerText();
  if (postAdvancePhaseText !== "Day 2") {
    throw new Error(`player phase heading did not update: ${postAdvancePhaseText}`);
  }
  const actionGameHostState = await fetchJson(
    `${apiBaseUrl}/games/${actionGame}/host-console-state?slot_id=slot-2`,
    { headers: { authorization: `Bearer ${hostSessionToken}` } },
  );
  const targetSlot = actionGameHostState.slots?.find(
    (slot) => slot.slot_id === "slot-2",
  );
  if (targetSlot?.alive !== false || targetSlot.status !== "dead") {
    throw new Error(
      `resolved factional kill did not kill slot-2: ${JSON.stringify(actionGameHostState.slots)}`,
    );
  }
  const resolutionAudit = await fetchJson(
    `${apiBaseUrl}/games/${actionGame}/resolution-audit`,
    { headers: { authorization: `Bearer ${hostSessionToken}` } },
  );
  const resolutionTraces = await fetchJson(
    `${apiBaseUrl}/games/${actionGame}/resolution-traces`,
    { headers: { authorization: `Bearer ${hostSessionToken}` } },
  );
  const matchedResolution = resolutionAudit.phases?.find(
    (phase) =>
      phase.phase_id === "N01" &&
      phase.status === "matched" &&
      phase.applied_matches === true &&
      phase.trace_matches === true &&
      Number.isSafeInteger(phase.applied_stream_seq) &&
      Number.isSafeInteger(phase.trace_stream_seq),
  );
  const inspectedTrace = resolutionTraces.traces?.find(
    (trace) =>
      trace.phase_id === "N01" &&
      Number.isSafeInteger(trace.applied_stream_seq) &&
      Number.isSafeInteger(trace.trace_stream_seq),
  );
  if (
    resolutionAudit.ok !== true ||
    Number(resolutionAudit.audited ?? 0) < 1 ||
    matchedResolution === undefined ||
    inspectedTrace === undefined
  ) {
    throw new Error(
      `action resolution audit/trace inspection drifted: ${JSON.stringify({ resolutionAudit, resolutionTraces })}`,
    );
  }
  const resolutionRows = { audit: resolutionAudit, traces: resolutionTraces };

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
      "A seeded mafiascum N01 game exposed the goon at /g/{game} with a SlotOccupant session, the browser loaded /player-command-state from the Rust API, rendered the returned phase-valid factional_kill action, clicked a typed invalid SubmitAction and recovered through a rendered Reject, clicked the legal action and received an ACK, then a stale second player page retried the legal action with the same command_id through the player route, received the original ACK stream seqs from command_receipt, and refreshed to N01/no-actions. A stale third player page submitted the same action with a distinct command_id and rendered ActionAlreadySubmitted recovery guidance while refreshing to N01/no-actions. The canonical receipt and command-state boundaries retained exactly one ActionSubmitted decision. The host then resolved that stored action through Command::ResolvePhase into a dead target slot, and the host-authorized resolution-audit plus trace-inspection APIs matched both sealed envelopes. A fourth stale player page with its live websocket blocked kept the old factional_kill control, submitted it after resolution, rendered Reject PhaseLocked with stale-projection recovery guidance, refreshed /player-command-state to locked N01/no-actions, and removed the stale action controls without a page reload. The live hydrated player page then refreshed /player-command-state to locked N01/no-actions and to D02/Day after Command::AdvancePhase.",
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
      value: resolveSessionToken(actionPlayerSessionToken),
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
      value: resolveSessionToken(hostSessionToken),
      domain: host,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const page = await context.newPage();
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      moderatorConsoleDiagnostics.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    moderatorConsoleDiagnostics.push(`pageerror: ${String(error)}`);
  });
  page.on("response", async (response) => {
    if (new URL(response.url()).pathname !== "/live/tickets") return;
    moderatorTicketDiagnostics.push({
      url: response.url(),
      status: response.status(),
      body: await response.json().catch(() => null),
    });
  });
  page.on("websocket", (socket) => {
    const diagnostic = { url: socket.url(), errors: [], frames: [] };
    moderatorSocketDiagnostics.push(diagnostic);
    socket.on("socketerror", (error) => diagnostic.errors.push(String(error)));
    socket.on("framereceived", (event) => {
      diagnostic.frames.push(String(event.payload).slice(0, 500));
    });
  });
  const pageUrl = `${frontendBaseUrl}/g/${game}/host`;
  const response = await page.goto(pageUrl, { waitUntil: "networkidle" });
  if (response === null || !response.ok()) {
    throw new Error(
      `host console route failed with ${response?.status() ?? "no response"}: ${await page.textContent("body")}`,
    );
  }
  await openHostConsoleDrawer(page, "host-supporting-evidence");
  await openHostConsoleDrawer(page, "host-invite-workflows");
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
    const taskId = expected.id === "extend_deadline" ? "deadline" : "replacement";
    await page.getByTestId(`host-task-${taskId}`).click();
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
    await confirm.click({ force: true });

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
  if (!occupantLabel.includes("Slot 7")) {
    throw new Error(`replacement persona label did not update from real API: ${occupantLabel}`);
  }
  if (!historyLabel.includes("slot-7")) {
    throw new Error(`slot history label did not preserve slot id: ${historyLabel}`);
  }
  const livePlayerInvite = await readPlayerInviteTarget(page);
  if (
    !livePlayerInvite.targetLabel.includes("Slot 7") ||
    livePlayerInvite.targetLabel.includes("player-rowan") ||
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
    `${apiBaseUrl}/games/${game}/host-console-state?slot_id=slot-7`,
    { headers: { authorization: `Bearer ${hostSessionToken}` } },
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
        -- Exercise the event-store's unique-conflict mapping without forging an
        -- event body outside the canonical Rust sealing boundary.
        RAISE EXCEPTION USING
          ERRCODE = '23505',
          MESSAGE = 'live-stack forced unique append conflict';
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
      value: resolveSessionToken(hostSessionToken),
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
  await openHostConsoleDrawer(page, "host-supporting-evidence");
  await openHostConsoleDrawer(page, "host-invite-workflows");
  await page.getByTestId("host-console-votecount").waitFor({ state: "visible" });
  return { context, page };
}

async function openHostConsoleDrawer(page, testId) {
  const drawer = page.getByTestId(testId);
  await drawer.waitFor({ state: "visible" });
  await drawer.evaluate((node) => {
    node.open = true;
  });
}

async function readPlayerInviteTarget(page) {
  return {
    targetLabel: await page.getByTestId("host-player-invite-target").textContent(),
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
  const invitedAccountId = rolePmIncomingAccountId;
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
  const taskId = actionId === "extend_deadline" ? "deadline" : "phase";
  await page.getByTestId(`host-task-${taskId}`).click();
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
  await confirm.click({ force: true });

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
  await page
    .getByTestId("host-task-queue")
    .locator('button[data-task-source-id="D01:skip_next_day:slot_1"]')
    .click();
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
  await confirm.click({ force: true });

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
  await page.getByTestId("host-task-slot-lifecycle").click();
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
  await confirm.click({ force: true });

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
      replacement?.assignedPrincipalUserId === "player-rowan" &&
      replacement?.lifecycleLabel === "Modkilled"
    );
  });

  assertModkillCommandStatus(commandStatus);
  const apiStateAfter = await fetchJson(
    `${apiBaseUrl}/games/${game}/host-console-state?slot_id=slot-7`,
    { headers: { authorization: `Bearer ${hostSessionToken}` } },
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
    lastPage = await fetchJson(`${apiBaseUrl}/games/${game}?limit=50`);
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
    throw new Error(
      `host live votecount did not reach ${count}: ${JSON.stringify({ ...debug, tickets: moderatorTicketDiagnostics, sockets: moderatorSocketDiagnostics, console: moderatorConsoleDiagnostics })}`,
    );
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

async function waitForHostConsoleReplacementDelta(page, principalUserId) {
  await page.waitForFunction(
    (expectedOccupant) =>
      (window.__fmarchHostLiveProjectionEvents ?? []).some(
        (event) =>
          event?.delta?.kind === "HostConsoleStateChanged" &&
          event.delta.body?.slots?.some(
            (slot) => slot.assigned_principal_user_id === expectedOccupant,
          ),
      ),
    principalUserId,
  );
}

async function fetchJson(url, options = {}, timeoutMs = 15000) {
  const headers = new Headers(options.headers);
  const authorization = headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    headers.set(
      "authorization",
      `Bearer ${resolveSessionToken(authorization.slice("Bearer ".length))}`,
    );
  }
  const response = await fetchWithTimeout(url, { ...options, headers }, timeoutMs);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function hostSlotPersonaId(gameId, slotId) {
  const state = await fetchJson(
    `${apiBaseUrl}/games/${gameId}/host-console-state?slot_id=${slotId}`,
    { headers: { authorization: `Bearer ${hostSessionToken}` } },
  );
  const personaId = state.slots?.find((slot) => slot.slot_id === slotId)?.persona_id;
  if (typeof personaId !== "string" || !personaId.startsWith("gp_")) {
    throw new Error(
      `host console did not project an opaque game persona for ${slotId}: ${JSON.stringify(state.slots)}`,
    );
  }
  return personaId;
}

async function proveSealedPostStorage({
  gameId,
  posts,
  plaintextBodies,
  label,
}) {
  if (!Array.isArray(posts) || posts.length === 0) {
    throw new Error(`${label} requires projected posts`);
  }
  const sourceSeqs = posts.map((post) => {
    const sourceSeq = Number(post.source_seq ?? post.sourceSeq);
    if (!Number.isSafeInteger(sourceSeq) || sourceSeq <= 0) {
      throw new Error(
        `${label} received an invalid projected source seq: ${JSON.stringify(post)}`,
      );
    }
    return sourceSeq;
  });
  if (new Set(sourceSeqs).size !== sourceSeqs.length) {
    throw new Error(`${label} projected duplicate source seqs: ${sourceSeqs}`);
  }
  if (
    !Array.isArray(plaintextBodies) ||
    plaintextBodies.length !== posts.length ||
    plaintextBodies.some(
      (body) => typeof body !== "string" || body.length === 0,
    )
  ) {
    throw new Error(`${label} requires one non-empty plaintext canary per post`);
  }

  const plaintextPredicate = plaintextBodies
    .map(
      (body) =>
        `position(convert_to(${sqlLiteral(body)}, 'UTF8') in sealed_body) > 0`,
    )
    .join(" OR ");
  const rawCheck = await runSqlScalar(
    smokeDatabase.url,
    `SELECT concat(
       count(*)::text, '|',
       (SELECT count(*)::text
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'events'
           AND column_name IN ('payload', 'actor', 'causation_id', 'meta')), '|',
       count(*) FILTER (
         WHERE sealed_version = 2
           AND octet_length(sealed_kid) BETWEEN 1 AND 128
           AND sealed_kid = btrim(sealed_kid)
           AND octet_length(sealed_nonce) = 24
           AND octet_length(sealed_body) >= 16
       )::text, '|',
       count(*) FILTER (WHERE ${plaintextPredicate})::text)
     FROM events
     WHERE stream_id = ${sqlLiteral(gameId)}::uuid
       AND kind = 'PostSubmitted'
       AND seq IN (${sourceSeqs.join(", ")})`,
  );
  const expected = `${posts.length}|0|${posts.length}|0`;
  if (rawCheck !== expected) {
    throw new Error(`${label} proof drifted: ${rawCheck}, expected ${expected}`);
  }
  return rawCheck;
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
  if (state.slots?.[0]?.assigned_principal_user_id !== "player-rowan") {
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
  if (slot.assigned_principal_user_id !== "player-rowan") {
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

function canonicalSessionToken(seed) {
  return `fmss_${hashSessionToken(seed)}`;
}

process.on("uncaughtException", (error) => {
  if (error.serverOutput) {
    console.error("\n--- server output tail ---");
    console.error(error.serverOutput);
  }
  throw error;
});
