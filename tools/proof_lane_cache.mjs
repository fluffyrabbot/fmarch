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
  readlinkSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { arch, platform, release } from 'node:os';
import { dirname, join, matchesGlob, relative, resolve } from 'node:path';

import { expandHardDependencies } from './proof_lane_execution.mjs';

export const PROOF_CACHE_SCHEMA = 1;

const GLOBAL_INPUTS = [
  'Cargo.lock',
  'Cargo.toml',
  'package-lock.json',
  'frontend/package-lock.json',
  'package.json',
  'frontend/package.json',
  'rust-toolchain.toml',
  'rust-toolchain',
  'tools/proof_lane_cache.mjs',
  'tools/proof_lane_execution.mjs',
  'tools/proof_lane_select.mjs',
];

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

function pathMatches(file, entry) {
  if (/[*?\[\]{}]/.test(entry)) return matchesGlob(file, entry);
  if (entry.endsWith('/') || entry.endsWith('.')) return file.startsWith(entry);
  return file === entry;
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
      lane.execution?.class !== 'network' &&
      !(lane.execution?.resources ?? []).some((resource) =>
        resource.kind === 'network' || (resource.kind === 'postgres' && resource.mode !== 'lane-isolated')))
    .map(([id]) => id));
}

export function workspaceFiles(root) {
  const output = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: root },
  );
  return output.toString('utf8').split('\0').filter(Boolean).sort();
}

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

function transitivePackageRoots(laneIds, manifest, metadata, root) {
  const workspaceMemberIds = new Set(metadata.workspace_members ?? []);
  const workspacePackages = workspaceMemberIds.size === 0
    ? metadata.packages
    : metadata.packages.filter((pkg) => workspaceMemberIds.has(pkg.id));
  const packages = new Map(workspacePackages.map((pkg) => [pkg.name, pkg]));
  const selectedLaneIds = new Set(laneIds);
  // A test target's executable depends on its complete Cargo closure, including
  // dev/build dependencies, even when behavioral ownership is a narrow source.
  const selected = new Set(manifest.areas
    .filter((area) => area.lanes.some((id) => selectedLaneIds.has(id)))
    .map((area) => area.crate ?? area.closure_crate)
    .filter((name) => packages.has(name)));
  for (const id of laneIds) {
    const lane = manifest.lanes[id];
    const roots = new Set(manifest.areas.filter((area) => area.lanes.includes(id))
      .map((area) => area.crate ?? area.closure_crate).filter((name) => packages.has(name)));
    for (const target of lane.assertion_targets ?? []) {
      const name = target.split('/')[0];
      if (packages.has(name)) roots.add(name);
    }
    const argv = lane.execution?.argv ?? [];
    for (let index = 0; index < argv.length - 1; index += 1) {
      if (['-p', '--package'].includes(argv[index]) && packages.has(argv[index + 1])) roots.add(argv[index + 1]);
    }
    for (const name of roots) selected.add(name);
    // Browser/live acceptance executes the site. Cargo commands without a
    // known package root fail closed to the complete workspace input set.
    if (lane.execution?.class === 'browser' || argv.includes('--workspace') ||
        ['cargo', 'postgres'].includes(lane.execution?.class) && roots.size === 0) {
      for (const name of packages.keys()) selected.add(name);
    }
  }
  const queue = [...selected];
  while (queue.length > 0) {
    const pkg = packages.get(queue.shift());
    for (const dependency of pkg?.dependencies ?? []) {
      if (!packages.has(dependency.name) || selected.has(dependency.name)) continue;
      selected.add(dependency.name);
      queue.push(dependency.name);
    }
  }
  return [...selected]
    .map((name) => dirname(packages.get(name).manifest_path))
    .map((path) => `${relative(root, path).replaceAll('\\', '/')}/`)
    .sort();
}

function fileFingerprint(root, path) {
  const absolute = join(root, path);
  const metadata = lstatSync(absolute);
  if (metadata.isSymbolicLink()) {
    return { path, mode: metadata.mode, kind: 'symlink', sha256: sha256(readlinkSync(absolute)) };
  }
  return { path, mode: metadata.mode, kind: 'file', sha256: sha256(readFileSync(absolute)) };
}

function relevantAreaEntries(laneIds, manifest) {
  const selected = new Set(laneIds);
  return manifest.areas
    .filter((area) => area.lanes.some((laneId) => selected.has(laneId)))
    .flatMap((area) => area.paths);
}

export function computeLaneProofKey(laneId, manifest, {
  root,
  files = workspaceFiles(root),
  metadata = workspaceMetadata(root),
  toolchain = proofToolchain(),
  fingerprints = new Map(),
} = {}) {
  if (!manifest.lanes[laneId]) throw new Error(`unknown proof lane ${laneId}`);
  const dependencyLaneIds = expandHardDependencies([laneId], manifest).sort();
  const lanes = dependencyLaneIds.map((id) => manifest.lanes[id]);
  const matchers = new Set([
    ...GLOBAL_INPUTS,
    // Shared tooling, imported fixtures, packs, frontend assets, and root config
    // are execution inputs regardless of behavioral ownership.
    ...files.filter((file) => !file.startsWith('crates/') || file.endsWith('/Cargo.toml')),
    // Static and live-tool commands can inspect arbitrary repository sources.
    ...(lanes.every((lane) => ['cargo', 'postgres'].includes(lane.execution?.class)) ? [] : files),
    ...relevantAreaEntries(dependencyLaneIds, manifest),
    ...lanes.flatMap((lane) => [...(lane.inputs ?? []), ...(lane.outputs ?? [])]),
    ...transitivePackageRoots(dependencyLaneIds, manifest, metadata, root),
  ]);
  for (const file of files) {
    if (/(^|\/)migrations?\//.test(file)) matchers.add(file);
  }
  const matcherList = [...matchers].sort();
  const inputFiles = files
    .filter((file) => matcherList.some((entry) => pathMatches(file, entry)))
    .filter((file) => existsSync(join(root, file)))
    .map((file) => {
      if (!fingerprints.has(file)) fingerprints.set(file, fileFingerprint(root, file));
      return fingerprints.get(file);
    });
  const payload = canonical({
    schema: PROOF_CACHE_SCHEMA,
    lane_id: laneId,
    dependency_lane_ids: dependencyLaneIds,
    lanes: Object.fromEntries(dependencyLaneIds.map((id) => [id, manifest.lanes[id]])),
    areas: manifest.areas.filter((area) => area.lanes.some((id) => dependencyLaneIds.includes(id))),
    matchers: matcherList,
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

export function readProofCacheEntry(root, laneId, proofKey) {
  const paths = proofCachePaths(root, laneId, proofKey);
  const entry = JSON.parse(readFileSync(paths.receipt, 'utf8'));
  if (entry.schema !== PROOF_CACHE_SCHEMA || entry.proof_key !== proofKey ||
      entry.lane_id !== laneId || entry.state !== 'passed' || entry.lane?.status !== 0) {
    throw new Error('cache entry identity or success state is invalid');
  }
  if (sha256(JSON.stringify(canonical(entry.inputs))) !== proofKey) {
    throw new Error('cache input fingerprint does not match its key');
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
