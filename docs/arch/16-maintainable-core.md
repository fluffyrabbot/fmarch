# 16 — Maintainable core boundary

## Decision

The 1.0 core is organized by ownership and dependency direction, not by file
size alone. A module should own one stable design decision, expose the smallest
contract needed by its callers, and depend inward on domain types rather than
outward on HTTP, SQL, fixture, or orchestration details.

This workspace is greenfield. Internal compatibility facades are not a goal:
extract the superior boundary directly, repair callers in the same atomic
change, and retain the public event, pack, wire, and HTTP contracts only when
those contracts are still intentional.

## Mechanical baseline

- `rust-toolchain.toml` pins Rust 1.95.0 with `clippy` and `rustfmt`.
- `cargo clippy --workspace --all-targets --all-features -- -D warnings` is
  warning-clean.
- Every crate area and the workspace-manifest area in
  `docs/ops/proof-lane-manifest.json` arms `cargo:clippy-workspace`.
- `tools/proof_lane_select.test.mjs` protects the lane command, toolchain path,
  and per-crate coverage from manifest drift.
- Exact `#[expect(...)]` annotations are an explicit refactor queue. Broad
  module- or workspace-level lint allowances are not permitted.

## Responsibility inventory

The line counts below are a 2026-08-06 orientation snapshot, not a target.

| Surface | Current concentration | Superior ownership boundary | Dependency direction | Next extraction |
|---|---|---|---|---|
| `crates/domain/src/pack.rs` façade; `pack/model.rs` (~1.9k); `pack/validation.rs` (~8.5k) | Closed first-level boundary: serialized schema/defaults are separate from loading, derived indexes, diagnostics, and ordering | `pack/model` owns declarative types; `pack/validation` owns `PackValidationContext` and validation behavior; `validation_tests` owns private contract tests | validation → model; resolver/commands → public pack façade | Split validation families only when their next independent change requires it; do not re-complect model ownership |
| `crates/domain/src/resolver.rs` (~7.4k); `resolver/intake.rs` (~0.7k); `resolver/action.rs` (~1.0k); `resolver/trigger.rs` (~0.4k); `resolver/outcome.rs` (~1.4k); `resolver/redirect.rs` (~0.3k); `resolver/trace.rs` (~0.8k) | Night-action intake, redirect graph planning/target rewriting, kill/protection, trigger-fixpoint, duel/day-vote outcome, and exhaustive trace construction are closed behind typed boundaries; block/empower suppression and broad phase orchestration remain concentrated | Resolver coordinator plus bounded intake, redirect, action, trigger, outcome, and trace families | intake → domain state/validated pack; redirect, action, and trigger → intake-owned action; redirect → validated pack/trace contract; trace → event contract; outcome → action/trigger/domain state/validated pack; coordinator → bounded families | Extract block suppression and empower discovery as the next coherent resolver owner; do not reopen redirect or intake ownership |
| `crates/api/src/lib.rs` (~0.6k); `command_http.rs` (~0.5k); `game_http.rs` (~2.6k); `community_http.rs` (~1.4k); `auth_http.rs` (~3.9k); `authentication.rs` (~0.7k); `identity_delivery.rs` (~1.0k); `live_projection.rs` (~0.2k); `live_delivery.rs` (~0.9k) | Media, auth, community, game-read, command/import, and live-delivery HTTP plus authentication attempt/delivery, provider-neutral identity-delivery lifecycle records, and live publication are closed behind typed boundaries | Thin composition root plus route-family modules with typed request contexts and a provider-neutral identity-delivery worker with typed lifecycle records | route families → application/domain ports; composition root → route families; authentication → identity-delivery ports; identity-delivery lifecycle records → worker transaction; command transport → command application port/live-publication port | Split the next API family only when an independent change exposes a coherent ownership boundary; do not reopen lifecycle records |
| `crates/media/src/variants.rs` (~2.3k) | Variant generation, immutable persistence, snapshot verification, repair, lookup, and descriptor-relative reads are coherent; each attached read receives one immutable request that owns its already-open file | Variant store plus an immutable attached-read request that keeps the descriptor and verification identity together | variant store → attached-read primitive → descriptor-relative filesystem checks | Split the next media responsibility only when an independent change exposes a coherent boundary; do not reopen the attached-read request |
| `crates/projections/src/lib.rs` (~8.2k); `effect_projection.rs` (~0.3k); `private_channel_projection.rs` (~0.3k) | Effect and encrypted private-channel folding, reads, mutations, and rebuild hooks are closed behind typed family boundaries; dispatcher plus unrelated game, community, identity, media-reference, and scheduler projections remain concentrated | Projection dispatcher plus one module per projection family and shared SQL/encryption primitives | family projectors → shared transaction/encryption primitives; dispatcher → families | Split the next family only when it has an independent change |
| `crates/commands/src/lib.rs` (~5.1k); `action_submission.rs` (~0.7k); `host_prompt_resolution.rs` (~1.0k including focused tests); `day_runtime.rs` (~1.1k) | Action submission/admission/capacity, host-prompt resolution/replay, and DayEvent resolution application are closed behind typed request boundaries; command dispatch, shared admission/transaction/persistence, and phase lifecycle remain concentrated | Thin command transaction/dispatch owner plus bounded action, prompt, and day-runtime families | bounded families → shared command admission/persistence ports + projections/domain; dispatch → bounded families | Split broader command ownership only when its next independent change exposes a coherent boundary; do not reopen the DayEvent request |
| `crates/operator_proof/src/lib.rs` (~6.1k); proof binaries under `src/bin/`; focused boundary test | Operator report contracts, artifact classification, manifest loading, and local proof executables are no longer production command ownership | Dedicated operator-proof library and executable package | operator-proof → public command/projection APIs; operator API → operator-proof report contracts; commands may use it only as a test dependency | Separate the fixture minimizer core from CLI I/O and keep generated matrices out of the ordinary command gate |
| `crates/commands/tests/pipeline/residual_cases.rs` (~13.9k); `semantic_audit/cases.rs` (~49.2k); source-shared `residual_support.rs` (~8.7k) | Ordinary Postgres scenarios and the full semantic/generated corpus are physically separate; only harness support is shared | Ordinary pipeline target, dedicated semantic-audit target, serial concurrency target, and one shared support owner | scenario/audit targets → shared harness/public command API; never scenario ↔ scenario | Split support by coherent fixture family only when independent change pressure appears; keep audit cases out of ordinary compilation and path arming |
| `tools/dev_test_game.mjs` / `.test.mjs` (~26.9k/~29.9k); `dev_test_game_configuration.mjs` (~0.3k); `dev_test_game_session_artifacts.mjs` (~0.7k) | Immutable CLI/environment/default/path normalization and session JSON/Markdown/stdout/proof-input assembly are closed behind dedicated owners; mutable process, network, browser, scenario, and assertion orchestration remains concentrated in the root | Small CLI/composition root over configuration, scenario, runtime, artifact, and assertion libraries | configuration → path contracts; artifacts → normalized values only; CLI root → configuration/artifacts/orchestration; assertions remain in the root | Split another scenario/runtime family only when its next independent change requires it; do not return configuration, path, or representation assembly to the root |

## First closed boundary: API media HTTP

`crates/api/src/media_http.rs` now owns upload and projected-reference media
routes, admission, content inspection, quota reservation/release, immutable
asset response headers, and the public upload response types. The API
composition root merges that route family and re-exports the response types;
command-side media-reference normalization remains with command preparation.

This is an ownership improvement rather than a file move: HTTP media concerns
no longer share a module with authentication, community, game command, and
live-publication orchestration.

## Closed API boundary: authentication attempt and delivery orchestration

`crates/api/src/authentication.rs` owns credential-attempt scope persistence,
rate-limit auditing, and delivery-intent creation, cancellation, and audit rows.
`AuthAttemptAudit`, `AuthCredentialDeliveryRequest`, and `AuthDeliveryAudit`
collapse the former high-arity helpers without changing SQL, JSON audit keys,
status codes, or transaction boundaries. `identity_delivery.rs` remains the
provider-neutral worker/adapter boundary; `auth_http.rs` consumes both through
its typed HTTP state.

## Closed API boundary: auth, account, and session HTTP

`crates/api/src/auth_http.rs` owns the auth router fragment, request/response
DTOs, account registration/login/recovery and method lifecycle, session
issue/rotate/logout/revoke behavior, invites, credential-delivery retry, and
HTTP-focused authentication helpers. `AuthHttpState` is the bounded dependency
set for those handlers: pool, attempt policy, delivery gateway, password
admission, verifier, session policy, and ticket issuance configuration.

The API composition root owns one `AuthHttpState`, mounts the route family as a
unit, and delegates its public test/configuration builders. WebSocket ticket
creation and connection-session orchestration live in `live_delivery.rs`; they
consume only the narrow authentication helpers and typed auth state. The
boundary contract prevents auth handlers and DTOs from returning to the root,
persistence from leaving `authentication.rs`, provider execution from leaving
`identity_delivery.rs`, or WebSocket sessions from drifting into the HTTP
family. Public URLs, JSON, status codes, transaction and audit behavior, rate
limits, bearer semantics, and session revocation remain unchanged.

## Closed API boundary: live projection publication

`crates/api/src/live_projection.rs` owns the bounded broadcast publisher,
vote-count snapshot loading, changed/cleared delta construction, dirty-surface
publication record, subscription, and receiver lag/closure translation.
`LiveProjectionChangeSet` is the typed command-to-publication handoff and
`LiveProjectionPublisher` is the sole channel owner. The command HTTP boundary
keeps command authorization and adaptation; live delivery owns WebSocket
authentication, durable cross-instance polling, and audience-specific thread,
host, prompt, and private hydration.

The boundary preserves subscribe-before-hydrate ordering, current-delta-before-
clear ordering, empty-clean suppression, channel bounds, lag-triggered resync,
delivery delay, and scoped private refreshes. Unit tests cover publication
assembly and lag continuation; the source boundary contract prevents those
responsibilities or their removed high-arity lint expectation from drifting
back into `lib.rs`.

## Closed API boundary: live WebSocket delivery

`crates/api/src/live_delivery.rs` owns ticket request/response handling, ticket
persistence and redemption, connection and per-principal admission,
authenticated session rechecks, subscribe-before-hydrate startup, durable
cross-instance event wake (`EventWake` / `NotifyEventWake` over a process-wide
LISTEN plus `PollEventWake` fallback), lag/resync handling,
audience-scoped snapshot assembly, binary-CBOR frame emission, and the `/ws`
plus `/auth/websocket-tickets` routes behind `LiveDeliveryState`. It consumes
only narrow auth helpers, game-read adapters, and
`LiveProjectionPublisher`/`Receive` contracts.

The composition root mounts the delivery family as one router fragment and
re-exports `WebsocketTicketResponse`. Command submission/preparation,
completed-game import, auth persistence, game/community/media HTTP, and live
change classification/publication remain outside. Ticket TTL/audience/single-use
/session binding, capacity limits, initial ordering, private filtering, lag
continuation, LISTEN/NOTIFY wakeup with `events.seq` catch-up, envelope IDs,
protocol version, and disconnect behavior remain unchanged.

## Closed API boundary: public community HTTP

`crates/api/src/community_http.rs` owns the public search, personalized inbox,
subscriptions, member mutes, discussion, moderation, and profile route family.
Its request/query DTOs, cursor and target decoders, community admission,
capability checks, response adaptation, validation, and projection-error
mapping live behind `CommunityHttpState`, whose dependency set is only the
Postgres pool and the configured authentication boundary.

The composition root mounts the route family as one fragment. It retains game
transport, commands, live delivery, auth/account/session persistence, media,
and admin game bootstrap. The public game thread consumes one narrow
optional-community-viewer helper so personalized post filtering has a single
bearer/admission rule without pulling the game route into the community owner.
The source contract prevents community handlers and DTOs from returning to the
root, direct SQL persistence from entering the HTTP module, or unrelated
transport from drifting across the boundary. URLs, methods, JSON shapes,
cursor encodings, status codes, moderation limits, visibility rules,
transactions, timestamps, and personalized filtering remain unchanged.

## Closed API boundary: game reads

`crates/api/src/game_http.rs` owns public and operator game discovery, public
threads, vote and endgame reads, completed exports, channel threads, player
notifications/investigations/command state, and host phase, prompt, console,
and setup reads. `GameHttpState` carries only the configured authentication
boundary and pool. Request/query DTOs, public response types, cursor parsing,
capability admission, pack/program adaptation, host task selection, and
projection-to-wire response assembly stay with that owner.

The composition root mounts the read family as one router fragment and
re-exports the established public Rust response API. Command submission and
preparation, completed-game import writes, WebSocket connection/resync
orchestration (`live_delivery.rs`), and live publication remain outside.
WebSocket hydration and private media authorization consume explicit pool-based
adapters for vote counts, thread access/data, host console authority/state, and
player-private reads; neither consumer receives `GameHttpState` or duplicates
the REST rules.
The source boundary contract protects those dependency directions. URLs,
methods, JSON and wire shapes, ordering, cursor semantics, visibility rules,
capability decisions, export contents, and audience filters remain unchanged.

## Closed API boundary: command submission and completed-game import

`crates/api/src/command_http.rs` owns `/commands` and `/games/import`, wire
command preparation, media-reference normalization, authenticated principal
resolution, global-admin admission for game creation and import, protocol and
application reject mapping, command-to-game routing, and live dirty-surface
classification. `CommandHttpState` carries only the pool, typed auth boundary,
media repository, variant limits, and live-publication port.

The composition root mounts the family as one router fragment. Command
decisioning and idempotent persistence remain in `commands::handle_idempotent`;
live update assembly and broadcast remain in `live_projection.rs`; game-read,
community, media, auth, and live-delivery transport remain in their existing
owners. The game-read owner consumes only the shared command-reject adapter for
its admin bootstrap path. The source boundary contract protects those
directions and forbids persistence SQL or lint suppression in the transport
owner. URLs, wire DTOs, protocol version, reject codes, idempotency, media
normalization, import authorization, dirty-surface classification, and publish
semantics remain unchanged.

## Closed command boundary: action submission and validation

`crates/commands/src/action_submission.rs` owns `SubmitAction` orchestration,
typed submission/validation/capacity contexts, action-template and item/grant
selection, phase/window/target and role-policy admission, counter/cooldown/ITA
checks, active-action capacity, instant-resolution event construction, and the
active-submission stream fold used by player command-state reads.

The command root constructs one `ActionSubmissionRequest`, remains the sole
top-level command dispatcher and transaction/idempotency coordinator, and owns
the shared `persist` append-and-project boundary consumed by the action owner.
Projection reads stay behind existing public projection ports; no SQL or generic
persistence moved into the bounded module. The source boundary contract removes
the three superseded argument-count expectations and prevents submission policy
from drifting back into `lib.rs`. Reject variants, capability and phase
admission, target ordering, grant/counter semantics, event JSON, instant result
and trace envelopes, transaction boundaries, and active-action views remain
unchanged.

## Closed command boundary: host-prompt resolution and replay

`crates/commands/src/host_prompt_resolution.rs` owns the admitted prompt
operation: pending-prompt lookup, pack-declared decision/effect selection,
typed public-resolution derivation, PK result/trace construction, prompt-driven
phase-advance adaptation, and deterministic reconstruction of stored
host-prompt resolution envelopes. `HostPromptResolutionRequest` and
`HostPromptResolutionContext` are the single dispatch handoff;
`PkResolutionContext` replaces the former eight positional reconstruction
arguments.

The command root remains the sole top-level dispatcher and owns game/capability
admission, transaction/idempotency orchestration, and the shared `persist`
append-and-project port consumed by the prompt owner. The replay audit delegates
only host-prompt reconstruction and keeps ordinary phase replay plus report
assembly in the root. The source boundary contract prevents prompt policy,
lookup, result/trace construction, or phase-event adaptation from drifting back,
and prevents capability resolution, SQL, or generic persistence from moving
outward. Prompt reject variants, policy matching, public-resolution equality,
event order, run identifiers, JSON envelopes, timestamps, and replay behavior
remain unchanged.

## Closed projection boundaries: effects and private channels

`crates/projections/src/effect_projection.rs` owns persistent role and engine
effect folding, effect clearing, player-facing effect notifications, the typed
effect input and public row, deterministic reads, SQL upsert/delete semantics,
and its rebuild/audit table declaration. Top-level effect events and
resolution-wrapped inner events enter the same family projector, preserving
their distinct event-index rules and the existing projection order.

`crates/projections/src/private_channel_projection.rs` owns declared, granted,
member-revoked, and channel-revoked membership folding; payload decoding; the
typed encrypted row/input records; sealed SQL writes; deterministic decrypted
reads; and encrypted snapshot identity/redaction hooks. It consumes the shared
slot, encryption, transaction, and audit primitives without exposing private
fields to the composition root.

The root remains the sole event dispatcher and rebuild/snapshot orchestrator,
and re-exports both public reader contracts. The family boundary contract
prevents row types, mutation helpers, decoders, readers, or audit metadata from
drifting back into `lib.rs`, and forbids wildcard imports or local lint
suppression. Event order, visibility, conflict behavior, ciphertext context,
rebuild hashes, and public projection APIs remain unchanged.

## Closed domain boundary: pack model and validation

`crates/domain/src/pack.rs` is now the public façade over two inward-facing
owners. `pack/model.rs` contains the serialized schema and defaults;
`pack/validation.rs` contains decoding, diagnostics, derived ordering, and a
single `PackValidationContext` that computes cross-reference indexes once per
validation pass. Action, target-lynch, and vote-policy validators consume that
context instead of independent high-arity parameter lists.

The private IR-version mapping tests live in the test-only
`pack/validation_tests.rs` sibling. No pack-specific Clippy expectation remains.
Public pack exports, JSON fields/defaults, validation diagnostics, and golden
semantics remain unchanged.

## Closed resolver boundary: night-action preparation

`crates/domain/src/resolver/intake.rs` is the single owner of the resolved
`Action` representation, submission/template collection, compulsory-action
emission, faction coordination, generic action constraints, counter and
cooldown events, history-sensitive recording, and stable per-ability ordering.
`resolve_night` constructs one immutable `NightActionPreparationInput` and
receives one owned `NightActionPreparationOutput`; the action and trigger
families import the intake-owned action directly rather than through a resolver
root re-export.

The output carries a `NightActionHistory` recording capability so history is
still owned by intake but evaluated at the established late-resolution point,
after redirect target rewrites. This preserves post-redirect target recording,
suppression status, and event order without leaking history predicates back
into the coordinator. The resolver boundary contract fixes the direct
construction site, dependency direction, moved ownership markers, and absence
of local lint suppression. Submission traversal, faction-vote selection,
constraint short-circuiting and reasons, counter identifiers, stage ordering,
seeded determinism, and generated goldens remain unchanged.

## Closed resolver boundary: redirect resolution

`crates/domain/src/resolver/redirect.rs` is the single owner of redirect target-
space derivation, stable rule construction, per-target bounded application,
redirect trace edges, empowered bypass decisions, loop-cap notes, and live target
mutation. `resolve_night` constructs one `RedirectResolutionContext` at the
`IrAbility::Redirect` stage after the existing block/empower discovery and
supplies the prepared actions, validated pack, empowered slots, and trace sinks.
The redirect owner imports the intake-owned `Action` directly; no resolver-root
re-export or forwarding façade exists.

Each redirect action still forms one group that can apply at most once to a
target. Ability priority and submission order, first-seen pull target space,
swap/rotate/retarget/pull construction, graph and application caps, empowered
bypass timing, exact decision/edge/note JSON, post-redirect history and visit
behavior, seeded determinism, and generated goldens remain unchanged. The
source-boundary contract fixes the typed dependency surface, single coordinator
construction/call site, moved implementation markers, and absence of local lint
suppression.

## Closed resolver boundary: trigger fixpoint

`crates/domain/src/resolver/trigger.rs` is the single owner of trigger
observation matching, ordered night-frontier collection, generated trigger
events and kill decisions, fixpoint iteration, loop-cap diagnostics, and win-
trigger reconciliation. `TriggerResolutionContext` carries the immutable pack
and state inputs plus the event, kill, CPR, decision, and note sinks. Its
optional `TriggerCascadeContext` makes the night-only guard/hide dependency
cascade explicit between rounds rather than maintaining a second trigger loop.
`ProducedKillCollection` preserves the coordinator contract explicitly: generic
day/duel/win callers receive generated kill records, while the night pipeline
uses them only as the next fixpoint frontier and avoids needless minimizer work.

The outcome family owns day-vote observation production and supplies typed
`TriggerObservation` values to the trigger family; the coordinator supplies
night and broader phase observations. Generated kills enter the action family
described below. The resolver boundary contract prevents the fixpoint
implementation from returning to the coordinator. Event order, trace payloads,
loop-cap behavior, seeded determinism, and generated goldens remain unchanged.

## Closed resolver boundary: kill and protection resolution

`crates/domain/src/resolver/action.rs` is the single owner of kill resolution,
protection interception and retaliation, CPR and dependency deaths, stacked
attacker attribution, death-reveal selection, and target-state interference
events and trace decisions. `ActionResolutionContext` and `KillAction` separate
resolution state from one kill request. `ProtectionResolutionContext` expresses
the guard/witch policy sinks, while `CounterUseInput` replaces the former
positional counter-event builder.

The action family also owns the `ProtectionSource`, `KillRecord`, guard/hide
dependency, and interference records shared with the coordinator and trigger
fixpoint. Intake owns action collection and precedence; redirect owns target
rewriting; the coordinator still owns block/empower and broad phase
orchestration, but it cannot implement kill resolution, stacked attribution, or
protection-policy event construction. The boundary contract
enforces that ownership and forbids local lint suppression. The superseded
event-builder and guard/witch high-arity allowances are removed without changes
to event order, trace payloads, seeded determinism, or generated goldens.

## Closed resolver boundary: day vote and outcomes

`crates/domain/src/resolver/outcome.rs` is the single owner of weighted ballot
collection, hammer and threshold evaluation, deterministic tie resolution,
ordinary and vote-duel outcomes, veto and prompt events, lynch effects, and the
post-lynch trigger and win handoff. `DayVoteResolutionContext` carries the
pre-vote badges and mutable event/trace sinks produced by the coordinator.
`OutcomeDecisionInput` replaces the positional decision signature and makes the
complete threshold, contender, tiebreak, and seeded-random inputs explicit.

Both ordinary duel resolution and vote-duel declaration live with the outcome
family so their kill, trigger, event, and trace construction cannot drift back
into the coordinator. The resolver boundary contract enforces the ownership and
forbids local lint suppression. Announcement order, prompt order, seeded tie
selection, win-trigger handoff, and generated golden semantics remain unchanged.

## Closed resolver boundary: resolution trace construction

`crates/domain/src/resolver/trace.rs` is the single owner of exhaustive
`InnerEvent` classification into outcome decisions, generated actions, effect
changes, survival awards, and diagnostic notes. `ResolutionTraceInput` borrows
the constructed `ResolutionApplied` envelope and owns the precomputed edges,
decisions, and notes, so trace assembly has one immutable handoff instead of a
positional coordinator helper.

Finalization constructs that input directly after wrapping ordered events. No
forwarding `build_trace` façade remains in the coordinator. Event-index
traversal, exact stage/source/outcome strings and JSON detail, generated/effect/
decision/note ordering, trace envelope fields, and the existing applied-then-
trace validation sequence remain unchanged. The resolver source-boundary
contract fixes the one construction site, ownership markers, validation order,
and absence of local lint suppression; the full domain golden and trace suites
continue to fix seeded semantics.

## Closed proof-runner boundaries: configuration and session artifacts

`tools/dev_test_game_configuration.mjs` is the single owner of CLI grammar,
defaults, CLI/environment precedence, verification-mode exclusivity,
named-game selection inputs, immutable workspace/media/artifact paths, help
text, and the bounded live-projection proof configuration. Configuration is
resolved in two stages so the composition root can read the named-game registry
from the normalized path before finalizing game, seed-mode, and token-prefix
values. Help still returns before registry or process work, and reset/reuse
selection remains deterministic under an injected UUID source.

`tools/dev_test_game_session_artifacts.mjs` owns role-login URL construction,
session-card schema, canonical and focused artifact references, JSON and
Markdown bytes, stdout lines, named-game registry documents, host-setup proof
inputs, and immutable write descriptors for focused, race, and full proof
artifacts. It performs no filesystem, process, browser, network, or assertion
work. `tools/dev_test_game.mjs` remains the composition root: it performs the
actual writes, owns mutable server and browser lifecycles, runs scenarios,
asserts the full proof run before writing it, handles signals, and preserves
cleanup and exit behavior.

Focused configuration and artifact tests cover every flag/default/precedence,
path and named-game rule, URL/card/JSON/Markdown/stdout schema, digest and
redaction pass-through, proof destination and fallback, and trailing-newline
contract. `dev_test_game_boundary.test.mjs` prevents either value owner from
acquiring I/O/orchestration dependencies, prevents ownership from drifting back
into the root, and requires matching contracts to import the extracted modules
directly instead of a compatibility façade.

## Closed operator-proof boundary: status-audit classification

`ProofRunStatusAuditRequest` is the immutable boundary between status-audit
artifact loading and report classification. The public filesystem entrypoint
continues to resolve workspace-relative or absolute paths, distinguish missing
and malformed files, parse the existing report schema, and then constructs the
request with the declared path, expected report inputs, manifest version,
freshness policy and clock, resolved filesystem path, and parsed report.

The private evaluator owns the preserved path, version, input, freshness,
staleness, semantic-drift, and trusted-result precedence. The former public
eight-argument evaluator and its `clippy::too_many_arguments` expectation no
longer exist. A table-driven unit contract locks every decision and returned
field, while `operator_proof_boundary.rs` prevents the request, loader, and
private evaluator from collapsing back into positional or public compatibility
surfaces. Saved status snapshots, report serialization, CLI binaries, and
artifact paths are unchanged.

## Closed DayEvent boundary: resolution application

`DayEventResolutionRequest` is the private immutable boundary between host or
automatic resolution preparation and transactional resolution application. It
owns the game, loaded DayEvent row, typed decision, ordered winner and
participant slots, resolution evidence, and Host/System actor. Both callers
construct the request directly; the SQL transaction remains a separate
application parameter and no compatibility overload preserves the former
eight-input function.

The application retains command-audit lookup before reward work, recipient
binding construction, declaration-order reward compilation and effect event
planning, the terminal `DayEventResolved` fact, and one final persistence call.
Focused SQLx coverage fixes host command causation, host authority and evidence,
automatic System attribution and durable seed evidence, effect-before-resolution
ordering, rejection behavior, scheduler behavior, and projection rebuild. The
`day_runtime_boundary.rs` source contract prevents positional inputs, caller
indirection, actor drift, transaction capture, reordered application, or a
replacement lint allowance.

## Closed identity-delivery boundary: cancellation and audit records

`IdentityDeliveryCancellationRequest` is the immutable boundary between a
claimed intent row that has failed the credential-active check and its
transactional cancellation. The claim owner constructs it directly from the
locked row; the transaction stays explicit, and the cancellation retains the
existing status, outcome, retry, claim-token, receipt, envelope-redaction, and
timestamp mutations.

`IdentityDeliveryAuditRecord` owns the exact event, actor, principal,
credential, delivery, provider, outcome, and receipt fields persisted by the
worker. Cancellation and finalization construct the record directly, so the
cancel path no longer fabricates a dummy `ClaimedIdentityDelivery` merely to
write audit metadata. The worker still locks the source credential before the
claimed intent, holds both through provider completion, records the audit in
the same transaction as its state transition, and commits only after
finalization.

`identity_delivery_boundary.rs` fixes those ownership, lock-order, SQL, JSON,
and transaction contracts. Focused serial SQLx coverage exercises inactive
credential cancellation, retryable failure followed by delivery, and permanent
provider failure while checking actor/principal/provider attribution, envelope
handling, claim clearing, receipts, and exact audit metadata.

## Closed media boundary: attached variant reads

`AttachedVariantReadRequest` is the private immutable handoff from manifest and
member lookup to the descriptor-relative read primitive. It owns the already-
open regular `File`, borrows its parent directory descriptor, entry name,
logical path, and diagnostic label, and carries the byte cap and `ContentId`.
Manifest open, persisted-member verification, and snapshot-member lookup each
construct the request directly; the former seven-argument helper and its Clippy
allowance no longer exist.

The primitive still verifies attachment before metadata inspection, rejects an
already-oversized inode, reserves exactly the observed size, reads through the
max-plus-one sentinel, rejects concurrent growth, repairs private mode, syncs
the file and parent directory, and verifies attachment again before returning.
Manifest parsing and member validation remain after that operation, while
format, recipe, id, store, and final manifest commit-token attachment checks
retain their original order. The source boundary contract fixes the request,
three direct construction sites, exact diagnostics, and operation ordering; a
focused runtime test covers exact-cap reads, mode repair, and typed oversize
failure alongside the existing variant snapshot, corruption, regeneration,
durability, and symlink tests.

## Exact lint-debt register

The strict baseline intentionally records, rather than hides, remaining
boundary pressure:

- resolver intake, redirect, action, trigger, outcome, and trace boundaries are
  typed and carry no local lint expectations; remaining block/empower execution
  and coordinator concentration are tracked as an ownership frontier rather than
  hidden lint debt;
- action submission/validation, host-prompt resolution/replay, and DayEvent
  resolution application are typed and carry no local lint expectations or
  allowances; operator-proof status and artifact classification live in their
  own crate rather than the production command module;
- auth, community, game-read, command/import, and live-delivery HTTP plus
  authentication attempt/delivery, provider-neutral identity-delivery
  cancellation/audit persistence, and live-publication ownership are typed and
  carry no local high-arity lint entries;
- effect and private-channel projection ownership is typed and carries no local
  lint expectations; unrelated projection families remain deliberately
  separate rather than hidden behind a generic SQL projector;
- attached media-variant file reading uses one typed descriptor-owning request
  and carries no local high-arity allowance; its before/after attachment,
  bounded read, permission, and durability checks remain one operation;
- direct wire enum payload ownership remains until transport allocation is
  benchmark-driven or the adapter boundary is reshaped;

Each extraction must remove the expectations or allowances it supersedes.
Adding an exact lint suppression requires a reason that names the missing
boundary and an update to this inventory when it creates a new debt category.

## Proof product freeze

Local proof orchestration under `tools/dev_test_game*` and
`target/dev-test-game/*-admin-proof.json` is a developer harness, not a product
completion surface. The freeze ban list (no new local-only admin UI, no
re-export-only `*-admin-proof` npm scripts, no further `dev_test_game.mjs`
growth without artifact-assembly extraction, no treating local admin-proof JSON
as product done) lives in
[proof-product-freeze](../ops/proof-product-freeze.md). Hosted packet
validators, proof lanes, and local diagnostics remain allowed.

## Completion boundary

`foundation.maintainable-core` remains open until every concentration above is
addressable through coherent modules, the exact lint-debt register is cleared
or justified by measured design constraints, and the existing narrow, sprint,
and full proof contracts remain intact. Lower line counts alone do not satisfy
the capability.
