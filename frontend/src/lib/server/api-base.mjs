const INTERNAL_URL_RULE =
  "http://<RFC 1918 IPv4>[:port] with no credentials, path, query, or fragment";

function configuredValue(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  return value.trim();
}

function canonicalOctets(host) {
  const octets = host.split(".");
  if (octets.length !== 4) return null;
  const numbers = octets.map((octet) =>
    /^(?:0|[1-9][0-9]{0,2})$/u.test(octet) ? Number(octet) : Number.NaN,
  );
  return numbers.every((number) => number <= 255) ? numbers : null;
}

function isPrivateIpv4([first, second]) {
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

/**
 * The private load balancer (RFC D15) is addressed by its private IPv4, so
 * server-side calls never leave the private network. Anything that could
 * route a credential-bearing request elsewhere is rejected.
 */
function validatedInternalBaseUrl(value, env) {
  if (typeof value !== "string" || value.trim() === "") return null;
  const match = /^http:\/\/([0-9.]+)(?::([1-9][0-9]{0,4}))?$/u.exec(value);
  const octets = match === null ? null : canonicalOctets(match[1]);
  const portValid = match?.[2] === undefined || Number(match[2]) <= 65_535;
  if (octets !== null && portValid) {
    if (isPrivateIpv4(octets)) return value;
    // Local proof servers bind an ephemeral loopback port while preserving the
    // same SSR/browser authority split. This exception is loopback-only,
    // needs an explicit port, and is unavailable to production builds.
    const loopback = octets.join(".") === "127.0.0.1" && match[2] !== undefined;
    if (loopback && env?.NODE_ENV !== "production") return value;
  }
  throw new Error(`FMARCH_API_INTERNAL_URL must be ${INTERNAL_URL_RULE}`);
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
 * Base URL for server-to-server API fetches. Prefers the private load
 * balancer (FMARCH_API_INTERNAL_URL) so SSR traffic skips the public edge;
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
 * Always the public endpoint; the private load balancer is unreachable
 * from outside the deployment.
 */
export function publicApiBaseUrl(env = globalThis.process?.env) {
  return validatedPublicBaseUrl(env?.FMARCH_API_BASE_URL, env) ?? "";
}
