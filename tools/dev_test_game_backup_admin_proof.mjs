import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { validateDevTestGameBackupRestoreProof } from "./dev_test_game_release_readiness.mjs";
import {
  handleLocalhostBindFailure,
  preflightLocalhostBindOrExit,
} from "./frontend_smoke_bind_preflight.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontendRoot = path.join(repoRoot, "frontend");
const frontendRequire = createRequire(path.join(frontendRoot, "package.json"));
const artifactDir = path.join(repoRoot, "target", "dev-test-game");
const backupProofPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_BACKUP_RESTORE_PROOF ??
    "target/live-stack-backup-restore-drill/local-backup-restore-proof.json",
);
const backupDumpPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_BACKUP_RESTORE_DUMP ??
    "target/live-stack-backup-restore-drill/local-live-stack.dump",
);
const evidencePath = path.join(artifactDir, "backup-admin-proof.json");
const host = "127.0.0.1";

await preflightLocalhostBindOrExit({
  host,
  repoRoot,
  artifactDir,
  evidencePath,
  smokeName: "dev-test-game-backup-admin-proof",
});

let vite;
let browser;
const previousFixtureSession = process.env.FMARCH_FRONTEND_FIXTURE_SESSION;
const previousBackupProof = process.env.FMARCH_DEV_TEST_GAME_BACKUP_RESTORE_PROOF;
const previousBackupDump = process.env.FMARCH_DEV_TEST_GAME_BACKUP_RESTORE_DUMP;

try {
  await mkdir(artifactDir, { recursive: true });
  const backupProof = JSON.parse(await readFile(backupProofPath, "utf8"));
  const proofPath = path.relative(repoRoot, backupProofPath);
  const dumpPath = path.relative(repoRoot, backupDumpPath);
  validateDevTestGameBackupRestoreProof(backupProof, {
    proofPath,
    dumpPath,
  });
  process.env.FMARCH_FRONTEND_FIXTURE_SESSION = "1";
  process.env.FMARCH_DEV_TEST_GAME_BACKUP_RESTORE_PROOF = proofPath;
  const frontendBaseUrl = await startFrontend();
  browser = await chromium.launch();
  const adminRoleSurface = await proveAdminBackupSurface({
    frontendBaseUrl,
    backupProof,
  });
  const evidence = {
    version: 1,
    proof: "dev-test-game-backup-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-backup-admin-surface",
    proofBoundary:
      "Local SvelteKit admin role URL with fixture admin authority over the dev-test-game backup/restore drill proof. Proves the local backup/restore drill is discoverable from the seeded admin overview and inspectable in a native admin audit detail route with drill checks and restored role sessions visible; it does not prove hosted backup storage, PITR, key escrow, cross-region restore, multi-node failover, beta readiness, or production readiness.",
    generatedFrom: {
      backupRestoreProof: proofPath,
      backupRestoreDump: dumpPath,
      game: backupProof.game,
    },
    adminRoleSurface,
  };
  assertBackupAdminProof(evidence);
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`wrote ${path.relative(repoRoot, evidencePath)}`);
} catch (error) {
  const handled = await handleLocalhostBindFailure({
    error,
    repoRoot,
    artifactDir,
    evidencePath,
    smokeName: "dev-test-game-backup-admin-proof",
    stage: "backup-admin-proof-listen",
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
  restoreEnv("FMARCH_DEV_TEST_GAME_BACKUP_RESTORE_PROOF", previousBackupProof);
  restoreEnv("FMARCH_DEV_TEST_GAME_BACKUP_RESTORE_DUMP", previousBackupDump);
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
      "SvelteKit backup-admin proof server did not expose a TCP address",
    );
  }
  return `http://${host}:${address.port}`;
}

async function proveAdminBackupSurface({ frontendBaseUrl, backupProof }) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const game = backupProof.game;
  const requiredChecks = [
    "dump-created",
    "event-log-restored",
    "projection-fingerprints-restored",
    "auth-sessions-restored",
    "restored-api-capabilities",
  ];
  const requiredSessions = ["host", "player", "admin"];
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
    await page.getByTestId("admin-audit-link-local-backup-restore").waitFor({
      state: "visible",
      timeout: 15000,
    });
    await Promise.all([
      page.waitForURL(
        `${frontendBaseUrl}/admin/audit/local-backup-restore?game=${encodeURIComponent(game)}`,
        { timeout: 15000 },
      ),
      page.getByTestId("admin-audit-link-local-backup-restore").click(),
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
    if (/invite=(?!REDACTED)/.test(bodyText)) {
      throw new Error("backup admin surface leaked an invite URL token");
    }
    return {
      status: "passed",
      overviewRoleUrl: "/admin?game=<seeded-game>",
      detailRoleUrl: "/admin/audit/local-backup-restore?game=<seeded-game>",
      linkTestId: "admin-audit-link-local-backup-restore",
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

export function assertBackupAdminProof(evidence) {
  if (
    evidence?.version !== 1 ||
    evidence.proof !== "dev-test-game-backup-admin-proof" ||
    evidence.status !== "passed" ||
    evidence.releaseReady !== false ||
    evidence.productionReady !== false ||
    evidence.scope !== "local-dev-test-game-backup-admin-surface"
  ) {
    throw new Error("backup admin proof must pass locally without release claims");
  }
  if (
    evidence.adminRoleSurface?.clickedThroughFromOverview !== true ||
    evidence.adminRoleSurface?.rawInviteTokensVisible !== false
  ) {
    throw new Error("backup admin proof did not prove admin overview click-through");
  }
  for (const checkId of [
    "dump-created",
    "event-log-restored",
    "projection-fingerprints-restored",
    "auth-sessions-restored",
    "restored-api-capabilities",
  ]) {
    if (!evidence.adminRoleSurface?.visibleChecks?.includes(checkId)) {
      throw new Error(`backup admin proof missing visible check: ${checkId}`);
    }
  }
  for (const sessionRole of ["host", "player", "admin"]) {
    if (!evidence.adminRoleSurface?.visibleSessions?.includes(sessionRole)) {
      throw new Error(`backup admin proof missing visible session: ${sessionRole}`);
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
