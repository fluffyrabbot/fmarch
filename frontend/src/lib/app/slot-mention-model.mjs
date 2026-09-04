/**
 * Game mentions as the player thread sees them.
 *
 * Deliberately a sibling of `mention-model.mjs`, not a mode of it. A community
 * mention addresses a profile and a game mention addresses a slot, and RFC 0007
 * makes the cross-universe case unrepresentable rather than validated away. The
 * two files share the byte-span splitter, because a span carries no identity;
 * they share nothing that names a target.
 *
 * The composer's `@` sources the already-loaded channel roster: no round trip,
 * no profile corpus, and no seat the write model would refuse.
 */
import { buildDecidedMentionSegments } from "./mention-model.mjs";

export const MAX_MENTIONS_PER_POST = 8;

/** Slot ids are the seat labels the thread already prints, e.g. `slot_7`. */
const SLOT_CHARACTER = /[a-z0-9_-]/iu;

const encoder = new TextEncoder();

function byteLength(value) {
  return encoder.encode(value).byteLength;
}

export function normalizeSlotId(value) {
  const slotId = typeof value === "string" ? value.trim().replace(/^@/u, "") : "";
  return slotId !== "" && [...slotId].every((character) => SLOT_CHARACTER.test(character))
    ? slotId
    : null;
}

/**
 * Split a game post body into render segments over its decided slot mentions.
 * A slot chip is not a link: a seat has no page of its own, and inventing one
 * would be the first step toward a `slot -> human` directory.
 */
export function buildSlotMentionSegments(body, mentions) {
  return buildDecidedMentionSegments(body, mentions, (mention) => ({
    slotId: normalizeSlotId(mention?.slot_id ?? mention?.slotId),
  }));
}

/**
 * Re-derive spans for the seats the author selected. Each seat claims its first
 * standalone `@slot` occurrence; a seat the author deleted from the body simply
 * stops being a mention, which is the honest outcome because the decision is
 * the fact, not the prose.
 */
export function deriveSlotMentionSpans(body, slotIds) {
  const text = typeof body === "string" ? body : "";
  const unique = [];
  for (const raw of Array.isArray(slotIds) ? slotIds : []) {
    const slotId = normalizeSlotId(raw);
    if (slotId !== null && !unique.includes(slotId)) unique.push(slotId);
  }
  const found = [];
  for (const slotId of unique) {
    const index = standaloneSlotMentionIndex(text, slotId);
    if (index === -1) continue;
    found.push({
      slot_id: slotId,
      offset: byteLength(text.slice(0, index)),
      len: byteLength(`@${slotId}`),
    });
  }
  return Object.freeze(
    found
      .sort((left, right) => left.offset - right.offset)
      .slice(0, MAX_MENTIONS_PER_POST)
      .map(Object.freeze),
  );
}

/**
 * The active `@` fragment under the caret, or `null` when the caret is not
 * inside one. Only a fragment the author is still typing opens the typeahead.
 */
export function slotMentionQueryAtCaret(body, caret) {
  const text = typeof body === "string" ? body : "";
  const position = Number.isInteger(caret)
    ? Math.max(0, Math.min(caret, text.length))
    : text.length;
  let start = position;
  while (start > 0 && SLOT_CHARACTER.test(text[start - 1])) start -= 1;
  if (start === 0 || text[start - 1] !== "@") return null;
  if (start > 1 && SLOT_CHARACTER.test(text[start - 2])) return null;
  const fragment = text.slice(start, position).toLowerCase();
  return fragment.length === 0 ? null : { start: start - 1, end: position, fragment };
}

/**
 * Bounded suggestions from the channel's own roster. The author's seat is
 * offered like any other: self-mention is accepted and simply delivers nothing,
 * so hiding it would be a lie about what the write model does.
 */
export function slotMentionSuggestions(roster, query, limit = 6) {
  if (query === null || query === undefined) return Object.freeze([]);
  const fragment = String(query.fragment ?? "").toLowerCase();
  const seats = (Array.isArray(roster) ? roster : [])
    .map(normalizeSlotId)
    .filter((slotId) => slotId !== null);
  const unique = [...new Set(seats)];
  return Object.freeze(
    unique
      .filter((slotId) => slotId.toLowerCase().startsWith(fragment))
      .sort()
      .slice(0, Math.max(0, limit)),
  );
}

/** Replace the `@` fragment under the caret with the chosen seat. */
export function applySlotMentionSelection(body, query, slotId) {
  const text = typeof body === "string" ? body : "";
  const normalized = normalizeSlotId(slotId);
  if (query === null || normalized === null) return { body: text, caret: text.length };
  const inserted = `@${normalized} `;
  return {
    body: `${text.slice(0, query.start)}${inserted}${text.slice(query.end)}`,
    caret: query.start + inserted.length,
  };
}

/**
 * The `mentions` payload for a `SubmitPost` command. Spans are re-derived from
 * the body at submit time, because the body may have moved since selection and
 * the server's span validation is the authority: a stale span must reject
 * rather than mis-anchor.
 */
export function submittedSlotMentionsPayload(body, attachedSlotIds, roster) {
  const addressable = new Set(
    (Array.isArray(roster) ? roster : []).map(normalizeSlotId).filter(Boolean),
  );
  const claimed = (Array.isArray(attachedSlotIds) ? attachedSlotIds : [])
    .map(normalizeSlotId)
    .filter((slotId) => slotId !== null && addressable.has(slotId));
  return deriveSlotMentionSpans(body, claimed).map((mention) =>
    Object.freeze({ slot_id: mention.slot_id, offset: mention.offset, len: mention.len }),
  );
}

function standaloneSlotMentionIndex(text, slotId) {
  const needle = `@${slotId}`;
  let from = 0;
  for (;;) {
    const index = text.indexOf(needle, from);
    if (index === -1) return -1;
    const before = index === 0 ? "" : text[index - 1];
    const after = text[index + needle.length] ?? "";
    if (!SLOT_CHARACTER.test(before) && before !== "@" && !SLOT_CHARACTER.test(after)) {
      return index;
    }
    from = index + 1;
  }
}
