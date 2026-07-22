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

- **Identity provider:** WorkOS AuthKit owns signup, email verification, passwords, passkeys,
  MFA, recovery, abuse controls, and browser-session refresh. SvelteKit stores the AuthKit
  session in its encrypted, httpOnly cookie; raw WorkOS access tokens are available only to
  server hooks and same-origin server endpoints.
- **API verification:** the Rust `identity` crate accepts RS256 only, selects the WorkOS JWKS
  key by `kid`, refreshes the key set once on an unknown key, validates `exp`, `iss`, and `sub`,
  and requires a WorkOS session id. The client-specific JWKS URL is configuration, not a token
  claim. The API receives public verification metadata,
  never the WorkOS API key or AuthKit cookie-encryption secret. Provider failures fail closed.
- **Stable local authority:** the immutable WorkOS `sub` is bound exactly once to a generated
  `platform_principal` through `external_identity`. Email is display metadata, never a primary
  key or authorization input. Each request rechecks that the local principal is active, then
  derives global and per-game capabilities from local state. Disabling a local principal cuts
  off HTTP and live transport without mutating the WorkOS user.
- **Bootstrap:** `FMARCH_BOOTSTRAP_ADMIN_WORKOS_USER_ID` may bind and grant the first
  `GlobalAdmin` on a fresh database. A transaction-wide advisory lock and the existing-admin
  check make this a one-time root-of-authority operation. Remove the variable after bootstrap.
- **Surface separation:** when WorkOS verification is configured, local password, registration,
  recovery, session-grant, credential-delivery, and legacy invite endpoints are not mounted.
  `/auth/login`, `/auth/register`, and `/auth/logout` become compatibility aliases for AuthKit
  sign-in, sign-up, and sign-out. Hosts share a WorkOS sign-in link for a locally authorized game
  principal; game membership remains a domain grant and is never modeled as a WorkOS organization.
- **Local proof mode:** `FMARCH_DEV_AUTH=1` deliberately restores the legacy Argon2id account,
  opaque-session, invite/recovery, and deterministic delivery machinery for hermetic browser and
  Postgres proof lanes. The server refuses to start without either the complete WorkOS verifier
  configuration or this explicit local-only switch. Local proof tables remain in the greenfield
  baseline so those tests are reproducible, but they are not a production identity fallback.
- **CSRF:** AuthKit's OAuth callback uses PKCE and state validation. Authenticated API calls carry
  explicit bearer authority from server-side SvelteKit code rather than ambient API cookies.
  The WebSocket uses a one-time, audience-bound ticket rather than a bearer token in its URL.

### Gameplay transport authentication

- Browser commands and private projection reads go through allowlisted same-origin SvelteKit
  endpoints. Those endpoints obtain the access token from AuthKit server locals and attach it as
  an API bearer credential; they reject a missing identity before making a privileged upstream call.
  Command wire bodies contain only a durable command id and the typed command. Any legacy or
  forged actor field is rejected by strict deserialization, and the API derives the actor from
  the enabled, unexpired, unrevoked session before it reads or writes gameplay state.
- Split-domain WebSockets use `POST /auth/websocket-tickets`. The API stores only a hash of each
  random ticket and binds it to the WorkOS session id, local principal, configured audience, game,
  channel, optional slot, durable `after_seq`, and the earlier of the local ticket TTL or access-token
  expiry. Redemption is an atomic one-time consume. Wrong-audience attempts do not consume the
  ticket; expired, replayed, forged, or locally disabled-principal tickets are rejected before
  upgrade, so no Hello frame or private byte is emitted. Local status and token expiry are checked
  again while the socket remains open.
- In-process broadcast remains the low-latency path, while every API instance polls the durable
  game event sequence. A commit on instance A therefore wakes a socket on B. Sequence movement or
  broadcast lag produces `ResyncRequired` followed by capability-filtered snapshots, and a fresh
  reconnect ticket hydrates projections from durable state even if the client cursor is stale.
- Query-supplied principals and the legacy direct WebSocket form exist only behind explicit local
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
HostOf(game)                run this game (deadlines, phases, reveals, replacements)
CohostOf(game)              delegated host authority for this game
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
- Local dev falls back to a deterministic `local-dev` key if `FMARCH_EVENT_ENCRYPTION_KEY` is
  unset so tests and scratch stacks stay runnable. Production/staged deployments must provide
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
