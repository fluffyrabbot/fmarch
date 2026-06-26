import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { assertDevTestGameProofRun } from "./dev_test_game_proof_contract.mjs";
import {
  handleLocalhostBindFailure,
  preflightLocalhostBindOrExit,
} from "./frontend_smoke_bind_preflight.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontendRoot = path.join(repoRoot, "frontend");
const frontendRequire = createRequire(path.join(frontendRoot, "package.json"));
const artifactDir = path.join(repoRoot, "target", "dev-test-game");
const proofRunPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_PROOF_RUN ??
    "target/dev-test-game/proof-run.json",
);
const evidencePath = path.join(artifactDir, "core-loop-admin-proof.json");
const host = "127.0.0.1";

await preflightLocalhostBindOrExit({
  host,
  repoRoot,
  artifactDir,
  evidencePath,
  smokeName: "dev-test-game-core-loop-admin-proof",
});

let vite;
let browser;
const previousFixtureSession = process.env.FMARCH_FRONTEND_FIXTURE_SESSION;
const previousProofRun = process.env.FMARCH_DEV_TEST_GAME_PROOF_RUN;

try {
  await mkdir(artifactDir, { recursive: true });
  const proofRun = assertDevTestGameProofRun(
    JSON.parse(await readFile(proofRunPath, "utf8")),
  );
  const proofRunRelativePath = path.relative(repoRoot, proofRunPath);
  process.env.FMARCH_FRONTEND_FIXTURE_SESSION = "1";
  process.env.FMARCH_DEV_TEST_GAME_PROOF_RUN = proofRunRelativePath;
  const frontendBaseUrl = await startFrontend();
  browser = await chromium.launch();
  const adminRoleSurface = await proveAdminCoreLoopSurface({
    frontendBaseUrl,
    proofRun,
  });
  const evidence = {
    version: 1,
    proof: "dev-test-game-core-loop-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-core-loop-admin-surface",
    proofBoundary:
      "Local SvelteKit admin role URL with fixture admin authority over the dev-test-game core-loop proof-run lanes. Proves the saved host-control, player-action, day/night, and private-channel evidence is discoverable from the seeded admin overview and inspectable in a native admin audit detail route; it does not prove hosted deployment, production identity, exhaustive action/race coverage, beta readiness, or production readiness.",
    generatedFrom: {
      proofRun: proofRunRelativePath,
      game: proofRun.session.game,
    },
    adminRoleSurface,
  };
  assertCoreLoopAdminProof(evidence);
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`wrote ${path.relative(repoRoot, evidencePath)}`);
} catch (error) {
  const handled = await handleLocalhostBindFailure({
    error,
    repoRoot,
    artifactDir,
    evidencePath,
    smokeName: "dev-test-game-core-loop-admin-proof",
    stage: "core-loop-admin-proof-listen",
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
  restoreEnv("FMARCH_DEV_TEST_GAME_PROOF_RUN", previousProofRun);
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
      "SvelteKit core-loop-admin proof server did not expose a TCP address",
    );
  }
  return `http://${host}:${address.port}`;
}

async function proveAdminCoreLoopSurface({ frontendBaseUrl, proofRun }) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const game = proofRun.session.game;
  const requiredChecks = ["core-loop", "action-loop", "private-channel"];
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
    await page.getByTestId("admin-audit-link-local-core-loop").waitFor({
      state: "visible",
      timeout: 15000,
    });
    await Promise.all([
      page.waitForURL(
        `${frontendBaseUrl}/admin/audit/local-core-loop?game=${encodeURIComponent(game)}`,
        { timeout: 15000 },
      ),
      page.getByTestId("admin-audit-link-local-core-loop").click(),
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
    const bodyText = await page.locator("body").innerText();
    if (/invite=(?!REDACTED)/.test(bodyText)) {
      throw new Error("core-loop admin surface leaked an invite URL token");
    }
    return {
      status: "passed",
      overviewRoleUrl: "/admin?game=<seeded-game>",
      detailRoleUrl: "/admin/audit/local-core-loop?game=<seeded-game>",
      linkTestId: "admin-audit-link-local-core-loop",
      surfaceTestId: "admin-audit-detail-surface",
      clickedThroughFromOverview: true,
      visibleChecks,
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    };
  } finally {
    await page.close();
  }
}

export function assertCoreLoopAdminProof(evidence) {
  if (
    evidence?.version !== 1 ||
    evidence.proof !== "dev-test-game-core-loop-admin-proof" ||
    evidence.status !== "passed" ||
    evidence.releaseReady !== false ||
    evidence.productionReady !== false ||
    evidence.scope !== "local-dev-test-game-core-loop-admin-surface"
  ) {
    throw new Error("core-loop admin proof must pass locally without release claims");
  }
  if (
    evidence.adminRoleSurface?.clickedThroughFromOverview !== true ||
    evidence.adminRoleSurface?.rawInviteTokensVisible !== false
  ) {
    throw new Error("core-loop admin proof did not prove admin overview click-through");
  }
  for (const checkId of ["core-loop", "action-loop", "private-channel"]) {
    if (!evidence.adminRoleSurface?.visibleChecks?.includes(checkId)) {
      throw new Error(`core-loop admin proof missing visible check: ${checkId}`);
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
