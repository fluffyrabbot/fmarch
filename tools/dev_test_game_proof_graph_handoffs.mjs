import { hostedMatrixHandoffSummaryForRoleLink } from "../frontend/src/lib/app/local-proof-handoff-status.mjs";
import {
  adminProofDestinationRequirements,
} from "./dev_test_game_proof_graph_handoff_cases.mjs";

export function adminProofGraphRoleHandoffs({
  proofGraph,
  hostedMatrix,
  hostedEvidenceLane,
}) {
  const roleNodes = adminProofRoleNodes(proofGraph);
  const roleNodeById = new Map(roleNodes.map((node) => [node.id, node]));
  const handoffs = adminProofDestinationRequirements().flatMap((requirement) => {
    const node = roleNodeById.get(requirement.linkId);
    if (node === undefined || !nodeRoleUrlMatchesAudit(node, requirement.auditId)) {
      return [];
    }
    if (requirement.fromHostedMatrix === true) {
      const handoff = hostedMatrixHandoffSummaryForRoleLink({
        linkId: node.id,
        roleUrl: node.roleUrl,
        hostedMatrix,
      });
      return handoff === null ? [] : [handoff];
    }
    if (requirement.linkId === "admin-proof:hosted-evidence-lane") {
      const handoff = baseHandoffForRequirement(requirement);
      return [
        {
          ...handoff,
          ...hostedEvidenceLaneHandoffRequirements({
            hostedEvidenceLane,
            handoff,
          }),
        },
      ];
    }
    return [
      baseHandoffForRequirement(requirement),
    ];
  });
  assertAdminProofGraphRoleHandoffCoverage({
    proofGraph,
    handoffs,
  });
  return handoffs;
}

function baseHandoffForRequirement(requirement) {
  return {
    linkId: requirement.linkId,
    auditId: requirement.auditId,
    requiredCheckIds: requirement.requiredCheckIds ?? [],
    requiredCheckStatuses: requirement.requiredCheckStatuses ?? {},
    requiredScenarioIds: requirement.requiredScenarioIds ?? [],
    requiredSessionIds: requirement.requiredSessionIds ?? [],
    requiredUnprovenIds: requirement.requiredUnprovenIds ?? [],
    requiredHostedHandoffInputIds:
      requirement.requiredHostedHandoffInputs ?? [],
    requiredHostedHandoffBlockedCheckIds:
      requirement.requiredHostedHandoffBlockedChecks ?? [],
    requiredLocalPrerequisiteDestinations:
      requirement.requiredLocalPrerequisiteDestinations ?? [],
    requiredRelatedLinkIds: requirement.requiredRelatedLinkIds ?? [],
  };
}

function hostedEvidenceLaneHandoffRequirements({ hostedEvidenceLane, handoff }) {
  return {
    requiredHostedHandoffInputIds: handoff.requiredHostedHandoffInputIds,
    requiredHostedHandoffBlockedCheckIds: Array.isArray(
      hostedEvidenceLane?.blockedCheckIds,
    )
      ? hostedEvidenceLane.blockedCheckIds.map((id) => String(id))
      : handoff.requiredHostedHandoffBlockedCheckIds,
  };
}

export function assertAdminProofGraphRoleHandoffCoverage({ proofGraph, handoffs }) {
  const handoffIds = new Set((handoffs ?? []).map((handoff) => handoff.linkId));
  for (const node of adminProofRoleNodes(proofGraph)) {
    if (!handoffIds.has(node.id)) {
      throw new Error(`proof graph admin proof missing role handoff: ${node.id}`);
    }
  }
}

function adminProofRoleNodes(proofGraph) {
  return Array.isArray(proofGraph?.nodes)
    ? proofGraph.nodes.filter(
        (node) =>
          typeof node?.id === "string" &&
          node.id.startsWith("admin-proof:") &&
          typeof node.roleUrl === "string" &&
          node.roleUrl.trim() !== "",
      )
    : [];
}

function nodeRoleUrlMatchesAudit(node, auditId) {
  return node.roleUrl.includes(`/admin/audit/${auditId}`);
}
