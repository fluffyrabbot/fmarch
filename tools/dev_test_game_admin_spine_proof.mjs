import { spawn } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  validateDevTestGameAdminSpineProof,
  validateDevTestGameBackupAdminProof,
  validateDevTestGameCoreLoopAdminProof,
  validateDevTestGameHardeningAdminProof,
  validateDevTestGameHostedConcurrentRaceMatrixAdminProof,
  validateDevTestGameHostedEvidenceLaneAdminProof,
  validateDevTestGameHostedIdentityEvidenceAdminProof,
  validateDevTestGameHostedOpsSignalsAdminProof,
  validateDevTestGameHostedTargetPreflightAdminProof,
  validateDevTestGameIdentityAdminProof,
  validateDevTestGameOpsAdminProof,
  validateDevTestGameRaceCoverageAdminProof,
  validateDevTestGameRealHostedObservabilityHandoffAdminProof,
  validateDevTestGameReleaseAdminProof,
  validateDevTestGameReleaseRunbookAdminProof,
  validateDevTestGameSeedAdminProof,
  validateDevTestGameSpineManifestAdminProof,
} from "./dev_test_game_release_readiness.mjs";
import {
  runAdminAuditProofBatchPlan,
} from "./dev_test_game_admin_audit_proof_helper.mjs";
import {
  coreLoopAdminProofCase,
} from "./dev_test_game_core_loop_admin_proof.mjs";
import {
  hardeningAdminProofCase,
} from "./dev_test_game_hardening_admin_proof.mjs";
import {
  identityAdminProofCase,
} from "./dev_test_game_identity_admin_proof.mjs";
import {
  hostedIdentityEvidenceAdminProofCase,
} from "./dev_test_game_hosted_identity_evidence_admin_proof.mjs";
import {
  backupAdminProofCase,
} from "./dev_test_game_backup_admin_proof.mjs";
import {
  opsAdminProofCase,
} from "./dev_test_game_ops_admin_proof.mjs";
import {
  seedAdminProofCase,
} from "./dev_test_game_seed_admin_proof.mjs";
import {
  releaseAdminProofCase,
} from "./dev_test_game_release_admin_proof.mjs";
import {
  releaseRunbookAdminProofCase,
} from "./dev_test_game_release_runbook_admin_proof.mjs";
import {
  raceCoverageAdminProofCase,
} from "./dev_test_game_race_coverage_admin_proof.mjs";
import {
  hostedTargetPreflightAdminProofCase,
} from "./dev_test_game_hosted_target_preflight_admin_proof.mjs";
import {
  hostedEvidenceLaneAdminProofCase,
} from "./dev_test_game_hosted_evidence_lane_admin_proof.mjs";
import {
  hostedConcurrentRaceMatrixAdminProofCase,
} from "./dev_test_game_hosted_concurrent_race_matrix_admin_proof.mjs";
import {
  hostedOpsSignalsAdminProofCase,
} from "./dev_test_game_hosted_ops_signals_admin_proof.mjs";
import {
  realHostedObservabilityHandoffAdminProofCase,
} from "./dev_test_game_real_hosted_observability_handoff_admin_proof.mjs";
import {
  spineManifestAdminProofCase,
} from "./dev_test_game_spine_manifest_admin_proof.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = path.join(repoRoot, "target", "dev-test-game");
const evidencePath = path.join(artifactDir, "admin-spine-proof.json");

export const devTestGameAdminSpineProofPlan = [
  {
    id: "core-loop",
    label: "Core loop admin role surface",
    script: "tools/dev_test_game_core_loop_admin_proof.mjs",
    rerunCommand: "npm run test:dev-test-game-core-loop-admin-proof",
    path: "target/dev-test-game/core-loop-admin-proof.json",
    validate: validateDevTestGameCoreLoopAdminProof,
    caseFactory: coreLoopAdminProofCase,
  },
  {
    id: "hardening",
    label: "Multiplayer hardening admin role surface",
    script: "tools/dev_test_game_hardening_admin_proof.mjs",
    rerunCommand: "npm run test:dev-test-game-hardening-admin-proof",
    path: "target/dev-test-game/hardening-admin-proof.json",
    validate: validateDevTestGameHardeningAdminProof,
    caseFactory: hardeningAdminProofCase,
  },
  {
    id: "identity",
    label: "Identity adapter admin role surface",
    script: "tools/dev_test_game_identity_admin_proof.mjs",
    rerunCommand: "npm run test:dev-test-game-identity-admin-proof",
    path: "target/dev-test-game/identity-admin-proof.json",
    validate: validateDevTestGameIdentityAdminProof,
    caseFactory: identityAdminProofCase,
  },
  {
    id: "hosted-identity-evidence",
    label: "Hosted identity evidence admin role surface",
    script: "tools/dev_test_game_hosted_identity_evidence_admin_proof.mjs",
    rerunCommand:
      "npm run test:dev-test-game-hosted-identity-evidence-admin-proof",
    path: "target/dev-test-game/hosted-identity-evidence-admin-proof.json",
    validate: validateDevTestGameHostedIdentityEvidenceAdminProof,
    caseFactory: hostedIdentityEvidenceAdminProofCase,
  },
  {
    id: "backup",
    label: "Backup/restore admin role surface",
    script: "tools/dev_test_game_backup_admin_proof.mjs",
    rerunCommand: "npm run test:dev-test-game-backup-admin-proof",
    path: "target/dev-test-game/backup-admin-proof.json",
    validate: validateDevTestGameBackupAdminProof,
    caseFactory: backupAdminProofCase,
  },
  {
    id: "ops",
    label: "Ops artifact admin role surface",
    script: "tools/dev_test_game_ops_admin_proof.mjs",
    rerunCommand: "npm run test:dev-test-game-ops-admin-proof",
    path: "target/dev-test-game/ops-admin-proof.json",
    validate: validateDevTestGameOpsAdminProof,
    caseFactory: opsAdminProofCase,
  },
  {
    id: "seed",
    label: "Seed/demo fixture admin role surface",
    script: "tools/dev_test_game_seed_admin_proof.mjs",
    rerunCommand: "npm run test:dev-test-game-seed-admin-proof",
    path: "target/dev-test-game/seed-admin-proof.json",
    validate: validateDevTestGameSeedAdminProof,
    caseFactory: seedAdminProofCase,
  },
  {
    id: "release",
    label: "Release-readiness admin role surface",
    script: "tools/dev_test_game_release_admin_proof.mjs",
    rerunCommand: "npm run test:dev-test-game-release-admin-proof",
    path: "target/dev-test-game/release-admin-proof.json",
    validate: validateDevTestGameReleaseAdminProof,
    caseFactory: releaseAdminProofCase,
  },
  {
    id: "release-runbook",
    label: "Release runbook admin role surface",
    script: "tools/dev_test_game_release_runbook_admin_proof.mjs",
    rerunCommand: "npm run test:dev-test-game-release-runbook-admin-proof",
    path: "target/dev-test-game/release-runbook-admin-proof.json",
    validate: validateDevTestGameReleaseRunbookAdminProof,
    caseFactory: releaseRunbookAdminProofCase,
  },
  {
    id: "race-coverage",
    label: "Race coverage admin role surface",
    script: "tools/dev_test_game_race_coverage_admin_proof.mjs",
    rerunCommand: "npm run test:dev-test-game-race-coverage-admin-proof",
    path: "target/dev-test-game/race-coverage-admin-proof.json",
    validate: validateDevTestGameRaceCoverageAdminProof,
    caseFactory: raceCoverageAdminProofCase,
  },
  {
    id: "hosted-target-preflight",
    label: "Hosted target preflight admin role surface",
    script: "tools/dev_test_game_hosted_target_preflight_admin_proof.mjs",
    rerunCommand: "npm run test:dev-test-game-hosted-target-preflight-admin-proof",
    path: "target/dev-test-game/hosted-target-preflight-admin-proof.json",
    validate: validateDevTestGameHostedTargetPreflightAdminProof,
    caseFactory: hostedTargetPreflightAdminProofCase,
  },
  {
    id: "hosted-evidence-lane",
    label: "Hosted evidence lane admin role surface",
    script: "tools/dev_test_game_hosted_evidence_lane_admin_proof.mjs",
    rerunCommand: "npm run test:dev-test-game-hosted-evidence-lane-admin-proof",
    path: "target/dev-test-game/hosted-evidence-lane-admin-proof.json",
    validate: validateDevTestGameHostedEvidenceLaneAdminProof,
    caseFactory: hostedEvidenceLaneAdminProofCase,
  },
  {
    id: "hosted-concurrent-race-matrix",
    label: "Hosted concurrent race matrix admin role surface",
    script: "tools/dev_test_game_hosted_concurrent_race_matrix_admin_proof.mjs",
    rerunCommand:
      "npm run test:dev-test-game-hosted-concurrent-race-matrix-admin-proof",
    path: "target/dev-test-game/hosted-concurrent-race-matrix-admin-proof.json",
    validate: validateDevTestGameHostedConcurrentRaceMatrixAdminProof,
    caseFactory: hostedConcurrentRaceMatrixAdminProofCase,
  },
  {
    id: "hosted-ops-signals",
    label: "Hosted ops signals admin role surface",
    script: "tools/dev_test_game_hosted_ops_signals_admin_proof.mjs",
    rerunCommand: "npm run test:dev-test-game-hosted-ops-signals-admin-proof",
    path: "target/dev-test-game/hosted-ops-signals-admin-proof.json",
    validate: validateDevTestGameHostedOpsSignalsAdminProof,
    caseFactory: hostedOpsSignalsAdminProofCase,
  },
  {
    id: "real-hosted-observability-handoff",
    label: "Real hosted observability handoff admin role surface",
    script: "tools/dev_test_game_real_hosted_observability_handoff_admin_proof.mjs",
    rerunCommand:
      "npm run test:dev-test-game-real-hosted-observability-handoff-admin-proof",
    path: "target/dev-test-game/real-hosted-observability-handoff-admin-proof.json",
    validate: validateDevTestGameRealHostedObservabilityHandoffAdminProof,
    caseFactory: realHostedObservabilityHandoffAdminProofCase,
  },
  {
    id: "spine-manifest",
    label: "Spine manifest admin role surface",
    script: "tools/dev_test_game_spine_manifest_admin_proof.mjs",
    rerunCommand: "npm run test:dev-test-game-spine-manifest-admin-proof",
    path: "target/dev-test-game/spine-manifest-admin-proof.json",
    validate: validateDevTestGameSpineManifestAdminProof,
    caseFactory: spineManifestAdminProofCase,
  },
];

export function devTestGameAdminSpineProofBatchPlans(
  plan = devTestGameAdminSpineProofPlan,
) {
  const releaseIndex = plan.findIndex((spec) => spec.id === "release");
  if (releaseIndex < 0) {
    throw new Error("admin spine proof plan is missing the release proof boundary");
  }
  const preReleaseSpecs = plan.slice(0, releaseIndex);
  const releaseAndHostedSpecs = plan.slice(releaseIndex);
  return [
    {
      label: "Aggregate pre-release admin proof batch",
      reason:
        "core, hardening, identity, backup, ops, and seed admin surfaces share the pre-readiness local proof inputs",
      specs: preReleaseSpecs,
      cases: preReleaseSpecs.map((spec) => spec.caseFactory),
    },
    {
      label: "Aggregate release and hosted admin proof batch",
      reason:
        "release, hosted, race coverage, and manifest admin surfaces share the post-readiness rollup inputs",
      specs: releaseAndHostedSpecs,
      cases: releaseAndHostedSpecs.map((spec) => spec.caseFactory),
    },
  ];
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  const evidence = await runAdminSpineProof();
  console.log(`wrote ${path.relative(repoRoot, evidencePath)} (${evidence.status})`);
}

export async function runAdminSpineProof() {
  await mkdir(artifactDir, { recursive: true });
  await runNodeScript("tools/dev_test_game_spine_manifest.mjs");
  const entries = [];
  const batches = [];
  const [preReleaseBatch, releaseAndHostedBatch] =
    devTestGameAdminSpineProofBatchPlans();
  await runAdminSpineProofBatch({
    batchPlan: preReleaseBatch,
    entries,
    batches,
  });
  await runNodeScript("tools/dev_test_game_release_readiness.mjs");
  await runAdminSpineProofBatch({
    batchPlan: releaseAndHostedBatch,
    entries,
    batches,
  });
  const evidence = {
    version: 1,
    proof: "dev-test-game-admin-spine-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-admin-spine",
    generatedAt: new Date().toISOString(),
    generatedFrom: {
      game: commonGame(entries),
      proofs: Object.fromEntries(entries.map((entry) => [entry.id, entry.path])),
    },
    adminProofs: entries,
    batches,
    proofBoundary:
      "Runs the local dev-test-game admin browser proof scripts in readiness-spine order and validates the saved admin role-surface artifacts. Passing means the seeded local admin surfaces are reachable and coherent; it does not prove hosted identity, hosted operations, beta readiness, release readiness, or production readiness.",
    recovery: buildAdminSpineRecovery({ entries, batches }),
  };
  validateDevTestGameAdminSpineProof(evidence, {
    path: "target/dev-test-game/admin-spine-proof.json",
  });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

async function runAdminSpineProofBatch({ batchPlan, entries, batches }) {
  const startedAt = Date.now();
  await runAdminAuditProofBatchPlan(batchPlan);
  const elapsedMs = Date.now() - startedAt;
  const batchEntries = [];
  for (const spec of batchPlan.specs) {
    const entry = await readAdminSpineProofEntry(spec);
    entries.push(entry);
    batchEntries.push(entry);
  }
  batches.push(adminSpineBatchEvidence({ batchPlan, entries: batchEntries, elapsedMs }));
}

function adminSpineBatchEvidence({ batchPlan, entries, elapsedMs }) {
  return {
    label: batchPlan.label,
    reason: batchPlan.reason,
    status: "passed",
    caseCount: entries.length,
    caseSmokeNames: batchPlan.cases.map((caseFactory) => caseFactory().smokeName),
    proofIds: entries.map((entry) => entry.id),
    artifactPaths: entries.map((entry) => entry.path),
    elapsedMs,
    sharedFrontendSession: true,
    sharedChromiumSession: true,
    releaseReady: false,
    productionReady: false,
  };
}

async function readAdminSpineProofEntry(spec) {
  const proofPath = path.join(repoRoot, spec.path);
  const proof = JSON.parse(await readFile(proofPath, "utf8"));
  const validated = spec.validate(proof, { path: spec.path });
  const artifact = await readArtifactMetadata(proofPath);
  return {
    id: spec.id,
    label: spec.label,
    proof: proof.proof,
    status: validated.status,
    path: validated.path,
    rerunCommand: spec.rerunCommand,
    refreshedInCurrentRun: true,
    game: proof.generatedFrom?.game,
    artifact,
    overviewRoleUrl: validated.overviewRoleUrl,
    detailRoleUrl: validated.detailRoleUrl,
    ...(validated.visibleChecks === undefined
      ? {}
      : { visibleChecks: validated.visibleChecks }),
    ...(validated.visibleScenarios === undefined
      ? {}
      : { visibleScenarios: validated.visibleScenarios }),
    ...(validated.visibleSessions === undefined
      ? {}
      : { visibleSessions: validated.visibleSessions }),
    ...(validated.visibleUnproven === undefined
      ? {}
      : { visibleUnproven: validated.visibleUnproven }),
    releaseReady: false,
    productionReady: false,
  };
}

function buildAdminSpineRecovery({ entries, batches }) {
  const surfaces = entries.map((entry) => ({
    id: entry.id,
    label: entry.label,
    status: entry.status,
    path: entry.path,
    rerunCommand: entry.rerunCommand,
    refreshedInCurrentRun: entry.refreshedInCurrentRun === true,
    ...(entry.artifact?.mtime === undefined ? {} : { mtime: entry.artifact.mtime }),
    ...(entry.artifact?.sizeBytes === undefined
      ? {}
      : { sizeBytes: entry.artifact.sizeBytes }),
  }));
  return {
    status: "passed",
    surfaceCount: surfaces.length,
    refreshedCount: surfaces.filter((surface) => surface.refreshedInCurrentRun).length,
    batchCount: batches.length,
    batches: batches.map((batch) => ({
      label: batch.label,
      reason: batch.reason,
      status: batch.status,
      caseCount: batch.caseCount,
      elapsedMs: batch.elapsedMs,
      artifactPaths: batch.artifactPaths,
    })),
    nextCommand: "npm run test:dev-test-game-admin-spine",
    proofBoundary:
      "Local recovery map for aggregate admin proof surfaces. Commands rerun local browser proof lanes only; they do not prove hosted operations, beta readiness, release readiness, or production readiness.",
    surfaces,
  };
}

function runNodeScript(scriptPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: repoRoot,
      env: process.env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${scriptPath} exited with code ${code}`));
      }
    });
  });
}

async function readArtifactMetadata(absolutePath) {
  const metadata = await stat(absolutePath);
  return {
    path: path.relative(repoRoot, absolutePath),
    mtime: metadata.mtime.toISOString(),
    sizeBytes: metadata.size,
  };
}

function commonGame(entries) {
  const games = new Set(entries.map((entry) => entry.game).filter(Boolean));
  return games.size === 1 ? Array.from(games)[0] : "<seeded-game>";
}
