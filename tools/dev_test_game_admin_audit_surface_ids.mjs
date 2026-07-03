export const localAdminAuditIds = Object.freeze({
  coreLoop: "local-core-loop",
  hardening: "local-hardening",
  identityAdapter: "local-identity-adapter",
  hostedIdentityEvidence: "local-hosted-identity-evidence",
  backupRestore: "local-backup-restore",
  opsArtifacts: "local-ops-artifacts",
  seedFixtures: "local-seed-fixtures",
  releaseReadiness: "local-release-readiness",
  releaseRunbook: "local-release-runbook",
  raceCoverage: "local-race-coverage",
  hostedTargetPreflight: "local-hosted-target-preflight",
  hostedEvidenceLane: "local-hosted-evidence-lane",
  hostedConcurrentRaceMatrix: "local-hosted-concurrent-race-matrix",
  hostedOpsSignals: "local-hosted-ops-signals",
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
