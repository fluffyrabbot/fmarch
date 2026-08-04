# 08 — Current roadmap and release frontier

| Field | Value |
|---|---|
| **Status** | Active |
| **Updated** | 2026-07-28 |
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
- versioned DayPrograms, scheduled/automatic/host-decided DayEvents, rewards,
  narratives, participant attention, and sixty-player mash acceptance.

“Complete” here means the registry's declared local proof boundary is closed.
It does not mean hosted, production, or human release evidence exists.

## Transport boundary

The authoritative browser transport is deliberately asymmetric:

- **REST/JSON** carries commands, authentication, uploads, and cold projection
  reads.
- **WebSocket/binary CBOR** carries versioned server-to-client `Hello` and
  `ProjectionDelta` envelopes.
- A live connection is acquired through a short-lived, audience-bound ticket.
- Broadcast lag emits `ResyncRequired`; the client refreshes authoritative REST
  projections and continues on the same or a reconnected socket.

There is no JSON WebSocket compatibility mode. Pre-1.0 greenfield status lets
the binary boundary remain singular and testable.

## Next buildable product slice

The next dependency-satisfied coding item is
`product.community.member-mutes`.

Its required shape is:

1. append typed mute/unmute facts to one private relationship stream per member
   and target public profile;
2. project the current mute set without exposing credential principals;
3. apply one shared personalized-author suppression policy to discussion
   threads, public search, and subscription inbox reads;
4. expose bounded mute-list pagination plus profile and inbox controls;
5. prove two-member isolation, reversibility, moderation independence, rebuild,
   cursor stability, and browser recovery.

It does not add direct-message blocking, private-channel blocking, global
moderation, ranking, or recommendation semantics.

## Local closure after member mutes

After the mute slice is complete:

1. update the completion registry and regenerate the scorecard;
2. re-declare proof tiers so completed untouched surfaces are frozen and the
   next real frontier remains active;
3. run `npm run proof:lanes -- --mode sprint --run` during the checkpoint;
4. run `npm run proof:lanes -- --mode full --run` before landing the sprint;
5. retain the mash-scale report and role/browser proof artifacts from that exact
   commit.

Projection snapshots remain deferred until a representative replay benchmark
exceeds a declared latency or resource SLO.

## 1.0 substrate after local product closure

Before hosted release evidence begins, close the required 1.0 substrate in
[15-one-zero-governance](15-one-zero-governance.md): shared object-backed media,
controlled migration ownership, a two-replica staging API, member data
lifecycle, CSP and release-security policy, retained assistive-technology
evidence, a pinned warning-clean toolchain, and decomposition of the
concentrated core/proof modules without compatibility scaffolding.

## Hosted release sequence

Local product closure does not authorize release. Hosted work proceeds in this
order:

1. deploy the exact clean `main` commit to isolated Railway staging API,
   frontend, Postgres, media volume, variables, domains, and WorkOS environment;
2. verify staging API/frontend health and same-commit attribution;
3. capture non-fixture hosted identity and deployed gameplay evidence;
4. run the real hosted concurrent-race matrix;
5. retain logs, metrics, traces, alerts/SLO, and incident-response evidence;
6. run production-like backup/PITR, key escrow, and secret-rotation drills;
7. obtain explicit human rollback, support, and release approval;
8. advance the `production` release pointer to that already-pushed `main`
   commit.

No local, fixture, generated, or hosted-like artifact may stand in for those
external observations.

## Product name

The owner has ratified `fmarch`; repository, package, domain, deployment, and
governing architecture names now agree.

Continue to [09-engine-and-packs](09-engine-and-packs.md) for the engine model,
[14-mash-and-manual-frontier](14-mash-and-manual-frontier.md) for mash design,
and the generated
[completeness scorecard](../ops/completeness-scorecard.md) for current status.
