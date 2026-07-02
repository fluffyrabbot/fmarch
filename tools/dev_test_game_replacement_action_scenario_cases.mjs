const baseReplacementActionScenario = Object.freeze({
  actorSlot: "slot_4",
  targetSlot: "slot-2",
  hostPrincipalUserId: "host_h",
  staleOutgoingPrincipalUserId: "player-goon-a",
  replacementPrincipalUserId: "player-rowan",
  targetPrincipalUserId: "player-target",
  templateId: "factional_kill",
  commandAction: "submit_action:factional_kill",
  phaseId: "N01",
  staleOutgoingError: "NotYourSlot",
  targetNoticeEffect: "player_killed",
  targetStatusAfterKill: "dead",
});

export const replacementActionLaneIds = [
  "replacement-incoming-action",
  "replacement-action-reconnect",
  "replacement-stale-action-after-resolve",
];

export function replacementIncomingActionScenario() {
  return {
    ...baseReplacementActionScenario,
    laneId: "replacement-incoming-action",
    gameFixtureId: "replacement-incoming-action-game-a",
    actionId: "incoming_replacement_factional_kill",
    outcomeSummary:
      "Rowan submitted factional_kill as Slot 4 and killed slot-2",
    proof:
      "A disposable host role URL processed Slot 4 replacement, Rowan's current replacement role URL submitted factional_kill as Slot 4, the host role URL resolved N01, and the target role URL received the private player_killed factional_kill receipt while Rowan did not.",
  };
}

export function replacementActionReconnectScenario() {
  return {
    ...baseReplacementActionScenario,
    laneId: "replacement-action-reconnect",
    gameFixtureId: "replacement-action-reconnect-game-a",
    actionId: "replacement_action_reconnect_factional_kill",
    reconnectPostPrefix: "Replacement action reconnect proof",
    reconnectPostBodyPrefix: "Replacement action reconnect proof from dev:test-game ",
    outcomeSummary:
      "Rowan reconnected after resolved Slot 4 factional_kill to locked N01 with no actions",
    proof:
      "After Rowan replaced into Slot 4, submitted factional_kill, and host resolved N01, Rowan's replacement role URL dropped its live projection and reconnected to locked N01 with no remaining actions while the target role URL retained the private kill receipt.",
  };
}

export function replacementStaleActionAfterResolveScenario() {
  return {
    ...baseReplacementActionScenario,
    laneId: "replacement-stale-action-after-resolve",
    gameFixtureId: "replacement-stale-action-after-resolve-game-a",
    staleActionId: "role_factional_kill",
    rejectionError: "PhaseLocked",
    rejectionStatusText: "Reject PhaseLocked",
    staleActionStateMessageFragment: "stale action state",
    currentActionControlsMessageFragment: "current action controls",
    outcomeSummary:
      "Rowan's stale replacement factional_kill rejected after N01 resolution without appending",
    proof:
      "After Rowan replaced into Slot 4, a replacement role URL froze with factional_kill available, the host resolved N01, and Rowan's stale action click rejected PhaseLocked while refreshing to locked N01 with no actions and no target kill receipt.",
  };
}
