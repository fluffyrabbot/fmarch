import {
  completedHostStaleCommandHardeningLaneIds,
} from "./dev_test_game_core_loop_completed_scenarios.mjs";
import {
  hostAdvanceByDeadlineCommandFacts,
  hostAdvancePhaseCommandFacts,
  hostExtendDeadlineCommandFacts,
  hostLockThreadCommandFacts,
  hostResolvePhaseCommandFacts,
  hostUnlockThreadCommandFacts,
} from "./dev_test_game_core_loop_host_phase_scenarios.mjs";
import {
  replacementPrivatePostRecoveryLaneIds,
} from "./dev_test_game_replacement_private_scenarios.mjs";
import {
  replacementSessionRecoveryLaneIds,
} from "./dev_test_game_replacement_handoff_scenario_cases.mjs";

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

const cloneHostActionSet = (actionSet) =>
  hostActionSet({
    phaseIncludes: actionSet.phaseIncludes,
    phaseExcludes: actionSet.phaseExcludes,
    deadlineIncludes: actionSet.deadlineIncludes,
  });

const cloneScenarioCase = (scenario) => ({
  ...scenario,
  expectedStalePhase: { ...scenario.expectedStalePhase },
  expectedCurrentPhase: { ...scenario.expectedCurrentPhase },
  expectedSetupActions: cloneHostActionSet(scenario.expectedSetupActions),
  expectedCurrentActions: cloneHostActionSet(scenario.expectedCurrentActions),
});

const cloneRaceCoverageCell = (cell) => ({
  ...cell,
  roleSurfaces: [...cell.roleSurfaces],
  commandFacts: cell.commandFacts.map((facts) => ({ ...facts })),
});

const hostLockThreadActionId = hostLockThreadCommandFacts().actionId;
const hostUnlockThreadActionId = hostUnlockThreadCommandFacts().actionId;
const hostResolvePhaseActionId = hostResolvePhaseCommandFacts().actionId;
const hostAdvancePhaseActionId = hostAdvancePhaseCommandFacts().actionId;
const hostExtendDeadlineActionId = hostExtendDeadlineCommandFacts().actionId;

function hostActionSet({
  phaseIncludes = [],
  phaseExcludes = [],
  deadlineIncludes = [],
} = {}) {
  return Object.freeze({
    phaseIncludes: Object.freeze([...phaseIncludes]),
    phaseExcludes: Object.freeze([...phaseExcludes]),
    deadlineIncludes: Object.freeze([...deadlineIncludes]),
  });
}

export function hostOpenPhaseActionSet({
  includeDeadline = true,
  excludeAdvance = false,
} = {}) {
  return hostActionSet({
    phaseIncludes: [hostResolvePhaseActionId, hostLockThreadActionId],
    phaseExcludes: excludeAdvance ? [hostAdvancePhaseActionId] : [],
    deadlineIncludes: includeDeadline ? [hostExtendDeadlineActionId] : [],
  });
}

export function hostLockedPhaseActionSet({
  includeDeadline = true,
  excludeOpen = false,
} = {}) {
  return hostActionSet({
    phaseIncludes: [hostUnlockThreadActionId, hostAdvancePhaseActionId],
    phaseExcludes: excludeOpen
      ? [hostResolvePhaseActionId, hostLockThreadActionId]
      : [],
    deadlineIncludes: includeDeadline ? [hostExtendDeadlineActionId] : [],
  });
}

export function cohostDeadlineActionSet() {
  return hostActionSet({
    deadlineIncludes: [hostExtendDeadlineActionId],
  });
}

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
    ...hostResolvePhaseCommandFacts(),
    rejectError: "PhaseLocked",
    expectedStalePhase: Object.freeze({ id: "D02", locked: false }),
    expectedCurrentPhase: Object.freeze({ id: "D02", locked: true }),
    expectedSetupActions: hostOpenPhaseActionSet({ includeDeadline: false }),
    expectedCurrentActions: hostLockedPhaseActionSet({ excludeOpen: true }),
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
    ...hostAdvancePhaseCommandFacts(),
    rejectError: "InvalidTarget",
    expectedStalePhase: Object.freeze({ id: "D02", locked: true }),
    expectedCurrentPhase: Object.freeze({ id: "D02", locked: false }),
    expectedSetupActions: hostLockedPhaseActionSet({ includeDeadline: false }),
    expectedCurrentActions: hostOpenPhaseActionSet({ excludeAdvance: true }),
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
    ...hostExtendDeadlineCommandFacts(),
    rejectError: "PhaseLocked",
    expectedStalePhase: Object.freeze({ id: "D01", locked: false }),
    expectedCurrentPhase: Object.freeze({
      id: "D02",
      locked: false,
      deadline: null,
    }),
    expectedSetupActions: hostOpenPhaseActionSet(),
    expectedCurrentActions: hostOpenPhaseActionSet(),
  }),
]);

export function hostPhaseStaleControlCases() {
  return hostPhaseStaleControlCaseDefinitions.map(cloneScenarioCase);
}

export function hostPhaseStaleControlCase(key) {
  const scenario = hostPhaseStaleControlCaseDefinitions.find(
    (candidate) => candidate.key === key,
  );
  if (scenario === undefined) {
    throw new Error(`unknown host phase stale-control case: ${key}`);
  }
  return cloneScenarioCase(scenario);
}

export function hostStaleAdvanceControlCase() {
  return hostPhaseStaleControlCase("advance");
}

export function hostStaleResolveControlCase() {
  return hostPhaseStaleControlCase("resolve");
}

export const hostStaleResolveControlLaneId =
  hostStaleResolveControlCase().baseLaneId;

export const hostStaleResolveReloadLaneId =
  hostStaleResolveControlCase().reloadLaneId;

export const hostStaleAdvanceControlLaneId =
  hostStaleAdvanceControlCase().baseLaneId;

export const hostStaleAdvanceReloadLaneId =
  hostStaleAdvanceControlCase().reloadLaneId;

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

export const hostPhaseRaceCoverageCellDefinitions = Object.freeze([
  Object.freeze({
    id: "host-resolve",
    actorPair: "host vs host",
    commandFamily: "phase resolution",
    raceLaneId: "concurrent-host-resolve-race",
    reloadLaneId: "concurrent-host-resolve-race-reload",
    roleSurfaces: Object.freeze(["host"]),
    commandFacts: Object.freeze([Object.freeze(hostResolvePhaseCommandFacts())]),
  }),
  Object.freeze({
    id: "host-advance",
    actorPair: "host vs host",
    commandFamily: "phase advance",
    raceLaneId: "concurrent-host-advance-race",
    reloadLaneId: "concurrent-host-advance-race-reload",
    roleSurfaces: Object.freeze(["host"]),
    commandFacts: Object.freeze([Object.freeze(hostAdvancePhaseCommandFacts())]),
  }),
  Object.freeze({
    id: "host-deadline-advance",
    actorPair: "host vs host",
    commandFamily: "deadline and phase advance",
    raceLaneId: "concurrent-host-deadline-advance-race",
    reloadLaneId: "concurrent-host-deadline-advance-race-reload",
    roleSurfaces: Object.freeze(["host"]),
    commandFacts: Object.freeze([
      Object.freeze(hostAdvanceByDeadlineCommandFacts()),
    ]),
  }),
  Object.freeze({
    id: "host-mixed-advance",
    actorPair: "host vs host",
    commandFamily: "mixed phase advance controls",
    raceLaneId: "concurrent-host-mixed-advance-race",
    reloadLaneId: "concurrent-host-mixed-advance-race-reload",
    roleSurfaces: Object.freeze(["host"]),
    commandFacts: Object.freeze([
      Object.freeze(hostAdvancePhaseCommandFacts()),
      Object.freeze(hostAdvanceByDeadlineCommandFacts()),
    ]),
  }),
]);

export function hostPhaseRaceCoverageCellCases() {
  return hostPhaseRaceCoverageCellDefinitions.map(cloneRaceCoverageCell);
}

export function hostPhaseRaceCoverageCellIds() {
  return hostPhaseRaceCoverageCellCases().map((cell) => cell.id);
}

export const hostRaceReloadLaneIds = Object.freeze(
  hostPhaseRaceCoverageCellDefinitions.flatMap((scenario) => [
    scenario.raceLaneId,
    scenario.reloadLaneId,
  ]),
);

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
    ...hostExtendDeadlineCommandFacts(),
    rejectError: "PhaseLocked",
    expectedStalePhase: Object.freeze({ id: "D01", locked: false }),
    expectedCurrentPhase: Object.freeze({
      id: "D02",
      locked: false,
      deadline: null,
    }),
    expectedSetupActions: cohostDeadlineActionSet(),
    expectedCurrentActions: cohostDeadlineActionSet(),
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
  replacementSessionRecoveryLaneIds.at(-1),
  "replacement-action-reconnect",
  replacementPrivatePostRecoveryLaneIds[1],
  "stale-action-reconnect-recovery",
  "stale-host-complete-reconnect-recovery",
  "stale-host-resolve-reconnect-recovery",
  "stale-host-advance-reconnect-recovery",
  "stale-host-deadline-reconnect-recovery",
  "stale-cohost-deadline-reconnect-recovery",
]);
