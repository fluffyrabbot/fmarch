const cloneCommandFacts = (facts) => ({ ...facts });
const cloneLifecycleScenario = (scenario) => ({
  ...scenario,
  visibleRows: [...scenario.visibleRows],
});
const cloneHostModkillScenario = (scenario) => ({
  ...scenario,
});
const cloneHostLifecycleRaceScenario = (scenario) => ({
  ...scenario,
});
const cloneHostPublishRaceScenario = (scenario) => ({
  ...scenario,
});
const cloneHostResolveRaceScenario = (scenario) => ({
  ...scenario,
});
const cloneHostAdvanceRaceScenario = (scenario) => ({
  ...scenario,
});
const cloneHostDeadlineAdvanceRaceScenario = (scenario) => ({
  ...scenario,
});
const clonePhaseStateCase = (phaseStateCase) => ({ ...phaseStateCase });
const cloneTransitionProofCase = (transitionCase) => ({
  ...transitionCase,
  expectedRefreshKeys: [...transitionCase.expectedRefreshKeys],
});
const cloneHostTransitionSurfaceCase = (surfaceCase) => ({
  ...surfaceCase,
  transitionFragments: [...surfaceCase.transitionFragments],
  resolveCase: cloneTransitionProofCase(surfaceCase.resolveCase),
  advanceCase: cloneTransitionProofCase(surfaceCase.advanceCase),
  playerObservationCases: surfaceCase.playerObservationCases.map((playerCase) => ({
    ...playerCase,
  })),
});
const cloneDayVoteHostTransitionProofCase = (transitionCase) => ({
  ...transitionCase,
  resolveCase: cloneTransitionProofCase(transitionCase.resolveCase),
  advanceCase: cloneTransitionProofCase(transitionCase.advanceCase),
});
const cloneResolveAdvanceHostTransitionProofCase = (transitionCase) => ({
  ...transitionCase,
  resolveCase: cloneTransitionProofCase(transitionCase.resolveCase),
  advanceCase: cloneTransitionProofCase(transitionCase.advanceCase),
});

const hostPhaseCommandFactDefinitions = Object.freeze({
  resolve: Object.freeze({
    actionId: "resolve_phase",
    commandKind: "ResolvePhase",
  }),
  advance: Object.freeze({
    actionId: "advance_phase",
    commandKind: "AdvancePhase",
  }),
  lock: Object.freeze({
    actionId: "lock_thread",
    commandKind: "LockThread",
  }),
  unlock: Object.freeze({
    actionId: "unlock_thread",
    commandKind: "UnlockThread",
  }),
  complete: Object.freeze({
    actionId: "complete_game",
    commandKind: "CompleteGame",
  }),
  extendDeadline: Object.freeze({
    actionId: "extend_deadline",
    commandKind: "ExtendDeadline",
  }),
  advanceByDeadline: Object.freeze({
    actionId: "advance_phase_by_deadline",
    commandKind: "AdvancePhaseByDeadline",
  }),
});

export function hostResolvePhaseCommandFacts() {
  return cloneCommandFacts(hostPhaseCommandFactDefinitions.resolve);
}

export function hostAdvancePhaseCommandFacts() {
  return cloneCommandFacts(hostPhaseCommandFactDefinitions.advance);
}

export function hostLockThreadCommandFacts() {
  return cloneCommandFacts(hostPhaseCommandFactDefinitions.lock);
}

export function hostUnlockThreadCommandFacts() {
  return cloneCommandFacts(hostPhaseCommandFactDefinitions.unlock);
}

export function hostCompleteGameCommandFacts() {
  return cloneCommandFacts(hostPhaseCommandFactDefinitions.complete);
}

export function hostExtendDeadlineCommandFacts() {
  return cloneCommandFacts(hostPhaseCommandFactDefinitions.extendDeadline);
}

export function hostAdvanceByDeadlineCommandFacts() {
  return cloneCommandFacts(hostPhaseCommandFactDefinitions.advanceByDeadline);
}

const actionAffordance = (actionIds) => actionIds.join(",");

const hostPhaseTransitionStateDefinitions = Object.freeze({
  open: Object.freeze({
    phaseState: "open",
    locked: false,
    deadlineAffordance: actionAffordance([
      hostResolvePhaseCommandFacts().actionId,
      hostLockThreadCommandFacts().actionId,
    ]),
  }),
  locked: Object.freeze({
    phaseState: "locked",
    locked: true,
    deadlineAffordance: actionAffordance([
      hostUnlockThreadCommandFacts().actionId,
      hostAdvancePhaseCommandFacts().actionId,
    ]),
  }),
});

export function hostOpenPhaseTransitionCase() {
  return clonePhaseStateCase(hostPhaseTransitionStateDefinitions.open);
}

export function hostLockedPhaseTransitionCase() {
  return clonePhaseStateCase(hostPhaseTransitionStateDefinitions.locked);
}

export function hostPhaseTransitionCaseForState(phaseState) {
  const phaseStateCase = hostPhaseTransitionStateDefinitions[phaseState];
  if (phaseStateCase === undefined) {
    throw new Error(`unknown host phase transition state: ${phaseState}`);
  }
  return clonePhaseStateCase(phaseStateCase);
}

export function hostDeadlineAffordanceForPhaseState(phaseState) {
  return hostPhaseTransitionCaseForState(phaseState).deadlineAffordance;
}

const hostResolvePhaseTransitionRefreshKeys = Object.freeze([
  "host",
  "votecount",
  "dayVoteOutcomes",
  "hostPrompts",
]);

export const hostNightActionTransitionLaneId =
  "host-night-action-transition";

export function hostResolvePhaseTransitionCase({
  streamSeq,
  expectedPhaseId,
} = {}) {
  return cloneTransitionProofCase({
    ...hostResolvePhaseCommandFacts(),
    streamSeq,
    expectedPhaseId,
    expectedPhaseState: "locked",
    expectedRefreshKeys: hostResolvePhaseTransitionRefreshKeys,
  });
}

export function hostAdvancePhaseTransitionCase({
  streamSeq,
  expectedPhaseId,
} = {}) {
  return cloneTransitionProofCase({
    ...hostAdvancePhaseCommandFacts(),
    streamSeq,
    expectedPhaseId,
    expectedPhaseState: "open",
    expectedRefreshKeys: [],
  });
}

const hostNightActionTransitionSurfaceCaseDefinition = Object.freeze({
  surfaceTestId: "host-console-surface",
  transitionFragments: Object.freeze([
    "resolve_phase:ack:905",
    "advance_phase:ack:906",
    "actionPlayer:D03",
    "target:D03",
    "normal:D03",
  ]),
  resolveCase: Object.freeze(
    hostResolvePhaseTransitionCase({
      streamSeq: 905,
      expectedPhaseId: "N02",
    }),
  ),
  advanceCase: Object.freeze(
    hostAdvancePhaseTransitionCase({
      streamSeq: 906,
      expectedPhaseId: "D03",
    }),
  ),
  playerObservationCases: Object.freeze([
    Object.freeze({
      proofField: "actionPlayerObservationProof",
      sourceRoleUrlField: "sourceActionPlayerRoleUrl",
      expectedPrincipalUserId: "player_mira",
      expectedSlot: "slot-7",
      slotField: "actionPlayerSlot",
      expectedActorAlive: true,
      expectedActorStatus: "alive",
      expectedActionState: "disabled:no legal action available",
      expectedStatusText: "no legal action available",
      expectedPrivateCount: 0,
      expectedPrivateReceipt: false,
      expectedBoundaryText: "action player observed host AdvancePhase",
    }),
    Object.freeze({
      proofField: "nightTargetObservationProof",
      sourceRoleUrlField: "sourceNightTargetRoleUrl",
      expectedPrincipalUserId: "player-seed",
      expectedSlot: "slot-3",
      slotField: "targetSlot",
      expectedActorAlive: false,
      expectedActorStatus: "dead",
      expectedActionState: "disabled:actor is not alive",
      expectedStatusText: "actor is not alive",
      expectedPrivateCount: 1,
      expectedPrivateReceipt: true,
      expectedBoundaryText: "killed target stayed dead",
    }),
    Object.freeze({
      proofField: "normalObservationProof",
      sourceRoleUrlField: "sourceNormalRoleUrl",
      expectedPrincipalUserId: "player_rowan",
      expectedSlot: "slot-4",
      slotField: "normalSlot",
      expectedActorAlive: true,
      expectedActorStatus: "alive",
      expectedActionState: "disabled:no legal action available",
      expectedStatusText: "no legal action available",
      expectedPrivateCount: 0,
      expectedPrivateReceipt: false,
      expectedBoundaryText: "normal player observed open D03",
    }),
  ]),
});

export function hostNightActionTransitionSurfaceCase() {
  return cloneHostTransitionSurfaceCase(
    hostNightActionTransitionSurfaceCaseDefinition,
  );
}

export function assertHostNightActionTransitionSurfaceCase({
  hostNightActionTransitionSurface,
  expectedGame,
  assertPlayerObservationProof,
  includeEvidenceInError = false,
}) {
  const surfaceCase = hostNightActionTransitionSurfaceCaseDefinition;
  if (
    hostNightActionTransitionSurface?.status !== "passed" ||
    hostNightActionTransitionSurface.clickedThroughFromRoleUrl !== true ||
    hostNightActionTransitionSurface.releaseReady !== false ||
    hostNightActionTransitionSurface.productionReady !== false ||
    typeof hostNightActionTransitionSurface.sourceHostRoleUrl !== "string" ||
    !hostNightActionTransitionSurface.sourceHostRoleUrl.includes("/g/") ||
    !hostNightActionTransitionSurface.sourceHostRoleUrl.endsWith("/host") ||
    typeof hostNightActionTransitionSurface.sourceActionPlayerRoleUrl !==
      "string" ||
    !hostNightActionTransitionSurface.sourceActionPlayerRoleUrl.includes("/g/") ||
    typeof hostNightActionTransitionSurface.sourceNightTargetRoleUrl !==
      "string" ||
    !hostNightActionTransitionSurface.sourceNightTargetRoleUrl.includes("/g/") ||
    typeof hostNightActionTransitionSurface.sourceNormalRoleUrl !== "string" ||
    !hostNightActionTransitionSurface.sourceNormalRoleUrl.includes("/g/") ||
    typeof hostNightActionTransitionSurface.visitedHostRolePath !== "string" ||
    !hostNightActionTransitionSurface.visitedHostRolePath.endsWith("/host") ||
    hostNightActionTransitionSurface.surfaceTestId !== surfaceCase.surfaceTestId ||
    !surfaceCase.transitionFragments.every((fragment) =>
      String(hostNightActionTransitionSurface.transition ?? "").includes(fragment),
    )
  ) {
    throwHostPhaseScenarioAssertionError({
      message: "core-loop admin proof missing host night action transition surface",
      evidence: hostNightActionTransitionSurface,
      includeEvidenceInError,
    });
  }
  assertHostPhaseTransitionActionProofCase({
    proof: hostNightActionTransitionSurface.resolveProof,
    expectedGame,
    ...surfaceCase.resolveCase,
    includeEvidenceInError,
  });
  assertHostPhaseTransitionActionProofCase({
    proof: hostNightActionTransitionSurface.advanceProof,
    expectedGame,
    ...surfaceCase.advanceCase,
    includeEvidenceInError,
  });
  for (const playerCase of surfaceCase.playerObservationCases) {
    assertPlayerObservationProof({
      proof: hostNightActionTransitionSurface[playerCase.proofField],
      expectedGame,
      sourceRoleUrl:
        hostNightActionTransitionSurface[playerCase.sourceRoleUrlField],
      expectedPrincipalUserId: playerCase.expectedPrincipalUserId,
      expectedSlot: playerCase.expectedSlot,
      slotField: playerCase.slotField,
      expectedActorAlive: playerCase.expectedActorAlive,
      expectedActorStatus: playerCase.expectedActorStatus,
      expectedActionState: playerCase.expectedActionState,
      expectedStatusText: playerCase.expectedStatusText,
      expectedPrivateCount: playerCase.expectedPrivateCount,
      expectedPrivateReceipt: playerCase.expectedPrivateReceipt,
      expectedBoundaryText: playerCase.expectedBoundaryText,
      expectedCommandStateEndpoint:
        `/games/${expectedGame}/player-command-state?principal_user_id=${playerCase.expectedPrincipalUserId}&slot_id=${playerCase.expectedSlot}`,
      expectedNotificationsEndpoint:
        `/games/${expectedGame}/notifications?principal_user_id=${playerCase.expectedPrincipalUserId}`,
    });
  }
}

const dayFourNoLynchHostTransitionProofCaseDefinition = Object.freeze({
  surfaceTestId: "host-console-surface",
  setupResyncFromSeq: 912,
  setupPhaseId: "D04",
  setupPhaseState: "open",
  expectedVotecountTarget: "No lynch",
  expectedDayVoteOutcomePhaseId: "D04",
  expectedDayVoteOutcomeStatus: "NoLynch",
  resolveCase: Object.freeze(
    hostResolvePhaseTransitionCase({
      streamSeq: 913,
      expectedPhaseId: "D04",
    }),
  ),
  advanceCase: Object.freeze(
    hostAdvancePhaseTransitionCase({
      streamSeq: 914,
      expectedPhaseId: "N04",
    }),
  ),
});

export function dayFourNoLynchHostTransitionProofCase() {
  return cloneDayVoteHostTransitionProofCase(
    dayFourNoLynchHostTransitionProofCaseDefinition,
  );
}

export function assertDayFourNoLynchHostTransitionProofCase({
  proof,
  expectedGame,
  sourceRoleUrl,
  assertHostPhaseTransitionActionProof = assertHostPhaseTransitionActionProofCase,
  includeEvidenceInError = false,
}) {
  const transitionCase = dayFourNoLynchHostTransitionProofCaseDefinition;
  if (
    proof?.status !== "passed" ||
    proof.clickedThroughFromRoleUrl !== true ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.rawInviteTokensVisible !== false ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    typeof proof.visitedRolePath !== "string" ||
    !proof.visitedRolePath.endsWith("/host") ||
    proof.surfaceTestId !== transitionCase.surfaceTestId ||
    proof.setupResyncFromSeq !== transitionCase.setupResyncFromSeq ||
    proof.setupSnapshotHost?.phase?.id !== transitionCase.setupPhaseId ||
    proof.setupSnapshotHost?.phase?.state !== transitionCase.setupPhaseState
  ) {
    throwHostPhaseScenarioAssertionError({
      message:
        "core-loop admin proof missing Day 4 no-lynch host transition",
      evidence: proof,
      includeEvidenceInError,
    });
  }
  assertHostPhaseTransitionActionProof({
    proof: proof.resolveProof,
    expectedGame,
    ...transitionCase.resolveCase,
    includeEvidenceInError,
  });
  assertHostPhaseTransitionActionProof({
    proof: proof.advanceProof,
    expectedGame,
    ...transitionCase.advanceCase,
    includeEvidenceInError,
  });
  if (
    proof.resolveProof?.votecountProjection?.[0]?.target !==
      transitionCase.expectedVotecountTarget ||
    proof.resolveProof?.dayVoteOutcomesProjection?.at?.(-1)?.phaseId !==
      transitionCase.expectedDayVoteOutcomePhaseId ||
    proof.resolveProof?.dayVoteOutcomesProjection?.at?.(-1)?.status !==
      transitionCase.expectedDayVoteOutcomeStatus
  ) {
    throwHostPhaseScenarioAssertionError({
      message:
        "core-loop admin proof missing Day 4 no-lynch host projections",
      evidence: proof.resolveProof,
      includeEvidenceInError,
    });
  }
}

const emptyNightThreeHostTransitionProofCaseDefinition = Object.freeze({
  surfaceTestId: "host-console-surface",
  setupResyncFromSeq: 909,
  setupPhaseId: "N03",
  setupPhaseState: "open",
  resolveCase: Object.freeze(
    hostResolvePhaseTransitionCase({
      streamSeq: 910,
      expectedPhaseId: "N03",
    }),
  ),
  advanceCase: Object.freeze(
    hostAdvancePhaseTransitionCase({
      streamSeq: 911,
      expectedPhaseId: "D04",
    }),
  ),
});

export function emptyNightThreeHostTransitionProofCase() {
  return cloneResolveAdvanceHostTransitionProofCase(
    emptyNightThreeHostTransitionProofCaseDefinition,
  );
}

export function assertEmptyNightThreeHostTransitionProofCase({
  proof,
  expectedGame,
  sourceRoleUrl,
  assertHostPhaseTransitionActionProof = assertHostPhaseTransitionActionProofCase,
  includeEvidenceInError = false,
}) {
  const transitionCase = emptyNightThreeHostTransitionProofCaseDefinition;
  if (
    proof?.status !== "passed" ||
    proof.clickedThroughFromRoleUrl !== true ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.rawInviteTokensVisible !== false ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    typeof proof.visitedRolePath !== "string" ||
    !proof.visitedRolePath.endsWith("/host") ||
    proof.surfaceTestId !== transitionCase.surfaceTestId ||
    proof.setupResyncFromSeq !== transitionCase.setupResyncFromSeq ||
    proof.setupSnapshotHost?.phase?.id !== transitionCase.setupPhaseId ||
    proof.setupSnapshotHost?.phase?.state !== transitionCase.setupPhaseState
  ) {
    throwHostPhaseScenarioAssertionError({
      message: "core-loop admin proof missing empty Night 3 host transition",
      evidence: proof,
      includeEvidenceInError,
    });
  }
  assertHostPhaseTransitionActionProof({
    proof: proof.resolveProof,
    expectedGame,
    ...transitionCase.resolveCase,
    includeEvidenceInError,
  });
  assertHostPhaseTransitionActionProof({
    proof: proof.advanceProof,
    expectedGame,
    ...transitionCase.advanceCase,
    includeEvidenceInError,
  });
}

const hostLifecycleControlScenarioDefinition = Object.freeze({
  proofCheckId: "host-lifecycle-control",
  surfaceTestId: "host-console-surface",
  checkpointTestId: "host-lifecycle-control-checkpoint",
  role: "moderator",
  commandEndpoint: "/commands",
  ...hostLockThreadCommandFacts(),
  ackStreamSeq: 601,
  openPhaseId: "D01",
  openPhaseState: "open",
  lockedPhaseState: "locked",
  slotId: "slot-7",
  actionState: "enabled:mark_dead,modkill_slot",
  openDeadlineAffordance:
    hostPhaseTransitionStateDefinitions.open.deadlineAffordance,
  lockedDeadlineAffordance:
    hostPhaseTransitionStateDefinitions.locked.deadlineAffordance,
  visibleRows: Object.freeze([
    "phase",
    "slot",
    "actionState",
    "deadlineAffordance",
    "recovery",
  ]),
});

export function hostLifecycleControlScenario() {
  return cloneLifecycleScenario(hostLifecycleControlScenarioDefinition);
}

const hostModkillControlScenarioDefinition = Object.freeze({
  proofCheckId: "host-modkill-control",
  staleProofCheckId: "stale-host-modkill",
  staleReloadProofCheckId: "stale-host-modkill-reload",
  targetSlot: "slot-7",
  lifecycleStatus: "modkilled",
  lifecycleLabel: "Modkilled",
  staleLifecycleLabel: "Alive",
  modkillState: "ack",
  commandStatus: "modkilled",
  apiModkillStatus: "modkilled",
  actorStatusAfterModkill: "modkilled",
  directPostError: "SlotNotAlive",
  restoreState: "ack",
  restoreStatus: "alive",
  staleRejectError: "InvalidTarget",
  staleReloadRouteStatus: 200,
});

export function hostModkillControlScenario() {
  return cloneHostModkillScenario(hostModkillControlScenarioDefinition);
}

const hostLifecycleRaceScenarioDefinition = Object.freeze({
  proofCheckId: "concurrent-host-lifecycle-race",
  reloadProofCheckId: "concurrent-host-lifecycle-race-reload",
  ackRaceRole: "dead",
  rejectRaceRole: "modkill",
  ackActionId: "mark_dead",
  rejectActionId: "modkill_slot",
  winningStatus: "dead",
  rejectError: "InvalidTarget",
  apiStatus: "dead",
  deadRouteStatus: 200,
  modkillRouteStatus: 200,
  playerRouteStatus: 200,
  deadLifecycleLabel: "Dead",
  modkillLifecycleLabel: "Dead",
  playerStatus: "dead",
});

export function hostLifecycleRaceScenario() {
  return cloneHostLifecycleRaceScenario(hostLifecycleRaceScenarioDefinition);
}

const hostPublishRaceScenarioDefinition = Object.freeze({
  proofCheckId: "concurrent-host-publish-race",
  reloadProofCheckId: "concurrent-host-publish-race-reload",
  targetSlot: "slot_5",
  targetCount: 3,
  ackRaceRole: "second",
  rejectRaceRole: "first",
  ackState: "ack",
  rejectError: "InvalidTarget",
  apiOfficialPostCount: 1,
  playerOfficialPostCount: 1,
  firstHostRouteStatus: 200,
  secondHostRouteStatus: 200,
  playerRouteStatus: 200,
});

export function hostPublishRaceScenario() {
  return cloneHostPublishRaceScenario(hostPublishRaceScenarioDefinition);
}

const hostResolveRaceScenarioDefinition = Object.freeze({
  proofCheckId: "concurrent-host-resolve-race",
  reloadProofCheckId: "concurrent-host-resolve-race-reload",
  allowedPageRoles: Object.freeze(["live", "concurrent"]),
  ackState: "ack",
  rejectError: "PhaseLocked",
  lockedAfterRace: true,
  lockedAfterRestore: false,
  liveRouteStatus: 200,
  concurrentRouteStatus: 200,
  phaseId: "D02",
  phaseState: "locked",
  phaseLocked: true,
  apiLocked: true,
});

export function hostResolveRaceScenario() {
  return cloneHostResolveRaceScenario(hostResolveRaceScenarioDefinition);
}

const hostAdvanceRaceScenarioDefinition = Object.freeze({
  proofCheckId: "concurrent-host-advance-race",
  reloadProofCheckId: "concurrent-host-advance-race-reload",
  allowedPageRoles: Object.freeze(["live", "concurrent"]),
  ackState: "ack",
  rejectError: "InvalidTarget",
  phaseAfterRace: "N02",
  liveRouteStatus: 200,
  concurrentRouteStatus: 200,
  phaseId: "N02",
  phaseState: "open",
  phaseLocked: false,
  apiPhase: "N02",
});

export function hostAdvanceRaceScenario() {
  return cloneHostAdvanceRaceScenario(hostAdvanceRaceScenarioDefinition);
}

const hostDeadlineAdvanceRaceScenarioDefinition = Object.freeze({
  proofCheckId: "concurrent-host-deadline-advance-race",
  reloadProofCheckId: "concurrent-host-deadline-advance-race-reload",
  allowedPageRoles: Object.freeze(["live", "concurrent"]),
  ackState: "ack",
  rejectError: "InvalidTarget",
  phaseAfterRace: "N01",
  liveRouteStatus: 200,
  concurrentRouteStatus: 200,
  phaseId: "N01",
  phaseState: "open",
  phaseLocked: false,
  apiPhase: "N01",
  apiDeadline: null,
});

export function hostDeadlineAdvanceRaceScenario() {
  return cloneHostDeadlineAdvanceRaceScenario(
    hostDeadlineAdvanceRaceScenarioDefinition,
  );
}

export function assertHostLifecycleControlRoleSurfaceCase({
  hostRoleSurface,
  expectedGame,
  scenario = hostLifecycleControlScenarioDefinition,
  includeEvidenceInError = false,
}) {
  const checkpoint = hostRoleSurface?.hostLifecycleControlCheckpoint;
  const clickProof = hostRoleSurface?.hostLifecycleControlClickProof;
  const staleRejectProof = hostRoleSurface?.hostLifecycleStaleRejectProof;
  if (
    hostRoleSurface?.status !== "passed" ||
    hostRoleSurface.clickedThroughFromRoleUrl !== true ||
    hostRoleSurface.releaseReady !== false ||
    hostRoleSurface.productionReady !== false ||
    typeof hostRoleSurface.sourceRoleUrl !== "string" ||
    !hostRoleSurface.sourceRoleUrl.includes("/g/") ||
    typeof hostRoleSurface.visitedRolePath !== "string" ||
    !hostRoleSurface.visitedRolePath.endsWith("/host") ||
    hostRoleSurface.surfaceTestId !== scenario.surfaceTestId ||
    hostRoleSurface.checkpointTestId !== scenario.checkpointTestId ||
    checkpoint?.proofCheckId !== scenario.proofCheckId ||
    checkpoint.phaseId !== scenario.openPhaseId ||
    checkpoint.phaseState !== scenario.openPhaseState ||
    checkpoint.slotId !== scenario.slotId ||
    checkpoint.actionState !== scenario.actionState ||
    checkpoint.deadlineAffordance !== scenario.openDeadlineAffordance ||
    !checkpoint.recoveryText?.includes("Reject PhaseLocked") ||
    !checkpoint.statusText?.includes(
      "Host lifecycle controls are reachable from this role URL",
    )
  ) {
    throwHostPhaseScenarioAssertionError({
      message: "core-loop admin proof missing host lifecycle role checkpoint",
      evidence: hostRoleSurface,
      includeEvidenceInError,
    });
  }
  for (const rowId of scenario.visibleRows) {
    if (!checkpoint.visibleRows?.includes(rowId)) {
      throwHostPhaseScenarioAssertionError({
        message: `host lifecycle checkpoint missing visible row: ${rowId}`,
        evidence: hostRoleSurface,
        includeEvidenceInError,
      });
    }
  }
  assertHostLifecycleControlClickProofCase({
    clickProof,
    expectedGame,
    scenario,
    includeEvidenceInError,
  });
  assertHostLifecycleStaleRejectProofCase({
    staleRejectProof,
    expectedGame,
    scenario,
    includeEvidenceInError,
  });
}

export function assertHostLifecycleControlClickProofCase({
  clickProof,
  expectedGame,
  scenario = hostLifecycleControlScenarioDefinition,
  includeEvidenceInError = false,
}) {
  if (
    clickProof?.status !== "passed" ||
    clickProof.clickedAction !== scenario.actionId ||
    clickProof.commandKind !== scenario.commandKind ||
    clickProof.command?.game !== expectedGame ||
    clickProof.commandStatus?.state !== "ack" ||
    !clickProof.commandStatus?.message?.includes(
      `Ack: stream seqs ${scenario.ackStreamSeq}`,
    ) ||
    clickProof.commandOutcome?.state !== "ack" ||
    !clickProof.commandOutcome?.message?.includes(
      `Ack: stream seqs ${scenario.ackStreamSeq}`,
    ) ||
    clickProof.bridgePlan?.role !== scenario.role ||
    clickProof.bridgePlan.commandKind !== scenario.commandKind ||
    clickProof.bridgePlan.commandEndpoint !== scenario.commandEndpoint ||
    clickProof.bridgePlan.finalState !== "ack" ||
    clickProof.bridgePlan.projectionRefreshKeys?.length !== 0 ||
    clickProof.projection?.phase?.id !== scenario.openPhaseId ||
    clickProof.projection?.phase?.locked !== true ||
    clickProof.checkpointPhaseStateAfterAck !== scenario.lockedPhaseState ||
    clickProof.checkpointDeadlineAffordanceAfterAck !==
      scenario.lockedDeadlineAffordance ||
    !String(clickProof.statusText ?? "")
      .toLowerCase()
      .includes(`ack: stream seqs ${scenario.ackStreamSeq}`) ||
    clickProof.activityCount !== 1 ||
    !String(clickProof.activityStatusText ?? "")
      .toLowerCase()
      .includes(`ack: stream seqs ${scenario.ackStreamSeq}`)
  ) {
    throwHostPhaseScenarioAssertionError({
      message: "core-loop admin proof missing host lifecycle click ACK",
      evidence: clickProof,
      includeEvidenceInError,
    });
  }
}

export function assertHostLifecycleStaleRejectProofCase({
  staleRejectProof,
  expectedGame,
  scenario = hostLifecycleControlScenarioDefinition,
  includeEvidenceInError = false,
}) {
  if (
    staleRejectProof?.status !== "passed" ||
    staleRejectProof.clickedAction !== scenario.actionId ||
    staleRejectProof.commandKind !== scenario.commandKind ||
    staleRejectProof.command?.game !== expectedGame ||
    staleRejectProof.commandStatus?.state !== "reject" ||
    staleRejectProof.commandStatus.error !== "PhaseLocked" ||
    !staleRejectProof.commandStatus?.message?.includes(
      "Reject PhaseLocked: phase locked",
    ) ||
    staleRejectProof.commandOutcome?.state !== "reject" ||
    staleRejectProof.commandOutcome.error !== "PhaseLocked" ||
    !staleRejectProof.commandOutcome?.message?.includes(
      "Reject PhaseLocked: phase locked",
    ) ||
    staleRejectProof.bridgePlan?.role !== scenario.role ||
    staleRejectProof.bridgePlan.commandKind !== scenario.commandKind ||
    staleRejectProof.bridgePlan.commandEndpoint !== scenario.commandEndpoint ||
    staleRejectProof.bridgePlan.finalState !== "reject" ||
    staleRejectProof.bridgePlan.projectionRefreshKeys?.[0] !== "host" ||
    staleRejectProof.bridgePlan.projectionRefreshKeys?.length !== 1 ||
    staleRejectProof.projection?.phase?.id !== scenario.openPhaseId ||
    staleRejectProof.projection?.phase?.locked !== false ||
    staleRejectProof.checkpointPhaseStateAfterReject !== scenario.openPhaseState ||
    staleRejectProof.checkpointDeadlineAffordanceAfterReject !==
      scenario.openDeadlineAffordance ||
    !String(staleRejectProof.recoveryText ?? "").includes("Reject PhaseLocked") ||
    staleRejectProof.activityCount !== 1 ||
    !String(staleRejectProof.activityStatusText ?? "")
      .toLowerCase()
      .includes("reject phaselocked: phase locked")
  ) {
    throwHostPhaseScenarioAssertionError({
      message: "core-loop admin proof missing host stale lifecycle recovery",
      evidence: staleRejectProof,
      includeEvidenceInError,
    });
  }
}

export function assertHostModkillControlSurfaceCase({
  hostModkillControlSurface,
  scenario = hostModkillControlScenarioDefinition,
  includeEvidenceInError = false,
}) {
  const proofLane = hostModkillControlSurface?.hostModkillControl;
  const staleProofLane = hostModkillControlSurface?.staleHostModkill;
  const staleReloadLane = hostModkillControlSurface?.staleHostModkillReload;
  const proof = proofLane?.evidence;
  const staleProof = staleProofLane?.evidence;
  const staleReloadProof = staleReloadLane?.evidence;
  if (
    hostModkillControlSurface?.status !== "passed" ||
    hostModkillControlSurface.proofCheckId !== scenario.proofCheckId ||
    hostModkillControlSurface.staleProofCheckId !== scenario.staleProofCheckId ||
    hostModkillControlSurface.staleReloadProofCheckId !==
      scenario.staleReloadProofCheckId ||
    proofLane?.id !== scenario.proofCheckId ||
    proofLane?.status !== "passed" ||
    proof?.targetSlot !== scenario.targetSlot ||
    proof?.modkillState !== scenario.modkillState ||
    proof?.commandStatus !== scenario.commandStatus ||
    proof?.apiModkillStatus !== scenario.apiModkillStatus ||
    proof?.actorStatusAfterModkill !== scenario.actorStatusAfterModkill ||
    proof?.directPostError !== scenario.directPostError ||
    proof?.restoreState !== scenario.restoreState ||
    proof?.apiRestoredStatus !== scenario.restoreStatus ||
    proof?.actorStatusAfterRestore !== scenario.restoreStatus ||
    staleProofLane?.id !== scenario.staleProofCheckId ||
    staleProofLane?.status !== "passed" ||
    staleProof?.rejectError !== scenario.staleRejectError ||
    staleProof?.staleLifecycle !== scenario.staleLifecycleLabel ||
    staleProof?.apiStatus !== scenario.lifecycleStatus ||
    staleProof?.actorStatus !== scenario.lifecycleStatus ||
    staleReloadLane?.id !== scenario.staleReloadProofCheckId ||
    staleReloadLane?.status !== "passed" ||
    staleReloadProof?.routeStatus !== scenario.staleReloadRouteStatus ||
    staleReloadProof?.lifecycle !== scenario.lifecycleLabel ||
    staleReloadProof?.apiStatus !== scenario.lifecycleStatus
  ) {
    throwHostPhaseScenarioAssertionError({
      message: "core-loop admin proof missing host modkill control surface",
      evidence: hostModkillControlSurface,
      includeEvidenceInError,
    });
  }
}

export function assertHostLifecycleRaceSurfaceCase({
  hostLifecycleRaceSurface,
  scenario = hostLifecycleRaceScenarioDefinition,
  includeEvidenceInError = false,
}) {
  const raceLane = hostLifecycleRaceSurface?.hostLifecycleRace;
  const reloadLane = hostLifecycleRaceSurface?.hostLifecycleRaceReload;
  const race = raceLane?.evidence;
  const reload = reloadLane?.evidence;
  if (
    hostLifecycleRaceSurface?.status !== "passed" ||
    hostLifecycleRaceSurface.proofCheckId !== scenario.proofCheckId ||
    hostLifecycleRaceSurface.reloadProofCheckId !== scenario.reloadProofCheckId ||
    raceLane?.id !== scenario.proofCheckId ||
    raceLane?.status !== "passed" ||
    race?.ackRaceRole !== scenario.ackRaceRole ||
    race?.rejectRaceRole !== scenario.rejectRaceRole ||
    race?.ackActionId !== scenario.ackActionId ||
    race?.rejectActionId !== scenario.rejectActionId ||
    typeof race?.game !== "string" ||
    race.game.length === 0 ||
    race?.winningStatus !== scenario.winningStatus ||
    race?.rejectError !== scenario.rejectError ||
    race?.apiStatus !== scenario.apiStatus ||
    reloadLane?.id !== scenario.reloadProofCheckId ||
    reloadLane?.status !== "passed" ||
    reload?.game !== race.game ||
    reload?.winningStatus !== scenario.winningStatus ||
    reload?.deadRouteStatus !== scenario.deadRouteStatus ||
    reload?.modkillRouteStatus !== scenario.modkillRouteStatus ||
    reload?.playerRouteStatus !== scenario.playerRouteStatus ||
    reload?.deadLifecycleLabel !== scenario.deadLifecycleLabel ||
    reload?.modkillLifecycleLabel !== scenario.modkillLifecycleLabel ||
    reload?.playerStatus !== scenario.playerStatus ||
    reload?.apiStatus !== scenario.apiStatus
  ) {
    throwHostPhaseScenarioAssertionError({
      message: "core-loop admin proof missing host lifecycle race surface",
      evidence: hostLifecycleRaceSurface,
      includeEvidenceInError,
    });
  }
}

export function assertHostPublishRaceSurfaceCase({
  hostPublishRaceSurface,
  scenario = hostPublishRaceScenarioDefinition,
  includeEvidenceInError = false,
}) {
  const raceLane = hostPublishRaceSurface?.hostPublishRace;
  const reloadLane = hostPublishRaceSurface?.hostPublishRaceReload;
  const race = raceLane?.evidence;
  const reload = reloadLane?.evidence;
  if (
    hostPublishRaceSurface?.status !== "passed" ||
    hostPublishRaceSurface.proofCheckId !== scenario.proofCheckId ||
    hostPublishRaceSurface.reloadProofCheckId !== scenario.reloadProofCheckId ||
    raceLane?.id !== scenario.proofCheckId ||
    raceLane?.status !== "passed" ||
    typeof race?.game !== "string" ||
    race.game.length === 0 ||
    race?.targetSlot !== scenario.targetSlot ||
    race?.targetCount !== scenario.targetCount ||
    race?.ackRaceRole !== scenario.ackRaceRole ||
    race?.rejectRaceRole !== scenario.rejectRaceRole ||
    race?.ackState !== scenario.ackState ||
    race?.rejectError !== scenario.rejectError ||
    race?.apiOfficialPostCount !== scenario.apiOfficialPostCount ||
    race?.playerOfficialPostCount !== scenario.playerOfficialPostCount ||
    reloadLane?.id !== scenario.reloadProofCheckId ||
    reloadLane?.status !== "passed" ||
    reload?.firstHostRouteStatus !== scenario.firstHostRouteStatus ||
    reload?.secondHostRouteStatus !== scenario.secondHostRouteStatus ||
    reload?.playerRouteStatus !== scenario.playerRouteStatus ||
    reload?.apiOfficialPostCount !== scenario.apiOfficialPostCount ||
    reload?.playerOfficialPostCount !== scenario.playerOfficialPostCount
  ) {
    throwHostPhaseScenarioAssertionError({
      message: "core-loop admin proof missing host publish race surface",
      evidence: hostPublishRaceSurface,
      includeEvidenceInError,
    });
  }
}

export function assertHostResolveRaceSurfaceCase({
  hostResolveRaceSurface,
  scenario = hostResolveRaceScenarioDefinition,
  includeEvidenceInError = false,
}) {
  const raceLane = hostResolveRaceSurface?.hostResolveRace;
  const reloadLane = hostResolveRaceSurface?.hostResolveRaceReload;
  const race = raceLane?.evidence;
  const reload = reloadLane?.evidence;
  if (
    hostResolveRaceSurface?.status !== "passed" ||
    hostResolveRaceSurface.proofCheckId !== scenario.proofCheckId ||
    hostResolveRaceSurface.reloadProofCheckId !== scenario.reloadProofCheckId ||
    raceLane?.id !== scenario.proofCheckId ||
    raceLane?.status !== "passed" ||
    !scenario.allowedPageRoles.includes(race?.ackPageRole) ||
    !scenario.allowedPageRoles.includes(race?.rejectPageRole) ||
    race?.ackPageRole === race?.rejectPageRole ||
    typeof race?.game !== "string" ||
    race.game.length === 0 ||
    race?.ackState !== scenario.ackState ||
    race?.rejectError !== scenario.rejectError ||
    race?.lockedAfterRace !== scenario.lockedAfterRace ||
    race?.lockedAfterRestore !== scenario.lockedAfterRestore ||
    reloadLane?.id !== scenario.reloadProofCheckId ||
    reloadLane?.status !== "passed" ||
    reload?.game !== race.game ||
    reload?.liveRouteStatus !== scenario.liveRouteStatus ||
    reload?.concurrentRouteStatus !== scenario.concurrentRouteStatus ||
    reload?.livePhase?.id !== scenario.phaseId ||
    reload?.livePhase?.state !== scenario.phaseState ||
    reload?.livePhase?.locked !== scenario.phaseLocked ||
    reload?.concurrentPhase?.id !== scenario.phaseId ||
    reload?.concurrentPhase?.state !== scenario.phaseState ||
    reload?.concurrentPhase?.locked !== scenario.phaseLocked ||
    reload?.apiLocked !== scenario.apiLocked
  ) {
    throwHostPhaseScenarioAssertionError({
      message: "core-loop admin proof missing host resolve race surface",
      evidence: hostResolveRaceSurface,
      includeEvidenceInError,
    });
  }
}

export function assertHostAdvanceRaceSurfaceCase({
  hostAdvanceRaceSurface,
  scenario = hostAdvanceRaceScenarioDefinition,
  includeEvidenceInError = false,
}) {
  const raceLane = hostAdvanceRaceSurface?.hostAdvanceRace;
  const reloadLane = hostAdvanceRaceSurface?.hostAdvanceRaceReload;
  const race = raceLane?.evidence;
  const reload = reloadLane?.evidence;
  if (
    hostAdvanceRaceSurface?.status !== "passed" ||
    hostAdvanceRaceSurface.proofCheckId !== scenario.proofCheckId ||
    hostAdvanceRaceSurface.reloadProofCheckId !== scenario.reloadProofCheckId ||
    raceLane?.id !== scenario.proofCheckId ||
    raceLane?.status !== "passed" ||
    !scenario.allowedPageRoles.includes(race?.ackPageRole) ||
    !scenario.allowedPageRoles.includes(race?.rejectPageRole) ||
    race?.ackPageRole === race?.rejectPageRole ||
    typeof race?.game !== "string" ||
    race.game.length === 0 ||
    race?.ackState !== scenario.ackState ||
    race?.rejectError !== scenario.rejectError ||
    race?.phaseAfterRace !== scenario.phaseAfterRace ||
    reloadLane?.id !== scenario.reloadProofCheckId ||
    reloadLane?.status !== "passed" ||
    reload?.game !== race.game ||
    reload?.liveRouteStatus !== scenario.liveRouteStatus ||
    reload?.concurrentRouteStatus !== scenario.concurrentRouteStatus ||
    reload?.livePhase?.id !== scenario.phaseId ||
    reload?.livePhase?.state !== scenario.phaseState ||
    reload?.livePhase?.locked !== scenario.phaseLocked ||
    reload?.concurrentPhase?.id !== scenario.phaseId ||
    reload?.concurrentPhase?.state !== scenario.phaseState ||
    reload?.concurrentPhase?.locked !== scenario.phaseLocked ||
    reload?.apiPhase !== scenario.apiPhase
  ) {
    throwHostPhaseScenarioAssertionError({
      message: "core-loop admin proof missing host advance race surface",
      evidence: hostAdvanceRaceSurface,
      includeEvidenceInError,
    });
  }
}

export function assertHostDeadlineAdvanceRaceSurfaceCase({
  hostDeadlineAdvanceRaceSurface,
  scenario = hostDeadlineAdvanceRaceScenarioDefinition,
  includeEvidenceInError = false,
}) {
  const raceLane = hostDeadlineAdvanceRaceSurface?.hostDeadlineAdvanceRace;
  const reloadLane =
    hostDeadlineAdvanceRaceSurface?.hostDeadlineAdvanceRaceReload;
  const race = raceLane?.evidence;
  const reload = reloadLane?.evidence;
  if (
    hostDeadlineAdvanceRaceSurface?.status !== "passed" ||
    hostDeadlineAdvanceRaceSurface.proofCheckId !== scenario.proofCheckId ||
    hostDeadlineAdvanceRaceSurface.reloadProofCheckId !==
      scenario.reloadProofCheckId ||
    raceLane?.id !== scenario.proofCheckId ||
    raceLane?.status !== "passed" ||
    !scenario.allowedPageRoles.includes(race?.ackPageRole) ||
    !scenario.allowedPageRoles.includes(race?.rejectPageRole) ||
    race?.ackPageRole === race?.rejectPageRole ||
    typeof race?.game !== "string" ||
    race.game.length === 0 ||
    race?.ackState !== scenario.ackState ||
    race?.rejectError !== scenario.rejectError ||
    race?.phaseAfterRace !== scenario.phaseAfterRace ||
    reloadLane?.id !== scenario.reloadProofCheckId ||
    reloadLane?.status !== "passed" ||
    reload?.game !== race.game ||
    reload?.liveRouteStatus !== scenario.liveRouteStatus ||
    reload?.concurrentRouteStatus !== scenario.concurrentRouteStatus ||
    reload?.livePhase?.id !== scenario.phaseId ||
    reload?.livePhase?.state !== scenario.phaseState ||
    reload?.livePhase?.locked !== scenario.phaseLocked ||
    reload?.concurrentPhase?.id !== scenario.phaseId ||
    reload?.concurrentPhase?.state !== scenario.phaseState ||
    reload?.concurrentPhase?.locked !== scenario.phaseLocked ||
    reload?.apiPhase !== scenario.apiPhase ||
    reload?.apiDeadline !== scenario.apiDeadline
  ) {
    throwHostPhaseScenarioAssertionError({
      message:
        "core-loop admin proof missing host deadline advance race surface",
      evidence: hostDeadlineAdvanceRaceSurface,
      includeEvidenceInError,
    });
  }
}

export function assertHostPhaseTransitionActionProofCase({
  proof,
  expectedGame,
  actionId,
  commandKind,
  streamSeq,
  expectedPhaseId,
  expectedPhaseState,
  expectedDeadlineAffordance = hostDeadlineAffordanceForPhaseState(
    expectedPhaseState,
  ),
  expectedRefreshKeys,
  includeEvidenceInError = false,
}) {
  if (
    proof?.status !== "passed" ||
    proof.clickedAction !== actionId ||
    proof.commandKind !== commandKind ||
    proof.command?.game !== expectedGame ||
    (commandKind === "ResolvePhase" && proof.command.seed !== 918273) ||
    proof.commandStatus?.state !== "ack" ||
    !proof.commandStatus?.message?.includes(`Ack: stream seqs ${streamSeq}`) ||
    proof.commandOutcome?.state !== "ack" ||
    !proof.commandOutcome?.message?.includes(`Ack: stream seqs ${streamSeq}`) ||
    proof.bridgePlan?.role !== "moderator" ||
    proof.bridgePlan.commandKind !== commandKind ||
    proof.bridgePlan.commandEndpoint !== "/commands" ||
    proof.bridgePlan.finalState !== "ack" ||
    !sameStringArray(proof.bridgePlan.projectionRefreshKeys, expectedRefreshKeys) ||
    proof.projection?.phase?.id !== expectedPhaseId ||
    proof.projection?.phase?.state !== expectedPhaseState ||
    proof.projection?.phase?.locked !==
      hostPhaseTransitionCaseForState(expectedPhaseState).locked ||
    proof.checkpointPhaseId !== expectedPhaseId ||
    proof.checkpointPhaseState !== expectedPhaseState ||
    proof.checkpointDeadlineAffordance !== expectedDeadlineAffordance ||
    !String(proof.activityStatusText ?? "")
      .toLowerCase()
      .includes(`ack: stream seqs ${streamSeq}`)
  ) {
    throwHostPhaseScenarioAssertionError({
      message: `core-loop admin proof missing host ${actionId} transition ACK`,
      evidence: proof,
      includeEvidenceInError,
    });
  }
}

export function assertHostStaleAdvanceAfterTransitionProofCase({
  proof,
  expectedGame,
  includeEvidenceInError = false,
}) {
  if (
    proof?.status !== "passed" ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    typeof proof.sourceRoleUrl !== "string" ||
    !proof.sourceRoleUrl.endsWith("/host") ||
    typeof proof.visitedRolePath !== "string" ||
    !proof.visitedRolePath.endsWith("/host") ||
    proof.surfaceTestId !== "host-console-surface" ||
    proof.setupResyncFromSeq !== 801 ||
    proof.setupSnapshotHost?.phase?.id !== "D02" ||
    proof.setupSnapshotHost?.phase?.state !== "locked" ||
    proof.clickedAction !== "advance_phase" ||
    proof.commandKind !== "AdvancePhase" ||
    proof.command?.game !== expectedGame ||
    proof.commandStatus?.state !== "reject" ||
    proof.commandStatus.error !== "InvalidTarget" ||
    !String(proof.commandStatus.message ?? "").includes(
      "stale phase state, refresh and use current controls",
    ) ||
    proof.commandOutcome?.state !== "reject" ||
    proof.commandOutcome.error !== "InvalidTarget" ||
    !String(proof.commandOutcome.message ?? "").includes(
      "stale phase state, refresh and use current controls",
    ) ||
    proof.bridgePlan?.role !== "moderator" ||
    proof.bridgePlan.commandKind !== "AdvancePhase" ||
    proof.bridgePlan.commandEndpoint !== "/commands" ||
    proof.bridgePlan.finalState !== "reject" ||
    !sameStringArray(proof.bridgePlan.projectionRefreshKeys, ["host"]) ||
    proof.projection?.phase?.id !== "N02" ||
    proof.projection?.phase?.state !== "open" ||
    proof.projection?.phase?.locked !== false ||
    proof.checkpointPhaseIdAfterReject !== "N02" ||
    proof.checkpointPhaseStateAfterReject !== "open" ||
    proof.checkpointDeadlineAffordanceAfterReject !==
      hostDeadlineAffordanceForPhaseState("open") ||
    !String(proof.activityStatusText ?? "")
      .toLowerCase()
      .includes("reject invalidtarget: invalid target")
  ) {
    throwHostPhaseScenarioAssertionError({
      message:
        "core-loop admin proof missing host stale advance recovery after transition",
      evidence: proof,
      includeEvidenceInError,
    });
  }
}

function throwHostPhaseScenarioAssertionError({
  message,
  evidence,
  includeEvidenceInError,
}) {
  if (includeEvidenceInError) {
    throw new Error(`${message}: ${JSON.stringify(evidence)}`);
  }
  throw new Error(message);
}

function sameStringArray(actual, expected) {
  return (
    Array.isArray(actual) &&
    Array.isArray(expected) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}
