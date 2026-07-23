export const PLAYER_DAY_EVENT_RAIL_CONTRACT = Object.freeze({
  componentName: "player-day-event-rail",
  testId: "player-day-event-rail",
  minTouchTargetPx: 44,
});

export function buildPlayerDayEventRailViewModel({
  commands = [],
  commandPending = false,
  commandInterrupted = false,
  player = {},
} = {}) {
  const unavailable =
    commandPending ||
    commandInterrupted ||
    player.gameCompleted === true ||
    player.readOnly === true;
  const items = commands.map((command) =>
    Object.freeze({
      eventId: String(command.eventId),
      action: String(command.action),
      label: String(command.label),
      detail: String(command.detail ?? ""),
      status: String(command.status ?? "available"),
      disabled: unavailable,
      minTouchTargetPx: PLAYER_DAY_EVENT_RAIL_CONTRACT.minTouchTargetPx,
      testId: `player-day-event-${stableTestId(command.eventId)}`,
    }),
  );
  return Object.freeze({
    root: Object.freeze({
      componentName: PLAYER_DAY_EVENT_RAIL_CONTRACT.componentName,
      testId: PLAYER_DAY_EVENT_RAIL_CONTRACT.testId,
      ariaBusy: commandPending ? "true" : undefined,
    }),
    heading: "Open events",
    summary:
      items.length === 1
        ? "1 event needs your attention"
        : `${items.length} events need your attention`,
    items: Object.freeze(items),
  });
}

function stableTestId(value) {
  return String(value).replace(/[^a-z0-9_-]+/giu, "-").toLowerCase();
}
