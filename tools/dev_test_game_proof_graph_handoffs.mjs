import { hostedMatrixHandoffSummaryForRoleLink } from "../frontend/src/lib/app/local-proof-handoff-status.mjs";

const adminProofDestinationRequirements = [
  {
    linkId: "admin-proof:core-loop",
    auditId: "local-core-loop",
    requiredCheckIds: ["core-loop", "private-channel", "host-lifecycle-control"],
  },
  {
    linkId: "admin-proof:hardening",
    auditId: "local-hardening",
    requiredCheckIds: [
      "idempotent-retry",
      "concurrent-action-race",
      "stale-action-conflict-message",
    ],
  },
  {
    linkId: "admin-proof:identity",
    auditId: "local-identity-adapter",
    requiredCheckIds: ["session-rotation", "invite-revocation"],
    requiredSessionIds: ["admin", "host", "player"],
  },
  {
    linkId: "admin-proof:backup",
    auditId: "local-backup-restore",
    requiredCheckIds: ["dump-created", "auth-sessions-restored"],
    requiredSessionIds: ["host", "player", "admin"],
  },
  {
    linkId: "admin-proof:ops",
    auditId: "local-ops-artifacts",
    requiredCheckIds: ["source-artifacts-checksummed", "release-boundary-carried"],
  },
  {
    linkId: "admin-proof:seed",
    auditId: "local-seed-fixtures",
    requiredScenarioIds: [
      "host-phase-controls",
      "player-action-denied",
      "local-ops-readiness",
    ],
  },
  {
    linkId: "admin-proof:release",
    auditId: "local-release-readiness",
    requiredCheckIds: [
      "local-role-url-browser-proof",
      "local-core-loop-proof",
      "local-hardening-proof",
      "local-proof-graph-admin-role-handoffs",
    ],
    requiredLocalPrerequisiteDestinations: [
      {
        id: "local-proof-graph-admin-role-handoffs",
        auditId: "local-proof-graph",
      },
      {
        id: "local-proof-freshness-admin-surface",
        auditId: "local-proof-freshness",
      },
      {
        id: "local-next-action-admin-surface",
        auditId: "local-next-action",
      },
    ],
    requiredUnprovenIds: ["hosted-deployment", "human-release-approval"],
  },
  {
    linkId: "admin-proof:release-runbook",
    auditId: "local-release-runbook",
    requiredCheckIds: [
      "remaining-readiness-gaps-mapped",
      "rollback-path-carried",
      "support-path-carried",
      "release-claim-boundary-carried",
      "human-approval-boundary-carried",
    ],
    requiredUnprovenIds: ["human-release-approval"],
    requiredRelatedLinkIds: ["local-release-readiness"],
  },
  {
    linkId: "admin-proof:race-coverage",
    auditId: "local-race-coverage",
    requiredCheckIds: ["player-vote-change", "player-night-action"],
  },
  {
    linkId: "admin-proof:hosted-concurrent-race-matrix",
    auditId: "local-hosted-concurrent-race-matrix",
    fromHostedMatrix: true,
  },
  {
    linkId: "admin-proof:hosted-ops-signals",
    auditId: "local-hosted-ops-signals",
    requiredCheckIds: [
      "hosted-matrix-artifact-checksummed",
      "local-target-signals-carried",
      "matrix-health-counters-carried",
      "readiness-boundary-carried",
      "hosted-telemetry-boundary-carried",
    ],
    requiredRelatedLinkIds: [
      "local-hosted-concurrent-race-matrix",
      "local-ops-artifacts",
    ],
  },
  {
    linkId: "admin-proof:spine-manifest",
    auditId: "local-spine-manifest",
    requiredCheckIds: [
      "live-spine-order-recorded",
      "proof-freshness-handoff",
      "next-action-handoff",
    ],
    requiredRelatedLinkIds: ["local-proof-freshness", "local-next-action"],
  },
];

export function adminProofGraphRoleHandoffs({ proofGraph, hostedMatrix }) {
  const roleNodes = adminProofRoleNodes(proofGraph);
  const roleNodeById = new Map(roleNodes.map((node) => [node.id, node]));
  const handoffs = adminProofDestinationRequirements.flatMap((requirement) => {
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
    return [
      {
        linkId: requirement.linkId,
        auditId: requirement.auditId,
        requiredCheckIds: requirement.requiredCheckIds ?? [],
        requiredCheckStatuses: requirement.requiredCheckStatuses ?? {},
        requiredScenarioIds: requirement.requiredScenarioIds ?? [],
        requiredSessionIds: requirement.requiredSessionIds ?? [],
        requiredUnprovenIds: requirement.requiredUnprovenIds ?? [],
        requiredLocalPrerequisiteDestinations:
          requirement.requiredLocalPrerequisiteDestinations ?? [],
        requiredRelatedLinkIds: requirement.requiredRelatedLinkIds ?? [],
      },
    ];
  });
  assertAdminProofGraphRoleHandoffCoverage({
    proofGraph,
    handoffs,
  });
  return handoffs;
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
