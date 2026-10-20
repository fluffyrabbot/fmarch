// Proof reads of a player's command outcome. Players see one status line in
// their own terms (RFC 0008, decision 4); the raw transport message and the
// command traces live on the page's proof globals, so proofs read them there.

// The receipt panel showed the three most recent commands; proofs keep that count.
const VISIBLE_RECEIPTS = 3;

/** Wait until the page has recorded a receipt for `actionId`, and return it. */
export async function waitForPlayerCommandReceipt(page, actionId, { timeout = 15000 } = {}) {
  const handle = await page.waitForFunction(
    (expected) =>
      (window.__fmarchPlayerCommandReceipts ?? []).findLast((receipt) => receipt.actionId === expected) ?? null,
    actionId,
    { timeout },
  );
  return handle.jsonValue();
}

/** The projection refresh keys a receipt recorded, comma-joined as the panel showed them. */
export function playerCommandReceiptRefreshKeys(receipt) {
  return receipt?.commandTrace?.projectionRefreshKeys?.join(",") ?? null;
}

/** How many recent receipts the player would have been shown, as text. */
export async function playerCommandReceiptCountText(page) {
  const count = await page.evaluate(() => (window.__fmarchPlayerCommandReceipts ?? []).length);
  return String(Math.min(count, VISIBLE_RECEIPTS));
}

/** The raw message of the current command status. */
export async function playerCommandStatusMessage(page) {
  await page.getByTestId("player-command-status").waitFor({ state: "attached" });
  return page.evaluate(() => window.__fmarchPlayerCommandStatus?.message ?? "");
}
