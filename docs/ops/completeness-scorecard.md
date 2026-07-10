# Completeness scorecard

> **Living status doc — not design intent.** A snapshot of what is built plus a
> dependency-ordered checklist of what remains. Companion to
> [08-roadmap](../arch/08-roadmap.md) and the
> [engine-port readiness baseline](engine-port-readiness-baseline-2026-06-18.md).
>
> Last updated **2026-07-09** — `main` @ `9b82e957`.
> Visual version: <https://claude.ai/code/artifact/da80a9e8-3a15-4cd4-9ff0-ed549dbd206e>.

The hard part is done: the resolution engine is at full im-human V4 parity on a proven
event-sourcing spine. The remaining work is almost entirely **product breadth** and
**housekeeping**, not core engine.

## State of play

| Metric | Value | Notes |
|---|---|---|
| Engine parity | **192/192** | port checklist complete; 8/8 build-order phases; parity matrix has no unsupported rows |
| Proof surface | **126** | dev-test-game proof lanes; 382 files under `tools/` |
| In flight | **0** | local `main` matches `origin/main` |
| Remaining | **5 tiers** | 7 to finish + 1 optional |

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
| Proof harness | Live-stack browser smokes, operator replay, hermetic `cargo test`, frontend role proof | 126 lanes · 382 tools |

## What's left (dependency-ordered)

Order: **Tier 0 → 1 → 2 → 3**, with **Tier 4** anytime. Each item is tagged
`[Open]` (not started), `[Partial]` (some pieces landed), or `[Optional]` (build only
if needed).

### Tier 0 — Land the in-flight branch

*Gate: everything downstream assumes `main` is the source of truth. Do this first.*

- [x] **0.1 Push & integrate `sprint-b-withdraw-action`.** `[Landed]` The ten atomic
  commits are now on `main` through `a4d4a499`: the withdraw/current-action feature,
  hermetic cargo-test tiering, single-sourced proof scenarios, the `day_vote_outcome`
  audit, collation-safe ordering, stale-reference oracle corrections, and advisory-lock
  pool fixes. `main` and `origin/main` are aligned.
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
- [x] **1.4 Finish the macOS deadlock remediation.** `[Landed]` Operator proof contracts
  now call the underlying audit/report APIs in-process. The remaining unavoidable child
  processes run through one bounded helper with wall-clock deadlines, process-group kill,
  capped-but-drained output, and an inherited-pipe regression check. The minimizer uses
  its measured four-connection lower bound, while the repo defaults Rust tests to four
  threads to respect SQLx's shared 20-connection parent pool. The nonminimal semantic
  shrink replay and all restored generated-shrink cases are green in the default suite:
  337 passed, 0 failed, with only the heavy aggregate matrix left as an explicit opt-in
  instead of 44 ignored tests (commit `9dfe7bcf`).
- [x] **1.5 Fix the release-readiness freshness gate.** `[Landed]` Declarative readiness
  steps now derive a freshness scope from their declared `changedInputs`: consumed stale
  inputs still fail, while stale sibling defaults that the lane did not produce are
  omitted. Standalone readiness remains strict for required local evidence; real-hosted
  handoff artifacts stay visible as diagnostics without blocking the local spine. The
  full live proof now promotes host-setup evidence into its dedicated artifact, and the
  admin spine's internal readiness boundary runs through the shared declarative runner.

### Tier 2 — Close the deferred gameplay slices

*Gate: cheap wins that build directly on shipped T1–T3 and the engine.*

- [x] **2.1 Endgame summary in live resync / refresh keys.** `[Landed]` The player
  projection store now owns `endgameSummary` across cold load, live resync, and completed
  command recovery. A seeded player role URL proves the reveal after a stale
  `GameAlreadyCompleted` vote, an explicit resync from sequence zero, and a full reload;
  completed private-channel receipts expose the same reconciled refresh plan. The named
  `stale-player-complete-endgame-resync` hardening lane keeps this boundary addressable.
- [x] **2.2 Vote history in the reveal table.** `[Landed]` The reveal-gated endgame
  summary now withholds resolved vote outcomes until host completion, then exposes each
  day's durable result, majority, final tally, and actor ballots in the player table. A
  dedicated three-player D01 no-lynch seed proves the same history after stale-command
  refresh, explicit resync, and full reload through the named
  `stale-player-complete-vote-history` lane.
- [x] **2.3 Ship the last edge primitives.** `[Landed]` The shipped Mafiascum pack and
  Postgres command pipeline already carried `super_saint` (`TriggerOn::Lynch`) and
  `visitor_kill` (`TriggerOn::Visit`); their red matrix rows came from a whitespace-sensitive
  JSON scan and now derive from parsed trigger metadata. The `vanillizer` alias has its own
  golden plus a seeded N01 role URL that mutates a Cop, advances through D02, and proves at
  N02 and reload that the target is a Vanilla Townie with no Cop action while the actor
  retains `vanillaize`. The named `vanillizer-role-action` lane keeps the slice addressable.

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
- [ ] **3.4 Account lifecycle.** `[Partial]` Login, account-bound single-use invites,
  Argon2id password storage, authenticated password rotation with session
  revocation, hashed single-use recovery credential issuance/revocation/consumption,
  invalid/expired/revoked/replayed recovery rejection, opaque session
  rotation/revocation, and account disable/enable work through the existing role
  surfaces. Registration, hosted recovery delivery/traffic, hosted
  password-parameter monitoring, invite delivery, and abuse controls remain unbuilt.
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

- **Last edge primitives (2026-07-09):** the exact Postgres `super_saint` and
  target-filtered `visitor_kill` command/projection tests passed, structured inventory
  regeneration made both primitive rows fully green, and the role-specific `vanillizer`
  golden passed. `test:dev-test-game-core-live` then passed at 126/126 lanes; its saved
  browser evidence carries the `vanillaize` ACK, Cop-to-Vanilla-Townie projection, N02
  capability loss, actor capability retention, API agreement, and target reload. Seed
  fixture, proof, readiness, and next-action regeneration are green while release and
  production claims remain false.
- **Endgame vote history (2026-07-09):** the focused API tests passed 2/2 and prove a
  resolved outcome remains absent from the endgame summary until `CompleteGame`. The
  seeded player role URL then rendered the D01 `NoLynch` tally and both actor ballots
  after stale rejection, explicit resync, and reload; `test:dev-test-game-core-live`
  passed and the saved proof contract validated 125/125 lanes. The generated readiness
  checklist remains `not_ready`, with release and production claims false.
- **Endgame resync recovery (2026-07-09):** `test:dev-test-game-core-live` passed against
  local Postgres and rewrote the proof set at 124/124 lanes. The saved browser evidence
  covers completed summary reveal after stale-command refresh, explicit sequence-zero
  resync, and reload; frontend, harness, proof, and readiness contracts are green.
  Release readiness remains `not_ready`, with release and production claims false.
- **Code-verified (2026-07-09):** local and remote `main` aligned at `9b82e957`, port
  checklist 192/192, zero actionable parity-matrix gaps, the absent media pipeline (no
  blob crate; zero upload/transcode in `crates/*/src`), the missing
  forum/register/profile routes, and all
  counts (packs, migrations, 126 proof lanes, 382 files under `tools/`).
- **Readiness freshness remediation (2026-07-09):** the core-live and full-live local
  spines completed against Postgres; the proof contract validated 123 lanes; the harness
  contract suite passed 63/63 and the admin route model passed 99/99. Standalone readiness
  and next-action regeneration are green while release and production remain explicitly
  false and hosted evidence remains blocked pending real operator capture.
- **Default generated-shrink restoration (2026-07-09):** the bounded-process helper's
  three stream/timeout/process-group checks passed; the nonminimal shrink replay passed;
  all command targets compiled; and the full default Postgres pipeline passed 337/337 in
  242.66s. The sole ignored heavy aggregate matrix remains discoverable through its
  explicit `--ignored` lane.
- **Reproduced & resolved on Postgres (2026-07-08):** 1.1 and 1.2 — both reproduced
  against the live dev DB, root-caused as stale-reference test bugs (live == rebuild in
  both), and fixed test-side; `replay_audit_and_rebuild_deterministically` re-run green
  (12/12).
- **Re-verified on current `main` (2026-07-09):** the full frontend role-proof chain is
  green (29/29 artifact checks); the no-bind Chromium render smoke is green; both corrected
  rebuild tests, the concurrent advisory-lock race, and the ignored large-action-graph CLI
  pass/fail contract are green against the repo-local Postgres.
