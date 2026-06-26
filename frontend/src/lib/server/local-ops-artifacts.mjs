import { readFile } from "node:fs/promises";
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
