export const CORE_LOOP_HIGHLIGHTED_LANE_IDS = Object.freeze([
  "core-loop",
  "action-loop",
  "host-deadline-advance",
  "invalid-action-recovery",
  "resolution-receipts",
  "player-action-boundary",
  "private-channel",
  "stale-host-advance",
]);

export const HARDENING_HIGHLIGHTED_LANE_IDS = Object.freeze([
  "concurrent-action-race",
  "concurrent-action-race-reload",
  "reconnect-recovery",
  "stale-same-action-recovery",
  "stale-dead-action-conflict",
  "stale-action-conflict",
  "stale-action-conflict-message",
  "stale-action-reconnect-recovery",
  "stale-host-complete-reconnect-recovery",
  "stale-host-control",
  "concurrent-host-resolve-race",
  "concurrent-host-resolve-race-reload",
  "stale-host-resolve",
  "stale-host-resolve-reload",
  "stale-host-resolve-reconnect-recovery",
  "stale-host-advance",
  "stale-host-advance-reconnect-recovery",
  "stale-host-deadline",
  "stale-host-deadline-reconnect-recovery",
  "stale-cohost-deadline",
  "stale-cohost-deadline-reconnect-recovery",
]);

export function coreLoopHighlightedLaneEvidence(proofRun) {
  return highlightedLaneEvidence({
    proofRun,
    laneIds: CORE_LOOP_HIGHLIGHTED_LANE_IDS,
    formatter: coreLoopLaneStatus,
  });
}

export function coreLoopSpineStatus(proofRun) {
  const spine = proofRun?.coreLoopSpine;
  const status = String(spine?.status ?? "unknown");
  const firstCycle = spine?.cycles?.find((cycle) => cycle.id === "d01-n01-d02");
  const secondCycle = spine?.cycles?.find((cycle) => cycle.id === "d02-n02");
  const firstStart = checkpointById(firstCycle, "d01-resolved-locked");
  const firstNight = checkpointById(firstCycle, "n01-action-open");
  const firstDay = checkpointById(firstCycle, "d02-day-controls-return");
  const secondVote = checkpointById(secondCycle, "d02-deciding-vote-submitted");
  const secondNight = checkpointById(secondCycle, "n02-action-open");
  return `${status}: ${String(firstStart?.phase ?? "unknown")} -> ${String(firstNight?.phase ?? "unknown")} -> ${String(firstDay?.phase ?? "unknown")}, vote ${String(secondVote?.voteState ?? "unknown")}, next ${String(secondNight?.phase ?? "unknown")}`;
}

export function hardeningHighlightedLaneEvidence(proofRun) {
  return highlightedLaneEvidence({
    proofRun,
    laneIds: HARDENING_HIGHLIGHTED_LANE_IDS,
    formatter: hardeningLaneStatus,
  });
}

export function coreLoopLaneStatus(lane) {
  const status = laneStatus(lane);
  const evidence = laneEvidence(lane);
  switch (lane?.id) {
    case "core-loop":
      return `${status}: ${String(evidence.rejectedVoteError ?? "unknown")} vote receipt, unchanged ${String(evidence.staleVoteVotecountUnchanged ?? "unknown")}, lock ${String(evidence.lockState ?? "unknown")}/unlock ${String(evidence.unlockState ?? "unknown")}`;
    case "action-loop":
      return `${status}: role URL ${typeof evidence.actionRoleUrl === "string"}, night ${String(evidence.nightPhase ?? "unknown")}, receipt ${String(evidence.targetReceiptStatus ?? "unknown")}, D02 ${String(evidence.d02VoteOutcomeStatus ?? "unknown")}, next ${String(evidence.nextNightPhase ?? "unknown")}`;
    case "host-deadline-advance":
      return `${status}: ${String(evidence.commandPhase ?? "unknown")} deadline -> ${String(evidence.browserPhaseAfter ?? "unknown")}`;
    case "invalid-action-recovery":
      return `${status}: Reject ${String(evidence.rejectError ?? "unknown")}, legal action visible ${String(evidence.legalActionVisible ?? "unknown")}`;
    case "player-action-boundary":
      return `${status}: ${Number(evidence.commandActionCount ?? 0)} unowned actions, direct reject ${String(evidence.directRejectError ?? "unknown")}`;
    case "private-channel":
      return `${status}: ${String(evidence.channel ?? "unknown")}, denied ${String(evidence.deniedStatus ?? "unknown")}`;
    case "resolution-receipts":
      return `${status}: ${String(evidence.targetNoticeStatus ?? "unknown")} receipt, target ${String(evidence.targetSlot ?? "unknown")}`;
    case "stale-host-advance":
      return `${status}: Reject ${String(evidence.rejectError ?? "unknown")}, role URL ${typeof evidence.roleUrl === "string"}, locked ${String(evidence.locked ?? "unknown")}`;
    default:
      return status;
  }
}

export function hardeningLaneStatus(lane) {
  const status = laneStatus(lane);
  const evidence = laneEvidence(lane);
  switch (lane?.id) {
    case "concurrent-action-race":
      return `${status}: ${String(evidence.ackState ?? "unknown")} action, reject ${String(evidence.rejectError ?? "unknown")}`;
    case "concurrent-action-race-reload":
      return `${status}: target ${String(evidence.targetSlot ?? "unknown")}, alive ${String(evidence.apiTargetAlive ?? "unknown")}`;
    case "reconnect-recovery":
      return `${status}: ${String(evidence.reconnectingState ?? "unknown")} -> ${String(evidence.recoveryState ?? "unknown")}`;
    case "stale-same-action-recovery":
      return `${status}: Reject ${String(evidence.rejectError ?? "unknown")}, role URL ${typeof evidence.roleUrl === "string"}, visible ${String(evidence.actionVisibleAfterRefresh ?? "unknown")}`;
    case "stale-dead-action-conflict":
      return `${status}: Reject ${String(evidence.rejectError ?? "unknown")}, role URL ${typeof evidence.roleUrl === "string"}, actor ${String(evidence.actorStatusAfterReject ?? "unknown")}`;
    case "stale-action-conflict":
      return `${status}: Reject ${String(evidence.rejectError ?? "unknown")}, role URL ${typeof evidence.roleUrl === "string"}, refreshed ${String(evidence.refreshedPhase ?? "unknown")}`;
    case "stale-action-conflict-message":
      return `${status}: role URL ${typeof evidence.roleUrl === "string"}, ${String(evidence.receiptStatusText ?? evidence.rejectMessage ?? "unknown")}`;
    case "stale-action-reconnect-recovery":
      return `${status}: role URL ${typeof evidence.roleUrl === "string"}, ${String(evidence.reconnectingState ?? "unknown")} -> ${String(evidence.recoveryState ?? "unknown")}, phase ${String(evidence.recoveredPhase ?? "unknown")}`;
    case "stale-host-complete-reconnect-recovery":
      return `${status}: ${String(evidence.reconnectingState ?? "unknown")} -> ${String(evidence.recoveryState ?? "unknown")}, completed ${String(evidence.recoveredCompleted ?? "unknown")}`;
    case "stale-host-control":
      return `${status}: Reject ${String(evidence.rejectError ?? "unknown")}, current ${String(evidence.phaseId ?? "unknown")}`;
    case "concurrent-host-resolve-race":
      return `${status}: ${String(evidence.ackState ?? "unknown")} resolve, reject ${String(evidence.rejectError ?? "unknown")}`;
    case "concurrent-host-resolve-race-reload":
      return `${status}: locked ${String(evidence.apiLocked ?? "unknown")}, routes ${String(evidence.liveRouteStatus ?? "unknown")}/${String(evidence.concurrentRouteStatus ?? "unknown")}`;
    case "stale-host-resolve":
      return `${status}: Reject ${String(evidence.rejectError ?? "unknown")}, role URL ${typeof evidence.roleUrl === "string"}, locked ${String(evidence.locked ?? "unknown")}`;
    case "stale-host-resolve-reload":
      return `${status}: ${String(evidence.rejectReceipt ?? "unknown")}`;
    case "stale-host-resolve-reconnect-recovery":
      return `${status}: ${String(evidence.reconnectingState ?? "unknown")} -> ${String(evidence.recoveryState ?? "unknown")}, locked ${String(evidence.recoveredLocked ?? "unknown")}`;
    case "stale-host-advance":
      return `${status}: Reject ${String(evidence.rejectError ?? "unknown")}, role URL ${typeof evidence.roleUrl === "string"}, locked ${String(evidence.locked ?? "unknown")}`;
    case "stale-host-advance-reconnect-recovery":
      return `${status}: ${String(evidence.reconnectingState ?? "unknown")} -> ${String(evidence.recoveryState ?? "unknown")}, locked ${String(evidence.recoveredLocked ?? "unknown")}`;
    case "stale-host-deadline":
      return `${status}: Reject ${String(evidence.rejectError ?? "unknown")}, role URL ${typeof evidence.roleUrl === "string"}, deadline ${evidence.apiDeadline === undefined ? "unknown" : String(evidence.apiDeadline)}`;
    case "stale-host-deadline-reconnect-recovery":
      return `${status}: ${String(evidence.reconnectingState ?? "unknown")} -> ${String(evidence.recoveryState ?? "unknown")}, deadline ${evidence.apiDeadline === undefined ? "unknown" : String(evidence.apiDeadline)}`;
    case "stale-cohost-deadline":
      return `${status}: Reject ${String(evidence.rejectError ?? "unknown")}, role URL ${typeof evidence.roleUrl === "string"}, phase controls ${Array.isArray(evidence.phaseActions) ? evidence.phaseActions.length : "unknown"}`;
    case "stale-cohost-deadline-reconnect-recovery":
      return `${status}: ${String(evidence.reconnectingState ?? "unknown")} -> ${String(evidence.recoveryState ?? "unknown")}, deadline ${evidence.apiDeadline === undefined ? "unknown" : String(evidence.apiDeadline)}, phase controls ${Array.isArray(evidence.phaseActions) ? evidence.phaseActions.length : "unknown"}`;
    default:
      return status;
  }
}

function highlightedLaneEvidence({ proofRun, laneIds, formatter }) {
  const lanes = new Map((proofRun?.lanes ?? []).map((lane) => [lane.id, lane]));
  return Object.fromEntries(laneIds.map((id) => [id, formatter(lanes.get(id))]));
}

function laneStatus(lane) {
  return String(lane?.status ?? "unknown");
}

function laneEvidence(lane) {
  return lane?.evidence !== null && typeof lane?.evidence === "object"
    ? lane.evidence
    : {};
}

function checkpointById(cycle, id) {
  return cycle?.checkpoints?.find((checkpoint) => checkpoint.id === id) ?? null;
}
