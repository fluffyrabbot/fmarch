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

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontendRoot = path.join(repoRoot, "frontend");
const artifactDir = path.join(repoRoot, "target", "host-console-live-stack-smoke");
const evidencePath = path.join(artifactDir, "live-stack-proof.json");
const databaseUrl = process.env.DATABASE_URL;
const host = "127.0.0.1";
const smokeViewport = Object.freeze({ width: 1024, height: 768 });
const game = crypto.randomUUID();
const actionGame = crypto.randomUUID();
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
const factionDayChatSeedBody = "Faction day chat tablet media seed from live API";
const factionDayChatMediaId = "live-faction-day-chat-receipt";
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
const previousSmokeAuth = process.env.FMARCH_HOST_CONSOLE_SMOKE_AUTH;
const previousApiBaseUrl = process.env.FMARCH_API_BASE_URL;
process.env.FMARCH_HOST_CONSOLE_SMOKE_AUTH = "1";
process.env.FMARCH_API_BASE_URL = apiBaseUrl;
process.chdir(frontendRoot);

try {
  await mkdir(artifactDir, { recursive: true });
  await writeProgress({ stage: "create-temp-database" });
  smokeDatabase = await createSmokeDatabase(databaseUrl);

  await writeProgress({ stage: "start-rust-server", apiPort });
  server = spawn("cargo", ["run", "-p", "server"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      DATABASE_URL: smokeDatabase.url,
      FMARCH_BIND: `${host}:${apiPort}`,
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
  await writeProgress({ stage: "seed-faction-day-chat-fixture", game });
  const privateChannelFixture = await seedFactionDayChatFixture();
  await writeProgress({ stage: "seed-root-admin-session" });
  const rootAdminSession = await seedRootAdminSession();
  await writeProgress({ stage: "create-granted-sessions", game });
  const grantedSessions = await createGrantedSessions();

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
  const browserEvidence = await driveBrowser(frontendBaseUrl, privateChannelFixture);
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
    privateChannelFixture,
    rootAdminSession,
    grantedSessions,
    browser: browserEvidence,
    playerVoteCount,
    apiState,
    slotLifecycleApiState,
  };
  const readiness = buildLiveStackReadiness(evidence);
  assertLiveStackReadiness(readiness);
  evidence.readiness = readiness;
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  await writeProgress({ stage: "complete", evidencePath });
  console.log(`wrote ${path.relative(repoRoot, evidencePath)}`);
} catch (error) {
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
  if (server !== undefined) {
    await stopChild(server, "rust server");
  }
  if (smokeDatabase !== undefined) {
    await writeProgress({ stage: "drop-temp-database", database: smokeDatabase.name });
    await dropSmokeDatabase(smokeDatabase);
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
          target: { Slot: "slot-2" },
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

async function seedFactionDayChatFixture() {
  const media = [
    {
      id: factionDayChatMediaId,
      kind: "image",
      alt: "Live faction day chat tablet receipt",
      variants: {
        tablet: {
          url: liveStackThreadMediaUrl(factionDayChatMediaId, "tablet"),
          width: 960,
          height: 720,
        },
        small: {
          url: liveStackThreadMediaUrl(factionDayChatMediaId, "small"),
          width: 480,
          height: 360,
        },
        original: {
          url: liveStackThreadMediaUrl(factionDayChatMediaId, "original"),
          width: 4000,
          height: 3000,
        },
      },
    },
  ];
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
  const mediaCommand = await sendCommand("player-mira", {
    SubmitPost: {
      game,
      channel_id: factionDayChatChannel,
      actor_slot: "slot-7",
      body: factionDayChatSeedBody,
      media,
    },
  });
  const privateThreadPage = await fetchJson(
    `${apiBaseUrl}/games/${game}/channels/${encodeURIComponent(
      factionDayChatChannel,
    )}/thread?principal_user_id=player-mira&limit=25`,
  );
  const mediaPost = privateThreadPage.posts?.find(
    (post) =>
      post.body === factionDayChatSeedBody &&
      post.media?.some((item) => item.id === factionDayChatMediaId),
  );
  if (mediaPost === undefined) {
    throw new Error(
      `media SubmitPost did not project into private thread: ${JSON.stringify(privateThreadPage)}`,
    );
  }
  const mediaPostSeq = Number(mediaPost.source_seq ?? mediaPost.sourceSeq);
  const mediaPostStreamSeq = Number(mediaPost.stream_seq ?? mediaPost.streamSeq);
  if (!Number.isFinite(mediaPostSeq) || mediaPostSeq <= 0) {
    throw new Error(`projected media post missing source_seq: ${JSON.stringify(mediaPost)}`);
  }
  return {
    channelId: factionDayChatChannel,
    roomType: "FactionDayChat",
    memberSlot: "slot-7",
    memberPrincipalUserId: "player-mira",
    commandDeclaredMembers: ["slot-7", "slot_4"],
    mediaPostSeq,
    mediaPostStreamSeq,
    factionDayChatSeedBody,
    media,
    mediaCommand,
    boundary:
      "membership is declared by mafiascum StartGame commands; the tablet/small media reference is ingested through a real SubmitPost /commands ACK and projected through the Rust ThreadPage before SvelteKit serves reference-checked bytes",
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
    player: await createGrantedSession({
      token: playerSessionToken,
      principalUserId: "player-mira",
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

async function driveBrowser(frontendBaseUrl, privateChannelFixture) {
  browser = await chromium.launch();
  const adminEvidence = await driveAdminBrowser(frontendBaseUrl);
  const moderatorSession = await openModeratorBrowser(frontendBaseUrl);
  let playerEvidence;
  let moderatorEvidence;
  try {
    await waitForHostLiveVotecount(moderatorSession.page, 1);
    playerEvidence = await drivePlayerBrowser(frontendBaseUrl);
    const playerActionEvidence = await drivePlayerActionBrowser(frontendBaseUrl);
    const playerPrivateChannelEvidence =
      await drivePlayerPrivateChannelBrowser(frontendBaseUrl, privateChannelFixture);
    const privateChannelForbiddenEvidence =
      await drivePrivateChannelForbiddenBrowser(frontendBaseUrl);
    await waitForHostLiveVotecountEvent(moderatorSession.page, 2);
    await waitForHostLiveVotecountAfter(moderatorSession.page, 1, 2);
    await triggerHostResync(moderatorSession.page, 9001);
    const playerVoteCountAfterPlayer = await fetchJson(
      `${apiBaseUrl}/games/${game}/votecount`,
    );
    moderatorEvidence = await driveModeratorBrowser(moderatorSession);
    return {
      admin: adminEvidence,
      player: playerEvidence,
      playerAction: playerActionEvidence,
      playerPrivateChannel: playerPrivateChannelEvidence,
      privateChannelForbidden: privateChannelForbiddenEvidence,
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
    if (pathname.startsWith("/media/live-stack/thread/")) {
      mediaRequests.push({
        url: request.url(),
        pathname,
        resourceType: request.resourceType(),
      });
    }
  });
  context.on("response", (response) => {
    const pathname = new URL(response.url()).pathname;
    if (!pathname.startsWith("/media/live-stack/thread/")) {
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
          etag: headers.etag ?? null,
          bodyBytes: body.byteLength,
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
  const seededPost = page.locator(
    `[data-testid="thread-post-${privateChannelFixture.mediaPostSeq}"]`,
  );
  await seededPost.waitFor({ state: "visible" });
  const seededPostText = await seededPost.innerText();
  if (!seededPostText.includes(factionDayChatSeedBody)) {
    throw new Error(`faction day chat live API seed post did not render: ${seededPostText}`);
  }
  const mediaBoundary = page.getByTestId(
    `thread-post-media-boundary-${privateChannelFixture.mediaPostSeq}`,
  );
  await mediaBoundary.waitFor({ state: "visible" });
  const mediaFigure = page.getByTestId(`thread-post-media-${factionDayChatMediaId}`);
  await mediaFigure.waitFor({ state: "visible" });
  assertVisibleBox(await mediaFigure.boundingBox(), "faction day chat tablet media figure");
  await page.waitForFunction(
    (mediaTestId) => {
      const img = document.querySelector(`[data-testid="${mediaTestId}"] img`);
      return img?.complete === true && img.naturalWidth > 0;
    },
    `thread-post-media-${factionDayChatMediaId}`,
  );
  const mediaAttributes = await page.evaluate((mediaTestId) => {
    const img = document.querySelector(`[data-testid="${mediaTestId}"] img`);
    return {
      src: img?.getAttribute("src") ?? null,
      srcset: img?.getAttribute("srcset") ?? null,
      sizes: img?.getAttribute("sizes") ?? null,
      naturalWidth: img?.naturalWidth ?? null,
      naturalHeight: img?.naturalHeight ?? null,
    };
  }, `thread-post-media-${factionDayChatMediaId}`);
  await Promise.allSettled(mediaResponseTasks);
  assertTabletMediaEvidence({
    mediaAttributes,
    mediaRequests,
    mediaResponses,
    mediaPostSeq: privateChannelFixture.mediaPostSeq,
  });
  const mediaBoundaryStatus = await mediaBoundary.getAttribute("data-boundary-status");

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
  );
  await page.waitForFunction((expectedBody) =>
    window.__fmarchPlayerProjection?.thread?.posts?.some(
      (post) => post.body === expectedBody,
    ),
    factionDayChatPostBody,
  );
  const submitPostOutcome = await page.evaluate(
    () => window.__fmarchPlayerCommandStatus,
  );
  assertFactionDayChatSubmitPostOutcome(submitPostOutcome);
  const privateThreadPage = await fetchJson(
    `${apiBaseUrl}/games/${game}/channels/${factionDayChatRoute}/thread?principal_user_id=player-mira&limit=50`,
  );
  if (
    !privateThreadPage.posts?.some(
      (post) => post.body === factionDayChatPostBody,
    )
  ) {
    throw new Error(`faction day chat API thread missing submitted post: ${JSON.stringify(privateThreadPage)}`);
  }

  const projection = await page.evaluate(() => window.__fmarchPlayerProjection);
  const commandStatus = await status.innerText();
  const evidence = {
    url: pageUrl,
    channelContextId,
    channelContextText,
    seededPostText,
    media: {
      boundaryStatus: mediaBoundaryStatus,
      mediaTestId: `thread-post-media-${factionDayChatMediaId}`,
      renderedSrc: mediaAttributes.src,
      renderedSrcset: mediaAttributes.srcset,
      renderedSizes: mediaAttributes.sizes,
      naturalWidth: mediaAttributes.naturalWidth,
      naturalHeight: mediaAttributes.naturalHeight,
      requests: mediaRequests,
      responses: mediaResponses,
      proof:
        "Live-stack browser rendered tablet/small faction-day-chat media variants returned by the Rust thread API, requested and loaded the tablet PNG from the SvelteKit media endpoint at 1024px, observed immutable/content-addressed variant headers and real response bytes, and kept original/full/desktop URLs out of rendered attributes and request/response evidence.",
    },
    submitPost: {
      commandStatus,
      outcome: submitPostOutcome,
      apiThreadPostBodies: privateThreadPage.posts.map((post) => post.body),
    },
    projection,
  };
  await context.close();
  return evidence;
}

async function drivePrivateChannelForbiddenBrowser(frontendBaseUrl) {
  const deniedToken = `host-console-live-stack-denied-${crypto.randomUUID()}`;
  await createGrantedSession({
    token: deniedToken,
    principalUserId: "player-target",
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
  const deniedMediaUrl = `${frontendBaseUrl}${liveStackThreadMediaUrl(
    factionDayChatMediaId,
    "tablet",
  )}`;
  const deniedMediaResponse = await context.request.get(deniedMediaUrl, {
    headers: { accept: "image/png" },
  });
  if (deniedMediaResponse.status() !== 403) {
    throw new Error(
      `private channel media expected 403 for non-member, got ${deniedMediaResponse.status()}: ${await deniedMediaResponse.text()}`,
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
    media: {
      url: deniedMediaUrl,
      status: deniedMediaResponse.status(),
      proof:
        "Non-member session could render the private-channel 403 recovery page but could not fetch the referenced private-channel tablet media variant.",
    },
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
  };
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
        event.delta.body?.candidate_slot === "slot-2" &&
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
  const voteButton = page.getByText("Vote slot-2", { exact: true });
  const voteButtonBox = await voteButton.boundingBox();
  assertHitTarget(voteButtonBox, "player vote button");
  const raceVoteButton = raceVoteSession.page.getByText("Vote slot-2", { exact: true });
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
          event.delta.body?.candidate_slot === "slot-2" &&
          event.delta.body?.count === 3,
      );
    });
    await page.waitForFunction(() => {
      const projection = window.__fmarchPlayerProjection;
      return projection?.votecount?.some(
        (row) => row.target === "slot-2" && row.count === 3,
      );
    });
    await raceVoteSession.page.waitForFunction(() =>
      typeof window.__fmarchTriggerPlayerResync === "function",
    );
    await raceVoteSession.page.evaluate(() => window.__fmarchTriggerPlayerResync(0));
    await raceVoteSession.page.waitForFunction(() =>
      window.__fmarchPlayerProjection?.votecount?.some(
        (row) => row.target === "slot-2" && row.count === 3,
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
          event.delta.body?.candidate_slot === "slot-2" &&
          event.delta.body?.count === 3,
      );
      return events.some(
        (event, index) =>
          index > countThreeIndex &&
          event?.delta?.kind === "VoteCountChanged" &&
          event.delta.body?.candidate_slot === "slot-2" &&
          event.delta.body?.count === 2,
      );
    });
    await page.waitForFunction(() => {
      const projection = window.__fmarchPlayerProjection;
      return projection?.votecount?.some(
        (row) => row.target === "slot-2" && row.count === 2,
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
          event.delta.body?.candidate_slot === "slot-2" &&
          event.delta.body?.count === 2,
      );
      return events.some(
        (event, index) =>
          index > countTwoIndex &&
          event?.delta?.kind === "VoteCountChanged" &&
          event.delta.body?.candidate_slot === "slot-2" &&
          event.delta.body?.count === 1,
      );
    });
    await page.waitForFunction(() => {
      const projection = window.__fmarchPlayerProjection;
      return projection?.votecount?.some(
        (row) => row.target === "slot-2" && row.count === 1,
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
        "A stale seeded player page loaded /g/{game} with live WebSocket disabled before LockThread, kept the old Vote slot-2 control, submitted it after the host locked D01, rendered Reject PhaseLocked with stale-projection recovery guidance, refreshed /player-command-state to D01 locked for slot-7, and the host unlocked the phase before the moderator proof continued.",
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
  const staleButton = page.getByText("Vote slot-2", { exact: true });
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
        (row) => row.target === "slot-2" && row.count === count,
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
  await page.getByText("Vote slot-2", { exact: true }).waitFor({
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
  const staleButton = page.getByText("Vote slot-2", { exact: true });
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

async function submitStalePlayerAction(staleSession) {
  const { page, commandStateRequests, commandStateResponses, commandStateResponseTasks } =
    staleSession;
  const staleButton = page.locator('[data-action="submit_action:factional_kill"]');
  assertHitTarget(await staleButton.boundingBox(), "stale player action button");
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
  await page.waitForFunction(
    () => document.querySelector('[data-testid="player-action-commands"]') === null,
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
  await page.waitForFunction(
    () => document.querySelector('[data-testid="player-action-commands"]') === null,
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

async function driveModeratorBrowser({ page, pageUrl }) {
  const phaseControlEvidence = await driveHostPhaseControlsBrowser(page, pageUrl);
  const streamConflictEvidence = await driveHostStreamConflictBrowser(page);
  const actionEvidence = [];
  for (const expected of [
    { id: "extend_deadline", status: "ack" },
    { id: "process_replacement", status: "ack" },
  ]) {
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
  const apiStateBeforePrompt = await fetchJson(
    `${apiBaseUrl}/games/${game}/host-console-state?principal_user_id=host_h&slot_id=slot-7`,
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
      "host,votecount,hostPrompts",
    );
    await waitForProjectionRequests(projectionRequests, [
      "/host-console-state",
      "/votecount",
      "/host-prompts",
    ]);
    return {
      ...conflictEvidence,
      projectionRefreshRequests: projectionRequests,
      dispatchBridgePlan: await page.evaluate(
        () => window.__fmarchHostCommandDispatchBridgePlan,
      ),
      proof:
        "The live host page hit a scratch-DB forced same-stream append conflict through the real ExtendDeadline control, rendered retryable Reject StreamConflict copy with reload-and-retry guidance, and refreshed host, votecount, and host-prompt projections before the normal retry path.",
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
  await expectHostPhaseActions(page, ["lock_thread"]);
  await expectHostPhaseActions(staleSession.page, ["lock_thread"]);
  const lockEvidence = await confirmHostAction(page, "lock_thread");
  await waitForHostConsolePhaseLocked(page, true);
  await expectHostPhaseActions(page, ["unlock_thread", "advance_phase"]);
  await expectHostPhaseActions(staleSession.page, ["lock_thread"]);
  const staleLockEvidence = await confirmHostAction(
    staleSession.page,
    "lock_thread",
    "reject",
  );
  await waitForHostProjectionPhaseLocked(staleSession.page, true);
  await expectHostPhaseActions(staleSession.page, ["unlock_thread", "advance_phase"]);
  const unlockEvidence = await confirmHostAction(page, "unlock_thread");
  await waitForHostConsolePhaseLocked(page, false);
  await expectHostPhaseActions(page, ["lock_thread"]);
  await staleSession.context.close();

  return {
    initialActions: ["lock_thread"],
    lockedActions: ["unlock_thread", "advance_phase"],
    staleActionsBeforeReject: ["lock_thread"],
    staleActionsAfterRejectRefresh: ["unlock_thread", "advance_phase"],
    restoredActions: ["lock_thread"],
    lock: lockEvidence,
    staleLockReject: staleLockEvidence,
    unlock: unlockEvidence,
    proof:
      "The hydrated host route rendered phase controls from projected host phase state: open D01 showed Lock only, LockThread ACK refreshed the live page to locked controls with Unlock and Advance, a second stale host page with its live websocket blocked submitted the old Lock control and recovered through a rendered Reject PhaseLocked plus host projection refresh to Unlock/Advance, and UnlockThread ACK restored Lock without a page reload.",
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

  const status = page.getByTestId(`host-command-status-${actionId}`);
  await status.waitFor({ state: "visible" });
  await page.waitForFunction(
    (expectedActionId) =>
      window.__fmarchHostCommandStatuses?.[expectedActionId]?.state === "ack",
    actionId,
  );
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

  const commandStatus = await page.evaluate(
    (expectedActionId) => window.__fmarchHostCommandStatuses?.[expectedActionId],
    actionId,
  );
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
    statusMessage: await status.innerText(),
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
            event.delta.body?.candidate_slot === "slot-2" &&
            event.delta.body?.count === expectedCount,
        ),
      count,
    );
    await page.waitForFunction(
      (expectedCount) =>
        window.__fmarchHostVotecountProjection?.some(
          (row) => row.target === "slot-2" && row.count === expectedCount,
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

async function waitForHostLiveVotecountEvent(page, count) {
  try {
    await page.waitForFunction(
      (expectedCount) =>
        window.__fmarchHostLiveProjectionEvents?.some(
          (event) =>
            event?.delta?.kind === "VoteCountChanged" &&
            event.delta.body?.candidate_slot === "slot-2" &&
            event.delta.body?.count === expectedCount,
        ),
      count,
    );
  } catch (error) {
    const debug = await page.evaluate(() => ({
      endpoint: window.__fmarchHostLiveProjectionEndpoint,
      events: window.__fmarchHostLiveProjectionEvents,
      projection: window.__fmarchHostVotecountProjection,
    }));
    throw new Error(`host live votecount event did not include ${count}: ${JSON.stringify(debug)}`);
  }
}

async function waitForHostLiveVotecountAfter(page, count, previousCount) {
  await page.waitForFunction(
    ({ expectedCount, afterCount }) => {
      const events = window.__fmarchHostLiveProjectionEvents ?? [];
      const previousIndex = events.findIndex(
        (event) =>
          event?.delta?.kind === "VoteCountChanged" &&
          event.delta.body?.candidate_slot === "slot-2" &&
          event.delta.body?.count === afterCount,
      );
      return events.some(
        (event, index) =>
          index > previousIndex &&
          event?.delta?.kind === "VoteCountChanged" &&
          event.delta.body?.candidate_slot === "slot-2" &&
          event.delta.body?.count === expectedCount,
      );
    },
    { expectedCount: count, afterCount: previousCount },
  );
  await page.waitForFunction(
    (expectedCount) =>
      window.__fmarchHostVotecountProjection?.some(
        (row) => row.target === "slot-2" && row.count === expectedCount,
      ),
    count,
  );
}

async function triggerHostResync(page, fromSeq) {
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
  await page.waitForFunction(() =>
    window.__fmarchHostVotecountProjection?.some(
      (row) => row.target === "slot-2" && row.count === 1,
    ),
  );
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
      delta?.body?.candidate_slot === "slot-2" &&
      delta.body.count === 1,
  );
  if (vote === undefined) {
    throw new Error(`player vote did not update API votecount: ${JSON.stringify(deltas)}`);
  }
}

function assertPlayerVoteSubmitOutcome(
  outcome,
  { actorSlot = "slot-7", targetSlot = "slot-2", label = "player SubmitVote" } = {},
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
  if (!voteRows.includes("slot-7") || !voteRows.includes("slot-2") || !voteRows.includes("D01")) {
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
  if (!voteRows.includes("slot-2") || !voteRows.includes("D01")) {
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
  const expected = "stale projection, refresh and use current controls";
  if (!String(outcome?.message ?? "").includes(expected)) {
    throw new Error(`stale player action did not explain recovery in outcome: ${JSON.stringify(outcome)}`);
  }
  if (!String(statusMessage ?? "").includes(expected)) {
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
  if (command.target?.Slot !== "slot-2") {
    throw new Error(`stale player vote used wrong target: ${JSON.stringify(command)}`);
  }
}

function assertStalePlayerVoteRecoveryMessage({ outcome, statusMessage }) {
  const expected = "stale projection, refresh and use current controls";
  if (!String(outcome?.message ?? "").includes(expected)) {
    throw new Error(`stale player vote did not explain recovery in outcome: ${JSON.stringify(outcome)}`);
  }
  if (!String(statusMessage ?? "").includes(expected)) {
    throw new Error(`stale player vote did not render recovery guidance: ${statusMessage}`);
  }
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

function assertTabletMediaEvidence({ mediaAttributes, mediaRequests, mediaResponses, mediaPostSeq }) {
  const rendered = [
    mediaAttributes?.src,
    mediaAttributes?.srcset,
    ...mediaRequests.map((request) => request.pathname),
    ...mediaResponses.map((response) => response.pathname),
  ].join("\n");
  if (!rendered.includes("live-faction-day-chat-receipt-tablet.png")) {
    throw new Error(`tablet media variant was not rendered/requested: ${rendered}`);
  }
  if (!rendered.includes("live-faction-day-chat-receipt-small.png")) {
    throw new Error(`small media variant was not present in rendered/requested evidence: ${rendered}`);
  }
  for (const forbidden of ["original", "full", "desktop"]) {
    if (rendered.includes(forbidden)) {
      throw new Error(`forbidden media variant leaked into evidence (${forbidden}): ${rendered}`);
    }
  }
  if (Number(mediaAttributes?.naturalWidth ?? 0) <= 0) {
    throw new Error(`tablet media image did not load: ${JSON.stringify(mediaAttributes)}`);
  }
  const tabletResponse = mediaResponses.find((response) =>
    response.pathname.endsWith("live-faction-day-chat-receipt-tablet.png"),
  );
  if (tabletResponse === undefined) {
    throw new Error(`tablet media response was not observed: ${JSON.stringify(mediaResponses)}`);
  }
  if (
    tabletResponse.status !== 200 ||
    tabletResponse.contentType !== "image/png" ||
    tabletResponse.variant !== "tablet" ||
    tabletResponse.contentAddress !== "live-stack-thread-faction-day-chat-receipt-canonical-raster" ||
    tabletResponse.channel !== factionDayChatChannel ||
    tabletResponse.postSeq !== String(mediaPostSeq) ||
    tabletResponse.reference !== `${game}/${factionDayChatChannel}/${mediaPostSeq}/${factionDayChatMediaId}`
  ) {
    throw new Error(`tablet media response metadata drifted: ${JSON.stringify(tabletResponse)}`);
  }
  if (tabletResponse.cacheControl !== "private, max-age=31536000, immutable") {
    throw new Error(`tablet media cache policy drifted: ${JSON.stringify(tabletResponse)}`);
  }
  if (Number(tabletResponse.bodyBytes ?? 0) <= 1000) {
    throw new Error(`tablet media response still looks like a shim: ${JSON.stringify(tabletResponse)}`);
  }
}

function liveStackThreadMediaUrl(mediaId, variant) {
  const params = new URLSearchParams({
    game,
    channel: factionDayChatChannel,
  });
  return `/media/live-stack/thread/${mediaId}-${variant}.png?${params}`;
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
