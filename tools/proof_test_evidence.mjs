import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { CARGO_TEST_EVIDENCE_FILE } from "./cargo_test_evidence.mjs";

export function parseEvidenceClaims(argv) {
  const claims = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== "--claim" || !argv[index + 1]?.includes(":")) {
      throw new Error(`unknown proof evidence argument ${argv[index]}`);
    }
    const [environment, ...testParts] = argv[index + 1].split(":");
    claims.push({ environment, test: testParts.join(":") });
    index += 1;
  }
  if (claims.length === 0) throw new Error("proof evidence requires at least one claim");
  return claims;
}

export function verifyEvidenceClaims(claims, env = process.env) {
  const reports = new Map();
  const verified = [];
  for (const claim of claims) {
    const directory = env[claim.environment];
    if (!directory) throw new Error(`proof evidence is missing ${claim.environment}`);
    if (!reports.has(directory)) {
      reports.set(directory, JSON.parse(readFileSync(join(directory, CARGO_TEST_EVIDENCE_FILE), "utf8")));
    }
    const report = reports.get(directory);
    if (report.schema !== 1 || report.kind !== "fmarch-cargo-test-evidence" || report.status !== "passed") {
      throw new Error(`cargo evidence from ${claim.environment} is not a passed schema-1 report`);
    }
    const matches = report.required_tests.filter((entry) => entry.required === claim.test);
    if (matches.length !== 1) {
      throw new Error(`cargo evidence does not uniquely prove ${claim.test}`);
    }
    verified.push({ ...claim, observed: matches[0].observed, producer_lane: report.lane_id });
  }
  return verified;
}

function main() {
  const verified = verifyEvidenceClaims(parseEvidenceClaims(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify({ status: "passed", verified })}\n`);
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
