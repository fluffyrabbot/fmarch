# Mash Scale Acceptance

This lane is the deterministic local regression gate for the 30+ seat mash
frontier. It exercises production command, scheduler, projection, host-console,
narrative-delivery, and rebuild paths against an isolated scratch database.

## Run

Start the repo-local Postgres if needed and expose its administrative database:

```sh
node tools/dev_postgres.mjs start
export DATABASE_URL=postgres://fmarch:fmarch@127.0.0.1:5544/fmarch
npm run test:mash-scale-acceptance
```

The runner creates a uniquely named database, runs migrations and the fixture,
validates the resulting JSON contract, and drops the database even when the
proof fails.

The saved artifact is:

```text
target/mash-scale-acceptance/report.json
```

## Fixed fixture and budgets

| Dimension | Contract |
|---|---|
| Roster | 60 occupied, role-assigned slots |
| DayEvents | 5 absolute-schedule, host-decision events |
| Participation | 300 final rows |
| Contention | 40 simultaneous submissions, all acknowledged, no duplicates, ≤ 20 s |
| Scheduler | 2 replicas race open and lock, one winning game claim per boundary, ≤ 5 s combined |
| Narrative | 10 public lifecycle posts, 10 distinct receipts, 10 published projections |
| Keyset read | 100-row cap; ≤ 202 plan rows examined; required index; two 25-row pages yield 50 distinct slots |
| Player attention | Exactly one item for each of 5 open events the fixture player can still act on |
| Host console | 60 slots, 5 events, 300 participant references, ≤ 8 tasks, ≤ 512 KiB, ≤ 2 s |
| Rebuild | Zero diffs, 300 participation rows and 10 narratives preserved, ≤ 5 s |

The ceilings are regression tripwires for the local proof machine, not production
service-level objectives. Change them only with an artifact-backed explanation,
never merely to make a regression green.

## Boundary

This lane proves one local Postgres node. It does not model network latency,
multi-region scheduling, or hosted resource contention. It also covers only the
shipped public `main` narrative channel. Private event channels require their own
capability-filtered delivery design and a zero-byte non-member proof before that
surface can ship.
