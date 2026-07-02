const cloneCommandFacts = (facts) => ({ ...facts });
const cloneLifecycleScenario = (scenario) => ({
  ...scenario,
  visibleRows: [...scenario.visibleRows],
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

export function assertHostLifecycleControlRoleSurfaceCase({
  hostRoleSurface,
  expectedGame,
  includeEvidenceInError = false,
}) {
  const scenario = hostLifecycleControlScenarioDefinition;
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
    includeEvidenceInError,
  });
  assertHostLifecycleStaleRejectProofCase({
    staleRejectProof,
    expectedGame,
    includeEvidenceInError,
  });
}

export function assertHostLifecycleControlClickProofCase({
  clickProof,
  expectedGame,
  includeEvidenceInError = false,
}) {
  const scenario = hostLifecycleControlScenarioDefinition;
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
  includeEvidenceInError = false,
}) {
  const scenario = hostLifecycleControlScenarioDefinition;
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
