import {
  hostedIdentityExpectedRoleSurfaceContract,
  hostedIdentityRoleSurfaceContractDiff,
} from "./dev_test_game_hosted_identity_evidence_cases.mjs";

export const devTestGameIdentityAdapterProofVersion = 17;
export const devTestGameIdentityAdapterContractId =
  "local-production-identity-adapter-v1";

export const devTestGameIdentityAdapterExpectedContract = deepFreeze({
  version: 1,
  adapterId: devTestGameIdentityAdapterContractId,
  roleSurfaceArchitectureChanged: false,
  roleSurfaceContract: hostedIdentityExpectedRoleSurfaceContract,
  credentialKinds: {
    invite: "account-bound-single-use-invite",
    account: "local-password-account",
    recovery: "hashed-single-use-recovery-credential",
    session: "opaque-session",
  },
  passwordAlgorithm: "argon2id",
  credentialAttemptPolicyKind: "two-tier-postgres-account-source-lockout",
  credentialAttemptSourceKind: "sveltekit-client-address-to-trusted-api-header",
  browserCookieName: "fmarch_session",
  lifecycleControls: [
    "account-disable",
    "account-enable",
    "account-password-rotation",
    "account-recovery-credential-issuance",
    "account-recovery-credential-revocation",
    "account-recovery",
    "credential-attempt-throttling",
    "session-rotation",
    "session-age-rotation",
    "session-logout",
    "session-revocation",
    "invite-revocation",
  ],
  delegatedIssuanceControls: ["host-scoped-invite-issuance"],
  redactionPolicy: {
    rawInviteTokensStored: false,
    rawSessionSecretsStored: false,
    rawPasswordStored: false,
    rawInviteTokensVisible: false,
  },
});

export function buildDevTestGameIdentityAdapterContractPacket({
  lifecycleStatus = "passed",
  roleSurfaceEvidenceStatus = "passed",
} = {}) {
  return {
    ...devTestGameIdentityAdapterExpectedContract,
    status:
      lifecycleStatus === "passed" && roleSurfaceEvidenceStatus === "passed"
        ? "passed"
        : "blocked",
    lifecycleStatus,
    roleSurfaceEvidenceStatus,
  };
}

export function devTestGameIdentityAdapterContractDiff(packet) {
  const expected = devTestGameIdentityAdapterExpectedContract;
  const actual =
    packet !== null && typeof packet === "object" && !Array.isArray(packet)
      ? {
          version: packet.version,
          adapterId: packet.adapterId,
          roleSurfaceArchitectureChanged: packet.roleSurfaceArchitectureChanged,
          roleSurfaceContract: packet.roleSurfaceContract,
          credentialKinds: packet.credentialKinds,
          passwordAlgorithm: packet.passwordAlgorithm,
          credentialAttemptPolicyKind: packet.credentialAttemptPolicyKind,
          credentialAttemptSourceKind: packet.credentialAttemptSourceKind,
          browserCookieName: packet.browserCookieName,
          lifecycleControls: packet.lifecycleControls,
          delegatedIssuanceControls: packet.delegatedIssuanceControls,
          redactionPolicy: packet.redactionPolicy,
        }
      : null;
  const mismatches = contractMismatches({
    expected,
    actual,
    path: "identityAdapterContract",
  });
  const roleSurfaceContractDiff = hostedIdentityRoleSurfaceContractDiff({
    roleSurfaceArchitectureChanged:
      actual?.roleSurfaceArchitectureChanged,
    roleSurfaceContract: actual?.roleSurfaceContract,
  });
  return {
    status:
      mismatches.length === 0 && roleSurfaceContractDiff.status === "passed"
        ? "passed"
        : "blocked",
    adapterId: devTestGameIdentityAdapterContractId,
    roleSurfaceContractDiff,
    mismatches,
  };
}

export function assertDevTestGameIdentityAdapterContractPacket(packet) {
  const diff = devTestGameIdentityAdapterContractDiff(packet);
  if (
    packet?.status !== "passed" ||
    packet.lifecycleStatus !== "passed" ||
    packet.roleSurfaceEvidenceStatus !== "passed" ||
    diff.status !== "passed"
  ) {
    throw new Error("identity adapter contract packet drifted");
  }
  return packet;
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

function deepFreeze(value) {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}
