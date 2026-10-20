// The roster vote picker (RFC 0008, decision 3). The dock shows the current
// vote as its own state and opens this sheet; the sheet lists every seat the
// server allows as a target with its tally, in seat order, then No lynch.
// Selecting a row turns it into a confirmation and only that second tap
// dispatches, so a vote never commits on the first tap. Unvote confirms the
// same way.

import { seatNames, seatNumber } from "../../app/seat-presenter.mjs";

export const PLAYER_VOTE_PICKER_CONTRACT = Object.freeze({
  rootTestId: "player-vote-picker",
  dockTestId: "player-dock-vote",
  optionTestIdPrefix: "player-vote-option-",
  confirmationTestId: "player-vote-confirmation",
  confirmTestId: "player-vote-confirm",
  cancelTestId: "player-vote-cancel",
  unvoteTestId: "player-vote-unvote",
  withdrawAction: "withdraw_vote",
});

const NO_LYNCH = "no_lynch";

/**
 * @param {object} options
 * @param {Array<{action: string, voteTarget: unknown}>} options.voteCommands
 *   legal vote commands, as built from the server's `vote_targets`
 * @param {{kind: string, slotId: string|null}|null} options.currentVote
 * @param {Array<{target: string, count: number, needed: number}>} options.votecount
 * @param {Array} options.roster wire `GameRosterSeat[]`
 * @param {string|null} options.selectedAction the row awaiting confirmation
 * @param {boolean} options.disabled no vote command may be dispatched now
 * @param {boolean} options.canWithdraw
 * @param {string} options.withdrawReason
 */
export function buildPlayerVotePicker({
  voteCommands = [],
  currentVote = null,
  votecount = [],
  roster = [],
  selectedAction = null,
  disabled = false,
  canWithdraw = false,
  withdrawReason = "",
} = {}) {
  const names = seatNames(roster);
  const currentKey = voteKey(currentVote);
  const tallies = new Map(
    votecount.map((row) => [voteKey(row?.target), row]).filter(([key]) => key !== null),
  );
  const needed = votecount.find((row) => Number.isFinite(row?.needed))?.needed ?? null;
  const currentShort = currentKey === null ? null : shortName(currentKey, names);

  const legal = new Map();
  for (const command of voteCommands) {
    const key = voteKey(command.voteTarget);
    if (key !== null && !legal.has(key)) legal.set(key, String(command.action));
  }
  // Every legal target, plus any seat already holding votes that the viewer
  // may not choose (their own seat), so the picker is also the full count.
  const keys = [...new Set([...legal.keys(), ...tallies.keys()])].sort(compareKeys);

  const selectable = !disabled;
  const rows = keys.map((key) => {
    const action = legal.get(key) ?? null;
    const isCurrent = key === currentKey;
    const isSelected = selectable && action !== null && !isCurrent && action === selectedAction;
    const label = key === NO_LYNCH ? "No lynch" : names.label(key);
    const target = shortName(key, names);
    return Object.freeze({
      key,
      action,
      label,
      tally: tallyText(tallies.get(key), needed),
      current: isCurrent,
      selectable: selectable && action !== null && !isCurrent,
      selected: isSelected,
      testId: `${PLAYER_VOTE_PICKER_CONTRACT.optionTestIdPrefix}${key}`,
      note: isCurrent ? "Your vote" : action === null ? "Not a vote target" : "",
      confirmation: isSelected
        ? Object.freeze({
            message:
              currentShort === null ? `Vote ${target}` : `Change vote: ${currentShort} → ${target}`,
            confirmLabel: currentShort === null ? "Vote" : "Change vote",
          })
        : null,
    });
  });

  const unvoteSelected =
    selectable && canWithdraw && currentShort !== null &&
    selectedAction === PLAYER_VOTE_PICKER_CONTRACT.withdrawAction;
  return Object.freeze({
    testId: PLAYER_VOTE_PICKER_CONTRACT.rootTestId,
    hasVote: currentKey !== null,
    dock: Object.freeze({
      testId: PLAYER_VOTE_PICKER_CONTRACT.dockTestId,
      label: currentShort === null ? "Vote" : `Voting ${currentShort}`,
    }),
    summary: needed === null ? "Votes" : `Votes · ${needed} to decide`,
    rows: Object.freeze(rows),
    // Always present so the sheet says why there is nothing to withdraw.
    unvote: Object.freeze({
      action: PLAYER_VOTE_PICKER_CONTRACT.withdrawAction,
      label: "Unvote",
      disabled: !selectable || !canWithdraw,
      reason: canWithdraw ? "" : String(withdrawReason ?? ""),
      selected: unvoteSelected,
      confirmation: unvoteSelected
        ? Object.freeze({ message: `Remove your vote for ${currentShort}`, confirmLabel: "Unvote" })
        : null,
    }),
  });
}

/** The vote command that targets `slotId`, for opening the picker preselected. */
export function voteActionForSlot(voteCommands = [], slotId) {
  const key = voteKey(slotId);
  return voteCommands.find((command) => voteKey(command.voteTarget) === key)?.action ?? null;
}

function voteKey(target) {
  if (target === null || target === undefined) return null;
  if (target?.kind === NO_LYNCH) return NO_LYNCH;
  const slotId =
    typeof target === "string" ? target : target?.Slot ?? target?.slotId ?? target?.slot_id;
  if (typeof slotId !== "string" || slotId.trim() === "") return null;
  // The wire spells No lynch several ways (`NoLynch`, `no_lynch`, "No lynch").
  return slotId.toLowerCase().replace(/[^a-z]/gu, "") === "nolynch" ? NO_LYNCH : slotId;
}

function shortName(key, names) {
  if (key === NO_LYNCH) return "No lynch";
  return names.name(key) ?? names.label(key);
}

function compareKeys(left, right) {
  if (left === NO_LYNCH || right === NO_LYNCH) return left === NO_LYNCH ? 1 : -1;
  const a = Number(seatNumber(left) ?? Number.POSITIVE_INFINITY);
  const b = Number(seatNumber(right) ?? Number.POSITIVE_INFINITY);
  return a === b ? left.localeCompare(right) : a - b;
}

function tallyText(row, needed) {
  const count = Number(row?.count ?? 0);
  const of = row?.needed ?? needed;
  return of === null || of === undefined ? String(count) : `${count}/${of}`;
}
