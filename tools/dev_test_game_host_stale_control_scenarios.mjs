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
  cohostStaleDeadlineReconnectLaneId,
  hostedMatrixReconnectLaneIds,
  hostStaleAdvanceReconnectLaneId,
  hostStaleDeadlineReconnectLaneId,
  hostStaleResolveReconnectLaneId,
} from "./dev_test_game_stale_client_reconnect_scenarios.mjs";
import {
  assertLaneCoverageSummary,
  buildLaneCoverageSummary,
  cloneLaneCoverageFamilies,
} from "./dev_test_game_lane_coverage.mjs";

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

const cloneStatusExpectation = (expectation) => {
  const cloned = { ...expectation };
  if (Object.hasOwn(expectation, "phaseActions")) {
    cloned.phaseActions = [...expectation.phaseActions];
  }
  return cloned;
};

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
    reconnectLaneId: hostStaleResolveReconnectLaneId,
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
    reconnectLaneId: hostStaleAdvanceReconnectLaneId,
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
    reconnectLaneId: hostStaleDeadlineReconnectLaneId,
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

export const hostStaleDeadlineControlLaneId =
  hostPhaseStaleControlCase("deadline").baseLaneId;

export const hostStaleDeadlineReloadLaneId =
  hostPhaseStaleControlCase("deadline").reloadLaneId;

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

export const hostStaleControlCoverageFamilyDefinitions = Object.freeze([
  Object.freeze({
    id: "standalone-host-controls",
    label: "Standalone host stale controls",
    laneIds: hostStandaloneStaleControlLaneIds,
  }),
  Object.freeze({
    id: "prompt-controls",
    label: "Prompt stale controls",
    laneIds: hostPromptStaleControlLaneIds,
  }),
  Object.freeze({
    id: "completed-game-stale-commands",
    label: "Completed-game stale commands",
    laneIds: Object.freeze(completedHostStaleCommandHardeningLaneIds()),
  }),
  Object.freeze({
    id: "generic-host-control",
    label: "Generic host stale control",
    laneIds: hostGenericStaleControlLaneIds,
  }),
  Object.freeze({
    id: "phase-controls",
    label: "Host phase stale controls",
    laneIds: hostPhaseStaleControlLaneIds,
  }),
]);

export function hostStaleControlCoverageFamilies() {
  return cloneLaneCoverageFamilies(hostStaleControlCoverageFamilyDefinitions);
}

export function buildHostStaleControlCoverageSummary(lanes) {
  return buildLaneCoverageSummary({
    lanes,
    laneIds: hostStaleControlLaneIds,
    families: hostStaleControlCoverageFamilyDefinitions,
  });
}

export function assertHostStaleControlCoverageSummary({ summary, lanes }) {
  return assertLaneCoverageSummary({
    summary,
    lanes,
    laneIds: hostStaleControlLaneIds,
    familyDefinitions: hostStaleControlCoverageFamilyDefinitions,
    label: "host stale-control",
  });
}

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

export const hostStandaloneRaceCoverageCellDefinitions = Object.freeze([
  Object.freeze({
    id: "host-votecount-publication",
    actorPair: "host vs host",
    commandFamily: "official votecount publication",
    raceLaneId: "concurrent-host-publish-race",
    reloadLaneId: "concurrent-host-publish-race-reload",
    roleSurfaces: Object.freeze(["host", "player"]),
    commandFacts: Object.freeze([]),
  }),
  Object.freeze({
    id: "host-lifecycle",
    actorPair: "host vs host",
    commandFamily: "host lifecycle controls",
    raceLaneId: "concurrent-host-lifecycle-race",
    reloadLaneId: "concurrent-host-lifecycle-race-reload",
    roleSurfaces: Object.freeze(["host"]),
    commandFacts: Object.freeze([]),
  }),
]);

const hostPhaseRaceReloadSpineTargetDefinitions = Object.freeze([
  Object.freeze({
    targetKey: "hostConcurrentResolveRaceReload",
    featureSlotId: "host-concurrent-resolve-race-reload",
    reloadLaneId: hostPhaseRaceCoverageCellDefinitions[0].reloadLaneId,
    role: "host",
  }),
  Object.freeze({
    targetKey: "hostConcurrentAdvanceRaceReload",
    featureSlotId: "host-concurrent-advance-race-reload",
    reloadLaneId: hostPhaseRaceCoverageCellDefinitions[1].reloadLaneId,
    role: "host",
  }),
  Object.freeze({
    targetKey: "hostConcurrentDeadlineAdvanceRaceReload",
    featureSlotId: "host-concurrent-deadline-advance-race-reload",
    reloadLaneId: hostPhaseRaceCoverageCellDefinitions[2].reloadLaneId,
    role: "host",
  }),
  Object.freeze({
    targetKey: "hostConcurrentMixedAdvanceRaceReload",
    featureSlotId: "host-concurrent-mixed-advance-race-reload",
    reloadLaneId: hostPhaseRaceCoverageCellDefinitions[3].reloadLaneId,
    role: "host",
  }),
]);

const hostStandaloneRaceReloadSpineTargetDefinitions = Object.freeze([
  Object.freeze({
    targetKey: "hostConcurrentPublishRaceReload",
    featureSlotId: "host-concurrent-publish-race-reload",
    reloadLaneId: hostStandaloneRaceCoverageCellDefinitions[0].reloadLaneId,
    role: "host",
  }),
  Object.freeze({
    targetKey: "hostConcurrentLifecycleRaceReload",
    featureSlotId: "host-concurrent-lifecycle-race-reload",
    reloadLaneId: hostStandaloneRaceCoverageCellDefinitions[1].reloadLaneId,
    role: "host",
  }),
]);

export function hostPhaseRaceCoverageCellCases() {
  return hostPhaseRaceCoverageCellDefinitions.map(cloneRaceCoverageCell);
}

export function hostPhaseRaceCoverageCellIds() {
  return hostPhaseRaceCoverageCellCases().map((cell) => cell.id);
}

export function hostStandaloneRaceCoverageCellCases() {
  return hostStandaloneRaceCoverageCellDefinitions.map(cloneRaceCoverageCell);
}

export function hostStandaloneRaceCoverageCellIds() {
  return hostStandaloneRaceCoverageCellCases().map((cell) => cell.id);
}

export function hostStandaloneRaceCoverageCellCase(id) {
  const cell = hostStandaloneRaceCoverageCellDefinitions.find(
    (candidate) => candidate.id === id,
  );
  if (cell === undefined) {
    throw new Error(`unknown host standalone race coverage cell: ${id}`);
  }
  return cloneRaceCoverageCell(cell);
}

export function hostPhaseRaceReloadSpineTargetCases() {
  return hostPhaseRaceReloadSpineTargetDefinitions.map((target) => ({
    ...target,
  }));
}

export function hostStandaloneRaceReloadSpineTargetCases() {
  return hostStandaloneRaceReloadSpineTargetDefinitions.map((target) => ({
    ...target,
  }));
}

export const hostRaceReloadLaneIds = Object.freeze(
  hostPhaseRaceCoverageCellDefinitions.flatMap((scenario) => [
    scenario.raceLaneId,
    scenario.reloadLaneId,
  ]),
);

export const hostPublishRaceLaneIds = Object.freeze([
  hostStandaloneRaceCoverageCellCase("host-votecount-publication").raceLaneId,
  hostStandaloneRaceCoverageCellCase("host-votecount-publication").reloadLaneId,
]);

export const hostLifecycleRaceLaneIds = Object.freeze([
  hostStandaloneRaceCoverageCellCase("host-lifecycle").raceLaneId,
  hostStandaloneRaceCoverageCellCase("host-lifecycle").reloadLaneId,
]);

export const hostStandaloneRaceReloadLaneIds = Object.freeze([
  ...hostPublishRaceLaneIds,
  ...hostLifecycleRaceLaneIds,
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
    reconnectLaneId: cohostStaleDeadlineReconnectLaneId,
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

export function cohostDeadlineStaleControlCase() {
  return cloneScenarioCase(cohostDeadlineStaleControlCaseDefinitions[0]);
}

export const cohostStaleDeadlineControlLaneId =
  cohostDeadlineStaleControlCase().baseLaneId;

export const cohostStaleDeadlineReloadLaneId =
  cohostDeadlineStaleControlCase().reloadLaneId;

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

function rejectReceiptText(rejectError) {
  const reason =
    rejectError === "InvalidTarget" ? "invalid target" : "phase locked";
  return `Reject ${rejectError}: ${reason}; stale phase state, refresh and use current controls`;
}

function hostPhaseBaseStatusExpectation(scenario) {
  return Object.freeze({
    laneId: scenario.baseLaneId,
    role: "host",
    rejectError: scenario.rejectError,
    locked: scenario.expectedCurrentPhase.locked,
    ...(Object.hasOwn(scenario.expectedCurrentPhase, "deadline")
      ? { apiDeadline: scenario.expectedCurrentPhase.deadline }
      : {}),
  });
}

function hostPhaseReloadStatusExpectation(scenario) {
  return Object.freeze({
    laneId: scenario.reloadLaneId,
    role: "host",
    rejectReceipt: rejectReceiptText(scenario.rejectError),
    locked: scenario.expectedCurrentPhase.locked,
    ...(Object.hasOwn(scenario.expectedCurrentPhase, "deadline")
      ? { apiDeadline: scenario.expectedCurrentPhase.deadline }
      : {}),
  });
}

function cohostDeadlineBaseStatusExpectation(scenario) {
  return Object.freeze({
    laneId: scenario.baseLaneId,
    role: "cohost",
    rejectError: scenario.rejectError,
    apiDeadline: scenario.expectedCurrentPhase.deadline,
    phaseActions: Object.freeze([]),
  });
}

function cohostDeadlineReloadStatusExpectation(scenario) {
  return Object.freeze({
    laneId: scenario.reloadLaneId,
    role: "cohost",
    rejectReceipt: rejectReceiptText(scenario.rejectError),
    locked: scenario.expectedCurrentPhase.locked,
    apiDeadline: scenario.expectedCurrentPhase.deadline,
    phaseActions: Object.freeze([]),
  });
}

export const hostStaleControlStatusExpectationDefinitions = Object.freeze([
  ...hostPhaseStaleControlCaseDefinitions.flatMap((scenario) => [
    hostPhaseBaseStatusExpectation(scenario),
    hostPhaseReloadStatusExpectation(scenario),
  ]),
  ...cohostDeadlineStaleControlCaseDefinitions.flatMap((scenario) => [
    cohostDeadlineBaseStatusExpectation(scenario),
    cohostDeadlineReloadStatusExpectation(scenario),
  ]),
]);

export function hostStaleControlStatusExpectations() {
  return hostStaleControlStatusExpectationDefinitions.map(
    cloneStatusExpectation,
  );
}

export function hostStaleControlStatusExpectationForLane(laneId) {
  const expectation = hostStaleControlStatusExpectationDefinitions.find(
    (candidate) => candidate.laneId === laneId,
  );
  if (expectation === undefined) {
    throw new Error(`unknown host stale-control status lane: ${laneId}`);
  }
  return cloneStatusExpectation(expectation);
}

export const coreLoopHostStaleCommandHighlightedLaneIds = Object.freeze([
  hostStaleResolveControlLaneId,
  hostStaleResolveReloadLaneId,
  hostStaleAdvanceControlLaneId,
  hostStaleAdvanceReloadLaneId,
]);

export const hardeningHostStaleCommandHighlightedLaneIds = Object.freeze([
  hostStaleResolveControlLaneId,
  hostStaleResolveReloadLaneId,
  hostStaleAdvanceControlLaneId,
  hostStaleDeadlineControlLaneId,
  cohostStaleDeadlineControlLaneId,
]);

export { hostedMatrixReconnectLaneIds };
