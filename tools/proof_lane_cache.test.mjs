import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  computeLaneProofKey,
  frozenLaneIds,
  reusableLaneIds,
  loadProofCacheHits,
  persistProofCacheEntries,
  workspaceMetadata,
} from './proof_lane_cache.mjs';

const toolchain = {
  platform: 'test', arch: 'test', os_release: 'test', node: 'test', npm: 'test',
  cargo: 'test', rustc: 'test', psql: 'test',
  postgres: 'test', pg_config: 'test',
};

test('proof cache metadata resolves the complete locked workspace graph', () => {
  const calls = [];
  const metadata = { packages: [], workspace_members: [] };
  assert.deepEqual(workspaceMetadata('/tmp/fmarch-cache-metadata-fixture', {
    execute(command, argv, options) {
      calls.push({ command, argv, options });
      return Buffer.from(JSON.stringify(metadata));
    },
  }), metadata);
  assert.deepEqual(calls, [{
    command: 'cargo',
    argv: ['metadata', '--locked', '--format-version', '1'],
    options: {
      cwd: '/tmp/fmarch-cache-metadata-fixture',
      maxBuffer: 64 * 1024 * 1024,
    },
  }]);
});

function lane(command, assertionTargets = []) {
  return {
    kind: 'shell',
    command,
    assertion_targets: assertionTargets,
    execution: {
      class: 'cargo', timeout_seconds: 10,
      argv: command.split(' '), resources: [],
    },
  };
}

function manifest() {
  return {
    lanes: {
      audit: lane('cargo test -p commands --test semantic_audit', ['commands/test/semantic_audit']),
      canonical: lane('cargo test -p commands --lib', ['commands/lib']),
      membership: lane('cargo test -p membership', ['membership/lib']),
      shared: lane('cargo test -p domain', ['domain/lib']),
    },
    areas: [
      { id: 'audit', tier: 'frozen', paths: ['crates/commands/'], lanes: ['audit'] },
      { id: 'commands', tier: 'frozen', paths: ['crates/commands/'], crate: 'commands', lanes: ['canonical'] },
      { id: 'membership', tier: 'active', paths: ['crates/membership/'], lanes: ['membership'] },
      { id: 'shared', tier: 'frozen', paths: ['crates/domain/'], lanes: ['shared'] },
    ],
  };
}

function metadata(root) {
  const pkg = (name, dependencies = []) => ({
    name,
    manifest_path: join(root, 'crates', name, 'Cargo.toml'),
    dependencies: dependencies.map((dependency) => ({ name: dependency, kind: null })),
  });
  return { packages: [pkg('commands', ['domain']), pkg('domain'), pkg('membership')] };
}

function fixtureRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'fmarch-proof-cache-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const files = {
    'Cargo.lock': 'lock-v1',
    'Cargo.toml': '[workspace]',
    'package.json': '{}',
    'package-lock.json': '{}',
    'frontend/package.json': '{}',
    'frontend/package-lock.json': '{}',
    'rust-toolchain.toml': 'channel = "test"',
    'tools/proof_lane_cache.mjs': 'cache-runner-v1',
    'tools/proof_lane_execution.mjs': 'execution-runner-v1',
    'tools/proof_lane_select.mjs': 'selector-v1',
    'crates/commands/Cargo.toml': '[package]\nname="commands"',
    'crates/commands/src/lib.rs': 'pub fn commands() {}',
    'crates/commands/tests/semantic_audit/cases.rs': '#[test] fn audit() {}',
    'crates/domain/Cargo.toml': '[package]\nname="domain"',
    'crates/domain/src/lib.rs': 'pub fn domain() {}',
    'crates/membership/Cargo.toml': '[package]\nname="membership"',
    'crates/membership/src/lib.rs': 'pub fn membership() {}',
    'crates/database_schema/migrations/0001.sql': 'select 1;',
  };
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return { root, files: Object.keys(files).sort() };
}

function key(root, files, overrides = {}) {
  return computeLaneProofKey('audit', manifest(), {
    root, files, metadata: metadata(root), toolchain, ...overrides,
  });
}

test('frozen eligibility requires every owning area to be frozen', () => {
  const fixture = manifest();
  fixture.areas.push({ id: 'active-audit-owner', tier: 'active', paths: ['active/'], lanes: ['audit'] });
  assert.deepEqual([...frozenLaneIds(fixture)].sort(), ['canonical', 'shared']);
});

test('specialized executable keys include transitive Cargo inputs and exclude unrelated crates', (t) => {
  const { root, files } = fixtureRoot(t);
  const original = key(root, files).proofKey;

  writeFileSync(join(root, 'crates/membership/src/lib.rs'), 'pub fn changed_membership() {}');
  assert.equal(key(root, files).proofKey, original);

  const canonical = computeLaneProofKey('canonical', manifest(), {
    root, files, metadata: metadata(root), toolchain,
  }).proofKey;
  writeFileSync(join(root, 'crates/domain/src/lib.rs'), 'pub fn changed_domain() {}');
  assert.notEqual(key(root, files).proofKey, original);
  assert.notEqual(computeLaneProofKey('canonical', manifest(), {
    root, files, metadata: metadata(root), toolchain,
  }).proofKey, canonical);
});

test('canonical proof keys exclude registry packages from full locked metadata', (t) => {
  const { root, files } = fixtureRoot(t);
  const fullMetadata = metadata(root);
  for (const pkg of fullMetadata.packages) pkg.id = `path+file://${pkg.name}#0.1.0`;
  fullMetadata.workspace_members = fullMetadata.packages.map((pkg) => pkg.id);
  fullMetadata.packages.find((pkg) => pkg.name === 'commands').dependencies.push({
    name: 'serde', kind: null,
  });
  fullMetadata.packages.push({
    id: 'registry+https://github.com/rust-lang/crates.io-index#serde@1.0.0',
    name: 'serde',
    manifest_path: '/registry/serde/Cargo.toml',
    dependencies: [],
  });

  const result = computeLaneProofKey('canonical', manifest(), {
    root, files, metadata: fullMetadata, toolchain,
  });
  assert.equal(result.payload.matchers.some((path) => path.includes('registry/serde')), false);
});

test('proof keys bind migrations, dependency locks, toolchains, commands, and fixtures', (t) => {
  const { root, files } = fixtureRoot(t);
  const original = key(root, files).proofKey;
  const mutations = [
    ['crates/database_schema/migrations/0001.sql', 'select 2;'],
    ['Cargo.lock', 'lock-v2'],
    ['crates/commands/tests/semantic_audit/cases.rs', '#[test] fn changed_fixture() {}'],
  ];
  for (const [path, content] of mutations) {
    const before = readFileSync(join(root, path));
    writeFileSync(join(root, path), content);
    assert.notEqual(key(root, files).proofKey, original, path);
    writeFileSync(join(root, path), before);
  }
  assert.notEqual(key(root, files, { toolchain: { ...toolchain, rustc: 'changed' } }).proofKey, original);
  const changedManifest = manifest();
  changedManifest.lanes.audit.execution.argv.push('--nocapture');
  assert.notEqual(computeLaneProofKey('audit', changedManifest, {
    root, files, metadata: metadata(root), toolchain,
  }).proofKey, original);
});

test('cache entries are immutable successful receipts and artifact corruption is a miss', (t) => {
  const { root, files } = fixtureRoot(t);
  const computed = key(root, files);
  const runDir = join(root, 'target/proof-lanes/runs/source');
  const artifactDir = join(runDir, 'artifacts/audit');
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(join(artifactDir, 'evidence.json'), '{"passed":true}\n');
  const receiptPath = join(runDir, 'receipt.json');
  const receipt = {
    id: 'source', state: 'passed',
    lanes: { audit: { state: 'passed', status: 0, artifact_dir: artifactDir } },
  };
  writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`);
  const execution = { run: { runDir, receiptPath }, receipt };

  assert.deepEqual(
    persistProofCacheEntries(execution, new Map([['audit', computed]]), { root }),
    ['audit'],
  );
  const options = {
    root, files, metadata: metadata(root), toolchain,
    computedKeys: new Map([['audit', computed]]),
  };
  const loaded = loadProofCacheHits(['audit'], manifest(), options);
  assert.deepEqual([...loaded.hits.keys()], ['audit']);
  assert.equal(readFileSync(join(loaded.hits.get('audit').artifact_source_dir, 'evidence.json'), 'utf8'), '{"passed":true}\n');

  writeFileSync(join(loaded.hits.get('audit').artifact_source_dir, 'evidence.json'), 'corrupt');
  const corrupt = loadProofCacheHits(['audit'], manifest(), options);
  assert.deepEqual([...corrupt.hits.keys()], []);
  assert.match(corrupt.misses.get('audit').reason, /digest/);
});


test('reuse eligibility is independent of tier but excludes changing external state', () => {
  const example = manifest();
  example.lanes.network = { execution: { class: 'network', resources: [] } };
  example.lanes.sharedDb = { execution: { class: 'postgres', resources: [{ kind: 'postgres', mode: 'shared-serial' }] } };
  example.lanes.auditCache = { cache: false, execution: { class: 'hermetic', resources: [] } };
  assert.ok(reusableLaneIds(example).has('membership'), 'active ownership must not defeat matching fingerprints');
  for (const id of ['network', 'sharedDb', 'auditCache']) assert.ok(!reusableLaneIds(example).has(id));
});

test('passing lane in a failed checkpoint can qualify a later checkpoint only with identical inputs', (t) => {
  const { root, files } = fixtureRoot(t);
  const computed = key(root, files);
  const runDir = join(root, 'target/proof-lanes/runs/failed-checkpoint');
  const artifactDir = join(runDir, 'artifacts/audit');
  mkdirSync(artifactDir, { recursive: true });
  const receiptPath = join(runDir, 'receipt.json');
  const receipt = { id: 'failed-checkpoint', state: 'failed', context: { commit: 'old' }, lanes: {
    audit: { state: 'passed', status: 0, artifact_dir: artifactDir },
    unrelated: { state: 'failed', status: 1 },
  }};
  writeFileSync(receiptPath, JSON.stringify(receipt));
  persistProofCacheEntries({ run: { runDir, receiptPath }, receipt }, new Map([['audit', computed]]), { root });
  const options = { root, files, metadata: metadata(root), toolchain };
  assert.ok(loadProofCacheHits(['audit'], manifest(), options).hits.has('audit'));
  writeFileSync(join(root, 'crates/domain/src/lib.rs'), 'changed dependency');
  assert.equal(loadProofCacheHits(['audit'], manifest(), options).hits.size, 0);
});
