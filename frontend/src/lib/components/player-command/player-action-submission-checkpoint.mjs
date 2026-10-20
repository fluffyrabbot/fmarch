import { canonicalPhaseId, phaseLabelFromId } from "../../phase-id.mjs";
import { seatNames } from "../../app/seat-presenter.mjs";

export const PLAYER_ACTION_SUBMISSION_CHECKPOINT_CONTRACT = Object.freeze({
  proofCheckId: "player-action-submission",
  rootClassName: "player-action-submission-checkpoint fm-proof-disclosure",
  rootTestId: "player-action-submission-checkpoint",
  phaseTestId: "player-action-submission-phase",
  targetTestId: "player-action-submission-target",
  receiptTestId: "player-action-submission-receipt",
  recoveryTestId: "player-action-submission-recovery",
  statusTestId: "player-action-submission-status",
  componentName: "player-action-submission-checkpoint",
  recoveryCopy: "If the phase changes first, choose again from the new options.",
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
  const names = seatNames(commandState?.roster);
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
      label: "Phase",
      value: phaseLabelFromId(phaseId) ?? "Not started",
    }),
    target: Object.freeze({
      testId: PLAYER_ACTION_SUBMISSION_CHECKPOINT_CONTRACT.targetTestId,
      label: "Who you can choose",
      value:
        legalAction === null
          ? "No one right now"
          : targetSlots.map((slot) => names.label(slot)).join(", ") || "No target needed",
    }),
    receipt: Object.freeze({
      testId: PLAYER_ACTION_SUBMISSION_CHECKPOINT_CONTRACT.receiptTestId,
      label: "Your choice",
      value: SUBMISSION_COPY[commandStatus?.state] ?? "Not sent yet",
    }),
    recovery: Object.freeze({
      testId: PLAYER_ACTION_SUBMISSION_CHECKPOINT_CONTRACT.recoveryTestId,
      label: "If the phase changes",
      value: PLAYER_ACTION_SUBMISSION_CHECKPOINT_CONTRACT.recoveryCopy,
    }),
    status: Object.freeze({
      testId: PLAYER_ACTION_SUBMISSION_CHECKPOINT_CONTRACT.statusTestId,
      state: legalAction === null ? "pending" : "ack",
      message:
        legalAction === null
          ? `Your night action isn't available: ${DISABLED_REASON_COPY[actionDisabledReason({ commandState, player })]}.`
          : "You can choose your night action.",
    }),
  });
}

const SUBMISSION_COPY = Object.freeze({
  ack: "Sent",
  pending: "Sending…",
  interrupted: "Not confirmed yet",
  reject: "Not accepted",
});

// Why the action is unavailable, as a stable code for `data-action-state`
// and as the sentence the player reads.
const DISABLED_REASON_COPY = Object.freeze({
  "game-complete": "the game is over",
  "actor-dead": "you are no longer alive",
  "phase-locked": "the phase is closed",
  "no-legal-action": "there is nothing to do right now",
});

function actionDisabledReason({ commandState, player }) {
  if (player.gameCompleted === true || commandState?.gameCompleted === true) {
    return "game-complete";
  }
  if (player.alive === false || commandState?.actorAlive === false) {
    return "actor-dead";
  }
  if (commandState?.phase?.locked === true) {
    return "phase-locked";
  }
  return "no-legal-action";
}
