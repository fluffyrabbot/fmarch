import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertDevTestGameHostedMatrixRawEvidence,
  defaultHostedMatrixRawGroupId,
  hostedMatrixRawEvidenceContract,
  hostedMatrixRawEvidenceContractSummary,
} from "./dev_test_game_hosted_matrix_raw_evidence.mjs";
import { repoRoot } from "./dev_test_game_spine_runner.mjs";

export const devTestGameHostedMatrixRawEvidenceOperatorFixturePath =
  "tools/fixtures/dev_test_game_hosted_matrix_raw_evidence.operator-fixture.json";
export const devTestGameHostedMatrixRawEvidenceFixtureProofPath =
  "target/dev-test-game/hosted-matrix-raw-evidence-fixture-proof.json";
export const devTestGameHostedMatrixRawEvidenceFixtureProofCommand =
  "test:dev-test-game-hosted-matrix-raw-evidence-fixture-proof";

const defaultFixtureFrontendBaseUrl = "https://fmarch-demo.example.test";
const defaultFixtureApiBaseUrl = "https://api.fmarch-demo.example.test";

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  const proof = await writeDevTestGameHostedMatrixRawEvidenceFixtureProof({
    env: process.env,
  });
  console.log(
    `wrote ${devTestGameHostedMatrixRawEvidenceFixtureProofPath} (${proof.status})`,
  );
}

export async function writeDevTestGameHostedMatrixRawEvidenceFixtureProof({
  env = process.env,
  generatedAt = new Date().toISOString(),
} = {}) {
  const proof = await buildDevTestGameHostedMatrixRawEvidenceFixtureProof({
    env,
    generatedAt,
  });
  const outputPath = path.join(
    repoRoot,
    devTestGameHostedMatrixRawEvidenceFixtureProofPath,
  );
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(proof, null, 2)}\n`);
  return proof;
}

export async function buildDevTestGameHostedMatrixRawEvidenceFixtureProof({
  env = process.env,
  generatedAt = new Date().toISOString(),
} = {}) {
  const rawEvidencePath =
    optionalEnv(env.FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH) ??
    devTestGameHostedMatrixRawEvidenceOperatorFixturePath;
  const frontendBaseUrl =
    optionalEnv(env.FMARCH_HOSTED_MATRIX_FRONTEND_URL) ??
    defaultFixtureFrontendBaseUrl;
  const apiBaseUrl =
    optionalEnv(env.FMARCH_HOSTED_MATRIX_API_URL) ??
    defaultFixtureApiBaseUrl;
  const groupId =
    optionalEnv(env.FMARCH_HOSTED_MATRIX_GROUP_ID) ??
    defaultHostedMatrixRawGroupId;
  const resolvedRawEvidencePath = path.resolve(repoRoot, rawEvidencePath);
  const rawEvidence = JSON.parse(await readFile(resolvedRawEvidencePath, "utf8"));
  assertDevTestGameHostedMatrixRawEvidence(rawEvidence, {
    frontendBaseUrl,
    apiBaseUrl,
    groupId,
  });
  if (
    rawEvidence.generatedFrom?.fixtureEvidence !== true ||
    rawEvidence.generatedFrom?.operatorFixture !== true
  ) {
    throw new Error(
      "hosted matrix raw evidence fixture proof requires fixtureEvidence=true and operatorFixture=true",
    );
  }
  const metadata = await stat(resolvedRawEvidencePath);
  return assertDevTestGameHostedMatrixRawEvidenceFixtureProof({
    version: 1,
    proof: "dev-test-game-hosted-matrix-raw-evidence-fixture-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    generatedAt,
    scope: "local-dev-test-game-hosted-matrix-raw-evidence-fixture-proof",
    proofBoundary:
      "Local validator proof for the redacted raw hosted-matrix operator fixture. Passing means the fixture packet matches FMARCH_HOSTED_MATRIX_FRONTEND_URL, FMARCH_HOSTED_MATRIX_API_URL, and FMARCH_HOSTED_MATRIX_GROUP_ID and carries the raw hosted matrix evidence contract; it does not prove real hosted deployment, release readiness, or production readiness.",
    generatedFrom: {
      rawEvidencePath: path.relative(repoRoot, resolvedRawEvidencePath),
      rawEvidenceGeneratedAt: rawEvidence.generatedAt,
      rawEvidenceContract: hostedMatrixRawEvidenceContract,
      rawEvidenceContractSummary: hostedMatrixRawEvidenceContractSummary(),
      fixtureEvidence: true,
      operatorFixture: true,
    },
    target: {
      frontendBaseUrl,
      apiBaseUrl,
      groupId,
      rawEvidencePath: path.relative(repoRoot, resolvedRawEvidencePath),
    },
    checks: [
      {
        id: "raw-evidence-readable",
        status: "passed",
        evidence: {
          path: path.relative(repoRoot, resolvedRawEvidencePath),
          mtime: metadata.mtime.toISOString(),
          sizeBytes: metadata.size,
        },
      },
      {
        id: "raw-evidence-target-matches-env",
        status: "passed",
        evidence: [frontendBaseUrl, apiBaseUrl, groupId],
      },
      {
        id: "raw-evidence-fixture-boundary",
        status: "passed",
        fixtureEvidence: true,
        requiredEvidence:
          "Replace this redacted fixture packet with raw evidence captured from a real externally reachable hosted target before claiming hosted deployment.",
      },
      {
        id: "release-claim-boundary-carried",
        status: "passed",
        releaseReady: false,
        productionReady: false,
      },
    ],
  });
}

export function assertDevTestGameHostedMatrixRawEvidenceFixtureProof(proof) {
  if (
    proof?.version !== 1 ||
    proof.proof !== "dev-test-game-hosted-matrix-raw-evidence-fixture-proof" ||
    proof.status !== "passed" ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.scope !== "local-dev-test-game-hosted-matrix-raw-evidence-fixture-proof" ||
    proof.generatedFrom?.fixtureEvidence !== true ||
    proof.generatedFrom?.operatorFixture !== true ||
    proof.generatedFrom?.rawEvidenceContract?.proof !==
      hostedMatrixRawEvidenceContract.proof ||
    proof.generatedFrom?.rawEvidenceContractSummary !==
      hostedMatrixRawEvidenceContractSummary() ||
    !Array.isArray(proof.checks) ||
    proof.checks.length !== 4
  ) {
    throw new Error("hosted matrix raw evidence fixture proof shape drifted");
  }
  const checks = new Map(proof.checks.map((check) => [check.id, check]));
  for (const id of [
    "raw-evidence-readable",
    "raw-evidence-target-matches-env",
    "raw-evidence-fixture-boundary",
    "release-claim-boundary-carried",
  ]) {
    if (checks.get(id)?.status !== "passed") {
      throw new Error(`hosted matrix raw evidence fixture proof missing ${id}`);
    }
  }
  if (
    checks.get("raw-evidence-fixture-boundary")?.fixtureEvidence !== true ||
    checks.get("release-claim-boundary-carried")?.releaseReady !== false ||
    checks.get("release-claim-boundary-carried")?.productionReady !== false
  ) {
    throw new Error("hosted matrix raw evidence fixture proof boundary drifted");
  }
  return proof;
}

function optionalEnv(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}
