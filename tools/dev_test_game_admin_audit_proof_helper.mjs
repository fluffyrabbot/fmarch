import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  handleLocalhostBindFailure,
  preflightLocalhostBindOrExit,
} from "./frontend_smoke_bind_preflight.mjs";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const frontendRoot = path.join(repoRoot, "frontend");
export const artifactDir = path.join(repoRoot, "target", "dev-test-game");

const frontendRequire = createRequire(path.join(frontendRoot, "package.json"));
const host = "127.0.0.1";

export async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function runAdminAuditProof({
  smokeName,
  stage,
  evidencePath,
  envOverrides = {},
  loadSource,
  prove,
  buildEvidence,
  assertEvidence,
}) {
  await preflightLocalhostBindOrExit({
    host,
    repoRoot,
    artifactDir,
    evidencePath,
    smokeName,
  });

  let vite;
  let browser;
  const previousFixtureSession = process.env.FMARCH_FRONTEND_FIXTURE_SESSION;
  const previousEnv = new Map(
    Object.keys(envOverrides).map((name) => [name, process.env[name]]),
  );

  try {
    await mkdir(artifactDir, { recursive: true });
    const source = await loadSource();
    process.env.FMARCH_FRONTEND_FIXTURE_SESSION = "1";
    for (const [name, value] of Object.entries(envOverrides)) {
      process.env[name] = value;
    }
    vite = await startFrontend();
    browser = await chromium.launch();
    const adminRoleSurface = await prove({
      browser,
      frontendBaseUrl: await frontendBaseUrl(vite),
      source,
    });
    const evidence = buildEvidence({ source, adminRoleSurface });
    assertEvidence(evidence);
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(`wrote ${path.relative(repoRoot, evidencePath)}`);
  } catch (error) {
    const handled = await handleLocalhostBindFailure({
      error,
      repoRoot,
      artifactDir,
      evidencePath,
      smokeName,
      stage,
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
    for (const [name, previous] of previousEnv.entries()) {
      restoreEnv(name, previous);
    }
  }
}

export async function proveAdminAuditDetail({
  browser,
  frontendBaseUrl,
  game,
  auditId,
  requiredChecks = [],
  requiredScenarios = [],
  requiredSessions = [],
  requiredUnproven = [],
  forbiddenText = [],
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const linkTestId = `admin-audit-link-${auditId}`;
  const detailRoleUrl = `/admin/audit/${auditId}?game=<seeded-game>`;
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
    await page.getByTestId(linkTestId).waitFor({
      state: "visible",
      timeout: 15000,
    });
    await Promise.all([
      page.waitForURL(
        `${frontendBaseUrl}/admin/audit/${auditId}?game=${encodeURIComponent(game)}`,
        { timeout: 15000 },
      ),
      page.getByTestId(linkTestId).click(),
    ]);
    await page.waitForLoadState("networkidle");
    await page.getByTestId("admin-audit-detail-surface").waitFor({
      state: "visible",
      timeout: 15000,
    });
    const visibleChecks = await waitForRows({
      page,
      prefix: "admin-audit-check",
      ids: requiredChecks,
    });
    const visibleScenarios = await waitForRows({
      page,
      prefix: "admin-audit-scenario",
      ids: requiredScenarios,
    });
    const visibleSessions = await waitForRows({
      page,
      prefix: "admin-audit-session",
      ids: requiredSessions,
    });
    const visibleUnproven = await waitForRows({
      page,
      prefix: "admin-audit-unproven",
      ids: requiredUnproven,
    });
    const bodyText = await page.locator("body").innerText();
    if (/invite=(?!REDACTED)/.test(bodyText)) {
      throw new Error(`${auditId} admin surface leaked an invite URL token`);
    }
    for (const token of forbiddenText) {
      if (bodyText.includes(token)) {
        throw new Error(`${auditId} admin surface leaked forbidden text`);
      }
    }
    return {
      status: "passed",
      overviewRoleUrl: "/admin?game=<seeded-game>",
      detailRoleUrl,
      linkTestId,
      surfaceTestId: "admin-audit-detail-surface",
      clickedThroughFromOverview: true,
      ...(visibleChecks.length === 0 ? {} : { visibleChecks }),
      ...(visibleScenarios.length === 0 ? {} : { visibleScenarios }),
      ...(visibleSessions.length === 0 ? {} : { visibleSessions }),
      ...(visibleUnproven.length === 0 ? {} : { visibleUnproven }),
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    };
  } finally {
    await page.close();
  }
}

async function waitForRows({ page, prefix, ids }) {
  const visible = [];
  for (const id of ids) {
    await page.getByTestId(`${prefix}-${id}`).waitFor({
      state: "visible",
      timeout: 15000,
    });
    visible.push(id);
  }
  return visible;
}

async function startFrontend() {
  const previousCwd = process.cwd();
  process.chdir(frontendRoot);
  try {
    const { createServer: createViteServer } = await import(
      frontendRequire.resolve("vite")
    );
    const vite = await createViteServer({
      root: frontendRoot,
      server: {
        host,
        port: 0,
        strictPort: false,
      },
      logLevel: "error",
    });
    await vite.listen();
    return vite;
  } finally {
    process.chdir(previousCwd);
  }
}

async function frontendBaseUrl(vite) {
  const address = vite.httpServer?.address();
  if (address === null || typeof address !== "object") {
    throw new Error("SvelteKit admin proof server did not expose a TCP address");
  }
  return `http://${host}:${address.port}`;
}

function restoreEnv(name, previous) {
  if (previous === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = previous;
  }
}
