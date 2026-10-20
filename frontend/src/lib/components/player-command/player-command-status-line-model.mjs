// The one line a player sees about their last command (RFC 0008, decision 4).
// It speaks about what the player meant ("Your vote for Ilya") rather than the
// transport, lives in the game bar, and offers Retry only when retrying is safe
// — Retry resends the original attempt, so it cannot duplicate work. Raw
// transport messages and command traces stay on the page's proof globals and
// in host and admin technical drawers.

import {
  isCommandInterruptionStatus,
  isRetryableCommandRejection,
} from "../../app/command-interruption.mjs";
import { seatNames, voteTargetLabel } from "../../app/seat-presenter.mjs";

export const PLAYER_COMMAND_STATUS_LINE_CONTRACT = Object.freeze({
  testId: "player-command-status",
});

// Why the server turned a command away, in the player's terms.
const REJECTION_REASONS = Object.freeze({
  PhaseLocked: "the phase has closed",
  GameAlreadyCompleted: "the game is over",
  InvalidTarget: "that choice is no longer open",
  NotYourSlot: "you no longer hold this seat",
  SlotNotAlive: "your seat is out of the game",
  ActionAlreadySubmitted: "you have already acted this phase",
  StreamConflict: "the game changed while it was on its way",
  RateLimited: "you are posting faster than the game allows",
  DayEventStateConflict: "the event changed while it was on its way",
  UnknownSlot: "that seat is not in this game",
});

/**
 * @param {object} options
 * @param {object|null} options.status the page's current command status
 * @param {Array} options.voteCommands legal vote commands, to name a vote's target
 * @param {Array} options.roster wire `GameRosterSeat[]`
 * @param {boolean} options.retryAvailable the exact rejected attempt is retained
 * @param {boolean} options.retryEnabled a retry may be sent right now
 * @param {string|null} options.actionId the command the status belongs to, when
 *   the status itself does not carry it
 * @returns {object|null} `null` when there is nothing to say
 */
export function buildPlayerCommandStatusLine({
  status = null,
  actionId: knownActionId = null,
  voteCommands = [],
  roster = [],
  retryAvailable = false,
  retryEnabled = true,
} = {}) {
  if (status === null || status === undefined) return null;
  const actionId = String(status.actionId ?? status.commandTrace?.actionId ?? knownActionId ?? "");
  const intent = intentFor(actionId, { voteCommands, roster });
  const interrupted = isCommandInterruptionStatus(status);
  const confirmedRejection = retryAvailable && isRetryableCommandRejection(status);
  const state = String(status.state ?? "info");

  let text;
  if (interrupted) {
    text = `${capitalize(intent)} may not have gone through.`;
  } else if (state === "pending") {
    text = `Sending ${intent}…`;
  } else if (state === "ack") {
    text = `${capitalize(intent)} went through.`;
  } else if (state === "reject" || state === "error") {
    const reason = REJECTION_REASONS[String(status.error ?? "")];
    text = reason === undefined
      ? `${capitalize(intent)} didn't go through.`
      : `${capitalize(intent)} didn't go through: ${reason}.`;
  } else {
    text = String(status.message ?? "");
  }

  const recoverable = interrupted || confirmedRejection;
  return Object.freeze({
    testId: PLAYER_COMMAND_STATUS_LINE_CONTRACT.testId,
    actionId,
    state,
    text,
    ariaLive: state === "reject" || state === "error" || state === "interrupted"
      ? "assertive"
      : "polite",
    busy: state === "pending",
    recovery: recoverable
      ? Object.freeze({
          testId: `command-recovery-${actionId}`,
          commandId: String(status.commandId ?? ""),
          interruption: status.interruption ?? null,
          outcome: confirmedRejection ? "confirmed-rejection" : "unknown",
          retry: Object.freeze({
            testId: `command-recovery-retry-${actionId}`,
            label: "Retry",
            enabled: retryEnabled,
          }),
          dismiss: Object.freeze({ testId: `command-recovery-cancel-${actionId}`, label: "Dismiss" }),
        })
      : null,
    // A settled line can be put away; an unresolved one is put away through
    // recovery's Dismiss, which also forgets the retained attempt.
    dismiss: recoverable || state === "pending"
      ? null
      : Object.freeze({ testId: "player-command-status-dismiss", label: "Dismiss" }),
  });
}

function intentFor(actionId, { voteCommands, roster }) {
  const [kind] = actionId.split(":");
  switch (kind) {
    case "submit_vote": {
      const command = voteCommands.find((candidate) => String(candidate.action) === actionId);
      const target = command?.voteTarget ?? actionId.slice("submit_vote:".length);
      if (target === "" || target === undefined) return "your vote";
      const names = seatNames(roster);
      const label = voteTargetLabel(target, names);
      const slotId = target?.Slot ?? (typeof target === "string" ? target : null);
      const name = label === "No lynch" ? "No lynch" : names.name(slotId) ?? label;
      return `your vote for ${name}`;
    }
    case "withdraw_vote":
      return "your unvote";
    case "submit_post":
      return "your post";
    case "submit_action":
      return "your night action";
    case "withdraw_action":
      return "withdrawing your night action";
    case "submit_day_event":
      return "your event entry";
    case "withdraw_day_event":
      return "leaving the event";
    default:
      return "your last action";
  }
}

function capitalize(text) {
  return text.length === 0 ? text : `${text[0].toUpperCase()}${text.slice(1)}`;
}
