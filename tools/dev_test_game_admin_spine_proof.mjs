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
  validateDevTestGameHostedOpsSignalsAdminProof,
  validateDevTestGameHostedTargetPreflightAdminProof,
  validateDevTestGameIdentityAdminProof,
  validateDevTestGameOpsAdminProof,
  validateDevTestGameRaceCoverageAdminProof,
  validateDevTestGameReleaseAdminProof,
  validateDevTestGameReleaseRunbookAdminProof,
  validateDevTestGameSeedAdminProof,
  validateDevTestGameSpineManifestAdminProof,
} from "./dev_test_game_release_readiness.mjs";

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
  },
  {
    id: "hardening",
    label: "Multiplayer hardening admin role surface",
    script: "tools/dev_test_game_hardening_admin_proof.mjs",
    rerunCommand: "npm run test:dev-test-game-hardening-admin-proof",
    path: "target/dev-test-game/hardening-admin-proof.json",
    validate: validateDevTestGameHardeningAdminProof,
  },
  {
    id: "identity",
    label: "Identity adapter admin role surface",
    script: "tools/dev_test_game_identity_admin_proof.mjs",
    rerunCommand: "npm run test:dev-test-game-identity-admin-proof",
    path: "target/dev-test-game/identity-admin-proof.json",
    validate: validateDevTestGameIdentityAdminProof,
  },
  {
    id: "backup",
    label: "Backup/restore admin role surface",
    script: "tools/dev_test_game_backup_admin_proof.mjs",
    rerunCommand: "npm run test:dev-test-game-backup-admin-proof",
    path: "target/dev-test-game/backup-admin-proof.json",
    validate: validateDevTestGameBackupAdminProof,
  },
  {
    id: "ops",
    label: "Ops artifact admin role surface",
    script: "tools/dev_test_game_ops_admin_proof.mjs",
    rerunCommand: "npm run test:dev-test-game-ops-admin-proof",
    path: "target/dev-test-game/ops-admin-proof.json",
    validate: validateDevTestGameOpsAdminProof,
  },
  {
    id: "seed",
    label: "Seed/demo fixture admin role surface",
    script: "tools/dev_test_game_seed_admin_proof.mjs",
    rerunCommand: "npm run test:dev-test-game-seed-admin-proof",
    path: "target/dev-test-game/seed-admin-proof.json",
    validate: validateDevTestGameSeedAdminProof,
  },
  {
    id: "release",
    label: "Release-readiness admin role surface",
    script: "tools/dev_test_game_release_admin_proof.mjs",
    rerunCommand: "npm run test:dev-test-game-release-admin-proof",
    path: "target/dev-test-game/release-admin-proof.json",
    validate: validateDevTestGameReleaseAdminProof,
  },
  {
    id: "release-runbook",
    label: "Release runbook admin role surface",
    script: "tools/dev_test_game_release_runbook_admin_proof.mjs",
    rerunCommand: "npm run test:dev-test-game-release-runbook-admin-proof",
    path: "target/dev-test-game/release-runbook-admin-proof.json",
    validate: validateDevTestGameReleaseRunbookAdminProof,
  },
  {
    id: "race-coverage",
    label: "Race coverage admin role surface",
    script: "tools/dev_test_game_race_coverage_admin_proof.mjs",
    rerunCommand: "npm run test:dev-test-game-race-coverage-admin-proof",
    path: "target/dev-test-game/race-coverage-admin-proof.json",
    validate: validateDevTestGameRaceCoverageAdminProof,
  },
  {
    id: "hosted-target-preflight",
    label: "Hosted target preflight admin role surface",
    script: "tools/dev_test_game_hosted_target_preflight_admin_proof.mjs",
    rerunCommand: "npm run test:dev-test-game-hosted-target-preflight-admin-proof",
    path: "target/dev-test-game/hosted-target-preflight-admin-proof.json",
    validate: validateDevTestGameHostedTargetPreflightAdminProof,
  },
  {
    id: "hosted-evidence-lane",
    label: "Hosted evidence lane admin role surface",
    script: "tools/dev_test_game_hosted_evidence_lane_admin_proof.mjs",
    rerunCommand: "npm run test:dev-test-game-hosted-evidence-lane-admin-proof",
    path: "target/dev-test-game/hosted-evidence-lane-admin-proof.json",
    validate: validateDevTestGameHostedEvidenceLaneAdminProof,
  },
  {
    id: "hosted-concurrent-race-matrix",
    label: "Hosted concurrent race matrix admin role surface",
    script: "tools/dev_test_game_hosted_concurrent_race_matrix_admin_proof.mjs",
    rerunCommand:
      "npm run test:dev-test-game-hosted-concurrent-race-matrix-admin-proof",
    path: "target/dev-test-game/hosted-concurrent-race-matrix-admin-proof.json",
    validate: validateDevTestGameHostedConcurrentRaceMatrixAdminProof,
  },
  {
    id: "hosted-ops-signals",
    label: "Hosted ops signals admin role surface",
    script: "tools/dev_test_game_hosted_ops_signals_admin_proof.mjs",
    rerunCommand: "npm run test:dev-test-game-hosted-ops-signals-admin-proof",
    path: "target/dev-test-game/hosted-ops-signals-admin-proof.json",
    validate: validateDevTestGameHostedOpsSignalsAdminProof,
  },
  {
    id: "spine-manifest",
    label: "Spine manifest admin role surface",
    script: "tools/dev_test_game_spine_manifest_admin_proof.mjs",
    rerunCommand: "npm run test:dev-test-game-spine-manifest-admin-proof",
    path: "target/dev-test-game/spine-manifest-admin-proof.json",
    validate: validateDevTestGameSpineManifestAdminProof,
  },
];

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  const evidence = await runAdminSpineProof();
  console.log(`wrote ${path.relative(repoRoot, evidencePath)} (${evidence.status})`);
}

export async function runAdminSpineProof() {
  await mkdir(artifactDir, { recursive: true });
  await runNodeScript("tools/dev_test_game_spine_manifest.mjs");
  const entries = [];
  for (const spec of devTestGameAdminSpineProofPlan) {
    await runNodeScript(spec.script);
    const proofPath = path.join(repoRoot, spec.path);
    const proof = JSON.parse(await readFile(proofPath, "utf8"));
    const validated = spec.validate(proof, { path: spec.path });
    const artifact = await readArtifactMetadata(proofPath);
    entries.push({
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
    });
  }
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
    proofBoundary:
      "Runs the local dev-test-game admin browser proof scripts in readiness-spine order and validates the saved admin role-surface artifacts. Passing means the seeded local admin surfaces are reachable and coherent; it does not prove hosted identity, hosted operations, beta readiness, release readiness, or production readiness.",
    recovery: buildAdminSpineRecovery(entries),
  };
  validateDevTestGameAdminSpineProof(evidence, {
    path: "target/dev-test-game/admin-spine-proof.json",
  });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

function buildAdminSpineRecovery(entries) {
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
