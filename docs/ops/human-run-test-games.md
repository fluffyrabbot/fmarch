# Human-Run Test Games

This is the local one-developer path for opening a seeded fmarch game in a browser.
It is a developer harness, not a production or beta-readiness claim.

## Prerequisite

Postgres must be reachable through `DATABASE_URL`. The default is:

```sh
DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch
```

With Docker running, the repo-local service is:

```sh
docker compose up -d postgres
```

If Docker is unavailable, use the repo-local helper. It initializes a Postgres
cluster under `target/local-postgres`, starts it on `127.0.0.1:5544`, creates the
`fmarch` database if needed, and prints the exact `DATABASE_URL`:

```sh
npm run dev:postgres -- start
```

The helper also supports:

```sh
npm run dev:postgres -- status
npm run dev:postgres -- print-env
npm run dev:postgres -- stop
```

## Start A Game

The one-command local path starts repo-local Postgres, prebuilds the Rust API,
runs the test-game harness, and stops Postgres when the harness exits:

```sh
npm run dev:test-game:local
```

Any `dev:test-game` option can be forwarded after `--`:

```sh
npm run dev:test-game:local -- --name local --reset
```

To run the underlying harness against an already-started database:

```sh
DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run dev:test-game
```

The command starts a Rust API, starts the SvelteKit frontend, seeds one
`mafiascum` D01 game through `/commands`, creates invite-backed browser role
credentials for `admin`, `host`, `player`, `actionPlayer`, `deniedPlayer`, and
`cohost`, prints role entry URLs with the invite prefilled, and keeps the
servers alive until Ctrl-C.

On a cold Rust target directory, the API step can spend a few minutes compiling
before `/healthz` is reachable. The harness prints the selected API URL, the
Cargo process id, Cargo compile progress, and periodic health-wait updates so a
real build is distinguishable from a stuck server.

To make that compile phase explicit before starting the browser harness, run:

```sh
npm run dev:test-game:prebuild
```

It also writes:

```text
target/dev-test-game/session.json
target/dev-test-game/session.md
target/dev-test-game/proof-run.json
target/dev-test-game/ops-artifacts.json
target/dev-test-game/ops-artifacts.md
target/dev-test-game/ops-admin-proof.json
target/dev-test-game/seed-fixture-summary.json
target/dev-test-game/seed-fixture-summary.md
target/dev-test-game/seed-admin-proof.json
target/dev-test-game/release-readiness-checklist.json
target/dev-test-game/release-readiness-checklist.md
target/dev-test-game/release-admin-proof.json
target/dev-test-game/core-loop-admin-proof.json
target/dev-test-game/hardening-admin-proof.json
target/dev-test-game/backup-admin-proof.json
target/dev-test-game/identity-admin-proof.json
target/dev-test-game/admin-spine-proof.json
target/dev-test-game/spine-manifest.json
target/dev-test-game/spine-manifest.md
target/dev-test-game/proof-graph.json
target/dev-test-game/proof-graph-admin-proof.json
target/dev-test-game/next-action.json
target/dev-test-game/next-action-admin-proof.json
target/dev-test-game/spine-manifest-admin-proof.json
target/dev-test-game/admin-spine-admin-proof.json
target/dev-test-game/proof-freshness-admin-proof.json
target/auth-invite-role-proof/invite-role-proof.json
target/live-stack-backup-restore-drill/local-backup-restore-proof.json
target/live-stack-backup-restore-drill/local-live-stack.dump
target/dev-test-game/named-games.json
```

Open a role login URL from `session.md` and submit. Invite tokens are prefilled
in invite URLs; refreshed session credentials are repeated in the artifact for
recovery/debug use.

## Repeated Runs

By default, the friendly name is `local`.

```sh
npm run dev:test-game -- --name local
```

If that named game already exists in `target/dev-test-game/named-games.json`, the
harness reuses the same game id and does not reseed it. To make a fresh clean
game under the same name:

```sh
npm run dev:test-game -- --name local --reset
```

To require reuse and fail if the name is unknown:

```sh
npm run dev:test-game -- --name local --reuse
```

`--reset` does not delete append-only event history. It creates a fresh game id
for the friendly name, preserving the event-store invariant.

## Proof Commands

The no-server contract gate is:

```sh
npm run test:dev-postgres-contract
npm run test:dev-test-game-contract
```

The core gameplay live gate is the faster role-URL proof lane. It prebuilds the
Rust API, runs the seeded live browser proof, validates `proof-run.json`, runs
the core-loop and hardening admin proofs, and regenerates release readiness:

```sh
DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run test:dev-test-game-core-live
```

The full dev-test-game spine keeps the broader local proof chain intact. It runs
the core gameplay live gate plus seed fixtures, backup/restore, identity, admin
spine, proof graph, next-action, and final release-readiness refreshes:

```sh
DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run test:dev-test-game-live
```

The saved proof artifact validator is:

```sh
npm run test:dev-test-game-proof
```

The local release-readiness checklist generator is:

```sh
npm run test:dev-test-game-readiness
```

The default next-action handoff stays in the local capability-model sequence.
After the local core, hardening, ops, seed/demo, and identity-adapter rows are
all passed and the operator is ready to inspect the hosted identity blocker
directly, use the explicit hosted-identity sequence selector:

```sh
npm run test:dev-test-game-next-action:hosted-identity
```

The hosted identity evidence lane accepts a redacted operator packet through
`FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH`. To inspect the packet shape and admin
handoff without making a hosted-readiness claim, exercise the placeholder
template:

```sh
FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH=tools/fixtures/dev_test_game_hosted_identity_evidence.placeholder.json npm run test:dev-test-game-hosted-identity-evidence
FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH=tools/fixtures/dev_test_game_hosted_identity_evidence.placeholder.json npm run test:dev-test-game-hosted-identity-evidence-admin-proof
```

That placeholder keeps `releaseReady` and `productionReady` false. It proves
only the redacted packet schema, role-surface adapter comparison, and seeded
admin detail visibility; hosted accounts, sessions, invite delivery, recovery,
abuse controls, session-secret policy, and audit retention remain unproven.

The fixture-backed progression summary lists the first operator packet families
that can move from missing to provided while keeping hosted readiness blocked:

```sh
npm run test:dev-test-game-hosted-identity-progression-summary
FMARCH_HOSTED_IDENTITY_PROGRESSION_ID=hosted-account-lifecycle npm run test:dev-test-game-hosted-identity-progression-admin-proof
FMARCH_HOSTED_IDENTITY_PROGRESSION_ID=invite-delivery npm run test:dev-test-game-hosted-identity-progression-admin-proof
FMARCH_HOSTED_IDENTITY_PROGRESSION_ID=account-recovery npm run test:dev-test-game-hosted-identity-progression-admin-proof
FMARCH_HOSTED_IDENTITY_PROGRESSION_ID=abuse-and-rate-limit npm run test:dev-test-game-hosted-identity-progression-admin-proof
FMARCH_HOSTED_IDENTITY_PROGRESSION_ID=session-secret-policy npm run test:dev-test-game-hosted-identity-progression-admin-proof
FMARCH_HOSTED_IDENTITY_PROGRESSION_ID=hosted-audit-retention-export npm run test:dev-test-game-hosted-identity-progression-admin-proof
npm run test:dev-test-game-hosted-identity-complete-admin-proof
npm run test:dev-test-game-hosted-identity-operator-admin-proof
```

Those progression admin proofs are local role-surface checks. They prove the
seeded admin detail can show the specific missing redacted packet and the
fixture-backed recovered packet for that evidence family; they do not prove real
hosted identity traffic, release readiness, or production readiness.
The `hosted-account-lifecycle`, `invite-delivery`, `account-recovery`,
`abuse-and-rate-limit`, `session-secret-policy`, and
`hosted-audit-retention-export` progressions are the first operator-packet
flows: each admin proof reads a redacted packet with only that evidence family
provided, so the admin handoff shows one family as provided while hosted
identity readiness remains blocked on the remaining hosted identity packets.
The complete admin proof reads the all-families redacted packet and proves the
seeded admin detail can show all six evidence-family sections as provided while
`releaseReady` and `productionReady` remain false.
The operator admin proof writes a target-local example packet under
`target/operator-evidence/`, proves that non-fixture path through the same
seeded admin role URL, and records that the hosted-production-identity
readiness item clears only for an operator-provided packet path. It is still a
local predicate proof and does not prove live hosted identity traffic, release
readiness, or production readiness.

The local release-readiness admin browser proof is:

```sh
npm run test:dev-test-game-release-admin-proof
```

The ordered aggregate admin-spine browser proof is:

```sh
npm run test:dev-test-game-admin-spine
```

The seeded admin overview-to-local-admin-spine detail browser proof is:

```sh
npm run test:dev-test-game-admin-spine-admin-proof
```

The seeded admin overview-to-local-proof-freshness detail browser proof is:

```sh
npm run test:dev-test-game-proof-freshness-admin-proof
```

The proof-freshness detail includes a `local-next-action` handoff link to the
ranked recovery receipt, so stale or missing artifacts point at the generated
next local command instead of leaving recovery selection implicit.

The generated spine manifest, which records proof command order, evidence env
wiring, current artifact freshness statuses, per-artifact refresh commands for
the aggregate bundle and each admin proof surface, terminal graph/next-action
artifacts, and the final proof-freshness command/artifact without claiming release
or production readiness, is:

```sh
npm run test:dev-test-game-spine-manifest
```

The local-spine-manifest detail links to the proof-freshness dashboard and the
ranked next-action receipt, making the manifest a navigable proof graph rather
than only a static artifact inventory.

The generated proof graph, which records local proof nodes, role URLs, artifact
paths, dependency edges, and recovery commands without release or production
claims, and fails if it no longer covers every aggregate admin-spine proof
surface, is:

```sh
npm run test:dev-test-game-proof-graph
```

The seeded admin overview-to-local-proof-graph detail browser proof is:

```sh
npm run test:dev-test-game-proof-graph-admin-proof
```

The generated next-action receipt, which reads the spine manifest and emits the
highest-priority stale or missing development-spine recovery/freshness command
plus a ranked selection trace without claiming release or production readiness,
is:

```sh
npm run test:dev-test-game-next-action
```

The seeded admin overview-to-local-next-action detail browser proof is:

```sh
npm run test:dev-test-game-next-action-admin-proof
```

The seeded admin overview-to-local-spine-manifest detail browser proof is:

```sh
npm run test:dev-test-game-spine-manifest-admin-proof
```

The local-admin-spine detail links back to the local-spine-manifest detail so
the aggregate admin proof can be followed into the generated command and
artifact freshness graph.

The local ops artifact bundle generator is:

```sh
npm run test:dev-test-game-ops
```

The local seed/demo fixture summary generator is:

```sh
npm run test:dev-test-game-seed-fixture
```

After the live gate has written the dev-test-game proof, ops bundle, and seed
fixture, the local identity-adapter proof for replacing dev tokens without
changing role surfaces, proving local lifecycle recovery, and proving a host
can issue a game-scoped local player invite from the seeded host role URL is:

```sh
DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run test:dev-test-game-identity
```

That command also writes `target/dev-test-game/identity-admin-proof.json` by
clicking from the seeded admin overview into the native local identity-adapter
detail route, where lifecycle/delegated-issuance checks and admin/host/player
role surfaces are visible without raw invite-token echoes. The delegated
issuance check clicks the seeded host console's player-invite control, verifies
the stored local game scope, and redeems that invite through the existing player
role URL. The live-stack proof also verifies the same player-invite panel
retargets from the current host-console slot projection after replacement.

The local backup/restore drill for this spine is:

```sh
DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run test:dev-test-game-backup-restore
```

That command also writes `target/dev-test-game/backup-admin-proof.json` by
clicking from the seeded admin overview into the native local backup/restore
detail route, where dump/restore checks and restored role sessions are visible.

That live gate first runs `npm run dev:test-game:prebuild`, then starts the API
and frontend, seeds a fresh `live-proof` game, verifies host, player,
action-player, denied-player, and cohost browser entry through `/auth/login`,
checks that those browser sessions came from invite-issued `fmarch_session`
cookies, verifies role capabilities through `/auth/session?game=...`, drives a
small core-loop proof, then checks the generated session artifact and validates
`target/dev-test-game/proof-run.json` against the current `session.json`. It writes
`target/dev-test-game/release-readiness-checklist.{json,md}` from the validated
proof run, then writes `target/dev-test-game/ops-artifacts.{json,md}` with
redacted role entry URLs, source artifact checksums, command and lane counts,
and a local proof boundary. It then writes
`target/dev-test-game/seed-fixture-summary.{json,md}` with redacted role URLs,
seeded slots, local demo scenarios, and proof-lane mappings, then runs the
backup/restore and identity-adapter proof lanes. The final aggregate admin-spine
pass writes the core-loop, hardening, identity, backup, ops, seed, and
release-readiness admin browser proofs, records per-surface recovery commands in
`target/dev-test-game/admin-spine-proof.json`, then records
`target/dev-test-game/admin-spine-proof.json` in the readiness checklist while
keeping release readiness `not_ready`.

The cohost proof uses the generated cohost role URL to open the host console
with `CohostOf(<game>)`, renders only the delegated deadline control, runs the
delegated D01 `ExtendDeadline` host action, and records the ACK as part of the
`cohost-console` proof lane. The same browser session then submits a direct
host-only `ResolvePhase` command and records `Reject NotHost` while D01 remains
open. That proves the local capability shape for delegated host controls without
claiming production identity or exhaustive cohost policy coverage.

The core-loop proof uses the generated role URLs: the host page locks D01
through the hydrated phase control, the player page removes current vote
controls while locked, a direct role-browser `SubmitVote` rejects as
`PhaseLocked`, and the host page unlocks D01 again so the human-run game remains
usable after verification.

The day-vote resolution proof uses a disposable seeded game with the same local
role capabilities: `/player-command-state` exposes the action player's live
slot-vote targets plus no-lynch, starts with `current_vote: null` and disabled
Withdraw, the `actionPlayer` role URL renders those target-derived controls,
casts the fourth Slot 2 vote from the browser, refreshes `current_vote` to Slot
2 with Withdraw enabled, the host role URL resolves D01, `/day-vote-outcomes`
records the official `Lynch` result, the host projection marks Slot 2 dead, and
the target player role URL sees the `player_killed` / `day_vote` notice with
closed controls, and both the host and target player role URLs render the
official day-vote outcome panel from the `/day-vote-outcomes` projection.

The day-vote no-lynch proof uses a second disposable seeded game: two player role
URLs click the `Vote no lynch` control before the host role URL resolves D01, the
official `NoLynch` outcome renders on both host and surviving-player role URLs,
and the surviving player remains alive without a `day_vote` death notice. This
proves the no-elimination branch through the same player-facing vote command
surface used for slot votes.

The action-loop proof continues in the same seeded game: the host page resolves
D01, clicks the hydrated `Advance by deadline` control to record deadline
evidence and advance to N01, the `actionPlayer` page renders a live
`factional_kill` action, recovers from an invalid self-action, submits the legal
action, and then the host page resolves N01 and uses the ordinary phase advance
to reach D02.

The resolution-receipt proof uses the same seeded N01 kill: the target
`deniedPlayer` role URL opens the player board after resolution and loads the
principal-scoped `player_killed` / `factional_kill` notice, while the normal
player and action-player role URLs do not receive that target-only notice. The
host-side lifecycle receipt is limited to the focused local host-console state
endpoint for the killed slot.

The dead-player recovery proof keeps that killed `deniedPlayer` role URL on D02
and verifies the player command state marks the actor dead, exposes no legal
actions, disables vote/post controls in the browser, and returns
`Reject SlotNotAlive` for direct `/commands` vote, post, and action attempts.

The invalid-action recovery proof uses the seeded `actionPlayer` role URL on
N01, submits the browser-visible invalid self-action, records the current
`Reject InvalidTarget` command receipt, refreshes command state, and verifies
the legal `factional_kill` action remains available without advancing phase.
The same action loop also keeps a second action-player page frozen before the
legal submit, races two `factional_kill` submissions with distinct command ids
until one ACKs and the other renders `Reject ActionAlreadySubmitted`, replays
the winning command id and proves the original ACK stream seqs refresh browser
and API command state to N01 with no stale action controls, then clicks another
stale `factional_kill` control with a distinct command id and proves
`Reject ActionAlreadySubmitted` recovery reaches the same current state.

The late-loop proof keeps the same role-surface architecture honest after the
multi-revote path: the action-player role URL submits the D04 no-lynch ballot,
the host resolves and advances into N04, the action-player role URL has no legal
night action controls, the host resolves that no-action night, and the host
advances to D05 where the previously killed player stays dead from the N02
receipt while the action-player role URL gets the D05 no-lynch controls. A
separate frozen stale N04 action-control snapshot still proves `Reject
PhaseLocked` recovery into the current D05 controls; it is recovery evidence,
not a claim that the current N04 surface has a legal action.

The player action-boundary proof keeps the seeded `player` role URL on the same
local game at N01, verifies that the player command surface has no unowned
`factional_kill` action, submits a direct browser `/commands` `SubmitAction`
attempt for that unowned action, and records `Reject InvalidTarget` while the
player surface stays on N01 without adding the action.

The private-channel proof uses the same invite-backed role surfaces: the player
page opens the pack-declared `private:mafia_day_chat`, submits a private
`SubmitPost` ACK, and a separate `deniedPlayer` page renders the 403 `Back to
board` recovery for that same channel.

The host votecount publication proof continues after the D02 concurrent-vote
projection exists: the seeded host role URL clicks the hydrated `Publish count`
control, sends `PublishVotecount` through `/commands`, renders the host command
activity ACK, and verifies the projection-derived `Official votecount for D02`
post appears in both the player browser thread and the API thread.

The host lifecycle-control proofs then click the hydrated `Mark dead` and
`Modkill slot` controls for Slot 7, verify each `SetSlotStatus` through
`/commands`, check that the host and affected player role URLs render the
dead/modkilled lifecycle with disabled player controls and `SlotNotAlive`
recovery, and restore Slot 7 to alive before the replacement lanes continue.
The hardening proof also opens a disposable D02 game in two host role pages,
confirms `Mark dead` and `Modkill slot` concurrently for Slot 7, and proves one
ACK plus one `InvalidTarget` lifecycle recovery while both host pages, the
affected player role URL, and the API converge to one terminal status.
The same hardening matrix opens a disposable endgame-reveal game in two host
role pages, confirms `CompleteGame` concurrently, and proves one ACK plus one
`GameAlreadyCompleted` recovery while both host pages and the API converge to a
single completed game with all slot facts revealed.

The replacement proof uses the seeded `host` role URL after the player-owned
lanes finish, issues the local `player-rowan` replacement invite from the host
surface, opens that host-issued `replacementPlayer` role URL before replacement
as an authenticated pending player with no current SlotOccupant authority and no
player controls, then opens that already-redeemed invite URL in a fresh browser
and verifies the login surface rejects it without setting an `fmarch_session`
cookie. It sends a stale direct `ProcessReplacement` from the host browser with
`player-rowan` as the wrong outgoing user, records the `InvalidTarget` reject as
a visible host command-activity receipt, and verifies the host-console API still
shows Slot 7 owned by `player-mira` while the `replacementPlayer` URL remains
pending with no controls. It then clicks the
hydrated `ProcessReplacement` control for Slot 7,
records the ACK, verifies the host projection now shows `player-rowan`, and
checks the slot-scoped host-console API still reports the stable `slot-7`
history boundary. It replays the same successful `ProcessReplacement`
`command_id` through `/commands`, verifies the original ACK stream seqs return,
and checks Slot 7 remains with `player-rowan`. It also opens a separate stale
`player` role URL as
`player-mira` before replacement, submits an old Slot 7 vote after replacement,
records the `NotYourSlot` recovery receipt, and verifies the old vote/post
controls are disabled with `No current SlotOccupant(slot-7)` context; the same
old role URL then submits an action-shaped stale `SubmitAction`, receives the
same `NotYourSlot` recovery copy, and keeps no stale action controls. The host
then submits a stale post-success `ProcessReplacement` with `player-mira` as the
old outgoing user, records the visible `InvalidTarget` command-activity receipt,
and verifies Slot 7 stays on `player-rowan` while Mira's old URL remains
replaced and disabled. The same stale Mira browser then proves Slot 7
private-channel authority is gone: a direct private-channel `SubmitPost` rejects
as `NotYourSlot`, the private-channel route lands on the scoped 403 recovery
path, and `player-rowan` can open and post in that same private channel as the
current Slot 7 owner. It also proves stale private receipt reads are closed:
Mira's old principal gets scoped 403 recovery for notification and
investigation-result endpoints, while Rowan's current role surface keeps a
readable empty private queue with no target-only private receipts. Finally,
it reopens the same host-issued `replacementPlayer` role URL for `player-rowan`
after replacement, verifies current Slot 7 authority, preserves the earlier
Slot 7 thread history, submits a new Slot 7 post and vote, and checks
target-only private receipts did not leak to the incoming player. It then
revokes that replacement browser session through `/auth/session-revocations`,
verifies the old cookie is rejected by `/auth/session`, and reloads the role
path into the shared 403 recovery boundary with no player controls. The harness
then grants `player-rowan` a fresh local session through `/auth/session-grants`,
submits that session credential through the normal login page without replaying
the invite token, restores Slot 7 authority, and ACKs a new Slot 7 post, while
a separate stale browser context with the revoked replacement cookie still
reloads the role path into the shared 403 recovery boundary without player
controls. The fresh replacement role page then drops its live projection and
recovers current Slot 7 command state plus a new Rowan post through reconnect.
The same core game-loop evidence is inspectable from the seeded admin role:
`target/dev-test-game/core-loop-admin-proof.json` is written by clicking from
the admin overview into the native local core-loop detail route and verifying
the `core-loop`, `action-loop`, `host-deadline-advance`,
`stale-deadline-advance`, `invalid-action-recovery`,
`resolution-receipts`, `dead-player-recovery`, `player-action-boundary`,
`private-channel`, `host-votecount-publication`,
`host-lifecycle-control`,
`host-modkill-control`,
`night-four-no-action-surface`, `night-four-no-action-resolution`,
`post-night-four-transition`,
`replacement-host-issued-invite`,
`replacement-pending-player`, `replacement-invalid-target-recovery`,
`replacement-console`, `stale-host-invite-recovery`,
`replacement-stale-success-recovery`,
`replacement-stale-player`, `replacement-stale-action`,
`replacement-stale-private-channel`, `replacement-stale-private-receipts`, and
`replacement-incoming-player` rows.

The stale host invite recovery is carried as `stale-host-invite-recovery` in
`target/dev-test-game/proof-run.json` and as the local seed/demo scenario with
the same id in `target/dev-test-game/seed-fixture-summary.json`. It uses a stale
seeded host role URL that loaded the player-invite form for `player-mira` before
replacement, submits that old target after Slot 7 moves to `player-rowan`,
renders `Invite target is stale` without an invite URL, then retries the
current `player-rowan` target from the same host surface and records an ACK
player invite. This is local browser recovery evidence only; it does not prove
hosted invite delivery or production account lifecycle.

To replay and inspect only this local evidence surface after a fresh run:

```sh
DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run test:dev-test-game-core-live
node - <<'NODE'
const proof = require("./target/dev-test-game/proof-run.json");
const lane = proof.lanes.find((item) => item.id === "stale-host-invite-recovery");
console.log(JSON.stringify(lane.evidence, null, 2));
NODE
```

The expected local proof fields are: `rejectMessage` contains
`Invite target is stale`, `urlRendered` is `false`, and
`retryPrincipalUserId` is `player-rowan`. The same scenario should also appear in
`target/dev-test-game/seed-fixture-summary.json` with id
`stale-host-invite-recovery`.

The multiplayer-hardening proof promotes the first auth revocation, retry,
reconnect, concurrent-vote, and stale-client behaviors into the same browser
harness: the replacement player session revocation and positive session refresh
above are carried as `replacement-session-revocation-recovery` and
`replacement-session-refresh-recovery`, the stale revoked replacement context is
carried as `replacement-stale-session-after-refresh`, the fresh replacement
role reconnect is carried as `replacement-reconnect-recovery`, the stale
replacement host conflict copy is carried as
`replacement-stale-conflict-message`, the
player page replays one `SubmitPost` with the same durable `command_id` and
verifies the original ACK plus exactly one projected post, drops and
automatically reconnects the player live projection while a server-side post
lands, refreshes command state after a stale locked-phase vote reject, and
asserts the refreshed player command state has no legal vote targets, no current
vote, the old vote control removed, and Withdraw still disabled with
current-state copy, submits two concurrent D02 votes from separate role pages
and verifies converged browser plus API votecount, marks Slot 7 dead and
modkilled from the hydrated host role
URL, verifies the affected player role URL loses controls with `SlotNotAlive`
recovery after each host action, and restores Slot 7 alive before replacement
continues, keeps one action-player page frozen on N01 until its stale
`factional_kill` rejects with `Reject SlotNotAlive` copy that names actor death
plus current action controls and refreshes out of stale action controls, races
the hydrated action-player page with a second frozen N01 action-player page
until one `factional_kill` ACKs and the other receives
`Reject ActionAlreadySubmitted`, keeps another action-player page frozen on N01
until its stale `factional_kill`
replay with the successful command id returns the original ACK stream seqs and
refreshes browser plus API command state to N01 with no action controls, keeps a
third action-player page frozen on N01 until its stale `factional_kill`
rejects with `Reject ActionAlreadySubmitted` copy after the live action
succeeds and refreshes browser plus API command state to N01 with no action
controls, keeps a second host page frozen on D01 locked controls until its stale
`AdvancePhaseByDeadline` click renders `Reject InvalidTarget` copy that names a
stale deadline target, refreshes to N01, and exposes current phase controls,
keeps a fourth action-player page frozen on N01 until its
stale `factional_kill` rejects with `Reject PhaseLocked` copy that names stale
action state plus current action controls, refreshes browser and API command
state to D02 without the stale action control, and keeps a second host page
frozen on the N01
locked controls until its stale `UnlockThread` click renders a host command
activity `Reject PhaseLocked` receipt, refreshes to D02, and exposes the current
`resolve_phase` / `lock_thread` controls, advances a disposable seeded game to
D02 and races two host role pages on `ResolvePhase` until exactly one ACKs and
one renders stale `Reject PhaseLocked` recovery, verifies both browser
projections plus the API converge to locked D02, restores that disposable D02
open, advances another disposable seeded game to locked D02 and races two host
role pages on `AdvancePhase` until exactly one ACKs and one renders stale
`Reject InvalidTarget` recovery, verifies both browser projections plus the API
converge to open N02, advances another disposable seeded game to locked D01
with a deadline and races two host role pages on `AdvancePhaseByDeadline` until
exactly one ACKs with deadline evidence plus phase advance and one renders stale
`Reject InvalidTarget` recovery, verifies both browser projections plus the API
converge to open N01 with no carried deadline, advances another disposable seeded
game to locked D01 with both controls visible and races `AdvancePhase` against
`AdvancePhaseByDeadline` until exactly one ACKs and one renders stale
`Reject InvalidTarget` recovery, verifies both browser projections plus the API
converge to open N01 with no carried deadline, keeps a full host page frozen on D02
`ResolvePhase` until the live host resolves and locks D02, then renders a stale
`Reject PhaseLocked` receipt with no ACK stream seqs, refreshes to locked D02
controls, keeps a player page frozen on a legal D02 vote target until the host
marks that target dead, then renders `Reject InvalidTarget` copy naming the
stale vote-target condition and refreshes to the current vote target controls
without the dead slot, casts a live current vote from the player role URL,
marks that voted target dead from the host role URL, and verifies player
`current_vote`, player/host votecount, and API votecount all clear that
dead-target ballot without resurrecting it on restore, keeps a full host page frozen on locked D02 `AdvancePhase` until the
live host unlocks D02, then renders a stale `Reject InvalidTarget` receipt with
no ACK stream seqs and refreshes to open D02 `resolve_phase` / `lock_thread`
controls for the remaining seeded flows, keeps a second host page frozen on the
D02 `Publish count` control, lets the live host publish the official count,
then renders a stale `PublishVotecount` `Reject InvalidTarget` receipt with no
ACK stream seqs while the API and player thread projections keep exactly one
official count, keeps a second host page frozen on the D02 `Mark dead` control
until the live host marks Slot 7 dead, then renders a stale `SetSlotStatus`
`Reject InvalidTarget` receipt with no ACK stream seqs while the API and player
command projections stay on the single dead status, reloads the same host role
URL into terminal Slot 7 controls with stale lifecycle actions hidden, then
keeps that state until the seed is restored,
keeps another host page frozen on the D02 `Modkill slot` control until the live
host modkills Slot 7, then renders the same stale lifecycle `Reject
InvalidTarget` receipt while API and player command projections stay on the
single modkilled status, reloads that stale host role URL into terminal Slot 7
controls with stale lifecycle actions hidden, then keeps that state until the
seed is restored,
keeps a full host page frozen on the
D01 deadline control until its stale `ExtendDeadline` click renders a host
command activity `Reject PhaseLocked` receipt, refreshes to
D02, and exposes current host phase plus deadline controls, and keeps a second
cohost page frozen on the D01 delegated deadline control until its stale
`ExtendDeadline` click renders a host command activity `Reject PhaseLocked`
receipt, refreshes to D02, and exposes only the current delegated deadline
control without mutating the D02 deadline.
The same local hardening evidence is inspectable from the seeded admin role:
`target/dev-test-game/hardening-admin-proof.json` is written by clicking from
the admin overview into the native local multiplayer-hardening detail route and
verifying the thirty-three hardening lane rows above.

`proof-run.json` is the compact machine-checkable truth surface for this local
harness. It records the passed lanes, seed game identity, artifact paths, and
explicit non-claims. The validator recomputes it from `session.json` and fails
when the proof-run artifact is stale, missing a required lane, or claims
production/release readiness.

The release-readiness checklist is intentionally not a release gate. It keeps
`releaseReady: false` and `productionReady: false`. Without an explicit
backup/restore artifact, it keeps `backup-restore-drill` unproven. After
`npm run test:dev-test-game-core-loop-admin-proof`, the checklist consumes
`target/dev-test-game/core-loop-admin-proof.json` and attaches only the seeded
admin overview-to-local-core-loop-detail browser proof to the existing local
core-loop lane. After
`npm run test:dev-test-game-hardening-admin-proof`, the checklist consumes
`target/dev-test-game/hardening-admin-proof.json` and attaches only the seeded
admin overview-to-local-hardening-detail browser proof to the existing local
hardening lane; exhaustive race coverage remains unproven. After
`npm run test:dev-test-game-backup-restore`, the checklist consumes
`target/live-stack-backup-restore-drill/local-backup-restore-proof.json` plus
`target/live-stack-backup-restore-drill/local-live-stack.dump`, then attaches
`target/dev-test-game/backup-admin-proof.json`, and promotes only the local
dump/restore check with its seeded admin overview-to-detail browser proof. After
`npm run test:dev-test-game-ops`, the
checklist consumes `target/dev-test-game/ops-artifacts.json` plus
`target/dev-test-game/ops-admin-proof.json` and promotes only the local ops
artifact bundle with its seeded admin overview-to-detail browser proof. After
`npm run test:dev-test-game-seed-fixture`,
the checklist consumes `target/dev-test-game/seed-fixture-summary.json` plus
`target/dev-test-game/seed-admin-proof.json` and promotes only the local
seed/demo fixture inventory with its seeded admin overview-to-detail browser
proof, then refreshes `target/dev-test-game/next-action.json` with the same seed
evidence so the handoff advances past the recovered local dependency. After
`npm run test:dev-test-game-identity`, the checklist consumes
`target/auth-invite-role-proof/invite-role-proof.json` plus
`target/dev-test-game/identity-admin-proof.json`, and promotes only the local
identity-adapter proof that invite-issued opaque sessions preserve the same role
URL and capability architecture through local session rotation, session
revocation, revoked-invite rejection, replacement-invite recovery, and a seeded
host-issued game-scoped player invite that persists its local game scope and
is issued from the seeded host role URL before redeeming back to the existing
player role surface, plus a seeded admin overview-to-local-identity-adapter-detail
browser proof without raw credential echoes.
After the local capability rows are passed,
`npm run test:dev-test-game-next-action:hosted-identity` refreshes
`target/dev-test-game/next-action.json` with
`FMARCH_DEV_TEST_GAME_SEQUENCE_STAGE=hosted-identity`, selecting the hosted
identity evidence lane while preserving the same blocked hosted-readiness
claims.
After `npm run test:dev-test-game-admin-spine`, the checklist consumes
`target/dev-test-game/admin-spine-proof.json` and records the ordered local
admin browser proof set as a single development-spine evidence signal while
keeping release readiness `not_ready`. The generated
`target/dev-test-game/spine-manifest.{json,md}` records
`target/dev-test-game/proof-graph.json`,
`target/dev-test-game/proof-graph-admin-proof.json`,
`target/dev-test-game/next-action.json`, and
`target/dev-test-game/next-action-admin-proof.json` as terminal graph and
next-action artifacts, separate from self-dependent browser-proof loops. The
`target/dev-test-game/spine-manifest-admin-proof.json` proof shows the current
local proof order, evidence env wiring, terminal-artifact vocabulary, artifact
freshness summary, stale-artifact next command, admin-spine recovery-command
vocabulary, and proof-freshness command/artifact are inspectable from the seeded
admin role surface without reading the orchestration code. It also writes
`target/dev-test-game/admin-spine-admin-proof.json`, proving the aggregate
`admin-spine-proof.json` and its per-surface recovery command summary are
inspectable from the seeded admin overview in the native local-admin-spine detail
route. The tail of the command writes
`target/dev-test-game/proof-graph.json` and
`target/dev-test-game/proof-graph-admin-proof.json`, proving the generated graph
nodes and related role URLs are inspectable from the seeded admin overview and
that the graph covers every aggregate admin-spine proof surface, then writes
`target/dev-test-game/proof-freshness-admin-proof.json`, proving the generated
artifact freshness dashboard is reachable from the seeded admin overview, then
regenerates `target/dev-test-game/next-action.json` and writes
`target/dev-test-game/next-action-admin-proof.json`, proving the generated
next-action receipt is reachable from the seeded admin overview in the native
local-next-action detail route before the run is treated as green.
Hosted account lifecycle, invite delivery, account recovery, rate limits, abuse
controls, production session-secret policy, hosted audit retention/export,
hosted deployment, hosted demo fixtures and sanitized demo-data policy,
production-like backup storage/PITR, exhaustive race coverage, hosted
observability/operations, and a human release runbook remain outside that local
proof.

## Boundary

This proves a local seeded browser test-game workflow for one developer, plus
specific cohost deadline delegation with host-only command rejection,
host replacement, redeemed replacement-invite recovery, stale outgoing-player replacement recovery, and incoming
host-issued replacement invite, stale outgoing-player action recovery, stale outgoing-player
private-channel recovery, stale outgoing-player private-receipt recovery, and replacement-player ownership,
projection-driven host player-invite retargeting after replacement, stale host player-invite recovery to the current occupant,
duplicate replacement command, duplicate post command, player reconnect,
concurrent vote race, stale player vote, stale player vote-after-change recovery, stale player withdraw-after-change recovery, stale player withdraw-after-phase-closure recovery, stale player vote-after-phase-closure recovery, stale player post-after-phase-closure recovery, stale dead-target vote recovery,
dead-current-vote cleanup with stale host publish-after-clear recovery, stale dead action conflict, stale action conflict, stale action conflict message, stale host control recovery,
concurrent host resolve/advance/deadline-advance/lifecycle/complete-game/mixed-advance races, stale deadline advance recovery, stale host resolve recovery, stale host publish-after-change recovery, stale host publish recovery, stale host lifecycle recovery, stale host modkill recovery, stale host prompt recovery, stale host complete-game recovery, stale player completed-game recovery, stale host advance recovery, stale host deadline recovery, stale cohost deadline recovery,
local artifact-bundle, local seed/demo fixture inventory,
local identity-adapter shape, and local backup/restore lanes. It does not prove
hosted production account lifecycle,
invite delivery, account recovery, rate limits, abuse controls, production
session-secret policy, hosted deployment, hosted demo fixtures,
production-like backup/PITR, exhaustive race coverage, hosted
logs/metrics/traces, upload or transcode behavior, beta readiness, or
rollback/delete semantics for existing append-only games. The harness seeds a
local root GlobalAdmin row directly into `auth_session` with `/auth/dev-session`
disabled, then mints local browser credentials through `/auth/session-grants`
and invite redemption; hosted production accounts/sessions/invites remain a
later identity layer over the same role surfaces.
