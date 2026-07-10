import {
  completedGameEndgameRecoveryFeatureSpineRows,
} from "./dev_test_game_core_loop_completed_terminal_scenario_assertions.mjs";

export function coreLoopSpineRowsFixture() {
  return {
    cycles: [
      "d01-n01-d02",
      "d02-n02",
      "n02-d03",
      "d03-n03",
      "n03-d04",
      "d04-n04-d05",
      "d05-n05",
      "earliest-reached",
    ],
    roleUrls: [
      "d01-n01-d02-host",
      "d01-n01-d02-actionPlayer",
      "d01-n01-d02-normalPlayer",
      "d01-n01-d02-target",
      "d01-n01-d02-privateChannel",
      "d02-n02-host",
      "d02-n02-actionPlayer",
      "d02-n02-normalPlayer",
      "d02-n02-target",
      "n02-d03-host",
      "n02-d03-actionPlayer",
      "n02-d03-normalPlayer",
      "d03-n03-host",
      "d03-n03-actionPlayer",
      "d03-n03-normalPlayer",
      "n03-d04-host",
      "n03-d04-actionPlayer",
      "n03-d04-target",
      "d04-n04-d05-host",
      "d04-n04-d05-actionPlayer",
      "d04-n04-d05-deadPlayer",
      "d05-n05-host",
      "d05-n05-actionPlayer",
      "earliest-reached-host",
    ],
    roleUrlHrefs: {
      "d01-n01-d02-host":
        "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000001/host",
      "d01-n01-d02-actionPlayer":
        "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000001",
      "d01-n01-d02-normalPlayer":
        "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000001",
      "d01-n01-d02-target":
        "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000001",
      "d01-n01-d02-privateChannel":
        "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000001/c/private%3Amafia_day_chat",
      "d02-n02-host":
        "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002/host",
      "d02-n02-actionPlayer":
        "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002",
      "d02-n02-normalPlayer":
        "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002",
      "d02-n02-target":
        "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002",
      "n02-d03-host":
        "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002/host",
      "n02-d03-actionPlayer":
        "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002",
      "n02-d03-normalPlayer":
        "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002",
      "d03-n03-host":
        "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002/host",
      "d03-n03-actionPlayer":
        "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002",
      "d03-n03-normalPlayer":
        "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002",
      "n03-d04-host":
        "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002/host",
      "n03-d04-actionPlayer":
        "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002",
      "n03-d04-target":
        "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002",
      "d04-n04-d05-host":
        "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002/host",
      "d04-n04-d05-actionPlayer":
        "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002",
      "d04-n04-d05-deadPlayer":
        "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002",
      "d05-n05-host":
        "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002/host",
      "d05-n05-actionPlayer":
        "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002",
      "earliest-reached-host":
        "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000003/host",
    },
    checkpoints: [
      "d01-n01-d02-d01-resolved-locked",
      "d01-n01-d02-n01-action-open",
      "d01-n01-d02-n01-resolved-target-killed",
      "d01-n01-d02-d02-day-controls-return",
      "d02-n02-d02-vote-open",
      "d02-n02-d02-deciding-vote-submitted",
      "d02-n02-d02-resolved-target-killed",
      "d02-n02-n02-action-open",
      "n02-d03-n02-action-open",
      "n02-d03-n02-action-submitted",
      "n02-d03-n02-resolved-target-killed",
      "n02-d03-d03-day-controls-return",
      "n02-d03-d03-terminal-advance-reject",
      "n02-d03-d03-terminal-reload-recovery",
      "n02-d03-d03-revote-prompt-resolved",
      "n02-d03-d03r1-revote-ballot-submitted",
      "n02-d03-d03r1-revote-resolved-no-majority",
      "n02-d03-d03r2-revote-prompt-resolved",
      "n02-d03-d03r2-revote-ballot-submitted",
      "n02-d03-d03r2-revote-resolved-no-majority",
      "n02-d03-d03r2-stale-continue-policy-recovery",
      "d03-n03-d03-terminal-advance-reject",
      "d03-n03-d03-terminal-reload-recovery",
      "d03-n03-d03-revote-prompt-resolved",
      "d03-n03-d03r1-revote-ballot-submitted",
      "d03-n03-d03r1-revote-resolved-no-majority",
      "d03-n03-d03r2-revote-prompt-resolved",
      "d03-n03-d03r2-revote-ballot-submitted",
      "d03-n03-d03r2-revote-resolved-no-majority",
      "d03-n03-d03r2-stale-continue-policy-recovery",
      "earliest-reached-d01-tie-resolved",
      "n03-d04-n03-action-open",
      "n03-d04-n03-action-submitted",
      "n03-d04-n03-resolved-target-killed",
      "n03-d04-d04-day-controls-return",
      "d04-n04-d05-d04-no-lynch-vote-submitted",
      "d04-n04-d05-d04-resolved-no-lynch",
      "d04-n04-d05-n04-no-action-open",
      "d04-n04-d05-n04-resolved-no-action",
      "d04-n04-d05-d05-day-controls-return",
      "d05-n05-d05-no-lynch-vote-submitted",
      "d05-n05-d05-resolved-no-lynch",
      "d05-n05-n05-night-controls-return",
      "d05-n05-n05-complete-game",
      "d05-n05-n05-completed-host-reload",
      "d05-n05-n05-completed-player-surface",
    ],
    roleSurfaceCheckpoints: [
      "d02-n02-host-lifecycle-control-checkpoint",
      "d02-n02-host-lifecycle-control-locked-checkpoint",
      "d02-n02-host-lifecycle-control-unlocked-checkpoint",
      "d02-n02-host-deadline-control-checkpoint",
      "d02-n02-host-lifecycle-control-stale-reject-checkpoint",
      "d02-n02-host-phase-advance-transition-checkpoint",
      "d02-n02-player-action-submission-ack-checkpoint",
      "d02-n02-night-action-resolution-receipt-checkpoint",
      "d02-n02-night-action-resolution-privacy-checkpoint",
    ],
    recoveryHooks: [
      "staleLockedVoteReject",
      "invalidActionReject",
      "normalPlayerDirectActionReject",
      "staleActionConflictReject",
      "staleVoteTransitionReject",
      "staleActionTransitionReject",
      "d03TerminalAdvanceReject",
    ],
  };
}

export function coreLoopCompletedRecoveryRowsFixture(proof) {
  const rows = completedGameEndgameRecoveryFeatureSpineRows({
    cycleId: "d05-n05",
  });
  return {
    rows,
    roleUrlHrefs: Object.fromEntries(
      rows.map((row) => [
        row.roleUrlId,
        proof.completedGameEndgameSurface[row.proofField].sourceRoleUrl,
      ]),
    ),
  };
}
