const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const FINGERPRINT_PATTERN = /^[0-9a-f]{12}$/u;

export function buildCommunityStewardshipView(snapshot) {
  const memberships = Array.isArray(snapshot?.memberships)
    ? snapshot.memberships.map(membershipView).filter(Boolean)
    : [];
  const pendingInvitations = Array.isArray(snapshot?.pending_invitations)
    ? snapshot.pending_invitations.map(invitationView).filter(Boolean)
    : [];
  const quota = snapshot?.invitation_quota ?? {};
  return Object.freeze({
    metrics: Object.freeze({
      active: count(snapshot?.metrics?.active_memberships),
      suspended: count(snapshot?.metrics?.suspended_memberships),
      pending: count(snapshot?.metrics?.pending_invitations),
      acceptedThisWeek: count(snapshot?.metrics?.invitations_accepted_last_7_days),
      revokedThisWeek: count(snapshot?.metrics?.invitations_revoked_last_7_days),
    }),
    memberships: Object.freeze(memberships),
    pendingInvitations: Object.freeze(pendingInvitations),
    quotaLabel: `${count(quota.max_open_per_sponsor)} open · ${count(quota.max_issued_per_rolling_7_days)} / 7 days`,
    empty: memberships.length === 0,
  });
}

function membershipView(value) {
  if (!UUID_PATTERN.test(value?.membership_id ?? "")) return null;
  const depth = Math.max(0, count(value?.depth));
  const status = ["active", "suspended", "withdrawn", "redacted"].includes(value?.status)
    ? value.status
    : "unknown";
  return Object.freeze({
    id: value.membership_id,
    shortId: value.membership_id.slice(0, 8),
    sponsorId: UUID_PATTERN.test(value?.sponsoring_membership_id ?? "")
      ? value.sponsoring_membership_id
      : null,
    depth,
    depthClass: `member--depth-${Math.min(depth, 6)}`,
    status,
    canSuspend: status === "active",
    canRestore: status === "suspended",
    openInvitations: count(value?.open_invitation_count),
    recentInvitations: count(value?.invitations_issued_last_7_days),
    quotaState: ["normal", "near_limit", "blocked"].includes(value?.quota_state)
      ? value.quota_state
      : "normal",
  });
}

function invitationView(value) {
  if (!UUID_PATTERN.test(value?.invitation_id ?? "")) return null;
  if (!UUID_PATTERN.test(value?.sponsoring_membership_id ?? "")) return null;
  if (!FINGERPRINT_PATTERN.test(value?.target_fingerprint ?? "")) return null;
  return Object.freeze({
    id: value.invitation_id,
    shortId: value.invitation_id.slice(0, 8),
    sponsorId: value.sponsoring_membership_id,
    targetFingerprint: value.target_fingerprint,
    deliveryStatus: text(value?.delivery_status, "not queued"),
    providerId: text(value?.delivery_provider_id, "none"),
    expiresAt: count(value?.expires_at),
  });
}

function count(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function text(value, fallback) {
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}
