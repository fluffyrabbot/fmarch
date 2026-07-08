import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PLAYER_ENDGAME_SUMMARY_CONTRACT,
  buildPlayerEndgameSummaryViewModel,
} from "./player-endgame-summary-model.mjs";

const REVEALED_SUMMARY = Object.freeze({
  completed: true,
  winner: Object.freeze({
    alignment: "town",
    reason: "all mafia eliminated",
    phaseId: "D05",
  }),
  slots: Object.freeze([
    Object.freeze({
      slotId: "slot-2",
      alive: false,
      status: "dead",
      roleKey: "mafia_goon",
      alignment: "mafia",
      roleRevealed: true,
      alignmentRevealed: true,
    }),
    Object.freeze({
      slotId: "slot-7",
      alive: true,
      status: "alive",
      roleKey: "vanilla_townie",
      alignment: "town",
      roleRevealed: true,
      alignmentRevealed: true,
    }),
  ]),
  boundary: "Endgame summary is reveal-gated.",
});

test("endgame summary renders winner banner and reveal rows for completed games", () => {
  const view = buildPlayerEndgameSummaryViewModel({
    endgameSummary: REVEALED_SUMMARY,
    gameCompleted: true,
  });
  assert.equal(view.root.testId, PLAYER_ENDGAME_SUMMARY_CONTRACT.rootTestId);
  assert.equal(view.root.data.state, "revealed");
  assert.equal(view.root.data.winnerAlignment, "town");
  assert.equal(view.winner.label, "Town wins");
  assert.equal(view.winner.detail, "all mafia eliminated");
  assert.equal(view.winner.phaseId, "D05");
  assert.deepEqual(
    view.rows.map((row) => [
      row.testId,
      row.roleLabel,
      row.alignmentLabel,
      row.fateLabel,
    ]),
    [
      ["player-endgame-reveal-slot-2", "Mafia goon", "Mafia", "Dead"],
      ["player-endgame-reveal-slot-7", "Vanilla townie", "Town", "Survived"],
    ],
  );
});

test("endgame summary is absent while the game is running", () => {
  assert.equal(
    buildPlayerEndgameSummaryViewModel({
      endgameSummary: null,
      gameCompleted: false,
    }),
    null,
  );
});

test("completed game without published summary shows a pending result", () => {
  const view = buildPlayerEndgameSummaryViewModel({
    endgameSummary: null,
    gameCompleted: true,
  });
  assert.equal(view.root.data.state, "pending");
  assert.equal(view.winner.label, "Result pending");
  assert.deepEqual(view.rows, []);
  assert.match(view.boundary.message, /final role and alignment facts/u);
});

test("unrevealed slots stay unrevealed in the table", () => {
  const view = buildPlayerEndgameSummaryViewModel({
    endgameSummary: {
      ...REVEALED_SUMMARY,
      slots: [
        {
          slotId: "slot-3",
          alive: true,
          status: "alive",
          roleKey: null,
          alignment: null,
          roleRevealed: false,
          alignmentRevealed: false,
        },
      ],
    },
    gameCompleted: true,
  });
  assert.deepEqual(
    view.rows.map((row) => [row.roleLabel, row.alignmentLabel]),
    [["Unrevealed", "Unrevealed"]],
  );
});
