# Human-Run Test Games Goal Prompt

You are working in `/Users/fluffypro/apps/fmarch`. Follow `AGENTS.md`: assume greenfield/no users, work directly on `main`, prefer the architecturally superior shape over transitional compatibility, keep the slice atomic, and use local proof before committing/pushing.

Current state: the frontend browser acceptance lane is proven by `npm run test:frontend-role-proof:browser`, and `npm run dev:test-game` starts/uses a Rust API plus SvelteKit frontend, seeds one mafiascum D01 game through `/commands`, creates invite-backed browser role URLs, and writes `target/dev-test-game/session.{json,md}`. The harness now supports friendly named games, default reuse, explicit `--reset` and `--reuse`, port and Postgres preflights, and optional browser-entry verification. Treat this as a developer harness, not a release/beta claim.

Goal: finish the remaining work necessary for human-run test games in browser. Make the local path feel like a small product loop: one command starts or reuses the stack, seeds a named playable game, gives clear role entry points, keeps the stack alive, and provides enough cleanup/reseed ergonomics that a human can repeatedly run host/player/admin scenarios without reading smoke-test internals.

Completed build order:

1. `npm run dev:test-game` UX is hardened with idempotent friendly names, default reuse, explicit `--reset` and `--reuse`, API/frontend port checks, and a clear Postgres reachability failure before server startup.
2. `npm run test:dev-test-game-contract` proves argument parsing, session-card shape, seed command plan shape, and invite URL/token output without starting servers.
3. `npm run test:dev-test-game-live` runs the harness with `--reset --verify --no-keepalive`, validates the emitted session artifact, verifies host/player/action-player/denied-player invite redemption plus capability resolution through the real API/SvelteKit boundary, drives host lock/reject recovery plus Day-to-Night action submission/resolution/advance in the seeded game, proves allowed private-channel post ACK plus denied-channel 403 recovery, and promotes the first multiplayer-hardening lane with duplicate `command_id` replay plus stale host-control recovery.
4. `docs/ops/human-run-test-games.md` records the exact human command, required Postgres assumption, generated artifact paths, reset/reuse behavior, proof commands, and proof boundary.
5. Rerun the narrow proof set after changing the harness: `node --check tools/dev_test_game.mjs`, `node --check tools/dev_test_game_live_proof.mjs`, `npm run test:dev-test-game-contract`, `npm --prefix frontend run check`, `npm run test:frontend-contract`, `npm run test:dev-test-game-live`, and `npm run test:frontend-role-proof:browser` if frontend/browser behavior changed.

Proof boundary to keep honest: this should prove a local seeded browser test-game workflow for one developer, plus the specific duplicate-command and stale-host-control hardening lane above. It should not claim production auth, hosted deployment, reconnect behavior, concurrent command races, file upload/transcode, or beta readiness.
