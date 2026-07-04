import {
  completedGameSeedRequiredScenarioIds,
} from "../../../../tools/dev_test_game_core_loop_completed_scenarios.mjs";
import {
  cohostStaleDeadlineControlLaneId,
  coreLoopHostStaleCommandHighlightedLaneIds,
  hardeningHostStaleCommandHighlightedLaneIds,
  hostStaleAdvanceControlLaneId,
  hostStaleAdvanceReloadLaneId,
  hostStaleDeadlineControlLaneId,
  hostStaleResolveControlLaneId,
  hostStaleResolveReloadLaneId,
} from "../../../../tools/dev_test_game_host_stale_control_scenarios.mjs";
import {
  cohostStaleDeadlineReconnectLaneId,
  hardeningRecoveryHighlightedLaneIds,
  staleActionConflictMessageLaneId,
  staleDeadActionConflictLaneId,
  hostStaleAdvanceReconnectLaneId,
  hostStaleDeadlineReconnectLaneId,
  hostStaleResolveReconnectLaneId,
  privateChannelStaleActionReconnectLaneId,
  stalePlayerActionReconnectLaneId,
} from "../../../../tools/dev_test_game_hardening_recovery_scenarios.mjs";
import {
  concurrentActionRaceLaneId,
  concurrentActionRaceReloadLaneId,
  hardeningPlayerRecoveryHighlightedLaneIds,
  staleActionConflictLaneId,
  staleSameActionRecoveryLaneId,
} from "../../../../tools/dev_test_game_player_recovery_scenarios.mjs";
import {
  playerActionBoundaryLaneId,
  playerActionLoopLaneId,
  playerInvalidActionRecoveryLaneId,
} from "../../../../tools/dev_test_game_core_loop_action_scenarios.mjs";
import {
  revoteProgressionCompactStatus,
} from "../../../../tools/dev_test_game_core_loop_revote_progression_scenarios.mjs";
import {
  terminalRecoveryCompactStatus,
} from "../../../../tools/dev_test_game_core_loop_terminal_recovery_scenarios.mjs";
import {
  nightTwoProgressionCompactStatus,
} from "../../../../tools/dev_test_game_core_loop_night_two_progression_scenarios.mjs";

const CORE_LOOP_FOUNDATION_HIGHLIGHTED_LANE_IDS = Object.freeze([
  "core-loop",
  playerActionLoopLaneId,
  "host-deadline-advance",
  playerInvalidActionRecoveryLaneId,
  "resolution-receipts",
  playerActionBoundaryLaneId,
  "private-channel",
]);

export const CORE_LOOP_COMPLETED_GAME_HIGHLIGHTED_LANE_IDS = Object.freeze([
  ...completedGameSeedRequiredScenarioIds(),
]);

export const CORE_LOOP_HIGHLIGHTED_LANE_IDS = Object.freeze([
  ...CORE_LOOP_FOUNDATION_HIGHLIGHTED_LANE_IDS,
  ...CORE_LOOP_COMPLETED_GAME_HIGHLIGHTED_LANE_IDS,
  ...coreLoopHostStaleCommandHighlightedLaneIds,
]);

export const HARDENING_HIGHLIGHTED_LANE_IDS = Object.freeze([
  ...hardeningPlayerRecoveryHighlightedLaneIds,
  ...hardeningRecoveryHighlightedLaneIds,
  "stale-host-control",
  "concurrent-host-resolve-race",
  "concurrent-host-resolve-race-reload",
  ...hardeningHostStaleCommandHighlightedLaneIds,
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
  const thirdCycle = spine?.cycles?.find((cycle) => cycle.id === "n02-d03");
  const firstStart = checkpointById(firstCycle, "d01-resolved-locked");
  const firstNight = checkpointById(firstCycle, "n01-action-open");
  const firstDay = checkpointById(firstCycle, "d02-day-controls-return");
  const secondVote = checkpointById(secondCycle, "d02-deciding-vote-submitted");
  const secondNight = checkpointById(secondCycle, "n02-action-open");
  return `${status}: ${String(firstStart?.phase ?? "unknown")} -> ${String(firstNight?.phase ?? "unknown")} -> ${String(firstDay?.phase ?? "unknown")}, vote ${String(secondVote?.voteState ?? "unknown")}, ${nightTwoProgressionCompactStatus(thirdCycle, { actionPhase: secondNight?.phase })}, ${terminalRecoveryCompactStatus(thirdCycle)}, ${revoteProgressionCompactStatus(thirdCycle)}`;
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
    case playerActionLoopLaneId:
      return `${status}: role URL ${typeof evidence.actionRoleUrl === "string"}, night ${String(evidence.nightPhase ?? "unknown")}, receipt ${String(evidence.targetReceiptStatus ?? "unknown")}, D02 ${String(evidence.d02VoteOutcomeStatus ?? "unknown")}, next ${String(evidence.nextNightPhase ?? "unknown")}`;
    case "host-deadline-advance":
      return `${status}: ${String(evidence.commandPhase ?? "unknown")} deadline -> ${String(evidence.browserPhaseAfter ?? "unknown")}`;
    case playerInvalidActionRecoveryLaneId:
      return `${status}: Reject ${String(evidence.rejectError ?? "unknown")}, legal action visible ${String(evidence.legalActionVisible ?? "unknown")}`;
    case playerActionBoundaryLaneId:
      return `${status}: ${Number(evidence.commandActionCount ?? 0)} unowned actions, direct reject ${String(evidence.directRejectError ?? "unknown")}`;
    case "private-channel":
      return `${status}: ${String(evidence.channel ?? "unknown")}, denied ${String(evidence.deniedStatus ?? "unknown")}`;
    case "resolution-receipts":
      return `${status}: ${String(evidence.targetNoticeStatus ?? "unknown")} receipt, target ${String(evidence.targetSlot ?? "unknown")}`;
    case "stale-host-complete-reload":
      return `${status}: ${String(evidence.rejectReceipt ?? "unknown")}, revealed ${String(evidence.revealedSlots ?? "unknown")}, complete visible ${String(evidence.completeActionVisible ?? "unknown")}`;
    case "stale-host-complete-reconnect-recovery":
      return `${status}: ${String(evidence.reconnectingState ?? "unknown")} -> ${String(evidence.recoveryState ?? "unknown")}, completed ${String(evidence.recoveredCompleted ?? "unknown")}, revealed ${String(evidence.revealedSlots ?? "unknown")}`;
    case "concurrent-host-complete-race":
      return `${status}: reject ${String(evidence.rejectError ?? "unknown")}, completed ${String(evidence.apiCompleted ?? "unknown")}, revealed ${String(evidence.apiRevealedSlots ?? "unknown")}`;
    case "concurrent-host-complete-race-reload":
      return `${status}: completed ${String(evidence.apiCompleted ?? "unknown")}, revealed ${String(evidence.firstRevealedSlots ?? "unknown")}/${String(evidence.secondRevealedSlots ?? "unknown")}`;
    case "concurrent-player-complete-race":
      return `${status}: post ${String(evidence.postError ?? "unknown")}, completed ${String(evidence.apiCompleted ?? "unknown")}, thread post ${String(evidence.apiThreadHasPost ?? "unknown")}`;
    case "public-player-complete-reload":
      return `${status}: completed ${String(evidence.gameCompleted ?? "unknown")}, posts ${String(evidence.reloadPostCount ?? "unknown")}`;
    case "stale-player-complete-reload":
      return `${status}: completed ${String(evidence.gameCompleted ?? "unknown")}, vote ${String(evidence.currentVote ?? "unknown")}, posts ${String(evidence.threadPostCount ?? "unknown")}`;
    case hostStaleResolveControlLaneId:
      return `${status}: Reject ${String(evidence.rejectError ?? "unknown")}, role URL ${typeof evidence.roleUrl === "string"}, locked ${String(evidence.locked ?? "unknown")}`;
    case hostStaleResolveReloadLaneId:
      return `${status}: ${String(evidence.rejectReceipt ?? "unknown")}, locked ${String(evidence.locked ?? "unknown")}`;
    case hostStaleAdvanceControlLaneId:
      return `${status}: Reject ${String(evidence.rejectError ?? "unknown")}, role URL ${typeof evidence.roleUrl === "string"}, locked ${String(evidence.locked ?? "unknown")}`;
    case hostStaleAdvanceReloadLaneId:
      return `${status}: ${String(evidence.rejectReceipt ?? "unknown")}, locked ${String(evidence.locked ?? "unknown")}`;
    default:
      return status;
  }
}

export function hardeningLaneStatus(lane) {
  const status = laneStatus(lane);
  const evidence = laneEvidence(lane);
  switch (lane?.id) {
    case concurrentActionRaceLaneId:
      return `${status}: ${String(evidence.ackState ?? "unknown")} action, reject ${String(evidence.rejectError ?? "unknown")}`;
    case concurrentActionRaceReloadLaneId:
      return `${status}: target ${String(evidence.targetSlot ?? "unknown")}, alive ${String(evidence.apiTargetAlive ?? "unknown")}`;
    case "reconnect-recovery":
      return `${status}: ${String(evidence.reconnectingState ?? "unknown")} -> ${String(evidence.recoveryState ?? "unknown")}`;
    case staleSameActionRecoveryLaneId:
      return `${status}: Reject ${String(evidence.rejectError ?? "unknown")}, role URL ${typeof evidence.roleUrl === "string"}, visible ${String(evidence.actionVisibleAfterRefresh ?? "unknown")}`;
    case staleDeadActionConflictLaneId:
      return `${status}: Reject ${String(evidence.rejectError ?? "unknown")}, role URL ${typeof evidence.roleUrl === "string"}, actor ${String(evidence.actorStatusAfterReject ?? "unknown")}`;
    case staleActionConflictLaneId:
      return `${status}: Reject ${String(evidence.rejectError ?? "unknown")}, role URL ${typeof evidence.roleUrl === "string"}, refreshed ${String(evidence.refreshedPhase ?? "unknown")}`;
    case staleActionConflictMessageLaneId:
      return `${status}: role URL ${typeof evidence.roleUrl === "string"}, ${String(evidence.receiptStatusText ?? evidence.rejectMessage ?? "unknown")}`;
    case stalePlayerActionReconnectLaneId:
      return `${status}: role URL ${typeof evidence.roleUrl === "string"}, ${String(evidence.reconnectingState ?? "unknown")} -> ${String(evidence.recoveryState ?? "unknown")}, phase ${String(evidence.recoveredPhase ?? "unknown")}`;
    case privateChannelStaleActionReconnectLaneId:
      return `${status}: role URL ${typeof evidence.roleUrl === "string"}, channel ${String(evidence.channelAfterReject ?? evidence.channel ?? "unknown")}, reject ${String(evidence.rejectError ?? "unknown")}, recovered ${String(evidence.reconnectChannel ?? "unknown")} ${String(evidence.recoveredPhase ?? "unknown")}`;
    case "stale-host-complete-reconnect-recovery":
      return `${status}: ${String(evidence.reconnectingState ?? "unknown")} -> ${String(evidence.recoveryState ?? "unknown")}, completed ${String(evidence.recoveredCompleted ?? "unknown")}`;
    case "stale-host-control":
      return `${status}: Reject ${String(evidence.rejectError ?? "unknown")}, current ${String(evidence.phaseId ?? "unknown")}`;
    case "concurrent-host-resolve-race":
      return `${status}: ${String(evidence.ackState ?? "unknown")} resolve, reject ${String(evidence.rejectError ?? "unknown")}`;
    case "concurrent-host-resolve-race-reload":
      return `${status}: locked ${String(evidence.apiLocked ?? "unknown")}, routes ${String(evidence.liveRouteStatus ?? "unknown")}/${String(evidence.concurrentRouteStatus ?? "unknown")}`;
    case hostStaleResolveControlLaneId:
      return `${status}: Reject ${String(evidence.rejectError ?? "unknown")}, role URL ${typeof evidence.roleUrl === "string"}, locked ${String(evidence.locked ?? "unknown")}`;
    case hostStaleResolveReloadLaneId:
      return `${status}: ${String(evidence.rejectReceipt ?? "unknown")}`;
    case hostStaleResolveReconnectLaneId:
      return `${status}: ${String(evidence.reconnectingState ?? "unknown")} -> ${String(evidence.recoveryState ?? "unknown")}, locked ${String(evidence.recoveredLocked ?? "unknown")}`;
    case hostStaleAdvanceControlLaneId:
      return `${status}: Reject ${String(evidence.rejectError ?? "unknown")}, role URL ${typeof evidence.roleUrl === "string"}, locked ${String(evidence.locked ?? "unknown")}`;
    case hostStaleAdvanceReconnectLaneId:
      return `${status}: ${String(evidence.reconnectingState ?? "unknown")} -> ${String(evidence.recoveryState ?? "unknown")}, locked ${String(evidence.recoveredLocked ?? "unknown")}`;
    case hostStaleDeadlineControlLaneId:
      return `${status}: Reject ${String(evidence.rejectError ?? "unknown")}, role URL ${typeof evidence.roleUrl === "string"}, deadline ${evidence.apiDeadline === undefined ? "unknown" : String(evidence.apiDeadline)}`;
    case hostStaleDeadlineReconnectLaneId:
      return `${status}: ${String(evidence.reconnectingState ?? "unknown")} -> ${String(evidence.recoveryState ?? "unknown")}, deadline ${evidence.apiDeadline === undefined ? "unknown" : String(evidence.apiDeadline)}`;
    case cohostStaleDeadlineControlLaneId:
      return `${status}: Reject ${String(evidence.rejectError ?? "unknown")}, role URL ${typeof evidence.roleUrl === "string"}, phase controls ${Array.isArray(evidence.phaseActions) ? evidence.phaseActions.length : "unknown"}`;
    case cohostStaleDeadlineReconnectLaneId:
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
