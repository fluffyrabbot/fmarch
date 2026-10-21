import { ROLE_ALIGNMENTS, ROLE_PACK, findRole } from "./role-catalog.mjs";

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
});

const WINDOWS = Object.freeze({
  Day: Object.freeze({ id: "day", label: "Day", icon: ROLE_ICON_PATHS.day }),
  Night: Object.freeze({ id: "night", label: "Night", icon: ROLE_ICON_PATHS.night }),
  Passive: Object.freeze({ id: "passive", label: "Passive", icon: ROLE_ICON_PATHS.passive }),
});

export function roleWindows(entry) {
  const windows = [];
  for (const action of entry?.actions ?? []) {
    const window = WINDOWS[action.window];
    if (window && !windows.includes(window)) windows.push(window);
  }
  return Object.freeze(windows.length > 0 ? windows : [WINDOWS.Passive]);
}

export function roleAlignment(id) {
  const alignment = ROLE_ALIGNMENTS.find((candidate) => candidate.id === id) ?? ROLE_ALIGNMENTS[0];
  return Object.freeze({ ...alignment, icon: ROLE_ICON_PATHS[alignment.id] });
}

export function buildRoleCardViewModel({ role = null, roleKey = null, variant = "full", bare = false } = {}) {
  const entry = role ?? findRole(roleKey);
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
    packName: ROLE_PACK.name,
    alignment,
    windows: roleWindows(entry),
    abilities: Object.freeze(entry.actions.map((action) => Object.freeze({
      label: action.label,
      icon: ROLE_ICON_PATHS[action.kind] ?? ROLE_ICON_PATHS.passive,
      window: WINDOWS[action.window] ?? WINDOWS.Passive,
      targets: action.targets,
      tags: Object.freeze([
        action.window === "Day" ? "Every day" : "Every night",
        action.roleblockable ? "Roleblockable" : "Unblockable",
        `Priority ${action.priority}`,
      ]),
    }))),
    traits: entry.traits,
    channels: Object.freeze(channels),
    win: alignment.win,
    icons: ROLE_ICON_PATHS,
  });
}
