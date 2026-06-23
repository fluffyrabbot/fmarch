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
   `DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run
   test:host-console-live-stack-smoke` starts the Rust API and SvelteKit together against a
   temporary database, seeds through `/commands`, drives the tablet browser route without
   route-level command or state mocks, verifies the browser reads the post-action state
   from the real API, posts to the role-PM private channel through the hydrated player UI
   and real `/commands` API, proves a private-channel 403 can recover through `Back to board`,
   and records tablet media request evidence from a live Rust `ThreadPage` media payload.
   The role-PM membership/media seed is scratch-database setup; the ACK, recovery navigation,
   API reads, SvelteKit rendering, and Chromium request evidence are live-stack proof.
   `npm run test:frontend-role-proof:browser` is the current full browser
   role proof; the latest local run passed and refreshed the browser-acceptance boundary,
   completion audit, and readiness summary to complete. It runs the Chromium smoke and then
   verifies the generated artifact shape. `npm run test:frontend-role-proof` is the
   restricted-sandbox proof lane: it does not bind localhost, but it does build the admin,
   player, and moderator route/component contracts, checks capability gating and forbidden
   messages, verifies 44px-modeled touch targets, exercises representative admin/player
   reject and moderator ack plus post-ACK projection paths, including the admin audit native
   inspect-route affordance plus principal-scoped operator-proof evidence endpoint and
   host-prompt ACK projection-patch and
   hydrated-refresh removal paths, and verifies that the role-smoke fallback artifact embeds
   the same static nav/focus contract, admin setup/recovery
   confirmation coverage, moderator critical-action confirmation coverage, and modeled
   confirmation initial-focus/focus-return/Escape/tab-containment semantics, plus
   fixture-routable empty/loading/reject route-state scenarios. It also runs
   `npm run test:frontend-route-state-render`, which build-mode SSR renders those forced
   states through the actual role pages and checks the shared shell, route-state root,
   model-owned 44px nav metadata, live-region status, and recovery action markup, plus the
   normal admin readiness/setup/audit/recovery surface including audit authority, boundary,
   and evidence targets, the native admin audit detail surface with its machine evidence
   link, the normal player projected deadline/votecount panel, player private disclosure
   collapsed/expanded markup without host-only copy, the normal moderator
   operations/critical-action/host-prompt surface, and already-open admin/moderator
   confirmation alertdialog markup including host-prompt resolution.
   The saved
   `target/frontend-static-role-contract/role-contract.json` and
   `target/frontend-route-state-render/route-state-render.json` artifacts record the
   restricted fallback boundary explicitly; they are supporting evidence, not a substitute
   for the Chromium smoke's rendered route-state, pixel, overlap, focus, or browser-interaction
   proof. The current `target/frontend-role-smoke/role-smoke.json`,
   `target/frontend-completion-audit/completion-audit.json`, and
   `target/frontend-readiness-summary/readiness-summary.json` artifacts come from the passed
   browser lane. Browser-passed role-smoke
   artifacts must include screenshot pixel metrics proving the saved board, role, forbidden,
   and route-state screenshots are nonblank at the exercised viewports. In sandboxes that
   reject localhost binds, the browser smokes write structured `EPERM` artifacts and stay
   nonzero unless
   `FMARCH_ALLOW_STATIC_ROLE_FALLBACK=1` explicitly opts into that static fallback. The
   browser-passed role smoke must also record real admin/moderator confirmation focus
   evidence for initial confirm focus, Escape return-to-trigger behavior, and local
   Tab/Shift-Tab containment, including the editable session-grant form fields. It must also
   record click-through from the admin audit list to the native inspect route, the
   principal-scoped operator-proof evidence endpoint, a nonblank detail screenshot,
   moderator host-prompt resolution evidence for typed
   `ResolveHostPrompt` ACK, refreshed prompt projection, and resolved prompt action removal,
   plus player private disclosure evidence before and after expansion with nonblank
   screenshots. The
   command-by-command proof matrix lives in
   [05](05-frontend.md#current-frontend-proof-commands).

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
