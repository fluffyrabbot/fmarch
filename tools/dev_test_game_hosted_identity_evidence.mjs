import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { repoRoot } from "./dev_test_game_spine_runner.mjs";
export {
  devTestGameHostedIdentityEvidenceCommand,
  devTestGameHostedIdentityEvidencePath,
  hostedIdentityEvidenceBlockedCheckRows,
  hostedIdentityEvidenceBlockedChecks,
  hostedIdentityEvidenceCheckIds,
  hostedIdentityEvidenceHandoffCase,
  hostedIdentityEvidenceInputIds,
  hostedIdentityEvidencePlaceholderFixturePath,
  hostedIdentityEvidencePlaceholderSchema,
  hostedIdentityEvidenceRequirementGroupDefinitions,
  hostedIdentityEvidenceRequirementGroups,
  requiredHostedIdentityEvidenceForCheck,
} from "./dev_test_game_hosted_identity_evidence_cases.mjs";
import {
  devTestGameHostedIdentityEvidenceCommand,
  devTestGameHostedIdentityEvidencePath,
  hostedIdentityEvidenceCheckIds,
  hostedIdentityEvidenceHandoffCase,
  hostedIdentityEvidencePlaceholderFixturePath,
  hostedIdentityEvidencePlaceholderSchema,
  hostedIdentityEvidenceRequirementGroupDefinitions,
  hostedIdentityEvidenceRequirementGroups,
  requiredHostedIdentityEvidenceForCheck,
} from "./dev_test_game_hosted_identity_evidence_cases.mjs";

export const DEV_TEST_GAME_HOSTED_IDENTITY_EVIDENCE_VERSION = 1;

const outputPath = path.join(repoRoot, devTestGameHostedIdentityEvidencePath);

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  const evidence = await buildDevTestGameHostedIdentityEvidence({
    env: process.env,
  });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(
    `wrote ${devTestGameHostedIdentityEvidencePath} (${evidence.status})`,
  );
}

export async function buildDevTestGameHostedIdentityEvidence({
  env = process.env,
  generatedAt = new Date().toISOString(),
} = {}) {
  const rawEvidencePath = optionalEnv(env.FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH);
  const rawEvidence = await readRawHostedIdentityEvidence(rawEvidencePath);
  const source = rawEvidence.source ?? null;
  const checks = [
    {
      id: "hosted-identity-evidence-path-configured",
      status: rawEvidencePath === null ? "blocked" : "passed",
      ...(rawEvidencePath === null
        ? { requiredEvidence: "Set FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH." }
        : { evidence: rawEvidencePath }),
    },
    {
      id: "hosted-identity-evidence-readable",
      status: rawEvidence.status,
      ...(rawEvidence.evidence === undefined
        ? {}
        : { evidence: rawEvidence.evidence }),
      ...(rawEvidence.requiredEvidence === undefined
        ? {}
        : { requiredEvidence: rawEvidence.requiredEvidence }),
    },
    hostedIdentityBooleanCheck({
      source,
      field: "accountLifecycle",
      id: "hosted-account-lifecycle-evidence",
    }),
    hostedIdentityBooleanCheck({
      source,
      field: "inviteDelivery",
      id: "invite-delivery-evidence",
    }),
    hostedIdentityBooleanCheck({
      source,
      field: "accountRecovery",
      id: "account-recovery-evidence",
    }),
    hostedIdentityBooleanCheck({
      source,
      field: "abuseAndRateLimitPolicy",
      id: "abuse-and-rate-limit-evidence",
    }),
    hostedIdentityBooleanCheck({
      source,
      field: "sessionSecretPolicy",
      id: "session-secret-policy-evidence",
    }),
    hostedIdentityBooleanCheck({
      source,
      field: "hostedAuditRetentionExport",
      id: "hosted-audit-retention-export-evidence",
    }),
    {
      id: "role-surface-adapter-preserved",
      status:
        source?.hostedIdentity?.roleSurfaceArchitectureChanged === false
          ? "passed"
          : "blocked",
      requiredEvidence: requiredHostedIdentityEvidenceForCheck(
        "role-surface-adapter-preserved",
      ),
    },
    {
      id: "release-claim-boundary-carried",
      status:
        source?.releaseReady === false && source?.productionReady === false
          ? "passed"
          : "blocked",
      releaseReady: false,
      productionReady: false,
      requiredEvidence: requiredHostedIdentityEvidenceForCheck(
        "release-claim-boundary-carried",
      ),
    },
  ];
  const status = checks.every((check) => check.status === "passed")
    ? "passed"
    : "blocked";
  const requirementGroups = hostedIdentityEvidenceRequirementGroups(checks);
  const evidence = {
    version: DEV_TEST_GAME_HOSTED_IDENTITY_EVIDENCE_VERSION,
    proof: "dev-test-game-hosted-identity-evidence",
    status,
    releaseReady: false,
    productionReady: false,
    generatedAt,
    scope: "hosted-identity-evidence-handoff",
    proofBoundary:
      "Hosted identity evidence intake for the dev-test-game identity spine. Passing means a hosted identity evidence file proves account lifecycle, invite delivery, recovery, abuse/rate-limit, session-secret, and audit retention inputs while preserving the role-surface adapter; it does not prove beta readiness, release readiness, or production readiness.",
    requiredEvidence:
      "Set FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH to a hosted identity evidence JSON file and rerun this command.",
    target: {
      rawEvidencePath,
      rawEvidenceStatus: rawEvidence.status,
      placeholderFixturePath: hostedIdentityEvidencePlaceholderFixturePath,
      placeholderSchema: hostedIdentityEvidencePlaceholderSchema,
    },
    checks,
    hostedHandoffChecklist: hostedIdentityEvidenceHandoffCase({
      status: status === "passed" ? "passed" : "blocked",
      preflightStatus: status,
      blockedChecks: checks.filter((check) => check.status === "blocked"),
      requirementGroups,
    }),
    nextCommand: `npm run ${devTestGameHostedIdentityEvidenceCommand}`,
    nextProofTarget: devTestGameHostedIdentityEvidencePath,
  };
  assertDevTestGameHostedIdentityEvidence(evidence);
  return evidence;
}

export function assertDevTestGameHostedIdentityEvidence(evidence) {
  if (
    evidence?.version !== DEV_TEST_GAME_HOSTED_IDENTITY_EVIDENCE_VERSION ||
    evidence.proof !== "dev-test-game-hosted-identity-evidence" ||
    !["passed", "blocked"].includes(evidence.status) ||
    evidence.releaseReady !== false ||
    evidence.productionReady !== false ||
    evidence.scope !== "hosted-identity-evidence-handoff"
  ) {
    throw new Error("hosted identity evidence shape drifted");
  }
  const checks = new Map((evidence.checks ?? []).map((check) => [check.id, check]));
  for (const id of hostedIdentityEvidenceCheckIds) {
    if (!checks.has(id)) {
      throw new Error(`hosted identity evidence missing check: ${id}`);
    }
  }
  if (checks.get("release-claim-boundary-carried").releaseReady !== false) {
    throw new Error("hosted identity evidence made a release claim");
  }
  const allPassed = Array.from(checks.values()).every(
    (check) => check.status === "passed",
  );
  if (evidence.status === "passed" && !allPassed) {
    throw new Error("hosted identity evidence passed with blocked checks");
  }
  if (evidence.status === "blocked" && allPassed) {
    throw new Error("hosted identity evidence blocked without blocked checks");
  }
  if (
    evidence.hostedHandoffChecklist?.command !==
      `npm run ${devTestGameHostedIdentityEvidenceCommand}` ||
    evidence.hostedHandoffChecklist.proofTarget !==
      devTestGameHostedIdentityEvidencePath
  ) {
    throw new Error("hosted identity evidence handoff checklist drifted");
  }
  assertHostedIdentityEvidenceRequirementGroups(evidence);
  return evidence;
}

function assertHostedIdentityEvidenceRequirementGroups(evidence) {
  const groups = evidence.hostedHandoffChecklist?.requirementGroups;
  if (!Array.isArray(groups)) {
    throw new Error("hosted identity evidence missing requirement groups");
  }
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  for (const definition of hostedIdentityEvidenceRequirementGroupDefinitions) {
    const group = groupsById.get(definition.id);
    if (
      group === undefined ||
      group.label !== definition.label ||
      !sameStringArray(group.checkIds, definition.checkIds) ||
      !["passed", "blocked"].includes(group.status) ||
      !Array.isArray(group.blockedCheckIds)
    ) {
      throw new Error(`hosted identity evidence requirement group drifted: ${definition.id}`);
    }
  }
}

function sameStringArray(actual, expected) {
  return (
    Array.isArray(actual) &&
    Array.isArray(expected) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

async function readRawHostedIdentityEvidence(rawEvidencePath) {
  if (rawEvidencePath === null) {
    return {
      status: "blocked",
      requiredEvidence: "Set FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH.",
    };
  }
  const resolved = path.resolve(repoRoot, rawEvidencePath);
  try {
    const source = JSON.parse(await readFile(resolved, "utf8"));
    const metadata = await stat(resolved);
    const schemaErrors = validateHostedIdentityEvidencePlaceholder(source);
    if (schemaErrors.length > 0) {
      return {
        status: "blocked",
        requiredEvidence:
          `Readable hosted identity evidence JSON matching ${hostedIdentityEvidencePlaceholderFixturePath}: ${schemaErrors.join("; ")}`,
      };
    }
    return {
      status: "passed",
      source,
      evidence: {
        path: path.relative(repoRoot, resolved),
        mtime: metadata.mtime.toISOString(),
        sizeBytes: metadata.size,
      },
    };
  } catch (error) {
    return {
      status: "blocked",
      requiredEvidence: `Readable hosted identity evidence JSON: ${error.message}`,
    };
  }
}

export function validateHostedIdentityEvidencePlaceholder(source) {
  const errors = [];
  requireObject(source, "root", errors);
  if (errors.length > 0) {
    return errors;
  }
  requireConst(source.version, 1, "version", errors);
  requireConst(
    source.proof,
    "hosted-production-identity-evidence",
    "proof",
    errors,
  );
  requireBoolean(source.releaseReady, "releaseReady", errors);
  requireBoolean(source.productionReady, "productionReady", errors);
  requireObject(source.hostedIdentity, "hostedIdentity", errors);
  if (source.hostedIdentity !== null && typeof source.hostedIdentity === "object") {
    for (const field of hostedIdentityEvidencePlaceholderSchema.properties
      .hostedIdentity.required) {
      requireBoolean(source.hostedIdentity[field], `hostedIdentity.${field}`, errors);
    }
  }
  return errors;
}

function requireObject(value, field, errors) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${field} must be an object`);
  }
}

function requireConst(value, expected, field, errors) {
  if (value !== expected) {
    errors.push(`${field} must be ${JSON.stringify(expected)}`);
  }
}

function requireBoolean(value, field, errors) {
  if (typeof value !== "boolean") {
    errors.push(`${field} must be boolean`);
  }
}

function hostedIdentityBooleanCheck({ source, field, id }) {
  return {
    id,
    status: source?.hostedIdentity?.[field] === true ? "passed" : "blocked",
    requiredEvidence: requiredHostedIdentityEvidenceForCheck(id),
  };
}

function optionalEnv(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}
