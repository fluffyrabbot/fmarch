import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  completedGameHardeningLaneCases,
  completedGameHardeningLaneIds,
} from "./dev_test_game_core_loop_completed_game_proof_readiness_contract.mjs";
import {
  crossRoleRaceLaneIds,
} from "./dev_test_game_cross_role_race_scenarios.mjs";
import {
  coreLoopCompletedGameHardeningLaneDescriptors,
} from "./dev_test_game_core_loop_completed_endgame_progression_scenarios.mjs";
import {
  assertHostStaleControlCoverageSummary,
  buildHostStaleControlCoverageSummary,
  cohostDeadlineRecoveryLaneIds,
  cohostDeadlineStaleControlCases,
  hostGenericStaleControlLaneIds,
  hostPhaseStaleControlCases,
  hostPhaseStaleRecoveryLaneIds,
  hostPromptStaleControlLaneIds,
  hostRaceReloadLaneIds,
  hostStandaloneStaleControlLaneIds,
  hostStaleAdvanceControlLaneId,
  hostStaleReconnectExpectationForLane,
  hostStaleResolveControlLaneId,
} from "./dev_test_game_host_stale_recovery_scenarios.mjs";
import {
  privateChannelStaleActionReconnectExpectation,
  privateChannelStaleActionReconnectLaneId,
  stalePlayerActionReconnectExpectation,
  stalePlayerActionReconnectLaneId,
} from "./dev_test_game_hardening_recovery_scenarios.mjs";
import {
  hostAdvanceByDeadlineCommandFacts,
  hostAdvancePhaseCommandFacts,
  hostExtendDeadlineCommandFacts,
  hostLockThreadCommandFacts,
  hostResolvePhaseCommandFacts,
  hostUnlockThreadCommandFacts,
} from "./dev_test_game_core_loop_host_phase_scenarios.mjs";
import {
  playerActionBoundaryLaneId,
  playerActionLoopLaneId,
  playerInvalidActionRecoveryMessage,
  playerInvalidActionRecoveryLaneId,
  playerStaleActionTransitionRecoveryHookId,
  playerStaleVoteTransitionRecoveryHookId,
} from "./dev_test_game_core_loop_action_scenarios.mjs";
import {
  coreLoopPhaseProgressionLaneIds,
  coreLoopPhaseProgressionSpineSourceLaneIds,
  nightThreeActionResolutionLaneId,
} from "./dev_test_game_core_loop_phase_progression_scenarios.mjs";
import {
  cohostDeadlineStaleBasePassed,
  cohostDeadlineStaleReconnectPassed,
  cohostDeadlineStaleReloadPassed,
  hostPhaseStaleBasePassed,
  hostPhaseStaleReconnectPassed,
  hostPhaseStaleReloadPassed,
} from "./dev_test_game_host_stale_command_assertions.mjs";
import {
  playerActionConflictRecoveryLaneIds,
  playerActionFoundationLaneIds,
  stalePlayerCommandLaneIds,
} from "./dev_test_game_player_recovery_scenarios.mjs";
import {
  assertStaleConflictMessageCoverageSummary,
  buildStaleConflictMessageCoverageSummary,
  staleConflictMessageLaneIds,
} from "./dev_test_game_hardening_recovery_scenarios.mjs";
import {
  assertReplacementActionRecoveryCoverageSummary,
  buildReplacementActionRecoveryCoverageSummary,
  replacementActionLaneIds,
  replacementActionReconnectScenario,
  replacementIncomingActionScenario,
  replacementStaleActionAfterResolveScenario,
} from "./dev_test_game_replacement_action_scenario_cases.mjs";
import {
  assertReplacementHandoffRecoveryCoverageSummary,
  buildReplacementHandoffRecoveryCoverageSummary,
} from "./dev_test_game_replacement_handoff_scenario_cases.mjs";
import {
  ackedReplacementCommandMatches,
  replacementCommandEnvelopeMatches,
  replacementCurrentOwnerMatches,
  staleOutgoingCommandStateForbidden,
} from "./dev_test_game_replacement_assertions.mjs";
import {
  staleActionRejectRecoveryMatches,
} from "./dev_test_game_stale_action_recovery_assertions.mjs";
import {
  stalePlayerVoteAfterChangeAckMatches,
  stalePlayerPhaseClosurePostAckMatches,
  stalePlayerPhaseClosureRejectMatches,
  stalePlayerWithdrawAfterChangeAckMatches,
} from "./dev_test_game_stale_player_command_assertions.mjs";
import {
  assertReplacementPrivateChannelRecoveryCoverageSummary,
  buildReplacementPrivateChannelRecoveryCoverageSummary,
  replacementPrivatePostRaceLaneIds,
  replacementPrivatePostRecoveryLaneIds,
} from "./dev_test_game_replacement_private_scenarios.mjs";
import {
  replacementConcurrentActionRaceScenario,
  replacementConcurrentPrivatePostRaceScenario,
  replacementConcurrentVoteRaceScenario,
  replacementStalePrivatePostAfterResolveScenario,
  replacementStalePrivatePostAfterCompleteScenario,
} from "./dev_test_game_replacement_private_scenario_cases.mjs";
import {
  buildReplacementCompletedPrivatePostRejectProof,
  buildReplacementCompletedPrivatePostReloadProof,
  buildReplacementResolvedPrivatePostAckProof,
  buildReplacementResolvedPrivatePostReconnectProof,
  replacementCompletedPrivatePostRejectMatches,
  replacementCompletedPrivatePostReloadMatches,
  replacementResolvedPrivatePostAckMatches,
  replacementResolvedPrivatePostReconnectMatches,
} from "./dev_test_game_replacement_private_post_assertions.mjs";
import {
  assertPrivateChannelSubmitPostProofCase,
  assertStaleCompletedPrivatePostRecoveryProofCase,
  completedPrivateChannelReloadScenario,
  privateChannelSubmitPostScenario,
} from "./dev_test_game_core_loop_private_receipt_scenarios.mjs";
import {
  assertCoreLoopPrivateChannelRecoveryCoverageSummary,
  buildCoreLoopPrivateChannelRecoveryCoverageSummary,
  coreLoopPrivateChannelCompletedPostLaneId,
  coreLoopPrivateChannelInvalidActionLaneId,
  coreLoopPrivateChannelPostLaneId,
  coreLoopPrivateChannelRecoveryLaneIds,
  coreLoopPrivateChannelStalePostLaneId,
  privateChannelInvalidActionRecoveryScenario,
  staleCompletedPrivatePostScenario,
} from "./dev_test_game_core_loop_private_channel_recovery_scenarios.mjs";

export const DEV_TEST_GAME_PROOF_VERSION = 1;

const hostResolvePhaseActionId = hostResolvePhaseCommandFacts().actionId;
const hostAdvancePhaseActionId = hostAdvancePhaseCommandFacts().actionId;
const hostLockThreadActionId = hostLockThreadCommandFacts().actionId;
const hostUnlockThreadActionId = hostUnlockThreadCommandFacts().actionId;
const hostExtendDeadlineActionId = hostExtendDeadlineCommandFacts().actionId;
const hostAdvanceByDeadlineActionId =
  hostAdvanceByDeadlineCommandFacts().actionId;
const privateChannelInvalidActionRecovery =
  privateChannelInvalidActionRecoveryScenario();

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultSessionPath = path.join(repoRoot, "target", "dev-test-game", "session.json");
const defaultProofPath = path.join(repoRoot, "target", "dev-test-game", "proof-run.json");
const requiredLaneIds = Object.freeze([
  "browser-entry",
  "host-setup-role",
  "cohost-console",
  "core-loop",
  ...coreLoopPhaseProgressionLaneIds,
  "host-deadline-advance",
  "stale-deadline-advance",
  playerInvalidActionRecoveryLaneId,
  "resolution-receipts",
  "dead-player-recovery",
  playerActionBoundaryLaneId,
  ...coreLoopPrivateChannelRecoveryLaneIds,
  "replacement-host-issued-invite",
  "replacement-pending-player",
  "replacement-redeemed-invite-recovery",
  "replacement-session-revocation-recovery",
  "replacement-session-refresh-recovery",
  "replacement-stale-session-after-refresh",
  "replacement-reconnect-recovery",
  "stale-host-invite-recovery",
  ...staleConflictMessageLaneIds,
  "replacement-invalid-target-recovery",
  "replacement-console",
  "replacement-idempotent-retry",
  "replacement-stale-success-recovery",
  "replacement-stale-player",
  "replacement-stale-action",
  "replacement-stale-private-channel",
  "replacement-stale-private-receipts",
  "replacement-incoming-player",
  ...playerActionFoundationLaneIds,
  ...stalePlayerCommandLaneIds,
  ...crossRoleRaceLaneIds,
  ...replacementPrivatePostRaceLaneIds,
  "concurrent-replacement-vote-race",
  "concurrent-replacement-vote-race-reload",
  "concurrent-replacement-action-race",
  "concurrent-replacement-action-race-reload",
  ...replacementActionLaneIds,
  ...replacementPrivatePostRecoveryLaneIds,
  "stale-dead-target-vote",
  "dead-current-vote",
  "concurrent-vote-race",
  "concurrent-vote-race-reload",
  "stale-host-publish-after-change",
  "host-votecount-publication",
  "concurrent-host-publish-race",
  "concurrent-host-publish-race-reload",
  ...hostStandaloneStaleControlLaneIds,
  "host-lifecycle-control",
  "host-modkill-control",
  "concurrent-host-lifecycle-race",
  "concurrent-host-lifecycle-race-reload",
  ...hostPromptStaleControlLaneIds,
  ...completedGameHardeningLaneIds(),
  ...playerActionConflictRecoveryLaneIds,
  ...hostRaceReloadLaneIds,
  ...hostGenericStaleControlLaneIds,
  hostStaleResolveControlLaneId,
  hostStaleAdvanceControlLaneId,
  ...hostPhaseStaleRecoveryLaneIds,
  "stale-cohost-deadline",
  ...cohostDeadlineRecoveryLaneIds,
]);

export function buildDevTestGameProofRun(session, options = {}) {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const verification = session?.verification ?? {};
  const hardening = verification.multiplayerHardening ?? {};
  const replacementPrivatePostRaceScenario =
    replacementConcurrentPrivatePostRaceScenario();
  const replacementVoteRaceScenario = replacementConcurrentVoteRaceScenario();
  const replacementActionRaceScenario = replacementConcurrentActionRaceScenario();
  const replacementResolvedPrivatePostScenario =
    replacementStalePrivatePostAfterResolveScenario();
  const replacementCompletedPrivatePostScenario =
    replacementStalePrivatePostAfterCompleteScenario();
  const replacementIncomingActionCase = replacementIncomingActionScenario();
  const replacementActionReconnectCase = replacementActionReconnectScenario();
  const replacementStaleActionAfterResolveCase =
    replacementStaleActionAfterResolveScenario();
  const staleActionReconnectExpectation = stalePlayerActionReconnectExpectation();
  const privateStaleActionReconnectExpectation =
    privateChannelStaleActionReconnectExpectation();
  const privateChannelSubmitPostAckProof =
    verification.privateChannel?.stalePostAfterPhaseTransition?.submitPostAckProof;
  const privateChannelCompletedPostRejectProof =
    verification.privateChannel?.completedGameRecovery?.completedPostRejectProof;
  const privateChannelSubmitPostAckProofPassed =
    normalizedPrivateChannelSubmitPostAckProofPassed(
      privateChannelSubmitPostAckProof,
    );
  const privateChannelCompletedPostRejectProofPassed =
    normalizedCompletedPrivateChannelPostRejectProofPassed(
      privateChannelCompletedPostRejectProof,
    );
  const replacementResolvedPrivatePostAckProof =
    buildReplacementResolvedPrivatePostAckProof(
      hardening.replacementStalePrivatePostAfterResolve,
      replacementResolvedPrivatePostScenario,
    );
  const replacementResolvedPrivatePostReconnectProof =
    buildReplacementResolvedPrivatePostReconnectProof(
      hardening.replacementStalePrivatePostAfterResolve,
      hardening.replacementStalePrivatePostAfterResolve
        ?.privateReconnectAfterAck,
      replacementResolvedPrivatePostScenario,
    );
  const replacementCompletedPrivatePostRejectProof =
    buildReplacementCompletedPrivatePostRejectProof(
      hardening.replacementStalePrivatePostAfterComplete,
      replacementCompletedPrivatePostScenario,
    );
  const replacementCompletedPrivatePostReloadProof =
    buildReplacementCompletedPrivatePostReloadProof(
      hardening.replacementStalePrivatePostAfterComplete,
      hardening.replacementStalePrivatePostAfterComplete
        ?.privateReloadAfterReject,
      replacementCompletedPrivatePostScenario,
    );
  const lanes = [
    lane("browser-entry", "Role URLs open verified browser sessions", {
      roles: verification.roles ?? [],
      sessionRoles: Object.keys(verification.sessions ?? {}),
      passed: verification.status === "passed" && requiredRolesPresent(verification),
    }),
    lane("host-setup-role", "Host setup role URL opens setup recovery surface", {
      roleUrl: verification.hostSetup?.roleUrl ?? null,
      capabilityLabel: verification.hostSetup?.capabilityLabel ?? null,
      readinessSummary: verification.hostSetup?.readinessSummary ?? null,
      phaseId: verification.hostSetup?.phaseId ?? null,
      startDisabled: verification.hostSetup?.startDisabled ?? null,
      hostHref: verification.hostSetup?.hostHref ?? null,
      readyCheckIds: verification.hostSetup?.readyCheckIds ?? null,
      slotIds: verification.hostSetup?.slotIds ?? null,
      roleKeys: verification.hostSetup?.roleKeys ?? null,
      mainPolicyText: verification.hostSetup?.mainPolicyText ?? null,
      policyCommand: verification.hostSetup?.policyCommand ?? null,
      setupMutationCommand: verification.hostSetup?.setupMutationCommand ?? null,
      passed:
        verification.hostSetup?.status === "passed" &&
        verification.hostSetup?.roleUrl?.includes(`/g/${session?.game ?? ""}/setup`) ===
          true &&
        verification.hostSetup?.capabilityLabel ===
          `HostOf(${session?.game ?? ""})` &&
        verification.hostSetup?.readinessSummary === "Started at D01" &&
        verification.hostSetup?.phaseId === "D01" &&
        verification.hostSetup?.startDisabled === true &&
        verification.hostSetup?.hostHref === `/g/${session?.game ?? ""}/host` &&
        verification.hostSetup?.mainPolicyText ===
          "Media-only posts are disabled." &&
        verification.hostSetup?.slotIds?.includes("slot-7") === true &&
        verification.hostSetup?.slotIds?.includes("slot_4") === true &&
        verification.hostSetup?.roleKeys?.includes("mafia_goon") === true &&
        verification.hostSetup?.roleKeys?.includes("vanilla_townie") === true &&
        verification.hostSetup?.policyCommand?.status === "passed" &&
        verification.hostSetup?.policyCommand?.commandKind === "SetPostPolicy" &&
        verification.hostSetup?.policyCommand?.channelId === "main" &&
        sameArray(
          verification.hostSetup?.policyCommand?.allowMediaOnlySequence,
          [true, false],
        ) &&
        verification.hostSetup?.policyCommand?.finalPolicyText ===
          "Media-only posts are disabled." &&
        verification.hostSetup?.policyCommand?.enabled?.status === "ack" &&
        verification.hostSetup?.policyCommand?.enabled?.requestEnvelope?.body?.body
          ?.command?.SetPostPolicy?.allow_media_only === true &&
        verification.hostSetup?.policyCommand?.enabled?.refreshedAllowMediaOnly ===
          true &&
        verification.hostSetup?.policyCommand?.restored?.status === "ack" &&
        verification.hostSetup?.policyCommand?.restored?.requestEnvelope?.body?.body
          ?.command?.SetPostPolicy?.allow_media_only === false &&
        verification.hostSetup?.policyCommand?.restored?.refreshedAllowMediaOnly ===
          false &&
        verification.hostSetup?.setupMutationCommand?.status === "passed" &&
        verification.hostSetup?.setupMutationCommand?.sessionPrincipalUserId ===
          "host_h" &&
        verification.hostSetup?.setupMutationCommand?.initialSummary ===
          "Ready to start" &&
        verification.hostSetup?.setupMutationCommand?.finalSummary ===
          "Ready to start" &&
        verification.hostSetup?.setupMutationCommand?.finalStartAvailable === true &&
        verification.hostSetup?.setupMutationCommand?.addedSlotId ===
          "slot_extra" &&
        verification.hostSetup?.setupMutationCommand?.assignedPrincipalUserId ===
          "setup-extra-player" &&
        verification.hostSetup?.setupMutationCommand?.assignedRoleKey ===
          "mafia_goon" &&
        verification.hostSetup?.setupMutationCommand?.duplicateAddSlotRecovery
          ?.status === "reject" &&
        verification.hostSetup?.setupMutationCommand?.duplicateAddSlotRecovery
          ?.error === "InvalidTarget" &&
        verification.hostSetup?.setupMutationCommand?.duplicateAddSlotRecovery
          ?.commandKind === "AddSlot" &&
        verification.hostSetup?.setupMutationCommand?.duplicateAddSlotRecovery
          ?.command?.slot === "slot_extra" &&
        verification.hostSetup?.setupMutationCommand?.duplicateAddSlotRecovery
          ?.duplicateSlotCountAfterReject === 1 &&
        verification.hostSetup?.setupMutationCommand?.finalSlot?.slotId ===
          "slot_extra" &&
        verification.hostSetup?.setupMutationCommand?.finalSlot?.occupantUserId ===
          "setup-extra-player" &&
        verification.hostSetup?.setupMutationCommand?.finalSlot?.roleKey ===
          "mafia_goon" &&
        verification.hostSetup?.setupMutationCommand?.commands?.addSlot?.status ===
          "ack" &&
        verification.hostSetup?.setupMutationCommand?.commands?.addSlot?.command
          ?.slot === "slot_extra" &&
        verification.hostSetup?.setupMutationCommand?.commands?.assignSlot?.status ===
          "ack" &&
        verification.hostSetup?.setupMutationCommand?.commands?.assignSlot?.command
          ?.user === "setup-extra-player" &&
        verification.hostSetup?.setupMutationCommand?.commands?.assignRole?.status ===
          "ack" &&
        verification.hostSetup?.setupMutationCommand?.commands?.assignRole?.command
          ?.role_key === "mafia_goon" &&
        verification.hostSetup?.readyCheckIds?.length === 7,
    }),
    lane("cohost-console", "Cohost role URL opens delegated host console controls", {
      capabilityLabel: verification.cohostConsole?.capabilityLabel ?? null,
      extendDeadlineState:
        verification.cohostConsole?.extendDeadline?.commandStatus?.state ?? null,
      extendDeadlinePrincipal:
        verification.cohostConsole?.extendDeadline?.commandStatus?.requestEnvelope?.body?.body
          ?.principal_user_id ?? null,
      hostOnlyControlsVisible:
        verification.cohostConsole?.hostOnlyControlsVisible ?? null,
      hostOnlyRejectError:
        verification.cohostConsole?.hostOnlyResolveReject?.serverEnvelope?.body?.body
          ?.error ?? null,
      hostOnlyRejectPrincipal:
        verification.cohostConsole?.hostOnlyResolveReject?.requestEnvelope?.body?.body
          ?.principal_user_id ?? null,
      phaseAfterReject: verification.cohostConsole?.phaseAfterReject ?? null,
      passed:
        verification.cohostConsole?.status === "passed" &&
        verification.cohostConsole?.capabilityLabel ===
          `CohostOf(${session?.game ?? ""})` &&
        verification.cohostConsole?.extendDeadline?.commandStatus?.state === "ack" &&
        verification.cohostConsole?.extendDeadline?.commandStatus?.requestEnvelope?.body
          ?.body?.principal_user_id === "cohost_c" &&
        verification.cohostConsole?.hostOnlyControlsVisible === false &&
        verification.cohostConsole?.hostOnlyResolveReject?.serverEnvelope?.body?.kind ===
          "Reject" &&
        verification.cohostConsole?.hostOnlyResolveReject?.serverEnvelope?.body?.body
          ?.error === "NotHost" &&
        verification.cohostConsole?.hostOnlyResolveReject?.requestEnvelope?.body?.body
          ?.principal_user_id === "cohost_c" &&
        verification.cohostConsole?.phaseAfterReject?.id === "D01" &&
        verification.cohostConsole?.phaseAfterReject?.locked === false,
    }),
    lane("core-loop", "Host phase controls and player locked-vote recovery", {
      rejectedVoteError: verification.coreLoop?.rejectedVote?.error ?? null,
      lockState: verification.coreLoop?.lock?.commandStatus?.state ?? null,
      unlockState: verification.coreLoop?.unlock?.commandStatus?.state ?? null,
      staleVoteRoleUrl:
        verification.coreLoop?.staleVoteBrowserProof?.roleUrl ?? null,
      staleVoteReceiptStatusText:
        verification.coreLoop?.staleVoteBrowserProof?.receiptStatusText ?? null,
      staleVoteRefreshKeys:
        verification.coreLoop?.staleVoteBrowserProof?.receipt?.commandTrace
          ?.projectionRefreshKeys ?? null,
      staleVoteCurrentVoteBeforeReject:
        verification.coreLoop?.staleVoteBrowserProof?.commandStateBeforeClose
          ?.currentVote ?? null,
      staleVoteCurrentVoteAfterReject:
        verification.coreLoop?.staleVoteBrowserProof?.commandStateAfterReject
          ?.currentVote ?? null,
      staleVoteControlExistsAfterReject:
        verification.coreLoop?.staleVoteBrowserProof?.voteControlAfterReject?.exists ??
        null,
      staleVoteVotecountUnchanged:
        verification.coreLoop?.staleVoteBrowserProof?.votecountUnchanged ?? null,
      passed:
        verification.coreLoop?.status === "passed" &&
        verification.coreLoop?.lockedVoteControl?.exists === false &&
        verification.coreLoop?.lockedVoteControl?.disabled === true &&
        verification.coreLoop?.rejectedVote?.error === "PhaseLocked" &&
        typeof verification.coreLoop?.staleVoteBrowserProof?.roleUrl === "string" &&
        verification.coreLoop?.staleVoteBrowserProof?.roleUrl.includes(
          `/g/${session?.game ?? ""}`,
        ) === true &&
        verification.coreLoop?.staleVoteBrowserProof?.receipt?.actionId ===
          "submit_vote" &&
        verification.coreLoop?.staleVoteBrowserProof?.receipt?.state === "reject" &&
        verification.coreLoop?.staleVoteBrowserProof?.receipt?.commandTrace?.projectionRefreshKeys?.includes(
          "commandState",
        ) === true &&
        verification.coreLoop?.staleVoteBrowserProof?.receiptStatusText?.includes(
          "Reject PhaseLocked",
        ) === true &&
        JSON.stringify(
          verification.coreLoop?.staleVoteBrowserProof?.commandStateAfterReject
            ?.currentVote ?? null,
        ) ===
          JSON.stringify(
            verification.coreLoop?.staleVoteBrowserProof?.commandStateBeforeClose
              ?.currentVote ?? null,
          ) &&
        verification.coreLoop?.staleVoteBrowserProof?.voteControlAfterReject
          ?.exists === false &&
        verification.coreLoop?.staleVoteBrowserProof?.votecountUnchanged === true &&
        verification.coreLoop?.lock?.commandStatus?.state === "ack" &&
        verification.coreLoop?.unlock?.commandStatus?.state === "ack",
    }),
    lane(coreLoopPhaseProgressionLaneIds[0], "Day vote resolves through role URLs", {
      finalVoteState: verification.dayVoteResolution?.finalVote?.state ?? null,
      outcomeStatus: verification.dayVoteResolution?.dayVoteOutcome?.status ?? null,
      winnerSlot: verification.dayVoteResolution?.dayVoteOutcome?.winner_slot ?? null,
      hostSlotAlive: verification.dayVoteResolution?.hostSlot?.alive ?? null,
      hostOutcomePanel: verification.dayVoteResolution?.hostAfterResolve?.outcomePanel ?? null,
      targetOutcomePanel: verification.dayVoteResolution?.targetOutcomePanel ?? null,
      targetNoticeStatus: verification.dayVoteResolution?.targetNotice?.status ?? null,
      voteTargetCount: verification.dayVoteResolution?.voterBeforeVote?.voteTargets?.length ?? null,
      currentVoteBefore:
        verification.dayVoteResolution?.voterBeforeVote?.currentVote ?? null,
      currentVoteAfter:
        verification.dayVoteResolution?.voterAfterVote?.currentVote ?? null,
      voteButtonActions:
        verification.dayVoteResolution?.voterVoteButtons?.map((button) => button.action) ?? null,
      withdrawBefore: verification.dayVoteResolution?.voterWithdrawBefore ?? null,
      withdrawAfter: verification.dayVoteResolution?.voterWithdrawAfter ?? null,
      passed:
        verification.dayVoteResolution?.status === "passed" &&
        verification.dayVoteResolution?.finalVote?.state === "ack" &&
        verification.dayVoteResolution?.finalVote?.requestEnvelope?.body?.body
          ?.command?.SubmitVote?.actor_slot === "slot_4" &&
        verification.dayVoteResolution?.finalVote?.requestEnvelope?.body?.body
          ?.command?.SubmitVote?.target?.Slot === "slot-2" &&
        verification.dayVoteResolution?.voterBeforeVote?.voteTargets?.some(
          (target) => target.kind === "slot" && target.slotId === "slot-2",
        ) &&
        verification.dayVoteResolution?.voterBeforeVote?.voteTargets?.some(
          (target) => target.kind === "no_lynch",
        ) &&
        verification.dayVoteResolution?.voterBeforeVote?.currentVote === null &&
        verification.dayVoteResolution?.voterCurrentVoteBefore?.hasVote === "false" &&
        verification.dayVoteResolution?.voterCurrentVoteBefore?.text?.includes(
          "No current vote",
        ) &&
        verification.dayVoteResolution?.voterWithdrawBefore?.exists === true &&
        verification.dayVoteResolution?.voterWithdrawBefore?.disabled === true &&
        verification.dayVoteResolution?.voterWithdrawBefore?.reason ===
          "No current vote" &&
        verification.dayVoteResolution?.voterVoteButtons?.some(
          (button) =>
            button.action === "submit_vote" &&
            button.text?.includes("Vote Slot 2") &&
            button.disabled === false,
        ) &&
        verification.dayVoteResolution?.voterVoteButtons?.some(
          (button) =>
            button.action === "submit_vote:no_lynch" &&
            button.text?.includes("Vote no lynch") &&
            button.disabled === false,
        ) &&
        verification.dayVoteResolution?.voterAfterVote?.currentVote?.kind ===
          "slot" &&
        verification.dayVoteResolution?.voterAfterVote?.currentVote?.slotId ===
          "slot-2" &&
        verification.dayVoteResolution?.voterCurrentVoteAfter?.hasVote === "true" &&
        verification.dayVoteResolution?.voterCurrentVoteAfter?.text?.includes(
          "Slot 2",
        ) &&
        verification.dayVoteResolution?.voterWithdrawAfter?.exists === true &&
        verification.dayVoteResolution?.voterWithdrawAfter?.disabled === false &&
        verification.dayVoteResolution?.dayVoteOutcome?.phase_id === "D01" &&
        verification.dayVoteResolution?.dayVoteOutcome?.status === "Lynch" &&
        verification.dayVoteResolution?.dayVoteOutcome?.winner_slot === "slot-2" &&
        verification.dayVoteResolution?.dayVoteOutcome?.tallies?.["slot-2"] === 4 &&
        verification.dayVoteResolution?.resolveDay?.commandStatus?.state === "ack" &&
        verification.dayVoteResolution?.hostAfterResolve?.dayVoteOutcomes?.some(
          (row) =>
            row.phaseId === "D01" &&
            row.status === "Lynch" &&
            row.winnerSlot === "slot-2",
        ) &&
        verification.dayVoteResolution?.hostAfterResolve?.outcomePanel?.includes("D01 Lynch") &&
        verification.dayVoteResolution?.hostAfterResolve?.outcomePanel?.includes(
          "Slot 2 was eliminated",
        ) &&
        verification.dayVoteResolution?.hostAfterResolve?.outcomeTally?.includes("4/3") &&
        verification.dayVoteResolution?.hostSlot?.alive === false &&
        verification.dayVoteResolution?.hostSlot?.status === "dead" &&
        verification.dayVoteResolution?.targetCommandState?.actorAlive === false &&
        verification.dayVoteResolution?.targetCommandState?.actorStatus === "dead" &&
        verification.dayVoteResolution?.targetDayVoteOutcomes?.some(
          (row) =>
            row.phaseId === "D01" &&
            row.status === "Lynch" &&
            row.winnerSlot === "slot-2",
        ) &&
        verification.dayVoteResolution?.targetOutcomePanel?.includes("D01 Lynch") &&
        verification.dayVoteResolution?.targetOutcomePanel?.includes(
          "Slot 2 was eliminated",
        ) &&
        verification.dayVoteResolution?.targetOutcomeTally?.includes("4/3") &&
        verification.dayVoteResolution?.targetNotice?.effect === "player_killed" &&
        verification.dayVoteResolution?.targetNotice?.status === "day_vote" &&
        Object.values(verification.dayVoteResolution?.targetControls ?? {}).every(
          (control) => control?.disabled === true,
        ),
    }),
    lane(coreLoopPhaseProgressionLaneIds[1], "No-lynch day vote resolves without a death", {
      outcomeStatus: verification.dayVoteNoLynch?.dayVoteOutcome?.status ?? null,
      noLynchTally: verification.dayVoteNoLynch?.dayVoteOutcome?.tallies?.no_lynch ?? null,
      miraVoteState: verification.dayVoteNoLynch?.miraNoLynchVote?.state ?? null,
      seedVoteState: verification.dayVoteNoLynch?.seedNoLynchVote?.state ?? null,
      survivorAlive: verification.dayVoteNoLynch?.survivorSlot?.alive ?? null,
      survivorOutcomePanel: verification.dayVoteNoLynch?.survivorOutcomePanel ?? null,
      deathNoticeCount:
        verification.dayVoteNoLynch?.survivorNotifications?.filter(
          (notice) => notice.effect === "player_killed" && notice.status === "day_vote",
        ).length ?? null,
      passed:
        verification.dayVoteNoLynch?.status === "passed" &&
        verification.dayVoteNoLynch?.resolveDay?.commandStatus?.state === "ack" &&
        verification.dayVoteNoLynch?.dayVoteOutcome?.phase_id === "D01" &&
        verification.dayVoteNoLynch?.dayVoteOutcome?.status === "NoLynch" &&
        verification.dayVoteNoLynch?.dayVoteOutcome?.winner_slot === null &&
        verification.dayVoteNoLynch?.dayVoteOutcome?.tallies?.no_lynch === 2 &&
        verification.dayVoteNoLynch?.miraNoLynchVote?.state === "ack" &&
        verification.dayVoteNoLynch?.miraNoLynchVote?.requestEnvelope?.body?.body
          ?.principal_user_id === "player-mira" &&
        verification.dayVoteNoLynch?.miraNoLynchVote?.requestEnvelope?.body?.body
          ?.command?.SubmitVote?.target === "NoLynch" &&
        verification.dayVoteNoLynch?.seedNoLynchVote?.state === "ack" &&
        verification.dayVoteNoLynch?.seedNoLynchVote?.requestEnvelope?.body?.body
          ?.principal_user_id === "player-seed" &&
        verification.dayVoteNoLynch?.seedNoLynchVote?.requestEnvelope?.body?.body
          ?.command?.SubmitVote?.target === "NoLynch" &&
        verification.dayVoteNoLynch?.miraVotecountAfterVote?.some(
          (row) => row.target === "no_lynch" && row.count === 1,
        ) &&
        verification.dayVoteNoLynch?.seedVotecountAfterVote?.some(
          (row) => row.target === "no_lynch" && row.count === 2,
        ) &&
        verification.dayVoteNoLynch?.hostAfterResolve?.dayVoteOutcomes?.some(
          (row) =>
            row.phaseId === "D01" &&
            row.status === "NoLynch" &&
            row.winnerSlot === null,
        ) &&
        verification.dayVoteNoLynch?.hostAfterResolve?.outcomePanel?.includes("D01 NoLynch") &&
        verification.dayVoteNoLynch?.hostAfterResolve?.outcomePanel?.includes(
          "without an elimination",
        ) &&
        verification.dayVoteNoLynch?.hostAfterResolve?.outcomeTally?.includes("No lynch") &&
        verification.dayVoteNoLynch?.hostAfterResolve?.outcomeTally?.includes("2/2") &&
        verification.dayVoteNoLynch?.survivorSlot?.alive === true &&
        verification.dayVoteNoLynch?.survivorSlot?.status === "alive" &&
        verification.dayVoteNoLynch?.survivorCommandState?.actorAlive === true &&
        verification.dayVoteNoLynch?.survivorCommandState?.actorStatus === "alive" &&
        verification.dayVoteNoLynch?.survivorDayVoteOutcomes?.some(
          (row) =>
            row.phaseId === "D01" &&
            row.status === "NoLynch" &&
            row.winnerSlot === null,
        ) &&
        verification.dayVoteNoLynch?.survivorOutcomePanel?.includes("D01 NoLynch") &&
        verification.dayVoteNoLynch?.survivorOutcomePanel?.includes(
          "without an elimination",
        ) &&
        verification.dayVoteNoLynch?.survivorOutcomeTally?.includes("No lynch") &&
        verification.dayVoteNoLynch?.survivorOutcomeTally?.includes("2/2") &&
        verification.dayVoteNoLynch?.survivorNotifications?.every(
          (notice) => notice.effect !== "player_killed" || notice.status !== "day_vote",
        ),
    }),
    lane(playerActionLoopLaneId, "Day/night action submission and resolution", {
      hostRoleUrl: verification.actionLoop?.dayNightTransition?.hostRoleUrl ?? null,
      actionRoleUrl: verification.actionLoop?.dayNightTransition?.actionRoleUrl ?? null,
      normalPlayerRoleUrl:
        verification.actionLoop?.dayNightTransition?.normalPlayerRoleUrl ?? null,
      dayPhase:
        verification.actionLoop?.dayNightTransition?.dayLockedActionSurface
          ?.commandState?.phase?.phaseId ?? null,
      dayLocked:
        verification.actionLoop?.dayNightTransition?.dayLockedActionSurface
          ?.commandState?.phase?.locked ?? null,
      nightPhase:
        verification.actionLoop?.dayNightTransition?.nightActionSurface?.commandState
          ?.phase?.phaseId ?? null,
      nightActionButtons:
        verification.actionLoop?.dayNightTransition?.nightActionSurface?.buttons?.map(
          (button) => button.action,
        ) ?? null,
      normalPlayerActionCount:
        verification.actionLoop?.dayNightTransition?.normalPlayerNightSurface
          ?.commandActions?.length ?? null,
      nightResolutionRoleUrl:
        verification.actionLoop?.nightResolutionTransition?.actionRoleUrl ?? null,
      targetResolutionRoleUrl:
        verification.actionLoop?.nightResolutionTransition?.targetRoleUrl ?? null,
      submittedActionTemplate:
        verification.actionLoop?.nightResolutionTransition?.legalActionTemplateId ?? null,
      targetReceiptStatus:
        verification.actionLoop?.nightResolutionTransition?.targetReceiptSurface
          ?.targetNotice?.status ?? null,
      targetReceiptEffect:
        verification.actionLoop?.nightResolutionTransition?.targetReceiptSurface
          ?.targetNotice?.effect ?? null,
      targetCommandAlive:
        verification.actionLoop?.nightResolutionTransition?.targetReceiptSurface
          ?.targetCommandState?.actorAlive ?? null,
      d02ActionButtons:
        verification.actionLoop?.nightResolutionTransition?.d02ActionSurface?.buttons?.map(
          (button) => button.action,
        ) ?? null,
      d02NormalPlayerButtons:
        verification.actionLoop?.nightResolutionTransition?.d02NormalPlayerSurface?.buttons?.map(
          (button) => button.action,
        ) ?? null,
      d02VoteGame: verification.actionLoop?.d02VoteNightTransition?.game ?? null,
      d02VoteTarget:
        verification.actionLoop?.d02VoteNightTransition?.voteTarget?.slotId ?? null,
      d02VoteState:
        verification.actionLoop?.d02VoteNightTransition?.finalVote?.state ?? null,
      d02VoteOutcomeStatus:
        verification.actionLoop?.d02VoteNightTransition?.dayVoteOutcome?.status ?? null,
      d02VoteReceiptStatus:
        verification.actionLoop?.d02VoteNightTransition?.targetReceiptSurface
          ?.targetNotice?.status ?? null,
      nextNightPhase:
        verification.actionLoop?.d02VoteNightTransition?.n02ActionSurface?.commandState
          ?.phase?.phaseId ?? null,
      nextNightActionButtons:
        verification.actionLoop?.d02VoteNightTransition?.n02ActionSurface?.buttons?.map(
          (button) => button.action,
        ) ?? null,
      nextNightNormalPlayerFactionalKillVisible:
        verification.actionLoop?.d02VoteNightTransition?.n02NormalPlayerSurface
          ?.factionalKillVisible ?? null,
      invalidActionError: verification.actionLoop?.invalidAction?.error ?? null,
      legalActionState: verification.actionLoop?.legalAction?.state ?? null,
      resolvedTargetAlive: verification.actionLoop?.resolvedTargetSlot?.alive ?? null,
      advancedPhase: verification.actionLoop?.d02Phase?.phaseId ?? null,
      passed:
        verification.actionLoop?.status === "passed" &&
        verification.actionLoop?.dayNightTransition?.status === "passed" &&
        typeof verification.actionLoop?.dayNightTransition?.hostRoleUrl === "string" &&
        verification.actionLoop?.dayNightTransition?.hostRoleUrl.includes(
          `/g/${session?.game ?? ""}/host`,
        ) === true &&
        typeof verification.actionLoop?.dayNightTransition?.actionRoleUrl === "string" &&
        verification.actionLoop?.dayNightTransition?.actionRoleUrl.includes(
          `/g/${session?.game ?? ""}`,
        ) === true &&
        typeof verification.actionLoop?.dayNightTransition?.normalPlayerRoleUrl ===
          "string" &&
        verification.actionLoop?.dayNightTransition?.normalPlayerRoleUrl.includes(
          `/g/${session?.game ?? ""}`,
        ) === true &&
        verification.actionLoop?.dayNightTransition?.resolveDayState === "ack" &&
        verification.actionLoop?.dayNightTransition?.advanceNightState === "ack" &&
        verification.actionLoop?.dayNightTransition?.dayLockedActionSurface
          ?.commandState?.phase?.phaseId === "D01" &&
        verification.actionLoop?.dayNightTransition?.dayLockedActionSurface
          ?.commandState?.phase?.locked === true &&
        verification.actionLoop?.dayNightTransition?.dayLockedActionSurface?.buttons?.some(
          (button) => String(button.action ?? "").startsWith("submit_action"),
        ) === false &&
        verification.actionLoop?.dayNightTransition?.dayLockedActionSurface?.buttons?.some(
          (button) => String(button.action ?? "").startsWith("submit_vote"),
        ) === false &&
        verification.actionLoop?.dayNightTransition?.nightActionSurface?.commandState
          ?.phase?.phaseId === "N01" &&
        verification.actionLoop?.dayNightTransition?.nightActionSurface?.commandState
          ?.phase?.locked === false &&
        verification.actionLoop?.dayNightTransition?.nightActionSurface?.commandState?.actions?.some(
          (action) => action.templateId === "factional_kill",
        ) === true &&
        verification.actionLoop?.dayNightTransition?.nightActionSurface?.buttons?.some(
          (button) => button.action === "submit_action:factional_kill" && !button.disabled,
        ) === true &&
        verification.actionLoop?.dayNightTransition?.nightActionSurface?.buttons?.some(
          (button) => button.action === "submit_invalid_action:factional_kill",
        ) === true &&
        verification.actionLoop?.dayNightTransition?.normalPlayerNightSurface?.phase
          ?.phaseId === "N01" &&
        verification.actionLoop?.dayNightTransition?.normalPlayerNightSurface
          ?.commandActions?.length === 0 &&
        verification.actionLoop?.dayNightTransition?.normalPlayerNightSurface
          ?.factionalKillVisible === false &&
        verification.actionLoop?.dayNightTransition?.normalPlayerNightSurface
          ?.directRejectError === "InvalidTarget" &&
        verification.actionLoop?.nightResolutionTransition?.status === "passed" &&
        typeof verification.actionLoop?.nightResolutionTransition?.hostRoleUrl ===
          "string" &&
        verification.actionLoop?.nightResolutionTransition?.hostRoleUrl.includes(
          `/g/${session?.game ?? ""}/host`,
        ) === true &&
        typeof verification.actionLoop?.nightResolutionTransition?.actionRoleUrl ===
          "string" &&
        verification.actionLoop?.nightResolutionTransition?.actionRoleUrl.includes(
          `/g/${session?.game ?? ""}`,
        ) === true &&
        typeof verification.actionLoop?.nightResolutionTransition?.targetRoleUrl ===
          "string" &&
        verification.actionLoop?.nightResolutionTransition?.targetRoleUrl.includes(
          `/g/${session?.game ?? ""}`,
        ) === true &&
        typeof verification.actionLoop?.nightResolutionTransition?.normalPlayerRoleUrl ===
          "string" &&
        verification.actionLoop?.nightResolutionTransition?.normalPlayerRoleUrl.includes(
          `/g/${session?.game ?? ""}`,
        ) === true &&
        verification.actionLoop?.nightResolutionTransition?.legalActionState ===
          "ack" &&
        verification.actionLoop?.nightResolutionTransition?.legalActionTemplateId ===
          "factional_kill" &&
        verification.actionLoop?.nightResolutionTransition?.resolveNightState ===
          "ack" &&
        verification.actionLoop?.nightResolutionTransition?.resolvedTargetSlot?.alive ===
          false &&
        verification.actionLoop?.nightResolutionTransition?.resolvedTargetSlot?.status ===
          "dead" &&
        verification.actionLoop?.nightResolutionTransition?.targetReceiptSurface
          ?.targetNotice?.audience_slot ===
          verification.actionLoop?.nightResolutionTransition?.legalActionTarget &&
        verification.actionLoop?.nightResolutionTransition?.targetReceiptSurface
          ?.targetNotice?.effect === "player_killed" &&
        verification.actionLoop?.nightResolutionTransition?.targetReceiptSurface
          ?.targetNotice?.status === "factional_kill" &&
        verification.actionLoop?.nightResolutionTransition?.targetReceiptSurface
          ?.targetPrivateQueueItem?.effect === "player_killed" &&
        verification.actionLoop?.nightResolutionTransition?.targetReceiptSurface
          ?.targetCommandState?.actorSlot ===
          verification.actionLoop?.nightResolutionTransition?.legalActionTarget &&
        verification.actionLoop?.nightResolutionTransition?.targetReceiptSurface
          ?.targetCommandState?.actorAlive === false &&
        verification.actionLoop?.nightResolutionTransition?.targetReceiptSurface
          ?.targetCommandState?.phase?.phaseId === "D02" &&
        verification.actionLoop?.nightResolutionTransition?.targetReceiptSurface
          ?.targetCommandState?.actions?.length === 0 &&
        verification.actionLoop?.nightResolutionTransition?.advanceDayState === "ack" &&
        verification.actionLoop?.nightResolutionTransition?.d02ActionSurface
          ?.commandState?.phase?.phaseId === "D02" &&
        verification.actionLoop?.nightResolutionTransition?.d02ActionSurface
          ?.commandState?.phase?.locked === false &&
        verification.actionLoop?.nightResolutionTransition?.d02ActionSurface
          ?.commandState?.actions?.length === 0 &&
        verification.actionLoop?.nightResolutionTransition?.d02ActionSurface?.buttons?.some(
          (button) => String(button.action ?? "").startsWith("submit_action"),
        ) === false &&
        verification.actionLoop?.nightResolutionTransition?.d02ActionSurface?.buttons?.some(
          (button) => String(button.action ?? "").startsWith("submit_vote"),
        ) === true &&
        verification.actionLoop?.nightResolutionTransition?.d02NormalPlayerSurface
          ?.commandState?.phase?.phaseId === "D02" &&
        verification.actionLoop?.nightResolutionTransition?.d02NormalPlayerSurface
          ?.commandState?.phase?.locked === false &&
        verification.actionLoop?.nightResolutionTransition?.d02NormalPlayerSurface
          ?.commandState?.actions?.length === 0 &&
        verification.actionLoop?.nightResolutionTransition?.d02NormalPlayerSurface?.buttons?.some(
          (button) => String(button.action ?? "").startsWith("submit_vote"),
        ) === true &&
        verification.actionLoop?.d02VoteNightTransition?.status === "passed" &&
        typeof verification.actionLoop?.d02VoteNightTransition?.hostRoleUrl ===
          "string" &&
        verification.actionLoop?.d02VoteNightTransition?.hostRoleUrl.includes(
          `/g/${verification.actionLoop?.d02VoteNightTransition?.game ?? ""}/host`,
        ) === true &&
        typeof verification.actionLoop?.d02VoteNightTransition?.actionRoleUrl ===
          "string" &&
        verification.actionLoop?.d02VoteNightTransition?.actionRoleUrl.includes(
          `/g/${verification.actionLoop?.d02VoteNightTransition?.game ?? ""}`,
        ) === true &&
        typeof verification.actionLoop?.d02VoteNightTransition?.playerRoleUrl ===
          "string" &&
        verification.actionLoop?.d02VoteNightTransition?.playerRoleUrl.includes(
          `/g/${verification.actionLoop?.d02VoteNightTransition?.game ?? ""}`,
        ) === true &&
        typeof verification.actionLoop?.d02VoteNightTransition?.targetRoleUrl ===
          "string" &&
        verification.actionLoop?.d02VoteNightTransition?.targetRoleUrl.includes(
          `/g/${verification.actionLoop?.d02VoteNightTransition?.game ?? ""}`,
        ) === true &&
        verification.actionLoop?.d02VoteNightTransition?.hostBeforeVote?.phase?.id ===
          "D02" &&
        verification.actionLoop?.d02VoteNightTransition?.hostBeforeVote?.phase
          ?.locked === false &&
        verification.actionLoop?.d02VoteNightTransition?.voteTarget?.slotId ===
          "slot-2" &&
        verification.actionLoop?.d02VoteNightTransition?.finalVote?.state === "ack" &&
        verification.actionLoop?.d02VoteNightTransition?.finalVote?.requestEnvelope
          ?.body?.body?.command?.SubmitVote?.actor_slot === "slot_4" &&
        verification.actionLoop?.d02VoteNightTransition?.finalVote?.requestEnvelope
          ?.body?.body?.command?.SubmitVote?.target?.Slot === "slot-2" &&
        verification.actionLoop?.d02VoteNightTransition?.apiVoteRow?.phaseId ===
          "D02" &&
        verification.actionLoop?.d02VoteNightTransition?.apiVoteRow?.target ===
          "slot-2" &&
        verification.actionLoop?.d02VoteNightTransition?.apiVoteRow?.count === 3 &&
        verification.actionLoop?.d02VoteNightTransition?.resolveD02?.commandStatus
          ?.state === "ack" &&
        verification.actionLoop?.d02VoteNightTransition?.hostAfterResolve?.phase?.id ===
          "D02" &&
        verification.actionLoop?.d02VoteNightTransition?.hostAfterResolve?.phase
          ?.locked === true &&
        verification.actionLoop?.d02VoteNightTransition?.dayVoteOutcome?.phaseId ===
          "D02" &&
        verification.actionLoop?.d02VoteNightTransition?.dayVoteOutcome?.status ===
          "Lynch" &&
        verification.actionLoop?.d02VoteNightTransition?.dayVoteOutcome?.winnerSlot ===
          "slot-2" &&
        verification.actionLoop?.d02VoteNightTransition?.dayVoteOutcome?.tallies?.[
          "slot-2"
        ] === 3 &&
        verification.actionLoop?.d02VoteNightTransition?.hostSlotAfterResolve?.alive ===
          false &&
        verification.actionLoop?.d02VoteNightTransition?.hostSlotAfterResolve?.status ===
          "dead" &&
        verification.actionLoop?.d02VoteNightTransition?.targetReceiptSurface
          ?.targetNotice?.audience_slot === "slot-2" &&
        verification.actionLoop?.d02VoteNightTransition?.targetReceiptSurface
          ?.targetNotice?.effect === "player_killed" &&
        verification.actionLoop?.d02VoteNightTransition?.targetReceiptSurface
          ?.targetNotice?.status === "day_vote" &&
        verification.actionLoop?.d02VoteNightTransition?.targetReceiptSurface
          ?.targetCommandState?.actorAlive === false &&
        verification.actionLoop?.d02VoteNightTransition?.targetReceiptSurface
          ?.targetCommandState?.actorStatus === "dead" &&
        verification.actionLoop?.d02VoteNightTransition?.advanceN02?.commandStatus
          ?.state === "ack" &&
        verification.actionLoop?.d02VoteNightTransition?.n02HostSurface?.phase?.id ===
          "N02" &&
        verification.actionLoop?.d02VoteNightTransition?.n02HostSurface?.phase
          ?.locked === false &&
        verification.actionLoop?.d02VoteNightTransition?.n02ActionSurface
          ?.commandState?.actorSlot === "slot_4" &&
        verification.actionLoop?.d02VoteNightTransition?.n02ActionSurface
          ?.commandState?.actorAlive === true &&
        verification.actionLoop?.d02VoteNightTransition?.n02ActionSurface
          ?.commandState?.phase?.phaseId === "N02" &&
        verification.actionLoop?.d02VoteNightTransition?.n02ActionSurface
          ?.commandState?.actions?.some(
            (action) => action.templateId === "factional_kill",
          ) === true &&
        verification.actionLoop?.d02VoteNightTransition?.n02ActionSurface?.buttons?.some(
          (button) =>
            button.action === "submit_action:factional_kill" &&
            button.disabled === false,
        ) === true &&
        verification.actionLoop?.d02VoteNightTransition?.n02NormalPlayerSurface
          ?.commandState?.actorSlot === "slot-7" &&
        verification.actionLoop?.d02VoteNightTransition?.n02NormalPlayerSurface
          ?.commandState?.phase?.phaseId === "N02" &&
        verification.actionLoop?.d02VoteNightTransition?.n02NormalPlayerSurface
          ?.factionalKillVisible === false &&
        verification.actionLoop?.invalidAction?.error === "InvalidTarget" &&
        verification.actionLoop?.legalAction?.state === "ack" &&
        verification.actionLoop?.resolvedTargetSlot?.alive === false &&
        verification.actionLoop?.d02Phase?.phaseId === "D02",
    }),
    lane(
      nightThreeActionResolutionLaneId,
      "Night 3 action resolution advances to Day 4 controls",
      {
        game: verification.actionLoop?.d02VoteNightTransition?.game ?? null,
        hostRoleUrl:
          verification.actionLoop?.d02VoteNightTransition?.hostRoleUrl ?? null,
        actionRoleUrl:
          verification.actionLoop?.d02VoteNightTransition?.actionRoleUrl ?? null,
        targetRoleUrl:
          verification.actionLoop?.d02VoteNightTransition?.playerRoleUrl ?? null,
        actionTarget:
          verification.actionLoop?.d02VoteNightTransition?.n03ActionTarget ?? null,
        actionState:
          verification.actionLoop?.d02VoteNightTransition?.n03ActionSubmission
            ?.state ?? null,
        resolveState:
          verification.actionLoop?.d02VoteNightTransition?.resolveN03
            ?.commandStatus?.state ?? null,
        targetAlive:
          verification.actionLoop?.d02VoteNightTransition?.n03ResolvedTargetSlot
            ?.alive ?? null,
        targetStatus:
          verification.actionLoop?.d02VoteNightTransition?.n03ResolvedTargetSlot
            ?.status ?? null,
        advanceState:
          verification.actionLoop?.d02VoteNightTransition?.advanceD04
            ?.commandStatus?.state ?? null,
        returnedPhase:
          verification.actionLoop?.d02VoteNightTransition?.d04ActionSurface
            ?.commandState?.phase?.phaseId ?? null,
        returnedVoteControls: countButtonsWithPrefix(
          verification.actionLoop?.d02VoteNightTransition?.d04ActionSurface
            ?.buttons,
          "submit_vote",
        ),
        deadTargetVoteControls: countButtonsWithPrefix(
          verification.actionLoop?.d02VoteNightTransition?.d04TargetSurface
            ?.buttons,
          "submit_vote",
        ),
        passed:
          verification.actionLoop?.d02VoteNightTransition?.status === "passed" &&
          verification.actionLoop?.d02VoteNightTransition?.n03ActionTarget ===
            "slot-7" &&
          verification.actionLoop?.d02VoteNightTransition?.n03ActionSubmission
            ?.state === "ack" &&
          verification.actionLoop?.d02VoteNightTransition?.n03ActionSubmission
            ?.requestEnvelope?.body?.body?.command?.SubmitAction?.actor_slot ===
            "slot_4" &&
          verification.actionLoop?.d02VoteNightTransition?.n03ActionSubmission
            ?.requestEnvelope?.body?.body?.command?.SubmitAction?.template_id ===
            "factional_kill" &&
          verification.actionLoop?.d02VoteNightTransition?.n03ActionSubmission
            ?.requestEnvelope?.body?.body?.command?.SubmitAction?.targets?.[0] ===
            "slot-7" &&
          verification.actionLoop?.d02VoteNightTransition?.resolveN03
            ?.commandStatus?.state === "ack" &&
          verification.actionLoop?.d02VoteNightTransition?.hostAfterResolveN03
            ?.phase?.id === "N03" &&
          verification.actionLoop?.d02VoteNightTransition?.hostAfterResolveN03
            ?.phase?.locked === true &&
          verification.actionLoop?.d02VoteNightTransition?.n03ResolvedTargetSlot
            ?.slot_id === "slot-7" &&
          verification.actionLoop?.d02VoteNightTransition?.n03ResolvedTargetSlot
            ?.alive === false &&
          verification.actionLoop?.d02VoteNightTransition?.n03ResolvedTargetSlot
            ?.status === "dead" &&
          verification.actionLoop?.d02VoteNightTransition?.advanceD04
            ?.commandStatus?.state === "ack" &&
          verification.actionLoop?.d02VoteNightTransition?.d04ActionSurface
            ?.commandState?.phase?.phaseId === "D04" &&
          verification.actionLoop?.d02VoteNightTransition?.d04ActionSurface
            ?.commandState?.phase?.locked === false &&
          countButtonsWithPrefix(
            verification.actionLoop?.d02VoteNightTransition?.d04ActionSurface
              ?.buttons,
            "submit_vote",
          ) > 0 &&
          verification.actionLoop?.d02VoteNightTransition?.d04TargetSurface
            ?.commandState?.actorAlive === false &&
          countButtonsWithPrefix(
            verification.actionLoop?.d02VoteNightTransition?.d04TargetSurface
              ?.buttons,
            "submit_vote",
          ) === 0,
      },
    ),
    lane("host-deadline-advance", "Host advances locked phase by deadline evidence", {
      advanceState:
        verification.actionLoop?.deadlineAdvance?.advance?.commandStatus?.state ?? null,
      commandPhase:
        verification.actionLoop?.deadlineAdvance?.command?.phase ?? null,
      observedAt:
        verification.actionLoop?.deadlineAdvance?.command?.observed_at ?? null,
      deadline:
        verification.actionLoop?.deadlineAdvance?.phaseBeforeAdvance?.deadline ?? null,
      browserPhaseAfter:
        verification.actionLoop?.deadlineAdvance?.phaseAfterAdvance?.id ?? null,
      apiPhaseAfter:
        verification.actionLoop?.deadlineAdvance?.apiPhaseAfterAdvance?.phase_id ?? null,
      passed:
        verification.actionLoop?.deadlineAdvance?.status === "passed" &&
        verification.actionLoop?.deadlineAdvance?.advance?.commandStatus?.state ===
          "ack" &&
        verification.actionLoop?.deadlineAdvance?.command?.game === session?.game &&
        verification.actionLoop?.deadlineAdvance?.command?.phase === "D01" &&
        verification.actionLoop?.deadlineAdvance?.phaseBeforeAdvance?.id === "D01" &&
        verification.actionLoop?.deadlineAdvance?.phaseBeforeAdvance?.locked === true &&
        Number.isInteger(
          verification.actionLoop?.deadlineAdvance?.phaseBeforeAdvance?.deadline,
        ) &&
        verification.actionLoop?.deadlineAdvance?.command?.observed_at ===
          verification.actionLoop?.deadlineAdvance?.phaseBeforeAdvance?.deadline + 1 &&
        verification.actionLoop?.deadlineAdvance?.phaseAfterAdvance?.id === "N01" &&
        verification.actionLoop?.deadlineAdvance?.phaseAfterAdvance?.locked === false &&
        verification.actionLoop?.deadlineAdvance?.apiPhaseAfterAdvance?.phase_id ===
          "N01" &&
        verification.actionLoop?.deadlineAdvance?.apiPhaseAfterAdvance?.locked === false &&
        verification.actionLoop?.deadlineAdvance?.apiPhaseAfterAdvance?.deadline === null,
    }),
    lane("stale-deadline-advance", "Stale deadline advance rejects and refreshes", {
      rejectError:
        verification.actionLoop?.staleDeadlineAdvance?.reject?.error ?? null,
      stalePhase:
        verification.actionLoop?.staleDeadlineAdvance?.setup?.stalePhase?.id ?? null,
      phaseAfterReject:
        verification.actionLoop?.staleDeadlineAdvance?.phaseAfterReject?.id ?? null,
      currentActions:
        verification.actionLoop?.staleDeadlineAdvance?.visibleActionsAfterReject ?? null,
      activitySource:
        verification.actionLoop?.staleDeadlineAdvance?.activityRow?.source ?? null,
      passed:
        verification.actionLoop?.staleDeadlineAdvance?.status === "passed" &&
        verification.actionLoop?.staleDeadlineAdvance?.setup?.stalePhase?.id ===
          "D01" &&
        verification.actionLoop?.staleDeadlineAdvance?.setup?.stalePhase?.locked ===
          true &&
        Number.isInteger(
          verification.actionLoop?.staleDeadlineAdvance?.setup?.stalePhase
            ?.deadline,
        ) &&
        verification.actionLoop?.staleDeadlineAdvance?.setup?.visibleActions?.includes(
          hostAdvanceByDeadlineActionId,
        ) === true &&
        verification.actionLoop?.staleDeadlineAdvance?.reject?.error ===
          "InvalidTarget" &&
        verification.actionLoop?.staleDeadlineAdvance?.reject?.message?.includes(
          "deadline target is stale",
        ) === true &&
        verification.actionLoop?.staleDeadlineAdvance?.phaseAfterReject?.id ===
          "N01" &&
        verification.actionLoop?.staleDeadlineAdvance?.phaseAfterReject?.locked ===
          false &&
        verification.actionLoop?.staleDeadlineAdvance?.activityRow?.source ===
          "outcome" &&
        verification.actionLoop?.staleDeadlineAdvance?.activityRow?.actionId ===
          hostAdvanceByDeadlineActionId &&
        verification.actionLoop?.staleDeadlineAdvance?.dispatchPlan?.projectionRefreshKeys?.includes(
          "host",
        ) === true &&
        verification.actionLoop?.staleDeadlineAdvance?.visibleActionsAfterReject?.includes(
          hostResolvePhaseActionId,
        ) === true &&
        verification.actionLoop?.staleDeadlineAdvance?.visibleActionsAfterReject?.includes(
          hostLockThreadActionId,
        ) === true &&
        verification.actionLoop?.staleDeadlineAdvance?.visibleActionsAfterReject?.includes(
          hostAdvanceByDeadlineActionId,
        ) === false &&
        verification.actionLoop?.staleDeadlineAdvance?.apiPhaseAfterReject?.phase_id ===
          "N01" &&
        verification.actionLoop?.staleDeadlineAdvance?.apiPhaseAfterReject?.locked ===
          false &&
        verification.actionLoop?.staleDeadlineAdvance?.apiPhaseAfterReject?.deadline ===
          null,
    }),
    lane(playerInvalidActionRecoveryLaneId, "Invalid action reject keeps legal controls usable", {
      rejectError: verification.invalidActionRecovery?.reject?.error ?? null,
      receiptActionId: verification.invalidActionRecovery?.currentReceipt?.actionId ?? null,
      receiptState: verification.invalidActionRecovery?.currentReceipt?.state ?? null,
      receiptStatusText:
        verification.invalidActionRecovery?.receiptStatusText ?? null,
      phase: verification.invalidActionRecovery?.commandState?.phase?.phaseId ?? null,
      actionCount: verification.invalidActionRecovery?.commandState?.actions?.length ?? null,
      legalActionVisible: verification.invalidActionRecovery?.legalActionVisible ?? null,
      refreshKeys:
        verification.invalidActionRecovery?.currentReceipt?.commandTrace
          ?.projectionRefreshKeys ?? null,
      passed:
        verification.invalidActionRecovery?.status === "passed" &&
        verification.invalidActionRecovery?.reject?.error === "InvalidTarget" &&
        verification.invalidActionRecovery?.currentReceipt?.actionId ===
          "submit_invalid_action:factional_kill" &&
        verification.invalidActionRecovery?.currentReceipt?.state === "reject" &&
        verification.invalidActionRecovery?.currentReceipt?.commandTrace?.projectionRefreshKeys?.includes(
          "commandState",
        ) === true &&
        verification.invalidActionRecovery?.commandState?.phase?.phaseId === "N01" &&
        verification.invalidActionRecovery?.commandState?.actions?.some(
          (action) => action.templateId === "factional_kill",
        ) === true &&
        verification.invalidActionRecovery?.legalActionVisible === true &&
        verification.invalidActionRecovery?.receiptStatusText?.includes(
          playerInvalidActionRecoveryMessage,
        ) === true,
    }),
    lane("resolution-receipts", "Role-scoped resolution receipts after night kill", {
      targetSlot: verification.resolutionReceipts?.targetSlot ?? null,
      hostSlotAlive: verification.resolutionReceipts?.hostSlotReceipt?.alive ?? null,
      targetNoticeEffect: verification.resolutionReceipts?.targetNotice?.effect ?? null,
      targetNoticeStatus: verification.resolutionReceipts?.targetNotice?.status ?? null,
      targetCommandActionCount:
        verification.resolutionReceipts?.targetCommandState?.actions?.length ?? null,
      actionReceiptState: verification.resolutionReceipts?.actionReceipt?.state ?? null,
      actionReceiptTarget: verification.resolutionReceipts?.actionReceipt?.target ?? null,
      normalPlayerNoticeVisible:
        verification.resolutionReceipts?.normalPlayerNoticeVisible ?? null,
      actionPlayerNoticeVisible:
        verification.resolutionReceipts?.actionPlayerNoticeVisible ?? null,
      passed:
        verification.resolutionReceipts?.status === "passed" &&
        verification.resolutionReceipts?.targetSlot === "slot-2" &&
        verification.resolutionReceipts?.hostSlotReceipt?.alive === false &&
        verification.resolutionReceipts?.hostSlotReceipt?.status === "dead" &&
        verification.resolutionReceipts?.targetNotice?.audience_slot === "slot-2" &&
        verification.resolutionReceipts?.targetNotice?.effect === "player_killed" &&
        verification.resolutionReceipts?.targetNotice?.status === "factional_kill" &&
        verification.resolutionReceipts?.targetCommandState?.actorSlot === "slot-2" &&
        verification.resolutionReceipts?.targetCommandState?.actions?.length === 0 &&
        verification.resolutionReceipts?.actionReceipt?.state === "ack" &&
        verification.resolutionReceipts?.actionReceipt?.templateId === "factional_kill" &&
        verification.resolutionReceipts?.actionReceipt?.target === "slot-2" &&
        verification.resolutionReceipts?.normalPlayerNoticeVisible === false &&
        verification.resolutionReceipts?.actionPlayerNoticeVisible === false,
    }),
    lane("dead-player-recovery", "Dead player role URL disables controls and rejects commands", {
      targetSlot: verification.deadPlayerRecovery?.targetSlot ?? null,
      actorAlive: verification.deadPlayerRecovery?.commandState?.actorAlive ?? null,
      actorStatus: verification.deadPlayerRecovery?.commandState?.actorStatus ?? null,
      phase: verification.deadPlayerRecovery?.commandState?.phase?.phaseId ?? null,
      actionControlCount: verification.deadPlayerRecovery?.actionControlCount ?? null,
      voteDisabled:
        verification.deadPlayerRecovery?.disabledControls?.vote?.disabled ?? null,
      postDisabled:
        verification.deadPlayerRecovery?.disabledControls?.post?.disabled ?? null,
      directVoteError:
        verification.deadPlayerRecovery?.directVote?.serverEnvelope?.body?.body?.error ??
        null,
      directPostError:
        verification.deadPlayerRecovery?.directPost?.serverEnvelope?.body?.body?.error ??
        null,
      directActionError:
        verification.deadPlayerRecovery?.directAction?.serverEnvelope?.body?.body?.error ??
        null,
      actionsAfterReject:
        verification.deadPlayerRecovery?.commandStateAfterRejects?.actions?.length ?? null,
      passed:
        verification.deadPlayerRecovery?.status === "passed" &&
        verification.deadPlayerRecovery?.targetSlot === "slot-2" &&
        verification.deadPlayerRecovery?.commandState?.actorAlive === false &&
        verification.deadPlayerRecovery?.commandState?.actorStatus === "dead" &&
        verification.deadPlayerRecovery?.commandState?.phase?.phaseId === "D02" &&
        verification.deadPlayerRecovery?.commandState?.actions?.length === 0 &&
        verification.deadPlayerRecovery?.channelContext?.actorAlive === "false" &&
        verification.deadPlayerRecovery?.channelContext?.actorStatus === "dead" &&
        verification.deadPlayerRecovery?.disabledControls?.vote?.disabled === true &&
        verification.deadPlayerRecovery?.disabledControls?.withdraw?.disabled ===
          true &&
        verification.deadPlayerRecovery?.disabledControls?.post?.disabled === true &&
        verification.deadPlayerRecovery?.actionControlCount === 0 &&
        verification.deadPlayerRecovery?.directVote?.serverEnvelope?.body?.body?.error ===
          "SlotNotAlive" &&
        verification.deadPlayerRecovery?.directPost?.serverEnvelope?.body?.body?.error ===
          "SlotNotAlive" &&
        verification.deadPlayerRecovery?.directAction?.serverEnvelope?.body?.body?.error ===
          "SlotNotAlive" &&
        verification.deadPlayerRecovery?.commandStateAfterRejects?.actorAlive === false &&
        verification.deadPlayerRecovery?.commandStateAfterRejects?.actions?.length === 0,
    }),
    lane(playerActionBoundaryLaneId, "Player role URL hides and rejects unowned night actions", {
      phase: verification.playerActionBoundary?.phase?.phaseId ?? null,
      commandActionCount:
        verification.playerActionBoundary?.commandActions?.length ?? null,
      factionalKillVisible:
        verification.playerActionBoundary?.factionalKillVisible ?? null,
      directRejectError:
        verification.playerActionBoundary?.directFactionalKill?.serverEnvelope?.body?.body
          ?.error ?? null,
      directRejectPrincipal:
        verification.playerActionBoundary?.directFactionalKill?.requestEnvelope?.body?.body
          ?.principal_user_id ?? null,
      phaseAfterReject:
        verification.playerActionBoundary?.phaseAfterReject?.phaseId ?? null,
      actionVisibleAfterReject:
        verification.playerActionBoundary?.actionVisibleAfterReject ?? null,
      passed:
        verification.playerActionBoundary?.status === "passed" &&
        verification.playerActionBoundary?.phase?.phaseId === "N01" &&
        verification.playerActionBoundary?.commandActions?.length === 0 &&
        verification.playerActionBoundary?.factionalKillVisible === false &&
        verification.playerActionBoundary?.directFactionalKill?.serverEnvelope?.body?.kind ===
          "Reject" &&
        verification.playerActionBoundary?.directFactionalKill?.serverEnvelope?.body?.body
          ?.error === "InvalidTarget" &&
        verification.playerActionBoundary?.directFactionalKill?.requestEnvelope?.body?.body
          ?.principal_user_id === "player-mira" &&
        verification.playerActionBoundary?.phaseAfterReject?.phaseId === "N01" &&
        verification.playerActionBoundary?.actionVisibleAfterReject === false,
    }),
    lane(coreLoopPrivateChannelPostLaneId, "Private channel member post and denied recovery", {
      channel: verification.privateChannel?.channel ?? null,
      allowedState: verification.privateChannel?.allowed?.submitPost?.state ?? null,
      deniedStatus: verification.privateChannel?.denied?.status ?? null,
      passed:
        verification.privateChannel?.status === "passed" &&
        verification.privateChannel?.channel === "private:mafia_day_chat" &&
        verification.privateChannel?.allowed?.submitPost?.state === "ack" &&
        verification.privateChannel?.denied?.status === 403,
    }),
    lane(
      coreLoopPrivateChannelStalePostLaneId,
      "Private channel stale post after phase transition",
      {
        channel:
          verification.privateChannel?.stalePostAfterPhaseTransition?.channel ??
          null,
        state:
          verification.privateChannel?.stalePostAfterPhaseTransition?.stalePost
            ?.state ?? null,
        receiptStatusText:
          verification.privateChannel?.stalePostAfterPhaseTransition
            ?.receiptStatusText ?? null,
        refreshedPhase:
          verification.privateChannel?.stalePostAfterPhaseTransition
            ?.commandStateAfterAck?.phase?.phaseId ?? null,
        refreshedLocked:
          verification.privateChannel?.stalePostAfterPhaseTransition
            ?.commandStateAfterAck?.phase?.locked ?? null,
        projectedPostBody:
          verification.privateChannel?.stalePostAfterPhaseTransition
            ?.projectedPost?.body ?? null,
        normalizedProofStatus: privateChannelSubmitPostAckProof?.status ?? null,
        submitPostAckProof: privateChannelSubmitPostAckProof ?? null,
        passed:
          verification.privateChannel?.stalePostAfterPhaseTransition?.status ===
            "passed" &&
          privateChannelSubmitPostAckProofPassed &&
          verification.privateChannel?.stalePostAfterPhaseTransition?.laneId ===
            coreLoopPrivateChannelStalePostLaneId &&
          verification.privateChannel?.stalePostAfterPhaseTransition?.channel ===
            "private:mafia_day_chat" &&
          verification.privateChannel?.stalePostAfterPhaseTransition?.stalePost
            ?.state === "ack" &&
          verification.privateChannel?.stalePostAfterPhaseTransition?.stalePost
            ?.requestEnvelope?.body?.body?.command?.SubmitPost?.channel_id ===
            "private:mafia_day_chat" &&
          verification.privateChannel?.stalePostAfterPhaseTransition?.stalePost
            ?.requestEnvelope?.body?.body?.command?.SubmitPost?.body ===
            verification.privateChannel?.stalePostAfterPhaseTransition?.postBody &&
          verification.privateChannel?.stalePostAfterPhaseTransition
            ?.receiptStatusText?.includes("Ack") === true &&
          verification.privateChannel?.stalePostAfterPhaseTransition
            ?.commandStateAfterAck?.phase?.locked === true &&
          verification.privateChannel?.stalePostAfterPhaseTransition
            ?.commandStateAfterAck?.currentVote === null &&
          verification.privateChannel?.stalePostAfterPhaseTransition
            ?.commandStateAfterAck?.voteTargets?.length === 0 &&
          verification.privateChannel?.stalePostAfterPhaseTransition
            ?.dispatchPlan?.projectionRefreshKeys?.includes("thread") === true &&
          verification.privateChannel?.stalePostAfterPhaseTransition
            ?.dispatchPlan?.projectionRefreshKeys?.includes("commandState") ===
            true &&
          verification.privateChannel?.stalePostAfterPhaseTransition
            ?.dispatchPlan?.projectionRefreshKeys?.includes("dayVoteOutcomes") ===
            true &&
          verification.privateChannel?.stalePostAfterPhaseTransition
            ?.apiThreadAfterAck?.posts?.some(
              (post) =>
                post.body ===
                verification.privateChannel?.stalePostAfterPhaseTransition
                  ?.postBody,
            ) === true,
      },
    ),
    lane(
      coreLoopPrivateChannelCompletedPostLaneId,
      "Private channel completed-game recovery",
      {
        channel:
          verification.privateChannel?.completedGameRecovery?.channel ?? null,
        receiptStatusText:
          verification.privateChannel?.completedGameRecovery
            ?.receiptStatusText ?? null,
        state:
          verification.privateChannel?.completedGameRecovery?.reject?.state ??
          null,
        error:
          verification.privateChannel?.completedGameRecovery?.reject?.error ??
          null,
        gameCompleted:
          verification.privateChannel?.completedGameRecovery
            ?.commandStateAfterReject?.gameCompleted ?? null,
        reloadStatus:
          verification.privateChannel?.completedGameRecovery?.reloadAfterReject
            ?.routeResponseStatus ?? null,
        reloadGameCompleted:
          verification.privateChannel?.completedGameRecovery?.reloadAfterReject
            ?.recoveredCommandState?.gameCompleted ?? null,
        threadPostPresent:
          verification.privateChannel?.completedGameRecovery?.apiThreadPostBodies?.includes(
            verification.privateChannel?.completedGameRecovery?.postBody,
          ) ?? null,
        reloadControlsDisabled:
          verification.privateChannel?.completedGameRecovery?.reloadAfterReject
            ?.reloadButtons?.some((button) => button.disabled !== true) ===
          false,
        reloadRejectedPostVisible:
          verification.privateChannel?.completedGameRecovery?.reloadAfterReject
            ?.reloadRejectedPostVisible ?? null,
        normalizedProofStatus:
          privateChannelCompletedPostRejectProof?.status ?? null,
        completedPostRejectProof: privateChannelCompletedPostRejectProof ?? null,
        passed:
          verification.privateChannel?.completedGameRecovery?.status ===
            "passed" &&
          privateChannelCompletedPostRejectProofPassed &&
          verification.privateChannel?.completedGameRecovery?.laneId ===
            coreLoopPrivateChannelCompletedPostLaneId &&
          verification.privateChannel?.completedGameRecovery?.channel ===
            "private:mafia_day_chat" &&
          verification.privateChannel?.completedGameRecovery?.closedStatus
            ?.state === "closed" &&
          verification.privateChannel?.completedGameRecovery?.complete
            ?.commandStatus?.state === "ack" &&
          verification.privateChannel?.completedGameRecovery?.reject?.state ===
            "reject" &&
          verification.privateChannel?.completedGameRecovery?.reject?.error ===
            "GameAlreadyCompleted" &&
          verification.privateChannel?.completedGameRecovery?.receiptStatusText?.includes(
            staleCompletedPrivatePostScenario().commandMessage,
          ) === true &&
          verification.privateChannel?.completedGameRecovery?.reject
            ?.requestEnvelope?.body?.body?.command?.SubmitPost?.channel_id ===
            "private:mafia_day_chat" &&
          verification.privateChannel?.completedGameRecovery?.reject
            ?.requestEnvelope?.body?.body?.command?.SubmitPost?.actor_slot ===
            "slot-7" &&
          verification.privateChannel?.completedGameRecovery?.reject
            ?.requestEnvelope?.body?.body?.command?.SubmitPost?.body ===
            verification.privateChannel?.completedGameRecovery?.postBody &&
          verification.privateChannel?.completedGameRecovery
            ?.commandStateAfterReject?.gameCompleted === true &&
          verification.privateChannel?.completedGameRecovery
            ?.commandStateAfterReject?.actions?.length === 0 &&
          verification.privateChannel?.completedGameRecovery
            ?.commandStateAfterReject?.voteTargets?.length === 0 &&
          verification.privateChannel?.completedGameRecovery
            ?.dispatchPlan?.projectionRefreshKeys?.includes("commandState") ===
            true &&
          verification.privateChannel?.completedGameRecovery
            ?.apiThreadPostBodies?.includes(
              verification.privateChannel?.completedGameRecovery?.postBody,
            ) === false &&
          verification.privateChannel?.completedGameRecovery?.reloadAfterReject
            ?.status === "passed" &&
          verification.privateChannel?.completedGameRecovery?.reloadAfterReject
            ?.routeResponseStatus === 200 &&
          verification.privateChannel?.completedGameRecovery?.reloadAfterReject
            ?.recoveredCommandState?.gameCompleted === true &&
          verification.privateChannel?.completedGameRecovery?.reloadAfterReject
            ?.reloadChannelContext?.channelId === "private:mafia_day_chat" &&
          verification.privateChannel?.completedGameRecovery?.reloadAfterReject
            ?.reloadButtons?.some((button) => button.disabled !== true) ===
            false &&
          verification.privateChannel?.completedGameRecovery?.reloadAfterReject
            ?.reloadRejectedPostVisible === false &&
          verification.privateChannel?.completedGameRecovery?.reloadAfterReject
            ?.apiThreadPostBodiesAfterReload?.includes(
              verification.privateChannel?.completedGameRecovery?.postBody,
            ) === false,
      },
    ),
    lane(
      coreLoopPrivateChannelInvalidActionLaneId,
      "Private channel invalid action recovery",
      {
        channel:
          verification.actionLoop?.privateChannelInvalidActionRecovery
            ?.channel ?? null,
        state:
          verification.actionLoop?.privateChannelInvalidActionRecovery
            ?.reject?.state ?? null,
        error:
          verification.actionLoop?.privateChannelInvalidActionRecovery
            ?.reject?.error ?? null,
        receiptStatusText:
          verification.actionLoop?.privateChannelInvalidActionRecovery
            ?.receiptStatusText ?? null,
        routeStatus:
          verification.actionLoop?.privateChannelInvalidActionRecovery?.route
            ?.responseStatus ?? null,
        actorSlot:
          verification.actionLoop?.privateChannelInvalidActionRecovery
            ?.afterRejectSnapshot?.channelContext?.actorSlot ?? null,
        actionTemplateId:
          verification.actionLoop?.privateChannelInvalidActionRecovery?.reject
            ?.requestEnvelope?.body?.body?.command?.SubmitAction
            ?.template_id ?? null,
        refreshCommandState:
          verification.actionLoop?.privateChannelInvalidActionRecovery
            ?.currentReceipt?.commandTrace?.projectionRefreshKeys?.includes(
              "commandState",
            ) ?? null,
        channelContextPreserved:
          verification.actionLoop?.privateChannelInvalidActionRecovery
            ?.afterRejectSnapshot?.channelContext?.channelId ===
          privateChannelInvalidActionRecovery.channelId,
        phase:
          verification.actionLoop?.privateChannelInvalidActionRecovery
            ?.afterRejectSnapshot?.commandState?.phase?.phaseId ?? null,
        legalActionVisible:
          verification.actionLoop?.privateChannelInvalidActionRecovery
            ?.legalActionVisibleAfterReject ?? null,
        apiLegalActionAvailable:
          verification.actionLoop?.privateChannelInvalidActionRecovery
            ?.apiCommandStateAfterReject?.actions?.some(
              (action) =>
                action.template_id ===
                privateChannelInvalidActionRecovery.expectedActionTemplateId,
            ) ?? null,
        privateThreadPagerVisible:
          verification.actionLoop?.privateChannelInvalidActionRecovery
            ?.privateThreadPagerVisible ?? null,
        passed:
          verification.actionLoop?.privateChannelInvalidActionRecovery
            ?.status === "passed" &&
          verification.actionLoop?.privateChannelInvalidActionRecovery
            ?.laneId === privateChannelInvalidActionRecovery.laneId &&
          verification.actionLoop?.privateChannelInvalidActionRecovery
            ?.channel === privateChannelInvalidActionRecovery.channelId &&
          verification.actionLoop?.privateChannelInvalidActionRecovery?.route
            ?.responseStatus === 200 &&
          verification.actionLoop?.privateChannelInvalidActionRecovery
            ?.reject?.state === "reject" &&
          verification.actionLoop?.privateChannelInvalidActionRecovery
            ?.reject?.error === privateChannelInvalidActionRecovery.commandError &&
          verification.actionLoop?.privateChannelInvalidActionRecovery
            ?.reject?.requestEnvelope?.body?.body?.command?.SubmitAction
            ?.actor_slot === privateChannelInvalidActionRecovery.actorSlot &&
          verification.actionLoop?.privateChannelInvalidActionRecovery
            ?.reject?.requestEnvelope?.body?.body?.command?.SubmitAction
            ?.template_id ===
            privateChannelInvalidActionRecovery.expectedActionTemplateId &&
          verification.actionLoop?.privateChannelInvalidActionRecovery
            ?.reject?.requestEnvelope?.body?.body?.command?.SubmitAction
            ?.targets?.[0] === privateChannelInvalidActionRecovery.actorSlot &&
          verification.actionLoop?.privateChannelInvalidActionRecovery
            ?.currentReceipt?.actionId ===
            privateChannelInvalidActionRecovery.clickedAction &&
          verification.actionLoop?.privateChannelInvalidActionRecovery
            ?.currentReceipt?.state === "reject" &&
          privateChannelInvalidActionRecovery.expectedRefreshKeys.every(
            (key) =>
              verification.actionLoop?.privateChannelInvalidActionRecovery
                ?.currentReceipt?.commandTrace?.projectionRefreshKeys?.includes(
                  key,
                ) === true,
          ) &&
          verification.actionLoop?.privateChannelInvalidActionRecovery
            ?.receiptStatusText?.includes(
              privateChannelInvalidActionRecovery.commandMessage,
            ) === true &&
          verification.actionLoop?.privateChannelInvalidActionRecovery
            ?.afterRejectSnapshot?.channelContext?.channelId ===
            privateChannelInvalidActionRecovery.channelId &&
          verification.actionLoop?.privateChannelInvalidActionRecovery
            ?.afterRejectSnapshot?.channelContext?.actorSlot ===
            privateChannelInvalidActionRecovery.actorSlot &&
          verification.actionLoop?.privateChannelInvalidActionRecovery
            ?.afterRejectSnapshot?.commandState?.phase?.phaseId ===
            privateChannelInvalidActionRecovery.expectedPhaseId &&
          verification.actionLoop?.privateChannelInvalidActionRecovery
            ?.afterRejectSnapshot?.commandState?.actions?.some(
              (action) =>
                action.templateId ===
                privateChannelInvalidActionRecovery.expectedActionTemplateId,
            ) === true &&
          verification.actionLoop?.privateChannelInvalidActionRecovery
            ?.apiCommandStateAfterReject?.actions?.some(
              (action) =>
                action.template_id ===
                privateChannelInvalidActionRecovery.expectedActionTemplateId,
            ) === true &&
          verification.actionLoop?.privateChannelInvalidActionRecovery
            ?.legalActionVisibleAfterReject === true &&
          verification.actionLoop?.privateChannelInvalidActionRecovery
            ?.privateThreadPagerVisible === true,
      },
    ),
    lane("replacement-host-issued-invite", "Host issues incoming replacement role URL", {
      principalUserId:
        verification.replacementConsole?.hostIssuedInvite?.session?.principalUserId ??
        null,
      issuedBy:
        verification.replacementConsole?.hostIssuedInvite?.session?.issuedBy
          ?.principalUserId ?? null,
      issuedByCapability:
        verification.replacementConsole?.hostIssuedInvite?.session?.issuedBy
          ?.capabilityKind ?? null,
      returnTo: verification.replacementConsole?.hostIssuedInvite?.session?.returnTo ?? null,
      tokenPresent:
        verification.replacementConsole?.hostIssuedInvite?.tokenPresent ?? null,
      targetLabel:
        verification.replacementConsole?.hostIssuedInvite?.targetLabel ?? null,
      passed:
        verification.replacementConsole?.hostIssuedInvite?.status === "passed" &&
        verification.replacementConsole?.hostIssuedInvite?.session?.principalUserId ===
          "player-rowan" &&
        verification.replacementConsole?.hostIssuedInvite?.session?.issuedBy
          ?.principalUserId === "host_h" &&
        verification.replacementConsole?.hostIssuedInvite?.session?.issuedBy
          ?.capabilityKind === "HostOf" &&
        verification.replacementConsole?.hostIssuedInvite?.session?.issuedBy?.game ===
          session?.game &&
        verification.replacementConsole?.hostIssuedInvite?.session?.returnTo ===
          `/g/${session?.game ?? ""}` &&
        verification.replacementConsole?.hostIssuedInvite?.targetLabel ===
          "Slot 7 / player-rowan" &&
        verification.replacementConsole?.hostIssuedInvite?.tokenPresent === true,
    }),
    lane("replacement-pending-player", "Incoming replacement URL waits without slot authority", {
      principalUserId:
        verification.replacementConsole?.pendingIncomingPlayer?.principalUserId ?? null,
      capabilityKinds:
        verification.replacementConsole?.pendingIncomingPlayer?.capabilityKinds ?? null,
      capabilityLabel:
        verification.replacementConsole?.pendingIncomingPlayer?.capabilityLabel ?? null,
      actorStatus:
        verification.replacementConsole?.pendingIncomingPlayer?.commandState?.actorStatus ??
        null,
      commandStateEndpoint:
        verification.replacementConsole?.pendingIncomingPlayer?.coldLoadEndpoints
          ?.commandStateEndpoint ?? null,
      primaryButtons:
        verification.replacementConsole?.pendingIncomingPlayer?.controlCounts
          ?.primaryButtons ?? null,
      passed:
        verification.replacementConsole?.pendingIncomingPlayer?.status === "passed" &&
        verification.replacementConsole?.pendingIncomingPlayer?.principalUserId ===
          "player-rowan" &&
        verification.replacementConsole?.pendingIncomingPlayer?.capabilityKinds?.length ===
          0 &&
        verification.replacementConsole?.pendingIncomingPlayer?.capabilityLabel ===
          `PendingReplacement(${session?.game ?? ""})` &&
        verification.replacementConsole?.pendingIncomingPlayer?.routeStateText?.includes(
          "Replacement invite accepted",
        ) === true &&
        verification.replacementConsole?.pendingIncomingPlayer?.commandState
          ?.actorStatus === "pending_replacement" &&
        verification.replacementConsole?.pendingIncomingPlayer?.commandState?.actions
          ?.length === 0 &&
        verification.replacementConsole?.pendingIncomingPlayer?.coldLoadEndpoints
          ?.commandStateEndpoint === null &&
        verification.replacementConsole?.pendingIncomingPlayer?.controlCounts
          ?.primaryButtons === 0 &&
        verification.replacementConsole?.pendingIncomingPlayer?.controlCounts
          ?.actionButtons === 0,
    }),
    lane("replacement-redeemed-invite-recovery", "Redeemed replacement invite cannot mint another session", {
      message:
        verification.replacementConsole?.redeemedInviteRecovery?.message ?? null,
      prefilledInviteToken:
        verification.replacementConsole?.redeemedInviteRecovery
          ?.prefilledInviteToken ?? null,
      sessionCookiePresent:
        verification.replacementConsole?.redeemedInviteRecovery
          ?.sessionCookiePresent ?? null,
      stayedOnLogin:
        verification.replacementConsole?.redeemedInviteRecovery?.stayedOnLogin ??
        null,
      passed:
        verification.replacementConsole?.redeemedInviteRecovery?.status === "passed" &&
        verification.replacementConsole?.redeemedInviteRecovery?.message ===
          "Session or invite token is missing, expired, or revoked" &&
        verification.replacementConsole?.redeemedInviteRecovery
          ?.prefilledInviteToken === true &&
        verification.replacementConsole?.redeemedInviteRecovery
          ?.sessionCookiePresent === false &&
        verification.replacementConsole?.redeemedInviteRecovery?.stayedOnLogin ===
          true,
    }),
    lane("replacement-session-revocation-recovery", "Revoked replacement session returns to recovery boundary", {
      revokedPrincipalUserId:
        verification.replacementConsole?.replacementSessionRevocation
          ?.revokedPrincipalUserId ?? null,
      apiSessionStatus:
        verification.replacementConsole?.replacementSessionRevocation
          ?.apiSessionStatus ?? null,
      routeErrorStatus:
        verification.replacementConsole?.replacementSessionRevocation
          ?.routeErrorStatus ?? null,
      routeErrorActionHref:
        verification.replacementConsole?.replacementSessionRevocation
          ?.routeErrorActionHref ?? null,
      playerSurfaceVisible:
        verification.replacementConsole?.replacementSessionRevocation
          ?.playerSurfaceVisible ?? null,
      primaryButtons:
        verification.replacementConsole?.replacementSessionRevocation
          ?.controlCounts?.primaryButtons ?? null,
      actionButtons:
        verification.replacementConsole?.replacementSessionRevocation
          ?.controlCounts?.actionButtons ?? null,
      passed:
        verification.replacementConsole?.replacementSessionRevocation?.status ===
          "passed" &&
        verification.replacementConsole?.replacementSessionRevocation
          ?.revokedPrincipalUserId === "player-rowan" &&
        verification.replacementConsole?.replacementSessionRevocation
          ?.apiSessionStatus === 401 &&
        verification.replacementConsole?.replacementSessionRevocation
          ?.routeErrorStatus === 403 &&
        verification.replacementConsole?.replacementSessionRevocation
          ?.routeErrorActionHref === "/" &&
        verification.replacementConsole?.replacementSessionRevocation
          ?.playerSurfaceVisible === false &&
        verification.replacementConsole?.replacementSessionRevocation
          ?.controlCounts?.primaryButtons === 0 &&
        verification.replacementConsole?.replacementSessionRevocation
          ?.controlCounts?.actionButtons === 0,
    }),
    lane("replacement-session-refresh-recovery", "Fresh replacement session restores role URL", {
      credentialKind:
        verification.replacementConsole?.replacementSessionRefresh?.session
          ?.credentialKind ?? null,
      principalUserId:
        verification.replacementConsole?.replacementSessionRefresh?.session
          ?.principalUserId ?? null,
      usedInviteToken:
        verification.replacementConsole?.replacementSessionRefresh?.login
          ?.usedInviteToken ?? null,
      landedOnDirectUrl:
        verification.replacementConsole?.replacementSessionRefresh?.login
          ?.landedOnDirectUrl ?? null,
      capabilityKinds:
        verification.replacementConsole?.replacementSessionRefresh?.browserEntry
          ?.capabilityKinds ?? null,
      commandStateSlot:
        verification.replacementConsole?.replacementSessionRefresh?.commandState
          ?.actorSlot ?? null,
      postState:
        verification.replacementConsole?.replacementSessionRefresh?.postStatus?.state ??
        null,
      targetKillVisible:
        verification.replacementConsole?.replacementSessionRefresh
          ?.privateReceiptIsolation?.targetKillVisible ?? null,
      actionResultVisible:
        verification.replacementConsole?.replacementSessionRefresh
          ?.privateReceiptIsolation?.actionResultVisible ?? null,
      passed:
        verification.replacementConsole?.replacementSessionRefresh?.status ===
          "passed" &&
        verification.replacementConsole?.replacementSessionRefresh?.session
          ?.credentialKind === "session" &&
        verification.replacementConsole?.replacementSessionRefresh?.session
          ?.principalUserId === "player-rowan" &&
        verification.replacementConsole?.replacementSessionRefresh?.login
          ?.usedInviteToken === false &&
        verification.replacementConsole?.replacementSessionRefresh?.login
          ?.landedOnDirectUrl === true &&
        verification.replacementConsole?.replacementSessionRefresh?.browserEntry
          ?.principalUserId === "player-rowan" &&
        verification.replacementConsole?.replacementSessionRefresh?.browserEntry
          ?.capabilityKinds?.includes("SlotOccupant") === true &&
        verification.replacementConsole?.replacementSessionRefresh?.commandState
          ?.actorSlot === "slot-7" &&
        verification.replacementConsole?.replacementSessionRefresh?.commandState
          ?.actorAlive === true &&
        verification.replacementConsole?.replacementSessionRefresh?.postStatus
          ?.state === "ack" &&
        verification.replacementConsole?.replacementSessionRefresh?.postStatus
          ?.requestEnvelope?.body?.body?.principal_user_id === "player-rowan" &&
        verification.replacementConsole?.replacementSessionRefresh?.postStatus
          ?.requestEnvelope?.body?.body?.command?.SubmitPost?.actor_slot ===
          "slot-7" &&
        verification.replacementConsole?.replacementSessionRefresh?.rowanProjectedPost
          ?.authorSlot === "slot-7" &&
        verification.replacementConsole?.replacementSessionRefresh
          ?.privateReceiptIsolation?.targetKillVisible === false &&
        verification.replacementConsole?.replacementSessionRefresh
          ?.privateReceiptIsolation?.actionResultVisible === false,
    }),
    lane("replacement-stale-session-after-refresh", "Stale revoked replacement session stays inert", {
      apiSessionStatus:
        verification.replacementConsole?.replacementStaleSessionAfterRefresh
          ?.apiSessionStatus ?? null,
      routeErrorStatus:
        verification.replacementConsole?.replacementStaleSessionAfterRefresh
          ?.routeErrorStatus ?? null,
      routeErrorActionHref:
        verification.replacementConsole?.replacementStaleSessionAfterRefresh
          ?.routeErrorActionHref ?? null,
      playerSurfaceVisible:
        verification.replacementConsole?.replacementStaleSessionAfterRefresh
          ?.playerSurfaceVisible ?? null,
      primaryButtons:
        verification.replacementConsole?.replacementStaleSessionAfterRefresh
          ?.controlCounts?.primaryButtons ?? null,
      actionButtons:
        verification.replacementConsole?.replacementStaleSessionAfterRefresh
          ?.controlCounts?.actionButtons ?? null,
      staleCookieValuePrefix:
        verification.replacementConsole?.replacementStaleSessionAfterRefresh
          ?.staleCookie?.valuePrefix ?? null,
      freshCredentialKind:
        verification.replacementConsole?.replacementStaleSessionAfterRefresh
          ?.freshCredentialKind ?? null,
      freshRoleUrlHasInvite:
        verification.replacementConsole?.replacementStaleSessionAfterRefresh
          ?.freshRoleUrlHasInvite ?? null,
      passed:
        verification.replacementConsole?.replacementStaleSessionAfterRefresh
          ?.status === "passed" &&
        verification.replacementConsole?.replacementStaleSessionAfterRefresh
          ?.apiSessionStatus === 401 &&
        verification.replacementConsole?.replacementStaleSessionAfterRefresh
          ?.routeErrorStatus === 403 &&
        verification.replacementConsole?.replacementStaleSessionAfterRefresh
          ?.routeErrorActionHref === "/" &&
        verification.replacementConsole?.replacementStaleSessionAfterRefresh
          ?.playerSurfaceVisible === false &&
        verification.replacementConsole?.replacementStaleSessionAfterRefresh
          ?.controlCounts?.primaryButtons === 0 &&
        verification.replacementConsole?.replacementStaleSessionAfterRefresh
          ?.controlCounts?.actionButtons === 0 &&
        verification.replacementConsole?.replacementStaleSessionAfterRefresh
          ?.staleCookie?.valuePrefix === "invite-session-" &&
        verification.replacementConsole?.replacementStaleSessionAfterRefresh
          ?.freshCredentialKind === "session" &&
        verification.replacementConsole?.replacementStaleSessionAfterRefresh
          ?.freshRoleUrlHasInvite === false,
    }),
    lane("replacement-reconnect-recovery", "Replacement player reconnect recovers Slot 7 state", {
      principalUserId:
        verification.replacementConsole?.replacementReconnectRecovery
          ?.principalUserId ?? null,
      actorSlot:
        verification.replacementConsole?.replacementReconnectRecovery?.actorSlot ??
        null,
      reconnectingState:
        verification.replacementConsole?.replacementReconnectRecovery
          ?.reconnectingStatus?.state ?? null,
      recoveryState:
        verification.replacementConsole?.replacementReconnectRecovery
          ?.reconnectRecoveryEvent?.state ?? null,
      recoveredSnapshotContainsPost:
        verification.replacementConsole?.replacementReconnectRecovery
          ?.recoveredSnapshotContainsPost ?? null,
      recoveredCommandStateSlot:
        verification.replacementConsole?.replacementReconnectRecovery
          ?.recoveredCommandState?.actorSlot ?? null,
      recoveredCommandStateAlive:
        verification.replacementConsole?.replacementReconnectRecovery
          ?.recoveredCommandState?.actorAlive ?? null,
      passed:
        verification.replacementConsole?.replacementReconnectRecovery?.status ===
          "passed" &&
        verification.replacementConsole?.replacementReconnectRecovery
          ?.principalUserId === "player-rowan" &&
        verification.replacementConsole?.replacementReconnectRecovery?.actorSlot ===
          "slot-7" &&
        verification.replacementConsole?.replacementReconnectRecovery
          ?.reconnectingStatus?.state === "reconnecting" &&
        verification.replacementConsole?.replacementReconnectRecovery
          ?.reconnectRecoveryEvent?.state === "recovered" &&
        verification.replacementConsole?.replacementReconnectRecovery
          ?.reconnectRecoveryEvent?.attempt === 1 &&
        verification.replacementConsole?.replacementReconnectRecovery
          ?.recoveredSnapshotContainsPost === true &&
        verification.replacementConsole?.replacementReconnectRecovery
          ?.reconnectCommand?.principalUserId ===
          "player-rowan" &&
        verification.replacementConsole?.replacementReconnectRecovery
          ?.reconnectCommand?.command?.SubmitPost?.actor_slot === "slot-7" &&
        verification.replacementConsole?.replacementReconnectRecovery
          ?.recoveredCommandState?.actorSlot === "slot-7" &&
        verification.replacementConsole?.replacementReconnectRecovery
          ?.recoveredCommandState?.actorAlive === true,
    }),
    lane("stale-host-invite-recovery", "Stale host player invite recovers to current occupant", {
      beforePrincipalUserId:
        verification.replacementConsole?.staleHostInviteRecovery?.beforeSubmit
          ?.principalUserId ?? null,
      rejectMessage:
        verification.replacementConsole?.staleHostInviteRecovery?.reject?.message ??
        null,
      urlRendered:
        verification.replacementConsole?.staleHostInviteRecovery?.reject
          ?.urlRendered ?? null,
      retryState:
        verification.replacementConsole?.staleHostInviteRecovery?.retry?.state ??
        null,
      retryPrincipalUserId:
        verification.replacementConsole?.staleHostInviteRecovery?.retry?.target
          ?.principalUserId ?? null,
      retryExpectedOccupantUserId:
        verification.replacementConsole?.staleHostInviteRecovery?.retry?.target
          ?.expectedOccupantUserId ?? null,
      retrySlotId:
        verification.replacementConsole?.staleHostInviteRecovery?.retry?.target
          ?.slotId ?? null,
      passed:
        verification.replacementConsole?.staleHostInviteRecovery?.status === "passed" &&
        verification.replacementConsole?.staleHostInviteRecovery?.beforeSubmit
          ?.principalUserId === "player-mira" &&
        verification.replacementConsole?.staleHostInviteRecovery?.beforeSubmit
          ?.expectedOccupantUserId === "player-mira" &&
        verification.replacementConsole?.staleHostInviteRecovery?.reject?.message?.includes(
          "Invite target is stale",
        ) === true &&
        verification.replacementConsole?.staleHostInviteRecovery?.reject
          ?.urlRendered === false &&
        verification.replacementConsole?.staleHostInviteRecovery?.retry?.state ===
          "ack" &&
        verification.replacementConsole?.staleHostInviteRecovery?.retry?.target
          ?.principalUserId === "player-rowan" &&
        verification.replacementConsole?.staleHostInviteRecovery?.retry?.target
          ?.expectedOccupantUserId === "player-rowan" &&
        verification.replacementConsole?.staleHostInviteRecovery?.retry?.target
          ?.slotId === "slot-7" &&
        verification.replacementConsole?.staleHostInviteRecovery?.retry?.loginUrl?.includes(
          `invite=player-${session?.game ?? ""}-`,
        ) === true,
    }),
    lane("replacement-stale-conflict-message", "Stale replacement conflict message is explicit", {
      roleUrl: session?.sessions?.host?.directUrl ?? null,
      rejectError:
        verification.replacementConsole?.staleReplacementAfterSuccess?.reject?.error ??
        null,
      activityStatus:
        verification.replacementConsole?.staleReplacementAfterSuccess
          ?.activityStatusText ?? null,
      activitySource:
        verification.replacementConsole?.staleReplacementAfterSuccess?.activityRow
          ?.source ?? null,
      actionId:
        verification.replacementConsole?.staleReplacementAfterSuccess?.activityRow
          ?.actionId ?? null,
      dispatchKind:
        verification.replacementConsole?.staleReplacementAfterSuccess?.activityRow
          ?.dispatchKind ?? null,
      commandOutgoing:
        verification.replacementConsole?.staleReplacementAfterSuccess
          ?.invalidReplacement?.requestEnvelope?.body?.body?.command
          ?.ProcessReplacement?.outgoing_user ?? null,
      currentOccupant:
        verification.replacementConsole?.staleReplacementAfterSuccess
          ?.apiSlotAfterReject?.occupant_user_id ?? null,
      passed:
        typeof session?.sessions?.host?.directUrl === "string" &&
        session.sessions.host.directUrl.includes(`/g/${session?.game ?? ""}/host`) &&
        verification.replacementConsole?.staleReplacementAfterSuccess?.status ===
          "passed" &&
        verification.replacementConsole?.staleReplacementAfterSuccess?.reject
          ?.error === "InvalidTarget" &&
        verification.replacementConsole?.staleReplacementAfterSuccess
          ?.activityStatusText?.includes("Reject InvalidTarget") === true &&
        verification.replacementConsole?.staleReplacementAfterSuccess
          ?.activityStatusText?.includes("replacement target is stale") === true &&
        verification.replacementConsole?.staleReplacementAfterSuccess
          ?.activityStatusText?.includes("current slot occupant") === true &&
        verification.replacementConsole?.staleReplacementAfterSuccess?.activityRow
          ?.source === "outcome" &&
        verification.replacementConsole?.staleReplacementAfterSuccess?.activityRow
          ?.actionId === "process_replacement_stale_success" &&
        verification.replacementConsole?.staleReplacementAfterSuccess?.activityRow
          ?.dispatchKind === "process_replacement" &&
        verification.replacementConsole?.staleReplacementAfterSuccess
          ?.invalidReplacement?.requestEnvelope?.body?.body?.command
          ?.ProcessReplacement?.outgoing_user === "player-mira" &&
        verification.replacementConsole?.staleReplacementAfterSuccess
          ?.apiSlotAfterReject?.occupant_user_id === "player-rowan",
    }),
    lane("replacement-invalid-target-recovery", "Invalid replacement leaves URL pending", {
      rejectError:
        verification.replacementConsole?.invalidReplacementRecovery?.reject?.error ?? null,
      commandOutgoing:
        verification.replacementConsole?.invalidReplacementRecovery?.invalidReplacement
          ?.requestEnvelope?.body?.body?.command?.ProcessReplacement?.outgoing_user ??
        null,
      apiOccupant:
        verification.replacementConsole?.invalidReplacementRecovery?.apiSlotAfterReject
          ?.occupant_user_id ?? null,
      hostActivityStatus:
        verification.replacementConsole?.invalidReplacementRecovery?.activityStatusText ??
        null,
      hostActivityAction:
        verification.replacementConsole?.invalidReplacementRecovery?.activityRow
          ?.actionId ?? null,
      hostProjectionOccupant:
        verification.replacementConsole?.invalidReplacementRecovery
          ?.hostProjectionAfterReject?.occupantLabel ?? null,
      pendingActorStatus:
        verification.replacementConsole?.invalidReplacementRecovery?.pendingAfterReject
          ?.commandState?.actorStatus ?? null,
      pendingCapabilityKinds:
        verification.replacementConsole?.invalidReplacementRecovery?.pendingAfterReject
          ?.capabilityKinds ?? null,
      pendingPrimaryButtons:
        verification.replacementConsole?.invalidReplacementRecovery?.pendingAfterReject
          ?.controlCounts?.primaryButtons ?? null,
      passed:
        verification.replacementConsole?.invalidReplacementRecovery?.status === "passed" &&
        verification.replacementConsole?.invalidReplacementRecovery?.invalidReplacement
          ?.serverEnvelope?.body?.kind === "Reject" &&
        verification.replacementConsole?.invalidReplacementRecovery?.reject?.error ===
          "InvalidTarget" &&
        verification.replacementConsole?.invalidReplacementRecovery?.invalidReplacement
          ?.requestEnvelope?.body?.body?.principal_user_id === "host_h" &&
        verification.replacementConsole?.invalidReplacementRecovery?.invalidReplacement
          ?.requestEnvelope?.body?.body?.command?.ProcessReplacement?.outgoing_user ===
          "player-rowan" &&
        verification.replacementConsole?.invalidReplacementRecovery
          ?.activityStatusText?.includes("Reject InvalidTarget") === true &&
        verification.replacementConsole?.invalidReplacementRecovery?.activityRow
          ?.source === "outcome" &&
        verification.replacementConsole?.invalidReplacementRecovery?.activityRow
          ?.actionId === "process_replacement_invalid_target" &&
        verification.replacementConsole?.invalidReplacementRecovery?.activityRow
          ?.dispatchKind === "process_replacement" &&
        verification.replacementConsole?.invalidReplacementRecovery?.dispatchPlan
          ?.finalState === "reject" &&
        verification.replacementConsole?.invalidReplacementRecovery?.dispatchPlan
          ?.projectionRefreshKeys?.length === 0 &&
        verification.replacementConsole?.invalidReplacementRecovery
          ?.hostProjectionAfterReject?.occupantLabel === "player-mira" &&
        verification.replacementConsole?.invalidReplacementRecovery?.apiSlotAfterReject
          ?.slot_id === "slot-7" &&
        verification.replacementConsole?.invalidReplacementRecovery?.apiSlotAfterReject
          ?.occupant_user_id === "player-mira" &&
        verification.replacementConsole?.invalidReplacementRecovery?.pendingAfterReject
          ?.principalUserId === "player-rowan" &&
        verification.replacementConsole?.invalidReplacementRecovery?.pendingAfterReject
          ?.capabilityKinds?.length === 0 &&
        verification.replacementConsole?.invalidReplacementRecovery?.pendingAfterReject
          ?.capabilityLabel === `PendingReplacement(${session?.game ?? ""})` &&
        verification.replacementConsole?.invalidReplacementRecovery?.pendingAfterReject
          ?.commandState?.actorStatus === "pending_replacement" &&
        verification.replacementConsole?.invalidReplacementRecovery?.pendingAfterReject
          ?.coldLoadEndpoints?.commandStateEndpoint === null &&
        verification.replacementConsole?.invalidReplacementRecovery?.pendingAfterReject
          ?.controlCounts?.primaryButtons === 0 &&
        verification.replacementConsole?.invalidReplacementRecovery?.pendingAfterReject
          ?.controlCounts?.actionButtons === 0,
    }),
    lane("replacement-console", "Host replacement preserves slot history", {
      commandState:
        verification.replacementConsole?.processReplacement?.commandStatus?.state ?? null,
      commandSlot:
        verification.replacementConsole?.processReplacement?.commandStatus?.requestEnvelope
          ?.body?.body?.command?.ProcessReplacement?.slot ?? null,
      projectedOccupant:
        verification.replacementConsole?.projectedReplacement?.occupantLabel ?? null,
      apiOccupant: verification.replacementConsole?.apiSlot?.occupant_user_id ?? null,
      historyLabel: verification.replacementConsole?.projectedReplacement?.historyLabel ?? null,
      passed:
        verification.replacementConsole?.status === "passed" &&
        ackedReplacementCommandMatches(
          verification.replacementConsole?.processReplacement?.commandStatus,
          replacementPrivatePostRaceScenario,
          session?.game,
        ) &&
        replacementCurrentOwnerMatches(
          {
            hostProjection: verification.replacementConsole?.projectedReplacement,
            apiSlot: verification.replacementConsole?.apiSlot,
          },
          replacementPrivatePostRaceScenario,
        ),
    }),
    lane("replacement-idempotent-retry", "Duplicate replacement command id returns original ACK", {
      commandId:
        verification.replacementConsole?.replacementIdempotentRetry?.commandId ?? null,
      retryState:
        verification.replacementConsole?.replacementIdempotentRetry?.retryReplacement
          ?.state ?? null,
      sameStreamSeqs:
        verification.replacementConsole?.replacementIdempotentRetry?.sameStreamSeqs ??
        null,
      hostProjectionOccupant:
        verification.replacementConsole?.replacementIdempotentRetry
          ?.hostProjectionAfterRetry?.occupantLabel ?? null,
      apiOccupant:
        verification.replacementConsole?.replacementIdempotentRetry?.apiSlotAfterRetry
          ?.occupant_user_id ?? null,
      historyLabel:
        verification.replacementConsole?.replacementIdempotentRetry
          ?.hostProjectionAfterRetry?.historyLabel ?? null,
      passed:
        verification.replacementConsole?.replacementIdempotentRetry?.status ===
          "passed" &&
        verification.replacementConsole?.replacementIdempotentRetry?.retryReplacement
          ?.state === "ack" &&
        verification.replacementConsole?.replacementIdempotentRetry?.retryReplacement
          ?.httpStatus === 200 &&
        verification.replacementConsole?.replacementIdempotentRetry?.sameStreamSeqs ===
          true &&
        verification.replacementConsole?.replacementIdempotentRetry?.retryReplacement
          ?.requestEnvelope?.body?.body?.command_id ===
          verification.replacementConsole?.processReplacement?.commandStatus
            ?.requestEnvelope?.body?.body?.command_id &&
        replacementCommandEnvelopeMatches(
          verification.replacementConsole?.replacementIdempotentRetry?.retryReplacement,
          replacementPrivatePostRaceScenario,
          session?.game,
        ) &&
        replacementCurrentOwnerMatches(
          {
            hostProjection:
              verification.replacementConsole?.replacementIdempotentRetry
                ?.hostProjectionAfterRetry,
            apiSlot:
              verification.replacementConsole?.replacementIdempotentRetry
                ?.apiSlotAfterRetry,
          },
          replacementPrivatePostRaceScenario,
        ),
    }),
    lane("replacement-stale-success-recovery", "Stale replacement after success recovers", {
      rejectError:
        verification.replacementConsole?.staleReplacementAfterSuccess?.reject?.error ??
        null,
      commandOutgoing:
        verification.replacementConsole?.staleReplacementAfterSuccess?.invalidReplacement
          ?.requestEnvelope?.body?.body?.command?.ProcessReplacement?.outgoing_user ??
        null,
      hostActivityStatus:
        verification.replacementConsole?.staleReplacementAfterSuccess
          ?.activityStatusText ?? null,
      hostProjectionOccupant:
        verification.replacementConsole?.staleReplacementAfterSuccess
          ?.hostProjectionAfterReject?.occupantLabel ?? null,
      apiOccupant:
        verification.replacementConsole?.staleReplacementAfterSuccess
          ?.apiSlotAfterReject?.occupant_user_id ?? null,
      outgoingActorStatus:
        verification.replacementConsole?.staleReplacementAfterSuccess
          ?.staleOutgoingPlayer?.recoveredCommandState?.actorStatus ?? null,
      outgoingButtonsDisabled:
        verification.replacementConsole?.staleReplacementAfterSuccess
          ?.staleOutgoingPlayer?.buttonsDisabled ?? null,
      passed:
        verification.replacementConsole?.staleReplacementAfterSuccess?.status ===
          "passed" &&
        verification.replacementConsole?.staleReplacementAfterSuccess
          ?.invalidReplacement?.serverEnvelope?.body?.kind === "Reject" &&
        verification.replacementConsole?.staleReplacementAfterSuccess?.reject
          ?.error === "InvalidTarget" &&
        verification.replacementConsole?.staleReplacementAfterSuccess
          ?.invalidReplacement?.requestEnvelope?.body?.body?.principal_user_id ===
          "host_h" &&
        verification.replacementConsole?.staleReplacementAfterSuccess
          ?.invalidReplacement?.requestEnvelope?.body?.body?.command
          ?.ProcessReplacement?.outgoing_user === "player-mira" &&
        verification.replacementConsole?.staleReplacementAfterSuccess
          ?.activityStatusText?.includes("Reject InvalidTarget") === true &&
        verification.replacementConsole?.staleReplacementAfterSuccess
          ?.activityStatusText?.includes("replacement target is stale") === true &&
        verification.replacementConsole?.staleReplacementAfterSuccess
          ?.activityStatusText?.includes("current slot occupant") === true &&
        verification.replacementConsole?.staleReplacementAfterSuccess?.activityRow
          ?.source === "outcome" &&
        verification.replacementConsole?.staleReplacementAfterSuccess?.activityRow
          ?.actionId === "process_replacement_stale_success" &&
        verification.replacementConsole?.staleReplacementAfterSuccess?.activityRow
          ?.dispatchKind === "process_replacement" &&
        verification.replacementConsole?.staleReplacementAfterSuccess?.dispatchPlan
          ?.finalState === "reject" &&
        verification.replacementConsole?.staleReplacementAfterSuccess?.dispatchPlan
          ?.projectionRefreshKeys?.length === 0 &&
        verification.replacementConsole?.staleReplacementAfterSuccess
          ?.hostProjectionAfterReject?.occupantLabel === "player-rowan" &&
        verification.replacementConsole?.staleReplacementAfterSuccess
          ?.apiSlotAfterReject?.slot_id === "slot-7" &&
        verification.replacementConsole?.staleReplacementAfterSuccess
          ?.apiSlotAfterReject?.occupant_user_id === "player-rowan" &&
        verification.replacementConsole?.staleReplacementAfterSuccess
          ?.staleOutgoingPlayer?.recoveredCommandState?.actorStatus === "replaced" &&
        verification.replacementConsole?.staleReplacementAfterSuccess
          ?.staleOutgoingPlayer?.buttonsDisabled === true,
    }),
    lane("replacement-stale-player", "Outgoing replacement player recovers stale controls", {
      rejectError:
        verification.replacementConsole?.staleOutgoingPlayer?.reject?.error ?? null,
      rejectMessage:
        verification.replacementConsole?.staleOutgoingPlayer?.reject?.message ?? null,
      recoveredActorStatus:
        verification.replacementConsole?.staleOutgoingPlayer?.recoveredCommandState
          ?.actorStatus ?? null,
      recoveredActorAlive:
        verification.replacementConsole?.staleOutgoingPlayer?.recoveredCommandState
          ?.actorAlive ?? null,
      buttonsDisabled:
        verification.replacementConsole?.staleOutgoingPlayer?.buttonsDisabled ?? null,
      capabilityLabel:
        verification.replacementConsole?.staleOutgoingPlayer?.contextState
          ?.capabilityLabel ?? null,
      passed:
        verification.replacementConsole?.status === "passed" &&
        verification.replacementConsole?.staleOutgoingPlayer?.status === "passed" &&
        verification.replacementConsole?.staleOutgoingPlayer?.setup?.commandState
          ?.actorSlot === "slot-7" &&
        verification.replacementConsole?.staleOutgoingPlayer?.reject?.error ===
          "NotYourSlot" &&
        verification.replacementConsole?.staleOutgoingPlayer?.reject?.message?.includes(
          "slot ownership changed",
        ) === true &&
        verification.replacementConsole?.staleOutgoingPlayer?.recoveredCommandState
          ?.actorSlot === "slot-7" &&
        verification.replacementConsole?.staleOutgoingPlayer?.recoveredCommandState
          ?.actorAlive === false &&
        verification.replacementConsole?.staleOutgoingPlayer?.recoveredCommandState
          ?.actorStatus === "replaced" &&
        verification.replacementConsole?.staleOutgoingPlayer?.recoveredCommandState
          ?.actions?.length === 0 &&
        verification.replacementConsole?.staleOutgoingPlayer?.contextState
          ?.actorAlive === "false" &&
        verification.replacementConsole?.staleOutgoingPlayer?.contextState
          ?.actorStatus === "replaced" &&
        verification.replacementConsole?.staleOutgoingPlayer?.contextState
          ?.capabilityLabel?.includes("No current SlotOccupant(slot-7)") === true &&
        verification.replacementConsole?.staleOutgoingPlayer?.buttonsDisabled === true,
    }),
    lane("replacement-stale-action", "Outgoing replacement action command recovers stale role", {
      rejectError:
        verification.replacementConsole?.staleOutgoingPlayer?.staleAction?.error ??
        null,
      rejectMessage:
        verification.replacementConsole?.staleOutgoingPlayer?.staleAction?.message ??
        null,
      actionActorSlot:
        verification.replacementConsole?.staleOutgoingPlayer?.staleAction
          ?.requestEnvelope?.body?.body?.command?.SubmitAction?.actor_slot ?? null,
      recoveredActorStatus:
        verification.replacementConsole?.staleOutgoingPlayer
          ?.commandStateAfterStaleAction?.actorStatus ?? null,
      actionControlCount:
        verification.replacementConsole?.staleOutgoingPlayer
          ?.actionControlCountAfterStaleAction ?? null,
      passed:
        verification.replacementConsole?.status === "passed" &&
        verification.replacementConsole?.staleOutgoingPlayer?.status === "passed" &&
        verification.replacementConsole?.staleOutgoingPlayer?.staleAction?.state ===
          "reject" &&
        verification.replacementConsole?.staleOutgoingPlayer?.staleAction?.error ===
          "NotYourSlot" &&
        verification.replacementConsole?.staleOutgoingPlayer?.staleAction?.message?.includes(
          "slot ownership changed",
        ) === true &&
        verification.replacementConsole?.staleOutgoingPlayer?.staleAction
          ?.requestEnvelope?.body?.body?.command?.SubmitAction?.actor_slot ===
          "slot-7" &&
        verification.replacementConsole?.staleOutgoingPlayer?.staleAction
          ?.requestEnvelope?.body?.body?.command?.SubmitAction?.template_id ===
          "factional_kill" &&
        verification.replacementConsole?.staleOutgoingPlayer
          ?.commandStateAfterStaleAction?.actorSlot === "slot-7" &&
        verification.replacementConsole?.staleOutgoingPlayer
          ?.commandStateAfterStaleAction?.actorAlive === false &&
        verification.replacementConsole?.staleOutgoingPlayer
          ?.commandStateAfterStaleAction?.actorStatus === "replaced" &&
        verification.replacementConsole?.staleOutgoingPlayer
          ?.commandStateAfterStaleAction?.actions?.length === 0 &&
        verification.replacementConsole?.staleOutgoingPlayer
          ?.actionControlCountAfterStaleAction === 0 &&
        verification.replacementConsole?.staleOutgoingPlayer
          ?.buttonsDisabledAfterStaleAction === true,
    }),
    lane("replacement-stale-private-channel", "Replacement private channel authority follows current slot", {
      channel: verification.replacementConsole?.stalePrivateChannel?.channel ?? null,
      staleRejectError:
        verification.replacementConsole?.stalePrivateChannel?.stalePost?.error ?? null,
      staleRouteStatus:
        verification.replacementConsole?.stalePrivateChannel?.staleRoute?.status ??
        null,
      rowanChannelContext:
        verification.replacementConsole?.stalePrivateChannel?.rowanRoute
          ?.channelContextId ?? null,
      rowanCapabilityLabel:
        verification.replacementConsole?.stalePrivateChannel?.rowanRoute
          ?.capabilityLabel ?? null,
      rowanPostState:
        verification.replacementConsole?.stalePrivateChannel?.rowanPost?.state ??
        null,
      passed:
        verification.replacementConsole?.status === "passed" &&
        verification.replacementConsole?.stalePrivateChannel?.status === "passed" &&
        verification.replacementConsole?.stalePrivateChannel?.channel ===
          "private:mafia_day_chat" &&
        verification.replacementConsole?.stalePrivateChannel?.stalePost?.state ===
          "reject" &&
        verification.replacementConsole?.stalePrivateChannel?.stalePost?.error ===
          "NotYourSlot" &&
        verification.replacementConsole?.stalePrivateChannel?.stalePost?.message?.includes(
          "slot ownership changed",
        ) === true &&
        verification.replacementConsole?.stalePrivateChannel?.stalePost
          ?.requestEnvelope?.body?.body?.principal_user_id === "player-mira" &&
        verification.replacementConsole?.stalePrivateChannel?.stalePost
          ?.requestEnvelope?.body?.body?.command?.SubmitPost?.channel_id ===
          "private:mafia_day_chat" &&
        verification.replacementConsole?.stalePrivateChannel?.stalePost
          ?.requestEnvelope?.body?.body?.command?.SubmitPost?.actor_slot ===
          "slot-7" &&
        verification.replacementConsole?.stalePrivateChannel
          ?.commandStateAfterStalePost?.actorStatus === "replaced" &&
        verification.replacementConsole?.stalePrivateChannel
          ?.commandStateAfterStalePost?.actions?.length === 0 &&
        verification.replacementConsole?.stalePrivateChannel?.staleControlCounts
          ?.primaryButtons === 0 &&
        verification.replacementConsole?.stalePrivateChannel?.staleControlCounts
          ?.actionButtons === 0 &&
        verification.replacementConsole?.stalePrivateChannel?.staleRoute?.status ===
          403 &&
        verification.replacementConsole?.stalePrivateChannel?.staleRoute?.message?.includes(
          "requires scoped channel capability",
        ) === true &&
        verification.replacementConsole?.stalePrivateChannel?.rowanRoute
          ?.channelContextId === "private:mafia_day_chat" &&
        verification.replacementConsole?.stalePrivateChannel?.rowanRoute
          ?.actorSlot === "slot-7" &&
        verification.replacementConsole?.stalePrivateChannel?.rowanRoute
          ?.capabilityLabel?.includes("ChannelMember(private:mafia_day_chat)") === true &&
        verification.replacementConsole?.stalePrivateChannel?.rowanPost?.state ===
          "ack" &&
        verification.replacementConsole?.stalePrivateChannel?.rowanPost
          ?.requestEnvelope?.body?.body?.principal_user_id === "player-rowan" &&
        verification.replacementConsole?.stalePrivateChannel?.rowanPost
          ?.requestEnvelope?.body?.body?.command?.SubmitPost?.channel_id ===
          "private:mafia_day_chat" &&
        verification.replacementConsole?.stalePrivateChannel?.rowanPost
          ?.requestEnvelope?.body?.body?.command?.SubmitPost?.actor_slot ===
          "slot-7" &&
        verification.replacementConsole?.stalePrivateChannel?.apiThreadPostBodies?.includes(
          verification.replacementConsole?.stalePrivateChannel?.rowanPostBody,
        ) === true &&
        verification.replacementConsole?.stalePrivateChannel?.apiThreadPostBodies?.includes(
          verification.replacementConsole?.stalePrivateChannel?.stalePostBody,
        ) === false,
    }),
    lane("replacement-stale-private-receipts", "Replacement private receipts follow current slot", {
      staleNotificationsStatus:
        verification.replacementConsole?.stalePrivateReceipts?.staleNotifications
          ?.status ?? null,
      staleInvestigationResultsStatus:
        verification.replacementConsole?.stalePrivateReceipts
          ?.staleInvestigationResults?.status ?? null,
      rowanNotificationsStatus:
        verification.replacementConsole?.stalePrivateReceipts?.rowanNotifications
          ?.status ?? null,
      rowanInvestigationResultsStatus:
        verification.replacementConsole?.stalePrivateReceipts
          ?.rowanInvestigationResults?.status ?? null,
      rowanPrivateQueueCount:
        verification.replacementConsole?.stalePrivateReceipts?.rowanQueue?.count ??
        null,
      passed:
        verification.replacementConsole?.status === "passed" &&
        verification.replacementConsole?.stalePrivateReceipts?.status ===
          "passed" &&
        verification.replacementConsole?.stalePrivateReceipts?.staleNotifications
          ?.status === 403 &&
        verification.replacementConsole?.stalePrivateReceipts?.staleNotifications
          ?.body?.error === "NotAuthorized" &&
        verification.replacementConsole?.stalePrivateReceipts
          ?.staleInvestigationResults?.status === 403 &&
        verification.replacementConsole?.stalePrivateReceipts
          ?.staleInvestigationResults?.body?.error === "NotAuthorized" &&
        verification.replacementConsole?.stalePrivateReceipts?.rowanNotifications
          ?.status === 200 &&
        Array.isArray(
          verification.replacementConsole?.stalePrivateReceipts?.rowanNotifications
            ?.body,
        ) &&
        verification.replacementConsole?.stalePrivateReceipts
          ?.rowanInvestigationResults?.status === 200 &&
        Array.isArray(
          verification.replacementConsole?.stalePrivateReceipts
            ?.rowanInvestigationResults?.body,
        ) &&
        verification.replacementConsole?.stalePrivateReceipts?.rowanProjection
          ?.targetKillVisible === false &&
        verification.replacementConsole?.stalePrivateReceipts?.rowanProjection
          ?.actionResultVisible === false &&
        verification.replacementConsole?.stalePrivateReceipts?.rowanQueue?.count ===
          0 &&
        verification.replacementConsole?.stalePrivateReceipts?.rowanQueue
          ?.emptyVisible === true &&
        verification.replacementConsole?.stalePrivateReceipts
          ?.staleRouteStillForbidden === true,
    }),
    lane("replacement-incoming-player", "Incoming replacement player owns stable slot", {
      principalUserId:
        verification.replacementConsole?.incomingPlayer?.browserEntry?.principalUserId ??
        null,
      capabilityKinds:
        verification.replacementConsole?.incomingPlayer?.browserEntry?.capabilityKinds ??
        null,
      commandStateSlot:
        verification.replacementConsole?.incomingPlayer?.commandState?.actorSlot ?? null,
      postState:
        verification.replacementConsole?.incomingPlayer?.postStatus?.state ?? null,
      voteState:
        verification.replacementConsole?.incomingPlayer?.vote?.serverEnvelope?.body?.kind ??
        null,
      voteTarget:
        verification.replacementConsole?.incomingPlayer?.replacementVoteTarget?.slotId ??
        null,
      stableHistoryVisible:
        verification.replacementConsole?.incomingPlayer?.stableHistoryVisible ?? null,
      targetKillVisible:
        verification.replacementConsole?.incomingPlayer?.privateReceiptIsolation
          ?.targetKillVisible ?? null,
      actionResultVisible:
        verification.replacementConsole?.incomingPlayer?.privateReceiptIsolation
          ?.actionResultVisible ?? null,
      passed:
        verification.replacementConsole?.status === "passed" &&
        verification.replacementConsole?.incomingPlayer?.status === "passed" &&
        verification.replacementConsole?.incomingPlayer?.browserEntry?.principalUserId ===
          "player-rowan" &&
        verification.replacementConsole?.incomingPlayer?.browserEntry?.capabilityKinds?.includes(
          "SlotOccupant",
        ) === true &&
        verification.replacementConsole?.incomingPlayer?.commandState?.actorSlot ===
          "slot-7" &&
        verification.replacementConsole?.incomingPlayer?.commandState?.actorAlive === true &&
        verification.replacementConsole?.incomingPlayer?.capabilityLabel?.includes(
          "SlotOccupant",
        ) === true &&
        verification.replacementConsole?.incomingPlayer?.stableHistoryVisible === true &&
        verification.replacementConsole?.incomingPlayer?.postStatus?.state === "ack" &&
        verification.replacementConsole?.incomingPlayer?.postStatus?.requestEnvelope?.body
          ?.body?.principal_user_id === "player-rowan" &&
        verification.replacementConsole?.incomingPlayer?.postStatus?.requestEnvelope?.body
          ?.body?.command?.SubmitPost?.actor_slot === "slot-7" &&
        verification.replacementConsole?.incomingPlayer?.rowanProjectedPost?.authorSlot ===
          "slot-7" &&
        verification.replacementConsole?.incomingPlayer?.commandState?.voteTargets?.some(
          (target) =>
            target.kind === "slot" &&
            target.slotId ===
              verification.replacementConsole?.incomingPlayer?.replacementVoteTarget
                ?.slotId,
        ) === true &&
        verification.replacementConsole?.incomingPlayer?.vote?.requestEnvelope?.body?.body
          ?.principal_user_id === "player-rowan" &&
        verification.replacementConsole?.incomingPlayer?.vote?.requestEnvelope?.body?.body
          ?.command?.SubmitVote?.actor_slot === "slot-7" &&
        verification.replacementConsole?.incomingPlayer?.vote?.requestEnvelope?.body?.body
          ?.command?.SubmitVote?.target?.Slot ===
          verification.replacementConsole?.incomingPlayer?.replacementVoteTarget?.slotId &&
        verification.replacementConsole?.incomingPlayer?.vote?.serverEnvelope?.body?.kind ===
          "Ack" &&
        verification.replacementConsole?.incomingPlayer?.privateReceiptIsolation
          ?.targetKillVisible === false &&
        verification.replacementConsole?.incomingPlayer?.privateReceiptIsolation
          ?.actionResultVisible === false,
    }),
    lane("idempotent-retry", "Duplicate command id returns original ACK", {
      channel: hardening.idempotentRetry?.channel ?? null,
      firstState: hardening.idempotentRetry?.firstPost?.state ?? null,
      retryState: hardening.idempotentRetry?.retryPost?.state ?? null,
      sameStreamSeqs: sameArray(
        hardening.idempotentRetry?.firstPost?.streamSeqs,
        hardening.idempotentRetry?.retryPost?.streamSeqs,
      ),
      projectedPostCount: hardening.idempotentRetry?.projectedPostCount ?? null,
      passed:
        hardening.idempotentRetry?.channel === "main" &&
        hardening.idempotentRetry?.firstPost?.state === "ack" &&
        hardening.idempotentRetry?.retryPost?.state === "ack" &&
        sameArray(
          hardening.idempotentRetry?.firstPost?.streamSeqs,
          hardening.idempotentRetry?.retryPost?.streamSeqs,
        ) &&
        hardening.idempotentRetry?.projectedPostCount === 1,
    }),
    lane("action-idempotent-retry", "Duplicate action command id returns original ACK", {
      retryState: hardening.actionIdempotentRetry?.retry?.state ?? null,
      commandId: hardening.actionIdempotentRetry?.legalActionCommandId ?? null,
      sameStreamSeqs: sameArray(
        hardening.actionIdempotentRetry?.legalActionStreamSeqs,
        hardening.actionIdempotentRetry?.retry?.streamSeqs,
      ),
      refreshedPhase:
        hardening.actionIdempotentRetry?.commandStateAfterRetry?.phase?.phaseId ??
        null,
      refreshedActionCount:
        hardening.actionIdempotentRetry?.commandStateAfterRetry?.actions?.length ??
        null,
      apiRefreshedPhase:
        hardening.actionIdempotentRetry?.apiCommandStateAfterRetry?.phase?.phase_id ??
        null,
      receiptActionId: hardening.actionIdempotentRetry?.currentReceipt?.actionId ?? null,
      legalActionTarget: hardening.actionIdempotentRetry?.legalActionTarget ?? null,
      actionVisibleAfterRefresh:
        hardening.actionIdempotentRetry?.actionVisibleAfterRefresh ?? null,
      passed:
        hardening.actionIdempotentRetry?.status === "passed" &&
        hardening.actionIdempotentRetry?.retry?.state === "ack" &&
        hardening.actionIdempotentRetry?.retry?.commandId ===
          hardening.actionIdempotentRetry?.legalActionCommandId &&
        hardening.actionIdempotentRetry?.retry?.serverEnvelope?.body?.kind ===
          "Ack" &&
        sameArray(
          hardening.actionIdempotentRetry?.legalActionStreamSeqs,
          hardening.actionIdempotentRetry?.retry?.streamSeqs,
        ) &&
        hardening.actionIdempotentRetry?.retry?.requestEnvelope?.body?.body
          ?.command?.SubmitAction?.actor_slot === "slot_4" &&
        hardening.actionIdempotentRetry?.retry?.requestEnvelope?.body?.body
          ?.command?.SubmitAction?.action_id === "role_factional_kill" &&
        hardening.actionIdempotentRetry?.retry?.requestEnvelope?.body?.body
          ?.command?.SubmitAction?.template_id === "factional_kill" &&
        hardening.actionIdempotentRetry?.retry?.requestEnvelope?.body?.body
          ?.command?.SubmitAction?.targets?.[0] ===
          hardening.actionIdempotentRetry?.legalActionTarget &&
        hardening.actionIdempotentRetry?.dispatchPlan?.projectionRefreshKeys?.includes(
          "notifications",
        ) === true &&
        hardening.actionIdempotentRetry?.dispatchPlan?.projectionRefreshKeys?.includes(
          "investigationResults",
        ) === true &&
        hardening.actionIdempotentRetry?.dispatchPlan?.projectionRefreshKeys?.includes(
          "commandState",
        ) === true &&
        hardening.actionIdempotentRetry?.dispatchPlan?.projectionRefreshKeys?.includes(
          "dayVoteOutcomes",
        ) === false &&
        hardening.actionIdempotentRetry?.currentReceipt?.actionId ===
          "submit_action:factional_kill" &&
        hardening.actionIdempotentRetry?.currentReceipt?.state === "ack" &&
        hardening.actionIdempotentRetry?.currentReceipt?.commandTrace
          ?.projectionRefreshKeys?.includes("commandState") === true &&
        hardening.actionIdempotentRetry?.currentReceipt?.commandTrace
          ?.projectionRefreshKeys?.includes("dayVoteOutcomes") === false &&
        hardening.actionIdempotentRetry?.receiptStatusText?.includes("Ack") ===
          true &&
        hardening.actionIdempotentRetry?.staleN01Phase?.phaseId === "N01" &&
        hardening.actionIdempotentRetry?.commandStateAfterRetry?.actorSlot ===
          "slot_4" &&
        hardening.actionIdempotentRetry?.commandStateAfterRetry?.actorAlive ===
          true &&
        hardening.actionIdempotentRetry?.commandStateAfterRetry?.actorStatus ===
          "alive" &&
        hardening.actionIdempotentRetry?.commandStateAfterRetry?.phase?.phaseId ===
          "N01" &&
        hardening.actionIdempotentRetry?.commandStateAfterRetry?.phase?.locked ===
          false &&
        hardening.actionIdempotentRetry?.commandStateAfterRetry?.actions?.length ===
          0 &&
        hardening.actionIdempotentRetry?.apiCommandStateAfterRetry?.actor_slot ===
          "slot_4" &&
        hardening.actionIdempotentRetry?.apiCommandStateAfterRetry?.actor_alive ===
          true &&
        hardening.actionIdempotentRetry?.apiCommandStateAfterRetry?.actor_status ===
          "alive" &&
        hardening.actionIdempotentRetry?.apiCommandStateAfterRetry?.phase?.phase_id ===
          "N01" &&
        hardening.actionIdempotentRetry?.apiCommandStateAfterRetry?.phase?.locked ===
          false &&
        hardening.actionIdempotentRetry?.apiCommandStateAfterRetry?.actions?.length ===
          0 &&
        hardening.actionIdempotentRetry?.actionVisibleAfterRefresh === false,
    }),
    lane("concurrent-action-race", "Concurrent player actions converge with one stored action", {
      ackPageRole: hardening.concurrentActionRace?.ackPageRole ?? null,
      rejectPageRole: hardening.concurrentActionRace?.rejectPageRole ?? null,
      ackState: hardening.concurrentActionRace?.ack?.state ?? null,
      rejectError: hardening.concurrentActionRace?.reject?.error ?? null,
      targetSlot: hardening.concurrentActionRace?.targetSlot ?? null,
      refreshedActionCount:
        hardening.concurrentActionRace?.apiCommandStateAfterRace?.actions?.length ??
        null,
      resolvedTargetAlive:
        hardening.concurrentActionRace?.resolvedTargetSlot?.alive ?? null,
      passed:
        hardening.concurrentActionRace?.status === "passed" &&
        ["live", "concurrent"].includes(
          hardening.concurrentActionRace?.ackPageRole,
        ) &&
        ["live", "concurrent"].includes(
          hardening.concurrentActionRace?.rejectPageRole,
        ) &&
        hardening.concurrentActionRace?.ackPageRole !==
          hardening.concurrentActionRace?.rejectPageRole &&
        hardening.concurrentActionRace?.ack?.state === "ack" &&
        hardening.concurrentActionRace?.ack?.serverEnvelope?.body?.kind === "Ack" &&
        hardening.concurrentActionRace?.reject?.state === "reject" &&
        hardening.concurrentActionRace?.reject?.error === "ActionAlreadySubmitted" &&
        hardening.concurrentActionRace?.reject?.serverEnvelope?.body?.kind ===
          "Reject" &&
        Array.isArray(hardening.concurrentActionRace?.reject?.streamSeqs) ===
          false &&
        hardening.concurrentActionRace?.ack?.commandId !==
          hardening.concurrentActionRace?.reject?.commandId &&
        hardening.concurrentActionRace?.ack?.requestEnvelope?.body?.body?.command
          ?.SubmitAction?.actor_slot === "slot_4" &&
        hardening.concurrentActionRace?.ack?.requestEnvelope?.body?.body?.command
          ?.SubmitAction?.action_id === "role_factional_kill" &&
        hardening.concurrentActionRace?.ack?.requestEnvelope?.body?.body?.command
          ?.SubmitAction?.template_id === "factional_kill" &&
        hardening.concurrentActionRace?.reject?.requestEnvelope?.body?.body?.command
          ?.SubmitAction?.actor_slot === "slot_4" &&
        hardening.concurrentActionRace?.reject?.requestEnvelope?.body?.body?.command
          ?.SubmitAction?.action_id === "role_factional_kill" &&
        hardening.concurrentActionRace?.reject?.requestEnvelope?.body?.body?.command
          ?.SubmitAction?.template_id === "factional_kill" &&
        hardening.concurrentActionRace?.reject?.requestEnvelope?.body?.body?.command
          ?.SubmitAction?.targets?.[0] ===
          hardening.concurrentActionRace?.ack?.requestEnvelope?.body?.body?.command
            ?.SubmitAction?.targets?.[0] &&
        hardening.concurrentActionRace?.targetSlot ===
          hardening.concurrentActionRace?.ack?.requestEnvelope?.body?.body?.command
            ?.SubmitAction?.targets?.[0] &&
        hardening.concurrentActionRace?.reject?.message?.includes(
          "refresh and use current controls",
        ) === true &&
        hardening.concurrentActionRace?.liveCommandStateAfterRace?.actorSlot ===
          "slot_4" &&
        hardening.concurrentActionRace?.liveCommandStateAfterRace?.phase?.phaseId ===
          "N01" &&
        hardening.concurrentActionRace?.liveCommandStateAfterRace?.phase?.locked ===
          false &&
        hardening.concurrentActionRace?.liveCommandStateAfterRace?.actions?.length ===
          0 &&
        hardening.concurrentActionRace?.concurrentCommandStateAfterRace?.actorSlot ===
          "slot_4" &&
        hardening.concurrentActionRace?.concurrentCommandStateAfterRace?.phase
          ?.phaseId === "N01" &&
        hardening.concurrentActionRace?.concurrentCommandStateAfterRace?.phase
          ?.locked === false &&
        hardening.concurrentActionRace?.concurrentCommandStateAfterRace?.actions
          ?.length === 0 &&
        hardening.concurrentActionRace?.apiCommandStateAfterRace?.actor_slot ===
          "slot_4" &&
        hardening.concurrentActionRace?.apiCommandStateAfterRace?.phase?.phase_id ===
          "N01" &&
        hardening.concurrentActionRace?.apiCommandStateAfterRace?.phase?.locked ===
          false &&
        hardening.concurrentActionRace?.apiCommandStateAfterRace?.actions?.length ===
          0 &&
        hardening.concurrentActionRace?.resolvedTargetSlot?.slot_id ===
          hardening.concurrentActionRace?.targetSlot &&
        hardening.concurrentActionRace?.resolvedTargetSlot?.alive === false &&
        hardening.concurrentActionRace?.resolvedTargetSlot?.status === "dead" &&
        hardening.concurrentActionRace?.actionVisibleAfterRefresh === false,
    }),
    lane(
      "concurrent-action-race-reload",
      "Concurrent action race reloads resolved role projections",
      {
        targetSlot: hardening.concurrentActionRace?.targetSlot ?? null,
        actionRouteStatus:
          hardening.concurrentActionRace?.roleReloadAfterRace?.actionRouteStatus ??
          null,
        hostRouteStatus:
          hardening.concurrentActionRace?.roleReloadAfterRace?.hostRouteStatus ??
          null,
        actionPhase:
          hardening.concurrentActionRace?.roleReloadAfterRace?.actionCommandState
            ?.phase ?? null,
        hostPhase:
          hardening.concurrentActionRace?.roleReloadAfterRace?.hostPhase ?? null,
        hostSlotCount:
          hardening.concurrentActionRace?.roleReloadAfterRace?.hostSlotsAfterReload
            ?.length ?? null,
        apiTargetAlive:
          hardening.concurrentActionRace?.roleReloadAfterRace?.apiTargetSlot?.alive ??
          null,
        passed:
          hardening.concurrentActionRace?.status === "passed" &&
          hardening.concurrentActionRace?.roleReloadAfterRace?.status ===
            "passed" &&
          hardening.concurrentActionRace?.roleReloadAfterRace?.actionRouteStatus ===
            200 &&
          hardening.concurrentActionRace?.roleReloadAfterRace?.hostRouteStatus ===
            200 &&
          hardening.concurrentActionRace?.roleReloadAfterRace?.actionCommandState
            ?.actorSlot === "slot_4" &&
          hardening.concurrentActionRace?.roleReloadAfterRace?.actionCommandState
            ?.phase?.phaseId === "N01" &&
          hardening.concurrentActionRace?.roleReloadAfterRace?.actionCommandState
            ?.phase?.locked === true &&
          hardening.concurrentActionRace?.roleReloadAfterRace?.actionCommandState
            ?.actions?.length === 0 &&
          hardening.concurrentActionRace?.roleReloadAfterRace
            ?.actionVisibleAfterReload === false &&
          hardening.concurrentActionRace?.roleReloadAfterRace?.hostPhase?.id ===
            "N01" &&
          hardening.concurrentActionRace?.roleReloadAfterRace?.hostPhase?.locked ===
            true &&
          Array.isArray(
            hardening.concurrentActionRace?.roleReloadAfterRace?.hostSlotsAfterReload,
          ) === true &&
          hardening.concurrentActionRace?.roleReloadAfterRace?.apiCommandState
            ?.actor_slot === "slot_4" &&
          hardening.concurrentActionRace?.roleReloadAfterRace?.apiCommandState
            ?.phase?.phase_id === "N01" &&
          hardening.concurrentActionRace?.roleReloadAfterRace?.apiCommandState
            ?.phase?.locked === true &&
          hardening.concurrentActionRace?.roleReloadAfterRace?.apiCommandState
            ?.actions?.length === 0 &&
          hardening.concurrentActionRace?.roleReloadAfterRace?.apiTargetSlot
            ?.slot_id === hardening.concurrentActionRace?.targetSlot &&
          hardening.concurrentActionRace?.roleReloadAfterRace?.apiTargetSlot
            ?.alive === false &&
          hardening.concurrentActionRace?.roleReloadAfterRace?.apiTargetSlot
            ?.status === "dead",
      },
    ),
    lane("reconnect-recovery", "Dropped player live projection reconnects", {
      reconnectingState: hardening.reconnect?.reconnectingStatus?.state ?? null,
      recoveryState: hardening.reconnect?.reconnectRecoveryEvent?.state ?? null,
      recoveredSnapshotContainsPost:
        hardening.reconnect?.recoveredSnapshotContainsPost ?? null,
      passed:
        hardening.reconnect?.status === "passed" &&
        hardening.reconnect?.reconnectingStatus?.state === "reconnecting" &&
        hardening.reconnect?.reconnectRecoveryEvent?.state === "recovered" &&
        hardening.reconnect?.recoveredSnapshotContainsPost === true,
    }),
    lane("stale-player-vote", "Stale player vote rejects and refreshes command state", {
      rejectError: hardening.stalePlayerVote?.reject?.error ?? null,
      phaseAfterRejectLocked: hardening.stalePlayerVote?.phaseAfterReject?.locked ?? null,
      voteTargetsAfterReject:
        hardening.stalePlayerVote?.commandStateAfterReject?.voteTargets?.length ?? null,
      voteControlAfterReject:
        hardening.stalePlayerVote?.voteControlAfterReject ?? null,
      cleanupLocked: hardening.stalePlayerVote?.hostPhaseAfterUnlock?.locked ?? null,
      passed:
        hardening.stalePlayerVote?.status === "passed" &&
        hardening.stalePlayerVote?.reject?.error === "PhaseLocked" &&
        hardening.stalePlayerVote?.commandStateBeforeClose?.voteTargets?.some(
          (target) => target.kind === "slot",
        ) === true &&
        hardening.stalePlayerVote?.commandStateBeforeClose?.currentVote === null &&
        hardening.stalePlayerVote?.voteControlBeforeClose?.exists === true &&
        hardening.stalePlayerVote?.voteControlBeforeClose?.disabled === false &&
        hardening.stalePlayerVote?.withdrawBeforeClose?.exists === true &&
        hardening.stalePlayerVote?.withdrawBeforeClose?.disabled === true &&
        hardening.stalePlayerVote?.withdrawBeforeClose?.reason ===
          "No current vote" &&
        hardening.stalePlayerVote?.phaseAfterReject?.locked === true &&
        hardening.stalePlayerVote?.commandStateAfterReject?.phase?.locked === true &&
        hardening.stalePlayerVote?.commandStateAfterReject?.voteTargets?.length ===
          0 &&
        hardening.stalePlayerVote?.commandStateAfterReject?.currentVote === null &&
        hardening.stalePlayerVote?.dispatchPlan?.projectionRefreshKeys?.includes(
          "commandState",
        ) === true &&
        hardening.stalePlayerVote?.voteControlAfterReject?.exists === false &&
        hardening.stalePlayerVote?.voteControlAfterReject?.disabled === true &&
        hardening.stalePlayerVote?.withdrawAfterReject?.exists === true &&
        hardening.stalePlayerVote?.withdrawAfterReject?.disabled === true &&
        hardening.stalePlayerVote?.withdrawAfterReject?.reason ===
          "No current vote" &&
        hardening.stalePlayerVote?.currentVoteAfterReject?.hasVote === "false" &&
        hardening.stalePlayerVote?.currentVoteAfterReject?.text?.includes(
          "No current vote",
        ) &&
        hardening.stalePlayerVote?.hostPhaseAfterUnlock?.locked === false,
    }),
    lane(
      "stale-player-vote-after-change",
      "Stale player vote ACK refreshes changed votecount",
      {
        targetSlot:
          hardening.stalePlayerVoteAfterChange?.staleVoteTarget?.slotId ?? null,
        actionVoteState:
          hardening.stalePlayerVoteAfterChange?.actionVote?.state ?? null,
        staleVoteState:
          hardening.stalePlayerVoteAfterChange?.staleVote?.state ?? null,
        currentVoteAfterAck:
          hardening.stalePlayerVoteAfterChange?.commandStateAfterAck?.currentVote ??
          null,
        cleanupRows: normalizedVotecountRows(
          hardening.stalePlayerVoteAfterChange?.apiVotecountAfterCleanup,
        ).length,
        passed:
          stalePlayerVoteAfterChangeAckMatches(
            hardening.stalePlayerVoteAfterChange,
          ),
      },
    ),
    lane(
      "stale-player-withdraw-after-change",
      "Stale player withdraw ACK clears changed ballot",
      {
        targetSlot:
          hardening.stalePlayerWithdrawAfterChange?.staleVoteTarget?.slotId ??
          null,
        liveCurrentVote:
          hardening.stalePlayerWithdrawAfterChange?.apiCommandStateAfterLiveChange
            ?.current_vote ?? null,
        withdrawState:
          hardening.stalePlayerWithdrawAfterChange?.staleWithdraw?.state ?? null,
        currentVoteAfterWithdraw:
          hardening.stalePlayerWithdrawAfterChange?.commandStateAfterWithdraw
            ?.currentVote ?? null,
        cleanupRows: normalizedVotecountRows(
          hardening.stalePlayerWithdrawAfterChange?.apiVotecountAfterWithdraw,
        ).length,
        passed:
          stalePlayerWithdrawAfterChangeAckMatches(
            hardening.stalePlayerWithdrawAfterChange,
          ),
      },
    ),
    lane(
      "stale-player-withdraw-after-phase-closure",
      "Stale player withdraw rejects after host phase closure",
      {
        game:
          hardening.stalePlayerWithdrawAfterPhaseClosure?.game ?? null,
        resolveState:
          hardening.stalePlayerWithdrawAfterPhaseClosure?.resolveDay
            ?.commandStatus?.state ?? null,
        rejectError:
          hardening.stalePlayerWithdrawAfterPhaseClosure?.staleWithdraw?.error ??
          null,
        phaseLockedAfterReject:
          hardening.stalePlayerWithdrawAfterPhaseClosure?.commandStateAfterReject
            ?.phase?.locked ?? null,
        currentVoteAfterReject:
          hardening.stalePlayerWithdrawAfterPhaseClosure?.commandStateAfterReject
            ?.currentVote ?? null,
        outcomeStatus:
          hardening.stalePlayerWithdrawAfterPhaseClosure?.dayVoteOutcomesAfterReject?.[0]
            ?.status ?? null,
        passed:
          stalePlayerPhaseClosureRejectMatches(
            hardening.stalePlayerWithdrawAfterPhaseClosure,
            {
              commandField: "staleWithdraw",
              commandName: "WithdrawVote",
              beforeCommandMatches: (proof) =>
                proof?.withdrawBeforeClose?.exists === true &&
                proof?.withdrawBeforeClose?.disabled === false,
            },
          ),
      },
    ),
    lane(
      "stale-player-vote-after-phase-closure",
      "Stale player vote rejects after host phase closure",
      {
        game: hardening.stalePlayerVoteAfterPhaseClosure?.game ?? null,
        targetSlot:
          hardening.stalePlayerVoteAfterPhaseClosure?.staleVoteTarget?.slotId ??
          null,
        targetKind:
          hardening.stalePlayerVoteAfterPhaseClosure?.staleVoteTarget?.kind ??
          null,
        resolveState:
          hardening.stalePlayerVoteAfterPhaseClosure?.resolveDay?.commandStatus
            ?.state ?? null,
        rejectError:
          hardening.stalePlayerVoteAfterPhaseClosure?.staleVote?.error ?? null,
        phaseLockedAfterReject:
          hardening.stalePlayerVoteAfterPhaseClosure?.commandStateAfterReject
            ?.phase?.locked ?? null,
        currentVoteAfterReject:
          hardening.stalePlayerVoteAfterPhaseClosure?.commandStateAfterReject
            ?.currentVote ?? null,
        outcomeStatus:
          hardening.stalePlayerVoteAfterPhaseClosure?.dayVoteOutcomesAfterReject?.[0]
            ?.status ?? null,
        passed:
          stalePlayerPhaseClosureRejectMatches(
            hardening.stalePlayerVoteAfterPhaseClosure,
            {
              commandField: "staleVote",
              commandName: "SubmitVote",
              beforeCommandMatches: (proof) =>
                proof?.staleVoteTarget !== undefined &&
                proof?.staleVoteButton?.disabled === false,
            },
          ),
      },
    ),
    lane(
      "stale-player-post-after-phase-closure",
      "Stale player post ACKs after host phase closure",
      {
        game: hardening.stalePlayerPostAfterPhaseClosure?.game ?? null,
        postBody: hardening.stalePlayerPostAfterPhaseClosure?.postBody ?? null,
        postState:
          hardening.stalePlayerPostAfterPhaseClosure?.stalePost?.state ?? null,
        phaseLockedAfterAck:
          hardening.stalePlayerPostAfterPhaseClosure?.commandStateAfterAck?.phase
            ?.locked ?? null,
        currentVoteAfterAck:
          hardening.stalePlayerPostAfterPhaseClosure?.commandStateAfterAck
            ?.currentVote ?? null,
        outcomeStatus:
          hardening.stalePlayerPostAfterPhaseClosure?.dayVoteOutcomesAfterAck?.[0]
            ?.status ?? null,
        passed:
          stalePlayerPhaseClosurePostAckMatches(
            hardening.stalePlayerPostAfterPhaseClosure,
          ),
      },
    ),
    lane(
      "concurrent-player-vote-resolve-race",
      "Concurrent player vote and host resolve converge",
      {
        game: hardening.concurrentPlayerVoteResolveRace?.game ?? null,
        voteState: hardening.concurrentPlayerVoteResolveRace?.vote?.state ?? null,
        voteError: hardening.concurrentPlayerVoteResolveRace?.vote?.error ?? null,
        voteSeq: hardening.concurrentPlayerVoteResolveRace?.voteSeq ?? null,
        resolveSeq: hardening.concurrentPlayerVoteResolveRace?.resolveSeq ?? null,
        phaseLockedAfterRace:
          hardening.concurrentPlayerVoteResolveRace?.commandStateAfterRace?.phase
            ?.locked ?? null,
        outcomeStatus:
          hardening.concurrentPlayerVoteResolveRace?.playerDayVoteOutcomesAfterRace?.[0]
            ?.status ?? null,
        passed:
          hardening.concurrentPlayerVoteResolveRace?.status === "passed" &&
          hardening.concurrentPlayerVoteResolveRace?.hostEntry?.capabilityKinds?.includes(
            "HostOf",
          ) === true &&
          hardening.concurrentPlayerVoteResolveRace?.playerEntry?.capabilityKinds?.includes(
            "SlotOccupant",
          ) === true &&
          hardening.concurrentPlayerVoteResolveRace?.setupCommandState?.actorSlot ===
            "slot_4" &&
          hardening.concurrentPlayerVoteResolveRace?.setupCommandState?.phase
            ?.phaseId === "D01" &&
          hardening.concurrentPlayerVoteResolveRace?.setupCommandState?.phase
            ?.locked === false &&
          hardening.concurrentPlayerVoteResolveRace?.setupVoteButton?.disabled ===
            false &&
          hardening.concurrentPlayerVoteResolveRace?.setupHostPhase?.locked ===
            false &&
          hardening.concurrentPlayerVoteResolveRace?.setupHostPhaseActions?.includes(
            hostResolvePhaseActionId,
          ) === true &&
          hardening.concurrentPlayerVoteResolveRace?.resolve?.state === "ack" &&
          hardening.concurrentPlayerVoteResolveRace?.resolve?.serverEnvelope?.body
            ?.kind === "Ack" &&
          Array.isArray(hardening.concurrentPlayerVoteResolveRace?.resolve?.streamSeqs) &&
          hardening.concurrentPlayerVoteResolveRace.resolve.streamSeqs.length >= 3 &&
          hardening.concurrentPlayerVoteResolveRace?.resolve?.requestEnvelope?.body
            ?.body?.command?.ResolvePhase?.game ===
            hardening.concurrentPlayerVoteResolveRace?.game &&
          hardening.concurrentPlayerVoteResolveRace?.vote?.requestEnvelope?.body?.body
            ?.command?.SubmitVote?.actor_slot === "slot_4" &&
          ((hardening.concurrentPlayerVoteResolveRace?.vote?.state === "ack" &&
            hardening.concurrentPlayerVoteResolveRace?.vote?.serverEnvelope?.body
              ?.kind === "Ack" &&
            Array.isArray(hardening.concurrentPlayerVoteResolveRace?.vote?.streamSeqs) &&
            hardening.concurrentPlayerVoteResolveRace.vote.streamSeqs.length === 1 &&
            hardening.concurrentPlayerVoteResolveRace.voteSeq <
              hardening.concurrentPlayerVoteResolveRace.resolveSeq) ||
            (hardening.concurrentPlayerVoteResolveRace?.vote?.state === "reject" &&
              hardening.concurrentPlayerVoteResolveRace?.vote?.error ===
                "PhaseLocked" &&
              hardening.concurrentPlayerVoteResolveRace?.vote?.serverEnvelope?.body
                ?.kind === "Reject" &&
              Array.isArray(
                hardening.concurrentPlayerVoteResolveRace?.vote?.streamSeqs,
              ) === false)) &&
          hardening.concurrentPlayerVoteResolveRace?.commandStateAfterRace?.phase
            ?.phaseId === "D01" &&
          hardening.concurrentPlayerVoteResolveRace?.commandStateAfterRace?.phase
            ?.locked === true &&
          hardening.concurrentPlayerVoteResolveRace?.commandStateAfterRace
            ?.voteTargets?.length === 0 &&
          hardening.concurrentPlayerVoteResolveRace?.buttonsAfterRace?.some(
            (button) => button.action?.startsWith("submit_vote"),
          ) === false &&
          hardening.concurrentPlayerVoteResolveRace?.buttonsAfterRace?.some(
            (button) => button.action === "submit_post" && button.disabled === false,
          ) === true &&
          hardening.concurrentPlayerVoteResolveRace?.hostPhaseAfterRace?.locked ===
            true &&
          hardening.concurrentPlayerVoteResolveRace?.hostDayVoteOutcomesAfterRace?.some(
            (row) =>
              row.phaseId === "D01" &&
              row.status === "Lynch" &&
              row.winnerSlot === "slot-2",
          ) === true &&
          hardening.concurrentPlayerVoteResolveRace?.playerDayVoteOutcomesAfterRace?.some(
            (row) =>
              row.phaseId === "D01" &&
              row.status === "Lynch" &&
              row.winnerSlot === "slot-2",
          ) === true &&
          hardening.concurrentPlayerVoteResolveRace?.apiCommandStateAfterRace?.phase
            ?.locked === true &&
          hardening.concurrentPlayerVoteResolveRace?.apiCommandStateAfterRace
            ?.vote_targets?.length === 0 &&
          normalizedDayVoteOutcomeRows(
            hardening.concurrentPlayerVoteResolveRace?.apiDayVoteOutcomesAfterRace,
          ).some(
            (row) =>
              row.phaseId === "D01" &&
              row.status === "Lynch" &&
              row.winnerSlot === "slot-2",
          ) === true,
      },
    ),
    lane(
      "concurrent-player-vote-resolve-race-reload",
      "Concurrent player vote and host resolve reload role surfaces",
      {
        game: hardening.concurrentPlayerVoteResolveRace?.game ?? null,
        playerRouteStatus:
          hardening.concurrentPlayerVoteResolveRace?.roleReloadAfterRace
            ?.playerRouteResponseStatus ?? null,
        hostRouteStatus:
          hardening.concurrentPlayerVoteResolveRace?.roleReloadAfterRace
            ?.hostRouteResponseStatus ?? null,
        phaseLocked:
          hardening.concurrentPlayerVoteResolveRace?.roleReloadAfterRace
            ?.commandStateAfterReload?.phase?.locked ?? null,
        outcomeStatus:
          hardening.concurrentPlayerVoteResolveRace?.roleReloadAfterRace
            ?.playerDayVoteOutcomesAfterReload?.[0]?.status ?? null,
        passed:
          hardening.concurrentPlayerVoteResolveRace?.status === "passed" &&
          hardening.concurrentPlayerVoteResolveRace?.roleReloadAfterRace?.status ===
            "passed" &&
          hardening.concurrentPlayerVoteResolveRace?.roleReloadAfterRace
            ?.playerRouteResponseStatus === 200 &&
          hardening.concurrentPlayerVoteResolveRace?.roleReloadAfterRace
            ?.hostRouteResponseStatus === 200 &&
          hardening.concurrentPlayerVoteResolveRace?.roleReloadAfterRace
            ?.commandStateAfterReload?.phase?.phaseId === "D01" &&
          hardening.concurrentPlayerVoteResolveRace?.roleReloadAfterRace
            ?.commandStateAfterReload?.phase?.locked === true &&
          hardening.concurrentPlayerVoteResolveRace?.roleReloadAfterRace
            ?.commandStateAfterReload?.voteTargets?.length === 0 &&
          hardening.concurrentPlayerVoteResolveRace?.roleReloadAfterRace
            ?.buttonsAfterReload?.some((button) =>
              button.action?.startsWith("submit_vote"),
            ) === false &&
          hardening.concurrentPlayerVoteResolveRace?.roleReloadAfterRace
            ?.buttonsAfterReload?.some(
              (button) => button.action === "submit_post" && button.disabled === false,
            ) === true &&
          hardening.concurrentPlayerVoteResolveRace?.roleReloadAfterRace
            ?.hostPhaseAfterReload?.id === "D01" &&
          hardening.concurrentPlayerVoteResolveRace?.roleReloadAfterRace
            ?.hostPhaseAfterReload?.locked === true &&
          hardening.concurrentPlayerVoteResolveRace?.roleReloadAfterRace
            ?.hostDayVoteOutcomesAfterReload?.some(
              (row) =>
                row.phaseId === "D01" &&
                row.status === "Lynch" &&
                row.winnerSlot === "slot-2",
            ) === true &&
          hardening.concurrentPlayerVoteResolveRace?.roleReloadAfterRace
            ?.playerDayVoteOutcomesAfterReload?.some(
              (row) =>
                row.phaseId === "D01" &&
                row.status === "Lynch" &&
                row.winnerSlot === "slot-2",
            ) === true &&
          hardening.concurrentPlayerVoteResolveRace?.roleReloadAfterRace
            ?.apiCommandStateAfterReload?.phase?.locked === true &&
          hardening.concurrentPlayerVoteResolveRace?.roleReloadAfterRace
            ?.apiCommandStateAfterReload?.vote_targets?.length === 0 &&
          normalizedDayVoteOutcomeRows(
            hardening.concurrentPlayerVoteResolveRace?.roleReloadAfterRace
              ?.apiDayVoteOutcomesAfterReload,
          ).some(
            (row) =>
              row.phaseId === "D01" &&
              row.status === "Lynch" &&
              row.winnerSlot === "slot-2",
          ) === true,
      },
    ),
    lane(
      "concurrent-player-action-advance-race",
      "Concurrent player action and host advance converge",
      {
        game: hardening.concurrentPlayerActionAdvanceRace?.game ?? null,
        rejectError: hardening.concurrentPlayerActionAdvanceRace?.reject?.error ?? null,
        phaseAfterRace:
          hardening.concurrentPlayerActionAdvanceRace?.commandStateAfterRace?.phase
            ?.phaseId ?? null,
        hostPhaseAfterRace:
          hardening.concurrentPlayerActionAdvanceRace?.hostPhaseAfterRace?.id ?? null,
        passed:
          hardening.concurrentPlayerActionAdvanceRace?.status === "passed" &&
          hardening.concurrentPlayerActionAdvanceRace?.hostEntry?.capabilityKinds?.includes(
            "HostOf",
          ) === true &&
          hardening.concurrentPlayerActionAdvanceRace?.actionEntry?.capabilityKinds?.includes(
            "SlotOccupant",
          ) === true &&
          hardening.concurrentPlayerActionAdvanceRace?.setupCommandState?.actorSlot ===
            "slot_4" &&
          hardening.concurrentPlayerActionAdvanceRace?.setupCommandState?.phase
            ?.phaseId === "N01" &&
          hardening.concurrentPlayerActionAdvanceRace?.setupCommandState?.phase
            ?.locked === false &&
          hardening.concurrentPlayerActionAdvanceRace?.setupCommandState?.actions?.some(
            (action) => action.templateId === "factional_kill",
          ) === true &&
          hardening.concurrentPlayerActionAdvanceRace?.setupActionButton?.disabled ===
            false &&
          hardening.concurrentPlayerActionAdvanceRace?.setupHostPhase?.id === "N01" &&
          hardening.concurrentPlayerActionAdvanceRace?.setupHostPhase?.locked ===
            false &&
          hardening.concurrentPlayerActionAdvanceRace?.setupHostPhaseActions?.includes(
            hostResolvePhaseActionId,
          ) === true &&
          hardening.concurrentPlayerActionAdvanceRace?.closedStatus?.state ===
            "closed" &&
          hardening.concurrentPlayerActionAdvanceRace?.resolveNight?.commandStatus
            ?.state === "ack" &&
          hardening.concurrentPlayerActionAdvanceRace?.lockedHostPhase?.id === "N01" &&
          hardening.concurrentPlayerActionAdvanceRace?.lockedHostPhase?.locked ===
            true &&
          hardening.concurrentPlayerActionAdvanceRace?.lockedHostPhaseActions?.includes(
            hostAdvancePhaseActionId,
          ) === true &&
          hardening.concurrentPlayerActionAdvanceRace?.reject?.state === "reject" &&
          ["PhaseLocked", "InvalidTarget"].includes(
            hardening.concurrentPlayerActionAdvanceRace?.reject?.error,
          ) &&
          hardening.concurrentPlayerActionAdvanceRace?.reject?.serverEnvelope?.body
            ?.kind === "Reject" &&
          Array.isArray(
            hardening.concurrentPlayerActionAdvanceRace?.reject?.streamSeqs,
          ) === false &&
          hardening.concurrentPlayerActionAdvanceRace?.reject?.requestEnvelope?.body
            ?.body?.command?.SubmitAction?.actor_slot === "slot_4" &&
          hardening.concurrentPlayerActionAdvanceRace?.reject?.requestEnvelope?.body
            ?.body?.command?.SubmitAction?.action_id === "role_factional_kill" &&
          hardening.concurrentPlayerActionAdvanceRace?.reject?.requestEnvelope?.body
            ?.body?.command?.SubmitAction?.template_id === "factional_kill" &&
          hardening.concurrentPlayerActionAdvanceRace?.advance?.state === "ack" &&
          hardening.concurrentPlayerActionAdvanceRace?.advance?.serverEnvelope?.body
            ?.kind === "Ack" &&
          Array.isArray(
            hardening.concurrentPlayerActionAdvanceRace?.advance?.streamSeqs,
          ) &&
          hardening.concurrentPlayerActionAdvanceRace.advance.streamSeqs.length ===
            1 &&
          hardening.concurrentPlayerActionAdvanceRace?.commandStateAfterRace
            ?.actorSlot === "slot_4" &&
          hardening.concurrentPlayerActionAdvanceRace?.commandStateAfterRace?.phase
            ?.phaseId === "D02" &&
          hardening.concurrentPlayerActionAdvanceRace?.commandStateAfterRace?.phase
            ?.locked === false &&
          hardening.concurrentPlayerActionAdvanceRace?.commandStateAfterRace?.actions
            ?.length === 0 &&
          hardening.concurrentPlayerActionAdvanceRace?.buttonsAfterRace?.some(
            (button) => button.action === "submit_action:factional_kill",
          ) === false &&
          hardening.concurrentPlayerActionAdvanceRace?.hostPhaseAfterRace?.id ===
            "D02" &&
          hardening.concurrentPlayerActionAdvanceRace?.hostPhaseAfterRace?.locked ===
            false &&
          hardening.concurrentPlayerActionAdvanceRace?.hostPhaseActionsAfterRace?.includes(
            hostResolvePhaseActionId,
          ) === true &&
          hardening.concurrentPlayerActionAdvanceRace?.hostPhaseActionsAfterRace?.includes(
            hostAdvancePhaseActionId,
          ) === false &&
          hardening.concurrentPlayerActionAdvanceRace?.apiCommandStateAfterRace
            ?.actor_slot === "slot_4" &&
          hardening.concurrentPlayerActionAdvanceRace?.apiCommandStateAfterRace
            ?.phase?.phase_id === "D02" &&
          hardening.concurrentPlayerActionAdvanceRace?.apiCommandStateAfterRace
            ?.phase?.locked === false &&
          hardening.concurrentPlayerActionAdvanceRace?.apiCommandStateAfterRace
            ?.actions?.length === 0 &&
          hardening.concurrentPlayerActionAdvanceRace?.apiHostStateAfterRace?.phase
            ?.phase_id === "D02" &&
          hardening.concurrentPlayerActionAdvanceRace?.apiHostStateAfterRace?.phase
            ?.locked === false,
      },
    ),
    lane(
      "concurrent-player-action-advance-race-reload",
      "Concurrent player action and host advance reload role surfaces",
      {
        game: hardening.concurrentPlayerActionAdvanceRace?.game ?? null,
        actionRouteStatus:
          hardening.concurrentPlayerActionAdvanceRace?.roleReloadAfterRace
            ?.actionRouteResponseStatus ?? null,
        hostRouteStatus:
          hardening.concurrentPlayerActionAdvanceRace?.roleReloadAfterRace
            ?.hostRouteResponseStatus ?? null,
        phaseAfterReload:
          hardening.concurrentPlayerActionAdvanceRace?.roleReloadAfterRace
            ?.commandStateAfterReload?.phase?.phaseId ?? null,
        hostPhaseAfterReload:
          hardening.concurrentPlayerActionAdvanceRace?.roleReloadAfterRace
            ?.hostPhaseAfterReload?.id ?? null,
        passed:
          hardening.concurrentPlayerActionAdvanceRace?.status === "passed" &&
          hardening.concurrentPlayerActionAdvanceRace?.roleReloadAfterRace?.status ===
            "passed" &&
          hardening.concurrentPlayerActionAdvanceRace?.roleReloadAfterRace
            ?.actionRouteResponseStatus === 200 &&
          hardening.concurrentPlayerActionAdvanceRace?.roleReloadAfterRace
            ?.hostRouteResponseStatus === 200 &&
          hardening.concurrentPlayerActionAdvanceRace?.roleReloadAfterRace
            ?.commandStateAfterReload?.actorSlot === "slot_4" &&
          hardening.concurrentPlayerActionAdvanceRace?.roleReloadAfterRace
            ?.commandStateAfterReload?.phase?.phaseId === "D02" &&
          hardening.concurrentPlayerActionAdvanceRace?.roleReloadAfterRace
            ?.commandStateAfterReload?.phase?.locked === false &&
          hardening.concurrentPlayerActionAdvanceRace?.roleReloadAfterRace
            ?.commandStateAfterReload?.actions?.length === 0 &&
          hardening.concurrentPlayerActionAdvanceRace?.roleReloadAfterRace
            ?.buttonsAfterReload?.some(
              (button) => button.action === "submit_action:factional_kill",
            ) === false &&
          hardening.concurrentPlayerActionAdvanceRace?.roleReloadAfterRace
            ?.hostPhaseAfterReload?.id === "D02" &&
          hardening.concurrentPlayerActionAdvanceRace?.roleReloadAfterRace
            ?.hostPhaseAfterReload?.locked === false &&
          hardening.concurrentPlayerActionAdvanceRace?.roleReloadAfterRace
            ?.hostPhaseActionsAfterReload?.includes(hostResolvePhaseActionId) === true &&
          hardening.concurrentPlayerActionAdvanceRace?.roleReloadAfterRace
            ?.hostPhaseActionsAfterReload?.includes(hostAdvancePhaseActionId) === false &&
          hardening.concurrentPlayerActionAdvanceRace?.roleReloadAfterRace
            ?.apiCommandStateAfterReload?.actor_slot === "slot_4" &&
          hardening.concurrentPlayerActionAdvanceRace?.roleReloadAfterRace
            ?.apiCommandStateAfterReload?.phase?.phase_id === "D02" &&
          hardening.concurrentPlayerActionAdvanceRace?.roleReloadAfterRace
            ?.apiCommandStateAfterReload?.phase?.locked === false &&
          hardening.concurrentPlayerActionAdvanceRace?.roleReloadAfterRace
            ?.apiCommandStateAfterReload?.actions?.length === 0 &&
          hardening.concurrentPlayerActionAdvanceRace?.roleReloadAfterRace
            ?.apiHostStateAfterReload?.phase?.phase_id === "D02" &&
          hardening.concurrentPlayerActionAdvanceRace?.roleReloadAfterRace
            ?.apiHostStateAfterReload?.phase?.locked === false,
      },
    ),
    lane(
      "concurrent-cohost-deadline-resolve-race",
      "Concurrent cohost deadline and host resolve converge",
      {
        game: hardening.concurrentCohostDeadlineResolveRace?.game ?? null,
        deadlineState:
          hardening.concurrentCohostDeadlineResolveRace?.deadline?.state ?? null,
        deadlineError:
          hardening.concurrentCohostDeadlineResolveRace?.deadline?.error ?? null,
        deadlineSeq:
          hardening.concurrentCohostDeadlineResolveRace?.deadlineSeq ?? null,
        resolveSeq:
          hardening.concurrentCohostDeadlineResolveRace?.resolveSeq ?? null,
        apiDeadline:
          hardening.concurrentCohostDeadlineResolveRace?.hostStateAfterRace?.phase
            ?.deadline ?? null,
        passed:
          hardening.concurrentCohostDeadlineResolveRace?.status === "passed" &&
          hardening.concurrentCohostDeadlineResolveRace?.hostEntry?.capabilityKinds?.includes(
            "HostOf",
          ) === true &&
          hardening.concurrentCohostDeadlineResolveRace?.cohostEntry?.capabilityKinds?.includes(
            "CohostOf",
          ) === true &&
          hardening.concurrentCohostDeadlineResolveRace?.setupHostPhase?.id ===
            "D01" &&
          hardening.concurrentCohostDeadlineResolveRace?.setupHostPhase?.locked ===
            false &&
          hardening.concurrentCohostDeadlineResolveRace?.setupCohostPhase?.id ===
            "D01" &&
          hardening.concurrentCohostDeadlineResolveRace?.setupCohostPhase?.locked ===
            false &&
          hardening.concurrentCohostDeadlineResolveRace?.setupHostPhaseActions?.includes(
            hostResolvePhaseActionId,
          ) === true &&
          hardening.concurrentCohostDeadlineResolveRace?.setupHostDeadlineActions?.includes(
            hostExtendDeadlineActionId,
          ) === true &&
          hardening.concurrentCohostDeadlineResolveRace?.setupCohostPhaseActions
            ?.length === 0 &&
          hardening.concurrentCohostDeadlineResolveRace?.setupCohostDeadlineActions?.includes(
            hostExtendDeadlineActionId,
          ) === true &&
          hardening.concurrentCohostDeadlineResolveRace?.resolve?.state === "ack" &&
          hardening.concurrentCohostDeadlineResolveRace?.resolve?.serverEnvelope?.body
            ?.kind === "Ack" &&
          Array.isArray(
            hardening.concurrentCohostDeadlineResolveRace?.resolve?.streamSeqs,
          ) &&
          hardening.concurrentCohostDeadlineResolveRace.resolve.streamSeqs.length >=
            3 &&
          hardening.concurrentCohostDeadlineResolveRace?.resolve?.requestEnvelope
            ?.body?.body?.command?.ResolvePhase?.game ===
            hardening.concurrentCohostDeadlineResolveRace?.game &&
          hardening.concurrentCohostDeadlineResolveRace?.deadline?.requestEnvelope
            ?.body?.body?.command?.ExtendDeadline?.game ===
            hardening.concurrentCohostDeadlineResolveRace?.game &&
          hardening.concurrentCohostDeadlineResolveRace?.deadline?.requestEnvelope
            ?.body?.body?.command?.ExtendDeadline?.phase === "D01" &&
          hardening.concurrentCohostDeadlineResolveRace?.deadline?.requestEnvelope
            ?.body?.body?.command?.ExtendDeadline?.at ===
            hardening.concurrentCohostDeadlineResolveRace?.deadlineAt &&
          ((hardening.concurrentCohostDeadlineResolveRace?.deadline?.state ===
            "ack" &&
            hardening.concurrentCohostDeadlineResolveRace?.deadline?.serverEnvelope
              ?.body?.kind === "Ack" &&
            Array.isArray(
              hardening.concurrentCohostDeadlineResolveRace?.deadline?.streamSeqs,
            ) &&
            hardening.concurrentCohostDeadlineResolveRace.deadline.streamSeqs.length ===
              1 &&
            hardening.concurrentCohostDeadlineResolveRace.deadlineSeq <
              hardening.concurrentCohostDeadlineResolveRace.resolveSeq &&
            hardening.concurrentCohostDeadlineResolveRace?.hostPhaseAfterRace
              ?.deadline ===
              hardening.concurrentCohostDeadlineResolveRace?.deadlineAt) ||
            (hardening.concurrentCohostDeadlineResolveRace?.deadline?.state ===
              "reject" &&
              hardening.concurrentCohostDeadlineResolveRace?.deadline?.error ===
                "PhaseLocked" &&
              hardening.concurrentCohostDeadlineResolveRace?.deadline?.serverEnvelope
                ?.body?.kind === "Reject" &&
              Array.isArray(
                hardening.concurrentCohostDeadlineResolveRace?.deadline?.streamSeqs,
              ) === false &&
              hardening.concurrentCohostDeadlineResolveRace?.hostPhaseAfterRace
                ?.deadline === null)) &&
          hardening.concurrentCohostDeadlineResolveRace?.hostPhaseAfterRace?.id ===
            "D01" &&
          hardening.concurrentCohostDeadlineResolveRace?.hostPhaseAfterRace?.locked ===
            true &&
          hardening.concurrentCohostDeadlineResolveRace?.cohostPhaseAfterRace?.id ===
            "D01" &&
          hardening.concurrentCohostDeadlineResolveRace?.cohostPhaseAfterRace?.locked ===
            true &&
          hardening.concurrentCohostDeadlineResolveRace?.hostPhaseActionsAfterRace?.includes(
            hostUnlockThreadActionId,
          ) === true &&
          hardening.concurrentCohostDeadlineResolveRace?.hostPhaseActionsAfterRace?.includes(
            hostAdvancePhaseActionId,
          ) === true &&
          hardening.concurrentCohostDeadlineResolveRace?.hostPhaseActionsAfterRace?.includes(
            hostResolvePhaseActionId,
          ) === false &&
          hardening.concurrentCohostDeadlineResolveRace?.cohostPhaseActionsAfterRace
            ?.length === 0 &&
          hardening.concurrentCohostDeadlineResolveRace?.hostDeadlineActionsAfterRace?.includes(
            hostExtendDeadlineActionId,
          ) === true &&
          hardening.concurrentCohostDeadlineResolveRace?.cohostDeadlineActionsAfterRace?.includes(
            hostExtendDeadlineActionId,
          ) === true &&
          hardening.concurrentCohostDeadlineResolveRace?.hostStateAfterRace?.phase
            ?.phase_id === "D01" &&
          hardening.concurrentCohostDeadlineResolveRace?.hostStateAfterRace?.phase
            ?.locked === true &&
          hardening.concurrentCohostDeadlineResolveRace?.cohostStateAfterRace?.phase
            ?.phase_id === "D01" &&
          hardening.concurrentCohostDeadlineResolveRace?.cohostStateAfterRace?.phase
            ?.locked === true,
      },
    ),
    lane(
      "concurrent-cohost-deadline-resolve-race-reload",
      "Concurrent cohost deadline and host resolve reload role surfaces",
      {
        game: hardening.concurrentCohostDeadlineResolveRace?.game ?? null,
        expectedDeadline:
          hardening.concurrentCohostDeadlineResolveRace?.roleReloadAfterRace
            ?.expectedDeadline ?? null,
        hostRouteStatus:
          hardening.concurrentCohostDeadlineResolveRace?.roleReloadAfterRace
            ?.hostRouteResponseStatus ?? null,
        cohostRouteStatus:
          hardening.concurrentCohostDeadlineResolveRace?.roleReloadAfterRace
            ?.cohostRouteResponseStatus ?? null,
        hostPhaseActions:
          hardening.concurrentCohostDeadlineResolveRace?.roleReloadAfterRace
            ?.hostPhaseActionsAfterReload ?? null,
        cohostPhaseActions:
          hardening.concurrentCohostDeadlineResolveRace?.roleReloadAfterRace
            ?.cohostPhaseActionsAfterReload ?? null,
        hostDeadline:
          hardening.concurrentCohostDeadlineResolveRace?.roleReloadAfterRace
            ?.hostApiPhaseAfterReload?.deadline ?? null,
        cohostDeadline:
          hardening.concurrentCohostDeadlineResolveRace?.roleReloadAfterRace
            ?.cohostApiPhaseAfterReload?.deadline ?? null,
        passed:
          hardening.concurrentCohostDeadlineResolveRace?.status === "passed" &&
          hardening.concurrentCohostDeadlineResolveRace?.roleReloadAfterRace?.status ===
            "passed" &&
          hardening.concurrentCohostDeadlineResolveRace?.roleReloadAfterRace
            ?.hostRouteResponseStatus === 200 &&
          hardening.concurrentCohostDeadlineResolveRace?.roleReloadAfterRace
            ?.cohostRouteResponseStatus === 200 &&
          hardening.concurrentCohostDeadlineResolveRace?.roleReloadAfterRace
            ?.hostPhaseAfterReload?.id === "D01" &&
          hardening.concurrentCohostDeadlineResolveRace?.roleReloadAfterRace
            ?.hostPhaseAfterReload?.locked === true &&
          hardening.concurrentCohostDeadlineResolveRace?.roleReloadAfterRace
            ?.hostPhaseAfterReload?.deadline ===
            hardening.concurrentCohostDeadlineResolveRace?.roleReloadAfterRace
              ?.expectedDeadline &&
          hardening.concurrentCohostDeadlineResolveRace?.roleReloadAfterRace
            ?.cohostPhaseAfterReload?.id === "D01" &&
          hardening.concurrentCohostDeadlineResolveRace?.roleReloadAfterRace
            ?.cohostPhaseAfterReload?.locked === true &&
          hardening.concurrentCohostDeadlineResolveRace?.roleReloadAfterRace
            ?.cohostPhaseAfterReload?.deadline ===
            hardening.concurrentCohostDeadlineResolveRace?.roleReloadAfterRace
              ?.expectedDeadline &&
          hardening.concurrentCohostDeadlineResolveRace?.roleReloadAfterRace
            ?.hostPhaseActionsAfterReload?.includes(hostUnlockThreadActionId) === true &&
          hardening.concurrentCohostDeadlineResolveRace?.roleReloadAfterRace
            ?.hostPhaseActionsAfterReload?.includes(hostAdvancePhaseActionId) === true &&
          hardening.concurrentCohostDeadlineResolveRace?.roleReloadAfterRace
            ?.hostPhaseActionsAfterReload?.includes(hostResolvePhaseActionId) === false &&
          hardening.concurrentCohostDeadlineResolveRace?.roleReloadAfterRace
            ?.hostPhaseActionsAfterReload?.includes(hostLockThreadActionId) === false &&
          hardening.concurrentCohostDeadlineResolveRace?.roleReloadAfterRace
            ?.cohostPhaseActionsAfterReload?.length === 0 &&
          hardening.concurrentCohostDeadlineResolveRace?.roleReloadAfterRace
            ?.hostDeadlineActionsAfterReload?.includes(hostExtendDeadlineActionId) === true &&
          hardening.concurrentCohostDeadlineResolveRace?.roleReloadAfterRace
            ?.cohostDeadlineActionsAfterReload?.includes(hostExtendDeadlineActionId) === true &&
          hardening.concurrentCohostDeadlineResolveRace?.roleReloadAfterRace
            ?.hostApiPhaseAfterReload?.phase_id === "D01" &&
          hardening.concurrentCohostDeadlineResolveRace?.roleReloadAfterRace
            ?.hostApiPhaseAfterReload?.locked === true &&
          hardening.concurrentCohostDeadlineResolveRace?.roleReloadAfterRace
            ?.hostApiPhaseAfterReload?.deadline ===
            hardening.concurrentCohostDeadlineResolveRace?.roleReloadAfterRace
              ?.expectedDeadline &&
          hardening.concurrentCohostDeadlineResolveRace?.roleReloadAfterRace
            ?.cohostApiPhaseAfterReload?.phase_id === "D01" &&
          hardening.concurrentCohostDeadlineResolveRace?.roleReloadAfterRace
            ?.cohostApiPhaseAfterReload?.locked === true &&
          hardening.concurrentCohostDeadlineResolveRace?.roleReloadAfterRace
            ?.cohostApiPhaseAfterReload?.deadline ===
            hardening.concurrentCohostDeadlineResolveRace?.roleReloadAfterRace
              ?.expectedDeadline,
      },
    ),
    lane(
      "concurrent-replacement-private-post-race",
      "Concurrent replacement and private post converge",
      {
        game: hardening.concurrentReplacementPrivatePostRace?.game ?? null,
        postState: hardening.concurrentReplacementPrivatePostRace?.post?.state ?? null,
        postError: hardening.concurrentReplacementPrivatePostRace?.post?.error ?? null,
        postSeq: hardening.concurrentReplacementPrivatePostRace?.postSeq ?? null,
        replacementSeq:
          hardening.concurrentReplacementPrivatePostRace?.replacementSeq ?? null,
        apiOccupant:
          hardening.concurrentReplacementPrivatePostRace?.apiSlotAfterRace
            ?.occupant_user_id ?? null,
        passed:
          hardening.concurrentReplacementPrivatePostRace?.status === "passed" &&
          hardening.concurrentReplacementPrivatePostRace?.hostEntry?.capabilityKinds?.includes(
            "HostOf",
          ) === true &&
          hardening.concurrentReplacementPrivatePostRace?.playerEntry?.capabilityKinds?.includes(
            "SlotOccupant",
          ) === true &&
          hardening.concurrentReplacementPrivatePostRace?.setupHostReplacement
            ?.occupantLabel === "player-mira" &&
          hardening.concurrentReplacementPrivatePostRace?.setupCommandState
            ?.actorSlot === "slot-7" &&
          hardening.concurrentReplacementPrivatePostRace?.setupCommandState
            ?.actorStatus === "alive" &&
          hardening.concurrentReplacementPrivatePostRace?.setupChannelContext
            ?.channelId === "private:mafia_day_chat" &&
          hardening.concurrentReplacementPrivatePostRace?.setupChannelContext
            ?.actorSlot === "slot-7" &&
          hardening.concurrentReplacementPrivatePostRace?.setupChannelContext
            ?.actorStatus === "alive" &&
          ackedReplacementCommandMatches(
            hardening.concurrentReplacementPrivatePostRace?.replacement,
            replacementPrivatePostRaceScenario,
            hardening.concurrentReplacementPrivatePostRace?.game,
          ) &&
          hardening.concurrentReplacementPrivatePostRace?.post?.requestEnvelope?.body
            ?.body?.command?.SubmitPost?.channel_id === "private:mafia_day_chat" &&
          hardening.concurrentReplacementPrivatePostRace?.post?.requestEnvelope?.body
            ?.body?.command?.SubmitPost?.actor_slot === "slot-7" &&
          ((hardening.concurrentReplacementPrivatePostRace?.post?.state === "ack" &&
            hardening.concurrentReplacementPrivatePostRace?.post?.serverEnvelope
              ?.body?.kind === "Ack" &&
            hardening.concurrentReplacementPrivatePostRace?.postSeq <
              hardening.concurrentReplacementPrivatePostRace?.replacementSeq &&
            hardening.concurrentReplacementPrivatePostRace?.apiThreadPostBodies?.includes(
              hardening.concurrentReplacementPrivatePostRace?.postBody,
            ) === true) ||
            (hardening.concurrentReplacementPrivatePostRace?.post?.state ===
              "reject" &&
              hardening.concurrentReplacementPrivatePostRace?.post?.error ===
                "NotYourSlot" &&
              hardening.concurrentReplacementPrivatePostRace?.post?.serverEnvelope
                ?.body?.kind === "Reject" &&
              hardening.concurrentReplacementPrivatePostRace?.apiThreadPostBodies?.includes(
                hardening.concurrentReplacementPrivatePostRace?.postBody,
              ) === false)) &&
          staleOutgoingCommandStateForbidden(
            hardening.concurrentReplacementPrivatePostRace?.commandStateAfterRace,
            replacementPrivatePostRaceScenario,
          ) &&
          hardening.concurrentReplacementPrivatePostRace?.buttonsAfterRace?.some(
            (button) =>
              (button.action === "submit_post" ||
                button.action?.startsWith("submit_action")) &&
              button.disabled === false,
          ) === false &&
          replacementCurrentOwnerMatches(
            {
              hostProjection:
                hardening.concurrentReplacementPrivatePostRace
                  ?.hostReplacementAfterRace,
              apiSlot:
                hardening.concurrentReplacementPrivatePostRace?.apiSlotAfterRace,
            },
            replacementPrivatePostRaceScenario,
          ) &&
          hardening.concurrentReplacementPrivatePostRace?.staleRoute?.status === 403,
      },
    ),
    lane(
      "concurrent-replacement-private-post-race-reload",
      "Concurrent replacement private-post race reloads scoped channel truth",
      {
        game: hardening.concurrentReplacementPrivatePostRace?.game ?? null,
        staleRouteStatus:
          hardening.concurrentReplacementPrivatePostRace?.staleRoute?.status ?? null,
        staleRouteResponseStatus:
          hardening.concurrentReplacementPrivatePostRace?.staleRoute
            ?.responseStatus ?? null,
        staleRouteMessage:
          hardening.concurrentReplacementPrivatePostRace?.staleRoute?.message ?? null,
        commandStateStatus:
          hardening.concurrentReplacementPrivatePostRace?.commandStateAfterRace
            ?.status ?? null,
        commandStateError:
          hardening.concurrentReplacementPrivatePostRace?.commandStateAfterRace
            ?.error ?? null,
        hostOccupant:
          hardening.concurrentReplacementPrivatePostRace?.hostReplacementAfterRace
            ?.occupantLabel ?? null,
        apiOccupant:
          hardening.concurrentReplacementPrivatePostRace?.apiSlotAfterRace
            ?.occupant_user_id ?? null,
        stalePostControlsEnabled:
          hardening.concurrentReplacementPrivatePostRace?.buttonsAfterRace?.filter(
            (button) =>
              (button.action === "submit_post" ||
                button.action?.startsWith("submit_action")) &&
              button.disabled === false,
          ).length ?? null,
        passed:
          hardening.concurrentReplacementPrivatePostRace?.status === "passed" &&
          hardening.concurrentReplacementPrivatePostRace?.staleRoute?.status === 403 &&
          hardening.concurrentReplacementPrivatePostRace?.staleRoute
            ?.responseStatus === 403 &&
          hardening.concurrentReplacementPrivatePostRace?.staleRoute?.message?.includes(
            "requires scoped channel capability",
          ) === true &&
          staleOutgoingCommandStateForbidden(
            hardening.concurrentReplacementPrivatePostRace?.commandStateAfterRace,
            replacementPrivatePostRaceScenario,
          ) &&
          hardening.concurrentReplacementPrivatePostRace?.buttonsAfterRace?.some(
            (button) =>
              (button.action === "submit_post" ||
                button.action?.startsWith("submit_action")) &&
              button.disabled === false,
          ) === false &&
          replacementCurrentOwnerMatches(
            {
              hostProjection:
                hardening.concurrentReplacementPrivatePostRace
                  ?.hostReplacementAfterRace,
              apiSlot:
                hardening.concurrentReplacementPrivatePostRace?.apiSlotAfterRace,
            },
            replacementPrivatePostRaceScenario,
          ) &&
          hardening.concurrentReplacementPrivatePostRace?.apiThreadPostBodies?.includes(
            hardening.concurrentReplacementPrivatePostRace?.postBody,
          ) === (hardening.concurrentReplacementPrivatePostRace?.post?.state === "ack"),
      },
    ),
    lane(
      "concurrent-replacement-vote-race",
      "Concurrent replacement and vote converge",
      {
        game: hardening.concurrentReplacementVoteRace?.game ?? null,
        targetSlot: hardening.concurrentReplacementVoteRace?.targetSlot ?? null,
        voteState: hardening.concurrentReplacementVoteRace?.vote?.state ?? null,
        voteError: hardening.concurrentReplacementVoteRace?.vote?.error ?? null,
        voteSeq: hardening.concurrentReplacementVoteRace?.voteSeq ?? null,
        replacementSeq: hardening.concurrentReplacementVoteRace?.replacementSeq ?? null,
        apiOccupant:
          hardening.concurrentReplacementVoteRace?.apiSlotAfterRace
            ?.occupant_user_id ?? null,
        targetCount: hardening.concurrentReplacementVoteRace?.targetVotecount?.count ?? null,
        passed:
          hardening.concurrentReplacementVoteRace?.status === "passed" &&
          hardening.concurrentReplacementVoteRace?.targetSlot ===
            replacementVoteRaceScenario.targetSlot &&
          hardening.concurrentReplacementVoteRace?.hostEntry?.capabilityKinds?.includes(
            "HostOf",
          ) === true &&
          hardening.concurrentReplacementVoteRace?.playerEntry?.capabilityKinds?.includes(
            "SlotOccupant",
          ) === true &&
          hardening.concurrentReplacementVoteRace?.setupHostReplacement
            ?.occupantLabel ===
            replacementVoteRaceScenario.staleOutgoingPrincipalUserId &&
          hardening.concurrentReplacementVoteRace?.setupCommandState?.actorSlot ===
            replacementVoteRaceScenario.actorSlot &&
          hardening.concurrentReplacementVoteRace?.setupCommandState?.actorStatus ===
            "alive" &&
          hardening.concurrentReplacementVoteRace?.setupCommandState?.voteTargets?.some(
            (target) =>
              target.kind === "slot" &&
              target.slotId === replacementVoteRaceScenario.targetSlot,
          ) === true &&
          hardening.concurrentReplacementVoteRace?.replacement?.state === "ack" &&
          hardening.concurrentReplacementVoteRace?.replacement?.serverEnvelope?.body
            ?.kind === "Ack" &&
          hardening.concurrentReplacementVoteRace?.replacement?.requestEnvelope?.body
            ?.body?.command?.ProcessReplacement?.game ===
            hardening.concurrentReplacementVoteRace?.game &&
          hardening.concurrentReplacementVoteRace?.replacement?.requestEnvelope?.body
            ?.body?.command?.ProcessReplacement?.slot ===
            replacementVoteRaceScenario.actorSlot &&
          hardening.concurrentReplacementVoteRace?.replacement?.requestEnvelope?.body
            ?.body?.command?.ProcessReplacement?.outgoing_user ===
            replacementVoteRaceScenario.staleOutgoingPrincipalUserId &&
          hardening.concurrentReplacementVoteRace?.replacement?.requestEnvelope?.body
            ?.body?.command?.ProcessReplacement?.incoming_user ===
            replacementVoteRaceScenario.replacementPrincipalUserId &&
          hardening.concurrentReplacementVoteRace?.vote?.requestEnvelope?.body?.body
            ?.command?.SubmitVote?.actor_slot ===
            replacementVoteRaceScenario.actorSlot &&
          hardening.concurrentReplacementVoteRace?.vote?.requestEnvelope?.body?.body
            ?.command?.SubmitVote?.target?.Slot ===
            replacementVoteRaceScenario.targetSlot &&
          ((hardening.concurrentReplacementVoteRace?.vote?.state === "ack" &&
            hardening.concurrentReplacementVoteRace?.vote?.serverEnvelope?.body
              ?.kind === "Ack" &&
            hardening.concurrentReplacementVoteRace?.voteSeq <
              hardening.concurrentReplacementVoteRace?.replacementSeq &&
            hardening.concurrentReplacementVoteRace?.targetVotecount?.count === 1) ||
            (hardening.concurrentReplacementVoteRace?.vote?.state === "reject" &&
              hardening.concurrentReplacementVoteRace?.vote?.error ===
                replacementVoteRaceScenario.rejectionError &&
              hardening.concurrentReplacementVoteRace?.vote?.serverEnvelope?.body
                ?.kind === "Reject" &&
              hardening.concurrentReplacementVoteRace?.targetVotecount === null)) &&
          hardening.concurrentReplacementVoteRace?.commandStateAfterRace?.status ===
            403 &&
          hardening.concurrentReplacementVoteRace?.commandStateAfterRace?.error ===
            replacementVoteRaceScenario.rejectionError &&
          hardening.concurrentReplacementVoteRace?.hostReplacementAfterRace
            ?.occupantLabel === replacementVoteRaceScenario.replacementOccupantLabel &&
          hardening.concurrentReplacementVoteRace?.apiSlotAfterRace
            ?.occupant_user_id ===
            replacementVoteRaceScenario.replacementPrincipalUserId,
      },
    ),
    lane(
      "concurrent-replacement-vote-race-reload",
      "Concurrent replacement vote race reloads stale role rejection",
      {
        game: hardening.concurrentReplacementVoteRace?.game ?? null,
        commandStateStatus:
          hardening.concurrentReplacementVoteRace?.commandStateAfterRace?.status ??
          null,
        commandStateError:
          hardening.concurrentReplacementVoteRace?.commandStateAfterRace?.error ??
          null,
        hostOccupant:
          hardening.concurrentReplacementVoteRace?.hostReplacementAfterRace
            ?.occupantLabel ?? null,
        apiOccupant:
          hardening.concurrentReplacementVoteRace?.apiSlotAfterRace
            ?.occupant_user_id ?? null,
        voteState: hardening.concurrentReplacementVoteRace?.vote?.state ?? null,
        targetCount:
          hardening.concurrentReplacementVoteRace?.targetVotecount?.count ?? null,
        passed:
          hardening.concurrentReplacementVoteRace?.status === "passed" &&
          hardening.concurrentReplacementVoteRace?.commandStateAfterRace?.status ===
            403 &&
          hardening.concurrentReplacementVoteRace?.commandStateAfterRace?.error ===
            replacementVoteRaceScenario.rejectionError &&
          hardening.concurrentReplacementVoteRace?.hostReplacementAfterRace
            ?.occupantLabel === replacementVoteRaceScenario.replacementOccupantLabel &&
          hardening.concurrentReplacementVoteRace?.apiSlotAfterRace
            ?.occupant_user_id ===
            replacementVoteRaceScenario.replacementPrincipalUserId &&
          hardening.concurrentReplacementVoteRace?.targetVotecount?.count ===
            (hardening.concurrentReplacementVoteRace?.vote?.state === "ack"
              ? 1
              : undefined),
      },
    ),
    lane(
      "concurrent-replacement-action-race",
      "Concurrent replacement and action converge",
      {
        game: hardening.concurrentReplacementActionRace?.game ?? null,
        targetSlot: hardening.concurrentReplacementActionRace?.targetSlot ?? null,
        actionState: hardening.concurrentReplacementActionRace?.action?.state ?? null,
        actionError: hardening.concurrentReplacementActionRace?.action?.error ?? null,
        actionSeq: hardening.concurrentReplacementActionRace?.actionSeq ?? null,
        replacementSeq:
          hardening.concurrentReplacementActionRace?.replacementSeq ?? null,
        apiOccupant:
          hardening.concurrentReplacementActionRace?.apiSlotAfterRace
            ?.occupant_user_id ?? null,
        staleRetryError:
          hardening.concurrentReplacementActionRace?.staleRetry?.error ?? null,
        currentActionCount:
          hardening.concurrentReplacementActionRace?.currentCommandStateAfterRace
            ?.actions?.length ?? null,
        passed:
          hardening.concurrentReplacementActionRace?.status === "passed" &&
          hardening.concurrentReplacementActionRace?.targetSlot ===
            replacementActionRaceScenario.targetSlot &&
          hardening.concurrentReplacementActionRace?.hostEntry?.capabilityKinds?.includes(
            "HostOf",
          ) === true &&
          hardening.concurrentReplacementActionRace?.playerEntry?.capabilityKinds?.includes(
            "SlotOccupant",
          ) === true &&
          hardening.concurrentReplacementActionRace?.replacementEntry?.capabilityKinds?.includes(
            "SlotOccupant",
          ) === true &&
          hardening.concurrentReplacementActionRace?.setupHostPhase?.id ===
            replacementActionRaceScenario.phaseId &&
          hardening.concurrentReplacementActionRace?.setupHostPhase?.locked ===
            false &&
          hardening.concurrentReplacementActionRace?.setupSlot?.occupant_user_id ===
            replacementActionRaceScenario.staleOutgoingPrincipalUserId &&
          hardening.concurrentReplacementActionRace?.setupCommandState?.actorSlot ===
            replacementActionRaceScenario.actorSlot &&
          hardening.concurrentReplacementActionRace?.setupCommandState
            ?.actorStatus === "alive" &&
          hardening.concurrentReplacementActionRace?.setupCommandState?.phase
            ?.phaseId === replacementActionRaceScenario.phaseId &&
          hardening.concurrentReplacementActionRace?.setupCommandState?.actions?.some(
            (candidate) =>
              candidate.templateId === replacementActionRaceScenario.templateId,
          ) === true &&
          hardening.concurrentReplacementActionRace?.replacement?.state === "ack" &&
          hardening.concurrentReplacementActionRace?.replacement?.serverEnvelope
            ?.body?.kind === "Ack" &&
          hardening.concurrentReplacementActionRace?.replacement?.requestEnvelope
            ?.body?.body?.command?.ProcessReplacement?.game ===
            hardening.concurrentReplacementActionRace?.game &&
          hardening.concurrentReplacementActionRace?.replacement?.requestEnvelope
            ?.body?.body?.command?.ProcessReplacement?.slot ===
            replacementActionRaceScenario.actorSlot &&
          hardening.concurrentReplacementActionRace?.replacement?.requestEnvelope
            ?.body?.body?.command?.ProcessReplacement?.outgoing_user ===
            replacementActionRaceScenario.staleOutgoingPrincipalUserId &&
          hardening.concurrentReplacementActionRace?.replacement?.requestEnvelope
            ?.body?.body?.command?.ProcessReplacement?.incoming_user ===
            replacementActionRaceScenario.replacementPrincipalUserId &&
          hardening.concurrentReplacementActionRace?.action?.requestEnvelope?.body
            ?.body?.command?.SubmitAction?.actor_slot ===
            replacementActionRaceScenario.actorSlot &&
          hardening.concurrentReplacementActionRace?.action?.requestEnvelope?.body
            ?.body?.command?.SubmitAction?.action_id ===
            replacementActionRaceScenario.actionId &&
          hardening.concurrentReplacementActionRace?.action?.requestEnvelope?.body
            ?.body?.command?.SubmitAction?.template_id ===
            replacementActionRaceScenario.templateId &&
          hardening.concurrentReplacementActionRace?.action?.requestEnvelope?.body
            ?.body?.command?.SubmitAction?.targets?.[0] ===
            replacementActionRaceScenario.targetSlot &&
          ((hardening.concurrentReplacementActionRace?.action?.state === "ack" &&
            hardening.concurrentReplacementActionRace?.action?.serverEnvelope?.body
              ?.kind === "Ack" &&
            hardening.concurrentReplacementActionRace?.actionSeq <
              hardening.concurrentReplacementActionRace?.replacementSeq &&
            hardening.concurrentReplacementActionRace?.currentCommandStateAfterRace
              ?.actions?.length === 0 &&
            hardening.concurrentReplacementActionRace?.currentRoleCommandState
              ?.actions?.length === 0) ||
            (hardening.concurrentReplacementActionRace?.action?.state ===
              "reject" &&
              hardening.concurrentReplacementActionRace?.action?.error ===
                replacementActionRaceScenario.rejectionError &&
              hardening.concurrentReplacementActionRace?.action?.serverEnvelope
                ?.body?.kind === "Reject" &&
              hardening.concurrentReplacementActionRace?.currentCommandStateAfterRace
                ?.actions?.some(
                  (candidate) =>
                    candidate.template_id ===
                    replacementActionRaceScenario.templateId,
                ) === true &&
              hardening.concurrentReplacementActionRace?.currentRoleCommandState
                ?.actions?.some(
                  (candidate) =>
                    candidate.templateId === replacementActionRaceScenario.templateId,
                ) === true)) &&
          hardening.concurrentReplacementActionRace?.commandStateAfterRace?.status ===
            403 &&
          hardening.concurrentReplacementActionRace?.commandStateAfterRace?.error ===
            replacementActionRaceScenario.rejectionError &&
          hardening.concurrentReplacementActionRace?.staleRetry?.state ===
            "reject" &&
          hardening.concurrentReplacementActionRace?.staleRetry?.error ===
            replacementActionRaceScenario.rejectionError &&
          hardening.concurrentReplacementActionRace?.hostPhaseAfterRace?.id ===
            replacementActionRaceScenario.phaseId &&
          hardening.concurrentReplacementActionRace?.hostPhaseAfterRace?.locked ===
            false &&
          hardening.concurrentReplacementActionRace?.apiSlotAfterRace
            ?.occupant_user_id ===
            replacementActionRaceScenario.replacementPrincipalUserId &&
          hardening.concurrentReplacementActionRace?.currentCommandStateAfterRace
            ?.actor_slot === replacementActionRaceScenario.actorSlot &&
          hardening.concurrentReplacementActionRace?.currentCommandStateAfterRace
            ?.actor_status === "alive" &&
          hardening.concurrentReplacementActionRace?.currentRoleCommandState
            ?.actorSlot === replacementActionRaceScenario.actorSlot &&
          hardening.concurrentReplacementActionRace?.currentRoleCommandState
            ?.actorStatus === "alive",
      },
    ),
    lane(
      "concurrent-replacement-action-race-reload",
      "Concurrent replacement action race reloads current action authority",
      {
        game: hardening.concurrentReplacementActionRace?.game ?? null,
        commandStateStatus:
          hardening.concurrentReplacementActionRace?.commandStateAfterRace
            ?.status ?? null,
        commandStateError:
          hardening.concurrentReplacementActionRace?.commandStateAfterRace?.error ??
          null,
        staleRetryError:
          hardening.concurrentReplacementActionRace?.staleRetry?.error ?? null,
        apiOccupant:
          hardening.concurrentReplacementActionRace?.apiSlotAfterRace
            ?.occupant_user_id ?? null,
        currentCommandStateStatus:
          hardening.concurrentReplacementActionRace?.apiCurrentCommandStateStatus
            ?.status ?? null,
        currentActionCount:
          hardening.concurrentReplacementActionRace?.currentCommandStateAfterRace
            ?.actions?.length ?? null,
        currentRoleActionCount:
          hardening.concurrentReplacementActionRace?.currentRoleCommandState
            ?.actions?.length ?? null,
        enabledCurrentActionControls:
          hardening.concurrentReplacementActionRace?.currentRoleButtons?.filter(
            (button) =>
              button.action === replacementActionRaceScenario.commandAction &&
              button.disabled === false,
          ).length ?? null,
        passed:
          hardening.concurrentReplacementActionRace?.status === "passed" &&
          hardening.concurrentReplacementActionRace?.commandStateAfterRace?.status ===
            403 &&
          hardening.concurrentReplacementActionRace?.commandStateAfterRace?.error ===
            replacementActionRaceScenario.rejectionError &&
          hardening.concurrentReplacementActionRace?.staleRetry?.state ===
            "reject" &&
          hardening.concurrentReplacementActionRace?.staleRetry?.error ===
            replacementActionRaceScenario.rejectionError &&
          hardening.concurrentReplacementActionRace?.apiSlotAfterRace
            ?.occupant_user_id ===
            replacementActionRaceScenario.replacementPrincipalUserId &&
          hardening.concurrentReplacementActionRace?.apiCurrentCommandStateStatus
            ?.status === 200 &&
          hardening.concurrentReplacementActionRace?.currentCommandStateAfterRace
            ?.actor_slot === replacementActionRaceScenario.actorSlot &&
          hardening.concurrentReplacementActionRace?.currentCommandStateAfterRace
            ?.actor_status === "alive" &&
          hardening.concurrentReplacementActionRace?.currentCommandStateAfterRace
            ?.phase?.phase_id === replacementActionRaceScenario.phaseId &&
          hardening.concurrentReplacementActionRace?.currentCommandStateAfterRace
            ?.phase?.locked === false &&
          hardening.concurrentReplacementActionRace?.currentRoleCommandState
            ?.actorSlot === replacementActionRaceScenario.actorSlot &&
          hardening.concurrentReplacementActionRace?.currentRoleCommandState
            ?.actorStatus === "alive" &&
          hardening.concurrentReplacementActionRace?.currentRoleCommandState?.phase
            ?.phaseId === replacementActionRaceScenario.phaseId &&
          hardening.concurrentReplacementActionRace?.currentRoleCommandState?.phase
            ?.locked === false &&
          ((hardening.concurrentReplacementActionRace?.action?.state === "ack" &&
            hardening.concurrentReplacementActionRace?.currentCommandStateAfterRace
              ?.actions?.length === 0 &&
            hardening.concurrentReplacementActionRace?.currentRoleCommandState
              ?.actions?.length === 0 &&
            hardening.concurrentReplacementActionRace?.currentRoleButtons?.some(
              (button) =>
                button.action === replacementActionRaceScenario.commandAction &&
                button.disabled === false,
            ) === false) ||
            (hardening.concurrentReplacementActionRace?.action?.state ===
              "reject" &&
              hardening.concurrentReplacementActionRace?.action?.error ===
                replacementActionRaceScenario.rejectionError &&
              hardening.concurrentReplacementActionRace?.currentCommandStateAfterRace
                ?.actions?.some(
                  (candidate) =>
                    candidate.template_id ===
                    replacementActionRaceScenario.templateId,
                ) === true &&
              hardening.concurrentReplacementActionRace?.currentRoleCommandState
                ?.actions?.some(
                  (candidate) =>
                    candidate.templateId === replacementActionRaceScenario.templateId,
                ) === true &&
              hardening.concurrentReplacementActionRace?.currentRoleButtons?.some(
                (button) =>
                  button.action === replacementActionRaceScenario.commandAction &&
                  button.disabled === false,
              ) === true)),
      },
    ),
    lane("replacement-incoming-action", "Incoming replacement action resolves", {
      game: hardening.replacementIncomingAction?.game ?? null,
      targetSlot: hardening.replacementIncomingAction?.targetSlot ?? null,
      replacementState:
        hardening.replacementIncomingAction?.replacement?.state ?? null,
      actionState: hardening.replacementIncomingAction?.action?.state ?? null,
      targetAlive:
        hardening.replacementIncomingAction?.targetSlotAfterResolve?.alive ?? null,
      staleOutgoingError:
        hardening.replacementIncomingAction?.outgoingCommandStateAfterReplacement
          ?.error ?? null,
      rowanPrivateKillVisible:
        hardening.replacementIncomingAction?.replacementPrivateIsolation
          ?.targetKillVisible ?? null,
      passed:
        hardening.replacementIncomingAction?.status === "passed" &&
        hardening.replacementIncomingAction?.targetSlot ===
          replacementIncomingActionCase.targetSlot &&
        hardening.replacementIncomingAction?.hostEntry?.capabilityKinds?.includes(
          "HostOf",
        ) === true &&
        hardening.replacementIncomingAction?.replacementEntry?.capabilityKinds?.includes(
          "SlotOccupant",
        ) === true &&
        hardening.replacementIncomingAction?.targetEntry?.capabilityKinds?.includes(
          "SlotOccupant",
        ) === true &&
        hardening.replacementIncomingAction?.setupHostPhase?.id ===
          replacementIncomingActionCase.phaseId &&
        hardening.replacementIncomingAction?.setupHostPhase?.locked === false &&
        hardening.replacementIncomingAction?.setupSlot?.occupant_user_id ===
          replacementIncomingActionCase.staleOutgoingPrincipalUserId &&
        ackedReplacementCommandMatches(
          hardening.replacementIncomingAction?.replacement,
          replacementIncomingActionCase,
          hardening.replacementIncomingAction?.game,
        ) &&
        staleOutgoingCommandStateForbidden(
          hardening.replacementIncomingAction?.outgoingCommandStateAfterReplacement,
          replacementIncomingActionCase,
        ) &&
        hardening.replacementIncomingAction?.currentCommandStateBeforeAction
          ?.actorSlot === replacementIncomingActionCase.actorSlot &&
        hardening.replacementIncomingAction?.currentCommandStateBeforeAction
          ?.actorStatus === "alive" &&
        hardening.replacementIncomingAction?.currentCommandStateBeforeAction
          ?.phase?.phaseId === replacementIncomingActionCase.phaseId &&
        hardening.replacementIncomingAction?.currentCommandStateBeforeAction
          ?.actions?.some(
            (candidate) =>
              candidate.templateId === replacementIncomingActionCase.templateId,
          ) === true &&
        hardening.replacementIncomingAction?.action?.state === "ack" &&
        hardening.replacementIncomingAction?.action?.serverEnvelope?.body?.kind ===
          "Ack" &&
        hardening.replacementIncomingAction?.action?.requestEnvelope?.body?.body
          ?.principal_user_id ===
          replacementIncomingActionCase.replacementPrincipalUserId &&
        hardening.replacementIncomingAction?.action?.requestEnvelope?.body?.body
          ?.command?.SubmitAction?.actor_slot ===
          replacementIncomingActionCase.actorSlot &&
        hardening.replacementIncomingAction?.action?.requestEnvelope?.body?.body
          ?.command?.SubmitAction?.action_id ===
          replacementIncomingActionCase.actionId &&
        hardening.replacementIncomingAction?.action?.requestEnvelope?.body?.body
          ?.command?.SubmitAction?.template_id ===
          replacementIncomingActionCase.templateId &&
        hardening.replacementIncomingAction?.action?.requestEnvelope?.body?.body
          ?.command?.SubmitAction?.targets?.[0] ===
          replacementIncomingActionCase.targetSlot &&
        hardening.replacementIncomingAction?.currentCommandStateAfterAction
          ?.actions?.length === 0 &&
        hardening.replacementIncomingAction?.apiCommandStateAfterAction?.actions
          ?.length === 0 &&
        hardening.replacementIncomingAction?.resolveNight?.commandStatus?.state ===
          "ack" &&
        hardening.replacementIncomingAction?.hostPhaseAfterResolve?.id ===
          replacementIncomingActionCase.phaseId &&
        hardening.replacementIncomingAction?.hostPhaseAfterResolve?.locked ===
          true &&
        hardening.replacementIncomingAction?.targetSlotAfterResolve?.slot_id ===
          replacementIncomingActionCase.targetSlot &&
        hardening.replacementIncomingAction?.targetSlotAfterResolve?.alive ===
          false &&
        hardening.replacementIncomingAction?.targetSlotAfterResolve?.status ===
          replacementIncomingActionCase.targetStatusAfterKill &&
        hardening.replacementIncomingAction?.targetCommandState?.actorSlot ===
          replacementIncomingActionCase.targetSlot &&
        hardening.replacementIncomingAction?.targetCommandState?.actorAlive ===
          false &&
        hardening.replacementIncomingAction?.targetNotice?.audience_slot ===
          replacementIncomingActionCase.targetSlot &&
        hardening.replacementIncomingAction?.targetNotice?.effect ===
          replacementIncomingActionCase.targetNoticeEffect &&
        hardening.replacementIncomingAction?.targetNotice?.status ===
          replacementIncomingActionCase.templateId &&
        hardening.replacementIncomingAction?.replacementPrivateIsolation
          ?.targetKillVisible === false,
    }),
    lane("replacement-action-reconnect", "Replacement action reconnect recovers locked state", {
      game: hardening.replacementActionReconnect?.game ?? null,
      targetSlot: hardening.replacementActionReconnect?.targetSlot ?? null,
      replacementState:
        hardening.replacementActionReconnect?.replacement?.state ?? null,
      actionState: hardening.replacementActionReconnect?.action?.state ?? null,
      reconnectState:
        hardening.replacementActionReconnect?.reconnect?.reconnectRecoveryEvent
          ?.state ?? null,
      phaseLocked:
        hardening.replacementActionReconnect?.commandStateAfterReconnect?.phase
          ?.locked ?? null,
      actionCount:
        hardening.replacementActionReconnect?.commandStateAfterReconnect?.actions
          ?.length ?? null,
      rowanPrivateKillVisible:
        hardening.replacementActionReconnect
          ?.rowanPrivateIsolationAfterReconnect?.targetKillVisible ?? null,
      targetNoticeStatus:
        hardening.replacementActionReconnect?.targetNoticeAfterReconnect?.status ??
        null,
      passed:
        hardening.replacementActionReconnect?.status === "passed" &&
        hardening.replacementActionReconnect?.targetSlot ===
          replacementActionReconnectCase.targetSlot &&
        hardening.replacementActionReconnect?.hostEntry?.capabilityKinds?.includes(
          "HostOf",
        ) === true &&
        hardening.replacementActionReconnect?.replacementEntry?.capabilityKinds?.includes(
          "SlotOccupant",
        ) === true &&
        hardening.replacementActionReconnect?.targetEntry?.capabilityKinds?.includes(
          "SlotOccupant",
        ) === true &&
        ackedReplacementCommandMatches(
          hardening.replacementActionReconnect?.replacement,
          replacementActionReconnectCase,
          hardening.replacementActionReconnect?.game,
        ) &&
        hardening.replacementActionReconnect?.commandStateBeforeAction
          ?.actorSlot === replacementActionReconnectCase.actorSlot &&
        hardening.replacementActionReconnect?.commandStateBeforeAction
          ?.actorStatus === "alive" &&
        hardening.replacementActionReconnect?.commandStateBeforeAction?.actions?.some(
          (candidate) =>
            candidate.templateId === replacementActionReconnectCase.templateId,
        ) === true &&
        hardening.replacementActionReconnect?.action?.state === "ack" &&
        hardening.replacementActionReconnect?.action?.serverEnvelope?.body?.kind ===
          "Ack" &&
        hardening.replacementActionReconnect?.action?.requestEnvelope?.body?.body
          ?.principal_user_id ===
          replacementActionReconnectCase.replacementPrincipalUserId &&
        hardening.replacementActionReconnect?.action?.requestEnvelope?.body?.body
          ?.command?.SubmitAction?.actor_slot ===
          replacementActionReconnectCase.actorSlot &&
        hardening.replacementActionReconnect?.action?.requestEnvelope?.body?.body
          ?.command?.SubmitAction?.action_id ===
          replacementActionReconnectCase.actionId &&
        hardening.replacementActionReconnect?.action?.requestEnvelope?.body?.body
          ?.command?.SubmitAction?.template_id ===
          replacementActionReconnectCase.templateId &&
        hardening.replacementActionReconnect?.action?.requestEnvelope?.body?.body
          ?.command?.SubmitAction?.targets?.[0] ===
          replacementActionReconnectCase.targetSlot &&
        hardening.replacementActionReconnect?.resolveNight?.commandStatus?.state ===
          "ack" &&
        hardening.replacementActionReconnect?.targetSlotAfterResolve?.slot_id ===
          replacementActionReconnectCase.targetSlot &&
        hardening.replacementActionReconnect?.targetSlotAfterResolve?.alive ===
          false &&
        hardening.replacementActionReconnect?.targetSlotAfterResolve?.status ===
          replacementActionReconnectCase.targetStatusAfterKill &&
        hardening.replacementActionReconnect?.targetCommandState?.actorSlot ===
          replacementActionReconnectCase.targetSlot &&
        hardening.replacementActionReconnect?.targetCommandState?.actorAlive ===
          false &&
        hardening.replacementActionReconnect?.targetCommandState?.actorStatus ===
          "dead" &&
        hardening.replacementActionReconnect?.targetNoticeBeforeReconnect
          ?.audience_slot === replacementActionReconnectCase.targetSlot &&
        hardening.replacementActionReconnect?.targetNoticeBeforeReconnect
          ?.effect === replacementActionReconnectCase.targetNoticeEffect &&
        hardening.replacementActionReconnect?.targetNoticeBeforeReconnect
          ?.status === replacementActionReconnectCase.templateId &&
        hardening.replacementActionReconnect?.reconnect?.status === "passed" &&
        hardening.replacementActionReconnect?.reconnect?.principalUserId ===
          replacementActionReconnectCase.replacementPrincipalUserId &&
        hardening.replacementActionReconnect?.reconnect?.actorSlot ===
          replacementActionReconnectCase.actorSlot &&
        hardening.replacementActionReconnect?.reconnect?.reconnectingStatus?.state ===
          "reconnecting" &&
        hardening.replacementActionReconnect?.reconnect?.reconnectRecoveryEvent
          ?.attempt === 1 &&
        hardening.replacementActionReconnect?.reconnect?.reconnectRecoveryEvent
          ?.state === "recovered" &&
        hardening.replacementActionReconnect?.reconnect
          ?.recoveredSnapshotContainsPost === true &&
        hardening.replacementActionReconnect?.reconnect?.reconnectCommand
          ?.principalUserId ===
          replacementActionReconnectCase.replacementPrincipalUserId &&
        hardening.replacementActionReconnect?.reconnect?.reconnectCommand?.command
          ?.SubmitPost?.actor_slot === replacementActionReconnectCase.actorSlot &&
        hardening.replacementActionReconnect?.commandStateAfterReconnect
          ?.actorSlot === replacementActionReconnectCase.actorSlot &&
        hardening.replacementActionReconnect?.commandStateAfterReconnect
          ?.actorAlive === true &&
        hardening.replacementActionReconnect?.commandStateAfterReconnect
          ?.actorStatus === "alive" &&
        hardening.replacementActionReconnect?.commandStateAfterReconnect?.phase
          ?.phaseId === replacementActionReconnectCase.phaseId &&
        hardening.replacementActionReconnect?.commandStateAfterReconnect?.phase
          ?.locked === true &&
        hardening.replacementActionReconnect?.commandStateAfterReconnect?.actions
          ?.length === 0 &&
        hardening.replacementActionReconnect?.buttonsAfterReconnect?.some(
          (button) => button.action === replacementActionReconnectCase.commandAction,
        ) === false &&
        hardening.replacementActionReconnect?.rowanPrivateIsolationAfterReconnect
          ?.targetKillVisible === false &&
        hardening.replacementActionReconnect?.targetNoticeAfterReconnect
          ?.audience_slot === replacementActionReconnectCase.targetSlot &&
        hardening.replacementActionReconnect?.targetNoticeAfterReconnect?.effect ===
          replacementActionReconnectCase.targetNoticeEffect &&
        hardening.replacementActionReconnect?.targetNoticeAfterReconnect?.status ===
          replacementActionReconnectCase.templateId,
    }),
    lane("replacement-stale-action-after-resolve", "Stale replacement action rejects after resolve", {
      game: hardening.replacementStaleActionAfterResolve?.game ?? null,
      targetSlot: hardening.replacementStaleActionAfterResolve?.targetSlot ?? null,
      rejectError:
        hardening.replacementStaleActionAfterResolve?.reject?.error ?? null,
      refreshedPhase:
        hardening.replacementStaleActionAfterResolve?.commandStateAfterReject
          ?.phase?.phaseId ?? null,
      refreshedLocked:
        hardening.replacementStaleActionAfterResolve?.commandStateAfterReject
          ?.phase?.locked ?? null,
      refreshedActionCount:
        hardening.replacementStaleActionAfterResolve?.commandStateAfterReject
          ?.actions?.length ?? null,
      targetAlive:
        hardening.replacementStaleActionAfterResolve?.targetSlotAfterReject?.alive ??
        null,
      rowanPrivateKillVisible:
        hardening.replacementStaleActionAfterResolve
          ?.rowanPrivateIsolationAfterReject?.targetKillVisible ?? null,
      targetNoticePresent:
        hardening.replacementStaleActionAfterResolve?.targetNoticeAfterReject !==
        undefined
          ? hardening.replacementStaleActionAfterResolve?.targetNoticeAfterReject !== null
          : null,
      passed:
        hardening.replacementStaleActionAfterResolve?.status === "passed" &&
        hardening.replacementStaleActionAfterResolve?.targetSlot ===
          replacementStaleActionAfterResolveCase.targetSlot &&
        hardening.replacementStaleActionAfterResolve?.hostEntry?.capabilityKinds?.includes(
          "HostOf",
        ) === true &&
        hardening.replacementStaleActionAfterResolve?.replacementEntry?.capabilityKinds?.includes(
          "SlotOccupant",
        ) === true &&
        hardening.replacementStaleActionAfterResolve?.targetEntry?.capabilityKinds?.includes(
          "SlotOccupant",
        ) === true &&
        ackedReplacementCommandMatches(
          hardening.replacementStaleActionAfterResolve?.replacement,
          replacementStaleActionAfterResolveCase,
          hardening.replacementStaleActionAfterResolve?.game,
        ) &&
        hardening.replacementStaleActionAfterResolve?.commandStateBeforeClose
          ?.actorSlot === replacementStaleActionAfterResolveCase.actorSlot &&
        hardening.replacementStaleActionAfterResolve?.commandStateBeforeClose
          ?.actorStatus === "alive" &&
        hardening.replacementStaleActionAfterResolve?.commandStateBeforeClose?.phase
          ?.phaseId === replacementStaleActionAfterResolveCase.phaseId &&
        hardening.replacementStaleActionAfterResolve?.commandStateBeforeClose?.phase
          ?.locked === false &&
        hardening.replacementStaleActionAfterResolve?.commandStateBeforeClose
          ?.actions?.some(
            (candidate) =>
              candidate.templateId ===
              replacementStaleActionAfterResolveCase.templateId,
          ) === true &&
        hardening.replacementStaleActionAfterResolve?.actionButtonBeforeClose
          ?.action === replacementStaleActionAfterResolveCase.commandAction &&
        hardening.replacementStaleActionAfterResolve?.actionButtonBeforeClose
          ?.disabled === false &&
        hardening.replacementStaleActionAfterResolve?.closedStatus?.state ===
          "closed" &&
        hardening.replacementStaleActionAfterResolve?.resolveNight?.commandStatus
          ?.state === "ack" &&
        hardening.replacementStaleActionAfterResolve?.hostPhaseAfterResolve?.id ===
          replacementStaleActionAfterResolveCase.phaseId &&
        hardening.replacementStaleActionAfterResolve?.hostPhaseAfterResolve
          ?.locked === true &&
        hardening.replacementStaleActionAfterResolve?.hostPhaseActionsAfterResolve?.includes(
          hostAdvancePhaseActionId,
        ) === true &&
        hardening.replacementStaleActionAfterResolve?.targetSlotAfterResolve
          ?.slot_id === replacementStaleActionAfterResolveCase.targetSlot &&
        hardening.replacementStaleActionAfterResolve?.targetSlotAfterResolve
          ?.alive === true &&
        staleActionRejectRecoveryMatches(
          hardening.replacementStaleActionAfterResolve,
          {
            error: replacementStaleActionAfterResolveCase.rejectionError,
            actorSlot: replacementStaleActionAfterResolveCase.actorSlot,
            actionId: replacementStaleActionAfterResolveCase.staleActionId,
            templateId: replacementStaleActionAfterResolveCase.templateId,
            commandAction: replacementStaleActionAfterResolveCase.commandAction,
            messageFragments: [
              replacementStaleActionAfterResolveCase
                .staleActionStateMessageFragment,
              replacementStaleActionAfterResolveCase
                .currentActionControlsMessageFragment,
            ],
            dispatchRefreshKeys: [
              "notifications",
              "investigationResults",
              "commandState",
            ],
            receiptRefreshKeys: ["commandState"],
            receiptStatusFragments: [
              replacementStaleActionAfterResolveCase.rejectionStatusText,
              replacementStaleActionAfterResolveCase
                .staleActionStateMessageFragment,
            ],
            browserCommandState: {
              actorSlot: replacementStaleActionAfterResolveCase.actorSlot,
              actorAlive: true,
              actorStatus: "alive",
              phaseId: replacementStaleActionAfterResolveCase.phaseId,
              locked: true,
              actionCount: 0,
            },
            apiCommandState: {
              actorSlot: replacementStaleActionAfterResolveCase.actorSlot,
              actorAlive: true,
              actorStatus: "alive",
              phaseId: replacementStaleActionAfterResolveCase.phaseId,
              locked: true,
              actionCount: 0,
            },
          },
        ) &&
        hardening.replacementStaleActionAfterResolve?.targetSlotAfterReject
          ?.slot_id === replacementStaleActionAfterResolveCase.targetSlot &&
        hardening.replacementStaleActionAfterResolve?.targetSlotAfterReject
          ?.alive === true &&
        hardening.replacementStaleActionAfterResolve?.targetSlotAfterReject
          ?.status === "alive" &&
        hardening.replacementStaleActionAfterResolve?.rowanPrivateIsolationAfterReject
          ?.targetKillVisible === false &&
        hardening.replacementStaleActionAfterResolve?.targetCommandStateAfterReject
          ?.actorSlot === replacementStaleActionAfterResolveCase.targetSlot &&
        hardening.replacementStaleActionAfterResolve?.targetCommandStateAfterReject
          ?.actorAlive === true &&
        hardening.replacementStaleActionAfterResolve?.targetCommandStateAfterReject
          ?.actorStatus === "alive" &&
        hardening.replacementStaleActionAfterResolve?.targetCommandStateAfterReject
          ?.phase?.phaseId === replacementStaleActionAfterResolveCase.phaseId &&
        hardening.replacementStaleActionAfterResolve?.targetCommandStateAfterReject
          ?.phase?.locked === true &&
        hardening.replacementStaleActionAfterResolve?.targetNoticeAfterReject === null,
    }),
    lane(
      "replacement-stale-private-post-after-resolve",
      "Stale replacement private post refreshes after resolve",
      {
        game: hardening.replacementStalePrivatePostAfterResolve?.game ?? null,
        channel:
          hardening.replacementStalePrivatePostAfterResolve?.channel ?? null,
        postState:
          hardening.replacementStalePrivatePostAfterResolve?.stalePost?.state ??
          null,
        refreshedPhase:
          hardening.replacementStalePrivatePostAfterResolve?.commandStateAfterAck
            ?.phase?.phaseId ?? null,
        refreshedLocked:
          hardening.replacementStalePrivatePostAfterResolve?.commandStateAfterAck
            ?.phase?.locked ?? null,
        staleRouteStatus:
          hardening.replacementStalePrivatePostAfterResolve
            ?.staleOutgoingRouteAfterAck?.status ?? null,
        normalizedProofStatus:
          replacementResolvedPrivatePostAckProof.status,
        replacementResolvedPrivatePostAckProof,
        passed:
          replacementResolvedPrivatePostAckMatches(
            hardening.replacementStalePrivatePostAfterResolve,
            replacementResolvedPrivatePostScenario,
          ) &&
          replacementResolvedPrivatePostAckProof.status === "passed",
      },
    ),
    lane(
      "replacement-stale-private-post-reconnect",
      "Replacement private channel reconnects after stale post",
      {
        game: hardening.replacementStalePrivatePostAfterResolve?.game ?? null,
        channel:
          hardening.replacementStalePrivatePostAfterResolve?.channel ?? null,
        reconnectState:
          hardening.replacementStalePrivatePostAfterResolve?.privateReconnectAfterAck
            ?.reconnectRecoveryEvent?.state ?? null,
        recoveredPhase:
          hardening.replacementStalePrivatePostAfterResolve?.privateReconnectAfterAck
            ?.recoveredCommandState?.phase?.phaseId ?? null,
        recoveredLocked:
          hardening.replacementStalePrivatePostAfterResolve?.privateReconnectAfterAck
            ?.recoveredCommandState?.phase?.locked ?? null,
        staleThreadStatus:
          hardening.replacementStalePrivatePostAfterResolve?.privateReconnectAfterAck
            ?.staleOutgoingThreadAfterReconnect?.status ?? null,
        normalizedProofStatus:
          replacementResolvedPrivatePostReconnectProof.status,
        replacementResolvedPrivatePostReconnectProof,
        passed:
          replacementResolvedPrivatePostReconnectMatches(
            hardening.replacementStalePrivatePostAfterResolve,
            hardening.replacementStalePrivatePostAfterResolve
              ?.privateReconnectAfterAck,
            replacementResolvedPrivatePostScenario,
          ) &&
          replacementResolvedPrivatePostReconnectProof.status === "passed",
      },
    ),
    lane(
      "replacement-stale-private-post-after-complete",
      "Stale replacement private post rejects after completion",
      {
        game:
          hardening.replacementStalePrivatePostAfterComplete?.game ?? null,
        channel:
          hardening.replacementStalePrivatePostAfterComplete?.channel ?? null,
        rejectError:
          hardening.replacementStalePrivatePostAfterComplete?.reject?.error ??
          null,
        gameCompleted:
          hardening.replacementStalePrivatePostAfterComplete?.commandStateAfterReject
            ?.gameCompleted ?? null,
        staleThreadStatus:
          hardening.replacementStalePrivatePostAfterComplete
            ?.staleOutgoingThreadAfterReject?.status ?? null,
        normalizedProofStatus:
          replacementCompletedPrivatePostRejectProof.status,
        replacementCompletedPrivatePostRejectProof,
        passed:
          replacementCompletedPrivatePostRejectMatches(
            hardening.replacementStalePrivatePostAfterComplete,
            replacementCompletedPrivatePostScenario,
          ) &&
          replacementCompletedPrivatePostRejectProof.status === "passed",
      },
    ),
    lane(
      "replacement-stale-private-post-after-complete-reload",
      "Completed replacement private channel reload stays disabled",
      {
        game:
          hardening.replacementStalePrivatePostAfterComplete?.game ?? null,
        channel:
          hardening.replacementStalePrivatePostAfterComplete?.channel ?? null,
        routeStatus:
          hardening.replacementStalePrivatePostAfterComplete
            ?.privateReloadAfterReject?.routeResponseStatus ?? null,
        gameCompleted:
          hardening.replacementStalePrivatePostAfterComplete
            ?.privateReloadAfterReject?.recoveredCommandState?.gameCompleted ??
          null,
        staleRouteStatus:
          hardening.replacementStalePrivatePostAfterComplete
            ?.privateReloadAfterReject?.staleOutgoingRouteAfterReload?.status ??
          null,
        normalizedProofStatus:
          replacementCompletedPrivatePostReloadProof.status,
        replacementCompletedPrivatePostReloadProof,
        passed:
          replacementCompletedPrivatePostReloadMatches(
            hardening.replacementStalePrivatePostAfterComplete,
            hardening.replacementStalePrivatePostAfterComplete
              ?.privateReloadAfterReject,
            replacementCompletedPrivatePostScenario,
          ) &&
          replacementCompletedPrivatePostReloadProof.status === "passed",
      },
    ),
    lane("stale-dead-target-vote", "Stale dead-target vote rejects and refreshes targets", {
      targetSlot: hardening.staleDeadTargetVote?.staleTarget?.slotId ?? null,
      rejectError: hardening.staleDeadTargetVote?.reject?.error ?? null,
      apiTargetAliveAfterDead:
        hardening.staleDeadTargetVote?.apiSlotAfterDead?.alive ?? null,
      refreshedTargets:
        hardening.staleDeadTargetVote?.commandStateAfterReject?.voteTargets ?? null,
      restoreAlive:
        hardening.staleDeadTargetVote?.apiSlotAfterRestore?.alive ?? null,
      passed:
        hardening.staleDeadTargetVote?.status === "passed" &&
        hardening.staleDeadTargetVote?.staleTarget?.kind === "slot" &&
        hardening.staleDeadTargetVote?.commandStateBeforeClose?.voteTargets?.some(
          (target) =>
            target.kind === "slot" &&
            target.slotId === hardening.staleDeadTargetVote?.staleTarget?.slotId,
        ) === true &&
        hardening.staleDeadTargetVote?.staleVoteButton?.disabled === false &&
        hardening.staleDeadTargetVote?.currentVoteBeforeClose?.hasVote ===
          "false" &&
        hardening.staleDeadTargetVote?.closedStatus?.state === "closed" &&
        hardening.staleDeadTargetVote?.markDead?.state === "ack" &&
        hardening.staleDeadTargetVote?.apiSlotAfterDead?.alive === false &&
        hardening.staleDeadTargetVote?.apiSlotAfterDead?.status === "dead" &&
        hardening.staleDeadTargetVote?.reject?.state === "reject" &&
        hardening.staleDeadTargetVote?.reject?.error === "InvalidTarget" &&
        hardening.staleDeadTargetVote?.reject?.serverEnvelope?.body?.kind ===
          "Reject" &&
        Array.isArray(hardening.staleDeadTargetVote?.reject?.streamSeqs) ===
          false &&
        hardening.staleDeadTargetVote?.reject?.message?.includes(
          "vote target is no longer valid",
        ) === true &&
        hardening.staleDeadTargetVote?.dispatchPlan?.projectionRefreshKeys?.includes(
          "commandState",
        ) === true &&
        hardening.staleDeadTargetVote?.commandStateAfterReject?.currentVote ===
          null &&
        hardening.staleDeadTargetVote?.commandStateAfterReject?.voteTargets?.some(
          (target) =>
            target.kind === "slot" &&
            target.slotId === hardening.staleDeadTargetVote?.staleTarget?.slotId,
        ) === false &&
        hardening.staleDeadTargetVote?.commandStateAfterReject?.voteTargets?.some(
          (target) => target.kind === "slot",
        ) === true &&
        hardening.staleDeadTargetVote?.buttonsAfterReject?.some((button) =>
          button.text?.includes(hardening.staleDeadTargetVote?.staleTarget?.label),
        ) === false &&
        hardening.staleDeadTargetVote?.currentVoteAfterReject?.hasVote ===
          "false" &&
        hardening.staleDeadTargetVote?.apiCommandStateAfterReject?.vote_targets?.some(
          (target) =>
            target.kind === "slot" &&
            target.slot_id === hardening.staleDeadTargetVote?.staleTarget?.slotId,
        ) === false &&
        hardening.staleDeadTargetVote?.restoreAlive?.state === "ack" &&
        hardening.staleDeadTargetVote?.apiSlotAfterRestore?.alive === true &&
        hardening.staleDeadTargetVote?.apiSlotAfterRestore?.status === "alive",
    }),
    lane("dead-current-vote", "Lifecycle death clears current vote and votecount", {
      targetSlot: hardening.deadCurrentVote?.target?.slotId ?? null,
      voteState: hardening.deadCurrentVote?.vote?.state ?? null,
      currentVoteAfterVote:
        hardening.deadCurrentVote?.commandStateAfterVote?.currentVote ?? null,
      currentVoteAfterDead:
        hardening.deadCurrentVote?.commandStateAfterDead?.currentVote ?? null,
      playerVotecountAfterDead:
        hardening.deadCurrentVote?.playerVotecountAfterDead ?? null,
      stalePublishState:
        hardening.deadCurrentVote?.staleHostPublishAfterClear?.publish?.state ?? null,
      stalePublishExpectedBody:
        hardening.deadCurrentVote?.staleHostPublishAfterClear?.expectedBody ?? null,
      stalePublishStalePostCount:
        hardening.deadCurrentVote?.staleHostPublishAfterClear?.apiStalePostCount ?? null,
      restoreAlive:
        hardening.deadCurrentVote?.apiSlotAfterRestore?.alive ?? null,
      passed:
        hardening.deadCurrentVote?.status === "passed" &&
        hardening.deadCurrentVote?.target?.kind === "slot" &&
        hardening.deadCurrentVote?.commandStateBeforeVote?.voteTargets?.some(
          (target) =>
            target.kind === "slot" &&
            target.slotId === hardening.deadCurrentVote?.target?.slotId,
        ) === true &&
        hardening.deadCurrentVote?.voteButton?.disabled === false &&
        hardening.deadCurrentVote?.vote?.state === "ack" &&
        hardening.deadCurrentVote?.vote?.requestEnvelope?.body?.body?.command?.SubmitVote
          ?.target?.Slot === hardening.deadCurrentVote?.target?.slotId &&
        hardening.deadCurrentVote?.commandStateAfterVote?.currentVote?.kind === "slot" &&
        hardening.deadCurrentVote?.commandStateAfterVote?.currentVote?.slotId ===
          hardening.deadCurrentVote?.target?.slotId &&
        hardening.deadCurrentVote?.currentVoteAfterVote?.hasVote === "true" &&
        hardening.deadCurrentVote?.playerVotecountAfterVote?.some(
          (row) => row.target === hardening.deadCurrentVote?.target?.slotId,
        ) === true &&
        normalizedVotecountRows(hardening.deadCurrentVote?.apiVotecountAfterVote).some(
          (row) => row.target === hardening.deadCurrentVote?.target?.slotId,
        ) === true &&
        hardening.deadCurrentVote?.markDead?.state === "ack" &&
        hardening.deadCurrentVote?.apiSlotAfterDead?.alive === false &&
        hardening.deadCurrentVote?.apiSlotAfterDead?.status === "dead" &&
        hardening.deadCurrentVote?.commandStateAfterDead?.currentVote === null &&
        hardening.deadCurrentVote?.commandStateAfterDead?.voteTargets?.some(
          (target) =>
            target.kind === "slot" &&
            target.slotId === hardening.deadCurrentVote?.target?.slotId,
        ) === false &&
        hardening.deadCurrentVote?.currentVoteAfterDead?.hasVote === "false" &&
        hardening.deadCurrentVote?.currentVoteAfterDead?.text?.includes(
          "No current vote",
        ) === true &&
        hardening.deadCurrentVote?.playerVotecountAfterDead?.some(
          (row) => row.target === hardening.deadCurrentVote?.target?.slotId,
        ) === false &&
        hardening.deadCurrentVote?.hostVotecountAfterDead?.some(
          (row) => row.target === hardening.deadCurrentVote?.target?.slotId,
        ) === false &&
        hardening.deadCurrentVote?.apiCommandStateAfterDead?.current_vote === null &&
        hardening.deadCurrentVote?.apiCommandStateAfterDead?.vote_targets?.some(
          (target) =>
            target.kind === "slot" &&
            target.slot_id === hardening.deadCurrentVote?.target?.slotId,
        ) === false &&
        normalizedVotecountRows(hardening.deadCurrentVote?.apiVotecountAfterDead).some(
          (row) => row.target === hardening.deadCurrentVote?.target?.slotId,
        ) === false &&
        hardening.deadCurrentVote?.staleHostPublishAfterClear?.status ===
          "passed" &&
        hardening.deadCurrentVote?.staleHostPublishAfterClear?.setup?.stalePhase
          ?.id === "D02" &&
        hardening.deadCurrentVote?.staleHostPublishAfterClear?.setup?.stalePhase
          ?.locked === false &&
        hardening.deadCurrentVote?.staleHostPublishAfterClear?.setup?.votecountRows?.some(
          (row) =>
            row.target === hardening.deadCurrentVote?.target?.slotId &&
            Number(row.count) >= 1,
        ) === true &&
        hardening.deadCurrentVote?.staleHostPublishAfterClear?.setup?.staleBody?.includes(
          `- ${hardening.deadCurrentVote?.target?.slotId}:`,
        ) === true &&
        hardening.deadCurrentVote?.staleHostPublishAfterClear?.publish?.state ===
          "ack" &&
        hardening.deadCurrentVote?.staleHostPublishAfterClear?.publish?.requestEnvelope
          ?.body?.body?.command?.PublishVotecount?.game === session?.game &&
        hardening.deadCurrentVote?.staleHostPublishAfterClear?.expectedBody ===
          "Official votecount for D02\n\nNo active ballots." &&
        hardening.deadCurrentVote?.staleHostPublishAfterClear?.apiExpectedPostCount ===
          1 &&
        hardening.deadCurrentVote?.staleHostPublishAfterClear?.apiStalePostCount ===
          0 &&
        hardening.deadCurrentVote?.staleHostPublishAfterClear?.playerExpectedPostCount ===
          1 &&
        hardening.deadCurrentVote?.staleHostPublishAfterClear?.playerStalePostCount ===
          0 &&
        hardening.deadCurrentVote?.staleHostPublishAfterClear?.activityRow?.source ===
          "outcome" &&
        hardening.deadCurrentVote?.staleHostPublishAfterClear?.activityRow?.actionId ===
          "publish_votecount" &&
        hardening.deadCurrentVote?.restoreAlive?.state === "ack" &&
        hardening.deadCurrentVote?.apiSlotAfterRestore?.alive === true &&
        hardening.deadCurrentVote?.apiSlotAfterRestore?.status === "alive" &&
        hardening.deadCurrentVote?.commandStateAfterRestore?.currentVote === null &&
        hardening.deadCurrentVote?.commandStateAfterRestore?.voteTargets?.some(
          (target) =>
            target.kind === "slot" &&
            target.slotId === hardening.deadCurrentVote?.target?.slotId,
        ) === true,
    }),
    lane("concurrent-vote-race", "Concurrent player votes converge in projections", {
      targetSlot: hardening.concurrentVoteRace?.targetSlot ?? null,
      playerState: hardening.concurrentVoteRace?.playerVote?.state ?? null,
      actionState: hardening.concurrentVoteRace?.actionVote?.state ?? null,
      distinctStreamSeqs: !sameArray(
        hardening.concurrentVoteRace?.playerVote?.streamSeqs,
        hardening.concurrentVoteRace?.actionVote?.streamSeqs,
      ),
      apiCount: hardening.concurrentVoteRace?.apiProjection?.count ?? null,
      passed:
        hardening.concurrentVoteRace?.status === "passed" &&
        typeof hardening.concurrentVoteRace?.targetSlot === "string" &&
        hardening.concurrentVoteRace?.targetSlot.length > 0 &&
        hardening.concurrentVoteRace?.playerCommandStateBeforeVote?.voteTargets?.some(
          (target) =>
            target.kind === "slot" &&
            target.slotId === hardening.concurrentVoteRace?.targetSlot,
        ) === true &&
        hardening.concurrentVoteRace?.actionCommandStateBeforeVote?.voteTargets?.some(
          (target) =>
            target.kind === "slot" &&
            target.slotId === hardening.concurrentVoteRace?.targetSlot,
        ) === true &&
        hardening.concurrentVoteRace?.playerVote?.state === "ack" &&
        hardening.concurrentVoteRace?.actionVote?.state === "ack" &&
        !sameArray(
          hardening.concurrentVoteRace?.playerVote?.streamSeqs,
          hardening.concurrentVoteRace?.actionVote?.streamSeqs,
        ) &&
        hardening.concurrentVoteRace?.apiProjection?.count === 2,
    }),
    lane("concurrent-vote-race-reload", "Concurrent vote race reloads role URL projections", {
      targetSlot: hardening.concurrentVoteRace?.targetSlot ?? null,
      playerRouteStatus:
        hardening.concurrentVoteRace?.roleReloadAfterRace?.playerRouteStatus ?? null,
      actionRouteStatus:
        hardening.concurrentVoteRace?.roleReloadAfterRace?.actionRouteStatus ?? null,
      playerCurrentVote:
        hardening.concurrentVoteRace?.roleReloadAfterRace?.playerCommandState
          ?.currentVote ?? null,
      actionCurrentVote:
        hardening.concurrentVoteRace?.roleReloadAfterRace?.actionCommandState
          ?.currentVote ?? null,
      apiCount:
        hardening.concurrentVoteRace?.roleReloadAfterRace?.apiProjection?.count ?? null,
      passed:
        hardening.concurrentVoteRace?.status === "passed" &&
        hardening.concurrentVoteRace?.roleReloadAfterRace?.status === "passed" &&
        hardening.concurrentVoteRace?.roleReloadAfterRace?.playerRouteStatus ===
          200 &&
        hardening.concurrentVoteRace?.roleReloadAfterRace?.actionRouteStatus ===
          200 &&
        hardening.concurrentVoteRace?.roleReloadAfterRace?.playerCommandState
          ?.currentVote?.kind === "slot" &&
        hardening.concurrentVoteRace?.roleReloadAfterRace?.playerCommandState
          ?.currentVote?.slotId === hardening.concurrentVoteRace?.targetSlot &&
        hardening.concurrentVoteRace?.roleReloadAfterRace?.actionCommandState
          ?.currentVote?.kind === "slot" &&
        hardening.concurrentVoteRace?.roleReloadAfterRace?.actionCommandState
          ?.currentVote?.slotId === hardening.concurrentVoteRace?.targetSlot &&
        hardening.concurrentVoteRace?.roleReloadAfterRace?.playerCurrentVote
          ?.hasVote === "true" &&
        hardening.concurrentVoteRace?.roleReloadAfterRace?.actionCurrentVote
          ?.hasVote === "true" &&
        hardening.concurrentVoteRace?.roleReloadAfterRace?.playerProjection?.some(
          (row) =>
            row.target === hardening.concurrentVoteRace?.targetSlot &&
            row.count === 2,
        ) === true &&
        hardening.concurrentVoteRace?.roleReloadAfterRace?.actionProjection?.some(
          (row) =>
            row.target === hardening.concurrentVoteRace?.targetSlot &&
            row.count === 2,
        ) === true &&
        hardening.concurrentVoteRace?.roleReloadAfterRace?.apiProjection?.count ===
          2,
    }),
    lane(
      "stale-host-publish-after-change",
      "Stale host publish uses current changed votecount",
      {
        staleBody: hardening.staleHostPublishAfterChange?.staleBody ?? null,
        expectedBody: hardening.staleHostPublishAfterChange?.expectedBody ?? null,
        publishState:
          hardening.staleHostPublishAfterChange?.publish?.commandStatus?.state ??
          null,
        apiExpectedPostCount:
          hardening.staleHostPublishAfterChange?.apiExpectedPostCount ?? null,
        apiStalePostCount:
          hardening.staleHostPublishAfterChange?.apiStalePostCount ?? null,
        restoredCount: normalizedVotecountRows(
          hardening.staleHostPublishAfterChange?.apiVotecountAfterRestore,
        ).find(
          (row) =>
            row.target === hardening.concurrentVoteRace?.targetSlot &&
            row.phaseId === "D02",
        )?.count ?? null,
        passed:
          hardening.staleHostPublishAfterChange?.status === "passed" &&
          hardening.staleHostPublishAfterChange?.setup?.stalePhase?.id ===
            "D02" &&
          hardening.staleHostPublishAfterChange?.setup?.stalePhase?.locked ===
            false &&
          hardening.staleHostPublishAfterChange?.setup?.votecountRows?.some(
            (row) =>
              row.target === hardening.concurrentVoteRace?.targetSlot &&
              Number(row.count) === hardening.concurrentVoteRace?.apiProjection?.count,
          ) === true &&
          hardening.staleHostPublishAfterChange?.staleBody ===
            `Official votecount for D02\n- ${hardening.concurrentVoteRace?.targetSlot}: ${hardening.concurrentVoteRace?.apiProjection?.count}` &&
          hardening.staleHostPublishAfterChange?.changeVote?.state === "ack" &&
          hardening.staleHostPublishAfterChange?.currentRows?.some(
            (row) =>
              row.target === hardening.concurrentVoteRace?.targetSlot &&
              row.count === 1,
          ) === true &&
          hardening.staleHostPublishAfterChange?.currentRows?.some(
            (row) => row.target === "no_lynch" && row.count === 1,
          ) === true &&
          hardening.staleHostPublishAfterChange?.expectedBody !==
            hardening.staleHostPublishAfterChange?.staleBody &&
          hardening.staleHostPublishAfterChange?.publish?.commandStatus?.state ===
            "ack" &&
          hardening.staleHostPublishAfterChange?.publish?.commandStatus?.requestEnvelope
            ?.body?.body?.command?.PublishVotecount?.game === session?.game &&
          hardening.staleHostPublishAfterChange?.apiExpectedPostCount === 1 &&
          hardening.staleHostPublishAfterChange?.apiStalePostCount === 0 &&
          hardening.staleHostPublishAfterChange?.playerExpectedPostCount ===
            1 &&
          hardening.staleHostPublishAfterChange?.playerStalePostCount === 0 &&
          hardening.staleHostPublishAfterChange?.activityRow?.source ===
            "outcome" &&
          hardening.staleHostPublishAfterChange?.activityRow?.actionId ===
            "publish_votecount" &&
          hardening.staleHostPublishAfterChange?.restoreVote?.state === "ack" &&
          normalizedVotecountRows(
            hardening.staleHostPublishAfterChange?.apiVotecountAfterRestore,
          ).some(
            (row) =>
              row.target === hardening.concurrentVoteRace?.targetSlot &&
              row.phaseId === "D02" &&
              row.count === hardening.concurrentVoteRace?.apiProjection?.count,
          ) === true,
      },
    ),
    lane("host-votecount-publication", "Host publishes projection-derived votecount", {
      publishState: hardening.hostVotecountPublication?.publish?.commandStatus?.state ?? null,
      commandGame:
        hardening.hostVotecountPublication?.publish?.commandStatus?.requestEnvelope?.body
          ?.body?.command?.PublishVotecount?.game ?? null,
      expectedBody: hardening.hostVotecountPublication?.expectedBody ?? null,
      activityStatusText:
        hardening.hostVotecountPublication?.activityStatusText ?? null,
      playerPostAuthor:
        hardening.hostVotecountPublication?.playerThreadPost?.authorLabel ?? null,
      apiPostAuthor:
        hardening.hostVotecountPublication?.apiThreadPost?.author_user ?? null,
      passed:
        hardening.hostVotecountPublication?.status === "passed" &&
        hardening.hostVotecountPublication?.publish?.commandStatus?.state === "ack" &&
        hardening.hostVotecountPublication?.publish?.commandStatus?.requestEnvelope?.body
          ?.body?.command?.PublishVotecount?.game === session?.game &&
        hardening.hostVotecountPublication?.playerThreadPost?.body ===
          hardening.hostVotecountPublication?.expectedBody &&
        hardening.hostVotecountPublication?.playerThreadPost?.authorLabel === "host" &&
        hardening.hostVotecountPublication?.apiThreadPost?.body ===
          hardening.hostVotecountPublication?.expectedBody &&
        hardening.hostVotecountPublication?.apiThreadPost?.author_user === "host" &&
        hardening.hostVotecountPublication?.expectedBody ===
          `Official votecount for D02\n- ${hardening.concurrentVoteRace?.targetSlot}: ${hardening.concurrentVoteRace?.apiProjection?.count}` &&
        hardening.hostVotecountPublication?.activityStatusText?.includes(
          "Ack: stream seqs",
        ) === true,
    }),
    lane("concurrent-host-publish-race", "Concurrent host publishes converge", {
      game: hardening.concurrentHostPublishRace?.game ?? null,
      targetSlot: hardening.concurrentHostPublishRace?.targetSlot ?? null,
      targetCount: hardening.concurrentHostPublishRace?.targetCount ?? null,
      ackRaceRole: hardening.concurrentHostPublishRace?.ackRaceRole ?? null,
      rejectRaceRole: hardening.concurrentHostPublishRace?.rejectRaceRole ?? null,
      ackState: hardening.concurrentHostPublishRace?.ack?.state ?? null,
      rejectError: hardening.concurrentHostPublishRace?.reject?.error ?? null,
      apiOfficialPostCount:
        hardening.concurrentHostPublishRace?.apiOfficialPostCount ?? null,
      playerOfficialPostCount:
        hardening.concurrentHostPublishRace?.playerOfficialPostCount ?? null,
      passed:
        hardening.concurrentHostPublishRace?.status === "passed" &&
        typeof hardening.concurrentHostPublishRace?.game === "string" &&
        hardening.concurrentHostPublishRace?.targetSlot === "slot_5" &&
        hardening.concurrentHostPublishRace?.targetCount === 3 &&
        hardening.concurrentHostPublishRace?.expectedBody ===
          "Official votecount for D01\n- slot_5: 3" &&
        hardening.concurrentHostPublishRace?.ack?.state === "ack" &&
        hardening.concurrentHostPublishRace?.ack?.serverEnvelope?.body?.kind ===
          "Ack" &&
        Array.isArray(hardening.concurrentHostPublishRace?.ack?.streamSeqs) &&
        hardening.concurrentHostPublishRace?.reject?.state === "reject" &&
        hardening.concurrentHostPublishRace?.reject?.error === "InvalidTarget" &&
        hardening.concurrentHostPublishRace?.reject?.serverEnvelope?.body?.kind ===
          "Reject" &&
        Array.isArray(hardening.concurrentHostPublishRace?.reject?.streamSeqs) ===
          false &&
        hardening.concurrentHostPublishRace?.reject?.message?.includes(
          "official votecount is already published",
        ) === true &&
        hardening.concurrentHostPublishRace?.ackRaceRole !==
          hardening.concurrentHostPublishRace?.rejectRaceRole &&
        hardening.concurrentHostPublishRace?.commandGames?.length === 2 &&
        hardening.concurrentHostPublishRace?.commandGames?.every(
          (commandGame) => commandGame === hardening.concurrentHostPublishRace?.game,
        ) === true &&
        hardening.concurrentHostPublishRace?.apiOfficialPostCount === 1 &&
        hardening.concurrentHostPublishRace?.playerOfficialPostCount === 1,
    }),
    lane(
      "concurrent-host-publish-race-reload",
      "Concurrent host publish race reloads official count truth",
      {
        firstHostRouteStatus:
          hardening.concurrentHostPublishRace?.roleReloadAfterRace
            ?.firstHostRouteStatus ?? null,
        secondHostRouteStatus:
          hardening.concurrentHostPublishRace?.roleReloadAfterRace
            ?.secondHostRouteStatus ?? null,
        playerRouteStatus:
          hardening.concurrentHostPublishRace?.roleReloadAfterRace?.playerRouteStatus ??
          null,
        apiOfficialPostCount:
          hardening.concurrentHostPublishRace?.roleReloadAfterRace
            ?.apiOfficialPostCount ?? null,
        playerOfficialPostCount:
          hardening.concurrentHostPublishRace?.roleReloadAfterRace
            ?.playerOfficialPostCount ?? null,
        passed:
          hardening.concurrentHostPublishRace?.status === "passed" &&
          hardening.concurrentHostPublishRace?.roleReloadAfterRace?.status ===
            "passed" &&
          hardening.concurrentHostPublishRace?.roleReloadAfterRace
            ?.firstHostRouteStatus === 200 &&
          hardening.concurrentHostPublishRace?.roleReloadAfterRace
            ?.secondHostRouteStatus === 200 &&
          hardening.concurrentHostPublishRace?.roleReloadAfterRace
            ?.playerRouteStatus === 200 &&
          hardening.concurrentHostPublishRace?.roleReloadAfterRace
            ?.firstHostProjection?.some(
              (row) => row.target === "slot_5" && row.count === 3,
            ) === true &&
          hardening.concurrentHostPublishRace?.roleReloadAfterRace
            ?.secondHostProjection?.some(
              (row) => row.target === "slot_5" && row.count === 3,
            ) === true &&
          hardening.concurrentHostPublishRace?.roleReloadAfterRace
            ?.playerProjection?.some(
              (row) => row.target === "slot_5" && row.count === 3,
            ) === true &&
          hardening.concurrentHostPublishRace?.roleReloadAfterRace
            ?.apiProjection?.phaseId === "D01" &&
          hardening.concurrentHostPublishRace?.roleReloadAfterRace
            ?.apiProjection?.target === "slot_5" &&
          hardening.concurrentHostPublishRace?.roleReloadAfterRace
            ?.apiProjection?.count === 3 &&
          hardening.concurrentHostPublishRace?.roleReloadAfterRace
            ?.apiOfficialPostCount === 1 &&
          hardening.concurrentHostPublishRace?.roleReloadAfterRace
            ?.playerOfficialPostCount === 1,
      },
    ),
    lane("stale-host-publish", "Stale host publish rejects duplicate official count", {
      rejectError: hardening.staleHostPublish?.reject?.error ?? null,
      stalePhase: hardening.staleHostPublish?.setup?.stalePhase?.id ?? null,
      staleLocked: hardening.staleHostPublish?.setup?.stalePhase?.locked ?? null,
      apiOfficialPostCount: hardening.staleHostPublish?.apiOfficialPostCount ?? null,
      playerOfficialPostCount:
        hardening.staleHostPublish?.playerOfficialPostCount ?? null,
      passed:
        hardening.staleHostPublish?.status === "passed" &&
        hardening.staleHostPublish?.setup?.stalePhase?.id === "D02" &&
        hardening.staleHostPublish?.setup?.stalePhase?.locked === false &&
        hardening.staleHostPublish?.setup?.votecountActions?.includes(
          "publish_votecount",
        ) === true &&
        hardening.staleHostPublish?.reject?.state === "reject" &&
        hardening.staleHostPublish?.reject?.error === "InvalidTarget" &&
        hardening.staleHostPublish?.reject?.serverEnvelope?.body?.kind ===
          "Reject" &&
        Array.isArray(hardening.staleHostPublish?.reject?.streamSeqs) === false &&
        hardening.staleHostPublish?.reject?.message?.includes(
          "official votecount is already published",
        ) === true &&
        hardening.staleHostPublish?.votecountActionsAfterReject?.includes(
          "publish_votecount",
        ) === true &&
        hardening.staleHostPublish?.activityRow?.source === "outcome" &&
        hardening.staleHostPublish?.activityRow?.actionId === "publish_votecount" &&
        Array.isArray(
          hardening.staleHostPublish?.dispatchPlan?.projectionRefreshKeys,
        ) &&
        hardening.staleHostPublish.dispatchPlan.projectionRefreshKeys.length === 0 &&
        hardening.staleHostPublish?.apiOfficialPostCount === 1 &&
        hardening.staleHostPublish?.playerOfficialPostCount === 1,
    }),
    lane("host-lifecycle-control", "Host slot lifecycle control disables player commands", {
      targetSlot: hardening.hostLifecycleControl?.targetSlot ?? null,
      markDeadState:
        hardening.hostLifecycleControl?.markDead?.commandStatus?.state ?? null,
      commandStatus:
        hardening.hostLifecycleControl?.markDead?.commandStatus?.requestEnvelope?.body
          ?.body?.command?.SetSlotStatus?.status ?? null,
      apiDeadStatus: hardening.hostLifecycleControl?.apiSlotAfterDead?.status ?? null,
      actorStatusAfterDead:
        hardening.hostLifecycleControl?.playerCommandStateAfterDead?.actorStatus ?? null,
      directPostError: hardening.hostLifecycleControl?.directPost?.error ?? null,
      restoreState: hardening.hostLifecycleControl?.restoreAlive?.state ?? null,
      apiRestoredStatus:
        hardening.hostLifecycleControl?.apiSlotAfterRestore?.status ?? null,
      actorStatusAfterRestore:
        hardening.hostLifecycleControl?.playerCommandStateAfterRestore?.actorStatus ??
        null,
      passed:
        hardening.hostLifecycleControl?.status === "passed" &&
        hardening.hostLifecycleControl?.targetSlot === "slot-7" &&
        hardening.hostLifecycleControl?.markDead?.commandStatus?.state === "ack" &&
        hardening.hostLifecycleControl?.markDead?.commandStatus?.requestEnvelope?.body
          ?.body?.command?.SetSlotStatus?.game === session?.game &&
        hardening.hostLifecycleControl?.markDead?.commandStatus?.requestEnvelope?.body
          ?.body?.command?.SetSlotStatus?.slot === "slot-7" &&
        hardening.hostLifecycleControl?.markDead?.commandStatus?.requestEnvelope?.body
          ?.body?.command?.SetSlotStatus?.status === "dead" &&
        hardening.hostLifecycleControl?.hostReplacementAfterDead?.lifecycleLabel ===
          "Dead" &&
        hardening.hostLifecycleControl?.apiSlotAfterDead?.alive === false &&
        hardening.hostLifecycleControl?.apiSlotAfterDead?.status === "dead" &&
        hardening.hostLifecycleControl?.playerCommandStateAfterDead?.actorAlive ===
          false &&
        hardening.hostLifecycleControl?.playerCommandStateAfterDead?.actorStatus ===
          "dead" &&
        hardening.hostLifecycleControl?.playerCommandStateAfterDead?.actions?.length ===
          0 &&
        hardening.hostLifecycleControl?.disabledControls?.vote?.disabled === true &&
        hardening.hostLifecycleControl?.disabledControls?.withdraw?.disabled ===
          true &&
        hardening.hostLifecycleControl?.disabledControls?.post?.disabled === true &&
        hardening.hostLifecycleControl?.actionControlCount === 0 &&
        hardening.hostLifecycleControl?.directPost?.state === "reject" &&
        hardening.hostLifecycleControl?.directPost?.error === "SlotNotAlive" &&
        hardening.hostLifecycleControl?.restoreAlive?.state === "ack" &&
        hardening.hostLifecycleControl?.apiSlotAfterRestore?.alive === true &&
        hardening.hostLifecycleControl?.apiSlotAfterRestore?.status === "alive" &&
        hardening.hostLifecycleControl?.playerCommandStateAfterRestore?.actorAlive ===
          true &&
        hardening.hostLifecycleControl?.playerCommandStateAfterRestore?.actorStatus ===
          "alive",
    }),
    lane("stale-host-lifecycle", "Stale host lifecycle rejects current status", {
      rejectError: hardening.staleHostLifecycle?.reject?.error ?? null,
      staleLifecycle:
        hardening.staleHostLifecycle?.setup?.replacement?.lifecycleLabel ?? null,
      apiStatus: hardening.staleHostLifecycle?.apiSlotAfterReject?.status ?? null,
      actorStatus:
        hardening.staleHostLifecycle?.playerCommandStateAfterReject?.actorStatus ??
        null,
      passed:
        hardening.staleHostLifecycle?.status === "passed" &&
        hardening.staleHostLifecycle?.actionId === "mark_dead" &&
        hardening.staleHostLifecycle?.lifecycleStatus === "dead" &&
        hardening.staleHostLifecycle?.setup?.replacement?.lifecycleLabel ===
          "Alive" &&
        hardening.staleHostLifecycle?.setup?.lifecycleActions?.includes(
          "mark_dead",
        ) === true &&
        hardening.staleHostLifecycle?.reject?.state === "reject" &&
        hardening.staleHostLifecycle?.reject?.error === "InvalidTarget" &&
        hardening.staleHostLifecycle?.reject?.serverEnvelope?.body?.kind ===
          "Reject" &&
        Array.isArray(hardening.staleHostLifecycle?.reject?.streamSeqs) ===
          false &&
        hardening.staleHostLifecycle?.reject?.message?.includes(
          "slot lifecycle changed or is already current",
        ) === true &&
        hardening.staleHostLifecycle?.replacementAfterReject?.lifecycleLabel ===
          "Alive" &&
        hardening.staleHostLifecycle?.lifecycleActionsAfterReject?.includes(
          "mark_dead",
        ) === true &&
        hardening.staleHostLifecycle?.activityRow?.source === "outcome" &&
        hardening.staleHostLifecycle?.activityRow?.actionId === "mark_dead" &&
        Array.isArray(
          hardening.staleHostLifecycle?.dispatchPlan?.projectionRefreshKeys,
        ) &&
        hardening.staleHostLifecycle.dispatchPlan.projectionRefreshKeys.length === 0 &&
        hardening.staleHostLifecycle?.apiSlotAfterReject?.alive === false &&
        hardening.staleHostLifecycle?.apiSlotAfterReject?.status === "dead" &&
        hardening.staleHostLifecycle?.playerCommandStateAfterReject?.actorAlive ===
          false &&
        hardening.staleHostLifecycle?.playerCommandStateAfterReject?.actorStatus ===
          "dead",
    }),
    lane(
      "stale-host-lifecycle-reload",
      "Stale host lifecycle reloads terminal slot controls",
      {
        routeStatus:
          hardening.staleHostLifecycle?.staleHostSlotLifecycleReloadAfterReject
            ?.routeResponseStatus ?? null,
        lifecycle:
          hardening.staleHostLifecycle?.staleHostSlotLifecycleReloadAfterReject
            ?.replacementAfterReload?.lifecycleLabel ?? null,
        apiStatus:
          hardening.staleHostLifecycle?.staleHostSlotLifecycleReloadAfterReject
            ?.apiSlotAfterReload?.status ?? null,
        passed:
          hardening.staleHostLifecycle?.status === "passed" &&
          hardening.staleHostLifecycle?.staleHostSlotLifecycleReloadAfterReject
            ?.status === "passed" &&
          hardening.staleHostLifecycle.staleHostSlotLifecycleReloadAfterReject
            .routeResponseStatus === 200 &&
          hardening.staleHostLifecycle.staleHostSlotLifecycleReloadAfterReject
            .rejectReceiptStatusText?.includes("Reject InvalidTarget") === true &&
          hardening.staleHostLifecycle.staleHostSlotLifecycleReloadAfterReject
            .phaseAfterReload?.id === "D02" &&
          hardening.staleHostLifecycle.staleHostSlotLifecycleReloadAfterReject
            .phaseAfterReload?.locked === false &&
          hardening.staleHostLifecycle.staleHostSlotLifecycleReloadAfterReject
            .replacementAfterReload?.lifecycleLabel === "Dead" &&
          hardening.staleHostLifecycle.staleHostSlotLifecycleReloadAfterReject
            .lifecycleActionsAfterReload?.includes("mark_dead") === false &&
          hardening.staleHostLifecycle.staleHostSlotLifecycleReloadAfterReject
            .lifecycleActionsAfterReload?.includes("modkill_slot") === false &&
          hardening.staleHostLifecycle.staleHostSlotLifecycleReloadAfterReject
            .apiSlotAfterReload?.alive === false &&
          hardening.staleHostLifecycle.staleHostSlotLifecycleReloadAfterReject
            .apiSlotAfterReload?.status === "dead",
      },
    ),
    lane("host-modkill-control", "Host modkill control disables player commands", {
      targetSlot: hardening.hostModkillControl?.targetSlot ?? null,
      modkillState:
        hardening.hostModkillControl?.modkill?.commandStatus?.state ?? null,
      commandStatus:
        hardening.hostModkillControl?.modkill?.commandStatus?.requestEnvelope?.body
          ?.body?.command?.SetSlotStatus?.status ?? null,
      apiModkillStatus:
        hardening.hostModkillControl?.apiSlotAfterModkill?.status ?? null,
      actorStatusAfterModkill:
        hardening.hostModkillControl?.playerCommandStateAfterModkill?.actorStatus ??
        null,
      directPostError: hardening.hostModkillControl?.directPost?.error ?? null,
      restoreState: hardening.hostModkillControl?.restoreAlive?.state ?? null,
      apiRestoredStatus:
        hardening.hostModkillControl?.apiSlotAfterRestore?.status ?? null,
      actorStatusAfterRestore:
        hardening.hostModkillControl?.playerCommandStateAfterRestore?.actorStatus ??
        null,
      passed:
        hardening.hostModkillControl?.status === "passed" &&
        hardening.hostModkillControl?.targetSlot === "slot-7" &&
        hardening.hostModkillControl?.modkill?.commandStatus?.state === "ack" &&
        hardening.hostModkillControl?.modkill?.commandStatus?.requestEnvelope?.body
          ?.body?.command?.SetSlotStatus?.game === session?.game &&
        hardening.hostModkillControl?.modkill?.commandStatus?.requestEnvelope?.body
          ?.body?.command?.SetSlotStatus?.slot === "slot-7" &&
        hardening.hostModkillControl?.modkill?.commandStatus?.requestEnvelope?.body
          ?.body?.command?.SetSlotStatus?.status === "modkilled" &&
        hardening.hostModkillControl?.hostReplacementAfterModkill?.lifecycleLabel ===
          "Modkilled" &&
        hardening.hostModkillControl?.apiSlotAfterModkill?.alive === false &&
        hardening.hostModkillControl?.apiSlotAfterModkill?.status === "modkilled" &&
        hardening.hostModkillControl?.playerCommandStateAfterModkill?.actorAlive ===
          false &&
        hardening.hostModkillControl?.playerCommandStateAfterModkill?.actorStatus ===
          "modkilled" &&
        hardening.hostModkillControl?.playerCommandStateAfterModkill?.actions
          ?.length === 0 &&
        hardening.hostModkillControl?.disabledControls?.vote?.disabled === true &&
        hardening.hostModkillControl?.disabledControls?.withdraw?.disabled ===
          true &&
        hardening.hostModkillControl?.disabledControls?.post?.disabled === true &&
        hardening.hostModkillControl?.actionControlCount === 0 &&
        hardening.hostModkillControl?.directPost?.state === "reject" &&
        hardening.hostModkillControl?.directPost?.error === "SlotNotAlive" &&
        hardening.hostModkillControl?.restoreAlive?.state === "ack" &&
        hardening.hostModkillControl?.apiSlotAfterRestore?.alive === true &&
        hardening.hostModkillControl?.apiSlotAfterRestore?.status === "alive" &&
        hardening.hostModkillControl?.playerCommandStateAfterRestore?.actorAlive ===
          true &&
        hardening.hostModkillControl?.playerCommandStateAfterRestore?.actorStatus ===
          "alive",
    }),
    lane("stale-host-modkill", "Stale host modkill rejects current status", {
      rejectError: hardening.staleHostModkill?.reject?.error ?? null,
      staleLifecycle:
        hardening.staleHostModkill?.setup?.replacement?.lifecycleLabel ?? null,
      apiStatus: hardening.staleHostModkill?.apiSlotAfterReject?.status ?? null,
      actorStatus:
        hardening.staleHostModkill?.playerCommandStateAfterReject?.actorStatus ??
        null,
      passed:
        hardening.staleHostModkill?.status === "passed" &&
        hardening.staleHostModkill?.actionId === "modkill_slot" &&
        hardening.staleHostModkill?.lifecycleStatus === "modkilled" &&
        hardening.staleHostModkill?.setup?.replacement?.lifecycleLabel ===
          "Alive" &&
        hardening.staleHostModkill?.setup?.lifecycleActions?.includes(
          "modkill_slot",
        ) === true &&
        hardening.staleHostModkill?.reject?.state === "reject" &&
        hardening.staleHostModkill?.reject?.error === "InvalidTarget" &&
        hardening.staleHostModkill?.reject?.serverEnvelope?.body?.kind ===
          "Reject" &&
        Array.isArray(hardening.staleHostModkill?.reject?.streamSeqs) ===
          false &&
        hardening.staleHostModkill?.reject?.message?.includes(
          "slot lifecycle changed or is already current",
        ) === true &&
        hardening.staleHostModkill?.replacementAfterReject?.lifecycleLabel ===
          "Alive" &&
        hardening.staleHostModkill?.lifecycleActionsAfterReject?.includes(
          "modkill_slot",
        ) === true &&
        hardening.staleHostModkill?.activityRow?.source === "outcome" &&
        hardening.staleHostModkill?.activityRow?.actionId === "modkill_slot" &&
        Array.isArray(
          hardening.staleHostModkill?.dispatchPlan?.projectionRefreshKeys,
        ) &&
        hardening.staleHostModkill.dispatchPlan.projectionRefreshKeys.length === 0 &&
        hardening.staleHostModkill?.apiSlotAfterReject?.alive === false &&
        hardening.staleHostModkill?.apiSlotAfterReject?.status === "modkilled" &&
        hardening.staleHostModkill?.playerCommandStateAfterReject?.actorAlive ===
          false &&
        hardening.staleHostModkill?.playerCommandStateAfterReject?.actorStatus ===
          "modkilled",
    }),
    lane(
      "stale-host-modkill-reload",
      "Stale host modkill reloads terminal slot controls",
      {
        routeStatus:
          hardening.staleHostModkill?.staleHostSlotLifecycleReloadAfterReject
            ?.routeResponseStatus ?? null,
        lifecycle:
          hardening.staleHostModkill?.staleHostSlotLifecycleReloadAfterReject
            ?.replacementAfterReload?.lifecycleLabel ?? null,
        apiStatus:
          hardening.staleHostModkill?.staleHostSlotLifecycleReloadAfterReject
            ?.apiSlotAfterReload?.status ?? null,
        passed:
          hardening.staleHostModkill?.status === "passed" &&
          hardening.staleHostModkill?.staleHostSlotLifecycleReloadAfterReject
            ?.status === "passed" &&
          hardening.staleHostModkill.staleHostSlotLifecycleReloadAfterReject
            .routeResponseStatus === 200 &&
          hardening.staleHostModkill.staleHostSlotLifecycleReloadAfterReject
            .rejectReceiptStatusText?.includes("Reject InvalidTarget") === true &&
          hardening.staleHostModkill.staleHostSlotLifecycleReloadAfterReject
            .phaseAfterReload?.id === "D02" &&
          hardening.staleHostModkill.staleHostSlotLifecycleReloadAfterReject
            .phaseAfterReload?.locked === false &&
          hardening.staleHostModkill.staleHostSlotLifecycleReloadAfterReject
            .replacementAfterReload?.lifecycleLabel === "Modkilled" &&
          hardening.staleHostModkill.staleHostSlotLifecycleReloadAfterReject
            .lifecycleActionsAfterReload?.includes("mark_dead") === false &&
          hardening.staleHostModkill.staleHostSlotLifecycleReloadAfterReject
            .lifecycleActionsAfterReload?.includes("modkill_slot") === false &&
          hardening.staleHostModkill.staleHostSlotLifecycleReloadAfterReject
            .apiSlotAfterReload?.alive === false &&
          hardening.staleHostModkill.staleHostSlotLifecycleReloadAfterReject
            .apiSlotAfterReload?.status === "modkilled",
      },
    ),
    lane(
      "concurrent-host-lifecycle-race",
      "Concurrent host lifecycle commands converge",
      {
        ackRaceRole: hardening.concurrentHostLifecycleRace?.ackRaceRole ?? null,
        rejectRaceRole:
          hardening.concurrentHostLifecycleRace?.rejectRaceRole ?? null,
        ackActionId: hardening.concurrentHostLifecycleRace?.ackActionId ?? null,
        rejectActionId:
          hardening.concurrentHostLifecycleRace?.rejectActionId ?? null,
        game: hardening.concurrentHostLifecycleRace?.game ?? null,
        winningStatus: hardening.concurrentHostLifecycleRace?.winningStatus ?? null,
        rejectError: hardening.concurrentHostLifecycleRace?.reject?.error ?? null,
        apiStatus:
          hardening.concurrentHostLifecycleRace?.apiSlotAfterRace?.status ?? null,
        passed:
          hardening.concurrentHostLifecycleRace?.status === "passed" &&
          hardening.concurrentHostLifecycleRace?.setup?.deadPagePhase?.id === "D02" &&
          hardening.concurrentHostLifecycleRace?.setup?.deadPagePhase?.locked ===
            false &&
          hardening.concurrentHostLifecycleRace?.setup?.modkillPagePhase?.id ===
            "D02" &&
          hardening.concurrentHostLifecycleRace?.setup?.modkillPagePhase?.locked ===
            false &&
          hardening.concurrentHostLifecycleRace?.setup?.deadPageReplacement
            ?.lifecycleLabel === "Alive" &&
          hardening.concurrentHostLifecycleRace?.setup?.modkillPageReplacement
            ?.lifecycleLabel === "Alive" &&
          hardening.concurrentHostLifecycleRace?.setup?.deadPageLifecycleActions?.includes(
            "mark_dead",
          ) === true &&
          hardening.concurrentHostLifecycleRace?.setup?.modkillPageLifecycleActions?.includes(
            "modkill_slot",
          ) === true &&
          hardening.concurrentHostLifecycleRace?.setup?.affectedPlayerCommandState
            ?.actorSlot === "slot-7" &&
          hardening.concurrentHostLifecycleRace?.setup?.affectedPlayerCommandState
            ?.actorAlive === true &&
          ["dead", "modkill"].includes(
            hardening.concurrentHostLifecycleRace?.ackRaceRole,
          ) &&
          ["dead", "modkill"].includes(
            hardening.concurrentHostLifecycleRace?.rejectRaceRole,
          ) &&
          hardening.concurrentHostLifecycleRace?.ackRaceRole !==
            hardening.concurrentHostLifecycleRace?.rejectRaceRole &&
          ["mark_dead", "modkill_slot"].includes(
            hardening.concurrentHostLifecycleRace?.ackActionId,
          ) &&
          ["mark_dead", "modkill_slot"].includes(
            hardening.concurrentHostLifecycleRace?.rejectActionId,
          ) &&
          hardening.concurrentHostLifecycleRace?.ackActionId !==
            hardening.concurrentHostLifecycleRace?.rejectActionId &&
          ["dead", "modkilled"].includes(
            hardening.concurrentHostLifecycleRace?.winningStatus,
          ) &&
          hardening.concurrentHostLifecycleRace?.winningLabel ===
            (hardening.concurrentHostLifecycleRace?.winningStatus === "dead"
              ? "Dead"
              : "Modkilled") &&
          hardening.concurrentHostLifecycleRace?.ack?.state === "ack" &&
          hardening.concurrentHostLifecycleRace?.ack?.serverEnvelope?.body?.kind ===
            "Ack" &&
          Array.isArray(hardening.concurrentHostLifecycleRace?.ack?.streamSeqs) &&
          hardening.concurrentHostLifecycleRace.ack.streamSeqs.length === 1 &&
          hardening.concurrentHostLifecycleRace?.reject?.state === "reject" &&
          hardening.concurrentHostLifecycleRace?.reject?.error ===
            "InvalidTarget" &&
          hardening.concurrentHostLifecycleRace?.reject?.serverEnvelope?.body?.kind ===
            "Reject" &&
          Array.isArray(hardening.concurrentHostLifecycleRace?.reject?.streamSeqs) ===
            false &&
          hardening.concurrentHostLifecycleRace?.reject?.message?.includes(
            "slot lifecycle changed or is already current",
          ) === true &&
          hardening.concurrentHostLifecycleRace?.ack?.commandId !==
            hardening.concurrentHostLifecycleRace?.reject?.commandId &&
          typeof hardening.concurrentHostLifecycleRace?.game === "string" &&
          hardening.concurrentHostLifecycleRace.game.length > 0 &&
          hardening.concurrentHostLifecycleRace?.ack?.requestEnvelope?.body?.body
            ?.command?.SetSlotStatus?.game ===
            hardening.concurrentHostLifecycleRace?.game &&
          hardening.concurrentHostLifecycleRace?.ack?.requestEnvelope?.body?.body
            ?.command?.SetSlotStatus?.slot === "slot-7" &&
          hardening.concurrentHostLifecycleRace?.ack?.requestEnvelope?.body?.body
            ?.command?.SetSlotStatus?.status ===
            hardening.concurrentHostLifecycleRace?.winningStatus &&
          hardening.concurrentHostLifecycleRace?.reject?.requestEnvelope?.body?.body
            ?.command?.SetSlotStatus?.game ===
            hardening.concurrentHostLifecycleRace?.game &&
          hardening.concurrentHostLifecycleRace?.reject?.requestEnvelope?.body?.body
            ?.command?.SetSlotStatus?.slot === "slot-7" &&
          hardening.concurrentHostLifecycleRace?.deadReplacementAfterRace
            ?.lifecycleLabel === hardening.concurrentHostLifecycleRace?.winningLabel &&
          hardening.concurrentHostLifecycleRace?.modkillReplacementAfterRace
            ?.lifecycleLabel === hardening.concurrentHostLifecycleRace?.winningLabel &&
          hardening.concurrentHostLifecycleRace?.deadLifecycleActionsAfterRace?.includes(
            "mark_dead",
          ) === false &&
          hardening.concurrentHostLifecycleRace?.deadLifecycleActionsAfterRace?.includes(
            "modkill_slot",
          ) === false &&
          hardening.concurrentHostLifecycleRace?.modkillLifecycleActionsAfterRace?.includes(
            "mark_dead",
          ) === false &&
          hardening.concurrentHostLifecycleRace?.modkillLifecycleActionsAfterRace?.includes(
            "modkill_slot",
          ) === false &&
          hardening.concurrentHostLifecycleRace?.deadActivityRow?.actionId ===
            "mark_dead" &&
          hardening.concurrentHostLifecycleRace?.modkillActivityRow?.actionId ===
            "modkill_slot" &&
          hardening.concurrentHostLifecycleRace?.affectedPlayerCommandStateAfterRace
            ?.actorAlive === false &&
          hardening.concurrentHostLifecycleRace?.affectedPlayerCommandStateAfterRace
            ?.actorStatus === hardening.concurrentHostLifecycleRace?.winningStatus &&
          hardening.concurrentHostLifecycleRace?.disabledControls?.vote?.disabled ===
            true &&
          hardening.concurrentHostLifecycleRace?.disabledControls?.withdraw
            ?.disabled === true &&
          hardening.concurrentHostLifecycleRace?.disabledControls?.post?.disabled ===
            true &&
          hardening.concurrentHostLifecycleRace?.actionControlCount === 0 &&
          hardening.concurrentHostLifecycleRace?.directPost?.state === "reject" &&
          hardening.concurrentHostLifecycleRace?.directPost?.error ===
            "SlotNotAlive" &&
          hardening.concurrentHostLifecycleRace?.apiSlotAfterRace?.alive === false &&
          hardening.concurrentHostLifecycleRace?.apiSlotAfterRace?.status ===
            hardening.concurrentHostLifecycleRace?.winningStatus,
      },
    ),
    lane(
      "concurrent-host-lifecycle-race-reload",
      "Concurrent host lifecycle race reloads terminal slot projections",
      {
        game: hardening.concurrentHostLifecycleRace?.game ?? null,
        winningStatus: hardening.concurrentHostLifecycleRace?.winningStatus ?? null,
        deadRouteStatus:
          hardening.concurrentHostLifecycleRace?.roleReloadAfterRace
            ?.deadRouteStatus ?? null,
        modkillRouteStatus:
          hardening.concurrentHostLifecycleRace?.roleReloadAfterRace
            ?.modkillRouteStatus ?? null,
        playerRouteStatus:
          hardening.concurrentHostLifecycleRace?.roleReloadAfterRace
            ?.playerRouteStatus ?? null,
        deadLifecycleLabel:
          hardening.concurrentHostLifecycleRace?.roleReloadAfterRace
            ?.deadReplacementAfterReload?.lifecycleLabel ?? null,
        modkillLifecycleLabel:
          hardening.concurrentHostLifecycleRace?.roleReloadAfterRace
            ?.modkillReplacementAfterReload?.lifecycleLabel ?? null,
        playerStatus:
          hardening.concurrentHostLifecycleRace?.roleReloadAfterRace
            ?.affectedPlayerCommandStateAfterReload?.actorStatus ?? null,
        apiStatus:
          hardening.concurrentHostLifecycleRace?.roleReloadAfterRace
            ?.apiSlotAfterReload?.status ?? null,
        passed:
          hardening.concurrentHostLifecycleRace?.status === "passed" &&
          hardening.concurrentHostLifecycleRace?.roleReloadAfterRace?.status ===
            "passed" &&
          hardening.concurrentHostLifecycleRace?.roleReloadAfterRace
            ?.deadRouteStatus === 200 &&
          hardening.concurrentHostLifecycleRace?.roleReloadAfterRace
            ?.modkillRouteStatus === 200 &&
          hardening.concurrentHostLifecycleRace?.roleReloadAfterRace
            ?.playerRouteStatus === 200 &&
          hardening.concurrentHostLifecycleRace?.roleReloadAfterRace
            ?.deadPhaseAfterReload?.id === "D02" &&
          hardening.concurrentHostLifecycleRace?.roleReloadAfterRace
            ?.deadPhaseAfterReload?.locked === false &&
          hardening.concurrentHostLifecycleRace?.roleReloadAfterRace
            ?.modkillPhaseAfterReload?.id === "D02" &&
          hardening.concurrentHostLifecycleRace?.roleReloadAfterRace
            ?.modkillPhaseAfterReload?.locked === false &&
          hardening.concurrentHostLifecycleRace?.roleReloadAfterRace
            ?.deadReplacementAfterReload?.lifecycleLabel ===
            hardening.concurrentHostLifecycleRace?.winningLabel &&
          hardening.concurrentHostLifecycleRace?.roleReloadAfterRace
            ?.modkillReplacementAfterReload?.lifecycleLabel ===
            hardening.concurrentHostLifecycleRace?.winningLabel &&
          hardening.concurrentHostLifecycleRace?.roleReloadAfterRace
            ?.deadLifecycleActionsAfterReload?.includes("mark_dead") === false &&
          hardening.concurrentHostLifecycleRace?.roleReloadAfterRace
            ?.deadLifecycleActionsAfterReload?.includes("modkill_slot") === false &&
          hardening.concurrentHostLifecycleRace?.roleReloadAfterRace
            ?.modkillLifecycleActionsAfterReload?.includes("mark_dead") === false &&
          hardening.concurrentHostLifecycleRace?.roleReloadAfterRace
            ?.modkillLifecycleActionsAfterReload?.includes("modkill_slot") ===
            false &&
          hardening.concurrentHostLifecycleRace?.roleReloadAfterRace
            ?.affectedPlayerCommandStateAfterReload?.actorAlive === false &&
          hardening.concurrentHostLifecycleRace?.roleReloadAfterRace
            ?.affectedPlayerCommandStateAfterReload?.actorStatus ===
            hardening.concurrentHostLifecycleRace?.winningStatus &&
          hardening.concurrentHostLifecycleRace?.roleReloadAfterRace
            ?.affectedPlayerCommandStateAfterReload?.actions?.length === 0 &&
          hardening.concurrentHostLifecycleRace?.roleReloadAfterRace
            ?.disabledControlsAfterReload?.vote?.disabled === true &&
          hardening.concurrentHostLifecycleRace?.roleReloadAfterRace
            ?.disabledControlsAfterReload?.withdraw?.disabled === true &&
          hardening.concurrentHostLifecycleRace?.roleReloadAfterRace
            ?.disabledControlsAfterReload?.post?.disabled === true &&
          hardening.concurrentHostLifecycleRace?.roleReloadAfterRace
            ?.actionControlCountAfterReload === 0 &&
          hardening.concurrentHostLifecycleRace?.roleReloadAfterRace
            ?.apiSlotAfterReload?.alive === false &&
          hardening.concurrentHostLifecycleRace?.roleReloadAfterRace
            ?.apiSlotAfterReload?.status ===
            hardening.concurrentHostLifecycleRace?.winningStatus,
      },
    ),
    lane("stale-host-prompt", "Stale host prompt rejects after live resolution", {
      rejectError: hardening.staleHostPrompt?.reject?.error ?? null,
      promptId: hardening.staleHostPrompt?.promptId ?? null,
      liveResolveSeqs:
        hardening.staleHostPrompt?.liveResolve?.commandStatus?.streamSeqs ?? null,
      promptActionsAfterReject:
        hardening.staleHostPrompt?.promptActionsAfterReject ?? null,
      promptStatusAfterReject:
        hardening.staleHostPrompt?.promptsAfterReject?.find(
          (prompt) => prompt.id === hardening.staleHostPrompt?.promptId,
        )?.status ?? null,
      apiPromptStatusAfterReject:
        hardening.staleHostPrompt?.apiPromptsAfterReject?.find(
          (prompt) =>
            (prompt.id ?? prompt.prompt_id) === hardening.staleHostPrompt?.promptId,
        )?.status ?? null,
      passed:
        hardening.staleHostPrompt?.status === "passed" &&
        hardening.staleHostPrompt?.promptId === "D01:skip_next_day:slot_1" &&
        hardening.staleHostPrompt?.setup?.promptActions?.includes(
          "resolve_host_prompt-D01-skip_next_day-slot_1",
        ) === true &&
        hardening.staleHostPrompt?.liveResolve?.commandStatus?.state === "ack" &&
        Array.isArray(
          hardening.staleHostPrompt?.liveResolve?.commandStatus?.streamSeqs,
        ) &&
        hardening.staleHostPrompt.liveResolve.commandStatus.streamSeqs.length === 2 &&
        hardening.staleHostPrompt?.reject?.state === "reject" &&
        hardening.staleHostPrompt?.reject?.error === "PromptAlreadyResolved" &&
        hardening.staleHostPrompt?.reject?.serverEnvelope?.body?.kind === "Reject" &&
        Array.isArray(hardening.staleHostPrompt?.reject?.streamSeqs) === false &&
        hardening.staleHostPrompt?.promptsAfterReject?.find(
          (prompt) => prompt.id === "D01:skip_next_day:slot_1",
        )?.status === "resolved" &&
        hardening.staleHostPrompt?.promptActionsAfterReject?.includes(
          "resolve_host_prompt-D01-skip_next_day-slot_1",
        ) === false &&
        hardening.staleHostPrompt?.activityStatusText?.includes(
          "host prompt selection is stale",
        ) === true &&
        hardening.staleHostPrompt?.activityRow?.source === "outcome" &&
        hardening.staleHostPrompt?.activityRow?.actionId ===
          "resolve_host_prompt-D01-skip_next_day-slot_1" &&
        hardening.staleHostPrompt?.activityRow?.dispatchKind ===
          "resolve_host_prompt" &&
        hardening.staleHostPrompt?.dispatchPlan?.projectionRefreshKeys?.includes(
          "hostPrompts",
        ) === true &&
        hardening.staleHostPrompt?.apiPromptsAfterReject?.find(
          (prompt) => (prompt.id ?? prompt.prompt_id) === "D01:skip_next_day:slot_1",
        )?.status === "resolved",
    }),
    lane(
      "stale-host-prompt-reload",
      "Stale host prompt recovery reloads resolved console",
      {
        game: hardening.staleHostPrompt?.game ?? null,
        promptId: hardening.staleHostPrompt?.promptId ?? null,
        routeStatus:
          hardening.staleHostPrompt?.staleHostPromptReloadAfterReject
            ?.routeResponseStatus ?? null,
        rejectReceipt:
          hardening.staleHostPrompt?.staleHostPromptReloadAfterReject
            ?.rejectReceiptStatusText ?? null,
        promptStatusAfterReload:
          hardening.staleHostPrompt?.staleHostPromptReloadAfterReject
            ?.promptsAfterReload?.find(
              (prompt) => prompt.id === hardening.staleHostPrompt?.promptId,
            )?.status ?? null,
        promptActionVisible:
          hardening.staleHostPrompt?.staleHostPromptReloadAfterReject
            ?.promptActionsAfterReload?.includes(
              "resolve_host_prompt-D01-skip_next_day-slot_1",
            ) ?? null,
        apiPromptStatusAfterReload:
          hardening.staleHostPrompt?.staleHostPromptReloadAfterReject
            ?.apiPromptsAfterReload?.find(
              (prompt) =>
                (prompt.id ?? prompt.prompt_id) ===
                hardening.staleHostPrompt?.promptId,
            )?.status ?? null,
        passed:
          hardening.staleHostPrompt?.status === "passed" &&
          hardening.staleHostPrompt?.reject?.error === "PromptAlreadyResolved" &&
          hardening.staleHostPrompt?.staleHostPromptReloadAfterReject?.status ===
            "passed" &&
          hardening.staleHostPrompt?.staleHostPromptReloadAfterReject
            ?.routeResponseStatus === 200 &&
          hardening.staleHostPrompt?.staleHostPromptReloadAfterReject
            ?.rejectReceiptStatusText?.includes("Reject PromptAlreadyResolved") ===
            true &&
          hardening.staleHostPrompt?.staleHostPromptReloadAfterReject
            ?.rejectReceiptStatusText?.includes("host prompt selection is stale") ===
            true &&
          hardening.staleHostPrompt?.staleHostPromptReloadAfterReject
            ?.promptsAfterReload?.find(
              (prompt) => prompt.id === "D01:skip_next_day:slot_1",
            )?.status === "resolved" &&
          hardening.staleHostPrompt?.staleHostPromptReloadAfterReject
            ?.promptActionsAfterReload?.includes(
              "resolve_host_prompt-D01-skip_next_day-slot_1",
            ) === false &&
          hardening.staleHostPrompt?.staleHostPromptReloadAfterReject
            ?.apiPromptsAfterReload?.find(
              (prompt) => (prompt.id ?? prompt.prompt_id) === "D01:skip_next_day:slot_1",
            )?.status === "resolved",
      },
    ),
    ...completedGameHardeningProofLanes({ hardening }),
    lane("stale-same-action-recovery", "Stale duplicate player action rejects and refreshes", {
      roleUrl: hardening.staleSameActionRecovery?.sourceRoleUrl ?? null,
      visitedRolePath: hardening.staleSameActionRecovery?.visitedRolePath ?? null,
      rejectError: hardening.staleSameActionRecovery?.reject?.error ?? null,
      rejectMessage: hardening.staleSameActionRecovery?.reject?.message ?? null,
      stalePhase: hardening.staleSameActionRecovery?.staleN01Phase?.phaseId ?? null,
      refreshedPhase:
        hardening.staleSameActionRecovery?.commandStateAfterReject?.phase?.phaseId ??
        null,
      refreshedActionCount:
        hardening.staleSameActionRecovery?.commandStateAfterReject?.actions?.length ??
        null,
      apiRefreshedPhase:
        hardening.staleSameActionRecovery?.apiCommandStateAfterReject?.phase?.phase_id ??
        null,
      receiptActionId:
        hardening.staleSameActionRecovery?.currentReceipt?.actionId ?? null,
      legalActionTarget: hardening.staleSameActionRecovery?.legalActionTarget ?? null,
      actionVisibleAfterRefresh:
        hardening.staleSameActionRecovery?.actionVisibleAfterRefresh ?? null,
      passed:
        hardening.staleSameActionRecovery?.status === "passed" &&
        typeof hardening.staleSameActionRecovery?.sourceRoleUrl === "string" &&
        hardening.staleSameActionRecovery.sourceRoleUrl.includes("/g/") &&
        typeof hardening.staleSameActionRecovery?.visitedRolePath === "string" &&
        hardening.staleSameActionRecovery.visitedRolePath.includes("/g/") &&
        hardening.staleSameActionRecovery?.reject?.commandId !==
          hardening.staleSameActionRecovery?.legalActionCommandId &&
        staleActionRejectRecoveryMatches(hardening.staleSameActionRecovery, {
          error: "ActionAlreadySubmitted",
          actorSlot: "slot_4",
          actionId: "role_factional_kill",
          templateId: "factional_kill",
          targetSlot: hardening.staleSameActionRecovery?.legalActionTarget,
          commandAction: "submit_action:factional_kill",
          messageFragments: ["refresh and use current controls"],
          dispatchRefreshKeys: [
            "notifications",
            "investigationResults",
            "commandState",
          ],
          forbiddenDispatchRefreshKeys: ["dayVoteOutcomes"],
          receiptRefreshKeys: ["commandState"],
          forbiddenReceiptRefreshKeys: ["dayVoteOutcomes"],
          receiptStatusFragments: [
            "Reject ActionAlreadySubmitted",
            "refresh and use current controls",
          ],
          stalePhaseId: "N01",
          browserCommandState: {
            actorSlot: "slot_4",
            actorAlive: true,
            actorStatus: "alive",
            phaseId: "N01",
            locked: false,
            actionCount: 0,
          },
          apiCommandState: {
            actorSlot: "slot_4",
            actorAlive: true,
            actorStatus: "alive",
            phaseId: "N01",
            locked: false,
            actionCount: 0,
          },
        }),
    }),
    lane("stale-dead-action-conflict", "Stale action actor death rejects and refreshes", {
      roleUrl: hardening.staleDeadActionConflict?.sourceRoleUrl ?? null,
      visitedRolePath: hardening.staleDeadActionConflict?.visitedRolePath ?? null,
      rejectError: hardening.staleDeadActionConflict?.reject?.error ?? null,
      rejectMessage: hardening.staleDeadActionConflict?.reject?.message ?? null,
      templateId: hardening.staleDeadActionConflict?.actionConfig?.templateId ?? null,
      stalePhase: hardening.staleDeadActionConflict?.staleN01Phase?.phaseId ?? null,
      actorStatusAfterReject:
        hardening.staleDeadActionConflict?.commandStateAfterReject?.actorStatus ?? null,
      actionVisibleAfterRefresh:
        hardening.staleDeadActionConflict?.actionVisibleAfterRefresh ?? null,
      restoredActorStatus:
        hardening.staleDeadActionConflict?.liveCommandStateAfterRestore?.actorStatus ??
        null,
      passed:
        hardening.staleDeadActionConflict?.status === "passed" &&
        typeof hardening.staleDeadActionConflict?.sourceRoleUrl === "string" &&
        hardening.staleDeadActionConflict.sourceRoleUrl.includes("/g/") &&
        typeof hardening.staleDeadActionConflict?.visitedRolePath === "string" &&
        hardening.staleDeadActionConflict.visitedRolePath.includes("/g/") &&
        hardening.staleDeadActionConflict?.markDead?.state === "ack" &&
        hardening.staleDeadActionConflict?.restoreAlive?.state === "ack" &&
        hardening.staleDeadActionConflict?.apiSlotAfterDead?.alive === false &&
        hardening.staleDeadActionConflict?.apiSlotAfterDead?.status === "dead" &&
        hardening.staleDeadActionConflict?.reject?.error === "SlotNotAlive" &&
        hardening.staleDeadActionConflict?.reject?.message?.includes(
          "actor is no longer alive",
        ) === true &&
        hardening.staleDeadActionConflict?.reject?.message?.includes(
          "current action controls",
        ) === true &&
        hardening.staleDeadActionConflict?.actionConfig?.templateId ===
          "factional_kill" &&
        hardening.staleDeadActionConflict?.staleN01Phase?.phaseId === "N01" &&
        hardening.staleDeadActionConflict?.commandStateAfterReject?.actorAlive ===
          false &&
        hardening.staleDeadActionConflict?.commandStateAfterReject?.actorStatus ===
          "dead" &&
        hardening.staleDeadActionConflict?.commandStateAfterReject?.actions?.length ===
          0 &&
        hardening.staleDeadActionConflict?.actionVisibleAfterRefresh === false &&
        hardening.staleDeadActionConflict?.apiSlotAfterRestore?.alive === true &&
        hardening.staleDeadActionConflict?.apiSlotAfterRestore?.status === "alive" &&
        hardening.staleDeadActionConflict?.liveCommandStateAfterRestore?.actorAlive ===
          true &&
        hardening.staleDeadActionConflict?.liveCommandStateAfterRestore?.actorStatus ===
          "alive" &&
        hardening.staleDeadActionConflict?.liveCommandStateAfterRestore?.actions?.some(
          (action) => action.templateId === "factional_kill",
        ) === true,
    }),
    lane("stale-action-conflict", "Stale player action rejects and refreshes command state", {
      roleUrl: hardening.staleActionConflict?.sourceRoleUrl ?? null,
      visitedRolePath: hardening.staleActionConflict?.visitedRolePath ?? null,
      rejectError: hardening.staleActionConflict?.reject?.error ?? null,
      rejectMessage: hardening.staleActionConflict?.reject?.message ?? null,
      stalePhase: hardening.staleActionConflict?.staleN01Phase?.phaseId ?? null,
      refreshedPhase: hardening.staleActionConflict?.phaseAfterReject?.phaseId ?? null,
      refreshedCommandPhase:
        hardening.staleActionConflict?.commandStateAfterReject?.phase?.phaseId ?? null,
      refreshedActionCount:
        hardening.staleActionConflict?.commandStateAfterReject?.actions?.length ?? null,
      apiRefreshedPhase:
        hardening.staleActionConflict?.apiCommandStateAfterReject?.phase?.phase_id ??
        null,
      receiptActionId: hardening.staleActionConflict?.currentReceipt?.actionId ?? null,
      actionVisibleAfterRefresh:
        hardening.staleActionConflict?.actionVisibleAfterRefresh ?? null,
      passed:
        hardening.staleActionConflict?.status === "passed" &&
        typeof hardening.staleActionConflict?.sourceRoleUrl === "string" &&
        hardening.staleActionConflict.sourceRoleUrl.includes("/g/") &&
        typeof hardening.staleActionConflict?.visitedRolePath === "string" &&
        hardening.staleActionConflict.visitedRolePath.includes("/g/") &&
        hardening.staleActionConflict?.phaseAfterReject?.phaseId === "D02" &&
        staleActionRejectRecoveryMatches(hardening.staleActionConflict, {
          error: "PhaseLocked",
          actorSlot: "slot_4",
          templateId: "factional_kill",
          commandAction: "submit_action:factional_kill",
          messageFragments: ["stale action state", "current action controls"],
          dispatchRefreshKeys: [
            "notifications",
            "investigationResults",
            "commandState",
            "dayVoteOutcomes",
          ],
          receiptRefreshKeys: ["commandState"],
          forbiddenReceiptRefreshKeys: ["dayVoteOutcomes"],
          receiptStatusFragments: ["Reject PhaseLocked", "stale action state"],
          stalePhaseId: "N01",
          browserCommandState: {
            actorSlot: "slot_4",
            actorAlive: true,
            actorStatus: "alive",
            phaseId: "D02",
            locked: false,
            actionCount: 0,
          },
          apiCommandState: {
            actorSlot: "slot_4",
            actorAlive: true,
            actorStatus: "alive",
            phaseId: "D02",
            locked: false,
            actionCount: 0,
          },
        }),
    }),
    lane("stale-action-conflict-message", "Stale player action conflict message is explicit", {
      roleUrl: hardening.staleActionConflict?.sourceRoleUrl ?? null,
      visitedRolePath: hardening.staleActionConflict?.visitedRolePath ?? null,
      rejectError: hardening.staleActionConflict?.reject?.error ?? null,
      rejectMessage: hardening.staleActionConflict?.reject?.message ?? null,
      templateId: hardening.staleActionConflict?.actionConfig?.templateId ?? null,
      stalePhase: hardening.staleActionConflict?.staleN01Phase?.phaseId ?? null,
      refreshedPhase: hardening.staleActionConflict?.phaseAfterReject?.phaseId ?? null,
      receiptStatusText: hardening.staleActionConflict?.receiptStatusText ?? null,
      passed:
        hardening.staleActionConflict?.status === "passed" &&
        typeof hardening.staleActionConflict?.sourceRoleUrl === "string" &&
        hardening.staleActionConflict.sourceRoleUrl.includes("/g/") &&
        typeof hardening.staleActionConflict?.visitedRolePath === "string" &&
        hardening.staleActionConflict.visitedRolePath.includes("/g/") &&
        hardening.staleActionConflict?.reject?.error === "PhaseLocked" &&
        hardening.staleActionConflict?.reject?.message?.includes(
          "stale action state",
        ) === true &&
        hardening.staleActionConflict?.reject?.message?.includes(
          "current action controls",
        ) === true &&
        hardening.staleActionConflict?.receiptStatusText?.includes(
          "Reject PhaseLocked",
        ) === true &&
        hardening.staleActionConflict?.receiptStatusText?.includes(
          "stale action state",
        ) === true &&
        hardening.staleActionConflict?.currentReceipt?.actionId ===
          "submit_action:factional_kill" &&
        hardening.staleActionConflict?.dispatchPlan?.projectionRefreshKeys?.includes(
          "commandState",
        ) === true &&
        hardening.staleActionConflict?.dispatchPlan?.projectionRefreshKeys?.includes(
          "dayVoteOutcomes",
        ) === true &&
        hardening.staleActionConflict?.actionConfig?.templateId ===
          "factional_kill" &&
        hardening.staleActionConflict?.staleN01Phase?.phaseId === "N01" &&
        hardening.staleActionConflict?.phaseAfterReject?.phaseId === "D02" &&
        hardening.staleActionConflict?.commandStateAfterReject?.actions?.length ===
          0 &&
        hardening.staleActionConflict?.actionVisibleAfterRefresh === false,
    }),
    lane(
      stalePlayerActionReconnectLaneId,
      "Stale player action reconnect recovers current state",
      {
      roleUrl: hardening.staleActionConflict?.sourceRoleUrl ?? null,
      visitedRolePath: hardening.staleActionConflict?.visitedRolePath ?? null,
      rejectError: hardening.staleActionConflict?.reject?.error ?? null,
      reconnectingState:
        hardening.staleActionConflict?.reconnectAfterReject?.reconnectingStatus?.state ??
        null,
      recoveryState:
        hardening.staleActionConflict?.reconnectAfterReject?.reconnectRecoveryEvent
          ?.state ?? null,
      recoveredPhase:
        hardening.staleActionConflict?.reconnectAfterReject?.recoveredCommandState
          ?.phase?.phaseId ?? null,
      recoveredActions:
        hardening.staleActionConflict?.reconnectAfterReject?.recoveredCommandState
          ?.actions?.length ?? null,
      recoveredSnapshotContainsPost:
        hardening.staleActionConflict?.reconnectAfterReject
          ?.recoveredSnapshotContainsPost ?? null,
      passed:
        hardening.staleActionConflict?.status === "passed" &&
        typeof hardening.staleActionConflict?.sourceRoleUrl === "string" &&
        hardening.staleActionConflict.sourceRoleUrl.includes(
          staleActionReconnectExpectation.roleUrlFragment,
        ) &&
        typeof hardening.staleActionConflict?.visitedRolePath === "string" &&
        hardening.staleActionConflict.visitedRolePath.includes(
          staleActionReconnectExpectation.roleUrlFragment,
        ) &&
        hardening.staleActionConflict?.reject?.error ===
          staleActionReconnectExpectation.rejectError &&
        hardening.staleActionConflict?.reconnectAfterReject?.status === "passed" &&
        hardening.staleActionConflict?.reconnectAfterReject?.reconnectingStatus
          ?.state === staleActionReconnectExpectation.reconnectingState &&
        hardening.staleActionConflict?.reconnectAfterReject?.reconnectRecoveryEvent
          ?.state === staleActionReconnectExpectation.recoveryState &&
        hardening.staleActionConflict?.reconnectAfterReject?.reconnectRecoveryEvent
          ?.attempt === staleActionReconnectExpectation.reconnectAttempt &&
        hardening.staleActionConflict?.reconnectAfterReject
          ?.recoveredSnapshotContainsPost ===
          staleActionReconnectExpectation.recoveredSnapshotContainsPost &&
        hardening.staleActionConflict?.reconnectAfterReject?.recoveredCommandState
          ?.actorSlot === staleActionReconnectExpectation.actorSlot &&
        hardening.staleActionConflict?.reconnectAfterReject?.recoveredCommandState
          ?.actorAlive === true &&
        hardening.staleActionConflict?.reconnectAfterReject?.recoveredCommandState
          ?.phase?.phaseId === staleActionReconnectExpectation.recoveredPhaseId &&
        hardening.staleActionConflict?.reconnectAfterReject?.recoveredCommandState
          ?.phase?.locked === staleActionReconnectExpectation.recoveredLocked &&
        hardening.staleActionConflict?.reconnectAfterReject?.recoveredCommandState
          ?.actions?.length ===
          staleActionReconnectExpectation.recoveredActionCount &&
        hardening.staleActionConflict?.buttonsAfterReconnect?.some(
          (button) =>
            button.action === staleActionReconnectExpectation.commandAction,
        ) !== true,
      },
    ),
    lane(
      privateChannelStaleActionReconnectLaneId,
      "Private channel stale action reconnect preserves scope",
      {
        roleUrl:
          hardening.privateChannelStaleActionReconnectRecovery?.sourceRoleUrl ??
          null,
        visitedRolePath:
          hardening.privateChannelStaleActionReconnectRecovery?.visitedRolePath ??
          null,
        channel:
          hardening.privateChannelStaleActionReconnectRecovery?.channel ?? null,
        rejectError:
          hardening.privateChannelStaleActionReconnectRecovery?.reject?.error ??
          null,
        refreshedPhase:
          hardening.privateChannelStaleActionReconnectRecovery
            ?.commandStateAfterReject?.phase?.phaseId ?? null,
        channelAfterReject:
          hardening.privateChannelStaleActionReconnectRecovery
            ?.channelContextAfterReject?.channelId ?? null,
        reconnectChannel:
          hardening.privateChannelStaleActionReconnectRecovery
            ?.reconnectChannelContext?.channelId ?? null,
        recoveredPhase:
          hardening.privateChannelStaleActionReconnectRecovery
            ?.reconnectAfterReject?.recoveredCommandState?.phase?.phaseId ??
          null,
        privateThreadPagerVisible:
          hardening.privateChannelStaleActionReconnectRecovery
            ?.privateThreadPagerVisibleAfterReconnect ?? null,
        passed:
          hardening.privateChannelStaleActionReconnectRecovery?.status ===
            "passed" &&
          typeof hardening.privateChannelStaleActionReconnectRecovery
            ?.sourceRoleUrl === "string" &&
          hardening.privateChannelStaleActionReconnectRecovery.sourceRoleUrl
            .includes(privateStaleActionReconnectExpectation.roleUrlFragment) &&
          staleActionRejectRecoveryMatches(
            hardening.privateChannelStaleActionReconnectRecovery,
            {
              error: privateStaleActionReconnectExpectation.rejectError,
              actorSlot: privateStaleActionReconnectExpectation.actorSlot,
              templateId: privateStaleActionReconnectExpectation.templateId,
              commandAction: privateStaleActionReconnectExpectation.commandAction,
              messageFragments:
                privateStaleActionReconnectExpectation.messageFragments,
              dispatchRefreshKeys:
                privateStaleActionReconnectExpectation.dispatchRefreshKeys,
              receiptRefreshKeys:
                privateStaleActionReconnectExpectation.receiptRefreshKeys,
              stalePhaseId: privateStaleActionReconnectExpectation.stalePhaseId,
              browserCommandState:
                privateStaleActionReconnectExpectation.browserCommandState,
              apiCommandState:
                privateStaleActionReconnectExpectation.apiCommandState,
            },
          ) &&
          hardening.privateChannelStaleActionReconnectRecovery
            ?.channelContextBeforeClose?.channelId ===
            privateStaleActionReconnectExpectation.channelId &&
          hardening.privateChannelStaleActionReconnectRecovery
            ?.channelContextAfterReject?.channelId ===
            privateStaleActionReconnectExpectation.channelId &&
          hardening.privateChannelStaleActionReconnectRecovery
            ?.channelContextAfterReject?.actorSlot === "slot_4" &&
          hardening.privateChannelStaleActionReconnectRecovery
            ?.privateThreadPagerVisibleAfterReject === true &&
          hardening.privateChannelStaleActionReconnectRecovery
            ?.reconnectAfterReject?.reconnectCommand?.command?.SubmitPost
            ?.channel_id === privateStaleActionReconnectExpectation.channelId &&
          hardening.privateChannelStaleActionReconnectRecovery
            ?.reconnectAfterReject?.reconnectRecoveryEvent?.state ===
            privateStaleActionReconnectExpectation.recoveryState &&
          hardening.privateChannelStaleActionReconnectRecovery
            ?.reconnectAfterReject?.reconnectRecoveryEvent?.attempt === 1 &&
          hardening.privateChannelStaleActionReconnectRecovery
            ?.reconnectAfterReject?.recoveredSnapshotContainsPost === true &&
          hardening.privateChannelStaleActionReconnectRecovery
            ?.reconnectAfterReject?.recoveredCommandState?.actorSlot ===
            privateStaleActionReconnectExpectation.actorSlot &&
          hardening.privateChannelStaleActionReconnectRecovery
            ?.reconnectAfterReject?.recoveredCommandState?.phase?.phaseId ===
            privateStaleActionReconnectExpectation.recoveredPhaseId &&
          hardening.privateChannelStaleActionReconnectRecovery
            ?.reconnectAfterReject?.recoveredCommandState?.actions?.length ===
            privateStaleActionReconnectExpectation.recoveredActionCount &&
          hardening.privateChannelStaleActionReconnectRecovery
            ?.reconnectChannelContext?.channelId ===
            privateStaleActionReconnectExpectation.channelId &&
          hardening.privateChannelStaleActionReconnectRecovery
            ?.privateThreadPagerVisibleAfterReconnect === true &&
          hardening.privateChannelStaleActionReconnectRecovery
            ?.buttonsAfterReconnect?.some(
              (button) =>
                button.action ===
                privateStaleActionReconnectExpectation.commandAction,
            ) !== true,
      },
    ),
    lane("stale-host-control", "Stale host phase control rejects without drift", {
      rejectError: hardening.staleHostControl?.reject?.error ?? null,
      stalePhase: hardening.staleHostControl?.setup?.stalePhase?.id ?? null,
      phaseId: hardening.staleHostControl?.phaseAfterReject?.id ?? null,
      locked: hardening.staleHostControl?.phaseAfterReject?.locked ?? null,
      activitySource: hardening.staleHostControl?.activityRow?.source ?? null,
      currentActions: hardening.staleHostControl?.visibleActionsAfterReject ?? null,
      passed:
        hardening.staleHostControl?.status === "passed" &&
        hardening.staleHostControl?.setup?.stalePhase?.id === "N01" &&
        hardening.staleHostControl?.setup?.stalePhase?.locked === true &&
        hardening.staleHostControl?.reject?.error === "PhaseLocked" &&
        hardening.staleHostControl?.reject?.message?.includes("stale phase state") ===
          true &&
        hardening.staleHostControl?.phaseAfterReject?.id === "D02" &&
        hardening.staleHostControl?.phaseAfterReject?.locked === false &&
        hardening.staleHostControl?.activityRow?.source === "outcome" &&
        hardening.staleHostControl?.activityRow?.actionId === hostUnlockThreadActionId &&
        hardening.staleHostControl?.dispatchPlan?.projectionRefreshKeys?.includes(
          "host",
        ) === true &&
        hardening.staleHostControl?.visibleActionsAfterReject?.includes(
          hostResolvePhaseActionId,
        ) === true &&
        hardening.staleHostControl?.visibleActionsAfterReject?.includes(
          hostLockThreadActionId,
        ) === true &&
        hardening.staleHostControl?.visibleActionsAfterReject?.includes(
          hostUnlockThreadActionId,
        ) === false &&
        hardening.staleHostControl?.apiPhaseAfterReject?.phase_id === "D02" &&
        hardening.staleHostControl?.apiPhaseAfterReject?.locked === false,
    }),
    lane("concurrent-host-resolve-race", "Concurrent host resolves converge", {
      ackPageRole: hardening.concurrentHostResolveRace?.ackPageRole ?? null,
      rejectPageRole: hardening.concurrentHostResolveRace?.rejectPageRole ?? null,
      game: hardening.concurrentHostResolveRace?.game ?? null,
      ackState: hardening.concurrentHostResolveRace?.ack?.state ?? null,
      rejectError: hardening.concurrentHostResolveRace?.reject?.error ?? null,
      lockedAfterRace:
        hardening.concurrentHostResolveRace?.apiPhaseAfterRace?.locked ?? null,
      lockedAfterRestore:
        hardening.concurrentHostResolveRace?.apiPhaseAfterRestore?.locked ?? null,
      passed:
        hardening.concurrentHostResolveRace?.status === "passed" &&
        hardening.concurrentHostResolveRace?.setup?.stalePhase?.id === "D02" &&
        hardening.concurrentHostResolveRace?.setup?.stalePhase?.locked === false &&
        hardening.concurrentHostResolveRace?.setup?.phaseActions?.includes(
          hostResolvePhaseActionId,
        ) === true &&
        hardening.concurrentHostResolveRace?.setup?.phaseActions?.includes(
          hostLockThreadActionId,
        ) === true &&
        ["live", "concurrent"].includes(
          hardening.concurrentHostResolveRace?.ackPageRole,
        ) &&
        ["live", "concurrent"].includes(
          hardening.concurrentHostResolveRace?.rejectPageRole,
        ) &&
        hardening.concurrentHostResolveRace?.ackPageRole !==
          hardening.concurrentHostResolveRace?.rejectPageRole &&
        hardening.concurrentHostResolveRace?.ack?.state === "ack" &&
        hardening.concurrentHostResolveRace?.ack?.serverEnvelope?.body?.kind ===
          "Ack" &&
        Array.isArray(hardening.concurrentHostResolveRace?.ack?.streamSeqs) &&
        hardening.concurrentHostResolveRace.ack.streamSeqs.length > 0 &&
        hardening.concurrentHostResolveRace?.reject?.state === "reject" &&
        hardening.concurrentHostResolveRace?.reject?.error === "PhaseLocked" &&
        hardening.concurrentHostResolveRace?.reject?.serverEnvelope?.body?.kind ===
          "Reject" &&
        Array.isArray(hardening.concurrentHostResolveRace?.reject?.streamSeqs) ===
          false &&
        hardening.concurrentHostResolveRace?.reject?.message?.includes(
          "stale phase state",
        ) === true &&
        hardening.concurrentHostResolveRace?.ack?.commandId !==
          hardening.concurrentHostResolveRace?.reject?.commandId &&
        typeof hardening.concurrentHostResolveRace?.game === "string" &&
        hardening.concurrentHostResolveRace.game.length > 0 &&
        hardening.concurrentHostResolveRace?.ack?.requestEnvelope?.body?.body?.command
          ?.ResolvePhase?.game === hardening.concurrentHostResolveRace?.game &&
        hardening.concurrentHostResolveRace?.reject?.requestEnvelope?.body?.body
          ?.command?.ResolvePhase?.game === hardening.concurrentHostResolveRace?.game &&
        hardening.concurrentHostResolveRace?.livePhaseAfterRace?.id === "D02" &&
        hardening.concurrentHostResolveRace?.livePhaseAfterRace?.locked === true &&
        hardening.concurrentHostResolveRace?.concurrentPhaseAfterRace?.id === "D02" &&
        hardening.concurrentHostResolveRace?.concurrentPhaseAfterRace?.locked ===
          true &&
        hardening.concurrentHostResolveRace?.livePhaseActionsAfterRace?.includes(
          hostUnlockThreadActionId,
        ) === true &&
        hardening.concurrentHostResolveRace?.livePhaseActionsAfterRace?.includes(
          hostAdvancePhaseActionId,
        ) === true &&
        hardening.concurrentHostResolveRace?.livePhaseActionsAfterRace?.includes(
          hostResolvePhaseActionId,
        ) === false &&
        hardening.concurrentHostResolveRace?.livePhaseActionsAfterRace?.includes(
          hostLockThreadActionId,
        ) === false &&
        hardening.concurrentHostResolveRace?.concurrentPhaseActionsAfterRace?.includes(
          hostUnlockThreadActionId,
        ) === true &&
        hardening.concurrentHostResolveRace?.concurrentPhaseActionsAfterRace?.includes(
          hostAdvancePhaseActionId,
        ) === true &&
        hardening.concurrentHostResolveRace?.concurrentPhaseActionsAfterRace?.includes(
          hostResolvePhaseActionId,
        ) === false &&
        hardening.concurrentHostResolveRace?.concurrentPhaseActionsAfterRace?.includes(
          hostLockThreadActionId,
        ) === false &&
        hardening.concurrentHostResolveRace?.liveActivityRow?.actionId ===
          hostResolvePhaseActionId &&
        hardening.concurrentHostResolveRace?.concurrentActivityRow?.actionId ===
          hostResolvePhaseActionId &&
        hardening.concurrentHostResolveRace?.apiPhaseAfterRace?.phase_id === "D02" &&
        hardening.concurrentHostResolveRace?.apiPhaseAfterRace?.locked === true &&
        hardening.concurrentHostResolveRace?.restoreAfterRace?.commandStatus?.state ===
          "ack" &&
        hardening.concurrentHostResolveRace?.restoreAfterRace?.commandStatus
          ?.requestEnvelope?.body?.body?.command?.UnlockThread?.game ===
          hardening.concurrentHostResolveRace?.game &&
        hardening.concurrentHostResolveRace?.apiPhaseAfterRestore?.phase_id ===
          "D02" &&
        hardening.concurrentHostResolveRace?.apiPhaseAfterRestore?.locked === false,
    }),
    lane(
      "concurrent-host-resolve-race-reload",
      "Concurrent host resolve race reloads locked host projections",
      {
        game: hardening.concurrentHostResolveRace?.game ?? null,
        liveRouteStatus:
          hardening.concurrentHostResolveRace?.roleReloadAfterRace
            ?.liveRouteStatus ?? null,
        concurrentRouteStatus:
          hardening.concurrentHostResolveRace?.roleReloadAfterRace
            ?.concurrentRouteStatus ?? null,
        livePhase:
          hardening.concurrentHostResolveRace?.roleReloadAfterRace
            ?.livePhaseAfterReload ?? null,
        concurrentPhase:
          hardening.concurrentHostResolveRace?.roleReloadAfterRace
            ?.concurrentPhaseAfterReload ?? null,
        apiLocked:
          hardening.concurrentHostResolveRace?.roleReloadAfterRace
            ?.apiPhaseAfterReload?.locked ?? null,
        passed:
          hardening.concurrentHostResolveRace?.status === "passed" &&
          hardening.concurrentHostResolveRace?.roleReloadAfterRace?.status ===
            "passed" &&
          hardening.concurrentHostResolveRace?.roleReloadAfterRace
            ?.liveRouteStatus === 200 &&
          hardening.concurrentHostResolveRace?.roleReloadAfterRace
            ?.concurrentRouteStatus === 200 &&
          hardening.concurrentHostResolveRace?.roleReloadAfterRace
            ?.livePhaseAfterReload?.id === "D02" &&
          hardening.concurrentHostResolveRace?.roleReloadAfterRace
            ?.livePhaseAfterReload?.locked === true &&
          hardening.concurrentHostResolveRace?.roleReloadAfterRace
            ?.concurrentPhaseAfterReload?.id === "D02" &&
          hardening.concurrentHostResolveRace?.roleReloadAfterRace
            ?.concurrentPhaseAfterReload?.locked === true &&
          hardening.concurrentHostResolveRace?.roleReloadAfterRace
            ?.livePhaseActionsAfterReload?.includes(hostUnlockThreadActionId) === true &&
          hardening.concurrentHostResolveRace?.roleReloadAfterRace
            ?.livePhaseActionsAfterReload?.includes(hostAdvancePhaseActionId) === true &&
          hardening.concurrentHostResolveRace?.roleReloadAfterRace
            ?.livePhaseActionsAfterReload?.includes(hostResolvePhaseActionId) === false &&
          hardening.concurrentHostResolveRace?.roleReloadAfterRace
            ?.livePhaseActionsAfterReload?.includes(hostLockThreadActionId) === false &&
          hardening.concurrentHostResolveRace?.roleReloadAfterRace
            ?.concurrentPhaseActionsAfterReload?.includes(hostUnlockThreadActionId) ===
            true &&
          hardening.concurrentHostResolveRace?.roleReloadAfterRace
            ?.concurrentPhaseActionsAfterReload?.includes(hostAdvancePhaseActionId) ===
            true &&
          hardening.concurrentHostResolveRace?.roleReloadAfterRace
            ?.concurrentPhaseActionsAfterReload?.includes(hostResolvePhaseActionId) ===
            false &&
          hardening.concurrentHostResolveRace?.roleReloadAfterRace
            ?.concurrentPhaseActionsAfterReload?.includes(hostLockThreadActionId) ===
            false &&
          hardening.concurrentHostResolveRace?.roleReloadAfterRace
            ?.liveDeadlineActionsAfterReload?.includes(hostExtendDeadlineActionId) === true &&
          hardening.concurrentHostResolveRace?.roleReloadAfterRace
            ?.concurrentDeadlineActionsAfterReload?.includes(hostExtendDeadlineActionId) ===
            true &&
          hardening.concurrentHostResolveRace?.roleReloadAfterRace
            ?.apiPhaseAfterReload?.phase_id === "D02" &&
          hardening.concurrentHostResolveRace?.roleReloadAfterRace
            ?.apiPhaseAfterReload?.locked === true,
      },
    ),
    lane("concurrent-host-advance-race", "Concurrent host advances converge", {
      ackPageRole: hardening.concurrentHostAdvanceRace?.ackPageRole ?? null,
      rejectPageRole: hardening.concurrentHostAdvanceRace?.rejectPageRole ?? null,
      game: hardening.concurrentHostAdvanceRace?.game ?? null,
      ackState: hardening.concurrentHostAdvanceRace?.ack?.state ?? null,
      rejectError: hardening.concurrentHostAdvanceRace?.reject?.error ?? null,
      phaseAfterRace:
        hardening.concurrentHostAdvanceRace?.apiPhaseAfterRace?.phase_id ?? null,
      passed:
        hardening.concurrentHostAdvanceRace?.status === "passed" &&
        hardening.concurrentHostAdvanceRace?.setup?.stalePhase?.id === "D02" &&
        hardening.concurrentHostAdvanceRace?.setup?.stalePhase?.locked === true &&
        hardening.concurrentHostAdvanceRace?.setup?.phaseActions?.includes(
          hostAdvancePhaseActionId,
        ) === true &&
        hardening.concurrentHostAdvanceRace?.setup?.phaseActions?.includes(
          hostUnlockThreadActionId,
        ) === true &&
        ["live", "concurrent"].includes(
          hardening.concurrentHostAdvanceRace?.ackPageRole,
        ) &&
        ["live", "concurrent"].includes(
          hardening.concurrentHostAdvanceRace?.rejectPageRole,
        ) &&
        hardening.concurrentHostAdvanceRace?.ackPageRole !==
          hardening.concurrentHostAdvanceRace?.rejectPageRole &&
        hardening.concurrentHostAdvanceRace?.ack?.state === "ack" &&
        hardening.concurrentHostAdvanceRace?.ack?.serverEnvelope?.body?.kind ===
          "Ack" &&
        Array.isArray(hardening.concurrentHostAdvanceRace?.ack?.streamSeqs) &&
        hardening.concurrentHostAdvanceRace.ack.streamSeqs.length > 0 &&
        hardening.concurrentHostAdvanceRace?.reject?.state === "reject" &&
        hardening.concurrentHostAdvanceRace?.reject?.error === "InvalidTarget" &&
        hardening.concurrentHostAdvanceRace?.reject?.serverEnvelope?.body?.kind ===
          "Reject" &&
        Array.isArray(hardening.concurrentHostAdvanceRace?.reject?.streamSeqs) ===
          false &&
        hardening.concurrentHostAdvanceRace?.reject?.message?.includes(
          "stale phase state",
        ) === true &&
        hardening.concurrentHostAdvanceRace?.ack?.commandId !==
          hardening.concurrentHostAdvanceRace?.reject?.commandId &&
        typeof hardening.concurrentHostAdvanceRace?.game === "string" &&
        hardening.concurrentHostAdvanceRace.game.length > 0 &&
        hardening.concurrentHostAdvanceRace?.ack?.requestEnvelope?.body?.body?.command
          ?.AdvancePhase?.game === hardening.concurrentHostAdvanceRace?.game &&
        hardening.concurrentHostAdvanceRace?.reject?.requestEnvelope?.body?.body
          ?.command?.AdvancePhase?.game === hardening.concurrentHostAdvanceRace?.game &&
        hardening.concurrentHostAdvanceRace?.livePhaseAfterRace?.id === "N02" &&
        hardening.concurrentHostAdvanceRace?.livePhaseAfterRace?.locked === false &&
        hardening.concurrentHostAdvanceRace?.concurrentPhaseAfterRace?.id === "N02" &&
        hardening.concurrentHostAdvanceRace?.concurrentPhaseAfterRace?.locked ===
          false &&
        hardening.concurrentHostAdvanceRace?.livePhaseActionsAfterRace?.includes(
          hostResolvePhaseActionId,
        ) === true &&
        hardening.concurrentHostAdvanceRace?.livePhaseActionsAfterRace?.includes(
          hostLockThreadActionId,
        ) === true &&
        hardening.concurrentHostAdvanceRace?.livePhaseActionsAfterRace?.includes(
          hostAdvancePhaseActionId,
        ) === false &&
        hardening.concurrentHostAdvanceRace?.livePhaseActionsAfterRace?.includes(
          hostUnlockThreadActionId,
        ) === false &&
        hardening.concurrentHostAdvanceRace?.concurrentPhaseActionsAfterRace?.includes(
          hostResolvePhaseActionId,
        ) === true &&
        hardening.concurrentHostAdvanceRace?.concurrentPhaseActionsAfterRace?.includes(
          hostLockThreadActionId,
        ) === true &&
        hardening.concurrentHostAdvanceRace?.concurrentPhaseActionsAfterRace?.includes(
          hostAdvancePhaseActionId,
        ) === false &&
        hardening.concurrentHostAdvanceRace?.concurrentPhaseActionsAfterRace?.includes(
          hostUnlockThreadActionId,
        ) === false &&
        hardening.concurrentHostAdvanceRace?.liveActivityRow?.actionId ===
          hostAdvancePhaseActionId &&
        hardening.concurrentHostAdvanceRace?.concurrentActivityRow?.actionId ===
          hostAdvancePhaseActionId &&
        hardening.concurrentHostAdvanceRace?.apiPhaseAfterRace?.phase_id === "N02" &&
        hardening.concurrentHostAdvanceRace?.apiPhaseAfterRace?.locked === false,
    }),
    lane(
      "concurrent-host-advance-race-reload",
      "Concurrent host advance race reloads open host projections",
      {
        game: hardening.concurrentHostAdvanceRace?.game ?? null,
        liveRouteStatus:
          hardening.concurrentHostAdvanceRace?.roleReloadAfterRace
            ?.liveRouteStatus ?? null,
        concurrentRouteStatus:
          hardening.concurrentHostAdvanceRace?.roleReloadAfterRace
            ?.concurrentRouteStatus ?? null,
        livePhase:
          hardening.concurrentHostAdvanceRace?.roleReloadAfterRace
            ?.livePhaseAfterReload ?? null,
        concurrentPhase:
          hardening.concurrentHostAdvanceRace?.roleReloadAfterRace
            ?.concurrentPhaseAfterReload ?? null,
        apiPhase:
          hardening.concurrentHostAdvanceRace?.roleReloadAfterRace
            ?.apiPhaseAfterReload?.phase_id ?? null,
        passed:
          hardening.concurrentHostAdvanceRace?.status === "passed" &&
          hardening.concurrentHostAdvanceRace?.roleReloadAfterRace?.status ===
            "passed" &&
          hardening.concurrentHostAdvanceRace?.roleReloadAfterRace
            ?.liveRouteStatus === 200 &&
          hardening.concurrentHostAdvanceRace?.roleReloadAfterRace
            ?.concurrentRouteStatus === 200 &&
          hardening.concurrentHostAdvanceRace?.roleReloadAfterRace
            ?.livePhaseAfterReload?.id === "N02" &&
          hardening.concurrentHostAdvanceRace?.roleReloadAfterRace
            ?.livePhaseAfterReload?.locked === false &&
          hardening.concurrentHostAdvanceRace?.roleReloadAfterRace
            ?.concurrentPhaseAfterReload?.id === "N02" &&
          hardening.concurrentHostAdvanceRace?.roleReloadAfterRace
            ?.concurrentPhaseAfterReload?.locked === false &&
          hardening.concurrentHostAdvanceRace?.roleReloadAfterRace
            ?.livePhaseActionsAfterReload?.includes(hostResolvePhaseActionId) === true &&
          hardening.concurrentHostAdvanceRace?.roleReloadAfterRace
            ?.livePhaseActionsAfterReload?.includes(hostLockThreadActionId) === true &&
          hardening.concurrentHostAdvanceRace?.roleReloadAfterRace
            ?.livePhaseActionsAfterReload?.includes(hostAdvancePhaseActionId) === false &&
          hardening.concurrentHostAdvanceRace?.roleReloadAfterRace
            ?.livePhaseActionsAfterReload?.includes(hostUnlockThreadActionId) === false &&
          hardening.concurrentHostAdvanceRace?.roleReloadAfterRace
            ?.concurrentPhaseActionsAfterReload?.includes(hostResolvePhaseActionId) ===
            true &&
          hardening.concurrentHostAdvanceRace?.roleReloadAfterRace
            ?.concurrentPhaseActionsAfterReload?.includes(hostLockThreadActionId) === true &&
          hardening.concurrentHostAdvanceRace?.roleReloadAfterRace
            ?.concurrentPhaseActionsAfterReload?.includes(hostAdvancePhaseActionId) ===
            false &&
          hardening.concurrentHostAdvanceRace?.roleReloadAfterRace
            ?.concurrentPhaseActionsAfterReload?.includes(hostUnlockThreadActionId) ===
            false &&
          hardening.concurrentHostAdvanceRace?.roleReloadAfterRace
            ?.liveDeadlineActionsAfterReload?.includes(hostExtendDeadlineActionId) === true &&
          hardening.concurrentHostAdvanceRace?.roleReloadAfterRace
            ?.concurrentDeadlineActionsAfterReload?.includes(hostExtendDeadlineActionId) ===
            true &&
          hardening.concurrentHostAdvanceRace?.roleReloadAfterRace
            ?.apiPhaseAfterReload?.phase_id === "N02" &&
          hardening.concurrentHostAdvanceRace?.roleReloadAfterRace
            ?.apiPhaseAfterReload?.locked === false,
      },
    ),
    lane(
      "concurrent-host-deadline-advance-race",
      "Concurrent host deadline advances converge",
      {
        ackPageRole: hardening.concurrentHostDeadlineAdvanceRace?.ackPageRole ?? null,
        rejectPageRole: hardening.concurrentHostDeadlineAdvanceRace?.rejectPageRole ?? null,
        game: hardening.concurrentHostDeadlineAdvanceRace?.game ?? null,
        ackState: hardening.concurrentHostDeadlineAdvanceRace?.ack?.state ?? null,
        rejectError: hardening.concurrentHostDeadlineAdvanceRace?.reject?.error ?? null,
        phaseAfterRace:
          hardening.concurrentHostDeadlineAdvanceRace?.apiPhaseAfterRace?.phase_id ??
          null,
        passed:
          hardening.concurrentHostDeadlineAdvanceRace?.status === "passed" &&
          hardening.concurrentHostDeadlineAdvanceRace?.setup?.stalePhase?.id ===
            "D01" &&
          hardening.concurrentHostDeadlineAdvanceRace?.setup?.stalePhase?.locked ===
            true &&
          typeof hardening.concurrentHostDeadlineAdvanceRace?.setup?.stalePhase
            ?.deadline === "number" &&
          hardening.concurrentHostDeadlineAdvanceRace?.setup?.visibleActions?.includes(
            hostAdvanceByDeadlineActionId,
          ) === true &&
          hardening.concurrentHostDeadlineAdvanceRace?.setup?.visibleActions?.includes(
            hostAdvancePhaseActionId,
          ) === true &&
          hardening.concurrentHostDeadlineAdvanceRace?.setup?.visibleActions?.includes(
            hostUnlockThreadActionId,
          ) === true &&
          ["live", "concurrent"].includes(
            hardening.concurrentHostDeadlineAdvanceRace?.ackPageRole,
          ) &&
          ["live", "concurrent"].includes(
            hardening.concurrentHostDeadlineAdvanceRace?.rejectPageRole,
          ) &&
          hardening.concurrentHostDeadlineAdvanceRace?.ackPageRole !==
            hardening.concurrentHostDeadlineAdvanceRace?.rejectPageRole &&
          hardening.concurrentHostDeadlineAdvanceRace?.ack?.state === "ack" &&
          hardening.concurrentHostDeadlineAdvanceRace?.ack?.serverEnvelope?.body
            ?.kind === "Ack" &&
          Array.isArray(
            hardening.concurrentHostDeadlineAdvanceRace?.ack?.streamSeqs,
          ) &&
          hardening.concurrentHostDeadlineAdvanceRace.ack.streamSeqs.length === 2 &&
          hardening.concurrentHostDeadlineAdvanceRace?.reject?.state === "reject" &&
          hardening.concurrentHostDeadlineAdvanceRace?.reject?.error ===
            "InvalidTarget" &&
          hardening.concurrentHostDeadlineAdvanceRace?.reject?.serverEnvelope?.body
            ?.kind === "Reject" &&
          Array.isArray(
            hardening.concurrentHostDeadlineAdvanceRace?.reject?.streamSeqs,
          ) === false &&
          hardening.concurrentHostDeadlineAdvanceRace?.reject?.message?.includes(
            "deadline target is stale",
          ) === true &&
          hardening.concurrentHostDeadlineAdvanceRace?.ack?.commandId !==
            hardening.concurrentHostDeadlineAdvanceRace?.reject?.commandId &&
          typeof hardening.concurrentHostDeadlineAdvanceRace?.game === "string" &&
          hardening.concurrentHostDeadlineAdvanceRace.game.length > 0 &&
          hardening.concurrentHostDeadlineAdvanceRace?.ack?.requestEnvelope?.body
            ?.body?.command?.AdvancePhaseByDeadline?.game ===
            hardening.concurrentHostDeadlineAdvanceRace?.game &&
          hardening.concurrentHostDeadlineAdvanceRace?.ack?.requestEnvelope?.body
            ?.body?.command?.AdvancePhaseByDeadline?.phase === "D01" &&
          hardening.concurrentHostDeadlineAdvanceRace?.ack?.requestEnvelope?.body
            ?.body?.command?.AdvancePhaseByDeadline?.observed_at ===
            hardening.concurrentHostDeadlineAdvanceRace?.setup?.stalePhase?.deadline +
              1 &&
          hardening.concurrentHostDeadlineAdvanceRace?.reject?.requestEnvelope?.body
            ?.body?.command?.AdvancePhaseByDeadline?.game ===
            hardening.concurrentHostDeadlineAdvanceRace?.game &&
          hardening.concurrentHostDeadlineAdvanceRace?.reject?.requestEnvelope?.body
            ?.body?.command?.AdvancePhaseByDeadline?.phase === "D01" &&
          hardening.concurrentHostDeadlineAdvanceRace?.reject?.requestEnvelope?.body
            ?.body?.command?.AdvancePhaseByDeadline?.observed_at ===
            hardening.concurrentHostDeadlineAdvanceRace?.setup?.stalePhase?.deadline +
              1 &&
          hardening.concurrentHostDeadlineAdvanceRace?.livePhaseAfterRace?.id ===
            "N01" &&
          hardening.concurrentHostDeadlineAdvanceRace?.livePhaseAfterRace?.locked ===
            false &&
          hardening.concurrentHostDeadlineAdvanceRace?.livePhaseAfterRace?.deadline ===
            null &&
          hardening.concurrentHostDeadlineAdvanceRace?.concurrentPhaseAfterRace?.id ===
            "N01" &&
          hardening.concurrentHostDeadlineAdvanceRace?.concurrentPhaseAfterRace
            ?.locked === false &&
          hardening.concurrentHostDeadlineAdvanceRace?.concurrentPhaseAfterRace
            ?.deadline === null &&
          hardening.concurrentHostDeadlineAdvanceRace?.livePhaseActionsAfterRace?.includes(
            hostResolvePhaseActionId,
          ) === true &&
          hardening.concurrentHostDeadlineAdvanceRace?.livePhaseActionsAfterRace?.includes(
            hostLockThreadActionId,
          ) === true &&
          hardening.concurrentHostDeadlineAdvanceRace?.livePhaseActionsAfterRace?.includes(
            hostAdvanceByDeadlineActionId,
          ) === false &&
          hardening.concurrentHostDeadlineAdvanceRace?.concurrentPhaseActionsAfterRace?.includes(
            hostResolvePhaseActionId,
          ) === true &&
          hardening.concurrentHostDeadlineAdvanceRace?.concurrentPhaseActionsAfterRace?.includes(
            hostLockThreadActionId,
          ) === true &&
          hardening.concurrentHostDeadlineAdvanceRace?.concurrentPhaseActionsAfterRace?.includes(
            hostAdvanceByDeadlineActionId,
          ) === false &&
          hardening.concurrentHostDeadlineAdvanceRace?.liveActivityRow?.actionId ===
            hostAdvanceByDeadlineActionId &&
          hardening.concurrentHostDeadlineAdvanceRace?.concurrentActivityRow?.actionId ===
            hostAdvanceByDeadlineActionId &&
          hardening.concurrentHostDeadlineAdvanceRace?.apiPhaseAfterRace?.phase_id ===
            "N01" &&
          hardening.concurrentHostDeadlineAdvanceRace?.apiPhaseAfterRace?.locked ===
            false &&
          hardening.concurrentHostDeadlineAdvanceRace?.apiPhaseAfterRace?.deadline ===
            null,
      },
    ),
    lane(
      "concurrent-host-deadline-advance-race-reload",
      "Concurrent host deadline advance race reloads open host projections",
      {
        game: hardening.concurrentHostDeadlineAdvanceRace?.game ?? null,
        liveRouteStatus:
          hardening.concurrentHostDeadlineAdvanceRace?.roleReloadAfterRace
            ?.liveRouteStatus ?? null,
        concurrentRouteStatus:
          hardening.concurrentHostDeadlineAdvanceRace?.roleReloadAfterRace
            ?.concurrentRouteStatus ?? null,
        livePhase:
          hardening.concurrentHostDeadlineAdvanceRace?.roleReloadAfterRace
            ?.livePhaseAfterReload ?? null,
        concurrentPhase:
          hardening.concurrentHostDeadlineAdvanceRace?.roleReloadAfterRace
            ?.concurrentPhaseAfterReload ?? null,
        apiPhase:
          hardening.concurrentHostDeadlineAdvanceRace?.roleReloadAfterRace
            ?.apiPhaseAfterReload?.phase_id ?? null,
        apiDeadline:
          hardening.concurrentHostDeadlineAdvanceRace?.roleReloadAfterRace
            ?.apiPhaseAfterReload?.deadline ?? null,
        passed:
          hardening.concurrentHostDeadlineAdvanceRace?.status === "passed" &&
          hardening.concurrentHostDeadlineAdvanceRace?.roleReloadAfterRace
            ?.status === "passed" &&
          hardening.concurrentHostDeadlineAdvanceRace?.roleReloadAfterRace
            ?.liveRouteStatus === 200 &&
          hardening.concurrentHostDeadlineAdvanceRace?.roleReloadAfterRace
            ?.concurrentRouteStatus === 200 &&
          hardening.concurrentHostDeadlineAdvanceRace?.roleReloadAfterRace
            ?.livePhaseAfterReload?.id === "N01" &&
          hardening.concurrentHostDeadlineAdvanceRace?.roleReloadAfterRace
            ?.livePhaseAfterReload?.locked === false &&
          hardening.concurrentHostDeadlineAdvanceRace?.roleReloadAfterRace
            ?.livePhaseAfterReload?.deadline === null &&
          hardening.concurrentHostDeadlineAdvanceRace?.roleReloadAfterRace
            ?.concurrentPhaseAfterReload?.id === "N01" &&
          hardening.concurrentHostDeadlineAdvanceRace?.roleReloadAfterRace
            ?.concurrentPhaseAfterReload?.locked === false &&
          hardening.concurrentHostDeadlineAdvanceRace?.roleReloadAfterRace
            ?.concurrentPhaseAfterReload?.deadline === null &&
          hardening.concurrentHostDeadlineAdvanceRace?.roleReloadAfterRace
            ?.livePhaseActionsAfterReload?.includes(hostResolvePhaseActionId) === true &&
          hardening.concurrentHostDeadlineAdvanceRace?.roleReloadAfterRace
            ?.livePhaseActionsAfterReload?.includes(hostLockThreadActionId) === true &&
          hardening.concurrentHostDeadlineAdvanceRace?.roleReloadAfterRace
            ?.livePhaseActionsAfterReload?.includes(hostAdvancePhaseActionId) === false &&
          hardening.concurrentHostDeadlineAdvanceRace?.roleReloadAfterRace
            ?.livePhaseActionsAfterReload?.includes(hostUnlockThreadActionId) === false &&
          hardening.concurrentHostDeadlineAdvanceRace?.roleReloadAfterRace
            ?.livePhaseActionsAfterReload?.includes(hostAdvanceByDeadlineActionId) ===
            false &&
          hardening.concurrentHostDeadlineAdvanceRace?.roleReloadAfterRace
            ?.concurrentPhaseActionsAfterReload?.includes(hostResolvePhaseActionId) ===
            true &&
          hardening.concurrentHostDeadlineAdvanceRace?.roleReloadAfterRace
            ?.concurrentPhaseActionsAfterReload?.includes(hostLockThreadActionId) === true &&
          hardening.concurrentHostDeadlineAdvanceRace?.roleReloadAfterRace
            ?.concurrentPhaseActionsAfterReload?.includes(hostAdvancePhaseActionId) ===
            false &&
          hardening.concurrentHostDeadlineAdvanceRace?.roleReloadAfterRace
            ?.concurrentPhaseActionsAfterReload?.includes(hostUnlockThreadActionId) ===
            false &&
          hardening.concurrentHostDeadlineAdvanceRace?.roleReloadAfterRace
            ?.concurrentPhaseActionsAfterReload?.includes(
              hostAdvanceByDeadlineActionId,
            ) === false &&
          hardening.concurrentHostDeadlineAdvanceRace?.roleReloadAfterRace
            ?.liveDeadlineActionsAfterReload?.includes(hostExtendDeadlineActionId) === true &&
          hardening.concurrentHostDeadlineAdvanceRace?.roleReloadAfterRace
            ?.concurrentDeadlineActionsAfterReload?.includes(hostExtendDeadlineActionId) ===
            true &&
          hardening.concurrentHostDeadlineAdvanceRace?.roleReloadAfterRace
            ?.apiPhaseAfterReload?.phase_id === "N01" &&
          hardening.concurrentHostDeadlineAdvanceRace?.roleReloadAfterRace
            ?.apiPhaseAfterReload?.locked === false &&
          hardening.concurrentHostDeadlineAdvanceRace?.roleReloadAfterRace
            ?.apiPhaseAfterReload?.deadline === null,
      },
    ),
    lane(
      "concurrent-host-mixed-advance-race",
      "Concurrent host mixed advance commands converge",
      {
        ackRaceRole: hardening.concurrentHostMixedAdvanceRace?.ackRaceRole ?? null,
        rejectRaceRole:
          hardening.concurrentHostMixedAdvanceRace?.rejectRaceRole ?? null,
        ackActionId: hardening.concurrentHostMixedAdvanceRace?.ackActionId ?? null,
        rejectActionId:
          hardening.concurrentHostMixedAdvanceRace?.rejectActionId ?? null,
        game: hardening.concurrentHostMixedAdvanceRace?.game ?? null,
        ackState: hardening.concurrentHostMixedAdvanceRace?.ack?.state ?? null,
        rejectError: hardening.concurrentHostMixedAdvanceRace?.reject?.error ?? null,
        phaseAfterRace:
          hardening.concurrentHostMixedAdvanceRace?.apiPhaseAfterRace?.phase_id ??
          null,
        passed:
          hardening.concurrentHostMixedAdvanceRace?.status === "passed" &&
          hardening.concurrentHostMixedAdvanceRace?.setup?.stalePhase?.id ===
            "D01" &&
          hardening.concurrentHostMixedAdvanceRace?.setup?.stalePhase?.locked ===
            true &&
          typeof hardening.concurrentHostMixedAdvanceRace?.setup?.stalePhase
            ?.deadline === "number" &&
          hardening.concurrentHostMixedAdvanceRace?.setup?.visibleActions?.includes(
            hostAdvancePhaseActionId,
          ) === true &&
          hardening.concurrentHostMixedAdvanceRace?.setup?.visibleActions?.includes(
            hostAdvanceByDeadlineActionId,
          ) === true &&
          ["normal", "deadline"].includes(
            hardening.concurrentHostMixedAdvanceRace?.ackRaceRole,
          ) &&
          ["normal", "deadline"].includes(
            hardening.concurrentHostMixedAdvanceRace?.rejectRaceRole,
          ) &&
          hardening.concurrentHostMixedAdvanceRace?.ackRaceRole !==
            hardening.concurrentHostMixedAdvanceRace?.rejectRaceRole &&
          [hostAdvancePhaseActionId, hostAdvanceByDeadlineActionId].includes(
            hardening.concurrentHostMixedAdvanceRace?.ackActionId,
          ) &&
          [hostAdvancePhaseActionId, hostAdvanceByDeadlineActionId].includes(
            hardening.concurrentHostMixedAdvanceRace?.rejectActionId,
          ) &&
          hardening.concurrentHostMixedAdvanceRace?.ackActionId !==
            hardening.concurrentHostMixedAdvanceRace?.rejectActionId &&
          hardening.concurrentHostMixedAdvanceRace?.ack?.state === "ack" &&
          hardening.concurrentHostMixedAdvanceRace?.ack?.serverEnvelope?.body
            ?.kind === "Ack" &&
          Array.isArray(
            hardening.concurrentHostMixedAdvanceRace?.ack?.streamSeqs,
          ) &&
          (hardening.concurrentHostMixedAdvanceRace?.ackActionId ===
          hostAdvancePhaseActionId
            ? hardening.concurrentHostMixedAdvanceRace.ack.streamSeqs.length === 1
            : hardening.concurrentHostMixedAdvanceRace.ack.streamSeqs.length ===
              2) &&
          hardening.concurrentHostMixedAdvanceRace?.reject?.state === "reject" &&
          hardening.concurrentHostMixedAdvanceRace?.reject?.error ===
            "InvalidTarget" &&
          hardening.concurrentHostMixedAdvanceRace?.reject?.serverEnvelope?.body
            ?.kind === "Reject" &&
          Array.isArray(
            hardening.concurrentHostMixedAdvanceRace?.reject?.streamSeqs,
          ) === false &&
          (hardening.concurrentHostMixedAdvanceRace?.rejectActionId ===
          hostAdvancePhaseActionId
            ? hardening.concurrentHostMixedAdvanceRace?.reject?.message?.includes(
                "stale phase state",
              ) === true
            : hardening.concurrentHostMixedAdvanceRace?.reject?.message?.includes(
                "deadline target is stale",
              ) === true) &&
          hardening.concurrentHostMixedAdvanceRace?.ack?.commandId !==
            hardening.concurrentHostMixedAdvanceRace?.reject?.commandId &&
          typeof hardening.concurrentHostMixedAdvanceRace?.game === "string" &&
          hardening.concurrentHostMixedAdvanceRace.game.length > 0 &&
          hardening.concurrentHostMixedAdvanceRace?.normalOutcome?.requestEnvelope
            ?.body?.body?.command?.AdvancePhase?.game ===
            hardening.concurrentHostMixedAdvanceRace?.game &&
          hardening.concurrentHostMixedAdvanceRace?.deadlineOutcome?.requestEnvelope
            ?.body?.body?.command?.AdvancePhaseByDeadline?.game ===
            hardening.concurrentHostMixedAdvanceRace?.game &&
          hardening.concurrentHostMixedAdvanceRace?.deadlineOutcome?.requestEnvelope
            ?.body?.body?.command?.AdvancePhaseByDeadline?.phase === "D01" &&
          hardening.concurrentHostMixedAdvanceRace?.deadlineOutcome?.requestEnvelope
            ?.body?.body?.command?.AdvancePhaseByDeadline?.observed_at ===
            hardening.concurrentHostMixedAdvanceRace?.setup?.stalePhase?.deadline +
              1 &&
          hardening.concurrentHostMixedAdvanceRace?.normalPhaseAfterRace?.id ===
            "N01" &&
          hardening.concurrentHostMixedAdvanceRace?.normalPhaseAfterRace?.locked ===
            false &&
          hardening.concurrentHostMixedAdvanceRace?.normalPhaseAfterRace
            ?.deadline === null &&
          hardening.concurrentHostMixedAdvanceRace?.deadlinePhaseAfterRace?.id ===
            "N01" &&
          hardening.concurrentHostMixedAdvanceRace?.deadlinePhaseAfterRace
            ?.locked === false &&
          hardening.concurrentHostMixedAdvanceRace?.deadlinePhaseAfterRace
            ?.deadline === null &&
          hardening.concurrentHostMixedAdvanceRace?.normalPhaseActionsAfterRace?.includes(
            hostResolvePhaseActionId,
          ) === true &&
          hardening.concurrentHostMixedAdvanceRace?.normalPhaseActionsAfterRace?.includes(
            hostLockThreadActionId,
          ) === true &&
          hardening.concurrentHostMixedAdvanceRace?.normalPhaseActionsAfterRace?.includes(
            hostAdvancePhaseActionId,
          ) === false &&
          hardening.concurrentHostMixedAdvanceRace?.normalPhaseActionsAfterRace?.includes(
            hostAdvanceByDeadlineActionId,
          ) === false &&
          hardening.concurrentHostMixedAdvanceRace?.deadlinePhaseActionsAfterRace?.includes(
            hostResolvePhaseActionId,
          ) === true &&
          hardening.concurrentHostMixedAdvanceRace?.deadlinePhaseActionsAfterRace?.includes(
            hostLockThreadActionId,
          ) === true &&
          hardening.concurrentHostMixedAdvanceRace?.deadlinePhaseActionsAfterRace?.includes(
            hostAdvancePhaseActionId,
          ) === false &&
          hardening.concurrentHostMixedAdvanceRace?.deadlinePhaseActionsAfterRace?.includes(
            hostAdvanceByDeadlineActionId,
          ) === false &&
          hardening.concurrentHostMixedAdvanceRace?.normalActivityRow?.actionId ===
            hostAdvancePhaseActionId &&
          hardening.concurrentHostMixedAdvanceRace?.deadlineActivityRow?.actionId ===
            hostAdvanceByDeadlineActionId &&
          hardening.concurrentHostMixedAdvanceRace?.apiPhaseAfterRace?.phase_id ===
            "N01" &&
          hardening.concurrentHostMixedAdvanceRace?.apiPhaseAfterRace?.locked ===
            false &&
          hardening.concurrentHostMixedAdvanceRace?.apiPhaseAfterRace?.deadline ===
            null,
      },
    ),
    lane(
      "concurrent-host-mixed-advance-race-reload",
      "Concurrent host mixed advance race reloads open host projections",
      {
        game: hardening.concurrentHostMixedAdvanceRace?.game ?? null,
        normalRouteStatus:
          hardening.concurrentHostMixedAdvanceRace?.roleReloadAfterRace
            ?.normalRouteStatus ?? null,
        deadlineRouteStatus:
          hardening.concurrentHostMixedAdvanceRace?.roleReloadAfterRace
            ?.deadlineRouteStatus ?? null,
        normalPhase:
          hardening.concurrentHostMixedAdvanceRace?.roleReloadAfterRace
            ?.normalPhaseAfterReload ?? null,
        deadlinePhase:
          hardening.concurrentHostMixedAdvanceRace?.roleReloadAfterRace
            ?.deadlinePhaseAfterReload ?? null,
        apiPhase:
          hardening.concurrentHostMixedAdvanceRace?.roleReloadAfterRace
            ?.apiPhaseAfterReload?.phase_id ?? null,
        apiDeadline:
          hardening.concurrentHostMixedAdvanceRace?.roleReloadAfterRace
            ?.apiPhaseAfterReload?.deadline ?? null,
        passed:
          hardening.concurrentHostMixedAdvanceRace?.status === "passed" &&
          hardening.concurrentHostMixedAdvanceRace?.roleReloadAfterRace?.status ===
            "passed" &&
          hardening.concurrentHostMixedAdvanceRace?.roleReloadAfterRace
            ?.normalRouteStatus === 200 &&
          hardening.concurrentHostMixedAdvanceRace?.roleReloadAfterRace
            ?.deadlineRouteStatus === 200 &&
          hardening.concurrentHostMixedAdvanceRace?.roleReloadAfterRace
            ?.normalPhaseAfterReload?.id === "N01" &&
          hardening.concurrentHostMixedAdvanceRace?.roleReloadAfterRace
            ?.normalPhaseAfterReload?.locked === false &&
          hardening.concurrentHostMixedAdvanceRace?.roleReloadAfterRace
            ?.normalPhaseAfterReload?.deadline === null &&
          hardening.concurrentHostMixedAdvanceRace?.roleReloadAfterRace
            ?.deadlinePhaseAfterReload?.id === "N01" &&
          hardening.concurrentHostMixedAdvanceRace?.roleReloadAfterRace
            ?.deadlinePhaseAfterReload?.locked === false &&
          hardening.concurrentHostMixedAdvanceRace?.roleReloadAfterRace
            ?.deadlinePhaseAfterReload?.deadline === null &&
          hardening.concurrentHostMixedAdvanceRace?.roleReloadAfterRace
            ?.normalPhaseActionsAfterReload?.includes(hostResolvePhaseActionId) === true &&
          hardening.concurrentHostMixedAdvanceRace?.roleReloadAfterRace
            ?.normalPhaseActionsAfterReload?.includes(hostLockThreadActionId) === true &&
          hardening.concurrentHostMixedAdvanceRace?.roleReloadAfterRace
            ?.normalPhaseActionsAfterReload?.includes(hostAdvancePhaseActionId) === false &&
          hardening.concurrentHostMixedAdvanceRace?.roleReloadAfterRace
            ?.normalPhaseActionsAfterReload?.includes(hostUnlockThreadActionId) === false &&
          hardening.concurrentHostMixedAdvanceRace?.roleReloadAfterRace
            ?.normalPhaseActionsAfterReload?.includes(
              hostAdvanceByDeadlineActionId,
            ) === false &&
          hardening.concurrentHostMixedAdvanceRace?.roleReloadAfterRace
            ?.deadlinePhaseActionsAfterReload?.includes(hostResolvePhaseActionId) ===
            true &&
          hardening.concurrentHostMixedAdvanceRace?.roleReloadAfterRace
            ?.deadlinePhaseActionsAfterReload?.includes(hostLockThreadActionId) === true &&
          hardening.concurrentHostMixedAdvanceRace?.roleReloadAfterRace
            ?.deadlinePhaseActionsAfterReload?.includes(hostAdvancePhaseActionId) ===
            false &&
          hardening.concurrentHostMixedAdvanceRace?.roleReloadAfterRace
            ?.deadlinePhaseActionsAfterReload?.includes(hostUnlockThreadActionId) ===
            false &&
          hardening.concurrentHostMixedAdvanceRace?.roleReloadAfterRace
            ?.deadlinePhaseActionsAfterReload?.includes(
              hostAdvanceByDeadlineActionId,
            ) === false &&
          hardening.concurrentHostMixedAdvanceRace?.roleReloadAfterRace
            ?.normalDeadlineActionsAfterReload?.includes(hostExtendDeadlineActionId) ===
            true &&
          hardening.concurrentHostMixedAdvanceRace?.roleReloadAfterRace
            ?.deadlineDeadlineActionsAfterReload?.includes(hostExtendDeadlineActionId) ===
            true &&
          hardening.concurrentHostMixedAdvanceRace?.roleReloadAfterRace
            ?.apiPhaseAfterReload?.phase_id === "N01" &&
          hardening.concurrentHostMixedAdvanceRace?.roleReloadAfterRace
            ?.apiPhaseAfterReload?.locked === false &&
          hardening.concurrentHostMixedAdvanceRace?.roleReloadAfterRace
            ?.apiPhaseAfterReload?.deadline === null,
      },
    ),
    ...hostPhaseStaleControlLanes({ hardening, session }),
    ...cohostDeadlineStaleControlLanes({ hardening, session }),
  ];
  const status = lanes.every((item) => item.status === "passed") ? "passed" : "failed";
  const coreLoopSpine = buildCoreLoopSpineSummary({ session, verification });
  const completedGameHardeningCoverage =
    buildCompletedGameHardeningCoverage(lanes);
  const hostStaleControlCoverage =
    buildHostStaleControlCoverageSummary(lanes);
  const staleConflictMessageCoverage =
    buildStaleConflictMessageCoverageSummary(lanes);
  const coreLoopPrivateChannelRecoveryCoverage =
    buildCoreLoopPrivateChannelRecoveryCoverageSummary(lanes);
  const replacementPrivateChannelRecoveryCoverage =
    buildReplacementPrivateChannelRecoveryCoverageSummary(lanes);
  const replacementActionRecoveryCoverage =
    buildReplacementActionRecoveryCoverageSummary(lanes);
  const replacementHandoffRecoveryCoverage =
    buildReplacementHandoffRecoveryCoverageSummary(lanes);
  return {
    version: DEV_TEST_GAME_PROOF_VERSION,
    proof: "dev-test-game-proof-run",
    status,
    generatedAt,
    productionReady: false,
    releaseReady: false,
    scope: "local-dev-test-game-harness",
    artifacts: {
      sessionJson: "target/dev-test-game/session.json",
      sessionMarkdown: "target/dev-test-game/session.md",
      proofRun: "target/dev-test-game/proof-run.json",
    },
    session: {
      name: session?.name ?? null,
      game: session?.game ?? null,
      seedMode: session?.seedMode ?? null,
      frontendBaseUrl: session?.frontendBaseUrl ?? null,
      apiBaseUrl: session?.apiBaseUrl ?? null,
      verificationStatus: verification.status ?? null,
      roles: verification.roles ?? [],
    },
    identityBootstrap: session?.identityBootstrap ?? null,
    coreLoopSpine,
    completedGameHardeningCoverage,
    hostStaleControlCoverage,
    staleConflictMessageCoverage,
    coreLoopPrivateChannelRecoveryCoverage,
    replacementPrivateChannelRecoveryCoverage,
    replacementActionRecoveryCoverage,
    replacementHandoffRecoveryCoverage,
    lanes,
    nonClaims: [
      "production account identity",
      "hosted deployment",
      "exhaustive race coverage",
      "backup/restore",
      "beta or release readiness",
    ],
    proofBoundary:
      "Local Rust API plus SvelteKit browser proof over one seeded mafiascum game. Passing means the local development-spine role URLs exercised the recorded lanes; it does not prove production identity, hosted deployment, exhaustive races, backup/restore, or release readiness.",
  };
}

export function assertDevTestGameProofRun(proof) {
  if (proof?.version !== DEV_TEST_GAME_PROOF_VERSION) {
    throw new Error(`dev-test-game proof version drifted: ${proof?.version}`);
  }
  if (proof.proof !== "dev-test-game-proof-run") {
    throw new Error(`unexpected dev-test-game proof id: ${proof.proof}`);
  }
  if (proof.status !== "passed") {
    const failed = (proof.lanes ?? [])
      .filter((check) => check.status !== "passed")
      .map((check) => check.id)
      .join(", ");
    throw new Error(`dev-test-game proof failed: ${failed}`);
  }
  if (proof.productionReady !== false || proof.releaseReady !== false) {
    throw new Error("dev-test-game proof must not claim production or release readiness");
  }
  if (
    proof.identityBootstrap?.status !== "passed" ||
    proof.identityBootstrap?.devSessionEndpointEnabled !== false ||
    proof.identityBootstrap?.rootSessionSource !== "auth_session" ||
    proof.identityBootstrap?.browserCredentialIssuer !== "/auth/session-grants" ||
    proof.identityBootstrap?.rawRootTokenStored !== false ||
    !proof.identityBootstrap?.rootCapabilityKinds?.includes("GlobalAdmin")
  ) {
    throw new Error(
      "dev-test-game proof must bootstrap identity through auth_session with /auth/dev-session disabled",
    );
  }
  assertCoreLoopSpineSummary(proof.coreLoopSpine);
  assertCompletedGameHardeningCoverageSummary({
    summary: proof.completedGameHardeningCoverage,
    lanes: proof.lanes,
  });
  assertHostStaleControlCoverageSummary({
    summary: proof.hostStaleControlCoverage,
    lanes: proof.lanes,
  });
  assertStaleConflictMessageCoverageSummary({
    summary: proof.staleConflictMessageCoverage,
    lanes: proof.lanes,
  });
  assertCoreLoopPrivateChannelRecoveryCoverageSummary({
    summary: proof.coreLoopPrivateChannelRecoveryCoverage,
    lanes: proof.lanes,
  });
  assertReplacementPrivateChannelRecoveryCoverageSummary({
    summary: proof.replacementPrivateChannelRecoveryCoverage,
    lanes: proof.lanes,
  });
  assertReplacementActionRecoveryCoverageSummary({
    summary: proof.replacementActionRecoveryCoverage,
    lanes: proof.lanes,
  });
  assertReplacementHandoffRecoveryCoverageSummary({
    summary: proof.replacementHandoffRecoveryCoverage,
    lanes: proof.lanes,
  });
  for (const laneId of requiredLaneIds) {
    if (!proof.lanes?.some((laneItem) => laneItem.id === laneId && laneItem.status === "passed")) {
      throw new Error(`dev-test-game proof missing passed lane: ${laneId}`);
    }
  }
  return proof;
}

function normalizedPrivateChannelSubmitPostAckProofPassed(proof) {
  if (proof === null || typeof proof !== "object") {
    return false;
  }
  const ackSeq = ackSeqFromCommandStatus(proof.commandStatus);
  if (!Number.isInteger(ackSeq)) {
    return false;
  }
  try {
    assertPrivateChannelSubmitPostProofCase({
      proof,
      expectedGame: proof.command?.game,
      scenario: {
        ...privateChannelSubmitPostScenario(),
        channelId: proof.command?.channel_id,
        actorSlot: proof.command?.actor_slot,
        postBody: proof.privatePostBody,
        ackSeq,
        expectedRefreshKeys: proof.bridgePlan?.projectionRefreshKeys ?? [],
      },
    });
    return true;
  } catch {
    return false;
  }
}

function normalizedCompletedPrivateChannelPostRejectProofPassed(proof) {
  if (proof === null || typeof proof !== "object") {
    return false;
  }
  const scenario = {
    ...staleCompletedPrivatePostScenario(),
    channelId: proof.command?.channel_id,
    actorSlot: proof.command?.actor_slot,
    stalePostBody: proof.stalePrivatePostBody,
    expectedRefreshKeys: proof.bridgePlan?.projectionRefreshKeys ?? [],
  };
  try {
    assertStaleCompletedPrivatePostRecoveryProofCase({
      proof,
      expectedGame: proof.command?.game,
      sourceRoleUrl: proof.sourceRoleUrl,
      visitedRolePath: proof.visitedRolePath,
      scenario,
      completedReloadScenario:
        completedPrivateChannelReloadScenarioForNormalizedProof(proof, scenario),
    });
    return true;
  } catch {
    return false;
  }
}

function completedPrivateChannelReloadScenarioForNormalizedProof(proof, scenario) {
  const snapshot = proof.snapshotAfterReject ?? proof.snapshotAfterReload ?? {};
  const base = completedPrivateChannelReloadScenario();
  return {
    ...base,
    channelId: scenario.channelId,
    actorSlot: scenario.actorSlot,
    actorStatus: snapshot.channelContext?.actorStatus ?? base.actorStatus,
    completedPhaseId: snapshot.checkpoint?.phaseId ?? base.completedPhaseId,
    completedPhaseState:
      snapshot.checkpoint?.phaseState ?? base.completedPhaseState,
    completedActionState:
      snapshot.checkpoint?.actionState ?? base.completedActionState,
    completedThreadBody:
      snapshot.threadPostBodies?.[0] ?? base.completedThreadBody,
  };
}

function ackSeqFromCommandStatus(commandStatus) {
  const streamSeq = commandStatus?.streamSeqs?.[0];
  if (Number.isInteger(streamSeq)) {
    return streamSeq;
  }
  const match = String(commandStatus?.message ?? "").match(/Ack: stream seqs (\d+)/);
  return match === null ? undefined : Number.parseInt(match[1], 10);
}

function buildCompletedGameHardeningCoverage(lanes) {
  const laneById = new Map(lanes.map((laneItem) => [laneItem.id, laneItem]));
  const cases = completedGameHardeningLaneCases();
  const laneStatuses = cases.map((scenario) => {
    const laneItem = laneById.get(scenario.id);
    return {
      id: scenario.id,
      family: scenario.family,
      seedGroup: scenario.seedGroup,
      status: String(laneItem?.status ?? "missing"),
    };
  });
  const familyIds = [...new Set(cases.map((scenario) => scenario.family))];
  const families = familyIds.map((familyId) => {
    const familyCases = cases.filter((scenario) => scenario.family === familyId);
    const familyLaneIds = familyCases.map((scenario) => scenario.id);
    const passedLaneIds = familyLaneIds.filter(
      (id) => laneById.get(id)?.status === "passed",
    );
    return {
      id: familyId,
      status:
        passedLaneIds.length === familyLaneIds.length ? "passed" : "failed",
      laneIds: familyLaneIds,
      passedLaneIds,
      requiredLaneIds: familyCases
        .filter((scenario) => scenario.seedGroup === "required")
        .map((scenario) => scenario.id),
      demoOnlyLaneIds: familyCases
        .filter((scenario) => scenario.seedGroup === "demo-only")
        .map((scenario) => scenario.id),
    };
  });
  const passedLaneCount = laneStatuses.filter(
    (laneStatus) => laneStatus.status === "passed",
  ).length;
  const expectedLaneCount = cases.length;
  const expectedFamilyCount = familyIds.length;
  return {
    status: passedLaneCount === expectedLaneCount ? "passed" : "failed",
    laneCount: cases.length,
    passedLaneCount,
    familyCount: families.length,
    expectedLaneCount,
    expectedFamilyCount,
    sourceLaneIds: cases.map((scenario) => scenario.id),
    laneStatuses,
    families,
  };
}

function assertCompletedGameHardeningCoverageSummary({ summary, lanes }) {
  const laneById = new Map((lanes ?? []).map((laneItem) => [laneItem.id, laneItem]));
  const cases = completedGameHardeningLaneCases();
  const expectedLaneIds = cases.map((scenario) => scenario.id);
  const expectedFamilyCount = new Set(
    cases.map((scenario) => scenario.family),
  ).size;
  if (
    summary?.status !== "passed" ||
    summary.laneCount !== expectedLaneIds.length ||
    summary.passedLaneCount !== expectedLaneIds.length ||
    summary.familyCount !== expectedFamilyCount ||
    summary.expectedLaneCount !== expectedLaneIds.length ||
    summary.expectedFamilyCount !== expectedFamilyCount ||
    !sameArray(summary.sourceLaneIds, expectedLaneIds)
  ) {
    throw new Error("completed-game hardening coverage summary drifted");
  }
  for (const scenario of cases) {
    const laneStatus = summary.laneStatuses?.find(
      (candidate) => candidate.id === scenario.id,
    );
    if (
      laneById.get(scenario.id)?.status !== "passed" ||
      laneStatus?.status !== "passed" ||
      laneStatus.family !== scenario.family ||
      laneStatus.seedGroup !== scenario.seedGroup
    ) {
      throw new Error(
        `completed-game hardening coverage missing passed lane: ${scenario.id}`,
      );
    }
  }
  for (const family of summary.families ?? []) {
    const familyCases = cases.filter((scenario) => scenario.family === family.id);
    if (
      family.status !== "passed" ||
      !sameArray(
        family.laneIds,
        familyCases.map((scenario) => scenario.id),
      ) ||
      !sameArray(
        family.requiredLaneIds,
        familyCases
          .filter((scenario) => scenario.seedGroup === "required")
          .map((scenario) => scenario.id),
      ) ||
      !sameArray(
        family.demoOnlyLaneIds,
        familyCases
          .filter((scenario) => scenario.seedGroup === "demo-only")
          .map((scenario) => scenario.id),
      )
    ) {
      throw new Error(
        `completed-game hardening coverage family drifted: ${family.id}`,
      );
    }
  }
}

function buildCoreLoopSpineSummary({ session, verification }) {
  const actionLoop = verification.actionLoop ?? {};
  const dayNight = actionLoop.dayNightTransition ?? {};
  const nightResolution = actionLoop.nightResolutionTransition ?? {};
  const d02VoteNight = actionLoop.d02VoteNightTransition ?? {};
  const cycles = [
    {
      id: "d01-n01-d02",
      game: session?.game ?? null,
      roleUrls: {
        host: dayNight.hostRoleUrl ?? null,
        actionPlayer: dayNight.actionRoleUrl ?? null,
        normalPlayer: dayNight.normalPlayerRoleUrl ?? null,
        target: nightResolution.targetRoleUrl ?? null,
        privateChannel: verification.privateChannel?.allowed?.url ?? null,
      },
      checkpoints: [
        {
          id: "d01-resolved-locked",
          phase: dayNight.dayLockedActionSurface?.commandState?.phase?.phaseId ?? null,
          locked: dayNight.dayLockedActionSurface?.commandState?.phase?.locked ?? null,
          resolveState: dayNight.resolveDayState ?? null,
          submitActionControls: countButtonsWithPrefix(
            dayNight.dayLockedActionSurface?.buttons,
            "submit_action",
          ),
          submitVoteControls: countButtonsWithPrefix(
            dayNight.dayLockedActionSurface?.buttons,
            "submit_vote",
          ),
        },
        {
          id: "n01-action-open",
          phase:
            dayNight.nightActionSurface?.commandState?.phase?.phaseId ?? null,
          locked:
            dayNight.nightActionSurface?.commandState?.phase?.locked ?? null,
          advanceState: dayNight.advanceNightState ?? null,
          actionTemplate: firstActionTemplate(
            dayNight.nightActionSurface?.commandState?.actions,
          ),
          actionButtonVisible: hasEnabledButton(
            dayNight.nightActionSurface?.buttons,
            "submit_action:factional_kill",
          ),
          normalPlayerActionCount:
            dayNight.normalPlayerNightSurface?.commandActions?.length ?? null,
          normalPlayerDirectReject:
            dayNight.normalPlayerNightSurface?.directRejectError ?? null,
        },
        {
          id: "n01-resolved-target-killed",
          resolveState: nightResolution.resolveNightState ?? null,
          targetSlot: nightResolution.legalActionTarget ?? null,
          targetAlive: nightResolution.resolvedTargetSlot?.alive ?? null,
          targetStatus: nightResolution.resolvedTargetSlot?.status ?? null,
          receiptStatus:
            nightResolution.targetReceiptSurface?.targetNotice?.status ?? null,
          receiptEffect:
            nightResolution.targetReceiptSurface?.targetNotice?.effect ?? null,
        },
        {
          id: "d02-day-controls-return",
          phase:
            nightResolution.d02ActionSurface?.commandState?.phase?.phaseId ?? null,
          locked:
            nightResolution.d02ActionSurface?.commandState?.phase?.locked ?? null,
          advanceState: nightResolution.advanceDayState ?? null,
          actionSubmitControls: countButtonsWithPrefix(
            nightResolution.d02ActionSurface?.buttons,
            "submit_action",
          ),
          actionVoteControls: countButtonsWithPrefix(
            nightResolution.d02ActionSurface?.buttons,
            "submit_vote",
          ),
          normalVoteControls: countButtonsWithPrefix(
            nightResolution.d02NormalPlayerSurface?.buttons,
            "submit_vote",
          ),
        },
      ],
    },
    {
      id: "d02-n02",
      game: d02VoteNight.game ?? null,
      roleUrls: {
        host: d02VoteNight.hostRoleUrl ?? null,
        actionPlayer: d02VoteNight.actionRoleUrl ?? null,
        normalPlayer: d02VoteNight.playerRoleUrl ?? null,
        target: d02VoteNight.targetRoleUrl ?? null,
      },
      checkpoints: [
        {
          id: "d02-vote-open",
          phase: d02VoteNight.hostBeforeVote?.phase?.id ?? null,
          locked: d02VoteNight.hostBeforeVote?.phase?.locked ?? null,
          voteTarget: d02VoteNight.voteTarget?.slotId ?? null,
          actionPlayerCurrentVote:
            d02VoteNight.actionBeforeVote?.commandState?.currentVote ?? null,
          actionPlayerVoteControls: countButtonsWithPrefix(
            d02VoteNight.actionBeforeVote?.buttons,
            "submit_vote",
          ),
        },
        {
          id: "d02-deciding-vote-submitted",
          voteState: d02VoteNight.finalVote?.state ?? null,
          actorSlot:
            d02VoteNight.finalVote?.requestEnvelope?.body?.body?.command
              ?.SubmitVote?.actor_slot ?? null,
          targetSlot:
            d02VoteNight.finalVote?.requestEnvelope?.body?.body?.command
              ?.SubmitVote?.target?.Slot ?? null,
          projectedCount: d02VoteNight.apiVoteRow?.count ?? null,
        },
        {
          id: "d02-resolved-target-killed",
          resolveState: d02VoteNight.resolveD02?.commandStatus?.state ?? null,
          phase: d02VoteNight.hostAfterResolve?.phase?.id ?? null,
          locked: d02VoteNight.hostAfterResolve?.phase?.locked ?? null,
          outcomeStatus: d02VoteNight.dayVoteOutcome?.status ?? null,
          winnerSlot: d02VoteNight.dayVoteOutcome?.winnerSlot ?? null,
          targetAlive: d02VoteNight.hostSlotAfterResolve?.alive ?? null,
          receiptStatus:
            d02VoteNight.targetReceiptSurface?.targetNotice?.status ?? null,
        },
        {
          id: "n02-action-open",
          advanceState: d02VoteNight.advanceN02?.commandStatus?.state ?? null,
          phase:
            d02VoteNight.n02ActionSurface?.commandState?.phase?.phaseId ?? null,
          locked:
            d02VoteNight.n02ActionSurface?.commandState?.phase?.locked ?? null,
          actionTemplate: firstActionTemplate(
            d02VoteNight.n02ActionSurface?.commandState?.actions,
          ),
          actionButtonVisible: hasEnabledButton(
            d02VoteNight.n02ActionSurface?.buttons,
            "submit_action:factional_kill",
          ),
          normalPlayerFactionalKillVisible:
            d02VoteNight.n02NormalPlayerSurface?.factionalKillVisible ?? null,
        },
      ],
    },
    {
      id: "n02-d03",
      game: d02VoteNight.game ?? null,
      roleUrls: {
        host: d02VoteNight.hostRoleUrl ?? null,
        actionPlayer: d02VoteNight.actionRoleUrl ?? null,
        normalPlayer: d02VoteNight.playerRoleUrl ?? null,
      },
      checkpoints: [
        {
          id: "n02-action-open",
          phase:
            d02VoteNight.n02ActionSurface?.commandState?.phase?.phaseId ?? null,
          locked:
            d02VoteNight.n02ActionSurface?.commandState?.phase?.locked ?? null,
          actionTemplate: firstActionTemplate(
            d02VoteNight.n02ActionSurface?.commandState?.actions,
          ),
          actionTarget: d02VoteNight.n02ActionTarget ?? null,
          actionButtonVisible: hasEnabledButton(
            d02VoteNight.n02ActionSurface?.buttons,
            "submit_action:factional_kill",
          ),
        },
        {
          id: "n02-action-submitted",
          actionState: d02VoteNight.n02ActionSubmission?.state ?? null,
          actorSlot:
            d02VoteNight.n02ActionSubmission?.requestEnvelope?.body?.body?.command
              ?.SubmitAction?.actor_slot ?? null,
          templateId:
            d02VoteNight.n02ActionSubmission?.requestEnvelope?.body?.body?.command
              ?.SubmitAction?.template_id ?? null,
          targetSlot:
            d02VoteNight.n02ActionSubmission?.requestEnvelope?.body?.body?.command
              ?.SubmitAction?.targets?.[0] ?? null,
          actionButtonVisible: hasEnabledButton(
            d02VoteNight.n02ActionAfterSubmit?.buttons,
            "submit_action:factional_kill",
          ),
        },
        {
          id: "n02-resolved-target-killed",
          resolveState: d02VoteNight.resolveN02?.commandStatus?.state ?? null,
          phase: d02VoteNight.hostAfterResolveN02?.phase?.id ?? null,
          locked: d02VoteNight.hostAfterResolveN02?.phase?.locked ?? null,
          targetSlot: d02VoteNight.n02ResolvedTargetSlot?.slot_id ?? null,
          targetAlive: d02VoteNight.n02ResolvedTargetSlot?.alive ?? null,
          targetStatus: d02VoteNight.n02ResolvedTargetSlot?.status ?? null,
        },
        {
          id: "d03-day-controls-return",
          advanceState: d02VoteNight.advanceD03?.commandStatus?.state ?? null,
          phase: d02VoteNight.d03ActionSurface?.commandState?.phase?.phaseId ?? null,
          locked:
            d02VoteNight.d03ActionSurface?.commandState?.phase?.locked ?? null,
          actionSubmitControls: countButtonsWithPrefix(
            d02VoteNight.d03ActionSurface?.buttons,
            "submit_action",
          ),
          actionVoteControls: countButtonsWithPrefix(
            d02VoteNight.d03ActionSurface?.buttons,
            "submit_vote",
          ),
          normalVoteControls: countButtonsWithPrefix(
            d02VoteNight.d03NormalPlayerSurface?.buttons,
            "submit_vote",
          ),
        },
        {
          id: "d03-terminal-advance-reject",
          voteState: d02VoteNight.d03TerminalVoteSubmission?.state ?? null,
          voteTarget: d02VoteNight.d03TerminalVoteTarget?.slotId ?? null,
          projectedCount: d02VoteNight.d03TerminalApiVoteRow?.count ?? null,
          resolveState: d02VoteNight.resolveD03?.commandStatus?.state ?? null,
          outcomeStatus: d02VoteNight.d03TerminalDayVoteOutcome?.status ?? null,
          winnerSlot: d02VoteNight.d03TerminalDayVoteOutcome?.winnerSlot ?? null,
          targetAlive: d02VoteNight.d03TerminalResolvedSlot?.alive ?? null,
          targetStatus: d02VoteNight.d03TerminalResolvedSlot?.status ?? null,
          advanceState:
            d02VoteNight.d03TerminalAdvanceReject?.commandStatus?.state ?? null,
          rejectError:
            d02VoteNight.d03TerminalAdvanceReject?.commandStatus?.error ?? null,
          phase: d02VoteNight.hostAfterTerminalAdvanceReject?.phase?.id ?? null,
          locked:
            d02VoteNight.hostAfterTerminalAdvanceReject?.phase?.locked ?? null,
          advanceControlVisible:
            d02VoteNight.hostAfterTerminalAdvanceReject?.phaseActions?.includes(
              "advance_phase",
            ) ?? null,
        },
        {
          id: "d03-terminal-reload-recovery",
          routeResponseStatus:
            d02VoteNight.d03TerminalHostReloadAfterReject?.routeResponseStatus ??
            null,
          rejectReceiptStatus:
            d02VoteNight.d03TerminalHostReloadAfterReject
              ?.rejectReceiptStatusText ?? null,
          phase:
            d02VoteNight.d03TerminalHostReloadAfterReject?.phase?.id ?? null,
          locked:
            d02VoteNight.d03TerminalHostReloadAfterReject?.phase?.locked ?? null,
          outcomeStatus:
            d02VoteNight.d03TerminalHostReloadAfterReject?.dayVoteOutcomes?.find(
              (row) => row.phaseId === "D03",
            )?.status ?? null,
          projectedCount:
            d02VoteNight.d03TerminalHostReloadAfterReject?.dayVoteOutcomes?.find(
              (row) => row.phaseId === "D03",
            )?.tallies?.[d02VoteNight.d03TerminalVoteTarget?.slotId] ?? null,
          advanceControlVisible:
            d02VoteNight.d03TerminalHostReloadAfterReject?.phaseActions?.includes(
              "advance_phase",
            ) ?? null,
          unlockControlVisible:
            d02VoteNight.d03TerminalHostReloadAfterReject?.phaseActions?.includes(
              "unlock_thread",
            ) ?? null,
        },
        {
          id: "d03-revote-prompt-resolved",
          promptId: d02VoteNight.d03RevotePrompt?.id ?? null,
          promptActionId: d02VoteNight.d03RevotePromptActionId ?? null,
          promptStatusBefore:
            d02VoteNight.d03RevotePrompt?.status ?? null,
          resolveState:
            d02VoteNight.d03RevotePromptResolution?.commandStatus?.state ?? null,
          streamSeqCount: Array.isArray(
            d02VoteNight.d03RevotePromptResolution?.commandStatus?.streamSeqs,
          )
            ? d02VoteNight.d03RevotePromptResolution.commandStatus.streamSeqs
                .length
            : null,
          decisionPolicy:
            d02VoteNight.d03RevotePromptResolution?.commandStatus?.requestEnvelope
              ?.body?.body?.command?.ResolveHostPrompt?.decision?.SelectPolicy
              ?.policy ?? null,
          promptStatusAfter:
            d02VoteNight.hostAfterD03RevotePrompt?.hostPrompts?.find(
              (prompt) => prompt.id === d02VoteNight.d03RevotePrompt?.id,
            )?.status ?? null,
          phase: d02VoteNight.hostAfterD03RevotePrompt?.phase?.id ?? null,
          locked:
            d02VoteNight.hostAfterD03RevotePrompt?.phase?.locked ?? null,
          actionVoteControls: countButtonsWithPrefix(
            d02VoteNight.actionAfterD03RevotePrompt?.buttons,
            "submit_vote",
          ),
          normalVoteControls: countButtonsWithPrefix(
            d02VoteNight.normalAfterD03RevotePrompt?.buttons,
            "submit_vote",
          ),
        },
        {
          id: "d03r1-revote-ballot-submitted",
          phase:
            d02VoteNight.d03RevoteActionAfterVote?.commandState?.phase?.phaseId ??
            null,
          locked:
            d02VoteNight.d03RevoteActionAfterVote?.commandState?.phase?.locked ??
            null,
          voteState:
            d02VoteNight.d03RevoteVoteSubmission?.state ?? null,
          actorSlot:
            d02VoteNight.d03RevoteVoteSubmission?.requestEnvelope?.body?.body
              ?.command?.SubmitVote?.actor_slot ?? null,
          voteTarget:
            d02VoteNight.d03RevoteVoteSubmission?.requestEnvelope?.body?.body
              ?.command?.SubmitVote?.target ?? null,
          currentVoteKind:
            d02VoteNight.d03RevoteActionAfterVote?.commandState?.currentVote
              ?.kind ?? null,
          projectedCount:
            d02VoteNight.d03RevoteActionAfterVote?.votecount?.find(
              (row) => row.target === "no_lynch",
            )?.count ?? null,
          apiPhase: d02VoteNight.d03RevoteApiNoLynchRow?.phaseId ?? null,
          apiTarget: d02VoteNight.d03RevoteApiNoLynchRow?.target ?? null,
          apiCount: d02VoteNight.d03RevoteApiNoLynchRow?.count ?? null,
          staleD03Target:
            d02VoteNight.d03RevoteApiOriginalD03Row?.target ?? null,
          staleD03Count:
            d02VoteNight.d03RevoteApiOriginalD03Row?.count ?? null,
          staleD03NoLynchCount:
            d02VoteNight.d03RevoteApiStaleD03NoLynchRow?.count ?? null,
        },
        {
          id: "d03r1-revote-resolved-no-majority",
          phase: d02VoteNight.hostAfterResolveD03R1?.phase?.id ?? null,
          locked:
            d02VoteNight.hostAfterResolveD03R1?.phase?.locked ?? null,
          resolveState:
            d02VoteNight.resolveD03R1?.commandStatus?.state ?? null,
          outcomeStatus:
            d02VoteNight.d03R1DayVoteOutcome?.status ?? null,
          winnerSlot:
            d02VoteNight.d03R1DayVoteOutcome?.winnerSlot ?? null,
          projectedCount:
            d02VoteNight.d03R1DayVoteOutcome?.tallies?.no_lynch ?? null,
          promptId: d02VoteNight.d03R1RevotePrompt?.id ?? null,
          promptActionId: d02VoteNight.d03R1RevotePromptActionId ?? null,
          promptStatusAfter:
            d02VoteNight.d03R1RevotePrompt?.status ?? null,
          originalPromptStatus:
            d02VoteNight.apiPromptsAfterResolveD03R1?.find(
              (prompt) =>
                (prompt.id ?? prompt.prompt_id) ===
                d02VoteNight.d03RevotePrompt?.id,
            )?.status ?? null,
          promptActionVisible:
            d02VoteNight.hostAfterResolveD03R1?.promptActions?.includes(
              d02VoteNight.d03R1RevotePromptActionId,
            ) ?? null,
        },
        {
          id: "d03r2-revote-prompt-resolved",
          promptId: d02VoteNight.d03R1RevotePrompt?.id ?? null,
          promptActionId: d02VoteNight.d03R1RevotePromptActionId ?? null,
          promptStatusBefore:
            d02VoteNight.d03R1RevotePrompt?.status ?? null,
          resolveState:
            d02VoteNight.d03R1RevotePromptResolution?.commandStatus?.state ??
            null,
          streamSeqCount: Array.isArray(
            d02VoteNight.d03R1RevotePromptResolution?.commandStatus?.streamSeqs,
          )
            ? d02VoteNight.d03R1RevotePromptResolution.commandStatus.streamSeqs
                .length
            : null,
          decisionPolicy:
            d02VoteNight.d03R1RevotePromptResolution?.commandStatus
              ?.requestEnvelope?.body?.body?.command?.ResolveHostPrompt?.decision
              ?.SelectPolicy?.policy ?? null,
          promptStatusAfter:
            d02VoteNight.hostAfterD03R1RevotePrompt?.hostPrompts?.find(
              (prompt) => prompt.id === d02VoteNight.d03R1RevotePrompt?.id,
            )?.status ?? null,
          originalPromptStatus:
            d02VoteNight.hostAfterD03R1RevotePrompt?.hostPrompts?.find(
              (prompt) => prompt.id === d02VoteNight.d03RevotePrompt?.id,
            )?.status ?? null,
          phase: d02VoteNight.hostAfterD03R1RevotePrompt?.phase?.id ?? null,
          locked:
            d02VoteNight.hostAfterD03R1RevotePrompt?.phase?.locked ?? null,
          actionVoteControls: countButtonsWithPrefix(
            d02VoteNight.actionAfterD03R1RevotePrompt?.buttons,
            "submit_vote",
          ),
          normalVoteControls: countButtonsWithPrefix(
            d02VoteNight.normalAfterD03R1RevotePrompt?.buttons,
            "submit_vote",
          ),
        },
        {
          id: "d03r2-revote-ballot-submitted",
          phase:
            d02VoteNight.d03R2RevoteActionAfterVote?.commandState?.phase
              ?.phaseId ?? null,
          locked:
            d02VoteNight.d03R2RevoteActionAfterVote?.commandState?.phase
              ?.locked ?? null,
          voteState:
            d02VoteNight.d03R2RevoteVoteSubmission?.state ?? null,
          actorSlot:
            d02VoteNight.d03R2RevoteVoteSubmission?.requestEnvelope?.body?.body
              ?.command?.SubmitVote?.actor_slot ?? null,
          voteTarget:
            d02VoteNight.d03R2RevoteVoteSubmission?.requestEnvelope?.body?.body
              ?.command?.SubmitVote?.target ?? null,
          currentVoteKind:
            d02VoteNight.d03R2RevoteActionAfterVote?.commandState?.currentVote
              ?.kind ?? null,
          projectedCount:
            d02VoteNight.d03R2RevoteActionAfterVote?.votecount?.find(
              (row) => row.target === "no_lynch",
            )?.count ?? null,
          apiPhase: d02VoteNight.d03R2RevoteApiNoLynchRow?.phaseId ?? null,
          apiTarget: d02VoteNight.d03R2RevoteApiNoLynchRow?.target ?? null,
          apiCount: d02VoteNight.d03R2RevoteApiNoLynchRow?.count ?? null,
          staleD03Target:
            d02VoteNight.d03R2RevoteApiOriginalD03Row?.target ?? null,
          staleD03Count:
            d02VoteNight.d03R2RevoteApiOriginalD03Row?.count ?? null,
          staleD03R1NoLynchCount:
            d02VoteNight.d03R2RevoteApiD03R1NoLynchRow?.count ?? null,
          staleD03NoLynchCount:
            d02VoteNight.d03R2RevoteApiStaleD03NoLynchRow?.count ?? null,
        },
        {
          id: "d03r2-revote-resolved-no-majority",
          phase: d02VoteNight.hostAfterResolveD03R2?.phase?.id ?? null,
          locked:
            d02VoteNight.hostAfterResolveD03R2?.phase?.locked ?? null,
          resolveState:
            d02VoteNight.resolveD03R2?.commandStatus?.state ?? null,
          outcomeStatus:
            d02VoteNight.d03R2DayVoteOutcome?.status ?? null,
          winnerSlot:
            d02VoteNight.d03R2DayVoteOutcome?.winnerSlot ?? null,
          projectedCount:
            d02VoteNight.d03R2DayVoteOutcome?.tallies?.no_lynch ?? null,
          promptId: d02VoteNight.d03R2RevotePrompt?.id ?? null,
          promptActionId: d02VoteNight.d03R2RevotePromptActionId ?? null,
          promptStatusAfter:
            d02VoteNight.d03R2RevotePrompt?.status ?? null,
          originalPromptStatus:
            d02VoteNight.apiPromptsAfterResolveD03R2?.find(
              (prompt) =>
                (prompt.id ?? prompt.prompt_id) ===
                d02VoteNight.d03R1RevotePrompt?.id,
            )?.status ?? null,
          promptActionVisible:
            d02VoteNight.hostAfterResolveD03R2?.promptActions?.includes(
              d02VoteNight.d03R2RevotePromptActionId,
            ) ?? null,
          policyResolveState:
            d02VoteNight.d03R2NoLynchPolicyResolution?.commandStatus?.state ??
            null,
          policyStreamSeqCount: Array.isArray(
            d02VoteNight.d03R2NoLynchPolicyResolution?.commandStatus?.streamSeqs,
          )
            ? d02VoteNight.d03R2NoLynchPolicyResolution.commandStatus.streamSeqs
                .length
            : null,
          decisionPolicy:
            d02VoteNight.d03R2NoLynchPolicyResolution?.commandStatus
              ?.requestEnvelope?.body?.body?.command?.ResolveHostPrompt?.decision
              ?.SelectPolicy?.policy ?? null,
          promptStatusAfterPolicy:
            d02VoteNight.hostAfterD03R2NoLynchPolicy?.hostPrompts?.find(
              (prompt) => prompt.id === d02VoteNight.d03R2RevotePrompt?.id,
            )?.status ?? null,
          nextPhase:
            d02VoteNight.hostAfterD03R2NoLynchPolicy?.phase?.id ?? null,
          nextLocked:
            d02VoteNight.hostAfterD03R2NoLynchPolicy?.phase?.locked ?? null,
          actionNightActionControls: countButtonsWithPrefix(
            d02VoteNight.actionAfterD03R2NoLynchPolicy?.buttons,
            "submit_action",
          ),
          normalNightActionControls: countButtonsWithPrefix(
            d02VoteNight.normalAfterD03R2NoLynchPolicy?.buttons,
            "submit_action",
          ),
        },
        {
          id: "d03r2-stale-continue-policy-recovery",
          promptId: d02VoteNight.d03R2RevotePrompt?.id ?? null,
          staleActionId:
            d02VoteNight.d03R2StaleContinuePolicyActionId ?? null,
          setupPromptStatus:
            d02VoteNight.d03R2StaleContinuePolicySetup?.prompts?.find(
              (prompt) => prompt.id === d02VoteNight.d03R2RevotePrompt?.id,
            )?.status ?? null,
          setupActionVisible:
            d02VoteNight.d03R2StaleContinuePolicySetup?.promptActions?.includes(
              d02VoteNight.d03R2StaleContinuePolicyActionId,
            ) ?? null,
          rejectState:
            d02VoteNight.d03R2StaleContinuePolicyRecovery?.reject?.state ??
            null,
          rejectError:
            d02VoteNight.d03R2StaleContinuePolicyRecovery?.reject?.error ??
            null,
          activityStatusText:
            d02VoteNight.d03R2StaleContinuePolicyRecovery
              ?.activityStatusText ?? null,
          promptStatusAfterReject:
            d02VoteNight.d03R2StaleContinuePolicyRecovery?.promptsAfterReject?.find(
              (prompt) => prompt.id === d02VoteNight.d03R2RevotePrompt?.id,
            )?.status ?? null,
          promptActionVisibleAfterReject:
            d02VoteNight.d03R2StaleContinuePolicyRecovery
              ?.promptActionsAfterReject?.includes(
                d02VoteNight.d03R2StaleContinuePolicyActionId,
              ) ?? null,
          reloadStatus:
            d02VoteNight.d03R2StaleContinuePolicyRecovery
              ?.staleHostPromptReloadAfterReject?.status ?? null,
          reloadPhase:
            d02VoteNight.d03R2StaleContinuePolicyRecovery
              ?.staleHostPromptReloadAfterReject?.phase?.id ?? null,
          reloadLocked:
            d02VoteNight.d03R2StaleContinuePolicyRecovery
              ?.staleHostPromptReloadAfterReject?.phase?.locked ?? null,
          reloadResolveControlVisible:
            d02VoteNight.d03R2StaleContinuePolicyRecovery
              ?.staleHostPromptReloadAfterReject?.phaseActionsAfterReload?.includes(
                "resolve_phase",
              ) ?? null,
          reloadStaleActionVisible:
            d02VoteNight.d03R2StaleContinuePolicyRecovery
              ?.staleHostPromptReloadAfterReject?.promptActionsAfterReload?.includes(
                d02VoteNight.d03R2StaleContinuePolicyActionId,
              ) ?? null,
          apiPromptStatusAfterReload:
            d02VoteNight.d03R2StaleContinuePolicyRecovery
              ?.staleHostPromptReloadAfterReject?.apiPromptsAfterReload?.find(
                (prompt) =>
                  (prompt.id ?? prompt.prompt_id) ===
                  d02VoteNight.d03R2RevotePrompt?.id,
              )?.status ?? null,
        },
      ],
    },
  ];
  const nightTwoDayThreeCycle = cycles.find((cycle) => cycle.id === "n02-d03");
  cycles.push({
    id: "d03-n03",
    game: nightTwoDayThreeCycle?.game ?? null,
    roleUrls: {
      host: nightTwoDayThreeCycle?.roleUrls?.host ?? null,
      actionPlayer: nightTwoDayThreeCycle?.roleUrls?.actionPlayer ?? null,
      normalPlayer: nightTwoDayThreeCycle?.roleUrls?.normalPlayer ?? null,
    },
    checkpoints: (nightTwoDayThreeCycle?.checkpoints ?? [])
      .slice(4)
      .map((checkpoint) => ({ ...checkpoint })),
  });
  cycles.push({
    id: "n03-d04",
    game: d02VoteNight.game ?? null,
    roleUrls: {
      host: d02VoteNight.hostRoleUrl ?? null,
      actionPlayer: d02VoteNight.actionRoleUrl ?? null,
      target: d02VoteNight.playerRoleUrl ?? null,
    },
    checkpoints: [
      {
        id: "n03-action-open",
        phase:
          d02VoteNight.actionAfterD03R2NoLynchPolicy?.commandState?.phase
            ?.phaseId ?? null,
        locked:
          d02VoteNight.actionAfterD03R2NoLynchPolicy?.commandState?.phase
            ?.locked ?? null,
        actionTemplate: firstActionTemplate(
          d02VoteNight.actionAfterD03R2NoLynchPolicy?.commandState?.actions,
        ),
        actionTarget: d02VoteNight.n03ActionTarget ?? null,
        actionButtonVisible: hasEnabledButton(
          d02VoteNight.actionAfterD03R2NoLynchPolicy?.buttons,
          "submit_action:factional_kill",
        ),
        normalPlayerActionControls: countButtonsWithPrefix(
          d02VoteNight.normalAfterD03R2NoLynchPolicy?.buttons,
          "submit_action",
        ),
      },
      {
        id: "n03-action-submitted",
        actionState: d02VoteNight.n03ActionSubmission?.state ?? null,
        actorSlot:
          d02VoteNight.n03ActionSubmission?.requestEnvelope?.body?.body?.command
            ?.SubmitAction?.actor_slot ?? null,
        templateId:
          d02VoteNight.n03ActionSubmission?.requestEnvelope?.body?.body?.command
            ?.SubmitAction?.template_id ?? null,
        targetSlot:
          d02VoteNight.n03ActionSubmission?.requestEnvelope?.body?.body?.command
            ?.SubmitAction?.targets?.[0] ?? null,
        actionButtonVisible: hasEnabledButton(
          d02VoteNight.n03ActionAfterSubmit?.buttons,
          "submit_action:factional_kill",
        ),
      },
      {
        id: "n03-resolved-target-killed",
        resolveState: d02VoteNight.resolveN03?.commandStatus?.state ?? null,
        phase: d02VoteNight.hostAfterResolveN03?.phase?.id ?? null,
        locked: d02VoteNight.hostAfterResolveN03?.phase?.locked ?? null,
        targetSlot: d02VoteNight.n03ResolvedTargetSlot?.slot_id ?? null,
        targetAlive: d02VoteNight.n03ResolvedTargetSlot?.alive ?? null,
        targetStatus: d02VoteNight.n03ResolvedTargetSlot?.status ?? null,
      },
      {
        id: "d04-day-controls-return",
        advanceState: d02VoteNight.advanceD04?.commandStatus?.state ?? null,
        phase: d02VoteNight.d04ActionSurface?.commandState?.phase?.phaseId ?? null,
        locked:
          d02VoteNight.d04ActionSurface?.commandState?.phase?.locked ?? null,
        actionSubmitControls: countButtonsWithPrefix(
          d02VoteNight.d04ActionSurface?.buttons,
          "submit_action",
        ),
        actionVoteControls: countButtonsWithPrefix(
          d02VoteNight.d04ActionSurface?.buttons,
          "submit_vote",
        ),
        targetAlive: d02VoteNight.d04TargetSurface?.commandState?.actorAlive ?? null,
        targetVoteControls: countButtonsWithPrefix(
          d02VoteNight.d04TargetSurface?.buttons,
          "submit_vote",
        ),
      },
    ],
  });
  const recoveryHooks = {
    staleLockedVoteReject: verification.coreLoop?.rejectedVote?.error ?? null,
    invalidActionReject: actionLoop.invalidAction?.error ?? null,
    normalPlayerDirectActionReject:
      dayNight.normalPlayerNightSurface?.directRejectError ?? null,
    staleActionConflictReject: actionLoop.staleActionConflict?.reject?.error ?? null,
    [playerStaleVoteTransitionRecoveryHookId]:
      d02VoteNight.staleD02VoteAfterTransition?.reject?.error ?? null,
    [playerStaleActionTransitionRecoveryHookId]:
      actionLoop.staleActionConflict?.reject?.error ?? null,
    d03TerminalAdvanceReject:
      d02VoteNight.d03TerminalAdvanceReject?.commandStatus?.error ?? null,
  };
  const passed =
    cycles[0]?.game === session?.game &&
    cycles[0]?.roleUrls?.host?.includes(`/g/${session?.game ?? ""}/host`) === true &&
    cycles[0]?.roleUrls?.actionPlayer?.includes(`/g/${session?.game ?? ""}`) === true &&
    cycles[0]?.roleUrls?.privateChannel?.includes(
      `/g/${session?.game ?? ""}/c/`,
    ) === true &&
    cycles[0]?.roleUrls?.privateChannel?.includes("private%3Amafia_day_chat") ===
      true &&
    cycles[0]?.checkpoints?.[0]?.phase === "D01" &&
    cycles[0]?.checkpoints?.[0]?.locked === true &&
    cycles[0]?.checkpoints?.[0]?.resolveState === "ack" &&
    cycles[0]?.checkpoints?.[0]?.submitActionControls === 0 &&
    cycles[0]?.checkpoints?.[0]?.submitVoteControls === 0 &&
    cycles[0]?.checkpoints?.[1]?.phase === "N01" &&
    cycles[0]?.checkpoints?.[1]?.locked === false &&
    cycles[0]?.checkpoints?.[1]?.advanceState === "ack" &&
    cycles[0]?.checkpoints?.[1]?.actionTemplate === "factional_kill" &&
    cycles[0]?.checkpoints?.[1]?.actionButtonVisible === true &&
    cycles[0]?.checkpoints?.[1]?.normalPlayerActionCount === 0 &&
    cycles[0]?.checkpoints?.[1]?.normalPlayerDirectReject === "InvalidTarget" &&
    cycles[0]?.checkpoints?.[2]?.resolveState === "ack" &&
    cycles[0]?.checkpoints?.[2]?.targetAlive === false &&
    cycles[0]?.checkpoints?.[2]?.targetStatus === "dead" &&
    cycles[0]?.checkpoints?.[2]?.receiptStatus === "factional_kill" &&
    cycles[0]?.checkpoints?.[2]?.receiptEffect === "player_killed" &&
    cycles[0]?.checkpoints?.[3]?.phase === "D02" &&
    cycles[0]?.checkpoints?.[3]?.locked === false &&
    cycles[0]?.checkpoints?.[3]?.advanceState === "ack" &&
    cycles[0]?.checkpoints?.[3]?.actionSubmitControls === 0 &&
    cycles[0]?.checkpoints?.[3]?.actionVoteControls > 0 &&
    cycles[0]?.checkpoints?.[3]?.normalVoteControls > 0 &&
    typeof cycles[1]?.game === "string" &&
    cycles[1]?.game.length > 0 &&
    cycles[1]?.roleUrls?.host?.includes(`/g/${cycles[1]?.game}/host`) === true &&
    cycles[1]?.roleUrls?.actionPlayer?.includes(`/g/${cycles[1]?.game}`) === true &&
    cycles[1]?.roleUrls?.normalPlayer?.includes(`/g/${cycles[1]?.game}`) === true &&
    cycles[1]?.roleUrls?.target?.includes(`/g/${cycles[1]?.game}`) === true &&
    cycles[1]?.checkpoints?.[0]?.phase === "D02" &&
    cycles[1]?.checkpoints?.[0]?.locked === false &&
    cycles[1]?.checkpoints?.[0]?.voteTarget === "slot-2" &&
    cycles[1]?.checkpoints?.[0]?.actionPlayerCurrentVote === null &&
    cycles[1]?.checkpoints?.[0]?.actionPlayerVoteControls > 0 &&
    cycles[1]?.checkpoints?.[1]?.voteState === "ack" &&
    cycles[1]?.checkpoints?.[1]?.actorSlot === "slot_4" &&
    cycles[1]?.checkpoints?.[1]?.targetSlot === "slot-2" &&
    cycles[1]?.checkpoints?.[1]?.projectedCount === 3 &&
    cycles[1]?.checkpoints?.[2]?.resolveState === "ack" &&
    cycles[1]?.checkpoints?.[2]?.phase === "D02" &&
    cycles[1]?.checkpoints?.[2]?.locked === true &&
    cycles[1]?.checkpoints?.[2]?.outcomeStatus === "Lynch" &&
    cycles[1]?.checkpoints?.[2]?.winnerSlot === "slot-2" &&
    cycles[1]?.checkpoints?.[2]?.targetAlive === false &&
    cycles[1]?.checkpoints?.[2]?.receiptStatus === "day_vote" &&
    cycles[1]?.checkpoints?.[3]?.advanceState === "ack" &&
    cycles[1]?.checkpoints?.[3]?.phase === "N02" &&
    cycles[1]?.checkpoints?.[3]?.locked === false &&
    cycles[1]?.checkpoints?.[3]?.actionTemplate === "factional_kill" &&
    cycles[1]?.checkpoints?.[3]?.actionButtonVisible === true &&
    cycles[1]?.checkpoints?.[3]?.normalPlayerFactionalKillVisible === false &&
    cycles[2]?.game === cycles[1]?.game &&
    cycles[2]?.roleUrls?.host?.includes(`/g/${cycles[2]?.game}/host`) === true &&
    cycles[2]?.roleUrls?.actionPlayer?.includes(`/g/${cycles[2]?.game}`) === true &&
    cycles[2]?.roleUrls?.normalPlayer?.includes(`/g/${cycles[2]?.game}`) === true &&
    cycles[2]?.checkpoints?.[0]?.phase === "N02" &&
    cycles[2]?.checkpoints?.[0]?.locked === false &&
    cycles[2]?.checkpoints?.[0]?.actionTemplate === "factional_kill" &&
    cycles[2]?.checkpoints?.[0]?.actionTarget === "slot-3" &&
    cycles[2]?.checkpoints?.[0]?.actionButtonVisible === true &&
    cycles[2]?.checkpoints?.[1]?.actionState === "ack" &&
    cycles[2]?.checkpoints?.[1]?.actorSlot === "slot_4" &&
    cycles[2]?.checkpoints?.[1]?.templateId === "factional_kill" &&
    cycles[2]?.checkpoints?.[1]?.targetSlot === "slot-3" &&
    cycles[2]?.checkpoints?.[1]?.actionButtonVisible === false &&
    cycles[2]?.checkpoints?.[2]?.resolveState === "ack" &&
    cycles[2]?.checkpoints?.[2]?.phase === "N02" &&
    cycles[2]?.checkpoints?.[2]?.locked === true &&
    cycles[2]?.checkpoints?.[2]?.targetSlot === "slot-3" &&
    cycles[2]?.checkpoints?.[2]?.targetAlive === false &&
    cycles[2]?.checkpoints?.[2]?.targetStatus === "dead" &&
    cycles[2]?.checkpoints?.[3]?.advanceState === "ack" &&
    cycles[2]?.checkpoints?.[3]?.phase === "D03" &&
    cycles[2]?.checkpoints?.[3]?.locked === false &&
    cycles[2]?.checkpoints?.[3]?.actionSubmitControls === 0 &&
    cycles[2]?.checkpoints?.[3]?.actionVoteControls > 0 &&
    cycles[2]?.checkpoints?.[3]?.normalVoteControls > 0 &&
    cycles[2]?.checkpoints?.[4]?.voteState === "ack" &&
    cycles[2]?.checkpoints?.[4]?.voteTarget === "slot_4" &&
    cycles[2]?.checkpoints?.[4]?.resolveState === "ack" &&
    cycles[2]?.checkpoints?.[4]?.outcomeStatus === "NoMajority" &&
    cycles[2]?.checkpoints?.[4]?.winnerSlot === null &&
    cycles[2]?.checkpoints?.[4]?.targetAlive === true &&
    cycles[2]?.checkpoints?.[4]?.targetStatus === "alive" &&
    cycles[2]?.checkpoints?.[4]?.advanceState === "reject" &&
    cycles[2]?.checkpoints?.[4]?.rejectError === "InvalidTarget" &&
    cycles[2]?.checkpoints?.[4]?.phase === "D03" &&
    cycles[2]?.checkpoints?.[4]?.locked === true &&
    cycles[2]?.checkpoints?.[4]?.advanceControlVisible === true &&
    cycles[2]?.checkpoints?.[5]?.routeResponseStatus === 200 &&
    cycles[2]?.checkpoints?.[5]?.rejectReceiptStatus?.includes(
      "Reject InvalidTarget",
    ) === true &&
    cycles[2]?.checkpoints?.[5]?.phase === "D03" &&
    cycles[2]?.checkpoints?.[5]?.locked === true &&
    cycles[2]?.checkpoints?.[5]?.outcomeStatus === "NoMajority" &&
    cycles[2]?.checkpoints?.[5]?.projectedCount === 1 &&
    cycles[2]?.checkpoints?.[5]?.advanceControlVisible === true &&
    cycles[2]?.checkpoints?.[5]?.unlockControlVisible === true &&
    cycles[2]?.checkpoints?.[6]?.promptId === "D03:revote:NoMajority" &&
    cycles[2]?.checkpoints?.[6]?.promptActionId ===
      "resolve_host_prompt-D03-revote-NoMajority-no_majority_continue_revote" &&
    cycles[2]?.checkpoints?.[6]?.promptStatusBefore === "pending" &&
    cycles[2]?.checkpoints?.[6]?.resolveState === "ack" &&
    cycles[2]?.checkpoints?.[6]?.streamSeqCount === 2 &&
    cycles[2]?.checkpoints?.[6]?.decisionPolicy ===
      "no_majority_continue_revote" &&
    cycles[2]?.checkpoints?.[6]?.promptStatusAfter === "resolved" &&
    cycles[2]?.checkpoints?.[6]?.phase === "D03R1" &&
    cycles[2]?.checkpoints?.[6]?.locked === false &&
    cycles[2]?.checkpoints?.[6]?.actionVoteControls > 0 &&
    cycles[2]?.checkpoints?.[6]?.normalVoteControls > 0 &&
    cycles[2]?.checkpoints?.[7]?.phase === "D03R1" &&
    cycles[2]?.checkpoints?.[7]?.locked === false &&
    cycles[2]?.checkpoints?.[7]?.voteState === "ack" &&
    cycles[2]?.checkpoints?.[7]?.actorSlot === "slot_4" &&
    cycles[2]?.checkpoints?.[7]?.voteTarget === "NoLynch" &&
    cycles[2]?.checkpoints?.[7]?.currentVoteKind === "no_lynch" &&
    cycles[2]?.checkpoints?.[7]?.projectedCount === 1 &&
    cycles[2]?.checkpoints?.[7]?.apiPhase === "D03R1" &&
    cycles[2]?.checkpoints?.[7]?.apiTarget === "no_lynch" &&
    cycles[2]?.checkpoints?.[7]?.apiCount === 1 &&
    cycles[2]?.checkpoints?.[7]?.staleD03Target === "slot_4" &&
    cycles[2]?.checkpoints?.[7]?.staleD03Count === 1 &&
    cycles[2]?.checkpoints?.[7]?.staleD03NoLynchCount === null &&
    cycles[2]?.checkpoints?.[8]?.phase === "D03R1" &&
    cycles[2]?.checkpoints?.[8]?.locked === true &&
    cycles[2]?.checkpoints?.[8]?.resolveState === "ack" &&
    cycles[2]?.checkpoints?.[8]?.outcomeStatus === "NoMajority" &&
    cycles[2]?.checkpoints?.[8]?.winnerSlot === null &&
    cycles[2]?.checkpoints?.[8]?.projectedCount === 1 &&
    cycles[2]?.checkpoints?.[8]?.promptId === "D03R1:revote:NoMajority" &&
    cycles[2]?.checkpoints?.[8]?.promptActionId ===
      "resolve_host_prompt-D03R1-revote-NoMajority-no_majority_continue_revote" &&
    cycles[2]?.checkpoints?.[8]?.promptStatusAfter === "pending" &&
    cycles[2]?.checkpoints?.[8]?.originalPromptStatus === "resolved" &&
    cycles[2]?.checkpoints?.[8]?.promptActionVisible === true &&
    cycles[2]?.checkpoints?.[9]?.id === "d03r2-revote-prompt-resolved" &&
    cycles[2]?.checkpoints?.[9]?.promptId === "D03R1:revote:NoMajority" &&
    cycles[2]?.checkpoints?.[9]?.promptActionId ===
      "resolve_host_prompt-D03R1-revote-NoMajority-no_majority_continue_revote" &&
    cycles[2]?.checkpoints?.[9]?.promptStatusBefore === "pending" &&
    cycles[2]?.checkpoints?.[9]?.resolveState === "ack" &&
    cycles[2]?.checkpoints?.[9]?.streamSeqCount === 2 &&
    cycles[2]?.checkpoints?.[9]?.decisionPolicy ===
      "no_majority_continue_revote" &&
    cycles[2]?.checkpoints?.[9]?.promptStatusAfter === "resolved" &&
    cycles[2]?.checkpoints?.[9]?.originalPromptStatus === "resolved" &&
    cycles[2]?.checkpoints?.[9]?.phase === "D03R2" &&
    cycles[2]?.checkpoints?.[9]?.locked === false &&
    cycles[2]?.checkpoints?.[9]?.actionVoteControls > 0 &&
    cycles[2]?.checkpoints?.[9]?.normalVoteControls > 0 &&
    cycles[2]?.checkpoints?.[10]?.id === "d03r2-revote-ballot-submitted" &&
    cycles[2]?.checkpoints?.[10]?.phase === "D03R2" &&
    cycles[2]?.checkpoints?.[10]?.locked === false &&
    cycles[2]?.checkpoints?.[10]?.voteState === "ack" &&
    cycles[2]?.checkpoints?.[10]?.actorSlot === "slot_4" &&
    cycles[2]?.checkpoints?.[10]?.voteTarget === "NoLynch" &&
    cycles[2]?.checkpoints?.[10]?.currentVoteKind === "no_lynch" &&
    cycles[2]?.checkpoints?.[10]?.projectedCount === 1 &&
    cycles[2]?.checkpoints?.[10]?.apiPhase === "D03R2" &&
    cycles[2]?.checkpoints?.[10]?.apiTarget === "no_lynch" &&
    cycles[2]?.checkpoints?.[10]?.apiCount === 1 &&
    cycles[2]?.checkpoints?.[10]?.staleD03Target === "slot_4" &&
    cycles[2]?.checkpoints?.[10]?.staleD03Count === 1 &&
    cycles[2]?.checkpoints?.[10]?.staleD03R1NoLynchCount === 1 &&
    cycles[2]?.checkpoints?.[10]?.staleD03NoLynchCount === null &&
    cycles[2]?.checkpoints?.[11]?.id ===
      "d03r2-revote-resolved-no-majority" &&
    cycles[2]?.checkpoints?.[11]?.phase === "D03R2" &&
    cycles[2]?.checkpoints?.[11]?.locked === true &&
    cycles[2]?.checkpoints?.[11]?.resolveState === "ack" &&
    cycles[2]?.checkpoints?.[11]?.outcomeStatus === "NoMajority" &&
    cycles[2]?.checkpoints?.[11]?.winnerSlot === null &&
    cycles[2]?.checkpoints?.[11]?.projectedCount === 1 &&
    cycles[2]?.checkpoints?.[11]?.promptId === "D03R2:revote:NoMajority" &&
    cycles[2]?.checkpoints?.[11]?.promptActionId ===
      "resolve_host_prompt-D03R2-revote-NoMajority-no_majority_no_lynch" &&
    cycles[2]?.checkpoints?.[11]?.promptStatusAfter === "pending" &&
    cycles[2]?.checkpoints?.[11]?.originalPromptStatus === "resolved" &&
    cycles[2]?.checkpoints?.[11]?.promptActionVisible === true &&
    cycles[2]?.checkpoints?.[11]?.policyResolveState === "ack" &&
    cycles[2]?.checkpoints?.[11]?.policyStreamSeqCount === 2 &&
    cycles[2]?.checkpoints?.[11]?.decisionPolicy === "no_majority_no_lynch" &&
    cycles[2]?.checkpoints?.[11]?.promptStatusAfterPolicy === "resolved" &&
    cycles[2]?.checkpoints?.[11]?.nextPhase === "N03" &&
    cycles[2]?.checkpoints?.[11]?.nextLocked === false &&
    cycles[2]?.checkpoints?.[11]?.actionNightActionControls > 0 &&
    cycles[2]?.checkpoints?.[11]?.normalNightActionControls === 0 &&
    cycles[2]?.checkpoints?.[12]?.id ===
      "d03r2-stale-continue-policy-recovery" &&
    cycles[2]?.checkpoints?.[12]?.promptId === "D03R2:revote:NoMajority" &&
    cycles[2]?.checkpoints?.[12]?.staleActionId ===
      "resolve_host_prompt-D03R2-revote-NoMajority-no_majority_continue_revote" &&
    cycles[2]?.checkpoints?.[12]?.setupPromptStatus === "pending" &&
    cycles[2]?.checkpoints?.[12]?.setupActionVisible === true &&
    cycles[2]?.checkpoints?.[12]?.rejectState === "reject" &&
    cycles[2]?.checkpoints?.[12]?.rejectError === "PromptAlreadyResolved" &&
    String(cycles[2]?.checkpoints?.[12]?.activityStatusText ?? "").includes(
      "Reject PromptAlreadyResolved",
    ) &&
    String(cycles[2]?.checkpoints?.[12]?.activityStatusText ?? "").includes(
      "host prompt selection is stale",
    ) &&
    cycles[2]?.checkpoints?.[12]?.promptStatusAfterReject === "resolved" &&
    cycles[2]?.checkpoints?.[12]?.promptActionVisibleAfterReject === false &&
    cycles[2]?.checkpoints?.[12]?.reloadStatus === "passed" &&
    cycles[2]?.checkpoints?.[12]?.reloadPhase === "N03" &&
    cycles[2]?.checkpoints?.[12]?.reloadLocked === false &&
    cycles[2]?.checkpoints?.[12]?.reloadResolveControlVisible === true &&
    cycles[2]?.checkpoints?.[12]?.reloadStaleActionVisible === false &&
    cycles[2]?.checkpoints?.[12]?.apiPromptStatusAfterReload === "resolved" &&
    cycles[3]?.id === "d03-n03" &&
    cycles[3]?.game === cycles[2]?.game &&
    cycles[3]?.roleUrls?.host === cycles[2]?.roleUrls?.host &&
    cycles[3]?.roleUrls?.actionPlayer === cycles[2]?.roleUrls?.actionPlayer &&
    cycles[3]?.roleUrls?.normalPlayer === cycles[2]?.roleUrls?.normalPlayer &&
    cycles[3]?.checkpoints?.length === 9 &&
    cycles[3]?.checkpoints?.[0]?.id === "d03-terminal-advance-reject" &&
    cycles[3]?.checkpoints?.[2]?.id === "d03-revote-prompt-resolved" &&
    cycles[3]?.checkpoints?.[8]?.id ===
      "d03r2-stale-continue-policy-recovery" &&
    cycles[3]?.checkpoints?.[8]?.reloadPhase === "N03" &&
    cycles[4]?.id === "n03-d04" &&
    cycles[4]?.game === cycles[2]?.game &&
    cycles[4]?.roleUrls?.host === cycles[2]?.roleUrls?.host &&
    cycles[4]?.roleUrls?.actionPlayer === cycles[2]?.roleUrls?.actionPlayer &&
    cycles[4]?.roleUrls?.target === cycles[2]?.roleUrls?.normalPlayer &&
    cycles[4]?.checkpoints?.[0]?.id === "n03-action-open" &&
    cycles[4]?.checkpoints?.[0]?.phase === "N03" &&
    cycles[4]?.checkpoints?.[0]?.locked === false &&
    cycles[4]?.checkpoints?.[0]?.actionTemplate === "factional_kill" &&
    cycles[4]?.checkpoints?.[0]?.actionTarget === "slot-7" &&
    cycles[4]?.checkpoints?.[0]?.actionButtonVisible === true &&
    cycles[4]?.checkpoints?.[0]?.normalPlayerActionControls === 0 &&
    cycles[4]?.checkpoints?.[1]?.id === "n03-action-submitted" &&
    cycles[4]?.checkpoints?.[1]?.actionState === "ack" &&
    cycles[4]?.checkpoints?.[1]?.actorSlot === "slot_4" &&
    cycles[4]?.checkpoints?.[1]?.templateId === "factional_kill" &&
    cycles[4]?.checkpoints?.[1]?.targetSlot === "slot-7" &&
    cycles[4]?.checkpoints?.[1]?.actionButtonVisible === false &&
    cycles[4]?.checkpoints?.[2]?.id === "n03-resolved-target-killed" &&
    cycles[4]?.checkpoints?.[2]?.resolveState === "ack" &&
    cycles[4]?.checkpoints?.[2]?.phase === "N03" &&
    cycles[4]?.checkpoints?.[2]?.locked === true &&
    cycles[4]?.checkpoints?.[2]?.targetSlot === "slot-7" &&
    cycles[4]?.checkpoints?.[2]?.targetAlive === false &&
    cycles[4]?.checkpoints?.[2]?.targetStatus === "dead" &&
    cycles[4]?.checkpoints?.[3]?.id === "d04-day-controls-return" &&
    cycles[4]?.checkpoints?.[3]?.advanceState === "ack" &&
    cycles[4]?.checkpoints?.[3]?.phase === "D04" &&
    cycles[4]?.checkpoints?.[3]?.locked === false &&
    cycles[4]?.checkpoints?.[3]?.actionSubmitControls === 0 &&
    cycles[4]?.checkpoints?.[3]?.actionVoteControls > 0 &&
    cycles[4]?.checkpoints?.[3]?.targetAlive === false &&
    cycles[4]?.checkpoints?.[3]?.targetVoteControls === 0 &&
    recoveryHooks.staleLockedVoteReject === "PhaseLocked" &&
    recoveryHooks.invalidActionReject === "InvalidTarget" &&
    recoveryHooks.normalPlayerDirectActionReject === "InvalidTarget" &&
    recoveryHooks.staleActionConflictReject === "PhaseLocked" &&
    recoveryHooks[playerStaleVoteTransitionRecoveryHookId] === "PhaseLocked" &&
    recoveryHooks[playerStaleActionTransitionRecoveryHookId] === "PhaseLocked" &&
    recoveryHooks.d03TerminalAdvanceReject === "InvalidTarget";
  return {
    status: passed ? "passed" : "failed",
    proof:
      "Compact derived spine map for the seeded role URL core loop: D01 resolve to N01 action, N01 resolution to D02 day controls, D02 vote resolution, N02 action return, N02 action submission/resolution, D03 day controls, D03 NoMajority AdvancePhase InvalidTarget recovery, host role URL reload back to locked D03 NoMajority truth, host continue-revote policy resolution into open D03R1 controls, a D03R1 no-lynch revote ballot keyed separately from the stale D03 tally, host resolution of D03R1 back to locked NoMajority with a fresh pending revote prompt, second continue-revote policy resolution into open D03R2 controls, D03R2 no-lynch vote submission/resolution with prior revote tallies kept separate, explicit host no-lynch policy resolution into open N03 controls, stale continue-revote policy recovery back to open N03, and real N03 action submission/resolution into open D04 day controls.",
    sourceLaneIds: [...coreLoopPhaseProgressionSpineSourceLaneIds],
    cycles,
    recoveryHooks,
  };
}

function assertCoreLoopSpineSummary(summary) {
  if (summary?.status !== "passed") {
    throw new Error(`core loop spine summary failed: ${JSON.stringify(summary)}`);
  }
  if (summary.proof !== undefined && typeof summary.proof !== "string") {
    throw new Error("core loop spine summary proof must be text");
  }
  if (
    !Array.isArray(summary.sourceLaneIds) ||
    !summary.sourceLaneIds.includes(playerActionLoopLaneId)
  ) {
    throw new Error("core loop spine summary must cite the action-loop source lane");
  }
  if (!Array.isArray(summary.cycles) || summary.cycles.length !== 5) {
    throw new Error("core loop spine summary must expose exactly five cycles");
  }
  for (const cycle of summary.cycles) {
    if (
      typeof cycle.id !== "string" ||
      typeof cycle.game !== "string" ||
      cycle.game.length === 0 ||
      cycle.roleUrls === null ||
      typeof cycle.roleUrls !== "object" ||
      !Object.values(cycle.roleUrls).every((url) => typeof url === "string") ||
      !Array.isArray(cycle.checkpoints) ||
      (cycle.id === "n02-d03"
        ? cycle.checkpoints.length !== 13
        : cycle.id === "d03-n03"
          ? cycle.checkpoints.length !== 9
          : cycle.checkpoints.length !== 4)
    ) {
      throw new Error(`core loop spine cycle malformed: ${JSON.stringify(cycle)}`);
    }
  }
  if (
    !summary.cycles[0]?.roleUrls?.privateChannel?.includes("/c/") ||
    !summary.cycles[0]?.roleUrls?.privateChannel?.includes(
      "private%3Amafia_day_chat",
    )
  ) {
    throw new Error("core loop spine summary must expose private-channel role URL");
  }
  if (
    summary.recoveryHooks?.staleLockedVoteReject !== "PhaseLocked" ||
    summary.recoveryHooks?.invalidActionReject !== "InvalidTarget" ||
    summary.recoveryHooks?.normalPlayerDirectActionReject !== "InvalidTarget" ||
    summary.recoveryHooks?.staleActionConflictReject !== "PhaseLocked" ||
    summary.recoveryHooks?.[playerStaleVoteTransitionRecoveryHookId] !==
      "PhaseLocked" ||
    summary.recoveryHooks?.[playerStaleActionTransitionRecoveryHookId] !==
      "PhaseLocked" ||
    summary.recoveryHooks?.d03TerminalAdvanceReject !== "InvalidTarget"
  ) {
    throw new Error(
      `core loop spine recovery hooks drifted: ${JSON.stringify(summary.recoveryHooks)}`,
    );
  }
}

function countButtonsWithPrefix(buttons, prefix) {
  return (buttons ?? []).filter((button) =>
    String(button.action ?? "").startsWith(prefix),
  ).length;
}

function hasEnabledButton(buttons, actionId) {
  return (
    (buttons ?? []).some(
      (button) => button.action === actionId && button.disabled === false,
    ) === true
  );
}

function firstActionTemplate(actions) {
  return actions?.find((action) => action.templateId !== undefined)?.templateId ?? null;
}

function hostPhaseStaleControlLanes({ hardening, session }) {
  return hostPhaseStaleControlCases().flatMap((scenario) => [
    hostPhaseStaleBaseLane({ hardening, session, scenario }),
    hostPhaseStaleReloadLane({ hardening, session, scenario }),
    hostPhaseStaleReconnectLane({ hardening, session, scenario }),
  ]);
}

function hostPhaseStaleBaseLane({ hardening, session, scenario }) {
  const proof = hardening?.[scenario.proofField];
  return lane(scenario.baseLaneId, scenario.baseLabel, {
    rejectError: proof?.reject?.error ?? null,
    roleUrl: proof?.setup?.roleUrl ?? null,
    staleClickActionId: proof?.staleClickBrowserProof?.clickedActionId ?? null,
    staleClickReceipt: proof?.staleClickBrowserProof?.receiptStatusText ?? null,
    staleClickRefreshKeys:
      proof?.staleClickBrowserProof?.dispatchRefreshKeys ?? null,
    stalePhase: proof?.setup?.stalePhase?.id ?? null,
    ...hostPhaseStaleBaseExtraEvidence({ proof, scenario }),
    phaseId: proof?.phaseAfterReject?.id ?? null,
    locked: proof?.phaseAfterReject?.locked ?? null,
    phaseActions: proof?.phaseActionsAfterReject ?? null,
    passed: hostPhaseStaleBasePassed({ proof, session, scenario }),
  });
}

function hostPhaseStaleBaseExtraEvidence({ proof, scenario }) {
  if (scenario.key === "resolve") {
    return {
      liveResolveSeqs: proof?.liveResolve?.commandStatus?.streamSeqs ?? null,
      restoreLocked: proof?.apiPhaseAfterRestore?.locked ?? null,
    };
  }
  if (scenario.key === "advance") {
    return {
      liveUnlockSeqs: proof?.liveUnlock?.commandStatus?.streamSeqs ?? null,
    };
  }
  return {
    activitySource: proof?.activityRow?.source ?? null,
    deadlineActions: proof?.deadlineActionsAfterReject ?? null,
    apiDeadline: proof?.apiPhaseAfterReject?.deadline ?? null,
  };
}

function hostPhaseStaleReloadLane({ hardening, session, scenario }) {
  const proof = hardening?.[scenario.proofField];
  const reloadProof = proof?.[scenario.reloadProofField];
  return lane(scenario.reloadLaneId, scenario.reloadLabel, {
    ...hostPhaseStaleReloadPrefixEvidence({ proof, session, scenario }),
    routeStatus: reloadProof?.routeResponseStatus ?? null,
    rejectReceipt: reloadProof?.rejectReceiptStatusText ?? null,
    phaseId: reloadProof?.phaseAfterReload?.id ?? null,
    locked: reloadProof?.phaseAfterReload?.locked ?? null,
    ...hostPhaseStaleReloadActionEvidence({ reloadProof, scenario }),
    passed: hostPhaseStaleReloadPassed({ proof, reloadProof, scenario }),
  });
}

function hostPhaseStaleReloadPrefixEvidence({ proof, session, scenario }) {
  if (scenario.key === "deadline") {
    return {
      rejectError: proof?.reject?.error ?? null,
    };
  }
  return {
    game: session.game ?? null,
  };
}

function hostPhaseStaleReloadActionEvidence({ reloadProof, scenario }) {
  if (scenario.key === "deadline") {
    return {
      deadlineActions: reloadProof?.deadlineActionsAfterReload ?? null,
      phaseActions: reloadProof?.phaseActionsAfterReload ?? null,
      apiDeadline: reloadProof?.apiPhaseAfterReload?.deadline ?? null,
    };
  }
  return {
    phaseActions: reloadProof?.phaseActionsAfterReload ?? null,
    apiLocked: reloadProof?.apiPhaseAfterReload?.locked ?? null,
  };
}

function hostPhaseStaleReconnectLane({ hardening, session, scenario }) {
  const proof = hardening?.[scenario.proofField];
  const reconnectProof = proof?.reconnectAfterReject;
  const expectation = hostStaleReconnectExpectationForLane(
    scenario.reconnectLaneId,
  );
  return lane(scenario.reconnectLaneId, scenario.reconnectLabel, {
    game: session.game ?? null,
    reconnectingState: reconnectProof?.reconnectingStatus?.state ?? null,
    recoveryState: reconnectProof?.reconnectRecoveryEvent?.state ?? null,
    recoveredPhase: reconnectProof?.recoveredHostProjection?.phase?.id ?? null,
    recoveredLocked:
      reconnectProof?.recoveredHostProjection?.phase?.locked ?? null,
    ...hostPhaseStaleReconnectActionEvidence({ proof, scenario }),
    passed:
      hostPhaseStaleReconnectPassed({ proof, reconnectProof, scenario }) &&
      hostStaleReconnectExpectationPassed({
        proof,
        reconnectProof,
        expectation,
      }),
  });
}

function hostPhaseStaleReconnectActionEvidence({ proof, scenario }) {
  if (scenario.key === "deadline") {
    return {
      deadlineActions: proof?.deadlineActionsAfterReconnect ?? null,
      phaseActions: proof?.phaseActionsAfterReconnect ?? null,
      apiDeadline: proof?.apiPhaseAfterReconnect?.deadline ?? null,
    };
  }
  return {
    phaseActions: proof?.phaseActionsAfterReconnect ?? null,
  };
}

function cohostDeadlineStaleControlLanes({ hardening, session }) {
  return cohostDeadlineStaleControlCases().flatMap((scenario) => [
    cohostDeadlineStaleBaseLane({ hardening, session, scenario }),
    cohostDeadlineStaleReloadLane({ hardening, scenario }),
    cohostDeadlineStaleReconnectLane({ hardening, session, scenario }),
  ]);
}

function cohostDeadlineStaleBaseLane({ hardening, session, scenario }) {
  const proof = hardening?.[scenario.proofField];
  return lane(scenario.baseLaneId, scenario.baseLabel, {
    rejectError: proof?.reject?.error ?? null,
    roleUrl: proof?.setup?.roleUrl ?? null,
    staleClickActionId: proof?.staleClickBrowserProof?.clickedActionId ?? null,
    staleClickReceipt: proof?.staleClickBrowserProof?.receiptStatusText ?? null,
    staleClickRefreshKeys:
      proof?.staleClickBrowserProof?.dispatchRefreshKeys ?? null,
    stalePhase: proof?.setup?.stalePhase?.id ?? null,
    phaseId: proof?.phaseAfterReject?.id ?? null,
    activitySource: proof?.activityRow?.source ?? null,
    currentActions: proof?.deadlineActionsAfterReject ?? null,
    apiDeadline: proof?.apiPhaseAfterReject?.deadline ?? null,
    passed: cohostDeadlineStaleBasePassed({ proof, session, scenario }),
  });
}

function cohostDeadlineStaleReloadLane({ hardening, scenario }) {
  const proof = hardening?.[scenario.proofField];
  const reloadProof = proof?.[scenario.reloadProofField];
  return lane(scenario.reloadLaneId, scenario.reloadLabel, {
    rejectError: proof?.reject?.error ?? null,
    routeStatus: reloadProof?.routeResponseStatus ?? null,
    rejectReceipt: reloadProof?.rejectReceiptStatusText ?? null,
    phaseId: reloadProof?.phaseAfterReload?.id ?? null,
    locked: reloadProof?.phaseAfterReload?.locked ?? null,
    deadlineActions: reloadProof?.deadlineActionsAfterReload ?? null,
    phaseActions: reloadProof?.phaseActionsAfterReload ?? null,
    apiDeadline: reloadProof?.apiPhaseAfterReload?.deadline ?? null,
    passed: cohostDeadlineStaleReloadPassed({ proof, reloadProof, scenario }),
  });
}

function cohostDeadlineStaleReconnectLane({ hardening, session, scenario }) {
  const proof = hardening?.[scenario.proofField];
  const reconnectProof = proof?.reconnectAfterReject;
  const expectation = hostStaleReconnectExpectationForLane(
    scenario.reconnectLaneId,
  );
  return lane(scenario.reconnectLaneId, scenario.reconnectLabel, {
    game: session.game ?? null,
    reconnectingState: reconnectProof?.reconnectingStatus?.state ?? null,
    recoveryState: reconnectProof?.reconnectRecoveryEvent?.state ?? null,
    recoveredPhase: reconnectProof?.recoveredHostProjection?.phase?.id ?? null,
    recoveredLocked:
      reconnectProof?.recoveredHostProjection?.phase?.locked ?? null,
    deadlineActions: proof?.deadlineActionsAfterReconnect ?? null,
    phaseActions: proof?.phaseActionsAfterReconnect ?? null,
    apiDeadline: proof?.apiPhaseAfterReconnect?.deadline ?? null,
    passed: cohostDeadlineStaleReconnectPassed({
      proof,
      reconnectProof,
      scenario,
    }) &&
      hostStaleReconnectExpectationPassed({
        proof,
        reconnectProof,
        expectation,
      }),
  });
}

function hostStaleReconnectExpectationPassed({
  proof,
  reconnectProof,
  expectation,
}) {
  if (
    reconnectProof?.reconnectingStatus?.state !== expectation.reconnectingState ||
    reconnectProof?.reconnectRecoveryEvent?.state !== expectation.recoveryState ||
    reconnectProof?.reconnectRecoveryEvent?.attempt !==
      expectation.reconnectAttempt ||
    reconnectProof?.recoveredHostProjection?.phase?.id !==
      expectation.recoveredPhaseId ||
    reconnectProof?.recoveredHostProjection?.phase?.locked !==
      expectation.recoveredLocked
  ) {
    return false;
  }
  if (
    Object.hasOwn(expectation, "apiDeadline") &&
    proof?.apiPhaseAfterReconnect?.deadline !== expectation.apiDeadline
  ) {
    return false;
  }
  if (
    Object.hasOwn(expectation, "phaseActions") &&
    arrayShallowEqual(proof?.phaseActionsAfterReconnect, expectation.phaseActions) ===
      false
  ) {
    return false;
  }
  return true;
}

function arrayShallowEqual(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function completedGameHardeningProofLanes({ hardening }) {
  return coreLoopCompletedGameHardeningLaneDescriptors({ hardening }).map(
    (descriptor) => completedGameLane(descriptor),
  );
}

function completedGameLane({ id, label, evidence }) {
  return lane(id, label, evidence);
}
function lane(id, label, evidence) {
  const { passed, ...rest } = evidence;
  return {
    id,
    label,
    status: passed ? "passed" : "failed",
    evidence: rest,
  };
}

function requiredRolesPresent(verification) {
  return [
    "host",
    "hostSetup",
    "player",
    "actionPlayer",
    "deniedPlayer",
    "cohost",
    "replacementPlayer",
  ].every((role) => (verification.roles ?? []).includes(role));
}

function sameArray(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function normalizedVotecountRows(apiVotecount) {
  const rows = Array.isArray(apiVotecount) ? apiVotecount : [];
  return rows
    .map((delta) =>
      delta?.kind === "VoteCountChanged"
        ? delta.body
        : delta?.VoteCountChanged ?? delta?.body?.VoteCountChanged ?? null,
    )
    .filter(Boolean)
    .map((delta) => ({
      target: delta.candidate_slot ?? delta.candidateSlot ?? "unknown",
      phaseId: delta.phase_id ?? delta.phaseId ?? "unknown",
      count: Number(delta.count ?? 0),
    }));
}

function normalizedDayVoteOutcomeRows(apiDayVoteOutcomes) {
  const rows = Array.isArray(apiDayVoteOutcomes) ? apiDayVoteOutcomes : [];
  return rows
    .map((delta) =>
      delta?.kind === "DayVoteOutcomeApplied"
        ? delta.body
        : delta?.DayVoteOutcomeApplied ??
          delta?.body?.DayVoteOutcomeApplied ??
          (delta?.status !== undefined ? delta : null),
    )
    .filter(Boolean)
    .map((delta) => ({
      phaseId: delta.phase_id ?? delta.phaseId ?? "unknown",
      status: delta.status ?? "unknown",
      winnerSlot: delta.winner_slot ?? delta.winnerSlot ?? null,
      tallies: delta.tallies ?? {},
      majority: Number(delta.majority ?? 0),
    }));
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  const proofPath = process.argv[2]
    ? path.resolve(process.cwd(), process.argv[2])
    : defaultProofPath;
  const sessionPath = process.argv[3]
    ? path.resolve(process.cwd(), process.argv[3])
    : defaultSessionPath;
  const [proof, session] = await Promise.all([
    readJson(proofPath),
    readJson(sessionPath),
  ]);
  assertDevTestGameProofRun(proof);
  const expected = buildDevTestGameProofRun(session, {
    generatedAt: proof.generatedAt,
  });
  if (JSON.stringify(proof) !== JSON.stringify(expected)) {
    throw new Error(
      `dev-test-game proof is stale or does not match ${path.relative(repoRoot, sessionPath)}`,
    );
  }
  console.log(
    `validated ${path.relative(repoRoot, proofPath)} (${proof.lanes.length} lanes)`,
  );
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}
