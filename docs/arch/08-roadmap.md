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
[16-maintainable-core](16-maintainable-core.md) owns the module inventory. The
resolver's action, outcome, and trace families are extracted; broad stage
coordination, other projection families, physical command-test families, and
proof-runner orchestration remain distinct ownership work. Do not confuse an
extracted action helper with closure of the entire phase coordinator.

Prefer the next independently changing responsibility over a speculative
rewrite. Re-declare proof tiers at frontier checkpoints and use the sprint/full
policy in [AGENTS.md](../../AGENTS.md).

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
