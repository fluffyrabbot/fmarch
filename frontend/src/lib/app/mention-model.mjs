/**
 * Community mentions as the surface sees them.
 *
 * A mention is a decided span over an immutable body, never markup and never
 * re-parsed prose. The renderer walks the decided list; the composer records a
 * span when the author picks a suggestion and re-derives byte offsets before
 * submit, because the server's span validation is the authority and a stale
 * span must reject rather than mis-anchor.
 */
import { buildCommunityAuthorView } from "./community-author-model.mjs";

export const MAX_MENTIONS_PER_POST = 8;

/** Handles are 3-32 lowercase letters, digits, or underscores. */
const HANDLE_CHARACTER = /[a-z0-9_]/u;
const HANDLE = /^[a-z0-9_]{3,32}$/u;

const encoder = new TextEncoder();

function byteLength(value) {
  return encoder.encode(value).byteLength;
}

/**
 * Split a body into render segments over a decided mention list, whichever
 * universe decided it. Spans arrive as byte offsets into UTF-8; a span that
 * does not land on the body it annotates is dropped rather than shifted, so a
 * corrupt list degrades to plain prose.
 *
 * `resolveTarget` turns one decided mention into the chrome its surface shows.
 * That is the only thing the two universes disagree about: a community mention
 * resolves to a profile link, a game mention to a slot chip, and neither
 * renderer ever scans the body for `@`.
 */
export function buildDecidedMentionSegments(body, mentions, resolveTarget) {
  const text = typeof body === "string" ? body : "";
  const bytes = encoder.encode(text);
  const decoder = new TextDecoder();
  const spans = (Array.isArray(mentions) ? mentions : [])
    .map((mention) => ({
      offset: Number(mention?.offset),
      len: Number(mention?.len),
      target: resolveTarget(mention),
    }))
    .filter(
      (span) =>
        Number.isInteger(span.offset)
        && Number.isInteger(span.len)
        && span.offset >= 0
        && span.len > 0
        && span.offset + span.len <= bytes.byteLength,
    )
    .sort((left, right) => left.offset - right.offset);

  const segments = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.offset < cursor) continue;
    if (span.offset > cursor) {
      segments.push(plainSegment(decoder.decode(bytes.slice(cursor, span.offset))));
    }
    const label = decoder.decode(bytes.slice(span.offset, span.offset + span.len));
    segments.push(Object.freeze({ kind: "mention", text: label, ...span.target }));
    cursor = span.offset + span.len;
  }
  if (cursor < bytes.byteLength) {
    segments.push(plainSegment(decoder.decode(bytes.slice(cursor))));
  }
  return Object.freeze(segments.filter((segment) => segment.text !== ""));
}

/** Community mentions render as a profile anchor over their recorded span. */
export function buildMentionSegments(body, mentions) {
  return buildDecidedMentionSegments(body, mentions, (mention) => {
    const author = buildCommunityAuthorView(mention?.profile);
    return {
      // An unresolvable target keeps its span and loses its link: the edge
      // stays, the anchor goes.
      href: author.href,
      displayName: author.displayName,
    };
  });
}

/**
 * Re-derive spans for the handles the author selected. Each handle claims its
 * first standalone `@handle` occurrence; a handle the author deleted from the
 * body simply stops being a mention, which is the honest outcome because the
 * decision is the fact, not the prose.
 */
export function deriveMentionSpans(body, handles) {
  const text = typeof body === "string" ? body : "";
  const unique = [];
  for (const raw of Array.isArray(handles) ? handles : []) {
    const handle = normalizeHandle(raw);
    if (handle !== null && !unique.includes(handle)) unique.push(handle);
  }
  const found = [];
  for (const handle of unique) {
    const index = standaloneMentionIndex(text, handle);
    if (index === -1) continue;
    found.push({
      handle,
      offset: byteLength(text.slice(0, index)),
      len: byteLength(`@${handle}`),
    });
  }
  return Object.freeze(
    found
      .sort((left, right) => left.offset - right.offset)
      .slice(0, MAX_MENTIONS_PER_POST)
      .map(Object.freeze),
  );
}

export function normalizeHandle(value) {
  const handle = typeof value === "string" ? value.trim().toLowerCase().replace(/^@/u, "") : "";
  return HANDLE.test(handle) ? handle : null;
}

/**
 * Parse the composer's hidden mention field on the server side. The handles are
 * re-validated here because a hidden input is client-supplied text; the API
 * still resolves and re-decides every span.
 */
export function parseSubmittedMentions(form) {
  const raw = typeof form?.get === "function" ? form.get("mentions") : form;
  if (typeof raw !== "string" || raw.trim() === "") return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((item) => {
      const handle = normalizeHandle(item?.handle);
      const offset = Number(item?.offset);
      const len = Number(item?.len);
      if (handle === null || !Number.isInteger(offset) || !Number.isInteger(len)) return null;
      if (offset < 0 || len <= 0) return null;
      return { handle, offset, len };
    })
    .filter(Boolean)
    .slice(0, MAX_MENTIONS_PER_POST);
}

/**
 * The active `@` fragment under the caret, or `null` when the caret is not
 * inside one. Only a fragment the author is still typing opens the typeahead.
 */
export function mentionQueryAtCaret(body, caret) {
  const text = typeof body === "string" ? body : "";
  const position = Number.isInteger(caret) ? Math.max(0, Math.min(caret, text.length)) : text.length;
  let start = position;
  while (start > 0 && HANDLE_CHARACTER.test(text[start - 1].toLowerCase())) start -= 1;
  if (start === 0 || text[start - 1] !== "@") return null;
  if (start > 1 && HANDLE_CHARACTER.test(text[start - 2].toLowerCase())) return null;
  const fragment = text.slice(start, position).toLowerCase();
  return fragment.length === 0 ? null : { start: start - 1, end: position, fragment };
}

/** Replace the `@` fragment under the caret with the chosen handle. */
export function applyMentionSelection(body, query, handle) {
  const text = typeof body === "string" ? body : "";
  const normalized = normalizeHandle(handle);
  if (query === null || normalized === null) return { body: text, caret: text.length };
  const inserted = `@${normalized} `;
  return {
    body: `${text.slice(0, query.start)}${inserted}${text.slice(query.end)}`,
    caret: query.start + inserted.length,
  };
}

function standaloneMentionIndex(text, handle) {
  const needle = `@${handle}`;
  let from = 0;
  for (;;) {
    const index = text.toLowerCase().indexOf(needle, from);
    if (index === -1) return -1;
    const before = index === 0 ? "" : text[index - 1].toLowerCase();
    const after = text[index + needle.length]?.toLowerCase() ?? "";
    if (!HANDLE_CHARACTER.test(before) && before !== "@" && !HANDLE_CHARACTER.test(after)) {
      return index;
    }
    from = index + 1;
  }
}

function plainSegment(text) {
  return Object.freeze({ kind: "text", text, href: null, displayName: null });
}
