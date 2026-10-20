import { canonicalPhaseId, phaseLabelFromId } from "../../phase-id.mjs";
import { seatNames } from "../../app/seat-presenter.mjs";

export const PLAYER_ACTION_SUBMISSION_CHECKPOINT_CONTRACT = Object.freeze({
  proofCheckId: "player-action-submission",
  rootClassName: "player-action-submission-checkpoint fm-proof-disclosure",
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
  const phaseId = canonicalPhaseId(phase.phaseId);
  const phaseState = phaseId === null
    ? "pre-phase"
    : phase.locked === true
      ? "locked"
      : "open";
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
        phaseId: phaseId ?? "",
        phaseState,
        actorSlot,
        actionState,
        selectedAction,
        targetSlots: targetSlots.join(","),
        receiptState,
      }),
    }),
    heading: "Your night action",
    proofCheckId: PLAYER_ACTION_SUBMISSION_CHECKPOINT_CONTRACT.proofCheckId,
    phase: Object.freeze({
      testId: PLAYER_ACTION_SUBMISSION_CHECKPOINT_CONTRACT.phaseTestId,
      label: "Current phase",
      value: `${phaseLabelFromId(phaseId) ?? "No phase open"} / ${phaseState}`,
    }),
    actor: Object.freeze({
      testId: PLAYER_ACTION_SUBMISSION_CHECKPOINT_CONTRACT.actorTestId,
      label: "Actor",
      value: `${actorSlot ? seatNames(commandState?.roster).label(actorSlot) : "unknown"} / ${String(
        commandState?.actorStatus ?? player.status ?? "unknown",
      )}`,
    }),
    actionState: Object.freeze({
      testId: PLAYER_ACTION_SUBMISSION_CHECKPOINT_CONTRACT.actionStateTestId,
      label: "Action state",
      value: legalAction === null ? "Not available" : "Available",
    }),
    target: Object.freeze({
      testId: PLAYER_ACTION_SUBMISSION_CHECKPOINT_CONTRACT.targetTestId,
      label: "Selected target",
      value:
        selectedAction === ""
          ? "none"
          : targetSlots.map((slot) => seatNames(commandState?.roster).label(slot)).join(", ") || "No target needed",
    }),
    receipt: Object.freeze({
      testId: PLAYER_ACTION_SUBMISSION_CHECKPOINT_CONTRACT.receiptTestId,
      label: "Submission",
      value: commandStatus?.state === "ack" ? "Sent" : commandStatus?.state === "pending" ? "Sending…" : commandStatus?.state === "interrupted" ? "Not yet confirmed" : commandStatus?.state === "reject" ? "Not accepted" : "Not submitted",
    }),
    recovery: Object.freeze({
      testId: PLAYER_ACTION_SUBMISSION_CHECKPOINT_CONTRACT.recoveryTestId,
      label: "When the phase changes",
      value: "Check the current phase before choosing an action.",
    }),
    status: Object.freeze({
      testId: PLAYER_ACTION_SUBMISSION_CHECKPOINT_CONTRACT.statusTestId,
      state: legalAction === null ? "pending" : "ack",
      message:
        legalAction === null
          ? `Your night action is unavailable: ${actionDisabledReason({ commandState, player })}.`
          : "You can choose your night action.",
    }),
  });
}

function actionDisabledReason({ commandState, player }) {
  if (player.gameCompleted === true || commandState?.gameCompleted === true) {
    return "game complete";
  }
  if (player.alive === false || commandState?.actorAlive === false) {
    return "you are no longer alive";
  }
  if (commandState?.phase?.locked === true) {
    return "phase locked";
  }
  return "no action is available now";
}
