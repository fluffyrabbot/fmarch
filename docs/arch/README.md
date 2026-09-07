# Architecture

Working docs for a from-scratch, forum-mafia–focused text+image forum / messaging
platform. Tablet-friendly (the moderator console especially), data-efficient on the
wire and in storage, server-trusted with strong authorization.

> **Product name:** fmarch.

These documents explain implemented ownership and behavior, plus explicitly
marked design directions. Source types and executable contracts define exact
shapes; historical decision records do not override them. Start with the
[developer quickstart](../development.md) to operate the repository.

## Documentation ownership

- Architecture documents own rationale and cross-layer invariants. Link to the
  owning document instead of repeating its procedure or proof inventory.
- [Database schema evolution](../ops/database-schema-evolution.md) owns migration
  procedure; [Railway releases](../ops/railway-staging-target.md) owns deployment.
- [AGENTS.md](../../AGENTS.md) owns local proof, host resource constraints, and
  commit workflow; [frontend proof](../ops/frontend-proof.md) explains UI evidence.
- [Completion registry](../ops/completion-registry.json) owns current capability
  status; [the scorecard](../ops/completeness-scorecard.md) is generated from it.
  Saved receipts establish a particular run's result, not timeless readiness.
- RFCs and the engine-port checklist retain decision history and proof anchors.
  Historical plans and optional extensions are labeled separately from current
  contracts. Do not change audited checklist rows merely to shorten prose.

## Settled decisions (the ones that fork the design)

| Decision | Choice | Doc |
|---|---|---|
| Core language | **Rust** (axum + tokio) | [03-backend](03-backend.md) |
| Persistence shape | **Event-sourced**, Postgres-backed | [02-event-sourcing](02-event-sourcing.md) |
| Security posture | **Server-trusted** + strong authz (no E2EE) | [06-security](06-security.md) |
| Authorization | **Capability-based**, per-game scoped | [06-security](06-security.md) |
| Rust↔TS contract | **Schema-first**, types generated from Rust | [04-wire-protocol](04-wire-protocol.md) |
| Transport | **HTTP/JSON commands and reads; CBOR WebSocket deltas**, explicitly versioned | [04-wire-protocol](04-wire-protocol.md) |
| Frontend | **SvelteKit**, server-rendered and hydrated, tablet-first | [05-frontend](05-frontend.md) |
| Media | **Content-addressed** (BLAKE3), transcoded, EXIF-stripped | [07-images](07-images.md) |
| Rulesets | **Declarative packs** over a closed IR, deterministic resolver | [09-engine-and-packs](09-engine-and-packs.md) |
| Layering | **User-agnostic engine** vs **forum platform** (two layers) | [09-engine-and-packs](09-engine-and-packs.md) |
| Overload | **Bounded admission**, explicit `429`/`503`, recoverable live lag | [12-capacity-and-overload](12-capacity-and-overload.md) |
| Interaction | **Reading-first player** / **exception-queue host** / guided setup | [13-interaction-architecture](13-interaction-architecture.md) |
| Mash + manual frontier | **Day program + catalog-parity host fiat**; automation recedes HostTasks | [14-mash-and-manual-frontier](14-mash-and-manual-frontier.md) |
| 1.0 release substrate | **Multi-replica**, shared media, controlled migrations, explicit governance | [15-one-zero-governance](15-one-zero-governance.md) |
| Maintainable core | **Pinned strict toolchain**, ownership-based module boundaries | [16-maintainable-core](16-maintainable-core.md) |
| DayEvent runtime | **Sole write emitter** in `commands::day_runtime`; pure policy in game_platform | [17-day-runtime-ownership](17-day-runtime-ownership.md) |

## Document index

0. [00-vision](00-vision.md) — what we're building and the values that gate choices
1. [01-domain-model](01-domain-model.md) — the forum-mafia domain: games, slots, phases, channels, votes
2. [02-event-sourcing](02-event-sourcing.md) — event store, projections, replay
3. [03-backend](03-backend.md) — Rust service: axum, tokio, sqlx, command handling
4. [04-wire-protocol](04-wire-protocol.md) — the Rust↔TS seam, CBOR framing, schema evolution
5. [05-frontend](05-frontend.md) — SvelteKit routes, live recovery, tablet-first interaction
6. [06-security](06-security.md) — authentication, capabilities, encryption at rest
7. [07-images](07-images.md) — content-addressed media pipeline
8. [08-roadmap](08-roadmap.md) — current sequencing and release boundaries
9. [09-engine-and-packs](09-engine-and-packs.md) — the multi-ruleset resolution engine, IR, and packs
10. [10-event-schema](10-event-schema.md) — concrete event taxonomy & result contract
11. [11-engine-port-checklist](11-engine-port-checklist.md) — audited completion checklist and historical build order for the im-human port
12. [12-capacity-and-overload](12-capacity-and-overload.md) — resource budgets, load shedding, and reproducible capacity proof
13. [13-interaction-architecture](13-interaction-architecture.md) — player workspace, host exception queue, setup workflow
14. [14-mash-and-manual-frontier](14-mash-and-manual-frontier.md) — mash culture (30+, day events, rewards) and permanent manual frontier
15. [15-one-zero-governance](15-one-zero-governance.md) — hosted topology, data stewardship, accessibility, security, and maintainability gates
16. [16-maintainable-core](16-maintainable-core.md) — strict toolchain baseline, responsibility inventory, and extraction order
17. [17-day-runtime-ownership](17-day-runtime-ownership.md) — DayEvent write/runtime ownership, emit table, scheduler path, ban list

## RFCs

- **Accepted:** [RFC 0001 — First-class replay and history explorer](../rfcs/0001-first-class-replay-and-history-explorer.md) — public as-of state, named occupancy history, meaningful-moment navigation, and durable share links
- **Accepted:** [RFC 0002 — First-class quotations and citation provenance](../rfcs/0002-first-class-quotations.md) — quotations as directed edges over the thread log; “quoted by” is a rebuildable projection, not a mutation of the quoted post
- **Accepted:** [RFC 0003 — Community Platform v2](../rfcs/0003-community-platform-v2.md) — separate game/forum writes, explicit content references, and one public-publication index for engagement features
- **Accepted:** [RFC 0004 — Principal/profile privacy boundary](../rfcs/0004-principal-profile-privacy-boundary.md) — private principal authority, public profiles, and slot-stable game personas
- **Accepted:** [RFC 0005 — Closed-community admission](../rfcs/0005-closed-community-admission.md) — invitation and membership authority
- **Accepted:** [RFC 0006 — Executable bounded-context architecture](../rfcs/0006-executable-bounded-context-architecture.md) — enforced domain ownership and dependency direction
- **Accepted:** [RFC 0007 — First-class mentions and addressed delivery](../rfcs/0007-first-class-mentions-and-addressed-delivery.md) — mentions as typed write-time facts (profile-addressed in community, slot-addressed in game) with reason-derived inbox and slot-notification delivery

## The one idea everything hangs on

Forum mafia is **not** a generic forum with a game bolted on. Its defining primitives —
**phases**, **automated votecounts**, **scoped private channels**, **slots that outlive
the humans occupying them** — are the things legacy software gets wrong and can never
fix. Game history is an event stream. Community discussions have their own write
model; shared discovery and engagement consume explicit content references
rather than treating every discussion as a game. Read
[01-domain-model](01-domain-model.md) and
[RFC 0003](../rfcs/0003-community-platform-v2.md) for those boundaries.
