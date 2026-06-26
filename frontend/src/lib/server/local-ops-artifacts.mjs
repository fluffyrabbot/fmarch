import { readFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_OPS_ARTIFACTS = "target/dev-test-game/ops-artifacts.json";

export async function readLocalOpsArtifacts({ env = process.env } = {}) {
  const artifactPath =
    typeof env.FMARCH_DEV_TEST_GAME_OPS_ARTIFACTS === "string" &&
    env.FMARCH_DEV_TEST_GAME_OPS_ARTIFACTS.trim() !== ""
      ? env.FMARCH_DEV_TEST_GAME_OPS_ARTIFACTS
      : DEFAULT_OPS_ARTIFACTS;
  const resolved = path.resolve(process.cwd(), artifactPath);
  try {
    return JSON.parse(await readFile(resolved, "utf8"));
  } catch {
    return null;
  }
}
