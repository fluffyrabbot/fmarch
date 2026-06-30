import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertDevTestGameProofRun } from "./dev_test_game_proof_contract.mjs";
import { assertDevTestGameRaceCoverage } from "./dev_test_game_race_coverage.mjs";

export const DEV_TEST_GAME_RELEASE_READINESS_VERSION = 1;

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
const defaultProofGraphAdminProofPath = path.join(
  artifactDir,
  "proof-graph-admin-proof.json",
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
  const proofGraphAdminProofEvidence = options.proofGraphAdminProof
    ? validateDevTestGameProofGraphAdminProof(options.proofGraphAdminProof, {
        path:
          options.proofGraphAdminProofPath ??
          "target/dev-test-game/proof-graph-admin-proof.json",
        artifact: options.proofGraphAdminProofArtifact,
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
        : { adminRoleSurface: coreLoopAdminProofEvidence }),
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
        "replacement-stale-conflict-message",
        "replacement-idempotent-retry",
        "idempotent-retry",
        "action-idempotent-retry",
        "concurrent-action-race",
        "concurrent-action-race-reload",
        "reconnect-recovery",
        "stale-player-vote",
        "concurrent-vote-race",
        "concurrent-vote-race-reload",
        "concurrent-player-vote-resolve-race",
        "concurrent-player-vote-resolve-race-reload",
        "concurrent-player-action-advance-race",
        "concurrent-player-action-advance-race-reload",
        "concurrent-cohost-deadline-resolve-race",
        "concurrent-cohost-deadline-resolve-race-reload",
        "concurrent-replacement-private-post-race",
        "concurrent-replacement-private-post-race-reload",
        "concurrent-replacement-vote-race",
        "concurrent-replacement-vote-race-reload",
        "concurrent-replacement-action-race",
        "concurrent-replacement-action-race-reload",
        "replacement-incoming-action",
        "replacement-action-reconnect",
        "replacement-stale-action-after-resolve",
        "replacement-stale-private-post-after-resolve",
        "replacement-stale-private-post-reconnect",
        "replacement-stale-private-post-after-complete",
        "replacement-stale-private-post-after-complete-reload",
        "concurrent-host-publish-race",
        "concurrent-host-publish-race-reload",
        "stale-host-publish",
        "stale-host-lifecycle",
        "stale-host-modkill",
        "concurrent-host-lifecycle-race",
        "concurrent-host-lifecycle-race-reload",
        "stale-host-prompt",
        "stale-host-prompt-reload",
        "stale-host-complete",
        "stale-host-complete-reload",
        "concurrent-host-complete-race",
        "concurrent-host-complete-race-reload",
        "concurrent-player-complete-race",
        "public-player-complete-reload",
        "stale-player-complete",
        "stale-player-complete-reload",
        "stale-same-action-recovery",
        "stale-dead-action-conflict",
        "stale-action-conflict",
        "stale-action-conflict-message",
        "stale-host-control",
        "concurrent-host-resolve-race",
        "concurrent-host-resolve-race-reload",
        "concurrent-host-advance-race",
        "concurrent-host-advance-race-reload",
        "concurrent-host-deadline-advance-race",
        "concurrent-host-deadline-advance-race-reload",
        "concurrent-host-mixed-advance-race",
        "concurrent-host-mixed-advance-race-reload",
        "stale-host-resolve",
        "stale-host-resolve-reload",
        "stale-host-advance",
        "stale-host-advance-reload",
        "stale-host-deadline",
        "stale-host-deadline-reload",
        "stale-cohost-deadline",
        "stale-cohost-deadline-reload",
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
  if (seedFixtureEvidence !== undefined) {
    localChecks.push({
      id: "local-seed-demo-fixture",
      label: "Local seed/demo fixture summary",
      status: "passed",
      evidence: seedFixtureEvidence.path,
      proofBoundary: seedFixtureEvidence.proofBoundary,
      scenarioCount: seedFixtureEvidence.scenarioCount,
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
  if (proofGraphAdminProofEvidence !== undefined) {
    localChecks.push({
      id: "local-proof-graph-admin-role-handoffs",
      label: "Proof graph admin role handoffs",
      status: "passed",
      evidence: proofGraphAdminProofEvidence.path,
      proofBoundary: proofGraphAdminProofEvidence.proofBoundary,
      roleHandoffCount: proofGraphAdminProofEvidence.roleHandoffCount,
      roleHandoffIds: proofGraphAdminProofEvidence.roleHandoffIds,
      destinationAuditIds: proofGraphAdminProofEvidence.destinationAuditIds,
      adminRoleSurface: proofGraphAdminProofEvidence,
    });
  }
  const unproven = [
    ...(identityAdapterEvidence === undefined
      ? [
          {
            id: "production-identity",
            status: "unproven",
            requiredEvidence:
              "Real accounts, sessions, and invite delivery replacing local dev tokens without changing role surfaces",
          },
        ]
      : [
          {
            id: "hosted-production-identity",
            status: "unproven",
            requiredEvidence:
              "Hosted account lifecycle, invite delivery, account recovery, rate limits, abuse controls, production session-secret policy, and hosted audit retention/export over the proven role-surface adapter",
          },
        ]),
    {
      id: "hosted-deployment",
      status: "unproven",
      requiredEvidence: "Hosted API/frontend deployment proof with external health checks",
    },
    ...(seedFixtureEvidence === undefined
      ? [
          {
            id: "seed-demo-fixtures",
            status: "unproven",
            requiredEvidence:
              "Machine-readable seeded local demo fixture and scenario inventory tied to this proof run",
          },
        ]
      : [
          {
            id: "hosted-demo-fixtures",
            status: "unproven",
            requiredEvidence:
              "Hosted/demo environment fixtures, sanitized demo data policy, and release-safe invite delivery",
          },
        ]),
    ...(backupRestoreEvidence === undefined
      ? [
          {
            id: "backup-restore-drill",
            status: "unproven",
            requiredEvidence:
              "Local or production-like backup/restore drill tied to this dev-test-game spine",
          },
        ]
      : [
          {
            id: "production-backup-recovery",
            status: "unproven",
            requiredEvidence:
              "Production-like backup storage, PITR restore, key escrow, and secret rotation evidence",
          },
        ]),
    {
      id:
        raceCoverageEvidence === undefined
          ? "exhaustive-race-coverage"
          : "hosted-concurrent-race-matrix",
      status: "unproven",
      requiredEvidence:
        raceCoverageEvidence === undefined
          ? "Machine-readable local race coverage inventory tied to the saved dev-test-game proof-run"
          : "Hosted or hosted-like concurrent command race matrix beyond the promoted local replacement, host, player, cohost deadline, lifecycle, and complete-game reload milestones, including multi-session reload/reconnect recovery and stale-client conflict evidence",
    },
    ...(opsArtifactsEvidence === undefined
      ? [
          {
            id: "observability-and-operations",
            status: "unproven",
            requiredEvidence:
              "Saved local proof artifacts, redacted role entrypoints, checksums, logs/metrics/traces, and operator runbook evidence for the seeded game flow",
          },
        ]
      : [
          {
            id: "hosted-observability-and-operations",
            status: "unproven",
            requiredEvidence:
              "Hosted logs, metrics, traces, paging/SLOs, and incident response evidence",
          },
        ]),
    {
      id: "human-release-runbook",
      status: "unproven",
      requiredEvidence: "Human-executed beta/release checklist with rollback and support path",
    },
  ];
  return {
    version: DEV_TEST_GAME_RELEASE_READINESS_VERSION,
    proof: "dev-test-game-release-readiness",
    status: "passed",
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
        proofGraphAdminProofEvidence === undefined)
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
              ...(proofGraphAdminProofEvidence === undefined
                ? {}
                : { proofGraphAdminProof: proofGraphAdminProofEvidence }),
            },
          }),
    },
    releaseReadiness: {
      status: "not_ready",
      reason: releaseReadinessReason({
        backupRestoreEvidence,
        opsArtifactsEvidence,
        seedFixtureEvidence,
        identityAdapterEvidence,
        spineManifestEvidence,
        raceCoverageEvidence,
        proofGraphAdminProofEvidence,
      }),
      unproven,
    },
    proofBoundary:
      "Derived from the local dev-test-game proof-run artifact. Passing means the local harness evidence is coherent; it does not mean production, hosted, beta, or release readiness.",
  };
}

function releaseReadinessReason({
  backupRestoreEvidence,
  opsArtifactsEvidence,
  seedFixtureEvidence,
  identityAdapterEvidence,
  spineManifestEvidence,
  raceCoverageEvidence,
  proofGraphAdminProofEvidence,
}) {
  const passed = [
    "the local development-spine proof",
    ...(backupRestoreEvidence === undefined ? [] : ["local backup/restore drill"]),
    ...(opsArtifactsEvidence === undefined ? [] : ["local ops artifact bundle"]),
    ...(seedFixtureEvidence === undefined ? [] : ["local seed/demo fixture"]),
    ...(identityAdapterEvidence === undefined ? [] : ["local identity adapter"]),
    ...(spineManifestEvidence === undefined ? [] : ["local spine manifest"]),
    ...(raceCoverageEvidence === undefined ? [] : ["local race coverage inventory"]),
    ...(proofGraphAdminProofEvidence === undefined
      ? []
      : ["proof graph admin role handoffs"]),
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
      : "hosted concurrent race matrix",
    opsArtifactsEvidence === undefined ? "observability" : "hosted observability",
    "human release evidence",
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
  const groups = [
    buildRaceCoveragePromotedMilestoneGroup(
      "replacement-race-reload",
      "Replacement race reload",
      replacementRaceReloadMilestone,
    ),
    buildRaceCoveragePromotedMilestoneGroup(
      "host-concurrent-race-reload",
      "Host concurrent race reload",
      hostConcurrentRaceReloadMilestone,
    ),
    buildRaceCoveragePromotedMilestoneGroup(
      "player-concurrent-action-reload",
      "Player concurrent action reload",
      playerConcurrentActionReloadMilestone,
    ),
    buildRaceCoveragePromotedMilestoneGroup(
      "cohost-deadline-race-reload",
      "Cohost deadline race reload",
      cohostDeadlineRaceReloadMilestone,
    ),
  ];
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

function buildRaceCoveragePromotedMilestoneGroup(id, label, milestone) {
  return {
    id,
    label,
    status: milestone.status,
    cellIds: [...milestone.cellIds],
    requiredCellCount: milestone.requiredCellCount,
    coveredCellCount: milestone.coveredCellCount,
    gapCount: milestone.gapCount,
  };
}

const staleConflictMessageLaneIds = Object.freeze([
  "replacement-stale-conflict-message",
  "stale-action-conflict-message",
  "stale-dead-action-conflict",
]);

const hostStaleControlLaneIds = Object.freeze([
  "stale-host-publish",
  "stale-host-lifecycle",
  "stale-host-modkill",
  "stale-host-prompt",
  "stale-host-prompt-reload",
  "stale-host-complete",
  "stale-host-complete-reload",
  "stale-host-control",
  "stale-host-resolve",
  "stale-host-resolve-reload",
  "stale-host-advance",
  "stale-host-advance-reload",
  "stale-host-deadline",
  "stale-host-deadline-reload",
]);

const replacementRaceReloadCellIds = Object.freeze([
  "replacement-private-post",
  "replacement-vote",
  "replacement-action",
]);

const hostConcurrentRaceReloadCellIds = Object.freeze([
  "host-resolve",
  "host-advance",
  "host-deadline-advance",
  "host-lifecycle",
  "host-mixed-advance",
  "host-votecount-publication",
  "host-complete-game",
]);

const playerConcurrentActionReloadCellIds = Object.freeze([
  "player-vote-change",
  "player-night-action",
  "player-vote-vs-host-resolve",
  "player-action-vs-host-advance",
  "player-vs-completed-game",
]);

const cohostDeadlineRaceReloadCellIds = Object.freeze([
  "cohost-deadline-vs-host-resolve",
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
  return {
    status: "passed",
    path: options.path ?? "target/dev-test-game/core-loop-admin-proof.json",
    proofBoundary: proof.proofBoundary,
    overviewRoleUrl: proof.adminRoleSurface.overviewRoleUrl,
    detailRoleUrl: proof.adminRoleSurface.detailRoleUrl,
    visibleChecks: proof.adminRoleSurface.visibleChecks,
    ...(options.artifact === undefined ? {} : { artifact: options.artifact }),
  };
}

export function validateDevTestGameHardeningAdminProof(proof, options = {}) {
  const requiredChecks = [
    "replacement-redeemed-invite-recovery",
    "replacement-session-revocation-recovery",
    "replacement-session-refresh-recovery",
    "replacement-stale-session-after-refresh",
    "replacement-reconnect-recovery",
    "replacement-stale-conflict-message",
    "replacement-idempotent-retry",
    "idempotent-retry",
    "action-idempotent-retry",
    "concurrent-action-race",
    "concurrent-action-race-reload",
    "reconnect-recovery",
    "stale-player-vote",
    "concurrent-vote-race",
    "concurrent-vote-race-reload",
    "concurrent-player-vote-resolve-race",
    "concurrent-player-vote-resolve-race-reload",
    "concurrent-player-action-advance-race",
    "concurrent-player-action-advance-race-reload",
    "concurrent-cohost-deadline-resolve-race",
    "concurrent-cohost-deadline-resolve-race-reload",
    "concurrent-replacement-private-post-race",
    "concurrent-replacement-private-post-race-reload",
    "concurrent-replacement-vote-race",
    "concurrent-replacement-vote-race-reload",
    "concurrent-replacement-action-race",
    "concurrent-replacement-action-race-reload",
    "replacement-incoming-action",
    "replacement-action-reconnect",
    "replacement-stale-action-after-resolve",
    "replacement-stale-private-post-after-resolve",
    "replacement-stale-private-post-reconnect",
    "replacement-stale-private-post-after-complete",
    "replacement-stale-private-post-after-complete-reload",
    "concurrent-host-publish-race",
    "concurrent-host-publish-race-reload",
    "stale-host-publish",
    "stale-host-lifecycle",
    "stale-host-modkill",
    "concurrent-host-lifecycle-race",
    "concurrent-host-lifecycle-race-reload",
    "stale-host-prompt",
    "stale-host-prompt-reload",
    "stale-host-complete",
    "stale-host-complete-reload",
    "concurrent-host-complete-race",
    "concurrent-host-complete-race-reload",
    "concurrent-player-complete-race",
    "public-player-complete-reload",
    "stale-player-complete",
    "stale-player-complete-reload",
    "stale-same-action-recovery",
    "stale-dead-action-conflict",
    "stale-action-conflict",
    "stale-action-conflict-message",
    "stale-host-control",
    "concurrent-host-resolve-race",
    "concurrent-host-resolve-race-reload",
    "concurrent-host-advance-race",
    "concurrent-host-advance-race-reload",
    "concurrent-host-deadline-advance-race",
    "concurrent-host-deadline-advance-race-reload",
    "concurrent-host-mixed-advance-race",
    "concurrent-host-mixed-advance-race-reload",
    "stale-host-resolve",
    "stale-host-resolve-reload",
    "stale-host-advance",
    "stale-host-advance-reload",
    "stale-host-deadline",
    "stale-host-deadline-reload",
    "stale-cohost-deadline",
    "stale-cohost-deadline-reload",
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

export function validateDevTestGameSeedFixtureSummary(summary, options = {}) {
  const requiredChecks = [
    "role-entrypoints-redacted",
    "seed-slots-enumerated",
    "demo-scenarios-mapped",
    "proof-lanes-carried",
    "release-boundary-carried",
  ];
  const requiredScenarios = [
    "host-phase-controls",
    "cohost-deadline-control",
    "player-vote-recovery",
    "player-action-denied",
    "invalid-action-recovery",
    "resolution-receipt",
    "dead-player-recovery",
    "night-action-loop",
    "host-replacement-console",
    "replacement-host-issued-invite",
    "replacement-pending-player",
    "replacement-redeemed-invite-recovery",
    "replacement-session-revocation-recovery",
    "replacement-session-refresh-recovery",
    "replacement-stale-session-after-refresh",
    "replacement-reconnect-recovery",
    "replacement-stale-conflict-message",
    "replacement-invalid-target-recovery",
    "replacement-idempotent-retry",
    "stale-host-invite-recovery",
    "replacement-stale-success-recovery",
    "replacement-stale-player",
    "replacement-stale-action",
    "replacement-stale-private-channel",
    "replacement-stale-private-receipts",
    "replacement-incoming-player",
    "action-idempotent-retry",
    "concurrent-action-race",
    "concurrent-action-race-reload",
    "concurrent-player-vote-resolve-race",
    "concurrent-player-vote-resolve-race-reload",
    "concurrent-player-action-advance-race",
    "concurrent-player-action-advance-race-reload",
    "concurrent-cohost-deadline-resolve-race",
    "concurrent-cohost-deadline-resolve-race-reload",
    "concurrent-replacement-private-post-race",
    "concurrent-replacement-private-post-race-reload",
    "concurrent-replacement-vote-race",
    "concurrent-replacement-vote-race-reload",
    "concurrent-replacement-action-race",
    "concurrent-replacement-action-race-reload",
    "replacement-incoming-action",
    "replacement-action-reconnect",
    "replacement-stale-action-after-resolve",
    "replacement-stale-private-post-after-resolve",
    "replacement-stale-private-post-reconnect",
    "replacement-stale-private-post-after-complete",
    "replacement-stale-private-post-after-complete-reload",
    "concurrent-host-resolve-race",
    "concurrent-host-resolve-race-reload",
    "concurrent-host-advance-race",
    "concurrent-host-advance-race-reload",
    "concurrent-host-deadline-advance-race",
    "concurrent-host-deadline-advance-race-reload",
    "concurrent-host-lifecycle-race",
    "concurrent-host-lifecycle-race-reload",
    "concurrent-host-complete-race",
    "concurrent-host-complete-race-reload",
    "concurrent-player-complete-race",
    "public-player-complete-reload",
    "concurrent-host-mixed-advance-race",
    "concurrent-host-mixed-advance-race-reload",
    "stale-same-action-recovery",
    "stale-action-conflict-message",
    "stale-dead-action-conflict",
    "private-channel-member",
    "private-channel-denied",
    "multiplayer-hardening",
    "local-ops-readiness",
  ];
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
    proofBoundary: summary.proofBoundary,
    scope: summary.scope,
    productionReady: summary.productionReady,
    ...(options.artifact === undefined ? {} : { artifact: options.artifact }),
  };
}

export function validateDevTestGameSeedAdminProof(proof, options = {}) {
  const requiredScenarios = [
    "host-phase-controls",
    "cohost-deadline-control",
    "player-vote-recovery",
    "player-action-denied",
    "invalid-action-recovery",
    "resolution-receipt",
    "dead-player-recovery",
    "night-action-loop",
    "host-replacement-console",
    "replacement-host-issued-invite",
    "replacement-pending-player",
    "replacement-redeemed-invite-recovery",
    "replacement-session-revocation-recovery",
    "replacement-session-refresh-recovery",
    "replacement-stale-session-after-refresh",
    "replacement-reconnect-recovery",
    "replacement-stale-conflict-message",
    "replacement-invalid-target-recovery",
    "replacement-idempotent-retry",
    "stale-host-invite-recovery",
    "replacement-stale-success-recovery",
    "replacement-stale-player",
    "replacement-stale-action",
    "replacement-stale-private-channel",
    "replacement-stale-private-receipts",
    "replacement-incoming-player",
    "action-idempotent-retry",
    "concurrent-action-race",
    "concurrent-action-race-reload",
    "concurrent-player-vote-resolve-race",
    "concurrent-player-vote-resolve-race-reload",
    "concurrent-player-action-advance-race",
    "concurrent-player-action-advance-race-reload",
    "concurrent-cohost-deadline-resolve-race",
    "concurrent-cohost-deadline-resolve-race-reload",
    "concurrent-replacement-private-post-race",
    "concurrent-replacement-private-post-race-reload",
    "concurrent-replacement-vote-race",
    "concurrent-replacement-vote-race-reload",
    "concurrent-replacement-action-race",
    "concurrent-replacement-action-race-reload",
    "replacement-incoming-action",
    "replacement-action-reconnect",
    "replacement-stale-action-after-resolve",
    "replacement-stale-private-post-after-resolve",
    "replacement-stale-private-post-reconnect",
    "replacement-stale-private-post-after-complete",
    "replacement-stale-private-post-after-complete-reload",
    "concurrent-host-resolve-race",
    "concurrent-host-resolve-race-reload",
    "concurrent-host-advance-race",
    "concurrent-host-advance-race-reload",
    "concurrent-host-deadline-advance-race",
    "concurrent-host-deadline-advance-race-reload",
    "concurrent-host-lifecycle-race",
    "concurrent-host-lifecycle-race-reload",
    "concurrent-host-complete-race",
    "concurrent-host-complete-race-reload",
    "concurrent-player-complete-race",
    "public-player-complete-reload",
    "concurrent-host-mixed-advance-race",
    "concurrent-host-mixed-advance-race-reload",
    "stale-same-action-recovery",
    "stale-action-conflict-message",
    "stale-dead-action-conflict",
    "private-channel-member",
    "private-channel-denied",
    "multiplayer-hardening",
    "local-ops-readiness",
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
  return {
    status: "passed",
    path: options.path ?? "target/dev-test-game/seed-admin-proof.json",
    proofBoundary: proof.proofBoundary,
    overviewRoleUrl: proof.adminRoleSurface.overviewRoleUrl,
    detailRoleUrl: proof.adminRoleSurface.detailRoleUrl,
    visibleScenarios: proof.adminRoleSurface.visibleScenarios,
    ...(options.artifact === undefined ? {} : { artifact: options.artifact }),
  };
}

export function validateDevTestGameIdentityAdapterProof(proof, options = {}) {
  const requiredRoles = new Map([
    ["admin", "GlobalAdmin"],
    ["host", "HostOf"],
    ["player", "SlotOccupant"],
  ]);
  if (proof?.version !== 7) {
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
    proof.identityAdapter?.sessionCredentialKind !== "opaque-session" ||
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
    proof.identityLifecycle?.auditTrail?.status !== "passed" ||
    proof.identityLifecycle?.auditTrail?.rawTokensStored !== false ||
    !proof.identityLifecycle?.auditTrail?.eventKinds?.includes("session_rotated") ||
    !proof.identityLifecycle?.auditTrail?.eventKinds?.includes("session_revoked") ||
    !proof.identityLifecycle?.auditTrail?.eventKinds?.includes("invite_revoked") ||
    proof.identityLifecycle?.adminAuditSurface?.status !== "passed" ||
    proof.identityLifecycle?.adminAuditSurface?.clickedThroughFromOverview !== true ||
    proof.identityLifecycle?.adminAuditSurface?.rawTokensVisible !== false ||
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

export function validateDevTestGameReleaseAdminProof(proof, options = {}) {
  const requiredChecks = [
    "local-role-url-browser-proof",
    "local-core-loop-proof",
    "local-hardening-proof",
  ];
  const requiredUnproven = ["hosted-deployment", "human-release-runbook"];
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
    "backup",
    "ops",
    "seed",
    "release",
    "race-coverage",
    "hosted-concurrent-race-matrix",
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
    "race-coverage",
    "hosted-concurrent-race-matrix",
    "spine-manifest",
    "recovery",
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
  if (checklist.localDevelopmentSpine?.status !== "passed") {
    throw new Error("dev-test-game local development spine did not pass");
  }
  for (const check of checklist.localDevelopmentSpine?.checks ?? []) {
    if (check.status !== "passed") {
      throw new Error(`dev-test-game local check ${check.id} did not pass`);
    }
  }
  if (checklist.releaseReadiness?.status !== "not_ready") {
    throw new Error("dev-test-game release readiness must remain not_ready");
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
  const proofGraphHandoffCheck = checklist.localDevelopmentSpine?.checks?.find(
    (check) => check.id === "local-proof-graph-admin-role-handoffs",
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
    opsAdminProofOptions,
    seedAdminProofOptions,
    spineManifestOptions,
    spineManifestAdminProofOptions,
    adminSpineProofOptions,
    adminSpineAdminProofOptions,
    raceCoverageOptions,
    raceCoverageAdminProofOptions,
    hostedConcurrentRaceMatrixAdminProofOptions,
    proofGraphAdminProofOptions,
  ] = await Promise.all([
    readOptionalCoreLoopAdminProof(),
    readOptionalHardeningAdminProof(),
    readOptionalBackupRestoreArtifacts(),
    readOptionalBackupAdminProof(),
    readOptionalOpsArtifacts(),
    readOptionalSeedFixtureSummary(),
    readOptionalIdentityAdapterProof(),
    readOptionalIdentityAdminProof(),
    readOptionalOpsAdminProof(),
    readOptionalSeedAdminProof(),
    readOptionalSpineManifest(),
    readOptionalSpineManifestAdminProof(),
    readOptionalAdminSpineProof(),
    readOptionalAdminSpineAdminProof(),
    readOptionalRaceCoverage(),
    readOptionalRaceCoverageAdminProof(),
    readOptionalHostedConcurrentRaceMatrixAdminProof(),
    readOptionalProofGraphAdminProof(),
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
    ...(opsAdminProofOptions ?? {}),
    ...(seedAdminProofOptions ?? {}),
    ...(spineManifestOptions ?? {}),
    ...(spineManifestAdminProofOptions ?? {}),
    ...(adminSpineProofOptions ?? {}),
    ...(adminSpineAdminProofOptions ?? {}),
    ...(raceCoverageOptions ?? {}),
    ...(raceCoverageAdminProofOptions ?? {}),
    ...(hostedConcurrentRaceMatrixAdminProofOptions ?? {}),
    ...(proofGraphAdminProofOptions ?? {}),
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
  if (override === undefined || override.trim() === "") {
    return undefined;
  }
  const now = new Date();
  const proofPath = resolveArtifactPath(override, defaultCoreLoopAdminProofPath);
  const artifact = await readFreshArtifactMetadata(proofPath, now);
  return {
    coreLoopAdminProof: JSON.parse(await readFile(proofPath, "utf8")),
    coreLoopAdminProofPath: path.relative(repoRoot, proofPath),
    coreLoopAdminProofArtifact: artifact,
  };
}

async function readOptionalHardeningAdminProof() {
  const override = process.env.FMARCH_DEV_TEST_GAME_HARDENING_ADMIN_PROOF;
  if (override === undefined || override.trim() === "") {
    return undefined;
  }
  const now = new Date();
  const proofPath = resolveArtifactPath(override, defaultHardeningAdminProofPath);
  const artifact = await readFreshArtifactMetadata(proofPath, now);
  return {
    hardeningAdminProof: JSON.parse(await readFile(proofPath, "utf8")),
    hardeningAdminProofPath: path.relative(repoRoot, proofPath),
    hardeningAdminProofArtifact: artifact,
  };
}

async function readOptionalOpsArtifacts() {
  const override = process.env.FMARCH_DEV_TEST_GAME_OPS_ARTIFACTS;
  if (override === undefined || override.trim() === "") {
    return undefined;
  }
  const now = new Date();
  const opsPath = resolveArtifactPath(override, defaultOpsArtifactsPath);
  const artifact = await readFreshArtifactMetadata(opsPath, now);
  return {
    opsArtifacts: JSON.parse(await readFile(opsPath, "utf8")),
    opsArtifactsPath: path.relative(repoRoot, opsPath),
    opsArtifactsArtifact: artifact,
  };
}

async function readOptionalBackupAdminProof() {
  const override = process.env.FMARCH_DEV_TEST_GAME_BACKUP_ADMIN_PROOF;
  if (override === undefined || override.trim() === "") {
    return undefined;
  }
  const now = new Date();
  const proofPath = resolveArtifactPath(override, defaultBackupAdminProofPath);
  const artifact = await readFreshArtifactMetadata(proofPath, now);
  return {
    backupAdminProof: JSON.parse(await readFile(proofPath, "utf8")),
    backupAdminProofPath: path.relative(repoRoot, proofPath),
    backupAdminProofArtifact: artifact,
  };
}

async function readOptionalOpsAdminProof() {
  const override = process.env.FMARCH_DEV_TEST_GAME_OPS_ADMIN_PROOF;
  if (override === undefined || override.trim() === "") {
    return undefined;
  }
  const now = new Date();
  const proofPath = resolveArtifactPath(override, defaultOpsAdminProofPath);
  const artifact = await readFreshArtifactMetadata(proofPath, now);
  return {
    opsAdminProof: JSON.parse(await readFile(proofPath, "utf8")),
    opsAdminProofPath: path.relative(repoRoot, proofPath),
    opsAdminProofArtifact: artifact,
  };
}

async function readOptionalSeedAdminProof() {
  const override = process.env.FMARCH_DEV_TEST_GAME_SEED_ADMIN_PROOF;
  if (override === undefined || override.trim() === "") {
    return undefined;
  }
  const now = new Date();
  const proofPath = resolveArtifactPath(override, defaultSeedAdminProofPath);
  const artifact = await readFreshArtifactMetadata(proofPath, now);
  return {
    seedAdminProof: JSON.parse(await readFile(proofPath, "utf8")),
    seedAdminProofPath: path.relative(repoRoot, proofPath),
    seedAdminProofArtifact: artifact,
  };
}

async function readOptionalSeedFixtureSummary() {
  const override = process.env.FMARCH_DEV_TEST_GAME_SEED_FIXTURE_SUMMARY;
  if (override === undefined || override.trim() === "") {
    return undefined;
  }
  const now = new Date();
  const fixturePath = resolveArtifactPath(override, defaultSeedFixtureSummaryPath);
  const artifact = await readFreshArtifactMetadata(fixturePath, now);
  return {
    seedFixtureSummary: JSON.parse(await readFile(fixturePath, "utf8")),
    seedFixtureSummaryPath: path.relative(repoRoot, fixturePath),
    seedFixtureSummaryArtifact: artifact,
  };
}

async function readOptionalIdentityAdapterProof() {
  const override = process.env.FMARCH_DEV_TEST_GAME_IDENTITY_ADAPTER_PROOF;
  if (override === undefined || override.trim() === "") {
    return undefined;
  }
  const now = new Date();
  const proofPath = resolveArtifactPath(override, defaultIdentityAdapterProofPath);
  const artifact = await readFreshArtifactMetadata(proofPath, now);
  return {
    identityAdapterProof: JSON.parse(await readFile(proofPath, "utf8")),
    identityAdapterProofPath: path.relative(repoRoot, proofPath),
    identityAdapterProofArtifact: artifact,
  };
}

async function readOptionalIdentityAdminProof() {
  const override = process.env.FMARCH_DEV_TEST_GAME_IDENTITY_ADMIN_PROOF;
  if (override === undefined || override.trim() === "") {
    return undefined;
  }
  const now = new Date();
  const proofPath = resolveArtifactPath(override, defaultIdentityAdminProofPath);
  const artifact = await readFreshArtifactMetadata(proofPath, now);
  return {
    identityAdminProof: JSON.parse(await readFile(proofPath, "utf8")),
    identityAdminProofPath: path.relative(repoRoot, proofPath),
    identityAdminProofArtifact: artifact,
  };
}

async function readOptionalSpineManifest() {
  const override = process.env.FMARCH_DEV_TEST_GAME_SPINE_MANIFEST;
  if (override === undefined || override.trim() === "") {
    return undefined;
  }
  const now = new Date();
  const manifestPath = resolveArtifactPath(override, defaultSpineManifestPath);
  const artifact = await readFreshArtifactMetadata(manifestPath, now);
  return {
    spineManifest: JSON.parse(await readFile(manifestPath, "utf8")),
    spineManifestPath: path.relative(repoRoot, manifestPath),
    spineManifestArtifact: artifact,
  };
}

async function readOptionalSpineManifestAdminProof() {
  const override = process.env.FMARCH_DEV_TEST_GAME_SPINE_MANIFEST_ADMIN_PROOF;
  if (override === undefined || override.trim() === "") {
    return undefined;
  }
  const now = new Date();
  const proofPath = resolveArtifactPath(
    override,
    defaultSpineManifestAdminProofPath,
  );
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
  if ((proofOverride === undefined) !== (dumpOverride === undefined)) {
    throw new Error(
      "FMARCH_DEV_TEST_GAME_BACKUP_RESTORE_PROOF and FMARCH_DEV_TEST_GAME_BACKUP_RESTORE_DUMP must be set together",
    );
  }
  if (proofOverride === undefined) {
    return undefined;
  }
  const now = new Date();
  const proofPath = resolveArtifactPath(proofOverride, defaultBackupRestoreProofPath);
  const dumpPath = resolveArtifactPath(dumpOverride, defaultBackupRestoreDumpPath);
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
  if (override === undefined || override.trim() === "") {
    return undefined;
  }
  const now = new Date();
  const proofPath = resolveArtifactPath(override, defaultAdminSpineProofPath);
  const artifact = await readFreshArtifactMetadata(proofPath, now);
  return {
    adminSpineProof: JSON.parse(await readFile(proofPath, "utf8")),
    adminSpineProofPath: path.relative(repoRoot, proofPath),
    adminSpineProofArtifact: artifact,
  };
}

async function readOptionalAdminSpineAdminProof() {
  const override = process.env.FMARCH_DEV_TEST_GAME_ADMIN_SPINE_ADMIN_PROOF;
  if (override === undefined || override.trim() === "") {
    return undefined;
  }
  const now = new Date();
  const proofPath = resolveArtifactPath(override, defaultAdminSpineAdminProofPath);
  const artifact = await readFreshArtifactMetadata(proofPath, now);
  return {
    adminSpineAdminProof: JSON.parse(await readFile(proofPath, "utf8")),
    adminSpineAdminProofPath: path.relative(repoRoot, proofPath),
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
