// Content-addressed proof reuse for isolated repository-owned proof lanes.
//
// A cache entry is a successful lane receipt plus its runner-scoped artifacts.
// The key is deliberately lane-local: it covers canonical crate lanes' proof-
// graph package closure (including specialized executable targets), shared
// source/fixture paths, migrations, dependency locks, pinned/runtime toolchains, execution
// metadata, and the proof runner implementation. Unreadable or malformed
// entries are misses, never passes.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { arch, platform, release } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

import { expandHardDependencies } from './proof_lane_execution.mjs';
import { declaredLaneCacheInputs, executionInputMatches, resolveLaneCargoInputs, resolveLaneExecutionInputs, validateCacheInputContract } from './proof_lane_inputs.mjs';
import { assertNoIgnoredProofInputs, assertProofInputPaths, proofSourceFiles, UnsafeProofInputError } from './proof_input_paths.mjs';

// The receipt envelope is historical evidence. Changing the input contract
// invalidates reuse without making those immutable receipts corrupt.
export const PROOF_CACHE_SCHEMA = 1;
export const PROOF_CACHE_INPUT_SCHEMA = 3;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function safeProofLaneSegment(laneId) {
  return laneId.replaceAll(':', '_').replaceAll(/[^A-Za-z0-9._-]/g, '_');
}

function inside(root, candidate) {
  const rel = relative(resolve(root), resolve(candidate));
  return rel !== '' && !rel.startsWith('..') && !rel.startsWith('/');
}

export function frozenLaneIds(manifest) {
  const owners = new Map(Object.keys(manifest.lanes).map((laneId) => [laneId, []]));
  for (const area of manifest.areas) {
    for (const laneId of area.lanes) owners.get(laneId)?.push(area);
  }
  return new Set(
    [...owners]
      .filter(([, areas]) => areas.length > 0 && areas.every((area) => area.tier === 'frozen'))
      .map(([laneId]) => laneId),
  );
}

// Tier controls selection, not evidence validity. Live external/network probes
// remain execution-only; repository-owned isolated lanes can reuse exact keys.
export function reusableLaneIds(manifest) {
  return new Set(Object.entries(manifest.lanes)
    .filter(([, lane]) => lane.cache !== false &&
      lane.execution?.class !== 'hosted' &&
      !(lane.execution?.resources ?? []).some((resource) =>
        (resource.kind === 'lock' && resource.name === 'network') ||
        (resource.kind === 'postgres' && resource.mode !== 'lane-isolated')))
    .map(([id]) => id));
}

export const workspaceFiles = proofSourceFiles;

export function workspaceMetadata(root, { execute = execFileSync } = {}) {
  return JSON.parse(execute(
    'cargo',
    ['metadata', '--locked', '--format-version', '1'],
    { cwd: root, maxBuffer: 64 * 1024 * 1024 },
  ).toString('utf8'));
}

function commandVersion(file, args = []) {
  try {
    return execFileSync(file, args, { encoding: 'utf8' }).trim();
  } catch (error) {
    return `unavailable:${error?.code ?? error?.status ?? 'unknown'}`;
  }
}

export function proofToolchain() {
  return {
    environment_sha256: process.env.FMARCH_PROOF_ENVIRONMENT_SHA ?? null,
    platform: platform(),
    arch: arch(),
    os_release: release(),
    node: process.version,
    npm: commandVersion('npm', ['--version']),
    cargo: commandVersion('cargo', ['--version', '--verbose']),
    rustc: commandVersion('rustc', ['--version', '--verbose']),
    psql: commandVersion('psql', ['--version']),
    postgres: commandVersion('postgres', ['--version']),
    pg_config: commandVersion('pg_config', ['--version']),
  };
}

function fileFingerprint(root, path) {
  const absolute = join(root, path);
  const metadata = lstatSync(absolute);
  if (!metadata.isFile()) throw new UnsafeProofInputError(path, 'proof inputs must be regular files');
  return { path, mode: metadata.mode, kind: 'file', sha256: sha256(readFileSync(absolute)) };
}

export function laneProofInputs(laneIds, manifest, { root, metadata } = {}) {
  validateCacheInputContract(manifest, { metadata });
  const dependencies = expandHardDependencies(laneIds, manifest).sort();
  const cargo = resolveLaneCargoInputs(dependencies, manifest, metadata, { root });
  const edges = resolveLaneExecutionInputs(dependencies, manifest, metadata, { root });
  const selectors = [...declaredLaneCacheInputs(dependencies, manifest),
    ...cargo.selectors, ...edges.map(edge => edge.selector)];
  const matchers = [...new Map(selectors.map(selector =>
    [JSON.stringify(canonical(selector)), canonical(selector)])).entries()]
    .sort(([left], [right]) => left.localeCompare(right)).map(([, selector]) => selector);
  return { dependencyLaneIds: dependencies, cargo, edges, matchers };
}

export function validateLaneProofInputPaths(laneIds, manifest, {
  root, files = workspaceFiles(root), metadata = workspaceMetadata(root),
} = {}) {
  const inputs = laneProofInputs(laneIds, manifest, { root, metadata });
  assertProofInputPaths({ root, files, selectors: inputs.matchers });
  // Broad cache context may contain generated dependency/build trees. Only
  // actual source and fixture edges forbid ignored files that executors could
  // otherwise consume without binding them to either Git or the proof key.
  assertNoIgnoredProofInputs({ root, selectors: [
    ...inputs.cargo.selectors, ...inputs.edges.map(edge => edge.selector),
  ] });
  return inputs;
}

export function computeLaneProofKey(laneId, manifest, {
  root,
  files = workspaceFiles(root),
  metadata = workspaceMetadata(root),
  toolchain = proofToolchain(),
  fingerprints = new Map(),
} = {}) {
  if (!manifest.lanes[laneId]) throw new Error(`unknown proof lane ${laneId}`);
  const { dependencyLaneIds, cargo, edges, matchers: matcherList } = validateLaneProofInputPaths([laneId], manifest, { root, files, metadata });
  const inputFiles = [...new Set(files)].sort()
    .filter((file) => matcherList.some((entry) => executionInputMatches(file, entry)))
    .filter((file) => existsSync(join(root, file)))
    .map((file) => {
      if (!fingerprints.has(file)) fingerprints.set(file, fileFingerprint(root, file));
      return fingerprints.get(file);
    });
  const payload = canonical({
    schema: PROOF_CACHE_INPUT_SCHEMA,
    lane_id: laneId,
    dependency_lane_ids: dependencyLaneIds,
    lanes: Object.fromEntries(dependencyLaneIds.map((id) => [id, manifest.lanes[id]])),
    runner: manifest.runner,
    matchers: matcherList,
    execution_inputs: edges,
    cargo_targets: cargo.targets,
    inputs: inputFiles,
    toolchain,
  });
  return {
    proofKey: sha256(JSON.stringify(payload)),
    payload,
  };
}

export function proofCacheArtifactDigest(root) {
  const entries = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const name = join(directory, entry.name);
      const metadata = lstatSync(name);
      const path = relative(root, name).replaceAll('\\', '/');
      if (metadata.isSymbolicLink()) throw new Error(`cached artifact may not be a symlink: ${path}`);
      if (metadata.isDirectory()) {
        entries.push({ path, kind: 'directory', mode: metadata.mode });
        visit(name);
      } else if (metadata.isFile()) {
        entries.push({ path, kind: 'file', mode: metadata.mode, sha256: sha256(readFileSync(name)) });
      } else throw new Error(`cached artifact has unsupported type: ${path}`);
    }
  };
  visit(root);
  return sha256(JSON.stringify(entries));
}

export function proofCachePaths(root, laneId, proofKey) {
  const directory = join(root, 'target', 'proof-lanes', 'cache', safeProofLaneSegment(laneId), proofKey);
  return { directory, receipt: join(directory, 'entry.json'), artifacts: join(directory, 'artifacts') };
}

export function readProofCacheEntry(root, laneId, proofKey, { allowHistoricalInputs = false } = {}) {
  const paths = proofCachePaths(root, laneId, proofKey);
  const entry = JSON.parse(readFileSync(paths.receipt, 'utf8'));
  if (entry.schema !== PROOF_CACHE_SCHEMA || entry.proof_key !== proofKey ||
      entry.lane_id !== laneId || entry.state !== 'passed' || entry.lane?.status !== 0) {
    throw new Error('cache entry identity or success state is invalid');
  }
  if (sha256(JSON.stringify(canonical(entry.inputs))) !== proofKey) {
    throw new Error('cache input fingerprint does not match its key');
  }
  if (![1, 2, PROOF_CACHE_INPUT_SCHEMA].includes(entry.inputs?.schema) || entry.inputs.lane_id !== laneId) {
    throw new Error('cache input contract schema or lane identity is invalid');
  }
  if (!allowHistoricalInputs && entry.inputs.schema !== PROOF_CACHE_INPUT_SCHEMA) {
    throw new Error(`cache input contract schema ${entry.inputs.schema} is obsolete; expected ${PROOF_CACHE_INPUT_SCHEMA}`);
  }
  if (typeof entry.source_receipt !== 'string' || sha256(entry.source_receipt) !== entry.source_receipt_sha256) {
    throw new Error('cache source receipt digest does not match');
  }
  const source = JSON.parse(entry.source_receipt);
  if (source.id !== entry.source_receipt_id || JSON.stringify(canonical(source.lanes?.[laneId])) !== JSON.stringify(canonical(entry.lane))) {
    throw new Error('cache source receipt does not qualify this lane');
  }
  if (!inside(paths.directory, paths.artifacts) || !lstatSync(paths.artifacts).isDirectory()) {
    throw new Error('cache artifact directory is invalid');
  }
  if (proofCacheArtifactDigest(paths.artifacts) !== entry.artifact_sha256) {
    throw new Error('cache artifact digest does not match');
  }
  return { entry, paths };
}

export function loadProofCacheHits(laneIds, manifest, options = {}) {
  const hits = new Map();
  const misses = new Map();
  for (const laneId of laneIds) {
    let computed;
    try {
      computed = options.computedKeys?.get(laneId) ?? computeLaneProofKey(laneId, manifest, options);
      const { entry, paths } = readProofCacheEntry(options.root, laneId, computed.proofKey);
      hits.set(laneId, {
        ...entry.lane,
        receipt_id: entry.source_receipt_id,
        receipt_sha256: entry.source_receipt_sha256,
        proof_key: entry.proof_key,
        artifact_source_dir: paths.artifacts,
      });
    } catch (error) {
      misses.set(laneId, { proofKey: computed?.proofKey ?? null, reason: error?.code === 'ENOENT' ? 'not-found' : error.message });
    }
  }
  return { hits, misses };
}

export function persistProofCacheEntries(execution, laneKeys, { root, replaceLaneIds = new Set() }) {
  const stored = [];
  for (const [laneId, computed] of laneKeys) {
    const lane = execution.receipt.lanes[laneId];
    if (lane?.state !== 'passed' || lane.status !== 0 || lane.reused_from_proof_key) continue;
    const paths = proofCachePaths(root, laneId, computed.proofKey);
    if (replaceLaneIds.has(laneId)) rmSync(paths.directory, { recursive: true, force: true });
    if (existsSync(paths.receipt)) continue;
    const sourceArtifacts = lane.artifact_dir;
    if (!sourceArtifacts || !inside(execution.run.runDir, sourceArtifacts)) continue;
    const temporary = `${paths.directory}.tmp-${process.pid}`;
    rmSync(temporary, { recursive: true, force: true });
    mkdirSync(temporary, { recursive: true });
    try {
      const artifacts = join(temporary, 'artifacts');
      cpSync(sourceArtifacts, artifacts, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
      const entry = {
        schema: PROOF_CACHE_SCHEMA,
        lane_id: laneId,
        proof_key: computed.proofKey,
        state: 'passed',
        created_at: new Date().toISOString(),
        source_receipt_id: execution.receipt.id,
        source_receipt_sha256: sha256(readFileSync(execution.run.receiptPath)),
        source_receipt: readFileSync(execution.run.receiptPath, 'utf8'),
        artifact_sha256: proofCacheArtifactDigest(artifacts),
        lane,
        inputs: computed.payload,
      };
      writeFileSync(join(temporary, 'entry.json'), `${JSON.stringify(entry, null, 2)}\n`);
      mkdirSync(dirname(paths.directory), { recursive: true });
      try {
        renameSync(temporary, paths.directory);
        stored.push(laneId);
      } catch (error) {
        if (!existsSync(paths.receipt)) throw error;
      }
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }
  return stored;
}
