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
  "replacementPlayer",
]);
assert.match(session.frontendBaseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
assert.match(session.apiBaseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
for (const role of [
  "admin",
  "cohost",
  "host",
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
assert.match(
  session.verification.invalidActionRecovery.receiptStatusText,
  /Reject InvalidTarget/,
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
assert.equal(session.verification.deadPlayerRecovery.disabledControls.vote, true);
assert.equal(session.verification.deadPlayerRecovery.disabledControls.withdraw, true);
assert.equal(session.verification.deadPlayerRecovery.disabledControls.post, true);
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
  session.verification.multiplayerHardening.staleCohostDeadline.status,
  "passed",
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
