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
  raceCoveragePromotedReloadGroup,
  raceCoveragePromotedReloadGroups,
} from "./dev_test_game_race_coverage.mjs";
import {
  assertDevTestGameHostedEvidenceLaneDemoProof,
  devTestGameHostedEvidenceLaneDemoProofPath,
} from "./dev_test_game_hosted_evidence_lane_demo_proof.mjs";
import {
  cohostDeadlineRecoveryLaneIds,
  hostGenericStaleControlLaneIds,
  hostStaleControlLaneIds,
  hostPhaseStaleRecoveryLaneIds,
  hostPromptStaleControlLaneIds,
  hostRaceReloadLaneIds,
  hostStandaloneStaleControlLaneIds,
} from "./dev_test_game_host_stale_control_scenarios.mjs";
import {
  playerActionConflictRecoveryLaneIds,
  playerActionFoundationLaneIds,
  promotedStalePlayerCommandLaneIds,
} from "./dev_test_game_player_recovery_scenarios.mjs";
import {
  staleConflictMessageLaneIds,
} from "./dev_test_game_hardening_lane_cases.mjs";
import {
  seedAggregateOnlyProofLaneIds,
  seedAliasOnlyProofLaneIds,
  seedScenarioCoverageGroups,
} from "./dev_test_game_seed_scenario_cases.mjs";
import {
  hostedTargetPreflightCheckIds,
} from "./dev_test_game_hosted_target_preflight.mjs";
import {
  hostedOpsReadinessBoundaryCheckId,
  hostedOpsSignalCheckIds,
  hostedOpsTelemetryBoundaryCheckId,
} from "./dev_test_game_hosted_ops_signal_cases.mjs";
import {
  buildReleaseReadinessUnprovenItems,
  releaseAdminProofFallbackUnprovenIds,
} from "./dev_test_game_release_readiness_cases.mjs";
import {
  replacementPrivatePostRaceLaneIds,
  replacementPrivatePostRecoveryLaneIds,
} from "./dev_test_game_replacement_private_scenarios.mjs";
import {
  assertCompletedGameEndgameSurfaceProof,
  completedGameHardeningLaneIds,
} from "./dev_test_game_core_loop_completed_scenarios.mjs";
import {
  assertPlayerActionSubmissionClickProofCase,
  assertPlayerInvalidActionRecoveryProofCase,
  assertPlayerStaleActionAfterTransitionProofCase,
  assertPlayerStaleVoteAfterTransitionProofCase,
  playerActionSubmissionScenario,
  playerInvalidActionRecoveryScenario,
  staleNightFourActionRecoveryScenario,
} from "./dev_test_game_core_loop_action_scenarios.mjs";
import {
  assertHostPhaseTransitionActionProofCase,
  assertHostStaleAdvanceAfterTransitionProofCase,
} from "./dev_test_game_core_loop_host_phase_scenarios.mjs";
import {
  assertPrivateReceiptRoleSurfaceCase,
  assertDayThreePlayerObservationProofCase,
  assertPostDayThreePlayerSurfaceProofCase,
  assertCompletedPrivateChannelProofCases,
  privateReceiptAssertionArgs,
  privateReceiptScenario,
  assertCompletedPrivateChannelReloadProofCase,
  assertPrivateChannelSubmitPostProofCase,
  assertStaleCompletedPrivatePostRecoveryProofCase,
  assertStalePrivateChannelPostPhaseLockedProofCase,
} from "./dev_test_game_core_loop_private_receipt_scenarios.mjs";
import {
  completedPrivateChannelProofAssertionCases,
  completedPrivateChannelReloadScenario,
  privateChannelSubmitPostScenario,
  staleCompletedPrivatePostScenario,
  stalePrivateChannelPostPhaseLockedScenario,
} from "./dev_test_game_core_loop_private_channel_cases.mjs";

export const DEV_TEST_GAME_RELEASE_READINESS_VERSION = 1;
const devTestGameSeededBrowserProofCommand =
  "DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run test:dev-test-game-live";

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
  const staleConflictMessageMilestone = buildStaleConflictMessageMilestone(proof, {
    sourcePath,
  });
  const hostStaleControlMilestone = buildHostStaleControlMilestone(proof, {
    sourcePath,
  });
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
  const replacementRaceReloadMilestone = options.raceCoverage
    ? buildReplacementRaceReloadMilestone(options.raceCoverage, {
        sourcePath: options.raceCoveragePath ?? "target/dev-test-game/race-coverage.json",
      })
    : undefined;
  const hostConcurrentRaceReloadMilestone = options.raceCoverage
    ? buildHostConcurrentRaceReloadMilestone(options.raceCoverage, {
        sourcePath: options.raceCoveragePath ?? "target/dev-test-game/race-coverage.json",
      })
    : undefined;
  const playerConcurrentActionReloadMilestone = options.raceCoverage
    ? buildPlayerConcurrentActionReloadMilestone(options.raceCoverage, {
        sourcePath: options.raceCoveragePath ?? "target/dev-test-game/race-coverage.json",
      })
    : undefined;
  const cohostDeadlineRaceReloadMilestone = options.raceCoverage
    ? buildCohostDeadlineRaceReloadMilestone(options.raceCoverage, {
        sourcePath: options.raceCoveragePath ?? "target/dev-test-game/race-coverage.json",
      })
    : undefined;
  const raceCoveragePromotedMilestones =
    raceCoverageEvidence === undefined
      ? undefined
      : buildRaceCoveragePromotedMilestones(raceCoverageEvidence, {
          replacementRaceReloadMilestone,
          hostConcurrentRaceReloadMilestone,
          playerConcurrentActionReloadMilestone,
          cohostDeadlineRaceReloadMilestone,
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
      id: "local-core-loop-proof",
      label: "Host controls, replacement, player actions, private channels, and day/night loop",
      status: "passed",
      evidence: sourcePath,
      laneIds: [
        "core-loop",
        "day-vote-resolution",
        "day-vote-no-lynch",
        "action-loop",
        "host-deadline-advance",
        "stale-deadline-advance",
        "invalid-action-recovery",
        "resolution-receipts",
        "dead-player-recovery",
        "player-action-boundary",
        "private-channel",
        "host-votecount-publication",
        "host-lifecycle-control",
        "host-modkill-control",
        "replacement-host-issued-invite",
        "replacement-pending-player",
        "replacement-invalid-target-recovery",
        "replacement-console",
        "stale-host-invite-recovery",
        "replacement-stale-success-recovery",
        "replacement-stale-player",
        "replacement-stale-action",
        "replacement-stale-private-channel",
        "replacement-stale-private-receipts",
        "replacement-incoming-player",
      ],
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
      id: "local-hardening-proof",
      label: "Idempotency, reconnect, stale-client, and local concurrent race matrix",
      status: "passed",
      evidence: sourcePath,
      laneIds: [
        "replacement-redeemed-invite-recovery",
        "replacement-session-revocation-recovery",
        "replacement-session-refresh-recovery",
        "replacement-stale-session-after-refresh",
        "replacement-reconnect-recovery",
        ...staleConflictMessageLaneIds,
        "replacement-idempotent-retry",
        ...playerActionFoundationLaneIds,
        ...promotedStalePlayerCommandLaneIds,
        "concurrent-vote-race",
        "concurrent-vote-race-reload",
        "concurrent-player-vote-resolve-race",
        "concurrent-player-vote-resolve-race-reload",
        "concurrent-player-action-advance-race",
        "concurrent-player-action-advance-race-reload",
        "concurrent-cohost-deadline-resolve-race",
        "concurrent-cohost-deadline-resolve-race-reload",
        ...replacementPrivatePostRaceLaneIds,
        "concurrent-replacement-vote-race",
        "concurrent-replacement-vote-race-reload",
        "concurrent-replacement-action-race",
        "concurrent-replacement-action-race-reload",
        "replacement-incoming-action",
        "replacement-action-reconnect",
        "replacement-stale-action-after-resolve",
        ...replacementPrivatePostRecoveryLaneIds,
        "concurrent-host-publish-race",
        "concurrent-host-publish-race-reload",
        ...hostStandaloneStaleControlLaneIds,
        "concurrent-host-lifecycle-race",
        "concurrent-host-lifecycle-race-reload",
        ...hostPromptStaleControlLaneIds,
        ...completedGameHardeningLaneIds(),
        ...playerActionConflictRecoveryLaneIds,
        ...hostGenericStaleControlLaneIds,
        ...hostRaceReloadLaneIds,
        ...hostPhaseStaleRecoveryLaneIds,
        "stale-cohost-deadline",
        ...cohostDeadlineRecoveryLaneIds,
      ],
      ...(hardeningAdminProofEvidence === undefined
        ? {}
        : { adminRoleSurface: hardeningAdminProofEvidence }),
    },
    {
      id: "local-stale-conflict-message-milestone",
      label: "Stale-client conflict messages",
      status: "passed",
      evidence: sourcePath,
      proofBoundary:
        "Local seeded-game proof that stale replacement, stale action, and stale dead-actor action paths show explicit conflict messages and current-control recovery hints.",
      laneIds: [...staleConflictMessageMilestone.laneIds],
      requiredLaneCount: staleConflictMessageMilestone.requiredLaneCount,
      coveredLaneCount: staleConflictMessageMilestone.coveredLaneCount,
    },
    {
      id: "local-host-stale-control-milestone",
      label: "Host stale-control recovery",
      status: "passed",
      evidence: sourcePath,
      proofBoundary:
        "Local seeded-game proof that stale host publish, lifecycle, modkill, prompt, complete, resolve, advance, and deadline controls reject drift and recover through current host role surfaces.",
      laneIds: [...hostStaleControlMilestone.laneIds],
      requiredLaneCount: hostStaleControlMilestone.requiredLaneCount,
      coveredLaneCount: hostStaleControlMilestone.coveredLaneCount,
    },
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
      id: "local-identity-adapter-proof",
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
      blockedCheckCount:
        hostedIdentityEvidenceAdminProofEvidence.visibleUnproven?.length ?? 0,
      adminRoleSurface: hostedIdentityEvidenceAdminProofEvidence,
    });
  }
  if (spineManifestEvidence !== undefined) {
    localChecks.push({
      id: "local-spine-manifest",
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
    localChecks.push({
      id: "local-host-concurrent-race-reload-milestone",
      label: "Host concurrent race reload coverage",
      status: "passed",
      evidence: raceCoverageEvidence.path,
      proofBoundary:
        "Local race-coverage proof that host resolve, advance, deadline, lifecycle, mixed advance, votecount publication, and complete-game races all have reload recovery coverage.",
      cellIds: [...hostConcurrentRaceReloadMilestone.cellIds],
      requiredCellCount: hostConcurrentRaceReloadMilestone.requiredCellCount,
      coveredCellCount: hostConcurrentRaceReloadMilestone.coveredCellCount,
    });
    localChecks.push({
      id: "local-player-concurrent-action-reload-milestone",
      label: "Player concurrent action reload coverage",
      status: "passed",
      evidence: raceCoverageEvidence.path,
      proofBoundary:
        "Local race-coverage proof that player vote changes, night actions, player-vs-host phase races, and completed-game reload recovery all have reload coverage.",
      cellIds: [...playerConcurrentActionReloadMilestone.cellIds],
      requiredCellCount: playerConcurrentActionReloadMilestone.requiredCellCount,
      coveredCellCount: playerConcurrentActionReloadMilestone.coveredCellCount,
    });
    localChecks.push({
      id: "local-cohost-deadline-race-reload-milestone",
      label: "Cohost deadline race reload coverage",
      status: "passed",
      evidence: raceCoverageEvidence.path,
      proofBoundary:
        "Local race-coverage proof that the cohost deadline extension versus host resolve race has reload recovery coverage.",
      cellIds: [...cohostDeadlineRaceReloadMilestone.cellIds],
      requiredCellCount: cohostDeadlineRaceReloadMilestone.requiredCellCount,
      coveredCellCount: cohostDeadlineRaceReloadMilestone.coveredCellCount,
    });
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
            hostConcurrentRaceReloadMilestone: {
              status: hostConcurrentRaceReloadMilestone.status,
              cellIds: [...hostConcurrentRaceReloadMilestone.cellIds],
              requiredCellCount: hostConcurrentRaceReloadMilestone.requiredCellCount,
              coveredCellCount: hostConcurrentRaceReloadMilestone.coveredCellCount,
              gapCount: hostConcurrentRaceReloadMilestone.gapCount,
            },
            playerConcurrentActionReloadMilestone: {
              status: playerConcurrentActionReloadMilestone.status,
              cellIds: [...playerConcurrentActionReloadMilestone.cellIds],
              requiredCellCount:
                playerConcurrentActionReloadMilestone.requiredCellCount,
              coveredCellCount:
                playerConcurrentActionReloadMilestone.coveredCellCount,
              gapCount: playerConcurrentActionReloadMilestone.gapCount,
            },
            cohostDeadlineRaceReloadMilestone: {
              status: cohostDeadlineRaceReloadMilestone.status,
              cellIds: [...cohostDeadlineRaceReloadMilestone.cellIds],
              requiredCellCount: cohostDeadlineRaceReloadMilestone.requiredCellCount,
              coveredCellCount: cohostDeadlineRaceReloadMilestone.coveredCellCount,
              gapCount: cohostDeadlineRaceReloadMilestone.gapCount,
            },
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
      staleConflictMessageMilestone: {
        status: staleConflictMessageMilestone.status,
        laneIds: [...staleConflictMessageMilestone.laneIds],
        requiredLaneCount: staleConflictMessageMilestone.requiredLaneCount,
        coveredLaneCount: staleConflictMessageMilestone.coveredLaneCount,
        gapCount: staleConflictMessageMilestone.gapCount,
      },
      hostStaleControlMilestone: {
        status: hostStaleControlMilestone.status,
        laneIds: [...hostStaleControlMilestone.laneIds],
        requiredLaneCount: hostStaleControlMilestone.requiredLaneCount,
        coveredLaneCount: hostStaleControlMilestone.coveredLaneCount,
        gapCount: hostStaleControlMilestone.gapCount,
      },
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
              ...(hostConcurrentRaceReloadMilestone === undefined
                ? {}
                : {
                    hostConcurrentRaceReloadMilestone: {
                      status: hostConcurrentRaceReloadMilestone.status,
                      cellIds: [...hostConcurrentRaceReloadMilestone.cellIds],
                      requiredCellCount:
                        hostConcurrentRaceReloadMilestone.requiredCellCount,
                      coveredCellCount:
                        hostConcurrentRaceReloadMilestone.coveredCellCount,
                      gapCount: hostConcurrentRaceReloadMilestone.gapCount,
                    },
                  }),
              ...(playerConcurrentActionReloadMilestone === undefined
                ? {}
                : {
                    playerConcurrentActionReloadMilestone: {
                      status: playerConcurrentActionReloadMilestone.status,
                      cellIds: [...playerConcurrentActionReloadMilestone.cellIds],
                      requiredCellCount:
                        playerConcurrentActionReloadMilestone.requiredCellCount,
                      coveredCellCount:
                        playerConcurrentActionReloadMilestone.coveredCellCount,
                      gapCount: playerConcurrentActionReloadMilestone.gapCount,
                    },
                  }),
              ...(cohostDeadlineRaceReloadMilestone === undefined
                ? {}
                : {
                    cohostDeadlineRaceReloadMilestone: {
                      status: cohostDeadlineRaceReloadMilestone.status,
                      cellIds: [...cohostDeadlineRaceReloadMilestone.cellIds],
                      requiredCellCount:
                        cohostDeadlineRaceReloadMilestone.requiredCellCount,
                      coveredCellCount:
                        cohostDeadlineRaceReloadMilestone.coveredCellCount,
                      gapCount: cohostDeadlineRaceReloadMilestone.gapCount,
                    },
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
              staleConflictMessageMilestone: {
                status: staleConflictMessageMilestone.status,
                laneIds: [...staleConflictMessageMilestone.laneIds],
                requiredLaneCount: staleConflictMessageMilestone.requiredLaneCount,
                coveredLaneCount: staleConflictMessageMilestone.coveredLaneCount,
                gapCount: staleConflictMessageMilestone.gapCount,
              },
              hostStaleControlMilestone: {
                status: hostStaleControlMilestone.status,
                laneIds: [...hostStaleControlMilestone.laneIds],
                requiredLaneCount: hostStaleControlMilestone.requiredLaneCount,
                coveredLaneCount: hostStaleControlMilestone.coveredLaneCount,
                gapCount: hostStaleControlMilestone.gapCount,
              },
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
  ];
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
  const laneIds = [...staleConflictMessageLaneIds];
  const coveredLaneCount = laneIds.filter(
    (laneId) => lanes.get(laneId)?.status === "passed",
  ).length;
  const gapCount = laneIds.length - coveredLaneCount;
  if (gapCount !== 0) {
    throw new Error(
      `stale conflict-message milestone missing passed lanes from ${sourcePath}: ${laneIds
        .filter((laneId) => lanes.get(laneId)?.status !== "passed")
        .join(", ")}`,
    );
  }
  return {
    status: "passed",
    laneIds,
    requiredLaneCount: laneIds.length,
    coveredLaneCount,
    gapCount,
  };
}

function buildHostStaleControlMilestone(proof, { sourcePath }) {
  const lanes = new Map(proof.lanes.map((lane) => [lane.id, lane]));
  const laneIds = [...hostStaleControlLaneIds];
  const coveredLaneCount = laneIds.filter(
    (laneId) => lanes.get(laneId)?.status === "passed",
  ).length;
  const gapCount = laneIds.length - coveredLaneCount;
  if (gapCount !== 0) {
    throw new Error(
      `host stale-control milestone missing passed lanes from ${sourcePath}: ${laneIds
        .filter((laneId) => lanes.get(laneId)?.status !== "passed")
        .join(", ")}`,
    );
  }
  return {
    status: "passed",
    laneIds,
    requiredLaneCount: laneIds.length,
    coveredLaneCount,
    gapCount,
  };
}

function buildReplacementRaceReloadMilestone(raceCoverage, { sourcePath }) {
  assertDevTestGameRaceCoverage(raceCoverage);
  const cells = new Map(raceCoverage.cells.map((cell) => [cell.id, cell]));
  const cellIds = [...replacementRaceReloadCellIds];
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
      `replacement race-reload milestone missing covered cells from ${sourcePath}: ${cellIds
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

function buildHostConcurrentRaceReloadMilestone(raceCoverage, { sourcePath }) {
  assertDevTestGameRaceCoverage(raceCoverage);
  const cells = new Map(raceCoverage.cells.map((cell) => [cell.id, cell]));
  const cellIds = [...hostConcurrentRaceReloadCellIds];
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
      `host concurrent race-reload milestone missing covered cells from ${sourcePath}: ${cellIds
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

function buildPlayerConcurrentActionReloadMilestone(raceCoverage, { sourcePath }) {
  assertDevTestGameRaceCoverage(raceCoverage);
  const cells = new Map(raceCoverage.cells.map((cell) => [cell.id, cell]));
  const cellIds = [...playerConcurrentActionReloadCellIds];
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
      `player concurrent action reload milestone missing covered cells from ${sourcePath}: ${cellIds
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

function buildCohostDeadlineRaceReloadMilestone(raceCoverage, { sourcePath }) {
  assertDevTestGameRaceCoverage(raceCoverage);
  const cells = new Map(raceCoverage.cells.map((cell) => [cell.id, cell]));
  const cellIds = [...cohostDeadlineRaceReloadCellIds];
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
      `cohost deadline race reload milestone missing covered cells from ${sourcePath}: ${cellIds
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
  {
    replacementRaceReloadMilestone,
    hostConcurrentRaceReloadMilestone,
    playerConcurrentActionReloadMilestone,
    cohostDeadlineRaceReloadMilestone,
  },
) {
  const milestoneByGroupId = new Map([
    ["replacement-race-reload", replacementRaceReloadMilestone],
    ["host-concurrent-race-reload", hostConcurrentRaceReloadMilestone],
    ["player-concurrent-action-reload", playerConcurrentActionReloadMilestone],
    ["cohost-deadline-race-reload", cohostDeadlineRaceReloadMilestone],
  ]);
  const groups = raceCoveragePromotedReloadGroups.map((group) =>
    buildRaceCoveragePromotedMilestoneGroup(
      group,
      milestoneByGroupId.get(group.id),
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

const replacementRaceReloadCellIds = Object.freeze([
  ...raceCoveragePromotedReloadGroup("replacement-race-reload").cellIds,
]);

const hostConcurrentRaceReloadCellIds = Object.freeze([
  ...raceCoveragePromotedReloadGroup("host-concurrent-race-reload").cellIds,
]);

const playerConcurrentActionReloadCellIds = Object.freeze([
  ...raceCoveragePromotedReloadGroup("player-concurrent-action-reload").cellIds,
]);

const cohostDeadlineRaceReloadCellIds = Object.freeze([
  ...raceCoveragePromotedReloadGroup("cohost-deadline-race-reload").cellIds,
]);

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
  const requiredChecks = [
    "core-loop-spine",
    "core-loop",
    "day-vote-resolution",
    "day-vote-no-lynch",
    "action-loop",
    "host-deadline-advance",
    "stale-deadline-advance",
    "invalid-action-recovery",
    "resolution-receipts",
    "dead-player-recovery",
    "player-action-boundary",
    "private-channel",
    "host-votecount-publication",
    "host-lifecycle-control",
    "host-modkill-control",
    "replacement-host-issued-invite",
    "replacement-pending-player",
    "replacement-invalid-target-recovery",
    "replacement-console",
    "stale-host-invite-recovery",
    "replacement-stale-success-recovery",
    "replacement-stale-player",
    "replacement-stale-action",
    "replacement-stale-private-channel",
    "replacement-stale-private-receipts",
    "replacement-incoming-player",
  ];
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
  assertCoreLoopPrivateChannelRoleSurface(proof.privateChannelRoleSurface);
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
  const checkpoint = hostRoleSurface?.hostLifecycleControlCheckpoint;
  const clickProof = hostRoleSurface?.hostLifecycleControlClickProof;
  const staleRejectProof = hostRoleSurface?.hostLifecycleStaleRejectProof;
  if (
    hostRoleSurface?.status !== "passed" ||
    hostRoleSurface.clickedThroughFromRoleUrl !== true ||
    hostRoleSurface.releaseReady !== false ||
    hostRoleSurface.productionReady !== false ||
    typeof hostRoleSurface.sourceRoleUrl !== "string" ||
    !hostRoleSurface.sourceRoleUrl.includes("/g/") ||
    typeof hostRoleSurface.visitedRolePath !== "string" ||
    !hostRoleSurface.visitedRolePath.endsWith("/host") ||
    hostRoleSurface.surfaceTestId !== "host-console-surface" ||
    hostRoleSurface.checkpointTestId !== "host-lifecycle-control-checkpoint" ||
    checkpoint?.proofCheckId !== "host-lifecycle-control" ||
    checkpoint.phaseId !== "D01" ||
    checkpoint.phaseState !== "open" ||
    checkpoint.slotId !== "slot-7" ||
    checkpoint.actionState !== "enabled:mark_dead,modkill_slot" ||
    !checkpoint.deadlineAffordance?.includes("resolve_phase") ||
    !checkpoint.recoveryText?.includes("Reject PhaseLocked") ||
    !checkpoint.statusText?.includes(
      "Host lifecycle controls are reachable from this role URL",
    )
  ) {
    throw new Error("core-loop admin proof missing host lifecycle role checkpoint");
  }
  for (const rowId of [
    "phase",
    "slot",
    "actionState",
    "deadlineAffordance",
    "recovery",
  ]) {
    if (!checkpoint.visibleRows?.includes(rowId)) {
      throw new Error(`host lifecycle checkpoint missing visible row: ${rowId}`);
    }
  }
  assertCoreLoopHostLifecycleClickProof({
    clickProof,
    expectedGame: gameFromRoleUrl(hostRoleSurface.sourceRoleUrl),
  });
  assertCoreLoopHostLifecycleStaleRejectProof({
    staleRejectProof,
    expectedGame: gameFromRoleUrl(hostRoleSurface.sourceRoleUrl),
  });
}

function assertCoreLoopHostLifecycleClickProof({ clickProof, expectedGame }) {
  if (
    clickProof?.status !== "passed" ||
    clickProof.clickedAction !== "lock_thread" ||
    clickProof.commandKind !== "LockThread" ||
    clickProof.command?.game !== expectedGame ||
    clickProof.commandStatus?.state !== "ack" ||
    !clickProof.commandStatus?.message?.includes("Ack: stream seqs 601") ||
    clickProof.commandOutcome?.state !== "ack" ||
    !clickProof.commandOutcome?.message?.includes("Ack: stream seqs 601") ||
    clickProof.bridgePlan?.role !== "moderator" ||
    clickProof.bridgePlan.commandKind !== "LockThread" ||
    clickProof.bridgePlan.commandEndpoint !== "/commands" ||
    clickProof.bridgePlan.finalState !== "ack" ||
    clickProof.bridgePlan.projectionRefreshKeys?.length !== 0 ||
    clickProof.projection?.phase?.id !== "D01" ||
    clickProof.projection?.phase?.locked !== true ||
    clickProof.checkpointPhaseStateAfterAck !== "locked" ||
    clickProof.checkpointDeadlineAffordanceAfterAck !==
      "unlock_thread,advance_phase" ||
    !String(clickProof.statusText ?? "")
      .toLowerCase()
      .includes("ack: stream seqs 601") ||
    clickProof.activityCount !== 1 ||
    !String(clickProof.activityStatusText ?? "")
      .toLowerCase()
      .includes("ack: stream seqs 601")
  ) {
    throw new Error("core-loop admin proof missing host lifecycle click ACK");
  }
}

function assertCoreLoopHostLifecycleStaleRejectProof({
  staleRejectProof,
  expectedGame,
}) {
  if (
    staleRejectProof?.status !== "passed" ||
    staleRejectProof.clickedAction !== "lock_thread" ||
    staleRejectProof.commandKind !== "LockThread" ||
    staleRejectProof.command?.game !== expectedGame ||
    staleRejectProof.commandStatus?.state !== "reject" ||
    staleRejectProof.commandStatus.error !== "PhaseLocked" ||
    !staleRejectProof.commandStatus?.message?.includes(
      "Reject PhaseLocked: phase locked",
    ) ||
    staleRejectProof.commandOutcome?.state !== "reject" ||
    staleRejectProof.commandOutcome.error !== "PhaseLocked" ||
    !staleRejectProof.commandOutcome?.message?.includes(
      "Reject PhaseLocked: phase locked",
    ) ||
    staleRejectProof.bridgePlan?.role !== "moderator" ||
    staleRejectProof.bridgePlan.commandKind !== "LockThread" ||
    staleRejectProof.bridgePlan.commandEndpoint !== "/commands" ||
    staleRejectProof.bridgePlan.finalState !== "reject" ||
    staleRejectProof.bridgePlan.projectionRefreshKeys?.[0] !== "host" ||
    staleRejectProof.bridgePlan.projectionRefreshKeys?.length !== 1 ||
    staleRejectProof.projection?.phase?.id !== "D01" ||
    staleRejectProof.projection?.phase?.locked !== false ||
    staleRejectProof.checkpointPhaseStateAfterReject !== "open" ||
    staleRejectProof.checkpointDeadlineAffordanceAfterReject !==
      "resolve_phase,lock_thread" ||
    !String(staleRejectProof.recoveryText ?? "").includes("Reject PhaseLocked") ||
    staleRejectProof.activityCount !== 1 ||
    !String(staleRejectProof.activityStatusText ?? "")
      .toLowerCase()
      .includes("reject phaselocked: phase locked")
  ) {
    throw new Error("core-loop admin proof missing host stale lifecycle recovery");
  }
}

function assertCoreLoopPlayerActionCheckpoint(playerRoleSurface) {
  const scenario = playerActionSubmissionScenario();
  const checkpoint = playerRoleSurface?.playerActionSubmissionCheckpoint;
  const clickProof = playerRoleSurface?.playerActionSubmissionClickProof;
  const invalidRecoveryProof = playerRoleSurface?.playerActionInvalidRecoveryProof;
  if (
    playerRoleSurface?.status !== "passed" ||
    playerRoleSurface.clickedThroughFromRoleUrl !== true ||
    playerRoleSurface.releaseReady !== false ||
    playerRoleSurface.productionReady !== false ||
    typeof playerRoleSurface.sourceRoleUrl !== "string" ||
    !playerRoleSurface.sourceRoleUrl.includes("/g/") ||
    typeof playerRoleSurface.visitedRolePath !== "string" ||
    !playerRoleSurface.visitedRolePath.includes("/g/") ||
    playerRoleSurface.surfaceTestId !== "player-surface" ||
    playerRoleSurface.checkpointTestId !== "player-action-submission-checkpoint" ||
    checkpoint?.proofCheckId !== "player-action-submission" ||
    checkpoint.phaseId !== "N02" ||
    checkpoint.phaseState !== "open" ||
    checkpoint.actorSlot !== scenario.actorSlot ||
    checkpoint.actionState !== `enabled:${scenario.clickedAction}` ||
    checkpoint.selectedAction !== scenario.actionId ||
    checkpoint.targetSlots !== scenario.targetSlot ||
    checkpoint.receiptState !== "idle" ||
    !checkpoint.targetText?.includes(
      `${scenario.actionId} -> ${scenario.targetSlot}`,
    ) ||
    !checkpoint.recoveryText?.includes("Reject PhaseLocked") ||
    !String(checkpoint.statusText ?? "")
      .toLowerCase()
      .includes("player action submission is reachable from this role url")
  ) {
    throw new Error("core-loop admin proof missing player action role checkpoint");
  }
  for (const rowId of [
    "phase",
    "actor",
    "actionState",
    "target",
    "receipt",
    "recovery",
  ]) {
    if (!checkpoint.visibleRows?.includes(rowId)) {
      throw new Error(`player action checkpoint missing visible row: ${rowId}`);
    }
  }
  assertCoreLoopPlayerActionClickProof({
    clickProof,
    expectedGame: gameFromRoleUrl(playerRoleSurface.sourceRoleUrl),
  });
  assertCoreLoopPlayerActionInvalidRecoveryProof({
    invalidRecoveryProof,
    expectedGame: gameFromRoleUrl(playerRoleSurface.sourceRoleUrl),
  });
}

function assertCoreLoopPlayerActionClickProof({ clickProof, expectedGame }) {
  assertPlayerActionSubmissionClickProofCase({
    proof: clickProof,
    expectedGame,
  });
}

function assertCoreLoopPlayerActionInvalidRecoveryProof({
  invalidRecoveryProof,
  expectedGame,
}) {
  assertPlayerInvalidActionRecoveryProofCase({
    proof: invalidRecoveryProof,
    expectedGame,
  });
}

function assertCoreLoopTargetResolutionReceiptSurface(targetSurface) {
  const expectedGame = gameFromRoleUrl(targetSurface?.sourceRoleUrl);
  assertCoreLoopPrivateReceiptRoleSurface({
    proof: targetSurface,
    ...privateReceiptAssertionArgs({
      scenario: privateReceiptScenario("n01-target-receipt"),
      expectedGame,
      sourceRoleUrl: targetSurface?.sourceRoleUrl,
    }),
    errorMessage: "core-loop admin proof missing target resolution receipt surface",
  });
}

function assertCoreLoopNormalResolutionPrivacySurface(normalSurface) {
  const expectedGame = gameFromRoleUrl(normalSurface?.sourceRoleUrl);
  assertCoreLoopPrivateReceiptRoleSurface({
    proof: normalSurface,
    ...privateReceiptAssertionArgs({
      scenario: privateReceiptScenario("n01-normal-privacy"),
      expectedGame,
      sourceRoleUrl: normalSurface?.sourceRoleUrl,
    }),
    errorMessage: "core-loop admin proof missing normal resolution privacy surface",
  });
}

function assertCoreLoopTargetDayVoteReceiptSurface(targetSurface) {
  const expectedGame = gameFromRoleUrl(targetSurface?.sourceRoleUrl);
  assertCoreLoopPrivateReceiptRoleSurface({
    proof: targetSurface,
    ...privateReceiptAssertionArgs({
      scenario: privateReceiptScenario("d02-target-receipt"),
      expectedGame,
      sourceRoleUrl: targetSurface?.sourceRoleUrl,
    }),
    errorMessage: "core-loop admin proof missing target day-vote receipt surface",
  });
}

function assertCoreLoopNormalDayVotePrivacySurface(normalSurface) {
  const expectedGame = gameFromRoleUrl(normalSurface?.sourceRoleUrl);
  assertCoreLoopPrivateReceiptRoleSurface({
    proof: normalSurface,
    ...privateReceiptAssertionArgs({
      scenario: privateReceiptScenario("d02-normal-privacy"),
      expectedGame,
      sourceRoleUrl: normalSurface?.sourceRoleUrl,
    }),
    errorMessage: "core-loop admin proof missing normal day-vote privacy surface",
  });
}

function assertCoreLoopPrivateReceiptRoleSurface({
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
  expectedPrivateReceiptStatus,
  expectedPrivateReceiptPhaseId,
  expectedResyncNotificationEffect,
  expectedResyncNotificationStatus,
  expectedPrivateQueueBoundaryStatus,
  expectedProjectionPhaseId,
  expectedProjectionLocked,
  expectedResyncSnapshotPhaseId,
  expectedCommandStateEndpoint,
  expectedNotificationsEndpoint,
  errorMessage,
}) {
  assertPrivateReceiptRoleSurfaceCase({
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
    expectedPrivateReceiptStatus,
    expectedPrivateReceiptPhaseId,
    expectedResyncNotificationEffect,
    expectedResyncNotificationStatus,
    expectedPrivateQueueBoundaryStatus,
    expectedProjectionPhaseId,
    expectedProjectionLocked,
    expectedResyncSnapshotPhaseId,
    expectedCommandStateEndpoint,
    expectedNotificationsEndpoint,
    errorMessage,
  });
}

function assertCoreLoopTargetPostDayVoteAdvanceSurface(targetSurface) {
  const expectedGame = gameFromRoleUrl(targetSurface?.sourceRoleUrl);
  if (
    targetSurface?.status !== "passed" ||
    targetSurface.clickedThroughFromRoleUrl !== true ||
    targetSurface.releaseReady !== false ||
    targetSurface.productionReady !== false ||
    targetSurface.rawInviteTokensVisible !== false ||
    targetSurface.targetSlot !== "slot-2" ||
    targetSurface.principalUserId !== "player_ilya" ||
    typeof targetSurface.sourceRoleUrl !== "string" ||
    !targetSurface.sourceRoleUrl.includes("/g/") ||
    !targetSurface.sourceRoleUrl.includes("private=notification-1") ||
    typeof targetSurface.visitedRolePath !== "string" ||
    !targetSurface.visitedRolePath.includes("/g/") ||
    !targetSurface.visitedRolePath.includes("private=notification-1") ||
    targetSurface.surfaceTestId !== "player-surface" ||
    targetSurface.checkpoint?.phaseId !== "N02" ||
    targetSurface.checkpoint.phaseState !== "open" ||
    targetSurface.checkpoint.actorSlot !== "slot-2" ||
    targetSurface.checkpoint.actionState !== "disabled:actor is not alive" ||
    targetSurface.checkpoint.receiptState !== "idle" ||
    !String(targetSurface.checkpoint.statusText ?? "")
      .toLowerCase()
      .includes("player action unavailable: actor is not alive") ||
    targetSurface.privateQueueBoundary?.status !==
      "principal-scoped-private-projections" ||
    targetSurface.privateQueueBoundary.count !== 1 ||
    !String(targetSurface.privateQueueBoundary.text ?? "").includes(
      "principal-scoped endpoints",
    ) ||
    targetSurface.privateNotice?.id !== "notification-1" ||
    targetSurface.privateNotice.kind !== "notification" ||
    !String(targetSurface.privateNotice.text ?? "").includes("player_killed") ||
    !String(targetSurface.privateNotice.text ?? "").includes("day_vote") ||
    targetSurface.privateNotice.detailText !== "Phase D02" ||
    targetSurface.projectionCommandState?.actorSlot !== "slot-2" ||
    targetSurface.projectionCommandState?.actorAlive !== false ||
    targetSurface.projectionCommandState?.actorStatus !== "dead" ||
    targetSurface.projectionCommandState?.phase?.phaseId !== "N02" ||
    targetSurface.projectionCommandState?.phase?.locked !== false ||
    targetSurface.projectionCommandState?.actions?.length !== 0 ||
    !String(targetSurface.projectionCommandState?.boundary ?? "").includes(
      "target role remained dead",
    ) ||
    targetSurface.projectionNotifications?.[0]?.effect !== "player_killed" ||
    targetSurface.projectionNotifications?.[0]?.status !== "day_vote" ||
    targetSurface.resyncFromSeq !== 903 ||
    targetSurface.resyncSnapshotCommandState?.actorSlot !== "slot-2" ||
    targetSurface.resyncSnapshotCommandState?.phase?.phaseId !== "N02" ||
    targetSurface.resyncSnapshotNotifications?.[0]?.status !== "day_vote" ||
    targetSurface.coldLoadEndpoints?.notificationsEndpoint !==
      `/games/${expectedGame}/notifications?principal_user_id=player_ilya` ||
    targetSurface.coldLoadEndpoints?.commandStateEndpoint !==
      `/games/${expectedGame}/player-command-state?principal_user_id=player_ilya&slot_id=slot-2`
  ) {
    throw new Error(
      "core-loop admin proof missing target post-day-vote advance surface",
    );
  }
}

function assertCoreLoopNormalPostDayVoteAdvanceSurface(normalSurface) {
  const expectedGame = gameFromRoleUrl(normalSurface?.sourceRoleUrl);
  if (
    normalSurface?.status !== "passed" ||
    normalSurface.clickedThroughFromRoleUrl !== true ||
    normalSurface.releaseReady !== false ||
    normalSurface.productionReady !== false ||
    normalSurface.rawInviteTokensVisible !== false ||
    normalSurface.normalSlot !== "slot-4" ||
    normalSurface.principalUserId !== "player_rowan" ||
    normalSurface.targetReceiptVisible !== false ||
    typeof normalSurface.sourceRoleUrl !== "string" ||
    !normalSurface.sourceRoleUrl.includes("/g/") ||
    !normalSurface.sourceRoleUrl.includes("private=notification-1") ||
    typeof normalSurface.visitedRolePath !== "string" ||
    !normalSurface.visitedRolePath.includes("/g/") ||
    !normalSurface.visitedRolePath.includes("private=notification-1") ||
    normalSurface.surfaceTestId !== "player-surface" ||
    normalSurface.checkpoint?.phaseId !== "N02" ||
    normalSurface.checkpoint.phaseState !== "open" ||
    normalSurface.checkpoint.actorSlot !== "slot-4" ||
    normalSurface.checkpoint.actionState !==
      "disabled:no legal action available" ||
    normalSurface.checkpoint.receiptState !== "idle" ||
    !String(normalSurface.checkpoint.statusText ?? "")
      .toLowerCase()
      .includes("player action unavailable: no legal action available") ||
    normalSurface.privateQueueBoundary?.status !==
      "principal-scoped-private-projections" ||
    normalSurface.privateQueueBoundary.count !== 0 ||
    !String(normalSurface.privateQueueBoundary.text ?? "").includes(
      "principal-scoped endpoints",
    ) ||
    !String(normalSurface.privateEmptyText ?? "").includes(
      "No private results visible",
    ) ||
    normalSurface.projectionCommandState?.actorSlot !== "slot-4" ||
    normalSurface.projectionCommandState?.actorAlive !== true ||
    normalSurface.projectionCommandState?.actorStatus !== "alive" ||
    normalSurface.projectionCommandState?.phase?.phaseId !== "N02" ||
    normalSurface.projectionCommandState?.phase?.locked !== false ||
    normalSurface.projectionCommandState?.actions?.length !== 0 ||
    !String(normalSurface.projectionCommandState?.boundary ?? "").includes(
      "normal role stayed alive",
    ) ||
    normalSurface.projectionNotifications?.length !== 0 ||
    normalSurface.resyncFromSeq !== 903 ||
    normalSurface.resyncSnapshotCommandState?.actorSlot !== "slot-4" ||
    normalSurface.resyncSnapshotCommandState?.phase?.phaseId !== "N02" ||
    normalSurface.resyncSnapshotNotifications?.length !== 0 ||
    normalSurface.coldLoadEndpoints?.notificationsEndpoint !==
      `/games/${expectedGame}/notifications?principal_user_id=player_rowan` ||
    normalSurface.coldLoadEndpoints?.commandStateEndpoint !==
      `/games/${expectedGame}/player-command-state?principal_user_id=player_rowan&slot_id=slot-4`
  ) {
    throw new Error(
      "core-loop admin proof missing normal post-day-vote advance surface",
    );
  }
}

function assertCoreLoopNightActionResolutionReceiptSurface(targetSurface) {
  const expectedGame = gameFromRoleUrl(targetSurface?.sourceRoleUrl);
  const scenario = privateReceiptScenario("n02-target-receipt");
  if (
    targetSurface?.status !== "passed" ||
    targetSurface.clickedThroughFromRoleUrl !== true ||
    targetSurface.releaseReady !== false ||
    targetSurface.productionReady !== false ||
    targetSurface.rawInviteTokensVisible !== false ||
    targetSurface.targetSlot !== scenario.expectedSlot ||
    targetSurface.principalUserId !== scenario.principalUserId ||
    typeof targetSurface.sourceRoleUrl !== "string" ||
    !targetSurface.sourceRoleUrl.includes("/g/") ||
    !targetSurface.sourceRoleUrl.includes("private=notification-1") ||
    typeof targetSurface.visitedRolePath !== "string" ||
    !targetSurface.visitedRolePath.includes("/g/") ||
    !targetSurface.visitedRolePath.includes("private=notification-1") ||
    targetSurface.surfaceTestId !== "player-surface" ||
    targetSurface.checkpoint?.phaseId !== scenario.phaseId ||
    targetSurface.checkpoint.phaseState !== scenario.phaseState ||
    targetSurface.checkpoint.actorSlot !== scenario.expectedSlot ||
    targetSurface.checkpoint.actionState !== scenario.actionState ||
    targetSurface.checkpoint.receiptState !== "idle" ||
    !String(targetSurface.checkpoint.statusText ?? "")
      .toLowerCase()
      .includes(`player action unavailable: ${scenario.statusText}`) ||
    targetSurface.privateQueueBoundary?.status !==
      "principal-scoped-private-projections" ||
    targetSurface.privateQueueBoundary.count !== 1 ||
    !String(targetSurface.privateQueueBoundary.text ?? "").includes(
      "principal-scoped endpoints",
    ) ||
    targetSurface.privateNotice?.id !== "notification-1" ||
    targetSurface.privateNotice.kind !== "notification" ||
    !String(targetSurface.privateNotice.text ?? "").includes("player_killed") ||
    !String(targetSurface.privateNotice.text ?? "").includes(
      scenario.privateReceiptStatus,
    ) ||
    targetSurface.privateNotice.detailText !==
      `Phase ${scenario.privateReceiptPhaseId}` ||
    targetSurface.projectionCommandState?.actorSlot !== scenario.expectedSlot ||
    targetSurface.projectionCommandState?.actorAlive !== scenario.actorAlive ||
    targetSurface.projectionCommandState?.actorStatus !== scenario.actorStatus ||
    targetSurface.projectionCommandState?.phase?.phaseId !== scenario.phaseId ||
    targetSurface.projectionCommandState?.phase?.locked !== true ||
    targetSurface.projectionCommandState?.actions?.length !== 0 ||
    !String(targetSurface.projectionCommandState?.boundary ?? "").includes(
      scenario.boundaryText,
    ) ||
    targetSurface.projectionNotifications?.[0]?.effect !== "player_killed" ||
    targetSurface.projectionNotifications?.[0]?.status !==
      scenario.privateReceiptStatus ||
    targetSurface.resyncFromSeq !== scenario.resyncFromSeq ||
    targetSurface.resyncSnapshotCommandState?.actorSlot !== scenario.expectedSlot ||
    targetSurface.resyncSnapshotCommandState?.phase?.phaseId !==
      scenario.phaseId ||
    targetSurface.resyncSnapshotNotifications?.[0]?.status !==
      scenario.privateReceiptStatus ||
    targetSurface.coldLoadEndpoints?.notificationsEndpoint !==
      `/games/${expectedGame}/notifications?principal_user_id=${scenario.principalUserId}` ||
    targetSurface.coldLoadEndpoints?.commandStateEndpoint !==
      `/games/${expectedGame}/player-command-state?principal_user_id=${scenario.principalUserId}&slot_id=${scenario.expectedSlot}`
  ) {
    throw new Error(
      "core-loop admin proof missing night action resolution receipt surface",
    );
  }
}

function assertCoreLoopNormalNightActionResolutionPrivacySurface(normalSurface) {
  const expectedGame = gameFromRoleUrl(normalSurface?.sourceRoleUrl);
  const scenario = privateReceiptScenario("n02-normal-privacy");
  if (
    normalSurface?.status !== "passed" ||
    normalSurface.clickedThroughFromRoleUrl !== true ||
    normalSurface.releaseReady !== false ||
    normalSurface.productionReady !== false ||
    normalSurface.rawInviteTokensVisible !== false ||
    normalSurface.normalSlot !== scenario.expectedSlot ||
    normalSurface.principalUserId !== scenario.principalUserId ||
    normalSurface.targetReceiptVisible !== false ||
    typeof normalSurface.sourceRoleUrl !== "string" ||
    !normalSurface.sourceRoleUrl.includes("/g/") ||
    !normalSurface.sourceRoleUrl.includes("private=notification-1") ||
    typeof normalSurface.visitedRolePath !== "string" ||
    !normalSurface.visitedRolePath.includes("/g/") ||
    !normalSurface.visitedRolePath.includes("private=notification-1") ||
    normalSurface.surfaceTestId !== "player-surface" ||
    normalSurface.checkpoint?.phaseId !== scenario.phaseId ||
    normalSurface.checkpoint.phaseState !== scenario.phaseState ||
    normalSurface.checkpoint.actorSlot !== scenario.expectedSlot ||
    normalSurface.checkpoint.actionState !== scenario.actionState ||
    normalSurface.checkpoint.receiptState !== "idle" ||
    !String(normalSurface.checkpoint.statusText ?? "")
      .toLowerCase()
      .includes(`player action unavailable: ${scenario.statusText}`) ||
    normalSurface.privateQueueBoundary?.status !==
      "principal-scoped-private-projections" ||
    normalSurface.privateQueueBoundary.count !== 0 ||
    !String(normalSurface.privateQueueBoundary.text ?? "").includes(
      "principal-scoped endpoints",
    ) ||
    !String(normalSurface.privateEmptyText ?? "").includes(
      "No private results visible",
    ) ||
    normalSurface.projectionCommandState?.actorSlot !== scenario.expectedSlot ||
    normalSurface.projectionCommandState?.actorAlive !== scenario.actorAlive ||
    normalSurface.projectionCommandState?.actorStatus !== scenario.actorStatus ||
    normalSurface.projectionCommandState?.phase?.phaseId !== scenario.phaseId ||
    normalSurface.projectionCommandState?.phase?.locked !== true ||
    normalSurface.projectionCommandState?.actions?.length !== 0 ||
    !String(normalSurface.projectionCommandState?.boundary ?? "").includes(
      scenario.boundaryText,
    ) ||
    normalSurface.projectionNotifications?.length !== 0 ||
    normalSurface.resyncFromSeq !== scenario.resyncFromSeq ||
    normalSurface.resyncSnapshotCommandState?.actorSlot !==
      scenario.expectedSlot ||
    normalSurface.resyncSnapshotCommandState?.phase?.phaseId !==
      scenario.phaseId ||
    normalSurface.resyncSnapshotNotifications?.length !== 0 ||
    normalSurface.coldLoadEndpoints?.notificationsEndpoint !==
      `/games/${expectedGame}/notifications?principal_user_id=${scenario.principalUserId}` ||
    normalSurface.coldLoadEndpoints?.commandStateEndpoint !==
      `/games/${expectedGame}/player-command-state?principal_user_id=${scenario.principalUserId}&slot_id=${scenario.expectedSlot}`
  ) {
    throw new Error(
      "core-loop admin proof missing normal night action resolution privacy surface",
    );
  }
}

function assertCoreLoopHostPhaseTransitionSurface(hostPhaseTransitionSurface) {
  const expectedGame = gameFromRoleUrl(
    hostPhaseTransitionSurface?.sourceHostRoleUrl,
  );
  const resolveProof = hostPhaseTransitionSurface?.resolveProof;
  const advanceProof = hostPhaseTransitionSurface?.advanceProof;
  const staleHostAdvanceRecoveryProof =
    hostPhaseTransitionSurface?.staleHostAdvanceRecoveryProof;
  const playerObservationProof =
    hostPhaseTransitionSurface?.playerObservationProof;
  if (
    hostPhaseTransitionSurface?.status !== "passed" ||
    hostPhaseTransitionSurface.clickedThroughFromRoleUrl !== true ||
    hostPhaseTransitionSurface.releaseReady !== false ||
    hostPhaseTransitionSurface.productionReady !== false ||
    typeof hostPhaseTransitionSurface.sourceHostRoleUrl !== "string" ||
    !hostPhaseTransitionSurface.sourceHostRoleUrl.includes("/g/") ||
    !hostPhaseTransitionSurface.sourceHostRoleUrl.endsWith("/host") ||
    typeof hostPhaseTransitionSurface.sourcePlayerRoleUrl !== "string" ||
    !hostPhaseTransitionSurface.sourcePlayerRoleUrl.includes("/g/") ||
    typeof hostPhaseTransitionSurface.visitedHostRolePath !== "string" ||
    !hostPhaseTransitionSurface.visitedHostRolePath.endsWith("/host") ||
    hostPhaseTransitionSurface.surfaceTestId !== "host-console-surface" ||
    !String(hostPhaseTransitionSurface.transition ?? "").includes(
      "resolve_phase:ack:801",
    ) ||
    !String(hostPhaseTransitionSurface.transition ?? "").includes(
      "advance_phase:ack:802",
    ) ||
    !String(hostPhaseTransitionSurface.transition ?? "").includes("player:N02")
  ) {
    throw new Error("core-loop admin proof missing host phase transition surface");
  }
  assertCoreLoopHostPhaseTransitionActionProof({
    proof: resolveProof,
    expectedGame,
    actionId: "resolve_phase",
    commandKind: "ResolvePhase",
    streamSeq: 801,
    expectedPhaseId: "D02",
    expectedPhaseState: "locked",
    expectedDeadlineAffordance: "unlock_thread,advance_phase",
    expectedRefreshKeys: ["host", "votecount", "dayVoteOutcomes", "hostPrompts"],
  });
  assertCoreLoopHostPhaseTransitionActionProof({
    proof: advanceProof,
    expectedGame,
    actionId: "advance_phase",
    commandKind: "AdvancePhase",
    streamSeq: 802,
    expectedPhaseId: "N02",
    expectedPhaseState: "open",
    expectedDeadlineAffordance: "resolve_phase,lock_thread",
    expectedRefreshKeys: [],
  });
  assertCoreLoopHostStaleAdvanceAfterTransitionProof({
    staleProof: staleHostAdvanceRecoveryProof,
    expectedGame,
  });
  if (
    playerObservationProof?.status !== "passed" ||
    playerObservationProof.releaseReady !== false ||
    playerObservationProof.productionReady !== false ||
    playerObservationProof.sourceRoleUrl !==
      hostPhaseTransitionSurface.sourcePlayerRoleUrl ||
    !playerObservationProof.visitedRolePath?.includes("/g/") ||
    playerObservationProof.surfaceTestId !== "player-surface" ||
    playerObservationProof.resyncFromSeq !== 802 ||
    !playerObservationProof.resyncKeys?.includes("commandState") ||
    playerObservationProof.resyncSnapshotCommandState?.phase?.phaseId !== "N02" ||
    playerObservationProof.projectionCommandState?.phase?.phaseId !== "N02" ||
    !String(playerObservationProof.projectionCommandState?.boundary ?? "").includes(
      "AdvancePhase",
    ) ||
    playerObservationProof.checkpointPhaseId !== "N02" ||
    playerObservationProof.checkpointPhaseState !== "open" ||
    playerObservationProof.checkpointActionState !==
      "enabled:submit_action:factional_kill" ||
    playerObservationProof.checkpointTargetSlots !== "slot-3" ||
    playerObservationProof.checkpointReceiptState !== "reject:PhaseLocked"
  ) {
    throw new Error("core-loop admin proof missing player phase transition observation");
  }
  assertCoreLoopPlayerStaleVoteAfterTransitionProof({
    staleProof: playerObservationProof.staleVoteRecoveryProof,
    expectedGame,
  });
  assertCoreLoopPlayerStaleActionAfterTransitionProof({
    staleProof: playerObservationProof.staleActionRecoveryProof,
    expectedGame,
  });
}

function assertCoreLoopHostNightActionTransitionSurface(
  hostNightActionTransitionSurface,
) {
  const expectedGame = gameFromRoleUrl(
    hostNightActionTransitionSurface?.sourceHostRoleUrl,
  );
  const resolveProof = hostNightActionTransitionSurface?.resolveProof;
  const advanceProof = hostNightActionTransitionSurface?.advanceProof;
  const actionPlayerObservationProof =
    hostNightActionTransitionSurface?.actionPlayerObservationProof;
  const nightTargetObservationProof =
    hostNightActionTransitionSurface?.nightTargetObservationProof;
  const normalObservationProof =
    hostNightActionTransitionSurface?.normalObservationProof;
  if (
    hostNightActionTransitionSurface?.status !== "passed" ||
    hostNightActionTransitionSurface.clickedThroughFromRoleUrl !== true ||
    hostNightActionTransitionSurface.releaseReady !== false ||
    hostNightActionTransitionSurface.productionReady !== false ||
    typeof hostNightActionTransitionSurface.sourceHostRoleUrl !== "string" ||
    !hostNightActionTransitionSurface.sourceHostRoleUrl.includes("/g/") ||
    !hostNightActionTransitionSurface.sourceHostRoleUrl.endsWith("/host") ||
    typeof hostNightActionTransitionSurface.sourceActionPlayerRoleUrl !==
      "string" ||
    !hostNightActionTransitionSurface.sourceActionPlayerRoleUrl.includes("/g/") ||
    typeof hostNightActionTransitionSurface.sourceNightTargetRoleUrl !==
      "string" ||
    !hostNightActionTransitionSurface.sourceNightTargetRoleUrl.includes("/g/") ||
    typeof hostNightActionTransitionSurface.sourceNormalRoleUrl !== "string" ||
    !hostNightActionTransitionSurface.sourceNormalRoleUrl.includes("/g/") ||
    typeof hostNightActionTransitionSurface.visitedHostRolePath !== "string" ||
    !hostNightActionTransitionSurface.visitedHostRolePath.endsWith("/host") ||
    hostNightActionTransitionSurface.surfaceTestId !== "host-console-surface" ||
    !String(hostNightActionTransitionSurface.transition ?? "").includes(
      "resolve_phase:ack:905",
    ) ||
    !String(hostNightActionTransitionSurface.transition ?? "").includes(
      "advance_phase:ack:906",
    ) ||
    !String(hostNightActionTransitionSurface.transition ?? "").includes(
      "actionPlayer:D03",
    ) ||
    !String(hostNightActionTransitionSurface.transition ?? "").includes(
      "target:D03",
    ) ||
    !String(hostNightActionTransitionSurface.transition ?? "").includes(
      "normal:D03",
    )
  ) {
    throw new Error("core-loop admin proof missing host night action transition");
  }
  assertCoreLoopHostPhaseTransitionActionProof({
    proof: resolveProof,
    expectedGame,
    actionId: "resolve_phase",
    commandKind: "ResolvePhase",
    streamSeq: 905,
    expectedPhaseId: "N02",
    expectedPhaseState: "locked",
    expectedDeadlineAffordance: "unlock_thread,advance_phase",
    expectedRefreshKeys: ["host", "votecount", "dayVoteOutcomes", "hostPrompts"],
  });
  assertCoreLoopHostPhaseTransitionActionProof({
    proof: advanceProof,
    expectedGame,
    actionId: "advance_phase",
    commandKind: "AdvancePhase",
    streamSeq: 906,
    expectedPhaseId: "D03",
    expectedPhaseState: "open",
    expectedDeadlineAffordance: "resolve_phase,lock_thread",
    expectedRefreshKeys: [],
  });
  assertCoreLoopDayThreePlayerObservationProof({
    proof: actionPlayerObservationProof,
    sourceRoleUrl: hostNightActionTransitionSurface.sourceActionPlayerRoleUrl,
    expectedPrincipalUserId: "player_mira",
    expectedSlot: "slot-7",
    slotField: "actionPlayerSlot",
    expectedActorAlive: true,
    expectedActorStatus: "alive",
    expectedActionState: "disabled:no legal action available",
    expectedStatusText: "no legal action available",
    expectedPrivateCount: 0,
    expectedPrivateReceipt: false,
    expectedBoundaryText: "action player observed host AdvancePhase",
    expectedCommandStateEndpoint:
      `/games/${expectedGame}/player-command-state?principal_user_id=player_mira&slot_id=slot-7`,
    expectedNotificationsEndpoint:
      `/games/${expectedGame}/notifications?principal_user_id=player_mira`,
  });
  assertCoreLoopDayThreePlayerObservationProof({
    proof: nightTargetObservationProof,
    sourceRoleUrl: hostNightActionTransitionSurface.sourceNightTargetRoleUrl,
    expectedPrincipalUserId: "player-seed",
    expectedSlot: "slot-3",
    slotField: "targetSlot",
    expectedActorAlive: false,
    expectedActorStatus: "dead",
    expectedActionState: "disabled:actor is not alive",
    expectedStatusText: "actor is not alive",
    expectedPrivateCount: 1,
    expectedPrivateReceipt: true,
    expectedBoundaryText: "killed target stayed dead",
    expectedCommandStateEndpoint:
      `/games/${expectedGame}/player-command-state?principal_user_id=player-seed&slot_id=slot-3`,
    expectedNotificationsEndpoint:
      `/games/${expectedGame}/notifications?principal_user_id=player-seed`,
  });
  assertCoreLoopDayThreePlayerObservationProof({
    proof: normalObservationProof,
    sourceRoleUrl: hostNightActionTransitionSurface.sourceNormalRoleUrl,
    expectedPrincipalUserId: "player_rowan",
    expectedSlot: "slot-4",
    slotField: "normalSlot",
    expectedActorAlive: true,
    expectedActorStatus: "alive",
    expectedActionState: "disabled:no legal action available",
    expectedStatusText: "no legal action available",
    expectedPrivateCount: 0,
    expectedPrivateReceipt: false,
    expectedBoundaryText: "normal player observed open D03",
    expectedCommandStateEndpoint:
      `/games/${expectedGame}/player-command-state?principal_user_id=player_rowan&slot_id=slot-4`,
    expectedNotificationsEndpoint:
      `/games/${expectedGame}/notifications?principal_user_id=player_rowan`,
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
  const playerVoteProof = dayThreeVoteResolutionSurface?.playerVoteProof;
  const hostResolutionProof = dayThreeVoteResolutionSurface?.hostResolutionProof;
  if (
    dayThreeVoteResolutionSurface?.status !== "passed" ||
    dayThreeVoteResolutionSurface.clickedThroughFromRoleUrl !== true ||
    dayThreeVoteResolutionSurface.releaseReady !== false ||
    dayThreeVoteResolutionSurface.productionReady !== false ||
    typeof dayThreeVoteResolutionSurface.sourceActionPlayerRoleUrl !== "string" ||
    !dayThreeVoteResolutionSurface.sourceActionPlayerRoleUrl.includes("/g/") ||
    typeof dayThreeVoteResolutionSurface.sourceHostRoleUrl !== "string" ||
    !dayThreeVoteResolutionSurface.sourceHostRoleUrl.includes("/g/") ||
    !dayThreeVoteResolutionSurface.sourceHostRoleUrl.endsWith("/host") ||
    !String(dayThreeVoteResolutionSurface.transition ?? "").includes(
      "player:submit_vote:ack:907",
    ) ||
    !String(dayThreeVoteResolutionSurface.transition ?? "").includes(
      "host:resolve_phase:ack:908",
    )
  ) {
    throw new Error("core-loop admin proof missing Day 3 vote resolution");
  }
  assertCoreLoopDayThreePlayerVoteProof({
    proof: playerVoteProof,
    expectedGame,
    sourceRoleUrl: dayThreeVoteResolutionSurface.sourceActionPlayerRoleUrl,
  });
  assertCoreLoopDayThreeHostVoteResolutionProof({
    proof: hostResolutionProof,
    expectedGame,
    sourceRoleUrl: dayThreeVoteResolutionSurface.sourceHostRoleUrl,
  });
}

function assertCoreLoopDayThreePlayerVoteProof({
  proof,
  expectedGame,
  sourceRoleUrl,
}) {
  if (
    proof?.status !== "passed" ||
    proof.clickedThroughFromRoleUrl !== true ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.rawInviteTokensVisible !== false ||
    proof.targetOnlyReceiptVisible !== false ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    typeof proof.visitedRolePath !== "string" ||
    !proof.visitedRolePath.includes("/g/") ||
    proof.surfaceTestId !== "player-surface" ||
    proof.clickedAction !== "submit_vote" ||
    proof.commandKind !== "SubmitVote" ||
    proof.command?.game !== expectedGame ||
    proof.command.actor_slot !== "slot-7" ||
    proof.command.target?.Slot !== "slot-4" ||
    proof.commandStatus?.state !== "ack" ||
    !proof.commandStatus?.message?.includes("Ack: stream seqs 907") ||
    proof.bridgePlan?.role !== "player" ||
    proof.bridgePlan.commandKind !== "SubmitVote" ||
    proof.bridgePlan.commandEndpoint !== "/commands" ||
    proof.bridgePlan.finalState !== "ack" ||
    !sameStringArray(proof.bridgePlan.projectionRefreshKeys, [
      "votecount",
      "commandState",
    ]) ||
    proof.receipts?.at?.(-1)?.state !== "ack" ||
    proof.projectionCommandState?.actorSlot !== "slot-7" ||
    proof.projectionCommandState?.phase?.phaseId !== "D03" ||
    proof.projectionCommandState?.phase?.locked !== false ||
    proof.projectionCommandState?.currentVote?.slotId !== "slot-4" ||
    !String(proof.projectionCommandState?.boundary ?? "").includes(
      "Day 3 vote ACK",
    ) ||
    proof.projectionVotecount?.[0]?.target !== "slot-4 / Rowan" ||
    proof.projectionVotecount?.[0]?.count !== 2 ||
    proof.projectionVotecount?.[0]?.needed !== 2 ||
    proof.projectionDayVoteOutcomes?.[0]?.phaseId !== "D02" ||
    proof.setupResyncFromSeq !== 906 ||
    proof.setupSnapshotCommandState?.phase?.phaseId !== "D03" ||
    proof.currentVote?.hasVote !== "true" ||
    !String(proof.currentVote?.text ?? "").includes("Slot 4") ||
    proof.receiptCount !== 1 ||
    !String(proof.receiptStatusText ?? "")
      .toLowerCase()
      .includes("ack: stream seqs 907") ||
    proof.receiptRefreshKeys !== "votecount,commandState"
  ) {
    throw new Error("core-loop admin proof missing Day 3 player vote ACK");
  }
}

function assertCoreLoopDayThreeHostVoteResolutionProof({
  proof,
  expectedGame,
  sourceRoleUrl,
}) {
  if (
    proof?.status !== "passed" ||
    proof.clickedThroughFromRoleUrl !== true ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.rawInviteTokensVisible !== false ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    typeof proof.visitedRolePath !== "string" ||
    !proof.visitedRolePath.endsWith("/host") ||
    proof.surfaceTestId !== "host-console-surface" ||
    proof.hostVotecountProjection?.[0]?.target !== "slot-4 / Rowan" ||
    proof.hostVotecountProjection?.[0]?.count !== 2 ||
    proof.hostVotecountProjection?.[0]?.needed !== 2 ||
    proof.hostDayVoteOutcomesProjection?.[1]?.phaseId !== "D03" ||
    proof.hostDayVoteOutcomesProjection?.[1]?.status !== "Lynch" ||
    proof.hostDayVoteOutcomesProjection?.[1]?.winnerSlot !== "slot-4"
  ) {
    throw new Error("core-loop admin proof missing Day 3 host vote resolution");
  }
  assertCoreLoopHostPhaseTransitionActionProof({
    proof: proof.resolveProof,
    expectedGame,
    actionId: "resolve_phase",
    commandKind: "ResolvePhase",
    streamSeq: 908,
    expectedPhaseId: "D03",
    expectedPhaseState: "locked",
    expectedDeadlineAffordance: "unlock_thread,advance_phase",
    expectedRefreshKeys: ["host", "votecount", "dayVoteOutcomes", "hostPrompts"],
  });
  if (
    proof.resolveProof?.votecountProjection?.[0]?.target !== "slot-4 / Rowan" ||
    proof.resolveProof?.dayVoteOutcomesProjection?.[1]?.phaseId !== "D03"
  ) {
    throw new Error("core-loop admin proof missing Day 3 host resolve projections");
  }
}

function assertCoreLoopPostDayThreeResolutionSurface(postDayThreeResolutionSurface) {
  const expectedGame = gameFromRoleUrl(
    postDayThreeResolutionSurface?.sourceHostRoleUrl,
  );
  if (
    postDayThreeResolutionSurface?.status !== "passed" ||
    postDayThreeResolutionSurface.clickedThroughFromRoleUrl !== true ||
    postDayThreeResolutionSurface.releaseReady !== false ||
    postDayThreeResolutionSurface.productionReady !== false ||
    typeof postDayThreeResolutionSurface.sourceHostRoleUrl !== "string" ||
    !postDayThreeResolutionSurface.sourceHostRoleUrl.endsWith("/host") ||
    typeof postDayThreeResolutionSurface.sourceActionPlayerRoleUrl !== "string" ||
    !postDayThreeResolutionSurface.sourceActionPlayerRoleUrl.includes("/g/") ||
    typeof postDayThreeResolutionSurface.sourceTargetRoleUrl !== "string" ||
    !postDayThreeResolutionSurface.sourceTargetRoleUrl.includes("/g/") ||
    !String(postDayThreeResolutionSurface.transition ?? "").includes(
      "target:D03:day_vote",
    ) ||
    !String(postDayThreeResolutionSurface.transition ?? "").includes(
      "host:advance_phase:ack:909",
    ) ||
    !String(postDayThreeResolutionSurface.transition ?? "").includes(
      "actionPlayer:N03",
    )
  ) {
    throw new Error("core-loop admin proof missing post-Day 3 resolution");
  }
  const targetReceiptScenario = privateReceiptScenario("d03-target-receipt");
  const actionPlayerPrivacyScenario = privateReceiptScenario(
    "d03-action-player-privacy",
  );
  assertCoreLoopPostDayThreePlayerSurfaceProof({
    proof: postDayThreeResolutionSurface.targetReceiptProof,
    ...privateReceiptAssertionArgs({
      scenario: targetReceiptScenario,
      expectedGame,
      sourceRoleUrl: postDayThreeResolutionSurface.sourceTargetRoleUrl,
    }),
  });
  assertCoreLoopPostDayThreePlayerSurfaceProof({
    proof: postDayThreeResolutionSurface.actionPlayerPrivacyProof,
    ...privateReceiptAssertionArgs({
      scenario: actionPlayerPrivacyScenario,
      expectedGame,
      sourceRoleUrl: postDayThreeResolutionSurface.sourceActionPlayerRoleUrl,
    }),
  });
  assertCoreLoopPostDayThreeHostAdvanceProof({
    proof: postDayThreeResolutionSurface.hostAdvanceProof,
    expectedGame,
    sourceRoleUrl: postDayThreeResolutionSurface.sourceHostRoleUrl,
  });
  assertCoreLoopPostDayThreePlayerSurfaceProof({
    proof: postDayThreeResolutionSurface.actionPlayerNightThreeProof,
    sourceRoleUrl: postDayThreeResolutionSurface.sourceActionPlayerRoleUrl,
    expectedSlot: "slot-7",
    slotField: "actionPlayerSlot",
    expectedPrincipalUserId: "player_mira",
    expectedPhaseId: "N03",
    expectedPhaseState: "open",
    expectedActorAlive: true,
    expectedActorStatus: "alive",
    expectedActionState: "disabled:no legal action available",
    expectedStatusText: "no legal action available",
    expectedPrivateCount: 0,
    expectedPrivateReceipt: false,
    expectedBoundaryText: "observed host AdvancePhase",
    expectedResyncFromSeq: 909,
    expectedCommandStateEndpoint:
      `/games/${expectedGame}/player-command-state?principal_user_id=player_mira&slot_id=slot-7`,
    expectedNotificationsEndpoint:
      `/games/${expectedGame}/notifications?principal_user_id=player_mira`,
  });
}

function assertCoreLoopNightThreeEmptyResolutionSurface(
  nightThreeEmptyResolutionSurface,
) {
  const expectedGame = gameFromRoleUrl(
    nightThreeEmptyResolutionSurface?.sourceHostRoleUrl,
  );
  if (
    nightThreeEmptyResolutionSurface?.status !== "passed" ||
    nightThreeEmptyResolutionSurface.clickedThroughFromRoleUrl !== true ||
    nightThreeEmptyResolutionSurface.releaseReady !== false ||
    nightThreeEmptyResolutionSurface.productionReady !== false ||
    typeof nightThreeEmptyResolutionSurface.sourceHostRoleUrl !== "string" ||
    !nightThreeEmptyResolutionSurface.sourceHostRoleUrl.endsWith("/host") ||
    typeof nightThreeEmptyResolutionSurface.sourceActionPlayerRoleUrl !==
      "string" ||
    !nightThreeEmptyResolutionSurface.sourceActionPlayerRoleUrl.includes("/g/") ||
    !String(nightThreeEmptyResolutionSurface.transition ?? "").includes(
      "actionPlayer:N03:no_action",
    ) ||
    !String(nightThreeEmptyResolutionSurface.transition ?? "").includes(
      "resolve_phase:ack:910",
    ) ||
    !String(nightThreeEmptyResolutionSurface.transition ?? "").includes(
      "advance_phase:ack:911",
    ) ||
    !String(nightThreeEmptyResolutionSurface.transition ?? "").includes(
      "actionPlayer:D04:no_lynch_vote",
    )
  ) {
    throw new Error("core-loop admin proof missing empty Night 3 resolution");
  }
  assertCoreLoopPostDayThreePlayerSurfaceProof({
    proof: nightThreeEmptyResolutionSurface.actionPlayerNoActionProof,
    sourceRoleUrl: nightThreeEmptyResolutionSurface.sourceActionPlayerRoleUrl,
    expectedSlot: "slot-7",
    slotField: "actionPlayerSlot",
    expectedPrincipalUserId: "player_mira",
    expectedPhaseId: "N03",
    expectedPhaseState: "open",
    expectedActorAlive: true,
    expectedActorStatus: "alive",
    expectedActionState: "disabled:no legal action available",
    expectedStatusText: "no legal action available",
    expectedPrivateCount: 0,
    expectedPrivateReceipt: false,
    expectedBoundaryText: "opened N03 with no legal night action",
    expectedResyncFromSeq: 909,
    expectedCommandStateEndpoint:
      `/games/${expectedGame}/player-command-state?principal_user_id=player_mira&slot_id=slot-7`,
    expectedNotificationsEndpoint:
      `/games/${expectedGame}/notifications?principal_user_id=player_mira`,
  });
  assertCoreLoopNightThreeEmptyHostTransitionProof({
    proof: nightThreeEmptyResolutionSurface.hostTransitionProof,
    expectedGame,
    sourceRoleUrl: nightThreeEmptyResolutionSurface.sourceHostRoleUrl,
  });
  assertCoreLoopPostDayThreePlayerSurfaceProof({
    proof: nightThreeEmptyResolutionSurface.actionPlayerDayFourProof,
    sourceRoleUrl: nightThreeEmptyResolutionSurface.sourceActionPlayerRoleUrl,
    expectedSlot: "slot-7",
    slotField: "actionPlayerSlot",
    expectedPrincipalUserId: "player_mira",
    expectedPhaseId: "D04",
    expectedPhaseState: "open",
    expectedActorAlive: true,
    expectedActorStatus: "alive",
    expectedActionState: "disabled:no legal action available",
    expectedStatusText: "no legal action available",
    expectedPrivateCount: 0,
    expectedPrivateReceipt: false,
    expectedBoundaryText: "open D04 no-lynch voting",
    expectedResyncFromSeq: 911,
    expectedCommandStateEndpoint:
      `/games/${expectedGame}/player-command-state?principal_user_id=player_mira&slot_id=slot-7`,
    expectedNotificationsEndpoint:
      `/games/${expectedGame}/notifications?principal_user_id=player_mira`,
    expectedVoteButtonCount: 1,
    expectedVoteTargetCount: 1,
  });
}

function assertCoreLoopDayFourSurvivorRoleSurface(dayFourSurvivorRoleSurface) {
  const expectedGame = gameFromRoleUrl(dayFourSurvivorRoleSurface?.sourceRoleUrl);
  if (
    dayFourSurvivorRoleSurface?.status !== "passed" ||
    dayFourSurvivorRoleSurface.clickedThroughFromRoleUrl !== true ||
    dayFourSurvivorRoleSurface.releaseReady !== false ||
    dayFourSurvivorRoleSurface.productionReady !== false ||
    typeof dayFourSurvivorRoleSurface.sourceRoleUrl !== "string" ||
    !dayFourSurvivorRoleSurface.sourceRoleUrl.includes("/g/")
  ) {
    throw new Error("core-loop admin proof missing Day 4 survivor role surface");
  }
  assertCoreLoopPostDayThreePlayerSurfaceProof({
    proof: dayFourSurvivorRoleSurface.survivorProof,
    sourceRoleUrl: dayFourSurvivorRoleSurface.sourceRoleUrl,
    expectedSlot: "slot-5",
    slotField: "survivorSlot",
    expectedPrincipalUserId: "player_sage",
    expectedPhaseId: "D04",
    expectedPhaseState: "open",
    expectedActorAlive: true,
    expectedActorStatus: "alive",
    expectedActionState: "disabled:no legal action available",
    expectedStatusText: "no legal action available",
    expectedPrivateCount: 0,
    expectedPrivateReceipt: false,
    expectedBoundaryText: "survivor role opened D04",
    expectedResyncFromSeq: 911,
    expectedCommandStateEndpoint:
      `/games/${expectedGame}/player-command-state?principal_user_id=player_sage&slot_id=slot-5`,
    expectedNotificationsEndpoint:
      `/games/${expectedGame}/notifications?principal_user_id=player_sage`,
    expectedVoteButtonCount: 2,
    expectedVoteTargetCount: 2,
  });
}

function assertCoreLoopNightFourActionSubmissionSurface(
  nightFourActionSubmissionSurface,
) {
  const expectedGame = gameFromRoleUrl(
    nightFourActionSubmissionSurface?.sourceHostRoleUrl,
  );
  if (
    nightFourActionSubmissionSurface?.status !== "passed" ||
    nightFourActionSubmissionSurface.clickedThroughFromRoleUrl !== true ||
    nightFourActionSubmissionSurface.releaseReady !== false ||
    nightFourActionSubmissionSurface.productionReady !== false ||
    typeof nightFourActionSubmissionSurface.sourceHostRoleUrl !== "string" ||
    !nightFourActionSubmissionSurface.sourceHostRoleUrl.endsWith("/host") ||
    typeof nightFourActionSubmissionSurface.sourceActionPlayerRoleUrl !==
      "string" ||
    !nightFourActionSubmissionSurface.sourceActionPlayerRoleUrl.includes("/g/") ||
    !String(nightFourActionSubmissionSurface.transition ?? "").includes(
      "player:D04:no_lynch:ack:912",
    ) ||
    !String(nightFourActionSubmissionSurface.transition ?? "").includes(
      "host:D04:resolve_phase:ack:913",
    ) ||
    !String(nightFourActionSubmissionSurface.transition ?? "").includes(
      "host:advance_phase:ack:914",
    ) ||
    !String(nightFourActionSubmissionSurface.transition ?? "").includes(
      "player:N04:submit_action:slot-5:ack:915",
    )
  ) {
    throw new Error("core-loop admin proof missing Night 4 action submission");
  }
  assertCoreLoopDayFourNoLynchVoteProof({
    proof: nightFourActionSubmissionSurface.dayFourVoteProof,
    expectedGame,
    sourceRoleUrl: nightFourActionSubmissionSurface.sourceActionPlayerRoleUrl,
  });
  assertCoreLoopDayFourNoLynchHostTransitionProof({
    proof: nightFourActionSubmissionSurface.hostTransitionProof,
    expectedGame,
    sourceRoleUrl: nightFourActionSubmissionSurface.sourceHostRoleUrl,
  });
  assertCoreLoopNightFourPlayerActionSubmissionProof({
    proof: nightFourActionSubmissionSurface.nightFourActionProof,
    expectedGame,
    sourceRoleUrl: nightFourActionSubmissionSurface.sourceActionPlayerRoleUrl,
  });
}

function assertCoreLoopNightFourResolutionReceiptSurface(
  nightFourResolutionReceiptSurface,
) {
  const expectedGame = gameFromRoleUrl(
    nightFourResolutionReceiptSurface?.sourceHostRoleUrl,
  );
  if (
    nightFourResolutionReceiptSurface?.status !== "passed" ||
    nightFourResolutionReceiptSurface.clickedThroughFromRoleUrl !== true ||
    nightFourResolutionReceiptSurface.releaseReady !== false ||
    nightFourResolutionReceiptSurface.productionReady !== false ||
    typeof nightFourResolutionReceiptSurface.sourceHostRoleUrl !== "string" ||
    !nightFourResolutionReceiptSurface.sourceHostRoleUrl.endsWith("/host") ||
    typeof nightFourResolutionReceiptSurface.sourceActionPlayerRoleUrl !==
      "string" ||
    !nightFourResolutionReceiptSurface.sourceActionPlayerRoleUrl.includes("/g/") ||
    typeof nightFourResolutionReceiptSurface.sourceSurvivorRoleUrl !== "string" ||
    !nightFourResolutionReceiptSurface.sourceSurvivorRoleUrl.includes("/g/") ||
    !String(nightFourResolutionReceiptSurface.transition ?? "").includes(
      "host:N04:resolve_phase:ack:916",
    ) ||
    !String(nightFourResolutionReceiptSurface.transition ?? "").includes(
      "survivor:N04:factional_kill_receipt",
    ) ||
    !String(nightFourResolutionReceiptSurface.transition ?? "").includes(
      "actionPlayer:N04:privacy",
    )
  ) {
    throw new Error("core-loop admin proof missing Night 4 resolution receipt");
  }
  const survivorReceiptScenario = privateReceiptScenario("n04-survivor-receipt");
  const nightFourActionPlayerPrivacyScenario = privateReceiptScenario(
    "n04-action-player-privacy",
  );
  assertCoreLoopNightFourHostResolutionProof({
    proof: nightFourResolutionReceiptSurface.hostResolutionProof,
    expectedGame,
    sourceRoleUrl: nightFourResolutionReceiptSurface.sourceHostRoleUrl,
  });
  assertCoreLoopNightFourResolutionPlayerSurfaceProof({
    proof: nightFourResolutionReceiptSurface.survivorReceiptProof,
    ...privateReceiptAssertionArgs({
      scenario: survivorReceiptScenario,
      expectedGame,
      sourceRoleUrl: nightFourResolutionReceiptSurface.sourceSurvivorRoleUrl,
    }),
  });
  assertCoreLoopNightFourResolutionPlayerSurfaceProof({
    proof: nightFourResolutionReceiptSurface.actionPlayerPrivacyProof,
    ...privateReceiptAssertionArgs({
      scenario: nightFourActionPlayerPrivacyScenario,
      expectedGame,
      sourceRoleUrl: nightFourResolutionReceiptSurface.sourceActionPlayerRoleUrl,
    }),
  });
}

function assertCoreLoopNightFourHostResolutionProof({
  proof,
  expectedGame,
  sourceRoleUrl,
}) {
  if (
    proof?.status !== "passed" ||
    proof.clickedThroughFromRoleUrl !== true ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.rawInviteTokensVisible !== false ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    typeof proof.visitedRolePath !== "string" ||
    !proof.visitedRolePath.endsWith("/host") ||
    proof.surfaceTestId !== "host-console-surface" ||
    proof.setupResyncFromSeq !== 915 ||
    proof.setupSnapshotHost?.phase?.id !== "N04" ||
    proof.setupSnapshotHost?.phase?.state !== "open"
  ) {
    throw new Error("core-loop admin proof missing Night 4 host resolution");
  }
  assertCoreLoopHostPhaseTransitionActionProof({
    proof: proof.resolveProof,
    expectedGame,
    actionId: "resolve_phase",
    commandKind: "ResolvePhase",
    streamSeq: 916,
    expectedPhaseId: "N04",
    expectedPhaseState: "locked",
    expectedDeadlineAffordance: "unlock_thread,advance_phase",
    expectedRefreshKeys: ["host", "votecount", "dayVoteOutcomes", "hostPrompts"],
  });
}

function assertCoreLoopNightFourResolutionPlayerSurfaceProof({
  proof,
  sourceRoleUrl,
  expectedSlot,
  slotField,
  expectedPrincipalUserId,
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
  if (
    proof?.status !== "passed" ||
    proof.clickedThroughFromRoleUrl !== true ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.rawInviteTokensVisible !== false ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    typeof proof.visitedRolePath !== "string" ||
    !proof.visitedRolePath.includes("/g/") ||
    proof.surfaceTestId !== "player-surface" ||
    proof[slotField] !== expectedSlot ||
    proof.principalUserId !== expectedPrincipalUserId ||
    proof.checkpoint?.phaseId !== expectedPhaseId ||
    proof.checkpoint.phaseState !== expectedPhaseState ||
    proof.checkpoint.actorSlot !== expectedSlot ||
    proof.checkpoint.actionState !== expectedActionState ||
    proof.checkpoint.receiptState !== "idle" ||
    !String(proof.checkpoint.statusText ?? "")
      .toLowerCase()
      .includes(expectedStatusText) ||
    proof.privateQueueBoundary?.status !== expectedPrivateQueueBoundaryStatus ||
    proof.privateQueueBoundary.count !== expectedPrivateCount ||
    !String(proof.privateQueueBoundary.text ?? "").includes(
      "principal-scoped endpoints",
    ) ||
    proof.voteButtonCount !== 0 ||
    proof.projectionCommandState?.actorSlot !== expectedSlot ||
    proof.projectionCommandState?.actorAlive !== expectedActorAlive ||
    proof.projectionCommandState?.actorStatus !== expectedActorStatus ||
    proof.projectionCommandState?.phase?.phaseId !== expectedPhaseId ||
    proof.projectionCommandState?.phase?.locked !==
      (expectedPhaseState === "locked") ||
    proof.projectionCommandState?.actions?.length !== 0 ||
    proof.projectionCommandState?.voteTargets?.length !== 0 ||
    !String(proof.projectionCommandState?.boundary ?? "").includes(
      expectedBoundaryText,
    ) ||
    proof.projectionDayVoteOutcomes?.at?.(-1)?.phaseId !== "D04" ||
    proof.resyncFromSeq !== expectedResyncFromSeq ||
    proof.resyncSnapshotCommandState?.actorSlot !== expectedSlot ||
    proof.resyncSnapshotCommandState?.phase?.phaseId !== expectedPhaseId ||
    proof.coldLoadEndpoints?.notificationsEndpoint !==
      expectedNotificationsEndpoint ||
    proof.coldLoadEndpoints?.commandStateEndpoint !== expectedCommandStateEndpoint
  ) {
    throw new Error("core-loop admin proof missing Night 4 player surface");
  }
  if (
    expectedPrivateReceipt &&
    (proof.privateNotice?.id !== "notification-1" ||
      proof.privateNotice.kind !== "notification" ||
      !String(proof.privateNotice.text ?? "").includes("player_killed") ||
      !String(proof.privateNotice.text ?? "").includes(
        expectedPrivateReceiptStatus,
      ) ||
      proof.privateNotice.detailText !==
        `Phase ${expectedPrivateReceiptPhaseId}` ||
      proof.projectionNotifications?.[0]?.effect !== "player_killed" ||
      proof.projectionNotifications?.[0]?.status !==
        expectedPrivateReceiptStatus ||
      proof.resyncSnapshotNotifications?.[0]?.status !==
        expectedPrivateReceiptStatus)
  ) {
    throw new Error("core-loop admin proof missing Night 4 survivor receipt");
  }
  if (
    !expectedPrivateReceipt &&
    (!String(proof.privateEmptyText ?? "").includes("No private results visible") ||
      proof.projectionNotifications?.length !== 0 ||
      proof.resyncSnapshotNotifications?.length !== 0 ||
      proof.privateNotice !== undefined)
  ) {
    throw new Error("core-loop admin proof leaked Night 4 target receipt");
  }
}

function assertCoreLoopPostNightFourTransitionSurface(
  postNightFourTransitionSurface,
) {
  const expectedGame = gameFromRoleUrl(
    postNightFourTransitionSurface?.sourceHostRoleUrl,
  );
  if (
    postNightFourTransitionSurface?.status !== "passed" ||
    postNightFourTransitionSurface.clickedThroughFromRoleUrl !== true ||
    postNightFourTransitionSurface.releaseReady !== false ||
    postNightFourTransitionSurface.productionReady !== false ||
    typeof postNightFourTransitionSurface.sourceHostRoleUrl !== "string" ||
    !postNightFourTransitionSurface.sourceHostRoleUrl.endsWith("/host") ||
    typeof postNightFourTransitionSurface.sourceActionPlayerRoleUrl !==
      "string" ||
    !postNightFourTransitionSurface.sourceActionPlayerRoleUrl.includes("/g/") ||
    typeof postNightFourTransitionSurface.sourceSurvivorRoleUrl !== "string" ||
    !postNightFourTransitionSurface.sourceSurvivorRoleUrl.includes("/g/") ||
    !String(postNightFourTransitionSurface.transition ?? "").includes(
      "host:N04:advance_phase:ack:917",
    ) ||
    !String(postNightFourTransitionSurface.transition ?? "").includes(
      "survivor:D05:dead_no_controls",
    ) ||
    !String(postNightFourTransitionSurface.transition ?? "").includes(
      "actionPlayer:D05:no_lynch_controls",
    ) ||
    !String(postNightFourTransitionSurface.transition ?? "").includes(
      "stale:N04:submit_action:reject:PhaseLocked",
    )
  ) {
    throw new Error("core-loop admin proof missing post-Night 4 transition");
  }
  assertCoreLoopPostNightFourHostAdvanceProof({
    proof: postNightFourTransitionSurface.hostAdvanceProof,
    expectedGame,
    sourceRoleUrl: postNightFourTransitionSurface.sourceHostRoleUrl,
  });
  assertCoreLoopPostDayThreePlayerSurfaceProof({
    proof: postNightFourTransitionSurface.survivorDayFiveProof,
    sourceRoleUrl: postNightFourTransitionSurface.sourceSurvivorRoleUrl,
    expectedSlot: "slot-5",
    slotField: "survivorSlot",
    expectedPrincipalUserId: "player_sage",
    expectedPhaseId: "D05",
    expectedPhaseState: "open",
    expectedActorAlive: false,
    expectedActorStatus: "dead",
    expectedActionState: "disabled:actor is not alive",
    expectedStatusText: "actor is not alive",
    expectedPrivateCount: 1,
    expectedPrivateReceipt: true,
    expectedBoundaryText: "survivor stayed dead with no controls",
    expectedResyncFromSeq: 917,
    expectedCommandStateEndpoint:
      `/games/${expectedGame}/player-command-state?principal_user_id=player_sage&slot_id=slot-5`,
    expectedNotificationsEndpoint:
      `/games/${expectedGame}/notifications?principal_user_id=player_sage`,
    expectedLastVoteOutcomePhaseId: "D04",
    expectedPrivateReceiptStatus: "factional_kill",
    expectedPrivateReceiptPhaseId: "N04",
  });
  assertCoreLoopPostDayThreePlayerSurfaceProof({
    proof: postNightFourTransitionSurface.actionPlayerDayFiveProof,
    sourceRoleUrl: postNightFourTransitionSurface.sourceActionPlayerRoleUrl,
    expectedSlot: "slot-7",
    slotField: "actionPlayerSlot",
    expectedPrincipalUserId: "player_mira",
    expectedPhaseId: "D05",
    expectedPhaseState: "open",
    expectedActorAlive: true,
    expectedActorStatus: "alive",
    expectedActionState: "disabled:no legal action available",
    expectedStatusText: "no legal action available",
    expectedPrivateCount: 0,
    expectedPrivateReceipt: false,
    expectedBoundaryText: "open Day 5 no-lynch controls",
    expectedResyncFromSeq: 917,
    expectedCommandStateEndpoint:
      `/games/${expectedGame}/player-command-state?principal_user_id=player_mira&slot_id=slot-7`,
    expectedNotificationsEndpoint:
      `/games/${expectedGame}/notifications?principal_user_id=player_mira`,
    expectedVoteButtonCount: 1,
    expectedVoteTargetCount: 1,
    expectedLastVoteOutcomePhaseId: "D04",
  });
  assertCoreLoopStaleNightFourActionRecoveryProof({
    proof: postNightFourTransitionSurface.staleNightFourActionRecoveryProof,
    expectedGame,
    sourceRoleUrl: postNightFourTransitionSurface.sourceActionPlayerRoleUrl,
  });
}

function assertCoreLoopPostNightFourHostAdvanceProof({
  proof,
  expectedGame,
  sourceRoleUrl,
}) {
  if (
    proof?.status !== "passed" ||
    proof.clickedThroughFromRoleUrl !== true ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.rawInviteTokensVisible !== false ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    typeof proof.visitedRolePath !== "string" ||
    !proof.visitedRolePath.endsWith("/host") ||
    proof.surfaceTestId !== "host-console-surface" ||
    proof.setupResyncFromSeq !== 916 ||
    proof.setupSnapshotHost?.phase?.id !== "N04" ||
    proof.setupSnapshotHost?.phase?.state !== "locked"
  ) {
    throw new Error("core-loop admin proof missing post-Night 4 host advance");
  }
  assertCoreLoopHostPhaseTransitionActionProof({
    proof: proof.advanceProof,
    expectedGame,
    actionId: "advance_phase",
    commandKind: "AdvancePhase",
    streamSeq: 917,
    expectedPhaseId: "D05",
    expectedPhaseState: "open",
    expectedDeadlineAffordance: "resolve_phase,lock_thread",
    expectedRefreshKeys: [],
  });
  if (proof.advanceProof?.dayVoteOutcomesProjection?.at?.(-1)?.phaseId !== "D04") {
    throw new Error("core-loop admin proof missing post-Night 4 host outcomes");
  }
}

function assertCoreLoopStaleNightFourActionRecoveryProof({
  proof,
  expectedGame,
  sourceRoleUrl,
}) {
  const scenario = staleNightFourActionRecoveryScenario();
  if (
    proof?.status !== "passed" ||
    proof.clickedThroughFromRoleUrl !== true ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.rawInviteTokensVisible !== false ||
    proof.targetOnlyReceiptVisible !== false ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    typeof proof.visitedRolePath !== "string" ||
    !proof.visitedRolePath.includes("/g/") ||
    proof.surfaceTestId !== "player-surface" ||
    proof.clickedAction !== scenario.clickedAction ||
    proof.commandKind !== scenario.commandKind ||
    proof.setupResyncFromSeq !== scenario.setupResyncFromSeq ||
    proof.setupSnapshotCommandState?.phase?.phaseId !== scenario.setupPhaseId ||
    proof.setupSnapshotCommandState?.actions?.[0]?.targets?.[0] !==
      scenario.targetSlot ||
    proof.command?.game !== expectedGame ||
    proof.command.actor_slot !== scenario.actorSlot ||
    proof.command.action_id !== scenario.actionId ||
    proof.command.template_id !== scenario.templateId ||
    proof.command.targets?.[0] !== scenario.targetSlot ||
    proof.command.grant_id !== scenario.grantId ||
    proof.commandStatus?.state !== scenario.finalState ||
    proof.commandStatus.error !== scenario.error ||
    !String(proof.commandStatus.message ?? "").includes(
      scenario.messageIncludes,
    ) ||
    proof.bridgePlan?.role !== "player" ||
    proof.bridgePlan.commandKind !== scenario.commandKind ||
    proof.bridgePlan.commandEndpoint !== "/commands" ||
    proof.bridgePlan.finalState !== scenario.finalState ||
    !sameStringArray(
      proof.bridgePlan.projectionRefreshKeys,
      scenario.expectedRefreshKeys,
    ) ||
    proof.receipts?.at?.(-1)?.state !== scenario.finalState ||
    proof.projectionCommandState?.actorSlot !== scenario.actorSlot ||
    proof.projectionCommandState?.phase?.phaseId !== scenario.refreshedPhaseId ||
    proof.projectionCommandState?.phase?.locked !== false ||
    proof.projectionCommandState?.actions?.length !== 0 ||
    proof.projectionCommandState?.voteTargets?.[0]?.kind !== "no_lynch" ||
    !String(proof.projectionCommandState?.boundary ?? "").includes(
      scenario.refreshedBoundary,
    ) ||
    proof.checkpointReceiptState !== scenario.checkpointReceiptState ||
    proof.checkpointPhaseIdAfterReject !== scenario.refreshedPhaseId ||
    proof.checkpointActionStateAfterReject !==
      scenario.checkpointActionState ||
    proof.checkpointTargetSlotsAfterReject !== scenario.checkpointTargetSlots ||
    !String(proof.recoveryText ?? "").includes(`Reject ${scenario.error}`) ||
    !String(proof.recoveryText ?? "").includes("refresh") ||
    proof.receiptCount !== 1 ||
    !String(proof.receiptStatusText ?? "")
      .toLowerCase()
      .includes(`reject ${scenario.error.toLowerCase()}`)
  ) {
    throw new Error("core-loop admin proof missing stale Night 4 action recovery");
  }
}

function assertCoreLoopDayFiveNoLynchResolutionSurface(
  dayFiveNoLynchResolutionSurface,
) {
  const expectedGame = gameFromRoleUrl(
    dayFiveNoLynchResolutionSurface?.sourceHostRoleUrl,
  );
  if (
    dayFiveNoLynchResolutionSurface?.status !== "passed" ||
    dayFiveNoLynchResolutionSurface.clickedThroughFromRoleUrl !== true ||
    dayFiveNoLynchResolutionSurface.releaseReady !== false ||
    dayFiveNoLynchResolutionSurface.productionReady !== false ||
    typeof dayFiveNoLynchResolutionSurface.sourceHostRoleUrl !== "string" ||
    !dayFiveNoLynchResolutionSurface.sourceHostRoleUrl.endsWith("/host") ||
    typeof dayFiveNoLynchResolutionSurface.sourceActionPlayerRoleUrl !==
      "string" ||
    !dayFiveNoLynchResolutionSurface.sourceActionPlayerRoleUrl.includes("/g/") ||
    !String(dayFiveNoLynchResolutionSurface.transition ?? "").includes(
      "player:D05:no_lynch:ack:918",
    ) ||
    !String(dayFiveNoLynchResolutionSurface.transition ?? "").includes(
      "host:D05:resolve_phase:ack:919",
    ) ||
    !String(dayFiveNoLynchResolutionSurface.transition ?? "").includes(
      "host:advance_phase:ack:920",
    ) ||
    !String(dayFiveNoLynchResolutionSurface.transition ?? "").includes(
      "actionPlayer:N05:no_action",
    ) ||
    !String(dayFiveNoLynchResolutionSurface.transition ?? "").includes(
      "stale:D05:submit_vote:reject:PhaseLocked",
    )
  ) {
    throw new Error("core-loop admin proof missing Day 5 no-lynch resolution");
  }
  assertCoreLoopDayFiveNoLynchVoteProof({
    proof: dayFiveNoLynchResolutionSurface.dayFiveVoteProof,
    expectedGame,
    sourceRoleUrl: dayFiveNoLynchResolutionSurface.sourceActionPlayerRoleUrl,
  });
  assertCoreLoopDayFiveNoLynchHostTransitionProof({
    proof: dayFiveNoLynchResolutionSurface.hostTransitionProof,
    expectedGame,
    sourceRoleUrl: dayFiveNoLynchResolutionSurface.sourceHostRoleUrl,
  });
  assertCoreLoopPostDayThreePlayerSurfaceProof({
    proof: dayFiveNoLynchResolutionSurface.actionPlayerNightFiveProof,
    sourceRoleUrl: dayFiveNoLynchResolutionSurface.sourceActionPlayerRoleUrl,
    expectedSlot: "slot-7",
    slotField: "actionPlayerSlot",
    expectedPrincipalUserId: "player_mira",
    expectedPhaseId: "N05",
    expectedPhaseState: "open",
    expectedActorAlive: true,
    expectedActorStatus: "alive",
    expectedActionState: "disabled:no legal action available",
    expectedStatusText: "no legal action available",
    expectedPrivateCount: 0,
    expectedPrivateReceipt: false,
    expectedBoundaryText: "open Night 5 with no legal action",
    expectedResyncFromSeq: 920,
    expectedCommandStateEndpoint:
      `/games/${expectedGame}/player-command-state?principal_user_id=player_mira&slot_id=slot-7`,
    expectedNotificationsEndpoint:
      `/games/${expectedGame}/notifications?principal_user_id=player_mira`,
    expectedLastVoteOutcomePhaseId: "D05",
  });
  assertCoreLoopStaleDayFiveVoteRecoveryProof({
    proof: dayFiveNoLynchResolutionSurface.staleDayFiveVoteRecoveryProof,
    expectedGame,
    sourceRoleUrl: dayFiveNoLynchResolutionSurface.sourceActionPlayerRoleUrl,
  });
}

function assertCoreLoopDayFiveNoLynchVoteProof({
  proof,
  expectedGame,
  sourceRoleUrl,
}) {
  if (
    proof?.status !== "passed" ||
    proof.clickedThroughFromRoleUrl !== true ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.rawInviteTokensVisible !== false ||
    proof.targetOnlyReceiptVisible !== false ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    typeof proof.visitedRolePath !== "string" ||
    !proof.visitedRolePath.includes("/g/") ||
    proof.surfaceTestId !== "player-surface" ||
    proof.clickedAction !== "submit_vote:no_lynch" ||
    proof.commandKind !== "SubmitVote" ||
    proof.command?.game !== expectedGame ||
    proof.command.actor_slot !== "slot-7" ||
    proof.command.target !== "NoLynch" ||
    proof.commandStatus?.state !== "ack" ||
    !proof.commandStatus?.message?.includes("Ack: stream seqs 918") ||
    proof.bridgePlan?.role !== "player" ||
    proof.bridgePlan.commandKind !== "SubmitVote" ||
    proof.bridgePlan.commandEndpoint !== "/commands" ||
    proof.bridgePlan.finalState !== "ack" ||
    !sameStringArray(proof.bridgePlan.projectionRefreshKeys, [
      "votecount",
      "commandState",
    ]) ||
    proof.receipts?.at?.(-1)?.state !== "ack" ||
    proof.projectionCommandState?.actorSlot !== "slot-7" ||
    proof.projectionCommandState?.phase?.phaseId !== "D05" ||
    proof.projectionCommandState?.phase?.locked !== false ||
    proof.projectionCommandState?.currentVote?.kind !== "no_lynch" ||
    !String(proof.projectionCommandState?.boundary ?? "").includes(
      "Day 5 no-lynch vote ACK",
    ) ||
    proof.projectionVotecount?.[0]?.target !== "No lynch" ||
    proof.projectionVotecount?.[0]?.count !== 1 ||
    proof.projectionVotecount?.[0]?.needed !== 1 ||
    proof.projectionDayVoteOutcomes?.at?.(-1)?.phaseId !== "D04" ||
    proof.setupResyncFromSeq !== 917 ||
    proof.setupSnapshotCommandState?.phase?.phaseId !== "D05" ||
    proof.currentVote?.hasVote !== "true" ||
    !String(proof.currentVote?.text ?? "").includes("No lynch") ||
    proof.receiptCount !== 1 ||
    !String(proof.receiptStatusText ?? "")
      .toLowerCase()
      .includes("ack: stream seqs 918") ||
    proof.receiptRefreshKeys !== "votecount,commandState"
  ) {
    throw new Error("core-loop admin proof missing Day 5 no-lynch vote ACK");
  }
}

function assertCoreLoopDayFiveNoLynchHostTransitionProof({
  proof,
  expectedGame,
  sourceRoleUrl,
}) {
  if (
    proof?.status !== "passed" ||
    proof.clickedThroughFromRoleUrl !== true ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.rawInviteTokensVisible !== false ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    typeof proof.visitedRolePath !== "string" ||
    !proof.visitedRolePath.endsWith("/host") ||
    proof.surfaceTestId !== "host-console-surface" ||
    proof.setupResyncFromSeq !== 918 ||
    proof.setupSnapshotHost?.phase?.id !== "D05" ||
    proof.setupSnapshotHost?.phase?.state !== "open"
  ) {
    throw new Error("core-loop admin proof missing Day 5 no-lynch host transition");
  }
  assertCoreLoopHostPhaseTransitionActionProof({
    proof: proof.resolveProof,
    expectedGame,
    actionId: "resolve_phase",
    commandKind: "ResolvePhase",
    streamSeq: 919,
    expectedPhaseId: "D05",
    expectedPhaseState: "locked",
    expectedDeadlineAffordance: "unlock_thread,advance_phase",
    expectedRefreshKeys: ["host", "votecount", "dayVoteOutcomes", "hostPrompts"],
  });
  assertCoreLoopHostPhaseTransitionActionProof({
    proof: proof.advanceProof,
    expectedGame,
    actionId: "advance_phase",
    commandKind: "AdvancePhase",
    streamSeq: 920,
    expectedPhaseId: "N05",
    expectedPhaseState: "open",
    expectedDeadlineAffordance: "resolve_phase,lock_thread",
    expectedRefreshKeys: [],
  });
  if (
    proof.resolveProof?.votecountProjection?.[0]?.target !== "No lynch" ||
    proof.resolveProof?.dayVoteOutcomesProjection?.at?.(-1)?.phaseId !== "D05" ||
    proof.resolveProof?.dayVoteOutcomesProjection?.at?.(-1)?.status !==
      "NoLynch"
  ) {
    throw new Error("core-loop admin proof missing Day 5 no-lynch host projections");
  }
}

function assertCoreLoopStaleDayFiveVoteRecoveryProof({
  proof,
  expectedGame,
  sourceRoleUrl,
}) {
  if (
    proof?.status !== "passed" ||
    proof.clickedThroughFromRoleUrl !== true ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.rawInviteTokensVisible !== false ||
    proof.targetOnlyReceiptVisible !== false ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    typeof proof.visitedRolePath !== "string" ||
    !proof.visitedRolePath.includes("/g/") ||
    proof.surfaceTestId !== "player-surface" ||
    proof.clickedAction !== "submit_vote:no_lynch" ||
    proof.commandKind !== "SubmitVote" ||
    proof.setupResyncFromSeq !== 918 ||
    proof.setupSnapshotCommandState?.phase?.phaseId !== "D05" ||
    proof.setupSnapshotCommandState?.voteTargets?.[0]?.kind !== "no_lynch" ||
    proof.command?.game !== expectedGame ||
    proof.command.actor_slot !== "slot-7" ||
    proof.command.target !== "NoLynch" ||
    proof.commandStatus?.state !== "reject" ||
    proof.commandStatus.error !== "PhaseLocked" ||
    !String(proof.commandStatus.message ?? "").includes(
      "stale vote state, refresh and use current vote controls",
    ) ||
    proof.bridgePlan?.role !== "player" ||
    proof.bridgePlan.commandKind !== "SubmitVote" ||
    proof.bridgePlan.commandEndpoint !== "/commands" ||
    proof.bridgePlan.finalState !== "reject" ||
    !sameStringArray(proof.bridgePlan.projectionRefreshKeys, [
      "votecount",
      "commandState",
      "dayVoteOutcomes",
    ]) ||
    proof.receipts?.at?.(-1)?.state !== "reject" ||
    proof.projectionCommandState?.actorSlot !== "slot-7" ||
    proof.projectionCommandState?.phase?.phaseId !== "N05" ||
    proof.projectionCommandState?.phase?.locked !== false ||
    proof.projectionCommandState?.actions?.length !== 0 ||
    proof.projectionCommandState?.voteTargets?.length !== 0 ||
    !String(proof.projectionCommandState?.boundary ?? "").includes(
      "stale D05 vote refreshed into current Night 5 controls",
    ) ||
    proof.checkpointReceiptState !== "reject:PhaseLocked" ||
    proof.checkpointPhaseIdAfterReject !== "N05" ||
    proof.checkpointActionStateAfterReject !==
      "disabled:no legal action available" ||
    proof.checkpointTargetSlotsAfterReject !== "" ||
    !String(proof.recoveryText ?? "").includes("Reject PhaseLocked") ||
    !String(proof.recoveryText ?? "").includes("refresh") ||
    proof.receiptCount !== 1 ||
    !String(proof.receiptStatusText ?? "")
      .toLowerCase()
      .includes("reject phaselocked")
  ) {
    throw new Error("core-loop admin proof missing stale Day 5 vote recovery");
  }
}

function assertCoreLoopCompletedGameEndgameSurface(completedGameEndgameSurface) {
  assertCompletedGameEndgameSurfaceProof({
    completedGameEndgameSurface,
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
  if (
    proof?.status !== "passed" ||
    proof.clickedThroughFromRoleUrl !== true ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.rawInviteTokensVisible !== false ||
    proof.targetOnlyReceiptVisible !== false ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    typeof proof.visitedRolePath !== "string" ||
    !proof.visitedRolePath.includes("/g/") ||
    proof.surfaceTestId !== "player-surface" ||
    proof.clickedAction !== "submit_vote:no_lynch" ||
    proof.commandKind !== "SubmitVote" ||
    proof.command?.game !== expectedGame ||
    proof.command.actor_slot !== "slot-7" ||
    proof.command.target !== "NoLynch" ||
    proof.commandStatus?.state !== "ack" ||
    !proof.commandStatus?.message?.includes("Ack: stream seqs 912") ||
    proof.bridgePlan?.role !== "player" ||
    proof.bridgePlan.commandKind !== "SubmitVote" ||
    proof.bridgePlan.commandEndpoint !== "/commands" ||
    proof.bridgePlan.finalState !== "ack" ||
    !sameStringArray(proof.bridgePlan.projectionRefreshKeys, [
      "votecount",
      "commandState",
    ]) ||
    proof.receipts?.at?.(-1)?.state !== "ack" ||
    proof.projectionCommandState?.actorSlot !== "slot-7" ||
    proof.projectionCommandState?.phase?.phaseId !== "D04" ||
    proof.projectionCommandState?.phase?.locked !== false ||
    proof.projectionCommandState?.currentVote?.kind !== "no_lynch" ||
    !String(proof.projectionCommandState?.boundary ?? "").includes(
      "Day 4 no-lynch vote ACK",
    ) ||
    proof.projectionVotecount?.[0]?.target !== "No lynch" ||
    proof.projectionVotecount?.[0]?.count !== 1 ||
    proof.projectionVotecount?.[0]?.needed !== 1 ||
    proof.projectionDayVoteOutcomes?.at?.(-1)?.phaseId !== "D03" ||
    proof.setupResyncFromSeq !== 911 ||
    proof.setupSnapshotCommandState?.phase?.phaseId !== "D04" ||
    proof.currentVote?.hasVote !== "true" ||
    !String(proof.currentVote?.text ?? "").includes("No lynch") ||
    proof.receiptCount !== 1 ||
    !String(proof.receiptStatusText ?? "")
      .toLowerCase()
      .includes("ack: stream seqs 912") ||
    proof.receiptRefreshKeys !== "votecount,commandState"
  ) {
    throw new Error("core-loop admin proof missing Day 4 no-lynch vote ACK");
  }
}

function assertCoreLoopDayFourNoLynchHostTransitionProof({
  proof,
  expectedGame,
  sourceRoleUrl,
}) {
  if (
    proof?.status !== "passed" ||
    proof.clickedThroughFromRoleUrl !== true ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.rawInviteTokensVisible !== false ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    typeof proof.visitedRolePath !== "string" ||
    !proof.visitedRolePath.endsWith("/host") ||
    proof.surfaceTestId !== "host-console-surface" ||
    proof.setupResyncFromSeq !== 912 ||
    proof.setupSnapshotHost?.phase?.id !== "D04" ||
    proof.setupSnapshotHost?.phase?.state !== "open"
  ) {
    throw new Error("core-loop admin proof missing Day 4 no-lynch host transition");
  }
  assertCoreLoopHostPhaseTransitionActionProof({
    proof: proof.resolveProof,
    expectedGame,
    actionId: "resolve_phase",
    commandKind: "ResolvePhase",
    streamSeq: 913,
    expectedPhaseId: "D04",
    expectedPhaseState: "locked",
    expectedDeadlineAffordance: "unlock_thread,advance_phase",
    expectedRefreshKeys: ["host", "votecount", "dayVoteOutcomes", "hostPrompts"],
  });
  assertCoreLoopHostPhaseTransitionActionProof({
    proof: proof.advanceProof,
    expectedGame,
    actionId: "advance_phase",
    commandKind: "AdvancePhase",
    streamSeq: 914,
    expectedPhaseId: "N04",
    expectedPhaseState: "open",
    expectedDeadlineAffordance: "resolve_phase,lock_thread",
    expectedRefreshKeys: [],
  });
  if (
    proof.resolveProof?.votecountProjection?.[0]?.target !== "No lynch" ||
    proof.resolveProof?.dayVoteOutcomesProjection?.at?.(-1)?.phaseId !== "D04" ||
    proof.resolveProof?.dayVoteOutcomesProjection?.at?.(-1)?.status !==
      "NoLynch"
  ) {
    throw new Error("core-loop admin proof missing Day 4 no-lynch host projections");
  }
}

function assertCoreLoopNightFourPlayerActionSubmissionProof({
  proof,
  expectedGame,
  sourceRoleUrl,
}) {
  const clickProof = proof?.clickProof;
  if (
    proof?.status !== "passed" ||
    proof.clickedThroughFromRoleUrl !== true ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    typeof proof.visitedRolePath !== "string" ||
    !proof.visitedRolePath.includes("/g/") ||
    proof.surfaceTestId !== "player-surface" ||
    proof.setupResyncFromSeq !== 914 ||
    proof.setupSnapshotCommandState?.phase?.phaseId !== "N04" ||
    proof.setupSnapshotCommandState?.actions?.[0]?.targets?.[0] !== "slot-5" ||
    clickProof?.status !== "passed" ||
    clickProof.clickedAction !== "submit_action:factional_kill" ||
    clickProof.commandKind !== "SubmitAction" ||
    clickProof.command?.game !== expectedGame ||
    clickProof.command.actor_slot !== "slot-7" ||
    clickProof.command.action_id !== "factional_kill" ||
    clickProof.command.template_id !== "factional_kill" ||
    clickProof.command.targets?.[0] !== "slot-5" ||
    clickProof.command.grant_id !== "grant-factional-kill-n04" ||
    clickProof.commandStatus?.state !== "ack" ||
    !clickProof.commandStatus?.message?.includes("Ack: stream seqs 915") ||
    clickProof.bridgePlan?.role !== "player" ||
    clickProof.bridgePlan.commandKind !== "SubmitAction" ||
    clickProof.bridgePlan.commandEndpoint !== "/commands" ||
    clickProof.bridgePlan.finalState !== "ack" ||
    !sameStringArray(clickProof.bridgePlan.projectionRefreshKeys, [
      "notifications",
      "investigationResults",
      "commandState",
    ]) ||
    clickProof.receipts?.at?.(-1)?.state !== "ack" ||
    clickProof.projectionCommandState?.phase?.phaseId !== "N04" ||
    clickProof.projectionCommandState?.actions?.length !== 0 ||
    !String(clickProof.projectionCommandState?.boundary ?? "").includes(
      "Night 4 action ACK",
    ) ||
    !String(clickProof.checkpointReceiptState ?? "").includes(
      "Ack: stream seqs 915",
    ) ||
    clickProof.checkpointActionStateAfterAck !==
      "disabled:no legal action available" ||
    clickProof.receiptCount !== 1 ||
    !String(clickProof.receiptStatusText ?? "")
      .toLowerCase()
      .includes("ack: stream seqs 915")
  ) {
    throw new Error("core-loop admin proof missing Night 4 player action ACK");
  }
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

function assertCoreLoopPostDayThreeHostAdvanceProof({
  proof,
  expectedGame,
  sourceRoleUrl,
}) {
  if (
    proof?.status !== "passed" ||
    proof.clickedThroughFromRoleUrl !== true ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.rawInviteTokensVisible !== false ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    typeof proof.visitedRolePath !== "string" ||
    !proof.visitedRolePath.endsWith("/host") ||
    proof.surfaceTestId !== "host-console-surface" ||
    proof.setupResyncFromSeq !== 908 ||
    proof.setupSnapshotHost?.phase?.id !== "D03" ||
    proof.setupSnapshotHost?.phase?.state !== "locked"
  ) {
    throw new Error("core-loop admin proof missing post-Day 3 host advance");
  }
  assertCoreLoopHostPhaseTransitionActionProof({
    proof: proof.advanceProof,
    expectedGame,
    actionId: "advance_phase",
    commandKind: "AdvancePhase",
    streamSeq: 909,
    expectedPhaseId: "N03",
    expectedPhaseState: "open",
    expectedDeadlineAffordance: "resolve_phase,lock_thread",
    expectedRefreshKeys: [],
  });
}

function assertCoreLoopNightThreeEmptyHostTransitionProof({
  proof,
  expectedGame,
  sourceRoleUrl,
}) {
  if (
    proof?.status !== "passed" ||
    proof.clickedThroughFromRoleUrl !== true ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.rawInviteTokensVisible !== false ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    typeof proof.visitedRolePath !== "string" ||
    !proof.visitedRolePath.endsWith("/host") ||
    proof.surfaceTestId !== "host-console-surface" ||
    proof.setupResyncFromSeq !== 909 ||
    proof.setupSnapshotHost?.phase?.id !== "N03" ||
    proof.setupSnapshotHost?.phase?.state !== "open"
  ) {
    throw new Error("core-loop admin proof missing empty Night 3 host transition");
  }
  assertCoreLoopHostPhaseTransitionActionProof({
    proof: proof.resolveProof,
    expectedGame,
    actionId: "resolve_phase",
    commandKind: "ResolvePhase",
    streamSeq: 910,
    expectedPhaseId: "N03",
    expectedPhaseState: "locked",
    expectedDeadlineAffordance: "unlock_thread,advance_phase",
    expectedRefreshKeys: ["host", "votecount", "dayVoteOutcomes", "hostPrompts"],
  });
  assertCoreLoopHostPhaseTransitionActionProof({
    proof: proof.advanceProof,
    expectedGame,
    actionId: "advance_phase",
    commandKind: "AdvancePhase",
    streamSeq: 911,
    expectedPhaseId: "D04",
    expectedPhaseState: "open",
    expectedDeadlineAffordance: "resolve_phase,lock_thread",
    expectedRefreshKeys: [],
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
  expectedDeadlineAffordance,
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

function assertCoreLoopPrivateChannelRoleSurface(privateChannelRoleSurface) {
  const submitPostProof = privateChannelRoleSurface?.submitPostProof;
  const stalePostProof =
    privateChannelRoleSurface?.stalePostAfterPhaseTransitionProof;
  const completedProof =
    privateChannelRoleSurface?.completedPrivateChannelProof;
  const expectedGame = gameFromRoleUrl(privateChannelRoleSurface?.sourceRoleUrl);
  const submitPostScenario = privateChannelSubmitPostScenario();
  const stalePostScenario = stalePrivateChannelPostPhaseLockedScenario();
  if (
    privateChannelRoleSurface?.status !== "passed" ||
    privateChannelRoleSurface.clickedThroughFromRoleUrl !== true ||
    privateChannelRoleSurface.releaseReady !== false ||
    privateChannelRoleSurface.productionReady !== false ||
    privateChannelRoleSurface.rawInviteTokensVisible !== false ||
    typeof privateChannelRoleSurface.sourceRoleUrl !== "string" ||
    !privateChannelRoleSurface.sourceRoleUrl.includes("/g/") ||
    typeof privateChannelRoleSurface.visitedRolePath !== "string" ||
    !privateChannelRoleSurface.visitedRolePath.includes("/c/role-pm") ||
    !privateChannelRoleSurface.visitedRolePath.includes("private=notification-1") ||
    privateChannelRoleSurface.surfaceTestId !== "player-surface" ||
    privateChannelRoleSurface.channelRailTestId !== "player-channel-role-pm" ||
    privateChannelRoleSurface.channelId !== "role-pm" ||
    privateChannelRoleSurface.channelAriaCurrent !== "page" ||
    privateChannelRoleSurface.commandPanelChannelId !== "role-pm" ||
    privateChannelRoleSurface.channelContextChannelId !== "role-pm" ||
    privateChannelRoleSurface.channelContextCapabilityLabel !==
      "ChannelMember(role-pm)" ||
    privateChannelRoleSurface.privateQueueBoundary?.status !==
      "principal-scoped-private-projections" ||
    privateChannelRoleSurface.privateQueueBoundary?.count < 1 ||
    !String(privateChannelRoleSurface.privateQueueBoundary?.text ?? "").includes(
      "principal-scoped endpoints",
    ) ||
    privateChannelRoleSurface.expandedPrivateItem?.id !== "notification-1" ||
    privateChannelRoleSurface.expandedPrivateItem?.detailTestId !==
      "player-private-detail-notification-1" ||
    !String(privateChannelRoleSurface.expandedPrivateItem?.detailText ?? "").includes(
      "Phase",
    )
  ) {
    throw new Error("core-loop admin proof missing private channel role URL surface");
  }
  assertPrivateChannelSubmitPostProofCase({
    proof: submitPostProof,
    expectedGame,
    scenario: submitPostScenario,
  });
  assertStalePrivateChannelPostPhaseLockedProofCase({
    proof: stalePostProof,
    expectedGame,
    sourceRoleUrl: privateChannelRoleSurface.sourceRoleUrl,
    visitedRolePath: privateChannelRoleSurface.visitedRolePath,
    scenario: stalePostScenario,
  });
  assertCoreLoopCompletedPrivateChannelProof({
    proof: completedProof,
    expectedGame,
    sourceRoleUrl: privateChannelRoleSurface.sourceRoleUrl,
    visitedRolePath: privateChannelRoleSurface.visitedRolePath,
  });
}

function assertCoreLoopCompletedPrivateChannelProof({
  proof,
  expectedGame,
  sourceRoleUrl,
  visitedRolePath,
}) {
  assertCompletedPrivateChannelProofCases({
    proof,
    sourceRoleUrl,
    visitedRolePath,
    cases: completedPrivateChannelProofAssertionCases({
      proof,
      expectedGame,
      sourceRoleUrl,
      visitedRolePath,
      assertCompletedPrivateChannelReloadProof:
        assertCoreLoopCompletedPrivateChannelReloadProof,
      assertStaleCompletedPrivatePostRecoveryProof:
        assertCoreLoopStaleCompletedPrivatePostRecoveryProof,
    }),
  });
}

function assertCoreLoopCompletedPrivateChannelReloadProof({
  proof,
  sourceRoleUrl,
  visitedRolePath,
}) {
  assertCompletedPrivateChannelReloadProofCase({
    proof,
    sourceRoleUrl,
    visitedRolePath,
  });
}

function assertCoreLoopStaleCompletedPrivatePostRecoveryProof({
  proof,
  expectedGame,
  sourceRoleUrl,
  visitedRolePath,
}) {
  assertStaleCompletedPrivatePostRecoveryProofCase({
    proof,
    expectedGame,
    sourceRoleUrl,
    visitedRolePath,
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
  };
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
  const requiredChecks = [
    "replacement-redeemed-invite-recovery",
    "replacement-session-revocation-recovery",
    "replacement-session-refresh-recovery",
    "replacement-stale-session-after-refresh",
    "replacement-reconnect-recovery",
    ...staleConflictMessageLaneIds,
    "replacement-idempotent-retry",
    ...playerActionFoundationLaneIds,
    ...promotedStalePlayerCommandLaneIds,
    "concurrent-vote-race",
    "concurrent-vote-race-reload",
    "concurrent-player-vote-resolve-race",
    "concurrent-player-vote-resolve-race-reload",
    "concurrent-player-action-advance-race",
    "concurrent-player-action-advance-race-reload",
    "concurrent-cohost-deadline-resolve-race",
    "concurrent-cohost-deadline-resolve-race-reload",
    ...replacementPrivatePostRaceLaneIds,
    "concurrent-replacement-vote-race",
    "concurrent-replacement-vote-race-reload",
    "concurrent-replacement-action-race",
    "concurrent-replacement-action-race-reload",
    "replacement-incoming-action",
    "replacement-action-reconnect",
    "replacement-stale-action-after-resolve",
    ...replacementPrivatePostRecoveryLaneIds,
    "concurrent-host-publish-race",
    "concurrent-host-publish-race-reload",
    ...hostStandaloneStaleControlLaneIds,
    "concurrent-host-lifecycle-race",
    "concurrent-host-lifecycle-race-reload",
    ...hostPromptStaleControlLaneIds,
    ...completedGameHardeningLaneIds(),
    ...playerActionConflictRecoveryLaneIds,
    ...hostGenericStaleControlLaneIds,
    ...hostRaceReloadLaneIds,
    ...hostPhaseStaleRecoveryLaneIds,
    "stale-cohost-deadline",
    ...cohostDeadlineRecoveryLaneIds,
  ];
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
  for (const checkId of requiredChecks) {
    if (!proof.adminRoleSurface?.visibleChecks?.includes(checkId)) {
      throw new Error(`hardening admin proof missing visible check: ${checkId}`);
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
    visibleHostedHandoffBlockedChecks:
      proof.adminRoleSurface.visibleHostedHandoffBlockedChecks ?? [],
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
    evidenceStatus: String(proof.generatedFrom?.status ?? "unknown"),
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
  if (proof?.version !== 10) {
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
  const requiredChecks = [
    "hosted-like-api-frontend-target",
    "multi-session-concurrent-command-matrix",
    "reload-recovery-after-races",
    "reconnect-recovery",
    "stale-client-conflict-messages",
    "raw-role-credential-redaction",
    "real-hosted-deployment",
  ];
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
    !proof.adminRoleSurface?.visibleRelatedLinks?.includes("local-next-action")
  ) {
    throw new Error("proof freshness admin proof did not prove next-action handoff");
  }
  if (!proof.adminRoleSurface?.visibleChecks?.includes("next-action-handoff")) {
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
    if (
      typeof declaration?.featureSlotId !== "string" ||
      typeof declaration?.cycleId !== "string" ||
      typeof declaration?.roleUrlId !== "string" ||
      typeof declaration?.checkpointId !== "string" ||
      typeof declaration?.adminCheckId !== "string" ||
      typeof target.featureSlotId !== "string" ||
      typeof target.cycleId !== "string" ||
      typeof target.roleUrlId !== "string" ||
      typeof target.roleUrl !== "string" ||
      typeof target.checkpointId !== "string" ||
      typeof target.adminCheckId !== "string" ||
      typeof target.browserProofCommand !== "string" ||
      target.featureSlotId !== declaration.featureSlotId ||
      target.adminCheckId !== declaration.adminCheckId ||
      typeof drilldown?.featureSlotId !== "string" ||
      typeof drilldown?.cycleRowId !== "string" ||
      typeof drilldown?.roleUrlRowId !== "string" ||
      typeof drilldown?.checkpointRowId !== "string" ||
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
          item.auditId === "local-proof-graph",
      ) ?? null;
    if (
      graphDestination === null ||
      graphDestination.detailRoleUrl !==
        "/admin/audit/local-proof-graph?game=<seeded-game>" ||
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
    visibleHostedHandoffBlockedChecks:
      proof.adminRoleSurface.visibleHostedHandoffBlockedChecks ?? [],
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
    "local-core-loop-proof",
    "local-hardening-proof",
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
    "spine-manifest-handoff",
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
  const coreLoopCheck = checklist.localDevelopmentSpine?.checks?.find(
    (check) => check.id === "local-core-loop-proof",
  );
  if (
    coreLoopCheck?.spineTargets !== undefined &&
    !validCoreLoopSpineTargets(coreLoopCheck.spineTargets)
  ) {
    throw new Error("dev-test-game core-loop readiness check is missing spine targets");
  }
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
    (check) => check.id === "local-identity-adapter-proof" && check.status === "passed",
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
    Array.isArray(spineTargets.visibleAdminCheckIds) &&
    spineTargets.visibleAdminCheckIds.includes("core-loop-spine") &&
    spineTargets.visibleAdminCheckIds.includes("host-lifecycle-control")
  );
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
    readOptionalSeedFixtureSummary(),
    readOptionalIdentityAdapterProof(),
    readOptionalIdentityAdminProof(),
    readOptionalHostedIdentityEvidenceAdminProof(),
    readOptionalOpsAdminProof(),
    readOptionalHostedOpsSignals(),
    readOptionalHostedOpsSignalsAdminProof(),
    readOptionalSeedAdminProof(),
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

async function readOptionalSeedAdminProof() {
  const override = process.env.FMARCH_DEV_TEST_GAME_SEED_ADMIN_PROOF;
  const proofPath = await resolveOptionalDefaultArtifactPath(override, defaultSeedAdminProofPath);
  if (proofPath === undefined) {
    return undefined;
  }
  const now = new Date();
  const artifact = await readFreshArtifactMetadata(proofPath, now);
  return {
    seedAdminProof: JSON.parse(await readFile(proofPath, "utf8")),
    seedAdminProofPath: path.relative(repoRoot, proofPath),
    seedAdminProofArtifact: artifact,
  };
}

async function readOptionalSeedFixtureSummary() {
  const override = process.env.FMARCH_DEV_TEST_GAME_SEED_FIXTURE_SUMMARY;
  const fixturePath = await resolveOptionalDefaultArtifactPath(
    override,
    defaultSeedFixtureSummaryPath,
  );
  if (fixturePath === undefined) {
    return undefined;
  }
  const now = new Date();
  const artifact = await readFreshArtifactMetadata(fixturePath, now);
  return {
    seedFixtureSummary: JSON.parse(await readFile(fixturePath, "utf8")),
    seedFixtureSummaryPath: path.relative(repoRoot, fixturePath),
    seedFixtureSummaryArtifact: artifact,
  };
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
