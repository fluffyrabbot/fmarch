import { SESSION_COOKIE_NAME } from "./session-capabilities.mjs";

export function upstreamRouteFailure(failure, { resource = "Upstream data" } = {}) {
  const kind = failure?.kind;
  switch (kind) {
    case "unauthorized":
    case "unauthenticated":
      return Object.freeze({
        status: 401,
        message: `${resource} requires a current authenticated session.`,
        clearSession: true,
      });
    case "forbidden":
      return Object.freeze({
        status: 403,
        message: `${resource} is forbidden for this session.`,
        clearSession: false,
      });
    case "not_found":
      return Object.freeze({
        status: 404,
        message: `${resource} was not found.`,
        clearSession: false,
      });
    case "invalid_response":
      return Object.freeze({
        status: 502,
        message: `${resource} returned an invalid response.`,
        clearSession: false,
      });
    case "rate_limited":
    case "unavailable":
      return Object.freeze({
        status: 503,
        message: `${resource} is temporarily unavailable.`,
        clearSession: false,
      });
    default:
      return Object.freeze({
        status: 502,
        message: `${resource} could not be loaded safely.`,
        clearSession: false,
      });
  }
}

export function applyUpstreamSessionInvalidation(cookies, routeFailure) {
  if (routeFailure?.clearSession === true) {
    cookies?.delete?.(SESSION_COOKIE_NAME, { path: "/" });
  }
}
