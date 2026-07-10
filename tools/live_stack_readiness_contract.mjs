import {
  hasCompleteSetupCommandEvidence,
} from "./dev_test_game_setup_bootstrap_scenario.mjs";

export const LIVE_STACK_READINESS_VERSION = 1;

const CHECKS = Object.freeze([
  {
    id: "scratch-database",
    label: "Scratch database lifecycle is local and disposable",
    predicate: (evidence) =>
      evidence?.database?.lifecycle === "created-and-dropped-per-smoke-run",
  },
  {
    id: "role-sessions",
    label: "Seeded local role sessions cover admin, host, players, and cohost",
    predicate: (evidence) =>
      [
        "admin",
        "host",
        "player",
        "actionPlayer",
        "racePlayer",
        "cohost",
      ].every((key) => evidence?.grantedSessions?.[key]?.principalUserId),
  },
  {
    id: "admin-identity",
    label: "Admin route proves session grants and authenticated login",
    predicate: (evidence) =>
      evidence?.browser?.admin?.createOutcome?.state === "ack" &&
      evidence?.browser?.admin?.cohostOutcome?.state === "ack" &&
      evidence?.browser?.admin?.grantedGlobalModLogin?.sessionCookie
        ?.valueMatchesGrantedToken === true,
  },
  {
    id: "host-setup-workflow",
    label: "Admin-created game setup proves roster, role, policy, StartGame, and host handoff",
    predicate: (evidence) =>
      evidence?.browser?.admin?.hostSetup?.status === "passed" &&
      hasCompleteSetupCommandEvidence(
        evidence.browser.admin.hostSetup?.setupCommandEvidence,
      ) &&
      evidence.browser.admin.hostSetup?.setupCommandEvidence?.assignRole?.command
        ?.role_key ===
        "vanilla_townie" &&
      evidence.browser.admin.hostSetup?.setupCommandEvidence?.setPostPolicy?.command
        ?.allow_media_only === true &&
      evidence.browser.admin.hostSetup?.setupCommandEvidence?.startGame?.command
        ?.phase === "D01" &&
      evidence.browser.admin.hostSetup?.readyReadiness?.summary === "Ready to start" &&
      evidence.browser.admin.hostSetup?.startedReadiness?.summary === "Started at D01" &&
      evidence.browser.admin.hostSetup?.hostConsoleState?.phase?.phase_id === "D01" &&
      evidence.browser.admin.hostSetup?.hostConsoleState?.slot?.slot_id === "slot_1",
  },
  {
    id: "host-phase-controls",
    label: "Host route proves lock, stale lock recovery, unlock, and phase controls",
    predicate: (evidence) =>
      evidence?.browser?.moderator?.phaseControls?.lock?.commandStatus?.state ===
        "ack" &&
      evidence?.browser?.moderator?.phaseControls?.staleLockReject?.commandStatus
        ?.error === "PhaseLocked" &&
      evidence?.browser?.moderator?.phaseControls?.unlock?.commandStatus?.state ===
        "ack",
  },
  {
    id: "player-vote-loop",
    label: "Player route proves vote, duplicate retry, concurrent vote, and withdraw loop",
    predicate: (evidence) =>
      evidence?.browser?.player?.duplicateVoteRetry?.outcome?.state === "ack" &&
      evidence?.browser?.player?.duplicateVoteRetry?.voteRows?.includes(
        "VoteSubmitted",
      ) &&
      evidence?.browser?.player?.concurrentVoteRace?.firstOutcome?.state === "ack" &&
      evidence?.browser?.player?.concurrentVoteRace?.secondOutcome?.state ===
        "ack" &&
      evidence?.browser?.player?.concurrentVoteRace?.rows?.includes("slot_4") &&
      evidence?.browser?.player?.concurrentVoteRace?.rows?.includes("slot-7") &&
      evidence?.browser?.hostVotecountConvergence?.status === "passed" &&
      evidence?.browser?.hostVotecountConvergence?.expectedCount === 1 &&
      evidence?.browser?.hostVotecountConvergence?.after?.projection?.some(
        (row) => row.target === "slot_1" && row.count === 1,
      ),
  },
  {
    id: "player-action-resolution",
    label: "Player action route proves invalid action recovery, submit, resolve, and advance",
    predicate: (evidence) =>
      evidence?.browser?.playerAction?.invalidOutcome?.error ===
        "InvalidTarget" &&
      evidence?.browser?.playerAction?.legalOutcome?.state === "ack" &&
      Array.isArray(evidence?.browser?.playerAction?.resolveCommand?.streamSeqs) &&
      Array.isArray(evidence?.browser?.playerAction?.advanceCommand?.streamSeqs) &&
      evidence?.browser?.playerAction?.resolvedTargetSlot?.alive === false,
  },
  {
    id: "private-channels",
    label: "Private channel route proves member access, media, and forbidden access",
    predicate: (evidence) =>
      evidence?.browser?.playerPrivateChannel?.submitPost?.outcome?.state ===
        "ack" &&
      evidence?.browser?.playerPrivateChannel?.media?.responses?.some(
        (response) => response.ok === true,
      ) &&
      evidence?.browser?.privateChannelForbidden?.status === 403,
  },
  {
    id: "role-pm-replacement-lifecycle",
    label: "Role PM proves engine declaration, live replacement transfer, reload, and stale denial",
    predicate: (evidence) =>
      evidence?.browser?.rolePmHistory?.channelId === "private:role_pm:slot-7" &&
      evidence?.browser?.moderator?.rolePmReplacement?.status === "passed" &&
      evidence.browser.moderator.rolePmReplacement?.incoming?.submitOutcome?.state ===
        "ack" &&
      evidence.browser.moderator.rolePmReplacement?.incoming?.initialLiveDelta?.delta
        ?.kind === "ThreadPostsChanged" &&
      evidence.browser.moderator.rolePmReplacement?.incoming?.commandLiveDelta?.delta
        ?.kind === "ThreadPostsChanged" &&
      evidence.browser.moderator.rolePmReplacement?.incoming?.reloadedPostBodies?.includes(
        "Role PM history before replacement",
      ) &&
      evidence.browser.moderator.rolePmReplacement?.incoming?.reloadedPostBodies?.includes(
        "Incoming replacement continued the durable Role PM",
      ) &&
      evidence.browser.moderator.rolePmReplacement?.outgoing?.routeStatus === 403 &&
      evidence.browser.moderator.rolePmReplacement?.outgoing?.threadStatus === 403 &&
      evidence.browser.moderator.rolePmReplacement?.outgoing?.mediaStatus === 403 &&
      evidence.browser.moderator.rolePmReplacement?.outgoing?.mediaBodyBytes === 0 &&
      evidence.browser.moderator.rolePmReplacement?.outgoing?.stalePostReject?.error ===
        "NotYourSlot",
  },
  {
    id: "mason-neighbor-room-lifecycle",
    label: "Mason and Neighbor rooms prove pack creation, encryption, media, live reload, replacement, and denial",
    predicate: (evidence) => {
      const additionalRooms = evidence?.browser?.additionalRooms;
      if (
        additionalRooms?.status !== "passed" ||
        JSON.stringify(additionalRooms.coveredKinds) !==
          JSON.stringify(["Mason", "Neighbor"]) ||
        JSON.stringify(additionalRooms.remainingKinds) !==
          JSON.stringify(["Spectator"])
      ) {
        return false;
      }
      return ["Mason", "Neighbor"].every((kind) =>
        additionalRoomLifecyclePassed(
          additionalRooms.rooms?.find((room) => room.kind === kind),
          kind,
        ),
      );
    },
  },
  {
    id: "dead-chat-lifecycle",
    label: "Dead chat proves lifecycle authority, encryption, media, live reload, replacement, and revocation",
    predicate: (evidence) => deadChatLifecyclePassed(evidence?.browser?.deadChat),
  },
  {
    id: "reconnect-recovery",
    label: "Player route proves live projection reconnect recovery without reload",
    predicate: (evidence) =>
      evidence?.browser?.player?.reconnect?.reconnectRecoveryEvent?.state ===
        "recovered" &&
      evidence?.browser?.player?.reconnect?.recoveredSnapshotContainsPost === true,
  },
  {
    id: "stale-player-recovery",
    label: "Player route proves stale action and stale vote recovery copy plus refresh",
    predicate: (evidence) =>
      evidence?.browser?.player?.staleVoteRecovery?.recovery?.outcome?.error ===
        "PhaseLocked" &&
      isStalePlayerVoteRecoveryMessage(
        evidence?.browser?.player?.staleVoteRecovery?.recovery?.statusMessage,
      ) &&
      evidence?.browser?.playerAction?.staleActionRecovery?.outcome?.error ===
        "PhaseLocked" &&
      evidence?.browser?.playerAction?.staleActionRecovery?.statusMessage?.includes(
        "stale action state",
      ) &&
      evidence?.browser?.playerAction?.staleActionRecovery?.statusMessage?.includes(
        "current action controls",
      ),
  },
  {
    id: "host-ops-workflow",
    label: "Host route proves prompt resolution, slot lifecycle, and API projection truth",
    predicate: (evidence) =>
      evidence?.browser?.moderator?.hostPrompt?.commandStatus?.state === "ack" &&
      evidence?.browser?.moderator?.slotLifecycle?.commandStatus?.state === "ack" &&
      evidence?.browser?.moderator?.playerInviteTarget?.status === "passed" &&
      evidence?.browser?.moderator?.playerInviteTarget?.principalUserId ===
        "player-rowan" &&
      evidence?.browser?.moderator?.stalePlayerInviteReject?.state === "recovered" &&
      evidence?.browser?.moderator?.stalePlayerInviteReject?.reject?.message?.includes(
        "Invite target is stale",
      ) &&
      evidence?.browser?.moderator?.stalePlayerInviteReject?.retry?.state ===
        "ack" &&
      evidence?.browser?.moderator?.stalePlayerInviteReject?.retry?.target
        ?.principalUserId === "player-rowan" &&
      evidence?.slotLifecycleApiState?.slots?.some(
        (slot) => slot.slot_id === "slot-7" && slot.alive === false,
      ),
  },
]);

function additionalRoomLifecyclePassed(room, kind) {
  return (
    room?.status === "passed" &&
    room.kind === kind &&
    room.declaredMemberSlots?.length === 2 &&
    room.outgoing?.submitOutcome?.state === "ack" &&
    room.outgoing?.commandLiveDelta?.delta?.kind === "ThreadPostsChanged" &&
    room.outgoing?.mediaBodyBytes > 0 &&
    room.incoming?.submitOutcome?.state === "ack" &&
    room.incoming?.initialLiveDelta?.delta?.kind === "ThreadPostsChanged" &&
    room.incoming?.commandLiveDelta?.delta?.kind === "ThreadPostsChanged" &&
    room.incoming?.reloadedPostBodies?.length === 2 &&
    room.incoming?.mediaBodyBytes > 0 &&
    room.encryptedStorage?.rawCheck === "2|0|2|0" &&
    room.staleOutgoing?.routeStatus === 403 &&
    room.staleOutgoing?.threadStatus === 403 &&
    room.staleOutgoing?.mediaStatus === 403 &&
    room.staleOutgoing?.mediaBodyBytes === 0 &&
    room.staleOutgoing?.postReject?.error === "NotYourSlot" &&
    room.outsider?.routeStatus === 403 &&
    room.outsider?.threadStatus === 403 &&
    room.outsider?.mediaStatus === 403 &&
    room.outsider?.mediaBodyBytes === 0 &&
    room.outsider?.postReject?.error === "NotAuthorized"
  );
}

function deadChatLifecyclePassed(room) {
  return (
    room?.status === "passed" &&
    room.channelId === "dead" &&
    room.derivedCapability === "DeadViewer(game)" &&
    room.preDeath?.outgoing?.routeStatus === 403 &&
    room.preDeath?.outgoing?.threadStatus === 403 &&
    room.preDeath?.outgoing?.postReject?.error === "NotAuthorized" &&
    room.preDeath?.living?.routeStatus === 403 &&
    room.death?.streamSeqs?.length > 0 &&
    room.outgoing?.submitOutcome?.state === "ack" &&
    room.outgoing?.commandLiveDelta?.delta?.kind === "ThreadPostsChanged" &&
    room.outgoing?.mediaBodyBytes > 0 &&
    room.incoming?.submitOutcome?.state === "ack" &&
    room.incoming?.initialLiveDelta?.delta?.kind === "ThreadPostsChanged" &&
    room.incoming?.commandLiveDelta?.delta?.kind === "ThreadPostsChanged" &&
    room.incoming?.reloadedPostBodies?.length === 2 &&
    room.incoming?.mediaBodyBytes > 0 &&
    room.encryptedStorage?.rawCheck === "2|0|2|0" &&
    room.staleOutgoing?.routeStatus === 403 &&
    room.staleOutgoing?.threadStatus === 403 &&
    room.staleOutgoing?.mediaStatus === 403 &&
    room.staleOutgoing?.mediaBodyBytes === 0 &&
    room.staleOutgoing?.postReject?.error === "NotYourSlot" &&
    room.living?.routeStatus === 403 &&
    room.living?.threadStatus === 403 &&
    room.living?.mediaStatus === 403 &&
    room.living?.mediaBodyBytes === 0 &&
    room.living?.postReject?.error === "NotAuthorized" &&
    room.restoration?.streamSeqs?.length > 0 &&
    room.restoredAlive?.routeStatus === 403 &&
    room.restoredAlive?.threadStatus === 403 &&
    room.restoredAlive?.mediaStatus === 403 &&
    room.restoredAlive?.mediaBodyBytes === 0 &&
    room.restoredAlive?.postReject?.error === "NotAuthorized"
  );
}

function isStalePlayerVoteRecoveryMessage(message) {
  const value = String(message ?? "");
  return (
    value.includes("stale projection") ||
    value.includes("stale vote state")
  );
}

export function buildLiveStackReadiness(evidence) {
  const checks = CHECKS.map((check) =>
    Object.freeze({
      id: check.id,
      label: check.label,
      status: check.predicate(evidence) ? "passed" : "failed",
    }),
  );
  const status = checks.every((check) => check.status === "passed")
    ? "passed"
    : "failed";

  return Object.freeze({
    version: LIVE_STACK_READINESS_VERSION,
    status,
    scope: "local-live-stack-harness",
    productionReady: false,
    proofBoundary:
      "Local scratch-Postgres plus local Rust API and SvelteKit browser proof. This is a development-spine readiness gate for seeded role URLs; it does not prove hosted deployment, production identity, backup/restore, multi-node operation, or beta release readiness.",
    checks,
  });
}

export function assertLiveStackReadiness(readiness) {
  if (readiness?.version !== LIVE_STACK_READINESS_VERSION) {
    throw new Error(`live-stack readiness version drifted: ${readiness?.version}`);
  }
  if (readiness.status !== "passed") {
    const failed = (readiness.checks ?? [])
      .filter((check) => check.status !== "passed")
      .map((check) => check.id)
      .join(", ");
    throw new Error(`live-stack readiness failed: ${failed}`);
  }
  if (readiness.productionReady !== false) {
    throw new Error("live-stack readiness must not claim production readiness");
  }
  return readiness;
}
