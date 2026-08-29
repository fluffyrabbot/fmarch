# Human assistive-technology review packet

Status: **not run — human evidence required**

This packet is the retained evidence owner for
`housekeeping.accessibility-review`. Automated browser, DOM, keyboard, tablet,
and route-state proofs are prerequisites only. They do not complete this
packet and must not be recorded as human approval.

## Review identity

- Reviewer:
- Review date:
- fmarch commit:
- Environment and base URL:
- Operating system and version:
- Browser and version:
- Keyboard layout/input method:
- Screen reader and version:
- Screen-reader verbosity/settings changed from defaults:
- Viewports or physical devices used:

Record the exact combination for every rerun if it differs from the initial
review. At minimum, use one desktop keyboard pass, one tablet/touch pass, and a
screen reader native to the reviewed operating system.

## Automated preflight

Before human review, run:

```sh
npm run test:frontend-keyboard-traversal
npm run test:frontend-role-proof:quick
```

- Preflight commit:
- Preflight date:
- Keyboard traversal result/artifact:
- Quick role proof result/artifacts:
- Known automated limitations reviewed: yes / no

The keyboard artifact proves build-mode Chromium tab order and focus outlines.
The quick role proof proves static contracts, rendered route states, tablet
geometry, and DOM structure. Neither proves speech output, user comprehension,
touch exploration, browser/assistive-technology interoperability, or a live
command round trip.

## Review rules

For every journey:

1. Start from the journey's entry URL; do not use developer tools to move
   focus or mutate state.
2. Run once with keyboard alone and once with the screen reader enabled.
3. Record announced page title, landmark/heading structure, control names,
   current/selected/expanded state, validation and command feedback, focus
   placement after navigation, and focus return after cancellation.
4. At tablet size, confirm 200% zoom/reflow and touch exploration do not hide,
   overlap, or reorder the primary action.
5. Give every defect an issue ID and severity. A critical or high defect keeps
   this packet open until the fix and the complete affected journey rerun are
   recorded.

Severity meanings:

- critical: the journey cannot be completed or authority/privacy boundaries
  become ambiguous;
- high: a required control, state, error, or focus transition is not
  perceivable or operable;
- medium: the journey works but is materially confusing or inefficient;
- low: polish that does not obscure state or block operation.

## Critical journey matrix

Use `pass`, `fail`, or `not run`. Add issue IDs and concise observations; do not
replace observations with a bare checkbox.

| Family | Required journey | Keyboard | Screen reader | Tablet / 200% | Issues and observations |
|---|---|---|---|---|---|
| Identity | Register, verify/deliver identity, sign in, and arrive at the intended return path | not run | not run | not run | |
| Identity | Recover an account, inspect security/session state, revoke a session, and sign out | not run | not run | not run | |
| Public | Navigate board, community discussion, public game, search results, profile, quotation/citation, and report/watch controls | not run | not run | not run | |
| Player | Enter the assigned game, switch public/private channels, page older posts, quote, post, vote/withdraw, and understand ACK/reject/interrupted feedback | not run | not run | not run | |
| Player | Review notification/investigation private items and confirm private-channel boundaries are announced without leaking hidden content | not run | not run | not run | |
| Host | Complete setup, issue an invite, start a game, operate phase/deadline and host-prompt confirmations, then recover from a rejected/interrupted command | not run | not run | not run | |
| Admin | Traverse the operator inbox with roving task focus, open the selected decision canvas, review session-grant/create-game confirmation, and return focus on cancel | not run | not run | not run | |
| Moderation | Open the moderation queue, inspect the selected item/audit detail, and distinguish permitted from unavailable actions | not run | not run | not run | |
| Inbox | Read updates, mark an item read, follow its target, and return without losing place | not run | not run | not run | |
| Mute | Mute from a public profile, verify muted contributions are suppressed in personalized discussion/search/inbox views, then unmute from the inbox | not run | not run | not run | |
| Errors | Encounter denied, empty, loading, unavailable, validation, stale, and interrupted states and identify the next recovery action | not run | not run | not run | |

## Defect and rerun log

| Issue | Severity | Journey(s) | Observed behavior | Expected behavior | Fix commit | Rerun environment/date | Rerun result |
|---|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — | — |

Attach screenshots only as supporting context. For speech or focus defects,
retain the exact announcement/focus sequence in text so the evidence remains
searchable and reviewable.

## Human decision

- Every matrix row passed: yes / no
- Every critical/high issue has a successful affected-journey rerun: yes / no
- Unresolved medium/low issues explicitly accepted with rationale: yes / no
- Reviewer decision: approved / rejected / not run
- Reviewer name and date:
- Decision rationale and accepted residual issues:

Only a named human reviewer may change the packet status to approved and close
`housekeeping.accessibility-review`. Coding agents may prepare the packet,
repair defects, run synthetic preflight, and update evidence links, but may not
fill the human decision on the reviewer's behalf.
