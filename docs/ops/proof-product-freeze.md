# Proof product freeze (D6)

Local proof lanes, artifacts, and diagnostics are **developer harness**, not a
product surface. Hosted readiness is gated only by real externally captured
packets and release evidence—not by growing more local admin-proof metadata.

This freeze is the bounded Wave 3 cut for operator/proof-graph sprawl. It does
not remove existing proof lanes or scripts; it stops productizing them further.

## Ban list

Do **not**:

- Add new admin UI for local-only proof metadata unless that surface gates a
  **real hosted packet** (operator-provided path outside `tools/fixtures/`, with
  capture/redaction contracts that can advance hosted readiness).
- Add new `*-admin-proof` npm scripts that only re-export or thin-wrap another
  admin-proof entrypoint (alias scripts for partial/complete ladders, etc.).
- Grow `tools/dev_test_game.mjs` further without first extracting artifact
  assembly (and related CLI/orchestration boundaries recorded in
  [16-maintainable-core](../arch/16-maintainable-core.md)).
- Treat `target/dev-test-game/*-admin-proof.json` (or sibling local proof JSON)
  as product completion, release readiness, or production readiness.

## Allow list

Still allowed and expected:

- Hosted packet validators and real-capture intake contracts.
- Proof lanes that exercise gameplay, identity, ops, and release diagnostics.
- Local diagnostics, spine/graph/next-action tooling, and seeded admin role
  proofs that remain explicitly local predicates.

## Concrete collapse (aliases)

These npm scripts and entry modules remain for existing callers but are
**deprecated aliases**—prefer the evidence and operator commands:

| Deprecated | Prefer |
|---|---|
| `test:dev-test-game-hosted-identity-partial-admin-proof` | progression / evidence admin-proof family (`test:dev-test-game-hosted-identity-progression-admin-proof` or `test:dev-test-game-hosted-identity-evidence-admin-proof`) |
| `test:dev-test-game-hosted-identity-complete-admin-proof` | `test:dev-test-game-hosted-identity-evidence-admin-proof` (full redacted packet) / `test:dev-test-game-hosted-identity-operator-admin-proof` for the operator predicate |

See [human-run-test-games](human-run-test-games.md) for the hosted-identity
command set.
