import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertDevTestGameHostedConcurrentRaceMatrixEvidence,
  devTestGameHostedConcurrentRaceMatrixPath,
} from "./dev_test_game_hosted_concurrent_race_matrix.mjs";
import {
  assertDevTestGameHostedEvidenceLane,
  devTestGameHostedEvidenceLanePath,
  runDevTestGameHostedEvidenceLane,
} from "./dev_test_game_hosted_evidence_lane.mjs";
import {
  assertDevTestGameHostedMatrixExternalEvidence,
  buildDevTestGameHostedMatrixExternalEvidence,
} from "./dev_test_game_hosted_matrix_external_evidence.mjs";
import {
  assertDevTestGameHostedMatrixRawEvidence,
  defaultHostedMatrixRawGroupId,
} from "./dev_test_game_hosted_matrix_raw_evidence.mjs";
import {
  localAdminAuditIds,
  localAdminAuditRoleUrl,
} from "./dev_test_game_admin_audit_surface_ids.mjs";
import { repoRoot } from "./dev_test_game_spine_runner.mjs";
import {
  devTestGameHostedEvidenceLaneDemoProofPath,
} from "./dev_test_game_adjacent_artifact_paths.mjs";

export const DEV_TEST_GAME_HOSTED_EVIDENCE_LANE_DEMO_PROOF_VERSION = 1;
export { devTestGameHostedEvidenceLaneDemoProofPath };
export const devTestGameHostedEvidenceLaneDemoProofCommand =
  "test:dev-test-game-hosted-evidence-lane-demo-proof";
export const devTestGameHostedEvidenceLaneDemoRawEvidencePath =
  "target/dev-test-game/hosted-matrix-demo-raw.json";
export const devTestGameHostedEvidenceLaneDemoExternalEvidencePath =
  "target/dev-test-game/hosted-matrix-demo-external.json";
export const devTestGameHostedEvidenceLaneDemoBlockedPath =
  "target/dev-test-game/hosted-evidence-lane-demo-blocked.json";
export const devTestGameHostedEvidenceLaneDemoSyntheticRejectedPath =
  "target/dev-test-game/hosted-evidence-lane-demo-synthetic-rejected.json";

const defaultDemoFrontendBaseUrl = "https://fmarch-demo.example.test";
const defaultDemoApiBaseUrl = "https://api.fmarch-demo.example.test";
const groupCells = Object.freeze({
  "replacement-race-reload": Object.freeze([
    "replacement-private-post",
    "replacement-vote",
    "replacement-action",
  ]),
});

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  const proof = await runDevTestGameHostedEvidenceLaneDemoProof({
    env: process.env,
  });
  console.log(
    `wrote ${devTestGameHostedEvidenceLaneDemoProofPath} (${proof.status})`,
  );
}

export async function runDevTestGameHostedEvidenceLaneDemoProof({
  env = process.env,
  generatedAt = new Date().toISOString(),
} = {}) {
  const frontendBaseUrl =
    optionalEnv(env.FMARCH_HOSTED_EVIDENCE_LANE_DEMO_FRONTEND_URL) ??
    defaultDemoFrontendBaseUrl;
  const apiBaseUrl =
    optionalEnv(env.FMARCH_HOSTED_EVIDENCE_LANE_DEMO_API_URL) ??
    defaultDemoApiBaseUrl;
  const groupId =
    optionalEnv(env.FMARCH_HOSTED_EVIDENCE_LANE_DEMO_GROUP_ID) ??
    defaultHostedMatrixRawGroupId;
  const rawEvidencePath =
    optionalEnv(env.FMARCH_HOSTED_EVIDENCE_LANE_DEMO_RAW_EVIDENCE_PATH) ??
    devTestGameHostedEvidenceLaneDemoRawEvidencePath;
  const externalEvidencePath =
    optionalEnv(env.FMARCH_HOSTED_EVIDENCE_LANE_DEMO_EXTERNAL_EVIDENCE_PATH) ??
    devTestGameHostedEvidenceLaneDemoExternalEvidencePath;

  const blockedLane = assertDevTestGameHostedEvidenceLane(
    await runDevTestGameHostedEvidenceLane({
      env: {},
      generatedAt,
    }),
  );
  await writeJson(devTestGameHostedEvidenceLaneDemoBlockedPath, blockedLane);

  const matrix = assertDevTestGameHostedConcurrentRaceMatrixEvidence(
    await readJson(devTestGameHostedConcurrentRaceMatrixPath),
  );
  const rawEvidence = buildSyntheticHostedMatrixRawEvidence({
    matrix,
    generatedAt,
    frontendBaseUrl,
    apiBaseUrl,
    groupId,
  });
  await writeJson(rawEvidencePath, rawEvidence);

  const syntheticRejectedLane = assertDevTestGameHostedEvidenceLane(
    await runDevTestGameHostedEvidenceLane({
      generatedAt,
      env: {
        FMARCH_HOSTED_MATRIX_FRONTEND_URL: frontendBaseUrl,
        FMARCH_HOSTED_MATRIX_API_URL: apiBaseUrl,
        FMARCH_HOSTED_MATRIX_GROUP_ID: groupId,
        FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH: rawEvidencePath,
        FMARCH_HOSTED_MATRIX_EVIDENCE_PATH: externalEvidencePath,
      },
    }),
  );
  await writeJson(
    devTestGameHostedEvidenceLaneDemoSyntheticRejectedPath,
    syntheticRejectedLane,
  );
  const externalEvidence = assertDevTestGameHostedMatrixExternalEvidence(
    buildDevTestGameHostedMatrixExternalEvidence({
      matrix,
      rawEvidence,
      generatedAt,
      frontendBaseUrl,
      apiBaseUrl,
      groupId,
      rawEvidenceSource: rawEvidencePath,
      allowSyntheticDemo: true,
    }),
    { frontendBaseUrl, apiBaseUrl, groupId },
  );
  await writeJson(externalEvidencePath, externalEvidence);

  const proof = assertDevTestGameHostedEvidenceLaneDemoProof({
    version: DEV_TEST_GAME_HOSTED_EVIDENCE_LANE_DEMO_PROOF_VERSION,
    proof: "dev-test-game-hosted-evidence-lane-demo-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    generatedAt,
    scope: "local-dev-test-game-hosted-evidence-lane-demo-proof",
    proofBoundary:
      "Local demo proof for the hosted evidence lane synthetic boundary. It writes synthetic external-looking raw evidence from the saved local hosted-like matrix, proves the hosted lane rejects that synthetic input, separately validates the demo normalizer path, and keeps hosted deployment, beta readiness, release readiness, and production readiness unproven.",
    target: {
      frontendBaseUrl,
      apiBaseUrl,
      groupId,
      syntheticExternalTarget: true,
    },
    generatedFrom: {
      hostedConcurrentRaceMatrix: devTestGameHostedConcurrentRaceMatrixPath,
      hostedConcurrentRaceMatrixGeneratedAt: matrix.generatedAt,
      hostedEvidenceLane: devTestGameHostedEvidenceLanePath,
      blockedLane: devTestGameHostedEvidenceLaneDemoBlockedPath,
      syntheticRejectedLane:
        devTestGameHostedEvidenceLaneDemoSyntheticRejectedPath,
      rawEvidence: rawEvidencePath,
      externalEvidence: externalEvidencePath,
    },
    checks: [
      {
        id: "blocked-lane-recorded",
        status: blockedLane.status,
        evidence: devTestGameHostedEvidenceLaneDemoBlockedPath,
      },
      {
        id: "synthetic-raw-evidence-written",
        status: rawEvidence.status,
        evidence: rawEvidencePath,
      },
      {
        id: "synthetic-lane-rejected",
        status: syntheticRejectedLane.status,
        evidence: devTestGameHostedEvidenceLaneDemoSyntheticRejectedPath,
      },
      {
        id: "demo-external-evidence-written",
        status: externalEvidence.status,
        evidence: externalEvidencePath,
      },
      {
        id: "synthetic-demo-boundary-carried",
        status:
          syntheticRejectedLane.status === "blocked" &&
          syntheticRejectedLane.blockedCheckIds.includes(
            "raw-evidence-real-hosted-target",
          ) &&
          externalEvidence.sourceMode === "synthetic-demo"
            ? "passed"
            : "blocked",
        hostedEvidenceMode: syntheticRejectedLane.hostedEvidence?.mode,
        realHostedEvidenceStatus:
          syntheticRejectedLane.hostedEvidence?.realHostedEvidenceStatus,
      },
      {
        id: "release-claim-boundary-carried",
        status: "passed",
        releaseReady: false,
        productionReady: false,
      },
    ],
    handoff: {
      blockedRoleUrl:
        localAdminAuditRoleUrl(localAdminAuditIds.hostedEvidenceLane),
      syntheticRejectedRoleUrl:
        localAdminAuditRoleUrl(localAdminAuditIds.hostedEvidenceLane),
      blockedNextCommand: blockedLane.nextCommand,
      syntheticRejectedNextCommand: syntheticRejectedLane.nextCommand,
      syntheticRejectedNextProofTarget: syntheticRejectedLane.nextProofTarget,
      demoExternalEvidencePath: externalEvidencePath,
    },
    blockedLane: {
      status: blockedLane.status,
      preflightStatus: blockedLane.preflightStatus,
      blockedCheckIds: [...blockedLane.blockedCheckIds],
      nextProofTarget: blockedLane.nextProofTarget,
    },
    syntheticRejectedLane: {
      status: syntheticRejectedLane.status,
      preflightStatus: syntheticRejectedLane.preflightStatus,
      blockedCheckIds: [...syntheticRejectedLane.blockedCheckIds],
      hostedEvidenceMode: syntheticRejectedLane.hostedEvidence?.mode,
      realHostedEvidenceStatus:
        syntheticRejectedLane.hostedEvidence?.realHostedEvidenceStatus,
      nextProofTarget: syntheticRejectedLane.nextProofTarget,
    },
    externalEvidence: {
      proof: externalEvidence.proof,
      status: externalEvidence.status,
      sourceMode: externalEvidence.sourceMode,
      rawEvidenceSyntheticExternalTarget:
        externalEvidence.generatedFrom.rawEvidenceSyntheticExternalTarget,
      groupIds: [...externalEvidence.groupIds],
      cellIds: [...externalEvidence.cellIds],
      commandRaceCount: externalEvidence.commandRaceCount,
      reloadRecoveryCount: externalEvidence.reloadRecoveryCount,
      reconnectRecovery: externalEvidence.reconnectRecovery,
      staleConflictMessages: externalEvidence.staleConflictMessages,
      rawRoleCredentialsRedacted: externalEvidence.rawRoleCredentialsRedacted,
    },
  });
  await writeJson(devTestGameHostedEvidenceLaneDemoProofPath, proof);
  return proof;
}

export function assertDevTestGameHostedEvidenceLaneDemoProof(proof) {
  if (
    proof?.version !== DEV_TEST_GAME_HOSTED_EVIDENCE_LANE_DEMO_PROOF_VERSION ||
    proof.proof !== "dev-test-game-hosted-evidence-lane-demo-proof" ||
    proof.status !== "passed" ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.scope !== "local-dev-test-game-hosted-evidence-lane-demo-proof" ||
    proof.target?.syntheticExternalTarget !== true
  ) {
    throw new Error("hosted evidence lane demo proof shape drifted");
  }
  const checks = new Map((proof.checks ?? []).map((check) => [check.id, check]));
  for (const id of [
    "blocked-lane-recorded",
    "synthetic-raw-evidence-written",
    "synthetic-lane-rejected",
    "demo-external-evidence-written",
    "synthetic-demo-boundary-carried",
    "release-claim-boundary-carried",
  ]) {
    if (
      checks.get(id)?.status !== "passed" &&
      id !== "blocked-lane-recorded" &&
      id !== "synthetic-lane-rejected"
    ) {
      throw new Error(`hosted evidence lane demo proof missing passed check: ${id}`);
    }
  }
  if (checks.get("blocked-lane-recorded")?.status !== "blocked") {
    throw new Error("hosted evidence lane demo proof missed blocked state");
  }
  if (checks.get("synthetic-lane-rejected")?.status !== "blocked") {
    throw new Error("hosted evidence lane demo proof missed synthetic rejection");
  }
  if (
    proof.blockedLane?.status !== "blocked" ||
    proof.blockedLane?.preflightStatus !== "blocked" ||
    !Array.isArray(proof.blockedLane.blockedCheckIds) ||
    proof.blockedLane.blockedCheckIds.length === 0 ||
    proof.syntheticRejectedLane?.status !== "blocked" ||
    proof.syntheticRejectedLane?.preflightStatus !== "blocked" ||
    proof.syntheticRejectedLane?.hostedEvidenceMode !== "blocked" ||
    proof.syntheticRejectedLane?.realHostedEvidenceStatus !== "unproven" ||
    !Array.isArray(proof.syntheticRejectedLane.blockedCheckIds) ||
    !proof.syntheticRejectedLane.blockedCheckIds.includes(
      "raw-evidence-real-hosted-target",
    ) ||
    proof.handoff?.blockedRoleUrl !==
      localAdminAuditRoleUrl(localAdminAuditIds.hostedEvidenceLane) ||
    proof.handoff?.syntheticRejectedRoleUrl !==
      localAdminAuditRoleUrl(localAdminAuditIds.hostedEvidenceLane)
  ) {
    throw new Error("hosted evidence lane demo handoff drifted");
  }
  if (
    proof.externalEvidence?.status !== "passed" ||
    proof.externalEvidence?.sourceMode !== "synthetic-demo" ||
    proof.externalEvidence?.rawEvidenceSyntheticExternalTarget !== true ||
    proof.externalEvidence?.rawRoleCredentialsRedacted !== true ||
    proof.generatedFrom?.rawEvidence === undefined ||
    proof.generatedFrom?.externalEvidence === undefined
  ) {
    throw new Error("hosted evidence lane demo external evidence drifted");
  }
  return proof;
}

function buildSyntheticHostedMatrixRawEvidence({
  matrix,
  generatedAt,
  frontendBaseUrl,
  apiBaseUrl,
  groupId,
}) {
  const cellIds = groupCells[groupId];
  if (cellIds === undefined) {
    throw new Error(`unsupported hosted evidence lane demo group: ${groupId}`);
  }
  const cells = cellIds.map((cellId) => {
    const cell = matrix.cells.find((candidate) => candidate.id === cellId);
    if (cell?.status !== "passed") {
      throw new Error(`hosted evidence lane demo cell is not passed: ${cellId}`);
    }
    return cell;
  });
  return assertDevTestGameHostedMatrixRawEvidence(
    {
      version: 1,
      proof: "fmarch-hosted-concurrent-race-matrix-raw",
      status: "passed",
      generatedAt,
      frontendBaseUrl,
      apiBaseUrl,
      groupId,
      commandRaceCount: cells.length,
      reloadRecoveryCount: cells.length,
      reconnectRecovery: matrix.reconnectLanes.length > 0,
      staleConflictMessages: matrix.staleConflictLanes.length > 0,
      rawRoleCredentialsRedacted: matrix.hostedLikeTarget.roleSurfaces.every(
        (surface) =>
          !("token" in surface) &&
          !("inviteToken" in surface) &&
          !("loginUrl" in surface) &&
          !String(surface.directUrl ?? "").includes("invite="),
      ),
      generatedFrom: {
        hostedConcurrentRaceMatrix: devTestGameHostedConcurrentRaceMatrixPath,
        hostedConcurrentRaceMatrixGeneratedAt: matrix.generatedAt,
        groupId,
        syntheticExternalTarget: true,
      },
      observations: cells.map((cell) => ({
        id: `${cell.id}-demo-raw-observation`,
        status: "passed",
        cellId: cell.id,
        raceLaneId: cell.raceLane.id,
        reloadLaneId: cell.reloadLane.id,
        roleSurfaces: [...cell.roleSurfaces],
      })),
      proofBoundary:
        "Synthetic raw hosted-matrix evidence for the hosted evidence lane demo. It reuses the saved local hosted-like matrix observations with external-looking target URLs so the lane pass path can be exercised locally; it does not prove a real hosted deployment.",
    },
    { frontendBaseUrl, apiBaseUrl, groupId },
  );
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.resolve(repoRoot, relativePath), "utf8"));
}

async function writeJson(relativePath, value) {
  const absolutePath = path.resolve(repoRoot, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(value, null, 2)}\n`);
}

function optionalEnv(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}
