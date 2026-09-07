# Frontend proof

Use the narrowest gate that proves the changed behavior, then run the lanes
selected by `npm run proof:lanes -- --mode push --run`. The
[proof manifest](proof-lane-manifest.json) and root `package.json` own lane
composition; this guide explains what the evidence means. Host locking,
checkpoint modes, caching, and publishing policy live in
[AGENTS.md](../../AGENTS.md).

## Entry points

| Command | Evidence | Boundary |
|---|---|---|
| `npm run test:ui-workbench` | Fixture launcher, session, and route contracts | No live API or database |
| `npm run test:frontend-role-proof:quick` | Model contracts, SSR route states, static tablet contracts, DOM smoke | No Chromium or real network interaction |
| `npm run test:frontend-role-proof:browser` | Hydrated role flows, screenshots, focus, touch geometry, confirmations, artifacts and acceptance audit | Role smoke mocks API boundaries; it is not real backend proof |
| `npm run test:host-console-live-stack-smoke` | Rust API + scratch Postgres + SvelteKit + Chromium, commands, private access and media | Local runtime/storage proof, not hosted evidence |
| `npm run test:host-console-day-event-room-live-stack` | Live private DayEvent lifecycle and recovery | Scoped live-stack scenario |
| `npm run test:frontend-role-proof` | Restricted-environment fallback chain and artifact validation | Fallback results never substitute for full browser acceptance |
| `npm --prefix frontend run build` | Production bundle generation | Does not establish runtime correctness |
| `npm --prefix frontend run check` | SvelteKit sync and toolchain availability | Does not run a TypeScript semantic check |

For UI-only iteration, start `npm run ui:dev`; see
[UI workbench](../ui-workbench.md). Browser evidence covers the viewport matrix
specified by the role-smoke scenarios. Do not copy viewport counts or measured
runtimes into architecture prose.

## Ownership of browser flows

`tools/frontend_role_smoke.mjs` interprets the declarative flow, command mock,
and network fixture tables in `tools/frontend_role_smoke_flows.mjs`. Role
selectors and budgets live in `tools/frontend_role_smoke_scenarios.mjs`.
Extend those tables for ordinary feature flows; reserve named runner hooks for
operations that need page globals or independent sub-proofs.

Role proof checks the real Svelte surfaces: allowed/forbidden routes, command
ACK/rejection, player disclosures, host confirmation behavior, focus return,
keyboard order, touch geometry, overlap, and nonblank screenshots. Live-stack
proof crosses the actual command/projection boundary and includes bounded
PNG/JPEG upload, canonical media attachment, manifest-backed variants, and
private-media denial to a non-member.

## Artifact interpretation

| Artifact family under `target/` | Meaning |
|---|---|
| `frontend-route-state-render/` | Build-mode SSR route and shell contracts |
| `frontend-static-role-contract/`, `frontend-role-dom-smoke/` | Static and DOM evidence |
| `frontend-static-focusability/`, `frontend-keyboard-traversal/` | Modeled focus and attempted browser traversal |
| `frontend-role-render-smoke/` | No-listener Chromium rendering when available |
| `frontend-role-smoke/` | Dev-server role-smoke result and screenshots, or explicitly weaker fallback |
| `frontend-in-app-browser-*/` | Prepared fixture, replay, import, and bundle evidence |
| `frontend-browser-acceptance-boundary/` | Classification of direct/imported evidence |
| `frontend-completion-audit/`, `frontend-readiness-summary/` | Derived requirement and readiness summaries |

A passed assertion about an artifact's shape does not prove that a browser ran.
`static-dom-fallback-passed` and `static-render-fallback-passed` preserve useful
partial evidence when localhost or Chromium is blocked. Full role acceptance
requires a direct or validated imported localhost role-smoke run. Local UI
acceptance does not establish hosted identity, durability, release approval,
or human assistive-technology acceptance.

SSR output reuse is content-addressed through the route-state render input
stamp. `FMARCH_FORCE_ROUTE_STATE_RENDER=1` forces rebuilding. Reuse must not
weaken source freshness, screenshot checks, or artifact linkage.

## Restricted environments and replay

`FMARCH_ALLOW_STATIC_ROLE_FALLBACK=1` explicitly enables fallback when browser
execution is blocked. The result records that boundary instead of silently
promoting static markup to browser evidence.

The file-backed and localhost-served fixture lanes are distinct from the fully
hydrated application lane. Use the generated operator instructions:

```sh
npm run test:frontend-iab-operator-runbook
npm run test:frontend-iab-replay-help
```

They name the current fixture, replay, bundle/import commands, expected return
files, and freshness steps. Returned evidence must refresh the browser
acceptance boundary, completion audit, and readiness summary in that order;
a file-fixture replay alone cannot promote full application acceptance.
