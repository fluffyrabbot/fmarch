// Drives the player vote picker (RFC 0008, decision 3) the way a player does:
// open the picker, arm a row, then confirm. A vote is dispatched only by the
// confirmation, which carries the same `data-action` the dock buttons used to.

const PICKER = '[data-testid="player-vote-picker"]';

/** The picker row for a vote action (`submit_vote`, `submit_vote:slot-3`, …). */
export function playerVoteOption(page, action, { hasText } = {}) {
  const option = page.locator(`${PICKER} [data-vote-action="${action}"]`);
  return hasText === undefined ? option : option.filter({ hasText });
}

/** The picker row for a seat or No lynch, whatever its action string. */
export function playerVoteOptionForTarget(page, target) {
  const key = target === "no_lynch" || target?.kind === "no_lynch"
    ? "no_lynch"
    : String(target?.slotId ?? target?.slot_id ?? target);
  return page.locator(`${PICKER} [data-vote-key="${key}"]`);
}

/** Open the picker's row list without leaving the reading position. */
export async function openPlayerVotePicker(page) {
  await page.locator(PICKER).waitFor({ state: "attached" });
  const open = await page.locator(PICKER).evaluate((details) => details.open);
  if (!open) await page.getByTestId("player-vote-picker-toggle").click();
}

/** Arm `option` and return its confirmation button, not yet clicked. */
export async function armPlayerVote(page, option) {
  await openPlayerVotePicker(page);
  await option.first().click();
  const confirm = page.getByTestId("player-vote-confirm");
  await confirm.waitFor({ state: "visible" });
  return confirm;
}

/** Vote through the picker: arm the row for `action`, then confirm it. */
export async function castPlayerVote(page, action, options = {}) {
  const confirm = await armPlayerVote(page, playerVoteOption(page, action, options));
  await confirm.click();
}

/** Vote for a seat (`{ slotId }`, a slot id) or `"no_lynch"` through the picker. */
export async function castPlayerVoteFor(page, target) {
  const confirm = await armPlayerVote(page, playerVoteOptionForTarget(page, target));
  await confirm.click();
}

/** Unvote through the picker: arm Unvote, then confirm it. */
export async function withdrawPlayerVote(page) {
  const confirm = await armPlayerVote(page, page.getByTestId("player-vote-unvote"));
  await confirm.click();
}
