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
      evidence?.browser?.player?.concurrentVoteRace?.rows?.includes("slot-7"),
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
      evidence?.browser?.player?.staleVoteRecovery?.recovery?.statusMessage?.includes(
        "stale projection",
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
      evidence?.browser?.moderator?.stalePlayerInviteReject?.state === "reject" &&
      evidence?.browser?.moderator?.stalePlayerInviteReject?.message?.includes(
        "Invite target is stale",
      ) &&
      evidence?.slotLifecycleApiState?.slots?.some(
        (slot) => slot.slot_id === "slot-7" && slot.alive === false,
      ),
  },
]);

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
