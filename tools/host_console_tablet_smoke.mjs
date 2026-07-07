import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { createRequire } from "node:module";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontendRoot = path.join(repoRoot, "frontend");
const artifactDir = path.join(repoRoot, "target", "host-console-tablet-smoke");
const evidencePath = path.join(artifactDir, "tablet-host-actions.json");
const smokeViewport = Object.freeze({ width: 1024, height: 768 });
const smokeGame = randomUUID();
const hostPrincipal = "host_h";
const sessionToken = `host-tablet-smoke-${randomUUID()}`;
const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://fmarch:fmarch@localhost:5544/fmarch";
const frontendRequire = createRequire(path.join(frontendRoot, "package.json"));
const criticalActions = Object.freeze([
  Object.freeze({
    id: "extend_deadline",
    objectLabel: "Day 2 deadline",
    outcomeLabel: "move the deadline to June 19, 2026 at 9:00 PM PT",
    commandVariant: "ExtendDeadline",
    expectedResult: "ack",
  }),
  Object.freeze({
    id: "process_replacement",
    objectLabel: "Slot 7 / Mira",
    outcomeLabel: "replace Mira with Rowan and preserve slot history",
    commandVariant: "ProcessReplacement",
    expectedResult: "ack",
  }),
  Object.freeze({
    id: "modkill_slot",
    objectLabel: "Slot 7",
    outcomeLabel: "set lifecycle to modkilled",
    commandVariant: "SetSlotStatus",
    expectedStatus: "modkilled",
    expectedResult: "ack",
  }),
]);

const apiPort = await freePort();
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const previousApiBaseUrl = process.env.FMARCH_API_BASE_URL;
process.env.FMARCH_API_BASE_URL = apiBaseUrl;

process.chdir(frontendRoot);

let rustServer;
let viteServer;
let browser;
let smokeDatabase;
let serverOutput = "";

try {
  await mkdir(artifactDir, { recursive: true });
  smokeDatabase = await createSmokeDatabase(databaseUrl);
  rustServer = startRustServer(apiPort);
  await waitForHealth(`${apiBaseUrl}/healthz`);
  await seedLiveHostGame();

  const { createServer: createViteServer } = await import(
    frontendRequire.resolve("vite")
  );
  viteServer = await createViteServer({
    root: frontendRoot,
    server: {
      host: "127.0.0.1",
      port: 0,
      strictPort: false,
      proxy: {
        "/auth": apiBaseUrl,
        "/commands": apiBaseUrl,
        "/games": apiBaseUrl,
      },
    },
    logLevel: "error",
  });
  await viteServer.listen();

  const address = viteServer.httpServer?.address();
  if (address === null || typeof address !== "object") {
    throw new Error("SvelteKit smoke server did not expose a TCP address");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const pageUrl = `${baseUrl}/g/${smokeGame}/host`;

  browser = await chromium.launch();

  const unauthorizedPage = await browser.newPage({ viewport: smokeViewport });
  const unauthorizedResponse = await unauthorizedPage.goto(pageUrl, {
    waitUntil: "networkidle",
  });
  if (unauthorizedResponse?.status() !== 403) {
    throw new Error(
      `expected unauthorized host console request to return 403, got ${unauthorizedResponse?.status()}`,
    );
  }
  const unauthorizedText = await unauthorizedPage.textContent("body");
  if (
    !unauthorizedText?.includes("authenticated host session") &&
    !unauthorizedText?.includes(`Host console for ${smokeGame} requires`)
  ) {
    throw new Error(`403 page did not explain host auth or capability requirement`);
  }
  await unauthorizedPage.close();

  const context = await browser.newContext({ viewport: smokeViewport });
  await context.addCookies([
    {
      name: "fmarch_session",
      value: sessionToken,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const page = await context.newPage();
  await page.goto(pageUrl, { waitUntil: "networkidle" });
  const votecountRow = page.getByTestId("host-console-votecount-row-slot-target");
  await votecountRow.waitFor({ state: "visible" });
  assertHitTarget(await votecountRow.boundingBox(), "host votecount row");
  const initialVotecountLabel = await votecountRow.innerText();
  if (!initialVotecountLabel.includes("slot-target") || !initialVotecountLabel.includes("1/")) {
    throw new Error(`host votecount row did not render projected ballot: ${initialVotecountLabel}`);
  }
  const votecountBoundary = await page
    .getByTestId("host-console-votecount-boundary")
    .getAttribute("data-command");
  if (votecountBoundary !== "official-votecount-live-ws") {
    throw new Error(`host votecount boundary drifted: ${votecountBoundary}`);
  }

  const actionEvidence = [];

  for (const [index, expectedAction] of criticalActions.entries()) {
    const actionRoot = page.getByTestId(`critical-host-action-${expectedAction.id}`);
    const trigger = actionRoot.getByTestId("critical-host-action-trigger");
    await trigger.waitFor({ state: "visible" });

    const triggerBox = await trigger.boundingBox();
    assertHitTarget(triggerBox, `${expectedAction.id} trigger`);

    await trigger.click();

    const eventsBeforeConfirm = await page.evaluate(
      () => window.__fmarchHostActionEvents.length,
    );
    if (eventsBeforeConfirm !== index) {
      throw new Error(
        `${expectedAction.id} dispatched before confirmation: ${eventsBeforeConfirm}`,
      );
    }

    const confirmation = actionRoot.getByTestId(
      "critical-host-action-confirmation",
    );
    await confirmation.waitFor({ state: "visible" });

    const confirmationMessage = await actionRoot
      .getByTestId("critical-host-action-confirmation-message")
      .innerText();
    if (!confirmationMessage.includes(expectedAction.objectLabel)) {
      throw new Error(
        `${expectedAction.id} confirmation did not name object: ${confirmationMessage}`,
      );
    }
    if (!confirmationMessage.includes(expectedAction.outcomeLabel)) {
      throw new Error(
        `${expectedAction.id} confirmation did not name outcome: ${confirmationMessage}`,
      );
    }

    const confirm = actionRoot.getByTestId("critical-host-action-confirm");
    const confirmBox = await confirm.boundingBox();
    assertHitTarget(confirmBox, `${expectedAction.id} confirm`);
    await confirm.click();

    const dispatchEvents = await page.evaluate(
      () => window.__fmarchHostActionEvents,
    );
    if (dispatchEvents.length !== index + 1) {
      throw new Error(
        `expected ${index + 1} dispatches, got ${dispatchEvents.length}`,
      );
    }
    const dispatchedAction = dispatchEvents[index];
    if (dispatchedAction.actionId !== expectedAction.id) {
      throw new Error(
        `unexpected dispatched action: ${dispatchedAction.actionId}`,
      );
    }
    if (dispatchedAction.payload.kind !== expectedAction.id) {
      throw new Error(
        `${expectedAction.id} dispatched with payload kind ${dispatchedAction.payload.kind}`,
      );
    }

    const commandStatus = page.getByTestId(
      `host-command-status-${expectedAction.id}`,
    );
    await commandStatus.waitFor({ state: "visible" });
    await page.waitForFunction(
      ({ actionId, expectedResult }) => {
        const status = document.querySelector(
          `[data-testid="host-command-status-${actionId}"]`,
        );
        return status?.getAttribute("data-state") === expectedResult;
      },
      {
        actionId: expectedAction.id,
        expectedResult: expectedAction.expectedResult,
      },
    );
    const statusState = await commandStatus.getAttribute("data-state");
    const statusMessage = await commandStatus.innerText();
    if (statusState !== expectedAction.expectedResult) {
      throw new Error(
        `${expectedAction.id} rendered ${statusState}, expected ${expectedAction.expectedResult}: ${statusMessage}`,
      );
    }
    if (
      expectedAction.expectedResult === "ack" &&
      !/Ack: stream seqs \d+/.test(statusMessage)
    ) {
      throw new Error(`${expectedAction.id} ack did not render stream seqs`);
    }

    const commandOutcomes = await page.evaluate(
      () => window.__fmarchHostCommandOutcomes,
    );
    const commandOutcome = commandOutcomes[index];
    assertCommandEnvelope(commandOutcome.requestEnvelope, expectedAction);

    actionEvidence.push({
      ...expectedAction,
      triggerBox,
      confirmBox,
      confirmationMessage,
      dispatchedAction,
      commandEnvelope: commandOutcome.requestEnvelope,
      serverEnvelope: commandOutcome.serverEnvelope,
      streamSeqs: commandOutcome.streamSeqs,
      statusState,
      statusMessage,
    });
  }

  const duplicateAck = await postJson(
    `${apiBaseUrl}/commands`,
    actionEvidence[0].commandEnvelope,
  );
  const duplicateStreamSeqs = duplicateAck.body?.body?.stream_seqs ?? [];
  if (
    JSON.stringify(duplicateStreamSeqs) !==
    JSON.stringify(actionEvidence[0].streamSeqs)
  ) {
    throw new Error("durable command receipt did not return the original ack");
  }

  const deadlineLabel = await page.getByTestId("host-console-deadline").innerText();
  if (!deadlineLabel.includes("Jun 19, 2026") || !deadlineLabel.includes("9:00 PM")) {
    throw new Error(`deadline label did not update from projection: ${deadlineLabel}`);
  }
  const occupantLabel = await page
    .getByTestId("host-console-slot-occupant")
    .innerText();
  if (occupantLabel !== "player-rowan") {
    throw new Error(`replacement occupant did not update: ${occupantLabel}`);
  }
  const lifecycleLabel = await page
    .getByTestId("host-console-slot-lifecycle")
    .innerText();
  if (lifecycleLabel !== "Modkilled") {
    throw new Error(`slot lifecycle did not update: ${lifecycleLabel}`);
  }
  const historyLabel = await page.getByTestId("host-console-history").innerText();
  if (!historyLabel.includes("slot-7")) {
    throw new Error(`slot history label did not preserve slot id: ${historyLabel}`);
  }

  const dispatchEvents = await page.evaluate(
    () => window.__fmarchHostActionEvents,
  );
  const commandOutcomes = await page.evaluate(
    () => window.__fmarchHostCommandOutcomes,
  );
  const evidence = {
    status: "passed",
    url: pageUrl,
    apiBaseUrl,
    game: smokeGame,
    viewport: smokeViewport,
    unauthorized: {
      status: 403,
    },
    actions: actionEvidence,
    dispatchedActions: dispatchEvents,
    commandOutcomes,
    duplicateReceiptProof: {
      commandId: actionEvidence[0].commandEnvelope.body.body.command_id,
      streamSeqs: duplicateStreamSeqs,
    },
    projectionLabels: {
      deadlineLabel,
      occupantLabel,
      lifecycleLabel,
      historyLabel,
      initialVotecountLabel,
      votecountBoundary,
    },
  };
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`wrote ${path.relative(repoRoot, evidencePath)}`);
} catch (error) {
  error.serverOutput = serverOutput.slice(-4000);
  throw error;
} finally {
  if (browser !== undefined) {
    await browser.close();
  }
  if (viteServer !== undefined) {
    await viteServer.close();
  }
  if (rustServer !== undefined) {
    await stopChild(rustServer);
  }
  if (smokeDatabase !== undefined) {
    await dropSmokeDatabase(smokeDatabase);
  }
  if (previousApiBaseUrl === undefined) {
    delete process.env.FMARCH_API_BASE_URL;
  } else {
    process.env.FMARCH_API_BASE_URL = previousApiBaseUrl;
  }
}

function startRustServer(port) {
  const child = spawn("cargo", ["run", "-p", "server"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      DATABASE_URL: smokeDatabase.url,
      FMARCH_BIND: `127.0.0.1:${port}`,
      FMARCH_DEV_AUTH: "1",
      RUST_LOG: process.env.RUST_LOG ?? "warn",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
  return child;
}

async function createSmokeDatabase(sourceDatabaseUrl) {
  const source = new URL(sourceDatabaseUrl);
  const admin = new URL(sourceDatabaseUrl);
  admin.pathname = "/postgres";
  const smoke = new URL(sourceDatabaseUrl);
  const sourceName = source.pathname.replace(/^\/+/, "") || "fmarch";
  const name = `${sanitizeDatabaseName(sourceName)}_tablet_${process.pid}_${Date.now()}`;
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

function sanitizeDatabaseName(name) {
  const sanitized = name.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase();
  const prefix = sanitized === "" ? "fmarch" : sanitized;
  return prefix.slice(0, 24);
}

async function seedLiveHostGame() {
  await postJson(`${apiBaseUrl}/auth/dev-session`, {
    token: sessionToken,
    principal_user_id: hostPrincipal,
    expires_at: 4_102_444_800,
  });
  await postCommand(1, hostPrincipal, {
    CreateGame: { game: smokeGame, pack: "mafiascum" },
  });
  await postCommand(2, hostPrincipal, {
    AddSlot: { game: smokeGame, slot: "slot-7" },
  });
  await postCommand(3, hostPrincipal, {
    AssignSlot: { game: smokeGame, slot: "slot-7", user: "player-mira" },
  });
  await postCommand(4, hostPrincipal, {
    AssignRole: {
      game: smokeGame,
      slot: "slot-7",
      role_key: "vanilla_townie",
    },
  });
  await postCommand(5, hostPrincipal, {
    AddSlot: { game: smokeGame, slot: "slot-target" },
  });
  await postCommand(6, hostPrincipal, {
    AssignSlot: {
      game: smokeGame,
      slot: "slot-target",
      user: "player-target",
    },
  });
  await postCommand(7, hostPrincipal, {
    AssignRole: {
      game: smokeGame,
      slot: "slot-target",
      role_key: "vanilla_townie",
    },
  });
  await postCommand(8, hostPrincipal, {
    StartGame: { game: smokeGame, phase: "D01" },
  });
  await postCommand(9, "player-mira", {
    SubmitPost: {
      game: smokeGame,
      channel_id: "main",
      actor_slot: "slot-7",
      body: "Slot 7 history before replacement",
    },
  });
  await postCommand(10, "player-mira", {
    SubmitVote: {
      game: smokeGame,
      actor_slot: "slot-7",
      target: {
        Slot: "slot-target",
      },
    },
  });
}

async function postCommand(id, principalUserId, command) {
  const envelope = {
    v: 1,
    id,
    body: {
      kind: "Command",
      body: {
        command_id: randomUUID(),
        principal_user_id: principalUserId,
        command,
      },
    },
  };
  const response = await postJson(`${apiBaseUrl}/commands`, envelope);
  if (response.body?.kind !== "Ack") {
    throw new Error(`seed command ${Object.keys(command)[0]} rejected`);
  }
  return response;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function waitForHealth(url) {
  const deadline = Date.now() + 30_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw lastError ?? new Error(`timed out waiting for ${url}`);
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

function assertCommandEnvelope(envelope, expectedAction) {
  if (envelope.v !== 1) {
    throw new Error(`${expectedAction.id} command used protocol ${envelope.v}`);
  }
  if (envelope.body?.kind !== "Command") {
    throw new Error(`${expectedAction.id} did not send a Command frame`);
  }
  const commandBody = envelope.body.body;
  if (commandBody.principal_user_id !== hostPrincipal) {
    throw new Error(
      `${expectedAction.id} command principal was ${commandBody.principal_user_id}`,
    );
  }
  if (!isUuid(commandBody.command_id)) {
    throw new Error(`${expectedAction.id} command_id was not a UUID`);
  }
  const command = commandBody.command;
  const variant = Object.keys(command)[0];
  if (variant !== expectedAction.commandVariant) {
    throw new Error(
      `${expectedAction.id} sent ${variant}, expected ${expectedAction.commandVariant}`,
    );
  }
  const commandPayload = command[variant];
  if (commandPayload.game !== smokeGame) {
    throw new Error(`${expectedAction.id} command game was ${commandPayload.game}`);
  }
  if (
    expectedAction.expectedStatus !== undefined &&
    commandPayload.status !== expectedAction.expectedStatus
  ) {
    throw new Error(
      `${expectedAction.id} command status was ${commandPayload.status}, expected ${expectedAction.expectedStatus}`,
    );
  }
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = createNetServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (!address || typeof address === "string") {
          reject(new Error("could not allocate a free TCP port"));
          return;
        }
        resolve(address.port);
      });
    });
  });
}
