# 06 — Security

**Posture: server-trusted with strong authorization.** Moderators must be able to read
private channels (scumchat, role PMs) — that's intrinsic to running a fair game — so we
explicitly do **not** do end-to-end encryption. Instead we harden the server-trusted model:
strong auth, capability-based authorization, and encryption at rest for private content.
This is a deliberate, recorded decision ([00](00-vision.md)).

## Threat model (what we defend against)

- **Account takeover** — credential theft, session hijacking, brute force.
- **Authorization bypass** — a player reading scumchat, a spectator seeing roles, a host of
  game A acting in game B, a dead slot posting, voting out of turn.
- **Data-at-rest exposure** — DB/backup leak revealing private channel contents or roles.
- **Confused deputy** — a component acting with more authority than the caller actually has.
- **Information leak via deltas** — a client receiving frames it shouldn't see.

What we explicitly **don't** defend against: a malicious server operator reading private
content (incompatible with moderation; out of scope by design).

## Authentication

**The governing decision: a sign-in method authenticates a principal; it never owns the
principal or the application session.** Identity is a `platform_principal` with one or more
`authentication_method` rows (`classic_password` or `workos`). Every method ends at the same
backend-owned opaque app session (`auth_session`, `fmss_`-prefixed token, SHA-256 hash
stored, absolute and idle expiry, bound to the method that authenticated it). Authorization,
memberships, profiles, and private authority records reference only the UUID-backed
`PrincipalId` (`principal_id`, or a deliberately named relationship such as
`invited_by_principal_id`) — adding or removing a sign-in method never rewrites a
principal. Provider subjects, provider-session IDs, account/login names, and token hashes
remain adapter-local strings; none is an application principal or an authorization input.

- **Classic — direct sign-in (first-class, on by default):** Argon2id credentials, invites,
  recovery credentials, and login throttling, all server-local. Product promise: *your
  credentials and sessions stay on this server; no third-party identity provider is
  contacted.* Credential verification has no outbound identity-provider dependency;
  hosted invite and recovery delivery still require the configured HTTPS delivery
  transport. `FMARCH_CLASSIC_AUTH=0` disables classic for a WorkOS-only deployment;
  otherwise startup requires that real transport. The deterministic delivery adapter is
  available only with `FMARCH_DEV_AUTH=1` in a debug build and can never satisfy a hosted
  delivery contract. Startup requires at least one enabled method.
- **WorkOS — managed sign-in (additive):** AuthKit owns the interactive ceremony (signup,
  email verification, passkeys, MFA, provider-side recovery). The frontend confines AuthKit
  middleware and its sealed cookie to the start and callback routes; after the OAuth
  callback, the exact signed WorkOS access-token assertion is consumed **once** at either
  `POST /auth/sessions` or `POST /auth/account/methods/workos`, and the AuthKit cookie is
  discarded. `workos_session_exchange` retains only its SHA-256 `access_token_hash` replay
  key; provider JWTs are never stored as reusable credentials or accepted as per-request
  application bearers.
- **API verification (exchange only):** the Rust `identity::workos` adapter accepts RS256
  only, accepts bounded compact JWTs and prevalidated unique RSA verification keys, selects
  the WorkOS JWKS key by `kid`, and permits one rate-limited refresh leader for an unknown
  key while followers fail fast. Positive key snapshots expire after five minutes and are
  never used stale. The adapter validates `exp`, `iat`, `iss`, `sub`, client id, and WorkOS
  session id; assertions must be exchanged within ten minutes of issuance and may span no
  more than one day. The issuer and JWKS URL are derived from the canonical WorkOS client
  authority and supplied configuration must match those exact HTTPS endpoints. Redirects,
  oversized responses, ambiguous key sets, and provider failures fail closed. Promotion
  independently rechecks discovery and a nonempty key set for both hosted environments
  without receiving a WorkOS secret.
  Before any JWT decoding, signature verification, or JWKS work, the API first acquires a
  dedicated verification semaphore and then charges a bounded signed-edge source budget. Source
  excess is retryable HTTP 429; process verifier saturation is retryable HTTP 503 and consumes no
  source quota. An absent or unauthenticated source designation shares the conservative
  `unattributed` budget rather than becoming caller-selected authority. Stale budget cleanup uses
  a bounded, skip-locked candidate batch so an unauthenticated request cannot monopolize the table.
- **Stable local authority:** the immutable WorkOS `sub` is bound exactly once to a
  generated `platform_principal` through `external_identity` (`(provider, subject)` is the
  identity key; email is display metadata, never a primary key, authorization input, or
  auto-linking signal). Session validation rechecks that the principal and the
  authenticating method are still active on every request. Durable global capabilities are
  read from the principal on every validation; hosted session, account, and invitation rows
  store no capability snapshot at all, so removing a principal capability takes effect
  immediately. Per-game capabilities are likewise derived from current local state.
  Disabling a principal revokes every method and session.
- **Provider-session cutoff:** every accepted WorkOS assertion must carry one canonical
  provider session id (`sid`). `workos_provider_session` binds that id to exactly one local
  subject, principal, and method; `auth_session.workos_session_id` makes all local sessions
  minted by the same provider session share one cutoff. Logout atomically seals that row,
  appends its SHA-256 fingerprint to the immutable
  `workos_provider_session_tombstone`, and revokes every matching local session. A retry
  with the same just-revoked local credential reproduces the same constrained WorkOS logout
  URL, so a lost response cannot strand the provider session. Linking consumes the exact
  assertion and immediately seals and tombstones its link-only `sid`; the frontend accepts
  only `https://api.workos.com/user_management/sessions/logout?session_id=<canonical sid>`
  with no caller-controlled `return_to`, then navigates there to end the provider ceremony.
  On one ambiguous internal response, the frontend repeats the byte-identical link request;
  the exchange's `access_token_hash` and `linking_session_hash` let the API replay only that
  already-committed URL for the same assertion and initiating app session, without a second
  identity mutation. A browser may still present a provider assertion from a `sid` retired
  by logout, linking, method disable, or migration cutover. After verifying that assertion,
  the API returns HTTP 409 with exactly a verifier-derived constrained logout URL; login and
  link callbacks accept only that exact two-field recovery shape and navigate through WorkOS
  before another ceremony. A subject-erasure tombstone always wins and remains an opaque 401
  with no recovery URL.
  Disabling a WorkOS method seals and tombstones every provider session observed for that
  method. Subject erasure first appends the SHA-256 `sub` fingerprint to the immutable
  `workos_subject_tombstone`, preventing a valid assertion from an unobserved sibling
  provider session from recreating the erased binding.
- **Method lifecycle:** `GET /auth/account/methods` lists a principal's methods;
  `POST /auth/account/methods/classic` attaches classic sign-in to (for example) a
  WorkOS-only principal, returns one-time recovery codes shown exactly once, and replaces
  the browser cookie with a Classic-authenticated session before WorkOS can be removed;
  `POST /auth/account/methods/workos` symmetrically attaches a verified WorkOS subject to an
  authenticated Classic principal without moving or auto-linking identities;
  `POST /auth/account/methods/{id}/disable` removes a method. Adding or removing a method
  requires a recently authenticated session (`FMARCH_AUTH_RECENT_SECONDS`, rejected with
  `recent_authentication_required`). Recent authentication is the immutable time of the
  credential ceremony and is preserved by session rotation; rotating an old session cannot
  manufacture step-up authority. An active principal must retain at least one active method,
  at most one classic method exists per principal, and removal revokes the sessions authenticated
  through that method; WorkOS removal also seals and tombstones all of that method's observed
  provider sessions before it can later be reattached. A disabled classic identity cannot reactivate
  itself through a live sibling method; only the GlobalAdmin account-enable lifecycle may restore
  it. Every transition writes `identity_lifecycle_audit`.
- **WorkOS adapter policy (recorded tradeoff):** there is no AuthKit refresh loop and no
  provider webhook. App-initiated logout ends the observed provider session immediately as
  described above, but provider-originated revocation elsewhere is learned only when the
  local session expires. A WorkOS-exchanged session therefore expires at the earlier of the
  signed assertion's `exp` or `FMARCH_WORKOS_SESSION_TTL_SECONDS`, which is capped at 24h;
  the verified signing `kid` is retained as backend-only provenance on every external session
  and identity-link lifecycle audit. A recent-method GlobalAdmin can invoke
  `POST /auth/workos-signing-key-retirements`; retirement commands first take one global
  transaction fence before locking the administrator session, preventing concurrent incident
  responders from forming a session-row deadlock. The command then takes the exclusive per-key
  gate, appends an immutable `workos_signing_key_tombstone`, revokes only currently live sessions
  bearing the key, and records the lifecycle event. Expired and already-revoked history is neither
  locked nor rewritten. Every WorkOS issuance, link, and rotation takes the shared form of the
  per-key gate and checks the durable tombstone in its transaction, so retirement is monotonic
  across processes and restarts. Repeating retirement returns the original tombstone without
  rewriting evidence or duplicating the audit. Gameplay commands lock and revalidate their exact
  session in the same transaction that claims the command receipt and appends events. Retirement
  therefore waits for every earlier authorized commit, while a retirement that wins the fence makes
  every later command reject; no detached mutation can commit after the retirement receipt. Classic
  sessions retain their independent 30d default
  (`FMARCH_SESSION_TTL_SECONDS`). A signed-out user cannot escape a WorkOS outage
  unless they added classic or recovery credentials beforehand — the security page
  therefore prompts WorkOS-only principals to add classic sign-in proactively.
- **Bootstrap (provider-neutral):** `FMARCH_BOOTSTRAP_ADMIN_METHOD=classic|workos` with
  `FMARCH_BOOTSTRAP_ADMIN_LOGIN_NAME`/`FMARCH_BOOTSTRAP_ADMIN_PASSWORD` or
  `FMARCH_BOOTSTRAP_ADMIN_WORKOS_USER_ID` creates the first principal, attaches the chosen
  method, and grants `GlobalAdmin`. A transaction-wide advisory lock and the
  existing-admin check make this a one-time root-of-authority operation. Remove the
  variables after bootstrap.
- **Login surface:** `/auth/login` and `/auth/register` are real choosers — classic is the
  primary/direct option and WorkOS appears only when its complete configuration is present
  (`workosAuthKitConfigured` is the single availability predicate). Every route is always
  mounted; classic availability is a runtime policy check, not a compile-or-mount fork.
- **Dev shortcuts:** the local-proof session endpoint exists only in debug builds and requires
  all of `FMARCH_DEV_AUTH=1`, an explicit loopback bind, and a fresh high-entropy per-process
  `FMARCH_LOCAL_PROOF_SECRET`; the flag alone grants nothing. The secret authenticates the
  control endpoint; verifier construction independently generates a non-secret random process
  instance id, so even accidentally repeated secrets cannot merge process authority. Every issued Dev
  session persists that id but no capability grant. Debug-only grants live in a process-owned
  map keyed by the session hash and disappear on restart; bearer, trusted-reference, and locked
  rotation validation require both the current process instance and its live map entry.
  Callers cannot select bearer material.
  WebSockets use the same one-time session-backed ticket boundary in every environment; no
  query-parameter principal shortcut exists. Dev auth is orthogonal to classic availability, which is production
  identity.
- **Commit-bound application authority:** request extraction is an admission check, not a
  durable authorization receipt. Security-sensitive mutations use an identity-owned
  transaction, lock the canonical principal/session owner, revalidate the exact initiating
  session, resolve current global or game authority, perform the mutation, and commit without
  allowing that transaction to escape. Member lifecycle and private exports carry an opaque
  `InitiatingSession`; community membership and stewardship use `AuthorizedUnitOfWork`; game
  invitations re-resolve `GlobalAdmin` or `HostOf(game)` inside their insertion transaction.
  Logout, role removal, or key retirement therefore either waits for an earlier authorized
  commit or wins first and makes the later operation reject.
- **CSRF:** AuthKit's OAuth callback uses PKCE and state validation. Authenticated API
  calls carry explicit bearer authority from server-side SvelteKit code rather than ambient
  API cookies. The WebSocket uses a one-time, audience-bound ticket rather than a bearer
  token in its URL.

### Gameplay transport authentication

- Browser commands and private projection reads go through allowlisted same-origin SvelteKit
  endpoints. Those endpoints attach the app-session token from the `fmarch_session` cookie as
  the API bearer credential; they reject a missing identity before making a privileged
  upstream call. Command wire bodies contain only a durable command id and the typed command.
  Any legacy or forged actor field is rejected by strict deserialization, and the API derives
  the actor from the enabled, unexpired, unrevoked session before it reads or writes gameplay
  state. A command's five-second authority lease begins before pool checkout and spans stream,
  principal, exact-session, decision, receipt, and commit work. Timeout closes its owned
  connection within a separate one-second reserve; an ambiguous commit is recovered only by
  retrying the same command id.
- Split-domain WebSockets use `POST /auth/websocket-tickets`. The API stores only a hash of
  each random ticket and binds its session reference by foreign key to the app-session hash,
  configured audience, game, channel, optional slot, durable `after_seq`, and the earlier of
  the local ticket TTL or session expiry. Principal authority is derived from that session,
  never duplicated on the ticket. Minting re-locks and revalidates the exact bearer inside the
  insertion transaction, so lifecycle revocation cannot race a late derived credential into existence.
  Admission first reserves process-wide connection capacity. Redemption discovers only the candidate
  session owner, reserves per-principal capacity before opening a lock-bearing transaction, then locks
  and revalidates that exact session, resamples time, deletes and returns the outstanding ticket, and
  commits as one short transaction. A ticket cannot outwait its own expiry behind a session lock.
  Retryable global or
  per-principal capacity rejection releases or rolls back its admission state, preserving the
  one-time ticket for retry. Successful mints sweep a bounded shortlist of expired tickets under
  per-ticket try-advisory locks. Redemption and identity lifecycle deletion take the blocking form of
  that same canonical lock, so cleanup skips their tickets rather than convoying behind them and does
  not need broad ticket `UPDATE` authority.
  Wrong-audience attempts do not consume the ticket; expired, replayed, forged, or
  disabled-principal/disabled-method tickets are rejected before upgrade, so no Hello frame
  or private byte is emitted. Session, method, principal, expiry, retired WorkOS-key liveness, and
  current game authority are checked before every outbound application batch. The transaction first
  takes the global signing-key-retirement advisory gate and principal owner row in shared mode, then
  shared locks on the exact session and the existing game-role, spectator, persona-binding, occupancy,
  slot-state, and private-channel rows that support the resolved grants. The five-second authority lease
  starts before those gates, so database acquisition consumes (rather than extends) the remaining socket
  budget. Exclusive key/principal cutoffs
  queue ahead of later shared readers, so they drain the bounded set of already-entered deliveries once
  rather than accumulating one socket deadline per session. The final guard validates the
  ticket's channel/slot scope and every host/player-only delta audience before encoding. Those bounded
  locks span one whole-send deadline, making successful session/key retirement, role removal, channel
  removal, or player replacement wait out an earlier authorized delivery on a healthy PostgreSQL
  connection. Delivery capacity is capped below the shared authority budget, and the database idle
  transaction timeout cannot be configured below ten seconds. Identity cutoffs use a centralized
  transaction-local seven-second lock wait and ten-second statement deadline, so the general one-second
  pool lock timeout cannot make them fail behind a permitted five-second delivery. Release failure
  closes the socket before any later batch. A timed-out or failed application-frame send is stricter:
  it drops the socket without a later Close/flush, because cancellation may leave that private frame
  buffered inside the sink. Inbound close/control frames are polled even on a quiet game so abandoned
  connections promptly return their admission permits. Backend termination during the in-flight network
  write remains a documented fail-stop gap that requires the future revocation-epoch/instance-ack
  protocol for a database-failure-proof no-post-receipt guarantee.
- In-process broadcast remains the low-latency path for game events, while every API instance
  polls the durable game event sequence and the durable main-thread visibility log. A commit or
  moderation action on instance A therefore reaches a socket on B; hides emit a removal tombstone
  before a visibility-filtered snapshot. Sequence movement or broadcast lag produces
  `ResyncRequired` followed by capability-filtered snapshots, and a fresh reconnect ticket
  hydrates projections from durable state even if the client cursor is stale.
- Private game reads and WebSockets have no query-supplied-principal fallback. The sole request
  authority is the exact presented app session, resolved into `AuthorizationContext`; game-scoped
  capabilities are then resolved for that context's principal.

## Authorization: capabilities, not ambient roles

Authority in this domain is **per-game scoped** ([01](01-domain-model.md)), which global
roles cannot express. A host of one game has zero authority in another; `if user.is_admin`
is the wrong shape and the source of endless privilege-creep bugs.

### How it works

- Authority is a **capability** — an unforgeable, scoped grant resolved from the
  authenticated session **at the trust boundary** ([03](03-backend.md)).
- The resolved capability is **passed inward explicitly** to the action. Inner/domain code
  never consults global state to decide what's allowed; it receives the authority it needs
  or it cannot act. This is what prevents the confused-deputy problem: a component can only
  exercise authority it was handed.
- **Principle of least authority:** each action requires the *narrowest* capability that
  justifies it. Posting as slot 7 requires `SlotOccupant(7)`, not "is a player in the game."

### Capability vocabulary

```
GlobalAdmin                 platform operations
GlobalMod                   cross-game moderation / escalation
HostOf(game)                primary host: run this game + structural acts (cohost grant/revoke, cohost policy, host transfer)
CohostOf(game)              co-GM for this game: by default same game-run mutators as host;
                            optional per-game denylist (set at create) may strip permission classes;
                            host subsumes cohost; cohost never satisfies HostOf
SlotOccupant(slot)          act as this slot: post, vote (bound to current occupant)
ChannelMember(channel)      read/post in this channel
DeadViewer(game)            read dead-visible content; dead slot may post in dead chat
SpectatorOf(game)            read fixed spectator room; never grants a player slot or append
```

- `SlotOccupant` is derived from the **current immutable occupancy epoch** joined to the
  private `GamePersona` binding. After replacement, the outgoing persona's epoch is closed,
  a new persona epoch is opened, and the old principal's capability is gone while slot history
  remains untouched ([01](01-domain-model.md)).
- `private:role_pm:<slot_id>` membership is keyed to the stable slot in
  `private_channel_member`. Replacement therefore transfers Role PM read/post authority by
  changing the current `slot_occupancy_epoch`; it does not rewrite membership, authorship, or history.
- Pack-declared `private:mason` and `private:neighbor` membership is likewise keyed to the
  matching role slots. The outgoing account loses both `SlotOccupant` and the derived
  `ChannelMember` after replacement; the incoming account receives the same room history
  and media without copying or re-authoring either.
- DayEvent rooms derive `private:event:<event_id>` from an immutable definition.
  Eligible-slot rooms capture members at open; participant rooms grant on submit
  and revoke on withdrawal. The same slot join transfers access on replacement,
  and event state closes posting without erasing authorized read history.
- `DeadViewer(game)` is derived by joining the current `slot_occupancy_epoch` with `slot_state`. A dead
  slot grants it to the current occupant, replacement transfers it, and an alive restoration
  revokes it. Posting additionally checks that the command's actor slot itself is dead, so a
  principal occupying multiple slots cannot use one dead slot to post as a living slot.
- `SpectatorOf(game)` is derived from explicit `spectator_membership` grant/revoke events.
  Granting rejects current slot occupants, and assignment/replacement rejects current
  spectators, keeping observer and player authority disjoint. The spectator room accepts
  only host-authored `PublishSpectatorPost`; all player `SubmitPost` attempts reject before
  any client-supplied actor slot is considered.
- Replacement revokes the outgoing session's **game-scoped slot and channel authority** on
  the next capability resolution. It intentionally does not revoke the account session
  globally, because that credential may still have unrelated authority elsewhere.
- Capabilities are derived from projections (`private_channel_member`, `spectator_membership`,
  `slot_occupancy_epoch`, `game_persona_subject_binding`, `privacy_subject`, `slot_state`) so they always reflect committed game state, never stale
  client claims.

## Visibility enforcement (defense in depth)

Reads and live deltas are filtered server-side by capability ([03](03-backend.md)):

- A delta is sent to a connection only if the connection's capabilities permit seeing that
  event. Scumchat frames never leave the server toward a spectator's socket — it's not
  hidden in the UI, the bytes are never sent.
- A private player route selects its active channel on the live connection. Initial and
  command-following `ThreadPostsChanged` frames are built from that channel only after the
  principal resolves `ChannelMember(channel)`; an outgoing replacement session receives no
  Role PM, Mason, or Neighbor thread frame.
- The `dead` route and selected live channel require `DeadViewer(game)` on every cold-load,
  media, and live-delta boundary. Living, restored-alive, and stale outgoing accounts receive
  neither rows nor media bytes, and cannot append.
- The `spectator` route and selected live channel require `SpectatorOf(game)` on every
  cold-load, media, and live-delta boundary. The frontend does not request player-private
  endpoints without an actor slot; the backend independently returns 403 for role PMs,
  faction rooms, dead chat, notifications, investigations, and player command state.
  Revocation returns 403 and zero media bytes through the browser proxy while the opaque
  account session remains valid.
- Role data is access-controlled *and* the projection's reveal flag gates it; end-game
  reveal flips the flag ([02](02-event-sourcing.md)). The client UI hiding something is
  never the only line of defense.
- Mentionability is a public-profile boundary: only currently public profiles can be
  addressed, resolved through `public_profile` inside the posting transaction, never the
  blinded handle index. Slot mentions inherit channel read capability — naming a slot
  that cannot read the posting channel rejects without disclosing which side is missing
  ([RFC 0007](../rfcs/0007-first-class-mentions-and-addressed-delivery.md)).

## Encryption at rest and subject-owned private data

- **Every event body is sealed.** `payload`, `actor`, `causation_id`, and audit `meta` share one
  XChaCha20-Poly1305 envelope. Only ordering/type headers remain clear. A leaked event table or
  `StreamExport` v3 archive therefore exposes neither role/action/resolution content nor actor
  attribution in plaintext. AAD prevents relocating a body across stream, position, kind,
  version, logical time, or stream-key epoch.
- Each stream epoch owns a random data-encryption key. Event rows record only the epoch; Postgres
  stores the DEK wrapped by the active runtime KEK. Runtime KEK rotation rewraps the small key table
  without rewriting immutable event rows, while DEK rotation advances the stream's epoch. Exports
  rewrap the exact epoch keys under an independent archive KEK, so neither runtime KEKs nor plaintext
  DEKs cross the archive boundary.
- Profile presentation and game-persona ownership are separate subject-private claims. Canonical
  events retain only random `SubjectId`/`ClaimId` references; claim ciphertext uses a random
  per-subject key stored outside Postgres. Erasure records an append-only random-alias tombstone and
  external revocation receipt before destroying that key. Startup reconciles the external monotonic
  revocation journal before serving traffic, so restoring a pre-erasure database backup cannot make
  the destroyed subject claims readable again.
- Missing claim material fails closed for an active subject. For an erased subject, profile and
  game rebuilds deterministically fold the tombstone alias, clear private bindings and name claims,
  and never require the destroyed key. Database backups contain envelopes and tombstones, not
  subject keys. Hosted authority objects live in a dedicated shared S3-compatible bucket, never
  a per-replica filesystem or the media bucket. Each subject key is itself client-side AEAD-wrapped;
  revocation records are separately authenticated and immutable.
- Completed-game portability does not copy live game-persona claims or erasure tombstones. Its
  authenticated event bodies determine an exact set of game-scoped hashed subject references, each
  mapped to a canonical detached `Archived player …` alias under an outer archive checksum. An
  isolated import persists only those append-only aliases, leaves subject/claim tables empty, and
  commits event rows, aliases, first rebuild, and replay audit atomically.
- The subject-owned slice currently covers profile presentation, game-persona presentation/
  ownership, and member personal-export artifacts. Other retained content and service-required
  moderation evidence remain governed by their explicit retention policy; this is not a claim that
  all user-authored prose is erasable.
- Library-level local tests fall back to deterministic `local-dev` runtime-wrap and archive keys if
  `FMARCH_EVENT_WRAP_KEY` / `FMARCH_EVENT_ARCHIVE_KEY` are unset so tests stay runnable. The local real-stack harness
  opts into that debug-only fallback explicitly. Staged and production deployments must provide
  distinct `FMARCH_EVENT_WRAP_{KEY,KID}` and `FMARCH_EVENT_ARCHIVE_{KEY,KID}` values from the
  environment or a secrets manager.
- Startup (`require_secure_event_encryption_configuration`) rejects an active runtime or archive
  kid of
  `local-dev` unless the process is a debug build with explicit opt-in
  (`FMARCH_DEV_AUTH=1` or `FMARCH_ALLOW_INSECURE_DEV_EVENT_KEY=true`). Historical wrap/archive
  keyring entries exist only for bounded rotation and archive-retention windows.
- Release KEKs are canonical padded base64 encodings of exactly 32 random bytes; release
  startup never derives a key from a passphrase. Before listeners start, the exhaustive custody
  audit proves stream active-epoch state is current and authenticates a representative DEK for
  every persisted `event_stream_keys.wrap_kid`. Internet-facing readiness does not rescan the
  stream catalog: it authenticates only the O(K) immutable `event_direct_key_sentinel` catalog.
  Private-projection and delivery-credential sealing creates/authenticates that KID sentinel in
  the same transaction as the envelope, so omitting or misconfiguring any direct-envelope key
  fails readiness closed without making probe cost proportional to tenant data.
- Runtime KEK retirement is a forward-only, fenced lifecycle. `fmarch-event-key-admin` first moves
  the source KID from `writable` to `retiring`, which waits for in-flight writers and makes every
  later old-KID write fail. It then rewraps stream DEKs and reseals all nine registered direct
  envelope columns in bounded, resumable `SKIP LOCKED` batches. Generated KID columns, foreign
  keys, indexed exact-reference counts, and database write guards make zero old-KID references a
  monotonic fact after the fence. A separate key-removal rehearsal runs with the old KID absent
  from the admin process, records write-once evidence, and is required before the source becomes
  an immutable `retired` tombstone. The hosted historical key must be removed and every replica
  successfully redeployed between rehearsal and finalization; configured retired KIDs fail
  startup/readiness. Retired KIDs cannot be recreated or reused. The full operator
  sequence and backup-custody requirement are in
  [`runtime-kek-rotation.md`](../ops/runtime-kek-rotation.md).
- Database authority is process-specific. The Railway `migrator` is the only
  service with `DATABASE_MIGRATION_URL`; that direct schema-owner connection
  applies migrations, reconciles exact ACLs/default ACLs, audits both restricted
  roles, and exits. API and `fmarch-schema-gate` receive only `DATABASE_URL` for
  `fmarch_application`. `fmarch-event-key-admin` receives only
  `DATABASE_KEY_ADMIN_URL` for `fmarch_key_admin` in a protected ephemeral
  shell. The application and key-admin logins are non-owner, non-inheriting,
  `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS` roles;
  neither can disable triggers, alter the schema, assume the owner, or set
  `session_replication_role`. The catalog audit rejects missing and extra
  grants, PostgreSQL parameter authority, ownership drift, owner membership,
  unsafe `search_path`, and any
  residual database/schema/table/function authority for `PUBLIC`. The audit and
  ACL reconciliation run after restore even when `_sqlx_migrations` is current,
  because archive restore deliberately does not trust stored owners or ACLs.
  Staging and production use dedicated PostgreSQL server instances—not merely
  distinct database names on one server—because the two fixed login roles are
  cluster-global. Reconciliation governs the current database only; it does not
  revoke `PUBLIC CONNECT` across arbitrary databases on a shared cluster, so a
  dedicated instance is the containment boundary and shared clusters are
  unsupported.
  ACL repair governs new sessions: it cannot undo a privileged setting already
  executed in an established backend, so the initial greenfield cut precedes
  all application sessions and any later drift repair requires draining those
  sessions before admission.
  This split deliberately does not make a compromised application harmless:
  `fmarch_application` retains broad business DML and the API retains active
  runtime KEKs, so an application-process compromise can corrupt permitted
  business state and expose plaintext available to that process. The authority
  split protects schema/DDL, migration history, lifecycle guards, and the KEK
  administration lifecycle; it is not a guarantee of all business integrity or
  plaintext confidentiality after API compromise.
- Event envelope rotation is application-managed rather than KMS-backed or automatically retired. The external
  subject-key authority has an immutable genesis/revision manifest bound to the database, and normal
  startup refuses an unbootstrapped, wrong, unreachable, or incomplete authority. Its wrapping and
  journal-authentication KIDs and decoded key material must be pairwise distinct. They remain
  release secrets and rotate only through an explicit authority migration; deleted subject key
  objects must never be restored.
- A Railway Bucket closes database-only rollback and replica-local-volume failure, but it is not a
  WORM boundary. Coordinated rollback by a bucket administrator, or compromise of both database and
  authority credentials, is outside that deployment guarantee. A threat model that includes those
  actors must use an authority with object lock/version governance and KMS-backed custody rather
  than representing the Railway adapter as stronger than it is.
- Transport is TLS end-to-end; the at-rest layer is in addition to, not instead
  of, TLS. Hosted application, migrator, and protected key-admin PostgreSQL URLs
  carry exactly one explicit `sslmode` in `require`, `verify-ca`, or
  `verify-full`; omitted or opportunistic/downgrade modes are forbidden.

## Operational hygiene

- Secrets (DB creds, signing keys, encryption keys) come from the environment / a secrets
  manager, never source. (Cf. this machine's Keychain pattern for local secrets.)
- Dependency policy is checked in at `deny.toml` and
  `docs/ops/dependency-policy.json`. It evaluates the enabled Rust feature graph
  for macOS development and Linux deployment, blocks unapproved registries,
  Git sources, licenses, and advisories, and audits both npm lockfiles at
  moderate severity or above. Exceptions name their exact path, reason,
  removal condition, and review deadline; an expired exception fails proof.
- Every command's audit metadata records the **capability used**, actor, and request id
  ([02](02-event-sourcing.md)) — disputes and incident response replay exactly who did what
  under which authority.
- Structured security logging without sensitive payloads; no secrets or plaintext private
  content in logs.

## Why not E2EE (recorded)

E2EE for private channels would mean even the operator can't read them — which **breaks
moderation**, the core job of a forum-mafia host. We instead make the trusted server
defensible: least-authority capabilities, server-side visibility filtering, and encryption
at rest so a data leak isn't a plaintext dump. Revisit only if a future use case genuinely
needs operator-blind channels (and accepts losing moderation over them).

Continue to [07-images](07-images.md).
