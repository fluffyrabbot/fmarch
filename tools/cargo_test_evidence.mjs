import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const CARGO_TEST_EVIDENCE_FILE = "cargo-test-evidence.json";

export function passedRustTestNames(output) {
  const plain = String(output).replaceAll(/\u001b\[[0-9;]*m/gu, "");
  return [...plain.matchAll(/^test (.+?) \.\.\. ok$/gmu)].map((match) => match[1]);
}

export function matchRequiredTests(passed, required) {
  return required.map((name) => {
    const matches = passed.filter((candidate) => candidate === name || candidate.endsWith(`::${name}`));
    if (matches.length !== 1) {
      throw new Error(
        `required Rust test ${name} matched ${matches.length} passed test bodies; expected exactly one`,
      );
    }
    return { required: name, observed: matches[0] };
  });
}

export function parseCargoEvidenceArguments(argv) {
  const separator = argv.indexOf("--");
  if (separator < 0 || separator === argv.length - 1) {
    throw new Error("usage: cargo_test_evidence.mjs --required NAME ... -- cargo test ...");
  }
  const required = [];
  for (let index = 0; index < separator; index += 1) {
    if (argv[index] !== "--required" || !argv[index + 1]) {
      throw new Error(`unknown cargo evidence argument ${argv[index]}`);
    }
    required.push(argv[index + 1]);
    index += 1;
  }
  if (required.length === 0 || new Set(required).size !== required.length) {
    throw new Error("cargo evidence requires unique named test claims");
  }
  return { required, command: argv.slice(separator + 1) };
}

export async function runCargoTestEvidence({
  argv,
  env = process.env,
  outputDir = env.FMARCH_PROOF_ARTIFACT_DIR,
  now = Date.now,
  spawnCommand = spawn,
} = {}) {
  if (!outputDir) throw new Error("cargo test evidence requires FMARCH_PROOF_ARTIFACT_DIR");
  const { required, command } = parseCargoEvidenceArguments(argv);
  mkdirSync(outputDir, { recursive: true });
  const started = now();
  let testBodyStarted = null;
  let output = "";
  const child = spawnCommand(command[0], command.slice(1), {
    env: { ...env, CARGO_TERM_COLOR: "never" },
    stdio: ["inherit", "pipe", "pipe"],
  });
  for (const [stream, destination] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
    stream?.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      if (testBodyStarted === null && /(?:^|\n)running \d+ tests?(?:\n|$)/u.test(output)) {
        testBodyStarted = now();
      }
      destination.write(chunk);
    });
  }
  const result = await new Promise((resolveResult, rejectResult) => {
    child.once("error", rejectResult);
    child.once("close", (status, signal) => resolveResult({ status, signal }));
  });
  const passed = passedRustTestNames(output);
  let claims = [];
  let claimError = null;
  try {
    claims = matchRequiredTests(passed, required);
  } catch (error) {
    claimError = error.message;
  }
  const finished = now();
  const totalSeconds = Math.round((finished - started) / 100) / 10;
  const compileAndDiscoverySeconds = Math.round(((testBodyStarted ?? finished) - started) / 100) / 10;
  const report = {
    schema: 1,
    kind: "fmarch-cargo-test-evidence",
    status: result.status === 0 && !claimError ? "passed" : "failed",
    lane_id: env.FMARCH_PROOF_LANE_ID ?? null,
    command,
    exit_code: result.status,
    signal: result.signal,
    seconds: totalSeconds,
    timing: {
      compile_and_discovery_seconds: compileAndDiscoverySeconds,
      test_body_seconds: Math.round((finished - (testBodyStarted ?? finished)) / 100) / 10,
      total_seconds: totalSeconds,
    },
    required_tests: claims,
    passed_test_names: passed,
    error: claimError,
  };
  writeFileSync(join(outputDir, CARGO_TEST_EVIDENCE_FILE), `${JSON.stringify(report, null, 2)}\n`);
  if (result.status !== 0) return result.status ?? 1;
  if (claimError) throw new Error(claimError);
  return 0;
}

async function main() {
  process.exitCode = await runCargoTestEvidence({ argv: process.argv.slice(2) });
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
