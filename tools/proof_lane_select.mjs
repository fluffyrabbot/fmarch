// Diff-to-proof-lane selector over docs/ops/proof-lane-manifest.json.
//
// Selects the narrowest truthful proof-lane set for a change: maps changed
// paths to manifest areas (longest match wins), expands touched crates through
// the reverse cargo dependency closure, follows also_triggers edges for
// cross-boundary blast radius the crate DAG cannot see, directly matches
// generated-artifact inputs and outputs, and unions the resulting lanes.
// Frozen-tier areas are excluded from sprint-mode defaults but are always
// re-armed when the diff reaches them.
//
// Modes:
//   inner (default)  lanes for the touched closure only
//   push             inner + the bounded push sentinel set
//   sprint           push + all active-tier lanes
//   full             every lane in the manifest
//
// CLI:
//   node tools/proof_lane_select.mjs [--mode inner|push|sprint|full] [--base <ref>]
//                                    [--changed <path> ...] [--json] [--list] [--run]
//                                    [--jobs <positive integer>] [--keep-going]
//                                    [--skip <lane-id>[,<lane-id>...]]
//                                    [--only <lane-id>] [--resume <receipt>]
//                                    [--force]
//                                    [--record <lane-id>] [--regenerate <lane-id>]
//                                    [--measure <lane-id> ...] [--measure-all]
//
// --keep-going runs every dependency-satisfied lane and reports all failures at
// the end instead of blanket-blocking the queue on the first failure. --skip
// excludes named lanes from a --run: they appear in the receipt as skipped
// (never green, never gating), and their dependents block. Both are valid with
// --resume, and both are carried across the automatic resume that follows a
// preemption -- neither is recorded in the receipt, so a resume that dropped
// them would silently change how the sweep runs.
//
// A run that does not gate still reports what it did not prove: the terminal
// summary counts passed lanes against the plan and names every lane left
// failed, blocked, skipped, quarantined, or preempted.
//
// --changed bypasses git and supplies the changed set explicitly (also used by
// the contract test). --run executes the selected lanes in cost order. It is
// serial by default; --jobs opts into the manifest-owned resource scheduler.
// The scheduler writes one receipt under target/proof-lanes/runs/ and only
// starts lanes whose hard dependencies and resource claims are satisfied.
// --record deliberately promotes one observation into the tracked timing
// baseline at docs/ops/proof-lane-timings.json.
//
// --measure/--measure-all rewrite that baseline from isolated measurement: each
// lane is run once to warm it and then timed, so an entry means "this lane costs
// this much on a warm checkout" rather than "this lane ran after that one".
// Observations taken during a --run sweep attribute the previous lane's leftover
// compilation to whichever lane happened to follow it, which is why the two
// paths stay separate. Warm-up runs the lane's real command; see warmupCommand
// for why a cheaper build-only stand-in is not equivalent.
//
// Estimates therefore prefer the tracked baseline, and fall back to runtime
// observations only for lanes it has never measured. Runtime numbers overstate
// by construction, so letting them override the baseline would re-bury every
// measurement the first time anyone ran --run.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, matchesGlob, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PREEMPTED_EXIT_CODE,
  expandHardDependencies,
  proofDatabaseIdentity,
  readPreemptedRunReceiptPath,
  runExecutionPlan,
  summarizeLaneStates,
  validateExecutionManifest,
} from './proof_lane_execution.mjs';
import {
  computeLaneProofKey,
  frozenLaneIds,
  loadProofCacheHits,
  persistProofCacheEntries,
  proofToolchain,
  workspaceFiles,
  workspaceMetadata,
} from './proof_lane_cache.mjs';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const MANIFEST_PATH = join(REPO_ROOT, 'docs', 'ops', 'proof-lane-manifest.json');
export const TIMINGS_PATH = join(REPO_ROOT, 'docs', 'ops', 'proof-lane-timings.json');
export const RUNTIME_TIMINGS_PATH = join(REPO_ROOT, 'target', 'proof-lanes', 'timings.json');
export const HOST_HEAVY_BUILD_LOCK_SCRIPT = join(REPO_ROOT, 'scripts', 'with-heavy-build-lock.py');

const HOST_LOCKED_OPERATIONS = new Set([
  '--run',
  '--record',
  '--measure',
  '--measure-all',
  '--regenerate',
  '--resume',
]);

export function requiresHostHeavyBuildLock(argv) {
  return argv.some((argument) => HOST_LOCKED_OPERATIONS.has(argument));
}

// The worktree fingerprint reads a whole-tree patch, which routinely exceeds
// Node's 1 MiB default and would otherwise fail the run with ENOBUFS rather
// than a proof result.
const GIT_READ_MAX_BUFFER = 64 * 1024 * 1024;

function gitFile(args, options = {}) {
  return execFileSync('git', args, {
    cwd: REPO_ROOT,
    maxBuffer: GIT_READ_MAX_BUFFER,
    ...options,
  });
}

export function currentProofContext({ env = process.env } = {}) {
  const commit = gitFile(['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const status = gitFile(
    ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
  );
  const patch = gitFile(['diff', '--binary', '--no-ext-diff', 'HEAD', '--']);
  const digest = createHash('sha256');
  digest.update(commit);
  digest.update('\0');
  digest.update(status);
  digest.update('\0');
  digest.update(patch);
  const entries = status.toString('utf8').split('\0').filter(Boolean);
  for (const entry of entries.filter((value) => value.startsWith('?? ')).sort()) {
    const relativePath = entry.slice(3);
    const absolutePath = resolve(REPO_ROOT, relativePath);
    const metadata = lstatSync(absolutePath);
    digest.update('\0untracked\0');
    digest.update(relativePath);
    digest.update(`\0${metadata.mode}\0`);
    digest.update(metadata.isSymbolicLink() ? readlinkSync(absolutePath) : readFileSync(absolutePath));
  }
  return {
    commit,
    clean: status.length === 0,
    worktree_sha256: digest.digest('hex'),
    manifest_sha256: createHash('sha256').update(readFileSync(MANIFEST_PATH)).digest('hex'),
    database_identity_sha256: proofDatabaseIdentity({ env }),
  };
}

function sameStringArray(left, right) {
  return Array.isArray(left) && Array.isArray(right) &&
    left.length === right.length && left.every((value, index) => value === right[index]);
}

export function planReceiptResume(receipt, manifest, context) {
  if (receipt?.schema !== 3) throw new Error('resume requires a schema-3 proof receipt');
  const expected = receipt.context ?? {};
  for (const field of [
    'commit',
    'worktree_sha256',
    'manifest_sha256',
    'database_identity_sha256',
  ]) {
    if (expected[field] !== context[field]) {
      throw new Error(`proof receipt ${field} does not match the current workspace`);
    }
  }
  if (expected.clean !== context.clean) {
    throw new Error('proof receipt clean state does not match the current workspace');
  }
  const selected = expected.selected_lane_ids;
  if (!Array.isArray(selected) || selected.length === 0 || new Set(selected).size !== selected.length) {
    throw new Error('proof receipt has no valid selected lane graph');
  }
  if (!sameStringArray(Object.keys(receipt.lanes ?? {}), selected)) {
    throw new Error('proof receipt lane records do not match its selected lane graph');
  }
  for (const laneId of selected) {
    if (!manifest.lanes[laneId]) throw new Error(`proof receipt references removed lane ${laneId}`);
  }
  const rerun = new Set(selected.filter((laneId) => receipt.lanes[laneId]?.state !== 'passed'));
  if (rerun.size === 0) throw new Error('proof receipt already passed; there is nothing to resume');

  let changed = true;
  while (changed) {
    changed = false;
    for (const laneId of [...rerun]) {
      const resources = manifest.lanes[laneId]?.execution?.resources ?? [];
      for (const resource of resources.filter((candidate) => candidate.kind === 'artifact-input')) {
        if (!rerun.has(resource.from)) {
          rerun.add(resource.from);
          changed = true;
        }
      }
    }
  }
  const rerunWithDependencies = new Set(expandHardDependencies([...rerun], manifest));
  const reusedLanes = new Map();
  for (const laneId of selected) {
    if (rerunWithDependencies.has(laneId)) continue;
    const prior = receipt.lanes[laneId];
    if (prior?.state !== 'passed') throw new Error(`proof receipt cannot reuse non-passed lane ${laneId}`);
    reusedLanes.set(laneId, { ...prior, receipt_id: receipt.id });
  }
  return { selected, rerun: [...rerunWithDependencies], reusedLanes };
}

export function loadManifest(path = MANIFEST_PATH) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function loadTimings(path = TIMINGS_PATH) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { version: 1, lanes: {} };
  }
}

// Declared known-red lanes that run and report but do not gate the sweep. Each
// entry carries an owner and an expiry; the expiry is the load-bearing part —
// quarantine must not become a place reds go to die.
export function quarantineEntries(manifest) {
  return Array.isArray(manifest.quarantine) ? manifest.quarantine : [];
}

// An entry is expired once its calendar day is strictly before the reference
// day (compared date-only, so a same-day run stays shielded for the whole day).
export function expiredQuarantineEntries(entries, referenceDate = new Date()) {
  const referenceDay = Date.parse(referenceDate.toISOString().slice(0, 10));
  return entries.filter((entry) => Date.parse(entry.expires) < referenceDay);
}

// The sweep supervisor auto-resumes exactly once after a preemption: only when
// the host lock reported the distinct preemption exit code and the run was not
// itself a resume (which would risk an unbounded resume loop).
export function shouldAutoResumeAfterPreemption(exitStatus, argv) {
  return exitStatus === PREEMPTED_EXIT_CODE && !argv.includes('--resume');
}

// Flags that describe *how* to run rather than *what* to select. A resume
// re-derives its plan from the receipt, but nothing in the receipt records
// these, so an auto-resume that dropped them would silently downgrade a
// parallel keep-going sweep to a serial fail-fast one and would re-run the
// very lanes the operator excluded.
const RESUME_PRESERVED_FLAGS = new Map([
  ['--jobs', 1],
  ['--skip', 1],
  ['--keep-going', 0],
]);

export function resumeArgv(argv, receiptPath) {
  const preserved = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arity = RESUME_PRESERVED_FLAGS.get(argv[index]);
    if (arity === undefined) continue;
    preserved.push(...argv.slice(index, index + arity + 1));
    index += arity;
  }
  return ['--resume', receiptPath, ...preserved];
}

// A lane that failed still has a duration, but that duration is how long it took
// to break, not what it costs to prove the change. Recording it is useful for
// diagnosis; serving it as an estimate is not, because a lane that fails fast
// looks cheap and sorts to the front of every subsequent run.
export function isCostObservation(entry) {
  return Boolean(entry) && (entry.status === undefined || entry.status === 0);
}

export function mergeTimings(...sources) {
  // Filter per source, not after merging: a failed observation must fall through
  // to the baseline underneath it rather than erase it.
  const costOnly = (source) =>
    Object.fromEntries(Object.entries(source?.lanes ?? {}).filter(([, entry]) => isCostObservation(entry)));
  return { version: 1, lanes: Object.assign({}, ...sources.map(costOnly)) };
}

// Runtime observations for lanes the manifest no longer declares cannot be
// selected, so keeping them means a deleted lane lingers in the file forever.
export function pruneUnknownLanes(timings, manifest) {
  return {
    version: 1,
    lanes: Object.fromEntries(
      Object.entries(timings?.lanes ?? {}).filter(([laneId]) => manifest.lanes[laneId]),
    ),
  };
}

// The cost estimates the selector serves. The tracked baseline is curated:
// every entry got there by deliberate promotion (--record, timed against a
// representative edit) or isolated measurement (--measure). The runtime file is
// exhaust from --run sweeps, where each lane absorbs whatever compilation the
// lane before it left undone; it systematically overstates, and it cannot tell
// a real regression from an unlucky neighbour. So runtime observations fill
// lanes the baseline has never measured, and never override it.
export function costEstimates(baseline, runtime, manifest) {
  return mergeTimings(pruneUnknownLanes(runtime, manifest), baseline);
}

export function writeTimings(path, timings) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(timings, null, 2)}\n`);
}

// Path entries ending in '/' or '.' are prefixes; anything else matches exactly.
export function pathMatches(file, entry) {
  if (entry.endsWith('/') || entry.endsWith('.')) return file.startsWith(entry);
  return file === entry;
}

export function artifactPathMatches(file, entry) {
  return /[*?\[\]{}]/.test(entry) ? matchesGlob(file, entry) : file === entry;
}

export function generatedArtifactTriggers(changed, manifest) {
  const triggered = new Map();
  for (const [laneId, lane] of Object.entries(manifest.lanes)) {
    for (const entry of [...(lane.inputs ?? []), ...(lane.outputs ?? [])]) {
      for (const file of changed) {
        if (!artifactPathMatches(file, entry)) continue;
        if (!triggered.has(laneId)) triggered.set(laneId, new Set());
        triggered.get(laneId).add(file);
      }
    }
  }
  return [...triggered.entries()].map(([laneId, reasons]) => ({
    laneId,
    reasons: [...reasons],
  }));
}

// Reverse closure over the workspace crate graph: crate name -> Set of
// workspace crates that (transitively) depend on it.
export function reverseCrateClosure(graph) {
  const dependents = new Map(Object.keys(graph).map((name) => [name, new Set()]));
  const expand = (name, seen) => {
    for (const [pkg, deps] of Object.entries(graph)) {
      if (deps.includes(name) && !seen.has(pkg)) {
        seen.add(pkg);
        dependents.get(name)?.add(pkg);
        for (const transitive of expand(pkg, new Set([pkg]))) dependents.get(name)?.add(transitive);
      }
    }
    return dependents.get(name) ?? new Set();
  };
  for (const name of Object.keys(graph)) expand(name, new Set());
  return dependents;
}

export function workspaceCrateGraph() {
  const raw = execFileSync('cargo', ['metadata', '--no-deps', '--format-version', '1'], {
    cwd: REPO_ROOT,
    maxBuffer: 64 * 1024 * 1024,
  });
  const metadata = JSON.parse(raw.toString('utf8'));
  return crateGraphFromMetadata(metadata);
}

export function crateGraphFromMetadata(metadata) {
  const names = new Set(metadata.packages.map((p) => p.name));
  const graph = {};
  for (const pkg of metadata.packages) {
    graph[pkg.name] = pkg.dependencies
      .filter((dependency) => dependency.kind !== 'dev' && names.has(dependency.name))
      .map((dependency) => dependency.name);
  }
  return graph;
}

export function gitChangedFiles(
  baseRef,
  git = (...args) =>
    execFileSync('git', args, { cwd: REPO_ROOT, maxBuffer: 16 * 1024 * 1024 }).toString('utf8'),
) {
  const files = new Set();
  const mergeBase = git('merge-base', baseRef, 'HEAD').trim();
  for (const line of git('diff', '--name-only', `${mergeBase}..HEAD`).split('\n')) {
    if (line.trim()) files.add(line.trim());
  }
  for (const line of git('status', '--porcelain=v1').split('\n')) {
    if (!line.trim()) continue;
    const path = line.slice(3);
    const renamed = path.includes(' -> ') ? path.split(' -> ').pop() : path;
    files.add(renamed.replace(/^"|"$/g, ''));
  }
  return [...files];
}

// Core selection. Pure over its inputs so the contract test can drive it with
// fixtures. crateGraph of null means "unknown": if a crate or specialized
// closure area is touched we conservatively arm every crate area instead of
// guessing the closure.
export function selectLanes({ changed, manifest, crateGraph, mode = 'inner' }) {
  const areasById = new Map(manifest.areas.map((a) => [a.id, a]));
  const areasByCrate = new Map(manifest.areas.filter((a) => a.crate).map((a) => [a.crate, a]));
  const touched = new Map(); // area id -> [reasons]
  const unmapped = [];
  const touch = (id, reason) => {
    if (!touched.has(id)) touched.set(id, []);
    touched.get(id).push(reason);
  };

  for (const file of changed) {
    let best = null;
    for (const area of manifest.areas) {
      for (const entry of area.paths) {
        if (pathMatches(file, entry) && (!best || entry.length > best.entry.length)) {
          best = { area, entry };
        }
      }
    }
    if (best) touch(best.area.id, file);
    else unmapped.push(file);
  }

  const touchedCrates = [...touched.keys()]
    .map((id) => areasById.get(id))
    .map((area) => area?.crate ?? area?.closure_crate)
    .filter(Boolean);
  let crateFallback = false;
  if (touchedCrates.length > 0) {
    if (crateGraph) {
      const dependents = reverseCrateClosure(crateGraph);
      for (const crate of touchedCrates) {
        for (const dependent of dependents.get(crate) ?? []) {
          const area = areasByCrate.get(dependent);
          if (area && !touched.has(area.id)) touch(area.id, `crate-closure:${crate}`);
        }
      }
    } else {
      crateFallback = true;
      for (const area of areasByCrate.values()) {
        if (!touched.has(area.id)) touch(area.id, 'crate-graph-unavailable');
      }
    }
  }

  const queue = [...touched.keys()];
  while (queue.length > 0) {
    const area = areasById.get(queue.shift());
    for (const target of area?.also_triggers ?? []) {
      if (!touched.has(target)) {
        touch(target, `also-triggers:${area.id}`);
        queue.push(target);
      }
    }
  }

  const artifactTriggers = generatedArtifactTriggers(changed, manifest);
  const laneIds = new Set();
  const addAreaLanes = (area) => area.lanes.forEach((lane) => laneIds.add(lane));
  if (mode === 'full') {
    for (const lane of Object.keys(manifest.lanes)) laneIds.add(lane);
  } else {
    for (const id of touched.keys()) addAreaLanes(areasById.get(id));
    for (const { laneId } of artifactTriggers) laneIds.add(laneId);
    if (mode === 'sprint') {
      for (const area of manifest.areas) if (area.tier === 'active') addAreaLanes(area);
    }
    if (mode === 'push' || mode === 'sprint') {
      for (const lane of manifest.push_sentinels ?? []) laneIds.add(lane);
    }
  }

  const frozenSkipped = manifest.areas
    .filter((a) => a.tier === 'frozen' && !touched.has(a.id))
    .map((a) => a.id);

  return {
    mode,
    touched: [...touched.entries()].map(([id, reasons]) => ({ id, reasons })),
    artifactTriggers,
    unmapped,
    crateFallback,
    laneIds: [...laneIds],
    frozenSkipped: mode === 'full' ? [] : frozenSkipped,
  };
}

export function laneCommand(laneId, manifest) {
  const lane = manifest.lanes[laneId];
  if (!lane) throw new Error(`unknown lane: ${laneId}`);
  return lane.kind === 'npm' ? `npm run ${laneId}` : lane.command;
}

export function laneExecutionKey(laneId, manifest) {
  const lane = manifest.lanes[laneId];
  if (!lane) throw new Error(`unknown lane: ${laneId}`);
  return lane.execution_key ?? laneCommand(laneId, manifest).trim().replace(/\s+/g, ' ');
}

export function usesRunnerOwnedPostgres(lane) {
  return Boolean(lane?.execution?.resources?.some((resource) => resource.kind === 'postgres'));
}

export function deduplicateLaneIds(laneIds, manifest) {
  const seen = new Set();
  const deduplicated = [];
  for (const laneId of laneIds) {
    const key = laneExecutionKey(laneId, manifest);
    if (seen.has(key)) continue;
    seen.add(key);
    deduplicated.push(laneId);
  }
  return deduplicated;
}

export function orderedExecutionPlan(laneIds, manifest, timings = { lanes: {} }) {
  const bySeconds = (a, b) =>
    (timings.lanes[a]?.seconds ?? Infinity) - (timings.lanes[b]?.seconds ?? Infinity);
  const sorted = deduplicateLaneIds([...laneIds].sort(bySeconds), manifest);
  const selected = new Set(sorted);
  const visiting = new Set();
  const visited = new Set();
  const ordered = [];

  const visit = (laneId) => {
    if (visited.has(laneId)) return;
    if (visiting.has(laneId)) {
      throw new Error(`proof lane ordering cycle includes ${laneId}`);
    }
    visiting.add(laneId);
    // `depends_on` is already expanded before this planner runs, but it also
    // needs to constrain the human-readable cost plan.  `after` stays an
    // optional order-only edge: unlike depends_on it never expands selection.
    for (const dependency of [
      ...(manifest.lanes[laneId]?.depends_on ?? []),
      ...(manifest.lanes[laneId]?.after ?? []),
    ]) {
      if (!manifest.lanes[dependency]) {
        const field = manifest.lanes[laneId]?.depends_on?.includes(dependency) ? 'depends on' : 'orders after';
        throw new Error(`proof lane ${laneId} ${field} unknown lane ${dependency}`);
      }
      if (selected.has(dependency)) visit(dependency);
    }
    visiting.delete(laneId);
    visited.add(laneId);
    ordered.push(laneId);
  };

  for (const laneId of sorted) visit(laneId);
  return ordered;
}

function elapsedSeconds(started, finished) {
  return Math.round((finished - started) / 100) / 10;
}

export function runLanes(
  laneIds,
  manifest,
  {
    spawn = spawnSync,
    now = Date.now,
    onResult = () => {},
  } = {},
) {
  const executionLaneIds = deduplicateLaneIds(laneIds, manifest);
  for (const [index, laneId] of executionLaneIds.entries()) {
    const command = laneCommand(laneId, manifest);
    console.log(`\n[${index + 1}/${executionLaneIds.length}] ${command}`);
    const started = now();
    const result = spawn(command, { cwd: REPO_ROOT, shell: true, stdio: 'inherit' });
    const status = result.status ?? 1;
    onResult(laneId, {
      seconds: elapsedSeconds(started, now()),
      measured_at: new Date().toISOString(),
      command,
      status,
    });
    if (result.status !== 0) {
      throw new Error(`lane ${laneId} failed (exit ${result.status ?? 'unknown'})`);
    }
  }
  console.log(`\nproof passed: ${executionLaneIds.length} lane(s)`);
}

async function resourceAwarePhase(laneId, manifest, {
  execute = runExecutionPlan,
  log = console.log,
} = {}) {
  let observation = null;
  const execution = await execute([laneId], manifest, {
    jobs: 1,
    receiptContext: { mode: 'measurement', selected_lane_ids: [laneId] },
    onResult(id, entry) {
      if (id === laneId) observation = entry;
    },
    log,
  });
  const entry = observation ?? execution.receipt?.lanes?.[laneId] ?? {};
  return {
    seconds: entry.seconds ?? 0,
    status: execution.success ? 0 : entry.status ?? 1,
    finished: entry.finished_at ? Date.parse(entry.finished_at) : Date.now(),
  };
}

async function recordLane(laneId, manifest) {
  const command = laneCommand(laneId, manifest);
  console.log(`recording ${laneId}: ${command}`);
  const result = await resourceAwarePhase(laneId, manifest);
  if (result.status !== 0) {
    throw new Error(`lane ${laneId} failed (exit ${result.status}) after ${result.seconds}s; timing not recorded`);
  }
  const timings = loadTimings();
  timings.lanes[laneId] = {
    seconds: result.seconds,
    measured_at: new Date().toISOString(),
    command,
    status: 0,
    method: 'resource-aware-record',
  };
  writeTimings(TIMINGS_PATH, timings);
  console.log(`recorded ${laneId}: ${result.seconds}s`);
}

// Most lanes do the same work every run, so timing a second run measures that
// work. A lint pass does not: its work is proportional to what changed, so
// running it twice with no edit in between measures an empty run. Such lanes
// declare `measurement: "diff-sensitive"` and must be timed against a real edit.
export function isDiffSensitive(laneId, manifest) {
  return manifest.lanes[laneId]?.measurement === 'diff-sensitive';
}

// A lane's steady-state cost is its own work, not the compilation the previously
// executed lane happened to leave undone, so warm-up runs the lane's real
// command once and discards the result.
//
// Do not replace this with a build-only form. `cargo test --no-run` looks like a
// cheaper way to reach the same warm state and is not: it builds the test
// binaries but leaves the doctest target cold, so the timed run still absorbs a
// one-time rustdoc build of the crate and its dependencies. That mismeasured
// `cargo test -p domain` at 229s against a true warm cost of 10.6s -- a 21x
// error, and exactly the kind of one-time build cost this whole path exists to
// keep out of the baseline. Warm-up must run precisely what is being measured.
export function warmupCommand(command) {
  return command;
}

// Measures one lane in isolation: warm first, then time the real command. The
// recorded number is the second phase, so a baseline entry means "this lane
// costs this much on a warm checkout" rather than "this lane ran after that one".
export async function measureLane(
  laneId,
  manifest,
  { execute = runExecutionPlan, log = console.log } = {},
) {
  const command = laneCommand(laneId, manifest);
  const warmup = warmupCommand(command);
  const phase = async (label, phaseCommand) => {
    log(`  ${label}: ${phaseCommand}`);
    return await resourceAwarePhase(laneId, manifest, { execute, log });
  };

  const warmed = await phase('warm', warmup);
  if (warmed.status !== 0) {
    return {
      laneId,
      command,
      failedPhase: 'warm',
      status: warmed.status,
      warmup_command: warmup,
      warmup_seconds: warmed.seconds,
    };
  }
  const measured = await phase('measure', command);
  return {
    laneId,
    command,
    status: measured.status,
    failedPhase: measured.status === 0 ? null : 'measure',
    warmup_command: warmup,
    warmup_seconds: warmed.seconds,
    seconds: measured.seconds,
    method: 'resource-aware-isolated',
    measured_at: new Date(measured.finished).toISOString(),
  };
}

export function timingEntryFromMeasurement(measurement) {
  return {
    seconds: measurement.seconds,
    measured_at: measurement.measured_at,
    command: measurement.command,
    status: measurement.status,
    method: measurement.method,
    warmup_seconds: measurement.warmup_seconds,
  };
}

// Sweeps lanes one at a time, promoting each success into the tracked baseline
// immediately so a long sweep that dies late still keeps what it proved.
export async function measureLanes(
  laneIds,
  manifest,
  {
    execute = runExecutionPlan,
    timings = loadTimings(),
    // What the selector currently believes, so the was/now report compares
    // against the estimate actually being served.
    compareTo = timings,
    persist = () => {},
    log = console.log,
    logError = console.error,
  } = {},
) {
  const results = [];
  for (const [index, laneId] of laneIds.entries()) {
    log(`\n[${index + 1}/${laneIds.length}] measuring ${laneId}`);
    const previous = compareTo.lanes[laneId];
    if (isDiffSensitive(laneId, manifest)) {
      logError(
        `  ${laneId} is diff-sensitive: repeating it measures an empty run, not its cost. ` +
          'Time it against a representative edit and use --record. Baseline left unchanged.',
      );
      results.push({ laneId, command: laneCommand(laneId, manifest), skipped: 'diff-sensitive', previousSeconds: previous?.seconds ?? null });
      continue;
    }
    const measurement = await measureLane(laneId, manifest, { execute, log });
    if (measurement.failedPhase) {
      logError(
        `  ${laneId} failed during ${measurement.failedPhase} (exit ${measurement.status}); baseline left unchanged`,
      );
    } else {
      timings.lanes[laneId] = timingEntryFromMeasurement(measurement);
      persist(timings);
      log(
        `  ${laneId}: ${measurement.seconds}s (warm ${measurement.warmup_seconds}s)` +
          (previous ? ` — was ${previous.seconds}s` : ' — new'),
      );
    }
    results.push({ ...measurement, previousSeconds: previous?.seconds ?? null });
  }
  return results;
}

export function formatMeasurementReport(results) {
  const lines = ['', 'lane                                      was      now    ratio', ''];
  for (const result of [...results].sort((a, b) => (b.seconds ?? 0) - (a.seconds ?? 0))) {
    if (result.skipped) {
      lines.push(`${result.laneId.padEnd(38)}  ${String(result.previousSeconds ?? '?').padStart(7)}   SKIPPED (${result.skipped})`);
      continue;
    }
    if (result.failedPhase) {
      lines.push(`${result.laneId.padEnd(38)}  ${String(result.previousSeconds ?? '?').padStart(7)}   FAILED (${result.failedPhase})`);
      continue;
    }
    const was = result.previousSeconds;
    const ratio = was && result.seconds > 0 ? `${(was / result.seconds).toFixed(1)}x` : '—';
    lines.push(
      `${result.laneId.padEnd(38)}  ${String(was ?? '—').padStart(7)}  ${String(result.seconds).padStart(7)}  ${ratio.padStart(7)}`,
    );
  }
  return lines.join('\n');
}

export function regenerateArtifact(
  laneId,
  manifest,
  { spawn = spawnSync } = {},
) {
  const lane = manifest.lanes[laneId];
  if (!lane) throw new Error(`unknown lane: ${laneId}`);
  if (!lane.write_command) throw new Error(`lane ${laneId} is not a generated artifact lane`);

  for (const [phase, command] of [
    ['regenerate', lane.write_command],
    ['check', laneCommand(laneId, manifest)],
  ]) {
    console.log(`${phase} ${laneId}: ${command}`);
    const result = spawn(command, { cwd: REPO_ROOT, shell: true, stdio: 'inherit' });
    if (result.status !== 0) {
      throw new Error(`${phase} command for ${laneId} failed (exit ${result.status ?? 'unknown'})`);
    }
  }
}

function formatSeconds(entry) {
  if (!entry) return 'unmeasured';
  return entry.seconds >= 60
    ? `~${Math.round(entry.seconds / 6) / 10}m`
    : `~${entry.seconds}s`;
}

async function main(argv) {
  const args = { mode: 'inner', modeSpecified: false, changed: [], json: false, list: false, run: false, jobs: 1, measure: [], keepGoing: false, skip: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--mode') {
      args.mode = argv[++i];
      args.modeSpecified = true;
    }
    else if (arg === '--base') args.base = argv[++i];
    else if (arg === '--changed') args.changed.push(argv[++i]);
    else if (arg === '--json') args.json = true;
    else if (arg === '--list') args.list = true;
    else if (arg === '--run') args.run = true;
    else if (arg === '--jobs') args.jobs = Number(argv[++i]);
    else if (arg === '--record') args.record = argv[++i];
    else if (arg === '--measure') args.measure.push(argv[++i]);
    else if (arg === '--measure-all') args.measureAll = true;
    else if (arg === '--regenerate') args.regenerate = argv[++i];
    else if (arg === '--only') args.only = argv[++i];
    else if (arg === '--resume') args.resume = argv[++i];
    else if (arg === '--force') args.force = true;
    else if (arg === '--keep-going') args.keepGoing = true;
    else if (arg === '--skip') args.skip.push(...argv[++i].split(',').map((value) => value.trim()).filter(Boolean));
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!['inner', 'push', 'sprint', 'full'].includes(args.mode)) {
    throw new Error(`unknown mode: ${args.mode}`);
  }
  if (!Number.isSafeInteger(args.jobs) || args.jobs <= 0) {
    throw new Error('--jobs must be a positive integer');
  }
  const measuring = args.measureAll || args.measure.length > 0;
  if (args.resume) args.run = true;
  if (args.only && args.resume) throw new Error('--only cannot be combined with --resume');
  if (args.only && (args.modeSpecified || args.changed.length > 0 || args.base || args.list || args.record || args.regenerate || measuring)) {
    throw new Error('--only cannot be combined with mode, diff, list, record, measure, or regenerate options');
  }
  if (args.resume && (args.modeSpecified || args.changed.length > 0 || args.base || args.json || args.list || args.record || args.regenerate || measuring)) {
    throw new Error('--resume cannot be combined with selection, inspection, recording, measurement, or regeneration options');
  }
  if (args.run && (args.json || args.list || args.record || args.regenerate || measuring)) {
    throw new Error('--run cannot be combined with --json, --list, --record, --measure, or --regenerate');
  }
  if (args.jobs !== 1 && !args.run) {
    throw new Error('--jobs is only valid with --run');
  }
  if (args.force && (!args.run || args.mode !== 'full' || args.resume || args.only)) {
    throw new Error('--force is valid only with --mode full --run');
  }
  if (args.keepGoing && !args.run) {
    throw new Error('--keep-going is only valid with --run');
  }
  // --skip is allowed with --resume so a resumed sweep -- including the
  // automatic one after a preemption -- keeps excluding what the operator
  // excluded. It is still meaningless without a plan to subtract from.
  if (args.skip.length > 0 && (!args.run || args.only || measuring || args.list || args.record || args.regenerate)) {
    throw new Error('--skip is only valid with a selection --run (not with --only, --list, --record, --measure, or --regenerate)');
  }
  if (measuring && (args.json || args.list || args.record || args.regenerate)) {
    throw new Error('--measure cannot be combined with --json, --list, --record, or --regenerate');
  }
  if (args.regenerate && (args.json || args.list || args.record || args.changed.length > 0 || args.base)) {
    throw new Error('--regenerate must be used without selection or recording options');
  }

  const manifest = loadManifest();
  validateExecutionManifest(manifest);
  if (measuring) {
    // Cheapest first, so a long sweep banks its easy lanes before the slow ones.
    const laneIds = args.measureAll
      ? orderedExecutionPlan(Object.keys(manifest.lanes), manifest, costEstimates(loadTimings(), loadTimings(RUNTIME_TIMINGS_PATH), manifest))
      : args.measure;
    for (const laneId of laneIds) {
      if (!manifest.lanes[laneId]) throw new Error(`unknown lane: ${laneId}`);
    }
    const baseline = loadTimings();
    const results = await measureLanes(laneIds, manifest, {
      timings: baseline,
      compareTo: costEstimates(baseline, loadTimings(RUNTIME_TIMINGS_PATH), manifest),
      persist: (timings) => writeTimings(TIMINGS_PATH, timings),
    });
    console.log(formatMeasurementReport(results));
    const skipped = results.filter((result) => result.skipped);
    if (skipped.length > 0) {
      console.error(`\n${skipped.length} diff-sensitive lane(s) skipped: ${skipped.map((r) => r.laneId).join(', ')}`);
    }
    const failed = results.filter((result) => result.failedPhase);
    if (failed.length > 0) {
      console.error(`\n${failed.length} lane(s) failed to measure: ${failed.map((r) => r.laneId).join(', ')}`);
      process.exitCode = 1;
    }
    return;
  }
  if (args.record) return await recordLane(args.record, manifest);
  if (args.regenerate) return regenerateArtifact(args.regenerate, manifest);
  const baselineTimings = loadTimings();
  // Pruned here, not only inside the estimate, so the --run write-back below
  // persists the pruned file rather than carrying deleted lanes forward.
  const runtimeTimings = pruneUnknownLanes(loadTimings(RUNTIME_TIMINGS_PATH), manifest);
  const timings = costEstimates(baselineTimings, runtimeTimings, manifest);

  if (args.list) {
    for (const laneId of Object.keys(manifest.lanes)) {
      console.log(`${formatSeconds(timings.lanes[laneId]).padStart(10)}  ${laneId}  ${laneCommand(laneId, manifest)}`);
    }
    return;
  }

  let resume = null;
  let context = null;
  if (args.resume) {
    const receiptPath = resolve(args.resume);
    const raw = readFileSync(receiptPath);
    const receipt = JSON.parse(raw.toString('utf8'));
    context = currentProofContext();
    resume = {
      receiptPath,
      receipt,
      receiptSha256: createHash('sha256').update(raw).digest('hex'),
      ...planReceiptResume(receipt, manifest, context),
    };
  }

  const changed = args.only || args.resume
    ? []
    : args.changed.length > 0 ? args.changed : gitChangedFiles(args.base ?? manifest.base_ref);
  const touchesCrates = changed.some((f) => f.startsWith('crates/'));
  let crateGraph = null;
  if (touchesCrates) {
    try {
      crateGraph = workspaceCrateGraph();
    } catch {
      console.error('warning: cargo metadata unavailable; arming all crate lanes conservatively');
    }
  }

  const selection = args.resume
    ? {
        mode: resume.receipt.context.mode,
        touched: [], artifactTriggers: [], unmapped: [], crateFallback: false,
        laneIds: resume.selected,
        frozenSkipped: [],
      }
    : args.only
      ? {
          mode: 'only',
          touched: [], artifactTriggers: [], unmapped: [], crateFallback: false,
          laneIds: [args.only], frozenSkipped: [],
        }
      : selectLanes({ changed, manifest, crateGraph, mode: args.mode });
  for (const laneId of selection.laneIds) {
    if (!manifest.lanes[laneId]) throw new Error(`unknown lane: ${laneId}`);
  }
  const dependencyExpandedLaneIds = expandHardDependencies(selection.laneIds, manifest);
  const ordered = args.resume
    ? resume.selected
    : orderedExecutionPlan(dependencyExpandedLaneIds, manifest, timings);

  let cachePlan = null;
  if (args.run && selection.mode === 'full' && !resume) {
    const eligible = ordered.filter((laneId) => frozenLaneIds(manifest).has(laneId));
    try {
      const sharedInputs = {
        root: REPO_ROOT,
        files: workspaceFiles(REPO_ROOT),
        metadata: workspaceMetadata(REPO_ROOT),
        toolchain: proofToolchain(),
        fingerprints: new Map(),
      };
      const laneKeys = new Map(
        eligible.map((laneId) => [laneId, computeLaneProofKey(laneId, manifest, sharedInputs)]),
      );
      const lookup = loadProofCacheHits(eligible, manifest, { ...sharedInputs, computedKeys: laneKeys });
      cachePlan = {
        eligible,
        laneKeys,
        hits: args.force ? new Map() : lookup.hits,
        observedHits: lookup.hits,
        misses: lookup.misses,
        invalid: new Set(
          [...lookup.misses].filter(([, miss]) => miss.reason !== 'not-found').map(([laneId]) => laneId),
        ),
      };
    } catch (error) {
      cachePlan = {
        eligible,
        laneKeys: new Map(),
        hits: new Map(),
        observedHits: new Map(),
        misses: new Map(),
        invalid: new Set(),
        setupError: error.message,
      };
    }
  }

  if (args.json) {
    console.log(JSON.stringify({
      ...selection,
      directLaneIds: selection.laneIds,
      laneIds: dependencyExpandedLaneIds,
      changed,
      lanes: ordered.map((id) => ({ id, command: laneCommand(id, manifest), timing: timings.lanes[id] ?? null })),
    }, null, 2));
    return;
  }

  console.log(`mode: ${selection.mode}   changed files: ${changed.length}`);
  if (resume) {
    console.log(`  resuming ${resume.receipt.id}: rerun ${resume.rerun.length}, reuse ${resume.reusedLanes.size}`);
  }
  if (cachePlan) {
    const forced = args.force ? `; force reruns ${cachePlan.observedHits.size} reusable lane(s)` : '';
    console.log(
      `  frozen proof cache: reuse ${cachePlan.hits.size}, execute ${cachePlan.eligible.length - cachePlan.hits.size}${forced}`,
    );
    if (cachePlan.setupError) console.log(`    cache disabled; executing frozen lanes: ${cachePlan.setupError}`);
    for (const [laneId, miss] of cachePlan.misses) {
      if (miss.reason !== 'not-found') console.log(`    cache miss ${laneId}: ${miss.reason}`);
    }
  }
  for (const { id, reasons } of selection.touched) {
    const shown = reasons.slice(0, 3).join(', ') + (reasons.length > 3 ? `, +${reasons.length - 3} more` : '');
    console.log(`  touched ${id}  (${shown})`);
  }
  for (const { laneId, reasons } of selection.artifactTriggers) {
    const shown = reasons.slice(0, 3).join(', ') + (reasons.length > 3 ? `, +${reasons.length - 3} more` : '');
    console.log(`  generated artifact ${laneId}  (${shown})`);
  }
  if (selection.unmapped.length > 0) {
    console.log(`  warning: ${selection.unmapped.length} unmapped file(s) — consider --mode full or extending the manifest:`);
    for (const file of selection.unmapped) console.log(`    ? ${file}`);
  }
  if (selection.crateFallback) console.log('  warning: crate graph unavailable; all crate lanes armed');
  console.log(`required lanes (${ordered.length}), cheapest first:`);
  for (const laneId of ordered) {
    console.log(`  ${formatSeconds(timings.lanes[laneId]).padStart(10)}  ${laneCommand(laneId, manifest)}`);
  }
  if (selection.frozenSkipped.length > 0) {
    console.log(`frozen areas untouched, lanes skipped: ${selection.frozenSkipped.join(', ')}`);
  }
  if (args.run) {
    const skippedLaneIds = new Set(args.skip);
    for (const laneId of skippedLaneIds) {
      if (!manifest.lanes[laneId]) throw new Error(`--skip references unknown lane ${laneId}`);
      if (!ordered.includes(laneId)) throw new Error(`--skip ${laneId} is not in the selected plan; nothing to skip`);
    }
    // A deliberately focused run is the one case where the operator is asking
    // about this lane specifically, so it gates: --only cargo:api must go red
    // when cargo:api is red, quarantine or not.
    const quarantineInPlan = args.only
      ? []
      : quarantineEntries(manifest)
        .filter((entry) => ordered.includes(entry.lane) && !skippedLaneIds.has(entry.lane));
    const expired = expiredQuarantineEntries(quarantineInPlan);
    if (expired.length > 0) {
      for (const entry of expired) {
        console.error(`quarantine expired: lane ${entry.lane} was due ${entry.expires} (owner ${entry.owner}); fix the underlying issue or renew the entry`);
      }
      throw new Error(`proof failed: ${expired.length} quarantine entr${expired.length === 1 ? 'y' : 'ies'} past expiry`);
    }
    // An expiry only gates the runs that happen to select its lane, so a lapsed
    // promise on an unselected lane could sit unseen for weeks. Say so on every
    // run without turning an unrelated lane's date into a hard time bomb.
    const laneIdsInPlan = new Set(quarantineInPlan.map((entry) => entry.lane));
    for (const entry of expiredQuarantineEntries(quarantineEntries(manifest))) {
      if (laneIdsInPlan.has(entry.lane)) continue;
      console.error(`warning: quarantine for ${entry.lane} expired ${entry.expires} (owner ${entry.owner}); it is not in this plan, but the next run that selects it will fail`);
    }
    const quarantinedLaneIds = new Set(quarantineInPlan.map((entry) => entry.lane));
    if (skippedLaneIds.size > 0) {
      console.log(`skipping ${skippedLaneIds.size} lane(s) (not proven): ${[...skippedLaneIds].join(', ')}`);
    }
    for (const entry of quarantineInPlan) {
      console.log(`quarantined (not gating): ${entry.lane} — expires ${entry.expires}, owner ${entry.owner}`);
    }
    const observations = new Map();
    context ??= currentProofContext();
    const execution = await runExecutionPlan(ordered, manifest, {
      jobs: args.jobs,
      keepGoing: args.keepGoing,
      skippedLaneIds,
      quarantinedLaneIds,
      receiptContext: {
        ...context,
        mode: selection.mode,
        selected_lane_ids: ordered,
        changed,
        // Who authorized each non-gating red, and until when. The manifest hash
        // already binds the list; naming it here makes a receipt readable on its
        // own instead of only against the manifest it was run from.
        quarantine: quarantineInPlan,
        skipped_lane_ids: [...skippedLaneIds],
        keep_going: args.keepGoing,
        resumed_from: resume ? {
          id: resume.receipt.id,
          path: resume.receiptPath,
          receipt_sha256: resume.receiptSha256,
        } : null,
      },
      reusedLanes: resume?.reusedLanes ?? cachePlan?.hits,
      onResult(laneId, entry) {
        observations.set(laneId, entry);
      },
    });
    for (const [laneId, entry] of observations) runtimeTimings.lanes[laneId] = entry;
    writeTimings(RUNTIME_TIMINGS_PATH, runtimeTimings);
    if (!execution.success) {
      if (execution.preempted) {
        console.error(`proof preempted by unregistered build work; resume: npm run proof:lanes -- --resume ${JSON.stringify(execution.run.receiptPath)}`);
        throw new Error(`proof preempted: inspect ${execution.run.receiptPath}`);
      }
      const failed = Object.entries(execution.receipt.lanes)
        .find(([, lane]) => lane.state === 'failed')?.[0];
      console.error(`resume: npm run proof:lanes -- --resume ${JSON.stringify(execution.run.receiptPath)}`);
      if (failed) console.error(`focused: npm run proof:lanes -- --only ${JSON.stringify(failed)} --run`);
      throw new Error(`proof failed: inspect ${execution.run.receiptPath}`);
    }
    let stored = [];
    if (cachePlan) {
      try {
        stored = persistProofCacheEntries(execution, cachePlan.laneKeys, {
          root: REPO_ROOT,
          replaceLaneIds: cachePlan.invalid,
        });
      } catch (error) {
        console.error(`warning: proof passed but frozen-lane cache persistence failed: ${error.message}`);
      }
    }
    const reused = cachePlan?.hits.size ?? resume?.reusedLanes.size ?? 0;
    const cacheSummary = cachePlan ? `; reused ${reused}, cached ${stored.length}` : '';
    // A non-gating run still has to say what it did not prove. A quarantined or
    // skipped lane strands its dependents as `blocked`, and those dependents are
    // exactly as unproven as the lane that stranded them -- counting only the
    // plan length here is how a run with unproven lanes reads as fully green.
    const summary = summarizeLaneStates(execution.receipt);
    const notGreen = Object.entries(summary.counts)
      .filter(([state]) => state !== 'passed')
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([state, count]) => `${count} ${state}`);
    const notGreenSummary = notGreen.length > 0 ? ` — NOT fully green: ${notGreen.join(', ')}` : '';
    console.log(`\nproof passed: ${summary.passed} of ${summary.total} lane(s)${cacheSummary}${notGreenSummary} — receipt ${execution.run.receiptPath}`);
    for (const lane of summary.unproven) {
      const cause = lane.blockedBy ? ` (${lane.blockedBy})` : '';
      console.log(`  not proven: ${lane.state.padEnd(11)} ${lane.laneId}${cause}`);
    }
    for (const entry of quarantineInPlan) {
      if (execution.receipt.lanes[entry.lane]?.state === 'passed') {
        console.log(`note: quarantined lane ${entry.lane} passed — consider removing its quarantine entry`);
      }
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const argv = process.argv.slice(2);
  const lockHeld =
    process.env.HOST_HEAVY_BUILD_LOCK_HELD === '1' ||
    process.env.MESH_HEAVY_BUILD_LOCK_HELD === '1';
  if (requiresHostHeavyBuildLock(argv) && !lockHeld) {
    const runUnderHostLock = (lockedArgv) => spawnSync(
      'python3',
      [HOST_HEAVY_BUILD_LOCK_SCRIPT, '--', process.execPath, fileURLToPath(import.meta.url), ...lockedArgv],
      { cwd: REPO_ROOT, env: process.env, stdio: 'inherit' },
    );
    let result = runUnderHostLock(argv);
    // A lane preempted by unregistered build work is not a red; resume the run
    // once (reusing passed lanes) rather than burning a manual cycle. A second
    // preemption from the resume surfaces as failure without looping.
    if (shouldAutoResumeAfterPreemption(result.status, argv)) {
      const receiptPath = readPreemptedRunReceiptPath();
      if (receiptPath) {
        console.error(`proof preempted by unregistered build work; auto-resuming once: ${receiptPath}`);
        result = runUnderHostLock(resumeArgv(argv, receiptPath));
      } else {
        console.error('proof preempted by unregistered build work before a resumable receipt existed; re-run the proof');
      }
    }
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } else main(argv).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
