export const DAY_VOTE_OUTCOME_PANEL_CONTRACT = Object.freeze({
  componentName: "day-vote-outcome-panel",
  rootClassName: "day-vote-outcome-panel fm-section",
  emptyClassName: "day-vote-outcome-panel__empty",
  tallyClassName:
    "day-vote-outcome-panel__tally fm-rowlist__row fm-rowlist__row--stack",
  minRowTargetPx: 44,
});

export function buildDayVoteOutcomePanelViewModel({
  outcomes = [],
  heading = "Day vote outcome",
  rootTestId = "day-vote-outcome",
  boundary = {},
  roster = [],
} = {}) {
  const normalized = Array.isArray(outcomes) ? outcomes : [];
  const latest = normalized.at(-1) ?? null;
  const names = seatNames(roster);
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
      statusLabel: "Official result",
      command: boundary.command ?? "/day-vote-outcomes",
      label: "Official record",
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
            phaseLabel: phaseLabelFromId(latest.phaseId) ?? latest.phaseId,
            status: latest.status,
            winnerSlot: latest.winnerSlot,
            winnerLabel: outcomeWinnerLabel(latest, names),
            summary: outcomeSummary(latest, names),
            reason: outcomeReasonLabel(latest, names),
            testId: `${rootTestId}-latest`,
          }),
    tallies: Object.freeze(outcomeTallies(latest, names).map((row) => Object.freeze({
      ...row,
      testId: `${rootTestId}-tally-${sanitizeTestId(row.slot)}`,
      minTargetPx: DAY_VOTE_OUTCOME_PANEL_CONTRACT.minRowTargetPx,
    }))),
    classes: Object.freeze({
      tally: DAY_VOTE_OUTCOME_PANEL_CONTRACT.tallyClassName,
    }),
  });
}

// A seat is named as of the resolution, so an elimination keeps the name the
// eliminated persona held when the vote resolved.
function outcomeSeatLabel(outcome, slot, names) {
  const at = Number(outcome.sourceSeq);
  return slot === "no_lynch" || slot === "NoLynch"
    ? voteTargetLabel(slot)
    : names.label(slot, { at: Number.isSafeInteger(at) && at > 0 ? at : null });
}

function outcomeSummary(outcome, names) {
  if (outcome.status === "Lynch" && typeof outcome.winnerSlot === "string") {
    return `${outcomeSeatLabel(outcome, outcome.winnerSlot, names)} was eliminated by official vote.`;
  }
  if (outcome.status === "NoLynch") {
    return "The official vote resolved without an elimination.";
  }
  if (typeof outcome.winnerSlot === "string") {
    return `${outcome.status}: ${outcomeSeatLabel(outcome, outcome.winnerSlot, names)}`;
  }
  return outcome.status;
}

function outcomeWinnerLabel(outcome, names) {
  if (typeof outcome.winnerSlot === "string" && outcome.winnerSlot.trim() !== "") {
    return outcomeSeatLabel(outcome, outcome.winnerSlot, names);
  }
  return outcome.status === "NoLynch" ? "No lynch" : "No winner";
}

function outcomeReasonLabel(outcome, names) {
  if (
    outcome.reason === "host_decides_tie" &&
    typeof outcome.winnerSlot === "string"
  ) {
    return `The host chose ${outcomeSeatLabel(outcome, outcome.winnerSlot, names)} to break the tie.`;
  }
  return outcome.reason;
}

function outcomeTallies(outcome, names) {
  if (outcome === null || outcome.tallies === null || typeof outcome.tallies !== "object") {
    return [];
  }
  return Object.entries(outcome.tallies)
    .map(([slot, count]) => ({
      slot,
      slotLabel: outcomeSeatLabel(outcome, slot, names),
      count: Number(count),
      majority: outcome.majority,
    }))
    .filter((row) => Number.isFinite(row.count))
    .sort((left, right) => right.count - left.count || left.slot.localeCompare(right.slot));
}


function sanitizeTestId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]+/g, "_");
}
import { phaseLabelFromId } from "../../phase-id.mjs";
import { seatNames, voteTargetLabel } from "../../app/seat-presenter.mjs";
