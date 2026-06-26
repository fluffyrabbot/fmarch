import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { validateDevTestGameIdentityAdapterProof } from "./dev_test_game_release_readiness.mjs";
import {
  handleLocalhostBindFailure,
  preflightLocalhostBindOrExit,
} from "./frontend_smoke_bind_preflight.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontendRoot = path.join(repoRoot, "frontend");
const frontendRequire = createRequire(path.join(frontendRoot, "package.json"));
const artifactDir = path.join(repoRoot, "target", "dev-test-game");
const identityProofPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_IDENTITY_ADAPTER_PROOF ??
    "target/auth-invite-role-proof/invite-role-proof.json",
);
const evidencePath = path.join(artifactDir, "identity-admin-proof.json");
const host = "127.0.0.1";

await preflightLocalhostBindOrExit({
  host,
  repoRoot,
  artifactDir,
  evidencePath,
  smokeName: "dev-test-game-identity-admin-proof",
});

let vite;
let browser;
const previousFixtureSession = process.env.FMARCH_FRONTEND_FIXTURE_SESSION;
const previousIdentityProof = process.env.FMARCH_DEV_TEST_GAME_IDENTITY_ADAPTER_PROOF;

try {
  await mkdir(artifactDir, { recursive: true });
  const identityProof = JSON.parse(await readFile(identityProofPath, "utf8"));
  const proofPath = path.relative(repoRoot, identityProofPath);
  validateDevTestGameIdentityAdapterProof(identityProof, {
    path: proofPath,
  });
  process.env.FMARCH_FRONTEND_FIXTURE_SESSION = "1";
  process.env.FMARCH_DEV_TEST_GAME_IDENTITY_ADAPTER_PROOF = proofPath;
  const frontendBaseUrl = await startFrontend();
  browser = await chromium.launch();
  const adminRoleSurface = await proveAdminIdentitySurface({
    frontendBaseUrl,
    identityProof,
  });
  const evidence = {
    version: 1,
    proof: "dev-test-game-identity-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-identity-admin-surface",
    proofBoundary:
      "Local SvelteKit admin role URL with fixture admin authority over the auth invite-role identity adapter proof. Proves the saved local identity-adapter evidence is discoverable from the seeded admin overview and inspectable in a native admin audit detail route with role surfaces and lifecycle checks visible; it does not prove hosted accounts, invite delivery, account recovery, abuse controls, hosted audit retention/export, beta readiness, or production readiness.",
    generatedFrom: {
      identityAdapterProof: proofPath,
      game: identityProof.game,
    },
    adminRoleSurface,
  };
  assertIdentityAdminProof(evidence);
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`wrote ${path.relative(repoRoot, evidencePath)}`);
} catch (error) {
  const handled = await handleLocalhostBindFailure({
    error,
    repoRoot,
    artifactDir,
    evidencePath,
    smokeName: "dev-test-game-identity-admin-proof",
    stage: "identity-admin-proof-listen",
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
  restoreEnv("FMARCH_DEV_TEST_GAME_IDENTITY_ADAPTER_PROOF", previousIdentityProof);
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
      "SvelteKit identity-admin proof server did not expose a TCP address",
    );
  }
  return `http://${host}:${address.port}`;
}

async function proveAdminIdentitySurface({ frontendBaseUrl, identityProof }) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const game = identityProof.game;
  const requiredChecks = [
    "session-rotation",
    "session-revocation",
    "invite-revocation",
    "audit-trail",
    "admin-audit-surface",
  ];
  const requiredSessions = ["admin", "host", "player"];
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
    await page.getByTestId("admin-audit-link-local-identity-adapter").waitFor({
      state: "visible",
      timeout: 15000,
    });
    await Promise.all([
      page.waitForURL(
        `${frontendBaseUrl}/admin/audit/local-identity-adapter?game=${encodeURIComponent(game)}`,
        { timeout: 15000 },
      ),
      page.getByTestId("admin-audit-link-local-identity-adapter").click(),
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
    const visibleSessions = [];
    for (const sessionRole of requiredSessions) {
      await page.getByTestId(`admin-audit-session-${sessionRole}`).waitFor({
        state: "visible",
        timeout: 15000,
      });
      visibleSessions.push(sessionRole);
    }
    const bodyText = await page.locator("body").innerText();
    for (const entry of Object.values(identityProof.roles ?? {})) {
      const invite = new URL(entry.loginUrl).searchParams.get("invite");
      if (invite !== null && bodyText.includes(invite)) {
        throw new Error("identity admin surface leaked an invite URL token");
      }
    }
    return {
      status: "passed",
      overviewRoleUrl: "/admin?game=<seeded-game>",
      detailRoleUrl: "/admin/audit/local-identity-adapter?game=<seeded-game>",
      linkTestId: "admin-audit-link-local-identity-adapter",
      surfaceTestId: "admin-audit-detail-surface",
      clickedThroughFromOverview: true,
      visibleChecks,
      visibleSessions,
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    };
  } finally {
    await page.close();
  }
}

export function assertIdentityAdminProof(evidence) {
  if (
    evidence?.version !== 1 ||
    evidence.proof !== "dev-test-game-identity-admin-proof" ||
    evidence.status !== "passed" ||
    evidence.releaseReady !== false ||
    evidence.productionReady !== false ||
    evidence.scope !== "local-dev-test-game-identity-admin-surface"
  ) {
    throw new Error("identity admin proof must pass locally without release claims");
  }
  if (
    evidence.adminRoleSurface?.clickedThroughFromOverview !== true ||
    evidence.adminRoleSurface?.rawInviteTokensVisible !== false
  ) {
    throw new Error("identity admin proof did not prove admin overview click-through");
  }
  for (const checkId of [
    "session-rotation",
    "session-revocation",
    "invite-revocation",
    "audit-trail",
    "admin-audit-surface",
  ]) {
    if (!evidence.adminRoleSurface?.visibleChecks?.includes(checkId)) {
      throw new Error(`identity admin proof missing visible check: ${checkId}`);
    }
  }
  for (const sessionRole of ["admin", "host", "player"]) {
    if (!evidence.adminRoleSurface?.visibleSessions?.includes(sessionRole)) {
      throw new Error(`identity admin proof missing visible session: ${sessionRole}`);
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
