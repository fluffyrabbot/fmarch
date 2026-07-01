import {
  completedHostStaleCommandHardeningLaneIds,
} from "./dev_test_game_core_loop_completed_recovery_cases.mjs";
import {
  replacementPrivatePostRecoveryLaneIds,
} from "./dev_test_game_replacement_private_scenarios.mjs";

export const staleConflictMessageLaneIds = Object.freeze([
  "replacement-stale-conflict-message",
  "stale-action-conflict-message",
  "stale-dead-action-conflict",
]);

export const playerActionFoundationLaneIds = Object.freeze([
  "idempotent-retry",
  "action-idempotent-retry",
  "concurrent-action-race",
  "concurrent-action-race-reload",
  "reconnect-recovery",
]);

export const stalePlayerCommandLaneIds = Object.freeze([
  "stale-player-vote",
  "stale-player-vote-after-change",
  "stale-player-withdraw-after-change",
  "stale-player-withdraw-after-phase-closure",
  "stale-player-vote-after-phase-closure",
  "stale-player-post-after-phase-closure",
]);

export const promotedStalePlayerCommandLaneIds = Object.freeze(
  stalePlayerCommandLaneIds.slice(0, 1),
);

export const playerActionConflictRecoveryLaneIds = Object.freeze([
  "stale-same-action-recovery",
  "stale-action-conflict",
  "stale-action-reconnect-recovery",
]);

export const hostStandaloneStaleControlLaneIds = Object.freeze([
  "stale-host-publish",
  "stale-host-lifecycle",
  "stale-host-lifecycle-reload",
  "stale-host-modkill",
  "stale-host-modkill-reload",
]);

export const hostPromptStaleControlLaneIds = Object.freeze([
  "stale-host-prompt",
  "stale-host-prompt-reload",
]);

export const hostGenericStaleControlLaneIds = Object.freeze([
  "stale-host-control",
]);

const cloneScenarioCase = (scenario) => ({
  ...scenario,
  expectedStalePhase: { ...scenario.expectedStalePhase },
  expectedCurrentPhase: { ...scenario.expectedCurrentPhase },
  expectedSetupActions: Object.freeze({ ...scenario.expectedSetupActions }),
  expectedCurrentActions: Object.freeze({ ...scenario.expectedCurrentActions }),
});

export const hostPhaseStaleControlCaseDefinitions = Object.freeze([
  Object.freeze({
    key: "resolve",
    proofField: "staleHostResolve",
    reloadProofField: "staleHostResolveReloadAfterReject",
    baseLaneId: "stale-host-resolve",
    reloadLaneId: "stale-host-resolve-reload",
    reconnectLaneId: "stale-host-resolve-reconnect-recovery",
    baseLabel: "Stale host resolve rejects after live resolution",
    reloadLabel: "Stale host resolve recovery reloads locked phase console",
    reconnectLabel: "Stale host resolve recovery reconnects locked phase console",
    actionId: "resolve_phase",
    rejectError: "PhaseLocked",
    expectedStalePhase: Object.freeze({ id: "D02", locked: false }),
    expectedCurrentPhase: Object.freeze({ id: "D02", locked: true }),
    expectedSetupActions: Object.freeze({
      phaseIncludes: ["resolve_phase", "lock_thread"],
      phaseExcludes: [],
      deadlineIncludes: [],
    }),
    expectedCurrentActions: Object.freeze({
      phaseIncludes: ["unlock_thread", "advance_phase"],
      phaseExcludes: ["resolve_phase", "lock_thread"],
      deadlineIncludes: ["extend_deadline"],
    }),
  }),
  Object.freeze({
    key: "advance",
    proofField: "staleHostAdvance",
    reloadProofField: "staleHostAdvanceReloadAfterReject",
    baseLaneId: "stale-host-advance",
    reloadLaneId: "stale-host-advance-reload",
    reconnectLaneId: "stale-host-advance-reconnect-recovery",
    baseLabel: "Stale host advance rejects after live unlock",
    reloadLabel: "Stale host advance recovery reloads open phase console",
    reconnectLabel: "Stale host advance recovery reconnects open phase console",
    actionId: "advance_phase",
    rejectError: "InvalidTarget",
    expectedStalePhase: Object.freeze({ id: "D02", locked: true }),
    expectedCurrentPhase: Object.freeze({ id: "D02", locked: false }),
    expectedSetupActions: Object.freeze({
      phaseIncludes: ["advance_phase", "unlock_thread"],
      phaseExcludes: [],
      deadlineIncludes: [],
    }),
    expectedCurrentActions: Object.freeze({
      phaseIncludes: ["resolve_phase", "lock_thread"],
      phaseExcludes: ["advance_phase"],
      deadlineIncludes: ["extend_deadline"],
    }),
  }),
  Object.freeze({
    key: "deadline",
    proofField: "staleHostDeadline",
    reloadProofField: "staleHostDeadlineReloadAfterReject",
    baseLaneId: "stale-host-deadline",
    reloadLaneId: "stale-host-deadline-reload",
    reconnectLaneId: "stale-host-deadline-reconnect-recovery",
    baseLabel: "Stale host deadline control rejects without drift",
    reloadLabel: "Stale host deadline recovery reloads open phase console",
    reconnectLabel: "Stale host deadline recovery reconnects open phase console",
    actionId: "extend_deadline",
    rejectError: "PhaseLocked",
    expectedStalePhase: Object.freeze({ id: "D01", locked: false }),
    expectedCurrentPhase: Object.freeze({
      id: "D02",
      locked: false,
      deadline: null,
    }),
    expectedSetupActions: Object.freeze({
      phaseIncludes: ["resolve_phase", "lock_thread"],
      phaseExcludes: [],
      deadlineIncludes: ["extend_deadline"],
    }),
    expectedCurrentActions: Object.freeze({
      phaseIncludes: ["resolve_phase", "lock_thread"],
      phaseExcludes: [],
      deadlineIncludes: ["extend_deadline"],
    }),
  }),
]);

export function hostPhaseStaleControlCases() {
  return hostPhaseStaleControlCaseDefinitions.map(cloneScenarioCase);
}

export const hostPhaseStaleControlLaneIds = Object.freeze(
  hostPhaseStaleControlCaseDefinitions.flatMap((scenario) => [
    scenario.baseLaneId,
    scenario.reloadLaneId,
    scenario.reconnectLaneId,
  ]),
);

export const hostStaleControlLaneIds = Object.freeze([
  ...hostStandaloneStaleControlLaneIds,
  ...hostPromptStaleControlLaneIds,
  ...completedHostStaleCommandHardeningLaneIds(),
  ...hostGenericStaleControlLaneIds,
  ...hostPhaseStaleControlLaneIds,
]);

export const hostRaceReloadLaneIds = Object.freeze([
  "concurrent-host-resolve-race",
  "concurrent-host-resolve-race-reload",
  "concurrent-host-advance-race",
  "concurrent-host-advance-race-reload",
  "concurrent-host-deadline-advance-race",
  "concurrent-host-deadline-advance-race-reload",
  "concurrent-host-mixed-advance-race",
  "concurrent-host-mixed-advance-race-reload",
]);

export const hostPhaseStaleRecoveryLaneIds = Object.freeze([
  ...hostPhaseStaleControlCaseDefinitions.flatMap((scenario) => [
    scenario.reloadLaneId,
    scenario.reconnectLaneId,
  ]),
]);

export const cohostDeadlineStaleControlCaseDefinitions = Object.freeze([
  Object.freeze({
    key: "cohost-deadline",
    proofField: "staleCohostDeadline",
    reloadProofField: "staleCohostDeadlineReloadAfterReject",
    baseLaneId: "stale-cohost-deadline",
    reloadLaneId: "stale-cohost-deadline-reload",
    reconnectLaneId: "stale-cohost-deadline-reconnect-recovery",
    baseLabel: "Stale cohost deadline control rejects without drift",
    reloadLabel: "Stale cohost deadline recovery reloads delegated console",
    reconnectLabel: "Stale cohost deadline recovery reconnects delegated console",
    actionId: "extend_deadline",
    rejectError: "PhaseLocked",
    expectedStalePhase: Object.freeze({ id: "D01", locked: false }),
    expectedCurrentPhase: Object.freeze({
      id: "D02",
      locked: false,
      deadline: null,
    }),
    expectedSetupActions: Object.freeze({
      phaseIncludes: [],
      phaseExcludes: [],
      deadlineIncludes: ["extend_deadline"],
    }),
    expectedCurrentActions: Object.freeze({
      phaseIncludes: [],
      phaseExcludes: [],
      deadlineIncludes: ["extend_deadline"],
    }),
  }),
]);

export function cohostDeadlineStaleControlCases() {
  return cohostDeadlineStaleControlCaseDefinitions.map(cloneScenarioCase);
}

export const cohostDeadlineRecoveryLaneIds = Object.freeze([
  ...cohostDeadlineStaleControlCaseDefinitions.flatMap((scenario) => [
    scenario.reloadLaneId,
    scenario.reconnectLaneId,
  ]),
]);

export const hostCohostRaceRecoveryLaneIds = Object.freeze([
  "concurrent-host-resolve-race",
  "concurrent-host-resolve-race-reload",
  "stale-host-resolve-reload",
  "stale-host-resolve-reconnect-recovery",
  "concurrent-host-advance-race",
  "concurrent-host-advance-race-reload",
  "stale-host-advance-reload",
  "stale-host-advance-reconnect-recovery",
  "stale-host-deadline-reload",
  "stale-host-deadline-reconnect-recovery",
  ...cohostDeadlineRecoveryLaneIds,
  "concurrent-host-deadline-advance-race",
  "concurrent-host-deadline-advance-race-reload",
  "concurrent-host-mixed-advance-race",
  "concurrent-host-mixed-advance-race-reload",
]);

export const hostedMatrixReconnectLaneIds = Object.freeze([
  "reconnect-recovery",
  "replacement-reconnect-recovery",
  "replacement-action-reconnect",
  replacementPrivatePostRecoveryLaneIds[1],
  "stale-action-reconnect-recovery",
  "stale-host-complete-reconnect-recovery",
  "stale-host-resolve-reconnect-recovery",
  "stale-host-advance-reconnect-recovery",
  "stale-host-deadline-reconnect-recovery",
  "stale-cohost-deadline-reconnect-recovery",
]);

export const hostedMatrixStaleConflictLaneIds = Object.freeze([
  ...staleConflictMessageLaneIds,
  "stale-host-control",
]);
