import {
  replacementSessionRecoveryLaneIds,
} from "./dev_test_game_replacement_handoff_scenario_cases.mjs";
import {
  replacementPrivatePostRecoveryLaneIds,
} from "./dev_test_game_replacement_private_scenarios.mjs";
import {
  hardeningReconnectRecoveryFeatureTargetKind,
} from "./dev_test_game_hardening_feature_target_kinds.mjs";

const cloneScenarioCase = (scenario) => ({ ...scenario });
const cloneExpectation = (expectation) => {
  const cloned = {
    ...expectation,
    messageFragments: [...(expectation.messageFragments ?? [])],
    dispatchRefreshKeys: [...(expectation.dispatchRefreshKeys ?? [])],
    receiptRefreshKeys: [...(expectation.receiptRefreshKeys ?? [])],
    browserCommandState: { ...(expectation.browserCommandState ?? {}) },
    apiCommandState: { ...(expectation.apiCommandState ?? {}) },
  };
  if (Object.hasOwn(expectation, "phaseActions")) {
    cloned.phaseActions = [...expectation.phaseActions];
  }
  return cloned;
};

export const playerLiveReconnectLaneId = "reconnect-recovery";
export const playerLiveLagResyncLaneId = "live-projection-lag-resync";
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
export const hardeningReconnectFeatureTargetKind =
  hardeningReconnectRecoveryFeatureTargetKind;

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

const sharedHostStaleReconnectExpectation = Object.freeze({
  reconnectingState: "reconnecting",
  recoveryState: "recovered",
  reconnectAttempt: 1,
  recoveredPhaseId: "D02",
});

export const hostStaleResolveReconnectExpectationDefinition = Object.freeze({
  ...sharedHostStaleReconnectExpectation,
  laneId: hostStaleResolveReconnectLaneId,
  role: "host",
  recoveredLocked: true,
});

export const hostStaleAdvanceReconnectExpectationDefinition = Object.freeze({
  ...sharedHostStaleReconnectExpectation,
  laneId: hostStaleAdvanceReconnectLaneId,
  role: "host",
  recoveredLocked: false,
});

export const hostStaleDeadlineReconnectExpectationDefinition = Object.freeze({
  ...sharedHostStaleReconnectExpectation,
  laneId: hostStaleDeadlineReconnectLaneId,
  role: "host",
  recoveredLocked: false,
  apiDeadline: null,
});

export const cohostStaleDeadlineReconnectExpectationDefinition = Object.freeze({
  ...sharedHostStaleReconnectExpectation,
  laneId: cohostStaleDeadlineReconnectLaneId,
  role: "cohost",
  recoveredLocked: false,
  apiDeadline: null,
  phaseActions: Object.freeze([]),
});

export const hostStaleReconnectExpectationDefinitions = Object.freeze([
  hostStaleResolveReconnectExpectationDefinition,
  hostStaleAdvanceReconnectExpectationDefinition,
  hostStaleDeadlineReconnectExpectationDefinition,
  cohostStaleDeadlineReconnectExpectationDefinition,
]);

const reconnectHardeningSpineTargetDefinitions = Object.freeze([
  Object.freeze({
    targetKey: "playerLiveLagResyncRecovery",
    featureSlotId: playerLiveLagResyncLaneId,
    laneId: playerLiveLagResyncLaneId,
    role: "player",
    roleUrlSource: "direct",
    featureTargetKind: hardeningReconnectFeatureTargetKind,
  }),
  Object.freeze({
    targetKey: "staleActionReconnectRecovery",
    featureSlotId: "stale-action-reconnect-recovery",
    laneId: stalePlayerActionReconnectLaneId,
    role: "player",
    roleUrlSource: "direct",
    featureTargetKind: hardeningReconnectFeatureTargetKind,
  }),
  Object.freeze({
    targetKey: "privateChannelStaleActionReconnectRecovery",
    featureSlotId: "private-channel-stale-action-reconnect-recovery",
    laneId: privateChannelStaleActionReconnectLaneId,
    role: "private-channel",
    roleUrlSource: "direct",
    channelId: privateChannelStaleActionReconnectExpectationDefinition.channelId,
    featureTargetKind: hardeningReconnectFeatureTargetKind,
  }),
  Object.freeze({
    targetKey: "hostStaleResolveReconnectRecovery",
    featureSlotId: "host-stale-resolve-reconnect-recovery",
    laneId: hostStaleResolveReconnectLaneId,
    role: "host",
    roleUrlSource: "synthesized",
    featureTargetKind: hardeningReconnectFeatureTargetKind,
  }),
  Object.freeze({
    targetKey: "hostStaleAdvanceReconnectRecovery",
    featureSlotId: "host-stale-advance-reconnect-recovery",
    laneId: hostStaleAdvanceReconnectLaneId,
    role: "host",
    roleUrlSource: "synthesized",
    featureTargetKind: hardeningReconnectFeatureTargetKind,
  }),
  Object.freeze({
    targetKey: "hostStaleDeadlineReconnectRecovery",
    featureSlotId: "host-stale-deadline-reconnect-recovery",
    laneId: hostStaleDeadlineReconnectLaneId,
    role: "host",
    roleUrlSource: "synthesized",
    featureTargetKind: hardeningReconnectFeatureTargetKind,
  }),
  Object.freeze({
    targetKey: "cohostStaleDeadlineReconnectRecovery",
    featureSlotId: "cohost-stale-deadline-reconnect-recovery",
    laneId: cohostStaleDeadlineReconnectLaneId,
    role: "host",
    roleUrlSource: "synthesized",
    featureTargetKind: hardeningReconnectFeatureTargetKind,
  }),
]);

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

export function hostStaleReconnectExpectations() {
  return hostStaleReconnectExpectationDefinitions.map(cloneExpectation);
}

export function hostStaleReconnectExpectationForLane(laneId) {
  const expectation = hostStaleReconnectExpectationDefinitions.find(
    (candidate) => candidate.laneId === laneId,
  );
  if (expectation === undefined) {
    throw new Error(`unknown host stale reconnect lane: ${laneId}`);
  }
  return cloneExpectation(expectation);
}

export function reconnectHardeningSpineTargetCases() {
  return reconnectHardeningSpineTargetDefinitions.map((target) => ({
    ...target,
  }));
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
