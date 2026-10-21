// Normalizes the wire role reference (RFC 0009) into the entries role cards
// render. The server owns every label: this module only checks shape and
// freezes. An invalid document is null, never a partial or invented role.

const FAMILIES = Object.freeze(["town", "mafia", "independent"]);

export const UNALIGNED = Object.freeze({
  id: "independent",
  key: null,
  label: "Unaligned",
  win: "",
  unaligned: true,
});

const isText = (value) => typeof value === "string" && value.trim() !== "";
const isTextList = (value) => Array.isArray(value) && value.every((item) => typeof item === "string");

export function normalizePackSummary(value) {
  if (!isText(value?.key) || !isText(value?.name) || !Number.isInteger(value?.role_count)) return null;
  return Object.freeze({ key: value.key, name: value.name, roleCount: value.role_count });
}

export function normalizePackCatalog(value) {
  if (!Array.isArray(value?.packs)) return null;
  const packs = value.packs.map(normalizePackSummary);
  return packs.every(Boolean) ? Object.freeze(packs) : null;
}

export function normalizeAlignment(value) {
  if (!isText(value?.key) || !isText(value?.label) || !FAMILIES.includes(value?.family) || typeof value?.win !== "string") {
    return null;
  }
  return Object.freeze({ id: value.family, key: value.key, label: value.label, win: value.win, unaligned: false });
}

function normalizeAction(value) {
  const targets = value?.targets;
  if (
    !isText(value?.id) || !isText(value?.label) || !isTextList(value?.abilities) || value.abilities.length === 0 ||
    !isText(value?.window) || !isText(targets?.label) || typeof value?.roleblockable !== "boolean" ||
    !Number.isInteger(value?.priority) || !(value?.uses === null || Number.isInteger(value?.uses)) || !isTextList(value?.notes)
  ) {
    return null;
  }
  return Object.freeze({
    id: value.id,
    kind: value.abilities[0],
    label: value.label,
    window: value.window,
    targets: targets.label.charAt(0).toLowerCase() + targets.label.slice(1),
    selfOnly: targets.self_only === true,
    roleblockable: value.roleblockable,
    priority: value.priority,
    uses: value.uses,
    notes: Object.freeze([...value.notes]),
  });
}

function normalizeTrait(value) {
  return isText(value?.text) && isText(value?.short) ? Object.freeze({ text: value.text, short: value.short }) : null;
}

/** One wire `RoleReference` → a frozen role-card entry, or null. */
export function normalizeRoleReference(value) {
  if (!isText(value?.key) || !isText(value?.name) || !isText(value?.summary) || !isText(value?.pack_name)) return null;
  const alignment = value.alignment === null ? UNALIGNED : normalizeAlignment(value.alignment);
  const actions = Array.isArray(value.actions) ? value.actions.map(normalizeAction) : [null];
  const traits = Array.isArray(value.traits) ? value.traits.map(normalizeTrait) : [null];
  const channels = Array.isArray(value.channels) ? value.channels : [null];
  if (alignment === null || !actions.every(Boolean) || !traits.every(Boolean) || !channels.every((channel) => isText(channel?.label))) {
    return null;
  }
  return Object.freeze({
    key: value.key,
    packKey: value.pack_key,
    packName: value.pack_name,
    name: value.name,
    summary: value.summary,
    alignment,
    win: typeof value.win === "string" && value.win !== "" ? value.win : alignment.win,
    actions: Object.freeze(actions),
    traits: Object.freeze(traits),
    channels: Object.freeze(channels.map((channel) => channel.label)),
  });
}

/** One wire `PackRoleReference` → `{ pack, alignments, roles }`, or null. */
export function normalizePackRoleReference(value) {
  const pack = normalizePackSummary(value?.pack);
  if (pack === null || !Array.isArray(value?.alignments) || !Array.isArray(value?.roles)) return null;
  const alignments = value.alignments.map(normalizeAlignment);
  const roles = value.roles.map(normalizeRoleReference);
  if (!alignments.every(Boolean) || !roles.every(Boolean)) return null;
  return Object.freeze({ pack, alignments: Object.freeze(alignments), roles: Object.freeze(roles) });
}
