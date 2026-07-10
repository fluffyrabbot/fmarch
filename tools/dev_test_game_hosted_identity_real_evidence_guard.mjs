import { realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { repoRoot } from "./dev_test_game_spine_runner.mjs";
import {
  hostedIdentityEvidenceFixturePaths,
} from "./dev_test_game_hosted_identity_evidence_cases.mjs";

export const hostedIdentityEvidencePathEnv =
  "FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH";

const fixtureDirectory = path.join("tools", "fixtures");

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  const evidencePath = await assertRealHostedIdentityEvidencePath();
  console.log(`accepted real hosted identity evidence path: ${evidencePath}`);
}

export async function assertRealHostedIdentityEvidencePath({
  env = process.env,
  root = repoRoot,
} = {}) {
  const configuredPath = String(env[hostedIdentityEvidencePathEnv] ?? "").trim();
  if (configuredPath === "") {
    throw new Error(
      `${hostedIdentityEvidencePathEnv} is required for the hosted identity evidence spine`,
    );
  }

  const resolvedPath = path.resolve(root, configuredPath);
  const realEvidencePath = await realpath(resolvedPath);
  const realFixtureDirectory = await realpath(path.resolve(root, fixtureDirectory));
  const normalizedFixturePaths = new Set(
    await Promise.all(
      hostedIdentityEvidenceFixturePaths.map(async (fixturePath) =>
        realpath(path.resolve(root, fixturePath)),
      ),
    ),
  );
  if (
    normalizedFixturePaths.has(realEvidencePath) ||
    isWithin(realFixtureDirectory, realEvidencePath)
  ) {
    throw new Error(
      `${hostedIdentityEvidencePathEnv} must point to an operator-provided non-fixture packet`,
    );
  }
  return realEvidencePath;
}

function isWithin(directory, candidate) {
  const relative = path.relative(directory, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}
