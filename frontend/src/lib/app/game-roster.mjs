// The public game roster (RFC 0008, wire `GameRosterSeat`): every seat with its
// liveness and named occupancy history. The server owns it; the client only
// checks its shape here and resolves names from it in `seat-presenter.mjs`.

const SEAT_KEYS = Object.freeze(["slot_id", "alive", "status", "occupancies"]);
const OCCUPANCY_KEYS = Object.freeze(["began_seq", "ended_seq", "names"]);
const NAME_KEYS = Object.freeze(["effective_seq", "public_name"]);

/** True when `value` is exactly the wire roster: an array of canonical seats. */
export function isGameRoster(value) {
  return Array.isArray(value) && value.every(isGameRosterSeat);
}

function isGameRosterSeat(seat) {
  return (
    hasExactKeys(seat, SEAT_KEYS) &&
    nonEmptyString(seat.slot_id) &&
    typeof seat.alive === "boolean" &&
    nonEmptyString(seat.status) &&
    Array.isArray(seat.occupancies) &&
    seat.occupancies.every(isGameRosterOccupancy)
  );
}

function isGameRosterOccupancy(occupancy) {
  return (
    hasExactKeys(occupancy, OCCUPANCY_KEYS) &&
    isSequence(occupancy.began_seq) &&
    (occupancy.ended_seq === null || isSequence(occupancy.ended_seq)) &&
    Array.isArray(occupancy.names) &&
    occupancy.names.every(
      (name) =>
        hasExactKeys(name, NAME_KEYS) &&
        isSequence(name.effective_seq) &&
        nonEmptyString(name.public_name),
    )
  );
}

function hasExactKeys(value, keys) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isSequence(value) {
  return Number.isSafeInteger(value) && value >= 0;
}
