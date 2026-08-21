# 15 — 1.0 governance and release substrate

## Decision

fmarch 1.0 is a public, operator-owned service rather than a local proof bundle.
The release boundary therefore includes product behavior, data stewardship,
accessibility, security policy, and a hosted topology that can exercise the
failure modes claimed by the release evidence.

## Hosted topology

The 1.0 staging and production topology is:

- at least two interchangeable API replicas;
- one separately executed, fail-fast migration command per deployment;
- shared S3-compatible object storage for canonical media and variants;
- one isolated Postgres database and one isolated object-storage bucket per
  environment;
- one frontend service that can reach either API replica through the platform
  service endpoint;
- deployment metadata that attributes every application service to the same
  commit.

API startup verifies the schema and storage configuration but does not race to
apply migrations. Local development may keep the filesystem media backend and
the combined migrate-and-run convenience command. Neither local convenience is
the hosted 1.0 topology.

This is the smallest topology that can truthfully close the existing
multi-node race, reconnect, observability, and recovery gates. A single API
replica with a mounted local volume remains a bootstrap aid, not a release
candidate.

## Member data lifecycle

Before 1.0, fmarch must publish and implement one coherent lifecycle for an
account and the data attached to it:

- account deactivation immediately revokes authentication methods and sessions;
- credentials, recovery material, delivery destinations, and nonessential
  profile identifiers can be erased without rewriting game history;
- durable public authorship is pseudonymized when retention is required for a
  coherent discussion or completed-game record;
- private content, moderation evidence, audit facts, and backups have declared
  retention and access policies;
- a member can export the personal/account data the service associates with
  them, distinct from a host's completed-game export;
- legal/policy copy records the operator, purposes, retention, user choices,
  acceptable use, moderation process, and support route.

The event log remains append-only. Erasure is represented by typed lifecycle
facts plus projection redaction/pseudonymization; it is never an ad-hoc delete
that makes replay diverge.

### Wave 3 pure substrate (D10)

Typed ownership lives in `crates/identity/src/data_lifecycle.rs` as a pure
decide surface (no HTTP, SQL, or migrations in this wave). Statuses are
`Active`, `Deactivated`, `ErasureInProgress`, and `Erased`. Commands are
`Deactivate { reason }` and `RequestErasure`. Deactivation is the required
gate before erasure; re-deactivating an already-deactivated member is an
idempotent no-op.

#### Fact kinds

| Kind | When |
|---|---|
| `MemberDeactivated` | Active member deactivates (methods/sessions revoked by later handlers) |
| `MemberErasureRequested` | Deactivated member requests erasure; status → `ErasureInProgress` |
| `MemberCredentialsErased` | Credential/recovery/delivery secrets wiped (co-emitted on clean deactivation path) |
| `MemberAuthorshipPseudonymized` | Projection rebuild replaced durable public authorship identifiers |
| `MemberPersonalExportRecorded` | A personal/account export package was produced for the subject |

`MemberPersonalExportRecorded` is **not** a host completed-game export. Personal
export is subject-scoped account data under `ExportableToSubject`; completed-game
export remains a host/game capability and does not satisfy the member export
obligation.

#### Ownership matrix (`disposition(DataClass)`)

| Data class | Disposition |
|---|---|
| `Credentials` | `Erase` |
| `RecoveryMaterial` | `Erase` |
| `DeliveryDestination` | `Erase` |
| `NonessentialProfileIdentifier` | `Erase` |
| `PublicAuthorship` | `RetainPseudonymize` |
| `PrivateContent` | `RetainRestricted` |
| `ModerationEvidence` | `RetainRestricted` |
| `PersonalExportBundle` | `ExportableToSubject` |
| `AuditFacts` | `OperatorOnly` |
| `BackupCopy` | `OperatorOnly` |

Decide transitions (Wave 3):

- `Active` + `Deactivate` → `MemberDeactivated`
- `Deactivated` + `Deactivate` → empty ok (idempotent)
- `Active` + `RequestErasure` → reject (`MustDeactivateFirst`)
- `Deactivated` + `RequestErasure` → `MemberErasureRequested` + `MemberCredentialsErased`
- `ErasureInProgress` / `Erased` + any command → reject

Later waves own HTTP controls, migrations, projection rebuild/pseudonymization,
personal-export assembly, and browser proof. This section does not mark
`product.identity.data-lifecycle` complete.

The implementation-aligned, deliberately unapproved policy draft lives in
[`../policy-drafts/member-data-lifecycle.md`](../policy-drafts/member-data-lifecycle.md).
It must not be published or used as approval evidence until the operator fills
the named ownership and retention decisions.

## Accessibility release boundary

Static semantics and synthetic browser checks are necessary but insufficient.
The release packet must retain a human keyboard and screen-reader pass over:

- registration, login, recovery, and account security;
- public discussion and game publication;
- player posting, voting, private navigation, and action submission;
- host setup, the host task queue, confirmations, and recovery;
- moderation, inbox, mute controls, and error/degraded states.

The pass records browser, operating system, assistive technology, viewport,
issues, fixes, and rerun result. Critical flows must work without pointer-only
interaction or visual-only state.

## Security release boundary

The existing capability and encrypted-event model remains governing. The local
1.0 baseline enforces:

- a per-response nonce Content Security Policy for executable frontend content,
  with no `unsafe-inline` or `unsafe-eval`; SvelteKit's fixed accessibility
  announcer style is the sole inline-style exception and is authorized by its
  exact hash;
- an environment-isolated custody, version-marker, rotation, deployment, and
  retirement contract for auth-source signing, event encryption, the
  profile-handle blind index, object-store, and WorkOS credentials in
  `docs/ops/release-secret-custody.json`;
- lockfile-enforced builds and digest-pinned OCI base images carrying source
  provenance labels;
- source checks that reject concrete identity, raw error, and request-path
  logging, plus canary proof that operator evidence recursively redacts tokens,
  credentials, personal data, and signed URLs.

These are source-controlled and local-browser guarantees. Third-party security
assessment, hosted telemetry retention evidence, incident-response rehearsal,
and production promotion remain independent release gates.

## Maintainability boundary

Pre-1.0 is the last cheap point to cut concentrated modules into coherent
owners. Refactoring is complete when the pack model/validation, resolver
families, API route families, projection families, and command integration
scenarios are addressable as bounded modules without changing their public
contracts or weakening their existing proof lanes. The same boundary owns a
pinned Rust toolchain and warning-clean workspace Clippy gate.

This is not a line-count aesthetic. It makes the 1.0 event, pack, and wire
contracts reviewable and limits the blast radius of later changes.

The current responsibility inventory, strict lint-debt register, and extraction
order live in [16-maintainable-core](16-maintainable-core.md).
