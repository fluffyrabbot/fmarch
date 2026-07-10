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

- **Passwords:** argon2id with sane params; never anything reversible. Never logged.
- **Sessions:** opaque, rotating session tokens in an **httpOnly, Secure, SameSite** cookie.
  `auth_session` stores token hashes and revocation/expiry data; `/auth/session` resolves
  bearer tokens into server-derived principals/capabilities and reports a server-declared
  refresh boundary after `FMARCH_AUTH_SESSION_ROTATION_MAX_AGE_SECONDS` (24 hours by default).
  The SvelteKit request hook atomically exchanges an overdue browser token before rendering;
  a concurrent loser clears its stale cookie. `/auth/session-logout` revokes only the presented
  active token and writes a redacted lifecycle audit row before the browser clears
  `fmarch_session`. Password rotation, recovery, and account disablement revoke active sessions;
  game-role capability changes are resolved from committed projections on every request rather
  than being copied into a browser token. `/auth/session-grants` remains the GlobalAdmin operator
  issuance boundary. Local HTTP development omits `Secure` only because localhost is not TLS.
- **Local registration:** `/auth/register` posts a validated email-style account identifier,
  a 12+ byte password, and a server-generated opaque token to the public registration endpoint.
  The API creates a server-generated principal, an unprivileged Argon2id account, its initial
  seven-day opaque session, and redacted `account_registered`/`account_session_created` audit
  rows in one transaction. A separate hashed source-only registration quota counts successful
  attempts as well as failures, so fresh account identifiers cannot bypass the bounded local
  rate limit. Registration reaches the seeded game role URL only in its explicit pending-authority
  state; it never creates `SlotOccupant`, channel, host, or global capability. Duplicate and
  rate-limited registrations keep the browser unauthenticated and expose a recoverable response.
  This is local browser proof only: it does not claim email verification, OAuth, passkeys, MFA,
  distributed abuse control, or a hosted identity provider.
- **Local credential delivery:** invite and recovery issuance first persists a typed
  `auth_delivery_intent` containing only the existing credential hash, account/principal
  identifiers, adapter state, attempt count, and retry timestamp. The deterministic local
  adapter can be forced to fail its first attempt with
  `FMARCH_LOCAL_DELIVERY_FAIL_FIRST_ATTEMPT=1`; a GlobalAdmin can retry an eligible intent
  through `/auth/delivery-intents/{delivery_id}/retry`, and every queued, failed, delivered,
  and retried transition is represented in the redacted identity lifecycle audit. The local
  Chromium identity proof follows both an invite and recovery credential through failure,
  backoff, retry, and the unchanged capability-derived role URL while confirming no raw
  credential is stored in the delivery outbox. This is a provider seam and local fake, not
  evidence of email/SMS traffic, bounce handling, hosted availability, or an operator SLA.
- **Brute-force defense:** account login, invite redemption, and account recovery share a
  two-tier Postgres failure window. Known accounts lock their hashed account/source scope after
  five failures; unknown account identifiers only increment a hashed source-pressure scope, so
  random identifiers cannot allocate one row each. The source tier defaults to 50 failures,
  both tiers return `429` with `Retry-After`, stale rows are pruned, successful credential use
  clears the relevant tiers, and missing account/invite/recovery paths consume a dummy Argon2id
  verification. Policy is read once into `ApiState`; the account/source thresholds, window,
  lockout, and retention are configurable through `FMARCH_AUTH_RATE_LIMIT_MAX_FAILURES`,
  `FMARCH_AUTH_SOURCE_RATE_LIMIT_MAX_FAILURES`, `FMARCH_AUTH_RATE_LIMIT_WINDOW_SECONDS`,
  `FMARCH_AUTH_RATE_LIMIT_LOCKOUT_SECONDS`, and `FMARCH_AUTH_RATE_LIMIT_RETENTION_SECONDS`.
  SvelteKit auth actions derive `x-fmarch-auth-source` from server-side
  `getClientAddress()`. `FMARCH_TRUST_AUTH_SOURCE_HEADER=1` is reserved for deployments where
  that trusted frontend or edge is the API's only caller and overwrites the header; never expose
  a trusting API directly to the public internet or forward a browser-supplied source value.
  Distributed edge enforcement, hosted policy tuning, and monitoring remain deployment work.
  Credential failures stay generic to avoid a user-existence oracle.
- **CSRF:** state-changing REST endpoints require an anti-CSRF token. The WebSocket is
  authenticated at handshake and bound to the session; commands carry no ambient cookie
  authority beyond that bound session.

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
