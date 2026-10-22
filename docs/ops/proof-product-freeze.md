# Proof product freeze

Local proof lanes, artifacts, and diagnostics are **developer harness**, not a
product surface. The `*-admin-proof` commands are harness interfaces: they are
not product capabilities and cannot establish hosted or release readiness.
Hosted readiness is gated only by real externally captured packets and release
evidence, not by growing more local admin-proof metadata.

## Ban list

Do **not**:

- Add new admin UI for local-only proof metadata unless that surface gates a
  **real hosted packet** (operator-provided path outside `tools/fixtures/`, with
  capture/redaction contracts that can advance hosted readiness).
- Add a new admin-proof command unless it consumes operator-provided,
  non-fixture evidence and changes a named hosted or release decision. In
  particular, no `*-admin-proof` npm script may only re-export or thin-wrap
  another admin-proof entrypoint.
- Grow `tools/dev_test_game.mjs` further without first extracting artifact
  assembly (and related CLI/orchestration boundaries recorded in
  [16-maintainable-core](../arch/16-maintainable-core.md)).
- Treat `target/dev-test-game/*-admin-proof.json` (or sibling local proof JSON)
  as product completion, release readiness, or production readiness.

A retained command may be edited; the edit re-arms its proof lane. Frozen means
it leaves the sprint default, not that it disappears or becomes immutable.

## Retained: distinct predicates

These commands directly exercise a product, operator, or release boundary and
remain named interfaces:

- core loop, hardening, host setup, identity, backup/restore, ops, race
  coverage, seed, and release-runbook admin proofs;
- hosted target preflight, hosted evidence intake (blocked, operator fixture,
  and real capture), hosted identity progression/evidence/operator, hosted
  concurrent race, and real-hosted observability handoff proofs;
- release admin proof and its static contract;
- the hosted evidence operator-checklist proof.

Fixture-backed commands in this group prove only rendering and packet-contract
behavior. Their artifact metadata must say they are local and must never
promote a hosted gate. The hosted-identity progression command invokes the
evidence owner with `--progression`; the batch command remains because it owns
an ordered six-progression plan and artifact inventory. See
[human-run-test-games](human-run-test-games.md) for the hosted-identity command
set.

## Retire together: local meta-proof UI family

These commands describe or render other local proof artifacts rather than an
independently releasable system predicate:

- spine-manifest admin proof;
- admin-spine admin proof;
- proof-graph admin proof;
- proof-freshness admin proof;
- next-action admin proof;
- selected-operator-handoff receipt admin proof.

They form one coupled family across the admin route registry, readiness artifact
loader, proof graph, next-action selection, terminal receipt contracts,
fixtures, and documentation. The admin-spine and release-readiness
orchestrators still consume the six role-surface artifacts as sequencing and
freshness dependencies, and proof freshness has no CLI report owner independent
of the admin adapter, so deleting the wrappers alone would break or silently
weaken the local spine.

Retirement is one slice: introduce a single CLI-only local proof report that
owns freshness, graph, next-action, and selected-handoff validation; move the
admin-spine and release-readiness dependencies to it and prove output parity;
then delete the six admin audit rows, adapter modules, paths, fixtures, scripts,
and documentation in one commit.
