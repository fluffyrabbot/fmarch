export const playerActionLoopLaneId = "action-loop";
export const playerInvalidActionRecoveryLaneId = "invalid-action-recovery";
export const playerInvalidActionRecoveryHookId = "invalidActionReject";
export const playerInvalidActionRecoveryMessage =
  "Reject InvalidTarget: invalid target; action target is no longer valid, refresh and use current action controls";
export const playerActionBoundaryLaneId = "player-action-boundary";
export const playerActionBoundaryRecoveryHookId =
  "normalPlayerDirectActionReject";
export const playerStaleVoteTransitionRecoveryFeatureSlotId =
  "stale-vote-transition-recovery";
export const playerStaleActionTransitionRecoveryFeatureSlotId =
  "stale-action-transition-recovery";
export const playerStaleVoteTransitionRecoveryHookId =
  "staleVoteTransitionReject";
export const playerStaleActionTransitionRecoveryHookId =
  "staleActionTransitionReject";

export function invalidActionRecoveryFeatureSpineRow({ cycleId }) {
  return {
    targetKey: "invalidActionRecovery",
    featureSlotId: playerInvalidActionRecoveryLaneId,
    cycleId,
    role: "actionPlayer",
    checkpointId: `${cycleId}-n02-action-open`,
    recoveryHookId: playerInvalidActionRecoveryHookId,
    adminCheckId: playerInvalidActionRecoveryLaneId,
  };
}

export function staleVoteTransitionRecoveryFeatureSpineRow({ cycleId }) {
  return {
    targetKey: "staleVoteTransitionRecovery",
    featureSlotId: playerStaleVoteTransitionRecoveryFeatureSlotId,
    cycleId,
    role: "actionPlayer",
    checkpointId: `${cycleId}-n02-action-open`,
    recoveryHookId: playerStaleVoteTransitionRecoveryHookId,
    adminCheckId: playerActionLoopLaneId,
  };
}

export function staleActionTransitionRecoveryFeatureSpineRow({ cycleId }) {
  return {
    targetKey: "staleActionTransitionRecovery",
    featureSlotId: playerStaleActionTransitionRecoveryFeatureSlotId,
    cycleId,
    role: "actionPlayer",
    checkpointId: `${cycleId}-n01-action-open`,
    recoveryHookId: playerStaleActionTransitionRecoveryHookId,
    adminCheckId: playerActionLoopLaneId,
  };
}

export function playerActionSubmissionScenario() {
  return {
    clickedAction: "submit_action:factional_kill",
    commandKind: "SubmitAction",
    commandSelector: "SubmitAction",
    commandButtonSelector:
      '[data-testid="player-action-commands"] button[data-action="submit_action:factional_kill"]',
    actionId: "factional_kill",
    actorSlot: "slot-7",
    templateId: "factional_kill",
    targetSlot: "slot-3",
    grantId: "grant-factional-kill",
    streamSeq: 501,
    finalState: "ack",
    expectedRefreshKeys: [
      "notifications",
      "investigationResults",
      "commandState",
    ],
    refreshedPhaseId: "N02",
    checkpointActionState: "disabled:no legal action available",
  };
}

export function playerSlotVoteCommandFacts({
  actorSlot = "slot-7",
  targetSlot = "slot-2",
} = {}) {
  return {
    actorSlot,
    targetSlot,
    commandActionPrefix: "submit_vote",
    commandKind: "SubmitVote",
  };
}

export function playerFactionalKillActionCommandFacts({
  actorSlot = playerActionSubmissionScenario().actorSlot,
  targetSlot = playerActionSubmissionScenario().targetSlot,
  actionId = playerActionSubmissionScenario().actionId,
  phaseId,
} = {}) {
  const scenario = playerActionSubmissionScenario();
  return {
    actorSlot,
    targetSlot,
    actionId,
    commandAction: scenario.clickedAction,
    commandKind: scenario.commandKind,
    templateId: scenario.templateId,
    ...(phaseId === undefined ? {} : { phaseId }),
  };
}

export function playerInvalidActionRecoveryScenario() {
  return {
    clickedAction: "submit_invalid_action:factional_kill",
    commandKind: "SubmitAction",
    commandSelector: "SubmitAction",
    commandButtonSelector:
      '[data-testid="player-action-commands"] button[data-action="submit_invalid_action:factional_kill"]',
    actionId: "invalid_self_factional_kill",
    actorSlot: "slot-7",
    templateId: "factional_kill",
    targetSlot: "slot-7",
    grantId: "grant-factional-kill",
    finalState: "reject",
    error: "InvalidTarget",
    messageIncludes: playerInvalidActionRecoveryMessage,
    expectedRefreshKeys: [
      "notifications",
      "investigationResults",
      "commandState",
    ],
    refreshedPhaseId: "N02",
    refreshedActionTemplateId: "factional_kill",
    checkpointReceiptState: "reject:InvalidTarget",
    checkpointActionState: "enabled:submit_action:factional_kill",
    checkpointTargetSlots: "slot-3",
    recoveryHookId: playerInvalidActionRecoveryHookId,
  };
}

export function buildHostVisibleInvalidActionRecoverySummary({
  proofRun,
  coreLoopSpineRows,
  adminRoleSurface,
  detailRoleUrl,
} = {}) {
  const scenario = playerInvalidActionRecoveryScenario();
  const lane =
    (Array.isArray(proofRun?.lanes) ? proofRun.lanes : []).find(
      (candidate) => candidate?.id === playerInvalidActionRecoveryLaneId,
    ) ?? null;
  const laneEvidence =
    lane?.evidence !== null && typeof lane?.evidence === "object"
      ? lane.evidence
      : {};
  const roleUrlHrefs =
    coreLoopSpineRows?.roleUrlHrefs !== null &&
    typeof coreLoopSpineRows?.roleUrlHrefs === "object"
      ? coreLoopSpineRows.roleUrlHrefs
      : {};
  const defaultCycle =
    (Array.isArray(proofRun?.coreLoopSpine?.cycles)
      ? proofRun.coreLoopSpine.cycles
      : []
    ).find((cycle) => cycle?.id === "d02-n02") ?? null;
  const defaultCycleRoleUrls =
    defaultCycle?.roleUrls !== null && typeof defaultCycle?.roleUrls === "object"
      ? defaultCycle.roleUrls
      : {};
  const rejectError = String(
    laneEvidence.reject?.error ??
      laneEvidence.rejectError ??
      laneEvidence.error ??
      "",
  );
  const receiptStatusText = String(
    laneEvidence.receiptStatusText ??
      laneEvidence.currentReceipt?.message ??
      laneEvidence.reject?.message ??
      "",
  );
  const legalActionVisible =
    laneEvidence.legalActionVisible === true ||
    laneEvidence.legalActionVisibleAfterReject === true;
  const recoveryHookStatus = String(
    proofRun?.coreLoopSpine?.recoveryHooks?.[scenario.recoveryHookId] ?? "",
  );
  const visibleStatus = String(
    adminRoleSurface?.visibleCheckStatuses?.[
      playerInvalidActionRecoveryLaneId
    ] ?? "",
  );
  const status =
    lane?.status === "passed" &&
    rejectError === scenario.error &&
    receiptStatusText.includes(scenario.messageIncludes) &&
    legalActionVisible &&
    recoveryHookStatus === scenario.error
      ? "passed"
      : "failed";
  return Object.freeze({
    status,
    laneId: playerInvalidActionRecoveryLaneId,
    adminCheckId: playerInvalidActionRecoveryLaneId,
    recoveryHookId: scenario.recoveryHookId,
    recoveryHookStatus,
    rejectError,
    receiptStatusText,
    legalActionVisible,
    hostRoleUrl: String(
      roleUrlHrefs["d02-n02-host"] ?? defaultCycleRoleUrls.host ?? "",
    ),
    actionPlayerRoleUrl: String(
      roleUrlHrefs["d02-n02-actionPlayer"] ??
        defaultCycleRoleUrls.actionPlayer ??
        "",
    ),
    detailRoleUrl: String(
      detailRoleUrl ?? adminRoleSurface?.detailRoleUrl ?? "",
    ),
    visibleStatus,
    proofBoundary:
      "Host-visible local core-loop invalid-action recovery summary: the seeded admin detail names the invalid-action check, recovery hook, host URL, action-player URL, reject receipt, and restored legal action controls.",
  });
}

export function assertHostVisibleInvalidActionRecoverySummary({
  summary,
  requireVisibleStatus = false,
  includeEvidenceInError = false,
} = {}) {
  const scenario = playerInvalidActionRecoveryScenario();
  const visibleStatus = String(summary?.visibleStatus ?? "");
  const failure =
    summary?.status !== "passed" ||
    summary.laneId !== playerInvalidActionRecoveryLaneId ||
    summary.adminCheckId !== playerInvalidActionRecoveryLaneId ||
    summary.recoveryHookId !== scenario.recoveryHookId ||
    summary.recoveryHookStatus !== scenario.error ||
    summary.rejectError !== scenario.error ||
    !String(summary.receiptStatusText ?? "").includes(
      scenario.messageIncludes,
    ) ||
    summary.legalActionVisible !== true ||
    !String(summary.hostRoleUrl ?? "").includes("/g/") ||
    !String(summary.hostRoleUrl ?? "").includes("/host") ||
    !String(summary.actionPlayerRoleUrl ?? "").includes("/g/") ||
    !String(summary.detailRoleUrl ?? "").includes("/admin/audit/") ||
    (requireVisibleStatus &&
      (!visibleStatus.includes(scenario.messageIncludes) ||
        !visibleStatus.includes("legal action visible true")));
  if (failure) {
    throw new Error(
      includeEvidenceInError
        ? `core-loop proof missing host-visible invalid-action recovery summary: ${JSON.stringify(summary)}`
        : "core-loop proof missing host-visible invalid-action recovery summary",
    );
  }
  return summary;
}

export function staleNightFourActionRecoveryScenario() {
  return {
    clickedAction: "submit_action:factional_kill",
    commandKind: "SubmitAction",
    commandSelector: "SubmitAction",
    commandButtonSelector:
      '[data-testid="player-action-commands"] button[data-action="submit_action:factional_kill"]',
    actionId: "factional_kill",
    actorSlot: "slot-7",
    templateId: "factional_kill",
    targetSlot: "slot-5",
    grantId: "grant-factional-kill-n04",
    setupResyncFromSeq: 916,
    setupPhaseId: "N04",
    finalState: "reject",
    error: "PhaseLocked",
    messageIncludes: "stale action state, refresh and use current action controls",
    expectedRefreshKeys: [
      "notifications",
      "investigationResults",
      "commandState",
      "dayVoteOutcomes",
    ],
    refreshedPhaseId: "D05",
    refreshedVoteTargetKind: "no_lynch",
    refreshedBoundary:
      "stale N04 action refreshed into current Day 5 controls",
    checkpointReceiptState: "reject:PhaseLocked",
    checkpointActionState: "disabled:no legal action available",
    checkpointTargetSlots: "",
  };
}

export function staleDayTwoVoteAfterTransitionRecoveryScenario() {
  return {
    clickedAction: "submit_vote",
    commandKind: "SubmitVote",
    actorSlot: "slot-7",
    targetSlot: "slot-2",
    setupResyncFromSeq: 801,
    setupPhaseId: "D02",
    finalState: "reject",
    error: "PhaseLocked",
    messageIncludes: "stale vote state, refresh and use current vote controls",
    expectedRefreshKeys: ["votecount", "commandState", "dayVoteOutcomes"],
    refreshedPhaseId: "N02",
    refreshedBoundary: "PhaseLocked recovery",
    checkpointReceiptState: "reject:PhaseLocked",
    checkpointActionState: "enabled:submit_action:factional_kill",
    checkpointTargetSlots: "slot-3",
    receiptCount: 1,
    receiptStatusTextIncludes: "stale vote state",
  };
}

export function staleNightOneActionAfterTransitionRecoveryScenario() {
  return {
    clickedAction: "submit_action:factional_kill",
    commandKind: "SubmitAction",
    actionId: "factional_kill",
    actorSlot: "slot-7",
    templateId: "factional_kill",
    targetSlot: "slot-3",
    finalState: "reject",
    error: "PhaseLocked",
    messageIncludes: "stale action state, refresh and use current action controls",
    expectedRefreshKeys: ["commandState"],
    refreshedPhaseId: "N02",
    refreshedBoundary: "PhaseLocked recovery",
    checkpointReceiptState: "reject:PhaseLocked",
    checkpointActionState: "enabled:submit_action:factional_kill",
    checkpointTargetSlots: "slot-3",
    receiptCount: 2,
    receiptStatusTextIncludes: "reject phaselocked: phase locked",
  };
}
