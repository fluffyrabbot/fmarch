import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  readLocalAdminSpineProof,
  readLocalProofFreshness,
} from "../frontend/src/lib/server/local-ops-artifacts.mjs";
import {
  adminSpineProofPath,
  adminSpineReadinessEvidenceEnv,
  adminSpineTerminalBatchProofPath,
  adminSpineTerminalBatchReadinessEvidenceEnv,
} from "./dev_test_game_admin_spine.mjs";
import { devTestGameAdminSpineProofPlan } from "./dev_test_game_admin_spine_proof.mjs";
import {
  devTestGameProofGraphAdminProofCommand,
  devTestGameProofGraphAdminProofPath,
  devTestGameProofGraphCommand,
  devTestGameProofGraphPath,
} from "./dev_test_game_proof_graph_paths.mjs";
import {
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
} from "./dev_test_game_hosted_identity_evidence.mjs";
import {
  devTestGameHostedEvidenceLaneCommand,
  devTestGameHostedEvidenceLanePath,
} from "./dev_test_game_hosted_evidence_lane.mjs";
import {
  devTestGameHostedEvidenceLaneDemoBlockedPath,
  devTestGameHostedEvidenceLaneDemoExternalEvidencePath,
  devTestGameHostedEvidenceLaneDemoPassedPath,
  devTestGameHostedEvidenceLaneDemoProofCommand,
  devTestGameHostedEvidenceLaneDemoProofPath,
  devTestGameHostedEvidenceLaneDemoRawEvidencePath,
} from "./dev_test_game_hosted_evidence_lane_demo_proof.mjs";
import {
  devTestGameHostedOpsSignalsCommand,
  devTestGameHostedOpsSignalsPath,
} from "./dev_test_game_hosted_ops_signals.mjs";
import {
  devTestGameRealHostedObservabilityHandoffCommand,
  devTestGameRealHostedObservabilityHandoffPath,
} from "./dev_test_game_real_hosted_observability_handoff.mjs";
import {
  devTestGameHostedTargetPreflightCommand,
  devTestGameHostedTargetPreflightPath,
} from "./dev_test_game_hosted_target_preflight.mjs";
import {
  devTestGameReleaseRunbookCommand,
  devTestGameReleaseRunbookPath,
} from "./dev_test_game_release_runbook.mjs";
import {
  backupAwareOpsEnv,
  backupRestoreEvidenceEnv,
  backupRestoreFinalReadinessEnv,
  devTestGameBackupRestoreSpinePlan,
  opsReadinessEnv,
  seedReadinessEnv,
} from "./dev_test_game_backup_restore_spine.mjs";
import {
  devTestGameIdentitySpinePlan,
  identityReadinessEnv,
} from "./dev_test_game_identity_spine.mjs";
import {
  devTestGameCoreLiveSpinePlan,
  devTestGameLiveSpinePlan,
} from "./dev_test_game_live_spine.mjs";
import {
  devTestGamePrivateChannelRecoveryReceiptCommand,
  devTestGamePrivateChannelRecoveryReceiptPath,
  devTestGamePrivateChannelRecoveryReceiptRoleUrl,
} from "./dev_test_game_private_channel_recovery_receipt.mjs";
import {
  devTestGameReplacementPrivateRecoveryReceiptCommand,
  devTestGameReplacementPrivateRecoveryReceiptPath,
  devTestGameReplacementPrivateRecoveryReceiptRoleUrl,
} from "./dev_test_game_replacement_private_recovery_receipt.mjs";
import {
  devTestGameReplacementActionRecoveryReceiptCommand,
  devTestGameReplacementActionRecoveryReceiptPath,
  devTestGameReplacementActionRecoveryReceiptRoleUrl,
} from "./dev_test_game_replacement_action_recovery_receipt.mjs";
import {
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
import { repoRoot } from "./dev_test_game_spine_runner.mjs";

export const DEV_TEST_GAME_SPINE_MANIFEST_VERSION = 1;

export const spineManifestPath = "target/dev-test-game/spine-manifest.json";
export const spineManifestMarkdownPath = "target/dev-test-game/spine-manifest.md";
export {
  nextActionAdminProofCommand,
  nextActionAdminProofPath,
  nextActionCommand,
  nextActionPath,
  proofFreshnessAdminProofCommand,
  proofFreshnessAdminProofPath,
};

const manifestJsonPath = path.join(repoRoot, spineManifestPath);
const manifestMarkdownPath = path.join(repoRoot, spineManifestMarkdownPath);

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
        plan: clonePlan(devTestGameCoreLiveSpinePlan),
      },
      live: {
        script: "test:dev-test-game-live",
        plan: clonePlan(devTestGameLiveSpinePlan),
      },
      backupRestore: {
        script: "test:dev-test-game-backup-restore",
        plan: clonePlan(devTestGameBackupRestoreSpinePlan),
      },
      identity: {
        script: "test:dev-test-game-identity",
        plan: clonePlan(devTestGameIdentitySpinePlan),
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
          "target/dev-test-game/release-readiness-checklist.json",
        ],
      },
      raceCoverage: {
        script: devTestGameRaceCoverageCommand,
        proofArtifact: devTestGameRaceCoveragePath,
        dependsOn: ["target/dev-test-game/proof-run.json"],
      },
      hostedConcurrentRaceMatrix: {
        script: devTestGameHostedConcurrentRaceMatrixCommand,
        proofArtifact: devTestGameHostedConcurrentRaceMatrixPath,
        dependsOn: [
          "target/dev-test-game/release-readiness-checklist.json",
          devTestGameRaceCoveragePath,
        ],
      },
      hostedIdentityEvidence: {
        script: devTestGameHostedIdentityEvidenceCommand,
        proofArtifact: devTestGameHostedIdentityEvidencePath,
        dependsOn: [
          "target/auth-invite-role-proof/invite-role-proof.json",
          "target/dev-test-game/identity-admin-proof.json",
        ],
        roleUrl: "/admin/audit/local-identity-adapter?game=<seeded-game>",
      },
      hostedIdentityEvidenceAdminProof: {
        script: "test:dev-test-game-hosted-identity-evidence-admin-proof",
        proofArtifact:
          "target/dev-test-game/hosted-identity-evidence-admin-proof.json",
        dependsOn: [
          devTestGameHostedIdentityEvidencePath,
          "target/dev-test-game/proof-run.json",
        ],
        roleUrl:
          "/admin/audit/local-hosted-identity-evidence?game=<seeded-game>",
      },
      hostedOpsSignals: {
        script: devTestGameHostedOpsSignalsCommand,
        proofArtifact: devTestGameHostedOpsSignalsPath,
        dependsOn: [
          "target/dev-test-game/ops-artifacts.json",
          "target/dev-test-game/release-readiness-checklist.json",
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
        script:
          "test:dev-test-game-real-hosted-observability-handoff-admin-proof",
        proofArtifact:
          "target/dev-test-game/real-hosted-observability-handoff-admin-proof.json",
        dependsOn: [devTestGameRealHostedObservabilityHandoffPath],
        roleUrl:
          "/admin/audit/local-real-hosted-observability-handoff?game=<seeded-game>",
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
      hostedEvidenceLaneDemoProof: {
        script: devTestGameHostedEvidenceLaneDemoProofCommand,
        proofArtifact: devTestGameHostedEvidenceLaneDemoProofPath,
        dependsOn: [devTestGameHostedConcurrentRaceMatrixPath],
        demoOnly: true,
        roleUrl: "/admin/audit/local-hosted-evidence-lane?game=<seeded-game>",
      },
      privateChannelRecoveryReceipt: {
        script: devTestGamePrivateChannelRecoveryReceiptCommand,
        proofArtifact: devTestGamePrivateChannelRecoveryReceiptPath,
        dependsOn: [
          "target/dev-test-game/proof-run.json",
          "target/dev-test-game/core-loop-admin-proof.json",
        ],
        roleUrl: devTestGamePrivateChannelRecoveryReceiptRoleUrl,
      },
      replacementActionRecoveryReceipt: {
        script: devTestGameReplacementActionRecoveryReceiptCommand,
        proofArtifact: devTestGameReplacementActionRecoveryReceiptPath,
        dependsOn: [
          "target/dev-test-game/proof-run.json",
          "target/dev-test-game/hardening-admin-proof.json",
        ],
        roleUrl: devTestGameReplacementActionRecoveryReceiptRoleUrl,
      },
      replacementPrivateRecoveryReceipt: {
        script: devTestGameReplacementPrivateRecoveryReceiptCommand,
        proofArtifact: devTestGameReplacementPrivateRecoveryReceiptPath,
        dependsOn: [
          "target/dev-test-game/proof-run.json",
          "target/dev-test-game/hardening-admin-proof.json",
        ],
        roleUrl: devTestGameReplacementPrivateRecoveryReceiptRoleUrl,
      },
      releaseRunbook: {
        script: devTestGameReleaseRunbookCommand,
        proofArtifact: devTestGameReleaseRunbookPath,
        dependsOn: ["target/dev-test-game/release-readiness-checklist.json"],
        roleUrl: "/admin/audit/local-release-runbook?game=<seeded-game>",
      },
      nextAction: {
        script: nextActionCommand,
        proofArtifact: nextActionPath,
        dependsOn: [
          spineManifestPath,
          "target/dev-test-game/ops-artifacts.json",
          "target/dev-test-game/release-readiness-checklist.json",
          devTestGameRaceCoveragePath,
          devTestGameHostedConcurrentRaceMatrixPath,
          devTestGameHostedTargetPreflightPath,
          devTestGameHostedEvidenceLanePath,
          devTestGameHostedEvidenceLaneDemoProofPath,
        ],
      },
      nextActionAdminProof: {
        script: nextActionAdminProofCommand,
        proofArtifact: nextActionAdminProofPath,
        dependsOn: [
          nextActionPath,
          "target/dev-test-game/proof-run.json",
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
          "target/dev-test-game/proof-run.json",
        ],
        roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.proofGraph),
      },
    },
    evidenceEnv,
    artifactFreshness: buildArtifactFreshnessReport(proofFreshness, {
      recoveryCommands: adminSpineRecoveryCommands,
      proofRunContract,
    }),
    terminalArtifacts: [
      {
        id: "next-action",
        label: "Next action receipt",
        command: nextActionCommand,
        path: nextActionPath,
        dependsOn: [
          spineManifestPath,
          "target/dev-test-game/ops-artifacts.json",
          "target/dev-test-game/release-readiness-checklist.json",
          devTestGameRaceCoveragePath,
          devTestGameHostedConcurrentRaceMatrixPath,
          devTestGameHostedTargetPreflightPath,
          devTestGameHostedEvidenceLanePath,
          devTestGameHostedEvidenceLaneDemoProofPath,
        ],
        boundary:
          "Terminal local receipt that chooses one upstream freshness, harness-stability, or recovery command from the manifest, ops artifacts, release-readiness checklist, and race coverage milestone.",
      },
      {
        id: "next-action-admin-proof",
        label: "Next action admin proof",
        command: nextActionAdminProofCommand,
        path: nextActionAdminProofPath,
        dependsOn: [
          nextActionPath,
          "target/dev-test-game/proof-run.json",
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
          "target/dev-test-game/proof-run.json",
        ],
        roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.proofGraph),
        boundary:
          "Terminal local admin role proof for the generated proof graph detail route and graph-to-admin-spine coverage invariant.",
      },
    ],
    artifacts: uniqueSorted([
      spineManifestPath,
      spineManifestMarkdownPath,
      adminSpineProofPath,
      proofFreshnessAdminProofPath,
      nextActionPath,
      nextActionAdminProofPath,
      devTestGameHostedConcurrentRaceMatrixPath,
      devTestGameHostedIdentityEvidencePath,
      "target/dev-test-game/hosted-identity-evidence-admin-proof.json",
      devTestGameHostedTargetPreflightPath,
      devTestGameHostedEvidenceLanePath,
      devTestGameHostedEvidenceLaneDemoProofPath,
      devTestGameHostedEvidenceLaneDemoRawEvidencePath,
      devTestGameHostedEvidenceLaneDemoExternalEvidencePath,
      devTestGameHostedEvidenceLaneDemoBlockedPath,
      devTestGameHostedEvidenceLaneDemoPassedPath,
      devTestGamePrivateChannelRecoveryReceiptPath,
      devTestGameReplacementActionRecoveryReceiptPath,
      devTestGameReplacementPrivateRecoveryReceiptPath,
      devTestGameHostedOpsSignalsPath,
      devTestGameRealHostedObservabilityHandoffPath,
      devTestGameReleaseRunbookPath,
      devTestGameProofGraphPath,
      devTestGameProofGraphAdminProofPath,
      ...devTestGameAdminSpineProofPlan.map((step) => step.path),
      ...envValues(evidenceEnv.backupRestore.backupRestoreEvidenceEnv),
      ...envValues(evidenceEnv.backupRestore.backupAwareOpsEnv),
      ...envValues(evidenceEnv.backupRestore.opsReadinessEnv),
      ...envValues(evidenceEnv.backupRestore.seedReadinessEnv),
      ...envValues(evidenceEnv.backupRestore.backupRestoreFinalReadinessEnv),
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
          "test:dev-test-game-identity",
          "test:dev-test-game-admin-spine",
        ],
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
        id: "hosted-identity-evidence-admin-proof-recorded",
        status: "passed",
        evidence: [
          "test:dev-test-game-hosted-identity-evidence-admin-proof",
          "target/dev-test-game/hosted-identity-evidence-admin-proof.json",
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
        id: "release-runbook-recorded",
        status: "passed",
        evidence: [devTestGameReleaseRunbookCommand, devTestGameReleaseRunbookPath],
      },
      {
        id: "terminal-artifacts-recorded",
        status: "passed",
        evidence: [
          nextActionPath,
          nextActionAdminProofPath,
          devTestGameProofGraphPath,
          devTestGameProofGraphAdminProofPath,
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
  const coreLivePlan = manifest.commands?.coreLive?.plan ?? [];
  assertPlanScripts(coreLivePlan, [
    "dev:test-game:prebuild",
    "tools/dev_test_game_live_proof.mjs",
    "tools/dev_test_game_proof_contract.mjs",
    "tools/dev_test_game_core_loop_admin_proof.mjs",
    "tools/dev_test_game_private_channel_recovery_receipt.mjs",
    "tools/dev_test_game_hardening_admin_proof.mjs",
    "tools/dev_test_game_replacement_action_recovery_receipt.mjs",
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
    "tools/dev_test_game_release_readiness.mjs",
    "tools/dev_test_game_ops_artifacts.mjs",
    "tools/dev_test_game_release_readiness.mjs",
    "tools/dev_test_game_seed_fixture_summary.mjs",
    "tools/dev_test_game_seed_admin_proof.mjs",
    "tools/dev_test_game_backup_admin_proof.mjs",
    "tools/dev_test_game_release_readiness.mjs",
  ]);
  assertPlanScripts(manifest.commands?.identity?.plan ?? [], [
    "tools/auth_invite_role_proof.mjs",
    "tools/dev_test_game_identity_admin_proof.mjs",
    "tools/dev_test_game_hosted_identity_evidence.mjs",
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
    "tools/dev_test_game_release_admin_proof.mjs",
    "tools/dev_test_game_release_runbook_admin_proof.mjs",
    "tools/dev_test_game_race_coverage_admin_proof.mjs",
    "tools/dev_test_game_hosted_target_preflight_admin_proof.mjs",
    "tools/dev_test_game_hosted_evidence_lane_admin_proof.mjs",
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
    manifest.commands?.hostedIdentityEvidenceAdminProof?.script !==
    "test:dev-test-game-hosted-identity-evidence-admin-proof"
  ) {
    throw new Error(
      `spine manifest hosted identity evidence admin proof command drifted: ${manifest.commands?.hostedIdentityEvidenceAdminProof?.script}`,
    );
  }
  if (
    manifest.commands.hostedIdentityEvidenceAdminProof.proofArtifact !==
    "target/dev-test-game/hosted-identity-evidence-admin-proof.json"
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
    "test:dev-test-game-real-hosted-observability-handoff-admin-proof"
  ) {
    throw new Error(
      `spine manifest real hosted observability handoff admin proof command drifted: ${manifest.commands?.realHostedObservabilityHandoffAdminProof?.script}`,
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
    manifest.commands?.privateChannelRecoveryReceipt?.script !==
    devTestGamePrivateChannelRecoveryReceiptCommand
  ) {
    throw new Error(
      `spine manifest private-channel recovery command drifted: ${manifest.commands?.privateChannelRecoveryReceipt?.script}`,
    );
  }
  if (
    manifest.commands.privateChannelRecoveryReceipt.proofArtifact !==
    devTestGamePrivateChannelRecoveryReceiptPath
  ) {
    throw new Error(
      `spine manifest private-channel recovery artifact drifted: ${manifest.commands.privateChannelRecoveryReceipt.proofArtifact}`,
    );
  }
  if (
    manifest.commands?.replacementActionRecoveryReceipt?.script !==
    devTestGameReplacementActionRecoveryReceiptCommand
  ) {
    throw new Error(
      `spine manifest replacement action recovery command drifted: ${manifest.commands?.replacementActionRecoveryReceipt?.script}`,
    );
  }
  if (
    manifest.commands.replacementActionRecoveryReceipt.proofArtifact !==
    devTestGameReplacementActionRecoveryReceiptPath
  ) {
    throw new Error(
      `spine manifest replacement action recovery artifact drifted: ${manifest.commands.replacementActionRecoveryReceipt.proofArtifact}`,
    );
  }
  if (
    manifest.commands?.replacementPrivateRecoveryReceipt?.script !==
    devTestGameReplacementPrivateRecoveryReceiptCommand
  ) {
    throw new Error(
      `spine manifest replacement private recovery command drifted: ${manifest.commands?.replacementPrivateRecoveryReceipt?.script}`,
    );
  }
  if (
    manifest.commands.replacementPrivateRecoveryReceipt.proofArtifact !==
    devTestGameReplacementPrivateRecoveryReceiptPath
  ) {
    throw new Error(
      `spine manifest replacement private recovery artifact drifted: ${manifest.commands.replacementPrivateRecoveryReceipt.proofArtifact}`,
    );
  }
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
    "target/dev-test-game/admin-spine-proof.json",
    devTestGameRaceCoveragePath,
    proofFreshnessAdminProofPath,
    nextActionPath,
    nextActionAdminProofPath,
    devTestGameHostedConcurrentRaceMatrixPath,
    devTestGameHostedIdentityEvidencePath,
    "target/dev-test-game/hosted-identity-evidence-admin-proof.json",
    devTestGameHostedTargetPreflightPath,
    devTestGameHostedEvidenceLanePath,
    devTestGameHostedEvidenceLaneDemoProofPath,
    devTestGameHostedEvidenceLaneDemoRawEvidencePath,
    devTestGameHostedEvidenceLaneDemoExternalEvidencePath,
    devTestGameHostedEvidenceLaneDemoBlockedPath,
    devTestGameHostedEvidenceLaneDemoPassedPath,
    devTestGameHostedOpsSignalsPath,
    devTestGameRealHostedObservabilityHandoffPath,
    devTestGameReleaseRunbookPath,
    devTestGameProofGraphPath,
    devTestGameProofGraphAdminProofPath,
    "target/dev-test-game/core-loop-admin-proof.json",
    "target/dev-test-game/hardening-admin-proof.json",
    "target/dev-test-game/identity-admin-proof.json",
    "target/dev-test-game/release-admin-proof.json",
    "target/dev-test-game/release-runbook-admin-proof.json",
    "target/dev-test-game/hosted-target-preflight-admin-proof.json",
    "target/dev-test-game/hosted-concurrent-race-matrix-admin-proof.json",
    "target/dev-test-game/hosted-ops-signals-admin-proof.json",
    "target/dev-test-game/real-hosted-observability-handoff-admin-proof.json",
    "target/dev-test-game/spine-manifest-admin-proof.json",
    "target/dev-test-game/admin-spine-admin-proof.json",
    "target/live-stack-backup-restore-drill/local-backup-restore-proof.json",
    "target/live-stack-backup-restore-drill/local-live-stack.dump",
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
    "evidence-env-wiring-recorded",
    "freshness-proof-recorded",
    "artifact-refresh-status-recorded",
    "race-coverage-recorded",
    "hosted-concurrent-race-matrix-recorded",
    "hosted-identity-evidence-recorded",
    "hosted-identity-evidence-admin-proof-recorded",
    "hosted-target-preflight-recorded",
    "hosted-evidence-lane-recorded",
    "hosted-evidence-lane-demo-proof-recorded",
    "hosted-ops-signals-recorded",
    "release-runbook-recorded",
    "terminal-artifacts-recorded",
    "release-boundary-carried",
  ]) {
    if (checks.get(id) !== "passed") {
      throw new Error(`spine manifest missing passed check: ${id}`);
    }
  }
  return manifest;
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
    !nextAction.dependsOn.includes("target/dev-test-game/ops-artifacts.json") ||
    !nextAction.dependsOn.includes("target/dev-test-game/release-readiness-checklist.json") ||
    !nextAction.dependsOn.includes(devTestGameRaceCoveragePath) ||
    !nextAction.dependsOn.includes(devTestGameHostedConcurrentRaceMatrixPath) ||
    !nextAction.dependsOn.includes(devTestGameHostedTargetPreflightPath) ||
    !nextAction.dependsOn.includes(devTestGameHostedEvidenceLanePath) ||
    !nextAction.dependsOn.includes(devTestGameHostedEvidenceLaneDemoProofPath)
  ) {
    throw new Error("spine manifest next-action terminal artifact drifted");
  }
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
  proofPath = "target/dev-test-game/proof-run.json",
  sessionPath = "target/dev-test-game/session.json",
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

function clonePlan(plan) {
  return plan.map((step) => ({
    ...step,
    ...(step.env === undefined ? {} : { env: { ...step.env } }),
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
    path: proofRunContract.proofPath ?? "target/dev-test-game/proof-run.json",
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

const artifactRefreshCommands = Object.freeze({
  session: `${localDatabasePrefix} npm run test:dev-test-game-core-live`,
  "proof-run": `${localDatabasePrefix} npm run test:dev-test-game-core-live`,
  "backup-restore": "npm run test:dev-test-game-backup-restore",
  "ops-artifacts": "npm run test:dev-test-game-ops",
  "seed-fixture": "npm run test:dev-test-game-seed-fixture",
  "release-readiness": "npm run test:dev-test-game-readiness",
  "race-coverage": "npm run test:dev-test-game-race-coverage",
  "race-coverage-admin": "npm run test:dev-test-game-race-coverage-admin-proof",
  "hosted-concurrent-race-matrix":
    "npm run test:dev-test-game-hosted-concurrent-race-matrix",
  "hosted-concurrent-race-matrix-admin":
    "npm run test:dev-test-game-hosted-concurrent-race-matrix-admin-proof",
  "hosted-identity-evidence":
    "npm run test:dev-test-game-hosted-identity-evidence",
  "hosted-identity-evidence-admin":
    "npm run test:dev-test-game-hosted-identity-evidence-admin-proof",
  "hosted-target-preflight": "npm run test:dev-test-game-hosted-target-preflight",
  "hosted-evidence-lane": "npm run test:dev-test-game-hosted-evidence-lane",
  "hosted-evidence-lane-demo":
    "npm run test:dev-test-game-hosted-evidence-lane-demo-proof",
  "hosted-ops-signals": "npm run test:dev-test-game-hosted-ops-signals",
  "hosted-ops-signals-admin":
    "npm run test:dev-test-game-hosted-ops-signals-admin-proof",
  "release-runbook": "npm run test:dev-test-game-release-runbook",
  "release-runbook-admin": "npm run test:dev-test-game-release-runbook-admin-proof",
  "identity-adapter": `${localDatabasePrefix} npm run test:dev-test-game-identity`,
  "spine-manifest": "npm run test:dev-test-game-spine-manifest",
  "core-loop": "npm run test:dev-test-game-core-loop-admin-proof",
  hardening: "npm run test:dev-test-game-hardening-admin-proof",
  identity: "npm run test:dev-test-game-identity-admin-proof",
  backup: "npm run test:dev-test-game-backup-admin-proof",
  ops: "npm run test:dev-test-game-ops-admin-proof",
  seed: "npm run test:dev-test-game-seed-admin-proof",
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
    "| Command | Steps |",
    "| --- | ---: |",
  ];
  for (const [id, command] of Object.entries(manifest.commands)) {
    lines.push(`| ${id} | ${command.plan?.length ?? 1} |`);
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
