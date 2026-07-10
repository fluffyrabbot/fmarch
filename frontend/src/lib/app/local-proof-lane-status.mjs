import {
  completedGameHardeningLaneCases,
  completedGameSeedRequiredScenarioIds,
} from "../../../../tools/dev_test_game_core_loop_completed_scenarios.mjs";
import {
  cohostStaleDeadlineReconnectLaneId,
  cohostStaleDeadlineControlLaneId,
  coreLoopHostStaleCommandHighlightedLaneIds,
  hardeningHostStaleCommandHighlightedLaneIds,
  hostStaleAdvanceReconnectLaneId,
  hostStaleAdvanceControlLaneId,
  hostStaleAdvanceReloadLaneId,
  hostStaleDeadlineReconnectLaneId,
  hostStaleDeadlineControlLaneId,
  hostStaleResolveReconnectLaneId,
  hostStaleResolveControlLaneId,
  hostStaleResolveReloadLaneId,
} from "../../../../tools/dev_test_game_host_stale_recovery_scenarios.mjs";
import {
  hardeningRecoveryHighlightedLaneIds,
  playerLiveLagResyncLaneId,
  privateChannelStaleActionConflictMessageLaneId,
  staleActionConflictMessageLaneId,
  staleDeadActionConflictLaneId,
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
  coreLoopPrivateChannelCompletedPostLaneId,
  coreLoopPrivateChannelInvalidActionLaneId,
  coreLoopPrivateChannelStalePostLaneId,
  privateChannelInvalidActionRecoveryScenario,
  staleCompletedPrivatePostScenario,
} from "../../../../tools/dev_test_game_core_loop_private_channel_recovery_scenarios.mjs";
import {
  revoteProgressionCompactStatus,
} from "../../../../tools/dev_test_game_core_loop_revote_progression_scenarios.mjs";
import {
  terminalRecoveryCompactStatus,
} from "../../../../tools/dev_test_game_core_loop_terminal_recovery_scenarios.mjs";
import {
  nightTwoProgressionCompactStatus,
} from "../../../../tools/dev_test_game_core_loop_night_two_progression_scenarios.mjs";
import {
  nightThreeProgressionCompactStatus,
} from "../../../../tools/dev_test_game_core_loop_night_three_progression_scenarios.mjs";

const CORE_LOOP_FOUNDATION_HIGHLIGHTED_LANE_IDS = Object.freeze([
  "core-loop",
  playerActionLoopLaneId,
  "host-deadline-advance",
  playerInvalidActionRecoveryLaneId,
  "resolution-receipts",
  playerActionBoundaryLaneId,
  "private-channel",
  coreLoopPrivateChannelStalePostLaneId,
  coreLoopPrivateChannelCompletedPostLaneId,
  coreLoopPrivateChannelInvalidActionLaneId,
]);

const COMPLETED_GAME_HARDENING_LANE_CASES_BY_ID = new Map(
  completedGameHardeningLaneCases().map((scenario) => [scenario.id, scenario]),
);

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
  const fourthCycle =
    spine?.cycles?.find((cycle) => cycle.id === "d03-n03") ?? thirdCycle;
  const fifthCycle = spine?.cycles?.find((cycle) => cycle.id === "n03-d04");
  const sixthCycle = spine?.cycles?.find((cycle) => cycle.id === "d04-n04-d05");
  const seventhCycle = spine?.cycles?.find((cycle) => cycle.id === "d05-n05");
  const firstStart = checkpointById(firstCycle, "d01-resolved-locked");
  const firstNight = checkpointById(firstCycle, "n01-action-open");
  const firstDay = checkpointById(firstCycle, "d02-day-controls-return");
  const secondVote = checkpointById(secondCycle, "d02-deciding-vote-submitted");
  const secondNight = checkpointById(secondCycle, "n02-action-open");
  const baseStatus = `${status}: ${String(firstStart?.phase ?? "unknown")} -> ${String(firstNight?.phase ?? "unknown")} -> ${String(firstDay?.phase ?? "unknown")}, vote ${String(secondVote?.voteState ?? "unknown")}, ${nightTwoProgressionCompactStatus(thirdCycle, { actionPhase: secondNight?.phase })}, ${terminalRecoveryCompactStatus(fourthCycle)}, ${revoteProgressionCompactStatus(fourthCycle)}`;
  if (fifthCycle === undefined) {
    return baseStatus;
  }
  const nightThreeStatus = `${baseStatus}, ${nightThreeProgressionCompactStatus(fifthCycle)}`;
  if (sixthCycle === undefined || seventhCycle === undefined) {
    return nightThreeStatus;
  }
  const d04Vote = checkpointById(sixthCycle, "d04-no-lynch-vote-submitted");
  const n04NoAction = checkpointById(sixthCycle, "n04-no-action-open");
  const d05Return = checkpointById(sixthCycle, "d05-day-controls-return");
  const d05Vote = checkpointById(seventhCycle, "d05-no-lynch-vote-submitted");
  const n05Return = checkpointById(seventhCycle, "n05-night-controls-return");
  return `${nightThreeStatus}, D04 ${String(d04Vote?.voteState ?? "unknown")} -> N04 actions ${String(n04NoAction?.actionCount ?? "unknown")} -> ${String(d05Return?.phase ?? "unknown")}, D05 ${String(d05Vote?.voteState ?? "unknown")} -> ${String(n05Return?.phase ?? "unknown")}`;
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
  const completedGameStatus = completedGameCoreLoopLaneStatus({
    lane,
    status,
    evidence,
  });
  if (completedGameStatus !== null) {
    return completedGameStatus;
  }
  switch (lane?.id) {
    case "core-loop":
      return `${status}: ${String(evidence.rejectedVoteError ?? "unknown")} vote receipt, unchanged ${String(evidence.staleVoteVotecountUnchanged ?? "unknown")}, lock ${String(evidence.lockState ?? "unknown")}/unlock ${String(evidence.unlockState ?? "unknown")}`;
    case playerActionLoopLaneId:
      return `${status}: role URL ${typeof evidence.actionRoleUrl === "string"}, night ${String(evidence.nightPhase ?? "unknown")}, receipt ${String(evidence.targetReceiptStatus ?? "unknown")}, D02 ${String(evidence.d02VoteOutcomeStatus ?? "unknown")}, next ${String(evidence.nextNightPhase ?? "unknown")}`;
    case "host-deadline-advance":
      return `${status}: ${String(evidence.commandPhase ?? "unknown")} deadline -> ${String(evidence.browserPhaseAfter ?? "unknown")}`;
    case playerInvalidActionRecoveryLaneId:
      return `${status}: ${String(evidence.receiptStatusText ?? `Reject ${String(evidence.rejectError ?? "unknown")}`)}, legal action visible ${String(evidence.legalActionVisible ?? "unknown")}`;
    case playerActionBoundaryLaneId:
      return `${status}: ${Number(evidence.commandActionCount ?? 0)} unowned actions, direct reject ${String(evidence.directRejectError ?? "unknown")}`;
    case "private-channel":
      return `${status}: ${String(evidence.channel ?? "unknown")}, denied ${String(evidence.deniedStatus ?? "unknown")}`;
    case coreLoopPrivateChannelStalePostLaneId:
      return `${status}: channel ${String(evidence.channel ?? "unknown")}, ${String(evidence.receiptStatusText ?? "unknown receipt")}, locked ${String(evidence.refreshedLocked ?? "unknown")}`;
    case coreLoopPrivateChannelCompletedPostLaneId: {
      const scenario = staleCompletedPrivatePostScenario();
      return `${status}: channel ${String(evidence.channel ?? "unknown")}, ${String(evidence.receiptStatusText ?? scenario.commandMessage)}, completed ${String(evidence.gameCompleted ?? "unknown")}, thread post ${String(evidence.threadPostPresent ?? "unknown")}, reload closed ${String(evidence.reloadControlsDisabled ?? "unknown")}`;
    }
    case coreLoopPrivateChannelInvalidActionLaneId: {
      const scenario = privateChannelInvalidActionRecoveryScenario();
      return `${status}: channel ${String(evidence.channel ?? "unknown")}, ${String(evidence.receiptStatusText ?? `Reject ${String(evidence.error ?? scenario.commandError)}`)}, scope ${String(evidence.channelContextPreserved ?? "unknown")}, refresh commandState ${String(evidence.refreshCommandState ?? "unknown")}, legal action visible ${String(evidence.legalActionVisible ?? "unknown")}`;
    }
    case "resolution-receipts":
      return `${status}: ${String(evidence.targetNoticeStatus ?? "unknown")} receipt, target ${String(evidence.targetSlot ?? "unknown")}`;
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
  const completedGameStatus = completedGameHardeningLaneStatus({
    lane,
    status,
    evidence,
  });
  if (completedGameStatus !== null) {
    return completedGameStatus;
  }
  switch (lane?.id) {
    case concurrentActionRaceLaneId:
      return `${status}: ${String(evidence.ackState ?? "unknown")} action, reject ${String(evidence.rejectError ?? "unknown")}`;
    case concurrentActionRaceReloadLaneId:
      return `${status}: target ${String(evidence.targetSlot ?? "unknown")}, alive ${String(evidence.apiTargetAlive ?? "unknown")}`;
    case "reconnect-recovery":
      return `${status}: ${String(evidence.reconnectingState ?? "unknown")} -> ${String(evidence.recoveryState ?? "unknown")}`;
    case playerLiveLagResyncLaneId:
      return `${status}: frames ${String(evidence.clientMetrics?.resyncFramesReceived ?? "unknown")}, refreshes ${String(evidence.clientMetrics?.resyncRefreshesStarted ?? "unknown")}, coalesced ${String(evidence.clientMetrics?.resyncFramesCoalesced ?? "unknown")}, trailing ${String(evidence.clientMetrics?.resyncTrailingRefreshesStarted ?? "unknown")}, reconnects ${String(evidence.reconnectEventCount ?? "unknown")}`;
    case staleSameActionRecoveryLaneId:
      return `${status}: Reject ${String(evidence.rejectError ?? "unknown")}, role URL ${typeof evidence.roleUrl === "string"}, visible ${String(evidence.actionVisibleAfterRefresh ?? "unknown")}`;
    case staleDeadActionConflictLaneId:
      return `${status}: Reject ${String(evidence.rejectError ?? "unknown")}, role URL ${typeof evidence.roleUrl === "string"}, actor ${String(evidence.actorStatusAfterReject ?? "unknown")}`;
    case staleActionConflictLaneId:
      return `${status}: Reject ${String(evidence.rejectError ?? "unknown")}, role URL ${typeof evidence.roleUrl === "string"}, refreshed ${String(evidence.refreshedPhase ?? "unknown")}`;
    case staleActionConflictMessageLaneId:
      return `${status}: role URL ${typeof evidence.roleUrl === "string"}, ${String(evidence.receiptStatusText ?? evidence.rejectMessage ?? "unknown")}`;
    case privateChannelStaleActionConflictMessageLaneId:
      return `${status}: role URL ${typeof evidence.roleUrl === "string"}, channel ${String(evidence.channelAfterReject ?? evidence.channel ?? "unknown")}, ${String(evidence.receiptStatusText ?? evidence.rejectMessage ?? "unknown")}`;
    case stalePlayerActionReconnectLaneId:
      return `${status}: role URL ${typeof evidence.roleUrl === "string"}, ${String(evidence.reconnectingState ?? "unknown")} -> ${String(evidence.recoveryState ?? "unknown")}, phase ${String(evidence.recoveredPhase ?? "unknown")}`;
    case privateChannelStaleActionReconnectLaneId:
      return `${status}: role URL ${typeof evidence.roleUrl === "string"}, channel ${String(evidence.channelAfterReject ?? evidence.channel ?? "unknown")}, reject ${String(evidence.rejectError ?? "unknown")}, recovered ${String(evidence.reconnectChannel ?? "unknown")} ${String(evidence.recoveredPhase ?? "unknown")}`;
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

function completedGameCoreLoopLaneStatus({ lane, status, evidence }) {
  const scenario = completedGameLaneCaseFor(lane?.id);
  if (scenario === null) {
    return null;
  }
  switch (completedGameLaneKey(scenario)) {
    case "stale-host-complete:reload":
      return `${status}: ${String(evidence.rejectReceipt ?? "unknown")}, revealed ${String(evidence.revealedSlots ?? "unknown")}, complete visible ${String(evidence.completeActionVisible ?? "unknown")}`;
    case "stale-host-complete:reconnect":
      return `${status}: ${String(evidence.reconnectingState ?? "unknown")} -> ${String(evidence.recoveryState ?? "unknown")}, completed ${String(evidence.recoveredCompleted ?? "unknown")}, revealed ${String(evidence.revealedSlots ?? "unknown")}`;
    case "host-complete-race:race":
      return `${status}: reject ${String(evidence.rejectError ?? "unknown")}, completed ${String(evidence.apiCompleted ?? "unknown")}, revealed ${String(evidence.apiRevealedSlots ?? "unknown")}`;
    case "host-complete-race:reload":
      return `${status}: completed ${String(evidence.apiCompleted ?? "unknown")}, revealed ${String(evidence.firstRevealedSlots ?? "unknown")}/${String(evidence.secondRevealedSlots ?? "unknown")}`;
    case "player-complete-race:race":
      return `${status}: post ${String(evidence.postError ?? "unknown")}, completed ${String(evidence.apiCompleted ?? "unknown")}, thread post ${String(evidence.apiThreadHasPost ?? "unknown")}`;
    case "player-complete-race:reload":
      return `${status}: completed ${String(evidence.gameCompleted ?? "unknown")}, posts ${String(evidence.reloadPostCount ?? "unknown")}`;
    case "stale-player-complete:reload":
      return `${status}: completed ${String(evidence.gameCompleted ?? "unknown")}, vote ${String(evidence.currentVote ?? "unknown")}, posts ${String(evidence.threadPostCount ?? "unknown")}`;
    default:
      return null;
  }
}

function completedGameHardeningLaneStatus({ lane, status, evidence }) {
  const scenario = completedGameLaneCaseFor(lane?.id);
  if (scenario === null) {
    return null;
  }
  switch (completedGameLaneKey(scenario)) {
    case "stale-host-complete:reconnect":
      return `${status}: ${String(evidence.reconnectingState ?? "unknown")} -> ${String(evidence.recoveryState ?? "unknown")}, completed ${String(evidence.recoveredCompleted ?? "unknown")}`;
    default:
      return null;
  }
}

function completedGameLaneCaseFor(id) {
  if (typeof id !== "string") {
    return null;
  }
  return COMPLETED_GAME_HARDENING_LANE_CASES_BY_ID.get(id) ?? null;
}

function completedGameLaneKey(scenario) {
  return `${scenario.proofGroup}:${scenario.proofStep}`;
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
