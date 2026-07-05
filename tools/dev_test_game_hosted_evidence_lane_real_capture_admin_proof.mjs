import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertDevTestGameHostedEvidenceLane,
  runDevTestGameHostedEvidenceLane,
} from "./dev_test_game_hosted_evidence_lane.mjs";
import {
  runDevTestGameHostedEvidenceLaneDemoProof,
} from "./dev_test_game_hosted_evidence_lane_demo_proof.mjs";
import {
  hostedEvidenceLaneAdminProofCase,
} from "./dev_test_game_hosted_evidence_lane_admin_proof.mjs";
import {
  devTestGameHostedEvidenceLaneRealCaptureAdminProofPath,
  devTestGameHostedEvidenceLaneRealCaptureSourcePath,
} from "./dev_test_game_hosted_handoff_cases.mjs";
import {
  devTestGameHostedMatrixExternalEvidenceCommand,
  devTestGameHostedMatrixExternalEvidencePath,
} from "./dev_test_game_hosted_matrix_external_evidence.mjs";
import {
  devTestGameHostedMatrixRawEvidenceRealCaptureExamplePath,
} from "./dev_test_game_hosted_matrix_raw_evidence_fixture_proof.mjs";
import {
  repoRoot,
  runAdminAuditProof,
} from "./dev_test_game_admin_audit_proof_helper.mjs";

const defaultFrontendBaseUrl = "https://fmarch-demo.example.test";
const defaultApiBaseUrl = "https://api.fmarch-demo.example.test";
const sourcePath = path.join(
  repoRoot,
  devTestGameHostedEvidenceLaneRealCaptureSourcePath,
);
const evidencePath = path.join(
  repoRoot,
  devTestGameHostedEvidenceLaneRealCaptureAdminProofPath,
);

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  await runDevTestGameHostedEvidenceLaneRealCaptureAdminProof({
    env: process.env,
  });
  console.log(`wrote ${devTestGameHostedEvidenceLaneRealCaptureAdminProofPath}`);
}

export async function runDevTestGameHostedEvidenceLaneRealCaptureAdminProof({
  env = process.env,
  generatedAt = new Date().toISOString(),
} = {}) {
  await runDevTestGameHostedEvidenceLaneDemoProof({ env, generatedAt });
  const lane = assertDevTestGameHostedEvidenceLane(
    await runDevTestGameHostedEvidenceLane({
      generatedAt,
      env: {
        ...env,
        FMARCH_HOSTED_MATRIX_FRONTEND_URL:
          optionalEnv(env.FMARCH_HOSTED_MATRIX_FRONTEND_URL) ??
          defaultFrontendBaseUrl,
        FMARCH_HOSTED_MATRIX_API_URL:
          optionalEnv(env.FMARCH_HOSTED_MATRIX_API_URL) ?? defaultApiBaseUrl,
        FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH:
          optionalEnv(env.FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH) ??
          devTestGameHostedMatrixRawEvidenceRealCaptureExamplePath,
        FMARCH_HOSTED_MATRIX_EVIDENCE_PATH:
          optionalEnv(env.FMARCH_HOSTED_MATRIX_EVIDENCE_PATH) ??
          devTestGameHostedMatrixExternalEvidencePath,
      },
    }),
  );
  assertRealCaptureLane(lane);
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, `${JSON.stringify(lane, null, 2)}\n`);
  await runAdminAuditProof(
    hostedEvidenceLaneAdminProofCase({
      lanePath: sourcePath,
      evidencePath,
      proofBoundary:
        "Local SvelteKit admin role URL proof for the hosted evidence lane with a checked real-capture raw matrix example. Proves the admin handoff moves from passed raw-capture preflight to external hosted matrix normalization while keeping release readiness and production readiness false.",
      generatedFromExtra: {
        realCaptureExample: true,
        rawEvidencePath: lane.target.rawEvidencePath,
        externalEvidencePath: lane.hostedEvidence.externalEvidencePath,
      },
      requiredText: [
        "passed",
        "real-hosted",
        lane.hostedEvidence.externalEvidencePath,
        lane.target.rawEvidencePath,
        `npm run ${devTestGameHostedMatrixExternalEvidenceCommand}`,
        lane.nextProofTarget,
        "release not ready",
        "production not ready",
      ],
    }),
  );
}

function assertRealCaptureLane(lane) {
  if (
    lane.status !== "passed" ||
    lane.releaseReady !== false ||
    lane.productionReady !== false ||
    lane.preflightStatus !== "passed" ||
    lane.hostedEvidence?.mode !== "real-hosted" ||
    lane.hostedEvidence?.realHostedEvidenceStatus !== "passed" ||
    lane.target?.rawEvidencePath !==
      devTestGameHostedMatrixRawEvidenceRealCaptureExamplePath ||
    lane.nextProofTarget !== devTestGameHostedMatrixExternalEvidencePath
  ) {
    throw new Error("hosted evidence lane real-capture state drifted");
  }
}

function optionalEnv(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}
