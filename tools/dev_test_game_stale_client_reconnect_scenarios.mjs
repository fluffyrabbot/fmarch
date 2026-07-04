import {
  replacementSessionRecoveryLaneIds,
} from "./dev_test_game_replacement_handoff_scenario_cases.mjs";
import {
  replacementPrivatePostRecoveryLaneIds,
} from "./dev_test_game_replacement_private_scenarios.mjs";

const cloneScenarioCase = (scenario) => ({ ...scenario });
const cloneExpectation = (expectation) => ({
  ...expectation,
  messageFragments: [...(expectation.messageFragments ?? [])],
  dispatchRefreshKeys: [...(expectation.dispatchRefreshKeys ?? [])],
  receiptRefreshKeys: [...(expectation.receiptRefreshKeys ?? [])],
  browserCommandState: { ...(expectation.browserCommandState ?? {}) },
  apiCommandState: { ...(expectation.apiCommandState ?? {}) },
});

export const playerLiveReconnectLaneId = "reconnect-recovery";
export const replacementSessionReconnectLaneId =
  replacementSessionRecoveryLaneIds.at(-1);
export const replacementActionReconnectLaneId = "replacement-action-reconnect";
export const replacementPrivatePostReconnectLaneId =
  replacementPrivatePostRecoveryLaneIds[1];
export const stalePlayerActionReconnectLaneId =
  "stale-action-reconnect-recovery";
export const privateChannelStaleActionReconnectLaneId =
  "private-channel-stale-action-reconnect-recovery";
export const completedHostStaleCompleteReconnectLaneId =
  "stale-host-complete-reconnect-recovery";
export const hostStaleResolveReconnectLaneId =
  "stale-host-resolve-reconnect-recovery";
export const hostStaleAdvanceReconnectLaneId =
  "stale-host-advance-reconnect-recovery";
export const hostStaleDeadlineReconnectLaneId =
  "stale-host-deadline-reconnect-recovery";
export const cohostStaleDeadlineReconnectLaneId =
  "stale-cohost-deadline-reconnect-recovery";

const sharedStaleActionReconnectExpectation = Object.freeze({
  rejectError: "PhaseLocked",
  actorSlot: "slot_4",
  templateId: "factional_kill",
  commandAction: "submit_action:factional_kill",
  messageFragments: Object.freeze(["stale action state", "current action controls"]),
  dispatchRefreshKeys: Object.freeze(["commandState", "dayVoteOutcomes"]),
  receiptRefreshKeys: Object.freeze(["commandState"]),
  stalePhaseId: "N01",
  recoveredPhaseId: "D02",
  recoveredLocked: false,
  recoveredActionCount: 0,
  reconnectingState: "reconnecting",
  recoveryState: "recovered",
  reconnectAttempt: 1,
  recoveredSnapshotContainsPost: true,
  browserCommandState: Object.freeze({
    actorSlot: "slot_4",
    actorAlive: true,
    actorStatus: "alive",
    phaseId: "D02",
    locked: false,
    actionCount: 0,
  }),
  apiCommandState: Object.freeze({
    actorSlot: "slot_4",
    actorAlive: true,
    actorStatus: "alive",
    phaseId: "D02",
    locked: false,
    actionCount: 0,
  }),
});

export const stalePlayerActionReconnectExpectationDefinition = Object.freeze({
  ...sharedStaleActionReconnectExpectation,
  laneId: stalePlayerActionReconnectLaneId,
  roleUrlFragment: "/g/",
});

export const privateChannelStaleActionReconnectExpectationDefinition =
  Object.freeze({
    ...sharedStaleActionReconnectExpectation,
    laneId: privateChannelStaleActionReconnectLaneId,
    roleUrlFragment: "/c/private%3Amafia_day_chat",
    channelId: "private:mafia_day_chat",
    privateThreadPagerVisible: true,
  });

export const staleClientReconnectCaseDefinitions = Object.freeze([
  Object.freeze({
    id: "player-live-projection-reconnect",
    laneId: playerLiveReconnectLaneId,
    role: "player",
    family: "live-projection-reconnect",
    label: "Dropped player live projection reconnects",
  }),
  Object.freeze({
    id: "replacement-session-reconnect",
    laneId: replacementSessionReconnectLaneId,
    role: "replacement-player",
    family: "replacement-session-reconnect",
    label: "Replacement session reconnect recovers current slot",
  }),
  Object.freeze({
    id: "replacement-action-reconnect",
    laneId: replacementActionReconnectLaneId,
    role: "replacement-player",
    family: "replacement-action-reconnect",
    label: "Replacement action reconnect recovers locked state",
  }),
  Object.freeze({
    id: "replacement-private-post-reconnect",
    laneId: replacementPrivatePostReconnectLaneId,
    role: "replacement-player",
    family: "replacement-private-channel-reconnect",
    label: "Replacement private post reconnect preserves channel scope",
  }),
  Object.freeze({
    id: "stale-player-action-reconnect",
    laneId: stalePlayerActionReconnectLaneId,
    role: "player",
    family: "stale-player-action-reconnect",
    label: "Stale player action reconnect recovers current state",
  }),
  Object.freeze({
    id: "private-channel-stale-action-reconnect",
    laneId: privateChannelStaleActionReconnectLaneId,
    role: "player",
    family: "private-channel-stale-action-reconnect",
    label: "Private channel stale action reconnect preserves scope",
  }),
  Object.freeze({
    id: "completed-host-stale-complete-reconnect",
    laneId: completedHostStaleCompleteReconnectLaneId,
    role: "host",
    family: "completed-host-stale-command-reconnect",
    label: "Completed host stale complete reconnect recovers revealed console",
  }),
  Object.freeze({
    id: "host-stale-resolve-reconnect",
    laneId: hostStaleResolveReconnectLaneId,
    role: "host",
    family: "host-stale-phase-reconnect",
    label: "Stale host resolve reconnect recovers locked phase console",
  }),
  Object.freeze({
    id: "host-stale-advance-reconnect",
    laneId: hostStaleAdvanceReconnectLaneId,
    role: "host",
    family: "host-stale-phase-reconnect",
    label: "Stale host advance reconnect recovers open phase console",
  }),
  Object.freeze({
    id: "host-stale-deadline-reconnect",
    laneId: hostStaleDeadlineReconnectLaneId,
    role: "host",
    family: "host-stale-deadline-reconnect",
    label: "Stale host deadline reconnect recovers current deadline controls",
  }),
  Object.freeze({
    id: "cohost-stale-deadline-reconnect",
    laneId: cohostStaleDeadlineReconnectLaneId,
    role: "cohost",
    family: "cohost-stale-deadline-reconnect",
    label: "Stale cohost deadline reconnect recovers delegated controls",
  }),
]);

export function staleClientReconnectCases() {
  return staleClientReconnectCaseDefinitions.map(cloneScenarioCase);
}

export function staleClientReconnectLaneIds() {
  return staleClientReconnectCases().map((scenario) => scenario.laneId);
}

export function stalePlayerActionReconnectExpectation() {
  return cloneExpectation(stalePlayerActionReconnectExpectationDefinition);
}

export function privateChannelStaleActionReconnectExpectation() {
  return cloneExpectation(
    privateChannelStaleActionReconnectExpectationDefinition,
  );
}

export const staleClientReconnectHighlightedLaneIds = Object.freeze([
  playerLiveReconnectLaneId,
  stalePlayerActionReconnectLaneId,
  privateChannelStaleActionReconnectLaneId,
  completedHostStaleCompleteReconnectLaneId,
  hostStaleResolveReconnectLaneId,
  hostStaleAdvanceReconnectLaneId,
  hostStaleDeadlineReconnectLaneId,
  cohostStaleDeadlineReconnectLaneId,
]);

export const hostedMatrixReconnectLaneIds = Object.freeze(
  staleClientReconnectLaneIds(),
);
