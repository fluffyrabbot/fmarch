export function buildHostConsoleCriticalActions(gameId) {
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
        phaseId: "day-2",
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
