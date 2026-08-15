const WORKOS_LOGOUT_ORIGIN = "https://api.workos.com";
const WORKOS_LOGOUT_PATH = "/user_management/sessions/logout";
const WORKOS_SESSION_ID = /^session_[A-Za-z0-9_-]{1,255}$/u;

/**
 * Accept only the backend-minted WorkOS session logout URL. In particular,
 * callers cannot add a return_to destination or any other provider parameter.
 */
export function workosProviderLogoutUrl(value) {
  if (typeof value !== "string" || value === "") return null;

  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  const sessionIds = url.searchParams.getAll("session_id");
  if (
    url.origin !== WORKOS_LOGOUT_ORIGIN ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== WORKOS_LOGOUT_PATH ||
    url.hash !== "" ||
    sessionIds.length !== 1 ||
    !WORKOS_SESSION_ID.test(sessionIds[0]) ||
    [...url.searchParams.keys()].length !== 1
  ) {
    return null;
  }

  const canonical = `${WORKOS_LOGOUT_ORIGIN}${WORKOS_LOGOUT_PATH}?session_id=${sessionIds[0]}`;
  return value === canonical ? canonical : null;
}
