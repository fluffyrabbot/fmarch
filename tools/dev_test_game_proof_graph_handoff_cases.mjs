import {
  staleConflictMessageLaneIds,
} from "./dev_test_game_stale_conflict_scenarios.mjs";
import {
  hostedTargetPreflightBlockingCheckIds,
  hostedTargetPreflightCheckIds,
} from "./dev_test_game_hosted_target_preflight_cases.mjs";
import {
  hostedEvidenceHandoffCase,
} from "./dev_test_game_hosted_handoff_cases.mjs";
import {
  hostedOpsSignalCheckIds,
  hostedOpsSignalRelatedAuditIds,
} from "./dev_test_game_hosted_ops_signal_cases.mjs";
import {
  hostedIdentityEvidenceCheckIds,
  hostedIdentityEvidenceHandoffCase,
} from "./dev_test_game_hosted_identity_evidence_cases.mjs";
import {
  seedScenarioCoverageGroups,
} from "./dev_test_game_seed_scenario_cases.mjs";

export const adminProofDestinationRequirementCases = Object.freeze([
  Object.freeze({
    linkId: "admin-proof:core-loop",
    auditId: "local-core-loop",
    requiredCheckIds: Object.freeze([
      "core-loop",
      "private-channel",
      "host-lifecycle-control",
    ]),
  }),
  Object.freeze({
    linkId: "admin-proof:hardening",
    auditId: "local-hardening",
    requiredCheckIds: Object.freeze([
      "idempotent-retry",
      "concurrent-action-race",
      ...staleConflictMessageLaneIds,
    ]),
  }),
  Object.freeze({
    linkId: "admin-proof:identity",
    auditId: "local-identity-adapter",
    requiredCheckIds: Object.freeze(["session-rotation", "invite-revocation"]),
    requiredSessionIds: Object.freeze(["admin", "host", "player"]),
  }),
  Object.freeze({
    linkId: "admin-proof:hosted-identity-evidence",
    auditId: "local-hosted-identity-evidence",
    requiredCheckIds: Object.freeze([...hostedIdentityEvidenceCheckIds]),
    requiredUnprovenIds: Object.freeze([...hostedIdentityEvidenceCheckIds]),
    requiredHostedHandoffInputs: Object.freeze([
      ...hostedIdentityEvidenceHandoffCase().inputIds,
    ]),
    requiredHostedHandoffBlockedChecks: Object.freeze([
      ...hostedIdentityEvidenceHandoffCase().blockedCheckIds,
    ]),
  }),
  Object.freeze({
    linkId: "admin-proof:backup",
    auditId: "local-backup-restore",
    requiredCheckIds: Object.freeze(["dump-created", "auth-sessions-restored"]),
    requiredSessionIds: Object.freeze(["host", "player", "admin"]),
  }),
  Object.freeze({
    linkId: "admin-proof:ops",
    auditId: "local-ops-artifacts",
    requiredCheckIds: Object.freeze([
      "source-artifacts-checksummed",
      "release-boundary-carried",
    ]),
  }),
  Object.freeze({
    linkId: "admin-proof:seed",
    auditId: "local-seed-fixtures",
    requiredScenarioIds: Object.freeze([...seedScenarioCoverageGroups.allDemo]),
  }),
  Object.freeze({
    linkId: "admin-proof:release",
    auditId: "local-release-readiness",
    requiredCheckIds: Object.freeze([
      "local-role-url-browser-proof",
      "local-core-loop-proof",
      "local-hardening-proof",
      "local-proof-graph-admin-role-handoffs",
    ]),
    requiredLocalPrerequisiteDestinations: Object.freeze([
      Object.freeze({
        id: "local-proof-graph-admin-role-handoffs",
        auditId: "local-proof-graph",
      }),
      Object.freeze({
        id: "local-proof-freshness-admin-surface",
        auditId: "local-proof-freshness",
      }),
      Object.freeze({
        id: "local-next-action-admin-surface",
        auditId: "local-next-action",
      }),
      Object.freeze({
        id: "local-hosted-evidence-lane-demo-proof",
        auditId: "local-hosted-evidence-lane",
      }),
    ]),
    requiredUnprovenIds: Object.freeze([
      "hosted-deployment",
      "human-release-approval",
    ]),
  }),
  Object.freeze({
    linkId: "admin-proof:release-runbook",
    auditId: "local-release-runbook",
    requiredCheckIds: Object.freeze([
      "remaining-readiness-gaps-mapped",
      "rollback-path-carried",
      "support-path-carried",
      "release-claim-boundary-carried",
      "human-approval-boundary-carried",
    ]),
    requiredUnprovenIds: Object.freeze(["human-release-approval"]),
    requiredRelatedLinkIds: Object.freeze(["local-release-readiness"]),
  }),
  Object.freeze({
    linkId: "admin-proof:race-coverage",
    auditId: "local-race-coverage",
    requiredCheckIds: Object.freeze(["player-vote-change", "player-night-action"]),
  }),
  Object.freeze({
    linkId: "admin-proof:hosted-target-preflight",
    auditId: "local-hosted-target-preflight",
    requiredCheckIds: Object.freeze([...hostedTargetPreflightCheckIds]),
    requiredRelatedLinkIds: Object.freeze([
      "local-hosted-concurrent-race-matrix",
      "local-next-action",
    ]),
  }),
  Object.freeze({
    linkId: "admin-proof:hosted-evidence-lane",
    auditId: "local-hosted-evidence-lane",
    requiredCheckIds: Object.freeze([
      "hosted-target-preflight",
      ...hostedTargetPreflightBlockingCheckIds,
    ]),
    requiredHostedHandoffInputs: Object.freeze([
      ...hostedEvidenceHandoffCase().inputIds,
    ]),
    requiredHostedHandoffBlockedChecks: Object.freeze([
      ...hostedEvidenceHandoffCase().blockedCheckIds,
    ]),
    requiredRelatedLinkIds: Object.freeze([
      "local-hosted-target-preflight",
      "local-hosted-concurrent-race-matrix",
      "local-next-action",
    ]),
  }),
  Object.freeze({
    linkId: "admin-proof:hosted-concurrent-race-matrix",
    auditId: "local-hosted-concurrent-race-matrix",
    fromHostedMatrix: true,
  }),
  Object.freeze({
    linkId: "admin-proof:hosted-ops-signals",
    auditId: "local-hosted-ops-signals",
    requiredCheckIds: Object.freeze([...hostedOpsSignalCheckIds]),
    requiredRelatedLinkIds: Object.freeze([...hostedOpsSignalRelatedAuditIds]),
  }),
  Object.freeze({
    linkId: "admin-proof:spine-manifest",
    auditId: "local-spine-manifest",
    requiredCheckIds: Object.freeze([
      "live-spine-order-recorded",
      "proof-freshness-handoff",
      "next-action-handoff",
    ]),
    requiredRelatedLinkIds: Object.freeze([
      "local-proof-freshness",
      "local-next-action",
    ]),
  }),
]);

export const adminProofDestinationRequirementLinkRows = Object.freeze(
  adminProofDestinationRequirementCases.map((requirement) =>
    Object.freeze([requirement.linkId, requirement.auditId]),
  ),
);

export function adminProofDestinationRequirements() {
  return adminProofDestinationRequirementCases.map((requirement) =>
    cloneRequirement(requirement),
  );
}

export function adminProofDestinationRequirementForLink(linkId) {
  const requirement = adminProofDestinationRequirementCases.find(
    (item) => item.linkId === linkId,
  );
  return requirement === undefined ? undefined : cloneRequirement(requirement);
}

function cloneRequirement(requirement) {
  return {
    linkId: requirement.linkId,
    auditId: requirement.auditId,
    ...(requirement.requiredCheckIds === undefined
      ? {}
      : { requiredCheckIds: [...requirement.requiredCheckIds] }),
    ...(requirement.requiredCheckStatuses === undefined
      ? {}
      : { requiredCheckStatuses: { ...requirement.requiredCheckStatuses } }),
    ...(requirement.requiredScenarioIds === undefined
      ? {}
      : { requiredScenarioIds: [...requirement.requiredScenarioIds] }),
    ...(requirement.requiredSessionIds === undefined
      ? {}
      : { requiredSessionIds: [...requirement.requiredSessionIds] }),
    ...(requirement.requiredUnprovenIds === undefined
      ? {}
      : { requiredUnprovenIds: [...requirement.requiredUnprovenIds] }),
    ...(requirement.requiredHostedHandoffInputs === undefined
      ? {}
      : {
          requiredHostedHandoffInputs: [
            ...requirement.requiredHostedHandoffInputs,
          ],
        }),
    ...(requirement.requiredHostedHandoffBlockedChecks === undefined
      ? {}
      : {
          requiredHostedHandoffBlockedChecks: [
            ...requirement.requiredHostedHandoffBlockedChecks,
          ],
        }),
    ...(requirement.requiredLocalPrerequisiteDestinations === undefined
      ? {}
      : {
          requiredLocalPrerequisiteDestinations:
            requirement.requiredLocalPrerequisiteDestinations.map((item) => ({
              ...item,
            })),
        }),
    ...(requirement.requiredRelatedLinkIds === undefined
      ? {}
      : { requiredRelatedLinkIds: [...requirement.requiredRelatedLinkIds] }),
    ...(requirement.fromHostedMatrix === undefined
      ? {}
      : { fromHostedMatrix: requirement.fromHostedMatrix }),
  };
}
