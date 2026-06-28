import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sessionPath = path.join(repoRoot, "target", "dev-test-game", "session.json");
const proofRunPath = path.join(repoRoot, "target", "dev-test-game", "proof-run.json");
const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://fmarch:fmarch@localhost:5544/fmarch";

const exitCode = await run("npm", [
  "run",
  "dev:test-game",
  "--",
  "--name",
  "live-proof",
  "--reset",
  "--verify",
  "--no-keepalive",
]);
if (exitCode !== 0) {
  process.exit(exitCode);
}

const session = JSON.parse(await readFile(sessionPath, "utf8"));
const proofRun = JSON.parse(await readFile(proofRunPath, "utf8"));
assert.equal(session.status, "ready");
assert.equal(session.name, "live-proof");
assert.equal(session.seedMode, "seeded");
assert.equal(session.seedCommandCount, 22);
assert.equal(session.verification?.status, "passed");
assert.equal(session.artifacts.proofRun, "target/dev-test-game/proof-run.json");
assert.equal(proofRun.proof, "dev-test-game-proof-run");
assert.equal(proofRun.status, "passed");
assert.equal(proofRun.session.game, session.game);
assert.equal(proofRun.productionReady, false);
assert.equal(proofRun.releaseReady, false);
assert.equal(
  proofRun.lanes.every((lane) => lane.status === "passed"),
  true,
);
assert.deepEqual(session.verification.roles, [
  "host",
  "player",
  "actionPlayer",
  "deniedPlayer",
  "cohost",
]);
assert.match(session.frontendBaseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
assert.match(session.apiBaseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
for (const role of ["admin", "cohost", "host", "player", "actionPlayer", "deniedPlayer"]) {
  assert.equal(typeof session.sessions[role]?.token, "string", `${role} token`);
  assert.equal(session.sessions[role].credentialKind, "invite", `${role} credential kind`);
  assert.equal(session.sessions[role].inviteToken, session.sessions[role].token);
  assert.match(session.sessions[role].loginUrl, /\/auth\/login\?returnTo=.*&invite=/);
}
assert.equal(
  session.verification.sessions.host.capabilityKinds.includes("HostOf"),
  true,
);
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
assert.equal(session.verification.coreLoop.status, "passed");
assert.equal(session.verification.coreLoop.lock.commandStatus.state, "ack");
assert.equal(session.verification.coreLoop.rejectedVote.state, "reject");
assert.equal(session.verification.coreLoop.rejectedVote.error, "PhaseLocked");
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
assert.equal(session.verification.actionLoop.status, "passed");
assert.equal(session.verification.actionLoop.resolveDay.commandStatus.state, "ack");
assert.equal(session.verification.actionLoop.advanceNight.commandStatus.state, "ack");
assert.equal(session.verification.actionLoop.n01Phase.phaseId, "N01");
assert.equal(session.verification.actionLoop.invalidAction.state, "reject");
assert.equal(session.verification.actionLoop.invalidAction.error, "InvalidTarget");
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
  /stale projection/,
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
  session.verification.multiplayerHardening.concurrentVoteRace.targetSlot,
  "slot_5",
);
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
    (row) => row.target === "slot_5" && row.count === 2,
  ),
  true,
);
assert.equal(
  session.verification.multiplayerHardening.concurrentVoteRace.actionProjection.some(
    (row) => row.target === "slot_5" && row.count === 2,
  ),
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
  session.verification.multiplayerHardening.staleHostControl.phaseAfterReject.phase_id,
  "D02",
);
assert.equal(
  session.verification.multiplayerHardening.staleHostControl.phaseAfterReject.locked,
  false,
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
