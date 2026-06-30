import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const DEFAULT_OPS_ARTIFACTS = "target/dev-test-game/ops-artifacts.json";
const DEFAULT_DEV_TEST_GAME_PROOF_RUN = "target/dev-test-game/proof-run.json";
const DEFAULT_SEED_FIXTURE_SUMMARY = "target/dev-test-game/seed-fixture-summary.json";
const DEFAULT_RELEASE_READINESS_CHECKLIST =
  "target/dev-test-game/release-readiness-checklist.json";
const DEFAULT_BACKUP_RESTORE_PROOF =
  "target/live-stack-backup-restore-drill/local-backup-restore-proof.json";
const DEFAULT_IDENTITY_ADAPTER_PROOF =
  "target/auth-invite-role-proof/invite-role-proof.json";
const DEFAULT_SPINE_MANIFEST = "target/dev-test-game/spine-manifest.json";
const DEFAULT_ADMIN_SPINE_PROOF = "target/dev-test-game/admin-spine-proof.json";
const DEFAULT_ADMIN_SPINE_ADMIN_PROOF =
  "target/dev-test-game/admin-spine-admin-proof.json";
const DEFAULT_NEXT_ACTION = "target/dev-test-game/next-action.json";
const DEFAULT_PROOF_GRAPH = "target/dev-test-game/proof-graph.json";
const DEFAULT_PROOF_GRAPH_ADMIN_PROOF =
  "target/dev-test-game/proof-graph-admin-proof.json";
const DEFAULT_RACE_COVERAGE = "target/dev-test-game/race-coverage.json";
const DEFAULT_MAX_ARTIFACT_AGE_HOURS = 24;

const LOCAL_PROOF_FRESHNESS_ARTIFACTS = Object.freeze([
  Object.freeze({
    id: "session",
    label: "Dev test-game session",
    env: "FMARCH_DEV_TEST_GAME_SESSION",
    fallback: "target/dev-test-game/session.json",
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
    fallback: "target/dev-test-game/core-loop-admin-proof.json",
  }),
  Object.freeze({
    id: "hardening",
    label: "Hardening admin proof",
    env: "FMARCH_DEV_TEST_GAME_HARDENING_ADMIN_PROOF",
    fallback: "target/dev-test-game/hardening-admin-proof.json",
  }),
  Object.freeze({
    id: "identity",
    label: "Identity admin proof",
    env: "FMARCH_DEV_TEST_GAME_IDENTITY_ADMIN_PROOF",
    fallback: "target/dev-test-game/identity-admin-proof.json",
  }),
  Object.freeze({
    id: "backup",
    label: "Backup admin proof",
    env: "FMARCH_DEV_TEST_GAME_BACKUP_ADMIN_PROOF",
    fallback: "target/dev-test-game/backup-admin-proof.json",
  }),
  Object.freeze({
    id: "ops",
    label: "Ops admin proof",
    env: "FMARCH_DEV_TEST_GAME_OPS_ADMIN_PROOF",
    fallback: "target/dev-test-game/ops-admin-proof.json",
  }),
  Object.freeze({
    id: "seed",
    label: "Seed admin proof",
    env: "FMARCH_DEV_TEST_GAME_SEED_ADMIN_PROOF",
    fallback: "target/dev-test-game/seed-admin-proof.json",
  }),
  Object.freeze({
    id: "release",
    label: "Release admin proof",
    env: "FMARCH_DEV_TEST_GAME_RELEASE_ADMIN_PROOF",
    fallback: "target/dev-test-game/release-admin-proof.json",
  }),
  Object.freeze({
    id: "spine-manifest-admin",
    label: "Spine manifest admin proof",
    env: "FMARCH_DEV_TEST_GAME_SPINE_MANIFEST_ADMIN_PROOF",
    fallback: "target/dev-test-game/spine-manifest-admin-proof.json",
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
]);

export async function readLocalOpsArtifacts({ env = process.env } = {}) {
  return await readLocalJsonArtifact({
    pathValue: env.FMARCH_DEV_TEST_GAME_OPS_ARTIFACTS,
    fallback: DEFAULT_OPS_ARTIFACTS,
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
