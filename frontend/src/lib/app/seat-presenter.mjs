// The one place a game seat becomes words (RFC 0008, decision 2). Every
// surface that names a seat — thread authors, votecounts, vote and action
// targets, host tasks, setup — goes through these functions, so changing how
// a seat reads is a change to this module alone.

const SLOT_PREFIX = /^slot[-_]?(.+)$/iu;
const TRAILING_DIGITS = /(\d+)$/u;

/** The seat's ordinal as written in its id (`slot-7` → `"7"`), or `null`. */
export function seatNumber(slotId) {
  const value = String(slotId ?? "").trim();
  return TRAILING_DIGITS.exec(value)?.[1] ?? null;
}

/**
 * A seat for display. With a persona name the seat reads as that person;
 * without one it falls back to its ordinal. An id that is neither a slot nor
 * numbered is returned unchanged rather than guessed at.
 */
export function seatLabel(slotId, { name = null } = {}) {
  const base = seatBaseLabel(slotId);
  const persona = typeof name === "string" ? name.trim() : "";
  return persona === "" ? base : `${base} / ${persona}`;
}

/** A vote target (`no_lynch`, `NoLynch`, `{ Slot }` or a slot id) for display. */
export function voteTargetLabel(target) {
  if (target === "NoLynch" || target === "no_lynch" || target?.kind === "no_lynch") {
    return "No lynch";
  }
  const slotId = typeof target === "string" ? target : target?.Slot ?? target?.slotId ?? target?.slot_id;
  return seatLabel(slotId);
}

function seatBaseLabel(slotId) {
  const value = String(slotId ?? "").trim();
  if (value === "") {
    return "Unknown seat";
  }
  const prefixed = SLOT_PREFIX.exec(value);
  if (prefixed !== null) {
    return `Slot ${prefixed[1].replace(/[-_]+/gu, " ")}`;
  }
  const ordinal = seatNumber(value);
  return ordinal === null ? value : `Slot ${ordinal}`;
}
