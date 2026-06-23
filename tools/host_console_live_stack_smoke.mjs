import { spawn } from "node:child_process";
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

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontendRoot = path.join(repoRoot, "frontend");
const artifactDir = path.join(repoRoot, "target", "host-console-live-stack-smoke");
const evidencePath = path.join(artifactDir, "live-stack-proof.json");
const databaseUrl = process.env.DATABASE_URL;
const host = "127.0.0.1";
const smokeViewport = Object.freeze({ width: 1024, height: 768 });
const game = crypto.randomUUID();
const adminCreatedGame = crypto.randomUUID();
const hostSessionToken = `host-console-live-stack-host-${crypto.randomUUID()}`;
const playerSessionToken = `host-console-live-stack-player-${crypto.randomUUID()}`;
const adminSessionToken = `host-console-live-stack-admin-${crypto.randomUUID()}`;
const cohostSessionToken = `host-console-live-stack-cohost-${crypto.randomUUID()}`;
const grantedGlobalModToken = `session-grant-${adminCreatedGame}`;
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
const previousDevAuth = process.env.FMARCH_DEV_AUTH;
process.env.FMARCH_HOST_CONSOLE_SMOKE_AUTH = "1";
process.env.FMARCH_API_BASE_URL = apiBaseUrl;
process.env.FMARCH_DEV_AUTH = "1";
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
      FMARCH_DEV_AUTH: "1",
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
  await writeProgress({ stage: "seed-private-channel-fixture", game });
  const privateChannelFixture = await seedPrivateChannelFixture();
  await writeProgress({ stage: "create-dev-sessions", game });
  const devSessions = await createDevSessions();

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
  const browserEvidence = await driveBrowser(frontendBaseUrl);
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
    privateChannelFixture,
    devSessions,
    browser: browserEvidence,
    playerVoteCount,
    apiState,
  };
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
  if (previousDevAuth === undefined) {
    delete process.env.FMARCH_DEV_AUTH;
  } else {
    process.env.FMARCH_DEV_AUTH = previousDevAuth;
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
          role_key: "vanilla_townie",
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
          role_key: "mafia_goon",
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

async function seedPrivateChannelFixture() {
  const mediaPostSeq = 100000;
  const rolePmSeedBody = "Role PM tablet media seed from live API";
  const media = [
    {
      id: "live-role-pm-receipt",
      kind: "image",
      alt: "Live role PM tablet receipt",
      variants: {
        tablet: {
          url: "/media/live-stack/thread/live-role-pm-receipt-tablet.png",
          width: 960,
          height: 720,
        },
        small: {
          url: "/media/live-stack/thread/live-role-pm-receipt-small.png",
          width: 480,
          height: 360,
        },
        original: {
          url: "/media/live-stack/thread/live-role-pm-receipt-original.png",
          width: 4000,
          height: 3000,
        },
      },
    },
  ];
  await runSql(smokeDatabase.url, `
    INSERT INTO private_channel_member (
      game_id, channel_id, kind, slot_id, role_key, reveals_alignment, source
    )
    VALUES (
      '${game}', 'role-pm', 'role_pm', 'slot-7', 'vanilla_townie', 'never',
      'host-console-live-stack-smoke'
    )
    ON CONFLICT (game_id, channel_id, slot_id) DO UPDATE SET
      role_key = EXCLUDED.role_key,
      reveals_alignment = EXCLUDED.reveals_alignment,
      source = EXCLUDED.source;

    INSERT INTO thread_view (
      game_id, source_seq, stream_seq, channel_id, author_slot, author_user,
      phase_id, body, media, occurred_at
    )
    VALUES (
      '${game}', ${mediaPostSeq}, ${mediaPostSeq}, 'role-pm', 'slot-7', NULL,
      'D01', ${sqlLiteral(rolePmSeedBody)}, ${sqlLiteral(JSON.stringify(media))}::jsonb,
      1781928000
    )
    ON CONFLICT (game_id, source_seq) DO UPDATE SET
      channel_id = EXCLUDED.channel_id,
      author_slot = EXCLUDED.author_slot,
      author_user = EXCLUDED.author_user,
      phase_id = EXCLUDED.phase_id,
      body = EXCLUDED.body,
      media = EXCLUDED.media,
      occurred_at = EXCLUDED.occurred_at;
  `);
  return {
    channelId: "role-pm",
    memberSlot: "slot-7",
    memberPrincipalUserId: "player-mira",
    mediaPostSeq,
    rolePmSeedBody,
    media,
    boundary:
      "scratch database setup metadata only; role-PM SubmitPost ACK is driven through the real SvelteKit UI and Rust /commands path",
  };
}

async function createDevSessions() {
  return {
    admin: await createDevSession({
      token: adminSessionToken,
      principalUserId: "admin_a",
      globalCapabilities: ["GlobalAdmin"],
    }),
    host: await createDevSession({
      token: hostSessionToken,
      principalUserId: "host_h",
    }),
    player: await createDevSession({
      token: playerSessionToken,
      principalUserId: "player-mira",
    }),
    cohost: await createDevSession({
      token: cohostSessionToken,
      principalUserId: "cohost_c",
    }),
  };
}

async function createDevSession({ token, principalUserId, globalCapabilities = [] }) {
  const session = await fetchJson(`${apiBaseUrl}/auth/dev-session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
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

async function driveBrowser(frontendBaseUrl) {
  browser = await chromium.launch();
  const adminEvidence = await driveAdminBrowser(frontendBaseUrl);
  const moderatorSession = await openModeratorBrowser(frontendBaseUrl);
  let playerEvidence;
  let moderatorEvidence;
  try {
    await waitForHostLiveVotecount(moderatorSession.page, 1);
    playerEvidence = await drivePlayerBrowser(frontendBaseUrl);
    const playerPrivateChannelEvidence =
      await drivePlayerPrivateChannelBrowser(frontendBaseUrl);
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
      playerPrivateChannel: playerPrivateChannelEvidence,
      privateChannelForbidden: privateChannelForbiddenEvidence,
      moderator: moderatorEvidence,
      playerVoteCountAfterPlayer,
    };
  } finally {
    await moderatorSession.context.close();
  }
}

async function drivePlayerPrivateChannelBrowser(frontendBaseUrl) {
  const mediaRequests = [];
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
  const pageUrl = `${frontendBaseUrl}/g/${game}/c/role-pm`;
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
  if (channelContextId !== "role-pm") {
    throw new Error(
      `role-PM channel context did not render: ${JSON.stringify({ channelContextId, channelContextText })}`,
    );
  }
  const seededPost = page.locator('[data-testid="thread-post-100000"]');
  await seededPost.waitFor({ state: "visible" });
  const seededPostText = await seededPost.innerText();
  if (!seededPostText.includes("Role PM tablet media seed from live API")) {
    throw new Error(`role-PM live API seed post did not render: ${seededPostText}`);
  }
  const mediaBoundary = page.getByTestId("thread-post-media-boundary-100000");
  await mediaBoundary.waitFor({ state: "visible" });
  const mediaFigure = page.getByTestId("thread-post-media-live-role-pm-receipt");
  await mediaFigure.waitFor({ state: "visible" });
  assertVisibleBox(await mediaFigure.boundingBox(), "role-PM tablet media figure");
  await page.waitForFunction(
    () => {
      const img = document.querySelector(
        '[data-testid="thread-post-media-live-role-pm-receipt"] img',
      );
      return img?.complete === true && img.naturalWidth > 0;
    },
  );
  const mediaAttributes = await page.evaluate(() => {
    const img = document.querySelector(
      '[data-testid="thread-post-media-live-role-pm-receipt"] img',
    );
    return {
      src: img?.getAttribute("src") ?? null,
      srcset: img?.getAttribute("srcset") ?? null,
      sizes: img?.getAttribute("sizes") ?? null,
      naturalWidth: img?.naturalWidth ?? null,
      naturalHeight: img?.naturalHeight ?? null,
    };
  });
  assertTabletMediaEvidence({ mediaAttributes, mediaRequests });
  const mediaBoundaryStatus = await mediaBoundary.getAttribute("data-boundary-status");

  const textarea = page.locator('[data-testid="player-composer"] textarea');
  await textarea.fill("Role PM received from live-stack smoke");
  const postButton = page.locator('[data-action="submit_post"]');
  assertHitTarget(await postButton.boundingBox(), "role-PM post button");
  await postButton.click();
  const status = page.getByTestId("player-command-status");
  await status.waitFor({ state: "visible" });
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="player-command-status"]')
        ?.getAttribute("data-state") === "ack",
  );
  await page.waitForFunction(() =>
    window.__fmarchPlayerProjection?.thread?.posts?.some(
      (post) => post.body === "Role PM received from live-stack smoke",
    ),
  );
  const submitPostOutcome = await page.evaluate(
    () => window.__fmarchPlayerCommandStatus,
  );
  assertRolePmSubmitPostOutcome(submitPostOutcome);
  const privateThreadPage = await fetchJson(
    `${apiBaseUrl}/games/${game}/channels/role-pm/thread?principal_user_id=player-mira&limit=50`,
  );
  if (
    !privateThreadPage.posts?.some(
      (post) => post.body === "Role PM received from live-stack smoke",
    )
  ) {
    throw new Error(`role-PM API thread missing submitted post: ${JSON.stringify(privateThreadPage)}`);
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
      mediaTestId: "thread-post-media-live-role-pm-receipt",
      renderedSrc: mediaAttributes.src,
      renderedSrcset: mediaAttributes.srcset,
      renderedSizes: mediaAttributes.sizes,
      naturalWidth: mediaAttributes.naturalWidth,
      naturalHeight: mediaAttributes.naturalHeight,
      requests: mediaRequests,
      proof:
        "Live-stack browser rendered tablet/small role-PM media variants returned by the Rust thread API, requested the tablet image from the SvelteKit media endpoint at 1024px, and kept original/full/desktop URLs out of rendered attributes and request evidence.",
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
  await createDevSession({
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
  const pageUrl = `${frontendBaseUrl}/g/${game}/c/role-pm`;
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

  const voteButton = page.getByText("Vote slot-2", { exact: true });
  const voteButtonBox = await voteButton.boundingBox();
  assertHitTarget(voteButtonBox, "player vote button");
  await voteButton.click();
  const status = page.getByTestId("player-command-status");
  await status.waitFor({ state: "visible" });
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="player-command-status"]')
        ?.getAttribute("data-state") === "ack",
  );
  try {
    await page.waitForFunction(() => {
      return window.__fmarchLiveProjectionEvents?.some(
        (event) =>
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

    const withdrawButton = page.getByText("Withdraw vote", { exact: true });
    const withdrawButtonBox = await withdrawButton.boundingBox();
    assertHitTarget(withdrawButtonBox, "player withdraw button");
    await withdrawButton.click();
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
    await page.evaluate(async () => window.__fmarchTriggerPlayerResync(9002));
    await page.waitForFunction(() => {
      const events = window.__fmarchLiveProjectionEvents ?? [];
      return events.some(
        (event) =>
          event?.kind === "resync-required" &&
          event.fromSeq === 9002 &&
          event.state === "recovered",
      );
    });
    await page.waitForFunction(() => {
      const projection = window.__fmarchPlayerProjection;
      return projection?.votecount?.some(
        (row) => row.target === "slot-2" && row.count === 1,
      );
    });
  } catch (error) {
    const debug = {
      statusText: await status.innerText(),
      statusState: await status.getAttribute("data-state"),
      projection: await page.evaluate(() => window.__fmarchPlayerProjection),
      apiVoteCount: await fetchJson(`${apiBaseUrl}/games/${game}/votecount`),
    };
    throw new Error(`player projection did not refresh after ack: ${JSON.stringify(debug)}`);
  }

  const projection = await page.evaluate(() => window.__fmarchPlayerProjection);
  const liveProjectionEvents = await page.evaluate(
    () => window.__fmarchLiveProjectionEvents,
  );
  const commandStatus = await status.innerText();
  await context.close();
  return {
    url: pageUrl,
    capability,
    firstPostText,
    commandStatus,
    projection,
    liveProjectionEvents,
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

  const evidence = {
    url: pageUrl,
    actions: actionEvidence,
    hostPrompt: {
      issueCommands: hostPromptIssueCommands,
      ...hostPromptEvidence,
    },
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

function assertRolePmSubmitPostOutcome(outcome) {
  if (outcome?.state !== "ack") {
    throw new Error(`role-PM SubmitPost did not ACK: ${JSON.stringify(outcome)}`);
  }
  const command = outcome.requestEnvelope?.body?.body?.command?.SubmitPost;
  if (command?.game !== game) {
    throw new Error(`role-PM SubmitPost used wrong game: ${JSON.stringify(command)}`);
  }
  if (command.channel_id !== "role-pm") {
    throw new Error(`role-PM SubmitPost used wrong channel: ${JSON.stringify(command)}`);
  }
  if (command.actor_slot !== "slot-7") {
    throw new Error(`role-PM SubmitPost used wrong actor slot: ${JSON.stringify(command)}`);
  }
  if (command.body !== "Role PM received from live-stack smoke") {
    throw new Error(`role-PM SubmitPost used wrong body: ${JSON.stringify(command)}`);
  }
}

function assertTabletMediaEvidence({ mediaAttributes, mediaRequests }) {
  const rendered = [
    mediaAttributes?.src,
    mediaAttributes?.srcset,
    ...mediaRequests.map((request) => request.pathname),
  ].join("\n");
  if (!rendered.includes("live-role-pm-receipt-tablet.png")) {
    throw new Error(`tablet media variant was not rendered/requested: ${rendered}`);
  }
  if (!rendered.includes("live-role-pm-receipt-small.png")) {
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
