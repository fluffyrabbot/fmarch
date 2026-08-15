const RAILWAY_INTERNAL_API_URL = "http://fmarch.railway.internal:8080";

function configuredValue(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  return value.trim();
}

function validatedInternalBaseUrl(value, env) {
  if (typeof value !== "string" || value.trim() === "") return null;
  if (value === RAILWAY_INTERNAL_API_URL) return RAILWAY_INTERNAL_API_URL;

  // Local proof servers bind an ephemeral loopback port while preserving the
  // same SSR/browser authority split as Railway. This exception is both
  // loopback-only and unavailable to production builds.
  const localProof = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/u.exec(value);
  if (
    env?.NODE_ENV !== "production" &&
    localProof !== null &&
    Number(localProof[1]) <= 65_535
  ) {
    return value;
  }
  throw new Error(
    `FMARCH_API_INTERNAL_URL must be exactly ${RAILWAY_INTERNAL_API_URL}`,
  );
}

function validatedPublicBaseUrl(value, env) {
  const configured = configuredValue(value);
  if (configured === null) return null;
  let url;
  try {
    url = new URL(configured);
  } catch {
    throw new Error("FMARCH_API_BASE_URL must be an absolute HTTP(S) origin");
  }
  const httpAllowed = url.protocol === "http:" && env?.NODE_ENV !== "production";
  if (
    (url.protocol !== "https:" && !httpAllowed) ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(
      "FMARCH_API_BASE_URL must be an HTTPS origin without credentials, path, query, or fragment",
    );
  }
  return url.origin;
}

/**
 * Base URL for server-to-server API fetches. Prefers the private-network
 * endpoint (FMARCH_API_INTERNAL_URL) so SSR traffic skips the public edge;
 * falls back to the public base URL when no internal endpoint is configured.
 */
export function serverApiBaseUrl(env = globalThis.process?.env) {
  return (
    validatedInternalBaseUrl(env?.FMARCH_API_INTERNAL_URL, env) ??
    validatedPublicBaseUrl(env?.FMARCH_API_BASE_URL, env) ??
    ""
  );
}

/**
 * Base URL for URLs handed to the browser (live projection websockets).
 * Always the public endpoint; the private-network domain is unreachable
 * from outside the deployment.
 */
export function publicApiBaseUrl(env = globalThis.process?.env) {
  return validatedPublicBaseUrl(env?.FMARCH_API_BASE_URL, env) ?? "";
}
