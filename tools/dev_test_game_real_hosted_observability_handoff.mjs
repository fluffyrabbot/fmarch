import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertDevTestGameHostedOpsSignals,
  devTestGameHostedOpsSignalsPath,
} from "./dev_test_game_hosted_ops_signals.mjs";
import { repoRoot } from "./dev_test_game_spine_runner.mjs";
export {
  devTestGameRealHostedObservabilityHandoffCommand,
  devTestGameRealHostedObservabilityHandoffPath,
  realHostedObservabilityBaselineEnv,
  realHostedObservabilityBlockedCheckRows,
  realHostedObservabilityEvidenceEnv,
  realHostedObservabilityHandoffCheckIds,
  realHostedObservabilityHandoffInputIds,
  realHostedObservabilityHandoffInputSectionDefinitions,
  realHostedObservabilityHandoffInputSections,
  realHostedObservabilityRequirementGroupDefinitions,
  realHostedObservabilityRequirementGroups,
  requiredRealHostedObservabilityEvidenceForCheck,
} from "./dev_test_game_real_hosted_observability_handoff_cases.mjs";
import {
  devTestGameRealHostedObservabilityHandoffCommand,
  devTestGameRealHostedObservabilityHandoffPath,
  realHostedObservabilityBaselineEnv,
  realHostedObservabilityBlockedReceipt,
  realHostedObservabilityEvidenceEnv,
  realHostedObservabilityHandoffCheckIds,
  realHostedObservabilityHandoffInputIds,
  realHostedObservabilityHandoffInputSectionDefinitions,
  realHostedObservabilityHandoffInputSections,
  realHostedObservabilityRequirementGroupDefinitions,
  realHostedObservabilityRequirementGroups,
  realHostedObservabilityHandoffCase,
  requiredRealHostedObservabilityEvidenceForCheck,
} from "./dev_test_game_real_hosted_observability_handoff_cases.mjs";

export const DEV_TEST_GAME_REAL_HOSTED_OBSERVABILITY_HANDOFF_VERSION = 1;

const outputPath = path.join(
  repoRoot,
  devTestGameRealHostedObservabilityHandoffPath,
);

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  const handoff = await buildDevTestGameRealHostedObservabilityHandoff({
    env: process.env,
  });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(handoff, null, 2)}\n`);
  console.log(
    `wrote ${devTestGameRealHostedObservabilityHandoffPath} (${handoff.status})`,
  );
}

export async function buildDevTestGameRealHostedObservabilityHandoff({
  env = process.env,
  generatedAt = new Date().toISOString(),
} = {}) {
  const baselinePath =
    optionalEnv(env[realHostedObservabilityBaselineEnv]) ??
    devTestGameHostedOpsSignalsPath;
  const hostedOpsSignals = assertDevTestGameHostedOpsSignals(
    await readJsonArtifact(baselinePath),
  );
  const rawEvidencePath = optionalEnv(env[realHostedObservabilityEvidenceEnv]);
  const rawEvidence = await readRawRealHostedObservabilityEvidence(rawEvidencePath);
  const source = rawEvidence.source ?? null;
  const checks = [
    {
      id: "local-hosted-ops-signals-baseline-carried",
      status: "passed",
      evidence: baselinePath,
      baselineScope: hostedOpsSignals.scope,
      baselineOnly: true,
    },
    {
      id: "real-hosted-observability-evidence-path-configured",
      status: rawEvidencePath === null ? "blocked" : "passed",
      ...(rawEvidencePath === null
        ? {
            requiredEvidence: requiredRealHostedObservabilityEvidenceForCheck(
              "real-hosted-observability-evidence-path-configured",
            ),
          }
        : { evidence: rawEvidencePath }),
    },
    {
      id: "real-hosted-observability-evidence-readable",
      status: rawEvidence.status,
      ...(rawEvidence.evidence === undefined
        ? {}
        : { evidence: rawEvidence.evidence }),
      ...(rawEvidence.requiredEvidence === undefined
        ? {}
        : { requiredEvidence: rawEvidence.requiredEvidence }),
    },
    hostedObservabilityBooleanCheck({
      source,
      field: "externallyReachableLogs",
      id: "externally-reachable-logs-evidence",
    }),
    hostedObservabilityBooleanCheck({
      source,
      field: "externallyReachableMetrics",
      id: "externally-reachable-metrics-evidence",
    }),
    hostedObservabilityBooleanCheck({
      source,
      field: "externallyReachableTraces",
      id: "externally-reachable-traces-evidence",
    }),
    hostedObservabilityBooleanCheck({
      source,
      field: "pagingSlo",
      id: "paging-slo-evidence",
    }),
    hostedObservabilityBooleanCheck({
      source,
      field: "incidentResponse",
      id: "incident-response-evidence",
    }),
    {
      id: "local-hosted-like-baseline-only",
      status:
        source?.hostedObservability?.localHostedLikeSignalsOnlyBaseline === true
          ? "passed"
          : "blocked",
      requiredEvidence: requiredRealHostedObservabilityEvidenceForCheck(
        "local-hosted-like-baseline-only",
      ),
      baselineOnly: true,
    },
    {
      id: "release-claim-boundary-carried",
      status:
        source?.releaseReady === false && source?.productionReady === false
          ? "passed"
          : "blocked",
      releaseReady: false,
      productionReady: false,
      requiredEvidence: requiredRealHostedObservabilityEvidenceForCheck(
        "release-claim-boundary-carried",
      ),
    },
  ];
  const status = checks.every((check) => check.status === "passed")
    ? "passed"
    : "blocked";
  const blockedChecks = checks.filter((check) => check.status === "blocked");
  const requirementGroups = realHostedObservabilityRequirementGroups(checks);
  const inputSections = realHostedObservabilityHandoffInputSections({ checks });
  const handoff = {
    version: DEV_TEST_GAME_REAL_HOSTED_OBSERVABILITY_HANDOFF_VERSION,
    proof: "dev-test-game-real-hosted-observability-handoff",
    status,
    releaseReady: false,
    productionReady: false,
    generatedAt,
    scope: "real-hosted-observability-handoff",
    proofBoundary:
      "Real hosted observability evidence intake for the dev-test-game hosted ops lane. It carries the local hosted-like ops signal bundle as baseline only, then blocks until externally reachable hosted logs, metrics, traces, paging/SLO, and incident-response evidence are attached; it does not prove beta readiness, release readiness, or production readiness.",
    requiredEvidence:
      "Set FMARCH_REAL_HOSTED_OBSERVABILITY_EVIDENCE_PATH to a real hosted observability evidence JSON file and rerun this command.",
    generatedFrom: {
      hostedOpsSignals: baselinePath,
      game: hostedOpsSignals.target.game,
      baselineScope: hostedOpsSignals.scope,
      baselineProofBoundary: hostedOpsSignals.proofBoundary,
      realHostedDeploymentStatus:
        hostedOpsSignals.target.realHostedDeploymentStatus,
    },
    target: {
      rawEvidencePath,
      rawEvidenceStatus: rawEvidence.status,
      localHostedOpsSignalsPath: baselinePath,
      localHostedLikeSignalsOnlyBaseline: true,
    },
    checks,
    hostedHandoffChecklist: realHostedObservabilityHandoffCase({
      status: status === "passed" ? "passed" : "blocked",
      preflightStatus: status,
      blockedChecks,
      requirementGroups,
      inputSections,
      blockedReceipt:
        status === "passed"
          ? null
          : realHostedObservabilityBlockedReceipt({
              missingRequiredInputs: blockedChecks.map((check) => check.id),
            }),
    }),
    nextCommand: `npm run ${devTestGameRealHostedObservabilityHandoffCommand}`,
    nextProofTarget: devTestGameRealHostedObservabilityHandoffPath,
  };
  assertDevTestGameRealHostedObservabilityHandoff(handoff);
  return handoff;
}

export function assertDevTestGameRealHostedObservabilityHandoff(handoff) {
  if (
    handoff?.version !== DEV_TEST_GAME_REAL_HOSTED_OBSERVABILITY_HANDOFF_VERSION ||
    handoff.proof !== "dev-test-game-real-hosted-observability-handoff" ||
    !["passed", "blocked"].includes(handoff.status) ||
    handoff.releaseReady !== false ||
    handoff.productionReady !== false ||
    handoff.scope !== "real-hosted-observability-handoff"
  ) {
    throw new Error("real hosted observability handoff shape drifted");
  }
  const checks = new Map((handoff.checks ?? []).map((check) => [check.id, check]));
  for (const id of realHostedObservabilityHandoffCheckIds) {
    if (!checks.has(id)) {
      throw new Error(`real hosted observability handoff missing check: ${id}`);
    }
  }
  if (checks.get("local-hosted-ops-signals-baseline-carried").status !== "passed") {
    throw new Error("real hosted observability handoff lost its local baseline");
  }
  if (checks.get("release-claim-boundary-carried").releaseReady !== false) {
    throw new Error("real hosted observability handoff made a release claim");
  }
  const allPassed = Array.from(checks.values()).every(
    (check) => check.status === "passed",
  );
  if (handoff.status === "passed" && !allPassed) {
    throw new Error("real hosted observability handoff passed with blocked checks");
  }
  if (handoff.status === "blocked" && allPassed) {
    throw new Error("real hosted observability handoff blocked without blocked checks");
  }
  if (
    handoff.hostedHandoffChecklist?.command !==
      `npm run ${devTestGameRealHostedObservabilityHandoffCommand}` ||
    handoff.hostedHandoffChecklist.proofTarget !==
      devTestGameRealHostedObservabilityHandoffPath
  ) {
    throw new Error("real hosted observability handoff checklist drifted");
  }
  assertRealHostedObservabilityRequirementGroups(handoff);
  assertRealHostedObservabilityInputSections(handoff);
  return handoff;
}

function assertRealHostedObservabilityRequirementGroups(handoff) {
  const groups = handoff.hostedHandoffChecklist?.requirementGroups;
  if (!Array.isArray(groups)) {
    throw new Error("real hosted observability handoff missing requirement groups");
  }
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  for (const definition of realHostedObservabilityRequirementGroupDefinitions) {
    const group = groupsById.get(definition.id);
    if (
      group === undefined ||
      group.label !== definition.label ||
      !sameStringArray(group.checkIds, definition.checkIds) ||
      !["passed", "blocked"].includes(group.status) ||
      !Array.isArray(group.blockedCheckIds)
    ) {
      throw new Error(
        `real hosted observability requirement group drifted: ${definition.id}`,
      );
    }
  }
}

function assertRealHostedObservabilityInputSections(handoff) {
  const sections = handoff.hostedHandoffChecklist?.inputSections;
  if (!Array.isArray(sections)) {
    throw new Error("real hosted observability handoff missing input sections");
  }
  const sectionsById = new Map(sections.map((section) => [section.id, section]));
  for (const definition of realHostedObservabilityHandoffInputSectionDefinitions) {
    const section = sectionsById.get(definition.id);
    if (
      section === undefined ||
      section.label !== definition.label ||
      !["provided", "missing"].includes(section.status) ||
      !sameStringArray(section.requiredInputIds, definition.requiredInputIds) ||
      !Array.isArray(section.providedInputIds) ||
      !Array.isArray(section.missingInputs)
    ) {
      throw new Error(
        `real hosted observability input section drifted: ${definition.id}`,
      );
    }
  }
}

function hostedObservabilityBooleanCheck({ source, field, id }) {
  return {
    id,
    status: source?.hostedObservability?.[field] === true ? "passed" : "blocked",
    requiredEvidence: requiredRealHostedObservabilityEvidenceForCheck(id),
  };
}

async function readRawRealHostedObservabilityEvidence(rawEvidencePath) {
  if (rawEvidencePath === null) {
    return {
      status: "blocked",
      requiredEvidence: `Set ${realHostedObservabilityEvidenceEnv}.`,
    };
  }
  const resolved = path.resolve(repoRoot, rawEvidencePath);
  try {
    const source = JSON.parse(await readFile(resolved, "utf8"));
    const metadata = await stat(resolved);
    const schemaErrors = validateRealHostedObservabilityEvidence(source);
    if (schemaErrors.length > 0) {
      return {
        status: "blocked",
        requiredEvidence:
          `Readable real hosted observability evidence JSON with hosted logs, metrics, traces, paging/SLO, incident response, and baseline boundary: ${schemaErrors.join("; ")}`,
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
      requiredEvidence:
        `Readable real hosted observability evidence JSON at ${rawEvidencePath}: ${error.message}`,
    };
  }
}

function validateRealHostedObservabilityEvidence(source) {
  const errors = [];
  if (source?.version !== 1) {
    errors.push("version must be 1");
  }
  if (source?.proof !== "real-hosted-observability-evidence") {
    errors.push("proof must be real-hosted-observability-evidence");
  }
  if (source?.releaseReady !== false || source?.productionReady !== false) {
    errors.push("releaseReady and productionReady must be false");
  }
  const hosted = source?.hostedObservability;
  if (hosted === null || typeof hosted !== "object") {
    errors.push("hostedObservability object is required");
    return errors;
  }
  for (const field of [
    "externallyReachableLogs",
    "externallyReachableMetrics",
    "externallyReachableTraces",
    "pagingSlo",
    "incidentResponse",
    "localHostedLikeSignalsOnlyBaseline",
  ]) {
    if (hosted[field] !== true) {
      errors.push(`hostedObservability.${field} must be true`);
    }
  }
  return errors;
}

async function readJsonArtifact(filePath) {
  return JSON.parse(await readFile(path.resolve(repoRoot, filePath), "utf8"));
}

function optionalEnv(value) {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function sameStringArray(actual, expected) {
  return (
    Array.isArray(actual) &&
    Array.isArray(expected) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}
