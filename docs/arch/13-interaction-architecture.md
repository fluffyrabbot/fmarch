# 13 — Interaction architecture

## Decision

Gameplay surfaces use different interaction paradigms because they serve
different cognitive jobs. Visual primitives are shared; page composition is not.

- The player surface is a reading-first conversation workspace with persistent,
  thumb-reachable action shortcuts.
- The host surface is an exception-driven task queue with one active decision
  canvas.
- Game setup is a guided workflow with a purpose-built roster editor inside the
  roster and role steps.
- Administrative pages may use dashboards because scanning system state is their
  primary job.

This replaces the earlier practice of composing every projection, receipt,
checkpoint, and available command into a permanent card stack.

## Shared concepts

`GameContext` is the small set of facts needed everywhere inside a game:

- game and phase identity;
- deadline;
- current vote and vote progress when applicable;
- actor posture;
- degraded live-update state.

`PlayerAttention` contains only information that might change the player's next
action: unread private items, a submitted action, current vote, command recovery,
and degraded synchronization.

`HostTask` is a decision waiting for a host. It has urgency, intent, consequence,
allowed commands, and resolution state. Healthy projections are evidence, not
tasks.

These are presentation selectors over authoritative projections. They do not
duplicate game rules or become a second source of truth.

## Player workspace

The thread owns the initial viewport. The game bar and channel tabs provide
compact context; they do not repeat explanatory state already available in the
thread or action surfaces.

The action dock remains reachable while reading:

- legal vote shortcuts dispatch directly;
- Reply moves to the channel composer;
- Count moves to the current vote and complete votecount;
- Act moves to phase-specific actions when they exist;
- More moves to private notices, role identity, activity, and game history.

The composer, action detail, and player context follow the thread in document
order. This keeps automation, keyboard access, and no-JavaScript behavior honest
while the dock provides one-tap navigation from any scroll position. Wider
screens add whitespace rather than a permanently open command inspector.

Successful command feedback is brief. Interrupted and rejected commands remain
persistent because they require a decision. Technical command traces stay in the
activity disclosure.

## Host workspace

The host console presents a queue of unresolved or time-sensitive tasks and one
selected decision canvas. Full projection evidence and audit activity remain
available in secondary drawers. An available command is not automatically a
task. Command feedback uses a shared status selector and each action reserves a
stable status floor, so pending and recovery messages do not move neighboring
controls.

## Setup workflow

Setup is a five-stage workflow: Pack, Roster, Roles, Rules, then Review and
start. A persistent stepper shows readiness for every stage while exactly one
working canvas is visible. Roster owns slot creation, occupant assignment, and
invitations; Roles owns role assignment; Rules owns posting policy. Review turns
blocked readiness checks into correction links that select the stage where the
problem can be fixed. Starting the game remains an explicit,
consequence-previewed confirmation.

## Responsive rules

- Phone: one compact app bar, a full-width reading lane, and a bottom action dock.
- Tablet: the same semantic order with a wider reading measure. Temporary detail
  may use the available side space, but is never permanently reserved.
- Desktop: preserve the reading measure and use the extra space for optional
  context, not additional dashboards.

Primary controls have a 44px minimum target. No action depends on hover or a
gesture. Document order remains useful without client-side enhancement.

## Visual hierarchy

- Use cards for discrete objects or temporary work, not as the default section
  boundary.
- Use one ambient phase treatment; component colors remain stable.
- Reserve accent color for selection and the primary action.
- Healthy connectivity is silent. Degraded connectivity appears in the game bar.
- Posts use typography and rhythm as their main separators.

## Acceptance budgets

- Substantive player thread content begins within 260px on phone and tablet
  fixtures.
- Vote and reply are reachable in one interaction from any thread position.
- The player route has no permanent command column.
- Desktop width does not increase the number of initially visible status panels.
- The host first viewport contains the highest-priority task, its consequence,
  and its primary action.
- Proof lanes exercise player and host tasks rather than requiring legacy panel
  topology.

## Migration order

1. Replace the player masthead, channel cards, and command rail with the game
   frame, game bar, channel tabs, content-following sheets, and action dock.
2. Replace the host wall of controls with `HostTask` navigation and a decision
   canvas.
3. Convert setup to the guided workflow. Complete.
4. Reassess public and admin surfaces independently; do not force either through
   the gameplay composition.
