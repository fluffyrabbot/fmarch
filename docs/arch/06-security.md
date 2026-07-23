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
memberships, profiles, and game history reference only `principal_user_id` — adding or
removing a sign-in method never rewrites a principal.

- **Classic — direct sign-in (first-class, on by default):** Argon2id credentials, invites,
  recovery credentials, and login throttling, all server-local. Product promise: *your
  credentials and sessions stay on this server; no third-party identity provider is
  contacted.* A classic-only deployment has zero outbound identity dependencies.
  `FMARCH_CLASSIC_AUTH=0` disables it for a WorkOS-only deployment; startup requires at
  least one enabled method.
- **WorkOS — managed sign-in (additive):** AuthKit owns the interactive ceremony (signup,
  email verification, passkeys, MFA, provider-side recovery). The frontend confines AuthKit
  middleware and its sealed cookie to the start and callback routes; after the OAuth
  callback, the WorkOS access token is exchanged **exactly once** at `POST /auth/sessions`
  for the same opaque app session, and the AuthKit cookie is discarded. Provider JWTs are
  never per-request bearers.
- **API verification (exchange only):** the Rust `identity::workos` adapter accepts RS256
  only, selects the WorkOS JWKS key by `kid`, refreshes the key set once on an unknown key,
  validates `exp`, `iss`, and `sub`, and requires a WorkOS session id. The client-specific
  JWKS URL is configuration, not a token claim. Provider failures fail closed.
- **Stable local authority:** the immutable WorkOS `sub` is bound exactly once to a
  generated `platform_principal` through `external_identity` (`(provider, subject)` is the
  identity key; email is display metadata, never a primary key, authorization input, or
  auto-linking signal). Session validation rechecks that the principal and the
  authenticating method are still active on every request. Durable global capabilities are
  read from the principal on every validation; the session row stores only intentionally
  session-scoped grants, so removing a principal capability takes effect immediately.
  Per-game capabilities are likewise derived from local state. Disabling a principal
  revokes every method and session.
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
  at most one classic method exists per principal, removal revokes the sessions authenticated
  through that method, and re-adding the same disabled identity reactivates its stable method
  row with fresh credentials. Every transition writes `identity_lifecycle_audit`.
- **WorkOS adapter policy (recorded tradeoff):** there is no AuthKit refresh loop and no
  provider webhook; provider-side revocation takes effect when the local session expires,
  which is why WorkOS-exchanged sessions default to a shorter absolute TTL
  (`FMARCH_WORKOS_SESSION_TTL_SECONDS`, 24h) than classic ones
  (`FMARCH_SESSION_TTL_SECONDS`, 30d). A signed-out user cannot escape a WorkOS outage
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
- **Dev shortcuts:** `FMARCH_DEV_AUTH=1` gates only the dev-session endpoint and the
  query-param WebSocket form used by hermetic proof lanes. It is orthogonal to classic
  availability, which is production identity.
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
  state.
- Split-domain WebSockets use `POST /auth/websocket-tickets`. The API stores only a hash of
  each random ticket and binds it to the app session (its hash, method kind, principal),
  configured audience, game, channel, optional slot, durable `after_seq`, and the earlier of
  the local ticket TTL or session expiry. Redemption is an atomic one-time consume.
  Wrong-audience attempts do not consume the ticket; expired, replayed, forged, or
  disabled-principal/disabled-method tickets are rejected before upgrade, so no Hello frame
  or private byte is emitted. Session, method, and principal liveness are checked again while
  the socket remains open.
- In-process broadcast remains the low-latency path, while every API instance polls the durable
  game event sequence. A commit on instance A therefore wakes a socket on B. Sequence movement or
  broadcast lag produces `ResyncRequired` followed by capability-filtered snapshots, and a fresh
  reconnect ticket hydrates projections from durable state even if the client cursor is stale.
- Query-supplied principals and the direct WebSocket form exist only behind explicit
  dev-auth mode for old fixtures. Production routes have no such fallback.

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

- `SlotOccupant` is bound to the **current** occupant of the slot — after a replacement, the
  outgoing user's capability is gone and the incoming user's is granted, while the slot's
  history is untouched ([01](01-domain-model.md)).
- `private:role_pm:<slot_id>` membership is keyed to the stable slot in
  `private_channel_member`. Replacement therefore transfers Role PM read/post authority by
  changing `slot_occupancy`; it does not rewrite membership, authorship, or history.
- Pack-declared `private:mason` and `private:neighbor` membership is likewise keyed to the
  matching role slots. The outgoing account loses both `SlotOccupant` and the derived
  `ChannelMember` after replacement; the incoming account receives the same room history
  and media without copying or re-authoring either.
- `DeadViewer(game)` is derived by joining current `slot_occupancy` with `slot_state`. A dead
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
  `slot_occupancy`, `slot_state`) so they always reflect committed game state, never stale
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

## Encryption at rest

- **Private channel bodies and role assignments** are encrypted at the column level with a
  server-held key (managed via env today; KMS-backed rotation is future hardening). A leaked
  database or backup does not hand over scumchat logs or the role list in plaintext.
- The event log's *sensitive payloads* (e.g. `RoleAssigned`, private `PostSubmitted`
  bodies) are stored encrypted; non-sensitive event metadata stays queryable.
- Current implemented slice: `RoleAssigned` stores plaintext `slot_id` and an authenticated
  ciphertext envelope for `role_key`, `alignment`, and `role_effects`; non-`main`
  `PostSubmitted` stores plaintext `channel_id`, `slot_or_user`, `phase_id`, and media metadata
  with `body` in an authenticated ciphertext envelope. `eventstore::load_stream` and projection
  rebuild decode those envelopes at the durable read boundary.
- The local real-stack proof exercises this envelope independently for Mason and Neighbor
  browser posts: each room records two ciphertext envelopes, no plaintext `body` fields, and
  no plaintext body occurrence in the stored JSON. This is local at-rest and replay proof,
  not a hosted key-management or backup-encryption claim.
- Library-level local tests fall back to a deterministic `local-dev` key if
  `FMARCH_EVENT_ENCRYPTION_KEY` is unset so tests stay runnable. The local real-stack harness
  opts into that debug-only fallback explicitly. Staged and production deployments must provide
  `FMARCH_EVENT_ENCRYPTION_KEY` and `FMARCH_EVENT_ENCRYPTION_KID` from the environment or a
  secrets manager.
- The ciphertext envelope records an encryption key id alongside the ciphertext. Writes use the
  active `FMARCH_EVENT_ENCRYPTION_KEY` / `FMARCH_EVENT_ENCRYPTION_KID`; reads resolve by the
  envelope `kid` against the active key plus historical `FMARCH_EVENT_ENCRYPTION_KEYS`
  `kid=key` entries, so old and new encrypted payloads can coexist during manual rotation. This
  is not yet KMS-backed rotation, automated key retirement, or log re-encryption.
- Transport is TLS end-to-end; the at-rest layer is in addition to, not instead of, TLS.

## Operational hygiene

- Secrets (DB creds, signing keys, encryption keys) come from the environment / a secrets
  manager, never source. (Cf. this machine's Keychain pattern for local secrets.)
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
