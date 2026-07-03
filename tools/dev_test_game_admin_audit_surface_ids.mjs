export const localAdminAuditIds = Object.freeze({
  adminSpine: "local-admin-spine",
  spineManifest: "local-spine-manifest",
  proofGraph: "local-proof-graph",
  proofFreshness: "local-proof-freshness",
  nextAction: "local-next-action",
});

export const localAdminAuditHandoffCheckIds = Object.freeze({
  proofFreshness: "proof-freshness-handoff",
  nextAction: "next-action-handoff",
  spineManifest: "spine-manifest-handoff",
});

export function localAdminAuditRoleUrl(
  auditId,
  { game = "<seeded-game>" } = {},
) {
  return `/admin/audit/${auditId}?game=${String(game)}`;
}
