// A harness must name the same binary/profile pair that its proof input model
// fingerprints. Keep runtime arguments separate from Cargo's build selection.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const manifestUrl = new URL("../docs/ops/proof-lane-manifest.json", import.meta.url);
const binaryTarget = /^([A-Za-z0-9_-]+)\/bin\/([A-Za-z0-9_-]+)$/;
const profiles = new Set(["dev", "release"]);

function record(value, label, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new Error(`${label} has unknown field ${key}`);
  }
}

/** Validate declarations without loading Cargo or executing a build. */
export function validateCargoBuilds(value, label = "proof Cargo inputs") {
  record(value, label, ["builds"]);
  if (!Array.isArray(value.builds)) throw new Error(`${label}.builds must be an array`);
  const seen = new Set();
  for (const build of value.builds) {
    record(build, `${label} build`, ["target", "profile"]);
    if (typeof build.target !== "string" || !binaryTarget.test(build.target)) {
      throw new Error(`${label} build must name an exact package/bin/target`);
    }
    if (!profiles.has(build.profile)) throw new Error(`${label} build has unknown profile ${build.profile}`);
    const identity = build.target;
    if (seen.has(identity)) throw new Error(`${label} has duplicate build ${identity}`);
    seen.add(identity);
  }
  return value.builds;
}

/**
 * Explicit lane IDs also validate direct npm harness runs. The runner's lane
 * cannot be silently replaced by a different lane with a broader declaration.
 * Generic local development callers may omit a lane, but still name one binary.
 */
export function proofCargoArgs({
  laneId,
  target,
  profile = "dev",
  command = "run",
  quiet = false,
  args = [],
  env = process.env,
  manifest,
}) {
  validateCargoBuilds({ builds: [{ target, profile }] }, "requested Cargo build");
  if (!["run", "build"].includes(command)) throw new Error(`unsupported proof Cargo command ${command}`);
  if (!Array.isArray(args) || args.some(argument => typeof argument !== "string")) {
    throw new Error("proof binary arguments must be strings");
  }
  if (command === "build" && args.length !== 0) throw new Error("Cargo build cannot receive binary arguments");
  if (laneId && env.FMARCH_PROOF_LANE_ID && laneId !== env.FMARCH_PROOF_LANE_ID) {
    throw new Error(`proof Cargo lane mismatch: ${laneId} != ${env.FMARCH_PROOF_LANE_ID}`);
  }
  const effectiveLane = laneId ?? env.FMARCH_PROOF_LANE_ID;
  if (effectiveLane) {
    const source = manifest ?? JSON.parse(readFileSync(manifestUrl, "utf8"));
    const lane = source.lanes?.[effectiveLane];
    if (!lane) throw new Error(`unknown proof Cargo lane ${effectiveLane}`);
    const builds = validateCargoBuilds(lane.cargo_inputs, `proof lane ${effectiveLane} Cargo inputs`);
    if (!builds.some(build => build.target === target && build.profile === profile)) {
      throw new Error(`proof lane ${effectiveLane} does not declare ${target} with profile ${profile}`);
    }
  }
  const [, packageName, name] = binaryTarget.exec(target);
  return [command, "--locked", ...(quiet ? ["--quiet"] : []), "--profile", profile,
    "-p", packageName, "--bin", name, ...(args.length ? ["--", ...args] : [])];
}

/** All migration/build-only entrypoints retain the shared host admission lock. */
export function lockedProofCargoInvocation({ cwd, ...options }) {
  return Object.freeze({
    command: "python3",
    args: Object.freeze([join(cwd, "scripts", "with-heavy-build-lock.py"), "--", "cargo", ...proofCargoArgs(options)]),
  });
}
