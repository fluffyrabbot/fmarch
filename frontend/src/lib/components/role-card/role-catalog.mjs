// Player-facing presentation for the Mafia Universe pack's dealt roles.
// Mechanics mirror packs/mafia_universe/pack.json and are held to it by
// role-catalog.test.mjs; names, summaries, ability labels and traits are the
// reference copy. A live pack-roles read can replace this module later.

const ONE_OTHER = "one player, not yourself";

function action(kind, label, { window = "Night", targets = ONE_OTHER, roleblockable = true, priority }) {
  return Object.freeze({ kind, label, window, targets, roleblockable, priority });
}

function role(key, { name, alignment, summary, actions = [], traits = [], channels = null }) {
  return Object.freeze({
    key,
    name,
    alignment,
    summary,
    actions: Object.freeze(actions),
    traits: Object.freeze(traits.map((trait) => Object.freeze(trait))),
    channels: Object.freeze(channels ?? (alignment === "mafia" ? ["Mafia chat"] : [])),
  });
}

export const ROLE_PACK = Object.freeze({ key: "mafia_universe", name: "Mafia Universe" });

export const ROLE_ALIGNMENTS = Object.freeze([
  Object.freeze({ id: "town", label: "Town", win: "Every Mafia member and hostile killer is gone." }),
  Object.freeze({ id: "mafia", label: "Mafia", win: "The Mafia equal or outnumber everyone else." }),
  Object.freeze({ id: "independent", label: "Independent", win: "Only you are left standing." }),
]);

export const ROLE_CATALOG = Object.freeze([
  role("town_doctor", { name: "Doctor", alignment: "town",
    summary: "Each night, protects one player from ordinary night kills.",
    actions: [action("Protect", "Protect", { priority: 70 })] }),
  role("town_bodyguard", { name: "Bodyguard", alignment: "town",
    summary: "Each night, guards one player and dies intercepting the kill aimed at them.",
    actions: [action("Protect", "Guard", { priority: 70 })] }),
  role("town_cop", { name: "Cop", alignment: "town",
    summary: "Each night, investigates one player and learns whether they read Town or Scum.",
    actions: [action("Investigate", "Parity check", { priority: 20 })] }),
  role("town_tracker", { name: "Tracker", alignment: "town",
    summary: "Each night, follows one player and learns whom they visited.",
    actions: [action("Investigate", "Track", { priority: 10 })] }),
  role("town_watcher", { name: "Watcher", alignment: "town",
    summary: "Each night, watches one player and learns who visited them.",
    actions: [action("Investigate", "Watch", { priority: 10 })] }),
  role("town_roleblocker", { name: "Roleblocker", alignment: "town",
    summary: "Each night, blocks the first roleblockable action of one player.",
    actions: [action("Block", "Block", { roleblockable: false, priority: 90 })] }),
  role("town_jailkeeper", { name: "Jailkeeper", alignment: "town",
    summary: "Each night, jails one player: blocked and protected by the same action.",
    actions: [action("Block", "Jail", { priority: 90 })] }),
  role("town_vigilante", { name: "Vigilante", alignment: "town",
    summary: "Each night, may kill one player, separate from the Mafia kill.",
    actions: [action("Kill", "Shoot", { priority: 30 })] }),
  role("town_day_vigilante", { name: "Day Vigilante", alignment: "town",
    summary: "Each day, may kill one player before the vote resolves.",
    actions: [action("Kill", "Day shot", { window: "Day", roleblockable: false, priority: 60 })] }),
  role("innocent_child", { name: "Innocent Child", alignment: "town",
    summary: "During the day, may publicly confirm they are Town without revealing their role.",
    actions: [action("RevealTown", "Reveal as Town", { window: "Day", targets: "yourself", roleblockable: false, priority: 70 })] }),
  role("mason", { name: "Mason", alignment: "town",
    summary: "Shares a private chat whose members are confirmed Town to each other.",
    traits: [{ text: "Mason chat confirms members as Town", short: "Confirmed chat" }],
    channels: ["Mason chat"] }),
  role("miller", { name: "Miller", alignment: "town",
    summary: "Town-aligned, but reads as Scum to parity cops.",
    traits: [{ text: "Reads as Scum to parity cops", short: "Reads Scum" }] }),
  role("town_vanilla", { name: "Vanilla Town", alignment: "town",
    summary: "No night actions. Wins with talk, reads and the vote." }),
  role("godfather", { name: "Godfather", alignment: "mafia",
    summary: "Leads the Mafia, carries the factional kill and reads as Town to parity cops.",
    actions: [action("Kill", "Factional kill", { priority: 30 })],
    traits: [{ text: "Reads as Town to parity cops", short: "Reads Town" }] }),
  role("mafia_goon", { name: "Goon", alignment: "mafia",
    summary: "A Mafia member with no power of their own, who may carry the factional kill.",
    actions: [action("Kill", "Factional kill", { priority: 30 })] }),
  role("mafia_roleblocker", { name: "Roleblocker", alignment: "mafia",
    summary: "Each night, blocks the first roleblockable action of one player.",
    actions: [action("Block", "Block", { roleblockable: false, priority: 90 })] }),
  role("mafia_framer", { name: "Framer", alignment: "mafia",
    summary: "Each night, frames one player so a same-night parity check reads Scum.",
    actions: [action("Mark", "Frame", { priority: 40 })] }),
  role("mafia_janitor", { name: "Janitor", alignment: "mafia",
    summary: "Each night, may kill one player and keep their role hidden on the flip.",
    actions: [action("Kill", "Clean kill", { priority: 30 })],
    traits: [{ text: "Their victim flips with no role shown", short: "Hides flips" }] }),
  role("serial_killer", { name: "Serial Killer", alignment: "independent",
    summary: "Kills one player each night, alone and outside any faction.",
    actions: [action("Kill", "Kill", { priority: 30 })] }),
]);

const BY_KEY = new Map(ROLE_CATALOG.map((entry) => [entry.key, entry]));

export function findRole(key) {
  return BY_KEY.get(String(key ?? "")) ?? null;
}
