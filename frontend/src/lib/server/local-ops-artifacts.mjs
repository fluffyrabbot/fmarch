import { readFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_OPS_ARTIFACTS = "target/dev-test-game/ops-artifacts.json";
const DEFAULT_SEED_FIXTURE_SUMMARY = "target/dev-test-game/seed-fixture-summary.json";

export async function readLocalOpsArtifacts({ env = process.env } = {}) {
  return await readLocalJsonArtifact({
    pathValue: env.FMARCH_DEV_TEST_GAME_OPS_ARTIFACTS,
    fallback: DEFAULT_OPS_ARTIFACTS,
  });
}

export async function readLocalSeedFixtureSummary({ env = process.env } = {}) {
  return await readLocalJsonArtifact({
    pathValue: env.FMARCH_DEV_TEST_GAME_SEED_FIXTURE_SUMMARY,
    fallback: DEFAULT_SEED_FIXTURE_SUMMARY,
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
