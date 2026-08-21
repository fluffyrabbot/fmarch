/**
 * Community authors are public profile identities. They are deliberately not
 * principals: an unavailable or redacted profile becomes an archived author,
 * never a fallback to an internal account identifier.
 */
export function buildCommunityAuthorView(author) {
  const handle = text(author?.handle);
  const displayName = text(author?.displayName, author?.display_name);
  if (handle === null || displayName === null) {
    return ARCHIVED_COMMUNITY_AUTHOR;
  }

  return Object.freeze({
    kind: "profile",
    handle,
    displayName,
    label: displayName,
    href: `/u/${encodeURIComponent(handle)}`,
  });
}

export const ARCHIVED_COMMUNITY_AUTHOR = Object.freeze({
  kind: "archived",
  label: "Archived member",
  handle: null,
  displayName: null,
  href: null,
});

function text(...values) {
  return values.find((value) => typeof value === "string" && value.trim() !== "")?.trim() ?? null;
}
