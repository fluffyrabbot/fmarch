import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DEV_TEST_GAME_PROOF_VERSION = 1;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultSessionPath = path.join(repoRoot, "target", "dev-test-game", "session.json");
const defaultProofPath = path.join(repoRoot, "target", "dev-test-game", "proof-run.json");
const requiredLaneIds = Object.freeze([
  "browser-entry",
  "cohost-console",
  "core-loop",
  "action-loop",
  "invalid-action-recovery",
  "resolution-receipts",
  "dead-player-recovery",
  "player-action-boundary",
  "private-channel",
  "replacement-host-issued-invite",
  "replacement-pending-player",
  "replacement-redeemed-invite-recovery",
  "replacement-invalid-target-recovery",
  "replacement-console",
  "replacement-idempotent-retry",
  "replacement-stale-success-recovery",
  "replacement-stale-player",
  "replacement-incoming-player",
  "idempotent-retry",
  "reconnect-recovery",
  "stale-player-vote",
  "concurrent-vote-race",
  "stale-action-conflict",
  "stale-host-control",
  "stale-cohost-deadline",
]);

export function buildDevTestGameProofRun(session, options = {}) {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const verification = session?.verification ?? {};
  const hardening = verification.multiplayerHardening ?? {};
  const lanes = [
    lane("browser-entry", "Role URLs open verified browser sessions", {
      roles: verification.roles ?? [],
      sessionRoles: Object.keys(verification.sessions ?? {}),
      passed: verification.status === "passed" && requiredRolesPresent(verification),
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
      passed:
        verification.coreLoop?.status === "passed" &&
        verification.coreLoop?.rejectedVote?.error === "PhaseLocked" &&
        verification.coreLoop?.lock?.commandStatus?.state === "ack" &&
        verification.coreLoop?.unlock?.commandStatus?.state === "ack",
    }),
    lane("action-loop", "Day/night action submission and resolution", {
      invalidActionError: verification.actionLoop?.invalidAction?.error ?? null,
      legalActionState: verification.actionLoop?.legalAction?.state ?? null,
      resolvedTargetAlive: verification.actionLoop?.resolvedTargetSlot?.alive ?? null,
      advancedPhase: verification.actionLoop?.d02Phase?.phaseId ?? null,
      passed:
        verification.actionLoop?.status === "passed" &&
        verification.actionLoop?.invalidAction?.error === "InvalidTarget" &&
        verification.actionLoop?.legalAction?.state === "ack" &&
        verification.actionLoop?.resolvedTargetSlot?.alive === false &&
        verification.actionLoop?.d02Phase?.phaseId === "D02",
    }),
    lane("invalid-action-recovery", "Invalid action reject keeps legal controls usable", {
      rejectError: verification.invalidActionRecovery?.reject?.error ?? null,
      receiptActionId: verification.invalidActionRecovery?.currentReceipt?.actionId ?? null,
      receiptState: verification.invalidActionRecovery?.currentReceipt?.state ?? null,
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
          "Reject InvalidTarget",
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
      voteDisabled: verification.deadPlayerRecovery?.disabledControls?.vote ?? null,
      postDisabled: verification.deadPlayerRecovery?.disabledControls?.post ?? null,
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
        verification.deadPlayerRecovery?.disabledControls?.vote === true &&
        verification.deadPlayerRecovery?.disabledControls?.withdraw === true &&
        verification.deadPlayerRecovery?.disabledControls?.post === true &&
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
    lane("player-action-boundary", "Player role URL hides and rejects unowned night actions", {
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
    lane("private-channel", "Private channel member post and denied recovery", {
      channel: verification.privateChannel?.channel ?? null,
      allowedState: verification.privateChannel?.allowed?.submitPost?.state ?? null,
      deniedStatus: verification.privateChannel?.denied?.status ?? null,
      passed:
        verification.privateChannel?.status === "passed" &&
        verification.privateChannel?.channel === "private:mafia_day_chat" &&
        verification.privateChannel?.allowed?.submitPost?.state === "ack" &&
        verification.privateChannel?.denied?.status === 403,
    }),
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
        verification.replacementConsole?.processReplacement?.commandStatus?.state ===
          "ack" &&
        verification.replacementConsole?.processReplacement?.commandStatus?.requestEnvelope
          ?.body?.body?.principal_user_id === "host_h" &&
        verification.replacementConsole?.processReplacement?.commandStatus?.requestEnvelope
          ?.body?.body?.command?.ProcessReplacement?.slot === "slot-7" &&
        verification.replacementConsole?.processReplacement?.commandStatus?.requestEnvelope
          ?.body?.body?.command?.ProcessReplacement?.outgoing_user === "player-mira" &&
        verification.replacementConsole?.processReplacement?.commandStatus?.requestEnvelope
          ?.body?.body?.command?.ProcessReplacement?.incoming_user === "player-rowan" &&
        verification.replacementConsole?.projectedReplacement?.slotId === "slot-7" &&
        verification.replacementConsole?.projectedReplacement?.occupantLabel ===
          "player-rowan" &&
        verification.replacementConsole?.projectedReplacement?.historyLabel?.includes(
          "slot-7",
        ) === true &&
        verification.replacementConsole?.apiSlot?.slot_id === "slot-7" &&
        verification.replacementConsole?.apiSlot?.occupant_user_id === "player-rowan",
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
          ?.requestEnvelope?.body?.body?.principal_user_id === "host_h" &&
        verification.replacementConsole?.replacementIdempotentRetry?.retryReplacement
          ?.requestEnvelope?.body?.body?.command_id ===
          verification.replacementConsole?.processReplacement?.commandStatus
            ?.requestEnvelope?.body?.body?.command_id &&
        verification.replacementConsole?.replacementIdempotentRetry?.retryReplacement
          ?.requestEnvelope?.body?.body?.command?.ProcessReplacement?.slot ===
          "slot-7" &&
        verification.replacementConsole?.replacementIdempotentRetry?.retryReplacement
          ?.requestEnvelope?.body?.body?.command?.ProcessReplacement?.outgoing_user ===
          "player-mira" &&
        verification.replacementConsole?.replacementIdempotentRetry?.retryReplacement
          ?.requestEnvelope?.body?.body?.command?.ProcessReplacement?.incoming_user ===
          "player-rowan" &&
        verification.replacementConsole?.replacementIdempotentRetry
          ?.hostProjectionAfterRetry?.slotId === "slot-7" &&
        verification.replacementConsole?.replacementIdempotentRetry
          ?.hostProjectionAfterRetry?.occupantLabel === "player-rowan" &&
        verification.replacementConsole?.replacementIdempotentRetry
          ?.hostProjectionAfterRetry?.historyLabel?.includes("slot-7") === true &&
        verification.replacementConsole?.replacementIdempotentRetry?.apiSlotAfterRetry
          ?.slot_id === "slot-7" &&
        verification.replacementConsole?.replacementIdempotentRetry?.apiSlotAfterRetry
          ?.occupant_user_id === "player-rowan",
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
        verification.replacementConsole?.incomingPlayer?.vote?.requestEnvelope?.body?.body
          ?.principal_user_id === "player-rowan" &&
        verification.replacementConsole?.incomingPlayer?.vote?.requestEnvelope?.body?.body
          ?.command?.SubmitVote?.actor_slot === "slot-7" &&
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
      cleanupLocked: hardening.stalePlayerVote?.hostPhaseAfterUnlock?.locked ?? null,
      passed:
        hardening.stalePlayerVote?.status === "passed" &&
        hardening.stalePlayerVote?.reject?.error === "PhaseLocked" &&
        hardening.stalePlayerVote?.phaseAfterReject?.locked === true &&
        hardening.stalePlayerVote?.hostPhaseAfterUnlock?.locked === false,
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
        hardening.concurrentVoteRace?.targetSlot === "slot_5" &&
        hardening.concurrentVoteRace?.playerVote?.state === "ack" &&
        hardening.concurrentVoteRace?.actionVote?.state === "ack" &&
        !sameArray(
          hardening.concurrentVoteRace?.playerVote?.streamSeqs,
          hardening.concurrentVoteRace?.actionVote?.streamSeqs,
        ) &&
        hardening.concurrentVoteRace?.apiProjection?.count === 2,
    }),
    lane("stale-action-conflict", "Stale player action rejects and refreshes command state", {
      rejectError: hardening.staleActionConflict?.reject?.error ?? null,
      stalePhase: hardening.staleActionConflict?.staleN01Phase?.phaseId ?? null,
      refreshedPhase: hardening.staleActionConflict?.phaseAfterReject?.phaseId ?? null,
      actionVisibleAfterRefresh:
        hardening.staleActionConflict?.actionVisibleAfterRefresh ?? null,
      passed:
        hardening.staleActionConflict?.status === "passed" &&
        hardening.staleActionConflict?.reject?.error === "PhaseLocked" &&
        hardening.staleActionConflict?.staleN01Phase?.phaseId === "N01" &&
        hardening.staleActionConflict?.phaseAfterReject?.phaseId === "D02" &&
        hardening.staleActionConflict?.actionVisibleAfterRefresh === false,
    }),
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
        hardening.staleHostControl?.activityRow?.actionId === "unlock_thread" &&
        hardening.staleHostControl?.dispatchPlan?.projectionRefreshKeys?.includes(
          "host",
        ) === true &&
        hardening.staleHostControl?.visibleActionsAfterReject?.includes(
          "resolve_phase",
        ) === true &&
        hardening.staleHostControl?.visibleActionsAfterReject?.includes(
          "lock_thread",
        ) === true &&
        hardening.staleHostControl?.visibleActionsAfterReject?.includes(
          "unlock_thread",
        ) === false &&
        hardening.staleHostControl?.apiPhaseAfterReject?.phase_id === "D02" &&
        hardening.staleHostControl?.apiPhaseAfterReject?.locked === false,
    }),
    lane("stale-cohost-deadline", "Stale cohost deadline control rejects without drift", {
      rejectError: hardening.staleCohostDeadline?.reject?.error ?? null,
      stalePhase: hardening.staleCohostDeadline?.setup?.stalePhase?.id ?? null,
      phaseId: hardening.staleCohostDeadline?.phaseAfterReject?.id ?? null,
      activitySource: hardening.staleCohostDeadline?.activityRow?.source ?? null,
      currentActions: hardening.staleCohostDeadline?.deadlineActionsAfterReject ?? null,
      apiDeadline: hardening.staleCohostDeadline?.apiPhaseAfterReject?.deadline ?? null,
      passed:
        hardening.staleCohostDeadline?.status === "passed" &&
        hardening.staleCohostDeadline?.setup?.stalePhase?.id === "D01" &&
        hardening.staleCohostDeadline?.setup?.stalePhase?.locked === false &&
        hardening.staleCohostDeadline?.setup?.deadlineActions?.includes(
          "extend_deadline",
        ) === true &&
        hardening.staleCohostDeadline?.setup?.phaseActions?.length === 0 &&
        hardening.staleCohostDeadline?.reject?.error === "PhaseLocked" &&
        hardening.staleCohostDeadline?.reject?.message?.includes(
          "stale phase state",
        ) === true &&
        hardening.staleCohostDeadline?.phaseAfterReject?.id === "D02" &&
        hardening.staleCohostDeadline?.phaseAfterReject?.locked === false &&
        hardening.staleCohostDeadline?.deadlineActionsAfterReject?.includes(
          "extend_deadline",
        ) === true &&
        hardening.staleCohostDeadline?.phaseActionsAfterReject?.length === 0 &&
        hardening.staleCohostDeadline?.activityRow?.source === "outcome" &&
        hardening.staleCohostDeadline?.activityRow?.actionId === "extend_deadline" &&
        hardening.staleCohostDeadline?.dispatchPlan?.projectionRefreshKeys?.includes(
          "host",
        ) === true &&
        hardening.staleCohostDeadline?.apiPhaseAfterReject?.phase_id === "D02" &&
        hardening.staleCohostDeadline?.apiPhaseAfterReject?.locked === false &&
        hardening.staleCohostDeadline?.apiPhaseAfterReject?.deadline === null,
    }),
  ];
  const status = lanes.every((item) => item.status === "passed") ? "passed" : "failed";
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
  for (const laneId of requiredLaneIds) {
    if (!proof.lanes?.some((laneItem) => laneItem.id === laneId && laneItem.status === "passed")) {
      throw new Error(`dev-test-game proof missing passed lane: ${laneId}`);
    }
  }
  return proof;
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
