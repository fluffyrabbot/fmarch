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
  "day-vote-resolution",
  "day-vote-no-lynch",
  "action-loop",
  "host-deadline-advance",
  "stale-deadline-advance",
  "invalid-action-recovery",
  "resolution-receipts",
  "dead-player-recovery",
  "player-action-boundary",
  "private-channel",
  "replacement-host-issued-invite",
  "replacement-pending-player",
  "replacement-redeemed-invite-recovery",
  "replacement-session-revocation-recovery",
  "replacement-session-refresh-recovery",
  "replacement-stale-session-after-refresh",
  "replacement-reconnect-recovery",
  "stale-host-invite-recovery",
  "replacement-stale-conflict-message",
  "replacement-invalid-target-recovery",
  "replacement-console",
  "replacement-idempotent-retry",
  "replacement-stale-success-recovery",
  "replacement-stale-player",
  "replacement-stale-action",
  "replacement-stale-private-channel",
  "replacement-stale-private-receipts",
  "replacement-incoming-player",
  "idempotent-retry",
  "reconnect-recovery",
  "stale-player-vote",
  "concurrent-vote-race",
  "host-votecount-publication",
  "stale-host-publish",
  "host-lifecycle-control",
  "stale-host-lifecycle",
  "host-modkill-control",
  "stale-host-modkill",
  "stale-host-prompt",
  "stale-host-complete",
  "stale-player-complete",
  "stale-dead-action-conflict",
  "stale-action-conflict",
  "stale-action-conflict-message",
  "stale-host-control",
  "stale-host-resolve",
  "stale-host-advance",
  "stale-host-deadline",
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
        verification.coreLoop?.lockedVoteControl?.exists === false &&
        verification.coreLoop?.lockedVoteControl?.disabled === true &&
        verification.coreLoop?.rejectedVote?.error === "PhaseLocked" &&
        verification.coreLoop?.lock?.commandStatus?.state === "ack" &&
        verification.coreLoop?.unlock?.commandStatus?.state === "ack",
    }),
    lane("day-vote-resolution", "Day vote resolves through role URLs", {
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
    lane("day-vote-no-lynch", "No-lynch day vote resolves without a death", {
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
          "advance_phase_by_deadline",
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
          "advance_phase_by_deadline" &&
        verification.actionLoop?.staleDeadlineAdvance?.dispatchPlan?.projectionRefreshKeys?.includes(
          "host",
        ) === true &&
        verification.actionLoop?.staleDeadlineAdvance?.visibleActionsAfterReject?.includes(
          "resolve_phase",
        ) === true &&
        verification.actionLoop?.staleDeadlineAdvance?.visibleActionsAfterReject?.includes(
          "lock_thread",
        ) === true &&
        verification.actionLoop?.staleDeadlineAdvance?.visibleActionsAfterReject?.includes(
          "advance_phase_by_deadline",
        ) === false &&
        verification.actionLoop?.staleDeadlineAdvance?.apiPhaseAfterReject?.phase_id ===
          "N01" &&
        verification.actionLoop?.staleDeadlineAdvance?.apiPhaseAfterReject?.locked ===
          false &&
        verification.actionLoop?.staleDeadlineAdvance?.apiPhaseAfterReject?.deadline ===
          null,
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
      rejectError:
        verification.replacementConsole?.staleReplacementAfterSuccess?.reject?.error ??
        null,
      activityStatus:
        verification.replacementConsole?.staleReplacementAfterSuccess
          ?.activityStatusText ?? null,
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
        hardening.hostVotecountPublication?.expectedBody ===
          "Official votecount for D02\n- slot_5: 2" &&
        hardening.hostVotecountPublication?.playerThreadPost?.body ===
          hardening.hostVotecountPublication?.expectedBody &&
        hardening.hostVotecountPublication?.playerThreadPost?.authorLabel === "host" &&
        hardening.hostVotecountPublication?.apiThreadPost?.body ===
          hardening.hostVotecountPublication?.expectedBody &&
        hardening.hostVotecountPublication?.apiThreadPost?.author_user === "host" &&
        hardening.hostVotecountPublication?.activityStatusText?.includes(
          "Ack: stream seqs",
        ) === true,
    }),
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
          "slot lifecycle is already current",
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
          "slot lifecycle is already current",
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
    lane("stale-host-complete", "Stale complete-game reveal rejects after live completion", {
      rejectError: hardening.staleHostComplete?.reject?.error ?? null,
      liveCompleteSeqs:
        hardening.staleHostComplete?.liveComplete?.commandStatus?.streamSeqs ?? null,
      revealTextAfterReject:
        hardening.staleHostComplete?.revealTextAfterReject ?? null,
      roleActionsAfterReject:
        hardening.staleHostComplete?.roleActionsAfterReject ?? null,
      apiCompleted:
        hardening.staleHostComplete?.apiStateAfterReject?.completed ?? null,
      apiRevealedSlots:
        hardening.staleHostComplete?.apiStateAfterReject?.slots?.filter(
          (slot) => slot.role_revealed === true && slot.alignment_revealed === true,
        ).length ?? null,
      passed:
        hardening.staleHostComplete?.status === "passed" &&
        hardening.staleHostComplete?.setup?.roleActions?.includes("complete_game") ===
          true &&
        hardening.staleHostComplete?.setup?.slots?.length === 1 &&
        hardening.staleHostComplete?.setup?.slots?.every(
          (slot) => slot.role_revealed === false && slot.alignment_revealed === false,
        ) === true &&
        hardening.staleHostComplete?.liveComplete?.commandStatus?.state === "ack" &&
        Array.isArray(
          hardening.staleHostComplete?.liveComplete?.commandStatus?.streamSeqs,
        ) &&
        hardening.staleHostComplete.liveComplete.commandStatus.streamSeqs.length ===
          1 &&
        hardening.staleHostComplete?.reject?.state === "reject" &&
        hardening.staleHostComplete?.reject?.error === "GameAlreadyCompleted" &&
        hardening.staleHostComplete?.reject?.serverEnvelope?.body?.kind ===
          "Reject" &&
        Array.isArray(hardening.staleHostComplete?.reject?.streamSeqs) === false &&
        hardening.staleHostComplete?.slotsAfterReject?.length === 1 &&
        hardening.staleHostComplete?.slotsAfterReject?.every(
          (slot) => slot.role_revealed === true && slot.alignment_revealed === true,
        ) === true &&
        hardening.staleHostComplete?.revealTextAfterReject ===
          "All 1 slots revealed" &&
        hardening.staleHostComplete?.activityRow?.source === "outcome" &&
        hardening.staleHostComplete?.activityRow?.actionId === "complete_game" &&
        hardening.staleHostComplete?.activityRow?.dispatchKind ===
          "complete_game" &&
        hardening.staleHostComplete?.dispatchPlan?.projectionRefreshKeys?.includes(
          "host",
        ) === true &&
        hardening.staleHostComplete?.roleActionsAfterReject?.includes(
          "complete_game",
        ) === false &&
        hardening.staleHostComplete?.apiStateAfterReject?.completed === true &&
        hardening.staleHostComplete?.apiStateAfterReject?.slots?.length === 1 &&
        hardening.staleHostComplete?.apiStateAfterReject?.slots?.every(
          (slot) => slot.role_revealed === true && slot.alignment_revealed === true,
        ) === true,
    }),
    lane("stale-player-complete", "Stale player command rejects after live completion", {
      rejectError: hardening.stalePlayerComplete?.reject?.error ?? null,
      gameCompleted:
        hardening.stalePlayerComplete?.commandStateAfterReject?.gameCompleted ?? null,
      disabledButtons:
        hardening.stalePlayerComplete?.buttonsAfterReject?.filter(
          (button) => button.disabled === true,
        ).length ?? null,
      voteTargetsAfterReject:
        hardening.stalePlayerComplete?.commandStateAfterReject?.voteTargets?.length ?? null,
      passed:
        hardening.stalePlayerComplete?.status === "passed" &&
        hardening.stalePlayerComplete?.setupCommandState?.gameCompleted === false &&
        hardening.stalePlayerComplete?.setupCommandState?.voteTargets?.some(
          (target) => target.kind === "no_lynch",
        ) &&
        hardening.stalePlayerComplete?.staleVoteButton?.action?.startsWith(
          "submit_vote",
        ) === true &&
        hardening.stalePlayerComplete?.staleVoteButton?.disabled === false &&
        hardening.stalePlayerComplete?.liveComplete?.state === "ack" &&
        hardening.stalePlayerComplete?.reject?.state === "reject" &&
        hardening.stalePlayerComplete?.reject?.error === "GameAlreadyCompleted" &&
        hardening.stalePlayerComplete?.reject?.serverEnvelope?.body?.kind ===
          "Reject" &&
        Array.isArray(hardening.stalePlayerComplete?.reject?.streamSeqs) ===
          false &&
        hardening.stalePlayerComplete?.dispatchPlan?.projectionRefreshKeys?.includes(
          "commandState",
        ) === true &&
        hardening.stalePlayerComplete?.commandStateAfterReject?.gameCompleted ===
          true &&
        hardening.stalePlayerComplete?.commandStateAfterReject?.actions?.length ===
          0 &&
        hardening.stalePlayerComplete?.commandStateAfterReject?.voteTargets?.length ===
          0 &&
        hardening.stalePlayerComplete?.buttonsAfterReject?.every(
          (button) => button.disabled === true,
        ) === true &&
        hardening.stalePlayerComplete?.apiCommandStateAfterReject?.game_completed ===
          true &&
        hardening.stalePlayerComplete?.apiCommandStateAfterReject?.actions?.length ===
          0 &&
        hardening.stalePlayerComplete?.apiCommandStateAfterReject?.vote_targets?.length ===
          0,
    }),
    lane("stale-dead-action-conflict", "Stale action actor death rejects and refreshes", {
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
      rejectError: hardening.staleActionConflict?.reject?.error ?? null,
      rejectMessage: hardening.staleActionConflict?.reject?.message ?? null,
      stalePhase: hardening.staleActionConflict?.staleN01Phase?.phaseId ?? null,
      refreshedPhase: hardening.staleActionConflict?.phaseAfterReject?.phaseId ?? null,
      actionVisibleAfterRefresh:
        hardening.staleActionConflict?.actionVisibleAfterRefresh ?? null,
      passed:
        hardening.staleActionConflict?.status === "passed" &&
        hardening.staleActionConflict?.reject?.error === "PhaseLocked" &&
        hardening.staleActionConflict?.reject?.message?.includes(
          "stale action state",
        ) === true &&
        hardening.staleActionConflict?.reject?.message?.includes(
          "current action controls",
        ) === true &&
        hardening.staleActionConflict?.staleN01Phase?.phaseId === "N01" &&
        hardening.staleActionConflict?.phaseAfterReject?.phaseId === "D02" &&
        hardening.staleActionConflict?.actionVisibleAfterRefresh === false,
    }),
    lane("stale-action-conflict-message", "Stale player action conflict message is explicit", {
      rejectError: hardening.staleActionConflict?.reject?.error ?? null,
      rejectMessage: hardening.staleActionConflict?.reject?.message ?? null,
      templateId: hardening.staleActionConflict?.actionConfig?.templateId ?? null,
      stalePhase: hardening.staleActionConflict?.staleN01Phase?.phaseId ?? null,
      refreshedPhase: hardening.staleActionConflict?.phaseAfterReject?.phaseId ?? null,
      passed:
        hardening.staleActionConflict?.status === "passed" &&
        hardening.staleActionConflict?.reject?.error === "PhaseLocked" &&
        hardening.staleActionConflict?.reject?.message?.includes(
          "stale action state",
        ) === true &&
        hardening.staleActionConflict?.reject?.message?.includes(
          "current action controls",
        ) === true &&
        hardening.staleActionConflict?.actionConfig?.templateId ===
          "factional_kill" &&
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
    lane("stale-host-resolve", "Stale host resolve rejects after live resolution", {
      rejectError: hardening.staleHostResolve?.reject?.error ?? null,
      stalePhase: hardening.staleHostResolve?.setup?.stalePhase?.id ?? null,
      liveResolveSeqs:
        hardening.staleHostResolve?.liveResolve?.commandStatus?.streamSeqs ?? null,
      phaseId: hardening.staleHostResolve?.phaseAfterReject?.id ?? null,
      locked: hardening.staleHostResolve?.phaseAfterReject?.locked ?? null,
      phaseActions: hardening.staleHostResolve?.phaseActionsAfterReject ?? null,
      restoreLocked: hardening.staleHostResolve?.apiPhaseAfterRestore?.locked ?? null,
      passed:
        hardening.staleHostResolve?.status === "passed" &&
        hardening.staleHostResolve?.setup?.stalePhase?.id === "D02" &&
        hardening.staleHostResolve?.setup?.stalePhase?.locked === false &&
        hardening.staleHostResolve?.setup?.phaseActions?.includes(
          "resolve_phase",
        ) === true &&
        hardening.staleHostResolve?.setup?.phaseActions?.includes("lock_thread") ===
          true &&
        hardening.staleHostResolve?.liveResolve?.commandStatus?.state === "ack" &&
        Array.isArray(
          hardening.staleHostResolve?.liveResolve?.commandStatus?.streamSeqs,
        ) &&
        hardening.staleHostResolve.liveResolve.commandStatus.streamSeqs.length > 0 &&
        hardening.staleHostResolve?.reject?.state === "reject" &&
        hardening.staleHostResolve?.reject?.error === "PhaseLocked" &&
        hardening.staleHostResolve?.reject?.serverEnvelope?.body?.kind === "Reject" &&
        Array.isArray(hardening.staleHostResolve?.reject?.streamSeqs) === false &&
        hardening.staleHostResolve?.reject?.message?.includes(
          "stale phase state",
        ) === true &&
        hardening.staleHostResolve?.phaseAfterReject?.id === "D02" &&
        hardening.staleHostResolve?.phaseAfterReject?.locked === true &&
        hardening.staleHostResolve?.phaseActionsAfterReject?.includes(
          "unlock_thread",
        ) === true &&
        hardening.staleHostResolve?.phaseActionsAfterReject?.includes(
          "advance_phase",
        ) === true &&
        hardening.staleHostResolve?.phaseActionsAfterReject?.includes(
          "resolve_phase",
        ) === false &&
        hardening.staleHostResolve?.activityRow?.source === "outcome" &&
        hardening.staleHostResolve?.activityRow?.actionId === "resolve_phase" &&
        hardening.staleHostResolve?.dispatchPlan?.projectionRefreshKeys?.includes(
          "host",
        ) === true &&
        hardening.staleHostResolve?.apiPhaseAfterReject?.phase_id === "D02" &&
        hardening.staleHostResolve?.apiPhaseAfterReject?.locked === true &&
        hardening.staleHostResolve?.restoreAfterReject?.commandStatus?.state === "ack" &&
        hardening.staleHostResolve?.apiPhaseAfterRestore?.phase_id === "D02" &&
        hardening.staleHostResolve?.apiPhaseAfterRestore?.locked === false,
    }),
    lane("stale-host-advance", "Stale host advance rejects after live unlock", {
      rejectError: hardening.staleHostAdvance?.reject?.error ?? null,
      stalePhase: hardening.staleHostAdvance?.setup?.stalePhase?.id ?? null,
      liveUnlockSeqs:
        hardening.staleHostAdvance?.liveUnlock?.commandStatus?.streamSeqs ?? null,
      phaseId: hardening.staleHostAdvance?.phaseAfterReject?.id ?? null,
      locked: hardening.staleHostAdvance?.phaseAfterReject?.locked ?? null,
      phaseActions: hardening.staleHostAdvance?.phaseActionsAfterReject ?? null,
      passed:
        hardening.staleHostAdvance?.status === "passed" &&
        hardening.staleHostAdvance?.setup?.stalePhase?.id === "D02" &&
        hardening.staleHostAdvance?.setup?.stalePhase?.locked === true &&
        hardening.staleHostAdvance?.setup?.phaseActions?.includes(
          "advance_phase",
        ) === true &&
        hardening.staleHostAdvance?.setup?.phaseActions?.includes("unlock_thread") ===
          true &&
        hardening.staleHostAdvance?.liveUnlock?.commandStatus?.state === "ack" &&
        Array.isArray(
          hardening.staleHostAdvance?.liveUnlock?.commandStatus?.streamSeqs,
        ) &&
        hardening.staleHostAdvance.liveUnlock.commandStatus.streamSeqs.length > 0 &&
        hardening.staleHostAdvance?.reject?.state === "reject" &&
        hardening.staleHostAdvance?.reject?.error === "InvalidTarget" &&
        hardening.staleHostAdvance?.reject?.serverEnvelope?.body?.kind === "Reject" &&
        Array.isArray(hardening.staleHostAdvance?.reject?.streamSeqs) === false &&
        hardening.staleHostAdvance?.reject?.message?.includes(
          "stale phase state",
        ) === true &&
        hardening.staleHostAdvance?.phaseAfterReject?.id === "D02" &&
        hardening.staleHostAdvance?.phaseAfterReject?.locked === false &&
        hardening.staleHostAdvance?.phaseActionsAfterReject?.includes(
          "resolve_phase",
        ) === true &&
        hardening.staleHostAdvance?.phaseActionsAfterReject?.includes(
          "lock_thread",
        ) === true &&
        hardening.staleHostAdvance?.phaseActionsAfterReject?.includes(
          "advance_phase",
        ) === false &&
        hardening.staleHostAdvance?.activityRow?.source === "outcome" &&
        hardening.staleHostAdvance?.activityRow?.actionId === "advance_phase" &&
        hardening.staleHostAdvance?.dispatchPlan?.projectionRefreshKeys?.includes(
          "host",
        ) === true &&
        hardening.staleHostAdvance?.apiPhaseAfterReject?.phase_id === "D02" &&
        hardening.staleHostAdvance?.apiPhaseAfterReject?.locked === false,
    }),
    lane("stale-host-deadline", "Stale host deadline control rejects without drift", {
      rejectError: hardening.staleHostDeadline?.reject?.error ?? null,
      stalePhase: hardening.staleHostDeadline?.setup?.stalePhase?.id ?? null,
      phaseId: hardening.staleHostDeadline?.phaseAfterReject?.id ?? null,
      activitySource: hardening.staleHostDeadline?.activityRow?.source ?? null,
      deadlineActions: hardening.staleHostDeadline?.deadlineActionsAfterReject ?? null,
      phaseActions: hardening.staleHostDeadline?.phaseActionsAfterReject ?? null,
      apiDeadline: hardening.staleHostDeadline?.apiPhaseAfterReject?.deadline ?? null,
      passed:
        hardening.staleHostDeadline?.status === "passed" &&
        hardening.staleHostDeadline?.setup?.stalePhase?.id === "D01" &&
        hardening.staleHostDeadline?.setup?.stalePhase?.locked === false &&
        hardening.staleHostDeadline?.setup?.deadlineActions?.includes(
          "extend_deadline",
        ) === true &&
        hardening.staleHostDeadline?.setup?.phaseActions?.includes(
          "resolve_phase",
        ) === true &&
        hardening.staleHostDeadline?.setup?.phaseActions?.includes("lock_thread") ===
          true &&
        hardening.staleHostDeadline?.reject?.error === "PhaseLocked" &&
        hardening.staleHostDeadline?.reject?.message?.includes(
          "stale phase state",
        ) === true &&
        hardening.staleHostDeadline?.phaseAfterReject?.id === "D02" &&
        hardening.staleHostDeadline?.phaseAfterReject?.locked === false &&
        hardening.staleHostDeadline?.deadlineActionsAfterReject?.includes(
          "extend_deadline",
        ) === true &&
        hardening.staleHostDeadline?.phaseActionsAfterReject?.includes(
          "resolve_phase",
        ) === true &&
        hardening.staleHostDeadline?.phaseActionsAfterReject?.includes(
          "lock_thread",
        ) === true &&
        hardening.staleHostDeadline?.activityRow?.source === "outcome" &&
        hardening.staleHostDeadline?.activityRow?.actionId === "extend_deadline" &&
        hardening.staleHostDeadline?.dispatchPlan?.projectionRefreshKeys?.includes(
          "host",
        ) === true &&
        hardening.staleHostDeadline?.apiPhaseAfterReject?.phase_id === "D02" &&
        hardening.staleHostDeadline?.apiPhaseAfterReject?.locked === false &&
        hardening.staleHostDeadline?.apiPhaseAfterReject?.deadline === null,
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
