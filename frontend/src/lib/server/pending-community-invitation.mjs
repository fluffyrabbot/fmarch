export const PENDING_COMMUNITY_INVITATION_COOKIE =
  "fmarch_pending_community_invitation";

export function pendingCommunityInvitation(cookies) {
  return optionalCredential(cookies.get(PENDING_COMMUNITY_INVITATION_COOKIE));
}

export function storePendingCommunityInvitation(cookies, credential, url) {
  const normalized = optionalCredential(credential);
  if (normalized === null) return false;
  cookies.set(PENDING_COMMUNITY_INVITATION_COOKIE, normalized, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: url.protocol === "https:",
    maxAge: 600,
  });
  return true;
}

export function clearPendingCommunityInvitation(cookies) {
  cookies.delete(PENDING_COMMUNITY_INVITATION_COOKIE, { path: "/" });
}

function optionalCredential(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}
