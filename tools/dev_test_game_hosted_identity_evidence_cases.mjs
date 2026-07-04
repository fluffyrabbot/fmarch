export const devTestGameHostedIdentityEvidencePath =
  "target/dev-test-game/hosted-identity-evidence.json";
export const devTestGameHostedIdentityEvidenceCommand =
  "test:dev-test-game-hosted-identity-evidence";
export const hostedIdentityEvidencePlaceholderFixturePath =
  "tools/fixtures/dev_test_game_hosted_identity_evidence.placeholder.json";
export const hostedIdentityEvidenceRedactedPassFixturePath =
  "tools/fixtures/dev_test_game_hosted_identity_evidence.redacted-pass.json";

export const hostedIdentityEvidencePlaceholderSchema = Object.freeze({
  type: "object",
  required: Object.freeze([
    "version",
    "proof",
    "releaseReady",
    "productionReady",
    "redaction",
    "hostedIdentity",
  ]),
  properties: Object.freeze({
    version: Object.freeze({ const: 1 }),
    proof: Object.freeze({ const: "hosted-production-identity-evidence" }),
    releaseReady: Object.freeze({ const: false }),
    productionReady: Object.freeze({ const: false }),
    redaction: Object.freeze({
      type: "object",
      required: Object.freeze([
        "packetKind",
        "rawInviteTokensIncluded",
        "rawSessionSecretsIncluded",
        "rawPasswordHashesIncluded",
        "rawPersonalContactIncluded",
      ]),
      properties: Object.freeze({
        packetKind: Object.freeze({
          const: "redacted-hosted-identity-intake",
        }),
        rawInviteTokensIncluded: Object.freeze({ const: false }),
        rawSessionSecretsIncluded: Object.freeze({ const: false }),
        rawPasswordHashesIncluded: Object.freeze({ const: false }),
        rawPersonalContactIncluded: Object.freeze({ const: false }),
      }),
    }),
    hostedIdentity: Object.freeze({
      type: "object",
      required: Object.freeze([
        "accountLifecycle",
        "inviteDelivery",
        "accountRecovery",
        "abuseAndRateLimitPolicy",
        "sessionSecretPolicy",
        "hostedAuditRetentionExport",
        "roleSurfaceArchitectureChanged",
        "roleSurfaceContract",
        "identityAdapterContract",
      ]),
      properties: Object.freeze({
        accountLifecycle: Object.freeze({ type: "object" }),
        inviteDelivery: Object.freeze({ type: "object" }),
        accountRecovery: Object.freeze({ type: "object" }),
        abuseAndRateLimitPolicy: Object.freeze({ type: "object" }),
        sessionSecretPolicy: Object.freeze({ type: "object" }),
        hostedAuditRetentionExport: Object.freeze({ type: "object" }),
        roleSurfaceArchitectureChanged: Object.freeze({ type: "boolean" }),
        roleSurfaceContract: Object.freeze({ type: "object" }),
        identityAdapterContract: Object.freeze({ type: "object" }),
      }),
    }),
  }),
});

export const hostedIdentityExpectedRoleSurfaceContract = deepFreeze({
  version: 1,
  architectureId: "seeded-role-url-plus-session-adapter-v1",
  seededGamePlaceholder: "<seeded-game>",
  roleUrlPatterns: [
    {
      id: "admin-audit",
      href: "/admin/audit/:audit?game=<seeded-game>",
    },
    {
      id: "admin-overview",
      href: "/admin?game=<seeded-game>",
    },
    {
      id: "host",
      href: "/g/<seeded-game>/host",
    },
    {
      id: "player",
      href: "/g/<seeded-game>",
    },
    {
      id: "channel",
      href: "/g/<seeded-game>/c/:channel",
    },
  ],
  authBoundaries: [
    {
      id: "login",
      path: "/auth/login",
    },
    {
      id: "session",
      path: "/auth/session",
    },
    {
      id: "session-grants",
      path: "/auth/session-grants",
    },
  ],
  credentialPolicy: {
    rawInviteTokensInRoleUrls: false,
    rawSessionSecretsInRoleUrls: false,
    accountIdentifiersChangeRoleUrls: false,
  },
});

export const hostedIdentityEvidenceInputIds = Object.freeze([
  "command",
  "proof-target",
  "FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH",
  "redacted-role-surface-contract-packet",
  "redacted-identity-adapter-contract-packet",
  "redacted-account-lifecycle-packet",
  "redacted-invite-delivery-packet",
  "redacted-account-recovery-packet",
  "redacted-abuse-rate-limit-packet",
  "redacted-session-secret-packet",
  "redacted-audit-retention-packet",
]);

export const hostedIdentityEvidencePacketSectionDefinitions = Object.freeze([
  Object.freeze({
    field: "accountLifecycle",
    evidenceFamily: "account-lifecycle",
    checkId: "hosted-account-lifecycle-evidence",
    label: "Account lifecycle",
    requiredInputIds: Object.freeze([
      "createAccount",
      "login",
      "disableAccount",
      "enableAccount",
    ]),
  }),
  Object.freeze({
    field: "inviteDelivery",
    evidenceFamily: "invite-delivery",
    checkId: "invite-delivery-evidence",
    label: "Invite delivery",
    requiredInputIds: Object.freeze(["deliveryChannels", "revocationCovered"]),
  }),
  Object.freeze({
    field: "accountRecovery",
    evidenceFamily: "account-recovery",
    checkId: "account-recovery-evidence",
    label: "Account recovery",
    requiredInputIds: Object.freeze([
      "recoveryMethods",
      "recoveredSessionsPreserveRoleSurfaceAdapter",
    ]),
  }),
  Object.freeze({
    field: "abuseAndRateLimitPolicy",
    evidenceFamily: "abuse-rate-limit",
    checkId: "abuse-and-rate-limit-evidence",
    label: "Abuse and rate limit",
    requiredInputIds: Object.freeze(["protectedOperations", "rateLimitPolicyRef"]),
  }),
  Object.freeze({
    field: "sessionSecretPolicy",
    evidenceFamily: "session-secret-policy",
    checkId: "session-secret-policy-evidence",
    label: "Session secret policy",
    requiredInputIds: Object.freeze([
      "storage",
      "rotation",
      "deploymentSecretSource",
    ]),
  }),
  Object.freeze({
    field: "hostedAuditRetentionExport",
    evidenceFamily: "audit-retention-export",
    checkId: "hosted-audit-retention-export-evidence",
    label: "Audit retention and export",
    requiredInputIds: Object.freeze([
      "eventFamilies",
      "retentionWindow",
      "exportRef",
    ]),
  }),
]);

export const hostedIdentityEvidenceCheckIds = Object.freeze([
  "hosted-identity-evidence-path-configured",
  "hosted-identity-evidence-readable",
  "hosted-account-lifecycle-evidence",
  "invite-delivery-evidence",
  "account-recovery-evidence",
  "abuse-and-rate-limit-evidence",
  "session-secret-policy-evidence",
  "hosted-audit-retention-export-evidence",
  "role-surface-adapter-preserved",
  "identity-adapter-contract-compatible",
  "release-claim-boundary-carried",
]);

export const hostedIdentityEvidenceBlockedChecks = Object.freeze([
  Object.freeze({
    id: "hosted-identity-evidence-path-configured",
    requiredEvidence: "Set FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH.",
  }),
  Object.freeze({
    id: "hosted-identity-evidence-readable",
    requiredEvidence: "Readable hosted identity evidence JSON.",
  }),
  Object.freeze({
    id: "hosted-account-lifecycle-evidence",
    requiredEvidence:
      "Redacted hosted account create/login/disable/enable intake packet with evidence refs over the existing role-surface adapter.",
  }),
  Object.freeze({
    id: "invite-delivery-evidence",
    requiredEvidence:
      "Redacted hosted invite delivery and revocation intake packet without raw invite tokens in role URLs or admin surfaces.",
  }),
  Object.freeze({
    id: "account-recovery-evidence",
    requiredEvidence:
      "Redacted hosted account recovery intake packet where recovered sessions keep the same role-surface architecture.",
  }),
  Object.freeze({
    id: "abuse-and-rate-limit-evidence",
    requiredEvidence:
      "Redacted hosted rate-limit and abuse-control intake packet for login, invite, and session lifecycle operations.",
  }),
  Object.freeze({
    id: "session-secret-policy-evidence",
    requiredEvidence:
      "Redacted hosted session-secret storage, rotation, and deployment input packet with no raw secrets.",
  }),
  Object.freeze({
    id: "hosted-audit-retention-export-evidence",
    requiredEvidence:
      "Redacted hosted audit retention/export intake packet for account, invite, and session lifecycle events.",
  }),
  Object.freeze({
    id: "role-surface-adapter-preserved",
    requiredEvidence:
      "Hosted identity must preserve the existing role URL and adapter architecture by matching the shared role-surface contract.",
  }),
  Object.freeze({
    id: "identity-adapter-contract-compatible",
    requiredEvidence:
      "Hosted identity must provide a redacted identity adapter contract packet compatible with the local invite/account/session adapter contract.",
  }),
  Object.freeze({
    id: "release-claim-boundary-carried",
    requiredEvidence:
      "The hosted identity evidence file must keep releaseReady and productionReady false.",
  }),
]);

export const hostedIdentityEvidenceRequirementGroupDefinitions = Object.freeze([
  Object.freeze({
    id: "hosted-identity-evidence-intake",
    label: "Evidence intake",
    checkIds: Object.freeze([
      "hosted-identity-evidence-path-configured",
      "hosted-identity-evidence-readable",
    ]),
    requiredEvidence: "Attach a readable hosted identity evidence JSON file.",
  }),
  Object.freeze({
    id: "hosted-account-lifecycle",
    label: "Account lifecycle",
    checkIds: Object.freeze([
      "hosted-account-lifecycle-evidence",
      "role-surface-adapter-preserved",
      "identity-adapter-contract-compatible",
    ]),
    requiredEvidence:
      "Hosted account create/login/disable/enable evidence while preserving the role-surface adapter.",
  }),
  Object.freeze({
    id: "invite-delivery-revocation",
    label: "Invite delivery and revocation",
    checkIds: Object.freeze(["invite-delivery-evidence"]),
    requiredEvidence:
      "Hosted invite delivery and revocation evidence without exposing raw invite tokens.",
  }),
  Object.freeze({
    id: "account-recovery",
    label: "Account recovery",
    checkIds: Object.freeze(["account-recovery-evidence"]),
    requiredEvidence:
      "Hosted account recovery evidence where recovered sessions keep the same role-surface architecture.",
  }),
  Object.freeze({
    id: "abuse-session-policy",
    label: "Abuse and session policy",
    checkIds: Object.freeze([
      "abuse-and-rate-limit-evidence",
      "session-secret-policy-evidence",
    ]),
    requiredEvidence:
      "Hosted abuse/rate-limit evidence plus session-secret storage, rotation, and deployment policy evidence.",
  }),
  Object.freeze({
    id: "audit-retention-export",
    label: "Audit retention and export",
    checkIds: Object.freeze([
      "hosted-audit-retention-export-evidence",
      "release-claim-boundary-carried",
    ]),
    requiredEvidence:
      "Hosted audit retention/export evidence while keeping releaseReady and productionReady false.",
  }),
]);

export function hostedIdentityEvidenceBlockedCheckRows() {
  return hostedIdentityEvidenceBlockedChecks.map((check) => ({
    ...check,
    status: "blocked",
  }));
}

export function hostedIdentityEvidenceHandoffCase({
  status = "blocked",
  preflightStatus = status,
  blockedChecks = hostedIdentityEvidenceBlockedCheckRows(),
  requirementGroups = hostedIdentityEvidenceRequirementGroups(blockedChecks),
} = {}) {
  return {
    status,
    preflightStatus,
    command: `npm run ${devTestGameHostedIdentityEvidenceCommand}`,
    proofTarget: devTestGameHostedIdentityEvidencePath,
    placeholderFixturePath: hostedIdentityEvidencePlaceholderFixturePath,
    inputIds: [...hostedIdentityEvidenceInputIds],
    blockedCheckIds: blockedChecks.map((check) => check.id),
    blockedChecks: blockedChecks.map((check) => ({
      id: check.id,
      status: "blocked",
      requiredEvidence: String(check.requiredEvidence ?? ""),
    })),
    requirementGroups,
  };
}

export function hostedIdentityEvidenceRequirementGroups(checks) {
  const checksById = new Map((checks ?? []).map((check) => [check.id, check]));
  return hostedIdentityEvidenceRequirementGroupDefinitions.map((group) => {
    const checkIds = [...group.checkIds];
    const blockedCheckIds = checkIds.filter(
      (id) => checksById.get(id)?.status !== "passed",
    );
    return {
      id: group.id,
      label: group.label,
      status: blockedCheckIds.length === 0 ? "passed" : "blocked",
      requiredEvidence: group.requiredEvidence,
      checkIds,
      blockedCheckIds,
    };
  });
}

export function requiredHostedIdentityEvidenceForCheck(id) {
  return (
    hostedIdentityEvidenceBlockedChecks.find((check) => check.id === id)
      ?.requiredEvidence ?? "Hosted identity evidence."
  );
}

export function hostedIdentityRoleSurfaceContractDiff(hostedIdentity) {
  const expected = {
    roleSurfaceArchitectureChanged: false,
    roleSurfaceContract: hostedIdentityExpectedRoleSurfaceContract,
  };
  const actual = {
    roleSurfaceArchitectureChanged:
      hostedIdentity !== null &&
      typeof hostedIdentity === "object" &&
      !Array.isArray(hostedIdentity)
        ? hostedIdentity.roleSurfaceArchitectureChanged
        : undefined,
    roleSurfaceContract:
      hostedIdentity !== null &&
      typeof hostedIdentity === "object" &&
      !Array.isArray(hostedIdentity)
        ? hostedIdentity.roleSurfaceContract
        : undefined,
  };
  const mismatches = contractMismatches({
    expected,
    actual,
    path: "hostedIdentity",
  });
  return {
    status: mismatches.length === 0 ? "passed" : "blocked",
    architectureId: hostedIdentityExpectedRoleSurfaceContract.architectureId,
    expected,
    actual: normalizeContractActual(actual),
    mismatches,
  };
}

function contractMismatches({ expected, actual, path }) {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      return [contractMismatch({ path, expected, actual })];
    }
    const mismatches = [];
    if (actual.length !== expected.length) {
      mismatches.push(
        contractMismatch({
          path: `${path}.length`,
          expected: expected.length,
          actual: actual.length,
        }),
      );
    }
    expected.forEach((value, index) => {
      mismatches.push(
        ...contractMismatches({
          expected: value,
          actual: actual[index],
          path: `${path}[${index}]`,
        }),
      );
    });
    return mismatches;
  }
  if (expected !== null && typeof expected === "object") {
    if (actual === null || typeof actual !== "object" || Array.isArray(actual)) {
      return [contractMismatch({ path, expected, actual })];
    }
    return Object.keys(expected).flatMap((key) =>
      contractMismatches({
        expected: expected[key],
        actual: actual[key],
        path: `${path}.${key}`,
      }),
    );
  }
  return actual === expected ? [] : [contractMismatch({ path, expected, actual })];
}

function contractMismatch({ path, expected, actual }) {
  return {
    id: path.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    path,
    expected,
    actual: actual === undefined ? null : actual,
  };
}

function normalizeContractActual(actual) {
  return JSON.parse(
    JSON.stringify(actual, (_key, value) => (value === undefined ? null : value)),
  );
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}
