# 08 — Current roadmap and release frontier

| Field | Value |
|---|---|
| **Status** | Active |
| **Scope authority** | `docs/ops/completion-registry.json` |
| **Generated view** | `docs/ops/completeness-scorecard.md` |

This document describes the current build and release order. It replaces the
original first-vertical-slice plan: that slice proved the architecture and the
product has since grown through game completion, private rooms, identity,
community, media, archival, and mash-scale DayEvents.

The completion registry is authoritative for capability status. This roadmap
explains sequencing and boundaries; it must not independently promote an item
to complete.

## Current system baseline

The locally proven platform is built around four settled invariants:

1. **User is not Slot.** Replacement transfers current human authority while
   preserving slot-authored roles, votes, posts, actions, and private history.
2. **The event log is truth.** Commands append immutable facts and update
   rebuildable projections in one transaction.
3. **Authority is explicit.** The HTTP/WebSocket boundary resolves scoped
   capabilities and the command core receives a principal plus typed command.
4. **The engine is user-agnostic.** Declarative packs and the deterministic
   resolver operate on slots; the forum platform owns users, channels, media,
   identity, and delivery.

Votes use server-supplied target controls and typed `SubmitVote`/`WithdrawVote`
commands. Posts are never parsed as votes.

## Shipped local capability groups

The canonical registry records local completion for:

- append-only Postgres streams, encryption envelopes, optimistic concurrency,
  idempotent commands, synchronous projections, replay, and rebuild audits;
- declarative multi-ruleset resolution packs and deterministic result traces;
- setup, posting, voting, actions, host/cohost control, replacement, phase
  progression, endgame reveal, reconnect, stale-command recovery, and export;
- role PM, mafia, mason, neighbor, dead, spectator, and private DayEvent rooms;
- content-addressed media ingest plus bounded AVIF/WebP generation and serving;
- classic and WorkOS authentication methods, opaque app sessions, recovery,
  registration, invitations, delivery adapters, and lifecycle audit;
- public game discovery, discussions, profiles, search, moderation,
  subscriptions, unread inbox, and completed-game import/export;
- the RFC 0003 bounded community owners, RFC 0002 quotations, RFC 0005
  closed admission with sponsorship provenance, and RFC 0007 profile and slot
  mentions with reason-derived inbox delivery;
- versioned DayPrograms, scheduled/automatic/host-decided DayEvents, rewards,
  narratives, participant attention, and sixty-player mash acceptance.

“Complete” here means the registry's declared local proof boundary is closed.
It does not mean hosted, production, or human release evidence exists.

## Transport boundary

[04-wire-protocol](04-wire-protocol.md) owns HTTP commands and the binary-CBOR
live generation contract. Broadcast lag is terminal for the old socket:
recovery remints a ticket and refreshes after a fresh Hello. There is no JSON
WebSocket compatibility mode.

## Selecting the next coding slice

Read `recommended_slice` and dependencies in the
[completion registry](../ops/completion-registry.json) before starting work.
The active slice is signup threads (`product.community.signup-threads`);
forum post editing, retraction, and topic curation landed on 2026-09-16, and
the resolver night-action extraction is queued behind signup threads as
`remaining` text on `foundation.maintainable-core`.
[16-maintainable-core](16-maintainable-core.md) owns the module inventory. The
resolver's action, outcome, and trace families are extracted; broad stage
coordination, other projection families, physical command-test families, and
proof-runner orchestration remain distinct ownership work. Do not confuse an
extracted action helper with closure of the entire phase coordinator.

Prefer the next independently changing responsibility over a speculative
rewrite. Re-declare proof tiers at frontier checkpoints and use the sprint/full
policy in [AGENTS.md](../../AGENTS.md).

Accepted RFCs deliver product capability outside the registry's original
inventory; each landed RFC must be recorded as a registry item with its proof
anchors before its `Accepted` status is treated as shipped. The forum write
model has author post editing (bounded by `forum::FORUM_EDIT_WINDOW_SECONDS`,
append-only revision history), author retraction (a read-time overlay that
keeps cited excerpts), and GlobalMod rename/move/pin; the registry item
`product.community.forum-editing-curation`, ruled 1.0-required on 2026-09-16,
is complete, and signup threads are the recommended coding slice ahead of the
remaining `foundation.maintainable-core` extractions. Editability is a policy
each thread source owns: community forum threads are editable within a bounded
window, game channel threads never are (posts are slot-authored evidence, and
the absence of a game edit command is a proven contract asserted by
`api::public_platform_http_boundary::game_threads_have_no_edit_or_retract_path`),
and signup topics use the ordinary forum editing policy. Signup threads
(`product.community.signup-threads`) are ordinary visible, host-authored forum
topics that a game names as its immutable `origin` on `GameCreated`. There is no
new topic kind and no forum-to-game dependency. A topic may originate several
games; changing or hiding it never rewrites a game's recorded origin.

The host selects an optional topic in the admin game-creation form. Setup shows
the fixed origin privately. Only `GameStarted` exposes the reverse game link on
the topic and delivers `game_spawned_from_watched_topic` to members who watched
the topic at that start event (excluding the host). The game-creation sequence
identifies this destination; the start sequence orders delivery and read cursors.
`attention_destination` adapts these announcements beside public publications,
without manufacturing a post, quotation target, or moderation target. Topic or
game visibility suppresses the link and inbox row at read time. Starting a game
neither watches the game for anyone nor locks its topic.

The reverse edge and launch delivery replay from the game source; forum replay
preserves game-owned delivery, and subscription replay uses start-time watch
periods. The game rebuild audit includes scoped launch-delivery corruption.
Launch delivery and watch-period folds share a per-origin attention gate after
their own source-stream lock. Each fold reconciles both missing and obsolete
launch recipients, so lower-sequence subscribe/unsubscribe events that commit
after a start still converge to event-time membership. Game replay and audit
acquire this gate from the canonical creation event before clearing projections
or taking audit snapshots, even if the reverse projection is missing. Nothing
behind this gate acquires another event stream. This gate covers the origin
adapter only; ordinary post-watch fanout still needs its own commit-order
convergence followup.
Origin admission takes the new game stream lock first, then an existing topic's
source lock before HTTP identity locks. It skips occupied streams for idempotent
receipt replay and never waits on an empty origin candidate; the command rejects
occupied game streams or invalid origins and checks ownership/visibility under
the source lock. Thus two caller-selected empty IDs
cannot become an inverted pair of game/topic locks. A dedicated `Signup` context
is introduced only when enrolment must be machine-readable. RFC 0003 §4 gates community spaces on
admission-controlled membership entering the roadmap; RFC 0005 added global closed admission, so
whether that crosses the gate is an open owner ruling, not an implementation
backlog.

The public history explorer is accepted direction deferred beyond 1.0.
Persona/occupancy and member data-lifecycle substrate are locally complete;
hosted erasure and release evidence are separate. Projection snapshots await a
representative replay benchmark that exceeds a declared latency or resource SLO.

## 1.0 substrate after local product closure

Before hosted release evidence begins, close the required 1.0 substrate in
[15-one-zero-governance](15-one-zero-governance.md): shared object-backed media,
controlled migration ownership, a two-replica staging API, member data
lifecycle, CSP and release-security policy, retained assistive-technology
evidence, a pinned warning-clean toolchain, and decomposition of the
concentrated core/proof modules without compatibility scaffolding.

## Hosted release sequence

The [release runbook](../ops/railway-staging-target.md) owns exact-commit image
builds, migrator-first deployment, health/digest attribution, and production
pointer advancement. [15-one-zero-governance](15-one-zero-governance.md) and the
completion registry separately track hosted identity/gameplay, multi-node
races, observability, recovery drills, and human approval. A mechanically
successful deployment does not manufacture those observations.

## Product name

The owner has ratified `fmarch`; repository, package, domain, deployment, and
governing architecture names now agree.

Continue to [09-engine-and-packs](09-engine-and-packs.md) for the engine model,
[14-mash-and-manual-frontier](14-mash-and-manual-frontier.md) for mash design,
and the generated
[completeness scorecard](../ops/completeness-scorecard.md) for current status.
