import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { assertDevTestGameSeedFixtureSummary } from "./dev_test_game_seed_fixture_summary.mjs";
import {
  handleLocalhostBindFailure,
  preflightLocalhostBindOrExit,
} from "./frontend_smoke_bind_preflight.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontendRoot = path.join(repoRoot, "frontend");
const frontendRequire = createRequire(path.join(frontendRoot, "package.json"));
const artifactDir = path.join(repoRoot, "target", "dev-test-game");
const seedFixturePath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_SEED_FIXTURE_SUMMARY ??
    "target/dev-test-game/seed-fixture-summary.json",
);
const evidencePath = path.join(artifactDir, "seed-admin-proof.json");
const host = "127.0.0.1";

await preflightLocalhostBindOrExit({
  host,
  repoRoot,
  artifactDir,
  evidencePath,
  smokeName: "dev-test-game-seed-admin-proof",
});

let vite;
let browser;
const previousFixtureSession = process.env.FMARCH_FRONTEND_FIXTURE_SESSION;
const previousSeedFixture = process.env.FMARCH_DEV_TEST_GAME_SEED_FIXTURE_SUMMARY;

try {
  await mkdir(artifactDir, { recursive: true });
  const seedFixture = assertDevTestGameSeedFixtureSummary(
    JSON.parse(await readFile(seedFixturePath, "utf8")),
  );
  process.env.FMARCH_FRONTEND_FIXTURE_SESSION = "1";
  process.env.FMARCH_DEV_TEST_GAME_SEED_FIXTURE_SUMMARY = path.relative(
    repoRoot,
    seedFixturePath,
  );
  const frontendBaseUrl = await startFrontend();
  browser = await chromium.launch();
  const adminRoleSurface = await proveAdminSeedSurface({
    frontendBaseUrl,
    seedFixture,
  });
  const evidence = {
    version: 1,
    proof: "dev-test-game-seed-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-seed-admin-surface",
    proofBoundary:
      "Local SvelteKit admin role URL with fixture admin authority over a saved dev-test-game seed/demo fixture summary. Proves the local seed/demo fixture inventory is discoverable from the seeded admin overview and inspectable in a native admin audit detail route; it does not prove hosted demo data, sanitized demo-data policy, invite delivery, beta readiness, or release readiness.",
    generatedFrom: {
      seedFixtureSummary: path.relative(repoRoot, seedFixturePath),
      game: seedFixture.fixture.game,
    },
    adminRoleSurface,
  };
  assertSeedAdminProof(evidence);
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`wrote ${path.relative(repoRoot, evidencePath)}`);
} catch (error) {
  const handled = await handleLocalhostBindFailure({
    error,
    repoRoot,
    artifactDir,
    evidencePath,
    smokeName: "dev-test-game-seed-admin-proof",
    stage: "seed-admin-proof-listen",
  });
  if (!handled) {
    throw error;
  }
} finally {
  if (browser !== undefined) {
    await browser.close();
  }
  if (vite !== undefined) {
    await vite.close();
  }
  restoreEnv("FMARCH_FRONTEND_FIXTURE_SESSION", previousFixtureSession);
  restoreEnv("FMARCH_DEV_TEST_GAME_SEED_FIXTURE_SUMMARY", previousSeedFixture);
}

async function startFrontend() {
  const previousCwd = process.cwd();
  process.chdir(frontendRoot);
  try {
    const { createServer: createViteServer } = await import(
      frontendRequire.resolve("vite")
    );
    vite = await createViteServer({
      root: frontendRoot,
      server: {
        host,
        port: 0,
        strictPort: false,
      },
      logLevel: "error",
    });
  } finally {
    process.chdir(previousCwd);
  }
  await vite.listen();
  const address = vite.httpServer?.address();
  if (address === null || typeof address !== "object") {
    throw new Error("SvelteKit seed-admin proof server did not expose a TCP address");
  }
  return `http://${host}:${address.port}`;
}

async function proveAdminSeedSurface({ frontendBaseUrl, seedFixture }) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const game = seedFixture.fixture.game;
  const requiredScenarios = [
    "host-phase-controls",
    "player-vote-recovery",
    "night-action-loop",
    "private-channel-member",
    "private-channel-denied",
    "multiplayer-hardening",
    "local-ops-readiness",
  ];
  try {
    await page.context().addCookies([
      {
        name: "fmarch_fixture_session",
        value: "fixture-admin",
        url: frontendBaseUrl,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto(`${frontendBaseUrl}/admin?game=${encodeURIComponent(game)}`, {
      waitUntil: "networkidle",
    });
    await page.getByTestId("admin-surface").waitFor({
      state: "visible",
      timeout: 15000,
    });
    await page.getByTestId("admin-audit-link-local-seed-fixtures").waitFor({
      state: "visible",
      timeout: 15000,
    });
    await Promise.all([
      page.waitForURL(
        `${frontendBaseUrl}/admin/audit/local-seed-fixtures?game=${encodeURIComponent(game)}`,
        { timeout: 15000 },
      ),
      page.getByTestId("admin-audit-link-local-seed-fixtures").click(),
    ]);
    await page.waitForLoadState("networkidle");
    await page.getByTestId("admin-audit-detail-surface").waitFor({
      state: "visible",
      timeout: 15000,
    });
    const visibleScenarios = [];
    for (const scenarioId of requiredScenarios) {
      await page.getByTestId(`admin-audit-scenario-${scenarioId}`).waitFor({
        state: "visible",
        timeout: 15000,
      });
      visibleScenarios.push(scenarioId);
    }
    const bodyText = await page.locator("body").innerText();
    if (/invite=(?!REDACTED)/.test(bodyText)) {
      throw new Error("seed admin surface leaked an invite URL token");
    }
    return {
      status: "passed",
      overviewRoleUrl: "/admin?game=<seeded-game>",
      detailRoleUrl: "/admin/audit/local-seed-fixtures?game=<seeded-game>",
      linkTestId: "admin-audit-link-local-seed-fixtures",
      surfaceTestId: "admin-audit-detail-surface",
      clickedThroughFromOverview: true,
      visibleScenarios,
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    };
  } finally {
    await page.close();
  }
}

export function assertSeedAdminProof(evidence) {
  if (
    evidence?.version !== 1 ||
    evidence.proof !== "dev-test-game-seed-admin-proof" ||
    evidence.status !== "passed" ||
    evidence.releaseReady !== false ||
    evidence.productionReady !== false ||
    evidence.scope !== "local-dev-test-game-seed-admin-surface"
  ) {
    throw new Error("seed admin proof must pass locally without release claims");
  }
  if (
    evidence.adminRoleSurface?.clickedThroughFromOverview !== true ||
    evidence.adminRoleSurface?.rawInviteTokensVisible !== false
  ) {
    throw new Error("seed admin proof did not prove admin overview click-through");
  }
  for (const scenarioId of [
    "host-phase-controls",
    "player-vote-recovery",
    "night-action-loop",
    "private-channel-member",
    "private-channel-denied",
    "multiplayer-hardening",
    "local-ops-readiness",
  ]) {
    if (!evidence.adminRoleSurface?.visibleScenarios?.includes(scenarioId)) {
      throw new Error(`seed admin proof missing visible scenario: ${scenarioId}`);
    }
  }
  return evidence;
}

function restoreEnv(name, previous) {
  if (previous === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = previous;
  }
}
