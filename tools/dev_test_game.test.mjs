import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { test } from "node:test";
import {
  buildSessionCard,
  createTokenSet,
  markdownSessionCard,
  parseArgs,
  seedCommandPlanForGame,
  selectGame,
} from "./dev_test_game.mjs";
import {
  assertDevTestGameProofRun,
  buildDevTestGameProofRun,
} from "./dev_test_game_proof_contract.mjs";
import {
  assertDevTestGameReleaseReadiness,
  buildDevTestGameReleaseReadiness,
} from "./dev_test_game_release_readiness.mjs";
import {
  assertDevTestGameOpsArtifacts,
  buildDevTestGameOpsArtifacts,
} from "./dev_test_game_ops_artifacts.mjs";
import {
  assertDevTestGameHostedOpsSignals,
  buildDevTestGameHostedOpsSignals,
  devTestGameHostedOpsSignalsCommand,
  devTestGameHostedOpsSignalsPath,
} from "./dev_test_game_hosted_ops_signals.mjs";
import {
  assertDevTestGameSeedFixtureSummary,
  buildDevTestGameSeedFixtureSummary,
} from "./dev_test_game_seed_fixture_summary.mjs";
import { adminSpineReadinessEvidenceEnv } from "./dev_test_game_admin_spine.mjs";
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
import { devTestGameLiveSpinePlan } from "./dev_test_game_live_spine.mjs";
import {
  assertDevTestGameSpineManifest,
  buildDevTestGameSpineManifest,
  nextActionAdminProofCommand,
  nextActionAdminProofPath,
  nextActionCommand,
  nextActionPath,
  proofFreshnessAdminProofCommand,
  proofFreshnessAdminProofPath,
} from "./dev_test_game_spine_manifest.mjs";
import {
  assertDevTestGameNextAction,
  buildDevTestGameNextAction,
  devTestGameLiveProofCommand,
} from "./dev_test_game_next_action.mjs";
import {
  assertDevTestGameProofGraph,
  assertDevTestGameProofGraphCoversAdminSpine,
  buildDevTestGameProofGraph,
  devTestGameProofGraphAdminProofCommand,
  devTestGameProofGraphAdminProofPath,
  devTestGameProofGraphCommand,
  devTestGameProofGraphPath,
} from "./dev_test_game_proof_graph.mjs";
import {
  assertDevTestGameRaceCoverage,
  buildDevTestGameRaceCoverage,
  devTestGameRaceCoverageCommand,
  devTestGameRaceCoveragePath,
} from "./dev_test_game_race_coverage.mjs";
import {
  assertDevTestGameHostedConcurrentRaceMatrixEvidence,
  buildDevTestGameHostedConcurrentRaceMatrixEvidence,
  devTestGameHostedConcurrentRaceMatrixCommand,
  devTestGameHostedConcurrentRaceMatrixPath,
} from "./dev_test_game_hosted_concurrent_race_matrix.mjs";
import {
  assertDevTestGameHostedMatrixExternalEvidence,
  buildDevTestGameHostedMatrixExternalEvidence,
  devTestGameHostedMatrixExternalEvidenceCommand,
  devTestGameHostedMatrixExternalEvidencePath,
} from "./dev_test_game_hosted_matrix_external_evidence.mjs";
import {
  assertDevTestGameHostedEvidenceLane,
  devTestGameHostedEvidenceLaneCommand,
  devTestGameHostedEvidenceLanePath,
  runDevTestGameHostedEvidenceLane,
} from "./dev_test_game_hosted_evidence_lane.mjs";
import {
  assertDevTestGameHostedEvidenceLaneDemoProof,
  devTestGameHostedEvidenceLaneDemoBlockedPath,
  devTestGameHostedEvidenceLaneDemoExternalEvidencePath,
  devTestGameHostedEvidenceLaneDemoPassedPath,
  devTestGameHostedEvidenceLaneDemoProofCommand,
  devTestGameHostedEvidenceLaneDemoProofPath,
  devTestGameHostedEvidenceLaneDemoRawEvidencePath,
  runDevTestGameHostedEvidenceLaneDemoProof,
} from "./dev_test_game_hosted_evidence_lane_demo_proof.mjs";
import {
  assertDevTestGameHostedMatrixRawEvidence,
  buildDevTestGameHostedMatrixRawEvidence,
  devTestGameHostedMatrixRawEvidenceCommand,
  devTestGameHostedMatrixRawEvidencePath,
} from "./dev_test_game_hosted_matrix_raw_evidence.mjs";
import {
  assertDevTestGameHostedTargetPreflight,
  devTestGameHostedTargetPreflightCommand,
  devTestGameHostedTargetPreflightPath,
} from "./dev_test_game_hosted_target_preflight.mjs";
import {
  devTestGameReleaseRunbookCommand,
  devTestGameReleaseRunbookPath,
} from "./dev_test_game_release_runbook.mjs";
import { devTestGameAdminSpineProofPlan } from "./dev_test_game_admin_spine_proof.mjs";

test("dev test-game args expose reset reuse naming and verification controls", () => {
  assert.deepEqual(
    parseArgs([
      "--name",
      "morning",
      "--reset",
      "--api-port",
      "4101",
      "--api-startup-timeout-ms",
      "900000",
      "--frontend-port",
      "4102",
      "--verify",
      "--no-keepalive",
    ]),
    {
      name: "morning",
      reset: true,
      apiPort: 4101,
      apiStartupTimeoutMs: 900000,
      frontendPort: 4102,
      verify: true,
      noKeepalive: true,
    },
  );

  assert.throws(() => parseArgs(["--frontend-port", "nope"]), /positive integer/);
});

test("dev test-game spine orchestrators expose stable proof order and env maps", () => {
  assert.deepEqual(
    devTestGameBackupRestoreSpinePlan.map((step) => step.script),
    [
      "tools/live_stack_backup_restore_drill.mjs",
      "tools/dev_test_game_release_readiness.mjs",
      "tools/dev_test_game_ops_artifacts.mjs",
      "tools/dev_test_game_release_readiness.mjs",
      "tools/dev_test_game_seed_fixture_summary.mjs",
      "tools/dev_test_game_seed_admin_proof.mjs",
      "tools/dev_test_game_release_readiness.mjs",
      "tools/dev_test_game_backup_admin_proof.mjs",
      "tools/dev_test_game_release_readiness.mjs",
    ],
  );
  assert.deepEqual(backupRestoreEvidenceEnv, {
    FMARCH_DEV_TEST_GAME_BACKUP_RESTORE_PROOF:
      "target/live-stack-backup-restore-drill/local-backup-restore-proof.json",
    FMARCH_DEV_TEST_GAME_BACKUP_RESTORE_DUMP:
      "target/live-stack-backup-restore-drill/local-live-stack.dump",
  });
  assert.deepEqual(backupAwareOpsEnv, {
    FMARCH_DEV_TEST_GAME_OPS_BACKUP_RESTORE_PROOF:
      "target/live-stack-backup-restore-drill/local-backup-restore-proof.json",
    FMARCH_DEV_TEST_GAME_OPS_BACKUP_RESTORE_DUMP:
      "target/live-stack-backup-restore-drill/local-live-stack.dump",
  });
  assert.deepEqual(opsReadinessEnv, {
    ...backupRestoreEvidenceEnv,
    FMARCH_DEV_TEST_GAME_OPS_ARTIFACTS: "target/dev-test-game/ops-artifacts.json",
  });
  assert.deepEqual(seedReadinessEnv, {
    FMARCH_DEV_TEST_GAME_SEED_FIXTURE_SUMMARY:
      "target/dev-test-game/seed-fixture-summary.json",
    FMARCH_DEV_TEST_GAME_SEED_ADMIN_PROOF:
      "target/dev-test-game/seed-admin-proof.json",
  });
  assert.deepEqual(backupRestoreFinalReadinessEnv, {
    ...backupRestoreEvidenceEnv,
    FMARCH_DEV_TEST_GAME_BACKUP_ADMIN_PROOF:
      "target/dev-test-game/backup-admin-proof.json",
    FMARCH_DEV_TEST_GAME_OPS_ARTIFACTS: "target/dev-test-game/ops-artifacts.json",
    FMARCH_DEV_TEST_GAME_SEED_FIXTURE_SUMMARY:
      "target/dev-test-game/seed-fixture-summary.json",
    FMARCH_DEV_TEST_GAME_SEED_ADMIN_PROOF:
      "target/dev-test-game/seed-admin-proof.json",
  });
  assert.deepEqual(
    devTestGameIdentitySpinePlan.map((step) => step.script),
    [
      "tools/auth_invite_role_proof.mjs",
      "tools/dev_test_game_identity_admin_proof.mjs",
      "tools/dev_test_game_release_readiness.mjs",
    ],
  );
  assert.deepEqual(identityReadinessEnv, {
    FMARCH_DEV_TEST_GAME_OPS_ARTIFACTS: "target/dev-test-game/ops-artifacts.json",
    FMARCH_DEV_TEST_GAME_SEED_FIXTURE_SUMMARY:
      "target/dev-test-game/seed-fixture-summary.json",
    FMARCH_DEV_TEST_GAME_IDENTITY_ADAPTER_PROOF:
      "target/auth-invite-role-proof/invite-role-proof.json",
    FMARCH_DEV_TEST_GAME_IDENTITY_ADMIN_PROOF:
      "target/dev-test-game/identity-admin-proof.json",
  });
  assert.deepEqual(adminSpineReadinessEvidenceEnv, {
    FMARCH_DEV_TEST_GAME_CORE_LOOP_ADMIN_PROOF:
      "target/dev-test-game/core-loop-admin-proof.json",
    FMARCH_DEV_TEST_GAME_HARDENING_ADMIN_PROOF:
      "target/dev-test-game/hardening-admin-proof.json",
    FMARCH_DEV_TEST_GAME_BACKUP_RESTORE_PROOF:
      "target/live-stack-backup-restore-drill/local-backup-restore-proof.json",
    FMARCH_DEV_TEST_GAME_BACKUP_RESTORE_DUMP:
      "target/live-stack-backup-restore-drill/local-live-stack.dump",
    FMARCH_DEV_TEST_GAME_BACKUP_ADMIN_PROOF:
      "target/dev-test-game/backup-admin-proof.json",
    FMARCH_DEV_TEST_GAME_OPS_ARTIFACTS: "target/dev-test-game/ops-artifacts.json",
    FMARCH_DEV_TEST_GAME_OPS_ADMIN_PROOF:
      "target/dev-test-game/ops-admin-proof.json",
    FMARCH_DEV_TEST_GAME_HOSTED_OPS_SIGNALS:
      "target/dev-test-game/hosted-ops-signals.json",
    FMARCH_DEV_TEST_GAME_HOSTED_OPS_SIGNALS_ADMIN_PROOF:
      "target/dev-test-game/hosted-ops-signals-admin-proof.json",
    FMARCH_DEV_TEST_GAME_SEED_FIXTURE_SUMMARY:
      "target/dev-test-game/seed-fixture-summary.json",
    FMARCH_DEV_TEST_GAME_SEED_ADMIN_PROOF:
      "target/dev-test-game/seed-admin-proof.json",
    FMARCH_DEV_TEST_GAME_RELEASE_RUNBOOK:
      "target/dev-test-game/release-runbook.json",
    FMARCH_DEV_TEST_GAME_RELEASE_RUNBOOK_ADMIN_PROOF:
      "target/dev-test-game/release-runbook-admin-proof.json",
    FMARCH_DEV_TEST_GAME_IDENTITY_ADAPTER_PROOF:
      "target/auth-invite-role-proof/invite-role-proof.json",
    FMARCH_DEV_TEST_GAME_IDENTITY_ADMIN_PROOF:
      "target/dev-test-game/identity-admin-proof.json",
    FMARCH_DEV_TEST_GAME_SPINE_MANIFEST: "target/dev-test-game/spine-manifest.json",
    FMARCH_DEV_TEST_GAME_SPINE_MANIFEST_ADMIN_PROOF:
      "target/dev-test-game/spine-manifest-admin-proof.json",
    FMARCH_DEV_TEST_GAME_ADMIN_SPINE_PROOF:
      "target/dev-test-game/admin-spine-proof.json",
    FMARCH_DEV_TEST_GAME_ADMIN_SPINE_ADMIN_PROOF:
      "target/dev-test-game/admin-spine-admin-proof.json",
    FMARCH_DEV_TEST_GAME_RACE_COVERAGE: "target/dev-test-game/race-coverage.json",
    FMARCH_DEV_TEST_GAME_RACE_COVERAGE_ADMIN_PROOF:
      "target/dev-test-game/race-coverage-admin-proof.json",
    FMARCH_DEV_TEST_GAME_HOSTED_CONCURRENT_RACE_MATRIX:
      "target/dev-test-game/hosted-concurrent-race-matrix.json",
    FMARCH_DEV_TEST_GAME_HOSTED_CONCURRENT_RACE_MATRIX_ADMIN_PROOF:
      "target/dev-test-game/hosted-concurrent-race-matrix-admin-proof.json",
    FMARCH_DEV_TEST_GAME_HOSTED_TARGET_PREFLIGHT:
      "target/dev-test-game/hosted-target-preflight.json",
    FMARCH_DEV_TEST_GAME_HOSTED_TARGET_PREFLIGHT_ADMIN_PROOF:
      "target/dev-test-game/hosted-target-preflight-admin-proof.json",
    FMARCH_DEV_TEST_GAME_HOSTED_EVIDENCE_LANE:
      "target/dev-test-game/hosted-evidence-lane.json",
    FMARCH_DEV_TEST_GAME_HOSTED_EVIDENCE_LANE_ADMIN_PROOF:
      "target/dev-test-game/hosted-evidence-lane-admin-proof.json",
    FMARCH_DEV_TEST_GAME_PROOF_GRAPH: "target/dev-test-game/proof-graph.json",
    FMARCH_DEV_TEST_GAME_PROOF_GRAPH_ADMIN_PROOF:
      "target/dev-test-game/proof-graph-admin-proof.json",
    FMARCH_DEV_TEST_GAME_PROOF_FRESHNESS_ADMIN_PROOF:
      "target/dev-test-game/proof-freshness-admin-proof.json",
    FMARCH_DEV_TEST_GAME_NEXT_ACTION_ADMIN_PROOF:
      "target/dev-test-game/next-action-admin-proof.json",
  });
  assert.deepEqual(devTestGameLiveSpinePlan, [
    { kind: "npm", script: "dev:test-game:prebuild" },
    { kind: "node", script: "tools/dev_test_game_live_proof.mjs" },
    { kind: "node", script: "tools/dev_test_game_proof_contract.mjs" },
    { kind: "node", script: "tools/dev_test_game_release_readiness.mjs" },
    { kind: "spine", script: "backup-restore" },
    { kind: "spine", script: "identity" },
    { kind: "spine", script: "admin" },
  ]);
});

test("dev test-game spine manifest records command order and evidence wiring", () => {
  const manifest = buildDevTestGameSpineManifest({
    generatedAt: "2026-06-26T00:00:00.000Z",
    proofFreshness: {
      version: 1,
      proof: "dev-test-game-proof-freshness",
      status: "blocked",
      generatedAt: "2026-06-26T00:00:00.000Z",
      maxAgeHours: 24,
      proofBoundary: "test freshness boundary",
      summary: {
        artifactCount: 2,
        freshCount: 1,
        staleCount: 1,
        missingCount: 0,
      },
      artifacts: [
        {
          id: "core-loop",
          label: "Core loop admin proof",
          path: "target/dev-test-game/core-loop-admin-proof.json",
          status: "stale",
          mtime: "2026-06-25T00:00:00.000Z",
          ageSeconds: 90000,
          maxAgeSeconds: 86400,
        },
        {
          id: "spine-manifest",
          label: "Spine manifest",
          path: "target/dev-test-game/spine-manifest.json",
          status: "fresh",
          mtime: "2026-06-26T00:00:00.000Z",
          ageSeconds: 0,
          maxAgeSeconds: 86400,
        },
      ],
    },
    adminSpineProof: {
      recovery: {
        surfaces: [
          {
            id: "core-loop",
            path: "target/dev-test-game/core-loop-admin-proof.json",
            rerunCommand: "npm run test:dev-test-game-core-loop-admin-proof",
          },
        ],
      },
    },
  });
  assertDevTestGameSpineManifest(manifest);
  assert.equal(manifest.status, "passed");
  assert.equal(manifest.releaseReady, false);
  assert.equal(manifest.productionReady, false);
  assert.deepEqual(manifest.commands.live.plan, devTestGameLiveSpinePlan);
  assert.deepEqual(
    manifest.commands.backupRestore.plan,
    devTestGameBackupRestoreSpinePlan,
  );
  assert.deepEqual(manifest.commands.identity.plan, devTestGameIdentitySpinePlan);
  assert.deepEqual(
    manifest.commands.adminSpine.plan,
    devTestGameAdminSpineProofPlan.map(({ id, label, script, path }) => ({
      id,
      label,
      script,
      path,
    })),
  );
  assert.deepEqual(
    manifest.commands.adminSpine.readinessEnv,
    adminSpineReadinessEvidenceEnv,
  );
  assert.deepEqual(manifest.commands.proofFreshness, {
    script: proofFreshnessAdminProofCommand,
    proofArtifact: proofFreshnessAdminProofPath,
    dependsOn: [
      devTestGameRaceCoveragePath,
      "target/dev-test-game/spine-manifest.json",
      "target/dev-test-game/admin-spine-proof.json",
      "target/dev-test-game/release-readiness-checklist.json",
    ],
  });
  assert.deepEqual(manifest.commands.raceCoverage, {
    script: devTestGameRaceCoverageCommand,
    proofArtifact: devTestGameRaceCoveragePath,
    dependsOn: ["target/dev-test-game/proof-run.json"],
  });
  assert.deepEqual(manifest.commands.hostedConcurrentRaceMatrix, {
    script: devTestGameHostedConcurrentRaceMatrixCommand,
    proofArtifact: devTestGameHostedConcurrentRaceMatrixPath,
    dependsOn: [
      "target/dev-test-game/release-readiness-checklist.json",
      devTestGameRaceCoveragePath,
    ],
  });
  assert.deepEqual(manifest.commands.hostedOpsSignals, {
    script: devTestGameHostedOpsSignalsCommand,
    proofArtifact: devTestGameHostedOpsSignalsPath,
    dependsOn: [
      "target/dev-test-game/ops-artifacts.json",
      "target/dev-test-game/release-readiness-checklist.json",
      devTestGameHostedConcurrentRaceMatrixPath,
    ],
  });
  assert.deepEqual(manifest.commands.hostedTargetPreflight, {
    script: devTestGameHostedTargetPreflightCommand,
    proofArtifact: devTestGameHostedTargetPreflightPath,
    dependsOn: [devTestGameHostedConcurrentRaceMatrixPath],
    roleUrl: "/admin/audit/local-hosted-target-preflight?game=<seeded-game>",
  });
  assert.deepEqual(manifest.commands.hostedEvidenceLane, {
    script: devTestGameHostedEvidenceLaneCommand,
    proofArtifact: devTestGameHostedEvidenceLanePath,
    dependsOn: [
      devTestGameHostedConcurrentRaceMatrixPath,
      devTestGameHostedTargetPreflightPath,
    ],
    roleUrl: "/admin/audit/local-hosted-evidence-lane?game=<seeded-game>",
  });
  assert.deepEqual(manifest.commands.hostedEvidenceLaneDemoProof, {
    script: devTestGameHostedEvidenceLaneDemoProofCommand,
    proofArtifact: devTestGameHostedEvidenceLaneDemoProofPath,
    dependsOn: [devTestGameHostedConcurrentRaceMatrixPath],
    demoOnly: true,
    roleUrl: "/admin/audit/local-hosted-evidence-lane?game=<seeded-game>",
  });
  assert.deepEqual(manifest.commands.releaseRunbook, {
    script: devTestGameReleaseRunbookCommand,
    proofArtifact: devTestGameReleaseRunbookPath,
    dependsOn: ["target/dev-test-game/release-readiness-checklist.json"],
    roleUrl: "/admin/audit/local-release-runbook?game=<seeded-game>",
  });
  assert.deepEqual(manifest.commands.nextAction, {
    script: nextActionCommand,
    proofArtifact: nextActionPath,
    dependsOn: [
      "target/dev-test-game/spine-manifest.json",
      "target/dev-test-game/ops-artifacts.json",
      "target/dev-test-game/release-readiness-checklist.json",
      devTestGameRaceCoveragePath,
      devTestGameHostedConcurrentRaceMatrixPath,
      devTestGameHostedTargetPreflightPath,
      devTestGameHostedEvidenceLanePath,
    ],
  });
  assert.deepEqual(manifest.commands.nextActionAdminProof, {
    script: nextActionAdminProofCommand,
    proofArtifact: nextActionAdminProofPath,
    dependsOn: [
      "target/dev-test-game/next-action.json",
      "target/dev-test-game/proof-run.json",
    ],
    roleUrl: "/admin/audit/local-next-action?game=<seeded-game>",
  });
  assert.deepEqual(manifest.commands.proofGraph, {
    script: devTestGameProofGraphCommand,
    proofArtifact: devTestGameProofGraphPath,
    dependsOn: [
      "target/dev-test-game/spine-manifest.json",
      "target/dev-test-game/admin-spine-proof.json",
    ],
  });
  assert.deepEqual(manifest.commands.proofGraphAdminProof, {
    script: devTestGameProofGraphAdminProofCommand,
    proofArtifact: devTestGameProofGraphAdminProofPath,
    dependsOn: [
      "target/dev-test-game/proof-graph.json",
      "target/dev-test-game/admin-spine-proof.json",
      "target/dev-test-game/proof-run.json",
    ],
    roleUrl: "/admin/audit/local-proof-graph?game=<seeded-game>",
  });
  assert.deepEqual(
    manifest.terminalArtifacts.map((artifact) => ({
      id: artifact.id,
      command: artifact.command,
      path: artifact.path,
      roleUrl: artifact.roleUrl,
    })),
    [
      {
        id: "next-action",
        command: nextActionCommand,
        path: nextActionPath,
        roleUrl: undefined,
      },
      {
        id: "next-action-admin-proof",
        command: nextActionAdminProofCommand,
        path: nextActionAdminProofPath,
        roleUrl: "/admin/audit/local-next-action?game=<seeded-game>",
      },
      {
        id: "proof-graph",
        command: devTestGameProofGraphCommand,
        path: devTestGameProofGraphPath,
        roleUrl: undefined,
      },
      {
        id: "proof-graph-admin-proof",
        command: devTestGameProofGraphAdminProofCommand,
        path: devTestGameProofGraphAdminProofPath,
        roleUrl: "/admin/audit/local-proof-graph?game=<seeded-game>",
      },
    ],
  );
  assert.equal(manifest.artifactFreshness.status, "blocked");
  assert.equal(
    manifest.artifactFreshness.nextCommand,
    "npm run test:dev-test-game-core-loop-admin-proof",
  );
  assert.deepEqual(
    manifest.artifactFreshness.artifacts.map((artifact) => ({
      id: artifact.id,
      status: artifact.status,
      refreshCommand: artifact.refreshCommand,
      refreshSource: artifact.refreshSource,
      nextCommand: artifact.nextCommand,
    })),
    [
      {
        id: "core-loop",
        status: "stale",
        refreshCommand: "npm run test:dev-test-game-core-loop-admin-proof",
        refreshSource: "admin-spine-recovery",
        nextCommand: "npm run test:dev-test-game-core-loop-admin-proof",
      },
      {
        id: "spine-manifest",
        status: "fresh",
        refreshCommand: "npm run test:dev-test-game-spine-manifest",
        refreshSource: "manifest-default",
        nextCommand: undefined,
      },
    ],
  );
  assert.deepEqual(manifest.evidenceEnv.identity.identityReadinessEnv, identityReadinessEnv);
  assert(manifest.artifacts.includes("target/dev-test-game/spine-manifest.json"));
  assert(manifest.artifacts.includes("target/dev-test-game/spine-manifest.md"));
  assert(manifest.artifacts.includes("target/dev-test-game/admin-spine-proof.json"));
  assert(manifest.artifacts.includes(proofFreshnessAdminProofPath));
  assert(manifest.artifacts.includes(devTestGameRaceCoveragePath));
  assert(manifest.artifacts.includes(devTestGameHostedConcurrentRaceMatrixPath));
  assert(manifest.artifacts.includes(devTestGameHostedOpsSignalsPath));
  assert(manifest.artifacts.includes(devTestGameHostedTargetPreflightPath));
  assert(manifest.artifacts.includes(devTestGameHostedEvidenceLanePath));
  assert(manifest.artifacts.includes(devTestGameHostedEvidenceLaneDemoProofPath));
  assert(manifest.artifacts.includes(devTestGameHostedEvidenceLaneDemoRawEvidencePath));
  assert(
    manifest.artifacts.includes(devTestGameHostedEvidenceLaneDemoExternalEvidencePath),
  );
  assert(manifest.artifacts.includes(devTestGameHostedEvidenceLaneDemoBlockedPath));
  assert(manifest.artifacts.includes(devTestGameHostedEvidenceLaneDemoPassedPath));
  assert(manifest.artifacts.includes(devTestGameReleaseRunbookPath));
  assert(manifest.artifacts.includes(nextActionPath));
  assert(manifest.artifacts.includes(nextActionAdminProofPath));
  assert(manifest.artifacts.includes(devTestGameProofGraphPath));
  assert(manifest.artifacts.includes(devTestGameProofGraphAdminProofPath));
  assert(manifest.artifacts.includes("target/dev-test-game/release-admin-proof.json"));
  assert(
    manifest.artifacts.includes(
      "target/dev-test-game/spine-manifest-admin-proof.json",
    ),
  );
  assert(
    manifest.artifacts.includes("target/dev-test-game/admin-spine-admin-proof.json"),
  );
  assert(
    manifest.artifacts.includes(
      "target/live-stack-backup-restore-drill/local-backup-restore-proof.json",
    ),
  );
});

test("dev test-game next-action derives one local recovery command from the manifest", () => {
  const staleManifest = buildDevTestGameSpineManifest({
    generatedAt: "2026-06-26T00:00:00.000Z",
    proofFreshness: {
      version: 1,
      proof: "dev-test-game-proof-freshness",
      status: "blocked",
      generatedAt: "2026-06-26T00:00:00.000Z",
      maxAgeHours: 24,
      proofBoundary: "test freshness boundary",
      summary: {
        artifactCount: 1,
        freshCount: 0,
        staleCount: 1,
        missingCount: 0,
      },
      artifacts: [
        {
          id: "core-loop",
          label: "Core loop admin proof",
          path: "target/dev-test-game/core-loop-admin-proof.json",
          status: "stale",
          mtime: "2026-06-25T00:00:00.000Z",
          ageSeconds: 90000,
          maxAgeSeconds: 86400,
        },
      ],
    },
    adminSpineProof: {
      recovery: {
        surfaces: [
          {
            id: "core-loop",
            path: "target/dev-test-game/core-loop-admin-proof.json",
            rerunCommand: "npm run test:dev-test-game-core-loop-admin-proof",
          },
        ],
      },
    },
  });
  const staleAction = buildDevTestGameNextAction(staleManifest, {
    generatedAt: "2026-06-26T00:00:01.000Z",
  });
  assertDevTestGameNextAction(staleAction);
  assert.deepEqual(staleAction.nextAction, {
    command: "npm run test:dev-test-game-core-loop-admin-proof",
    reason: "artifact-not-fresh",
    status: "blocked",
    artifact: {
      id: "core-loop",
      label: "Core loop admin proof",
      path: "target/dev-test-game/core-loop-admin-proof.json",
      status: "stale",
      refreshSource: "admin-spine-recovery",
    },
  });
  assert.deepEqual(staleAction.selectionTrace, {
    strategy: "development-spine-priority",
    candidateCount: 1,
    selectedArtifactId: "core-loop",
    candidates: [
      {
        rank: 1,
        id: "core-loop",
        label: "Core loop admin proof",
        path: "target/dev-test-game/core-loop-admin-proof.json",
        status: "stale",
        priority: 2,
        selected: true,
        refreshCommand: "npm run test:dev-test-game-core-loop-admin-proof",
        refreshSource: "admin-spine-recovery",
        ageSeconds: 90000,
        maxAgeSeconds: 86400,
      },
    ],
  });

  const freshManifest = buildDevTestGameSpineManifest({
    generatedAt: "2026-06-26T00:00:00.000Z",
    proofFreshness: {
      version: 1,
      proof: "dev-test-game-proof-freshness",
      status: "passed",
      generatedAt: "2026-06-26T00:00:00.000Z",
      maxAgeHours: 24,
      proofBoundary: "test freshness boundary",
      summary: {
        artifactCount: 1,
        freshCount: 1,
        staleCount: 0,
        missingCount: 0,
      },
      artifacts: [
        {
          id: "spine-manifest",
          label: "Spine manifest",
          path: "target/dev-test-game/spine-manifest.json",
          status: "fresh",
          mtime: "2026-06-26T00:00:00.000Z",
          ageSeconds: 0,
          maxAgeSeconds: 86400,
        },
      ],
    },
  });
  const freshAction = buildDevTestGameNextAction(freshManifest, {
    generatedAt: "2026-06-26T00:00:01.000Z",
    opsArtifacts: devTestGameOpsArtifactsFixture(),
    raceCoverage: devTestGameRaceCoverageFixture(),
    releaseReadinessChecklist: devTestGameReleaseReadinessChecklistFixture({
      unproven: [
        {
          id: "hosted-production-identity",
          status: "unproven",
          requiredEvidence: "Hosted account lifecycle",
        },
        {
          id: "hosted-concurrent-race-matrix",
          status: "unproven",
          requiredEvidence:
            "Hosted or hosted-like concurrent command race matrix beyond the promoted local replacement, host, player, cohost deadline, lifecycle, and complete-game reload milestones, including multi-session reload/reconnect recovery and stale-client conflict evidence",
        },
      ],
    }),
  });
  assertDevTestGameNextAction(freshAction);
  assert.deepEqual(freshAction.nextAction, {
    command: "npm run test:dev-test-game-hosted-concurrent-race-matrix",
    reason: "release-readiness-unproven",
    status: "ready",
    unproven: {
      id: "hosted-concurrent-race-matrix",
      status: "unproven",
      requiredEvidence:
        "Hosted or hosted-like concurrent command race matrix beyond the promoted local replacement, host, player, cohost deadline, lifecycle, and complete-game reload milestones, including multi-session reload/reconnect recovery and stale-client conflict evidence",
      buildSlice:
        "Create the first hosted-like concurrent race matrix proof request from the promoted local race baseline.",
      proofTarget: devTestGameHostedConcurrentRaceMatrixPath,
      roleUrl:
        "/admin/audit/local-hosted-concurrent-race-matrix?game=<seeded-game>",
      proofGraphNodeId: "admin-proof:hosted-concurrent-race-matrix",
    },
  });
  assert.deepEqual(freshAction.selectionTrace, {
    strategy: "development-spine-priority",
    candidateCount: 0,
    selectedArtifactId: null,
    candidates: [],
  });
  assert.deepEqual(freshAction.stabilityTrace, {
    strategy: "proof-stability-before-readiness",
    status: "clean",
    hostConfirmClicks: 55,
    retryClickCount: 0,
    domFallbackCount: 0,
    forceFallbackCount: 0,
    failureCount: 0,
    maxAttempts: 1,
    eventCount: 0,
    selected: false,
  });
  assert.deepEqual(freshAction.localReadinessDependencyTrace, {
    strategy: "local-readiness-dependency-before-hosted-work",
    candidateCount: 0,
    selectedCheckId: null,
    candidates: [],
  });
  assert.deepEqual(freshAction.releaseReadinessTrace, {
    strategy: "local-dev-release-readiness-priority",
    candidateCount: 1,
    selectedUnprovenId: "hosted-concurrent-race-matrix",
    candidates: [
      {
        rank: 1,
        id: "hosted-concurrent-race-matrix",
        status: "unproven",
        priority: 5,
        selected: true,
        command: "npm run test:dev-test-game-hosted-concurrent-race-matrix",
        buildSlice:
          "Create the first hosted-like concurrent race matrix proof request from the promoted local race baseline.",
        proofTarget: devTestGameHostedConcurrentRaceMatrixPath,
        roleUrl:
          "/admin/audit/local-hosted-concurrent-race-matrix?game=<seeded-game>",
        proofGraphNodeId: "admin-proof:hosted-concurrent-race-matrix",
        proofBoundary:
          "Machine-readable request artifact only. This can prepare hosted-like concurrent race proof work from the local promoted baseline, but it does not prove hosted deployment, multi-node races, beta readiness, release readiness, or production readiness.",
        requiredEvidence:
          "Hosted or hosted-like concurrent command race matrix beyond the promoted local replacement, host, player, cohost deadline, lifecycle, and complete-game reload milestones, including multi-session reload/reconnect recovery and stale-client conflict evidence",
      },
    ],
  });
  const missingLocalDependencyAction = buildDevTestGameNextAction(freshManifest, {
    generatedAt: "2026-06-26T00:00:01.000Z",
    opsArtifacts: devTestGameOpsArtifactsFixture(),
    raceCoverage: devTestGameRaceCoverageFixture(),
    releaseReadinessChecklist: devTestGameReleaseReadinessChecklistFixture({
      includeProofGraphHandoffCheck: false,
      unproven: [
        {
          id: "hosted-concurrent-race-matrix",
          status: "unproven",
          requiredEvidence: "Hosted concurrent matrix evidence",
        },
      ],
    }),
  });
  assertDevTestGameNextAction(missingLocalDependencyAction);
  assert.deepEqual(missingLocalDependencyAction.nextAction, {
    command: "npm run test:dev-test-game-proof-graph-admin-proof",
    reason: "release-readiness-local-check-missing",
    status: "blocked",
    localCheck: {
      id: "local-proof-graph-admin-role-handoffs",
      status: "missing",
      requiredEvidence:
        "Passed proof graph admin role-handoff check in the generated release-readiness checklist",
      buildSlice:
        "Refresh the proof graph admin role-handoff browser proof before choosing hosted readiness work.",
      proofTarget: "target/dev-test-game/proof-graph-admin-proof.json",
      roleUrl: "/admin/audit/local-proof-graph?game=<seeded-game>",
    },
  });
  assert.deepEqual(missingLocalDependencyAction.localReadinessDependencyTrace, {
    strategy: "local-readiness-dependency-before-hosted-work",
    candidateCount: 1,
    selectedCheckId: "local-proof-graph-admin-role-handoffs",
    candidates: [
      {
        rank: 1,
        id: "local-proof-graph-admin-role-handoffs",
        status: "missing",
        priority: 0,
        selected: true,
        command: "npm run test:dev-test-game-proof-graph-admin-proof",
        buildSlice:
          "Refresh the proof graph admin role-handoff browser proof before choosing hosted readiness work.",
        proofTarget: "target/dev-test-game/proof-graph-admin-proof.json",
        roleUrl: "/admin/audit/local-proof-graph?game=<seeded-game>",
        proofBoundary:
          "Local browser proof that the proof graph admin surface follows every mapped admin-proof role URL. This recovers a local readiness dependency only; it does not prove hosted deployment, release readiness, or production readiness.",
        requiredEvidence:
          "Passed proof graph admin role-handoff check in the generated release-readiness checklist",
      },
    ],
  });
  const missingNextActionAdminDependencyAction = buildDevTestGameNextAction(
    freshManifest,
    {
      generatedAt: "2026-06-26T00:00:01.000Z",
      opsArtifacts: devTestGameOpsArtifactsFixture(),
      raceCoverage: devTestGameRaceCoverageFixture(),
      releaseReadinessChecklist: devTestGameReleaseReadinessChecklistFixture({
        includeProofFreshnessAdminCheck: false,
        includeNextActionAdminCheck: false,
        unproven: [
          {
            id: "hosted-concurrent-race-matrix",
            status: "unproven",
            requiredEvidence: "Hosted concurrent matrix evidence",
          },
        ],
      }),
    },
  );
  assertDevTestGameNextAction(missingNextActionAdminDependencyAction);
  assert.deepEqual(missingNextActionAdminDependencyAction.nextAction, {
    command: "npm run test:dev-test-game-proof-freshness-admin-proof",
    reason: "release-readiness-local-check-missing",
    status: "blocked",
    localCheck: {
      id: "local-proof-freshness-admin-surface",
      status: "missing",
      requiredEvidence:
        "Passed proof-freshness admin surface check in the generated release-readiness checklist",
      buildSlice:
        "Refresh the proof-freshness admin browser proof before hosted readiness work can be selected.",
      proofTarget: "target/dev-test-game/proof-freshness-admin-proof.json",
      roleUrl: "/admin/audit/local-proof-freshness?game=<seeded-game>",
    },
  });
  assert.deepEqual(
    missingNextActionAdminDependencyAction.localReadinessDependencyTrace,
    {
      strategy: "local-readiness-dependency-before-hosted-work",
      candidateCount: 2,
      selectedCheckId: "local-proof-freshness-admin-surface",
      candidates: [
        {
          rank: 1,
          id: "local-proof-freshness-admin-surface",
          status: "missing",
          priority: 1,
          selected: true,
          command: "npm run test:dev-test-game-proof-freshness-admin-proof",
          buildSlice:
            "Refresh the proof-freshness admin browser proof before hosted readiness work can be selected.",
          proofTarget: "target/dev-test-game/proof-freshness-admin-proof.json",
          roleUrl: "/admin/audit/local-proof-freshness?game=<seeded-game>",
          proofBoundary:
            "Local browser proof that the proof-freshness admin surface exposes fresh generated artifacts and the next-action handoff from the seeded admin audit route. This recovers a local readiness dependency only; it does not validate artifact contents, hosted deployment, release readiness, or production readiness.",
          requiredEvidence:
            "Passed proof-freshness admin surface check in the generated release-readiness checklist",
        },
        {
          rank: 2,
          id: "local-next-action-admin-surface",
          status: "missing",
          priority: 2,
          selected: false,
          command: "npm run test:dev-test-game-next-action-admin-proof",
          buildSlice:
            "Refresh the next-action admin browser proof before hosted readiness work can be selected.",
          proofTarget: "target/dev-test-game/next-action-admin-proof.json",
          roleUrl: "/admin/audit/local-next-action?game=<seeded-game>",
          proofBoundary:
            "Local browser proof that the next-action admin surface exposes the selected command, local readiness dependency trace, release-readiness trace, and role URL handoffs from the seeded admin audit route. This recovers a local readiness dependency only; it does not prove hosted deployment, release readiness, or production readiness.",
          requiredEvidence:
            "Passed next-action admin surface check in the generated release-readiness checklist",
        },
      ],
    },
  );
  const missingOnlyNextActionAdminDependencyAction = buildDevTestGameNextAction(
    freshManifest,
    {
      generatedAt: "2026-06-26T00:00:01.000Z",
      opsArtifacts: devTestGameOpsArtifactsFixture(),
      raceCoverage: devTestGameRaceCoverageFixture(),
      releaseReadinessChecklist: devTestGameReleaseReadinessChecklistFixture({
        includeNextActionAdminCheck: false,
        unproven: [
          {
            id: "hosted-concurrent-race-matrix",
            status: "unproven",
            requiredEvidence: "Hosted concurrent matrix evidence",
          },
        ],
      }),
    },
  );
  assertDevTestGameNextAction(missingOnlyNextActionAdminDependencyAction);
  assert.deepEqual(missingOnlyNextActionAdminDependencyAction.nextAction, {
    command: "npm run test:dev-test-game-next-action-admin-proof",
    reason: "release-readiness-local-check-missing",
    status: "blocked",
    localCheck: {
      id: "local-next-action-admin-surface",
      status: "missing",
      requiredEvidence:
        "Passed next-action admin surface check in the generated release-readiness checklist",
      buildSlice:
        "Refresh the next-action admin browser proof before hosted readiness work can be selected.",
      proofTarget: "target/dev-test-game/next-action-admin-proof.json",
      roleUrl: "/admin/audit/local-next-action?game=<seeded-game>",
    },
  });
  assert.deepEqual(
    missingOnlyNextActionAdminDependencyAction.localReadinessDependencyTrace,
    {
      strategy: "local-readiness-dependency-before-hosted-work",
      candidateCount: 1,
      selectedCheckId: "local-next-action-admin-surface",
      candidates: [
        {
          rank: 1,
          id: "local-next-action-admin-surface",
          status: "missing",
          priority: 2,
          selected: true,
          command: "npm run test:dev-test-game-next-action-admin-proof",
          buildSlice:
            "Refresh the next-action admin browser proof before hosted readiness work can be selected.",
          proofTarget: "target/dev-test-game/next-action-admin-proof.json",
          roleUrl: "/admin/audit/local-next-action?game=<seeded-game>",
          proofBoundary:
            "Local browser proof that the next-action admin surface exposes the selected command, local readiness dependency trace, release-readiness trace, and role URL handoffs from the seeded admin audit route. This recovers a local readiness dependency only; it does not prove hosted deployment, release readiness, or production readiness.",
          requiredEvidence:
            "Passed next-action admin surface check in the generated release-readiness checklist",
        },
      ],
    },
  );
  assert.deepEqual(freshAction.replacementRaceReloadTrace, {
    strategy: "replacement-race-reload-before-readiness",
    status: "covered",
    source: devTestGameRaceCoveragePath,
    requiredCellCount: 3,
    coveredCellCount: 3,
    gapCount: 0,
    cells: [
      {
        id: "replacement-private-post",
        raceLaneId: "concurrent-replacement-private-post-race",
        reloadLaneId: "concurrent-replacement-private-post-race-reload",
        reloadStatus: "passed",
        covered: true,
      },
      {
        id: "replacement-vote",
        raceLaneId: "concurrent-replacement-vote-race",
        reloadLaneId: "concurrent-replacement-vote-race-reload",
        reloadStatus: "passed",
        covered: true,
      },
      {
        id: "replacement-action",
        raceLaneId: "concurrent-replacement-action-race",
        reloadLaneId: "concurrent-replacement-action-race-reload",
        reloadStatus: "passed",
        covered: true,
      },
    ],
  });
  assert.deepEqual(freshAction.hostConcurrentRaceReloadTrace, {
    strategy: "host-concurrent-race-reload-before-readiness",
    status: "covered",
    source: devTestGameRaceCoveragePath,
    requiredCellCount: 7,
    coveredCellCount: 7,
    gapCount: 0,
    cells: hostConcurrentRaceReloadCellsFixture(),
  });
  assert.deepEqual(freshAction.playerConcurrentActionReloadTrace, {
    strategy: "player-concurrent-action-reload-before-readiness",
    status: "covered",
    source: devTestGameRaceCoveragePath,
    requiredCellCount: 5,
    coveredCellCount: 5,
    gapCount: 0,
    cells: playerConcurrentActionReloadCellsFixture(),
  });
  assert.deepEqual(freshAction.cohostDeadlineRaceReloadTrace, {
    strategy: "cohost-deadline-race-reload-before-readiness",
    status: "covered",
    source: devTestGameRaceCoveragePath,
    requiredCellCount: 1,
    coveredCellCount: 1,
    gapCount: 0,
    cells: cohostDeadlineRaceReloadCellsFixture(),
  });
  assert.deepEqual(
    freshAction.raceCoveragePromotedMilestones,
    raceCoveragePromotedMilestonesFixture({ groupStatus: "covered" }),
  );
  assert.deepEqual(freshAction.staleConflictMessageTrace, {
    strategy: "stale-conflict-message-before-readiness",
    status: "covered",
    source: "target/dev-test-game/release-readiness-checklist.json",
    requiredLaneCount: 3,
    coveredLaneCount: 3,
    gapCount: 0,
    laneIds: [
      "replacement-stale-conflict-message",
      "stale-action-conflict-message",
      "stale-dead-action-conflict",
    ],
  });
  assert.deepEqual(freshAction.hostStaleControlTrace, {
    strategy: "host-stale-control-before-readiness",
    status: "covered",
    source: "target/dev-test-game/release-readiness-checklist.json",
    requiredLaneCount: 18,
    coveredLaneCount: 18,
    gapCount: 0,
    laneIds: [
      "stale-host-publish",
      "stale-host-lifecycle",
      "stale-host-modkill",
      "stale-host-prompt",
      "stale-host-prompt-reload",
      "stale-host-complete",
      "stale-host-complete-reload",
      "stale-host-complete-reconnect-recovery",
      "stale-host-control",
      "stale-host-resolve",
      "stale-host-resolve-reload",
      "stale-host-resolve-reconnect-recovery",
      "stale-host-advance",
      "stale-host-advance-reload",
      "stale-host-advance-reconnect-recovery",
      "stale-host-deadline",
      "stale-host-deadline-reload",
      "stale-host-deadline-reconnect-recovery",
    ],
  });
});

test("dev test-game next-action advances hosted deployment after target preflight passes", () => {
  const freshManifest = buildDevTestGameSpineManifest({
    generatedAt: "2026-06-26T00:00:00.000Z",
    proofFreshness: {
      version: 1,
      proof: "dev-test-game-proof-freshness",
      status: "passed",
      generatedAt: "2026-06-26T00:00:00.000Z",
      maxAgeHours: 24,
      proofBoundary: "test freshness boundary",
      summary: {
        artifactCount: 1,
        freshCount: 1,
        staleCount: 0,
        missingCount: 0,
      },
      artifacts: [
        {
          id: "spine-manifest",
          label: "Spine manifest",
          path: "target/dev-test-game/spine-manifest.json",
          status: "fresh",
        },
      ],
    },
  });
  const readiness = devTestGameReleaseReadinessChecklistFixture({
    unproven: [
      {
        id: "hosted-deployment",
        status: "unproven",
        requiredEvidence: "Hosted API/frontend deployment proof with external health checks",
      },
    ],
  });

  const blockedPreflightAction = buildDevTestGameNextAction(freshManifest, {
    generatedAt: "2026-06-26T00:00:01.000Z",
    opsArtifacts: devTestGameOpsArtifactsFixture(),
    raceCoverage: devTestGameRaceCoverageFixture(),
    releaseReadinessChecklist: readiness,
    hostedTargetPreflight: hostedTargetPreflightFixture({ status: "blocked" }),
  });
  assertDevTestGameNextAction(blockedPreflightAction);
  assert.equal(
    blockedPreflightAction.nextAction.command,
    `npm run ${devTestGameHostedEvidenceLaneCommand}`,
  );
  assert.equal(
    blockedPreflightAction.nextAction.unproven.proofTarget,
    devTestGameHostedEvidenceLanePath,
  );
  assert.equal(
    blockedPreflightAction.nextAction.unproven.roleUrl,
    "/admin/audit/local-hosted-evidence-lane?game=<seeded-game>",
  );
  assert.equal(
    blockedPreflightAction.nextAction.unproven.proofGraphNodeId,
    "admin-proof:hosted-evidence-lane",
  );
  assert.equal(
    blockedPreflightAction.releaseReadinessTrace.candidates[0].roleUrl,
    "/admin/audit/local-hosted-evidence-lane?game=<seeded-game>",
  );
  assert.equal(
    blockedPreflightAction.releaseReadinessTrace.candidates[0].proofGraphNodeId,
    "admin-proof:hosted-evidence-lane",
  );
  assert.equal(
    blockedPreflightAction.generatedFrom.hostedTargetPreflightStatus,
    "blocked",
  );

  const passedPreflightAction = buildDevTestGameNextAction(freshManifest, {
    generatedAt: "2026-06-26T00:00:01.000Z",
    opsArtifacts: devTestGameOpsArtifactsFixture(),
    raceCoverage: devTestGameRaceCoverageFixture(),
    releaseReadinessChecklist: readiness,
    hostedTargetPreflight: hostedTargetPreflightFixture({ status: "passed" }),
  });
  assertDevTestGameNextAction(passedPreflightAction);
  assert.equal(
    passedPreflightAction.nextAction.command,
    `npm run ${devTestGameHostedEvidenceLaneCommand}`,
  );
  assert.equal(
    passedPreflightAction.nextAction.unproven.proofTarget,
    devTestGameHostedMatrixExternalEvidencePath,
  );
  assert.equal(
    passedPreflightAction.nextAction.unproven.roleUrl,
    "/admin/audit/local-hosted-concurrent-race-matrix?game=<seeded-game>",
  );
  assert.equal(
    passedPreflightAction.nextAction.unproven.proofGraphNodeId,
    "admin-proof:hosted-concurrent-race-matrix",
  );
  assert.equal(
    passedPreflightAction.releaseReadinessTrace.candidates[0].command,
    `npm run ${devTestGameHostedEvidenceLaneCommand}`,
  );
  assert.equal(
    passedPreflightAction.generatedFrom.hostedTargetPreflightStatus,
    "passed",
  );
  assert.equal(
    passedPreflightAction.generatedFrom.hostedTargetPreflightNextProofTarget,
    devTestGameHostedMatrixExternalEvidencePath,
  );
});

test("dev test-game hosted evidence lane records blocked preflight state", async () => {
  const lane = await runDevTestGameHostedEvidenceLane({
    env: {},
    generatedAt: "2026-06-26T00:00:00.000Z",
  });

  assertDevTestGameHostedEvidenceLane(lane);
  assert.equal(lane.status, "blocked");
  assert.equal(lane.releaseReady, false);
  assert.equal(lane.productionReady, false);
  assert.equal(lane.preflightStatus, "blocked");
  assert.deepEqual(lane.blockedCheckIds, [
    "hosted-frontend-url-configured",
    "hosted-api-url-configured",
    "hosted-targets-external",
    "raw-evidence-path-configured",
    "raw-evidence-readable",
  ]);
  assert.equal(lane.nextCommand, `npm run ${devTestGameHostedEvidenceLaneCommand}`);
  assert.equal(lane.nextProofTarget, devTestGameHostedEvidenceLanePath);
  assert.deepEqual(lane.generatedFrom, {
    hostedTargetPreflight: devTestGameHostedTargetPreflightPath,
  });
});

test("dev test-game next-action blocks readiness work on saved harness stability drift", () => {
  const freshManifest = buildDevTestGameSpineManifest({
    generatedAt: "2026-06-26T00:00:00.000Z",
    proofFreshness: {
      version: 1,
      proof: "dev-test-game-proof-freshness",
      status: "passed",
      generatedAt: "2026-06-26T00:00:00.000Z",
      maxAgeHours: 24,
      proofBoundary: "test freshness boundary",
      summary: {
        artifactCount: 1,
        freshCount: 1,
        staleCount: 0,
        missingCount: 0,
      },
      artifacts: [
        {
          id: "spine-manifest",
          label: "Spine manifest",
          path: "target/dev-test-game/spine-manifest.json",
          status: "fresh",
          mtime: "2026-06-26T00:00:00.000Z",
          ageSeconds: 0,
          maxAgeSeconds: 86400,
        },
      ],
    },
  });

  const action = buildDevTestGameNextAction(freshManifest, {
    generatedAt: "2026-06-26T00:00:01.000Z",
    opsArtifacts: devTestGameOpsArtifactsFixture({
      proofStability: {
        status: "passed",
        hostConfirmClicks: {
          total: 55,
          firstClickCount: 53,
          concurrentClickCount: 0,
          retryClickCount: 1,
          domFallbackCount: 1,
          forceFallbackCount: 0,
          failureCount: 0,
          maxAttempts: 3,
          byAction: { resolve_phase: 2 },
          byRole: { host: 2 },
          events: [
            {
              actionId: "resolve_phase",
              roleLabel: "host",
              method: "playwright-retry",
              attempts: 2,
            },
            {
              actionId: "extend_deadline",
              roleLabel: "cohost",
              method: "dom-fallback",
              attempts: 3,
            },
          ],
        },
      },
    }),
    raceCoverage: devTestGameRaceCoverageFixture(),
    releaseReadinessChecklist: devTestGameReleaseReadinessChecklistFixture({
      unproven: [
        {
          id: "hosted-concurrent-race-matrix",
          status: "unproven",
          requiredEvidence: "Hosted or hosted-like concurrent command race matrix",
        },
      ],
    }),
  });

  assertDevTestGameNextAction(action);
  assert.deepEqual(action.nextAction, {
    command: devTestGameLiveProofCommand,
    reason: "harness-stability-drift",
    status: "blocked",
    stability: {
      source: "target/dev-test-game/ops-artifacts.json",
      hostConfirmClicks: 55,
      retryClickCount: 1,
      domFallbackCount: 1,
      forceFallbackCount: 0,
      failureCount: 0,
      maxAttempts: 3,
      eventCount: 2,
      buildSlice:
        "Stabilize the critical host-confirm browser interaction before expanding the production-facing seeded proof spine.",
      proofTarget: "target/dev-test-game/session.json",
    },
  });
  assert.deepEqual(action.stabilityTrace, {
    strategy: "proof-stability-before-readiness",
    status: "drifted",
    hostConfirmClicks: 55,
    retryClickCount: 1,
    domFallbackCount: 1,
    forceFallbackCount: 0,
    failureCount: 0,
    maxAttempts: 3,
    eventCount: 2,
    selected: true,
  });
  assert.equal(
    action.releaseReadinessTrace.selectedUnprovenId,
    "hosted-concurrent-race-matrix",
  );
  assert.equal(action.hostConcurrentRaceReloadTrace.status, "covered");
  assert.equal(action.playerConcurrentActionReloadTrace.status, "covered");
  assert.equal(action.cohostDeadlineRaceReloadTrace.status, "covered");
  assert.equal(action.staleConflictMessageTrace.status, "covered");
  assert.equal(action.hostStaleControlTrace.status, "covered");
});

test("dev test-game next-action prioritizes development-spine recovery over manifest order", () => {
  const staleManifest = buildDevTestGameSpineManifest({
    generatedAt: "2026-06-26T00:00:00.000Z",
    proofFreshness: {
      version: 1,
      proof: "dev-test-game-proof-freshness",
      status: "blocked",
      generatedAt: "2026-06-26T00:00:00.000Z",
      maxAgeHours: 24,
      proofBoundary: "test freshness boundary",
      summary: {
        artifactCount: 3,
        freshCount: 0,
        staleCount: 1,
        missingCount: 2,
      },
      artifacts: [
        {
          id: "release",
          label: "Release admin proof",
          path: "target/dev-test-game/release-admin-proof.json",
          status: "missing",
        },
        {
          id: "next-action",
          label: "Next action receipt",
          path: "target/dev-test-game/next-action.json",
          status: "missing",
        },
        {
          id: "proof-run",
          label: "Live proof run",
          path: "target/dev-test-game/proof-run.json",
          status: "stale",
          mtime: "2026-06-25T00:00:00.000Z",
          ageSeconds: 90000,
          maxAgeSeconds: 86400,
        },
      ],
    },
  });

  const staleAction = buildDevTestGameNextAction(staleManifest, {
    generatedAt: "2026-06-26T00:00:01.000Z",
  });

  assertDevTestGameNextAction(staleAction);
  assert.deepEqual(staleAction.nextAction, {
    command: devTestGameLiveProofCommand,
    reason: "artifact-not-fresh",
    status: "blocked",
    artifact: {
      id: "proof-run",
      label: "Live proof run",
      path: "target/dev-test-game/proof-run.json",
      status: "stale",
      refreshSource: "manifest-default",
    },
  });
  assert.deepEqual(
    staleAction.selectionTrace.candidates.map((candidate) => [
      candidate.rank,
      candidate.id,
      candidate.status,
      candidate.priority,
      candidate.selected,
      candidate.refreshCommand,
    ]),
    [
      [
        1,
        "proof-run",
        "stale",
        0,
        true,
        devTestGameLiveProofCommand,
      ],
      [2, "release", "missing", 17, false, "npm run test:dev-test-game-release-admin-proof"],
      [3, "next-action", "missing", 10000, false, "npm run test:dev-test-game-admin-spine"],
    ],
  );
});

test("dev test-game proof graph records local proof role URLs and recovery edges", () => {
  const adminSpineProof = adminSpineProofFixture();
  const spineManifest = buildDevTestGameSpineManifest({
    generatedAt: "2026-06-26T00:00:00.000Z",
    proofFreshness: {
      version: 1,
      proof: "dev-test-game-proof-freshness",
      status: "blocked",
      generatedAt: "2026-06-26T00:00:00.000Z",
      maxAgeHours: 24,
      proofBoundary: "test freshness boundary",
      summary: {
        artifactCount: 2,
        freshCount: 1,
        staleCount: 1,
        missingCount: 0,
      },
      artifacts: [
        {
          id: "proof-run",
          label: "Dev test-game proof run",
          path: "target/dev-test-game/proof-run.json",
          status: "stale",
        },
        {
          id: "spine-manifest",
          label: "Spine manifest",
          path: "target/dev-test-game/spine-manifest.json",
          status: "fresh",
        },
      ],
    },
    adminSpineProof,
  });
  const graph = buildDevTestGameProofGraph(
    {
      spineManifest,
      adminSpineProof,
    },
    {
      generatedAt: "2026-06-26T00:00:00.000Z",
    },
  );

  assertDevTestGameProofGraph(graph);
  assertDevTestGameProofGraphCoversAdminSpine(graph, adminSpineProof);
  assert.equal(graph.summary.nodeCount, 18);
  assert.equal(graph.summary.roleUrlCount, 18);
  assert.deepEqual(
    graph.nodes
      .filter((node) => node.kind === "admin-proof-surface")
      .map((node) => [node.surfaceId, node.artifact, node.roleUrl, node.proofCommand]),
    adminSpineProof.adminProofs.map((proof) => [
      proof.id,
      proof.path,
      proof.detailRoleUrl,
      proof.rerunCommand,
    ]),
  );
  assert.deepEqual(
    graph.nodes
      .filter((node) =>
        ["admin-spine", "spine-manifest", "proof-freshness", "next-action"].includes(
          node.id,
        ),
      )
      .map((node) => [
        node.id,
        node.kind,
        node.artifact,
        node.roleUrl,
        node.recoveryCommand,
      ]),
    [
      [
        "admin-spine",
        "aggregate-proof",
        "target/dev-test-game/admin-spine-proof.json",
        "/admin/audit/local-admin-spine?game=<seeded-game>",
        "npm run test:dev-test-game-admin-spine",
      ],
      [
        "spine-manifest",
        "manifest",
        "target/dev-test-game/spine-manifest.json",
        "/admin/audit/local-spine-manifest?game=<seeded-game>",
        "npm run test:dev-test-game-spine-manifest-admin-proof",
      ],
      [
        "proof-freshness",
        "freshness-dashboard",
        "target/dev-test-game/proof-freshness-admin-proof.json",
        "/admin/audit/local-proof-freshness?game=<seeded-game>",
        devTestGameLiveProofCommand,
      ],
      [
        "next-action",
        "recovery-receipt",
        "target/dev-test-game/next-action.json",
        "/admin/audit/local-next-action?game=<seeded-game>",
        "test:dev-test-game-proof-freshness-admin-proof",
      ],
    ],
  );
  assert(
    graph.edges.some(
      (edge) =>
        edge.from === "proof-freshness" &&
        edge.to === "next-action" &&
        edge.relationship === "recovers-through",
    ),
  );
  assert.throws(
    () =>
      assertDevTestGameProofGraphCoversAdminSpine(
        {
          ...graph,
          nodes: graph.nodes.filter((node) => node.id !== "admin-proof:identity"),
        },
        adminSpineProof,
      ),
    /proof graph admin surface count drifted/,
  );
});

test("named game selection is idempotent by default with explicit reset and reuse", () => {
  const registry = {
    local: { game: "11111111-1111-4111-8111-111111111111" },
  };
  assert.deepEqual(
    selectGame({ args: {}, gameName: "local", registry }),
    {
      game: "11111111-1111-4111-8111-111111111111",
      seedMode: "reuse-if-present",
    },
  );
  assert.deepEqual(
    selectGame({
      args: { reset: true },
      gameName: "local",
      registry,
      randomUuid: () => "22222222-2222-4222-8222-222222222222",
    }),
    {
      game: "22222222-2222-4222-8222-222222222222",
      seedMode: "seed",
    },
  );
  assert.deepEqual(
    selectGame({ args: { reuse: true }, gameName: "local", registry }),
    {
      game: "11111111-1111-4111-8111-111111111111",
      seedMode: "reuse",
    },
  );
  assert.throws(
    () => selectGame({ args: { reuse: true }, gameName: "missing", registry: {} }),
    /no named game 'missing'/,
  );
});

test("seed plan creates a playable mafiascum D01 game shape", () => {
  const game = "33333333-3333-4333-8333-333333333333";
  const plan = seedCommandPlanForGame(game);
  assert.equal(plan.length, 22);
  assert.deepEqual(plan[0], ["host_h", { CreateGame: { game, pack: "mafiascum" } }]);
  assert(plan.some(([, command]) => command.AddCohost?.user === "cohost_c"));
  assert(plan.some(([, command]) => command.StartGame?.phase === "D01"));
  assert(plan.some(([, command]) => command.SubmitVote?.target?.Slot === "slot_5"));
  assert(plan.some(([, command]) => command.SubmitPost?.channel_id === "main"));
});

test("session card and markdown include role credential URLs and tokens", async () => {
  const game = "44444444-4444-4444-8444-444444444444";
  const tokens = createTokenSet("dev-test-card");
  const card = buildSessionCard({
    gameName: "card",
    game,
    seedMode: "seeded",
    databaseUrl: "postgres://db/fmarch",
    apiBaseUrl: "http://127.0.0.1:4101",
    frontendBaseUrl: "http://127.0.0.1:4102",
    seedCommands: [{ command: { CreateGame: { game, pack: "mafiascum" } } }],
    sessions: {
      host: {
        principalUserId: "host_h",
        credentialKind: "invite",
        token: tokens.host,
        inviteToken: tokens.host,
        returnTo: `/g/${game}/host`,
        expectedCapabilityKind: "HostOf",
      },
      player: {
        principalUserId: "player-mira",
        credentialKind: "invite",
        token: tokens.player,
        inviteToken: tokens.player,
        returnTo: `/g/${game}`,
        expectedCapabilityKind: "SlotOccupant",
      },
      replacementPlayer: {
        principalUserId: "player-rowan",
        credentialKind: "invite",
        token: tokens.replacementPlayer,
        inviteToken: tokens.replacementPlayer,
        returnTo: `/g/${game}`,
        expectedCapabilityKind: "SlotOccupant",
      },
      cohost: {
        principalUserId: "cohost_c",
        credentialKind: "invite",
        token: tokens.cohost,
        inviteToken: tokens.cohost,
        returnTo: `/g/${game}/host`,
        expectedCapabilityKind: "CohostOf",
      },
    },
  });

  assert.equal(card.name, "card");
  assert.equal(card.seedCommandCount, 1);
  assert.equal(
    card.sessions.host.loginUrl,
    `http://127.0.0.1:4102/auth/login?returnTo=%2Fg%2F${game}%2Fhost&invite=dev-test-card-host`,
  );
  assert.equal(card.sessions.host.credentialKind, "invite");
  assert.equal(card.sessions.host.inviteToken, "dev-test-card-host");
  assert.equal(card.sessions.player.token, "dev-test-card-player");
  card.verification = {
    status: "passed",
    roles: ["host", "player", "actionPlayer", "deniedPlayer", "cohost", "replacementPlayer"],
    sessions: {
      cohost: {
        capabilityKinds: ["CohostOf"],
        cookie: { valuePrefix: "invite-session-" },
      },
      replacementPlayer: {
        principalUserId: "player-rowan",
        capabilityKinds: ["SlotOccupant", "ChannelMember"],
        cookie: { valuePrefix: "invite-session-" },
      },
    },
    proofStability: {
      status: "passed",
      hostConfirmClicks: {
        total: 4,
        firstClickCount: 3,
        concurrentClickCount: 0,
        retryClickCount: 1,
        domFallbackCount: 0,
        forceFallbackCount: 0,
        failureCount: 0,
        maxAttempts: 2,
        byAction: { resolve_phase: 2, extend_deadline: 2 },
        byRole: { host: 2, cohost: 2 },
        events: [
          {
            actionId: "resolve_phase",
            roleLabel: "host",
            method: "playwright-retry",
            attempts: 2,
          },
        ],
      },
    },
    cohostConsole: {
      status: "passed",
      capabilityLabel: `CohostOf(${game})`,
      proof: "cohost opened the host console, extended deadline, and rejected host-only resolve",
      extendDeadline: {
        statusMessage: "Ack: stream seqs 41",
        commandStatus: {
          state: "ack",
          requestEnvelope: {
            body: {
              body: {
                principal_user_id: "cohost_c",
                command: {
                  ExtendDeadline: {
                    game,
                    phase: "D01",
                  },
                },
              },
            },
          },
        },
      },
      hostOnlyControlsVisible: false,
      hostOnlyResolveReject: {
        statusMessage: "Reject NotHost: not host",
        requestEnvelope: {
          body: {
            body: {
              principal_user_id: "cohost_c",
              command: {
                ResolvePhase: {
                  game,
                  seed: 918273,
                },
              },
            },
          },
        },
        serverEnvelope: {
          body: {
            kind: "Reject",
            body: {
              error: "NotHost",
              message: "not host",
              retryable: false,
            },
          },
        },
      },
      phaseAfterReject: {
        id: "D01",
        locked: false,
      },
    },
    coreLoop: {
      status: "passed",
      proof: "host locked D01 and player recovered from PhaseLocked",
      lock: { commandStatus: { state: "ack" } },
      lockedVoteControl: {
        exists: false,
        disabled: true,
        reason: "control absent",
        text: "",
      },
      rejectedVote: { error: "PhaseLocked", message: "Reject PhaseLocked: phase locked" },
      unlock: { commandStatus: { state: "ack" } },
    },
    dayVoteResolution: {
      status: "passed",
      proof: "action-player cast the majority day vote and host resolved the lynch",
      voterBeforeVote: {
        currentVote: null,
        voteTargets: [
          { kind: "slot", slotId: "slot-2", label: "Slot 2" },
          { kind: "slot", slotId: "slot-3", label: "Slot 3" },
          { kind: "no_lynch", slotId: null, label: "No lynch" },
        ],
      },
      voterCurrentVoteBefore: {
        hasVote: "false",
        text: "Current vote No current vote",
      },
      voterWithdrawBefore: {
        exists: true,
        disabled: true,
        reason: "No current vote",
        text: "Withdraw vote",
      },
      voterVoteButtons: [
        { action: "submit_vote", text: "Vote Slot 2", disabled: false },
        {
          action: "submit_vote:slot-3",
          text: "Vote Slot 3",
          disabled: false,
        },
        {
          action: "submit_vote:no_lynch",
          text: "Vote no lynch",
          disabled: false,
        },
      ],
      finalVote: {
        state: "ack",
        requestEnvelope: {
          body: {
            body: {
              command: {
                SubmitVote: {
                  game,
                  actor_slot: "slot_4",
                  target: { Slot: "slot-2" },
                },
              },
            },
          },
        },
      },
      voterAfterVote: {
        currentVote: { kind: "slot", slotId: "slot-2", label: "Slot 2" },
      },
      voterCurrentVoteAfter: {
        hasVote: "true",
        text: "Current vote Slot 2",
      },
      voterWithdrawAfter: {
        exists: true,
        disabled: false,
        reason: "",
        text: "Withdraw vote",
      },
      voterVotecountAfterVote: [{ target: "slot-2", count: 4 }],
      resolveDay: { commandStatus: { state: "ack" } },
      hostAfterResolve: {
        dayVoteOutcomes: [
          { phaseId: "D01", status: "Lynch", winnerSlot: "slot-2" },
        ],
        outcomePanel: "D01 Lynch\nSlot 2 was eliminated by official vote.",
        outcomeTally: "Slot 2\n4/3",
      },
      dayVoteOutcome: {
        phase_id: "D01",
        status: "Lynch",
        winner_slot: "slot-2",
        tallies: { "slot-2": 4 },
      },
      hostSlot: { slot_id: "slot-2", alive: false, status: "dead" },
      targetCommandState: {
        actorSlot: "slot-2",
        actorAlive: false,
        actorStatus: "dead",
      },
      targetNotice: {
        audience_slot: "slot-2",
        effect: "player_killed",
        status: "day_vote",
      },
      targetControls: {
        vote: { exists: false, disabled: true, reason: "control absent", text: "" },
        withdraw: { exists: true, disabled: true, reason: "", text: "Withdraw vote" },
        post: { exists: true, disabled: true, reason: "", text: "Post" },
      },
      targetDayVoteOutcomes: [
        { phaseId: "D01", status: "Lynch", winnerSlot: "slot-2" },
      ],
      targetOutcomePanel: "D01 Lynch\nSlot 2 was eliminated by official vote.",
      targetOutcomeTally: "Slot 2\n4/3",
    },
    dayVoteNoLynch: {
      status: "passed",
      proof: "two player role URLs clicked no-lynch and host resolved without a death",
      miraNoLynchVote: {
        state: "ack",
        requestEnvelope: {
          body: {
            body: {
              principal_user_id: "player-mira",
              command: {
                SubmitVote: {
                  target: "NoLynch",
                },
              },
            },
          },
        },
      },
      miraVotecountAfterVote: [{ target: "no_lynch", count: 1 }],
      seedNoLynchVote: {
        state: "ack",
        requestEnvelope: {
          body: {
            body: {
              principal_user_id: "player-seed",
              command: {
                SubmitVote: {
                  target: "NoLynch",
                },
              },
            },
          },
        },
      },
      seedVotecountAfterVote: [{ target: "no_lynch", count: 2 }],
      resolveDay: { commandStatus: { state: "ack" } },
      hostAfterResolve: {
        dayVoteOutcomes: [
          { phaseId: "D01", status: "NoLynch", winnerSlot: null },
        ],
        outcomePanel: "D01 NoLynch\nThe official vote resolved without an elimination.",
        outcomeTally: "No lynch\n2/2",
      },
      dayVoteOutcome: {
        phase_id: "D01",
        status: "NoLynch",
        winner_slot: null,
        tallies: { no_lynch: 2 },
      },
      survivorSlot: { slot_id: "slot_3", alive: true, status: "alive" },
      survivorCommandState: {
        actorSlot: "slot_3",
        actorAlive: true,
        actorStatus: "alive",
      },
      survivorNotifications: [],
      survivorDayVoteOutcomes: [
        { phaseId: "D01", status: "NoLynch", winnerSlot: null },
      ],
      survivorOutcomePanel:
        "D01 NoLynch\nThe official vote resolved without an elimination.",
      survivorOutcomeTally: "No lynch\n2/2",
    },
    actionLoop: {
      status: "passed",
      proof: "host resolved N01 and action player advanced to D02",
      invalidAction: { error: "InvalidTarget", message: "Reject InvalidTarget: invalid target" },
      legalAction: { state: "ack", message: "Ack: stream seqs 42" },
      deadlineAdvance: {
        status: "passed",
        phaseBeforeAdvance: {
          id: "D01",
          locked: true,
          deadline: 1781928000,
        },
        advance: {
          commandStatus: {
            state: "ack",
            requestEnvelope: {
              body: {
                body: {
                  command: {
                    AdvancePhaseByDeadline: {
                      game,
                      phase: "D01",
                      observed_at: 1781928001,
                    },
                  },
                },
              },
            },
          },
        },
        command: {
          game,
          phase: "D01",
          observed_at: 1781928001,
        },
        phaseAfterAdvance: { id: "N01", locked: false },
        apiPhaseAfterAdvance: {
          phase_id: "N01",
          locked: false,
          deadline: null,
        },
      },
      staleDeadlineAdvance: {
        status: "passed",
        actionId: "advance_phase_by_deadline",
        setup: {
          stalePhase: {
            id: "D01",
            locked: true,
            deadline: 1781928000,
          },
          visibleActions: [
            "unlock_thread",
            "advance_phase",
            "advance_phase_by_deadline",
          ],
          closedStatus: { state: "closed" },
        },
        reject: {
          state: "reject",
          error: "InvalidTarget",
          message:
            "Reject InvalidTarget: invalid target; deadline target is stale, refresh the host console and use current phase controls",
        },
        phaseAfterReject: { id: "N01", locked: false },
        visibleActionsAfterReject: ["resolve_phase", "lock_thread"],
        activityStatusText:
          "Reject InvalidTarget: invalid target; deadline target is stale, refresh the host console and use current phase controls",
        activityRow: {
          source: "outcome",
          actionId: "advance_phase_by_deadline",
          dispatchKind: "advance_phase_by_deadline",
        },
        dispatchPlan: {
          projectionRefreshKeys: ["host"],
        },
        apiPhaseAfterReject: {
          phase_id: "N01",
          locked: false,
          deadline: null,
        },
      },
      resolvedTargetSlot: { alive: false },
      d02Phase: { phaseId: "D02" },
    },
    invalidActionRecovery: {
      status: "passed",
      proof: "invalid action receipt kept legal action available",
      reject: {
        state: "reject",
        error: "InvalidTarget",
        message: "Reject InvalidTarget: invalid target",
      },
      commandState: {
        phase: { phaseId: "N01" },
        actions: [{ templateId: "factional_kill" }],
      },
      legalActionVisible: true,
      currentReceipt: {
        actionId: "submit_invalid_action:factional_kill",
        state: "reject",
        message: "Reject InvalidTarget: invalid target",
        commandTrace: {
          projectionRefreshKeys: ["notifications", "investigationResults", "commandState"],
        },
      },
      receiptStatusText: "Reject InvalidTarget: invalid target",
    },
    resolutionReceipts: {
      status: "passed",
      proof: "target player saw death notice and other players did not",
      targetSlot: "slot-2",
      hostSlotReceipt: { slot_id: "slot-2", alive: false, status: "dead" },
      targetNotice: {
        audience_slot: "slot-2",
        effect: "player_killed",
        status: "factional_kill",
      },
      targetPrivateQueueItem: {
        audience_slot: "slot-2",
        effect: "player_killed",
        status: "factional_kill",
      },
      targetCommandState: { actorSlot: "slot-2", actions: [] },
      actionReceipt: {
        state: "ack",
        templateId: "factional_kill",
        target: "slot-2",
      },
      normalPlayerNoticeVisible: false,
      actionPlayerNoticeVisible: false,
    },
    deadPlayerRecovery: {
      status: "passed",
      proof: "dead player controls disabled and direct commands rejected",
      targetSlot: "slot-2",
      commandState: {
        actorSlot: "slot-2",
        actorAlive: false,
        actorStatus: "dead",
        phase: { phaseId: "D02" },
        actions: [],
      },
      channelContext: {
        actorSlot: "slot-2",
        actorAlive: "false",
        actorStatus: "dead",
        text: "Posting target Main thread as slot-2 (dead)",
      },
      disabledControls: {
        vote: { exists: false, disabled: true, reason: "control absent", text: "" },
        withdraw: { exists: true, disabled: true, reason: "", text: "Withdraw vote" },
        post: { exists: true, disabled: true, reason: "", text: "Post" },
      },
      actionControlCount: 0,
      directVote: {
        statusMessage: "Reject SlotNotAlive: slot not alive",
        requestEnvelope: { body: { body: { principal_user_id: "player-target" } } },
        serverEnvelope: {
          body: {
            kind: "Reject",
            body: {
              error: "SlotNotAlive",
              message: "slot not alive",
              retryable: false,
            },
          },
        },
      },
      directPost: {
        statusMessage: "Reject SlotNotAlive: slot not alive",
        requestEnvelope: { body: { body: { principal_user_id: "player-target" } } },
        serverEnvelope: {
          body: {
            kind: "Reject",
            body: {
              error: "SlotNotAlive",
              message: "slot not alive",
              retryable: false,
            },
          },
        },
      },
      directAction: {
        statusMessage: "Reject SlotNotAlive: slot not alive",
        requestEnvelope: { body: { body: { principal_user_id: "player-target" } } },
        serverEnvelope: {
          body: {
            kind: "Reject",
            body: {
              error: "SlotNotAlive",
              message: "slot not alive",
              retryable: false,
            },
          },
        },
      },
      commandStateAfterRejects: {
        actorSlot: "slot-2",
        actorAlive: false,
        actorStatus: "dead",
        actions: [],
      },
    },
    playerActionBoundary: {
      status: "passed",
      proof: "player did not see factional kill and direct command rejected",
      phase: { phaseId: "N01" },
      commandActions: [],
      factionalKillVisible: false,
      directFactionalKill: {
        statusMessage: "Reject InvalidTarget: invalid target",
        requestEnvelope: {
          body: {
            body: {
              principal_user_id: "player-mira",
              command: {
                SubmitAction: {
                  game,
                  template_id: "factional_kill",
                },
              },
            },
          },
        },
        serverEnvelope: {
          body: {
            kind: "Reject",
            body: {
              error: "InvalidTarget",
              message: "invalid target",
              retryable: false,
            },
          },
        },
      },
      phaseAfterReject: { phaseId: "N01" },
      actionVisibleAfterReject: false,
    },
    privateChannel: {
      status: "passed",
      proof: "player posted privately and denied player recovered",
      channel: "private:mafia_day_chat",
      allowed: { submitPost: { state: "ack", message: "Ack: stream seqs 43" } },
      denied: { status: 403, actionLabel: "Back to board" },
    },
    replacementConsole: {
      status: "passed",
      proof: "host processed replacement",
      hostIssuedInvite: {
        status: "passed",
        targetLabel: "Slot 7 / player-rowan",
        statusText: "Replacement invite issued",
        loginUrl: `http://127.0.0.1:4102/auth/login?returnTo=%2Fg%2F${game}&invite=replacement-${game}-fixture`,
        returnTo: `/g/${game}`,
        inviteTokenPrefix: `replacement-${game}-`,
        tokenPresent: true,
        session: {
          principalUserId: "player-rowan",
          credentialKind: "invite",
          token: `replacement-${game}-fixture`,
          inviteToken: `replacement-${game}-fixture`,
          loginUrl: `http://127.0.0.1:4102/auth/login?returnTo=%2Fg%2F${game}&invite=replacement-${game}-fixture`,
          directUrl: `http://127.0.0.1:4102/g/${game}`,
          returnTo: `/g/${game}`,
          expectedCapabilityKind: "SlotOccupant",
          globalCapabilities: [],
          issuedBy: {
            principalUserId: "host_h",
            capabilityKind: "HostOf",
            game,
            surface: "host-replacement-invite-panel",
          },
        },
      },
      pendingIncomingPlayer: {
        status: "passed",
        principalUserId: "player-rowan",
        capabilityKinds: [],
        capabilityLabel: `PendingReplacement(${game})`,
        routeStateText:
          "Replacement invite accepted. Slot authority is pending host replacement; refresh this role URL after the host processes the replacement.",
        commandState: {
          actorSlot: "slot-7",
          actorAlive: false,
          actorStatus: "pending_replacement",
          actions: [],
        },
        coldLoadEndpoints: {
          commandStateEndpoint: null,
        },
        controlCounts: {
          primaryButtons: 0,
          actionButtons: 0,
        },
      },
      redeemedInviteRecovery: {
        status: "passed",
        message: "Session or invite token is missing, expired, or revoked",
        prefilledInviteToken: true,
        sessionCookiePresent: false,
        stayedOnLogin: true,
      },
      replacementSessionRevocation: {
        status: "passed",
        revokedPrincipalUserId: "player-rowan",
        apiSessionStatus: 401,
        routeErrorStatus: 403,
        routeErrorActionHref: "/",
        playerSurfaceVisible: false,
        controlCounts: {
          primaryButtons: 0,
          actionButtons: 0,
        },
        sessionCookie: {
          httpOnly: true,
          sameSite: "Lax",
          secure: false,
          valuePrefix: "invite-session-",
        },
      },
      replacementSessionRefresh: {
        status: "passed",
        session: {
          principalUserId: "player-rowan",
          credentialKind: "session",
          token: `dev-test-card-${game}-replacement-session-refresh-token`,
          loginUrl: `http://127.0.0.1:4102/auth/login?returnTo=%2Fg%2F${game}`,
          directUrl: `http://127.0.0.1:4102/g/${game}`,
          returnTo: `/g/${game}`,
          expectedCapabilityKind: "SlotOccupant",
          globalCapabilities: [],
          capabilityKinds: [],
          issuedBy: {
            principalUserId: "root_admin",
            capabilityKind: "GlobalAdmin",
            surface: "/auth/session-grants",
          },
        },
        login: {
          prefilledSessionToken: false,
          submittedSessionToken: true,
          usedInviteToken: false,
          landedOnDirectUrl: true,
        },
        browserEntry: {
          principalUserId: "player-rowan",
          capabilityKinds: ["SlotOccupant", "ChannelMember"],
          cookie: { valuePrefix: "dev-test-card-" },
        },
        commandState: {
          actorSlot: "slot-7",
          actorAlive: true,
          actions: [],
        },
        capabilityLabel: "SlotOccupant or ChannelMember(main)",
        controlCounts: {
          primaryButtons: 3,
          actionButtons: 0,
        },
        postStatus: {
          state: "ack",
          message: "Ack: stream seqs 46",
          requestEnvelope: {
            body: {
              body: {
                principal_user_id: "player-rowan",
                command: {
                  SubmitPost: {
                    actor_slot: "slot-7",
                    body: "Replacement Rowan refreshed-session post from dev:test-game",
                  },
                },
              },
            },
          },
        },
        rowanProjectedPost: {
          authorSlot: "slot-7",
          body: "Replacement Rowan refreshed-session post from dev:test-game",
        },
        privateReceiptIsolation: {
          targetKillVisible: false,
          actionResultVisible: false,
          notificationCount: 0,
          investigationResultCount: 0,
        },
      },
      replacementStaleSessionAfterRefresh: {
        status: "passed",
        apiSessionStatus: 401,
        routeErrorStatus: 403,
        routeErrorActionHref: "/",
        playerSurfaceVisible: false,
        controlCounts: {
          primaryButtons: 0,
          actionButtons: 0,
        },
        staleCookie: {
          httpOnly: true,
          sameSite: "Lax",
          secure: false,
          valuePrefix: "invite-session-",
        },
        freshCredentialKind: "session",
        freshRoleUrlHasInvite: false,
      },
      replacementReconnectRecovery: {
        status: "passed",
        principalUserId: "player-rowan",
        actorSlot: "slot-7",
        reconnectingStatus: { state: "reconnecting" },
        reconnectRecoveryEvent: { attempt: 1, state: "recovered" },
        recoveredSnapshotContainsPost: true,
        recoveredPostBody: "Replacement Rowan reconnect proof from dev:test-game",
        reconnectCommand: {
          principalUserId: "player-rowan",
          command: {
            SubmitPost: {
              actor_slot: "slot-7",
              body: "Replacement Rowan reconnect proof from dev:test-game",
            },
          },
          streamSeqs: [47],
        },
        recoveredCommandState: {
          actorSlot: "slot-7",
          actorAlive: true,
        },
      },
      invalidReplacementRecovery: {
        status: "passed",
        invalidReplacement: {
          requestEnvelope: {
            body: {
              body: {
                principal_user_id: "host_h",
                command: {
                  ProcessReplacement: {
                    game,
                    slot: "slot-7",
                    outgoing_user: "player-rowan",
                    incoming_user: "player-rowan",
                  },
                },
              },
            },
          },
          serverEnvelope: {
            body: {
              kind: "Reject",
              body: {
                error: "InvalidTarget",
                message: "invalid target",
                retryable: false,
              },
            },
          },
        },
        reject: {
          error: "InvalidTarget",
          message: "invalid target",
          retryable: false,
        },
        activityStatusText:
          "Reject InvalidTarget: invalid target; replacement target is stale, refresh the host console and use the current slot occupant",
        activityRow: {
          source: "outcome",
          actionId: "process_replacement_invalid_target",
          dispatchKind: "process_replacement",
          statusKey: "process_replacement_invalid_target",
        },
        dispatchPlan: {
          finalState: "reject",
          projectionRefreshKeys: [],
        },
        hostProjectionAfterReject: {
          slotId: "slot-7",
          occupantLabel: "player-mira",
        },
        apiSlotAfterReject: {
          slot_id: "slot-7",
          occupant_user_id: "player-mira",
        },
        pendingAfterReject: {
          principalUserId: "player-rowan",
          capabilityKinds: [],
          capabilityLabel: `PendingReplacement(${game})`,
          commandState: {
            actorStatus: "pending_replacement",
          },
          coldLoadEndpoints: {
            commandStateEndpoint: null,
          },
          controlCounts: {
            primaryButtons: 0,
            actionButtons: 0,
          },
        },
      },
      processReplacement: {
        statusMessage: "Ack: stream seqs 44",
        commandStatus: {
          state: "ack",
          requestEnvelope: {
            body: {
              body: {
                command_id: "replacement-command-id",
                principal_user_id: "host_h",
                command: {
                  ProcessReplacement: {
                    game,
                    slot: "slot-7",
                    outgoing_user: "player-mira",
                    incoming_user: "player-rowan",
                  },
                },
              },
            },
          },
          serverEnvelope: {
            body: {
              kind: "Ack",
              body: {
                stream_seqs: [44],
              },
            },
          },
        },
      },
      projectedReplacement: {
        slotId: "slot-7",
        occupantLabel: "player-rowan",
        historyLabel: "Slot slot-7 history preserved",
      },
      apiSlot: {
        slot_id: "slot-7",
        occupant_user_id: "player-rowan",
      },
      replacementIdempotentRetry: {
        status: "passed",
        commandId: "replacement-command-id",
        originalStreamSeqs: [44],
        retryStreamSeqs: [44],
        sameStreamSeqs: true,
        retryReplacement: {
          state: "ack",
          message: "Ack: stream seqs 44",
          httpStatus: 200,
          requestEnvelope: {
            body: {
              body: {
                command_id: "replacement-command-id",
                principal_user_id: "host_h",
                command: {
                  ProcessReplacement: {
                    game,
                    slot: "slot-7",
                    outgoing_user: "player-mira",
                    incoming_user: "player-rowan",
                  },
                },
              },
            },
          },
          serverEnvelope: {
            body: {
              kind: "Ack",
              body: {
                stream_seqs: [44],
              },
            },
          },
        },
        hostProjectionAfterRetry: {
          slotId: "slot-7",
          occupantLabel: "player-rowan",
          historyLabel: "Slot slot-7 history preserved",
        },
        apiSlotAfterRetry: {
          slot_id: "slot-7",
          occupant_user_id: "player-rowan",
        },
      },
      staleHostInviteRecovery: {
        status: "passed",
        beforeSubmit: {
          principalUserId: "player-mira",
          expectedOccupantUserId: "player-mira",
          slotId: "slot-7",
        },
        reject: {
          state: "reject",
          message: "Invite target is stale; slot-7 is currently occupied by player-rowan",
          urlRendered: false,
        },
        retry: {
          state: "ack",
          target: {
            principalUserId: "player-rowan",
            expectedOccupantUserId: "player-rowan",
            slotId: "slot-7",
          },
          message: "Player invite issued",
          loginUrl: `http://127.0.0.1:4102/auth/login?returnTo=%2Fg%2F${game}&invite=player-${game}-fixture`,
        },
      },
      staleOutgoingPlayer: {
        status: "passed",
        setup: {
          commandState: {
            actorSlot: "slot-7",
            actorAlive: true,
          },
          closedStatus: { state: "closed" },
        },
        reject: {
          error: "NotYourSlot",
          message:
            "Reject NotYourSlot: not your slot; slot ownership changed, refresh and use current role surface",
        },
        recoveredCommandState: {
          actorSlot: "slot-7",
          actorAlive: false,
          actorStatus: "replaced",
          actions: [],
          boundary: "Reject NotYourSlot: not your slot; The current session no longer owns slot-7.",
        },
        contextState: {
          actorAlive: "false",
          actorStatus: "replaced",
          capabilityLabel: "No current SlotOccupant(slot-7)",
        },
        buttonsDisabled: true,
        commandReceipts: [
          {
            actionId: "submit_vote",
            current: true,
            message:
              "Reject NotYourSlot: not your slot; slot ownership changed, refresh and use current role surface",
          },
        ],
        staleAction: {
          state: "reject",
          error: "NotYourSlot",
          message:
            "Reject NotYourSlot: not your slot; slot ownership changed, refresh and use current role surface",
          requestEnvelope: {
            body: {
              body: {
                command: {
                  SubmitAction: {
                    actor_slot: "slot-7",
                    template_id: "factional_kill",
                  },
                },
              },
            },
          },
        },
        commandStateAfterStaleAction: {
          actorSlot: "slot-7",
          actorAlive: false,
          actorStatus: "replaced",
          actions: [],
        },
        actionControlCountAfterStaleAction: 0,
        buttonsDisabledAfterStaleAction: true,
      },
      staleReplacementAfterSuccess: {
        status: "passed",
        invalidReplacement: {
          requestEnvelope: {
            body: {
              body: {
                principal_user_id: "host_h",
                command: {
                  ProcessReplacement: {
                    game,
                    slot: "slot-7",
                    outgoing_user: "player-mira",
                    incoming_user: "player-rowan",
                  },
                },
              },
            },
          },
          serverEnvelope: {
            body: {
              kind: "Reject",
              body: {
                error: "InvalidTarget",
                message: "invalid target",
                retryable: false,
              },
            },
          },
        },
        reject: {
          error: "InvalidTarget",
          message: "invalid target",
          retryable: false,
        },
        activityStatusText:
          "Reject InvalidTarget: invalid target; replacement target is stale, refresh the host console and use the current slot occupant",
        activityRow: {
          source: "outcome",
          actionId: "process_replacement_stale_success",
          dispatchKind: "process_replacement",
          statusKey: "process_replacement_stale_success",
        },
        dispatchPlan: {
          finalState: "reject",
          projectionRefreshKeys: [],
        },
        hostProjectionAfterReject: {
          slotId: "slot-7",
          occupantLabel: "player-rowan",
        },
        apiSlotAfterReject: {
          slot_id: "slot-7",
          occupant_user_id: "player-rowan",
        },
        staleOutgoingPlayer: {
          recoveredCommandState: {
            actorStatus: "replaced",
          },
          buttonsDisabled: true,
        },
      },
      incomingPlayer: {
        status: "passed",
        browserEntry: {
          principalUserId: "player-rowan",
          capabilityKinds: ["SlotOccupant", "ChannelMember"],
        },
        commandState: {
          actorSlot: "slot-7",
          actorAlive: true,
          actions: [],
          voteTargets: [
            { kind: "slot", slotId: "slot-3", label: "Slot 3" },
            { kind: "slot", slotId: "slot_4", label: "Slot 4" },
            { kind: "no_lynch", slotId: null, label: "No lynch" },
          ],
        },
        capabilityLabel: "SlotOccupant or ChannelMember(main)",
        stableHistoryVisible: true,
        postStatus: {
          state: "ack",
          message: "Ack: stream seqs 45",
          requestEnvelope: {
            body: {
              body: {
                principal_user_id: "player-rowan",
                command: {
                  SubmitPost: {
                    actor_slot: "slot-7",
                    body: "Replacement Rowan post from dev:test-game",
                  },
                },
              },
            },
          },
        },
        rowanProjectedPost: {
          authorSlot: "slot-7",
          body: "Replacement Rowan post from dev:test-game",
        },
        replacementVoteTarget: { kind: "slot", slotId: "slot-3", label: "Slot 3" },
        vote: {
          requestEnvelope: {
            body: {
              body: {
                principal_user_id: "player-rowan",
                command: {
                  SubmitVote: {
                    actor_slot: "slot-7",
                    target: { Slot: "slot-3" },
                  },
                },
              },
            },
          },
          serverEnvelope: { body: { kind: "Ack" } },
        },
        privateReceiptIsolation: {
          targetKillVisible: false,
          actionResultVisible: false,
          notificationCount: 0,
          investigationResultCount: 0,
        },
      },
      stalePrivateChannel: {
        status: "passed",
        channel: "private:mafia_day_chat",
        stalePost: {
          state: "reject",
          error: "NotYourSlot",
          message:
            "Reject NotYourSlot: not your slot; slot ownership changed, refresh and use current role surface",
          requestEnvelope: {
            body: {
              body: {
                principal_user_id: "player-mira",
                command: {
                  SubmitPost: {
                    channel_id: "private:mafia_day_chat",
                    actor_slot: "slot-7",
                  },
                },
              },
            },
          },
        },
        commandStateAfterStalePost: {
          actorStatus: "replaced",
          actions: [],
        },
        staleControlCounts: {
          primaryButtons: 0,
          actionButtons: 0,
        },
        staleRoute: {
          status: 403,
          message:
            "Game game-a channel private:mafia_day_chat requires scoped channel capability.",
        },
        rowanRoute: {
          channelContextId: "private:mafia_day_chat",
          actorSlot: "slot-7",
          capabilityLabel: "ChannelMember(private:mafia_day_chat)",
        },
        rowanPost: {
          state: "ack",
          requestEnvelope: {
            body: {
              body: {
                principal_user_id: "player-rowan",
                command: {
                  SubmitPost: {
                    channel_id: "private:mafia_day_chat",
                    actor_slot: "slot-7",
                  },
                },
              },
            },
          },
        },
        stalePostBody: "Stale Mira private post after replacement",
        rowanPostBody: "Replacement Rowan private-channel post",
        apiThreadPostBodies: ["Replacement Rowan private-channel post"],
      },
      stalePrivateReceipts: {
        status: "passed",
        staleNotifications: {
          status: 403,
          body: {
            error: "NotAuthorized",
            message: "principal cannot read player notifications for this game",
          },
        },
        staleInvestigationResults: {
          status: 403,
          body: {
            error: "NotAuthorized",
            message: "principal cannot read investigation results for this game",
          },
        },
        rowanNotifications: {
          status: 200,
          body: [],
        },
        rowanInvestigationResults: {
          status: 200,
          body: [],
        },
        rowanProjection: {
          notificationCount: 0,
          investigationResultCount: 0,
          targetKillVisible: false,
          actionResultVisible: false,
        },
        rowanQueue: {
          count: 0,
          emptyVisible: true,
          boundary:
            "Notifications and investigation results are loaded from principal-scoped endpoints only.",
        },
        staleRouteStillForbidden: true,
      },
    },
    multiplayerHardening: {
      status: "passed",
      proof: "duplicate command id returned one post and stale host control recovered",
      idempotentRetry: {
        channel: "main",
        firstPost: { state: "ack", streamSeqs: [44] },
        retryPost: { state: "ack", streamSeqs: [44], message: "Ack: stream seqs 44" },
        projectedPostCount: 1,
      },
      reconnect: {
        status: "passed",
        reconnectingStatus: { state: "reconnecting" },
        reconnectRecoveryEvent: { attempt: 1, state: "recovered" },
        recoveredSnapshotContainsPost: true,
      },
      stalePlayerVote: {
        status: "passed",
        commandStateBeforeClose: {
          currentVote: null,
          voteTargets: [
            { kind: "slot", slotId: "slot-3", label: "Slot 3" },
            { kind: "no_lynch", slotId: null, label: "No lynch" },
          ],
        },
        voteControlBeforeClose: {
          exists: true,
          disabled: false,
          reason: "",
          text: "Vote Slot 3",
        },
        withdrawBeforeClose: {
          exists: true,
          disabled: true,
          reason: "No current vote",
          text: "Withdraw vote",
        },
        reject: {
          error: "PhaseLocked",
          message:
            "Reject PhaseLocked: phase locked; stale projection, refresh and use current controls",
        },
        phaseAfterReject: { locked: true },
        commandStateAfterReject: {
          phase: { locked: true },
          currentVote: null,
          voteTargets: [],
        },
        dispatchPlan: {
          projectionRefreshKeys: ["votecount", "commandState"],
        },
        voteControlAfterReject: {
          exists: false,
          disabled: true,
          reason: "control absent",
          text: "",
        },
        withdrawAfterReject: {
          exists: true,
          disabled: true,
          reason: "No current vote",
          text: "Withdraw vote",
        },
        currentVoteAfterReject: {
          hasVote: "false",
          text: "Current vote No current vote",
        },
        hostPhaseAfterUnlock: { locked: false },
      },
      stalePlayerVoteAfterChange: {
        status: "passed",
        commandStateBeforeClose: {
          currentVote: null,
          voteTargets: [
            { kind: "slot", slotId: "slot-3", label: "Slot 3" },
            { kind: "slot", slotId: "slot_4", label: "Slot 4" },
            { kind: "no_lynch", slotId: null, label: "No lynch" },
          ],
        },
        actionCommandStateBeforeChange: {
          voteTargets: [
            { kind: "slot", slotId: "slot-3", label: "Slot 3" },
            { kind: "slot", slotId: "slot-7", label: "Slot 7" },
            { kind: "no_lynch", slotId: null, label: "No lynch" },
          ],
        },
        staleVoteTarget: { kind: "slot", slotId: "slot-3", label: "Slot 3" },
        staleVoteButton: {
          action: "submit_vote",
          disabled: false,
          text: "Vote Slot 3",
        },
        closedStatus: { state: "closed" },
        actionVote: { state: "ack" },
        apiVotecountAfterActionVote: [
          {
            kind: "VoteCountChanged",
            body: { phase_id: "D02", candidate_slot: "no_lynch", count: 1 },
          },
        ],
        staleVote: {
          state: "ack",
          requestEnvelope: {
            body: {
              body: {
                command: {
                  SubmitVote: {
                    target: { Slot: "slot-3" },
                  },
                },
              },
            },
          },
        },
        commandStateAfterAck: {
          currentVote: { kind: "slot", slotId: "slot-3", label: "Slot 3" },
        },
        votecountAfterAck: [
          { target: "no_lynch", count: 1 },
          { target: "slot-3", count: 1 },
        ],
        dispatchPlan: {
          projectionRefreshKeys: ["votecount", "commandState"],
        },
        currentVoteAfterAck: {
          hasVote: "true",
          text: "Current vote Slot 3",
        },
        apiVotecountAfterAck: [
          {
            kind: "VoteCountChanged",
            body: { phase_id: "D02", candidate_slot: "no_lynch", count: 1 },
          },
          {
            kind: "VoteCountChanged",
            body: { phase_id: "D02", candidate_slot: "slot-3", count: 1 },
          },
        ],
        apiCommandStateAfterAck: {
          current_vote: { kind: "slot", slot_id: "slot-3", label: "Slot 3" },
        },
        withdrawPlayer: { state: "ack" },
        withdrawAction: { state: "ack" },
        apiVotecountAfterCleanup: [],
        apiCommandStateAfterCleanup: {
          current_vote: null,
        },
      },
      stalePlayerWithdrawAfterChange: {
        status: "passed",
        commandStateBeforeVote: {
          currentVote: null,
          voteTargets: [
            { kind: "slot", slotId: "slot-3", label: "Slot 3" },
            { kind: "slot", slotId: "slot_4", label: "Slot 4" },
            { kind: "no_lynch", slotId: null, label: "No lynch" },
          ],
        },
        staleVoteTarget: { kind: "slot", slotId: "slot-3", label: "Slot 3" },
        staleVoteButton: {
          action: "submit_vote",
          disabled: false,
          text: "Vote Slot 3",
        },
        initialVote: { state: "ack" },
        commandStateBeforeClose: {
          currentVote: { kind: "slot", slotId: "slot-3", label: "Slot 3" },
        },
        currentVoteBeforeClose: {
          hasVote: "true",
          text: "Current vote Slot 3",
        },
        withdrawBeforeClose: {
          exists: true,
          disabled: false,
          reason: "",
          text: "Withdraw vote",
        },
        closedStatus: { state: "closed" },
        liveChangeVote: { state: "ack" },
        apiCommandStateAfterLiveChange: {
          current_vote: { kind: "no_lynch", slot_id: null, label: "No lynch" },
        },
        apiVotecountAfterLiveChange: [
          {
            kind: "VoteCountChanged",
            body: { phase_id: "D02", candidate_slot: "no_lynch", count: 1 },
          },
        ],
        staleWithdraw: {
          state: "ack",
          requestEnvelope: {
            body: {
              body: {
                command: {
                  WithdrawVote: {
                    actor_slot: "slot-7",
                  },
                },
              },
            },
          },
        },
        commandStateAfterWithdraw: {
          currentVote: null,
        },
        votecountAfterWithdraw: [],
        dispatchPlan: {
          projectionRefreshKeys: ["votecount", "commandState"],
        },
        currentVoteAfterWithdraw: {
          hasVote: "false",
          text: "Current vote No current vote",
        },
        withdrawAfterAck: {
          exists: true,
          disabled: true,
          reason: "No current vote",
          text: "Withdraw vote",
        },
        apiCommandStateAfterWithdraw: {
          current_vote: null,
        },
        apiVotecountAfterWithdraw: [],
      },
      stalePlayerWithdrawAfterPhaseClosure: {
        status: "passed",
        game: "phase-closure-game",
        hostEntry: {
          capabilityKinds: ["HostOf"],
        },
        playerEntry: {
          capabilityKinds: ["SlotOccupant"],
        },
        commandStateBeforeClose: {
          actorSlot: "slot-7",
          phase: { phaseId: "D01", locked: false },
          currentVote: { kind: "slot", slotId: "slot-2", label: "Slot 2" },
        },
        currentVoteBeforeClose: {
          hasVote: "true",
          text: "Current vote Slot 2",
        },
        withdrawBeforeClose: {
          exists: true,
          disabled: false,
          reason: "",
          text: "Withdraw vote",
        },
        closedStatus: { state: "closed" },
        resolveDay: { commandStatus: { state: "ack" } },
        hostAfterResolve: {
          phase: { id: "D01", locked: true },
          dayVoteOutcomes: [
            { phaseId: "D01", status: "Lynch", winnerSlot: "slot-2" },
          ],
        },
        apiCommandStateAfterResolve: {
          phase: { locked: true },
          current_vote: null,
          vote_targets: [],
        },
        staleWithdraw: {
          state: "reject",
          error: "PhaseLocked",
          serverEnvelope: { body: { kind: "Reject" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  WithdrawVote: {
                    actor_slot: "slot-7",
                  },
                },
              },
            },
          },
        },
        commandStateAfterReject: {
          phase: { phaseId: "D01", locked: true },
          currentVote: null,
          voteTargets: [],
        },
        dispatchPlan: {
          projectionRefreshKeys: ["votecount", "commandState"],
        },
        currentVoteAfterReject: {
          hasVote: "false",
          text: "Current vote No current vote",
        },
        withdrawAfterReject: {
          exists: true,
          disabled: true,
          reason: "No current vote",
          text: "Withdraw vote",
        },
        buttonsAfterReject: [
          { action: "withdraw_vote", disabled: true, text: "Withdraw vote" },
          { action: "submit_post", disabled: false, text: "Post" },
        ],
        dayVoteOutcomesAfterReject: [
          { phaseId: "D01", status: "Lynch", winnerSlot: "slot-2" },
        ],
        apiCommandStateAfterReject: {
          phase: { locked: true },
          current_vote: null,
          vote_targets: [],
        },
      },
      stalePlayerVoteAfterPhaseClosure: {
        status: "passed",
        game: "phase-closure-vote-game",
        hostEntry: {
          capabilityKinds: ["HostOf"],
        },
        playerEntry: {
          capabilityKinds: ["SlotOccupant"],
        },
        commandStateBeforeClose: {
          actorSlot: "slot-7",
          phase: { phaseId: "D01", locked: false },
          currentVote: { kind: "slot", slotId: "slot-2", label: "Slot 2" },
          voteTargets: [
            { kind: "slot", slotId: "slot-3", label: "Slot 3" },
            { kind: "no_lynch", label: "No lynch" },
          ],
        },
        staleVoteTarget: { kind: "slot", slotId: "slot-3", label: "Slot 3" },
        staleVoteButton: {
          action: "submit_vote:slot-3",
          disabled: false,
          text: "Vote Slot 3",
        },
        currentVoteBeforeClose: {
          hasVote: "true",
          text: "Current vote Slot 2",
        },
        closedStatus: { state: "closed" },
        resolveDay: { commandStatus: { state: "ack" } },
        hostAfterResolve: {
          phase: { id: "D01", locked: true },
          dayVoteOutcomes: [
            { phaseId: "D01", status: "Lynch", winnerSlot: "slot-2" },
          ],
        },
        apiCommandStateAfterResolve: {
          phase: { locked: true },
          current_vote: null,
          vote_targets: [],
        },
        staleVote: {
          state: "reject",
          error: "PhaseLocked",
          serverEnvelope: { body: { kind: "Reject" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  SubmitVote: {
                    actor_slot: "slot-7",
                  },
                },
              },
            },
          },
        },
        commandStateAfterReject: {
          phase: { phaseId: "D01", locked: true },
          currentVote: null,
          voteTargets: [],
        },
        dispatchPlan: {
          projectionRefreshKeys: ["votecount", "commandState"],
        },
        currentVoteAfterReject: {
          hasVote: "false",
          text: "Current vote No current vote",
        },
        withdrawAfterReject: {
          exists: true,
          disabled: true,
          reason: "No current vote",
          text: "Withdraw vote",
        },
        buttonsAfterReject: [
          { action: "withdraw_vote", disabled: true, text: "Withdraw vote" },
          { action: "submit_post", disabled: false, text: "Post" },
        ],
        dayVoteOutcomesAfterReject: [
          { phaseId: "D01", status: "Lynch", winnerSlot: "slot-2" },
        ],
        apiCommandStateAfterReject: {
          phase: { locked: true },
          current_vote: null,
          vote_targets: [],
        },
      },
      stalePlayerPostAfterPhaseClosure: {
        status: "passed",
        game: "phase-closure-post-game",
        postBody: "Stale player post after D01 phase closure",
        hostEntry: {
          capabilityKinds: ["HostOf"],
        },
        playerEntry: {
          capabilityKinds: ["SlotOccupant"],
        },
        commandStateBeforeClose: {
          actorSlot: "slot-7",
          phase: { phaseId: "D01", locked: false },
          currentVote: { kind: "slot", slotId: "slot-2", label: "Slot 2" },
        },
        currentVoteBeforeClose: {
          hasVote: "true",
          text: "Current vote Slot 2",
        },
        submitPostBeforeClose: {
          action: "submit_post",
          disabled: false,
          text: "Post",
        },
        closedStatus: { state: "closed" },
        resolveDay: { commandStatus: { state: "ack" } },
        hostAfterResolve: {
          phase: { id: "D01", locked: true },
          dayVoteOutcomes: [
            { phaseId: "D01", status: "Lynch", winnerSlot: "slot-2" },
          ],
        },
        apiCommandStateAfterResolve: {
          phase: { locked: true },
          current_vote: null,
          vote_targets: [],
        },
        stalePost: {
          state: "ack",
          streamSeqs: [501],
          serverEnvelope: { body: { kind: "Ack" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  SubmitPost: {
                    actor_slot: "slot-7",
                    channel_id: "main",
                    body: "Stale player post after D01 phase closure",
                  },
                },
              },
            },
          },
        },
        projectedPost: {
          body: "Stale player post after D01 phase closure",
          authorSlot: "slot-7",
        },
        commandStateAfterAck: {
          phase: { phaseId: "D01", locked: true },
          currentVote: null,
          voteTargets: [],
        },
        dispatchPlan: {
          projectionRefreshKeys: [
            "thread",
            "votecount",
            "commandState",
            "dayVoteOutcomes",
          ],
        },
        currentVoteAfterAck: {
          hasVote: "false",
          text: "Current vote No current vote",
        },
        withdrawAfterAck: {
          exists: true,
          disabled: true,
          reason: "No current vote",
          text: "Withdraw vote",
        },
        buttonsAfterAck: [
          { action: "withdraw_vote", disabled: true, text: "Withdraw vote" },
          { action: "submit_post", disabled: false, text: "Post" },
        ],
        dayVoteOutcomesAfterAck: [
          { phaseId: "D01", status: "Lynch", winnerSlot: "slot-2" },
        ],
        apiCommandStateAfterAck: {
          phase: { locked: true },
          current_vote: null,
          vote_targets: [],
        },
        apiThreadAfterAck: {
          posts: [
            {
              body: "Stale player post after D01 phase closure",
              author_slot: "slot-7",
            },
          ],
        },
      },
      staleDeadTargetVote: {
        status: "passed",
        commandStateBeforeClose: {
          currentVote: null,
          voteTargets: [
            { kind: "slot", slotId: "slot-3", label: "Slot 3" },
            { kind: "slot", slotId: "slot_4", label: "Slot 4" },
            { kind: "no_lynch", slotId: null, label: "No lynch" },
          ],
        },
        staleTarget: { kind: "slot", slotId: "slot-3", label: "Slot 3" },
        staleVoteButton: {
          action: "submit_vote",
          disabled: false,
          text: "Vote Slot 3",
        },
        currentVoteBeforeClose: {
          hasVote: "false",
          text: "Current vote No current vote",
        },
        closedStatus: { state: "closed" },
        markDead: { state: "ack", slot: "slot-3", status: "dead" },
        apiSlotAfterDead: { alive: false, status: "dead" },
        reject: {
          state: "reject",
          error: "InvalidTarget",
          message:
            "Reject InvalidTarget: invalid target; vote target is no longer valid, refresh and use current vote controls",
          serverEnvelope: { body: { kind: "Reject" } },
        },
        commandStateAfterReject: {
          currentVote: null,
          voteTargets: [
            { kind: "slot", slotId: "slot_4", label: "Slot 4" },
            { kind: "no_lynch", slotId: null, label: "No lynch" },
          ],
        },
        apiCommandStateAfterReject: {
          vote_targets: [
            { kind: "slot", slot_id: "slot_4", label: "Slot 4" },
            { kind: "no_lynch", slot_id: null, label: "No lynch" },
          ],
        },
        dispatchPlan: {
          projectionRefreshKeys: ["votecount", "commandState"],
        },
        buttonsAfterReject: [
          { action: "submit_vote", disabled: false, text: "Vote Slot 4" },
          { action: "submit_vote:no_lynch", disabled: false, text: "Vote no lynch" },
          { action: "withdraw_vote", disabled: true, text: "Withdraw vote" },
        ],
        currentVoteAfterReject: {
          hasVote: "false",
          text: "Current vote No current vote",
        },
        restoreAlive: { state: "ack", slot: "slot-3", status: "alive" },
        apiSlotAfterRestore: { alive: true, status: "alive" },
      },
      deadCurrentVote: {
        status: "passed",
        commandStateBeforeVote: {
          voteTargets: [
            { kind: "slot", slotId: "slot-3", label: "Slot 3" },
            { kind: "slot", slotId: "slot_4", label: "Slot 4" },
            { kind: "no_lynch", slotId: null, label: "No lynch" },
          ],
        },
        target: { kind: "slot", slotId: "slot-3", label: "Slot 3" },
        voteButton: {
          action: "submit_vote",
          disabled: false,
          text: "Vote Slot 3",
        },
        vote: {
          state: "ack",
          requestEnvelope: {
            body: {
              body: {
                command: {
                  SubmitVote: {
                    target: { Slot: "slot-3" },
                  },
                },
              },
            },
          },
        },
        commandStateAfterVote: {
          currentVote: { kind: "slot", slotId: "slot-3", label: "Slot 3" },
        },
        currentVoteAfterVote: {
          hasVote: "true",
          text: "Current vote Slot 3",
        },
        playerVotecountAfterVote: [{ target: "slot-3", count: 1 }],
        apiVotecountAfterVote: [
          {
            kind: "VoteCountChanged",
            body: { phase_id: "D02", candidate_slot: "slot-3", count: 1 },
          },
        ],
        markDead: { state: "ack", slot: "slot-3", status: "dead" },
        apiSlotAfterDead: { alive: false, status: "dead" },
        commandStateAfterDead: {
          currentVote: null,
          voteTargets: [
            { kind: "slot", slotId: "slot_4", label: "Slot 4" },
            { kind: "no_lynch", slotId: null, label: "No lynch" },
          ],
        },
        currentVoteAfterDead: {
          hasVote: "false",
          text: "Current vote No current vote",
        },
        playerVotecountAfterDead: [],
        hostVotecountAfterDead: [],
        apiCommandStateAfterDead: {
          current_vote: null,
          vote_targets: [
            { kind: "slot", slot_id: "slot_4", label: "Slot 4" },
            { kind: "no_lynch", slot_id: null, label: "No lynch" },
          ],
        },
        apiVotecountAfterDead: [],
        staleHostPublishAfterClear: {
          status: "passed",
          actionId: "publish_votecount",
          setup: {
            stalePhase: { id: "D02", locked: false },
            votecountRows: [{ target: "slot-3", count: 1 }],
            votecountActions: ["publish_votecount"],
            closedStatus: { state: "closed" },
            staleBody: "Official votecount for D02\n- slot-3: 1",
          },
          expectedBody: "Official votecount for D02\n\nNo active ballots.",
          staleBody: "Official votecount for D02\n- slot-3: 1",
          publish: {
            state: "ack",
            requestEnvelope: {
              body: {
                body: {
                  command: {
                    PublishVotecount: { game },
                  },
                },
              },
            },
          },
          commandOutcomes: [
            {
              source: "outcome",
              actionId: "publish_votecount",
              state: "ack",
            },
          ],
          votecountActionsAfterPublish: ["publish_votecount"],
          activityStatusText: "Ack: stream seqs 45",
          activityRow: {
            source: "outcome",
            actionId: "publish_votecount",
            dispatchKind: "publish_votecount",
          },
          dispatchPlan: { projectionRefreshKeys: [] },
          apiExpectedPostCount: 1,
          apiStalePostCount: 0,
          playerExpectedPostCount: 1,
          playerStalePostCount: 0,
        },
        restoreAlive: { state: "ack", slot: "slot-3", status: "alive" },
        apiSlotAfterRestore: { alive: true, status: "alive" },
        commandStateAfterRestore: {
          currentVote: null,
          voteTargets: [
            { kind: "slot", slotId: "slot-3", label: "Slot 3" },
            { kind: "slot", slotId: "slot_4", label: "Slot 4" },
            { kind: "no_lynch", slotId: null, label: "No lynch" },
          ],
        },
      },
      concurrentVoteRace: {
        status: "passed",
        targetSlot: "slot-3",
        target: { kind: "slot", slotId: "slot-3", label: "Slot 3" },
        playerCommandStateBeforeVote: {
          voteTargets: [
            { kind: "slot", slotId: "slot-3", label: "Slot 3" },
            { kind: "slot", slotId: "slot_4", label: "Slot 4" },
            { kind: "no_lynch", slotId: null, label: "No lynch" },
          ],
        },
        actionCommandStateBeforeVote: {
          voteTargets: [
            { kind: "slot", slotId: "slot-3", label: "Slot 3" },
            { kind: "slot", slotId: "slot-7", label: "Slot 7" },
            { kind: "no_lynch", slotId: null, label: "No lynch" },
          ],
        },
        playerVote: { state: "ack", streamSeqs: [45] },
        actionVote: { state: "ack", streamSeqs: [46] },
        apiProjection: { count: 2 },
        roleReloadAfterRace: {
          status: "passed",
          playerRouteStatus: 200,
          actionRouteStatus: 200,
          playerCommandState: {
            currentVote: { kind: "slot", slotId: "slot-3", label: "Slot 3" },
          },
          actionCommandState: {
            currentVote: { kind: "slot", slotId: "slot-3", label: "Slot 3" },
          },
          playerCurrentVote: { hasVote: "true", text: "Current vote: Slot 3" },
          actionCurrentVote: { hasVote: "true", text: "Current vote: Slot 3" },
          playerProjection: [{ target: "slot-3", count: 2 }],
          actionProjection: [{ target: "slot-3", count: 2 }],
          apiProjection: { count: 2 },
        },
      },
      concurrentPlayerVoteResolveRace: {
        status: "passed",
        game: "vote-resolve-race-game-a",
        hostEntry: { capabilityKinds: ["HostOf"] },
        playerEntry: { capabilityKinds: ["SlotOccupant"] },
        setupCommandState: {
          actorSlot: "slot_4",
          phase: { phaseId: "D01", locked: false },
        },
        setupVoteButton: { action: "submit_vote:slot-2", disabled: false },
        setupHostPhase: { id: "D01", locked: false },
        setupHostPhaseActions: ["resolve_phase"],
        vote: {
          state: "ack",
          streamSeqs: [47],
          serverEnvelope: { body: { kind: "Ack" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  SubmitVote: {
                    game: "vote-resolve-race-game-a",
                    actor_slot: "slot_4",
                    target: { Slot: "slot-2" },
                  },
                },
              },
            },
          },
        },
        resolve: {
          state: "ack",
          streamSeqs: [48, 49, 50],
          serverEnvelope: { body: { kind: "Ack" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  ResolvePhase: { game: "vote-resolve-race-game-a", seed: 71004 },
                },
              },
            },
          },
        },
        voteSeq: 47,
        resolveSeq: 48,
        outcomeSummary: "vote seq 47 before resolve seq 48",
        commandStateAfterRace: {
          phase: { phaseId: "D01", locked: true },
          voteTargets: [],
        },
        buttonsAfterRace: [
          { action: "withdraw_vote", disabled: true },
          { action: "submit_post", disabled: false },
        ],
        hostPhaseAfterRace: { id: "D01", locked: true },
        hostDayVoteOutcomesAfterRace: [
          { phaseId: "D01", status: "Lynch", winnerSlot: "slot-2" },
        ],
        playerDayVoteOutcomesAfterRace: [
          { phaseId: "D01", status: "Lynch", winnerSlot: "slot-2" },
        ],
        apiCommandStateAfterRace: {
          phase: { phase_id: "D01", locked: true },
          vote_targets: [],
        },
        apiDayVoteOutcomesAfterRace: [
          { phase_id: "D01", status: "Lynch", winner_slot: "slot-2" },
        ],
        roleReloadAfterRace: {
          status: "passed",
          playerRouteResponseStatus: 200,
          hostRouteResponseStatus: 200,
          commandStateAfterReload: {
            phase: { phaseId: "D01", locked: true },
            voteTargets: [],
          },
          buttonsAfterReload: [
            { action: "withdraw_vote", disabled: true },
            { action: "submit_post", disabled: false },
          ],
          hostPhaseAfterReload: { id: "D01", locked: true },
          hostDayVoteOutcomesAfterReload: [
            { phaseId: "D01", status: "Lynch", winnerSlot: "slot-2" },
          ],
          playerDayVoteOutcomesAfterReload: [
            { phaseId: "D01", status: "Lynch", winnerSlot: "slot-2" },
          ],
          apiCommandStateAfterReload: {
            phase: { phase_id: "D01", locked: true },
            vote_targets: [],
          },
          apiDayVoteOutcomesAfterReload: [
            { phase_id: "D01", status: "Lynch", winner_slot: "slot-2" },
          ],
        },
      },
      concurrentPlayerActionAdvanceRace: {
        status: "passed",
        game: "action-advance-race-game-a",
        hostEntry: { capabilityKinds: ["HostOf"] },
        actionEntry: { capabilityKinds: ["SlotOccupant"] },
        setupCommandState: {
          actorSlot: "slot_4",
          phase: { phaseId: "N01", locked: false },
          actions: [{ templateId: "factional_kill" }],
        },
        setupActionButton: {
          action: "submit_action:factional_kill",
          disabled: false,
        },
        setupHostPhase: { id: "N01", locked: false },
        setupHostPhaseActions: ["resolve_phase"],
        closedStatus: { state: "closed" },
        resolveNight: { commandStatus: { state: "ack" } },
        lockedHostPhase: { id: "N01", locked: true },
        lockedHostPhaseActions: ["advance_phase"],
        reject: {
          state: "reject",
          error: "PhaseLocked",
          message: "Reject PhaseLocked",
          serverEnvelope: { body: { kind: "Reject" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  SubmitAction: {
                    game: "action-advance-race-game-a",
                    actor_slot: "slot_4",
                    action_id: "role_factional_kill",
                    template_id: "factional_kill",
                    targets: ["slot-2"],
                  },
                },
              },
            },
          },
        },
        advance: {
          state: "ack",
          streamSeqs: [52],
          serverEnvelope: { body: { kind: "Ack" } },
        },
        commandStateAfterRace: {
          actorSlot: "slot_4",
          phase: { phaseId: "D02", locked: false },
          actions: [],
        },
        buttonsAfterRace: [{ action: "submit_vote:no_lynch", disabled: false }],
        hostPhaseAfterRace: { id: "D02", locked: false },
        hostPhaseActionsAfterRace: ["resolve_phase", "lock_thread"],
        apiCommandStateAfterRace: {
          actor_slot: "slot_4",
          phase: { phase_id: "D02", locked: false },
          actions: [],
        },
        apiHostStateAfterRace: { phase: { phase_id: "D02", locked: false } },
        roleReloadAfterRace: {
          status: "passed",
          actionRouteResponseStatus: 200,
          hostRouteResponseStatus: 200,
          commandStateAfterReload: {
            actorSlot: "slot_4",
            phase: { phaseId: "D02", locked: false },
            actions: [],
          },
          buttonsAfterReload: [{ action: "submit_vote:no_lynch", disabled: false }],
          hostPhaseAfterReload: { id: "D02", locked: false },
          hostPhaseActionsAfterReload: ["resolve_phase", "lock_thread"],
          apiCommandStateAfterReload: {
            actor_slot: "slot_4",
            phase: { phase_id: "D02", locked: false },
            actions: [],
          },
          apiHostStateAfterReload: { phase: { phase_id: "D02", locked: false } },
        },
      },
      concurrentCohostDeadlineResolveRace: {
        status: "passed",
        game: "deadline-resolve-race-game-a",
        deadlineAt: 1781928000,
        hostEntry: { capabilityKinds: ["HostOf"] },
        cohostEntry: { capabilityKinds: ["CohostOf"] },
        setupHostPhase: { id: "D01", locked: false },
        setupCohostPhase: { id: "D01", locked: false },
        setupHostPhaseActions: ["resolve_phase"],
        setupHostDeadlineActions: ["extend_deadline"],
        setupCohostPhaseActions: [],
        setupCohostDeadlineActions: ["extend_deadline"],
        resolve: {
          state: "ack",
          streamSeqs: [54, 55, 56],
          serverEnvelope: { body: { kind: "Ack" } },
          requestEnvelope: {
            body: {
              body: {
                command: { ResolvePhase: { game: "deadline-resolve-race-game-a" } },
              },
            },
          },
        },
        deadline: {
          state: "ack",
          streamSeqs: [53],
          serverEnvelope: { body: { kind: "Ack" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  ExtendDeadline: {
                    game: "deadline-resolve-race-game-a",
                    phase: "D01",
                    at: 1781928000,
                  },
                },
              },
            },
          },
        },
        deadlineSeq: 53,
        resolveSeq: 54,
        outcomeSummary: "deadline seq 53 before resolve seq 54",
        hostPhaseAfterRace: { id: "D01", locked: true, deadline: 1781928000 },
        cohostPhaseAfterRace: { id: "D01", locked: true, deadline: 1781928000 },
        hostPhaseActionsAfterRace: ["unlock_thread", "advance_phase"],
        cohostPhaseActionsAfterRace: [],
        hostDeadlineActionsAfterRace: ["extend_deadline"],
        cohostDeadlineActionsAfterRace: ["extend_deadline"],
        hostStateAfterRace: {
          phase: { phase_id: "D01", locked: true, deadline: 1781928000 },
        },
        cohostStateAfterRace: {
          phase: { phase_id: "D01", locked: true, deadline: 1781928000 },
        },
        roleReloadAfterRace: {
          status: "passed",
          expectedDeadline: 1781928000,
          hostRouteResponseStatus: 200,
          cohostRouteResponseStatus: 200,
          hostPhaseAfterReload: { id: "D01", locked: true, deadline: 1781928000 },
          cohostPhaseAfterReload: { id: "D01", locked: true, deadline: 1781928000 },
          hostPhaseActionsAfterReload: ["unlock_thread", "advance_phase"],
          cohostPhaseActionsAfterReload: [],
          hostDeadlineActionsAfterReload: ["extend_deadline"],
          cohostDeadlineActionsAfterReload: ["extend_deadline"],
          hostApiPhaseAfterReload: {
            phase_id: "D01",
            locked: true,
            deadline: 1781928000,
          },
          cohostApiPhaseAfterReload: {
            phase_id: "D01",
            locked: true,
            deadline: 1781928000,
          },
        },
      },
      concurrentReplacementPrivatePostRace: {
        status: "passed",
        game: "replacement-private-post-race-game-a",
        hostEntry: { capabilityKinds: ["HostOf"] },
        playerEntry: { capabilityKinds: ["SlotOccupant"] },
        setupHostReplacement: { occupantLabel: "player-mira" },
        setupCommandState: { actorSlot: "slot-7", actorStatus: "alive" },
        setupChannelContext: {
          channelId: "private:mafia_day_chat",
          actorSlot: "slot-7",
          actorStatus: "alive",
        },
        post: {
          state: "ack",
          streamSeqs: [53],
          serverEnvelope: { body: { kind: "Ack" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  SubmitPost: {
                    game: "replacement-private-post-race-game-a",
                    channel_id: "private:mafia_day_chat",
                    actor_slot: "slot-7",
                  },
                },
              },
            },
          },
        },
        replacement: {
          state: "ack",
          streamSeqs: [54],
          serverEnvelope: { body: { kind: "Ack" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  ProcessReplacement: {
                    game: "replacement-private-post-race-game-a",
                    slot: "slot-7",
                    outgoing_user: "player-mira",
                    incoming_user: "player-rowan",
                  },
                },
              },
            },
          },
        },
        postSeq: 53,
        replacementSeq: 54,
        outcomeSummary: "private post seq 53 before replacement seq 54",
        commandStateAfterRace: { status: 403, error: "NotYourSlot" },
        buttonsAfterRace: [{ action: "submit_post", disabled: true }],
        hostReplacementAfterRace: { occupantLabel: "player-rowan" },
        apiSlotAfterRace: { occupant_user_id: "player-rowan" },
        staleRoute: {
          status: 403,
          responseStatus: 403,
          message: "Forbidden: requires scoped channel capability",
        },
        postBody: "Replacement race private post fixture.",
        apiThreadPostBodies: ["Replacement race private post fixture."],
      },
      concurrentReplacementVoteRace: {
        status: "passed",
        game: "replacement-vote-race-game-a",
        targetSlot: "slot-2",
        hostEntry: { capabilityKinds: ["HostOf"] },
        playerEntry: { capabilityKinds: ["SlotOccupant"] },
        setupHostReplacement: { occupantLabel: "player-mira" },
        setupCommandState: {
          actorSlot: "slot-7",
          actorStatus: "alive",
          voteTargets: [{ kind: "slot", slotId: "slot-2" }],
        },
        setupButtons: [{ action: "submit_vote:slot-2", disabled: false }],
        vote: {
          state: "ack",
          streamSeqs: [53],
          serverEnvelope: { body: { kind: "Ack" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  SubmitVote: {
                    game: "replacement-vote-race-game-a",
                    actor_slot: "slot-7",
                    target: { Slot: "slot-2" },
                  },
                },
              },
            },
          },
        },
        replacement: {
          state: "ack",
          streamSeqs: [54],
          serverEnvelope: { body: { kind: "Ack" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  ProcessReplacement: {
                    game: "replacement-vote-race-game-a",
                    slot: "slot-7",
                    outgoing_user: "player-mira",
                    incoming_user: "player-rowan",
                  },
                },
              },
            },
          },
        },
        voteSeq: 53,
        replacementSeq: 54,
        outcomeSummary: "vote seq 53 before replacement seq 54",
        commandStateAfterRace: { status: 403, error: "NotYourSlot" },
        hostReplacementAfterRace: { occupantLabel: "player-rowan" },
        apiSlotAfterRace: { occupant_user_id: "player-rowan" },
        apiVotecountAfterRace: [
          {
            kind: "VoteCountChanged",
            body: { phase_id: "D01", candidate_slot: "slot-2", count: 1 },
          },
        ],
        targetVotecount: { phaseId: "D01", target: "slot-2", count: 1 },
      },
      concurrentReplacementActionRace: {
        status: "passed",
        game: "replacement-action-race-game-a",
        targetSlot: "slot-2",
        hostEntry: { capabilityKinds: ["HostOf"] },
        playerEntry: { capabilityKinds: ["SlotOccupant"] },
        replacementEntry: { capabilityKinds: ["SlotOccupant"] },
        setupHostPhase: { id: "N01", locked: false },
        setupSlot: { occupant_user_id: "player-goon-a" },
        setupCommandState: {
          actorSlot: "slot_4",
          actorStatus: "alive",
          phase: { phaseId: "N01", locked: false },
          actions: [{ templateId: "factional_kill" }],
        },
        setupButtons: [{ action: "submit_action:factional_kill", disabled: false }],
        action: {
          state: "ack",
          streamSeqs: [55],
          serverEnvelope: { body: { kind: "Ack" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  SubmitAction: {
                    game: "replacement-action-race-game-a",
                    action_id: "replacement_race_factional_kill",
                    actor_slot: "slot_4",
                    template_id: "factional_kill",
                    targets: ["slot-2"],
                  },
                },
              },
            },
          },
        },
        replacement: {
          state: "ack",
          streamSeqs: [56],
          serverEnvelope: { body: { kind: "Ack" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  ProcessReplacement: {
                    game: "replacement-action-race-game-a",
                    slot: "slot_4",
                    outgoing_user: "player-goon-a",
                    incoming_user: "player-rowan",
                  },
                },
              },
            },
          },
        },
        actionSeq: 55,
        replacementSeq: 56,
        outcomeSummary: "action seq 55 before replacement seq 56",
        commandStateAfterRace: { status: 403, error: "NotYourSlot" },
        staleRetry: {
          state: "reject",
          error: "NotYourSlot",
          serverEnvelope: { body: { kind: "Reject" } },
        },
        hostPhaseAfterRace: { id: "N01", locked: false },
        apiSlotAfterRace: { occupant_user_id: "player-rowan" },
        apiCurrentCommandStateStatus: { status: 200 },
        currentCommandStateAfterRace: {
          actor_slot: "slot_4",
          actor_status: "alive",
          phase: { phase_id: "N01", locked: false },
          actions: [],
        },
        currentRoleCommandState: {
          actorSlot: "slot_4",
          actorStatus: "alive",
          phase: { phaseId: "N01", locked: false },
          actions: [],
        },
        currentRoleButtons: [],
      },
      replacementIncomingAction: {
        status: "passed",
        game: "replacement-incoming-action-game-a",
        targetSlot: "slot-2",
        hostEntry: { capabilityKinds: ["HostOf"] },
        replacementEntry: { capabilityKinds: ["SlotOccupant"] },
        targetEntry: { capabilityKinds: ["SlotOccupant"] },
        setupHostPhase: { id: "N01", locked: false },
        setupSlot: { occupant_user_id: "player-goon-a" },
        replacement: {
          state: "ack",
          serverEnvelope: { body: { kind: "Ack" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  ProcessReplacement: {
                    game: "replacement-incoming-action-game-a",
                    slot: "slot_4",
                    outgoing_user: "player-goon-a",
                    incoming_user: "player-rowan",
                  },
                },
              },
            },
          },
        },
        outgoingCommandStateAfterReplacement: {
          status: 403,
          error: "NotYourSlot",
        },
        currentCommandStateBeforeAction: {
          actorSlot: "slot_4",
          actorStatus: "alive",
          phase: { phaseId: "N01", locked: false },
          actions: [{ templateId: "factional_kill" }],
        },
        currentButtonsBeforeAction: [
          { action: "submit_action:factional_kill", disabled: false },
        ],
        action: {
          state: "ack",
          serverEnvelope: { body: { kind: "Ack" } },
          requestEnvelope: {
            body: {
              body: {
                principal_user_id: "player-rowan",
                command: {
                  SubmitAction: {
                    game: "replacement-incoming-action-game-a",
                    action_id: "incoming_replacement_factional_kill",
                    actor_slot: "slot_4",
                    template_id: "factional_kill",
                    targets: ["slot-2"],
                  },
                },
              },
            },
          },
        },
        currentCommandStateAfterAction: { actions: [] },
        currentButtonsAfterAction: [],
        apiCommandStateAfterAction: { actions: [] },
        resolveNight: { commandStatus: { state: "ack" } },
        hostPhaseAfterResolve: { id: "N01", locked: true },
        targetSlotAfterResolve: { slot_id: "slot-2", alive: false, status: "dead" },
        targetCommandState: {
          actorSlot: "slot-2",
          actorAlive: false,
          actorStatus: "dead",
        },
        targetNotice: {
          audience_slot: "slot-2",
          effect: "player_killed",
          status: "factional_kill",
        },
        replacementPrivateIsolation: {
          targetKillVisible: false,
          notificationCount: 0,
        },
        outcomeSummary: "Rowan submitted factional_kill as Slot 4 and killed slot-2",
      },
      replacementActionReconnect: {
        status: "passed",
        game: "replacement-action-reconnect-game-a",
        targetSlot: "slot-2",
        hostEntry: { capabilityKinds: ["HostOf"] },
        replacementEntry: { capabilityKinds: ["SlotOccupant"] },
        targetEntry: { capabilityKinds: ["SlotOccupant"] },
        replacement: {
          state: "ack",
          serverEnvelope: { body: { kind: "Ack" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  ProcessReplacement: {
                    game: "replacement-action-reconnect-game-a",
                    slot: "slot_4",
                    outgoing_user: "player-goon-a",
                    incoming_user: "player-rowan",
                  },
                },
              },
            },
          },
        },
        commandStateBeforeAction: {
          actorSlot: "slot_4",
          actorStatus: "alive",
          phase: { phaseId: "N01", locked: false },
          actions: [{ templateId: "factional_kill" }],
        },
        action: {
          state: "ack",
          serverEnvelope: { body: { kind: "Ack" } },
          requestEnvelope: {
            body: {
              body: {
                principal_user_id: "player-rowan",
                command: {
                  SubmitAction: {
                    game: "replacement-action-reconnect-game-a",
                    action_id: "replacement_action_reconnect_factional_kill",
                    actor_slot: "slot_4",
                    template_id: "factional_kill",
                    targets: ["slot-2"],
                  },
                },
              },
            },
          },
        },
        resolveNight: { commandStatus: { state: "ack" } },
        targetSlotAfterResolve: { slot_id: "slot-2", alive: false, status: "dead" },
        targetCommandState: {
          actorSlot: "slot-2",
          actorAlive: false,
          actorStatus: "dead",
        },
        targetNoticeBeforeReconnect: {
          audience_slot: "slot-2",
          effect: "player_killed",
          status: "factional_kill",
        },
        reconnect: {
          status: "passed",
          principalUserId: "player-rowan",
          actorSlot: "slot_4",
          reconnectingStatus: { state: "reconnecting" },
          reconnectRecoveryEvent: { attempt: 1, state: "recovered" },
          recoveredSnapshotContainsPost: true,
          reconnectCommand: {
            principalUserId: "player-rowan",
            command: {
              SubmitPost: {
                actor_slot: "slot_4",
                body: "Replacement action reconnect proof from dev:test-game fixture",
              },
            },
            streamSeqs: [60],
          },
          recoveredCommandState: {
            actorSlot: "slot_4",
            actorAlive: true,
            actorStatus: "alive",
            phase: { phaseId: "N01", locked: true },
            actions: [],
          },
        },
        commandStateAfterReconnect: {
          actorSlot: "slot_4",
          actorAlive: true,
          actorStatus: "alive",
          phase: { phaseId: "N01", locked: true },
          actions: [],
        },
        buttonsAfterReconnect: [],
        rowanPrivateIsolationAfterReconnect: {
          targetKillVisible: false,
          notificationCount: 0,
        },
        targetNoticeAfterReconnect: {
          audience_slot: "slot-2",
          effect: "player_killed",
          status: "factional_kill",
        },
        outcomeSummary:
          "Rowan reconnected after resolved Slot 4 factional_kill to locked N01 with no actions",
      },
      replacementStaleActionAfterResolve: {
        status: "passed",
        game: "replacement-stale-action-after-resolve-game-a",
        targetSlot: "slot-2",
        hostEntry: { capabilityKinds: ["HostOf"] },
        replacementEntry: { capabilityKinds: ["SlotOccupant"] },
        targetEntry: { capabilityKinds: ["SlotOccupant"] },
        replacement: {
          state: "ack",
          serverEnvelope: { body: { kind: "Ack" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  ProcessReplacement: {
                    game: "replacement-stale-action-after-resolve-game-a",
                    slot: "slot_4",
                    outgoing_user: "player-goon-a",
                    incoming_user: "player-rowan",
                  },
                },
              },
            },
          },
        },
        commandStateBeforeClose: {
          actorSlot: "slot_4",
          actorStatus: "alive",
          phase: { phaseId: "N01", locked: false },
          actions: [{ templateId: "factional_kill" }],
        },
        buttonsBeforeClose: [
          { action: "submit_action:factional_kill", disabled: false },
        ],
        actionButtonBeforeClose: {
          action: "submit_action:factional_kill",
          disabled: false,
        },
        closedStatus: { state: "closed" },
        resolveNight: { commandStatus: { state: "ack" } },
        hostPhaseAfterResolve: { id: "N01", locked: true },
        hostPhaseActionsAfterResolve: ["advance_phase"],
        targetSlotAfterResolve: {
          slot_id: "slot-2",
          alive: true,
          status: "alive",
        },
        reject: {
          state: "reject",
          error: "PhaseLocked",
          message:
            "Reject PhaseLocked: phase locked; stale action state, refresh and use current action controls",
          serverEnvelope: { body: { kind: "Reject" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  SubmitAction: {
                    actor_slot: "slot_4",
                    action_id: "role_factional_kill",
                    template_id: "factional_kill",
                    targets: ["slot-2"],
                  },
                },
              },
            },
          },
        },
        commandStateAfterReject: {
          actorSlot: "slot_4",
          actorAlive: true,
          actorStatus: "alive",
          phase: { phaseId: "N01", locked: true },
          actions: [],
        },
        buttonsAfterReject: [],
        dispatchPlan: {
          projectionRefreshKeys: ["notifications", "investigationResults", "commandState"],
        },
        currentReceipt: {
          actionId: "submit_action:factional_kill",
          state: "reject",
          commandTrace: { projectionRefreshKeys: ["commandState"] },
        },
        receiptStatusText:
          "Reject PhaseLocked: phase locked; stale action state, refresh and use current action controls",
        apiCommandStateAfterReject: {
          actor_slot: "slot_4",
          actor_alive: true,
          actor_status: "alive",
          phase: { phase_id: "N01", locked: true },
          actions: [],
        },
        targetSlotAfterReject: {
          slot_id: "slot-2",
          alive: true,
          status: "alive",
        },
        rowanPrivateIsolationAfterReject: {
          targetKillVisible: false,
          notificationCount: 0,
        },
        targetCommandStateAfterReject: {
          actorSlot: "slot-2",
          actorAlive: true,
          actorStatus: "alive",
          phase: { phaseId: "N01", locked: true },
          actions: [],
        },
        targetNoticeAfterReject: null,
        outcomeSummary:
          "Rowan's stale replacement factional_kill rejected after N01 resolution without appending",
      },
      replacementStalePrivatePostAfterResolve: {
        status: "passed",
        game: "replacement-stale-private-post-after-resolve-game-a",
        channel: "private:mafia_day_chat",
        hostEntry: { capabilityKinds: ["HostOf"] },
        staleOutgoingEntry: { capabilityKinds: ["SlotOccupant"] },
        replacementEntry: { capabilityKinds: ["SlotOccupant"] },
        replacement: {
          state: "ack",
          serverEnvelope: { body: { kind: "Ack" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  ProcessReplacement: {
                    game: "replacement-stale-private-post-after-resolve-game-a",
                    slot: "slot-7",
                    outgoing_user: "player-mira",
                    incoming_user: "player-rowan",
                  },
                },
              },
            },
          },
        },
        hostReplacementAfterProcess: { occupantLabel: "player-rowan" },
        commandStateBeforeClose: {
          actorSlot: "slot-7",
          actorStatus: "alive",
          phase: { phaseId: "D01", locked: false },
        },
        channelContextBeforeClose: {
          channelId: "private:mafia_day_chat",
          actorSlot: "slot-7",
          actorStatus: "alive",
          capabilityLabel: "ChannelMember(private:mafia_day_chat)",
        },
        submitPostBeforeClose: { action: "submit_post", disabled: false },
        closedStatus: { state: "closed" },
        resolveDay: { commandStatus: { state: "ack" } },
        hostPhaseAfterResolve: { id: "D01", locked: true },
        apiCommandStateAfterResolve: {
          actor_slot: "slot-7",
          phase: { phase_id: "D01", locked: true },
        },
        postBody: "Replacement stale private post after resolve fixture",
        stalePost: {
          state: "ack",
          streamSeqs: [71],
          serverEnvelope: { body: { kind: "Ack" } },
          requestEnvelope: {
            body: {
              body: {
                principal_user_id: "player-rowan",
                command: {
                  SubmitPost: {
                    channel_id: "private:mafia_day_chat",
                    actor_slot: "slot-7",
                    body: "Replacement stale private post after resolve fixture",
                  },
                },
              },
            },
          },
        },
        dispatchPlan: { projectionRefreshKeys: ["thread", "commandState"] },
        currentReceipt: { actionId: "submit_post", state: "ack" },
        commandStateAfterAck: {
          actorSlot: "slot-7",
          actorStatus: "alive",
          phase: { phaseId: "D01", locked: true },
          voteTargets: [],
        },
        channelContextAfterAck: {
          channelId: "private:mafia_day_chat",
          actorSlot: "slot-7",
        },
        projectedPost: {
          authorSlot: "slot-7",
          body: "Replacement stale private post after resolve fixture",
        },
        apiThreadPostBodies: [
          "Replacement stale private post after resolve fixture",
        ],
        rowanPrivateIsolationAfterAck: {
          targetKillVisible: false,
          actionResultVisible: false,
        },
        staleOutgoingRouteAfterAck: { status: 403 },
        staleOutgoingThreadAfterAck: { status: 403 },
        privateReconnectAfterAck: {
          status: "passed",
          reconnectCommandStateBeforeDrop: {
            actorSlot: "slot-7",
            phase: { phaseId: "D01", locked: true },
          },
          reconnectChannelContextBeforeDrop: {
            channelId: "private:mafia_day_chat",
            actorSlot: "slot-7",
          },
          reconnectButtonsBeforeDrop: [
            { action: "withdraw_vote", disabled: true },
            { action: "submit_post", disabled: false },
          ],
          reconnectingStatus: { state: "reconnecting" },
          reconnectPostBody:
            "Replacement stale private post reconnect fixture",
          reconnectCommand: {
            principalUserId: "player-rowan",
            command: {
              SubmitPost: {
                channel_id: "private:mafia_day_chat",
                actor_slot: "slot-7",
                body: "Replacement stale private post reconnect fixture",
              },
            },
          },
          reconnectRecoveryEvent: {
            attempt: 1,
            state: "recovered",
          },
          recoveredCommandState: {
            actorSlot: "slot-7",
            phase: { phaseId: "D01", locked: true },
            voteTargets: [],
          },
          recoveredSnapshotContainsPost: true,
          reconnectChannelContextAfterRecovery: {
            channelId: "private:mafia_day_chat",
            actorSlot: "slot-7",
          },
          reconnectButtonsAfterRecovery: [
            { action: "withdraw_vote", disabled: true },
            { action: "submit_post", disabled: false },
          ],
          apiThreadPostBodiesAfterReconnect: [
            "Replacement stale private post after resolve fixture",
            "Replacement stale private post reconnect fixture",
          ],
          apiCommandStateAfterReconnect: {
            phase: { phase_id: "D01", locked: true },
            vote_targets: [],
          },
          staleOutgoingThreadAfterReconnect: { status: 403 },
        },
        outcomeSummary:
          "Rowan's stale replacement private post ACKed after D01 resolution with locked channel truth",
      },
      replacementStalePrivatePostAfterComplete: {
        status: "passed",
        game: "replacement-stale-private-post-after-complete-game-a",
        channel: "private:mafia_day_chat",
        hostEntry: { capabilityKinds: ["HostOf"] },
        staleOutgoingEntry: { capabilityKinds: ["SlotOccupant"] },
        replacementEntry: { capabilityKinds: ["SlotOccupant"] },
        replacement: {
          state: "ack",
          requestEnvelope: {
            body: {
              body: {
                command: {
                  ProcessReplacement: {
                    game: "replacement-stale-private-post-after-complete-game-a",
                    slot: "slot-7",
                    incoming_user: "player-rowan",
                  },
                },
              },
            },
          },
        },
        hostReplacementAfterProcess: { occupantLabel: "player-rowan" },
        commandStateBeforeClose: {
          actorSlot: "slot-7",
          gameCompleted: false,
        },
        channelContextBeforeClose: {
          channelId: "private:mafia_day_chat",
          actorSlot: "slot-7",
          capabilityLabel: "ChannelMember(private:mafia_day_chat)",
        },
        submitPostBeforeClose: { action: "submit_post", disabled: false },
        closedStatus: { state: "closed" },
        complete: {
          commandStatus: {
            state: "ack",
            requestEnvelope: {
              body: {
                body: {
                  command: {
                    CompleteGame: {
                      game: "replacement-stale-private-post-after-complete-game-a",
                    },
                  },
                },
              },
            },
          },
        },
        hostSlotsAfterComplete: [
          { role_revealed: true, alignment_revealed: true },
        ],
        hostActionsAfterComplete: [],
        apiStateAfterComplete: { completed: true },
        postBody: "Replacement stale private post after complete fixture",
        reject: {
          state: "reject",
          error: "GameAlreadyCompleted",
          serverEnvelope: { body: { kind: "Reject" } },
          requestEnvelope: {
            body: {
              body: {
                principal_user_id: "player-rowan",
                command: {
                  SubmitPost: {
                    channel_id: "private:mafia_day_chat",
                    actor_slot: "slot-7",
                    body: "Replacement stale private post after complete fixture",
                  },
                },
              },
            },
          },
        },
        dispatchPlan: { projectionRefreshKeys: ["commandState"] },
        currentReceipt: { actionId: "submit_post", state: "reject" },
        receiptStatusText:
          "Reject GameAlreadyCompleted: game already completed",
        commandStateAfterReject: {
          actorSlot: "slot-7",
          gameCompleted: true,
          actions: [],
          voteTargets: [],
          boundary: "Role-action availability: game is complete.",
        },
        channelContextAfterReject: {
          channelId: "private:mafia_day_chat",
          actorSlot: "slot-7",
        },
        buttonsAfterReject: [
          { action: "withdraw_vote", disabled: true },
          { action: "submit_post", disabled: true },
        ],
        apiCommandStateAfterReject: {
          game_completed: true,
          actions: [],
          vote_targets: [],
        },
        apiThreadPostBodies: [],
        staleOutgoingRouteAfterReject: { status: 403 },
        staleOutgoingThreadAfterReject: { status: 403 },
        privateReloadAfterReject: {
          status: "passed",
          routeResponseStatus: 200,
          threadPagerVisible: true,
          recoveredCommandState: {
            actorSlot: "slot-7",
            gameCompleted: true,
            actions: [],
            voteTargets: [],
            boundary: "Role-action availability: game is complete.",
          },
          reloadChannelContext: {
            channelId: "private:mafia_day_chat",
            actorSlot: "slot-7",
            capabilityLabel: "ChannelMember(private:mafia_day_chat)",
          },
          reloadButtons: [
            { action: "withdraw_vote", disabled: true },
            { action: "submit_post", disabled: true },
          ],
          reloadThreadPostBodies: [],
          reloadRejectedPostVisible: false,
          apiCommandStateAfterReload: {
            game_completed: true,
            actions: [],
            vote_targets: [],
          },
          apiThreadPostBodiesAfterReload: [],
          staleOutgoingRouteAfterReload: {
            status: 403,
            responseStatus: 403,
          },
          staleOutgoingThreadAfterReload: { status: 403 },
        },
        outcomeSummary:
          "Rowan's stale replacement private post rejected GameAlreadyCompleted after host completion and reloaded into completed private-channel truth",
      },
      staleHostPublishAfterChange: {
        status: "passed",
        actionId: "publish_votecount",
        setup: {
          stalePhase: { id: "D02", locked: false },
          votecountRows: [{ target: "slot-3", count: 2 }],
          votecountActions: ["publish_votecount"],
          closedStatus: { state: "closed" },
        },
        staleBody: "Official votecount for D02\n- slot-3: 2",
        changeVote: { state: "ack" },
        apiVotecountAfterChange: [
          {
            kind: "VoteCountChanged",
            body: { phase_id: "D02", candidate_slot: "no_lynch", count: 1 },
          },
          {
            kind: "VoteCountChanged",
            body: { phase_id: "D02", candidate_slot: "slot-3", count: 1 },
          },
        ],
        currentRows: [
          { phaseId: "D02", target: "no_lynch", count: 1 },
          { phaseId: "D02", target: "slot-3", count: 1 },
        ],
        expectedBody: "Official votecount for D02\n- no_lynch: 1\n- slot-3: 1",
        publish: {
          commandStatus: {
            state: "ack",
            requestEnvelope: {
              body: {
                body: {
                  command: {
                    PublishVotecount: { game },
                  },
                },
              },
            },
          },
        },
        apiExpectedPostCount: 1,
        apiStalePostCount: 0,
        playerExpectedPostCount: 1,
        playerStalePostCount: 0,
        activityStatusText: "Ack: stream seqs 47",
        activityRow: {
          source: "outcome",
          actionId: "publish_votecount",
          dispatchKind: "publish_votecount",
        },
        restoreVote: { state: "ack" },
        apiVotecountAfterRestore: [
          {
            kind: "VoteCountChanged",
            body: { phase_id: "D02", candidate_slot: "slot-3", count: 2 },
          },
        ],
      },
      hostVotecountPublication: {
        status: "passed",
        expectedBody: "Official votecount for D02\n- slot-3: 2",
        publish: {
          commandStatus: {
            state: "ack",
            requestEnvelope: {
              body: {
                body: {
                  command: {
                    PublishVotecount: { game },
                  },
                },
              },
            },
          },
        },
        playerThreadPost: {
          body: "Official votecount for D02\n- slot-3: 2",
          authorLabel: "host",
        },
        apiThreadPost: {
          body: "Official votecount for D02\n- slot-3: 2",
          author_user: "host",
        },
        activityStatusText: "Ack: stream seqs 47",
      },
      concurrentHostPublishRace: {
        status: "passed",
        game: "publish-race-game",
        seed: { game: "publish-race-game", commands: 22 },
        firstHostRoute: { status: 200, url: "/g/publish-race-game/host" },
        secondHostRoute: { status: 200, url: "/g/publish-race-game/host" },
        playerRoute: { status: 200, url: "/g/publish-race-game" },
        targetSlot: "slot_5",
        targetCount: 3,
        expectedRows: [{ phaseId: "D01", target: "slot_5", count: 3 }],
        expectedBody: "Official votecount for D01\n- slot_5: 3",
        firstOutcome: { state: "ack" },
        secondOutcome: { state: "reject", error: "InvalidTarget" },
        ackRaceRole: "first",
        rejectRaceRole: "second",
        ack: {
          state: "ack",
          streamSeqs: [61],
          serverEnvelope: { body: { kind: "Ack" } },
        },
        reject: {
          state: "reject",
          error: "InvalidTarget",
          message:
            "Reject InvalidTarget: invalid target; official votecount is already published, refresh the thread before retrying",
          serverEnvelope: { body: { kind: "Reject" } },
        },
        commandGames: ["publish-race-game", "publish-race-game"],
        apiOfficialPostCount: 1,
        playerOfficialPostCount: 1,
        roleReloadAfterRace: {
          status: "passed",
          firstHostRouteStatus: 200,
          secondHostRouteStatus: 200,
          playerRouteStatus: 200,
          firstHostProjection: [{ target: "slot_5", count: 3 }],
          secondHostProjection: [{ target: "slot_5", count: 3 }],
          playerProjection: [{ target: "slot_5", count: 3 }],
          apiProjection: { phaseId: "D01", target: "slot_5", count: 3 },
          apiOfficialPostCount: 1,
          playerOfficialPostCount: 1,
        },
        outcomeSummary: "first ACK, second rejected duplicate official count",
      },
      staleHostPublish: {
        status: "passed",
        actionId: "publish_votecount",
        setup: {
          stalePhase: { id: "D02", locked: false },
          votecountRows: [{ target: "slot-3", count: 2 }],
          votecountActions: ["publish_votecount"],
          closedStatus: { state: "closed" },
        },
        reject: {
          state: "reject",
          error: "InvalidTarget",
          message:
            "Reject InvalidTarget: invalid target; official votecount is already published, refresh the thread before retrying",
          serverEnvelope: { body: { kind: "Reject" } },
        },
        commandOutcomes: [
          {
            source: "outcome",
            actionId: "publish_votecount",
            state: "reject",
            error: "InvalidTarget",
          },
        ],
        votecountActionsAfterReject: ["publish_votecount"],
        activityStatusText:
          "Reject InvalidTarget: invalid target; official votecount is already published, refresh the thread before retrying",
        activityRow: {
          source: "outcome",
          actionId: "publish_votecount",
          dispatchKind: "publish_votecount",
        },
        dispatchPlan: { projectionRefreshKeys: [] },
        apiOfficialPostCount: 1,
        playerOfficialPostCount: 1,
      },
      hostLifecycleControl: {
        status: "passed",
        targetSlot: "slot-7",
        markDead: {
          statusMessage: "Ack: stream seqs 48",
          commandStatus: {
            state: "ack",
            requestEnvelope: {
              body: {
                body: {
                  command: {
                    SetSlotStatus: { game, slot: "slot-7", status: "dead" },
                  },
                },
              },
            },
          },
        },
        hostReplacementAfterDead: { lifecycleLabel: "Dead" },
        apiSlotAfterDead: { alive: false, status: "dead" },
        playerCommandStateAfterDead: {
          actorAlive: false,
          actorStatus: "dead",
          actions: [],
        },
        disabledControls: {
          vote: { exists: false, disabled: true, reason: "control absent", text: "" },
          withdraw: { exists: true, disabled: true, reason: "", text: "Withdraw vote" },
          post: { exists: true, disabled: true, reason: "", text: "Post" },
        },
        actionControlCount: 0,
        directPost: {
          state: "reject",
          error: "SlotNotAlive",
        },
        restoreAlive: { state: "ack" },
        apiSlotAfterRestore: { alive: true, status: "alive" },
        playerCommandStateAfterRestore: {
          actorAlive: true,
          actorStatus: "alive",
        },
      },
      staleHostLifecycle: {
        status: "passed",
        actionId: "mark_dead",
        lifecycleStatus: "dead",
        setup: {
          stalePhase: { id: "D02", locked: false },
          replacement: { lifecycleLabel: "Alive" },
          lifecycleActions: ["mark_dead", "modkill_slot"],
          closedStatus: { state: "closed" },
        },
        reject: {
          state: "reject",
          error: "InvalidTarget",
          message:
            "Reject InvalidTarget: invalid target; slot lifecycle changed or is already current, refresh the slot controls before retrying",
          serverEnvelope: { body: { kind: "Reject" } },
        },
        commandOutcomes: [
          {
            actionId: "mark_dead",
            state: "reject",
            error: "InvalidTarget",
          },
        ],
        replacementAfterReject: { lifecycleLabel: "Alive" },
        lifecycleActionsAfterReject: ["mark_dead", "modkill_slot"],
        activityStatusText:
          "Reject InvalidTarget: invalid target; slot lifecycle changed or is already current, refresh the slot controls before retrying",
        activityRow: {
          source: "outcome",
          actionId: "mark_dead",
          dispatchKind: "mark_dead",
        },
        dispatchPlan: { projectionRefreshKeys: [] },
        apiSlotAfterReject: { alive: false, status: "dead" },
        playerCommandStateAfterReject: {
          actorAlive: false,
          actorStatus: "dead",
        },
      },
      hostModkillControl: {
        status: "passed",
        targetSlot: "slot-7",
        modkill: {
          statusMessage: "Ack: stream seqs 49",
          commandStatus: {
            state: "ack",
            requestEnvelope: {
              body: {
                body: {
                  command: {
                    SetSlotStatus: { game, slot: "slot-7", status: "modkilled" },
                  },
                },
              },
            },
          },
        },
        hostReplacementAfterModkill: { lifecycleLabel: "Modkilled" },
        apiSlotAfterModkill: { alive: false, status: "modkilled" },
        playerCommandStateAfterModkill: {
          actorAlive: false,
          actorStatus: "modkilled",
          actions: [],
        },
        disabledControls: {
          vote: { exists: false, disabled: true, reason: "control absent", text: "" },
          withdraw: { exists: true, disabled: true, reason: "", text: "Withdraw vote" },
          post: { exists: true, disabled: true, reason: "", text: "Post" },
        },
        actionControlCount: 0,
        directPost: {
          state: "reject",
          error: "SlotNotAlive",
        },
        restoreAlive: { state: "ack" },
        apiSlotAfterRestore: { alive: true, status: "alive" },
        playerCommandStateAfterRestore: {
          actorAlive: true,
          actorStatus: "alive",
        },
      },
      staleHostModkill: {
        status: "passed",
        actionId: "modkill_slot",
        lifecycleStatus: "modkilled",
        setup: {
          stalePhase: { id: "D02", locked: false },
          replacement: { lifecycleLabel: "Alive" },
          lifecycleActions: ["mark_dead", "modkill_slot"],
          closedStatus: { state: "closed" },
        },
        reject: {
          state: "reject",
          error: "InvalidTarget",
          message:
            "Reject InvalidTarget: invalid target; slot lifecycle changed or is already current, refresh the slot controls before retrying",
          serverEnvelope: { body: { kind: "Reject" } },
        },
        commandOutcomes: [
          {
            actionId: "modkill_slot",
            state: "reject",
            error: "InvalidTarget",
          },
        ],
        replacementAfterReject: { lifecycleLabel: "Alive" },
        lifecycleActionsAfterReject: ["mark_dead", "modkill_slot"],
        activityStatusText:
          "Reject InvalidTarget: invalid target; slot lifecycle changed or is already current, refresh the slot controls before retrying",
        activityRow: {
          source: "outcome",
          actionId: "modkill_slot",
          dispatchKind: "modkill_slot",
        },
        dispatchPlan: { projectionRefreshKeys: [] },
        apiSlotAfterReject: { alive: false, status: "modkilled" },
        playerCommandStateAfterReject: {
          actorAlive: false,
          actorStatus: "modkilled",
        },
      },
      concurrentHostLifecycleRace: {
        status: "passed",
        game: "lifecycle-race-game-a",
        actionId: "mixed_slot_lifecycle",
        setup: {
          deadPagePhase: { id: "D02", locked: false },
          modkillPagePhase: { id: "D02", locked: false },
          deadPageReplacement: { lifecycleLabel: "Alive" },
          modkillPageReplacement: { lifecycleLabel: "Alive" },
          deadPageLifecycleActions: ["mark_dead", "modkill_slot"],
          modkillPageLifecycleActions: ["mark_dead", "modkill_slot"],
          affectedPlayerCommandState: {
            actorSlot: "slot-7",
            actorAlive: true,
            actorStatus: "alive",
          },
        },
        ackRaceRole: "dead",
        rejectRaceRole: "modkill",
        ackActionId: "mark_dead",
        rejectActionId: "modkill_slot",
        winningStatus: "dead",
        winningLabel: "Dead",
        ack: {
          state: "ack",
          commandId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          streamSeqs: [50],
          serverEnvelope: { body: { kind: "Ack" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  SetSlotStatus: {
                    game: "lifecycle-race-game-a",
                    slot: "slot-7",
                    status: "dead",
                  },
                },
              },
            },
          },
        },
        reject: {
          state: "reject",
          commandId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          error: "InvalidTarget",
          message:
            "Reject InvalidTarget: invalid target; slot lifecycle changed or is already current, refresh the slot controls before retrying",
          serverEnvelope: { body: { kind: "Reject" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  SetSlotStatus: {
                    game: "lifecycle-race-game-a",
                    slot: "slot-7",
                    status: "modkilled",
                  },
                },
              },
            },
          },
        },
        deadOutcome: {
          state: "ack",
          requestEnvelope: {
            body: {
              body: {
                command: {
                  SetSlotStatus: {
                    game: "lifecycle-race-game-a",
                    slot: "slot-7",
                    status: "dead",
                  },
                },
              },
            },
          },
        },
        modkillOutcome: {
          state: "reject",
          requestEnvelope: {
            body: {
              body: {
                command: {
                  SetSlotStatus: {
                    game: "lifecycle-race-game-a",
                    slot: "slot-7",
                    status: "modkilled",
                  },
                },
              },
            },
          },
        },
        deadReplacementAfterRace: { lifecycleLabel: "Dead" },
        modkillReplacementAfterRace: { lifecycleLabel: "Dead" },
        deadLifecycleActionsAfterRace: [],
        modkillLifecycleActionsAfterRace: [],
        deadActivityStatusText: "Ack: stream seqs 50",
        modkillActivityStatusText:
          "Reject InvalidTarget: invalid target; slot lifecycle changed or is already current, refresh the slot controls before retrying",
        deadActivityRow: {
          source: "status",
          actionId: "mark_dead",
          dispatchKind: "mark_dead",
        },
        modkillActivityRow: {
          source: "outcome",
          actionId: "modkill_slot",
          dispatchKind: "modkill_slot",
        },
        affectedPlayerCommandStateAfterRace: {
          actorAlive: false,
          actorStatus: "dead",
          actions: [],
        },
        disabledControls: {
          vote: { disabled: true },
          withdraw: { disabled: true },
          post: { disabled: true },
        },
        actionControlCount: 0,
        directPost: {
          state: "reject",
          error: "SlotNotAlive",
        },
        apiSlotAfterRace: { alive: false, status: "dead" },
        roleReloadAfterRace: {
          status: "passed",
          deadRouteStatus: 200,
          modkillRouteStatus: 200,
          playerRouteStatus: 200,
          deadPhaseAfterReload: { id: "D02", locked: false },
          modkillPhaseAfterReload: { id: "D02", locked: false },
          deadReplacementAfterReload: { lifecycleLabel: "Dead" },
          modkillReplacementAfterReload: { lifecycleLabel: "Dead" },
          deadLifecycleActionsAfterReload: [],
          modkillLifecycleActionsAfterReload: [],
          affectedPlayerCommandStateAfterReload: {
            actorAlive: false,
            actorStatus: "dead",
            actions: [],
          },
          disabledControlsAfterReload: {
            vote: { disabled: true },
            withdraw: { disabled: true },
            post: { disabled: true },
          },
          actionControlCountAfterReload: 0,
          apiSlotAfterReload: { alive: false, status: "dead" },
        },
      },
      concurrentActionRace: {
        status: "passed",
        staleN01Phase: { phaseId: "N01" },
        actionConfig: {
          templateId: "factional_kill",
        },
        ackPageRole: "live",
        rejectPageRole: "concurrent",
        targetSlot: "slot-2",
        ack: {
          state: "ack",
          commandId: "11111111-1111-4111-8111-111111111111",
          streamSeqs: [42],
          serverEnvelope: { body: { kind: "Ack" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  SubmitAction: {
                    actor_slot: "slot_4",
                    action_id: "role_factional_kill",
                    template_id: "factional_kill",
                    targets: ["slot-2"],
                  },
                },
              },
            },
          },
        },
        reject: {
          state: "reject",
          commandId: "22222222-2222-4222-8222-222222222222",
          error: "ActionAlreadySubmitted",
          message:
            "Reject ActionAlreadySubmitted: action already submitted; refresh and use current controls",
          serverEnvelope: { body: { kind: "Reject" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  SubmitAction: {
                    actor_slot: "slot_4",
                    action_id: "role_factional_kill",
                    template_id: "factional_kill",
                    targets: ["slot-2"],
                  },
                },
              },
            },
          },
        },
        liveCommandStateAfterRace: {
          actorSlot: "slot_4",
          phase: { phaseId: "N01", locked: false },
          actions: [],
        },
        concurrentCommandStateAfterRace: {
          actorSlot: "slot_4",
          phase: { phaseId: "N01", locked: false },
          actions: [],
        },
        apiCommandStateAfterRace: {
          actor_slot: "slot_4",
          phase: { phase_id: "N01", locked: false },
          actions: [],
        },
        resolvedTargetSlot: {
          slot_id: "slot-2",
          alive: false,
          status: "dead",
        },
        actionVisibleAfterRefresh: false,
        roleReloadAfterRace: {
          status: "passed",
          actionRouteStatus: 200,
          hostRouteStatus: 200,
          actionCommandState: {
            actorSlot: "slot_4",
            phase: { phaseId: "N01", locked: true },
            actions: [],
          },
          actionVisibleAfterReload: false,
          hostPhase: { id: "N01", locked: true },
          hostSlotsAfterReload: [],
          apiCommandState: {
            actor_slot: "slot_4",
            phase: { phase_id: "N01", locked: true },
            actions: [],
          },
          apiTargetSlot: {
            slot_id: "slot-2",
            alive: false,
            status: "dead",
          },
        },
      },
      actionIdempotentRetry: {
        status: "passed",
        actionConfig: {
          templateId: "factional_kill",
        },
        staleN01Phase: { phaseId: "N01" },
        legalActionCommandId: "11111111-1111-4111-8111-111111111111",
        legalActionStreamSeqs: [42],
        legalActionTarget: "slot-2",
        retry: {
          state: "ack",
          commandId: "11111111-1111-4111-8111-111111111111",
          message: "Ack: stream seqs 42",
          streamSeqs: [42],
          serverEnvelope: { body: { kind: "Ack" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  SubmitAction: {
                    actor_slot: "slot_4",
                    action_id: "role_factional_kill",
                    template_id: "factional_kill",
                    targets: ["slot-2"],
                  },
                },
              },
            },
          },
        },
        commandStateAfterRetry: {
          actorSlot: "slot_4",
          actorAlive: true,
          actorStatus: "alive",
          phase: { phaseId: "N01", locked: false },
          actions: [],
        },
        dispatchPlan: {
          projectionRefreshKeys: [
            "notifications",
            "investigationResults",
            "commandState",
          ],
        },
        currentReceipt: {
          actionId: "submit_action:factional_kill",
          state: "ack",
          commandTrace: {
            projectionRefreshKeys: [
              "notifications",
              "investigationResults",
              "commandState",
            ],
          },
        },
        receiptStatusText: "Ack: stream seqs 42",
        apiCommandStateAfterRetry: {
          actor_slot: "slot_4",
          actor_alive: true,
          actor_status: "alive",
          phase: { phase_id: "N01", locked: false },
          actions: [],
        },
        actionVisibleAfterRefresh: false,
      },
      staleSameActionRecovery: {
        status: "passed",
        actionConfig: {
          templateId: "factional_kill",
        },
        staleN01Phase: { phaseId: "N01" },
        legalActionCommandId: "11111111-1111-4111-8111-111111111111",
        legalActionTarget: "slot-2",
        reject: {
          state: "reject",
          commandId: "22222222-2222-4222-8222-222222222222",
          error: "ActionAlreadySubmitted",
          message:
            "Reject ActionAlreadySubmitted: action already submitted; refresh and use current controls",
          serverEnvelope: { body: { kind: "Reject" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  SubmitAction: {
                    actor_slot: "slot_4",
                    action_id: "role_factional_kill",
                    template_id: "factional_kill",
                    targets: ["slot-2"],
                  },
                },
              },
            },
          },
        },
        phaseAfterReject: { phaseId: "N01", locked: false },
        commandStateAfterReject: {
          actorSlot: "slot_4",
          actorAlive: true,
          actorStatus: "alive",
          phase: { phaseId: "N01", locked: false },
          actions: [],
        },
        dispatchPlan: {
          projectionRefreshKeys: [
            "notifications",
            "investigationResults",
            "commandState",
          ],
        },
        currentReceipt: {
          actionId: "submit_action:factional_kill",
          state: "reject",
          commandTrace: {
            projectionRefreshKeys: [
              "notifications",
              "investigationResults",
              "commandState",
            ],
          },
        },
        receiptStatusText:
          "Reject ActionAlreadySubmitted: action already submitted; refresh and use current controls",
        apiCommandStateAfterReject: {
          actor_slot: "slot_4",
          actor_alive: true,
          actor_status: "alive",
          phase: { phase_id: "N01", locked: false },
          actions: [],
        },
        actionVisibleAfterRefresh: false,
      },
      staleDeadActionConflict: {
        status: "passed",
        markDead: { state: "ack" },
        apiSlotAfterDead: { alive: false, status: "dead" },
        actionConfig: {
          templateId: "factional_kill",
        },
        staleN01Phase: { phaseId: "N01" },
        reject: {
          error: "SlotNotAlive",
          message:
            "Reject SlotNotAlive: slot not alive; actor is no longer alive, refresh and use current action controls",
        },
        commandStateAfterReject: {
          actorAlive: false,
          actorStatus: "dead",
          actions: [],
        },
        actionVisibleAfterRefresh: false,
        restoreAlive: { state: "ack" },
        apiSlotAfterRestore: { alive: true, status: "alive" },
        liveCommandStateAfterRestore: {
          actorAlive: true,
          actorStatus: "alive",
          actions: [{ templateId: "factional_kill" }],
        },
      },
      staleActionConflict: {
        status: "passed",
        actionConfig: {
          templateId: "factional_kill",
        },
        staleN01Phase: { phaseId: "N01" },
        reject: {
          state: "reject",
          error: "PhaseLocked",
          message:
            "Reject PhaseLocked: phase locked; stale action state, refresh and use current action controls",
          serverEnvelope: { body: { kind: "Reject" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  SubmitAction: {
                    actor_slot: "slot_4",
                    template_id: "factional_kill",
                  },
                },
              },
            },
          },
        },
        phaseAfterReject: { phaseId: "D02" },
        commandStateAfterReject: {
          actorSlot: "slot_4",
          actorAlive: true,
          actorStatus: "alive",
          phase: { phaseId: "D02", locked: false },
          actions: [],
        },
        dispatchPlan: {
          projectionRefreshKeys: [
            "notifications",
            "investigationResults",
            "commandState",
            "dayVoteOutcomes",
          ],
        },
        currentReceipt: {
          actionId: "submit_action:factional_kill",
          state: "reject",
          commandTrace: {
            projectionRefreshKeys: [
              "notifications",
              "investigationResults",
              "commandState",
            ],
          },
        },
        receiptStatusText:
          "Reject PhaseLocked: phase locked; stale action state, refresh and use current action controls",
        apiCommandStateAfterReject: {
          actor_slot: "slot_4",
          actor_alive: true,
          actor_status: "alive",
          phase: { phase_id: "D02", locked: false },
          actions: [],
        },
        reconnectAfterReject: {
          status: "passed",
          principalUserId: "player-goon-a",
          actorSlot: "slot_4",
          reconnectingStatus: { state: "reconnecting" },
          reconnectRecoveryEvent: { attempt: 1, state: "recovered" },
          recoveredSnapshotContainsPost: true,
          reconnectCommand: {
            principalUserId: "player-goon-a",
            command: {
              SubmitPost: {
                actor_slot: "slot_4",
                body: "Stale action reconnect proof from dev:test-game fixture",
              },
            },
            streamSeqs: [60],
          },
          recoveredCommandState: {
            actorSlot: "slot_4",
            actorAlive: true,
            actorStatus: "alive",
            phase: { phaseId: "D02", locked: false },
            actions: [],
          },
        },
        buttonsAfterReconnect: [],
        actionVisibleAfterRefresh: false,
      },
      staleHostControl: {
        status: "passed",
        setup: {
          stalePhase: { id: "N01", locked: true },
          visibleActions: ["unlock_thread", "advance_phase"],
          closedStatus: { state: "closed" },
        },
        reject: {
          state: "reject",
          error: "PhaseLocked",
          message:
            "Reject PhaseLocked: phase locked; stale phase state, refresh and use current controls",
        },
        commandOutcomes: [
          {
            actionId: "unlock_thread",
            state: "reject",
            error: "PhaseLocked",
          },
        ],
        phaseAfterReject: { id: "D02", locked: false },
        visibleActionsAfterReject: ["lock_thread", "resolve_phase"],
        activityStatusText:
          "Reject PhaseLocked: phase locked; stale phase state, refresh and use current controls",
        activityRow: {
          source: "outcome",
          actionId: "unlock_thread",
          dispatchKind: "unlock_thread",
        },
        dispatchPlan: {
          projectionRefreshKeys: ["host"],
        },
        apiPhaseAfterReject: { phase_id: "D02", locked: false },
      },
      concurrentHostResolveRace: {
        status: "passed",
        game: "race-game-a",
        actionId: "resolve_phase",
        setup: {
          stalePhase: { id: "D02", locked: false },
          phaseActions: ["resolve_phase", "lock_thread"],
          deadlineActions: ["extend_deadline"],
          closedStatus: { state: "closed" },
        },
        ackPageRole: "live",
        rejectPageRole: "concurrent",
        ack: {
          state: "ack",
          commandId: "33333333-3333-4333-8333-333333333333",
          streamSeqs: [49],
          serverEnvelope: { body: { kind: "Ack" } },
          requestEnvelope: {
            body: {
              body: {
                command: { ResolvePhase: { game: "race-game-a" } },
              },
            },
          },
        },
        reject: {
          state: "reject",
          commandId: "44444444-4444-4444-8444-444444444444",
          error: "PhaseLocked",
          message:
            "Reject PhaseLocked: phase locked; stale phase state, refresh and use current controls",
          serverEnvelope: { body: { kind: "Reject" } },
          requestEnvelope: {
            body: {
              body: {
                command: { ResolvePhase: { game: "race-game-a" } },
              },
            },
          },
        },
        livePhaseAfterRace: { id: "D02", locked: true },
        concurrentPhaseAfterRace: { id: "D02", locked: true },
        livePhaseActionsAfterRace: ["unlock_thread", "advance_phase"],
        concurrentPhaseActionsAfterRace: ["unlock_thread", "advance_phase"],
        liveDeadlineActionsAfterRace: ["extend_deadline"],
        concurrentDeadlineActionsAfterRace: ["extend_deadline"],
        liveActivityStatusText: "Ack: stream seqs 49",
        concurrentActivityStatusText:
          "Reject PhaseLocked: phase locked; stale phase state, refresh and use current controls",
        liveActivityRow: {
          source: "status",
          actionId: "resolve_phase",
          dispatchKind: "resolve_phase",
        },
        concurrentActivityRow: {
          source: "outcome",
          actionId: "resolve_phase",
          dispatchKind: "resolve_phase",
        },
        apiPhaseAfterRace: { phase_id: "D02", locked: true },
        roleReloadAfterRace: {
          status: "passed",
          liveRouteStatus: 200,
          concurrentRouteStatus: 200,
          livePhaseAfterReload: { id: "D02", locked: true },
          concurrentPhaseAfterReload: { id: "D02", locked: true },
          livePhaseActionsAfterReload: ["unlock_thread", "advance_phase"],
          concurrentPhaseActionsAfterReload: ["unlock_thread", "advance_phase"],
          liveDeadlineActionsAfterReload: ["extend_deadline"],
          concurrentDeadlineActionsAfterReload: ["extend_deadline"],
          apiPhaseAfterReload: { phase_id: "D02", locked: true },
        },
        restoreAfterRace: {
          commandStatus: {
            state: "ack",
            requestEnvelope: {
              body: {
                body: {
                  command: { UnlockThread: { game: "race-game-a" } },
                },
              },
            },
          },
        },
        apiPhaseAfterRestore: { phase_id: "D02", locked: false },
      },
      concurrentHostAdvanceRace: {
        status: "passed",
        game: "advance-race-game-a",
        actionId: "advance_phase",
        setup: {
          stalePhase: { id: "D02", locked: true },
          phaseActions: ["unlock_thread", "advance_phase"],
          deadlineActions: ["extend_deadline"],
          closedStatus: { state: "closed" },
        },
        ackPageRole: "live",
        rejectPageRole: "concurrent",
        ack: {
          state: "ack",
          commandId: "55555555-5555-4555-8555-555555555555",
          streamSeqs: [53],
          serverEnvelope: { body: { kind: "Ack" } },
          requestEnvelope: {
            body: {
              body: {
                command: { AdvancePhase: { game: "advance-race-game-a" } },
              },
            },
          },
        },
        reject: {
          state: "reject",
          commandId: "66666666-6666-4666-8666-666666666666",
          error: "InvalidTarget",
          message:
            "Reject InvalidTarget: invalid target; stale phase state, refresh and use current controls",
          serverEnvelope: { body: { kind: "Reject" } },
          requestEnvelope: {
            body: {
              body: {
                command: { AdvancePhase: { game: "advance-race-game-a" } },
              },
            },
          },
        },
        livePhaseAfterRace: { id: "N02", locked: false },
        concurrentPhaseAfterRace: { id: "N02", locked: false },
        livePhaseActionsAfterRace: ["resolve_phase", "lock_thread"],
        concurrentPhaseActionsAfterRace: ["resolve_phase", "lock_thread"],
        liveDeadlineActionsAfterRace: ["extend_deadline"],
        concurrentDeadlineActionsAfterRace: ["extend_deadline"],
        liveActivityStatusText: "Ack: stream seqs 53",
        concurrentActivityStatusText:
          "Reject InvalidTarget: invalid target; stale phase state, refresh and use current controls",
        liveActivityRow: {
          source: "status",
          actionId: "advance_phase",
          dispatchKind: "advance_phase",
        },
        concurrentActivityRow: {
          source: "outcome",
          actionId: "advance_phase",
          dispatchKind: "advance_phase",
        },
        apiPhaseAfterRace: { phase_id: "N02", locked: false },
        roleReloadAfterRace: {
          status: "passed",
          liveRouteStatus: 200,
          concurrentRouteStatus: 200,
          livePhaseAfterReload: { id: "N02", locked: false },
          concurrentPhaseAfterReload: { id: "N02", locked: false },
          livePhaseActionsAfterReload: ["resolve_phase", "lock_thread"],
          concurrentPhaseActionsAfterReload: ["resolve_phase", "lock_thread"],
          liveDeadlineActionsAfterReload: ["extend_deadline"],
          concurrentDeadlineActionsAfterReload: ["extend_deadline"],
          apiPhaseAfterReload: { phase_id: "N02", locked: false },
        },
      },
      concurrentHostDeadlineAdvanceRace: {
        status: "passed",
        game: "deadline-advance-race-game-a",
        actionId: "advance_phase_by_deadline",
        setup: {
          stalePhase: { id: "D01", locked: true, deadline: 918300 },
          visibleActions: [
            "unlock_thread",
            "advance_phase",
            "advance_phase_by_deadline",
          ],
          closedStatus: { state: "closed" },
        },
        ackPageRole: "live",
        rejectPageRole: "concurrent",
        ack: {
          state: "ack",
          commandId: "77777777-7777-4777-8777-777777777777",
          streamSeqs: [54, 55],
          serverEnvelope: { body: { kind: "Ack" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  AdvancePhaseByDeadline: {
                    game: "deadline-advance-race-game-a",
                    phase: "D01",
                    observed_at: 918301,
                  },
                },
              },
            },
          },
        },
        reject: {
          state: "reject",
          commandId: "88888888-8888-4888-8888-888888888888",
          error: "InvalidTarget",
          message:
            "Reject InvalidTarget: deadline target is stale; refresh and use the current deadline controls",
          serverEnvelope: { body: { kind: "Reject" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  AdvancePhaseByDeadline: {
                    game: "deadline-advance-race-game-a",
                    phase: "D01",
                    observed_at: 918301,
                  },
                },
              },
            },
          },
        },
        livePhaseAfterRace: { id: "N01", locked: false, deadline: null },
        concurrentPhaseAfterRace: { id: "N01", locked: false, deadline: null },
        livePhaseActionsAfterRace: ["resolve_phase", "lock_thread"],
        concurrentPhaseActionsAfterRace: ["resolve_phase", "lock_thread"],
        liveDeadlineActionsAfterRace: ["extend_deadline"],
        concurrentDeadlineActionsAfterRace: ["extend_deadline"],
        liveActivityStatusText: "Ack: stream seqs 54, 55",
        concurrentActivityStatusText:
          "Reject InvalidTarget: deadline target is stale; refresh and use the current deadline controls",
        liveActivityRow: {
          source: "status",
          actionId: "advance_phase_by_deadline",
          dispatchKind: "advance_phase_by_deadline",
        },
        concurrentActivityRow: {
          source: "outcome",
          actionId: "advance_phase_by_deadline",
          dispatchKind: "advance_phase_by_deadline",
        },
        apiPhaseAfterRace: { phase_id: "N01", locked: false, deadline: null },
        roleReloadAfterRace: {
          status: "passed",
          liveRouteStatus: 200,
          concurrentRouteStatus: 200,
          livePhaseAfterReload: { id: "N01", locked: false, deadline: null },
          concurrentPhaseAfterReload: {
            id: "N01",
            locked: false,
            deadline: null,
          },
          livePhaseActionsAfterReload: ["resolve_phase", "lock_thread"],
          concurrentPhaseActionsAfterReload: ["resolve_phase", "lock_thread"],
          liveDeadlineActionsAfterReload: ["extend_deadline"],
          concurrentDeadlineActionsAfterReload: ["extend_deadline"],
          apiPhaseAfterReload: {
            phase_id: "N01",
            locked: false,
            deadline: null,
          },
        },
      },
      concurrentHostMixedAdvanceRace: {
        status: "passed",
        game: "mixed-advance-race-game-a",
        actionId: "mixed_advance_phase",
        setup: {
          stalePhase: { id: "D01", locked: true, deadline: 918300 },
          visibleActions: [
            "unlock_thread",
            "advance_phase",
            "advance_phase_by_deadline",
          ],
          closedStatus: { state: "closed" },
        },
        ackRaceRole: "normal",
        rejectRaceRole: "deadline",
        ackActionId: "advance_phase",
        rejectActionId: "advance_phase_by_deadline",
        ack: {
          state: "ack",
          commandId: "99999999-9999-4999-8999-999999999999",
          streamSeqs: [56],
          serverEnvelope: { body: { kind: "Ack" } },
          requestEnvelope: {
            body: {
              body: {
                command: { AdvancePhase: { game: "mixed-advance-race-game-a" } },
              },
            },
          },
        },
        reject: {
          state: "reject",
          commandId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          error: "InvalidTarget",
          message:
            "Reject InvalidTarget: invalid target; deadline target is stale, refresh the host console and use current phase controls",
          serverEnvelope: { body: { kind: "Reject" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  AdvancePhaseByDeadline: {
                    game: "mixed-advance-race-game-a",
                    phase: "D01",
                    observed_at: 918301,
                  },
                },
              },
            },
          },
        },
        normalOutcome: {
          state: "ack",
          requestEnvelope: {
            body: {
              body: {
                command: { AdvancePhase: { game: "mixed-advance-race-game-a" } },
              },
            },
          },
        },
        deadlineOutcome: {
          state: "reject",
          requestEnvelope: {
            body: {
              body: {
                command: {
                  AdvancePhaseByDeadline: {
                    game: "mixed-advance-race-game-a",
                    phase: "D01",
                    observed_at: 918301,
                  },
                },
              },
            },
          },
        },
        normalPhaseAfterRace: { id: "N01", locked: false, deadline: null },
        deadlinePhaseAfterRace: { id: "N01", locked: false, deadline: null },
        normalPhaseActionsAfterRace: ["resolve_phase", "lock_thread"],
        deadlinePhaseActionsAfterRace: ["resolve_phase", "lock_thread"],
        normalDeadlineActionsAfterRace: ["extend_deadline"],
        deadlineDeadlineActionsAfterRace: ["extend_deadline"],
        normalActivityStatusText: "Ack: stream seqs 56",
        deadlineActivityStatusText:
          "Reject InvalidTarget: invalid target; deadline target is stale, refresh the host console and use current phase controls",
        normalActivityRow: {
          source: "status",
          actionId: "advance_phase",
          dispatchKind: "advance_phase",
        },
        deadlineActivityRow: {
          source: "outcome",
          actionId: "advance_phase_by_deadline",
          dispatchKind: "advance_phase_by_deadline",
        },
        apiPhaseAfterRace: { phase_id: "N01", locked: false, deadline: null },
        roleReloadAfterRace: {
          status: "passed",
          normalRouteStatus: 200,
          deadlineRouteStatus: 200,
          normalPhaseAfterReload: {
            id: "N01",
            locked: false,
            deadline: null,
          },
          deadlinePhaseAfterReload: {
            id: "N01",
            locked: false,
            deadline: null,
          },
          normalPhaseActionsAfterReload: ["resolve_phase", "lock_thread"],
          deadlinePhaseActionsAfterReload: ["resolve_phase", "lock_thread"],
          normalDeadlineActionsAfterReload: ["extend_deadline"],
          deadlineDeadlineActionsAfterReload: ["extend_deadline"],
          apiPhaseAfterReload: {
            phase_id: "N01",
            locked: false,
            deadline: null,
          },
        },
      },
      staleHostResolve: {
        status: "passed",
        actionId: "resolve_phase",
        setup: {
          stalePhase: { id: "D02", locked: false },
          phaseActions: ["resolve_phase", "lock_thread"],
          deadlineActions: ["extend_deadline"],
          closedStatus: { state: "closed" },
        },
        liveResolve: {
          commandStatus: {
            state: "ack",
            streamSeqs: [50],
            requestEnvelope: {
              body: {
                body: {
                  command: { ResolvePhase: { game } },
                },
              },
            },
          },
        },
        reject: {
          state: "reject",
          error: "PhaseLocked",
          message:
            "Reject PhaseLocked: phase locked; stale phase state, refresh and use current controls",
          serverEnvelope: { body: { kind: "Reject" } },
        },
        commandOutcomes: [
          {
            actionId: "resolve_phase",
            state: "reject",
            error: "PhaseLocked",
          },
        ],
        phaseAfterReject: { id: "D02", locked: true },
        phaseActionsAfterReject: ["unlock_thread", "advance_phase"],
        deadlineActionsAfterReject: ["extend_deadline"],
        activityStatusText:
          "Reject PhaseLocked: phase locked; stale phase state, refresh and use current controls",
        activityRow: {
          source: "outcome",
          actionId: "resolve_phase",
          dispatchKind: "resolve_phase",
        },
        dispatchPlan: {
          projectionRefreshKeys: ["host"],
        },
        apiPhaseAfterReject: { phase_id: "D02", locked: true },
        staleHostResolveReloadAfterReject: {
          status: "passed",
          routeResponseStatus: 200,
          rejectReceiptStatusText:
            "Reject PhaseLocked: phase locked; stale phase state, refresh and use current controls",
          surfaceText: "Host console",
          phaseAfterReload: { id: "D02", locked: true },
          phaseActionsAfterReload: ["unlock_thread", "advance_phase"],
          deadlineActionsAfterReload: ["extend_deadline"],
          apiPhaseAfterReload: { phase_id: "D02", locked: true },
        },
        reconnectAfterReject: {
          status: "passed",
          game,
          reconnectingStatus: { state: "reconnecting" },
          reconnectRecoveryEvent: { attempt: 1, state: "recovered" },
          recoveredStatus: { state: "recovered" },
          recoveredHostProjection: {
            phase: { id: "D02", locked: true },
          },
        },
        phaseActionsAfterReconnect: ["unlock_thread", "advance_phase"],
        deadlineActionsAfterReconnect: ["extend_deadline"],
        restoreAfterReject: {
          commandStatus: {
            state: "ack",
            streamSeqs: [51],
          },
        },
        apiPhaseAfterRestore: { phase_id: "D02", locked: false },
      },
      staleHostAdvance: {
        status: "passed",
        actionId: "advance_phase",
        setup: {
          stalePhase: { id: "D02", locked: true },
          phaseActions: ["unlock_thread", "advance_phase"],
          deadlineActions: ["extend_deadline"],
          closedStatus: { state: "closed" },
        },
        liveUnlock: {
          commandStatus: {
            state: "ack",
            streamSeqs: [52],
            requestEnvelope: {
              body: {
                body: {
                  command: { UnlockThread: { game } },
                },
              },
            },
          },
        },
        reject: {
          state: "reject",
          error: "InvalidTarget",
          message:
            "Reject InvalidTarget: invalid target; stale phase state, refresh and use current controls",
          serverEnvelope: { body: { kind: "Reject" } },
        },
        commandOutcomes: [
          {
            actionId: "advance_phase",
            state: "reject",
            error: "InvalidTarget",
          },
        ],
        phaseAfterReject: { id: "D02", locked: false },
        phaseActionsAfterReject: ["resolve_phase", "lock_thread"],
        deadlineActionsAfterReject: ["extend_deadline"],
        activityStatusText:
          "Reject InvalidTarget: invalid target; stale phase state, refresh and use current controls",
        activityRow: {
          source: "outcome",
          actionId: "advance_phase",
          dispatchKind: "advance_phase",
        },
        dispatchPlan: {
          projectionRefreshKeys: ["host"],
        },
        apiPhaseAfterReject: { phase_id: "D02", locked: false },
        staleHostAdvanceReloadAfterReject: {
          status: "passed",
          routeResponseStatus: 200,
          rejectReceiptStatusText:
            "Reject InvalidTarget: invalid target; stale phase state, refresh and use current controls",
          surfaceText: "Host console",
          phaseAfterReload: { id: "D02", locked: false },
          phaseActionsAfterReload: ["resolve_phase", "lock_thread"],
          deadlineActionsAfterReload: ["extend_deadline"],
          apiPhaseAfterReload: { phase_id: "D02", locked: false },
        },
        reconnectAfterReject: {
          status: "passed",
          game,
          reconnectingStatus: { state: "reconnecting" },
          reconnectRecoveryEvent: { attempt: 1, state: "recovered" },
          recoveredStatus: { state: "recovered" },
          recoveredHostProjection: {
            phase: { id: "D02", locked: false },
          },
        },
        phaseActionsAfterReconnect: ["resolve_phase", "lock_thread"],
        deadlineActionsAfterReconnect: ["extend_deadline"],
      },
      staleHostPrompt: {
        status: "passed",
        game: `${game}-prompt-test`,
        promptId: "D01:skip_next_day:slot_1",
        actionId: "resolve_host_prompt-D01-skip_next_day-slot_1",
        setup: {
          promptId: "D01:skip_next_day:slot_1",
          promptActions: ["resolve_host_prompt-D01-skip_next_day-slot_1"],
          prompts: [
            {
              id: "D01:skip_next_day:slot_1",
              status: "pending",
            },
          ],
          closedStatus: { state: "closed" },
        },
        liveResolve: {
          commandStatus: {
            state: "ack",
            streamSeqs: [53, 54],
            requestEnvelope: {
              body: {
                body: {
                  command: {
                    ResolveHostPrompt: {
                      game: `${game}-prompt-test`,
                      prompt_id: "D01:skip_next_day:slot_1",
                    },
                  },
                },
              },
            },
          },
        },
        reject: {
          state: "reject",
          error: "PromptAlreadyResolved",
          message: "Reject PromptAlreadyResolved: prompt already resolved",
          serverEnvelope: { body: { kind: "Reject" } },
        },
        commandOutcomes: [
          {
            actionId: "resolve_host_prompt-D01-skip_next_day-slot_1",
            state: "reject",
            error: "PromptAlreadyResolved",
          },
        ],
        promptsAfterReject: [
          {
            id: "D01:skip_next_day:slot_1",
            status: "resolved",
          },
        ],
        promptActionsAfterReject: [],
        activityStatusText: "Reject PromptAlreadyResolved: prompt already resolved",
        activityRow: {
          source: "outcome",
          actionId: "resolve_host_prompt-D01-skip_next_day-slot_1",
          dispatchKind: "resolve_host_prompt",
        },
        dispatchPlan: {
          projectionRefreshKeys: ["hostPrompts"],
        },
        apiPromptsAfterReject: [
          {
            prompt_id: "D01:skip_next_day:slot_1",
            status: "resolved",
          },
        ],
        staleHostPromptReloadAfterReject: {
          status: "passed",
          routeResponseStatus: 200,
          rejectReceiptStatusText:
            "Reject PromptAlreadyResolved: prompt already resolved",
          surfaceText: "Host console",
          promptsAfterReload: [
            {
              id: "D01:skip_next_day:slot_1",
              status: "resolved",
            },
          ],
          promptActionsAfterReload: [],
          apiPromptsAfterReload: [
            {
              prompt_id: "D01:skip_next_day:slot_1",
              status: "resolved",
            },
          ],
        },
      },
      staleHostComplete: {
        status: "passed",
        game: `${game}-complete-test`,
        actionId: "complete_game",
        setup: {
          roleActions: ["complete_game"],
          revealText: "0/1 slots revealed",
          slots: [
            { role_revealed: false, alignment_revealed: false },
          ],
          closedStatus: { state: "closed" },
        },
        liveComplete: {
          commandStatus: {
            state: "ack",
            streamSeqs: [55],
            requestEnvelope: {
              body: {
                body: {
                  command: { CompleteGame: { game: `${game}-complete-test` } },
                },
              },
            },
          },
        },
        reject: {
          state: "reject",
          error: "GameAlreadyCompleted",
          message: "Reject GameAlreadyCompleted: game already completed",
          serverEnvelope: { body: { kind: "Reject" } },
        },
        commandOutcomes: [
          {
            actionId: "complete_game",
            state: "reject",
            error: "GameAlreadyCompleted",
          },
        ],
        slotsAfterReject: [
          { role_revealed: true, alignment_revealed: true },
        ],
        revealTextAfterReject: "All 1 slots revealed",
        roleActionsAfterReject: [],
        activityStatusText: "Reject GameAlreadyCompleted: game already completed",
        activityRow: {
          source: "outcome",
          actionId: "complete_game",
          dispatchKind: "complete_game",
        },
        dispatchPlan: {
          projectionRefreshKeys: ["host"],
        },
        apiStateAfterReject: {
          completed: true,
          slots: [
            { role_revealed: true, alignment_revealed: true },
          ],
        },
        staleHostReloadAfterReject: {
          status: "passed",
          routeResponseStatus: 200,
          rejectReceiptStatusText:
            "Reject GameAlreadyCompleted: game already completed",
          surfaceText: "All 1 slots revealed",
          slotsAfterReload: [
            { role_revealed: true, alignment_revealed: true },
          ],
          revealTextAfterReload: "All 1 slots revealed",
          roleActionsAfterReload: [],
          apiStateAfterReload: {
            completed: true,
            slots: [
              { role_revealed: true, alignment_revealed: true },
            ],
          },
        },
        reconnectAfterReject: {
          status: "passed",
          game: `${game}-complete-test`,
          reconnectingStatus: { state: "reconnecting" },
          reconnectRecoveryEvent: { attempt: 1, state: "recovered" },
          recoveredStatus: { state: "recovered" },
          recoveredHostProjection: {
            completed: true,
            slots: [
              { role_revealed: true, alignment_revealed: true },
            ],
          },
        },
        roleActionsAfterReconnect: [],
      },
      concurrentHostCompleteRace: {
        status: "passed",
        game: `${game}-concurrent-complete-test`,
        actionId: "complete_game",
        setup: {
          firstRoleActions: ["complete_game"],
          secondRoleActions: ["complete_game"],
          firstRevealText: "0/1 slots revealed",
          secondRevealText: "0/1 slots revealed",
          firstSlots: [
            { role_revealed: false, alignment_revealed: false },
          ],
          secondSlots: [
            { role_revealed: false, alignment_revealed: false },
          ],
        },
        ackRaceRole: "first",
        rejectRaceRole: "second",
        ack: {
          state: "ack",
          commandId: "concurrent-complete-ack",
          streamSeqs: [56],
          serverEnvelope: { body: { kind: "Ack" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  CompleteGame: { game: `${game}-concurrent-complete-test` },
                },
              },
            },
          },
        },
        reject: {
          state: "reject",
          commandId: "concurrent-complete-reject",
          error: "GameAlreadyCompleted",
          message: "Reject GameAlreadyCompleted: game already completed",
          serverEnvelope: { body: { kind: "Reject" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  CompleteGame: { game: `${game}-concurrent-complete-test` },
                },
              },
            },
          },
        },
        firstOutcome: {
          state: "ack",
          commandId: "concurrent-complete-ack",
        },
        secondOutcome: {
          state: "reject",
          commandId: "concurrent-complete-reject",
          error: "GameAlreadyCompleted",
        },
        firstSlotsAfterRace: [
          { role_revealed: true, alignment_revealed: true },
        ],
        secondSlotsAfterRace: [
          { role_revealed: true, alignment_revealed: true },
        ],
        firstRevealTextAfterRace: "All 1 slots revealed",
        secondRevealTextAfterRace: "All 1 slots revealed",
        firstRoleActionsAfterRace: [],
        secondRoleActionsAfterRace: [],
        firstActivityStatusText: "Ack: stream seqs 56",
        secondActivityStatusText:
          "Reject GameAlreadyCompleted: game already completed",
        firstActivityRow: {
          source: "outcome",
          actionId: "complete_game",
          dispatchKind: "complete_game",
        },
        secondActivityRow: {
          source: "outcome",
          actionId: "complete_game",
          dispatchKind: "complete_game",
        },
        firstDispatchPlan: {
          projectionRefreshKeys: ["host"],
        },
        secondDispatchPlan: {
          projectionRefreshKeys: ["host"],
        },
        apiStateAfterRace: {
          completed: true,
          slots: [
            { role_revealed: true, alignment_revealed: true },
          ],
        },
        roleReloadAfterRace: {
          status: "passed",
          firstRouteStatus: 200,
          secondRouteStatus: 200,
          firstSlotsAfterReload: [
            { role_revealed: true, alignment_revealed: true },
          ],
          secondSlotsAfterReload: [
            { role_revealed: true, alignment_revealed: true },
          ],
          firstRevealTextAfterReload: "All 1 slots revealed",
          secondRevealTextAfterReload: "All 1 slots revealed",
          firstRoleActionsAfterReload: [],
          secondRoleActionsAfterReload: [],
          apiStateAfterReload: {
            completed: true,
            slots: [
              { role_revealed: true, alignment_revealed: true },
            ],
          },
        },
      },
      concurrentPlayerCompleteRace: {
        status: "passed",
        game: `${game}-concurrent-player-complete-test`,
        postBody: "concurrent player complete fixture post",
        setupCommandState: {
          actorSlot: "slot-7",
          gameCompleted: false,
          actions: [],
          voteTargets: [{ kind: "no_lynch", slotId: null, label: "No lynch" }],
        },
        setupButtons: [{ action: "submit_post", disabled: false }],
        setupPostButton: { action: "submit_post", disabled: false },
        setupHostActions: ["complete_game"],
        setupHostSlots: [
          { role_revealed: false, alignment_revealed: false },
        ],
        post: {
          state: "reject",
          commandId: "concurrent-player-complete-post",
          error: "GameAlreadyCompleted",
          message: "Reject GameAlreadyCompleted: game already completed",
          serverEnvelope: { body: { kind: "Reject" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  SubmitPost: {
                    game: `${game}-concurrent-player-complete-test`,
                    channel_id: "main",
                    actor_slot: "slot-7",
                    body: "concurrent player complete fixture post",
                    media: [],
                  },
                },
              },
            },
          },
        },
        complete: {
          state: "ack",
          commandId: "concurrent-player-complete-complete",
          streamSeqs: [57],
          serverEnvelope: { body: { kind: "Ack" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  CompleteGame: { game: `${game}-concurrent-player-complete-test` },
                },
              },
            },
          },
        },
        postSeq: null,
        completeSeq: 57,
        outcomeSummary: "post rejected GameAlreadyCompleted after completion",
        commandStateAfterRace: {
          gameCompleted: true,
          boundary: "game is complete",
          actions: [],
          voteTargets: [],
        },
        buttonsAfterRace: [
          { action: "submit_vote:no_lynch", disabled: true },
          { action: "withdraw_vote", disabled: true },
          { action: "submit_post", disabled: true },
        ],
        publicReloadAfterRace: {
          status: "passed",
          routeResponseStatus: 200,
          surfaceText:
            "Endgame\nThe game is complete.\nNo older posts\nSubmit post",
          threadPagerVisible: true,
          recoveredCommandState: {
            actorSlot: "slot-7",
            gameCompleted: true,
            boundary: "game is complete",
            actions: [],
            voteTargets: [],
          },
          reloadButtons: [
            { action: "submit_vote:no_lynch", disabled: true },
            { action: "withdraw_vote", disabled: true },
            { action: "submit_post", disabled: true },
          ],
          reloadThreadPostBodies: [],
          reloadPostCount: 0,
          reloadPostVisible: false,
          apiCommandStateAfterReload: {
            game_completed: true,
            actions: [],
            vote_targets: [],
          },
          apiThreadPostBodiesAfterReload: [],
          apiThreadPostCount: 0,
          apiStateAfterReload: {
            completed: true,
            slots: [
              { role_revealed: true, alignment_revealed: true },
            ],
          },
        },
        hostSlotsAfterRace: [
          { role_revealed: true, alignment_revealed: true },
        ],
        apiCommandStateAfterRace: {
          game_completed: true,
          actions: [],
          vote_targets: [],
        },
        apiThreadHasPost: false,
        apiThreadPostCount: 0,
        apiStateAfterRace: {
          completed: true,
          slots: [
            { role_revealed: true, alignment_revealed: true },
          ],
        },
      },
      stalePlayerComplete: {
        status: "passed",
        game: `${game}-player-complete-test`,
        setupCommandState: {
          actorSlot: "slot-7",
          gameCompleted: false,
          actions: [],
          voteTargets: [{ kind: "no_lynch", slotId: null, label: "No lynch" }],
        },
        setupButtons: [
          { action: "submit_vote:no_lynch", disabled: false },
          { action: "withdraw_vote", disabled: false },
          { action: "submit_post", disabled: false },
        ],
        staleVoteButton: { action: "submit_vote:no_lynch", disabled: false },
        closedStatus: { state: "closed" },
        liveComplete: {
          state: "ack",
          streamSeqs: [56],
        },
        reject: {
          state: "reject",
          error: "GameAlreadyCompleted",
          message: "Reject GameAlreadyCompleted: game already completed",
          serverEnvelope: { body: { kind: "Reject" } },
        },
        commandStateAfterReject: {
          gameCompleted: true,
          actions: [],
          voteTargets: [],
          boundary: "The game is complete; role actions, votes, and posts are closed.",
        },
        dispatchPlan: {
          projectionRefreshKeys: ["votecount", "commandState"],
        },
        buttonsAfterReject: [
          { action: "submit_vote", disabled: true },
          { action: "withdraw_vote", disabled: true },
          { action: "submit_post", disabled: true },
        ],
        currentVoteAfterReject: {
          hasVote: "false",
          text: "No current vote",
        },
        apiCommandStateAfterReject: {
          game_completed: true,
          actions: [],
          vote_targets: [],
        },
        stalePublicReloadAfterReject: {
          status: "passed",
          routeResponseStatus: 200,
          surfaceText:
            "Endgame\nThe game is complete.\nNo current vote\nNo older posts",
          threadPagerVisible: true,
          recoveredCommandState: {
            actorSlot: "slot-7",
            gameCompleted: true,
            actions: [],
            voteTargets: [],
            boundary:
              "The game is complete; role actions, votes, and posts are closed.",
          },
          reloadButtons: [
            { action: "submit_vote", disabled: true },
            { action: "withdraw_vote", disabled: true },
            { action: "submit_post", disabled: true },
          ],
          reloadCurrentVote: {
            hasVote: "false",
            text: "No current vote",
          },
          reloadThreadPostBodies: [],
          apiCommandStateAfterReload: {
            game_completed: true,
            actions: [],
            vote_targets: [],
          },
          apiThreadPostBodiesAfterReload: [],
          apiStateAfterReload: {
            completed: true,
            slots: [
              { role_revealed: true, alignment_revealed: true },
            ],
          },
        },
      },
      staleHostDeadline: {
        status: "passed",
        actionId: "extend_deadline",
        setup: {
          stalePhase: { id: "D01", locked: false },
          deadlineActions: ["extend_deadline"],
          phaseActions: ["resolve_phase", "lock_thread"],
          closedStatus: { state: "closed" },
        },
        reject: {
          state: "reject",
          error: "PhaseLocked",
          message:
            "Reject PhaseLocked: phase locked; stale phase state, refresh and use current controls",
        },
        commandOutcomes: [
          {
            actionId: "extend_deadline",
            state: "reject",
            error: "PhaseLocked",
          },
        ],
        phaseAfterReject: { id: "D02", locked: false },
        deadlineActionsAfterReject: ["extend_deadline"],
        phaseActionsAfterReject: ["resolve_phase", "lock_thread"],
        activityStatusText:
          "Reject PhaseLocked: phase locked; stale phase state, refresh and use current controls",
        activityRow: {
          source: "outcome",
          actionId: "extend_deadline",
          dispatchKind: "extend_deadline",
        },
        dispatchPlan: {
          projectionRefreshKeys: ["host"],
        },
        apiPhaseAfterReject: { phase_id: "D02", locked: false, deadline: null },
        staleHostDeadlineReloadAfterReject: {
          status: "passed",
          routeResponseStatus: 200,
          rejectReceiptStatusText:
            "Reject PhaseLocked: phase locked; stale phase state, refresh and use current controls",
          surfaceText: "Host console",
          phaseAfterReload: { id: "D02", locked: false },
          deadlineActionsAfterReload: ["extend_deadline"],
          phaseActionsAfterReload: ["resolve_phase", "lock_thread"],
          apiPhaseAfterReload: { phase_id: "D02", locked: false, deadline: null },
        },
        reconnectAfterReject: {
          status: "passed",
          game,
          reconnectingStatus: { state: "reconnecting" },
          reconnectRecoveryEvent: { attempt: 1, state: "recovered" },
          recoveredStatus: { state: "recovered" },
          recoveredHostProjection: {
            phase: { id: "D02", locked: false },
          },
        },
        deadlineActionsAfterReconnect: ["extend_deadline"],
        phaseActionsAfterReconnect: ["resolve_phase", "lock_thread"],
        apiPhaseAfterReconnect: { phase_id: "D02", locked: false, deadline: null },
      },
      staleCohostDeadline: {
        status: "passed",
        actionId: "extend_deadline",
        setup: {
          stalePhase: { id: "D01", locked: false },
          deadlineActions: ["extend_deadline"],
          phaseActions: [],
          closedStatus: { state: "closed" },
        },
        reject: {
          state: "reject",
          error: "PhaseLocked",
          message:
            "Reject PhaseLocked: phase locked; stale phase state, refresh and use current controls",
        },
        commandOutcomes: [
          {
            actionId: "extend_deadline",
            state: "reject",
            error: "PhaseLocked",
          },
        ],
        phaseAfterReject: { id: "D02", locked: false },
        deadlineActionsAfterReject: ["extend_deadline"],
        phaseActionsAfterReject: [],
        activityStatusText:
          "Reject PhaseLocked: phase locked; stale phase state, refresh and use current controls",
        activityRow: {
          source: "outcome",
          actionId: "extend_deadline",
          dispatchKind: "extend_deadline",
        },
        dispatchPlan: {
          projectionRefreshKeys: ["host"],
        },
        apiPhaseAfterReject: { phase_id: "D02", locked: false, deadline: null },
        staleCohostDeadlineReloadAfterReject: {
          status: "passed",
          routeResponseStatus: 200,
          rejectReceiptStatusText:
            "Reject PhaseLocked: phase locked; stale phase state, refresh and use current controls",
          surfaceText: "Host console",
          phaseAfterReload: { id: "D02", locked: false },
          deadlineActionsAfterReload: ["extend_deadline"],
          phaseActionsAfterReload: [],
          apiPhaseAfterReload: { phase_id: "D02", locked: false, deadline: null },
        },
        reconnectAfterReject: {
          status: "passed",
          game,
          reconnectingStatus: { state: "reconnecting" },
          reconnectRecoveryEvent: { attempt: 1, state: "recovered" },
          recoveredStatus: { state: "recovered" },
          recoveredHostProjection: {
            phase: { id: "D02", locked: false },
          },
        },
        deadlineActionsAfterReconnect: ["extend_deadline"],
        phaseActionsAfterReconnect: [],
        apiPhaseAfterReconnect: { phase_id: "D02", locked: false, deadline: null },
      },
    },
  };
  card.sessions.replacementPlayer =
    card.verification.replacementConsole.replacementSessionRefresh.session;
  card.verification.sessions.replacementPlayer =
    card.verification.replacementConsole.replacementSessionRefresh.browserEntry;
  const markdown = markdownSessionCard(card);
  assert(markdown.includes("# fmarch Dev Test Game"));
  assert(markdown.includes("Open a role login URL"));
  assert(markdown.includes("dev-test-card-host"));
  assert(markdown.includes("dev-test-card-cohost"));
  assert(markdown.includes("replacement-session-refresh-token"));
  assert(markdown.includes(`returnTo=%2Fg%2F${game}`));
  assert(markdown.includes("Credential token: dev-test-card-player"));
  assert(markdown.includes("## Proof Stability Audit"));
  assert(
    markdown.includes(
      "Host confirms: 4 total; 0 concurrent browser clicks; 1 retried; 0 DOM fallbacks; 0 force fallbacks",
    ),
  );
  assert(markdown.includes("resolve_phase host: playwright-retry after 2 attempts"));
  assert(markdown.includes("## Cohost Console Proof"));
  assert(markdown.includes("Extend deadline: Ack: stream seqs 41"));
  assert(markdown.includes("Host-only controls visible: false"));
  assert(markdown.includes("Host-only resolve: Reject NotHost: not host"));
  assert(markdown.includes("## Core Loop Proof"));
  assert(markdown.includes("Reject PhaseLocked: phase locked"));
  assert(markdown.includes("## Day Vote Resolution Proof"));
  assert(markdown.includes("Outcome: Lynch slot-2"));
  assert(markdown.includes("## Day Vote No-Lynch Proof"));
  assert(markdown.includes("Outcome: NoLynch 2"));
  assert(markdown.includes("## Action Loop Proof"));
  assert(markdown.includes("Reject InvalidTarget: invalid target"));
  assert(markdown.includes("## Invalid Action Recovery Proof"));
  assert(markdown.includes("Receipt: Reject InvalidTarget: invalid target"));
  assert(markdown.includes("Legal action visible: true"));
  assert(markdown.includes("## Resolution Receipt Proof"));
  assert(markdown.includes("Target notice: player_killed factional_kill"));
  assert(markdown.includes("Normal player notice leaked: false"));
  assert(markdown.includes("## Dead Player Recovery Proof"));
  assert(markdown.includes("Actor status: dead"));
  assert(markdown.includes("Direct vote: Reject SlotNotAlive: slot not alive"));
  assert(markdown.includes("Direct post: Reject SlotNotAlive: slot not alive"));
  assert(markdown.includes("Direct action: Reject SlotNotAlive: slot not alive"));
  assert(markdown.includes("## Player Action Boundary Proof"));
  assert(markdown.includes("Factional kill visible: false"));
  assert(markdown.includes("Direct factional kill: Reject InvalidTarget: invalid target"));
  assert(markdown.includes("## Private Channel Proof"));
  assert(markdown.includes("Denied route: 403 Back to board"));
  assert(markdown.includes("## Replacement Console Proof"));
  assert(markdown.includes("Host-issued invite: Replacement invite issued"));
  assert(
    markdown.includes(
      "Redeemed invite recovery: Session or invite token is missing, expired, or revoked",
    ),
  );
  assert(markdown.includes("Invalid replacement recovery: InvalidTarget"));
  assert(markdown.includes("Process replacement: Ack: stream seqs 44"));
  assert(markdown.includes("Projected occupant: player-rowan"));
  assert(markdown.includes("Replacement duplicate retry: Ack: stream seqs 44"));
  assert(markdown.includes("Stale host invite recovery: Player invite issued"));
  assert(
    markdown.includes(
      "Stale outgoing recovery: Reject NotYourSlot: not your slot; slot ownership changed, refresh and use current role surface",
    ),
  );
  assert(markdown.includes("Stale replacement recovery: InvalidTarget"));
  assert(markdown.includes("Incoming replacement: player-rowan Ack: stream seqs 45"));
  assert(markdown.includes("## Multiplayer Hardening Proof"));
  assert(markdown.includes("Duplicate retry: Ack: stream seqs 44"));
  assert(markdown.includes("Reconnect: attempt 1 recovered"));
  assert(markdown.includes("Stale player vote: Reject PhaseLocked"));
  assert(markdown.includes("Stale dead-target vote: Reject InvalidTarget"));
  assert(markdown.includes("Dead current vote: Slot 3 cleared"));
  assert(markdown.includes("Concurrent vote race: slot-3 count 2"));
  assert(markdown.includes("Concurrent player vote/resolve race: vote seq 47 before resolve seq 48"));
  assert(markdown.includes("Concurrent player action/advance race: Reject PhaseLocked"));
  assert(markdown.includes("Concurrent cohost deadline/resolve race: deadline seq 53 before resolve seq 54"));
  assert(markdown.includes("Concurrent host resolve race: Reject PhaseLocked"));
  assert(markdown.includes("Concurrent host advance race: Reject InvalidTarget"));
  assert(markdown.includes("Host lifecycle: Ack: stream seqs 48"));
  assert(markdown.includes("Stale host lifecycle: Reject InvalidTarget"));
  assert(markdown.includes("Host modkill: Ack: stream seqs 49"));
  assert(markdown.includes("Stale host modkill: Reject InvalidTarget"));
  assert(markdown.includes("Concurrent host lifecycle race: Reject InvalidTarget"));
  assert(
    markdown.includes(
      "Concurrent player complete race: post rejected GameAlreadyCompleted after completion",
    ),
  );
  assert(markdown.includes("Concurrent host publish race: Reject InvalidTarget"));
  assert(markdown.includes("Stale action conflict: Reject PhaseLocked"));
  assert(markdown.includes("Stale control: Reject PhaseLocked"));
  assert(markdown.includes("Stale host resolve: Reject PhaseLocked"));
  assert(markdown.includes("Stale host publish: Reject InvalidTarget"));
  assert(markdown.includes("Stale host complete: Reject GameAlreadyCompleted"));
  assert(markdown.includes("Stale player complete: Reject GameAlreadyCompleted"));
  assert(markdown.includes("Stale host deadline: Reject PhaseLocked"));
  assert(markdown.includes("Stale cohost deadline: Reject PhaseLocked"));
  const proofRun = buildDevTestGameProofRun(card, {
    generatedAt: "2026-06-26T00:00:00.000Z",
  });
  assertDevTestGameProofRun(proofRun);
  assert.equal(proofRun.status, "passed");
  assert.equal(proofRun.productionReady, false);
  assert.equal(proofRun.releaseReady, false);
  assert.deepEqual(
    proofRun.lanes.map((lane) => lane.id),
    [
      "browser-entry",
      "cohost-console",
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
      "replacement-host-issued-invite",
      "replacement-pending-player",
      "replacement-redeemed-invite-recovery",
      "replacement-session-revocation-recovery",
      "replacement-session-refresh-recovery",
      "replacement-stale-session-after-refresh",
      "replacement-reconnect-recovery",
      "stale-host-invite-recovery",
      "replacement-stale-conflict-message",
      "replacement-invalid-target-recovery",
      "replacement-console",
      "replacement-idempotent-retry",
      "replacement-stale-success-recovery",
      "replacement-stale-player",
      "replacement-stale-action",
      "replacement-stale-private-channel",
      "replacement-stale-private-receipts",
      "replacement-incoming-player",
      "idempotent-retry",
      "action-idempotent-retry",
      "concurrent-action-race",
      "concurrent-action-race-reload",
      "reconnect-recovery",
      "stale-player-vote",
      "stale-player-vote-after-change",
      "stale-player-withdraw-after-change",
      "stale-player-withdraw-after-phase-closure",
      "stale-player-vote-after-phase-closure",
      "stale-player-post-after-phase-closure",
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
      "stale-dead-target-vote",
      "dead-current-vote",
      "concurrent-vote-race",
      "concurrent-vote-race-reload",
      "stale-host-publish-after-change",
      "host-votecount-publication",
      "concurrent-host-publish-race",
      "concurrent-host-publish-race-reload",
      "stale-host-publish",
      "host-lifecycle-control",
      "stale-host-lifecycle",
      "host-modkill-control",
      "stale-host-modkill",
      "concurrent-host-lifecycle-race",
      "concurrent-host-lifecycle-race-reload",
      "stale-host-prompt",
      "stale-host-prompt-reload",
      "stale-host-complete",
      "stale-host-complete-reload",
      "stale-host-complete-reconnect-recovery",
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
      "stale-action-reconnect-recovery",
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
      "stale-host-resolve-reconnect-recovery",
      "stale-host-advance",
      "stale-host-advance-reload",
      "stale-host-advance-reconnect-recovery",
      "stale-host-deadline",
      "stale-host-deadline-reload",
      "stale-host-deadline-reconnect-recovery",
      "stale-cohost-deadline",
      "stale-cohost-deadline-reload",
      "stale-cohost-deadline-reconnect-recovery",
    ],
  );
  const raceCoverage = buildDevTestGameRaceCoverage(proofRun, {
    generatedAt: "2026-06-26T00:00:00.000Z",
  });
  assertDevTestGameRaceCoverage(raceCoverage);
  assert.equal(raceCoverage.status, "passed");
  assert.equal(raceCoverage.releaseReady, false);
  assert.equal(raceCoverage.productionReady, false);
  assert.equal(raceCoverage.summary.cellCount, 16);
  assert.equal(raceCoverage.summary.provenCellCount, 16);
  assert.equal(raceCoverage.summary.reloadRequiredCellCount, 16);
  assert.equal(raceCoverage.summary.reloadCoveredCellCount, 16);
  assert.equal(raceCoverage.summary.reloadGapCount, 0);
  assert.deepEqual(
    raceCoverage.cells
      .filter((cell) => cell.actorPair === "host vs host")
      .map((cell) => cell.id),
    [
      "host-resolve",
      "host-advance",
      "host-deadline-advance",
      "host-lifecycle",
      "host-mixed-advance",
      "host-votecount-publication",
      "host-complete-game",
    ],
  );
  const readiness = buildDevTestGameReleaseReadiness(proofRun, {
    generatedAt: "2026-06-26T00:00:00.000Z",
  });
  assertDevTestGameReleaseReadiness(readiness);
  assert.equal(readiness.status, "passed");
  assert.equal(readiness.releaseReady, false);
  assert.equal(readiness.productionReady, false);
  assert.equal(readiness.releaseReadiness.status, "not_ready");
  assert(
    readiness.releaseReadiness.unproven.some(
      (item) => item.id === "production-identity" && item.status === "unproven",
    ),
  );
  assert(
    readiness.releaseReadiness.unproven.some(
      (item) => item.id === "backup-restore-drill" && item.status === "unproven",
    ),
  );
  const coreLoopReadiness = buildDevTestGameReleaseReadiness(proofRun, {
    generatedAt: "2026-06-26T00:00:00.000Z",
    coreLoopAdminProofPath: "target/dev-test-game/core-loop-admin-proof.json",
    coreLoopAdminProof: coreLoopAdminProofFixture(),
  });
  assertDevTestGameReleaseReadiness(coreLoopReadiness);
  assert.equal(
    coreLoopReadiness.localDevelopmentSpine.checks.find(
      (item) => item.id === "local-core-loop-proof",
    ).adminRoleSurface.detailRoleUrl,
    "/admin/audit/local-core-loop?game=<seeded-game>",
  );
  assert.equal(
    coreLoopReadiness.generatedFrom.coreLoopAdminProof,
    "target/dev-test-game/core-loop-admin-proof.json",
  );
  const hardeningReadiness = buildDevTestGameReleaseReadiness(proofRun, {
    generatedAt: "2026-06-26T00:00:00.000Z",
    hardeningAdminProofPath: "target/dev-test-game/hardening-admin-proof.json",
    hardeningAdminProof: hardeningAdminProofFixture(),
  });
  assertDevTestGameReleaseReadiness(hardeningReadiness);
  assert.equal(
    hardeningReadiness.localDevelopmentSpine.checks.find(
      (item) => item.id === "local-hardening-proof",
    ).adminRoleSurface.detailRoleUrl,
    "/admin/audit/local-hardening?game=<seeded-game>",
  );
  assert.equal(
    hardeningReadiness.generatedFrom.hardeningAdminProof,
    "target/dev-test-game/hardening-admin-proof.json",
  );
  const raceCoverageReadiness = buildDevTestGameReleaseReadiness(proofRun, {
    generatedAt: "2026-06-26T00:00:00.000Z",
    raceCoveragePath: "target/dev-test-game/race-coverage.json",
    raceCoverage,
    raceCoverageAdminProofPath: "target/dev-test-game/race-coverage-admin-proof.json",
    raceCoverageAdminProof: raceCoverageAdminProofFixture(),
  });
  assertDevTestGameReleaseReadiness(raceCoverageReadiness);
  assert.equal(
    raceCoverageReadiness.localDevelopmentSpine.checks.find(
      (item) => item.id === "local-race-coverage-inventory",
    ).cellCount,
    16,
  );
  assert.equal(
    raceCoverageReadiness.localDevelopmentSpine.checks.find(
      (item) => item.id === "local-race-coverage-inventory",
    ).adminRoleSurface.detailRoleUrl,
    "/admin/audit/local-race-coverage?game=<seeded-game>",
  );
  assert.equal(
    raceCoverageReadiness.generatedFrom.raceCoverage,
    "target/dev-test-game/race-coverage.json",
  );
  assert.equal(
    raceCoverageReadiness.generatedFrom.raceCoverageAdminProof,
    "target/dev-test-game/race-coverage-admin-proof.json",
  );
  assert.deepEqual(
    raceCoverageReadiness.generatedFrom.hostConcurrentRaceReloadMilestone,
    {
      status: "passed",
      cellIds: hostConcurrentRaceReloadCellIdsFixture(),
      requiredCellCount: 7,
      coveredCellCount: 7,
      gapCount: 0,
    },
  );
  assert.deepEqual(
    raceCoverageReadiness.generatedFrom.playerConcurrentActionReloadMilestone,
    {
      status: "passed",
      cellIds: playerConcurrentActionReloadCellIdsFixture(),
      requiredCellCount: 5,
      coveredCellCount: 5,
      gapCount: 0,
    },
  );
  assert.deepEqual(
    raceCoverageReadiness.generatedFrom.cohostDeadlineRaceReloadMilestone,
    {
      status: "passed",
      cellIds: cohostDeadlineRaceReloadCellIdsFixture(),
      requiredCellCount: 1,
      coveredCellCount: 1,
      gapCount: 0,
    },
  );
  assert.deepEqual(
    raceCoverageReadiness.generatedFrom.raceCoveragePromotedMilestones,
    raceCoveragePromotedMilestonesFixture({ groupStatus: "passed" }),
  );
  assert.equal(
    raceCoverageReadiness.localDevelopmentSpine.checks.find(
      (item) => item.id === "local-host-concurrent-race-reload-milestone",
    ).coveredCellCount,
    7,
  );
  assert.equal(
    raceCoverageReadiness.localDevelopmentSpine.checks.find(
      (item) => item.id === "local-player-concurrent-action-reload-milestone",
    ).coveredCellCount,
    5,
  );
  assert.equal(
    raceCoverageReadiness.localDevelopmentSpine.checks.find(
      (item) => item.id === "local-cohost-deadline-race-reload-milestone",
    ).coveredCellCount,
    1,
  );
  assert.equal(
    raceCoverageReadiness.localDevelopmentSpine.checks.find(
      (item) => item.id === "local-race-coverage-promoted-milestones",
    ).passedGroupCount,
    4,
  );
  assert(
    raceCoverageReadiness.releaseReadiness.unproven.some(
      (item) =>
        item.id === "hosted-concurrent-race-matrix" &&
        item.requiredEvidence.includes("Hosted or hosted-like concurrent command race matrix"),
    ),
  );
  const hostedMatrix =
    buildDevTestGameHostedConcurrentRaceMatrixEvidence(raceCoverageReadiness, {
      raceCoverage,
      proofRun,
      session: card,
      generatedAt: "2026-06-26T00:00:00.000Z",
      hostedTarget: {
        frontendBaseUrl: null,
        apiBaseUrl: null,
        evidencePath: null,
        evidence: undefined,
      },
    });
  assertDevTestGameHostedConcurrentRaceMatrixEvidence(hostedMatrix);
  assert.equal(hostedMatrix.status, "passed");
  assert.equal(hostedMatrix.releaseReady, false);
  assert.equal(
    hostedMatrix.requestedEvidence.firstProofTarget,
    devTestGameHostedConcurrentRaceMatrixPath,
  );
  assert.equal(hostedMatrix.summary.cellCount, 16);
  assert.equal(hostedMatrix.summary.reloadCoveredCellCount, 16);
  assert.equal(hostedMatrix.summary.reconnectLaneCount, 10);
  assert.equal(hostedMatrix.summary.staleConflictLaneCount, 4);
  assert.equal(hostedMatrix.summary.hostedEvidenceStatus, "not_configured");
  assert.equal(hostedMatrix.summary.realHostedDeploymentStatus, "unproven");
  assert.equal(hostedMatrix.externalHostedEvidence.status, "not_configured");
  assert(
    hostedMatrix.hostedLikeTarget.roleSurfaces.every(
      (surface) =>
        surface.directUrl.startsWith("http://") &&
        !surface.directUrl.includes("invite=") &&
        !("token" in surface) &&
        !("inviteToken" in surface) &&
        !("loginUrl" in surface),
    ),
  );
  assert.deepEqual(
    hostedMatrix.generatedFrom.raceCoveragePromotedMilestones.groupIds,
    [
      "replacement-race-reload",
      "host-concurrent-race-reload",
      "player-concurrent-action-reload",
      "cohost-deadline-race-reload",
    ],
  );
  assert.deepEqual(
    hostedMatrix.evidenceProgress.map((item) => [item.id, item.status]),
    [
      ["hosted-like-api-frontend-target", "passed"],
      ["multi-session-concurrent-command-matrix", "passed"],
      ["reload-recovery-after-races", "passed"],
      ["reconnect-recovery", "passed"],
      ["stale-client-conflict-messages", "passed"],
      ["raw-role-credential-redaction", "passed"],
      ["real-hosted-deployment", "unproven"],
    ],
  );
  const hostedMatrixWithExternalTarget =
    buildDevTestGameHostedConcurrentRaceMatrixEvidence(raceCoverageReadiness, {
      raceCoverage,
      proofRun,
      session: card,
      generatedAt: "2026-06-26T00:00:00.000Z",
      hostedTarget: {
        frontendBaseUrl: "https://fmarch.example.test",
        apiBaseUrl: "https://api.fmarch.example.test",
        evidencePath: "target/dev-test-game/hosted-matrix-external.json",
        evidence: {
          proof: "fmarch-hosted-concurrent-race-matrix-evidence",
          status: "passed",
          generatedAt: "2026-06-26T00:00:00.000Z",
          frontendBaseUrl: "https://fmarch.example.test",
          apiBaseUrl: "https://api.fmarch.example.test",
          groupIds: ["replacement-race-reload"],
          cellIds: ["replacement-private-post"],
          commandRaceCount: 1,
          reloadRecoveryCount: 1,
          reconnectRecovery: true,
          staleConflictMessages: true,
          rawRoleCredentialsRedacted: true,
        },
      },
    });
  assertDevTestGameHostedConcurrentRaceMatrixEvidence(
    hostedMatrixWithExternalTarget,
  );
  assert.equal(
    hostedMatrixWithExternalTarget.summary.hostedEvidenceStatus,
    "passed",
  );
  assert.equal(hostedMatrixWithExternalTarget.externalHostedEvidence.status, "passed");
  assert.deepEqual(
    hostedMatrixWithExternalTarget.evidenceProgress.find(
      (item) => item.id === "real-hosted-deployment",
    ),
    {
      id: "real-hosted-deployment",
      status: "passed",
      evidence: [
        "https://fmarch.example.test",
        "https://api.fmarch.example.test",
        "target/dev-test-game/hosted-matrix-external.json",
      ],
      requiredEvidence:
        "Externally reachable hosted API/frontend deployment, multi-node command race execution, and hosted reconnect/stale-client evidence.",
    },
  );
  assert.deepEqual(hostedMatrixWithExternalTarget.remainingGaps, [
    "beta/release/operator readiness and human rollback path",
  ]);
  const rawEvidence = buildDevTestGameHostedMatrixRawEvidence({
    matrix: hostedMatrix,
    generatedAt: "2026-06-26T00:00:00.000Z",
    frontendBaseUrl: hostedMatrix.hostedLikeTarget.frontendBaseUrl,
    apiBaseUrl: hostedMatrix.hostedLikeTarget.apiBaseUrl,
  });
  assertDevTestGameHostedMatrixRawEvidence(rawEvidence, {
    frontendBaseUrl: hostedMatrix.hostedLikeTarget.frontendBaseUrl,
    apiBaseUrl: hostedMatrix.hostedLikeTarget.apiBaseUrl,
  });
  assert.equal(
    devTestGameHostedMatrixRawEvidenceCommand,
    "test:dev-test-game-hosted-matrix-raw-evidence",
  );
  assert.equal(
    devTestGameHostedMatrixRawEvidencePath,
    "target/dev-test-game/hosted-matrix-raw.json",
  );
  assert.deepEqual(
    rawEvidence.observations.map((observation) => observation.cellId),
    [
      "replacement-private-post",
      "replacement-vote",
      "replacement-action",
    ],
  );
  const externalEvidence =
    buildDevTestGameHostedMatrixExternalEvidence({
      matrix: hostedMatrix,
      rawEvidence,
      generatedAt: "2026-06-26T00:00:00.000Z",
      frontendBaseUrl: hostedMatrix.hostedLikeTarget.frontendBaseUrl,
      apiBaseUrl: hostedMatrix.hostedLikeTarget.apiBaseUrl,
      rawEvidenceSource: "target/dev-test-game/hosted-matrix-raw.json",
    });
  assertDevTestGameHostedMatrixExternalEvidence(externalEvidence, {
    frontendBaseUrl: hostedMatrix.hostedLikeTarget.frontendBaseUrl,
    apiBaseUrl: hostedMatrix.hostedLikeTarget.apiBaseUrl,
  });
  assert.equal(externalEvidence.proof, "fmarch-hosted-concurrent-race-matrix-evidence");
  assert.deepEqual(externalEvidence.groupIds, ["replacement-race-reload"]);
  assert.deepEqual(externalEvidence.cellIds, [
    "replacement-private-post",
    "replacement-vote",
    "replacement-action",
  ]);
  assert.equal(
    devTestGameHostedMatrixExternalEvidenceCommand,
    "test:dev-test-game-hosted-matrix-external-evidence",
  );
  assert.equal(
    devTestGameHostedMatrixExternalEvidencePath,
    "target/dev-test-game/hosted-matrix-external.json",
  );
  const laneFrontendBaseUrl = "https://fmarch.example.test";
  const laneApiBaseUrl = "https://api.fmarch.example.test";
  const laneRawEvidence = {
    ...rawEvidence,
    frontendBaseUrl: laneFrontendBaseUrl,
    apiBaseUrl: laneApiBaseUrl,
  };
  assertDevTestGameHostedMatrixRawEvidence(laneRawEvidence, {
    frontendBaseUrl: laneFrontendBaseUrl,
    apiBaseUrl: laneApiBaseUrl,
  });
  await mkdir("target/dev-test-game", { recursive: true });
  await Promise.all([
    writeFile(
      devTestGameHostedConcurrentRaceMatrixPath,
      `${JSON.stringify(hostedMatrix, null, 2)}\n`,
    ),
    writeFile(
      devTestGameHostedMatrixRawEvidencePath,
      `${JSON.stringify(laneRawEvidence, null, 2)}\n`,
    ),
  ]);
  const passedLaneExternalEvidencePath =
    "target/dev-test-game/hosted-matrix-external-lane-pass.json";
  const passedLane = await runDevTestGameHostedEvidenceLane({
    generatedAt: "2026-06-26T00:00:00.000Z",
    env: {
      FMARCH_HOSTED_MATRIX_FRONTEND_URL: laneFrontendBaseUrl,
      FMARCH_HOSTED_MATRIX_API_URL: laneApiBaseUrl,
      FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH:
        devTestGameHostedMatrixRawEvidencePath,
      FMARCH_HOSTED_MATRIX_EVIDENCE_PATH: passedLaneExternalEvidencePath,
    },
  });
  assertDevTestGameHostedEvidenceLane(passedLane);
  assert.equal(passedLane.status, "passed");
  assert.equal(passedLane.preflightStatus, "passed");
  assert.deepEqual(passedLane.blockedCheckIds, []);
  assert.equal(
    passedLane.nextCommand,
    `npm run ${devTestGameHostedMatrixExternalEvidenceCommand}`,
  );
  assert.equal(passedLane.nextProofTarget, passedLaneExternalEvidencePath);
  assert.deepEqual(
    passedLane.checks.map((check) => [check.id, check.status]),
    [
      ["hosted-target-preflight", "passed"],
      ["external-hosted-evidence-written", "passed"],
      ["release-claim-boundary-carried", "passed"],
    ],
  );
  const passedLanePreflight = assertDevTestGameHostedTargetPreflight(
    JSON.parse(await readFile(devTestGameHostedTargetPreflightPath, "utf8")),
  );
  assert.equal(passedLanePreflight.status, "passed");
  assert.equal(
    passedLanePreflight.nextProofTarget,
    devTestGameHostedMatrixExternalEvidencePath,
  );
  const passedLaneExternalEvidence =
    assertDevTestGameHostedMatrixExternalEvidence(
      JSON.parse(await readFile(passedLaneExternalEvidencePath, "utf8")),
      {
        frontendBaseUrl: laneFrontendBaseUrl,
        apiBaseUrl: laneApiBaseUrl,
      },
    );
  assert.deepEqual(passedLaneExternalEvidence.generatedFrom, {
    hostedConcurrentRaceMatrix: devTestGameHostedConcurrentRaceMatrixPath,
    hostedConcurrentRaceMatrixGeneratedAt: hostedMatrix.generatedAt,
    rawEvidence: devTestGameHostedMatrixRawEvidencePath,
    rawEvidenceGeneratedAt: laneRawEvidence.generatedAt,
  });
  const laneFreshManifest = buildDevTestGameSpineManifest({
    generatedAt: "2026-06-26T00:00:00.000Z",
    proofFreshness: {
      version: 1,
      proof: "dev-test-game-proof-freshness",
      status: "passed",
      generatedAt: "2026-06-26T00:00:00.000Z",
      maxAgeHours: 24,
      proofBoundary: "test freshness boundary",
      summary: {
        artifactCount: 1,
        freshCount: 1,
        staleCount: 0,
        missingCount: 0,
      },
      artifacts: [
        {
          id: "spine-manifest",
          label: "Spine manifest",
          path: "target/dev-test-game/spine-manifest.json",
          status: "fresh",
        },
      ],
    },
  });
  const passedLaneNextAction = buildDevTestGameNextAction(laneFreshManifest, {
    generatedAt: "2026-06-26T00:00:01.000Z",
    opsArtifacts: devTestGameOpsArtifactsFixture(),
    raceCoverage: devTestGameRaceCoverageFixture(),
    releaseReadinessChecklist: devTestGameReleaseReadinessChecklistFixture({
      unproven: [
        {
          id: "hosted-deployment",
          status: "unproven",
          requiredEvidence:
            "Hosted API/frontend deployment proof with external health checks",
        },
      ],
    }),
    hostedTargetPreflight: passedLanePreflight,
  });
  assertDevTestGameNextAction(passedLaneNextAction);
  assert.equal(
    passedLaneNextAction.nextAction.unproven.proofTarget,
    devTestGameHostedMatrixExternalEvidencePath,
  );
  assert.equal(
    passedLaneNextAction.nextAction.unproven.roleUrl,
    "/admin/audit/local-hosted-concurrent-race-matrix?game=<seeded-game>",
  );
  assert.equal(
    passedLaneNextAction.nextAction.unproven.proofGraphNodeId,
    "admin-proof:hosted-concurrent-race-matrix",
  );
  const demoProof = await runDevTestGameHostedEvidenceLaneDemoProof({
    generatedAt: "2026-06-26T00:00:00.000Z",
  });
  assertDevTestGameHostedEvidenceLaneDemoProof(demoProof);
  assert.equal(
    devTestGameHostedEvidenceLaneDemoProofCommand,
    "test:dev-test-game-hosted-evidence-lane-demo-proof",
  );
  assert.equal(
    devTestGameHostedEvidenceLaneDemoProofPath,
    "target/dev-test-game/hosted-evidence-lane-demo-proof.json",
  );
  assert.equal(
    demoProof.generatedFrom.rawEvidence,
    devTestGameHostedEvidenceLaneDemoRawEvidencePath,
  );
  assert.equal(
    demoProof.generatedFrom.externalEvidence,
    devTestGameHostedEvidenceLaneDemoExternalEvidencePath,
  );
  assert.equal(demoProof.target.syntheticExternalTarget, true);
  assert.equal(demoProof.blockedLane.status, "blocked");
  assert.equal(demoProof.passedLane.status, "passed");
  assert.equal(
    demoProof.handoff.blockedRoleUrl,
    "/admin/audit/local-hosted-evidence-lane?game=<seeded-game>",
  );
  assert.equal(
    demoProof.handoff.passedRoleUrl,
    "/admin/audit/local-hosted-concurrent-race-matrix?game=<seeded-game>",
  );
  assert.equal(
    demoProof.externalEvidence.rawRoleCredentialsRedacted,
    true,
  );
  const hostedMatrixWithProducedExternalEvidence =
    buildDevTestGameHostedConcurrentRaceMatrixEvidence(raceCoverageReadiness, {
      raceCoverage,
      proofRun,
      session: card,
      generatedAt: "2026-06-26T00:00:00.000Z",
      hostedTarget: {
        frontendBaseUrl: hostedMatrix.hostedLikeTarget.frontendBaseUrl,
        apiBaseUrl: hostedMatrix.hostedLikeTarget.apiBaseUrl,
        evidencePath: devTestGameHostedMatrixExternalEvidencePath,
        evidence: externalEvidence,
      },
    });
  assert.equal(
    hostedMatrixWithProducedExternalEvidence.externalHostedEvidence.status,
    "passed",
  );
  assert.equal(
    hostedMatrixWithProducedExternalEvidence.summary.hostedEvidenceStatus,
    "passed",
  );
  assert.equal(
    hostedMatrixWithProducedExternalEvidence.summary.realHostedDeploymentStatus,
    "unproven",
  );
  assert.equal(
    hostedMatrixWithProducedExternalEvidence.evidenceProgress.find(
      (item) => item.id === "real-hosted-deployment",
    ).status,
    "unproven",
  );
  const hostedMatrixReadiness = buildDevTestGameReleaseReadiness(proofRun, {
    generatedAt: "2026-06-26T00:00:00.000Z",
    raceCoveragePath: "target/dev-test-game/race-coverage.json",
    raceCoverage,
    hostedConcurrentRaceMatrixPath: devTestGameHostedConcurrentRaceMatrixPath,
    hostedConcurrentRaceMatrix: hostedMatrix,
    hostedConcurrentRaceMatrixAdminProofPath:
      "target/dev-test-game/hosted-concurrent-race-matrix-admin-proof.json",
    hostedConcurrentRaceMatrixAdminProof:
      hostedConcurrentRaceMatrixAdminProofFixture(),
  });
  assertDevTestGameReleaseReadiness(hostedMatrixReadiness);
  assert(
    hostedMatrixReadiness.localDevelopmentSpine.checks.some(
      (item) =>
        item.id === "local-hosted-concurrent-race-matrix" &&
        item.status === "passed" &&
        item.cellCount === 16,
    ),
  );
  assert.equal(
    hostedMatrixReadiness.releaseReadiness.unproven.some(
      (item) => item.id === "hosted-concurrent-race-matrix",
    ),
    false,
  );
  assert(
    hostedMatrixReadiness.releaseReadiness.unproven.some(
      (item) =>
        item.id === "real-hosted-concurrent-race-matrix" &&
        item.status === "unproven",
    ),
  );
  const refreshedHostedMatrix =
    buildDevTestGameHostedConcurrentRaceMatrixEvidence(hostedMatrixReadiness, {
      raceCoverage,
      proofRun,
      session: card,
      generatedAt: "2026-06-26T00:00:00.000Z",
    });
  assertDevTestGameHostedConcurrentRaceMatrixEvidence(refreshedHostedMatrix);
  assert.equal(
    refreshedHostedMatrix.requestedEvidence.id,
    "real-hosted-concurrent-race-matrix",
  );
  const opsArtifacts = buildDevTestGameOpsArtifacts({
    session: card,
    proofRun,
    readiness,
    generatedAt: "2026-06-26T00:00:00.000Z",
    artifacts: {
      session: artifactSummary("target/dev-test-game/session.json"),
      proofRun: artifactSummary("target/dev-test-game/proof-run.json"),
      readiness: artifactSummary(
        "target/dev-test-game/release-readiness-checklist.json",
      ),
    },
  });
  assertDevTestGameOpsArtifacts(opsArtifacts);
  assert.equal(opsArtifacts.status, "passed");
  assert.equal(opsArtifacts.releaseReady, false);
  assert.equal(opsArtifacts.productionReady, false);
  assert.equal(opsArtifacts.run.game, game);
  assert.equal(opsArtifacts.run.seedCommandCount, 1);
  assert.equal(opsArtifacts.proofRun.laneCount, 113);
  assert.equal(opsArtifacts.proofStability.hostConfirmClicks.total, 4);
  assert.equal(
    opsArtifacts.checks.some(
      (check) =>
        check.id === "proof-stability-summarized" &&
        check.hostConfirmClicks === 4 &&
        check.concurrentClickCount === 0 &&
        check.retryClickCount === 1,
    ),
    true,
  );
  assert.equal(
    opsArtifacts.roles.host.loginUrlRedacted,
    `http://127.0.0.1:4102/auth/login?returnTo=%2Fg%2F${game}%2Fhost&invite=REDACTED`,
  );
  assert.equal(opsArtifacts.roles.replacementPlayer.credentialKind, "session");
  assert.equal(
    opsArtifacts.roles.replacementPlayer.loginUrlRedacted,
    `http://127.0.0.1:4102/auth/login?returnTo=%2Fg%2F${game}`,
  );
  assert.equal(
    opsArtifacts.roles.replacementPlayer.loginUrlRedacted.includes("invite="),
    false,
  );
  assert.equal(JSON.stringify(opsArtifacts).includes("dev-test-card-host"), false);
  assert.equal(JSON.stringify(opsArtifacts).includes("dev-test-card-player"), false);
  assert.equal(
    JSON.stringify(opsArtifacts).includes("replacement-session-refresh-token"),
    false,
  );
  const opsReadiness = buildDevTestGameReleaseReadiness(proofRun, {
    generatedAt: "2026-06-26T00:00:00.000Z",
    opsArtifactsPath: "target/dev-test-game/ops-artifacts.json",
    opsArtifacts,
    opsAdminProofPath: "target/dev-test-game/ops-admin-proof.json",
    opsAdminProof: opsAdminProofFixture(),
  });
  assertDevTestGameReleaseReadiness(opsReadiness);
  assert(
    opsReadiness.localDevelopmentSpine.checks.some(
      (item) => item.id === "local-ops-artifact-bundle" && item.status === "passed",
    ),
  );
  assert.equal(
    opsReadiness.localDevelopmentSpine.checks.find(
      (item) => item.id === "local-ops-artifact-bundle",
    ).adminRoleSurface.detailRoleUrl,
    "/admin/audit/local-ops-artifacts?game=<seeded-game>",
  );
  assert.equal(
    opsReadiness.releaseReadiness.unproven.some(
      (item) => item.id === "observability-and-operations",
    ),
    false,
  );
  assert(
    opsReadiness.releaseReadiness.unproven.some(
      (item) =>
        item.id === "hosted-observability-and-operations" &&
        item.status === "unproven",
    ),
  );
  const hostedOpsSignals = buildDevTestGameHostedOpsSignals({
    opsArtifacts,
    hostedConcurrentRaceMatrix: hostedMatrix,
    readiness: opsReadiness,
    generatedAt: "2026-06-26T00:00:00.000Z",
    artifacts: {
      opsArtifacts: artifactSummary("target/dev-test-game/ops-artifacts.json"),
      hostedConcurrentRaceMatrix: artifactSummary(
        "target/dev-test-game/hosted-concurrent-race-matrix.json",
      ),
      readiness: artifactSummary(
        "target/dev-test-game/release-readiness-checklist.json",
      ),
    },
  });
  assertDevTestGameHostedOpsSignals(hostedOpsSignals);
  assert.equal(devTestGameHostedOpsSignalsCommand, "test:dev-test-game-hosted-ops-signals");
  assert.equal(
    devTestGameHostedOpsSignalsPath,
    "target/dev-test-game/hosted-ops-signals.json",
  );
  assert.equal(hostedOpsSignals.matrix.cellCount, 16);
  assert.equal(
    hostedOpsSignals.checks.find((check) => check.id === "hosted-telemetry-boundary-carried")
      .status,
    "unproven",
  );
  const hostedOpsReadiness = buildDevTestGameReleaseReadiness(proofRun, {
    generatedAt: "2026-06-26T00:00:00.000Z",
    opsArtifactsPath: "target/dev-test-game/ops-artifacts.json",
    opsArtifacts,
    hostedOpsSignalsPath: devTestGameHostedOpsSignalsPath,
    hostedOpsSignals,
    hostedOpsSignalsAdminProofPath:
      "target/dev-test-game/hosted-ops-signals-admin-proof.json",
    hostedOpsSignalsAdminProof: hostedOpsSignalsAdminProofFixture(),
  });
  assertDevTestGameReleaseReadiness(hostedOpsReadiness);
  assert(
    hostedOpsReadiness.localDevelopmentSpine.checks.some(
      (item) =>
        item.id === "local-hosted-ops-signals" &&
        item.status === "passed" &&
        item.cellCount === 16,
    ),
  );
  assert.equal(
    hostedOpsReadiness.releaseReadiness.unproven.some(
      (item) => item.id === "hosted-observability-and-operations",
    ),
    false,
  );
  assert(
    hostedOpsReadiness.releaseReadiness.unproven.some(
      (item) =>
        item.id === "real-hosted-observability-and-operations" &&
        item.status === "unproven",
    ),
  );
  const hostedEvidenceLaneReadiness = buildDevTestGameReleaseReadiness(proofRun, {
    generatedAt: "2026-06-26T00:00:00.000Z",
    hostedEvidenceLaneAdminProofPath:
      "target/dev-test-game/hosted-evidence-lane-admin-proof.json",
    hostedEvidenceLaneAdminProof: hostedEvidenceLaneAdminProofFixture(),
  });
  assertDevTestGameReleaseReadiness(hostedEvidenceLaneReadiness);
  const hostedEvidenceLaneCheck =
    hostedEvidenceLaneReadiness.localDevelopmentSpine.checks.find(
      (item) => item.id === "local-hosted-evidence-lane-admin-surface",
    );
  assert.equal(hostedEvidenceLaneCheck.status, "passed");
  assert.equal(hostedEvidenceLaneCheck.laneStatus, "blocked");
  assert.equal(hostedEvidenceLaneCheck.preflightStatus, "blocked");
  assert.equal(hostedEvidenceLaneCheck.blockedCheckCount, 5);
  assert.equal(
    hostedEvidenceLaneCheck.adminRoleSurface.detailRoleUrl,
    "/admin/audit/local-hosted-evidence-lane?game=<seeded-game>",
  );
  assert.equal(
    hostedEvidenceLaneCheck.adminRoleSurface.preflightStatus,
    "blocked",
  );
  const seedFixture = buildDevTestGameSeedFixtureSummary({
    session: card,
    proofRun,
    readiness: opsReadiness,
    generatedAt: "2026-06-26T00:00:00.000Z",
  });
  assertDevTestGameSeedFixtureSummary(seedFixture);
  assert.equal(seedFixture.status, "passed");
  assert.equal(seedFixture.releaseReady, false);
  assert.equal(seedFixture.productionReady, false);
  assert.equal(seedFixture.fixture.game, game);
  assert.equal(seedFixture.fixture.slots.length, 5);
  assert.equal(
    seedFixture.fixture.roles.host.loginUrlRedacted,
    `http://127.0.0.1:4102/auth/login?returnTo=%2Fg%2F${game}%2Fhost&invite=REDACTED`,
  );
  assert.equal(seedFixture.fixture.roles.replacementPlayer.credentialKind, "session");
  assert.equal(
    seedFixture.fixture.roles.replacementPlayer.loginUrlRedacted,
    `http://127.0.0.1:4102/auth/login?returnTo=%2Fg%2F${game}`,
  );
  assert.equal(
    seedFixture.fixture.roles.replacementPlayer.loginUrlRedacted.includes("invite="),
    false,
  );
  assert.equal(JSON.stringify(seedFixture).includes("dev-test-card-host"), false);
  assert.equal(JSON.stringify(seedFixture).includes("dev-test-card-player"), false);
  assert.equal(
    JSON.stringify(seedFixture).includes("replacement-session-refresh-token"),
    false,
  );
  assert.deepEqual(
    seedFixture.demoScenarios.map((scenario) => scenario.id),
    [
      "host-phase-controls",
      "cohost-deadline-control",
      "player-vote-recovery",
      "day-vote-resolution",
      "day-vote-no-lynch",
      "player-action-denied",
      "invalid-action-recovery",
      "resolution-receipt",
      "dead-player-recovery",
      "night-action-loop",
      "action-idempotent-retry",
      "concurrent-action-race",
      "concurrent-action-race-reload",
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
      "concurrent-host-resolve-race",
      "concurrent-host-resolve-race-reload",
      "stale-host-resolve-reload",
      "stale-host-resolve-reconnect-recovery",
      "concurrent-host-advance-race",
      "concurrent-host-advance-race-reload",
      "stale-host-advance-reload",
      "stale-host-advance-reconnect-recovery",
      "stale-host-deadline-reload",
      "stale-host-deadline-reconnect-recovery",
      "stale-cohost-deadline-reload",
      "stale-cohost-deadline-reconnect-recovery",
      "concurrent-host-deadline-advance-race",
      "concurrent-host-deadline-advance-race-reload",
      "concurrent-host-lifecycle-race",
      "concurrent-host-lifecycle-race-reload",
      "concurrent-host-complete-race",
      "concurrent-host-complete-race-reload",
      "stale-host-prompt-reload",
      "stale-host-complete-reload",
      "stale-host-complete-reconnect-recovery",
      "concurrent-player-complete-race",
      "public-player-complete-reload",
      "stale-player-complete-reload",
      "concurrent-host-mixed-advance-race",
      "concurrent-host-mixed-advance-race-reload",
      "stale-same-action-recovery",
      "stale-action-conflict-message",
      "stale-action-reconnect-recovery",
      "stale-dead-action-conflict",
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
      "private-channel-member",
      "private-channel-denied",
      "multiplayer-hardening",
      "local-ops-readiness",
    ],
  );
  const seedFixtureReadiness = buildDevTestGameReleaseReadiness(proofRun, {
    generatedAt: "2026-06-26T00:00:00.000Z",
    opsArtifactsPath: "target/dev-test-game/ops-artifacts.json",
    opsArtifacts,
    seedFixtureSummaryPath: "target/dev-test-game/seed-fixture-summary.json",
    seedFixtureSummary: seedFixture,
    seedAdminProofPath: "target/dev-test-game/seed-admin-proof.json",
    seedAdminProof: seedAdminProofFixture(),
  });
  assertDevTestGameReleaseReadiness(seedFixtureReadiness);
  assert(
    seedFixtureReadiness.localDevelopmentSpine.checks.some(
      (item) => item.id === "local-seed-demo-fixture" && item.status === "passed",
    ),
  );
  assert.equal(
    seedFixtureReadiness.localDevelopmentSpine.checks.find(
      (item) => item.id === "local-seed-demo-fixture",
    ).adminRoleSurface.detailRoleUrl,
    "/admin/audit/local-seed-fixtures?game=<seeded-game>",
  );
  assert.equal(
    seedFixtureReadiness.releaseReadiness.unproven.some(
      (item) => item.id === "seed-demo-fixtures",
    ),
    false,
  );
  assert(
    seedFixtureReadiness.releaseReadiness.unproven.some(
      (item) => item.id === "hosted-demo-fixtures" && item.status === "unproven",
    ),
  );
  const identityReadiness = buildDevTestGameReleaseReadiness(proofRun, {
    generatedAt: "2026-06-26T00:00:00.000Z",
    identityAdapterProofPath:
      "target/auth-invite-role-proof/invite-role-proof.json",
    identityAdapterProof: identityAdapterProofFixture(game),
    identityAdminProofPath: "target/dev-test-game/identity-admin-proof.json",
    identityAdminProof: identityAdminProofFixture(),
  });
  assertDevTestGameReleaseReadiness(identityReadiness);
  assert(
    identityReadiness.localDevelopmentSpine.checks.some(
      (item) => item.id === "local-identity-adapter-proof" && item.status === "passed",
    ),
  );
  assert.equal(
    identityReadiness.localDevelopmentSpine.checks.find(
      (item) => item.id === "local-identity-adapter-proof",
    ).adminRoleSurface.detailRoleUrl,
    "/admin/audit/local-identity-adapter?game=<seeded-game>",
  );
  assert.equal(
    identityReadiness.releaseReadiness.unproven.some(
      (item) => item.id === "production-identity",
    ),
    false,
  );
  assert(
    identityReadiness.releaseReadiness.unproven.some(
      (item) => item.id === "hosted-production-identity" && item.status === "unproven",
    ),
  );
  const backupRestoreReadiness = buildDevTestGameReleaseReadiness(proofRun, {
    generatedAt: "2026-06-26T00:00:00.000Z",
    backupRestoreProofPath:
      "target/live-stack-backup-restore-drill/local-backup-restore-proof.json",
    backupRestoreDumpPath: "target/live-stack-backup-restore-drill/local-live-stack.dump",
    backupAdminProofPath: "target/dev-test-game/backup-admin-proof.json",
    backupAdminProof: backupAdminProofFixture(),
    backupRestoreProof: {
      version: 1,
      status: "passed",
      scope: "local-live-stack-backup-restore-drill",
      productionReady: false,
      proofBoundary: "Local disposable Postgres backup/restore proof.",
      artifact: {
        proof: "target/live-stack-backup-restore-drill/local-backup-restore-proof.json",
        dump: "target/live-stack-backup-restore-drill/local-live-stack.dump",
      },
      checks: [
        { id: "dump-created", status: "passed" },
        { id: "event-log-restored", status: "passed" },
        { id: "projection-fingerprints-restored", status: "passed" },
        { id: "auth-sessions-restored", status: "passed" },
        { id: "restored-api-capabilities", status: "passed" },
      ],
      fingerprints: {
        source: { events: { total: 3 }, projections: { phase_state: [] } },
        restored: { events: { total: 3 }, projections: { phase_state: [] } },
      },
      restoredApiEvidence: {
        restoredSessions: {
          host: ["HostOf"],
          player: ["SlotOccupant", "ChannelMember"],
          admin: ["GlobalAdmin"],
        },
      },
    },
  });
  assertDevTestGameReleaseReadiness(backupRestoreReadiness);
  assert(
    backupRestoreReadiness.localDevelopmentSpine.checks.some(
      (item) => item.id === "local-backup-restore-drill" && item.status === "passed",
    ),
  );
  assert.equal(
    backupRestoreReadiness.localDevelopmentSpine.checks.find(
      (item) => item.id === "local-backup-restore-drill",
    ).adminRoleSurface.detailRoleUrl,
    "/admin/audit/local-backup-restore?game=<seeded-game>",
  );
  assert.equal(
    backupRestoreReadiness.releaseReadiness.unproven.some(
      (item) => item.id === "backup-restore-drill",
    ),
    false,
  );
  assert(
    backupRestoreReadiness.releaseReadiness.unproven.some(
      (item) => item.id === "production-backup-recovery" && item.status === "unproven",
    ),
  );
  assert.equal(backupRestoreReadiness.releaseReadiness.status, "not_ready");
  const adminSpineReadiness = buildDevTestGameReleaseReadiness(proofRun, {
    generatedAt: "2026-06-26T00:00:00.000Z",
    adminSpineProofPath: "target/dev-test-game/admin-spine-proof.json",
    adminSpineProof: adminSpineProofFixture(),
    adminSpineAdminProofPath: "target/dev-test-game/admin-spine-admin-proof.json",
    adminSpineAdminProof: adminSpineAdminProofFixture(),
  });
  assertDevTestGameReleaseReadiness(adminSpineReadiness);
  assert.equal(
    adminSpineReadiness.generatedFrom.adminProofSpine,
    "target/dev-test-game/admin-spine-proof.json",
  );
  assert.equal(
    adminSpineReadiness.generatedFrom.adminSpineAdminProof,
    "target/dev-test-game/admin-spine-admin-proof.json",
  );
  assert.equal(
    adminSpineReadiness.localDevelopmentSpine.checks.find(
      (item) => item.id === "local-admin-spine-surface",
    ).adminRoleSurface.detailRoleUrl,
    "/admin/audit/local-admin-spine?game=<seeded-game>",
  );
  assert.equal(
    adminSpineReadiness.localDevelopmentSpine.evidence.adminProofSpine.proofCount,
    14,
  );
  assert.equal(
    adminSpineReadiness.localDevelopmentSpine.evidence.adminProofSpine.recovery.nextCommand,
    "npm run test:dev-test-game-admin-spine",
  );
  assert.deepEqual(adminSpineReadiness.localDevelopmentSpine.evidence.adminProofSpine.proofIds, [
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
    "hosted-evidence-lane",
    "hosted-concurrent-race-matrix",
    "hosted-ops-signals",
    "spine-manifest",
  ]);
  const proofGraphHandoffReadiness = buildDevTestGameReleaseReadiness(proofRun, {
    generatedAt: "2026-06-26T00:00:00.000Z",
    proofGraphAdminProofPath: "target/dev-test-game/proof-graph-admin-proof.json",
    proofGraphAdminProof: proofGraphAdminProofFixture(),
  });
  assertDevTestGameReleaseReadiness(proofGraphHandoffReadiness);
  assert.equal(
    proofGraphHandoffReadiness.generatedFrom.proofGraphAdminProof,
    "target/dev-test-game/proof-graph-admin-proof.json",
  );
  const handoffCheck =
    proofGraphHandoffReadiness.localDevelopmentSpine.checks.find(
      (item) => item.id === "local-proof-graph-admin-role-handoffs",
  );
  assert.equal(handoffCheck.status, "passed");
  assert.equal(handoffCheck.roleHandoffCount, 13);
  assert(handoffCheck.roleHandoffIds.includes("admin-proof:release"));
  assert(handoffCheck.destinationAuditIds.includes("local-release-readiness"));
  assert.equal(
    handoffCheck.adminRoleSurface.detailRoleUrl,
    "/admin/audit/local-proof-graph?game=<seeded-game>",
  );
  assert.equal(
    proofGraphHandoffReadiness.localDevelopmentSpine.evidence.proofGraphAdminProof
      .roleHandoffCount,
    13,
  );
  const proofFreshnessAdminReadiness = buildDevTestGameReleaseReadiness(proofRun, {
    generatedAt: "2026-06-26T00:00:00.000Z",
    proofFreshnessAdminProofPath:
      "target/dev-test-game/proof-freshness-admin-proof.json",
    proofFreshnessAdminProof: proofFreshnessAdminProofFixture(),
  });
  assertDevTestGameReleaseReadiness(proofFreshnessAdminReadiness);
  const proofFreshnessAdminCheck =
    proofFreshnessAdminReadiness.localDevelopmentSpine.checks.find(
      (item) => item.id === "local-proof-freshness-admin-surface",
    );
  assert.equal(proofFreshnessAdminCheck.status, "passed");
  assert.equal(proofFreshnessAdminCheck.dependencyGated, true);
  assert.equal(
    proofFreshnessAdminCheck.recovery.command,
    "npm run test:dev-test-game-proof-freshness-admin-proof",
  );
  assert.equal(proofFreshnessAdminCheck.artifactCount, 3);
  assert.equal(
    proofFreshnessAdminCheck.adminRoleSurface.detailRoleUrl,
    "/admin/audit/local-proof-freshness?game=<seeded-game>",
  );
  assert.equal(
    proofFreshnessAdminReadiness.localDevelopmentSpine.evidence
      .proofFreshnessAdminProof.nextActionStatus,
    "ready",
  );
  const nextActionAdminReadiness = buildDevTestGameReleaseReadiness(proofRun, {
    generatedAt: "2026-06-26T00:00:00.000Z",
    nextActionAdminProofPath: "target/dev-test-game/next-action-admin-proof.json",
    nextActionAdminProof: nextActionAdminProofFixture(),
  });
  assertDevTestGameReleaseReadiness(nextActionAdminReadiness);
  const nextActionAdminCheck =
    nextActionAdminReadiness.localDevelopmentSpine.checks.find(
      (item) => item.id === "local-next-action-admin-surface",
    );
  assert.equal(nextActionAdminCheck.status, "passed");
  assert.equal(nextActionAdminCheck.dependencyGated, true);
  assert.equal(
    nextActionAdminCheck.recovery.command,
    "npm run test:dev-test-game-next-action-admin-proof",
  );
  assert.equal(
    nextActionAdminCheck.adminRoleSurface.detailRoleUrl,
    "/admin/audit/local-next-action?game=<seeded-game>",
  );
  assert.equal(
    nextActionAdminReadiness.localDevelopmentSpine.evidence.nextActionAdminProof
      .localReadinessDependencyCandidateCount,
    0,
  );
  const manifestReadiness = buildDevTestGameReleaseReadiness(proofRun, {
    generatedAt: "2026-06-26T00:00:00.000Z",
    spineManifestPath: "target/dev-test-game/spine-manifest.json",
    spineManifest: spineManifestFixture(),
    spineManifestAdminProofPath: "target/dev-test-game/spine-manifest-admin-proof.json",
    spineManifestAdminProof: spineManifestAdminProofFixture(),
  });
  assertDevTestGameReleaseReadiness(manifestReadiness);
  assert.equal(
    manifestReadiness.generatedFrom.spineManifest,
    "target/dev-test-game/spine-manifest.json",
  );
  assert.equal(
    manifestReadiness.generatedFrom.spineManifestAdminProof,
    "target/dev-test-game/spine-manifest-admin-proof.json",
  );
  assert.equal(
    manifestReadiness.localDevelopmentSpine.checks.find(
      (item) => item.id === "local-spine-manifest",
    ).adminRoleSurface.detailRoleUrl,
    "/admin/audit/local-spine-manifest?game=<seeded-game>",
  );
});

function artifactSummary(path) {
  return {
    path,
    mtime: "2026-06-26T00:00:00.000Z",
    ageSeconds: 0,
    sizeBytes: 123,
    sha256: "0".repeat(64),
  };
}

function identityAdapterProofFixture(game) {
  return {
    version: 7,
    proof: "auth-invite-role-proof",
    status: "passed",
    scope: "local-auth-invite-role-proof",
    productionReady: false,
    releaseReady: false,
    proofBoundary: "Local invite proof only.",
    identityAdapter: {
      status: "passed",
      replacesDevTokensWithoutRoleSurfaceChange: true,
      browserCookieName: "fmarch_session",
      sessionCredentialKind: "opaque-session",
      inviteCredentialKind: "single-use-invite",
      lifecycleControls: ["session-rotation", "session-revocation", "invite-revocation"],
      delegatedIssuanceControls: ["host-scoped-invite-issuance"],
      roleSurfacePattern: "/auth/login?returnTo=<role-surface>&invite=<token>",
      capabilityAuthority:
        "auth_session resolves principal_user_id and committed game/global capabilities at the API boundary",
    },
    identityLifecycle: {
      status: "passed",
      sessionRotation: {
        status: "passed",
        principalUserId: "host_h",
        oldSessionRejected: true,
        rotatedSessionCapabilityKinds: ["HostOf"],
        sameRoleSurface: true,
      },
      sessionRevocation: {
        status: "passed",
        principalUserId: "host_h",
        revokedSessionRejected: true,
      },
      inviteRevocation: {
        status: "passed",
        principalUserId: "host_h",
        revokedInviteRejected: true,
        recoveryCapabilityKinds: ["HostOf"],
        sameRoleSurface: true,
      },
      hostScopedInviteIssuance: {
        status: "passed",
        issuingCapability: "HostOf(game)",
        hostRoleSurface: `/g/${game}/host`,
        hostAction: "?/issuePlayerInvite",
        hostPanelTestId: "host-player-invite-panel",
        clickedThroughFromHostRoleUrl: true,
        issuedByPrincipalUserId: "host_h",
        issuedForGame: game,
        storedGameScope: game,
        principalUserId: "player-mira",
        globalCapabilitiesGranted: 0,
        redeemedCapabilityKinds: ["SlotOccupant"],
        sameRoleSurface: true,
        hostRoleSurfaceStillValid: true,
        rawInviteTokenStored: false,
      },
      auditTrail: {
        status: "passed",
        principalUserId: "host_h",
        eventKinds: ["invite_revoked", "session_revoked", "session_rotated"],
        actorUserIds: ["admin_a", "host_h"],
        rawTokensStored: false,
      },
      adminAuditSurface: {
        status: "passed",
        overviewRoleUrl: "/admin?game=<seeded-game>",
        detailRoleUrl:
          "/admin/audit/identity-lifecycle?game=<seeded-game>&principal_user_id=host_h",
        linkTestId: "admin-audit-link-identity-lifecycle",
        surfaceTestId: "admin-audit-detail-surface",
        clickedThroughFromOverview: true,
        visibleEventKinds: ["session_rotated", "session_revoked", "invite_revoked"],
        principalUserId: "host_h",
        rawTokensVisible: false,
      },
      nonClaims: [
        "hosted account recovery",
        "email or out-of-band invite delivery",
        "rate limiting or abuse controls",
        "hosted audit retention or export policy",
      ],
    },
    game,
    seedCommands: Array.from({ length: 22 }, (_, index) => ({
      principalUserId: index === 0 ? "host_h" : "player-mira",
      kind: index === 0 ? "CreateGame" : "SeedCommand",
      streamSeqs: [index + 1],
    })),
    roles: {
      admin: identityRole({
        role: "admin",
        loginUrl: "http://127.0.0.1:5173/auth/login?returnTo=%2Fadmin&invite=admin-invite-token",
        principalUserId: "admin_a",
        capabilityKinds: ["GlobalAdmin"],
      }),
      host: identityRole({
        role: "host",
        loginUrl: `http://127.0.0.1:5173/auth/login?returnTo=%2Fg%2F${game}%2Fhost&invite=host-invite-token`,
        principalUserId: "host_h",
        capabilityKinds: ["HostOf"],
      }),
      player: identityRole({
        role: "player",
        loginUrl: `http://127.0.0.1:5173/auth/login?returnTo=%2Fg%2F${game}&invite=player-invite-token`,
        principalUserId: "player-mira",
        capabilityKinds: ["SlotOccupant"],
      }),
    },
  };
}

function devTestGameReleaseReadinessChecklistFixture({
  unproven,
  includeProofGraphHandoffCheck = true,
  includeProofFreshnessAdminCheck = true,
  includeNextActionAdminCheck = true,
}) {
  return {
    version: 1,
    proof: "dev-test-game-release-readiness",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    generatedAt: "2026-06-26T00:00:00.000Z",
    scope: "local-dev-test-game-release-readiness-checklist",
    generatedFrom: {
      proofRun: "target/dev-test-game/proof-run.json",
      proofGeneratedAt: "2026-06-26T00:00:00.000Z",
      game: "game-a",
      staleConflictMessageMilestone: staleConflictMessageMilestoneFixture(),
      hostStaleControlMilestone: hostStaleControlMilestoneFixture(),
    },
    localDevelopmentSpine: {
      status: "passed",
      checks: [
        {
          id: "local-role-url-browser-proof",
          label: "Seeded role URLs and browser proof",
          status: "passed",
          evidence: "target/dev-test-game/proof-run.json",
        },
        {
          id: "local-stale-conflict-message-milestone",
          label: "Stale-client conflict messages",
          status: "passed",
          evidence: "target/dev-test-game/proof-run.json",
          laneIds: staleConflictMessageMilestoneFixture().laneIds,
          requiredLaneCount: 3,
          coveredLaneCount: 3,
        },
        {
          id: "local-host-stale-control-milestone",
          label: "Host stale-control recovery",
          status: "passed",
          evidence: "target/dev-test-game/proof-run.json",
          laneIds: hostStaleControlMilestoneFixture().laneIds,
          requiredLaneCount: 18,
          coveredLaneCount: 18,
        },
        ...(includeProofGraphHandoffCheck
          ? [
              {
                id: "local-proof-graph-admin-role-handoffs",
                label: "Proof graph admin role handoffs",
                status: "passed",
                dependencyGated: true,
                evidence: "target/dev-test-game/proof-graph-admin-proof.json",
                proofBoundary:
                  "Local browser proof that the proof graph admin surface follows every mapped admin-proof role URL.",
                recovery: {
                  command: "npm run test:dev-test-game-proof-graph-admin-proof",
                  buildSlice:
                    "Refresh the proof graph admin role-handoff browser proof before choosing hosted readiness work.",
                  proofTarget: "target/dev-test-game/proof-graph-admin-proof.json",
                  roleUrl: "/admin/audit/local-proof-graph?game=<seeded-game>",
                  proofBoundary:
                    "Local browser proof that the proof graph admin surface follows every mapped admin-proof role URL. This recovers a local readiness dependency only; it does not prove hosted deployment, release readiness, or production readiness.",
                  requiredEvidence:
                    "Passed proof graph admin role-handoff check in the generated release-readiness checklist",
                },
                roleHandoffCount: 10,
                roleHandoffIds: ["admin-proof:release"],
                destinationAuditIds: ["local-release-readiness"],
              },
            ]
          : []),
        ...(includeProofFreshnessAdminCheck
          ? [
              {
                id: "local-proof-freshness-admin-surface",
                label: "Proof freshness admin surface",
                status: "passed",
                dependencyGated: true,
                evidence: "target/dev-test-game/proof-freshness-admin-proof.json",
                proofBoundary:
                  "Local browser proof that the proof-freshness admin surface exposes fresh generated artifacts.",
                recovery: {
                  command:
                    "npm run test:dev-test-game-proof-freshness-admin-proof",
                  buildSlice:
                    "Refresh the proof-freshness admin browser proof before hosted readiness work can be selected.",
                  proofTarget:
                    "target/dev-test-game/proof-freshness-admin-proof.json",
                  roleUrl: "/admin/audit/local-proof-freshness?game=<seeded-game>",
                  proofBoundary:
                    "Local browser proof that the proof-freshness admin surface exposes fresh generated artifacts and the next-action handoff from the seeded admin audit route. This recovers a local readiness dependency only; it does not validate artifact contents, hosted deployment, release readiness, or production readiness.",
                  requiredEvidence:
                    "Passed proof-freshness admin surface check in the generated release-readiness checklist",
                },
                artifactCount: 3,
                artifactIds: ["proof-run", "release-readiness", "next-action"],
                maxAgeHours: 24,
                nextActionCommand:
                  "npm run test:dev-test-game-hosted-concurrent-race-matrix",
                nextActionStatus: "ready",
                nextActionReason: "release-readiness-unproven",
              },
            ]
          : []),
        ...(includeNextActionAdminCheck
          ? [
              {
                id: "local-next-action-admin-surface",
                label: "Next-action admin surface",
                status: "passed",
                dependencyGated: true,
                evidence: "target/dev-test-game/next-action-admin-proof.json",
                proofBoundary:
                  "Local browser proof that the next-action admin surface exposes the selected command.",
                recovery: {
                  command: "npm run test:dev-test-game-next-action-admin-proof",
                  buildSlice:
                    "Refresh the next-action admin browser proof before hosted readiness work can be selected.",
                  proofTarget: "target/dev-test-game/next-action-admin-proof.json",
                  roleUrl: "/admin/audit/local-next-action?game=<seeded-game>",
                  proofBoundary:
                    "Local browser proof that the next-action admin surface exposes the selected command, local readiness dependency trace, release-readiness trace, and role URL handoffs from the seeded admin audit route. This recovers a local readiness dependency only; it does not prove hosted deployment, release readiness, or production readiness.",
                  requiredEvidence:
                    "Passed next-action admin surface check in the generated release-readiness checklist",
                },
                selectedCommand: "npm run test:dev-test-game-hosted-concurrent-race-matrix",
                selectedReason: "release-readiness-unproven",
                releaseReadinessCandidateCount: 1,
                localReadinessDependencyCandidateCount: 0,
              },
            ]
          : []),
      ],
    },
    releaseReadiness: {
      status: "not_ready",
      reason: "Local proof passed, but release evidence remains unproven.",
      unproven,
    },
    proofBoundary:
      "Derived from the local dev-test-game proof-run artifact without release claims.",
  };
}

function staleConflictMessageMilestoneFixture() {
  return {
    status: "passed",
    laneIds: [
      "replacement-stale-conflict-message",
      "stale-action-conflict-message",
      "stale-dead-action-conflict",
    ],
    requiredLaneCount: 3,
    coveredLaneCount: 3,
    gapCount: 0,
  };
}

function hostStaleControlMilestoneFixture() {
  return {
    status: "passed",
    laneIds: [
      "stale-host-publish",
      "stale-host-lifecycle",
      "stale-host-modkill",
      "stale-host-prompt",
      "stale-host-prompt-reload",
      "stale-host-complete",
      "stale-host-complete-reload",
      "stale-host-complete-reconnect-recovery",
      "stale-host-control",
      "stale-host-resolve",
      "stale-host-resolve-reload",
      "stale-host-resolve-reconnect-recovery",
      "stale-host-advance",
      "stale-host-advance-reload",
      "stale-host-advance-reconnect-recovery",
      "stale-host-deadline",
      "stale-host-deadline-reload",
      "stale-host-deadline-reconnect-recovery",
    ],
    requiredLaneCount: 18,
    coveredLaneCount: 18,
    gapCount: 0,
  };
}

function devTestGameRaceCoverageFixture() {
  const cells = [
    raceCoverageCell("player-vote-change", "concurrent-vote-race", "concurrent-vote-race-reload"),
    raceCoverageCell("player-night-action", "concurrent-action-race", "concurrent-action-race-reload"),
    raceCoverageCell(
      "player-vote-vs-host-resolve",
      "concurrent-player-vote-resolve-race",
      "concurrent-player-vote-resolve-race-reload",
    ),
    raceCoverageCell(
      "player-action-vs-host-advance",
      "concurrent-player-action-advance-race",
      "concurrent-player-action-advance-race-reload",
    ),
    raceCoverageCell(
      "cohost-deadline-vs-host-resolve",
      "concurrent-cohost-deadline-resolve-race",
      "concurrent-cohost-deadline-resolve-race-reload",
    ),
    raceCoverageCell(
      "replacement-private-post",
      "concurrent-replacement-private-post-race",
      "concurrent-replacement-private-post-race-reload",
    ),
    raceCoverageCell(
      "replacement-vote",
      "concurrent-replacement-vote-race",
      "concurrent-replacement-vote-race-reload",
    ),
    raceCoverageCell(
      "replacement-action",
      "concurrent-replacement-action-race",
      "concurrent-replacement-action-race-reload",
    ),
    raceCoverageCell("host-resolve", "concurrent-host-resolve-race", "concurrent-host-resolve-race-reload"),
    raceCoverageCell("host-advance", "concurrent-host-advance-race", "concurrent-host-advance-race-reload"),
    raceCoverageCell(
      "host-deadline-advance",
      "concurrent-host-deadline-advance-race",
      "concurrent-host-deadline-advance-race-reload",
    ),
    raceCoverageCell("host-lifecycle", "concurrent-host-lifecycle-race", "concurrent-host-lifecycle-race-reload"),
    raceCoverageCell(
      "host-mixed-advance",
      "concurrent-host-mixed-advance-race",
      "concurrent-host-mixed-advance-race-reload",
    ),
    raceCoverageCell(
      "host-votecount-publication",
      "concurrent-host-publish-race",
      "concurrent-host-publish-race-reload",
    ),
    raceCoverageCell("host-complete-game", "concurrent-host-complete-race", "concurrent-host-complete-race-reload"),
    raceCoverageCell(
      "player-vs-completed-game",
      "concurrent-player-complete-race",
      "public-player-complete-reload",
    ),
  ];
  return {
    version: 1,
    proof: "dev-test-game-race-coverage",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    generatedAt: "2026-06-26T00:00:00.000Z",
    scope: "local-dev-test-game-race-coverage",
    generatedFrom: {
      proofRun: "target/dev-test-game/proof-run.json",
      proofGeneratedAt: "2026-06-26T00:00:00.000Z",
      game: "game-a",
      laneCount: 113,
    },
    summary: {
      cellCount: cells.length,
      provenCellCount: cells.length,
      unprovenCellCount: 0,
      reloadRequiredCellCount: cells.length,
      reloadCoveredCellCount: cells.length,
      reloadGapCount: 0,
    },
    cells,
    unprovenCells: [],
    reloadGaps: [],
  };
}

function hostConcurrentRaceReloadCellIdsFixture() {
  return [
    "host-resolve",
    "host-advance",
    "host-deadline-advance",
    "host-lifecycle",
    "host-mixed-advance",
    "host-votecount-publication",
    "host-complete-game",
  ];
}

function replacementRaceReloadCellIdsFixture() {
  return [
    "replacement-private-post",
    "replacement-vote",
    "replacement-action",
  ];
}

function hostConcurrentRaceReloadCellsFixture() {
  return [
    {
      id: "host-resolve",
      raceLaneId: "concurrent-host-resolve-race",
      reloadLaneId: "concurrent-host-resolve-race-reload",
      reloadStatus: "passed",
      covered: true,
    },
    {
      id: "host-advance",
      raceLaneId: "concurrent-host-advance-race",
      reloadLaneId: "concurrent-host-advance-race-reload",
      reloadStatus: "passed",
      covered: true,
    },
    {
      id: "host-deadline-advance",
      raceLaneId: "concurrent-host-deadline-advance-race",
      reloadLaneId: "concurrent-host-deadline-advance-race-reload",
      reloadStatus: "passed",
      covered: true,
    },
    {
      id: "host-lifecycle",
      raceLaneId: "concurrent-host-lifecycle-race",
      reloadLaneId: "concurrent-host-lifecycle-race-reload",
      reloadStatus: "passed",
      covered: true,
    },
    {
      id: "host-mixed-advance",
      raceLaneId: "concurrent-host-mixed-advance-race",
      reloadLaneId: "concurrent-host-mixed-advance-race-reload",
      reloadStatus: "passed",
      covered: true,
    },
    {
      id: "host-votecount-publication",
      raceLaneId: "concurrent-host-publish-race",
      reloadLaneId: "concurrent-host-publish-race-reload",
      reloadStatus: "passed",
      covered: true,
    },
    {
      id: "host-complete-game",
      raceLaneId: "concurrent-host-complete-race",
      reloadLaneId: "concurrent-host-complete-race-reload",
      reloadStatus: "passed",
      covered: true,
    },
  ];
}

function playerConcurrentActionReloadCellIdsFixture() {
  return [
    "player-vote-change",
    "player-night-action",
    "player-vote-vs-host-resolve",
    "player-action-vs-host-advance",
    "player-vs-completed-game",
  ];
}

function playerConcurrentActionReloadCellsFixture() {
  return [
    {
      id: "player-vote-change",
      raceLaneId: "concurrent-vote-race",
      reloadLaneId: "concurrent-vote-race-reload",
      reloadStatus: "passed",
      covered: true,
    },
    {
      id: "player-night-action",
      raceLaneId: "concurrent-action-race",
      reloadLaneId: "concurrent-action-race-reload",
      reloadStatus: "passed",
      covered: true,
    },
    {
      id: "player-vote-vs-host-resolve",
      raceLaneId: "concurrent-player-vote-resolve-race",
      reloadLaneId: "concurrent-player-vote-resolve-race-reload",
      reloadStatus: "passed",
      covered: true,
    },
    {
      id: "player-action-vs-host-advance",
      raceLaneId: "concurrent-player-action-advance-race",
      reloadLaneId: "concurrent-player-action-advance-race-reload",
      reloadStatus: "passed",
      covered: true,
    },
    {
      id: "player-vs-completed-game",
      raceLaneId: "concurrent-player-complete-race",
      reloadLaneId: "public-player-complete-reload",
      reloadStatus: "passed",
      covered: true,
    },
  ];
}

function cohostDeadlineRaceReloadCellIdsFixture() {
  return ["cohost-deadline-vs-host-resolve"];
}

function cohostDeadlineRaceReloadCellsFixture() {
  return [
    {
      id: "cohost-deadline-vs-host-resolve",
      raceLaneId: "concurrent-cohost-deadline-resolve-race",
      reloadLaneId: "concurrent-cohost-deadline-resolve-race-reload",
      reloadStatus: "passed",
      covered: true,
    },
  ];
}

function raceCoveragePromotedMilestonesFixture({ groupStatus }) {
  return {
    status: "passed",
    cellCount: 16,
    provenCellCount: 16,
    reloadCoveredCellCount: 16,
    groupCount: 4,
    passedGroupCount: 4,
    requiredCellCount: 16,
    coveredCellCount: 16,
    gapCount: 0,
    groups: [
      {
        id: "replacement-race-reload",
        label: "Replacement race reload",
        status: groupStatus,
        cellIds: replacementRaceReloadCellIdsFixture(),
        requiredCellCount: 3,
        coveredCellCount: 3,
        gapCount: 0,
      },
      {
        id: "host-concurrent-race-reload",
        label: "Host concurrent race reload",
        status: groupStatus,
        cellIds: hostConcurrentRaceReloadCellIdsFixture(),
        requiredCellCount: 7,
        coveredCellCount: 7,
        gapCount: 0,
      },
      {
        id: "player-concurrent-action-reload",
        label: "Player concurrent action reload",
        status: groupStatus,
        cellIds: playerConcurrentActionReloadCellIdsFixture(),
        requiredCellCount: 5,
        coveredCellCount: 5,
        gapCount: 0,
      },
      {
        id: "cohost-deadline-race-reload",
        label: "Cohost deadline race reload",
        status: groupStatus,
        cellIds: cohostDeadlineRaceReloadCellIdsFixture(),
        requiredCellCount: 1,
        coveredCellCount: 1,
        gapCount: 0,
      },
    ],
  };
}

function raceCoverageCell(id, raceLaneId, reloadLaneId) {
  return {
    id,
    actorPair: "test",
    commandFamily: "test",
    raceLaneId,
    raceStatus: "passed",
    reloadLaneId,
    reloadStatus: "passed",
    reloadCoverage: "passed",
    status: "passed",
    provenBy: [raceLaneId, reloadLaneId],
    missingLaneIds: [],
  };
}

function devTestGameOpsArtifactsFixture({
  proofStability = {
    status: "passed",
    hostConfirmClicks: {
      total: 55,
      firstClickCount: 55,
      concurrentClickCount: 0,
      retryClickCount: 0,
      domFallbackCount: 0,
      forceFallbackCount: 0,
      failureCount: 0,
      maxAttempts: 1,
      byAction: { resolve_phase: 20, extend_deadline: 35 },
      byRole: { host: 30, cohost: 25 },
      events: [],
    },
  },
} = {}) {
  return {
    version: 1,
    proof: "dev-test-game-ops-artifacts",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    generatedAt: "2026-06-26T00:00:00.000Z",
    scope: "local-dev-test-game-ops-artifacts",
    proofBoundary: "Local artifact bundle.",
    generatedFrom: {
      sessionJson: "target/dev-test-game/session.json",
      proofRun: "target/dev-test-game/proof-run.json",
      readinessChecklist: "target/dev-test-game/release-readiness-checklist.json",
    },
    run: {
      name: "midsummer",
      game: "midsummer",
      verificationStatus: "passed",
      seedCommandCount: 22,
      roleCount: 6,
    },
    roles: {},
    proofRun: {
      status: "passed",
      laneCount: 113,
      lanes: [],
      nonClaims: [],
    },
    proofStability,
    readiness: {
      status: "not_ready",
      releaseReady: false,
      productionReady: false,
      localChecks: [],
      unproven: [],
    },
    artifacts: {
      session: { path: "target/dev-test-game/session.json" },
      proofRun: { path: "target/dev-test-game/proof-run.json" },
      readiness: { path: "target/dev-test-game/release-readiness-checklist.json" },
    },
    checks: [
      { id: "source-artifacts-checksummed", status: "passed" },
      { id: "role-entrypoints-redacted", status: "passed" },
      { id: "proof-lanes-summarized", status: "passed" },
      {
        id: "proof-stability-summarized",
        status: "passed",
        hostConfirmClicks: proofStability.hostConfirmClicks.total,
        concurrentClickCount: proofStability.hostConfirmClicks.concurrentClickCount ?? 0,
        retryClickCount: proofStability.hostConfirmClicks.retryClickCount,
        domFallbackCount: proofStability.hostConfirmClicks.domFallbackCount,
        forceFallbackCount: proofStability.hostConfirmClicks.forceFallbackCount,
      },
      {
        id: "release-boundary-carried",
        status: "passed",
        releaseReady: false,
        productionReady: false,
      },
    ],
  };
}

function identityAdminProofFixture() {
  return {
    version: 1,
    proof: "dev-test-game-identity-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-identity-admin-surface",
    proofBoundary: "Local admin identity adapter proof only.",
    generatedFrom: {
      identityAdapterProof: "target/auth-invite-role-proof/invite-role-proof.json",
      game: "00000000-0000-0000-0000-000000000001",
    },
    adminRoleSurface: {
      status: "passed",
      overviewRoleUrl: "/admin?game=<seeded-game>",
      detailRoleUrl: "/admin/audit/local-identity-adapter?game=<seeded-game>",
      linkTestId: "admin-audit-link-local-identity-adapter",
      surfaceTestId: "admin-audit-detail-surface",
      clickedThroughFromOverview: true,
      visibleChecks: [
        "session-rotation",
        "session-revocation",
        "invite-revocation",
        "host-scoped-invite-issuance",
        "audit-trail",
        "admin-audit-surface",
      ],
      visibleSessions: ["admin", "host", "player"],
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    },
  };
}

function coreLoopAdminProofFixture() {
  return {
    version: 1,
    proof: "dev-test-game-core-loop-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-core-loop-admin-surface",
    proofBoundary: "Local admin core-loop proof only.",
    generatedFrom: {
      proofRun: "target/dev-test-game/proof-run.json",
      game: "00000000-0000-0000-0000-000000000001",
    },
    adminRoleSurface: {
      status: "passed",
      overviewRoleUrl: "/admin?game=<seeded-game>",
      detailRoleUrl: "/admin/audit/local-core-loop?game=<seeded-game>",
      linkTestId: "admin-audit-link-local-core-loop",
      surfaceTestId: "admin-audit-detail-surface",
      clickedThroughFromOverview: true,
      visibleChecks: [
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
        "replacement-idempotent-retry",
        "stale-host-invite-recovery",
        "replacement-stale-success-recovery",
        "replacement-stale-player",
        "replacement-stale-action",
        "replacement-stale-private-channel",
        "replacement-stale-private-receipts",
        "replacement-incoming-player",
      ],
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    },
  };
}

function hardeningAdminProofFixture() {
  return {
    version: 1,
    proof: "dev-test-game-hardening-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-hardening-admin-surface",
    proofBoundary: "Local admin hardening proof only.",
    generatedFrom: {
      proofRun: "target/dev-test-game/proof-run.json",
      game: "00000000-0000-0000-0000-000000000001",
    },
    adminRoleSurface: {
      status: "passed",
      overviewRoleUrl: "/admin?game=<seeded-game>",
      detailRoleUrl: "/admin/audit/local-hardening?game=<seeded-game>",
      linkTestId: "admin-audit-link-local-hardening",
      surfaceTestId: "admin-audit-detail-surface",
      clickedThroughFromOverview: true,
      visibleChecks: [
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
        "stale-player-vote-after-change",
        "stale-player-withdraw-after-change",
        "stale-player-withdraw-after-phase-closure",
        "stale-player-vote-after-phase-closure",
        "stale-player-post-after-phase-closure",
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
        "concurrent-vote-race",
        "concurrent-vote-race-reload",
        "stale-host-publish-after-change",
        "concurrent-host-publish-race",
        "concurrent-host-publish-race-reload",
        "stale-host-publish",
        "stale-host-lifecycle",
        "stale-host-modkill",
        "stale-host-prompt",
        "stale-host-prompt-reload",
        "stale-host-complete",
        "stale-host-complete-reload",
        "stale-host-complete-reconnect-recovery",
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
        "stale-action-reconnect-recovery",
        "stale-host-control",
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
        "stale-host-prompt-reload",
        "stale-host-complete-reload",
        "stale-host-complete-reconnect-recovery",
        "concurrent-player-complete-race",
        "public-player-complete-reload",
        "stale-player-complete-reload",
        "concurrent-host-mixed-advance-race",
        "concurrent-host-mixed-advance-race-reload",
        "stale-host-resolve",
        "stale-host-resolve-reload",
        "stale-host-resolve-reconnect-recovery",
        "stale-host-advance",
        "stale-host-advance-reload",
        "stale-host-advance-reconnect-recovery",
        "stale-host-deadline",
        "stale-host-deadline-reload",
        "stale-host-deadline-reconnect-recovery",
        "stale-cohost-deadline",
        "stale-cohost-deadline-reload",
        "stale-cohost-deadline-reconnect-recovery",
      ],
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    },
  };
}

function opsAdminProofFixture() {
  return {
    version: 1,
    proof: "dev-test-game-ops-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-ops-admin-surface",
    proofBoundary: "Local admin ops artifact proof only.",
    generatedFrom: {
      opsArtifacts: "target/dev-test-game/ops-artifacts.json",
      game: "00000000-0000-0000-0000-000000000001",
    },
    adminRoleSurface: {
      status: "passed",
      overviewRoleUrl: "/admin?game=<seeded-game>",
      detailRoleUrl: "/admin/audit/local-ops-artifacts?game=<seeded-game>",
      linkTestId: "admin-audit-link-local-ops-artifacts",
      surfaceTestId: "admin-audit-detail-surface",
      clickedThroughFromOverview: true,
      visibleChecks: [
        "source-artifacts-checksummed",
        "role-entrypoints-redacted",
        "proof-lanes-summarized",
        "proof-stability-summarized",
        "release-boundary-carried",
      ],
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    },
  };
}

function hostedOpsSignalsAdminProofFixture() {
  return {
    version: 1,
    proof: "dev-test-game-hosted-ops-signals-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-hosted-ops-signals-admin-surface",
    proofBoundary: "Local admin hosted ops signals proof only.",
    generatedFrom: {
      hostedOpsSignals: "target/dev-test-game/hosted-ops-signals.json",
      game: "00000000-0000-0000-0000-000000000001",
    },
    adminRoleSurface: {
      status: "passed",
      overviewRoleUrl: "/admin?game=<seeded-game>",
      detailRoleUrl: "/admin/audit/local-hosted-ops-signals?game=<seeded-game>",
      linkTestId: "admin-audit-link-local-hosted-ops-signals",
      surfaceTestId: "admin-audit-detail-surface",
      clickedThroughFromOverview: true,
      visibleChecks: [
        "hosted-matrix-artifact-checksummed",
        "local-target-signals-carried",
        "matrix-health-counters-carried",
        "readiness-boundary-carried",
        "hosted-telemetry-boundary-carried",
      ],
      visibleRelatedLinks: [
        "local-hosted-concurrent-race-matrix",
        "local-ops-artifacts",
      ],
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    },
  };
}

function seedAdminProofFixture() {
  return {
    version: 1,
    proof: "dev-test-game-seed-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-seed-admin-surface",
    proofBoundary: "Local admin seed fixture proof only.",
    generatedFrom: {
      seedFixtureSummary: "target/dev-test-game/seed-fixture-summary.json",
      game: "00000000-0000-0000-0000-000000000001",
    },
    adminRoleSurface: {
      status: "passed",
      overviewRoleUrl: "/admin?game=<seeded-game>",
      detailRoleUrl: "/admin/audit/local-seed-fixtures?game=<seeded-game>",
      linkTestId: "admin-audit-link-local-seed-fixtures",
      surfaceTestId: "admin-audit-detail-surface",
      clickedThroughFromOverview: true,
      visibleScenarios: [
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
        "stale-host-resolve-reconnect-recovery",
        "concurrent-host-advance-race",
        "concurrent-host-advance-race-reload",
        "stale-host-advance-reconnect-recovery",
        "stale-host-deadline-reconnect-recovery",
        "stale-cohost-deadline-reconnect-recovery",
        "concurrent-host-deadline-advance-race",
        "concurrent-host-deadline-advance-race-reload",
        "concurrent-host-lifecycle-race",
        "concurrent-host-lifecycle-race-reload",
        "concurrent-host-complete-race",
        "concurrent-host-complete-race-reload",
        "stale-host-prompt-reload",
        "stale-host-complete-reload",
        "stale-host-complete-reconnect-recovery",
        "concurrent-player-complete-race",
        "public-player-complete-reload",
        "stale-player-complete-reload",
        "concurrent-host-mixed-advance-race",
        "concurrent-host-mixed-advance-race-reload",
        "stale-same-action-recovery",
        "stale-action-conflict-message",
        "stale-action-reconnect-recovery",
        "stale-dead-action-conflict",
        "private-channel-member",
        "private-channel-denied",
        "multiplayer-hardening",
        "local-ops-readiness",
      ],
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    },
  };
}

function backupAdminProofFixture() {
  return {
    version: 1,
    proof: "dev-test-game-backup-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-backup-admin-surface",
    proofBoundary: "Local admin backup/restore proof only.",
    generatedFrom: {
      backupRestoreProof:
        "target/live-stack-backup-restore-drill/local-backup-restore-proof.json",
      backupRestoreDump: "target/live-stack-backup-restore-drill/local-live-stack.dump",
      game: "00000000-0000-0000-0000-000000000001",
    },
    adminRoleSurface: {
      status: "passed",
      overviewRoleUrl: "/admin?game=<seeded-game>",
      detailRoleUrl: "/admin/audit/local-backup-restore?game=<seeded-game>",
      linkTestId: "admin-audit-link-local-backup-restore",
      surfaceTestId: "admin-audit-detail-surface",
      clickedThroughFromOverview: true,
      visibleChecks: [
        "dump-created",
        "event-log-restored",
        "projection-fingerprints-restored",
        "auth-sessions-restored",
        "restored-api-capabilities",
      ],
      visibleSessions: ["host", "player", "admin"],
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    },
  };
}

function releaseAdminProofFixture() {
  return {
    version: 1,
    proof: "dev-test-game-release-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-release-admin-surface",
    proofBoundary: "Local admin release-readiness proof only.",
    generatedFrom: {
      releaseReadinessChecklist: "target/dev-test-game/release-readiness-checklist.json",
      game: "00000000-0000-0000-0000-000000000001",
      localCheckIds: [
        "local-role-url-browser-proof",
        "local-core-loop-proof",
        "local-hardening-proof",
      ],
      unprovenIds: ["hosted-deployment", "human-release-runbook"],
    },
    adminRoleSurface: {
      status: "passed",
      overviewRoleUrl: "/admin?game=<seeded-game>",
      detailRoleUrl: "/admin/audit/local-release-readiness?game=<seeded-game>",
      linkTestId: "admin-audit-link-local-release-readiness",
      surfaceTestId: "admin-audit-detail-surface",
      clickedThroughFromOverview: true,
      visibleChecks: [
        "local-role-url-browser-proof",
        "local-core-loop-proof",
        "local-hardening-proof",
      ],
      visibleUnproven: ["hosted-deployment", "human-release-runbook"],
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    },
  };
}

function releaseRunbookAdminProofFixture() {
  return {
    version: 1,
    proof: "dev-test-game-release-runbook-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-release-runbook-admin-surface",
    proofBoundary: "Local admin release-runbook proof only.",
    generatedFrom: {
      releaseRunbook: "target/dev-test-game/release-runbook.json",
      proofRun: "target/dev-test-game/proof-run.json",
      game: "00000000-0000-0000-0000-000000000001",
      checkIds: [
        "remaining-readiness-gaps-mapped",
        "rollback-path-carried",
        "support-path-carried",
        "release-claim-boundary-carried",
        "human-approval-boundary-carried",
      ],
      runbookItemIds: ["hosted-deployment", "human-release-approval"],
      relatedAuditIds: ["local-release-readiness"],
    },
    adminRoleSurface: {
      status: "passed",
      overviewRoleUrl: "/admin?game=<seeded-game>",
      detailRoleUrl: "/admin/audit/local-release-runbook?game=<seeded-game>",
      linkTestId: "admin-audit-link-local-release-runbook",
      surfaceTestId: "admin-audit-detail-surface",
      clickedThroughFromOverview: true,
      visibleChecks: [
        "remaining-readiness-gaps-mapped",
        "rollback-path-carried",
        "support-path-carried",
        "release-claim-boundary-carried",
        "human-approval-boundary-carried",
      ],
      visibleUnproven: ["hosted-deployment", "human-release-approval"],
      visibleRelatedLinks: ["local-release-readiness"],
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    },
  };
}

function proofGraphAdminProofFixture() {
  const handoffs = [
    ["admin-proof:core-loop", "local-core-loop"],
    ["admin-proof:hardening", "local-hardening"],
    ["admin-proof:identity", "local-identity-adapter"],
    ["admin-proof:backup", "local-backup-restore"],
    ["admin-proof:ops", "local-ops-artifacts"],
    ["admin-proof:seed", "local-seed-fixtures"],
    ["admin-proof:release", "local-release-readiness"],
    ["admin-proof:release-runbook", "local-release-runbook"],
    ["admin-proof:race-coverage", "local-race-coverage"],
    [
      "admin-proof:hosted-concurrent-race-matrix",
      "local-hosted-concurrent-race-matrix",
    ],
    ["admin-proof:hosted-evidence-lane", "local-hosted-evidence-lane"],
    ["admin-proof:hosted-ops-signals", "local-hosted-ops-signals"],
    ["admin-proof:spine-manifest", "local-spine-manifest"],
  ].map(([linkId, auditId]) => ({
    linkId,
    auditId,
    requiredCheckIds: [],
    requiredCheckStatuses: {},
    requiredScenarioIds: [],
    requiredSessionIds: [],
    requiredUnprovenIds: [],
    requiredRelatedLinkIds: [],
  }));
  return {
    version: 1,
    proof: "dev-test-game-proof-graph-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-proof-graph-admin-surface",
    proofBoundary: "Local admin proof graph handoff proof only.",
    generatedFrom: {
      proofGraph: "target/dev-test-game/proof-graph.json",
      proofRun: "target/dev-test-game/proof-run.json",
      adminSpineProof: "target/dev-test-game/admin-spine-proof.json",
      hostedConcurrentRaceMatrix:
        "target/dev-test-game/hosted-concurrent-race-matrix.json",
      game: "00000000-0000-0000-0000-000000000001",
      nodeIds: handoffs.map((handoff) => handoff.linkId),
      edgeCount: handoffs.length,
      adminProofSurfaceIds: [
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
        "hosted-evidence-lane",
        "hosted-concurrent-race-matrix",
        "hosted-ops-signals",
        "spine-manifest",
      ],
      adminProofRoleHandoffs: handoffs,
    },
    adminRoleSurface: {
      status: "passed",
      overviewRoleUrl: "/admin?game=<seeded-game>",
      detailRoleUrl: "/admin/audit/local-proof-graph?game=<seeded-game>",
      linkTestId: "admin-audit-link-local-proof-graph",
      surfaceTestId: "admin-audit-detail-surface",
      clickedThroughFromOverview: true,
      visibleChecks: handoffs.map((handoff) => handoff.linkId),
      visibleRelatedLinks: handoffs.map((handoff) => handoff.linkId),
      visibleRelatedDestinations: handoffs.map((handoff) => ({
        linkId: handoff.linkId,
        auditId: handoff.auditId,
        detailRoleUrl: `/admin/audit/${handoff.auditId}?game=<seeded-game>`,
      })),
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    },
  };
}

function proofFreshnessAdminProofFixture() {
  return {
    version: 1,
    proof: "dev-test-game-proof-freshness-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-proof-freshness-admin-surface",
    proofBoundary: "Local proof-freshness admin proof only.",
    generatedFrom: {
      proofRun: "target/dev-test-game/proof-run.json",
      nextAction: "target/dev-test-game/next-action.json",
      game: "00000000-0000-0000-0000-000000000001",
      artifactIds: ["proof-run", "release-readiness", "next-action"],
      maxAgeHours: 24,
      nextActionCommand:
        "npm run test:dev-test-game-hosted-concurrent-race-matrix",
      nextActionStatus: "ready",
      nextActionReason: "release-readiness-unproven",
    },
    adminRoleSurface: {
      status: "passed",
      overviewRoleUrl: "/admin?game=<seeded-game>",
      detailRoleUrl: "/admin/audit/local-proof-freshness?game=<seeded-game>",
      linkTestId: "admin-audit-link-local-proof-freshness",
      surfaceTestId: "admin-audit-detail-surface",
      clickedThroughFromOverview: true,
      visibleChecks: [
        "proof-run",
        "release-readiness",
        "next-action",
        "next-action-handoff",
      ],
      visibleRelatedLinks: ["local-next-action"],
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    },
  };
}

function nextActionAdminProofFixture() {
  return {
    version: 1,
    proof: "dev-test-game-next-action-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-next-action-admin-surface",
    proofBoundary: "Local next-action admin proof only.",
    generatedFrom: {
      nextAction: "target/dev-test-game/next-action.json",
      proofRun: "target/dev-test-game/proof-run.json",
      proofGraph: "target/dev-test-game/proof-graph.json",
      hostedConcurrentRaceMatrix:
        "target/dev-test-game/hosted-concurrent-race-matrix.json",
      game: "00000000-0000-0000-0000-000000000001",
      command: "npm run test:dev-test-game-hosted-concurrent-race-matrix",
      reason: "release-readiness-unproven",
      actionStatus: "ready",
      localCheckId: null,
      localCheckRoleUrl: null,
      unprovenId: "hosted-concurrent-race-matrix",
      unprovenRoleUrl:
        "/admin/audit/local-hosted-concurrent-race-matrix?game=<seeded-game>",
      unprovenProofGraphNodeId: "admin-proof:hosted-concurrent-race-matrix",
      selectedProofGraphNode: {
        id: "admin-proof:hosted-concurrent-race-matrix",
        status: "ready",
      },
      selectionTrace: {
        strategy: "development-spine-priority",
        candidateCount: 0,
        selectedArtifactId: null,
        candidateIds: [],
      },
      releaseReadinessTrace: {
        strategy: "local-dev-release-readiness-priority",
        candidateCount: 1,
        selectedUnprovenId: "hosted-concurrent-race-matrix",
        candidateIds: ["hosted-concurrent-race-matrix"],
      },
      localReadinessDependencyTrace: {
        strategy: "local-readiness-dependency-before-hosted-work",
        candidateCount: 0,
        selectedCheckId: null,
        candidateIds: [],
      },
    },
    adminRoleSurface: {
      status: "passed",
      overviewRoleUrl: "/admin?game=<seeded-game>",
      detailRoleUrl: "/admin/audit/local-next-action?game=<seeded-game>",
      linkTestId: "admin-audit-link-local-next-action",
      surfaceTestId: "admin-audit-detail-surface",
      clickedThroughFromOverview: true,
      visibleChecks: [
        "next-command",
        "release-readiness-unproven",
        "selection-trace",
        "hosted-concurrent-race-matrix",
        "selected-proof-graph-node",
        "release-readiness-selection-trace",
      ],
      visibleRelatedLinks: ["admin-proof:hosted-concurrent-race-matrix"],
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    },
  };
}

function raceCoverageAdminProofFixture() {
  return {
    version: 1,
    proof: "dev-test-game-race-coverage-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-race-coverage-admin-surface",
    proofBoundary: "Local admin race coverage proof only.",
    generatedFrom: {
      raceCoverage: "target/dev-test-game/race-coverage.json",
      proofRun: "target/dev-test-game/proof-run.json",
      game: "00000000-0000-0000-0000-000000000001",
      cellIds: [
        "player-vote-change",
        "player-night-action",
        "player-vote-vs-host-resolve",
        "player-action-vs-host-advance",
        "cohost-deadline-vs-host-resolve",
        "replacement-private-post",
        "replacement-vote",
        "replacement-action",
        "host-resolve",
        "host-advance",
        "host-deadline-advance",
        "host-lifecycle",
        "host-mixed-advance",
        "host-complete-game",
        "player-vs-completed-game",
      ],
      cellCount: 16,
      reloadCoveredCellCount: 15,
    },
    adminRoleSurface: {
      status: "passed",
      overviewRoleUrl: "/admin?game=<seeded-game>",
      detailRoleUrl: "/admin/audit/local-race-coverage?game=<seeded-game>",
      linkTestId: "admin-audit-link-local-race-coverage",
      surfaceTestId: "admin-audit-detail-surface",
      clickedThroughFromOverview: true,
      visibleChecks: [
        "player-vote-change",
        "player-night-action",
        "player-vote-vs-host-resolve",
        "player-action-vs-host-advance",
        "cohost-deadline-vs-host-resolve",
        "replacement-private-post",
        "replacement-vote",
        "replacement-action",
        "host-resolve",
        "host-advance",
        "host-deadline-advance",
        "host-lifecycle",
        "host-mixed-advance",
        "host-complete-game",
        "player-vs-completed-game",
      ],
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    },
  };
}

function hostedConcurrentRaceMatrixAdminProofFixture() {
  return {
    version: 1,
    proof: "dev-test-game-hosted-concurrent-race-matrix-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-hosted-concurrent-race-matrix-admin-surface",
    proofBoundary: "Local admin hosted matrix proof only.",
    generatedFrom: {
      hostedConcurrentRaceMatrix:
        "target/dev-test-game/hosted-concurrent-race-matrix.json",
      proofRun: "target/dev-test-game/proof-run.json",
      game: "00000000-0000-0000-0000-000000000001",
      cellIds: [
        "replacement-private-post",
        "replacement-vote",
        "replacement-action",
      ],
      reconnectLaneIds: [
        "reconnect-recovery",
        "replacement-reconnect-recovery",
        "stale-action-reconnect-recovery",
        "stale-host-complete-reconnect-recovery",
        "stale-host-resolve-reconnect-recovery",
        "stale-host-advance-reconnect-recovery",
        "stale-host-deadline-reconnect-recovery",
        "stale-cohost-deadline-reconnect-recovery",
      ],
      staleConflictLaneIds: [
        "replacement-stale-conflict-message",
        "stale-action-conflict-message",
      ],
      progressCheckIds: [
        "hosted-like-api-frontend-target",
        "multi-session-concurrent-command-matrix",
        "reload-recovery-after-races",
        "reconnect-recovery",
        "stale-client-conflict-messages",
        "raw-role-credential-redaction",
        "real-hosted-deployment",
      ],
      relatedAuditIds: ["local-race-coverage", "local-next-action"],
      requestedEvidenceId: "hosted-concurrent-race-matrix",
      hostedEvidenceStatus: "not_configured",
      realHostedDeploymentStatus: "unproven",
    },
    adminRoleSurface: {
      status: "passed",
      overviewRoleUrl: "/admin?game=<seeded-game>",
      detailRoleUrl:
        "/admin/audit/local-hosted-concurrent-race-matrix?game=<seeded-game>",
      linkTestId: "admin-audit-link-local-hosted-concurrent-race-matrix",
      surfaceTestId: "admin-audit-detail-surface",
      clickedThroughFromOverview: true,
      visibleChecks: [
        "hosted-like-api-frontend-target",
        "multi-session-concurrent-command-matrix",
        "reload-recovery-after-races",
        "reconnect-recovery",
        "stale-client-conflict-messages",
        "raw-role-credential-redaction",
        "real-hosted-deployment",
        "replacement-private-post",
        "replacement-vote",
        "replacement-action",
      ],
      visibleReconnectLanes: [
        "reconnect-recovery",
        "replacement-reconnect-recovery",
        "stale-action-reconnect-recovery",
        "stale-host-complete-reconnect-recovery",
        "stale-host-resolve-reconnect-recovery",
        "stale-host-advance-reconnect-recovery",
        "stale-host-deadline-reconnect-recovery",
        "stale-cohost-deadline-reconnect-recovery",
      ],
      visibleStaleConflictLanes: [
        "replacement-stale-conflict-message",
        "stale-action-conflict-message",
      ],
      visibleUnproven: [
        "hosted-concurrent-race-matrix",
        "remaining-gap-1",
        "remaining-gap-2",
      ],
      visibleRelatedLinks: ["local-race-coverage", "local-next-action"],
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    },
  };
}

function spineManifestFixture() {
  return {
    version: 1,
    proof: "dev-test-game-spine-manifest",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    generatedAt: "2026-06-26T00:00:00.000Z",
    scope: "local-dev-test-game-spine-manifest",
    proofBoundary: "Generated local dev-test-game orchestration manifest.",
    commands: {
      live: { plan: [{ script: "dev:test-game:prebuild" }] },
      backupRestore: { plan: [{ script: "tools/live_stack_backup_restore_drill.mjs" }] },
      identity: { plan: [{ script: "tools/auth_invite_role_proof.mjs" }] },
      adminSpine: {
        script: "test:dev-test-game-admin-spine",
        proofArtifact: "target/dev-test-game/admin-spine-proof.json",
        plan: [{ script: "tools/dev_test_game_spine_manifest_admin_proof.mjs" }],
      },
      proofFreshness: {
        script: "test:dev-test-game-proof-freshness-admin-proof",
        proofArtifact: "target/dev-test-game/proof-freshness-admin-proof.json",
      },
      nextAction: {
        script: "test:dev-test-game-next-action",
        proofArtifact: "target/dev-test-game/next-action.json",
      },
    },
    terminalArtifacts: [
      {
        id: "next-action",
        command: "test:dev-test-game-next-action",
        path: "target/dev-test-game/next-action.json",
      },
      {
        id: "next-action-admin-proof",
        command: "test:dev-test-game-next-action-admin-proof",
        path: "target/dev-test-game/next-action-admin-proof.json",
        roleUrl: "/admin/audit/local-next-action?game=<seeded-game>",
        dependsOn: [
          "target/dev-test-game/next-action.json",
          "target/dev-test-game/proof-run.json",
        ],
      },
    ],
    artifactFreshness: {
      status: "blocked",
      proof: "dev-test-game-proof-freshness",
      proofCommand: "test:dev-test-game-proof-freshness-admin-proof",
      proofArtifact: "target/dev-test-game/proof-freshness-admin-proof.json",
      summary: {
        artifactCount: 2,
        freshCount: 1,
        staleCount: 1,
        missingCount: 0,
      },
      nextCommand:
        "DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run test:dev-test-game-live",
      proofBoundary: "Local proof freshness dashboard.",
      artifacts: [
        {
          id: "proof-run",
          label: "Dev test-game proof run",
          path: "target/dev-test-game/proof-run.json",
          status: "stale",
          refreshCommand:
            "DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run test:dev-test-game-live",
          nextCommand:
            "DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run test:dev-test-game-live",
          refreshSource: "manifest-default",
        },
        {
          id: "spine-manifest",
          label: "Spine manifest",
          path: "target/dev-test-game/spine-manifest.json",
          status: "fresh",
          refreshCommand: "npm run test:dev-test-game-spine-manifest",
          refreshSource: "manifest-default",
        },
      ],
    },
    artifacts: [
      "target/dev-test-game/spine-manifest.json",
      "target/dev-test-game/spine-manifest.md",
      "target/dev-test-game/spine-manifest-admin-proof.json",
      "target/dev-test-game/proof-freshness-admin-proof.json",
      "target/dev-test-game/next-action.json",
      "target/dev-test-game/next-action-admin-proof.json",
    ],
    checks: [
      { id: "live-spine-order-recorded", status: "passed" },
      { id: "sub-spine-orders-recorded", status: "passed" },
      { id: "evidence-env-wiring-recorded", status: "passed" },
      { id: "freshness-proof-recorded", status: "passed" },
      { id: "artifact-refresh-status-recorded", status: "passed" },
      {
        id: "release-boundary-carried",
        status: "passed",
        releaseReady: false,
        productionReady: false,
      },
    ],
  };
}

function spineManifestAdminProofFixture() {
  return {
    version: 1,
    proof: "dev-test-game-spine-manifest-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-spine-manifest-admin-surface",
    proofBoundary: "Local admin spine manifest proof only.",
    generatedFrom: {
      spineManifest: "target/dev-test-game/spine-manifest.json",
      proofRun: "target/dev-test-game/proof-run.json",
      game: "00000000-0000-0000-0000-000000000001",
    },
    adminRoleSurface: {
      status: "passed",
      overviewRoleUrl: "/admin?game=<seeded-game>",
      detailRoleUrl: "/admin/audit/local-spine-manifest?game=<seeded-game>",
      linkTestId: "admin-audit-link-local-spine-manifest",
      surfaceTestId: "admin-audit-detail-surface",
      clickedThroughFromOverview: true,
      visibleChecks: [
        "live-spine-order-recorded",
        "sub-spine-orders-recorded",
        "evidence-env-wiring-recorded",
        "freshness-proof-recorded",
        "artifact-refresh-status-recorded",
        "release-boundary-carried",
      ],
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    },
  };
}

function hostedTargetPreflightAdminProofFixture() {
  return {
    version: 1,
    proof: "dev-test-game-hosted-target-preflight-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-hosted-target-preflight-admin-surface",
    proofBoundary: "Local admin hosted target preflight proof only.",
    generatedFrom: {
      hostedTargetPreflight: "target/dev-test-game/hosted-target-preflight.json",
      proofRun: "target/dev-test-game/proof-run.json",
      game: "00000000-0000-0000-0000-000000000001",
      status: "blocked",
      checkIds: [
        "hosted-frontend-url-configured",
        "hosted-api-url-configured",
        "hosted-targets-external",
        "raw-evidence-path-configured",
        "raw-evidence-readable",
        "release-claim-boundary-carried",
      ],
      blockedCheckIds: [
        "hosted-frontend-url-configured",
        "hosted-api-url-configured",
        "hosted-targets-external",
        "raw-evidence-path-configured",
        "raw-evidence-readable",
      ],
      relatedAuditIds: [
        "local-hosted-concurrent-race-matrix",
        "local-next-action",
      ],
    },
    adminRoleSurface: {
      status: "passed",
      overviewRoleUrl: "/admin?game=<seeded-game>",
      detailRoleUrl:
        "/admin/audit/local-hosted-target-preflight?game=<seeded-game>",
      linkTestId: "admin-audit-link-local-hosted-target-preflight",
      surfaceTestId: "admin-audit-detail-surface",
      clickedThroughFromOverview: true,
      visibleChecks: [
        "hosted-frontend-url-configured",
        "hosted-api-url-configured",
        "hosted-targets-external",
        "raw-evidence-path-configured",
        "raw-evidence-readable",
        "release-claim-boundary-carried",
      ],
      visibleUnproven: [
        "hosted-frontend-url-configured",
        "hosted-api-url-configured",
        "hosted-targets-external",
        "raw-evidence-path-configured",
        "raw-evidence-readable",
      ],
      visibleRelatedLinks: [
        "local-hosted-concurrent-race-matrix",
        "local-next-action",
      ],
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    },
  };
}

function hostedEvidenceLaneAdminProofFixture() {
  return {
    version: 1,
    proof: "dev-test-game-hosted-evidence-lane-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-hosted-evidence-lane-admin-surface",
    proofBoundary: "Local admin hosted evidence lane proof only.",
    generatedFrom: {
      hostedEvidenceLane: "target/dev-test-game/hosted-evidence-lane.json",
      proofRun: "target/dev-test-game/proof-run.json",
      game: "00000000-0000-0000-0000-000000000001",
      status: "blocked",
      preflightStatus: "blocked",
      checkIds: [
        "hosted-target-preflight",
        "hosted-frontend-url-configured",
        "hosted-api-url-configured",
        "hosted-targets-external",
        "raw-evidence-path-configured",
        "raw-evidence-readable",
        "release-claim-boundary-carried",
      ],
      blockedCheckIds: [
        "hosted-frontend-url-configured",
        "hosted-api-url-configured",
        "hosted-targets-external",
        "raw-evidence-path-configured",
        "raw-evidence-readable",
      ],
      relatedAuditIds: [
        "local-hosted-target-preflight",
        "local-hosted-concurrent-race-matrix",
        "local-next-action",
      ],
    },
    adminRoleSurface: {
      status: "passed",
      overviewRoleUrl: "/admin?game=<seeded-game>",
      detailRoleUrl: "/admin/audit/local-hosted-evidence-lane?game=<seeded-game>",
      linkTestId: "admin-audit-link-local-hosted-evidence-lane",
      surfaceTestId: "admin-audit-detail-surface",
      clickedThroughFromOverview: true,
      visibleChecks: [
        "hosted-target-preflight",
        "hosted-frontend-url-configured",
        "hosted-api-url-configured",
        "hosted-targets-external",
        "raw-evidence-path-configured",
        "raw-evidence-readable",
        "release-claim-boundary-carried",
      ],
      visibleUnproven: [
        "hosted-frontend-url-configured",
        "hosted-api-url-configured",
        "hosted-targets-external",
        "raw-evidence-path-configured",
        "raw-evidence-readable",
      ],
      visibleRelatedLinks: [
        "local-hosted-target-preflight",
        "local-hosted-concurrent-race-matrix",
        "local-next-action",
      ],
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    },
  };
}

function hostedTargetPreflightFixture({ status }) {
  const passed = status === "passed";
  return {
    version: 1,
    proof: "dev-test-game-hosted-target-preflight",
    status,
    releaseReady: false,
    productionReady: false,
    generatedAt: "2026-06-26T00:00:00.000Z",
    scope: "hosted-target-preflight",
    proofBoundary: "Hosted target preflight fixture without release claims.",
    target: {
      frontendBaseUrl: passed ? "https://fmarch.example.test" : null,
      apiBaseUrl: passed ? "https://api.fmarch.example.test" : null,
      groupId: "replacement-race-reload",
      rawEvidencePath: passed
        ? "target/dev-test-game/hosted-matrix-raw-evidence.json"
        : null,
      rawEvidenceStatus: passed ? "passed" : "blocked",
    },
    checks: [
      {
        id: "hosted-frontend-url-configured",
        status: passed ? "passed" : "blocked",
      },
      {
        id: "hosted-api-url-configured",
        status: passed ? "passed" : "blocked",
      },
      {
        id: "hosted-targets-external",
        status: passed ? "passed" : "blocked",
      },
      {
        id: "raw-evidence-path-configured",
        status: passed ? "passed" : "blocked",
      },
      {
        id: "raw-evidence-readable",
        status: passed ? "passed" : "blocked",
      },
      {
        id: "release-claim-boundary-carried",
        status: "passed",
        releaseReady: false,
        productionReady: false,
      },
    ],
    nextCommand: passed
      ? `npm run ${devTestGameHostedMatrixExternalEvidenceCommand}`
      : `npm run ${devTestGameHostedTargetPreflightCommand}`,
    nextProofTarget: passed
      ? devTestGameHostedMatrixExternalEvidencePath
      : devTestGameHostedTargetPreflightPath,
  };
}

function adminSpineAdminProofFixture() {
  return {
    version: 1,
    proof: "dev-test-game-admin-spine-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-admin-spine-admin-surface",
    proofBoundary: "Local admin aggregate spine proof only.",
    generatedFrom: {
      adminSpineProof: "target/dev-test-game/admin-spine-proof.json",
      proofRun: "target/dev-test-game/proof-run.json",
      game: "00000000-0000-0000-0000-000000000001",
      proofIds: [
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
        "hosted-evidence-lane",
        "hosted-concurrent-race-matrix",
        "hosted-ops-signals",
        "spine-manifest",
      ],
    },
    adminRoleSurface: {
      status: "passed",
      overviewRoleUrl: "/admin?game=<seeded-game>",
      detailRoleUrl: "/admin/audit/local-admin-spine?game=<seeded-game>",
      linkTestId: "admin-audit-link-local-admin-spine",
      surfaceTestId: "admin-audit-detail-surface",
      clickedThroughFromOverview: true,
      visibleChecks: [
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
        "hosted-evidence-lane",
        "hosted-concurrent-race-matrix",
        "hosted-ops-signals",
        "spine-manifest",
        "recovery",
      ],
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    },
  };
}

function adminSpineProofFixture() {
  const fixtures = [
    ["core-loop", coreLoopAdminProofFixture()],
    ["hardening", hardeningAdminProofFixture()],
    ["identity", identityAdminProofFixture()],
    ["backup", backupAdminProofFixture()],
    ["ops", opsAdminProofFixture()],
    ["seed", seedAdminProofFixture()],
    ["release", releaseAdminProofFixture()],
    ["release-runbook", releaseRunbookAdminProofFixture()],
    ["race-coverage", raceCoverageAdminProofFixture()],
    ["hosted-target-preflight", hostedTargetPreflightAdminProofFixture()],
    ["hosted-evidence-lane", hostedEvidenceLaneAdminProofFixture()],
    [
      "hosted-concurrent-race-matrix",
      hostedConcurrentRaceMatrixAdminProofFixture(),
    ],
    ["hosted-ops-signals", hostedOpsSignalsAdminProofFixture()],
    ["spine-manifest", spineManifestAdminProofFixture()],
  ];
  return {
    version: 1,
    proof: "dev-test-game-admin-spine-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-admin-spine",
    generatedAt: "2026-06-26T00:00:00.000Z",
    generatedFrom: {
      game: "00000000-0000-0000-0000-000000000001",
      proofs: Object.fromEntries(fixtures.map(([id]) => [id, proofPathFor(id)])),
    },
    adminProofs: fixtures.map(([id, proof]) => ({
      id,
      label: `${id} admin proof`,
      proof: proof.proof,
      status: "passed",
      path: proofPathFor(id),
      rerunCommand: adminProofRerunCommandFor(id),
      refreshedInCurrentRun: true,
      game: proof.generatedFrom.game,
      overviewRoleUrl: proof.adminRoleSurface.overviewRoleUrl,
      detailRoleUrl: proof.adminRoleSurface.detailRoleUrl,
      releaseReady: false,
      productionReady: false,
    })),
    recovery: {
      status: "passed",
      surfaceCount: fixtures.length,
      refreshedCount: fixtures.length,
      nextCommand: "npm run test:dev-test-game-admin-spine",
      proofBoundary: "Local aggregate recovery commands only.",
      surfaces: fixtures.map(([id]) => ({
        id,
        label: `${id} admin proof`,
        status: "passed",
        path: proofPathFor(id),
        rerunCommand: adminProofRerunCommandFor(id),
        refreshedInCurrentRun: true,
        mtime: "2026-06-26T00:00:00.000Z",
        sizeBytes: 42,
      })),
    },
    proofBoundary: "Local aggregate admin spine proof only.",
  };
}

function proofPathFor(id) {
  return `target/dev-test-game/${id === "core-loop" ? "core-loop" : id}-admin-proof.json`;
}

function adminProofRerunCommandFor(id) {
  return `npm run test:dev-test-game-${id}-admin-proof`;
}

function identityRole({ role, loginUrl, principalUserId, capabilityKinds }) {
  return {
    role,
    loginUrl,
    returnTo: new URL(loginUrl).searchParams.get("returnTo"),
    principalUserId,
    capabilityKinds,
    cookie: {
      httpOnly: true,
      sameSite: "Lax",
      secure: false,
      valuePrefix: "invite-session-",
    },
  };
}
