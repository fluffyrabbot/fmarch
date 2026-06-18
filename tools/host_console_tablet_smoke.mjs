import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontendRoot = path.join(repoRoot, "frontend");
const artifactDir = path.join(repoRoot, "target", "host-console-tablet-smoke");
const evidencePath = path.join(artifactDir, "tablet-critical-path.json");
const smokeViewport = Object.freeze({ width: 1024, height: 768 });
const frontendRequire = createRequire(path.join(frontendRoot, "package.json"));

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
const pageUrl = `${baseUrl}/g/tablet-smoke/host`;

let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: smokeViewport });
  await page.goto(pageUrl, { waitUntil: "networkidle" });

  const trigger = page.getByTestId("critical-host-action-trigger");
  await trigger.waitFor({ state: "visible" });

  const triggerBox = await trigger.boundingBox();
  assertHitTarget(triggerBox, "critical host action trigger");

  await trigger.click();

  const eventsBeforeConfirm = await page.evaluate(
    () => window.__fmarchHostActionEvents.length,
  );
  if (eventsBeforeConfirm !== 0) {
    throw new Error(
      `host action dispatched before confirmation: ${eventsBeforeConfirm}`,
    );
  }

  const confirmation = page.getByTestId("critical-host-action-confirmation");
  await confirmation.waitFor({ state: "visible" });

  const confirmationMessage = await page
    .getByTestId("critical-host-action-confirmation-message")
    .innerText();
  if (!confirmationMessage.includes("Day 2")) {
    throw new Error(`confirmation did not name object: ${confirmationMessage}`);
  }
  if (!confirmationMessage.includes("close thread and enter night")) {
    throw new Error(`confirmation did not name outcome: ${confirmationMessage}`);
  }

  const confirm = page.getByTestId("critical-host-action-confirm");
  const confirmBox = await confirm.boundingBox();
  assertHitTarget(confirmBox, "critical host action confirm");
  await confirm.click();

  const dispatchEvents = await page.evaluate(
    () => window.__fmarchHostActionEvents,
  );
  if (dispatchEvents.length !== 1) {
    throw new Error(`expected one dispatch, got ${dispatchEvents.length}`);
  }
  if (dispatchEvents[0].actionId !== "advance-phase") {
    throw new Error(`unexpected dispatched action: ${dispatchEvents[0].actionId}`);
  }

  const evidence = {
    status: "passed",
    url: pageUrl,
    viewport: smokeViewport,
    triggerBox,
    confirmBox,
    confirmationMessage,
    dispatchedAction: dispatchEvents[0],
  };
  await mkdir(artifactDir, { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`wrote ${path.relative(repoRoot, evidencePath)}`);
} finally {
  if (browser !== undefined) {
    await browser.close();
  }
  await server.close();
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
