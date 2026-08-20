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
//                                    [--jobs <positive integer>]
//                                    [--record <lane-id>] [--regenerate <lane-id>]
//                                    [--measure <lane-id> ...] [--measure-all]
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
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, matchesGlob } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  expandHardDependencies,
  runExecutionPlan,
  validateExecutionManifest,
} from './proof_lane_execution.mjs';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const MANIFEST_PATH = join(REPO_ROOT, 'docs', 'ops', 'proof-lane-manifest.json');
export const TIMINGS_PATH = join(REPO_ROOT, 'docs', 'ops', 'proof-lane-timings.json');
export const RUNTIME_TIMINGS_PATH = join(REPO_ROOT, 'target', 'proof-lanes', 'timings.json');

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

// `--run` gives these lanes a generated local database. The old serial
// record/measure paths execute shell commands directly, so they must not be
// allowed to inherit an arbitrary DATABASE_URL while this deliberate split
// remains in place.
export function usesRunnerOwnedPostgres(lane) {
  return Boolean(lane?.execution?.resources?.some((resource) => resource.kind === 'postgres'));
}

function assertDirectMeasurementIsSafe(laneId, manifest) {
  if (usesRunnerOwnedPostgres(manifest.lanes[laneId])) {
    throw new Error(
      `${laneId} requires runner-owned disposable Postgres; --record/--measure must use the scoped execution path`,
    );
  }
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

function recordLane(laneId, manifest) {
  assertDirectMeasurementIsSafe(laneId, manifest);
  const command = laneCommand(laneId, manifest);
  console.log(`recording ${laneId}: ${command}`);
  const started = Date.now();
  const result = spawnSync(command, { cwd: REPO_ROOT, shell: true, stdio: 'inherit' });
  const seconds = Math.round((Date.now() - started) / 100) / 10;
  if (result.status !== 0) {
    console.error(`lane ${laneId} failed (exit ${result.status}) after ${seconds}s; timing not recorded`);
    process.exit(result.status ?? 1);
  }
  const timings = loadTimings();
  timings.lanes[laneId] = {
    seconds,
    measured_at: new Date().toISOString(),
    command,
    status: 0,
  };
  writeTimings(TIMINGS_PATH, timings);
  console.log(`recorded ${laneId}: ${seconds}s`);
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
export function measureLane(
  laneId,
  manifest,
  { spawn = spawnSync, now = Date.now, log = console.log } = {},
) {
  assertDirectMeasurementIsSafe(laneId, manifest);
  const command = laneCommand(laneId, manifest);
  const warmup = warmupCommand(command);
  const phase = (label, phaseCommand) => {
    log(`  ${label}: ${phaseCommand}`);
    const started = now();
    const result = spawn(phaseCommand, { cwd: REPO_ROOT, shell: true, stdio: 'inherit' });
    const finished = now();
    return { seconds: elapsedSeconds(started, finished), finished, status: result.status ?? 1 };
  };

  const warmed = phase('warm', warmup);
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
  const measured = phase('measure', command);
  return {
    laneId,
    command,
    status: measured.status,
    failedPhase: measured.status === 0 ? null : 'measure',
    warmup_command: warmup,
    warmup_seconds: warmed.seconds,
    seconds: measured.seconds,
    method: 'isolated',
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
export function measureLanes(
  laneIds,
  manifest,
  {
    spawn = spawnSync,
    now = Date.now,
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
    const measurement = measureLane(laneId, manifest, { spawn, now, log });
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
  const args = { mode: 'inner', changed: [], json: false, list: false, run: false, jobs: 1, measure: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--mode') args.mode = argv[++i];
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
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!['inner', 'push', 'sprint', 'full'].includes(args.mode)) {
    throw new Error(`unknown mode: ${args.mode}`);
  }
  if (!Number.isSafeInteger(args.jobs) || args.jobs <= 0) {
    throw new Error('--jobs must be a positive integer');
  }
  const measuring = args.measureAll || args.measure.length > 0;
  if (args.run && (args.json || args.list || args.record || args.regenerate || measuring)) {
    throw new Error('--run cannot be combined with --json, --list, --record, --measure, or --regenerate');
  }
  if (args.jobs !== 1 && !args.run) {
    throw new Error('--jobs is only valid with --run');
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
    const results = measureLanes(laneIds, manifest, {
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
  if (args.record) return recordLane(args.record, manifest);
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

  const changed = args.changed.length > 0 ? args.changed : gitChangedFiles(args.base ?? manifest.base_ref);
  const touchesCrates = changed.some((f) => f.startsWith('crates/'));
  let crateGraph = null;
  if (touchesCrates) {
    try {
      crateGraph = workspaceCrateGraph();
    } catch {
      console.error('warning: cargo metadata unavailable; arming all crate lanes conservatively');
    }
  }

  const selection = selectLanes({ changed, manifest, crateGraph, mode: args.mode });
  const dependencyExpandedLaneIds = expandHardDependencies(selection.laneIds, manifest);
  const ordered = orderedExecutionPlan(dependencyExpandedLaneIds, manifest, timings);

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
    const observations = new Map();
    const execution = await runExecutionPlan(ordered, manifest, {
      jobs: args.jobs,
      onResult(laneId, entry) {
        observations.set(laneId, entry);
      },
    });
    for (const [laneId, entry] of observations) runtimeTimings.lanes[laneId] = entry;
    writeTimings(RUNTIME_TIMINGS_PATH, runtimeTimings);
    if (!execution.success) {
      throw new Error(`proof failed: inspect ${execution.run.receiptPath}`);
    }
    console.log(`\nproof passed: ${ordered.length} lane(s) — receipt ${execution.run.receiptPath}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
