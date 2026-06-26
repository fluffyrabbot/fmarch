import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { assertDevTestGameOpsArtifacts } from "./dev_test_game_ops_artifacts.mjs";
import {
  handleLocalhostBindFailure,
  preflightLocalhostBindOrExit,
} from "./frontend_smoke_bind_preflight.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontendRoot = path.join(repoRoot, "frontend");
const frontendRequire = createRequire(path.join(frontendRoot, "package.json"));
const artifactDir = path.join(repoRoot, "target", "dev-test-game");
const opsArtifactsPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_OPS_ARTIFACTS ?? "target/dev-test-game/ops-artifacts.json",
);
const evidencePath = path.join(artifactDir, "ops-admin-proof.json");
const host = "127.0.0.1";

await preflightLocalhostBindOrExit({
  host,
  repoRoot,
  artifactDir,
  evidencePath,
  smokeName: "dev-test-game-ops-admin-proof",
});

let vite;
let browser;
const previousFixtureSession = process.env.FMARCH_FRONTEND_FIXTURE_SESSION;
const previousOpsArtifacts = process.env.FMARCH_DEV_TEST_GAME_OPS_ARTIFACTS;

try {
  await mkdir(artifactDir, { recursive: true });
  const opsArtifacts = assertDevTestGameOpsArtifacts(
    JSON.parse(await readFile(opsArtifactsPath, "utf8")),
  );
  process.env.FMARCH_FRONTEND_FIXTURE_SESSION = "1";
  process.env.FMARCH_DEV_TEST_GAME_OPS_ARTIFACTS = path.relative(
    repoRoot,
    opsArtifactsPath,
  );
  const frontendBaseUrl = await startFrontend();
  browser = await chromium.launch();
  const adminRoleSurface = await proveAdminOpsSurface({
    frontendBaseUrl,
    opsArtifacts,
  });
  const evidence = {
    version: 1,
    proof: "dev-test-game-ops-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-ops-admin-surface",
    proofBoundary:
      "Local SvelteKit admin role URL with fixture admin authority over a saved dev-test-game ops artifact. Proves the local ops artifact bundle is discoverable from the seeded admin overview and inspectable in a native admin audit detail route; it does not prove hosted observability, centralized logs, paging, SLOs, incident response, or release readiness.",
    generatedFrom: {
      opsArtifacts: path.relative(repoRoot, opsArtifactsPath),
      game: opsArtifacts.run.game,
    },
    adminRoleSurface,
  };
  assertOpsAdminProof(evidence);
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`wrote ${path.relative(repoRoot, evidencePath)}`);
} catch (error) {
  const handled = await handleLocalhostBindFailure({
    error,
    repoRoot,
    artifactDir,
    evidencePath,
    smokeName: "dev-test-game-ops-admin-proof",
    stage: "ops-admin-proof-listen",
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
  restoreEnv("FMARCH_DEV_TEST_GAME_OPS_ARTIFACTS", previousOpsArtifacts);
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
    throw new Error("SvelteKit ops-admin proof server did not expose a TCP address");
  }
  return `http://${host}:${address.port}`;
}

async function proveAdminOpsSurface({ frontendBaseUrl, opsArtifacts }) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const game = opsArtifacts.run.game;
  const requiredChecks = [
    "source-artifacts-checksummed",
    "role-entrypoints-redacted",
    "proof-lanes-summarized",
    "release-boundary-carried",
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
    await page.getByTestId("admin-audit-link-local-ops-artifacts").waitFor({
      state: "visible",
      timeout: 15000,
    });
    await Promise.all([
      page.waitForURL(
        `${frontendBaseUrl}/admin/audit/local-ops-artifacts?game=${encodeURIComponent(game)}`,
        { timeout: 15000 },
      ),
      page.getByTestId("admin-audit-link-local-ops-artifacts").click(),
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
      throw new Error("ops admin surface leaked an invite URL token");
    }
    return {
      status: "passed",
      overviewRoleUrl: "/admin?game=<seeded-game>",
      detailRoleUrl: "/admin/audit/local-ops-artifacts?game=<seeded-game>",
      linkTestId: "admin-audit-link-local-ops-artifacts",
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

export function assertOpsAdminProof(evidence) {
  if (
    evidence?.version !== 1 ||
    evidence.proof !== "dev-test-game-ops-admin-proof" ||
    evidence.status !== "passed" ||
    evidence.releaseReady !== false ||
    evidence.productionReady !== false ||
    evidence.scope !== "local-dev-test-game-ops-admin-surface"
  ) {
    throw new Error("ops admin proof must pass locally without release claims");
  }
  if (
    evidence.adminRoleSurface?.clickedThroughFromOverview !== true ||
    evidence.adminRoleSurface?.rawInviteTokensVisible !== false ||
    !evidence.adminRoleSurface?.visibleChecks?.includes("source-artifacts-checksummed") ||
    !evidence.adminRoleSurface?.visibleChecks?.includes("role-entrypoints-redacted") ||
    !evidence.adminRoleSurface?.visibleChecks?.includes("proof-lanes-summarized") ||
    !evidence.adminRoleSurface?.visibleChecks?.includes("release-boundary-carried")
  ) {
    throw new Error("ops admin proof did not prove the native admin audit surface");
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
