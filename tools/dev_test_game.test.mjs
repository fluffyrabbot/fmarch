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
  });
  assertDevTestGameReleaseReadiness(opsReadiness);
  assert(
    opsReadiness.localDevelopmentSpine.checks.some(
      (item) => item.id === "local-ops-artifact-bundle" && item.status === "passed",
    ),
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
  });
  assertDevTestGameReleaseReadiness(seedFixtureReadiness);
  assert(
    seedFixtureReadiness.localDevelopmentSpine.checks.some(
      (item) => item.id === "local-seed-demo-fixture" && item.status === "passed",
    ),
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
  });
  assertDevTestGameReleaseReadiness(identityReadiness);
  assert(
    identityReadiness.localDevelopmentSpine.checks.some(
      (item) => item.id === "local-identity-adapter-proof" && item.status === "passed",
    ),
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
    version: 4,
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
        roleUrl: "/admin/audit/identity-lifecycle?game=<seeded-game>&principal_user_id=host_h",
        surfaceTestId: "admin-audit-detail-surface",
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
