import { UNALIGNED, normalizeRoleReference } from "./role-reference-model.mjs";

export const ROLE_CARD_CONTRACT = Object.freeze({
  component: "role-card",
  variants: Object.freeze(["full", "compact", "chip"]),
  rootTestId: "role-card",
  nameTestId: "role-card-name",
  abilityTestId: "role-card-ability",
  traitTestId: "role-card-trait",
});

// Stroke paths on a 24px grid; every glyph is decorative next to its label.
export const ROLE_ICON_PATHS = Object.freeze({
  town: "M4 11l8-7 8 7M6 9.5V20h12V9.5M10 20v-5h4v5",
  mafia: "M7 4c1.2 5 .2 10.5-3 16M12.5 4c1.2 5 .2 10.5-3 16M18 4c1.2 5 .2 10.5-3 16",
  independent: "M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6l-5.4 2.9 1.2-6-4.5-4.2 6.1-.7z",
  Protect: "M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z",
  Investigate: "M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM15.5 15.5L20 20",
  Kill: "M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16zM12 2v5M12 17v5M2 12h5M17 12h5",
  Block: "M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16zM6.3 6.3l11.4 11.4",
  Mark: "M4 4h7l9 9-7 7-9-9zM8.5 8.5h.01",
  RevealTown: "M4 10v4h3l6 4V6l-6 4zM17 9a4 4 0 0 1 0 6",
  day: "M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  night: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z",
  passive: "M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16zM8.5 12h7",
  trait: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6",
  chat: "M5 5h14v10H10l-5 4z",
  Redirect: "M4 7h12l-3-3M16 7l-3 3M20 17H8l3 3M8 17l3-3",
  Clear: "M5 19h14M8 15l8-8 3 3-8 8H8z",
  Grant: "M4 10h16v10H4zM12 10v10M4 14h16M12 10c-2-4-6-4-6-1.5S10 10 12 10c2 0 6 1 6-1.5S14 6 12 10",
  Convert: "M20 12a8 8 0 0 1-14 5.3M4 12a8 8 0 0 1 14-5.3M18 3v4h-4M6 21v-4h4",
  Link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  Visit: "M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16M3 21h18M14 12h.01",
  Info: "M4 6h16v12H4zM4 7l8 6 8-6",
  Duel: "M5 19L19 5M15 5h4v4M19 19L5 5M5 9V5h4",
  Veto: "M7 11V6a2 2 0 0 1 4 0v4M11 10V4a2 2 0 0 1 4 0v6M15 10V6a2 2 0 0 1 4 0v8a7 7 0 0 1-14 0v-3a2 2 0 0 1 4 0",
  Badge: "M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6l-5.4 2.9 1.2-6-4.5-4.2 6.1-.7z",
});

const ABILITY_ICONS = Object.freeze({
  Retaliate: "Kill",
  ItaShot: "Kill",
  SelfDestruct: "Kill",
  VoteDuel: "Duel",
});

const WINDOWS = Object.freeze({
  Day: Object.freeze({ id: "day", label: "Day", icon: ROLE_ICON_PATHS.day, cadence: "Every day" }),
  Night: Object.freeze({ id: "night", label: "Night", icon: ROLE_ICON_PATHS.night, cadence: "Every night" }),
  Twilight: Object.freeze({ id: "night", label: "Twilight", icon: ROLE_ICON_PATHS.night, cadence: "Every twilight" }),
  Instant: Object.freeze({ id: "day", label: "Any time", icon: ROLE_ICON_PATHS.day, cadence: "Any time" }),
  Any: Object.freeze({ id: "day", label: "Any time", icon: ROLE_ICON_PATHS.day, cadence: "Any time" }),
  Passive: Object.freeze({ id: "passive", label: "Passive", icon: ROLE_ICON_PATHS.passive, cadence: "Always" }),
});

export function roleWindows(entry) {
  const windows = [];
  for (const action of entry?.actions ?? []) {
    const window = WINDOWS[action.window];
    if (window && !windows.some((known) => known.label === window.label)) windows.push(window);
  }
  return Object.freeze(windows.length > 0 ? windows : [WINDOWS.Passive]);
}

// The crest follows the alignment's visual family; unaligned roles keep the
// independent palette but a distinct crest and label.
export function roleAlignment(alignment) {
  const resolved = alignment ?? UNALIGNED;
  return Object.freeze({
    ...resolved,
    icon: resolved.unaligned ? ROLE_ICON_PATHS.passive : ROLE_ICON_PATHS[resolved.id],
  });
}

function abilityIcon(kind) {
  return ROLE_ICON_PATHS[kind] ?? ROLE_ICON_PATHS[ABILITY_ICONS[kind]] ?? ROLE_ICON_PATHS.passive;
}

function abilityTags(action, window) {
  const cadence = action.uses === null
    ? window.cadence
    : action.uses === 1 ? "Once per game" : `${action.uses} uses per game`;
  return Object.freeze([
    cadence,
    action.roleblockable ? "Roleblockable" : "Unblockable",
    `Priority ${action.priority}`,
    ...action.notes,
  ]);
}

/**
 * `role` is a normalized entry (role-reference-model.mjs); `reference` is a
 * raw wire RoleReference, normalized here. Either may be absent: an unknown
 * role renders nothing.
 */
export function buildRoleCardViewModel({ role = null, reference = null, variant = "full", bare = false } = {}) {
  const entry = role ?? (reference === null ? null : normalizeRoleReference(reference));
  if (entry === null) return null;
  const resolvedVariant = ROLE_CARD_CONTRACT.variants.includes(variant) ? variant : "full";
  const alignment = roleAlignment(entry.alignment);
  const channels = entry.channels.length > 0
    ? entry.channels.map((label) => Object.freeze({ label, empty: false }))
    : [Object.freeze({ label: "Public thread only", empty: true })];

  return Object.freeze({
    contract: ROLE_CARD_CONTRACT,
    variant: resolvedVariant,
    framed: bare !== true,
    key: entry.key,
    name: entry.name,
    summary: entry.summary,
    packName: entry.packName,
    alignment,
    windows: roleWindows(entry),
    abilities: Object.freeze(entry.actions.map((action) => {
      const window = WINDOWS[action.window] ?? WINDOWS.Passive;
      return Object.freeze({
        label: action.label,
        icon: abilityIcon(action.kind),
        window,
        targets: action.targets,
        tags: abilityTags(action, window),
      });
    })),
    traits: entry.traits,
    channels: Object.freeze(channels),
    win: entry.win,
    icons: ROLE_ICON_PATHS,
  });
}
