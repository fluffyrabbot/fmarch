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
4. **Additive evolution only** — same discipline as the event log ([02](02-event-sourcing.md)).

## Format: CBOR over WebSocket

- **CBOR** (via `ciborium` on Rust, a small CBOR lib on TS) — compact binary, schema-light,
  excellent serde support, far fewer bytes than JSON for the high-frequency live frames
  (votecount ticks, deadline countdown, new posts).
- **WebSocket** carries the live bidirectional stream. REST (also CBOR, or JSON for
  debuggability on cold endpoints) carries uploads and cold loads ([03](03-backend.md)).
- JSON remains available behind a content-negotiation header for debugging and tooling —
  the *types* are identical; only the encoding differs.

## Framing

Every message is an envelope:

```
Envelope {
  v:    u16,         // protocol version
  id:   u64,         // monotonic per-connection; commands echo it in their ack
  kind: Tag,         // discriminant: which message variant
  body: <variant>,   // the payload, shape determined by kind
}
```

- **Client → Server: Commands.** `id` lets the client correlate the `Ack`/`Reject` to the
  command it sent. Each command body also carries a durable `command_id` used for
  idempotency across reconnects and lost acks; retrying the same `(principal, command_id)`
  returns the original ack and appends no duplicate events.
- **Server → Client: Events / Deltas / Acks.** Projection deltas ([03](03-backend.md)),
  command acknowledgements, and errors.

```
Command  (C→S):  Vote { slot, target } | Unvote | SubmitPost { channel, body, attachments }
                 | SetDeadline { game, at } | RequestReplacement { slot } | ...
ServerMsg (S→C): Ack { id } | Reject { id, error } | Delta { projection, change }
                 | Hello { protocol_v, server_v, caps } | Resync { from_seq } | ...
```

`Reject` carries a **typed, actionable error** (cf. [03](03-backend.md)) — `PhaseLocked`,
`NotYourSlot`, `AlreadyVoted`, `StreamConflict` — not a string the client must parse.

## Versioning & negotiation

- On connect, the server sends `Hello { protocol_v, server_v, caps }`. The client knows the
  range it supports; if the server's `protocol_v` is newer, the client degrades gracefully
  or prompts for refresh. The protocol version is explicit, never inferred.
- **Variant tags are stable forever.** A `Tag` value, once shipped, keeps its meaning. New
  message types get new tags; obsolete ones are retired but their tag is never reused.
- **Bodies evolve additively.** New optional fields only. A new client reading an old
  delta, and an old client reading a new delta (ignoring unknown fields), both work.

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
