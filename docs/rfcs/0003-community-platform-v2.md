# RFC 0003 — Community Platform v2

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Created** | 2026-08-20 |
| **Accepted** | 2026-08-20 |
| **Decision owner** | Project owner |
| **Target** | Public forum, public game publication, and future non-game community surfaces |
| **Related** | [01-domain-model](../arch/01-domain-model.md), [02-event-sourcing](../arch/02-event-sourcing.md), [04-wire-protocol](../arch/04-wire-protocol.md), [RFC 0002](0002-first-class-quotations.md) |

## Summary

Replace the `community` catch-all with cohesive forum, attention, social,
trust-and-safety, and shared-content-reference boundaries. Preserve separate
game and forum write models. Cross-cutting public features consume one
rebuildable public-publication index rather than a closed
`discussion | game` target union.

This is a greenfield cutover: revise the schema and all adapters directly; do
not retain compatibility routes, dual writes, or old target-kind fallbacks.

## Context

The existing public forum is intentionally narrow and useful:

```text
DiscussionArea -> DiscussionTopic -> DiscussionPost
Game -> public main channel -> game post
```

Both sources are event-sourced and project synchronously. They currently meet
at a two-variant `PostRef` / moderation / subscription vocabulary. Search,
watch fan-out, inbox rendering, mute filtering, citation reads, and moderation
all branch on that pair of source tables. A third public source would multiply
those branches.

The game model must not become a nullable generic forum model. Its post
authority and provenance are defined by slot occupancy, channel membership,
and phase. Non-game posts are profile-authored. RFC 0002's rule remains in
force: share content identity and quotation mechanics, not write decisions.

## Decision

### 1. Bounded owners

The old `community` package is removed and its responsibilities become:

| Owner | Responsibility |
|---|---|
| `content_reference` | Stable content/thread references, quotations, and pure citation validation |
| `forum` | Public forum area/topic lifecycle and forum posting policy |
| `attention` | Watches, read cursors, and inbox delivery policy |
| `social` | Public profile presentation and private member-to-member relationships, beginning with mutes |
| `trust_safety` | Reports, cases, decisions, and content-visibility overlays |
| `game_platform` | Game-only composition policy, including main-thread YouTube embeds |
| `projections::publications` | The public-content index and source-specific projection adapters |

HTTP remains an adapter. Transaction-aware application services own load,
decide, append, and fold; handlers own authentication, request decoding, and
response adaptation only.

### 2. Content references are explicit and fail closed

`ContentRef` names an immutable item and has a code-owned source kind, scope,
and source sequence. A thread reference carries its actual container. In
particular, a game thread reference includes both `game_id` and `channel_id`;
callers must not pass a channel as unstructured side data beside a post ref.

`PublicContentRef` is narrower: it can name only a source that has a current
public-publication record. Private game channels never obtain one. This is the
authority boundary used by public citations, moderation, search, watches, and
inbox reads.

Quotation remains same-thread in this release. A quote is an immutable edge
with an excerpt snapshot; the reverse index is rebuildable. Game and forum
continue to decide quotation admissibility in their own write paths using the
shared pure validator.

### 3. Public-publication index

Each source projection records an `IndexedPublication` in the same transaction
as its source row:

```text
source event -> source projection + public_publication
                              |
                              +-> search / attention / trust-and-safety /
                                  citation visibility / mute filtering
```

The index owns a stable public content identity, publication target, canonical
route metadata, author profile when applicable, occurrence time, and current
visibility. It does not replace source projections or source authority.

Game `main` posts record publications. Private game channels record none.
Visible forum posts record publications. Hiding, restoring, muting, or
deactivating a source changes index visibility through rebuildable projections;
none of those actions rewrite the original post event.

Source adapters are explicit Rust code registered at the projection boundary.
There is no client-controlled kind string or runtime plugin registry. Adding a
new public source requires one source projection adapter and its own write
model, not changes throughout social feature SQL.

### 4. Community spaces are deferred, not denied

The initial v2 cutover has one global forum root. Add
`Community -> Membership -> Space -> Thread` only when owned, member-only, or
private non-game communities are a product requirement. At that point, add
explicit `CommunityMember`, `SpaceMember`, and `CommunityModerator`
capabilities resolved from membership projections. Do not reuse game
`ChannelMember` or make global moderation the local-role mechanism.

This is an explicit product gate, not an implementation backlog: public
surfaces, profiles, watches, and moderation remain global until the roadmap
includes at least one of private visibility, admission-controlled membership,
or owner-managed spaces. Crossing that gate requires a dedicated context and
capability design before adding routes or tables.

## Invariants

1. Game and forum aggregates retain separate commands, events, author models,
   and authorization decisions.
2. `User != Slot` remains absolute for game authorship; no public index can
   expose a credential principal.
3. A private game post has no public-publication row and cannot be discovered,
   watched, cited publicly, searched, or moderated through public routes.
4. Every public index mutation is synchronous with the event append and source
   projection; rebuilding from events produces the same index.
5. Mutes and moderation are reader/visibility overlays applied before
   pagination. They never mutate authored history.
6. Public content identity is stable across index rebuilds and quote/citation
   projections.
7. Adding a public source must require one source adapter, not an edit to a
   global source-kind switch in attention, social, or trust-and-safety.
8. Profile privacy and subject-erasure behavior remain owned by the identity /
   social boundary and are not weakened by publication indexing.

## Cutover

1. Extract shared references and quotation rules into `content_reference`; move
   YouTube embed policy to `game_platform`.
2. Add the public-publication index and migrate forum and public-game source
   adapters.
3. Port moderation, search, watches/inbox, citations, and mute filtering to
   the index. Delete the old two-kind target checks and joins.
4. Move forum, attention, social, and trust-and-safety code out of `community`.
5. Add community spaces and membership only when the product needs governed
   multi-community or private-space behavior; until then, reject ad-hoc
   membership or local-role additions at the public-platform boundary.

Development databases may be reset while this lands. No production data or
external clients exist, so preserving old schema/event compatibility is not a
goal. The final proof must demonstrate that a third public source can register
one adapter without changing the engagement consumers.

## Rejected alternatives

### One generic `post` table

Rejected. It would collapse game slot/channel/phase invariants into nullable
columns and make private-content mistakes easier.

### An arbitrary extensible string kind

Rejected. It weakens auditability and lets a transport-facing value select
authority behavior. Source kinds remain code-owned at the projection boundary.

### Retaining two-kind compatibility branches

Rejected. Greenfield status makes the old shape a liability rather than a
migration requirement. The cutover deletes it.
