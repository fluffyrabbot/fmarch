import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertLiveStackReadiness,
  buildLiveStackReadiness,
} from "./live_stack_readiness_contract.mjs";
import {
  assertLiveStackProofSummary,
  buildLiveStackProofSummary,
} from "./live_stack_proof_summary.mjs";

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
const summaryPath = process.argv[3]
  ? path.resolve(process.cwd(), process.argv[3])
  : path.join(path.dirname(proofPath), "live-stack-summary.json");

const proof = JSON.parse(await readFile(proofPath, "utf8"));
if (proof.status !== "passed") {
  throw new Error(`live-stack proof status is ${proof.status}`);
}
const summary = JSON.parse(await readFile(summaryPath, "utf8"));

const recalculated = buildLiveStackReadiness(proof);
assertLiveStackReadiness(recalculated);

if (JSON.stringify(proof.readiness) !== JSON.stringify(recalculated)) {
  throw new Error(
    `live-stack readiness is stale or missing in ${path.relative(repoRoot, proofPath)}`,
  );
}

const recalculatedSummary = buildLiveStackProofSummary(proof, {
  generatedAt: summary.generatedAt,
  proofPath: path.relative(repoRoot, proofPath),
});
assertLiveStackProofSummary(recalculatedSummary);

if (JSON.stringify(summary) !== JSON.stringify(recalculatedSummary)) {
  throw new Error(
    `live-stack summary is stale or missing in ${path.relative(repoRoot, summaryPath)}`,
  );
}

console.log(
  `validated ${path.relative(repoRoot, proofPath)} and ${path.relative(
    repoRoot,
    summaryPath,
  )} (${recalculated.checks.length} checks)`,
);
