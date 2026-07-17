# Tablet first-viewport UX audit — 2026-07-17

## Scope and baseline

The UI workbench was reviewed at the tablet baseline of **1024 × 768 CSS pixels** with the player and moderator roles open side by side. The audit covers the first viewport only and prioritizes information hierarchy, action prominence, touch ergonomics, and state copy.

The workbench scenarios were:

- Player: `/__workbench/player`
- Moderator: `/__workbench/moderator`

This is a visual and interaction audit of seeded workbench state. It does not claim production data, network, authentication, or assistive-technology coverage.

## First-viewport measurements

| Surface | Before | After shared primitives |
| --- | --- | --- |
| Player status strip | 284px tall; 2 columns; third item orphaned on a second row | 112px tall; 3 adaptive columns |
| Player primary controls | Command panel began below role and submission evidence; 0 gameplay actions visible | Command panel leads the rail; 2 enabled vote actions fully visible at 50px tall |
| Moderator status strip | 284px tall; 2 columns across 2 rows | 112px tall; 4 adaptive columns |
| Moderator primary controls | Control surface began at y=934; 0 moderator actions visible | Control surface begins at y=373; 3 enabled deadline actions fully visible at 44px tall |
| Horizontal fit | No page overflow | No page overflow |

## Prioritized UX punch list

### P0 — cross-surface hierarchy and action access (implemented)

1. **Primary role actions were absent from both first viewports.** Status, evidence, and checkpoint surfaces consumed the fold before the player could vote or the moderator could act. The shared solution is an explicit primary-action zone and route ordering that places action surfaces before supporting evidence.
2. **Tablet status strips used desktop-height cards in a two-column layout.** This consumed 284px and gave the three-item player strip an orphan row. Tablet strips now use adaptive columns with a 200px minimum, a 112px tile floor, and concise visible state; supporting detail remains available to assistive technology.
3. **Player vote actions were coupled to the long post composer.** Vote and withdrawal controls now have a reusable adaptive action tray above channel, post, and media inputs. Posting remains in the composer because it depends on composer state.
4. **Action layouts did not share a cross-role priority grammar.** Player and moderator surfaces now expose `data-action-priority="primary"`, use the same accent boundary, and share an adaptive action-tray primitive with touch-safe sizing.

### P1 — individual surface refinement (next)

5. **Player channel navigation collapses too aggressively inside the tablet side rail.** The current rail affords only a narrow, truncated target and weak channel differentiation. Replace the tablet side rail with a compact horizontal channel switcher or a single current-channel control with a sheet/menu; preserve 44px targets and show the complete channel name before capability detail.
6. **Player command rail is still information-heavy.** The deadline card and full votecount precede the vote buttons. Collapse the deadline to one line, limit the first viewport to the leading vote rows, and provide an explicit “Full count” disclosure.
7. **Moderator action bays expose protocol detail before intent.** Labels such as command type, endpoint, and Ack/Reject boundary compete with the human task. Make intent, consequence, and current eligibility primary; move transport and proof language into a disclosure.
8. **Player role and action checkpoint cards are too dense for a narrow rail.** Their headers and status copy compete in 249px. Recompose them as compact summaries with one disclosure each rather than shrinking type.

### P2 — state copy and shell clarity

9. **State copy is duplicated across masthead, status strip, and action surfaces.** Give each layer one job: masthead answers “where am I?”, status strip answers “what needs attention?”, and the action surface answers “what can I do now?”.
10. **Internal engine language leaks into role-facing copy.** Replace strings such as `/commands`, `Ack or Reject`, `enabled:mark_dead`, and `skip_next_day` with task language. Keep canonical command identifiers in data attributes, receipts, or expandable diagnostics.
11. **Connection state lacks a user outcome.** “Connecting live projection” should say whether actions remain safe, when retry happens, and what the user should do if it persists.
12. **Session/capability copy dominates the global shell.** Reduce it to identity plus active role; move the full capability set behind an account/session affordance.

## Shared primitives implemented in this round

- `.fm-primary-action-zone`: a common visual and scroll boundary for the role’s primary control surface.
- `.fm-action-tray`: an adaptive grid for touch actions that preserves minimum usable width and removes fixed role-specific button columns.
- Compact adaptive tablet status strips: one scan row at 1024px for both audited roles, with visible copy limited to label and value/state.
- Explicit action-priority contracts on player and moderator surfaces.
- Route order that places primary controls before role evidence, queues, checkpoints, and receipts.

## Acceptance evidence

- At 1024 × 768, the player exposes `Vote Slot 2` and `Vote no lynch` completely within the first viewport; both targets are 105 × 50px.
- At 1024 × 768, the moderator exposes `Extend deadline`, `Extend +24h`, and `Extend +48h` completely within the first viewport; each target is 304 × 44px.
- Both status strips occupy 112px and remain a single row at the audited baseline.
- Neither surface introduces horizontal page overflow.

## Recommended followup

Refine the player screen first because its 249px command rail still combines count, voting, posting, media, role evidence, and submission evidence. Introduce a compact player action header (deadline + current vote), keep immediate vote actions visible, move the full count and proof-oriented cards behind disclosures, and replace the narrow channel rail with a touch-safe channel switcher. Re-run the same 1024 × 768 paired audit afterward, then apply the resulting intent/consequence copy grammar to moderator action bays.
