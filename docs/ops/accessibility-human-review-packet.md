# Human assistive-technology review packet

Status: **not run — human evidence required**

This packet is the retained evidence owner for
`housekeeping.accessibility-review`. Automated browser, DOM, keyboard, tablet,
and route-state proofs are prerequisites only. They do not complete this
packet and must not be recorded as human approval.

## Review identity

- Reviewer:
- Review date:
- fmarch commit: `a22beb192d2308ed68a7a5a40b8e8043407dd078`
- Environment and base URL: local seeded development harness at
  `http://127.0.0.1:5173` (human reviewer must confirm this same target)
- Operating system and version: macOS 26.6, build 25G5028f
- Browser and version: human pass not run; automated preflight used Google
  Chrome for Testing 148.0.7778.96 via Playwright
- Keyboard layout/input method:
- Screen reader and version:
- Screen-reader verbosity/settings changed from defaults:
- Viewports or physical devices used: human pass not run; automated preflight
  covered 390x844, 1024x768, 1180x820, 1280x900, and 1440x920 CSS pixels

Record the exact combination for every rerun if it differs from the initial
review. At minimum, use one desktop keyboard pass, one tablet/touch pass, and a
screen reader native to the reviewed operating system.

## Automated preflight

Before human review, run:

```sh
npm run test:frontend-keyboard-traversal
npm run test:frontend-role-proof:quick
```

- Preflight commit: `a22beb192d2308ed68a7a5a40b8e8043407dd078`
- Preflight date: 2026-08-29 01:15 PDT
- Keyboard traversal result/artifact: passed;
  [`target/frontend-keyboard-traversal/keyboard-traversal.json`](../../target/frontend-keyboard-traversal/keyboard-traversal.json)
  records 20 surface/viewport combinations and 75 route-state/viewport
  combinations across the five viewports above.
- Quick role proof result/artifacts: passed; frontend contract tests, build-mode
  route-state rendering, the static role contract, tablet interaction contract,
  and DOM smoke all exited successfully. Generated evidence:
  [`route-state-render.json`](../../target/frontend-route-state-render/route-state-render.json),
  [`role-contract.json`](../../target/frontend-static-role-contract/role-contract.json),
  [`tablet-interaction.json`](../../target/frontend-tablet-interaction/tablet-interaction.json),
  and [`dom-smoke.json`](../../target/frontend-role-dom-smoke/dom-smoke.json).
- Known automated limitations reviewed: yes

The keyboard artifact proves build-mode Chromium tab order and focus outlines.
The quick role proof proves static contracts, rendered route states, tablet
geometry, and DOM structure. Neither proves speech output, user comprehension,
touch exploration, browser/assistive-technology interoperability, or a live
command round trip.

### Automated preparation evidence — not human verdicts

The following findings narrow the human review but do not change any matrix
cell from `not run`. The browser checks use SSR markup and synthetic input; the
contract checks do not exercise a live command transport.

| Family | Machine-observed preparation evidence | Still requires human observation |
|---|---|---|
| Identity | Registration, login, recovery, account-security, invitation, session-revocation, and logout route contracts passed. Local return-path and visible recovery-state contracts are covered. | Spoken labels/instructions, validation announcement timing, focus placement after every redirect or error, and comprehension of security/session consequences. |
| Public | Board, discussion, public-game, search, profile, quotation/citation, report, and watch contracts passed. Board focus traversal passed across all five synthetic viewports. | Reading order, perceivability of quotations/citations and state changes, zoom/reflow quality, and live control feedback. |
| Player | Player and private-channel focus traversal passed. DOM evidence covers player, private-channel, and private-review surfaces; route contracts cover paging, quoting, posting, voting/withdrawal, ACK/reject/interrupted state, and scoped channels. | Real speech and focus sequences, command round trips, private-boundary comprehension, transient feedback, and recovery after transport interruption. |
| Host | Host setup, invitation, action-confirmation, task-workspace, prompt, phase/deadline, stale-reject, and interrupted-command contracts passed. | End-to-end keyboard operation, alert-dialog speech/focus containment and return, command feedback timing, and touch operation on a real device. |
| Admin | Admin focus traversal and DOM smoke passed, including the audit-detail surface. Contracts cover the roving inbox model, selected canvas, confirmations, session grant, create game, cancellation, and task-key navigation. | Actual roving-focus usability, announcement of selection and authority, confirmation comprehension, and focus return after cancel in the hydrated application. |
| Moderation | Moderator focus traversal, DOM smoke, and empty/loading/reject route-state checks passed. Queue authorization, selected audit detail, and unavailable-action contracts passed. | Spoken distinction between permitted and unavailable actions, reading efficiency, live focus movement, and zoom/touch usability. |
| Inbox | Inbox route contracts cover authenticated loading, mark-read, target following, and private mute controls. | Whether reading position and focus are preserved in the real journey and whether updates are announced understandably. |
| Mute | Public-profile mute and inbox unmute contracts passed; personalized relationship authority is kept private in the route models. | Live suppression across discussion/search/inbox, clear spoken state, absence of hidden content from screen-reader navigation, and understandable unmute recovery. |
| Errors | Keyboard and DOM artifacts cover empty/loading/reject states for board, admin, player, player-private-channel, and moderator surfaces. Contract tests cover denied, validation, stale, unavailable, and interrupted variants. | Announcement timing and interruption behavior, visible and spoken recovery actions, focus placement, and whether the distinctions are understandable without visual context. |

The human pass should concentrate on the evidence automation cannot safely
infer: exact speech output and order; readily perceivable focus indication;
focus placement and return across hydrated transitions; transient status
announcements; 200% clipping, overlap, and reading order; physical touch
exploration; and any private content that is visually suppressed but remains
reachable through assistive technology.

### Live seeded preparation — not a human pass

On 2026-08-29, an agent-driven inspection reached the hydrated signed-out shell
at `http://127.0.0.1:5173`. The shell exposed a skip link, named primary and
workspace navigation, a single `main` region, one page-level heading, explicit
signed-out/disabled role controls, and labeled public search controls. The
invitation entry surface exposed a page-level heading, a named invitation
region, labeled credential/account/password fields, and named Continue and
Back controls. No invitation credential was submitted during this inspection.

The initial live public journey was blocked: both games listed on the board
returned the shared `Route not found` surface from their public-thread links;
Community reported that its directory was unavailable; and submitting a
non-sensitive five-character public search produced an unavailable `alert`.
The cause was split route authority: several SSR loaders bypassed the validated
server API owner, while the development server's broad `/games` proxy consumed
the public SvelteKit page namespace. Public search also forwarded a stale
browser cookie after identity resolution had already fallen back to anonymous.

After `a22beb192d2308ed68a7a5a40b8e8043407dd078`, the canonical seeded harness
was reset and inspected again at `http://127.0.0.1:5173` on 2026-08-29 01:29
PDT. The board listed both seeded games; both public-thread links rendered live
public records; Community rendered its genuine empty state; and the same public
search rendered a genuine empty result despite the stale pre-reset cookie. The
generated handoff at
[`target/dev-test-game/session.md`](../../target/dev-test-game/session.md)
matched the running frontend, game, and API port. `AR-LIVE-001` is therefore
cleared as a preparation blocker, and the human Public journey may begin. This
agent-driven rerun is not a keyboard, screen-reader, tablet, or human verdict.

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
| AR-LIVE-001 | critical review blocker | Public | The aligned seeded harness listed two active games whose public-thread links both rendered `Route not found`; Community and a valid public search rendered unavailable states. | The board, public game, community, and search journey loads successfully so assistive-technology review can begin. | `a22beb192d2308ed68a7a5a40b8e8043407dd078` | local seeded harness at `http://127.0.0.1:5173`; 2026-08-29 01:29 PDT | passed as agent preparation: both public games, Community, and Search loaded truthfully; human Public journey remains `not run` |

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
