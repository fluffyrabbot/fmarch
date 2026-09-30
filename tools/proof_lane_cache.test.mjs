import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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
    cache_inputs: { groups: [], paths: [] },
    execution_inputs: [],
    execution: {
      class: 'cargo', timeout_seconds: 10,
      argv: command.split(' '), resources: [],
    },
  };
}

function manifest() {
  return {
    cache_inputs: {
      version: 2,
      global: [
        ...['Cargo.lock', 'Cargo.toml', 'package.json', 'package-lock.json',
          'frontend/package.json', 'frontend/package-lock.json', 'rust-toolchain.toml',
          'scripts/with-proof-node.sh', 'tools/proof_lane_cache.mjs',
          'tools/proof_lane_execution.mjs', 'tools/proof_lane_select.mjs']
          .map((path) => ({ kind: 'file', path })),
        { kind: 'glob', path: 'crates/*/migrations/**' },
      ],
      groups: {},
    },
    execution_inputs: { version: 1, packages: {}, targets: {} },
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
    targets: [
      { name, kind: ['lib'], src_path: join(root, 'crates', name, 'src/lib.rs') },
      ...(name === 'commands' ? [{ name: 'semantic_audit', kind: ['test'], src_path: join(root, 'crates/commands/tests/semantic_audit/main.rs') }] : []),
    ],
  });
  return { packages: [pkg('commands', ['domain']), pkg('domain'), pkg('membership')] };
}

function fixtureRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'fmarch-proof-cache-'));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const files = {
    'Cargo.lock': 'lock-v1',
    'Cargo.toml': '[workspace]',
    'package.json': '{}',
    'package-lock.json': '{}',
    'frontend/package.json': '{}',
    'frontend/package-lock.json': '{}',
    'rust-toolchain.toml': 'channel = "test"',
    'scripts/with-proof-node.sh': 'runtime-selector-v1',
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

test('every Cargo lane key binds the selected proof runtime wrapper', (t) => {
  const { root, files } = fixtureRoot(t);
  const options = { root, files, metadata: metadata(root), toolchain };
  const before = Object.keys(manifest().lanes).map((id) =>
    computeLaneProofKey(id, manifest(), options).proofKey);
  writeFileSync(join(root, 'scripts/with-proof-node.sh'), 'runtime-selector-v2');
  for (const [index, id] of Object.keys(manifest().lanes).entries()) {
    assert.notEqual(computeLaneProofKey(id, manifest(), options).proofKey, before[index], id);
  }
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
  assert.equal(result.payload.matchers.some(({ path }) => path.includes('registry/serde')), false);
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
  example.lanes.hosted = { execution: { class: 'hosted', resources: [] } };
  example.lanes.networkLock = { execution: { class: 'hermetic', resources: [{ kind: 'lock', name: 'network' }] } };
  example.lanes.sharedDb = { execution: { class: 'postgres', resources: [{ kind: 'postgres', mode: 'shared-serial' }] } };
  example.lanes.auditCache = { cache: false, execution: { class: 'hermetic', resources: [] } };
  assert.ok(reusableLaneIds(example).has('membership'), 'active ownership must not defeat matching fingerprints');
  for (const id of ['hosted', 'networkLock', 'sharedDb', 'auditCache']) assert.ok(!reusableLaneIds(example).has(id));
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

function addFiles(root, files, additions) {
  for (const [path, content] of Object.entries(additions)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
    if (!files.includes(path)) files.push(path);
  }
}

test('literal route names are never interpreted as patterns, and declared globs stay patterns', (t) => {
  const { root, files } = fixtureRoot(t);
  const routes = [
    'frontend/src/routes/g/[game]/host/+page.svelte',
    'frontend/src/routes/discussions/[slug]/+page.svelte',
    'frontend/src/routes/assets/[...path]/+server.js',
  ];
  const accidentalMatch = 'frontend/src/routes/g/g/host/+page.svelte';
  addFiles(root, files, Object.fromEntries([...routes, accidentalMatch].map((path) => [path, 'original'])));
  const spec = manifest();
  spec.lanes.audit.execution_inputs = routes.map((path) => ({ kind: 'file', path }));
  const compute = () => computeLaneProofKey('audit', spec, { root, files, metadata: metadata(root), toolchain });
  const original = compute();
  for (const path of routes) {
    assert.ok(original.payload.inputs.some((input) => input.path === path), path);
    writeFileSync(join(root, path), 'changed');
    assert.notEqual(compute().proofKey, original.proofKey, path);
    writeFileSync(join(root, path), 'original');
  }
  assert.ok(!original.payload.inputs.some((input) => input.path === accidentalMatch));
  writeFileSync(join(root, accidentalMatch), 'unrelated');
  assert.equal(compute().proofKey, original.proofKey);

  spec.lanes.audit.execution_inputs = [{ kind: 'prefix', path: 'frontend/src/routes/g/[game]/' }];
  assert.ok(compute().payload.inputs.some((input) => input.path === routes[0]));
  assert.ok(!compute().payload.inputs.some((input) => input.path === accidentalMatch));

  spec.lanes.audit.execution_inputs = [{ kind: 'glob', path: 'frontend/src/routes/**/+page.svelte' }];
  for (const path of [routes[0], routes[1], accidentalMatch]) {
    assert.ok(compute().payload.inputs.some((input) => input.path === path), path);
  }
  assert.ok(!compute().payload.inputs.some((input) => input.path === routes[2]));
});

test('declared route scopes bind additions and deletions independently of file enumeration order', (t) => {
  const { root, files } = fixtureRoot(t);
  const spec = manifest();
  spec.lanes.audit.execution_inputs = [{ kind: 'prefix', path: 'frontend/src/routes/' }];
  const compute = () => computeLaneProofKey('audit', spec, { root, files, metadata: metadata(root), toolchain });
  const empty = compute().proofKey;
  const path = 'frontend/src/routes/g/[game]/+page.svelte';
  addFiles(root, files, { [path]: 'route' });
  const added = compute();
  assert.notEqual(added.proofKey, empty);
  files.reverse();
  assert.equal(compute().proofKey, added.proofKey);
  rmSync(join(root, path));
  assert.equal(compute().proofKey, empty);
});

test('hard dependency lanes and transitive package fixture declarations enter the consumer key', (t) => {
  const { root, files } = fixtureRoot(t);
  addFiles(root, files, { 'fixtures/domain.json': 'domain', 'tools/preparation.mjs': 'prep' });
  const spec = manifest();
  spec.execution_inputs.packages.domain = [{ kind: 'file', path: 'fixtures/domain.json' }];
  spec.lanes.shared.execution_inputs = [{ kind: 'file', path: 'tools/preparation.mjs' }];
  spec.lanes.audit.depends_on = ['shared'];
  const compute = () => computeLaneProofKey('audit', spec, { root, files, metadata: metadata(root), toolchain });
  const original = compute().proofKey;
  for (const path of ['fixtures/domain.json', 'tools/preparation.mjs']) {
    const before = readFileSync(join(root, path));
    writeFileSync(join(root, path), 'mutated');
    assert.notEqual(compute().proofKey, original, path);
    writeFileSync(join(root, path), before);
  }
});

test('key computation rejects misspelled supplemental packages and binds runner policy', (t) => {
  const { root, files } = fixtureRoot(t);
  const spec = manifest();
  spec.execution_inputs.packages.domian = [{ kind: 'file', path: 'package.json' }];
  const compute = () => computeLaneProofKey('audit', spec, { root, files, metadata: metadata(root), toolchain });
  assert.throws(compute, /unknown package domian/);
  delete spec.execution_inputs.packages.domian;
  spec.runner = { max_parallel: 1 };
  const before = compute().proofKey;
  spec.runner.max_parallel = 2;
  assert.notEqual(compute().proofKey, before);
});

const repositoryManifest = JSON.parse(readFileSync(new URL('../docs/ops/proof-lane-manifest.json', import.meta.url), 'utf8'));

test('live advisory audit always executes even when repository and toolchain inputs are unchanged', () => {
  assert.equal(repositoryManifest.lanes['test:dependency-policy:audit'].execution.class, 'hosted');
  assert.ok(repositoryManifest.lanes['test:dependency-policy:audit'].execution.resources.some(
    (resource) => resource.kind === 'lock' && resource.name === 'network'));
  assert.ok(!reusableLaneIds(repositoryManifest).has('test:dependency-policy:audit'));
});

test('live local posture, dated policy and maintenance checks always execute', () => {
  const reusable = reusableLaneIds(repositoryManifest);
  for (const laneId of ['test:dependency-policy:offline', 'check:build-posture',
    'test:proof-lane-contract', 'test:proof-cache-maintenance']) {
    assert.equal(repositoryManifest.lanes[laneId].cache, false, laneId);
    assert.ok(!reusable.has(laneId), laneId);
  }
});

function repositoryFixture(t) {
  const fixture = fixtureRoot(t);
  addFiles(fixture.root, fixture.files, {
    'frontend/src/routes/g/[game]/host/+page.svelte': 'host-page',
    'frontend/src/routes/discussions/[slug]/+page.svelte': 'discussion-page',
    'tools/live_stack/host_invite_retry_scenario.mjs': 'browser-helper',
    'tools/cargo_test_evidence.mjs': 'cargo-evidence-wrapper',
    'tools/fixtures/im_human_v4/day_vote_resolution.fmarch.json': 'day-vote-fixture',
    'docs/ops/proof-runs.json': 'proof-runs',
    'docs/arch/09-engine-and-packs.md': 'engine-contract',
    'packs/example/pack.json': 'pack',
    'programs/example.program.json': 'program',
    'crates/commands/tests/pipeline/day_events.rs': 'imported-proof-source',
    'crates/forum_postgres/src/lib.rs': 'postgres-source',
    'crates/event_actor/src/lib.rs': 'event-actor',
    'crates/eventstore/src/lib.rs': 'eventstore',
    'crates/operator_proof/src/lib.rs': 'operator-proof',
    'crates/operator_api/src/lib.rs': 'operator-api',
    'crates/identity/src/lib.rs': 'identity',
    'crates/projections/src/lib.rs': 'projections',
  });
  // Synthetic metadata covers the full declared target inventory. Exact target
  // existence against locked Cargo metadata is checked by the manifest suite.
  const workspace = readFileSync(new URL('../Cargo.toml', import.meta.url), 'utf8');
  const names = [...new Set(['membership', ...[...workspace.matchAll(/"crates\/([^"/]+)"/g)].map(match => match[1])])];
  const targets = new Set([
    ...Object.values(repositoryManifest.lanes).flatMap(lane => lane.assertion_targets ?? []),
    ...Object.keys(repositoryManifest.execution_inputs.targets),
  ]);
  for (const lane of Object.values(repositoryManifest.lanes)) {
    const argv = lane.execution.argv;
    const pkg = argv.indexOf('-p');
    const bin = argv.indexOf('--bin');
    if (pkg !== -1 && bin !== -1) targets.add(`${argv[pkg + 1]}/bin/${argv[bin + 1]}`);
  }
  fixture.metadata = { packages: names.map((name) => ({
    name,
    manifest_path: join(fixture.root, 'crates', name, 'Cargo.toml'),
    dependencies: name === 'operator_api' ? [{ name: 'operator_proof' }] : [],
    targets: [...new Set([`${name}/lib`, ...[...targets].filter(id => id.startsWith(`${name}/`))])].map(id => {
      const [, kind, targetName] = id.split('/');
      return { name: targetName ?? name, kind: [kind], src_path: join(fixture.root, 'crates', name,
        kind === 'lib' ? 'src/lib.rs' : kind === 'test' ? `tests/${targetName}.rs` : `src/bin/${targetName}.rs`) };
    }),
  })) };
  fixture.compute = (laneId) => computeLaneProofKey(laneId, repositoryManifest, {
    root: fixture.root, files: fixture.files, metadata: fixture.metadata, toolchain,
  });
  return fixture;
}

test('both production host browser lane keys include and react to the literal host route', (t) => {
  const { root, compute } = repositoryFixture(t);
  const path = 'frontend/src/routes/g/[game]/host/+page.svelte';
  const ids = ['test:host-console-live-stack-smoke', 'test:host-console-day-event-room-live-stack'];
  const before = ids.map(compute);
  for (const result of before) assert.ok(result.payload.inputs.some((input) => input.path === path));
  writeFileSync(join(root, path), 'only the host route changed');
  for (const [index, id] of ids.entries()) assert.notEqual(compute(id).proofKey, before[index].proofKey, id);
});

test('production pure Rust keys exclude unrelated UI tools but bind source, locks, runtime and toolchain', (t) => {
  const { root, files, metadata: packageMetadata, compute } = repositoryFixture(t);
  const laneId = 'cargo:event-actor';
  const before = compute(laneId);
  for (const path of ['frontend/src/routes/g/[game]/host/+page.svelte', 'tools/live_stack/host_invite_retry_scenario.mjs']) {
    assert.ok(!before.payload.inputs.some((input) => input.path === path), path);
    writeFileSync(join(root, path), 'unrelated change');
    assert.equal(compute(laneId).proofKey, before.proofKey, path);
  }
  for (const path of ['crates/event_actor/src/lib.rs', 'Cargo.lock', 'rust-toolchain.toml',
    'scripts/with-proof-node.sh', 'tools/proof_lane_execution.mjs', 'crates/database_schema/migrations/0001.sql']) {
    const bytes = readFileSync(join(root, path));
    writeFileSync(join(root, path), 'relevant change');
    assert.notEqual(compute(laneId).proofKey, before.proofKey, path);
    writeFileSync(join(root, path), bytes);
  }
  assert.notEqual(computeLaneProofKey(laneId, repositoryManifest, {
    root, files, metadata: packageMetadata, toolchain: { ...toolchain, rustc: 'new compiler' },
  }).proofKey, before.proofKey);
});

test('production runtime reads and cross-crate imported proof sources remain cache dependencies', (t) => {
  const { root, compute } = repositoryFixture(t);
  const cases = [
    ['cargo:domain', 'tools/fixtures/im_human_v4/day_vote_resolution.fmarch.json'],
    ['cargo:operator-proof', 'docs/ops/proof-runs.json'],
    ['cargo:operator_api', 'docs/arch/09-engine-and-packs.md'],
    ['cargo:operator_api', 'crates/commands/tests/pipeline/day_events.rs'],
    ['test:event-body-authority', 'crates/membership/src/lib.rs'],
    ['cargo:identity', 'crates/membership/Cargo.toml'],
    ['cargo:projections', 'crates/forum_postgres/src/lib.rs'],
    ['cargo:forum-postgres', 'tools/cargo_test_evidence.mjs'],
    ['cargo:commands-pg', 'packs/example/pack.json'],
    ['cargo:commands-pg', 'programs/example.program.json'],
  ];
  for (const [laneId, path] of cases) {
    const before = compute(laneId);
    assert.ok(before.payload.inputs.some((input) => input.path === path), `${laneId}: ${path}`);
    const bytes = readFileSync(join(root, path));
    writeFileSync(join(root, path), 'runtime dependency changed');
    assert.notEqual(compute(laneId).proofKey, before.proofKey, `${laneId}: ${path}`);
    writeFileSync(join(root, path), bytes);
  }
});

test('target-only fixtures and integration helpers do not invalidate package consumers or runtime proof', (t) => {
  const { root, files } = fixtureRoot(t);
  addFiles(root, files, { 'fixtures/audit.json': 'audit-fixture', 'docs/commands-tests.md': 'unit-test-document' });
  const spec = manifest();
  spec.execution_inputs.targets = {
    'commands/test/semantic_audit': [{ kind: 'file', path: 'fixtures/audit.json' }],
    'commands/lib': [{ kind: 'file', path: 'docs/commands-tests.md' }],
  };
  spec.lanes.runtime = {
    kind: 'shell', command: 'node runtime.mjs', cache_inputs: { groups: [], paths: [] }, execution_inputs: [],
    execution: { class: 'browser', argv: ['node', 'runtime.mjs'], resources: [] },
  };
  const packages = metadata(root);
  packages.packages.find(pkg => pkg.name === 'membership').dependencies.push({ name: 'commands', kind: null });
  const compute = id => computeLaneProofKey(id, spec, { root, files, metadata: packages, toolchain });
  const ids = ['audit', 'canonical', 'membership', 'runtime'];
  const before = new Map(ids.map(id => [id, compute(id)]));
  assert.equal(before.get('audit').payload.schema, 3);
  for (const path of ['fixtures/audit.json', 'crates/commands/tests/semantic_audit/cases.rs']) {
    assert.ok(before.get('audit').payload.inputs.some(input => input.path === path));
    const original = readFileSync(join(root, path));
    writeFileSync(join(root, path), 'changed test-only input');
    assert.notEqual(compute('audit').proofKey, before.get('audit').proofKey);
    for (const id of ['canonical', 'membership', 'runtime']) {
      assert.ok(!before.get(id).payload.inputs.some(input => input.path === path), `${id}: ${path}`);
      assert.equal(compute(id).proofKey, before.get(id).proofKey, `${id}: ${path}`);
    }
    writeFileSync(join(root, path), original);
  }
  writeFileSync(join(root, 'docs/commands-tests.md'), 'changed unit-harness document');
  assert.notEqual(compute('canonical').proofKey, before.get('canonical').proofKey);
  for (const id of ['audit', 'membership', 'runtime']) assert.equal(compute(id).proofKey, before.get(id).proofKey);
});

test('package-build inputs invalidate transitive and runtime consumers while unrelated lanes stay reusable', (t) => {
  const { root, files } = fixtureRoot(t);
  addFiles(root, files, { 'fixtures/compiled-catalog.json': 'catalog-v1' });
  const spec = manifest();
  spec.execution_inputs.packages.commands = [{ kind: 'file', path: 'fixtures/compiled-catalog.json' }];
  spec.lanes.runtime = {
    kind: 'shell', command: 'node runtime.mjs', cache_inputs: { groups: [], paths: [] }, execution_inputs: [],
    execution: { class: 'browser', argv: ['node', 'runtime.mjs'], resources: [] },
  };
  const packages = metadata(root);
  packages.packages.find(pkg => pkg.name === 'membership').dependencies.push({ name: 'commands', kind: 'dev' });
  const compute = id => computeLaneProofKey(id, spec, { root, files, metadata: packages, toolchain });
  const ids = ['audit', 'canonical', 'membership', 'runtime', 'shared'];
  const before = new Map(ids.map(id => [id, compute(id).proofKey]));
  writeFileSync(join(root, 'fixtures/compiled-catalog.json'), 'catalog-v2');
  for (const id of ['audit', 'canonical', 'membership', 'runtime']) assert.notEqual(compute(id).proofKey, before.get(id), id);
  assert.equal(compute('shared').proofKey, before.get('shared'));
});

test('proof key calculation rejects selected source symlinks even with a cached fingerprint', (t) => {
  const { root, files } = fixtureRoot(t);
  const fingerprints = new Map();
  const options = { root, files, metadata: metadata(root), toolchain, fingerprints };
  computeLaneProofKey('audit', manifest(), options);
  const path = 'crates/domain/src/lib.rs';
  assert.ok(fingerprints.has(path));
  rmSync(join(root, path));
  symlinkSync(join(root, 'crates/membership/src/lib.rs'), join(root, path));
  assert.throws(() => computeLaneProofKey('audit', manifest(), options), error =>
    error.code === 'UNSAFE_PROOF_INPUT' && error.message.includes(path));
});

test('proof keys reject fixture symlinks, dangling links and hidden directory-link descendants', (t) => {
  for (const scenario of ['file', 'dangling-file', 'directory', 'dangling-directory']) {
    const { root, files } = fixtureRoot(t);
    const spec = manifest();
    const directory = scenario.includes('directory');
    const link = directory ? 'fixtures/current' : 'fixtures/current.json';
    const destination = join(root, scenario.startsWith('dangling') ? 'missing' : directory ? 'crates/domain/src' : 'crates/domain/src/lib.rs');
    mkdirSync(join(root, 'fixtures'), { recursive: true });
    symlinkSync(destination, join(root, link));
    // Git inventories a directory symlink itself, not the files it conceals.
    files.push(link);
    spec.lanes.audit.execution_inputs = [{ kind: directory ? 'glob' : 'file', path: directory ? 'fixtures/*/*.rs' : link }];
    assert.throws(() => computeLaneProofKey('audit', spec, { root, files, metadata: metadata(root), toolchain }), error =>
      error.code === 'UNSAFE_PROOF_INPUT' && error.message.includes(link), scenario);
  }
});

test('unselected source links do not enlarge the proof contract', (t) => {
  const { root, files } = fixtureRoot(t);
  const before = key(root, files).proofKey;
  mkdirSync(join(root, 'unrelated'), { recursive: true });
  symlinkSync(join(root, 'missing'), join(root, 'unrelated/dangling'));
  files.push('unrelated/dangling');
  assert.equal(key(root, files).proofKey, before);
});


test('ignored selected fixtures cannot disappear from source enumeration and qualify a key', (t) => {
  const { root } = fixtureRoot(t);
  mkdirSync(join(root, 'fixtures'), { recursive: true });
  writeFileSync(join(root, '.gitignore'), 'fixtures/*.json\n');
  writeFileSync(join(root, 'fixtures/runtime.json'), 'unfingerprinted runtime fixture');
  const spec = manifest();
  spec.execution_inputs.packages.commands = [{ kind: 'file', path: 'fixtures/runtime.json' }];
  assert.throws(() => computeLaneProofKey('audit', spec, { root, metadata: metadata(root), toolchain }), error =>
    error.code === 'UNSAFE_PROOF_INPUT' && /ignored source or fixture/.test(error.message));
});
