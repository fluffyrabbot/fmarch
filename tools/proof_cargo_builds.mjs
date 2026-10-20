// A harness must name the same binary/profile pair that its proof input model
// fingerprints. Keep runtime arguments separate from Cargo's build selection.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

const manifestUrl = new URL("../docs/ops/proof-lane-manifest.json", import.meta.url);
const binaryTarget = /^([A-Za-z0-9_-]+)\/bin\/([A-Za-z0-9_-]+)$/;
const profiles = new Set(["dev", "release"]);

// A runner-prebuilt lane names its build plan here; see proof_prebuild.mjs.
export const PREBUILT_PLAN_ENV = "FMARCH_PROOF_PREBUILT_PLAN";
export const PREBUILD_PLAN_SCHEMA = 1;

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

export function readPrebuildPlan(planPath, kind) {
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  if (plan?.schema !== PREBUILD_PLAN_SCHEMA || plan.kind !== kind) {
    throw new Error(`prebuild plan ${planPath} is not a schema-${PREBUILD_PLAN_SCHEMA} ${kind} plan`);
  }
  return plan;
}

/**
 * The lane's prebuilt executable for an exact package/bin/profile, or null
 * when no runner prebuild plan exists. Inside a plan an undeclared binary is
 * an error, never a silent Cargo fallback: the run phase holds no Cargo lock.
 */
export function prebuiltBinary({ target, profile = "dev", env = process.env }) {
  validateCargoBuilds({ builds: [{ target, profile }] }, "requested prebuilt binary");
  const planPath = env[PREBUILT_PLAN_ENV] ?? process.env[PREBUILT_PLAN_ENV];
  if (!planPath) return null;
  const plan = readPrebuildPlan(planPath, "cargo-builds");
  const path = plan.binaries?.[`${target}@${profile}`];
  if (!path) throw new Error(`proof lane ${plan.lane_id} has no prebuilt ${target} (${profile}); declare it in cargo_inputs`);
  if (!isAbsolute(path) || !existsSync(path)) throw new Error(`prebuilt ${target} (${profile}) is missing: ${path}`);
  return path;
}

/**
 * `spawn` arguments for one declared binary: the lane's prebuilt executable
 * when the runner built it, otherwise `cargo run` for direct developer runs.
 */
export function proofBinarySpawn({ args = [], ...options }) {
  const executable = prebuiltBinary(options);
  return executable ? [executable, [...args]] : ["cargo", proofCargoArgs({ ...options, args })];
}

/** As proofBinarySpawn, but entering Cargo through the shared host lock. */
export function lockedProofBinaryCommand({ cwd, args = [], ...options }) {
  const executable = prebuiltBinary(options);
  if (executable) return Object.freeze({ command: executable, args: Object.freeze([...args]) });
  return lockedProofCargoInvocation({ cwd, args, ...options });
}

/** Absolute path of one declared binary, building it under the host lock if no plan exists. */
export async function proofBinaryPath({ cwd, spawnProcess = spawn, ...options }) {
  const executable = prebuiltBinary(options);
  if (executable) return executable;
  const invocation = lockedProofCargoInvocation({ cwd, ...options, command: "build" });
  const output = await new Promise((resolve, reject) => {
    const child = spawnProcess(invocation.command, [...invocation.args, "--message-format=json-render-diagnostics"], {
      cwd, env: options.env ?? process.env, stdio: ["ignore", "pipe", "inherit"],
    });
    let stdout = "";
    child.stdout.on("data", chunk => { stdout += chunk.toString(); });
    child.once("error", reject);
    child.once("close", (code, signal) => code === 0 ? resolve(stdout)
      : reject(new Error(`cargo build ${options.target} exited code=${code} signal=${signal ?? "none"}`)));
  });
  const [packageName, , name] = options.target.split("/");
  const executables = output.split("\n").flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } })
    .filter(item => item.reason === "compiler-artifact" && item.target?.name === name && item.target.kind?.includes("bin") &&
      typeof item.executable === "string" && isAbsolute(item.executable) &&
      dirname(item.manifest_path).endsWith(`/${packageName}`));
  if (executables.length !== 1) throw new Error(`Cargo did not identify exactly one ${options.target} executable`);
  return executables[0].executable;
}
