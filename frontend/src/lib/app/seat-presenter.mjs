// The one place a game seat becomes words (RFC 0008, decisions 1 and 2). Every
// surface that names a seat — thread authors, quotations, mentions, votecounts,
// vote and action targets, notices, host tasks, setup — goes through these
// functions, so changing how a seat reads is a change to this module alone.
//
// A seat reads as its persona's name with a short seat tag ("Mira · S7"); the
// tag is not "#7" because "#" already marks post numbers. Names
// come only from the server roster (wire `GameRosterSeat`): the occupancy whose
// tenure covers a global event sequence, and that persona's latest name
// effective at or before it. Without a sequence the current occupant is meant.

const SLOT_PREFIX = /^slot[-_]?(.+)$/iu;
const TRAILING_DIGITS = /(\d+)$/u;

/** The seat's ordinal as written in its id (`slot-7` → `"7"`), or `null`. */
export function seatNumber(slotId) {
  const value = String(slotId ?? "").trim();
  return TRAILING_DIGITS.exec(value)?.[1] ?? null;
}

/** The seat tag shown beside a name (`slot-7` → `"S7"`), or `null`. */
export function seatTag(slotId) {
  const ordinal = seatNumber(slotId);
  return ordinal === null ? null : `S${ordinal}`;
}

/**
 * A seat for display. With a persona name the seat reads as that person plus
 * its tag; without one it falls back to its ordinal. An id that is neither a
 * slot nor numbered is returned unchanged rather than guessed at.
 */
export function seatLabel(slotId, { name = null } = {}) {
  const persona = typeof name === "string" ? name.trim() : "";
  if (persona === "") {
    return seatBaseLabel(slotId);
  }
  const tag = seatTag(slotId);
  return tag === null ? persona : `${persona} · ${tag}`;
}

/**
 * A presenter over one roster. Memoized per roster array, so callers may ask
 * for it wherever they hold the roster without rebuilding indexes.
 */
export function seatNames(roster) {
  const key = Array.isArray(roster) ? roster : EMPTY_ROSTER;
  let names = PRESENTERS.get(key);
  if (names === undefined) {
    names = buildSeatNames(key);
    PRESENTERS.set(key, names);
  }
  return names;
}

/** A vote target (`no_lynch`, `NoLynch`, `{ Slot }`, `{ slotId }` or an id). */
export function voteTargetLabel(target, names = seatNames(EMPTY_ROSTER)) {
  if (target === "NoLynch" || target === "no_lynch" || target?.kind === "no_lynch") {
    return "No lynch";
  }
  const slotId =
    typeof target === "string" ? target : target?.Slot ?? target?.slotId ?? target?.slot_id;
  return names.label(slotId);
}

const EMPTY_ROSTER = Object.freeze([]);
const PRESENTERS = new WeakMap();

function buildSeatNames(roster) {
  const seats = new Map();
  for (const seat of roster) {
    if (typeof seat?.slot_id === "string" && Array.isArray(seat.occupancies)) {
      seats.set(seat.slot_id, seat);
    }
  }

  function name(slotId, { at = null } = {}) {
    const seat = seats.get(String(slotId ?? ""));
    if (seat === undefined || seat.occupancies.length === 0) {
      return null;
    }
    const occupancy = at === null || at === undefined
      ? seat.occupancies.findLast((epoch) => epoch.ended_seq === null) ?? null
      : seat.occupancies.find(
          (epoch) => epoch.began_seq <= at && (epoch.ended_seq === null || at < epoch.ended_seq),
        ) ?? null;
    if (occupancy === null || occupancy.names.length === 0) {
      return null;
    }
    if (at === null || at === undefined) {
      return occupancy.names.at(-1).public_name;
    }
    return (
      occupancy.names.findLast((entry) => entry.effective_seq <= at) ?? occupancy.names[0]
    ).public_name;
  }

  return Object.freeze({
    /** The persona name for a seat, at a sequence or now; `null` if unseated. */
    name,
    /** The display label for a seat, at a sequence or now. */
    label: (slotId, options = {}) => seatLabel(slotId, { name: name(slotId, options) }),
    /** Whether the seat is still in the game, or `null` for an unknown seat. */
    alive: (slotId) => seats.get(String(slotId ?? ""))?.alive ?? null,
  });
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
