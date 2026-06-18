export const HOST_CONSOLE_CRITICAL_ACTION = Object.freeze({
  id: "advance-phase",
  label: "Advance phase",
  objectLabel: "Day 2",
  outcomeLabel: "close thread and enter night",
  irreversible: true,
  payload: Object.freeze({
    gameId: "game-tablet-smoke",
    phaseId: "day-2",
    nextPhase: "night",
  }),
});
