import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertDevTestGameSpineManifest,
  proofFreshnessAdminProofCommand,
  spineManifestPath,
} from "./dev_test_game_spine_manifest.mjs";
import { repoRoot } from "./dev_test_game_spine_runner.mjs";
import { assertDevTestGameReleaseReadiness } from "./dev_test_game_release_readiness.mjs";

export const DEV_TEST_GAME_NEXT_ACTION_VERSION = 1;
export const devTestGameNextActionPath = "target/dev-test-game/next-action.json";
export const devTestGameReleaseReadinessPath =
  "target/dev-test-game/release-readiness-checklist.json";

const nextActionJsonPath = path.join(repoRoot, devTestGameNextActionPath);

export function buildDevTestGameNextAction(
  spineManifest,
  {
    generatedAt = new Date().toISOString(),
    spineManifestSource = spineManifestPath,
    releaseReadinessChecklist = null,
    releaseReadinessChecklistSource = devTestGameReleaseReadinessPath,
  } = {},
) {
  const manifest = assertDevTestGameSpineManifest(spineManifest);
  const readiness =
    releaseReadinessChecklist === null
      ? null
      : assertDevTestGameReleaseReadiness(releaseReadinessChecklist);
  const candidates = rankedArtifactsNeedingRefresh(manifest);
  const artifact = candidates[0]?.artifact;
  const selectionTrace = buildSelectionTrace(candidates);
  const releaseReadinessCandidates = rankedBuildableReleaseReadinessItems(readiness);
  const releaseReadinessTrace = buildReleaseReadinessTrace(releaseReadinessCandidates);
  const selectedUnproven = releaseReadinessCandidates[0];
  const nextAction =
    artifact !== undefined
      ? {
          command: artifact.nextCommand ?? artifact.refreshCommand,
          reason: "artifact-not-fresh",
          status: "blocked",
          artifact: {
            id: artifact.id,
            label: artifact.label,
            path: artifact.path,
            status: artifact.status,
            refreshSource: artifact.refreshSource,
          },
        }
      : selectedUnproven !== undefined
        ? {
            command: selectedUnproven.command,
            reason: "release-readiness-unproven",
            status: "ready",
            unproven: {
              id: selectedUnproven.item.id,
              status: selectedUnproven.item.status,
              requiredEvidence: selectedUnproven.item.requiredEvidence,
              buildSlice: selectedUnproven.buildSlice,
              proofTarget: selectedUnproven.proofTarget,
            },
          }
        : {
            command:
              manifest.artifactFreshness?.nextCommand ?? proofFreshnessAdminProofCommand,
            reason: "all-artifacts-fresh",
            status: "ready",
          };
  const releaseReadinessSummary =
    readiness === null
      ? null
      : {
          status: readiness.releaseReadiness.status,
          unprovenCount: readiness.releaseReadiness.unproven.length,
          buildableUnprovenCount: releaseReadinessCandidates.length,
        };
  const evidence = {
    version: DEV_TEST_GAME_NEXT_ACTION_VERSION,
    proof: "dev-test-game-next-action",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    generatedAt,
    scope: "local-dev-test-game-next-action",
    proofBoundary:
      "Local next-action receipt derived from the generated dev-test-game spine manifest and release-readiness checklist. It chooses the highest-priority local artifact recovery command while the development-spine is stale, otherwise it chooses a local-dev buildable slice from the current unproven release-readiness checklist; it does not validate artifact contents, hosted operations, beta readiness, release readiness, or production readiness.",
    generatedFrom: {
      spineManifest: spineManifestSource,
      manifestGeneratedAt: manifest.generatedAt,
      artifactFreshnessStatus: manifest.artifactFreshness.status,
      artifactFreshnessSummary: { ...manifest.artifactFreshness.summary },
      ...(readiness === null
        ? {}
        : {
            releaseReadinessChecklist: releaseReadinessChecklistSource,
            releaseReadinessGeneratedAt: readiness.generatedAt,
            releaseReadinessSummary,
          }),
    },
    nextAction,
    selectionTrace,
    releaseReadinessTrace,
  };
  assertDevTestGameNextAction(evidence);
  return evidence;
}

export function assertDevTestGameNextAction(evidence) {
  if (evidence?.version !== DEV_TEST_GAME_NEXT_ACTION_VERSION) {
    throw new Error(`next-action version drifted: ${evidence?.version}`);
  }
  if (evidence.proof !== "dev-test-game-next-action") {
    throw new Error(`unexpected next-action proof id: ${evidence.proof}`);
  }
  if (evidence.status !== "passed") {
    throw new Error(`next-action status is ${evidence.status}`);
  }
  if (evidence.scope !== "local-dev-test-game-next-action") {
    throw new Error(`next-action scope drifted: ${evidence.scope}`);
  }
  if (evidence.releaseReady !== false || evidence.productionReady !== false) {
    throw new Error("next-action must not claim production or release readiness");
  }
  if (typeof evidence.nextAction?.command !== "string" || evidence.nextAction.command === "") {
    throw new Error("next-action is missing a command");
  }
  if (!["ready", "blocked"].includes(evidence.nextAction.status)) {
    throw new Error(`next-action status drifted: ${evidence.nextAction.status}`);
  }
  if (
    ![
      "all-artifacts-fresh",
      "artifact-not-fresh",
      "release-readiness-unproven",
    ].includes(evidence.nextAction.reason)
  ) {
    throw new Error(`next-action reason drifted: ${evidence.nextAction.reason}`);
  }
  if (
    evidence.nextAction.reason === "artifact-not-fresh" &&
    typeof evidence.nextAction.artifact?.id !== "string"
  ) {
    throw new Error("next-action artifact recovery is missing an artifact id");
  }
  if (
    evidence.nextAction.reason === "release-readiness-unproven" &&
    typeof evidence.nextAction.unproven?.id !== "string"
  ) {
    throw new Error("next-action release-readiness recovery is missing an unproven id");
  }
  assertSelectionTrace(evidence.selectionTrace, evidence.nextAction);
  assertReleaseReadinessTrace(evidence.releaseReadinessTrace, evidence.nextAction);
  return evidence;
}

export async function writeDevTestGameNextAction({
  generatedAt = new Date().toISOString(),
  manifestPath = process.env.FMARCH_DEV_TEST_GAME_SPINE_MANIFEST ?? spineManifestPath,
} = {}) {
  const absoluteManifestPath = path.resolve(repoRoot, manifestPath);
  const absoluteReleaseReadinessPath = path.resolve(
    repoRoot,
    process.env.FMARCH_DEV_TEST_GAME_RELEASE_READINESS_CHECKLIST ??
      devTestGameReleaseReadinessPath,
  );
  const manifest = JSON.parse(await readFile(absoluteManifestPath, "utf8"));
  const releaseReadinessChecklist = JSON.parse(
    await readFile(absoluteReleaseReadinessPath, "utf8"),
  );
  const spineManifestSource = path.relative(repoRoot, absoluteManifestPath);
  const releaseReadinessChecklistSource = path.relative(
    repoRoot,
    absoluteReleaseReadinessPath,
  );
  const evidence = buildDevTestGameNextAction(manifest, {
    generatedAt,
    spineManifestSource,
    releaseReadinessChecklist,
    releaseReadinessChecklistSource,
  });
  await mkdir(path.dirname(nextActionJsonPath), { recursive: true });
  await writeFile(nextActionJsonPath, `${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

function rankedArtifactsNeedingRefresh(manifest) {
  const artifacts = (manifest.artifactFreshness?.artifacts ?? []).filter(
    (artifact) => artifact.status !== "fresh",
  );
  return artifacts
    .map((artifact, index) => ({
      artifact,
      index,
      priority: developmentSpineArtifactPriority(artifact),
      statusPriority: artifact.status === "missing" ? 0 : 1,
    }))
    .sort(
      (left, right) =>
        left.priority - right.priority ||
        left.statusPriority - right.statusPriority ||
        artifactAgeSeconds(right.artifact) - artifactAgeSeconds(left.artifact) ||
        left.index - right.index,
    );
}

function buildSelectionTrace(candidates) {
  const selectedArtifactId = candidates[0]?.artifact.id ?? null;
  return {
    strategy: "development-spine-priority",
    candidateCount: candidates.length,
    selectedArtifactId,
    candidates: candidates.map(({ artifact, priority }, index) => ({
      rank: index + 1,
      id: artifact.id,
      label: artifact.label,
      path: artifact.path,
      status: artifact.status,
      priority,
      selected: artifact.id === selectedArtifactId,
      refreshCommand: artifact.nextCommand ?? artifact.refreshCommand,
      refreshSource: artifact.refreshSource,
      ...(artifact.ageSeconds === undefined ? {} : { ageSeconds: artifact.ageSeconds }),
      ...(artifact.maxAgeSeconds === undefined
        ? {}
        : { maxAgeSeconds: artifact.maxAgeSeconds }),
    })),
  };
}

function rankedBuildableReleaseReadinessItems(readiness) {
  if (readiness === null) {
    return [];
  }
  return (readiness.releaseReadiness?.unproven ?? [])
    .map((item, index) => {
      const buildable = localBuildableReleaseReadinessItems.get(item.id);
      return buildable === undefined
        ? null
        : {
            item,
            index,
            priority: buildable.priority,
            command: buildable.command,
            buildSlice: buildable.buildSlice,
            proofTarget: buildable.proofTarget,
            proofBoundary: buildable.proofBoundary,
          };
    })
    .filter((candidate) => candidate !== null)
    .sort((left, right) => left.priority - right.priority || left.index - right.index);
}

function buildReleaseReadinessTrace(candidates) {
  const selectedUnprovenId = candidates[0]?.item.id ?? null;
  return {
    strategy: "local-dev-release-readiness-priority",
    candidateCount: candidates.length,
    selectedUnprovenId,
    candidates: candidates.map((candidate, index) => ({
      rank: index + 1,
      id: candidate.item.id,
      status: candidate.item.status,
      priority: candidate.priority,
      selected: candidate.item.id === selectedUnprovenId,
      command: candidate.command,
      buildSlice: candidate.buildSlice,
      proofTarget: candidate.proofTarget,
      proofBoundary: candidate.proofBoundary,
      requiredEvidence: candidate.item.requiredEvidence,
    })),
  };
}

function assertSelectionTrace(selectionTrace, nextAction) {
  if (
    selectionTrace?.strategy !== "development-spine-priority" ||
    !Number.isInteger(selectionTrace.candidateCount) ||
    !Array.isArray(selectionTrace.candidates)
  ) {
    throw new Error("next-action selection trace is missing or malformed");
  }
  if (selectionTrace.candidateCount !== selectionTrace.candidates.length) {
    throw new Error("next-action selection trace candidate count drifted");
  }
  if (selectionTrace.candidateCount === 0) {
    if (
      selectionTrace.selectedArtifactId !== null ||
      nextAction.reason === "artifact-not-fresh"
    ) {
      throw new Error("next-action fresh trace has a selected artifact");
    }
    return;
  }
  const [selected, ...rest] = selectionTrace.candidates;
  if (
    nextAction.reason !== "artifact-not-fresh" ||
    selected.selected !== true ||
    selected.id !== selectionTrace.selectedArtifactId ||
    nextAction.artifact?.id !== selected.id
  ) {
    throw new Error("next-action selection trace does not match selected artifact");
  }
  for (const candidate of rest) {
    if (candidate.selected === true) {
      throw new Error(`next-action selection trace has duplicate selection: ${candidate.id}`);
    }
  }
}

function assertReleaseReadinessTrace(releaseReadinessTrace, nextAction) {
  if (
    releaseReadinessTrace?.strategy !== "local-dev-release-readiness-priority" ||
    !Number.isInteger(releaseReadinessTrace.candidateCount) ||
    !Array.isArray(releaseReadinessTrace.candidates)
  ) {
    throw new Error("next-action release-readiness trace is missing or malformed");
  }
  if (releaseReadinessTrace.candidateCount !== releaseReadinessTrace.candidates.length) {
    throw new Error("next-action release-readiness trace candidate count drifted");
  }
  if (releaseReadinessTrace.candidateCount === 0) {
    if (
      releaseReadinessTrace.selectedUnprovenId !== null ||
      nextAction.reason === "release-readiness-unproven"
    ) {
      throw new Error("next-action release-readiness trace has no selected item");
    }
    return;
  }
  const [selected, ...rest] = releaseReadinessTrace.candidates;
  if (
    selected.selected !== true ||
    selected.id !== releaseReadinessTrace.selectedUnprovenId
  ) {
    throw new Error("next-action release-readiness trace does not match selection");
  }
  if (nextAction.reason === "release-readiness-unproven") {
    if (
      nextAction.unproven?.id !== selected.id ||
      nextAction.command !== selected.command
    ) {
      throw new Error("next-action release-readiness selection does not match action");
    }
  }
  for (const candidate of rest) {
    if (candidate.selected === true) {
      throw new Error(
        `next-action release-readiness trace has duplicate selection: ${candidate.id}`,
      );
    }
  }
}

function artifactAgeSeconds(artifact) {
  return typeof artifact.ageSeconds === "number" ? artifact.ageSeconds : 0;
}

function developmentSpineArtifactPriority(artifact) {
  return (
    devSpineArtifactPriorities.get(artifact.id) ??
    devSpineArtifactPriorities.get(artifact.path) ??
    (terminalArtifactIds.has(artifact.id) || terminalArtifactPaths.has(artifact.path)
      ? terminalFallbackPriority
      : unknownSpineFallbackPriority)
  );
}

const devSpineArtifactPriorities = new Map(
  [
    ["proof-run", "target/dev-test-game/proof-run.json"],
    ["session", "target/dev-test-game/session.json"],
    ["core-loop", "target/dev-test-game/core-loop-admin-proof.json"],
    ["hardening", "target/dev-test-game/hardening-admin-proof.json"],
    ["identity-adapter", "target/auth-invite-role-proof/invite-role-proof.json"],
    ["identity", "target/dev-test-game/identity-admin-proof.json"],
    ["backup-restore", "target/live-stack-backup-restore-drill/local-backup-restore-proof.json"],
    ["backup", "target/dev-test-game/backup-admin-proof.json"],
    ["ops-artifacts", "target/dev-test-game/ops-artifacts.json"],
    ["ops", "target/dev-test-game/ops-admin-proof.json"],
    ["seed-fixture", "target/dev-test-game/seed-fixture-summary.json"],
    ["seed", "target/dev-test-game/seed-admin-proof.json"],
    ["release-readiness", "target/dev-test-game/release-readiness-checklist.json"],
    ["release", "target/dev-test-game/release-admin-proof.json"],
    ["admin-spine", "target/dev-test-game/admin-spine-proof.json"],
    ["admin-spine-admin", "target/dev-test-game/admin-spine-admin-proof.json"],
    ["proof-graph", "target/dev-test-game/proof-graph.json"],
    ["proof-graph-admin", "target/dev-test-game/proof-graph-admin-proof.json"],
    ["spine-manifest", "target/dev-test-game/spine-manifest.json"],
    ["spine-manifest-admin", "target/dev-test-game/spine-manifest-admin-proof.json"],
  ].flatMap(([id, artifactPath], index) => [
    [id, index],
    [artifactPath, index],
  ]),
);

const unknownSpineFallbackPriority = 1_000;
const terminalFallbackPriority = 10_000;
const terminalArtifactIds = new Set([
  "next-action",
  "next-action-admin-proof",
  "proof-graph",
  "proof-graph-admin",
]);
const terminalArtifactPaths = new Set([
  devTestGameNextActionPath,
  "target/dev-test-game/next-action-admin-proof.json",
  "target/dev-test-game/proof-graph.json",
  "target/dev-test-game/proof-graph-admin-proof.json",
]);

const localBuildableReleaseReadinessItems = new Map([
  [
    "exhaustive-race-coverage",
    {
      priority: 0,
      command:
        "DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run test:dev-test-game-live",
      buildSlice:
        "Add the next concurrent command race lane to the seeded dev-test-game live proof.",
      proofTarget: "target/dev-test-game/proof-run.json",
      proofBoundary:
        "Local seeded-game browser/API proof only. This can expand race-matrix evidence without claiming hosted operations, beta readiness, release readiness, or production readiness.",
    },
  ],
]);

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  const evidence = await writeDevTestGameNextAction();
  console.log(`wrote ${devTestGameNextActionPath} (${evidence.nextAction.status})`);
}
