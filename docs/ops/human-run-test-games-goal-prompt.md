# Human-Run Test Games Goal Prompt

You are working in `/Users/fluffypro/apps/fmarch`. Follow `AGENTS.md`: assume greenfield/no users, work directly on `main`, prefer the architecturally superior shape over transitional compatibility, keep the slice atomic, and use local proof before committing/pushing.

Current state: the frontend browser acceptance lane is proven by `npm run test:frontend-role-proof:browser`, and `npm run dev:test-game` now starts/uses a Rust API plus SvelteKit frontend, seeds one mafiascum D01 game through `/commands`, creates opaque browser-login tokens, prints role login URLs, and writes `target/dev-test-game/session.{json,md}`. Treat this as a developer harness, not a release/beta claim.

Goal: finish the remaining work necessary for human-run test games in browser. Make the local path feel like a small product loop: one command starts or reuses the stack, seeds a named playable game, gives clear role entry points, keeps the stack alive, and provides enough cleanup/reseed ergonomics that a human can repeatedly run host/player/admin scenarios without reading smoke-test internals.

Recommended build order:

1. Harden `npm run dev:test-game` UX: add idempotent game naming/reseed behavior, explicit `--reset` or `--reuse` semantics, better port/conflict diagnostics, and a clear failure when Postgres is unavailable.
2. Add a focused contract test for `tools/dev_test_game.mjs` that proves argument parsing, session-card shape, seed command plan shape, and URL/token output without starting servers.
3. Add a live proof lane that runs `DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run dev:test-game -- --no-keepalive`, then verifies the emitted session artifact and at least one authenticated host/player URL path through the real API/SvelteKit boundary.
4. Update `docs/arch/05-frontend.md` or an ops runbook with the exact human command, required Postgres assumption, generated artifact path, and what this does and does not prove.
5. Rerun the narrow proof set: `node --check tools/dev_test_game.mjs`, the new contract test, `npm --prefix frontend run check`, `npm run test:frontend-contract`, the new live dev-test-game proof, and `npm run test:frontend-role-proof:browser` if frontend/browser behavior changed.

Proof boundary to keep honest: this should prove a local seeded browser test-game workflow for one developer. It should not claim production auth, hosted deployment, multiplayer hardening, file upload/transcode, or beta readiness.
