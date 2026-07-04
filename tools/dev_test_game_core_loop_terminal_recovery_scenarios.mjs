export const terminalRecoveryCycleId = "d03-n03";
export const terminalRecoveryAdminCheckId = "core-loop";
export const terminalAdvanceRejectRecoveryHookId = "d03TerminalAdvanceReject";
export const terminalRecoveryBrowserScenarioDefinition = Object.freeze({
  expectedVotePrincipalUserId: "player-mira",
  expectedVoteActorSlot: "slot-7",
  expectedPhaseId: "D03",
  expectedOutcomeStatus: "NoMajority",
  expectedRejectError: "InvalidTarget",
  expectedPromptId: "D03:revote:NoMajority",
  expectedPromptLabel: "revote",
  expectedPromptValue: "no_majority",
});

const cloneCase = (scenario) => ({
  ...scenario,
  expectedCheckpointFields: { ...scenario.expectedCheckpointFields },
});

const cloneFeatureRow = (row) => ({ ...row });

const terminalRecoveryCheckpointCaseDefinitions = Object.freeze([
  Object.freeze({
    id: "day-three-terminal-boundary",
    targetKey: "dayThreeTerminalBoundary",
    featureSlotId: "day-three-terminal-boundary",
    role: "host",
    checkpointId: "d03-terminal-advance-reject",
    recoveryHookId: terminalAdvanceRejectRecoveryHookId,
    statusKind: "terminal-boundary",
    expectedCheckpointFields: Object.freeze({
      voteState: "ack",
      resolveState: "ack",
      outcomeStatus: "NoMajority",
      winnerSlot: null,
      targetAlive: true,
      targetStatus: "alive",
      advanceState: "reject",
      rejectError: "InvalidTarget",
      phase: "D03",
      locked: true,
      advanceControlVisible: true,
    }),
  }),
  Object.freeze({
    id: "day-three-terminal-recovery",
    targetKey: "dayThreeTerminalRecovery",
    featureSlotId: "day-three-terminal-recovery",
    role: "host",
    checkpointId: "d03-terminal-reload-recovery",
    recoveryHookId: terminalAdvanceRejectRecoveryHookId,
    statusKind: "terminal-recovery",
    expectedCheckpointFields: Object.freeze({
      routeResponseStatus: 200,
      phase: "D03",
      locked: true,
      outcomeStatus: "NoMajority",
      projectedCount: 1,
      advanceControlVisible: true,
      unlockControlVisible: true,
    }),
  }),
  Object.freeze({
    id: "day-three-stale-continue-policy-recovery",
    targetKey: "dayThreeStaleContinuePolicyRecovery",
    featureSlotId: "day-three-stale-continue-policy-recovery",
    role: "host",
    checkpointId: "d03r2-stale-continue-policy-recovery",
    statusKind: "stale-continue-policy-recovery",
    expectedCheckpointFields: Object.freeze({
      promptId: "D03R2:revote:NoMajority",
      setupPromptStatus: "pending",
      setupActionVisible: true,
      rejectState: "reject",
      rejectError: "PromptAlreadyResolved",
      promptStatusAfterReject: "resolved",
      promptActionVisibleAfterReject: false,
      reloadStatus: "passed",
      reloadPhase: "N03",
      reloadLocked: false,
      reloadResolveControlVisible: true,
      reloadStaleActionVisible: false,
      apiPromptStatusAfterReload: "resolved",
    }),
  }),
]);

export function terminalRecoveryCheckpointCases() {
  return terminalRecoveryCheckpointCaseDefinitions.map(cloneCase);
}

export function terminalRecoveryCheckpointCaseForId(id) {
  const scenario = terminalRecoveryCheckpointCaseDefinitions.find(
    (candidate) => candidate.id === id,
  );
  if (scenario === undefined) {
    throw new Error(`unknown terminal recovery checkpoint case: ${id}`);
  }
  return cloneCase(scenario);
}

export function terminalRecoveryFeatureSpineRows({
  cycleId = terminalRecoveryCycleId,
} = {}) {
  return terminalRecoveryCheckpointCaseDefinitions.map((scenario) =>
    cloneFeatureRow(featureRowFromCase(scenario, { cycleId })),
  );
}

export function terminalRecoveryBrowserScenario() {
  return { ...terminalRecoveryBrowserScenarioDefinition };
}

export function assertTerminalRecoveryBrowserProof({
  proof,
  scenario = terminalRecoveryBrowserScenarioDefinition,
  includeEvidenceInError = false,
}) {
  const submitVote =
    proof?.d03TerminalVoteSubmission?.requestEnvelope?.body?.body?.command
      ?.SubmitVote;
  const targetSlot = proof?.d03TerminalVoteTarget?.slotId;
  const checks = [
    [
      proof?.d03TerminalVoteSubmission?.state === "ack",
      "terminal vote did not ack",
    ],
    [
      proof?.d03TerminalVoteSubmission?.requestEnvelope?.body?.body
        ?.principal_user_id === scenario.expectedVotePrincipalUserId,
      "terminal vote principal mismatch",
    ],
    [
      submitVote?.actor_slot === scenario.expectedVoteActorSlot,
      "terminal vote actor slot mismatch",
    ],
    [
      submitVote?.target?.Slot === targetSlot,
      "terminal vote target mismatch",
    ],
    [
      proof?.d03TerminalPlayerAfterVote?.commandState?.currentVote?.slotId ===
        targetSlot,
      "terminal current vote target mismatch",
    ],
    [
      proof?.d03TerminalPlayerAfterVote?.currentVote?.hasVote === "true",
      "terminal current vote missing",
    ],
    [
      proof?.d03TerminalApiVoteRow?.count !== undefined,
      "terminal API vote row missing",
    ],
    [
      proof?.resolveD03?.commandStatus?.state === "ack",
      "terminal D03 resolve did not ack",
    ],
    [
      proof?.hostAfterResolveD03?.phase?.id === scenario.expectedPhaseId,
      "terminal host resolved phase mismatch",
    ],
    [
      proof?.hostAfterResolveD03?.phase?.locked === true,
      "terminal host resolved lock mismatch",
    ],
    [
      proof?.d03RevotePrompt?.id === scenario.expectedPromptId &&
        proof?.d03RevotePrompt?.label === scenario.expectedPromptLabel &&
        proof?.d03RevotePrompt?.status === "pending" &&
        proof?.d03RevotePrompt?.value === scenario.expectedPromptValue,
      "terminal revote prompt mismatch",
    ],
    [
      proof?.hostAfterResolveD03?.promptActions?.includes(
        proof?.d03RevotePromptActionId,
      ),
      "terminal revote prompt action missing",
    ],
    [
      proof?.d03TerminalDayVoteOutcome?.status ===
        scenario.expectedOutcomeStatus &&
        proof?.d03TerminalDayVoteOutcome?.winnerSlot === null &&
        proof?.d03TerminalDayVoteOutcome?.tallies?.[targetSlot] === 1,
      "terminal outcome mismatch",
    ],
    [
      proof?.d03TerminalResolvedSlot?.slot_id === targetSlot &&
        proof?.d03TerminalResolvedSlot?.alive === true &&
        proof?.d03TerminalResolvedSlot?.status === "alive",
      "terminal resolved slot mismatch",
    ],
    [
      proof?.d03TerminalAdvanceReject?.commandStatus?.state === "reject" &&
        proof?.d03TerminalAdvanceReject?.commandStatus?.error ===
          scenario.expectedRejectError,
      "terminal advance rejection mismatch",
    ],
    [
      proof?.hostAfterTerminalAdvanceReject?.phase?.id ===
        scenario.expectedPhaseId &&
        proof?.hostAfterTerminalAdvanceReject?.phase?.locked === true,
      "terminal post-reject host phase mismatch",
    ],
    [
      proof?.hostAfterTerminalAdvanceReject?.phaseActions?.includes(
        "advance_phase",
      ),
      "terminal post-reject advance control missing",
    ],
    [
      String(proof?.d03TerminalActivityStatusText ?? "").includes(
        "Reject InvalidTarget",
      ) &&
        String(proof?.d03TerminalActivityStatusText ?? "").includes(
          "stale phase state",
        ),
      "terminal rejection receipt text mismatch",
    ],
    [
      proof?.d03TerminalActivityRow?.source === "outcome" &&
        proof?.d03TerminalActivityRow?.actionId === "advance_phase" &&
        proof?.d03TerminalActivityRow?.dispatchKind === "advance_phase",
      "terminal rejection activity row mismatch",
    ],
    [
      proof?.d03TerminalDispatchPlan?.projectionRefreshKeys?.includes("host"),
      "terminal rejection refresh keys missing host",
    ],
    [
      phaseId(proof?.d03TerminalApiHostStateAfterReject?.phase) ===
        scenario.expectedPhaseId &&
        proof?.d03TerminalApiHostStateAfterReject?.phase?.locked === true,
      "terminal API host state mismatch",
    ],
    [
      proof?.d03TerminalHostReloadAfterReject?.routeResponseStatus === 200,
      "terminal reload response mismatch",
    ],
    [
      proof?.d03TerminalHostReloadAfterReject?.phase?.id ===
        scenario.expectedPhaseId &&
        proof?.d03TerminalHostReloadAfterReject?.phase?.locked === true,
      "terminal reload phase mismatch",
    ],
    [
      proof?.d03TerminalHostReloadAfterReject?.phaseActions?.includes(
        "advance_phase",
      ) &&
        proof?.d03TerminalHostReloadAfterReject?.phaseActions?.includes(
          "unlock_thread",
        ) &&
        !proof?.d03TerminalHostReloadAfterReject?.phaseActions?.includes(
          "resolve_phase",
        ),
      "terminal reload controls mismatch",
    ],
    [
      promptStatus(
        proof?.d03TerminalHostReloadAfterReject?.hostPrompts,
        proof?.d03RevotePrompt?.id,
      ) === "pending",
      "terminal reload prompt status mismatch",
    ],
    [
      proof?.d03TerminalHostReloadAfterReject?.promptActions?.includes(
        proof?.d03RevotePromptActionId,
      ),
      "terminal reload prompt action missing",
    ],
    [
      proof?.d03TerminalHostReloadAfterReject?.dayVoteOutcomes?.some(
        (row) =>
          row.phaseId === scenario.expectedPhaseId &&
          row.status === scenario.expectedOutcomeStatus &&
          row.winnerSlot === null &&
          row.tallies?.[targetSlot] === 1,
      ),
      "terminal reload outcome missing",
    ],
    [
      String(proof?.d03TerminalHostReloadAfterReject?.outcomePanel ?? "").includes(
        "D03 NoMajority",
      ),
      "terminal reload outcome panel mismatch",
    ],
    [
      phaseId(proof?.d03TerminalHostReloadAfterReject?.apiPhase) ===
        scenario.expectedPhaseId &&
        proof?.d03TerminalHostReloadAfterReject?.apiPhase?.locked === true,
      "terminal reload API phase mismatch",
    ],
  ];
  for (const [passed, message] of checks) {
    if (!passed) {
      throwTerminalRecoveryAssertionError({
        message,
        evidence: proof,
        includeEvidenceInError,
      });
    }
  }
}

export function terminalRecoveryCompactStatus(cycle) {
  const terminal = checkpointById(
    cycle,
    terminalRecoveryCheckpointCaseForId("day-three-terminal-boundary")
      .checkpointId,
  );
  const terminalReload = checkpointById(
    cycle,
    terminalRecoveryCheckpointCaseForId("day-three-terminal-recovery")
      .checkpointId,
  );
  return `terminal advance ${String(terminal?.rejectError ?? "unknown")}, reload ${String(terminalReload?.phase ?? "unknown")}`;
}

export function assertTerminalRecoveryCheckpointEvidence({
  cycle,
  recoveryHooks,
  includeEvidenceInError = false,
}) {
  if (cycle?.id !== terminalRecoveryCycleId) {
    throwTerminalRecoveryAssertionError({
      message: "terminal recovery cycle id mismatch",
      evidence: cycle,
      includeEvidenceInError,
    });
  }
  if (recoveryHooks?.[terminalAdvanceRejectRecoveryHookId] !== "InvalidTarget") {
    throwTerminalRecoveryAssertionError({
      message: "terminal recovery hook mismatch",
      evidence: recoveryHooks,
      includeEvidenceInError,
    });
  }
  for (const scenario of terminalRecoveryCheckpointCaseDefinitions) {
    const checkpoint = checkpointById(cycle, scenario.checkpointId);
    if (checkpoint === null) {
      throwTerminalRecoveryAssertionError({
        message: `terminal recovery missing checkpoint ${scenario.checkpointId}`,
        evidence: cycle,
        includeEvidenceInError,
      });
    }
    for (const [field, expectedValue] of Object.entries(
      scenario.expectedCheckpointFields,
    )) {
      if (checkpoint[field] !== expectedValue) {
        throwTerminalRecoveryAssertionError({
          message: `terminal recovery checkpoint ${scenario.checkpointId} expected ${field}`,
          evidence: checkpoint,
          includeEvidenceInError,
        });
      }
    }
  }
}

function featureRowFromCase(scenario, { cycleId }) {
  return Object.freeze({
    targetKey: scenario.targetKey,
    featureSlotId: scenario.featureSlotId,
    cycleId,
    role: scenario.role,
    checkpointId: `${cycleId}-${scenario.checkpointId}`,
    ...(scenario.recoveryHookId === undefined
      ? {}
      : { recoveryHookId: scenario.recoveryHookId }),
    adminCheckId: terminalRecoveryAdminCheckId,
  });
}

function checkpointById(cycle, id) {
  return cycle?.checkpoints?.find((checkpoint) => checkpoint.id === id) ?? null;
}

function phaseId(phase) {
  return phase?.id ?? phase?.phase_id;
}

function promptStatus(prompts, promptId) {
  return Array.isArray(prompts)
    ? prompts.find((prompt) => (prompt.id ?? prompt.prompt_id) === promptId)
        ?.status
    : undefined;
}

function throwTerminalRecoveryAssertionError({
  message,
  evidence,
  includeEvidenceInError,
}) {
  if (includeEvidenceInError) {
    throw new Error(`${message}: ${JSON.stringify(evidence)}`);
  }
  throw new Error(message);
}
