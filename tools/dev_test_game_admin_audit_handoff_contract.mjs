export function requiredRelatedDestinationsForHandoff(handoff) {
  return handoff === null || handoff === undefined
    ? []
    : [
        {
          linkId: handoff.linkId,
          auditId: handoff.auditId,
          requiredChecks: handoff.requiredCheckIds ?? [],
          requiredCheckStatuses: handoff.requiredCheckStatuses ?? {},
          requiredScenarios: handoff.requiredScenarioIds ?? [],
          requiredSessions: handoff.requiredSessionIds ?? [],
          requiredUnproven: handoff.requiredUnprovenIds ?? [],
          requiredRelatedLinks: handoff.requiredRelatedLinkIds ?? [],
        },
      ];
}

export function requiredRelatedDestinationsForHandoffs(handoffs) {
  return Array.isArray(handoffs)
    ? handoffs.flatMap((handoff) => requiredRelatedDestinationsForHandoff(handoff))
    : [];
}

export function assertAdminAuditRelatedHandoff({
  adminRoleSurface,
  handoff,
  proofName,
}) {
  if (handoff === null || handoff === undefined) {
    return;
  }
  const name = proofNameForMessage(proofName);
  const linkId = String(handoff.linkId ?? "");
  const auditId = String(handoff.auditId ?? "");
  if (linkId === "" || auditId === "") {
    throw new Error(`${name} has a malformed related handoff`);
  }
  if (!adminRoleSurface?.visibleRelatedLinks?.includes(linkId)) {
    throw new Error(`${name} missing related handoff link: ${linkId}`);
  }
  const destination =
    adminRoleSurface?.visibleRelatedDestinations?.find(
      (item) => item.linkId === linkId && item.auditId === auditId,
    ) ?? null;
  if (destination === null) {
    throw new Error(`${name} did not follow related handoff: ${linkId}`);
  }
  const expectedRoleUrl = `/admin/audit/${auditId}?game=<seeded-game>`;
  if (destination.detailRoleUrl !== expectedRoleUrl) {
    throw new Error(`${name} followed related handoff to the wrong role URL`);
  }
  for (const checkId of handoff.requiredCheckIds ?? []) {
    if (!destination.visibleChecks?.includes(checkId)) {
      throw new Error(`${name} handoff destination missing visible check: ${checkId}`);
    }
  }
  for (const unprovenId of handoff.requiredUnprovenIds ?? []) {
    if (!destination.visibleUnproven?.includes(unprovenId)) {
      throw new Error(
        `${name} handoff destination missing unproven row: ${unprovenId}`,
      );
    }
  }
  for (const scenarioId of handoff.requiredScenarioIds ?? []) {
    if (!destination.visibleScenarios?.includes(scenarioId)) {
      throw new Error(
        `${name} handoff destination missing scenario row: ${scenarioId}`,
      );
    }
  }
  for (const sessionId of handoff.requiredSessionIds ?? []) {
    if (!destination.visibleSessions?.includes(sessionId)) {
      throw new Error(
        `${name} handoff destination missing session row: ${sessionId}`,
      );
    }
  }
  for (const relatedLinkId of handoff.requiredRelatedLinkIds ?? []) {
    if (!destination.visibleRelatedLinks?.includes(relatedLinkId)) {
      throw new Error(
        `${name} handoff destination missing related link: ${relatedLinkId}`,
      );
    }
  }
}

export function assertAdminAuditRelatedHandoffs({
  adminRoleSurface,
  handoffs,
  proofName,
}) {
  for (const handoff of handoffs ?? []) {
    assertAdminAuditRelatedHandoff({
      adminRoleSurface,
      handoff,
      proofName,
    });
  }
}

function proofNameForMessage(proofName) {
  return typeof proofName === "string" && proofName.trim() !== ""
    ? proofName
    : "admin proof";
}
