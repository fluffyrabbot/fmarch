const CAPABILITY_LABELS = Object.freeze({
  GlobalAdmin: "Site administrator",
  GlobalMod: "Community moderator",
});

export function humanizePrincipal(value) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return "Signed out";
  }
  const principal = String(value).trim();
  return principal.startsWith("@") ? principal : `@${principal}`;
}

export function humanizeCapabilityLabel(value) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return "Standard access";
  }

  return String(value)
    .split(/\s+or\s+/)
    .map((part) => humanizeSingleCapability(part.trim()))
    .join(" or ");
}

export function sessionContextLabel({ game = null, capabilities = [] } = {}) {
  const gameLabel = game === null || game === undefined ? null : String(game);
  const scopedCapabilities = (Array.isArray(capabilities) ? capabilities : []).filter(
    (capability) =>
      capability?.game === undefined ||
      capability?.game === null ||
      gameLabel === null ||
      String(capability.game) === gameLabel,
  );
  const kinds = new Set(
    scopedCapabilities
      .map((capability) => capability?.kind)
      .filter((kind) => typeof kind === "string"),
  );

  if (kinds.has("GlobalAdmin")) {
    return "Site admin";
  }
  if (kinds.has("GlobalMod")) {
    return "Community moderator";
  }
  if (kinds.has("HostOf") || kinds.has("CohostOf")) {
    return gameLabel === null ? "Game host" : `Hosting ${gameLabel}`;
  }
  if (kinds.has("SlotOccupant") || kinds.has("PendingReplacement")) {
    return gameLabel === null ? "Player" : `Playing ${gameLabel}`;
  }
  if (kinds.has("SpectatorOf") || kinds.has("DeadViewer")) {
    return gameLabel === null ? "Spectator" : `Watching ${gameLabel}`;
  }
  return gameLabel === null ? "Account" : gameLabel;
}

export function principalInitials(value) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return "?";
  }
  const parts = String(value)
    .replace(/^@/, "")
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean);
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts.map((part) => part[0]).join(""))
    .slice(0, 2)
    .toUpperCase();
}

function humanizeSingleCapability(value) {
  if (CAPABILITY_LABELS[value]) {
    return CAPABILITY_LABELS[value];
  }

  const match = value.match(/^([A-Za-z]+)\((.*)\)$/);
  if (match === null) {
    return value
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/_/g, " ")
      .toLowerCase();
  }

  const [, kind, rawScope] = match;
  const scope = rawScope.replace(/^slot[-_]?/i, "slot ").replace(/_/g, " ");
  switch (kind) {
    case "GlobalAdmin":
      return "Site administrator";
    case "GlobalMod":
      return "Community moderator";
    case "HostOf":
      return `Hosting ${scope}`;
    case "CohostOf":
      return `Co-hosting ${scope}`;
    case "SlotOccupant":
      return rawScope.startsWith("slot") ? `Playing as ${scope}` : `Playing ${scope}`;
    case "PendingReplacement":
      return `Joining ${scope}`;
    case "SpectatorOf":
      return `Watching ${scope}`;
    case "DeadViewer":
      return `Viewing ${scope}`;
    case "ChannelMember":
      return "Private channel access";
    default:
      return kind.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  }
}
