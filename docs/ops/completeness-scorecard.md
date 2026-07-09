# Completeness scorecard

> **Living status doc — not design intent.** A snapshot of what is built plus a
> dependency-ordered checklist of what remains. Companion to
> [08-roadmap](../arch/08-roadmap.md) and the
> [engine-port readiness baseline](engine-port-readiness-baseline-2026-06-18.md).
>
> Last updated **2026-07-08** — branch `sprint-b-withdraw-action`, base `main` @ `d573ac03`.
> Visual version: <https://claude.ai/code/artifact/da80a9e8-3a15-4cd4-9ff0-ed549dbd206e>.

The hard part is done: the resolution engine is at full im-human V4 parity on a proven
event-sourcing spine. The remaining work is almost entirely **product breadth** and
**housekeeping**, not core engine.

## State of play

| Metric | Value | Notes |
|---|---|---|
| Engine parity | **192/192** | port checklist complete; 8/8 build-order phases; parity matrix has no unsupported rows |
| Proof surface | **119** | `npm` test lanes; 347 tools |
| In flight | **10** | commits unpushed on the branch |
| Remaining | **5 tiers** | 17 to finish + 1 optional |

## What we have (shipped & proven)

| Subsystem | What it covers | Proof |
|---|---|---|
| Event-sourcing spine | Append-only log, optimistic concurrency; every read model rebuilt & audited for replay determinism | 32 migrations · `audit_rebuild` green |
| Resolution engine | Deterministic slot-only resolver — night ordering, redirects, triggers, conversions, day vote outcome, win checks | port checklist 192/192 |
| Rule packs & linter | Five culture packs over a closed IR + strict version/reference validator | mafiascum · MU · chinese · epicmafia · default_open (+25 contract packs) |
| Command pipeline | Capability-gated commands: ResolvePhase, submit/withdraw action & vote, host actions, replacement | User≠Slot history preserved |
| Wire protocol | CBOR over WebSocket, explicitly versioned; TS types generated from the Rust `wire` crate | ~53 domain events |
| Player & host surfaces | Board, private channel, touch-first host console, admin audit, setup, login | Ballot & Lantern design program 5/5 |
| Gameplay gaps T1–T3 | Role card, night-action target picker (+withdraw), reveal-gated endgame summary | T1 · T2 · T3 landed |
| Proof harness | Live-stack browser smokes, operator replay, hermetic `cargo test`, frontend role proof | 119 lanes · 347 tools |

## What's left (dependency-ordered)

Order: **Tier 0 → 1 → 2 → 3**, with **Tier 4** anytime. Each item is tagged
`[Open]` (not started), `[Partial]` (some pieces landed), or `[Optional]` (build only
if needed).

### Tier 0 — Land the in-flight branch

*Gate: everything downstream assumes `main` is the source of truth. Do this first.*

- [ ] **0.1 Push & integrate `sprint-b-withdraw-action`.** `[Open]` Ten atomic commits
  — the withdraw/current-action feature plus four refactors (hermetic cargo test,
  single-sourced proof counts, `day_vote_outcome` audit, collation-safe ordering) — sit
  unpushed. Decide push/PR, then fast-forward `main`. *Blocks a clean baseline for all
  later work.*
- [x] **0.2 Proof-infra manifest refactor (Sprint B "Task F").** `[Landed — generator side]`
  Command-scenario definitions promoted to one rich manifest
  (`tools/frontend_proof_scenarios.mjs`); both interaction generators and the
  `COMMAND_SCENARIO_IDS` list now derive from it, with `lanes` as the single membership
  tripwire (commit `2f4c6d8e`, full `test:frontend-role-proof` chain green). The ~11
  role-smoke artifact-contract projections were **left hand-written on purpose** — they
  read the generated artifacts as an independent oracle, so deriving them from the same
  manifest would make the assertions tautological. Optional follow-up: single-source only
  the pure id/ordering lists (not the value tuples) if further dedup is wanted.

### Tier 1 — Restore a trustworthy green gate

*Gate: don't stack breadth on an unreliable suite — and one red touches the core
"truth is an event log" invariant.*

- [x] **1.1 — Not a divergence; stale-reference test bug.** `[Landed]`
  `host_resolve_phase_projects_conversion_and_persistent_effects` compared post-rebuild
  `player_notifications` against a snapshot captured *before* the N02 ignite. Live already
  emits the N02 `player_killed`/ignite receipt (the `PlayerKilled` fold does so for all
  kills, by design); live == rebuild == 3 rows. Fixed test-side: compare rebuild to the
  live post-ignite snapshot. No projection/domain change.
- [x] **1.2 — Not a divergence; stale-reference test bug.** `[Landed]`
  `engine_phase_input_preserves_submit_withdraw_history_and_current_day_ballots` compared
  post-rebuild `votecount` against a snapshot captured while D01 was still open. The D01
  lynch clears all ballots for the dead slot (`clear_ballots_for_dead_slot`) in both live
  and rebuild, so the log-derived boundary is genuinely empty; the only surviving live row
  was a raw stale ballot injected by SQL, which rebuild correctly discards. Fixed test-side:
  assert the rebuilt votecount is empty. No projection/domain change.
- [x] **1.3 Advisory-lock & connection-pool timeouts — both were pool-size starvation.**
  `[Landed]` Not load or core-count: each in-flight command that takes per-game advisory
  locks holds a dedicated pooled connection per lock plus its work/tx connection.
  `concurrent_submit_action_revalidates_after_winning_action` needed 6 simultaneous
  connections against `#[sqlx::test]`'s hardcoded `max_connections(5)` cap (2 racing
  handlers = 4, plus the harness blocker + advisory-wait poller); fixed by moving the
  harness's own connections onto a separate `aux_pool`. The `audit_large_action_graph_performance`
  CLI built its pool with `max_connections(1)`, which self-deadlocks the moment a command
  holds an advisory-lock connection and then needs another (the lock layer postdates that
  binary); fixed by raising it to 5. Both verified: concurrent test green ×3; the CLI's
  pass (exit 0, `ok=true`) and threshold-fail (exit 1, `ok=false`) branches both confirmed.
- [ ] **1.4 Finish the macOS deadlock remediation.** `[Partial]` Hermetic tiering shipped
  (minimize/shrink family quarantined behind `--ignored`). Remaining: collapse the other
  CLI-spawn tests to in-process calls, add a bounded spawn helper (timeout + pgid kill +
  stdout cap), and fix the `nonminimal_trigger_dependency…shrink` semantic red that
  un-quarantining exposed. Unblocks a fast, parallel-safe default suite instead of 44
  ignored tests.
- [ ] **1.5 Fix the release-readiness freshness gate.** `[Open]` The dev-test-game
  readiness step trips when a *sibling* lane's artifact is >24h stale; only an env-var
  workaround exists. Make lanes self-refresh or scope the gate to the lane under test.

### Tier 2 — Close the deferred gameplay slices

*Gate: cheap wins that build directly on shipped T1–T3 and the engine.*

- [ ] **2.1 Endgame summary in live resync / refresh keys.** `[Partial]` Wired for cold
  load only; add it to the deep-equal refresh-key arrays so it survives live resync and
  hydrated refresh across lanes.
- [ ] **2.2 Vote history in the reveal table.** `[Open]` Reveal shows winner + full slot
  roles; per-day vote history is still deferred. Fold it into the reveal-gated endgame
  projection and table.
- [ ] **2.3 Ship the last edge primitives.** `[Open]` `super_saint` (TriggerOn::Lynch) and
  `visitor_kill` (TriggerOn::Visit) are golden-covered but not in a shipped pack /
  resolver-integrated path; the `vanillizer` role wants command/projection integration.
  The only non-green rows left in the parity matrix.

### Tier 3 — Grow the slice into a platform

*Gate: mostly independent tracks — sequence by product priority. Media & account
lifecycle are the biggest slice→launch gaps.*

- [ ] **3.1 Media / image pipeline.** `[Open]` **Large.** Content-addressed (BLAKE3) blob
  store, REST upload, transcode to AVIF/WebP variants, EXIF strip. Designed in
  [07-images](../arch/07-images.md) but essentially unbuilt — no blob-store crate, zero
  upload/transcode in the backend; media routes only serve reference-checked
  `ThreadPage.media` payloads. The single largest unbuilt subsystem.
- [ ] **3.2 Private-channel breadth.** `[Partial]` Scumchat / private rooms work
  end-to-end. Role PMs, neighborhoods and masons — plus encryption-at-rest — need
  exercising for real across every channel type, not just the mafia day chat.
- [ ] **3.3 Board / forum surface.** `[Open]` Game index, non-game discussion areas, and
  profiles. Only the home route and per-game routes exist today.
- [ ] **3.4 Account lifecycle.** `[Partial]` Login and the `auth_account` projection exist;
  registration, session management and recovery are unbuilt (no register/recover route).
- [ ] **3.5 Archival & export.** `[Open]` Export a completed game as its own event stream —
  the natural payoff of an event-sourced core.
- [ ] **3.6 Projection snapshots.** `[Optional]` Snapshot projections to cap replay cost on
  long games. Roadmap says build only if replay cost demands it — defer until measured.

### Tier 4 — Housekeeping & open design calls

*Gate: anytime, low cost — no dependencies.*

- [ ] **4.1 Settle the codename.** `[Open]` Design docs still say "TBD / the platform" while
  the repo, crates and packs already say `fmarch`. Ratify and update doc 00 / the README.
- [ ] **4.2 Close the vote-syntax design call.** `[Partial]` Roadmap open call #1 (strict
  `##vote` tags vs freeform) is effectively answered — strict targets via the confirm
  picker are implemented — but never recorded. Write the decision in doc 01 / 08 and retire
  the open flag.

## Provenance — how each row was established

- **Code-verified (2026-07-08):** branch/remote state (10 commits, no upstream), port
  checklist 192/192, parity-matrix gaps, the absent media pipeline (no blob crate; zero
  upload/transcode in `crates/*/src`), the missing forum/register/profile routes, and all
  counts (packs, migrations, 119 test lanes, 347 tools).
- **Reproduced & resolved on Postgres (2026-07-08):** 1.1 and 1.2 — both reproduced
  against the live dev DB, root-caused as stale-reference test bugs (live == rebuild in
  both), and fixed test-side; `replay_audit_and_rebuild_deterministically` re-run green
  (12/12).
- **Reported from prior Postgres / Chromium sessions** (re-confirm on the current branch
  before acting): the remaining Tier 1 test reds (1.3) and the Task F queue. No full
  Rust/Postgres or browser suite was run when this snapshot was taken, so those statuses
  are as last observed, not freshly reproduced.
