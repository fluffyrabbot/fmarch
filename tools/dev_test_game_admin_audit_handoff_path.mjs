export function buildAdminAuditHandoffPath({
  upstreamAuditId,
  upstreamLabel = "Ranked next action",
  localCapabilityAuditId,
  downstreamStatus,
  downstreamCommand,
  downstreamProofTarget,
}) {
  return Object.freeze({
    upstreamAuditId: String(upstreamAuditId ?? ""),
    upstreamLabel: String(upstreamLabel ?? ""),
    localCapabilityAuditId: String(localCapabilityAuditId ?? ""),
    downstreamStatus: String(downstreamStatus ?? ""),
    downstreamCommand: String(downstreamCommand ?? ""),
    downstreamProofTarget: String(downstreamProofTarget ?? ""),
  });
}

export function assertAdminRoleSurfaceHandoffPath({
  adminRoleSurface,
  expected,
  proofName,
}) {
  if (expected === null || expected === undefined) {
    return;
  }
  const visibleHandoffPath = adminRoleSurface?.visibleHandoffPath;
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (visibleHandoffPath?.[key] !== String(expectedValue)) {
      throw new Error(`${proofName} missing handoff path: ${key}`);
    }
  }
}
