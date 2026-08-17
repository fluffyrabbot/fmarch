# fmarch

A from-scratch forum + messaging platform whose first-class use case is **forum mafia** (Mafia / Werewolf played in threads): text and image posts, scoped private rooms, live votecounts, and a tablet-first host console.

It is general enough to host discussion. It is designed around the game, not retrofitted onto a generic forum.

## Settled shape

| Decision | Choice |
|---|---|
| Language | Rust (axum + tokio) |
| Persistence | Event-sourced, Postgres-backed |
| Security | Server-trusted, capability authz, no E2EE |
| Wire | Versioned CBOR over WebSocket; schema-first Rust→TS |
| Frontend | SvelteKit, tablet-first |
| Media | BLAKE3 content-addressed, transcoded, EXIF-stripped |
| Rulesets | Declarative packs over a closed IR |

The truth is an event log. "What was the votecount as of post #847?" has to be answerable by construction.

## Start here

- [Architecture index](docs/arch/README.md)
- [Vision](docs/arch/00-vision.md)
- [Engine and packs](docs/arch/09-engine-and-packs.md) — the im-human EngineV4 port lives here
- [Agent workflow / local proof](AGENTS.md)

There was no root README before 2026-08-15; this file is a pointer into the architecture corpus, not a substitute for it.
