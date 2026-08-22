/**
 * Presentation-only view of the authenticated viewer.
 *
 * A principal proves authority, but is not a public identity. Keep it out of
 * display models so a route cannot accidentally present an internal principal
 * as a profile handle. A profile summary is deliberately optional because
 * authentication does not require a social profile.
 */
export function buildViewerPresentation({ principalId = null, profile = null } = {}) {
  if (!hasText(principalId)) {
    return Object.freeze({
      state: "signed-out",
      kind: "anonymous",
      label: "Signed out",
      initials: "?",
      profile: null,
    });
  }

  const viewerProfile = normalizeViewerProfile(profile);
  if (viewerProfile !== null) {
    return Object.freeze({
      state: "signed-in",
      kind: "profile",
      label: viewerProfile.displayName,
      initials: initialsFor(viewerProfile.displayName),
      profile: viewerProfile,
    });
  }

  return Object.freeze({
    state: "signed-in",
    kind: "account",
    label: "Your account",
    initials: "YA",
    profile: null,
  });
}

export function normalizeViewerProfile(profile) {
  if (profile === null || typeof profile !== "object") {
    return null;
  }

  const handle = text(profile.handle);
  const displayName = text(profile.displayName, profile.display_name);
  if (handle === null || displayName === null) {
    return null;
  }

  return Object.freeze({
    handle,
    displayName,
    href: `/u/${encodeURIComponent(handle)}`,
  });
}

function initialsFor(label) {
  const parts = label.split(/[^a-zA-Z0-9]+/u).filter(Boolean);
  if (parts.length === 0) {
    return "?";
  }
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts.map((part) => part[0]).join(""))
    .slice(0, 2)
    .toUpperCase();
}

function hasText(value) {
  return text(value) !== null;
}

function text(...values) {
  return values.find((value) => typeof value === "string" && value.trim() !== "")?.trim() ?? null;
}
