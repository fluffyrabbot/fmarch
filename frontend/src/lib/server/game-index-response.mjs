import { canonicalPhaseId } from "../phase-id.mjs";

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const MAX_PACK_KEY_LENGTH = 128;
const PAGE_KEYS = Object.freeze(["games", "next_cursor"]);
const ENTRY_KEYS = Object.freeze([
  "game",
  "pack",
  "status",
  "phase_id",
  "updated_seq",
  "completed_seq",
]);

/**
 * Decode the public Rust `GameIndexPage` DTO and enforce its page invariants.
 *
 * Returning null is deliberate: an invalid upstream document is not an empty
 * game index. The caller must surface a degraded read state instead.
 */
export function decodeGameIndexPage(
  value,
  { cursor = null, limit = 12 } = {},
) {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, PAGE_KEYS) ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Array.isArray(value.games) ||
    value.games.length > limit
  ) {
    return null;
  }

  const requestedCursor = cursor === null ? null : decodeCursor(cursor);
  if (cursor !== null && requestedCursor === null) {
    return null;
  }

  const games = [];
  const seenGames = new Set();
  let previous = requestedCursor;
  for (const candidate of value.games) {
    const entry = decodeGameIndexEntry(candidate);
    if (
      entry === null ||
      seenGames.has(entry.game) ||
      (previous !== null && !positionIsBefore(entry, previous))
    ) {
      return null;
    }
    seenGames.add(entry.game);
    games.push(entry);
    previous = entry;
  }

  let nextCursor = null;
  if (value.next_cursor !== null) {
    nextCursor = decodeCursor(value.next_cursor);
    const finalEntry = games.at(-1);
    if (
      nextCursor === null ||
      games.length !== limit ||
      finalEntry === undefined ||
      nextCursor.updatedSeq !== finalEntry.updated_seq ||
      nextCursor.game !== finalEntry.game
    ) {
      return null;
    }
  }

  return Object.freeze({
    games: Object.freeze(games),
    next_cursor:
      nextCursor === null
        ? null
        : `${nextCursor.updatedSeq}:${nextCursor.game}`,
  });
}

function decodeGameIndexEntry(value) {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, ENTRY_KEYS) ||
    !CANONICAL_UUID.test(value.game) ||
    !validPackKey(value.pack) ||
    !["active", "completed"].includes(value.status) ||
    !validPhaseId(value.phase_id) ||
    !positiveSafeInteger(value.updated_seq) ||
    !validCompletionSequence(value)
  ) {
    return null;
  }
  return Object.freeze({
    game: value.game,
    pack: value.pack,
    status: value.status,
    phase_id: value.phase_id,
    updated_seq: value.updated_seq,
    completed_seq: value.completed_seq,
  });
}

function validCompletionSequence(value) {
  if (value.status === "active") {
    return value.completed_seq === null;
  }
  return (
    positiveSafeInteger(value.completed_seq) &&
    value.completed_seq === value.updated_seq
  );
}

function validPhaseId(value) {
  return value === null || canonicalPhaseId(value) === value;
}

function validPackKey(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_PACK_KEY_LENGTH &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function decodeCursor(value) {
  if (typeof value !== "string") return null;
  const separator = value.indexOf(":");
  if (separator <= 0 || separator !== value.lastIndexOf(":")) return null;
  const rawSequence = value.slice(0, separator);
  const game = value.slice(separator + 1);
  if (!/^[1-9]\d*$/u.test(rawSequence) || !CANONICAL_UUID.test(game)) {
    return null;
  }
  const updatedSeq = Number(rawSequence);
  if (!positiveSafeInteger(updatedSeq) || String(updatedSeq) !== rawSequence) {
    return null;
  }
  return Object.freeze({ updatedSeq, game });
}

function positionIsBefore(entry, cursor) {
  return (
    entry.updated_seq < (cursor.updatedSeq ?? cursor.updated_seq) ||
    (entry.updated_seq === (cursor.updatedSeq ?? cursor.updated_seq) &&
      entry.game < cursor.game)
  );
}

function positiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function hasExactKeys(value, expected) {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => keys.includes(key));
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
