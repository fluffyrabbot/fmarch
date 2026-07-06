import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  devTestGameProofGraphAdminProofPath,
} from "./dev_test_game_spine_artifact_paths.mjs";

const proofGraphClickCoverageFamilies = Object.freeze([
  Object.freeze({
    id: "proof-graph-prerequisite-destinations",
    label: "Proof graph prerequisite destinations",
    visibleRowsKey: "visibleProofGraphPrerequisiteDestinations",
    expectedArtifactsKey: "proofGraphPrerequisiteDestinationArtifacts",
    visibleArtifactsKey: "visibleProofGraphPrerequisiteDestinationArtifacts",
    rowIdForArtifact: (artifact) => String(artifact?.rowId ?? ""),
    artifactKey: (artifact) =>
      [artifact?.rowId, artifact?.proofTarget].map(normalize).join("\u0000"),
  }),
  Object.freeze({
    id: "proof-graph-core-loop-recovery-destinations",
    label: "Proof graph core-loop recovery destinations",
    visibleRowsKey: "visibleProofGraphCoreLoopRecoveryDestinations",
    expectedArtifactsKey: "coreLoopRecoveryDestinationArtifacts",
    visibleArtifactsKey:
      "visibleProofGraphCoreLoopRecoveryDestinationArtifacts",
    rowIdForArtifact: (artifact) => String(artifact?.id ?? ""),
    artifactKey: (artifact) =>
      [artifact?.id, artifact?.proofTarget].map(normalize).join("\u0000"),
  }),
  Object.freeze({
    id: "production-feature-destination-summaries",
    label: "Production feature destination summaries",
    visibleRowsKey: "visibleProductionFeatureDestinationSummaries",
    expectedArtifactsKey: "productionFeatureDestinationArtifacts",
    visibleArtifactsKey: "visibleProductionFeatureDestinationArtifacts",
    rowIdForArtifact: (artifact) => String(artifact?.rowId ?? ""),
    artifactKey: (artifact) =>
      [artifact?.rowId, artifact?.field, artifact?.artifact]
        .map(normalize)
        .join("\u0000"),
  }),
]);

export function proofGraphClickCoverageFamilyRegistry() {
  return proofGraphClickCoverageFamilies;
}

export function buildProofGraphClickCoverageInventory(proof) {
  const generatedFrom = proof?.generatedFrom ?? {};
  const adminRoleSurface = proof?.adminRoleSurface ?? {};
  const families = proofGraphClickCoverageFamilies.map((family) => {
    const visibleRows = normalizeStrings(adminRoleSurface[family.visibleRowsKey]);
    const expectedArtifacts = Array.isArray(
      generatedFrom[family.expectedArtifactsKey],
    )
      ? generatedFrom[family.expectedArtifactsKey]
      : [];
    const visibleArtifacts = Array.isArray(
      adminRoleSurface[family.visibleArtifactsKey],
    )
      ? adminRoleSurface[family.visibleArtifactsKey]
      : [];
    const visibleArtifactCounts = countValues(
      visibleArtifacts
        .filter((artifact) => artifact?.clickedThrough === true)
        .map((artifact) => family.artifactKey(artifact)),
    );
    const expectedArtifactKeys = expectedArtifacts.map((artifact) =>
      family.artifactKey(artifact),
    );
    const matchedArtifactCounts = new Map();
    const missingClickedArtifacts = expectedArtifacts.filter((artifact, index) => {
      const key = expectedArtifactKeys[index];
      const matchedCount = matchedArtifactCounts.get(key) ?? 0;
      const visibleCount = visibleArtifactCounts.get(key) ?? 0;
      if (matchedCount >= visibleCount) {
        return true;
      }
      matchedArtifactCounts.set(key, matchedCount + 1);
      return false;
    });
    const missingVisibleRowsForArtifacts = expectedArtifacts.filter(
      (artifact) => !visibleRows.includes(family.rowIdForArtifact(artifact)),
    );
    return Object.freeze({
      id: family.id,
      label: family.label,
      visibleRowsKey: family.visibleRowsKey,
      expectedArtifactsKey: family.expectedArtifactsKey,
      visibleArtifactsKey: family.visibleArtifactsKey,
      visibleRowCount: visibleRows.length,
      expectedArtifactCount: expectedArtifacts.length,
      clickedArtifactCount: visibleArtifacts.filter(
        (artifact) => artifact?.clickedThrough === true,
      ).length,
      status:
        missingClickedArtifacts.length === 0 &&
        missingVisibleRowsForArtifacts.length === 0
          ? "passed"
          : "missing-clicks",
      missingClickedArtifacts: Object.freeze(missingClickedArtifacts),
      missingVisibleRowsForArtifacts: Object.freeze(
        missingVisibleRowsForArtifacts,
      ),
    });
  });
  const missingFamilyCount = families.filter(
    (family) => family.status !== "passed",
  ).length;
  return Object.freeze({
    status: missingFamilyCount === 0 ? "passed" : "missing-clicks",
    familyCount: families.length,
    missingFamilyCount,
    families: Object.freeze(families),
  });
}

export function assertProofGraphClickCoverage(proof) {
  const inventory = buildProofGraphClickCoverageInventory(proof);
  if (inventory.status !== "passed") {
    const missing = inventory.families
      .filter((family) => family.status !== "passed")
      .map((family) => family.id)
      .join(", ");
    throw new Error(`proof graph artifact click coverage missing: ${missing}`);
  }
  return inventory;
}

function normalizeStrings(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => String(value ?? ""))
    .filter((value) => value !== "");
}

function normalize(value) {
  return String(value ?? "");
}

function countValues(values) {
  const counts = new Map();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

async function main() {
  const path = process.argv[2] ?? devTestGameProofGraphAdminProofPath;
  const proof = JSON.parse(await readFile(path, "utf8"));
  const inventory = assertProofGraphClickCoverage(proof);
  console.log(JSON.stringify(inventory, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
