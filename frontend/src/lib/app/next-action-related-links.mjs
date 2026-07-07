export const nextActionRelatedLinkHrefKinds = Object.freeze({
  proofGraphAudit: "proof-graph-audit",
  seededRoleUrl: "seeded-role-url",
});

export function unprovenRoleUrlRelatedLinkDescriptor({
  command = "",
  actionStatus = "unknown",
  unproven = null,
  unprovenProofGraphNodeId = "",
  unprovenRoleUrl = "",
} = {}) {
  return String(unprovenRoleUrl ?? "") === ""
    ? null
    : Object.freeze({
        id: unprovenProofGraphNodeId || String(unproven?.id),
        label: String(unproven?.id ?? "Selected role surface"),
        hrefKind: nextActionRelatedLinkHrefKinds.seededRoleUrl,
        roleUrl: String(unprovenRoleUrl),
        status: String(unproven?.status ?? actionStatus),
        command,
      });
}

export function localReadinessDependencyRelatedLinkDescriptor({
  command = "",
  actionStatus = "unknown",
  localCheck = null,
  localCheckRoleUrl = "",
} = {}) {
  return String(localCheckRoleUrl ?? "") === ""
    ? null
    : Object.freeze({
        id: String(localCheck?.id ?? "local-readiness-dependency"),
        label: String(localCheck?.id ?? "Local readiness dependency"),
        hrefKind: nextActionRelatedLinkHrefKinds.seededRoleUrl,
        roleUrl: String(localCheckRoleUrl),
        status: String(localCheck?.status ?? actionStatus),
        command,
      });
}

export function seedProofLaneCoverageRelatedLinkDescriptor({
  command = "",
  actionStatus = "unknown",
  seedProofLaneCoverage = null,
  seedProofLaneCoverageRoleUrl = "",
} = {}) {
  return String(seedProofLaneCoverageRoleUrl ?? "") === ""
    ? null
    : Object.freeze({
        id: "seed-proof-lane-coverage",
        label: "Seed proof-lane coverage",
        hrefKind: nextActionRelatedLinkHrefKinds.seededRoleUrl,
        roleUrl: String(seedProofLaneCoverageRoleUrl),
        status: String(seedProofLaneCoverage?.status ?? actionStatus),
        command,
      });
}

export function proofGraphDestinationSummaryRelatedLinkDescriptor({
  command = "",
  actionStatus = "unknown",
  proofGraphDestinationSummary = null,
} = {}) {
  return proofGraphDestinationSummary === null
    ? null
    : Object.freeze({
        id: "proof-graph-destination-summary",
        label: "Proof graph destination summary",
        hrefKind: nextActionRelatedLinkHrefKinds.proofGraphAudit,
        status: String(
          proofGraphDestinationSummary?.summaryStatus ?? actionStatus,
        ),
        command,
      });
}

export function hostedIdentitySequenceDeferralRelatedLinkDescriptor({
  command = "",
  actionStatus = "unknown",
  sequenceDeferral = null,
  sequenceDeferralRoleUrl = "",
} = {}) {
  return String(sequenceDeferralRoleUrl ?? "") === ""
    ? null
    : Object.freeze({
        id: String(
          sequenceDeferral?.deferredUnprovenId ??
            "hosted-identity-sequence-deferral",
        ),
        label: "Deferred hosted identity",
        hrefKind: nextActionRelatedLinkHrefKinds.seededRoleUrl,
        roleUrl: String(sequenceDeferralRoleUrl),
        status: String(sequenceDeferral?.status ?? actionStatus),
        command: String(sequenceDeferral?.deferredCommand ?? command),
      });
}

export function nextActionRelatedLinkDescriptors({
  command = "",
  actionStatus = "unknown",
  unproven = null,
  unprovenRoleUrl = "",
  unprovenProofGraphNodeId = "",
  localCheck = null,
  localCheckRoleUrl = "",
  seedProofLaneCoverage = null,
  seedProofLaneCoverageRoleUrl = "",
  proofGraphDestinationSummary = null,
  sequenceDeferral = null,
  sequenceDeferralRoleUrl = "",
} = {}) {
  return Object.freeze(
    [
      unprovenRoleUrlRelatedLinkDescriptor({
        command,
        actionStatus,
        unproven,
        unprovenProofGraphNodeId,
        unprovenRoleUrl,
      }),
      localReadinessDependencyRelatedLinkDescriptor({
        command,
        actionStatus,
        localCheck,
        localCheckRoleUrl,
      }),
      seedProofLaneCoverageRelatedLinkDescriptor({
        command,
        actionStatus,
        seedProofLaneCoverage,
        seedProofLaneCoverageRoleUrl,
      }),
      proofGraphDestinationSummaryRelatedLinkDescriptor({
        command,
        actionStatus,
        proofGraphDestinationSummary,
      }),
      hostedIdentitySequenceDeferralRelatedLinkDescriptor({
        command,
        actionStatus,
        sequenceDeferral,
        sequenceDeferralRoleUrl,
      }),
    ].filter((descriptor) => descriptor !== null),
  );
}

export function nextActionRelatedLinkIds(options = {}) {
  return nextActionRelatedLinkDescriptors(options).map(
    (descriptor) => descriptor.id,
  );
}
