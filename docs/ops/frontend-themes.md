# Frontend themes and healthy previews

The root layout owns an isolated theme context. Routes publish canonical phase
identifiers through scoped claims; release from an old route cannot clear a new
route's claim. Presentation labels are not theme inputs. The shell falls back to
its server-projected `phaseId` until a live projection is available.

`frontend/src/lib/app/theme.mjs` defines the theme registry and pure resolver.
The inputs are `themeId`, `scheme`, `phaseId`, and `systemScheme`. The output
separates domain `phase`, resolved light/dark `scheme`, and visual `palette`.

- Follow game: day, night, or twilight in a game; system appearance elsewhere.
- System: follows the device independently of game phase.
- Light or Dark: fixed appearance independently of game phase.

Appearance is available through the existing account/sign-in entry, or directly
at `/appearance`. A validated, HttpOnly browser cookie persists the selection;
this is a device preference and does not confer identity or game authority.
Explicit preferences render on the server; system preference is detected after
hydration and tracks subsequent device changes.

## Theme contract

`styles/tokens.css` composes the shared geometry/type token contract and the Paper
and Slate definitions. Each theme supplies all semantic color tokens in every
palette. Raw color literals belong only in `styles/themes/*.css`. Shared
primitives and component styles consume these semantic variables.

Theme definitions control colors, font families, heading scale, shape, card
spacing, reading width, and floating elevation. Touch-target minima and
responsive layout are interaction contracts, not density settings. Access rules,
route selection, command semantics, and navigation structure stay outside themes.

To add a theme, register its id in `theme.mjs`, add a complete CSS definition,
and import it through `tokens.css`. The token-completeness test catches missing
palette values. A new theme should not need role model or component markup edits.

## Workbench

Start the fixture-only development server with `npm run ui:dev`. The player,
normal-player, and host launchers opt into a simulated healthy transport before
route children mount. The toolbar changes phase through connection refresh, using
the same projection validators as real updates. Commands are explicitly disabled.
Other launchers retain their existing fixture surfaces.

`lib/dev/role-fixtures.mjs` supplies shared deterministic API projections to both
the workbench and role smoke tests. Preview adaptations are fresh copies: text-only
posts, empty private results, the selected actor, and a projected phase. They do
not change the shared proof fixtures. Preview state is opt-in and is unavailable
unless fixture mode is enabled; production rejects fixture mode at startup.

## Verification

The existing canonical role-smoke lane includes `tools/frontend_theme_proof.mjs`.
It drives real routes and the healthy workbench without changing theme DOM
attributes, checking both themes, responsive geometry, live phase transitions,
route teardown, preference persistence, independent system/light/dark behavior,
and semantic contrast. Screenshots are written under that lane's `themes/`
artifact directory. These are deterministic browser evidence, not hosted or
native Safari acceptance.

For focused Firefox/WebKit diagnosis, the fleet profile also provides the
`cross-browser` verification mode. It runs only that lane through the same
Linux wrapper and shared admission lock. A focused receipt does not replace the
normal diff-selected push proof required for landing. The browser harness
reapplies native system-appearance emulation after document navigation and
verifies the media query before asserting application state.

Use `npm run proof:lanes -- --mode push` to plan the required closure, push the
clean task checkpoint, then use `npm run proof:remote -- --mode push`. Inspect the
signed Cachy receipt before landing. Follow the canonical verification runbook
for fleet job and artifact inspection.
