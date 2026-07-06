import {
  playerActionLoopLaneId,
  playerInvalidActionRecoveryHookId,
  playerInvalidActionRecoveryLaneId,
  playerInvalidActionRecoveryMessage,
  playerInvalidActionRecoveryScenario,
  playerStaleActionTransitionRecoveryFeatureSlotId,
  playerStaleActionTransitionRecoveryHookId,
  playerStaleActionTransitionRecoveryMessage,
  playerStaleVoteTransitionRecoveryFeatureSlotId,
  playerStaleVoteTransitionRecoveryHookId,
  playerStaleVoteTransitionRecoveryMessage,
} from "./dev_test_game_core_loop_action_scenario_cases.mjs";

export const privateChannelInvalidActionRecoveryLaneId =
  "private-channel-invalid-action-recovery";
export const completedGameStaleRecoverySummaryId =
  "completed-game-stale-recovery";

export function hostVisibleRecoverySummaryCases() {
  return Object.freeze([
    Object.freeze({
      id: playerInvalidActionRecoveryLaneId,
      label: "Invalid action recovery",
      group: "invalid-action",
      adminCheckId: playerInvalidActionRecoveryLaneId,
      recoveryHookId: playerInvalidActionRecoveryHookId,
    }),
    ...hostVisibleStaleTransitionRecoveryCases().map((recoveryCase) =>
      Object.freeze({
        id: recoveryCase.id,
        label: recoveryCase.label,
        group: "stale-transition",
        adminCheckId: recoveryCase.adminCheckId,
        recoveryHookId: recoveryCase.recoveryHookId,
      }),
    ),
    Object.freeze({
      id: privateChannelInvalidActionRecoveryLaneId,
      label: "Private channel invalid action recovery",
      group: "private-channel",
      adminCheckId: privateChannelInvalidActionRecoveryLaneId,
      recoveryHookId: playerInvalidActionRecoveryHookId,
    }),
    Object.freeze({
      id: completedGameStaleRecoverySummaryId,
      label: "Completed-game stale command recovery",
      group: "completed-game",
      adminCheckId: "stale-host-complete-reload",
      recoveryHookId: "gameCompleted",
    }),
  ]);
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

export function hostVisibleStaleTransitionRecoveryCases() {
  return [
    {
      id: playerStaleActionTransitionRecoveryFeatureSlotId,
      label: "Stale action transition recovery",
      adminCheckId: playerActionLoopLaneId,
      recoveryHookId: playerStaleActionTransitionRecoveryHookId,
      commandKind: "SubmitAction",
      clickedAction: "submit_action:factional_kill",
      messageIncludes: playerStaleActionTransitionRecoveryMessage,
      refreshedPhaseId: "D05",
      refreshedActionState: "disabled:no legal action available",
      sourceSurfaceField: "postNightFourTransitionSurface",
      nestedProofField: "staleNightFourActionRecoveryProof",
      sourceHostRoleUrlField: "sourceHostRoleUrl",
      sourceActionPlayerRoleUrlField: "sourceActionPlayerRoleUrl",
      roleUrlId: "d04-n04-d05-actionPlayer",
      hostRoleUrlId: "d04-n04-d05-host",
    },
    {
      id: playerStaleVoteTransitionRecoveryFeatureSlotId,
      label: "Stale vote transition recovery",
      adminCheckId: playerActionLoopLaneId,
      recoveryHookId: playerStaleVoteTransitionRecoveryHookId,
      commandKind: "SubmitVote",
      clickedAction: "submit_vote:no_lynch",
      messageIncludes: playerStaleVoteTransitionRecoveryMessage,
      refreshedPhaseId: "N05",
      refreshedActionState: "disabled:no legal action available",
      sourceSurfaceField: "dayFiveNoLynchResolutionSurface",
      nestedProofField: "staleDayFiveVoteRecoveryProof",
      sourceHostRoleUrlField: "sourceHostRoleUrl",
      sourceActionPlayerRoleUrlField: "sourceActionPlayerRoleUrl",
      roleUrlId: "d05-n05-actionPlayer",
      hostRoleUrlId: "d05-n05-host",
    },
  ].map((recoveryCase) => Object.freeze({ ...recoveryCase }));
}

export function buildHostVisibleStaleTransitionRecoverySummaries({
  proofRun,
  coreLoopSpineRows,
  adminRoleSurface,
  proofSurfaces,
  detailRoleUrl,
} = {}) {
  const roleUrlHrefs = {
    ...roleUrlHrefsFromProofRun(proofRun),
    ...roleUrlHrefsFromSpineRows(coreLoopSpineRows),
  };
  return Object.freeze(
    hostVisibleStaleTransitionRecoveryCases().map((recoveryCase) =>
      buildHostVisibleStaleTransitionRecoverySummary({
        recoveryCase,
        proofRun,
        roleUrlHrefs,
        adminRoleSurface,
        proofSurfaces,
        detailRoleUrl,
      }),
    ),
  );
}

export function assertHostVisibleStaleTransitionRecoverySummaries({
  summaries,
  requireBrowserProof = false,
  requireRecoveryHookVisible = false,
  includeEvidenceInError = false,
} = {}) {
  const summariesById = new Map(
    (Array.isArray(summaries) ? summaries : []).map((summary) => [
      summary?.id,
      summary,
    ]),
  );
  return Object.freeze(
    hostVisibleStaleTransitionRecoveryCases().map((recoveryCase) =>
      assertHostVisibleStaleTransitionRecoverySummary({
        summary: summariesById.get(recoveryCase.id),
        recoveryCase,
        requireBrowserProof,
        requireRecoveryHookVisible,
        includeEvidenceInError,
      }),
    ),
  );
}

function buildHostVisibleStaleTransitionRecoverySummary({
  recoveryCase,
  proofRun,
  roleUrlHrefs,
  adminRoleSurface,
  proofSurfaces,
  detailRoleUrl,
}) {
  const sourceSurface = proofSurfaces?.[recoveryCase.sourceSurfaceField];
  const browserProof = sourceSurface?.[recoveryCase.nestedProofField] ?? null;
  const recoveryHookStatus = String(
    proofRun?.coreLoopSpine?.recoveryHooks?.[recoveryCase.recoveryHookId] ?? "",
  );
  const commandStatus =
    browserProof?.commandStatus !== null &&
    typeof browserProof?.commandStatus === "object"
      ? browserProof.commandStatus
      : {};
  const receiptStatusText = String(
    browserProof?.receiptStatusText ?? commandStatus.message ?? "",
  );
  const refreshedPhaseId = String(
    browserProof?.projectionCommandState?.phase?.phaseId ??
      recoveryCase.refreshedPhaseId,
  );
  const checkpointActionState = String(
    browserProof?.checkpointActionStateAfterReject ??
      recoveryCase.refreshedActionState,
  );
  const browserProofPassed =
    browserProof?.status === "passed" &&
    browserProof.clickedAction === recoveryCase.clickedAction &&
    browserProof.commandKind === recoveryCase.commandKind &&
    commandStatus.state === "reject" &&
    commandStatus.error === "PhaseLocked" &&
    receiptStatusText.includes(recoveryCase.messageIncludes) &&
    refreshedPhaseId === recoveryCase.refreshedPhaseId &&
    checkpointActionState === recoveryCase.refreshedActionState;
  const visibleRecoveryHook = (
    Array.isArray(adminRoleSurface?.visibleSpineRecoveryHooks)
      ? adminRoleSurface.visibleSpineRecoveryHooks
      : []
  ).includes(recoveryCase.recoveryHookId);
  const hostRoleUrl = String(
    sourceSurface?.[recoveryCase.sourceHostRoleUrlField] ??
      roleUrlHrefs[recoveryCase.hostRoleUrlId] ??
      firstRoleUrl(roleUrlHrefs, "host") ??
      "",
  );
  const actionPlayerRoleUrl = String(
    sourceSurface?.[recoveryCase.sourceActionPlayerRoleUrlField] ??
      roleUrlHrefs[recoveryCase.roleUrlId] ??
      firstRoleUrl(roleUrlHrefs, "actionPlayer") ??
      "",
  );
  return Object.freeze({
    id: recoveryCase.id,
    label: recoveryCase.label,
    status:
      recoveryHookStatus === "PhaseLocked" &&
      hostRoleUrl.includes("/host") &&
      actionPlayerRoleUrl.includes("/g/") &&
      (browserProof === null || browserProofPassed)
        ? "passed"
        : "failed",
    adminCheckId: recoveryCase.adminCheckId,
    recoveryHookId: recoveryCase.recoveryHookId,
    recoveryHookStatus,
    commandKind: recoveryCase.commandKind,
    clickedAction: recoveryCase.clickedAction,
    rejectError: String(commandStatus.error ?? "PhaseLocked"),
    receiptStatusText:
      receiptStatusText === ""
        ? `Reject PhaseLocked: phase locked; ${recoveryCase.messageIncludes}`
        : receiptStatusText,
    refreshedPhaseId,
    checkpointActionStateAfterReject: checkpointActionState,
    browserProofStatus: String(browserProof?.status ?? ""),
    browserProofPassed,
    visibleRecoveryHook,
    hostRoleUrl,
    actionPlayerRoleUrl,
    sourceRoleUrl: actionPlayerRoleUrl,
    visitedRolePath: visitedRolePathFromRoleUrl(actionPlayerRoleUrl),
    detailRoleUrl: String(
      detailRoleUrl ?? adminRoleSurface?.detailRoleUrl ?? "",
    ),
    proofBoundary:
      "Host-visible local core-loop stale transition recovery summary: the seeded admin detail names the recovery hook, host URL, action-player URL, stale command reject receipt, and refreshed current controls.",
  });
}

function assertHostVisibleStaleTransitionRecoverySummary({
  summary,
  recoveryCase,
  requireBrowserProof,
  requireRecoveryHookVisible,
  includeEvidenceInError,
}) {
  const failure =
    summary?.status !== "passed" ||
    summary.id !== recoveryCase.id ||
    summary.adminCheckId !== recoveryCase.adminCheckId ||
    summary.recoveryHookId !== recoveryCase.recoveryHookId ||
    summary.recoveryHookStatus !== "PhaseLocked" ||
    summary.commandKind !== recoveryCase.commandKind ||
    summary.clickedAction !== recoveryCase.clickedAction ||
    summary.rejectError !== "PhaseLocked" ||
    !String(summary.receiptStatusText ?? "").includes(
      recoveryCase.messageIncludes,
    ) ||
    !String(summary.hostRoleUrl ?? "").includes("/g/") ||
    !String(summary.hostRoleUrl ?? "").includes("/host") ||
    !String(summary.actionPlayerRoleUrl ?? "").includes("/g/") ||
    !String(summary.detailRoleUrl ?? "").includes("/admin/audit/") ||
    (requireBrowserProof &&
      (summary.browserProofStatus !== "passed" ||
        summary.browserProofPassed !== true ||
        summary.refreshedPhaseId !== recoveryCase.refreshedPhaseId ||
        summary.checkpointActionStateAfterReject !==
          recoveryCase.refreshedActionState)) ||
    (requireRecoveryHookVisible && summary.visibleRecoveryHook !== true);
  if (failure) {
    throw new Error(
      includeEvidenceInError
        ? `core-loop proof missing host-visible stale transition recovery summary: ${JSON.stringify(summary)}`
        : "core-loop proof missing host-visible stale transition recovery summary",
    );
  }
  return summary;
}

function roleUrlHrefsFromSpineRows(coreLoopSpineRows) {
  if (
    coreLoopSpineRows?.roleUrlHrefs !== null &&
    typeof coreLoopSpineRows?.roleUrlHrefs === "object"
  ) {
    return coreLoopSpineRows.roleUrlHrefs;
  }
  return {};
}

function roleUrlHrefsFromProofRun(proofRun) {
  const cycles = Array.isArray(proofRun?.coreLoopSpine?.cycles)
    ? proofRun.coreLoopSpine.cycles
    : [];
  return Object.fromEntries(
    cycles.flatMap((cycle) => {
      const cycleId = String(cycle?.id ?? "");
      const roleUrls =
        cycle?.roleUrls !== null && typeof cycle?.roleUrls === "object"
          ? cycle.roleUrls
          : {};
      return Object.entries(roleUrls).map(([role, href]) => [
        `${cycleId}-${String(role)}`,
        String(href ?? ""),
      ]);
    }),
  );
}

function firstRoleUrl(roleUrlHrefs, role) {
  return Object.entries(roleUrlHrefs).find(
    ([id, href]) =>
      id.endsWith(`-${role}`) &&
      typeof href === "string" &&
      href.includes("/g/"),
  )?.[1];
}

function visitedRolePathFromRoleUrl(roleUrl) {
  if (typeof roleUrl !== "string" || roleUrl.trim() === "") {
    return "";
  }
  try {
    const parsed = new URL(roleUrl);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return "";
  }
}
