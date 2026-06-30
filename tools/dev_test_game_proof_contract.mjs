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
  "action-idempotent-retry",
  "concurrent-action-race",
  "concurrent-action-race-reload",
  "reconnect-recovery",
  "stale-player-vote",
  "stale-player-vote-after-change",
  "stale-player-withdraw-after-change",
  "stale-player-withdraw-after-phase-closure",
  "stale-player-vote-after-phase-closure",
  "stale-player-post-after-phase-closure",
  "concurrent-player-vote-resolve-race",
  "concurrent-player-vote-resolve-race-reload",
  "concurrent-player-action-advance-race",
  "concurrent-player-action-advance-race-reload",
  "concurrent-cohost-deadline-resolve-race",
  "concurrent-cohost-deadline-resolve-race-reload",
  "concurrent-replacement-private-post-race",
  "concurrent-replacement-vote-race",
  "concurrent-replacement-action-race",
  "replacement-incoming-action",
  "replacement-action-reconnect",
  "replacement-stale-action-after-resolve",
  "replacement-stale-private-post-after-resolve",
  "replacement-stale-private-post-reconnect",
  "replacement-stale-private-post-after-complete",
  "replacement-stale-private-post-after-complete-reload",
  "stale-dead-target-vote",
  "dead-current-vote",
  "concurrent-vote-race",
  "concurrent-vote-race-reload",
  "stale-host-publish-after-change",
  "host-votecount-publication",
  "stale-host-publish",
  "host-lifecycle-control",
  "stale-host-lifecycle",
  "host-modkill-control",
  "stale-host-modkill",
  "concurrent-host-lifecycle-race",
  "stale-host-prompt",
  "stale-host-prompt-reload",
  "stale-host-complete",
  "stale-host-complete-reload",
  "concurrent-host-complete-race",
  "concurrent-player-complete-race",
  "public-player-complete-reload",
  "stale-player-complete",
  "stale-player-complete-reload",
  "stale-same-action-recovery",
  "stale-dead-action-conflict",
  "stale-action-conflict",
  "stale-action-conflict-message",
  "stale-host-control",
  "concurrent-host-resolve-race",
  "concurrent-host-resolve-race-reload",
  "concurrent-host-advance-race",
  "concurrent-host-deadline-advance-race",
  "concurrent-host-mixed-advance-race",
  "stale-host-resolve",
  "stale-host-resolve-reload",
  "stale-host-advance",
  "stale-host-advance-reload",
  "stale-host-deadline",
  "stale-host-deadline-reload",
  "stale-cohost-deadline",
  "stale-cohost-deadline-reload",
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
          hardening.stalePlayerVoteAfterChange?.status === "passed" &&
          hardening.stalePlayerVoteAfterChange?.commandStateBeforeClose?.currentVote ===
            null &&
          hardening.stalePlayerVoteAfterChange?.commandStateBeforeClose?.voteTargets?.some(
            (target) =>
              target.kind === "slot" &&
              target.slotId ===
                hardening.stalePlayerVoteAfterChange?.staleVoteTarget?.slotId,
          ) === true &&
          hardening.stalePlayerVoteAfterChange?.staleVoteButton?.disabled ===
            false &&
          hardening.stalePlayerVoteAfterChange?.closedStatus?.state === "closed" &&
          hardening.stalePlayerVoteAfterChange?.actionVote?.state === "ack" &&
          normalizedVotecountRows(
            hardening.stalePlayerVoteAfterChange?.apiVotecountAfterActionVote,
          ).some(
            (row) =>
              row.phaseId === "D02" &&
              row.target === "no_lynch" &&
              row.count === 1,
          ) === true &&
          hardening.stalePlayerVoteAfterChange?.staleVote?.state === "ack" &&
          hardening.stalePlayerVoteAfterChange?.staleVote?.requestEnvelope?.body?.body
            ?.command?.SubmitVote?.target?.Slot ===
            hardening.stalePlayerVoteAfterChange?.staleVoteTarget?.slotId &&
          hardening.stalePlayerVoteAfterChange?.commandStateAfterAck?.currentVote
            ?.slotId ===
            hardening.stalePlayerVoteAfterChange?.staleVoteTarget?.slotId &&
          hardening.stalePlayerVoteAfterChange?.votecountAfterAck?.some(
            (row) => row.target === "no_lynch" && row.count === 1,
          ) === true &&
          hardening.stalePlayerVoteAfterChange?.votecountAfterAck?.some(
            (row) =>
              row.target ===
                hardening.stalePlayerVoteAfterChange?.staleVoteTarget?.slotId &&
              row.count === 1,
          ) === true &&
          hardening.stalePlayerVoteAfterChange?.dispatchPlan?.projectionRefreshKeys?.includes(
            "votecount",
          ) === true &&
          hardening.stalePlayerVoteAfterChange?.dispatchPlan?.projectionRefreshKeys?.includes(
            "commandState",
          ) === true &&
          hardening.stalePlayerVoteAfterChange?.currentVoteAfterAck?.hasVote ===
            "true" &&
          normalizedVotecountRows(
            hardening.stalePlayerVoteAfterChange?.apiVotecountAfterAck,
          ).some(
            (row) =>
              row.phaseId === "D02" &&
              row.target === "no_lynch" &&
              row.count === 1,
          ) === true &&
          normalizedVotecountRows(
            hardening.stalePlayerVoteAfterChange?.apiVotecountAfterAck,
          ).some(
            (row) =>
              row.phaseId === "D02" &&
              row.target ===
                hardening.stalePlayerVoteAfterChange?.staleVoteTarget?.slotId &&
              row.count === 1,
          ) === true &&
          hardening.stalePlayerVoteAfterChange?.apiCommandStateAfterAck?.current_vote
            ?.slot_id ===
            hardening.stalePlayerVoteAfterChange?.staleVoteTarget?.slotId &&
          hardening.stalePlayerVoteAfterChange?.withdrawPlayer?.state === "ack" &&
          hardening.stalePlayerVoteAfterChange?.withdrawAction?.state === "ack" &&
          normalizedVotecountRows(
            hardening.stalePlayerVoteAfterChange?.apiVotecountAfterCleanup,
          ).length === 0 &&
          hardening.stalePlayerVoteAfterChange?.apiCommandStateAfterCleanup
            ?.current_vote === null,
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
          hardening.stalePlayerWithdrawAfterChange?.status === "passed" &&
          hardening.stalePlayerWithdrawAfterChange?.commandStateBeforeVote
            ?.currentVote === null &&
          hardening.stalePlayerWithdrawAfterChange?.staleVoteTarget?.kind ===
            "slot" &&
          hardening.stalePlayerWithdrawAfterChange?.staleVoteButton?.disabled ===
            false &&
          hardening.stalePlayerWithdrawAfterChange?.initialVote?.state ===
            "ack" &&
          hardening.stalePlayerWithdrawAfterChange?.commandStateBeforeClose
            ?.currentVote?.slotId ===
            hardening.stalePlayerWithdrawAfterChange?.staleVoteTarget?.slotId &&
          hardening.stalePlayerWithdrawAfterChange?.currentVoteBeforeClose
            ?.hasVote === "true" &&
          hardening.stalePlayerWithdrawAfterChange?.withdrawBeforeClose?.exists ===
            true &&
          hardening.stalePlayerWithdrawAfterChange?.withdrawBeforeClose?.disabled ===
            false &&
          hardening.stalePlayerWithdrawAfterChange?.closedStatus?.state ===
            "closed" &&
          hardening.stalePlayerWithdrawAfterChange?.liveChangeVote?.state ===
            "ack" &&
          hardening.stalePlayerWithdrawAfterChange?.apiCommandStateAfterLiveChange
            ?.current_vote?.kind === "no_lynch" &&
          normalizedVotecountRows(
            hardening.stalePlayerWithdrawAfterChange?.apiVotecountAfterLiveChange,
          ).some(
            (row) =>
              row.phaseId === "D02" &&
              row.target === "no_lynch" &&
              row.count === 1,
          ) === true &&
          normalizedVotecountRows(
            hardening.stalePlayerWithdrawAfterChange?.apiVotecountAfterLiveChange,
          ).some(
            (row) =>
              row.phaseId === "D02" &&
              row.target ===
                hardening.stalePlayerWithdrawAfterChange?.staleVoteTarget?.slotId,
          ) === false &&
          hardening.stalePlayerWithdrawAfterChange?.staleWithdraw?.state ===
            "ack" &&
          hardening.stalePlayerWithdrawAfterChange?.staleWithdraw?.requestEnvelope
            ?.body?.body?.command?.WithdrawVote?.actor_slot === "slot-7" &&
          hardening.stalePlayerWithdrawAfterChange?.commandStateAfterWithdraw
            ?.currentVote === null &&
          hardening.stalePlayerWithdrawAfterChange?.votecountAfterWithdraw
            ?.length === 0 &&
          hardening.stalePlayerWithdrawAfterChange?.dispatchPlan?.projectionRefreshKeys?.includes(
            "votecount",
          ) === true &&
          hardening.stalePlayerWithdrawAfterChange?.dispatchPlan?.projectionRefreshKeys?.includes(
            "commandState",
          ) === true &&
          hardening.stalePlayerWithdrawAfterChange?.currentVoteAfterWithdraw
            ?.hasVote === "false" &&
          hardening.stalePlayerWithdrawAfterChange?.currentVoteAfterWithdraw?.text?.includes(
            "No current vote",
          ) === true &&
          hardening.stalePlayerWithdrawAfterChange?.withdrawAfterAck?.disabled ===
            true &&
          hardening.stalePlayerWithdrawAfterChange?.withdrawAfterAck?.reason ===
            "No current vote" &&
          hardening.stalePlayerWithdrawAfterChange?.apiCommandStateAfterWithdraw
            ?.current_vote === null &&
          normalizedVotecountRows(
            hardening.stalePlayerWithdrawAfterChange?.apiVotecountAfterWithdraw,
          ).length === 0,
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
          hardening.stalePlayerWithdrawAfterPhaseClosure?.status === "passed" &&
          hardening.stalePlayerWithdrawAfterPhaseClosure?.hostEntry
            ?.capabilityKinds?.includes("HostOf") === true &&
          hardening.stalePlayerWithdrawAfterPhaseClosure?.playerEntry
            ?.capabilityKinds?.includes("SlotOccupant") === true &&
          hardening.stalePlayerWithdrawAfterPhaseClosure?.commandStateBeforeClose
            ?.actorSlot === "slot-7" &&
          hardening.stalePlayerWithdrawAfterPhaseClosure?.commandStateBeforeClose
            ?.phase?.phaseId === "D01" &&
          hardening.stalePlayerWithdrawAfterPhaseClosure?.commandStateBeforeClose
            ?.phase?.locked === false &&
          hardening.stalePlayerWithdrawAfterPhaseClosure?.commandStateBeforeClose
            ?.currentVote?.slotId === "slot-2" &&
          hardening.stalePlayerWithdrawAfterPhaseClosure?.currentVoteBeforeClose
            ?.hasVote === "true" &&
          hardening.stalePlayerWithdrawAfterPhaseClosure?.withdrawBeforeClose
            ?.exists === true &&
          hardening.stalePlayerWithdrawAfterPhaseClosure?.withdrawBeforeClose
            ?.disabled === false &&
          hardening.stalePlayerWithdrawAfterPhaseClosure?.closedStatus?.state ===
            "closed" &&
          hardening.stalePlayerWithdrawAfterPhaseClosure?.resolveDay
            ?.commandStatus?.state === "ack" &&
          hardening.stalePlayerWithdrawAfterPhaseClosure?.hostAfterResolve
            ?.phase?.locked === true &&
          hardening.stalePlayerWithdrawAfterPhaseClosure?.hostAfterResolve
            ?.dayVoteOutcomes?.some(
              (row) =>
                row.phaseId === "D01" &&
                row.status === "Lynch" &&
                row.winnerSlot === "slot-2",
            ) === true &&
          hardening.stalePlayerWithdrawAfterPhaseClosure
            ?.apiCommandStateAfterResolve?.phase?.locked === true &&
          hardening.stalePlayerWithdrawAfterPhaseClosure
            ?.apiCommandStateAfterResolve?.current_vote === null &&
          hardening.stalePlayerWithdrawAfterPhaseClosure
            ?.apiCommandStateAfterResolve?.vote_targets?.length === 0 &&
          hardening.stalePlayerWithdrawAfterPhaseClosure?.staleWithdraw?.state ===
            "reject" &&
          hardening.stalePlayerWithdrawAfterPhaseClosure?.staleWithdraw?.error ===
            "PhaseLocked" &&
          hardening.stalePlayerWithdrawAfterPhaseClosure?.staleWithdraw
            ?.serverEnvelope?.body?.kind === "Reject" &&
          Array.isArray(
            hardening.stalePlayerWithdrawAfterPhaseClosure?.staleWithdraw
              ?.streamSeqs,
          ) === false &&
          hardening.stalePlayerWithdrawAfterPhaseClosure?.staleWithdraw
            ?.requestEnvelope?.body?.body?.command?.WithdrawVote?.actor_slot ===
            "slot-7" &&
          hardening.stalePlayerWithdrawAfterPhaseClosure?.dispatchPlan?.projectionRefreshKeys?.includes(
            "votecount",
          ) === true &&
          hardening.stalePlayerWithdrawAfterPhaseClosure?.dispatchPlan?.projectionRefreshKeys?.includes(
            "commandState",
          ) === true &&
          hardening.stalePlayerWithdrawAfterPhaseClosure?.commandStateAfterReject
            ?.phase?.locked === true &&
          hardening.stalePlayerWithdrawAfterPhaseClosure?.commandStateAfterReject
            ?.voteTargets?.length === 0 &&
          hardening.stalePlayerWithdrawAfterPhaseClosure?.commandStateAfterReject
            ?.currentVote === null &&
          hardening.stalePlayerWithdrawAfterPhaseClosure?.currentVoteAfterReject
            ?.hasVote === "false" &&
          hardening.stalePlayerWithdrawAfterPhaseClosure?.withdrawAfterReject
            ?.disabled === true &&
          hardening.stalePlayerWithdrawAfterPhaseClosure?.withdrawAfterReject
            ?.reason === "No current vote" &&
          hardening.stalePlayerWithdrawAfterPhaseClosure?.buttonsAfterReject?.some(
            (button) => button.action?.startsWith("submit_vote"),
          ) === false &&
          hardening.stalePlayerWithdrawAfterPhaseClosure?.buttonsAfterReject?.some(
            (button) => button.action === "submit_post" && button.disabled === false,
          ) === true &&
          hardening.stalePlayerWithdrawAfterPhaseClosure?.dayVoteOutcomesAfterReject?.some(
            (row) =>
              row.phaseId === "D01" &&
              row.status === "Lynch" &&
              row.winnerSlot === "slot-2",
          ) === true &&
          hardening.stalePlayerWithdrawAfterPhaseClosure
            ?.apiCommandStateAfterReject?.phase?.locked === true &&
          hardening.stalePlayerWithdrawAfterPhaseClosure
            ?.apiCommandStateAfterReject?.vote_targets?.length === 0 &&
          hardening.stalePlayerWithdrawAfterPhaseClosure
            ?.apiCommandStateAfterReject?.current_vote === null,
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
          hardening.stalePlayerVoteAfterPhaseClosure?.status === "passed" &&
          hardening.stalePlayerVoteAfterPhaseClosure?.hostEntry?.capabilityKinds?.includes(
            "HostOf",
          ) === true &&
          hardening.stalePlayerVoteAfterPhaseClosure?.playerEntry?.capabilityKinds?.includes(
            "SlotOccupant",
          ) === true &&
          hardening.stalePlayerVoteAfterPhaseClosure?.commandStateBeforeClose
            ?.actorSlot === "slot-7" &&
          hardening.stalePlayerVoteAfterPhaseClosure?.commandStateBeforeClose
            ?.phase?.phaseId === "D01" &&
          hardening.stalePlayerVoteAfterPhaseClosure?.commandStateBeforeClose
            ?.phase?.locked === false &&
          hardening.stalePlayerVoteAfterPhaseClosure?.commandStateBeforeClose
            ?.currentVote?.slotId === "slot-2" &&
          hardening.stalePlayerVoteAfterPhaseClosure?.staleVoteTarget !==
            undefined &&
          hardening.stalePlayerVoteAfterPhaseClosure?.staleVoteButton?.disabled ===
            false &&
          hardening.stalePlayerVoteAfterPhaseClosure?.currentVoteBeforeClose
            ?.hasVote === "true" &&
          hardening.stalePlayerVoteAfterPhaseClosure?.closedStatus?.state ===
            "closed" &&
          hardening.stalePlayerVoteAfterPhaseClosure?.resolveDay?.commandStatus
            ?.state === "ack" &&
          hardening.stalePlayerVoteAfterPhaseClosure?.hostAfterResolve?.phase
            ?.locked === true &&
          hardening.stalePlayerVoteAfterPhaseClosure?.hostAfterResolve?.dayVoteOutcomes?.some(
            (row) =>
              row.phaseId === "D01" &&
              row.status === "Lynch" &&
              row.winnerSlot === "slot-2",
          ) === true &&
          hardening.stalePlayerVoteAfterPhaseClosure?.apiCommandStateAfterResolve
            ?.phase?.locked === true &&
          hardening.stalePlayerVoteAfterPhaseClosure?.apiCommandStateAfterResolve
            ?.current_vote === null &&
          hardening.stalePlayerVoteAfterPhaseClosure?.apiCommandStateAfterResolve
            ?.vote_targets?.length === 0 &&
          hardening.stalePlayerVoteAfterPhaseClosure?.staleVote?.state ===
            "reject" &&
          hardening.stalePlayerVoteAfterPhaseClosure?.staleVote?.error ===
            "PhaseLocked" &&
          hardening.stalePlayerVoteAfterPhaseClosure?.staleVote?.serverEnvelope
            ?.body?.kind === "Reject" &&
          Array.isArray(
            hardening.stalePlayerVoteAfterPhaseClosure?.staleVote?.streamSeqs,
          ) === false &&
          hardening.stalePlayerVoteAfterPhaseClosure?.staleVote?.requestEnvelope
            ?.body?.body?.command?.SubmitVote?.actor_slot === "slot-7" &&
          hardening.stalePlayerVoteAfterPhaseClosure?.dispatchPlan?.projectionRefreshKeys?.includes(
            "votecount",
          ) === true &&
          hardening.stalePlayerVoteAfterPhaseClosure?.dispatchPlan?.projectionRefreshKeys?.includes(
            "commandState",
          ) === true &&
          hardening.stalePlayerVoteAfterPhaseClosure?.commandStateAfterReject
            ?.phase?.locked === true &&
          hardening.stalePlayerVoteAfterPhaseClosure?.commandStateAfterReject
            ?.voteTargets?.length === 0 &&
          hardening.stalePlayerVoteAfterPhaseClosure?.commandStateAfterReject
            ?.currentVote === null &&
          hardening.stalePlayerVoteAfterPhaseClosure?.currentVoteAfterReject
            ?.hasVote === "false" &&
          hardening.stalePlayerVoteAfterPhaseClosure?.withdrawAfterReject
            ?.disabled === true &&
          hardening.stalePlayerVoteAfterPhaseClosure?.withdrawAfterReject
            ?.reason === "No current vote" &&
          hardening.stalePlayerVoteAfterPhaseClosure?.buttonsAfterReject?.some(
            (button) => button.action?.startsWith("submit_vote"),
          ) === false &&
          hardening.stalePlayerVoteAfterPhaseClosure?.buttonsAfterReject?.some(
            (button) => button.action === "submit_post" && button.disabled === false,
          ) === true &&
          hardening.stalePlayerVoteAfterPhaseClosure?.dayVoteOutcomesAfterReject?.some(
            (row) =>
              row.phaseId === "D01" &&
              row.status === "Lynch" &&
              row.winnerSlot === "slot-2",
          ) === true &&
          hardening.stalePlayerVoteAfterPhaseClosure?.apiCommandStateAfterReject
            ?.phase?.locked === true &&
          hardening.stalePlayerVoteAfterPhaseClosure?.apiCommandStateAfterReject
            ?.vote_targets?.length === 0 &&
          hardening.stalePlayerVoteAfterPhaseClosure?.apiCommandStateAfterReject
            ?.current_vote === null,
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
          hardening.stalePlayerPostAfterPhaseClosure?.status === "passed" &&
          hardening.stalePlayerPostAfterPhaseClosure?.hostEntry?.capabilityKinds?.includes(
            "HostOf",
          ) === true &&
          hardening.stalePlayerPostAfterPhaseClosure?.playerEntry?.capabilityKinds?.includes(
            "SlotOccupant",
          ) === true &&
          hardening.stalePlayerPostAfterPhaseClosure?.commandStateBeforeClose
            ?.actorSlot === "slot-7" &&
          hardening.stalePlayerPostAfterPhaseClosure?.commandStateBeforeClose
            ?.phase?.phaseId === "D01" &&
          hardening.stalePlayerPostAfterPhaseClosure?.commandStateBeforeClose
            ?.phase?.locked === false &&
          hardening.stalePlayerPostAfterPhaseClosure?.commandStateBeforeClose
            ?.currentVote?.slotId === "slot-2" &&
          hardening.stalePlayerPostAfterPhaseClosure?.currentVoteBeforeClose
            ?.hasVote === "true" &&
          hardening.stalePlayerPostAfterPhaseClosure?.submitPostBeforeClose
            ?.disabled === false &&
          hardening.stalePlayerPostAfterPhaseClosure?.closedStatus?.state ===
            "closed" &&
          hardening.stalePlayerPostAfterPhaseClosure?.resolveDay?.commandStatus
            ?.state === "ack" &&
          hardening.stalePlayerPostAfterPhaseClosure?.hostAfterResolve?.phase
            ?.locked === true &&
          hardening.stalePlayerPostAfterPhaseClosure?.hostAfterResolve?.dayVoteOutcomes?.some(
            (row) =>
              row.phaseId === "D01" &&
              row.status === "Lynch" &&
              row.winnerSlot === "slot-2",
          ) === true &&
          hardening.stalePlayerPostAfterPhaseClosure?.apiCommandStateAfterResolve
            ?.phase?.locked === true &&
          hardening.stalePlayerPostAfterPhaseClosure?.apiCommandStateAfterResolve
            ?.current_vote === null &&
          hardening.stalePlayerPostAfterPhaseClosure?.apiCommandStateAfterResolve
            ?.vote_targets?.length === 0 &&
          hardening.stalePlayerPostAfterPhaseClosure?.stalePost?.state === "ack" &&
          hardening.stalePlayerPostAfterPhaseClosure?.stalePost?.serverEnvelope?.body
            ?.kind === "Ack" &&
          Array.isArray(
            hardening.stalePlayerPostAfterPhaseClosure?.stalePost?.streamSeqs,
          ) === true &&
          hardening.stalePlayerPostAfterPhaseClosure?.stalePost?.streamSeqs?.length >
            0 &&
          hardening.stalePlayerPostAfterPhaseClosure?.stalePost?.requestEnvelope
            ?.body?.body?.command?.SubmitPost?.actor_slot === "slot-7" &&
          hardening.stalePlayerPostAfterPhaseClosure?.stalePost?.requestEnvelope
            ?.body?.body?.command?.SubmitPost?.channel_id === "main" &&
          hardening.stalePlayerPostAfterPhaseClosure?.stalePost?.requestEnvelope
            ?.body?.body?.command?.SubmitPost?.body ===
            hardening.stalePlayerPostAfterPhaseClosure?.postBody &&
          hardening.stalePlayerPostAfterPhaseClosure?.dispatchPlan?.projectionRefreshKeys?.includes(
            "thread",
          ) === true &&
          hardening.stalePlayerPostAfterPhaseClosure?.dispatchPlan?.projectionRefreshKeys?.includes(
            "votecount",
          ) === true &&
          hardening.stalePlayerPostAfterPhaseClosure?.dispatchPlan?.projectionRefreshKeys?.includes(
            "commandState",
          ) === true &&
          hardening.stalePlayerPostAfterPhaseClosure?.dispatchPlan?.projectionRefreshKeys?.includes(
            "dayVoteOutcomes",
          ) === true &&
          hardening.stalePlayerPostAfterPhaseClosure?.projectedPost?.body ===
            hardening.stalePlayerPostAfterPhaseClosure?.postBody &&
          hardening.stalePlayerPostAfterPhaseClosure?.projectedPost?.authorSlot ===
            "slot-7" &&
          hardening.stalePlayerPostAfterPhaseClosure?.commandStateAfterAck?.phase
            ?.locked === true &&
          hardening.stalePlayerPostAfterPhaseClosure?.commandStateAfterAck
            ?.voteTargets?.length === 0 &&
          hardening.stalePlayerPostAfterPhaseClosure?.commandStateAfterAck
            ?.currentVote === null &&
          hardening.stalePlayerPostAfterPhaseClosure?.currentVoteAfterAck?.hasVote ===
            "false" &&
          hardening.stalePlayerPostAfterPhaseClosure?.withdrawAfterAck?.disabled ===
            true &&
          hardening.stalePlayerPostAfterPhaseClosure?.withdrawAfterAck?.reason ===
            "No current vote" &&
          hardening.stalePlayerPostAfterPhaseClosure?.buttonsAfterAck?.some(
            (button) => button.action?.startsWith("submit_vote"),
          ) === false &&
          hardening.stalePlayerPostAfterPhaseClosure?.buttonsAfterAck?.some(
            (button) => button.action === "submit_post" && button.disabled === false,
          ) === true &&
          hardening.stalePlayerPostAfterPhaseClosure?.dayVoteOutcomesAfterAck?.some(
            (row) =>
              row.phaseId === "D01" &&
              row.status === "Lynch" &&
              row.winnerSlot === "slot-2",
          ) === true &&
          hardening.stalePlayerPostAfterPhaseClosure?.apiCommandStateAfterAck?.phase
            ?.locked === true &&
          hardening.stalePlayerPostAfterPhaseClosure?.apiCommandStateAfterAck
            ?.vote_targets?.length === 0 &&
          hardening.stalePlayerPostAfterPhaseClosure?.apiCommandStateAfterAck
            ?.current_vote === null &&
          hardening.stalePlayerPostAfterPhaseClosure?.apiThreadAfterAck?.posts?.some(
            (post) =>
              post.body === hardening.stalePlayerPostAfterPhaseClosure?.postBody &&
              post.author_slot === "slot-7",
          ) === true,
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
            "resolve_phase",
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
            "resolve_phase",
          ) === true &&
          hardening.concurrentPlayerActionAdvanceRace?.closedStatus?.state ===
            "closed" &&
          hardening.concurrentPlayerActionAdvanceRace?.resolveNight?.commandStatus
            ?.state === "ack" &&
          hardening.concurrentPlayerActionAdvanceRace?.lockedHostPhase?.id === "N01" &&
          hardening.concurrentPlayerActionAdvanceRace?.lockedHostPhase?.locked ===
            true &&
          hardening.concurrentPlayerActionAdvanceRace?.lockedHostPhaseActions?.includes(
            "advance_phase",
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
            "resolve_phase",
          ) === true &&
          hardening.concurrentPlayerActionAdvanceRace?.hostPhaseActionsAfterRace?.includes(
            "advance_phase",
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
            ?.hostPhaseActionsAfterReload?.includes("resolve_phase") === true &&
          hardening.concurrentPlayerActionAdvanceRace?.roleReloadAfterRace
            ?.hostPhaseActionsAfterReload?.includes("advance_phase") === false &&
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
            "resolve_phase",
          ) === true &&
          hardening.concurrentCohostDeadlineResolveRace?.setupHostDeadlineActions?.includes(
            "extend_deadline",
          ) === true &&
          hardening.concurrentCohostDeadlineResolveRace?.setupCohostPhaseActions
            ?.length === 0 &&
          hardening.concurrentCohostDeadlineResolveRace?.setupCohostDeadlineActions?.includes(
            "extend_deadline",
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
            "unlock_thread",
          ) === true &&
          hardening.concurrentCohostDeadlineResolveRace?.hostPhaseActionsAfterRace?.includes(
            "advance_phase",
          ) === true &&
          hardening.concurrentCohostDeadlineResolveRace?.hostPhaseActionsAfterRace?.includes(
            "resolve_phase",
          ) === false &&
          hardening.concurrentCohostDeadlineResolveRace?.cohostPhaseActionsAfterRace
            ?.length === 0 &&
          hardening.concurrentCohostDeadlineResolveRace?.hostDeadlineActionsAfterRace?.includes(
            "extend_deadline",
          ) === true &&
          hardening.concurrentCohostDeadlineResolveRace?.cohostDeadlineActionsAfterRace?.includes(
            "extend_deadline",
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
            ?.hostPhaseActionsAfterReload?.includes("unlock_thread") === true &&
          hardening.concurrentCohostDeadlineResolveRace?.roleReloadAfterRace
            ?.hostPhaseActionsAfterReload?.includes("advance_phase") === true &&
          hardening.concurrentCohostDeadlineResolveRace?.roleReloadAfterRace
            ?.hostPhaseActionsAfterReload?.includes("resolve_phase") === false &&
          hardening.concurrentCohostDeadlineResolveRace?.roleReloadAfterRace
            ?.hostPhaseActionsAfterReload?.includes("lock_thread") === false &&
          hardening.concurrentCohostDeadlineResolveRace?.roleReloadAfterRace
            ?.cohostPhaseActionsAfterReload?.length === 0 &&
          hardening.concurrentCohostDeadlineResolveRace?.roleReloadAfterRace
            ?.hostDeadlineActionsAfterReload?.includes("extend_deadline") === true &&
          hardening.concurrentCohostDeadlineResolveRace?.roleReloadAfterRace
            ?.cohostDeadlineActionsAfterReload?.includes("extend_deadline") === true &&
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
          hardening.concurrentReplacementPrivatePostRace?.replacement?.state ===
            "ack" &&
          hardening.concurrentReplacementPrivatePostRace?.replacement?.serverEnvelope
            ?.body?.kind === "Ack" &&
          hardening.concurrentReplacementPrivatePostRace?.replacement?.requestEnvelope
            ?.body?.body?.command?.ProcessReplacement?.game ===
            hardening.concurrentReplacementPrivatePostRace?.game &&
          hardening.concurrentReplacementPrivatePostRace?.replacement?.requestEnvelope
            ?.body?.body?.command?.ProcessReplacement?.slot === "slot-7" &&
          hardening.concurrentReplacementPrivatePostRace?.replacement?.requestEnvelope
            ?.body?.body?.command?.ProcessReplacement?.outgoing_user ===
            "player-mira" &&
          hardening.concurrentReplacementPrivatePostRace?.replacement?.requestEnvelope
            ?.body?.body?.command?.ProcessReplacement?.incoming_user ===
            "player-rowan" &&
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
          hardening.concurrentReplacementPrivatePostRace?.commandStateAfterRace
            ?.status === 403 &&
          hardening.concurrentReplacementPrivatePostRace?.commandStateAfterRace
            ?.error === "NotYourSlot" &&
          hardening.concurrentReplacementPrivatePostRace?.buttonsAfterRace?.some(
            (button) =>
              (button.action === "submit_post" ||
                button.action?.startsWith("submit_action")) &&
              button.disabled === false,
          ) === false &&
          hardening.concurrentReplacementPrivatePostRace?.hostReplacementAfterRace
            ?.occupantLabel === "player-rowan" &&
          hardening.concurrentReplacementPrivatePostRace?.apiSlotAfterRace
            ?.occupant_user_id === "player-rowan" &&
          hardening.concurrentReplacementPrivatePostRace?.staleRoute?.status === 403,
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
          hardening.concurrentReplacementVoteRace?.targetSlot === "slot-2" &&
          hardening.concurrentReplacementVoteRace?.hostEntry?.capabilityKinds?.includes(
            "HostOf",
          ) === true &&
          hardening.concurrentReplacementVoteRace?.playerEntry?.capabilityKinds?.includes(
            "SlotOccupant",
          ) === true &&
          hardening.concurrentReplacementVoteRace?.setupHostReplacement
            ?.occupantLabel === "player-mira" &&
          hardening.concurrentReplacementVoteRace?.setupCommandState?.actorSlot ===
            "slot-7" &&
          hardening.concurrentReplacementVoteRace?.setupCommandState?.actorStatus ===
            "alive" &&
          hardening.concurrentReplacementVoteRace?.setupCommandState?.voteTargets?.some(
            (target) => target.kind === "slot" && target.slotId === "slot-2",
          ) === true &&
          hardening.concurrentReplacementVoteRace?.replacement?.state === "ack" &&
          hardening.concurrentReplacementVoteRace?.replacement?.serverEnvelope?.body
            ?.kind === "Ack" &&
          hardening.concurrentReplacementVoteRace?.replacement?.requestEnvelope?.body
            ?.body?.command?.ProcessReplacement?.game ===
            hardening.concurrentReplacementVoteRace?.game &&
          hardening.concurrentReplacementVoteRace?.replacement?.requestEnvelope?.body
            ?.body?.command?.ProcessReplacement?.slot === "slot-7" &&
          hardening.concurrentReplacementVoteRace?.replacement?.requestEnvelope?.body
            ?.body?.command?.ProcessReplacement?.outgoing_user === "player-mira" &&
          hardening.concurrentReplacementVoteRace?.replacement?.requestEnvelope?.body
            ?.body?.command?.ProcessReplacement?.incoming_user === "player-rowan" &&
          hardening.concurrentReplacementVoteRace?.vote?.requestEnvelope?.body?.body
            ?.command?.SubmitVote?.actor_slot === "slot-7" &&
          hardening.concurrentReplacementVoteRace?.vote?.requestEnvelope?.body?.body
            ?.command?.SubmitVote?.target?.Slot === "slot-2" &&
          ((hardening.concurrentReplacementVoteRace?.vote?.state === "ack" &&
            hardening.concurrentReplacementVoteRace?.vote?.serverEnvelope?.body
              ?.kind === "Ack" &&
            hardening.concurrentReplacementVoteRace?.voteSeq <
              hardening.concurrentReplacementVoteRace?.replacementSeq &&
            hardening.concurrentReplacementVoteRace?.targetVotecount?.count === 1) ||
            (hardening.concurrentReplacementVoteRace?.vote?.state === "reject" &&
              hardening.concurrentReplacementVoteRace?.vote?.error ===
                "NotYourSlot" &&
              hardening.concurrentReplacementVoteRace?.vote?.serverEnvelope?.body
                ?.kind === "Reject" &&
              hardening.concurrentReplacementVoteRace?.targetVotecount === null)) &&
          hardening.concurrentReplacementVoteRace?.commandStateAfterRace?.status ===
            403 &&
          hardening.concurrentReplacementVoteRace?.commandStateAfterRace?.error ===
            "NotYourSlot" &&
          hardening.concurrentReplacementVoteRace?.hostReplacementAfterRace
            ?.occupantLabel === "player-rowan" &&
          hardening.concurrentReplacementVoteRace?.apiSlotAfterRace
            ?.occupant_user_id === "player-rowan",
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
          hardening.concurrentReplacementActionRace?.targetSlot === "slot-2" &&
          hardening.concurrentReplacementActionRace?.hostEntry?.capabilityKinds?.includes(
            "HostOf",
          ) === true &&
          hardening.concurrentReplacementActionRace?.playerEntry?.capabilityKinds?.includes(
            "SlotOccupant",
          ) === true &&
          hardening.concurrentReplacementActionRace?.replacementEntry?.capabilityKinds?.includes(
            "SlotOccupant",
          ) === true &&
          hardening.concurrentReplacementActionRace?.setupHostPhase?.id === "N01" &&
          hardening.concurrentReplacementActionRace?.setupHostPhase?.locked ===
            false &&
          hardening.concurrentReplacementActionRace?.setupSlot?.occupant_user_id ===
            "player-goon-a" &&
          hardening.concurrentReplacementActionRace?.setupCommandState?.actorSlot ===
            "slot_4" &&
          hardening.concurrentReplacementActionRace?.setupCommandState
            ?.actorStatus === "alive" &&
          hardening.concurrentReplacementActionRace?.setupCommandState?.phase
            ?.phaseId === "N01" &&
          hardening.concurrentReplacementActionRace?.setupCommandState?.actions?.some(
            (candidate) => candidate.templateId === "factional_kill",
          ) === true &&
          hardening.concurrentReplacementActionRace?.replacement?.state === "ack" &&
          hardening.concurrentReplacementActionRace?.replacement?.serverEnvelope
            ?.body?.kind === "Ack" &&
          hardening.concurrentReplacementActionRace?.replacement?.requestEnvelope
            ?.body?.body?.command?.ProcessReplacement?.game ===
            hardening.concurrentReplacementActionRace?.game &&
          hardening.concurrentReplacementActionRace?.replacement?.requestEnvelope
            ?.body?.body?.command?.ProcessReplacement?.slot === "slot_4" &&
          hardening.concurrentReplacementActionRace?.replacement?.requestEnvelope
            ?.body?.body?.command?.ProcessReplacement?.outgoing_user ===
            "player-goon-a" &&
          hardening.concurrentReplacementActionRace?.replacement?.requestEnvelope
            ?.body?.body?.command?.ProcessReplacement?.incoming_user ===
            "player-rowan" &&
          hardening.concurrentReplacementActionRace?.action?.requestEnvelope?.body
            ?.body?.command?.SubmitAction?.actor_slot === "slot_4" &&
          hardening.concurrentReplacementActionRace?.action?.requestEnvelope?.body
            ?.body?.command?.SubmitAction?.action_id ===
            "replacement_race_factional_kill" &&
          hardening.concurrentReplacementActionRace?.action?.requestEnvelope?.body
            ?.body?.command?.SubmitAction?.template_id === "factional_kill" &&
          hardening.concurrentReplacementActionRace?.action?.requestEnvelope?.body
            ?.body?.command?.SubmitAction?.targets?.[0] === "slot-2" &&
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
                "NotYourSlot" &&
              hardening.concurrentReplacementActionRace?.action?.serverEnvelope
                ?.body?.kind === "Reject" &&
              hardening.concurrentReplacementActionRace?.currentCommandStateAfterRace
                ?.actions?.some(
                  (candidate) => candidate.template_id === "factional_kill",
                ) === true &&
              hardening.concurrentReplacementActionRace?.currentRoleCommandState
                ?.actions?.some(
                  (candidate) => candidate.templateId === "factional_kill",
                ) === true)) &&
          hardening.concurrentReplacementActionRace?.commandStateAfterRace?.status ===
            403 &&
          hardening.concurrentReplacementActionRace?.commandStateAfterRace?.error ===
            "NotYourSlot" &&
          hardening.concurrentReplacementActionRace?.staleRetry?.state ===
            "reject" &&
          hardening.concurrentReplacementActionRace?.staleRetry?.error ===
            "NotYourSlot" &&
          hardening.concurrentReplacementActionRace?.hostPhaseAfterRace?.id ===
            "N01" &&
          hardening.concurrentReplacementActionRace?.hostPhaseAfterRace?.locked ===
            false &&
          hardening.concurrentReplacementActionRace?.apiSlotAfterRace
            ?.occupant_user_id === "player-rowan" &&
          hardening.concurrentReplacementActionRace?.currentCommandStateAfterRace
            ?.actor_slot === "slot_4" &&
          hardening.concurrentReplacementActionRace?.currentCommandStateAfterRace
            ?.actor_status === "alive" &&
          hardening.concurrentReplacementActionRace?.currentRoleCommandState
            ?.actorSlot === "slot_4" &&
          hardening.concurrentReplacementActionRace?.currentRoleCommandState
            ?.actorStatus === "alive",
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
        hardening.replacementIncomingAction?.targetSlot === "slot-2" &&
        hardening.replacementIncomingAction?.hostEntry?.capabilityKinds?.includes(
          "HostOf",
        ) === true &&
        hardening.replacementIncomingAction?.replacementEntry?.capabilityKinds?.includes(
          "SlotOccupant",
        ) === true &&
        hardening.replacementIncomingAction?.targetEntry?.capabilityKinds?.includes(
          "SlotOccupant",
        ) === true &&
        hardening.replacementIncomingAction?.setupHostPhase?.id === "N01" &&
        hardening.replacementIncomingAction?.setupHostPhase?.locked === false &&
        hardening.replacementIncomingAction?.setupSlot?.occupant_user_id ===
          "player-goon-a" &&
        hardening.replacementIncomingAction?.replacement?.state === "ack" &&
        hardening.replacementIncomingAction?.replacement?.serverEnvelope?.body
          ?.kind === "Ack" &&
        hardening.replacementIncomingAction?.replacement?.requestEnvelope?.body
          ?.body?.command?.ProcessReplacement?.game ===
          hardening.replacementIncomingAction?.game &&
        hardening.replacementIncomingAction?.replacement?.requestEnvelope?.body
          ?.body?.command?.ProcessReplacement?.slot === "slot_4" &&
        hardening.replacementIncomingAction?.replacement?.requestEnvelope?.body
          ?.body?.command?.ProcessReplacement?.outgoing_user === "player-goon-a" &&
        hardening.replacementIncomingAction?.replacement?.requestEnvelope?.body
          ?.body?.command?.ProcessReplacement?.incoming_user === "player-rowan" &&
        hardening.replacementIncomingAction?.outgoingCommandStateAfterReplacement
          ?.status === 403 &&
        hardening.replacementIncomingAction?.outgoingCommandStateAfterReplacement
          ?.error === "NotYourSlot" &&
        hardening.replacementIncomingAction?.currentCommandStateBeforeAction
          ?.actorSlot === "slot_4" &&
        hardening.replacementIncomingAction?.currentCommandStateBeforeAction
          ?.actorStatus === "alive" &&
        hardening.replacementIncomingAction?.currentCommandStateBeforeAction
          ?.phase?.phaseId === "N01" &&
        hardening.replacementIncomingAction?.currentCommandStateBeforeAction
          ?.actions?.some(
            (candidate) => candidate.templateId === "factional_kill",
          ) === true &&
        hardening.replacementIncomingAction?.action?.state === "ack" &&
        hardening.replacementIncomingAction?.action?.serverEnvelope?.body?.kind ===
          "Ack" &&
        hardening.replacementIncomingAction?.action?.requestEnvelope?.body?.body
          ?.principal_user_id === "player-rowan" &&
        hardening.replacementIncomingAction?.action?.requestEnvelope?.body?.body
          ?.command?.SubmitAction?.actor_slot === "slot_4" &&
        hardening.replacementIncomingAction?.action?.requestEnvelope?.body?.body
          ?.command?.SubmitAction?.action_id ===
          "incoming_replacement_factional_kill" &&
        hardening.replacementIncomingAction?.action?.requestEnvelope?.body?.body
          ?.command?.SubmitAction?.template_id === "factional_kill" &&
        hardening.replacementIncomingAction?.action?.requestEnvelope?.body?.body
          ?.command?.SubmitAction?.targets?.[0] === "slot-2" &&
        hardening.replacementIncomingAction?.currentCommandStateAfterAction
          ?.actions?.length === 0 &&
        hardening.replacementIncomingAction?.apiCommandStateAfterAction?.actions
          ?.length === 0 &&
        hardening.replacementIncomingAction?.resolveNight?.commandStatus?.state ===
          "ack" &&
        hardening.replacementIncomingAction?.hostPhaseAfterResolve?.id === "N01" &&
        hardening.replacementIncomingAction?.hostPhaseAfterResolve?.locked ===
          true &&
        hardening.replacementIncomingAction?.targetSlotAfterResolve?.slot_id ===
          "slot-2" &&
        hardening.replacementIncomingAction?.targetSlotAfterResolve?.alive ===
          false &&
        hardening.replacementIncomingAction?.targetSlotAfterResolve?.status ===
          "dead" &&
        hardening.replacementIncomingAction?.targetCommandState?.actorSlot ===
          "slot-2" &&
        hardening.replacementIncomingAction?.targetCommandState?.actorAlive ===
          false &&
        hardening.replacementIncomingAction?.targetNotice?.audience_slot ===
          "slot-2" &&
        hardening.replacementIncomingAction?.targetNotice?.effect ===
          "player_killed" &&
        hardening.replacementIncomingAction?.targetNotice?.status ===
          "factional_kill" &&
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
        hardening.replacementActionReconnect?.targetSlot === "slot-2" &&
        hardening.replacementActionReconnect?.hostEntry?.capabilityKinds?.includes(
          "HostOf",
        ) === true &&
        hardening.replacementActionReconnect?.replacementEntry?.capabilityKinds?.includes(
          "SlotOccupant",
        ) === true &&
        hardening.replacementActionReconnect?.targetEntry?.capabilityKinds?.includes(
          "SlotOccupant",
        ) === true &&
        hardening.replacementActionReconnect?.replacement?.state === "ack" &&
        hardening.replacementActionReconnect?.replacement?.serverEnvelope?.body
          ?.kind === "Ack" &&
        hardening.replacementActionReconnect?.replacement?.requestEnvelope?.body
          ?.body?.command?.ProcessReplacement?.slot === "slot_4" &&
        hardening.replacementActionReconnect?.replacement?.requestEnvelope?.body
          ?.body?.command?.ProcessReplacement?.outgoing_user === "player-goon-a" &&
        hardening.replacementActionReconnect?.replacement?.requestEnvelope?.body
          ?.body?.command?.ProcessReplacement?.incoming_user === "player-rowan" &&
        hardening.replacementActionReconnect?.commandStateBeforeAction
          ?.actorSlot === "slot_4" &&
        hardening.replacementActionReconnect?.commandStateBeforeAction
          ?.actorStatus === "alive" &&
        hardening.replacementActionReconnect?.commandStateBeforeAction?.actions?.some(
          (candidate) => candidate.templateId === "factional_kill",
        ) === true &&
        hardening.replacementActionReconnect?.action?.state === "ack" &&
        hardening.replacementActionReconnect?.action?.serverEnvelope?.body?.kind ===
          "Ack" &&
        hardening.replacementActionReconnect?.action?.requestEnvelope?.body?.body
          ?.principal_user_id === "player-rowan" &&
        hardening.replacementActionReconnect?.action?.requestEnvelope?.body?.body
          ?.command?.SubmitAction?.actor_slot === "slot_4" &&
        hardening.replacementActionReconnect?.action?.requestEnvelope?.body?.body
          ?.command?.SubmitAction?.action_id ===
          "replacement_action_reconnect_factional_kill" &&
        hardening.replacementActionReconnect?.action?.requestEnvelope?.body?.body
          ?.command?.SubmitAction?.template_id === "factional_kill" &&
        hardening.replacementActionReconnect?.action?.requestEnvelope?.body?.body
          ?.command?.SubmitAction?.targets?.[0] === "slot-2" &&
        hardening.replacementActionReconnect?.resolveNight?.commandStatus?.state ===
          "ack" &&
        hardening.replacementActionReconnect?.targetSlotAfterResolve?.slot_id ===
          "slot-2" &&
        hardening.replacementActionReconnect?.targetSlotAfterResolve?.alive ===
          false &&
        hardening.replacementActionReconnect?.targetSlotAfterResolve?.status ===
          "dead" &&
        hardening.replacementActionReconnect?.targetCommandState?.actorSlot ===
          "slot-2" &&
        hardening.replacementActionReconnect?.targetCommandState?.actorAlive ===
          false &&
        hardening.replacementActionReconnect?.targetCommandState?.actorStatus ===
          "dead" &&
        hardening.replacementActionReconnect?.targetNoticeBeforeReconnect
          ?.audience_slot === "slot-2" &&
        hardening.replacementActionReconnect?.targetNoticeBeforeReconnect
          ?.effect === "player_killed" &&
        hardening.replacementActionReconnect?.targetNoticeBeforeReconnect
          ?.status === "factional_kill" &&
        hardening.replacementActionReconnect?.reconnect?.status === "passed" &&
        hardening.replacementActionReconnect?.reconnect?.principalUserId ===
          "player-rowan" &&
        hardening.replacementActionReconnect?.reconnect?.actorSlot === "slot_4" &&
        hardening.replacementActionReconnect?.reconnect?.reconnectingStatus?.state ===
          "reconnecting" &&
        hardening.replacementActionReconnect?.reconnect?.reconnectRecoveryEvent
          ?.attempt === 1 &&
        hardening.replacementActionReconnect?.reconnect?.reconnectRecoveryEvent
          ?.state === "recovered" &&
        hardening.replacementActionReconnect?.reconnect
          ?.recoveredSnapshotContainsPost === true &&
        hardening.replacementActionReconnect?.reconnect?.reconnectCommand
          ?.principalUserId === "player-rowan" &&
        hardening.replacementActionReconnect?.reconnect?.reconnectCommand?.command
          ?.SubmitPost?.actor_slot === "slot_4" &&
        hardening.replacementActionReconnect?.commandStateAfterReconnect
          ?.actorSlot === "slot_4" &&
        hardening.replacementActionReconnect?.commandStateAfterReconnect
          ?.actorAlive === true &&
        hardening.replacementActionReconnect?.commandStateAfterReconnect
          ?.actorStatus === "alive" &&
        hardening.replacementActionReconnect?.commandStateAfterReconnect?.phase
          ?.phaseId === "N01" &&
        hardening.replacementActionReconnect?.commandStateAfterReconnect?.phase
          ?.locked === true &&
        hardening.replacementActionReconnect?.commandStateAfterReconnect?.actions
          ?.length === 0 &&
        hardening.replacementActionReconnect?.buttonsAfterReconnect?.some(
          (button) => button.action === "submit_action:factional_kill",
        ) === false &&
        hardening.replacementActionReconnect?.rowanPrivateIsolationAfterReconnect
          ?.targetKillVisible === false &&
        hardening.replacementActionReconnect?.targetNoticeAfterReconnect
          ?.audience_slot === "slot-2" &&
        hardening.replacementActionReconnect?.targetNoticeAfterReconnect?.effect ===
          "player_killed" &&
        hardening.replacementActionReconnect?.targetNoticeAfterReconnect?.status ===
          "factional_kill",
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
        hardening.replacementStaleActionAfterResolve?.targetSlot === "slot-2" &&
        hardening.replacementStaleActionAfterResolve?.hostEntry?.capabilityKinds?.includes(
          "HostOf",
        ) === true &&
        hardening.replacementStaleActionAfterResolve?.replacementEntry?.capabilityKinds?.includes(
          "SlotOccupant",
        ) === true &&
        hardening.replacementStaleActionAfterResolve?.targetEntry?.capabilityKinds?.includes(
          "SlotOccupant",
        ) === true &&
        hardening.replacementStaleActionAfterResolve?.replacement?.state ===
          "ack" &&
        hardening.replacementStaleActionAfterResolve?.replacement?.serverEnvelope
          ?.body?.kind === "Ack" &&
        hardening.replacementStaleActionAfterResolve?.replacement?.requestEnvelope
          ?.body?.body?.command?.ProcessReplacement?.slot === "slot_4" &&
        hardening.replacementStaleActionAfterResolve?.replacement?.requestEnvelope
          ?.body?.body?.command?.ProcessReplacement?.incoming_user ===
          "player-rowan" &&
        hardening.replacementStaleActionAfterResolve?.commandStateBeforeClose
          ?.actorSlot === "slot_4" &&
        hardening.replacementStaleActionAfterResolve?.commandStateBeforeClose
          ?.actorStatus === "alive" &&
        hardening.replacementStaleActionAfterResolve?.commandStateBeforeClose?.phase
          ?.phaseId === "N01" &&
        hardening.replacementStaleActionAfterResolve?.commandStateBeforeClose?.phase
          ?.locked === false &&
        hardening.replacementStaleActionAfterResolve?.commandStateBeforeClose
          ?.actions?.some(
            (candidate) => candidate.templateId === "factional_kill",
          ) === true &&
        hardening.replacementStaleActionAfterResolve?.actionButtonBeforeClose
          ?.action === "submit_action:factional_kill" &&
        hardening.replacementStaleActionAfterResolve?.actionButtonBeforeClose
          ?.disabled === false &&
        hardening.replacementStaleActionAfterResolve?.closedStatus?.state ===
          "closed" &&
        hardening.replacementStaleActionAfterResolve?.resolveNight?.commandStatus
          ?.state === "ack" &&
        hardening.replacementStaleActionAfterResolve?.hostPhaseAfterResolve?.id ===
          "N01" &&
        hardening.replacementStaleActionAfterResolve?.hostPhaseAfterResolve
          ?.locked === true &&
        hardening.replacementStaleActionAfterResolve?.hostPhaseActionsAfterResolve?.includes(
          "advance_phase",
        ) === true &&
        hardening.replacementStaleActionAfterResolve?.targetSlotAfterResolve
          ?.slot_id === "slot-2" &&
        hardening.replacementStaleActionAfterResolve?.targetSlotAfterResolve
          ?.alive === true &&
        hardening.replacementStaleActionAfterResolve?.reject?.state ===
          "reject" &&
        hardening.replacementStaleActionAfterResolve?.reject?.error ===
          "PhaseLocked" &&
        hardening.replacementStaleActionAfterResolve?.reject?.serverEnvelope?.body
          ?.kind === "Reject" &&
        Array.isArray(hardening.replacementStaleActionAfterResolve?.reject?.streamSeqs) ===
          false &&
        hardening.replacementStaleActionAfterResolve?.reject?.message?.includes(
          "stale action state",
        ) === true &&
        hardening.replacementStaleActionAfterResolve?.reject?.message?.includes(
          "current action controls",
        ) === true &&
        hardening.replacementStaleActionAfterResolve?.reject?.requestEnvelope?.body
          ?.body?.command?.SubmitAction?.actor_slot === "slot_4" &&
        hardening.replacementStaleActionAfterResolve?.reject?.requestEnvelope?.body
          ?.body?.command?.SubmitAction?.action_id === "role_factional_kill" &&
        hardening.replacementStaleActionAfterResolve?.reject?.requestEnvelope?.body
          ?.body?.command?.SubmitAction?.template_id === "factional_kill" &&
        hardening.replacementStaleActionAfterResolve?.dispatchPlan
          ?.projectionRefreshKeys?.includes("notifications") === true &&
        hardening.replacementStaleActionAfterResolve?.dispatchPlan
          ?.projectionRefreshKeys?.includes("investigationResults") === true &&
        hardening.replacementStaleActionAfterResolve?.dispatchPlan
          ?.projectionRefreshKeys?.includes("commandState") === true &&
        hardening.replacementStaleActionAfterResolve?.currentReceipt?.actionId ===
          "submit_action:factional_kill" &&
        hardening.replacementStaleActionAfterResolve?.currentReceipt?.state ===
          "reject" &&
        hardening.replacementStaleActionAfterResolve?.currentReceipt
          ?.commandTrace?.projectionRefreshKeys?.includes("commandState") === true &&
        hardening.replacementStaleActionAfterResolve?.receiptStatusText?.includes(
          "Reject PhaseLocked",
        ) === true &&
        hardening.replacementStaleActionAfterResolve?.receiptStatusText?.includes(
          "stale action state",
        ) === true &&
        hardening.replacementStaleActionAfterResolve?.commandStateAfterReject
          ?.actorSlot === "slot_4" &&
        hardening.replacementStaleActionAfterResolve?.commandStateAfterReject
          ?.actorAlive === true &&
        hardening.replacementStaleActionAfterResolve?.commandStateAfterReject
          ?.actorStatus === "alive" &&
        hardening.replacementStaleActionAfterResolve?.commandStateAfterReject?.phase
          ?.phaseId === "N01" &&
        hardening.replacementStaleActionAfterResolve?.commandStateAfterReject?.phase
          ?.locked === true &&
        hardening.replacementStaleActionAfterResolve?.commandStateAfterReject
          ?.actions?.length === 0 &&
        hardening.replacementStaleActionAfterResolve?.buttonsAfterReject?.some(
          (button) => button.action === "submit_action:factional_kill",
        ) === false &&
        hardening.replacementStaleActionAfterResolve?.apiCommandStateAfterReject
          ?.actor_slot === "slot_4" &&
        hardening.replacementStaleActionAfterResolve?.apiCommandStateAfterReject
          ?.actor_alive === true &&
        hardening.replacementStaleActionAfterResolve?.apiCommandStateAfterReject
          ?.actor_status === "alive" &&
        hardening.replacementStaleActionAfterResolve?.apiCommandStateAfterReject
          ?.phase?.phase_id === "N01" &&
        hardening.replacementStaleActionAfterResolve?.apiCommandStateAfterReject
          ?.phase?.locked === true &&
        hardening.replacementStaleActionAfterResolve?.apiCommandStateAfterReject
          ?.actions?.length === 0 &&
        hardening.replacementStaleActionAfterResolve?.targetSlotAfterReject
          ?.slot_id === "slot-2" &&
        hardening.replacementStaleActionAfterResolve?.targetSlotAfterReject
          ?.alive === true &&
        hardening.replacementStaleActionAfterResolve?.targetSlotAfterReject
          ?.status === "alive" &&
        hardening.replacementStaleActionAfterResolve?.rowanPrivateIsolationAfterReject
          ?.targetKillVisible === false &&
        hardening.replacementStaleActionAfterResolve?.targetCommandStateAfterReject
          ?.actorSlot === "slot-2" &&
        hardening.replacementStaleActionAfterResolve?.targetCommandStateAfterReject
          ?.actorAlive === true &&
        hardening.replacementStaleActionAfterResolve?.targetCommandStateAfterReject
          ?.actorStatus === "alive" &&
        hardening.replacementStaleActionAfterResolve?.targetCommandStateAfterReject
          ?.phase?.phaseId === "N01" &&
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
        passed:
          hardening.replacementStalePrivatePostAfterResolve?.status === "passed" &&
          hardening.replacementStalePrivatePostAfterResolve?.channel ===
            "private:mafia_day_chat" &&
          hardening.replacementStalePrivatePostAfterResolve?.hostEntry?.capabilityKinds?.includes(
            "HostOf",
          ) === true &&
          hardening.replacementStalePrivatePostAfterResolve?.staleOutgoingEntry?.capabilityKinds?.includes(
            "SlotOccupant",
          ) === true &&
          hardening.replacementStalePrivatePostAfterResolve?.replacementEntry?.capabilityKinds?.includes(
            "SlotOccupant",
          ) === true &&
          hardening.replacementStalePrivatePostAfterResolve?.replacement?.state ===
            "ack" &&
          hardening.replacementStalePrivatePostAfterResolve?.replacement?.serverEnvelope
            ?.body?.kind === "Ack" &&
          hardening.replacementStalePrivatePostAfterResolve?.replacement
            ?.requestEnvelope?.body?.body?.command?.ProcessReplacement?.slot ===
            "slot-7" &&
          hardening.replacementStalePrivatePostAfterResolve?.replacement
            ?.requestEnvelope?.body?.body?.command?.ProcessReplacement?.incoming_user ===
            "player-rowan" &&
          hardening.replacementStalePrivatePostAfterResolve
            ?.hostReplacementAfterProcess?.occupantLabel === "player-rowan" &&
          hardening.replacementStalePrivatePostAfterResolve?.commandStateBeforeClose
            ?.actorSlot === "slot-7" &&
          hardening.replacementStalePrivatePostAfterResolve?.commandStateBeforeClose
            ?.actorStatus === "alive" &&
          hardening.replacementStalePrivatePostAfterResolve?.commandStateBeforeClose
            ?.phase?.phaseId === "D01" &&
          hardening.replacementStalePrivatePostAfterResolve?.commandStateBeforeClose
            ?.phase?.locked === false &&
          hardening.replacementStalePrivatePostAfterResolve?.channelContextBeforeClose
            ?.channelId === "private:mafia_day_chat" &&
          hardening.replacementStalePrivatePostAfterResolve?.channelContextBeforeClose
            ?.actorSlot === "slot-7" &&
          hardening.replacementStalePrivatePostAfterResolve?.channelContextBeforeClose
            ?.capabilityLabel?.includes(
              "ChannelMember(private:mafia_day_chat)",
            ) === true &&
          hardening.replacementStalePrivatePostAfterResolve?.submitPostBeforeClose
            ?.disabled === false &&
          hardening.replacementStalePrivatePostAfterResolve?.closedStatus?.state ===
            "closed" &&
          hardening.replacementStalePrivatePostAfterResolve?.resolveDay?.commandStatus
            ?.state === "ack" &&
          hardening.replacementStalePrivatePostAfterResolve?.hostPhaseAfterResolve
            ?.id === "D01" &&
          hardening.replacementStalePrivatePostAfterResolve?.hostPhaseAfterResolve
            ?.locked === true &&
          hardening.replacementStalePrivatePostAfterResolve?.apiCommandStateAfterResolve
            ?.phase?.locked === true &&
          hardening.replacementStalePrivatePostAfterResolve?.stalePost?.state ===
            "ack" &&
          hardening.replacementStalePrivatePostAfterResolve?.stalePost?.serverEnvelope
            ?.body?.kind === "Ack" &&
          Array.isArray(
            hardening.replacementStalePrivatePostAfterResolve?.stalePost?.streamSeqs,
          ) === true &&
          hardening.replacementStalePrivatePostAfterResolve?.stalePost?.requestEnvelope
            ?.body?.body?.principal_user_id === "player-rowan" &&
          hardening.replacementStalePrivatePostAfterResolve?.stalePost?.requestEnvelope
            ?.body?.body?.command?.SubmitPost?.channel_id ===
            "private:mafia_day_chat" &&
          hardening.replacementStalePrivatePostAfterResolve?.stalePost?.requestEnvelope
            ?.body?.body?.command?.SubmitPost?.actor_slot === "slot-7" &&
          hardening.replacementStalePrivatePostAfterResolve?.stalePost?.requestEnvelope
            ?.body?.body?.command?.SubmitPost?.body ===
            hardening.replacementStalePrivatePostAfterResolve?.postBody &&
          hardening.replacementStalePrivatePostAfterResolve?.dispatchPlan
            ?.projectionRefreshKeys?.includes("thread") === true &&
          hardening.replacementStalePrivatePostAfterResolve?.dispatchPlan
            ?.projectionRefreshKeys?.includes("commandState") === true &&
          hardening.replacementStalePrivatePostAfterResolve?.currentReceipt
            ?.actionId === "submit_post" &&
          hardening.replacementStalePrivatePostAfterResolve?.currentReceipt
            ?.state === "ack" &&
          hardening.replacementStalePrivatePostAfterResolve?.commandStateAfterAck
            ?.actorSlot === "slot-7" &&
          hardening.replacementStalePrivatePostAfterResolve?.commandStateAfterAck
            ?.actorStatus === "alive" &&
          hardening.replacementStalePrivatePostAfterResolve?.commandStateAfterAck
            ?.phase?.phaseId === "D01" &&
          hardening.replacementStalePrivatePostAfterResolve?.commandStateAfterAck
            ?.phase?.locked === true &&
          hardening.replacementStalePrivatePostAfterResolve?.commandStateAfterAck
            ?.voteTargets?.length === 0 &&
          hardening.replacementStalePrivatePostAfterResolve?.channelContextAfterAck
            ?.channelId === "private:mafia_day_chat" &&
          hardening.replacementStalePrivatePostAfterResolve?.channelContextAfterAck
            ?.actorSlot === "slot-7" &&
          hardening.replacementStalePrivatePostAfterResolve?.projectedPost
            ?.authorSlot === "slot-7" &&
          hardening.replacementStalePrivatePostAfterResolve?.apiThreadPostBodies?.includes(
            hardening.replacementStalePrivatePostAfterResolve?.postBody,
          ) === true &&
          hardening.replacementStalePrivatePostAfterResolve?.rowanPrivateIsolationAfterAck
            ?.targetKillVisible === false &&
          hardening.replacementStalePrivatePostAfterResolve?.rowanPrivateIsolationAfterAck
            ?.actionResultVisible === false &&
          hardening.replacementStalePrivatePostAfterResolve
            ?.staleOutgoingRouteAfterAck?.status === 403 &&
          hardening.replacementStalePrivatePostAfterResolve
            ?.staleOutgoingThreadAfterAck?.status === 403,
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
        passed:
          hardening.replacementStalePrivatePostAfterResolve?.status === "passed" &&
          hardening.replacementStalePrivatePostAfterResolve?.privateReconnectAfterAck
            ?.status === "passed" &&
          hardening.replacementStalePrivatePostAfterResolve?.channel ===
            "private:mafia_day_chat" &&
          hardening.replacementStalePrivatePostAfterResolve?.privateReconnectAfterAck
            ?.reconnectCommandStateBeforeDrop?.actorSlot === "slot-7" &&
          hardening.replacementStalePrivatePostAfterResolve?.privateReconnectAfterAck
            ?.reconnectCommandStateBeforeDrop?.phase?.phaseId === "D01" &&
          hardening.replacementStalePrivatePostAfterResolve?.privateReconnectAfterAck
            ?.reconnectCommandStateBeforeDrop?.phase?.locked === true &&
          hardening.replacementStalePrivatePostAfterResolve?.privateReconnectAfterAck
            ?.reconnectChannelContextBeforeDrop?.channelId ===
            "private:mafia_day_chat" &&
          hardening.replacementStalePrivatePostAfterResolve?.privateReconnectAfterAck
            ?.reconnectChannelContextBeforeDrop?.actorSlot === "slot-7" &&
          hardening.replacementStalePrivatePostAfterResolve?.privateReconnectAfterAck
            ?.reconnectButtonsBeforeDrop?.some((button) =>
              button.action?.startsWith("submit_vote"),
            ) === false &&
          hardening.replacementStalePrivatePostAfterResolve?.privateReconnectAfterAck
            ?.reconnectingStatus?.state === "reconnecting" &&
          hardening.replacementStalePrivatePostAfterResolve?.privateReconnectAfterAck
            ?.reconnectCommand?.principalUserId === "player-rowan" &&
          hardening.replacementStalePrivatePostAfterResolve?.privateReconnectAfterAck
            ?.reconnectCommand?.command?.SubmitPost?.channel_id ===
            "private:mafia_day_chat" &&
          hardening.replacementStalePrivatePostAfterResolve?.privateReconnectAfterAck
            ?.reconnectCommand?.command?.SubmitPost?.actor_slot === "slot-7" &&
          hardening.replacementStalePrivatePostAfterResolve?.privateReconnectAfterAck
            ?.reconnectCommand?.command?.SubmitPost?.body ===
            hardening.replacementStalePrivatePostAfterResolve?.privateReconnectAfterAck
              ?.reconnectPostBody &&
          hardening.replacementStalePrivatePostAfterResolve?.privateReconnectAfterAck
            ?.reconnectRecoveryEvent?.state === "recovered" &&
          hardening.replacementStalePrivatePostAfterResolve?.privateReconnectAfterAck
            ?.reconnectRecoveryEvent?.attempt === 1 &&
          hardening.replacementStalePrivatePostAfterResolve?.privateReconnectAfterAck
            ?.recoveredSnapshotContainsPost === true &&
          hardening.replacementStalePrivatePostAfterResolve?.privateReconnectAfterAck
            ?.recoveredCommandState?.actorSlot === "slot-7" &&
          hardening.replacementStalePrivatePostAfterResolve?.privateReconnectAfterAck
            ?.recoveredCommandState?.phase?.phaseId === "D01" &&
          hardening.replacementStalePrivatePostAfterResolve?.privateReconnectAfterAck
            ?.recoveredCommandState?.phase?.locked === true &&
          hardening.replacementStalePrivatePostAfterResolve?.privateReconnectAfterAck
            ?.recoveredCommandState?.voteTargets?.length === 0 &&
          hardening.replacementStalePrivatePostAfterResolve?.privateReconnectAfterAck
            ?.reconnectChannelContextAfterRecovery?.channelId ===
            "private:mafia_day_chat" &&
          hardening.replacementStalePrivatePostAfterResolve?.privateReconnectAfterAck
            ?.reconnectChannelContextAfterRecovery?.actorSlot === "slot-7" &&
          hardening.replacementStalePrivatePostAfterResolve?.privateReconnectAfterAck
            ?.reconnectButtonsAfterRecovery?.some((button) =>
              button.action?.startsWith("submit_vote"),
            ) === false &&
          hardening.replacementStalePrivatePostAfterResolve?.privateReconnectAfterAck
            ?.reconnectButtonsAfterRecovery?.some(
              (button) => button.action === "submit_post" && button.disabled === false,
            ) === true &&
          hardening.replacementStalePrivatePostAfterResolve?.privateReconnectAfterAck
            ?.apiThreadPostBodiesAfterReconnect?.includes(
              hardening.replacementStalePrivatePostAfterResolve?.postBody,
            ) === true &&
          hardening.replacementStalePrivatePostAfterResolve?.privateReconnectAfterAck
            ?.apiThreadPostBodiesAfterReconnect?.includes(
              hardening.replacementStalePrivatePostAfterResolve
                ?.privateReconnectAfterAck?.reconnectPostBody,
            ) === true &&
          hardening.replacementStalePrivatePostAfterResolve?.privateReconnectAfterAck
            ?.apiCommandStateAfterReconnect?.phase?.phase_id === "D01" &&
          hardening.replacementStalePrivatePostAfterResolve?.privateReconnectAfterAck
            ?.apiCommandStateAfterReconnect?.phase?.locked === true &&
          hardening.replacementStalePrivatePostAfterResolve?.privateReconnectAfterAck
            ?.apiCommandStateAfterReconnect?.vote_targets?.length === 0 &&
          hardening.replacementStalePrivatePostAfterResolve?.privateReconnectAfterAck
            ?.staleOutgoingThreadAfterReconnect?.status === 403,
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
        passed:
          hardening.replacementStalePrivatePostAfterComplete?.status === "passed" &&
          hardening.replacementStalePrivatePostAfterComplete?.channel ===
            "private:mafia_day_chat" &&
          hardening.replacementStalePrivatePostAfterComplete?.hostEntry?.capabilityKinds?.includes(
            "HostOf",
          ) === true &&
          hardening.replacementStalePrivatePostAfterComplete?.staleOutgoingEntry?.capabilityKinds?.includes(
            "SlotOccupant",
          ) === true &&
          hardening.replacementStalePrivatePostAfterComplete?.replacementEntry?.capabilityKinds?.includes(
            "SlotOccupant",
          ) === true &&
          hardening.replacementStalePrivatePostAfterComplete?.replacement?.state ===
            "ack" &&
          hardening.replacementStalePrivatePostAfterComplete?.replacement
            ?.requestEnvelope?.body?.body?.command?.ProcessReplacement?.slot ===
            "slot-7" &&
          hardening.replacementStalePrivatePostAfterComplete?.replacement
            ?.requestEnvelope?.body?.body?.command?.ProcessReplacement?.incoming_user ===
            "player-rowan" &&
          hardening.replacementStalePrivatePostAfterComplete
            ?.hostReplacementAfterProcess?.occupantLabel === "player-rowan" &&
          hardening.replacementStalePrivatePostAfterComplete?.commandStateBeforeClose
            ?.actorSlot === "slot-7" &&
          hardening.replacementStalePrivatePostAfterComplete?.commandStateBeforeClose
            ?.gameCompleted === false &&
          hardening.replacementStalePrivatePostAfterComplete?.channelContextBeforeClose
            ?.channelId === "private:mafia_day_chat" &&
          hardening.replacementStalePrivatePostAfterComplete?.channelContextBeforeClose
            ?.actorSlot === "slot-7" &&
          hardening.replacementStalePrivatePostAfterComplete?.channelContextBeforeClose
            ?.capabilityLabel?.includes(
              "ChannelMember(private:mafia_day_chat)",
            ) === true &&
          hardening.replacementStalePrivatePostAfterComplete?.submitPostBeforeClose
            ?.disabled === false &&
          hardening.replacementStalePrivatePostAfterComplete?.closedStatus?.state ===
            "closed" &&
          hardening.replacementStalePrivatePostAfterComplete?.complete?.commandStatus
            ?.state === "ack" &&
          hardening.replacementStalePrivatePostAfterComplete?.complete?.commandStatus
            ?.requestEnvelope?.body?.body?.command?.CompleteGame?.game ===
            hardening.replacementStalePrivatePostAfterComplete?.game &&
          hardening.replacementStalePrivatePostAfterComplete?.hostSlotsAfterComplete?.some(
            (slot) =>
              slot.role_revealed !== true || slot.alignment_revealed !== true,
          ) === false &&
          hardening.replacementStalePrivatePostAfterComplete?.hostActionsAfterComplete?.includes(
            "complete_game",
          ) === false &&
          hardening.replacementStalePrivatePostAfterComplete?.apiStateAfterComplete
            ?.completed === true &&
          hardening.replacementStalePrivatePostAfterComplete?.reject?.state ===
            "reject" &&
          hardening.replacementStalePrivatePostAfterComplete?.reject?.error ===
            "GameAlreadyCompleted" &&
          hardening.replacementStalePrivatePostAfterComplete?.reject?.serverEnvelope
            ?.body?.kind === "Reject" &&
          Array.isArray(
            hardening.replacementStalePrivatePostAfterComplete?.reject?.streamSeqs,
          ) === false &&
          hardening.replacementStalePrivatePostAfterComplete?.reject?.requestEnvelope
            ?.body?.body?.principal_user_id === "player-rowan" &&
          hardening.replacementStalePrivatePostAfterComplete?.reject?.requestEnvelope
            ?.body?.body?.command?.SubmitPost?.channel_id ===
            "private:mafia_day_chat" &&
          hardening.replacementStalePrivatePostAfterComplete?.reject?.requestEnvelope
            ?.body?.body?.command?.SubmitPost?.actor_slot === "slot-7" &&
          hardening.replacementStalePrivatePostAfterComplete?.reject?.requestEnvelope
            ?.body?.body?.command?.SubmitPost?.body ===
            hardening.replacementStalePrivatePostAfterComplete?.postBody &&
          hardening.replacementStalePrivatePostAfterComplete?.dispatchPlan
            ?.projectionRefreshKeys?.includes("commandState") === true &&
          hardening.replacementStalePrivatePostAfterComplete?.currentReceipt
            ?.actionId === "submit_post" &&
          hardening.replacementStalePrivatePostAfterComplete?.currentReceipt
            ?.state === "reject" &&
          hardening.replacementStalePrivatePostAfterComplete?.receiptStatusText?.includes(
            "Reject GameAlreadyCompleted",
          ) === true &&
          hardening.replacementStalePrivatePostAfterComplete?.commandStateAfterReject
            ?.actorSlot === "slot-7" &&
          hardening.replacementStalePrivatePostAfterComplete?.commandStateAfterReject
            ?.gameCompleted === true &&
          hardening.replacementStalePrivatePostAfterComplete?.commandStateAfterReject
            ?.actions?.length === 0 &&
          hardening.replacementStalePrivatePostAfterComplete?.commandStateAfterReject
            ?.voteTargets?.length === 0 &&
          hardening.replacementStalePrivatePostAfterComplete?.commandStateAfterReject
            ?.boundary?.includes("game is complete") === true &&
          hardening.replacementStalePrivatePostAfterComplete?.channelContextAfterReject
            ?.channelId === "private:mafia_day_chat" &&
          hardening.replacementStalePrivatePostAfterComplete?.channelContextAfterReject
            ?.actorSlot === "slot-7" &&
          hardening.replacementStalePrivatePostAfterComplete?.buttonsAfterReject?.some(
            (button) => button.disabled !== true,
          ) === false &&
          hardening.replacementStalePrivatePostAfterComplete?.apiCommandStateAfterReject
            ?.game_completed === true &&
          hardening.replacementStalePrivatePostAfterComplete?.apiCommandStateAfterReject
            ?.actions?.length === 0 &&
          hardening.replacementStalePrivatePostAfterComplete?.apiCommandStateAfterReject
            ?.vote_targets?.length === 0 &&
          hardening.replacementStalePrivatePostAfterComplete?.apiThreadPostBodies?.includes(
            hardening.replacementStalePrivatePostAfterComplete?.postBody,
          ) === false &&
          hardening.replacementStalePrivatePostAfterComplete
            ?.staleOutgoingRouteAfterReject?.status === 403 &&
          hardening.replacementStalePrivatePostAfterComplete
            ?.staleOutgoingThreadAfterReject?.status === 403,
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
        passed:
          hardening.replacementStalePrivatePostAfterComplete?.status === "passed" &&
          hardening.replacementStalePrivatePostAfterComplete?.channel ===
            "private:mafia_day_chat" &&
          hardening.replacementStalePrivatePostAfterComplete?.reject?.error ===
            "GameAlreadyCompleted" &&
          hardening.replacementStalePrivatePostAfterComplete
            ?.privateReloadAfterReject?.status === "passed" &&
          hardening.replacementStalePrivatePostAfterComplete
            ?.privateReloadAfterReject?.routeResponseStatus === 200 &&
          hardening.replacementStalePrivatePostAfterComplete
            ?.privateReloadAfterReject?.threadPagerVisible === true &&
          hardening.replacementStalePrivatePostAfterComplete
            ?.privateReloadAfterReject?.recoveredCommandState?.actorSlot ===
            "slot-7" &&
          hardening.replacementStalePrivatePostAfterComplete
            ?.privateReloadAfterReject?.recoveredCommandState?.gameCompleted ===
            true &&
          hardening.replacementStalePrivatePostAfterComplete
            ?.privateReloadAfterReject?.recoveredCommandState?.actions?.length === 0 &&
          hardening.replacementStalePrivatePostAfterComplete
            ?.privateReloadAfterReject?.recoveredCommandState?.voteTargets?.length ===
            0 &&
          hardening.replacementStalePrivatePostAfterComplete
            ?.privateReloadAfterReject?.recoveredCommandState?.boundary?.includes(
              "game is complete",
            ) === true &&
          hardening.replacementStalePrivatePostAfterComplete
            ?.privateReloadAfterReject?.reloadChannelContext?.channelId ===
            "private:mafia_day_chat" &&
          hardening.replacementStalePrivatePostAfterComplete
            ?.privateReloadAfterReject?.reloadChannelContext?.actorSlot ===
            "slot-7" &&
          hardening.replacementStalePrivatePostAfterComplete
            ?.privateReloadAfterReject?.reloadChannelContext?.capabilityLabel?.includes(
              "ChannelMember(private:mafia_day_chat)",
            ) === true &&
          hardening.replacementStalePrivatePostAfterComplete
            ?.privateReloadAfterReject?.reloadButtons?.some(
              (button) => button.disabled !== true,
            ) === false &&
          hardening.replacementStalePrivatePostAfterComplete
            ?.privateReloadAfterReject?.reloadRejectedPostVisible === false &&
          hardening.replacementStalePrivatePostAfterComplete
            ?.privateReloadAfterReject?.reloadThreadPostBodies?.includes(
              hardening.replacementStalePrivatePostAfterComplete?.postBody,
            ) === false &&
          hardening.replacementStalePrivatePostAfterComplete
            ?.privateReloadAfterReject?.apiCommandStateAfterReload?.game_completed ===
            true &&
          hardening.replacementStalePrivatePostAfterComplete
            ?.privateReloadAfterReject?.apiCommandStateAfterReload?.actions?.length ===
            0 &&
          hardening.replacementStalePrivatePostAfterComplete
            ?.privateReloadAfterReject?.apiCommandStateAfterReload
            ?.vote_targets?.length === 0 &&
          hardening.replacementStalePrivatePostAfterComplete
            ?.privateReloadAfterReject?.apiThreadPostBodiesAfterReload?.includes(
              hardening.replacementStalePrivatePostAfterComplete?.postBody,
            ) === false &&
          hardening.replacementStalePrivatePostAfterComplete
            ?.privateReloadAfterReject?.staleOutgoingRouteAfterReload?.status ===
            403 &&
          hardening.replacementStalePrivatePostAfterComplete
            ?.privateReloadAfterReject?.staleOutgoingRouteAfterReload
            ?.responseStatus === 403 &&
          hardening.replacementStalePrivatePostAfterComplete
            ?.privateReloadAfterReject?.staleOutgoingThreadAfterReload?.status ===
            403,
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
    lane(
      "stale-host-complete-reload",
      "Stale host complete recovery reloads revealed console",
      {
        game: hardening.staleHostComplete?.game ?? null,
        routeStatus:
          hardening.staleHostComplete?.staleHostReloadAfterReject
            ?.routeResponseStatus ?? null,
        rejectReceipt:
          hardening.staleHostComplete?.staleHostReloadAfterReject
            ?.rejectReceiptStatusText ?? null,
        revealedSlots:
          hardening.staleHostComplete?.staleHostReloadAfterReject
            ?.slotsAfterReload?.filter(
              (slot) =>
                slot.role_revealed === true && slot.alignment_revealed === true,
            ).length ?? null,
        completeActionVisible:
          hardening.staleHostComplete?.staleHostReloadAfterReject
            ?.roleActionsAfterReload?.includes("complete_game") ?? null,
        passed:
          hardening.staleHostComplete?.status === "passed" &&
          hardening.staleHostComplete?.reject?.error === "GameAlreadyCompleted" &&
          hardening.staleHostComplete?.staleHostReloadAfterReject?.status ===
            "passed" &&
          hardening.staleHostComplete?.staleHostReloadAfterReject
            ?.routeResponseStatus === 200 &&
          hardening.staleHostComplete?.staleHostReloadAfterReject
            ?.rejectReceiptStatusText?.includes("Reject GameAlreadyCompleted") ===
            true &&
          hardening.staleHostComplete?.staleHostReloadAfterReject?.surfaceText?.includes(
            "All 1 slots revealed",
          ) === true &&
          hardening.staleHostComplete?.staleHostReloadAfterReject
            ?.slotsAfterReload?.length === 1 &&
          hardening.staleHostComplete?.staleHostReloadAfterReject
            ?.slotsAfterReload?.every(
              (slot) =>
                slot.role_revealed === true && slot.alignment_revealed === true,
            ) === true &&
          hardening.staleHostComplete?.staleHostReloadAfterReject
            ?.revealTextAfterReload?.includes("All 1 slots revealed") === true &&
          hardening.staleHostComplete?.staleHostReloadAfterReject
            ?.roleActionsAfterReload?.includes("complete_game") === false &&
          hardening.staleHostComplete?.staleHostReloadAfterReject
            ?.apiStateAfterReload?.completed === true &&
          hardening.staleHostComplete?.staleHostReloadAfterReject
            ?.apiStateAfterReload?.slots?.length === 1 &&
          hardening.staleHostComplete?.staleHostReloadAfterReject
            ?.apiStateAfterReload?.slots?.every(
              (slot) =>
                slot.role_revealed === true && slot.alignment_revealed === true,
            ) === true,
      },
    ),
    lane("concurrent-host-complete-race", "Concurrent complete-game commands converge", {
      ackRaceRole: hardening.concurrentHostCompleteRace?.ackRaceRole ?? null,
      rejectRaceRole: hardening.concurrentHostCompleteRace?.rejectRaceRole ?? null,
      rejectError: hardening.concurrentHostCompleteRace?.reject?.error ?? null,
      apiCompleted:
        hardening.concurrentHostCompleteRace?.apiStateAfterRace?.completed ?? null,
      apiRevealedSlots:
        hardening.concurrentHostCompleteRace?.apiStateAfterRace?.slots?.filter(
          (slot) => slot.role_revealed === true && slot.alignment_revealed === true,
        ).length ?? null,
      passed:
        hardening.concurrentHostCompleteRace?.status === "passed" &&
        hardening.concurrentHostCompleteRace?.setup?.firstRoleActions?.includes(
          "complete_game",
        ) === true &&
        hardening.concurrentHostCompleteRace?.setup?.secondRoleActions?.includes(
          "complete_game",
        ) === true &&
        hardening.concurrentHostCompleteRace?.setup?.firstSlots?.length === 1 &&
        hardening.concurrentHostCompleteRace?.setup?.secondSlots?.length === 1 &&
        hardening.concurrentHostCompleteRace?.setup?.firstSlots?.every(
          (slot) => slot.role_revealed === false && slot.alignment_revealed === false,
        ) === true &&
        hardening.concurrentHostCompleteRace?.setup?.secondSlots?.every(
          (slot) => slot.role_revealed === false && slot.alignment_revealed === false,
        ) === true &&
        hardening.concurrentHostCompleteRace?.setup?.firstRevealText?.includes(
          "0/1 slots revealed",
        ) === true &&
        hardening.concurrentHostCompleteRace?.setup?.secondRevealText?.includes(
          "0/1 slots revealed",
        ) === true &&
        ["first", "second"].includes(
          hardening.concurrentHostCompleteRace?.ackRaceRole,
        ) &&
        ["first", "second"].includes(
          hardening.concurrentHostCompleteRace?.rejectRaceRole,
        ) &&
        hardening.concurrentHostCompleteRace?.ackRaceRole !==
          hardening.concurrentHostCompleteRace?.rejectRaceRole &&
        hardening.concurrentHostCompleteRace?.ack?.state === "ack" &&
        hardening.concurrentHostCompleteRace?.ack?.serverEnvelope?.body?.kind ===
          "Ack" &&
        Array.isArray(hardening.concurrentHostCompleteRace?.ack?.streamSeqs) &&
        hardening.concurrentHostCompleteRace.ack.streamSeqs.length === 1 &&
        hardening.concurrentHostCompleteRace?.reject?.state === "reject" &&
        hardening.concurrentHostCompleteRace?.reject?.error ===
          "GameAlreadyCompleted" &&
        hardening.concurrentHostCompleteRace?.reject?.serverEnvelope?.body?.kind ===
          "Reject" &&
        Array.isArray(hardening.concurrentHostCompleteRace?.reject?.streamSeqs) ===
          false &&
        hardening.concurrentHostCompleteRace?.ack?.commandId !==
          hardening.concurrentHostCompleteRace?.reject?.commandId &&
        hardening.concurrentHostCompleteRace?.ack?.requestEnvelope?.body?.body
          ?.command?.CompleteGame?.game ===
          hardening.concurrentHostCompleteRace?.game &&
        hardening.concurrentHostCompleteRace?.reject?.requestEnvelope?.body?.body
          ?.command?.CompleteGame?.game ===
          hardening.concurrentHostCompleteRace?.game &&
        hardening.concurrentHostCompleteRace?.firstSlotsAfterRace?.length === 1 &&
        hardening.concurrentHostCompleteRace?.secondSlotsAfterRace?.length === 1 &&
        hardening.concurrentHostCompleteRace?.firstSlotsAfterRace?.every(
          (slot) => slot.role_revealed === true && slot.alignment_revealed === true,
        ) === true &&
        hardening.concurrentHostCompleteRace?.secondSlotsAfterRace?.every(
          (slot) => slot.role_revealed === true && slot.alignment_revealed === true,
        ) === true &&
        hardening.concurrentHostCompleteRace?.firstRevealTextAfterRace?.includes(
          "All 1 slots revealed",
        ) === true &&
        hardening.concurrentHostCompleteRace?.secondRevealTextAfterRace?.includes(
          "All 1 slots revealed",
        ) === true &&
        hardening.concurrentHostCompleteRace?.firstRoleActionsAfterRace?.includes(
          "complete_game",
        ) === false &&
        hardening.concurrentHostCompleteRace?.secondRoleActionsAfterRace?.includes(
          "complete_game",
        ) === false &&
        [
          hardening.concurrentHostCompleteRace?.firstActivityStatusText,
          hardening.concurrentHostCompleteRace?.secondActivityStatusText,
        ].some((text) => String(text).includes("Ack")) === true &&
        [
          hardening.concurrentHostCompleteRace?.firstActivityStatusText,
          hardening.concurrentHostCompleteRace?.secondActivityStatusText,
        ].some((text) => String(text).includes("Reject GameAlreadyCompleted")) ===
          true &&
        [
          hardening.concurrentHostCompleteRace?.firstDispatchPlan,
          hardening.concurrentHostCompleteRace?.secondDispatchPlan,
        ].some(
          (plan) => plan?.projectionRefreshKeys?.includes("host") === true,
        ) === true &&
        hardening.concurrentHostCompleteRace?.apiStateAfterRace?.completed === true &&
        hardening.concurrentHostCompleteRace?.apiStateAfterRace?.slots?.length ===
          1 &&
        hardening.concurrentHostCompleteRace?.apiStateAfterRace?.slots?.every(
          (slot) => slot.role_revealed === true && slot.alignment_revealed === true,
        ) === true,
    }),
    lane("concurrent-player-complete-race", "Concurrent player command and completion converge", {
      postState: hardening.concurrentPlayerCompleteRace?.post?.state ?? null,
      postError: hardening.concurrentPlayerCompleteRace?.post?.error ?? null,
      postSeq: hardening.concurrentPlayerCompleteRace?.postSeq ?? null,
      completeSeq: hardening.concurrentPlayerCompleteRace?.completeSeq ?? null,
      apiCompleted:
        hardening.concurrentPlayerCompleteRace?.apiStateAfterRace?.completed ?? null,
      apiThreadHasPost:
        hardening.concurrentPlayerCompleteRace?.apiThreadHasPost ?? null,
      passed:
        hardening.concurrentPlayerCompleteRace?.status === "passed" &&
        hardening.concurrentPlayerCompleteRace?.setupCommandState?.gameCompleted === false &&
        hardening.concurrentPlayerCompleteRace?.setupCommandState?.actorSlot ===
          "slot-7" &&
        hardening.concurrentPlayerCompleteRace?.setupPostButton?.action ===
          "submit_post" &&
        hardening.concurrentPlayerCompleteRace?.setupPostButton?.disabled === false &&
        hardening.concurrentPlayerCompleteRace?.setupHostActions?.includes(
          "complete_game",
        ) === true &&
        hardening.concurrentPlayerCompleteRace?.setupHostSlots?.length === 1 &&
        hardening.concurrentPlayerCompleteRace?.setupHostSlots?.every(
          (slot) => slot.role_revealed === false && slot.alignment_revealed === false,
        ) === true &&
        hardening.concurrentPlayerCompleteRace?.complete?.state === "ack" &&
        hardening.concurrentPlayerCompleteRace?.complete?.serverEnvelope?.body?.kind ===
          "Ack" &&
        Array.isArray(hardening.concurrentPlayerCompleteRace?.complete?.streamSeqs) &&
        hardening.concurrentPlayerCompleteRace.complete.streamSeqs.length === 1 &&
        hardening.concurrentPlayerCompleteRace?.complete?.requestEnvelope?.body?.body
          ?.command?.CompleteGame?.game ===
          hardening.concurrentPlayerCompleteRace?.game &&
        hardening.concurrentPlayerCompleteRace?.post?.requestEnvelope?.body?.body
          ?.command?.SubmitPost?.body ===
          hardening.concurrentPlayerCompleteRace?.postBody &&
        ((hardening.concurrentPlayerCompleteRace?.post?.state === "ack" &&
          hardening.concurrentPlayerCompleteRace?.post?.serverEnvelope?.body?.kind ===
            "Ack" &&
          Array.isArray(hardening.concurrentPlayerCompleteRace?.post?.streamSeqs) &&
          hardening.concurrentPlayerCompleteRace.post.streamSeqs.length === 1 &&
          hardening.concurrentPlayerCompleteRace.postSeq <
            hardening.concurrentPlayerCompleteRace.completeSeq &&
          hardening.concurrentPlayerCompleteRace?.apiThreadHasPost === true) ||
          (hardening.concurrentPlayerCompleteRace?.post?.state === "reject" &&
            hardening.concurrentPlayerCompleteRace?.post?.error ===
              "GameAlreadyCompleted" &&
            hardening.concurrentPlayerCompleteRace?.post?.serverEnvelope?.body?.kind ===
              "Reject" &&
            Array.isArray(hardening.concurrentPlayerCompleteRace?.post?.streamSeqs) ===
              false &&
            hardening.concurrentPlayerCompleteRace?.apiThreadHasPost === false)) &&
        hardening.concurrentPlayerCompleteRace?.commandStateAfterRace?.gameCompleted ===
          true &&
        hardening.concurrentPlayerCompleteRace?.commandStateAfterRace?.actions?.length ===
          0 &&
        hardening.concurrentPlayerCompleteRace?.commandStateAfterRace?.voteTargets
          ?.length === 0 &&
        hardening.concurrentPlayerCompleteRace?.buttonsAfterRace?.every(
          (button) => button.disabled === true,
        ) === true &&
        hardening.concurrentPlayerCompleteRace?.hostSlotsAfterRace?.length === 1 &&
        hardening.concurrentPlayerCompleteRace?.hostSlotsAfterRace?.every(
          (slot) => slot.role_revealed === true && slot.alignment_revealed === true,
        ) === true &&
        hardening.concurrentPlayerCompleteRace?.apiCommandStateAfterRace
          ?.game_completed === true &&
        hardening.concurrentPlayerCompleteRace?.apiCommandStateAfterRace?.actions
          ?.length === 0 &&
        hardening.concurrentPlayerCompleteRace?.apiCommandStateAfterRace?.vote_targets
          ?.length === 0 &&
        hardening.concurrentPlayerCompleteRace?.apiStateAfterRace?.completed === true &&
        hardening.concurrentPlayerCompleteRace?.apiStateAfterRace?.slots?.length ===
          1 &&
        hardening.concurrentPlayerCompleteRace?.apiStateAfterRace?.slots?.every(
          (slot) => slot.role_revealed === true && slot.alignment_revealed === true,
        ) === true,
    }),
    lane("public-player-complete-reload", "Public player board reloads completed game truth", {
      game: hardening.concurrentPlayerCompleteRace?.game ?? null,
      routeStatus:
        hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace
          ?.routeResponseStatus ?? null,
      gameCompleted:
        hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace
          ?.recoveredCommandState?.gameCompleted ?? null,
      postState: hardening.concurrentPlayerCompleteRace?.post?.state ?? null,
      reloadPostCount:
        hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace
          ?.reloadPostCount ?? null,
      passed:
        hardening.concurrentPlayerCompleteRace?.status === "passed" &&
        hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace?.status ===
          "passed" &&
        hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace
          ?.routeResponseStatus === 200 &&
        hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace
          ?.threadPagerVisible === true &&
        hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace?.surfaceText?.includes(
          "Endgame",
        ) === true &&
        hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace?.surfaceText?.includes(
          "The game is complete.",
        ) === true &&
        hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace
          ?.recoveredCommandState?.actorSlot === "slot-7" &&
        hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace
          ?.recoveredCommandState?.gameCompleted === true &&
        hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace
          ?.recoveredCommandState?.actions?.length === 0 &&
        hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace
          ?.recoveredCommandState?.voteTargets?.length === 0 &&
        hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace
          ?.recoveredCommandState?.boundary?.includes("game is complete") === true &&
        hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace
          ?.reloadButtons?.some((button) => button.disabled !== true) === false &&
        hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace
          ?.apiCommandStateAfterReload?.game_completed === true &&
        hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace
          ?.apiCommandStateAfterReload?.actions?.length === 0 &&
        hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace
          ?.apiCommandStateAfterReload?.vote_targets?.length === 0 &&
        hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace
          ?.apiStateAfterReload?.completed === true &&
        hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace
          ?.apiStateAfterReload?.slots?.length === 1 &&
        hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace
          ?.apiStateAfterReload?.slots?.every(
            (slot) => slot.role_revealed === true && slot.alignment_revealed === true,
          ) === true &&
        ((hardening.concurrentPlayerCompleteRace?.post?.state === "ack" &&
          hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace
            ?.reloadPostCount === 1 &&
          hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace
            ?.reloadPostVisible === true &&
          hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace
            ?.apiThreadPostCount === 1 &&
          hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace
            ?.reloadThreadPostBodies?.includes(
              hardening.concurrentPlayerCompleteRace?.postBody,
            ) === true &&
          hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace
            ?.apiThreadPostBodiesAfterReload?.includes(
              hardening.concurrentPlayerCompleteRace?.postBody,
            ) === true) ||
          (hardening.concurrentPlayerCompleteRace?.post?.state === "reject" &&
            hardening.concurrentPlayerCompleteRace?.post?.error ===
              "GameAlreadyCompleted" &&
            hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace
              ?.reloadPostCount === 0 &&
            hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace
              ?.reloadPostVisible === false &&
            hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace
              ?.apiThreadPostCount === 0 &&
            hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace
              ?.reloadThreadPostBodies?.includes(
                hardening.concurrentPlayerCompleteRace?.postBody,
              ) === false &&
            hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace
              ?.apiThreadPostBodiesAfterReload?.includes(
                hardening.concurrentPlayerCompleteRace?.postBody,
              ) === false)),
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
    lane(
      "stale-player-complete-reload",
      "Stale public player complete recovery reloads completed board",
      {
        game: hardening.stalePlayerComplete?.game ?? null,
        routeStatus:
          hardening.stalePlayerComplete?.stalePublicReloadAfterReject
            ?.routeResponseStatus ?? null,
        gameCompleted:
          hardening.stalePlayerComplete?.stalePublicReloadAfterReject
            ?.recoveredCommandState?.gameCompleted ?? null,
        currentVote:
          hardening.stalePlayerComplete?.stalePublicReloadAfterReject
            ?.reloadCurrentVote?.hasVote ?? null,
        threadPostCount:
          hardening.stalePlayerComplete?.stalePublicReloadAfterReject
            ?.reloadThreadPostBodies?.length ?? null,
        passed:
          hardening.stalePlayerComplete?.status === "passed" &&
          hardening.stalePlayerComplete?.reject?.error ===
            "GameAlreadyCompleted" &&
          hardening.stalePlayerComplete?.currentVoteAfterReject?.hasVote ===
            "false" &&
          hardening.stalePlayerComplete?.currentVoteAfterReject?.text?.includes(
            "No current vote",
          ) === true &&
          hardening.stalePlayerComplete?.stalePublicReloadAfterReject?.status ===
            "passed" &&
          hardening.stalePlayerComplete?.stalePublicReloadAfterReject
            ?.routeResponseStatus === 200 &&
          hardening.stalePlayerComplete?.stalePublicReloadAfterReject
            ?.threadPagerVisible === true &&
          hardening.stalePlayerComplete?.stalePublicReloadAfterReject
            ?.surfaceText?.includes("Endgame") === true &&
          hardening.stalePlayerComplete?.stalePublicReloadAfterReject
            ?.surfaceText?.includes("The game is complete.") === true &&
          hardening.stalePlayerComplete?.stalePublicReloadAfterReject
            ?.recoveredCommandState?.actorSlot === "slot-7" &&
          hardening.stalePlayerComplete?.stalePublicReloadAfterReject
            ?.recoveredCommandState?.gameCompleted === true &&
          hardening.stalePlayerComplete?.stalePublicReloadAfterReject
            ?.recoveredCommandState?.actions?.length === 0 &&
          hardening.stalePlayerComplete?.stalePublicReloadAfterReject
            ?.recoveredCommandState?.voteTargets?.length === 0 &&
          hardening.stalePlayerComplete?.stalePublicReloadAfterReject
            ?.recoveredCommandState?.boundary?.includes("game is complete") ===
            true &&
          hardening.stalePlayerComplete?.stalePublicReloadAfterReject
            ?.reloadButtons?.some((button) => button.disabled !== true) ===
            false &&
          hardening.stalePlayerComplete?.stalePublicReloadAfterReject
            ?.reloadCurrentVote?.hasVote === "false" &&
          hardening.stalePlayerComplete?.stalePublicReloadAfterReject
            ?.reloadCurrentVote?.text?.includes("No current vote") === true &&
          hardening.stalePlayerComplete?.stalePublicReloadAfterReject
            ?.reloadThreadPostBodies?.length === 0 &&
          hardening.stalePlayerComplete?.stalePublicReloadAfterReject
            ?.apiCommandStateAfterReload?.game_completed === true &&
          hardening.stalePlayerComplete?.stalePublicReloadAfterReject
            ?.apiCommandStateAfterReload?.actions?.length === 0 &&
          hardening.stalePlayerComplete?.stalePublicReloadAfterReject
            ?.apiCommandStateAfterReload?.vote_targets?.length === 0 &&
          hardening.stalePlayerComplete?.stalePublicReloadAfterReject
            ?.apiThreadPostBodiesAfterReload?.length === 0 &&
          hardening.stalePlayerComplete?.stalePublicReloadAfterReject
            ?.apiStateAfterReload?.completed === true &&
          hardening.stalePlayerComplete?.stalePublicReloadAfterReject
            ?.apiStateAfterReload?.slots?.length === 1 &&
          hardening.stalePlayerComplete?.stalePublicReloadAfterReject
            ?.apiStateAfterReload?.slots?.every(
              (slot) =>
                slot.role_revealed === true && slot.alignment_revealed === true,
            ) === true,
      },
    ),
    lane("stale-same-action-recovery", "Stale duplicate player action rejects and refreshes", {
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
        hardening.staleSameActionRecovery?.reject?.state === "reject" &&
        hardening.staleSameActionRecovery?.reject?.error ===
          "ActionAlreadySubmitted" &&
        hardening.staleSameActionRecovery?.reject?.serverEnvelope?.body?.kind ===
          "Reject" &&
        Array.isArray(hardening.staleSameActionRecovery?.reject?.streamSeqs) ===
          false &&
        hardening.staleSameActionRecovery?.reject?.commandId !==
          hardening.staleSameActionRecovery?.legalActionCommandId &&
        hardening.staleSameActionRecovery?.reject?.requestEnvelope?.body?.body
          ?.command?.SubmitAction?.actor_slot === "slot_4" &&
        hardening.staleSameActionRecovery?.reject?.requestEnvelope?.body?.body
          ?.command?.SubmitAction?.action_id === "role_factional_kill" &&
        hardening.staleSameActionRecovery?.reject?.requestEnvelope?.body?.body
          ?.command?.SubmitAction?.template_id === "factional_kill" &&
        hardening.staleSameActionRecovery?.reject?.requestEnvelope?.body?.body
          ?.command?.SubmitAction?.targets?.[0] ===
          hardening.staleSameActionRecovery?.legalActionTarget &&
        hardening.staleSameActionRecovery?.reject?.message?.includes(
          "refresh and use current controls",
        ) === true &&
        hardening.staleSameActionRecovery?.dispatchPlan?.projectionRefreshKeys?.includes(
          "notifications",
        ) === true &&
        hardening.staleSameActionRecovery?.dispatchPlan?.projectionRefreshKeys?.includes(
          "investigationResults",
        ) === true &&
        hardening.staleSameActionRecovery?.dispatchPlan?.projectionRefreshKeys?.includes(
          "commandState",
        ) === true &&
        hardening.staleSameActionRecovery?.dispatchPlan?.projectionRefreshKeys?.includes(
          "dayVoteOutcomes",
        ) === false &&
        hardening.staleSameActionRecovery?.currentReceipt?.actionId ===
          "submit_action:factional_kill" &&
        hardening.staleSameActionRecovery?.currentReceipt?.state === "reject" &&
        hardening.staleSameActionRecovery?.currentReceipt?.commandTrace
          ?.projectionRefreshKeys?.includes("commandState") === true &&
        hardening.staleSameActionRecovery?.currentReceipt?.commandTrace
          ?.projectionRefreshKeys?.includes("dayVoteOutcomes") === false &&
        hardening.staleSameActionRecovery?.receiptStatusText?.includes(
          "Reject ActionAlreadySubmitted",
        ) === true &&
        hardening.staleSameActionRecovery?.receiptStatusText?.includes(
          "refresh and use current controls",
        ) === true &&
        hardening.staleSameActionRecovery?.staleN01Phase?.phaseId === "N01" &&
        hardening.staleSameActionRecovery?.commandStateAfterReject?.actorSlot ===
          "slot_4" &&
        hardening.staleSameActionRecovery?.commandStateAfterReject?.actorAlive ===
          true &&
        hardening.staleSameActionRecovery?.commandStateAfterReject?.actorStatus ===
          "alive" &&
        hardening.staleSameActionRecovery?.commandStateAfterReject?.phase?.phaseId ===
          "N01" &&
        hardening.staleSameActionRecovery?.commandStateAfterReject?.phase?.locked ===
          false &&
        hardening.staleSameActionRecovery?.commandStateAfterReject?.actions?.length ===
          0 &&
        hardening.staleSameActionRecovery?.apiCommandStateAfterReject?.actor_slot ===
          "slot_4" &&
        hardening.staleSameActionRecovery?.apiCommandStateAfterReject?.actor_alive ===
          true &&
        hardening.staleSameActionRecovery?.apiCommandStateAfterReject?.actor_status ===
          "alive" &&
        hardening.staleSameActionRecovery?.apiCommandStateAfterReject?.phase?.phase_id ===
          "N01" &&
        hardening.staleSameActionRecovery?.apiCommandStateAfterReject?.phase?.locked ===
          false &&
        hardening.staleSameActionRecovery?.apiCommandStateAfterReject?.actions?.length ===
          0 &&
        hardening.staleSameActionRecovery?.actionVisibleAfterRefresh === false,
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
        hardening.staleActionConflict?.reject?.state === "reject" &&
        hardening.staleActionConflict?.reject?.error === "PhaseLocked" &&
        hardening.staleActionConflict?.reject?.serverEnvelope?.body?.kind ===
          "Reject" &&
        Array.isArray(hardening.staleActionConflict?.reject?.streamSeqs) === false &&
        hardening.staleActionConflict?.reject?.requestEnvelope?.body?.body?.command
          ?.SubmitAction?.actor_slot === "slot_4" &&
        hardening.staleActionConflict?.reject?.requestEnvelope?.body?.body?.command
          ?.SubmitAction?.template_id === "factional_kill" &&
        hardening.staleActionConflict?.reject?.message?.includes(
          "stale action state",
        ) === true &&
        hardening.staleActionConflict?.reject?.message?.includes(
          "current action controls",
        ) === true &&
        hardening.staleActionConflict?.dispatchPlan?.projectionRefreshKeys?.includes(
          "notifications",
        ) === true &&
        hardening.staleActionConflict?.dispatchPlan?.projectionRefreshKeys?.includes(
          "investigationResults",
        ) === true &&
        hardening.staleActionConflict?.dispatchPlan?.projectionRefreshKeys?.includes(
          "commandState",
        ) === true &&
        hardening.staleActionConflict?.dispatchPlan?.projectionRefreshKeys?.includes(
          "dayVoteOutcomes",
        ) === true &&
        hardening.staleActionConflict?.currentReceipt?.actionId ===
          "submit_action:factional_kill" &&
        hardening.staleActionConflict?.currentReceipt?.state === "reject" &&
        hardening.staleActionConflict?.currentReceipt?.commandTrace
          ?.projectionRefreshKeys?.includes("commandState") === true &&
        hardening.staleActionConflict?.currentReceipt?.commandTrace
          ?.projectionRefreshKeys?.includes("dayVoteOutcomes") === false &&
        hardening.staleActionConflict?.receiptStatusText?.includes(
          "Reject PhaseLocked",
        ) === true &&
        hardening.staleActionConflict?.receiptStatusText?.includes(
          "stale action state",
        ) === true &&
        hardening.staleActionConflict?.staleN01Phase?.phaseId === "N01" &&
        hardening.staleActionConflict?.phaseAfterReject?.phaseId === "D02" &&
        hardening.staleActionConflict?.commandStateAfterReject?.actorSlot ===
          "slot_4" &&
        hardening.staleActionConflict?.commandStateAfterReject?.actorAlive ===
          true &&
        hardening.staleActionConflict?.commandStateAfterReject?.actorStatus ===
          "alive" &&
        hardening.staleActionConflict?.commandStateAfterReject?.phase?.phaseId ===
          "D02" &&
        hardening.staleActionConflict?.commandStateAfterReject?.phase?.locked ===
          false &&
        hardening.staleActionConflict?.commandStateAfterReject?.actions?.length ===
          0 &&
        hardening.staleActionConflict?.apiCommandStateAfterReject?.actor_slot ===
          "slot_4" &&
        hardening.staleActionConflict?.apiCommandStateAfterReject?.actor_alive ===
          true &&
        hardening.staleActionConflict?.apiCommandStateAfterReject?.actor_status ===
          "alive" &&
        hardening.staleActionConflict?.apiCommandStateAfterReject?.phase?.phase_id ===
          "D02" &&
        hardening.staleActionConflict?.apiCommandStateAfterReject?.phase?.locked ===
          false &&
        hardening.staleActionConflict?.apiCommandStateAfterReject?.actions?.length ===
          0 &&
        hardening.staleActionConflict?.actionVisibleAfterRefresh === false,
    }),
    lane("stale-action-conflict-message", "Stale player action conflict message is explicit", {
      rejectError: hardening.staleActionConflict?.reject?.error ?? null,
      rejectMessage: hardening.staleActionConflict?.reject?.message ?? null,
      templateId: hardening.staleActionConflict?.actionConfig?.templateId ?? null,
      stalePhase: hardening.staleActionConflict?.staleN01Phase?.phaseId ?? null,
      refreshedPhase: hardening.staleActionConflict?.phaseAfterReject?.phaseId ?? null,
      receiptStatusText: hardening.staleActionConflict?.receiptStatusText ?? null,
      passed:
        hardening.staleActionConflict?.status === "passed" &&
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
          "resolve_phase",
        ) === true &&
        hardening.concurrentHostResolveRace?.setup?.phaseActions?.includes(
          "lock_thread",
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
          "unlock_thread",
        ) === true &&
        hardening.concurrentHostResolveRace?.livePhaseActionsAfterRace?.includes(
          "advance_phase",
        ) === true &&
        hardening.concurrentHostResolveRace?.livePhaseActionsAfterRace?.includes(
          "resolve_phase",
        ) === false &&
        hardening.concurrentHostResolveRace?.livePhaseActionsAfterRace?.includes(
          "lock_thread",
        ) === false &&
        hardening.concurrentHostResolveRace?.concurrentPhaseActionsAfterRace?.includes(
          "unlock_thread",
        ) === true &&
        hardening.concurrentHostResolveRace?.concurrentPhaseActionsAfterRace?.includes(
          "advance_phase",
        ) === true &&
        hardening.concurrentHostResolveRace?.concurrentPhaseActionsAfterRace?.includes(
          "resolve_phase",
        ) === false &&
        hardening.concurrentHostResolveRace?.concurrentPhaseActionsAfterRace?.includes(
          "lock_thread",
        ) === false &&
        hardening.concurrentHostResolveRace?.liveActivityRow?.actionId ===
          "resolve_phase" &&
        hardening.concurrentHostResolveRace?.concurrentActivityRow?.actionId ===
          "resolve_phase" &&
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
            ?.livePhaseActionsAfterReload?.includes("unlock_thread") === true &&
          hardening.concurrentHostResolveRace?.roleReloadAfterRace
            ?.livePhaseActionsAfterReload?.includes("advance_phase") === true &&
          hardening.concurrentHostResolveRace?.roleReloadAfterRace
            ?.livePhaseActionsAfterReload?.includes("resolve_phase") === false &&
          hardening.concurrentHostResolveRace?.roleReloadAfterRace
            ?.livePhaseActionsAfterReload?.includes("lock_thread") === false &&
          hardening.concurrentHostResolveRace?.roleReloadAfterRace
            ?.concurrentPhaseActionsAfterReload?.includes("unlock_thread") ===
            true &&
          hardening.concurrentHostResolveRace?.roleReloadAfterRace
            ?.concurrentPhaseActionsAfterReload?.includes("advance_phase") ===
            true &&
          hardening.concurrentHostResolveRace?.roleReloadAfterRace
            ?.concurrentPhaseActionsAfterReload?.includes("resolve_phase") ===
            false &&
          hardening.concurrentHostResolveRace?.roleReloadAfterRace
            ?.concurrentPhaseActionsAfterReload?.includes("lock_thread") ===
            false &&
          hardening.concurrentHostResolveRace?.roleReloadAfterRace
            ?.liveDeadlineActionsAfterReload?.includes("extend_deadline") === true &&
          hardening.concurrentHostResolveRace?.roleReloadAfterRace
            ?.concurrentDeadlineActionsAfterReload?.includes("extend_deadline") ===
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
          "advance_phase",
        ) === true &&
        hardening.concurrentHostAdvanceRace?.setup?.phaseActions?.includes(
          "unlock_thread",
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
          "resolve_phase",
        ) === true &&
        hardening.concurrentHostAdvanceRace?.livePhaseActionsAfterRace?.includes(
          "lock_thread",
        ) === true &&
        hardening.concurrentHostAdvanceRace?.livePhaseActionsAfterRace?.includes(
          "advance_phase",
        ) === false &&
        hardening.concurrentHostAdvanceRace?.livePhaseActionsAfterRace?.includes(
          "unlock_thread",
        ) === false &&
        hardening.concurrentHostAdvanceRace?.concurrentPhaseActionsAfterRace?.includes(
          "resolve_phase",
        ) === true &&
        hardening.concurrentHostAdvanceRace?.concurrentPhaseActionsAfterRace?.includes(
          "lock_thread",
        ) === true &&
        hardening.concurrentHostAdvanceRace?.concurrentPhaseActionsAfterRace?.includes(
          "advance_phase",
        ) === false &&
        hardening.concurrentHostAdvanceRace?.concurrentPhaseActionsAfterRace?.includes(
          "unlock_thread",
        ) === false &&
        hardening.concurrentHostAdvanceRace?.liveActivityRow?.actionId ===
          "advance_phase" &&
        hardening.concurrentHostAdvanceRace?.concurrentActivityRow?.actionId ===
          "advance_phase" &&
        hardening.concurrentHostAdvanceRace?.apiPhaseAfterRace?.phase_id === "N02" &&
        hardening.concurrentHostAdvanceRace?.apiPhaseAfterRace?.locked === false,
    }),
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
            "advance_phase_by_deadline",
          ) === true &&
          hardening.concurrentHostDeadlineAdvanceRace?.setup?.visibleActions?.includes(
            "advance_phase",
          ) === true &&
          hardening.concurrentHostDeadlineAdvanceRace?.setup?.visibleActions?.includes(
            "unlock_thread",
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
            "resolve_phase",
          ) === true &&
          hardening.concurrentHostDeadlineAdvanceRace?.livePhaseActionsAfterRace?.includes(
            "lock_thread",
          ) === true &&
          hardening.concurrentHostDeadlineAdvanceRace?.livePhaseActionsAfterRace?.includes(
            "advance_phase_by_deadline",
          ) === false &&
          hardening.concurrentHostDeadlineAdvanceRace?.concurrentPhaseActionsAfterRace?.includes(
            "resolve_phase",
          ) === true &&
          hardening.concurrentHostDeadlineAdvanceRace?.concurrentPhaseActionsAfterRace?.includes(
            "lock_thread",
          ) === true &&
          hardening.concurrentHostDeadlineAdvanceRace?.concurrentPhaseActionsAfterRace?.includes(
            "advance_phase_by_deadline",
          ) === false &&
          hardening.concurrentHostDeadlineAdvanceRace?.liveActivityRow?.actionId ===
            "advance_phase_by_deadline" &&
          hardening.concurrentHostDeadlineAdvanceRace?.concurrentActivityRow?.actionId ===
            "advance_phase_by_deadline" &&
          hardening.concurrentHostDeadlineAdvanceRace?.apiPhaseAfterRace?.phase_id ===
            "N01" &&
          hardening.concurrentHostDeadlineAdvanceRace?.apiPhaseAfterRace?.locked ===
            false &&
          hardening.concurrentHostDeadlineAdvanceRace?.apiPhaseAfterRace?.deadline ===
            null,
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
            "advance_phase",
          ) === true &&
          hardening.concurrentHostMixedAdvanceRace?.setup?.visibleActions?.includes(
            "advance_phase_by_deadline",
          ) === true &&
          ["normal", "deadline"].includes(
            hardening.concurrentHostMixedAdvanceRace?.ackRaceRole,
          ) &&
          ["normal", "deadline"].includes(
            hardening.concurrentHostMixedAdvanceRace?.rejectRaceRole,
          ) &&
          hardening.concurrentHostMixedAdvanceRace?.ackRaceRole !==
            hardening.concurrentHostMixedAdvanceRace?.rejectRaceRole &&
          ["advance_phase", "advance_phase_by_deadline"].includes(
            hardening.concurrentHostMixedAdvanceRace?.ackActionId,
          ) &&
          ["advance_phase", "advance_phase_by_deadline"].includes(
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
          "advance_phase"
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
          "advance_phase"
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
            "resolve_phase",
          ) === true &&
          hardening.concurrentHostMixedAdvanceRace?.normalPhaseActionsAfterRace?.includes(
            "lock_thread",
          ) === true &&
          hardening.concurrentHostMixedAdvanceRace?.normalPhaseActionsAfterRace?.includes(
            "advance_phase",
          ) === false &&
          hardening.concurrentHostMixedAdvanceRace?.normalPhaseActionsAfterRace?.includes(
            "advance_phase_by_deadline",
          ) === false &&
          hardening.concurrentHostMixedAdvanceRace?.deadlinePhaseActionsAfterRace?.includes(
            "resolve_phase",
          ) === true &&
          hardening.concurrentHostMixedAdvanceRace?.deadlinePhaseActionsAfterRace?.includes(
            "lock_thread",
          ) === true &&
          hardening.concurrentHostMixedAdvanceRace?.deadlinePhaseActionsAfterRace?.includes(
            "advance_phase",
          ) === false &&
          hardening.concurrentHostMixedAdvanceRace?.deadlinePhaseActionsAfterRace?.includes(
            "advance_phase_by_deadline",
          ) === false &&
          hardening.concurrentHostMixedAdvanceRace?.normalActivityRow?.actionId ===
            "advance_phase" &&
          hardening.concurrentHostMixedAdvanceRace?.deadlineActivityRow?.actionId ===
            "advance_phase_by_deadline" &&
          hardening.concurrentHostMixedAdvanceRace?.apiPhaseAfterRace?.phase_id ===
            "N01" &&
          hardening.concurrentHostMixedAdvanceRace?.apiPhaseAfterRace?.locked ===
            false &&
          hardening.concurrentHostMixedAdvanceRace?.apiPhaseAfterRace?.deadline ===
            null,
      },
    ),
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
    lane(
      "stale-host-resolve-reload",
      "Stale host resolve recovery reloads locked phase console",
      {
        game: session.game ?? null,
        routeStatus:
          hardening.staleHostResolve?.staleHostResolveReloadAfterReject
            ?.routeResponseStatus ?? null,
        rejectReceipt:
          hardening.staleHostResolve?.staleHostResolveReloadAfterReject
            ?.rejectReceiptStatusText ?? null,
        phaseId:
          hardening.staleHostResolve?.staleHostResolveReloadAfterReject
            ?.phaseAfterReload?.id ?? null,
        locked:
          hardening.staleHostResolve?.staleHostResolveReloadAfterReject
            ?.phaseAfterReload?.locked ?? null,
        phaseActions:
          hardening.staleHostResolve?.staleHostResolveReloadAfterReject
            ?.phaseActionsAfterReload ?? null,
        apiLocked:
          hardening.staleHostResolve?.staleHostResolveReloadAfterReject
            ?.apiPhaseAfterReload?.locked ?? null,
        passed:
          hardening.staleHostResolve?.status === "passed" &&
          hardening.staleHostResolve?.reject?.error === "PhaseLocked" &&
          hardening.staleHostResolve?.staleHostResolveReloadAfterReject?.status ===
            "passed" &&
          hardening.staleHostResolve?.staleHostResolveReloadAfterReject
            ?.routeResponseStatus === 200 &&
          hardening.staleHostResolve?.staleHostResolveReloadAfterReject
            ?.rejectReceiptStatusText?.includes("Reject PhaseLocked") === true &&
          hardening.staleHostResolve?.staleHostResolveReloadAfterReject
            ?.phaseAfterReload?.id === "D02" &&
          hardening.staleHostResolve?.staleHostResolveReloadAfterReject
            ?.phaseAfterReload?.locked === true &&
          hardening.staleHostResolve?.staleHostResolveReloadAfterReject
            ?.phaseActionsAfterReload?.includes("unlock_thread") === true &&
          hardening.staleHostResolve?.staleHostResolveReloadAfterReject
            ?.phaseActionsAfterReload?.includes("advance_phase") === true &&
          hardening.staleHostResolve?.staleHostResolveReloadAfterReject
            ?.phaseActionsAfterReload?.includes("resolve_phase") === false &&
          hardening.staleHostResolve?.staleHostResolveReloadAfterReject
            ?.phaseActionsAfterReload?.includes("lock_thread") === false &&
          hardening.staleHostResolve?.staleHostResolveReloadAfterReject
            ?.deadlineActionsAfterReload?.includes("extend_deadline") === true &&
          hardening.staleHostResolve?.staleHostResolveReloadAfterReject
            ?.apiPhaseAfterReload?.phase_id === "D02" &&
          hardening.staleHostResolve?.staleHostResolveReloadAfterReject
            ?.apiPhaseAfterReload?.locked === true,
      },
    ),
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
    lane(
      "stale-host-advance-reload",
      "Stale host advance recovery reloads open phase console",
      {
        game: session.game ?? null,
        routeStatus:
          hardening.staleHostAdvance?.staleHostAdvanceReloadAfterReject
            ?.routeResponseStatus ?? null,
        rejectReceipt:
          hardening.staleHostAdvance?.staleHostAdvanceReloadAfterReject
            ?.rejectReceiptStatusText ?? null,
        phaseId:
          hardening.staleHostAdvance?.staleHostAdvanceReloadAfterReject
            ?.phaseAfterReload?.id ?? null,
        locked:
          hardening.staleHostAdvance?.staleHostAdvanceReloadAfterReject
            ?.phaseAfterReload?.locked ?? null,
        phaseActions:
          hardening.staleHostAdvance?.staleHostAdvanceReloadAfterReject
            ?.phaseActionsAfterReload ?? null,
        apiLocked:
          hardening.staleHostAdvance?.staleHostAdvanceReloadAfterReject
            ?.apiPhaseAfterReload?.locked ?? null,
        passed:
          hardening.staleHostAdvance?.status === "passed" &&
          hardening.staleHostAdvance?.reject?.error === "InvalidTarget" &&
          hardening.staleHostAdvance?.staleHostAdvanceReloadAfterReject?.status ===
            "passed" &&
          hardening.staleHostAdvance?.staleHostAdvanceReloadAfterReject
            ?.routeResponseStatus === 200 &&
          hardening.staleHostAdvance?.staleHostAdvanceReloadAfterReject
            ?.rejectReceiptStatusText?.includes("Reject InvalidTarget") === true &&
          hardening.staleHostAdvance?.staleHostAdvanceReloadAfterReject
            ?.phaseAfterReload?.id === "D02" &&
          hardening.staleHostAdvance?.staleHostAdvanceReloadAfterReject
            ?.phaseAfterReload?.locked === false &&
          hardening.staleHostAdvance?.staleHostAdvanceReloadAfterReject
            ?.phaseActionsAfterReload?.includes("resolve_phase") === true &&
          hardening.staleHostAdvance?.staleHostAdvanceReloadAfterReject
            ?.phaseActionsAfterReload?.includes("lock_thread") === true &&
          hardening.staleHostAdvance?.staleHostAdvanceReloadAfterReject
            ?.phaseActionsAfterReload?.includes("advance_phase") === false &&
          hardening.staleHostAdvance?.staleHostAdvanceReloadAfterReject
            ?.deadlineActionsAfterReload?.includes("extend_deadline") === true &&
          hardening.staleHostAdvance?.staleHostAdvanceReloadAfterReject
            ?.apiPhaseAfterReload?.phase_id === "D02" &&
          hardening.staleHostAdvance?.staleHostAdvanceReloadAfterReject
            ?.apiPhaseAfterReload?.locked === false,
      },
    ),
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
    lane("stale-host-deadline-reload", "Stale host deadline recovery reloads open phase console", {
      rejectError: hardening.staleHostDeadline?.reject?.error ?? null,
      routeStatus:
        hardening.staleHostDeadline?.staleHostDeadlineReloadAfterReject
          ?.routeResponseStatus ?? null,
      rejectReceipt:
        hardening.staleHostDeadline?.staleHostDeadlineReloadAfterReject
          ?.rejectReceiptStatusText ?? null,
      phaseId:
        hardening.staleHostDeadline?.staleHostDeadlineReloadAfterReject
          ?.phaseAfterReload?.id ?? null,
      locked:
        hardening.staleHostDeadline?.staleHostDeadlineReloadAfterReject
          ?.phaseAfterReload?.locked ?? null,
      deadlineActions:
        hardening.staleHostDeadline?.staleHostDeadlineReloadAfterReject
          ?.deadlineActionsAfterReload ?? null,
      phaseActions:
        hardening.staleHostDeadline?.staleHostDeadlineReloadAfterReject
          ?.phaseActionsAfterReload ?? null,
      apiDeadline:
        hardening.staleHostDeadline?.staleHostDeadlineReloadAfterReject
          ?.apiPhaseAfterReload?.deadline ?? null,
      passed:
        hardening.staleHostDeadline?.status === "passed" &&
        hardening.staleHostDeadline?.reject?.error === "PhaseLocked" &&
        hardening.staleHostDeadline?.staleHostDeadlineReloadAfterReject?.status ===
          "passed" &&
        hardening.staleHostDeadline?.staleHostDeadlineReloadAfterReject
          ?.routeResponseStatus === 200 &&
        hardening.staleHostDeadline?.staleHostDeadlineReloadAfterReject
          ?.rejectReceiptStatusText?.includes("Reject PhaseLocked") === true &&
        hardening.staleHostDeadline?.staleHostDeadlineReloadAfterReject
          ?.phaseAfterReload?.id === "D02" &&
        hardening.staleHostDeadline?.staleHostDeadlineReloadAfterReject
          ?.phaseAfterReload?.locked === false &&
        hardening.staleHostDeadline?.staleHostDeadlineReloadAfterReject
          ?.deadlineActionsAfterReload?.includes("extend_deadline") === true &&
        hardening.staleHostDeadline?.staleHostDeadlineReloadAfterReject
          ?.phaseActionsAfterReload?.includes("resolve_phase") === true &&
        hardening.staleHostDeadline?.staleHostDeadlineReloadAfterReject
          ?.phaseActionsAfterReload?.includes("lock_thread") === true &&
        hardening.staleHostDeadline?.staleHostDeadlineReloadAfterReject
          ?.apiPhaseAfterReload?.phase_id === "D02" &&
        hardening.staleHostDeadline?.staleHostDeadlineReloadAfterReject
          ?.apiPhaseAfterReload?.locked === false &&
        hardening.staleHostDeadline?.staleHostDeadlineReloadAfterReject
          ?.apiPhaseAfterReload?.deadline === null,
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
    lane("stale-cohost-deadline-reload", "Stale cohost deadline recovery reloads delegated console", {
      rejectError: hardening.staleCohostDeadline?.reject?.error ?? null,
      routeStatus:
        hardening.staleCohostDeadline?.staleCohostDeadlineReloadAfterReject
          ?.routeResponseStatus ?? null,
      rejectReceipt:
        hardening.staleCohostDeadline?.staleCohostDeadlineReloadAfterReject
          ?.rejectReceiptStatusText ?? null,
      phaseId:
        hardening.staleCohostDeadline?.staleCohostDeadlineReloadAfterReject
          ?.phaseAfterReload?.id ?? null,
      locked:
        hardening.staleCohostDeadline?.staleCohostDeadlineReloadAfterReject
          ?.phaseAfterReload?.locked ?? null,
      deadlineActions:
        hardening.staleCohostDeadline?.staleCohostDeadlineReloadAfterReject
          ?.deadlineActionsAfterReload ?? null,
      phaseActions:
        hardening.staleCohostDeadline?.staleCohostDeadlineReloadAfterReject
          ?.phaseActionsAfterReload ?? null,
      apiDeadline:
        hardening.staleCohostDeadline?.staleCohostDeadlineReloadAfterReject
          ?.apiPhaseAfterReload?.deadline ?? null,
      passed:
        hardening.staleCohostDeadline?.status === "passed" &&
        hardening.staleCohostDeadline?.reject?.error === "PhaseLocked" &&
        hardening.staleCohostDeadline?.staleCohostDeadlineReloadAfterReject?.status ===
          "passed" &&
        hardening.staleCohostDeadline?.staleCohostDeadlineReloadAfterReject
          ?.routeResponseStatus === 200 &&
        hardening.staleCohostDeadline?.staleCohostDeadlineReloadAfterReject
          ?.rejectReceiptStatusText?.includes("Reject PhaseLocked") === true &&
        hardening.staleCohostDeadline?.staleCohostDeadlineReloadAfterReject
          ?.phaseAfterReload?.id === "D02" &&
        hardening.staleCohostDeadline?.staleCohostDeadlineReloadAfterReject
          ?.phaseAfterReload?.locked === false &&
        hardening.staleCohostDeadline?.staleCohostDeadlineReloadAfterReject
          ?.deadlineActionsAfterReload?.includes("extend_deadline") === true &&
        hardening.staleCohostDeadline?.staleCohostDeadlineReloadAfterReject
          ?.phaseActionsAfterReload?.length === 0 &&
        hardening.staleCohostDeadline?.staleCohostDeadlineReloadAfterReject
          ?.apiPhaseAfterReload?.phase_id === "D02" &&
        hardening.staleCohostDeadline?.staleCohostDeadlineReloadAfterReject
          ?.apiPhaseAfterReload?.locked === false &&
        hardening.staleCohostDeadline?.staleCohostDeadlineReloadAfterReject
          ?.apiPhaseAfterReload?.deadline === null,
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
