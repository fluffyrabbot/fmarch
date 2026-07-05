import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  devTestGameAdminSpineAdminProofPath,
  devTestGameBackupAdminProofPath,
  devTestGameCoreLoopAdminProofPath,
  devTestGameHardeningAdminProofPath,
  devTestGameHostSetupAdminProofPath,
  devTestGameIdentityAdminProofPath,
  devTestGameOpsAdminProofPath,
  devTestGameSeedAdminProofPath,
  devTestGameSpineManifestAdminProofPath,
} from "../../../../tools/dev_test_game_local_admin_proof_paths.mjs";
import {
  devTestGameReleaseAdminProofPath,
  devTestGameReleaseRunbookAdminProofPath,
  devTestGameReleaseRunbookPath,
} from "../../../../tools/dev_test_game_release_artifact_paths.mjs";
import {
  devTestGameRaceCoverageAdminProofPath,
} from "../../../../tools/dev_test_game_race_coverage.mjs";
import {
  devTestGameHostedConcurrentRaceMatrixAdminProofPath,
} from "../../../../tools/dev_test_game_hosted_concurrent_race_matrix_cases.mjs";
import {
  devTestGameHostedEvidenceLaneAdminProofPath,
} from "../../../../tools/dev_test_game_hosted_handoff_cases.mjs";
import {
  devTestGameHostedIdentityEvidenceAdminProofPath,
} from "../../../../tools/dev_test_game_hosted_identity_evidence_cases.mjs";
import {
  devTestGameHostedOpsSignalsAdminProofPath,
} from "../../../../tools/dev_test_game_hosted_ops_signal_cases.mjs";
import {
  devTestGameHostedTargetPreflightAdminProofPath,
} from "../../../../tools/dev_test_game_hosted_target_preflight_cases.mjs";
import {
  devTestGameRealHostedObservabilityHandoffAdminProofPath,
} from "../../../../tools/dev_test_game_real_hosted_observability_handoff_cases.mjs";
import {
  adminSpineProofPath,
  adminSpineTerminalBatchProofPath,
  devTestGameProofGraphAdminProofPath,
  devTestGameProofGraphPath,
  devTestGameProofRunPath,
  devTestGameReleaseReadinessPath,
  devTestGameSessionPath,
  nextActionPath,
  spineManifestPath,
} from "../../../../tools/dev_test_game_spine_artifact_paths.mjs";
import {
  devTestGameBackupRestoreProofPath,
  devTestGameHostedConcurrentRaceMatrixPath,
  devTestGameHostedEvidenceLaneDemoProofPath,
  devTestGameHostedEvidenceLanePath,
  devTestGameHostedIdentityEvidencePath,
  devTestGameHostedIdentityProgressionSummaryPath,
  devTestGameHostedOpsSignalsPath,
  devTestGameHostedTargetPreflightPath,
  devTestGameIdentityAdapterProofPath,
  devTestGameOpsArtifactsPath,
  devTestGameRaceCoveragePath,
  devTestGameRealHostedObservabilityHandoffPath,
  devTestGameSeedFixturePath,
} from "../../../../tools/dev_test_game_adjacent_artifact_paths.mjs";

const DEFAULT_OPS_ARTIFACTS = devTestGameOpsArtifactsPath;
const DEFAULT_DEV_TEST_GAME_PROOF_RUN = devTestGameProofRunPath;
const DEFAULT_SEED_FIXTURE_SUMMARY = devTestGameSeedFixturePath;
const DEFAULT_RELEASE_READINESS_CHECKLIST = devTestGameReleaseReadinessPath;
const DEFAULT_BACKUP_RESTORE_PROOF =
  devTestGameBackupRestoreProofPath;
const DEFAULT_IDENTITY_ADAPTER_PROOF = devTestGameIdentityAdapterProofPath;
const DEFAULT_SPINE_MANIFEST = spineManifestPath;
const DEFAULT_ADMIN_SPINE_PROOF = adminSpineProofPath;
const DEFAULT_ADMIN_SPINE_ADMIN_PROOF = devTestGameAdminSpineAdminProofPath;
const DEFAULT_ADMIN_SPINE_TERMINAL_BATCHES = adminSpineTerminalBatchProofPath;
const DEFAULT_HOST_SETUP_PROOF = "target/dev-test-game/host-setup-proof.json";
const DEFAULT_NEXT_ACTION = nextActionPath;
const DEFAULT_PROOF_GRAPH = devTestGameProofGraphPath;
const DEFAULT_PROOF_GRAPH_ADMIN_PROOF = devTestGameProofGraphAdminProofPath;
const DEFAULT_RACE_COVERAGE = devTestGameRaceCoveragePath;
const DEFAULT_RACE_COVERAGE_ADMIN_PROOF =
  devTestGameRaceCoverageAdminProofPath;
const DEFAULT_HOSTED_CONCURRENT_RACE_MATRIX =
  devTestGameHostedConcurrentRaceMatrixPath;
const DEFAULT_HOSTED_CONCURRENT_RACE_MATRIX_ADMIN_PROOF =
  devTestGameHostedConcurrentRaceMatrixAdminProofPath;
const DEFAULT_HOSTED_IDENTITY_EVIDENCE =
  devTestGameHostedIdentityEvidencePath;
const DEFAULT_HOSTED_IDENTITY_EVIDENCE_ADMIN_PROOF =
  devTestGameHostedIdentityEvidenceAdminProofPath;
const DEFAULT_HOSTED_IDENTITY_PROGRESSION_SUMMARY =
  devTestGameHostedIdentityProgressionSummaryPath;
const DEFAULT_HOSTED_OPS_SIGNALS = devTestGameHostedOpsSignalsPath;
const DEFAULT_REAL_HOSTED_OBSERVABILITY_HANDOFF =
  devTestGameRealHostedObservabilityHandoffPath;
const DEFAULT_REAL_HOSTED_OBSERVABILITY_HANDOFF_ADMIN_PROOF =
  devTestGameRealHostedObservabilityHandoffAdminProofPath;
const DEFAULT_HOSTED_TARGET_PREFLIGHT =
  devTestGameHostedTargetPreflightPath;
const DEFAULT_HOSTED_TARGET_PREFLIGHT_ADMIN_PROOF =
  devTestGameHostedTargetPreflightAdminProofPath;
const DEFAULT_HOSTED_EVIDENCE_LANE =
  devTestGameHostedEvidenceLanePath;
const DEFAULT_HOSTED_EVIDENCE_LANE_ADMIN_PROOF =
  devTestGameHostedEvidenceLaneAdminProofPath;
const DEFAULT_HOSTED_EVIDENCE_LANE_DEMO_PROOF =
  devTestGameHostedEvidenceLaneDemoProofPath;
const DEFAULT_RELEASE_RUNBOOK = devTestGameReleaseRunbookPath;
const DEFAULT_RELEASE_RUNBOOK_ADMIN_PROOF =
  devTestGameReleaseRunbookAdminProofPath;
const DEFAULT_MAX_ARTIFACT_AGE_HOURS = 24;

const LOCAL_PROOF_FRESHNESS_ARTIFACTS = Object.freeze([
  Object.freeze({
    id: "session",
    label: "Dev test-game session",
    env: "FMARCH_DEV_TEST_GAME_SESSION",
    fallback: devTestGameSessionPath,
  }),
  Object.freeze({
    id: "proof-run",
    label: "Dev test-game proof run",
    env: "FMARCH_DEV_TEST_GAME_PROOF_RUN",
    fallback: DEFAULT_DEV_TEST_GAME_PROOF_RUN,
  }),
  Object.freeze({
    id: "backup-restore",
    label: "Backup restore proof",
    env: "FMARCH_DEV_TEST_GAME_BACKUP_RESTORE_PROOF",
    fallback: DEFAULT_BACKUP_RESTORE_PROOF,
  }),
  Object.freeze({
    id: "ops-artifacts",
    label: "Ops artifacts",
    env: "FMARCH_DEV_TEST_GAME_OPS_ARTIFACTS",
    fallback: DEFAULT_OPS_ARTIFACTS,
  }),
  Object.freeze({
    id: "seed-fixture",
    label: "Seed fixture summary",
    env: "FMARCH_DEV_TEST_GAME_SEED_FIXTURE_SUMMARY",
    fallback: DEFAULT_SEED_FIXTURE_SUMMARY,
  }),
  Object.freeze({
    id: "release-readiness",
    label: "Release readiness checklist",
    env: "FMARCH_DEV_TEST_GAME_RELEASE_READINESS",
    fallback: DEFAULT_RELEASE_READINESS_CHECKLIST,
  }),
  Object.freeze({
    id: "identity-adapter",
    label: "Identity adapter proof",
    env: "FMARCH_DEV_TEST_GAME_IDENTITY_ADAPTER_PROOF",
    fallback: DEFAULT_IDENTITY_ADAPTER_PROOF,
  }),
  Object.freeze({
    id: "spine-manifest",
    label: "Spine manifest",
    env: "FMARCH_DEV_TEST_GAME_SPINE_MANIFEST",
    fallback: DEFAULT_SPINE_MANIFEST,
  }),
  Object.freeze({
    id: "core-loop",
    label: "Core loop admin proof",
    env: "FMARCH_DEV_TEST_GAME_CORE_LOOP_ADMIN_PROOF",
    fallback: devTestGameCoreLoopAdminProofPath,
  }),
  Object.freeze({
    id: "hardening",
    label: "Hardening admin proof",
    env: "FMARCH_DEV_TEST_GAME_HARDENING_ADMIN_PROOF",
    fallback: devTestGameHardeningAdminProofPath,
  }),
  Object.freeze({
    id: "identity",
    label: "Identity admin proof",
    env: "FMARCH_DEV_TEST_GAME_IDENTITY_ADMIN_PROOF",
    fallback: devTestGameIdentityAdminProofPath,
  }),
  Object.freeze({
    id: "backup",
    label: "Backup admin proof",
    env: "FMARCH_DEV_TEST_GAME_BACKUP_ADMIN_PROOF",
    fallback: devTestGameBackupAdminProofPath,
  }),
  Object.freeze({
    id: "ops",
    label: "Ops admin proof",
    env: "FMARCH_DEV_TEST_GAME_OPS_ADMIN_PROOF",
    fallback: devTestGameOpsAdminProofPath,
  }),
  Object.freeze({
    id: "seed",
    label: "Seed admin proof",
    env: "FMARCH_DEV_TEST_GAME_SEED_ADMIN_PROOF",
    fallback: devTestGameSeedAdminProofPath,
  }),
  Object.freeze({
    id: "host-setup",
    label: "Host setup role proof",
    env: "FMARCH_DEV_TEST_GAME_HOST_SETUP_PROOF",
    fallback: DEFAULT_HOST_SETUP_PROOF,
  }),
  Object.freeze({
    id: "host-setup-admin",
    label: "Host setup admin proof",
    env: "FMARCH_DEV_TEST_GAME_HOST_SETUP_ADMIN_PROOF",
    fallback: devTestGameHostSetupAdminProofPath,
  }),
  Object.freeze({
    id: "release",
    label: "Release admin proof",
    env: "FMARCH_DEV_TEST_GAME_RELEASE_ADMIN_PROOF",
    fallback: devTestGameReleaseAdminProofPath,
  }),
  Object.freeze({
    id: "spine-manifest-admin",
    label: "Spine manifest admin proof",
    env: "FMARCH_DEV_TEST_GAME_SPINE_MANIFEST_ADMIN_PROOF",
    fallback: devTestGameSpineManifestAdminProofPath,
  }),
  Object.freeze({
    id: "admin-spine",
    label: "Admin spine proof",
    env: "FMARCH_DEV_TEST_GAME_ADMIN_SPINE_PROOF",
    fallback: DEFAULT_ADMIN_SPINE_PROOF,
  }),
  Object.freeze({
    id: "admin-spine-admin",
    label: "Admin spine role proof",
    env: "FMARCH_DEV_TEST_GAME_ADMIN_SPINE_ADMIN_PROOF",
    fallback: DEFAULT_ADMIN_SPINE_ADMIN_PROOF,
  }),
  Object.freeze({
    id: "proof-graph",
    label: "Proof graph",
    env: "FMARCH_DEV_TEST_GAME_PROOF_GRAPH",
    fallback: DEFAULT_PROOF_GRAPH,
  }),
  Object.freeze({
    id: "proof-graph-admin",
    label: "Proof graph admin proof",
    env: "FMARCH_DEV_TEST_GAME_PROOF_GRAPH_ADMIN_PROOF",
    fallback: DEFAULT_PROOF_GRAPH_ADMIN_PROOF,
  }),
  Object.freeze({
    id: "race-coverage",
    label: "Race coverage inventory",
    env: "FMARCH_DEV_TEST_GAME_RACE_COVERAGE",
    fallback: DEFAULT_RACE_COVERAGE,
  }),
  Object.freeze({
    id: "race-coverage-admin",
    label: "Race coverage admin proof",
    env: "FMARCH_DEV_TEST_GAME_RACE_COVERAGE_ADMIN_PROOF",
    fallback: DEFAULT_RACE_COVERAGE_ADMIN_PROOF,
  }),
  Object.freeze({
    id: "hosted-concurrent-race-matrix",
    label: "Hosted concurrent race matrix",
    env: "FMARCH_DEV_TEST_GAME_HOSTED_CONCURRENT_RACE_MATRIX",
    fallback: DEFAULT_HOSTED_CONCURRENT_RACE_MATRIX,
  }),
  Object.freeze({
    id: "hosted-concurrent-race-matrix-admin",
    label: "Hosted concurrent race matrix admin proof",
    env: "FMARCH_DEV_TEST_GAME_HOSTED_CONCURRENT_RACE_MATRIX_ADMIN_PROOF",
    fallback: DEFAULT_HOSTED_CONCURRENT_RACE_MATRIX_ADMIN_PROOF,
  }),
  Object.freeze({
    id: "hosted-identity-evidence",
    label: "Hosted identity evidence",
    env: "FMARCH_DEV_TEST_GAME_HOSTED_IDENTITY_EVIDENCE",
    fallback: DEFAULT_HOSTED_IDENTITY_EVIDENCE,
  }),
  Object.freeze({
    id: "hosted-identity-evidence-admin",
    label: "Hosted identity evidence admin proof",
    env: "FMARCH_DEV_TEST_GAME_HOSTED_IDENTITY_EVIDENCE_ADMIN_PROOF",
    fallback: DEFAULT_HOSTED_IDENTITY_EVIDENCE_ADMIN_PROOF,
  }),
  Object.freeze({
    id: "hosted-identity-progression-summary",
    label: "Hosted identity progression summary",
    env: "FMARCH_DEV_TEST_GAME_HOSTED_IDENTITY_PROGRESSION_SUMMARY",
    fallback: DEFAULT_HOSTED_IDENTITY_PROGRESSION_SUMMARY,
  }),
  Object.freeze({
    id: "hosted-ops-signals",
    label: "Hosted ops signals",
    env: "FMARCH_DEV_TEST_GAME_HOSTED_OPS_SIGNALS",
    fallback: DEFAULT_HOSTED_OPS_SIGNALS,
  }),
  Object.freeze({
    id: "real-hosted-observability-handoff",
    label: "Real hosted observability handoff",
    env: "FMARCH_DEV_TEST_GAME_REAL_HOSTED_OBSERVABILITY_HANDOFF",
    fallback: DEFAULT_REAL_HOSTED_OBSERVABILITY_HANDOFF,
  }),
  Object.freeze({
    id: "real-hosted-observability-handoff-admin",
    label: "Real hosted observability handoff admin proof",
    env: "FMARCH_DEV_TEST_GAME_REAL_HOSTED_OBSERVABILITY_HANDOFF_ADMIN_PROOF",
    fallback: DEFAULT_REAL_HOSTED_OBSERVABILITY_HANDOFF_ADMIN_PROOF,
  }),
  Object.freeze({
    id: "hosted-target-preflight",
    label: "Hosted target preflight",
    env: "FMARCH_DEV_TEST_GAME_HOSTED_TARGET_PREFLIGHT",
    fallback: DEFAULT_HOSTED_TARGET_PREFLIGHT,
  }),
  Object.freeze({
    id: "hosted-target-preflight-admin",
    label: "Hosted target preflight admin proof",
    env: "FMARCH_DEV_TEST_GAME_HOSTED_TARGET_PREFLIGHT_ADMIN_PROOF",
    fallback: DEFAULT_HOSTED_TARGET_PREFLIGHT_ADMIN_PROOF,
  }),
  Object.freeze({
    id: "hosted-evidence-lane",
    label: "Hosted evidence lane",
    env: "FMARCH_DEV_TEST_GAME_HOSTED_EVIDENCE_LANE",
    fallback: DEFAULT_HOSTED_EVIDENCE_LANE,
  }),
  Object.freeze({
    id: "hosted-evidence-lane-admin",
    label: "Hosted evidence lane admin proof",
    env: "FMARCH_DEV_TEST_GAME_HOSTED_EVIDENCE_LANE_ADMIN_PROOF",
    fallback: DEFAULT_HOSTED_EVIDENCE_LANE_ADMIN_PROOF,
  }),
  Object.freeze({
    id: "hosted-evidence-lane-demo",
    label: "Hosted evidence lane demo proof",
    env: "FMARCH_DEV_TEST_GAME_HOSTED_EVIDENCE_LANE_DEMO_PROOF",
    fallback: DEFAULT_HOSTED_EVIDENCE_LANE_DEMO_PROOF,
  }),
  Object.freeze({
    id: "release-runbook",
    label: "Release runbook",
    env: "FMARCH_DEV_TEST_GAME_RELEASE_RUNBOOK",
    fallback: DEFAULT_RELEASE_RUNBOOK,
  }),
  Object.freeze({
    id: "release-runbook-admin",
    label: "Release runbook admin proof",
    env: "FMARCH_DEV_TEST_GAME_RELEASE_RUNBOOK_ADMIN_PROOF",
    fallback: DEFAULT_RELEASE_RUNBOOK_ADMIN_PROOF,
  }),
]);

export async function readLocalOpsArtifacts({ env = process.env } = {}) {
  return await readLocalJsonArtifact({
    pathValue: env.FMARCH_DEV_TEST_GAME_OPS_ARTIFACTS,
    fallback: DEFAULT_OPS_ARTIFACTS,
  });
}

export async function readLocalHostedOpsSignals({ env = process.env } = {}) {
  return await readLocalJsonArtifact({
    pathValue: env.FMARCH_DEV_TEST_GAME_HOSTED_OPS_SIGNALS,
    fallback: DEFAULT_HOSTED_OPS_SIGNALS,
  });
}

export async function readLocalRealHostedObservabilityHandoff({
  env = process.env,
} = {}) {
  return await readLocalJsonArtifact({
    pathValue: env.FMARCH_DEV_TEST_GAME_REAL_HOSTED_OBSERVABILITY_HANDOFF,
    fallback: DEFAULT_REAL_HOSTED_OBSERVABILITY_HANDOFF,
  });
}

export async function readLocalHostedTargetPreflight({ env = process.env } = {}) {
  return await readLocalJsonArtifact({
    pathValue: env.FMARCH_DEV_TEST_GAME_HOSTED_TARGET_PREFLIGHT,
    fallback: DEFAULT_HOSTED_TARGET_PREFLIGHT,
  });
}

export async function readLocalHostedEvidenceLane({ env = process.env } = {}) {
  return await readLocalJsonArtifact({
    pathValue: env.FMARCH_DEV_TEST_GAME_HOSTED_EVIDENCE_LANE,
    fallback: DEFAULT_HOSTED_EVIDENCE_LANE,
  });
}

export async function readLocalHostedIdentityEvidence({
  env = process.env,
} = {}) {
  return await readLocalJsonArtifact({
    pathValue: env.FMARCH_DEV_TEST_GAME_HOSTED_IDENTITY_EVIDENCE,
    fallback: DEFAULT_HOSTED_IDENTITY_EVIDENCE,
  });
}

export async function readLocalHostedIdentityProgressionSummary({
  env = process.env,
} = {}) {
  return await readLocalJsonArtifact({
    pathValue: env.FMARCH_DEV_TEST_GAME_HOSTED_IDENTITY_PROGRESSION_SUMMARY,
    fallback: DEFAULT_HOSTED_IDENTITY_PROGRESSION_SUMMARY,
  });
}

export async function readLocalHostedEvidenceLaneDemoProof({
  env = process.env,
} = {}) {
  return await readLocalJsonArtifact({
    pathValue: env.FMARCH_DEV_TEST_GAME_HOSTED_EVIDENCE_LANE_DEMO_PROOF,
    fallback: DEFAULT_HOSTED_EVIDENCE_LANE_DEMO_PROOF,
  });
}

export async function readLocalDevTestGameProofRun({ env = process.env } = {}) {
  return await readLocalJsonArtifact({
    pathValue: env.FMARCH_DEV_TEST_GAME_PROOF_RUN,
    fallback: DEFAULT_DEV_TEST_GAME_PROOF_RUN,
  });
}

export async function readLocalSeedFixtureSummary({ env = process.env } = {}) {
  return await readLocalJsonArtifact({
    pathValue: env.FMARCH_DEV_TEST_GAME_SEED_FIXTURE_SUMMARY,
    fallback: DEFAULT_SEED_FIXTURE_SUMMARY,
  });
}

export async function readLocalReleaseReadinessChecklist({
  env = process.env,
} = {}) {
  return await readLocalJsonArtifact({
    pathValue: env.FMARCH_DEV_TEST_GAME_RELEASE_READINESS,
    fallback: DEFAULT_RELEASE_READINESS_CHECKLIST,
  });
}

export async function readLocalReleaseRunbook({ env = process.env } = {}) {
  return await readLocalJsonArtifact({
    pathValue: env.FMARCH_DEV_TEST_GAME_RELEASE_RUNBOOK,
    fallback: DEFAULT_RELEASE_RUNBOOK,
  });
}

export async function readLocalBackupRestoreProof({ env = process.env } = {}) {
  return await readLocalJsonArtifact({
    pathValue: env.FMARCH_DEV_TEST_GAME_BACKUP_RESTORE_PROOF,
    fallback: DEFAULT_BACKUP_RESTORE_PROOF,
  });
}

export async function readLocalIdentityAdapterProof({ env = process.env } = {}) {
  return await readLocalJsonArtifact({
    pathValue: env.FMARCH_DEV_TEST_GAME_IDENTITY_ADAPTER_PROOF,
    fallback: DEFAULT_IDENTITY_ADAPTER_PROOF,
  });
}

export async function readLocalSpineManifest({ env = process.env } = {}) {
  return await readLocalJsonArtifact({
    pathValue: env.FMARCH_DEV_TEST_GAME_SPINE_MANIFEST,
    fallback: DEFAULT_SPINE_MANIFEST,
  });
}

export async function readLocalAdminSpineProof({ env = process.env } = {}) {
  return await readLocalJsonArtifact({
    pathValue: env.FMARCH_DEV_TEST_GAME_ADMIN_SPINE_PROOF,
    fallback: DEFAULT_ADMIN_SPINE_PROOF,
  });
}

export async function readLocalAdminSpineTerminalBatches({
  env = process.env,
} = {}) {
  return await readLocalJsonArtifact({
    pathValue: env.FMARCH_DEV_TEST_GAME_ADMIN_SPINE_TERMINAL_BATCHES,
    fallback: DEFAULT_ADMIN_SPINE_TERMINAL_BATCHES,
  });
}

export async function readLocalNextAction({ env = process.env } = {}) {
  return await readLocalJsonArtifact({
    pathValue: env.FMARCH_DEV_TEST_GAME_NEXT_ACTION,
    fallback: DEFAULT_NEXT_ACTION,
  });
}

export async function readLocalProofGraph({ env = process.env } = {}) {
  return await readLocalJsonArtifact({
    pathValue: env.FMARCH_DEV_TEST_GAME_PROOF_GRAPH,
    fallback: DEFAULT_PROOF_GRAPH,
  });
}

export async function readLocalRaceCoverage({ env = process.env } = {}) {
  return await readLocalJsonArtifact({
    pathValue: env.FMARCH_DEV_TEST_GAME_RACE_COVERAGE,
    fallback: DEFAULT_RACE_COVERAGE,
  });
}

export async function readLocalHostedConcurrentRaceMatrix({
  env = process.env,
} = {}) {
  return await readLocalJsonArtifact({
    pathValue: env.FMARCH_DEV_TEST_GAME_HOSTED_CONCURRENT_RACE_MATRIX,
    fallback: DEFAULT_HOSTED_CONCURRENT_RACE_MATRIX,
  });
}

export async function readLocalProofFreshness({
  env = process.env,
  now = new Date(),
} = {}) {
  const maxAgeHours = Number.parseFloat(
    env.FMARCH_DEV_TEST_GAME_FRESHNESS_MAX_ARTIFACT_AGE_HOURS ??
      String(DEFAULT_MAX_ARTIFACT_AGE_HOURS),
  );
  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) {
    return null;
  }
  const maxAgeSeconds = Math.round(maxAgeHours * 60 * 60);
  const artifacts = await Promise.all(
    LOCAL_PROOF_FRESHNESS_ARTIFACTS.map((artifact) =>
      summarizeArtifactFreshness({ artifact, env, now, maxAgeSeconds }),
    ),
  );
  const freshCount = artifacts.filter((artifact) => artifact.status === "fresh").length;
  const staleCount = artifacts.filter((artifact) => artifact.status === "stale").length;
  const missingCount = artifacts.filter((artifact) => artifact.status === "missing").length;
  return Object.freeze({
    version: 1,
    proof: "dev-test-game-proof-freshness",
    status: staleCount === 0 && missingCount === 0 ? "passed" : "blocked",
    releaseReady: false,
    productionReady: false,
    generatedAt: now.toISOString(),
    scope: "local-dev-test-game-proof-freshness",
    proofBoundary:
      "Local proof freshness dashboard for generated dev-test-game artifacts. It checks file presence and mtime age only; it does not validate artifact contents, hosted operations, beta readiness, release readiness, or production readiness.",
    maxAgeHours,
    maxAgeSeconds,
    summary: Object.freeze({
      artifactCount: artifacts.length,
      freshCount,
      staleCount,
      missingCount,
    }),
    artifacts: Object.freeze(artifacts),
  });
}

async function readLocalJsonArtifact({ pathValue, fallback }) {
  const artifactPath =
    typeof pathValue === "string" && pathValue.trim() !== "" ? pathValue : fallback;
  const resolved = path.resolve(process.cwd(), artifactPath);
  try {
    return JSON.parse(await readFile(resolved, "utf8"));
  } catch {
    return null;
  }
}

async function summarizeArtifactFreshness({ artifact, env, now, maxAgeSeconds }) {
  const artifactPath = artifactPathForEnv({ env, name: artifact.env, fallback: artifact.fallback });
  const resolved = path.resolve(process.cwd(), artifactPath);
  try {
    const metadata = await stat(resolved);
    const ageSeconds = Math.max(0, Math.round((now.getTime() - metadata.mtime.getTime()) / 1000));
    return Object.freeze({
      id: artifact.id,
      label: artifact.label,
      path: artifactPath,
      status: ageSeconds <= maxAgeSeconds ? "fresh" : "stale",
      mtime: metadata.mtime.toISOString(),
      ageSeconds,
      maxAgeSeconds,
      sizeBytes: metadata.size,
    });
  } catch {
    return Object.freeze({
      id: artifact.id,
      label: artifact.label,
      path: artifactPath,
      status: "missing",
      maxAgeSeconds,
    });
  }
}

function artifactPathForEnv({ env, name, fallback }) {
  const value = env[name];
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}
