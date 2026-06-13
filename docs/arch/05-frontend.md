# 05 — Frontend (SvelteKit SPA, tablet-first)

One app, capability-gated. Players and hosts use the same SPA; what you can see and do is
determined by your capabilities ([06](06-security.md)), resolved by the server and
reflected in the UI. The **moderator console is the showpiece** and the reason "tablet-first"
is a hard requirement, not a nicety.

## Stack

| Concern | Choice | Notes |
|---|---|---|
| Framework | **SvelteKit** | lean runtime; small bundles serve the data-efficiency value |
| Language | **TypeScript** | strict; types generated from Rust ([04](04-wire-protocol.md)) |
| Transport | **WebSocket** (CBOR) + **REST** for cold loads/uploads | see [03](03-backend.md) |
| State | Svelte stores fed by the live delta stream | projections mirrored client-side |

> Solid is a viable alternative if we want an even leaner runtime; SvelteKit wins on
> batteries-included routing/SSR-for-cold-load and ergonomics. Recorded as the default.

## Tablet-first, for real

We design at **touch widths (1024–1280) first** and scale *up* to desktop, not a desktop UI
shrunk down.

- **Large hit targets** — minimum comfortable touch size; no tiny inline links for primary
  actions, especially in the mod console.
- **Thumb-reachable primary actions** — vote, post, and the host's frequent controls sit
  where thumbs are, not in a far corner.
- **Gestures where they read naturally** — e.g. swipe affordances in the mod console
  (process replacement, mark dead) backed by explicit confirm, never gesture-only for
  irreversible acts.
- **No hover-dependent affordances** — everything reachable by tap; hover is enhancement.

## App structure

```
routes/
  /                       board index (active games, deadlines)            [public-ish]
  /g/[game]               game shell: thread + channel switcher
    /thread               main thread view + live votecount
    /c/[channel]          a private channel (scumchat, neighborhood, mod↔slot)
  /g/[game]/host          THE MOD CONSOLE  (capability-gated: HostOf/CohostOf)
  /u/[user]               profile
  /auth                   login / session
```

## Key surfaces

### Live votecount component
Subscribes to the `votecount` projection delta stream. **The server tallies; the client
only renders** ([01](01-domain-model.md)) — we never reimplement vote parsing in TS. Shows
current count per candidate, votes-to-hammer, and the deadline countdown, updating live as
deltas arrive.

### Game thread
Paginated from `thread_view` (cold-loaded via REST, then live deltas). Posts show
edited/retracted state honestly ([01](01-domain-model.md)). Posting a vote is a **button
that inserts the canonical vote tag** so players never mistype it (resolves the parser-UX
concern from [01](01-domain-model.md) on the client side).

### Channel switcher
Lists only channels the user's capabilities permit. The client never *requests* a channel
it can't see, and the server wouldn't send its deltas anyway ([03](03-backend.md)) — defense
in depth.

### The moderator console (the showpiece)
A **touch control surface**, not a table of links. Frequent host actions as large,
unambiguous controls with explicit confirmation for anything irreversible:

- **Deadline** — set/extend with a slider + presets; live countdown.
- **Votecount** — force a recount, post an official votecount.
- **Replacement** — process a slot swap: pick outgoing/incoming, confirm; the slot's
  history is preserved server-side ([01](01-domain-model.md)). This is exercised on day one
  ([08](08-roadmap.md)).
- **Phase** — advance phase, lock/unlock the thread.
- **Roles** — bulk reveal at game end.
- **Slot lifecycle** — mark dead / modkill, with confirm.

## Data flow

```
   REST cold-load ──▶ seed Svelte stores (projection snapshots)
                            │
   WS Hello ──▶ subscribe (game/channel scope)
                            │
   Delta frames ──▶ apply to stores ──▶ reactive UI updates
                            │
   user action ──▶ Command frame ──▶ Ack/Reject (by id)
                            │            └─ Reject shows typed, actionable error
                            └─ optimistic UI only where safe; server delta is the truth
```

- **Read-your-writes** in the hot path is backed by the server's synchronous projections
  ([02](02-event-sourcing.md)); the client can reflect its own action immediately and
  reconcile against the authoritative delta.
- On reconnect: cold-load current projection state, resume the stream from the last `seq`
  seen ([03](03-backend.md)) — no gaps, no duplicates.

## Performance & data-efficiency

- Small bundles (Svelte's compiled output), route-level code splitting; the mod console
  ships only to hosts.
- Images requested at tablet-appropriate variant sizes ([07](07-images.md)); never the
  original.
- CBOR deltas keep the live channel light even during fast-moving twilight votecounts.

Continue to [06-security](06-security.md).
