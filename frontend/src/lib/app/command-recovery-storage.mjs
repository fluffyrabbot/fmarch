export const COMMAND_RECOVERY_STORAGE_VERSION = 1;
export const COMMAND_RECOVERY_STORAGE_PREFIX = "fmarch:command-recovery:v1:";
export const COMMAND_RECOVERY_SURFACES = Object.freeze(["player", "moderator"]);

export function commandRecoveryStorageKey({ game, surface }) {
  return `${COMMAND_RECOVERY_STORAGE_PREFIX}${requiredSurface(surface)}:${requiredString(game, "game")}`;
}

export function persistInterruptedCommandAttempts({
  storage,
  game,
  surface,
  attempts,
}) {
  if (!isStorage(storage)) {
    return false;
  }
  const key = commandRecoveryStorageKey({ game, surface });
  const normalized = normalizeAttempts(attempts);
  if (Object.keys(normalized).length === 0) {
    storage.removeItem(key);
    return true;
  }
  storage.setItem(
    key,
    JSON.stringify({
      v: COMMAND_RECOVERY_STORAGE_VERSION,
      game: requiredString(game, "game"),
      surface: requiredSurface(surface),
      attempts: normalized,
    }),
  );
  return true;
}

export function readInterruptedCommandAttempts({ storage, game, surface }) {
  if (!isStorage(storage)) {
    return Object.freeze({});
  }
  const key = commandRecoveryStorageKey({ game, surface });
  const raw = storage.getItem(key);
  if (typeof raw !== "string" || raw.trim() === "") {
    return Object.freeze({});
  }
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed?.v !== COMMAND_RECOVERY_STORAGE_VERSION ||
      parsed?.game !== game ||
      parsed?.surface !== surface
    ) {
      storage.removeItem(key);
      return Object.freeze({});
    }
    return normalizeAttempts(parsed.attempts);
  } catch {
    storage.removeItem(key);
    return Object.freeze({});
  }
}

export function clearInterruptedCommandAttempts({ storage, game, surface }) {
  if (!isStorage(storage)) {
    return false;
  }
  storage.removeItem(commandRecoveryStorageKey({ game, surface }));
  return true;
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
  return Object.freeze({
    commandId,
    actionId: requiredString(attempt.actionId ?? attempt.action ?? actionId, "actionId"),
    action: requiredString(attempt.action ?? attempt.actionId ?? actionId, "action"),
    interruption,
    ...(typeof attempt.composerBody === "string"
      ? { composerBody: attempt.composerBody }
      : {}),
    ...(Array.isArray(attempt.media) ? { media: Object.freeze([...attempt.media]) } : {}),
    ...(Array.isArray(attempt.quotations)
      ? { quotations: Object.freeze([...attempt.quotations]) }
      : {}),
    ...(attempt.event !== undefined && attempt.event !== null
      ? { event: freezeJson(attempt.event) }
      : {}),
  });
}

function freezeJson(value) {
  return Object.freeze(JSON.parse(JSON.stringify(value)));
}

function isStorage(storage) {
  return (
    storage !== undefined &&
    storage !== null &&
    typeof storage.getItem === "function" &&
    typeof storage.setItem === "function" &&
    typeof storage.removeItem === "function"
  );
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
