# 05 — Frontend (SvelteKit, tablet-first)

One server-rendered, hydrated SvelteKit application serves players, hosts,
community members, and operators. Route loaders resolve the API session and
capabilities; browser models render the admitted projections. Authorization
remains a server responsibility ([06-security](06-security.md)).

## Stack and ownership

| Concern | Owner |
|---|---|
| Routes, SSR, same-origin session/API boundary | SvelteKit with adapter-node |
| Components and view models | Svelte components plus JavaScript `.js`/`.mjs` modules |
| Shared transport declarations | Generated Rust→TypeScript contract in `src/lib/wire/types.ts` |
| Runtime transport validation | `src/lib/app/live-transport.mjs` and wire validators |
| Cold reads and commands | HTTP through SvelteKit server adapters |
| Live updates | Ticketed binary-CBOR WebSocket from the API |
| Presentation state | Projection stores and role-specific selectors |

The generated contract does not make the JavaScript application statically
verified. `npm --prefix frontend run check` probes the toolchain; contract,
render, browser, and live-stack lanes prove different behavior. See
[frontend proof](../ops/frontend-proof.md).

## App structure

Representative routes (the source tree owns the complete route set):

| Route | Purpose |
|---|---|
| `/` | Board and discovery |
| `/discussions/[slug]`, `/search` | Community discussion and public search |
| `/profile/edit` | Member profile editing |
| `/g/[game]` | Player's active game thread |
| `/g/[game]/c/[channel]` | Capability-gated private or spectator channel |
| `/g/[game]/setup` | Guided host setup |
| `/g/[game]/host` | Host/cohost task workspace |
| `/g/[game]/host/export` | Completed-game export |
| `/auth/login`, `/auth/register`, `/auth/game-invite` | Sign-in and invitation entry |
| `/auth/account/security` | Methods, sessions, export, and erasure controls |
| `/_dev/ui`, `/_dev/ops` | Explicit local fixture/diagnostic surfaces |

The root layout owns the shared `AppShell`; role pages render surface content
instead of nesting another shell. Shared headers, touch controls, status
primitives, and confirmation components own presentation mechanics. Role
models own the facts, available actions, and capability-derived destinations.
Do not turn local proof artifacts into ordinary product navigation; follow
[proof-product-freeze](../ops/proof-product-freeze.md).

## Interaction contract

[13-interaction-architecture](13-interaction-architecture.md) owns page
composition: reading-first player view, host exception queue, six-stage setup,
and secondary evidence drilldowns. Keep the thread visible and primary
controls stable as receipts and live state change. A permanent dashboard of
all available projections is not the page model.

Shared acceptance rules:

- Primary controls have a 44×44 CSS-pixel hit area, visible focus, and adequate
  spacing. Tablet layouts account for safe areas and reachable action docks.
- Every action works through visible tap or keyboard controls. Hover and
  gestures cannot be the only way to discover or complete it.
- Destructive host actions use a named confirmation with explicit confirm and
  cancel controls, focus entry/return, Escape cancellation, and local Tab
  containment.
- Loading, rejection, command receipts, and degraded live state use stable
  status regions. New text must not move an action under the user's finger.
- Keyboard order follows the workflow, starting with the skip-to-content link.
- Private disclosures are collapsed until explicitly opened; route links can
  reopen a particular visible item without exposing host-only state.

## Commands and reading

Votes use server-supplied legal target controls and typed `SubmitVote` or
`WithdrawVote` commands. Posts are never parsed for vote tags. The server
computes both the running count and official engine outcome; the client renders
those projections ([01-domain-model](01-domain-model.md)).

Thread paging and reader navigation operate on authoritative pages and sequence
anchors. Structured quotations and mentions are write-time values, not parsed
post markup; their identity and visibility rules live in RFCs
[0002](../rfcs/0002-first-class-quotations.md) and
[0007](../rfcs/0007-first-class-mentions-and-addressed-delivery.md).

Private room ids and navigation come from capabilities. Role-PM rooms use
`private:role_pm:<slot_id>`; faction and DayEvent rooms have their own declared
identities. The route checks its channel before rendering, and the API checks
thread reads, commands, media, and live delivery independently. A fixture label
such as `role-pm` is not a production room identity.

Thread images use projection-provided, reference-authorized variants. Uploads
submit canonical content ids and alt text; the browser cannot persist its own
URLs or dimensions. Ingest, transcode, immutable storage, and authorization are
implemented in [07-images](07-images.md), including the local live upload proof.

## Data flow and recovery

```text
REST route load → validate projection snapshots → seed stores → render
Live ticket → socket → exact Hello → authoritative refresh → live deltas
User action → HTTP command → Ack/Reject → authoritative projection update
```

A socket's raw `open` event does not mean the view is synchronized. The live
owner validates the exact protocol version, immutable scope, audience, and
contiguous frame ids; it admits updates only after Hello and a full refresh.
[04-wire-protocol](04-wire-protocol.md) owns the complete generation contract.

`ResyncRequired` ends the generation. The browser retires it, remints a ticket,
validates a new Hello, and refreshes before consuming new deltas. Old-generation
responses cannot overwrite the new state. Visibility, online, and bfcache
`pageshow` recovery remint tickets and refresh; generic failures use bounded
backoff and freshness leases.

Interrupted commands retain their original `command_id` in tab session storage
for idempotent retry. Projection data and route HTML are not persisted there.
An ambiguous command result must retry the same id rather than invent a new
mutation. Server projections remain authoritative after optimistic feedback.

## Local iteration and evidence

Use [the UI workbench](../ui-workbench.md) for fixture-driven visual work on
real routes. Use [human-run test games](../ops/human-run-test-games.md) when API,
authority, persistence, or reconnect behavior is part of the change.

[Frontend proof](../ops/frontend-proof.md) owns command selection and artifact
boundaries. Current completion comes from generated evidence and the
[completion registry](../ops/completion-registry.json); this document does not
claim that a previously run browser suite still passes.

Continue to [06-security](06-security.md).
