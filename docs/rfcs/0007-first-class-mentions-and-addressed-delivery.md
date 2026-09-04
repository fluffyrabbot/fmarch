# RFC 0007 — First-class mentions and addressed delivery

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Created** | 2026-09-03 |
| **Accepted** | 2026-09-04 |
| **Decision owner** | Project owner |
| **Target** | Community posting, game-thread posting, member inbox, and slot notification |
| **Related** | [RFC 0002](0002-first-class-quotations.md), [RFC 0003](0003-community-platform-v2.md), [RFC 0004](0004-principal-profile-privacy-boundary.md), [RFC 0006](0006-executable-bounded-context-architecture.md), [01-domain-model](../arch/01-domain-model.md), [02-event-sourcing](../arch/02-event-sourcing.md), [10-event-schema](../arch/10-event-schema.md) |

## Summary

Treat a mention as a directed relation from a post to an **addressable identity
inside that post's own universe**, decided at write time. It is not text that
happens to start with `@`, and it is not one relation.

Because this platform deliberately has no `User` ([RFC 0004](0004-principal-profile-privacy-boundary.md)),
there is no single mention type. A community post addresses a `ProfileId`. A
game post addresses a `SlotId`. The cross-universe case — naming a member
profile from inside a game thread — is an anonymity break and must be
*unrepresentable*, not merely rejected.

Delivery generalises the member inbox from watch-derived to **reason-derived**.
Today every `public_inbox_item` row requires a `public_watch` row. A mention has
no subscription behind it, so the inbox becomes principal-keyed with an explicit
reason, and watch fan-out becomes one reason among several.

This is a greenfield cutover. The inbox projection family is rebaselined in one
atomic change rather than shadowed by a second parallel inbox.

## Why now

Quotations ([RFC 0002](0002-first-class-quotations.md)) established the shape:
a citation is a typed fact on the citing post, validated at write time, with a
rebuildable reverse projection and no write onto the target's stream. That
machinery is landed and proven — `content_reference::decide_quotations`,
`public_citation`, `game_private_citation`, the composer chip UI, and the
`cargo:projections --test quotation_citation` lane.

Mentions are the same family and are currently absent everywhere: no Rust, SQL,
wire, or frontend surface has any notion of addressing a person. The two things
a forum-mafia community needs from a mention are:

- **directed address** — "this paragraph is answering *you*," distinct from
  quoting a post;
- **delivery** — the addressed party finds out without polling every thread.

The second is the part that does not fall out of the quotation precedent, and
it is where the real work is.

## Goals

1. Make a mention a typed fact on the mentioning post, decided at write time.
2. Keep game and community mention relations separate types, so the anonymity
   boundary is enforced by the type system rather than by a validator.
3. Anchor a mention to an immutable span of the post body, so rendering does not
   re-parse prose and a later handle rename cannot silently re-target a link.
4. Store identity, never handle text, on the durable fact.
5. Deliver community mentions through one generalised member inbox that also
   carries watch updates, with one honest unread semantics.
6. Deliver game mentions to the **slot**, so replacement transfers the address
   the way it transfers every other slot fact.
7. Keep visibility, moderation, and mute as read-time overlays over an immutable
   edge, exactly as `public_inbox_item` already does.

## Non-goals for the first version

- Treating the post body as the source of truth for who was mentioned. The body
  is prose; the mention list is the decision.
- Mentioning by display name, by principal, by account, or by email.
- Mentioning a member profile from a game thread, or a game persona from a
  discussion topic.
- Cross-game slot mentions.
- `@all`, `@here`, `@town`, `@mafia`, or any broadcast address. Host
  announcements and `PublishSpectatorPost` already own game-wide address.
- Mention-triggered email or push. The delivery outbox is admission-scoped
  ([RFC 0005](0005-closed-community-admission.md)) and does not become a
  general notification channel here.
- Mention editing or retraction. `PostEdited` / `PostRetracted` still do not
  exist; mentions must be compatible with them and do not land them.
- Mention counts in search ranking, or a mention document kind.
- A mention leaderboard, "mentioned you N times" aggregation, or any
  engagement signal on a public row.
- Mentioning media, embeds, or day-event narrative bodies.

## Decision

### 1. There are two mention relations, and they do not share a type

`01-domain-model` calls conflating user and slot "the single most common — and
most unfixable — mistake in forum mafia software." A single
`Mention { profile_id }` reused on both surfaces would reintroduce exactly that
mistake and would put a profile identifier onto a game-thread payload, which
RFC 0002 already forbids.

`content_reference` gains two sibling values, in the same style as its existing
`PostRef` / `PublicContentRef` split — deliberately different shapes for
deliberately different universes, carrying primitives rather than importing
another context's typed ids:

```rust
/// Address of a community member inside a profile-authored thread.
pub struct ProfileMention {
    pub profile_id: Uuid,
    pub span: MentionSpan,
}

/// Address of a game seat inside a game thread. Slot-stable across
/// replacement; it names no profile, persona, principal, or account.
pub struct SlotMention {
    pub slot_id: String,
    pub span: MentionSpan,
}

/// Byte range of the mentioning post's immutable body that this address
/// annotates.
pub struct MentionSpan {
    pub offset: usize,
    pub len: usize,
}
```

There is no enum over the two and no shared trait. `decide_profile_mentions`
and `decide_slot_mentions` are separate pure functions, mirroring RFC 0002's
"do not merge `decide_topic` and `submit_post`."

### 2. A mention is a span, not markup

The composer submits a structured list; the author's prose is untouched. The
body still literally reads `@alice` because that is what the author typed, but
the *link* comes from the recorded span plus the resolved id, never from a
read-time scan of the text.

This is the direct analogue of the quotation excerpt check. The write model
validates that the span is real:

- `offset + len` is within the body and lands on character boundaries;
- `body[offset..offset + len]` begins with `@`;
- the remainder resolves to the claimed identity under the rules in §3/§4;
- spans do not overlap and are strictly ascending.

Consequences that make this the right shape rather than the convenient one:

- A later handle rename does not silently re-target an old link. The span text
  is what was said; the `profile_id` is who was meant.
- Rendering is a linear walk over a decided list. No renderer reimplements
  mention policy in TypeScript, the same way no client reimplements the tally.
- `PostEdited`, if it ever lands, invalidates spans loudly instead of silently
  re-anchoring them, because a new body means a new decision.

Markup in the body (`[mention=…]`, a sentinel character, an HTML anchor) is
rejected for the reasons RFC 0002 already recorded against `[quote=12]`.

### 3. Only currently public profiles are mentionable

Community mention resolution reads `public_profile.handle` inside the same
transaction that appends the post. It does **not** read the blinded handle
index.

RFC 0004 invariant 9 already states that a private or redacted profile "cannot
supply current attribution to public discussion, search, or mute reads." A
mention is current attribution to public discussion. Mute already works this
way: "only currently public targets appear in the member-facing mute list."

Resolving through `member_profile.handle_hmac` instead was considered and
rejected in §"Rejected alternatives". Resolving through `public_profile`
settles four problems at once:

- typeahead and resolution draw on the same corpus, so suggestion cannot become
  weaker or stronger than resolution and the blinded index never becomes an
  enumeration oracle;
- no plaintext private handle can reach an event payload or a projection
  (RFC 0004 invariant 10) beyond what the author already typed into their own
  prose;
- the write path needs no `acquire_profile_handle_index_writer_lease`, so
  mention traffic cannot contend with handle-index rotation;
- an unknown or non-public handle collapses to one non-disclosing reject, in
  the same family as RFC 0002's missing/hidden quotation targets.

A profile that later goes private or is redacted keeps its mention edges. The
renderer degrades to unlinked span text plus an unavailable state, exactly as a
hidden quoted post keeps its stored excerpt.

### 4. Game mentions address a slot that can read the channel

A slot mention is authorised as a read of the addressed seat plus a write of a
new post, the same two-sided check quotations use:

- the named slot must exist in this game;
- the named slot must be able to read the channel being posted to.

The second is load-bearing. Mentioning a non-member slot from inside
`scumchat` or a `private:role_pm:*` room would leak that room's existence to
someone outside it. The reject is the generic invalid-target reject; it does not
disclose whether the slot exists, whether the channel exists, or which.

Host-authored notices, votecount posts, and `PublishSpectatorPost` do not carry
mentions in the first slice.

### 5. Delivery: the inbox becomes reason-derived

`public_inbox_item` is keyed `(subscription_id, source_seq)` with a foreign key
to `public_watch`, and unread is computed as
`item.source_seq > subscription.read_through_seq`. Every row therefore requires
a subscription. A mention has none — nobody subscribed.

The inbox is rebaselined to be principal-keyed with an explicit reason:

```text
member_inbox_item
  principal_id     uuid
  surface_id       uuid
  source_seq       bigint
  reason           text     -- 'watch' | 'mention'
  occurred_at      bigint

  PK    (principal_id, surface_id, source_seq, reason)
  INDEX (principal_id, source_seq DESC)

member_inbox_cursor
  principal_id     uuid PRIMARY KEY
  read_through_seq bigint NOT NULL
  updated_seq      bigint NOT NULL
  version          bigint NOT NULL
```

- `reason = 'watch'` rows fan out exactly as today, gated by
  `public_watch_period`, still suppressing the author's own updates.
- `reason = 'mention'` rows fan out from decided `ProfileMention` values,
  resolved to the addressed profile's current active principal, suppressing
  self-mention.
- Backfill on subscribe remains scoped to `reason = 'watch'`. A mention is
  delivered when it is written; it has no history to manufacture.
- Rebuild deletes by surface and replays, unchanged in kind.

`attention` grows one durable per-principal inbox cursor stream alongside its
existing per-target watch streams, with the same monotonic-advance discipline
and the same reject (`ReadCursorMustAdvance`).

### 6. Unread clears from either end

An inbox row is unread when it is beyond the principal inbox cursor **and**,
when a watch exists for that surface, beyond that watch's cursor:

```sql
item.source_seq > cursor.read_through_seq
  AND (watch.read_through_seq IS NULL OR item.source_seq > watch.read_through_seq)
```

Reading the thread clears it; marking the inbox read clears it. Neither cursor
is fabricated and both remain strictly monotonic. This preserves today's
"I read topic X, its inbox rows are read" behaviour while giving mentions —
which may arrive on a surface the member does not watch — a cursor that can
actually clear them.

### 7. Game delivery addresses the slot, not the principal

Slot mentions never enter the member inbox. The inbox is principal-addressed,
and resolving a slot mention to a principal at fan-out time would write the
`slot → human` binding into a delivery fact, which is precisely the corruption
`01-domain-model` warns about.

Slot mentions fold into the existing slot-addressed, phase-scoped
`player_notification` family (`game_id`, `phase_id`, `audience_slot`), and the
player rail resolves current occupancy at read time. Replacement therefore
transfers a pending mention with the seat, for free, and a mention of Slot 7 on
D2 stays a fact about Slot 7 regardless of who sat there.

### 8. Overlays stay at read time

The edge is stored; the decision to show it is not. Mention rows are filtered at
read time by publication visibility, `publication_surface.visible`,
`moderation_target_state`, and the reader's `profile_mute` overlay — the same
four filters `public_inbox` already applies. Hiding a mentioning post
immediately suppresses its delivery and restoring it reveals the same immutable
reference.

Mute is deliberately *not* a write-time reject. Mute "is never global
moderation"; a muted author must not learn they are muted by receiving a
different error. They may write the mention; it does not reach the muter.

### 9. Bounds

Mentions are a push channel, so they carry a per-post cap in the
`MAX_QUOTATIONS_PER_POST = 8` family: `MAX_MENTIONS_PER_POST = 8` on both
surfaces, with the over-cap reject in the same non-disclosing family. A post may
carry body, media, quotations, and mentions together. A mention-only post with
an empty body is impossible by construction, since every mention is a span of
that body.

`trust_safety::ReportReasonFamily` gains a variant for mention abuse so that
mass-addressing is reportable rather than only rate-limited.

## Invariants

1. A community mention names a `profile_id` that had a current `public_profile`
   row when the post was decided.
2. A game mention names a `slot_id` in the posting game that could read the
   posting channel when the post was decided.
3. No durable mention fact contains a handle, display name, account name, email,
   principal, persona, or subject.
4. No game-thread event, projection, or DTO carries a profile mention.
5. No community event, projection, or DTO carries a slot mention.
6. Every mention span lies on character boundaries inside its own post's body
   and begins with `@`; spans within one post are non-overlapping and ascending.
7. A post's mention list is decided once and never re-derived from body text.
8. Inbox rows are immutable references; visibility, moderation, and mute are
   applied at read time only.
9. An author never receives inbox delivery for their own post.
10. Both inbox cursors advance strictly monotonically and never exceed the
    surface's current public sequence.
11. Slot mention delivery resolves occupancy at read time and stores no
    principal.
12. Rebuilding the log reproduces `member_inbox_item`, `member_inbox_cursor`,
    and every mention projection byte-identically.

## Fitness and dependency impact

Under [RFC 0006](0006-executable-bounded-context-architecture.md), the four
integration hubs are dependency-ratcheted. Placing mention **values** in
`content_reference` and mention **delivery decisions** in `attention` requires
**no ratchet amendment**: `content_reference` is already an allowed direct
dependency of `api`, `projections`, and `wire`, and `attention` is already
allowed for `api` and `projections`. `wire` continues to define its own DTOs
with `From` conversions rather than acquiring a new edge.

A dedicated `mentions` crate is rejected on exactly this ground: it would fail
`ratchet:projections-direct-workspace-dependencies` and
`ratchet:api-direct-workspace-dependencies` and would require a migration-ledger
amendment to buy nothing that the two existing pure contexts do not already
express.

Both `content_reference` and `attention` are governed by
`hard:pure-context-inward-only`, so the mention decision functions stay pure:
handle resolution, occupancy resolution, and fan-out are adapter work, not
domain work.

Fan-out for mentions reads `public_profile` from within `projections`. That is
the same class of cross-family read `backfill_subscription_inbox` already
performs against `member_profile`, and it does not deepen
`target:monolithic-projections-have-no-write-authority` — it appends no
canonical fact and opens no privacy claim. It is nonetheless the natural seam
for the eventual typed integration fact when that target ban is promoted.

## Write model

### Commands

Additive optional field, default empty, on both submit paths:

```rust
// community
TopicCommand::SubmitPost {
    body: String,
    author_profile_id: Uuid,
    quotations: Vec<Quotation>,
    mentions: Vec<ProfileMention>,
}

// game
SubmitPostRequest {
    game: Uuid,
    channel_id: String,
    actor_slot: String,
    body: String,
    media: Vec<ThreadPostMedia>,
    quotations: Vec<Quotation>,
    mentions: Vec<SlotMention>,
    embed_url: Option<String>,
    embed_snapshot: Option<EmbedSnapshot>,
}
```

`CreateDiscussionPostRequest` and the wire `SubmitPost` variant grow the same
list, carrying `{ handle, offset, len }` on the community side and
`{ slot_id, offset, len }` on the game side. The API boundary resolves handle to
`profile_id` before the pure decision runs, exactly as
`quotation_thread_for_discussion` loads thread state before
`decide_quotations`.

Absent or `[]` means "this post addresses nobody," which is valid forever and is
how every existing event upcasts.

### Events

Additive optional field on the existing kinds. No new event type, no event on
the addressed party's stream, no event on any slot stream.

```text
DiscussionPostSubmitted { body, author_profile_id, quotations?, mentions? }
PostSubmitted           { channel_id, author, body, media?, phase_id, quotations?, mentions? }
```

Missing `mentions` deserializes to `[]`. Do not bump the event version solely to
add this field.

### Decision-time rejects

The write models reject; they do not coerce. All target failures collapse to one
non-disclosing class.

| Condition | Reject |
|---|---|
| Handle has no current public profile | unknown mention target |
| Named slot is absent from this game | invalid mention target |
| Named slot cannot read the posting channel | invalid mention target |
| Span is out of range, mid-character, or does not start with `@` | invalid mention span |
| Span text does not match the resolved target's current handle | invalid mention span |
| Spans overlap or are not ascending | invalid mention span |
| Duplicate target in one post | duplicate mention |
| More mentions than the per-post cap | too many mentions |

Self-mention is **accepted** and simply delivers nothing, matching the existing
author-suppression rule in watch fan-out.

## Read and wire

```rust
struct ThreadPostMention {   // game
    slot_id: String,
    offset: i64,
    len: i64,
}

struct DiscussionPostMention {   // community
    profile: Option<DiscussionAuthor>,   // None once non-public or redacted
    offset: i64,
    len: i64,
}
```

`ThreadPost` and `DiscussionPost` each gain their own `mentions` list, mirroring
how they already each carry `quotations`. Mentions are denormalized as jsonb
onto `discussion_post` and `thread_view` beside the existing `quotations`
column so the thread page emits mention chrome without a join, and that jsonb
must rebuild identically.

The inbox DTO gains `reason`. Live delivery kinds are unchanged in the first
slice; a mention arriving in a loaded thread is visible through the ordinary
post delta that carries it.

## Surfaces

### Composer

Mention is a typeahead inside the existing composer, not a second control.

- Typing `@` opens a bounded public-profile suggestion list (public search
  corpus only). Selecting inserts the handle text and records a span.
- Editing the body re-derives spans client-side before submit; the server's span
  validation is the authority, so a stale client span rejects rather than
  mis-anchoring.
- Player thread: `@` addresses slots in the current channel, sourced from the
  already-loaded channel roster. No network round trip, no profile corpus.
- Public publication: read-only, no composer.

No-JavaScript community posting submits no mentions in the first slice. Prose
containing `@alice` remains valid prose and is simply not a decided mention —
which is the honest outcome, not a degradation, since the decision is the fact.

### Renderer

A mention renders as an inline anchor over its recorded span: a profile link on
community, a slot chip on game surfaces, and unlinked plain text when the target
is no longer resolvable. Renderers walk the decided list; they never scan the
body for `@`.

### Inbox

One list, one badge, rows labelled by reason. A mention row shows the surface
title and canonical post URL, exactly like a watch row — no body, no author
identity, no engagement signal. "Mark all read" advances the principal cursor.

## Delivery slices

Each slice is an atomic commit with its mechanically selected lanes green.

### Slice 1 — Inbox generalisation (no product change)

Rebaseline `public_inbox_item` to `member_inbox_item` plus
`member_inbox_cursor`; add the inbox-cursor stream to `attention`; rewrite
`fan_out_public_publication_update`, `backfill_subscription_inbox`, and
`public_inbox`; keep observable inbox behaviour identical apart from the new
cursor. Migration `0005`, regenerated `schema/current.sql`, updated
`baseline_contract` and `database_schema::authority` allowlists.

This is the largest and only genuinely risky slice, and it deliberately ships
with no feature attached.

### Slice 2 — Community mention write model

`ProfileMention`, `MentionSpan`, `decide_profile_mentions`; additive field on
`TopicCommand::SubmitPost` and `DiscussionPostSubmitted`; handle resolution at
the API boundary; `mention` fan-out into `member_inbox_item`; jsonb on
`discussion_post`; full reject matrix and rebuild identity.

### Slice 3 — Community read contract and surface

`DiscussionPost.mentions`, inbox `reason`, wire regeneration, composer
typeahead, inline renderer, unresolvable-target state, mute and moderation
proofs.

### Slice 4 — Game slot mentions

`SlotMention`, `decide_slot_mentions`, additive field on the game submit path
and `PostSubmitted`, `player_notification` delivery, `thread_view` jsonb, slot
chip rendering, and channel-capability proof.

Because the change crosses `content_reference`, `attention`, `projections`,
`wire`, `api`, `commands`, and the frontend, slice 4 finishes with
`npm run proof:lanes -- --mode full --run` before landing to `main`.

## Proof plan

### Write model

- Missing `mentions` on old events upcasts to `[]`.
- Happy path stores id and span; the addressed profile's and slot's streams gain
  no event.
- Unknown handle, private-profile handle, redacted-profile handle, foreign slot,
  non-member slot from a private channel, out-of-range span, mid-character span,
  span not starting with `@`, span text disagreeing with the resolved handle,
  overlapping spans, descending spans, duplicate target, and over-cap all
  reject, and the target-failure rejects are indistinguishable from each other.
- Self-mention is accepted and delivers nothing.
- A slot mention cannot be constructed on a community post, or a profile mention
  on a game post, at compile time. The proof is a compile-fail fixture, not a
  runtime assertion.

### Delivery

- A mention delivers to a member who does not watch the surface.
- A watch row and a mention row for the same `(principal, surface, source_seq)`
  coexist and both clear correctly.
- Reading the thread clears a mention row on a watched surface; marking the
  inbox read clears one on an unwatched surface.
- Both cursors reject non-advancing input.
- Muting the author suppresses delivery without changing the author's write
  result.
- Hiding the mentioning post suppresses delivery; restoring it reveals the same
  immutable row.
- Rebuild of `member_inbox_item`, `member_inbox_cursor`, and both mention jsonb
  columns is byte-identical.
- Replacement transfers a pending slot mention to the incoming occupant with no
  new event on the mention.

### Security and privacy

- No mention fact, projection row, DTO, or log line contains a handle, display
  name, principal, persona, subject, or account.
- Mention resolution never reads `member_profile.handle_hmac`.
- A private-channel slot mention does not appear in any surface readable from
  `main`.
- Erasing a mentioned profile leaves the edge and removes the link; it does not
  resurrect a handle.
- Typeahead over the public corpus cannot confirm the existence of a private
  handle.

## Rejected alternatives

### One `Mention { profile_id }` shared by game and community

Rejected. It reintroduces the `User ≠ Slot` conflation at the type level and
would put profile identity onto a game-thread payload. Type-level separation is
the only enforcement that survives a future refactor.

### Parse `@handle` from the body at read time

Rejected for the same reason RFC 0002 rejected `[quote=…]` markup: the address
becomes unprovable, delivery becomes guesswork, rename and erasure silently
re-target links, and every renderer reimplements mention policy.

### Store the handle string on the event

Rejected. It fossilises a handle in an immutable payload, fights RFC 0004
invariant 10, and makes a rename produce two disagreeing sources of truth.

### Resolve mentions through the blinded handle index

Rejected. It would make every active profile mentionable regardless of
visibility, turning a public post into a handle-existence oracle, and it would
put mention traffic under the handle-index rotation lease. `public_profile` is
already the declared source of current public attribution.

### Auto-create a watch when someone is mentioned

Rejected. It subscribes a member to a thread they never chose, and it corrupts
the per-target read cursor with items that are not about reading that target.

### A parallel `mention_inbox_item` table

Rejected. Two inboxes means two cursors, two unread badges, two pagination
orders, and two moderation-overlay implementations that will drift.

### Deliver game mentions to principals

Rejected. It writes the `slot → human` binding into a delivery fact, breaks on
replacement, and leaks occupancy into a game-scoped surface.

### Reject mentions from muted authors at write time

Rejected. Mute is a private read-time overlay, not global moderation. A
write-time reject would tell the muted author they are muted.

### `@all` / role broadcast in the first slice

Rejected. Game-wide address already exists as host announcements, and an
unbounded broadcast is a spam and gameplay problem that needs its own policy.

## Acceptance into the architecture docs

When this RFC is accepted, update:

- [01-domain-model](../arch/01-domain-model.md) — a Post may carry mentions;
  a community mention addresses a profile and a game mention addresses a slot;
  mention delivery is a projection;
- [02-event-sourcing](../arch/02-event-sourcing.md) — replace the
  `public_inbox_item` row in the projection table with `member_inbox_item` /
  `member_inbox_cursor` and describe reason-derived fan-out;
- [10-event-schema](../arch/10-event-schema.md) — additive `mentions` on
  `PostSubmitted` / `DiscussionPostSubmitted`;
- [13-interaction-architecture](../arch/13-interaction-architecture.md) —
  mention typeahead lives inside the existing composer;
- [06-security](../arch/06-security.md) — mentionability is a public-profile
  boundary, and slot mentions inherit channel read capability;
- [arch README](../arch/README.md) — move this RFC from Proposed to Accepted.
