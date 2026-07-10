import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const devTestGameEarliestReachedProofPath =
  "target/dev-test-game/earliest-reached-proof.json";

export function assertDevTestGameEarliestReachedProof(proof) {
  if (
    proof?.status !== "passed" ||
    proof?.pack !== "dev_test_earliest_reached" ||
    proof?.tieBreaker !== "EarliestReached" ||
    proof?.outcome?.winner_slot !== "slot-2" ||
    proof?.outcome?.tiebreak !== "EarliestReached" ||
    proof?.outcome?.tallies?.["slot-1"] !== 2 ||
    proof?.outcome?.tallies?.["slot-2"] !== 2 ||
    !Array.isArray(proof?.ballotProofs) ||
    proof.ballotProofs.length !== 4 ||
    typeof proof?.sourceRoleUrls?.host !== "string" ||
    !proof.sourceRoleUrls.host.includes("/g/")
  ) {
    throw new Error("EarliestReached browser proof contract drifted");
  }
  return proof;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  const proofPath = path.join(
    repoRoot,
    process.env.FMARCH_DEV_TEST_GAME_EARLIEST_REACHED_PROOF ??
      devTestGameEarliestReachedProofPath,
  );
  assertDevTestGameEarliestReachedProof(
    JSON.parse(await readFile(proofPath, "utf8")),
  );
  console.log(`EarliestReached browser proof passed: ${path.relative(repoRoot, proofPath)}`);
}
