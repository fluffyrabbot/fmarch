# 17 — DayEvent runtime ownership

## Decision

DayEvent write/runtime is a single ownership boundary in `commands`. Pure
schedule, auto-resolution, and narrative policy live in `game_platform`.
Projections fold stream facts and maintain wake indexes only. The engine
resolver remains a separate domain path. API is transport only.

This boundary is mechanical ownership, not a new product contract. Event shapes,
SQL, and command semantics stay as defined in
[14-mash-and-manual-frontier](14-mash-and-manual-frontier.md).

## Ownership matrix

| Layer | Owns | Does not own |
|---|---|---|
| `game_platform` | Pure DayEvent types, schedule evaluation, auto-resolution selection, narrative receipt/id helpers | Stream appends, SQL, capability checks, HTTP |
| `commands::day_runtime` | **Sole** emitter of `DayEvent*` stream kinds on the write path; sole caller of `game_platform` day_schedule / day_auto_resolution / day_narrative on that path; sealed scheduler automation; host/player DayEvent handlers; program attach materialization that schedules DayEvents | Phase lifecycle (`StartGame` / `AdvancePhase` / `ResolvePhase`); engine resolution; projection fold SQL |
| `commands` (composition) | Dispatch into `day_runtime`; shared persistence/capability helpers | DayEvent lifecycle transition logic |
| `commands::day_scheduler` | Lease claim, retry/backoff, wake polling, calling sealed automation | Emitting DayEvent facts directly; re-implementing schedule/resolve/narrative |
| `projections` | Fold DayEvent* into rows; maintain `day_event_schedule_work` / scheduler wake indexes | Appending DayEvent* (or Phase*) to the stream |
| `api` | Authenticated command dispatch and projection reads for DayEvent surfaces | DayEvent authority, schedule evaluation, auto-resolve |
| `domain` resolver | Engine phase resolution (votes, night, prompts) | Platform DayEvent state machine |

## Emit table (`DayEvent*` kinds)

Only `commands::day_runtime` appends these on the write path:

| Kind | Typical producer | Notes |
|---|---|---|
| `DayEventScheduled` | `ScheduleDayEvent`, `AttachDayProgram` materialization | Immutable definition (+ narrative templates on program attach) |
| `DayProgramAttached` | `AttachDayProgram` | Program snapshot; colocated because it materializes scheduled events |
| `DayEventOpenDue` | Scheduler observation | Inert evidence before open transition |
| `DayEventOpened` | Host `OpenDayEvent` or scheduler observation | HostOpened vs scheduled open |
| `DayEventLockDue` | Scheduler observation | Inert evidence before lock transition |
| `DayEventLocked` | Host `LockDayEvent` or scheduler observation | May carry `auto_seed` for Auto resolution; serialized seeds are canonical unsigned-decimal text so REST and CBOR preserve the same `u64` exactly |
| `DayEventParticipationSubmitted` | Player submit | May grant private event channel membership |
| `DayEventParticipationWithdrawn` | Player withdraw | May revoke participant channel membership |
| `DayEventResolved` | Host `ResolveDayEvent` or auto-resolve | Same reward planners as host fiat effects |
| `DayEventCancelled` | Host `CancelDayEvent` | Terminal |
| `DayEventNarrativePublished` | Scheduler narrative pass | Second transaction after mechanics; paired with host-notice `PostSubmitted` |

Related non-`DayEvent*` facts that day_runtime may co-emit for catalog parity
(private channel membership, reward `ActionGranted` / lifecycle marks, host
notice posts) still go through the shared command append path. They are not a
license for other modules to emit DayEvent lifecycle kinds.

## Scheduler claim / wake path

1. Projections fold DayEvent and phase facts into `day_event_schedule_work`
   (`next_due_at`, `wake_seq`, `auto_resolve_pending`, `narrative_pending`).
2. `day_scheduler` claims due games with a short DB lease (`SKIP LOCKED`).
   Leases bound duplicate work across replicas; they are not the correctness
   boundary.
3. Claimed work calls sealed
   `day_runtime::advance_day_event_automation_as_scheduler` (no user principal,
   no wire command).
4. Mechanics transaction: stream advisory lock → observe schedules (open/lock
   due + transitions) → auto-resolve already-locked Auto events that were
   locked before this observation began (seed durability).
5. Narrative transaction (deliberately separate): publish pending host notices +
   `DayEventNarrativePublished`. Lifecycle remains durable if narrative retries.
6. Scheduler records success (advance observed wake) or failure (retry backoff).

Idempotency: due evidence and transitions are suppressed by projected
observed-at / state; cancelled events are terminal.

## Ban list

1. **No `DayEvent*` or phase-lifecycle stream appends outside commands write
   handlers.** DayEvent* kinds append only from `commands::day_runtime`.
   Phase kinds (`GameStarted`, `PhaseAdvanced`, `ResolutionApplied`, thread
   lock/unlock, etc.) stay on the existing phase handlers in `commands` lib —
   not in projections, api, game_platform, or the scheduler worker body.
2. **Projections fold and maintain work indexes only.** They never append to the
   game event stream.
3. **API is dispatch and read only.** No schedule evaluation, auto-resolution,
   or DayEvent append helpers in `api`.
4. **`game_platform` stays pure.** No pool, transaction, or stream append.
5. **Do not re-implement schedule/auto/narrative policy in commands outside
   `day_runtime`.** Call `game_platform::{day_schedule, day_auto_resolution,
   day_narrative}` from that module alone on the write path.
6. **Domain resolver does not own DayEvent.** Engine prompts and phase
   resolution remain separate from platform DayEvent host decisions.

## Module map

| Path | Role |
|---|---|
| `crates/commands/src/day_runtime.rs` | Sole DayEvent write/runtime home |
| `crates/commands/src/day_scheduler.rs` | Operational claim/lease loop |
| `crates/commands/src/day_program.rs` | Pack/program compatibility inspection (pure-ish helpers) |
| `crates/game_platform/src/day_*.rs` | Pure policy |
| `crates/projections` + day-event migrations | Folds and wake indexes |
