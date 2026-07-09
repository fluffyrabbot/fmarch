import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  coreLoopPhaseProgressionSpineSourceLaneIds,
} from "./dev_test_game_core_loop_phase_progression_scenarios.mjs";
import {
  playerInvalidActionRecoveryMessage,
  playerStaleActionTransitionRecoveryHookId,
  playerStaleVoteTransitionRecoveryHookId,
} from "./dev_test_game_core_loop_action_scenarios.mjs";
import {
  replacementActionReconnectScenario,
  replacementIncomingActionScenario,
  replacementStaleActionAfterResolveScenario,
} from "./dev_test_game_replacement_action_scenario_cases.mjs";
import {
  replacementConcurrentActionRaceScenario,
  replacementConcurrentVoteRaceScenario,
} from "./dev_test_game_replacement_private_scenario_cases.mjs";
import {
  privateChannelStaleActionReconnectExpectation,
} from "./dev_test_game_stale_client_reconnect_scenarios.mjs";
import {
  devTestGameProofRunPath,
} from "./dev_test_game_spine_artifact_paths.mjs";
import {
  coreLoopPrivateChannelCompletedPostLaneId,
  coreLoopPrivateChannelInvalidActionLaneId,
  privateChannelInvalidActionRecoveryScenario,
  staleCompletedPrivatePostScenario,
} from "./dev_test_game_core_loop_private_channel_recovery_scenarios.mjs";
import {
  assertCompletedPlayerEndgameRefreshBrowserProof,
} from "./dev_test_game_core_loop_completed_game_recovery_scenarios.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sessionPath = path.join(repoRoot, "target", "dev-test-game", "session.json");
const proofRunPath = path.join(repoRoot, "target", "dev-test-game", "proof-run.json");
const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://fmarch:fmarch@localhost:5544/fmarch";
const replacementVoteRaceScenario = replacementConcurrentVoteRaceScenario();
const replacementActionRaceScenario = replacementConcurrentActionRaceScenario();
const replacementIncomingActionCase = replacementIncomingActionScenario();
const replacementActionReconnectCase = replacementActionReconnectScenario();
const replacementStaleActionAfterResolveCase =
  replacementStaleActionAfterResolveScenario();
const privateChannelReconnectExpectation =
  privateChannelStaleActionReconnectExpectation();
const privateChannelInvalidActionRecovery =
  privateChannelInvalidActionRecoveryScenario();
const staleCompletedPrivatePost = staleCompletedPrivatePostScenario();

const devTestGameArgs = [
  "--name",
  "live-proof",
  "--reset",
  "--verify",
  "--no-keepalive",
];
if (process.env.FMARCH_DEV_TEST_GAME_API_BASE_URL) {
  devTestGameArgs.push(
    "--api-base-url",
    process.env.FMARCH_DEV_TEST_GAME_API_BASE_URL,
  );
}
if (process.env.FMARCH_DEV_TEST_GAME_FRONTEND_BASE_URL) {
  devTestGameArgs.push(
    "--frontend-base-url",
    process.env.FMARCH_DEV_TEST_GAME_FRONTEND_BASE_URL,
  );
}

const exitCode = await run("npm", [
  "run",
  "dev:test-game",
  "--",
  ...devTestGameArgs,
]);
if (exitCode !== 0) {
  process.exit(exitCode);
}

const session = JSON.parse(await readFile(sessionPath, "utf8"));
const proofRun = JSON.parse(await readFile(proofRunPath, "utf8"));
assert.equal(session.status, "ready");
assert.equal(session.name, "live-proof");
assert.equal(session.seedMode, "seeded");
assert.equal(session.seedCommandCount, 24);
assert.equal(session.verification?.status, "passed");
assert.equal(session.artifacts.proofRun, devTestGameProofRunPath);
assert.equal(proofRun.proof, "dev-test-game-proof-run");
assert.equal(proofRun.status, "passed");
assert.equal(proofRun.session.game, session.game);
assert.equal(proofRun.productionReady, false);
assert.equal(proofRun.releaseReady, false);
assert.equal(
  proofRun.lanes.every((lane) => lane.status === "passed"),
  true,
);
assert.equal(proofRun.coreLoopSpine.status, "passed");
assert.deepEqual(
  proofRun.coreLoopSpine.sourceLaneIds,
  coreLoopPhaseProgressionSpineSourceLaneIds,
);
assert.deepEqual(
  proofRun.coreLoopSpine.cycles.map((cycle) => cycle.id),
  [
    "d01-n01-d02",
    "d02-n02",
    "n02-d03",
    "d03-n03",
    "n03-d04",
    "d04-n04-d05",
    "d05-n05",
  ],
);
const proofRunSpineFirstCycle = proofRun.coreLoopSpine.cycles[0];
const proofRunSpineSecondCycle = proofRun.coreLoopSpine.cycles[1];
const proofRunSpineThirdCycle = proofRun.coreLoopSpine.cycles[2];
const proofRunSpineFourthCycle = proofRun.coreLoopSpine.cycles[3];
const proofRunSpineFifthCycle = proofRun.coreLoopSpine.cycles[4];
const proofRunSpineSixthCycle = proofRun.coreLoopSpine.cycles[5];
const proofRunSpineSeventhCycle = proofRun.coreLoopSpine.cycles[6];
assert.equal(proofRunSpineFirstCycle.game, session.game);
assert.match(proofRunSpineFirstCycle.roleUrls.host, new RegExp(`/g/${session.game}/host`));
assert.equal(proofRunSpineFirstCycle.checkpoints[0].id, "d01-resolved-locked");
assert.equal(proofRunSpineFirstCycle.checkpoints[0].phase, "D01");
assert.equal(proofRunSpineFirstCycle.checkpoints[0].locked, true);
assert.equal(proofRunSpineFirstCycle.checkpoints[0].submitActionControls, 0);
assert.equal(proofRunSpineFirstCycle.checkpoints[1].phase, "N01");
assert.equal(proofRunSpineFirstCycle.checkpoints[1].actionTemplate, "factional_kill");
assert.equal(proofRunSpineFirstCycle.checkpoints[1].normalPlayerDirectReject, "InvalidTarget");
assert.equal(proofRunSpineFirstCycle.checkpoints[2].receiptStatus, "factional_kill");
assert.equal(proofRunSpineFirstCycle.checkpoints[2].targetAlive, false);
assert.equal(proofRunSpineFirstCycle.checkpoints[3].phase, "D02");
assert.equal(proofRunSpineFirstCycle.checkpoints[3].actionVoteControls > 0, true);
assert.match(
  proofRunSpineSecondCycle.roleUrls.host,
  new RegExp(`/g/${proofRunSpineSecondCycle.game}/host`),
);
assert.equal(proofRunSpineSecondCycle.checkpoints[0].phase, "D02");
assert.equal(proofRunSpineSecondCycle.checkpoints[0].voteTarget, "slot-2");
assert.equal(proofRunSpineSecondCycle.checkpoints[1].voteState, "ack");
assert.equal(proofRunSpineSecondCycle.checkpoints[1].projectedCount, 3);
assert.equal(proofRunSpineSecondCycle.checkpoints[2].outcomeStatus, "Lynch");
assert.equal(proofRunSpineSecondCycle.checkpoints[2].receiptStatus, "day_vote");
assert.equal(proofRunSpineSecondCycle.checkpoints[3].phase, "N02");
assert.equal(proofRunSpineSecondCycle.checkpoints[3].actionTemplate, "factional_kill");
assert.equal(proofRunSpineSecondCycle.checkpoints[3].normalPlayerFactionalKillVisible, false);
assert.match(
  proofRunSpineThirdCycle.roleUrls.host,
  new RegExp(`/g/${proofRunSpineThirdCycle.game}/host`),
);
assert.equal(proofRunSpineThirdCycle.checkpoints[0].phase, "N02");
assert.equal(proofRunSpineThirdCycle.checkpoints[0].actionTemplate, "factional_kill");
assert.equal(proofRunSpineThirdCycle.checkpoints[0].actionTarget, "slot-3");
assert.equal(proofRunSpineThirdCycle.checkpoints[1].actionState, "ack");
assert.equal(proofRunSpineThirdCycle.checkpoints[1].templateId, "factional_kill");
assert.equal(proofRunSpineThirdCycle.checkpoints[1].targetSlot, "slot-3");
assert.equal(proofRunSpineThirdCycle.checkpoints[2].resolveState, "ack");
assert.equal(proofRunSpineThirdCycle.checkpoints[2].targetAlive, false);
assert.equal(proofRunSpineThirdCycle.checkpoints[2].targetStatus, "dead");
assert.equal(proofRunSpineThirdCycle.checkpoints[3].phase, "D03");
assert.equal(proofRunSpineThirdCycle.checkpoints[3].actionVoteControls > 0, true);
assert.equal(proofRunSpineThirdCycle.checkpoints[3].normalVoteControls > 0, true);
assert.equal(proofRunSpineThirdCycle.checkpoints[4].id, "d03-terminal-advance-reject");
assert.equal(proofRunSpineThirdCycle.checkpoints[4].voteState, "ack");
assert.equal(proofRunSpineThirdCycle.checkpoints[4].voteTarget, "slot_4");
assert.equal(proofRunSpineThirdCycle.checkpoints[4].resolveState, "ack");
assert.equal(proofRunSpineThirdCycle.checkpoints[4].outcomeStatus, "NoMajority");
assert.equal(proofRunSpineThirdCycle.checkpoints[4].winnerSlot, null);
assert.equal(proofRunSpineThirdCycle.checkpoints[4].targetAlive, true);
assert.equal(proofRunSpineThirdCycle.checkpoints[4].targetStatus, "alive");
assert.equal(proofRunSpineThirdCycle.checkpoints[4].advanceState, "reject");
assert.equal(proofRunSpineThirdCycle.checkpoints[4].rejectError, "InvalidTarget");
assert.equal(proofRunSpineThirdCycle.checkpoints[4].phase, "D03");
assert.equal(proofRunSpineThirdCycle.checkpoints[4].locked, true);
assert.equal(proofRunSpineThirdCycle.checkpoints[4].advanceControlVisible, true);
assert.equal(proofRunSpineThirdCycle.checkpoints[5].id, "d03-terminal-reload-recovery");
assert.equal(proofRunSpineThirdCycle.checkpoints[5].routeResponseStatus, 200);
assert.match(
  proofRunSpineThirdCycle.checkpoints[5].rejectReceiptStatus,
  /Reject InvalidTarget/,
);
assert.equal(proofRunSpineThirdCycle.checkpoints[5].phase, "D03");
assert.equal(proofRunSpineThirdCycle.checkpoints[5].locked, true);
assert.equal(proofRunSpineThirdCycle.checkpoints[5].outcomeStatus, "NoMajority");
assert.equal(proofRunSpineThirdCycle.checkpoints[5].projectedCount, 1);
assert.equal(proofRunSpineThirdCycle.checkpoints[5].advanceControlVisible, true);
assert.equal(proofRunSpineThirdCycle.checkpoints[5].unlockControlVisible, true);
assert.equal(proofRunSpineThirdCycle.checkpoints[6].id, "d03-revote-prompt-resolved");
assert.equal(proofRunSpineThirdCycle.checkpoints[6].promptId, "D03:revote:NoMajority");
assert.equal(
  proofRunSpineThirdCycle.checkpoints[6].promptActionId,
  "resolve_host_prompt-D03-revote-NoMajority-no_majority_continue_revote",
);
assert.equal(proofRunSpineThirdCycle.checkpoints[6].promptStatusBefore, "pending");
assert.equal(proofRunSpineThirdCycle.checkpoints[6].resolveState, "ack");
assert.equal(proofRunSpineThirdCycle.checkpoints[6].streamSeqCount, 2);
assert.equal(
  proofRunSpineThirdCycle.checkpoints[6].decisionPolicy,
  "no_majority_continue_revote",
);
assert.equal(proofRunSpineThirdCycle.checkpoints[6].promptStatusAfter, "resolved");
assert.equal(proofRunSpineThirdCycle.checkpoints[6].phase, "D03R1");
assert.equal(proofRunSpineThirdCycle.checkpoints[6].locked, false);
assert.equal(proofRunSpineThirdCycle.checkpoints[6].actionVoteControls > 0, true);
assert.equal(proofRunSpineThirdCycle.checkpoints[6].normalVoteControls > 0, true);
assert.equal(
  proofRunSpineThirdCycle.checkpoints[7].id,
  "d03r1-revote-ballot-submitted",
);
assert.equal(proofRunSpineThirdCycle.checkpoints[7].phase, "D03R1");
assert.equal(proofRunSpineThirdCycle.checkpoints[7].locked, false);
assert.equal(proofRunSpineThirdCycle.checkpoints[7].voteState, "ack");
assert.equal(proofRunSpineThirdCycle.checkpoints[7].actorSlot, "slot_4");
assert.equal(proofRunSpineThirdCycle.checkpoints[7].voteTarget, "NoLynch");
assert.equal(proofRunSpineThirdCycle.checkpoints[7].currentVoteKind, "no_lynch");
assert.equal(proofRunSpineThirdCycle.checkpoints[7].projectedCount, 1);
assert.equal(proofRunSpineThirdCycle.checkpoints[7].apiPhase, "D03R1");
assert.equal(proofRunSpineThirdCycle.checkpoints[7].apiTarget, "no_lynch");
assert.equal(proofRunSpineThirdCycle.checkpoints[7].apiCount, 1);
assert.equal(proofRunSpineThirdCycle.checkpoints[7].staleD03Target, "slot_4");
assert.equal(proofRunSpineThirdCycle.checkpoints[7].staleD03Count, 1);
assert.equal(proofRunSpineThirdCycle.checkpoints[7].staleD03NoLynchCount, null);
assert.equal(
  proofRunSpineThirdCycle.checkpoints[8].id,
  "d03r1-revote-resolved-no-majority",
);
assert.equal(proofRunSpineThirdCycle.checkpoints[8].phase, "D03R1");
assert.equal(proofRunSpineThirdCycle.checkpoints[8].locked, true);
assert.equal(proofRunSpineThirdCycle.checkpoints[8].resolveState, "ack");
assert.equal(proofRunSpineThirdCycle.checkpoints[8].outcomeStatus, "NoMajority");
assert.equal(proofRunSpineThirdCycle.checkpoints[8].winnerSlot, null);
assert.equal(proofRunSpineThirdCycle.checkpoints[8].projectedCount, 1);
assert.equal(
  proofRunSpineThirdCycle.checkpoints[8].promptId,
  "D03R1:revote:NoMajority",
);
assert.equal(
  proofRunSpineThirdCycle.checkpoints[8].promptActionId,
  "resolve_host_prompt-D03R1-revote-NoMajority-no_majority_continue_revote",
);
assert.equal(proofRunSpineThirdCycle.checkpoints[8].promptStatusAfter, "pending");
assert.equal(proofRunSpineThirdCycle.checkpoints[8].originalPromptStatus, "resolved");
assert.equal(proofRunSpineThirdCycle.checkpoints[8].promptActionVisible, true);
assert.equal(
  proofRunSpineThirdCycle.checkpoints[9].id,
  "d03r2-revote-prompt-resolved",
);
assert.equal(
  proofRunSpineThirdCycle.checkpoints[9].promptId,
  "D03R1:revote:NoMajority",
);
assert.equal(
  proofRunSpineThirdCycle.checkpoints[9].promptActionId,
  "resolve_host_prompt-D03R1-revote-NoMajority-no_majority_continue_revote",
);
assert.equal(proofRunSpineThirdCycle.checkpoints[9].promptStatusBefore, "pending");
assert.equal(proofRunSpineThirdCycle.checkpoints[9].resolveState, "ack");
assert.equal(proofRunSpineThirdCycle.checkpoints[9].streamSeqCount, 2);
assert.equal(
  proofRunSpineThirdCycle.checkpoints[9].decisionPolicy,
  "no_majority_continue_revote",
);
assert.equal(proofRunSpineThirdCycle.checkpoints[9].promptStatusAfter, "resolved");
assert.equal(proofRunSpineThirdCycle.checkpoints[9].originalPromptStatus, "resolved");
assert.equal(proofRunSpineThirdCycle.checkpoints[9].phase, "D03R2");
assert.equal(proofRunSpineThirdCycle.checkpoints[9].locked, false);
assert.equal(proofRunSpineThirdCycle.checkpoints[9].actionVoteControls > 0, true);
assert.equal(proofRunSpineThirdCycle.checkpoints[9].normalVoteControls > 0, true);
assert.equal(
  proofRunSpineThirdCycle.checkpoints[10].id,
  "d03r2-revote-ballot-submitted",
);
assert.equal(proofRunSpineThirdCycle.checkpoints[10].phase, "D03R2");
assert.equal(proofRunSpineThirdCycle.checkpoints[10].locked, false);
assert.equal(proofRunSpineThirdCycle.checkpoints[10].voteState, "ack");
assert.equal(proofRunSpineThirdCycle.checkpoints[10].actorSlot, "slot_4");
assert.equal(proofRunSpineThirdCycle.checkpoints[10].voteTarget, "NoLynch");
assert.equal(proofRunSpineThirdCycle.checkpoints[10].currentVoteKind, "no_lynch");
assert.equal(proofRunSpineThirdCycle.checkpoints[10].projectedCount, 1);
assert.equal(proofRunSpineThirdCycle.checkpoints[10].apiPhase, "D03R2");
assert.equal(proofRunSpineThirdCycle.checkpoints[10].apiTarget, "no_lynch");
assert.equal(proofRunSpineThirdCycle.checkpoints[10].apiCount, 1);
assert.equal(proofRunSpineThirdCycle.checkpoints[10].staleD03Target, "slot_4");
assert.equal(proofRunSpineThirdCycle.checkpoints[10].staleD03Count, 1);
assert.equal(proofRunSpineThirdCycle.checkpoints[10].staleD03R1NoLynchCount, 1);
assert.equal(proofRunSpineThirdCycle.checkpoints[10].staleD03NoLynchCount, null);
assert.equal(
  proofRunSpineThirdCycle.checkpoints[11].id,
  "d03r2-revote-resolved-no-majority",
);
assert.equal(proofRunSpineThirdCycle.checkpoints[11].phase, "D03R2");
assert.equal(proofRunSpineThirdCycle.checkpoints[11].locked, true);
assert.equal(proofRunSpineThirdCycle.checkpoints[11].resolveState, "ack");
assert.equal(proofRunSpineThirdCycle.checkpoints[11].outcomeStatus, "NoMajority");
assert.equal(proofRunSpineThirdCycle.checkpoints[11].winnerSlot, null);
assert.equal(proofRunSpineThirdCycle.checkpoints[11].projectedCount, 1);
assert.equal(
  proofRunSpineThirdCycle.checkpoints[11].promptId,
  "D03R2:revote:NoMajority",
);
assert.equal(
  proofRunSpineThirdCycle.checkpoints[11].promptActionId,
  "resolve_host_prompt-D03R2-revote-NoMajority-no_majority_no_lynch",
);
assert.equal(proofRunSpineThirdCycle.checkpoints[11].promptStatusAfter, "pending");
assert.equal(proofRunSpineThirdCycle.checkpoints[11].originalPromptStatus, "resolved");
assert.equal(proofRunSpineThirdCycle.checkpoints[11].promptActionVisible, true);
assert.equal(proofRunSpineThirdCycle.checkpoints[11].policyResolveState, "ack");
assert.equal(proofRunSpineThirdCycle.checkpoints[11].policyStreamSeqCount, 2);
assert.equal(
  proofRunSpineThirdCycle.checkpoints[11].decisionPolicy,
  "no_majority_no_lynch",
);
assert.equal(proofRunSpineThirdCycle.checkpoints[11].promptStatusAfterPolicy, "resolved");
assert.equal(proofRunSpineThirdCycle.checkpoints[11].nextPhase, "N03");
assert.equal(proofRunSpineThirdCycle.checkpoints[11].nextLocked, false);
assert.equal(proofRunSpineThirdCycle.checkpoints[11].actionNightActionControls > 0, true);
assert.equal(proofRunSpineThirdCycle.checkpoints[11].normalNightActionControls, 0);
assert.equal(
  proofRunSpineThirdCycle.checkpoints[12].id,
  "d03r2-stale-continue-policy-recovery",
);
assert.equal(
  proofRunSpineThirdCycle.checkpoints[12].promptId,
  "D03R2:revote:NoMajority",
);
assert.equal(
  proofRunSpineThirdCycle.checkpoints[12].staleActionId,
  "resolve_host_prompt-D03R2-revote-NoMajority-no_majority_continue_revote",
);
assert.equal(proofRunSpineThirdCycle.checkpoints[12].setupPromptStatus, "pending");
assert.equal(proofRunSpineThirdCycle.checkpoints[12].setupActionVisible, true);
assert.equal(proofRunSpineThirdCycle.checkpoints[12].rejectState, "reject");
assert.equal(
  proofRunSpineThirdCycle.checkpoints[12].rejectError,
  "PromptAlreadyResolved",
);
assert.match(
  proofRunSpineThirdCycle.checkpoints[12].activityStatusText,
  /Reject PromptAlreadyResolved/,
);
assert.match(
  proofRunSpineThirdCycle.checkpoints[12].activityStatusText,
  /host prompt selection is stale/,
);
assert.equal(
  proofRunSpineThirdCycle.checkpoints[12].promptStatusAfterReject,
  "resolved",
);
assert.equal(
  proofRunSpineThirdCycle.checkpoints[12].promptActionVisibleAfterReject,
  false,
);
assert.equal(proofRunSpineThirdCycle.checkpoints[12].reloadStatus, "passed");
assert.equal(proofRunSpineThirdCycle.checkpoints[12].reloadPhase, "N03");
assert.equal(proofRunSpineThirdCycle.checkpoints[12].reloadLocked, false);
assert.equal(
  proofRunSpineThirdCycle.checkpoints[12].reloadResolveControlVisible,
  true,
);
assert.equal(proofRunSpineThirdCycle.checkpoints[12].reloadStaleActionVisible, false);
assert.equal(
  proofRunSpineThirdCycle.checkpoints[12].apiPromptStatusAfterReload,
  "resolved",
);
assert.equal(proofRunSpineFourthCycle.id, "d03-n03");
assert.equal(proofRunSpineFourthCycle.game, proofRunSpineThirdCycle.game);
assert.deepEqual(
  proofRunSpineFourthCycle.roleUrls,
  proofRunSpineThirdCycle.roleUrls,
);
assert.deepEqual(
  proofRunSpineFourthCycle.checkpoints,
  proofRunSpineThirdCycle.checkpoints.slice(4),
);
assert.equal(proofRunSpineFifthCycle.id, "n03-d04");
assert.equal(proofRunSpineFifthCycle.game, proofRunSpineThirdCycle.game);
assert.equal(
  proofRunSpineFifthCycle.roleUrls.host,
  proofRunSpineThirdCycle.roleUrls.host,
);
assert.equal(
  proofRunSpineFifthCycle.roleUrls.actionPlayer,
  proofRunSpineThirdCycle.roleUrls.actionPlayer,
);
assert.equal(
  proofRunSpineFifthCycle.roleUrls.target,
  proofRunSpineThirdCycle.roleUrls.normalPlayer,
);
assert.equal(proofRunSpineFifthCycle.checkpoints[0].id, "n03-action-open");
assert.equal(proofRunSpineFifthCycle.checkpoints[0].phase, "N03");
assert.equal(proofRunSpineFifthCycle.checkpoints[0].actionTemplate, "factional_kill");
assert.equal(proofRunSpineFifthCycle.checkpoints[0].actionTarget, "slot-7");
assert.equal(proofRunSpineFifthCycle.checkpoints[0].actionButtonVisible, true);
assert.equal(proofRunSpineFifthCycle.checkpoints[0].normalPlayerActionControls, 0);
assert.equal(proofRunSpineFifthCycle.checkpoints[1].id, "n03-action-submitted");
assert.equal(proofRunSpineFifthCycle.checkpoints[1].actionState, "ack");
assert.equal(proofRunSpineFifthCycle.checkpoints[1].actorSlot, "slot_4");
assert.equal(proofRunSpineFifthCycle.checkpoints[1].templateId, "factional_kill");
assert.equal(proofRunSpineFifthCycle.checkpoints[1].targetSlot, "slot-7");
assert.equal(proofRunSpineFifthCycle.checkpoints[1].actionButtonVisible, false);
assert.equal(
  proofRunSpineFifthCycle.checkpoints[2].id,
  "n03-resolved-target-killed",
);
assert.equal(proofRunSpineFifthCycle.checkpoints[2].resolveState, "ack");
assert.equal(proofRunSpineFifthCycle.checkpoints[2].phase, "N03");
assert.equal(proofRunSpineFifthCycle.checkpoints[2].targetSlot, "slot-7");
assert.equal(proofRunSpineFifthCycle.checkpoints[2].targetAlive, false);
assert.equal(proofRunSpineFifthCycle.checkpoints[2].targetStatus, "dead");
assert.equal(proofRunSpineFifthCycle.checkpoints[3].id, "d04-day-controls-return");
assert.equal(proofRunSpineFifthCycle.checkpoints[3].advanceState, "ack");
assert.equal(proofRunSpineFifthCycle.checkpoints[3].phase, "D04");
assert.equal(proofRunSpineFifthCycle.checkpoints[3].locked, false);
assert.equal(proofRunSpineFifthCycle.checkpoints[3].actionSubmitControls, 0);
assert.equal(proofRunSpineFifthCycle.checkpoints[3].actionVoteControls > 0, true);
assert.equal(proofRunSpineFifthCycle.checkpoints[3].targetAlive, false);
assert.equal(proofRunSpineFifthCycle.checkpoints[3].targetVoteControls, 0);
assert.equal(proofRunSpineSixthCycle.id, "d04-n04-d05");
assert.equal(proofRunSpineSixthCycle.game, proofRunSpineThirdCycle.game);
assert.equal(
  proofRunSpineSixthCycle.roleUrls.host,
  proofRunSpineThirdCycle.roleUrls.host,
);
assert.equal(
  proofRunSpineSixthCycle.roleUrls.actionPlayer,
  proofRunSpineThirdCycle.roleUrls.actionPlayer,
);
assert.equal(
  proofRunSpineSixthCycle.roleUrls.deadPlayer,
  proofRunSpineThirdCycle.roleUrls.normalPlayer,
);
assert.equal(
  proofRunSpineSixthCycle.checkpoints[0].id,
  "d04-no-lynch-vote-submitted",
);
assert.equal(proofRunSpineSixthCycle.checkpoints[0].phase, "D04");
assert.equal(proofRunSpineSixthCycle.checkpoints[0].voteState, "ack");
assert.equal(proofRunSpineSixthCycle.checkpoints[0].actorSlot, "slot_4");
assert.equal(proofRunSpineSixthCycle.checkpoints[0].voteTarget, "NoLynch");
assert.equal(proofRunSpineSixthCycle.checkpoints[0].currentVoteKind, "no_lynch");
assert.equal(proofRunSpineSixthCycle.checkpoints[0].apiPhase, "D04");
assert.equal(proofRunSpineSixthCycle.checkpoints[0].apiTarget, "no_lynch");
assert.equal(proofRunSpineSixthCycle.checkpoints[0].apiCount, 1);
assert.equal(proofRunSpineSixthCycle.checkpoints[1].id, "d04-resolved-no-lynch");
assert.equal(proofRunSpineSixthCycle.checkpoints[1].phase, "D04");
assert.equal(proofRunSpineSixthCycle.checkpoints[1].locked, true);
assert.equal(proofRunSpineSixthCycle.checkpoints[1].resolveState, "ack");
assert.equal(proofRunSpineSixthCycle.checkpoints[1].outcomeStatus, "NoLynch");
assert.equal(proofRunSpineSixthCycle.checkpoints[1].winnerSlot, null);
assert.equal(proofRunSpineSixthCycle.checkpoints[1].projectedCount, 1);
assert.equal(proofRunSpineSixthCycle.checkpoints[2].id, "n04-no-action-open");
assert.equal(proofRunSpineSixthCycle.checkpoints[2].advanceState, "ack");
assert.equal(proofRunSpineSixthCycle.checkpoints[2].phase, "N04");
assert.equal(proofRunSpineSixthCycle.checkpoints[2].actionTemplate, null);
assert.equal(proofRunSpineSixthCycle.checkpoints[2].actionCount, 0);
assert.equal(proofRunSpineSixthCycle.checkpoints[2].actionSubmitControls, 0);
assert.equal(proofRunSpineSixthCycle.checkpoints[2].deadPlayerActionControls, 0);
assert.equal(proofRunSpineSixthCycle.checkpoints[3].id, "n04-resolved-no-action");
assert.equal(proofRunSpineSixthCycle.checkpoints[3].resolveState, "ack");
assert.equal(proofRunSpineSixthCycle.checkpoints[3].phase, "N04");
assert.equal(proofRunSpineSixthCycle.checkpoints[3].locked, true);
assert.equal(proofRunSpineSixthCycle.checkpoints[3].actionCount, 0);
assert.equal(proofRunSpineSixthCycle.checkpoints[3].actionSubmitControls, 0);
assert.equal(proofRunSpineSixthCycle.checkpoints[4].id, "d05-day-controls-return");
assert.equal(proofRunSpineSixthCycle.checkpoints[4].advanceState, "ack");
assert.equal(proofRunSpineSixthCycle.checkpoints[4].phase, "D05");
assert.equal(proofRunSpineSixthCycle.checkpoints[4].locked, false);
assert.equal(proofRunSpineSixthCycle.checkpoints[4].actionSubmitControls, 0);
assert.equal(proofRunSpineSixthCycle.checkpoints[4].actionVoteControls > 0, true);
assert.equal(proofRunSpineSixthCycle.checkpoints[4].deadPlayerVoteControls, 0);
assert.equal(proofRunSpineSeventhCycle.id, "d05-n05");
assert.equal(proofRunSpineSeventhCycle.game, proofRunSpineThirdCycle.game);
assert.equal(
  proofRunSpineSeventhCycle.roleUrls.host,
  proofRunSpineThirdCycle.roleUrls.host,
);
assert.equal(
  proofRunSpineSeventhCycle.roleUrls.actionPlayer,
  proofRunSpineThirdCycle.roleUrls.actionPlayer,
);
assert.equal(
  proofRunSpineSeventhCycle.checkpoints[0].id,
  "d05-no-lynch-vote-submitted",
);
assert.equal(proofRunSpineSeventhCycle.checkpoints[0].phase, "D05");
assert.equal(proofRunSpineSeventhCycle.checkpoints[0].voteState, "ack");
assert.equal(proofRunSpineSeventhCycle.checkpoints[0].actorSlot, "slot_4");
assert.equal(proofRunSpineSeventhCycle.checkpoints[0].voteTarget, "NoLynch");
assert.equal(proofRunSpineSeventhCycle.checkpoints[0].currentVoteKind, "no_lynch");
assert.equal(proofRunSpineSeventhCycle.checkpoints[0].apiPhase, "D05");
assert.equal(proofRunSpineSeventhCycle.checkpoints[0].apiTarget, "no_lynch");
assert.equal(proofRunSpineSeventhCycle.checkpoints[0].apiCount, 1);
assert.equal(proofRunSpineSeventhCycle.checkpoints[1].id, "d05-resolved-no-lynch");
assert.equal(proofRunSpineSeventhCycle.checkpoints[1].phase, "D05");
assert.equal(proofRunSpineSeventhCycle.checkpoints[1].locked, true);
assert.equal(proofRunSpineSeventhCycle.checkpoints[1].resolveState, "ack");
assert.equal(proofRunSpineSeventhCycle.checkpoints[1].outcomeStatus, "NoLynch");
assert.equal(proofRunSpineSeventhCycle.checkpoints[1].winnerSlot, null);
assert.equal(proofRunSpineSeventhCycle.checkpoints[1].projectedCount, 1);
assert.equal(proofRunSpineSeventhCycle.checkpoints[2].id, "n05-night-controls-return");
assert.equal(proofRunSpineSeventhCycle.checkpoints[2].advanceState, "ack");
assert.equal(proofRunSpineSeventhCycle.checkpoints[2].phase, "N05");
assert.equal(proofRunSpineSeventhCycle.checkpoints[2].locked, false);
assert.equal(proofRunSpineSeventhCycle.checkpoints[2].actionSubmitControls, 0);
assert.equal(proofRunSpineSeventhCycle.checkpoints[2].actionVoteControls, 0);
assert.equal(proofRunSpineSeventhCycle.checkpoints[2].actionCount, 0);
assert.equal(proofRunSpineSeventhCycle.checkpoints[3].id, "n05-complete-game");
assert.equal(proofRunSpineSeventhCycle.checkpoints[3].completeState, "ack");
assert.equal(proofRunSpineSeventhCycle.checkpoints[3].phase, "N05");
assert.equal(proofRunSpineSeventhCycle.checkpoints[3].completed, true);
assert.equal(proofRunSpineSeventhCycle.checkpoints[3].revealedSlotCount > 0, true);
assert.equal(proofRunSpineSeventhCycle.checkpoints[3].completeActionVisible, false);
assert.equal(proofRunSpineSeventhCycle.checkpoints[3].apiCompleted, true);
assert.equal(
  proofRunSpineSeventhCycle.checkpoints[4].id,
  "n05-completed-host-reload",
);
assert.equal(proofRunSpineSeventhCycle.checkpoints[4].routeStatus, 200);
assert.equal(proofRunSpineSeventhCycle.checkpoints[4].phase, "N05");
assert.equal(proofRunSpineSeventhCycle.checkpoints[4].completed, true);
assert.equal(proofRunSpineSeventhCycle.checkpoints[4].revealedSlotCount > 0, true);
assert.equal(proofRunSpineSeventhCycle.checkpoints[4].completeActionVisible, false);
assert.equal(
  proofRunSpineSeventhCycle.checkpoints[5].id,
  "n05-completed-player-surface",
);
assert.equal(proofRunSpineSeventhCycle.checkpoints[5].phase, "N05");
assert.equal(proofRunSpineSeventhCycle.checkpoints[5].completed, true);
assert.equal(proofRunSpineSeventhCycle.checkpoints[5].actionSubmitControls, 0);
assert.equal(proofRunSpineSeventhCycle.checkpoints[5].actionVoteControls, 0);
assert.equal(proofRunSpineSeventhCycle.checkpoints[5].actionCount, 0);
assert.equal(proofRunSpineSeventhCycle.checkpoints[5].voteTargetCount, 0);
assert.equal(proofRun.coreLoopSpine.recoveryHooks.staleLockedVoteReject, "PhaseLocked");
assert.equal(proofRun.coreLoopSpine.recoveryHooks.invalidActionReject, "InvalidTarget");
assert.equal(
  proofRun.coreLoopSpine.recoveryHooks.normalPlayerDirectActionReject,
  "InvalidTarget",
);
assert.equal(proofRun.coreLoopSpine.recoveryHooks.staleActionConflictReject, "PhaseLocked");
assert.equal(
  proofRun.coreLoopSpine.recoveryHooks[playerStaleVoteTransitionRecoveryHookId],
  "PhaseLocked",
);
assert.equal(
  proofRun.coreLoopSpine.recoveryHooks[playerStaleActionTransitionRecoveryHookId],
  "PhaseLocked",
);
assert.equal(proofRun.coreLoopSpine.recoveryHooks.d03TerminalAdvanceReject, "InvalidTarget");
assert.deepEqual(session.verification.roles, [
  "host",
  "hostSetup",
  "player",
  "actionPlayer",
  "deniedPlayer",
  "cohost",
  "replacementPlayer",
]);
assert.match(session.frontendBaseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
assert.match(session.apiBaseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
for (const role of [
  "admin",
  "cohost",
  "host",
  "hostSetup",
  "player",
  "actionPlayer",
  "deniedPlayer",
]) {
  assert.equal(typeof session.sessions[role]?.token, "string", `${role} token`);
  assert.equal(session.sessions[role].credentialKind, "invite", `${role} credential kind`);
  assert.equal(session.sessions[role].inviteToken, session.sessions[role].token);
  assert.match(session.sessions[role].loginUrl, /\/auth\/login\?returnTo=.*&invite=/);
}
assert.equal(typeof session.sessions.replacementPlayer?.token, "string");
assert.equal(session.sessions.replacementPlayer.credentialKind, "session");
assert.equal(session.sessions.replacementPlayer.inviteToken, undefined);
assert.match(
  session.sessions.replacementPlayer.loginUrl,
  /\/auth\/login\?returnTo=%2Fg%2F/,
);
assert.equal(
  session.sessions.replacementPlayer.loginUrl.includes("&invite="),
  false,
);
assert.equal(
  session.verification.sessions.host.capabilityKinds.includes("HostOf"),
  true,
);
assert.equal(
  session.verification.sessions.hostSetup.capabilityKinds.includes("HostOf"),
  true,
);
assert.equal(session.verification.hostSetup.status, "passed");
assert.match(
  session.verification.hostSetup.roleUrl,
  new RegExp(`/g/${session.game}/setup$`),
);
assert.equal(
  session.verification.hostSetup.capabilityLabel,
  `HostOf(${session.game})`,
);
assert.equal(session.verification.hostSetup.readinessSummary, "Started at D01");
assert.equal(session.verification.hostSetup.phaseId, "D01");
assert.equal(session.verification.hostSetup.startDisabled, true);
assert.equal(session.verification.hostSetup.hostHref, `/g/${session.game}/host`);
assert.equal(
  session.verification.hostSetup.mainPolicyText,
  "Media-only posts are disabled.",
);
assert.equal(session.verification.hostSetup.policyCommand.status, "passed");
assert.equal(
  session.verification.hostSetup.policyCommand.commandKind,
  "SetPostPolicy",
);
assert.equal(session.verification.hostSetup.policyCommand.channelId, "main");
assert.deepEqual(
  session.verification.hostSetup.policyCommand.allowMediaOnlySequence,
  [true, false],
);
assert.equal(
  session.verification.hostSetup.policyCommand.finalPolicyText,
  "Media-only posts are disabled.",
);
assert.equal(session.verification.hostSetup.policyCommand.enabled.status, "ack");
assert.equal(
  session.verification.hostSetup.policyCommand.enabled.requestEnvelope.body.body
    .command.SetPostPolicy.allow_media_only,
  true,
);
assert.equal(
  session.verification.hostSetup.policyCommand.enabled.refreshedAllowMediaOnly,
  true,
);
assert.equal(session.verification.hostSetup.policyCommand.restored.status, "ack");
assert.equal(
  session.verification.hostSetup.policyCommand.restored.requestEnvelope.body.body
    .command.SetPostPolicy.allow_media_only,
  false,
);
assert.equal(
  session.verification.hostSetup.policyCommand.restored.refreshedAllowMediaOnly,
  false,
);
assert.equal(session.verification.hostSetup.setupMutationCommand.status, "passed");
assert.match(
  session.verification.hostSetup.setupMutationCommand.roleUrl,
  /\/g\/[0-9a-f-]+\/setup$/,
);
assert.equal(
  session.verification.hostSetup.setupMutationCommand.sessionPrincipalUserId,
  "host_h",
);
assert.equal(
  session.verification.hostSetup.setupMutationCommand.initialSummary,
  "Ready to start",
);
assert.equal(
  session.verification.hostSetup.setupMutationCommand.duplicateAddSlotRecovery
    .status,
  "reject",
);
assert.equal(
  session.verification.hostSetup.setupMutationCommand.duplicateAddSlotRecovery
    .error,
  "InvalidTarget",
);
assert.equal(
  session.verification.hostSetup.setupMutationCommand.duplicateAddSlotRecovery
    .commandKind,
  "AddSlot",
);
assert.equal(
  session.verification.hostSetup.setupMutationCommand.duplicateAddSlotRecovery
    .command.slot,
  "slot_extra",
);
assert.equal(
  session.verification.hostSetup.setupMutationCommand.duplicateAddSlotRecovery
    .duplicateSlotCountAfterReject,
  1,
);
assert.equal(
  session.verification.hostSetup.setupMutationCommand.finalSummary,
  "Ready to start",
);
assert.equal(
  session.verification.hostSetup.setupMutationCommand.finalStartAvailable,
  true,
);
assert.equal(
  session.verification.hostSetup.setupMutationCommand.addedSlotId,
  "slot_extra",
);
assert.equal(
  session.verification.hostSetup.setupMutationCommand.assignedPrincipalUserId,
  "setup-extra-player",
);
assert.equal(
  session.verification.hostSetup.setupMutationCommand.assignedRoleKey,
  "mafia_goon",
);
assert.equal(
  session.verification.hostSetup.setupMutationCommand.finalSlot.occupantUserId,
  "setup-extra-player",
);
assert.equal(
  session.verification.hostSetup.setupMutationCommand.finalSlot.roleKey,
  "mafia_goon",
);
assert.equal(
  session.verification.hostSetup.setupMutationCommand.commands.addSlot.commandKind,
  "AddSlot",
);
assert.equal(
  session.verification.hostSetup.setupMutationCommand.commands.assignSlot.commandKind,
  "AssignSlot",
);
assert.equal(
  session.verification.hostSetup.setupMutationCommand.commands.assignRole.commandKind,
  "AssignRole",
);
assert.equal(session.verification.hostSetup.readyCheckIds.length, 7);
assert.equal(session.verification.hostSetup.slotIds.includes("slot-7"), true);
assert.equal(session.verification.hostSetup.slotIds.includes("slot_4"), true);
assert.equal(
  session.verification.sessions.player.capabilityKinds.includes("SlotOccupant"),
  true,
);
assert.equal(session.verification.sessions.host.cookie.valuePrefix, "invite-session-");
assert.equal(session.verification.sessions.player.cookie.valuePrefix, "invite-session-");
assert.equal(session.verification.sessions.cohost.cookie.valuePrefix, "invite-session-");
assert.equal(
  session.verification.sessions.cohost.capabilityKinds.includes("CohostOf"),
  true,
);
assert.equal(session.verification.cohostConsole.status, "passed");
assert.equal(
  session.verification.cohostConsole.capabilityLabel,
  `CohostOf(${session.game})`,
);
assert.equal(
  session.verification.cohostConsole.extendDeadline.commandStatus.state,
  "ack",
);
assert.equal(
  session.verification.cohostConsole.extendDeadline.commandStatus.requestEnvelope.body.body
    .principal_user_id,
  "cohost_c",
);
assert.equal(
  session.verification.cohostConsole.extendDeadline.commandStatus.requestEnvelope.body.body
    .command.ExtendDeadline.phase,
  "D01",
);
assert.equal(session.verification.cohostConsole.hostOnlyControlsVisible, false);
assert.equal(
  session.verification.cohostConsole.hostOnlyResolveReject.serverEnvelope.body.kind,
  "Reject",
);
assert.equal(
  session.verification.cohostConsole.hostOnlyResolveReject.serverEnvelope.body.body.error,
  "NotHost",
);
assert.equal(
  session.verification.cohostConsole.hostOnlyResolveReject.requestEnvelope.body.body
    .principal_user_id,
  "cohost_c",
);
assert.equal(
  session.verification.cohostConsole.hostOnlyResolveReject.requestEnvelope.body.body
    .command.ResolvePhase.game,
  session.game,
);
assert.equal(session.verification.cohostConsole.phaseAfterReject.id, "D01");
assert.equal(session.verification.cohostConsole.phaseAfterReject.locked, false);
assert.equal(session.verification.coreLoop.status, "passed");
assert.equal(session.verification.coreLoop.lock.commandStatus.state, "ack");
assert.equal(session.verification.coreLoop.rejectedVote.state, "reject");
assert.equal(session.verification.coreLoop.rejectedVote.error, "PhaseLocked");
assert.match(
  session.verification.coreLoop.staleVoteBrowserProof.roleUrl,
  new RegExp(`/g/${session.game}`),
);
assert.equal(
  session.verification.coreLoop.staleVoteBrowserProof.receipt.actionId,
  "submit_vote",
);
assert.equal(
  session.verification.coreLoop.staleVoteBrowserProof.receipt.state,
  "reject",
);
assert.match(
  session.verification.coreLoop.staleVoteBrowserProof.receiptStatusText,
  /Reject PhaseLocked/,
);
assert.deepEqual(
  session.verification.coreLoop.staleVoteBrowserProof.commandStateAfterReject
    .currentVote,
  session.verification.coreLoop.staleVoteBrowserProof.commandStateBeforeClose
    .currentVote,
);
assert.equal(
  session.verification.coreLoop.staleVoteBrowserProof.voteControlAfterReject.exists,
  false,
);
assert.equal(
  session.verification.coreLoop.staleVoteBrowserProof.votecountUnchanged,
  true,
);
assert.equal(session.verification.coreLoop.unlock.commandStatus.state, "ack");
assert.equal(
  session.verification.coreLoop.playerPhases.lockedBeforeVote.locked,
  true,
);
assert.equal(
  session.verification.coreLoop.playerPhases.unlockedAfterRecovery.locked,
  false,
);
assert.equal(session.verification.sessions.actionPlayer.cookie.valuePrefix, "invite-session-");
assert.equal(
  session.verification.sessions.actionPlayer.capabilityKinds.includes("SlotOccupant"),
  true,
);
assert.equal(session.verification.sessions.deniedPlayer.cookie.valuePrefix, "invite-session-");
assert.equal(
  session.verification.sessions.deniedPlayer.capabilityKinds.includes("SlotOccupant"),
  true,
);
assert.equal(session.verification.privateChannel.status, "passed");
assert.equal(session.verification.privateChannel.channel, "private:mafia_day_chat");
assert.equal(session.verification.privateChannel.allowed.submitPost.state, "ack");
assert.equal(
  session.verification.privateChannel.allowed.submitPost.requestEnvelope.body.body.command
    .SubmitPost.channel_id,
  "private:mafia_day_chat",
);
assert.equal(session.verification.privateChannel.denied.status, 403);
assert.equal(session.verification.privateChannel.denied.actionLabel, "Back to board");
assert.match(session.verification.privateChannel.denied.recoveredUrl, /\/$/);
assert.equal(
  session.verification.privateChannel.stalePostAfterPhaseTransition.status,
  "passed",
);
assert.equal(
  session.verification.privateChannel.stalePostAfterPhaseTransition.laneId,
  "private-channel-stale-post-after-transition",
);
assert.equal(
  session.verification.privateChannel.stalePostAfterPhaseTransition.channel,
  "private:mafia_day_chat",
);
assert.equal(
  session.verification.privateChannel.stalePostAfterPhaseTransition.stalePost.state,
  "ack",
);
assert.equal(
  session.verification.privateChannel.stalePostAfterPhaseTransition.receiptStatusText.includes(
    "Ack",
  ),
  true,
);
assert.equal(
  session.verification.privateChannel.stalePostAfterPhaseTransition.stalePost
    .requestEnvelope.body.body.command.SubmitPost.channel_id,
  "private:mafia_day_chat",
);
assert.equal(
  session.verification.privateChannel.stalePostAfterPhaseTransition
    .commandStateAfterAck.phase.locked,
  true,
);
assert.equal(
  session.verification.privateChannel.completedGameRecovery.status,
  "passed",
);
assert.equal(
  session.verification.privateChannel.completedGameRecovery.laneId,
  "private-channel-completed-game-recovery",
);
assert.equal(
  session.verification.privateChannel.completedGameRecovery.channel,
  "private:mafia_day_chat",
);
assert.equal(
  session.verification.privateChannel.completedGameRecovery.reject.state,
  "reject",
);
assert.equal(
  session.verification.privateChannel.completedGameRecovery.reject.error,
  "GameAlreadyCompleted",
);
assert.equal(
  session.verification.privateChannel.completedGameRecovery.commandStateAfterReject
    .gameCompleted,
  true,
);
assert.equal(
  session.verification.privateChannel.completedGameRecovery.reloadAfterReject
    .routeResponseStatus,
  200,
);
assert.equal(
  session.verification.privateChannel.completedGameRecovery.reloadAfterReject
    .reloadChannelContext.channelId,
  "private:mafia_day_chat",
);
assert.equal(
  session.verification.privateChannel.completedGameRecovery.reloadAfterReject
    .reloadButtons.some((button) => button.disabled !== true),
  false,
);
assert.equal(
  session.verification.privateChannel.completedGameRecovery.receiptStatusText,
  staleCompletedPrivatePost.commandMessage,
);
assert.equal(
  session.verification.privateChannel.completedGameRecovery.apiThreadPostBodies.includes(
    session.verification.privateChannel.completedGameRecovery.postBody,
  ),
  false,
);
assert.equal(
  session.verification.privateChannel.completedGameRecovery.reloadAfterReject
    .reloadRejectedPostVisible,
  false,
);
const completedPrivateChannelProofLane = proofRun.lanes.find(
  (lane) => lane.id === coreLoopPrivateChannelCompletedPostLaneId,
);
assert.ok(completedPrivateChannelProofLane);
assert.equal(completedPrivateChannelProofLane.status, "passed");
assert.equal(
  completedPrivateChannelProofLane.evidence.receiptStatusText,
  staleCompletedPrivatePost.commandMessage,
);
assert.equal(completedPrivateChannelProofLane.evidence.threadPostPresent, false);
assert.equal(
  completedPrivateChannelProofLane.evidence.reloadControlsDisabled,
  true,
);
assert.equal(
  session.verification.actionLoop.privateChannelInvalidActionRecovery.status,
  "passed",
);
assert.equal(
  session.verification.actionLoop.privateChannelInvalidActionRecovery.laneId,
  privateChannelInvalidActionRecovery.laneId,
);
assert.equal(
  session.verification.actionLoop.privateChannelInvalidActionRecovery.channel,
  privateChannelInvalidActionRecovery.channelId,
);
assert.equal(
  session.verification.actionLoop.privateChannelInvalidActionRecovery.reject.error,
  privateChannelInvalidActionRecovery.commandError,
);
assert.equal(
  session.verification.actionLoop.privateChannelInvalidActionRecovery.receiptStatusText.includes(
    privateChannelInvalidActionRecovery.commandMessage,
  ),
  true,
);
assert.equal(
  session.verification.actionLoop.privateChannelInvalidActionRecovery
    .afterRejectSnapshot.channelContext.channelId,
  privateChannelInvalidActionRecovery.channelId,
);
assert.equal(
  session.verification.actionLoop.privateChannelInvalidActionRecovery
    .afterRejectSnapshot.channelContext.actorSlot,
  privateChannelInvalidActionRecovery.actorSlot,
);
assert.equal(
  session.verification.actionLoop.privateChannelInvalidActionRecovery
    .afterRejectSnapshot.commandState.actions.some(
      (action) =>
        action.templateId ===
        privateChannelInvalidActionRecovery.expectedActionTemplateId,
    ),
  true,
);
assert.equal(
  session.verification.actionLoop.privateChannelInvalidActionRecovery
    .legalActionVisibleAfterReject,
  true,
);
const invalidPrivateChannelProofLane = proofRun.lanes.find(
  (lane) => lane.id === coreLoopPrivateChannelInvalidActionLaneId,
);
assert.ok(invalidPrivateChannelProofLane);
assert.equal(invalidPrivateChannelProofLane.status, "passed");
assert.equal(invalidPrivateChannelProofLane.evidence.routeStatus, 200);
assert.equal(
  invalidPrivateChannelProofLane.evidence.receiptStatusText,
  privateChannelInvalidActionRecovery.commandMessage,
);
assert.equal(
  invalidPrivateChannelProofLane.evidence.channelContextPreserved,
  true,
);
assert.equal(invalidPrivateChannelProofLane.evidence.refreshCommandState, true);
assert.equal(
  invalidPrivateChannelProofLane.evidence.apiLegalActionAvailable,
  true,
);
assert.equal(session.verification.actionLoop.status, "passed");
assert.equal(session.verification.actionLoop.resolveDay.commandStatus.state, "ack");
assert.equal(session.verification.actionLoop.advanceNight.commandStatus.state, "ack");
assert.equal(session.verification.actionLoop.dayNightTransition.status, "passed");
assert.match(
  session.verification.actionLoop.dayNightTransition.hostRoleUrl,
  new RegExp(`/g/${session.game}/host`),
);
assert.match(
  session.verification.actionLoop.dayNightTransition.actionRoleUrl,
  new RegExp(`/g/${session.game}`),
);
assert.match(
  session.verification.actionLoop.dayNightTransition.normalPlayerRoleUrl,
  new RegExp(`/g/${session.game}`),
);
assert.equal(
  session.verification.actionLoop.dayNightTransition.resolveDayState,
  "ack",
);
assert.equal(
  session.verification.actionLoop.dayNightTransition.advanceNightState,
  "ack",
);
assert.equal(
  session.verification.actionLoop.dayNightTransition.dayLockedActionSurface.commandState
    .phase.phaseId,
  "D01",
);
assert.equal(
  session.verification.actionLoop.dayNightTransition.dayLockedActionSurface.commandState
    .phase.locked,
  true,
);
assert.equal(
  session.verification.actionLoop.dayNightTransition.dayLockedActionSurface.buttons.some(
    (button) => String(button.action ?? "").startsWith("submit_action"),
  ),
  false,
);
assert.equal(
  session.verification.actionLoop.dayNightTransition.dayLockedActionSurface.buttons.some(
    (button) => String(button.action ?? "").startsWith("submit_vote"),
  ),
  false,
);
assert.equal(
  session.verification.actionLoop.dayNightTransition.nightActionSurface.commandState
    .phase.phaseId,
  "N01",
);
assert.equal(
  session.verification.actionLoop.dayNightTransition.nightActionSurface.commandState
    .phase.locked,
  false,
);
assert.equal(
  session.verification.actionLoop.dayNightTransition.nightActionSurface.commandState.actions.some(
    (action) => action.templateId === "factional_kill",
  ),
  true,
);
assert.equal(
  session.verification.actionLoop.dayNightTransition.nightActionSurface.buttons.some(
    (button) => button.action === "submit_action:factional_kill" && !button.disabled,
  ),
  true,
);
assert.equal(
  session.verification.actionLoop.dayNightTransition.nightActionSurface.buttons.some(
    (button) => button.action === "submit_invalid_action:factional_kill",
  ),
  true,
);
assert.equal(
  session.verification.actionLoop.dayNightTransition.normalPlayerNightSurface.phase
    .phaseId,
  "N01",
);
assert.equal(
  session.verification.actionLoop.dayNightTransition.normalPlayerNightSurface
    .commandActions.length,
  0,
);
assert.equal(
  session.verification.actionLoop.dayNightTransition.normalPlayerNightSurface
    .factionalKillVisible,
  false,
);
assert.equal(
  session.verification.actionLoop.dayNightTransition.normalPlayerNightSurface
    .directRejectError,
  "InvalidTarget",
);
assert.equal(session.verification.actionLoop.nightResolutionTransition.status, "passed");
assert.match(
  session.verification.actionLoop.nightResolutionTransition.hostRoleUrl,
  new RegExp(`/g/${session.game}/host`),
);
assert.match(
  session.verification.actionLoop.nightResolutionTransition.actionRoleUrl,
  new RegExp(`/g/${session.game}`),
);
assert.match(
  session.verification.actionLoop.nightResolutionTransition.targetRoleUrl,
  new RegExp(`/g/${session.game}`),
);
assert.match(
  session.verification.actionLoop.nightResolutionTransition.normalPlayerRoleUrl,
  new RegExp(`/g/${session.game}`),
);
assert.equal(
  session.verification.actionLoop.nightResolutionTransition.legalActionState,
  "ack",
);
assert.equal(
  session.verification.actionLoop.nightResolutionTransition.legalActionTemplateId,
  "factional_kill",
);
assert.equal(
  session.verification.actionLoop.nightResolutionTransition.resolveNightState,
  "ack",
);
assert.equal(
  session.verification.actionLoop.nightResolutionTransition.resolvedTargetSlot.alive,
  false,
);
assert.equal(
  session.verification.actionLoop.nightResolutionTransition.resolvedTargetSlot.status,
  "dead",
);
assert.equal(
  session.verification.actionLoop.nightResolutionTransition.targetReceiptSurface
    .targetNotice.audience_slot,
  session.verification.actionLoop.nightResolutionTransition.legalActionTarget,
);
assert.equal(
  session.verification.actionLoop.nightResolutionTransition.targetReceiptSurface
    .targetNotice.effect,
  "player_killed",
);
assert.equal(
  session.verification.actionLoop.nightResolutionTransition.targetReceiptSurface
    .targetNotice.status,
  "factional_kill",
);
assert.equal(
  session.verification.actionLoop.nightResolutionTransition.targetReceiptSurface
    .targetPrivateQueueItem.effect,
  "player_killed",
);
assert.equal(
  session.verification.actionLoop.nightResolutionTransition.targetReceiptSurface
    .targetCommandState.actorSlot,
  session.verification.actionLoop.nightResolutionTransition.legalActionTarget,
);
assert.equal(
  session.verification.actionLoop.nightResolutionTransition.targetReceiptSurface
    .targetCommandState.actorAlive,
  false,
);
assert.equal(
  session.verification.actionLoop.nightResolutionTransition.targetReceiptSurface
    .targetCommandState.phase.phaseId,
  "D02",
);
assert.equal(
  session.verification.actionLoop.nightResolutionTransition.targetReceiptSurface
    .targetCommandState.actions.length,
  0,
);
assert.equal(
  session.verification.actionLoop.nightResolutionTransition.advanceDayState,
  "ack",
);
assert.equal(
  session.verification.actionLoop.nightResolutionTransition.d02ActionSurface.commandState
    .phase.phaseId,
  "D02",
);
assert.equal(
  session.verification.actionLoop.nightResolutionTransition.d02ActionSurface.commandState
    .phase.locked,
  false,
);
assert.equal(
  session.verification.actionLoop.nightResolutionTransition.d02ActionSurface.commandState
    .actions.length,
  0,
);
assert.equal(
  session.verification.actionLoop.nightResolutionTransition.d02ActionSurface.buttons.some(
    (button) => String(button.action ?? "").startsWith("submit_action"),
  ),
  false,
);
assert.equal(
  session.verification.actionLoop.nightResolutionTransition.d02ActionSurface.buttons.some(
    (button) => String(button.action ?? "").startsWith("submit_vote"),
  ),
  true,
);
assert.equal(
  session.verification.actionLoop.nightResolutionTransition.d02NormalPlayerSurface
    .commandState.phase.phaseId,
  "D02",
);
assert.equal(
  session.verification.actionLoop.nightResolutionTransition.d02NormalPlayerSurface
    .commandState.phase.locked,
  false,
);
assert.equal(
  session.verification.actionLoop.nightResolutionTransition.d02NormalPlayerSurface
    .commandState.actions.length,
  0,
);
assert.equal(
  session.verification.actionLoop.nightResolutionTransition.d02NormalPlayerSurface.buttons.some(
    (button) => String(button.action ?? "").startsWith("submit_vote"),
  ),
  true,
);
assert.equal(session.verification.actionLoop.deadlineAdvance.status, "passed");
assert.equal(
  session.verification.actionLoop.deadlineAdvance.advance.commandStatus.requestEnvelope.body.body
    .command.AdvancePhaseByDeadline.phase,
  "D01",
);
assert.equal(
  session.verification.actionLoop.deadlineAdvance.advance.commandStatus.requestEnvelope.body.body
    .command.AdvancePhaseByDeadline.observed_at,
  session.verification.actionLoop.deadlineAdvance.phaseBeforeAdvance.deadline + 1,
);
assert.equal(
  session.verification.actionLoop.deadlineAdvance.phaseBeforeAdvance.locked,
  true,
);
assert.equal(
  session.verification.actionLoop.deadlineAdvance.phaseAfterAdvance.id,
  "N01",
);
assert.equal(
  session.verification.actionLoop.deadlineAdvance.phaseAfterAdvance.locked,
  false,
);
assert.equal(
  session.verification.actionLoop.deadlineAdvance.apiPhaseAfterAdvance.phase_id,
  "N01",
);
assert.equal(
  session.verification.actionLoop.deadlineAdvance.apiPhaseAfterAdvance.deadline,
  null,
);
assert.equal(session.verification.actionLoop.staleDeadlineAdvance.status, "passed");
assert.equal(
  session.verification.actionLoop.staleDeadlineAdvance.setup.stalePhase.id,
  "D01",
);
assert.equal(
  session.verification.actionLoop.staleDeadlineAdvance.setup.stalePhase.locked,
  true,
);
assert.equal(
  Number.isInteger(
    session.verification.actionLoop.staleDeadlineAdvance.setup.stalePhase.deadline,
  ),
  true,
);
assert.equal(
  session.verification.actionLoop.staleDeadlineAdvance.reject.error,
  "InvalidTarget",
);
assert.match(
  session.verification.actionLoop.staleDeadlineAdvance.reject.message,
  /deadline target is stale/,
);
assert.equal(
  session.verification.actionLoop.staleDeadlineAdvance.phaseAfterReject.id,
  "N01",
);
assert.equal(
  session.verification.actionLoop.staleDeadlineAdvance.phaseAfterReject.locked,
  false,
);
assert.equal(
  session.verification.actionLoop.staleDeadlineAdvance.activityRow.actionId,
  "advance_phase_by_deadline",
);
assert.equal(
  session.verification.actionLoop.staleDeadlineAdvance.dispatchPlan.projectionRefreshKeys.includes(
    "host",
  ),
  true,
);
assert.equal(
  session.verification.actionLoop.staleDeadlineAdvance.visibleActionsAfterReject.includes(
    "resolve_phase",
  ),
  true,
);
assert.equal(
  session.verification.actionLoop.staleDeadlineAdvance.visibleActionsAfterReject.includes(
    "advance_phase_by_deadline",
  ),
  false,
);
assert.equal(
  session.verification.actionLoop.staleDeadlineAdvance.apiPhaseAfterReject.phase_id,
  "N01",
);
assert.equal(
  session.verification.actionLoop.staleDeadlineAdvance.apiPhaseAfterReject.deadline,
  null,
);
assert.equal(session.verification.actionLoop.n01Phase.phaseId, "N01");
assert.equal(session.verification.actionLoop.invalidAction.state, "reject");
assert.equal(session.verification.actionLoop.invalidAction.error, "InvalidTarget");
assert.equal(session.verification.invalidActionRecovery.status, "passed");
assert.equal(session.verification.invalidActionRecovery.reject.error, "InvalidTarget");
assert.equal(
  session.verification.invalidActionRecovery.currentReceipt.actionId,
  "submit_invalid_action:factional_kill",
);
assert.equal(session.verification.invalidActionRecovery.currentReceipt.state, "reject");
assert.equal(
  session.verification.invalidActionRecovery.currentReceipt.commandTrace.projectionRefreshKeys.includes(
    "commandState",
  ),
  true,
);
assert.equal(session.verification.invalidActionRecovery.commandState.phase.phaseId, "N01");
assert.equal(
  session.verification.invalidActionRecovery.commandState.actions.some(
    (action) => action.templateId === "factional_kill",
  ),
  true,
);
assert.equal(session.verification.invalidActionRecovery.legalActionVisible, true);
assert.equal(
  session.verification.invalidActionRecovery.receiptStatusText.includes(
    playerInvalidActionRecoveryMessage,
  ),
  true,
);
assert.equal(session.verification.actionLoop.legalAction.state, "ack");
assert.equal(
  session.verification.actionLoop.legalAction.requestEnvelope.body.body.command.SubmitAction
    .template_id,
  "factional_kill",
);
assert.equal(session.verification.actionLoop.resolveNight.commandStatus.state, "ack");
assert.equal(session.verification.actionLoop.resolvedTargetSlot.alive, false);
assert.equal(session.verification.actionLoop.advanceDay.commandStatus.state, "ack");
assert.equal(session.verification.actionLoop.d02Phase.phaseId, "D02");
assert.equal(session.verification.actionLoop.d02VoteNightTransition.status, "passed");
assert.match(
  session.verification.actionLoop.d02VoteNightTransition.hostRoleUrl,
  new RegExp(`/g/${session.verification.actionLoop.d02VoteNightTransition.game}/host`),
);
assert.match(
  session.verification.actionLoop.d02VoteNightTransition.actionRoleUrl,
  new RegExp(`/g/${session.verification.actionLoop.d02VoteNightTransition.game}`),
);
assert.match(
  session.verification.actionLoop.d02VoteNightTransition.playerRoleUrl,
  new RegExp(`/g/${session.verification.actionLoop.d02VoteNightTransition.game}`),
);
assert.match(
  session.verification.actionLoop.d02VoteNightTransition.targetRoleUrl,
  new RegExp(`/g/${session.verification.actionLoop.d02VoteNightTransition.game}`),
);
assert.equal(
  session.verification.actionLoop.d02VoteNightTransition.hostBeforeVote.phase.id,
  "D02",
);
assert.equal(
  session.verification.actionLoop.d02VoteNightTransition.hostBeforeVote.phase.locked,
  false,
);
assert.equal(
  session.verification.actionLoop.d02VoteNightTransition.voteTarget.slotId,
  "slot-2",
);
assert.equal(
  session.verification.actionLoop.d02VoteNightTransition.finalVote.state,
  "ack",
);
assert.equal(
  session.verification.actionLoop.d02VoteNightTransition.finalVote.requestEnvelope.body.body
    .command.SubmitVote.actor_slot,
  "slot_4",
);
assert.equal(
  session.verification.actionLoop.d02VoteNightTransition.finalVote.requestEnvelope.body.body
    .command.SubmitVote.target.Slot,
  "slot-2",
);
assert.equal(
  session.verification.actionLoop.d02VoteNightTransition.apiVoteRow.count,
  3,
);
assert.equal(
  session.verification.actionLoop.d02VoteNightTransition.resolveD02.commandStatus.state,
  "ack",
);
assert.equal(
  session.verification.actionLoop.d02VoteNightTransition.hostAfterResolve.phase.id,
  "D02",
);
assert.equal(
  session.verification.actionLoop.d02VoteNightTransition.hostAfterResolve.phase.locked,
  true,
);
assert.equal(
  session.verification.actionLoop.d02VoteNightTransition.dayVoteOutcome.status,
  "Lynch",
);
assert.equal(
  session.verification.actionLoop.d02VoteNightTransition.dayVoteOutcome.winnerSlot,
  "slot-2",
);
assert.equal(
  session.verification.actionLoop.d02VoteNightTransition.dayVoteOutcome.tallies[
    "slot-2"
  ],
  3,
);
assert.equal(
  session.verification.actionLoop.d02VoteNightTransition.hostSlotAfterResolve.alive,
  false,
);
assert.equal(
  session.verification.actionLoop.d02VoteNightTransition.targetReceiptSurface.targetNotice
    .effect,
  "player_killed",
);
assert.equal(
  session.verification.actionLoop.d02VoteNightTransition.targetReceiptSurface.targetNotice
    .status,
  "day_vote",
);
assert.equal(
  session.verification.actionLoop.d02VoteNightTransition.targetReceiptSurface
    .targetCommandState.actorAlive,
  false,
);
assert.equal(
  session.verification.actionLoop.d02VoteNightTransition.advanceN02.commandStatus.state,
  "ack",
);
assert.equal(
  session.verification.actionLoop.d02VoteNightTransition.n02HostSurface.phase.id,
  "N02",
);
assert.equal(
  session.verification.actionLoop.d02VoteNightTransition.n02ActionSurface.commandState
    .phase.phaseId,
  "N02",
);
assert.equal(
  session.verification.actionLoop.d02VoteNightTransition.n02ActionSurface.commandState.actions.some(
    (action) => action.templateId === "factional_kill",
  ),
  true,
);
assert.equal(
  session.verification.actionLoop.d02VoteNightTransition.n02ActionSurface.buttons.some(
    (button) => button.action === "submit_action:factional_kill" && !button.disabled,
  ),
  true,
);
assert.equal(
  session.verification.actionLoop.d02VoteNightTransition.n02NormalPlayerSurface
    .factionalKillVisible,
  false,
);
assert.equal(
  session.verification.actionLoop.d02VoteNightTransition.d03TerminalVoteSubmission.state,
  "ack",
);
assert.equal(
  session.verification.actionLoop.d02VoteNightTransition.d03TerminalVoteSubmission
    .requestEnvelope.body.body.principal_user_id,
  "player-mira",
);
assert.equal(
  session.verification.actionLoop.d02VoteNightTransition.d03TerminalVoteSubmission
    .requestEnvelope.body.body.command.SubmitVote.actor_slot,
  "slot-7",
);
assert.equal(
  session.verification.actionLoop.d02VoteNightTransition.d03TerminalVoteSubmission
    .requestEnvelope.body.body.command.SubmitVote.target.Slot,
  "slot_4",
);
assert.equal(
  session.verification.actionLoop.d02VoteNightTransition.d03TerminalApiVoteRow
    .phaseId,
  "D03",
);
assert.equal(
  session.verification.actionLoop.d02VoteNightTransition.d03TerminalApiVoteRow
    .target,
  "slot_4",
);
assert.equal(
  session.verification.actionLoop.d02VoteNightTransition.d03TerminalApiVoteRow
    .count,
  1,
);
assert.equal(
  session.verification.actionLoop.d02VoteNightTransition.resolveD03.commandStatus
    .state,
  "ack",
);
assert.equal(
  session.verification.actionLoop.d02VoteNightTransition.hostAfterResolveD03.phase
    .id,
  "D03",
);
assert.equal(
  session.verification.actionLoop.d02VoteNightTransition.hostAfterResolveD03.phase
    .locked,
  true,
);
assert.equal(
  session.verification.actionLoop.d02VoteNightTransition.d03TerminalDayVoteOutcome
    .status,
  "NoMajority",
);
assert.equal(
  session.verification.actionLoop.d02VoteNightTransition.d03TerminalDayVoteOutcome
    .winnerSlot,
  null,
);
assert.equal(
  session.verification.actionLoop.d02VoteNightTransition.d03TerminalResolvedSlot
    .alive,
  true,
);
assert.equal(
  session.verification.actionLoop.d02VoteNightTransition.d03TerminalResolvedSlot
    .status,
  "alive",
);
assert.equal(
  session.verification.actionLoop.d02VoteNightTransition.d03TerminalAdvanceReject
    .commandStatus.state,
  "reject",
);
assert.equal(
  session.verification.actionLoop.d02VoteNightTransition.d03TerminalAdvanceReject
    .commandStatus.error,
  "InvalidTarget",
);
assert.equal(
  session.verification.actionLoop.d02VoteNightTransition.hostAfterTerminalAdvanceReject
    .phase.locked,
  true,
);
assert.equal(
  session.verification.actionLoop.d02VoteNightTransition.hostAfterTerminalAdvanceReject
    .phaseActions.includes("advance_phase"),
  true,
);
assert.match(
  session.verification.actionLoop.d02VoteNightTransition
    .d03TerminalActivityStatusText,
  /Reject InvalidTarget/,
);
assert.match(
  session.verification.actionLoop.d02VoteNightTransition
    .d03TerminalActivityStatusText,
  /stale phase state/,
);
assert.equal(
  session.verification.actionLoop.d02VoteNightTransition.d03TerminalActivityRow
    .actionId,
  "advance_phase",
);
assert.equal(
  session.verification.actionLoop.d02VoteNightTransition.d03TerminalDispatchPlan
    .projectionRefreshKeys.includes("host"),
  true,
);
assert.equal(
  session.verification.actionLoop.d02VoteNightTransition
    .d03TerminalHostReloadAfterReject.status,
  "passed",
);
assert.equal(
  session.verification.actionLoop.d02VoteNightTransition
    .d03TerminalHostReloadAfterReject.routeResponseStatus,
  200,
);
assert.match(
  session.verification.actionLoop.d02VoteNightTransition
    .d03TerminalHostReloadAfterReject.rejectReceiptStatusText,
  /Reject InvalidTarget/,
);
assert.equal(
  session.verification.actionLoop.d02VoteNightTransition
    .d03TerminalHostReloadAfterReject.phase.id,
  "D03",
);
assert.equal(
  session.verification.actionLoop.d02VoteNightTransition
    .d03TerminalHostReloadAfterReject.phase.locked,
  true,
);
assert.equal(
  session.verification.actionLoop.d02VoteNightTransition
    .d03TerminalHostReloadAfterReject.phaseActions.includes("advance_phase"),
  true,
);
assert.equal(
  session.verification.actionLoop.d02VoteNightTransition
    .d03TerminalHostReloadAfterReject.phaseActions.includes("unlock_thread"),
  true,
);
assert.equal(
  session.verification.actionLoop.d02VoteNightTransition
    .d03TerminalHostReloadAfterReject.dayVoteOutcomes.some(
      (row) => row.phaseId === "D03" && row.status === "NoMajority",
    ),
  true,
);
const concurrentVoteRace = session.verification.multiplayerHardening.concurrentVoteRace;
const expectedOfficialVotecountBody = `Official votecount for D02\n- ${concurrentVoteRace.targetSlot}: ${concurrentVoteRace.apiProjection.count}`;
const voteResolveRace =
  session.verification.multiplayerHardening.concurrentPlayerVoteResolveRace;
const actionAdvanceRace =
  session.verification.multiplayerHardening.concurrentPlayerActionAdvanceRace;
const cohostDeadlineResolveRace =
  session.verification.multiplayerHardening.concurrentCohostDeadlineResolveRace;
const replacementPrivatePostRace =
  session.verification.multiplayerHardening.concurrentReplacementPrivatePostRace;
const replacementVoteRace =
  session.verification.multiplayerHardening.concurrentReplacementVoteRace;
const replacementActionRace =
  session.verification.multiplayerHardening.concurrentReplacementActionRace;
const replacementIncomingAction =
  session.verification.multiplayerHardening.replacementIncomingAction;
const replacementActionReconnect =
  session.verification.multiplayerHardening.replacementActionReconnect;
const replacementStaleActionAfterResolve =
  session.verification.multiplayerHardening.replacementStaleActionAfterResolve;
const replacementStalePrivatePostAfterResolve =
  session.verification.multiplayerHardening.replacementStalePrivatePostAfterResolve;
const replacementStalePrivatePostAfterComplete =
  session.verification.multiplayerHardening.replacementStalePrivatePostAfterComplete;
const concurrentPlayerCompleteRace =
  session.verification.multiplayerHardening.concurrentPlayerCompleteRace;
const stalePlayerComplete =
  session.verification.multiplayerHardening.stalePlayerComplete;
assertCompletedPlayerEndgameRefreshBrowserProof({
  proof: stalePlayerComplete,
  includeEvidenceInError: true,
});
const concurrentHostPublishRace =
  session.verification.multiplayerHardening.concurrentHostPublishRace;
assert.equal(session.verification.multiplayerHardening.hostVotecountPublication.status, "passed");
assert.equal(
  session.verification.multiplayerHardening.hostVotecountPublication.publish.commandStatus
    .state,
  "ack",
);
assert.equal(
  session.verification.multiplayerHardening.hostVotecountPublication.publish.commandStatus
    .requestEnvelope.body.body.command.PublishVotecount.game,
  session.game,
);
assert.equal(
  session.verification.multiplayerHardening.hostVotecountPublication.expectedBody,
  expectedOfficialVotecountBody,
);
assert.equal(
  session.verification.multiplayerHardening.hostVotecountPublication.playerThreadPost
    .authorLabel,
  "host",
);
assert.equal(
  session.verification.multiplayerHardening.hostVotecountPublication.playerThreadPost.body,
  expectedOfficialVotecountBody,
);
assert.equal(
  session.verification.multiplayerHardening.hostVotecountPublication.apiThreadPost
    .author_user,
  "host",
);
assert.equal(
  session.verification.multiplayerHardening.hostVotecountPublication.apiThreadPost.body,
  expectedOfficialVotecountBody,
);
assert.match(
  session.verification.multiplayerHardening.hostVotecountPublication.activityStatusText,
  /Ack: stream seqs/,
);
assert.equal(concurrentHostPublishRace.status, "passed");
assert.equal(concurrentHostPublishRace.targetSlot, "slot_5");
assert.equal(concurrentHostPublishRace.targetCount, 3);
assert.equal(concurrentHostPublishRace.expectedBody, "Official votecount for D01\n- slot_5: 3");
assert.equal(concurrentHostPublishRace.ack.state, "ack");
assert.equal(concurrentHostPublishRace.ack.serverEnvelope.body.kind, "Ack");
assert.equal(Array.isArray(concurrentHostPublishRace.ack.streamSeqs), true);
assert.equal(concurrentHostPublishRace.reject.state, "reject");
assert.equal(concurrentHostPublishRace.reject.error, "InvalidTarget");
assert.equal(concurrentHostPublishRace.reject.serverEnvelope.body.kind, "Reject");
assert.match(concurrentHostPublishRace.reject.message, /official votecount is already published/);
assert.equal(Array.isArray(concurrentHostPublishRace.reject.streamSeqs), false);
assert.notEqual(concurrentHostPublishRace.ackRaceRole, concurrentHostPublishRace.rejectRaceRole);
assert.deepEqual(concurrentHostPublishRace.commandGames, [
  concurrentHostPublishRace.game,
  concurrentHostPublishRace.game,
]);
assert.equal(concurrentHostPublishRace.apiOfficialPostCount, 1);
assert.equal(concurrentHostPublishRace.playerOfficialPostCount, 1);
assert.equal(concurrentHostPublishRace.roleReloadAfterRace.status, "passed");
assert.equal(concurrentHostPublishRace.roleReloadAfterRace.firstHostRouteStatus, 200);
assert.equal(concurrentHostPublishRace.roleReloadAfterRace.secondHostRouteStatus, 200);
assert.equal(concurrentHostPublishRace.roleReloadAfterRace.playerRouteStatus, 200);
assert.equal(
  concurrentHostPublishRace.roleReloadAfterRace.firstHostProjection.some(
    (row) => row.target === "slot_5" && row.count === 3,
  ),
  true,
);
assert.equal(
  concurrentHostPublishRace.roleReloadAfterRace.secondHostProjection.some(
    (row) => row.target === "slot_5" && row.count === 3,
  ),
  true,
);
assert.equal(
  concurrentHostPublishRace.roleReloadAfterRace.playerProjection.some(
    (row) => row.target === "slot_5" && row.count === 3,
  ),
  true,
);
assert.equal(concurrentHostPublishRace.roleReloadAfterRace.apiProjection.phaseId, "D01");
assert.equal(concurrentHostPublishRace.roleReloadAfterRace.apiProjection.target, "slot_5");
assert.equal(concurrentHostPublishRace.roleReloadAfterRace.apiProjection.count, 3);
assert.equal(concurrentHostPublishRace.roleReloadAfterRace.apiOfficialPostCount, 1);
assert.equal(concurrentHostPublishRace.roleReloadAfterRace.playerOfficialPostCount, 1);
assert.equal(session.verification.multiplayerHardening.staleHostPublish.status, "passed");
assert.equal(
  session.verification.multiplayerHardening.staleHostPublish.setup.stalePhase.id,
  "D02",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostPublish.setup.stalePhase.locked,
  false,
);
assert(
  session.verification.multiplayerHardening.staleHostPublish.setup.votecountActions.includes(
    "publish_votecount",
  ),
);
assert.equal(
  session.verification.multiplayerHardening.staleHostPublish.reject.state,
  "reject",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostPublish.reject.error,
  "InvalidTarget",
);
assert.match(
  session.verification.multiplayerHardening.staleHostPublish.reject.message,
  /official votecount is already published/,
);
assert.equal(
  Array.isArray(session.verification.multiplayerHardening.staleHostPublish.reject.streamSeqs),
  false,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostPublish.activityRow.actionId,
  "publish_votecount",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostPublish.dispatchPlan
    .projectionRefreshKeys.length,
  0,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostPublish.apiOfficialPostCount,
  1,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostPublish.playerOfficialPostCount,
  1,
);
assert.equal(session.verification.resolutionReceipts.status, "passed");
assert.equal(session.verification.resolutionReceipts.targetSlot, "slot-2");
assert.equal(session.verification.resolutionReceipts.hostSlotReceipt.alive, false);
assert.equal(session.verification.resolutionReceipts.hostSlotReceipt.status, "dead");
assert.equal(session.verification.resolutionReceipts.targetNotice.audience_slot, "slot-2");
assert.equal(session.verification.resolutionReceipts.targetNotice.effect, "player_killed");
assert.equal(session.verification.resolutionReceipts.targetNotice.status, "factional_kill");
assert.equal(session.verification.resolutionReceipts.targetCommandState.actorSlot, "slot-2");
assert.equal(session.verification.resolutionReceipts.targetCommandState.actions.length, 0);
assert.equal(session.verification.resolutionReceipts.actionReceipt.state, "ack");
assert.equal(session.verification.resolutionReceipts.actionReceipt.templateId, "factional_kill");
assert.equal(session.verification.resolutionReceipts.actionReceipt.target, "slot-2");
assert.equal(session.verification.resolutionReceipts.normalPlayerNoticeVisible, false);
assert.equal(session.verification.resolutionReceipts.actionPlayerNoticeVisible, false);
assert.equal(session.verification.deadPlayerRecovery.status, "passed");
assert.equal(session.verification.deadPlayerRecovery.targetSlot, "slot-2");
assert.equal(session.verification.deadPlayerRecovery.commandState.actorSlot, "slot-2");
assert.equal(session.verification.deadPlayerRecovery.commandState.actorAlive, false);
assert.equal(session.verification.deadPlayerRecovery.commandState.actorStatus, "dead");
assert.equal(session.verification.deadPlayerRecovery.commandState.phase.phaseId, "D02");
assert.equal(session.verification.deadPlayerRecovery.commandState.actions.length, 0);
assert.equal(session.verification.deadPlayerRecovery.channelContext.actorSlot, "slot-2");
assert.equal(session.verification.deadPlayerRecovery.channelContext.actorAlive, "false");
assert.equal(session.verification.deadPlayerRecovery.channelContext.actorStatus, "dead");
assert.equal(session.verification.deadPlayerRecovery.disabledControls.vote.exists, false);
assert.equal(session.verification.deadPlayerRecovery.disabledControls.vote.disabled, true);
assert.equal(
  session.verification.deadPlayerRecovery.disabledControls.withdraw.disabled,
  true,
);
assert.equal(session.verification.deadPlayerRecovery.disabledControls.post.disabled, true);
assert.equal(session.verification.deadPlayerRecovery.actionControlCount, 0);
assert.equal(
  session.verification.deadPlayerRecovery.directVote.serverEnvelope.body.body.error,
  "SlotNotAlive",
);
assert.equal(
  session.verification.deadPlayerRecovery.directPost.serverEnvelope.body.body.error,
  "SlotNotAlive",
);
assert.equal(
  session.verification.deadPlayerRecovery.directAction.serverEnvelope.body.body.error,
  "SlotNotAlive",
);
assert.equal(
  session.verification.deadPlayerRecovery.directVote.requestEnvelope.body.body
    .principal_user_id,
  "player-target",
);
assert.equal(
  session.verification.deadPlayerRecovery.directPost.requestEnvelope.body.body
    .principal_user_id,
  "player-target",
);
assert.equal(
  session.verification.deadPlayerRecovery.directAction.requestEnvelope.body.body
    .principal_user_id,
  "player-target",
);
assert.equal(
  session.verification.deadPlayerRecovery.commandStateAfterRejects.actorAlive,
  false,
);
assert.equal(
  session.verification.deadPlayerRecovery.commandStateAfterRejects.actions.length,
  0,
);
assert.equal(session.verification.playerActionBoundary.status, "passed");
assert.equal(session.verification.playerActionBoundary.phase.phaseId, "N01");
assert.equal(session.verification.playerActionBoundary.commandActions.length, 0);
assert.equal(session.verification.playerActionBoundary.factionalKillVisible, false);
assert.equal(
  session.verification.playerActionBoundary.directFactionalKill.serverEnvelope.body.kind,
  "Reject",
);
assert.equal(
  session.verification.playerActionBoundary.directFactionalKill.serverEnvelope.body.body.error,
  "InvalidTarget",
);
assert.equal(
  session.verification.playerActionBoundary.directFactionalKill.requestEnvelope.body.body
    .principal_user_id,
  "player-mira",
);
assert.equal(
  session.verification.playerActionBoundary.directFactionalKill.requestEnvelope.body.body.command
    .SubmitAction.template_id,
  "factional_kill",
);
assert.equal(session.verification.playerActionBoundary.phaseAfterReject.phaseId, "N01");
assert.equal(session.verification.playerActionBoundary.actionVisibleAfterReject, false);
assert.equal(session.verification.replacementConsole.status, "passed");
assert.equal(
  session.verification.replacementConsole.hostIssuedInvite.status,
  "passed",
);
assert.equal(
  session.verification.replacementConsole.hostIssuedInvite.targetLabel,
  "Slot 7 / player-rowan",
);
assert.equal(
  session.verification.replacementConsole.hostIssuedInvite.session.principalUserId,
  "player-rowan",
);
assert.equal(
  session.verification.replacementConsole.hostIssuedInvite.session.issuedBy
    .principalUserId,
  "host_h",
);
assert.equal(
  session.verification.replacementConsole.hostIssuedInvite.session.issuedBy
    .capabilityKind,
  "HostOf",
);
assert.equal(
  session.verification.replacementConsole.hostIssuedInvite.session.issuedBy.game,
  session.game,
);
assert.equal(
  session.verification.replacementConsole.hostIssuedInvite.session.returnTo,
  `/g/${session.game}`,
);
assert.equal(
  session.verification.replacementConsole.hostIssuedInvite.tokenPresent,
  true,
);
assert.equal(
  session.verification.replacementConsole.pendingIncomingPlayer.status,
  "passed",
);
assert.equal(
  session.verification.replacementConsole.pendingIncomingPlayer.principalUserId,
  "player-rowan",
);
assert.equal(
  session.verification.replacementConsole.pendingIncomingPlayer.capabilityKinds.length,
  0,
);
assert.equal(
  session.verification.replacementConsole.pendingIncomingPlayer.capabilityLabel,
  `PendingReplacement(${session.game})`,
);
assert.match(
  session.verification.replacementConsole.pendingIncomingPlayer.routeStateText,
  /Replacement invite accepted/,
);
assert.equal(
  session.verification.replacementConsole.pendingIncomingPlayer.commandState.actorStatus,
  "pending_replacement",
);
assert.equal(
  session.verification.replacementConsole.pendingIncomingPlayer.commandState.actions.length,
  0,
);
assert.equal(
  session.verification.replacementConsole.pendingIncomingPlayer.coldLoadEndpoints
    .commandStateEndpoint,
  null,
);
assert.equal(
  session.verification.replacementConsole.pendingIncomingPlayer.controlCounts
    .primaryButtons,
  0,
);
assert.equal(
  session.verification.replacementConsole.pendingIncomingPlayer.controlCounts
    .actionButtons,
  0,
);
assert.equal(
  session.verification.replacementConsole.redeemedInviteRecovery.status,
  "passed",
);
assert.equal(
  session.verification.replacementConsole.redeemedInviteRecovery.message,
  "Session or invite token is missing, expired, or revoked",
);
assert.equal(
  session.verification.replacementConsole.redeemedInviteRecovery.prefilledInviteToken,
  true,
);
assert.equal(
  session.verification.replacementConsole.redeemedInviteRecovery.sessionCookiePresent,
  false,
);
assert.equal(
  session.verification.replacementConsole.redeemedInviteRecovery.stayedOnLogin,
  true,
);
assert.equal(
  session.verification.replacementConsole.replacementSessionRevocation.status,
  "passed",
);
assert.equal(
  session.verification.replacementConsole.replacementSessionRevocation
    .revokedPrincipalUserId,
  "player-rowan",
);
assert.equal(
  session.verification.replacementConsole.replacementSessionRevocation.apiSessionStatus,
  401,
);
assert.equal(
  session.verification.replacementConsole.replacementSessionRevocation.routeErrorStatus,
  403,
);
assert.equal(
  session.verification.replacementConsole.replacementSessionRevocation
    .routeErrorActionHref,
  "/",
);
assert.equal(
  session.verification.replacementConsole.replacementSessionRevocation
    .playerSurfaceVisible,
  false,
);
assert.equal(
  session.verification.replacementConsole.replacementSessionRevocation.controlCounts
    .primaryButtons,
  0,
);
assert.equal(
  session.verification.replacementConsole.replacementSessionRevocation.controlCounts
    .actionButtons,
  0,
);
assert.equal(
  session.verification.replacementConsole.replacementSessionRefresh.status,
  "passed",
);
assert.equal(
  session.verification.replacementConsole.replacementSessionRefresh.session
    .credentialKind,
  "session",
);
assert.equal(
  session.verification.replacementConsole.replacementSessionRefresh.session
    .principalUserId,
  "player-rowan",
);
assert.equal(
  session.verification.replacementConsole.replacementSessionRefresh.login
    .usedInviteToken,
  false,
);
assert.equal(
  session.verification.replacementConsole.replacementSessionRefresh.login
    .landedOnDirectUrl,
  true,
);
assert.equal(
  session.verification.replacementConsole.replacementSessionRefresh.browserEntry
    .principalUserId,
  "player-rowan",
);
assert(
  session.verification.replacementConsole.replacementSessionRefresh.browserEntry
    .capabilityKinds.includes("SlotOccupant"),
);
assert.equal(
  session.verification.replacementConsole.replacementSessionRefresh.commandState
    .actorSlot,
  "slot-7",
);
assert.equal(
  session.verification.replacementConsole.replacementSessionRefresh.commandState
    .actorAlive,
  true,
);
assert.equal(
  session.verification.replacementConsole.replacementSessionRefresh.postStatus.state,
  "ack",
);
assert.equal(
  session.verification.replacementConsole.replacementSessionRefresh.postStatus
    .requestEnvelope.body.body.principal_user_id,
  "player-rowan",
);
assert.equal(
  session.verification.replacementConsole.replacementSessionRefresh.postStatus
    .requestEnvelope.body.body.command.SubmitPost.actor_slot,
  "slot-7",
);
assert.equal(
  session.verification.replacementConsole.replacementSessionRefresh.rowanProjectedPost
    .authorSlot,
  "slot-7",
);
assert.equal(
  session.verification.replacementConsole.replacementSessionRefresh
    .privateReceiptIsolation.targetKillVisible,
  false,
);
assert.equal(
  session.verification.replacementConsole.replacementSessionRefresh
    .privateReceiptIsolation.actionResultVisible,
  false,
);
assert.equal(
  session.verification.replacementConsole.replacementStaleSessionAfterRefresh.status,
  "passed",
);
assert.equal(
  session.verification.replacementConsole.replacementStaleSessionAfterRefresh
    .apiSessionStatus,
  401,
);
assert.equal(
  session.verification.replacementConsole.replacementStaleSessionAfterRefresh
    .routeErrorStatus,
  403,
);
assert.equal(
  session.verification.replacementConsole.replacementStaleSessionAfterRefresh
    .routeErrorActionHref,
  "/",
);
assert.equal(
  session.verification.replacementConsole.replacementStaleSessionAfterRefresh
    .playerSurfaceVisible,
  false,
);
assert.equal(
  session.verification.replacementConsole.replacementStaleSessionAfterRefresh
    .controlCounts.primaryButtons,
  0,
);
assert.equal(
  session.verification.replacementConsole.replacementStaleSessionAfterRefresh
    .controlCounts.actionButtons,
  0,
);
assert.equal(
  session.verification.replacementConsole.replacementStaleSessionAfterRefresh
    .staleCookie.valuePrefix,
  "invite-session-",
);
assert.equal(
  session.verification.replacementConsole.replacementStaleSessionAfterRefresh
    .freshCredentialKind,
  "session",
);
assert.equal(
  session.verification.replacementConsole.replacementStaleSessionAfterRefresh
    .freshRoleUrlHasInvite,
  false,
);
assert.equal(
  session.verification.replacementConsole.replacementReconnectRecovery.status,
  "passed",
);
assert.equal(
  session.verification.replacementConsole.replacementReconnectRecovery.principalUserId,
  "player-rowan",
);
assert.equal(
  session.verification.replacementConsole.replacementReconnectRecovery.actorSlot,
  "slot-7",
);
assert.equal(
  session.verification.replacementConsole.replacementReconnectRecovery
    .reconnectingStatus.state,
  "reconnecting",
);
assert.equal(
  session.verification.replacementConsole.replacementReconnectRecovery
    .reconnectRecoveryEvent.state,
  "recovered",
);
assert.equal(
  session.verification.replacementConsole.replacementReconnectRecovery
    .reconnectRecoveryEvent.attempt,
  1,
);
assert.equal(
  session.verification.replacementConsole.replacementReconnectRecovery
    .recoveredSnapshotContainsPost,
  true,
);
assert.equal(
  session.verification.replacementConsole.replacementReconnectRecovery
    .reconnectCommand.principalUserId,
  "player-rowan",
);
assert.equal(
  session.verification.replacementConsole.replacementReconnectRecovery
    .reconnectCommand.command.SubmitPost.actor_slot,
  "slot-7",
);
assert.equal(
  session.verification.replacementConsole.replacementReconnectRecovery
    .recoveredCommandState.actorSlot,
  "slot-7",
);
assert.equal(
  session.verification.replacementConsole.replacementReconnectRecovery
    .recoveredCommandState.actorAlive,
  true,
);
assert.match(
  session.verification.replacementConsole.replacementReconnectRecovery
    .recoveredPostBody,
  /^Replacement Rowan reconnect proof from dev:test-game /,
);
assert.equal(
  session.verification.replacementConsole.invalidReplacementRecovery.status,
  "passed",
);
assert.equal(
  session.verification.replacementConsole.invalidReplacementRecovery.invalidReplacement
    .serverEnvelope.body.kind,
  "Reject",
);
assert.equal(
  session.verification.replacementConsole.invalidReplacementRecovery.reject.error,
  "InvalidTarget",
);
assert.equal(
  session.verification.replacementConsole.invalidReplacementRecovery.invalidReplacement
    .requestEnvelope.body.body.principal_user_id,
  "host_h",
);
assert.equal(
  session.verification.replacementConsole.invalidReplacementRecovery.invalidReplacement
    .requestEnvelope.body.body.command.ProcessReplacement.outgoing_user,
  "player-rowan",
);
assert.equal(
  session.verification.replacementConsole.invalidReplacementRecovery.apiSlotAfterReject
    .occupant_user_id,
  "player-mira",
);
assert.match(
  session.verification.replacementConsole.invalidReplacementRecovery.activityStatusText,
  /Reject InvalidTarget/,
);
assert.equal(
  session.verification.replacementConsole.invalidReplacementRecovery.activityRow.source,
  "outcome",
);
assert.equal(
  session.verification.replacementConsole.invalidReplacementRecovery.activityRow.actionId,
  "process_replacement_invalid_target",
);
assert.equal(
  session.verification.replacementConsole.invalidReplacementRecovery.activityRow.dispatchKind,
  "process_replacement",
);
assert.equal(
  session.verification.replacementConsole.invalidReplacementRecovery.dispatchPlan.finalState,
  "reject",
);
assert.equal(
  session.verification.replacementConsole.invalidReplacementRecovery.dispatchPlan
    .projectionRefreshKeys.length,
  0,
);
assert.equal(
  session.verification.replacementConsole.invalidReplacementRecovery
    .hostProjectionAfterReject.occupantLabel,
  "player-mira",
);
assert.equal(
  session.verification.replacementConsole.invalidReplacementRecovery.pendingAfterReject
    .principalUserId,
  "player-rowan",
);
assert.equal(
  session.verification.replacementConsole.invalidReplacementRecovery.pendingAfterReject
    .capabilityKinds.length,
  0,
);
assert.equal(
  session.verification.replacementConsole.invalidReplacementRecovery.pendingAfterReject
    .commandState.actorStatus,
  "pending_replacement",
);
assert.equal(
  session.verification.replacementConsole.invalidReplacementRecovery.pendingAfterReject
    .coldLoadEndpoints.commandStateEndpoint,
  null,
);
assert.equal(
  session.verification.replacementConsole.invalidReplacementRecovery.pendingAfterReject
    .controlCounts.primaryButtons,
  0,
);
assert.equal(
  session.verification.replacementConsole.invalidReplacementRecovery.pendingAfterReject
    .controlCounts.actionButtons,
  0,
);
assert.equal(
  session.verification.replacementConsole.processReplacement.commandStatus.state,
  "ack",
);
assert.equal(
  session.verification.replacementConsole.processReplacement.commandStatus.requestEnvelope.body
    .body.principal_user_id,
  "host_h",
);
assert.equal(
  session.verification.replacementConsole.processReplacement.commandStatus.requestEnvelope.body
    .body.command.ProcessReplacement.slot,
  "slot-7",
);
assert.equal(
  session.verification.replacementConsole.processReplacement.commandStatus.requestEnvelope.body
    .body.command.ProcessReplacement.outgoing_user,
  "player-mira",
);
assert.equal(
  session.verification.replacementConsole.processReplacement.commandStatus.requestEnvelope.body
    .body.command.ProcessReplacement.incoming_user,
  "player-rowan",
);
assert.equal(
  session.verification.replacementConsole.projectedReplacement.slotId,
  "slot-7",
);
assert.equal(
  session.verification.replacementConsole.projectedReplacement.occupantLabel,
  "player-rowan",
);
assert.match(
  session.verification.replacementConsole.projectedReplacement.historyLabel,
  /slot-7/,
);
assert.equal(session.verification.replacementConsole.apiSlot.slot_id, "slot-7");
assert.equal(
  session.verification.replacementConsole.apiSlot.occupant_user_id,
  "player-rowan",
);
assert.equal(
  session.verification.replacementConsole.replacementIdempotentRetry.status,
  "passed",
);
assert.equal(
  session.verification.replacementConsole.replacementIdempotentRetry.retryReplacement
    .state,
  "ack",
);
assert.equal(
  session.verification.replacementConsole.replacementIdempotentRetry.retryReplacement
    .httpStatus,
  200,
);
assert.equal(
  session.verification.replacementConsole.replacementIdempotentRetry.sameStreamSeqs,
  true,
);
assert.deepEqual(
  session.verification.replacementConsole.replacementIdempotentRetry
    .originalStreamSeqs,
  session.verification.replacementConsole.replacementIdempotentRetry.retryStreamSeqs,
);
assert.equal(
  session.verification.replacementConsole.replacementIdempotentRetry.retryReplacement
    .requestEnvelope.body.body.command_id,
  session.verification.replacementConsole.processReplacement.commandStatus.requestEnvelope
    .body.body.command_id,
);
assert.equal(
  session.verification.replacementConsole.replacementIdempotentRetry.retryReplacement
    .requestEnvelope.body.body.command.ProcessReplacement.outgoing_user,
  "player-mira",
);
assert.equal(
  session.verification.replacementConsole.replacementIdempotentRetry
    .hostProjectionAfterRetry.occupantLabel,
  "player-rowan",
);
assert.match(
  session.verification.replacementConsole.replacementIdempotentRetry
    .hostProjectionAfterRetry.historyLabel,
  /slot-7/,
);
assert.equal(
  session.verification.replacementConsole.replacementIdempotentRetry.apiSlotAfterRetry
    .occupant_user_id,
  "player-rowan",
);
assert.equal(
  session.verification.replacementConsole.staleOutgoingPlayer.status,
  "passed",
);
assert.equal(
  session.verification.replacementConsole.staleOutgoingPlayer.setup.commandState.actorSlot,
  "slot-7",
);
assert.equal(
  session.verification.replacementConsole.staleOutgoingPlayer.reject.error,
  "NotYourSlot",
);
assert.match(
  session.verification.replacementConsole.staleOutgoingPlayer.reject.message,
  /slot ownership changed/,
);
assert.equal(
  session.verification.replacementConsole.staleOutgoingPlayer.recoveredCommandState
    .actorSlot,
  "slot-7",
);
assert.equal(
  session.verification.replacementConsole.staleOutgoingPlayer.recoveredCommandState
    .actorAlive,
  false,
);
assert.equal(
  session.verification.replacementConsole.staleOutgoingPlayer.recoveredCommandState
    .actorStatus,
  "replaced",
);
assert.equal(
  session.verification.replacementConsole.staleOutgoingPlayer.recoveredCommandState
    .actions.length,
  0,
);
assert.equal(
  session.verification.replacementConsole.staleOutgoingPlayer.contextState.actorAlive,
  "false",
);
assert.equal(
  session.verification.replacementConsole.staleOutgoingPlayer.contextState.actorStatus,
  "replaced",
);
assert.match(
  session.verification.replacementConsole.staleOutgoingPlayer.contextState
    .capabilityLabel,
  /No current SlotOccupant\(slot-7\)/,
);
assert.equal(
  session.verification.replacementConsole.staleOutgoingPlayer.buttonsDisabled,
  true,
);
assert.equal(
  session.verification.replacementConsole.staleOutgoingPlayer.staleAction.state,
  "reject",
);
assert.equal(
  session.verification.replacementConsole.staleOutgoingPlayer.staleAction.error,
  "NotYourSlot",
);
assert.match(
  session.verification.replacementConsole.staleOutgoingPlayer.staleAction.message,
  /slot ownership changed/,
);
assert.equal(
  session.verification.replacementConsole.staleOutgoingPlayer.staleAction
    .requestEnvelope.body.body.command.SubmitAction.actor_slot,
  "slot-7",
);
assert.equal(
  session.verification.replacementConsole.staleOutgoingPlayer.staleAction
    .requestEnvelope.body.body.command.SubmitAction.template_id,
  "factional_kill",
);
assert.equal(
  session.verification.replacementConsole.staleOutgoingPlayer.commandStateAfterStaleAction
    .actorStatus,
  "replaced",
);
assert.equal(
  session.verification.replacementConsole.staleOutgoingPlayer.commandStateAfterStaleAction
    .actions.length,
  0,
);
assert.equal(
  session.verification.replacementConsole.staleOutgoingPlayer.actionControlCountAfterStaleAction,
  0,
);
assert.equal(
  session.verification.replacementConsole.staleOutgoingPlayer.buttonsDisabledAfterStaleAction,
  true,
);
assert.equal(
  session.verification.replacementConsole.stalePrivateChannel.status,
  "passed",
);
assert.equal(
  session.verification.replacementConsole.stalePrivateChannel.channel,
  "private:mafia_day_chat",
);
assert.equal(
  session.verification.replacementConsole.stalePrivateChannel.stalePost.error,
  "NotYourSlot",
);
assert.match(
  session.verification.replacementConsole.stalePrivateChannel.stalePost.message,
  /slot ownership changed/,
);
assert.equal(
  session.verification.replacementConsole.stalePrivateChannel.stalePost
    .requestEnvelope.body.body.command.SubmitPost.channel_id,
  "private:mafia_day_chat",
);
assert.equal(
  session.verification.replacementConsole.stalePrivateChannel.stalePost
    .requestEnvelope.body.body.command.SubmitPost.actor_slot,
  "slot-7",
);
assert.equal(
  session.verification.replacementConsole.stalePrivateChannel
    .commandStateAfterStalePost.actorStatus,
  "replaced",
);
assert.equal(
  session.verification.replacementConsole.stalePrivateChannel
    .commandStateAfterStalePost.actions.length,
  0,
);
assert.equal(
  session.verification.replacementConsole.stalePrivateChannel.staleRoute.status,
  403,
);
assert.match(
  session.verification.replacementConsole.stalePrivateChannel.staleRoute.message,
  /requires scoped channel capability/,
);
assert.equal(
  session.verification.replacementConsole.stalePrivateChannel.staleControlCounts
    .primaryButtons,
  0,
);
assert.equal(
  session.verification.replacementConsole.stalePrivateChannel.staleControlCounts
    .actionButtons,
  0,
);
assert.equal(
  session.verification.replacementConsole.stalePrivateChannel.rowanRoute
    .channelContextId,
  "private:mafia_day_chat",
);
assert.equal(
  session.verification.replacementConsole.stalePrivateChannel.rowanRoute.actorSlot,
  "slot-7",
);
assert.match(
  session.verification.replacementConsole.stalePrivateChannel.rowanRoute
    .capabilityLabel,
  /ChannelMember\(private:mafia_day_chat\)/,
);
assert.equal(
  session.verification.replacementConsole.stalePrivateChannel.rowanPost.state,
  "ack",
);
assert.equal(
  session.verification.replacementConsole.stalePrivateChannel.rowanPost
    .requestEnvelope.body.body.principal_user_id,
  "player-rowan",
);
assert.equal(
  session.verification.replacementConsole.stalePrivateChannel.rowanPost
    .requestEnvelope.body.body.command.SubmitPost.channel_id,
  "private:mafia_day_chat",
);
assert.equal(
  session.verification.replacementConsole.stalePrivateChannel.rowanPost
    .requestEnvelope.body.body.command.SubmitPost.actor_slot,
  "slot-7",
);
assert.equal(
  session.verification.replacementConsole.stalePrivateChannel.apiThreadPostBodies.includes(
    session.verification.replacementConsole.stalePrivateChannel.rowanPostBody,
  ),
  true,
);
assert.equal(
  session.verification.replacementConsole.stalePrivateChannel.apiThreadPostBodies.includes(
    session.verification.replacementConsole.stalePrivateChannel.stalePostBody,
  ),
  false,
);
assert.equal(
  session.verification.replacementConsole.stalePrivateReceipts.status,
  "passed",
);
assert.equal(
  session.verification.replacementConsole.stalePrivateReceipts.staleNotifications
    .status,
  403,
);
assert.equal(
  session.verification.replacementConsole.stalePrivateReceipts.staleNotifications
    .body.error,
  "NotAuthorized",
);
assert.equal(
  session.verification.replacementConsole.stalePrivateReceipts
    .staleInvestigationResults.status,
  403,
);
assert.equal(
  session.verification.replacementConsole.stalePrivateReceipts
    .staleInvestigationResults.body.error,
  "NotAuthorized",
);
assert.equal(
  session.verification.replacementConsole.stalePrivateReceipts.rowanNotifications
    .status,
  200,
);
assert.equal(
  Array.isArray(
    session.verification.replacementConsole.stalePrivateReceipts.rowanNotifications
      .body,
  ),
  true,
);
assert.equal(
  session.verification.replacementConsole.stalePrivateReceipts
    .rowanInvestigationResults.status,
  200,
);
assert.equal(
  Array.isArray(
    session.verification.replacementConsole.stalePrivateReceipts
      .rowanInvestigationResults.body,
  ),
  true,
);
assert.equal(
  session.verification.replacementConsole.stalePrivateReceipts.rowanProjection
    .targetKillVisible,
  false,
);
assert.equal(
  session.verification.replacementConsole.stalePrivateReceipts.rowanProjection
    .actionResultVisible,
  false,
);
assert.equal(
  session.verification.replacementConsole.stalePrivateReceipts.rowanQueue.count,
  0,
);
assert.equal(
  session.verification.replacementConsole.stalePrivateReceipts.rowanQueue
    .emptyVisible,
  true,
);
assert.match(
  session.verification.replacementConsole.stalePrivateReceipts.rowanQueue.boundary,
  /delivered to you alone/,
);
assert.equal(
  session.verification.replacementConsole.stalePrivateReceipts
    .staleRouteStillForbidden,
  true,
);
assert.equal(
  session.verification.replacementConsole.staleReplacementAfterSuccess.status,
  "passed",
);
assert.equal(
  session.verification.replacementConsole.staleReplacementAfterSuccess.invalidReplacement
    .serverEnvelope.body.kind,
  "Reject",
);
assert.equal(
  session.verification.replacementConsole.staleReplacementAfterSuccess.reject.error,
  "InvalidTarget",
);
assert.equal(
  session.verification.replacementConsole.staleReplacementAfterSuccess.invalidReplacement
    .requestEnvelope.body.body.command.ProcessReplacement.outgoing_user,
  "player-mira",
);
assert.match(
  session.verification.replacementConsole.staleReplacementAfterSuccess.activityStatusText,
  /Reject InvalidTarget/,
);
assert.match(
  session.verification.replacementConsole.staleReplacementAfterSuccess.activityStatusText,
  /replacement target is stale, refresh the host console and use the current slot occupant/,
);
assert.equal(
  session.verification.replacementConsole.staleReplacementAfterSuccess.activityRow.actionId,
  "process_replacement_stale_success",
);
assert.equal(
  session.verification.replacementConsole.staleReplacementAfterSuccess.activityRow.dispatchKind,
  "process_replacement",
);
assert.equal(
  session.verification.replacementConsole.staleReplacementAfterSuccess.dispatchPlan
    .finalState,
  "reject",
);
assert.equal(
  session.verification.replacementConsole.staleReplacementAfterSuccess.dispatchPlan
    .projectionRefreshKeys.length,
  0,
);
assert.equal(
  session.verification.replacementConsole.staleReplacementAfterSuccess
    .hostProjectionAfterReject.occupantLabel,
  "player-rowan",
);
assert.equal(
  session.verification.replacementConsole.staleReplacementAfterSuccess.apiSlotAfterReject
    .occupant_user_id,
  "player-rowan",
);
assert.equal(
  session.verification.replacementConsole.staleReplacementAfterSuccess.staleOutgoingPlayer
    .recoveredCommandState.actorStatus,
  "replaced",
);
assert.equal(
  session.verification.replacementConsole.staleReplacementAfterSuccess.staleOutgoingPlayer
    .buttonsDisabled,
  true,
);
assert.equal(session.verification.sessions.replacementPlayer.principalUserId, "player-rowan");
assert(
  session.verification.sessions.replacementPlayer.capabilityKinds.includes("SlotOccupant"),
);
assert.equal(
  session.verification.replacementConsole.incomingPlayer.status,
  "passed",
);
assert.equal(
  session.verification.replacementConsole.incomingPlayer.browserEntry.principalUserId,
  "player-rowan",
);
assert(
  session.verification.replacementConsole.incomingPlayer.browserEntry.capabilityKinds.includes(
    "SlotOccupant",
  ),
);
assert.equal(
  session.verification.replacementConsole.incomingPlayer.commandState.actorSlot,
  "slot-7",
);
assert.equal(
  session.verification.replacementConsole.incomingPlayer.commandState.actorAlive,
  true,
);
assert.match(
  session.verification.replacementConsole.incomingPlayer.capabilityLabel,
  /SlotOccupant/,
);
assert.equal(
  session.verification.replacementConsole.incomingPlayer.stableHistoryVisible,
  true,
);
assert.equal(
  session.verification.replacementConsole.incomingPlayer.postStatus.state,
  "ack",
);
assert.equal(
  session.verification.replacementConsole.incomingPlayer.postStatus.requestEnvelope.body.body
    .principal_user_id,
  "player-rowan",
);
assert.equal(
  session.verification.replacementConsole.incomingPlayer.postStatus.requestEnvelope.body.body
    .command.SubmitPost.actor_slot,
  "slot-7",
);
assert.equal(
  session.verification.replacementConsole.incomingPlayer.rowanProjectedPost.authorSlot,
  "slot-7",
);
assert.equal(
  session.verification.replacementConsole.incomingPlayer.vote.requestEnvelope.body.body
    .principal_user_id,
  "player-rowan",
);
assert.equal(
  session.verification.replacementConsole.incomingPlayer.vote.requestEnvelope.body.body
    .command.SubmitVote.actor_slot,
  "slot-7",
);
assert.equal(
  session.verification.replacementConsole.incomingPlayer.vote.serverEnvelope.body.kind,
  "Ack",
);
assert.equal(
  session.verification.replacementConsole.incomingPlayer.privateReceiptIsolation
    .targetKillVisible,
  false,
);
assert.equal(
  session.verification.replacementConsole.incomingPlayer.privateReceiptIsolation
    .actionResultVisible,
  false,
);
assert.equal(session.verification.multiplayerHardening.status, "passed");
assert.equal(
  session.verification.multiplayerHardening.idempotentRetry.channel,
  "main",
);
assert.equal(
  session.verification.multiplayerHardening.idempotentRetry.firstPost.state,
  "ack",
);
assert.equal(
  session.verification.multiplayerHardening.idempotentRetry.retryPost.state,
  "ack",
);
assert.deepEqual(
  session.verification.multiplayerHardening.idempotentRetry.retryPost.streamSeqs,
  session.verification.multiplayerHardening.idempotentRetry.firstPost.streamSeqs,
);
assert.equal(
  session.verification.multiplayerHardening.idempotentRetry.projectedPostCount,
  1,
);
assert.equal(
  session.verification.multiplayerHardening.reconnect.status,
  "passed",
);
assert.equal(
  session.verification.multiplayerHardening.reconnect.reconnectingStatus.state,
  "reconnecting",
);
assert.equal(
  session.verification.multiplayerHardening.reconnect.reconnectRecoveryEvent.state,
  "recovered",
);
assert.equal(
  session.verification.multiplayerHardening.reconnect.reconnectRecoveryEvent.attempt,
  1,
);
assert.equal(
  session.verification.multiplayerHardening.reconnect.recoveredSnapshotContainsPost,
  true,
);
assert.match(
  session.verification.multiplayerHardening.reconnect.recoveredPostBody,
  /^Player reconnect proof from dev:test-game /,
);
assert.equal(
  session.verification.multiplayerHardening.stalePlayerVote.status,
  "passed",
);
assert.equal(
  session.verification.multiplayerHardening.stalePlayerVote.lock.state,
  "ack",
);
assert.equal(
  session.verification.multiplayerHardening.stalePlayerVote.reject.state,
  "reject",
);
assert.equal(
  session.verification.multiplayerHardening.stalePlayerVote.reject.error,
  "PhaseLocked",
);
assert.match(
  session.verification.multiplayerHardening.stalePlayerVote.reject.message,
  /stale projection|stale vote state/,
);
assert.equal(
  session.verification.multiplayerHardening.stalePlayerVote.phaseAfterReject.locked,
  true,
);
assert.equal(
  session.verification.multiplayerHardening.stalePlayerVote.unlock.state,
  "ack",
);
assert.equal(
  session.verification.multiplayerHardening.stalePlayerVote.hostPhaseAfterUnlock.locked,
  false,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentVoteRace.status,
  "passed",
);
assert.equal(
  typeof concurrentVoteRace.targetSlot,
  "string",
);
assert.notEqual(concurrentVoteRace.targetSlot.length, 0);
assert.equal(
  session.verification.multiplayerHardening.concurrentVoteRace.playerVote.state,
  "ack",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentVoteRace.actionVote.state,
  "ack",
);
assert.notDeepEqual(
  session.verification.multiplayerHardening.concurrentVoteRace.playerVote.streamSeqs,
  session.verification.multiplayerHardening.concurrentVoteRace.actionVote.streamSeqs,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentVoteRace.apiProjection.count,
  2,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentVoteRace.playerProjection.some(
    (row) => row.target === concurrentVoteRace.targetSlot && row.count === 2,
  ),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentVoteRace.actionProjection.some(
    (row) => row.target === concurrentVoteRace.targetSlot && row.count === 2,
  ),
  true,
);
assert.equal(concurrentVoteRace.roleReloadAfterRace.status, "passed");
assert.equal(concurrentVoteRace.roleReloadAfterRace.playerRouteStatus, 200);
assert.equal(concurrentVoteRace.roleReloadAfterRace.actionRouteStatus, 200);
assert.equal(
  concurrentVoteRace.roleReloadAfterRace.playerCommandState.currentVote.slotId,
  concurrentVoteRace.targetSlot,
);
assert.equal(
  concurrentVoteRace.roleReloadAfterRace.actionCommandState.currentVote.slotId,
  concurrentVoteRace.targetSlot,
);
assert.equal(concurrentVoteRace.roleReloadAfterRace.playerCurrentVote.hasVote, "true");
assert.match(
  concurrentVoteRace.roleReloadAfterRace.playerCurrentVote.text,
  new RegExp(concurrentVoteRace.target.label),
);
assert.equal(concurrentVoteRace.roleReloadAfterRace.actionCurrentVote.hasVote, "true");
assert.match(
  concurrentVoteRace.roleReloadAfterRace.actionCurrentVote.text,
  new RegExp(concurrentVoteRace.target.label),
);
assert.equal(
  concurrentVoteRace.roleReloadAfterRace.playerProjection.some(
    (row) => row.target === concurrentVoteRace.targetSlot && row.count === 2,
  ),
  true,
);
assert.equal(
  concurrentVoteRace.roleReloadAfterRace.actionProjection.some(
    (row) => row.target === concurrentVoteRace.targetSlot && row.count === 2,
  ),
  true,
);
assert.equal(concurrentVoteRace.roleReloadAfterRace.apiProjection.count, 2);
assert.equal(voteResolveRace.status, "passed");
assert.equal(voteResolveRace.hostEntry.capabilityKinds.includes("HostOf"), true);
assert.equal(voteResolveRace.playerEntry.capabilityKinds.includes("SlotOccupant"), true);
assert.equal(voteResolveRace.setupCommandState.actorSlot, "slot_4");
assert.equal(voteResolveRace.setupCommandState.phase.phaseId, "D01");
assert.equal(voteResolveRace.setupCommandState.phase.locked, false);
assert.equal(voteResolveRace.setupVoteButton.disabled, false);
assert.equal(voteResolveRace.setupHostPhase.locked, false);
assert.equal(voteResolveRace.setupHostPhaseActions.includes("resolve_phase"), true);
assert.equal(voteResolveRace.resolve.state, "ack");
assert.equal(voteResolveRace.resolve.serverEnvelope.body.kind, "Ack");
assert.equal(voteResolveRace.resolve.streamSeqs.length >= 3, true);
assert.equal(
  voteResolveRace.resolve.requestEnvelope.body.body.command.ResolvePhase.game,
  voteResolveRace.game,
);
assert.equal(
  voteResolveRace.vote.requestEnvelope.body.body.command.SubmitVote.actor_slot,
  "slot_4",
);
if (voteResolveRace.vote.state === "ack") {
  assert.equal(voteResolveRace.vote.serverEnvelope.body.kind, "Ack");
  assert.equal(voteResolveRace.voteSeq < voteResolveRace.resolveSeq, true);
} else {
  assert.equal(voteResolveRace.vote.state, "reject");
  assert.equal(voteResolveRace.vote.error, "PhaseLocked");
  assert.equal(voteResolveRace.vote.serverEnvelope.body.kind, "Reject");
  assert.equal(Array.isArray(voteResolveRace.vote.streamSeqs), false);
}
assert.equal(voteResolveRace.roleReloadAfterRace.status, "passed");
assert.equal(voteResolveRace.roleReloadAfterRace.playerRouteResponseStatus, 200);
assert.equal(voteResolveRace.roleReloadAfterRace.hostRouteResponseStatus, 200);
assert.equal(
  voteResolveRace.roleReloadAfterRace.commandStateAfterReload.phase.phaseId,
  "D01",
);
assert.equal(voteResolveRace.roleReloadAfterRace.commandStateAfterReload.phase.locked, true);
assert.equal(voteResolveRace.roleReloadAfterRace.commandStateAfterReload.voteTargets.length, 0);
assert.equal(
  voteResolveRace.roleReloadAfterRace.buttonsAfterReload.some((button) =>
    button.action?.startsWith("submit_vote"),
  ),
  false,
);
assert.equal(
  voteResolveRace.roleReloadAfterRace.buttonsAfterReload.some(
    (button) => button.action === "submit_post" && button.disabled === false,
  ),
  true,
);
assert.equal(voteResolveRace.roleReloadAfterRace.hostPhaseAfterReload.id, "D01");
assert.equal(voteResolveRace.roleReloadAfterRace.hostPhaseAfterReload.locked, true);
assert.equal(
  voteResolveRace.roleReloadAfterRace.hostDayVoteOutcomesAfterReload.some(
    (row) =>
      row.phaseId === "D01" &&
      row.status === "Lynch" &&
      row.winnerSlot === "slot-2",
  ),
  true,
);
assert.equal(
  voteResolveRace.roleReloadAfterRace.playerDayVoteOutcomesAfterReload.some(
    (row) =>
      row.phaseId === "D01" &&
      row.status === "Lynch" &&
      row.winnerSlot === "slot-2",
  ),
  true,
);
assert.equal(
  voteResolveRace.roleReloadAfterRace.apiCommandStateAfterReload.phase.locked,
  true,
);
assert.equal(
  voteResolveRace.roleReloadAfterRace.apiCommandStateAfterReload.vote_targets.length,
  0,
);
assert.equal(
  voteResolveRace.roleReloadAfterRace.apiDayVoteOutcomesAfterReload.some(
    (row) =>
      row.body?.phase_id === "D01" &&
      row.body?.status === "Lynch" &&
      row.body?.winner_slot === "slot-2",
  ),
  true,
);
assert.equal(actionAdvanceRace.status, "passed");
assert.equal(actionAdvanceRace.hostEntry.capabilityKinds.includes("HostOf"), true);
assert.equal(
  actionAdvanceRace.actionEntry.capabilityKinds.includes("SlotOccupant"),
  true,
);
assert.equal(actionAdvanceRace.setupCommandState.actorSlot, "slot_4");
assert.equal(actionAdvanceRace.setupCommandState.phase.phaseId, "N01");
assert.equal(actionAdvanceRace.setupCommandState.phase.locked, false);
assert.equal(
  actionAdvanceRace.setupCommandState.actions.some(
    (action) => action.templateId === "factional_kill",
  ),
  true,
);
assert.equal(actionAdvanceRace.setupActionButton.disabled, false);
assert.equal(actionAdvanceRace.setupHostPhase.id, "N01");
assert.equal(actionAdvanceRace.setupHostPhase.locked, false);
assert.equal(actionAdvanceRace.setupHostPhaseActions.includes("resolve_phase"), true);
assert.equal(actionAdvanceRace.closedStatus.state, "closed");
assert.equal(actionAdvanceRace.resolveNight.commandStatus.state, "ack");
assert.equal(actionAdvanceRace.lockedHostPhase.id, "N01");
assert.equal(actionAdvanceRace.lockedHostPhase.locked, true);
assert.equal(actionAdvanceRace.lockedHostPhaseActions.includes("advance_phase"), true);
assert.equal(actionAdvanceRace.reject.state, "reject");
assert.equal(["PhaseLocked", "InvalidTarget"].includes(actionAdvanceRace.reject.error), true);
assert.equal(actionAdvanceRace.reject.serverEnvelope.body.kind, "Reject");
assert.equal(Array.isArray(actionAdvanceRace.reject.streamSeqs), false);
assert.equal(
  actionAdvanceRace.reject.requestEnvelope.body.body.command.SubmitAction.actor_slot,
  "slot_4",
);
assert.equal(
  actionAdvanceRace.reject.requestEnvelope.body.body.command.SubmitAction.action_id,
  "role_factional_kill",
);
assert.equal(
  actionAdvanceRace.reject.requestEnvelope.body.body.command.SubmitAction.template_id,
  "factional_kill",
);
assert.equal(actionAdvanceRace.advance.state, "ack");
assert.equal(actionAdvanceRace.advance.serverEnvelope.body.kind, "Ack");
assert.equal(actionAdvanceRace.advance.streamSeqs.length, 1);
assert.equal(actionAdvanceRace.roleReloadAfterRace.status, "passed");
assert.equal(actionAdvanceRace.roleReloadAfterRace.actionRouteResponseStatus, 200);
assert.equal(actionAdvanceRace.roleReloadAfterRace.hostRouteResponseStatus, 200);
assert.equal(actionAdvanceRace.roleReloadAfterRace.commandStateAfterReload.actorSlot, "slot_4");
assert.equal(
  actionAdvanceRace.roleReloadAfterRace.commandStateAfterReload.phase.phaseId,
  "D02",
);
assert.equal(
  actionAdvanceRace.roleReloadAfterRace.commandStateAfterReload.phase.locked,
  false,
);
assert.equal(actionAdvanceRace.roleReloadAfterRace.commandStateAfterReload.actions.length, 0);
assert.equal(
  actionAdvanceRace.roleReloadAfterRace.buttonsAfterReload.some(
    (button) => button.action === "submit_action:factional_kill",
  ),
  false,
);
assert.equal(actionAdvanceRace.roleReloadAfterRace.hostPhaseAfterReload.id, "D02");
assert.equal(actionAdvanceRace.roleReloadAfterRace.hostPhaseAfterReload.locked, false);
assert.equal(
  actionAdvanceRace.roleReloadAfterRace.hostPhaseActionsAfterReload.includes(
    "resolve_phase",
  ),
  true,
);
assert.equal(
  actionAdvanceRace.roleReloadAfterRace.hostPhaseActionsAfterReload.includes(
    "advance_phase",
  ),
  false,
);
assert.equal(
  actionAdvanceRace.roleReloadAfterRace.apiCommandStateAfterReload.actor_slot,
  "slot_4",
);
assert.equal(
  actionAdvanceRace.roleReloadAfterRace.apiCommandStateAfterReload.phase.phase_id,
  "D02",
);
assert.equal(
  actionAdvanceRace.roleReloadAfterRace.apiCommandStateAfterReload.phase.locked,
  false,
);
assert.equal(actionAdvanceRace.roleReloadAfterRace.apiCommandStateAfterReload.actions.length, 0);
assert.equal(
  actionAdvanceRace.roleReloadAfterRace.apiHostStateAfterReload.phase.phase_id,
  "D02",
);
assert.equal(
  actionAdvanceRace.roleReloadAfterRace.apiHostStateAfterReload.phase.locked,
  false,
);
assert.equal(cohostDeadlineResolveRace.status, "passed");
assert.equal(cohostDeadlineResolveRace.hostEntry.capabilityKinds.includes("HostOf"), true);
assert.equal(
  cohostDeadlineResolveRace.cohostEntry.capabilityKinds.includes("CohostOf"),
  true,
);
assert.equal(cohostDeadlineResolveRace.resolve.state, "ack");
assert.equal(cohostDeadlineResolveRace.setupHostPhase.id, "D01");
assert.equal(cohostDeadlineResolveRace.setupHostPhase.locked, false);
assert.equal(cohostDeadlineResolveRace.setupCohostPhase.id, "D01");
assert.equal(cohostDeadlineResolveRace.setupCohostPhase.locked, false);
assert.equal(
  cohostDeadlineResolveRace.setupHostPhaseActions.includes("resolve_phase"),
  true,
);
assert.equal(
  cohostDeadlineResolveRace.setupHostDeadlineActions.includes("extend_deadline"),
  true,
);
assert.equal(cohostDeadlineResolveRace.setupCohostPhaseActions.length, 0);
assert.equal(
  cohostDeadlineResolveRace.setupCohostDeadlineActions.includes("extend_deadline"),
  true,
);
if (cohostDeadlineResolveRace.deadline.state === "ack") {
  assert.equal(cohostDeadlineResolveRace.deadline.serverEnvelope.body.kind, "Ack");
  assert.equal(
    cohostDeadlineResolveRace.deadlineSeq < cohostDeadlineResolveRace.resolveSeq,
    true,
  );
  assert.equal(
    cohostDeadlineResolveRace.roleReloadAfterRace.expectedDeadline,
    cohostDeadlineResolveRace.deadlineAt,
  );
} else {
  assert.equal(cohostDeadlineResolveRace.deadline.state, "reject");
  assert.equal(cohostDeadlineResolveRace.deadline.error, "PhaseLocked");
  assert.equal(cohostDeadlineResolveRace.deadline.serverEnvelope.body.kind, "Reject");
  assert.equal(cohostDeadlineResolveRace.roleReloadAfterRace.expectedDeadline, null);
}
assert.equal(cohostDeadlineResolveRace.roleReloadAfterRace.status, "passed");
assert.equal(cohostDeadlineResolveRace.roleReloadAfterRace.hostRouteResponseStatus, 200);
assert.equal(cohostDeadlineResolveRace.roleReloadAfterRace.cohostRouteResponseStatus, 200);
assert.equal(cohostDeadlineResolveRace.roleReloadAfterRace.hostPhaseAfterReload.id, "D01");
assert.equal(
  cohostDeadlineResolveRace.roleReloadAfterRace.hostPhaseAfterReload.locked,
  true,
);
assert.equal(cohostDeadlineResolveRace.roleReloadAfterRace.cohostPhaseAfterReload.id, "D01");
assert.equal(
  cohostDeadlineResolveRace.roleReloadAfterRace.cohostPhaseAfterReload.locked,
  true,
);
assert.equal(
  cohostDeadlineResolveRace.roleReloadAfterRace.hostPhaseAfterReload.deadline,
  cohostDeadlineResolveRace.roleReloadAfterRace.expectedDeadline,
);
assert.equal(
  cohostDeadlineResolveRace.roleReloadAfterRace.cohostPhaseAfterReload.deadline,
  cohostDeadlineResolveRace.roleReloadAfterRace.expectedDeadline,
);
assert.equal(
  cohostDeadlineResolveRace.roleReloadAfterRace.hostPhaseActionsAfterReload.includes(
    "unlock_thread",
  ),
  true,
);
assert.equal(
  cohostDeadlineResolveRace.roleReloadAfterRace.hostPhaseActionsAfterReload.includes(
    "advance_phase",
  ),
  true,
);
assert.equal(
  cohostDeadlineResolveRace.roleReloadAfterRace.hostPhaseActionsAfterReload.includes(
    "resolve_phase",
  ),
  false,
);
assert.equal(
  cohostDeadlineResolveRace.roleReloadAfterRace.cohostPhaseActionsAfterReload.length,
  0,
);
assert.equal(
  cohostDeadlineResolveRace.roleReloadAfterRace.hostDeadlineActionsAfterReload.includes(
    "extend_deadline",
  ),
  true,
);
assert.equal(
  cohostDeadlineResolveRace.roleReloadAfterRace.cohostDeadlineActionsAfterReload.includes(
    "extend_deadline",
  ),
  true,
);
assert.equal(
  cohostDeadlineResolveRace.roleReloadAfterRace.hostApiPhaseAfterReload.phase_id,
  "D01",
);
assert.equal(
  cohostDeadlineResolveRace.roleReloadAfterRace.hostApiPhaseAfterReload.locked,
  true,
);
assert.equal(
  cohostDeadlineResolveRace.roleReloadAfterRace.hostApiPhaseAfterReload.deadline,
  cohostDeadlineResolveRace.roleReloadAfterRace.expectedDeadline,
);
assert.equal(
  cohostDeadlineResolveRace.roleReloadAfterRace.cohostApiPhaseAfterReload.phase_id,
  "D01",
);
assert.equal(
  cohostDeadlineResolveRace.roleReloadAfterRace.cohostApiPhaseAfterReload.locked,
  true,
);
assert.equal(
  cohostDeadlineResolveRace.roleReloadAfterRace.cohostApiPhaseAfterReload.deadline,
  cohostDeadlineResolveRace.roleReloadAfterRace.expectedDeadline,
);
assert.equal(replacementPrivatePostRace.status, "passed");
assert.equal(
  replacementPrivatePostRace.hostEntry.capabilityKinds.includes("HostOf"),
  true,
);
assert.equal(
  replacementPrivatePostRace.playerEntry.capabilityKinds.includes("SlotOccupant"),
  true,
);
assert.equal(replacementPrivatePostRace.setupHostReplacement.occupantLabel, "player-mira");
assert.equal(replacementPrivatePostRace.setupCommandState.actorSlot, "slot-7");
assert.equal(replacementPrivatePostRace.setupCommandState.actorStatus, "alive");
assert.equal(replacementPrivatePostRace.setupChannelContext.channelId, "private:mafia_day_chat");
assert.equal(replacementPrivatePostRace.setupChannelContext.actorSlot, "slot-7");
assert.equal(replacementPrivatePostRace.setupChannelContext.actorStatus, "alive");
assert.equal(replacementPrivatePostRace.replacement.state, "ack");
assert.equal(
  replacementPrivatePostRace.replacement.requestEnvelope.body.body.command
    .ProcessReplacement.slot,
  "slot-7",
);
assert.equal(
  replacementPrivatePostRace.replacement.requestEnvelope.body.body.command
    .ProcessReplacement.incoming_user,
  "player-rowan",
);
assert.equal(
  replacementPrivatePostRace.post.requestEnvelope.body.body.command.SubmitPost.channel_id,
  "private:mafia_day_chat",
);
assert.equal(
  replacementPrivatePostRace.post.requestEnvelope.body.body.command.SubmitPost.actor_slot,
  "slot-7",
);
if (replacementPrivatePostRace.post.state === "ack") {
  assert.equal(replacementPrivatePostRace.post.serverEnvelope.body.kind, "Ack");
  assert.equal(replacementPrivatePostRace.postSeq < replacementPrivatePostRace.replacementSeq, true);
  assert.equal(
    replacementPrivatePostRace.apiThreadPostBodies.includes(
      replacementPrivatePostRace.postBody,
    ),
    true,
  );
} else {
  assert.equal(replacementPrivatePostRace.post.state, "reject");
  assert.equal(replacementPrivatePostRace.post.error, "NotYourSlot");
  assert.equal(replacementPrivatePostRace.post.serverEnvelope.body.kind, "Reject");
  assert.equal(
    replacementPrivatePostRace.apiThreadPostBodies.includes(
      replacementPrivatePostRace.postBody,
    ),
    false,
  );
}
assert.equal(replacementPrivatePostRace.commandStateAfterRace.status, 403);
assert.equal(replacementPrivatePostRace.commandStateAfterRace.error, "NotYourSlot");
assert.equal(
  replacementPrivatePostRace.buttonsAfterRace.some(
    (button) =>
      (button.action === "submit_post" || button.action?.startsWith("submit_action")) &&
      button.disabled === false,
  ),
  false,
);
assert.equal(replacementPrivatePostRace.hostReplacementAfterRace.occupantLabel, "player-rowan");
assert.equal(replacementPrivatePostRace.apiSlotAfterRace.occupant_user_id, "player-rowan");
assert.equal(replacementPrivatePostRace.staleRoute.status, 403);
assert.equal(replacementVoteRace.status, "passed");
assert.equal(replacementVoteRace.targetSlot, replacementVoteRaceScenario.targetSlot);
assert.equal(
  replacementVoteRace.hostEntry.capabilityKinds.includes("HostOf"),
  true,
);
assert.equal(
  replacementVoteRace.playerEntry.capabilityKinds.includes("SlotOccupant"),
  true,
);
assert.equal(
  replacementVoteRace.setupHostReplacement.occupantLabel,
  replacementVoteRaceScenario.staleOutgoingPrincipalUserId,
);
assert.equal(replacementVoteRace.setupCommandState.actorSlot, replacementVoteRaceScenario.actorSlot);
assert.equal(replacementVoteRace.setupCommandState.actorStatus, "alive");
assert.equal(
  replacementVoteRace.setupCommandState.voteTargets.some(
    (target) =>
      target.kind === "slot" && target.slotId === replacementVoteRaceScenario.targetSlot,
  ),
  true,
);
assert.equal(replacementVoteRace.replacement.state, "ack");
assert.equal(
  replacementVoteRace.replacement.requestEnvelope.body.body.command.ProcessReplacement
    .slot,
  replacementVoteRaceScenario.actorSlot,
);
assert.equal(
  replacementVoteRace.replacement.requestEnvelope.body.body.command.ProcessReplacement
    .outgoing_user,
  replacementVoteRaceScenario.staleOutgoingPrincipalUserId,
);
assert.equal(
  replacementVoteRace.replacement.requestEnvelope.body.body.command.ProcessReplacement
    .incoming_user,
  replacementVoteRaceScenario.replacementPrincipalUserId,
);
assert.equal(
  replacementVoteRace.vote.requestEnvelope.body.body.command.SubmitVote.actor_slot,
  replacementVoteRaceScenario.actorSlot,
);
assert.equal(
  replacementVoteRace.vote.requestEnvelope.body.body.command.SubmitVote.target.Slot,
  replacementVoteRaceScenario.targetSlot,
);
if (replacementVoteRace.vote.state === "ack") {
  assert.equal(replacementVoteRace.vote.serverEnvelope.body.kind, "Ack");
  assert.equal(replacementVoteRace.voteSeq < replacementVoteRace.replacementSeq, true);
  assert.equal(replacementVoteRace.targetVotecount.count, 1);
} else {
  assert.equal(replacementVoteRace.vote.state, "reject");
  assert.equal(replacementVoteRace.vote.error, replacementVoteRaceScenario.rejectionError);
  assert.equal(replacementVoteRace.vote.serverEnvelope.body.kind, "Reject");
  assert.equal(replacementVoteRace.targetVotecount, null);
}
assert.equal(replacementVoteRace.commandStateAfterRace.status, 403);
assert.equal(
  replacementVoteRace.commandStateAfterRace.error,
  replacementVoteRaceScenario.rejectionError,
);
assert.equal(
  replacementVoteRace.hostReplacementAfterRace.occupantLabel,
  replacementVoteRaceScenario.replacementOccupantLabel,
);
assert.equal(
  replacementVoteRace.apiSlotAfterRace.occupant_user_id,
  replacementVoteRaceScenario.replacementPrincipalUserId,
);
assert.equal(replacementActionRace.status, "passed");
assert.equal(replacementActionRace.targetSlot, replacementActionRaceScenario.targetSlot);
assert.equal(
  replacementActionRace.hostEntry.capabilityKinds.includes("HostOf"),
  true,
);
assert.equal(
  replacementActionRace.playerEntry.capabilityKinds.includes("SlotOccupant"),
  true,
);
assert.equal(
  replacementActionRace.replacementEntry.capabilityKinds.includes("SlotOccupant"),
  true,
);
assert.equal(replacementActionRace.setupHostPhase.id, replacementActionRaceScenario.phaseId);
assert.equal(replacementActionRace.setupHostPhase.locked, false);
assert.equal(
  replacementActionRace.setupSlot.occupant_user_id,
  replacementActionRaceScenario.staleOutgoingPrincipalUserId,
);
assert.equal(
  replacementActionRace.setupCommandState.actorSlot,
  replacementActionRaceScenario.actorSlot,
);
assert.equal(replacementActionRace.setupCommandState.actorStatus, "alive");
assert.equal(
  replacementActionRace.setupCommandState.phase.phaseId,
  replacementActionRaceScenario.phaseId,
);
assert.equal(
  replacementActionRace.setupCommandState.actions.some(
    (candidate) => candidate.templateId === replacementActionRaceScenario.templateId,
  ),
  true,
);
assert.equal(replacementActionRace.replacement.state, "ack");
assert.equal(
  replacementActionRace.replacement.requestEnvelope.body.body.command.ProcessReplacement
    .slot,
  replacementActionRaceScenario.actorSlot,
);
assert.equal(
  replacementActionRace.replacement.requestEnvelope.body.body.command.ProcessReplacement
    .outgoing_user,
  replacementActionRaceScenario.staleOutgoingPrincipalUserId,
);
assert.equal(
  replacementActionRace.replacement.requestEnvelope.body.body.command.ProcessReplacement
    .incoming_user,
  replacementActionRaceScenario.replacementPrincipalUserId,
);
assert.equal(
  replacementActionRace.action.requestEnvelope.body.body.command.SubmitAction.actor_slot,
  replacementActionRaceScenario.actorSlot,
);
assert.equal(
  replacementActionRace.action.requestEnvelope.body.body.command.SubmitAction
    .template_id,
  replacementActionRaceScenario.templateId,
);
assert.equal(
  replacementActionRace.action.requestEnvelope.body.body.command.SubmitAction.targets[0],
  replacementActionRaceScenario.targetSlot,
);
if (replacementActionRace.action.state === "ack") {
  assert.equal(replacementActionRace.action.serverEnvelope.body.kind, "Ack");
  assert.equal(
    replacementActionRace.actionSeq < replacementActionRace.replacementSeq,
    true,
  );
  assert.equal(replacementActionRace.currentCommandStateAfterRace.actions.length, 0);
  assert.equal(replacementActionRace.currentRoleCommandState.actions.length, 0);
} else {
  assert.equal(replacementActionRace.action.state, "reject");
  assert.equal(replacementActionRace.action.error, replacementActionRaceScenario.rejectionError);
  assert.equal(replacementActionRace.action.serverEnvelope.body.kind, "Reject");
  assert.equal(
    replacementActionRace.currentCommandStateAfterRace.actions.some(
      (candidate) => candidate.template_id === replacementActionRaceScenario.templateId,
    ),
    true,
  );
  assert.equal(
    replacementActionRace.currentRoleCommandState.actions.some(
      (candidate) => candidate.templateId === replacementActionRaceScenario.templateId,
    ),
    true,
  );
}
assert.equal(replacementActionRace.commandStateAfterRace.status, 403);
assert.equal(
  replacementActionRace.commandStateAfterRace.error,
  replacementActionRaceScenario.rejectionError,
);
assert.equal(replacementActionRace.staleRetry.state, "reject");
assert.equal(replacementActionRace.staleRetry.error, replacementActionRaceScenario.rejectionError);
assert.equal(replacementActionRace.hostPhaseAfterRace.id, replacementActionRaceScenario.phaseId);
assert.equal(replacementActionRace.hostPhaseAfterRace.locked, false);
assert.equal(
  replacementActionRace.apiSlotAfterRace.occupant_user_id,
  replacementActionRaceScenario.replacementPrincipalUserId,
);
assert.equal(
  replacementActionRace.currentCommandStateAfterRace.actor_slot,
  replacementActionRaceScenario.actorSlot,
);
assert.equal(replacementActionRace.currentCommandStateAfterRace.actor_status, "alive");
assert.equal(
  replacementActionRace.currentRoleCommandState.actorSlot,
  replacementActionRaceScenario.actorSlot,
);
assert.equal(replacementActionRace.currentRoleCommandState.actorStatus, "alive");
assert.equal(replacementIncomingAction.status, "passed");
assert.equal(replacementIncomingAction.targetSlot, replacementIncomingActionCase.targetSlot);
assert.equal(
  replacementIncomingAction.hostEntry.capabilityKinds.includes("HostOf"),
  true,
);
assert.equal(
  replacementIncomingAction.replacementEntry.capabilityKinds.includes("SlotOccupant"),
  true,
);
assert.equal(
  replacementIncomingAction.targetEntry.capabilityKinds.includes("SlotOccupant"),
  true,
);
assert.equal(replacementIncomingAction.setupHostPhase.id, replacementIncomingActionCase.phaseId);
assert.equal(replacementIncomingAction.setupHostPhase.locked, false);
assert.equal(
  replacementIncomingAction.setupSlot.occupant_user_id,
  replacementIncomingActionCase.staleOutgoingPrincipalUserId,
);
assert.equal(replacementIncomingAction.replacement.state, "ack");
assert.equal(
  replacementIncomingAction.replacement.requestEnvelope.body.body.command.ProcessReplacement
    .slot,
  replacementIncomingActionCase.actorSlot,
);
assert.equal(
  replacementIncomingAction.replacement.requestEnvelope.body.body.command.ProcessReplacement
    .incoming_user,
  replacementIncomingActionCase.replacementPrincipalUserId,
);
assert.equal(
  replacementIncomingAction.outgoingCommandStateAfterReplacement.status,
  403,
);
assert.equal(
  replacementIncomingAction.outgoingCommandStateAfterReplacement.error,
  replacementIncomingActionCase.staleOutgoingError,
);
assert.equal(
  replacementIncomingAction.currentCommandStateBeforeAction.actorSlot,
  replacementIncomingActionCase.actorSlot,
);
assert.equal(
  replacementIncomingAction.currentCommandStateBeforeAction.actions.some(
    (candidate) => candidate.templateId === replacementIncomingActionCase.templateId,
  ),
  true,
);
assert.equal(replacementIncomingAction.action.state, "ack");
assert.equal(
  replacementIncomingAction.action.requestEnvelope.body.body.principal_user_id,
  replacementIncomingActionCase.replacementPrincipalUserId,
);
assert.equal(
  replacementIncomingAction.action.requestEnvelope.body.body.command.SubmitAction
    .actor_slot,
  replacementIncomingActionCase.actorSlot,
);
assert.equal(
  replacementIncomingAction.action.requestEnvelope.body.body.command.SubmitAction
    .template_id,
  replacementIncomingActionCase.templateId,
);
assert.equal(
  replacementIncomingAction.action.requestEnvelope.body.body.command.SubmitAction.targets[0],
  replacementIncomingActionCase.targetSlot,
);
assert.equal(replacementIncomingAction.currentCommandStateAfterAction.actions.length, 0);
assert.equal(replacementIncomingAction.apiCommandStateAfterAction.actions.length, 0);
assert.equal(replacementIncomingAction.resolveNight.commandStatus.state, "ack");
assert.equal(replacementIncomingAction.hostPhaseAfterResolve.id, replacementIncomingActionCase.phaseId);
assert.equal(replacementIncomingAction.hostPhaseAfterResolve.locked, true);
assert.equal(
  replacementIncomingAction.targetSlotAfterResolve.slot_id,
  replacementIncomingActionCase.targetSlot,
);
assert.equal(replacementIncomingAction.targetSlotAfterResolve.alive, false);
assert.equal(
  replacementIncomingAction.targetSlotAfterResolve.status,
  replacementIncomingActionCase.targetStatusAfterKill,
);
assert.equal(
  replacementIncomingAction.targetCommandState.actorSlot,
  replacementIncomingActionCase.targetSlot,
);
assert.equal(replacementIncomingAction.targetCommandState.actorAlive, false);
assert.equal(
  replacementIncomingAction.targetNotice.audience_slot,
  replacementIncomingActionCase.targetSlot,
);
assert.equal(
  replacementIncomingAction.targetNotice.effect,
  replacementIncomingActionCase.targetNoticeEffect,
);
assert.equal(
  replacementIncomingAction.targetNotice.status,
  replacementIncomingActionCase.templateId,
);
assert.equal(replacementIncomingAction.replacementPrivateIsolation.targetKillVisible, false);
assert.equal(replacementActionReconnect.status, "passed");
assert.equal(replacementActionReconnect.targetSlot, replacementActionReconnectCase.targetSlot);
assert.equal(
  replacementActionReconnect.hostEntry.capabilityKinds.includes("HostOf"),
  true,
);
assert.equal(
  replacementActionReconnect.replacementEntry.capabilityKinds.includes("SlotOccupant"),
  true,
);
assert.equal(
  replacementActionReconnect.targetEntry.capabilityKinds.includes("SlotOccupant"),
  true,
);
assert.equal(replacementActionReconnect.replacement.state, "ack");
assert.equal(
  replacementActionReconnect.replacement.requestEnvelope.body.body.command.ProcessReplacement
    .slot,
  replacementActionReconnectCase.actorSlot,
);
assert.equal(
  replacementActionReconnect.replacement.requestEnvelope.body.body.command.ProcessReplacement
    .incoming_user,
  replacementActionReconnectCase.replacementPrincipalUserId,
);
assert.equal(
  replacementActionReconnect.commandStateBeforeAction.actorSlot,
  replacementActionReconnectCase.actorSlot,
);
assert.equal(
  replacementActionReconnect.commandStateBeforeAction.actions.some(
    (candidate) => candidate.templateId === replacementActionReconnectCase.templateId,
  ),
  true,
);
assert.equal(replacementActionReconnect.action.state, "ack");
assert.equal(
  replacementActionReconnect.action.requestEnvelope.body.body.principal_user_id,
  replacementActionReconnectCase.replacementPrincipalUserId,
);
assert.equal(
  replacementActionReconnect.action.requestEnvelope.body.body.command.SubmitAction
    .actor_slot,
  replacementActionReconnectCase.actorSlot,
);
assert.equal(
  replacementActionReconnect.action.requestEnvelope.body.body.command.SubmitAction
    .action_id,
  replacementActionReconnectCase.actionId,
);
assert.equal(
  replacementActionReconnect.action.requestEnvelope.body.body.command.SubmitAction
    .template_id,
  replacementActionReconnectCase.templateId,
);
assert.equal(
  replacementActionReconnect.action.requestEnvelope.body.body.command.SubmitAction.targets[0],
  replacementActionReconnectCase.targetSlot,
);
assert.equal(replacementActionReconnect.resolveNight.commandStatus.state, "ack");
assert.equal(
  replacementActionReconnect.targetSlotAfterResolve.slot_id,
  replacementActionReconnectCase.targetSlot,
);
assert.equal(replacementActionReconnect.targetSlotAfterResolve.alive, false);
assert.equal(
  replacementActionReconnect.targetSlotAfterResolve.status,
  replacementActionReconnectCase.targetStatusAfterKill,
);
assert.equal(
  replacementActionReconnect.targetCommandState.actorSlot,
  replacementActionReconnectCase.targetSlot,
);
assert.equal(replacementActionReconnect.targetCommandState.actorAlive, false);
assert.equal(replacementActionReconnect.targetCommandState.actorStatus, "dead");
assert.equal(
  replacementActionReconnect.targetNoticeBeforeReconnect.audience_slot,
  replacementActionReconnectCase.targetSlot,
);
assert.equal(
  replacementActionReconnect.targetNoticeBeforeReconnect.effect,
  replacementActionReconnectCase.targetNoticeEffect,
);
assert.equal(
  replacementActionReconnect.targetNoticeBeforeReconnect.status,
  replacementActionReconnectCase.templateId,
);
assert.equal(replacementActionReconnect.reconnect.status, "passed");
assert.equal(
  replacementActionReconnect.reconnect.principalUserId,
  replacementActionReconnectCase.replacementPrincipalUserId,
);
assert.equal(
  replacementActionReconnect.reconnect.actorSlot,
  replacementActionReconnectCase.actorSlot,
);
assert.equal(
  replacementActionReconnect.reconnect.reconnectingStatus.state,
  "reconnecting",
);
assert.equal(
  replacementActionReconnect.reconnect.reconnectRecoveryEvent.attempt,
  1,
);
assert.equal(
  replacementActionReconnect.reconnect.reconnectRecoveryEvent.state,
  "recovered",
);
assert.equal(replacementActionReconnect.reconnect.recoveredSnapshotContainsPost, true);
assert.equal(
  replacementActionReconnect.reconnect.reconnectCommand.principalUserId,
  replacementActionReconnectCase.replacementPrincipalUserId,
);
assert.equal(
  replacementActionReconnect.reconnect.reconnectCommand.command.SubmitPost.actor_slot,
  replacementActionReconnectCase.actorSlot,
);
assert.equal(
  replacementActionReconnect.reconnect.reconnectCommand.command.SubmitPost.body.startsWith(
    replacementActionReconnectCase.reconnectPostBodyPrefix,
  ),
  true,
);
assert.equal(
  replacementActionReconnect.commandStateAfterReconnect.actorSlot,
  replacementActionReconnectCase.actorSlot,
);
assert.equal(replacementActionReconnect.commandStateAfterReconnect.actorAlive, true);
assert.equal(replacementActionReconnect.commandStateAfterReconnect.actorStatus, "alive");
assert.equal(
  replacementActionReconnect.commandStateAfterReconnect.phase.phaseId,
  replacementActionReconnectCase.phaseId,
);
assert.equal(replacementActionReconnect.commandStateAfterReconnect.phase.locked, true);
assert.equal(replacementActionReconnect.commandStateAfterReconnect.actions.length, 0);
assert.equal(
  replacementActionReconnect.buttonsAfterReconnect.some(
    (button) => button.action === replacementActionReconnectCase.commandAction,
  ),
  false,
);
assert.equal(
  replacementActionReconnect.rowanPrivateIsolationAfterReconnect.targetKillVisible,
  false,
);
assert.equal(
  replacementActionReconnect.targetNoticeAfterReconnect.audience_slot,
  replacementActionReconnectCase.targetSlot,
);
assert.equal(
  replacementActionReconnect.targetNoticeAfterReconnect.effect,
  replacementActionReconnectCase.targetNoticeEffect,
);
assert.equal(
  replacementActionReconnect.targetNoticeAfterReconnect.status,
  replacementActionReconnectCase.templateId,
);
assert.equal(replacementStaleActionAfterResolve.status, "passed");
assert.equal(
  replacementStaleActionAfterResolve.targetSlot,
  replacementStaleActionAfterResolveCase.targetSlot,
);
assert.equal(
  replacementStaleActionAfterResolve.hostEntry.capabilityKinds.includes("HostOf"),
  true,
);
assert.equal(
  replacementStaleActionAfterResolve.replacementEntry.capabilityKinds.includes(
    "SlotOccupant",
  ),
  true,
);
assert.equal(
  replacementStaleActionAfterResolve.targetEntry.capabilityKinds.includes(
    "SlotOccupant",
  ),
  true,
);
assert.equal(replacementStaleActionAfterResolve.replacement.state, "ack");
assert.equal(
  replacementStaleActionAfterResolve.replacement.requestEnvelope.body.body.command
    .ProcessReplacement.slot,
  replacementStaleActionAfterResolveCase.actorSlot,
);
assert.equal(
  replacementStaleActionAfterResolve.replacement.requestEnvelope.body.body.command
    .ProcessReplacement.incoming_user,
  replacementStaleActionAfterResolveCase.replacementPrincipalUserId,
);
assert.equal(
  replacementStaleActionAfterResolve.commandStateBeforeClose.actorSlot,
  replacementStaleActionAfterResolveCase.actorSlot,
);
assert.equal(
  replacementStaleActionAfterResolve.commandStateBeforeClose.phase.phaseId,
  replacementStaleActionAfterResolveCase.phaseId,
);
assert.equal(
  replacementStaleActionAfterResolve.commandStateBeforeClose.phase.locked,
  false,
);
assert.equal(
  replacementStaleActionAfterResolve.commandStateBeforeClose.actions.some(
    (candidate) =>
      candidate.templateId === replacementStaleActionAfterResolveCase.templateId,
  ),
  true,
);
assert.equal(
  replacementStaleActionAfterResolve.actionButtonBeforeClose.action,
  replacementStaleActionAfterResolveCase.commandAction,
);
assert.equal(replacementStaleActionAfterResolve.actionButtonBeforeClose.disabled, false);
assert.equal(replacementStaleActionAfterResolve.closedStatus.state, "closed");
assert.equal(replacementStaleActionAfterResolve.resolveNight.commandStatus.state, "ack");
assert.equal(
  replacementStaleActionAfterResolve.hostPhaseAfterResolve.id,
  replacementStaleActionAfterResolveCase.phaseId,
);
assert.equal(replacementStaleActionAfterResolve.hostPhaseAfterResolve.locked, true);
assert.equal(
  replacementStaleActionAfterResolve.hostPhaseActionsAfterResolve.includes(
    "advance_phase",
  ),
  true,
);
assert.equal(
  replacementStaleActionAfterResolve.targetSlotAfterResolve.slot_id,
  replacementStaleActionAfterResolveCase.targetSlot,
);
assert.equal(replacementStaleActionAfterResolve.targetSlotAfterResolve.alive, true);
assert.equal(replacementStaleActionAfterResolve.reject.state, "reject");
assert.equal(
  replacementStaleActionAfterResolve.reject.error,
  replacementStaleActionAfterResolveCase.rejectionError,
);
assert.equal(
  replacementStaleActionAfterResolve.reject.serverEnvelope.body.kind,
  "Reject",
);
assert.equal(Array.isArray(replacementStaleActionAfterResolve.reject.streamSeqs), false);
assert.equal(
  replacementStaleActionAfterResolve.reject.message.includes(
    replacementStaleActionAfterResolveCase.staleActionStateMessageFragment,
  ),
  true,
);
assert.equal(
  replacementStaleActionAfterResolve.reject.message.includes(
    replacementStaleActionAfterResolveCase.currentActionControlsMessageFragment,
  ),
  true,
);
assert.equal(
  replacementStaleActionAfterResolve.reject.requestEnvelope.body.body.command
    .SubmitAction.actor_slot,
  replacementStaleActionAfterResolveCase.actorSlot,
);
assert.equal(
  replacementStaleActionAfterResolve.reject.requestEnvelope.body.body.command
    .SubmitAction.action_id,
  replacementStaleActionAfterResolveCase.staleActionId,
);
assert.equal(
  replacementStaleActionAfterResolve.reject.requestEnvelope.body.body.command
    .SubmitAction.template_id,
  replacementStaleActionAfterResolveCase.templateId,
);
assert.equal(
  replacementStaleActionAfterResolve.dispatchPlan.projectionRefreshKeys.includes(
    "notifications",
  ),
  true,
);
assert.equal(
  replacementStaleActionAfterResolve.dispatchPlan.projectionRefreshKeys.includes(
    "investigationResults",
  ),
  true,
);
assert.equal(
  replacementStaleActionAfterResolve.dispatchPlan.projectionRefreshKeys.includes(
    "commandState",
  ),
  true,
);
assert.equal(
  replacementStaleActionAfterResolve.currentReceipt.actionId,
  replacementStaleActionAfterResolveCase.commandAction,
);
assert.equal(replacementStaleActionAfterResolve.currentReceipt.state, "reject");
assert.equal(
  replacementStaleActionAfterResolve.receiptStatusText.includes(
    replacementStaleActionAfterResolveCase.rejectionStatusText,
  ),
  true,
);
assert.equal(
  replacementStaleActionAfterResolve.receiptStatusText.includes(
    replacementStaleActionAfterResolveCase.staleActionStateMessageFragment,
  ),
  true,
);
assert.equal(
  replacementStaleActionAfterResolve.commandStateAfterReject.actorSlot,
  replacementStaleActionAfterResolveCase.actorSlot,
);
assert.equal(replacementStaleActionAfterResolve.commandStateAfterReject.actorAlive, true);
assert.equal(
  replacementStaleActionAfterResolve.commandStateAfterReject.actorStatus,
  "alive",
);
assert.equal(
  replacementStaleActionAfterResolve.commandStateAfterReject.phase.phaseId,
  replacementStaleActionAfterResolveCase.phaseId,
);
assert.equal(
  replacementStaleActionAfterResolve.commandStateAfterReject.phase.locked,
  true,
);
assert.equal(replacementStaleActionAfterResolve.commandStateAfterReject.actions.length, 0);
assert.equal(
  replacementStaleActionAfterResolve.buttonsAfterReject.some(
    (button) => button.action === replacementStaleActionAfterResolveCase.commandAction,
  ),
  false,
);
assert.equal(
  replacementStaleActionAfterResolve.apiCommandStateAfterReject.actor_slot,
  replacementStaleActionAfterResolveCase.actorSlot,
);
assert.equal(
  replacementStaleActionAfterResolve.apiCommandStateAfterReject.actor_alive,
  true,
);
assert.equal(
  replacementStaleActionAfterResolve.apiCommandStateAfterReject.phase.phase_id,
  replacementStaleActionAfterResolveCase.phaseId,
);
assert.equal(
  replacementStaleActionAfterResolve.apiCommandStateAfterReject.phase.locked,
  true,
);
assert.equal(replacementStaleActionAfterResolve.apiCommandStateAfterReject.actions.length, 0);
assert.equal(
  replacementStaleActionAfterResolve.targetSlotAfterReject.slot_id,
  replacementStaleActionAfterResolveCase.targetSlot,
);
assert.equal(replacementStaleActionAfterResolve.targetSlotAfterReject.alive, true);
assert.equal(replacementStaleActionAfterResolve.targetSlotAfterReject.status, "alive");
assert.equal(
  replacementStaleActionAfterResolve.rowanPrivateIsolationAfterReject.targetKillVisible,
  false,
);
assert.equal(
  replacementStaleActionAfterResolve.targetCommandStateAfterReject.actorSlot,
  replacementStaleActionAfterResolveCase.targetSlot,
);
assert.equal(
  replacementStaleActionAfterResolve.targetCommandStateAfterReject.actorAlive,
  true,
);
assert.equal(
  replacementStaleActionAfterResolve.targetCommandStateAfterReject.phase.phaseId,
  replacementStaleActionAfterResolveCase.phaseId,
);
assert.equal(
  replacementStaleActionAfterResolve.targetCommandStateAfterReject.phase.locked,
  true,
);
assert.equal(replacementStaleActionAfterResolve.targetNoticeAfterReject, null);
assert.equal(replacementStalePrivatePostAfterResolve.status, "passed");
assert.equal(replacementStalePrivatePostAfterResolve.channel, "private:mafia_day_chat");
assert.equal(
  replacementStalePrivatePostAfterResolve.hostEntry.capabilityKinds.includes("HostOf"),
  true,
);
assert.equal(
  replacementStalePrivatePostAfterResolve.replacementEntry.capabilityKinds.includes(
    "SlotOccupant",
  ),
  true,
);
assert.equal(
  replacementStalePrivatePostAfterResolve.replacement.requestEnvelope.body.body.command
    .ProcessReplacement.slot,
  "slot-7",
);
assert.equal(
  replacementStalePrivatePostAfterResolve.replacement.requestEnvelope.body.body.command
    .ProcessReplacement.incoming_user,
  "player-rowan",
);
assert.equal(
  replacementStalePrivatePostAfterResolve.commandStateBeforeClose.actorSlot,
  "slot-7",
);
assert.equal(
  replacementStalePrivatePostAfterResolve.channelContextBeforeClose.channelId,
  "private:mafia_day_chat",
);
assert.equal(
  replacementStalePrivatePostAfterResolve.submitPostBeforeClose.disabled,
  false,
);
assert.equal(replacementStalePrivatePostAfterResolve.closedStatus.state, "closed");
assert.equal(
  replacementStalePrivatePostAfterResolve.resolveDay.commandStatus.state,
  "ack",
);
assert.equal(replacementStalePrivatePostAfterResolve.hostPhaseAfterResolve.id, "D01");
assert.equal(
  replacementStalePrivatePostAfterResolve.hostPhaseAfterResolve.locked,
  true,
);
assert.equal(replacementStalePrivatePostAfterResolve.stalePost.state, "ack");
assert.equal(
  replacementStalePrivatePostAfterResolve.stalePost.requestEnvelope.body.body.command
    .SubmitPost.channel_id,
  "private:mafia_day_chat",
);
assert.equal(
  replacementStalePrivatePostAfterResolve.stalePost.requestEnvelope.body.body.command
    .SubmitPost.actor_slot,
  "slot-7",
);
assert.equal(
  replacementStalePrivatePostAfterResolve.stalePost.requestEnvelope.body.body.command
    .SubmitPost.body,
  replacementStalePrivatePostAfterResolve.postBody,
);
assert.equal(
  replacementStalePrivatePostAfterResolve.commandStateAfterAck.phase.phaseId,
  "D01",
);
assert.equal(
  replacementStalePrivatePostAfterResolve.commandStateAfterAck.phase.locked,
  true,
);
assert.equal(
  replacementStalePrivatePostAfterResolve.commandStateAfterAck.voteTargets.length,
  0,
);
assert.equal(
  replacementStalePrivatePostAfterResolve.channelContextAfterAck.actorSlot,
  "slot-7",
);
assert.equal(
  replacementStalePrivatePostAfterResolve.apiThreadPostBodies.includes(
    replacementStalePrivatePostAfterResolve.postBody,
  ),
  true,
);
assert.equal(
  replacementStalePrivatePostAfterResolve.rowanPrivateIsolationAfterAck
    .targetKillVisible,
  false,
);
assert.equal(
  replacementStalePrivatePostAfterResolve.staleOutgoingRouteAfterAck.status,
  403,
);
assert.equal(
  replacementStalePrivatePostAfterResolve.staleOutgoingThreadAfterAck.status,
  403,
);
assert.equal(
  replacementStalePrivatePostAfterResolve.privateReconnectAfterAck.status,
  "passed",
);
assert.equal(
  replacementStalePrivatePostAfterResolve.privateReconnectAfterAck
    .reconnectCommandStateBeforeDrop.actorSlot,
  "slot-7",
);
assert.equal(
  replacementStalePrivatePostAfterResolve.privateReconnectAfterAck
    .reconnectCommandStateBeforeDrop.phase.locked,
  true,
);
assert.equal(
  replacementStalePrivatePostAfterResolve.privateReconnectAfterAck
    .reconnectChannelContextBeforeDrop.channelId,
  "private:mafia_day_chat",
);
assert.equal(
  replacementStalePrivatePostAfterResolve.privateReconnectAfterAck
    .reconnectButtonsBeforeDrop.some((button) =>
      button.action?.startsWith("submit_vote"),
    ),
  false,
);
assert.equal(
  replacementStalePrivatePostAfterResolve.privateReconnectAfterAck.reconnectingStatus
    .state,
  "reconnecting",
);
assert.equal(
  replacementStalePrivatePostAfterResolve.privateReconnectAfterAck.reconnectCommand
    .principalUserId,
  "player-rowan",
);
assert.equal(
  replacementStalePrivatePostAfterResolve.privateReconnectAfterAck.reconnectCommand
    .command.SubmitPost.channel_id,
  "private:mafia_day_chat",
);
assert.equal(
  replacementStalePrivatePostAfterResolve.privateReconnectAfterAck.reconnectCommand
    .command.SubmitPost.actor_slot,
  "slot-7",
);
assert.equal(
  replacementStalePrivatePostAfterResolve.privateReconnectAfterAck
    .reconnectRecoveryEvent.state,
  "recovered",
);
assert.equal(
  replacementStalePrivatePostAfterResolve.privateReconnectAfterAck
    .reconnectRecoveryEvent.attempt,
  1,
);
assert.equal(
  replacementStalePrivatePostAfterResolve.privateReconnectAfterAck
    .recoveredSnapshotContainsPost,
  true,
);
assert.equal(
  replacementStalePrivatePostAfterResolve.privateReconnectAfterAck
    .recoveredCommandState.phase.phaseId,
  "D01",
);
assert.equal(
  replacementStalePrivatePostAfterResolve.privateReconnectAfterAck
    .recoveredCommandState.phase.locked,
  true,
);
assert.equal(
  replacementStalePrivatePostAfterResolve.privateReconnectAfterAck
    .recoveredCommandState.voteTargets.length,
  0,
);
assert.equal(
  replacementStalePrivatePostAfterResolve.privateReconnectAfterAck
    .apiThreadPostBodiesAfterReconnect.includes(
      replacementStalePrivatePostAfterResolve.privateReconnectAfterAck
        .reconnectPostBody,
    ),
  true,
);
assert.equal(
  replacementStalePrivatePostAfterResolve.privateReconnectAfterAck
    .apiThreadPostBodiesAfterReconnect.includes(
      replacementStalePrivatePostAfterResolve.postBody,
    ),
  true,
);
assert.equal(
  replacementStalePrivatePostAfterResolve.privateReconnectAfterAck
    .staleOutgoingThreadAfterReconnect.status,
  403,
);
assert.equal(replacementStalePrivatePostAfterComplete.status, "passed");
assert.equal(replacementStalePrivatePostAfterComplete.channel, "private:mafia_day_chat");
assert.equal(
  replacementStalePrivatePostAfterComplete.hostEntry.capabilityKinds.includes("HostOf"),
  true,
);
assert.equal(
  replacementStalePrivatePostAfterComplete.replacementEntry.capabilityKinds.includes(
    "SlotOccupant",
  ),
  true,
);
assert.equal(
  replacementStalePrivatePostAfterComplete.replacement.requestEnvelope.body.body.command
    .ProcessReplacement.slot,
  "slot-7",
);
assert.equal(
  replacementStalePrivatePostAfterComplete.replacement.requestEnvelope.body.body.command
    .ProcessReplacement.incoming_user,
  "player-rowan",
);
assert.equal(
  replacementStalePrivatePostAfterComplete.commandStateBeforeClose.actorSlot,
  "slot-7",
);
assert.equal(
  replacementStalePrivatePostAfterComplete.commandStateBeforeClose.gameCompleted,
  false,
);
assert.equal(
  replacementStalePrivatePostAfterComplete.channelContextBeforeClose.channelId,
  "private:mafia_day_chat",
);
assert.equal(
  replacementStalePrivatePostAfterComplete.submitPostBeforeClose.disabled,
  false,
);
assert.equal(replacementStalePrivatePostAfterComplete.closedStatus.state, "closed");
assert.equal(
  replacementStalePrivatePostAfterComplete.complete.commandStatus.state,
  "ack",
);
assert.equal(
  replacementStalePrivatePostAfterComplete.hostSlotsAfterComplete.some(
    (slot) => slot.role_revealed !== true || slot.alignment_revealed !== true,
  ),
  false,
);
assert.equal(
  replacementStalePrivatePostAfterComplete.hostActionsAfterComplete.includes(
    "complete_game",
  ),
  false,
);
assert.equal(replacementStalePrivatePostAfterComplete.apiStateAfterComplete.completed, true);
assert.equal(replacementStalePrivatePostAfterComplete.reject.state, "reject");
assert.equal(
  replacementStalePrivatePostAfterComplete.reject.error,
  "GameAlreadyCompleted",
);
assert.equal(
  replacementStalePrivatePostAfterComplete.reject.requestEnvelope.body.body.command
    .SubmitPost.channel_id,
  "private:mafia_day_chat",
);
assert.equal(
  replacementStalePrivatePostAfterComplete.reject.requestEnvelope.body.body.command
    .SubmitPost.actor_slot,
  "slot-7",
);
assert.equal(
  replacementStalePrivatePostAfterComplete.reject.requestEnvelope.body.body.command
    .SubmitPost.body,
  replacementStalePrivatePostAfterComplete.postBody,
);
assert.equal(
  replacementStalePrivatePostAfterComplete.dispatchPlan.projectionRefreshKeys.includes(
    "commandState",
  ),
  true,
);
assert.equal(
  replacementStalePrivatePostAfterComplete.currentReceipt.actionId,
  "submit_post",
);
assert.equal(replacementStalePrivatePostAfterComplete.currentReceipt.state, "reject");
assert.match(
  replacementStalePrivatePostAfterComplete.receiptStatusText,
  /Reject GameAlreadyCompleted/,
);
assert.equal(
  replacementStalePrivatePostAfterComplete.commandStateAfterReject.gameCompleted,
  true,
);
assert.equal(
  replacementStalePrivatePostAfterComplete.commandStateAfterReject.voteTargets.length,
  0,
);
assert.equal(
  replacementStalePrivatePostAfterComplete.buttonsAfterReject.some(
    (button) => button.disabled !== true,
  ),
  false,
);
assert.equal(
  replacementStalePrivatePostAfterComplete.apiCommandStateAfterReject.game_completed,
  true,
);
assert.equal(
  replacementStalePrivatePostAfterComplete.apiThreadPostBodies.includes(
    replacementStalePrivatePostAfterComplete.postBody,
  ),
  false,
);
assert.equal(
  replacementStalePrivatePostAfterComplete.staleOutgoingRouteAfterReject.status,
  403,
);
assert.equal(
  replacementStalePrivatePostAfterComplete.staleOutgoingThreadAfterReject.status,
  403,
);
assert.equal(
  replacementStalePrivatePostAfterComplete.privateReloadAfterReject.status,
  "passed",
);
assert.equal(
  replacementStalePrivatePostAfterComplete.privateReloadAfterReject
    .routeResponseStatus,
  200,
);
assert.equal(
  replacementStalePrivatePostAfterComplete.privateReloadAfterReject
    .threadPagerVisible,
  true,
);
assert.equal(
  replacementStalePrivatePostAfterComplete.privateReloadAfterReject
    .recoveredCommandState.actorSlot,
  "slot-7",
);
assert.equal(
  replacementStalePrivatePostAfterComplete.privateReloadAfterReject
    .recoveredCommandState.gameCompleted,
  true,
);
assert.equal(
  replacementStalePrivatePostAfterComplete.privateReloadAfterReject
    .recoveredCommandState.actions.length,
  0,
);
assert.equal(
  replacementStalePrivatePostAfterComplete.privateReloadAfterReject
    .recoveredCommandState.voteTargets.length,
  0,
);
assert.match(
  replacementStalePrivatePostAfterComplete.privateReloadAfterReject
    .recoveredCommandState.boundary,
  /game is complete/,
);
assert.equal(
  replacementStalePrivatePostAfterComplete.privateReloadAfterReject
    .reloadChannelContext.channelId,
  "private:mafia_day_chat",
);
assert.equal(
  replacementStalePrivatePostAfterComplete.privateReloadAfterReject
    .reloadChannelContext.actorSlot,
  "slot-7",
);
assert.match(
  replacementStalePrivatePostAfterComplete.privateReloadAfterReject
    .reloadChannelContext.capabilityLabel,
  /ChannelMember\(private:mafia_day_chat\)/,
);
assert.equal(
  replacementStalePrivatePostAfterComplete.privateReloadAfterReject.reloadButtons.some(
    (button) => button.disabled !== true,
  ),
  false,
);
assert.equal(
  replacementStalePrivatePostAfterComplete.privateReloadAfterReject
    .reloadRejectedPostVisible,
  false,
);
assert.equal(
  replacementStalePrivatePostAfterComplete.privateReloadAfterReject
    .reloadThreadPostBodies.includes(replacementStalePrivatePostAfterComplete.postBody),
  false,
);
assert.equal(
  replacementStalePrivatePostAfterComplete.privateReloadAfterReject
    .apiCommandStateAfterReload.game_completed,
  true,
);
assert.equal(
  replacementStalePrivatePostAfterComplete.privateReloadAfterReject
    .apiCommandStateAfterReload.actions.length,
  0,
);
assert.equal(
  replacementStalePrivatePostAfterComplete.privateReloadAfterReject
    .apiCommandStateAfterReload.vote_targets.length,
  0,
);
assert.equal(
  replacementStalePrivatePostAfterComplete.privateReloadAfterReject
    .apiThreadPostBodiesAfterReload.includes(
      replacementStalePrivatePostAfterComplete.postBody,
    ),
  false,
);
assert.equal(
  replacementStalePrivatePostAfterComplete.privateReloadAfterReject
    .staleOutgoingRouteAfterReload.status,
  403,
);
assert.equal(
  replacementStalePrivatePostAfterComplete.privateReloadAfterReject
    .staleOutgoingThreadAfterReload.status,
  403,
);
assert.equal(
  session.verification.multiplayerHardening.hostLifecycleControl.status,
  "passed",
);
assert.equal(
  session.verification.multiplayerHardening.hostLifecycleControl.targetSlot,
  "slot-7",
);
assert.equal(
  session.verification.multiplayerHardening.hostLifecycleControl.markDead.commandStatus.state,
  "ack",
);
assert.equal(
  session.verification.multiplayerHardening.hostLifecycleControl.markDead.commandStatus
    .requestEnvelope.body.body.command.SetSlotStatus.status,
  "dead",
);
assert.equal(
  session.verification.multiplayerHardening.hostLifecycleControl.hostReplacementAfterDead
    .lifecycleLabel,
  "Dead",
);
assert.equal(
  session.verification.multiplayerHardening.hostLifecycleControl.apiSlotAfterDead.alive,
  false,
);
assert.equal(
  session.verification.multiplayerHardening.hostLifecycleControl.playerCommandStateAfterDead
    .actorStatus,
  "dead",
);
assert.equal(
  session.verification.multiplayerHardening.hostLifecycleControl.disabledControls.post
    .disabled,
  true,
);
assert.equal(
  session.verification.multiplayerHardening.hostLifecycleControl.actionControlCount,
  0,
);
assert.equal(
  session.verification.multiplayerHardening.hostLifecycleControl.directPost.error,
  "SlotNotAlive",
);
assert.equal(
  session.verification.multiplayerHardening.hostLifecycleControl.restoreAlive.state,
  "ack",
);
assert.equal(
  session.verification.multiplayerHardening.hostLifecycleControl.apiSlotAfterRestore.alive,
  true,
);
assert.equal(
  session.verification.multiplayerHardening.hostLifecycleControl
    .playerCommandStateAfterRestore.actorStatus,
  "alive",
);
assert.equal(session.verification.multiplayerHardening.staleHostLifecycle.status, "passed");
assert.equal(
  session.verification.multiplayerHardening.staleHostLifecycle.actionId,
  "mark_dead",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostLifecycle.setup.replacement
    .lifecycleLabel,
  "Alive",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostLifecycle.reject.state,
  "reject",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostLifecycle.reject.error,
  "InvalidTarget",
);
assert.match(
  session.verification.multiplayerHardening.staleHostLifecycle.reject.message,
  /slot lifecycle changed or is already current/,
);
assert.equal(
  Array.isArray(
    session.verification.multiplayerHardening.staleHostLifecycle.reject.streamSeqs,
  ),
  false,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostLifecycle.replacementAfterReject
    .lifecycleLabel,
  "Alive",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostLifecycle.dispatchPlan
    .projectionRefreshKeys.length,
  0,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostLifecycle.apiSlotAfterReject.status,
  "dead",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostLifecycle.playerCommandStateAfterReject
    .actorStatus,
  "dead",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostLifecycle
    .staleHostSlotLifecycleReloadAfterReject.status,
  "passed",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostLifecycle
    .staleHostSlotLifecycleReloadAfterReject.routeResponseStatus,
  200,
);
assert.match(
  session.verification.multiplayerHardening.staleHostLifecycle
    .staleHostSlotLifecycleReloadAfterReject.rejectReceiptStatusText,
  /Reject InvalidTarget/,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostLifecycle
    .staleHostSlotLifecycleReloadAfterReject.replacementAfterReload.lifecycleLabel,
  "Dead",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostLifecycle
    .staleHostSlotLifecycleReloadAfterReject.lifecycleActionsAfterReload.includes(
      "mark_dead",
    ),
  false,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostLifecycle
    .staleHostSlotLifecycleReloadAfterReject.lifecycleActionsAfterReload.includes(
      "modkill_slot",
    ),
  false,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostLifecycle
    .staleHostSlotLifecycleReloadAfterReject.apiSlotAfterReload.status,
  "dead",
);
assert.equal(
  session.verification.multiplayerHardening.hostModkillControl.status,
  "passed",
);
assert.equal(
  session.verification.multiplayerHardening.hostModkillControl.targetSlot,
  "slot-7",
);
assert.equal(
  session.verification.multiplayerHardening.hostModkillControl.modkill.commandStatus.state,
  "ack",
);
assert.equal(
  session.verification.multiplayerHardening.hostModkillControl.modkill.commandStatus
    .requestEnvelope.body.body.command.SetSlotStatus.status,
  "modkilled",
);
assert.equal(
  session.verification.multiplayerHardening.hostModkillControl.hostReplacementAfterModkill
    .lifecycleLabel,
  "Modkilled",
);
assert.equal(
  session.verification.multiplayerHardening.hostModkillControl.apiSlotAfterModkill.alive,
  false,
);
assert.equal(
  session.verification.multiplayerHardening.hostModkillControl.playerCommandStateAfterModkill
    .actorStatus,
  "modkilled",
);
assert.equal(
  session.verification.multiplayerHardening.hostModkillControl.disabledControls.post
    .disabled,
  true,
);
assert.equal(
  session.verification.multiplayerHardening.hostModkillControl.actionControlCount,
  0,
);
assert.equal(
  session.verification.multiplayerHardening.hostModkillControl.directPost.error,
  "SlotNotAlive",
);
assert.equal(
  session.verification.multiplayerHardening.hostModkillControl.restoreAlive.state,
  "ack",
);
assert.equal(
  session.verification.multiplayerHardening.hostModkillControl.apiSlotAfterRestore.alive,
  true,
);
assert.equal(
  session.verification.multiplayerHardening.hostModkillControl
    .playerCommandStateAfterRestore.actorStatus,
  "alive",
);
assert.equal(session.verification.multiplayerHardening.staleHostModkill.status, "passed");
assert.equal(
  session.verification.multiplayerHardening.staleHostModkill.actionId,
  "modkill_slot",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostModkill.setup.replacement
    .lifecycleLabel,
  "Alive",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostModkill.reject.state,
  "reject",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostModkill.reject.error,
  "InvalidTarget",
);
assert.match(
  session.verification.multiplayerHardening.staleHostModkill.reject.message,
  /slot lifecycle changed or is already current/,
);
assert.equal(
  Array.isArray(
    session.verification.multiplayerHardening.staleHostModkill.reject.streamSeqs,
  ),
  false,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostModkill.replacementAfterReject
    .lifecycleLabel,
  "Alive",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostModkill.dispatchPlan
    .projectionRefreshKeys.length,
  0,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostModkill.apiSlotAfterReject.status,
  "modkilled",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostModkill.playerCommandStateAfterReject
    .actorStatus,
  "modkilled",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostModkill
    .staleHostSlotLifecycleReloadAfterReject.status,
  "passed",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostModkill
    .staleHostSlotLifecycleReloadAfterReject.routeResponseStatus,
  200,
);
assert.match(
  session.verification.multiplayerHardening.staleHostModkill
    .staleHostSlotLifecycleReloadAfterReject.rejectReceiptStatusText,
  /Reject InvalidTarget/,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostModkill
    .staleHostSlotLifecycleReloadAfterReject.replacementAfterReload.lifecycleLabel,
  "Modkilled",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostModkill
    .staleHostSlotLifecycleReloadAfterReject.lifecycleActionsAfterReload.includes(
      "mark_dead",
    ),
  false,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostModkill
    .staleHostSlotLifecycleReloadAfterReject.lifecycleActionsAfterReload.includes(
      "modkill_slot",
    ),
  false,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostModkill
    .staleHostSlotLifecycleReloadAfterReject.apiSlotAfterReload.status,
  "modkilled",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostLifecycleRace.status,
  "passed",
);
assert(
  ["dead", "modkill"].includes(
    session.verification.multiplayerHardening.concurrentHostLifecycleRace.ackRaceRole,
  ),
);
assert(
  ["dead", "modkill"].includes(
    session.verification.multiplayerHardening.concurrentHostLifecycleRace.rejectRaceRole,
  ),
);
assert.notEqual(
  session.verification.multiplayerHardening.concurrentHostLifecycleRace.ackRaceRole,
  session.verification.multiplayerHardening.concurrentHostLifecycleRace.rejectRaceRole,
);
assert(
  ["mark_dead", "modkill_slot"].includes(
    session.verification.multiplayerHardening.concurrentHostLifecycleRace.ackActionId,
  ),
);
assert(
  ["mark_dead", "modkill_slot"].includes(
    session.verification.multiplayerHardening.concurrentHostLifecycleRace.rejectActionId,
  ),
);
assert.notEqual(
  session.verification.multiplayerHardening.concurrentHostLifecycleRace.ackActionId,
  session.verification.multiplayerHardening.concurrentHostLifecycleRace.rejectActionId,
);
assert(
  ["dead", "modkilled"].includes(
    session.verification.multiplayerHardening.concurrentHostLifecycleRace.winningStatus,
  ),
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostLifecycleRace.ack.state,
  "ack",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostLifecycleRace.ack.streamSeqs
    .length,
  1,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostLifecycleRace.reject.state,
  "reject",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostLifecycleRace.reject.error,
  "InvalidTarget",
);
assert.match(
  session.verification.multiplayerHardening.concurrentHostLifecycleRace.reject.message,
  /slot lifecycle changed or is already current/,
);
assert.notEqual(
  session.verification.multiplayerHardening.concurrentHostLifecycleRace.ack.commandId,
  session.verification.multiplayerHardening.concurrentHostLifecycleRace.reject.commandId,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostLifecycleRace.ack.requestEnvelope
    .body.body.command.SetSlotStatus.game,
  session.verification.multiplayerHardening.concurrentHostLifecycleRace.game,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostLifecycleRace.ack.requestEnvelope
    .body.body.command.SetSlotStatus.slot,
  "slot-7",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostLifecycleRace.ack.requestEnvelope
    .body.body.command.SetSlotStatus.status,
  session.verification.multiplayerHardening.concurrentHostLifecycleRace.winningStatus,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostLifecycleRace.reject
    .requestEnvelope.body.body.command.SetSlotStatus.game,
  session.verification.multiplayerHardening.concurrentHostLifecycleRace.game,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostLifecycleRace.reject
    .requestEnvelope.body.body.command.SetSlotStatus.slot,
  "slot-7",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostLifecycleRace
    .deadReplacementAfterRace.lifecycleLabel,
  session.verification.multiplayerHardening.concurrentHostLifecycleRace.winningLabel,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostLifecycleRace
    .modkillReplacementAfterRace.lifecycleLabel,
  session.verification.multiplayerHardening.concurrentHostLifecycleRace.winningLabel,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostLifecycleRace
    .affectedPlayerCommandStateAfterRace.actorStatus,
  session.verification.multiplayerHardening.concurrentHostLifecycleRace.winningStatus,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostLifecycleRace.disabledControls.post
    .disabled,
  true,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostLifecycleRace.actionControlCount,
  0,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostLifecycleRace.directPost.error,
  "SlotNotAlive",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostLifecycleRace.apiSlotAfterRace
    .status,
  session.verification.multiplayerHardening.concurrentHostLifecycleRace.winningStatus,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostLifecycleRace
    .roleReloadAfterRace.status,
  "passed",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostLifecycleRace
    .roleReloadAfterRace.deadRouteStatus,
  200,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostLifecycleRace
    .roleReloadAfterRace.modkillRouteStatus,
  200,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostLifecycleRace
    .roleReloadAfterRace.playerRouteStatus,
  200,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostLifecycleRace
    .roleReloadAfterRace.deadPhaseAfterReload.id,
  "D02",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostLifecycleRace
    .roleReloadAfterRace.deadPhaseAfterReload.locked,
  false,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostLifecycleRace
    .roleReloadAfterRace.modkillPhaseAfterReload.id,
  "D02",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostLifecycleRace
    .roleReloadAfterRace.modkillPhaseAfterReload.locked,
  false,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostLifecycleRace
    .roleReloadAfterRace.deadReplacementAfterReload.lifecycleLabel,
  session.verification.multiplayerHardening.concurrentHostLifecycleRace.winningLabel,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostLifecycleRace
    .roleReloadAfterRace.modkillReplacementAfterReload.lifecycleLabel,
  session.verification.multiplayerHardening.concurrentHostLifecycleRace.winningLabel,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostLifecycleRace
    .roleReloadAfterRace.deadLifecycleActionsAfterReload.includes("mark_dead"),
  false,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostLifecycleRace
    .roleReloadAfterRace.deadLifecycleActionsAfterReload.includes("modkill_slot"),
  false,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostLifecycleRace
    .roleReloadAfterRace.modkillLifecycleActionsAfterReload.includes("mark_dead"),
  false,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostLifecycleRace
    .roleReloadAfterRace.modkillLifecycleActionsAfterReload.includes("modkill_slot"),
  false,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostLifecycleRace
    .roleReloadAfterRace.affectedPlayerCommandStateAfterReload.actorStatus,
  session.verification.multiplayerHardening.concurrentHostLifecycleRace.winningStatus,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostLifecycleRace
    .roleReloadAfterRace.affectedPlayerCommandStateAfterReload.actions.length,
  0,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostLifecycleRace
    .roleReloadAfterRace.disabledControlsAfterReload.post.disabled,
  true,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostLifecycleRace
    .roleReloadAfterRace.actionControlCountAfterReload,
  0,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostLifecycleRace
    .roleReloadAfterRace.apiSlotAfterReload.status,
  session.verification.multiplayerHardening.concurrentHostLifecycleRace.winningStatus,
);
assert.equal(session.verification.multiplayerHardening.staleHostPrompt.status, "passed");
assert.equal(
  session.verification.multiplayerHardening.staleHostPrompt.reject.error,
  "PromptAlreadyResolved",
);
assert.match(
  session.verification.multiplayerHardening.staleHostPrompt.activityStatusText,
  /Reject PromptAlreadyResolved/,
);
assert.match(
  session.verification.multiplayerHardening.staleHostPrompt.activityStatusText,
  /host prompt selection is stale/,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostPrompt
    .staleHostPromptReloadAfterReject.status,
  "passed",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostPrompt
    .staleHostPromptReloadAfterReject.routeResponseStatus,
  200,
);
assert.match(
  session.verification.multiplayerHardening.staleHostPrompt
    .staleHostPromptReloadAfterReject.rejectReceiptStatusText,
  /Reject PromptAlreadyResolved/,
);
assert.match(
  session.verification.multiplayerHardening.staleHostPrompt
    .staleHostPromptReloadAfterReject.rejectReceiptStatusText,
  /host prompt selection is stale/,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostPrompt
    .staleHostPromptReloadAfterReject.promptsAfterReload.find(
      (prompt) => prompt.id === "D01:skip_next_day:slot_1",
    )?.status,
  "resolved",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostPrompt
    .staleHostPromptReloadAfterReject.promptActionsAfterReload.includes(
      "resolve_host_prompt-D01-skip_next_day-slot_1",
    ),
  false,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostPrompt
    .staleHostPromptReloadAfterReject.apiPromptsAfterReload.find(
      (prompt) => (prompt.id ?? prompt.prompt_id) === "D01:skip_next_day:slot_1",
    )?.status,
  "resolved",
);
assert.equal(session.verification.multiplayerHardening.staleHostComplete.status, "passed");
assert.equal(
  typeof session.verification.multiplayerHardening.staleHostComplete.game,
  "string",
);
assert.match(
  session.verification.multiplayerHardening.staleHostComplete.game,
  /^[0-9a-f-]{36}$/,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostComplete.reject.error,
  "GameAlreadyCompleted",
);
assert.match(
  session.verification.multiplayerHardening.staleHostComplete.activityStatusText,
  /Reject GameAlreadyCompleted/,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostComplete
    .staleHostReloadAfterReject.status,
  "passed",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostComplete
    .staleHostReloadAfterReject.routeResponseStatus,
  200,
);
assert.match(
  session.verification.multiplayerHardening.staleHostComplete
    .staleHostReloadAfterReject.rejectReceiptStatusText,
  /Reject GameAlreadyCompleted/,
);
assert.match(
  session.verification.multiplayerHardening.staleHostComplete
    .staleHostReloadAfterReject.surfaceText,
  /All 1 slots revealed/,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostComplete
    .staleHostReloadAfterReject.slotsAfterReload.length,
  1,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostComplete
    .staleHostReloadAfterReject.slotsAfterReload.every(
      (slot) => slot.role_revealed === true && slot.alignment_revealed === true,
    ),
  true,
);
assert.match(
  session.verification.multiplayerHardening.staleHostComplete
    .staleHostReloadAfterReject.revealTextAfterReload,
  /All 1 slots revealed/,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostComplete
    .staleHostReloadAfterReject.roleActionsAfterReload.includes("complete_game"),
  false,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostComplete
    .staleHostReloadAfterReject.apiStateAfterReload.completed,
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostComplete
    .staleHostReloadAfterReject.apiStateAfterReload.slots.every(
      (slot) => slot.role_revealed === true && slot.alignment_revealed === true,
    ),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostCompleteRace.status,
  "passed",
);
assert(
  ["first", "second"].includes(
    session.verification.multiplayerHardening.concurrentHostCompleteRace.ackRaceRole,
  ),
);
assert(
  ["first", "second"].includes(
    session.verification.multiplayerHardening.concurrentHostCompleteRace.rejectRaceRole,
  ),
);
assert.notEqual(
  session.verification.multiplayerHardening.concurrentHostCompleteRace.ackRaceRole,
  session.verification.multiplayerHardening.concurrentHostCompleteRace.rejectRaceRole,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostCompleteRace.ack.state,
  "ack",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostCompleteRace.ack.streamSeqs
    .length,
  1,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostCompleteRace.reject.state,
  "reject",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostCompleteRace.reject.error,
  "GameAlreadyCompleted",
);
assert.notEqual(
  session.verification.multiplayerHardening.concurrentHostCompleteRace.ack.commandId,
  session.verification.multiplayerHardening.concurrentHostCompleteRace.reject.commandId,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostCompleteRace.ack.requestEnvelope
    .body.body.command.CompleteGame.game,
  session.verification.multiplayerHardening.concurrentHostCompleteRace.game,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostCompleteRace.reject
    .requestEnvelope.body.body.command.CompleteGame.game,
  session.verification.multiplayerHardening.concurrentHostCompleteRace.game,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostCompleteRace
    .firstRoleActionsAfterRace.includes("complete_game"),
  false,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostCompleteRace
    .secondRoleActionsAfterRace.includes("complete_game"),
  false,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostCompleteRace.apiStateAfterRace
    .completed,
  true,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostCompleteRace.apiStateAfterRace
    .slots.length,
  1,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostCompleteRace.apiStateAfterRace
    .slots[0].role_revealed,
  true,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostCompleteRace.apiStateAfterRace
    .slots[0].alignment_revealed,
  true,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostCompleteRace
    .roleReloadAfterRace.status,
  "passed",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostCompleteRace
    .roleReloadAfterRace.firstRouteStatus,
  200,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostCompleteRace
    .roleReloadAfterRace.secondRouteStatus,
  200,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostCompleteRace
    .roleReloadAfterRace.firstSlotsAfterReload.length,
  1,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostCompleteRace
    .roleReloadAfterRace.secondSlotsAfterReload.length,
  1,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostCompleteRace
    .roleReloadAfterRace.firstSlotsAfterReload[0].role_revealed,
  true,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostCompleteRace
    .roleReloadAfterRace.firstSlotsAfterReload[0].alignment_revealed,
  true,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostCompleteRace
    .roleReloadAfterRace.secondSlotsAfterReload[0].role_revealed,
  true,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostCompleteRace
    .roleReloadAfterRace.secondSlotsAfterReload[0].alignment_revealed,
  true,
);
assert.match(
  session.verification.multiplayerHardening.concurrentHostCompleteRace
    .roleReloadAfterRace.firstRevealTextAfterReload,
  /All 1 slots revealed/,
);
assert.match(
  session.verification.multiplayerHardening.concurrentHostCompleteRace
    .roleReloadAfterRace.secondRevealTextAfterReload,
  /All 1 slots revealed/,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostCompleteRace
    .roleReloadAfterRace.firstRoleActionsAfterReload.includes("complete_game"),
  false,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostCompleteRace
    .roleReloadAfterRace.secondRoleActionsAfterReload.includes("complete_game"),
  false,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostCompleteRace
    .roleReloadAfterRace.apiStateAfterReload.completed,
  true,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostCompleteRace
    .roleReloadAfterRace.apiStateAfterReload.slots[0].role_revealed,
  true,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostCompleteRace
    .roleReloadAfterRace.apiStateAfterReload.slots[0].alignment_revealed,
  true,
);
assert.equal(concurrentPlayerCompleteRace.status, "passed");
assert.equal(
  concurrentPlayerCompleteRace.publicReloadAfterRace.status,
  "passed",
);
assert.equal(
  concurrentPlayerCompleteRace.publicReloadAfterRace.routeResponseStatus,
  200,
);
assert.equal(
  concurrentPlayerCompleteRace.publicReloadAfterRace.threadPagerVisible,
  true,
);
assert.match(
  concurrentPlayerCompleteRace.publicReloadAfterRace.surfaceText,
  /Endgame/,
);
assert.match(
  concurrentPlayerCompleteRace.publicReloadAfterRace.surfaceText,
  /The game is complete\./,
);
assert.equal(
  concurrentPlayerCompleteRace.publicReloadAfterRace.recoveredCommandState.actorSlot,
  "slot-7",
);
assert.equal(
  concurrentPlayerCompleteRace.publicReloadAfterRace.recoveredCommandState
    .gameCompleted,
  true,
);
assert.equal(
  concurrentPlayerCompleteRace.publicReloadAfterRace.recoveredCommandState.actions
    .length,
  0,
);
assert.equal(
  concurrentPlayerCompleteRace.publicReloadAfterRace.recoveredCommandState.voteTargets
    .length,
  0,
);
assert.match(
  concurrentPlayerCompleteRace.publicReloadAfterRace.recoveredCommandState.boundary,
  /game is complete/,
);
assert.equal(
  concurrentPlayerCompleteRace.publicReloadAfterRace.reloadButtons.some(
    (button) => button.disabled !== true,
  ),
  false,
);
assert.equal(
  concurrentPlayerCompleteRace.publicReloadAfterRace.apiCommandStateAfterReload
    .game_completed,
  true,
);
assert.equal(
  concurrentPlayerCompleteRace.publicReloadAfterRace.apiCommandStateAfterReload.actions
    .length,
  0,
);
assert.equal(
  concurrentPlayerCompleteRace.publicReloadAfterRace.apiCommandStateAfterReload
    .vote_targets.length,
  0,
);
assert.equal(
  concurrentPlayerCompleteRace.publicReloadAfterRace.apiStateAfterReload.completed,
  true,
);
assert.equal(
  concurrentPlayerCompleteRace.publicReloadAfterRace.apiStateAfterReload.slots.every(
    (slot) => slot.role_revealed === true && slot.alignment_revealed === true,
  ),
  true,
);
if (concurrentPlayerCompleteRace.post.state === "ack") {
  assert.equal(concurrentPlayerCompleteRace.publicReloadAfterRace.reloadPostCount, 1);
  assert.equal(concurrentPlayerCompleteRace.publicReloadAfterRace.reloadPostVisible, true);
  assert.equal(concurrentPlayerCompleteRace.publicReloadAfterRace.apiThreadPostCount, 1);
  assert.equal(
    concurrentPlayerCompleteRace.publicReloadAfterRace.reloadThreadPostBodies.includes(
      concurrentPlayerCompleteRace.postBody,
    ),
    true,
  );
  assert.equal(
    concurrentPlayerCompleteRace.publicReloadAfterRace.apiThreadPostBodiesAfterReload.includes(
      concurrentPlayerCompleteRace.postBody,
    ),
    true,
  );
} else {
  assert.equal(concurrentPlayerCompleteRace.post.error, "GameAlreadyCompleted");
  assert.equal(concurrentPlayerCompleteRace.publicReloadAfterRace.reloadPostCount, 0);
  assert.equal(concurrentPlayerCompleteRace.publicReloadAfterRace.reloadPostVisible, false);
  assert.equal(concurrentPlayerCompleteRace.publicReloadAfterRace.apiThreadPostCount, 0);
  assert.equal(
    concurrentPlayerCompleteRace.publicReloadAfterRace.reloadThreadPostBodies.includes(
      concurrentPlayerCompleteRace.postBody,
    ),
    false,
  );
  assert.equal(
    concurrentPlayerCompleteRace.publicReloadAfterRace.apiThreadPostBodiesAfterReload.includes(
      concurrentPlayerCompleteRace.postBody,
    ),
    false,
  );
}
assert.equal(stalePlayerComplete.status, "passed");
assert.equal(typeof stalePlayerComplete.game, "string");
assert.match(stalePlayerComplete.game, /^[0-9a-f-]{36}$/);
assert.equal(stalePlayerComplete.reject.error, "GameAlreadyCompleted");
assert.equal(stalePlayerComplete.currentVoteAfterReject.hasVote, "false");
assert.match(stalePlayerComplete.currentVoteAfterReject.text, /No current vote/);
assert.equal(
  stalePlayerComplete.stalePublicReloadAfterReject.status,
  "passed",
);
assert.equal(
  stalePlayerComplete.stalePublicReloadAfterReject.routeResponseStatus,
  200,
);
assert.equal(
  stalePlayerComplete.stalePublicReloadAfterReject.threadPagerVisible,
  true,
);
assert.match(
  stalePlayerComplete.stalePublicReloadAfterReject.surfaceText,
  /Endgame/,
);
assert.match(
  stalePlayerComplete.stalePublicReloadAfterReject.surfaceText,
  /The game is complete\./,
);
assert.equal(
  stalePlayerComplete.stalePublicReloadAfterReject.recoveredCommandState.actorSlot,
  "slot-7",
);
assert.equal(
  stalePlayerComplete.stalePublicReloadAfterReject.recoveredCommandState.gameCompleted,
  true,
);
assert.equal(
  stalePlayerComplete.stalePublicReloadAfterReject.recoveredCommandState.actions.length,
  0,
);
assert.equal(
  stalePlayerComplete.stalePublicReloadAfterReject.recoveredCommandState.voteTargets
    .length,
  0,
);
assert.match(
  stalePlayerComplete.stalePublicReloadAfterReject.recoveredCommandState.boundary,
  /game is complete/,
);
assert.equal(
  stalePlayerComplete.stalePublicReloadAfterReject.reloadButtons.some(
    (button) => button.disabled !== true,
  ),
  false,
);
assert.equal(
  stalePlayerComplete.stalePublicReloadAfterReject.reloadCurrentVote.hasVote,
  "false",
);
assert.match(
  stalePlayerComplete.stalePublicReloadAfterReject.reloadCurrentVote.text,
  /No current vote/,
);
assert.deepEqual(
  stalePlayerComplete.stalePublicReloadAfterReject.reloadThreadPostBodies,
  stalePlayerComplete.seed.expectedThreadBodies,
);
assert.equal(
  stalePlayerComplete.stalePublicReloadAfterReject.apiCommandStateAfterReload
    .game_completed,
  true,
);
assert.equal(
  stalePlayerComplete.stalePublicReloadAfterReject.apiCommandStateAfterReload.actions
    .length,
  0,
);
assert.equal(
  stalePlayerComplete.stalePublicReloadAfterReject.apiCommandStateAfterReload
    .vote_targets.length,
  0,
);
assert.deepEqual(
  stalePlayerComplete.stalePublicReloadAfterReject.apiThreadPostBodiesAfterReload,
  stalePlayerComplete.seed.expectedThreadBodies,
);
assert.equal(
  stalePlayerComplete.stalePublicReloadAfterReject.apiStateAfterReload.completed,
  true,
);
assert.equal(
  stalePlayerComplete.stalePublicReloadAfterReject.apiStateAfterReload.slots.every(
    (slot) => slot.role_revealed === true && slot.alignment_revealed === true,
  ),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleDeadActionConflict.status,
  "passed",
);
assert.equal(
  session.verification.multiplayerHardening.staleDeadActionConflict.actionConfig.templateId,
  "factional_kill",
);
assert.equal(
  session.verification.multiplayerHardening.staleDeadActionConflict.markDead.state,
  "ack",
);
assert.equal(
  session.verification.multiplayerHardening.staleDeadActionConflict.apiSlotAfterDead.alive,
  false,
);
assert.equal(
  session.verification.multiplayerHardening.staleDeadActionConflict.reject.error,
  "SlotNotAlive",
);
assert.match(
  session.verification.multiplayerHardening.staleDeadActionConflict.reject.message,
  /actor is no longer alive/,
);
assert.match(
  session.verification.multiplayerHardening.staleDeadActionConflict.reject.message,
  /current action controls/,
);
assert.equal(
  session.verification.multiplayerHardening.staleDeadActionConflict.commandStateAfterReject
    .actorStatus,
  "dead",
);
assert.equal(
  session.verification.multiplayerHardening.staleDeadActionConflict.commandStateAfterReject
    .actions.length,
  0,
);
assert.equal(
  session.verification.multiplayerHardening.staleDeadActionConflict.actionVisibleAfterRefresh,
  false,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentActionRace.status,
  "passed",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentActionRace.ack.state,
  "ack",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentActionRace.reject.error,
  "ActionAlreadySubmitted",
);
assert.notEqual(
  session.verification.multiplayerHardening.concurrentActionRace.ack.commandId,
  session.verification.multiplayerHardening.concurrentActionRace.reject.commandId,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentActionRace
    .apiCommandStateAfterRace.actions.length,
  0,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentActionRace.resolvedTargetSlot.alive,
  false,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentActionRace
    .actionVisibleAfterRefresh,
  false,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentActionRace.roleReloadAfterRace
    .status,
  "passed",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentActionRace.roleReloadAfterRace
    .actionRouteStatus,
  200,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentActionRace.roleReloadAfterRace
    .hostRouteStatus,
  200,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentActionRace.roleReloadAfterRace
    .actionCommandState.phase.phaseId,
  "N01",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentActionRace.roleReloadAfterRace
    .actionCommandState.phase.locked,
  true,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentActionRace.roleReloadAfterRace
    .actionCommandState.actions.length,
  0,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentActionRace.roleReloadAfterRace
    .actionVisibleAfterReload,
  false,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentActionRace.roleReloadAfterRace
    .hostPhase.id,
  "N01",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentActionRace.roleReloadAfterRace
    .hostPhase.locked,
  true,
);
assert.equal(
  Array.isArray(
    session.verification.multiplayerHardening.concurrentActionRace.roleReloadAfterRace
      .hostSlotsAfterReload,
  ),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentActionRace.roleReloadAfterRace
    .apiCommandState.phase.phase_id,
  "N01",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentActionRace.roleReloadAfterRace
    .apiCommandState.phase.locked,
  true,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentActionRace.roleReloadAfterRace
    .apiCommandState.actions.length,
  0,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentActionRace.roleReloadAfterRace
    .apiTargetSlot.alive,
  false,
);
assert.equal(
  session.verification.multiplayerHardening.actionIdempotentRetry.status,
  "passed",
);
assert.equal(
  session.verification.multiplayerHardening.actionIdempotentRetry.retry.state,
  "ack",
);
assert.equal(
  session.verification.multiplayerHardening.actionIdempotentRetry.retry.commandId,
  session.verification.multiplayerHardening.actionIdempotentRetry.legalActionCommandId,
);
assert.deepEqual(
  session.verification.multiplayerHardening.actionIdempotentRetry.retry.streamSeqs,
  session.verification.multiplayerHardening.actionIdempotentRetry.legalActionStreamSeqs,
);
assert.equal(
  session.verification.multiplayerHardening.actionIdempotentRetry
    .commandStateAfterRetry.phase.phaseId,
  "N01",
);
assert.equal(
  session.verification.multiplayerHardening.actionIdempotentRetry
    .commandStateAfterRetry.actions.length,
  0,
);
assert.equal(
  session.verification.multiplayerHardening.actionIdempotentRetry
    .apiCommandStateAfterRetry.actions.length,
  0,
);
assert.equal(
  session.verification.multiplayerHardening.actionIdempotentRetry
    .actionVisibleAfterRefresh,
  false,
);
assert.equal(
  session.verification.multiplayerHardening.staleSameActionRecovery.status,
  "passed",
);
assert.equal(
  session.verification.multiplayerHardening.staleSameActionRecovery.reject.error,
  "ActionAlreadySubmitted",
);
assert.match(
  session.verification.multiplayerHardening.staleSameActionRecovery.reject.message,
  /refresh and use current controls/,
);
assert.notEqual(
  session.verification.multiplayerHardening.staleSameActionRecovery.reject.commandId,
  session.verification.multiplayerHardening.staleSameActionRecovery.legalActionCommandId,
);
assert.equal(
  session.verification.multiplayerHardening.staleSameActionRecovery
    .commandStateAfterReject.phase.phaseId,
  "N01",
);
assert.equal(
  session.verification.multiplayerHardening.staleSameActionRecovery
    .commandStateAfterReject.actions.length,
  0,
);
assert.equal(
  session.verification.multiplayerHardening.staleSameActionRecovery
    .apiCommandStateAfterReject.actions.length,
  0,
);
assert.equal(
  session.verification.multiplayerHardening.staleSameActionRecovery
    .actionVisibleAfterRefresh,
  false,
);
assert.equal(
  session.verification.multiplayerHardening.staleDeadActionConflict.restoreAlive.state,
  "ack",
);
assert.equal(
  session.verification.multiplayerHardening.staleDeadActionConflict.apiSlotAfterRestore.alive,
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleDeadActionConflict
    .liveCommandStateAfterRestore.actorStatus,
  "alive",
);
assert.equal(
  session.verification.multiplayerHardening.staleActionConflict.status,
  "passed",
);
assert.equal(
  session.verification.multiplayerHardening.staleActionConflict.actionConfig.templateId,
  "factional_kill",
);
assert.equal(
  session.verification.multiplayerHardening.staleActionConflict.reject.error,
  "PhaseLocked",
);
assert.match(
  session.verification.multiplayerHardening.staleActionConflict.reject.message,
  /stale action state/,
);
assert.match(
  session.verification.multiplayerHardening.staleActionConflict.reject.message,
  /current action controls/,
);
assert.equal(
  session.verification.multiplayerHardening.staleActionConflict.staleN01Phase.phaseId,
  "N01",
);
assert.equal(
  session.verification.multiplayerHardening.staleActionConflict.phaseAfterReject.phaseId,
  "D02",
);
assert.equal(
  session.verification.multiplayerHardening.staleActionConflict.actionVisibleAfterRefresh,
  false,
);
assert.equal(
  session.verification.multiplayerHardening
    .privateChannelStaleActionReconnectRecovery.status,
  "passed",
);
assert.equal(
  session.verification.multiplayerHardening
    .privateChannelStaleActionReconnectRecovery.channel,
  privateChannelReconnectExpectation.channelId,
);
assert.equal(
  session.verification.multiplayerHardening
    .privateChannelStaleActionReconnectRecovery.reject.error,
  privateChannelReconnectExpectation.rejectError,
);
assert.equal(
  session.verification.multiplayerHardening
    .privateChannelStaleActionReconnectRecovery.channelContextAfterReject
    .channelId,
  privateChannelReconnectExpectation.channelId,
);
assert.equal(
  session.verification.multiplayerHardening
    .privateChannelStaleActionReconnectRecovery.reconnectAfterReject
    .reconnectCommand.command.SubmitPost.channel_id,
  privateChannelReconnectExpectation.channelId,
);
assert.equal(
  session.verification.multiplayerHardening
    .privateChannelStaleActionReconnectRecovery.reconnectChannelContext
    .channelId,
  privateChannelReconnectExpectation.channelId,
);
assert.equal(
  session.verification.multiplayerHardening
    .privateChannelStaleActionReconnectRecovery
    .privateThreadPagerVisibleAfterReconnect,
  privateChannelReconnectExpectation.privateThreadPagerVisible,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostControl.status,
  "passed",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostControl.setup.stalePhase.id,
  "N01",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostControl.setup.stalePhase.locked,
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostControl.reject.state,
  "reject",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostControl.reject.error,
  "PhaseLocked",
);
assert.match(
  session.verification.multiplayerHardening.staleHostControl.reject.message,
  /stale phase state/,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostControl.phaseAfterReject.id,
  "D02",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostControl.phaseAfterReject.locked,
  false,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostControl.activityRow.source,
  "outcome",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostControl.activityRow.actionId,
  "unlock_thread",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostControl.dispatchPlan.projectionRefreshKeys.includes(
    "host",
  ),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostControl.visibleActionsAfterReject.includes(
    "resolve_phase",
  ),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostControl.visibleActionsAfterReject.includes(
    "lock_thread",
  ),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostControl.visibleActionsAfterReject.includes(
    "unlock_thread",
  ),
  false,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostControl.apiPhaseAfterReject.phase_id,
  "D02",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostControl.apiPhaseAfterReject.locked,
  false,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostResolveRace.status,
  "passed",
);
assert(
  ["live", "concurrent"].includes(
    session.verification.multiplayerHardening.concurrentHostResolveRace.ackPageRole,
  ),
);
assert(
  ["live", "concurrent"].includes(
    session.verification.multiplayerHardening.concurrentHostResolveRace.rejectPageRole,
  ),
);
assert.notEqual(
  session.verification.multiplayerHardening.concurrentHostResolveRace.ackPageRole,
  session.verification.multiplayerHardening.concurrentHostResolveRace.rejectPageRole,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostResolveRace.ack.state,
  "ack",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostResolveRace.ack.streamSeqs.length >
    0,
  true,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostResolveRace.reject.state,
  "reject",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostResolveRace.reject.error,
  "PhaseLocked",
);
assert.match(
  session.verification.multiplayerHardening.concurrentHostResolveRace.reject.message,
  /stale phase state/,
);
assert.notEqual(
  session.verification.multiplayerHardening.concurrentHostResolveRace.ack.commandId,
  session.verification.multiplayerHardening.concurrentHostResolveRace.reject.commandId,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostResolveRace.ack.requestEnvelope.body
    .body.command.ResolvePhase.game,
  session.verification.multiplayerHardening.concurrentHostResolveRace.game,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostResolveRace.reject.requestEnvelope.body
    .body.command.ResolvePhase.game,
  session.verification.multiplayerHardening.concurrentHostResolveRace.game,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostResolveRace.livePhaseAfterRace.id,
  "D02",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostResolveRace.livePhaseAfterRace.locked,
  true,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostResolveRace.concurrentPhaseAfterRace
    .id,
  "D02",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostResolveRace.concurrentPhaseAfterRace
    .locked,
  true,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostResolveRace.apiPhaseAfterRace
    .phase_id,
  "D02",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostResolveRace.apiPhaseAfterRace.locked,
  true,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostResolveRace.roleReloadAfterRace
    .status,
  "passed",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostResolveRace.roleReloadAfterRace
    .liveRouteStatus,
  200,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostResolveRace.roleReloadAfterRace
    .concurrentRouteStatus,
  200,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostResolveRace.roleReloadAfterRace
    .livePhaseAfterReload.id,
  "D02",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostResolveRace.roleReloadAfterRace
    .livePhaseAfterReload.locked,
  true,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostResolveRace.roleReloadAfterRace
    .concurrentPhaseAfterReload.id,
  "D02",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostResolveRace.roleReloadAfterRace
    .concurrentPhaseAfterReload.locked,
  true,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostResolveRace.roleReloadAfterRace
    .livePhaseActionsAfterReload.includes("unlock_thread"),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostResolveRace.roleReloadAfterRace
    .livePhaseActionsAfterReload.includes("advance_phase"),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostResolveRace.roleReloadAfterRace
    .livePhaseActionsAfterReload.includes("resolve_phase"),
  false,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostResolveRace.roleReloadAfterRace
    .concurrentPhaseActionsAfterReload.includes("unlock_thread"),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostResolveRace.roleReloadAfterRace
    .concurrentPhaseActionsAfterReload.includes("advance_phase"),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostResolveRace.roleReloadAfterRace
    .concurrentPhaseActionsAfterReload.includes("resolve_phase"),
  false,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostResolveRace.roleReloadAfterRace
    .apiPhaseAfterReload.phase_id,
  "D02",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostResolveRace.roleReloadAfterRace
    .apiPhaseAfterReload.locked,
  true,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostResolveRace.restoreAfterRace
    .commandStatus.state,
  "ack",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostResolveRace.restoreAfterRace
    .commandStatus.requestEnvelope.body.body.command.UnlockThread.game,
  session.verification.multiplayerHardening.concurrentHostResolveRace.game,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostResolveRace.apiPhaseAfterRestore
    .phase_id,
  "D02",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostResolveRace.apiPhaseAfterRestore
    .locked,
  false,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostAdvanceRace.status,
  "passed",
);
assert(
  ["live", "concurrent"].includes(
    session.verification.multiplayerHardening.concurrentHostAdvanceRace.ackPageRole,
  ),
);
assert(
  ["live", "concurrent"].includes(
    session.verification.multiplayerHardening.concurrentHostAdvanceRace.rejectPageRole,
  ),
);
assert.notEqual(
  session.verification.multiplayerHardening.concurrentHostAdvanceRace.ackPageRole,
  session.verification.multiplayerHardening.concurrentHostAdvanceRace.rejectPageRole,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostAdvanceRace.ack.state,
  "ack",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostAdvanceRace.ack.streamSeqs.length >
    0,
  true,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostAdvanceRace.reject.state,
  "reject",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostAdvanceRace.reject.error,
  "InvalidTarget",
);
assert.match(
  session.verification.multiplayerHardening.concurrentHostAdvanceRace.reject.message,
  /stale phase state/,
);
assert.notEqual(
  session.verification.multiplayerHardening.concurrentHostAdvanceRace.ack.commandId,
  session.verification.multiplayerHardening.concurrentHostAdvanceRace.reject.commandId,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostAdvanceRace.ack.requestEnvelope.body
    .body.command.AdvancePhase.game,
  session.verification.multiplayerHardening.concurrentHostAdvanceRace.game,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostAdvanceRace.reject.requestEnvelope.body
    .body.command.AdvancePhase.game,
  session.verification.multiplayerHardening.concurrentHostAdvanceRace.game,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostAdvanceRace.livePhaseAfterRace.id,
  "N02",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostAdvanceRace.livePhaseAfterRace.locked,
  false,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostAdvanceRace.concurrentPhaseAfterRace
    .id,
  "N02",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostAdvanceRace.concurrentPhaseAfterRace
    .locked,
  false,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostAdvanceRace.apiPhaseAfterRace
    .phase_id,
  "N02",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostAdvanceRace.apiPhaseAfterRace.locked,
  false,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostAdvanceRace.roleReloadAfterRace
    .status,
  "passed",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostAdvanceRace.roleReloadAfterRace
    .liveRouteStatus,
  200,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostAdvanceRace.roleReloadAfterRace
    .concurrentRouteStatus,
  200,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostAdvanceRace.roleReloadAfterRace
    .livePhaseAfterReload.id,
  "N02",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostAdvanceRace.roleReloadAfterRace
    .livePhaseAfterReload.locked,
  false,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostAdvanceRace.roleReloadAfterRace
    .concurrentPhaseAfterReload.id,
  "N02",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostAdvanceRace.roleReloadAfterRace
    .concurrentPhaseAfterReload.locked,
  false,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostAdvanceRace.roleReloadAfterRace
    .livePhaseActionsAfterReload.includes("resolve_phase"),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostAdvanceRace.roleReloadAfterRace
    .livePhaseActionsAfterReload.includes("lock_thread"),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostAdvanceRace.roleReloadAfterRace
    .livePhaseActionsAfterReload.includes("advance_phase"),
  false,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostAdvanceRace.roleReloadAfterRace
    .concurrentPhaseActionsAfterReload.includes("resolve_phase"),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostAdvanceRace.roleReloadAfterRace
    .concurrentPhaseActionsAfterReload.includes("lock_thread"),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostAdvanceRace.roleReloadAfterRace
    .concurrentPhaseActionsAfterReload.includes("advance_phase"),
  false,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostAdvanceRace.roleReloadAfterRace
    .apiPhaseAfterReload.phase_id,
  "N02",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostAdvanceRace.roleReloadAfterRace
    .apiPhaseAfterReload.locked,
  false,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostDeadlineAdvanceRace.status,
  "passed",
);
assert(
  ["live", "concurrent"].includes(
    session.verification.multiplayerHardening.concurrentHostDeadlineAdvanceRace.ackPageRole,
  ),
);
assert(
  ["live", "concurrent"].includes(
    session.verification.multiplayerHardening.concurrentHostDeadlineAdvanceRace.rejectPageRole,
  ),
);
assert.notEqual(
  session.verification.multiplayerHardening.concurrentHostDeadlineAdvanceRace.ackPageRole,
  session.verification.multiplayerHardening.concurrentHostDeadlineAdvanceRace.rejectPageRole,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostDeadlineAdvanceRace.setup.stalePhase
    .id,
  "D01",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostDeadlineAdvanceRace.setup.stalePhase
    .locked,
  true,
);
assert.equal(
  typeof session.verification.multiplayerHardening.concurrentHostDeadlineAdvanceRace.setup
    .stalePhase.deadline,
  "number",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostDeadlineAdvanceRace.ack.state,
  "ack",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostDeadlineAdvanceRace.ack.streamSeqs
    .length,
  2,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostDeadlineAdvanceRace.reject.state,
  "reject",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostDeadlineAdvanceRace.reject.error,
  "InvalidTarget",
);
assert.match(
  session.verification.multiplayerHardening.concurrentHostDeadlineAdvanceRace.reject.message,
  /deadline target is stale/,
);
assert.notEqual(
  session.verification.multiplayerHardening.concurrentHostDeadlineAdvanceRace.ack.commandId,
  session.verification.multiplayerHardening.concurrentHostDeadlineAdvanceRace.reject.commandId,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostDeadlineAdvanceRace.ack.requestEnvelope
    .body.body.command.AdvancePhaseByDeadline.game,
  session.verification.multiplayerHardening.concurrentHostDeadlineAdvanceRace.game,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostDeadlineAdvanceRace.ack.requestEnvelope
    .body.body.command.AdvancePhaseByDeadline.phase,
  "D01",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostDeadlineAdvanceRace.ack.requestEnvelope
    .body.body.command.AdvancePhaseByDeadline.observed_at,
  session.verification.multiplayerHardening.concurrentHostDeadlineAdvanceRace.setup.stalePhase
    .deadline + 1,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostDeadlineAdvanceRace.reject
    .requestEnvelope.body.body.command.AdvancePhaseByDeadline.game,
  session.verification.multiplayerHardening.concurrentHostDeadlineAdvanceRace.game,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostDeadlineAdvanceRace.reject
    .requestEnvelope.body.body.command.AdvancePhaseByDeadline.phase,
  "D01",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostDeadlineAdvanceRace.reject
    .requestEnvelope.body.body.command.AdvancePhaseByDeadline.observed_at,
  session.verification.multiplayerHardening.concurrentHostDeadlineAdvanceRace.setup.stalePhase
    .deadline + 1,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostDeadlineAdvanceRace.livePhaseAfterRace
    .id,
  "N01",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostDeadlineAdvanceRace.livePhaseAfterRace
    .locked,
  false,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostDeadlineAdvanceRace.livePhaseAfterRace
    .deadline,
  null,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostDeadlineAdvanceRace
    .concurrentPhaseAfterRace.id,
  "N01",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostDeadlineAdvanceRace
    .concurrentPhaseAfterRace.locked,
  false,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostDeadlineAdvanceRace
    .concurrentPhaseAfterRace.deadline,
  null,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostDeadlineAdvanceRace.apiPhaseAfterRace
    .phase_id,
  "N01",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostDeadlineAdvanceRace.apiPhaseAfterRace
    .locked,
  false,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostDeadlineAdvanceRace.apiPhaseAfterRace
    .deadline,
  null,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostDeadlineAdvanceRace
    .roleReloadAfterRace.status,
  "passed",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostDeadlineAdvanceRace
    .roleReloadAfterRace.liveRouteStatus,
  200,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostDeadlineAdvanceRace
    .roleReloadAfterRace.concurrentRouteStatus,
  200,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostDeadlineAdvanceRace
    .roleReloadAfterRace.livePhaseAfterReload.id,
  "N01",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostDeadlineAdvanceRace
    .roleReloadAfterRace.livePhaseAfterReload.locked,
  false,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostDeadlineAdvanceRace
    .roleReloadAfterRace.livePhaseAfterReload.deadline,
  null,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostDeadlineAdvanceRace
    .roleReloadAfterRace.concurrentPhaseAfterReload.id,
  "N01",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostDeadlineAdvanceRace
    .roleReloadAfterRace.concurrentPhaseAfterReload.locked,
  false,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostDeadlineAdvanceRace
    .roleReloadAfterRace.concurrentPhaseAfterReload.deadline,
  null,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostDeadlineAdvanceRace
    .roleReloadAfterRace.livePhaseActionsAfterReload.includes("resolve_phase"),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostDeadlineAdvanceRace
    .roleReloadAfterRace.livePhaseActionsAfterReload.includes("lock_thread"),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostDeadlineAdvanceRace
    .roleReloadAfterRace.livePhaseActionsAfterReload.includes(
      "advance_phase_by_deadline",
    ),
  false,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostDeadlineAdvanceRace
    .roleReloadAfterRace.concurrentPhaseActionsAfterReload.includes("resolve_phase"),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostDeadlineAdvanceRace
    .roleReloadAfterRace.concurrentPhaseActionsAfterReload.includes("lock_thread"),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostDeadlineAdvanceRace
    .roleReloadAfterRace.concurrentPhaseActionsAfterReload.includes(
      "advance_phase_by_deadline",
    ),
  false,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostDeadlineAdvanceRace
    .roleReloadAfterRace.apiPhaseAfterReload.phase_id,
  "N01",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostDeadlineAdvanceRace
    .roleReloadAfterRace.apiPhaseAfterReload.locked,
  false,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostDeadlineAdvanceRace
    .roleReloadAfterRace.apiPhaseAfterReload.deadline,
  null,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace.status,
  "passed",
);
assert(
  ["normal", "deadline"].includes(
    session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace.ackRaceRole,
  ),
);
assert(
  ["normal", "deadline"].includes(
    session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace.rejectRaceRole,
  ),
);
assert.notEqual(
  session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace.ackRaceRole,
  session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace.rejectRaceRole,
);
assert(
  ["advance_phase", "advance_phase_by_deadline"].includes(
    session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace.ackActionId,
  ),
);
assert(
  ["advance_phase", "advance_phase_by_deadline"].includes(
    session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace.rejectActionId,
  ),
);
assert.notEqual(
  session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace.ackActionId,
  session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace.rejectActionId,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace.setup.stalePhase.id,
  "D01",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace.setup.stalePhase.locked,
  true,
);
assert.equal(
  typeof session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace.setup.stalePhase
    .deadline,
  "number",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace.ack.state,
  "ack",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace.ack.streamSeqs
    .length,
  session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace.ackActionId ===
    "advance_phase"
    ? 1
    : 2,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace.reject.state,
  "reject",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace.reject.error,
  "InvalidTarget",
);
if (
  session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace.rejectActionId ===
  "advance_phase"
) {
  assert.match(
    session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace.reject.message,
    /stale phase state/,
  );
} else {
  assert.match(
    session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace.reject.message,
    /deadline target is stale/,
  );
}
assert.notEqual(
  session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace.ack.commandId,
  session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace.reject.commandId,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace.normalOutcome
    .requestEnvelope.body.body.command.AdvancePhase.game,
  session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace.game,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace.deadlineOutcome
    .requestEnvelope.body.body.command.AdvancePhaseByDeadline.game,
  session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace.game,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace.deadlineOutcome
    .requestEnvelope.body.body.command.AdvancePhaseByDeadline.phase,
  "D01",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace.deadlineOutcome
    .requestEnvelope.body.body.command.AdvancePhaseByDeadline.observed_at,
  session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace.setup.stalePhase
    .deadline + 1,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace.normalPhaseAfterRace.id,
  "N01",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace.normalPhaseAfterRace
    .locked,
  false,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace.normalPhaseAfterRace
    .deadline,
  null,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace.deadlinePhaseAfterRace
    .id,
  "N01",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace.deadlinePhaseAfterRace
    .locked,
  false,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace.deadlinePhaseAfterRace
    .deadline,
  null,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace.apiPhaseAfterRace
    .phase_id,
  "N01",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace.apiPhaseAfterRace
    .locked,
  false,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace.apiPhaseAfterRace
    .deadline,
  null,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace
    .roleReloadAfterRace.status,
  "passed",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace
    .roleReloadAfterRace.normalRouteStatus,
  200,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace
    .roleReloadAfterRace.deadlineRouteStatus,
  200,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace
    .roleReloadAfterRace.normalPhaseAfterReload.id,
  "N01",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace
    .roleReloadAfterRace.normalPhaseAfterReload.locked,
  false,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace
    .roleReloadAfterRace.normalPhaseAfterReload.deadline,
  null,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace
    .roleReloadAfterRace.deadlinePhaseAfterReload.id,
  "N01",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace
    .roleReloadAfterRace.deadlinePhaseAfterReload.locked,
  false,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace
    .roleReloadAfterRace.deadlinePhaseAfterReload.deadline,
  null,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace
    .roleReloadAfterRace.normalPhaseActionsAfterReload.includes("resolve_phase"),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace
    .roleReloadAfterRace.normalPhaseActionsAfterReload.includes("lock_thread"),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace
    .roleReloadAfterRace.normalPhaseActionsAfterReload.includes("advance_phase"),
  false,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace
    .roleReloadAfterRace.normalPhaseActionsAfterReload.includes(
      "advance_phase_by_deadline",
    ),
  false,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace
    .roleReloadAfterRace.deadlinePhaseActionsAfterReload.includes("resolve_phase"),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace
    .roleReloadAfterRace.deadlinePhaseActionsAfterReload.includes("lock_thread"),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace
    .roleReloadAfterRace.deadlinePhaseActionsAfterReload.includes("advance_phase"),
  false,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace
    .roleReloadAfterRace.deadlinePhaseActionsAfterReload.includes(
      "advance_phase_by_deadline",
    ),
  false,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace
    .roleReloadAfterRace.apiPhaseAfterReload.phase_id,
  "N01",
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace
    .roleReloadAfterRace.apiPhaseAfterReload.locked,
  false,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentHostMixedAdvanceRace
    .roleReloadAfterRace.apiPhaseAfterReload.deadline,
  null,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostResolve.status,
  "passed",
);
assert.match(
  session.verification.multiplayerHardening.staleHostResolve.setup.roleUrl,
  new RegExp(`/g/${session.game}/host`),
);
assert.equal(
  session.verification.multiplayerHardening.staleHostResolve.staleClickBrowserProof
    .roleUrl,
  session.verification.multiplayerHardening.staleHostResolve.setup.roleUrl,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostResolve.staleClickBrowserProof
    .clickedActionId,
  "resolve_phase",
);
assert.match(
  session.verification.multiplayerHardening.staleHostResolve.staleClickBrowserProof
    .receiptStatusText,
  /Reject PhaseLocked/,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostResolve.staleClickBrowserProof
    .dispatchRefreshKeys.includes("host"),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostResolve.staleClickBrowserProof
    .phaseActionsAfterReject.includes("unlock_thread"),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostResolve.staleClickBrowserProof
    .phaseActionsAfterReject.includes("advance_phase"),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostResolve.staleClickBrowserProof
    .phaseActionsAfterReject.includes("resolve_phase"),
  false,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostResolve.setup.stalePhase.id,
  "D02",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostResolve.setup.stalePhase.locked,
  false,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostResolve.setup.phaseActions.includes(
    "resolve_phase",
  ),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostResolve.setup.phaseActions.includes(
    "lock_thread",
  ),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostResolve.liveResolve.commandStatus.state,
  "ack",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostResolve.liveResolve.commandStatus.streamSeqs
    .length > 0,
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostResolve.reject.state,
  "reject",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostResolve.reject.error,
  "PhaseLocked",
);
assert.match(
  session.verification.multiplayerHardening.staleHostResolve.reject.message,
  /stale phase state/,
);
assert.equal(
  Array.isArray(
    session.verification.multiplayerHardening.staleHostResolve.reject.streamSeqs,
  ),
  false,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostResolve.phaseAfterReject.id,
  "D02",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostResolve.phaseAfterReject.locked,
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostResolve.phaseActionsAfterReject.includes(
    "unlock_thread",
  ),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostResolve.phaseActionsAfterReject.includes(
    "advance_phase",
  ),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostResolve.phaseActionsAfterReject.includes(
    "resolve_phase",
  ),
  false,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostResolve.activityRow.actionId,
  "resolve_phase",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostResolve.dispatchPlan.projectionRefreshKeys.includes(
    "host",
  ),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostResolve.apiPhaseAfterReject.phase_id,
  "D02",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostResolve.apiPhaseAfterReject.locked,
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostResolve
    .staleHostResolveReloadAfterReject.status,
  "passed",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostResolve
    .staleHostResolveReloadAfterReject.routeResponseStatus,
  200,
);
assert.match(
  session.verification.multiplayerHardening.staleHostResolve
    .staleHostResolveReloadAfterReject.rejectReceiptStatusText,
  /Reject PhaseLocked/,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostResolve
    .staleHostResolveReloadAfterReject.phaseAfterReload.id,
  "D02",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostResolve
    .staleHostResolveReloadAfterReject.phaseAfterReload.locked,
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostResolve
    .staleHostResolveReloadAfterReject.phaseActionsAfterReload.includes(
      "unlock_thread",
    ),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostResolve
    .staleHostResolveReloadAfterReject.phaseActionsAfterReload.includes(
      "advance_phase",
    ),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostResolve
    .staleHostResolveReloadAfterReject.phaseActionsAfterReload.includes(
      "resolve_phase",
    ),
  false,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostResolve
    .staleHostResolveReloadAfterReject.phaseActionsAfterReload.includes(
      "lock_thread",
    ),
  false,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostResolve
    .staleHostResolveReloadAfterReject.deadlineActionsAfterReload.includes(
      "extend_deadline",
    ),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostResolve
    .staleHostResolveReloadAfterReject.apiPhaseAfterReload.phase_id,
  "D02",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostResolve
    .staleHostResolveReloadAfterReject.apiPhaseAfterReload.locked,
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostResolve.restoreAfterReject.commandStatus
    .state,
  "ack",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostResolve.apiPhaseAfterRestore.phase_id,
  "D02",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostResolve.apiPhaseAfterRestore.locked,
  false,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostAdvance.status,
  "passed",
);
assert.match(
  session.verification.multiplayerHardening.staleHostAdvance.setup.roleUrl,
  new RegExp(`/g/${session.game}/host`),
);
assert.equal(
  session.verification.multiplayerHardening.staleHostAdvance.staleClickBrowserProof
    .roleUrl,
  session.verification.multiplayerHardening.staleHostAdvance.setup.roleUrl,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostAdvance.staleClickBrowserProof
    .clickedActionId,
  "advance_phase",
);
assert.match(
  session.verification.multiplayerHardening.staleHostAdvance.staleClickBrowserProof
    .receiptStatusText,
  /Reject InvalidTarget/,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostAdvance.staleClickBrowserProof
    .dispatchRefreshKeys.includes("host"),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostAdvance.staleClickBrowserProof
    .phaseActionsAfterReject.includes("resolve_phase"),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostAdvance.staleClickBrowserProof
    .phaseActionsAfterReject.includes("lock_thread"),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostAdvance.staleClickBrowserProof
    .phaseActionsAfterReject.includes("advance_phase"),
  false,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostAdvance.setup.stalePhase.id,
  "D02",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostAdvance.setup.stalePhase.locked,
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostAdvance.setup.phaseActions.includes(
    "advance_phase",
  ),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostAdvance.setup.phaseActions.includes(
    "unlock_thread",
  ),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostAdvance.liveUnlock.commandStatus.state,
  "ack",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostAdvance.liveUnlock.commandStatus.streamSeqs
    .length > 0,
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostAdvance.reject.state,
  "reject",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostAdvance.reject.error,
  "InvalidTarget",
);
assert.match(
  session.verification.multiplayerHardening.staleHostAdvance.reject.message,
  /stale phase state/,
);
assert.equal(
  Array.isArray(
    session.verification.multiplayerHardening.staleHostAdvance.reject.streamSeqs,
  ),
  false,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostAdvance.phaseAfterReject.id,
  "D02",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostAdvance.phaseAfterReject.locked,
  false,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostAdvance.phaseActionsAfterReject.includes(
    "resolve_phase",
  ),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostAdvance.phaseActionsAfterReject.includes(
    "lock_thread",
  ),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostAdvance.phaseActionsAfterReject.includes(
    "advance_phase",
  ),
  false,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostAdvance.activityRow.actionId,
  "advance_phase",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostAdvance.dispatchPlan.projectionRefreshKeys.includes(
    "host",
  ),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostAdvance.apiPhaseAfterReject.phase_id,
  "D02",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostAdvance.apiPhaseAfterReject.locked,
  false,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostAdvance
    .staleHostAdvanceReloadAfterReject.status,
  "passed",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostAdvance
    .staleHostAdvanceReloadAfterReject.routeResponseStatus,
  200,
);
assert.match(
  session.verification.multiplayerHardening.staleHostAdvance
    .staleHostAdvanceReloadAfterReject.rejectReceiptStatusText,
  /Reject InvalidTarget/,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostAdvance
    .staleHostAdvanceReloadAfterReject.phaseAfterReload.id,
  "D02",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostAdvance
    .staleHostAdvanceReloadAfterReject.phaseAfterReload.locked,
  false,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostAdvance
    .staleHostAdvanceReloadAfterReject.phaseActionsAfterReload.includes(
      "resolve_phase",
    ),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostAdvance
    .staleHostAdvanceReloadAfterReject.phaseActionsAfterReload.includes(
      "lock_thread",
    ),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostAdvance
    .staleHostAdvanceReloadAfterReject.phaseActionsAfterReload.includes(
      "advance_phase",
    ),
  false,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostAdvance
    .staleHostAdvanceReloadAfterReject.deadlineActionsAfterReload.includes(
      "extend_deadline",
    ),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostAdvance
    .staleHostAdvanceReloadAfterReject.apiPhaseAfterReload.phase_id,
  "D02",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostAdvance
    .staleHostAdvanceReloadAfterReject.apiPhaseAfterReload.locked,
  false,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostDeadline.status,
  "passed",
);
assert.match(
  session.verification.multiplayerHardening.staleHostDeadline.setup.roleUrl,
  new RegExp(`/g/${session.game}/host`),
);
assert.equal(
  session.verification.multiplayerHardening.staleHostDeadline.staleClickBrowserProof
    .roleUrl,
  session.verification.multiplayerHardening.staleHostDeadline.setup.roleUrl,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostDeadline.staleClickBrowserProof
    .clickedActionId,
  "extend_deadline",
);
assert.match(
  session.verification.multiplayerHardening.staleHostDeadline.staleClickBrowserProof
    .receiptStatusText,
  /Reject PhaseLocked/,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostDeadline.staleClickBrowserProof
    .dispatchRefreshKeys.includes("host"),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostDeadline.staleClickBrowserProof
    .deadlineActionsAfterReject.includes("extend_deadline"),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostDeadline.staleClickBrowserProof
    .phaseActionsAfterReject.includes("resolve_phase"),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostDeadline.staleClickBrowserProof
    .phaseActionsAfterReject.includes("lock_thread"),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostDeadline.staleClickBrowserProof
    .apiPhaseAfterReject.deadline,
  null,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostDeadline.setup.stalePhase.id,
  "D01",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostDeadline.setup.stalePhase.locked,
  false,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostDeadline.setup.deadlineActions.includes(
    "extend_deadline",
  ),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostDeadline.setup.phaseActions.includes(
    "resolve_phase",
  ),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostDeadline.setup.phaseActions.includes(
    "lock_thread",
  ),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostDeadline.reject.state,
  "reject",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostDeadline.reject.error,
  "PhaseLocked",
);
assert.match(
  session.verification.multiplayerHardening.staleHostDeadline.reject.message,
  /stale phase state/,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostDeadline.phaseAfterReject.id,
  "D02",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostDeadline.phaseAfterReject.locked,
  false,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostDeadline.deadlineActionsAfterReject.includes(
    "extend_deadline",
  ),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostDeadline.phaseActionsAfterReject.includes(
    "resolve_phase",
  ),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostDeadline.phaseActionsAfterReject.includes(
    "lock_thread",
  ),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostDeadline.activityRow.source,
  "outcome",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostDeadline.activityRow.actionId,
  "extend_deadline",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostDeadline.dispatchPlan.projectionRefreshKeys.includes(
    "host",
  ),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostDeadline.apiPhaseAfterReject.phase_id,
  "D02",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostDeadline.apiPhaseAfterReject.locked,
  false,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostDeadline.apiPhaseAfterReject.deadline,
  null,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostDeadline
    .staleHostDeadlineReloadAfterReject.status,
  "passed",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostDeadline
    .staleHostDeadlineReloadAfterReject.routeResponseStatus,
  200,
);
assert.match(
  session.verification.multiplayerHardening.staleHostDeadline
    .staleHostDeadlineReloadAfterReject.rejectReceiptStatusText,
  /Reject PhaseLocked/,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostDeadline
    .staleHostDeadlineReloadAfterReject.phaseAfterReload.id,
  "D02",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostDeadline
    .staleHostDeadlineReloadAfterReject.phaseAfterReload.locked,
  false,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostDeadline
    .staleHostDeadlineReloadAfterReject.deadlineActionsAfterReload.includes(
      "extend_deadline",
    ),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostDeadline
    .staleHostDeadlineReloadAfterReject.phaseActionsAfterReload.includes(
      "resolve_phase",
    ),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostDeadline
    .staleHostDeadlineReloadAfterReject.phaseActionsAfterReload.includes(
      "lock_thread",
    ),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostDeadline
    .staleHostDeadlineReloadAfterReject.apiPhaseAfterReload.phase_id,
  "D02",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostDeadline
    .staleHostDeadlineReloadAfterReject.apiPhaseAfterReload.locked,
  false,
);
assert.equal(
  session.verification.multiplayerHardening.staleHostDeadline
    .staleHostDeadlineReloadAfterReject.apiPhaseAfterReload.deadline,
  null,
);
assert.equal(
  session.verification.multiplayerHardening.staleCohostDeadline.status,
  "passed",
);
assert.match(
  session.verification.multiplayerHardening.staleCohostDeadline.setup.roleUrl,
  new RegExp(`/g/${session.game}/host`),
);
assert.equal(
  session.verification.multiplayerHardening.staleCohostDeadline.staleClickBrowserProof
    .roleUrl,
  session.verification.multiplayerHardening.staleCohostDeadline.setup.roleUrl,
);
assert.equal(
  session.verification.multiplayerHardening.staleCohostDeadline.staleClickBrowserProof
    .clickedActionId,
  "extend_deadline",
);
assert.match(
  session.verification.multiplayerHardening.staleCohostDeadline.staleClickBrowserProof
    .receiptStatusText,
  /Reject PhaseLocked/,
);
assert.equal(
  session.verification.multiplayerHardening.staleCohostDeadline.staleClickBrowserProof
    .dispatchRefreshKeys.includes("host"),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleCohostDeadline.staleClickBrowserProof
    .deadlineActionsAfterReject.includes("extend_deadline"),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleCohostDeadline.staleClickBrowserProof
    .phaseActionsAfterReject.length,
  0,
);
assert.equal(
  session.verification.multiplayerHardening.staleCohostDeadline.staleClickBrowserProof
    .apiPhaseAfterReject.deadline,
  null,
);
assert.equal(
  session.verification.multiplayerHardening.staleCohostDeadline.setup.stalePhase.id,
  "D01",
);
assert.equal(
  session.verification.multiplayerHardening.staleCohostDeadline.setup.stalePhase.locked,
  false,
);
assert.equal(
  session.verification.multiplayerHardening.staleCohostDeadline.setup.deadlineActions.includes(
    "extend_deadline",
  ),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleCohostDeadline.setup.phaseActions.length,
  0,
);
assert.equal(
  session.verification.multiplayerHardening.staleCohostDeadline.reject.state,
  "reject",
);
assert.equal(
  session.verification.multiplayerHardening.staleCohostDeadline.reject.error,
  "PhaseLocked",
);
assert.match(
  session.verification.multiplayerHardening.staleCohostDeadline.reject.message,
  /stale phase state/,
);
assert.equal(
  session.verification.multiplayerHardening.staleCohostDeadline.phaseAfterReject.id,
  "D02",
);
assert.equal(
  session.verification.multiplayerHardening.staleCohostDeadline.phaseAfterReject.locked,
  false,
);
assert.equal(
  session.verification.multiplayerHardening.staleCohostDeadline.deadlineActionsAfterReject.includes(
    "extend_deadline",
  ),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleCohostDeadline.phaseActionsAfterReject.length,
  0,
);
assert.equal(
  session.verification.multiplayerHardening.staleCohostDeadline.activityRow.source,
  "outcome",
);
assert.equal(
  session.verification.multiplayerHardening.staleCohostDeadline.activityRow.actionId,
  "extend_deadline",
);
assert.equal(
  session.verification.multiplayerHardening.staleCohostDeadline.dispatchPlan.projectionRefreshKeys.includes(
    "host",
  ),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleCohostDeadline.apiPhaseAfterReject.phase_id,
  "D02",
);
assert.equal(
  session.verification.multiplayerHardening.staleCohostDeadline.apiPhaseAfterReject.locked,
  false,
);
assert.equal(
  session.verification.multiplayerHardening.staleCohostDeadline.apiPhaseAfterReject.deadline,
  null,
);
assert.equal(
  session.verification.multiplayerHardening.staleCohostDeadline
    .staleCohostDeadlineReloadAfterReject.status,
  "passed",
);
assert.equal(
  session.verification.multiplayerHardening.staleCohostDeadline
    .staleCohostDeadlineReloadAfterReject.routeResponseStatus,
  200,
);
assert.match(
  session.verification.multiplayerHardening.staleCohostDeadline
    .staleCohostDeadlineReloadAfterReject.rejectReceiptStatusText,
  /Reject PhaseLocked/,
);
assert.equal(
  session.verification.multiplayerHardening.staleCohostDeadline
    .staleCohostDeadlineReloadAfterReject.phaseAfterReload.id,
  "D02",
);
assert.equal(
  session.verification.multiplayerHardening.staleCohostDeadline
    .staleCohostDeadlineReloadAfterReject.phaseAfterReload.locked,
  false,
);
assert.equal(
  session.verification.multiplayerHardening.staleCohostDeadline
    .staleCohostDeadlineReloadAfterReject.deadlineActionsAfterReload.includes(
      "extend_deadline",
    ),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.staleCohostDeadline
    .staleCohostDeadlineReloadAfterReject.phaseActionsAfterReload.length,
  0,
);
assert.equal(
  session.verification.multiplayerHardening.staleCohostDeadline
    .staleCohostDeadlineReloadAfterReject.apiPhaseAfterReload.phase_id,
  "D02",
);
assert.equal(
  session.verification.multiplayerHardening.staleCohostDeadline
    .staleCohostDeadlineReloadAfterReject.apiPhaseAfterReload.locked,
  false,
);
assert.equal(
  session.verification.multiplayerHardening.staleCohostDeadline
    .staleCohostDeadlineReloadAfterReject.apiPhaseAfterReload.deadline,
  null,
);

console.log(`dev test-game live proof passed for ${session.game}`);

async function run(command, args) {
  const child = spawn(command, args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
    },
    stdio: "inherit",
  });
  return await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}
