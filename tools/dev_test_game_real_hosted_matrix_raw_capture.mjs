import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertDevTestGameHostedMatrixRawEvidence,
  defaultHostedMatrixRawGroupId,
  hostedMatrixRawEvidenceContractSummary,
} from "./dev_test_game_hosted_matrix_raw_evidence.mjs";
export {
  assertDevTestGameRealHostedMatrixRawCapture,
  devTestGameRealHostedMatrixRawCaptureCommand,
  devTestGameRealHostedMatrixRawCapturePath,
} from "./dev_test_game_real_hosted_matrix_raw_capture_contract.mjs";
import {
  assertDevTestGameRealHostedMatrixRawCapture,
  devTestGameRealHostedMatrixRawCaptureCommand,
  devTestGameRealHostedMatrixRawCapturePath,
} from "./dev_test_game_real_hosted_matrix_raw_capture_contract.mjs";
import { repoRoot } from "./dev_test_game_spine_runner.mjs";

const outputPath = path.join(repoRoot, devTestGameRealHostedMatrixRawCapturePath);

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  const proof = await writeDevTestGameRealHostedMatrixRawCapture({
    env: process.env,
  });
  console.log(
    `wrote ${devTestGameRealHostedMatrixRawCapturePath} (${proof.status})`,
  );
}

export async function writeDevTestGameRealHostedMatrixRawCapture({
  env = process.env,
  generatedAt = new Date().toISOString(),
} = {}) {
  const proof = await buildDevTestGameRealHostedMatrixRawCapture({
    env,
    generatedAt,
  });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(proof, null, 2)}\n`);
  return proof;
}

export async function buildDevTestGameRealHostedMatrixRawCapture({
  env = process.env,
  generatedAt = new Date().toISOString(),
} = {}) {
  const frontendBaseUrl = optionalEnv(env.FMARCH_HOSTED_MATRIX_FRONTEND_URL);
  const apiBaseUrl = optionalEnv(env.FMARCH_HOSTED_MATRIX_API_URL);
  const rawEvidencePath = optionalEnv(env.FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH);
  const groupId =
    optionalEnv(env.FMARCH_HOSTED_MATRIX_GROUP_ID) ?? defaultHostedMatrixRawGroupId;
  const rawEvidence = await readRawEvidence({
    rawEvidencePath,
    frontendBaseUrl,
    apiBaseUrl,
    groupId,
  });
  const checks = [
    {
      id: "raw-evidence-path-configured",
      status: rawEvidencePath === null ? "blocked" : "passed",
      ...(rawEvidencePath === null
        ? {
            requiredEvidence:
              "Set FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH to a raw hosted matrix evidence packet captured from an externally reachable hosted target.",
          }
        : { evidence: rawEvidencePath }),
    },
    {
      id: "raw-evidence-contract-valid",
      status: rawEvidence.status,
      ...(rawEvidence.evidence === undefined ? {} : { evidence: rawEvidence.evidence }),
      ...(rawEvidence.requiredEvidence === undefined
        ? {}
        : { requiredEvidence: rawEvidence.requiredEvidence }),
    },
    {
      id: "fixture-and-demo-markers-absent",
      status:
        rawEvidence.status === "passed" &&
        rawEvidence.syntheticExternalTarget !== true &&
        rawEvidence.fixtureEvidence !== true
          ? "passed"
          : "blocked",
      ...(rawEvidence.status === "passed" &&
      rawEvidence.syntheticExternalTarget !== true &&
      rawEvidence.fixtureEvidence !== true
        ? { evidence: rawEvidence.evidence }
        : {
            requiredEvidence:
              "Use raw evidence captured from a real hosted target. Synthetic demo, fixtureEvidence, and operatorFixture packets can prove handoff shape only.",
          }),
    },
    captureMetadataCheck(rawEvidence.source),
    {
      id: "release-claim-boundary-carried",
      status: "passed",
      releaseReady: false,
      productionReady: false,
    },
  ];
  const status = checks.every((check) => check.status === "passed")
    ? "passed"
    : "blocked";
  const proof = {
    version: 1,
    proof: "dev-test-game-real-hosted-matrix-raw-capture",
    status,
    releaseReady: false,
    productionReady: false,
    generatedAt,
    scope: "real-hosted-matrix-raw-capture",
    proofBoundary:
      "Operator intake proof for a raw hosted matrix evidence packet captured from an externally reachable hosted target. Passing means the packet matches the configured hosted target, carries explicit capture/redaction/retention metadata, and has no fixture or synthetic-demo markers; it does not prove release readiness, production readiness, hosted observability, or human rollback readiness.",
    target: {
      frontendBaseUrl,
      apiBaseUrl,
      groupId,
      rawEvidencePath,
      rawEvidenceStatus: rawEvidence.status,
      rawEvidenceSyntheticExternalTarget:
        rawEvidence.syntheticExternalTarget === true,
      rawEvidenceFixture: rawEvidence.fixtureEvidence === true,
    },
    checks,
    blockedCheckIds: checks
      .filter((check) => check.status === "blocked")
      .map((check) => check.id),
    nextCommand:
      status === "passed"
        ? "npm run test:dev-test-game-hosted-evidence-lane"
        : `npm run ${devTestGameRealHostedMatrixRawCaptureCommand}`,
    nextProofTarget:
      status === "passed"
        ? "target/dev-test-game/hosted-evidence-lane.json"
        : devTestGameRealHostedMatrixRawCapturePath,
  };
  assertDevTestGameRealHostedMatrixRawCapture(proof);
  return proof;
}

async function readRawEvidence({
  rawEvidencePath,
  frontendBaseUrl,
  apiBaseUrl,
  groupId,
}) {
  if (rawEvidencePath === null) {
    return {
      status: "blocked",
      requiredEvidence:
        "Readable raw hosted matrix evidence path is required before capture metadata can be validated.",
    };
  }
  if (frontendBaseUrl === null || apiBaseUrl === null) {
    return {
      status: "blocked",
      requiredEvidence:
        "FMARCH_HOSTED_MATRIX_FRONTEND_URL and FMARCH_HOSTED_MATRIX_API_URL are required to validate a real hosted raw capture.",
    };
  }
  const resolved = path.resolve(repoRoot, rawEvidencePath);
  try {
    const source = JSON.parse(await readFile(resolved, "utf8"));
    assertDevTestGameHostedMatrixRawEvidence(source, {
      frontendBaseUrl,
      apiBaseUrl,
      groupId,
    });
    const metadata = await stat(resolved);
    return {
      status: "passed",
      source,
      syntheticExternalTarget: source.generatedFrom?.syntheticExternalTarget === true,
      fixtureEvidence:
        source.generatedFrom?.fixtureEvidence === true ||
        source.generatedFrom?.operatorFixture === true,
      evidence: {
        path: path.relative(repoRoot, resolved),
        mtime: metadata.mtime.toISOString(),
        sizeBytes: metadata.size,
      },
    };
  } catch (error) {
    return {
      status: "blocked",
      requiredEvidence: `Readable ${hostedMatrixRawEvidenceContractSummary()} with real hosted capture metadata matching FMARCH_HOSTED_MATRIX_FRONTEND_URL, FMARCH_HOSTED_MATRIX_API_URL, and FMARCH_HOSTED_MATRIX_GROUP_ID; observed ${rawEvidencePath}: ${error.message}.`,
    };
  }
}

function captureMetadataCheck(rawEvidence) {
  const capture = rawEvidence?.capture;
  const redaction = capture?.redaction;
  const retention = capture?.retention;
  const passed =
    capture?.externallyCaptured === true &&
    typeof capture.capturedAt === "string" &&
    capture.capturedAt.trim() !== "" &&
    typeof capture.captureSource === "string" &&
    capture.captureSource.trim() !== "" &&
    redaction?.rawRoleCredentialsRedacted === true &&
    redaction?.inviteTokensRedacted === true &&
    redaction?.sessionCookiesRedacted === true &&
    typeof retention?.policy === "string" &&
    retention.policy.trim() !== "";
  return {
    id: "capture-redaction-retention-metadata",
    status: passed ? "passed" : "blocked",
    ...(passed
      ? {
          evidence: {
            capturedAt: capture.capturedAt,
            captureSource: capture.captureSource,
            retentionPolicy: retention.policy,
          },
        }
      : {
          requiredEvidence:
            "Attach capture.externallyCaptured=true, capture.capturedAt, capture.captureSource, capture.redaction rawRoleCredentialsRedacted/inviteTokensRedacted/sessionCookiesRedacted=true, and capture.retention.policy.",
        }),
  };
}

function optionalEnv(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}
