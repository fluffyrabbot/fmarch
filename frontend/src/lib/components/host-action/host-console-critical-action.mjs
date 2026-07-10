export const EXTEND_DEADLINE_PRESETS = Object.freeze([
  Object.freeze({ id: "extend_deadline_24h", label: "Extend +24h", hours: 24 }),
  Object.freeze({ id: "extend_deadline_48h", label: "Extend +48h", hours: 48 }),
]);

const FIXTURE_DEADLINE_SECONDS = 1781841600;

export function buildHostConsoleCriticalActions(
  gameId,
  {
    hostPrompts = [],
    phase = null,
    replacement = null,
    completed = false,
    capabilityKind = "HostOf",
  } = {},
) {
  if (completed === true) {
    return Object.freeze([]);
  }
  const deadlineActions = buildExtendDeadlineActions(gameId, phase);
  const phaseActions = buildPhaseActions(gameId, phase);
  const lifecycleActions = buildSlotLifecycleActions(gameId, replacement);
  const actions = [
    ...deadlineActions,
    freezeHostAction({
      id: "process_replacement",
      label: "Process replacement",
      objectLabel: "Slot 7 / Mira",
      outcomeLabel: "replace Mira with Rowan and preserve slot history",
      confirmationText:
        "Process replacement for Slot 7 / Mira: replace Mira with Rowan and preserve slot history.",
      irreversible: true,
      payload: {
        kind: "process_replacement",
        gameId,
        slotId: "slot-7",
        outgoingPlayerId: "player-mira",
        incomingPlayerId: "player-rowan",
      },
    }),
    ...phaseActions,
    freezeHostAction({
      id: "publish_votecount",
      label: "Publish count",
      objectLabel: "Current votecount",
      outcomeLabel: "post an official count derived from the server projection",
      confirmationText:
        "Publish current votecount: post an official count derived from the server projection for Current votecount.",
      requiresConfirmation: true,
      payload: {
        kind: "publish_votecount",
        gameId,
      },
    }),
    ...lifecycleActions,
    freezeHostAction({
      id: "complete_game",
      label: "Reveal roles",
      objectLabel: "Endgame role sheet",
      outcomeLabel: "mark the game complete and reveal final role and alignment facts",
      confirmationText:
        "Reveal endgame role sheet: mark the game complete and reveal final role and alignment facts for Endgame role sheet.",
      irreversible: true,
      payload: {
        kind: "complete_game",
        gameId,
      },
    }),
    ...hostPrompts
      .filter((prompt) => prompt.status === "pending")
      .flatMap((prompt) => buildHostPromptActions(gameId, prompt)),
  ];
  return Object.freeze(
    actions.filter((action) =>
      hostActionAllowedForCapability(action, capabilityKind),
    ),
  );
}

function buildExtendDeadlineActions(gameId, phase) {
  const target = activeDeadlineTarget(phase);
  const defaultExtendsToSeconds = target.baseDeadlineSeconds + 24 * 3600;
  return Object.freeze([
    freezeHostAction({
      id: "extend_deadline",
      label: "Extend deadline",
      objectLabel: target.objectLabel,
      outcomeLabel: `move the deadline to ${formatDeadlinePacific(defaultExtendsToSeconds)}`,
      confirmationText:
        `Extend ${target.objectLabel}: move the deadline to ${formatDeadlinePacific(defaultExtendsToSeconds)} for ${target.objectLabel}.`,
      irreversible: true,
      payload: {
        kind: "extend_deadline",
        gameId,
        phaseId: target.phaseId,
        extendsTo: new Date(defaultExtendsToSeconds * 1000).toISOString(),
      },
    }),
    ...EXTEND_DEADLINE_PRESETS.map((preset) =>
      buildExtendDeadlinePresetAction(gameId, target, preset),
    ),
  ]);
}

function buildExtendDeadlinePresetAction(gameId, target, preset) {
  const extendsToSeconds = target.baseDeadlineSeconds + preset.hours * 3600;
  const outcomeLabel = `move the deadline ${preset.hours} hours later to ${formatDeadlinePacific(extendsToSeconds)}`;
  return freezeHostAction({
    id: preset.id,
    label: preset.label,
    objectLabel: target.objectLabel,
    outcomeLabel,
    confirmationText:
      `Extend ${target.objectLabel} by ${preset.hours} hours: ${outcomeLabel} for ${target.objectLabel}.`,
    requiresConfirmation: true,
    payload: {
      kind: "extend_deadline",
      gameId,
      phaseId: target.phaseId,
      extendsTo: new Date(extendsToSeconds * 1000).toISOString(),
    },
  });
}

function activeDeadlineTarget(phase) {
  const phaseId =
    typeof phase?.id === "string" && phase.id.trim() !== ""
      ? phase.id.trim()
      : "D01";
  const phaseLabel =
    typeof phase?.label === "string" && phase.label.trim() !== ""
      ? phase.label.trim()
      : phaseId;
  const baseDeadlineSeconds =
    typeof phase?.deadline === "number" && Number.isFinite(phase.deadline)
      ? Math.floor(phase.deadline)
      : FIXTURE_DEADLINE_SECONDS;
  return Object.freeze({
    phaseId,
    objectLabel: `${phaseLabel} deadline`,
    baseDeadlineSeconds,
  });
}

function formatDeadlinePacific(epochSeconds) {
  const date = new Date(epochSeconds * 1000);
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  return `${day} at ${time} PT`;
}

function buildHostPromptActions(gameId, prompt) {
  if (isNoMajorityRevotePrompt(prompt)) {
    return noMajorityRevotePolicyActions.map((policy) =>
      freezeHostAction({
        id: `resolve_host_prompt-${stableActionId(prompt.id)}-${stableActionId(policy.id)}`,
        label: policy.label,
        objectLabel: prompt.label,
        outcomeLabel: policy.outcomeLabel,
        confirmationText:
          `${policy.label} for ${prompt.label}: ${policy.outcomeLabel} for ${prompt.label}.`,
        irreversible: true,
        payload: {
          kind: "resolve_host_prompt",
          gameId,
          promptId: prompt.id,
          decision: { kind: "select_policy", policy: policy.id },
        },
      }),
    );
  }
  if (prompt.decisionKind === "select_slot") {
    return hostPromptSlotChoices(prompt).map((slot) =>
      freezeHostAction({
        id: `resolve_host_prompt-${stableActionId(prompt.id)}-${stableActionId(slot)}`,
        label: `Eliminate ${slot}`,
        objectLabel: prompt.label,
        outcomeLabel: `select ${slot} from the tied contenders`,
        confirmationText:
          `Eliminate ${slot} for ${prompt.label}: select ${slot} from the tied contenders for ${prompt.label}.`,
        irreversible: true,
        payload: {
          kind: "resolve_host_prompt",
          gameId,
          promptId: prompt.id,
          decision: { kind: "select_slot", slot },
        },
      }),
    );
  }
  return [
    freezeHostAction({
      id: `resolve_host_prompt-${stableActionId(prompt.id)}`,
      label: "Resolve prompt",
      objectLabel: prompt.label,
      outcomeLabel: "acknowledge prompt and apply pack policy",
      confirmationText:
        `Resolve ${prompt.label}: acknowledge prompt and apply pack policy for ${prompt.label}.`,
      irreversible: true,
      payload: {
        kind: "resolve_host_prompt",
        gameId,
        promptId: prompt.id,
        decision: { kind: "acknowledge" },
      },
    }),
  ];
}

function hostPromptSlotChoices(prompt) {
  const contenders = Array.isArray(prompt?.metadata?.contenders)
    ? prompt.metadata.contenders
        .map((slot) => String(slot).trim())
        .filter((slot) => slot !== "")
    : [];
  if (contenders.length > 0) {
    return [...new Set(contenders)];
  }
  const subjectSlot = String(prompt?.subjectSlot ?? "").trim();
  return subjectSlot === "" ? [] : [subjectSlot];
}

const noMajorityRevotePolicyActions = Object.freeze([
  Object.freeze({
    id: "no_majority_continue_revote",
    label: "Continue revote",
    outcomeLabel: "open another revote window",
  }),
  Object.freeze({
    id: "no_majority_no_lynch",
    label: "End no-lynch",
    outcomeLabel: "advance to night without a lynch",
  }),
]);

function isNoMajorityRevotePrompt(prompt) {
  return (
    prompt?.label === "revote" &&
    prompt?.value === "no_majority" &&
    prompt?.metadata?.policy === "no_majority_revote"
  );
}

function buildSlotLifecycleActions(gameId, replacement) {
  if (!replacementAllowsTerminalLifecycleActions(replacement)) {
    return [];
  }
  return [
    freezeHostAction({
      id: "mark_dead",
      label: "Mark dead",
      objectLabel: "Slot 7",
      outcomeLabel: "set lifecycle to dead",
      confirmationText: "Mark Slot 7 dead: set lifecycle to dead for Slot 7.",
      irreversible: true,
      payload: {
        kind: "mark_dead",
        gameId,
        slotId: "slot-7",
        status: "dead",
      },
    }),
    freezeHostAction({
      id: "modkill_slot",
      label: "Modkill slot",
      objectLabel: "Slot 7",
      outcomeLabel: "set lifecycle to modkilled",
      confirmationText:
        "Modkill Slot 7: set lifecycle to modkilled for Slot 7.",
      irreversible: true,
      payload: {
        kind: "modkill_slot",
        gameId,
        slotId: "slot-7",
        status: "modkilled",
      },
    }),
  ];
}

function replacementAllowsTerminalLifecycleActions(replacement) {
  const lifecycleLabel = String(replacement?.lifecycleLabel ?? "Alive")
    .trim()
    .toLowerCase();
  return lifecycleLabel === "" || lifecycleLabel === "alive";
}

function buildPhaseActions(gameId, phase) {
  const locked = phaseLocked(phase);
  if (locked === true) {
    const actions = [
      freezeHostAction({
        id: "unlock_thread",
        label: "Unlock thread",
        objectLabel: "Main thread",
        outcomeLabel: "allow posts and votes again",
        confirmationText:
          "Unlock main thread: allow posts and votes again for Main thread.",
        requiresConfirmation: true,
        payload: {
          kind: "unlock_thread",
          gameId,
        },
      }),
      freezeHostAction({
        id: "advance_phase",
        label: "Advance phase",
        objectLabel: "Current phase",
        outcomeLabel: "advance to the next pack-defined phase",
        confirmationText:
          "Advance current phase: advance to the next pack-defined phase for Current phase.",
        irreversible: true,
        payload: {
          kind: "advance_phase",
          gameId,
        },
      }),
    ];
    const deadlineAdvance = buildDeadlineAdvanceAction(gameId, phase);
    return deadlineAdvance === null ? actions : Object.freeze([...actions, deadlineAdvance]);
  }
  if (locked === null) {
    return [
      ...buildPhaseActions(gameId, { locked: false }),
      ...buildPhaseActions(gameId, { locked: true }),
    ];
  }
  return [
    freezeHostAction({
      id: "resolve_phase",
      label: "Resolve phase",
      objectLabel: "Current phase",
      outcomeLabel: "run engine resolution and lock the phase",
      confirmationText:
        "Resolve current phase: run engine resolution and lock the phase for Current phase.",
      irreversible: true,
      payload: {
        kind: "resolve_phase",
        gameId,
        seed: 918273,
      },
    }),
    freezeHostAction({
      id: "lock_thread",
      label: "Lock thread",
      objectLabel: "Main thread",
      outcomeLabel: "block new posts and votes",
      confirmationText:
        "Lock main thread: block new posts and votes for Main thread.",
      requiresConfirmation: true,
      payload: {
        kind: "lock_thread",
        gameId,
      },
    }),
  ];
}

function buildDeadlineAdvanceAction(gameId, phase) {
  if (typeof phase?.deadline !== "number" || !Number.isFinite(phase.deadline)) {
    return null;
  }
  const phaseId = typeof phase?.id === "string" && phase.id.trim() !== "" ? phase.id : null;
  if (phaseId === null) {
    return null;
  }
  const observedAt = Math.floor(phase.deadline) + 1;
  return freezeHostAction({
    id: "advance_phase_by_deadline",
    label: "Advance by deadline",
    objectLabel: "Expired phase deadline",
    outcomeLabel: "record deadline evidence and advance to the next pack-defined phase",
    confirmationText:
      "Advance expired phase deadline: record deadline evidence and advance to the next pack-defined phase for Expired phase deadline.",
    irreversible: true,
    payload: {
      kind: "advance_phase_by_deadline",
      gameId,
      phaseId,
      observedAt,
    },
  });
}

function phaseLocked(phase) {
  if (phase?.locked === true || phase?.state === "locked") {
    return true;
  }
  if (phase?.locked === false || phase?.state === "open") {
    return false;
  }
  return null;
}

export function buildHostConsoleActionGroups({
  actions = [],
  pendingPromptCount = 0,
  votecountCount = 0,
  capabilityKind = "HostOf",
} = {}) {
  const actionList = Array.isArray(actions) ? actions : [];
  const groups = [
    freezeHostActionGroup({
      id: "deadline",
      label: "Deadline",
      authority: "CohostOf(game)",
      value: "Extend the active phase deadline",
      boundary: "Typed command",
      boundaryDetail: "ExtendDeadline /commands Ack or Reject",
      actionIds: [
        "extend_deadline",
        ...EXTEND_DEADLINE_PRESETS.map((preset) => preset.id),
      ],
      actions: actionList,
    }),
    freezeHostActionGroup({
      id: "phase",
      label: "Phase and thread",
      authority: "HostOf(game)",
      value: "Advance phase or lock the public thread",
      boundary: "Typed commands",
      boundaryDetail:
        "ResolvePhase, LockThread, UnlockThread, AdvancePhase, AdvancePhaseByDeadline",
      actionIds: [
        "resolve_phase",
        "lock_thread",
        "unlock_thread",
        "advance_phase",
        "advance_phase_by_deadline",
      ],
      actions: actionList,
    }),
    freezeHostActionGroup({
      id: "votecount",
      label: "Votecount",
      authority: "HostOf(game)",
      value:
        votecountCount === 0
          ? "No active projected ballots"
          : `${votecountCount} projected target${votecountCount === 1 ? "" : "s"}`,
      boundary: "Typed command",
      boundaryDetail: "PublishVotecount derives the post body from server projection rows",
      actionIds: ["publish_votecount"],
      actions: actionList,
    }),
    freezeHostActionGroup({
      id: "replacement",
      label: "Replacement",
      authority: "HostOf(game)",
      value: "Swap occupant while preserving slot history",
      boundary: "Typed command",
      boundaryDetail: "ProcessReplacement /commands Ack or Reject",
      actionIds: ["process_replacement"],
      actions: actionList,
    }),
    freezeHostActionGroup({
      id: "host-prompts",
      label: "Host prompts",
      authority: "HostOf(game)",
      value:
        pendingPromptCount === 1
          ? "1 durable prompt pending"
          : `${pendingPromptCount} durable prompts pending`,
      boundary: "Typed command",
      boundaryDetail: "ResolveHostPrompt preserves pack-defined policy",
      actionIds: actionList
        .map((action) => action.id)
        .filter((id) => id.startsWith("resolve_host_prompt-")),
      actions: actionList,
      emptyLabel: "No pending host prompts.",
    }),
    freezeHostActionGroup({
      id: "slot-lifecycle",
      label: "Slot lifecycle",
      authority: "HostOf(game)",
      value: "Mark dead or modkill the active slot",
      boundary: "Typed command",
      boundaryDetail: "SetSlotStatus /commands Ack or Reject",
      actionIds: ["mark_dead", "modkill_slot"],
      actions: actionList,
    }),
    freezeHostActionGroup({
      id: "roles",
      label: "Roles",
      authority: "HostOf(game)",
      value: "Bulk reveal after completion",
      boundary: "Typed command",
      boundaryDetail: "CompleteGame flips final role and alignment reveal state",
      actionIds: ["complete_game"],
      actions: actionList,
    }),
  ];
  return Object.freeze(
    groups.filter((group) =>
      hostActionGroupAllowedForCapability(group, capabilityKind),
    ),
  );
}

export const HOST_CONSOLE_CRITICAL_ACTIONS =
  buildHostConsoleCriticalActions("game-tablet-smoke");

export function hostActionAllowedForCapability(action, capabilityKind) {
  const normalizedCapabilityKind = normalizeHostCapabilityKind(capabilityKind);
  if (normalizedCapabilityKind === "HostOf") {
    return true;
  }
  return action?.payload?.kind === "extend_deadline";
}

function hostActionGroupAllowedForCapability(group, capabilityKind) {
  const normalizedCapabilityKind = normalizeHostCapabilityKind(capabilityKind);
  if (normalizedCapabilityKind === "HostOf") {
    return true;
  }
  return group?.id === "deadline";
}

function normalizeHostCapabilityKind(capabilityKind) {
  return capabilityKind === "CohostOf" ? "CohostOf" : "HostOf";
}

function freezeHostAction(action) {
  return Object.freeze({
    ...action,
    payload: Object.freeze(action.payload),
  });
}

function freezeHostActionGroup({
  id,
  label,
  authority,
  value,
  boundary,
  boundaryDetail,
  actionIds,
  actions,
  emptyLabel = "No command armed.",
}) {
  const actionsById = new Map(actions.map((action) => [action.id, action]));
  const groupedActions = actionIds
    .map((actionId) => actionsById.get(actionId))
    .filter(Boolean);
  return Object.freeze({
    id,
    label,
    authority,
    value,
    boundary,
    boundaryDetail,
    emptyLabel,
    actions: Object.freeze(groupedActions),
  });
}

function stableActionId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]+/g, "-");
}
