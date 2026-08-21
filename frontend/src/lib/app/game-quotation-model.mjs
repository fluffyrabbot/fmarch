import {
  gameThreadAuthorLabel,
  normalizeGameThreadAuthor,
} from "./game-thread-author.mjs";

export const GAME_QUOTATION_EXCERPT_BYTES = 1000;
export const GAME_CITATION_PREVIEW_LIMIT = 5;
export const GAME_MAX_QUOTATIONS = 8;

export function excerptFromBody(body) {
  if (typeof body !== "string") {
    return "";
  }
  const encoded = new TextEncoder().encode(body);
  if (encoded.byteLength <= GAME_QUOTATION_EXCERPT_BYTES) {
    return body;
  }
  let end = GAME_QUOTATION_EXCERPT_BYTES;
  while (end > 0 && (encoded[end] & 0b1100_0000) === 0b1000_0000) {
    end -= 1;
  }
  return new TextDecoder().decode(encoded.slice(0, end));
}

export function gameQuotationTarget(gameId, sourceSeq) {
  return Object.freeze({
    kind: "game_post",
    scope_id: String(gameId),
    source_seq: Number(sourceSeq),
  });
}

export function postSourceSeq(post) {
  return Number(post?.seq ?? post?.source_seq ?? post?.sourceSeq ?? post?.target?.source_seq);
}

export function postAuthorLabel(post) {
  const author = gameThreadAuthorLabel(normalizeGameThreadAuthor(post?.author));
  return author === "Unknown" ? null : author;
}

export function attachQuoteSeqs(quoteSeqs, sourceSeq) {
  const seq = Number(sourceSeq);
  if (!Number.isInteger(seq) || seq < 1) {
    return Object.freeze([...(Array.isArray(quoteSeqs) ? quoteSeqs : [])]);
  }
  const next = [];
  for (const value of Array.isArray(quoteSeqs) ? quoteSeqs : []) {
    if (Number(value) === seq || next.length >= GAME_MAX_QUOTATIONS) {
      continue;
    }
    next.push(Number(value));
  }
  if (next.length < GAME_MAX_QUOTATIONS) {
    next.push(seq);
  }
  return Object.freeze(next);
}

export function removeQuoteSeq(quoteSeqs, sourceSeq) {
  const seq = Number(sourceSeq);
  return Object.freeze(
    (Array.isArray(quoteSeqs) ? quoteSeqs : []).filter((value) => Number(value) !== seq),
  );
}

export function buildAttachedQuotations({ posts = [], quoteSeqs = [], gameId } = {}) {
  const bySeq = postsBySeq(posts);
  const attached = [];
  const seen = new Set();
  for (const seq of quoteSeqs) {
    const sourceSeq = Number(seq);
    if (seen.has(sourceSeq) || attached.length >= GAME_MAX_QUOTATIONS) {
      continue;
    }
    const post = bySeq.get(sourceSeq);
    const excerpt = excerptFromBody(post?.body);
    if (post === undefined || excerpt === "") {
      continue;
    }
    seen.add(sourceSeq);
    attached.push(attachedQuotationFromPost(post, gameId, excerpt));
  }
  return Object.freeze(attached);
}

export function attachQuotation(attached, post, gameId) {
  const sourceSeq = postSourceSeq(post);
  const excerpt = excerptFromBody(post?.body);
  if (!Number.isInteger(sourceSeq) || sourceSeq < 1 || excerpt === "") {
    return Object.freeze([...(Array.isArray(attached) ? attached : [])]);
  }
  const current = Array.isArray(attached) ? attached : [];
  if (current.some((quotation) => Number(quotation.sourceSeq) === sourceSeq)) {
    return Object.freeze(current);
  }
  return Object.freeze(
    [...current, attachedQuotationFromPost(post, gameId, excerpt)].slice(0, GAME_MAX_QUOTATIONS),
  );
}

export function removeAttachedQuotation(attached, sourceSeq) {
  const seq = Number(sourceSeq);
  return Object.freeze(
    (Array.isArray(attached) ? attached : []).filter(
      (quotation) => Number(quotation.sourceSeq) !== seq,
    ),
  );
}

export function submittedQuotationsPayload(attached) {
  return Object.freeze(
    (Array.isArray(attached) ? attached : []).map((quotation) =>
      Object.freeze({
        target: Object.freeze({
          kind: "game_post",
          scope_id: String(quotation.target?.scope_id ?? quotation.scopeId ?? ""),
          source_seq: Number(quotation.target?.source_seq ?? quotation.sourceSeq),
        }),
        excerpt: String(quotation.excerpt ?? ""),
      }),
    ),
  );
}

export function buildOutgoingQuotationViews(post, posts = []) {
  const bySeq = postsBySeq(posts);
  const outgoing = Array.isArray(post?.quotations) ? post.quotations : [];
  return Object.freeze(
    outgoing
      .map((quotation) => {
        const sourceSeq = Number(
          quotation?.target?.source_seq ?? quotation?.target?.sourceSeq ?? quotation?.sourceSeq,
        );
        const excerpt = typeof quotation?.excerpt === "string" ? quotation.excerpt : "";
        if (!Number.isInteger(sourceSeq) || sourceSeq < 1 || excerpt === "") {
          return null;
        }
        const original = bySeq.get(sourceSeq);
        return Object.freeze({
          sourceSeq,
          excerpt,
          href: `#thread-post-${sourceSeq}`,
          authorLabel: postAuthorLabel(original),
          originalUnavailable: original === undefined,
        });
      })
      .filter(Boolean),
  );
}

export function buildIncomingCitationViews({
  citationCount = 0,
  citations = null,
  posts = [],
  sourceSeq,
} = {}) {
  const incomingSource = Array.isArray(citations?.citations)
    ? citations.citations
    : derivedIncomingCitations(posts, sourceSeq);
  const incomingCitations = Object.freeze(
    incomingSource
      .map((citation) => {
        const quotingSeq = Number(
          citation?.quoting?.source_seq ??
            citation?.quoting?.sourceSeq ??
            citation?.sourceSeq ??
            citation?.seq,
        );
        if (!Number.isInteger(quotingSeq) || quotingSeq < 1) {
          return null;
        }
        return Object.freeze({
          sourceSeq: quotingSeq,
          href: `#thread-post-${quotingSeq}`,
        });
      })
      .filter(Boolean)
      .slice(0, GAME_CITATION_PREVIEW_LIMIT),
  );
  const count = Number(citationCount);
  const normalizedCount = Number.isFinite(count) && count > 0 ? count : incomingCitations.length;
  return Object.freeze({
    citationCount: normalizedCount,
    incomingCitations,
    moreCitationCount: Math.max(0, normalizedCount - incomingCitations.length),
  });
}

export function buildGamePostQuoteView(post, { posts = [], citations = null } = {}) {
  const sourceSeq = postSourceSeq(post);
  const incoming = buildIncomingCitationViews({
    citationCount: post?.citation_count ?? post?.citationCount ?? 0,
    citations,
    posts,
    sourceSeq,
  });
  return Object.freeze({
    quotations: buildOutgoingQuotationViews(post, posts),
    citationCount: incoming.citationCount,
    incomingCitations: incoming.incomingCitations,
    moreCitationCount: incoming.moreCitationCount,
  });
}

function attachedQuotationFromPost(post, gameId, excerpt) {
  const sourceSeq = postSourceSeq(post);
  return Object.freeze({
    sourceSeq,
    excerpt,
    authorLabel: postAuthorLabel(post) ?? "Unknown",
    target: gameQuotationTarget(gameId, sourceSeq),
  });
}

function derivedIncomingCitations(posts, sourceSeq) {
  const quoted = Number(sourceSeq);
  if (!Number.isInteger(quoted) || quoted < 1) {
    return [];
  }
  return (Array.isArray(posts) ? posts : [])
    .filter((post) =>
      (Array.isArray(post?.quotations) ? post.quotations : []).some((quotation) => {
        const targetSeq = Number(
          quotation?.target?.source_seq ?? quotation?.target?.sourceSeq ?? quotation?.sourceSeq,
        );
        return targetSeq === quoted;
      }),
    )
    .map((post) => ({ sourceSeq: postSourceSeq(post) }));
}

function postsBySeq(posts) {
  return new Map(
    (Array.isArray(posts) ? posts : [])
      .map((post) => [postSourceSeq(post), post])
      .filter(([seq]) => Number.isInteger(seq) && seq > 0),
  );
}
