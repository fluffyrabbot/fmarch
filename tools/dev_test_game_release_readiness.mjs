import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertLocalReadinessDependencyChecks,
  buildNextActionAdminSurfaceReadinessCheck,
  buildProofFreshnessAdminSurfaceReadinessCheck,
  buildProofGraphAdminRoleHandoffsReadinessCheck,
  getLocalReadinessDependency,
  localHostedEvidenceLaneDemoProofCheckId,
  localProofGraphAdminRoleHandoffsCheckId,
} from "./dev_test_game_local_readiness_dependencies.mjs";
import { assertDevTestGameProofRun } from "./dev_test_game_proof_contract.mjs";
import {
  assertDevTestGameRaceCoverage,
  raceCoverageLocalReadinessMilestoneCases,
  raceCoveragePromotedReloadGroups,
} from "./dev_test_game_race_coverage.mjs";
import {
  assertDevTestGameHostedEvidenceLaneDemoProof,
  devTestGameHostedEvidenceLaneDemoProofPath,
} from "./dev_test_game_hosted_evidence_lane_demo_proof.mjs";
import {
  assertDevTestGameIdentityAdapterContractPacket,
  devTestGameIdentityAdapterContractDiff,
  devTestGameIdentityAdapterProofVersion,
} from "./dev_test_game_identity_adapter_contract.mjs";
import {
  assertHostStaleControlCoverageSummary,
} from "./dev_test_game_host_stale_recovery_scenarios.mjs";
import {
  playerRecoveryAuditLaneIds,
} from "./dev_test_game_player_recovery_scenarios.mjs";
import {
  assertReplacementActionRecoveryCoverageSummary,
  replacementActionLaneIds,
} from "./dev_test_game_replacement_action_scenario_cases.mjs";
import {
  assertReplacementHandoffRecoveryCoverageSummary,
  replacementHandoffRecoveryLaneIds,
} from "./dev_test_game_replacement_handoff_scenario_cases.mjs";
import {
  assertReplacementPrivateChannelRecoveryCoverageSummary,
} from "./dev_test_game_replacement_private_scenarios.mjs";
import {
  assertStaleConflictMessageCoverageSummary,
  replacementStaleConflictMessageSpineLaneCase,
  staleConflictMessageSurfaceCases,
  staleConflictMessageLaneIds,
} from "./dev_test_game_hardening_recovery_scenarios.mjs";
import {
  seedAggregateOnlyProofLaneIds,
  seedAliasOnlyProofLaneIds,
  seedDemoScenarioIds,
  seedScenarioCoverageGroups,
} from "./dev_test_game_seed_scenario_cases.mjs";
import {
  hostedTargetPreflightCheckIds,
} from "./dev_test_game_hosted_target_preflight.mjs";
import {
  hardeningAuditLaneIds,
} from "./dev_test_game_hardening_scenarios.mjs";
import {
  hostedMatrixAdminRequiredCheckIds,
  hostedMatrixStaleConflictMilestoneCases,
} from "./dev_test_game_hosted_concurrent_race_matrix_cases.mjs";
import {
  coreLoopAdminCheckIds,
  coreLoopCompletedGameCoverageCheckId,
  coreLoopAuditLaneIds,
} from "./dev_test_game_core_loop_scenarios.mjs";
import {
  hostedOpsReadinessBoundaryCheckId,
  hostedOpsSignalCheckIds,
  hostedOpsTelemetryBoundaryCheckId,
} from "./dev_test_game_hosted_ops_signal_cases.mjs";
import {
  realHostedObservabilityHandoffCheckIds,
  realHostedObservabilityHandoffInputIds,
} from "./dev_test_game_real_hosted_observability_handoff_cases.mjs";
import {
  buildReleaseReadinessUnprovenItems,
  hostedIdentityEvidenceSatisfiesProductionIdentity,
  hostedIdentityEvidencePathKind,
  releaseAdminProofFallbackUnprovenIds,
  releaseReadinessProductionFeatureSpineTargets,
} from "./dev_test_game_release_readiness_cases.mjs";
import {
  proofRunLaneCoverageMilestoneIds,
  recoveryMilestoneCoverageCases,
} from "./dev_test_game_release_readiness_milestone_cases.mjs";
import {
  featureSpineRecoveryHookRowKind,
  featureSpineRowKind,
  validFeatureSpineDeclaration,
} from "./dev_test_game_feature_spine_targets.mjs";
import {
  buildProductionFeatureSpineTargetCollection,
  validProductionFeatureSpineTargetCollection,
} from "./dev_test_game_production_feature_spine_resolver.mjs";
import {
  defaultProductionFeatureSpineRerunCommands,
  devTestGameCoreLoopAdminProofCommand,
  devTestGameHardeningAdminProofCommand,
  devTestGameProductionFeatureBrowserProofCommand,
  productionFeatureSpineSourceCheckRules,
} from "./dev_test_game_production_feature_source_rules.mjs";
import {
  coreLoopFeatureSpineSourceCheckId,
} from "./dev_test_game_core_loop_feature_spine_targets.mjs";
import {
  hardeningFeatureSpineSourceCheckId,
} from "./dev_test_game_hardening_feature_spine_targets.mjs";
import {
  identityFeatureSpineSourceCheckId,
} from "./dev_test_game_identity_feature_spine_targets.mjs";
import {
  localAdminAuditHandoffCheckIds,
  localAdminAuditIds,
  localAdminAuditRoleUrl,
} from "./dev_test_game_admin_audit_surface_ids.mjs";
import {
  assertCompletedGameProofReadinessSurfaceProof,
  completedGameProofReadinessScenarioFamilies,
} from "./dev_test_game_core_loop_completed_game_proof_readiness_contract.mjs";
import {
  completedGameHardeningSpineCycleId,
  completedGameHardeningSpineLaneCases,
  completedGameStaleRecoverySpineLaneCase,
} from "./dev_test_game_core_loop_completed_game_proof_readiness_contract.mjs";
import {
  assertPlayerStaleActionAfterTransitionProofCase,
  assertPlayerStaleVoteAfterTransitionProofCase,
  staleNightFourActionRecoveryScenario,
} from "./dev_test_game_core_loop_action_scenarios.mjs";
import {
  assertPlayerActionRoleSurfaceProof,
  coreLoopPlayerActionRecoveryFamilyId,
  coreLoopPlayerActionRecoveryScenarioFamily,
} from "./dev_test_game_core_loop_player_action_recovery_scenarios.mjs";
import {
  assertEmptyNightThreeHostTransitionProofCase,
  assertHostLifecycleControlRoleSurfaceCase,
  assertHostNightActionTransitionSurfaceCase,
  assertHostPhaseTransitionActionProofCase,
  assertHostStaleAdvanceAfterTransitionProofCase,
  hostDeadlineAffordanceForPhaseState,
} from "./dev_test_game_core_loop_host_phase_scenarios.mjs";
import {
  assertPostNightFourTransitionSurfaceCase,
} from "./dev_test_game_core_loop_post_night_four_transition_scenarios.mjs";
import {
  assertHostPhaseTransitionSurfaceProof,
  assertStaleNightFourActionRecoveryProofCase,
} from "./dev_test_game_core_loop_transition_recovery_scenario_assertions.mjs";
import {
  assertDayThreePlayerObservationProofCase,
  assertPostDayThreePlayerSurfaceProofCase,
  assertPrivateChannelRoleSurfaceProof,
} from "./dev_test_game_core_loop_private_receipt_scenarios.mjs";
import {
  assertNightActionResolutionReceiptSurfaceProof,
  assertNormalDayVotePrivacySurfaceProof,
  assertNormalNightActionResolutionPrivacySurfaceProof,
  assertNormalResolutionPrivacySurfaceProof,
  assertTargetDayVoteReceiptSurfaceProof,
  assertTargetResolutionReceiptSurfaceProof,
  coreLoopPrivateReceiptSurfaceFamilyId,
} from "./dev_test_game_core_loop_private_receipt_surface_scenarios.mjs";
import {
  assertNormalPostDayVoteAdvanceSurfaceProof,
  assertTargetPostDayVoteAdvanceSurfaceProof,
  coreLoopPostDayVoteAdvanceFamilyId,
} from "./dev_test_game_core_loop_post_day_vote_advance_scenarios.mjs";
import {
  assertDayThreeVoteResolutionSurfaceCase,
  coreLoopVoteResolutionFamilyId,
} from "./dev_test_game_core_loop_vote_resolution_scenarios.mjs";
import {
  assertDayFourSurvivorRoleSurfaceCase,
  assertNightThreeEmptyResolutionSurfaceCase,
  coreLoopPhaseProgressionFamilyId,
} from "./dev_test_game_core_loop_phase_progression_scenarios.mjs";
import {
  assertNightFourActionSubmissionSurfaceCase,
  coreLoopLateActionProgressionFamilyId,
} from "./dev_test_game_core_loop_late_action_progression_scenarios.mjs";
import {
  assertNightFourResolutionReceiptSurfaceCase,
  assertPostDayThreeResolutionSurfaceCase,
  coreLoopResolutionReceiptPrivacyFamilyId,
} from "./dev_test_game_core_loop_resolution_receipt_privacy_scenarios.mjs";
import {
  assertDayFourNoLynchHostTransitionProofCase,
  assertDayFourNoLynchVoteProofCase,
  coreLoopNoLynchProgressionFamilyId,
} from "./dev_test_game_core_loop_no_lynch_progression_scenarios.mjs";
import {
  assertDayFiveNoLynchResolutionSurfaceProof,
  coreLoopDayFiveProgressionFamilyId,
} from "./dev_test_game_core_loop_day_five_progression_scenarios.mjs";
import {
  coreLoopHostControlFamilyId,
  coreLoopHostControlScenarioFamily,
} from "./dev_test_game_core_loop_host_control_scenarios.mjs";
import {
  coreLoopCompletedEndgameProgressionFamilyId,
} from "./dev_test_game_core_loop_completed_endgame_progression_scenarios.mjs";
import {
  assertCoreLoopPrivateChannelRecoveryCoverageSummary,
  coreLoopPrivateChannelRecoveryFamilyId,
  coreLoopPrivateChannelRecoveryLaneIds,
  coreLoopPrivateChannelRecoveryScenarioFamily,
} from "./dev_test_game_core_loop_private_channel_recovery_scenarios.mjs";
export const DEV_TEST_GAME_RELEASE_READINESS_VERSION = 1;
const devTestGameSeededBrowserProofCommand =
  devTestGameProductionFeatureBrowserProofCommand;
const artifactCoverageMilestoneIds = Object.freeze([
  "local-race-coverage-proof",
  "local-seed-demo-fixture",
]);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = path.join(repoRoot, "target", "dev-test-game");
const defaultProofPath = path.join(artifactDir, "proof-run.json");
const defaultCoreLoopAdminProofPath = path.join(
  artifactDir,
  "core-loop-admin-proof.json",
);
const defaultHardeningAdminProofPath = path.join(
  artifactDir,
  "hardening-admin-proof.json",
);
const defaultBackupRestoreProofPath = path.join(
  repoRoot,
  "target",
  "live-stack-backup-restore-drill",
  "local-backup-restore-proof.json",
);
const defaultBackupRestoreDumpPath = path.join(
  repoRoot,
  "target",
  "live-stack-backup-restore-drill",
  "local-live-stack.dump",
);
const defaultBackupAdminProofPath = path.join(artifactDir, "backup-admin-proof.json");
const defaultOpsArtifactsPath = path.join(artifactDir, "ops-artifacts.json");
const defaultOpsAdminProofPath = path.join(artifactDir, "ops-admin-proof.json");
const defaultHostedOpsSignalsPath = path.join(artifactDir, "hosted-ops-signals.json");
const defaultHostedOpsSignalsAdminProofPath = path.join(
  artifactDir,
  "hosted-ops-signals-admin-proof.json",
);
const defaultSeedFixtureSummaryPath = path.join(
  artifactDir,
  "seed-fixture-summary.json",
);
const defaultSeedAdminProofPath = path.join(artifactDir, "seed-admin-proof.json");
const defaultIdentityAdapterProofPath = path.join(
  repoRoot,
  "target",
  "auth-invite-role-proof",
  "invite-role-proof.json",
);
const defaultIdentityAdminProofPath = path.join(
  artifactDir,
  "identity-admin-proof.json",
);
const defaultHostedIdentityEvidenceAdminProofPath = path.join(
  artifactDir,
  "hosted-identity-evidence-admin-proof.json",
);
const defaultSpineManifestPath = path.join(artifactDir, "spine-manifest.json");
const defaultSpineManifestAdminProofPath = path.join(
  artifactDir,
  "spine-manifest-admin-proof.json",
);
const defaultAdminSpineProofPath = path.join(artifactDir, "admin-spine-proof.json");
const defaultAdminSpineAdminProofPath = path.join(
  artifactDir,
  "admin-spine-admin-proof.json",
);
const defaultRaceCoveragePath = path.join(artifactDir, "race-coverage.json");
const defaultRaceCoverageAdminProofPath = path.join(
  artifactDir,
  "race-coverage-admin-proof.json",
);
const defaultHostedConcurrentRaceMatrixAdminProofPath = path.join(
  artifactDir,
  "hosted-concurrent-race-matrix-admin-proof.json",
);
const defaultHostedConcurrentRaceMatrixPath = path.join(
  artifactDir,
  "hosted-concurrent-race-matrix.json",
);
const defaultHostedEvidenceLaneAdminProofPath = path.join(
  artifactDir,
  "hosted-evidence-lane-admin-proof.json",
);
const defaultHostedEvidenceLaneDemoProofPath = path.join(
  artifactDir,
  "hosted-evidence-lane-demo-proof.json",
);
const defaultProofGraphAdminProofPath = path.join(
  artifactDir,
  "proof-graph-admin-proof.json",
);
const defaultProofFreshnessAdminProofPath = path.join(
  artifactDir,
  "proof-freshness-admin-proof.json",
);
const defaultNextActionAdminProofPath = path.join(
  artifactDir,
  "next-action-admin-proof.json",
);
const defaultReleaseRunbookPath = path.join(artifactDir, "release-runbook.json");
const defaultReleaseRunbookAdminProofPath = path.join(
  artifactDir,
  "release-runbook-admin-proof.json",
);
const jsonPath = path.join(artifactDir, "release-readiness-checklist.json");
const markdownPath = path.join(artifactDir, "release-readiness-checklist.md");
const maxBackupArtifactAgeHours = Number.parseFloat(
  process.env.FMARCH_DEV_TEST_GAME_READINESS_MAX_ARTIFACT_AGE_HOURS ?? "24",
);

if (!Number.isFinite(maxBackupArtifactAgeHours) || maxBackupArtifactAgeHours <= 0) {
  throw new Error(
    "FMARCH_DEV_TEST_GAME_READINESS_MAX_ARTIFACT_AGE_HOURS must be a positive number",
  );
}

export function buildDevTestGameReleaseReadiness(proofRun, options = {}) {
  const proof = assertDevTestGameProofRun(proofRun);
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const sourcePath = options.sourcePath ?? "target/dev-test-game/proof-run.json";
  const recoveryMilestonesByGeneratedFromKey = {
    staleConflictMessageMilestone: buildStaleConflictMessageMilestone(proof, {
      sourcePath,
    }),
    hostStaleControlMilestone: buildHostStaleControlMilestone(proof, {
      sourcePath,
    }),
    privateChannelRecoveryMilestone: buildPrivateChannelRecoveryMilestone(proof, {
      sourcePath,
    }),
    replacementActionRecoveryMilestone: buildReplacementActionRecoveryMilestone(
      proof,
      { sourcePath },
    ),
    replacementHandoffRecoveryMilestone: buildReplacementHandoffRecoveryMilestone(
      proof,
      { sourcePath },
    ),
  };
  const {
    staleConflictMessageMilestone,
  } = recoveryMilestonesByGeneratedFromKey;
  const coreLoopAdminProofEvidence = options.coreLoopAdminProof
    ? validateDevTestGameCoreLoopAdminProof(options.coreLoopAdminProof, {
        path:
          options.coreLoopAdminProofPath ??
          "target/dev-test-game/core-loop-admin-proof.json",
        artifact: options.coreLoopAdminProofArtifact,
      })
    : undefined;
  const hardeningAdminProofEvidence = options.hardeningAdminProof
    ? validateDevTestGameHardeningAdminProof(options.hardeningAdminProof, {
        path:
          options.hardeningAdminProofPath ??
          "target/dev-test-game/hardening-admin-proof.json",
        artifact: options.hardeningAdminProofArtifact,
      })
    : undefined;
  const backupRestoreEvidence = options.backupRestoreProof
    ? validateDevTestGameBackupRestoreProof(options.backupRestoreProof, {
        proofPath:
          options.backupRestoreProofPath ??
          "target/live-stack-backup-restore-drill/local-backup-restore-proof.json",
        dumpPath:
          options.backupRestoreDumpPath ??
          "target/live-stack-backup-restore-drill/local-live-stack.dump",
        proofArtifact: options.backupRestoreProofArtifact,
        dumpArtifact: options.backupRestoreDumpArtifact,
      })
    : undefined;
  const backupAdminProofEvidence = options.backupAdminProof
    ? validateDevTestGameBackupAdminProof(options.backupAdminProof, {
        path: options.backupAdminProofPath ?? "target/dev-test-game/backup-admin-proof.json",
        artifact: options.backupAdminProofArtifact,
      })
    : undefined;
  const opsArtifactsEvidence = options.opsArtifacts
    ? validateDevTestGameOpsArtifacts(options.opsArtifacts, {
        path: options.opsArtifactsPath ?? "target/dev-test-game/ops-artifacts.json",
        artifact: options.opsArtifactsArtifact,
      })
    : undefined;
  const opsAdminProofEvidence = options.opsAdminProof
    ? validateDevTestGameOpsAdminProof(options.opsAdminProof, {
        path: options.opsAdminProofPath ?? "target/dev-test-game/ops-admin-proof.json",
        artifact: options.opsAdminProofArtifact,
      })
    : undefined;
  const hostedOpsSignalsEvidence = options.hostedOpsSignals
    ? validateDevTestGameHostedOpsSignals(options.hostedOpsSignals, {
        path:
          options.hostedOpsSignalsPath ??
          "target/dev-test-game/hosted-ops-signals.json",
        artifact: options.hostedOpsSignalsArtifact,
      })
    : undefined;
  const hostedOpsSignalsAdminProofEvidence = options.hostedOpsSignalsAdminProof
    ? validateDevTestGameHostedOpsSignalsAdminProof(
        options.hostedOpsSignalsAdminProof,
        {
          path:
            options.hostedOpsSignalsAdminProofPath ??
            "target/dev-test-game/hosted-ops-signals-admin-proof.json",
          artifact: options.hostedOpsSignalsAdminProofArtifact,
        },
      )
    : undefined;
  const seedFixtureEvidence = options.seedFixtureSummary
    ? validateDevTestGameSeedFixtureSummary(options.seedFixtureSummary, {
        path:
          options.seedFixtureSummaryPath ??
          "target/dev-test-game/seed-fixture-summary.json",
        artifact: options.seedFixtureSummaryArtifact,
      })
    : undefined;
  const seedAdminProofEvidence = options.seedAdminProof
    ? validateDevTestGameSeedAdminProof(options.seedAdminProof, {
        path: options.seedAdminProofPath ?? "target/dev-test-game/seed-admin-proof.json",
        artifact: options.seedAdminProofArtifact,
      })
    : undefined;
  const identityAdapterEvidence = options.identityAdapterProof
    ? validateDevTestGameIdentityAdapterProof(options.identityAdapterProof, {
        path:
          options.identityAdapterProofPath ??
          "target/auth-invite-role-proof/invite-role-proof.json",
        artifact: options.identityAdapterProofArtifact,
      })
    : undefined;
  const identityAdminProofEvidence = options.identityAdminProof
    ? validateDevTestGameIdentityAdminProof(options.identityAdminProof, {
        path:
          options.identityAdminProofPath ??
          "target/dev-test-game/identity-admin-proof.json",
        artifact: options.identityAdminProofArtifact,
      })
    : undefined;
  const hostedIdentityEvidenceAdminProofEvidence =
    options.hostedIdentityEvidenceAdminProof
      ? validateDevTestGameHostedIdentityEvidenceAdminProof(
          options.hostedIdentityEvidenceAdminProof,
          {
            path:
              options.hostedIdentityEvidenceAdminProofPath ??
              "target/dev-test-game/hosted-identity-evidence-admin-proof.json",
            artifact: options.hostedIdentityEvidenceAdminProofArtifact,
          },
        )
      : undefined;
  const spineManifestEvidence = options.spineManifest
    ? validateDevTestGameSpineManifest(options.spineManifest, {
        path: options.spineManifestPath ?? "target/dev-test-game/spine-manifest.json",
        artifact: options.spineManifestArtifact,
      })
    : undefined;
  const spineManifestAdminProofEvidence = options.spineManifestAdminProof
    ? validateDevTestGameSpineManifestAdminProof(options.spineManifestAdminProof, {
        path:
          options.spineManifestAdminProofPath ??
          "target/dev-test-game/spine-manifest-admin-proof.json",
        artifact: options.spineManifestAdminProofArtifact,
      })
    : undefined;
  const adminSpineProofEvidence = options.adminSpineProof
    ? validateDevTestGameAdminSpineProof(options.adminSpineProof, {
        path: options.adminSpineProofPath ?? "target/dev-test-game/admin-spine-proof.json",
        artifact: options.adminSpineProofArtifact,
      })
    : undefined;
  const adminSpineAdminProofEvidence = options.adminSpineAdminProof
    ? validateDevTestGameAdminSpineAdminProof(options.adminSpineAdminProof, {
        path:
          options.adminSpineAdminProofPath ??
          "target/dev-test-game/admin-spine-admin-proof.json",
        artifact: options.adminSpineAdminProofArtifact,
      })
    : undefined;
  const raceCoverageEvidence = options.raceCoverage
    ? validateDevTestGameRaceCoverage(options.raceCoverage, {
        path: options.raceCoveragePath ?? "target/dev-test-game/race-coverage.json",
        artifact: options.raceCoverageArtifact,
      })
    : undefined;
  const raceCoverageReloadMilestonesByGroupId = options.raceCoverage
    ? buildRaceCoverageReloadMilestones(options.raceCoverage, {
        sourcePath: options.raceCoveragePath ?? "target/dev-test-game/race-coverage.json",
      })
    : new Map();
  const raceCoveragePromotedMilestones =
    raceCoverageEvidence === undefined
      ? undefined
      : buildRaceCoveragePromotedMilestones(raceCoverageEvidence, {
          milestonesByGroupId: raceCoverageReloadMilestonesByGroupId,
        });
  const hostedConcurrentRaceMatrixEvidence = options.hostedConcurrentRaceMatrix
    ? validateDevTestGameHostedConcurrentRaceMatrix(
        options.hostedConcurrentRaceMatrix,
        {
          path:
            options.hostedConcurrentRaceMatrixPath ??
            "target/dev-test-game/hosted-concurrent-race-matrix.json",
          artifact: options.hostedConcurrentRaceMatrixArtifact,
        },
      )
    : undefined;
  const raceCoverageAdminProofEvidence = options.raceCoverageAdminProof
    ? validateDevTestGameRaceCoverageAdminProof(options.raceCoverageAdminProof, {
        path:
          options.raceCoverageAdminProofPath ??
          "target/dev-test-game/race-coverage-admin-proof.json",
        artifact: options.raceCoverageAdminProofArtifact,
      })
    : undefined;
  const hostedConcurrentRaceMatrixAdminProofEvidence =
    options.hostedConcurrentRaceMatrixAdminProof
      ? validateDevTestGameHostedConcurrentRaceMatrixAdminProof(
          options.hostedConcurrentRaceMatrixAdminProof,
          {
            path:
              options.hostedConcurrentRaceMatrixAdminProofPath ??
              "target/dev-test-game/hosted-concurrent-race-matrix-admin-proof.json",
            artifact: options.hostedConcurrentRaceMatrixAdminProofArtifact,
          },
        )
      : undefined;
  const hostedEvidenceLaneAdminProofEvidence =
    options.hostedEvidenceLaneAdminProof
      ? validateDevTestGameHostedEvidenceLaneAdminProof(
          options.hostedEvidenceLaneAdminProof,
          {
            path:
              options.hostedEvidenceLaneAdminProofPath ??
              "target/dev-test-game/hosted-evidence-lane-admin-proof.json",
            artifact: options.hostedEvidenceLaneAdminProofArtifact,
          },
        )
      : undefined;
  const hostedEvidenceLaneDemoProofEvidence = options.hostedEvidenceLaneDemoProof
    ? validateDevTestGameHostedEvidenceLaneDemoProof(
        options.hostedEvidenceLaneDemoProof,
        {
          path:
            options.hostedEvidenceLaneDemoProofPath ??
            devTestGameHostedEvidenceLaneDemoProofPath,
          artifact: options.hostedEvidenceLaneDemoProofArtifact,
        },
      )
    : undefined;
  const proofGraphAdminProofEvidence = options.proofGraphAdminProof
    ? validateDevTestGameProofGraphAdminProof(options.proofGraphAdminProof, {
        path:
          options.proofGraphAdminProofPath ??
          "target/dev-test-game/proof-graph-admin-proof.json",
        artifact: options.proofGraphAdminProofArtifact,
      })
    : undefined;
  const proofFreshnessAdminProofEvidence = options.proofFreshnessAdminProof
    ? validateDevTestGameProofFreshnessAdminProof(
        options.proofFreshnessAdminProof,
        {
          path:
            options.proofFreshnessAdminProofPath ??
            "target/dev-test-game/proof-freshness-admin-proof.json",
          artifact: options.proofFreshnessAdminProofArtifact,
        },
      )
    : undefined;
  const nextActionAdminProofEvidence = options.nextActionAdminProof
    ? validateOptionalNextActionAdminProof(options.nextActionAdminProof, {
        path:
          options.nextActionAdminProofPath ??
          "target/dev-test-game/next-action-admin-proof.json",
        artifact: options.nextActionAdminProofArtifact,
      })
    : undefined;
  const releaseRunbookEvidence = options.releaseRunbook
    ? validateDevTestGameReleaseRunbook(options.releaseRunbook, {
        path: options.releaseRunbookPath ?? "target/dev-test-game/release-runbook.json",
        artifact: options.releaseRunbookArtifact,
      })
    : undefined;
  const releaseRunbookAdminProofEvidence = options.releaseRunbookAdminProof
    ? validateDevTestGameReleaseRunbookAdminProof(options.releaseRunbookAdminProof, {
        path:
          options.releaseRunbookAdminProofPath ??
          "target/dev-test-game/release-runbook-admin-proof.json",
        artifact: options.releaseRunbookAdminProofArtifact,
      })
    : undefined;
  const localChecks = [
    {
      id: "local-role-url-browser-proof",
      label: "Seeded role URLs and browser proof",
      status: "passed",
      evidence: sourcePath,
      laneIds: proof.lanes.map((lane) => lane.id),
    },
    {
      id: coreLoopFeatureSpineSourceCheckId,
      label: "Host controls, replacement, player actions, private channels, and day/night loop",
      status: "passed",
      evidence: sourcePath,
      laneIds: coreLoopAuditLaneIds,
      ...(coreLoopAdminProofEvidence === undefined
        ? {}
        : {
            adminRoleSurface: coreLoopAdminProofEvidence,
            spineTargets: buildCoreLoopReadinessSpineTargets(
              coreLoopAdminProofEvidence,
            ),
          }),
    },
    {
      id: hardeningFeatureSpineSourceCheckId,
      label: "Idempotency, reconnect, stale-client, and local concurrent race matrix",
      status: "passed",
      evidence: sourcePath,
      laneIds: hardeningAuditLaneIds,
      ...(hardeningAdminProofEvidence === undefined
        ? {}
        : {
            adminRoleSurface: hardeningAdminProofEvidence,
            spineTargets: buildHardeningReadinessSpineTargets({
              proof,
              hardeningAdminProofEvidence,
              staleConflictMessageMilestone,
            }),
          }),
    },
    ...recoveryMilestoneReadinessChecks({
      cases: recoveryMilestoneCoverageCases,
      milestonesByGeneratedFromKey: recoveryMilestonesByGeneratedFromKey,
      sourcePath,
    }),
  ];
  if (backupRestoreEvidence !== undefined) {
    localChecks.push({
      id: "local-backup-restore-drill",
      label: "Local dump/restore drill",
      status: "passed",
      evidence: backupRestoreEvidence.path,
      dump: backupRestoreEvidence.dumpPath,
      proofBoundary: backupRestoreEvidence.proofBoundary,
      ...(backupAdminProofEvidence === undefined
        ? {}
        : { adminRoleSurface: backupAdminProofEvidence }),
    });
  }
  if (opsArtifactsEvidence !== undefined) {
    localChecks.push({
      id: "local-ops-artifact-bundle",
      label: "Local ops artifact bundle",
      status: "passed",
      evidence: opsArtifactsEvidence.path,
      proofBoundary: opsArtifactsEvidence.proofBoundary,
      ...(opsAdminProofEvidence === undefined
        ? {}
        : { adminRoleSurface: opsAdminProofEvidence }),
    });
  }
  if (hostedOpsSignalsEvidence !== undefined) {
    localChecks.push({
      id: "local-hosted-ops-signals",
      label: "Local hosted-like ops signals",
      status: "passed",
      evidence: hostedOpsSignalsEvidence.path,
      proofBoundary: hostedOpsSignalsEvidence.proofBoundary,
      cellCount: hostedOpsSignalsEvidence.cellCount,
      reconnectLaneCount: hostedOpsSignalsEvidence.reconnectLaneCount,
      staleConflictLaneCount: hostedOpsSignalsEvidence.staleConflictLaneCount,
      realHostedDeploymentStatus:
        hostedOpsSignalsEvidence.realHostedDeploymentStatus,
      hostedTelemetryStatus: hostedOpsSignalsEvidence.hostedTelemetryStatus,
      ...(hostedOpsSignalsAdminProofEvidence === undefined
        ? {}
        : { adminRoleSurface: hostedOpsSignalsAdminProofEvidence }),
    });
  }
  if (seedFixtureEvidence !== undefined) {
    localChecks.push({
      id: "local-seed-demo-fixture",
      label: "Local seed/demo fixture summary",
      status: "passed",
      evidence: seedFixtureEvidence.path,
      proofBoundary: seedFixtureEvidence.proofBoundary,
      scenarioCount: seedFixtureEvidence.scenarioCount,
      proofLaneCoverage: seedFixtureEvidence.proofLaneCoverage,
      ...(seedAdminProofEvidence === undefined
        ? {}
        : { adminRoleSurface: seedAdminProofEvidence }),
    });
  }
  if (identityAdapterEvidence !== undefined) {
    localChecks.push({
      id: identityFeatureSpineSourceCheckId,
      label: "Local production-identity adapter proof",
      status: "passed",
      evidence: identityAdapterEvidence.path,
      proofBoundary: identityAdapterEvidence.proofBoundary,
      roles: identityAdapterEvidence.roles,
      ...(identityAdminProofEvidence === undefined
        ? {}
        : { adminRoleSurface: identityAdminProofEvidence }),
    });
  }
  if (hostedIdentityEvidenceAdminProofEvidence !== undefined) {
    localChecks.push({
      id: "local-hosted-identity-evidence-admin-surface",
      label: "Local hosted identity evidence admin surface",
      status: "passed",
      evidence: hostedIdentityEvidenceAdminProofEvidence.path,
      proofBoundary: hostedIdentityEvidenceAdminProofEvidence.proofBoundary,
      evidenceStatus: hostedIdentityEvidenceAdminProofEvidence.evidenceStatus,
      rawEvidenceStatus:
        hostedIdentityEvidenceAdminProofEvidence.rawEvidenceStatus,
      rawEvidencePath: hostedIdentityEvidenceAdminProofEvidence.rawEvidencePath,
      rawEvidencePathKind:
        hostedIdentityEvidenceAdminProofEvidence.rawEvidencePathKind,
      fixtureEvidence:
        hostedIdentityEvidenceAdminProofEvidence.fixtureEvidence,
      blockedCheckCount:
        hostedIdentityEvidenceAdminProofEvidence.visibleUnproven?.length ?? 0,
      adminRoleSurface: hostedIdentityEvidenceAdminProofEvidence,
    });
  }
  if (spineManifestEvidence !== undefined) {
    localChecks.push({
      id: localAdminAuditIds.spineManifest,
      label: "Local development-spine manifest",
      status: "passed",
      evidence: spineManifestEvidence.path,
      proofBoundary: spineManifestEvidence.proofBoundary,
      commandCount: spineManifestEvidence.commandCount,
      artifactCount: spineManifestEvidence.artifactCount,
      ...(spineManifestAdminProofEvidence === undefined
        ? {}
        : { adminRoleSurface: spineManifestAdminProofEvidence }),
    });
  }
  if (adminSpineProofEvidence !== undefined) {
    localChecks.push({
      id: "local-admin-spine-surface",
      label: "Local aggregate admin spine proof",
      status: "passed",
      evidence: adminSpineProofEvidence.path,
      proofBoundary: adminSpineProofEvidence.proofBoundary,
      proofIds: adminSpineProofEvidence.proofIds,
      ...(adminSpineAdminProofEvidence === undefined
        ? {}
        : { adminRoleSurface: adminSpineAdminProofEvidence }),
    });
  }
  if (raceCoverageEvidence !== undefined) {
    localChecks.push({
      id: "local-race-coverage-inventory",
      label: "Local race coverage inventory",
      status: "passed",
      evidence: raceCoverageEvidence.path,
      proofBoundary: raceCoverageEvidence.proofBoundary,
      cellCount: raceCoverageEvidence.cellCount,
      reloadCoveredCellCount: raceCoverageEvidence.reloadCoveredCellCount,
      ...(raceCoverageAdminProofEvidence === undefined
        ? {}
        : { adminRoleSurface: raceCoverageAdminProofEvidence }),
    });
    for (const milestoneCase of raceCoverageLocalReadinessMilestoneCases()) {
      const milestone = raceCoverageReloadMilestonesByGroupId.get(
        milestoneCase.groupId,
      );
      if (milestone === undefined) {
        throw new Error(
          `missing local race readiness milestone for ${milestoneCase.groupId}`,
        );
      }
      localChecks.push({
        id: milestoneCase.id,
        label: milestoneCase.label,
        status: "passed",
        evidence: raceCoverageEvidence.path,
        proofBoundary: milestoneCase.proofBoundary,
        cellIds: [...milestoneCase.cellIds],
        requiredCellCount: milestone.requiredCellCount,
        coveredCellCount: milestone.coveredCellCount,
      });
    }
    localChecks.push({
      id: "local-race-coverage-promoted-milestones",
      label: "Promoted local race milestone aggregate",
      status: "passed",
      evidence: raceCoverageEvidence.path,
      proofBoundary:
        "Local race-coverage aggregate showing all promoted replacement, host, player, and cohost race-reload milestone groups are covered before the remaining hosted-concurrent-race-matrix gap is treated as hosted matrix work.",
      cellCount: raceCoveragePromotedMilestones.cellCount,
      provenCellCount: raceCoveragePromotedMilestones.provenCellCount,
      reloadCoveredCellCount: raceCoveragePromotedMilestones.reloadCoveredCellCount,
      groupCount: raceCoveragePromotedMilestones.groupCount,
      passedGroupCount: raceCoveragePromotedMilestones.passedGroupCount,
      requiredCellCount: raceCoveragePromotedMilestones.requiredCellCount,
      coveredCellCount: raceCoveragePromotedMilestones.coveredCellCount,
      groups: raceCoveragePromotedMilestones.groups,
    });
  }
  if (hostedConcurrentRaceMatrixEvidence !== undefined) {
    localChecks.push({
      id: "local-hosted-concurrent-race-matrix",
      label: "Local hosted-like race matrix",
      status: "passed",
      evidence: hostedConcurrentRaceMatrixEvidence.path,
      proofBoundary: hostedConcurrentRaceMatrixEvidence.proofBoundary,
      cellCount: hostedConcurrentRaceMatrixEvidence.cellCount,
      reloadCoveredCellCount:
        hostedConcurrentRaceMatrixEvidence.reloadCoveredCellCount,
      reconnectLaneCount: hostedConcurrentRaceMatrixEvidence.reconnectLaneCount,
      staleConflictLaneCount:
        hostedConcurrentRaceMatrixEvidence.staleConflictLaneCount,
      staleConflictMilestones:
        hostedConcurrentRaceMatrixEvidence.staleConflictMilestones,
      hostedEvidenceStatus: hostedConcurrentRaceMatrixEvidence.hostedEvidenceStatus,
      realHostedDeploymentStatus:
        hostedConcurrentRaceMatrixEvidence.realHostedDeploymentStatus,
      remainingGaps: hostedConcurrentRaceMatrixEvidence.remainingGaps,
    });
  }
  if (hostedConcurrentRaceMatrixAdminProofEvidence !== undefined) {
    localChecks.push({
      id: "local-hosted-concurrent-race-matrix-admin-surface",
      label: "Local hosted matrix admin surface",
      status: "passed",
      evidence: hostedConcurrentRaceMatrixAdminProofEvidence.path,
      proofBoundary: hostedConcurrentRaceMatrixAdminProofEvidence.proofBoundary,
      hostedEvidenceStatus:
        hostedConcurrentRaceMatrixAdminProofEvidence.hostedEvidenceStatus,
      realHostedDeploymentStatus:
        hostedConcurrentRaceMatrixAdminProofEvidence.realHostedDeploymentStatus,
      adminRoleSurface: hostedConcurrentRaceMatrixAdminProofEvidence,
    });
  }
  if (hostedEvidenceLaneAdminProofEvidence !== undefined) {
    localChecks.push({
      id: "local-hosted-evidence-lane-admin-surface",
      label: "Local hosted evidence lane admin surface",
      status: "passed",
      evidence: hostedEvidenceLaneAdminProofEvidence.path,
      proofBoundary: hostedEvidenceLaneAdminProofEvidence.proofBoundary,
      laneStatus: hostedEvidenceLaneAdminProofEvidence.laneStatus,
      preflightStatus: hostedEvidenceLaneAdminProofEvidence.preflightStatus,
      blockedCheckCount:
        hostedEvidenceLaneAdminProofEvidence.visibleUnproven?.length ?? 0,
      adminRoleSurface: hostedEvidenceLaneAdminProofEvidence,
    });
  }
  if (hostedEvidenceLaneDemoProofEvidence !== undefined) {
    const dependency = getLocalReadinessDependency(
      localHostedEvidenceLaneDemoProofCheckId,
    );
    if (dependency === undefined) {
      throw new Error("hosted evidence lane demo proof dependency is missing");
    }
    localChecks.push({
      id: dependency.id,
      label: dependency.label,
      status: "passed",
      dependencyGated: true,
      evidence: hostedEvidenceLaneDemoProofEvidence.path,
      proofBoundary: hostedEvidenceLaneDemoProofEvidence.proofBoundary,
      demoOnly: true,
      syntheticExternalTarget:
        hostedEvidenceLaneDemoProofEvidence.syntheticExternalTarget,
      blockedLaneStatus: hostedEvidenceLaneDemoProofEvidence.blockedLaneStatus,
      passedLaneStatus: hostedEvidenceLaneDemoProofEvidence.passedLaneStatus,
      passedRoleUrl: hostedEvidenceLaneDemoProofEvidence.passedRoleUrl,
      externalEvidencePath:
        hostedEvidenceLaneDemoProofEvidence.externalEvidencePath,
      recovery: {
        command: dependency.command,
        buildSlice: dependency.buildSlice,
        proofTarget: dependency.proofTarget,
        roleUrl: dependency.roleUrl,
        proofBoundary: dependency.proofBoundary,
        requiredEvidence: dependency.requiredEvidence,
      },
    });
  }
  if (proofGraphAdminProofEvidence !== undefined) {
    localChecks.push(
      buildProofGraphAdminRoleHandoffsReadinessCheck(proofGraphAdminProofEvidence),
    );
  }
  if (proofFreshnessAdminProofEvidence !== undefined) {
    localChecks.push(
      buildProofFreshnessAdminSurfaceReadinessCheck(
        proofFreshnessAdminProofEvidence,
      ),
    );
  }
  if (nextActionAdminProofEvidence !== undefined) {
    localChecks.push(
      buildNextActionAdminSurfaceReadinessCheck(nextActionAdminProofEvidence),
    );
  }
  if (releaseRunbookEvidence !== undefined) {
    localChecks.push({
      id: "local-human-release-runbook-rehearsal",
      label: "Local human release runbook rehearsal",
      status: "passed",
      evidence: releaseRunbookEvidence.path,
      proofBoundary: releaseRunbookEvidence.proofBoundary,
      runbookItemCount: releaseRunbookEvidence.runbookItemCount,
      rollbackStatus: releaseRunbookEvidence.rollbackStatus,
      supportStatus: releaseRunbookEvidence.supportStatus,
      ...(releaseRunbookAdminProofEvidence === undefined
        ? {}
        : { adminRoleSurface: releaseRunbookAdminProofEvidence }),
    });
  }
  const unproven = buildReleaseReadinessUnprovenItems({
    identityAdapterEvidence,
    hostedIdentityEvidenceAdminProofEvidence,
    seedFixtureEvidence,
    backupRestoreEvidence,
    raceCoverageEvidence,
    hostedConcurrentRaceMatrixEvidence,
    opsArtifactsEvidence,
    hostedOpsSignalsEvidence,
    releaseRunbookEvidence,
  });
  const releaseReadinessStatus = "not_ready";
  const releaseReadinessReasonText = releaseReadinessReason({
    backupRestoreEvidence,
    opsArtifactsEvidence,
    hostedOpsSignalsEvidence,
    seedFixtureEvidence,
    identityAdapterEvidence,
    hostedIdentityEvidenceAdminProofEvidence,
    spineManifestEvidence,
    raceCoverageEvidence,
    hostedConcurrentRaceMatrixEvidence,
    proofGraphAdminProofEvidence,
    proofFreshnessAdminProofEvidence,
    nextActionAdminProofEvidence,
    releaseRunbookEvidence,
  });
  return {
    version: DEV_TEST_GAME_RELEASE_READINESS_VERSION,
    proof: "dev-test-game-release-readiness",
    status: "passed",
    readinessStatus: releaseReadinessStatus,
    releaseReady: false,
    productionReady: false,
    generatedAt,
    scope: "local-dev-test-game-release-readiness-checklist",
    generatedFrom: {
      proofRun: sourcePath,
      proofGeneratedAt: proof.generatedAt,
      game: proof.session.game,
      ...(coreLoopAdminProofEvidence === undefined
        ? {}
        : { coreLoopAdminProof: coreLoopAdminProofEvidence.path }),
      ...(hardeningAdminProofEvidence === undefined
        ? {}
        : { hardeningAdminProof: hardeningAdminProofEvidence.path }),
      ...(backupRestoreEvidence === undefined
        ? {}
        : {
            backupRestoreProof: backupRestoreEvidence.path,
            backupRestoreDump: backupRestoreEvidence.dumpPath,
            ...(backupAdminProofEvidence === undefined
              ? {}
              : { backupAdminProof: backupAdminProofEvidence.path }),
          }),
      ...(opsArtifactsEvidence === undefined
        ? {}
        : {
          opsArtifacts: opsArtifactsEvidence.path,
          ...(hostedOpsSignalsEvidence === undefined
            ? {}
            : {
                hostedOpsSignals: hostedOpsSignalsEvidence.path,
                ...(hostedOpsSignalsAdminProofEvidence === undefined
                  ? {}
                  : {
                      hostedOpsSignalsAdminProof:
                        hostedOpsSignalsAdminProofEvidence.path,
                    }),
              }),
        }),
      ...(seedFixtureEvidence === undefined
        ? {}
        : {
            seedFixtureSummary: seedFixtureEvidence.path,
            ...(seedAdminProofEvidence === undefined
              ? {}
              : { seedAdminProof: seedAdminProofEvidence.path }),
          }),
      ...(identityAdapterEvidence === undefined
        ? {}
        : {
            identityAdapterProof: identityAdapterEvidence.path,
            ...(identityAdminProofEvidence === undefined
              ? {}
              : { identityAdminProof: identityAdminProofEvidence.path }),
          }),
      ...(spineManifestEvidence === undefined
        ? {}
        : {
            spineManifest: spineManifestEvidence.path,
            ...(spineManifestAdminProofEvidence === undefined
              ? {}
              : { spineManifestAdminProof: spineManifestAdminProofEvidence.path }),
          }),
      ...(adminSpineProofEvidence === undefined
        ? {}
        : {
            adminProofSpine: adminSpineProofEvidence.path,
            ...(adminSpineAdminProofEvidence === undefined
              ? {}
              : { adminSpineAdminProof: adminSpineAdminProofEvidence.path }),
          }),
      ...(raceCoverageEvidence === undefined
        ? {}
        : {
            raceCoverage: raceCoverageEvidence.path,
            ...(raceCoverageAdminProofEvidence === undefined
              ? {}
              : { raceCoverageAdminProof: raceCoverageAdminProofEvidence.path }),
            ...(hostedConcurrentRaceMatrixAdminProofEvidence === undefined
              ? {}
              : {
                  hostedConcurrentRaceMatrixAdminProof:
                    hostedConcurrentRaceMatrixAdminProofEvidence.path,
                }),
            ...(hostedConcurrentRaceMatrixEvidence === undefined
              ? {}
              : {
                  hostedConcurrentRaceMatrix:
                    hostedConcurrentRaceMatrixEvidence.path,
                }),
            ...raceCoverageLocalReadinessMilestoneSnapshots({
              milestonesByGroupId: raceCoverageReloadMilestonesByGroupId,
            }),
            raceCoveragePromotedMilestones,
          }),
      ...(proofGraphAdminProofEvidence === undefined
        ? {}
        : {
            proofGraphAdminProof: proofGraphAdminProofEvidence.path,
          }),
      ...(proofFreshnessAdminProofEvidence === undefined
        ? {}
        : {
            proofFreshnessAdminProof: proofFreshnessAdminProofEvidence.path,
          }),
      ...(nextActionAdminProofEvidence === undefined
        ? {}
        : {
            nextActionAdminProof: nextActionAdminProofEvidence.path,
          }),
      ...(releaseRunbookEvidence === undefined
        ? {}
        : {
            releaseRunbook: releaseRunbookEvidence.path,
            ...(releaseRunbookAdminProofEvidence === undefined
              ? {}
              : { releaseRunbookAdminProof: releaseRunbookAdminProofEvidence.path }),
          }),
      ...recoveryMilestoneGeneratedFromSnapshots({
        cases: recoveryMilestoneCoverageCases,
        milestonesByGeneratedFromKey: recoveryMilestonesByGeneratedFromKey,
      }),
    },
    localDevelopmentSpine: {
      status: "passed",
      checks: localChecks,
      ...((backupRestoreEvidence === undefined &&
        opsArtifactsEvidence === undefined &&
        seedFixtureEvidence === undefined &&
        identityAdapterEvidence === undefined &&
        spineManifestEvidence === undefined &&
        adminSpineProofEvidence === undefined &&
        proofGraphAdminProofEvidence === undefined &&
        proofFreshnessAdminProofEvidence === undefined &&
        hostedEvidenceLaneAdminProofEvidence === undefined &&
        hostedEvidenceLaneDemoProofEvidence === undefined &&
        nextActionAdminProofEvidence === undefined)
        ? {}
        : {
            evidence: {
              ...(coreLoopAdminProofEvidence === undefined
                ? {}
                : { coreLoop: { adminRoleSurface: coreLoopAdminProofEvidence } }),
              ...(hardeningAdminProofEvidence === undefined
                ? {}
                : { hardening: { adminRoleSurface: hardeningAdminProofEvidence } }),
              ...raceCoverageLocalReadinessMilestoneSnapshots({
                milestonesByGroupId: raceCoverageReloadMilestonesByGroupId,
              }),
              ...(raceCoveragePromotedMilestones === undefined
                ? {}
                : { raceCoveragePromotedMilestones }),
              ...(nextActionAdminProofEvidence === undefined
                ? {}
                : { nextActionAdminProof: nextActionAdminProofEvidence }),
              ...(proofFreshnessAdminProofEvidence === undefined
                ? {}
                : { proofFreshnessAdminProof: proofFreshnessAdminProofEvidence }),
              ...recoveryMilestoneGeneratedFromSnapshots({
                cases: recoveryMilestoneCoverageCases,
                milestonesByGeneratedFromKey: recoveryMilestonesByGeneratedFromKey,
              }),
              ...(backupRestoreEvidence === undefined
                ? {}
                : {
                    backupRestore: {
                      ...backupRestoreEvidence,
                      ...(backupAdminProofEvidence === undefined
                        ? {}
                        : { adminRoleSurface: backupAdminProofEvidence }),
                    },
                  }),
              ...(opsArtifactsEvidence === undefined
                ? {}
                : { opsArtifacts: opsArtifactsEvidence }),
              ...(hostedOpsSignalsEvidence === undefined
                ? {}
                : {
                    hostedOpsSignals: {
                      ...hostedOpsSignalsEvidence,
                      ...(hostedOpsSignalsAdminProofEvidence === undefined
                        ? {}
                        : { adminRoleSurface: hostedOpsSignalsAdminProofEvidence }),
                    },
                  }),
              ...(seedFixtureEvidence === undefined
                ? {}
                : {
                    seedFixture: {
                      ...seedFixtureEvidence,
                      ...(seedAdminProofEvidence === undefined
                        ? {}
                        : { adminRoleSurface: seedAdminProofEvidence }),
                    },
                  }),
              ...(identityAdapterEvidence === undefined
                ? {}
                : {
                    identityAdapter: {
                      ...identityAdapterEvidence,
                      ...(identityAdminProofEvidence === undefined
                        ? {}
                        : { adminRoleSurface: identityAdminProofEvidence }),
                    },
                  }),
              ...(spineManifestEvidence === undefined
                ? {}
                : {
                    spineManifest: {
                      ...spineManifestEvidence,
                      ...(spineManifestAdminProofEvidence === undefined
                        ? {}
                        : { adminRoleSurface: spineManifestAdminProofEvidence }),
                    },
                  }),
              ...(adminSpineProofEvidence === undefined
                ? {}
                : {
                    adminProofSpine: {
                      ...adminSpineProofEvidence,
                      ...(adminSpineAdminProofEvidence === undefined
                        ? {}
                        : { adminRoleSurface: adminSpineAdminProofEvidence }),
                    },
                  }),
              ...(raceCoverageEvidence === undefined
                ? {}
                : {
                    raceCoverage: {
                      ...raceCoverageEvidence,
                      ...(raceCoverageAdminProofEvidence === undefined
                        ? {}
                        : { adminRoleSurface: raceCoverageAdminProofEvidence }),
                    },
                  }),
              ...(hostedConcurrentRaceMatrixAdminProofEvidence === undefined
                ? {}
                : {
                    hostedConcurrentRaceMatrixAdminProof:
                      hostedConcurrentRaceMatrixAdminProofEvidence,
                  }),
              ...(hostedEvidenceLaneAdminProofEvidence === undefined
                ? {}
                : {
                    hostedEvidenceLaneAdminProof:
                      hostedEvidenceLaneAdminProofEvidence,
                  }),
              ...(hostedEvidenceLaneDemoProofEvidence === undefined
                ? {}
                : {
                    hostedEvidenceLaneDemoProof:
                      hostedEvidenceLaneDemoProofEvidence,
                  }),
              ...(hostedConcurrentRaceMatrixEvidence === undefined
                ? {}
                : {
                    hostedConcurrentRaceMatrix:
                      hostedConcurrentRaceMatrixEvidence,
                  }),
              ...(proofGraphAdminProofEvidence === undefined
                ? {}
                : { proofGraphAdminProof: proofGraphAdminProofEvidence }),
              ...(releaseRunbookEvidence === undefined
                ? {}
                : {
                    releaseRunbook: {
                      ...releaseRunbookEvidence,
                      ...(releaseRunbookAdminProofEvidence === undefined
                        ? {}
                        : { adminRoleSurface: releaseRunbookAdminProofEvidence }),
                    },
                  }),
            },
          }),
    },
    releaseReadiness: {
      status: releaseReadinessStatus,
      reason: releaseReadinessReasonText,
      unprovenCount: unproven.length,
      unprovenIds: unproven.map((item) => item.id),
      unproven,
    },
    readinessSummary: {
      status: releaseReadinessStatus,
      proofStatus: "passed",
      releaseReady: false,
      productionReady: false,
      localDevelopmentSpineStatus: "passed",
      unprovenCount: unproven.length,
      unprovenIds: unproven.map((item) => item.id),
      firstUnprovenRequiredEvidence: unproven[0]?.requiredEvidence ?? null,
      reason: releaseReadinessReasonText,
    },
    proofBoundary:
      "Derived from the local dev-test-game proof-run artifact. Passing means the local harness evidence is coherent; it does not mean production, hosted, beta, or release readiness.",
  };
}

function releaseReadinessReason({
  backupRestoreEvidence,
  opsArtifactsEvidence,
  hostedOpsSignalsEvidence,
  seedFixtureEvidence,
  identityAdapterEvidence,
  hostedIdentityEvidenceAdminProofEvidence,
  spineManifestEvidence,
  raceCoverageEvidence,
  hostedConcurrentRaceMatrixEvidence,
  proofGraphAdminProofEvidence,
  proofFreshnessAdminProofEvidence,
  nextActionAdminProofEvidence,
  releaseRunbookEvidence,
}) {
  const passed = [
    "the local development-spine proof",
    ...(backupRestoreEvidence === undefined ? [] : ["local backup/restore drill"]),
    ...(opsArtifactsEvidence === undefined ? [] : ["local ops artifact bundle"]),
    ...(hostedOpsSignalsEvidence === undefined
      ? []
      : ["local hosted-like ops signals"]),
    ...(seedFixtureEvidence === undefined ? [] : ["local seed/demo fixture"]),
    ...(identityAdapterEvidence === undefined ? [] : ["local identity adapter"]),
    ...(hostedIdentityEvidenceSatisfiesProductionIdentity(
      hostedIdentityEvidenceAdminProofEvidence,
    )
      ? ["hosted identity evidence"]
      : []),
    ...(spineManifestEvidence === undefined ? [] : ["local spine manifest"]),
    ...(raceCoverageEvidence === undefined ? [] : ["local race coverage inventory"]),
    ...(hostedConcurrentRaceMatrixEvidence === undefined
      ? []
      : ["local hosted-like race matrix"]),
    ...(proofGraphAdminProofEvidence === undefined
      ? []
      : ["proof graph admin role handoffs"]),
    ...(proofFreshnessAdminProofEvidence === undefined
      ? []
      : ["proof freshness admin surface"]),
    ...(nextActionAdminProofEvidence === undefined
      ? []
      : ["next-action admin surface"]),
    ...(releaseRunbookEvidence === undefined
      ? []
      : ["local release-runbook rehearsal"]),
  ];
  const missing = [
    identityAdapterEvidence === undefined
      ? "production identity"
      : hostedIdentityEvidenceSatisfiesProductionIdentity(
            hostedIdentityEvidenceAdminProofEvidence,
          )
        ? null
        : "hosted identity lifecycle",
    "hosted operations",
    seedFixtureEvidence === undefined ? "seed/demo fixtures" : "hosted demo fixtures",
    backupRestoreEvidence === undefined ? "backup/restore" : "production backup/PITR",
    raceCoverageEvidence === undefined
      ? "race coverage inventory"
      : hostedConcurrentRaceMatrixEvidence === undefined
        ? "hosted concurrent race matrix"
        : "real hosted multi-node race evidence",
    opsArtifactsEvidence === undefined
      ? "observability"
      : hostedOpsSignalsEvidence === undefined
        ? "hosted observability"
        : "real hosted telemetry",
    releaseRunbookEvidence === undefined
      ? "human release runbook"
      : "human release approval",
  ].filter((item) => item !== null);
  return `${joinEnglish(passed)} passed, but ${joinEnglish(missing)} remain unproven.`;
}

function joinEnglish(items) {
  if (items.length <= 1) {
    return items.join("");
  }
  if (items.length === 2) {
    return `${items[0]} and ${items[1]}`;
  }
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

function buildStaleConflictMessageMilestone(proof, { sourcePath }) {
  const lanes = new Map(proof.lanes.map((lane) => [lane.id, lane]));
  let coverage;
  try {
    coverage = assertStaleConflictMessageCoverageSummary({
      summary: proof.staleConflictMessageCoverage,
      lanes: proof.lanes,
    });
  } catch (error) {
    throw new Error(
      `stale conflict-message milestone missing passed lanes from ${sourcePath}: ${error.message}`,
    );
  }
  const laneIds = [...coverage.sourceLaneIds];
  const surfaces = buildStaleConflictMessageSurfaces(lanes, { sourcePath });
  const surfaceCoverage = buildStaleConflictMessageSurfaceCoverage({
    laneIds,
    surfaces,
    sourcePath,
  });
  return {
    ...coverageMilestoneSummary(coverage, { laneIds }),
    surfaceCoverage,
    surfaces,
  };
}

function coverageMilestoneSummary(coverage, { laneIds = coverage.sourceLaneIds } = {}) {
  return {
    status: coverage.status,
    laneIds: [...laneIds],
    requiredLaneCount: coverage.laneCount,
    coveredLaneCount: coverage.passedLaneCount,
    gapCount: coverage.laneCount - coverage.passedLaneCount,
    familyCount: coverage.familyCount,
    expectedLaneCount: coverage.expectedLaneCount,
    expectedFamilyCount: coverage.expectedFamilyCount,
    families: coverage.families,
  };
}

function coverageMilestoneSnapshot(milestone) {
  return {
    status: milestone.status,
    laneIds: [...milestone.laneIds],
    requiredLaneCount: milestone.requiredLaneCount,
    coveredLaneCount: milestone.coveredLaneCount,
    gapCount: milestone.gapCount,
    familyCount: milestone.familyCount,
    expectedLaneCount: milestone.expectedLaneCount,
    expectedFamilyCount: milestone.expectedFamilyCount,
    families: milestone.families,
    ...(milestone.surfaceCoverage === undefined
      ? {}
      : { surfaceCoverage: milestone.surfaceCoverage }),
    ...(milestone.surfaces === undefined ? {} : { surfaces: milestone.surfaces }),
  };
}

function recoveryMilestoneGeneratedFromSnapshots({
  cases,
  milestonesByGeneratedFromKey,
}) {
  return Object.fromEntries(
    cases.map((scenario) => {
      const milestone = milestoneForReadinessCase({
        scenario,
        milestonesByGeneratedFromKey,
      });
      return [scenario.generatedFromKey, coverageMilestoneSnapshot(milestone)];
    }),
  );
}

function recoveryMilestoneReadinessChecks({
  cases,
  milestonesByGeneratedFromKey,
  sourcePath,
}) {
  return cases.flatMap((scenario) => {
    const milestone = milestoneForReadinessCase({
      scenario,
      milestonesByGeneratedFromKey,
    });
    return [
      recoveryMilestoneReadinessCheck({
        scenario,
        milestone,
        sourcePath,
      }),
      ...(scenario.hasSurfaceChecks === true
        ? milestone.surfaces.map((surface) =>
            recoveryMilestoneSurfaceReadinessCheck({ surface, sourcePath }),
          )
        : []),
    ];
  });
}

function milestoneForReadinessCase({ scenario, milestonesByGeneratedFromKey }) {
  const milestone = milestonesByGeneratedFromKey[scenario.generatedFromKey];
  if (milestone === undefined) {
    throw new Error(
      `release readiness milestone case missing generatedFrom key: ${scenario.generatedFromKey}`,
    );
  }
  return milestone;
}

function recoveryMilestoneReadinessCheck({ scenario, milestone, sourcePath }) {
  return {
    id: scenario.checkId,
    label: scenario.label,
    status: "passed",
    evidence: sourcePath,
    proofBoundary: scenario.proofBoundary,
    laneIds: [...milestone.laneIds],
    requiredLaneCount: milestone.requiredLaneCount,
    coveredLaneCount: milestone.coveredLaneCount,
    familyCount: milestone.familyCount,
    expectedLaneCount: milestone.expectedLaneCount,
    expectedFamilyCount: milestone.expectedFamilyCount,
    ...(scenario.hasSurfaceCoverage === true
      ? { surfaceCoverage: milestone.surfaceCoverage }
      : {}),
    ...(scenario.hasSurfaceChecks === true ? { surfaces: milestone.surfaces } : {}),
  };
}

function recoveryMilestoneSurfaceReadinessCheck({ surface, sourcePath }) {
  return {
    id: surface.checkId,
    label: surface.label,
    status: surface.status,
    evidence: sourcePath,
    proofBoundary: surface.proofBoundary,
    laneId: surface.laneId,
    roleUrl: surface.roleUrl,
    rejectError: surface.rejectError,
    rejectMessage: surface.rejectMessage,
    receiptStatusText: surface.receiptStatusText,
    stalePhase: surface.stalePhase,
    refreshedPhase: surface.refreshedPhase,
    staleClickActionId: surface.staleClickActionId,
    actionId: surface.actionId,
    staleClickRefreshKeys: surface.staleClickRefreshKeys,
    activitySource: surface.activitySource,
    dispatchKind: surface.dispatchKind,
    commandOutgoing: surface.commandOutgoing,
    currentOccupant: surface.currentOccupant,
    phaseId: surface.phaseId,
    locked: surface.locked,
    deadlineActions: surface.deadlineActions,
    phaseActions: surface.phaseActions,
    currentActions: surface.currentActions,
    actorStatusAfterReject: surface.actorStatusAfterReject,
    actionVisibleAfterRefresh: surface.actionVisibleAfterRefresh,
    restoredActorStatus: surface.restoredActorStatus,
  };
}

function buildStaleConflictMessageSurfaceCoverage({ laneIds, surfaces, sourcePath }) {
  const requiredSurfaceCount = laneIds.length;
  const coveredSurfaceCount = surfaces.filter(
    (surface) => surface.status === "passed" && laneIds.includes(surface.laneId),
  ).length;
  const gapCount = requiredSurfaceCount - coveredSurfaceCount;
  const status = gapCount === 0 ? "complete" : "gapped";
  if (status !== "complete") {
    throw new Error(
      `stale conflict-message surface coverage incomplete from ${sourcePath}: ${coveredSurfaceCount}/${requiredSurfaceCount}`,
    );
  }
  return {
    status,
    requiredSurfaceCount,
    coveredSurfaceCount,
    gapCount,
  };
}

function buildStaleConflictMessageSurfaces(lanes, { sourcePath }) {
  return staleConflictMessageSurfaceCases().map((scenario) => {
    const lane = lanes.get(scenario.laneId);
    const evidence = lane?.evidence ?? {};
    if (
      lane?.status !== "passed" ||
      typeof evidence.roleUrl !== "string" ||
      !evidence.roleUrl.includes("/g/") ||
      evidence.rejectError !== scenario.expectedRejectError ||
      (scenario.expectedTemplateId !== undefined &&
        evidence.templateId !== scenario.expectedTemplateId) ||
      evidence.stalePhase !== scenario.expectedStalePhase ||
      (scenario.expectedRefreshedPhase !== undefined &&
        evidence.refreshedPhase !== scenario.expectedRefreshedPhase) ||
      (scenario.expectedReceiptFragment !== undefined &&
        !String(
          evidence.receiptStatusText ??
            evidence.staleClickReceipt ??
            evidence.activityStatus ??
            "",
        ).includes(scenario.expectedReceiptFragment)) ||
      (scenario.expectedRejectMessageFragment !== undefined &&
        !String(evidence.rejectMessage ?? "").includes(
          scenario.expectedRejectMessageFragment,
        )) ||
      (scenario.expectedActorStatusAfterReject !== undefined &&
        evidence.actorStatusAfterReject !==
          scenario.expectedActorStatusAfterReject) ||
      (scenario.expectedActionVisibleAfterRefresh !== undefined &&
        evidence.actionVisibleAfterRefresh !==
          scenario.expectedActionVisibleAfterRefresh) ||
      (scenario.expectedRestoredActorStatus !== undefined &&
        evidence.restoredActorStatus !== scenario.expectedRestoredActorStatus) ||
      (scenario.expectedStaleClickActionId !== undefined &&
        evidence.staleClickActionId !== scenario.expectedStaleClickActionId) ||
      (scenario.expectedActionId !== undefined &&
        evidence.actionId !== scenario.expectedActionId) ||
      (scenario.expectedStaleClickRefreshKeys !== undefined &&
        !sameStringArray(
          evidence.staleClickRefreshKeys,
          scenario.expectedStaleClickRefreshKeys,
        )) ||
      (scenario.expectedActivitySource !== undefined &&
        evidence.activitySource !== scenario.expectedActivitySource) ||
      (scenario.expectedDispatchKind !== undefined &&
        evidence.dispatchKind !== scenario.expectedDispatchKind) ||
      (scenario.expectedCommandOutgoing !== undefined &&
        evidence.commandOutgoing !== scenario.expectedCommandOutgoing) ||
      (scenario.expectedCurrentOccupant !== undefined &&
        evidence.currentOccupant !== scenario.expectedCurrentOccupant) ||
      (scenario.expectedPhaseId !== undefined &&
        evidence.phaseId !== scenario.expectedPhaseId) ||
      (scenario.expectedLocked !== undefined &&
        evidence.locked !== scenario.expectedLocked) ||
      (scenario.expectedDeadlineActions !== undefined &&
        !sameStringArray(evidence.deadlineActions, scenario.expectedDeadlineActions)) ||
      (scenario.expectedPhaseActions !== undefined &&
        !sameStringArray(evidence.phaseActions, scenario.expectedPhaseActions)) ||
      (scenario.expectedCurrentActions !== undefined &&
        !sameStringArray(evidence.currentActions, scenario.expectedCurrentActions))
    ) {
      throw new Error(
        `stale conflict-message surface missing proof from ${sourcePath}: ${scenario.id}`,
      );
    }
    return {
      id: scenario.id,
      checkId: scenario.checkId,
      label: scenario.label,
      status: "passed",
      laneId: scenario.laneId,
      role: scenario.role,
      roleUrl: evidence.roleUrl,
      visitedRolePath: evidence.visitedRolePath,
      rejectError: evidence.rejectError,
      rejectMessage: evidence.rejectMessage,
      templateId: evidence.templateId,
      stalePhase: evidence.stalePhase,
      refreshedPhase: evidence.refreshedPhase,
      staleClickActionId: evidence.staleClickActionId,
      actionId: evidence.actionId,
      staleClickRefreshKeys: evidence.staleClickRefreshKeys,
      activitySource: evidence.activitySource,
      dispatchKind: evidence.dispatchKind,
      commandOutgoing: evidence.commandOutgoing,
      currentOccupant: evidence.currentOccupant,
      phaseId: evidence.phaseId,
      locked: evidence.locked,
      deadlineActions: evidence.deadlineActions,
      phaseActions: evidence.phaseActions,
      currentActions: evidence.currentActions,
      actorStatusAfterReject: evidence.actorStatusAfterReject,
      actionVisibleAfterRefresh: evidence.actionVisibleAfterRefresh,
      restoredActorStatus: evidence.restoredActorStatus,
      receiptStatusText:
        evidence.receiptStatusText ?? evidence.staleClickReceipt ?? evidence.activityStatus,
      proofBoundary: scenario.proofBoundary,
    };
  });
}

function buildHostStaleControlMilestone(proof, { sourcePath }) {
  let coverage;
  try {
    coverage = assertHostStaleControlCoverageSummary({
      summary: proof.hostStaleControlCoverage,
      lanes: proof.lanes,
    });
  } catch (error) {
    throw new Error(
      `host stale-control milestone missing passed lanes from ${sourcePath}: ${error.message}`,
    );
  }
  return coverageMilestoneSummary(coverage);
}

function buildPrivateChannelRecoveryMilestone(proof, { sourcePath }) {
  let coverage;
  try {
    coverage = assertCoreLoopPrivateChannelRecoveryCoverageSummary({
      summary: proof.coreLoopPrivateChannelRecoveryCoverage,
      lanes: proof.lanes,
    });
  } catch (error) {
    throw new Error(
      `private-channel recovery milestone missing passed lanes from ${sourcePath}: ${error.message}`,
    );
  }
  return coverageMilestoneSummary(coverage);
}

function buildReplacementActionRecoveryMilestone(proof, { sourcePath }) {
  let coverage;
  try {
    coverage = assertReplacementActionRecoveryCoverageSummary({
      summary: proof.replacementActionRecoveryCoverage,
      lanes: proof.lanes,
    });
  } catch (error) {
    throw new Error(
      `replacement action recovery milestone missing passed lanes from ${sourcePath}: ${error.message}`,
    );
  }
  return coverageMilestoneSummary(coverage);
}

function buildReplacementHandoffRecoveryMilestone(proof, { sourcePath }) {
  let coverage;
  try {
    coverage = assertReplacementHandoffRecoveryCoverageSummary({
      summary: proof.replacementHandoffRecoveryCoverage,
      lanes: proof.lanes,
    });
  } catch (error) {
    throw new Error(
      `replacement handoff recovery milestone missing passed lanes from ${sourcePath}: ${error.message}`,
    );
  }
  return coverageMilestoneSummary(coverage);
}

function buildRaceCoverageReloadMilestones(raceCoverage, { sourcePath }) {
  assertDevTestGameRaceCoverage(raceCoverage);
  return new Map(
    raceCoveragePromotedReloadGroups.map((group) => [
      group.id,
      buildRaceCoverageReloadMilestone(raceCoverage, { group, sourcePath }),
    ]),
  );
}

function raceCoverageLocalReadinessMilestoneSnapshots({
  milestoneCases = raceCoverageLocalReadinessMilestoneCases(),
  milestonesByGroupId,
}) {
  if (milestonesByGroupId.size === 0) {
    return {};
  }
  return Object.fromEntries(
    milestoneCases.map((milestoneCase) => {
      const milestone = milestonesByGroupId.get(milestoneCase.groupId);
      if (milestone === undefined) {
        throw new Error(
          `missing generatedFrom race milestone for ${milestoneCase.groupId}`,
        );
      }
      return [
        milestoneCase.generatedFromKey,
        raceCoverageReloadMilestoneSnapshot(milestone),
      ];
    }),
  );
}

function raceCoverageReloadMilestoneSnapshot(milestone) {
  return {
    status: milestone.status,
    cellIds: [...milestone.cellIds],
    requiredCellCount: milestone.requiredCellCount,
    coveredCellCount: milestone.coveredCellCount,
    gapCount: milestone.gapCount,
  };
}

function buildRaceCoverageReloadMilestone(raceCoverage, { group, sourcePath }) {
  const cells = new Map(raceCoverage.cells.map((cell) => [cell.id, cell]));
  const cellIds = [...group.cellIds];
  const coveredCellCount = cellIds.filter((cellId) => {
    const cell = cells.get(cellId);
    return (
      cell?.status === "passed" &&
      typeof cell.reloadLaneId === "string" &&
      cell.reloadStatus === "passed"
    );
  }).length;
  const gapCount = cellIds.length - coveredCellCount;
  if (gapCount !== 0) {
    throw new Error(
      `${group.id} milestone missing covered cells from ${sourcePath}: ${cellIds
        .filter((cellId) => {
          const cell = cells.get(cellId);
          return (
            cell?.status !== "passed" ||
            typeof cell.reloadLaneId !== "string" ||
            cell.reloadStatus !== "passed"
          );
        })
        .join(", ")}`,
    );
  }
  return {
    status: "passed",
    cellIds,
    requiredCellCount: cellIds.length,
    coveredCellCount,
    gapCount,
  };
}

function buildRaceCoveragePromotedMilestones(
  raceCoverageEvidence,
  { milestonesByGroupId },
) {
  const groups = raceCoveragePromotedReloadGroups.map((group) =>
    buildRaceCoveragePromotedMilestoneGroup(
      group,
      milestonesByGroupId.get(group.id),
    ),
  );
  const requiredCellCount = groups.reduce(
    (total, group) => total + group.requiredCellCount,
    0,
  );
  const coveredCellCount = groups.reduce(
    (total, group) => total + group.coveredCellCount,
    0,
  );
  const passedGroupCount = groups.filter((group) => group.status === "passed").length;
  const gapCount = requiredCellCount - coveredCellCount;
  if (passedGroupCount !== groups.length || gapCount !== 0) {
    throw new Error("promoted race milestone aggregate has gaps");
  }
  return {
    status: "passed",
    cellCount: raceCoverageEvidence.cellCount,
    provenCellCount: raceCoverageEvidence.provenCellCount,
    reloadCoveredCellCount: raceCoverageEvidence.reloadCoveredCellCount,
    groupCount: groups.length,
    passedGroupCount,
    requiredCellCount,
    coveredCellCount,
    gapCount,
    groups,
  };
}

function buildRaceCoveragePromotedMilestoneGroup(group, milestone) {
  return {
    id: group.id,
    label: group.label,
    status: milestone.status,
    cellIds: [...milestone.cellIds],
    requiredCellCount: milestone.requiredCellCount,
    coveredCellCount: milestone.coveredCellCount,
    gapCount: milestone.gapCount,
  };
}

export function validateDevTestGameBackupRestoreProof(proof, options = {}) {
  const requiredChecks = [
    "dump-created",
    "event-log-restored",
    "projection-fingerprints-restored",
    "auth-sessions-restored",
    "restored-api-capabilities",
  ];
  if (proof?.version !== 1) {
    throw new Error(`backup/restore proof version drifted: ${proof?.version}`);
  }
  if (proof.status !== "passed") {
    throw new Error(`backup/restore proof status is ${proof.status}`);
  }
  if (proof.scope !== "local-live-stack-backup-restore-drill") {
    throw new Error(`backup/restore proof scope drifted: ${proof.scope}`);
  }
  if (proof.productionReady !== false) {
    throw new Error("backup/restore proof must not claim production readiness");
  }
  const checks = new Map((proof.checks ?? []).map((check) => [check.id, check.status]));
  for (const id of requiredChecks) {
    if (checks.get(id) !== "passed") {
      throw new Error(`backup/restore check failed or missing: ${id}`);
    }
  }
  assertDeepEqual(
    proof.fingerprints?.restored,
    proof.fingerprints?.source,
    "backup/restore source and restored fingerprints",
  );
  if ((proof.fingerprints?.source?.events?.total ?? 0) <= 0) {
    throw new Error("backup/restore proof has no event rows");
  }
  assertSessionCapability(proof, "host", "HostOf");
  assertSessionCapability(proof, "player", "SlotOccupant");
  assertSessionCapability(proof, "player", "ChannelMember");
  assertSessionCapability(proof, "admin", "GlobalAdmin");
  const dumpPath =
    options.dumpPath ?? "target/live-stack-backup-restore-drill/local-live-stack.dump";
  if (proof.artifact?.dump !== dumpPath) {
    throw new Error(`backup/restore dump path drifted: ${proof.artifact?.dump} != ${dumpPath}`);
  }
  return {
    status: "passed",
    path:
      options.proofPath ??
      "target/live-stack-backup-restore-drill/local-backup-restore-proof.json",
    dumpPath,
    checkCount: requiredChecks.length,
    eventRows: proof.fingerprints.source.events.total,
    restoredSessions: proof.restoredApiEvidence.restoredSessions,
    proofBoundary: proof.proofBoundary,
    scope: proof.scope,
    productionReady: proof.productionReady,
    ...(options.proofArtifact === undefined
      ? {}
      : { artifact: options.proofArtifact }),
    ...(options.dumpArtifact === undefined ? {} : { dumpArtifact: options.dumpArtifact }),
  };
}

export function validateDevTestGameCoreLoopAdminProof(proof, options = {}) {
  const requiredChecks = coreLoopAdminCheckIds;
  if (proof?.version !== 1) {
    throw new Error(`core-loop admin proof version drifted: ${proof?.version}`);
  }
  if (proof.proof !== "dev-test-game-core-loop-admin-proof") {
    throw new Error(`unexpected core-loop admin proof id: ${proof.proof}`);
  }
  if (proof.status !== "passed") {
    throw new Error(`core-loop admin proof status is ${proof.status}`);
  }
  if (proof.scope !== "local-dev-test-game-core-loop-admin-surface") {
    throw new Error(`core-loop admin proof scope drifted: ${proof.scope}`);
  }
  if (proof.productionReady !== false || proof.releaseReady !== false) {
    throw new Error("core-loop admin proof must not claim production or release readiness");
  }
  if (
    proof.adminRoleSurface?.clickedThroughFromOverview !== true ||
    proof.adminRoleSurface?.rawInviteTokensVisible !== false
  ) {
    throw new Error("core-loop admin proof did not prove admin overview click-through");
  }
  for (const checkId of requiredChecks) {
    if (!proof.adminRoleSurface?.visibleChecks?.includes(checkId)) {
      throw new Error(`core-loop admin proof missing visible check: ${checkId}`);
    }
  }
  if (
    typeof proof.generatedFrom?.coreLoopSpineStatus !== "string" ||
    !proof.adminRoleSurface?.visibleCheckStatuses?.["core-loop-spine"]?.includes(
      proof.generatedFrom.coreLoopSpineStatus,
    )
  ) {
    throw new Error("core-loop admin proof missing visible core-loop spine status");
  }
  if (
    typeof proof.generatedFrom?.completedGameHardeningCoverageStatus !==
      "string" ||
    !proof.adminRoleSurface?.visibleCheckStatuses?.[
      coreLoopCompletedGameCoverageCheckId
    ]?.includes(proof.generatedFrom.completedGameHardeningCoverageStatus)
  ) {
    throw new Error(
      "core-loop admin proof missing visible completed-game coverage status",
    );
  }
  if (
    proof.generatedFrom?.hostControlFamily?.id !==
      coreLoopHostControlFamilyId ||
    !Array.isArray(proof.generatedFrom?.hostControlFamily?.laneIds)
  ) {
    throw new Error("core-loop admin proof missing host-control family");
  }
  if (
    proof.generatedFrom?.playerActionRecoveryFamily?.id !==
      coreLoopPlayerActionRecoveryFamilyId ||
    !Array.isArray(proof.generatedFrom?.playerActionRecoveryFamily?.laneIds)
  ) {
    throw new Error(
      "core-loop admin proof missing player-action recovery family",
    );
  }
  if (
    proof.generatedFrom?.privateReceiptSurfaceFamily?.id !==
      coreLoopPrivateReceiptSurfaceFamilyId ||
    !Array.isArray(proof.generatedFrom?.privateReceiptSurfaceFamily?.laneIds)
  ) {
    throw new Error(
      "core-loop admin proof missing private receipt surface family",
    );
  }
  if (
    proof.generatedFrom?.postDayVoteAdvanceFamily?.id !==
      coreLoopPostDayVoteAdvanceFamilyId ||
    !Array.isArray(proof.generatedFrom?.postDayVoteAdvanceFamily?.laneIds)
  ) {
    throw new Error(
      "core-loop admin proof missing post-day-vote advance family",
    );
  }
  if (
    proof.generatedFrom?.voteResolutionFamily?.id !==
      coreLoopVoteResolutionFamilyId ||
    !Array.isArray(proof.generatedFrom?.voteResolutionFamily?.laneIds)
  ) {
    throw new Error("core-loop admin proof missing vote-resolution family");
  }
  if (
    proof.generatedFrom?.phaseProgressionFamily?.id !==
      coreLoopPhaseProgressionFamilyId ||
    !Array.isArray(proof.generatedFrom?.phaseProgressionFamily?.laneIds)
  ) {
    throw new Error("core-loop admin proof missing phase progression family");
  }
  if (
    proof.generatedFrom?.lateActionProgressionFamily?.id !==
      coreLoopLateActionProgressionFamilyId ||
    !Array.isArray(proof.generatedFrom?.lateActionProgressionFamily?.laneIds)
  ) {
    throw new Error("core-loop admin proof missing late action progression family");
  }
  if (
    proof.generatedFrom?.resolutionReceiptPrivacyFamily?.id !==
      coreLoopResolutionReceiptPrivacyFamilyId ||
    !Array.isArray(
      proof.generatedFrom?.resolutionReceiptPrivacyFamily?.laneIds,
    )
  ) {
    throw new Error(
      "core-loop admin proof missing resolution receipt/privacy family",
    );
  }
  if (
    proof.generatedFrom?.noLynchProgressionFamily?.id !==
      coreLoopNoLynchProgressionFamilyId ||
    !Array.isArray(proof.generatedFrom?.noLynchProgressionFamily?.laneIds)
  ) {
    throw new Error("core-loop admin proof missing no-lynch progression family");
  }
  if (
    proof.generatedFrom?.dayFiveProgressionFamily?.id !==
      coreLoopDayFiveProgressionFamilyId ||
    !Array.isArray(proof.generatedFrom?.dayFiveProgressionFamily?.laneIds)
  ) {
    throw new Error("core-loop admin proof missing Day 5 progression family");
  }
  if (
    proof.generatedFrom?.completedEndgameProgressionFamily?.id !==
      coreLoopCompletedEndgameProgressionFamilyId ||
    !Array.isArray(
      proof.generatedFrom?.completedEndgameProgressionFamily?.laneIds,
    )
  ) {
    throw new Error(
      "core-loop admin proof missing completed endgame progression family",
    );
  }
  if (
    proof.generatedFrom?.privateChannelRecoveryFamily?.id !==
      coreLoopPrivateChannelRecoveryFamilyId ||
    !sameStringArray(
      proof.generatedFrom?.privateChannelRecoveryFamily?.laneIds,
      coreLoopPrivateChannelRecoveryLaneIds,
    )
  ) {
    throw new Error(
      "core-loop admin proof missing private-channel recovery family",
    );
  }
  assertVisibleAdminRows({
    label: "core-loop admin proof missing visible spine cycle",
    visibleRows: proof.adminRoleSurface?.visibleSpineCycles,
    requiredRows: proof.generatedFrom?.coreLoopSpineRows?.cycles,
  });
  assertVisibleAdminRows({
    label: "core-loop admin proof missing visible spine role URL",
    visibleRows: proof.adminRoleSurface?.visibleSpineRoleUrls,
    requiredRows: proof.generatedFrom?.coreLoopSpineRows?.roleUrls,
  });
  const roleUrlHrefs = proof.generatedFrom?.coreLoopSpineRows?.roleUrlHrefs ?? {};
  for (const rowId of proof.generatedFrom?.coreLoopSpineRows?.roleUrls ?? []) {
    const href = roleUrlHrefs[rowId];
    if (typeof href !== "string" || !href.includes("/g/")) {
      throw new Error(`core-loop admin proof missing browser role URL: ${rowId}`);
    }
  }
  assertCoreLoopHostLifecycleCheckpoint(proof.hostRoleSurface);
  assertCoreLoopPlayerActionCheckpoint(proof.playerRoleSurface);
  assertCoreLoopTargetResolutionReceiptSurface(proof.targetResolutionReceiptSurface);
  assertCoreLoopNormalResolutionPrivacySurface(proof.normalResolutionPrivacySurface);
  assertCoreLoopTargetDayVoteReceiptSurface(proof.targetDayVoteReceiptSurface);
  assertCoreLoopNormalDayVotePrivacySurface(proof.normalDayVotePrivacySurface);
  assertCoreLoopHostPhaseTransitionSurface(proof.hostPhaseTransitionSurface);
  assertCoreLoopTargetPostDayVoteAdvanceSurface(
    proof.targetPostDayVoteAdvanceSurface,
  );
  assertCoreLoopNormalPostDayVoteAdvanceSurface(
    proof.normalPostDayVoteAdvanceSurface,
  );
  assertCoreLoopNightActionResolutionReceiptSurface(
    proof.nightActionResolutionReceiptSurface,
  );
  assertCoreLoopNormalNightActionResolutionPrivacySurface(
    proof.normalNightActionResolutionPrivacySurface,
  );
  assertCoreLoopHostNightActionTransitionSurface(
    proof.hostNightActionTransitionSurface,
  );
  assertCoreLoopDayThreeVoteResolutionSurface(
    proof.dayThreeVoteResolutionSurface,
  );
  assertCoreLoopPostDayThreeResolutionSurface(
    proof.postDayThreeResolutionSurface,
  );
  assertCoreLoopNightThreeEmptyResolutionSurface(
    proof.nightThreeEmptyResolutionSurface,
  );
  assertCoreLoopDayFourSurvivorRoleSurface(
    proof.dayFourSurvivorRoleSurface,
  );
  assertCoreLoopNightFourActionSubmissionSurface(
    proof.nightFourActionSubmissionSurface,
  );
  assertCoreLoopNightFourResolutionReceiptSurface(
    proof.nightFourResolutionReceiptSurface,
  );
  assertCoreLoopPostNightFourTransitionSurface(
    proof.postNightFourTransitionSurface,
  );
  assertCoreLoopDayFiveNoLynchResolutionSurface(
    proof.dayFiveNoLynchResolutionSurface,
  );
  assertCoreLoopCompletedGameEndgameSurface(proof.completedGameEndgameSurface);
  assertPrivateChannelRoleSurfaceProof({
    privateChannelRoleSurface: proof.privateChannelRoleSurface,
    scenarioFamily: coreLoopPrivateChannelRecoveryScenarioFamily(),
  });
  assertVisibleAdminRows({
    label: "core-loop admin proof missing visible spine checkpoint",
    visibleRows: proof.adminRoleSurface?.visibleSpineCheckpoints,
    requiredRows: proof.generatedFrom?.coreLoopSpineRows?.checkpoints,
  });
  assertVisibleAdminRows({
    label: "core-loop admin proof missing visible spine recovery hook",
    visibleRows: proof.adminRoleSurface?.visibleSpineRecoveryHooks,
    requiredRows: proof.generatedFrom?.coreLoopSpineRows?.recoveryHooks,
  });
  return {
    status: "passed",
    path: options.path ?? "target/dev-test-game/core-loop-admin-proof.json",
    proofBoundary: proof.proofBoundary,
    overviewRoleUrl: proof.adminRoleSurface.overviewRoleUrl,
    detailRoleUrl: proof.adminRoleSurface.detailRoleUrl,
    visibleChecks: proof.adminRoleSurface.visibleChecks,
    visibleSpineCycles: proof.adminRoleSurface.visibleSpineCycles,
    visibleSpineRoleUrls: proof.adminRoleSurface.visibleSpineRoleUrls,
    visibleSpineCheckpoints: proof.adminRoleSurface.visibleSpineCheckpoints,
    visibleSpineRecoveryHooks: proof.adminRoleSurface.visibleSpineRecoveryHooks,
    coreLoopSpineRows: proof.generatedFrom.coreLoopSpineRows,
    completedGameHardeningCoverage:
      proof.generatedFrom.completedGameHardeningCoverage,
    completedGameHardeningCoverageStatus:
      proof.generatedFrom.completedGameHardeningCoverageStatus,
    hostRoleSurface: proof.hostRoleSurface,
    playerRoleSurface: proof.playerRoleSurface,
    hostPhaseTransitionSurface: proof.hostPhaseTransitionSurface,
    targetPostDayVoteAdvanceSurface: proof.targetPostDayVoteAdvanceSurface,
    normalPostDayVoteAdvanceSurface: proof.normalPostDayVoteAdvanceSurface,
    nightActionResolutionReceiptSurface:
      proof.nightActionResolutionReceiptSurface,
    normalNightActionResolutionPrivacySurface:
      proof.normalNightActionResolutionPrivacySurface,
    hostNightActionTransitionSurface: proof.hostNightActionTransitionSurface,
    dayThreeVoteResolutionSurface: proof.dayThreeVoteResolutionSurface,
    postDayThreeResolutionSurface: proof.postDayThreeResolutionSurface,
    nightThreeEmptyResolutionSurface: proof.nightThreeEmptyResolutionSurface,
    dayFourSurvivorRoleSurface: proof.dayFourSurvivorRoleSurface,
    nightFourActionSubmissionSurface: proof.nightFourActionSubmissionSurface,
    nightFourResolutionReceiptSurface: proof.nightFourResolutionReceiptSurface,
    postNightFourTransitionSurface: proof.postNightFourTransitionSurface,
    dayFiveNoLynchResolutionSurface: proof.dayFiveNoLynchResolutionSurface,
    completedGameEndgameSurface: proof.completedGameEndgameSurface,
    privateChannelRoleSurface: proof.privateChannelRoleSurface,
    ...(options.artifact === undefined ? {} : { artifact: options.artifact }),
  };
}

function assertCoreLoopHostLifecycleCheckpoint(hostRoleSurface) {
  const scenarioFamily = coreLoopHostControlScenarioFamily();
  assertHostLifecycleControlRoleSurfaceCase({
    hostRoleSurface,
    expectedGame: gameFromRoleUrl(hostRoleSurface?.sourceRoleUrl),
    scenario: scenarioFamily.surfaces.hostLifecycleControl,
  });
}

function assertCoreLoopPlayerActionCheckpoint(playerRoleSurface) {
  assertPlayerActionRoleSurfaceProof({
    playerRoleSurface,
    scenarioFamily: coreLoopPlayerActionRecoveryScenarioFamily(),
  });
}

function assertCoreLoopTargetResolutionReceiptSurface(targetSurface) {
  const expectedGame = gameFromRoleUrl(targetSurface?.sourceRoleUrl);
  assertTargetResolutionReceiptSurfaceProof({
    proof: targetSurface,
    expectedGame,
    sourceRoleUrl: targetSurface?.sourceRoleUrl,
  });
}

function assertCoreLoopNormalResolutionPrivacySurface(normalSurface) {
  const expectedGame = gameFromRoleUrl(normalSurface?.sourceRoleUrl);
  assertNormalResolutionPrivacySurfaceProof({
    proof: normalSurface,
    expectedGame,
    sourceRoleUrl: normalSurface?.sourceRoleUrl,
  });
}

function assertCoreLoopTargetDayVoteReceiptSurface(targetSurface) {
  const expectedGame = gameFromRoleUrl(targetSurface?.sourceRoleUrl);
  assertTargetDayVoteReceiptSurfaceProof({
    proof: targetSurface,
    expectedGame,
    sourceRoleUrl: targetSurface?.sourceRoleUrl,
  });
}

function assertCoreLoopNormalDayVotePrivacySurface(normalSurface) {
  const expectedGame = gameFromRoleUrl(normalSurface?.sourceRoleUrl);
  assertNormalDayVotePrivacySurfaceProof({
    proof: normalSurface,
    expectedGame,
    sourceRoleUrl: normalSurface?.sourceRoleUrl,
  });
}

function assertCoreLoopTargetPostDayVoteAdvanceSurface(targetSurface) {
  const expectedGame = gameFromRoleUrl(targetSurface?.sourceRoleUrl);
  assertTargetPostDayVoteAdvanceSurfaceProof({
    proof: targetSurface,
    expectedGame,
    sourceRoleUrl: targetSurface?.sourceRoleUrl,
  });
}

function assertCoreLoopNormalPostDayVoteAdvanceSurface(normalSurface) {
  const expectedGame = gameFromRoleUrl(normalSurface?.sourceRoleUrl);
  assertNormalPostDayVoteAdvanceSurfaceProof({
    proof: normalSurface,
    expectedGame,
    sourceRoleUrl: normalSurface?.sourceRoleUrl,
  });
}

function assertCoreLoopNightActionResolutionReceiptSurface(targetSurface) {
  const expectedGame = gameFromRoleUrl(targetSurface?.sourceRoleUrl);
  assertNightActionResolutionReceiptSurfaceProof({
    proof: targetSurface,
    expectedGame,
    sourceRoleUrl: targetSurface?.sourceRoleUrl,
  });
}

function assertCoreLoopNormalNightActionResolutionPrivacySurface(normalSurface) {
  const expectedGame = gameFromRoleUrl(normalSurface?.sourceRoleUrl);
  assertNormalNightActionResolutionPrivacySurfaceProof({
    proof: normalSurface,
    expectedGame,
    sourceRoleUrl: normalSurface?.sourceRoleUrl,
  });
}

function assertCoreLoopHostPhaseTransitionSurface(hostPhaseTransitionSurface) {
  assertHostPhaseTransitionSurfaceProof({
    hostPhaseTransitionSurface,
    assertHostPhaseTransitionActionProof: assertCoreLoopHostPhaseTransitionActionProof,
  });
}

function assertCoreLoopHostNightActionTransitionSurface(
  hostNightActionTransitionSurface,
) {
  const expectedGame = gameFromRoleUrl(
    hostNightActionTransitionSurface?.sourceHostRoleUrl,
  );
  assertHostNightActionTransitionSurfaceCase({
    hostNightActionTransitionSurface,
    expectedGame,
    assertPlayerObservationProof: assertCoreLoopDayThreePlayerObservationProof,
  });
}

function assertCoreLoopDayThreePlayerObservationProof({
  proof,
  sourceRoleUrl,
  expectedPrincipalUserId,
  expectedSlot,
  slotField,
  expectedActorAlive,
  expectedActorStatus,
  expectedActionState,
  expectedStatusText,
  expectedPrivateCount,
  expectedPrivateReceipt,
  expectedBoundaryText,
  expectedPhaseId,
  expectedPhaseState,
  expectedResyncFromSeq,
  expectedPrivateReceiptStatus,
  expectedPrivateReceiptPhaseId,
  expectedPrivateQueueBoundaryStatus,
  expectedCommandStateEndpoint,
  expectedNotificationsEndpoint,
}) {
  assertDayThreePlayerObservationProofCase({
    proof,
    sourceRoleUrl,
    expectedPrincipalUserId,
    expectedSlot,
    slotField,
    expectedActorAlive,
    expectedActorStatus,
    expectedActionState,
    expectedStatusText,
    expectedPrivateCount,
    expectedPrivateReceipt,
    expectedBoundaryText,
    expectedCommandStateEndpoint,
    expectedNotificationsEndpoint,
  });
}

function assertCoreLoopDayThreeVoteResolutionSurface(
  dayThreeVoteResolutionSurface,
) {
  const expectedGame = gameFromRoleUrl(
    dayThreeVoteResolutionSurface?.sourceActionPlayerRoleUrl,
  );
  assertDayThreeVoteResolutionSurfaceCase({
    dayThreeVoteResolutionSurface,
    expectedGame,
    assertHostPhaseTransitionActionProof:
      assertCoreLoopHostPhaseTransitionActionProof,
  });
}

function assertCoreLoopPostDayThreeResolutionSurface(postDayThreeResolutionSurface) {
  const expectedGame = gameFromRoleUrl(
    postDayThreeResolutionSurface?.sourceHostRoleUrl,
  );
  assertPostDayThreeResolutionSurfaceCase({
    postDayThreeResolutionSurface,
    expectedGame,
    assertPostDayThreePlayerSurfaceProof:
      assertCoreLoopPostDayThreePlayerSurfaceProof,
    assertHostPhaseTransitionActionProof:
      assertCoreLoopHostPhaseTransitionActionProof,
  });
}

function assertCoreLoopNightThreeEmptyResolutionSurface(
  nightThreeEmptyResolutionSurface,
) {
  assertNightThreeEmptyResolutionSurfaceCase({
    nightThreeEmptyResolutionSurface,
    assertPostDayThreePlayerSurfaceProof:
      assertCoreLoopPostDayThreePlayerSurfaceProof,
    assertNightThreeEmptyHostTransitionProof:
      assertCoreLoopNightThreeEmptyHostTransitionProof,
  });
}

function assertCoreLoopDayFourSurvivorRoleSurface(dayFourSurvivorRoleSurface) {
  assertDayFourSurvivorRoleSurfaceCase({
    dayFourSurvivorRoleSurface,
    assertPostDayThreePlayerSurfaceProof:
      assertCoreLoopPostDayThreePlayerSurfaceProof,
  });
}

function assertCoreLoopNightFourActionSubmissionSurface(
  nightFourActionSubmissionSurface,
) {
  const expectedGame = gameFromRoleUrl(
    nightFourActionSubmissionSurface?.sourceHostRoleUrl,
  );
  assertNightFourActionSubmissionSurfaceCase({
    nightFourActionSubmissionSurface,
    expectedGame,
    assertDayFourNoLynchVoteProof: assertCoreLoopDayFourNoLynchVoteProof,
    assertDayFourNoLynchHostTransitionProof:
      assertCoreLoopDayFourNoLynchHostTransitionProof,
  });
}

function assertCoreLoopNightFourResolutionReceiptSurface(
  nightFourResolutionReceiptSurface,
) {
  const expectedGame = gameFromRoleUrl(
    nightFourResolutionReceiptSurface?.sourceHostRoleUrl,
  );
  assertNightFourResolutionReceiptSurfaceCase({
    nightFourResolutionReceiptSurface,
    expectedGame,
    assertHostPhaseTransitionActionProof:
      assertCoreLoopHostPhaseTransitionActionProof,
  });
}

function assertCoreLoopPostNightFourTransitionSurface(
  postNightFourTransitionSurface,
) {
  const expectedGame = gameFromRoleUrl(
    postNightFourTransitionSurface?.sourceHostRoleUrl,
  );
  assertPostNightFourTransitionSurfaceCase({
    postNightFourTransitionSurface,
    expectedGame,
    assertHostPhaseTransitionActionProof:
      assertCoreLoopHostPhaseTransitionActionProof,
    assertPlayerSurfaceProof: assertCoreLoopPostDayThreePlayerSurfaceProof,
    assertStaleActionRecoveryProof:
      assertCoreLoopStaleNightFourActionRecoveryProof,
  });
}

function assertCoreLoopStaleNightFourActionRecoveryProof({
  proof,
  expectedGame,
  sourceRoleUrl,
}) {
  assertStaleNightFourActionRecoveryProofCase({
    proof,
    expectedGame,
    sourceRoleUrl,
  });
}

function assertCoreLoopDayFiveNoLynchResolutionSurface(
  dayFiveNoLynchResolutionSurface,
) {
  assertDayFiveNoLynchResolutionSurfaceProof({
    dayFiveNoLynchResolutionSurface,
    assertHostPhaseTransitionActionProof:
      assertCoreLoopHostPhaseTransitionActionProof,
    assertPostDayThreePlayerSurfaceProof:
      assertCoreLoopPostDayThreePlayerSurfaceProof,
  });
}
function assertCoreLoopCompletedGameEndgameSurface(completedGameEndgameSurface) {
  const scenarioFamilies = completedGameProofReadinessScenarioFamilies();
  assertCompletedGameProofReadinessSurfaceProof({
    completedGameEndgameSurface,
    scenarioFamilies,
    assertPostDayThreePlayerSurfaceProof:
      assertCoreLoopPostDayThreePlayerSurfaceProof,
    assertHostPhaseTransitionActionProof:
      assertCoreLoopHostPhaseTransitionActionProof,
  });
}

function assertCoreLoopDayFourNoLynchVoteProof({
  proof,
  expectedGame,
  sourceRoleUrl,
}) {
  assertDayFourNoLynchVoteProofCase({
    proof,
    expectedGame,
    sourceRoleUrl,
  });
}

function assertCoreLoopDayFourNoLynchHostTransitionProof({
  proof,
  expectedGame,
  sourceRoleUrl,
}) {
  assertDayFourNoLynchHostTransitionProofCase({
    proof,
    expectedGame,
    sourceRoleUrl,
    assertHostPhaseTransitionActionProof:
      assertCoreLoopHostPhaseTransitionActionProof,
  });
}

function assertCoreLoopPostDayThreePlayerSurfaceProof({
  proof,
  sourceRoleUrl,
  expectedSlot,
  slotField,
  expectedPrincipalUserId,
  expectedPhaseId,
  expectedPhaseState,
  expectedActorAlive,
  expectedActorStatus,
  expectedActionState,
  expectedStatusText,
  expectedPrivateCount,
  expectedPrivateReceipt,
  expectedBoundaryText,
  expectedResyncFromSeq,
  expectedCommandStateEndpoint,
  expectedNotificationsEndpoint,
  expectedVoteButtonCount = 0,
  expectedVoteTargetCount = 0,
  expectedLastVoteOutcomePhaseId = "D03",
  expectedPrivateReceiptStatus = "day_vote",
  expectedPrivateReceiptPhaseId = "D03",
}) {
  assertPostDayThreePlayerSurfaceProofCase({
    proof,
    sourceRoleUrl,
    expectedSlot,
    slotField,
    expectedPrincipalUserId,
    expectedPhaseId,
    expectedPhaseState,
    expectedActorAlive,
    expectedActorStatus,
    expectedActionState,
    expectedStatusText,
    expectedPrivateCount,
    expectedPrivateReceipt,
    expectedBoundaryText,
    expectedResyncFromSeq,
    expectedCommandStateEndpoint,
    expectedNotificationsEndpoint,
    expectedVoteButtonCount,
    expectedVoteTargetCount,
    expectedLastVoteOutcomePhaseId,
    expectedPrivateReceiptStatus,
    expectedPrivateReceiptPhaseId,
  });
}

function assertCoreLoopNightThreeEmptyHostTransitionProof({
  proof,
  expectedGame,
  sourceRoleUrl,
}) {
  assertEmptyNightThreeHostTransitionProofCase({
    proof,
    expectedGame,
    sourceRoleUrl,
    assertHostPhaseTransitionActionProof:
      assertCoreLoopHostPhaseTransitionActionProof,
  });
}

function assertCoreLoopHostStaleAdvanceAfterTransitionProof({
  staleProof,
  expectedGame,
}) {
  assertHostStaleAdvanceAfterTransitionProofCase({
    proof: staleProof,
    expectedGame,
  });
}

function assertCoreLoopHostPhaseTransitionActionProof({
  proof,
  expectedGame,
  actionId,
  commandKind,
  streamSeq,
  expectedPhaseId,
  expectedPhaseState,
  expectedDeadlineAffordance = hostDeadlineAffordanceForPhaseState(
    expectedPhaseState,
  ),
  expectedRefreshKeys,
}) {
  assertHostPhaseTransitionActionProofCase({
    proof,
    expectedGame,
    actionId,
    commandKind,
    streamSeq,
    expectedPhaseId,
    expectedPhaseState,
    expectedDeadlineAffordance,
    expectedRefreshKeys,
  });
}

function assertCoreLoopPlayerStaleVoteAfterTransitionProof({
  staleProof,
  expectedGame,
}) {
  assertPlayerStaleVoteAfterTransitionProofCase({
    proof: staleProof,
    expectedGame,
  });
}

function assertCoreLoopPlayerStaleActionAfterTransitionProof({
  staleProof,
  expectedGame,
}) {
  assertPlayerStaleActionAfterTransitionProofCase({
    proof: staleProof,
    expectedGame,
  });
}

function gameFromRoleUrl(roleUrl) {
  try {
    return new URL(roleUrl).pathname.split("/")[2] ?? "";
  } catch {
    return "";
  }
}

function sameStringArray(actual, expected) {
  if (!Array.isArray(actual) || !Array.isArray(expected)) {
    return false;
  }
  return (
    actual.length === expected.length &&
    actual.every((item, index) => item === expected[index])
  );
}

function buildCoreLoopReadinessSpineTargets(coreLoopAdminProofEvidence) {
  const rowIds = coreLoopAdminProofEvidence.coreLoopSpineRows ?? {};
  const cycleIds = [...(rowIds.cycles ?? [])];
  const roleUrlIds = [...(rowIds.roleUrls ?? [])];
  const checkpointIds = [...(rowIds.checkpoints ?? [])];
  const recoveryHookIds = [...(rowIds.recoveryHooks ?? [])];
  const defaultCycleId = cycleIds.includes("d02-n02")
    ? "d02-n02"
    : String(cycleIds[0] ?? "");
  const defaultRoleUrlId =
    roleUrlIds.find((id) => id === `${defaultCycleId}-actionPlayer`) ??
    String(roleUrlIds[0] ?? "");
  const defaultCheckpointId =
    checkpointIds.find((id) => id === "d02-n02-n02-action-open") ??
    String(checkpointIds[0] ?? "");
  const defaultRoleUrl = String(rowIds.roleUrlHrefs?.[defaultRoleUrlId] ?? "");
  return {
    status: "passed",
    detailRoleUrl: coreLoopAdminProofEvidence.detailRoleUrl,
    defaultCycleId,
    defaultRoleUrlId,
    defaultRoleUrl,
    defaultCheckpointId,
    browserProofCommand: devTestGameSeededBrowserProofCommand,
    cycleIds,
    roleUrlIds,
    checkpointIds,
    visibleAdminCheckIds: [...(coreLoopAdminProofEvidence.visibleChecks ?? [])].map(
      (id) => String(id),
    ),
    recoveryHookIds,
    roleUrlHrefs: { ...(rowIds.roleUrlHrefs ?? {}) },
    productionFeatureTargets: buildProductionFeatureSpineTargetCollection({
      declarations: releaseReadinessProductionFeatureSpineTargets,
      sourceTarget: {
        sourceCheckId: coreLoopFeatureSpineSourceCheckId,
        detailRoleUrl: coreLoopAdminProofEvidence.detailRoleUrl,
        browserProofCommand: devTestGameSeededBrowserProofCommand,
        rerunCommand: devTestGameCoreLoopAdminProofCommand,
        cycleIds,
        roleUrlIds,
        checkpointIds,
        visibleAdminCheckIds: [
          ...(coreLoopAdminProofEvidence.visibleChecks ?? []),
        ].map((id) => String(id)),
        recoveryHookIds,
        roleUrlHrefs: rowIds.roleUrlHrefs ?? {},
      },
      defaultRerunCommandBySourceCheckId:
        defaultProductionFeatureSpineRerunCommands,
    }),
  };
}

function buildHardeningReadinessSpineTargets({
  proof,
  hardeningAdminProofEvidence,
  staleConflictMessageMilestone,
}) {
  const surfaces = [...(staleConflictMessageMilestone.surfaces ?? [])];
  const completedGameRows = buildCompletedGameHardeningSpineRows(proof);
  const staleConflictRoleUrlHrefs = Object.fromEntries(
    surfaces
      .filter(
        (surface) =>
          typeof surface.laneId === "string" &&
          typeof surface.roleUrl === "string" &&
          surface.roleUrl !== "",
      )
      .map((surface) => [surface.laneId, surface.roleUrl]),
  );
  const roleUrlHrefs = {
    ...staleConflictRoleUrlHrefs,
    ...completedGameRows.roleUrlHrefs,
  };
  const cycleIds = [
    "hardening-stale-conflict",
    ...(completedGameRows.roleUrlIds.length === 0
      ? []
      : [completedGameHardeningSpineCycleId]),
  ];
  const roleUrlIds = [
    ...surfaces.map((surface) => String(surface.laneId)),
    ...completedGameRows.roleUrlIds,
  ];
  const checkpointIds = [...roleUrlIds];
  const replacementStaleConflictLane =
    replacementStaleConflictMessageSpineLaneCase();
  const defaultRoleUrlId = roleUrlIds.includes(
    replacementStaleConflictLane.laneId,
  )
    ? replacementStaleConflictLane.laneId
    : String(roleUrlIds[0] ?? "");
  return {
    status: "passed",
    detailRoleUrl: hardeningAdminProofEvidence.detailRoleUrl,
    defaultCycleId: "hardening-stale-conflict",
    defaultRoleUrlId,
    defaultRoleUrl: String(roleUrlHrefs[defaultRoleUrlId] ?? ""),
    defaultCheckpointId: defaultRoleUrlId,
    browserProofCommand: devTestGameSeededBrowserProofCommand,
    cycleIds,
    roleUrlIds,
    checkpointIds,
    visibleAdminCheckIds: [
      ...(hardeningAdminProofEvidence.visibleChecks ?? []),
    ].map((id) => String(id)),
    recoveryHookIds: [],
    roleUrlHrefs,
    productionFeatureTargets: buildProductionFeatureSpineTargetCollection({
      declarations: releaseReadinessProductionFeatureSpineTargets,
      sourceTarget: {
        sourceCheckId: hardeningFeatureSpineSourceCheckId,
        detailRoleUrl: hardeningAdminProofEvidence.detailRoleUrl,
        browserProofCommand: devTestGameSeededBrowserProofCommand,
        rerunCommand: devTestGameHardeningAdminProofCommand,
        cycleIds,
        roleUrlIds,
        checkpointIds,
        visibleAdminCheckIds: [
          ...(hardeningAdminProofEvidence.visibleChecks ?? []),
        ].map((id) => String(id)),
        recoveryHookIds: [],
        roleUrlHrefs,
      },
      defaultRerunCommandBySourceCheckId:
        defaultProductionFeatureSpineRerunCommands,
    }),
  };
}

function buildCompletedGameHardeningSpineRows(proof) {
  const frontendBaseUrl = String(proof?.session?.frontendBaseUrl ?? "").replace(
    /\/$/,
    "",
  );
  const laneById = new Map((proof?.lanes ?? []).map((lane) => [lane.id, lane]));
  const laneCases = completedGameHardeningSpineLaneCases();
  const roleUrlHrefs = Object.fromEntries(
    laneCases
      .map((scenario) => {
        const lane = laneById.get(scenario.id);
        const game = String(lane?.evidence?.game ?? "");
        if (
          lane?.status !== "passed" ||
          frontendBaseUrl === "" ||
          game === ""
        ) {
          return null;
        }
        return [
          scenario.id,
          completedGameHardeningSpineRoleUrl({
            frontendBaseUrl,
            game,
            role: scenario.role,
          }),
        ];
      })
      .filter((entry) => entry !== null),
  );
  return {
    roleUrlIds: laneCases
      .map((scenario) => scenario.id)
      .filter((laneId) => roleUrlHrefs[laneId] !== undefined),
    roleUrlHrefs,
  };
}

function completedGameHardeningSpineRoleUrl({ frontendBaseUrl, game, role }) {
  return `${frontendBaseUrl}/g/${game}${role === "host" ? "/host" : ""}`;
}

function assertVisibleAdminRows({ label, visibleRows, requiredRows }) {
  if (!Array.isArray(requiredRows) || requiredRows.length === 0) {
    throw new Error(`${label}: generated row list missing`);
  }
  const visible = Array.isArray(visibleRows) ? visibleRows : [];
  for (const rowId of requiredRows) {
    if (!visible.includes(rowId)) {
      throw new Error(`${label}: ${rowId}`);
    }
  }
}

export function validateDevTestGameHardeningAdminProof(proof, options = {}) {
  const requiredChecks = hardeningAuditLaneIds;
  if (proof?.version !== 1) {
    throw new Error(`hardening admin proof version drifted: ${proof?.version}`);
  }
  if (proof.proof !== "dev-test-game-hardening-admin-proof") {
    throw new Error(`unexpected hardening admin proof id: ${proof.proof}`);
  }
  if (proof.status !== "passed") {
    throw new Error(`hardening admin proof status is ${proof.status}`);
  }
  if (proof.scope !== "local-dev-test-game-hardening-admin-surface") {
    throw new Error(`hardening admin proof scope drifted: ${proof.scope}`);
  }
  if (proof.productionReady !== false || proof.releaseReady !== false) {
    throw new Error("hardening admin proof must not claim production or release readiness");
  }
  if (
    proof.adminRoleSurface?.clickedThroughFromOverview !== true ||
    proof.adminRoleSurface?.rawInviteTokensVisible !== false
  ) {
    throw new Error("hardening admin proof did not prove admin overview click-through");
  }
  if (
    proof.playerRecoveryRoleSurface?.clickedThroughFromOverview !== true ||
    proof.playerRecoveryRoleSurface?.rawInviteTokensVisible !== false
  ) {
    throw new Error("hardening admin proof did not prove player recovery click-through");
  }
  for (const checkId of requiredChecks) {
    if (!proof.adminRoleSurface?.visibleChecks?.includes(checkId)) {
      throw new Error(`hardening admin proof missing visible check: ${checkId}`);
    }
  }
  for (const checkId of playerRecoveryAuditLaneIds) {
    if (!proof.playerRecoveryRoleSurface?.visibleChecks?.includes(checkId)) {
      throw new Error(`player recovery admin proof missing visible check: ${checkId}`);
    }
  }
  return {
    status: "passed",
    path: options.path ?? "target/dev-test-game/hardening-admin-proof.json",
    proofBoundary: proof.proofBoundary,
    overviewRoleUrl: proof.adminRoleSurface.overviewRoleUrl,
    detailRoleUrl: proof.adminRoleSurface.detailRoleUrl,
    visibleChecks: proof.adminRoleSurface.visibleChecks,
    ...(options.artifact === undefined ? {} : { artifact: options.artifact }),
  };
}

export function validateDevTestGameBackupAdminProof(proof, options = {}) {
  const requiredChecks = [
    "dump-created",
    "event-log-restored",
    "projection-fingerprints-restored",
    "auth-sessions-restored",
    "restored-api-capabilities",
  ];
  const requiredSessions = ["host", "player", "admin"];
  if (proof?.version !== 1) {
    throw new Error(`backup admin proof version drifted: ${proof?.version}`);
  }
  if (proof.proof !== "dev-test-game-backup-admin-proof") {
    throw new Error(`unexpected backup admin proof id: ${proof.proof}`);
  }
  if (proof.status !== "passed") {
    throw new Error(`backup admin proof status is ${proof.status}`);
  }
  if (proof.scope !== "local-dev-test-game-backup-admin-surface") {
    throw new Error(`backup admin proof scope drifted: ${proof.scope}`);
  }
  if (proof.productionReady !== false || proof.releaseReady !== false) {
    throw new Error("backup admin proof must not claim production or release readiness");
  }
  if (
    proof.adminRoleSurface?.clickedThroughFromOverview !== true ||
    proof.adminRoleSurface?.rawInviteTokensVisible !== false
  ) {
    throw new Error("backup admin proof did not prove admin overview click-through");
  }
  for (const checkId of requiredChecks) {
    if (!proof.adminRoleSurface?.visibleChecks?.includes(checkId)) {
      throw new Error(`backup admin proof missing visible check: ${checkId}`);
    }
  }
  for (const sessionRole of requiredSessions) {
    if (!proof.adminRoleSurface?.visibleSessions?.includes(sessionRole)) {
      throw new Error(`backup admin proof missing visible session: ${sessionRole}`);
    }
  }
  return {
    status: "passed",
    path: options.path ?? "target/dev-test-game/backup-admin-proof.json",
    proofBoundary: proof.proofBoundary,
    overviewRoleUrl: proof.adminRoleSurface.overviewRoleUrl,
    detailRoleUrl: proof.adminRoleSurface.detailRoleUrl,
    visibleChecks: proof.adminRoleSurface.visibleChecks,
    visibleSessions: proof.adminRoleSurface.visibleSessions,
    ...(options.artifact === undefined ? {} : { artifact: options.artifact }),
  };
}

export function validateDevTestGameOpsArtifacts(ops, options = {}) {
  const requiredChecks = [
    "source-artifacts-checksummed",
    "role-entrypoints-redacted",
    "proof-lanes-summarized",
    "proof-stability-summarized",
    "release-boundary-carried",
  ];
  if (ops?.version !== 1) {
    throw new Error(`ops artifact version drifted: ${ops?.version}`);
  }
  if (ops.proof !== "dev-test-game-ops-artifacts") {
    throw new Error(`unexpected ops artifact proof id: ${ops.proof}`);
  }
  if (ops.status !== "passed") {
    throw new Error(`ops artifact status is ${ops.status}`);
  }
  if (ops.scope !== "local-dev-test-game-ops-artifacts") {
    throw new Error(`ops artifact scope drifted: ${ops.scope}`);
  }
  if (ops.productionReady !== false || ops.releaseReady !== false) {
    throw new Error("ops artifact must not claim production or release readiness");
  }
  const checks = new Map((ops.checks ?? []).map((check) => [check.id, check.status]));
  for (const id of requiredChecks) {
    if (checks.get(id) !== "passed") {
      throw new Error(`ops artifact missing passed check: ${id}`);
    }
  }
  if (/invite=(?!REDACTED)/.test(JSON.stringify(ops))) {
    throw new Error("ops artifact leaked an invite URL token");
  }
  return {
    status: "passed",
    path: options.path ?? "target/dev-test-game/ops-artifacts.json",
    checkCount: requiredChecks.length,
    roleCount: ops.run?.roleCount ?? 0,
    laneCount: ops.proofRun?.laneCount ?? 0,
    proofBoundary: ops.proofBoundary,
    scope: ops.scope,
    productionReady: ops.productionReady,
    ...(options.artifact === undefined ? {} : { artifact: options.artifact }),
  };
}

export function validateDevTestGameOpsAdminProof(proof, options = {}) {
  const requiredChecks = [
    "source-artifacts-checksummed",
    "role-entrypoints-redacted",
    "proof-lanes-summarized",
    "proof-stability-summarized",
    "release-boundary-carried",
  ];
  if (proof?.version !== 1) {
    throw new Error(`ops admin proof version drifted: ${proof?.version}`);
  }
  if (proof.proof !== "dev-test-game-ops-admin-proof") {
    throw new Error(`unexpected ops admin proof id: ${proof.proof}`);
  }
  if (proof.status !== "passed") {
    throw new Error(`ops admin proof status is ${proof.status}`);
  }
  if (proof.scope !== "local-dev-test-game-ops-admin-surface") {
    throw new Error(`ops admin proof scope drifted: ${proof.scope}`);
  }
  if (proof.productionReady !== false || proof.releaseReady !== false) {
    throw new Error("ops admin proof must not claim production or release readiness");
  }
  if (
    proof.adminRoleSurface?.clickedThroughFromOverview !== true ||
    proof.adminRoleSurface?.rawInviteTokensVisible !== false
  ) {
    throw new Error("ops admin proof did not prove admin overview click-through");
  }
  for (const checkId of requiredChecks) {
    if (!proof.adminRoleSurface?.visibleChecks?.includes(checkId)) {
      throw new Error(`ops admin proof missing visible check: ${checkId}`);
    }
  }
  return {
    status: "passed",
    path: options.path ?? "target/dev-test-game/ops-admin-proof.json",
    proofBoundary: proof.proofBoundary,
    overviewRoleUrl: proof.adminRoleSurface.overviewRoleUrl,
    detailRoleUrl: proof.adminRoleSurface.detailRoleUrl,
    visibleChecks: proof.adminRoleSurface.visibleChecks,
    ...(options.artifact === undefined ? {} : { artifact: options.artifact }),
  };
}

export function validateDevTestGameHostedOpsSignals(signals, options = {}) {
  const requiredChecks = hostedOpsSignalCheckIds;
  if (
    signals?.version !== 1 ||
    signals.proof !== "dev-test-game-hosted-ops-signals" ||
    signals.status !== "passed" ||
    signals.scope !== "local-hosted-like-ops-signals"
  ) {
    throw new Error("hosted ops signals shape drifted");
  }
  if (signals.productionReady !== false || signals.releaseReady !== false) {
    throw new Error("hosted ops signals must not claim production or release readiness");
  }
  const checks = new Map((signals.checks ?? []).map((check) => [check.id, check.status]));
  for (const id of requiredChecks) {
    if (!["passed", "unproven"].includes(String(checks.get(id)))) {
      throw new Error(`hosted ops signals missing check: ${id}`);
    }
  }
  if (checks.get(hostedOpsReadinessBoundaryCheckId) !== "passed") {
    throw new Error("hosted ops signals readiness boundary did not pass");
  }
  if (
    Number(signals.matrix?.cellCount ?? 0) <= 0 ||
    signals.matrix?.passedCellCount !== signals.matrix?.cellCount ||
    signals.matrix?.reloadCoveredCellCount !== signals.matrix?.cellCount ||
    Number(signals.matrix?.reconnectLaneCount ?? 0) <= 0 ||
    Number(signals.matrix?.staleConflictLaneCount ?? 0) <= 0
  ) {
    throw new Error("hosted ops signals matrix counters drifted");
  }
  if (
    typeof signals.target?.game !== "string" ||
    typeof signals.target?.apiBaseUrl !== "string" ||
    typeof signals.target?.frontendBaseUrl !== "string"
  ) {
    throw new Error("hosted ops signals target drifted");
  }
  if (/invite=(?!REDACTED)/.test(JSON.stringify(signals))) {
    throw new Error("hosted ops signals leaked an invite URL token");
  }
  return {
    status: "passed",
    path: options.path ?? "target/dev-test-game/hosted-ops-signals.json",
    proofBoundary: signals.proofBoundary,
    cellCount: signals.matrix.cellCount,
    reconnectLaneCount: signals.matrix.reconnectLaneCount,
    staleConflictLaneCount: signals.matrix.staleConflictLaneCount,
    realHostedDeploymentStatus: String(
      signals.target.realHostedDeploymentStatus ?? "unknown",
    ),
    hostedTelemetryStatus: String(
      checks.get(hostedOpsTelemetryBoundaryCheckId) ?? "unknown",
    ),
    ...(options.artifact === undefined ? {} : { artifact: options.artifact }),
  };
}

export function validateDevTestGameHostedOpsSignalsAdminProof(proof, options = {}) {
  const requiredChecks = hostedOpsSignalCheckIds;
  if (
    proof?.version !== 1 ||
    proof.proof !== "dev-test-game-hosted-ops-signals-admin-proof" ||
    proof.status !== "passed" ||
    proof.scope !== "local-dev-test-game-hosted-ops-signals-admin-surface"
  ) {
    throw new Error("hosted ops signals admin proof shape drifted");
  }
  if (proof.productionReady !== false || proof.releaseReady !== false) {
    throw new Error("hosted ops signals admin proof must not claim production readiness");
  }
  if (
    proof.adminRoleSurface?.clickedThroughFromOverview !== true ||
    proof.adminRoleSurface?.rawInviteTokensVisible !== false
  ) {
    throw new Error("hosted ops signals admin proof did not prove admin overview click-through");
  }
  for (const checkId of requiredChecks) {
    if (!proof.adminRoleSurface?.visibleChecks?.includes(checkId)) {
      throw new Error(`hosted ops signals admin proof missing visible check: ${checkId}`);
    }
  }
  return {
    status: "passed",
    path: options.path ?? "target/dev-test-game/hosted-ops-signals-admin-proof.json",
    proofBoundary: proof.proofBoundary,
    overviewRoleUrl: proof.adminRoleSurface.overviewRoleUrl,
    detailRoleUrl: proof.adminRoleSurface.detailRoleUrl,
    visibleChecks: proof.adminRoleSurface.visibleChecks,
    visibleRelatedLinks: proof.adminRoleSurface.visibleRelatedLinks,
    ...(options.artifact === undefined ? {} : { artifact: options.artifact }),
  };
}

export function validateDevTestGameRealHostedObservabilityHandoffAdminProof(
  proof,
  options = {},
) {
  const requiredChecks = realHostedObservabilityHandoffCheckIds;
  if (
    proof?.version !== 1 ||
    proof.proof !==
      "dev-test-game-real-hosted-observability-handoff-admin-proof" ||
    proof.status !== "passed" ||
    proof.scope !==
      "local-dev-test-game-real-hosted-observability-handoff-admin-surface"
  ) {
    throw new Error("real hosted observability handoff admin proof shape drifted");
  }
  if (proof.productionReady !== false || proof.releaseReady !== false) {
    throw new Error(
      "real hosted observability handoff admin proof must not claim readiness",
    );
  }
  if (
    proof.adminRoleSurface?.clickedThroughFromOverview !== true ||
    proof.adminRoleSurface?.rawInviteTokensVisible !== false
  ) {
    throw new Error(
      "real hosted observability handoff admin proof did not prove admin overview click-through",
    );
  }
  for (const checkId of requiredChecks) {
    if (!proof.adminRoleSurface?.visibleChecks?.includes(checkId)) {
      throw new Error(
        `real hosted observability handoff admin proof missing visible check: ${checkId}`,
      );
    }
  }
  for (const inputId of realHostedObservabilityHandoffInputIds) {
    if (
      !proof.adminRoleSurface?.visibleHostedHandoffInputs?.includes(inputId)
    ) {
      throw new Error(
        `real hosted observability handoff admin proof missing input: ${inputId}`,
      );
    }
  }
  return {
    status: "passed",
    path:
      options.path ??
      "target/dev-test-game/real-hosted-observability-handoff-admin-proof.json",
    proofBoundary: proof.proofBoundary,
    overviewRoleUrl: proof.adminRoleSurface.overviewRoleUrl,
    detailRoleUrl: proof.adminRoleSurface.detailRoleUrl,
    visibleChecks: proof.adminRoleSurface.visibleChecks,
    visibleUnproven: proof.adminRoleSurface.visibleUnproven,
    visibleHostedHandoffInputs:
      proof.adminRoleSurface.visibleHostedHandoffInputs,
    visibleHostedHandoffBlockedChecks:
      proof.adminRoleSurface.visibleHostedHandoffBlockedChecks,
    visibleRelatedLinks: proof.adminRoleSurface.visibleRelatedLinks,
    ...(options.artifact === undefined ? {} : { artifact: options.artifact }),
  };
}

export function validateDevTestGameHostedTargetPreflightAdminProof(
  proof,
  options = {},
) {
  const requiredChecks = hostedTargetPreflightCheckIds;
  if (
    proof?.version !== 1 ||
    proof.proof !== "dev-test-game-hosted-target-preflight-admin-proof" ||
    proof.status !== "passed" ||
    proof.scope !== "local-dev-test-game-hosted-target-preflight-admin-surface"
  ) {
    throw new Error("hosted target preflight admin proof shape drifted");
  }
  if (proof.productionReady !== false || proof.releaseReady !== false) {
    throw new Error("hosted target preflight admin proof must not claim readiness");
  }
  if (
    proof.adminRoleSurface?.clickedThroughFromOverview !== true ||
    proof.adminRoleSurface?.rawInviteTokensVisible !== false
  ) {
    throw new Error(
      "hosted target preflight admin proof did not prove admin overview click-through",
    );
  }
  for (const checkId of requiredChecks) {
    if (!proof.adminRoleSurface?.visibleChecks?.includes(checkId)) {
      throw new Error(
        `hosted target preflight admin proof missing visible check: ${checkId}`,
      );
    }
  }
  for (const checkId of proof.generatedFrom?.blockedCheckIds ?? []) {
    if (!proof.adminRoleSurface?.visibleUnproven?.includes(checkId)) {
      throw new Error(
        `hosted target preflight admin proof missing blocked row: ${checkId}`,
      );
    }
  }
  for (const linkId of proof.generatedFrom?.relatedAuditIds ?? []) {
    if (!proof.adminRoleSurface?.visibleRelatedLinks?.includes(linkId)) {
      throw new Error(
        `hosted target preflight admin proof missing related link: ${linkId}`,
      );
    }
  }
  for (const inputId of proof.generatedFrom?.hostedHandoffInputIds ?? []) {
    if (!proof.adminRoleSurface?.visibleHostedHandoffInputs?.includes(inputId)) {
      throw new Error(
        `hosted target preflight admin proof missing handoff input: ${inputId}`,
      );
    }
  }
  for (const checkId of proof.generatedFrom?.hostedHandoffBlockedCheckIds ?? []) {
    if (
      !proof.adminRoleSurface?.visibleHostedHandoffBlockedChecks?.includes(
        checkId,
      )
    ) {
      throw new Error(
        `hosted target preflight admin proof missing handoff blocked check: ${checkId}`,
      );
    }
  }
  for (const sectionId of proof.generatedFrom?.hostedHandoffInputSectionIds ?? []) {
    if (
      !proof.adminRoleSurface?.visibleHostedHandoffInputSections?.includes(
        sectionId,
      )
    ) {
      throw new Error(
        `hosted target preflight admin proof missing handoff input section: ${sectionId}`,
      );
    }
  }
  for (const rowId of proof.generatedFrom?.hostedHandoffSectionInputIds ?? []) {
    if (
      !proof.adminRoleSurface?.visibleHostedHandoffSectionInputs?.includes(rowId)
    ) {
      throw new Error(
        `hosted target preflight admin proof missing handoff section input: ${rowId}`,
      );
    }
  }
  const expectedSummary = proof.generatedFrom?.hostedHandoffSummary;
  if (expectedSummary !== undefined) {
    const summary = proof.adminRoleSurface?.visibleHostedHandoffSummary;
    if (
      summary?.status !== expectedSummary.status ||
      summary?.preflightStatus !== expectedSummary.preflightStatus ||
      summary?.command !== expectedSummary.command ||
      summary?.proofTarget !== expectedSummary.proofTarget
    ) {
      throw new Error(
        "hosted target preflight admin proof missing hosted handoff summary",
      );
    }
  }
  return {
    status: "passed",
    path:
      options.path ??
      "target/dev-test-game/hosted-target-preflight-admin-proof.json",
    proofBoundary: proof.proofBoundary,
    overviewRoleUrl: proof.adminRoleSurface.overviewRoleUrl,
    detailRoleUrl: proof.adminRoleSurface.detailRoleUrl,
    visibleChecks: proof.adminRoleSurface.visibleChecks,
    visibleUnproven: proof.adminRoleSurface.visibleUnproven,
    visibleRelatedLinks: proof.adminRoleSurface.visibleRelatedLinks ?? [],
    visibleHostedHandoffInputs:
      proof.adminRoleSurface.visibleHostedHandoffInputs ?? [],
    visibleHostedHandoffBlockedChecks:
      proof.adminRoleSurface.visibleHostedHandoffBlockedChecks ?? [],
    visibleHostedHandoffInputSections:
      proof.adminRoleSurface.visibleHostedHandoffInputSections ?? [],
    visibleHostedHandoffSectionInputs:
      proof.adminRoleSurface.visibleHostedHandoffSectionInputs ?? [],
    visibleHostedHandoffSummary:
      proof.adminRoleSurface.visibleHostedHandoffSummary ?? null,
    preflightStatus: String(proof.generatedFrom?.status ?? "unknown"),
    ...(options.artifact === undefined ? {} : { artifact: options.artifact }),
  };
}

export function validateDevTestGameHostedEvidenceLaneAdminProof(proof, options = {}) {
  if (
    proof?.version !== 1 ||
    proof.proof !== "dev-test-game-hosted-evidence-lane-admin-proof" ||
    proof.status !== "passed" ||
    proof.scope !== "local-dev-test-game-hosted-evidence-lane-admin-surface"
  ) {
    throw new Error("hosted evidence lane admin proof shape drifted");
  }
  if (proof.productionReady !== false || proof.releaseReady !== false) {
    throw new Error("hosted evidence lane admin proof must not claim readiness");
  }
  if (
    proof.adminRoleSurface?.clickedThroughFromOverview !== true ||
    proof.adminRoleSurface?.rawInviteTokensVisible !== false
  ) {
    throw new Error(
      "hosted evidence lane admin proof did not prove admin overview click-through",
    );
  }
  for (const checkId of proof.generatedFrom?.checkIds ?? []) {
    if (!proof.adminRoleSurface?.visibleChecks?.includes(checkId)) {
      throw new Error(
        `hosted evidence lane admin proof missing visible check: ${checkId}`,
      );
    }
  }
  for (const checkId of proof.generatedFrom?.blockedCheckIds ?? []) {
    if (!proof.adminRoleSurface?.visibleUnproven?.includes(checkId)) {
      throw new Error(
        `hosted evidence lane admin proof missing blocked row: ${checkId}`,
      );
    }
  }
  for (const linkId of proof.generatedFrom?.relatedAuditIds ?? []) {
    if (!proof.adminRoleSurface?.visibleRelatedLinks?.includes(linkId)) {
      throw new Error(
        `hosted evidence lane admin proof missing related link: ${linkId}`,
      );
    }
  }
  for (const inputId of proof.generatedFrom?.hostedHandoffInputIds ?? []) {
    if (!proof.adminRoleSurface?.visibleHostedHandoffInputs?.includes(inputId)) {
      throw new Error(
        `hosted evidence lane admin proof missing handoff input: ${inputId}`,
      );
    }
  }
  for (const [inputId, expected] of Object.entries(
    proof.generatedFrom?.hostedHandoffInputValues ?? {},
  )) {
    const visibleText =
      proof.adminRoleSurface?.visibleHostedHandoffInputValues?.[inputId] ?? "";
    if (!visibleText.includes(expected)) {
      throw new Error(
        `hosted evidence lane admin proof missing handoff input value: ${inputId}`,
      );
    }
  }
  for (const checkId of proof.generatedFrom?.hostedHandoffBlockedCheckIds ?? []) {
    if (
      !proof.adminRoleSurface?.visibleHostedHandoffBlockedChecks?.includes(
        checkId,
      )
    ) {
      throw new Error(
        `hosted evidence lane admin proof missing handoff blocked check: ${checkId}`,
      );
    }
  }
  for (const groupId of proof.generatedFrom?.hostedHandoffGroupIds ?? []) {
    if (
      !proof.adminRoleSurface?.visibleHostedHandoffGroups?.includes(groupId)
    ) {
      throw new Error(
        `hosted evidence lane admin proof missing handoff group: ${groupId}`,
      );
    }
  }
  for (const sectionId of proof.generatedFrom?.hostedHandoffInputSectionIds ?? []) {
    if (
      !proof.adminRoleSurface?.visibleHostedHandoffInputSections?.includes(
        sectionId,
      )
    ) {
      throw new Error(
        `hosted evidence lane admin proof missing handoff input section: ${sectionId}`,
      );
    }
  }
  for (const rowId of proof.generatedFrom?.hostedHandoffSectionInputIds ?? []) {
    if (
      !proof.adminRoleSurface?.visibleHostedHandoffSectionInputs?.includes(rowId)
    ) {
      throw new Error(
        `hosted evidence lane admin proof missing handoff section input: ${rowId}`,
      );
    }
  }
  return {
    status: "passed",
    path:
      options.path ??
      "target/dev-test-game/hosted-evidence-lane-admin-proof.json",
    proofBoundary: proof.proofBoundary,
    overviewRoleUrl: proof.adminRoleSurface.overviewRoleUrl,
    detailRoleUrl: proof.adminRoleSurface.detailRoleUrl,
    visibleChecks: proof.adminRoleSurface.visibleChecks,
    visibleUnproven: proof.adminRoleSurface.visibleUnproven,
    visibleRelatedLinks: proof.adminRoleSurface.visibleRelatedLinks,
    visibleHostedHandoffInputs:
      proof.adminRoleSurface.visibleHostedHandoffInputs ?? [],
    visibleHostedHandoffInputValues:
      proof.adminRoleSurface.visibleHostedHandoffInputValues ?? {},
    visibleHostedHandoffBlockedChecks:
      proof.adminRoleSurface.visibleHostedHandoffBlockedChecks ?? [],
    visibleHostedHandoffGroups:
      proof.adminRoleSurface.visibleHostedHandoffGroups ?? [],
    visibleHostedHandoffInputSections:
      proof.adminRoleSurface.visibleHostedHandoffInputSections ?? [],
    visibleHostedHandoffSectionInputs:
      proof.adminRoleSurface.visibleHostedHandoffSectionInputs ?? [],
    visibleHostedHandoffSummary:
      proof.adminRoleSurface.visibleHostedHandoffSummary ?? null,
    laneStatus: String(proof.generatedFrom?.status ?? "unknown"),
    preflightStatus: String(proof.generatedFrom?.preflightStatus ?? "unknown"),
    ...(options.artifact === undefined ? {} : { artifact: options.artifact }),
  };
}

export function validateDevTestGameHostedIdentityEvidenceAdminProof(
  proof,
  options = {},
) {
  if (
    proof?.version !== 1 ||
    proof.proof !== "dev-test-game-hosted-identity-evidence-admin-proof" ||
    proof.status !== "passed" ||
    proof.scope !==
      "local-dev-test-game-hosted-identity-evidence-admin-surface"
  ) {
    throw new Error("hosted identity evidence admin proof shape drifted");
  }
  if (proof.productionReady !== false || proof.releaseReady !== false) {
    throw new Error("hosted identity evidence admin proof must not claim readiness");
  }
  if (
    proof.adminRoleSurface?.clickedThroughFromOverview !== true ||
    proof.adminRoleSurface?.rawInviteTokensVisible !== false
  ) {
    throw new Error(
      "hosted identity evidence admin proof did not prove admin overview click-through",
    );
  }
  for (const checkId of proof.generatedFrom?.checkIds ?? []) {
    if (!proof.adminRoleSurface?.visibleChecks?.includes(checkId)) {
      throw new Error(
        `hosted identity evidence admin proof missing visible check: ${checkId}`,
      );
    }
  }
  for (const checkId of proof.generatedFrom?.blockedCheckIds ?? []) {
    if (!proof.adminRoleSurface?.visibleUnproven?.includes(checkId)) {
      throw new Error(
        `hosted identity evidence admin proof missing blocked row: ${checkId}`,
      );
    }
  }
  for (const linkId of proof.generatedFrom?.relatedAuditIds ?? []) {
    if (!proof.adminRoleSurface?.visibleRelatedLinks?.includes(linkId)) {
      throw new Error(
        `hosted identity evidence admin proof missing related link: ${linkId}`,
      );
    }
  }
  for (const inputId of proof.generatedFrom?.hostedHandoffInputIds ?? []) {
    if (!proof.adminRoleSurface?.visibleHostedHandoffInputs?.includes(inputId)) {
      throw new Error(
        `hosted identity evidence admin proof missing handoff input: ${inputId}`,
      );
    }
  }
  for (const checkId of proof.generatedFrom?.hostedHandoffBlockedCheckIds ?? []) {
    if (
      !proof.adminRoleSurface?.visibleHostedHandoffBlockedChecks?.includes(
        checkId,
      )
    ) {
      throw new Error(
        `hosted identity evidence admin proof missing handoff blocked check: ${checkId}`,
      );
    }
  }
  return {
    status: "passed",
    path:
      options.path ??
      "target/dev-test-game/hosted-identity-evidence-admin-proof.json",
    proofBoundary: proof.proofBoundary,
    overviewRoleUrl: proof.adminRoleSurface.overviewRoleUrl,
    detailRoleUrl: proof.adminRoleSurface.detailRoleUrl,
    visibleChecks: proof.adminRoleSurface.visibleChecks,
    visibleUnproven: proof.adminRoleSurface.visibleUnproven,
    visibleRelatedLinks: proof.adminRoleSurface.visibleRelatedLinks,
    visibleHostedHandoffInputs:
      proof.adminRoleSurface.visibleHostedHandoffInputs ?? [],
    visibleHostedHandoffBlockedChecks:
      proof.adminRoleSurface.visibleHostedHandoffBlockedChecks ?? [],
    visibleHostedHandoffGroups:
      proof.adminRoleSurface.visibleHostedHandoffGroups ?? [],
    visibleHostedHandoffInputSections:
      proof.adminRoleSurface.visibleHostedHandoffInputSections ?? [],
    visibleHostedHandoffSectionInputs:
      proof.adminRoleSurface.visibleHostedHandoffSectionInputs ?? [],
    evidenceStatus: String(proof.generatedFrom?.status ?? "unknown"),
    rawEvidencePath: String(proof.generatedFrom?.rawEvidencePath ?? ""),
    rawEvidencePathKind: hostedIdentityEvidencePathKind(
      proof.generatedFrom?.rawEvidencePath,
    ),
    fixtureEvidence:
      hostedIdentityEvidencePathKind(proof.generatedFrom?.rawEvidencePath) ===
      "fixture",
    rawEvidenceStatus: String(
      proof.generatedFrom?.rawEvidenceStatus ?? "unknown",
    ),
    ...(options.artifact === undefined ? {} : { artifact: options.artifact }),
  };
}

export function validateDevTestGameHostedEvidenceLaneDemoProof(proof, options = {}) {
  const validated = assertDevTestGameHostedEvidenceLaneDemoProof(proof);
  if (validated.releaseReady !== false || validated.productionReady !== false) {
    throw new Error("hosted evidence lane demo proof must not claim readiness");
  }
  if (validated.target?.syntheticExternalTarget !== true) {
    throw new Error("hosted evidence lane demo proof must stay synthetic");
  }
  if (
    validated.blockedLane?.status !== "blocked" ||
    validated.passedLane?.status !== "passed"
  ) {
    throw new Error("hosted evidence lane demo proof must carry blocked and passed lanes");
  }
  return {
    status: "passed",
    path: options.path ?? devTestGameHostedEvidenceLaneDemoProofPath,
    proofBoundary: validated.proofBoundary,
    demoOnly: true,
    syntheticExternalTarget: true,
    frontendBaseUrl: String(validated.target.frontendBaseUrl ?? ""),
    apiBaseUrl: String(validated.target.apiBaseUrl ?? ""),
    groupId: String(validated.target.groupId ?? ""),
    blockedLaneStatus: validated.blockedLane.status,
    passedLaneStatus: validated.passedLane.status,
    blockedRoleUrl: validated.handoff.blockedRoleUrl,
    passedRoleUrl: validated.handoff.passedRoleUrl,
    passedNextCommand: validated.handoff.passedNextCommand,
    externalEvidencePath: validated.generatedFrom.externalEvidence,
    externalCellIds: [...validated.externalEvidence.cellIds],
    ...(options.artifact === undefined ? {} : { artifact: options.artifact }),
  };
}

export function validateDevTestGameSeedFixtureSummary(summary, options = {}) {
  const requiredChecks = [
    "role-entrypoints-redacted",
    "seed-slots-enumerated",
    "demo-scenarios-mapped",
    "proof-lanes-carried",
    "release-boundary-carried",
  ];
  const requiredScenarios = seedScenarioCoverageGroups.allDemo;
  if (summary?.version !== 1) {
    throw new Error(`seed fixture summary version drifted: ${summary?.version}`);
  }
  if (summary.proof !== "dev-test-game-seed-fixture-summary") {
    throw new Error(`unexpected seed fixture summary proof id: ${summary.proof}`);
  }
  if (summary.status !== "passed") {
    throw new Error(`seed fixture summary status is ${summary.status}`);
  }
  if (summary.scope !== "local-dev-test-game-seed-fixture") {
    throw new Error(`seed fixture summary scope drifted: ${summary.scope}`);
  }
  if (summary.productionReady !== false || summary.releaseReady !== false) {
    throw new Error("seed fixture summary must not claim production or release readiness");
  }
  const checks = new Map((summary.checks ?? []).map((check) => [check.id, check.status]));
  for (const id of requiredChecks) {
    if (checks.get(id) !== "passed") {
      throw new Error(`seed fixture summary missing passed check: ${id}`);
    }
  }
  const scenarios = new Map(
    (summary.demoScenarios ?? []).map((scenario) => [scenario.id, scenario.status]),
  );
  for (const id of requiredScenarios) {
    if (scenarios.get(id) !== "available_locally") {
      throw new Error(`seed fixture summary missing local scenario: ${id}`);
    }
  }
  if ((summary.fixture?.slots ?? []).length < 5) {
    throw new Error("seed fixture summary must enumerate seeded slots");
  }
  const proofLaneCoverage = validateSeedFixtureProofLaneCoverage(
    summary.proofLaneCoverage,
  );
  const serialized = JSON.stringify(summary);
  if (/invite=(?!REDACTED)/.test(serialized)) {
    throw new Error("seed fixture summary leaked an invite URL token");
  }
  return {
    status: "passed",
    path: options.path ?? "target/dev-test-game/seed-fixture-summary.json",
    checkCount: requiredChecks.length,
    scenarioCount: requiredScenarios.length,
    roleCount: summary.fixture?.roleCount ?? 0,
    slotCount: summary.fixture?.slots?.length ?? 0,
    proofLaneCoverage,
    proofBoundary: summary.proofBoundary,
    scope: summary.scope,
    productionReady: summary.productionReady,
    ...(options.artifact === undefined ? {} : { artifact: options.artifact }),
  };
}

function validateSeedFixtureProofLaneCoverage(coverage) {
  if (coverage?.status !== "passed") {
    throw new Error(`seed fixture proof lane coverage is ${coverage?.status}`);
  }
  if (!Number.isInteger(coverage.passedLaneCount) || coverage.passedLaneCount <= 0) {
    throw new Error("seed fixture proof lane coverage must count passed lanes");
  }
  const aliasOnlyLaneIds = coverage.aliasOnly?.laneIds ?? [];
  const aggregateOnlyLaneIds = coverage.aggregateOnly?.laneIds ?? [];
  const directSeededLaneIds = coverage.directSeeded?.laneIds ?? [];
  const unclassifiedLaneIds = coverage.unclassified?.laneIds ?? [];
  for (const laneId of seedAliasOnlyProofLaneIds) {
    if (!aliasOnlyLaneIds.includes(laneId)) {
      throw new Error(`seed fixture proof lane coverage missing alias lane: ${laneId}`);
    }
  }
  for (const laneId of seedAggregateOnlyProofLaneIds) {
    if (!aggregateOnlyLaneIds.includes(laneId)) {
      throw new Error(
        `seed fixture proof lane coverage missing aggregate lane: ${laneId}`,
      );
    }
  }
  if (coverage.directSeeded?.count !== directSeededLaneIds.length) {
    throw new Error("seed fixture direct proof lane count drifted");
  }
  if (coverage.aliasOnly?.count !== aliasOnlyLaneIds.length) {
    throw new Error("seed fixture alias proof lane count drifted");
  }
  if (coverage.aggregateOnly?.count !== aggregateOnlyLaneIds.length) {
    throw new Error("seed fixture aggregate proof lane count drifted");
  }
  if (coverage.unclassified?.count !== 0 || unclassifiedLaneIds.length !== 0) {
    throw new Error(
      `seed fixture proof lane coverage has unclassified lanes: ${unclassifiedLaneIds.join(", ")}`,
    );
  }
  return {
    status: "passed",
    passedLaneCount: coverage.passedLaneCount,
    directSeeded: {
      count: directSeededLaneIds.length,
      laneIds: directSeededLaneIds,
    },
    aliasOnly: {
      count: aliasOnlyLaneIds.length,
      laneIds: aliasOnlyLaneIds,
    },
    aggregateOnly: {
      count: aggregateOnlyLaneIds.length,
      laneIds: aggregateOnlyLaneIds,
    },
    unclassified: {
      count: 0,
      laneIds: [],
    },
  };
}

export function validateDevTestGameSeedAdminProof(proof, options = {}) {
  const requiredScenarios = seedScenarioCoverageGroups.allDemo;
  const requiredProofLaneCoverage = [
    "direct-seeded",
    "alias-only",
    "aggregate-only",
    "unclassified",
  ];
  if (proof?.version !== 1) {
    throw new Error(`seed admin proof version drifted: ${proof?.version}`);
  }
  if (proof.proof !== "dev-test-game-seed-admin-proof") {
    throw new Error(`unexpected seed admin proof id: ${proof.proof}`);
  }
  if (proof.status !== "passed") {
    throw new Error(`seed admin proof status is ${proof.status}`);
  }
  if (proof.scope !== "local-dev-test-game-seed-admin-surface") {
    throw new Error(`seed admin proof scope drifted: ${proof.scope}`);
  }
  if (proof.productionReady !== false || proof.releaseReady !== false) {
    throw new Error("seed admin proof must not claim production or release readiness");
  }
  if (
    proof.adminRoleSurface?.clickedThroughFromOverview !== true ||
    proof.adminRoleSurface?.rawInviteTokensVisible !== false
  ) {
    throw new Error("seed admin proof did not prove admin overview click-through");
  }
  for (const scenarioId of requiredScenarios) {
    if (!proof.adminRoleSurface?.visibleScenarios?.includes(scenarioId)) {
      throw new Error(`seed admin proof missing visible scenario: ${scenarioId}`);
    }
  }
  for (const coverageId of requiredProofLaneCoverage) {
    if (!proof.adminRoleSurface?.visibleProofLaneCoverage?.includes(coverageId)) {
      throw new Error(
        `seed admin proof missing visible proof lane coverage: ${coverageId}`,
      );
    }
  }
  return {
    status: "passed",
    path: options.path ?? "target/dev-test-game/seed-admin-proof.json",
    proofBoundary: proof.proofBoundary,
    overviewRoleUrl: proof.adminRoleSurface.overviewRoleUrl,
    detailRoleUrl: proof.adminRoleSurface.detailRoleUrl,
    visibleScenarios: proof.adminRoleSurface.visibleScenarios,
    visibleProofLaneCoverage: proof.adminRoleSurface.visibleProofLaneCoverage,
    ...(options.artifact === undefined ? {} : { artifact: options.artifact }),
  };
}

export function validateDevTestGameIdentityAdapterProof(proof, options = {}) {
  const requiredRoles = new Map([
    ["admin", "GlobalAdmin"],
    ["host", "HostOf"],
    ["player", "SlotOccupant"],
  ]);
  if (proof?.version !== devTestGameIdentityAdapterProofVersion) {
    throw new Error(`identity adapter proof version drifted: ${proof?.version}`);
  }
  if (proof.proof !== "auth-invite-role-proof") {
    throw new Error(`unexpected identity adapter proof id: ${proof.proof}`);
  }
  if (proof.status !== "passed") {
    throw new Error(`identity adapter proof status is ${proof.status}`);
  }
  if (proof.scope !== "local-auth-invite-role-proof") {
    throw new Error(`identity adapter proof scope drifted: ${proof.scope}`);
  }
  if (proof.productionReady !== false || proof.releaseReady !== false) {
    throw new Error("identity adapter proof must not claim production or release readiness");
  }
  if (
    proof.identityAdapter?.replacesDevTokensWithoutRoleSurfaceChange !== true ||
    proof.identityAdapterContractDiff?.status !== "passed" ||
    devTestGameIdentityAdapterContractDiff(proof.identityAdapterContract).status !==
      "passed" ||
    proof.identityAdapter?.browserCookieName !== "fmarch_session" ||
    proof.identityAdapter?.inviteCredentialKind !== "single-use-invite" ||
    proof.identityAdapter?.accountCredentialKind !== "local-password-account" ||
    proof.identityAdapter?.sessionCredentialKind !== "opaque-session" ||
    !proof.identityAdapter?.lifecycleControls?.includes("account-disable") ||
    !proof.identityAdapter?.lifecycleControls?.includes("account-enable") ||
    !proof.identityAdapter?.lifecycleControls?.includes("session-rotation") ||
    !proof.identityAdapter?.lifecycleControls?.includes("session-revocation") ||
    !proof.identityAdapter?.lifecycleControls?.includes("invite-revocation") ||
    !proof.identityAdapter?.delegatedIssuanceControls?.includes(
      "host-scoped-invite-issuance",
    )
  ) {
    throw new Error("identity adapter proof does not preserve the role-surface adapter");
  }
  assertDevTestGameIdentityAdapterContractPacket(proof.identityAdapterContract);
  if (
    proof.identityLifecycle?.status !== "passed" ||
    proof.identityLifecycle?.sessionRotation?.oldSessionRejected !== true ||
    !proof.identityLifecycle?.sessionRotation?.rotatedSessionCapabilityKinds?.includes(
      "HostOf",
    ) ||
    proof.identityLifecycle?.sessionRevocation?.revokedSessionRejected !== true ||
    proof.identityLifecycle?.inviteRevocation?.revokedInviteRejected !== true ||
    !proof.identityLifecycle?.inviteRevocation?.recoveryCapabilityKinds?.includes(
      "HostOf",
    ) ||
    proof.identityLifecycle?.inviteRevocation?.sameRoleSurface !== true ||
    proof.identityLifecycle?.hostScopedInviteIssuance?.status !== "passed" ||
    proof.identityLifecycle?.hostScopedInviteIssuance?.issuingCapability !==
      "HostOf(game)" ||
    proof.identityLifecycle?.hostScopedInviteIssuance?.hostRoleSurface !==
      `/g/${proof.game}/host` ||
    proof.identityLifecycle?.hostScopedInviteIssuance?.hostAction !==
      "?/issuePlayerInvite" ||
    proof.identityLifecycle?.hostScopedInviteIssuance?.hostPanelTestId !==
      "host-player-invite-panel" ||
    proof.identityLifecycle?.hostScopedInviteIssuance?.clickedThroughFromHostRoleUrl !==
      true ||
    proof.identityLifecycle?.hostScopedInviteIssuance?.issuedByPrincipalUserId !==
      "host_h" ||
    proof.identityLifecycle?.hostScopedInviteIssuance?.issuedForGame !== proof.game ||
    proof.identityLifecycle?.hostScopedInviteIssuance?.storedGameScope !== proof.game ||
    proof.identityLifecycle?.hostScopedInviteIssuance?.globalCapabilitiesGranted !== 0 ||
    proof.identityLifecycle?.hostScopedInviteIssuance?.rawInviteTokenStored !== false ||
    !proof.identityLifecycle?.hostScopedInviteIssuance?.redeemedCapabilityKinds?.includes(
      "SlotOccupant",
    ) ||
    proof.identityLifecycle?.hostScopedInviteIssuance?.sameRoleSurface !== true ||
    proof.identityLifecycle?.hostScopedInviteIssuance?.hostRoleSurfaceStillValid !== true ||
    proof.identityLifecycle?.accountLogin?.status !== "passed" ||
    proof.identityLifecycle?.accountLogin?.principalUserId !== "host_h" ||
    !proof.identityLifecycle?.accountLogin?.capabilityKinds?.includes("HostOf") ||
    proof.identityLifecycle?.accountLogin?.sameRoleSurface !== true ||
    proof.identityLifecycle?.accountLogin?.cookieValuePrefix !== "account-session-" ||
    proof.identityLifecycle?.accountLogin?.rawPasswordStored !== false ||
    proof.identityLifecycle?.accountLifecycle?.status !== "passed" ||
    proof.identityLifecycle?.accountLifecycle?.adminControlSurface?.status !== "passed" ||
    proof.identityLifecycle?.accountLifecycle?.adminControlSurface?.detailRoleUrl !==
      "/admin/audit/identity-lifecycle?game=<seeded-game>&principal_user_id=host_h" ||
    proof.identityLifecycle?.accountLifecycle?.adminControlSurface?.controlsTestId !==
      "admin-identity-account-controls" ||
    proof.identityLifecycle?.accountLifecycle?.adminControlSurface?.visitedDetailRoleUrl !==
      true ||
    proof.identityLifecycle?.accountLifecycle?.disabledStatus !== "disabled" ||
    proof.identityLifecycle?.accountLifecycle?.enabledStatus !== "enabled" ||
    proof.identityLifecycle?.accountLifecycle?.disabledAccountRejected !== true ||
    proof.identityLifecycle?.accountLifecycle?.staleAccountSessionRejected !== true ||
    proof.identityLifecycle?.accountLifecycle?.staleAdminControlRejected !== true ||
    proof.identityLifecycle?.accountLifecycle?.staleAdminControlReloadRecovered !==
      true ||
    proof.identityLifecycle?.accountLifecycle?.adminControlSurface
      ?.reloadRecoveryStatus !== "disabled" ||
    proof.identityLifecycle?.accountLifecycle?.adminControlSurface
      ?.reloadRecoveryDetailRoleUrl !==
      "/admin/audit/identity-lifecycle?game=<seeded-game>&principal_user_id=host_h" ||
    !String(
      proof.identityLifecycle?.accountLifecycle?.adminControlSurface
        ?.reloadRecoveryTargetText ?? "",
    ).includes("disabled") ||
    !String(
      proof.identityLifecycle?.accountLifecycle?.adminControlSurface
        ?.staleConflictStatusText ?? "",
    ).includes("stale account lifecycle state") ||
    !String(
      proof.identityLifecycle?.accountLifecycle?.adminControlSurface
        ?.staleConflictStatusText ?? "",
    ).includes("refresh and use current account controls") ||
    !proof.identityLifecycle?.accountLifecycle?.recoveryCapabilityKinds?.includes(
      "HostOf",
    ) ||
    proof.identityLifecycle?.accountLifecycle?.sameRoleSurface !== true ||
    proof.identityLifecycle?.accountLifecycle?.revokedSessionCount < 1 ||
    proof.identityLifecycle?.accountLifecycle?.disabledAtPresent !== true ||
    proof.identityLifecycle?.accountLifecycle?.enabledDisabledAtCleared !== true ||
    proof.identityLifecycle?.accountLifecycle?.rawPasswordStored !== false ||
    proof.identityLifecycle?.auditTrail?.status !== "passed" ||
    proof.identityLifecycle?.auditTrail?.rawTokensStored !== false ||
    !proof.identityLifecycle?.auditTrail?.eventKinds?.includes("account_created") ||
    !proof.identityLifecycle?.auditTrail?.eventKinds?.includes("account_disabled") ||
    !proof.identityLifecycle?.auditTrail?.eventKinds?.includes("account_enabled") ||
    !proof.identityLifecycle?.auditTrail?.eventKinds?.includes(
      "account_session_created",
    ) ||
    !proof.identityLifecycle?.auditTrail?.eventKinds?.includes("session_rotated") ||
    !proof.identityLifecycle?.auditTrail?.eventKinds?.includes("session_revoked") ||
    !proof.identityLifecycle?.auditTrail?.eventKinds?.includes("invite_revoked") ||
    proof.identityLifecycle?.adminAuditSurface?.status !== "passed" ||
    proof.identityLifecycle?.adminAuditSurface?.clickedThroughFromOverview !== true ||
    proof.identityLifecycle?.adminAuditSurface?.rawTokensVisible !== false ||
    !proof.identityLifecycle?.adminAuditSurface?.visibleEventKinds?.includes(
      "account_created",
    ) ||
    !proof.identityLifecycle?.adminAuditSurface?.visibleEventKinds?.includes(
      "account_disabled",
    ) ||
    !proof.identityLifecycle?.adminAuditSurface?.visibleEventKinds?.includes(
      "account_enabled",
    ) ||
    !proof.identityLifecycle?.adminAuditSurface?.visibleEventKinds?.includes(
      "account_session_created",
    ) ||
    !proof.identityLifecycle?.adminAuditSurface?.visibleEventKinds?.includes(
      "session_rotated",
    ) ||
    !proof.identityLifecycle?.adminAuditSurface?.visibleEventKinds?.includes(
      "session_revoked",
    ) ||
    !proof.identityLifecycle?.adminAuditSurface?.visibleEventKinds?.includes(
      "invite_revoked",
    )
  ) {
    throw new Error("identity adapter proof does not prove lifecycle recovery");
  }
  for (const [role, capability] of requiredRoles) {
    const entry = proof.roles?.[role];
    if (entry === undefined) {
      throw new Error(`identity adapter proof missing role: ${role}`);
    }
    if (!entry.capabilityKinds?.includes(capability)) {
      throw new Error(`identity adapter proof role ${role} missing ${capability}`);
    }
    if (entry.cookie?.valuePrefix !== "invite-session-") {
      throw new Error(`identity adapter proof role ${role} did not use invite session`);
    }
    const loginUrl = typeof entry.loginUrl === "string" ? new URL(entry.loginUrl) : null;
    if (loginUrl?.pathname !== "/auth/login") {
      throw new Error(`identity adapter proof role ${role} did not use /auth/login`);
    }
    if (!loginUrl.searchParams.has("returnTo") || !loginUrl.searchParams.has("invite")) {
      throw new Error(`identity adapter proof role ${role} missing role URL params`);
    }
  }
  if ((proof.seedCommands ?? []).length !== 22) {
    throw new Error("identity adapter proof did not seed the local game shape");
  }
  if (
    proof.accounts?.host?.principalUserId !== "host_h" ||
    typeof proof.accounts?.host?.accountId !== "string" ||
    proof.accounts.host.accountId.trim() === "" ||
    Object.hasOwn(proof.accounts.host, "password")
  ) {
    throw new Error("identity adapter proof missing redacted host account evidence");
  }
  return {
    status: "passed",
    path: options.path ?? "target/auth-invite-role-proof/invite-role-proof.json",
    roleCount: requiredRoles.size,
    roles: Array.from(requiredRoles.keys()),
    adapterContractStatus: proof.identityAdapterContract.status,
    roleSurfaceContractStatus:
      proof.identityAdapterContractDiff.roleSurfaceContractDiff.status,
    proofBoundary: proof.proofBoundary,
    scope: proof.scope,
    productionReady: proof.productionReady,
    ...(options.artifact === undefined ? {} : { artifact: options.artifact }),
  };
}

export function validateDevTestGameIdentityAdminProof(proof, options = {}) {
  const requiredChecks = [
    "account-login",
    "account-lifecycle",
    "session-rotation",
    "session-revocation",
    "invite-revocation",
    "host-scoped-invite-issuance",
    "audit-trail",
    "admin-audit-surface",
  ];
  const requiredSessions = ["admin", "host", "player"];
  if (proof?.version !== 1) {
    throw new Error(`identity admin proof version drifted: ${proof?.version}`);
  }
  if (proof.proof !== "dev-test-game-identity-admin-proof") {
    throw new Error(`unexpected identity admin proof id: ${proof.proof}`);
  }
  if (proof.status !== "passed") {
    throw new Error(`identity admin proof status is ${proof.status}`);
  }
  if (proof.scope !== "local-dev-test-game-identity-admin-surface") {
    throw new Error(`identity admin proof scope drifted: ${proof.scope}`);
  }
  if (proof.productionReady !== false || proof.releaseReady !== false) {
    throw new Error("identity admin proof must not claim production or release readiness");
  }
  if (
    proof.adminRoleSurface?.clickedThroughFromOverview !== true ||
    proof.adminRoleSurface?.rawInviteTokensVisible !== false
  ) {
    throw new Error("identity admin proof did not prove admin overview click-through");
  }
  for (const checkId of requiredChecks) {
    if (!proof.adminRoleSurface?.visibleChecks?.includes(checkId)) {
      throw new Error(`identity admin proof missing visible check: ${checkId}`);
    }
  }
  for (const sessionRole of requiredSessions) {
    if (!proof.adminRoleSurface?.visibleSessions?.includes(sessionRole)) {
      throw new Error(`identity admin proof missing visible session: ${sessionRole}`);
    }
  }
  return {
    status: "passed",
    path: options.path ?? "target/dev-test-game/identity-admin-proof.json",
    proofBoundary: proof.proofBoundary,
    overviewRoleUrl: proof.adminRoleSurface.overviewRoleUrl,
    detailRoleUrl: proof.adminRoleSurface.detailRoleUrl,
    visibleChecks: proof.adminRoleSurface.visibleChecks,
    visibleSessions: proof.adminRoleSurface.visibleSessions,
    ...(options.artifact === undefined ? {} : { artifact: options.artifact }),
  };
}

export function validateDevTestGameRaceCoverage(proof, options = {}) {
  assertDevTestGameRaceCoverage(proof);
  if (proof.status !== "passed") {
    throw new Error(`race coverage status is ${proof.status}`);
  }
  if (proof.summary?.unprovenCellCount !== 0) {
    throw new Error("race coverage inventory has unproven cells");
  }
  if ((proof.summary?.cellCount ?? 0) < 10) {
    throw new Error(`race coverage cell count drifted: ${proof.summary?.cellCount}`);
  }
  if (!Array.isArray(proof.cells) || proof.cells.length !== proof.summary.cellCount) {
    throw new Error("race coverage cells drifted from summary");
  }
  return {
    status: "passed",
    path: options.path ?? "target/dev-test-game/race-coverage.json",
    cellCount: proof.summary.cellCount,
    provenCellCount: proof.summary.provenCellCount,
    reloadCoveredCellCount: proof.summary.reloadCoveredCellCount,
    actorPairs: proof.summary.actorPairs,
    commandFamilies: proof.summary.commandFamilies,
    proofBoundary: proof.proofBoundary,
    ...(options.artifact === undefined ? {} : { artifact: options.artifact }),
  };
}

export function validateDevTestGameHostedConcurrentRaceMatrix(proof, options = {}) {
  if (
    proof?.version !== 1 ||
    proof.proof !== "dev-test-game-hosted-concurrent-race-matrix" ||
    proof.status !== "passed" ||
    proof.scope !== "local-hosted-like-concurrent-race-matrix"
  ) {
    throw new Error("hosted concurrent race matrix evidence shape drifted");
  }
  if (proof.productionReady !== false || proof.releaseReady !== false) {
    throw new Error("hosted concurrent race matrix must not claim production or release readiness");
  }
  if (
    proof.hostedLikeTarget?.status !== "passed" ||
    !Array.isArray(proof.hostedLikeTarget.roleSurfaces) ||
    proof.hostedLikeTarget.roleSurfaces.length === 0
  ) {
    throw new Error("hosted concurrent race matrix target drifted");
  }
  for (const surface of proof.hostedLikeTarget.roleSurfaces) {
    if (
      typeof surface.role !== "string" ||
      typeof surface.directUrl !== "string" ||
      "token" in surface ||
      "inviteToken" in surface ||
      "loginUrl" in surface ||
      surface.directUrl.includes("invite=")
    ) {
      throw new Error("hosted concurrent race matrix role surface leaked credentials");
    }
  }
  const summary = proof.summary ?? {};
  if (
    !Number.isInteger(summary.cellCount) ||
    summary.cellCount <= 0 ||
    summary.passedCellCount !== summary.cellCount ||
    summary.reloadCoveredCellCount !== summary.cellCount ||
    !Number.isInteger(summary.reconnectLaneCount) ||
    summary.reconnectLaneCount <= 0 ||
    !Number.isInteger(summary.staleConflictLaneCount) ||
    summary.staleConflictLaneCount <= 0 ||
    !["not_configured", "configured_unproven", "passed"].includes(
      summary.hostedEvidenceStatus,
    ) ||
    !["passed", "unproven"].includes(summary.realHostedDeploymentStatus)
  ) {
    throw new Error("hosted concurrent race matrix summary drifted");
  }
  if (!Array.isArray(proof.cells) || proof.cells.length !== summary.cellCount) {
    throw new Error("hosted concurrent race matrix cells drifted from summary");
  }
  for (const cell of proof.cells) {
    if (
      cell.status !== "passed" ||
      cell.raceLane?.status !== "passed" ||
      cell.reloadLane?.status !== "passed"
    ) {
      throw new Error(`hosted concurrent race matrix cell did not pass: ${cell?.id}`);
    }
  }
  if (
    !Array.isArray(proof.reconnectLanes) ||
    proof.reconnectLanes.length !== summary.reconnectLaneCount ||
    !proof.reconnectLanes.every((lane) => lane.status === "passed") ||
    !Array.isArray(proof.staleConflictLanes) ||
    proof.staleConflictLanes.length !== summary.staleConflictLaneCount ||
    !proof.staleConflictLanes.every((lane) => lane.status === "passed")
  ) {
    throw new Error("hosted concurrent race matrix recovery lane summary drifted");
  }
  const expectedMilestoneCases = hostedMatrixStaleConflictMilestoneCases();
  if (
    !Array.isArray(proof.staleConflictMilestones) ||
    proof.staleConflictMilestones.length !== expectedMilestoneCases.length
  ) {
    throw new Error("hosted concurrent race matrix stale milestones drifted");
  }
  for (const scenario of expectedMilestoneCases) {
    const milestone = proof.staleConflictMilestones.find(
      (candidate) => candidate.id === scenario.id,
    );
    if (
      milestone?.status !== "passed" ||
      milestone.progressCheckId !== scenario.progressCheckId ||
      milestone.laneId !== scenario.laneId
    ) {
      throw new Error(
        `hosted concurrent race matrix stale milestone drifted: ${scenario.id}`,
      );
    }
  }
  if (!Array.isArray(proof.remainingGaps)) {
    throw new Error("hosted concurrent race matrix missing remaining gaps");
  }
  return {
    status: "passed",
    path: options.path ?? "target/dev-test-game/hosted-concurrent-race-matrix.json",
    proofBoundary: proof.proofBoundary,
    cellCount: summary.cellCount,
    reloadCoveredCellCount: summary.reloadCoveredCellCount,
    reconnectLaneCount: summary.reconnectLaneCount,
    staleConflictLaneCount: summary.staleConflictLaneCount,
    staleConflictMilestones: proof.staleConflictMilestones.map((milestone) => ({
      id: milestone.id,
      label: milestone.label,
      status: milestone.status,
      progressCheckId: milestone.progressCheckId,
      laneId: milestone.laneId,
      proofBoundary: milestone.proofBoundary,
    })),
    hostedEvidenceStatus: summary.hostedEvidenceStatus,
    realHostedDeploymentStatus: summary.realHostedDeploymentStatus,
    remainingGaps: proof.remainingGaps,
    ...(options.artifact === undefined ? {} : { artifact: options.artifact }),
  };
}

export function validateDevTestGameRaceCoverageAdminProof(proof, options = {}) {
  if (proof?.version !== 1) {
    throw new Error(`race coverage admin proof version drifted: ${proof?.version}`);
  }
  if (proof.proof !== "dev-test-game-race-coverage-admin-proof") {
    throw new Error(`unexpected race coverage admin proof id: ${proof.proof}`);
  }
  if (proof.status !== "passed") {
    throw new Error(`race coverage admin proof status is ${proof.status}`);
  }
  if (proof.scope !== "local-dev-test-game-race-coverage-admin-surface") {
    throw new Error(`race coverage admin proof scope drifted: ${proof.scope}`);
  }
  if (proof.productionReady !== false || proof.releaseReady !== false) {
    throw new Error(
      "race coverage admin proof must not claim production or release readiness",
    );
  }
  if (
    proof.adminRoleSurface?.clickedThroughFromOverview !== true ||
    proof.adminRoleSurface?.rawInviteTokensVisible !== false
  ) {
    throw new Error("race coverage admin proof did not prove admin overview click-through");
  }
  for (const cellId of proof.generatedFrom?.cellIds ?? []) {
    if (!proof.adminRoleSurface?.visibleChecks?.includes(cellId)) {
      throw new Error(`race coverage admin proof missing visible cell: ${cellId}`);
    }
  }
  return {
    status: "passed",
    path: options.path ?? "target/dev-test-game/race-coverage-admin-proof.json",
    proofBoundary: proof.proofBoundary,
    overviewRoleUrl: proof.adminRoleSurface.overviewRoleUrl,
    detailRoleUrl: proof.adminRoleSurface.detailRoleUrl,
    visibleChecks: proof.adminRoleSurface.visibleChecks,
    ...(options.artifact === undefined ? {} : { artifact: options.artifact }),
  };
}

export function validateDevTestGameHostedConcurrentRaceMatrixAdminProof(
  proof,
  options = {},
) {
  const requiredChecks = hostedMatrixAdminRequiredCheckIds;
  if (proof?.version !== 1) {
    throw new Error(
      `hosted concurrent race matrix admin proof version drifted: ${proof?.version}`,
    );
  }
  if (
    proof.proof !== "dev-test-game-hosted-concurrent-race-matrix-admin-proof"
  ) {
    throw new Error(
      `unexpected hosted concurrent race matrix admin proof id: ${proof.proof}`,
    );
  }
  if (proof.status !== "passed") {
    throw new Error(
      `hosted concurrent race matrix admin proof status is ${proof.status}`,
    );
  }
  if (
    proof.scope !==
    "local-dev-test-game-hosted-concurrent-race-matrix-admin-surface"
  ) {
    throw new Error(
      `hosted concurrent race matrix admin proof scope drifted: ${proof.scope}`,
    );
  }
  if (proof.productionReady !== false || proof.releaseReady !== false) {
    throw new Error(
      "hosted concurrent race matrix admin proof must not claim production or release readiness",
    );
  }
  if (
    proof.adminRoleSurface?.clickedThroughFromOverview !== true ||
    proof.adminRoleSurface?.rawInviteTokensVisible !== false
  ) {
    throw new Error(
      "hosted concurrent race matrix admin proof did not prove admin overview click-through",
    );
  }
  for (const checkId of requiredChecks) {
    if (!proof.adminRoleSurface?.visibleChecks?.includes(checkId)) {
      throw new Error(
        `hosted concurrent race matrix admin proof missing visible check: ${checkId}`,
      );
    }
  }
  for (const cellId of proof.generatedFrom?.cellIds ?? []) {
    if (!proof.adminRoleSurface?.visibleChecks?.includes(cellId)) {
      throw new Error(
        `hosted concurrent race matrix admin proof missing visible cell: ${cellId}`,
      );
    }
  }
  for (const scenario of hostedMatrixStaleConflictMilestoneCases()) {
    const milestone = proof.generatedFrom?.staleConflictMilestones?.find(
      (candidate) => candidate.id === scenario.id,
    );
    if (
      milestone?.laneId !== scenario.laneId ||
      milestone.progressCheckId !== scenario.progressCheckId ||
      !proof.adminRoleSurface?.visibleStaleConflictLanes?.includes(
        scenario.laneId,
      )
    ) {
      throw new Error(
        `hosted concurrent race matrix admin proof missing stale milestone: ${scenario.id}`,
      );
    }
  }
  if (
    !proof.adminRoleSurface?.visibleUnproven?.includes(
      proof.generatedFrom?.requestedEvidenceId,
    )
  ) {
    throw new Error(
      "hosted concurrent race matrix admin proof missing requested evidence row",
    );
  }
  return {
    status: "passed",
    path:
      options.path ??
      "target/dev-test-game/hosted-concurrent-race-matrix-admin-proof.json",
    proofBoundary: proof.proofBoundary,
    overviewRoleUrl: proof.adminRoleSurface.overviewRoleUrl,
    detailRoleUrl: proof.adminRoleSurface.detailRoleUrl,
    visibleChecks: proof.adminRoleSurface.visibleChecks,
    visibleUnproven: proof.adminRoleSurface.visibleUnproven,
    staleConflictMilestones: proof.generatedFrom.staleConflictMilestones,
    hostedEvidenceStatus: String(proof.generatedFrom?.hostedEvidenceStatus ?? ""),
    realHostedDeploymentStatus: String(
      proof.generatedFrom?.realHostedDeploymentStatus ?? "",
    ),
    ...(options.artifact === undefined ? {} : { artifact: options.artifact }),
  };
}

export function validateDevTestGameProofGraphAdminProof(proof, options = {}) {
  if (proof?.version !== 1) {
    throw new Error(`proof graph admin proof version drifted: ${proof?.version}`);
  }
  if (proof.proof !== "dev-test-game-proof-graph-admin-proof") {
    throw new Error(`unexpected proof graph admin proof id: ${proof.proof}`);
  }
  if (proof.status !== "passed") {
    throw new Error(`proof graph admin proof status is ${proof.status}`);
  }
  if (proof.scope !== "local-dev-test-game-proof-graph-admin-surface") {
    throw new Error(`proof graph admin proof scope drifted: ${proof.scope}`);
  }
  if (proof.productionReady !== false || proof.releaseReady !== false) {
    throw new Error("proof graph admin proof must not claim production or release readiness");
  }
  if (
    proof.adminRoleSurface?.clickedThroughFromOverview !== true ||
    proof.adminRoleSurface?.rawInviteTokensVisible !== false
  ) {
    throw new Error("proof graph admin proof did not prove admin overview click-through");
  }
  const handoffs = proof.generatedFrom?.adminProofRoleHandoffs;
  if (!Array.isArray(handoffs) || handoffs.length === 0) {
    throw new Error("proof graph admin proof is missing admin role handoff evidence");
  }
  const visibleDestinations = Array.isArray(
    proof.adminRoleSurface?.visibleRelatedDestinations,
  )
    ? proof.adminRoleSurface.visibleRelatedDestinations
    : [];
  for (const handoff of handoffs) {
    if (!proof.adminRoleSurface?.visibleRelatedLinks?.includes(handoff.linkId)) {
      throw new Error(`proof graph admin proof missing related link: ${handoff.linkId}`);
    }
    const destination = visibleDestinations.find(
      (item) => item.linkId === handoff.linkId && item.auditId === handoff.auditId,
    );
    if (destination === undefined) {
      throw new Error(
        `proof graph admin proof missing visible destination: ${handoff.linkId}`,
      );
    }
  }
  for (const edgeRowId of proof.generatedFrom?.edgeRowIds ?? []) {
    if (!proof.adminRoleSurface?.visibleChecks?.includes(edgeRowId)) {
      throw new Error(`proof graph admin proof missing visible edge: ${edgeRowId}`);
    }
  }
  const destinationAuditIds = [
    ...new Set(handoffs.map((handoff) => String(handoff.auditId))),
  ];
  return {
    status: "passed",
    path: options.path ?? "target/dev-test-game/proof-graph-admin-proof.json",
    proofBoundary: proof.proofBoundary,
    overviewRoleUrl: proof.adminRoleSurface.overviewRoleUrl,
    detailRoleUrl: proof.adminRoleSurface.detailRoleUrl,
    visibleChecks: proof.adminRoleSurface.visibleChecks,
    visibleRelatedLinks: proof.adminRoleSurface.visibleRelatedLinks,
    visibleRelatedDestinations: visibleDestinations,
    roleHandoffCount: handoffs.length,
    roleHandoffIds: handoffs.map((handoff) => String(handoff.linkId)),
    destinationAuditIds,
    ...(options.artifact === undefined ? {} : { artifact: options.artifact }),
  };
}

export function validateDevTestGameProofFreshnessAdminProof(proof, options = {}) {
  if (proof?.version !== 1) {
    throw new Error(`proof freshness admin proof version drifted: ${proof?.version}`);
  }
  if (proof.proof !== "dev-test-game-proof-freshness-admin-proof") {
    throw new Error(`unexpected proof freshness admin proof id: ${proof.proof}`);
  }
  if (proof.status !== "passed") {
    throw new Error(`proof freshness admin proof status is ${proof.status}`);
  }
  if (proof.scope !== "local-dev-test-game-proof-freshness-admin-surface") {
    throw new Error(`proof freshness admin proof scope drifted: ${proof.scope}`);
  }
  if (proof.productionReady !== false || proof.releaseReady !== false) {
    throw new Error(
      "proof freshness admin proof must not claim production or release readiness",
    );
  }
  if (
    proof.adminRoleSurface?.clickedThroughFromOverview !== true ||
    proof.adminRoleSurface?.rawInviteTokensVisible !== false
  ) {
    throw new Error(
      "proof freshness admin proof did not prove admin overview click-through",
    );
  }
  if (
    typeof proof.generatedFrom?.nextActionCommand !== "string" ||
    proof.generatedFrom.nextActionCommand.trim() === "" ||
    typeof proof.generatedFrom?.nextActionStatus !== "string" ||
    typeof proof.generatedFrom?.nextActionReason !== "string" ||
    !proof.adminRoleSurface?.visibleRelatedLinks?.includes(
      localAdminAuditIds.nextAction,
    )
  ) {
    throw new Error("proof freshness admin proof did not prove next-action handoff");
  }
  if (
    !proof.adminRoleSurface?.visibleChecks?.includes(
      localAdminAuditHandoffCheckIds.nextAction,
    )
  ) {
    throw new Error("proof freshness admin proof missing next-action handoff check");
  }
  const artifactIds = Array.isArray(proof.generatedFrom?.artifactIds)
    ? proof.generatedFrom.artifactIds.map((id) => String(id))
    : [];
  if (artifactIds.length === 0) {
    throw new Error("proof freshness admin proof is missing artifact ids");
  }
  for (const id of artifactIds) {
    if (!proof.adminRoleSurface?.visibleChecks?.includes(id)) {
      throw new Error(`proof freshness admin proof missing visible artifact: ${id}`);
    }
  }
  return {
    status: "passed",
    path: options.path ?? "target/dev-test-game/proof-freshness-admin-proof.json",
    proofBoundary: proof.proofBoundary,
    overviewRoleUrl: proof.adminRoleSurface.overviewRoleUrl,
    detailRoleUrl: proof.adminRoleSurface.detailRoleUrl,
    visibleChecks: proof.adminRoleSurface.visibleChecks,
    visibleRelatedLinks: proof.adminRoleSurface.visibleRelatedLinks,
    artifactIds,
    maxAgeHours: Number(proof.generatedFrom.maxAgeHours ?? 0),
    nextActionCommand: proof.generatedFrom.nextActionCommand,
    nextActionStatus: proof.generatedFrom.nextActionStatus,
    nextActionReason: proof.generatedFrom.nextActionReason,
    ...(options.artifact === undefined ? {} : { artifact: options.artifact }),
  };
}

export function validateDevTestGameNextActionAdminProof(proof, options = {}) {
  if (proof?.version !== 1) {
    throw new Error(`next-action admin proof version drifted: ${proof?.version}`);
  }
  if (proof.proof !== "dev-test-game-next-action-admin-proof") {
    throw new Error(`unexpected next-action admin proof id: ${proof.proof}`);
  }
  if (proof.status !== "passed") {
    throw new Error(`next-action admin proof status is ${proof.status}`);
  }
  if (proof.scope !== "local-dev-test-game-next-action-admin-surface") {
    throw new Error(`next-action admin proof scope drifted: ${proof.scope}`);
  }
  if (proof.productionReady !== false || proof.releaseReady !== false) {
    throw new Error(
      "next-action admin proof must not claim production or release readiness",
    );
  }
  if (
    proof.adminRoleSurface?.clickedThroughFromOverview !== true ||
    proof.adminRoleSurface?.rawInviteTokensVisible !== false
  ) {
    throw new Error("next-action admin proof did not prove admin overview click-through");
  }
  const requiredChecks = [
    "next-command",
    proof.generatedFrom?.reason,
    "selection-trace",
  ].filter((checkId) => typeof checkId === "string");
  for (const checkId of requiredChecks) {
    if (!proof.adminRoleSurface?.visibleChecks?.includes(checkId)) {
      throw new Error(`next-action admin proof missing visible check: ${checkId}`);
    }
  }
  if (
    proof.generatedFrom?.unprovenSpineTarget !== null &&
    proof.generatedFrom?.unprovenSpineTarget !== undefined
  ) {
    const declaration = proof.generatedFrom.unprovenProductionFeatureSpineTarget;
    const drilldown = proof.generatedFrom.unprovenSpineDrilldown;
    const target = proof.generatedFrom.unprovenSpineTarget;
    const rowKind = featureSpineRowKind(declaration);
    if (
      !validFeatureSpineDeclaration(declaration) ||
      typeof target.featureSlotId !== "string" ||
      typeof target.cycleId !== "string" ||
      typeof target.roleUrlId !== "string" ||
      typeof target.roleUrl !== "string" ||
      featureSpineRowKind(target) !== rowKind ||
      typeof target.checkpointId !== "string" ||
      (rowKind === featureSpineRecoveryHookRowKind &&
        target.recoveryHookId !== declaration.recoveryHookId) ||
      typeof target.adminCheckId !== "string" ||
      typeof target.browserProofCommand !== "string" ||
      target.featureSlotId !== declaration.featureSlotId ||
      target.adminCheckId !== declaration.adminCheckId ||
      typeof drilldown?.featureSlotId !== "string" ||
      typeof drilldown?.cycleRowId !== "string" ||
      typeof drilldown?.roleUrlRowId !== "string" ||
      featureSpineRowKind(drilldown) !== rowKind ||
      typeof drilldown?.checkpointRowId !== "string" ||
      (rowKind === featureSpineRecoveryHookRowKind &&
        drilldown.recoveryHookRowId !== declaration.recoveryHookId) ||
      typeof drilldown?.adminCheckId !== "string" ||
      typeof drilldown?.rerunCommand !== "string" ||
      drilldown.featureSlotId !== declaration.featureSlotId ||
      drilldown.adminCheckId !== declaration.adminCheckId ||
      !proof.adminRoleSurface?.visibleChecks?.includes(
        "selected-feature-spine-declaration",
      ) ||
      !proof.adminRoleSurface?.visibleChecks?.includes("selected-spine-target") ||
      !proof.adminRoleSurface?.visibleChecks?.includes("selected-spine-drilldown") ||
      !proof.adminRoleSurface?.visibleChecks?.includes(
        "selected-spine-admin-check",
      ) ||
      !proof.adminRoleSurface?.visibleChecks?.includes(
        "selected-spine-rerun-command",
      ) ||
      !proof.adminRoleSurface?.visibleChecks?.includes(
        "selected-spine-browser-proof",
      )
    ) {
      throw new Error("next-action admin proof missing selected spine target");
    }
  }
  const selectedProofGraphNode = proof.generatedFrom?.selectedProofGraphNode;
  if (
    selectedProofGraphNode !== null &&
    selectedProofGraphNode !== undefined &&
    selectedProofGraphNode.id !== undefined
  ) {
    if (
      !proof.adminRoleSurface?.visibleChecks?.includes(
        "selected-proof-graph-node",
      ) ||
      !proof.adminRoleSurface?.visibleChecks?.includes(
        "selected-proof-graph-destination",
      ) ||
      !proof.adminRoleSurface?.visibleRelatedLinks?.includes(
        "selected-proof-graph-node",
      )
    ) {
      throw new Error(
        "next-action admin proof missing selected proof graph destination",
      );
    }
    const graphDestination =
      proof.adminRoleSurface?.visibleRelatedDestinations?.find(
        (item) =>
          item?.linkId === "selected-proof-graph-node" &&
          item.auditId === localAdminAuditIds.proofGraph,
      ) ?? null;
    if (
      graphDestination === null ||
      graphDestination.detailRoleUrl !==
        localAdminAuditRoleUrl(localAdminAuditIds.proofGraph) ||
      !graphDestination.visibleChecks?.includes(String(selectedProofGraphNode.id))
    ) {
      throw new Error(
        "next-action admin proof did not prove selected proof graph destination",
      );
    }
  }
  const localTrace = proof.generatedFrom?.localReadinessDependencyTrace;
  if (
    localTrace?.strategy !== "local-readiness-dependency-before-hosted-work" ||
    !Number.isInteger(localTrace.candidateCount) ||
    !Array.isArray(localTrace.candidateIds)
  ) {
    throw new Error(
      "next-action admin proof is missing local readiness dependency trace",
    );
  }
  const releaseTrace = proof.generatedFrom?.releaseReadinessTrace;
  if (
    releaseTrace?.strategy !== "local-dev-release-readiness-priority" ||
    !Number.isInteger(releaseTrace.candidateCount) ||
    !Array.isArray(releaseTrace.candidateIds)
  ) {
    throw new Error("next-action admin proof is missing release readiness trace");
  }
  const seedProofLaneCoverageTrace =
    proof.generatedFrom?.seedProofLaneCoverageTrace;
  if (
    seedProofLaneCoverageTrace?.strategy !==
      "seed-proof-lane-coverage-before-readiness" ||
    !["clean", "drifted", "unavailable"].includes(
      seedProofLaneCoverageTrace.status,
    ) ||
    typeof seedProofLaneCoverageTrace.selected !== "boolean" ||
    !Number.isInteger(seedProofLaneCoverageTrace.unclassifiedLaneCount) ||
    !Array.isArray(seedProofLaneCoverageTrace.unclassifiedLaneIds)
  ) {
    throw new Error(
      "next-action admin proof is missing seed proof-lane coverage trace",
    );
  }
  if (
    seedProofLaneCoverageTrace.status !== "unavailable" &&
    !proof.adminRoleSurface?.visibleChecks?.includes(
      "seed-proof-lane-coverage-trace",
    )
  ) {
    throw new Error(
      "next-action admin proof missing seed proof-lane coverage trace row",
    );
  }
  if (
    typeof proof.generatedFrom?.seedProofLaneCoverageRoleUrl === "string" &&
    !proof.adminRoleSurface?.visibleRelatedLinks?.includes(
      "seed-proof-lane-coverage",
    )
  ) {
    throw new Error("next-action admin proof missing seed coverage role URL");
  }
  const checklist = proof.generatedFrom?.unprovenHostedHandoffChecklist;
  if (checklist !== null && checklist !== undefined) {
    if (
      checklist.status !== "blocked" ||
      !Array.isArray(checklist.inputIds) ||
      !Array.isArray(checklist.blockedCheckIds)
    ) {
      throw new Error("next-action admin proof has malformed hosted handoff checklist");
    }
    for (const inputId of checklist.inputIds) {
      if (
        !proof.adminRoleSurface?.visibleHostedHandoffInputs?.includes(inputId)
      ) {
        throw new Error(
          `next-action admin proof missing hosted handoff input: ${inputId}`,
        );
      }
    }
    for (const [inputId, expected] of Object.entries(
      hostedHandoffInputValues(checklist),
    )) {
      const visibleText =
        proof.adminRoleSurface?.visibleHostedHandoffInputValues?.[inputId] ?? "";
      if (!visibleText.includes(expected)) {
        throw new Error(
          `next-action admin proof missing hosted handoff input value: ${inputId}`,
        );
      }
    }
    for (const checkId of checklist.blockedCheckIds) {
      if (
        !proof.adminRoleSurface?.visibleHostedHandoffBlockedChecks?.includes(
          checkId,
        )
      ) {
        throw new Error(
          `next-action admin proof missing hosted handoff blocked check: ${checkId}`,
        );
      }
    }
    for (const groupId of hostedHandoffGroupIds(checklist)) {
      if (
        !proof.adminRoleSurface?.visibleHostedHandoffGroups?.includes(groupId)
      ) {
        throw new Error(
          `next-action admin proof missing hosted handoff group: ${groupId}`,
        );
      }
    }
    for (const section of hostedHandoffInputSections(checklist)) {
      if (
        !proof.adminRoleSurface?.visibleHostedHandoffInputSections?.includes(
          section.id,
        )
      ) {
        throw new Error(
          `next-action admin proof missing hosted handoff input section: ${section.id}`,
        );
      }
    }
    for (const row of hostedHandoffSectionInputRows(checklist)) {
      if (
        !proof.adminRoleSurface?.visibleHostedHandoffSectionInputs?.includes(
          row.id,
        )
      ) {
        throw new Error(
          `next-action admin proof missing hosted handoff section input: ${row.id}`,
        );
      }
    }
    const summary = proof.adminRoleSurface?.visibleHostedHandoffSummary;
    if (
      summary?.status !== checklist.status ||
      summary?.preflightStatus !== checklist.preflightStatus ||
      summary?.command !== checklist.command ||
      summary?.proofTarget !== checklist.proofTarget
    ) {
      throw new Error(
        "next-action admin proof missing hosted handoff blocked summary",
      );
    }
  }
  return {
    status: "passed",
    path: options.path ?? "target/dev-test-game/next-action-admin-proof.json",
    proofBoundary: proof.proofBoundary,
    overviewRoleUrl: proof.adminRoleSurface.overviewRoleUrl,
    detailRoleUrl: proof.adminRoleSurface.detailRoleUrl,
    visibleChecks: proof.adminRoleSurface.visibleChecks,
    visibleRelatedLinks: proof.adminRoleSurface.visibleRelatedLinks,
    visibleRelatedDestinations:
      proof.adminRoleSurface.visibleRelatedDestinations ?? [],
    visibleHostedHandoffInputs:
      proof.adminRoleSurface.visibleHostedHandoffInputs ?? [],
    visibleHostedHandoffInputValues:
      proof.adminRoleSurface.visibleHostedHandoffInputValues ?? {},
    visibleHostedHandoffBlockedChecks:
      proof.adminRoleSurface.visibleHostedHandoffBlockedChecks ?? [],
    visibleHostedHandoffGroups:
      proof.adminRoleSurface.visibleHostedHandoffGroups ?? [],
    visibleHostedHandoffInputSections:
      proof.adminRoleSurface.visibleHostedHandoffInputSections ?? [],
    visibleHostedHandoffSectionInputs:
      proof.adminRoleSurface.visibleHostedHandoffSectionInputs ?? [],
    visibleHostedHandoffSummary:
      proof.adminRoleSurface.visibleHostedHandoffSummary ?? null,
    command: String(proof.generatedFrom?.command ?? ""),
    reason: String(proof.generatedFrom?.reason ?? ""),
    unprovenProductionFeatureSpineTarget:
      proof.generatedFrom?.unprovenProductionFeatureSpineTarget ?? null,
    unprovenSpineDrilldown: proof.generatedFrom?.unprovenSpineDrilldown ?? null,
    unprovenSpineTarget: proof.generatedFrom?.unprovenSpineTarget ?? null,
    seedProofLaneCoverageTrace,
    releaseReadinessCandidateCount: releaseTrace.candidateCount,
    localReadinessDependencyCandidateCount: localTrace.candidateCount,
    ...(options.artifact === undefined ? {} : { artifact: options.artifact }),
  };
}

function hostedHandoffGroupIds(checklist) {
  const groups = checklist?.requirementGroups;
  return Array.isArray(groups) ? groups.map((group) => String(group.id)) : [];
}

function hostedHandoffInputSections(checklist) {
  return Array.isArray(checklist?.inputSections)
    ? checklist.inputSections.map((section) => ({
        id: String(section.id),
        requiredInputIds: Array.isArray(section.requiredInputIds)
          ? section.requiredInputIds.map((inputId) => String(inputId))
          : [],
        providedInputIds: Array.isArray(section.providedInputIds)
          ? section.providedInputIds.map((inputId) => String(inputId))
          : [],
      }))
    : [];
}

function hostedHandoffSectionInputRows(checklist) {
  return hostedHandoffInputSections(checklist).flatMap((section) =>
    section.requiredInputIds.map((inputId) => ({
      id: `${section.id}-${inputId}`,
      status: section.providedInputIds.includes(inputId)
        ? "provided"
        : "missing",
    })),
  );
}

function hostedHandoffInputValues(checklist) {
  return typeof checklist?.placeholderFixturePath === "string" &&
    checklist.placeholderFixturePath.trim() !== ""
    ? {
        FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH:
          checklist.placeholderFixturePath,
      }
    : {};
}

function validateOptionalNextActionAdminProof(proof, options = {}) {
  try {
    return validateDevTestGameNextActionAdminProof(proof, options);
  } catch (error) {
    if (
      String(error?.message ?? "").includes(
        "next-action admin proof missing selected spine target",
      )
    ) {
      return undefined;
    }
    throw error;
  }
}

export function validateDevTestGameReleaseAdminProof(proof, options = {}) {
  const requiredChecks = [
    "local-role-url-browser-proof",
    coreLoopFeatureSpineSourceCheckId,
    hardeningFeatureSpineSourceCheckId,
  ];
  const requiredUnproven = releaseAdminProofFallbackUnprovenIds;
  if (proof?.version !== 1) {
    throw new Error(`release admin proof version drifted: ${proof?.version}`);
  }
  if (proof.proof !== "dev-test-game-release-admin-proof") {
    throw new Error(`unexpected release admin proof id: ${proof.proof}`);
  }
  if (proof.status !== "passed") {
    throw new Error(`release admin proof status is ${proof.status}`);
  }
  if (proof.scope !== "local-dev-test-game-release-admin-surface") {
    throw new Error(`release admin proof scope drifted: ${proof.scope}`);
  }
  if (proof.productionReady !== false || proof.releaseReady !== false) {
    throw new Error("release admin proof must not claim production or release readiness");
  }
  if (
    proof.adminRoleSurface?.clickedThroughFromOverview !== true ||
    proof.adminRoleSurface?.rawInviteTokensVisible !== false
  ) {
    throw new Error("release admin proof did not prove admin overview click-through");
  }
  for (const checkId of proof.generatedFrom?.localCheckIds ?? requiredChecks) {
    if (!proof.adminRoleSurface?.visibleChecks?.includes(checkId)) {
      throw new Error(`release admin proof missing visible check: ${checkId}`);
    }
  }
  for (const itemId of proof.generatedFrom?.unprovenIds ?? requiredUnproven) {
    if (!proof.adminRoleSurface?.visibleUnproven?.includes(itemId)) {
      throw new Error(`release admin proof missing visible unproven item: ${itemId}`);
    }
  }
  return {
    status: "passed",
    path: options.path ?? "target/dev-test-game/release-admin-proof.json",
    proofBoundary: proof.proofBoundary,
    overviewRoleUrl: proof.adminRoleSurface.overviewRoleUrl,
    detailRoleUrl: proof.adminRoleSurface.detailRoleUrl,
    visibleChecks: proof.adminRoleSurface.visibleChecks,
    visibleUnproven: proof.adminRoleSurface.visibleUnproven,
    ...(options.artifact === undefined ? {} : { artifact: options.artifact }),
  };
}

export function validateDevTestGameReleaseRunbook(runbook, options = {}) {
  if (
    runbook?.version !== 1 ||
    runbook.proof !== "dev-test-game-release-runbook" ||
    runbook.status !== "passed" ||
    runbook.releaseReady !== false ||
    runbook.productionReady !== false ||
    runbook.scope !== "local-dev-test-game-release-runbook-rehearsal"
  ) {
    throw new Error("release runbook evidence shape drifted");
  }
  const checks = new Map((runbook.checks ?? []).map((check) => [check.id, check]));
  for (const id of [
    "remaining-readiness-gaps-mapped",
    "rollback-path-carried",
    "support-path-carried",
    "release-claim-boundary-carried",
    "human-approval-boundary-carried",
  ]) {
    if (!checks.has(id)) {
      throw new Error(`release runbook missing check: ${id}`);
    }
  }
  if (checks.get("human-approval-boundary-carried").status !== "unproven") {
    throw new Error("release runbook must keep human approval unproven");
  }
  if (
    checks.get("release-claim-boundary-carried").releaseReady !== false ||
    checks.get("release-claim-boundary-carried").productionReady !== false
  ) {
    throw new Error("release runbook made readiness claims");
  }
  if (
    !Array.isArray(runbook.runbookItems) ||
    runbook.runbookItems.length === 0 ||
    !Array.isArray(runbook.generatedFrom?.unprovenIds)
  ) {
    throw new Error("release runbook item inventory drifted");
  }
  const itemIds = new Set(runbook.runbookItems.map((item) => item.id));
  for (const id of runbook.generatedFrom.unprovenIds) {
    if (!itemIds.has(id)) {
      throw new Error(`release runbook missing runbook item: ${id}`);
    }
  }
  if (
    runbook.rollbackPath?.status !== "rehearsed_locally" ||
    runbook.supportPath?.status !== "local_admin_surface_available"
  ) {
    throw new Error("release runbook rollback/support path drifted");
  }
  return {
    status: "passed",
    path: options.path ?? "target/dev-test-game/release-runbook.json",
    proofBoundary: runbook.proofBoundary,
    runbookItemCount: runbook.runbookItems.length,
    runbookItemIds: runbook.runbookItems.map((item) => item.id),
    rollbackStatus: runbook.rollbackPath.status,
    supportStatus: runbook.supportPath.status,
    ...(options.artifact === undefined ? {} : { artifact: options.artifact }),
  };
}

export function validateDevTestGameReleaseRunbookAdminProof(proof, options = {}) {
  const requiredChecks = [
    "remaining-readiness-gaps-mapped",
    "rollback-path-carried",
    "support-path-carried",
    "release-claim-boundary-carried",
    "human-approval-boundary-carried",
  ];
  if (
    proof?.version !== 1 ||
    proof.proof !== "dev-test-game-release-runbook-admin-proof" ||
    proof.status !== "passed" ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.scope !== "local-dev-test-game-release-runbook-admin-surface"
  ) {
    throw new Error("release runbook admin proof shape drifted");
  }
  if (
    proof.adminRoleSurface?.clickedThroughFromOverview !== true ||
    proof.adminRoleSurface?.rawInviteTokensVisible !== false
  ) {
    throw new Error("release runbook admin proof did not prove click-through");
  }
  for (const checkId of proof.generatedFrom?.checkIds ?? requiredChecks) {
    if (!proof.adminRoleSurface?.visibleChecks?.includes(checkId)) {
      throw new Error(`release runbook admin proof missing visible check: ${checkId}`);
    }
  }
  for (const itemId of proof.generatedFrom?.runbookItemIds ?? []) {
    if (!proof.adminRoleSurface?.visibleUnproven?.includes(itemId)) {
      throw new Error(`release runbook admin proof missing runbook item: ${itemId}`);
    }
  }
  if (!proof.adminRoleSurface?.visibleRelatedLinks?.includes("local-release-readiness")) {
    throw new Error("release runbook admin proof missing release-readiness link");
  }
  return {
    status: "passed",
    path: options.path ?? "target/dev-test-game/release-runbook-admin-proof.json",
    proofBoundary: proof.proofBoundary,
    overviewRoleUrl: proof.adminRoleSurface.overviewRoleUrl,
    detailRoleUrl: proof.adminRoleSurface.detailRoleUrl,
    visibleChecks: proof.adminRoleSurface.visibleChecks,
    visibleUnproven: proof.adminRoleSurface.visibleUnproven,
    visibleRelatedLinks: proof.adminRoleSurface.visibleRelatedLinks,
    ...(options.artifact === undefined ? {} : { artifact: options.artifact }),
  };
}

export function validateDevTestGameSpineManifest(manifest, options = {}) {
  const requiredChecks = [
    "live-spine-order-recorded",
    "sub-spine-orders-recorded",
    "evidence-env-wiring-recorded",
    "release-boundary-carried",
  ];
  if (manifest?.version !== 1) {
    throw new Error(`spine manifest version drifted: ${manifest?.version}`);
  }
  if (manifest.proof !== "dev-test-game-spine-manifest") {
    throw new Error(`unexpected spine manifest id: ${manifest.proof}`);
  }
  if (manifest.status !== "passed") {
    throw new Error(`spine manifest status is ${manifest.status}`);
  }
  if (manifest.scope !== "local-dev-test-game-spine-manifest") {
    throw new Error(`spine manifest scope drifted: ${manifest.scope}`);
  }
  if (manifest.productionReady !== false || manifest.releaseReady !== false) {
    throw new Error("spine manifest must not claim production or release readiness");
  }
  const checks = new Map(
    (manifest.checks ?? []).map((check) => [check.id, check.status]),
  );
  for (const id of requiredChecks) {
    if (checks.get(id) !== "passed") {
      throw new Error(`spine manifest missing passed check: ${id}`);
    }
  }
  const commandCount = Object.keys(manifest.commands ?? {}).length;
  if (commandCount < 4) {
    throw new Error(`spine manifest command count drifted: ${commandCount}`);
  }
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) {
    throw new Error("spine manifest missing artifact list");
  }
  return {
    status: "passed",
    path: options.path ?? "target/dev-test-game/spine-manifest.json",
    checkCount: requiredChecks.length,
    commandCount,
    artifactCount: manifest.artifacts.length,
    proofBoundary: manifest.proofBoundary,
    scope: manifest.scope,
    productionReady: manifest.productionReady,
    releaseReady: manifest.releaseReady,
    ...(options.artifact === undefined ? {} : { artifact: options.artifact }),
  };
}

export function validateDevTestGameSpineManifestAdminProof(proof, options = {}) {
  const requiredChecks = [
    "live-spine-order-recorded",
    "sub-spine-orders-recorded",
    "evidence-env-wiring-recorded",
    "release-boundary-carried",
  ];
  if (proof?.version !== 1) {
    throw new Error(`spine manifest admin proof version drifted: ${proof?.version}`);
  }
  if (proof.proof !== "dev-test-game-spine-manifest-admin-proof") {
    throw new Error(`unexpected spine manifest admin proof id: ${proof.proof}`);
  }
  if (proof.status !== "passed") {
    throw new Error(`spine manifest admin proof status is ${proof.status}`);
  }
  if (proof.scope !== "local-dev-test-game-spine-manifest-admin-surface") {
    throw new Error(`spine manifest admin proof scope drifted: ${proof.scope}`);
  }
  if (proof.productionReady !== false || proof.releaseReady !== false) {
    throw new Error(
      "spine manifest admin proof must not claim production or release readiness",
    );
  }
  if (
    proof.adminRoleSurface?.clickedThroughFromOverview !== true ||
    proof.adminRoleSurface?.rawInviteTokensVisible !== false
  ) {
    throw new Error("spine manifest admin proof did not prove admin overview click-through");
  }
  for (const checkId of requiredChecks) {
    if (!proof.adminRoleSurface?.visibleChecks?.includes(checkId)) {
      throw new Error(`spine manifest admin proof missing visible check: ${checkId}`);
    }
  }
  return {
    status: "passed",
    path: options.path ?? "target/dev-test-game/spine-manifest-admin-proof.json",
    proofBoundary: proof.proofBoundary,
    overviewRoleUrl: proof.adminRoleSurface.overviewRoleUrl,
    detailRoleUrl: proof.adminRoleSurface.detailRoleUrl,
    visibleChecks: proof.adminRoleSurface.visibleChecks,
    ...(options.artifact === undefined ? {} : { artifact: options.artifact }),
  };
}

export function validateDevTestGameAdminSpineProof(proof, options = {}) {
  const requiredProofs = [
    "core-loop",
    "hardening",
    "identity",
    "hosted-identity-evidence",
    "backup",
    "ops",
    "seed",
    "release",
    "release-runbook",
    "race-coverage",
    "hosted-target-preflight",
    "hosted-evidence-lane",
    "hosted-concurrent-race-matrix",
    "hosted-ops-signals",
    "real-hosted-observability-handoff",
    "spine-manifest",
  ];
  if (proof?.version !== 1) {
    throw new Error(`admin spine proof version drifted: ${proof?.version}`);
  }
  if (proof.proof !== "dev-test-game-admin-spine-proof") {
    throw new Error(`unexpected admin spine proof id: ${proof.proof}`);
  }
  if (proof.status !== "passed") {
    throw new Error(`admin spine proof status is ${proof.status}`);
  }
  if (proof.scope !== "local-dev-test-game-admin-spine") {
    throw new Error(`admin spine proof scope drifted: ${proof.scope}`);
  }
  if (proof.productionReady !== false || proof.releaseReady !== false) {
    throw new Error("admin spine proof must not claim production or release readiness");
  }
  if (/invite=(?!REDACTED)/.test(JSON.stringify(proof))) {
    throw new Error("admin spine proof leaked an invite URL token");
  }
  const entries = new Map((proof.adminProofs ?? []).map((entry) => [entry.id, entry]));
  const recoveryEntries = new Map(
    (proof.recovery?.surfaces ?? []).map((entry) => [entry.id, entry]),
  );
  if (entries.size !== requiredProofs.length) {
    throw new Error(`admin spine proof surface count drifted`);
  }
  if (recoveryEntries.size !== requiredProofs.length) {
    throw new Error(`admin spine proof recovery surface count drifted`);
  }
  for (const id of requiredProofs) {
    const entry = entries.get(id);
    if (entry?.status !== "passed") {
      throw new Error(`admin spine proof missing passed entry: ${id}`);
    }
    if (typeof entry.path !== "string" || !entry.path.startsWith("target/")) {
      throw new Error(`admin spine proof entry ${id} has invalid path`);
    }
    if (entry.releaseReady !== false || entry.productionReady !== false) {
      throw new Error(`admin spine proof entry ${id} made readiness claims`);
    }
    if (typeof entry.rerunCommand !== "string" || entry.rerunCommand.trim() === "") {
      throw new Error(`admin spine proof entry ${id} is missing rerun command`);
    }
    if (
      typeof entry.overviewRoleUrl !== "string" ||
      entry.overviewRoleUrl !== "/admin?game=<seeded-game>"
    ) {
      throw new Error(`admin spine proof entry ${id} has invalid overview role URL`);
    }
    if (
      typeof entry.detailRoleUrl !== "string" ||
      !entry.detailRoleUrl.startsWith("/admin/audit/") ||
      !entry.detailRoleUrl.includes("?game=<seeded-game>")
    ) {
      throw new Error(`admin spine proof entry ${id} has invalid detail role URL`);
    }
    if (entry.refreshedInCurrentRun !== true) {
      throw new Error(`admin spine proof entry ${id} did not record refresh status`);
    }
    const recovery = recoveryEntries.get(id);
    if (recovery?.path !== entry.path || recovery.rerunCommand !== entry.rerunCommand) {
      throw new Error(`admin spine proof recovery entry ${id} drifted from proof entry`);
    }
  }
  if (proof.recovery?.status !== "passed") {
    throw new Error(`admin spine proof recovery status drifted: ${proof.recovery?.status}`);
  }
  if (proof.recovery?.nextCommand !== "npm run test:dev-test-game-admin-spine") {
    throw new Error(
      `admin spine proof recovery next command drifted: ${proof.recovery?.nextCommand}`,
    );
  }
  if (Number(proof.recovery?.surfaceCount) !== requiredProofs.length) {
    throw new Error(`admin spine proof recovery surface count drifted`);
  }
  return {
    status: "passed",
    path: options.path ?? "target/dev-test-game/admin-spine-proof.json",
    proofCount: requiredProofs.length,
    proofIds: requiredProofs,
    proofBoundary: proof.proofBoundary,
    recovery: {
      status: proof.recovery.status,
      surfaceCount: proof.recovery.surfaceCount,
      refreshedCount: proof.recovery.refreshedCount,
      nextCommand: proof.recovery.nextCommand,
      surfaces: proof.recovery.surfaces.map((surface) => ({
        id: surface.id,
        status: surface.status,
        path: surface.path,
        rerunCommand: surface.rerunCommand,
        refreshedInCurrentRun: surface.refreshedInCurrentRun === true,
      })),
    },
    ...(options.artifact === undefined ? {} : { artifact: options.artifact }),
  };
}

export function validateDevTestGameAdminSpineAdminProof(proof, options = {}) {
  const requiredChecks = [
    "core-loop",
    "hardening",
    "identity",
    "backup",
    "ops",
    "seed",
    "release",
    "release-runbook",
    "race-coverage",
    "hosted-target-preflight",
    "hosted-concurrent-race-matrix",
    "hosted-ops-signals",
    "spine-manifest",
    "recovery",
    localAdminAuditHandoffCheckIds.spineManifest,
  ];
  if (proof?.version !== 1) {
    throw new Error(`admin spine admin proof version drifted: ${proof?.version}`);
  }
  if (proof.proof !== "dev-test-game-admin-spine-admin-proof") {
    throw new Error(`unexpected admin spine admin proof id: ${proof.proof}`);
  }
  if (proof.status !== "passed") {
    throw new Error(`admin spine admin proof status is ${proof.status}`);
  }
  if (proof.scope !== "local-dev-test-game-admin-spine-admin-surface") {
    throw new Error(`admin spine admin proof scope drifted: ${proof.scope}`);
  }
  if (proof.productionReady !== false || proof.releaseReady !== false) {
    throw new Error(
      "admin spine admin proof must not claim production or release readiness",
    );
  }
  if (
    proof.adminRoleSurface?.clickedThroughFromOverview !== true ||
    proof.adminRoleSurface?.rawInviteTokensVisible !== false
  ) {
    throw new Error("admin spine admin proof did not prove admin overview click-through");
  }
  for (const checkId of requiredChecks) {
    if (!proof.adminRoleSurface?.visibleChecks?.includes(checkId)) {
      throw new Error(`admin spine admin proof missing visible check: ${checkId}`);
    }
  }
  return {
    status: "passed",
    path: options.path ?? "target/dev-test-game/admin-spine-admin-proof.json",
    proofBoundary: proof.proofBoundary,
    overviewRoleUrl: proof.adminRoleSurface.overviewRoleUrl,
    detailRoleUrl: proof.adminRoleSurface.detailRoleUrl,
    visibleChecks: proof.adminRoleSurface.visibleChecks,
    ...(options.artifact === undefined ? {} : { artifact: options.artifact }),
  };
}

export function assertDevTestGameReleaseReadiness(checklist) {
  if (checklist?.version !== DEV_TEST_GAME_RELEASE_READINESS_VERSION) {
    throw new Error(
      `dev-test-game release readiness version drifted: ${checklist?.version}`,
    );
  }
  if (checklist.proof !== "dev-test-game-release-readiness") {
    throw new Error(`unexpected dev-test-game readiness proof id: ${checklist.proof}`);
  }
  if (checklist.status !== "passed") {
    throw new Error(`dev-test-game readiness status is ${checklist.status}`);
  }
  if (checklist.productionReady !== false || checklist.releaseReady !== false) {
    throw new Error("dev-test-game readiness must not claim production or release readiness");
  }
  if (checklist.readinessStatus !== "not_ready") {
    throw new Error(
      `dev-test-game readinessStatus drifted: ${checklist.readinessStatus}`,
    );
  }
  if (
    checklist.readinessSummary?.status !== checklist.readinessStatus ||
    checklist.readinessSummary?.proofStatus !== checklist.status ||
    checklist.readinessSummary?.releaseReady !== checklist.releaseReady ||
    checklist.readinessSummary?.productionReady !== checklist.productionReady ||
    checklist.readinessSummary?.localDevelopmentSpineStatus !==
      checklist.localDevelopmentSpine?.status
  ) {
    throw new Error("dev-test-game readiness summary drifted from checklist state");
  }
  if (checklist.localDevelopmentSpine?.status !== "passed") {
    throw new Error("dev-test-game local development spine did not pass");
  }
  for (const check of checklist.localDevelopmentSpine?.checks ?? []) {
    if (check.status !== "passed") {
      throw new Error(`dev-test-game local check ${check.id} did not pass`);
    }
  }
  assertLocalReadinessDependencyChecks(checklist.localDevelopmentSpine?.checks);
  assertReleaseReadinessCoverageMilestoneConventions(
    checklist.localDevelopmentSpine?.checks,
  );
  const coreLoopCheck = checklist.localDevelopmentSpine?.checks?.find(
    (check) => check.id === coreLoopFeatureSpineSourceCheckId,
  );
  if (!sameStringArray(coreLoopCheck?.laneIds, coreLoopAuditLaneIds)) {
    throw new Error("dev-test-game core-loop readiness check lane list drifted");
  }
  if (
    coreLoopCheck?.spineTargets !== undefined &&
    !validCoreLoopSpineTargets(coreLoopCheck.spineTargets)
  ) {
    throw new Error("dev-test-game core-loop readiness check is missing spine targets");
  }
  const hardeningCheck = checklist.localDevelopmentSpine?.checks?.find(
    (check) => check.id === hardeningFeatureSpineSourceCheckId,
  );
  if (
    hardeningCheck?.spineTargets !== undefined &&
    !validHardeningSpineTargets(hardeningCheck.spineTargets)
  ) {
    throw new Error("dev-test-game hardening readiness check is missing spine targets");
  }
  assertRecoveryMilestoneReadinessChecksMirrorGeneratedFrom(checklist);
  if (checklist.releaseReadiness?.status !== "not_ready") {
    throw new Error("dev-test-game release readiness must remain not_ready");
  }
  const releaseUnproven = checklist.releaseReadiness?.unproven ?? [];
  const releaseUnprovenIds = releaseUnproven.map((item) => item.id);
  if (
    checklist.releaseReadiness?.unprovenCount !== releaseUnproven.length ||
    !sameStringArray(checklist.releaseReadiness?.unprovenIds, releaseUnprovenIds) ||
    checklist.readinessSummary?.unprovenCount !== releaseUnproven.length ||
    !sameStringArray(checklist.readinessSummary?.unprovenIds, releaseUnprovenIds) ||
    checklist.readinessSummary?.firstUnprovenRequiredEvidence !==
      (releaseUnproven[0]?.requiredEvidence ?? null) ||
    checklist.readinessSummary?.reason !== checklist.releaseReadiness?.reason
  ) {
    throw new Error("dev-test-game readiness summary drifted from unproven items");
  }
  const hasBackupCheck = checklist.localDevelopmentSpine?.checks?.some(
    (check) => check.id === "local-backup-restore-drill" && check.status === "passed",
  );
  const hasBackupUnproven = checklist.releaseReadiness?.unproven?.some(
    (item) => item.id === "backup-restore-drill",
  );
  if (hasBackupCheck && hasBackupUnproven) {
    throw new Error("dev-test-game backup/restore cannot be both passed and unproven");
  }
  const hasOpsCheck = checklist.localDevelopmentSpine?.checks?.some(
    (check) => check.id === "local-ops-artifact-bundle" && check.status === "passed",
  );
  const hasOpsUnproven = checklist.releaseReadiness?.unproven?.some(
    (item) => item.id === "observability-and-operations",
  );
  if (hasOpsCheck && hasOpsUnproven) {
    throw new Error("dev-test-game ops artifacts cannot be both passed and unproven");
  }
  const hasHostedOpsSignalsCheck = checklist.localDevelopmentSpine?.checks?.some(
    (check) => check.id === "local-hosted-ops-signals" && check.status === "passed",
  );
  const hasHostedOpsUnproven = checklist.releaseReadiness?.unproven?.some(
    (item) => item.id === "hosted-observability-and-operations",
  );
  if (hasHostedOpsSignalsCheck && hasHostedOpsUnproven) {
    throw new Error("dev-test-game hosted ops signals cannot be both passed and unproven");
  }
  const hasSeedFixtureCheck = checklist.localDevelopmentSpine?.checks?.some(
    (check) => check.id === "local-seed-demo-fixture" && check.status === "passed",
  );
  const hasSeedFixtureUnproven = checklist.releaseReadiness?.unproven?.some(
    (item) => item.id === "seed-demo-fixtures",
  );
  if (hasSeedFixtureCheck && hasSeedFixtureUnproven) {
    throw new Error("dev-test-game seed fixtures cannot be both passed and unproven");
  }
  const hasIdentityAdapterCheck = checklist.localDevelopmentSpine?.checks?.some(
    (check) =>
      check.id === identityFeatureSpineSourceCheckId &&
      check.status === "passed",
  );
  const hasIdentityUnproven = checklist.releaseReadiness?.unproven?.some(
    (item) => item.id === "production-identity",
  );
  if (hasIdentityAdapterCheck && hasIdentityUnproven) {
    throw new Error("dev-test-game identity adapter cannot be both passed and unproven");
  }
  const hasHostedMatrixCheck = checklist.localDevelopmentSpine?.checks?.some(
    (check) => check.id === "local-hosted-concurrent-race-matrix" && check.status === "passed",
  );
  const hasHostedMatrixUnproven = checklist.releaseReadiness?.unproven?.some(
    (item) => item.id === "hosted-concurrent-race-matrix",
  );
  if (hasHostedMatrixCheck && hasHostedMatrixUnproven) {
    throw new Error("dev-test-game hosted matrix cannot be both passed and unproven");
  }
  const hostedDemoCheck = checklist.localDevelopmentSpine?.checks?.find(
    (check) => check.id === "local-hosted-evidence-lane-demo-proof",
  );
  if (
    hostedDemoCheck !== undefined &&
    (hostedDemoCheck.demoOnly !== true ||
      hostedDemoCheck.syntheticExternalTarget !== true ||
      hostedDemoCheck.blockedLaneStatus !== "blocked" ||
      hostedDemoCheck.passedLaneStatus !== "passed")
  ) {
    throw new Error("dev-test-game hosted evidence lane demo check is malformed");
  }
  const hasReleaseRunbookCheck = checklist.localDevelopmentSpine?.checks?.some(
    (check) =>
      check.id === "local-human-release-runbook-rehearsal" &&
      check.status === "passed",
  );
  const hasReleaseRunbookUnproven = checklist.releaseReadiness?.unproven?.some(
    (item) => item.id === "human-release-runbook",
  );
  if (hasReleaseRunbookCheck && hasReleaseRunbookUnproven) {
    throw new Error("dev-test-game release runbook cannot be both passed and unproven");
  }
  const proofGraphHandoffCheck = checklist.localDevelopmentSpine?.checks?.find(
    (check) => check.id === localProofGraphAdminRoleHandoffsCheckId,
  );
  if (
    proofGraphHandoffCheck !== undefined &&
    (!Number.isInteger(proofGraphHandoffCheck.roleHandoffCount) ||
      proofGraphHandoffCheck.roleHandoffCount <= 0 ||
      !Array.isArray(proofGraphHandoffCheck.roleHandoffIds) ||
      !proofGraphHandoffCheck.roleHandoffIds.includes("admin-proof:release") ||
      !Array.isArray(proofGraphHandoffCheck.destinationAuditIds) ||
      !proofGraphHandoffCheck.destinationAuditIds.includes(
        "local-release-readiness",
      ))
  ) {
    throw new Error("dev-test-game proof graph admin handoff check is malformed");
  }
  for (const item of checklist.releaseReadiness?.unproven ?? []) {
    if (item.status !== "unproven") {
      throw new Error(`release item ${item.id} must remain unproven`);
    }
  }
  return checklist;
}

function assertReleaseReadinessCoverageMilestoneConventions(checks = []) {
  const checkById = new Map((checks ?? []).map((check) => [check.id, check]));
  for (const checkId of proofRunLaneCoverageMilestoneIds) {
    const check = checkById.get(checkId);
    if (check === undefined) {
      continue;
    }
    if (
      !Array.isArray(check.laneIds) ||
      !Number.isInteger(check.requiredLaneCount) ||
      !Number.isInteger(check.coveredLaneCount) ||
      !Number.isInteger(check.familyCount) ||
      !Number.isInteger(check.expectedLaneCount) ||
      !Number.isInteger(check.expectedFamilyCount) ||
      check.familyCount <= 0 ||
      check.requiredLaneCount !== check.laneIds.length ||
      check.coveredLaneCount !== check.laneIds.length ||
      check.expectedLaneCount !== check.laneIds.length ||
      check.expectedFamilyCount !== check.familyCount
    ) {
      throw new Error(
        `dev-test-game proof-run coverage milestone missing summary metadata: ${checkId}`,
      );
    }
  }
  for (const checkId of artifactCoverageMilestoneIds) {
    const check = checkById.get(checkId);
    if (check !== undefined && Number.isInteger(check.familyCount)) {
      throw new Error(
        `dev-test-game artifact coverage milestone must not masquerade as proof-run lane coverage: ${checkId}`,
      );
    }
  }
}

function assertRecoveryMilestoneReadinessChecksMirrorGeneratedFrom(checklist) {
  const checkById = new Map(
    (checklist.localDevelopmentSpine?.checks ?? []).map((check) => [
      check.id,
      check,
    ]),
  );
  for (const scenario of recoveryMilestoneCoverageCases) {
    const check = checkById.get(scenario.checkId);
    const snapshot = checklist.generatedFrom?.[scenario.generatedFromKey];
    if (check === undefined || snapshot === undefined) {
      throw new Error(
        `dev-test-game recovery milestone missing shared case surface: ${scenario.checkId}`,
      );
    }
    if (
      check.label !== scenario.label ||
      check.proofBoundary !== scenario.proofBoundary ||
      check.status !== snapshot.status ||
      !sameStringArray(check.laneIds, snapshot.laneIds) ||
      check.requiredLaneCount !== snapshot.requiredLaneCount ||
      check.coveredLaneCount !== snapshot.coveredLaneCount ||
      check.familyCount !== snapshot.familyCount ||
      check.expectedLaneCount !== snapshot.expectedLaneCount ||
      check.expectedFamilyCount !== snapshot.expectedFamilyCount
    ) {
      throw new Error(
        `dev-test-game recovery milestone drifted from generated proof coverage: ${scenario.checkId}`,
      );
    }
    if (
      scenario.hasSurfaceCoverage === true &&
      JSON.stringify(check.surfaceCoverage) !==
        JSON.stringify(snapshot.surfaceCoverage)
    ) {
      throw new Error(
        `dev-test-game recovery milestone surface coverage drifted: ${scenario.checkId}`,
      );
    }
    if (
      scenario.hasSurfaceChecks === true &&
      (!Array.isArray(check.surfaces) ||
        !Array.isArray(snapshot.surfaces) ||
        check.surfaces.length !== snapshot.surfaces.length)
    ) {
      throw new Error(
        `dev-test-game recovery milestone surface checks drifted: ${scenario.checkId}`,
      );
    }
  }
}

function validCoreLoopSpineTargets(spineTargets) {
  return (
    spineTargets !== null &&
    typeof spineTargets === "object" &&
    spineTargets.status === "passed" &&
    typeof spineTargets.detailRoleUrl === "string" &&
    spineTargets.detailRoleUrl.includes("/admin/audit/local-core-loop") &&
    typeof spineTargets.defaultCycleId === "string" &&
    spineTargets.defaultCycleId.length > 0 &&
    typeof spineTargets.defaultRoleUrlId === "string" &&
    spineTargets.defaultRoleUrlId.length > 0 &&
    typeof spineTargets.defaultRoleUrl === "string" &&
    spineTargets.defaultRoleUrl.includes("/g/") &&
    typeof spineTargets.defaultCheckpointId === "string" &&
    spineTargets.defaultCheckpointId.length > 0 &&
    typeof spineTargets.browserProofCommand === "string" &&
    spineTargets.browserProofCommand.includes("test:dev-test-game-live") &&
    Array.isArray(spineTargets.cycleIds) &&
    spineTargets.cycleIds.includes(spineTargets.defaultCycleId) &&
    Array.isArray(spineTargets.roleUrlIds) &&
    spineTargets.roleUrlIds.includes(spineTargets.defaultRoleUrlId) &&
    spineTargets.roleUrlHrefs !== null &&
    typeof spineTargets.roleUrlHrefs === "object" &&
    typeof spineTargets.roleUrlHrefs[spineTargets.defaultRoleUrlId] === "string" &&
    Array.isArray(spineTargets.checkpointIds) &&
    spineTargets.checkpointIds.includes(spineTargets.defaultCheckpointId) &&
    Array.isArray(spineTargets.recoveryHookIds) &&
    spineTargets.recoveryHookIds.includes("invalidActionReject") &&
    Array.isArray(spineTargets.visibleAdminCheckIds) &&
    spineTargets.visibleAdminCheckIds.includes("core-loop-spine") &&
    spineTargets.visibleAdminCheckIds.includes("host-lifecycle-control") &&
    validCoreLoopProductionFeatureTargets(spineTargets.productionFeatureTargets)
  );
}

function validCoreLoopProductionFeatureTargets(productionFeatureTargets) {
  return validProductionFeatureSpineTargetCollection(productionFeatureTargets, {
    declarations: Object.values(releaseReadinessProductionFeatureSpineTargets)
      .filter(
        (declaration) =>
          declaration.sourceCheckId === coreLoopFeatureSpineSourceCheckId,
      ),
    sourceCheckRules: productionFeatureSpineSourceCheckRules,
  });
}

function validHardeningSpineTargets(spineTargets) {
  const completedGameStaleRecoveryLane =
    completedGameStaleRecoverySpineLaneCase();
  const replacementStaleConflictLane =
    replacementStaleConflictMessageSpineLaneCase();
  return (
    spineTargets !== null &&
    typeof spineTargets === "object" &&
    spineTargets.status === "passed" &&
    typeof spineTargets.detailRoleUrl === "string" &&
    spineTargets.detailRoleUrl.includes("/admin/audit/local-hardening") &&
    spineTargets.defaultCycleId === "hardening-stale-conflict" &&
    spineTargets.defaultRoleUrlId === replacementStaleConflictLane.laneId &&
    typeof spineTargets.defaultRoleUrl === "string" &&
    spineTargets.defaultRoleUrl.includes("/g/") &&
    spineTargets.defaultCheckpointId === replacementStaleConflictLane.laneId &&
    typeof spineTargets.browserProofCommand === "string" &&
    spineTargets.browserProofCommand.includes("test:dev-test-game-live") &&
    Array.isArray(spineTargets.cycleIds) &&
    spineTargets.cycleIds.includes("hardening-stale-conflict") &&
    spineTargets.cycleIds.includes(completedGameHardeningSpineCycleId) &&
    Array.isArray(spineTargets.roleUrlIds) &&
    spineTargets.roleUrlIds.includes(replacementStaleConflictLane.laneId) &&
    spineTargets.roleUrlIds.includes(completedGameStaleRecoveryLane.id) &&
    spineTargets.roleUrlHrefs !== null &&
    typeof spineTargets.roleUrlHrefs === "object" &&
    typeof spineTargets.roleUrlHrefs[replacementStaleConflictLane.laneId] ===
      "string" &&
    typeof spineTargets.roleUrlHrefs[completedGameStaleRecoveryLane.id] ===
      "string" &&
    Array.isArray(spineTargets.checkpointIds) &&
    spineTargets.checkpointIds.includes(replacementStaleConflictLane.laneId) &&
    spineTargets.checkpointIds.includes(completedGameStaleRecoveryLane.id) &&
    Array.isArray(spineTargets.recoveryHookIds) &&
    spineTargets.recoveryHookIds.length === 0 &&
    Array.isArray(spineTargets.visibleAdminCheckIds) &&
    spineTargets.visibleAdminCheckIds.includes(
      replacementStaleConflictLane.laneId,
    ) &&
    spineTargets.visibleAdminCheckIds.includes(
      completedGameStaleRecoveryLane.id,
    ) &&
    validHardeningProductionFeatureTargets(spineTargets.productionFeatureTargets)
  );
}

function validHardeningProductionFeatureTargets(productionFeatureTargets) {
  return validProductionFeatureSpineTargetCollection(productionFeatureTargets, {
    declarations: Object.values(releaseReadinessProductionFeatureSpineTargets)
      .filter(
        (declaration) =>
          declaration.sourceCheckId === hardeningFeatureSpineSourceCheckId,
      ),
    sourceCheckRules: productionFeatureSpineSourceCheckRules,
  });
}

function markdownChecklist(checklist) {
  const lines = [
    "# fmarch Dev Test Game Release Readiness",
    "",
    `- status: ${checklist.status}`,
    `- releaseReady: ${checklist.releaseReady}`,
    `- productionReady: ${checklist.productionReady}`,
    `- generatedAt: ${checklist.generatedAt}`,
    `- game: ${checklist.generatedFrom.game}`,
    "",
    checklist.proofBoundary,
    "",
    "## Local Development Spine",
    "",
    `Status: ${checklist.localDevelopmentSpine.status}`,
    "",
    "| Check | Status | Evidence |",
    "| --- | --- | --- |",
  ];
  for (const check of checklist.localDevelopmentSpine.checks) {
    lines.push(`| ${check.label} | ${check.status} | \`${check.evidence}\` |`);
  }
  lines.push(
    "",
    "## Release Readiness",
    "",
    `Status: ${checklist.releaseReadiness.status}`,
    "",
    checklist.releaseReadiness.reason,
    "",
    "| Item | Status | Required Evidence |",
    "| --- | --- | --- |",
  );
  for (const item of checklist.releaseReadiness.unproven) {
    lines.push(`| ${item.id} | ${item.status} | ${item.requiredEvidence} |`);
  }
  return `${lines.join("\n")}\n`;
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  const proofPath = process.argv[2]
    ? path.resolve(process.cwd(), process.argv[2])
    : defaultProofPath;
  const proofRun = JSON.parse(await readFile(proofPath, "utf8"));
  const [
    coreLoopAdminProofOptions,
    hardeningAdminProofOptions,
    backupRestoreOptions,
    backupAdminProofOptions,
    opsArtifactsOptions,
    seedFixtureOptions,
    identityAdapterOptions,
    identityAdminProofOptions,
    hostedIdentityEvidenceAdminProofOptions,
    opsAdminProofOptions,
    hostedOpsSignalsOptions,
    hostedOpsSignalsAdminProofOptions,
    seedAdminProofOptions,
    spineManifestOptions,
    spineManifestAdminProofOptions,
    adminSpineProofOptions,
    adminSpineAdminProofOptions,
    raceCoverageOptions,
    hostedConcurrentRaceMatrixOptions,
    raceCoverageAdminProofOptions,
    hostedConcurrentRaceMatrixAdminProofOptions,
    hostedEvidenceLaneAdminProofOptions,
    hostedEvidenceLaneDemoProofOptions,
    proofGraphAdminProofOptions,
    proofFreshnessAdminProofOptions,
    nextActionAdminProofOptions,
    releaseRunbookOptions,
    releaseRunbookAdminProofOptions,
  ] = await Promise.all([
    readOptionalCoreLoopAdminProof(),
    readOptionalHardeningAdminProof(),
    readOptionalBackupRestoreArtifacts(),
    readOptionalBackupAdminProof(),
    readOptionalOpsArtifacts(),
    readOptionalSeedFixtureSummary({ expectedGame: proofRun?.session?.game }),
    readOptionalIdentityAdapterProof(),
    readOptionalIdentityAdminProof(),
    readOptionalHostedIdentityEvidenceAdminProof(),
    readOptionalOpsAdminProof(),
    readOptionalHostedOpsSignals(),
    readOptionalHostedOpsSignalsAdminProof(),
    readOptionalSeedAdminProof({ expectedGame: proofRun?.session?.game }),
    readOptionalSpineManifest(),
    readOptionalSpineManifestAdminProof(),
    readOptionalAdminSpineProof(),
    readOptionalAdminSpineAdminProof(),
    readOptionalRaceCoverage(),
    readOptionalHostedConcurrentRaceMatrix(),
    readOptionalRaceCoverageAdminProof(),
    readOptionalHostedConcurrentRaceMatrixAdminProof(),
    readOptionalHostedEvidenceLaneAdminProof(),
    readOptionalHostedEvidenceLaneDemoProof(),
    readOptionalProofGraphAdminProof(),
    readOptionalProofFreshnessAdminProof(),
    readOptionalNextActionAdminProof(),
    readOptionalReleaseRunbook(),
    readOptionalReleaseRunbookAdminProof(),
  ]);
  const checklist = buildDevTestGameReleaseReadiness(proofRun, {
    sourcePath: path.relative(repoRoot, proofPath),
    ...(coreLoopAdminProofOptions ?? {}),
    ...(hardeningAdminProofOptions ?? {}),
    ...(backupRestoreOptions ?? {}),
    ...(backupAdminProofOptions ?? {}),
    ...(opsArtifactsOptions ?? {}),
    ...(seedFixtureOptions ?? {}),
    ...(identityAdapterOptions ?? {}),
    ...(identityAdminProofOptions ?? {}),
    ...(hostedIdentityEvidenceAdminProofOptions ?? {}),
    ...(opsAdminProofOptions ?? {}),
    ...(hostedOpsSignalsOptions ?? {}),
    ...(hostedOpsSignalsAdminProofOptions ?? {}),
    ...(seedAdminProofOptions ?? {}),
    ...(spineManifestOptions ?? {}),
    ...(spineManifestAdminProofOptions ?? {}),
    ...(adminSpineProofOptions ?? {}),
    ...(adminSpineAdminProofOptions ?? {}),
    ...(raceCoverageOptions ?? {}),
    ...(hostedConcurrentRaceMatrixOptions ?? {}),
    ...(raceCoverageAdminProofOptions ?? {}),
    ...(hostedConcurrentRaceMatrixAdminProofOptions ?? {}),
    ...(hostedEvidenceLaneAdminProofOptions ?? {}),
    ...(hostedEvidenceLaneDemoProofOptions ?? {}),
    ...(proofGraphAdminProofOptions ?? {}),
    ...(proofFreshnessAdminProofOptions ?? {}),
    ...(nextActionAdminProofOptions ?? {}),
    ...(releaseRunbookOptions ?? {}),
    ...(releaseRunbookAdminProofOptions ?? {}),
  });
  assertDevTestGameReleaseReadiness(checklist);
  await mkdir(artifactDir, { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(checklist, null, 2)}\n`);
  await writeFile(markdownPath, markdownChecklist(checklist));
  console.log(
    `wrote ${path.relative(repoRoot, jsonPath)} (${checklist.releaseReadiness.status})`,
  );
}

async function readOptionalCoreLoopAdminProof() {
  const override = process.env.FMARCH_DEV_TEST_GAME_CORE_LOOP_ADMIN_PROOF;
  const proofPath = await resolveOptionalDefaultArtifactPath(
    override,
    defaultCoreLoopAdminProofPath,
  );
  if (proofPath === undefined) {
    return undefined;
  }
  const now = new Date();
  const artifact = await readFreshArtifactMetadata(proofPath, now);
  return {
    coreLoopAdminProof: JSON.parse(await readFile(proofPath, "utf8")),
    coreLoopAdminProofPath: path.relative(repoRoot, proofPath),
    coreLoopAdminProofArtifact: artifact,
  };
}

async function readOptionalHardeningAdminProof() {
  const override = process.env.FMARCH_DEV_TEST_GAME_HARDENING_ADMIN_PROOF;
  const proofPath = await resolveOptionalDefaultArtifactPath(
    override,
    defaultHardeningAdminProofPath,
  );
  if (proofPath === undefined) {
    return undefined;
  }
  const now = new Date();
  const artifact = await readFreshArtifactMetadata(proofPath, now);
  return {
    hardeningAdminProof: JSON.parse(await readFile(proofPath, "utf8")),
    hardeningAdminProofPath: path.relative(repoRoot, proofPath),
    hardeningAdminProofArtifact: artifact,
  };
}

async function readOptionalOpsArtifacts() {
  const override = process.env.FMARCH_DEV_TEST_GAME_OPS_ARTIFACTS;
  const opsPath = await resolveOptionalDefaultArtifactPath(override, defaultOpsArtifactsPath);
  if (opsPath === undefined) {
    return undefined;
  }
  const now = new Date();
  const artifact = await readFreshArtifactMetadata(opsPath, now);
  return {
    opsArtifacts: JSON.parse(await readFile(opsPath, "utf8")),
    opsArtifactsPath: path.relative(repoRoot, opsPath),
    opsArtifactsArtifact: artifact,
  };
}

async function readOptionalBackupAdminProof() {
  const override = process.env.FMARCH_DEV_TEST_GAME_BACKUP_ADMIN_PROOF;
  const proofPath = await resolveOptionalDefaultArtifactPath(
    override,
    defaultBackupAdminProofPath,
  );
  if (proofPath === undefined) {
    return undefined;
  }
  const now = new Date();
  const artifact = await readFreshArtifactMetadata(proofPath, now);
  return {
    backupAdminProof: JSON.parse(await readFile(proofPath, "utf8")),
    backupAdminProofPath: path.relative(repoRoot, proofPath),
    backupAdminProofArtifact: artifact,
  };
}

async function readOptionalOpsAdminProof() {
  const override = process.env.FMARCH_DEV_TEST_GAME_OPS_ADMIN_PROOF;
  const proofPath = await resolveOptionalDefaultArtifactPath(override, defaultOpsAdminProofPath);
  if (proofPath === undefined) {
    return undefined;
  }
  const now = new Date();
  const artifact = await readFreshArtifactMetadata(proofPath, now);
  return {
    opsAdminProof: JSON.parse(await readFile(proofPath, "utf8")),
    opsAdminProofPath: path.relative(repoRoot, proofPath),
    opsAdminProofArtifact: artifact,
  };
}

async function readOptionalHostedOpsSignals() {
  const override = process.env.FMARCH_DEV_TEST_GAME_HOSTED_OPS_SIGNALS;
  const signalsPath = await resolveOptionalDefaultArtifactPath(
    override,
    defaultHostedOpsSignalsPath,
  );
  if (signalsPath === undefined) {
    return undefined;
  }
  const now = new Date();
  const artifact = await readFreshArtifactMetadata(signalsPath, now);
  return {
    hostedOpsSignals: JSON.parse(await readFile(signalsPath, "utf8")),
    hostedOpsSignalsPath: path.relative(repoRoot, signalsPath),
    hostedOpsSignalsArtifact: artifact,
  };
}

async function readOptionalHostedOpsSignalsAdminProof() {
  const override = process.env.FMARCH_DEV_TEST_GAME_HOSTED_OPS_SIGNALS_ADMIN_PROOF;
  const proofPath = await resolveOptionalDefaultArtifactPath(
    override,
    defaultHostedOpsSignalsAdminProofPath,
  );
  if (proofPath === undefined) {
    return undefined;
  }
  const now = new Date();
  const artifact = await readFreshArtifactMetadata(proofPath, now);
  return {
    hostedOpsSignalsAdminProof: JSON.parse(await readFile(proofPath, "utf8")),
    hostedOpsSignalsAdminProofPath: path.relative(repoRoot, proofPath),
    hostedOpsSignalsAdminProofArtifact: artifact,
  };
}

async function readOptionalSeedAdminProof({ expectedGame } = {}) {
  const override = process.env.FMARCH_DEV_TEST_GAME_SEED_ADMIN_PROOF;
  const proofPath = await resolveOptionalDefaultArtifactPath(override, defaultSeedAdminProofPath);
  if (proofPath === undefined) {
    return undefined;
  }
  const proof = JSON.parse(await readFile(proofPath, "utf8"));
  if (
    override === undefined &&
    !defaultSeedAdminProofMatchesCurrentProof(proof, { expectedGame })
  ) {
    return undefined;
  }
  const now = new Date();
  const artifact = await readFreshArtifactMetadata(proofPath, now);
  return {
    seedAdminProof: proof,
    seedAdminProofPath: path.relative(repoRoot, proofPath),
    seedAdminProofArtifact: artifact,
  };
}

async function readOptionalSeedFixtureSummary({ expectedGame } = {}) {
  const override = process.env.FMARCH_DEV_TEST_GAME_SEED_FIXTURE_SUMMARY;
  const fixturePath = await resolveOptionalDefaultArtifactPath(
    override,
    defaultSeedFixtureSummaryPath,
  );
  if (fixturePath === undefined) {
    return undefined;
  }
  const summary = JSON.parse(await readFile(fixturePath, "utf8"));
  if (
    override === undefined &&
    !defaultSeedFixtureSummaryMatchesCurrentProof(summary, { expectedGame })
  ) {
    return undefined;
  }
  const now = new Date();
  const artifact = await readFreshArtifactMetadata(fixturePath, now);
  return {
    seedFixtureSummary: summary,
    seedFixtureSummaryPath: path.relative(repoRoot, fixturePath),
    seedFixtureSummaryArtifact: artifact,
  };
}

function defaultSeedFixtureSummaryMatchesCurrentProof(summary, { expectedGame } = {}) {
  if (
    expectedGame !== undefined &&
    summary?.generatedFrom?.game !== expectedGame
  ) {
    return false;
  }
  const scenarioIds = new Set(
    (summary?.demoScenarios ?? []).map((scenario) => scenario.id),
  );
  return seedDemoScenarioIds.every((id) => scenarioIds.has(id));
}

function defaultSeedAdminProofMatchesCurrentProof(proof, { expectedGame } = {}) {
  if (
    expectedGame !== undefined &&
    proof?.generatedFrom?.game !== expectedGame
  ) {
    return false;
  }
  const visibleScenarios = new Set(
    proof?.adminRoleSurface?.visibleScenarios ?? [],
  );
  return seedDemoScenarioIds.every((id) => visibleScenarios.has(id));
}

async function readOptionalIdentityAdapterProof() {
  const override = process.env.FMARCH_DEV_TEST_GAME_IDENTITY_ADAPTER_PROOF;
  const proofPath = await resolveOptionalDefaultArtifactPath(
    override,
    defaultIdentityAdapterProofPath,
  );
  if (proofPath === undefined) {
    return undefined;
  }
  const now = new Date();
  const artifact = await readFreshArtifactMetadata(proofPath, now);
  return {
    identityAdapterProof: JSON.parse(await readFile(proofPath, "utf8")),
    identityAdapterProofPath: path.relative(repoRoot, proofPath),
    identityAdapterProofArtifact: artifact,
  };
}

async function readOptionalIdentityAdminProof() {
  const override = process.env.FMARCH_DEV_TEST_GAME_IDENTITY_ADMIN_PROOF;
  const proofPath = await resolveOptionalDefaultArtifactPath(
    override,
    defaultIdentityAdminProofPath,
  );
  if (proofPath === undefined) {
    return undefined;
  }
  const now = new Date();
  const artifact = await readFreshArtifactMetadata(proofPath, now);
  return {
    identityAdminProof: JSON.parse(await readFile(proofPath, "utf8")),
    identityAdminProofPath: path.relative(repoRoot, proofPath),
    identityAdminProofArtifact: artifact,
  };
}

async function readOptionalHostedIdentityEvidenceAdminProof() {
  const override =
    process.env.FMARCH_DEV_TEST_GAME_HOSTED_IDENTITY_EVIDENCE_ADMIN_PROOF;
  const proofPath = await resolveOptionalDefaultArtifactPath(
    override,
    defaultHostedIdentityEvidenceAdminProofPath,
  );
  if (proofPath === undefined) {
    return undefined;
  }
  const now = new Date();
  const artifact = await readFreshArtifactMetadata(proofPath, now);
  return {
    hostedIdentityEvidenceAdminProof: JSON.parse(await readFile(proofPath, "utf8")),
    hostedIdentityEvidenceAdminProofPath: path.relative(repoRoot, proofPath),
    hostedIdentityEvidenceAdminProofArtifact: artifact,
  };
}

async function readOptionalSpineManifest() {
  const override = process.env.FMARCH_DEV_TEST_GAME_SPINE_MANIFEST;
  const manifestPath = await resolveOptionalDefaultArtifactPath(
    override,
    defaultSpineManifestPath,
  );
  if (manifestPath === undefined) {
    return undefined;
  }
  const now = new Date();
  const artifact = await readFreshArtifactMetadata(manifestPath, now);
  return {
    spineManifest: JSON.parse(await readFile(manifestPath, "utf8")),
    spineManifestPath: path.relative(repoRoot, manifestPath),
    spineManifestArtifact: artifact,
  };
}

async function readOptionalSpineManifestAdminProof() {
  const override = process.env.FMARCH_DEV_TEST_GAME_SPINE_MANIFEST_ADMIN_PROOF;
  const proofPath = await resolveOptionalDefaultArtifactPath(
    override,
    defaultSpineManifestAdminProofPath,
  );
  if (proofPath === undefined) {
    return undefined;
  }
  const now = new Date();
  const artifact = await readFreshArtifactMetadata(proofPath, now);
  return {
    spineManifestAdminProof: JSON.parse(await readFile(proofPath, "utf8")),
    spineManifestAdminProofPath: path.relative(repoRoot, proofPath),
    spineManifestAdminProofArtifact: artifact,
  };
}

async function readOptionalBackupRestoreArtifacts() {
  const proofOverride = process.env.FMARCH_DEV_TEST_GAME_BACKUP_RESTORE_PROOF;
  const dumpOverride = process.env.FMARCH_DEV_TEST_GAME_BACKUP_RESTORE_DUMP;
  if (
    (proofOverride === undefined || proofOverride.trim() === "") !==
    (dumpOverride === undefined || dumpOverride.trim() === "")
  ) {
    throw new Error(
      "FMARCH_DEV_TEST_GAME_BACKUP_RESTORE_PROOF and FMARCH_DEV_TEST_GAME_BACKUP_RESTORE_DUMP must be set together",
    );
  }
  const proofPath = await resolveOptionalDefaultArtifactPath(
    proofOverride,
    defaultBackupRestoreProofPath,
  );
  const dumpPath = await resolveOptionalDefaultArtifactPath(
    dumpOverride,
    defaultBackupRestoreDumpPath,
  );
  if (proofPath === undefined && dumpPath === undefined) {
    return undefined;
  }
  if (proofPath === undefined || dumpPath === undefined) {
    throw new Error("dev-test-game backup/restore proof and dump artifacts must exist together");
  }
  const now = new Date();
  const [proofArtifact, dumpArtifact] = await Promise.all([
    readFreshArtifactMetadata(proofPath, now),
    readFreshArtifactMetadata(dumpPath, now),
  ]);
  return {
    backupRestoreProof: JSON.parse(await readFile(proofPath, "utf8")),
    backupRestoreProofPath: path.relative(repoRoot, proofPath),
    backupRestoreDumpPath: path.relative(repoRoot, dumpPath),
    backupRestoreProofArtifact: proofArtifact,
    backupRestoreDumpArtifact: dumpArtifact,
  };
}

async function readOptionalAdminSpineProof() {
  const override = process.env.FMARCH_DEV_TEST_GAME_ADMIN_SPINE_PROOF;
  const proofPath = await resolveOptionalDefaultArtifactPath(
    override,
    defaultAdminSpineProofPath,
  );
  if (proofPath === undefined) {
    return undefined;
  }
  const now = new Date();
  const artifact = await readFreshArtifactMetadata(proofPath, now);
  const proof = JSON.parse(await readFile(proofPath, "utf8"));
  const relativePath = path.relative(repoRoot, proofPath);
  try {
    validateDevTestGameAdminSpineProof(proof, {
      path: relativePath,
      artifact,
    });
  } catch (error) {
    if (override === undefined || override.trim() === "") {
      return undefined;
    }
    throw error;
  }
  return {
    adminSpineProof: proof,
    adminSpineProofPath: relativePath,
    adminSpineProofArtifact: artifact,
  };
}

async function readOptionalAdminSpineAdminProof() {
  const override = process.env.FMARCH_DEV_TEST_GAME_ADMIN_SPINE_ADMIN_PROOF;
  const proofPath = await resolveOptionalDefaultArtifactPath(
    override,
    defaultAdminSpineAdminProofPath,
  );
  if (proofPath === undefined) {
    return undefined;
  }
  const now = new Date();
  const artifact = await readFreshArtifactMetadata(proofPath, now);
  const proof = JSON.parse(await readFile(proofPath, "utf8"));
  const relativePath = path.relative(repoRoot, proofPath);
  try {
    validateDevTestGameAdminSpineAdminProof(proof, {
      path: relativePath,
      artifact,
    });
  } catch (error) {
    if (override === undefined || override.trim() === "") {
      return undefined;
    }
    throw error;
  }
  return {
    adminSpineAdminProof: proof,
    adminSpineAdminProofPath: relativePath,
    adminSpineAdminProofArtifact: artifact,
  };
}

async function readOptionalRaceCoverage() {
  const override = process.env.FMARCH_DEV_TEST_GAME_RACE_COVERAGE;
  const proofPath = await resolveOptionalDefaultArtifactPath(
    override,
    defaultRaceCoveragePath,
  );
  if (proofPath === undefined) {
    return undefined;
  }
  const now = new Date();
  const artifact = await readFreshArtifactMetadata(proofPath, now);
  return {
    raceCoverage: JSON.parse(await readFile(proofPath, "utf8")),
    raceCoveragePath: path.relative(repoRoot, proofPath),
    raceCoverageArtifact: artifact,
  };
}

async function readOptionalHostedConcurrentRaceMatrix() {
  const override = process.env.FMARCH_DEV_TEST_GAME_HOSTED_CONCURRENT_RACE_MATRIX;
  const proofPath = await resolveOptionalDefaultArtifactPath(
    override,
    defaultHostedConcurrentRaceMatrixPath,
  );
  if (proofPath === undefined) {
    return undefined;
  }
  const now = new Date();
  const artifact = await readFreshArtifactMetadata(proofPath, now);
  return {
    hostedConcurrentRaceMatrix: JSON.parse(await readFile(proofPath, "utf8")),
    hostedConcurrentRaceMatrixPath: path.relative(repoRoot, proofPath),
    hostedConcurrentRaceMatrixArtifact: artifact,
  };
}

async function readOptionalRaceCoverageAdminProof() {
  const override = process.env.FMARCH_DEV_TEST_GAME_RACE_COVERAGE_ADMIN_PROOF;
  const proofPath = await resolveOptionalDefaultArtifactPath(
    override,
    defaultRaceCoverageAdminProofPath,
  );
  if (proofPath === undefined) {
    return undefined;
  }
  const now = new Date();
  const artifact = await readFreshArtifactMetadata(proofPath, now);
  return {
    raceCoverageAdminProof: JSON.parse(await readFile(proofPath, "utf8")),
    raceCoverageAdminProofPath: path.relative(repoRoot, proofPath),
    raceCoverageAdminProofArtifact: artifact,
  };
}

async function readOptionalHostedConcurrentRaceMatrixAdminProof() {
  const override =
    process.env.FMARCH_DEV_TEST_GAME_HOSTED_CONCURRENT_RACE_MATRIX_ADMIN_PROOF;
  const proofPath = await resolveOptionalDefaultArtifactPath(
    override,
    defaultHostedConcurrentRaceMatrixAdminProofPath,
  );
  if (proofPath === undefined) {
    return undefined;
  }
  const now = new Date();
  const artifact = await readFreshArtifactMetadata(proofPath, now);
  return {
    hostedConcurrentRaceMatrixAdminProof: JSON.parse(
      await readFile(proofPath, "utf8"),
    ),
    hostedConcurrentRaceMatrixAdminProofPath: path.relative(repoRoot, proofPath),
    hostedConcurrentRaceMatrixAdminProofArtifact: artifact,
  };
}

async function readOptionalHostedEvidenceLaneAdminProof() {
  const override = process.env.FMARCH_DEV_TEST_GAME_HOSTED_EVIDENCE_LANE_ADMIN_PROOF;
  const proofPath = await resolveOptionalDefaultArtifactPath(
    override,
    defaultHostedEvidenceLaneAdminProofPath,
  );
  if (proofPath === undefined) {
    return undefined;
  }
  const now = new Date();
  const artifact = await readFreshArtifactMetadata(proofPath, now);
  return {
    hostedEvidenceLaneAdminProof: JSON.parse(await readFile(proofPath, "utf8")),
    hostedEvidenceLaneAdminProofPath: path.relative(repoRoot, proofPath),
    hostedEvidenceLaneAdminProofArtifact: artifact,
  };
}

async function readOptionalHostedEvidenceLaneDemoProof() {
  const override = process.env.FMARCH_DEV_TEST_GAME_HOSTED_EVIDENCE_LANE_DEMO_PROOF;
  const proofPath = await resolveOptionalDefaultArtifactPath(
    override,
    defaultHostedEvidenceLaneDemoProofPath,
  );
  if (proofPath === undefined) {
    return undefined;
  }
  const now = new Date();
  const artifact = await readFreshArtifactMetadata(proofPath, now);
  return {
    hostedEvidenceLaneDemoProof: JSON.parse(await readFile(proofPath, "utf8")),
    hostedEvidenceLaneDemoProofPath: path.relative(repoRoot, proofPath),
    hostedEvidenceLaneDemoProofArtifact: artifact,
  };
}

async function readOptionalProofGraphAdminProof() {
  const override = process.env.FMARCH_DEV_TEST_GAME_PROOF_GRAPH_ADMIN_PROOF;
  const proofPath = await resolveOptionalDefaultArtifactPath(
    override,
    defaultProofGraphAdminProofPath,
  );
  if (proofPath === undefined) {
    return undefined;
  }
  const now = new Date();
  const artifact = await readFreshArtifactMetadata(proofPath, now);
  return {
    proofGraphAdminProof: JSON.parse(await readFile(proofPath, "utf8")),
    proofGraphAdminProofPath: path.relative(repoRoot, proofPath),
    proofGraphAdminProofArtifact: artifact,
  };
}

async function readOptionalProofFreshnessAdminProof() {
  const override = process.env.FMARCH_DEV_TEST_GAME_PROOF_FRESHNESS_ADMIN_PROOF;
  const proofPath = await resolveOptionalDefaultArtifactPath(
    override,
    defaultProofFreshnessAdminProofPath,
  );
  if (proofPath === undefined) {
    return undefined;
  }
  const now = new Date();
  const artifact = await readFreshArtifactMetadata(proofPath, now);
  return {
    proofFreshnessAdminProof: JSON.parse(await readFile(proofPath, "utf8")),
    proofFreshnessAdminProofPath: path.relative(repoRoot, proofPath),
    proofFreshnessAdminProofArtifact: artifact,
  };
}

async function readOptionalNextActionAdminProof() {
  const override = process.env.FMARCH_DEV_TEST_GAME_NEXT_ACTION_ADMIN_PROOF;
  const proofPath = await resolveOptionalDefaultArtifactPath(
    override,
    defaultNextActionAdminProofPath,
  );
  if (proofPath === undefined) {
    return undefined;
  }
  const now = new Date();
  const artifact = await readFreshArtifactMetadata(proofPath, now);
  return {
    nextActionAdminProof: JSON.parse(await readFile(proofPath, "utf8")),
    nextActionAdminProofPath: path.relative(repoRoot, proofPath),
    nextActionAdminProofArtifact: artifact,
  };
}

async function readOptionalReleaseRunbook() {
  const override = process.env.FMARCH_DEV_TEST_GAME_RELEASE_RUNBOOK;
  const proofPath = await resolveOptionalDefaultArtifactPath(
    override,
    defaultReleaseRunbookPath,
  );
  if (proofPath === undefined) {
    return undefined;
  }
  const now = new Date();
  const artifact = await readFreshArtifactMetadata(proofPath, now);
  return {
    releaseRunbook: JSON.parse(await readFile(proofPath, "utf8")),
    releaseRunbookPath: path.relative(repoRoot, proofPath),
    releaseRunbookArtifact: artifact,
  };
}

async function readOptionalReleaseRunbookAdminProof() {
  const override = process.env.FMARCH_DEV_TEST_GAME_RELEASE_RUNBOOK_ADMIN_PROOF;
  const proofPath = await resolveOptionalDefaultArtifactPath(
    override,
    defaultReleaseRunbookAdminProofPath,
  );
  if (proofPath === undefined) {
    return undefined;
  }
  const now = new Date();
  const artifact = await readFreshArtifactMetadata(proofPath, now);
  return {
    releaseRunbookAdminProof: JSON.parse(await readFile(proofPath, "utf8")),
    releaseRunbookAdminProofPath: path.relative(repoRoot, proofPath),
    releaseRunbookAdminProofArtifact: artifact,
  };
}

async function resolveOptionalDefaultArtifactPath(value, fallback) {
  if (value !== undefined && value.trim() !== "") {
    return resolveArtifactPath(value, fallback);
  }
  try {
    await stat(fallback);
    return fallback;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function resolveArtifactPath(value, fallback) {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  return path.resolve(process.cwd(), value);
}

async function readFreshArtifactMetadata(absolutePath, now) {
  const metadata = await stat(absolutePath);
  const ageMs = now.getTime() - metadata.mtime.getTime();
  if (ageMs < 0) {
    throw new Error(`${path.relative(repoRoot, absolutePath)} has a future mtime`);
  }
  const maxAgeMs = maxBackupArtifactAgeHours * 60 * 60 * 1000;
  if (ageMs > maxAgeMs) {
    throw new Error(
      `${path.relative(repoRoot, absolutePath)} is stale: ${formatAge(ageMs)} old`,
    );
  }
  return {
    path: path.relative(repoRoot, absolutePath),
    mtime: metadata.mtime.toISOString(),
    ageSeconds: Math.round(ageMs / 1000),
    sizeBytes: metadata.size,
  };
}

function assertSessionCapability(proof, sessionKey, capability) {
  const capabilities = proof.restoredApiEvidence?.restoredSessions?.[sessionKey] ?? [];
  if (!capabilities.includes(capability)) {
    throw new Error(`restored ${sessionKey} session missing ${capability}`);
  }
}

function assertDeepEqual(actual, expected, label) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${label} mismatch\nactual: ${actualJson}\nexpected: ${expectedJson}`);
  }
}

function formatAge(ageMs) {
  const hours = Math.floor(ageMs / (60 * 60 * 1000));
  const minutes = Math.floor((ageMs % (60 * 60 * 1000)) / (60 * 1000));
  return `${hours}h ${minutes}m`;
}
