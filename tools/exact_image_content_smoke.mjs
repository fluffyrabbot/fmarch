#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const scriptPath = fileURLToPath(import.meta.url);
export const requiredExactImageEngine = "podman";

export const exactImageRuntimeBinaries = Object.freeze([
  "fmarch-server",
  "fmarch-migrate",
  "fmarch-schema-gate",
  "fmarch-schema-epoch-reset",
  "fmarch-staging-search-corpus",
  "fmarch-event-key-admin",
  "fmarch-profile-index-admin",
]);

export const exactImageTimingPhases = Object.freeze([
  "dockerfile_policy",
  "runtime_entrypoint_policy",
  "evidence_write",
]);

const runtimeValidationCheck = [
  'test "$(id -u)" = "10001"',
  ...exactImageRuntimeBinaries.map((binary) => `test -x /usr/local/bin/${binary}`),
  "test ! -e /packs",
  "test ! -e /programs",
  "test ! -e /app",
  "/usr/local/bin/fmarch-server --check-content",
].join(" && ");

function roundedMilliseconds(value) {
  return Math.max(0, Math.round(value * 1000) / 1000);
}

export function createExactImageTiming({ now = () => performance.now() } = {}) {
  const startedAt = now();
  const phases = [];
  let failedPhase;
  return {
    measure(name, operation) {
      if (!exactImageTimingPhases.includes(name)) {
        throw new Error(`unknown exact-image timing phase ${name}`);
      }
      if (phases.some((phase) => phase.name === name)) {
        throw new Error(`exact-image timing phase ${name} was recorded twice`);
      }
      const phaseStartedAt = now();
      try {
        const result = operation();
        phases.push({
          name,
          milliseconds: roundedMilliseconds(now() - phaseStartedAt),
          status: "ok",
        });
        return result;
      } catch (error) {
        failedPhase = name;
        phases.push({
          name,
          milliseconds: roundedMilliseconds(now() - phaseStartedAt),
          status: "failed",
        });
        throw error;
      }
    },
    snapshot() {
      const timing = {
        total_milliseconds: roundedMilliseconds(now() - startedAt),
        phases: [...phases],
      };
      if (failedPhase) timing.failed_phase = failedPhase;
      return timing;
    },
  };
}

export function assertCompleteExactImageTiming(timing) {
  if (!timing || typeof timing !== "object") {
    throw new Error("exact-image report has no timing object");
  }
  if (!Number.isFinite(timing.total_milliseconds) || timing.total_milliseconds < 0) {
    throw new Error("exact-image timing has an invalid total_milliseconds");
  }
  if (timing.failed_phase) {
    throw new Error(`exact-image timing failed during ${timing.failed_phase}`);
  }
  if (!Array.isArray(timing.phases) || timing.phases.length !== exactImageTimingPhases.length) {
    throw new Error("exact-image timing is missing one or more phases");
  }
  for (const [index, expectedName] of exactImageTimingPhases.entries()) {
    const phase = timing.phases[index];
    if (phase?.name !== expectedName || phase.status !== "ok") {
      throw new Error(`exact-image timing has an invalid ${expectedName} phase`);
    }
    if (!Number.isFinite(phase.milliseconds) || phase.milliseconds < 0) {
      throw new Error(`exact-image timing has an invalid ${expectedName} duration`);
    }
  }
  return true;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function artifactDirectory(env) {
  return resolve(env.FMARCH_PROOF_ARTIFACT_DIR ?? join(repoRoot, "target", "exact-image-content"));
}

function writeReport(reportPath, evidence) {
  writeFileSync(reportPath, `${JSON.stringify(evidence, null, 2)}\n`);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    env: options.env,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(`${command} ${args.join(" ")} could not start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const details = options.capture ? `\n${result.stdout}\n${result.stderr}` : "";
    throw new Error(`${command} ${args.join(" ")} failed (${result.status})${details}`);
  }
  return String(result.stdout ?? "");
}

export function resolveExactImageEngine(env = {}) {
  const requested = env.FMARCH_CONTAINER_ENGINE;
  if (requested && requested !== requiredExactImageEngine) {
    throw new Error(
      `FMARCH_CONTAINER_ENGINE=${requested} is not supported; ` +
        `runtime-image validation requires ${requiredExactImageEngine}`,
    );
  }
  return requiredExactImageEngine;
}

function availableEngine(env) {
  const engine = resolveExactImageEngine(env);
  const probe = spawnSync(engine, ["info"], { encoding: "utf8", stdio: "pipe" });
  if (probe.status === 0) return engine;
  throw new Error(`runtime-image validation requires a working ${engine} engine`);
}

export function assertImmutableRuntimeReference(reference) {
  if (!/^[^@\s]+@sha256:[0-9a-f]{64}$/u.test(reference ?? "")) {
    throw new Error("runtime validation requires an immutable repository@sha256 reference");
  }
  return reference;
}

function finalRuntimeStage(dockerfile) {
  const marker = "FROM runtime-base AS runtime";
  const markerIndex = dockerfile.indexOf(marker);
  if (markerIndex < 0) throw new Error(`Dockerfile must declare ${marker}`);
  return dockerfile.slice(markerIndex);
}

export function validateStaticRuntimePolicy({ dockerfile, serverSource }) {
  const runtime = finalRuntimeStage(dockerfile);
  const copies = [...runtime.matchAll(
    /^COPY --from=builder \/out\/([^\s]+) \/usr\/local\/bin\/([^\s]+)$/gmu,
  )];
  const copied = copies.map((match) => {
    if (match[1] !== match[2]) throw new Error(`runtime binary was renamed: ${match[1]} -> ${match[2]}`);
    return match[1];
  }).sort();
  const expected = [...exactImageRuntimeBinaries].sort();
  if (JSON.stringify(copied) !== JSON.stringify(expected)) {
    throw new Error(`runtime binary inventory drifted: expected ${expected}, found ${copied}`);
  }
  const copyLines = runtime.split("\n").filter((line) => /^COPY\s/u.test(line));
  if (copyLines.length !== copies.length) {
    throw new Error("runtime final stage may copy only the declared binaries from the builder");
  }
  for (const fragment of ["useradd --create-home --uid 10001 fmarch"]) {
    if (!dockerfile.includes(fragment)) throw new Error(`runtime base policy is missing ${fragment}`);
  }
  for (const fragment of ["USER fmarch", 'CMD ["/bin/false"]']) {
    if (!runtime.includes(fragment)) throw new Error(`runtime final stage is missing ${fragment}`);
  }
  for (const forbidden of ["/packs", "/programs", "/app"]) {
    if (runtime.includes(forbidden)) throw new Error(`runtime final stage includes forbidden ${forbidden}`);
  }
  if (!serverSource.includes('"--check-content"')) {
    throw new Error("fmarch-server must retain the --check-content entrypoint");
  }
  return {
    status: "passed",
    policy: "static-runtime-final-stage-v1",
    runtime_uid: 10001,
    binary_inventory: [...exactImageRuntimeBinaries],
    runtime_content_directories: false,
    check_content_entrypoint: "/usr/local/bin/fmarch-server --check-content",
    dockerfile_sha256: sha256(dockerfile),
  };
}

export function runExactImageContentSmoke({ env = process.env, now } = {}) {
  const outputDir = artifactDirectory(env);
  const reportPath = join(outputDir, "report.json");
  const timing = createExactImageTiming({ now });
  try {
    mkdirSync(outputDir, { recursive: true });
    const dockerfile = readFileSync(join(repoRoot, "Dockerfile"), "utf8");
    const serverSource = readFileSync(join(repoRoot, "crates", "server", "src", "main.rs"), "utf8");
    const policy = timing.measure("dockerfile_policy", () =>
      validateStaticRuntimePolicy({ dockerfile, serverSource }),
    );
    timing.measure("runtime_entrypoint_policy", () => {
      if (policy.check_content_entrypoint !== "/usr/local/bin/fmarch-server --check-content") {
        throw new Error("runtime check-content entrypoint drifted");
      }
    });
    const evidence = { ...policy };
    timing.measure("evidence_write", () => {
      evidence.timing = timing.snapshot();
      writeReport(reportPath, evidence);
    });
    evidence.timing = timing.snapshot();
    writeReport(reportPath, evidence);
    process.stdout.write(`${JSON.stringify(evidence)}\n`);
    return evidence;
  } catch (error) {
    const evidence = { status: "failed", error: errorMessage(error), timing: timing.snapshot() };
    mkdirSync(outputDir, { recursive: true });
    writeReport(reportPath, evidence);
    throw error;
  }
}

function parseContentReport(output, label) {
  try {
    return JSON.parse(output);
  } catch (error) {
    throw new Error(`${label} did not emit a JSON content report: ${errorMessage(error)}`);
  }
}

function compareRuntimeContent({ hostOutput, first, second, reference, engine }) {
  if (first !== second) throw new Error("runtime content check is not deterministic");
  const hostReport = parseContentReport(hostOutput, "host registry check");
  const report = parseContentReport(first, "runtime registry check");
  if (
    report.status !== "ok" ||
    report.pack_count !== 5 ||
    report.program_count !== 5 ||
    !/^[0-9a-f]{64}$/u.test(report.registry_hash ?? "") ||
    JSON.stringify(report.packs) !== JSON.stringify(hostReport.packs) ||
    JSON.stringify(report.programs) !== JSON.stringify(hostReport.programs) ||
    report.registry_hash !== hostReport.registry_hash
  ) {
    throw new Error("runtime content does not exactly match the checkout registry");
  }
  const base = {
    status: "passed",
    policy: "immutable-linux-amd64-runtime-v1",
    runtime_reference: reference,
    runtime_digest: reference.slice(reference.indexOf("@") + 1),
    platform: "linux/amd64",
    engine,
    runtime_uid: 10001,
    binary_inventory: [...exactImageRuntimeBinaries],
    runtime_content_directories: false,
    registry_hash: report.registry_hash,
    host_registry_hash: hostReport.registry_hash,
    pack_count: report.pack_count,
    program_count: report.program_count,
  };
  return { ...base, validation_report_sha256: sha256(JSON.stringify(base)) };
}

export function validateRuntimeImage({ reference, env = process.env, hostOutput = null } = {}) {
  assertImmutableRuntimeReference(reference);
  const engine = availableEngine(env);
  run(engine, ["pull", "--platform", "linux/amd64", reference], { capture: true, env });
  const checkoutReport = hostOutput ?? run(
    "python3",
    [
      "scripts/with-heavy-build-lock.py",
      "cargo",
      "run",
      "--quiet",
      "-p",
      "server",
      "--",
      "--check-content",
    ],
    { capture: true, env },
  ).trim();
  const first = run(
    engine,
    ["run", "--rm", "--platform", "linux/amd64", "--entrypoint", "/bin/sh", reference, "-c", runtimeValidationCheck],
    { capture: true, env },
  ).trim();
  const second = run(
    engine,
    ["run", "--rm", "--platform", "linux/amd64", reference, "/usr/local/bin/fmarch-server", "--check-content"],
    { capture: true, env },
  ).trim();
  return compareRuntimeContent({ hostOutput: checkoutReport, first, second, reference, engine });
}

export function main(argv = process.argv.slice(2), env = process.env) {
  if (argv.length > 0) throw new Error(`unknown exact-image-content argument ${argv[0]}`);
  return runExactImageContentSmoke({ env });
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  main();
}
