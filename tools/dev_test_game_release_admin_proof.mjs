import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertDevTestGameReleaseReadiness } from "./dev_test_game_release_readiness.mjs";
import {
  devTestGameReleaseAdminProofPath,
} from "./dev_test_game_release_artifact_paths.mjs";
import {
  releaseAdminProofFallbackUnprovenIds,
} from "./dev_test_game_release_readiness_cases.mjs";
import {
  devTestGameReleaseReadinessPath,
} from "./dev_test_game_spine_artifact_paths.mjs";
import {
  assertAdminRoleSurfaceEvidenceArtifact,
  assertAdminRoleSurfaceLocalPrerequisiteArtifacts,
  assertVisibleAdminRoleSurfaceRows,
  proveAdminAuditDetail,
  readJson,
  repoRoot,
  runAdminAuditProof,
} from "./dev_test_game_admin_audit_proof_helper.mjs";
import {
  normalizedEvidenceObjectRowIds,
} from "./dev_test_game_normalized_evidence_object_rows.mjs";

const readinessPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_RELEASE_READINESS ??
    devTestGameReleaseReadinessPath,
);
const readinessRelativePath = path.relative(repoRoot, readinessPath);
const evidencePath = path.join(repoRoot, devTestGameReleaseAdminProofPath);
const requiredReleaseChecks = [
  "local-role-url-browser-proof",
  "local-core-loop-proof",
  "local-hardening-proof",
];
const requiredLocalPrerequisites = [
  "local-proof-graph-admin-role-handoffs",
  "local-proof-freshness-admin-surface",
  "local-next-action-admin-surface",
  "local-hosted-evidence-lane-demo-proof",
];
const requiredUnprovenItems = releaseAdminProofFallbackUnprovenIds;
const requiredSetupCommandEvidence = [
  "addSlot",
  "assignSlot",
  "assignRole",
  "setPostPolicy",
  "startGame",
];

export function releaseAdminProofCase() {
  return {
    smokeName: "dev-test-game-release-admin-proof",
    stage: "release-admin-proof-listen",
    evidencePath,
    envOverrides: {
      FMARCH_DEV_TEST_GAME_RELEASE_READINESS: readinessRelativePath,
    },
    loadSource: async () =>
      assertDevTestGameReleaseReadiness(await readJson(readinessPath)),
    prove: async ({ browser, frontendBaseUrl, source: readiness }) => {
      const localPrerequisiteChecks = releaseLocalPrerequisiteChecks(readiness);
      return await proveAdminAuditDetail({
        browser,
        frontendBaseUrl,
        game: readiness.generatedFrom.game,
        auditId: "local-release-readiness",
        requiredChecks: releaseReadinessVisibleCheckIds(readiness),
        requiredLocalDiagnostics: releaseReadinessDiagnosticIds(readiness),
        requiredLocalPrerequisites: localPrerequisiteChecks.map((check) => check.id),
        requiredLocalPrerequisiteArtifacts:
          releaseLocalPrerequisiteArtifactExpectations(localPrerequisiteChecks),
        requiredSetupCommandEvidence:
          readiness.localDevelopmentSpine.evidence?.hostSetupProof
            ?.setupCommandEvidence === undefined
            ? []
            : requiredSetupCommandEvidence,
        requiredRoleUrlProductionFeatureAudits:
          releaseRoleUrlProductionFeatureAuditSummary(readiness) === null
            ? []
            : ["summary"],
        requiredRoleUrlProductionFeatureAuditStatuses:
          releaseRoleUrlProductionFeatureAuditStatusExpectations(readiness),
        requiredEvidenceArtifact: {
          artifact: readinessRelativePath,
          requiredText: [
            "dev-test-game-release-readiness",
            "local-dev-test-game-release-readiness",
          ],
        },
        requiredUnproven: readiness.releaseReadiness.unproven.map((item) => item.id),
        requiredText:
          releaseReadinessDiagnosticIds(readiness).length === 0
            ? []
            : ["Diagnostics, Not Gates"],
      });
    },
    buildEvidence: ({ source: readiness, adminRoleSurface }) => ({
      version: 1,
      proof: "dev-test-game-release-admin-proof",
      status: "passed",
      releaseReady: false,
      productionReady: false,
      scope: "local-dev-test-game-release-admin-surface",
      proofBoundary:
        "Local SvelteKit admin role URL with fixture admin authority over the dev-test-game release-readiness checklist. Proves the local checklist is discoverable from the seeded admin overview and inspectable in a native admin audit detail route with local checks, normalized evidence-object rows, and remaining unproven release items visible; it does not prove hosted deployment, hosted identity, hosted operations, production backup/PITR, exhaustive race coverage, human release approval, beta readiness, or production readiness.",
      generatedFrom: {
        releaseReadinessChecklist: readinessRelativePath,
        game: readiness.generatedFrom.game,
        localCheckIds: readiness.localDevelopmentSpine.checks.map((check) => check.id),
        localDiagnosticIds: releaseReadinessDiagnosticIds(readiness),
        evidenceObjectRowIds:
          releaseReadinessEvidenceObjectRowIds(readiness),
        localPrerequisiteIds: readiness.localDevelopmentSpine.checks
          .filter((check) => check.dependencyGated === true)
          .map((check) => check.id),
        localPrerequisiteArtifacts:
          releaseLocalPrerequisiteArtifactExpectations(
            releaseLocalPrerequisiteChecks(readiness),
          ),
        setupCommandEvidenceIds: requiredSetupCommandEvidence.filter(
          (id) =>
            readiness.localDevelopmentSpine.evidence?.hostSetupProof
              ?.setupCommandEvidence?.[id] !== undefined,
        ),
        roleUrlProductionFeatureAuditSummary:
          releaseRoleUrlProductionFeatureAuditSummary(readiness),
        unprovenIds: readiness.releaseReadiness.unproven.map((item) => item.id),
      },
      adminRoleSurface,
    }),
    assertEvidence: assertReleaseAdminProof,
  };
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  await runAdminAuditProof(releaseAdminProofCase());
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
  assertAdminRoleSurfaceEvidenceArtifact({
    adminRoleSurface: evidence.adminRoleSurface,
    artifact: readinessRelativePath,
    proofName: "release admin proof",
  });
  assertAdminRoleSurfaceLocalPrerequisiteArtifacts({
    adminRoleSurface: evidence.adminRoleSurface,
    expectedArtifacts: evidence.generatedFrom?.localPrerequisiteArtifacts,
    proofName: "release admin proof",
  });
  for (const checkId of evidence.generatedFrom?.localCheckIds ?? requiredReleaseChecks) {
    if (!evidence.adminRoleSurface?.visibleChecks?.includes(checkId)) {
      throw new Error(`release admin proof missing visible check: ${checkId}`);
    }
  }
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.evidenceObjectRowIds,
    proofName: "release admin proof",
    rowName: "evidence object",
  });
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.localDiagnosticIds,
    proofName: "release admin proof",
    rowName: "local diagnostic",
    surfaceKey: "visibleLocalDiagnostics",
  });
  for (const prerequisiteId of
    evidence.generatedFrom?.localPrerequisiteIds ?? requiredLocalPrerequisites) {
    if (!evidence.adminRoleSurface?.visibleLocalPrerequisites?.includes(prerequisiteId)) {
      throw new Error(
        `release admin proof missing visible local prerequisite: ${prerequisiteId}`,
      );
    }
    if (
      typeof evidence.adminRoleSurface?.visibleLocalPrerequisiteRoleUrls?.[
        prerequisiteId
      ] !== "string"
    ) {
      throw new Error(
        `release admin proof missing local prerequisite role URL: ${prerequisiteId}`,
      );
    }
    const visitedDestination =
      evidence.adminRoleSurface?.visitedLocalPrerequisiteDestinations?.find(
        (destination) =>
          destination?.id === prerequisiteId &&
          destination.clickedThrough === true &&
          typeof destination.auditId === "string" &&
          typeof destination.detailRoleUrl === "string",
      );
    if (visitedDestination === undefined) {
      throw new Error(
        `release admin proof did not navigate local prerequisite: ${prerequisiteId}`,
      );
    }
  }
  for (const commandId of
    evidence.generatedFrom?.setupCommandEvidenceIds ?? requiredSetupCommandEvidence) {
    if (!evidence.adminRoleSurface?.visibleSetupCommandEvidence?.includes(commandId)) {
      throw new Error(
        `release admin proof missing visible setup command evidence: ${commandId}`,
      );
    }
  }
  assertReleaseAdminRoleUrlProductionFeatureAudit(evidence);
  for (const itemId of evidence.generatedFrom?.unprovenIds ?? requiredUnprovenItems) {
    if (!evidence.adminRoleSurface?.visibleUnproven?.includes(itemId)) {
      throw new Error(`release admin proof missing visible unproven item: ${itemId}`);
    }
  }
  return evidence;
}

function releaseRoleUrlProductionFeatureAuditSummary(readiness) {
  const summary =
    readiness.readinessSummary?.roleUrlProductionFeatureAuditSummary;
  if (summary === undefined) {
    return null;
  }
  return {
    status: String(summary.status ?? "unknown"),
    passedRoleUrlLaneCount: Number(summary.passedRoleUrlLaneCount ?? 0),
    productionFeatureLaneCount: Number(summary.productionFeatureLaneCount ?? 0),
    directProductionFeatureLaneCount: Number(
      summary.directProductionFeatureLaneCount ?? 0,
    ),
    aliasOnlyLaneCount: Number(summary.aliasOnlyLaneCount ?? 0),
    aggregateOnlyLaneCount: Number(summary.aggregateOnlyLaneCount ?? 0),
    unclassifiedLaneCount: Number(summary.unclassifiedLaneCount ?? 0),
  };
}

function releaseRoleUrlProductionFeatureAuditStatusExpectations(readiness) {
  const summary = releaseRoleUrlProductionFeatureAuditSummary(readiness);
  if (summary === null) {
    return {};
  }
  return {
    summary: `${summary.unclassifiedLaneCount} unclassified`,
  };
}

function releaseRoleUrlProductionFeatureAuditStatusText(summary) {
  return [
    `${summary.passedRoleUrlLaneCount} passed role URL lanes`,
    `${summary.productionFeatureLaneCount} production feature lanes`,
    `${summary.directProductionFeatureLaneCount} direct`,
    `${summary.aliasOnlyLaneCount} alias`,
    `${summary.aggregateOnlyLaneCount} aggregate`,
    `${summary.unclassifiedLaneCount} unclassified`,
  ].join("\n");
}

function assertReleaseAdminRoleUrlProductionFeatureAudit(evidence) {
  const summary = evidence.generatedFrom?.roleUrlProductionFeatureAuditSummary;
  if (summary === null || summary === undefined) {
    return null;
  }
  if (
    summary.status !== "passed" ||
    !Number.isInteger(summary.passedRoleUrlLaneCount) ||
    !Number.isInteger(summary.productionFeatureLaneCount) ||
    !Number.isInteger(summary.directProductionFeatureLaneCount) ||
    !Number.isInteger(summary.aliasOnlyLaneCount) ||
    !Number.isInteger(summary.aggregateOnlyLaneCount) ||
    summary.unclassifiedLaneCount !== 0
  ) {
    throw new Error("release admin proof role URL audit summary is malformed");
  }
  if (
    !evidence.adminRoleSurface?.visibleRoleUrlProductionFeatureAudits?.includes(
      "summary",
    )
  ) {
    throw new Error("release admin proof missing visible role URL audit summary");
  }
  const visibleText =
    evidence.adminRoleSurface?.visibleRoleUrlProductionFeatureAuditStatuses
      ?.summary ?? "";
  for (const token of releaseRoleUrlProductionFeatureAuditStatusText(
    summary,
  ).split("\n")) {
    if (!visibleText.includes(token)) {
      throw new Error(
        `release admin proof role URL audit summary missing text: ${token}`,
      );
    }
  }
  return summary;
}

export function assertReleaseAdminProofDiagnosticsMatchReadiness({
  proof,
  readiness,
}) {
  const readinessDiagnosticIds = releaseReadinessDiagnosticIds(readiness);
  const proofDiagnosticIds = (proof.generatedFrom?.localDiagnosticIds ?? []).map(
    (id) => String(id),
  );
  const readinessJson = JSON.stringify(readinessDiagnosticIds);
  const proofJson = JSON.stringify(proofDiagnosticIds);
  if (readinessJson !== proofJson) {
    throw new Error(
      `release admin proof diagnostic ids drifted from readiness checklist: ${proofJson} !== ${readinessJson}`,
    );
  }
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: proof.adminRoleSurface,
    rowIds: readinessDiagnosticIds,
    proofName: "release admin proof readiness diagnostic contract",
    rowName: "local diagnostic",
    surfaceKey: "visibleLocalDiagnostics",
  });
  return proof;
}

function releaseReadinessVisibleCheckIds(readiness) {
  return [
    ...readiness.localDevelopmentSpine.checks.map((check) => check.id),
    ...releaseReadinessEvidenceObjectRowIds(readiness),
  ];
}

export function releaseReadinessDiagnosticIds(readiness) {
  return (readiness.localDevelopmentSpine.diagnostics ?? []).map(
    (diagnostic) => diagnostic.id,
  );
}

function releaseLocalPrerequisiteChecks(readiness) {
  return readiness.localDevelopmentSpine.checks.filter(
    (check) => check.dependencyGated === true,
  );
}

function releaseLocalPrerequisiteArtifactExpectations(checks) {
  return checks.map((check) => ({
    id: String(check.id ?? ""),
    proofTarget: String(check.recovery?.proofTarget ?? ""),
    evidence: String(check.evidence ?? ""),
  }));
}

function releaseReadinessEvidenceObjectRowIds(readiness) {
  return readiness.localDevelopmentSpine.checks.flatMap((check) =>
    normalizedEvidenceObjectRowIds({
      parentId: check.id,
      objects: check.normalizedEvidenceObjects,
    }),
  );
}
