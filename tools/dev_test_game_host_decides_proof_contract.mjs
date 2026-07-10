import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { matchesDayVoteElimination } from "./dev_test_game_host_prompt_public_resolution.mjs";

export const devTestGameHostDecidesProofPath =
  "target/dev-test-game/host-decides-proof.json";

export function assertDevTestGameHostDecidesProof(proof) {
  const requiredActions = [
    "resolve_host_prompt-D01-pk-Tie-slot-1",
    "resolve_host_prompt-D01-pk-Tie-slot-2",
  ];
  if (
    proof?.status !== "passed" ||
    proof?.pack !== "epicmafia" ||
    proof?.tieBreaker !== "HostDecides" ||
    proof?.outcome?.status !== "Lynch" ||
    proof?.outcome?.winner_slot !== "slot-2" ||
    proof?.outcome?.tiebreak !== "HostDecides" ||
    proof?.outcome?.reason !== "host_decides_tie" ||
    proof?.outcome?.tallies?.["slot-1"] !== 2 ||
    proof?.outcome?.tallies?.["slot-2"] !== 2 ||
    !Array.isArray(proof?.ballotProofs) ||
    proof.ballotProofs.length !== 4 ||
    !requiredActions.every((actionId) => proof?.promptActions?.includes(actionId)) ||
    proof?.selectedSlot !== "slot-2" ||
    proof?.selection?.commandStatus?.state !== "ack" ||
    proof?.resolvedPrompt?.status !== "resolved" ||
    proof?.resolvedPrompt?.decision?.slot !== "slot-2" ||
    !matchesDayVoteElimination(proof?.resolvedPrompt, {
      phaseId: "D01",
      selectedSlot: "slot-2",
      reason: "host_decides_tie",
    }) ||
    proof?.targetBeforeDecision?.actorAlive !== true ||
    proof?.targetAfterDecision?.actorAlive !== false ||
    !proof?.hostOutcomePanel?.includes("HostDecides selected Slot 2") ||
    !proof?.targetOutcomePanel?.includes("HostDecides selected Slot 2") ||
    typeof proof?.sourceRoleUrls?.host !== "string" ||
    !proof.sourceRoleUrls.host.includes("/g/")
  ) {
    throw new Error("HostDecides browser proof contract drifted");
  }
  return proof;
}

export function devTestGameHostDecidesProofSummary(proof) {
  const validated = assertDevTestGameHostDecidesProof(proof);
  return Object.freeze({
    status: validated.status,
    pack: validated.pack,
    tieBreaker: validated.tieBreaker,
    promptId: validated.promptId,
    contenderCount: validated.promptActions.length,
    selectedSlot: validated.selectedSlot,
    targetAliveBefore: validated.targetBeforeDecision.actorAlive,
    targetAliveAfter: validated.targetAfterDecision.actorAlive,
    hostRoleUrl: validated.sourceRoleUrls.host,
  });
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  const proofPath = path.join(
    repoRoot,
    process.env.FMARCH_DEV_TEST_GAME_HOST_DECIDES_PROOF ??
      devTestGameHostDecidesProofPath,
  );
  assertDevTestGameHostDecidesProof(
    JSON.parse(await readFile(proofPath, "utf8")),
  );
  console.log(
    `HostDecides browser proof passed: ${path.relative(repoRoot, proofPath)}`,
  );
}
