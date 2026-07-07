export const PLAYER_ACTION_SUBMISSION_CHECKPOINT_CONTRACT = Object.freeze({
  proofCheckId: "player-action-submission",
  rootClassName: "player-action-submission-checkpoint fm-card",
  rootTestId: "player-action-submission-checkpoint",
  phaseTestId: "player-action-submission-phase",
  actorTestId: "player-action-submission-actor",
  actionStateTestId: "player-action-submission-action-state",
  targetTestId: "player-action-submission-target",
  receiptTestId: "player-action-submission-receipt",
  recoveryTestId: "player-action-submission-recovery",
  statusTestId: "player-action-submission-status",
  componentName: "player-action-submission-checkpoint",
});

export function buildPlayerActionSubmissionCheckpoint({
  commandState = {},
  composer = {},
  player = {},
  commandStatus = null,
} = {}) {
  const actionCommands = Array.isArray(composer.actionCommands)
    ? composer.actionCommands
    : [];
  const legalAction =
    actionCommands.find((command) =>
      String(command?.action ?? "").startsWith("submit_action:"),
    ) ?? null;
  const phase = commandState?.phase ?? {};
  const phaseId = String(phase.phaseId ?? "");
  const phaseState = phase.locked === true ? "locked" : "open";
  const actorSlot = String(commandState?.actorSlot ?? player.slotId ?? "");
  const selectedAction = String(legalAction?.templateId ?? "");
  const targetSlots = Array.isArray(legalAction?.targets)
    ? legalAction.targets.map((target) => String(target))
    : [];
  const actionState =
    legalAction === null
      ? `disabled:${actionDisabledReason({ commandState, player })}`
      : `enabled:${String(legalAction.action)}`;
  const receiptState =
    commandStatus === null || commandStatus === undefined
      ? "idle"
      : `${String(commandStatus.state ?? "unknown")}:${String(
          commandStatus.error ?? commandStatus.message ?? "",
        )}`;

  return Object.freeze({
    root: Object.freeze({
      className: PLAYER_ACTION_SUBMISSION_CHECKPOINT_CONTRACT.rootClassName,
      testId: PLAYER_ACTION_SUBMISSION_CHECKPOINT_CONTRACT.rootTestId,
      data: Object.freeze({
        component: PLAYER_ACTION_SUBMISSION_CHECKPOINT_CONTRACT.componentName,
        proofCheckId: PLAYER_ACTION_SUBMISSION_CHECKPOINT_CONTRACT.proofCheckId,
        phaseId,
        phaseState,
        actorSlot,
        actionState,
        selectedAction,
        targetSlots: targetSlots.join(","),
        receiptState,
      }),
    }),
    heading: "Action submission checkpoint",
    proofCheckId: PLAYER_ACTION_SUBMISSION_CHECKPOINT_CONTRACT.proofCheckId,
    phase: Object.freeze({
      testId: PLAYER_ACTION_SUBMISSION_CHECKPOINT_CONTRACT.phaseTestId,
      label: "Current phase",
      value: `${phaseId || "unknown"} / ${phaseState}`,
    }),
    actor: Object.freeze({
      testId: PLAYER_ACTION_SUBMISSION_CHECKPOINT_CONTRACT.actorTestId,
      label: "Actor",
      value: `${actorSlot || "unknown"} / ${String(
        commandState?.actorStatus ?? player.status ?? "unknown",
      )}`,
    }),
    actionState: Object.freeze({
      testId: PLAYER_ACTION_SUBMISSION_CHECKPOINT_CONTRACT.actionStateTestId,
      label: "Action state",
      value: actionState,
    }),
    target: Object.freeze({
      testId: PLAYER_ACTION_SUBMISSION_CHECKPOINT_CONTRACT.targetTestId,
      label: "Selected target",
      value:
        selectedAction === ""
          ? "none"
          : `${selectedAction} -> ${targetSlots.join(",") || "no target"}`,
    }),
    receipt: Object.freeze({
      testId: PLAYER_ACTION_SUBMISSION_CHECKPOINT_CONTRACT.receiptTestId,
      label: "Receipt state",
      value: receiptState,
    }),
    recovery: Object.freeze({
      testId: PLAYER_ACTION_SUBMISSION_CHECKPOINT_CONTRACT.recoveryTestId,
      label: "Stale recovery",
      value: "Reject PhaseLocked: refresh command state and use current action controls.",
    }),
    status: Object.freeze({
      testId: PLAYER_ACTION_SUBMISSION_CHECKPOINT_CONTRACT.statusTestId,
      state: legalAction === null ? "pending" : "ack",
      message:
        legalAction === null
          ? `Player action unavailable: ${actionDisabledReason({ commandState, player })}`
          : "Player action submission is reachable from this role URL",
    }),
  });
}

function actionDisabledReason({ commandState, player }) {
  if (player.gameCompleted === true || commandState?.gameCompleted === true) {
    return "game complete";
  }
  if (player.alive === false || commandState?.actorAlive === false) {
    return "actor is not alive";
  }
  if (commandState?.phase?.locked === true) {
    return "phase locked";
  }
  return "no legal action available";
}
