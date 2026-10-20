// Build/run split for proof lanes that compile Rust.
//
// The proof runner serializes every Cargo build behind the `cargo-target`
// lock, but a lane's test bodies or live servers do not touch the target
// directory once their executables exist. A lane that declares
// `execution.prebuild` therefore runs in two child processes:
//
//   build  `build-tests` or `build-binaries` under the lane's build-scope
//          locks. Cargo compiles the exact selection the lane would have
//          compiled, and every produced executable is hard-linked into the
//          lane directory so a later build in another lane cannot replace it.
//   run    `run-tests` (or the lane's own harness, which resolves binaries
//          through FMARCH_PROOF_PREBUILT_PLAN) without the Cargo lock. It never
//          invokes Cargo; the runner puts a refusing `cargo` first on PATH.
//
// `run-tests` reproduces what `cargo test` does after compiling: it runs each
// test executable in Cargo's order with the package root as the working
// directory, Cargo's runtime package variables, the repository `[env]` table,
// the selection's test-name filters, and the arguments after `--`, stopping
// at the first failing executable unless `--no-fail-fast` was selected.

import { spawn as spawnChild } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, link, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  PREBUILD_PLAN_SCHEMA,
  PREBUILT_PLAN_ENV,
  proofCargoArgs,
  readPrebuildPlan,
  validateCargoBuilds,
} from './proof_cargo_builds.mjs';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const PREBUILD_KINDS = new Set(['cargo-test', 'cargo-builds']);
export const RUN_PHASE_CARGO_EXIT_CODE = 97;

// `cargo test` options that consume the following argument.
const VALUE_OPTIONS = new Set([
  '-p', '--package', '--bin', '--test', '--example', '--bench', '--exclude',
  '-F', '--features', '--profile', '--target', '--target-dir', '-j', '--jobs',
  '--manifest-path', '--color', '--config', '-Z', '--message-format', '--lockfile-path',
]);
// Options that select or shape compilation and take no value.
const SELECTION_FLAGS = new Set([
  '--lib', '--bins', '--tests', '--all-features', '--no-default-features',
  '--workspace', '--all', '--release', '--locked', '--offline', '--frozen',
  '--ignore-rust-version', '--keep-going',
]);
// Explicit target selection keeps doctests out: those are compiled by
// rustdoc when they run, so they cannot be prebuilt.
const TARGET_SELECTORS = new Set(['--lib', '--bin', '--bins', '--test', '--tests']);
const UNSUPPORTED = new Set([
  '--doc', '--no-run', '--all-targets', '--examples', '--benches', '--bench', '--example',
  '-q', '--quiet', '-v', '--verbose', '--future-incompat-report', '--timings', '--unit-graph',
  '--message-format', '--target', '--target-dir', '--manifest-path',
]);

function splitEquals(argument) {
  const match = /^(--[a-z-]+)=(.*)$/s.exec(argument);
  return match ? [match[1], match[2]] : [argument];
}

/**
 * Split `cargo test` arguments (after the `test` subcommand) into the
 * compilation selection and what Cargo would forward to each test executable.
 */
export function parseCargoTestArgs(args) {
  if (!Array.isArray(args) || args.some((argument) => typeof argument !== 'string')) {
    throw new Error('cargo test arguments must be strings');
  }
  const separator = args.indexOf('--');
  const before = separator === -1 ? args : args.slice(0, separator);
  const testArgs = separator === -1 ? [] : args.slice(separator + 1);
  const selection = [];
  const filters = [];
  let noFailFast = false;
  let targeted = false;
  for (let index = 0; index < before.length; index += 1) {
    const [option, inline] = splitEquals(before[index]);
    if (UNSUPPORTED.has(option)) {
      throw new Error(`prebuilt cargo test does not support ${option}`);
    }
    if (option === '--no-fail-fast') {
      noFailFast = true;
      continue;
    }
    if (TARGET_SELECTORS.has(option)) targeted = true;
    if (VALUE_OPTIONS.has(option)) {
      const value = inline ?? before[index + 1];
      if (value === undefined || (inline === undefined && value.startsWith('-'))) {
        throw new Error(`cargo test option ${option} requires a value`);
      }
      if (inline === undefined) index += 1;
      selection.push(option, value);
      continue;
    }
    if (/^-p.+/.test(option)) {
      selection.push('-p', option.slice(2).replace(/^=/, ''));
      continue;
    }
    if (SELECTION_FLAGS.has(option)) {
      selection.push(option);
      continue;
    }
    if (option.startsWith('-')) throw new Error(`prebuilt cargo test does not recognize ${option}`);
    filters.push(option);
  }
  if (!targeted) {
    throw new Error('prebuilt cargo test requires explicit --lib/--bin/--test selection so no doctests are implied');
  }
  return { selection, filters, testArgs, noFailFast };
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function safeName(value) {
  return value.replaceAll(/[^A-Za-z0-9._-]/g, '_');
}

async function linkInto(source, destination) {
  await mkdir(dirname(destination), { recursive: true });
  await rm(destination, { force: true });
  try {
    // A hard link keeps this inode even when a later build in another lane
    // relinks or re-uplifts the same Cargo output path.
    await link(source, destination);
  } catch (error) {
    if (!['EXDEV', 'EPERM', 'EMLINK'].includes(error?.code)) throw error;
    await copyFile(source, destination);
  }
  return destination;
}

function collect(child) {
  return new Promise((resolveResult, rejectResult) => {
    let stdout = '';
    child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
    child.once('error', rejectResult);
    child.once('close', (status, signal) => resolveResult({ status, signal, stdout }));
  });
}

async function runCargo(args, { root, env, spawn }) {
  const child = spawn('cargo', args, { cwd: root, env, stdio: ['ignore', 'pipe', 'inherit'] });
  const result = await collect(child);
  if (result.status !== 0) {
    const error = new Error(`cargo ${args[0]} exited ${result.status ?? result.signal}`);
    error.exitCode = result.status ?? 1;
    throw error;
  }
  return result.stdout;
}

export function cargoArtifacts(output) {
  return output.split('\n').flatMap((line) => {
    if (!line.startsWith('{')) return [];
    try {
      const message = JSON.parse(line);
      return message.reason === 'compiler-artifact' ? [message] : [];
    } catch {
      return [];
    }
  });
}

function packageEnvironment(pkg) {
  const [, major = '', minor = '', patch = '', pre = ''] =
    /^(\d+)\.(\d+)\.(\d+)(?:-([^+]+))?/.exec(String(pkg.version)) ?? [];
  return {
    CARGO_MANIFEST_DIR: dirname(pkg.manifest_path),
    CARGO_MANIFEST_PATH: pkg.manifest_path,
    CARGO_PKG_NAME: pkg.name,
    CARGO_PKG_VERSION: pkg.version,
    CARGO_PKG_VERSION_MAJOR: major,
    CARGO_PKG_VERSION_MINOR: minor,
    CARGO_PKG_VERSION_PATCH: patch,
    CARGO_PKG_VERSION_PRE: pre,
    CARGO_PKG_AUTHORS: (pkg.authors ?? []).join(':'),
    CARGO_PKG_DESCRIPTION: pkg.description ?? '',
    CARGO_PKG_HOMEPAGE: pkg.homepage ?? '',
    CARGO_PKG_REPOSITORY: pkg.repository ?? '',
    CARGO_PKG_LICENSE: pkg.license ?? '',
    CARGO_PKG_LICENSE_FILE: pkg.license_file ?? '',
    CARGO_PKG_RUST_VERSION: pkg.rust_version ?? '',
    CARGO_PKG_README: pkg.readme ?? '',
  };
}

const KIND_ORDER = { lib: 0, bin: 1, test: 2 };

function targetKind(target) {
  const kind = target.kind.find((value) => value in KIND_ORDER) ?? target.kind[0];
  return kind === 'lib' || target.kind.some((value) => ['rlib', 'dylib', 'cdylib', 'staticlib', 'proc-macro'].includes(value))
    ? 'lib'
    : kind;
}

/** Compile a cargo-test lane's exact selection and record its executables. */
export async function buildTests({ planPath, args, root = REPO_ROOT, env = process.env, spawn = spawnChild }) {
  const parsed = parseCargoTestArgs(args);
  const prebuiltDir = join(dirname(planPath), 'prebuilt');
  await rm(prebuiltDir, { recursive: true, force: true });
  const output = await runCargo(
    ['test', '--no-run', '--message-format=json-render-diagnostics', ...parsed.selection],
    { root, env, spawn },
  );
  const metadata = JSON.parse(await runCargo(
    ['metadata', '--no-deps', '--format-version', '1', '--offline'],
    { root, env, spawn },
  ));
  const packages = new Map(metadata.packages.map((pkg) => [resolve(pkg.manifest_path), pkg]));
  const tests = [];
  const binaries = {};
  for (const artifact of cargoArtifacts(output)) {
    if (typeof artifact.executable !== 'string' || !isAbsolute(artifact.executable)) continue;
    const pkg = packages.get(resolve(artifact.manifest_path));
    if (!pkg) throw new Error(`cargo artifact ${artifact.executable} belongs to an unknown workspace package`);
    if (artifact.profile?.test === true) {
      const kind = targetKind(artifact.target);
      const path = await linkInto(artifact.executable, join(prebuiltDir, 'tests', basename(artifact.executable)));
      tests.push({
        package: pkg.name,
        kind,
        name: artifact.target.name,
        src_path: relative(dirname(pkg.manifest_path), artifact.target.src_path),
        source_executable: artifact.executable,
        path,
      });
    } else if (artifact.target.kind.includes('bin')) {
      // Integration tests reach these through CARGO_BIN_EXE_<name>.
      binaries[`${pkg.name}/${artifact.target.name}`] = await linkInto(
        artifact.executable,
        join(prebuiltDir, 'bin', safeName(pkg.name), artifact.target.name),
      );
    }
  }
  if (tests.length === 0) throw new Error('cargo test --no-run produced no test executables');
  tests.sort((left, right) => left.package.localeCompare(right.package) ||
    KIND_ORDER[left.kind] - KIND_ORDER[right.kind] || left.name.localeCompare(right.name));
  const packageEnv = Object.fromEntries([...new Set(tests.map((entry) => entry.package))].map((name) => {
    const pkg = metadata.packages.find((candidate) => candidate.name === name);
    return [name, packageEnvironment(pkg)];
  }));
  const plan = {
    schema: PREBUILD_PLAN_SCHEMA,
    kind: 'cargo-test',
    selection: parsed.selection,
    selection_sha256: sha256(JSON.stringify(parsed.selection)),
    tests,
    binaries,
    packages: packageEnv,
  };
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  return plan;
}

/** Build each declared Cargo binary exactly as the lane harness would. */
export async function buildBinaries({
  planPath, laneId, manifest, root = REPO_ROOT, env = process.env, spawn = spawnChild,
}) {
  const lane = manifest.lanes?.[laneId];
  if (!lane) throw new Error(`unknown proof lane ${laneId}`);
  const builds = validateCargoBuilds(lane.cargo_inputs, `proof lane ${laneId} Cargo inputs`);
  if (builds.length === 0) throw new Error(`proof lane ${laneId} declares no Cargo builds to prebuild`);
  const prebuiltDir = join(dirname(planPath), 'prebuilt');
  await rm(prebuiltDir, { recursive: true, force: true });
  const binaries = {};
  for (const { target, profile } of builds) {
    // One invocation per target mirrors the harness's own `cargo run`, so the
    // feature resolution and artifact are the ones the harness would execute.
    const args = [...proofCargoArgs({ laneId, target, profile, command: 'build', env: {}, manifest }),
      '--message-format=json-render-diagnostics'];
    const [packageName, , binary] = target.split('/');
    const executables = cargoArtifacts(await runCargo(args, { root, env, spawn }))
      .filter((artifact) => artifact.target?.name === binary && artifact.target.kind.includes('bin') &&
        typeof artifact.executable === 'string' && packageNameFromArtifact(artifact) === packageName);
    if (executables.length !== 1) throw new Error(`cargo build did not identify exactly one ${target} executable`);
    binaries[`${target}@${profile}`] = await linkInto(
      executables[0].executable,
      join(prebuiltDir, 'bin', profile, safeName(packageName), binary),
    );
  }
  const plan = { schema: PREBUILD_PLAN_SCHEMA, kind: 'cargo-builds', lane_id: laneId, binaries };
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  return plan;
}

function packageNameFromArtifact(artifact) {
  // package_id is `path+file:///dir#name@version`, or `#version` when the
  // package name equals the directory name.
  const fragment = String(artifact.package_id ?? '').split('#')[1] ?? '';
  return fragment.includes('@') ? fragment.split('@')[0] : basename(dirname(artifact.manifest_path));
}

/**
 * Cargo applies `[env]` from .cargo/config.toml to the test processes it
 * runs. Only the shapes Cargo documents are accepted; anything else fails
 * closed rather than silently diverging from `cargo test`.
 */
export function cargoConfigEnvironment(text) {
  const entries = {};
  let inEnv = false;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const section = /^\[([^\]]+)\]$/.exec(line);
    if (section) {
      inEnv = section[1].trim() === 'env';
      continue;
    }
    if (!inEnv) continue;
    const plain = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"([^"\\]*)"$/.exec(line);
    if (plain) {
      entries[plain[1]] = { value: plain[2], force: false };
      continue;
    }
    const table = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\{(.*)\}$/.exec(line);
    if (!table) throw new Error(`unsupported .cargo/config.toml [env] entry: ${line}`);
    const fields = {};
    for (const part of table[2].split(',').map((value) => value.trim()).filter(Boolean)) {
      const field = /^(value|force|relative)\s*=\s*(?:"([^"\\]*)"|(true|false))$/.exec(part);
      if (!field) throw new Error(`unsupported .cargo/config.toml [env] field: ${part}`);
      fields[field[1]] = field[2] ?? field[3] === 'true';
    }
    if (typeof fields.value !== 'string' || fields.relative === true) {
      throw new Error(`unsupported .cargo/config.toml [env] entry: ${line}`);
    }
    entries[table[1]] = { value: fields.value, force: fields.force === true };
  }
  return entries;
}

export function testProcessEnvironment({ env, packageEnv, binaries, packageName, crateName, cargoEnv }) {
  const child = { ...env };
  for (const [name, entry] of Object.entries(cargoEnv)) {
    if (entry.force || child[name] === undefined) child[name] = entry.value;
  }
  Object.assign(child, packageEnv, { CARGO_CRATE_NAME: crateName.replaceAll('-', '_') });
  for (const [key, path] of Object.entries(binaries)) {
    const [owner, name] = key.split('/');
    // Runtime CARGO_BIN_EXE_* point integration tests at this lane's links.
    if (owner === packageName) child[`CARGO_BIN_EXE_${name}`] = path;
  }
  return child;
}

function runExecutable(path, args, options, spawn) {
  return new Promise((resolveResult, rejectResult) => {
    const child = spawn(path, args, { ...options, stdio: 'inherit' });
    child.once('error', rejectResult);
    child.once('close', (status, signal) => resolveResult({ status, signal }));
  });
}

/** Execute a cargo-test lane's prebuilt executables the way `cargo test` would. */
export async function runTests({
  planPath, args, root = REPO_ROOT, env = process.env, spawn = spawnChild, log = (line) => process.stderr.write(`${line}\n`),
}) {
  const parsed = parseCargoTestArgs(args);
  const plan = readPrebuildPlan(planPath, 'cargo-test');
  if (plan.selection_sha256 !== sha256(JSON.stringify(parsed.selection)) ||
      JSON.stringify(plan.selection) !== JSON.stringify(parsed.selection)) {
    throw new Error('prebuilt cargo test plan was compiled for a different selection');
  }
  const configPath = join(root, '.cargo', 'config.toml');
  const cargoEnv = existsSync(configPath) ? cargoConfigEnvironment(await readFile(configPath, 'utf8')) : {};
  const forwarded = [...parsed.filters, ...parsed.testArgs];
  const failures = [];
  for (const entry of plan.tests) {
    if (!existsSync(entry.path)) throw new Error(`prebuilt test executable is missing: ${entry.path}`);
    const packageEnv = plan.packages[entry.package];
    const label = entry.kind === 'lib' ? `unittests ${entry.src_path}` : entry.src_path;
    log(`     Running ${label} (${relative(root, entry.source_executable)})`);
    const childEnv = testProcessEnvironment({
      env, packageEnv, binaries: plan.binaries, packageName: entry.package, crateName: entry.name, cargoEnv,
    });
    const result = await runExecutable(entry.path, forwarded, { cwd: packageEnv.CARGO_MANIFEST_DIR, env: childEnv }, spawn);
    if (result.status !== 0) {
      failures.push(`${entry.package} ${entry.kind} ${entry.name}`);
      log(`error: test failed, to rerun pass \`-p ${entry.package} --${entry.kind === 'lib' ? 'lib' : `${entry.kind} ${entry.name}`}\``);
      if (!parsed.noFailFast) return 101;
    }
  }
  if (failures.length > 0) {
    log(`error: ${failures.length} target${failures.length === 1 ? '' : 's'} failed:\n${failures.map((name) => `    ${name}`).join('\n')}`);
    return 101;
  }
  return 0;
}

/** The runner's build/run argv for a prebuild lane. */
export function prebuildInvocations(laneId, lane, { planPath, node = 'node' }) {
  const execution = lane.execution;
  if (execution.prebuild === 'cargo-builds') {
    return {
      build: [node, 'tools/proof_prebuild.mjs', 'build-binaries', '--plan', planPath, '--lane', laneId],
      run: execution.argv,
    };
  }
  if (execution.prebuild !== 'cargo-test') throw new Error(`proof lane ${laneId} has unknown prebuild ${execution.prebuild}`);
  const index = cargoTestIndex(laneId, execution.argv);
  const cargoArgs = execution.argv.slice(index + 2);
  return {
    build: [node, 'tools/proof_prebuild.mjs', 'build-tests', '--plan', planPath, '--', ...cargoArgs],
    run: [...execution.argv.slice(0, index), node, 'tools/proof_prebuild.mjs', 'run-tests', '--plan', planPath, '--', ...cargoArgs],
  };
}

export function cargoTestIndex(laneId, argv) {
  const indexes = argv.flatMap((value, index) => value === 'cargo' && argv[index + 1] === 'test' ? [index] : []);
  if (indexes.length !== 1) throw new Error(`proof lane ${laneId} cargo-test prebuild needs exactly one \`cargo test\` in argv`);
  const [index] = indexes;
  // Either the lane is `cargo test …` or the evidence wrapper hands it one.
  if (index !== 0 && !(argv[0] === 'node' && argv[1] === 'tools/cargo_test_evidence.mjs' && argv[index - 1] === '--')) {
    throw new Error(`proof lane ${laneId} cargo-test prebuild must start with cargo test or wrap it in cargo_test_evidence`);
  }
  return index;
}

/** Validate a lane's prebuild declaration against its argv and Cargo inputs. */
export function validatePrebuild(laneId, lane) {
  const prebuild = lane.execution?.prebuild;
  if (prebuild === undefined) return null;
  if (!PREBUILD_KINDS.has(prebuild)) throw new Error(`proof lane ${laneId} has unknown prebuild ${prebuild}`);
  if (prebuild === 'cargo-test') {
    const index = cargoTestIndex(laneId, lane.execution.argv);
    parseCargoTestArgs(lane.execution.argv.slice(index + 2));
  } else {
    const builds = validateCargoBuilds(lane.cargo_inputs, `proof lane ${laneId} Cargo inputs`);
    if (builds.length === 0) throw new Error(`proof lane ${laneId} cargo-builds prebuild declares no Cargo builds`);
  }
  return prebuild;
}

/** The refusing `cargo` the runner puts first on PATH during a run phase. */
export function runPhaseCargoShim() {
  return [
    '#!/bin/sh',
    `echo "proof lane \${FMARCH_PROOF_LANE_ID:-?} invoked cargo during its run phase; prebuilt lanes may only execute binaries from \${${PREBUILT_PLAN_ENV}:-their plan}" >&2`,
    `exit ${RUN_PHASE_CARGO_EXIT_CODE}`,
    '',
  ].join('\n');
}

function option(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1 || !argv[index + 1]) throw new Error(`proof_prebuild requires ${name}`);
  return argv[index + 1];
}

async function main(argv) {
  const [command, ...rest] = argv;
  const separator = rest.indexOf('--');
  const options = separator === -1 ? rest : rest.slice(0, separator);
  const cargoArgs = separator === -1 ? [] : rest.slice(separator + 1);
  const planPath = resolve(option(options, '--plan'));
  if (command === 'build-tests') {
    await buildTests({ planPath, args: cargoArgs });
    return 0;
  }
  if (command === 'run-tests') return await runTests({ planPath, args: cargoArgs });
  if (command === 'build-binaries') {
    const manifest = JSON.parse(await readFile(join(REPO_ROOT, 'docs', 'ops', 'proof-lane-manifest.json'), 'utf8'));
    await buildBinaries({ planPath, laneId: option(options, '--lane'), manifest });
    return 0;
  }
  throw new Error('usage: proof_prebuild.mjs build-tests|run-tests --plan PATH -- CARGO_TEST_ARGS | build-binaries --plan PATH --lane ID');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (error) => {
      console.error(error.message);
      process.exitCode = error.exitCode ?? 1;
    },
  );
}
