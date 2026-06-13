# 00 — Vision & values

## What we're building

A from-scratch forum + messaging platform whose first-class use case is **forum mafia**
(Mafia / Werewolf played out across forum threads): text and image posts, threaded game
play, private rooms, and the moderation tooling a host needs to run a game cleanly.

It is a general-enough forum to host discussion, but it is *designed around the game*,
not retrofitted for it.

## Who it's for

- **Players** — read/post in game threads and their private channels, cast votes, on a
  phone or tablet as comfortably as a desktop.
- **Hosts / moderators** — run a game: set deadlines, watch the live votecount, process
  replacements, reveal roles at end. The host console is a **touch-first control surface**
  and is the product's showpiece, not an afterthought.
- **Admins** — operate the platform: users, games, storage, moderation escalation.

## Values that gate every choice

These are the tie-breakers. When a decision is close, the option that better serves a
value below wins.

1. **Model the game, not the board.** The defining primitives of forum mafia (phases,
   votecounts, scoped channels, slots) are first-class. We never approximate them with
   generic forum features. See [01-domain-model](01-domain-model.md).

2. **The truth is an event log.** State is derived. "What was the votecount as of post
   #847?" must be answerable by construction, not by archaeology.
   See [02-event-sourcing](02-event-sourcing.md).

3. **Data-efficient.** Compact wire frames, deduplicated content-addressed media,
   tablet-appropriate image sizes. Bytes are a feature. We push deltas, we don't poll.

4. **Professional-grade substrate.** Server-trusted with strong authz, encryption at
   rest for private content, an explicitly versioned wire protocol that lets a years-old
   game still load in a current client. Schema evolution is a day-one concern, not a
   someday-concern. See [06-security](06-security.md) and [04-wire-protocol](04-wire-protocol.md).

5. **Tablet-first, touch-real.** Especially the moderator console. We design at touch
   widths with large hit targets; we do not ship a desktop UI shrunk down.

6. **Authority is explicit.** No ambient `if user.is_admin`. Authority is a capability
   that is resolved at the trust boundary and passed inward, scoped to a game where the
   game scopes it. See [06-security](06-security.md).

## Non-goals (at least for v1)

- **End-to-end encryption of private channels.** Moderators must be able to read
  scumchat and role PMs; that's intrinsic to running a fair game. We choose server-trusted
  encryption at rest instead. This is a deliberate, recorded decision.
- **Federation / ActivityPub.** Out of scope; would compromise the moderation model.
- **A plugin marketplace / theming engine.** Later, if ever.
- **Generic real-time collaboration (docs-style).** Not the shape of this product.

## The shape of the system

```
            ┌─────────────────────────── clients (SvelteKit SPA, tablet-first) ───────────────────────────┐
            │   game thread view   │   private channels   │   live votecount   │   MOD CONSOLE (touch)     │
            └───────────────▲───────────────────────────────────────▲──────────────────────────────────────┘
                            │  CBOR frames over WebSocket (versioned) │  REST for uploads / cold loads
            ┌───────────────┴─────────────────────────────────────────┴──────────────────────────────────┐
            │  Rust service (axum + tokio)                                                                 │
            │    commands ─▶ capability check ─▶ validate ─▶ append events ─▶ update projections           │
            └───────────────┬───────────────────────────────────────────────────────────────┬────────────┘
                            │                                                                 │
                  ┌─────────▼──────────┐                                          ┌───────────▼───────────┐
                  │ Postgres           │                                          │ Blob store            │
                  │  events (append)   │                                          │  content-addressed    │
                  │  projections (RO)  │                                          │  AVIF/WebP variants   │
                  └────────────────────┘                                          └───────────────────────┘
```

Continue to [01-domain-model](01-domain-model.md).
