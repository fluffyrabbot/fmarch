import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  readLocalAdminSpineProof,
  readLocalProofFreshness,
} from "../frontend/src/lib/server/local-ops-artifacts.mjs";
import {
  assertOpsArtifactPlanOrder,
} from "./dev_test_game_ops_artifact_dependencies.mjs";
import {
  adminSpineProofPath,
  adminSpineReadinessEvidenceEnv,
  adminSpineTerminalBatchProofPath,
  adminSpineTerminalBatchReadinessEvidenceEnv,
} from "./dev_test_game_admin_spine.mjs";
import {
  devTestGameHandoffPhaseOutputs,
} from "./dev_test_game_handoff_phase_outputs.mjs";
import { devTestGameAdminSpineProofPlan } from "./dev_test_game_admin_spine_proof.mjs";
import {
  devTestGameProofGraphAdminProofCommand,
  devTestGameProofGraphAdminProofPath,
  devTestGameProofGraphCommand,
  devTestGameProofGraphPath,
} from "./dev_test_game_proof_graph_paths.mjs";
import {
  devTestGameRaceCoverageAdminProofPath,
  devTestGameRaceCoverageCommand,
  devTestGameRaceCoveragePath,
} from "./dev_test_game_race_coverage.mjs";
import {
  devTestGameHostedConcurrentRaceMatrixCommand,
  devTestGameHostedConcurrentRaceMatrixPath,
} from "./dev_test_game_hosted_concurrent_race_matrix.mjs";
import {
  devTestGameHostedIdentityEvidenceCommand,
  devTestGameHostedIdentityEvidencePath,
  devTestGameHostedIdentityProgressionAdminProofBatchCommand,
  devTestGameHostedIdentityProgressionSummaryCommand,
  devTestGameHostedIdentityProgressionSummaryPath,
} from "./dev_test_game_hosted_identity_evidence.mjs";
import {
  devTestGameHostedEvidenceLaneCommand,
  devTestGameHostedEvidenceLanePath,
} from "./dev_test_game_hosted_evidence_lane.mjs";
import {
  devTestGameHostedEvidenceOperatorChecklistPath,
  devTestGameHostedEvidenceOperatorChecklistProofCommand,
  devTestGameHostedEvidenceOperatorChecklistProofPath,
} from "./dev_test_game_hosted_evidence_operator_checklist.mjs";
import {
  devTestGameHostedEvidenceOperatorChecklistAdminProofCommand,
  devTestGameHostedEvidenceOperatorChecklistAdminProofPath,
} from "./dev_test_game_hosted_evidence_operator_checklist_admin_proof.mjs";
import {
  devTestGameHostedEvidenceLaneOperatorFixtureAdminProofCommand,
  devTestGameHostedEvidenceLaneOperatorFixtureAdminProofPath,
  devTestGameHostedEvidenceLaneOperatorFixturePath,
} from "./dev_test_game_hosted_evidence_lane_operator_fixture_cases.mjs";
import {
  devTestGameHostedEvidenceLaneDemoBlockedPath,
  devTestGameHostedEvidenceLaneDemoExternalEvidencePath,
  devTestGameHostedEvidenceLaneDemoProofCommand,
  devTestGameHostedEvidenceLaneDemoProofPath,
  devTestGameHostedEvidenceLaneDemoRawEvidencePath,
  devTestGameHostedEvidenceLaneDemoSyntheticRejectedPath,
} from "./dev_test_game_hosted_evidence_lane_demo_proof.mjs";
import {
  devTestGameHostedMatrixRawEvidenceFixtureProofCommand,
  devTestGameHostedMatrixRawEvidenceFixtureProofPath,
  devTestGameHostedMatrixRawEvidenceOperatorFixturePath,
} from "./dev_test_game_hosted_matrix_raw_evidence_fixture_proof.mjs";
import {
  devTestGameHostedMatrixRawEvidenceTemplatePath,
  devTestGameHostedMatrixRawEvidenceTemplateProofCommand,
  devTestGameHostedMatrixRawEvidenceTemplateProofPath,
} from "./dev_test_game_hosted_matrix_raw_evidence_template_proof.mjs";
import {
  devTestGameRealHostedMatrixRawCaptureCommand,
  devTestGameRealHostedMatrixRawCapturePath,
} from "./dev_test_game_real_hosted_matrix_raw_capture_contract.mjs";
import {
  devTestGameHostedOpsSignalsCommand,
  devTestGameHostedOpsSignalsPath,
} from "./dev_test_game_hosted_ops_signals.mjs";
import {
  devTestGameBackupRestoreDumpPath,
  devTestGameBackupRestoreProofPath,
  devTestGameIdentityAdapterProofPath,
} from "./dev_test_game_adjacent_artifact_paths.mjs";
import {
  devTestGameHostedOpsSignalsAdminProofPath,
} from "./dev_test_game_hosted_ops_signal_cases.mjs";
import { devTestGameOpsArtifactsPath } from "./dev_test_game_ops_artifacts.mjs";
import {
  devTestGameReleaseReadinessPath,
} from "./dev_test_game_spine_readiness_steps.mjs";
import {
  devTestGameRealHostedObservabilityHandoffCommand,
  devTestGameRealHostedObservabilityHandoffPath,
} from "./dev_test_game_real_hosted_observability_handoff.mjs";
import {
  hostedAdminHandoffProofArtifactCase,
  hostedAdminHandoffProofArtifactCases,
} from "./dev_test_game_hosted_handoff_proof_cases.mjs";
import {
  devTestGameHostedEvidenceLaneAdminProofPath,
  devTestGameHostedEvidenceLaneRealCaptureAdminProofCommand,
  devTestGameHostedEvidenceLaneRealCaptureAdminProofPath,
  devTestGameHostedEvidenceLaneRealCaptureSourcePath,
} from "./dev_test_game_hosted_handoff_cases.mjs";
import {
  devTestGameHostedTargetPreflightCommand,
  devTestGameHostedTargetPreflightPath,
} from "./dev_test_game_hosted_target_preflight.mjs";
import {
  devTestGameHostedTargetPreflightAdminProofPath,
} from "./dev_test_game_hosted_target_preflight_cases.mjs";
import {
  devTestGameReleaseRunbookCommand,
  devTestGameReleaseRunbookAdminProofPath,
  devTestGameReleaseRunbookPath,
} from "./dev_test_game_release_runbook.mjs";
import {
  devTestGameReleaseAdminProofPath,
  devTestGameReleaseAdminProofContractPath,
} from "./dev_test_game_release_artifact_paths.mjs";
import {
  devTestGameReleaseAdminProofContractCommand,
} from "./dev_test_game_release_admin_proof_contract.mjs";
import {
  devTestGameAdminSpineAdminProofPath,
  devTestGameCoreLoopAdminProofPath,
  devTestGameHardeningAdminProofPath,
  devTestGameHostSetupAdminProofPath,
  devTestGameIdentityAdminProofPath,
  devTestGameSpineManifestAdminProofPath,
} from "./dev_test_game_local_admin_proof_paths.mjs";
import {
  devTestGameHostSetupProofCommand,
} from "./dev_test_game_host_setup_feature_spine_targets.mjs";
import {
  backupAwareOpsEnv,
  backupRestoreEvidenceEnv,
  backupRestoreFinalReadinessEnv,
  devTestGameBackupRestoreSpinePlan,
  opsReadinessEnv,
  seedReadinessEnv,
} from "./dev_test_game_backup_restore_spine.mjs";
import {
  devTestGameIdentityOperatorSpinePlan,
  devTestGameIdentitySpinePlan,
  identityReadinessEnv,
} from "./dev_test_game_identity_spine.mjs";
import {
  hostedIdentityProgressionAdminProofBatchArtifactPaths,
} from "./dev_test_game_hosted_identity_progression_admin_proof_batch.mjs";
import {
  devTestGameOpsSpinePlan,
  opsSpineReadinessEnv,
} from "./dev_test_game_ops_spine.mjs";
import {
  devTestGameSeedFixtureSpinePlan,
  seedFixtureSpineEnv,
} from "./dev_test_game_seed_fixture_spine.mjs";
import {
  devTestGameCoreLiveSpinePlan,
  devTestGameLiveSpinePlan,
} from "./dev_test_game_live_spine.mjs";
import {
  recoveryReceiptGraphDescriptors,
} from "./dev_test_game_recovery_receipt_catalog.mjs";
import {
  hostedEvidenceOperatorChecklistNextActionPath,
  hostedIdentityNextActionAdminProofPath,
  hostedIdentityNextActionPath,
  nextActionAdminProofCommand,
  nextActionAdminProofPath,
  nextActionCommand,
  nextActionPath,
  proofFreshnessAdminProofCommand,
  proofFreshnessAdminProofPath,
} from "./dev_test_game_next_action_paths.mjs";
import {
  assertDevTestGameProofRun,
  buildDevTestGameProofRun,
} from "./dev_test_game_proof_contract.mjs";
import {
  localAdminAuditIds,
  localAdminAuditRoleUrl,
} from "./dev_test_game_admin_audit_surface_ids.mjs";
import {
  allProductionFeatureSpineTargetProvenanceCases,
} from "./dev_test_game_production_feature_spine_target_provenance.mjs";
import {
  devTestGameProofRunPath,
  devTestGameSessionPath,
  spineManifestMarkdownPath,
  spineManifestPath,
} from "./dev_test_game_spine_artifact_paths.mjs";
import { repoRoot } from "./dev_test_game_spine_runner.mjs";

export const DEV_TEST_GAME_SPINE_MANIFEST_VERSION = 1;

export {
  hostedEvidenceOperatorChecklistNextActionPath,
  hostedIdentityNextActionAdminProofPath,
  hostedIdentityNextActionPath,
  nextActionAdminProofCommand,
  nextActionAdminProofPath,
  nextActionCommand,
  nextActionPath,
  proofFreshnessAdminProofCommand,
  proofFreshnessAdminProofPath,
  spineManifestMarkdownPath,
  spineManifestPath,
};

const manifestJsonPath = path.join(repoRoot, spineManifestPath);
const manifestMarkdownPath = path.join(repoRoot, spineManifestMarkdownPath);
const hostedIdentityEvidenceAdminProofArtifact =
  hostedAdminHandoffProofArtifactCase("hostedIdentityEvidenceAdminProof");
const nextActionTerminalDependsOn = Object.freeze([
  spineManifestPath,
  devTestGameOpsArtifactsPath,
  devTestGameReleaseReadinessPath,
  devTestGameRaceCoveragePath,
  devTestGameHostedConcurrentRaceMatrixPath,
  devTestGameHostedTargetPreflightPath,
  devTestGameHostedEvidenceLanePath,
  devTestGameHostedEvidenceLaneDemoProofPath,
  devTestGameHostedEvidenceLaneOperatorFixtureAdminProofPath,
  devTestGameHostedEvidenceLaneRealCaptureAdminProofPath,
]);

function phaseLocalNextActionTerminalArtifacts() {
  return [
    {
      id: "next-action-hosted-evidence-operator-checklist",
      label: "Hosted evidence operator checklist phase next-action receipt",
      command: nextActionCommand,
      path: hostedEvidenceOperatorChecklistNextActionPath,
      dependsOn: [...nextActionTerminalDependsOn],
      phaseLocalNextAction: {
        id: "hosted-evidence-operator-checklist",
        canonicalPath: nextActionPath,
        outputPath: hostedEvidenceOperatorChecklistNextActionPath,
      },
      boundary:
        "Phase-local next-action receipt for the hosted evidence operator checklist handoff. It snapshots selector state for the checklist admin proof without replacing canonical next-action guidance.",
    },
    {
      id: "next-action-hosted-identity",
      label: "Hosted identity phase next-action receipt",
      command: nextActionCommand,
      path: hostedIdentityNextActionPath,
      dependsOn: [
        ...nextActionTerminalDependsOn,
        devTestGameHostedIdentityEvidencePath,
        devTestGameHostedIdentityProgressionSummaryPath,
        devTestGameProofGraphPath,
      ],
      phaseLocalNextAction: {
        id: "hosted-identity",
        canonicalPath: nextActionPath,
        outputPath: hostedIdentityNextActionPath,
        sequenceStage: "hosted-identity",
      },
      boundary:
        "Phase-local next-action receipt for the hosted-identity sequence stage. It snapshots selector state for hosted identity admin proof without replacing canonical next-action guidance.",
    },
  ];
}
const handoffPhaseOutputs = Object.freeze(
  devTestGameHandoffPhaseOutputs.map((output) => Object.freeze({ ...output })),
);
const realHostedObservabilityHandoffAdminProofArtifact =
  hostedAdminHandoffProofArtifactCase(
    "realHostedObservabilityHandoffAdminProof",
  );

export function buildDevTestGameSpineManifest({
  generatedAt = new Date().toISOString(),
  proofFreshness,
  adminSpineProof,
  proofRunContract,
} = {}) {
  const adminSpineRecoveryCommands = recoveryCommandsFromAdminSpineProof(adminSpineProof);
  const evidenceEnv = {
    backupRestore: {
      backupRestoreEvidenceEnv,
      backupAwareOpsEnv,
      opsReadinessEnv,
      seedReadinessEnv,
      backupRestoreFinalReadinessEnv,
    },
    ops: {
      opsSpineReadinessEnv,
    },
    seedFixture: {
      seedFixtureSpineEnv,
    },
    identity: {
      identityReadinessEnv,
    },
    adminSpine: {
      adminSpineReadinessEvidenceEnv,
      adminSpineTerminalBatchReadinessEvidenceEnv,
    },
  };
  const manifest = {
    version: DEV_TEST_GAME_SPINE_MANIFEST_VERSION,
    proof: "dev-test-game-spine-manifest",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    generatedAt,
    scope: "local-dev-test-game-spine-manifest",
    proofBoundary:
      "Generated local dev-test-game orchestration manifest. It records proof command order, evidence env wiring, and current local proof freshness status; it does not prove hosted deployment, hosted identity, hosted operations, production readiness, beta readiness, or release readiness.",
    commands: {
      coreLive: {
        script: "test:dev-test-game-core-live",
        localScript: "test:dev-test-game-core-live:local",
        plan: clonePlan(devTestGameCoreLiveSpinePlan),
      },
      live: {
        script: "test:dev-test-game-live",
        localScript: "test:dev-test-game-live:local",
        plan: clonePlan(devTestGameLiveSpinePlan),
      },
      backupRestore: {
        script: "test:dev-test-game-backup-restore",
        plan: clonePlan(devTestGameBackupRestoreSpinePlan),
      },
      ops: {
        script: "test:dev-test-game-ops",
        plan: clonePlan(devTestGameOpsSpinePlan),
      },
      seedFixture: {
        script: "test:dev-test-game-seed-fixture",
        plan: clonePlan(devTestGameSeedFixtureSpinePlan),
      },
      identity: {
        script: "test:dev-test-game-identity",
        plan: clonePlan(devTestGameIdentitySpinePlan),
      },
      identityOperator: {
        script: "test:dev-test-game-identity:operator",
        plan: clonePlan(devTestGameIdentityOperatorSpinePlan),
      },
      adminSpine: {
        script: "test:dev-test-game-admin-spine",
        plan: cloneAdminProofPlan(devTestGameAdminSpineProofPlan),
        proofArtifact: adminSpineProofPath,
        terminalBatchProofArtifact: adminSpineTerminalBatchProofPath,
        readinessEnv: { ...adminSpineTerminalBatchReadinessEvidenceEnv },
      },
      proofFreshness: {
        script: proofFreshnessAdminProofCommand,
        proofArtifact: proofFreshnessAdminProofPath,
        dependsOn: [
          devTestGameRaceCoveragePath,
          spineManifestPath,
          adminSpineProofPath,
          devTestGameReleaseReadinessPath,
        ],
      },
      raceCoverage: {
        script: devTestGameRaceCoverageCommand,
        proofArtifact: devTestGameRaceCoveragePath,
        dependsOn: [devTestGameProofRunPath],
      },
      hostedConcurrentRaceMatrix: {
        script: devTestGameHostedConcurrentRaceMatrixCommand,
        proofArtifact: devTestGameHostedConcurrentRaceMatrixPath,
        dependsOn: [
          devTestGameReleaseReadinessPath,
          devTestGameRaceCoveragePath,
        ],
      },
      hostedIdentityEvidence: {
        script: devTestGameHostedIdentityEvidenceCommand,
        proofArtifact: devTestGameHostedIdentityEvidencePath,
        dependsOn: [
          devTestGameIdentityAdapterProofPath,
          devTestGameIdentityAdminProofPath,
        ],
        roleUrl: "/admin/audit/local-identity-adapter?game=<seeded-game>",
      },
      hostedIdentityProgressionSummary: {
        script: devTestGameHostedIdentityProgressionSummaryCommand,
        proofArtifact: devTestGameHostedIdentityProgressionSummaryPath,
        dependsOn: [devTestGameHostedIdentityEvidencePath],
        roleUrl: "/admin/audit/local-hosted-identity-evidence?game=<seeded-game>",
      },
      hostedIdentityProgressionAdminProofBatch: {
        script: devTestGameHostedIdentityProgressionAdminProofBatchCommand,
        proofArtifacts: [...hostedIdentityProgressionAdminProofBatchArtifactPaths],
        dependsOn: [devTestGameHostedIdentityProgressionSummaryPath],
        roleUrl: "/admin/audit/local-hosted-identity-evidence?game=<seeded-game>",
      },
      hostedIdentityEvidenceAdminProof: {
        script: hostedIdentityEvidenceAdminProofArtifact.script,
        proofArtifact: hostedIdentityEvidenceAdminProofArtifact.path,
        dependsOn: [
          devTestGameHostedIdentityEvidencePath,
          devTestGameProofRunPath,
        ],
        roleUrl: hostedIdentityEvidenceAdminProofArtifact.roleUrl,
      },
      hostedOpsSignals: {
        script: devTestGameHostedOpsSignalsCommand,
        proofArtifact: devTestGameHostedOpsSignalsPath,
        dependsOn: [
          devTestGameOpsArtifactsPath,
          devTestGameReleaseReadinessPath,
          devTestGameHostedConcurrentRaceMatrixPath,
        ],
      },
      realHostedObservabilityHandoff: {
        script: devTestGameRealHostedObservabilityHandoffCommand,
        proofArtifact: devTestGameRealHostedObservabilityHandoffPath,
        dependsOn: [devTestGameHostedOpsSignalsPath],
        roleUrl:
          "/admin/audit/local-real-hosted-observability-handoff?game=<seeded-game>",
      },
      realHostedObservabilityHandoffAdminProof: {
        script: realHostedObservabilityHandoffAdminProofArtifact.script,
        proofArtifact: realHostedObservabilityHandoffAdminProofArtifact.path,
        dependsOn: [devTestGameRealHostedObservabilityHandoffPath],
        roleUrl: realHostedObservabilityHandoffAdminProofArtifact.roleUrl,
      },
      hostedTargetPreflight: {
        script: devTestGameHostedTargetPreflightCommand,
        proofArtifact: devTestGameHostedTargetPreflightPath,
        dependsOn: [devTestGameHostedConcurrentRaceMatrixPath],
        roleUrl: "/admin/audit/local-hosted-target-preflight?game=<seeded-game>",
      },
      hostedEvidenceLane: {
        script: devTestGameHostedEvidenceLaneCommand,
        proofArtifact: devTestGameHostedEvidenceLanePath,
        dependsOn: [
          devTestGameHostedConcurrentRaceMatrixPath,
          devTestGameHostedTargetPreflightPath,
        ],
        roleUrl: "/admin/audit/local-hosted-evidence-lane?game=<seeded-game>",
      },
      hostedEvidenceOperatorChecklistProof: {
        script: devTestGameHostedEvidenceOperatorChecklistProofCommand,
        proofArtifact: devTestGameHostedEvidenceOperatorChecklistProofPath,
        dependsOn: [
          devTestGameHostedEvidenceOperatorChecklistPath,
          devTestGameHostedMatrixRawEvidenceTemplatePath,
        ],
        templateOnly: true,
        releaseReady: false,
        productionReady: false,
      },
      hostedEvidenceOperatorChecklistAdminProof: {
        script: devTestGameHostedEvidenceOperatorChecklistAdminProofCommand,
        proofArtifact: devTestGameHostedEvidenceOperatorChecklistAdminProofPath,
        dependsOn: [
          devTestGameHostedEvidenceOperatorChecklistProofPath,
          devTestGameHostedEvidenceLaneAdminProofPath,
          devTestGameReleaseReadinessPath,
          nextActionPath,
        ],
        roleUrl: "/admin/audit/local-hosted-evidence-lane?game=<seeded-game>",
        releaseReady: false,
        productionReady: false,
      },
      hostedEvidenceLaneDemoProof: {
        script: devTestGameHostedEvidenceLaneDemoProofCommand,
        proofArtifact: devTestGameHostedEvidenceLaneDemoProofPath,
        dependsOn: [devTestGameHostedConcurrentRaceMatrixPath],
        demoOnly: true,
        roleUrl: "/admin/audit/local-hosted-evidence-lane?game=<seeded-game>",
      },
      hostedMatrixRawEvidenceTemplateProof: {
        script: devTestGameHostedMatrixRawEvidenceTemplateProofCommand,
        proofArtifact: devTestGameHostedMatrixRawEvidenceTemplateProofPath,
        dependsOn: [devTestGameHostedMatrixRawEvidenceTemplatePath],
        templateOnly: true,
        releaseReady: false,
        productionReady: false,
      },
      hostedMatrixRawEvidenceFixtureProof: {
        script: devTestGameHostedMatrixRawEvidenceFixtureProofCommand,
        proofArtifact: devTestGameHostedMatrixRawEvidenceFixtureProofPath,
        dependsOn: [
          devTestGameHostedMatrixRawEvidenceTemplateProofPath,
          devTestGameHostedMatrixRawEvidenceOperatorFixturePath,
        ],
        fixtureEvidence: true,
      },
      hostedEvidenceLaneOperatorFixtureAdminProof: {
        script: devTestGameHostedEvidenceLaneOperatorFixtureAdminProofCommand,
        proofArtifact:
          devTestGameHostedEvidenceLaneOperatorFixtureAdminProofPath,
        dependsOn: [
          devTestGameHostedMatrixRawEvidenceOperatorFixturePath,
          devTestGameHostedMatrixRawEvidenceFixtureProofPath,
          devTestGameHostedEvidenceLaneOperatorFixturePath,
        ],
        fixtureEvidence: true,
        roleUrl: "/admin/audit/local-hosted-evidence-lane?game=<seeded-game>",
      },
      realHostedMatrixRawCapture: {
        script: devTestGameRealHostedMatrixRawCaptureCommand,
        proofArtifact: devTestGameRealHostedMatrixRawCapturePath,
        dependsOn: [
          devTestGameHostedMatrixRawEvidenceTemplatePath,
          devTestGameHostedMatrixRawEvidenceOperatorFixturePath,
        ],
        fixtureEvidence: false,
        releaseReady: false,
        productionReady: false,
      },
      hostedEvidenceLaneRealCaptureAdminProof: {
        script: devTestGameHostedEvidenceLaneRealCaptureAdminProofCommand,
        proofArtifact: devTestGameHostedEvidenceLaneRealCaptureAdminProofPath,
        sourceArtifact: devTestGameHostedEvidenceLaneRealCaptureSourcePath,
        dependsOn: [
          devTestGameRealHostedMatrixRawCapturePath,
          devTestGameHostedEvidenceLaneDemoProofPath,
        ],
        fixtureEvidence: false,
        releaseReady: false,
        productionReady: false,
        roleUrl: "/admin/audit/local-hosted-evidence-lane?game=<seeded-game>",
      },
      ...recoveryReceiptManifestCommands(),
      releaseRunbook: {
        script: devTestGameReleaseRunbookCommand,
        proofArtifact: devTestGameReleaseRunbookPath,
        dependsOn: [devTestGameReleaseReadinessPath],
        roleUrl: "/admin/audit/local-release-runbook?game=<seeded-game>",
      },
      releaseAdminProofContract: {
        script: devTestGameReleaseAdminProofContractCommand,
        proofArtifact: devTestGameReleaseAdminProofContractPath,
        dependsOn: [
          devTestGameReleaseReadinessPath,
          devTestGameReleaseAdminProofPath,
        ],
        roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.releaseReadiness),
        releaseReady: false,
        productionReady: false,
      },
      nextAction: {
        script: nextActionCommand,
        proofArtifact: nextActionPath,
        dependsOn: [
          spineManifestPath,
          devTestGameOpsArtifactsPath,
          devTestGameReleaseReadinessPath,
          devTestGameRaceCoveragePath,
          devTestGameHostedConcurrentRaceMatrixPath,
          devTestGameHostedTargetPreflightPath,
          devTestGameHostedEvidenceLanePath,
          devTestGameHostedEvidenceLaneDemoProofPath,
          devTestGameHostedEvidenceLaneOperatorFixtureAdminProofPath,
          devTestGameHostedEvidenceLaneRealCaptureAdminProofPath,
        ],
      },
      nextActionAdminProof: {
        script: nextActionAdminProofCommand,
        proofArtifact: nextActionAdminProofPath,
        dependsOn: [
          nextActionPath,
          devTestGameProofRunPath,
          devTestGameProofGraphPath,
        ],
        roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.nextAction),
      },
      proofGraph: {
        script: devTestGameProofGraphCommand,
        proofArtifact: devTestGameProofGraphPath,
        dependsOn: [spineManifestPath, adminSpineProofPath],
      },
      proofGraphAdminProof: {
        script: devTestGameProofGraphAdminProofCommand,
        proofArtifact: devTestGameProofGraphAdminProofPath,
        dependsOn: [
          devTestGameProofGraphPath,
          adminSpineProofPath,
          devTestGameProofRunPath,
        ],
        roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.proofGraph),
      },
    },
    evidenceEnv,
    artifactFreshness: buildArtifactFreshnessReport(proofFreshness, {
      recoveryCommands: adminSpineRecoveryCommands,
      proofRunContract,
    }),
    productionFeatureProvenanceSummary:
      buildProductionFeatureProvenanceSummary(),
    handoffPhaseOutputs: handoffPhaseOutputs.map((output) => ({ ...output })),
    terminalArtifacts: [
      {
        id: "next-action",
        label: "Next action receipt",
        command: nextActionCommand,
        path: nextActionPath,
        dependsOn: [...nextActionTerminalDependsOn],
        boundary:
          "Terminal local receipt that chooses one upstream freshness, harness-stability, or recovery command from the manifest, ops artifacts, release-readiness checklist, and race coverage milestone.",
      },
      ...phaseLocalNextActionTerminalArtifacts(),
      {
        id: "next-action-admin-proof",
        label: "Next action admin proof",
        command: nextActionAdminProofCommand,
        path: nextActionAdminProofPath,
        dependsOn: [
          nextActionPath,
          devTestGameProofRunPath,
          devTestGameProofGraphPath,
        ],
        roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.nextAction),
        boundary:
          "Terminal local admin role proof for the generated next-action receipt. It is recorded separately from artifact freshness inputs to avoid making the receipt depend on its own browser proof.",
      },
      {
        id: "proof-graph",
        label: "Proof graph",
        command: devTestGameProofGraphCommand,
        path: devTestGameProofGraphPath,
        dependsOn: [spineManifestPath, adminSpineProofPath],
        boundary:
          "Machine-readable local graph of proof surfaces, seeded admin role URLs, artifacts, proof commands, and recovery edges.",
      },
      {
        id: "proof-graph-admin-proof",
        label: "Proof graph admin proof",
        command: devTestGameProofGraphAdminProofCommand,
        path: devTestGameProofGraphAdminProofPath,
        dependsOn: [
          devTestGameProofGraphPath,
          adminSpineProofPath,
          devTestGameProofRunPath,
        ],
        roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.proofGraph),
        boundary:
          "Terminal local admin role proof for the generated proof graph detail route and graph-to-admin-spine coverage invariant.",
      },
      {
        id: "release-admin-proof-contract",
        label: "Release admin proof diagnostics contract",
        command: devTestGameReleaseAdminProofContractCommand,
        path: devTestGameReleaseAdminProofContractPath,
        dependsOn: [
          devTestGameReleaseReadinessPath,
          devTestGameReleaseAdminProofPath,
        ],
        roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.releaseReadiness),
        boundary:
          "Terminal local artifact contract proving final readiness diagnostics are visible in the release admin browser proof.",
      },
    ],
    artifacts: uniqueSorted([
      spineManifestPath,
      spineManifestMarkdownPath,
      adminSpineProofPath,
      proofFreshnessAdminProofPath,
      nextActionPath,
      hostedEvidenceOperatorChecklistNextActionPath,
      hostedIdentityNextActionPath,
      ...handoffPhaseOutputs.map((output) => output.artifact),
      nextActionAdminProofPath,
      devTestGameHostedConcurrentRaceMatrixPath,
      devTestGameHostedIdentityEvidencePath,
      devTestGameHostedIdentityProgressionSummaryPath,
      ...hostedAdminHandoffProofArtifactCases.map(
        (artifactCase) => artifactCase.path,
      ),
      devTestGameHostedTargetPreflightPath,
      devTestGameHostedEvidenceLanePath,
      devTestGameHostedEvidenceLaneDemoProofPath,
      devTestGameHostedEvidenceLaneDemoRawEvidencePath,
      devTestGameHostedEvidenceLaneDemoExternalEvidencePath,
      devTestGameHostedEvidenceLaneDemoBlockedPath,
      devTestGameHostedEvidenceLaneDemoSyntheticRejectedPath,
      devTestGameHostedMatrixRawEvidenceOperatorFixturePath,
      devTestGameHostedMatrixRawEvidenceFixtureProofPath,
      devTestGameHostedEvidenceLaneOperatorFixturePath,
      devTestGameHostedEvidenceLaneOperatorFixtureAdminProofPath,
      devTestGameRealHostedMatrixRawCapturePath,
      devTestGameHostedEvidenceLaneRealCaptureAdminProofPath,
      devTestGameHostedEvidenceLaneRealCaptureSourcePath,
      ...recoveryReceiptGraphDescriptors.map(
        (descriptor) => descriptor.proofTarget,
      ),
      devTestGameHostedOpsSignalsPath,
      devTestGameRealHostedObservabilityHandoffPath,
      devTestGameReleaseRunbookPath,
      devTestGameReleaseAdminProofContractPath,
      devTestGameProofGraphPath,
      devTestGameProofGraphAdminProofPath,
      ...devTestGameAdminSpineProofPlan.map((step) => step.path),
      ...envValues(evidenceEnv.backupRestore.backupRestoreEvidenceEnv),
      ...envValues(evidenceEnv.backupRestore.backupAwareOpsEnv),
      ...envValues(evidenceEnv.backupRestore.opsReadinessEnv),
      ...envValues(evidenceEnv.backupRestore.seedReadinessEnv),
      ...envValues(evidenceEnv.backupRestore.backupRestoreFinalReadinessEnv),
      ...envValues(evidenceEnv.ops.opsSpineReadinessEnv),
      ...envValues(evidenceEnv.seedFixture.seedFixtureSpineEnv),
      ...envValues(evidenceEnv.identity.identityReadinessEnv),
      ...envValues(
        evidenceEnv.adminSpine.adminSpineTerminalBatchReadinessEvidenceEnv,
      ),
    ]),
    checks: [
      {
        id: "core-live-order-recorded",
        status: "passed",
        evidence: devTestGameCoreLiveSpinePlan.map((step) => step.script),
      },
      {
        id: "live-spine-order-recorded",
        status: "passed",
        evidence: devTestGameLiveSpinePlan.map((step) => step.script),
      },
      {
        id: "sub-spine-orders-recorded",
        status: "passed",
        evidence: [
          "test:dev-test-game-backup-restore",
          "test:dev-test-game-ops",
          "test:dev-test-game-seed-fixture",
          "test:dev-test-game-identity",
          "test:dev-test-game-admin-spine",
        ],
      },
      {
        id: "local-live-wrapper-scripts-recorded",
        status: "passed",
        evidence: [
          {
            command: "coreLive",
            script: "test:dev-test-game-core-live",
            localScript: "test:dev-test-game-core-live:local",
          },
          {
            command: "live",
            script: "test:dev-test-game-live",
            localScript: "test:dev-test-game-live:local",
          },
        ],
        proofBoundary:
          "DB-backed live spine commands keep an underlying already-started database script and a human one-command local wrapper script.",
      },
      {
        id: "ops-spine-order-recorded",
        status: "passed",
        evidence: devTestGameOpsSpinePlan.map((step) => step.script),
      },
      {
        id: "seed-fixture-spine-order-recorded",
        status: "passed",
        evidence: devTestGameSeedFixtureSpinePlan.map((step) => step.script),
      },
      {
        id: "evidence-env-wiring-recorded",
        status: "passed",
        evidence: Object.keys(adminSpineTerminalBatchReadinessEvidenceEnv),
      },
      {
        id: "freshness-proof-recorded",
        status: "passed",
        evidence: [proofFreshnessAdminProofCommand, proofFreshnessAdminProofPath],
      },
      {
        id: "artifact-refresh-status-recorded",
        status: "passed",
        evidence: [
          "manifest.artifactFreshness",
          proofFreshnessAdminProofCommand,
          proofFreshnessAdminProofPath,
        ],
      },
      {
        id: "race-coverage-recorded",
        status: "passed",
        evidence: [devTestGameRaceCoverageCommand, devTestGameRaceCoveragePath],
      },
      {
        id: "hosted-concurrent-race-matrix-recorded",
        status: "passed",
        evidence: [
          devTestGameHostedConcurrentRaceMatrixCommand,
          devTestGameHostedConcurrentRaceMatrixPath,
        ],
      },
      {
        id: "hosted-identity-evidence-recorded",
        status: "passed",
        evidence: [
          devTestGameHostedIdentityEvidenceCommand,
          devTestGameHostedIdentityEvidencePath,
        ],
      },
      {
        id: "hosted-identity-progression-summary-recorded",
        status: "passed",
        evidence: [
          devTestGameHostedIdentityProgressionSummaryCommand,
          devTestGameHostedIdentityProgressionSummaryPath,
        ],
      },
      {
        id: `${hostedIdentityEvidenceAdminProofArtifact.id}-recorded`,
        status: "passed",
        evidence: [
          hostedIdentityEvidenceAdminProofArtifact.script,
          hostedIdentityEvidenceAdminProofArtifact.path,
        ],
      },
      {
        id: "hosted-ops-signals-recorded",
        status: "passed",
        evidence: [devTestGameHostedOpsSignalsCommand, devTestGameHostedOpsSignalsPath],
      },
      {
        id: "hosted-target-preflight-recorded",
        status: "passed",
        evidence: [
          devTestGameHostedTargetPreflightCommand,
          devTestGameHostedTargetPreflightPath,
        ],
      },
      {
        id: "hosted-evidence-lane-recorded",
        status: "passed",
        evidence: [
          devTestGameHostedEvidenceLaneCommand,
          devTestGameHostedEvidenceLanePath,
        ],
      },
      {
        id: "hosted-evidence-lane-demo-proof-recorded",
        status: "passed",
        evidence: [
          devTestGameHostedEvidenceLaneDemoProofCommand,
          devTestGameHostedEvidenceLaneDemoProofPath,
        ],
        demoOnly: true,
      },
      {
        id: "hosted-evidence-lane-operator-fixture-recorded",
        status: "passed",
        evidence: [
          devTestGameHostedEvidenceLaneOperatorFixtureAdminProofCommand,
          devTestGameHostedEvidenceLaneOperatorFixtureAdminProofPath,
        ],
        fixtureEvidence: true,
      },
      {
        id: "real-hosted-matrix-raw-capture-recorded",
        status: "passed",
        evidence: [
          devTestGameRealHostedMatrixRawCaptureCommand,
          devTestGameRealHostedMatrixRawCapturePath,
        ],
        releaseReady: false,
        productionReady: false,
      },
      {
        id: "hosted-evidence-lane-real-capture-admin-proof-recorded",
        status: "passed",
        evidence: [
          devTestGameHostedEvidenceLaneRealCaptureAdminProofCommand,
          devTestGameHostedEvidenceLaneRealCaptureAdminProofPath,
          devTestGameHostedEvidenceLaneRealCaptureSourcePath,
        ],
        releaseReady: false,
        productionReady: false,
      },
      {
        id: "release-runbook-recorded",
        status: "passed",
        evidence: [devTestGameReleaseRunbookCommand, devTestGameReleaseRunbookPath],
      },
      {
        id: "release-admin-proof-contract-recorded",
        status: "passed",
        evidence: [
          devTestGameReleaseAdminProofContractCommand,
          devTestGameReleaseAdminProofContractPath,
        ],
        releaseReady: false,
        productionReady: false,
      },
      {
        id: "terminal-artifacts-recorded",
        status: "passed",
        evidence: [
          nextActionPath,
          nextActionAdminProofPath,
          devTestGameProofGraphPath,
          devTestGameProofGraphAdminProofPath,
          devTestGameReleaseAdminProofContractPath,
        ],
      },
      {
        id: "production-feature-provenance-summary-recorded",
        status: "passed",
        evidence: [
          "manifest.productionFeatureProvenanceSummary",
          `${allProductionFeatureSpineTargetProvenanceCases.length} feature slots`,
        ],
      },
      {
        id: "release-boundary-carried",
        status: "passed",
        releaseReady: false,
        productionReady: false,
      },
    ],
  };
  assertDevTestGameSpineManifest(manifest);
  return manifest;
}

export function assertDevTestGameSpineManifest(manifest) {
  if (manifest?.version !== DEV_TEST_GAME_SPINE_MANIFEST_VERSION) {
    throw new Error(`spine manifest version drifted: ${manifest?.version}`);
  }
  if (manifest.proof !== "dev-test-game-spine-manifest") {
    throw new Error(`unexpected spine manifest proof id: ${manifest.proof}`);
  }
  if (manifest.status !== "passed") {
    throw new Error(`spine manifest status is ${manifest.status}`);
  }
  if (manifest.scope !== "local-dev-test-game-spine-manifest") {
    throw new Error(`spine manifest scope drifted: ${manifest.scope}`);
  }
  if (manifest.releaseReady !== false || manifest.productionReady !== false) {
    throw new Error("spine manifest must not claim production or release readiness");
  }
  assertArtifactFreshnessReport(manifest.artifactFreshness);
  assertProductionFeatureProvenanceSummary(
    manifest.productionFeatureProvenanceSummary,
  );
  assertHandoffPhaseOutputs(manifest);
  assertLocalLiveWrapperScript({
    manifest,
    commandId: "coreLive",
    script: "test:dev-test-game-core-live",
    localScript: "test:dev-test-game-core-live:local",
  });
  assertLocalLiveWrapperScript({
    manifest,
    commandId: "live",
    script: "test:dev-test-game-live",
    localScript: "test:dev-test-game-live:local",
  });
  const coreLivePlan = manifest.commands?.coreLive?.plan ?? [];
  assertPlanScripts(coreLivePlan, [
    "dev:test-game:prebuild",
    "tools/dev_test_game_live_proof.mjs",
    "tools/dev_test_game_proof_contract.mjs",
    "tools/dev_test_game_core_loop_admin_proof.mjs",
    "tools/dev_test_game_private_channel_recovery_receipt.mjs",
    "tools/dev_test_game_hardening_admin_proof.mjs",
    "tools/dev_test_game_replacement_action_recovery_receipt.mjs",
    "tools/dev_test_game_replacement_handoff_recovery_receipt.mjs",
    "tools/dev_test_game_replacement_private_recovery_receipt.mjs",
    "tools/dev_test_game_release_readiness.mjs",
  ]);
  const livePlan = manifest.commands?.live?.plan ?? [];
  assertPlanScripts(livePlan, [
    "dev:test-game:prebuild",
    "tools/dev_test_game_live_proof.mjs",
    "tools/dev_test_game_proof_contract.mjs",
    "tools/dev_test_game_core_loop_admin_proof.mjs",
    "tools/dev_test_game_private_channel_recovery_receipt.mjs",
    "tools/dev_test_game_hardening_admin_proof.mjs",
    "tools/dev_test_game_replacement_action_recovery_receipt.mjs",
    "tools/dev_test_game_replacement_handoff_recovery_receipt.mjs",
    "tools/dev_test_game_replacement_private_recovery_receipt.mjs",
    "tools/dev_test_game_release_readiness.mjs",
    "tools/dev_test_game_seed_fixture_summary.mjs",
    "tools/dev_test_game_seed_admin_proof.mjs",
    "backup-restore",
    "identity",
    "admin",
  ]);
  assertPlanScripts(manifest.commands?.backupRestore?.plan ?? [], [
    "tools/live_stack_backup_restore_drill.mjs",
    "tools/dev_test_game_ops_artifacts.mjs",
    "tools/dev_test_game_release_readiness.mjs",
    "tools/dev_test_game_seed_fixture_summary.mjs",
    "tools/dev_test_game_seed_admin_proof.mjs",
    "tools/dev_test_game_backup_admin_proof.mjs",
    "tools/dev_test_game_release_readiness.mjs",
  ]);
  assertPlanScripts(manifest.commands?.ops?.plan ?? [], [
    "tools/dev_test_game_ops_artifacts.mjs",
    "tools/dev_test_game_ops_admin_proof.mjs",
    "tools/dev_test_game_release_readiness.mjs",
  ]);
  assertOpsArtifactPlanOrder(manifest.commands?.backupRestore?.plan ?? []);
  assertOpsArtifactPlanOrder(manifest.commands?.ops?.plan ?? []);
  assertPlanScripts(manifest.commands?.seedFixture?.plan ?? [], [
    "tools/dev_test_game_seed_fixture_summary.mjs",
    "tools/dev_test_game_seed_admin_proof.mjs",
    "tools/dev_test_game_release_readiness.mjs",
    "tools/dev_test_game_next_action.mjs",
  ]);
  assertPlanScripts(manifest.commands?.identity?.plan ?? [], [
    "tools/auth_invite_role_proof.mjs",
    "tools/dev_test_game_identity_admin_proof.mjs",
    "tools/dev_test_game_hosted_identity_evidence.mjs",
    "tools/dev_test_game_hosted_identity_progression_summary.mjs",
    "tools/dev_test_game_hosted_identity_progression_admin_proof_batch.mjs",
    "tools/dev_test_game_release_readiness.mjs",
  ]);
  assertPlanScripts(manifest.commands?.identityOperator?.plan ?? [], [
    "tools/auth_invite_role_proof.mjs",
    "tools/dev_test_game_identity_admin_proof.mjs",
    "tools/dev_test_game_hosted_identity_evidence.mjs",
    "tools/dev_test_game_hosted_identity_progression_summary.mjs",
    "tools/dev_test_game_hosted_identity_progression_admin_proof_batch.mjs",
    "tools/dev_test_game_release_readiness.mjs",
    "tools/dev_test_game_hosted_identity_operator_admin_proof.mjs",
    "tools/dev_test_game_release_readiness.mjs",
  ]);
  assertPlanScripts(manifest.commands?.adminSpine?.plan ?? [], [
    "tools/dev_test_game_core_loop_admin_proof.mjs",
    "tools/dev_test_game_hardening_admin_proof.mjs",
    "tools/dev_test_game_identity_admin_proof.mjs",
    "tools/dev_test_game_hosted_identity_evidence_admin_proof.mjs",
    "tools/dev_test_game_backup_admin_proof.mjs",
    "tools/dev_test_game_ops_admin_proof.mjs",
    "tools/dev_test_game_seed_admin_proof.mjs",
    "tools/dev_test_game_host_setup_admin_proof.mjs",
    "tools/dev_test_game_release_admin_proof.mjs",
    "tools/dev_test_game_release_runbook_admin_proof.mjs",
    "tools/dev_test_game_race_coverage_admin_proof.mjs",
    "tools/dev_test_game_hosted_target_preflight_admin_proof.mjs",
    "tools/dev_test_game_hosted_evidence_lane_admin_proof.mjs",
    "tools/dev_test_game_hosted_evidence_lane_operator_fixture_admin_proof.mjs",
    "tools/dev_test_game_hosted_concurrent_race_matrix_admin_proof.mjs",
    "tools/dev_test_game_hosted_ops_signals_admin_proof.mjs",
    "tools/dev_test_game_real_hosted_observability_handoff_admin_proof.mjs",
    "tools/dev_test_game_spine_manifest_admin_proof.mjs",
  ]);
  if (manifest.commands?.proofFreshness?.script !== proofFreshnessAdminProofCommand) {
    throw new Error(
      `spine manifest proof freshness command drifted: ${manifest.commands?.proofFreshness?.script}`,
    );
  }
  if (manifest.commands.proofFreshness.proofArtifact !== proofFreshnessAdminProofPath) {
    throw new Error(
      `spine manifest proof freshness artifact drifted: ${manifest.commands.proofFreshness.proofArtifact}`,
    );
  }
  if (manifest.commands?.raceCoverage?.script !== devTestGameRaceCoverageCommand) {
    throw new Error(
      `spine manifest race coverage command drifted: ${manifest.commands?.raceCoverage?.script}`,
    );
  }
  if (manifest.commands.raceCoverage.proofArtifact !== devTestGameRaceCoveragePath) {
    throw new Error(
      `spine manifest race coverage artifact drifted: ${manifest.commands.raceCoverage.proofArtifact}`,
    );
  }
  if (
    manifest.commands?.hostedConcurrentRaceMatrix?.script !==
    devTestGameHostedConcurrentRaceMatrixCommand
  ) {
    throw new Error(
      `spine manifest hosted concurrent race matrix command drifted: ${manifest.commands?.hostedConcurrentRaceMatrix?.script}`,
    );
  }
  if (
    manifest.commands.hostedConcurrentRaceMatrix.proofArtifact !==
    devTestGameHostedConcurrentRaceMatrixPath
  ) {
    throw new Error(
      `spine manifest hosted concurrent race matrix artifact drifted: ${manifest.commands.hostedConcurrentRaceMatrix.proofArtifact}`,
    );
  }
  if (
    manifest.commands?.hostedIdentityEvidence?.script !==
    devTestGameHostedIdentityEvidenceCommand
  ) {
    throw new Error(
      `spine manifest hosted identity evidence command drifted: ${manifest.commands?.hostedIdentityEvidence?.script}`,
    );
  }
  if (
    manifest.commands.hostedIdentityEvidence.proofArtifact !==
    devTestGameHostedIdentityEvidencePath
  ) {
    throw new Error(
      `spine manifest hosted identity evidence artifact drifted: ${manifest.commands.hostedIdentityEvidence.proofArtifact}`,
    );
  }
  if (
    manifest.commands?.hostedIdentityProgressionSummary?.script !==
    devTestGameHostedIdentityProgressionSummaryCommand
  ) {
    throw new Error(
      `spine manifest hosted identity progression summary command drifted: ${manifest.commands?.hostedIdentityProgressionSummary?.script}`,
    );
  }
  if (
    manifest.commands.hostedIdentityProgressionSummary.proofArtifact !==
    devTestGameHostedIdentityProgressionSummaryPath
  ) {
    throw new Error(
      `spine manifest hosted identity progression summary artifact drifted: ${manifest.commands.hostedIdentityProgressionSummary.proofArtifact}`,
    );
  }
  if (
    manifest.commands?.hostedIdentityProgressionAdminProofBatch?.script !==
    devTestGameHostedIdentityProgressionAdminProofBatchCommand
  ) {
    throw new Error(
      `spine manifest hosted identity progression admin proof batch command drifted: ${manifest.commands?.hostedIdentityProgressionAdminProofBatch?.script}`,
    );
  }
  if (
    JSON.stringify(
      manifest.commands.hostedIdentityProgressionAdminProofBatch.proofArtifacts,
    ) !== JSON.stringify([...hostedIdentityProgressionAdminProofBatchArtifactPaths])
  ) {
    throw new Error(
      "spine manifest hosted identity progression admin proof batch artifacts drifted",
    );
  }
  if (
    manifest.commands?.hostedIdentityEvidenceAdminProof?.script !==
    hostedIdentityEvidenceAdminProofArtifact.script
  ) {
    throw new Error(
      `spine manifest hosted identity evidence admin proof command drifted: ${manifest.commands?.hostedIdentityEvidenceAdminProof?.script}`,
    );
  }
  if (
    manifest.commands.hostedIdentityEvidenceAdminProof.proofArtifact !==
    hostedIdentityEvidenceAdminProofArtifact.path
  ) {
    throw new Error(
      `spine manifest hosted identity evidence admin proof artifact drifted: ${manifest.commands.hostedIdentityEvidenceAdminProof.proofArtifact}`,
    );
  }
  if (manifest.commands?.hostedOpsSignals?.script !== devTestGameHostedOpsSignalsCommand) {
    throw new Error(
      `spine manifest hosted ops signals command drifted: ${manifest.commands?.hostedOpsSignals?.script}`,
    );
  }
  if (manifest.commands.hostedOpsSignals.proofArtifact !== devTestGameHostedOpsSignalsPath) {
    throw new Error(
      `spine manifest hosted ops signals artifact drifted: ${manifest.commands.hostedOpsSignals.proofArtifact}`,
    );
  }
  if (
    manifest.commands?.realHostedObservabilityHandoff?.script !==
    devTestGameRealHostedObservabilityHandoffCommand
  ) {
    throw new Error(
      `spine manifest real hosted observability handoff command drifted: ${manifest.commands?.realHostedObservabilityHandoff?.script}`,
    );
  }
  if (
    manifest.commands.realHostedObservabilityHandoff.proofArtifact !==
    devTestGameRealHostedObservabilityHandoffPath
  ) {
    throw new Error(
      `spine manifest real hosted observability handoff artifact drifted: ${manifest.commands.realHostedObservabilityHandoff.proofArtifact}`,
    );
  }
  if (
    manifest.commands?.realHostedObservabilityHandoffAdminProof?.script !==
    realHostedObservabilityHandoffAdminProofArtifact.script
  ) {
    throw new Error(
      `spine manifest real hosted observability handoff admin proof command drifted: ${manifest.commands?.realHostedObservabilityHandoffAdminProof?.script}`,
    );
  }
  if (
    manifest.commands.realHostedObservabilityHandoffAdminProof.proofArtifact !==
    realHostedObservabilityHandoffAdminProofArtifact.path
  ) {
    throw new Error(
      `spine manifest real hosted observability handoff admin proof artifact drifted: ${manifest.commands.realHostedObservabilityHandoffAdminProof.proofArtifact}`,
    );
  }
  if (
    manifest.commands?.hostedTargetPreflight?.script !==
    devTestGameHostedTargetPreflightCommand
  ) {
    throw new Error(
      `spine manifest hosted target preflight command drifted: ${manifest.commands?.hostedTargetPreflight?.script}`,
    );
  }
  if (
    manifest.commands.hostedTargetPreflight.proofArtifact !==
    devTestGameHostedTargetPreflightPath
  ) {
    throw new Error(
      `spine manifest hosted target preflight artifact drifted: ${manifest.commands.hostedTargetPreflight.proofArtifact}`,
    );
  }
  if (
    manifest.commands?.hostedEvidenceLane?.script !==
    devTestGameHostedEvidenceLaneCommand
  ) {
    throw new Error(
      `spine manifest hosted evidence lane command drifted: ${manifest.commands?.hostedEvidenceLane?.script}`,
    );
  }
  if (
    manifest.commands.hostedEvidenceLane.proofArtifact !==
    devTestGameHostedEvidenceLanePath
  ) {
    throw new Error(
      `spine manifest hosted evidence lane artifact drifted: ${manifest.commands.hostedEvidenceLane.proofArtifact}`,
    );
  }
  if (
    manifest.commands?.hostedEvidenceOperatorChecklistProof?.script !==
    devTestGameHostedEvidenceOperatorChecklistProofCommand
  ) {
    throw new Error(
      `spine manifest hosted evidence operator checklist command drifted: ${manifest.commands?.hostedEvidenceOperatorChecklistProof?.script}`,
    );
  }
  if (
    manifest.commands.hostedEvidenceOperatorChecklistProof.proofArtifact !==
    devTestGameHostedEvidenceOperatorChecklistProofPath
  ) {
    throw new Error(
      `spine manifest hosted evidence operator checklist artifact drifted: ${manifest.commands.hostedEvidenceOperatorChecklistProof.proofArtifact}`,
    );
  }
  if (
    manifest.commands.hostedEvidenceOperatorChecklistProof.templateOnly !== true ||
    manifest.commands.hostedEvidenceOperatorChecklistProof.releaseReady !==
      false ||
    manifest.commands.hostedEvidenceOperatorChecklistProof.productionReady !==
      false
  ) {
    throw new Error(
      "spine manifest hosted evidence operator checklist proof must stay template-only",
    );
  }
  if (
    manifest.commands?.hostedEvidenceOperatorChecklistAdminProof?.script !==
    devTestGameHostedEvidenceOperatorChecklistAdminProofCommand
  ) {
    throw new Error(
      `spine manifest hosted evidence operator checklist admin proof command drifted: ${manifest.commands?.hostedEvidenceOperatorChecklistAdminProof?.script}`,
    );
  }
  if (
    manifest.commands.hostedEvidenceOperatorChecklistAdminProof.proofArtifact !==
    devTestGameHostedEvidenceOperatorChecklistAdminProofPath
  ) {
    throw new Error(
      `spine manifest hosted evidence operator checklist admin proof artifact drifted: ${manifest.commands.hostedEvidenceOperatorChecklistAdminProof.proofArtifact}`,
    );
  }
  if (
    !manifest.commands.hostedEvidenceOperatorChecklistAdminProof.dependsOn.includes(
      devTestGameHostedEvidenceOperatorChecklistProofPath,
    ) ||
    !manifest.commands.hostedEvidenceOperatorChecklistAdminProof.dependsOn.includes(
      devTestGameHostedEvidenceLaneAdminProofPath,
    ) ||
    !manifest.commands.hostedEvidenceOperatorChecklistAdminProof.dependsOn.includes(
      devTestGameReleaseReadinessPath,
    ) ||
    !manifest.commands.hostedEvidenceOperatorChecklistAdminProof.dependsOn.includes(
      nextActionPath,
    ) ||
    manifest.commands.hostedEvidenceOperatorChecklistAdminProof.roleUrl !==
      "/admin/audit/local-hosted-evidence-lane?game=<seeded-game>" ||
    manifest.commands.hostedEvidenceOperatorChecklistAdminProof.releaseReady !==
      false ||
    manifest.commands.hostedEvidenceOperatorChecklistAdminProof.productionReady !==
      false
  ) {
    throw new Error(
      "spine manifest hosted evidence operator checklist admin proof contract drifted",
    );
  }
  if (
    manifest.commands?.hostedEvidenceLaneDemoProof?.script !==
    devTestGameHostedEvidenceLaneDemoProofCommand
  ) {
    throw new Error(
      `spine manifest hosted evidence lane demo command drifted: ${manifest.commands?.hostedEvidenceLaneDemoProof?.script}`,
    );
  }
  if (
    manifest.commands.hostedEvidenceLaneDemoProof.proofArtifact !==
    devTestGameHostedEvidenceLaneDemoProofPath
  ) {
    throw new Error(
      `spine manifest hosted evidence lane demo artifact drifted: ${manifest.commands.hostedEvidenceLaneDemoProof.proofArtifact}`,
    );
  }
  if (manifest.commands.hostedEvidenceLaneDemoProof.demoOnly !== true) {
    throw new Error("spine manifest hosted evidence lane demo must stay demo-only");
  }
  if (
    manifest.commands?.hostedMatrixRawEvidenceFixtureProof?.script !==
    devTestGameHostedMatrixRawEvidenceFixtureProofCommand
  ) {
    throw new Error(
      `spine manifest hosted matrix raw fixture proof command drifted: ${manifest.commands?.hostedMatrixRawEvidenceFixtureProof?.script}`,
    );
  }
  if (
    manifest.commands.hostedMatrixRawEvidenceFixtureProof.proofArtifact !==
    devTestGameHostedMatrixRawEvidenceFixtureProofPath
  ) {
    throw new Error(
      `spine manifest hosted matrix raw fixture proof artifact drifted: ${manifest.commands.hostedMatrixRawEvidenceFixtureProof.proofArtifact}`,
    );
  }
  if (
    manifest.commands.hostedMatrixRawEvidenceFixtureProof.fixtureEvidence !== true
  ) {
    throw new Error(
      "spine manifest hosted matrix raw fixture proof must stay fixture-only",
    );
  }
  if (
    manifest.commands?.hostedMatrixRawEvidenceTemplateProof?.script !==
    devTestGameHostedMatrixRawEvidenceTemplateProofCommand
  ) {
    throw new Error(
      `spine manifest hosted matrix raw template proof command drifted: ${manifest.commands?.hostedMatrixRawEvidenceTemplateProof?.script}`,
    );
  }
  if (
    manifest.commands.hostedMatrixRawEvidenceTemplateProof.proofArtifact !==
    devTestGameHostedMatrixRawEvidenceTemplateProofPath
  ) {
    throw new Error(
      `spine manifest hosted matrix raw template proof artifact drifted: ${manifest.commands.hostedMatrixRawEvidenceTemplateProof.proofArtifact}`,
    );
  }
  if (
    manifest.commands.hostedMatrixRawEvidenceTemplateProof.templateOnly !== true ||
    manifest.commands.hostedMatrixRawEvidenceTemplateProof.releaseReady !== false ||
    manifest.commands.hostedMatrixRawEvidenceTemplateProof.productionReady !== false
  ) {
    throw new Error(
      "spine manifest hosted matrix raw template proof must stay template-only",
    );
  }
  if (
    manifest.commands?.hostedEvidenceLaneOperatorFixtureAdminProof?.script !==
    devTestGameHostedEvidenceLaneOperatorFixtureAdminProofCommand
  ) {
    throw new Error(
      `spine manifest hosted evidence lane operator fixture command drifted: ${manifest.commands?.hostedEvidenceLaneOperatorFixtureAdminProof?.script}`,
    );
  }
  if (
    manifest.commands.hostedEvidenceLaneOperatorFixtureAdminProof
      .proofArtifact !==
    devTestGameHostedEvidenceLaneOperatorFixtureAdminProofPath
  ) {
    throw new Error(
      `spine manifest hosted evidence lane operator fixture artifact drifted: ${manifest.commands.hostedEvidenceLaneOperatorFixtureAdminProof.proofArtifact}`,
    );
  }
  if (
    manifest.commands.hostedEvidenceLaneOperatorFixtureAdminProof
      .fixtureEvidence !== true
  ) {
    throw new Error(
      "spine manifest hosted evidence lane operator fixture proof must stay fixture-only",
    );
  }
  if (
    manifest.commands?.realHostedMatrixRawCapture?.script !==
    devTestGameRealHostedMatrixRawCaptureCommand
  ) {
    throw new Error(
      `spine manifest real hosted matrix raw capture command drifted: ${manifest.commands?.realHostedMatrixRawCapture?.script}`,
    );
  }
  if (
    manifest.commands.realHostedMatrixRawCapture.proofArtifact !==
    devTestGameRealHostedMatrixRawCapturePath
  ) {
    throw new Error(
      `spine manifest real hosted matrix raw capture artifact drifted: ${manifest.commands.realHostedMatrixRawCapture.proofArtifact}`,
    );
  }
  if (
    manifest.commands.realHostedMatrixRawCapture.releaseReady !== false ||
    manifest.commands.realHostedMatrixRawCapture.productionReady !== false
  ) {
    throw new Error(
      "spine manifest real hosted matrix raw capture must not claim readiness",
    );
  }
  if (
    manifest.commands?.hostedEvidenceLaneRealCaptureAdminProof?.script !==
    devTestGameHostedEvidenceLaneRealCaptureAdminProofCommand
  ) {
    throw new Error(
      `spine manifest hosted evidence lane real-capture admin proof command drifted: ${manifest.commands?.hostedEvidenceLaneRealCaptureAdminProof?.script}`,
    );
  }
  if (
    manifest.commands.hostedEvidenceLaneRealCaptureAdminProof.proofArtifact !==
    devTestGameHostedEvidenceLaneRealCaptureAdminProofPath
  ) {
    throw new Error(
      `spine manifest hosted evidence lane real-capture admin proof artifact drifted: ${manifest.commands.hostedEvidenceLaneRealCaptureAdminProof.proofArtifact}`,
    );
  }
  if (
    manifest.commands.hostedEvidenceLaneRealCaptureAdminProof.sourceArtifact !==
    devTestGameHostedEvidenceLaneRealCaptureSourcePath
  ) {
    throw new Error(
      `spine manifest hosted evidence lane real-capture source artifact drifted: ${manifest.commands.hostedEvidenceLaneRealCaptureAdminProof.sourceArtifact}`,
    );
  }
  if (
    manifest.commands.hostedEvidenceLaneRealCaptureAdminProof.releaseReady !==
      false ||
    manifest.commands.hostedEvidenceLaneRealCaptureAdminProof.productionReady !==
      false
  ) {
    throw new Error(
      "spine manifest hosted evidence lane real-capture admin proof must not claim readiness",
    );
  }
  assertRecoveryReceiptManifestCommands(manifest.commands ?? {});
  if (manifest.commands?.releaseRunbook?.script !== devTestGameReleaseRunbookCommand) {
    throw new Error(
      `spine manifest release runbook command drifted: ${manifest.commands?.releaseRunbook?.script}`,
    );
  }
  if (manifest.commands.releaseRunbook.proofArtifact !== devTestGameReleaseRunbookPath) {
    throw new Error(
      `spine manifest release runbook artifact drifted: ${manifest.commands.releaseRunbook.proofArtifact}`,
    );
  }
  if (
    manifest.commands?.releaseAdminProofContract?.script !==
    devTestGameReleaseAdminProofContractCommand
  ) {
    throw new Error(
      `spine manifest release admin proof contract command drifted: ${manifest.commands?.releaseAdminProofContract?.script}`,
    );
  }
  if (
    manifest.commands.releaseAdminProofContract.proofArtifact !==
    devTestGameReleaseAdminProofContractPath
  ) {
    throw new Error(
      `spine manifest release admin proof contract artifact drifted: ${manifest.commands.releaseAdminProofContract.proofArtifact}`,
    );
  }
  if (
    manifest.commands.releaseAdminProofContract.releaseReady !== false ||
    manifest.commands.releaseAdminProofContract.productionReady !== false
  ) {
    throw new Error(
      "spine manifest release admin proof contract must not claim readiness",
    );
  }
  if (manifest.commands?.nextAction?.script !== nextActionCommand) {
    throw new Error(
      `spine manifest next-action command drifted: ${manifest.commands?.nextAction?.script}`,
    );
  }
  if (manifest.commands.nextAction.proofArtifact !== nextActionPath) {
    throw new Error(
      `spine manifest next-action artifact drifted: ${manifest.commands.nextAction.proofArtifact}`,
    );
  }
  if (manifest.commands?.nextActionAdminProof?.script !== nextActionAdminProofCommand) {
    throw new Error(
      `spine manifest next-action admin proof command drifted: ${manifest.commands?.nextActionAdminProof?.script}`,
    );
  }
  if (manifest.commands.nextActionAdminProof.proofArtifact !== nextActionAdminProofPath) {
    throw new Error(
      `spine manifest next-action admin proof artifact drifted: ${manifest.commands.nextActionAdminProof.proofArtifact}`,
    );
  }
  if (manifest.commands?.proofGraph?.script !== devTestGameProofGraphCommand) {
    throw new Error(
      `spine manifest proof graph command drifted: ${manifest.commands?.proofGraph?.script}`,
    );
  }
  if (manifest.commands.proofGraph.proofArtifact !== devTestGameProofGraphPath) {
    throw new Error(
      `spine manifest proof graph artifact drifted: ${manifest.commands.proofGraph.proofArtifact}`,
    );
  }
  if (
    manifest.commands?.proofGraphAdminProof?.script !==
    devTestGameProofGraphAdminProofCommand
  ) {
    throw new Error(
      `spine manifest proof graph admin proof command drifted: ${manifest.commands?.proofGraphAdminProof?.script}`,
    );
  }
  if (
    manifest.commands.proofGraphAdminProof.proofArtifact !==
    devTestGameProofGraphAdminProofPath
  ) {
    throw new Error(
      `spine manifest proof graph admin proof artifact drifted: ${manifest.commands.proofGraphAdminProof.proofArtifact}`,
    );
  }
  assertTerminalArtifacts(manifest.terminalArtifacts);
  for (const path of [
    spineManifestPath,
    spineManifestMarkdownPath,
    adminSpineProofPath,
    devTestGameRaceCoveragePath,
    proofFreshnessAdminProofPath,
    nextActionPath,
    nextActionAdminProofPath,
    devTestGameHostedConcurrentRaceMatrixPath,
    devTestGameHostedIdentityEvidencePath,
    ...hostedAdminHandoffProofArtifactCases.map(
      (artifactCase) => artifactCase.path,
    ),
    devTestGameHostedTargetPreflightPath,
    devTestGameHostedEvidenceLanePath,
    devTestGameHostedEvidenceLaneDemoProofPath,
    devTestGameHostedEvidenceLaneDemoRawEvidencePath,
    devTestGameHostedEvidenceLaneDemoExternalEvidencePath,
    devTestGameHostedEvidenceLaneDemoBlockedPath,
    devTestGameHostedEvidenceLaneDemoSyntheticRejectedPath,
    devTestGameHostedMatrixRawEvidenceOperatorFixturePath,
    devTestGameHostedMatrixRawEvidenceFixtureProofPath,
    devTestGameHostedEvidenceLaneOperatorFixturePath,
    devTestGameHostedEvidenceLaneOperatorFixtureAdminProofPath,
    devTestGameRealHostedMatrixRawCapturePath,
    devTestGameHostedOpsSignalsPath,
    devTestGameRealHostedObservabilityHandoffPath,
    devTestGameReleaseRunbookPath,
    devTestGameProofGraphPath,
    devTestGameProofGraphAdminProofPath,
    devTestGameCoreLoopAdminProofPath,
    devTestGameHardeningAdminProofPath,
    devTestGameIdentityAdminProofPath,
    devTestGameReleaseAdminProofPath,
    devTestGameReleaseAdminProofContractPath,
    devTestGameRaceCoverageAdminProofPath,
    devTestGameReleaseRunbookAdminProofPath,
    devTestGameHostedTargetPreflightAdminProofPath,
    devTestGameHostedOpsSignalsAdminProofPath,
    devTestGameSpineManifestAdminProofPath,
    devTestGameAdminSpineAdminProofPath,
    devTestGameBackupRestoreProofPath,
    devTestGameBackupRestoreDumpPath,
  ]) {
    if (!manifest.artifacts?.includes(path)) {
      throw new Error(`spine manifest missing artifact path: ${path}`);
    }
  }
  const checks = new Map((manifest.checks ?? []).map((check) => [check.id, check.status]));
  for (const id of [
    "core-live-order-recorded",
    "live-spine-order-recorded",
    "sub-spine-orders-recorded",
    "local-live-wrapper-scripts-recorded",
    "ops-spine-order-recorded",
    "seed-fixture-spine-order-recorded",
    "evidence-env-wiring-recorded",
    "freshness-proof-recorded",
    "artifact-refresh-status-recorded",
    "race-coverage-recorded",
    "hosted-concurrent-race-matrix-recorded",
    "hosted-identity-evidence-recorded",
    "hosted-identity-progression-summary-recorded",
    `${hostedIdentityEvidenceAdminProofArtifact.id}-recorded`,
    "hosted-target-preflight-recorded",
    "hosted-evidence-lane-recorded",
    "hosted-evidence-lane-demo-proof-recorded",
    "hosted-evidence-lane-operator-fixture-recorded",
    "real-hosted-matrix-raw-capture-recorded",
    "hosted-evidence-lane-real-capture-admin-proof-recorded",
    "hosted-ops-signals-recorded",
    "release-runbook-recorded",
    "release-admin-proof-contract-recorded",
    "terminal-artifacts-recorded",
    "production-feature-provenance-summary-recorded",
    "release-boundary-carried",
  ]) {
    if (checks.get(id) !== "passed") {
      throw new Error(`spine manifest missing passed check: ${id}`);
    }
  }
  return manifest;
}

export function buildProductionFeatureProvenanceSummary() {
  const sourceCheckGroups = Array.from(
    allProductionFeatureSpineTargetProvenanceCases
      .reduce((groups, provenanceCase) => {
        const group = groups.get(provenanceCase.sourceCheckId) ?? {
          sourceCheckId: provenanceCase.sourceCheckId,
          featureCount: 0,
          featureSlotIds: [],
          selectedProofArtifacts: [],
        };
        group.featureCount += 1;
        group.featureSlotIds.push(provenanceCase.featureSlotId);
        group.selectedProofArtifacts.push(provenanceCase.proofArtifact);
        groups.set(provenanceCase.sourceCheckId, group);
        return groups;
      }, new Map())
      .values(),
  )
    .map((group) => ({
      sourceCheckId: group.sourceCheckId,
      featureCount: group.featureCount,
      featureSlotIds: uniqueSorted(group.featureSlotIds),
      selectedProofArtifacts: uniqueSorted(group.selectedProofArtifacts),
    }))
    .sort((left, right) => left.sourceCheckId.localeCompare(right.sourceCheckId));
  return {
    status: "passed",
    featureCount: allProductionFeatureSpineTargetProvenanceCases.length,
    sourceCheckCount: sourceCheckGroups.length,
    selectedProofArtifacts: uniqueSorted(
      allProductionFeatureSpineTargetProvenanceCases.map(
        (provenanceCase) => provenanceCase.proofArtifact,
      ),
    ),
    sourceCheckGroups,
  };
}

export function assertProductionFeatureProvenanceSummary(summary) {
  const expected = buildProductionFeatureProvenanceSummary();
  if (JSON.stringify(summary) !== JSON.stringify(expected)) {
    throw new Error("spine manifest production feature provenance summary drifted");
  }
  return summary;
}

function assertHandoffPhaseOutputs(manifest) {
  if (
    !Array.isArray(manifest.handoffPhaseOutputs) ||
    manifest.handoffPhaseOutputs.length !== handoffPhaseOutputs.length
  ) {
    throw new Error("spine manifest handoff phase outputs drifted");
  }
  const expected = handoffPhaseOutputs.map((output) => ({ ...output }));
  if (JSON.stringify(manifest.handoffPhaseOutputs) !== JSON.stringify(expected)) {
    throw new Error("spine manifest handoff phase outputs drifted");
  }
  const artifactSet = new Set(manifest.artifacts ?? []);
  const outputIds = new Set();
  for (const output of manifest.handoffPhaseOutputs) {
    if (
      typeof output.id !== "string" ||
      output.id === "" ||
      typeof output.phaseId !== "string" ||
      output.phaseId === "" ||
      typeof output.step !== "string" ||
      output.step === "" ||
      typeof output.script !== "string" ||
      output.script === "" ||
      typeof output.artifact !== "string" ||
      output.artifact === "" ||
      !artifactSet.has(output.artifact)
    ) {
      throw new Error("spine manifest handoff phase output is malformed");
    }
    if (outputIds.has(output.id)) {
      throw new Error("spine manifest handoff phase output ids must be unique");
    }
    outputIds.add(output.id);
  }
}

function assertTerminalArtifacts(terminalArtifacts) {
  const artifacts = new Map(
    (terminalArtifacts ?? []).map((artifact) => [artifact.id, artifact]),
  );
  const nextAction = artifacts.get("next-action");
  if (
    nextAction?.command !== nextActionCommand ||
    nextAction.path !== nextActionPath ||
    !Array.isArray(nextAction.dependsOn) ||
    !nextAction.dependsOn.includes(spineManifestPath) ||
    !nextAction.dependsOn.includes(devTestGameOpsArtifactsPath) ||
    !nextAction.dependsOn.includes(devTestGameReleaseReadinessPath) ||
    !nextAction.dependsOn.includes(devTestGameRaceCoveragePath) ||
    !nextAction.dependsOn.includes(devTestGameHostedConcurrentRaceMatrixPath) ||
    !nextAction.dependsOn.includes(devTestGameHostedTargetPreflightPath) ||
    !nextAction.dependsOn.includes(devTestGameHostedEvidenceLanePath) ||
    !nextAction.dependsOn.includes(devTestGameHostedEvidenceLaneDemoProofPath) ||
    !nextAction.dependsOn.includes(
      devTestGameHostedEvidenceLaneOperatorFixtureAdminProofPath,
    )
  ) {
    throw new Error("spine manifest next-action terminal artifact drifted");
  }
  assertPhaseLocalNextActionTerminalArtifact(artifacts, {
    artifactId: "next-action-hosted-evidence-operator-checklist",
    phaseId: "hosted-evidence-operator-checklist",
    path: hostedEvidenceOperatorChecklistNextActionPath,
  });
  assertPhaseLocalNextActionTerminalArtifact(artifacts, {
    artifactId: "next-action-hosted-identity",
    phaseId: "hosted-identity",
    path: hostedIdentityNextActionPath,
    sequenceStage: "hosted-identity",
    extraDependsOn: [
      devTestGameHostedIdentityEvidencePath,
      devTestGameHostedIdentityProgressionSummaryPath,
      devTestGameProofGraphPath,
    ],
  });
  const adminProof = artifacts.get("next-action-admin-proof");
  if (
    adminProof?.command !== nextActionAdminProofCommand ||
    adminProof.path !== nextActionAdminProofPath ||
    adminProof.roleUrl !== localAdminAuditRoleUrl(localAdminAuditIds.nextAction) ||
    !Array.isArray(adminProof.dependsOn) ||
    !adminProof.dependsOn.includes(nextActionPath) ||
    !adminProof.dependsOn.includes(devTestGameProofGraphPath)
  ) {
    throw new Error("spine manifest next-action admin terminal artifact drifted");
  }
  const proofGraph = artifacts.get("proof-graph");
  if (
    proofGraph?.command !== devTestGameProofGraphCommand ||
    proofGraph.path !== devTestGameProofGraphPath ||
    !Array.isArray(proofGraph.dependsOn) ||
    !proofGraph.dependsOn.includes(spineManifestPath) ||
    !proofGraph.dependsOn.includes(adminSpineProofPath)
  ) {
    throw new Error("spine manifest proof graph terminal artifact drifted");
  }
  const proofGraphAdminProof = artifacts.get("proof-graph-admin-proof");
  if (
    proofGraphAdminProof?.command !== devTestGameProofGraphAdminProofCommand ||
    proofGraphAdminProof.path !== devTestGameProofGraphAdminProofPath ||
    proofGraphAdminProof.roleUrl !==
      localAdminAuditRoleUrl(localAdminAuditIds.proofGraph) ||
    !Array.isArray(proofGraphAdminProof.dependsOn) ||
    !proofGraphAdminProof.dependsOn.includes(devTestGameProofGraphPath)
  ) {
    throw new Error("spine manifest proof graph admin terminal artifact drifted");
  }
  const releaseAdminProofContract = artifacts.get("release-admin-proof-contract");
  if (
    releaseAdminProofContract?.command !==
      devTestGameReleaseAdminProofContractCommand ||
    releaseAdminProofContract.path !== devTestGameReleaseAdminProofContractPath ||
    releaseAdminProofContract.roleUrl !==
      localAdminAuditRoleUrl(localAdminAuditIds.releaseReadiness) ||
    !Array.isArray(releaseAdminProofContract.dependsOn) ||
    !releaseAdminProofContract.dependsOn.includes(
      devTestGameReleaseReadinessPath,
    ) ||
    !releaseAdminProofContract.dependsOn.includes(
      devTestGameReleaseAdminProofPath,
    )
  ) {
    throw new Error(
      "spine manifest release admin proof contract terminal artifact drifted",
    );
  }
}

function assertPhaseLocalNextActionTerminalArtifact(
  artifacts,
  { artifactId, phaseId, path: artifactPath, sequenceStage, extraDependsOn = [] },
) {
  const artifact = artifacts.get(artifactId);
  if (
    artifact?.command !== nextActionCommand ||
    artifact.path !== artifactPath ||
    artifact.phaseLocalNextAction?.id !== phaseId ||
    artifact.phaseLocalNextAction?.canonicalPath !== nextActionPath ||
    artifact.phaseLocalNextAction?.outputPath !== artifactPath ||
    (sequenceStage === undefined
      ? artifact.phaseLocalNextAction?.sequenceStage !== undefined
      : artifact.phaseLocalNextAction?.sequenceStage !== sequenceStage) ||
    !Array.isArray(artifact.dependsOn) ||
    !nextActionTerminalDependsOn.every((dependency) =>
      artifact.dependsOn.includes(dependency),
    ) ||
    !extraDependsOn.every((dependency) => artifact.dependsOn.includes(dependency))
  ) {
    throw new Error(
      `spine manifest phase-local next-action artifact drifted: ${artifactId}`,
    );
  }
}

export async function writeDevTestGameSpineManifest({
  generatedAt = new Date().toISOString(),
} = {}) {
  const proofFreshness = await readLocalProofFreshness();
  const adminSpineProof = await readLocalAdminSpineProof();
  const proofRunContract = await readProofRunContractStatus();
  const manifest = buildDevTestGameSpineManifest({
    generatedAt,
    proofFreshness,
    adminSpineProof,
    proofRunContract,
  });
  await mkdir(path.dirname(manifestJsonPath), { recursive: true });
  await writeFile(manifestJsonPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(manifestMarkdownPath, markdownSpineManifest(manifest));
  return manifest;
}

async function readProofRunContractStatus({
  proofPath = devTestGameProofRunPath,
  sessionPath = devTestGameSessionPath,
} = {}) {
  try {
    const [proof, session] = await Promise.all([
      readJson(path.join(repoRoot, proofPath)),
      readJson(path.join(repoRoot, sessionPath)),
    ]);
    assertDevTestGameProofRun(proof);
    const expected = buildDevTestGameProofRun(session, {
      generatedAt: proof.generatedAt,
    });
    if (JSON.stringify(proof) !== JSON.stringify(expected)) {
      return {
        status: "failed",
        proofPath,
        sessionPath,
        reason: "proof-run-session-mismatch",
        message: `${proofPath} is stale or does not match ${sessionPath}`,
      };
    }
    return {
      status: "passed",
      proofPath,
      sessionPath,
    };
  } catch (error) {
    return {
      status: "failed",
      proofPath,
      sessionPath,
      reason: "proof-run-contract-error",
      message: error?.message ?? String(error),
    };
  }
}

function assertPlanScripts(plan, expectedScripts) {
  const actual = plan.map((step) => step.script);
  if (JSON.stringify(actual) !== JSON.stringify(expectedScripts)) {
    throw new Error(
      `spine manifest plan drifted: expected ${expectedScripts.join(", ")}, got ${actual.join(", ")}`,
    );
  }
}

function recoveryReceiptManifestCommands() {
  return Object.fromEntries(
    recoveryReceiptGraphDescriptors.map((descriptor) => [
      descriptor.receiptKey,
      {
        script: descriptor.proofCommand,
        proofArtifact: descriptor.proofTarget,
        dependsOn: [...descriptor.manifestDependsOn],
        roleUrl: descriptor.roleUrl,
      },
    ]),
  );
}

function assertRecoveryReceiptManifestCommands(commands) {
  for (const descriptor of recoveryReceiptGraphDescriptors) {
    const command = commands[descriptor.receiptKey];
    if (command?.script !== descriptor.proofCommand) {
      throw new Error(
        `spine manifest ${descriptor.receiptKey} command drifted: ${command?.script}`,
      );
    }
    if (command.proofArtifact !== descriptor.proofTarget) {
      throw new Error(
        `spine manifest ${descriptor.receiptKey} artifact drifted: ${command.proofArtifact}`,
      );
    }
    if (
      JSON.stringify(command.dependsOn) !==
      JSON.stringify(descriptor.manifestDependsOn)
    ) {
      throw new Error(
        `spine manifest ${descriptor.receiptKey} dependency drifted`,
      );
    }
    if (command.roleUrl !== descriptor.roleUrl) {
      throw new Error(
        `spine manifest ${descriptor.receiptKey} role URL drifted: ${command.roleUrl}`,
      );
    }
  }
}

function clonePlan(plan) {
  return plan.map((step) => ({
    ...step,
    ...(step.env === undefined ? {} : { env: { ...step.env } }),
    ...(step.preconditions === undefined
      ? {}
      : {
          preconditions: step.preconditions.map((precondition) => ({
            ...precondition,
          })),
        }),
  }));
}

function cloneAdminProofPlan(plan) {
  return plan.map(({ id, label, script, path }) => ({ id, label, script, path }));
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function envValues(env) {
  return Object.values(env ?? {}).filter((value) => typeof value === "string");
}

function uniqueSorted(values) {
  return Array.from(new Set(values)).sort();
}

function buildArtifactFreshnessReport(
  proofFreshness,
  { recoveryCommands = new Map(), proofRunContract } = {},
) {
  if (proofFreshness === undefined || proofFreshness === null) {
    return {
      status: proofRunContract?.status === "failed" ? "blocked" : "unknown",
      proof: "dev-test-game-proof-freshness",
      proofCommand: proofFreshnessAdminProofCommand,
      proofArtifact: proofFreshnessAdminProofPath,
      nextCommand:
        proofRunContract?.status === "failed"
          ? artifactRefreshCommands["proof-run"]
          : proofFreshnessAdminProofCommand,
      proofBoundary:
        "No local proof freshness dashboard was readable while generating this manifest.",
      proofRunContract,
      summary: artifactFreshnessSummary(
        proofRunContract?.status === "failed"
          ? [proofRunContractArtifact(proofRunContract)]
          : [],
      ),
      artifacts:
        proofRunContract?.status === "failed"
          ? [proofRunContractArtifact(proofRunContract)]
          : [],
    };
  }
  const artifacts = applyProofRunContract(
    (proofFreshness.artifacts ?? []).map((artifact) => {
      const recoveryCommand =
        recoveryCommands.get(artifact.id) ?? recoveryCommands.get(artifact.path);
      const refreshCommand = recoveryCommand ?? refreshCommandForArtifact(artifact);
      return {
        id: artifact.id,
        label: artifact.label,
        path: artifact.path,
        status: artifact.status,
        ...(artifact.mtime === undefined ? {} : { mtime: artifact.mtime }),
        ...(artifact.ageSeconds === undefined
          ? {}
          : { ageSeconds: artifact.ageSeconds }),
        ...(artifact.maxAgeSeconds === undefined
          ? {}
          : { maxAgeSeconds: artifact.maxAgeSeconds }),
        refreshCommand,
        refreshSource:
          recoveryCommand === undefined ? "manifest-default" : "admin-spine-recovery",
        ...(artifact.status === "fresh" ? {} : { nextCommand: refreshCommand }),
      };
    }),
    proofRunContract,
  );
  const status =
    proofRunContract?.status === "failed" ? "blocked" : proofFreshness.status;
  return {
    status,
    proof: proofFreshness.proof,
    generatedAt: proofFreshness.generatedAt,
    maxAgeHours: proofFreshness.maxAgeHours,
    summary: artifactFreshnessSummary(artifacts),
    proofRunContract,
    proofCommand: proofFreshnessAdminProofCommand,
    proofArtifact: proofFreshnessAdminProofPath,
    nextCommand:
      status === "passed"
        ? proofFreshnessAdminProofCommand
        : firstNextCommand(artifacts) ?? proofFreshnessAdminProofCommand,
    proofBoundary: proofFreshness.proofBoundary,
    artifacts,
  };
}

function artifactFreshnessSummary(artifacts) {
  return {
    artifactCount: artifacts.length,
    freshCount: artifacts.filter((artifact) => artifact.status === "fresh").length,
    staleCount: artifacts.filter((artifact) => artifact.status === "stale").length,
    missingCount: artifacts.filter((artifact) => artifact.status === "missing").length,
  };
}

function applyProofRunContract(artifacts, proofRunContract) {
  if (proofRunContract?.status !== "failed") {
    return artifacts;
  }
  const proofRunIndex = artifacts.findIndex(
    (artifact) =>
      artifact.id === "proof-run" || artifact.path === proofRunContract.proofPath,
  );
  const staleArtifact = proofRunContractArtifact(proofRunContract);
  if (proofRunIndex === -1) {
    return [staleArtifact, ...artifacts];
  }
  return artifacts.map((artifact, index) =>
    index === proofRunIndex ? { ...artifact, ...staleArtifact } : artifact,
  );
}

function proofRunContractArtifact(proofRunContract) {
  return {
    id: "proof-run",
    label: "Proof run and session contract",
    path: proofRunContract.proofPath ?? devTestGameProofRunPath,
    status: "stale",
    refreshCommand: artifactRefreshCommands["proof-run"],
    refreshSource: "manifest-default",
    nextCommand: artifactRefreshCommands["proof-run"],
    contractStatus: proofRunContract.status,
    contractReason: proofRunContract.reason,
    contractMessage: proofRunContract.message,
    sessionPath: proofRunContract.sessionPath,
  };
}

function recoveryCommandsFromAdminSpineProof(adminSpineProof) {
  const commands = new Map();
  for (const surface of adminSpineProof?.recovery?.surfaces ?? []) {
    if (typeof surface.rerunCommand !== "string" || surface.rerunCommand.trim() === "") {
      continue;
    }
    if (typeof surface.id === "string" && surface.id.trim() !== "") {
      commands.set(surface.id, surface.rerunCommand);
    }
    if (typeof surface.path === "string" && surface.path.trim() !== "") {
      commands.set(surface.path, surface.rerunCommand);
    }
  }
  return commands;
}

function assertArtifactFreshnessReport(report) {
  if (!["passed", "blocked", "unknown"].includes(report?.status)) {
    throw new Error(`spine manifest artifact freshness status drifted: ${report?.status}`);
  }
  if (report.proofCommand !== proofFreshnessAdminProofCommand) {
    throw new Error(
      `spine manifest artifact freshness proof command drifted: ${report.proofCommand}`,
    );
  }
  if (report.proofArtifact !== proofFreshnessAdminProofPath) {
    throw new Error(
      `spine manifest artifact freshness proof artifact drifted: ${report.proofArtifact}`,
    );
  }
  for (const artifact of report.artifacts ?? []) {
    if (typeof artifact.id !== "string" || artifact.id.trim() === "") {
      throw new Error("spine manifest artifact freshness entry is missing an id");
    }
    if (typeof artifact.refreshCommand !== "string" || artifact.refreshCommand === "") {
      throw new Error(`spine manifest artifact ${artifact.id} is missing refresh command`);
    }
    if (!["manifest-default", "admin-spine-recovery"].includes(artifact.refreshSource)) {
      throw new Error(
        `spine manifest artifact ${artifact.id} has invalid refresh source: ${artifact.refreshSource}`,
      );
    }
    if (artifact.status !== "fresh" && artifact.nextCommand !== artifact.refreshCommand) {
      throw new Error(`spine manifest artifact ${artifact.id} is missing next command`);
    }
  }
}

function assertLocalLiveWrapperScript({ manifest, commandId, script, localScript }) {
  const command = manifest.commands?.[commandId];
  if (command?.script !== script) {
    throw new Error(
      `spine manifest ${commandId} script drifted: ${command?.script}`,
    );
  }
  if (command.localScript !== localScript) {
    throw new Error(
      `spine manifest ${commandId} local script drifted: ${command.localScript}`,
    );
  }
  if (command.localScript === command.script) {
    throw new Error(`spine manifest ${commandId} local script must wrap script`);
  }
}

function firstNextCommand(artifacts) {
  return artifacts.find((artifact) => artifact.nextCommand)?.nextCommand;
}

function refreshCommandForArtifact(artifact) {
  return (
    artifactRefreshCommands[artifact.id] ??
    artifactRefreshCommands[artifact.path] ??
    "npm run test:dev-test-game-admin-spine"
  );
}

const localDatabasePrefix = "DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch";
const devTestGameHostSetupProofPath =
  "target/dev-test-game/host-setup-proof.json";

const artifactRefreshCommands = Object.freeze({
  session: "npm run test:dev-test-game-core-live:local",
  "proof-run": "npm run test:dev-test-game-core-live:local",
  "backup-restore": "npm run test:dev-test-game-backup-restore",
  "ops-artifacts": "npm run test:dev-test-game-ops",
  "seed-fixture": "npm run test:dev-test-game-seed-fixture",
  "release-readiness": "npm run test:dev-test-game-readiness",
  "race-coverage": "npm run test:dev-test-game-race-coverage",
  "race-coverage-admin": "npm run test:dev-test-game-race-coverage-admin-proof",
  "hosted-concurrent-race-matrix":
    "npm run test:dev-test-game-hosted-concurrent-race-matrix",
  "hosted-identity-evidence":
    "npm run test:dev-test-game-hosted-identity-evidence",
  "hosted-identity-progression-summary":
    "npm run test:dev-test-game-hosted-identity-progression-summary",
  [devTestGameHostedIdentityProgressionSummaryPath]:
    "npm run test:dev-test-game-hosted-identity-progression-summary",
  ...Object.fromEntries(
    hostedAdminHandoffProofArtifactCases.flatMap((artifactCase) => [
      [artifactCase.refreshId, artifactCase.command],
      [artifactCase.path, artifactCase.command],
    ]),
  ),
  "hosted-target-preflight": "npm run test:dev-test-game-hosted-target-preflight",
  "hosted-evidence-lane": "npm run test:dev-test-game-hosted-evidence-lane",
  "hosted-evidence-lane-demo":
    "npm run test:dev-test-game-hosted-evidence-lane-demo-proof",
  "hosted-matrix-raw-evidence-fixture-proof":
    "npm run test:dev-test-game-hosted-matrix-raw-evidence-fixture-proof",
  [devTestGameHostedMatrixRawEvidenceFixtureProofPath]:
    "npm run test:dev-test-game-hosted-matrix-raw-evidence-fixture-proof",
  "hosted-evidence-lane-operator-fixture":
    "npm run test:dev-test-game-hosted-evidence-lane-operator-fixture-admin-proof",
  [devTestGameHostedEvidenceLaneOperatorFixtureAdminProofPath]:
    "npm run test:dev-test-game-hosted-evidence-lane-operator-fixture-admin-proof",
  "real-hosted-matrix-raw-capture":
    "npm run test:dev-test-game-real-hosted-matrix-raw-capture",
  [devTestGameRealHostedMatrixRawCapturePath]:
    "npm run test:dev-test-game-real-hosted-matrix-raw-capture",
  "hosted-evidence-lane-real-capture-admin-proof":
    devTestGameHostedEvidenceLaneRealCaptureAdminProofCommand,
  [devTestGameHostedEvidenceLaneRealCaptureAdminProofPath]:
    devTestGameHostedEvidenceLaneRealCaptureAdminProofCommand,
  [devTestGameHostedEvidenceLaneRealCaptureSourcePath]:
    devTestGameHostedEvidenceLaneRealCaptureAdminProofCommand,
  "hosted-ops-signals": "npm run test:dev-test-game-hosted-ops-signals",
  "hosted-ops-signals-admin":
    "npm run test:dev-test-game-hosted-ops-signals-admin-proof",
  "release-runbook": "npm run test:dev-test-game-release-runbook",
  "release-runbook-admin": "npm run test:dev-test-game-release-runbook-admin-proof",
  "release-admin-proof-contract":
    "npm run test:dev-test-game-release-admin-proof-contract",
  [devTestGameReleaseAdminProofContractPath]:
    "npm run test:dev-test-game-release-admin-proof-contract",
  "identity-adapter": `${localDatabasePrefix} npm run test:dev-test-game-identity`,
  "spine-manifest": "npm run test:dev-test-game-spine-manifest",
  "core-loop": "npm run test:dev-test-game-core-loop-admin-proof",
  hardening: "npm run test:dev-test-game-hardening-admin-proof",
  identity: "npm run test:dev-test-game-identity-admin-proof",
  backup: "npm run test:dev-test-game-backup-admin-proof",
  ops: "npm run test:dev-test-game-ops-admin-proof",
  seed: "npm run test:dev-test-game-seed-admin-proof",
  "host-setup-role": devTestGameHostSetupProofCommand,
  [devTestGameHostSetupProofPath]: devTestGameHostSetupProofCommand,
  "host-setup-admin": "npm run test:dev-test-game-host-setup-admin-proof",
  [devTestGameHostSetupAdminProofPath]:
    "npm run test:dev-test-game-host-setup-admin-proof",
  release: "npm run test:dev-test-game-release-admin-proof",
  "spine-manifest-admin": "npm run test:dev-test-game-spine-manifest-admin-proof",
  "admin-spine": "npm run test:dev-test-game-admin-spine",
  "admin-spine-admin": "npm run test:dev-test-game-admin-spine",
  "proof-graph": "npm run test:dev-test-game-proof-graph",
  "proof-graph-admin": "npm run test:dev-test-game-proof-graph-admin-proof",
});

function markdownSpineManifest(manifest) {
  const lines = [
    "# fmarch Dev Test Game Spine Manifest",
    "",
    `- status: ${manifest.status}`,
    `- releaseReady: ${manifest.releaseReady}`,
    `- productionReady: ${manifest.productionReady}`,
    `- generatedAt: ${manifest.generatedAt}`,
    "",
    manifest.proofBoundary,
    "",
    "## Commands",
    "",
    "| Command | Script | Local Script | Steps |",
    "| --- | --- | --- | ---: |",
  ];
  for (const [id, command] of Object.entries(manifest.commands)) {
    lines.push(
      `| ${id} | ${command.script ?? ""} | ${command.localScript ?? ""} | ${command.plan?.length ?? 1} |`,
    );
  }
  lines.push("", "## Core Live Spine", "", "| Step | Kind | Script |", "| ---: | --- | --- |");
  manifest.commands.coreLive.plan.forEach((step, index) => {
    lines.push(`| ${index + 1} | ${step.kind} | ${step.script} |`);
  });
  lines.push("", "## Full Live Spine", "", "| Step | Kind | Script |", "| ---: | --- | --- |");
  manifest.commands.live.plan.forEach((step, index) => {
    lines.push(`| ${index + 1} | ${step.kind} | ${step.script} |`);
  });
  lines.push(
    "",
    "## Terminal Artifacts",
    "",
    "| Artifact | Command | Boundary |",
    "| --- | --- | --- |",
  );
  for (const artifact of manifest.terminalArtifacts ?? []) {
    lines.push(`| ${artifact.id} | ${artifact.command} | ${artifact.boundary} |`);
  }
  lines.push(
    "",
    "## Artifact Freshness",
    "",
    `- status: ${manifest.artifactFreshness.status}`,
    `- nextCommand: ${manifest.artifactFreshness.nextCommand}`,
    "",
    "| Artifact | Status | Refresh Command |",
    "| --- | --- | --- |",
  );
  for (const artifact of manifest.artifactFreshness.artifacts) {
    lines.push(`| ${artifact.id} | ${artifact.status} | ${artifact.refreshCommand} |`);
  }
  lines.push(
    "",
    "## Production Feature Provenance",
    "",
    `- featureCount: ${manifest.productionFeatureProvenanceSummary.featureCount}`,
    `- sourceCheckCount: ${manifest.productionFeatureProvenanceSummary.sourceCheckCount}`,
    `- selectedProofArtifacts: ${manifest.productionFeatureProvenanceSummary.selectedProofArtifacts.length}`,
    "",
    "| Source Check | Features | Proof Artifacts |",
    "| --- | ---: | --- |",
  );
  for (const group of manifest.productionFeatureProvenanceSummary.sourceCheckGroups) {
    lines.push(
      `| ${group.sourceCheckId} | ${group.featureCount} | ${group.selectedProofArtifacts.join("<br>")} |`,
    );
  }
  lines.push("", "## Artifacts", "");
  for (const artifact of manifest.artifacts) {
    lines.push(`- ${artifact}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  const manifest = await writeDevTestGameSpineManifest();
  console.log(`wrote ${spineManifestPath} (${manifest.status})`);
  console.log(`wrote ${spineManifestMarkdownPath} (${manifest.status})`);
}
