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

export function normalizedEvidenceObjectRowIds({ parentId, objects }) {
  return (Array.isArray(objects) ? objects : [])
    .map((object) => String(object?.name ?? ""))
    .filter((name) => name !== "")
    .map((name) => `evidence-object:${parentId}:${name}`);
}

export function assertVisibleAdminRoleSurfaceRows({
  adminRoleSurface,
  rowIds,
  proofName,
  rowName = "row",
  surfaceKey = "visibleChecks",
}) {
  const visibleRows = adminRoleSurface?.[surfaceKey];
  for (const rowId of rowIds ?? []) {
    if (!visibleRows?.includes(rowId)) {
      throw new Error(`${proofName} missing ${rowName}: ${rowId}`);
    }
  }
}

export function assertAdminRoleSurfaceStatusText({
  adminRoleSurface,
  expectedStatuses,
  proofName,
  rowName = "row status",
  surfaceKey,
}) {
  const visibleStatuses = adminRoleSurface?.[surfaceKey];
  for (const [rowId, expectedText] of Object.entries(expectedStatuses ?? {})) {
    const visibleText = visibleStatuses?.[rowId];
    if (
      typeof visibleText !== "string" ||
      !visibleText.includes(String(expectedText))
    ) {
      throw new Error(`${proofName} missing ${rowName}: ${rowId}`);
    }
  }
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
  await runAdminAuditProofBatch([
    {
      smokeName,
      stage,
      evidencePath,
      envOverrides,
      loadSource,
      prove,
      buildEvidence,
      assertEvidence,
    },
  ]);
}

export async function runAdminAuditProofBatch(cases) {
  const plan = resolveAdminAuditProofBatchPlan({
    label: "admin audit proof batch",
    reason: "direct proof batch",
    cases,
  });
  return await runResolvedAdminAuditProofBatch(plan);
}

async function runResolvedAdminAuditProofBatch(plan) {
  const { cases: proofCases, envOverrides } = plan;
  const firstCase = proofCases[0];
  const startedAt = Date.now();

  await preflightLocalhostBindOrExit({
    host,
    repoRoot,
    artifactDir,
    evidencePath: firstCase.evidencePath,
    smokeName: firstCase.smokeName,
  });

  let vite;
  let browser;
  const previousFixtureSession = process.env.FMARCH_FRONTEND_FIXTURE_SESSION;
  const previousEnv = new Map(
    Object.keys(envOverrides).map((name) => [name, process.env[name]]),
  );

  try {
    await mkdir(artifactDir, { recursive: true });
    process.env.FMARCH_FRONTEND_FIXTURE_SESSION = "1";
    for (const [name, value] of Object.entries(envOverrides)) {
      process.env[name] = value;
    }
    vite = await startFrontend();
    browser = await chromium.launch();
    const mediaResponseGuard = createUnexpectedMediaResponseGuard({
      label: proofCases.map((proofCase) => proofCase.smokeName).join(","),
    });
    mediaResponseGuard.attachBrowser(browser);
    const baseUrl = await frontendBaseUrl(vite);
    for (const proofCase of proofCases) {
      await runAdminAuditProofCase({
        proofCase,
        browser,
        frontendBaseUrl: baseUrl,
        mediaResponseGuard,
      });
    }
  } catch (error) {
    const handled = await handleLocalhostBindFailure({
      error,
      repoRoot,
      artifactDir,
      evidencePath: firstCase.evidencePath,
      smokeName: firstCase.smokeName,
      stage: firstCase.stage,
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
  return adminAuditProofBatchEvidence({
    plan,
    elapsedMs: Date.now() - startedAt,
  });
}

export async function runAdminAuditProofBatchPlan(plan) {
  return await runResolvedAdminAuditProofBatch(
    resolveAdminAuditProofBatchPlan(plan),
  );
}

export function resolveAdminAuditProofBatchPlan(plan) {
  assertAdminAuditProofBatchPlanShape(plan);
  const cases = plan.cases.map((entry) =>
    typeof entry === "function" ? entry() : entry,
  );
  for (const proofCase of cases) {
    assertAdminAuditProofCase(proofCase);
  }
  const envOverrides = mergeEnvOverrides(cases);
  return {
    label: plan.label,
    reason: plan.reason,
    cases,
    envOverrides,
  };
}

function adminAuditProofBatchEvidence({ plan, elapsedMs }) {
  return Object.freeze({
    label: plan.label,
    reason: plan.reason,
    status: "passed",
    caseCount: plan.cases.length,
    caseSmokeNames: Object.freeze(
      plan.cases.map((proofCase) => proofCase.smokeName),
    ),
    proofIds: Object.freeze(
      plan.cases.map((proofCase) =>
        proofIdFromAdminAuditEvidencePath(proofCase.evidencePath),
      ),
    ),
    artifactPaths: Object.freeze(
      plan.cases.map((proofCase) => path.relative(repoRoot, proofCase.evidencePath)),
    ),
    elapsedMs: Math.max(0, Math.round(elapsedMs)),
    sharedFrontendSession: true,
    sharedChromiumSession: true,
    releaseReady: false,
    productionReady: false,
  });
}

function proofIdFromAdminAuditEvidencePath(evidencePath) {
  const baseName = path.basename(evidencePath, ".json");
  return baseName.endsWith("-admin-proof")
    ? baseName.slice(0, -"admin-proof".length).replace(/-$/u, "")
    : baseName;
}

function assertAdminAuditProofBatchPlanShape(plan) {
  if (
    typeof plan?.label !== "string" ||
    plan.label.trim() === "" ||
    typeof plan.reason !== "string" ||
    plan.reason.trim() === "" ||
    !Array.isArray(plan.cases) ||
    plan.cases.length === 0
  ) {
    throw new Error(
      "admin audit proof batch plan requires label, reason, and cases",
    );
  }
}

async function runAdminAuditProofCase({
  proofCase,
  browser,
  frontendBaseUrl,
  mediaResponseGuard,
}) {
  const source = await proofCase.loadSource();
  const adminRoleSurface = await proofCase.prove({
    browser,
    frontendBaseUrl,
    source,
  });
  mediaResponseGuard.assertNoUnexpectedMedia404({ phase: proofCase.smokeName });
  const evidence = proofCase.buildEvidence({ source, adminRoleSurface });
  proofCase.assertEvidence(evidence);
  await writeFile(proofCase.evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`wrote ${path.relative(repoRoot, proofCase.evidencePath)}`);
}

function assertAdminAuditProofCase(proofCase) {
  if (
    typeof proofCase?.smokeName !== "string" ||
    proofCase.smokeName.trim() === "" ||
    typeof proofCase.stage !== "string" ||
    proofCase.stage.trim() === "" ||
    typeof proofCase.evidencePath !== "string" ||
    proofCase.evidencePath.trim() === "" ||
    typeof proofCase.loadSource !== "function" ||
    typeof proofCase.prove !== "function" ||
    typeof proofCase.buildEvidence !== "function" ||
    typeof proofCase.assertEvidence !== "function"
  ) {
    throw new Error("admin audit proof case is missing required fields");
  }
}

function mergeEnvOverrides(cases) {
  const merged = {};
  for (const proofCase of cases) {
    for (const [name, value] of Object.entries(proofCase.envOverrides ?? {})) {
      if (merged[name] !== undefined && merged[name] !== value) {
        throw new Error(
          `admin audit proof batch has conflicting env override for ${name}`,
        );
      }
      merged[name] = value;
    }
  }
  return merged;
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
  requiredAdminSpineBatches = [],
  requiredAdminSpineBatchStatuses = {},
  requiredUnproven = [],
  requiredRealHostedEvidenceInputs = [],
  requiredHostedHandoffInputs = [],
  requiredHostedHandoffInputValues = {},
  requiredHostedHandoffBlockedChecks = [],
  requiredHostedHandoffBlockedCheckStatuses = {},
  requiredHostedHandoffGroups = [],
  requiredHostedHandoffGroupStatuses = {},
  requiredHostedHandoffInputSections = [],
  requiredHostedHandoffInputSectionStatuses = {},
  requiredHostedHandoffSectionInputs = [],
  requiredHostedHandoffSectionInputStatuses = {},
  requiredHostedIdentityPacketSummaries = [],
  requiredHostedIdentityPacketSummaryStatuses = {},
  requiredHostedIdentityPacketSections = [],
  requiredHostedIdentityPacketSectionStatuses = {},
  requiredHostedIdentityPacketInputs = [],
  requiredHostedIdentityPacketInputStatuses = {},
  requiredHostedIdentityPacketRefs = [],
  requiredHostedIdentityPacketRefStatuses = {},
  requiredHostedIdentityRoleSurfaceContractDiffStatus = null,
  requiredHostedIdentityRoleSurfaceContractMismatches = [],
  requiredHostedIdentityAdapterContractComparisonStatus = null,
  requiredHostedIdentityAdapterContractComparisonMismatches = [],
  requiredIdentityAdapterContractStatus = null,
  requiredIdentityAdapterContractMismatches = [],
  requiredHostedHandoffSummary = null,
  requiredHostedHandoffBlockedReceipt = null,
  requiredRelatedLinks = [],
  requiredRelatedDestinations = [],
  requiredUnprovenStatuses = {},
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
    await page.getByTestId(linkTestId).evaluate((element) => {
      element.scrollIntoView({ block: "center", inline: "nearest" });
    });
    await page.getByTestId(linkTestId).focus();
    await Promise.all([
      page.waitForURL(
        `${frontendBaseUrl}/admin/audit/${auditId}?game=${encodeURIComponent(game)}`,
        { timeout: 15000 },
      ),
      page.keyboard.press("Enter"),
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
    const visibleAdminSpineBatches = await waitForRows({
      page,
      prefix: "admin-audit-admin-spine-batch",
      ids: requiredAdminSpineBatches,
      expectedStatuses: requiredAdminSpineBatchStatuses,
    });
    const visibleAdminSpineBatchStatuses = await readRowStatuses({
      page,
      prefix: "admin-audit-admin-spine-batch",
      ids: Object.keys(requiredAdminSpineBatchStatuses),
    });
    const visibleUnproven = await waitForRows({
      page,
      prefix: "admin-audit-unproven",
      ids: requiredUnproven,
      expectedStatuses: requiredUnprovenStatuses,
    });
    const visibleUnprovenStatuses = await readRowStatuses({
      page,
      prefix: "admin-audit-unproven",
      ids: Object.keys(requiredUnprovenStatuses),
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
      expectedStatuses: requiredHostedHandoffInputValues,
    });
    const visibleHostedHandoffInputValues = await readRowStatuses({
      page,
      prefix: "admin-audit-hosted-handoff-input",
      ids: Object.keys(requiredHostedHandoffInputValues),
    });
    const visibleHostedHandoffBlockedChecks = await waitForRows({
      page,
      prefix: "admin-audit-hosted-handoff-blocked-check",
      ids: requiredHostedHandoffBlockedChecks,
      expectedStatuses: requiredHostedHandoffBlockedCheckStatuses,
    });
    const visibleHostedHandoffBlockedCheckStatuses = await readRowStatuses({
      page,
      prefix: "admin-audit-hosted-handoff-blocked-check",
      ids: Object.keys(requiredHostedHandoffBlockedCheckStatuses),
    });
    const visibleHostedHandoffGroups = await waitForRows({
      page,
      prefix: "admin-audit-hosted-handoff-group",
      ids: requiredHostedHandoffGroups,
      expectedStatuses: requiredHostedHandoffGroupStatuses,
    });
    const visibleHostedHandoffGroupStatuses = await readRowStatuses({
      page,
      prefix: "admin-audit-hosted-handoff-group",
      ids: Object.keys(requiredHostedHandoffGroupStatuses),
    });
    const visibleHostedHandoffInputSections = await waitForRows({
      page,
      prefix: "admin-audit-hosted-handoff-input-section",
      ids: requiredHostedHandoffInputSections,
      expectedStatuses: requiredHostedHandoffInputSectionStatuses,
    });
    const visibleHostedHandoffInputSectionStatuses = await readRowStatuses({
      page,
      prefix: "admin-audit-hosted-handoff-input-section",
      ids: Object.keys(requiredHostedHandoffInputSectionStatuses),
    });
    const visibleHostedHandoffSectionInputs = await waitForRows({
      page,
      prefix: "admin-audit-hosted-handoff-section-input",
      ids: requiredHostedHandoffSectionInputs,
      expectedStatuses: requiredHostedHandoffSectionInputStatuses,
    });
    const visibleHostedHandoffSectionInputStatuses = await readRowStatuses({
      page,
      prefix: "admin-audit-hosted-handoff-section-input",
      ids: Object.keys(requiredHostedHandoffSectionInputStatuses),
    });
    const visibleHostedIdentityPacketSummaries = await waitForRows({
      page,
      prefix: "admin-audit-hosted-identity-packet-summary",
      ids: requiredHostedIdentityPacketSummaries,
      expectedStatuses: requiredHostedIdentityPacketSummaryStatuses,
    });
    const visibleHostedIdentityPacketSummaryStatuses = await readRowStatuses({
      page,
      prefix: "admin-audit-hosted-identity-packet-summary",
      ids: Object.keys(requiredHostedIdentityPacketSummaryStatuses),
    });
    const visibleHostedIdentityPacketSections = await waitForRows({
      page,
      prefix: "admin-audit-hosted-identity-packet-section",
      ids: requiredHostedIdentityPacketSections,
      expectedStatuses: requiredHostedIdentityPacketSectionStatuses,
    });
    const visibleHostedIdentityPacketInputs = await waitForRows({
      page,
      prefix: "admin-audit-hosted-identity-packet-input",
      ids: requiredHostedIdentityPacketInputs,
      expectedStatuses: requiredHostedIdentityPacketInputStatuses,
    });
    const visibleHostedIdentityPacketInputStatuses = await readRowStatuses({
      page,
      prefix: "admin-audit-hosted-identity-packet-input",
      ids: Object.keys(requiredHostedIdentityPacketInputStatuses),
    });
    const visibleHostedIdentityPacketRefs = await waitForRows({
      page,
      prefix: "admin-audit-hosted-identity-packet-ref",
      ids: requiredHostedIdentityPacketRefs,
      expectedStatuses: requiredHostedIdentityPacketRefStatuses,
    });
    const visibleHostedIdentityRoleSurfaceContractDiff =
      await waitForHostedIdentityRoleSurfaceContractDiff({
        page,
        expectedStatus: requiredHostedIdentityRoleSurfaceContractDiffStatus,
      });
    const visibleHostedIdentityRoleSurfaceContractMismatches = await waitForRows({
      page,
      prefix: "admin-audit-hosted-identity-role-surface-contract-mismatch",
      ids: requiredHostedIdentityRoleSurfaceContractMismatches,
    });
    const visibleHostedIdentityAdapterContractComparison =
      await waitForHostedIdentityAdapterContractComparison({
        page,
        expectedStatus: requiredHostedIdentityAdapterContractComparisonStatus,
      });
    const visibleHostedIdentityAdapterContractComparisonMismatches =
      await waitForRows({
        page,
        prefix:
          "admin-audit-hosted-identity-adapter-contract-comparison-mismatch",
        ids: requiredHostedIdentityAdapterContractComparisonMismatches,
      });
    const visibleIdentityAdapterContract = await waitForIdentityAdapterContract({
      page,
      expectedStatus: requiredIdentityAdapterContractStatus,
    });
    const visibleIdentityAdapterContractMismatches = await waitForRows({
      page,
      prefix: "admin-audit-identity-adapter-contract-mismatch",
      ids: requiredIdentityAdapterContractMismatches,
    });
    const visibleHostedHandoffSummary = await waitForHostedHandoffSummary({
      page,
      expected: requiredHostedHandoffSummary,
    });
    const visibleHostedHandoffBlockedReceipt =
      await waitForHostedHandoffBlockedReceipt({
        page,
        expected: requiredHostedHandoffBlockedReceipt,
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
      ...(visibleAdminSpineBatches.length === 0
        ? {}
        : { visibleAdminSpineBatches }),
      ...(Object.keys(visibleAdminSpineBatchStatuses).length === 0
        ? {}
        : { visibleAdminSpineBatchStatuses }),
      ...(visibleUnproven.length === 0 ? {} : { visibleUnproven }),
      ...(Object.keys(visibleUnprovenStatuses).length === 0
        ? {}
        : { visibleUnprovenStatuses }),
      ...(visibleRealHostedEvidenceInputs.length === 0
        ? {}
        : { visibleRealHostedEvidenceInputs }),
      ...(visibleHostedHandoffInputs.length === 0
        ? {}
        : { visibleHostedHandoffInputs }),
      ...(Object.keys(visibleHostedHandoffInputValues).length === 0
        ? {}
        : { visibleHostedHandoffInputValues }),
      ...(visibleHostedHandoffBlockedChecks.length === 0
        ? {}
        : { visibleHostedHandoffBlockedChecks }),
      ...(Object.keys(visibleHostedHandoffBlockedCheckStatuses).length === 0
        ? {}
        : {
            visibleHostedHandoffBlockedCheckStatuses:
              visibleHostedHandoffBlockedCheckStatuses,
          }),
      ...(visibleHostedHandoffGroups.length === 0
        ? {}
        : { visibleHostedHandoffGroups }),
      ...(Object.keys(visibleHostedHandoffGroupStatuses).length === 0
        ? {}
        : { visibleHostedHandoffGroupStatuses }),
      ...(visibleHostedHandoffInputSections.length === 0
        ? {}
        : { visibleHostedHandoffInputSections }),
      ...(Object.keys(visibleHostedHandoffInputSectionStatuses).length === 0
        ? {}
        : {
            visibleHostedHandoffInputSectionStatuses:
              visibleHostedHandoffInputSectionStatuses,
          }),
      ...(visibleHostedHandoffSectionInputs.length === 0
        ? {}
        : { visibleHostedHandoffSectionInputs }),
      ...(Object.keys(visibleHostedHandoffSectionInputStatuses).length === 0
        ? {}
        : {
            visibleHostedHandoffSectionInputStatuses:
              visibleHostedHandoffSectionInputStatuses,
          }),
      ...(visibleHostedIdentityPacketSummaries.length === 0
        ? {}
        : { visibleHostedIdentityPacketSummaries }),
      ...(Object.keys(visibleHostedIdentityPacketSummaryStatuses).length === 0
        ? {}
        : {
            visibleHostedIdentityPacketSummaryStatuses:
              visibleHostedIdentityPacketSummaryStatuses,
          }),
      ...(visibleHostedIdentityPacketSections.length === 0
        ? {}
        : { visibleHostedIdentityPacketSections }),
      ...(visibleHostedIdentityPacketInputs.length === 0
        ? {}
        : { visibleHostedIdentityPacketInputs }),
      ...(Object.keys(visibleHostedIdentityPacketInputStatuses).length === 0
        ? {}
        : {
            visibleHostedIdentityPacketInputStatuses:
              visibleHostedIdentityPacketInputStatuses,
          }),
      ...(visibleHostedIdentityPacketRefs.length === 0
        ? {}
        : { visibleHostedIdentityPacketRefs }),
      ...(visibleHostedIdentityRoleSurfaceContractDiff === null
        ? {}
        : { visibleHostedIdentityRoleSurfaceContractDiff }),
      ...(visibleHostedIdentityRoleSurfaceContractMismatches.length === 0
        ? {}
        : {
            visibleHostedIdentityRoleSurfaceContractMismatches:
              visibleHostedIdentityRoleSurfaceContractMismatches,
          }),
      ...(visibleHostedIdentityAdapterContractComparison === null
        ? {}
        : { visibleHostedIdentityAdapterContractComparison }),
      ...(visibleHostedIdentityAdapterContractComparisonMismatches.length === 0
        ? {}
        : {
            visibleHostedIdentityAdapterContractComparisonMismatches:
              visibleHostedIdentityAdapterContractComparisonMismatches,
          }),
      ...(visibleIdentityAdapterContract === null
        ? {}
        : { visibleIdentityAdapterContract }),
      ...(visibleIdentityAdapterContractMismatches.length === 0
        ? {}
        : {
            visibleIdentityAdapterContractMismatches:
              visibleIdentityAdapterContractMismatches,
          }),
      ...(visibleHostedHandoffSummary === null
        ? {}
        : { visibleHostedHandoffSummary }),
      ...(visibleHostedHandoffBlockedReceipt === null
        ? {}
        : { visibleHostedHandoffBlockedReceipt }),
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

async function waitForHostedIdentityAdapterContractComparison({
  page,
  expectedStatus,
}) {
  if (expectedStatus === null || expectedStatus === undefined) {
    return null;
  }
  const row = page.getByTestId(
    "admin-audit-hosted-identity-adapter-contract-comparison-summary",
  );
  await row.waitFor({
    state: "visible",
    timeout: 15000,
  });
  const text = await row.innerText();
  if (!text.includes(expectedStatus)) {
    throw new Error(
      `hosted identity adapter contract comparison missing ${expectedStatus}: ${text}`,
    );
  }
  return { status: expectedStatus };
}

async function waitForIdentityAdapterContract({ page, expectedStatus }) {
  if (expectedStatus === null || expectedStatus === undefined) {
    return null;
  }
  const row = page.getByTestId("admin-audit-identity-adapter-contract-summary");
  await row.waitFor({
    state: "visible",
    timeout: 15000,
  });
  const text = await row.innerText();
  if (!text.includes(expectedStatus)) {
    throw new Error(
      `identity adapter contract summary missing ${expectedStatus}: ${text}`,
    );
  }
  return { status: expectedStatus };
}

async function waitForHostedIdentityRoleSurfaceContractDiff({
  page,
  expectedStatus,
}) {
  if (expectedStatus === null || expectedStatus === undefined) {
    return null;
  }
  const row = page.getByTestId(
    "admin-audit-hosted-identity-role-surface-contract-diff-summary",
  );
  await row.waitFor({
    state: "visible",
    timeout: 15000,
  });
  const text = await row.innerText();
  if (!text.includes(expectedStatus)) {
    throw new Error(
      `hosted identity role-surface contract diff missing ${expectedStatus}: ${text}`,
    );
  }
  return { status: expectedStatus };
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
    try {
      await row.waitFor({
        state: "visible",
        timeout: 15000,
      });
    } catch (error) {
      const evidence = await page.evaluate((rowPrefix) => {
        const rows = Array.from(
          document.querySelectorAll(`[data-testid^="${rowPrefix}-"]`),
        ).map((node) => node.getAttribute("data-testid"));
        return {
          href: window.location.href,
          rows,
          body: document.body?.innerText?.slice(0, 4000) ?? "",
        };
      }, prefix);
      throw new Error(
        `${prefix}-${id} did not become visible: ${JSON.stringify(evidence)}`,
        { cause: error },
      );
    }
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

async function waitForHostedHandoffBlockedReceipt({ page, expected }) {
  if (expected === null || expected === undefined) {
    return null;
  }
  const row = page.getByTestId("admin-audit-hosted-handoff-blocked-receipt");
  await row.waitFor({
    state: "visible",
    timeout: 15000,
  });
  const text = await row.innerText();
  const receipt = {
    status: String(expected.status ?? ""),
    operatorAction: String(expected.operatorAction ?? ""),
    localVsHostedBoundary: String(expected.localVsHostedBoundary ?? ""),
    nextProofTarget: String(expected.nextProofTarget ?? ""),
    missingRequiredInputs: Array.isArray(expected.missingRequiredInputs)
      ? expected.missingRequiredInputs.map((input) => String(input))
      : [],
  };
  for (const value of [
    receipt.status,
    receipt.operatorAction,
    receipt.localVsHostedBoundary,
    receipt.nextProofTarget,
    ...receipt.missingRequiredInputs,
  ]) {
    if (value === "" || !text.includes(value)) {
      throw new Error(
        `admin-audit-hosted-handoff-blocked-receipt missing expected text ${value}: ${text}`,
      );
    }
  }
  return receipt;
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
