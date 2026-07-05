import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertDevTestGameHostedEvidenceLane,
  runDevTestGameHostedEvidenceLane,
} from "./dev_test_game_hosted_evidence_lane.mjs";
import {
  hostedEvidenceLaneAdminProofCase,
} from "./dev_test_game_hosted_evidence_lane_admin_proof.mjs";
export {
  assertHostedEvidenceLaneOperatorFixtureAdminProof,
  devTestGameHostedEvidenceLaneOperatorFixtureAdminProofCommand,
  devTestGameHostedEvidenceLaneOperatorFixtureAdminProofPath,
  devTestGameHostedEvidenceLaneOperatorFixturePath,
} from "./dev_test_game_hosted_evidence_lane_operator_fixture_cases.mjs";
import {
  assertHostedEvidenceLaneOperatorFixtureAdminProof,
  devTestGameHostedEvidenceLaneOperatorFixtureAdminProofPath,
  devTestGameHostedEvidenceLaneOperatorFixturePath,
} from "./dev_test_game_hosted_evidence_lane_operator_fixture_cases.mjs";
import {
  devTestGameHostedMatrixRawEvidenceFixtureProofPath,
  devTestGameHostedMatrixRawEvidenceOperatorFixturePath,
  writeDevTestGameHostedMatrixRawEvidenceFixtureProof,
} from "./dev_test_game_hosted_matrix_raw_evidence_fixture_proof.mjs";
import {
  readJson,
  repoRoot,
  runAdminAuditProof,
} from "./dev_test_game_admin_audit_proof_helper.mjs";

const fixtureFrontendBaseUrl = "https://fmarch-demo.example.test";
const fixtureApiBaseUrl = "https://api.fmarch-demo.example.test";
const fixtureGroupId = "replacement-race-reload";

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  await runDevTestGameHostedEvidenceLaneOperatorFixtureAdminProof({
    env: process.env,
  });
  console.log(
    `wrote ${devTestGameHostedEvidenceLaneOperatorFixtureAdminProofPath}`,
  );
}

export async function runDevTestGameHostedEvidenceLaneOperatorFixtureAdminProof({
  env = process.env,
  generatedAt = new Date().toISOString(),
} = {}) {
  const rawEvidencePath =
    optionalEnv(env.FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH) ??
    devTestGameHostedMatrixRawEvidenceOperatorFixturePath;
  const frontendBaseUrl =
    optionalEnv(env.FMARCH_HOSTED_MATRIX_FRONTEND_URL) ??
    fixtureFrontendBaseUrl;
  const apiBaseUrl =
    optionalEnv(env.FMARCH_HOSTED_MATRIX_API_URL) ?? fixtureApiBaseUrl;
  const groupId = optionalEnv(env.FMARCH_HOSTED_MATRIX_GROUP_ID) ?? fixtureGroupId;
  await writeDevTestGameHostedMatrixRawEvidenceFixtureProof({
    env: {
      ...env,
      FMARCH_HOSTED_MATRIX_FRONTEND_URL: frontendBaseUrl,
      FMARCH_HOSTED_MATRIX_API_URL: apiBaseUrl,
      FMARCH_HOSTED_MATRIX_GROUP_ID: groupId,
      FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH: rawEvidencePath,
    },
    generatedAt,
  });
  const lane = assertDevTestGameHostedEvidenceLane(
    await runDevTestGameHostedEvidenceLane({
      generatedAt,
      env: {
        ...env,
        FMARCH_HOSTED_MATRIX_FRONTEND_URL: frontendBaseUrl,
        FMARCH_HOSTED_MATRIX_API_URL: apiBaseUrl,
        FMARCH_HOSTED_MATRIX_GROUP_ID: groupId,
        FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH: rawEvidencePath,
      },
    }),
  );
  assertOperatorFixtureLane(lane);
  await writeJson(devTestGameHostedEvidenceLaneOperatorFixturePath, lane);
  const evidencePath = path.join(
    repoRoot,
    devTestGameHostedEvidenceLaneOperatorFixtureAdminProofPath,
  );
  await runAdminAuditProof(
    hostedEvidenceLaneAdminProofCase({
      lanePath: path.join(repoRoot, devTestGameHostedEvidenceLaneOperatorFixturePath),
      evidencePath,
      smokeName:
        "dev-test-game-hosted-evidence-lane-operator-fixture-admin-proof",
      stage: "hosted-evidence-lane-operator-fixture-admin-proof-listen",
      proofName:
        "dev-test-game-hosted-evidence-lane-operator-fixture-admin-proof",
      scope:
        "local-dev-test-game-hosted-evidence-lane-operator-fixture-admin-surface",
      proofBoundary:
        "Local SvelteKit admin role URL proof for the hosted evidence lane with a redacted operator fixture raw matrix packet. Proves the admin handoff moves from missing packet inputs to a readable target-matched fixture packet while keeping real hosted deployment, release readiness, and production readiness unproven.",
      generatedFromExtra: {
        rawEvidenceFixtureProof:
          devTestGameHostedMatrixRawEvidenceFixtureProofPath,
        rawEvidenceFixturePath: rawEvidencePath,
        operatorFixture: true,
        fixtureEvidence: true,
        targetMatchedFixture: true,
      },
      assertEvidence: assertHostedEvidenceLaneOperatorFixtureAdminProof,
    }),
  );
  return assertHostedEvidenceLaneOperatorFixtureAdminProof(
    await readJson(evidencePath),
  );
}

function assertOperatorFixtureLane(lane) {
  if (
    lane.status !== "blocked" ||
    lane.releaseReady !== false ||
    lane.productionReady !== false ||
    lane.preflightStatus !== "blocked" ||
    lane.target?.rawEvidenceStatus !== "passed" ||
    lane.target?.rawEvidenceFixture !== true ||
    lane.target?.rawEvidenceSyntheticExternalTarget === true ||
    !lane.blockedCheckIds.includes("raw-evidence-real-hosted-target")
  ) {
    throw new Error("hosted evidence lane operator fixture state drifted");
  }
}

async function writeJson(relativePath, value) {
  const absolutePath = path.join(repoRoot, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(value, null, 2)}\n`);
}

function optionalEnv(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}
