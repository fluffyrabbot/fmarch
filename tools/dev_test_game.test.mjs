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

test("session card and markdown include role invite URLs and tokens", () => {
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
    roles: ["host", "player", "actionPlayer", "deniedPlayer"],
    coreLoop: {
      status: "passed",
      proof: "host locked D01 and player recovered from PhaseLocked",
      lock: { commandStatus: { state: "ack" } },
      rejectedVote: { error: "PhaseLocked", message: "Reject PhaseLocked: phase locked" },
      unlock: { commandStatus: { state: "ack" } },
    },
    actionLoop: {
      status: "passed",
      proof: "host resolved N01 and action player advanced to D02",
      invalidAction: { error: "InvalidTarget", message: "Reject InvalidTarget: invalid target" },
      legalAction: { state: "ack", message: "Ack: stream seqs 42" },
      resolvedTargetSlot: { alive: false },
      d02Phase: { phaseId: "D02" },
    },
    privateChannel: {
      status: "passed",
      proof: "player posted privately and denied player recovered",
      channel: "private:mafia_day_chat",
      allowed: { submitPost: { state: "ack", message: "Ack: stream seqs 43" } },
      denied: { status: 403, actionLabel: "Back to board" },
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
      staleActionConflict: {
        status: "passed",
        staleN01Phase: { phaseId: "N01" },
        reject: {
          error: "PhaseLocked",
          message:
            "Reject PhaseLocked: phase locked; stale projection, refresh and use current controls",
        },
        phaseAfterReject: { phaseId: "D02" },
        actionVisibleAfterRefresh: false,
      },
      staleHostControl: {
        reject: {
          error: "PhaseLocked",
          message:
            "Reject PhaseLocked: phase locked; stale phase state, refresh and use current controls",
        },
        phaseAfterReject: { phase_id: "D02", locked: false },
      },
    },
  };
  const markdown = markdownSessionCard(card);
  assert(markdown.includes("# fmarch Dev Test Game"));
  assert(markdown.includes("Open a role invite URL"));
  assert(markdown.includes("dev-test-card-host"));
  assert(markdown.includes(`returnTo=%2Fg%2F${game}`));
  assert(markdown.includes("Invite token: dev-test-card-player"));
  assert(markdown.includes("## Core Loop Proof"));
  assert(markdown.includes("Reject PhaseLocked: phase locked"));
  assert(markdown.includes("## Action Loop Proof"));
  assert(markdown.includes("Reject InvalidTarget: invalid target"));
  assert(markdown.includes("## Private Channel Proof"));
  assert(markdown.includes("Denied route: 403 Back to board"));
  assert(markdown.includes("## Multiplayer Hardening Proof"));
  assert(markdown.includes("Duplicate retry: Ack: stream seqs 44"));
  assert(markdown.includes("Reconnect: attempt 1 recovered"));
  assert(markdown.includes("Stale player vote: Reject PhaseLocked"));
  assert(markdown.includes("Concurrent vote race: slot_5 count 2"));
  assert(markdown.includes("Stale action conflict: Reject PhaseLocked"));
  assert(markdown.includes("Stale control: Reject PhaseLocked"));
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
      "core-loop",
      "action-loop",
      "private-channel",
      "idempotent-retry",
      "reconnect-recovery",
      "stale-player-vote",
      "concurrent-vote-race",
      "stale-action-conflict",
      "stale-host-control",
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
  assert.equal(opsArtifacts.proofRun.laneCount, 10);
  assert.equal(
    opsArtifacts.roles.host.loginUrlRedacted,
    `http://127.0.0.1:4102/auth/login?returnTo=%2Fg%2F${game}%2Fhost&invite=REDACTED`,
  );
  assert.equal(JSON.stringify(opsArtifacts).includes("dev-test-card-host"), false);
  assert.equal(JSON.stringify(opsArtifacts).includes("dev-test-card-player"), false);
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
  assert.equal(JSON.stringify(seedFixture).includes("dev-test-card-host"), false);
  assert.equal(JSON.stringify(seedFixture).includes("dev-test-card-player"), false);
  assert.deepEqual(
    seedFixture.demoScenarios.map((scenario) => scenario.id),
    [
      "host-phase-controls",
      "player-vote-recovery",
      "night-action-loop",
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
    version: 5,
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
      visibleChecks: ["core-loop", "action-loop", "private-channel"],
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
        "idempotent-retry",
        "reconnect-recovery",
        "stale-player-vote",
        "concurrent-vote-race",
        "stale-action-conflict",
        "stale-host-control",
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
        "player-vote-recovery",
        "night-action-loop",
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
      adminSpine: { plan: [{ script: "tools/dev_test_game_spine_manifest_admin_proof.mjs" }] },
    },
    artifacts: [
      "target/dev-test-game/spine-manifest.json",
      "target/dev-test-game/spine-manifest.md",
      "target/dev-test-game/spine-manifest-admin-proof.json",
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
