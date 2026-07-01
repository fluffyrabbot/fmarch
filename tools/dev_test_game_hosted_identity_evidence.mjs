import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { repoRoot } from "./dev_test_game_spine_runner.mjs";

export const DEV_TEST_GAME_HOSTED_IDENTITY_EVIDENCE_VERSION = 1;
export const devTestGameHostedIdentityEvidencePath =
  "target/dev-test-game/hosted-identity-evidence.json";
export const devTestGameHostedIdentityEvidenceCommand =
  "test:dev-test-game-hosted-identity-evidence";
export const hostedIdentityEvidenceInputIds = Object.freeze([
  "command",
  "proof-target",
  "FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH",
]);
export const hostedIdentityEvidenceCheckIds = Object.freeze([
  "hosted-identity-evidence-path-configured",
  "hosted-identity-evidence-readable",
  "hosted-account-lifecycle-evidence",
  "invite-delivery-evidence",
  "account-recovery-evidence",
  "abuse-and-rate-limit-evidence",
  "session-secret-policy-evidence",
  "hosted-audit-retention-export-evidence",
  "role-surface-adapter-preserved",
  "release-claim-boundary-carried",
]);
export const hostedIdentityEvidenceBlockedChecks = Object.freeze([
  Object.freeze({
    id: "hosted-identity-evidence-path-configured",
    requiredEvidence: "Set FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH.",
  }),
  Object.freeze({
    id: "hosted-identity-evidence-readable",
    requiredEvidence: "Readable hosted identity evidence JSON.",
  }),
  Object.freeze({
    id: "hosted-account-lifecycle-evidence",
    requiredEvidence:
      "Hosted account create/login/disable/enable lifecycle evidence over the existing role-surface adapter.",
  }),
  Object.freeze({
    id: "invite-delivery-evidence",
    requiredEvidence:
      "Hosted invite delivery and revocation evidence without exposing raw invite tokens in role URLs or admin surfaces.",
  }),
  Object.freeze({
    id: "account-recovery-evidence",
    requiredEvidence:
      "Hosted account recovery evidence where recovered sessions keep the same role-surface architecture.",
  }),
  Object.freeze({
    id: "abuse-and-rate-limit-evidence",
    requiredEvidence:
      "Hosted rate-limit and abuse-control evidence for login, invite, and session lifecycle operations.",
  }),
  Object.freeze({
    id: "session-secret-policy-evidence",
    requiredEvidence:
      "Hosted session-secret storage, rotation, and deployment policy evidence.",
  }),
  Object.freeze({
    id: "hosted-audit-retention-export-evidence",
    requiredEvidence:
      "Hosted audit retention/export evidence for account, invite, and session lifecycle events.",
  }),
  Object.freeze({
    id: "role-surface-adapter-preserved",
    requiredEvidence:
      "Hosted identity must preserve the existing role URL and adapter architecture.",
  }),
  Object.freeze({
    id: "release-claim-boundary-carried",
    requiredEvidence:
      "The hosted identity evidence file must keep releaseReady and productionReady false.",
  }),
]);

const outputPath = path.join(repoRoot, devTestGameHostedIdentityEvidencePath);

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  const evidence = await buildDevTestGameHostedIdentityEvidence({
    env: process.env,
  });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(
    `wrote ${devTestGameHostedIdentityEvidencePath} (${evidence.status})`,
  );
}

export async function buildDevTestGameHostedIdentityEvidence({
  env = process.env,
  generatedAt = new Date().toISOString(),
} = {}) {
  const rawEvidencePath = optionalEnv(env.FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH);
  const rawEvidence = await readRawHostedIdentityEvidence(rawEvidencePath);
  const source = rawEvidence.source ?? null;
  const checks = [
    {
      id: "hosted-identity-evidence-path-configured",
      status: rawEvidencePath === null ? "blocked" : "passed",
      ...(rawEvidencePath === null
        ? { requiredEvidence: "Set FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH." }
        : { evidence: rawEvidencePath }),
    },
    {
      id: "hosted-identity-evidence-readable",
      status: rawEvidence.status,
      ...(rawEvidence.evidence === undefined
        ? {}
        : { evidence: rawEvidence.evidence }),
      ...(rawEvidence.requiredEvidence === undefined
        ? {}
        : { requiredEvidence: rawEvidence.requiredEvidence }),
    },
    hostedIdentityBooleanCheck({
      source,
      field: "accountLifecycle",
      id: "hosted-account-lifecycle-evidence",
    }),
    hostedIdentityBooleanCheck({
      source,
      field: "inviteDelivery",
      id: "invite-delivery-evidence",
    }),
    hostedIdentityBooleanCheck({
      source,
      field: "accountRecovery",
      id: "account-recovery-evidence",
    }),
    hostedIdentityBooleanCheck({
      source,
      field: "abuseAndRateLimitPolicy",
      id: "abuse-and-rate-limit-evidence",
    }),
    hostedIdentityBooleanCheck({
      source,
      field: "sessionSecretPolicy",
      id: "session-secret-policy-evidence",
    }),
    hostedIdentityBooleanCheck({
      source,
      field: "hostedAuditRetentionExport",
      id: "hosted-audit-retention-export-evidence",
    }),
    {
      id: "role-surface-adapter-preserved",
      status:
        source?.hostedIdentity?.roleSurfaceArchitectureChanged === false
          ? "passed"
          : "blocked",
      requiredEvidence: requiredEvidenceForCheck("role-surface-adapter-preserved"),
    },
    {
      id: "release-claim-boundary-carried",
      status:
        source?.releaseReady === false && source?.productionReady === false
          ? "passed"
          : "blocked",
      releaseReady: false,
      productionReady: false,
      requiredEvidence: requiredEvidenceForCheck("release-claim-boundary-carried"),
    },
  ];
  const status = checks.every((check) => check.status === "passed")
    ? "passed"
    : "blocked";
  const evidence = {
    version: DEV_TEST_GAME_HOSTED_IDENTITY_EVIDENCE_VERSION,
    proof: "dev-test-game-hosted-identity-evidence",
    status,
    releaseReady: false,
    productionReady: false,
    generatedAt,
    scope: "hosted-identity-evidence-handoff",
    proofBoundary:
      "Hosted identity evidence intake for the dev-test-game identity spine. Passing means a hosted identity evidence file proves account lifecycle, invite delivery, recovery, abuse/rate-limit, session-secret, and audit retention inputs while preserving the role-surface adapter; it does not prove beta readiness, release readiness, or production readiness.",
    requiredEvidence:
      "Set FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH to a hosted identity evidence JSON file and rerun this command.",
    target: {
      rawEvidencePath,
      rawEvidenceStatus: rawEvidence.status,
    },
    checks,
    hostedHandoffChecklist: {
      status: status === "passed" ? "passed" : "blocked",
      preflightStatus: status,
      command: `npm run ${devTestGameHostedIdentityEvidenceCommand}`,
      proofTarget: devTestGameHostedIdentityEvidencePath,
      inputIds: [...hostedIdentityEvidenceInputIds],
      blockedCheckIds: checks
        .filter((check) => check.status === "blocked")
        .map((check) => check.id),
      blockedChecks: checks
        .filter((check) => check.status === "blocked")
        .map((check) => ({
          id: check.id,
          status: "blocked",
          requiredEvidence: String(check.requiredEvidence ?? ""),
        })),
    },
    nextCommand: `npm run ${devTestGameHostedIdentityEvidenceCommand}`,
    nextProofTarget: devTestGameHostedIdentityEvidencePath,
  };
  assertDevTestGameHostedIdentityEvidence(evidence);
  return evidence;
}

export function assertDevTestGameHostedIdentityEvidence(evidence) {
  if (
    evidence?.version !== DEV_TEST_GAME_HOSTED_IDENTITY_EVIDENCE_VERSION ||
    evidence.proof !== "dev-test-game-hosted-identity-evidence" ||
    !["passed", "blocked"].includes(evidence.status) ||
    evidence.releaseReady !== false ||
    evidence.productionReady !== false ||
    evidence.scope !== "hosted-identity-evidence-handoff"
  ) {
    throw new Error("hosted identity evidence shape drifted");
  }
  const checks = new Map((evidence.checks ?? []).map((check) => [check.id, check]));
  for (const id of hostedIdentityEvidenceCheckIds) {
    if (!checks.has(id)) {
      throw new Error(`hosted identity evidence missing check: ${id}`);
    }
  }
  if (checks.get("release-claim-boundary-carried").releaseReady !== false) {
    throw new Error("hosted identity evidence made a release claim");
  }
  const allPassed = Array.from(checks.values()).every(
    (check) => check.status === "passed",
  );
  if (evidence.status === "passed" && !allPassed) {
    throw new Error("hosted identity evidence passed with blocked checks");
  }
  if (evidence.status === "blocked" && allPassed) {
    throw new Error("hosted identity evidence blocked without blocked checks");
  }
  if (
    evidence.hostedHandoffChecklist?.command !==
      `npm run ${devTestGameHostedIdentityEvidenceCommand}` ||
    evidence.hostedHandoffChecklist.proofTarget !==
      devTestGameHostedIdentityEvidencePath
  ) {
    throw new Error("hosted identity evidence handoff checklist drifted");
  }
  return evidence;
}

async function readRawHostedIdentityEvidence(rawEvidencePath) {
  if (rawEvidencePath === null) {
    return {
      status: "blocked",
      requiredEvidence: "Set FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH.",
    };
  }
  const resolved = path.resolve(repoRoot, rawEvidencePath);
  try {
    const source = JSON.parse(await readFile(resolved, "utf8"));
    const metadata = await stat(resolved);
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
      requiredEvidence: `Readable hosted identity evidence JSON: ${error.message}`,
    };
  }
}

function hostedIdentityBooleanCheck({ source, field, id }) {
  return {
    id,
    status: source?.hostedIdentity?.[field] === true ? "passed" : "blocked",
    requiredEvidence: requiredEvidenceForCheck(id),
  };
}

function optionalEnv(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function requiredEvidenceForCheck(id) {
  return (
    hostedIdentityEvidenceBlockedChecks.find((check) => check.id === id)
      ?.requiredEvidence ?? "Hosted identity evidence."
  );
}
