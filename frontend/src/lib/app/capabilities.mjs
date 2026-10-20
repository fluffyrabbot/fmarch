export const ROLE_SURFACES = Object.freeze({
  admin: Object.freeze({
    id: "admin",
    label: "Admin",
    capabilityKinds: Object.freeze(["GlobalAdmin", "GlobalMod"]),
  }),
  player: Object.freeze({
    id: "player",
    label: "Player",
    capabilityKinds: Object.freeze([
      "SlotOccupant",
      "ChannelMember",
      "DeadViewer",
      "SpectatorOf",
    ]),
  }),
  moderator: Object.freeze({
    id: "moderator",
    label: "Moderator",
    capabilityKinds: Object.freeze(["GlobalAdmin", "GlobalMod", "HostOf", "CohostOf"]),
  }),
});

export function normalizeCapability(capability) {
  if (capability === null || typeof capability !== "object") {
    return null;
  }

  const kind = firstString(capability.kind);
  if (kind === null) {
    return null;
  }

  const body = capability.body ?? {};
  const normalized = {
    kind,
    game: firstString(capability.game, body.game),
    slot: firstString(capability.slot, body.slot),
    channel: firstString(capability.channel, body.channel),
    source: firstString(capability.source) ?? "session",
  };

  switch (kind) {
    case "GlobalAdmin":
    case "GlobalMod":
      return freezeWithoutNulls(normalized);
    case "HostOf":
    case "CohostOf":
      return normalized.game === null ? null : freezeWithoutNulls(normalized);
    case "SlotOccupant":
      if (normalized.game === null || normalized.slot === null) {
        return null;
      }
      return freezeWithoutNulls(normalized);
    case "ChannelMember":
      if (normalized.game === null || normalized.channel === null) {
        return null;
      }
      return freezeWithoutNulls(normalized);
    case "DeadViewer":
    case "SpectatorOf":
      return normalized.game === null ? null : freezeWithoutNulls(normalized);
    default:
      return null;
  }
}

export function normalizeCapabilities(capabilities = []) {
  if (!Array.isArray(capabilities)) {
    return Object.freeze([]);
  }
  return Object.freeze(capabilities.map(normalizeCapability).filter(Boolean));
}

export function resolveSurfaceAccess({ surface, game = null, capabilities = [] }) {
  const normalized = normalizeCapabilities(capabilities);
  const definition = ROLE_SURFACES[surface];
  if (definition === undefined) {
    throw new TypeError(`unknown role surface: ${surface}`);
  }

  const capability = normalized.find(
    (candidate) =>
      definition.capabilityKinds.includes(candidate.kind) &&
      capabilityAppliesToGame(candidate, game),
  );

  return Object.freeze({
    surface,
    allowed: capability !== undefined,
    capability: capability ?? null,
    required: definition.capabilityKinds,
  });
}

// Proof evidence for a capability: its kind and the one scope it names (seat,
// channel or game). Surfaces put these on `data-capability-kind` and
// `data-capability-scope`; the capability never becomes display text.
export function capabilityEvidence(capability) {
  const normalized = normalizeCapability(capability) ?? pendingCapability(capability);
  if (normalized === null) {
    return Object.freeze({ kind: "", scope: "" });
  }
  return Object.freeze({
    kind: normalized.kind,
    scope: normalized.slot ?? normalized.channel ?? normalized.game ?? "",
  });
}

function pendingCapability(capability) {
  return capability?.kind === "PendingReplacement" && typeof capability.game === "string"
    ? Object.freeze({ kind: "PendingReplacement", game: capability.game })
    : null;
}

export function hasCapability({ capabilities = [], kind, game = null }) {
  return normalizeCapabilities(capabilities).some(
    (capability) =>
      capability.kind === kind && capabilityAppliesToGame(capability, game),
  );
}

function capabilityAppliesToGame(capability, game) {
  if (game === null || game === undefined) {
    return capability.kind === "GlobalAdmin" || capability.kind === "GlobalMod";
  }
  return (
    capability.game === game ||
    capability.kind === "GlobalAdmin" ||
    capability.kind === "GlobalMod"
  );
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") {
      return value;
    }
  }
  return null;
}

function freezeWithoutNulls(value) {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(value).filter(([, entryValue]) => entryValue !== null),
    ),
  );
}
