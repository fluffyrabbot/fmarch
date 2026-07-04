export const revoteProgressionCycleId = "d03-n03";
export const revoteProgressionAdminCheckId = "core-loop";
export const dayVoteNoLynchLaneId = "day-vote-no-lynch";
export const revoteProgressionVoteActionId = "submit_vote:no_lynch";
export const revoteProgressionContinuePolicy = "no_majority_continue_revote";
export const revoteProgressionNoLynchPolicy = "no_majority_no_lynch";

export const revoteProgressionBrowserScenarioDefinition = Object.freeze({
  voteActionId: revoteProgressionVoteActionId,
  expectedPrincipalUserId: "player-goon-a",
  expectedActorSlot: "slot_4",
  expectedVoteTarget: "NoLynch",
  expectedVoteKind: "no_lynch",
  firstPromptId: "D03:revote:NoMajority",
  firstPhaseId: "D03R1",
  secondPromptId: "D03R1:revote:NoMajority",
  secondPhaseId: "D03R2",
  terminalPromptId: "D03R2:revote:NoMajority",
  terminalPhaseId: "N03",
  continuePolicy: revoteProgressionContinuePolicy,
  terminalPolicy: revoteProgressionNoLynchPolicy,
});

const cloneCase = (scenario) => ({
  ...scenario,
  expectedCheckpointFields: { ...scenario.expectedCheckpointFields },
});

const cloneFeatureRow = (row) => ({ ...row });

const revoteProgressionCheckpointCaseDefinitions = Object.freeze([
  Object.freeze({
    id: "day-three-no-majority-revote",
    targetKey: "dayThreeNoMajorityRevote",
    featureSlotId: "day-three-no-majority-revote",
    role: "host",
    checkpointId: "d03-revote-prompt-resolved",
    statusKind: "first-revote",
    expectedCheckpointFields: Object.freeze({
      phase: "D03R1",
      decisionPolicy: "no_majority_continue_revote",
      resolveState: "ack",
      promptStatusAfter: "resolved",
    }),
  }),
  Object.freeze({
    id: "day-three-revote-ballot",
    targetKey: "dayThreeRevoteBallot",
    featureSlotId: "day-three-revote-ballot",
    role: "actionPlayer",
    checkpointId: "d03r1-revote-ballot-submitted",
    statusKind: "first-ballot",
    expectedCheckpointFields: Object.freeze({
      phase: "D03R1",
      voteState: "ack",
      voteTarget: "NoLynch",
      currentVoteKind: "no_lynch",
    }),
  }),
  Object.freeze({
    id: "day-three-revote-resolution",
    targetKey: "dayThreeRevoteResolution",
    featureSlotId: "day-three-revote-resolution",
    role: "host",
    checkpointId: "d03r1-revote-resolved-no-majority",
    statusKind: "first-resolution",
    expectedCheckpointFields: Object.freeze({
      phase: "D03R1",
      resolveState: "ack",
      outcomeStatus: "NoMajority",
      promptStatusAfter: "pending",
    }),
  }),
  Object.freeze({
    id: "day-three-second-revote",
    targetKey: "dayThreeSecondRevote",
    featureSlotId: "day-three-second-revote",
    role: "host",
    checkpointId: "d03r2-revote-prompt-resolved",
    statusKind: "second-revote",
    expectedCheckpointFields: Object.freeze({
      phase: "D03R2",
      decisionPolicy: "no_majority_continue_revote",
      resolveState: "ack",
      promptStatusAfter: "resolved",
    }),
  }),
  Object.freeze({
    id: "day-three-second-revote-ballot",
    targetKey: "dayThreeSecondRevoteBallot",
    featureSlotId: "day-three-second-revote-ballot",
    role: "actionPlayer",
    checkpointId: "d03r2-revote-ballot-submitted",
    statusKind: "second-ballot",
    expectedCheckpointFields: Object.freeze({
      phase: "D03R2",
      voteState: "ack",
      voteTarget: "NoLynch",
      currentVoteKind: "no_lynch",
    }),
  }),
  Object.freeze({
    id: "day-three-second-revote-resolution",
    targetKey: "dayThreeSecondRevoteResolution",
    featureSlotId: "day-three-second-revote-resolution",
    role: "host",
    checkpointId: "d03r2-revote-resolved-no-majority",
    statusKind: "second-resolution",
    expectedCheckpointFields: Object.freeze({
      phase: "D03R2",
      resolveState: "ack",
      outcomeStatus: "NoMajority",
      decisionPolicy: "no_majority_no_lynch",
      nextPhase: "N03",
    }),
  }),
]);

const dayVoteNoLynchFeatureRowDefinition = Object.freeze({
  targetKey: "dayVoteNoLynch",
  featureSlotId: dayVoteNoLynchLaneId,
  caseId: "day-three-revote-ballot",
  seedMembership: "demoOnly",
  seedOrder: 20,
});

export function revoteProgressionCheckpointCases() {
  return revoteProgressionCheckpointCaseDefinitions.map(cloneCase);
}

export function revoteProgressionCheckpointCaseForId(id) {
  const scenario = revoteProgressionCheckpointCaseDefinitions.find(
    (candidate) => candidate.id === id,
  );
  if (scenario === undefined) {
    throw new Error(`unknown revote progression checkpoint case: ${id}`);
  }
  return cloneCase(scenario);
}

export function dayVoteNoLynchFeatureSpineRow({
  cycleId = revoteProgressionCycleId,
} = {}) {
  const row = featureRowFromDefinition(dayVoteNoLynchFeatureRowDefinition, {
    cycleId,
  });
  return cloneFeatureRow(row);
}

export function revoteProgressionFeatureSpineRows({
  cycleId = revoteProgressionCycleId,
} = {}) {
  return revoteProgressionCheckpointCaseDefinitions.map((scenario) =>
    cloneFeatureRow(
      featureRowFromDefinition(
        {
          targetKey: scenario.targetKey,
          featureSlotId: scenario.featureSlotId,
          caseId: scenario.id,
        },
        { cycleId },
      ),
    ),
  );
}

export function revoteProgressionBrowserScenario() {
  return { ...revoteProgressionBrowserScenarioDefinition };
}

export function revoteNoLynchTargetFromCommandState({ commandState } = {}) {
  return (
    commandState?.voteTargets?.find((target) => target.kind === "no_lynch") ??
    null
  );
}

export function assertRevoteProgressionBrowserProof({
  proof,
  scenario = revoteProgressionBrowserScenarioDefinition,
  includeEvidenceInError = false,
}) {
  const checks = [
    [
      hostPromptPolicy(proof?.d03RevotePromptResolution) ===
        scenario.continuePolicy,
      "first revote prompt policy mismatch",
    ],
    [
      hostPromptId(proof?.d03RevotePromptResolution) ===
        proof?.d03RevotePrompt?.id,
      "first revote prompt id mismatch",
    ],
    [
      commandAckedWithTwoEvents(proof?.d03RevotePromptResolution),
      "first revote prompt resolution did not ack",
    ],
    ...phaseOpenChecks({
      surface: proof?.hostAfterD03RevotePrompt,
      phaseId: scenario.firstPhaseId,
      staleActionId: proof?.d03RevotePromptActionId,
      promptId: proof?.d03RevotePrompt?.id,
      apiPrompts: proof?.apiPromptsAfterD03Revote,
      label: "first revote open",
    }),
    ...playerVoteOpenChecks({
      actionSurface: proof?.actionAfterD03RevotePrompt,
      normalSurface: proof?.normalAfterD03RevotePrompt,
      phaseId: scenario.firstPhaseId,
      label: "first revote",
    }),
    ...voteSubmissionChecks({
      submission: proof?.d03RevoteVoteSubmission,
      afterVote: proof?.d03RevoteActionAfterVote,
      apiNoLynchRow: proof?.d03RevoteApiNoLynchRow,
      priorApiRows: [proof?.d03RevoteApiOriginalD03Row],
      staleApiRows: [proof?.d03RevoteApiStaleD03NoLynchRow],
      phaseId: scenario.firstPhaseId,
      scenario,
      label: "first revote vote",
    }),
    ...hostResolveNoMajorityChecks({
      beforeResolve: proof?.hostBeforeResolveD03R1,
      resolve: proof?.resolveD03R1,
      afterResolve: proof?.hostAfterResolveD03R1,
      outcome: proof?.d03R1DayVoteOutcome,
      prompt: proof?.d03R1RevotePrompt,
      promptActionId: proof?.d03R1RevotePromptActionId,
      apiPrompts: proof?.apiPromptsAfterResolveD03R1,
      priorPromptIds: [proof?.d03RevotePrompt?.id],
      phaseId: scenario.firstPhaseId,
      expectedPromptId: scenario.secondPromptId,
      label: "first revote resolution",
    }),
    [
      hostPromptPolicy(proof?.d03R1RevotePromptResolution) ===
        scenario.continuePolicy,
      "second revote prompt policy mismatch",
    ],
    [
      hostPromptId(proof?.d03R1RevotePromptResolution) ===
        proof?.d03R1RevotePrompt?.id,
      "second revote prompt id mismatch",
    ],
    [
      commandAckedWithTwoEvents(proof?.d03R1RevotePromptResolution),
      "second revote prompt resolution did not ack",
    ],
    ...phaseOpenChecks({
      surface: proof?.hostAfterD03R1RevotePrompt,
      phaseId: scenario.secondPhaseId,
      staleActionId: proof?.d03R1RevotePromptActionId,
      promptId: proof?.d03R1RevotePrompt?.id,
      apiPrompts: proof?.apiPromptsAfterD03R1Revote,
      priorPromptIds: [proof?.d03RevotePrompt?.id],
      label: "second revote open",
    }),
    ...playerVoteOpenChecks({
      actionSurface: proof?.actionAfterD03R1RevotePrompt,
      normalSurface: proof?.normalAfterD03R1RevotePrompt,
      phaseId: scenario.secondPhaseId,
      label: "second revote",
    }),
    ...voteSubmissionChecks({
      submission: proof?.d03R2RevoteVoteSubmission,
      afterVote: proof?.d03R2RevoteActionAfterVote,
      apiNoLynchRow: proof?.d03R2RevoteApiNoLynchRow,
      priorApiRows: [
        proof?.d03R2RevoteApiOriginalD03Row,
        proof?.d03R2RevoteApiD03R1NoLynchRow,
      ],
      staleApiRows: [proof?.d03R2RevoteApiStaleD03NoLynchRow],
      phaseId: scenario.secondPhaseId,
      scenario,
      label: "second revote vote",
    }),
    ...hostResolveNoMajorityChecks({
      beforeResolve: proof?.hostBeforeResolveD03R2,
      resolve: proof?.resolveD03R2,
      afterResolve: proof?.hostAfterResolveD03R2,
      outcome: proof?.d03R2DayVoteOutcome,
      prompt: proof?.d03R2RevotePrompt,
      promptActionId: proof?.d03R2RevotePromptActionId,
      apiPrompts: proof?.apiPromptsAfterResolveD03R2,
      priorPromptIds: [proof?.d03RevotePrompt?.id, proof?.d03R1RevotePrompt?.id],
      phaseId: scenario.secondPhaseId,
      expectedPromptId: scenario.terminalPromptId,
      extraPromptActionId: proof?.d03R2StaleContinuePolicyActionId,
      label: "second revote resolution",
    }),
    [
      hostPromptPolicy(proof?.d03R2NoLynchPolicyResolution) ===
        scenario.terminalPolicy,
      "terminal no-lynch policy mismatch",
    ],
    [
      hostPromptId(proof?.d03R2NoLynchPolicyResolution) ===
        proof?.d03R2RevotePrompt?.id,
      "terminal no-lynch prompt id mismatch",
    ],
    [
      commandAckedWithTwoEvents(proof?.d03R2NoLynchPolicyResolution),
      "terminal no-lynch policy did not ack",
    ],
    [
      proof?.hostAfterD03R2NoLynchPolicy?.phase?.id ===
        scenario.terminalPhaseId,
      "terminal host phase mismatch",
    ],
    [
      proof?.hostAfterD03R2NoLynchPolicy?.phase?.locked === false,
      "terminal host lock mismatch",
    ],
    [
      proof?.hostAfterD03R2NoLynchPolicy?.phaseActions?.includes(
        "resolve_phase",
      ),
      "terminal host resolve action missing",
    ],
    [
      !hasAction(
        proof?.hostAfterD03R2NoLynchPolicy?.promptActions,
        proof?.d03R2RevotePromptActionId,
      ),
      "terminal resolved no-lynch action remained visible",
    ],
    [
      promptStatus(proof?.hostAfterD03R2NoLynchPolicy?.hostPrompts, proof?.d03R2RevotePrompt?.id) ===
        "resolved",
      "terminal host prompt not resolved",
    ],
    [
      promptStatus(
        proof?.apiPromptsAfterD03R2NoLynchPolicy,
        proof?.d03R2RevotePrompt?.id,
      ) === "resolved",
      "terminal API prompt not resolved",
    ],
    [
      proof?.actionAfterD03R2NoLynchPolicy?.commandState?.phase?.phaseId ===
        scenario.terminalPhaseId,
      "terminal action player phase mismatch",
    ],
    [
      proof?.actionAfterD03R2NoLynchPolicy?.commandState?.phase?.locked === false,
      "terminal action player lock mismatch",
    ],
    [
      hasButtonWithPrefix(
        proof?.actionAfterD03R2NoLynchPolicy?.buttons,
        "submit_action",
      ),
      "terminal action player night action missing",
    ],
    [
      proof?.normalAfterD03R2NoLynchPolicy?.commandState?.phase?.phaseId ===
        scenario.terminalPhaseId,
      "terminal normal player phase mismatch",
    ],
    [
      proof?.normalAfterD03R2NoLynchPolicy?.commandState?.phase?.locked === false,
      "terminal normal player lock mismatch",
    ],
    [
      !hasButtonWithPrefix(
        proof?.normalAfterD03R2NoLynchPolicy?.buttons,
        "submit_action",
      ),
      "terminal normal player night action visible",
    ],
    [
      proof?.d03R2StaleContinuePolicySetup?.promptActions?.includes(
        proof?.d03R2StaleContinuePolicyActionId,
      ) === true,
      "stale continue policy setup missing stale action",
    ],
    [
      proof?.d03R2StaleContinuePolicyRecovery?.reject?.state === "reject" &&
        proof?.d03R2StaleContinuePolicyRecovery?.reject?.error ===
          "PromptAlreadyResolved",
      "stale continue policy did not reject",
    ],
    [
      String(
        proof?.d03R2StaleContinuePolicyRecovery?.activityStatusText ?? "",
      ).includes("Reject PromptAlreadyResolved") &&
        String(
          proof?.d03R2StaleContinuePolicyRecovery?.activityStatusText ?? "",
        ).includes("host prompt selection is stale"),
      "stale continue policy receipt text mismatch",
    ],
    [
      proof?.d03R2StaleContinuePolicyRecovery?.staleHostPromptReloadAfterReject
        ?.phase?.id === scenario.terminalPhaseId &&
        proof?.d03R2StaleContinuePolicyRecovery?.staleHostPromptReloadAfterReject
          ?.phase?.locked === false,
      "stale continue policy reload phase mismatch",
    ],
    [
      !hasAction(
        proof?.d03R2StaleContinuePolicyRecovery?.staleHostPromptReloadAfterReject
          ?.promptActionsAfterReload,
        proof?.d03R2StaleContinuePolicyActionId,
      ) &&
        !hasAction(
          proof?.d03R2StaleContinuePolicyRecovery
            ?.staleHostPromptReloadAfterReject?.promptActionsAfterReload,
          proof?.d03R2RevotePromptActionId,
        ),
      "stale continue policy reload retained stale prompt actions",
    ],
  ];
  for (const [passed, message] of checks) {
    if (!passed) {
      throwRevoteProgressionAssertionError({
        message,
        evidence: proof,
        includeEvidenceInError,
      });
    }
  }
}

export function revoteProgressionCompactStatus(cycle) {
  const checkpoint = (caseId) =>
    checkpointById(
      cycle,
      revoteProgressionCheckpointCaseForId(caseId).checkpointId,
    );
  const revote = checkpoint("day-three-no-majority-revote");
  const revoteBallot = checkpoint("day-three-revote-ballot");
  const revoteResolution = checkpoint("day-three-revote-resolution");
  const secondRevote = checkpoint("day-three-second-revote");
  const secondRevoteBallot = checkpoint("day-three-second-revote-ballot");
  const secondRevoteResolution = checkpoint(
    "day-three-second-revote-resolution",
  );
  return `revote ${String(revote?.phase ?? "unknown")} via ${String(revote?.decisionPolicy ?? "unknown")}, revote vote ${String(revoteBallot?.voteState ?? "unknown")}, revote resolve ${String(revoteResolution?.resolveState ?? "unknown")}, second revote ${String(secondRevote?.phase ?? "unknown")} via ${String(secondRevote?.decisionPolicy ?? "unknown")}, second vote ${String(secondRevoteBallot?.voteState ?? "unknown")}, second resolve ${String(secondRevoteResolution?.resolveState ?? "unknown")}, policy ${String(secondRevoteResolution?.decisionPolicy ?? "unknown")} -> ${String(secondRevoteResolution?.nextPhase ?? "unknown")}`;
}

export function assertRevoteProgressionCheckpointEvidence({
  cycle,
  includeEvidenceInError = false,
}) {
  if (cycle?.id !== revoteProgressionCycleId) {
    throwRevoteProgressionAssertionError({
      message: "revote progression cycle id mismatch",
      evidence: cycle,
      includeEvidenceInError,
    });
  }
  for (const scenario of revoteProgressionCheckpointCaseDefinitions) {
    const checkpoint = checkpointById(cycle, scenario.checkpointId);
    if (checkpoint === null) {
      throwRevoteProgressionAssertionError({
        message: `revote progression missing checkpoint ${scenario.checkpointId}`,
        evidence: cycle,
        includeEvidenceInError,
      });
    }
    for (const [field, expectedValue] of Object.entries(
      scenario.expectedCheckpointFields,
    )) {
      if (checkpoint[field] !== expectedValue) {
        throwRevoteProgressionAssertionError({
          message: `revote progression checkpoint ${scenario.checkpointId} expected ${field}`,
          evidence: checkpoint,
          includeEvidenceInError,
        });
      }
    }
  }
}

function featureRowFromDefinition(definition, { cycleId }) {
  const scenario = revoteProgressionCheckpointCaseForId(definition.caseId);
  return Object.freeze({
    targetKey: definition.targetKey,
    featureSlotId: definition.featureSlotId,
    cycleId,
    role: scenario.role,
    checkpointId: `${cycleId}-${scenario.checkpointId}`,
    adminCheckId: revoteProgressionAdminCheckId,
    ...(definition.seedMembership === undefined
      ? {}
      : { seedMembership: definition.seedMembership }),
    ...(definition.seedOrder === undefined ? {} : { seedOrder: definition.seedOrder }),
  });
}

function checkpointById(cycle, id) {
  return cycle?.checkpoints?.find((checkpoint) => checkpoint.id === id) ?? null;
}

function phaseOpenChecks({
  surface,
  phaseId,
  staleActionId,
  promptId,
  apiPrompts,
  priorPromptIds = [],
  label,
}) {
  return [
    [surface?.phase?.id === phaseId, `${label} phase mismatch`],
    [surface?.phase?.locked === false, `${label} lock mismatch`],
    [
      surface?.phaseActions?.includes("resolve_phase"),
      `${label} resolve action missing`,
    ],
    [
      !hasAction(surface?.promptActions, staleActionId),
      `${label} stale prompt action remained visible`,
    ],
    [
      promptStatus(surface?.hostPrompts, promptId) === "resolved",
      `${label} host prompt not resolved`,
    ],
    [
      promptStatus(apiPrompts, promptId) === "resolved",
      `${label} API prompt not resolved`,
    ],
    ...priorPromptIds.map((priorPromptId) => [
      promptStatus(surface?.hostPrompts, priorPromptId) === "resolved",
      `${label} prior host prompt not resolved`,
    ]),
    ...priorPromptIds.map((priorPromptId) => [
      promptStatus(apiPrompts, priorPromptId) === "resolved",
      `${label} prior API prompt not resolved`,
    ]),
  ];
}

function playerVoteOpenChecks({ actionSurface, normalSurface, phaseId, label }) {
  return [
    [
      actionSurface?.commandState?.phase?.phaseId === phaseId,
      `${label} action player phase mismatch`,
    ],
    [
      actionSurface?.commandState?.phase?.locked === false,
      `${label} action player lock mismatch`,
    ],
    [
      hasButtonWithPrefix(actionSurface?.buttons, "submit_vote"),
      `${label} action player vote controls missing`,
    ],
    [
      normalSurface?.commandState?.phase?.phaseId === phaseId,
      `${label} normal player phase mismatch`,
    ],
    [
      normalSurface?.commandState?.phase?.locked === false,
      `${label} normal player lock mismatch`,
    ],
    [
      hasButtonWithPrefix(normalSurface?.buttons, "submit_vote"),
      `${label} normal player vote controls missing`,
    ],
  ];
}

function voteSubmissionChecks({
  submission,
  afterVote,
  apiNoLynchRow,
  priorApiRows,
  staleApiRows,
  phaseId,
  scenario,
  label,
}) {
  const submitVote = submission?.requestEnvelope?.body?.body?.command?.SubmitVote;
  return [
    [submission?.state === "ack", `${label} did not ack`],
    [
      submission?.requestEnvelope?.body?.body?.principal_user_id ===
        scenario.expectedPrincipalUserId,
      `${label} principal mismatch`,
    ],
    [
      submitVote?.actor_slot === scenario.expectedActorSlot,
      `${label} actor slot mismatch`,
    ],
    [
      submitVote?.target === scenario.expectedVoteTarget,
      `${label} target mismatch`,
    ],
    [
      afterVote?.commandState?.phase?.phaseId === phaseId,
      `${label} phase mismatch`,
    ],
    [
      afterVote?.commandState?.phase?.locked === false,
      `${label} lock mismatch`,
    ],
    [
      afterVote?.commandState?.currentVote?.kind === scenario.expectedVoteKind,
      `${label} current vote mismatch`,
    ],
    [afterVote?.currentVote?.hasVote === "true", `${label} current vote missing`],
    [
      afterVote?.votecount?.some(
        (row) => row.target === "no_lynch" && row.count === 1,
      ),
      `${label} projected votecount missing no lynch`,
    ],
    [
      apiNoLynchRow?.count === 1 && apiNoLynchRow?.needed !== undefined,
      `${label} API no-lynch tally mismatch`,
    ],
    ...priorApiRows.map((row) => [
      row?.count === 1,
      `${label} prior tally missing`,
    ]),
    ...staleApiRows.map((row) => [
      row === undefined,
      `${label} stale tally leaked`,
    ]),
  ];
}

function hostResolveNoMajorityChecks({
  beforeResolve,
  resolve,
  afterResolve,
  outcome,
  prompt,
  promptActionId,
  apiPrompts,
  priorPromptIds,
  phaseId,
  expectedPromptId,
  extraPromptActionId,
  label,
}) {
  return [
    [beforeResolve?.phase?.id === phaseId, `${label} pre-resolve phase mismatch`],
    [beforeResolve?.phase?.locked === false, `${label} pre-resolve lock mismatch`],
    [
      beforeResolve?.phaseActions?.includes("resolve_phase"),
      `${label} resolve action missing before resolve`,
    ],
    [resolve?.commandStatus?.state === "ack", `${label} resolve did not ack`],
    [afterResolve?.phase?.id === phaseId, `${label} post-resolve phase mismatch`],
    [afterResolve?.phase?.locked === true, `${label} post-resolve lock mismatch`],
    [
      outcome?.status === "NoMajority" &&
        outcome?.winnerSlot === null &&
        outcome?.tallies?.no_lynch === 1,
      `${label} outcome mismatch`,
    ],
    [
      afterResolve?.dayVoteOutcomes?.some(
        (row) =>
          row.phaseId === phaseId &&
          row.status === "NoMajority" &&
          row.tallies?.no_lynch === 1,
      ),
      `${label} host outcome missing`,
    ],
    [
      String(afterResolve?.outcomePanel ?? "").includes(`${phaseId} NoMajority`),
      `${label} outcome panel mismatch`,
    ],
    [
      prompt?.id === expectedPromptId &&
        prompt?.status === "pending" &&
        prompt?.value === "no_majority",
      `${label} revote prompt mismatch`,
    ],
    [
      afterResolve?.promptActions?.includes(promptActionId),
      `${label} prompt action missing`,
    ],
    [
      extraPromptActionId === undefined ||
        afterResolve?.promptActions?.includes(extraPromptActionId),
      `${label} extra prompt action missing`,
    ],
    ...priorPromptIds.map((priorPromptId) => [
      promptStatus(apiPrompts, priorPromptId) === "resolved",
      `${label} prior API prompt not resolved`,
    ]),
    [
      promptStatus(apiPrompts, prompt?.id) === "pending",
      `${label} API prompt not pending`,
    ],
  ];
}

function commandAckedWithTwoEvents(commandResult) {
  return (
    commandResult?.commandStatus?.state === "ack" &&
    Array.isArray(commandResult.commandStatus.streamSeqs) &&
    commandResult.commandStatus.streamSeqs.length === 2
  );
}

function hostPromptId(commandResult) {
  return commandResult?.commandStatus?.requestEnvelope?.body?.body?.command
    ?.ResolveHostPrompt?.prompt_id;
}

function hostPromptPolicy(commandResult) {
  return commandResult?.commandStatus?.requestEnvelope?.body?.body?.command
    ?.ResolveHostPrompt?.decision?.SelectPolicy?.policy;
}

function promptStatus(prompts, promptId) {
  return Array.isArray(prompts)
    ? prompts.find((prompt) => (prompt.id ?? prompt.prompt_id) === promptId)
        ?.status
    : undefined;
}

function hasAction(actions, actionId) {
  return (
    typeof actionId === "string" &&
    Array.isArray(actions) &&
    actions.includes(actionId)
  );
}

function hasButtonWithPrefix(buttons, prefix) {
  return Array.isArray(buttons)
    ? buttons.some((button) => String(button.action ?? "").startsWith(prefix))
    : false;
}

function throwRevoteProgressionAssertionError({
  message,
  evidence,
  includeEvidenceInError,
}) {
  if (includeEvidenceInError) {
    throw new Error(`${message}: ${JSON.stringify(evidence)}`);
  }
  throw new Error(message);
}
