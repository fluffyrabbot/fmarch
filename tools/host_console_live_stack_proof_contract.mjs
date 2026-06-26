import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertLiveStackReadiness,
  buildLiveStackReadiness,
} from "./live_stack_readiness_contract.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultProofPath = path.join(
  repoRoot,
  "target",
  "host-console-live-stack-smoke",
  "live-stack-proof.json",
);
const proofPath = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : defaultProofPath;

const proof = JSON.parse(await readFile(proofPath, "utf8"));
if (proof.status !== "passed") {
  throw new Error(`live-stack proof status is ${proof.status}`);
}

const recalculated = buildLiveStackReadiness(proof);
assertLiveStackReadiness(recalculated);

if (JSON.stringify(proof.readiness) !== JSON.stringify(recalculated)) {
  throw new Error(
    `live-stack readiness is stale or missing in ${path.relative(repoRoot, proofPath)}`,
  );
}

console.log(
  `validated ${path.relative(repoRoot, proofPath)} (${recalculated.checks.length} checks)`,
);

