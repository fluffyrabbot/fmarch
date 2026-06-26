import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { assertDevTestGameReleaseReadiness } from "./dev_test_game_release_readiness.mjs";
import {
  handleLocalhostBindFailure,
  preflightLocalhostBindOrExit,
} from "./frontend_smoke_bind_preflight.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontendRoot = path.join(repoRoot, "frontend");
const frontendRequire = createRequire(path.join(frontendRoot, "package.json"));
const artifactDir = path.join(repoRoot, "target", "dev-test-game");
const readinessPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_RELEASE_READINESS ??
    "target/dev-test-game/release-readiness-checklist.json",
);
const evidencePath = path.join(artifactDir, "release-admin-proof.json");
const host = "127.0.0.1";

await preflightLocalhostBindOrExit({
  host,
  repoRoot,
  artifactDir,
  evidencePath,
  smokeName: "dev-test-game-release-admin-proof",
});

let vite;
let browser;
const previousFixtureSession = process.env.FMARCH_FRONTEND_FIXTURE_SESSION;
const previousReadiness = process.env.FMARCH_DEV_TEST_GAME_RELEASE_READINESS;

try {
  await mkdir(artifactDir, { recursive: true });
  const readiness = assertDevTestGameReleaseReadiness(
    JSON.parse(await readFile(readinessPath, "utf8")),
  );
  process.env.FMARCH_FRONTEND_FIXTURE_SESSION = "1";
  process.env.FMARCH_DEV_TEST_GAME_RELEASE_READINESS = path.relative(
    repoRoot,
    readinessPath,
  );
  const frontendBaseUrl = await startFrontend();
  browser = await chromium.launch();
  const adminRoleSurface = await proveAdminReleaseSurface({
    frontendBaseUrl,
    readiness,
  });
  const evidence = {
    version: 1,
    proof: "dev-test-game-release-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-release-admin-surface",
    proofBoundary:
      "Local SvelteKit admin role URL with fixture admin authority over the dev-test-game release-readiness checklist. Proves the local checklist is discoverable from the seeded admin overview and inspectable in a native admin audit detail route with local checks and remaining unproven release items visible; it does not prove hosted deployment, hosted identity, hosted operations, production backup/PITR, exhaustive race coverage, human release approval, beta readiness, or production readiness.",
    generatedFrom: {
      releaseReadinessChecklist: path.relative(repoRoot, readinessPath),
      game: readiness.generatedFrom.game,
    },
    adminRoleSurface,
  };
  assertReleaseAdminProof(evidence);
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`wrote ${path.relative(repoRoot, evidencePath)}`);
} catch (error) {
  const handled = await handleLocalhostBindFailure({
    error,
    repoRoot,
    artifactDir,
    evidencePath,
    smokeName: "dev-test-game-release-admin-proof",
    stage: "release-admin-proof-listen",
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
  restoreEnv("FMARCH_DEV_TEST_GAME_RELEASE_READINESS", previousReadiness);
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
    throw new Error(
      "SvelteKit release-admin proof server did not expose a TCP address",
    );
  }
  return `http://${host}:${address.port}`;
}

async function proveAdminReleaseSurface({ frontendBaseUrl, readiness }) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const game = readiness.generatedFrom.game;
  const requiredChecks = readiness.localDevelopmentSpine.checks.map(
    (check) => check.id,
  );
  const requiredUnproven = readiness.releaseReadiness.unproven.map(
    (item) => item.id,
  );
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
    await page.getByTestId("admin-audit-link-local-release-readiness").waitFor({
      state: "visible",
      timeout: 15000,
    });
    await Promise.all([
      page.waitForURL(
        `${frontendBaseUrl}/admin/audit/local-release-readiness?game=${encodeURIComponent(game)}`,
        { timeout: 15000 },
      ),
      page.getByTestId("admin-audit-link-local-release-readiness").click(),
    ]);
    await page.waitForLoadState("networkidle");
    await page.getByTestId("admin-audit-detail-surface").waitFor({
      state: "visible",
      timeout: 15000,
    });
    const visibleChecks = [];
    for (const checkId of requiredChecks) {
      await page.getByTestId(`admin-audit-check-${checkId}`).waitFor({
        state: "visible",
        timeout: 15000,
      });
      visibleChecks.push(checkId);
    }
    const visibleUnproven = [];
    for (const itemId of requiredUnproven) {
      await page.getByTestId(`admin-audit-unproven-${itemId}`).waitFor({
        state: "visible",
        timeout: 15000,
      });
      visibleUnproven.push(itemId);
    }
    const bodyText = await page.locator("body").innerText();
    if (/invite=(?!REDACTED)/.test(bodyText)) {
      throw new Error("release admin surface leaked an invite URL token");
    }
    return {
      status: "passed",
      overviewRoleUrl: "/admin?game=<seeded-game>",
      detailRoleUrl: "/admin/audit/local-release-readiness?game=<seeded-game>",
      linkTestId: "admin-audit-link-local-release-readiness",
      surfaceTestId: "admin-audit-detail-surface",
      clickedThroughFromOverview: true,
      visibleChecks,
      visibleUnproven,
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    };
  } finally {
    await page.close();
  }
}

export function assertReleaseAdminProof(evidence) {
  if (
    evidence?.version !== 1 ||
    evidence.proof !== "dev-test-game-release-admin-proof" ||
    evidence.status !== "passed" ||
    evidence.releaseReady !== false ||
    evidence.productionReady !== false ||
    evidence.scope !== "local-dev-test-game-release-admin-surface"
  ) {
    throw new Error("release admin proof must pass locally without release claims");
  }
  if (
    evidence.adminRoleSurface?.clickedThroughFromOverview !== true ||
    evidence.adminRoleSurface?.rawInviteTokensVisible !== false
  ) {
    throw new Error("release admin proof did not prove admin overview click-through");
  }
  for (const checkId of [
    "local-role-url-browser-proof",
    "local-core-loop-proof",
    "local-hardening-proof",
  ]) {
    if (!evidence.adminRoleSurface?.visibleChecks?.includes(checkId)) {
      throw new Error(`release admin proof missing visible check: ${checkId}`);
    }
  }
  for (const itemId of ["hosted-deployment", "human-release-runbook"]) {
    if (!evidence.adminRoleSurface?.visibleUnproven?.includes(itemId)) {
      throw new Error(`release admin proof missing visible unproven item: ${itemId}`);
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
