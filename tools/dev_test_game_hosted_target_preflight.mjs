import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertDevTestGameHostedMatrixRawEvidence,
  defaultHostedMatrixRawGroupId,
} from "./dev_test_game_hosted_matrix_raw_evidence.mjs";
import {
  devTestGameHostedMatrixExternalEvidenceCommand,
  devTestGameHostedMatrixExternalEvidencePath,
} from "./dev_test_game_hosted_matrix_external_evidence.mjs";
import { repoRoot } from "./dev_test_game_spine_runner.mjs";

export const DEV_TEST_GAME_HOSTED_TARGET_PREFLIGHT_VERSION = 1;
export const devTestGameHostedTargetPreflightPath =
  "target/dev-test-game/hosted-target-preflight.json";
export const devTestGameHostedTargetPreflightCommand =
  "test:dev-test-game-hosted-target-preflight";

const outputPath = path.join(repoRoot, devTestGameHostedTargetPreflightPath);

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  const preflight = await buildDevTestGameHostedTargetPreflight({
    env: process.env,
  });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(preflight, null, 2)}\n`);
  console.log(`wrote ${devTestGameHostedTargetPreflightPath} (${preflight.status})`);
}

export async function buildDevTestGameHostedTargetPreflight({
  env = process.env,
  generatedAt = new Date().toISOString(),
} = {}) {
  const frontendBaseUrl = optionalEnv(env.FMARCH_HOSTED_MATRIX_FRONTEND_URL);
  const apiBaseUrl = optionalEnv(env.FMARCH_HOSTED_MATRIX_API_URL);
  const rawEvidencePath = optionalEnv(env.FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH);
  const groupId = optionalEnv(env.FMARCH_HOSTED_MATRIX_GROUP_ID) ?? defaultHostedMatrixRawGroupId;
  const rawEvidence = await readRawEvidence({
    rawEvidencePath,
    frontendBaseUrl,
    apiBaseUrl,
    groupId,
  });
  const checks = [
    {
      id: "hosted-frontend-url-configured",
      status: frontendBaseUrl === null ? "blocked" : "passed",
      ...(frontendBaseUrl === null
        ? { requiredEvidence: "Set FMARCH_HOSTED_MATRIX_FRONTEND_URL." }
        : { evidence: frontendBaseUrl }),
    },
    {
      id: "hosted-api-url-configured",
      status: apiBaseUrl === null ? "blocked" : "passed",
      ...(apiBaseUrl === null
        ? { requiredEvidence: "Set FMARCH_HOSTED_MATRIX_API_URL." }
        : { evidence: apiBaseUrl }),
    },
    {
      id: "hosted-targets-external",
      status:
        frontendBaseUrl !== null &&
        apiBaseUrl !== null &&
        isExternallyHostedUrl(frontendBaseUrl) &&
        isExternallyHostedUrl(apiBaseUrl)
          ? "passed"
          : "blocked",
      requiredEvidence:
        "Both hosted target URLs must be externally reachable http(s) URLs, not localhost or loopback.",
    },
    {
      id: "raw-evidence-path-configured",
      status: rawEvidencePath === null ? "blocked" : "passed",
      ...(rawEvidencePath === null
        ? { requiredEvidence: "Set FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH." }
        : { evidence: rawEvidencePath }),
    },
    {
      id: "raw-evidence-readable",
      status: rawEvidence.status,
      ...(rawEvidence.evidence === undefined ? {} : { evidence: rawEvidence.evidence }),
      ...(rawEvidence.requiredEvidence === undefined
        ? {}
        : { requiredEvidence: rawEvidence.requiredEvidence }),
    },
    {
      id: "release-claim-boundary-carried",
      status: "passed",
      releaseReady: false,
      productionReady: false,
    },
  ];
  const status = checks.every((check) => check.status === "passed") ? "passed" : "blocked";
  const preflight = {
    version: DEV_TEST_GAME_HOSTED_TARGET_PREFLIGHT_VERSION,
    proof: "dev-test-game-hosted-target-preflight",
    status,
    releaseReady: false,
    productionReady: false,
    generatedAt,
    scope: "hosted-target-preflight",
    proofBoundary:
      "Hosted target preflight for the dev-test-game hosted matrix evidence handoff. Passing means the external target URLs are configured, non-local, and the raw hosted matrix evidence is readable for the same target; it does not prove hosted deployment, multi-node races, beta readiness, release readiness, or production readiness.",
    target: {
      frontendBaseUrl,
      apiBaseUrl,
      groupId,
      rawEvidencePath,
      rawEvidenceStatus: rawEvidence.status,
      rawEvidenceSyntheticExternalTarget:
        rawEvidence.syntheticExternalTarget === true,
    },
    checks,
    nextCommand:
      status === "passed"
        ? `npm run ${devTestGameHostedMatrixExternalEvidenceCommand}`
        : `npm run ${devTestGameHostedTargetPreflightCommand}`,
    nextProofTarget:
      status === "passed"
        ? devTestGameHostedMatrixExternalEvidencePath
        : devTestGameHostedTargetPreflightPath,
  };
  assertDevTestGameHostedTargetPreflight(preflight);
  return preflight;
}

export function assertDevTestGameHostedTargetPreflight(preflight) {
  if (
    preflight?.version !== DEV_TEST_GAME_HOSTED_TARGET_PREFLIGHT_VERSION ||
    preflight.proof !== "dev-test-game-hosted-target-preflight" ||
    !["passed", "blocked"].includes(preflight.status) ||
    preflight.releaseReady !== false ||
    preflight.productionReady !== false ||
    preflight.scope !== "hosted-target-preflight"
  ) {
    throw new Error("hosted target preflight shape drifted");
  }
  const checks = new Map((preflight.checks ?? []).map((check) => [check.id, check]));
  for (const id of [
    "hosted-frontend-url-configured",
    "hosted-api-url-configured",
    "hosted-targets-external",
    "raw-evidence-path-configured",
    "raw-evidence-readable",
    "release-claim-boundary-carried",
  ]) {
    if (!checks.has(id)) {
      throw new Error(`hosted target preflight missing check: ${id}`);
    }
  }
  if (checks.get("release-claim-boundary-carried").releaseReady !== false) {
    throw new Error("hosted target preflight made a release claim");
  }
  const allPassed = Array.from(checks.values()).every((check) => check.status === "passed");
  if (preflight.status === "passed" && !allPassed) {
    throw new Error("hosted target preflight passed with blocked checks");
  }
  if (preflight.status === "blocked" && allPassed) {
    throw new Error("hosted target preflight blocked without blocked checks");
  }
  return preflight;
}

async function readRawEvidence({ rawEvidencePath, frontendBaseUrl, apiBaseUrl, groupId }) {
  if (rawEvidencePath === null) {
    return {
      status: "blocked",
      requiredEvidence: "Set FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH.",
    };
  }
  const resolved = path.resolve(repoRoot, rawEvidencePath);
  try {
    const source = JSON.parse(await readFile(resolved, "utf8"));
    if (frontendBaseUrl !== null && apiBaseUrl !== null) {
      assertDevTestGameHostedMatrixRawEvidence(source, {
        frontendBaseUrl,
        apiBaseUrl,
        groupId,
      });
    }
    const metadata = await stat(resolved);
    return {
      status: "passed",
      syntheticExternalTarget: source.generatedFrom?.syntheticExternalTarget === true,
      evidence: {
        path: path.relative(repoRoot, resolved),
        mtime: metadata.mtime.toISOString(),
        sizeBytes: metadata.size,
      },
    };
  } catch (error) {
    return {
      status: "blocked",
      requiredEvidence: `Readable raw hosted matrix evidence JSON matching the configured target: ${error.message}`,
    };
  }
}

function optionalEnv(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function isExternallyHostedUrl(value) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return (
      ["http:", "https:"].includes(url.protocol) &&
      hostname !== "localhost" &&
      hostname !== "127.0.0.1" &&
      hostname !== "::1" &&
      !hostname.endsWith(".localhost")
    );
  } catch {
    return false;
  }
}
