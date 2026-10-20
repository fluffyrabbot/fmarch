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
 * no profile corpus, and no seat the write model would refuse. A seat is
 * written as its occupant's current persona name (`@Ilya`), which is what the
 * server checks the span against (RFC 0008 slice 3b); the decided mention
 * still records the slot.
 */
import { buildDecidedMentionSegments } from "./mention-model.mjs";
import { seatTag } from "./seat-presenter.mjs";

export const MAX_MENTIONS_PER_POST = 8;

/** Slot ids as the wire carries them, e.g. `slot_7`. */
const SLOT_CHARACTER = /[a-z0-9_-]/iu;
/** What an `@` fragment may contain while the author types a persona name. */
const NAME_CHARACTER = /[\p{L}\p{N}_'.-]/u;
/** A mention ends where the name does, not inside a longer word. */
const WORD_CHARACTER = /[\p{L}\p{N}_]/u;

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
 * A mentionable seat: its slot, the occupant's current persona name (what the
 * author types and the server checks), and the label suggestions show.
 */
export function mentionSeat(slotId, name, label = name) {
  const normalized = normalizeSlotId(slotId);
  const persona = typeof name === "string" ? name.trim() : "";
  return normalized === null || persona === ""
    ? null
    : Object.freeze({ slotId: normalized, name: persona, label: String(label ?? persona) });
}

/**
 * Re-derive spans for the seats the author selected. Each seat claims its first
 * standalone `@Name` occurrence; a seat the author deleted from the body simply
 * stops being a mention, which is the honest outcome because the decision is
 * the fact, not the prose.
 */
export function deriveSlotMentionSpans(body, seats) {
  const text = typeof body === "string" ? body : "";
  const unique = [];
  for (const seat of Array.isArray(seats) ? seats : []) {
    if (seat?.slotId && seat?.name && !unique.some((entry) => entry.slotId === seat.slotId)) {
      unique.push(seat);
    }
  }
  const found = [];
  for (const seat of unique) {
    const index = standaloneMentionIndex(text, seat.name);
    if (index === -1) continue;
    found.push({
      slot_id: seat.slotId,
      offset: byteLength(text.slice(0, index)),
      len: byteLength(`@${seat.name}`),
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
  while (start > 0 && NAME_CHARACTER.test(text[start - 1])) start -= 1;
  if (start === 0 || text[start - 1] !== "@") return null;
  if (start > 1 && NAME_CHARACTER.test(text[start - 2])) return null;
  const fragment = text.slice(start, position).toLowerCase();
  return fragment.length === 0 ? null : { start: start - 1, end: position, fragment };
}

/**
 * Bounded suggestions from the channel's own roster, matched on the persona
 * name or the seat tag (`@s2`). The author's seat is offered like any other:
 * self-mention is accepted and simply delivers nothing, so hiding it would be
 * a lie about what the write model does.
 */
export function slotMentionSuggestions(roster, query, limit = 6) {
  if (query === null || query === undefined) return Object.freeze([]);
  const fragment = String(query.fragment ?? "").toLowerCase();
  const seen = new Set();
  const matches = [];
  for (const seat of Array.isArray(roster) ? roster : []) {
    if (!seat?.slotId || !seat?.name || seen.has(seat.slotId)) continue;
    seen.add(seat.slotId);
    const words = seat.name.toLowerCase().split(/\s+/u);
    const tag = seatTag(seat.slotId)?.toLowerCase() ?? "";
    if (
      seat.name.toLowerCase().startsWith(fragment) ||
      words.some((word) => word.startsWith(fragment)) ||
      (tag !== "" && tag.startsWith(fragment))
    ) {
      matches.push(seat);
    }
  }
  return Object.freeze(
    matches
      .sort((left, right) => left.name.localeCompare(right.name))
      .slice(0, Math.max(0, limit)),
  );
}

/** Replace the `@` fragment under the caret with the chosen seat's name. */
export function applySlotMentionSelection(body, query, seat) {
  const text = typeof body === "string" ? body : "";
  if (query === null || !seat?.name) return { body: text, caret: text.length };
  const inserted = `@${seat.name} `;
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
  const attached = new Set(
    (Array.isArray(attachedSlotIds) ? attachedSlotIds : [])
      .map(normalizeSlotId)
      .filter(Boolean),
  );
  const claimed = (Array.isArray(roster) ? roster : []).filter(
    (seat) => seat?.slotId && attached.has(seat.slotId),
  );
  return deriveSlotMentionSpans(body, claimed).map((mention) =>
    Object.freeze({ slot_id: mention.slot_id, offset: mention.offset, len: mention.len }),
  );
}

function standaloneMentionIndex(text, name) {
  const needle = `@${name}`;
  let from = 0;
  for (;;) {
    const index = text.indexOf(needle, from);
    if (index === -1) return -1;
    const before = index === 0 ? "" : text[index - 1];
    const after = text[index + needle.length] ?? "";
    if (!NAME_CHARACTER.test(before) && before !== "@" && !WORD_CHARACTER.test(after)) {
      return index;
    }
    from = index + 1;
  }
}
