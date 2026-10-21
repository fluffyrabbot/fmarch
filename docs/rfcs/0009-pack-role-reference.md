# RFC 0009 — Pack-owned role reference

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Created** | 2026-10-21 |
| **Accepted** | 2026-10-21 |
| **Decision owner** | Project owner |
| **Target** | content_registry, api role reads, wire, role cards, `/roles`, player role card, host setup |
| **Related** | [09-engine-and-packs](../arch/09-engine-and-packs.md), [RFC 0008](0008-legible-game-surfaces.md) |

## Summary

Branch `ux/role-cards-20261021` added role cards and a public `/roles`
reference. Their data comes from `role-catalog.mjs`, a hand-written copy of 19
of Mafia Universe's 111 roles. The frontend has no other way to get role facts:
packs reach it only as host setup's key/label/description and as the player's
own key/alignment/description.

This RFC moves role presentation into a validated sidecar that each pack owns
(`packs/<key>/presentation.json`). It also adds one public, cacheable read per
pack that joins the typed pack IR with that sidecar. Every role surface (the
reference, the player's role card, host setup, revealed-role chips) renders
from that one projection. The pack IR, `PackRef` content addresses, and the
database schema are unchanged.

## Findings

### 1. Where each role fact lives

Every rule fact below is typed in the domain IR (`crates/domain/src/pack/model.rs`).
None of them exists only in raw pack JSON. What is missing is player-facing
wording, not typing.

| Fact | Home | Typed? |
|---|---|---|
| Description | `Role.description` (model.rs:167) | `String`, written for developers |
| Alignment | `Role.alignment: Option<AlignmentKey>` (model.rs:169) | An open `String`. Product packs use town, mafia, independent, wolf, cult, jester, executioner and condemner. Two roles per MU/mafiascum (Lover, Neighbor) are unaligned |
| Role modifiers | `Role.modifiers: Vec<RoleModifier>` (model.rs:171, 179) | Closed enum (Lost, Recluse) |
| Actions | `Role.actions: Vec<ActionTemplate>` (model.rs:173, 1441) | ability `IrAbility` (closed, `ir.rs:9`), `additional_abilities`, `window: Window` (191), `targets: TargetSpec` (221), `modifiers`, `mode`, `effect`, `reads_effect`, `redirect`, `grant`/`grant_options`, `conversion`, … |
| Constraints | `Constraints` (model.rs:1536) | `roleblockable`, `priority`, `x_shots`, `self_allowed`, `max_targets`, `unique_targets`, plus the less common `personal_only`, `target_state`, `target_role_filter`, `cooldown_cycles`, `active_from`, `phase_parity`, `cycle_parity`, `disabled_at_or_below_alive` |
| Role effects (miller, godfather, bomb, …) | `Role.effects: Vec<Tag>` (model.rs:175) | The tag is typed. Its *meaning* comes from other pack tables: `investigation_overrides` (49), `triggers` (44), `effects` lifecycle (57), `death_reveal.by_effect` (102), `backup_policy` |
| Private channels | `Pack.private_channels` (152, groups at 916) | Typed and keyed by role/alignment, so a role's channels are found by joining back to the role |
| Win | `Pack.win` (162), `win_families` (41), `self_lynch_win_policies` (129), `target_lynch_win_policies` (125) | Typed and alignment-keyed. A role's win condition is its alignment's rules plus any self- or target-lynch policy that names the role |
| Death reveal | `Pack.death_reveal` (102, policy 778) | Typed: by cause (Janitor) and by effect (Flipless) |
| Investigation overrides | `Pack.investigation_overrides` (49) | Typed, effect tag → result |

The facts are typed, but not in a role-shaped way. A role's player-visible
behaviour is a join across about six pack tables, and no code performs that
join today.

### 2. Duplicate label and description logic

Seven places derive a display string from a key or a description. They disagree:

| Site | Rule | `town_ita_shooter` | `mafia_goon` |
|---|---|---|---|
| `role_label` (`crates/api/src/game_http.rs:2846`) | first sentence of the description if ≤ 80 chars, else title-cased key | "Town ITA participant for the first Mafia Universe ITA vertical" | "Mafia Goon" |
| `humanize_identifier` (game_http.rs:2856) | title case | — | "Mafia Goon" |
| `humanizeRoleTag` (`player-role-card-model.mjs:105`) | sentence case | "Town ita shooter" | "Mafia goon" |
| `humanizeIdentifier` (`setup-route-model.mjs:444`) | title case, fallback when `label` is missing | "Town Ita Shooter" | "Mafia Goon" |
| `humanizeTag` (`player-endgame-summary-model.mjs:144`) | sentence case, lower-cases the rest | "Town ita shooter" | "Mafia goon" |
| `humanize` (`public-game-publication.mjs:72`) | sentence case | — | — |
| `role-catalog.mjs` | hand-written | (absent) | "Goon" |

`action_label` (game_http.rs:1496) also renders every action as "Submit
<id with spaces>", whatever its ability. In the 277 product-pack roles, about
35 descriptions open with internal prose. Many more go on to mention "effect
tag", "trigger table" or "v1 pack". A pack description is author
documentation, not player copy.

### 3. A home for presentation

| | `presentation` block inside `pack.json` | Sidecar `packs/<key>/presentation.json` |
|---|---|---|
| Content address | Every copy edit changes the `PackRef` hash (content_registry `PackArtifactSnapshot::from_document`, lib.rs:131) | Rule identity is untouched |
| Game custody | The copy is stored in every `GameCreated` snapshot. `verify_pack_artifact` requires byte-identical canonical re-serialization (lib.rs:450), so the field must be skip-if-empty forever | The copy is not in game custody. In-game cards take mechanics from the game-owned snapshot and words from the sidecar, keyed by role key |
| Closed-IR rule (doc 09) | Adds a non-rule table to the engine crate's `Pack` | The engine stays rules-only. The registry (platform layer) owns the join |
| Precedent | `host_prompt_kinds` (model.rs:26, 1931) | Program catalog sidecars in `programs/` |

**Decision: sidecar.** Words are a platform concern. Rules are engine data.
`host_prompt_kinds` stays as it is, because prompt text is part of a game's
recorded decision surface.

### 4. Visibility

Public at all times: everything in a pack, including role existence,
mechanics, descriptions, and the death-reveal policy itself. Pack files are
product content that ships in the image, and `/roles` is a rules reference.

Dependent on game state: who holds which role (`slot_state.role_key`), and
whether a holder's role or alignment has been revealed
(`role_revealed`/`alignment_revealed`, set by `reveal_slot_death` in
`crates/projections/src/lib.rs:10613` from the event's `DeathRevealMode`, plus
`RoleRevealed`/`AlignmentRevealed` events at `crates/domain/src/events.rs:395`).
Janitor cleaning and Flipless resolve to `Concealed` there. The endgame summary
already gates per slot on those flags (game_http.rs:280).

So the reference read takes a **pack key only, never a game id**. It cannot
express occupancy. Role chips in game surfaces render only from slots the
projection has already marked `role_revealed`.

## Decisions

1. **Sidecar presentation, validated by content_registry.** Each product pack
   has a `presentation.json` holding `roles.<key>.{name, summary,
   actions.<id>.label?}`, `alignments.<key>.{label, win}`, and
   `effects.<tag>.trait`. The registry embeds it beside the pack and checks
   that it is closed both ways: every role, the alignments in use, and every
   role-borne effect tag must have copy, and every key in the sidecar must
   name something in the pack. A presentation digest joins `registry_hash`, so
   the exact-image content smoke covers copy drift as well.
2. **Copy for all five product packs, drafted from mechanics.** Name and
   one-line summary are required for all 277 roles. The draft is reviewed as a
   diff. Ability labels default to the action id, humanized once on the
   server, and may be overridden per action.
3. **One role-reference projection in the registry.** A pure function
   `role_reference(pack, presentation, role_key)` performs the six-table join:
   alignment and its win copy, each action's ability kinds, window, targets
   and constraints, effects rendered as traits, private channels, the win
   family, and the death-reveal override that applies to the role. It is the
   only owner of display labels. `role_label`, `humanize_identifier` (for
   roles), `humanizeRoleTag`, setup's role fallback, and `role-catalog.mjs`
   are deleted.
4. **Wire contract.** `PackRoleReference` / `RoleReference` and a
   `PackCatalogEntry` list are exported through `wire::typescript::render`
   beside `GameIndexPage`.
5. **Public read.** `GET /packs` and `GET /packs/{key}/roles`. Both are
   unauthenticated, return `Cache-Control: public, max-age=300`, and carry an
   `ETag` equal to the registry hash. No game state is read.
6. **Self-scoped card stays self-scoped.** `PlayerCommandRoleView` carries the
   same `RoleReference`, built server-side from the **game-owned** pack
   snapshot plus the sidecar. An archived game keeps its own mechanics. The
   frontend leak boundary (`player-role-card-model.mjs`) is unchanged.
7. **Navigation.** "Roles" joins `surfaceOrder`, and the 390px topbar
   crowding is fixed in the same slice. Visual baselines are re-recorded
   deliberately, with the reason recorded in the commit.

## Delivery slices and proof cost

| Slice | Touches | Re-armed lanes (manifest tiers) |
|---|---|---|
| A. Sidecars + registry validation + projection | `packs/*/presentation.json` (new), `crates/content_registry` | `packs` (frozen): domain, content-registry, commands-pg, exact-image-content; `crate:content-registry` (frozen) |
| B. Wire types + public read + player role view | `crates/wire`, `crates/api/src/game_http.rs` | `crate:wire` (frozen): check:wire-types; `crate:api` (frozen) + `api:public-game-citations`: mash-scale, security baseline, dev-test-game-game-index |
| C. Frontend normalizer, `/roles` pack selector + deep links, delete catalog | `role-card/`, `routes/roles/`, `package.json` globs | `frontend:game` (frozen): full frontend role/visual set |
| D. Integration: player card, revealed chips, setup compact cards, nav | `player-role-card/`, setup route, app shell | `frontend:game` + visual baselines |

There are no IR schema changes, no `ir_version` bump, no migration, and no
change to stored `GameCreated` artifacts. Six frozen areas re-arm, which makes
this an expensive push. A forced full sweep is not required, because no
frozen area changes semantics.

## Implementation checkpoint

Branch `ux/role-cards-20261021` delivers slices A–D:

- **A.** Presentation sidecars for all five product packs (277 roles), registry
  validation that is closed in both directions, and the projection. The
  read-model types live in `game_platform::role_reference`, so no hub crate
  gains a dependency edge (RFC 0006 ratchets unchanged). A snapshot of the
  projection, `frontend/src/lib/dev/pack-role-reference.fixture.json`, feeds
  fixture-mode pages. The registry test
  `frontend_role_reference_fixture_matches_the_projection` holds it to the
  projection; regenerate it with
  `FMARCH_WRITE_ROLE_REFERENCE_FIXTURE=1 cargo test -p content_registry`.
- **B.** `GET /packs` and `GET /packs/{key}/roles`, the wire types, and
  `RoleReference` on the player's own role and on host setup options.
- **C.** Role cards and `/roles` render from the reference. The page has a
  pack selector and `?pack=&role=` deep links, and shows an explicit
  unavailable state when the API cannot be reached. `role-catalog.mjs` is
  deleted.
- **D.** The player's own role renders as a bare full card inside its
  disclosure. Endgame rows render revealed roles as chips that open the role
  modal, and the server attaches a reference only to slots the projection
  has revealed. Host setup shows compact cards. Roles joins the primary nav.

The branch also fixes two defects in the Moonlit Den base commit. Below
840px, the topbar's scoped styles overlapped the primary nav labels. The
theme switch echoed refused paths into error pages.

- **E. Role chips in thread posts** (follow-up). A system post carries
  `role_reveals`: a slot and role key per seat it announces. Migration 0020
  stores the list on `thread_view`, restricted to main. The projection fills
  it after the resolution's inner events fold, and only for seats whose
  `role_revealed` flag is set, so a Janitor, Flipless or alignment-only flip
  carries none. The same gate now covers the `role:` clause in the
  day-announcement body text, which used to print the victim's role whatever
  its reveal mode. The API attaches each reveal's `RoleReference`. The player
  thread and the public game page render it as a chip that opens the role
  modal. The proof is `concealed_flips_carry_no_role_in_thread_posts`
  (api vertical), the route-state SSR render, and the frontend model tests.

Deferred, each a self-contained follow-up:

- **Concealed roles in the day-note event.** `collect_night_victims_from_applied`
  (crates/commands/src/lib.rs) copies the victim's role into
  `DayAnnouncement.role_key` regardless of the death's `DeathRevealMode`. The
  projection keeps it off every public surface, but the stored event should
  carry no role the death concealed.
- **Player action buttons.** These still use `action_label()` ("Submit
  <id>"), not the presentation's ability labels.
- **Fallback for packs without presentation.** `humanizeRoleTag` remains in
  the player card for test fixture packs, where no reference exists.

## Non-goals

- Localization. The sidecar is single-language, but because it is a separate
  file per pack, adding locales later is additive.
- Showing a game's role list (setup occupancy) on `/roles`.
- Rewriting pack `description` fields. They stay author documentation.
