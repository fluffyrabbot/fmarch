# RFC 0002 — First-class quotations and citation provenance

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Created** | 2026-08-13 |
| **Accepted** | 2026-08-13 |
| **Decision owner** | Project owner |
| **Target** | Forum reading and reply, community and game threads |
| **Related** | [01-domain-model](../arch/01-domain-model.md), [02-event-sourcing](../arch/02-event-sourcing.md), [04-wire-protocol](../arch/04-wire-protocol.md), [10-event-schema](../arch/10-event-schema.md), [13-interaction-architecture](../arch/13-interaction-architecture.md) |

## Summary

Treat a quotation as a directed relation between posts, not as text that happens
to look like a quote. The thread remains a linear log. The quoting post records
which earlier post it cited and an excerpt snapshot of what was cited. “This
post was quoted elsewhere” is the reverse of that relation: a rebuildable
projection folded from quoting events, never a mutation of the quoted post.

Post identity is the same public triple already used by moderation:
`(kind, scope_id, source_seq)`. Community and game write models stay separate
and share that identity. The first slice is same-thread quotation. Cross-room
and community ↔ game citation is the same type, deferred until same-thread
quoting is proven.

## Why now

Both forum surfaces already have durable post identity, permalinks, and
topic- or channel-level reply. Neither records that a reply cited another post:

- `DiscussionPostSubmitted` and `PostSubmitted` carry a `body` string;
- `discussion_post` and `thread_view` project that string;
- player, public, and community UIs render `{post.body}` as one escaped
  paragraph;
- the only structured use of `source_seq` on another post is a permalink or a
  moderation report target.

Mafia and community reading both depend on “I am answering *this* claim.”
Pasting quoted prose into `body` cannot:

- know which post was cited;
- keep a live link if the original is later hidden or (eventually) edited;
- render a quote as a quote;
- answer “who quoted this, when, from where”;
- reconstruct a quote chain without guessing at text.

The event log already makes the honest model cheap: record the edge on the
quoting event; fold the reverse index the way `community_inbox_item` folds
watch fan-out.

## Goals

1. Make quotation a typed fact on the quoting post, decided at write time.
2. Keep the thread a linear log. Quotes are citations over the log, not a
   nested comment tree.
3. Reuse the existing public post identity. Do not invent a `post_id`.
4. Record an excerpt snapshot at quote time so later hide/edit cannot rewrite
   what the quoter actually cited.
5. Answer “quoted elsewhere” from a rebuildable reverse index, including
   later pages of the same thread.
6. Reconstruct quote-chain provenance by walking outgoing edges. Do not
   persist a flattened ancestor list on the event.
7. Validate that the quoter can currently read the quoted post.
8. Render quotes as structured objects on community, player, and public
   game surfaces, with a composer control that selects a post rather than
   asking the author to paste markup.
9. Share one `PostRef` / citation projection across community and game
   the way moderation already shares `ModerationTarget`.

## Non-goals for the first version

- Cross-topic, cross-game, or community ↔ game quotes.
- Quoting a private-channel post into another channel, including quoting
  scumchat / role-PM / dead / spectator / DayEvent rooms onto `main`.
- Nested comment layout or Reddit-style reply trees.
- Parsing `[quote]`, `>`, BBCode, or markdown out of `body`.
- Writing an event onto the quoted post’s stream when it is cited.
- Storing `quoted_by` on the quoted post row as if that post changed.
- Live citation deltas beyond the game-thread
  `PostCitationsChanged` badge update. Community topics stay cold-load;
  incoming citation lists still refresh from loaded posts or the sibling
  query.
- Implementing `PostEdited` / `PostRetracted`. The schema mentions them;
  quotation must be compatible with them, but this RFC does not land them.
- Quote notifications, inbox items, or search ranking by citation count.
- Quoting media independently of the post that carries it.

## The product boundary

### Thread shape does not change

```text
Post ──in──▶ Channel or Topic
identity = (kind, scope_id, source_seq)
```

Readers still move through an ordered log. Reply remains a new post at the
end of that log. Quote does not become “reply-to as parent,” and the
composer does not become a thread-fork.

### Post shape does change

A post is no longer only authored body. It may also cite earlier posts:

```text
Post ──quotes──▶ PostRef { kind, scope_id, source_seq }
                 └── excerpt snapshot at quote time
```

This is the same kind of directed fact as a vote. Votes are not parsed from
post text; quotations are not parsed from post text.

### “Quoted by” is operational

The quoted post did not change. Incoming citations are a projection over
quoting events, in the same family as `community_inbox_item`:

```text
quoting event  ──fold──▶  post_citation
                              quoted  (kind, scope_id, source_seq)
                              quoting (kind, scope_id, source_seq)
                              occurred_at
```

Rebuild from the log. Never append to the quoted post’s stream. Never update
the quoted post’s body or authorship because someone else spoke.

### Identity already exists

Moderation already names a public post:

```rust
struct PostRef {
    kind: PostKind,   // discussion_post | game_post
    scope_id: Uuid,   // topic_id or game_id
    source_seq: i64,
}
```

`PostRef` is the same triple as `ModerationTarget`. Community and game posts
keep their own write models; they share this name.

First slice further constrains a quote:

- community: `kind = discussion_post` and `scope_id =` the topic being posted to;
- game: `kind = game_post` and `scope_id =` the game being posted to, and the
  quoted post’s `channel_id` equals the quoting post’s `channel_id`.

That is “same thread,” not “any post the author can see.”

## UX shapes considered

### Shape A — Markup in the body

Authors paste or the UI inserts `[quote=12]…[/quote]` or `> …` into `body`.
The renderer parses it back.

Advantages:

- no command or event change;
- familiar to BBCode forums.

Problems:

- citation is not a fact, so reverse index and chain walks are guesswork;
- hide, edit, and retract cannot be applied to a real target;
- markup becomes a second language inside an otherwise unparsed body;
- player and community renderers would reimplement quote policy in TS.

**Decision:** reject. Votes already taught this lesson.

### Shape B — Nested reply tree

Each post has a `parent_source_seq`. The thread renders as a tree.

Advantages:

- one pointer;
- easy “reply to this” UX.

Problems:

- changes the thread from a log into a comment forest;
- a post that cites two earlier claims has no honest parent;
- mafia reading is chronological; tree layout fights votecount-as-of-post-N;
- “quoted elsewhere” from a later page or another room still needs a
  separate index.

**Decision:** reject. Parent-child is the wrong relation.

### Shape C — Citation edges over the log

The thread stays ordered. A post carries zero or more outgoing quotations.
Each quotation names a `PostRef` plus an excerpt. A citation projection
answers incoming “quoted by.”

Advantages:

- matches how people actually quote in a forum log;
- one post can cite several earlier posts;
- reverse index is a projection, not a second write;
- chain provenance is a walk;
- additive on existing submit events.

Cost:

- composer and renderer must grow structured quote chrome;
- write path must validate readability and same-thread membership;
- “quoted elsewhere” is incomplete unless the projection exists.

**Decision:** adopt Shape C.

## Write model

### Command

Additive optional field, default empty, on both submit paths:

```rust
// community
TopicCommand::SubmitPost {
    body: String,
    author_profile_id: Uuid,
    quotations: Vec<Quotation>,
}

// game
Command::SubmitPost {
    game: Uuid,
    channel_id: String,
    actor_slot: String,
    body: String,
    media: Vec<ThreadPostMedia>,
    quotations: Vec<Quotation>,
}
```

```rust
struct Quotation {
    target: PostRef,
    excerpt: String,
}
```

`CreateDiscussionPostRequest` and the wire `SubmitPost` variant grow the same
list. Absent or `[]` means “this post cites nothing.” That is valid forever
and is how every existing event upcasts.

Host-authored notices (`PublishSpectatorPost`, votecount posts) do not take
quotations in the first slice.

### Event

Additive optional field on the existing kinds. No new event type.

```text
DiscussionPostSubmitted  { body, author_profile_id, quotations? }
PostSubmitted            { channel_id, slot_or_user, body, media?, phase_id, quotations? }
```

Schema-evolution rule: missing `quotations` deserializes to `[]`. Do not bump
the event version solely to add this field. Do not put incoming `quoted_by`
on the event.

The quoting post’s `source_seq` is the event sequence that carries the
quotations. That is the quoting side of `post_citation`.

### Decision-time rejects

The community and game write models reject, they do not coerce:

| Condition | Reject |
|---|---|
| Target kind/scope is not this thread | invalid quotation target |
| Quoted `source_seq` does not exist in this thread | quotation not found |
| Quoted `source_seq` ≥ the post being written | quotation not found |
| Quoter cannot read the quoted post (hidden, muted author, private channel, wrong capability) | not authorized / quotation not found — same class as a missing post, do not leak existence of hidden or private posts |
| `excerpt` empty or over the excerpt budget | invalid quotation |
| More quotations than the per-post cap | invalid quotation |
| Quote-chain depth from any target exceeds the depth cap | invalid quotation |
| Duplicate `PostRef` in one post | invalid quotation |

Suggested first-slice budgets, to be replaced by measured constants in the
implementation commit:

- excerpt: same validator family as post body, smaller cap (1_000 bytes
  community, rendered-narrative-safe cap in game);
- quotations per post: 8;
- chain depth: 8, counting the newly attached edge.

Depth is computed from already-committed outgoing edges plus this command.
It is a write-time safety cap, not a stored ancestor array.

A post may have a body, quotations, and (game) media together. A game
media-only post may still carry quotations if the channel policy allows
empty body. A quotation-only post with empty body and no media is valid on
community; game follows the existing media-only policy.

### Excerpt is what was cited

The excerpt is recorded at quote time from the quoter-supplied selection.
The server must verify that the excerpt is a contiguous substring of the
quoted post’s current visible body, after the same visibility rules used to
authorize the read. Do not trust a client excerpt that is not in the
original.

If the original is later hidden, the citation row remains; renderers show
the stored excerpt and a “original unavailable” state instead of the live
body. If `PostEdited` later lands, old quotations keep their snapshot;
they do not silently adopt `new_body_ref`. That is the point of the
snapshot.

## Reverse index

Add one rebuildable projection, folded in the same transaction as the
quoting post:

```text
post_citation
  quoted_kind
  quoted_scope_id
  quoted_source_seq
  quoting_kind
  quoting_scope_id
  quoting_source_seq
  occurred_at

  PK (quoting_kind, quoting_scope_id, quoting_source_seq,
      quoted_kind, quoted_scope_id, quoted_source_seq)
  INDEX (quoted_kind, quoted_scope_id, quoted_source_seq, quoting_source_seq)
```

Fold only from `DiscussionPostSubmitted` / `PostSubmitted` that carry
quotations. Rebuild deletes and replays. Hidden or muted quoting posts are
filtered at read time with the same overlays already used for thread pages
(`moderation_target_state`, `community_member_mute`, channel membership).
The index itself stores the edge, not the visibility decision.

Reads:

- outgoing quotations travel with the quoting post (they are part of its
  event payload and may be denormalized onto `discussion_post` /
  `thread_view` as jsonb for the thread page);
- incoming citations are queried from `post_citation` when rendering a post
  or a “quoted by” disclosure.

Do not store a citation count on `discussion_post` / `thread_view` as a
mutable counter. Count at read time or maintain a rebuildable aggregate
only if a later slice measures a hot path. First slice counts from the
index.

## Read and wire

Thread post DTOs gain outgoing quotations. Incoming citations are a bounded
sidecar, not an unbounded child list inline on every post.

```rust
struct ThreadPostQuotation {
    target: PostRef,
    excerpt: String,
}

struct ThreadPostCitation {
    quoting: PostRef,
    occurred_at: i64,
}

struct ThreadPost {
    // existing fields…
    quotations: Vec<ThreadPostQuotation>,
    citation_count: i64,
    // first slice: omit the citation list from the page payload;
    // expose it on an explicit expand or a small sibling query
}
```

Community `DiscussionPost` grows the same two fields. `citation_count` is
the number of *visible to this reader* incoming edges, not the raw index
count.

Game live delivery now emits `PostCitationsChanged { quoted, citation_count }`
for same-channel quoted posts that are not in the latest thread page. Clients
apply that count to any already-loaded post. Incoming citation lists still
come from loaded quoting posts or the sibling query. Community stays
cold-load.

## Surfaces

### Composer

Quote is a post action that seeds the existing composer, not a second
composer.

- Community: each post grows a Quote control that focuses the topic reply
  and attaches that `source_seq`.
- Player: each visible thread post grows a Quote control that focuses
  `#player-composer` and attaches that `source_seq`. The dock Reply control
  stays “reply with no citation.”
- Public publication: no composer; quotes render read-only.

The composer shows attached quotations as removable chips above the
textarea, each displaying author label, `#source_seq`, and excerpt. The
submitted command includes `quotations`. The textarea is the author’s new
prose only. The UI must not also paste the excerpt into `body`.

No-JavaScript community quote can be a GET that opens the topic with
`?quote={source_seq}` and a server-rendered hidden field. Player quote may
start as a progressive enhancement on the existing command path; a
no-JS player quote is not required in the first slice because player
submit is already a JS command envelope.

### Renderer

A quotation renders as a structured block before the author’s prose:

- excerpt in a `<blockquote>`;
- cite link to `#post-{source_seq}` or `#thread-post-{source_seq}`;
- author label of the quoted post if still visible, otherwise
  “Original unavailable.”

Do not pre-wrap the whole post body and hope markup appears. Incoming
“Quoted N times” is a disclosure under the post, listing visible quoting
permalinks newest-first, bounded (first slice: 5 plus “and N more”).

Phone and 720px reflow: quote blocks stay in document order inside the
post; they do not become a side rail. Touch targets for Quote remain 44px.

## Visibility and capability

Quoting is a read of the target plus a write of a new post. Authorize both.

- Game: same channel membership and postability rules as `SubmitPost`.
  Quoting does not grant the right to pull a private-channel body onto
  `main`.
- Community: the quoted post must be visible to this reader under the
  current mute and moderation overlays.
- Hidden originals remain cited by stored excerpt; the live body is not
  re-fetched for unauthorized readers.
- Mute hides both the quoting post and, for the muting reader, incoming
  citations authored by the muted profile.

Credential principals never appear on quotation or citation DTOs.
Community authorship stays profile-backed; game authorship stays
slot-or-host.

## Chain provenance

A chain is the path of outgoing `PostRef` edges starting at a post.
Renderers may show a short “quoted from #N, which quoted #M” crumb for
depth 2–3. They reconstruct it from loaded posts plus, if needed, a
bounded server walk. They do not require a `chain` field on the event.

Do not snapshot the ancestor list. That list would be denormalized history
and would disagree with later hide/moderation overlays.

## Architecture

### 1. Shared name, separate decide paths

Put `PostRef` / `Quotation` next to the existing moderation target type,
or extract a tiny shared public-post identity if that avoids
community → commands coupling. Do not merge `decide_topic` and
`submit_post`. Each write model validates same-thread membership in its
own language.

### 2. Additive events, new projection

No new stream. No event on the quoted post. One new rebuildable table.
Outgoing quotations may be stored as jsonb on `discussion_post` and
`thread_view` so the thread page does not join to emit quote blocks.
That jsonb is a denormalized copy of the event field and must rebuild
identically.

### 3. Search and inbox stay unaware in the first slice

`public_search_document` and `community_inbox_item` continue to fan out
from the quoting post as they do today. Citation is not a search document
kind and not an inbox reason yet.

### 4. History explorer stays independent

RFC 0001 does not make posts into history moments. Quotations do not
become moments. A later “open thread near this moment” link may land on a
quoted post the same way it lands on any public post.

## Delivery slices

### Slice 1 — Write-model and projection

- Add `PostRef` / `Quotation` and additive `quotations` on both submit
  commands and both post events.
- Validate same-thread existence, readability, excerpt substring, caps,
  and depth.
- Fold `post_citation` and optional jsonb on the post row.
- Prove rebuild identity, reject matrix, and “quoted post stream is
  unchanged.”

### Slice 2 — Read contract

- Extend `DiscussionPost` and `ThreadPost` with outgoing quotations and
  visible `citation_count`.
- Add a bounded incoming-citation query for the disclosure.
- Generate wire types. Keep live delta kinds unchanged.

### Slice 3 — Community surface

- Quote control, `?quote=` no-JS path, composer chips, blockquote
  renderer, “Quoted N times” disclosure.
- Role proof: quote, multi-quote, hidden original, mute, lock/hide
  rejects.

### Slice 4 — Game surfaces

- Player thread Quote → composer chips → `SubmitPost`.
- Public publication read-only quote blocks and citation disclosure.
- Host console may render the same blocks; it does not gain a quote
  composer in this slice.
- Channel-capability proof: cannot quote a private-channel seq from
  `main`.

Each slice is an atomic commit with its mechanically selected proof lanes
green. Because this crosses community, commands, projections, wire, and
frontend reading, the last slice finishes with sprint proof before landing
to `main`.

## Proof plan

### Write model

- Missing `quotations` on old events upcasts to `[]`.
- Same-thread happy path stores excerpt and edge; quoted stream gains no
  event.
- Cross-thread, future seq, self-seq, hidden, muted, private-channel, empty
  excerpt, non-substring excerpt, duplicate target, over-cap, and over-depth
  all reject.
- Rebuild of `post_citation` and post-row jsonb is byte-identical.

### Read model

- `citation_count` matches visible incoming edges for the reader, not raw
  index rows.
- A hidden quoting post does not appear in another reader’s disclosure.
- A hidden quoted post still renders the stored excerpt to readers who
  cannot see the original.

### Surfaces

- Community no-JS `?quote=` submits the structured field, not pasted body
  text.
- Player submit envelope includes `quotations` and does not duplicate the
  excerpt in `body`.
- Public game renders quote blocks without a Quote control.
- Phone, tablet, and 720px reflow keep quote chrome inside the post.

### Security

- Private-channel bodies and hidden discussion bodies do not appear in
  another channel’s or unauthorized reader’s quotation payload.
- Citation DTOs contain no credential principal.

## Alternatives explicitly rejected

- **Parse quotes from `body`:** citation is then unprovable and the
  reverse index is fiction.
- **Parent pointer / reply tree:** the wrong relation; one post can cite
  many, and the thread is a log.
- **Event on the quoted post:** lies about that post’s history and cannot
  express cross-stream citation later without writing into a foreign
  stream.
- **`quoted_by` column mutated on the quoted row:** not rebuild-honest
  unless it is a projection, in which case it is `post_citation`.
- **Persist the flattened chain on the quoting event:** denormalized
  ancestry that hide/moderation will contradict.
- **New `post_id` uuid:** duplicates `(kind, scope_id, source_seq)` and
  forks identity from moderation.
- **Cross-surface quotes in the first slice:** same type, larger
  capability problem; prove same-thread first.
- **Live citation deltas in the first slice:** deferred until badges were
  on the reading contract; game threads now emit `PostCitationsChanged`.

## Acceptance into the architecture docs

When this RFC is accepted, update:

- [01-domain-model](../arch/01-domain-model.md) — Post may carry quotations;
  citation is a directed fact; “quoted by” is a projection;
- [02-event-sourcing](../arch/02-event-sourcing.md) — add `post_citation` to
  the projection table;
- [10-event-schema](../arch/10-event-schema.md) — additive `quotations` on
  `PostSubmitted` / `DiscussionPostSubmitted`;
- [13-interaction-architecture](../arch/13-interaction-architecture.md) —
  Quote seeds the existing composer; the dock Reply remains uncited reply;
- [arch README](../arch/README.md) — move this RFC from Proposed to
  Accepted.
