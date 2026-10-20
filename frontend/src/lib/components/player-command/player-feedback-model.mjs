import { seatNames } from "../../app/seat-presenter.mjs";

// Presentation never repeats server diagnostics. Recovery still owns the exact
// request and its identity; this model only describes what the player attempted.
export function playerFeedback({ status, attempt, roster = [], action = null } = {}) {
  if (!status || (status.state === "ack" && !status.projectionUnavailable)) return null;
  const actionId = status.actionId ?? status.commandTrace?.actionId ?? action;
  const command = attempt?.command ?? status.requestEnvelope?.body?.body?.command;
  const target = command?.SubmitVote?.target;
  const names = seatNames(roster);
  const voteName = target?.Slot ? names.name(target.Slot) ?? names.label(target.Slot) : null;
  const intent = command?.SubmitVote
    ? target === "NoLynch" ? "Your vote for no lynch" : voteName ? `Your vote for ${voteName}` : "Your vote"
    : String(actionId).startsWith("submit_vote") ? "Your vote"
    : String(actionId).startsWith("withdraw_vote") ? "Removing your vote"
    : actionId === "submit_post" ? "Your post"
    : String(actionId).startsWith("withdraw_action") ? "Withdrawing your night action"
    : String(actionId).startsWith("submit_action") ? "Your night action"
    : String(actionId).startsWith("submit_day_event") ? "Your event entry"
    : String(actionId).startsWith("withdraw_day_event") ? "Your request to leave the event"
    : "Your action";
  let message;
  if (status.state === "pending") message = `${intent} is being sent…`;
  else if (status.state === "ack") message = `${intent} went through. Waiting for the game to update.`;
  else if (status.state === "interrupted") message = `${intent} may not have gone through.`;
  else message = rejectionMessage(status.error, intent);
  return Object.freeze({ actionId, state: status.state, message, dismissible: status.state !== "pending" });
}

function rejectionMessage(error, intent) {
  switch (error) {
    case "ActionAlreadySubmitted": return "Your night action was already submitted. Check your current action before changing it.";
    case "PhaseLocked": return `${intent} was not accepted because the phase is closed. Check the current phase before trying again.`;
    case "NotYourSlot": return "You no longer occupy this seat. Your action was not accepted.";
    case "RateLimited": return `${intent} was not accepted. Wait a moment before trying again.`;
    case "GameAlreadyCompleted":
    case "GameCompleted": return "The game is complete. Your action was not accepted.";
    case "SlotNotAlive": return "Your seat is out of the game. Your action was not accepted.";
    case "StreamConflict": return `${intent} was not accepted because the game changed. Check the current game before retrying.`;
    case "DayEventStateConflict": return `${intent} was not accepted because the event changed. Check the current event before retrying.`;
    case "UnknownSlot": return "That seat is not in this game. Choose an available seat.";
    case "InvalidTarget": return `${intent} was not accepted. Choose an available target.`;
    default: return `${intent} could not be completed. Check the game and try again.`;
  }
}
