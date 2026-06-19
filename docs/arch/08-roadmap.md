# 08 — Roadmap: the first vertical slice

We do **not** build layer-by-layer (all the storage, then all the API, then all the UI).
We build a thin **vertical slice** that exercises the architecture end-to-end and proves the
hardest, least-reversible decisions early. If the slice feels right, everything else is more
of the same shape.

## The slice (proves the architecture end-to-end)

A single game, one channel, real votes, live, with the two irreversible mechanics exercised.

1. **Event store + one projection, end-to-end.**
   Append-only `events` table, optimistic concurrency, and the `votecount` projection folded
   from `VoteCast`/`VoteRetracted` in one transaction with the append
   ([02](02-event-sourcing.md)). Proves: the log, sync projections, replay determinism.

2. **A game thread with phases + vote submissions + engine resolution.**
   `PostSubmitted` events; phase gating ([01](01-domain-model.md)); the canonical vote-tag
   parser emitting `VoteSubmitted`/`VoteWithdrawn`; and a **minimal mafiascum pack** driving
   the engine's `DayVoteOutcome` at deadline ([09](09-engine-and-packs.md),
   [10](10-event-schema.md)). Proves: phases partition content, the platform→engine
   submission seam, and that the official outcome is engine+pack resolved (not a forum
   projection).

3. **Live votecount over the wire.**
   CBOR deltas over WebSocket ([04](04-wire-protocol.md)); the Svelte votecount component
   subscribing and rendering ([05](05-frontend.md)); types generated from the Rust `wire`
   crate. Proves: the Rust↔TS seam, generated types, live delta fan-out, capability-filtered
   delivery.

4. **The two irreversible mechanics — on day one.**
   - **`extend_deadline`** — a host capability action ([06](06-security.md)) through the full
     command pipeline ([03](03-backend.md)), rendered live in the mod console
     ([05](05-frontend.md)).
   - **`process_replacement`** — swap the human in a slot while preserving the slot's votes,
     posts, and role. **This is the design call that's unfixable if wrong**
     ([01](01-domain-model.md)), so we exercise it immediately, not in a later milestone.
   Proves: capability resolution at the boundary, User≠Slot, history preservation.
   Current proof: `host_action_commands_are_capability_gated_and_projected` posts both
   commands through `/commands`, verifies host/cohost rejection and acceptance at the API
   boundary, then reads `host-console-state` from committed projections to prove the deadline
   update and stable slot-history attribution. `npm run test:host-console-tablet-smoke` covers
   the tablet route's typed command adapter and post-ACK projection rendering.

If steps 1–4 feel clean, the architecture is sound. Everything after is breadth on a proven
spine.

## Why this order

- **Front-load irreversibility.** Replacement and the event-schema shape are the only truly
  one-way doors ([01](01-domain-model.md), [02](02-event-sourcing.md)). We hit them first,
  while changing course is cheap.
- **One thin path through every layer** surfaces seam problems (CBOR framing, type gen,
  capability passing, sync projection consistency) before we've built breadth on top of a
  bad seam.
- **A real, playable artifact** — even a one-channel game with a live votecount — is worth
  more for validating the domain than any amount of half-finished infrastructure.

## After the slice (breadth, in rough priority)

Not committed; sequence as needs dictate.

- **Private channels as scoped rooms** — scumchat, role PMs, neighborhoods; visibility
  filtering and encryption at rest exercised for real ([01](01-domain-model.md),
  [06](06-security.md)).
- **Image pipeline** — content-addressed ingest, transcode, EXIF strip
  ([07](07-images.md)).
- **Full mod console** — phase advance, lock/unlock, bulk role reveal, modkill
  ([05](05-frontend.md)).
- **Board / forum surface** — game index, non-game discussion areas, profiles.
- **Account lifecycle** — registration, session management, recovery
  ([06](06-security.md)).
- **Snapshots** — only if/when replay cost demands it ([02](02-event-sourcing.md)).
- **Archival & export** — a completed game exported as its event stream.

## Open design calls to close before/within the slice

These are flagged across the docs and should be resolved as they're hit, not deferred
indefinitely:

1. **Vote syntax** — strict tags (`##vote`) vs. freeform legacy
   ([01](01-domain-model.md)). Recommendation: strict tags + a client button that inserts
   them. *Needs your call.*
2. **Event-schema shape for slot/replacement** — the one irreversible modeling decision
   ([01](01-domain-model.md), [02](02-event-sourcing.md)). Draft and review before step 4.
3. **Codename / project name** — currently "the platform" ([00](00-vision.md)).

## Suggested next concrete step

Draft the **event schema for the game / slot / phase / vote core** — the types in the
`domain` and `wire` crates ([03](03-backend.md), [04](04-wire-protocol.md)) — since it's the
spine of steps 1–4 and contains the irreversible decisions. That's the natural thing to
write first in code.
