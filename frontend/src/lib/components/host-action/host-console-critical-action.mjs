export function buildHostConsoleCriticalActions(gameId, { hostPrompts = [] } = {}) {
  return Object.freeze([
    freezeHostAction({
      id: "extend_deadline",
      label: "Extend deadline",
      objectLabel: "Day 2 deadline",
      outcomeLabel: "move the deadline to June 19, 2026 at 9:00 PM PT",
      confirmationText:
        "Extend Day 2 deadline: move the deadline to June 19, 2026 at 9:00 PM PT for Day 2 deadline.",
      irreversible: true,
      payload: {
        kind: "extend_deadline",
        gameId,
        phaseId: "D01",
        deadlineId: "deadline-day-2",
        extendsTo: "2026-06-20T04:00:00Z",
      },
    }),
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
      .map((prompt) =>
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
            decision:
              prompt.decisionKind === "select_slot"
                ? { kind: "select_slot", slot: prompt.subjectSlot }
                : { kind: "acknowledge" },
          },
        }),
      ),
  ]);
}

export function buildHostConsoleActionGroups({
  actions = [],
  pendingPromptCount = 0,
  votecountCount = 0,
} = {}) {
  const actionList = Array.isArray(actions) ? actions : [];
  return Object.freeze([
    freezeHostActionGroup({
      id: "deadline",
      label: "Deadline",
      authority: "HostOf(game)",
      value: "Extend the active phase deadline",
      boundary: "Typed command",
      boundaryDetail: "ExtendDeadline /commands Ack or Reject",
      actionIds: ["extend_deadline"],
      actions: actionList,
    }),
    freezeHostActionGroup({
      id: "phase",
      label: "Phase and thread",
      authority: "HostOf(game)",
      value: "Advance phase or lock the public thread",
      boundary: "Typed commands",
      boundaryDetail: "LockThread, UnlockThread, AdvancePhase",
      actionIds: ["lock_thread", "unlock_thread", "advance_phase"],
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
  ]);
}

export const HOST_CONSOLE_CRITICAL_ACTIONS =
  buildHostConsoleCriticalActions("game-tablet-smoke");

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
