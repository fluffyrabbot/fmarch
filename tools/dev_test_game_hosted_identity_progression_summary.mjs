import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { repoRoot } from "./dev_test_game_spine_runner.mjs";
import {
  devTestGameHostedIdentityProgressionAdminProofCommand,
  devTestGameHostedIdentityProgressionSummaryCommand,
  devTestGameHostedIdentityProgressionSummaryPath,
  hostedIdentityEvidenceFamilyProgressionCases,
  hostedIdentityEvidenceProgressionAdminProofPath,
  hostedIdentityEvidenceProgressionPath,
  hostedIdentityEvidenceRoleSurfaceDrilldown,
} from "./dev_test_game_hosted_identity_evidence_cases.mjs";

export const DEV_TEST_GAME_HOSTED_IDENTITY_PROGRESSION_SUMMARY_VERSION = 1;

const outputPath = path.join(
  repoRoot,
  devTestGameHostedIdentityProgressionSummaryPath,
);

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  const summary = buildDevTestGameHostedIdentityProgressionSummary();
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(
    `wrote ${devTestGameHostedIdentityProgressionSummaryPath} (${summary.progressionCount} progressions)`,
  );
}

export function buildDevTestGameHostedIdentityProgressionSummary({
  generatedAt = new Date().toISOString(),
} = {}) {
  const progressions = hostedIdentityEvidenceFamilyProgressionCases.map(
    hostedIdentityEvidenceProgressionSummaryRow,
  );
  const summary = {
    version: DEV_TEST_GAME_HOSTED_IDENTITY_PROGRESSION_SUMMARY_VERSION,
    proof: "dev-test-game-hosted-identity-progression-summary",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    generatedAt,
    scope: "hosted-identity-evidence-family-progression-summary",
    proofBoundary:
      "Fixture-backed local summary of hosted identity evidence-family progression rows. Passing means every shared progression case names its missing fixture, recovered fixture, proof command, role URL, and admin proof target; it does not prove hosted identity traffic, release readiness, or production readiness.",
    sourceCaseCount: hostedIdentityEvidenceFamilyProgressionCases.length,
    progressionCount: progressions.length,
    progressions,
    nextCommand: `npm run ${devTestGameHostedIdentityProgressionSummaryCommand}`,
    nextProofTarget: devTestGameHostedIdentityProgressionSummaryPath,
  };
  assertDevTestGameHostedIdentityProgressionSummary(summary);
  return summary;
}

export function assertDevTestGameHostedIdentityProgressionSummary(summary) {
  if (
    summary?.version !==
      DEV_TEST_GAME_HOSTED_IDENTITY_PROGRESSION_SUMMARY_VERSION ||
    summary.proof !== "dev-test-game-hosted-identity-progression-summary" ||
    summary.status !== "passed" ||
    summary.releaseReady !== false ||
    summary.productionReady !== false ||
    summary.scope !== "hosted-identity-evidence-family-progression-summary" ||
    summary.sourceCaseCount !== hostedIdentityEvidenceFamilyProgressionCases.length ||
    summary.progressionCount !== hostedIdentityEvidenceFamilyProgressionCases.length ||
    summary.nextCommand !==
      `npm run ${devTestGameHostedIdentityProgressionSummaryCommand}` ||
    summary.nextProofTarget !== devTestGameHostedIdentityProgressionSummaryPath
  ) {
    throw new Error("hosted identity progression summary shape drifted");
  }
  const rows = summary.progressions;
  if (!Array.isArray(rows) || rows.length !== summary.progressionCount) {
    throw new Error("hosted identity progression summary rows drifted");
  }
  for (const [index, progression] of
    hostedIdentityEvidenceFamilyProgressionCases.entries()) {
    const actual = rows[index];
    const expected = hostedIdentityEvidenceProgressionSummaryRow(progression);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(
        `hosted identity progression summary row drifted: ${progression.id}`,
      );
    }
  }
  return summary;
}

function hostedIdentityEvidenceProgressionSummaryRow(progression) {
  return {
    id: progression.id,
    field: progression.field,
    checkId: progression.checkId,
    missingInputId: progression.missingInputId,
    adminProofMode: progression.adminProofMode,
    missingFixturePath: progression.missingFixturePath,
    recoveredFixturePath: progression.recoveredFixturePath,
    adminProofFixturePath: progression.adminProofFixturePath,
    proofCommand: `FMARCH_HOSTED_IDENTITY_PROGRESSION_ID=${progression.id} npm run ${devTestGameHostedIdentityProgressionAdminProofCommand}`,
    evidencePath: hostedIdentityEvidenceProgressionPath(progression.id),
    adminProofTarget: hostedIdentityEvidenceProgressionAdminProofPath(
      progression.id,
    ),
    roleUrl: hostedIdentityEvidenceRoleSurfaceDrilldown.handoffRoleUrl,
    firstMissingInputId: progression.missingInputId,
    firstMissingCheckId: progression.checkId,
    expectedMissingInputs: [...progression.expectedMissingInputs],
    recoveredProvidedInputIds: [...progression.recoveredProvidedInputIds],
    recoveredRedactedEvidenceRefIds: [
      ...progression.recoveredRedactedEvidenceRefIds,
    ],
    proofBoundary:
      progression.adminProofMode === "provided-family-still-blocked"
        ? "Fixture-backed local admin browser proof target for one hosted identity evidence-family progression row. It proves the admin handoff can surface the named provided redacted packet while the overall hosted identity evidence stays blocked; it does not prove hosted identity traffic, release readiness, or production readiness."
        : "Fixture-backed local admin browser proof target for one hosted identity evidence-family progression row. It proves the admin handoff can surface the named missing artifact; it does not prove hosted identity traffic, release readiness, or production readiness.",
  };
}
