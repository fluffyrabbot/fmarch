const POLICY_ORIGIN = "https://fmarch.invalid";
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/u;
const AUTH_PATH = /^\/auth(?:\/|$)/iu;
const ENCODED_PATH_SEPARATOR = /%(?:2f|5c)/iu;

/**
 * Parse an untrusted browser return target as a same-origin absolute path.
 *
 * Auth routes are denied by default so an attacker cannot construct redirect
 * loops or bounce through a more permissive auth endpoint. The one exceptional
 * path used by the WorkOS linking ceremony must be opted into explicitly after
 * it has been recovered from the SDK-sealed callback state.
 */
export function sameOriginAuthPath(value, { allowAuthPath = null } = {}) {
  if (typeof value !== "string" || CONTROL_CHARACTER.test(value)) return null;

  const candidate = value.trim();
  if (
    candidate === "" ||
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\")
  ) {
    return null;
  }

  let url;
  let decoded;
  try {
    url = new URL(candidate, POLICY_ORIGIN);
    decoded = decodeURIComponent(candidate);
  } catch {
    return null;
  }

  if (
    url.origin !== POLICY_ORIGIN ||
    url.username !== "" ||
    url.password !== "" ||
    ENCODED_PATH_SEPARATOR.test(url.pathname) ||
    CONTROL_CHARACTER.test(decoded) ||
    decoded.includes("\\")
  ) {
    return null;
  }

  let decodedPathname;
  try {
    decodedPathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (
    !decodedPathname.startsWith("/") ||
    decodedPathname.startsWith("//") ||
    CONTROL_CHARACTER.test(decodedPathname) ||
    decodedPathname.includes("\\")
  ) {
    return null;
  }

  const normalizedPathname = decodedPathname.toLowerCase();
  const allowedAuthPath =
    typeof allowAuthPath === "string" ? allowAuthPath.toLowerCase() : null;
  if (AUTH_PATH.test(normalizedPathname) && normalizedPathname !== allowedAuthPath) {
    return null;
  }

  return `${url.pathname}${url.search}${url.hash}`;
}

export function authReturnPath(value) {
  return sameOriginAuthPath(value) ?? "/";
}
