export const PLAYER_ENDGAME_SUMMARY_CONTRACT = Object.freeze({
  componentName: "player-endgame-summary",
  rootClassName: "player-endgame-summary fm-card",
  rootTestId: "player-endgame-summary",
  winnerTestId: "player-endgame-winner",
  revealRowTestIdPrefix: "player-endgame-reveal",
  boundaryTestId: "player-endgame-boundary",
  rowClassName: "player-endgame-summary__row fm-rowlist__row",
  minTouchTargetPx: 44,
});

// Rendered only for completed games. Reveal rows are always visible (never
// collapse-by-default: dev_test lanes waitForRows on visible testids) and read
// only reveal-gated facts from the public endgame summary.
export function buildPlayerEndgameSummaryViewModel({
  endgameSummary = null,
  gameCompleted = false,
} = {}) {
  const completed =
    gameCompleted === true || endgameSummary?.completed === true;
  if (!completed) {
    return null;
  }
  const summary = endgameSummary?.completed === true ? endgameSummary : null;
  const winner = summary?.winner ?? null;
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
          : `${humanizeTag(winner.alignment)} wins`,
      detail:
        winner === null
          ? "The engine result has not been published to this surface yet; reload after the host completes the reveal."
          : winner.reason,
      phaseId: winner?.phaseId ?? "",
    }),
    rows: Object.freeze(
      (summary?.slots ?? []).map((slot) =>
        Object.freeze({
          testId: `${PLAYER_ENDGAME_SUMMARY_CONTRACT.revealRowTestIdPrefix}-${slot.slotId}`,
          className: PLAYER_ENDGAME_SUMMARY_CONTRACT.rowClassName,
          slotLabel: humanizeTag(slot.slotId),
          roleLabel:
            slot.roleRevealed && slot.roleKey !== null
              ? humanizeTag(slot.roleKey)
              : "Unrevealed",
          alignmentLabel:
            slot.alignmentRevealed && slot.alignment !== null
              ? humanizeTag(slot.alignment)
              : "Unrevealed",
          fateLabel: slot.alive ? "Survived" : humanizeTag(slot.status || "dead"),
          minTouchTargetPx: PLAYER_ENDGAME_SUMMARY_CONTRACT.minTouchTargetPx,
        }),
      ),
    ),
    boundary: Object.freeze({
      testId: PLAYER_ENDGAME_SUMMARY_CONTRACT.boundaryTestId,
      message:
        summary?.boundary && summary.boundary !== ""
          ? summary.boundary
          : "The game is complete; final role and alignment facts appear as the projection reveals them.",
    }),
  });
}

function humanizeTag(tag) {
  const spaced = String(tag ?? "").replaceAll("_", " ").replaceAll("-", " ").trim();
  if (spaced === "") {
    return "Unknown";
  }
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
