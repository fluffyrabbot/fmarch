export const COMMAND_RECOVERY_STORAGE_VERSION = 2;
export const COMMAND_RECOVERY_STORAGE_PREFIX = "fmarch:command-recovery:v2:";
export const COMMAND_RECOVERY_SURFACES = Object.freeze(["player", "moderator"]);

export function commandRecoveryStorageKey({ game, surface }) {
  return `${COMMAND_RECOVERY_STORAGE_PREFIX}${requiredSurface(surface)}:${requiredString(game, "game")}`;
}

export function commandRecoveryStorageAvailable(storage) {
  if (!isStorage(storage)) return false;
  try {
    storage.getItem(`${COMMAND_RECOVERY_STORAGE_PREFIX}availability-probe`);
    return true;
  } catch {
    return false;
  }
}

export function resolveCommandRecoveryStorage(windowRef = globalThis.window) {
  let storage;
  try {
    storage = windowRef?.sessionStorage;
  } catch {
    return null;
  }
  return commandRecoveryStorageAvailable(storage) ? storage : null;
}

export function persistInterruptedCommandAttempts({
  storage,
  game,
  surface,
  authority,
  attempts,
}) {
  if (!isStorage(storage)) {
    return false;
  }
  const key = commandRecoveryStorageKey({ game, surface });
  const normalizedAuthority = requiredString(authority, "authority");
  try {
    const normalized = normalizeAttempts(attempts);
    if (Object.keys(normalized).length === 0) {
      storage.removeItem(key);
      return true;
    }
    const serialized = JSON.stringify({
      v: COMMAND_RECOVERY_STORAGE_VERSION,
      game: requiredString(game, "game"),
      surface: requiredSurface(surface),
      authority: normalizedAuthority,
      attempts: normalized,
    });
    storage.setItem(key, serialized);
    return true;
  } catch {
    return false;
  }
}

export function readInterruptedCommandAttempts({ storage, game, surface, authority }) {
  if (!isStorage(storage)) {
    return Object.freeze({});
  }
  const key = commandRecoveryStorageKey({ game, surface });
  const normalizedAuthority = requiredString(authority, "authority");
  let raw;
  try {
    raw = storage.getItem(key);
  } catch {
    return Object.freeze({});
  }
  if (typeof raw !== "string" || raw.trim() === "") {
    return Object.freeze({});
  }
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed?.v !== COMMAND_RECOVERY_STORAGE_VERSION ||
      parsed?.game !== game ||
      parsed?.surface !== surface ||
      parsed?.authority !== normalizedAuthority
    ) {
      bestEffortRemove(storage, key);
      return Object.freeze({});
    }
    return normalizeAttempts(parsed.attempts);
  } catch {
    bestEffortRemove(storage, key);
    return Object.freeze({});
  }
}

export function clearInterruptedCommandAttempts({ storage, game, surface }) {
  if (!isStorage(storage)) {
    return false;
  }
  return bestEffortRemove(
    storage,
    commandRecoveryStorageKey({ game, surface }),
  );
}

function normalizeAttempts(attempts) {
  if (attempts === null || typeof attempts !== "object" || Array.isArray(attempts)) {
    return Object.freeze({});
  }
  const next = {};
  for (const [actionId, attempt] of Object.entries(attempts)) {
    const normalized = normalizeAttempt(actionId, attempt);
    if (normalized !== null) {
      next[actionId] = normalized;
    }
  }
  return Object.freeze(next);
}

function normalizeAttempt(actionId, attempt) {
  if (attempt === null || typeof attempt !== "object" || Array.isArray(attempt)) {
    return null;
  }
  const commandId = attempt.commandId;
  if (typeof commandId !== "string" || commandId.trim() === "") {
    return null;
  }
  const interruption = COMMAND_INTERRUPTIONS.includes(attempt.interruption)
    ? attempt.interruption
    : "connection_lost";
  const command = isRecord(attempt.command) ? freezeJson(attempt.command) : null;
  if (command === null) {
    return null;
  }
  return Object.freeze({
    commandId,
    actionId: requiredString(attempt.actionId ?? attempt.action ?? actionId, "actionId"),
    action: requiredString(attempt.action ?? attempt.actionId ?? actionId, "action"),
    interruption,
    command,
    ...(typeof attempt.composerBody === "string"
      ? { composerBody: attempt.composerBody }
      : {}),
    ...(Array.isArray(attempt.media) ? { media: Object.freeze([...attempt.media]) } : {}),
    ...(Array.isArray(attempt.quotations)
      ? { quotations: Object.freeze([...attempt.quotations]) }
      : {}),
    ...(typeof attempt.embedUrl === "string" ? { embedUrl: attempt.embedUrl } : {}),
    ...(attempt.event !== undefined && attempt.event !== null
      ? { event: freezeJson(attempt.event) }
      : {}),
  });
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function freezeJson(value) {
  return Object.freeze(JSON.parse(JSON.stringify(value)));
}

function isStorage(storage) {
  try {
    return (
      storage !== undefined &&
      storage !== null &&
      typeof storage.getItem === "function" &&
      typeof storage.setItem === "function" &&
      typeof storage.removeItem === "function"
    );
  } catch {
    return false;
  }
}

function bestEffortRemove(storage, key) {
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function requiredSurface(value) {
  const surface = requiredString(value, "surface");
  if (!COMMAND_RECOVERY_SURFACES.includes(surface)) {
    throw new TypeError(`unsupported command recovery surface: ${surface}`);
  }
  return surface;
}

function requiredString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value;
}

const COMMAND_INTERRUPTIONS = Object.freeze(["timeout", "connection_lost"]);
