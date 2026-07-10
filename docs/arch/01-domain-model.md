# 01 — Domain model

This is the load-bearing document. Get these concepts right and the rest is mechanical;
get them wrong and you'll be fighting the software forever.

## The core distinction: User ≠ Slot

A **User** is a human account. A **Slot** is a *position in a game*. The two are not the
same, and conflating them is the single most common — and most unfixable — mistake in
forum mafia software.

- A slot is created when a game is set up (e.g. "Slot 7").
- A slot is **occupied** by a user. Occupancy is a *history*, not a field: when a player
  is replaced, the slot's occupant changes but the slot's identity, votes received, role,
  and post attribution all persist.
- Votes, deaths, role reveals, and post authorship attach to the **slot**, not the user.
- "Player 7 was hammered on D2" is a fact about the slot, regardless of which humans sat
  in it.

> **Why this is irreversible if you get it wrong:** if posts and votes reference `user_id`,
> the first replacement corrupts the game's history and there is no migration back. Slots
> are designed in from event #1. Exercise replacement on day one (see
> [08-roadmap](08-roadmap.md)).

> **The slot is also the engine's seat.** The resolution engine
> ([09-engine-and-packs](09-engine-and-packs.md)) operates *only* on slots (`SlotId`) and is
> **user-agnostic** — it never sees `UserId`. Replacement is therefore a purely
> platform-layer operation: swap the human behind a stable `SlotId` and the engine is never
> told. This two-layer split (forum platform vs user-agnostic engine) is the spine of the
> schema; it's why the `User ≠ Slot` distinction is worth enforcing in the type system.

## Entities

### Game
The container for one match. Has a **host** (and optional **co-hosts**), an ordered list
of **slots**, an ordered list of **phases**, and a set of **channels**. A game moves
through a lifecycle: `setup → signups → running → completed/archived`.

### Slot
A position in a game. Carries:
- **Occupant history** — ordered `(user, joined_at, left_at, reason)` records.
- **Lifecycle state** — `alive | dead | replaced_out | modkilled | spectating`.
- **Role** — assigned at game start, *hidden* until reveal conditions (death, game end).
- **Display identity** — slot number / alias used in-thread.

### Phase
An ordered, typed segment of the game: `Pregame | Day N | Night N | Twilight | Postgame`.
A phase has:
- a **deadline** (optional, mutable by the host),
- **posting rules** — who may post (e.g. Night locks the main thread; the dead can't post),
- **vote rules** — whether voting is open, and the hammer threshold.

Phases **partition** content. Every post and vote belongs to exactly one phase. This is
what makes "the votecount as of this phase" and "lock the thread at deadline" first-class
rather than bolted-on.

### Channel
A scoped messaging room. The main game thread is just the most public channel. Examples:
- `main` — the game thread (public to readers, postable by living players in Day phases)
- `scumchat` — the mafia's private night room
- `neighborhood` / `mason` — special private player groups
- `mod↔slot` — a host's private line to one slot (role PM lives here)
- `dead` — the graveyard chat
- `spectator` — read-only-to-game observers

A channel has **membership** (slots and/or hosts), **visibility rules** (who can read,
including retroactive reveal at game end), and optional **phase gating** (scumchat may be
night-only). Modeling all private messaging as *scoped channels* — rather than ad-hoc DMs —
means one mechanism covers role PMs, scumchat, neighborhoods, and mod comms, and the
moderator can be a member of all of them (server-trusted; see [06-security](06-security.md)).

Role PM identity is engine-owned and slot-stable. Starting a game declares one
`PrivateChannelDeclared` channel for every occupied, role-assigned slot, using
`private:role_pm:<slot_id>` and a one-slot membership. A post therefore remains attached to
the same channel and author slot across replacement; only the live `slot → user` occupancy
projection changes. Post-start slot/role assignment emits the same declaration when it first
makes a slot eligible. The player rail discovers the channel from `ChannelMember` rather than
inventing a shared `role-pm` route.

Pack-defined role groups use the same slot-stable mechanism. The mafiascum pack declares
`private:mason` for occupied Mason roles and `private:neighbor` for occupied Neighbor roles
at `StartGame` (only groups of at least two become rooms). Mason membership explicitly
reveals the group's Town guarantee; Neighbor membership reveals no alignment. Both room
identities and member slots remain unchanged across replacement while the live occupancy
projection transfers `ChannelMember` to the incoming account. The player rail and route
derive both rooms from that capability, and non-`main` post bodies use the generic encrypted
event envelope. Dead chat and spectator-room lifecycles are not yet implemented end to end.

### Post
Authored by a **slot** (in a game context) or a **user** (in non-game forum areas).
Belongs to exactly one channel and one phase. Content is **immutable**; edits are recorded
as events so the original is recoverable and "edited" is honest. May carry image
attachments (see [07-images](07-images.md)).

### Vote
A directed action: a slot votes *for* a slot (or for `no-lynch` / `unvote`). A vote may be
**parsed from a post** (e.g. a `##vote` token) or cast as an explicit action. A vote is a
[Submission](09-engine-and-packs.md) into the engine like any night action.

Two tallies exist on purpose. The **running votecount** is a cheap forum projection the
server folds from vote submissions for live UX (clients only render — never reimplement the
tally in TS). The **official outcome** (`DayVoteOutcome`) is **resolved by the engine under
the pack** ([09-engine-and-packs](09-engine-and-packs.md)), because vote weight, majority vs
plurality, no-lynch, and tiebreak rules are *culture-specific* and must not be hardcoded.
Hammer (threshold reached) is detected during resolution and can auto-advance the phase if
the pack configures it.

> **Open design call:** strict tag syntax (`##vote Alice`, `##unvote`) vs. freeform
> (`[vote]Alice[/vote]` or bracket-and-bold legacy styles). This shapes both the parser
> and the posting UX. Recommend **strict tags** for unambiguous parsing, with a
> client-side affordance (a "Vote" button that inserts the tag) so players never type it
> wrong. Recorded as unresolved pending your call.

## How they relate

```
User ──occupies (history)──▶ Slot ──belongs to──▶ Game
                              │                     │
                              │                     ├──▶ Phase (ordered, typed, deadlined)
                              │                     │
                              ├──authors──▶ Post ──in──▶ Channel ──scoped to──▶ Game
                              │                  └──during──▶ Phase
                              │
                              └──casts──▶ Vote ──targets──▶ Slot
                                          └──during──▶ Phase
                                                  │
                                          (projection) ──▶ Votecount
```

## Why event sourcing falls out naturally

Every noun above changes via discrete, meaningful occurrences: a vote is cast, a deadline
is extended, a slot is killed, a replacement completes, a role is revealed. These are
*events*. The "current state" players see — the rendered thread, the live votecount, the
alive list — are *projections* over the event log.

This isn't architecture for its own sake; it's the cheapest way to get the features this
domain demands for free:
- **As-of votecounts** — replay events up to post N.
- **Honest history** — edits, replacements, and deaths are recorded, not overwritten.
- **End-game reveal** — flip the visibility projection; the data was always there.
- **Audit & dispute resolution** — hosts can show exactly what happened and when.

See [02-event-sourcing](02-event-sourcing.md) for how the log and projections are built.

## Capabilities this domain implies

Authority here is intrinsically **per-game scoped**, which is why we use capabilities, not
global roles (see [06-security](06-security.md)):

- `GlobalAdmin`, `GlobalMod` — platform operators
- `HostOf(game)`, `CohostOf(game)` — run *this* game
- `SlotOccupant(slot)` — act as this slot (post, vote)
- `ChannelMember(channel)` — read/post in this channel
- `DeadViewer(game)` — see dead-visible content

A host of one game has no authority in another. `if user.is_admin` cannot express this;
a capability resolved per request can.

Continue to [02-event-sourcing](02-event-sourcing.md).
