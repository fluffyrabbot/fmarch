import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertDevTestGameHostedMatrixRawEvidence,
  defaultHostedMatrixRawGroupId,
  hostedMatrixRawEvidenceContract,
  hostedMatrixRawEvidenceContractSummary,
} from "./dev_test_game_hosted_matrix_raw_evidence.mjs";
import {
  devTestGameHostedMatrixExternalEvidenceCommand,
  devTestGameHostedMatrixExternalEvidencePath,
} from "./dev_test_game_hosted_matrix_external_evidence.mjs";
export {
  devTestGameHostedTargetPreflightAdminProofPath,
  hostedTargetPreflightBlockingCheckIds,
  hostedTargetPreflightCheckIds,
  hostedTargetPreflightExternalTargetsRequiredEvidence,
  hostedTargetPreflightFixtureRawEvidenceRequiredEvidence,
  hostedTargetPreflightMissingApiUrlRequiredEvidence,
  hostedTargetPreflightMissingFrontendUrlRequiredEvidence,
  hostedTargetPreflightMissingRawEvidencePathRequiredEvidence,
  hostedTargetPreflightRawCaptureRequiredEvidence,
  devTestGameHostedTargetPreflightRealCaptureAdminProofPath,
  devTestGameHostedTargetPreflightRealCaptureProofSourcePath,
  hostedTargetPreflightSyntheticRawEvidenceRequiredEvidence,
} from "./dev_test_game_hosted_target_preflight_cases.mjs";
import {
  hostedTargetPreflightExternalTargetsRequiredEvidence,
  hostedTargetPreflightFixtureRawEvidenceRequiredEvidence,
  hostedTargetPreflightCheckIds,
  hostedTargetPreflightMissingApiUrlRequiredEvidence,
  hostedTargetPreflightMissingFrontendUrlRequiredEvidence,
  hostedTargetPreflightMissingRawEvidencePathRequiredEvidence,
  hostedTargetPreflightRawCaptureRequiredEvidence,
  hostedTargetPreflightSyntheticRawEvidenceRequiredEvidence,
} from "./dev_test_game_hosted_target_preflight_cases.mjs";
import {
  assertHostedEvidenceHandoffChecklist,
  hostedEvidenceHandoffChecklistFromPreflight,
} from "./dev_test_game_hosted_handoff_cases.mjs";
import {
  isExternallyHostedUrl,
} from "./dev_test_game_hosted_target_url_policy.mjs";
import { repoRoot } from "./dev_test_game_spine_runner.mjs";
import {
  devTestGameHostedTargetPreflightPath,
} from "./dev_test_game_adjacent_artifact_paths.mjs";
import {
  devTestGameRealHostedMatrixRawCaptureCommand,
  devTestGameRealHostedMatrixRawCapturePath,
} from "./dev_test_game_real_hosted_matrix_raw_capture_contract.mjs";
import {
  buildDevTestGameRealHostedMatrixRawCapture,
} from "./dev_test_game_real_hosted_matrix_raw_capture.mjs";
import {
  localAdminAuditIds,
  localAdminAuditRoleUrl,
} from "./dev_test_game_admin_audit_surface_ids.mjs";
import {
  devTestGameProofGraphPath,
} from "./dev_test_game_proof_graph_paths.mjs";

export const DEV_TEST_GAME_HOSTED_TARGET_PREFLIGHT_VERSION = 1;
export { devTestGameHostedTargetPreflightPath };
export const devTestGameHostedTargetPreflightCommand =
  "test:dev-test-game-hosted-target-preflight";
const outputPath = path.join(repoRoot, devTestGameHostedTargetPreflightPath);

const hostedTargetInputCheckIds = Object.freeze({
  FMARCH_HOSTED_MATRIX_FRONTEND_URL: "hosted-frontend-url-configured",
  FMARCH_HOSTED_MATRIX_API_URL: "hosted-api-url-configured",
  FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH: "raw-evidence-path-configured",
});

const hostedTargetInputSections = Object.freeze({
  FMARCH_HOSTED_MATRIX_FRONTEND_URL: Object.freeze({
    id: "hosted-target",
    label: "Hosted target",
  }),
  FMARCH_HOSTED_MATRIX_API_URL: Object.freeze({
    id: "hosted-target",
    label: "Hosted target",
  }),
  FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH: Object.freeze({
    id: "raw-evidence",
    label: "Raw evidence",
  }),
});

const hostedTargetBlockedEvidenceByCheckId = Object.freeze({
  "hosted-frontend-url-configured":
    hostedTargetPreflightMissingFrontendUrlRequiredEvidence,
  "hosted-api-url-configured":
    hostedTargetPreflightMissingApiUrlRequiredEvidence,
  "raw-evidence-path-configured":
    hostedTargetPreflightMissingRawEvidencePathRequiredEvidence,
  "raw-evidence-readable":
    hostedTargetPreflightMissingRawEvidencePathRequiredEvidence,
  "raw-evidence-real-hosted-target":
    hostedTargetPreflightRawCaptureRequiredEvidence,
});

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  const preflight = await buildDevTestGameHostedTargetPreflight({
    env: process.env,
  });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(preflight, null, 2)}\n`);
  console.log(`wrote ${devTestGameHostedTargetPreflightPath} (${preflight.status})`);
}

export async function buildDevTestGameHostedTargetPreflight({
  env = process.env,
  generatedAt = new Date().toISOString(),
} = {}) {
  const frontendBaseUrl = optionalEnv(env.FMARCH_HOSTED_MATRIX_FRONTEND_URL);
  const apiBaseUrl = optionalEnv(env.FMARCH_HOSTED_MATRIX_API_URL);
  const rawEvidencePath = optionalEnv(env.FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH);
  const groupId = optionalEnv(env.FMARCH_HOSTED_MATRIX_GROUP_ID) ?? defaultHostedMatrixRawGroupId;
  const rawEvidence = await readRawEvidence({
    rawEvidencePath,
    frontendBaseUrl,
    apiBaseUrl,
    groupId,
  });
  const rawCapture = await buildDevTestGameRealHostedMatrixRawCapture({
    env,
    generatedAt,
  });
  const checks = [
    {
      id: "hosted-frontend-url-configured",
      status: frontendBaseUrl === null ? "blocked" : "passed",
      ...(frontendBaseUrl === null
        ? {
            requiredEvidence:
              hostedTargetPreflightMissingFrontendUrlRequiredEvidence,
          }
        : { evidence: frontendBaseUrl }),
    },
    {
      id: "hosted-api-url-configured",
      status: apiBaseUrl === null ? "blocked" : "passed",
      ...(apiBaseUrl === null
        ? {
            requiredEvidence:
              hostedTargetPreflightMissingApiUrlRequiredEvidence,
          }
        : { evidence: apiBaseUrl }),
    },
    {
      id: "hosted-targets-external",
      status:
        frontendBaseUrl !== null &&
        apiBaseUrl !== null &&
        isExternallyHostedUrl(frontendBaseUrl) &&
        isExternallyHostedUrl(apiBaseUrl)
          ? "passed"
          : "blocked",
      requiredEvidence: hostedTargetPreflightExternalTargetsRequiredEvidence({
        frontendBaseUrl,
        apiBaseUrl,
      }),
    },
    {
      id: "raw-evidence-path-configured",
      status: rawEvidencePath === null ? "blocked" : "passed",
      ...(rawEvidencePath === null
        ? {
            requiredEvidence:
              hostedTargetPreflightMissingRawEvidencePathRequiredEvidence,
          }
        : { evidence: rawEvidencePath }),
    },
    {
      id: "raw-evidence-readable",
      status: rawEvidence.status,
      ...(rawEvidence.evidence === undefined ? {} : { evidence: rawEvidence.evidence }),
      ...(rawEvidence.requiredEvidence === undefined
        ? {}
        : { requiredEvidence: rawEvidence.requiredEvidence }),
    },
    {
      id: "raw-evidence-real-hosted-target",
      status: rawCapture.status === "passed" ? "passed" : "blocked",
      ...(rawCapture.status === "passed"
        ? {
            evidence: {
              ...rawEvidence.evidence,
              rawCapture: devTestGameRealHostedMatrixRawCapturePath,
            },
          }
        : {
            requiredEvidence:
              rawEvidence.syntheticExternalTarget === true
                ? hostedTargetPreflightSyntheticRawEvidenceRequiredEvidence
                : rawEvidence.fixtureEvidence === true
                  ? hostedTargetPreflightFixtureRawEvidenceRequiredEvidence
                  : rawCapture.status === "blocked"
                    ? hostedTargetPreflightRawCaptureRequiredEvidence
                    : hostedTargetPreflightMissingRawEvidencePathRequiredEvidence,
            rawCaptureBlockedCheckIds: rawCapture.blockedCheckIds,
          }),
    },
    {
      id: "release-claim-boundary-carried",
      status: "passed",
      releaseReady: false,
      productionReady: false,
    },
  ];
  const status = checks.every((check) => check.status === "passed") ? "passed" : "blocked";
  const blockedCheckIds = checks
    .filter((check) => check.status === "blocked")
    .map((check) => check.id);
  const preflight = {
    version: DEV_TEST_GAME_HOSTED_TARGET_PREFLIGHT_VERSION,
    proof: "dev-test-game-hosted-target-preflight",
    status,
    releaseReady: false,
    productionReady: false,
    generatedAt,
    scope: "hosted-target-preflight",
    proofBoundary:
      "Hosted target preflight for the dev-test-game hosted matrix evidence handoff. Passing means the external target URLs are configured, non-local, and the raw hosted matrix evidence is readable for the same target; it does not prove hosted deployment, multi-node races, beta readiness, release readiness, or production readiness.",
    target: {
      frontendBaseUrl,
      apiBaseUrl,
      groupId,
      rawEvidencePath,
      rawEvidenceStatus: rawEvidence.status,
      rawEvidenceSyntheticExternalTarget:
        rawEvidence.syntheticExternalTarget === true,
      rawEvidenceFixture: rawEvidence.fixtureEvidence === true,
      rawCaptureStatus: rawCapture.status,
      rawCapturePath: devTestGameRealHostedMatrixRawCapturePath,
      rawCaptureBlockedCheckIds: rawCapture.blockedCheckIds,
    },
    checks,
    ...(status === "blocked"
      ? {
          blockedReceipt: buildBlockedReceipt({
            blockedCheckIds,
            frontendBaseUrl,
            apiBaseUrl,
            groupId,
            rawEvidencePath,
            rawCapture,
          }),
        }
      : {}),
    hostedHandoffChecklist: hostedEvidenceHandoffChecklistFromPreflight({
      preflight: {
        status,
        checks,
        target: {
          frontendBaseUrl,
          apiBaseUrl,
          groupId,
          rawEvidencePath,
          rawEvidenceStatus: rawEvidence.status,
        },
      },
    }),
    nextCommand:
      status === "passed"
        ? `npm run ${devTestGameHostedMatrixExternalEvidenceCommand}`
        : `npm run ${devTestGameHostedTargetPreflightCommand}`,
    nextProofTarget:
      status === "passed"
        ? devTestGameHostedMatrixExternalEvidencePath
        : devTestGameHostedTargetPreflightPath,
  };
  assertDevTestGameHostedTargetPreflight(preflight);
  return preflight;
}

export function assertDevTestGameHostedTargetPreflight(preflight) {
  if (
    preflight?.version !== DEV_TEST_GAME_HOSTED_TARGET_PREFLIGHT_VERSION ||
    preflight.proof !== "dev-test-game-hosted-target-preflight" ||
    !["passed", "blocked"].includes(preflight.status) ||
    preflight.releaseReady !== false ||
    preflight.productionReady !== false ||
    preflight.scope !== "hosted-target-preflight"
  ) {
    throw new Error("hosted target preflight shape drifted");
  }
  const checks = new Map((preflight.checks ?? []).map((check) => [check.id, check]));
  for (const id of hostedTargetPreflightCheckIds) {
    if (!checks.has(id)) {
      throw new Error(`hosted target preflight missing check: ${id}`);
    }
  }
  if (checks.get("release-claim-boundary-carried").releaseReady !== false) {
    throw new Error("hosted target preflight made a release claim");
  }
  const allPassed = Array.from(checks.values()).every((check) => check.status === "passed");
  if (preflight.status === "passed" && !allPassed) {
    throw new Error("hosted target preflight passed with blocked checks");
  }
  if (preflight.status === "blocked" && allPassed) {
    throw new Error("hosted target preflight blocked without blocked checks");
  }
  if (preflight.status === "blocked") {
    assertBlockedReceipt(preflight.blockedReceipt, {
      blockedCheckIds: Array.from(checks.values())
        .filter((check) => check.status === "blocked")
        .map((check) => check.id),
    });
  } else if (preflight.blockedReceipt !== undefined) {
    throw new Error("hosted target preflight passed with blocked receipt");
  }
  assertHostedEvidenceHandoffChecklist(preflight.hostedHandoffChecklist);
  return preflight;
}

function assertBlockedReceipt(receipt, { blockedCheckIds }) {
  if (
    receipt === null ||
    typeof receipt !== "object" ||
    receipt.status !== "blocked" ||
    receipt.command !== "npm run test:dev-test-game-hosted-evidence-lane" ||
    receipt.proofTarget !== devTestGameHostedTargetPreflightPath ||
    receipt.nextProofTarget !== devTestGameHostedTargetPreflightPath ||
    !Array.isArray(receipt.requiredInputs) ||
    receipt.requiredInputs.length === 0 ||
    !Array.isArray(receipt.missingRequiredInputs) ||
    !Array.isArray(receipt.blockedCheckIds)
  ) {
    throw new Error("hosted target preflight blocked receipt shape drifted");
  }
  if (JSON.stringify(receipt.blockedCheckIds) !== JSON.stringify(blockedCheckIds)) {
    throw new Error("hosted target preflight blocked receipt check ids drifted");
  }
  if (
    receipt.rawEvidenceContractSummary !== hostedMatrixRawEvidenceContractSummary() ||
    receipt.rawEvidenceContract?.proof !== hostedMatrixRawEvidenceContract.proof ||
    receipt.rawEvidenceContract?.status !== hostedMatrixRawEvidenceContract.status ||
    !Array.isArray(receipt.rawEvidenceContract.requiredTopLevelFields) ||
    !receipt.rawEvidenceContract.requiredTopLevelFields.includes("observations")
  ) {
    throw new Error("hosted target preflight blocked receipt raw evidence contract drifted");
  }
  if (
    receipt.realHostedMatrixRawCaptureIntake?.command !==
      `npm run ${devTestGameRealHostedMatrixRawCaptureCommand}` ||
    receipt.realHostedMatrixRawCaptureIntake.proofTarget !==
      devTestGameRealHostedMatrixRawCapturePath ||
    !["passed", "blocked"].includes(
      receipt.realHostedMatrixRawCaptureIntake.status,
    ) ||
    !Array.isArray(receipt.realHostedMatrixRawCaptureIntake.blockedCheckIds)
  ) {
    throw new Error("hosted target preflight raw capture intake receipt drifted");
  }
  const missingRequiredInputs = receipt.requiredInputs
    .filter((input) => input?.required === true && input.value === null)
    .map((input) => input.name);
  if (
    JSON.stringify(receipt.missingRequiredInputs) !==
    JSON.stringify(missingRequiredInputs)
  ) {
    throw new Error("hosted target preflight blocked receipt missing inputs drifted");
  }
  for (const name of [
    "FMARCH_HOSTED_MATRIX_FRONTEND_URL",
    "FMARCH_HOSTED_MATRIX_API_URL",
    "FMARCH_HOSTED_MATRIX_GROUP_ID",
    "FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH",
  ]) {
    if (!receipt.requiredInputs.some((input) => input.name === name)) {
      throw new Error(`hosted target preflight blocked receipt missing input: ${name}`);
    }
  }
}

async function readRawEvidence({ rawEvidencePath, frontendBaseUrl, apiBaseUrl, groupId }) {
  if (rawEvidencePath === null) {
    return {
      status: "blocked",
      requiredEvidence:
        hostedTargetPreflightMissingRawEvidencePathRequiredEvidence,
    };
  }
  const resolved = path.resolve(repoRoot, rawEvidencePath);
  try {
    const source = JSON.parse(await readFile(resolved, "utf8"));
    if (frontendBaseUrl !== null && apiBaseUrl !== null) {
      assertDevTestGameHostedMatrixRawEvidence(source, {
        frontendBaseUrl,
        apiBaseUrl,
        groupId,
      });
    }
    const metadata = await stat(resolved);
    return {
      status: "passed",
      syntheticExternalTarget: source.generatedFrom?.syntheticExternalTarget === true,
      fixtureEvidence:
        source.generatedFrom?.fixtureEvidence === true ||
        source.generatedFrom?.operatorFixture === true,
      evidence: {
        path: path.relative(repoRoot, resolved),
        mtime: metadata.mtime.toISOString(),
        sizeBytes: metadata.size,
      },
    };
  } catch (error) {
    return {
      status: "blocked",
      requiredEvidence: `Readable ${hostedMatrixRawEvidenceContractSummary()} matching FMARCH_HOSTED_MATRIX_FRONTEND_URL, FMARCH_HOSTED_MATRIX_API_URL, and FMARCH_HOSTED_MATRIX_GROUP_ID; observed ${rawEvidencePath}: ${error.message}. Rerun npm run test:dev-test-game-hosted-evidence-lane after replacing it.`,
    };
  }
}

function optionalEnv(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function buildBlockedReceipt({
  blockedCheckIds,
  frontendBaseUrl,
  apiBaseUrl,
  groupId,
  rawEvidencePath,
  rawCapture,
}) {
  const requiredInputs = [
    {
      name: "FMARCH_HOSTED_MATRIX_FRONTEND_URL",
      value: frontendBaseUrl,
      required: true,
      purpose: "Externally reachable frontend base URL.",
    },
    {
      name: "FMARCH_HOSTED_MATRIX_API_URL",
      value: apiBaseUrl,
      required: true,
      purpose: "Externally reachable API base URL for the same hosted deployment.",
    },
    {
      name: "FMARCH_HOSTED_MATRIX_GROUP_ID",
      value: groupId,
      required: true,
      purpose: "Hosted matrix group to prove.",
    },
    {
      name: "FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH",
      value: rawEvidencePath,
      required: true,
      purpose: hostedMatrixRawEvidenceContractSummary(),
    },
    {
      name: "FMARCH_HOSTED_MATRIX_EVIDENCE_PATH",
      value: null,
      required: false,
      purpose: "Optional normalized hosted matrix evidence output path.",
    },
  ];
  const missingRequiredInputs = requiredInputs
    .filter((input) => input.required && input.value === null)
    .map((input) => input.name);
  const firstMissingOperatorArtifact = hostedTargetFirstMissingOperatorArtifact({
    blockedCheckIds,
    missingRequiredInputs,
    requiredInputs,
    rawCapture,
  });
  return {
    status: "blocked",
    blockedCheckIds,
    command: "npm run test:dev-test-game-hosted-evidence-lane",
    proofTarget: devTestGameHostedTargetPreflightPath,
    nextProofTarget: devTestGameHostedTargetPreflightPath,
    requiredInputs,
    missingRequiredInputs,
    ...(firstMissingOperatorArtifact === null
      ? {}
      : { firstMissingOperatorArtifact }),
    rawEvidenceContractSummary: hostedMatrixRawEvidenceContractSummary(),
    rawEvidenceContract: hostedMatrixRawEvidenceContract,
    realHostedMatrixRawCaptureIntake: {
      command: `npm run ${devTestGameRealHostedMatrixRawCaptureCommand}`,
      proofTarget: devTestGameRealHostedMatrixRawCapturePath,
      status: rawCapture.status,
      blockedCheckIds: rawCapture.blockedCheckIds,
    },
    operatorAction:
      "Configure the hosted frontend/API URLs plus a readable raw hosted matrix evidence packet from that same deployment, then rerun npm run test:dev-test-game-hosted-evidence-lane.",
    localVsHostedBoundary:
      "Local hosted-like matrix artifacts and synthetic demo evidence can prove the handoff path, but they cannot satisfy hosted deployment evidence.",
  };
}

function hostedTargetFirstMissingOperatorArtifact({
  blockedCheckIds,
  missingRequiredInputs,
  requiredInputs,
  rawCapture,
}) {
  const missingInputId =
    missingRequiredInputs[0] ??
    (Array.isArray(rawCapture?.blockedCheckIds) &&
    rawCapture.blockedCheckIds.length > 0
      ? "FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH"
      : null);
  if (missingInputId === null) {
    return null;
  }
  const checkId =
    hostedTargetInputCheckIds[missingInputId] ??
    blockedCheckIds.find((id) => String(id).startsWith("raw-evidence-")) ??
    String(blockedCheckIds[0] ?? "");
  const section = hostedTargetInputSections[missingInputId] ?? {
    id: "hosted-target",
    label: "Hosted target",
  };
  const requiredInput = requiredInputs.find(
    (input) => input.name === missingInputId,
  );
  const requiredEvidence =
    hostedTargetBlockedEvidenceByCheckId[checkId] ??
    hostedTargetPreflightRawCaptureRequiredEvidence;
  return {
    inputId: missingInputId,
    checkId,
    sectionId: section.id,
    sectionLabel: section.label,
    requiredEvidence,
    purpose: String(requiredInput?.purpose ?? requiredEvidence),
    proofTarget: devTestGameHostedTargetPreflightPath,
    roleSurfaceDrilldown: {
      localCapabilityAuditId: localAdminAuditIds.coreLoop,
      localCapabilityRoleUrl: localAdminAuditRoleUrl(localAdminAuditIds.coreLoop),
      handoffAuditId: localAdminAuditIds.hostedEvidenceLane,
      handoffRoleUrl: localAdminAuditRoleUrl(localAdminAuditIds.hostedEvidenceLane),
      proofGraphNodeId: "admin-proof:hosted-evidence-lane",
      productionFeatureGraphNodeId: "production-feature:host-phase-control",
      proofGraphEvidencePath: devTestGameProofGraphPath,
    },
  };
}
