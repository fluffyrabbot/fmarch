import test from "node:test";
import assert from "node:assert/strict";
import {
  stalePlayerVoteAfterChangeAckMatches,
  stalePlayerPhaseClosurePostAckMatches,
  stalePlayerPhaseClosureRejectMatches,
  stalePlayerWithdrawAfterChangeAckMatches,
} from "./dev_test_game_stale_player_command_assertions.mjs";

const basePhaseClosureFixture = () => ({
  status: "passed",
  hostEntry: { capabilityKinds: ["HostOf"] },
  playerEntry: { capabilityKinds: ["SlotOccupant"] },
  commandStateBeforeClose: {
    actorSlot: "slot-7",
    phase: { phaseId: "D01", locked: false },
    currentVote: { slotId: "slot-2" },
  },
  currentVoteBeforeClose: { hasVote: "true" },
  closedStatus: { state: "closed" },
  resolveDay: { commandStatus: { state: "ack" } },
  hostAfterResolve: {
    phase: { locked: true },
    dayVoteOutcomes: [
      { phaseId: "D01", status: "Lynch", winnerSlot: "slot-2" },
    ],
  },
  apiCommandStateAfterResolve: {
    phase: { locked: true },
    current_vote: null,
    vote_targets: [],
  },
});

const phaseClosedRejectState = () => ({
  dispatchPlan: { projectionRefreshKeys: ["votecount", "commandState"] },
  commandStateAfterReject: {
    phase: { locked: true },
    voteTargets: [],
    currentVote: null,
  },
  currentVoteAfterReject: { hasVote: "false" },
  withdrawAfterReject: { disabled: true, reason: "No current vote" },
  buttonsAfterReject: [
    { action: "submit_post", disabled: false },
    { action: "withdraw_vote", disabled: true },
  ],
  dayVoteOutcomesAfterReject: [
    { phaseId: "D01", status: "Lynch", winnerSlot: "slot-2" },
  ],
  apiCommandStateAfterReject: {
    phase: { locked: true },
    vote_targets: [],
    current_vote: null,
  },
});

const staleWithdrawFixture = () => ({
  ...basePhaseClosureFixture(),
  withdrawBeforeClose: { exists: true, disabled: false },
  staleWithdraw: {
    state: "reject",
    error: "PhaseLocked",
    serverEnvelope: { body: { kind: "Reject" } },
    requestEnvelope: {
      body: {
        body: {
          command: { WithdrawVote: { actor_slot: "slot-7" } },
        },
      },
    },
  },
  ...phaseClosedRejectState(),
});

const staleVoteFixture = () => ({
  ...basePhaseClosureFixture(),
  staleVoteTarget: { kind: "slot", slotId: "slot-3" },
  staleVoteButton: { disabled: false },
  staleVote: {
    state: "reject",
    error: "PhaseLocked",
    serverEnvelope: { body: { kind: "Reject" } },
    requestEnvelope: {
      body: {
        body: {
          command: { SubmitVote: { actor_slot: "slot-7" } },
        },
      },
    },
  },
  ...phaseClosedRejectState(),
});

const stalePostFixture = () => ({
  ...basePhaseClosureFixture(),
  submitPostBeforeClose: { disabled: false },
  postBody: "Stale phase closure post",
  stalePost: {
    state: "ack",
    serverEnvelope: { body: { kind: "Ack" } },
    streamSeqs: [101],
    requestEnvelope: {
      body: {
        body: {
          command: {
            SubmitPost: {
              actor_slot: "slot-7",
              channel_id: "main",
              body: "Stale phase closure post",
            },
          },
        },
      },
    },
  },
  dispatchPlan: {
    projectionRefreshKeys: [
      "thread",
      "votecount",
      "commandState",
      "dayVoteOutcomes",
    ],
  },
  projectedPost: { body: "Stale phase closure post", authorSlot: "slot-7" },
  commandStateAfterAck: {
    phase: { locked: true },
    voteTargets: [],
    currentVote: null,
  },
  currentVoteAfterAck: { hasVote: "false" },
  withdrawAfterAck: { disabled: true, reason: "No current vote" },
  buttonsAfterAck: [{ action: "submit_post", disabled: false }],
  dayVoteOutcomesAfterAck: [
    { phaseId: "D01", status: "Lynch", winnerSlot: "slot-2" },
  ],
  apiCommandStateAfterAck: {
    phase: { locked: true },
    vote_targets: [],
    current_vote: null,
  },
  apiThreadAfterAck: {
    posts: [{ body: "Stale phase closure post", author_slot: "slot-7" }],
  },
});

const apiVotecountRows = (...targets) =>
  targets.map(([target, count]) => ({
    kind: "VoteCountChanged",
    body: { phase_id: "D02", candidate_slot: target, count },
  }));

const staleVoteAfterChangeFixture = () => ({
  status: "passed",
  staleVoteTarget: { kind: "slot", slotId: "slot-3" },
  commandStateBeforeClose: {
    currentVote: null,
    voteTargets: [{ kind: "slot", slotId: "slot-3" }],
  },
  staleVoteButton: { disabled: false },
  closedStatus: { state: "closed" },
  actionVote: { state: "ack" },
  apiVotecountAfterActionVote: apiVotecountRows(["no_lynch", 1]),
  staleVote: {
    state: "ack",
    requestEnvelope: {
      body: {
        body: {
          command: { SubmitVote: { target: { Slot: "slot-3" } } },
        },
      },
    },
  },
  commandStateAfterAck: { currentVote: { slotId: "slot-3" } },
  votecountAfterAck: [
    { target: "no_lynch", count: 1 },
    { target: "slot-3", count: 1 },
  ],
  dispatchPlan: { projectionRefreshKeys: ["votecount", "commandState"] },
  currentVoteAfterAck: { hasVote: "true" },
  apiVotecountAfterAck: apiVotecountRows(["no_lynch", 1], ["slot-3", 1]),
  apiCommandStateAfterAck: { current_vote: { slot_id: "slot-3" } },
  withdrawPlayer: { state: "ack" },
  withdrawAction: { state: "ack" },
  apiVotecountAfterCleanup: [],
  apiCommandStateAfterCleanup: { current_vote: null },
});

const staleWithdrawAfterChangeFixture = () => ({
  status: "passed",
  commandStateBeforeVote: { currentVote: null },
  staleVoteTarget: { kind: "slot", slotId: "slot-3" },
  staleVoteButton: { disabled: false },
  initialVote: { state: "ack" },
  commandStateBeforeClose: { currentVote: { slotId: "slot-3" } },
  currentVoteBeforeClose: { hasVote: "true" },
  withdrawBeforeClose: { exists: true, disabled: false },
  closedStatus: { state: "closed" },
  liveChangeVote: { state: "ack" },
  apiCommandStateAfterLiveChange: { current_vote: { kind: "no_lynch" } },
  apiVotecountAfterLiveChange: apiVotecountRows(["no_lynch", 1]),
  staleWithdraw: {
    state: "ack",
    requestEnvelope: {
      body: {
        body: {
          command: { WithdrawVote: { actor_slot: "slot-7" } },
        },
      },
    },
  },
  commandStateAfterWithdraw: { currentVote: null },
  votecountAfterWithdraw: [],
  dispatchPlan: { projectionRefreshKeys: ["votecount", "commandState"] },
  currentVoteAfterWithdraw: { hasVote: "false", text: "No current vote" },
  withdrawAfterAck: { disabled: true, reason: "No current vote" },
  apiCommandStateAfterWithdraw: { current_vote: null },
  apiVotecountAfterWithdraw: [],
});

test("stale withdraw phase-closure reject assertion covers refreshed controls", () => {
  assert.equal(
    stalePlayerPhaseClosureRejectMatches(staleWithdrawFixture(), {
      commandField: "staleWithdraw",
      commandName: "WithdrawVote",
      beforeCommandMatches: (proof) =>
        proof.withdrawBeforeClose?.exists === true &&
        proof.withdrawBeforeClose?.disabled === false,
    }),
    true,
  );
});

test("stale vote phase-closure reject assertion covers refreshed controls", () => {
  assert.equal(
    stalePlayerPhaseClosureRejectMatches(staleVoteFixture(), {
      commandField: "staleVote",
      commandName: "SubmitVote",
      beforeCommandMatches: (proof) =>
        proof.staleVoteTarget !== undefined &&
        proof.staleVoteButton?.disabled === false,
    }),
    true,
  );
});

test("stale player phase-closure reject assertion rejects leaked vote controls", () => {
  const proof = staleVoteFixture();
  proof.buttonsAfterReject.push({ action: "submit_vote:slot-3", disabled: false });

  assert.equal(
    stalePlayerPhaseClosureRejectMatches(proof, {
      commandField: "staleVote",
      commandName: "SubmitVote",
      beforeCommandMatches: () => true,
    }),
    false,
  );
});

test("stale post phase-closure ACK assertion covers thread and controls", () => {
  assert.equal(stalePlayerPhaseClosurePostAckMatches(stalePostFixture()), true);
});

test("stale post phase-closure ACK assertion requires day-vote outcome refresh", () => {
  const proof = stalePostFixture();
  proof.dispatchPlan.projectionRefreshKeys = ["thread", "commandState"];

  assert.equal(stalePlayerPhaseClosurePostAckMatches(proof), false);
});

test("stale vote-after-change ACK assertion covers changed votecount recovery", () => {
  assert.equal(
    stalePlayerVoteAfterChangeAckMatches(staleVoteAfterChangeFixture()),
    true,
  );
});

test("stale vote-after-change ACK assertion requires command-state refresh", () => {
  const proof = staleVoteAfterChangeFixture();
  proof.dispatchPlan.projectionRefreshKeys = ["votecount"];

  assert.equal(stalePlayerVoteAfterChangeAckMatches(proof), false);
});

test("stale withdraw-after-change ACK assertion covers ballot cleanup recovery", () => {
  assert.equal(
    stalePlayerWithdrawAfterChangeAckMatches(staleWithdrawAfterChangeFixture()),
    true,
  );
});

test("stale withdraw-after-change ACK assertion rejects leaked stale target rows", () => {
  const proof = staleWithdrawAfterChangeFixture();
  proof.apiVotecountAfterLiveChange.push(...apiVotecountRows(["slot-3", 1]));

  assert.equal(stalePlayerWithdrawAfterChangeAckMatches(proof), false);
});
