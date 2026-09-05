# 04 — Wire protocol (the Rust↔TS seam)

This is a load-bearing decision, not plumbing. The contract between the Rust core and the
TS client must be **compact** (data-efficiency value) and **versioned** (a years-old game
must still load in a current client). We get both with a schema-first, generated contract.

## Principles

1. **One source of truth: Rust.** Wire types are defined once, in the `wire` crate
   ([03](03-backend.md)), and TypeScript types are *generated* from them. The client never
   hand-writes a type that must match the server — drift is impossible by construction.
2. **Wire types ≠ domain types.** The wire is a *projection* of the domain for transport.
   Keeping them separate lets the domain evolve freely while the wire stays a stable,
   deliberately-versioned contract.
3. **Everything is tagged and versioned.** No untagged blobs. Old-tab/new-server and
   new-tab/old-data skew are *guaranteed* over a multi-year game lifetime; the protocol is
   built to survive it.
4. **Fail closed at ingress.** Envelopes, scopes, audiences, and delta bodies
   accept only their exact v3 shape. Unknown fields, unsafe numeric ids, scope
   mismatches, and audience/payload mismatches terminate the live generation.
5. **Pre-1.0 versions are reset, not emulated.** This greenfield workspace has
   no external clients. A superior contract advances the single global version
   and removes the obsolete shape instead of carrying a compatibility matrix.

## Format: REST/JSON commands and CBOR WebSocket deltas

- **CBOR** (via `ciborium` on Rust, a small CBOR lib on TS) — compact binary, schema-light,
  excellent serde support, far fewer bytes than JSON for the high-frequency live frames
  (votecount ticks, deadline countdown, new posts).
- **REST/JSON** carries authenticated commands, uploads, and cold loads
  ([03](03-backend.md)). It remains easy to inspect and naturally fits the
  SvelteKit same-origin session boundary.
- **WebSocket/binary CBOR** carries the server-to-client live stream. The
  browser obtains a short-lived, audience-bound ticket, opens the socket, sets
  `binaryType = "arraybuffer"`, and decodes only CBOR envelopes.
  Cold projection DTOs include `ThreadPage`, `PlayerNotification`, host/cohost-only
  `HostPhaseControl`, and host/cohost-only `ResolutionTraceInspectionReport`;
  live deltas wrap the reusable REST `ProjectionDelta` in an explicit,
  invariant-checked `LiveProjectionDelta { audience, delta }`.
- There is no JSON WebSocket compatibility mode. Debugging and tooling use the
  REST projections or decode the same typed CBOR envelope.
- CBOR uses the REST scalar vocabulary: UUIDs are canonical strings, never
  binary UUID byte arrays. The server serializes through its JSON value shape
  before CBOR encoding, so strict browser validators see the same identifiers.
- Audit-critical values represented as `u64` whose valid domain exceeds
  JavaScript's safe-integer range, such as DayEvent automatic-resolution
  seeds, use canonical unsigned-decimal strings in both JSON and CBOR. Rust
  unwraps the semantic value to `u64` only inside deterministic resolution
  code; browser code never coerces it through `Number`.

## Framing

Every message is an envelope:

```
Envelope {
  v:    u16,         // protocol version
  id:   u64,         // 0 for Hello heartbeat; contiguous 1..=2^53-1 for data
  body: {
    kind: Tag,       // Hello | Delta | ResyncRequired | Ack | Reject
    body: <variant>  // payload shape determined by kind
  }
}
```

- **Client → Server: REST commands.** Each command carries a durable
  `command_id`; retrying the same `(principal, command_id)` returns the original
  acknowledgement and appends no duplicate events. The payload carries no
  principal or actor-account field: the API derives the principal from the
  current enabled session before authorization, idempotency lookup, or event
  handling.
- **Server → Client: CBOR live envelopes.** The first frame and every heartbeat
  are id `0` `Hello` messages. Data ids start at `1`, remain contiguous, and
  never exceed JavaScript's largest safe integer. Subsequent frames contain
  authority-fenced, audience-scoped deltas or one terminal `ResyncRequired`.
  REST command responses carry typed `Ack` or `Reject` envelopes independently
  of the live connection.

```
REST Command:    SubmitVote { slot, target } | WithdrawVote | SubmitAction { slot, template, targets, grant_id? }
                 | WithdrawAction { action_id } | SubmitPost { channel, body, attachments }
                 | SetDeadline { game, at } | RequestReplacement { slot } | ...
REST Response:   Ack { id } | Reject { id, error }
Live ServerMsg:  Hello { protocol_v: 3, server, scope, caps }
                 | Delta { audience, delta }
                 | ResyncRequired { scope, audiences, from_event_seq }
```

`scope` is exact and immutable for one socket generation:
`{ game, channel, slot_id }`, with `slot_id` explicitly `null` for a
non-player connection. `audience` is one closed value:

| Audience | Allowed delta variants |
|---|---|
| `Game { game }` | `VoteCountChanged`, `VoteCountCleared`, `DayVoteOutcomeApplied` |
| `Thread { game, channel }` | `ThreadPostsChanged`, `ThreadPostRemoved`, `PostCitationsChanged` |
| `Host { game }` | all `HostConsole*` variants and `HostPromptsChanged` |
| `PlayerSlot { game, slot_id }` | `PlayerNotificationsChanged`, `PlayerInvestigationResultsChanged` |

The Rust constructors verify this matrix and every embedded game, channel, and
private audience slot. The browser repeats the validation before touching a
projection store. Host connections use `slot_id: null`; player connections use
their current actor slot. A public authenticated `main` connection may have an
empty capability list, while private channel and player-slot scopes require
applicable authority. `SlotOccupant` and `ChannelMember` grants carry their
game as well as their slot/channel, so authority cannot be borrowed across two
games that happen to reuse an identifier. The accepted Hello freezes an exact
audience entitlement set for that generation; every delta and every resync
audience must belong to it. Thread removals and citation changes repeat their
channel in the body, making cross-channel mutation rejectable before patching.

The server subscribes to change delivery before sending the first `Hello`; the
browser then performs its authoritative cold load while queuing validated live
frames. The server never hydrates a second competing snapshot over WebSocket.
Lag, an event-sequence gap, command-state invalidation, an unsafe id boundary,
or an indeterminate delivery failure produces at most one `ResyncRequired` and
then closes that generation. The browser invalidates affected projections,
retires the socket and ticket, remints authority, cold-loads, and opens a new
generation. No old-generation frame may follow resync.

The browser rejects a frame larger than 1 MiB before Blob materialization and
caps each generation at 64 queued frames. A slow consumer therefore loses one
generation and performs an authoritative reconnect instead of growing memory
without bound. Every close purges projection keys that declare a revocation
value before the close is published to UI observers; callbacks and store
subscribers are isolated so an observer exception cannot suppress cleanup or
reconnect scheduling.

The authority fence is held across each bounded socket write. Serialization or
fence-commit failure closes the socket; ids are never rewound after bytes may
have been accepted. A periodic id-0 `Hello` both renews the browser freshness
lease and rechecks session/scope authority. Capability grants are emitted in a
stable order so heartbeat fingerprints are deterministic.

Browser commands and private reads cross same-origin SvelteKit endpoints, which attach the
httpOnly session server-side. A live connection first obtains a short-lived, one-time ticket
from that same-origin boundary. Only the opaque ticket and its configured audience cross the
split-domain WebSocket URL; the principal, session token, game authority, and private scope do
not become browser-authored WebSocket query claims.

`Reject` carries a **typed, actionable error** (cf. [03](03-backend.md)) — `PhaseLocked`,
`NotYourSlot`, `AlreadyVoted`, `StreamConflict` — not a string the client must parse.

## Versioning & negotiation

- On connect, the server sends `Hello { protocol_v: 3, server, scope, caps }`.
  The client accepts exactly v3. Version or shape skew fails closed and starts a
  fresh connection only after an authoritative refresh; it is never guessed.
- **Variant tags are stable forever.** A `Tag` value, once shipped, keeps its meaning. New
  message types get new tags; obsolete ones are retired but their tag is never reused.
- **After 1.0, bodies evolve deliberately.** Until then, a breaking improvement
  advances the global version and updates server, generated types, browser, and
  proof fixtures atomically. There is no dual-version runtime.

## Type generation workflow

```
   wire crate (Rust, serde + ts-rs/specta derive)
        │  cargo test / build step
        ▼
   generated .ts type definitions  ──▶  committed into the SPA's types/ dir
        │
        ▼
   SvelteKit client imports them; tsc fails the build if client usage drifts
```

- The generation step runs in CI; a mismatch between the Rust types and the committed TS is
  a build failure. The contract cannot silently rot.
- Encoding/decoding helpers (CBOR ↔ typed object) are thin and shared; application code
  deals in typed objects, never raw bytes.

## Why not the alternatives (recorded, so we don't relitigate)

- **Plain JSON everywhere** — simplest, but heavier on the wire and, more importantly,
  *unversioned by default*; teams end up inventing ad-hoc version fields. Rejected on the
  data-efficiency and longevity values.
- **Protobuf / gRPC** — excellent schema evolution, but a heavier toolchain, awkward over
  browser WebSockets, and a second schema language to maintain alongside Rust. CBOR +
  serde + generated TS gives us *most* of the evolution safety with one source of truth in
  Rust. Revisit only if we need cross-language servers.
- **Untagged `bincode`** — most compact, but brittle: positional encoding makes additive
  evolution treacherous. We want self-describing-enough frames. Rejected.

Continue to [05-frontend](05-frontend.md).
