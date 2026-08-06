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
//                                    [--record <lane-id>] [--regenerate <lane-id>]
//
// --changed bypasses git and supplies the changed set explicitly (also used by
// the contract test). --run executes the selected lanes in cost order and stops
// on the first failure while recording runtime observations under target/.
// --record deliberately promotes one observation into the tracked timing
// baseline at docs/ops/proof-lane-timings.json.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, matchesGlob } from 'node:path';
import { fileURLToPath } from 'node:url';

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

export function mergeTimings(...sources) {
  return {
    version: 1,
    lanes: Object.assign({}, ...sources.map((source) => source?.lanes ?? {})),
  };
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
// fixtures. crateGraph of null means "unknown": if a crate area is touched we
// conservatively arm every crate area instead of guessing the closure.
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
    .filter((a) => a?.crate)
    .map((a) => a.crate);
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
    for (const dependency of manifest.lanes[laneId]?.after ?? []) {
      if (!manifest.lanes[dependency]) {
        throw new Error(`proof lane ${laneId} orders after unknown lane ${dependency}`);
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

function main(argv) {
  const args = { mode: 'inner', changed: [], json: false, list: false, run: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--mode') args.mode = argv[++i];
    else if (arg === '--base') args.base = argv[++i];
    else if (arg === '--changed') args.changed.push(argv[++i]);
    else if (arg === '--json') args.json = true;
    else if (arg === '--list') args.list = true;
    else if (arg === '--run') args.run = true;
    else if (arg === '--record') args.record = argv[++i];
    else if (arg === '--regenerate') args.regenerate = argv[++i];
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!['inner', 'push', 'sprint', 'full'].includes(args.mode)) {
    throw new Error(`unknown mode: ${args.mode}`);
  }
  if (args.run && (args.json || args.list || args.record || args.regenerate)) {
    throw new Error('--run cannot be combined with --json, --list, --record, or --regenerate');
  }
  if (args.regenerate && (args.json || args.list || args.record || args.changed.length > 0 || args.base)) {
    throw new Error('--regenerate must be used without selection or recording options');
  }

  const manifest = loadManifest();
  if (args.record) return recordLane(args.record, manifest);
  if (args.regenerate) return regenerateArtifact(args.regenerate, manifest);
  const baselineTimings = loadTimings();
  const runtimeTimings = loadTimings(RUNTIME_TIMINGS_PATH);
  const timings = mergeTimings(baselineTimings, runtimeTimings);

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
  const ordered = orderedExecutionPlan(selection.laneIds, manifest, timings);

  if (args.json) {
    console.log(JSON.stringify({ ...selection, changed, lanes: ordered.map((id) => ({ id, command: laneCommand(id, manifest), timing: timings.lanes[id] ?? null })) }, null, 2));
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
    runLanes(ordered, manifest, {
      onResult(laneId, entry) {
        runtimeTimings.lanes[laneId] = entry;
        writeTimings(RUNTIME_TIMINGS_PATH, runtimeTimings);
      },
    });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2));
}
