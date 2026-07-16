# UI workbench

The UI workbench is the default local environment for UI/UX iteration. It uses
the same deterministic fixture projections and role routes as the frontend role
proof, so visual work does not need Postgres, the Rust API, or a seeded live
game.

Start it from the repository root:

```sh
npm run ui:dev
```

The command opens `http://127.0.0.1:5173/_dev/ui` and keeps that port strict so
screenshots, bookmarks, and browser state have one stable origin. The launcher
switches an HTTP-only local fixture session before opening each real route.

## Iteration loop

1. Pick the board, player, private-channel, moderator, setup, or admin surface.
2. Resize the browser to the listed `390 × 844`, `1024 × 768`, or `1440 × 920`
   baseline. Tablet is the product's primary interaction target.
3. Use the `empty`, `loading`, and `reject` links to review non-happy route
   states without changing backend data.
4. Edit frontend models, Svelte components, tokens, or primitives. Vite refreshes
   the route against the same deterministic fixture.
5. Run the narrow workbench contract and the role proof appropriate to the
   change:

```sh
npm run test:ui-workbench
npm run test:frontend-role-proof:quick
```

Use `npm run test:frontend-role-proof:browser` when interaction behavior,
keyboard order, or responsive layout changes materially. Its screenshots are
written under `target/frontend-role-smoke/`.

## Boundary

`/_dev/ui` and its fixture-session switcher return `404` unless
`FMARCH_FRONTEND_FIXTURE_SESSION=1`. Do not set that environment variable on a
hosted service. The workbench exercises presentation and browser behavior; use
the local live-stack lane when API, command, projection, or reconnect behavior is
part of the change.
