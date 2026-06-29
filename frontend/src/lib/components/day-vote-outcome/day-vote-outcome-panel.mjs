export const DAY_VOTE_OUTCOME_PANEL_CONTRACT = Object.freeze({
  componentName: "day-vote-outcome-panel",
  rootClassName: "day-vote-outcome-panel",
  emptyClassName: "day-vote-outcome-panel__empty",
  tallyClassName: "day-vote-outcome-panel__tally",
  minRowTargetPx: 44,
});

export function buildDayVoteOutcomePanelViewModel({
  outcomes = [],
  heading = "Day vote outcome",
  rootTestId = "day-vote-outcome",
  boundary = {},
} = {}) {
  const normalized = Array.isArray(outcomes) ? outcomes : [];
  const latest = normalized.at(-1) ?? null;
  return Object.freeze({
    root: Object.freeze({
      className: DAY_VOTE_OUTCOME_PANEL_CONTRACT.rootClassName,
      testId: rootTestId,
      ariaLabel: heading,
      data: Object.freeze({
        component: DAY_VOTE_OUTCOME_PANEL_CONTRACT.componentName,
        state: latest === null ? "empty" : "available",
      }),
    }),
    heading,
    boundary: Object.freeze({
      status: boundary.status ?? "REST projection",
      command: boundary.command ?? "/day-vote-outcomes",
      commandTestId: `${rootTestId}-boundary`,
    }),
    empty: Object.freeze({
      className: DAY_VOTE_OUTCOME_PANEL_CONTRACT.emptyClassName,
      message: "No official day vote result",
    }),
    latest:
      latest === null
        ? null
        : Object.freeze({
            phaseId: latest.phaseId,
            status: latest.status,
            winnerSlot: latest.winnerSlot,
            winnerLabel: outcomeWinnerLabel(latest),
            summary: outcomeSummary(latest),
            reason: latest.reason,
            testId: `${rootTestId}-latest`,
          }),
    tallies: Object.freeze(outcomeTallies(latest).map((row) => Object.freeze({
      ...row,
      testId: `${rootTestId}-tally-${sanitizeTestId(row.slot)}`,
      minTargetPx: DAY_VOTE_OUTCOME_PANEL_CONTRACT.minRowTargetPx,
    }))),
    classes: Object.freeze({
      tally: DAY_VOTE_OUTCOME_PANEL_CONTRACT.tallyClassName,
    }),
  });
}

function outcomeSummary(outcome) {
  if (outcome.status === "Lynch" && typeof outcome.winnerSlot === "string") {
    return `${slotDisplayLabel(outcome.winnerSlot)} was eliminated by official vote.`;
  }
  if (outcome.status === "NoLynch") {
    return "The official vote resolved without an elimination.";
  }
  if (typeof outcome.winnerSlot === "string") {
    return `${outcome.status}: ${slotDisplayLabel(outcome.winnerSlot)}`;
  }
  return outcome.status;
}

function outcomeWinnerLabel(outcome) {
  if (typeof outcome.winnerSlot === "string" && outcome.winnerSlot.trim() !== "") {
    return slotDisplayLabel(outcome.winnerSlot);
  }
  return outcome.status === "NoLynch" ? "No lynch" : "No winner";
}

function outcomeTallies(outcome) {
  if (outcome === null || outcome.tallies === null || typeof outcome.tallies !== "object") {
    return [];
  }
  return Object.entries(outcome.tallies)
    .map(([slot, count]) => ({
      slot,
      slotLabel: slotDisplayLabel(slot),
      count: Number(count),
      majority: outcome.majority,
    }))
    .filter((row) => Number.isFinite(row.count))
    .sort((left, right) => right.count - left.count || left.slot.localeCompare(right.slot));
}

function slotDisplayLabel(slotId) {
  const normalized = String(slotId);
  if (normalized === "no_lynch") {
    return "No lynch";
  }
  const suffix = normalized.match(/\d+/)?.[0];
  return suffix === undefined ? normalized : `Slot ${suffix}`;
}

function sanitizeTestId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]+/g, "_");
}
