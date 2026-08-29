# Admin-proof inventory and retirement boundary

The `*-admin-proof` commands are developer harness interfaces. They are not
product capabilities and cannot establish hosted or release readiness. This
inventory records which commands own a distinct predicate, which entrypoints
are implementation wrappers, and which local meta-proof family should retire
as one coordinated deletion.

## Retain: distinct predicates

These commands directly exercise a product, operator, or release boundary and
remain named interfaces:

- core loop, hardening, host setup, identity, backup/restore, ops, race
  coverage, seed, and release-runbook admin proofs;
- hosted target preflight, hosted evidence intake (blocked, operator fixture,
  and real capture), hosted identity evidence/operator, hosted concurrent race,
  and real-hosted observability handoff proofs;
- release admin proof and its static contract;
- the hosted evidence operator-checklist proof.

Fixture-backed commands in this group prove only rendering and packet-contract
behavior. Their artifact metadata must continue to say that they are local and
must never promote a hosted gate.

## Merged now: forwarding entrypoint

`dev_test_game_hosted_identity_progression_admin_proof.mjs` was a twelve-line
forwarder into the evidence admin-proof owner. The npm command now invokes that
owner with `--progression`; the environment/argument contract and generated
artifact paths are unchanged. The batch command remains because it owns an
ordered six-progression plan and artifact inventory rather than forwarding one
call.

## Retire together: local meta-proof UI family

The following commands describe or render other local proof artifacts rather
than an independently releasable system predicate:

- spine-manifest admin proof;
- admin-spine admin proof;
- proof-graph admin proof;
- proof-freshness admin proof;
- next-action admin proof;
- selected-operator-handoff receipt admin proof.

They currently form one coupled family across the admin route registry,
readiness artifact loader, proof graph, next-action selection, terminal receipt
contracts, fixtures, and documentation. Removing only their npm wrappers would
leave dead artifact consumers and a misleading admin product surface. Retire
the family atomically by deleting those admin audit rows and readiness inputs,
then preserve any still-useful CLI-only diagnostics behind one local proof
report with no role-surface adapter.

### Retirement gate status

The 2026-08-28 review found that this gate is **not yet met**. The canonical
`spine-manifest`, `admin-spine`, `proof-graph`, `next-action`, and selected
handoff receipt diagnostics exist, but the admin-spine and release-readiness
orchestrators still consume the six role-surface artifacts as sequencing and
freshness dependencies. Proof freshness also has no consolidated CLI report
owner independent of the admin adapter. Deleting the wrappers now would either
break the canonical local spine or silently weaken it.

The next retirement slice must first introduce one CLI-only local proof report
that owns freshness, graph, next-action, and selected-handoff validation; move
admin-spine and release-readiness dependencies to that report; and prove output
parity. Only then should the six admin audit rows, adapter modules, paths,
fixtures, scripts, and documentation be deleted in one commit.

## Freeze rule

No new admin-proof command is allowed unless it consumes operator-provided,
non-fixture evidence and changes a named hosted/release decision. A retained
command may be touched, but that edit re-arms its proof lane; frozen means it
leaves the sprint default, not that it disappears or becomes immutable.
