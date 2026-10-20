# RFC 0008 — Legible game surfaces

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Created** | 2026-10-19 |
| **Accepted** | 2026-10-19 |
| **Decision owner** | Project owner |
| **Target** | Player workspace, host console, setup workflow, app shell, board |
| **Related** | [13-interaction-architecture](../arch/13-interaction-architecture.md), [RFC 0004](0004-principal-profile-privacy-boundary.md), [RFC 0007](0007-first-class-mentions-and-addressed-delivery.md), [09-engine-and-packs](../arch/09-engine-and-packs.md) |

## Summary

The interaction architecture in doc 13 is sound, but the surfaces built on it
leak the engine's vocabulary to people: players read `slot-2`, `slot_2` and
`Slot 2` for one person, hosts read `skip_next_day` and their own principal
UUID, setup asks for a "Principal ID", and an interrupted vote raises a
floating "command receipt" panel about command identity. Screen readers
announce `HostOf(midsummer)`.

This RFC makes legibility a contract. Every person in a game is shown by
persona name, every host decision by a pack-authored label, and every
interruption in player language. The internal identifiers stay on the wire and
in technical drawers for hosts and operators; they never reach a player's
reading surface. It is a greenfield cutover: the old labels, helpers, panel
topology and proof assertions are deleted rather than kept alongside.

## Evidence

Reviewed in the fixture workbench (`npm run ui:dev`) at 768×1024 and 375×812
on `main` @ 9782a3f6.

- Names are computed in seven places and none of them knows a name: server
  `slot_label` in `crates/api/src/game_http.rs`, plus `slotLabel` /
  `slotDisplayLabel` in `player-action-target-picker.mjs`,
  `host-phase-summary.mjs`, `day-vote-outcome-panel.mjs`,
  `host-prompt-resolution-history.mjs`, `host-route-model.mjs` and
  `setup-route-model.mjs`. Thread authors render the raw `slot_id`
  (`game-thread-author.mjs`). Persona names already exist in
  `game_persona_public` with name history; they are simply not served to
  players.
- The vote dock emits one button per legal target
  (`buildPlayerVoteCommands`). With a real roster this is an unbounded button
  row; in the fixture it showed only the front-runner, which reads as a nudge.
- The host queue lists the deadline as an attention item while it is
  "Ready", contradicting doc 13 ("an available command is not automatically a
  task"), and renders the pack's `prompt_kind` verbatim.
- The deadline canvas states the same consequence three times and draws a
  routine extension in the error colour.
- Setup seats players by pasted principal UUID, and its stepper scrolls
  sideways at 768px although doc 13 requires it to stack at or below 820px.
- Player context shows "No role assigned" beside a Role PM tab, "No private
  results visible to this session", and "Action submission checkpoint".
- Two navigation rows (Play/Host/Admin and Board/Community/Search/Inbox)
  overlap; capabilities the viewer lacks render as greyed controls; board cards
  carry a title and phase only.

## Decisions

### 1. A seat is shown by its persona name, with the seat number as a tag

Everywhere a seat appears — post author, votecount, vote picker, mention,
quotation, host queue, outcomes, history — the primary text is the persona's
public name and a short seat tag follows it (`Ilya · S2`). The tag is not
`#2` because `#` already marks post numbers (owner decision, 2026-10-20). The persona name is anonymous with
respect to the principal ([RFC 0004](0004-principal-profile-privacy-boundary.md));
no player surface pairs it with a profile handle.

A post is attributed to the persona that held the seat when it was written,
not the seat's current occupant. After a replacement, the seat shows
`Ilya (replaced Mira)` in the roster and votecount; earlier posts keep
`Mira · S2`. Renames follow `game_persona_name_history`: a post shows the name
in effect at its sequence, and the roster shows the current name.

*Rationale:* a game about reading people must lead with people. The seat tag
keeps replacements and votecount history unambiguous without making the number
the identity.

### 2. The server owns the roster presentation; the frontend owns none

Public game thread, player command-state and host-console reads carry one
`roster` array of wire `GameRosterSeat`:

```text
GameRosterSeat      { slot_id, alive, status, occupancies[] }
GameRosterOccupancy { began_seq, ended_seq?, names[] }   // [began, ended)
GameRosterName      { effective_seq, public_name }
```

It is a read-side join over `slot_state`, `slot_occupancy_epoch` and
`game_persona_name_history`, with `game_persona_redaction` overriding every
name of an erased persona, and it is rebuildable from the log. All sequences are
global event sequences, which thread posts expose as `source_seq`. It carries no
principal and no persona id. Seats sort by numeric suffix.

Posts, quotations, mentions, votes and outcomes keep addressing seats by
`slot_id` and carry their stream sequence; the single client resolver in
`seat-presenter.mjs` names a seat at a sequence by choosing the occupancy
covering it and that occupancy's latest name effective at or before it. The
current name is the open occupancy's last name. No other client code derives a
name, and server `slot_label` is deleted once slice 3 lands. Revealed roles stay
with the endgame summary, which already owns reveal policy.

Two kinds of post body carry a name, because there the body is the record
(slice 3b). A game mention is written `@<current persona name>`: the composer
offers the channel's occupied seats by name or seat tag and inserts the name,
and the server decides the span against the addressed seat's current
`game_persona_public` name. The decided mention still records the slot, so it
survives rename and replacement, and its chip renders through the presenter.
An empty seat has no name and cannot be mentioned. Bodies written before 3b
keep their `@slot` spans and render the same way. The official votecount body
names each candidate by the presenter's rule at publish time (`- Ilya · S2: 4`,
`- No lynch: 1`); `seat_label` in `crates/commands` mirrors `seatLabel`, and a
unit test pins it to the presenter's cases.

The host console's live channel sends `HostConsoleRosterChanged` with the whole
roster whenever it differs from the previous snapshot.

*Rationale:* seven partial name derivations cannot agree. The epochs and name
history are already the authority; serving them once per read is smaller than
stamping a name onto every post payload and live delta, and a replacement or
rename then never rewrites history.

### 3. Voting is a roster picker with an inline confirmation

The dock shows the current vote as its own state (`Voting Ilya`, or `Vote`
when none) and opens a picker sheet listing every living seat with its current
tally, sorted by seat number, plus No lynch when the pack allows it. Selecting
a seat turns the row into a confirmation (`Change vote: Mira → Ilya`) that
commits on a second tap; Unvote sits in the same sheet. The same sheet opens
from a post author's menu, preselected. The dock never offers a named vote
shortcut.

Doc 13's rule "legal vote shortcuts dispatch directly" is replaced by "the
vote shortcut opens the roster picker; a vote commits only on confirmation."

*Rationale:* a fixed button row does not scale past a handful of players and
privileges whichever targets fit. A one-step confirmation costs one tap and
removes mis-taps on a touch device, which matter in a game where a vote can
hammer.

Slice 4 settles the details. The picker lists the server's legal targets
(`vote_targets`) plus any seat already holding votes that the viewer cannot
choose (their own seat), so it doubles as the full count; the current vote's
row is marked and not offered again. Its rows sit in a disclosure that opens
when the dock or a post's Vote control asks for it, which keeps the page
within its compact budget at thirteen seats. Unvote stays visible and
disabled, with its reason, when there is no vote, and confirms like a vote
(`Remove your vote for Rook`). The dispatching control is the confirmation;
picker rows carry `data-vote-action` so proofs address a vote by its action
without clicking past the confirmation.

### 4. Interruptions speak about the player's intent, not the transport

An interrupted or rejected command becomes a compact status line in the game
bar — "Your vote for Ilya may not have gone through. Retry · Dismiss" — scoped
to its game and cleared when resolved or dismissed. Retry keeps the original
command identity underneath. The floating receipt panel, "command receipt",
"command ID" and "command identity" copy are removed from player surfaces.
Command traces remain in the host and admin "Technical details" drawers only.

*Rationale:* doc 13 already says technical traces belong in the activity
disclosure; the panel violated that and covered the thread on phones.

Slice 5 settles the details. The line sits in its own sticky slot directly
under the game bar rather than inside it, because the bar scrolls away and a
vote cast from the picker at the foot of the page must see its outcome. It
names the intent from the command and the roster ("your vote for Ilya", "your
post", "your night action") and gives each known rejection a player reason;
an unknown one says only that it didn't go through. A settled line shows
until the next command or Dismiss. Retry appears only for an interruption or
a rejection whose exact attempt is retained. Proofs read raw messages,
receipts and traces from the page's proof globals. The night action card's
diagnostic rows (actor, action state, receipt state, stale recovery) move to
slice 8 with the capability text: both are proof readouts on a player
surface, and live proofs read them through the same checkpoint attributes.

### 5. Player context states only what the player can act on

The More sheet has three sections: Your role (the role card, or "Your role
arrives when the game starts" before start — never "Unassigned" once seated),
Messages (night results and notices; empty state "Nothing new"), and History.
"Session", "checkpoint", "queue", "posture" and "projection" do not appear in
player copy. The game bar shows the deadline as a countdown on every
breakpoint.

In slice 4 the sheet reads More, ordered role, messages, history. A seat
before the deal reads "Your role arrives when the game starts". The night
action card is renamed "Your night action"; its receipt and recovery rows are
interruption copy and change with decision 4 in slice 5. The countdown reads
"4h 12m left", "Passed" once due, and keeps the absolute time for screen
readers and on hover.

### 6. The host queue holds decisions only; tools live in a menu

A host task exists only when the game waits on the host (pending prompts,
replacement requests, an expired deadline, a phase ready to resolve). The
deadline, votecount publishing, phase controls, slot lifecycle and roles move
to a host tools menu and the game bar; they enter the queue only when they
become due. An empty queue reads "Nothing needs you right now".

Packs declare `label` and `description` for every `prompt_kind`, and pack
validation rejects a prompt kind without them. The host canvas renders the
pack text and the affected seat by name ("Beloved Princess died — skip the
next day?").

The deadline control shows the current deadline once, a primary "Extend 24h",
a secondary "Extend 48h", and a "Set time…" picker; the consequence appears
once, beside the confirm. The error colour is reserved for irreversible
actions: kills, replacement, completing the game. "Hosting as @<uuid>" is
removed.

### 7. Setup seats people by handle and from the signup topic

The roster stage replaces the principal-ID field with a handle typeahead over
the existing `/profiles/mention-suggestions` endpoint; the command still
carries `principal_id`, resolved from the chosen suggestion. The persona name
is prefilled from the profile's display name and stays editable.

When the game has an origin signup topic, the roster stage offers "Seat
signups": it lists the topic's distinct public authors (excluding the host)
and, after one confirmation, adds the needed seats and seats each author. This
needs one new read, `GET /games/{game}/setup/signup-candidates`, authorised by
`HostOf`, returning `{ principal_id, handle, display_name, already_seated }`.

The stepper stacks at or below 820px as doc 13 already requires, and setup
headers use the game title, never its slug.

### 8. One navigation row; absent capabilities are absent

Capability names stop being display text. Today the raw `HostOf(game)` /
`SlotOccupant(slot)` string is rendered into screen-reader spans, technical
drawers and the role-smoke `capability` evidence, and two components
(`host-lifecycle-control-checkpoint.mjs`, `admin-surface-model.mjs`) even test
authority by matching that string. This slice passes typed capabilities to
those checks, renders a sentence ("Hosting Midsummer Invitational") using the
game title, and moves the role-smoke, DOM-smoke and `dev_test_game` evidence
from the display string to a `data-capability-kind` attribute.

The shell has one row: Games, Community, Inbox, and a search control. Host and
admin entry points move into the account menu and appear only for principals
holding the capability; nothing renders as a disabled role tab. Inside a game
the shell is the game bar alone, for players and hosts alike.

Board cards show phase and deadline, seats filled out of total, host persona,
signup status, and a "You're playing" or "You're hosting" marker. The primary
action follows the viewer: Play for an occupant, Host for a host, Read
otherwise. Actions the viewer cannot take are not rendered. The empty hero
band above the list is removed so the first game starts within the first
viewport.

### 9. Legibility is mechanically enforced

The role-smoke runner gains a legibility assertion applied to every visited
route's rendered text and accessible names: no `slot[-_]\d`, no UUID, no
`[A-Z][a-z]+Of(`, no `snake_case` token outside code blocks and post bodies, no
"command ID", "receipt", "principal" or "projection" on player routes. Host
and admin "Technical details" drawers are the only exempt regions and are
marked with `data-legibility="technical"`; post bodies are marked `data-legibility="author-content"`. Capability names are removed from
`fm-sr-only` text.

## Delivery slices

Each slice lands atomically with its role-smoke flows, proof expectations and
visual baselines rebaselined in the same commit; superseded topology
assertions are deleted, not preserved. Lanes come from `npm run proof:lanes`;
every slice passes `npm run proof:remote -- --mode push` before landing.

| # | Slice | Depends on | Main paths |
|---|---|---|---|
| 1 | Legibility guard and seat presenter | — | `tools/frontend_role_smoke*.mjs`, `frontend/src/lib/app/seat-presenter.mjs`, `presentation-copy.mjs`, `AppShell.svelte` |
| 2 | Server roster read | 1 | `crates/api/src/game_http.rs`, `crates/projections`, `crates/wire`, `crates/api/src/live_delivery.rs`, `frontend/src/lib/wire/types.ts`, `game-roster.mjs`, host live validators |
| 3 | Names on every player surface | 2 | `game-thread-author.mjs`, `player-thread`, `day-vote-outcome`, `player-action-target-picker.mjs`, mention and quotation models |
| 3b | Names written into post bodies | 3 | `crates/content_reference` slot mentions, `crates/commands` official votecount body, composer `@` insertion, `tools/dev_test_game*.mjs` body expectations |
| 4 | Vote picker and player context | 3 | `game-route-model.mjs`, `player-command`, `player-posture`, `player-role-card`, `player-private-queue` |
| 5 | Interruption copy | 3 | `CommandRecovery.svelte`, `command-interruption.mjs`, `player-command-receipt-model.mjs`, game bar |
| 6 | Host queue, pack prompt labels, deadline | 2 | `crates/domain/src/pack`, `packs/*/pack.json`, `host-route-model.mjs`, `host-action` |
| 7 | Setup seating and signup import | 2 | `setup-route-*.mjs`, `setup/+page.svelte`, `crates/api` setup routes |
| 8 | Shell, board and capability text | 1 | `app-shell-model.mjs`, `AppShell.svelte`, `routes/+page.svelte`, board route, `capabilities.mjs`, `presentation-copy.mjs`, capability evidence in `tools/` |
| 9 | Doctrine | 4, 6 | `docs/arch/13-interaction-architecture.md`, `docs/ops/completion-registry.json` |

Slice 1 keeps today's fallback wording ("Slot 7", "Slot 7 / Mira") so the
consolidation does not churn the live proofs; slice 3 changes the wording in
`seat-presenter.mjs` alone. Slice 1 lands its guard in report mode listing current violations; each later
slice removes its violations, and slice 9 makes the guard failing. Slices 6, 7
and 8 touch disjoint paths and may run in parallel once their dependency has
landed; slices 3 → 4 → 5 share the player route and run in order.

### Slice acceptance

1. The workbench report lists every current violation by route; the seven
   name helpers have one replacement with tests.
2. A pipeline test proves the roster for a renamed-then-replaced seat (the
   outgoing epoch keeps both names and closes before the incoming epoch begins),
   a dead seat and an unseated seat, numeric seat order, agreement with the
   open-occupancy selector, and identity after projection rebuild; a wire test
   proves a roster change travels as one `HostConsoleRosterChanged` cell. The
   host live channel and host-console validators require the roster; the
   player and public validators require it in slice 3, which consumes it.
3. Thread authors, quotations, mention chips, votecounts, vote and action
   targets, current vote, addressed notices, day-vote outcomes, endgame
   history and the public publication name personas through the roster as of
   each sequence; player and public-page validators require the roster.
3b. A game mention is typed and stored as `@<public name>` and decided against
   the addressed seat's current persona name, and the official votecount body
   names candidates (`- Ilya · S2: 4`); the composer, public publication and
   live `dev_test_game` body expectations follow.
4. A 13-seat fixture votes, changes vote and unvotes through the picker on
   phone and tablet; a vote never commits on the first tap; the role card never
   reads "Unassigned" for a seated player.
5. An interrupted vote shows one game-bar status line, survives reload within
   the game, and is absent on other routes.
6. Pack validation rejects an unlabelled prompt kind; every shipped pack
   passes; an idle game's host queue is empty; the deadline canvas states its
   consequence once.
7. A host seats a player by typing a handle, and seats all signup authors in
   one confirmed step; no UUID is visible; the stepper stacks at 768px.
8. One navigation row; a player sees no host or admin control anywhere; a
   board card states seats, host, deadline and the viewer's relation.
9. The legibility guard fails on violation across all role-smoke flows; doc 13
   records decisions 3, 4 and 6.

## Non-goals

- Inline `[vote]` tags parsed from post bodies.
- Pairing persona names with profile handles on any game surface.
- Visual-language changes; the Ballot & Lantern palette and type stay.
- Public publication and admin inbox layout, which doc 13 already settled;
  they receive only the legibility guard and name resolution.
