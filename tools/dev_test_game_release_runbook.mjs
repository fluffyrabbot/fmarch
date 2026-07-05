import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertDevTestGameReleaseReadiness,
} from "./dev_test_game_release_readiness.mjs";
import {
  devTestGameReleaseRunbookCommand,
  devTestGameReleaseRunbookAdminProofPath,
  devTestGameReleaseRunbookPath,
} from "./dev_test_game_release_artifact_paths.mjs";
import {
  devTestGameRealHostedObservabilityHandoffCommand,
  devTestGameRealHostedObservabilityHandoffPath,
} from "./dev_test_game_real_hosted_observability_handoff_cases.mjs";
import {
  localAdminAuditIds,
  localAdminAuditRoleUrl,
} from "./dev_test_game_admin_audit_surface_ids.mjs";
import {
  devTestGameReleaseReadinessPath,
} from "./dev_test_game_spine_artifact_paths.mjs";
import {
  devTestGameBackupRestoreProofPath,
  devTestGameHostedConcurrentRaceMatrixPath,
  devTestGameSeedFixturePath,
} from "./dev_test_game_adjacent_artifact_paths.mjs";
import {
  devTestGameHostedIdentityEvidenceCommand,
  devTestGameHostedIdentityEvidencePath,
} from "./dev_test_game_hosted_identity_evidence_cases.mjs";
import { repoRoot } from "./dev_test_game_spine_runner.mjs";

export const DEV_TEST_GAME_RELEASE_RUNBOOK_VERSION = 1;
export {
  devTestGameReleaseRunbookCommand,
  devTestGameReleaseRunbookAdminProofPath,
  devTestGameReleaseRunbookPath,
} from "./dev_test_game_release_artifact_paths.mjs";

const outputPath = path.join(repoRoot, devTestGameReleaseRunbookPath);
const defaultReadinessPath = path.join(repoRoot, devTestGameReleaseReadinessPath);

export function buildDevTestGameReleaseRunbook({
  releaseReadiness,
  releaseReadinessPath = devTestGameReleaseReadinessPath,
  releaseReadinessArtifact,
  generatedAt = new Date().toISOString(),
} = {}) {
  const readiness = assertDevTestGameReleaseReadiness(releaseReadiness);
  const unproven = readiness.releaseReadiness.unproven ?? [];
  const runbookItems = unproven.map((item, index) =>
    releaseRunbookItem(item, {
      rank: index + 1,
      game: readiness.generatedFrom.game,
    }),
  );
  const nextRunbookItem = nextReleaseRunbookItem(runbookItems);
  const runbook = {
    version: DEV_TEST_GAME_RELEASE_RUNBOOK_VERSION,
    proof: "dev-test-game-release-runbook",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    generatedAt,
    scope: "local-dev-test-game-release-runbook-rehearsal",
    proofBoundary:
      "Machine-readable local release-runbook rehearsal for the seeded dev-test-game spine. It maps remaining readiness gaps to owner-facing commands, rollback, support, and evidence boundaries; it does not prove human approval, hosted deployment, beta readiness, release readiness, or production readiness.",
    generatedFrom: {
      releaseReadinessChecklist: releaseReadinessPath,
      releaseReadinessGeneratedAt: readiness.generatedAt,
      game: readiness.generatedFrom.game,
      unprovenIds: unproven.map((item) => item.id),
      ...(releaseReadinessArtifact === undefined
        ? {}
        : { releaseReadinessArtifact }),
    },
    checks: [
      {
        id: "remaining-readiness-gaps-mapped",
        status: "passed",
        count: runbookItems.length,
      },
      {
        id: "rollback-path-carried",
        status: "passed",
        command: "npm run test:dev-test-game-backup-restore",
        proofTarget:
          devTestGameBackupRestoreProofPath,
      },
      {
        id: "support-path-carried",
        status: "passed",
        command: "npm run test:dev-test-game-admin-spine",
        roleUrl: "/admin?game=<seeded-game>",
      },
      {
        id: "release-claim-boundary-carried",
        status: "passed",
        releaseReady: false,
        productionReady: false,
      },
      {
        id: "human-approval-boundary-carried",
        status: "unproven",
        requiredEvidence:
          "Human release owner executes the runbook, verifies rollback/support staffing, and records explicit beta/release approval outside this local artifact.",
      },
    ],
    runbookItems,
    rollbackPath: {
      status: "rehearsed_locally",
      command: "npm run test:dev-test-game-backup-restore",
      proofTarget:
        devTestGameBackupRestoreProofPath,
      requiredBeforeRelease:
        "Production-like backup storage, restore evidence, key escrow, and secret rotation signoff remain required before beta/release.",
    },
    supportPath: {
      status: "local_admin_surface_available",
      command: "npm run test:dev-test-game-admin-spine",
      roleUrl: "/admin?game=<seeded-game>",
      requiredBeforeRelease:
        "Named support owner, escalation window, incident channel, and rollback decision authority remain human approval tasks.",
    },
    nextBuildSlice: {
      command: nextRunbookItem.command,
      buildSlice:
        nextRunbookItem.nextBuildSlice ??
        "Execute the first rehearsed release-readiness handoff, then regenerate the local release-readiness checklist and runbook.",
      proofTarget: nextRunbookItem.proofTarget,
      roleUrl: nextRunbookItem.roleUrl,
      owner: nextRunbookItem.owner,
      unprovenId: nextRunbookItem.id,
    },
  };
  assertDevTestGameReleaseRunbook(runbook);
  return runbook;
}

export function assertDevTestGameReleaseRunbook(runbook) {
  if (
    runbook?.version !== DEV_TEST_GAME_RELEASE_RUNBOOK_VERSION ||
    runbook.proof !== "dev-test-game-release-runbook" ||
    runbook.status !== "passed" ||
    runbook.releaseReady !== false ||
    runbook.productionReady !== false ||
    runbook.scope !== "local-dev-test-game-release-runbook-rehearsal"
  ) {
    throw new Error("release runbook shape drifted");
  }
  if (
    typeof runbook.generatedFrom?.releaseReadinessChecklist !== "string" ||
    typeof runbook.generatedFrom?.game !== "string" ||
    !Array.isArray(runbook.generatedFrom?.unprovenIds) ||
    runbook.generatedFrom.unprovenIds.length === 0
  ) {
    throw new Error("release runbook generatedFrom drifted");
  }
  const checks = new Map((runbook.checks ?? []).map((check) => [check.id, check]));
  for (const id of [
    "remaining-readiness-gaps-mapped",
    "rollback-path-carried",
    "support-path-carried",
    "release-claim-boundary-carried",
    "human-approval-boundary-carried",
  ]) {
    if (!checks.has(id)) {
      throw new Error(`release runbook missing check: ${id}`);
    }
  }
  if (checks.get("human-approval-boundary-carried").status !== "unproven") {
    throw new Error("release runbook must leave human approval unproven");
  }
  if (
    checks.get("release-claim-boundary-carried").releaseReady !== false ||
    checks.get("release-claim-boundary-carried").productionReady !== false
  ) {
    throw new Error("release runbook made release or production claims");
  }
  const itemIds = new Set((runbook.runbookItems ?? []).map((item) => item.id));
  for (const id of runbook.generatedFrom.unprovenIds) {
    if (!itemIds.has(id)) {
      throw new Error(`release runbook missing item: ${id}`);
    }
  }
  if (
    runbook.rollbackPath?.status !== "rehearsed_locally" ||
    runbook.supportPath?.status !== "local_admin_surface_available" ||
    typeof runbook.nextBuildSlice?.command !== "string" ||
    runbook.nextBuildSlice.command === "" ||
    typeof runbook.nextBuildSlice?.proofTarget !== "string" ||
    runbook.nextBuildSlice.proofTarget === "" ||
    typeof runbook.nextBuildSlice?.roleUrl !== "string" ||
    !runbook.nextBuildSlice.roleUrl.includes("?game=<seeded-game>")
  ) {
    throw new Error("release runbook recovery paths drifted");
  }
  return runbook;
}

function releaseRunbookItem(item, { rank, game }) {
  const config = releaseRunbookItemConfig.get(item.id) ?? {
    owner: "release-owner",
    command: "npm run test:dev-test-game-admin-spine",
    proofTarget: devTestGameReleaseReadinessPath,
    roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.releaseReadiness),
    evidenceBoundary:
      "Collect external evidence for this readiness gap, then regenerate the local release-readiness checklist.",
  };
  return {
    id: item.id,
    rank,
    status: "rehearsal_ready",
    owner: config.owner,
    command: config.command,
    proofTarget: config.proofTarget,
    roleUrl: config.roleUrl,
    game,
    requiredEvidence: item.requiredEvidence,
    evidenceBoundary: config.evidenceBoundary,
    ...(config.nextBuildSlice === undefined
      ? {}
      : { nextBuildSlice: config.nextBuildSlice }),
  };
}

const releaseRunbookItemConfig = new Map([
  [
    "hosted-production-identity",
    {
      owner: "identity-owner",
      command: `npm run ${devTestGameHostedIdentityEvidenceCommand}`,
      proofTarget: devTestGameHostedIdentityEvidencePath,
      roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.hostedIdentityEvidence),
      evidenceBoundary:
        "Local adapter proof remains the prerequisite role-surface boundary; the owner-facing release step is hosted identity evidence intake for account lifecycle, invite delivery, recovery, abuse controls, session-secret policy, and hosted audit export.",
      nextBuildSlice:
        "Run the hosted identity evidence intake while carrying the local identity adapter proof as prerequisite evidence; this records the blocked hosted handoff until operator packets are attached.",
    },
  ],
  [
    "hosted-deployment",
    {
      owner: "release-owner",
      command: "npm run test:dev-test-game-hosted-matrix-external-evidence",
      proofTarget: "target/dev-test-game/hosted-matrix-external.json",
      roleUrl: localAdminAuditRoleUrl(
        localAdminAuditIds.hostedConcurrentRaceMatrix,
      ),
      evidenceBoundary:
        "Requires externally reachable frontend/API health checks and deployment evidence; local hosted-like URLs are not enough.",
    },
  ],
  [
    "hosted-demo-fixtures",
    {
      owner: "demo-owner",
      command: "npm run test:dev-test-game-seed-fixture",
      proofTarget: devTestGameSeedFixturePath,
      roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.seedFixtures),
      evidenceBoundary:
        "Local seeded fixture inventory is present; hosted/demo sanitized data and invite delivery policy remain external release evidence.",
    },
  ],
  [
    "production-backup-recovery",
    {
      owner: "ops-owner",
      command: "npm run test:dev-test-game-backup-restore",
      proofTarget:
        devTestGameBackupRestoreProofPath,
      roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.backupRestore),
      evidenceBoundary:
        "Local dump/restore is rehearsed; production-like backup storage, PITR, escrow, and secret rotation remain external release evidence.",
    },
  ],
  [
    "real-hosted-concurrent-race-matrix",
    {
      owner: "multiplayer-owner",
      command: "npm run test:dev-test-game-hosted-concurrent-race-matrix",
      proofTarget: devTestGameHostedConcurrentRaceMatrixPath,
      roleUrl: localAdminAuditRoleUrl(
        localAdminAuditIds.hostedConcurrentRaceMatrix,
      ),
      evidenceBoundary:
        "Local hosted-like matrix is present; externally reachable multi-node race/reconnect/stale-client evidence remains required.",
    },
  ],
  [
    "real-hosted-observability-and-operations",
    {
      owner: "ops-owner",
      command: `npm run ${devTestGameRealHostedObservabilityHandoffCommand}`,
      proofTarget: devTestGameRealHostedObservabilityHandoffPath,
      roleUrl: localAdminAuditRoleUrl(
        localAdminAuditIds.realHostedObservabilityHandoff,
      ),
      evidenceBoundary:
        "Local hosted-like ops signals are baseline only; externally reachable hosted logs, metrics, traces, SLOs, paging, and incident response evidence remain required.",
    },
  ],
  [
    "human-release-runbook",
    {
      owner: "release-owner",
      command: `npm run ${devTestGameReleaseRunbookCommand}`,
      proofTarget: devTestGameReleaseRunbookPath,
      roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.releaseRunbook),
      evidenceBoundary:
        "This artifact rehearses the runbook locally; a human release owner must still execute it and record explicit approval.",
    },
  ],
  [
    "human-release-approval",
    {
      owner: "release-owner",
      command: `npm run ${devTestGameReleaseRunbookCommand}`,
      proofTarget: devTestGameReleaseRunbookPath,
      roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.releaseRunbook),
      evidenceBoundary:
        "Local runbook rehearsal is present; human signoff, support staffing, and release/rollback decision authority remain external approval evidence.",
    },
  ],
]);

function nextReleaseRunbookItem(runbookItems) {
  return (
    runbookItems.find((item) => item.id === "hosted-production-identity") ??
    runbookItems[0] ?? {
      id: "release-runbook",
      owner: "release-owner",
      command: `npm run ${devTestGameReleaseRunbookCommand}`,
      proofTarget: devTestGameReleaseRunbookPath,
      roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.releaseRunbook),
      nextBuildSlice:
        "Refresh the local release-runbook rehearsal after readiness evidence changes, then collect real human approval outside the local proof spine.",
    }
  );
}

async function readArtifactSummary(absolutePath) {
  const metadata = await stat(absolutePath).catch(() => null);
  if (metadata === null) {
    return undefined;
  }
  return {
    path: path.relative(repoRoot, absolutePath),
    mtime: metadata.mtime.toISOString(),
    sizeBytes: metadata.size,
  };
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  const readinessPath = path.resolve(
    repoRoot,
    process.env.FMARCH_DEV_TEST_GAME_RELEASE_READINESS ??
      devTestGameReleaseReadinessPath,
  );
  const readiness = JSON.parse(await readFile(readinessPath, "utf8"));
  const artifact = await readArtifactSummary(readinessPath);
  const runbook = buildDevTestGameReleaseRunbook({
    releaseReadiness: readiness,
    releaseReadinessPath: path.relative(repoRoot, readinessPath),
    releaseReadinessArtifact: artifact,
  });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(runbook, null, 2)}\n`);
  console.log(`wrote ${devTestGameReleaseRunbookPath} (${runbook.status})`);
}
