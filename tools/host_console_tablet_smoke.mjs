import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontendRoot = path.join(repoRoot, "frontend");
const artifactDir = path.join(repoRoot, "target", "host-console-tablet-smoke");
const evidencePath = path.join(artifactDir, "tablet-host-actions.json");
const smokeViewport = Object.freeze({ width: 1024, height: 768 });
const smokeGame = "00000000-0000-0000-0000-000000000123";
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
    expectedResult: "reject",
  }),
]);

const previousSmokeAuth = process.env.FMARCH_HOST_CONSOLE_SMOKE_AUTH;
process.env.FMARCH_HOST_CONSOLE_SMOKE_AUTH = "1";

process.chdir(frontendRoot);

const { createServer: createViteServer } = await import(
  frontendRequire.resolve("vite")
);

const server = await createViteServer({
  root: frontendRoot,
  server: {
    host: "127.0.0.1",
    port: 0,
    strictPort: false,
  },
  logLevel: "error",
});

await server.listen();
const address = server.httpServer?.address();
if (address === null || typeof address !== "object") {
  throw new Error("SvelteKit smoke server did not expose a TCP address");
}
const { port } = address;
const baseUrl = `http://127.0.0.1:${port}`;
const pageUrl = `${baseUrl}/g/${smokeGame}/host`;

let browser;
try {
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
  if (!unauthorizedText?.includes(`Host console for ${smokeGame} requires`)) {
    throw new Error(`403 page did not explain host capability requirement`);
  }
  await unauthorizedPage.close();

  const page = await browser.newPage({ viewport: smokeViewport });
  await page.setExtraHTTPHeaders({
    "x-fmarch-smoke-host-game": smokeGame,
  });
  const commandRequests = [];
  await page.route("**/commands", async (route) => {
    const envelope = route.request().postDataJSON();
    commandRequests.push(envelope);
    const command = envelope.body.body.command;
    const variant = Object.keys(command)[0];
    const body =
      variant === "ExtendDeadline"
        ? { kind: "Ack", body: { stream_seqs: [101, 102] } }
        : {
            kind: "Reject",
            body: {
              error: "UnknownSlot",
              retryable: false,
              message: "unknown replacement slot",
            },
          };

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        v: 1,
        id: envelope.id,
        body,
      }),
    });
  });

  await page.goto(pageUrl, { waitUntil: "networkidle" });

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
      !statusMessage.includes("101, 102")
    ) {
      throw new Error(`${expectedAction.id} ack did not render stream seqs`);
    }
    if (
      expectedAction.expectedResult === "reject" &&
      !statusMessage.includes("UnknownSlot")
    ) {
      throw new Error(`${expectedAction.id} reject did not render server error`);
    }

    const commandEnvelope = commandRequests[index];
    assertCommandEnvelope(commandEnvelope, expectedAction);

    actionEvidence.push({
      ...expectedAction,
      triggerBox,
      confirmBox,
      confirmationMessage,
      dispatchedAction,
      commandEnvelope,
      statusState,
      statusMessage,
    });
  }

  const dispatchEvents = await page.evaluate(
    () => window.__fmarchHostActionEvents,
  );
  const evidence = {
    status: "passed",
    url: pageUrl,
    viewport: smokeViewport,
    unauthorized: {
      status: 403,
    },
    actions: actionEvidence,
    dispatchedActions: dispatchEvents,
    commandRequests,
  };
  await mkdir(artifactDir, { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`wrote ${path.relative(repoRoot, evidencePath)}`);
} finally {
  if (browser !== undefined) {
    await browser.close();
  }
  await server.close();
  if (previousSmokeAuth === undefined) {
    delete process.env.FMARCH_HOST_CONSOLE_SMOKE_AUTH;
  } else {
    process.env.FMARCH_HOST_CONSOLE_SMOKE_AUTH = previousSmokeAuth;
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

function assertCommandEnvelope(envelope, expectedAction) {
  if (envelope.v !== 1) {
    throw new Error(`${expectedAction.id} command used protocol ${envelope.v}`);
  }
  if (envelope.body?.kind !== "Command") {
    throw new Error(`${expectedAction.id} did not send a Command frame`);
  }
  const commandBody = envelope.body.body;
  if (commandBody.principal_user_id !== "host-smoke") {
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
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
