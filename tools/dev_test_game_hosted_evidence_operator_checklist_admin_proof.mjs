import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertHostedEvidenceOperatorChecklistProof,
  devTestGameHostedEvidenceOperatorChecklistPath,
  devTestGameHostedEvidenceOperatorChecklistProofCommand,
  devTestGameHostedEvidenceOperatorChecklistProofPath,
} from "./dev_test_game_hosted_evidence_operator_checklist.mjs";
import {
  devTestGameHostedEvidenceOperatorChecklistAdminProofPath,
} from "./dev_test_game_adjacent_artifact_paths.mjs";
import {
  hostedEvidenceHandoffInputCheckIds,
} from "./dev_test_game_hosted_handoff_cases.mjs";
import {
  localAdminAuditIds,
  localAdminAuditRoleUrl,
} from "./dev_test_game_admin_audit_surface_ids.mjs";
import {
  assertDevTestGameProofRun,
} from "./dev_test_game_proof_contract.mjs";
import {
  devTestGameProofRunPath,
  hostedEvidenceOperatorChecklistNextActionPath,
  nextActionPath,
} from "./dev_test_game_spine_artifact_paths.mjs";
import {
  devTestGameReleaseReadinessPath,
} from "./dev_test_game_spine_readiness_steps.mjs";
import {
  proveAdminAuditDetail,
  readJson,
  repoRoot,
  runAdminAuditProof,
} from "./dev_test_game_admin_audit_proof_helper.mjs";

export const devTestGameHostedEvidenceOperatorChecklistAdminProofCommand =
  "test:dev-test-game-hosted-evidence-operator-checklist-admin-proof";
export { devTestGameHostedEvidenceOperatorChecklistAdminProofPath };

const proofName =
  "dev-test-game-hosted-evidence-operator-checklist-admin-proof";
const scope =
  "local-dev-test-game-hosted-evidence-operator-checklist-admin-surface";
const operatorProofId = "hosted-evidence-operator-checklist";
const expectedMissingHostedInputIds = Object.freeze(
  Object.keys(hostedEvidenceHandoffInputCheckIds),
);

const defaultChecklistProofPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_HOSTED_EVIDENCE_OPERATOR_CHECKLIST_PROOF ??
    devTestGameHostedEvidenceOperatorChecklistProofPath,
);
const defaultProofRunPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_PROOF_RUN ?? devTestGameProofRunPath,
);
const defaultReleaseReadinessPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_RELEASE_READINESS ??
    devTestGameReleaseReadinessPath,
);
const defaultNextActionPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_NEXT_ACTION ??
    hostedEvidenceOperatorChecklistNextActionPath,
);
const defaultEvidencePath = path.resolve(
  repoRoot,
  devTestGameHostedEvidenceOperatorChecklistAdminProofPath,
);

export function hostedEvidenceOperatorChecklistAdminProofCase({
  checklistProofPath = defaultChecklistProofPath,
  proofRunPath = defaultProofRunPath,
  releaseReadinessPath = defaultReleaseReadinessPath,
  nextActionPath = defaultNextActionPath,
  evidencePath = defaultEvidencePath,
} = {}) {
  return {
    smokeName: proofName,
    stage: "hosted-evidence-operator-checklist-admin-proof-listen",
    evidencePath,
    envOverrides: {},
    loadSource: async () => ({
      checklistProof: assertHostedEvidenceOperatorChecklistProof(
        await readJson(checklistProofPath),
      ),
      proofRun: assertDevTestGameProofRun(await readJson(proofRunPath)),
      packageJson: await readJson(path.join(repoRoot, "package.json")),
      releaseReadiness: await readJson(releaseReadinessPath),
      nextAction: await readJson(nextActionPath),
      paths: {
        checklistProof: path.relative(repoRoot, checklistProofPath),
        proofRun: path.relative(repoRoot, proofRunPath),
        releaseReadiness: path.relative(repoRoot, releaseReadinessPath),
        nextAction: path.relative(repoRoot, nextActionPath),
      },
    }),
    prove: async ({ browser, frontendBaseUrl, source }) => {
      const descriptor = source.checklistProof.descriptor;
      return await proveAdminAuditDetail({
        browser,
        frontendBaseUrl,
        game: source.proofRun.session.game,
        auditId: localAdminAuditIds.hostedEvidenceLane,
        requiredHostedHandoffOperatorProofs: [operatorProofId],
        requiredHostedHandoffOperatorProofStatuses: {
          [operatorProofId]: descriptor.checklistProofTarget,
        },
        requiredHostedHandoffOperatorProofActions: {
          [operatorProofId]: {
            copyCommand: descriptor.checklistProofCommand,
            sourcePath: descriptor.path,
            proofTarget: descriptor.checklistProofTarget,
          },
        },
        requiredText: [
          descriptor.path,
          descriptor.checklistProofCommand,
          descriptor.checklistProofTarget,
          ...expectedMissingHostedInputIds,
        ],
      });
    },
    buildEvidence: ({ source, adminRoleSurface }) =>
      assertHostedEvidenceOperatorChecklistAdminProof({
        version: 1,
        proof: proofName,
        status: "passed",
        releaseReady: false,
        productionReady: false,
        scope,
        proofBoundary:
          "Local admin role URL proof for the hosted evidence operator checklist handoff. It proves the seeded admin hosted-evidence lane exposes the checklist command/doc/proof affordances and that readiness names the same checklist command, proof target, and hosted inputs; it records whether the current next-action selection is the checklist handoff but does not require the global selector to choose it while higher-priority sequence deferrals exist. It does not prove hosted deployment, release readiness, or production readiness.",
        generatedFrom: {
          ...source.paths,
          defaultNextAction: nextActionPath,
          phaseLocalNextAction: hostedEvidenceOperatorChecklistNextActionPath,
          game: source.proofRun.session.game,
          roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.hostedEvidenceLane),
          checklistPath: source.checklistProof.descriptor.path,
          checklistProofCommand:
            source.checklistProof.descriptor.checklistProofCommand,
          checklistProofTarget:
            source.checklistProof.descriptor.checklistProofTarget,
          missingHostedInputIds: [...expectedMissingHostedInputIds],
        },
        checklistProof: {
          status: source.checklistProof.status,
          templateOnly: source.checklistProof.generatedFrom.templateOnly,
          command: source.checklistProof.generatedFrom.checklistProofCommand,
          proofTarget:
            source.checklistProof.generatedFrom.checklistProofTarget,
        },
        packageScript: String(
          source.packageJson.scripts?.[
            devTestGameHostedEvidenceOperatorChecklistAdminProofCommand
          ] ?? "",
        ),
        readiness: hostedEvidenceChecklistReadinessSummary(
          source.releaseReadiness,
        ),
        nextAction: hostedEvidenceChecklistNextActionSummary(source.nextAction),
        adminRoleSurface,
      }),
    assertEvidence: assertHostedEvidenceOperatorChecklistAdminProof,
  };
}

export function assertHostedEvidenceOperatorChecklistAdminProof(proof) {
  if (
    proof?.version !== 1 ||
    proof.proof !== proofName ||
    proof.status !== "passed" ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.scope !== scope ||
    proof.checklistProof?.status !== "passed" ||
    proof.checklistProof?.templateOnly !== true ||
    proof.packageScript !==
      "node tools/dev_test_game_hosted_evidence_operator_checklist_admin_proof.mjs"
  ) {
    throw new Error("hosted evidence operator checklist admin proof shape drifted");
  }
  const generated = proof.generatedFrom ?? {};
  const expectedCommand =
    `npm run ${devTestGameHostedEvidenceOperatorChecklistProofCommand}`;
  if (
    generated.checklistPath !== devTestGameHostedEvidenceOperatorChecklistPath ||
    generated.checklistProofCommand !== expectedCommand ||
    generated.checklistProofTarget !==
      devTestGameHostedEvidenceOperatorChecklistProofPath ||
    proof.checklistProof.command !== expectedCommand ||
    proof.checklistProof.proofTarget !==
      devTestGameHostedEvidenceOperatorChecklistProofPath
  ) {
    throw new Error(
      "hosted evidence operator checklist admin proof command target drifted",
    );
  }
  assertSameStringArray(
    generated.missingHostedInputIds,
    expectedMissingHostedInputIds,
    "generated missing hosted inputs",
  );
  assertChecklistActionSurface({
    adminRoleSurface: proof.adminRoleSurface,
    expectedCommand,
  });
  assertReadinessSummary(proof.readiness, { expectedCommand });
  assertNextActionSummary(proof.nextAction, { expectedCommand });
  return proof;
}

function assertChecklistActionSurface({ adminRoleSurface, expectedCommand }) {
  const actions =
    adminRoleSurface?.visibleHostedHandoffOperatorProofActions?.[
      operatorProofId
    ];
  if (
    !adminRoleSurface?.visibleHostedHandoffOperatorProofs?.includes(
      operatorProofId,
    ) ||
    actions?.copyCommand?.copyValue !== expectedCommand ||
    actions?.openDoc?.href !== devTestGameHostedEvidenceOperatorChecklistPath ||
    actions?.openProofTarget?.href !==
      devTestGameHostedEvidenceOperatorChecklistProofPath ||
    actions?.order?.beforeRealHostedEvidenceInputs !== true ||
    actions?.order?.beforeRawEvidenceTemplate !== true
  ) {
    throw new Error(
      "hosted evidence operator checklist admin proof did not prove action surface",
    );
  }
}

function assertReadinessSummary(summary, { expectedCommand }) {
  if (
    summary?.hostedDeploymentStatus !== "unproven" ||
    summary.operatorChecklist?.path !==
      devTestGameHostedEvidenceOperatorChecklistPath ||
    summary.operatorChecklist?.checklistProofCommand !== expectedCommand ||
    summary.operatorChecklist?.checklistProofTarget !==
      devTestGameHostedEvidenceOperatorChecklistProofPath
  ) {
    throw new Error(
      "hosted evidence operator checklist admin proof readiness summary drifted",
    );
  }
  assertSameStringArray(
    summary.missingHostedInputIds.length > 0
      ? summary.missingHostedInputIds
      : summary.namedHostedInputIds,
    expectedMissingHostedInputIds,
    "readiness missing hosted inputs",
  );
}

function assertNextActionSummary(summary, { expectedCommand }) {
  if (summary?.selectedChecklistHandoff !== true) {
    if (typeof summary?.command !== "string" || summary.command === "") {
      throw new Error(
        "hosted evidence operator checklist admin proof next-action summary drifted",
      );
    }
    return;
  }
  if (
    summary.command !== expectedCommand ||
    summary.proofTarget !== devTestGameHostedEvidenceOperatorChecklistProofPath ||
    summary.roleUrl !== localAdminAuditRoleUrl(localAdminAuditIds.hostedEvidenceLane) ||
    summary.operatorChecklist?.path !== devTestGameHostedEvidenceOperatorChecklistPath ||
    summary.operatorChecklist?.checklistProofCommand !== expectedCommand ||
    summary.operatorChecklist?.checklistProofTarget !==
      devTestGameHostedEvidenceOperatorChecklistProofPath
  ) {
    throw new Error(
      "hosted evidence operator checklist admin proof next-action summary drifted",
    );
  }
  assertSameStringArray(
    summary.missingHostedInputIds.length > 0
      ? summary.missingHostedInputIds
      : summary.namedHostedInputIds,
    expectedMissingHostedInputIds,
    "next-action hosted inputs",
  );
}

function hostedEvidenceChecklistReadinessSummary(readiness) {
  const hostedDeployment = readiness.releaseReadiness?.unproven?.find(
    (item) => item.id === "hosted-deployment",
  );
  const adminSurface = readiness.localDevelopmentSpine?.checks?.find(
    (check) => check.id === "local-hosted-evidence-lane-admin-surface",
  );
  return {
    hostedDeploymentStatus: String(hostedDeployment?.status ?? ""),
    adminSurfaceStatus: String(adminSurface?.status ?? ""),
    missingHostedInputIds: [
      ...(adminSurface?.handoffReceiptMissingRequiredInputs ?? []),
    ],
    namedHostedInputIds: (adminSurface?.hostedHandoffBlockedReceipt
      ?.requiredInputs ?? [])
      .map((input) => String(input?.name ?? ""))
      .filter((name) => expectedMissingHostedInputIds.includes(name)),
    operatorChecklist:
      adminSurface?.blockedOperatorPacket?.operatorChecklist ??
      adminSurface?.hostedHandoffBlockedReceipt?.blockedOperatorPacket
        ?.operatorChecklist ??
      null,
  };
}

function hostedEvidenceChecklistNextActionSummary(nextAction) {
  const selected = nextAction.nextAction?.unproven ?? {};
  const checklist =
    selected.hostedHandoffChecklist?.operatorChecklist ??
    selected.hostedHandoffChecklist?.blockedOperatorPacket?.operatorChecklist ??
    null;
  return {
    command: String(nextAction.nextAction?.command ?? ""),
    reason: String(nextAction.nextAction?.reason ?? ""),
    proofTarget: String(selected.proofTarget ?? ""),
    roleUrl: String(selected.roleUrl ?? ""),
    selectedChecklistHandoff:
      checklist?.checklistProofCommand ===
        `npm run ${devTestGameHostedEvidenceOperatorChecklistProofCommand}` &&
      checklist?.checklistProofTarget ===
        devTestGameHostedEvidenceOperatorChecklistProofPath,
    missingHostedInputIds: [
      ...(selected.hostedHandoffChecklist?.blockedReceipt
        ?.missingRequiredInputs ?? []),
    ],
    namedHostedInputIds: (selected.hostedHandoffChecklist?.blockedReceipt
      ?.requiredInputs ?? [])
      .map((input) => String(input?.name ?? ""))
      .filter((name) => expectedMissingHostedInputIds.includes(name)),
    operatorChecklist: checklist,
  };
}

function assertSameStringArray(actual, expected, label) {
  const normalizedActual = (Array.isArray(actual) ? actual : []).map((item) =>
    String(item),
  );
  const normalizedExpected = (Array.isArray(expected) ? expected : []).map(
    (item) => String(item),
  );
  if (
    normalizedActual.length !== normalizedExpected.length ||
    normalizedActual.some((item, index) => item !== normalizedExpected[index])
  ) {
    throw new Error(
      `hosted evidence operator checklist admin proof ${label} drifted`,
    );
  }
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  await runAdminAuditProof(hostedEvidenceOperatorChecklistAdminProofCase());
}
