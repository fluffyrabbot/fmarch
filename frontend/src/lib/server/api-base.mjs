const TRAILING_SLASHES = /\/+$/u;

function normalizedBaseUrl(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  return value.trim().replace(TRAILING_SLASHES, "");
}

/**
 * Base URL for server-to-server API fetches. Prefers the private-network
 * endpoint (FMARCH_API_INTERNAL_URL) so SSR traffic skips the public edge;
 * falls back to the public base URL when no internal endpoint is configured.
 */
export function serverApiBaseUrl(env = globalThis.process?.env) {
  return (
    normalizedBaseUrl(env?.FMARCH_API_INTERNAL_URL) ??
    normalizedBaseUrl(env?.FMARCH_API_BASE_URL) ??
    ""
  );
}

/**
 * Base URL for URLs handed to the browser (live projection websockets).
 * Always the public endpoint; the private-network domain is unreachable
 * from outside the deployment.
 */
export function publicApiBaseUrl(env = globalThis.process?.env) {
  return normalizedBaseUrl(env?.FMARCH_API_BASE_URL) ?? "";
}
