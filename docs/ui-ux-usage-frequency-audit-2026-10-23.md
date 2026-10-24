# UX audit by usage frequency and timing — 2026-10-23

## Scope and method

Reviewed on `main` @ e156512b in the fixture workbench (`npm run ui:dev`) at
390 × 844, 1024 × 768 and 1440 × 920, with the Day and Night preview phases.
Surfaces: board, player main thread, player private channel, host console,
public game page, in-game menu, account menu. The question asked of every
control was: how often is it used, in which phase does it matter, and does
its placement match that.

This is a layout and information-architecture critique. It does not change
the Ballot & Lantern visual language, the legibility contract from
[RFC 0008](rfcs/0008-legible-game-surfaces.md), or the command boundary.

## Usage model

Frequencies are per player per Day phase in an ordinary 13-seat forum game.
They are the design input, not measurements; the shape (orders of magnitude
apart) is what matters.

| Action | Player, Day | Player, Night | Host, any | Where it lives today |
|---|---|---|---|---|
| Read thread | continuous | continuous | continuous | Player route only; host console has no thread |
| Reply / post | 5–30 | 0 (main locked) | 1–3 (votecounts, prods) | Second dock item, in-flow composer after the thread |
| Check own vote / tally | 5–10 | 0 | 5–10 | Game bar fact (hidden on phone), vote section below composer |
| Change vote | 1–3 | 0 | — | Primary dock button, picker section |
| Quote a post | 1–5 | 0 | rare | Pill button on every post header |
| Vote from a post | <1 | 0 | — | Second pill button on every post header |
| Night action | 0 | 1 | — | "Your night action" card in More, every phase |
| Read role card | <1 (first day), then ~0 | <1 | — | More |
| Read private messages | <1 | 1–2 | — | More |
| Join a day event | rare, time-boxed | 0 | — | Dock item with badge, in-flow section |
| Publish votecount | — | — | 1–3 per Day | Host Tools disclosure |
| Extend deadline | — | — | ≤1 per phase | Host Tools disclosure |
| Resolve / advance phase | — | — | 1 per phase | Host Tools disclosure |
| Resolve a prompt | — | — | rare, blocking | Host queue |
| Replace a player | — | — | rare | Host queue + Tools + standalone drawer |
| Modkill / slot lifecycle | — | — | very rare, destructive | Host Tools |
| Reveal roles | — | — | once, endgame | Host Tools |
| Invite players | — | — | setup only | Host console drawer |
| Switch theme | monthly | — | monthly | Permanent top-bar control at ≥560px |
| Role reference | monthly | — | — | Primary nav item |

Two conclusions fall out before looking at any pixel:

1. **Reply is the frequent write; Vote is the important write.** Prominence
   should follow frequency, and importance is handled by the confirmation step
   RFC 0008 already added. Today the dock inverts this: Vote is the filled,
   full-width primary and Reply is a text item.
2. **Half the player chrome is phase-specific and none of it knows the
   phase.** Voting is a Day activity; the night action is a Night activity.
   Both render identically in both phases.

## Findings

Measurements are from the fixture at the stated viewport.

### Player workspace

**P1. The dock leads with Vote in every phase.** At Night the filled slot
reads "Vote" (hollow, no vote), Reply is demoted beside it, and there is no
night action to offer. In Day the player posts far more often than they vote.

**P2. On phones the dock wraps to two rows.** Game bar 61px + dock 106px =
167px of the 844px viewport is fixed chrome, and the dock overlaps the last
post. "Event" with its badge forces the wrap.

**P3. "Sheets" are page sections, not sheets.** Vote, Events and More are
in-flow sections after the composer. The dock's Vote scrolls past the whole
loaded thread window and the composer, then offers "Return to thread". The
reader-navigation, saved-position, and return-trip machinery in the route is
there to make that round trip survivable; a sheet that overlays the thread
would not need most of it. At 1440px the reading lane is centred with roughly
350px of empty margin on each side, which is where a persistent rail belongs.

**P4. Every post header carries two 44px pill buttons (Vote, Quote).** On a
phone the meta row wraps under the author for every post; on tablet the pills
dominate the header. Quote is used in perhaps one reply in five; voting from a
post is rarer than that and already reachable from the dock.

**P5. The More section is phase-blind.** During Day it shows "Your night
action — isn't available: there is nothing to do right now", "Your role
arrives when the game starts", "Messages 0 — Nothing new", and a collapsed
History. Three of four cards are empty most of the time.

**P6. The game bar's one phone-width fact slot shows "Deadline · No deadline
committed".** "Your vote", the fact a player checks most during Day, is
hidden below 680px; "Leading count" is hidden too. A missing deadline earns
the only slot.

**P7. The sticky game bar is translucent and content bleeds through.** When
scrolled, "REPLY / Main thread / Everyone at the table reads this" is legible
under "Day 1" at both 390px and 1024px.

**P8. ~180px of chrome precedes the first post on every load.** The
official-post card, then a "Thread page / Older before #440 / Load older"
block. "Thread page" is engine vocabulary; the official post is already post
#444 in the thread.

**P9. The in-game menu is the site menu.** Your account, Games, Community,
Inbox, Search, Roles, Appearance, Manage account security. Nothing about this
game: no public read link, no pack-scoped roles, no host console for a host.

### Host console

**H1. The host cannot read the game from the console.** Hosting is mostly
reading the thread and reacting. The console has a queue, a canvas, and
technical drawers; the thread is on a different route with no link from the
host bar or the in-game menu.

**H2. A prompt states its question three times.** Title "Skip the next
day?", bold "A Beloved Princess died. Decide whether the next day should be
skipped.", then a button titled "Resolve prompt" carrying the same sentence
again. RFC 0008 decision 6 asked for the subject once.

**H3. "Technical details" is a label above a disclosure titled "Technical
details"** on both the prompt and deadline canvases.

**H4. Tools is a flat disclosure of six pills** (Deadline, Replacement, Phase
and thread, Votecount, Slot lifecycle, Roles). Three are per-phase routine
(votecount, deadline, phase), three are rare or destructive. Opening it
reflows the queue column instead of floating.

**H5. Three full-width drawers follow the workspace:** Replace a player,
Technical details, Player access. Replace a player duplicates the Replacement
task; Player access (invites) is setup-time work on an in-game surface.

**H6. The host bar shows "Attention · N tasks" and the deadline, but no
thread link and no "post as host".** The votecount post is the host's most
frequent write.

### Shell and board

**B1. The board hero is back.** RFC 0008 decision 8 removed the empty band
so the first game starts in the first viewport. The illustrated hero plus
three count tiles push the first card to y≈230 at 1024 × 768, and the counts
describe "this page", which stops meaning anything once the board paginates.

**B2. Board cards answer "what is this game", not "does it need me".** A
returning player wants: which of my games has an unread thread, an open vote
I have not cast, a deadline inside the hour. The card has a relation chip and
an absolute deadline only.

**B3. The top bar spends permanent room on monthly actions.** The Day/Game/
Night switch (~190px at tablet+) duplicates Appearance in the account menu
and is hidden on phones anyway. Roles is a reference lookup sitting in the
primary nav. Inbox has no unread count in the nav, which is the one thing a
nav item for an inbox should show.

**B4. The inbox page hosts "Muted members".** That is a privacy setting, not
an update stream.

## Decisions

Each decision names the rule it applies. Tiering is by impact over effort.

### Tier 1 — placement fixes inside the current topology

1. **Reply is the dock primary; Vote becomes a state chip.** (P1, rule:
   prominence follows frequency.) Day: `Reply` filled and flexible; `Voting
   Ilya · 3/7` or `Vote` as a bordered chip on the left; `More` on the right.
   Night: the vote chip is replaced by `Night action` when the player has one,
   and omitted when they do not; Reply remains (private channels still post).
   Confirmation in the picker stays as RFC 0008 decision 3 defines it.
2. **One dock row at every width.** (P2.) Event leaves the dock; an open day
   event is a game-bar status line with a Join control, in the slot the
   interruption line already uses. The badge moves to More only when the
   event has a private room with new posts.
3. **Phase-aware More.** (P5.) Role card always. Night action card only in a
   Night phase or when `actionPicker.actions` is non-empty. Messages only
   when the count is non-zero, otherwise a single "Nothing new" line. History
   stays collapsed.
4. **Game bar facts follow the phase.** (P6.) Day: `Your vote` then deadline
   countdown. Night: deadline countdown then `Action sent` / `Not sent`.
   When no deadline is set, the slot is not rendered; the vote section keeps
   "No deadline set".
5. **Opaque sticky bars.** (P7.) `--fm-raised-veil` on the game bar and host
   bar becomes `--fm-raised`; the blur stays on the dock only.
6. **Host prompt canvas states the question once.** (H2, H3.) Title is the
   pack label; one description paragraph; action buttons carry the choices
   ("Skip Day 2", "Keep Day 2"); the outer "Technical details" label is
   removed.
7. **Board hero becomes a title line.** (B1.) The count tiles are deleted;
   the first card starts within the first viewport at 1024 × 768.
8. **Thread head chrome collapses to one line.** (P8.) "Load older" is a
   single slim control; the pager cursor and "Thread page" label go to a
   `title` attribute; the official-post card is removed from the thread head
   and the latest votecount is linked from the vote chip instead.

### Tier 1 landing notes

Landed on branch `ux-tier1-dock-bar-phase` with two deviations from the text
above, both to keep existing proof semantics honest rather than rewrite them:

- The vote chip keeps RFC 0008's exact label (`Vote` / `Voting Ilya`) without
  the tally; the tally is the Day bar's "Your vote" fact and the picker.
- The night action card also renders for a completed game, because it is the
  surface that reports the closed action state to the live core-loop proof.
  Everything else about decision 3 holds.

The official votecount card moved into the vote sheet as a link to the post it
summarises, rather than being deleted, so the live-thread flow keeps one
visible element to read it from.

### Tier 2 — topology changes

9. **Vote and More become real sheets below 1100px, and a rail above it.**
   (P3.) `<dialog>`-backed bottom sheets opened from the dock, dismissed by
   Escape, backdrop or swipe; focus returns to the invoking control. At
   ≥1100px the frame is two columns: reading lane plus a sticky rail holding
   the vote tally with the picker, the role card, and messages; the dock is
   not rendered. "Return to thread" and the count/private reader trips are
   deleted with the sections they served. The composer stays in-flow after
   the thread on every width because that is where a reader is when they
   want to reply.
10. **Post actions become one overflow per post.** (P4.) Quote stays as a
    compact text control in the meta row; Vote and Copy link move to a
    per-post "···" menu. On pointer devices the row reveals on hover; on
    touch it is always visible but 32px tall.
11. **The host console gets the thread.** (H1, H6.) The console reuses the
    reading lane with a host composer; the queue is the rail at ≥1100px and
    a strip under the bar below it; a selected task opens as a sheet. The
    host bar gains `Post` and the attention badge; the Tools menu keeps the
    rare items.
12. **Host tools split by frequency.** (H4, H5.) Per-phase routine
    (Publish votecount, Deadline, End phase) is a compact tool row in the
    host bar. Tools becomes a popover menu holding Replacement, Slot
    lifecycle and Roles. "Replace a player" merges into the Replacement task
    canvas. Player access moves to the setup route's roster stage, with the
    replacement invite inside the Replacement task.
13. **The in-game menu starts with this game.** (P9.) First group: Read
    public thread, Pack roles (roles reference filtered to this pack), Host
    console when the viewer hosts. Second group: Games, Community, Inbox.
    Third group: Appearance, account.
14. **Primary nav is Games, Community, Inbox (with unread count), Search.**
    (B3, B4.) The theme switch leaves the top bar; Appearance in the account
    menu is the one path. Roles moves to Search and the in-game menu. Muted
    members moves to the profile edit route.

### Tier 3 — board as a needs-me list

15. **"Your games" first, with need state.** (B2.) Cards the viewer plays or
    hosts come first and show a deadline countdown, "You have not voted" in
    Day, "N new posts" from the reading checkpoint, and "N decisions" for a
    host. Other games follow with the current card.
16. **Deadline urgency in the bar.** With under an hour left in a Day phase
    and no vote cast, the vote chip takes the attention state and the
    countdown is red; after the deadline the chip reads "Passed".

## Suggested slices

| # | Slice | Decisions | Main paths |
|---|---|---|---|
| 1 | Dock, bar and More by phase | 1, 2, 3, 4, 5 | `ActionDock.svelte`, `GameBar.svelte`, `ContextSheet.svelte`, `game-route-model.mjs`, `player-vote-picker-model.mjs` |
| 2 | Host canvas and board copy | 6, 7, 8 | `host-task-workspace.mjs`, `HostTaskWorkspace.svelte`, `routes/+page.svelte`, `PlayerThread.svelte` |
| 3 | Sheets and the wide rail | 9, 10 | `GameFrame.svelte`, `VoteSheet.svelte`, `ContextSheet.svelte`, `reader-navigation.mjs`, `PlayerThread.svelte` |
| 4 | Host thread and tools | 11, 12 | `routes/g/[game]/host/+page.svelte`, `HostConsoleBar.svelte`, `host-console-critical-action.mjs`, setup roster stage |
| 5 | Menus and nav | 13, 14 | `AccountMenu.svelte`, `app-shell-model.mjs`, `AppShell.svelte`, inbox and profile routes |
| 6 | Board need state | 15, 16 | `app-shell-model.mjs` board cards, game index read, `deadline-countdown.mjs` |

Slices 1 and 2 are safe to land together and change no route topology.
Slice 3 deletes the reader-trip paths, so its role-smoke flows and visual
baselines are rebaselined in the same commit, as RFC 0008 did. Each slice
runs `npm run proof:remote -- --mode push` before landing.
