export const nightThreeDayFourCycleId = "n03-d04";
export const nightThreeActionResolutionLaneId =
  "night-three-action-resolution";
export const dayFourControlsReturnLaneId = "day-four-controls-return";
export const nightThreeProgressionAdminCheckId = "core-loop";
export const nightThreeProgressionActionId = "submit_action:factional_kill";

export const nightThreeProgressionBrowserScenarioDefinition = Object.freeze({
  actionId: nightThreeProgressionActionId,
  commandKind: "SubmitAction",
  templateId: "factional_kill",
  expectedPrincipalUserId: "player-goon-a",
  expectedActorSlot: "slot_4",
  expectedActionPhaseId: "N03",
  expectedDayPhaseId: "D04",
  expectedTargetSlot: "slot-7",
});

const cloneCase = (scenario) => ({
  ...scenario,
  expectedCheckpointFields: { ...scenario.expectedCheckpointFields },
});

const cloneFeatureRow = (row) => ({ ...row });

const nightThreeProgressionCheckpointCaseDefinitions = Object.freeze([
  Object.freeze({
    id: nightThreeActionResolutionLaneId,
    targetKey: "nightThreeActionResolution",
    featureSlotId: nightThreeActionResolutionLaneId,
    seedMembership: "required",
    seedOrder: 30,
    role: "host",
    checkpointId: "n03-resolved-target-killed",
    statusKind: "night-action-resolution",
    expectedCheckpointFields: Object.freeze({
      resolveState: "ack",
      phase: "N03",
      locked: true,
      targetSlot: "slot-7",
      targetAlive: false,
      targetStatus: "dead",
    }),
  }),
  Object.freeze({
    id: dayFourControlsReturnLaneId,
    targetKey: "dayFourControlsReturn",
    featureSlotId: dayFourControlsReturnLaneId,
    role: "actionPlayer",
    checkpointId: "d04-day-controls-return",
    statusKind: "day-controls-return",
    expectedCheckpointFields: Object.freeze({
      advanceState: "ack",
      phase: "D04",
      locked: false,
      actionSubmitControls: 0,
      targetAlive: false,
      targetVoteControls: 0,
    }),
  }),
]);

export function nightThreeProgressionCheckpointCases() {
  return nightThreeProgressionCheckpointCaseDefinitions.map(cloneCase);
}

export function nightThreeProgressionCheckpointCaseForId(id) {
  const scenario = nightThreeProgressionCheckpointCaseDefinitions.find(
    (candidate) => candidate.id === id,
  );
  if (scenario === undefined) {
    throw new Error(`unknown night three progression checkpoint case: ${id}`);
  }
  return cloneCase(scenario);
}

export function nightThreeProgressionFeatureSpineRows({
  cycleId = nightThreeDayFourCycleId,
} = {}) {
  return nightThreeProgressionCheckpointCaseDefinitions.map((scenario) =>
    cloneFeatureRow(featureRowFromCase(scenario, { cycleId })),
  );
}

export function nightThreeProgressionBrowserScenario() {
  return { ...nightThreeProgressionBrowserScenarioDefinition };
}

export function nightThreeActionTargetFromCommandState({
  commandState,
  scenario = nightThreeProgressionBrowserScenarioDefinition,
} = {}) {
  return (
    commandState?.actions?.find(
      (action) => action.templateId === scenario.templateId,
    )?.targets?.[0] ?? null
  );
}

export function assertNightThreeProgressionBrowserProof({
  proof,
  scenario = nightThreeProgressionBrowserScenarioDefinition,
  includeEvidenceInError = false,
}) {
  const submitAction =
    proof?.n03ActionSubmission?.requestEnvelope?.body?.body?.command
      ?.SubmitAction;
  const expectedTarget = proof?.n03ActionTarget ?? scenario.expectedTargetSlot;
  const checks = [
    [
      proof?.n03ActionTarget === scenario.expectedTargetSlot,
      "night three action target mismatch",
    ],
    [
      proof?.n03ActionSubmission?.state === "ack",
      "night three action submission did not ack",
    ],
    [
      proof?.n03ActionSubmission?.requestEnvelope?.body?.body
        ?.principal_user_id === scenario.expectedPrincipalUserId,
      "night three action principal mismatch",
    ],
    [
      submitAction?.actor_slot === scenario.expectedActorSlot,
      "night three action actor slot mismatch",
    ],
    [
      submitAction?.template_id === scenario.templateId,
      "night three action template mismatch",
    ],
    [
      submitAction?.targets?.[0] === expectedTarget,
      "night three action target command mismatch",
    ],
    [
      proof?.n03ActionAfterSubmit?.commandState?.phase?.phaseId ===
        scenario.expectedActionPhaseId,
      "night three post-submit phase mismatch",
    ],
    [
      Array.isArray(proof?.n03ActionAfterSubmit?.buttons) &&
        !hasButtonAction(proof.n03ActionAfterSubmit.buttons, scenario.actionId),
      "night three action button remained visible after submit",
    ],
    [
      String(proof?.n03ActionAfterSubmit?.receiptStatusText ?? "").includes(
        "Ack",
      ),
      "night three action receipt missing ack text",
    ],
    [
      proof?.hostBeforeResolveN03?.phase?.id === scenario.expectedActionPhaseId,
      "night three host pre-resolve phase mismatch",
    ],
    [
      proof?.hostBeforeResolveN03?.phase?.locked === false,
      "night three host pre-resolve lock mismatch",
    ],
    [
      proof?.hostBeforeResolveN03?.phaseActions?.includes("resolve_phase"),
      "night three host resolve control missing",
    ],
    [
      proof?.resolveN03?.commandStatus?.state === "ack",
      "night three resolve did not ack",
    ],
    [
      proof?.hostAfterResolveN03?.phase?.id === scenario.expectedActionPhaseId,
      "night three host post-resolve phase mismatch",
    ],
    [
      proof?.hostAfterResolveN03?.phase?.locked === true,
      "night three host post-resolve lock mismatch",
    ],
    [
      proof?.hostAfterResolveN03?.phaseActions?.includes("advance_phase"),
      "night three host advance control missing",
    ],
    [
      proof?.n03ResolvedTargetSlot?.slot_id === expectedTarget,
      "night three resolved target slot mismatch",
    ],
    [
      proof?.n03ResolvedTargetSlot?.alive === false,
      "night three resolved target remained alive",
    ],
    [
      proof?.n03ResolvedTargetSlot?.status === "dead",
      "night three resolved target status mismatch",
    ],
    [
      proof?.advanceD04?.commandStatus?.state === "ack",
      "day four advance did not ack",
    ],
    [
      proof?.d04HostSurface?.phase?.id === scenario.expectedDayPhaseId,
      "day four host phase mismatch",
    ],
    [
      proof?.d04HostSurface?.phase?.locked === false,
      "day four host lock mismatch",
    ],
    [
      proof?.d04HostSurface?.phaseActions?.includes("resolve_phase"),
      "day four host resolve control missing",
    ],
    [
      proof?.d04ActionSurface?.commandState?.phase?.phaseId ===
        scenario.expectedDayPhaseId,
      "day four action player phase mismatch",
    ],
    [
      proof?.d04ActionSurface?.commandState?.phase?.locked === false,
      "day four action player lock mismatch",
    ],
    [
      proof?.d04ActionSurface?.commandState?.actions?.length === 0,
      "day four action player still has night actions",
    ],
    [
      hasButtonWithPrefix(proof?.d04ActionSurface?.buttons, "submit_vote"),
      "day four action player vote controls missing",
    ],
    [
      proof?.d04TargetSurface?.commandState?.phase?.phaseId ===
        scenario.expectedDayPhaseId,
      "day four target phase mismatch",
    ],
    [
      proof?.d04TargetSurface?.commandState?.phase?.locked === false,
      "day four target lock mismatch",
    ],
    [
      proof?.d04TargetSurface?.commandState?.actorSlot === expectedTarget,
      "day four target actor slot mismatch",
    ],
    [
      proof?.d04TargetSurface?.commandState?.actorAlive === false,
      "day four target actor alive mismatch",
    ],
    [
      proof?.d04TargetSurface?.commandState?.actorStatus === "dead",
      "day four target actor status mismatch",
    ],
    [
      Array.isArray(proof?.d04TargetSurface?.buttons) &&
        !hasButtonWithPrefix(proof.d04TargetSurface.buttons, "submit_vote"),
      "day four dead target vote controls visible",
    ],
  ];
  for (const [passed, message] of checks) {
    if (!passed) {
      throwNightThreeProgressionAssertionError({
        message,
        evidence: proof,
        includeEvidenceInError,
      });
    }
  }
}

export function nightThreeProgressionCompactStatus(cycle, { actionPhase } = {}) {
  const actionOpen = checkpointById(cycle, "n03-action-open");
  const action = checkpointById(cycle, "n03-action-submitted");
  const dayReturn = checkpointById(
    cycle,
    nightThreeProgressionCheckpointCaseForId(dayFourControlsReturnLaneId)
      .checkpointId,
  );
  return `${String(actionOpen?.phase ?? actionPhase ?? "unknown")} action ${String(action?.actionState ?? "unknown")}, next ${String(dayReturn?.phase ?? "unknown")}`;
}

export function assertNightThreeProgressionCheckpointEvidence({
  cycle,
  includeEvidenceInError = false,
}) {
  if (cycle?.id !== nightThreeDayFourCycleId) {
    throwNightThreeProgressionAssertionError({
      message: "night three progression cycle id mismatch",
      evidence: cycle,
      includeEvidenceInError,
    });
  }
  for (const scenario of nightThreeProgressionCheckpointCaseDefinitions) {
    const checkpoint = checkpointById(cycle, scenario.checkpointId);
    if (checkpoint === null) {
      throwNightThreeProgressionAssertionError({
        message: `night three progression missing checkpoint ${scenario.checkpointId}`,
        evidence: cycle,
        includeEvidenceInError,
      });
    }
    for (const [field, expectedValue] of Object.entries(
      scenario.expectedCheckpointFields,
    )) {
      if (checkpoint[field] !== expectedValue) {
        throwNightThreeProgressionAssertionError({
          message: `night three progression checkpoint ${scenario.checkpointId} expected ${field}`,
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
    ...(scenario.seedMembership === undefined
      ? {}
      : { seedMembership: scenario.seedMembership }),
    ...(scenario.seedOrder === undefined ? {} : { seedOrder: scenario.seedOrder }),
    cycleId,
    role: scenario.role,
    checkpointId: `${cycleId}-${scenario.checkpointId}`,
    adminCheckId: nightThreeProgressionAdminCheckId,
  });
}

function checkpointById(cycle, id) {
  return cycle?.checkpoints?.find((checkpoint) => checkpoint.id === id) ?? null;
}

function hasButtonAction(buttons, action) {
  return Array.isArray(buttons)
    ? buttons.some((button) => button.action === action)
    : false;
}

function hasButtonWithPrefix(buttons, prefix) {
  return Array.isArray(buttons)
    ? buttons.some((button) => String(button.action ?? "").startsWith(prefix))
    : false;
}

function throwNightThreeProgressionAssertionError({
  message,
  evidence,
  includeEvidenceInError,
}) {
  if (includeEvidenceInError) {
    throw new Error(`${message}: ${JSON.stringify(evidence)}`);
  }
  throw new Error(message);
}
