#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const scriptPath = fileURLToPath(import.meta.url);
const defaultCacheNamespace = "fmarch-exact-image-rust-1.95";

export const exactImageTimingPhases = Object.freeze([
  "engine_probe",
  "host_content_check",
  "image_build",
  "runtime_integrity_check",
  "runtime_content_check",
  "evidence_compare",
]);

const checkScript = [
  'test "$(id -u)" = "10001"',
  "test -x /usr/local/bin/fmarch-server",
  "test -x /usr/local/bin/fmarch-migrate",
  "test -x /usr/local/bin/fmarch-schema-gate",
  "test -x /usr/local/bin/fmarch-event-key-admin",
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
  if (!Array.isArray(timing.phases)) {
    throw new Error("exact-image timing has no phases array");
  }
  if (timing.phases.length !== exactImageTimingPhases.length) {
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

export function parseExactImageArguments(argv) {
  const argumentsSet = new Set(argv);
  for (const argument of argumentsSet) {
    if (argument !== "--cache-profile" && argument !== "--single") {
      throw new Error(`unknown exact-image-content argument ${argument}`);
    }
  }
  if (argumentsSet.has("--cache-profile") && argumentsSet.has("--single")) {
    throw new Error("--cache-profile and --single cannot be combined");
  }
  return { cacheProfile: argumentsSet.has("--cache-profile") };
}

function artifactDirectory(env) {
  return resolve(env.FMARCH_PROOF_ARTIFACT_DIR ?? join(repoRoot, "target", "exact-image-content"));
}

function cacheNamespace(env) {
  const namespace = env.FMARCH_EXACT_IMAGE_CACHE_NAMESPACE ?? defaultCacheNamespace;
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(namespace)) {
    throw new Error("FMARCH_EXACT_IMAGE_CACHE_NAMESPACE must be a safe cache identifier");
  }
  return namespace;
}

function freshCacheNamespace() {
  return `fmarch-exact-profile-${process.pid}-${Date.now().toString(36)}`;
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
  });
  if (result.error) {
    throw new Error(`${command} ${args.join(" ")} could not start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const details = options.capture ? `\n${result.stdout}\n${result.stderr}` : "";
    throw new Error(`${command} ${args.join(" ")} failed (${result.status})${details}`);
  }
  return result.stdout ?? "";
}

function containerBuildEnvironment(engine, env) {
  return engine === "docker" ? { ...env, DOCKER_BUILDKIT: "1" } : env;
}

function availableEngine(env) {
  const requested = env.FMARCH_CONTAINER_ENGINE;
  const candidates = requested ? [requested] : ["docker", "podman"];
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["info"], { encoding: "utf8", stdio: "pipe" });
    if (probe.status === 0) return candidate;
  }
  throw new Error(
    `no working container engine found (tried ${candidates.join(", ")}); ` +
      "set FMARCH_CONTAINER_ENGINE to the exact Docker-compatible engine",
  );
}

function writeReport(reportPath, evidence) {
  writeFileSync(reportPath, `${JSON.stringify(evidence, null, 2)}\n`);
}

function exactContentEvidence({ hostOutput, first, second, imageId, engine }) {
  if (first !== second) {
    throw new Error(`content check is not deterministic:\nfirst=${first}\nsecond=${second}`);
  }
  const hostReport = JSON.parse(hostOutput);
  const report = JSON.parse(first);
  const packKeys = report.packs?.map((pack) => pack.key).sort();
  const programIds = report.programs?.map((program) => program.id).sort();
  const expectedPackKeys = [
    "chinese_structured",
    "default_open",
    "epicmafia",
    "mafia_universe",
    "mafiascum",
  ];
  const expectedProgramIds = [
    "host-judged-showcase",
    "mash-scale-acceptance",
    "opt-in-quest",
    "private-opt-in-circle",
    "raffle",
  ];
  const packRefsMatchHost = JSON.stringify(report.packs) === JSON.stringify(hostReport.packs);
  const programRefsMatchHost =
    JSON.stringify(report.programs) === JSON.stringify(hostReport.programs);
  if (
    report.status !== "ok" ||
    report.pack_count !== 5 ||
    report.program_count !== 5 ||
    !/^[0-9a-f]{64}$/.test(report.registry_hash) ||
    JSON.stringify(packKeys) !== JSON.stringify(expectedPackKeys) ||
    JSON.stringify(programIds) !== JSON.stringify(expectedProgramIds) ||
    report.registry_hash !== hostReport.registry_hash ||
    report.pack_count !== hostReport.pack_count ||
    report.program_count !== hostReport.program_count ||
    !packRefsMatchHost ||
    !programRefsMatchHost
  ) {
    throw new Error(
      `image content does not exactly match the host registry:\nhost=${hostOutput}\nimage=${first}`,
    );
  }
  return {
    status: "ok",
    engine,
    image_id: imageId,
    runtime_uid: 10001,
    event_key_admin_binary: true,
    runtime_content_directories: false,
    registry_hash: report.registry_hash,
    host_registry_match: true,
    exact_pack_refs: report.packs,
    exact_program_refs: report.programs,
    pack_count: report.pack_count,
    program_count: report.program_count,
  };
}

export function runExactImageContentSmoke({ env = process.env, now } = {}) {
  const outputDir = artifactDirectory(env);
  const reportPath = join(outputDir, "report.json");
  const cache = cacheNamespace(env);
  const timing = createExactImageTiming({ now });
  let engine;
  let image;
  let scratch;

  try {
    mkdirSync(outputDir, { recursive: true });
    engine = timing.measure("engine_probe", () => availableEngine(env));
    image = `localhost/fmarch-exact-content:${process.pid}`;
    scratch = mkdtempSync(join(tmpdir(), "fmarch-exact-image-"));
    const iidFile = join(scratch, "image-id");
    const hostOutput = timing.measure("host_content_check", () =>
      run("cargo", ["run", "--quiet", "-p", "server", "--", "--check-content"], {
        capture: true,
      }).trim(),
    );
    timing.measure("image_build", () =>
      run(engine, [
        "build",
        "--file",
        "Dockerfile",
        "--tag",
        image,
        "--iidfile",
        iidFile,
        "--build-arg",
        `FMARCH_CARGO_CACHE_NAMESPACE=${cache}`,
        ".",
      ], { env: containerBuildEnvironment(engine, env) }),
    );
    const imageId = readFileSync(iidFile, "utf8").trim();
    if (!imageId) throw new Error("container build did not report an immutable image id");
    const first = timing.measure("runtime_integrity_check", () =>
      run(engine, ["run", "--rm", "--entrypoint", "/bin/sh", imageId, "-c", checkScript], {
        capture: true,
      }).trim(),
    );
    const second = timing.measure("runtime_content_check", () =>
      run(engine, ["run", "--rm", imageId, "/usr/local/bin/fmarch-server", "--check-content"], {
        capture: true,
      }).trim(),
    );
    const evidence = timing.measure("evidence_compare", () =>
      exactContentEvidence({ hostOutput, first, second, imageId, engine }),
    );
    evidence.cache_namespace = cache;
    evidence.timing = timing.snapshot();
    writeReport(reportPath, evidence);
    process.stdout.write(`${JSON.stringify(evidence)}\n`);
    return evidence;
  } catch (error) {
    const evidence = {
      status: "failed",
      error: errorMessage(error),
      cache_namespace: cache,
      timing: timing.snapshot(),
    };
    mkdirSync(outputDir, { recursive: true });
    writeReport(reportPath, evidence);
    throw error;
  } finally {
    if (engine && image) {
      spawnSync(engine, ["image", "rm", "--force", image], { stdio: "ignore" });
    }
    if (scratch) {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
}

function profilePass({ label, outputDir, cache, env }) {
  const child = spawnSync(process.execPath, [scriptPath, "--single"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "inherit",
    env: {
      ...env,
      FMARCH_PROOF_ARTIFACT_DIR: outputDir,
      FMARCH_EXACT_IMAGE_CACHE_NAMESPACE: cache,
    },
  });
  const reportPath = join(outputDir, "report.json");
  let report;
  try {
    report = JSON.parse(readFileSync(reportPath, "utf8"));
  } catch (error) {
    throw new Error(`${label} cache-profile pass did not write ${reportPath}: ${errorMessage(error)}`);
  }
  if (child.error) {
    throw new Error(`${label} cache-profile pass could not start: ${child.error.message}`);
  }
  if (child.status !== 0) {
    throw new Error(`${label} cache-profile pass failed (${child.status}): ${report.error ?? "no evidence"}`);
  }
  if (report.status !== "ok") {
    throw new Error(`${label} cache-profile pass did not report success`);
  }
  if (report.cache_namespace !== cache) {
    throw new Error(`${label} cache-profile pass did not use its owned cache namespace`);
  }
  assertCompleteExactImageTiming(report.timing);
  return report;
}

function cacheProfileEvidence(report, relativePath) {
  return {
    report: relativePath,
    image_build_milliseconds: report.timing.phases.find((phase) => phase.name === "image_build")
      .milliseconds,
    total_milliseconds: report.timing.total_milliseconds,
    timing: report.timing,
  };
}

export function runExactImageCacheProfile({ env = process.env } = {}) {
  const outputDir = artifactDirectory(env);
  const reportPath = join(outputDir, "cache-profile.json");
  const cache = freshCacheNamespace();
  const coldDir = join(outputDir, "cold");
  const warmDir = join(outputDir, "warm");

  try {
    mkdirSync(outputDir, { recursive: true });
    const cold = profilePass({ label: "cold", outputDir: coldDir, cache, env });
    const warm = profilePass({ label: "warm", outputDir: warmDir, cache, env });
    const evidence = {
      status: "ok",
      cache_namespace: cache,
      cache_scope: "fresh-owned-cargo-cache-for-cold-pass-reused-by-warm-pass",
      cold: cacheProfileEvidence(cold, "cold/report.json"),
      warm: cacheProfileEvidence(warm, "warm/report.json"),
    };
    writeReport(reportPath, evidence);
    process.stdout.write(`${JSON.stringify(evidence)}\n`);
    return evidence;
  } catch (error) {
    const evidence = {
      status: "failed",
      cache_namespace: cache,
      error: errorMessage(error),
    };
    mkdirSync(outputDir, { recursive: true });
    writeReport(reportPath, evidence);
    throw error;
  }
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const { cacheProfile } = parseExactImageArguments(argv);
  return cacheProfile ? runExactImageCacheProfile({ env }) : runExactImageContentSmoke({ env });
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  main();
}
