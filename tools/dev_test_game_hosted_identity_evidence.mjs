import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { repoRoot } from "./dev_test_game_spine_runner.mjs";
import {
  buildDevTestGameIdentityAdapterContractPacket,
  devTestGameIdentityAdapterContractDiff,
  devTestGameIdentityAdapterExpectedContract,
} from "./dev_test_game_identity_adapter_contract.mjs";
export {
  devTestGameHostedIdentityEvidenceCommand,
  devTestGameHostedIdentityEvidencePath,
  hostedIdentityEvidenceBlockedCheckRows,
  hostedIdentityEvidenceBlockedChecks,
  hostedIdentityEvidenceCheckIds,
  hostedIdentityEvidenceHandoffCase,
  hostedIdentityEvidenceInputIds,
  hostedIdentityEvidenceInputSectionDefinitions,
  hostedIdentityEvidenceInputSectionIds,
  hostedIdentityEvidenceInputSectionStatuses,
  hostedIdentityEvidencePacketSectionDefinitions,
  hostedIdentityEvidencePlaceholderFixturePath,
  hostedIdentityEvidencePlaceholderSchema,
  hostedIdentityEvidenceRedactedPassFixturePath,
  hostedIdentityEvidenceRequirementGroupDefinitions,
  hostedIdentityEvidenceRequirementGroups,
  hostedIdentityEvidenceSectionInputRows,
  hostedIdentityEvidenceSectionInputStatuses,
  hostedIdentityExpectedRoleSurfaceContract,
  hostedIdentityRoleSurfaceContractDiff,
  requiredHostedIdentityEvidenceForCheck,
} from "./dev_test_game_hosted_identity_evidence_cases.mjs";
import {
  devTestGameHostedIdentityEvidenceCommand,
  devTestGameHostedIdentityEvidencePath,
  hostedIdentityEvidenceCheckIds,
  hostedIdentityEvidenceHandoffCase,
  hostedIdentityEvidenceInputIds,
  hostedIdentityEvidenceInputSectionDefinitions,
  hostedIdentityEvidencePacketSectionDefinitions,
  hostedIdentityEvidencePlaceholderFixturePath,
  hostedIdentityEvidencePlaceholderSchema,
  hostedIdentityEvidenceRedactedPassFixturePath,
  hostedIdentityEvidenceRequirementGroupDefinitions,
  hostedIdentityEvidenceRequirementGroups,
  hostedIdentityExpectedRoleSurfaceContract,
  hostedIdentityRoleSurfaceContractDiff,
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
  const roleSurfaceContractDiff = hostedIdentityRoleSurfaceContractDiff(
    source?.hostedIdentity,
  );
  const identityAdapterContractComparison =
    hostedIdentityAdapterContractComparison(source?.hostedIdentity);
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
    hostedIdentityPacketSectionCheck({
      source,
      field: "accountLifecycle",
      id: "hosted-account-lifecycle-evidence",
    }),
    hostedIdentityPacketSectionCheck({
      source,
      field: "inviteDelivery",
      id: "invite-delivery-evidence",
    }),
    hostedIdentityPacketSectionCheck({
      source,
      field: "accountRecovery",
      id: "account-recovery-evidence",
    }),
    hostedIdentityPacketSectionCheck({
      source,
      field: "abuseAndRateLimitPolicy",
      id: "abuse-and-rate-limit-evidence",
    }),
    hostedIdentityPacketSectionCheck({
      source,
      field: "sessionSecretPolicy",
      id: "session-secret-policy-evidence",
    }),
    hostedIdentityPacketSectionCheck({
      source,
      field: "hostedAuditRetentionExport",
      id: "hosted-audit-retention-export-evidence",
    }),
    {
      id: "role-surface-adapter-preserved",
      status: roleSurfaceContractDiff.status,
      roleSurfaceContractDiff,
      requiredEvidence: requiredHostedIdentityEvidenceForCheck(
        "role-surface-adapter-preserved",
      ),
    },
    {
      id: "identity-adapter-contract-compatible",
      status: identityAdapterContractComparison.status,
      identityAdapterContractComparison,
      requiredEvidence: requiredHostedIdentityEvidenceForCheck(
        "identity-adapter-contract-compatible",
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
      "Hosted identity evidence intake for the dev-test-game identity spine. Passing means a redacted hosted identity intake packet contains machine-checkable account lifecycle, invite delivery, recovery, abuse/rate-limit, session-secret, and audit retention inputs while preserving the role-surface adapter; it does not prove hosted identity live traffic, beta readiness, release readiness, or production readiness.",
    requiredEvidence:
      "Set FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH to a hosted identity evidence JSON file and rerun this command.",
    target: {
      rawEvidencePath,
      rawEvidenceStatus: rawEvidence.status,
      placeholderFixturePath: hostedIdentityEvidencePlaceholderFixturePath,
      placeholderSchema: hostedIdentityEvidencePlaceholderSchema,
      expectedRoleSurfaceContract: hostedIdentityExpectedRoleSurfaceContract,
      roleSurfaceContractDiff,
      identityAdapterContractComparison,
      redactedIntakePacket: summarizeHostedIdentityRedactedIntakePacket(source),
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
  if (evidence.status === "blocked") {
    const receipt = evidence.hostedHandoffChecklist?.blockedReceipt;
    if (
      receipt?.status !== "blocked" ||
      receipt.command !== `npm run ${devTestGameHostedIdentityEvidenceCommand}` ||
      receipt.proofTarget !== devTestGameHostedIdentityEvidencePath ||
      receipt.nextProofTarget !== devTestGameHostedIdentityEvidencePath ||
      typeof receipt.operatorAction !== "string" ||
      receipt.operatorAction.length === 0 ||
      typeof receipt.localVsHostedBoundary !== "string" ||
      receipt.localVsHostedBoundary.length === 0 ||
      !Array.isArray(receipt.missingRequiredInputs) ||
      receipt.missingRequiredInputs.length === 0 ||
      !Array.isArray(receipt.requiredInputs) ||
      receipt.requiredInputs.length !== hostedIdentityEvidenceInputIds.length ||
      !validHostedIdentityFirstMissingOperatorArtifact(
        receipt.firstMissingOperatorArtifact,
      )
    ) {
      throw new Error("hosted identity evidence missing blocked receipt");
    }
  }
  const inputSections = evidence.hostedHandoffChecklist?.inputSections;
  if (!Array.isArray(inputSections)) {
    throw new Error("hosted identity evidence missing handoff input sections");
  }
  const inputSectionsById = new Map(
    inputSections.map((section) => [section.id, section]),
  );
  for (const definition of hostedIdentityEvidenceInputSectionDefinitions) {
    const section = inputSectionsById.get(definition.id);
    if (
      section === undefined ||
      section.label !== definition.label ||
      !["provided", "missing"].includes(section.status) ||
      !sameStringArray(section.requiredInputIds, definition.requiredInputIds) ||
      !Array.isArray(section.providedInputIds) ||
      !Array.isArray(section.missingInputs)
    ) {
      throw new Error(
        `hosted identity evidence handoff input section drifted: ${definition.id}`,
      );
    }
  }
  assertHostedIdentityRedactedIntakePacketSummary(evidence);
  assertHostedIdentityRoleSurfaceContractDiff(evidence);
  assertHostedIdentityAdapterContractComparison(evidence);
  assertHostedIdentityEvidenceRequirementGroups(evidence);
  return evidence;
}

function validHostedIdentityFirstMissingOperatorArtifact(artifact) {
  return (
    artifact !== null &&
    typeof artifact === "object" &&
    typeof artifact.inputId === "string" &&
    artifact.inputId.length > 0 &&
    typeof artifact.checkId === "string" &&
    artifact.checkId.length > 0 &&
    typeof artifact.sectionId === "string" &&
    artifact.sectionId.length > 0 &&
    typeof artifact.sectionLabel === "string" &&
    artifact.sectionLabel.length > 0 &&
    typeof artifact.requiredEvidence === "string" &&
    artifact.requiredEvidence.length > 0 &&
    typeof artifact.purpose === "string" &&
    artifact.purpose.length > 0 &&
    artifact.proofTarget === devTestGameHostedIdentityEvidencePath &&
    validHostedIdentityRoleSurfaceDrilldown(artifact.roleSurfaceDrilldown)
  );
}

function validHostedIdentityRoleSurfaceDrilldown(drilldown) {
  return (
    drilldown !== null &&
    typeof drilldown === "object" &&
    drilldown.localCapabilityAuditId === "local-identity-adapter" &&
    typeof drilldown.localCapabilityRoleUrl === "string" &&
    drilldown.localCapabilityRoleUrl.includes("?game=<seeded-game>") &&
    drilldown.handoffAuditId === "local-hosted-identity-evidence" &&
    typeof drilldown.handoffRoleUrl === "string" &&
    drilldown.handoffRoleUrl.includes("?game=<seeded-game>") &&
    drilldown.proofGraphNodeId === "admin-proof:hosted-identity-evidence" &&
    drilldown.productionFeatureGraphNodeId ===
      "production-feature:identity-adapter" &&
    drilldown.proofGraphEvidencePath === "target/dev-test-game/proof-graph.json"
  );
}

function assertHostedIdentityRoleSurfaceContractDiff(evidence) {
  const diff = evidence.target?.roleSurfaceContractDiff;
  const check = (evidence.checks ?? []).find(
    (candidate) => candidate.id === "role-surface-adapter-preserved",
  );
  if (
    diff === null ||
    typeof diff !== "object" ||
    !["passed", "blocked"].includes(diff.status) ||
    diff.architectureId !== hostedIdentityExpectedRoleSurfaceContract.architectureId ||
    !Array.isArray(diff.mismatches) ||
    check?.roleSurfaceContractDiff?.status !== diff.status ||
    check?.status !== diff.status
  ) {
    throw new Error("hosted identity role-surface contract diff drifted");
  }
}

function assertHostedIdentityAdapterContractComparison(evidence) {
  const comparison = evidence.target?.identityAdapterContractComparison;
  const check = (evidence.checks ?? []).find(
    (candidate) => candidate.id === "identity-adapter-contract-compatible",
  );
  if (
    comparison === null ||
    typeof comparison !== "object" ||
    !["passed", "blocked"].includes(comparison.status) ||
    comparison.localAdapterId !== devTestGameIdentityAdapterExpectedContract.adapterId ||
    (comparison.status === "passed" &&
      comparison.hostedAdapterId !==
        devTestGameIdentityAdapterExpectedContract.adapterId) ||
    !Array.isArray(comparison.mismatches) ||
    check?.identityAdapterContractComparison?.status !== comparison.status ||
    check?.status !== comparison.status
  ) {
    throw new Error("hosted identity adapter contract comparison drifted");
  }
}

function assertHostedIdentityRedactedIntakePacketSummary(evidence) {
  const summary = evidence.target?.redactedIntakePacket;
  if (summary === null || summary === undefined) {
    return;
  }
  if (
    summary.kind !== "redacted-hosted-identity-intake" ||
    !["provided", "missing"].includes(summary.status) ||
    summary.sectionCount !== hostedIdentityEvidencePacketSectionDefinitions.length ||
    summary.providedSectionCount + summary.missingSectionCount !==
      summary.sectionCount ||
    !Number.isInteger(summary.requiredInputCount) ||
    !Number.isInteger(summary.providedInputCount) ||
    !Number.isInteger(summary.missingInputCount) ||
    summary.providedInputCount + summary.missingInputCount !==
      summary.requiredInputCount ||
    !Number.isInteger(summary.redactedEvidenceRefCount) ||
    summary.rawInviteTokensIncluded !== false ||
    summary.rawSessionSecretsIncluded !== false ||
    summary.rawPasswordHashesIncluded !== false ||
    summary.rawPersonalContactIncluded !== false
  ) {
    throw new Error("hosted identity redacted intake summary drifted");
  }
  const sectionsById = new Map(
    (summary.sections ?? []).map((section) => [section.id, section]),
  );
  for (const definition of hostedIdentityEvidencePacketSectionDefinitions) {
    const section = sectionsById.get(definition.field);
    if (
          section === undefined ||
          section.label !== definition.label ||
          !["provided", "missing", "unknown"].includes(section.status) ||
          !sameStringArray(section.requiredInputIds, definition.requiredInputIds) ||
          !Array.isArray(section.providedInputIds) ||
          !Number.isInteger(section.redactedEvidenceRefCount) ||
          !Array.isArray(section.redactedEvidenceRefs) ||
          section.redactedEvidenceRefs.length !==
            section.redactedEvidenceRefCount ||
          section.redactedEvidenceRefs.some(
            (ref) => !validHostedIdentityRedactedEvidenceRef(ref, definition),
          )
    ) {
      throw new Error(
        `hosted identity redacted intake summary missing section: ${definition.field}`,
      );
    }
  }
  const sections = [...sectionsById.values()];
  const requiredInputCount = sections.reduce(
    (total, section) => total + section.requiredInputIds.length,
    0,
  );
  const providedInputCount = sections.reduce(
    (total, section) => total + section.providedInputIds.length,
    0,
  );
  const redactedEvidenceRefCount = sections.reduce(
    (total, section) => total + section.redactedEvidenceRefCount,
    0,
  );
  if (
    summary.requiredInputCount !== requiredInputCount ||
    summary.providedInputCount !== providedInputCount ||
    summary.missingInputCount !== requiredInputCount - providedInputCount ||
    summary.redactedEvidenceRefCount !== redactedEvidenceRefCount ||
    summary.providedSectionCount !==
      sections.filter((section) => section.status === "provided").length ||
    summary.missingSectionCount !==
      sections.filter((section) => section.status !== "provided").length ||
    summary.status !==
      (sections.every((section) => section.status === "provided") &&
      providedInputCount === requiredInputCount
        ? "provided"
        : "missing")
  ) {
    throw new Error("hosted identity redacted intake summary counts drifted");
  }
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
        source,
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
  requireConst(source.releaseReady, false, "releaseReady", errors);
  requireConst(source.productionReady, false, "productionReady", errors);
  requireObject(source.redaction, "redaction", errors);
  if (source.redaction !== null && typeof source.redaction === "object") {
    requireConst(
      source.redaction.packetKind,
      "redacted-hosted-identity-intake",
      "redaction.packetKind",
      errors,
    );
    for (const field of [
      "rawInviteTokensIncluded",
      "rawSessionSecretsIncluded",
      "rawPasswordHashesIncluded",
      "rawPersonalContactIncluded",
    ]) {
      requireConst(source.redaction[field], false, `redaction.${field}`, errors);
    }
  }
  requireObject(source.hostedIdentity, "hostedIdentity", errors);
  if (source.hostedIdentity !== null && typeof source.hostedIdentity === "object") {
    for (const field of hostedIdentityEvidencePlaceholderSchema.properties
      .hostedIdentity.required) {
      if (field === "roleSurfaceArchitectureChanged") {
        requireBoolean(
          source.hostedIdentity[field],
          `hostedIdentity.${field}`,
          errors,
        );
      } else if (field === "roleSurfaceContract") {
        requireObject(
          source.hostedIdentity[field],
          `hostedIdentity.${field}`,
          errors,
        );
      } else if (field === "identityAdapterContract") {
        requireObject(
          source.hostedIdentity[field],
          `hostedIdentity.${field}`,
          errors,
        );
      } else {
        requireObject(
          source.hostedIdentity[field],
          `hostedIdentity.${field}`,
          errors,
        );
        validateHostedIdentityPacketSectionShape({
          section: source.hostedIdentity[field],
          field: `hostedIdentity.${field}`,
          errors,
        });
      }
    }
    const diff = hostedIdentityRoleSurfaceContractDiff(source.hostedIdentity);
    for (const mismatch of diff.mismatches) {
      errors.push(
        `${mismatch.path} must match ${hostedIdentityExpectedRoleSurfaceContract.architectureId}`,
      );
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

function requireArray(value, field, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${field} must be an array`);
  }
}

function validateHostedIdentityPacketSectionShape({ section, field, errors }) {
  if (section === null || typeof section !== "object" || Array.isArray(section)) {
    return;
  }
  if (!["provided", "missing"].includes(section.status)) {
    errors.push(`${field}.status must be provided or missing`);
  }
  requireObject(section.inputs, `${field}.inputs`, errors);
  requireArray(section.redactedEvidenceRefs, `${field}.redactedEvidenceRefs`, errors);
  const sourceField = field.replace(/^hostedIdentity\./, "");
  const definition = hostedIdentityEvidencePacketSectionDefinitions.find(
    (candidate) => candidate.field === sourceField,
  );
  if (Array.isArray(section.redactedEvidenceRefs)) {
    section.redactedEvidenceRefs.forEach((ref, index) => {
      validateHostedIdentityRedactedEvidenceRefShape({
        ref,
        field: `${field}.redactedEvidenceRefs[${index}]`,
        expectedFamily: definition?.evidenceFamily,
        errors,
      });
    });
  }
}

function hostedIdentityAdapterContractComparison(hostedIdentity) {
  const local = buildDevTestGameIdentityAdapterContractPacket();
  const hosted =
    hostedIdentity !== null &&
    typeof hostedIdentity === "object" &&
    !Array.isArray(hostedIdentity)
      ? hostedIdentity.identityAdapterContract
      : null;
  const diff = devTestGameIdentityAdapterContractDiff(hosted);
  const roleSurfaceContractDiff = hostedIdentityRoleSurfaceContractDiff({
    roleSurfaceArchitectureChanged: hosted?.roleSurfaceArchitectureChanged,
    roleSurfaceContract: hosted?.roleSurfaceContract,
  });
  const mismatches = [...diff.mismatches];
  for (const mismatch of roleSurfaceContractDiff.mismatches) {
    if (!mismatches.some((candidate) => candidate.path === mismatch.path)) {
      mismatches.push(mismatch);
    }
  }
  return {
    status:
      diff.status === "passed" && roleSurfaceContractDiff.status === "passed"
        ? "passed"
        : "blocked",
    localAdapterId: local.adapterId,
    hostedAdapterId: String(hosted?.adapterId ?? ""),
    localStatus: local.status,
    hostedStatus: String(hosted?.status ?? "missing"),
    roleSurfaceContractStatus: roleSurfaceContractDiff.status,
    local,
    hosted: hosted === null || hosted === undefined ? null : hosted,
    mismatches,
  };
}

function hostedIdentityPacketSectionCheck({ source, field, id }) {
  const section = source?.hostedIdentity?.[field];
  const missingInputs = hostedIdentityPacketSectionMissingInputs({ field, section });
  return {
    id,
    status: missingInputs.length === 0 ? "passed" : "blocked",
    requiredEvidence: requiredHostedIdentityEvidenceForCheck(id),
    ...(missingInputs.length === 0 ? {} : { missingInputs }),
  };
}

function optionalEnv(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function hostedIdentityPacketSectionMissingInputs({ field, section }) {
  const missing = [];
  const definition = hostedIdentityEvidencePacketSectionDefinitions.find(
    (candidate) => candidate.field === field,
  );
  if (section === null || typeof section !== "object" || Array.isArray(section)) {
    return [
      "section-object",
      "status-provided",
      ...(definition?.requiredInputIds ?? []),
      "redactedEvidenceRefs",
      ...redactionFlagsForSection(field),
    ];
  }
  if (section.status !== "provided") {
    missing.push("status-provided");
  }
  for (const inputId of definition?.requiredInputIds ?? []) {
    if (!hasProvidedInput(section.inputs?.[inputId])) {
      missing.push(inputId);
    }
  }
  const redactedEvidenceRefs = Array.isArray(section.redactedEvidenceRefs)
    ? section.redactedEvidenceRefs
    : [];
  if (redactedEvidenceRefs.length === 0) {
    missing.push("redactedEvidenceRefs");
  }
  for (const [index, ref] of redactedEvidenceRefs.entries()) {
    if (!validHostedIdentityRedactedEvidenceRef(ref, definition)) {
      missing.push(`redactedEvidenceRefs[${index}]`);
    }
  }
  for (const flag of redactionFlagsForSection(field)) {
    if (section[flag] !== false) {
      missing.push(flag);
    }
  }
  return missing;
}

function hasProvidedInput(value) {
  if (typeof value === "boolean") {
    return value === true;
  }
  if (typeof value === "string") {
    return value.trim() !== "";
  }
  if (Array.isArray(value)) {
    return value.length > 0 && value.every(hasProvidedInput);
  }
  if (value !== null && typeof value === "object") {
    return Object.keys(value).length > 0;
  }
  return false;
}

function redactionFlagsForSection(field) {
  if (field === "inviteDelivery") {
    return ["rawInviteTokensIncluded"];
  }
  if (field === "sessionSecretPolicy") {
    return ["rawSessionSecretsIncluded"];
  }
  return [];
}

function validateHostedIdentityRedactedEvidenceRefShape({
  ref,
  field,
  expectedFamily,
  errors,
}) {
  if (ref === null || typeof ref !== "object" || Array.isArray(ref)) {
    errors.push(`${field} must be an object`);
    return;
  }
  for (const key of [
    "id",
    "kind",
    "evidenceFamily",
    "capturedAt",
    "locator",
    "retentionWindow",
    "exportLocator",
  ]) {
    if (String(ref[key] ?? "").trim() === "") {
      errors.push(`${field}.${key} must be a non-empty string`);
    }
  }
  if (expectedFamily !== undefined && ref.evidenceFamily !== expectedFamily) {
    errors.push(`${field}.evidenceFamily must be ${expectedFamily}`);
  }
  if (!validIsoInstant(ref.capturedAt)) {
    errors.push(`${field}.capturedAt must be an ISO timestamp`);
  }
  if (!validRetentionWindow(ref.retentionWindow)) {
    errors.push(`${field}.retentionWindow must be a duration like 90d`);
  }
  if (!validRedactedIdentityEvidenceLocator(ref.locator)) {
    errors.push(`${field}.locator must be a redacted identity evidence locator`);
  }
  if (!validRedactedIdentityEvidenceLocator(ref.exportLocator)) {
    errors.push(
      `${field}.exportLocator must be a redacted identity evidence locator`,
    );
  }
  if (ref.redacted !== true) {
    errors.push(`${field}.redacted must be true`);
  }
}

function validHostedIdentityRedactedEvidenceRef(ref, definition) {
  return (
    ref !== null &&
    typeof ref === "object" &&
    !Array.isArray(ref) &&
    String(ref.id ?? "").trim() !== "" &&
    String(ref.kind ?? "").trim() !== "" &&
    ref.evidenceFamily === definition?.evidenceFamily &&
    validIsoInstant(ref.capturedAt) &&
    validRetentionWindow(ref.retentionWindow) &&
    validRedactedIdentityEvidenceLocator(ref.locator) &&
    validRedactedIdentityEvidenceLocator(ref.exportLocator) &&
    ref.redacted === true
  );
}

function validIsoInstant(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return false;
  }
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function validRetentionWindow(value) {
  return typeof value === "string" && /^[1-9][0-9]*d$/.test(value);
}

function validRedactedIdentityEvidenceLocator(value) {
  return (
    typeof value === "string" &&
    /^s3:\/\/redacted\/fmarch\/identity\/[A-Za-z0-9._/-]+\.json$/.test(value)
  );
}

function summarizeHostedIdentityRedactedIntakePacket(source) {
  const packetSource =
    source !== null && typeof source === "object" && !Array.isArray(source)
      ? source
      : null;
  const sections = hostedIdentityEvidencePacketSectionDefinitions.map((definition) => {
    const section = packetSource?.hostedIdentity?.[definition.field];
    const inputs =
      section !== null && typeof section === "object" && !Array.isArray(section)
        ? section.inputs
        : null;
    return {
      id: definition.field,
      checkId: definition.checkId,
      label: definition.label,
      status:
        section !== null &&
        typeof section === "object" &&
        ["provided", "missing"].includes(section.status)
          ? section.status
          : "missing",
      requiredInputIds: [...definition.requiredInputIds],
      providedInputIds: (definition.requiredInputIds ?? []).filter((inputId) =>
        hasProvidedInput(inputs?.[inputId]),
      ),
      redactedEvidenceRefCount: Array.isArray(section?.redactedEvidenceRefs)
        ? section.redactedEvidenceRefs.length
        : 0,
      redactedEvidenceRefs: Object.freeze(
        (Array.isArray(section?.redactedEvidenceRefs)
          ? section.redactedEvidenceRefs
          : []
        ).map((ref) => ({
          id: String(ref?.id ?? ""),
          kind: String(ref?.kind ?? ""),
          evidenceFamily: String(ref?.evidenceFamily ?? ""),
          capturedAt: String(ref?.capturedAt ?? ""),
          retentionWindow: String(ref?.retentionWindow ?? ""),
          locator: String(ref?.locator ?? ""),
          exportLocator: String(ref?.exportLocator ?? ""),
          redacted: ref?.redacted === true,
        })),
      ),
      missingInputs: hostedIdentityPacketSectionMissingInputs({
        field: definition.field,
        section,
      }),
    };
  });
  const requiredInputCount = sections.reduce(
    (total, section) => total + section.requiredInputIds.length,
    0,
  );
  const providedInputCount = sections.reduce(
    (total, section) => total + section.providedInputIds.length,
    0,
  );
  return {
    kind: String(
      packetSource?.redaction?.packetKind ?? "redacted-hosted-identity-intake",
    ),
    status:
      sections.every((section) => section.status === "provided") &&
      providedInputCount === requiredInputCount
        ? "provided"
        : "missing",
    sectionCount: sections.length,
    providedSectionCount: sections.filter(
      (section) => section.status === "provided",
    ).length,
    missingSectionCount: sections.filter(
      (section) => section.status !== "provided",
    ).length,
    requiredInputCount,
    providedInputCount,
    missingInputCount: requiredInputCount - providedInputCount,
    redactedEvidenceRefCount: sections.reduce(
      (total, section) => total + section.redactedEvidenceRefCount,
      0,
    ),
    rawInviteTokensIncluded:
      packetSource?.redaction?.rawInviteTokensIncluded === true,
    rawSessionSecretsIncluded:
      packetSource?.redaction?.rawSessionSecretsIncluded === true,
    rawPasswordHashesIncluded:
      packetSource?.redaction?.rawPasswordHashesIncluded === true,
    rawPersonalContactIncluded:
      packetSource?.redaction?.rawPersonalContactIncluded === true,
    roleSurfaceArchitectureChanged:
      packetSource?.hostedIdentity?.roleSurfaceArchitectureChanged === true,
    sections,
  };
}
