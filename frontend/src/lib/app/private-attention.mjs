import { canonicalPhaseId } from "../phase-id.mjs";
// Delivery identity follows immutable projection keys, never the row's position.
export function privateItemId(kind, row) {
  if (typeof row.audience_slot !== "string" || row.audience_slot.length === 0) {
    throw new TypeError("Private delivery requires a seat identity");
  }
  if (kind === "slot-mention") {
    if (!Number.isSafeInteger(row.source_seq) || row.source_seq <= 0) throw new TypeError("Invalid mention identity");
    return `slot-mention-${row.source_seq}-${row.audience_slot}`;
  }
  if (!["notification", "investigation"].includes(kind) || canonicalPhaseId(row.phase_id) === null
      || !Number.isSafeInteger(row.event_index) || row.event_index < 0) throw new TypeError("Invalid private result identity");
  return `${kind}-${row.phase_id}-${row.event_index}-${row.audience_slot}`;
}

export function validPrivateAttention(value) {
  return Array.isArray(value?.reviewed_ids) && value.reviewed_ids.every(id => typeof id === "string");
}

export function privateAttentionEndpoint(game) {
  return `/api/gameplay/games/${encodeURIComponent(game)}/private-attention`;
}

export async function fetchPrivateAttention({ game, fetchImpl = fetch, itemId = null }) {
  try {
    const response = await fetchImpl(privateAttentionEndpoint(game), {
      signal: AbortSignal.timeout(10_000),
      ...(itemId === null ? {} : {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ item_id: itemId }),
      }),
    });
    if (!response.ok) throw new Error("unavailable");
    const result = await response.json();
    if (!validPrivateAttention(result)) throw new Error("invalid receipt state");
    return { state: "ready", reviewedIds: result.reviewed_ids };
  } catch {
    throw new Error("Review status is unavailable. Try again.");
  }
}
