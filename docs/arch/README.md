# Architecture

Working docs for a from-scratch, forum-mafia–focused text+image forum / messaging
platform. Tablet-friendly (the moderator console especially), data-efficient on the
wire and in storage, server-trusted with strong authorization.

> **Codename:** TBD. Docs refer to it as "the platform."

These are *design intent* documents, not API references. They describe the substrate
we are converging on and the reasoning behind each choice, so that implementation can
proceed without relitigating settled decisions.

## Settled decisions (the ones that fork the design)

| Decision | Choice | Doc |
|---|---|---|
| Core language | **Rust** (axum + tokio) | [03-backend](03-backend.md) |
| Persistence shape | **Event-sourced**, Postgres-backed | [02-event-sourcing](02-event-sourcing.md) |
| Security posture | **Server-trusted** + strong authz (no E2EE) | [06-security](06-security.md) |
| Authorization | **Capability-based**, per-game scoped | [06-security](06-security.md) |
| Rust↔TS contract | **Schema-first**, types generated from Rust | [04-wire-protocol](04-wire-protocol.md) |
| Wire format | **CBOR over WebSocket**, explicitly versioned | [04-wire-protocol](04-wire-protocol.md) |
| Frontend | **SvelteKit**, tablet-first SPA | [05-frontend](05-frontend.md) |
| Media | **Content-addressed** (BLAKE3), transcoded, EXIF-stripped | [07-images](07-images.md) |
| Rulesets | **Declarative packs** over a closed IR, deterministic resolver | [09-engine-and-packs](09-engine-and-packs.md) |
| Layering | **User-agnostic engine** vs **forum platform** (two layers) | [09-engine-and-packs](09-engine-and-packs.md) |
| Overload | **Bounded admission**, explicit `429`/`503`, recoverable live lag | [12-capacity-and-overload](12-capacity-and-overload.md) |
| Interaction | **Reading-first player** / **exception-queue host** / guided setup | [13-interaction-architecture](13-interaction-architecture.md) |
| Mash + manual frontier | **Day program + catalog-parity host fiat**; automation recedes HostTasks | [14-mash-and-manual-frontier](14-mash-and-manual-frontier.md) |

## Document index

0. [00-vision](00-vision.md) — what we're building and the values that gate choices
1. [01-domain-model](01-domain-model.md) — the forum-mafia domain: games, slots, phases, channels, votes
2. [02-event-sourcing](02-event-sourcing.md) — event store, projections, replay
3. [03-backend](03-backend.md) — Rust service: axum, tokio, sqlx, command handling
4. [04-wire-protocol](04-wire-protocol.md) — the Rust↔TS seam, CBOR framing, schema evolution
5. [05-frontend](05-frontend.md) — SvelteKit SPA, tablet-first, the moderator console
6. [06-security](06-security.md) — authentication, capabilities, encryption at rest
7. [07-images](07-images.md) — content-addressed media pipeline
8. [08-roadmap](08-roadmap.md) — the first vertical slice and build order
9. [09-engine-and-packs](09-engine-and-packs.md) — the multi-ruleset resolution engine, IR, and packs
10. [10-event-schema](10-event-schema.md) — concrete event taxonomy & result contract
11. [11-engine-port-checklist](11-engine-port-checklist.md) — source-derived checklist and build order for porting im-human day/night resolution
12. [12-capacity-and-overload](12-capacity-and-overload.md) — resource budgets, load shedding, and reproducible capacity proof
13. [13-interaction-architecture](13-interaction-architecture.md) — player workspace, host exception queue, setup workflow
14. [14-mash-and-manual-frontier](14-mash-and-manual-frontier.md) — mash culture (30+, day events, rewards) and permanent manual frontier

## The one idea everything hangs on

Forum mafia is **not** a generic forum with a game bolted on. Its defining primitives —
**phases**, **automated votecounts**, **scoped private channels**, **slots that outlive
the humans occupying them** — are the things legacy software gets wrong and can never
fix. We model the *game* as the source of truth (an event log) and treat the forum
"board" as one projection over it. Read [01-domain-model](01-domain-model.md) first.
