import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  handleLocalhostBindFailure,
  preflightLocalhostBindOrExit,
} from "./frontend_smoke_bind_preflight.mjs";
import {
  createUnexpectedMediaResponseGuard,
} from "./dev_test_game_media_response_guard.mjs";

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
    const mediaResponseGuard = createUnexpectedMediaResponseGuard({
      label: smokeName,
    });
    mediaResponseGuard.attachBrowser(browser);
    const adminRoleSurface = await prove({
      browser,
      frontendBaseUrl: await frontendBaseUrl(vite),
      source,
    });
    mediaResponseGuard.assertNoUnexpectedMedia404({ phase: smokeName });
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
  requiredCheckStatuses = {},
  requiredLocalPrerequisites = [],
  requiredScenarios = [],
  requiredSessions = [],
  requiredReconnectLanes = [],
  requiredStaleConflictLanes = [],
  requiredProofLaneCoverage = [],
  requiredSpineCycles = [],
  requiredSpineRoleUrls = [],
  requiredSpineCheckpoints = [],
  requiredSpineRecoveryHooks = [],
  requiredUnproven = [],
  requiredRealHostedEvidenceInputs = [],
  requiredHostedHandoffInputs = [],
  requiredHostedHandoffBlockedChecks = [],
  requiredHostedHandoffGroups = [],
  requiredHostedHandoffSummary = null,
  requiredRelatedLinks = [],
  requiredRelatedDestinations = [],
  forbiddenText = [],
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const linkTestId = `admin-audit-link-${auditId}`;
  const detailRoleUrl = `/admin/audit/${auditId}?game=<seeded-game>`;
  const detailUrl = `${frontendBaseUrl}/admin/audit/${auditId}?game=${encodeURIComponent(
    game,
  )}`;
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
      expectedStatuses: requiredCheckStatuses,
    });
    const visibleCheckStatuses = await readRowStatuses({
      page,
      prefix: "admin-audit-check",
      ids: Object.keys(requiredCheckStatuses),
    });
    const visibleLocalPrerequisites = await waitForRows({
      page,
      prefix: "admin-audit-local-prerequisite",
      ids: requiredLocalPrerequisites,
    });
    const visibleLocalPrerequisiteRoleUrls =
      await waitForLocalPrerequisiteRoleUrls({
        page,
        ids: requiredLocalPrerequisites,
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
    const visibleReconnectLanes = await waitForRows({
      page,
      prefix: "admin-audit-reconnect-lane",
      ids: requiredReconnectLanes,
    });
    const visibleStaleConflictLanes = await waitForRows({
      page,
      prefix: "admin-audit-stale-conflict-lane",
      ids: requiredStaleConflictLanes,
    });
    const visibleProofLaneCoverage = await waitForRows({
      page,
      prefix: "admin-audit-proof-lane-coverage",
      ids: requiredProofLaneCoverage,
    });
    const visibleSpineCycles = await waitForRows({
      page,
      prefix: "admin-audit-spine-cycle",
      ids: requiredSpineCycles,
    });
    const visibleSpineRoleUrls = await waitForRows({
      page,
      prefix: "admin-audit-spine-role-url",
      ids: requiredSpineRoleUrls,
    });
    const visibleSpineCheckpoints = await waitForRows({
      page,
      prefix: "admin-audit-spine-checkpoint",
      ids: requiredSpineCheckpoints,
    });
    const visibleSpineRecoveryHooks = await waitForRows({
      page,
      prefix: "admin-audit-spine-recovery",
      ids: requiredSpineRecoveryHooks,
    });
    const visibleUnproven = await waitForRows({
      page,
      prefix: "admin-audit-unproven",
      ids: requiredUnproven,
    });
    const visibleRealHostedEvidenceInputs = await waitForRows({
      page,
      prefix: "admin-audit-real-hosted-evidence-input",
      ids: requiredRealHostedEvidenceInputs,
    });
    const visibleHostedHandoffInputs = await waitForRows({
      page,
      prefix: "admin-audit-hosted-handoff-input",
      ids: requiredHostedHandoffInputs,
    });
    const visibleHostedHandoffBlockedChecks = await waitForRows({
      page,
      prefix: "admin-audit-hosted-handoff-blocked-check",
      ids: requiredHostedHandoffBlockedChecks,
    });
    const visibleHostedHandoffGroups = await waitForRows({
      page,
      prefix: "admin-audit-hosted-handoff-group",
      ids: requiredHostedHandoffGroups,
    });
    const visibleHostedHandoffSummary = await waitForHostedHandoffSummary({
      page,
      expected: requiredHostedHandoffSummary,
    });
    const visibleRelatedLinks = await waitForRows({
      page,
      prefix: "admin-audit-related-link",
      ids: requiredRelatedLinks,
    });
    await assertAdminAuditBodyText({ page, auditId, forbiddenText });
    const visitedLocalPrerequisiteDestinations =
      await visitLocalPrerequisiteDestinations({
        page,
        frontendBaseUrl,
        detailUrl,
        game,
        ids: requiredLocalPrerequisites,
        forbiddenText,
      });
    const visibleRelatedDestinations = [];
    for (const destination of requiredRelatedDestinations) {
      const linkId = String(destination.linkId ?? "");
      const destinationAuditId = String(destination.auditId ?? "");
      if (linkId === "" || destinationAuditId === "") {
        throw new Error(`${auditId} admin proof has a malformed related destination`);
      }
      await page.goto(detailUrl, { waitUntil: "networkidle" });
      await page.getByTestId("admin-audit-detail-surface").waitFor({
        state: "visible",
        timeout: 15000,
      });
      await page.getByTestId(`admin-audit-related-link-${linkId}`).waitFor({
        state: "visible",
        timeout: 15000,
      });
      await Promise.all([
        page.waitForURL(
          `${frontendBaseUrl}/admin/audit/${destinationAuditId}?game=${encodeURIComponent(
            game,
          )}`,
          { timeout: 15000 },
        ),
        page.getByTestId(`admin-audit-related-link-${linkId}`).click(),
      ]);
      await page.waitForLoadState("networkidle");
      await page.getByTestId("admin-audit-detail-surface").waitFor({
        state: "visible",
        timeout: 15000,
      });
      const destinationVisibleChecks = await waitForRows({
        page,
        prefix: "admin-audit-check",
        ids: destination.requiredChecks ?? [],
        expectedStatuses: destination.requiredCheckStatuses ?? {},
      });
      const destinationVisibleScenarios = await waitForRows({
        page,
        prefix: "admin-audit-scenario",
        ids: destination.requiredScenarios ?? [],
      });
      const destinationVisibleSessions = await waitForRows({
        page,
        prefix: "admin-audit-session",
        ids: destination.requiredSessions ?? [],
      });
      const destinationVisibleReconnectLanes = await waitForRows({
        page,
        prefix: "admin-audit-reconnect-lane",
        ids: destination.requiredReconnectLanes ?? [],
      });
      const destinationVisibleStaleConflictLanes = await waitForRows({
        page,
        prefix: "admin-audit-stale-conflict-lane",
        ids: destination.requiredStaleConflictLanes ?? [],
      });
      const destinationVisibleProofLaneCoverage = await waitForRows({
        page,
        prefix: "admin-audit-proof-lane-coverage",
        ids: destination.requiredProofLaneCoverage ?? [],
      });
      const destinationVisibleUnproven = await waitForRows({
        page,
        prefix: "admin-audit-unproven",
        ids: destination.requiredUnproven ?? [],
      });
      const destinationRequiredLocalPrerequisites =
        destination.requiredLocalPrerequisiteDestinations?.map((item) =>
          String(item.id),
        ) ??
        destination.requiredLocalPrerequisites ??
        [];
      const destinationVisibleLocalPrerequisites = await waitForRows({
        page,
        prefix: "admin-audit-local-prerequisite",
        ids: destinationRequiredLocalPrerequisites,
      });
      const destinationVisibleLocalPrerequisiteRoleUrls =
        await waitForLocalPrerequisiteRoleUrls({
          page,
          ids: destinationRequiredLocalPrerequisites,
        });
      const destinationVisitedLocalPrerequisiteDestinations =
        await visitLocalPrerequisiteDestinations({
          page,
          frontendBaseUrl,
          detailUrl: `${frontendBaseUrl}/admin/audit/${destinationAuditId}?game=${encodeURIComponent(
            game,
          )}`,
          game,
          ids: destinationRequiredLocalPrerequisites,
          forbiddenText,
        });
      const destinationVisibleRelatedLinks = await waitForRows({
        page,
        prefix: "admin-audit-related-link",
        ids: destination.requiredRelatedLinks ?? [],
      });
      const destinationVisibleHostedHandoffInputs = await waitForRows({
        page,
        prefix: "admin-audit-hosted-handoff-input",
        ids: destination.requiredHostedHandoffInputs ?? [],
      });
      const destinationVisibleHostedHandoffBlockedChecks = await waitForRows({
        page,
        prefix: "admin-audit-hosted-handoff-blocked-check",
        ids: destination.requiredHostedHandoffBlockedChecks ?? [],
      });
      await assertAdminAuditBodyText({
        page,
        auditId: destinationAuditId,
        forbiddenText,
      });
      visibleRelatedDestinations.push({
        linkId,
        auditId: destinationAuditId,
        detailRoleUrl: `/admin/audit/${destinationAuditId}?game=<seeded-game>`,
        ...(destinationVisibleChecks.length === 0
          ? {}
          : { visibleChecks: destinationVisibleChecks }),
        ...(destinationVisibleScenarios.length === 0
          ? {}
          : { visibleScenarios: destinationVisibleScenarios }),
        ...(destinationVisibleSessions.length === 0
          ? {}
          : { visibleSessions: destinationVisibleSessions }),
        ...(destinationVisibleReconnectLanes.length === 0
          ? {}
          : { visibleReconnectLanes: destinationVisibleReconnectLanes }),
        ...(destinationVisibleStaleConflictLanes.length === 0
          ? {}
          : { visibleStaleConflictLanes: destinationVisibleStaleConflictLanes }),
        ...(destinationVisibleProofLaneCoverage.length === 0
          ? {}
          : { visibleProofLaneCoverage: destinationVisibleProofLaneCoverage }),
        ...(destinationVisibleUnproven.length === 0
          ? {}
          : { visibleUnproven: destinationVisibleUnproven }),
        ...(destinationVisibleLocalPrerequisites.length === 0
          ? {}
          : { visibleLocalPrerequisites: destinationVisibleLocalPrerequisites }),
        ...(Object.keys(destinationVisibleLocalPrerequisiteRoleUrls).length === 0
          ? {}
          : {
              visibleLocalPrerequisiteRoleUrls:
                destinationVisibleLocalPrerequisiteRoleUrls,
            }),
        ...(destinationVisitedLocalPrerequisiteDestinations.length === 0
          ? {}
          : {
              visitedLocalPrerequisiteDestinations:
                destinationVisitedLocalPrerequisiteDestinations,
            }),
        ...(destinationVisibleRelatedLinks.length === 0
          ? {}
          : { visibleRelatedLinks: destinationVisibleRelatedLinks }),
        ...(destinationVisibleHostedHandoffInputs.length === 0
          ? {}
          : { visibleHostedHandoffInputs: destinationVisibleHostedHandoffInputs }),
        ...(destinationVisibleHostedHandoffBlockedChecks.length === 0
          ? {}
          : {
              visibleHostedHandoffBlockedChecks:
                destinationVisibleHostedHandoffBlockedChecks,
            }),
      });
    }
    return {
      status: "passed",
      overviewRoleUrl: "/admin?game=<seeded-game>",
      detailRoleUrl,
      linkTestId,
      surfaceTestId: "admin-audit-detail-surface",
      clickedThroughFromOverview: true,
      ...(visibleChecks.length === 0 ? {} : { visibleChecks }),
      ...(Object.keys(visibleCheckStatuses).length === 0
        ? {}
        : { visibleCheckStatuses }),
      ...(visibleLocalPrerequisites.length === 0
        ? {}
        : { visibleLocalPrerequisites }),
      ...(Object.keys(visibleLocalPrerequisiteRoleUrls).length === 0
        ? {}
        : { visibleLocalPrerequisiteRoleUrls }),
      ...(visitedLocalPrerequisiteDestinations.length === 0
        ? {}
        : { visitedLocalPrerequisiteDestinations }),
      ...(visibleScenarios.length === 0 ? {} : { visibleScenarios }),
      ...(visibleSessions.length === 0 ? {} : { visibleSessions }),
      ...(visibleReconnectLanes.length === 0
        ? {}
        : { visibleReconnectLanes }),
      ...(visibleStaleConflictLanes.length === 0
        ? {}
        : { visibleStaleConflictLanes }),
      ...(visibleProofLaneCoverage.length === 0
        ? {}
        : { visibleProofLaneCoverage }),
      ...(visibleSpineCycles.length === 0 ? {} : { visibleSpineCycles }),
      ...(visibleSpineRoleUrls.length === 0 ? {} : { visibleSpineRoleUrls }),
      ...(visibleSpineCheckpoints.length === 0
        ? {}
        : { visibleSpineCheckpoints }),
      ...(visibleSpineRecoveryHooks.length === 0
        ? {}
        : { visibleSpineRecoveryHooks }),
      ...(visibleUnproven.length === 0 ? {} : { visibleUnproven }),
      ...(visibleRealHostedEvidenceInputs.length === 0
        ? {}
        : { visibleRealHostedEvidenceInputs }),
      ...(visibleHostedHandoffInputs.length === 0
        ? {}
        : { visibleHostedHandoffInputs }),
      ...(visibleHostedHandoffBlockedChecks.length === 0
        ? {}
        : { visibleHostedHandoffBlockedChecks }),
      ...(visibleHostedHandoffGroups.length === 0
        ? {}
        : { visibleHostedHandoffGroups }),
      ...(visibleHostedHandoffSummary === null
        ? {}
        : { visibleHostedHandoffSummary }),
      ...(visibleRelatedLinks.length === 0 ? {} : { visibleRelatedLinks }),
      ...(visibleRelatedDestinations.length === 0
        ? {}
        : { visibleRelatedDestinations }),
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    };
  } finally {
    await page.close();
  }
}

async function assertAdminAuditBodyText({ page, auditId, forbiddenText }) {
  const bodyText = await page.locator("body").innerText();
  if (/invite=(?!REDACTED)/.test(bodyText)) {
    throw new Error(`${auditId} admin surface leaked an invite URL token`);
  }
  for (const token of forbiddenText) {
    if (bodyText.includes(token)) {
      throw new Error(`${auditId} admin surface leaked forbidden text`);
    }
  }
}

async function waitForRows({ page, prefix, ids, expectedStatuses = {} }) {
  const visible = [];
  for (const id of ids) {
    const row = page.getByTestId(`${prefix}-${id}`);
    await row.waitFor({
      state: "visible",
      timeout: 15000,
    });
    const expectedStatus = expectedStatuses[id];
    if (expectedStatus !== undefined) {
      const text = await row.innerText();
      if (!text.includes(expectedStatus)) {
        throw new Error(`${prefix}-${id} missing status ${expectedStatus}: ${text}`);
      }
    }
    visible.push(id);
  }
  return visible;
}

async function waitForHostedHandoffSummary({ page, expected }) {
  if (expected === null || expected === undefined) {
    return null;
  }
  const row = page.getByTestId("admin-audit-hosted-handoff-summary");
  await row.waitFor({
    state: "visible",
    timeout: 15000,
  });
  const text = await row.innerText();
  const summary = {
    status: String(expected.status ?? ""),
    preflightStatus: String(expected.preflightStatus ?? ""),
    command: String(expected.command ?? ""),
    proofTarget: String(expected.proofTarget ?? ""),
  };
  for (const value of Object.values(summary)) {
    if (value === "" || !text.includes(value)) {
      throw new Error(
        `admin-audit-hosted-handoff-summary missing expected text ${value}: ${text}`,
      );
    }
  }
  return summary;
}

async function waitForLocalPrerequisiteRoleUrls({ page, ids }) {
  const roleUrls = {};
  for (const id of ids) {
    const link = page.getByTestId(`admin-audit-local-prerequisite-role-url-${id}`);
    await link.waitFor({
      state: "visible",
      timeout: 15000,
    });
    const href = await link.getAttribute("href");
    if (typeof href !== "string" || href.trim() === "") {
      throw new Error(`admin-audit-local-prerequisite-role-url-${id} missing href`);
    }
    roleUrls[id] = href;
  }
  return roleUrls;
}

async function visitLocalPrerequisiteDestinations({
  page,
  frontendBaseUrl,
  detailUrl,
  game,
  ids,
  forbiddenText,
}) {
  const destinations = [];
  for (const id of ids) {
    await page.goto(detailUrl, { waitUntil: "networkidle" });
    await page.getByTestId("admin-audit-detail-surface").waitFor({
      state: "visible",
      timeout: 15000,
    });
    const link = page.getByTestId(`admin-audit-local-prerequisite-role-url-${id}`);
    await link.waitFor({
      state: "visible",
      timeout: 15000,
    });
    const href = await link.getAttribute("href");
    if (typeof href !== "string" || href.trim() === "") {
      throw new Error(`admin-audit-local-prerequisite-role-url-${id} missing href`);
    }
    const expectedUrl = new URL(href, frontendBaseUrl);
    const expectedGame = expectedUrl.searchParams.get("game");
    if (expectedGame !== game) {
      throw new Error(
        `admin-audit-local-prerequisite-role-url-${id} points at ${expectedGame} instead of ${game}`,
      );
    }
    await Promise.all([
      page.waitForURL(expectedUrl.toString(), { timeout: 15000 }),
      link.click(),
    ]);
    await page.waitForLoadState("networkidle");
    await page.getByTestId("admin-audit-detail-surface").waitFor({
      state: "visible",
      timeout: 15000,
    });
    const destinationAuditId = expectedUrl.pathname.split("/").filter(Boolean).pop();
    if (destinationAuditId === undefined || destinationAuditId === "") {
      throw new Error(`admin-audit-local-prerequisite-role-url-${id} has no audit id`);
    }
    await assertAdminAuditBodyText({
      page,
      auditId: destinationAuditId,
      forbiddenText,
    });
    destinations.push({
      id,
      auditId: destinationAuditId,
      detailRoleUrl: `${expectedUrl.pathname}?game=<seeded-game>`,
      clickedThrough: true,
    });
  }
  return destinations;
}

async function readRowStatuses({ page, prefix, ids }) {
  const statuses = {};
  for (const id of ids) {
    statuses[id] = await page.getByTestId(`${prefix}-${id}`).innerText();
  }
  return statuses;
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
