# Human-Run Test Games

This is the local one-developer path for opening a seeded fmarch game in a browser.
It is a developer harness, not a production or beta-readiness claim.

## Prerequisite

Postgres must be reachable through `DATABASE_URL`. The default is:

```sh
DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch
```

With Docker running, the repo-local service is:

```sh
docker compose up -d postgres
```

If Docker is unavailable, use the repo-local helper. It initializes a Postgres
cluster under `target/local-postgres`, starts it on `127.0.0.1:5544`, creates the
`fmarch` database if needed, and prints the exact `DATABASE_URL`:

```sh
npm run dev:postgres -- start
```

The helper also supports:

```sh
npm run dev:postgres -- status
npm run dev:postgres -- print-env
npm run dev:postgres -- stop
```

## Start A Game

```sh
DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run dev:test-game
```

The command starts a Rust API, starts the SvelteKit frontend, seeds one
`mafiascum` D01 game through `/commands`, creates opaque browser-login tokens,
prints role entry URLs for `admin`, `host`, `player`, and `cohost`, and keeps the
servers alive until Ctrl-C.

It also writes:

```text
target/dev-test-game/session.json
target/dev-test-game/session.md
target/dev-test-game/named-games.json
```

Open a role URL from `session.md`, paste that role's token, and submit.

## Repeated Runs

By default, the friendly name is `local`.

```sh
npm run dev:test-game -- --name local
```

If that named game already exists in `target/dev-test-game/named-games.json`, the
harness reuses the same game id and does not reseed it. To make a fresh clean
game under the same name:

```sh
npm run dev:test-game -- --name local --reset
```

To require reuse and fail if the name is unknown:

```sh
npm run dev:test-game -- --name local --reuse
```

`--reset` does not delete append-only event history. It creates a fresh game id
for the friendly name, preserving the event-store invariant.

## Proof Commands

The no-server contract gate is:

```sh
npm run test:dev-postgres-contract
npm run test:dev-test-game-contract
```

The live local gate is:

```sh
DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run test:dev-test-game-live
```

That live gate starts the API and frontend, seeds a fresh `live-proof` game,
verifies host and player browser entry through `/auth/login`, then checks the
generated session artifact.

## Boundary

This proves a local seeded browser test-game workflow for one developer. It does
not prove production auth, hosted deployment, multiplayer hardening, upload or
transcode behavior, beta readiness, or rollback/delete semantics for existing
append-only games.
