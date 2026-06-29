import assert from "node:assert/strict";
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
    FMARCH_DEV_TEST_GAME_SEED_FIXTURE_SUMMARY:
      "target/dev-test-game/seed-fixture-summary.json",
    FMARCH_DEV_TEST_GAME_SEED_ADMIN_PROOF:
      "target/dev-test-game/seed-admin-proof.json",
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
    FMARCH_DEV_TEST_GAME_PROOF_GRAPH: "target/dev-test-game/proof-graph.json",
    FMARCH_DEV_TEST_GAME_PROOF_GRAPH_ADMIN_PROOF:
      "target/dev-test-game/proof-graph-admin-proof.json",
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
      "target/dev-test-game/spine-manifest.json",
      "target/dev-test-game/admin-spine-proof.json",
      "target/dev-test-game/release-readiness-checklist.json",
    ],
  });
  assert.deepEqual(manifest.commands.nextAction, {
    script: nextActionCommand,
    proofArtifact: nextActionPath,
    dependsOn: ["target/dev-test-game/spine-manifest.json"],
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
  });
  assertDevTestGameNextAction(freshAction);
  assert.deepEqual(freshAction.nextAction, {
    command: "test:dev-test-game-proof-freshness-admin-proof",
    reason: "all-artifacts-fresh",
    status: "ready",
  });
  assert.deepEqual(freshAction.selectionTrace, {
    strategy: "development-spine-priority",
    candidateCount: 0,
    selectedArtifactId: null,
    candidates: [],
  });
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
    command:
      "DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run test:dev-test-game-live",
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
        "DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run test:dev-test-game-live",
      ],
      [2, "release", "missing", 13, false, "npm run test:dev-test-game-release-admin-proof"],
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
  assert.equal(graph.summary.nodeCount, 12);
  assert.equal(graph.summary.roleUrlCount, 12);
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
        "DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run test:dev-test-game-live",
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

test("session card and markdown include role credential URLs and tokens", () => {
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
      rejectedVote: { error: "PhaseLocked", message: "Reject PhaseLocked: phase locked" },
      unlock: { commandStatus: { state: "ack" } },
    },
    dayVoteResolution: {
      status: "passed",
      proof: "action-player cast the majority day vote and host resolved the lynch",
      voterBeforeVote: {
        voteTargets: [
          { kind: "slot", slotId: "slot-2", label: "Slot 2" },
          { kind: "slot", slotId: "slot-3", label: "Slot 3" },
          { kind: "no_lynch", slotId: null, label: "No lynch" },
        ],
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
      targetControls: { vote: true, withdraw: true, post: true },
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
      disabledControls: { vote: true, withdraw: true, post: true },
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
        vote: {
          requestEnvelope: {
            body: {
              body: {
                principal_user_id: "player-rowan",
                command: {
                  SubmitVote: {
                    actor_slot: "slot-7",
                    target: { Slot: "slot_5" },
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
        reject: {
          error: "PhaseLocked",
          message:
            "Reject PhaseLocked: phase locked; stale projection, refresh and use current controls",
        },
        phaseAfterReject: { locked: true },
        hostPhaseAfterUnlock: { locked: false },
      },
      concurrentVoteRace: {
        status: "passed",
        targetSlot: "slot_5",
        playerVote: { state: "ack", streamSeqs: [45] },
        actionVote: { state: "ack", streamSeqs: [46] },
        apiProjection: { count: 2 },
      },
      hostVotecountPublication: {
        status: "passed",
        expectedBody: "Official votecount for D02\n- slot_5: 2",
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
          body: "Official votecount for D02\n- slot_5: 2",
          authorLabel: "host",
        },
        apiThreadPost: {
          body: "Official votecount for D02\n- slot_5: 2",
          author_user: "host",
        },
        activityStatusText: "Ack: stream seqs 47",
      },
      staleHostPublish: {
        status: "passed",
        actionId: "publish_votecount",
        setup: {
          stalePhase: { id: "D02", locked: false },
          votecountRows: [{ target: "slot_5", count: 2 }],
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
          vote: true,
          withdraw: true,
          post: true,
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
            "Reject InvalidTarget: invalid target; slot lifecycle is already current, refresh the slot controls before retrying",
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
          "Reject InvalidTarget: invalid target; slot lifecycle is already current, refresh the slot controls before retrying",
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
          vote: true,
          withdraw: true,
          post: true,
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
            "Reject InvalidTarget: invalid target; slot lifecycle is already current, refresh the slot controls before retrying",
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
          "Reject InvalidTarget: invalid target; slot lifecycle is already current, refresh the slot controls before retrying",
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
          error: "PhaseLocked",
          message:
            "Reject PhaseLocked: phase locked; stale action state, refresh and use current action controls",
        },
        phaseAfterReject: { phaseId: "D02" },
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
        apiCommandStateAfterReject: {
          game_completed: true,
          actions: [],
          vote_targets: [],
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
  assert(markdown.includes("Concurrent vote race: slot_5 count 2"));
  assert(markdown.includes("Host lifecycle: Ack: stream seqs 48"));
  assert(markdown.includes("Stale host lifecycle: Reject InvalidTarget"));
  assert(markdown.includes("Host modkill: Ack: stream seqs 49"));
  assert(markdown.includes("Stale host modkill: Reject InvalidTarget"));
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
      "reconnect-recovery",
      "stale-player-vote",
      "concurrent-vote-race",
      "host-votecount-publication",
      "stale-host-publish",
      "host-lifecycle-control",
      "stale-host-lifecycle",
      "host-modkill-control",
      "stale-host-modkill",
      "stale-host-prompt",
      "stale-host-complete",
      "stale-player-complete",
      "stale-dead-action-conflict",
      "stale-action-conflict",
      "stale-action-conflict-message",
      "stale-host-control",
      "stale-host-resolve",
      "stale-host-advance",
      "stale-host-deadline",
      "stale-cohost-deadline",
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
  assert.equal(opsArtifacts.proofRun.laneCount, 52);
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
      "stale-action-conflict-message",
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
    8,
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
    "spine-manifest",
  ]);
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
        "reconnect-recovery",
        "stale-player-vote",
        "concurrent-vote-race",
        "stale-host-publish",
        "stale-host-lifecycle",
        "stale-host-modkill",
        "stale-host-prompt",
        "stale-host-complete",
        "stale-player-complete",
        "stale-dead-action-conflict",
        "stale-action-conflict",
        "stale-action-conflict-message",
        "stale-host-control",
        "stale-host-resolve",
        "stale-host-advance",
        "stale-host-deadline",
        "stale-cohost-deadline",
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
        "release-boundary-carried",
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
        "stale-action-conflict-message",
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
