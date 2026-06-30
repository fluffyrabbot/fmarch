import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildDevTestGameHostedMatrixExternalEvidence,
  devTestGameHostedMatrixExternalEvidenceCommand,
  devTestGameHostedMatrixExternalEvidencePath,
} from "./dev_test_game_hosted_matrix_external_evidence.mjs";
import { devTestGameHostedConcurrentRaceMatrixPath } from "./dev_test_game_hosted_concurrent_race_matrix.mjs";
import {
  buildDevTestGameHostedTargetPreflight,
  devTestGameHostedTargetPreflightPath,
} from "./dev_test_game_hosted_target_preflight.mjs";
import { repoRoot } from "./dev_test_game_spine_runner.mjs";

export const DEV_TEST_GAME_HOSTED_EVIDENCE_LANE_VERSION = 1;
export const devTestGameHostedEvidenceLanePath =
  "target/dev-test-game/hosted-evidence-lane.json";
export const devTestGameHostedEvidenceLaneCommand =
  "test:dev-test-game-hosted-evidence-lane";

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  const evidence = await runDevTestGameHostedEvidenceLane({ env: process.env });
  console.log(`wrote ${devTestGameHostedEvidenceLanePath} (${evidence.status})`);
}

export async function runDevTestGameHostedEvidenceLane({
  env = process.env,
  generatedAt = new Date().toISOString(),
} = {}) {
  const preflight = await buildDevTestGameHostedTargetPreflight({
    env,
    generatedAt,
  });
  await writeJson(devTestGameHostedTargetPreflightPath, preflight);
  if (preflight.status === "blocked") {
    const lane = buildBlockedHostedEvidenceLane({ preflight, generatedAt });
    await writeJson(devTestGameHostedEvidenceLanePath, lane);
    return lane;
  }
  const externalEvidencePath =
    optionalEnv(env.FMARCH_HOSTED_MATRIX_EVIDENCE_PATH) ??
    devTestGameHostedMatrixExternalEvidencePath;
  const [matrix, rawEvidence] = await Promise.all([
    readJson(devTestGameHostedConcurrentRaceMatrixPath),
    readJson(String(preflight.target.rawEvidencePath)),
  ]);
  const externalEvidence = buildDevTestGameHostedMatrixExternalEvidence({
    matrix,
    rawEvidence,
    generatedAt,
    frontendBaseUrl: preflight.target.frontendBaseUrl,
    apiBaseUrl: preflight.target.apiBaseUrl,
    groupId: preflight.target.groupId,
    rawEvidenceSource: preflight.target.rawEvidencePath,
  });
  await writeJson(externalEvidencePath, externalEvidence);
  const lane = buildPassedHostedEvidenceLane({
    preflight,
    externalEvidencePath,
    externalEvidence,
    generatedAt,
  });
  await writeJson(devTestGameHostedEvidenceLanePath, lane);
  return lane;
}

export function assertDevTestGameHostedEvidenceLane(evidence) {
  if (
    evidence?.version !== DEV_TEST_GAME_HOSTED_EVIDENCE_LANE_VERSION ||
    evidence.proof !== "dev-test-game-hosted-evidence-lane" ||
    !["passed", "blocked"].includes(evidence.status) ||
    evidence.releaseReady !== false ||
    evidence.productionReady !== false ||
    evidence.scope !== "hosted-evidence-lane"
  ) {
    throw new Error("hosted evidence lane shape drifted");
  }
  const checks = new Map((evidence.checks ?? []).map((check) => [check.id, check]));
  if (checks.get("hosted-target-preflight")?.status !== evidence.preflightStatus) {
    throw new Error("hosted evidence lane preflight check drifted");
  }
  if (evidence.status === "blocked") {
    if (
      evidence.preflightStatus !== "blocked" ||
      !Array.isArray(evidence.blockedCheckIds) ||
      evidence.blockedCheckIds.length === 0 ||
      evidence.nextCommand !== `npm run ${devTestGameHostedEvidenceLaneCommand}` ||
      evidence.nextProofTarget !== devTestGameHostedEvidenceLanePath
    ) {
      throw new Error("blocked hosted evidence lane drifted");
    }
  }
  if (evidence.status === "passed") {
    if (
      evidence.preflightStatus !== "passed" ||
      checks.get("external-hosted-evidence-written")?.status !== "passed" ||
      !["synthetic-demo", "real-hosted"].includes(evidence.hostedEvidence?.mode) ||
      !["passed", "unproven"].includes(
        evidence.hostedEvidence?.realHostedEvidenceStatus,
      ) ||
      evidence.nextCommand !==
        `npm run ${devTestGameHostedMatrixExternalEvidenceCommand}` ||
      !isNonEmptyString(evidence.nextProofTarget)
    ) {
      throw new Error("passed hosted evidence lane drifted");
    }
  }
  return evidence;
}

function buildBlockedHostedEvidenceLane({ preflight, generatedAt }) {
  return assertDevTestGameHostedEvidenceLane({
    version: DEV_TEST_GAME_HOSTED_EVIDENCE_LANE_VERSION,
    proof: "dev-test-game-hosted-evidence-lane",
    status: "blocked",
    releaseReady: false,
    productionReady: false,
    generatedAt,
    scope: "hosted-evidence-lane",
    proofBoundary:
      "One-command hosted evidence lane for dev-test-game. Blocked means the hosted target preflight did not have enough externally reachable target/raw evidence configuration to run external hosted matrix normalization; it does not prove hosted deployment, beta readiness, release readiness, or production readiness.",
    preflightStatus: preflight.status,
    blockedCheckIds: preflight.checks
      .filter((check) => check.status === "blocked")
      .map((check) => check.id),
    target: { ...preflight.target },
    hostedEvidence: {
      status: "blocked",
      mode: "blocked",
      syntheticExternalTarget: false,
      realHostedEvidenceStatus: "unproven",
      requiredEvidence:
        "Passed hosted target preflight and normalized hosted matrix evidence.",
    },
    checks: [
      {
        id: "hosted-target-preflight",
        status: preflight.status,
      },
      ...preflight.checks.map((check) => ({
        id: check.id,
        status: check.status,
      })),
    ],
    generatedFrom: {
      hostedTargetPreflight: devTestGameHostedTargetPreflightPath,
    },
    nextCommand: `npm run ${devTestGameHostedEvidenceLaneCommand}`,
    nextProofTarget: devTestGameHostedEvidenceLanePath,
  });
}

function buildPassedHostedEvidenceLane({
  preflight,
  externalEvidencePath,
  externalEvidence,
  generatedAt,
}) {
  const syntheticExternalTarget =
    preflight.target?.rawEvidenceSyntheticExternalTarget === true ||
    externalEvidence.generatedFrom?.rawEvidenceSyntheticExternalTarget === true;
  const hostedEvidenceMode = syntheticExternalTarget
    ? "synthetic-demo"
    : "real-hosted";
  const realHostedEvidenceStatus = syntheticExternalTarget ? "unproven" : "passed";
  return assertDevTestGameHostedEvidenceLane({
    version: DEV_TEST_GAME_HOSTED_EVIDENCE_LANE_VERSION,
    proof: "dev-test-game-hosted-evidence-lane",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    generatedAt,
    scope: "hosted-evidence-lane",
    proofBoundary:
      "One-command hosted evidence lane for dev-test-game. Passing means hosted target preflight passed and normalized external hosted matrix evidence was written for the configured target; it does not prove beta readiness, release readiness, production operations, or human rollback readiness.",
    preflightStatus: preflight.status,
    blockedCheckIds: [],
    target: { ...preflight.target },
    hostedEvidence: {
      status: "passed",
      mode: hostedEvidenceMode,
      syntheticExternalTarget,
      externalEvidencePath,
      externalEvidenceSourceMode: externalEvidence.sourceMode,
      realHostedEvidenceStatus,
      ...(syntheticExternalTarget
        ? {
            requiredEvidence:
              "Replace the synthetic hosted evidence lane demo with raw evidence from a real externally reachable hosted target.",
          }
        : { evidence: externalEvidencePath }),
    },
    checks: [
      {
        id: "hosted-target-preflight",
        status: preflight.status,
      },
      {
        id: "external-hosted-evidence-written",
        status: "passed",
        evidence: externalEvidencePath,
      },
      {
        id: "local-demo-pass-path",
        status: syntheticExternalTarget ? "passed" : "not_applicable",
        ...(syntheticExternalTarget ? { evidence: externalEvidencePath } : {}),
      },
      {
        id: "real-hosted-evidence-required",
        status: realHostedEvidenceStatus,
        ...(syntheticExternalTarget
          ? {
              requiredEvidence:
                "Raw hosted matrix evidence from a real externally reachable hosted target.",
            }
          : { evidence: externalEvidencePath }),
      },
      {
        id: "release-claim-boundary-carried",
        status: "passed",
        releaseReady: false,
        productionReady: false,
      },
    ],
    generatedFrom: {
      hostedTargetPreflight: devTestGameHostedTargetPreflightPath,
      hostedConcurrentRaceMatrix: devTestGameHostedConcurrentRaceMatrixPath,
      externalHostedEvidence: externalEvidencePath,
    },
    nextCommand: `npm run ${devTestGameHostedMatrixExternalEvidenceCommand}`,
    nextProofTarget: externalEvidencePath,
  });
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.resolve(repoRoot, relativePath), "utf8"));
}

async function writeJson(relativePath, value) {
  const absolutePath = path.resolve(repoRoot, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(value, null, 2)}\n`);
}

function optionalEnv(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}
