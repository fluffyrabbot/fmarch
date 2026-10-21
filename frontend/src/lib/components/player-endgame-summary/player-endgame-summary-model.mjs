import { buildRoleCardViewModel } from "../role-card/role-card-model.mjs";
export const PLAYER_ENDGAME_SUMMARY_CONTRACT = Object.freeze({
  componentName: "player-endgame-summary",
  rootClassName: "player-endgame-summary fm-card",
  rootTestId: "player-endgame-summary",
  winnerTestId: "player-endgame-winner",
  revealRowTestIdPrefix: "player-endgame-reveal",
  voteHistoryTestId: "player-endgame-vote-history",
  voteRowTestIdPrefix: "player-endgame-vote",
  boundaryTestId: "player-endgame-boundary",
  rowClassName: "player-endgame-summary__row fm-rowlist__row",
  voteRowClassName:
    "player-endgame-summary__vote-row fm-rowlist__row fm-rowlist__row--stack",
  minTouchTargetPx: 44,
});

// Rendered only for completed games. Reveal rows are always visible (never
// collapse-by-default: dev_test lanes waitForRows on visible testids) and read
// only reveal-gated facts from the public endgame summary.
export function buildPlayerEndgameSummaryViewModel({
  endgameSummary = null,
  gameCompleted = false,
  roster = [],
} = {}) {
  const names = seatNames(roster);
  const completed =
    gameCompleted === true || endgameSummary?.completed === true;
  if (!completed) {
    return null;
  }
  const summary = endgameSummary?.completed === true ? endgameSummary : null;
  const winner = summary?.winner ?? null;
  const revealedRole = (slot) =>
    slot.roleRevealed && slot.role != null ? slot.role : null;
  const winnerAlignment = (summary?.slots ?? [])
    .map(revealedRole)
    .find((role) => role !== null && role.alignment.key === winner?.alignment)?.alignment;
  return Object.freeze({
    root: Object.freeze({
      className: PLAYER_ENDGAME_SUMMARY_CONTRACT.rootClassName,
      testId: PLAYER_ENDGAME_SUMMARY_CONTRACT.rootTestId,
      data: Object.freeze({
        component: PLAYER_ENDGAME_SUMMARY_CONTRACT.componentName,
        state: summary === null ? "pending" : "revealed",
        winnerAlignment: winner?.alignment ?? "",
      }),
    }),
    heading: "Endgame",
    eyebrow: "Final result",
    winner: Object.freeze({
      testId: PLAYER_ENDGAME_SUMMARY_CONTRACT.winnerTestId,
      label:
        winner === null
          ? "Result pending"
          : `${winnerAlignment?.label ?? humanizeTag(winner.alignment)} wins`,
      detail:
        winner === null
          ? "The result is not public yet; it appears here once the host completes the reveal."
          : winner.reason,
      phaseId: winner?.phaseId ?? "",
      phaseLabel: phaseLabelFromId(winner?.phaseId),
    }),
    rows: Object.freeze(
      (summary?.slots ?? []).map((slot) =>
        Object.freeze({
          testId: `${PLAYER_ENDGAME_SUMMARY_CONTRACT.revealRowTestIdPrefix}-${slot.slotId}`,
          className: PLAYER_ENDGAME_SUMMARY_CONTRACT.rowClassName,
          slotLabel: names.label(slot.slotId),
          roleLabel:
            revealedRole(slot)?.name ??
            (slot.roleRevealed && slot.roleKey !== null
              ? humanizeTag(slot.roleKey)
              : "Unrevealed"),
          // Chip and modal cards exist only for roles the projection revealed.
          roleChip:
            revealedRole(slot) === null
              ? null
              : buildRoleCardViewModel({ role: revealedRole(slot), variant: "chip" }),
          roleCard:
            revealedRole(slot) === null
              ? null
              : buildRoleCardViewModel({ role: revealedRole(slot), variant: "full" }),
          alignmentLabel:
            slot.alignmentRevealed && slot.alignment !== null
              ? revealedRole(slot)?.alignment.label ?? humanizeTag(slot.alignment)
              : "Unrevealed",
          fateLabel: slot.alive ? "Survived" : humanizeTag(slot.status || "dead"),
          minTouchTargetPx: PLAYER_ENDGAME_SUMMARY_CONTRACT.minTouchTargetPx,
        }),
      ),
    ),
    voteHistory: Object.freeze({
      testId: PLAYER_ENDGAME_SUMMARY_CONTRACT.voteHistoryTestId,
      heading: "Vote history",
      rows: Object.freeze(
        (summary?.voteHistory ?? []).map((outcome) =>
          Object.freeze({
            testId: `${PLAYER_ENDGAME_SUMMARY_CONTRACT.voteRowTestIdPrefix}-${outcome.phaseId}-${outcome.sourceSeq}-${outcome.eventIndex}`,
            className: PLAYER_ENDGAME_SUMMARY_CONTRACT.voteRowClassName,
            phaseLabel: phaseLabelFromId(outcome.phaseId) ?? outcome.phaseId,
            resultLabel: endgameVoteResultLabel(outcome, names),
            tallyLabel: endgameVoteTallyLabel(outcome, names),
            ballotLabel: endgameVoteBallotLabel(outcome, names),
            majorityLabel:
              outcome.majority === null
                ? "Majority not recorded"
                : `Majority ${outcome.majority}`,
            minTouchTargetPx: PLAYER_ENDGAME_SUMMARY_CONTRACT.minTouchTargetPx,
          }),
        ),
      ),
    }),
    boundary: Object.freeze({
      testId: PLAYER_ENDGAME_SUMMARY_CONTRACT.boundaryTestId,
      message:
        summary?.boundary && summary.boundary !== ""
          ? summary.boundary
          : "The game is complete; final role and alignment facts appear as the projection reveals them.",
    }),
  });
}

// Vote history names each seat as of its resolution.
function seatAt(outcome, slot, names) {
  if (slot === "no_lynch" || slot === "NoLynch") {
    return "No lynch";
  }
  const at = Number(outcome.sourceSeq);
  return names.label(slot, { at: Number.isSafeInteger(at) && at > 0 ? at : null });
}

function endgameVoteResultLabel(outcome, names) {
  if (outcome.status === "Lynch" && outcome.winnerSlot !== null) {
    return `Lynch: ${seatAt(outcome, outcome.winnerSlot, names)}`;
  }
  return humanizeTag(outcome.status);
}

function endgameVoteTallyLabel(outcome, names) {
  const rows = Object.entries(outcome.tallies ?? {});
  return rows.length === 0
    ? "No final tally"
    : rows
        .map(([target, count]) => `${seatAt(outcome, target, names)}: ${count}`)
        .join("; ");
}

function endgameVoteBallotLabel(outcome, names) {
  const rows = Object.entries(outcome.votes ?? {});
  return rows.length === 0
    ? "No ballots recorded"
    : rows
        .map(
          ([actor, target]) =>
            `${seatAt(outcome, actor, names)} to ${seatAt(outcome, target, names)}`,
        )
        .join("; ");
}

function humanizeTag(tag) {
  const spaced = String(tag ?? "")
    .replace(/([a-z])([A-Z])/gu, "$1 $2")
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .trim();
  if (spaced === "") {
    return "Unknown";
  }
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}
import { phaseLabelFromId } from "../../phase-id.mjs";
import { seatNames } from "../../app/seat-presenter.mjs";
