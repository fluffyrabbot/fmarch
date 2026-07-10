import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertDevTestGameProofRun } from "./dev_test_game_proof_contract.mjs";
import {
  assertDevTestGameReleaseReadiness,
  validateDevTestGameBackupRestoreProof,
} from "./dev_test_game_release_readiness.mjs";
import {
  devTestGameOpsArtifactsPath,
} from "./dev_test_game_adjacent_artifact_paths.mjs";

export const DEV_TEST_GAME_OPS_ARTIFACTS_VERSION = 1;
export { devTestGameOpsArtifactsPath };
export const devTestGameOpsArtifactsMarkdownPath =
  "target/dev-test-game/ops-artifacts.md";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = path.join(repoRoot, "target", "dev-test-game");
const defaultPaths = Object.freeze({
  session: path.join(artifactDir, "session.json"),
  proofRun: path.join(artifactDir, "proof-run.json"),
  readiness: path.join(artifactDir, "release-readiness-checklist.json"),
  backupRestoreProof: path.join(
    repoRoot,
    "target",
    "live-stack-backup-restore-drill",
    "local-backup-restore-proof.json",
  ),
  backupRestoreDump: path.join(
    repoRoot,
    "target",
    "live-stack-backup-restore-drill",
    "local-live-stack.dump",
  ),
});
const jsonPath = path.join(repoRoot, devTestGameOpsArtifactsPath);
const markdownPath = path.join(repoRoot, devTestGameOpsArtifactsMarkdownPath);
const maxArtifactAgeHours = Number.parseFloat(
  process.env.FMARCH_DEV_TEST_GAME_OPS_MAX_ARTIFACT_AGE_HOURS ?? "24",
);

if (!Number.isFinite(maxArtifactAgeHours) || maxArtifactAgeHours <= 0) {
  throw new Error("FMARCH_DEV_TEST_GAME_OPS_MAX_ARTIFACT_AGE_HOURS must be positive");
}

export function buildDevTestGameOpsArtifacts({
  session,
  proofRun,
  readiness,
  artifacts,
  backupRestoreProof,
  generatedAt = new Date().toISOString(),
}) {
  const proof = assertDevTestGameProofRun(proofRun);
  assertDevTestGameReleaseReadiness(readiness);
  if (session?.game !== proof.session.game) {
    throw new Error(`ops artifact session/proof game mismatch: ${session?.game}`);
  }
  if (readiness.generatedFrom?.game !== proof.session.game) {
    throw new Error(
      `ops artifact readiness/proof game mismatch: ${readiness.generatedFrom?.game}`,
    );
  }
  const backupRestoreEvidence =
    backupRestoreProof === undefined
      ? undefined
      : validateDevTestGameBackupRestoreProof(backupRestoreProof.data, {
          proofPath: backupRestoreProof.path,
          dumpPath: backupRestoreProof.dumpPath,
          proofArtifact: artifacts.backupRestoreProof,
          dumpArtifact: artifacts.backupRestoreDump,
        });
  const roles = redactRoles(session.sessions ?? {});
  const ops = {
    version: DEV_TEST_GAME_OPS_ARTIFACTS_VERSION,
    proof: "dev-test-game-ops-artifacts",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    generatedAt,
    scope: "local-dev-test-game-ops-artifacts",
    proofBoundary:
      "Local artifact bundle for one dev-test-game run. It redacts role credentials and records checksums, command counts, proof lanes, and optional local backup/restore evidence; it does not prove hosted observability, centralized logs, paging, SLOs, production incident response, or release readiness.",
    generatedFrom: {
      sessionJson: artifacts.session.path,
      proofRun: artifacts.proofRun.path,
      readinessChecklist: artifacts.readiness.path,
      ...(backupRestoreEvidence === undefined
        ? {}
        : {
            backupRestoreProof: backupRestoreEvidence.path,
            backupRestoreDump: backupRestoreEvidence.dumpPath,
          }),
    },
    run: {
      name: session.name,
      game: session.game,
      seedMode: session.seedMode,
      verificationStatus: session.verification?.status ?? null,
      seedCommandCount: session.seedCommandCount,
      roleCount: Object.keys(roles).length,
      apiBaseUrl: session.apiBaseUrl,
      frontendBaseUrl: session.frontendBaseUrl,
    },
    roles,
    proofRun: {
      status: proof.status,
      laneCount: proof.lanes.length,
      lanes: proof.lanes.map((lane) => ({
        id: lane.id,
        status: lane.status,
      })),
      nonClaims: proof.nonClaims,
    },
    proofStability: session.verification?.proofStability ?? null,
    readiness: {
      status: readiness.status,
      releaseReady: readiness.releaseReady,
      productionReady: readiness.productionReady,
      localChecks: readiness.localDevelopmentSpine.checks.map((check) => ({
        id: check.id,
        status: check.status,
      })),
      unproven: readiness.releaseReadiness.unproven.map((item) => ({
        id: item.id,
        status: item.status,
      })),
    },
    artifacts: {
      session: artifacts.session,
      proofRun: artifacts.proofRun,
      readiness: artifacts.readiness,
      ...(backupRestoreEvidence === undefined
        ? {}
        : {
            backupRestoreProof: artifacts.backupRestoreProof,
            backupRestoreDump: artifacts.backupRestoreDump,
          }),
    },
    checks: [
      {
        id: "source-artifacts-checksummed",
        status: "passed",
        evidence: [artifacts.session.path, artifacts.proofRun.path, artifacts.readiness.path],
      },
      {
        id: "role-entrypoints-redacted",
        status: "passed",
        evidence: Object.keys(roles),
      },
      {
        id: "proof-lanes-summarized",
        status: "passed",
        laneCount: proof.lanes.length,
      },
      {
        id: "proof-stability-summarized",
        status: "passed",
        hostConfirmClicks:
          session.verification?.proofStability?.hostConfirmClicks?.total ?? 0,
        concurrentClickCount:
          session.verification?.proofStability?.hostConfirmClicks?.concurrentClickCount ??
          0,
        retryClickCount:
          session.verification?.proofStability?.hostConfirmClicks?.retryClickCount ?? 0,
        domFallbackCount:
          session.verification?.proofStability?.hostConfirmClicks?.domFallbackCount ?? 0,
        forceFallbackCount:
          session.verification?.proofStability?.hostConfirmClicks?.forceFallbackCount ?? 0,
      },
      {
        id: "release-boundary-carried",
        status: "passed",
        releaseReady: false,
        productionReady: false,
      },
      ...(backupRestoreEvidence === undefined
        ? []
        : [
            {
              id: "backup-restore-artifacts-checksummed",
              status: "passed",
              evidence: [backupRestoreEvidence.path, backupRestoreEvidence.dumpPath],
            },
          ]),
    ],
    ...(backupRestoreEvidence === undefined
      ? {}
      : {
          backupRestore: backupRestoreEvidence,
        }),
  };
  assertDevTestGameOpsArtifacts(ops);
  return ops;
}

export function assertDevTestGameOpsArtifacts(ops) {
  if (ops?.version !== DEV_TEST_GAME_OPS_ARTIFACTS_VERSION) {
    throw new Error(`ops artifact version drifted: ${ops?.version}`);
  }
  if (ops.proof !== "dev-test-game-ops-artifacts") {
    throw new Error(`unexpected ops artifact proof id: ${ops.proof}`);
  }
  if (ops.status !== "passed") {
    throw new Error(`ops artifact status is ${ops.status}`);
  }
  if (ops.releaseReady !== false || ops.productionReady !== false) {
    throw new Error("ops artifact must not claim release or production readiness");
  }
  const checks = new Map((ops.checks ?? []).map((check) => [check.id, check.status]));
  for (const id of [
    "source-artifacts-checksummed",
    "role-entrypoints-redacted",
    "proof-lanes-summarized",
    "proof-stability-summarized",
    "release-boundary-carried",
  ]) {
    if (checks.get(id) !== "passed") {
      throw new Error(`ops artifact missing passed check: ${id}`);
    }
  }
  const serialized = JSON.stringify(ops);
  if (/invite=(?!REDACTED)/.test(serialized)) {
    throw new Error("ops artifact leaked an invite URL token");
  }
  if (serialized.includes("dev-test-card-host") || serialized.includes("dev-test-card-player")) {
    throw new Error("ops artifact leaked a test invite token");
  }
  for (const [role, entry] of Object.entries(ops.roles ?? {})) {
    if (typeof entry.loginUrlRedacted !== "string" || entry.loginUrlRedacted === "") {
      throw new Error(`ops artifact role ${role} missing redacted login URL`);
    }
    if (
      entry.credentialKind === "invite" &&
      entry.loginUrlRedacted?.includes("invite=REDACTED") !== true
    ) {
      throw new Error(`ops artifact role ${role} missing redacted invite URL`);
    }
    if (
      entry.credentialKind === "account" &&
      (entry.loginUrlRedacted?.includes("invite=") === true ||
        entry.loginUrlRedacted?.includes("account=REDACTED") !== true)
    ) {
      throw new Error(`ops artifact role ${role} has malformed account login URL`);
    }
  }
  return ops;
}

function redactRoles(sessions) {
  return Object.fromEntries(
    Object.entries(sessions).map(([role, session]) => [
      role,
      {
        principalUserId: session.principalUserId,
        credentialKind: session.credentialKind,
        returnTo: session.returnTo,
        expectedCapabilityKind: session.expectedCapabilityKind,
        loginUrlRedacted: redactLoginUrl(session.loginUrl),
        inviteTokenRedacted: session.inviteToken === undefined ? undefined : "REDACTED",
      },
    ]),
  );
}

function redactLoginUrl(loginUrl) {
  if (typeof loginUrl !== "string" || loginUrl === "") {
    return loginUrl;
  }
  const url = new URL(loginUrl);
  if (url.searchParams.has("invite")) {
    url.searchParams.set("invite", "REDACTED");
  }
  if (url.searchParams.has("account")) {
    url.searchParams.set("account", "REDACTED");
  }
  return url.toString();
}

function markdownOpsArtifacts(ops) {
  const lines = [
    "# fmarch Dev Test Game Ops Artifacts",
    "",
    `- status: ${ops.status}`,
    `- releaseReady: ${ops.releaseReady}`,
    `- productionReady: ${ops.productionReady}`,
    `- generatedAt: ${ops.generatedAt}`,
    `- game: ${ops.run.game}`,
    "",
    ops.proofBoundary,
    "",
    "## Checks",
    "",
    "| Check | Status |",
    "| --- | --- |",
  ];
  for (const check of ops.checks) {
    lines.push(`| ${check.id} | ${check.status} |`);
  }
  lines.push(
    "",
    "## Artifacts",
    "",
    "| Artifact | SHA-256 | Size |",
    "| --- | --- | --- |",
  );
  for (const [name, artifact] of Object.entries(ops.artifacts)) {
    lines.push(`| ${name} | \`${artifact.sha256}\` | ${artifact.sizeBytes} |`);
  }
  lines.push("", "## Roles", "", "| Role | Principal | URL |", "| --- | --- | --- |");
  for (const [role, entry] of Object.entries(ops.roles)) {
    lines.push(`| ${role} | ${entry.principalUserId} | \`${entry.loginUrlRedacted}\` |`);
  }
  return `${lines.join("\n")}\n`;
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  const now = new Date();
  const paths = {
    session: resolvePath(process.env.FMARCH_DEV_TEST_GAME_SESSION, defaultPaths.session),
    proofRun: resolvePath(process.env.FMARCH_DEV_TEST_GAME_PROOF_RUN, defaultPaths.proofRun),
    readiness: resolvePath(
      process.env.FMARCH_DEV_TEST_GAME_READINESS,
      defaultPaths.readiness,
    ),
    backupRestoreProof: resolvePath(
      process.env.FMARCH_DEV_TEST_GAME_OPS_BACKUP_RESTORE_PROOF,
      defaultPaths.backupRestoreProof,
    ),
    backupRestoreDump: resolvePath(
      process.env.FMARCH_DEV_TEST_GAME_OPS_BACKUP_RESTORE_DUMP,
      defaultPaths.backupRestoreDump,
    ),
  };
  const includeBackupRestore =
    process.env.FMARCH_DEV_TEST_GAME_OPS_BACKUP_RESTORE_PROOF !== undefined ||
    process.env.FMARCH_DEV_TEST_GAME_OPS_BACKUP_RESTORE_DUMP !== undefined;
  if (
    (process.env.FMARCH_DEV_TEST_GAME_OPS_BACKUP_RESTORE_PROOF === undefined) !==
    (process.env.FMARCH_DEV_TEST_GAME_OPS_BACKUP_RESTORE_DUMP === undefined)
  ) {
    throw new Error(
      "FMARCH_DEV_TEST_GAME_OPS_BACKUP_RESTORE_PROOF and FMARCH_DEV_TEST_GAME_OPS_BACKUP_RESTORE_DUMP must be set together",
    );
  }
  const [session, proofRun, readiness] = await Promise.all([
    readJson(paths.session),
    readJson(paths.proofRun),
    readJson(paths.readiness),
  ]);
  const artifacts = {
    session: await artifactSummary(paths.session, now),
    proofRun: await artifactSummary(paths.proofRun, now),
    readiness: await artifactSummary(paths.readiness, now),
  };
  let backupRestoreProof;
  if (includeBackupRestore) {
    artifacts.backupRestoreProof = await artifactSummary(paths.backupRestoreProof, now);
    artifacts.backupRestoreDump = await artifactSummary(paths.backupRestoreDump, now);
    backupRestoreProof = {
      path: path.relative(repoRoot, paths.backupRestoreProof),
      dumpPath: path.relative(repoRoot, paths.backupRestoreDump),
      data: await readJson(paths.backupRestoreProof),
    };
  }
  const ops = buildDevTestGameOpsArtifacts({
    session,
    proofRun,
    readiness,
    artifacts,
    backupRestoreProof,
  });
  await mkdir(artifactDir, { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(ops, null, 2)}\n`);
  await writeFile(markdownPath, markdownOpsArtifacts(ops));
  console.log(`wrote ${path.relative(repoRoot, jsonPath)} (${ops.status})`);
}

function resolvePath(value, fallback) {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  return path.resolve(process.cwd(), value);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function artifactSummary(filePath, now) {
  const metadata = await stat(filePath);
  const data = await readFile(filePath);
  const ageMs = now.getTime() - metadata.mtime.getTime();
  if (ageMs < 0) {
    throw new Error(`${path.relative(repoRoot, filePath)} has a future mtime`);
  }
  const maxAgeMs = maxArtifactAgeHours * 60 * 60 * 1000;
  if (ageMs > maxAgeMs) {
    throw new Error(`${path.relative(repoRoot, filePath)} is stale: ${formatAge(ageMs)} old`);
  }
  return {
    path: path.relative(repoRoot, filePath),
    mtime: metadata.mtime.toISOString(),
    ageSeconds: Math.round(ageMs / 1000),
    sizeBytes: metadata.size,
    sha256: createHash("sha256").update(data).digest("hex"),
  };
}

function formatAge(ageMs) {
  const hours = Math.floor(ageMs / (60 * 60 * 1000));
  const minutes = Math.floor((ageMs % (60 * 60 * 1000)) / (60 * 1000));
  return `${hours}h ${minutes}m`;
}
