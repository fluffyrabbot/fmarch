import path from "node:path";

export const devTestGameReadinessFreshnessScopeEnvVar =
  "FMARCH_DEV_TEST_GAME_READINESS_FRESHNESS_SCOPE";

export function readinessFreshnessScopeEnv(changedInputs, { root = process.cwd() } = {}) {
  if (
    !Array.isArray(changedInputs) ||
    changedInputs.length === 0 ||
    changedInputs.some((input) => typeof input !== "string" || input.trim() === "")
  ) {
    throw new Error("readiness freshness scope requires changed inputs");
  }
  return {
    [devTestGameReadinessFreshnessScopeEnvVar]: JSON.stringify(
      changedInputs.map((input) => normalizeReadinessFreshnessPath(input, { root })),
    ),
  };
}

export function parseReadinessFreshnessScope(value, { root = process.cwd() } = {}) {
  if (value === undefined || value.trim() === "") {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(
      `${devTestGameReadinessFreshnessScopeEnvVar} must be a JSON array of artifact paths`,
    );
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    parsed.some((input) => typeof input !== "string" || input.trim() === "")
  ) {
    throw new Error(
      `${devTestGameReadinessFreshnessScopeEnvVar} must be a non-empty JSON array of artifact paths`,
    );
  }
  return new Set(
    parsed.map((input) => normalizeReadinessFreshnessPath(input, { root })),
  );
}

export function normalizeReadinessFreshnessPath(value, { root = process.cwd() } = {}) {
  return path.relative(root, path.resolve(root, value));
}
