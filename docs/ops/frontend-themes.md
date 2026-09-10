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

The canonical `test:frontend-themes` lane runs the full theme matrix in Chromium,
Firefox, and WebKit before either broad role-smoke or cross-browser journeys.
Both broad lanes declare it as a hard dependency: a theme failure blocks those
journeys even under `--keep-going`. Theme changes still select all three browser
lanes and visual regression for landing; the broad journeys no longer repeat
the theme matrix.

The theme harness drives real routes and the healthy workbench, checking both
themes, responsive geometry, live phase transitions, route teardown, preference
persistence, independent system/light/dark behavior, and semantic contrast.
Each engine writes `theme-browser.json` and 36 screenshots under its `themes/`
subdirectory; the lane validates the complete matrix, contrasts, preferences,
and screenshot files before writing `themes.json`. These are fixture-backed
browser artifacts, separate from hosted or native Safari acceptance. Palette
behavior assertions use real application inputs; the shared contrast sampler
reads each CSS palette directly.

For focused diagnosis, the fleet `themes` verification mode runs only the theme
lane through the normal Linux wrapper and shared admission lock. The
`cross-browser` mode also includes its theme prerequisite. Focused receipts do
not replace normal diff-selected push proof for landing. The browser harness
reapplies native system-appearance emulation after document navigation and
verifies the media query before asserting application state.

Use `npm run proof:lanes -- --mode push` to plan the required closure, push the
clean task checkpoint, then use `npm run proof:remote -- --mode push`. Inspect the
signed Cachy receipt before landing. Follow the canonical verification runbook
for fleet job and artifact inspection.
