# Tablet first-viewport UX audit — 2026-07-17

## Scope and baseline

The UI workbench was reviewed at the tablet baseline of **1024 × 768 CSS pixels** with the player and moderator roles open side by side. The audit covers the first viewport only and prioritizes information hierarchy, action prominence, touch ergonomics, and state copy.

The workbench scenarios were:

- Player: `/_dev/ui/session?scenario=player`
- Moderator: `/_dev/ui/session?scenario=moderator`

This is a visual and interaction audit of seeded workbench state. It does not claim production data, network, authentication, or assistive-technology coverage.

## First-viewport measurements

| Surface | Before | After shared primitives | After player/moderator refinement |
| --- | --- | --- | --- |
| Player status strip | 284px tall; 2 columns; third item orphaned on a second row | 112px tall; 3 adaptive columns | Unchanged; remains one scan row |
| Player channels | Narrow side rail with truncated targets | Narrow side rail remained | Full-width 3-column switcher; every target is 315 × 53px |
| Player primary controls | Command panel began below role and submission evidence; 0 gameplay actions visible | Command panel leads the rail; 2 enabled vote actions fully visible | Deadline/current vote compress to 74px; 2 vote actions and the complete full-count disclosure fit above the fold |
| Player proof surfaces | Dense rail cards | Proof cards followed primary controls | Role, action-readiness, receipt, and full-votecount surfaces use closed native disclosures |
| Moderator status strip | 284px tall; 2 columns across 2 rows | 112px tall; 4 adaptive columns | Unchanged; remains one scan row |
| Moderator primary controls | Control surface began at y=934; 0 moderator actions visible | Control surface begins at y=373; 3 enabled deadline actions fully visible at 44px tall | 3 intent/consequence actions remain visible at 304 × 79px; protocol language is absent until diagnostics opens |
| Horizontal fit | No page overflow | No page overflow | No horizontal page overflow on either surface |

## Prioritized UX punch list

### P0 — cross-surface hierarchy and action access (implemented)

1. **Primary role actions were absent from both first viewports.** Status, evidence, and checkpoint surfaces consumed the fold before the player could vote or the moderator could act. The shared solution is an explicit primary-action zone and route ordering that places action surfaces before supporting evidence.
2. **Tablet status strips used desktop-height cards in a two-column layout.** This consumed 284px and gave the three-item player strip an orphan row. Tablet strips now use adaptive columns with a 200px minimum, a 112px tile floor, and concise visible state; supporting detail remains available to assistive technology.
3. **Player vote actions were coupled to the long post composer.** Vote and withdrawal controls now have a reusable adaptive action tray above channel, post, and media inputs. Posting remains in the composer because it depends on composer state.
4. **Action layouts did not share a cross-role priority grammar.** Player and moderator surfaces now expose `data-action-priority="primary"`, use the same accent boundary, and share an adaptive action-tray primitive with touch-safe sizing.

### P1 — individual surface refinement (implemented)

5. **Player channel navigation collapsed too aggressively inside the tablet side rail.** It is now a full-width channel switcher above thread and command zones. Complete channel names and current/open state lead; capability remains machine-readable rather than visual copy.
6. **Player command context was information-heavy.** Deadline and current vote are now two compact readout rows, irrelevant disabled vote actions do not consume layout space, immediate vote actions lead, and the full count is a 54px disclosure directly beneath them.
7. **Moderator action bays exposed protocol detail before intent.** Each action now leads with human intent and a concrete consequence. Access, dispatch boundary, canonical command name, endpoint, and Ack/Reject semantics live in a closed “Technical details” disclosure.
8. **Player role and action checkpoint cards were too dense.** Role, action readiness, and activity are compact native disclosures with touch-safe summaries; full proof remains available without competing with primary actions.

### P2 — state copy and shell clarity

9. **State copy is duplicated across masthead, status strip, and action surfaces.** Give each layer one job: masthead answers “where am I?”, status strip answers “what needs attention?”, and the action surface answers “what can I do now?”.
10. **Internal engine language leaked into moderator-facing copy (resolved for action bays).** `/commands`, `Ack or Reject`, capability names, and canonical command identifiers now appear only after opening diagnostics. Continue the same cleanup in non-action surfaces.
11. **Connection state lacks a user outcome.** “Connecting live projection” should say whether actions remain safe, when retry happens, and what the user should do if it persists.
12. **Session/capability copy dominates the global shell.** Reduce it to identity plus active role; move the full capability set behind an account/session affordance.

## Shared primitives implemented in this round

- `.fm-primary-action-zone`: a common visual and scroll boundary for the role’s primary control surface.
- `.fm-action-tray`: an adaptive grid for touch actions that preserves minimum usable width and removes fixed role-specific button columns.
- Compact adaptive tablet status strips: one scan row at 1024px for both audited roles, with visible copy limited to label and value/state.
- Explicit action-priority contracts on player and moderator surfaces.
- Route order that places primary controls before role evidence, queues, checkpoints, and receipts.

## Acceptance evidence

- At 1024 × 768, the player exposes `Vote Slot 2` and `Vote no lynch` completely within the first viewport; both targets are 133 × 50px.
- The full-votecount disclosure occupies y=652–706 and opens to all 3 seeded rows; it is closed by default.
- Player channel targets are 315 × 53px and expose complete names plus current/open state.
- At 1024 × 768, the moderator exposes `Extend deadline`, `Extend +24h`, and `Extend +48h` completely within the first viewport; each target is 304 × 79px and contains intent plus consequence.
- No protocol terms are present in the moderator surface's visible closed state. Opening deadline diagnostics reveals its capability, dispatch boundary, command type, endpoint, and response protocol.
- Both status strips occupy 112px and remain a single row at the audited baseline.
- Neither surface introduces horizontal page overflow.

## Recommended followup

Continue the copy cleanup at the global shell and connection-state layers. Replace capability-heavy session text with identity plus active role, make the live-connection message explain action safety and recovery, and add a paired keyboard/screen-reader pass for the new channel and disclosure semantics at 1024px and 840px before refining individual composer and host-group density.
