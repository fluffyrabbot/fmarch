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

Cachy runs the canonical Linux proof graph, including Rust, isolated Postgres,
Chromium, and live-stack acceptance. Push a clean task checkpoint and submit
`npm run proof:remote -- --mode push`; inspect its signed receipt before landing.
See [canonical verification](docs/ops/cachy-canonical-verification.md) for the
pinned environment and full-sweep procedure. Native macOS/Safari proof remains
separate.
