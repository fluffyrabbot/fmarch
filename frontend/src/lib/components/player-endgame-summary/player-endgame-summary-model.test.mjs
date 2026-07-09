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
  voteHistory: Object.freeze([
    Object.freeze({
      phaseId: "D04",
      sourceSeq: 91,
      eventIndex: 0,
      status: "Lynch",
      winnerSlot: "slot-2",
      tallies: Object.freeze({ "slot-2": 3 }),
      votes: Object.freeze({
        "slot-3": "slot-2",
        "slot-7": "slot-2",
        slot_4: "slot-2",
      }),
      majority: 3,
      reason: null,
    }),
    Object.freeze({
      phaseId: "D05",
      sourceSeq: 99,
      eventIndex: 0,
      status: "NoLynch",
      winnerSlot: null,
      tallies: Object.freeze({ no_lynch: 2 }),
      votes: Object.freeze({ "slot-3": "no_lynch", "slot-7": "no_lynch" }),
      majority: 2,
      reason: null,
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
  assert.deepEqual(
    view.voteHistory.rows.map((row) => [
      row.testId,
      row.resultLabel,
      row.tallyLabel,
      row.ballotLabel,
      row.majorityLabel,
    ]),
    [
      [
        "player-endgame-vote-D04-91-0",
        "Lynch: Slot 2",
        "Slot 2: 3",
        "Slot 3 to Slot 2; Slot 7 to Slot 2; Slot 4 to Slot 2",
        "Majority 3",
      ],
      [
        "player-endgame-vote-D05-99-0",
        "No lynch",
        "No lynch: 2",
        "Slot 3 to No lynch; Slot 7 to No lynch",
        "Majority 2",
      ],
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
  assert.deepEqual(view.voteHistory.rows, []);
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
