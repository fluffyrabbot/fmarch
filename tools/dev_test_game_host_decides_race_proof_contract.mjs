import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const devTestGameHostDecidesRaceProofPath =
  "target/dev-test-game/host-decides-race-proof.json";

export function assertDevTestGameHostDecidesRaceProof(proof) {
  const selectedSlot = proof?.selectedSlot;
  if (
    proof?.status !== "passed" ||
    proof?.promptId !== "D01:pk:Tie" ||
    proof?.ack?.state !== "ack" ||
    proof?.reject?.state !== "reject" ||
    proof?.reject?.error !== "PromptAlreadyResolved" ||
    !proof.reject.message?.includes("host prompt selection is stale") ||
    proof?.ack?.commandId === proof?.reject?.commandId ||
    !["slot-1", "slot-2"].includes(selectedSlot) ||
    proof?.resolvedPrompt?.status !== "resolved" ||
    proof?.resolvedPrompt?.decision?.slot !== selectedSlot ||
    proof?.playerStates?.[selectedSlot]?.actorAlive !== false ||
    Object.values(proof?.playerStates ?? {}).filter(
      (state) => state?.actorAlive === true,
    ).length !== 1 ||
    proof?.roleReloadAfterRace?.status !== "passed" ||
    proof.roleReloadAfterRace.hostRouteStatuses?.length !== 2 ||
    !proof.roleReloadAfterRace.hostRouteStatuses.every(
      (status) => status === 200,
    ) ||
    proof.roleReloadAfterRace.playerRouteStatuses?.length !== 2 ||
    !proof.roleReloadAfterRace.playerRouteStatuses.every(
      (status) => status === 200,
    ) ||
    !proof.roleReloadAfterRace.hostPromptActions?.every(
      (actions) => Array.isArray(actions) && actions.length === 0,
    ) ||
    proof.roleReloadAfterRace.playerStates?.[selectedSlot]?.actorAlive !== false ||
    typeof proof?.sourceRoleUrls?.host !== "string" ||
    !proof.sourceRoleUrls.host.includes("/g/")
  ) {
    throw new Error("HostDecides race browser proof contract drifted");
  }
  return proof;
}

export function devTestGameHostDecidesRaceProofSummary(proof) {
  const validated = assertDevTestGameHostDecidesRaceProof(proof);
  return Object.freeze({
    status: validated.status,
    promptId: validated.promptId,
    selectedSlot: validated.selectedSlot,
    ackPageRole: validated.ackPageRole,
    rejectPageRole: validated.rejectPageRole,
    rejectError: validated.reject.error,
    hostReloadCount: validated.roleReloadAfterRace.hostRouteStatuses.length,
    playerReloadCount: validated.roleReloadAfterRace.playerRouteStatuses.length,
    hostRoleUrl: validated.sourceRoleUrls.host,
  });
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  const proofPath = path.join(
    repoRoot,
    process.env.FMARCH_DEV_TEST_GAME_HOST_DECIDES_RACE_PROOF ??
      devTestGameHostDecidesRaceProofPath,
  );
  assertDevTestGameHostDecidesRaceProof(
    JSON.parse(await readFile(proofPath, "utf8")),
  );
  console.log(
    `HostDecides race browser proof passed: ${path.relative(repoRoot, proofPath)}`,
  );
}
