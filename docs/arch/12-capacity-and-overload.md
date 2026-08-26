# 12 — Capacity, backpressure, and overload

This document defines the resource budgets and failure behavior that prevent fmarch from
degrading into an undifferentiated “server too busy” state. The governing rule is that every
queue is bounded, every expensive wait has a deadline, and rejection identifies whether the
caller or the service is saturated.

## Response contract

| Condition | Response | Meaning |
|---|---:|---|
| Caller-scoped abuse or quota | `429 Too Many Requests` + `Retry-After` | This principal/source must slow down; healthy unrelated work may continue. |
| Global HTTP admission exhausted | `503 Service Unavailable` + `Retry-After` | The service has no request slot before the queue deadline. |
| Request deadline exhausted | `503 Service Unavailable` + `Retry-After` | The admitted request did not complete inside its end-to-end server budget. |
| WebSocket connection capacity exhausted | `503 Service Unavailable` + `Retry-After` during handshake | The live-connection budget is full; cold REST reads remain available. |
| WebSocket receiver falls behind | `ResyncRequired` on the same socket | The bounded broadcast discarded deltas; the client cold-loads current projections. |

`429` is never a substitute for service saturation, and `503` is never used to punish one
caller. Health checks bypass HTTP admission so an orchestrator can distinguish a live saturated
process from a dead one. The health route must remain constant work and must not query Postgres.

## Runtime budgets

The defaults are conservative starting points, not claims about hosted capacity:

| Resource | Default | Environment variable | Exhaustion behavior |
|---|---:|---|---|
| Postgres connections | 10 | `FMARCH_DB_MAX_CONNECTIONS` | Acquisition waits at most the DB acquire deadline. |
| Postgres acquire wait | 250 ms | `FMARCH_DB_ACQUIRE_TIMEOUT_MS` | SQLx returns an error inside the enclosing HTTP deadline. |
| Postgres statement | 5 s | `FMARCH_DB_STATEMENT_TIMEOUT_MS` | Postgres cancels the statement. |
| Postgres lock wait | 1 s | `FMARCH_DB_LOCK_TIMEOUT_MS` | Postgres cancels lock acquisition rather than accumulating waiters. |
| Idle transaction | 10 s | `FMARCH_DB_IDLE_TRANSACTION_TIMEOUT_MS` | Postgres terminates the idle transaction. |
| Admitted HTTP requests | 128 | `FMARCH_HTTP_MAX_IN_FLIGHT` | Further requests wait only for the queue deadline. |
| HTTP admission queue | 50 ms | `FMARCH_HTTP_QUEUE_TIMEOUT_MS` | Retryable `503`. |
| End-to-end HTTP request | 15 s | `FMARCH_HTTP_REQUEST_TIMEOUT_MS` | Retryable `503`; the request future is cancelled. |
| Retry hint | 1 s | `FMARCH_HTTP_RETRY_AFTER_SECONDS` | Sent with capacity `503` responses. |
| Live WebSocket connections | 512 | `FMARCH_WS_MAX_CONNECTIONS` | Retryable `503` handshake. |
| Deltas retained per receiver | 256 | `FMARCH_LIVE_PROJECTION_CAPACITY` | Lagging receiver gets `ResyncRequired`. |

Configuration is strict at startup for the database and HTTP budgets. Invalid or out-of-range
values fail the process rather than silently changing the capacity model. `FMARCH_WS_MAX_CONNECTIONS`
and the live projection capacity are clamped by the API boundary to safe ranges.

The HTTP semaphore bounds admitted request futures, not socket count. A WebSocket owns a separate
connection permit for its entire lifetime. The HTTP permit covers only its upgrade request.

## Query and command invariants

- Public thread, discussion, game-index, and search responses have server-clamped page sizes.
- Thread and board traversal use keyset cursors. Offset pagination is forbidden on growing public
  collections.
- The public thread hot path must use `thread_view_page_idx`; a 100-row page may examine at most
  202 `thread_view` rows in the repo-local proof fixture.
- Search uses the dedicated document projection's stored weighted `tsvector` and partial GIN
  index. Search results are capped at 50; the capacity proof requests 20 and records search-only
  first/continuation-page latency plus the exact production statement's analyzed access path.
- A command transaction appends its events and synchronous projections atomically. It is bounded
  by the Postgres statement/lock limits and the encompassing HTTP deadline.
- Concurrent commands on one game stream use optimistic concurrency and bounded server retry.
  They may never produce duplicate committed posts or an internal error merely because they raced.
- Live broadcast storage is independent of connection count. Per-event connection work is bounded
  by `FMARCH_WS_MAX_CONNECTIONS`; a receiver that cannot keep up is converted to one resync
  obligation instead of receiving an unbounded queue.

## Required signals

The runtime emits structured events at the admission boundary:

- `http_request_completed`: method, path, status, and elapsed milliseconds;
- `http_admission_rejected`: method, path, queue deadline, and capacity reason;
- `http_request_deadline_exceeded`: method, path, and request deadline;
- `live_connection_rejected`: WebSocket connection-capacity rejection;
- `live_projection_receiver_lagged`: game, ephemeral connection id, and dropped-message count.

Successful public search also emits `public_search_completed` with only bounded dimensions:
filter, first/continuation page, clamped limit, result count, whether another page exists,
elapsed milliseconds, and page fill in basis points. Page fill is a lower-bound selectivity
signal, not total match cardinality. Query text, query hashes, cursors, viewer identity, and raw
request paths are forbidden. Exact cardinality would require another database operation and is
not worth adding to the read path.

The next broader hosted observability pass must aggregate these with DB pool acquire latency, statement
latency, command transaction duration, append conflicts/retries, live connection count, resync
rate, CPU, memory, and Postgres I/O pressure. Secrets, principals, post bodies, and projection
payloads do not belong in capacity logs.

## Reproducible local proof

Run the static contract:

```sh
npm run test:capacity-overload-contract
```

Run the Postgres-backed lane with an already available `DATABASE_URL`:

```sh
npm run test:capacity-overload
```

Or use the isolated repo-local database lane:

```sh
npm run test:capacity-overload:local
```

Run explicit search characterization separately from the regression lane. This mode has no
invented latency pass threshold; it records the first application request, five immediate warm
repetitions, and the analyzed production SQL plan for 100%, 10%, and 1% matching terms:

```sh
npm run characterize:public-search -- --search-documents 100000 \
  --output target/public-search-characterization/100000.json
npm run characterize:public-search -- --search-documents 1000000 \
  --output target/public-search-characterization/1000000.json
```

“Cold” here means the first application request for that query/filter after fixture installation.
The proof deliberately does not flush PostgreSQL shared buffers or the host page cache, so it does
not claim storage-device cold-start evidence.

The lane writes `target/capacity-overload/report.json` and proves six related cases:

1. **Large-thread cold load:** 10,000 projected posts, latest and older keyset pages, bounded
   response size, local p95 budget, and an `EXPLAIN ANALYZE` assertion on the paging index and
   rows examined.
2. **Anonymous crawler pressure:** 1,000 board rows, 100,000 typed search documents split across
   discussions, profiles, and games, and 80 concurrent board/search requests with bounded response
   sizes and no non-200 responses. Search latency is recorded both in aggregate and per filter.
   `EXPLAIN ANALYZE` captures the planner's chosen access path, matched/examined rows, and bounded
   returned page for 100%, 10%, and 1% term selectivity plus every typed filter at 1%. This makes
   the sequential-scan/GIN crossover explicit; the structural plan contract separately proves that
   the exact production statement can reach the partial GIN index.
3. **One-game post burst:** 24 posts concurrently target one real game aggregate; every command
   eventually ACKs, and exactly 24 distinct posts appear in its projection.
4. **Slow live consumers:** four live clients are delayed behind a two-message broadcast buffer;
   every client receives `ResyncRequired`, while a fifth WebSocket handshake receives retryable
   `503`.
5. **Global HTTP saturation:** eight admitted requests are held on a database lock; the ninth gets
   retryable `503`, `/healthz` remains `200`, and admitted requests recover after lock release.
6. **Caller rate limiting:** two failed credential attempts are followed by `429` with
   `Retry-After`, demonstrating that caller pressure remains distinct from global saturation.

The latency thresholds are intentionally generous regression tripwires for a developer machine.
They do not establish production SLOs, maximum users, Railway sizing, or internet-path behavior.
Hosted SLOs must be set from captured staging traffic and resource telemetry.

The initial staging contract is source-controlled in
`docs/ops/public-search-staging-slo.json`: successful search p95 must remain at or below 750 ms
over a 15-minute window with at least 20 samples, and seven-day route availability must be at
least 99%. That latency objective assumes no more than 100,000 public search documents and requires
fresh characterization before the corpus crosses the bound. The 2026-08-25 local characterization
kept the 100,000-document common-term first/warm path near 117/110 ms, while the same path at one
million documents reached about 1.63/1.60 seconds. Selective 1% queries remained below 41 ms at one
million. All analyzed cases retained the partial GIN index; the million-document plan introduced
parallel execution, so plan accounting multiplies `Actual Rows` by `Actual Loops`.

Evaluate that contract against the currently deployed, exact-commit Railway staging API with:

```sh
npm run evaluate:public-search-staging-slo
```

The evaluator reads Railway application and HTTP logs but writes only deployment attribution and
bounded aggregates to `target/public-search-staging-slo/receipt.json`. It never persists raw log
rows, request identifiers, addresses, user agents, or query material. A failing objective or
attribution mismatch exits 1. A fresh deployment, less than 20 successful search samples, no route
traffic, or less than a complete seven-day availability window exits 2 with status `insufficient`;
use `-- --allow-insufficient` only when recording that state is the intended result. The hermetic
parser and receipt contract are covered by `npm run test:public-search-staging-slo`; live Railway
access is deliberately outside the local proof lane.

Prefix/fuzzy matching and multilingual stemming remain deferred. There is no observed product need
yet, and both can broaden the candidate set on the same dimension that dominates common-term cost.
They should be introduced only with corpus-backed relevance cases and a new characterization matrix,
not speculatively as search syntax.

`/healthz` is dependency-free process liveness and bypasses admission. `/readyz`
is admitted work and returns `200` only while the complete migration set and
the configured object store are reachable; database, storage, or global
admission failure makes it `503`. Railway deployment admission and release
promotion use readiness, not liveness.
