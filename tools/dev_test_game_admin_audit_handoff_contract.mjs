import {
  localAdminAuditRoleUrl,
} from "./dev_test_game_admin_audit_surface_ids.mjs";

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
          requiredReconnectLanes: handoff.requiredReconnectLaneIds ?? [],
          requiredStaleConflictLanes: handoff.requiredStaleConflictLaneIds ?? [],
          requiredUnproven: handoff.requiredUnprovenIds ?? [],
          requiredLocalPrerequisiteDestinations:
            handoff.requiredLocalPrerequisiteDestinations ?? [],
          requiredHostedHandoffInputs:
            handoff.requiredHostedHandoffInputIds ?? [],
          requiredHostedHandoffBlockedChecks:
            handoff.requiredHostedHandoffBlockedCheckIds ?? [],
          requiredHostedHandoffSummary:
            handoff.requiredHostedHandoffSummary ?? null,
          requiredHostedHandoffBlockedReceipt:
            handoff.requiredHostedHandoffBlockedReceipt ?? null,
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
  const expectedRoleUrl = localAdminAuditRoleUrl(auditId);
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
  for (const prerequisite of handoff.requiredLocalPrerequisiteDestinations ?? []) {
    const prerequisiteId = String(prerequisite?.id ?? "");
    const prerequisiteAuditId = String(prerequisite?.auditId ?? "");
    if (prerequisiteId === "" || prerequisiteAuditId === "") {
      throw new Error(`${name} handoff has a malformed local prerequisite`);
    }
    if (!destination.visibleLocalPrerequisites?.includes(prerequisiteId)) {
      throw new Error(
        `${name} handoff destination missing local prerequisite: ${prerequisiteId}`,
      );
    }
    if (
      typeof destination.visibleLocalPrerequisiteRoleUrls?.[prerequisiteId] !==
      "string"
    ) {
      throw new Error(
        `${name} handoff destination missing local prerequisite role URL: ${prerequisiteId}`,
      );
    }
    const visitedDestination =
      destination.visitedLocalPrerequisiteDestinations?.find(
        (item) =>
          item?.id === prerequisiteId &&
          item.auditId === prerequisiteAuditId &&
          item.detailRoleUrl === localAdminAuditRoleUrl(prerequisiteAuditId) &&
          item.clickedThrough === true,
      ) ?? null;
    if (visitedDestination === null) {
      throw new Error(
        `${name} handoff destination did not navigate local prerequisite: ${prerequisiteId}`,
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
  for (const laneId of handoff.requiredReconnectLaneIds ?? []) {
    if (!destination.visibleReconnectLanes?.includes(laneId)) {
      throw new Error(
        `${name} handoff destination missing reconnect lane: ${laneId}`,
      );
    }
  }
  for (const laneId of handoff.requiredStaleConflictLaneIds ?? []) {
    if (!destination.visibleStaleConflictLanes?.includes(laneId)) {
      throw new Error(
        `${name} handoff destination missing stale-conflict lane: ${laneId}`,
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
  for (const inputId of handoff.requiredHostedHandoffInputIds ?? []) {
    if (!destination.visibleHostedHandoffInputs?.includes(inputId)) {
      throw new Error(
        `${name} handoff destination missing hosted handoff input: ${inputId}`,
      );
    }
  }
  for (const checkId of handoff.requiredHostedHandoffBlockedCheckIds ?? []) {
    if (!destination.visibleHostedHandoffBlockedChecks?.includes(checkId)) {
      throw new Error(
        `${name} handoff destination missing hosted handoff blocked check: ${checkId}`,
      );
    }
  }
  assertOptionalObjectEqual({
    actual: destination.visibleHostedHandoffSummary,
    expected: handoff.requiredHostedHandoffSummary,
    message: `${name} handoff destination missing hosted handoff summary`,
  });
  assertOptionalObjectEqual({
    actual: destination.visibleHostedHandoffBlockedReceipt,
    expected: handoff.requiredHostedHandoffBlockedReceipt,
    message: `${name} handoff destination missing hosted handoff blocked receipt`,
  });
}

function assertOptionalObjectEqual({ actual, expected, message }) {
  if (expected === null || expected === undefined) {
    return;
  }
  if (JSON.stringify(actual ?? null) !== JSON.stringify(expected)) {
    throw new Error(message);
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
