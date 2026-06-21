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

## Tablet UX acceptance checklist

Frontend slices that affect core gameplay or host workflows should be judged against this
checklist before they are called done:

- **Cheap proof first** — shared touch controls and host actions start from
  `frontend/src/lib/components/host-action/`: the CSS variables/classes define the target
  floor, and the host-action contract tests prove confirmation and dispatch behavior without
  a browser. `npm run test:frontend-role-proof` is the current no-bind proof lane for
  restricted environments: it builds the admin, player, and moderator route data plus
  component view models, checks capability gating, 44px touch metadata, forbidden-route
  messages, representative admin/player/moderator command ack/reject paths, the shared
  role nav/focus matrix, the shared shell navigation touch contract, admin audit native
  inspect-route affordance plus principal-scoped operator-proof evidence endpoint,
  moderator host-prompt ACK
  projection-patch and hydrated-refresh removal paths, and fixture-routable
  empty/loading/reject route-state scenarios, then renders those route states through the
  actual Svelte admin/player/moderator pages with build-mode SSR and verifies that the
  normal surfaces, the admin command activity rail, the player command receipt strip, the
  player thread tablet-media variant contract, the
  native admin audit detail route, and already-open admin/moderator confirmation components
  expose their expected alertdialog, aria, message, test-id, and focus-contract markup, and that player
  private notification disclosure markup renders both collapsed and expanded without
  host-only copy. The tablet interaction contract also proves that moderator action
  tiles reserve a 44px status floor below each primary control, so pending/ACK/reject
  status text does not move the action target inside the sticky host rail. When localhost is denied, the
  role-smoke fallback also
  runs `npm run test:frontend-role-dom-smoke`, which renders the same build-mode SSR bundle
  without a browser and verifies deterministic DOM contracts for the shared board,
  admin/player/moderator surfaces, the player private-review URL, the player private-channel
  URL, route-state live regions,
  links, touch metadata, and private/host boundary strings. It then attempts
  `npm run test:frontend-role-render-smoke`, which loads the same SSR markup into Chromium
  with `page.setContent` instead of opening a TCP listener. If Chromium launch is allowed,
  that no-bind render artifact records nonblank screenshots, visible geometry, touch target
  checks, and obvious-overlap checks; if Chromium launch itself is denied, it records a
  `chromium-launch-blocked` boundary instead. `npm run
  test:frontend-static-focusability` parses the same SSR bundle without Chromium and proves
  the modeled focus ids own real enabled focusable elements while denied ids stay inert.
  `npm run
  test:frontend-keyboard-traversal` uses the same no-localhost SSR bundle to attempt real
  Chromium Tab traversal, visible focus-outline checks, disabled-control exclusion, and the
  shared skip-link-first order for board, role, and route-state surfaces. The role-smoke
  fallback artifact embeds the same static contract, the DOM result, and the no-bind render
  result.
  The saved artifacts live at
  `target/frontend-static-role-contract/role-contract.json` and
  `target/frontend-route-state-render/route-state-render.json` and
  `target/frontend-static-focusability/focusability.json` and
  `target/frontend-keyboard-traversal/keyboard-traversal.json` and
  `target/frontend-role-dom-smoke/dom-smoke.json` and
  `target/frontend-role-render-smoke/render-smoke.json` and
  `target/frontend-role-smoke/role-smoke.json` and
  `target/frontend-completion-audit/completion-audit.json`. This is deliberately weaker than
  dev-server browser proof; it proves Svelte markup for the page/component seam, verifies a
  no-browser DOM manifest, records a static tablet-first first-viewport layout contract for
  admin/player/moderator scan strips, and may prove no-bind Chromium render pixels and
  keyboard traversal when Chromium can launch, but it still does not prove hydrated route
  navigation, command dispatch, WebSocket behavior, or real pointer interaction.
- **Viewport proof** — exercise the changed surface at 1024x768, 1180x820, 1280x900, and
  one desktop width once the surface has a real shell. The tablet widths are the design
  baseline; desktop is the scale-up case. The first host-console critical path is guarded by
  `npm run test:host-console-tablet-smoke` at 1024x768 through `/g/[game]/host`, covering
  the irreversible `extend_deadline` and `process_replacement` actions, their typed
  `/commands` envelopes, and post-ACK projection rendering. `npm run
  test:host-console-live-stack-smoke` is the stronger boundary proof: it creates a temporary
  Postgres database, starts the Rust API and SvelteKit dev server together, seeds the game
  through `/commands`, resolves the host session through `/auth/session`, drives both actions
  in Chromium, and verifies the UI refreshes from the real `host-console-state` API. The
  multi-role browser smoke remains the acceptance gate for nonblank admin/player/moderator
  rendering, touch target floor, obvious-overlap checks, first-viewport scan-strip tile fit,
  forbidden access behavior, keyboard focus order with disabled controls skipped, visible
  focus rings, rendered empty/loading/reject route states, player private-disclosure
  toggling, and a command reject path when localhost binding is available. Browser-passed
  role-smoke artifacts must include screenshot pixel metrics that prove every saved board,
  role, forbidden, and route-state screenshot is viewport-width, viewport-height-or-taller,
  and nonblank. They also must record real admin/moderator confirmation focus evidence:
  initial focus on confirm, Escape returning focus to the trigger, and Tab/Shift-Tab staying
  inside the local confirmation controls, including the editable session-grant token,
  principal, expiry, and capability fields. Moderator browser artifacts also record
  host-prompt resolution evidence: Escape/cancel return focus to the prompt trigger, confirm
  sends the typed `ResolveHostPrompt` command, the ACK refreshes the host-prompt projection,
  and the resolved prompt action detaches into the empty prompt bay. The same role-smoke
  browser contract requires the `modkill_slot` action to send typed `SetSlotStatus`, ACK,
  update command activity, and refresh the slot lifecycle projection to `Modkilled`.
  Admin browser artifacts
  also record click-through from the audit list to the native inspect route, the
  principal-scoped operator-proof evidence endpoint, and a nonblank detail screenshot.
  Player browser artifacts
  record private notification disclosure evidence before and after expansion, including
  `aria-expanded`, detail visibility, focus retention, nonblank screenshots for both states,
  and player thread media request evidence proving the browser requested only tablet/small
  image variants from the mocked media route while original/full/desktop URLs stayed out of
  rendered image attributes and request logs. Use
  `npm run test:frontend-role-proof:browser` in environments that allow localhost bind; it
  runs the Chromium smoke and then verifies the generated artifact shape.
  In restricted sandboxes that deny localhost binds, the browser smokes write a structured
  `EPERM` artifact and remain nonzero by default; setting
  `FMARCH_ALLOW_STATIC_ROLE_FALLBACK=1` runs the static role contract, no-browser DOM smoke,
  and no-bind render smoke. The role-smoke artifact is marked
  `static-render-fallback-passed` when Chromium render screenshots were recorded, or
  `static-dom-fallback-passed` when the DOM proof passed but Chromium launch was also
  blocked. `npm run test:frontend-role-proof` composes that explicit fallback path with
  generated-artifact verification for restricted sandboxes.

### Current frontend proof commands

| Command | Proves | Does not prove |
|---|---|---|
| `npm run test:frontend-route-state-render` | Build-mode Svelte SSR rendering for all board/admin/player/moderator empty/loading/reject page states plus player private-channel route states, the normal board, admin, player, player private-channel, and moderator first-view surfaces, including shared shell nav test ids, 44px nav metadata, admin readiness/setup/audit/recovery controls, admin audit native inspect href, admin audit detail surface/evidence link, authority/boundary/evidence targets, player projected deadline/votecount panel, channel-scoped private review links, player thread media rendered from tablet/small image variants with original URLs omitted, active admin/player/moderator feedback rail status rows with rendered command-trace attributes, the shared route-loading component with route-aware shell context, the root navigation-pending layer without duplicating page shells, the real SvelteKit error page with player private-channel path/session/capability shell context, player private disclosure collapsed/expanded markup without host-only copy, moderator operations, critical host actions, host-prompt control/action markup, route-state root, live-region status, recovery action markup, and already-open admin/moderator confirmation alertdialog markup plus DOM-visible initial-focus, return-focus, Escape, and Tab-containment metadata including host-prompt resolution. | Browser pixels, CSS layout geometry, pointer behavior, focus traversal, actual network image fetching, or live client hydration. |
| `npm run test:frontend-role-dom-smoke` | No-browser SSR DOM manifest for the shared board, admin, admin audit detail, player, player private-review URL, player private-channel URL, moderator surface, every route-state page, the real player private-channel error surface, and active admin/player/moderator feedback rows, including shell/nav IDs, route-state live-region attributes, error status/path/session/capability context, stable links, touch target metadata, player tablet-media variant attributes, command-trace attributes, channel-scoped private review hrefs, and private/host boundary string exclusions. | CSS pixel geometry, screenshots, browser focus traversal, pointer behavior, actual image fetching, hydration, command dispatch, WebSocket behavior, or real navigation. |
| `npm run test:frontend-dispatch-bridge` | No-browser dispatch bridge contract from rendered trace-compatible metadata through the role route handlers into the real admin/player/moderator command controller seams and smoke-exposed bridge plans: admin `AddCohost` pending/ACK/reject command activity states plus route-owned generic form-result exposure, player `SubmitVote` optimistic/ACK/reject receipt rows plus `votecount` refresh and `SubmitPost` ACK receipt plus `thread`/`votecount` refresh, and moderator `ResolveHostPrompt` pending/ACK/reject activity states plus post-ACK `hostPrompts` refresh and `modkill_slot` to typed `SetSlotStatus` ACK with no host-prompt refresh. | Pointer events, focus traversal, browser hydration, TCP/network transport, WebSocket delivery, or screenshot/pixel acceptance. |
| `npm run test:frontend-hydrated-handlers` | No-localhost command handler harness for admin/player/moderator. It executes the same controller and browser-bridge functions used by the hydrated route handlers, then verifies DOM-facing command activity/receipt view models and smoke-exposed bridge plans for admin `AddCohost` ACK/reject, distinct admin session-grant and recovery-gate server form ACK rows, player `SubmitVote` ACK/reject plus `SubmitPost` ACK, and moderator `ResolveHostPrompt` ACK/reject plus `SetSlotStatus` ACK with `Modkilled` projection evidence. | Browser pointer events, Svelte hydration scheduling, focus traversal, CSS geometry, screenshots, TCP/network transport, or WebSocket delivery. |
| `npm run test:frontend-hydrated-surfaces` | No-localhost hydrated-surface adapter contract over real route data. It verifies board/admin/admin-audit/player/moderator shared headers and shell keyboard metadata, native admin audit-list to audit-detail navigation, admin `AddCohost`, session-grant, and recovery-gate ACK rows through route-owned bridges, player private disclosure expansion without host-only copy, player `SubmitVote` and `SubmitPost` ACKs with projection refresh, player older-thread pager pending/ACK/reject lifecycle states, moderator host-prompt confirmation-to-`ResolveHostPrompt` ACK with prompt projection removal, and moderator `modkill_slot` confirmation-to-`SetSlotStatus` ACK with refreshed `Modkilled` slot lifecycle evidence through the same controller and browser-bridge functions used by hydrated pages. | Svelte client scheduling, DOM event delivery, browser focus traversal, CSS geometry, screenshots, TCP/network transport, WebSocket delivery, or localhost-backed browser acceptance. |
| `npm run test:frontend-component-interactions` | No-bind compiled-component interaction contract for admin/player/moderator command surfaces. It verifies source event bindings, renders command controls, form controls, and status rows through a Svelte SSR bundle, directly invokes the same callback/controller action ids, and re-renders DOM-facing ACK rows for admin `AddCohost`, session-grant, and recovery-gate actions, player `SubmitVote`/`SubmitPost`, and moderator `ResolveHostPrompt`/`SetSlotStatus`. | Browser pointer delivery, Svelte client scheduling, focus traversal, CSS geometry, screenshots, TCP/network transport, or WebSocket delivery. |
| `npm run test:frontend-no-bind-interactions` | No-bind Chromium interaction smoke for representative admin/player/private-channel controls and every moderator critical host confirmation when Chromium can launch without localhost. It loads build-mode Svelte SSR markup with `page.setContent`, clicks the admin `AddCohost`, session-grant, and recovery-gate confirm controls, player main-thread `SubmitVote`/`SubmitPost`, player role-PM private-channel `SubmitPost`, and all 10 moderator deadline/replacement/phase/thread/votecount/slot/role/host-prompt confirmation controls, then records browser hit-testing, click delivery, focus landing, confirmation metadata, active role-PM channel route evidence, form action/field evidence for admin forms, player tablet-media image attributes/request evidence, and 44px touch target geometry. If Chromium launch is denied, it writes a structured `chromium-launch-blocked` artifact with the planned interaction matrix. | Svelte client hydration, Svelte event scheduling, command dispatch side effects, dev-server routing, TCP/network transport, localhost app navigation, or WebSocket delivery. |
| `npm run test:frontend-static-focusability` | No-browser SSR focusability contract for the board, admin, player, moderator, and route-state surfaces. It parses build-mode SSR markup and verifies every modeled focus target owns an enabled focusable element, while forbidden focus ids are present but not in the static tab order. | CSS focus-ring visibility, real browser Tab traversal, pointer behavior, hydration, command dispatch, TCP/network transport, or WebSocket delivery. |
| `npm run test:frontend-tablet-interaction` | No-browser tablet interaction source/CSS/SSR contract. It scans the current `frontend/src` `.css`, `.html`, `.svelte`, `.js`, and `.mjs` files for hover-triggered SvelteKit preloading, hover selectors, hover media queries, mouse hover handlers, and pointer hover handlers; verifies shared app focus-visible, skip-link, edge-to-edge viewport fit, safe-area shell padding, sticky safe-area role/session topbar, controlled overscroll, 44px touch target, `touch-action: manipulation`, wrapping touch-row, overflow-wrap, and 4/2/1 scan-strip CSS guardrails; proves the admin setup/recovery zone is a safe-area-aware sticky operator action rail offset below that shared topbar before command/audit/escalation readouts with a reserved 44px status floor below each primary admin action; proves the player vote/post thumb zone is a safe-area-aware sticky tablet command rail offset below the shared topbar with primary controls rendered before live command receipts, contained internal scrolling, and a normal-flow fallback below the tablet cockpit breakpoint; proves the moderator primary action zone is a safe-area-aware sticky host control rail offset below the shared topbar with contained internal scrolling, narrow fallback, route order before status readouts, and a reserved 44px status floor below each primary moderator action; verifies host `touch-control` 44px/focus/wrapping confirmation-action rules; and parses build-mode SSR for explicit admin setup/recovery, player vote/post, and moderator critical-action thumb-zone containers. | Browser pointer delivery, physical thumb reach, pixel overlap, visible focus ring rendering, real Tab traversal, Svelte hydration, command dispatch, TCP/network transport, or WebSocket delivery. |
| `npm run test:frontend-route-live-contract` | No-browser route-live contract for player and moderator live projection wiring. It source-checks the Svelte pages for their `onMount` `connectLiveProjection` ownership, then drives open/hello/delta/resync frames through the same projection store, route resync keys, and browser-bridge adapters to recovered player thread and moderator host-prompt projections. | Real TCP/WebSocket delivery, Svelte client scheduling, browser focus traversal, CSS geometry, screenshots, dev-server routing, or localhost-backed acceptance. |
| `npm run test:frontend-host-confirmations` | No-browser static DOM contract for every moderator critical host action rendered with its confirmation open. It verifies deadline, replacement, phase/thread lock, votecount, slot lifecycle, role reveal, and host-prompt actions each own exactly one alertdialog with confirm/cancel controls, DOM-visible object/outcome confirmation text, focus-return, Escape, Tab-containment metadata, and 44px touch-control classes. | Browser focus movement, Tab trapping, Escape handling, pointer delivery, command dispatch, TCP transport, WebSocket delivery, or localhost-backed app acceptance. |
| `npm run test:frontend-keyboard-traversal` | No-bind Chromium keyboard traversal smoke for the build-mode SSR board, admin, player, moderator, and route-state surfaces when Chromium can launch without localhost. It verifies actual Tab order against the shared shell focus matrix, including skip link first, visible focus outlines, disabled-control exclusion, and route-state action reachability. If Chromium launch is denied, it writes a structured `chromium-launch-blocked` artifact after re-proving the SSR route-state bundle. | Svelte client hydration, dev-server routing, command dispatch, pointer behavior, TCP/network transport, WebSocket delivery, or localhost-backed browser navigation. |
| `npm run test:frontend-iab-interaction-page` | Generates `target/frontend-in-app-browser-interactions/interaction-page.html`, a file-backed page built from the same Svelte SSR board/admin/player/moderator first-viewport shells plus the real player private-channel error surface, admin/player/private-channel command controls, all 10 moderator critical host confirmations, hydrated-surface scenario controls, player older-thread pager controls, and a tiny local click recorder for in-app browser proof. The artifact contract verifies the page contains shared shell nav/touch metadata, role surface test ids, the admin `AddCohost`, session-grant form, recovery-gate form, player main-thread `SubmitVote`/`SubmitPost`, player role-PM private-channel `SubmitPost` with active channel and channel-scoped private-review route metadata, player private-channel 403 `Back to board` error action metadata, and deadline/replacement/phase/thread/votecount/slot/role/host-prompt moderator confirmation targets, plus hydrated-surface mirrors for shared headers, native admin audit navigation, admin operational form ACKs, player private disclosure/vote/post ACK, player thread pager pending/ACK/reject status controls, separate moderator host-prompt confirmation/prompt removal, and moderator slot-lifecycle ACK/projection metadata. This is a prepared proof fixture rather than completed browser acceptance until a browser opens and exercises it. | Actual browser click/focus/screenshot evidence unless the in-app browser can open and exercise the generated file, Svelte hydration, Svelte event scheduling, command side effects, dev-server routing, TCP/network transport, or WebSocket delivery. |
| `npm run test:frontend-iab-static-dom` | No-browser static DOM contract for the generated file-backed in-app browser fixture. It regenerates the fixture, parses `interaction-page.html`, and verifies every manifest command/error scenario owns exactly one focusable target inside its scenario root, all 10 moderator critical host confirmation scenarios carry DOM-visible object/outcome text and alertdialog focus metadata, every hydrated-surface fixture control exists inside its root, modeled touch-floor metadata or shared touch-control classes are present, player thread pager pending/ACK/reject controls expose disabled/busy/live-region status metadata, the player role-PM private-channel scenario carries active channel plus channel-scoped private-review route evidence, the player private-channel error scenario carries 403 status/path/session/capability/active-nav evidence, and player private-channel fixture markup excludes host/moderator operational payload strings. | CSS layout pixels, browser click delivery, focus landing, Svelte hydration, command side effects, TCP/network transport, WebSocket delivery, or localhost-backed app acceptance. |
| `npm run test:frontend-iab-fixture-smoke` | Attempts to open the generated file-backed in-app browser fixture in Chromium from its `file://` URL and writes `target/frontend-in-app-browser-interactions/browser-run.json`. When Chromium can launch, it clicks the admin/player/private-channel command controls, including admin session-grant/recovery-gate forms, player role-PM private-channel post, the player private-channel 403 `Back to board` route-error action, and all 10 moderator critical host confirmation controls, plus hydrated admin audit/form ACKs, player disclosure, and moderator host-prompt/slot-lifecycle controls across the proof viewports, recording click delivery, focus landing, 44px target boxes, active role-PM route evidence, route-error shell/session/capability evidence, player disclosure toggle state, moderator alertdialog focus/object/outcome metadata, and nonblank screenshots. If Chromium launch or file navigation is blocked, it writes a structured blocked artifact with the planned interaction matrix. | Svelte client hydration, Svelte event scheduling, command side effects, dev-server routing, TCP/network transport, WebSocket delivery, or localhost-backed app acceptance. |
| `npm run test:frontend-iab-localhost-fixture-smoke` | Serves the same generated in-app browser fixture from `127.0.0.1` and writes `target/frontend-in-app-browser-localhost/browser-run.json`, keeping localhost-served fixture proof separate from the older file URL artifact. When localhost bind and Chromium launch are allowed, it reuses the full fixture interaction matrix for admin setup/recovery, player main/private-channel actions, route-error return, player private disclosure, all 10 moderator critical confirmations, hydrated admin/moderator scenario controls, 44px target geometry, reserved status-floor geometry, and screenshot pixels across the proof viewports. If bind, launch, or localhost navigation is denied, it writes a structured blocked artifact with the planned interactions. | Svelte client hydration, Svelte event scheduling, command side effects, dev-server routing through SvelteKit, TCP/API transport beyond the local fixture server, WebSocket delivery, or full localhost app acceptance. |
| `npm run test:frontend-iab-fixture-replay` | Replays the same file-backed Chromium browser-run lane from the existing `interaction-page-manifest.json` and `interaction-page.html` without regenerating SSR artifacts first, then writes `browser-run.json` with `mode: replay-existing` and `regeneratedFixture: false`. This is useful for in-app browser or local Chromium reruns where the fixture was already produced by `test:frontend-iab-interaction-page`/`test:frontend-iab-static-dom`. | Fixture freshness, Svelte client hydration, Svelte event scheduling, command side effects, dev-server routing, TCP/network transport, WebSocket delivery, or localhost-backed app acceptance. |
| `npm run test:frontend-iab-fixture-handoff` | Generates `target/frontend-in-app-browser-interactions/replay-handoff.json` and `.md` from the current fixture manifest, static DOM proof, and latest `browser-run.json`. The handoff records the file URL, exact replay command, freshness commands, expected output artifact, all 22 planned interactions, all 10 moderator critical confirmation ids, latest browser-run status, and promotion checks for a Chromium-capable replay. | Browser behavior by itself, fixture freshness after later edits, Svelte hydration, command side effects, TCP/network transport, WebSocket delivery, dev-server routing, or localhost-backed app acceptance. |
| `npm run test:frontend-iab-imported-run` | Validates a `browser-run.json` produced by the file-backed replay lane, defaulting to the current `target/frontend-in-app-browser-interactions/browser-run.json` or an alternate path via `--source`/`FMARCH_IAB_BROWSER_RUN_IMPORT`. When the source status is `passed`, it rechecks the current fixture manifest/static DOM proof, all 22 planned interactions, all 10 moderator critical confirmation metadata records, per-viewport click/focus/touch evidence, player private-channel route/disclosure/error-surface evidence, and referenced screenshot PNG pixels without launching Chromium, then writes `target/frontend-in-app-browser-imported-run/imported-run.json`. When the source is blocked, it writes a non-promoting `source-blocked` artifact. | Browser execution by itself, fixture freshness after the imported run, Svelte hydration, command side effects, TCP/network transport, WebSocket delivery, dev-server routing, or localhost-backed app acceptance. |
| `npm run test:frontend-iab-fixture-bundle` | Generates `target/frontend-in-app-browser-bundle/fixture-replay-bundle.tar` plus `bundle-manifest.json` as a deterministic ustar payload for moving the generated fixture and full role-smoke proof to a Chromium-capable environment. The archive includes `interaction-page.html`, `interaction-page-manifest.json`, replay handoff JSON/Markdown, latest file-backed `browser-run.json`, latest localhost-served `browser-run.json`, imported-run status, `target/frontend-role-smoke/role-smoke.json`, imported role-smoke status, and any file, localhost, or role-smoke screenshot PNGs that exist, with stable ordering, zero mtimes, fixed mode, and SHA-256 hashes. | Browser behavior, fixture freshness after export, Svelte hydration, command side effects, TCP/network transport, WebSocket delivery, dev-server routing, or full localhost app acceptance. |
| `npm run test:frontend-iab-fixture-bundle-import` | Validates a returned `fixture-replay-bundle.tar`, defaulting to the current bundle or an alternate path via `--source`/`FMARCH_IAB_FIXTURE_BUNDLE_IMPORT`. It parses the deterministic tar, verifies the required fixture/replay/import/role-smoke payload, extracts it under `target/frontend-in-app-browser-bundle-import/extracted`, restores returned localhost fixture artifacts to `target/frontend-in-app-browser-localhost/`, runs the imported-run contract against the extracted file-backed `browser-run.json`, and runs the imported role-smoke contract against the extracted `target/frontend-role-smoke/role-smoke.json`, writing `target/frontend-in-app-browser-bundle-import/bundle-import.json` plus `target/frontend-role-smoke-imported/imported-role-smoke.json`. | Browser execution, Svelte hydration, command side effects, TCP/network transport, WebSocket delivery, or localhost-backed app acceptance by itself; it promotes imported file evidence only when the extracted imported-run proof is `imported-passed`, while the browser-acceptance boundary separately evaluates the restored localhost fixture artifact and imported full role-smoke artifact. |
| `npm run test:frontend-iab-operator-runbook` | Generates `target/frontend-in-app-browser-operator-runbook/runbook.json` and `.md` from the current bundle, bundle-import, replay handoff, imported-run, imported role-smoke, completion-audit, and readiness artifacts. It records the external Chromium workflow, exact commands, expected returned files for file-backed fixture, localhost-served fixture, and full role-smoke runs, completion-audit/readiness refresh commands, promotion checks, current proof status, and whether evidence is diagnostic or imported. | Browser execution, fixture replay, imported browser proof, Svelte hydration, command side effects, TCP/network transport, WebSocket delivery, or full localhost app acceptance by itself. |
| `npm run test:frontend-iab-replay-help` | Generates `target/frontend-in-app-browser-replay-help/replay-help.json`, `.md`, and `.sh` from the current fixture manifest, replay handoff, bundle manifest, and operator runbook. The helper condenses the external replay into freshen/replay/import/completion-audit commands, expected returned files, route-error promotion requirements, role-smoke import requirements, completion-audit refresh, current status, and promotion checks for proving the file-backed fixture, localhost-served fixture, and full role-smoke lanes outside the sandbox. | Browser execution, fixture replay, imported browser proof, Svelte hydration, command side effects, TCP/network transport, WebSocket delivery, or localhost-backed app acceptance by itself. |
| `npm run test:frontend-role-smoke-import` | Validates a returned `target/frontend-role-smoke/role-smoke.json`, defaulting to the current local artifact or an alternate path via `--source`/`FMARCH_ROLE_SMOKE_IMPORT`, and writes `target/frontend-role-smoke-imported/imported-role-smoke.json`. When the source role-smoke is `passed`, it rechecks board/admin/player/moderator, forbidden-route, and route-state screenshots, screenshot PNG pixels, focus traversal evidence, overlap-checked targets, tablet thumb-zone geometry, admin session-grant/recovery-gate evidence, player main-thread and role-PM `SubmitPost` ACK evidence, player tablet-media browser request evidence, and moderator `SetSlotStatus` lifecycle evidence without launching Chromium locally. | Browser execution by itself, artifact freshness after import, live Rust API transport, or WebSocket delivery; it promotes imported full-role browser evidence only when the returned role-smoke and referenced screenshots are complete. |
| `npm run test:frontend-browser-acceptance-boundary` | Generated browser-acceptance boundary at `target/frontend-browser-acceptance-boundary/browser-acceptance-boundary.json`, derived from localhost role smoke, imported role smoke, no-bind Chromium render, no-bind interaction, no-bind keyboard, the prepared file-backed in-app fixture, the direct file-backed fixture browser-run artifact, the localhost-served fixture browser-run artifact, and the imported external file-backed browser-run artifact. It records which lanes are proven, blocked, or fixture-prepared, promotes full app acceptance only when local or imported localhost role-smoke passes with admin session-grant/recovery-gate form evidence, player main-thread `SubmitPost` ACK refresh evidence, player role-PM `SubmitPost.channel_id="role-pm"` ACK evidence, player tablet-media browser request evidence without original/full/desktop URLs, moderator `SetSlotStatus`/slot-lifecycle ACK evidence, forbidden-route screenshots, overlap-checked targets, and route-state screenshots, and keeps fixture browser runs distinct from full localhost app acceptance. Diagnostic no-bind or fixture blockers remain visible without blocking a proven full app role smoke. | Browser behavior by itself; it is a truth surface over existing artifacts and does not promote prepared fixtures, bind blocks, Chromium launch blocks, or source-blocked imported runs to full app acceptance. |
| `npm run test:frontend-role-render-smoke` | No-bind Chromium render attempt for the build-mode SSR board/admin/player/moderator surfaces, active admin/player/moderator feedback rails, player private-review URL, player private-channel URL, and role route-state pages, including visible geometry, touch target checks, active feedback status geometry, obvious-overlap checks, and nonblank screenshot metrics when Chromium can launch. If Chromium cannot launch, it writes a `chromium-launch-blocked` artifact after re-proving the SSR route-state render, including active feedback rail markup. | Dev-server routing, hydration, pointer behavior, focus traversal, command dispatch, WebSocket behavior, or localhost-backed browser navigation. |
| `npm run test:frontend-completion-audit` | Generated requirement audit at `target/frontend-completion-audit/completion-audit.json`, derived from the static, SSR, dispatch-bridge, DOM, render, role-smoke, imported role-smoke, tablet interaction, prepared file-backed in-app browser fixture, direct fixture browser-run artifact, imported external fixture browser-run artifact, and browser-acceptance boundary artifacts. It records shared shell, single root-owned shell architecture, tablet-native interaction posture, player, moderator, admin, route-state, prepared fixture, fixture browser-run/import status, full role-smoke import status, and browser-acceptance status without hand-maintained promotion, including player thread media proof that tablet/small/thumb variants render while original-only images are withheld and player thread pager proof for pending/ACK/reject older-page states. When local or imported full localhost role-smoke is proven, this audit reports `status: passed` and `overall.state: complete`. | New behavior by itself; it summarizes existing proof and fails closed when required artifacts are stale or missing, and imported fixture evidence still remains distinct from full localhost app acceptance. |
| `npm run test:frontend-readiness-summary` | Operator-readable readiness summary at `target/frontend-readiness-summary/readiness-summary.json` and `.md`, derived from the generated proof artifacts. It separates single-root-shell proof, role model/SSR/DOM readiness, no-bind Chromium diagnostics, localhost browser acceptance, imported role-smoke acceptance, the prepared in-app file fixture, the direct file fixture browser-run artifact, the localhost-served fixture browser-run artifact, and the imported external fixture browser-run artifact, including diagnostic blockers, feedback-rail status IDs, checked promotion criteria, and per-role promotion failures when full role-smoke evidence is absent. When the completion audit is complete, readiness reports `status: passed` and `overall.state: complete`. | New frontend behavior, browser proof, or completion by itself; it is a truth surface over current artifacts and does not promote the prepared file fixture, blocked fixture browser-runs, or a blocked imported run to full app acceptance. |
| `npm run test:frontend-role-proof` | Restricted-sandbox admin/player/moderator route models, component view models, capability gating, modeled 44px touch metadata, representative command ack/reject paths, shared `ConfirmationShell` ownership for admin/moderator confirmation wrapper attributes, shared confirmation-action ownership for admin/moderator confirmation payloads, confirmation-command trace ownership from admin/moderator confirmations into command activity rows, player command trace ownership from player actions into command receipt rows, no-browser dispatch bridge proof from trace metadata through route handlers into admin/player/moderator typed command lifecycles and smoke-exposed bridge plans, no-localhost hydrated-handler proof for DOM-facing admin/player/moderator ACK/reject rows including moderator `SetSlotStatus` ACK and `Modkilled` projection, no-localhost hydrated-surface proof over real route data for shared headers, native admin audit navigation, player private disclosure plus `SubmitVote`/`SubmitPost` ACK, moderator host-prompt confirmation/ACK projection removal, and moderator slot-lifecycle confirmation/ACK projection refresh, no-bind compiled-component interaction proof for command controls and re-rendered ACK rows including moderator `ResolveHostPrompt` and `SetSlotStatus`, static SSR focusability proof for modeled focus targets and forbidden ids, tablet interaction source/CSS proof for tap-first preload posture, no hover-only affordances, and shared touch/focus guardrails, no-bind Chromium interaction smoke for command click/focus/touch geometry when Chromium can launch, no-bind keyboard traversal smoke for skip-link-first Tab order and visible focus outlines when Chromium can launch, generated in-app browser file-backed interaction page fixture, static DOM proof over that fixture, plus attempted file-backed browser-run evidence, admin setup/recovery confirmation coverage, admin audit native inspect-route affordance plus principal-scoped operator-proof evidence endpoint, moderator critical-action confirmation coverage including modeled initial focus, focus return, Escape cancel, and tab containment, moderator host-prompt ACK projection-patch and hydrated-refresh removal paths, moderator `SetSlotStatus` browser-promotion predicate and slot lifecycle projection evidence shape, shared shell nav/touch contract, shared nav/focus coverage, fixture-routable and SSR-rendered empty/loading/reject route-state scenarios, no-browser DOM smoke, no-bind render-smoke attempt, generated completion audit, and generated fallback artifact consistency. | Dev-server Chromium pixels/interactions when localhost, Chromium launch, or in-app file navigation is blocked; Svelte client scheduling, command side effects, visible focus rings, or actual tab traversal. |
| `npm run test:frontend-role-proof:browser` | Full multi-role Chromium smoke, including rendered empty/loading/reject route states, screenshot nonblank pixel metrics, player private disclosure before/after screenshots, player tablet-media request evidence, player `SubmitVote` reject followed by `SubmitPost` ACK with refreshed thread evidence, admin/moderator confirmation focus traversal checked against the DOM-visible confirmation contract metadata, admin audit click-through to the native inspect route plus principal-scoped operator-proof evidence endpoint, moderator host-prompt confirm-to-`ResolveHostPrompt` ACK and prompt removal, moderator `modkill_slot` confirm-to-`SetSlotStatus` ACK with refreshed `Modkilled` slot lifecycle evidence, and generated artifact-shape verification when localhost bind is available. | Rust API/live Postgres integration beyond the browser smoke's mocked command, media, and cold-load boundaries. |
| `npm run test:frontend-contract` | Model and controller contracts for app shell, root layout session handoff into error surfaces, root-owned app route shell ownership, role routes, command envelopes, confirmations, projection stores, live deltas, paging, private queues, and host/admin/player components, including player classification for private-channel error paths and the admin session-grant server action's explicit `GlobalMod`-only payload plus positive Unix timestamp validation before the authenticated API request is sent. | Browser rendering, CSS pixel geometry, or real pointer/focus traversal. |
| `npm --prefix frontend run check` | SvelteKit sync and frontend toolchain availability for the Svelte app. | Runtime behavior or route/model correctness. |
| `npm --prefix frontend run build` | Production SvelteKit client/server bundle generation. | Product acceptance, browser interaction, or backend integration. |

The `test:frontend-iab-operator-runbook` and `test:frontend-iab-replay-help`
artifacts treat `target/frontend-completion-audit/completion-audit.json` as part
of the external replay import chain: returned browser evidence must refresh the
browser-acceptance boundary, then the completion audit, then readiness, so the
operator-facing readiness text is derived from current completion state. The
browser-acceptance boundary also exposes the imported file-backed browser run as
its own lane, while the combined file-backed browser-run lane remains the
promotion gate for direct or imported fixture evidence.

### Current completion audit

The generated completion audit reports `status: passed` and
`overall.state: complete` only when the localhost dev-server role-smoke artifact
is actually `passed` locally or when `test:frontend-role-smoke-import` validates
a returned passed role-smoke artifact and its referenced screenshots. In
restricted environments where localhost or Chromium is blocked and
`FMARCH_ALLOW_STATIC_ROLE_FALLBACK=1` regenerates fallback role-smoke artifacts,
the same audit reports `status: incomplete` and `overall.state: not_complete`.
It is intentionally a proof claim over the current admin/player/moderator
frontend objective, not a beta/release-management claim; the readiness summary
keeps diagnostic no-bind and fixture boundaries visible.

| Requirement | Current status | Proven by | Still missing |
|---|---|---|---|
| Shared app shell | `browser_proven` when role-smoke passes; otherwise `dom_proven_browser_blocked` | Static shell/nav/session contract, shared surface-header contract for board/admin/admin-audit/player/moderator first viewports, static first-viewport layout contract for 4/2/1 scan-strip columns and text-wrap guardrails, SSR route shell, DOM surfaces, and dev-server role-smoke screenshots for board/admin/player/moderator, route states, and forbidden routes when available. | No completion blocker after a passed role-smoke; restricted fallback runs still miss browser focus/overlap proof. |
| Tablet-native interaction posture | `browser_proven` when role-smoke passes; otherwise `source_css_ssr_proven_browser_blocked` | Source scan proves tap-first preload posture and no hover-only selectors/handlers; CSS proof covers shared edge-to-edge safe-area shell, sticky safe-area role/session topbar, controlled overscroll, 44px touch/focus/wrapping/scan-strip guardrails, safe-area-aware admin/player/moderator sticky action rails, and SSR thumb-zone placement; dev-server role smoke proves touch geometry, thumb-zone target counts, overlap-checked visible targets, focus traversal, and nonblank screenshots at 1024, 1180, 1280, and desktop widths when it can run. | No completion blocker after a passed role-smoke; diagnostic no-bind Chromium render may still be unavailable in restricted sandboxes. |
| Single root shell architecture | `ssr_and_source_proven` | `frontend/src/routes/root-shell-contract.test.mjs` proves first-class route pages are surface-only and loaders opt into `shellOwner: "layout"`; `target/frontend-route-state-render/route-state-render.json.singleRootShell` proves first-view and route-state pages render exactly one `AppShell`. | No architecture gap in the current app-route shell ownership contract; browser acceptance remains tracked separately. |
| Player surface | `browser_proven` when role-smoke passes; otherwise `dom_and_model_proven_browser_blocked` | Player route model, command reject path, SSR player surface with command receipt strip, tablet-safe thread media variant rendering, older-thread pager pending/ACK/reject model and fixture lifecycle evidence, private-review URL, private-channel URL, DOM player/private-review/private-channel surfaces, and dev-server role-smoke evidence for vote/post ACK refresh, role-PM `SubmitPost`, private disclosure expansion, tablet-safe media requests, focus traversal, overlap-checked targets, and screenshots when available. | No completion blocker after a passed role-smoke. |
| Moderator/host surface | `browser_proven` when role-smoke passes; otherwise `dom_and_model_proven_browser_blocked` | Host route/control models, moderator ACK and host-prompt projection paths, SSR host console and command activity rail, DOM moderator surface, all 10 critical host confirmations, `SetSlotStatus` ACK with refreshed slot lifecycle projection, focus traversal, overlap-checked targets, thumb-zone geometry, and dev-server screenshots when available. | No completion blocker after a passed role-smoke. |
| Admin/operator surface | `browser_proven` when role-smoke passes; otherwise `dom_and_model_proven_browser_blocked` | Admin setup/audit/recovery models, admin reject path, SSR admin and audit detail, DOM admin/audit surfaces, audit-detail click-through evidence, session-grant and recovery-gate ACK evidence, setup/recovery thumb zones, focus traversal, overlap-checked targets, and dev-server screenshots when available. | No completion blocker after a passed role-smoke. |
| Route states | `browser_proven` when role-smoke passes; otherwise `ssr_and_dom_proven` | SSR and DOM empty/loading/reject pages for admin/player/player-private-channel/moderator plus dev-server role-smoke screenshots for every forced route-state surface when available. | No completion blocker after a passed role-smoke. |
| Browser acceptance | `browser_proven` when role-smoke passes; otherwise `blocked_by_localhost_and_chromium_sandbox` | Localhost dev-server role smoke with board/admin/player/moderator, route-state, and forbidden-route screenshots; screenshot pixels; overlap-checked targets; tablet thumb-zone geometry; admin session-grant/recovery-gate form evidence; player main-thread and role-PM `SubmitPost` ACK evidence; player tablet-media browser request evidence; and moderator `SetSlotStatus` lifecycle evidence. | No completion blocker after a passed role-smoke; fallback runs record the localhost/Chromium blocker. |

- **Touch target floor** — primary controls, destructive actions, channel switches, vote
  controls, and host console actions have at least a 44x44 CSS pixel hit area with visible
  spacing between neighboring actions.
- **Thumb-zone placement** — frequent player actions (vote/post/channel switch) and frequent
  host actions (deadline, votecount, replacement, phase, slot lifecycle) are reachable without
  stretching to a remote corner in the tablet layout.
- **Hover independence** — every action, menu, status detail, and affordance needed to play
  or host is available by tap, focus, or visible control state. Hover may add polish, never
  capability.
- **Confirmation shape** — irreversible host actions require explicit confirmation text that
  names the affected game object and intended outcome; admin setup/recovery gates expose
  explicit confirm/cancel targets; opening a confirmation moves focus to the confirm action,
  Escape cancels, Tab stays within local confirmation controls, and close returns focus to the
  trigger. Gestures can open the confirmation but cannot complete the action alone.
- **Stable live layout** — votecount deltas, deadline changes, post edits, channel updates,
  and command acks/rejects do not move primary controls out from under a user's finger.
- **Media variant fit** — thread images render only projection-provided tablet/small/thumb
  variants ([07](07-images.md)); original-only images are withheld with an explicit
  unavailable row, and model/SSR/DOM plus role-smoke browser proof keeps originals and
  desktop-only full variants out of rendered player thread markup and browser request evidence.
- **Keyboard parity** — focus order follows the visual workflow, and keyboard operation can
  reach the same controls as touch for accessibility and desktop scale-up.

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

The shared shell renders role surfaces from resolved capabilities. Allowed surfaces are
touch-sized links; denied surfaces remain visible as disabled, non-navigable controls with
the required capability named, so impossible role switches do not rely on a 403 page as the
primary affordance. The board, admin overview, native admin audit detail, player game,
player channel, and moderator host routes now opt into the root `+layout.svelte` shell, and
their page components render only the role surface. The route-state SSR artifact proves
those root-owned app-route renders still have exactly one `AppShell` across the first-view
board/admin/player/moderator surfaces and every forced route-state page; the
`root-shell-contract.test.mjs` source contract fails if a first-class app route page imports
or renders `AppShell` again, or if its loader stops returning `shellOwner: "layout"`. Shell nav IDs,
session capsule IDs, game/capability summary IDs, and the 44px touch floor are model-owned
through the app shell contract and are asserted in the static no-bind, no-browser DOM, and
build-mode SSR route-state artifacts. The same shell
contract owns the `Skip to app content` link, focusable main target, and keyboard order:
skip link first, then allowed role nav, then the surface's primary controls or route-state
recovery action. Keyboard users can bypass the role nav on every board, admin, player,
moderator, and route-state surface. The board, admin, native admin audit detail, player,
and moderator first-viewport mastheads render through one shared `AppSurfaceHeader`
contract, so role identity, capability labels,
model-owned 44px capability touch metadata, and live-status slots do not drift per page. The
board workbench and active-game actions use the same contract: allowed actions are links,
denied actions stay visible as disabled touch controls.
Generic touch buttons keep the same 44px floor for links and buttons, remove link
underlines, and render disabled/aria-disabled actions with an inert visual state so denied
or unavailable actions do not look tappable.
Live transport, command, paging, and form outcomes use one shared status contract with
stable `data-state` values and live-region metadata, so loading, ack, reject, and confirm
states are announced consistently across admin, player, and moderator surfaces.
Admin audit rows use the same contract for operator-proof status and expose stable native
inspect, authority, boundary, and evidence targets, keeping proof surfaces visible without
promoting presentation text into authority. The admin list links to the SvelteKit audit
detail route, while the detail surface preserves the machine-readable operator-proof URL as
evidence.
The admin first viewport also includes a compact operator strip for authority, setup,
audit, and recovery posture, derived from route data and proof-link status rather than a
separate frontend readiness rule.
The moderator first viewport mirrors that pattern with a host operations strip for phase,
votecount, host prompts, and slot lifecycle posture, derived from the same projections and
live-boundary metadata that feed the detailed control surface.
The player first viewport carries the same scan-first shape for active channel, thread
paging, live votecount, and private queue posture. Its older-thread pager exposes
pending, ACK, and reject states as explicit live-region status rather than hidden transport
flags, while keeping private status copy scoped to the player-visible projection boundary.
All three scan strips render through a shared app status-strip primitive; role-specific
models decide the facts and states, while the primitive owns layout, live-region status
rendering, and responsive 4/2/1 tablet-to-mobile behavior.
Route-level empty, loading, and reject states share one `RouteState` component and a
fixture-only `__fmarch_route_state` route parameter used by the role smoke. The parameter is
only honored under `FMARCH_FRONTEND_FIXTURE_SESSION=1`, so production route state still
comes from capability-gated route data and server projections.

## Key surfaces

### Live votecount component
Subscribes to the `votecount` projection delta stream. **The server tallies; the client
only renders** ([01](01-domain-model.md)) — we never reimplement vote parsing in TS. Shows
current count per candidate, votes-to-hammer, and the projected phase deadline in the same
touch panel, updating live as deltas arrive. The player command panel owns a stable
`player-votecount-deadline` row so the deadline remains visible beside vote/post controls
instead of living only in the masthead copy.

### Game thread
Paginated from `thread_view` (cold-loaded via REST, then live deltas). Posts show
edited/retracted state honestly ([01](01-domain-model.md)). Posting a vote is a **button
that inserts the canonical vote tag** so players never mistype it (resolves the parser-UX
concern from [01](01-domain-model.md) on the client side).

### Channel switcher
Lists only channels the user's capabilities permit. The client never *requests* a channel
it can't see, and the server wouldn't send its deltas anyway ([03](03-backend.md)) — defense
in depth. The player route owns `/g/[game]` for the main thread and `/g/[game]/c/[channel]`
for capability-gated role/dead channels, with unsupported channel IDs rejected before the
surface renders. Private channel pages cold-load their active thread through the
server-gated `/games/[game]/channels/[channel]/thread` projection endpoint and submit
through the typed `SubmitPost.channel_id` command path, which is checked again at the
command boundary. The private-channel route participates in the same fixture-only
empty/loading/reject route-state lane as the main player route, and SSR/DOM proof renders
`/g/midsummer/c/role-pm` through the actual SvelteKit channel wrapper with the active rail
item and channel-scoped private review links.
Private notifications and investigation results render as principal-scoped disclosure
items: collapsed by default, named by the visible private row, and wired with
`aria-expanded`/`aria-controls` so reviewing a result is explicit without exposing host-only
state. Each private row also carries a native review link such as
`/g/[game]?private=notification-1` or
`/g/[game]/c/[channel]?private=notification-1` that reopens the same route with the matching
disclosure expanded; this keeps private review addressable without inventing a separate
detail API or leaking host-only data.

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
