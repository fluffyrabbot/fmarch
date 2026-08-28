# Proof product freeze (D6)

Local proof lanes, artifacts, and diagnostics are **developer harness**, not a
product surface. Hosted readiness is gated only by real externally captured
packets and release evidence—not by growing more local admin-proof metadata.

This freeze is the bounded Wave 3 cut for operator/proof-graph sprawl. It keeps
truthful proof lanes while removing aliases and local-only product-shaped
surfaces that do not change a release decision.

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

## Retired aliases

The former `hosted-identity-partial-admin-proof` and
`hosted-identity-complete-admin-proof` npm scripts and entry modules are
removed. The progression, evidence, and operator commands are the only named
interfaces for those distinct predicates.

See [human-run-test-games](human-run-test-games.md) for the hosted-identity
command set.
