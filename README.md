# fmarch

A from-scratch forum + messaging platform whose first-class use case is **forum mafia** (Mafia / Werewolf played in threads): text and image posts, scoped private rooms, live votecounts, and a tablet-first host console.

It is general enough to host discussion. It is designed around the game, not retrofitted onto a generic forum.

## Settled shape

| Decision | Choice |
|---|---|
| Language | Rust (axum + tokio) |
| Persistence | Event-sourced, Postgres-backed |
| Security | Server-trusted, capability authz, no E2EE |
| Transport | HTTP/JSON commands and reads; versioned CBOR WebSocket deltas; Rust→TS contracts |
| Frontend | SvelteKit, tablet-first |
| Media | BLAKE3 content-addressed, transcoded, EXIF-stripped |
| Rulesets | Declarative packs over a closed IR |

The truth is an event log. "What was the votecount as of post #847?" has to be answerable by construction.

## Start here

- [Architecture index](docs/arch/README.md)
- [Vision](docs/arch/00-vision.md)
- [Engine and packs](docs/arch/09-engine-and-packs.md) — the im-human EngineV4 port lives here
- [Agent workflow / local proof](AGENTS.md)

For local startup, proof selection, schema changes, and releases, use the
[developer quickstart](docs/development.md). Architecture documents explain
contracts; operating runbooks own procedures; the
[completion registry](docs/ops/completion-registry.json) owns capability status.

## Fleet verification

The Linux fleet profile is a bounded contract gate: proof-harness, architecture, frontend, and static database-schema checks. It does not run Cargo, live databases, browser screenshots, or the canonical full proof sweep. Canonical proof remains governed by AGENTS.md pending a separately validated host migration.

## Fleet verification

The Linux fleet profile is a bounded contract gate: proof-harness, architecture, frontend, and static database-schema checks. It does not run Cargo, live databases, browser screenshots, or the canonical full proof sweep. Canonical proof remains governed by AGENTS.md pending a separately validated host migration.
