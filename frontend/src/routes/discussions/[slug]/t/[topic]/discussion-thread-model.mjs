import { buildCommunityAuthorView } from "../../../../../lib/app/community-author-model.mjs";
import { buildMentionSegments } from "../../../../../lib/app/mention-model.mjs";

export const DISCUSSION_QUOTATION_EXCERPT_BYTES = 1000;
export const DISCUSSION_CITATION_PREVIEW_LIMIT = 5;
export const DISCUSSION_MAX_QUOTATIONS = 8;

export function parseQuoteSeqs(searchParams) {
  const values = typeof searchParams?.getAll === "function" ? searchParams.getAll("quote") : [];
  const seqs = [];
  for (const value of values) {
    if (typeof value !== "string" || !/^[1-9][0-9]*$/u.test(value)) {
      continue;
    }
    const seq = Number(value);
    if (!seqs.includes(seq)) {
      seqs.push(seq);
    }
  }
  return Object.freeze(seqs.slice(0, DISCUSSION_MAX_QUOTATIONS));
}

export function excerptFromBody(body) {
  if (typeof body !== "string") {
    return "";
  }
  const encoded = new TextEncoder().encode(body);
  if (encoded.byteLength <= DISCUSSION_QUOTATION_EXCERPT_BYTES) {
    return body;
  }
  let end = DISCUSSION_QUOTATION_EXCERPT_BYTES;
  while (end > 0 && (encoded[end] & 0b1100_0000) === 0b1000_0000) {
    end -= 1;
  }
  return new TextDecoder().decode(encoded.slice(0, end));
}

export function buildAttachedQuotations({ posts = [], quoteSeqs = [], topicId }) {
  const bySeq = postsBySeq(posts);
  const attached = [];
  for (const seq of quoteSeqs) {
    const post = bySeq.get(Number(seq));
    const excerpt = excerptFromBody(post?.body);
    if (post === undefined || excerpt === "") {
      continue;
    }
    const author = buildCommunityAuthorView(post?.author);
    attached.push(
      Object.freeze({
        sourceSeq: Number(seq),
        excerpt,
        author,
        authorLabel: author.label,
        target: Object.freeze({
          kind: "discussion_post",
          scope_id: String(topicId),
          source_seq: Number(seq),
        }),
      }),
    );
  }
  return Object.freeze(attached);
}

export function submittedQuotationsPayload(attached) {
  return Object.freeze(
    (Array.isArray(attached) ? attached : []).map((quotation) =>
      Object.freeze({
        target: Object.freeze({
          kind: "discussion_post",
          scope_id: String(quotation.target?.scope_id ?? quotation.scopeId ?? ""),
          source_seq: Number(quotation.target?.source_seq ?? quotation.sourceSeq),
        }),
        excerpt: String(quotation.excerpt ?? ""),
      }),
    ),
  );
}

export function parseSubmittedQuotations(form, topicId) {
  const raw = typeof form?.get === "function" ? form.get("quotations") : form;
  if (typeof raw !== "string" || raw.trim() === "") {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((item) => {
        const sourceSeq = Number(item?.target?.source_seq ?? item?.target?.sourceSeq);
        const excerpt = typeof item?.excerpt === "string" ? item.excerpt : "";
        if (!Number.isInteger(sourceSeq) || sourceSeq < 1 || excerpt === "") {
          return null;
        }
        return {
          target: {
            kind: "discussion_post",
            scope_id: String(item?.target?.scope_id ?? item?.target?.scopeId ?? topicId),
            source_seq: sourceSeq,
          },
          excerpt,
        };
      })
      .filter(Boolean)
      .slice(0, DISCUSSION_MAX_QUOTATIONS);
  } catch {
    return [];
  }
}

export function discussionComposerHref({
  slug,
  topic,
  beforeSeq = null,
  quoteSeqs = [],
  hash = "discussion-composer",
}) {
  const params = new URLSearchParams();
  if (beforeSeq !== null && beforeSeq !== undefined && String(beforeSeq) !== "") {
    params.set("before_seq", String(beforeSeq));
  }
  for (const seq of quoteSeqs) {
    params.append("quote", String(seq));
  }
  const query = params.toString();
  const path = `/discussions/${encodeURIComponent(slug)}/t/${encodeURIComponent(topic)}`;
  return `${path}${query === "" ? "" : `?${query}`}${hash ? `#${hash}` : ""}`;
}

export function buildDiscussionPostView(post, { posts = [], citations = null } = {}) {
  const bySeq = postsBySeq(posts);
  const outgoing = Array.isArray(post?.quotations) ? post.quotations : [];
  const quotations = Object.freeze(
    outgoing
      .map((quotation) => {
        const sourceSeq = Number(quotation?.target?.source_seq ?? quotation?.target?.sourceSeq);
        if (!Number.isInteger(sourceSeq) || sourceSeq < 1) {
          return null;
        }
        const original = bySeq.get(sourceSeq);
        const excerpt = typeof quotation?.excerpt === "string" ? quotation.excerpt : "";
        return Object.freeze({
          sourceSeq,
          excerpt,
          href: `#post-${sourceSeq}`,
          authorLabel: original === undefined ? null : buildCommunityAuthorView(original.author).label,
          originalUnavailable: original === undefined,
        });
      })
      .filter(Boolean),
  );
  const citationCount = Number(post?.citation_count ?? post?.citationCount ?? 0);
  const incomingSource = Array.isArray(citations?.citations) ? citations.citations : [];
  const incomingCitations = Object.freeze(
    incomingSource
      .map((citation) => {
        const sourceSeq = Number(citation?.quoting?.source_seq ?? citation?.quoting?.sourceSeq);
        if (!Number.isInteger(sourceSeq) || sourceSeq < 1) {
          return null;
        }
        return Object.freeze({
          sourceSeq,
          href: `#post-${sourceSeq}`,
        });
      })
      .filter(Boolean)
      .slice(0, DISCUSSION_CITATION_PREVIEW_LIMIT),
  );
  return Object.freeze({
    sourceSeq: Number(post?.source_seq),
    author: buildCommunityAuthorView(post?.author),
    body: typeof post?.body === "string" ? post.body : "",
    bodySegments: buildMentionSegments(post?.body, post?.mentions),
    createdAt: post?.created_at ?? null,
    quotations,
    citationCount: Number.isFinite(citationCount) ? citationCount : 0,
    incomingCitations,
    moreCitationCount: Math.max(0, citationCount - incomingCitations.length),
    quoteHref: null,
  });
}

export function buildDiscussionThreadView({
  thread,
  quoteSeqs = [],
  citationPages = {},
  canPost = false,
  slug,
  topicId,
  beforeSeq = null,
}) {
  const posts = Array.isArray(thread?.posts) ? thread.posts : [];
  const quoteEnabled = canPost && thread?.topic?.posting_state === "open";
  const topic = topicId ?? thread?.topic?.topic;
  const attachedQuotations = Object.freeze(
    buildAttachedQuotations({
      posts,
      quoteSeqs,
      topicId: topic,
    }).map((quotation) =>
      Object.freeze({
        ...quotation,
        removeHref: discussionComposerHref({
          slug,
          topic,
          beforeSeq,
          quoteSeqs: attachedSeqsWithout(quoteSeqs, quotation.sourceSeq),
        }),
      }),
    ),
  );
  const attachedSeqs = attachedQuotations.map((quotation) => quotation.sourceSeq);
  return Object.freeze({
    posts: Object.freeze(
      posts.map((post) => {
        const view = buildDiscussionPostView(post, {
          posts,
          citations: citationPages[Number(post.source_seq)] ?? null,
        });
        const nextQuotes = attachedSeqs.includes(Number(post.source_seq))
          ? attachedSeqs
          : [...attachedSeqs, Number(post.source_seq)].slice(0, DISCUSSION_MAX_QUOTATIONS);
        return Object.freeze({
          ...view,
          quoteHref: quoteEnabled
            ? discussionComposerHref({
                slug,
                topic: topicId ?? thread?.topic?.topic,
                beforeSeq,
                quoteSeqs: nextQuotes,
              })
            : null,
        });
      }),
    ),
    attachedQuotations,
    quotationsJson: JSON.stringify(submittedQuotationsPayload(attachedQuotations)),
    quoteEnabled,
  });
}

function postsBySeq(posts) {
  return new Map(
    (Array.isArray(posts) ? posts : []).map((post) => [Number(post.source_seq), post]),
  );
}

function attachedSeqsWithout(quoteSeqs, removedSeq) {
  return quoteSeqs.filter((seq) => Number(seq) !== Number(removedSeq));
}
