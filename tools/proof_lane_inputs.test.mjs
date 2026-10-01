import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  declaredLaneCacheInputs, executionInputMatches, resolveLaneCargoInputs,
  resolveLaneExecutionInputs, validateCacheInputContract,
} from './proof_lane_inputs.mjs';

const file = (path) => ({ kind: 'file', path });
const prefix = (path) => ({ kind: 'prefix', path });
const glob = (path) => ({ kind: 'glob', path });
const root = '/workspace';
const manifest = JSON.parse(readFileSync(new URL('../docs/ops/proof-lane-manifest.json', import.meta.url), 'utf8'));
const packageTarget = (name, kind, targetName = name) => ({
  name: targetName, kind: [kind], src_path: `${root}/crates/${name}/${kind === 'test' ? `tests/${targetName}.rs` : kind === 'bin' ? `src/bin/${targetName}.rs` : 'src/lib.rs'}`,
});
const metadata = () => ({
  workspace_members: ['codec', 'consumer', 'helper', 'unrelated'],
  packages: [
    { name: 'codec', id: 'codec', manifest_path: `${root}/crates/codec/Cargo.toml`, dependencies: [], targets: [packageTarget('codec', 'rlib'), packageTarget('codec', 'test', 'contract'), packageTarget('codec', 'bin', 'export')] },
    { name: 'consumer', id: 'consumer', manifest_path: `${root}/crates/consumer/Cargo.toml`, dependencies: [{ name: 'codec', kind: null }, { name: 'helper', kind: 'dev' }], targets: [packageTarget('consumer', 'lib'), packageTarget('consumer', 'bin', 'serve')] },
    { name: 'helper', id: 'helper', manifest_path: `${root}/crates/helper/Cargo.toml`, dependencies: [], targets: [packageTarget('helper', 'proc-macro')] },
    { name: 'unrelated', id: 'unrelated', manifest_path: `${root}/crates/unrelated/Cargo.toml`, dependencies: [], targets: [packageTarget('unrelated', 'lib')] },
    { name: 'external', id: 'external', manifest_path: '/elsewhere/external/Cargo.toml', dependencies: [], targets: [packageTarget('external', 'lib')] },
  ],
});
const lane = (argv, targets = []) => ({
  cache_inputs: { groups: [], paths: [] }, execution_inputs: [], assertion_targets: targets,
  execution: { class: 'cargo', argv },
});
const fixture = () => ({
  cache_inputs: { version: 2, global: [file('Cargo.lock')], groups: { browser: [prefix('frontend/')] } },
  execution_inputs: {
    version: 1,
    packages: { codec: [file('fixtures/runtime.json')], helper: [file('fixtures/build.json')] },
    targets: { 'codec/test/contract': [file('fixtures/contract.json')], 'codec/lib': [file('docs/codec.md')], 'codec/bin/export': [file('fixtures/export.json')] },
  },
  areas: [],
  lanes: {
    codec: lane(['cargo', 'test', '-p', 'codec', '--lib', '--test', 'contract'], ['codec/lib', 'codec/test/contract']),
    consumer: lane(['cargo', 'test', '-p', 'consumer', '--lib'], ['consumer/lib']),
    unrelated: lane(['cargo', 'test', '-p', 'unrelated', '--lib'], ['unrelated/lib']),
    browser: { ...lane(['node', 'browser.mjs']), cargo_inputs: { builds: [] }, execution: { class: 'browser', argv: ['node', 'browser.mjs'] }, cache_inputs: { groups: ['browser'], paths: [] } },
    live: { ...lane(['node', 'live.mjs']), cargo_inputs: { builds: [{ target: 'consumer/bin/serve', profile: 'dev' }] } },
    clippy: lane(['cargo', 'clippy', '--workspace', '--all-targets', '--all-features', '--', '-D', 'warnings']),
    export: lane(['cargo', 'run', '-p', 'codec', '--bin', 'export', '--', '--check']),
  },
});
const edges = (ids, value = fixture(), details = metadata()) => resolveLaneExecutionInputs(ids, value, details, { root });
const paths = (values) => values.map((edge) => edge.selector.path);

test('cache context remains separate from execution triggers', () => {
  const value = fixture();
  value.lanes.browser.cache_inputs.paths.push(file('environment.json'));
  value.lanes.browser.execution_inputs.push(file('browser.mjs'));
  assert.deepEqual(declaredLaneCacheInputs(['browser'], value), [file('Cargo.lock'), file('environment.json'), prefix('frontend/')]);
  const direct = edges(['browser'], value);
  assert.ok(direct.some((edge) => edge.scope === 'lane' && edge.owner === 'browser' && edge.selector.path === 'browser.mjs'));
  for (const context of ['Cargo.lock', 'environment.json', 'frontend/']) assert.ok(!paths(direct).includes(context));
});

test('target fixtures arm only direct targets while package fixtures propagate', () => {
  const own = edges(['codec']);
  assert.ok(paths(own).includes('fixtures/contract.json'));
  assert.ok(paths(own).includes('docs/codec.md'));
  assert.ok(paths(own).includes('fixtures/runtime.json'));
  const downstream = edges(['consumer']);
  assert.deepEqual(paths(downstream).sort(), ['fixtures/build.json', 'fixtures/runtime.json']);
  assert.deepEqual(edges(['unrelated']), []);
});

test('direct test roots retain dev and build dependency execution inputs', () => {
  for (const kind of ['dev', 'build', null]) {
    const details = metadata();
    details.packages.find((pkg) => pkg.name === 'consumer').dependencies = [{ name: 'helper', kind }];
    assert.ok(paths(edges(['consumer'], fixture(), details)).includes('fixtures/build.json'));
  }
});

test('direct integration suites retain helpers but downstream and browser keys omit test trees', () => {
  const own = resolveLaneCargoInputs(['codec'], fixture(), metadata(), { root });
  const consumer = resolveLaneCargoInputs(['consumer'], fixture(), metadata(), { root });
  const browser = resolveLaneCargoInputs(['browser'], fixture(), metadata(), { root });
  const matches = (resolution, path) => resolution.selectors.some((selector) => executionInputMatches(path, selector));
  assert.ok(matches(own, 'crates/codec/tests/shared/support.rs'));
  assert.ok(!matches(consumer, 'crates/codec/tests/contract.rs'));
  assert.ok(!matches(browser, 'crates/codec/tests/contract.rs'));
  assert.ok(matches(consumer, 'crates/codec/src/nested.rs'));
  assert.ok(matches(consumer, 'crates/codec/Cargo.toml'));
  assert.ok(matches(consumer, 'crates/codec/build.rs'));
  assert.ok(!browser.packages.some(({ name }) => name === 'external'));
});

test('all-target compilation and cargo run targets retain their direct inputs', () => {
  const clippy = edges(['clippy']);
  for (const path of ['docs/codec.md', 'fixtures/contract.json', 'fixtures/export.json']) assert.ok(paths(clippy).includes(path));
  const exported = edges(['export']);
  assert.ok(paths(exported).includes('fixtures/export.json'));
  assert.ok(!paths(exported).includes('docs/codec.md'));
  assert.ok(!paths(exported).includes('fixtures/contract.json'));
  const value = fixture();
  value.lanes.export.execution.argv.unshift('node', 'wrapper.mjs', '--');
  assert.deepEqual(edges(['export'], value), exported);
});

test('default build and run binaries propagate embedded inputs without unit-test documents', () => {
  const value = fixture();
  value.lanes.build = lane(['cargo', 'build', '-p', 'codec']);
  value.lanes.run = lane(['cargo', 'run', '-p', 'codec']);
  value.lanes.library = lane(['cargo', 'check', '-p', 'codec', '--lib']);
  value.lanes.harness = { ...lane(['npm', 'run', 'integration-harness']), cargo_inputs: { builds: [{ target: 'codec/bin/export', profile: 'release' }] }, execution: { class: 'postgres', argv: ['npm', 'run', 'integration-harness'] } };
  for (const id of ['build', 'run', 'harness']) {
    const resolved = paths(edges([id], value));
    assert.ok(resolved.includes('fixtures/export.json'), `${id} must include binary inputs`);
    assert.ok(!resolved.includes('docs/codec.md'), `${id} must not include unit-test documents`);
    assert.ok(!resolved.includes('fixtures/contract.json'), `${id} must not include integration fixtures`);
  }
  assert.deepEqual(edges(['browser'], value), []);
  assert.ok(!paths(edges(['library'], value)).includes('fixtures/export.json'));
  const details = metadata();
  details.packages[0].targets.push(packageTarget('codec', 'bin', 'another'));
  assert.throws(() => edges(['run'], value, details), /ambiguous default binary/);
  details.packages[0].default_run = 'export';
  assert.ok(paths(edges(['run'], value, details)).includes('fixtures/export.json'));
});


test('explicit empty builds and hermetic lanes never inherit behavioral crate ownership', () => {
  const value = fixture();
  value.lanes.hermetic = { ...lane(['node', 'contract.mjs']), execution: { class: 'hermetic', argv: ['node', 'contract.mjs'] } };
  value.areas.push({ id: 'codec', crate: 'codec', lanes: ['browser', 'hermetic', 'live'] });
  for (const id of ['browser', 'hermetic']) {
    assert.deepEqual(resolveLaneCargoInputs([id], value, metadata(), { root }), { packages: [], targets: [], selectors: [], builds: [] });
    assert.deepEqual(edges([id], value), []);
  }
  const runtime = resolveLaneCargoInputs(['live'], value, metadata(), { root });
  assert.deepEqual(runtime.packages.map(({ name }) => name), ['codec', 'consumer']);
  assert.deepEqual(runtime.targets, ['consumer/bin/serve']);
  assert.deepEqual(runtime.builds, [{ target: 'consumer/bin/serve', profile: 'dev' }]);
  assert.ok(!paths(edges(['live'], value)).includes('fixtures/export.json'));
});

test('runtime builds exclude dev dependencies and tests exclude transitive dev dependencies', () => {
  const details = metadata();
  details.packages.find((pkg) => pkg.name === 'codec').dependencies = [{ name: 'unrelated', kind: 'dev' }];
  details.packages.find((pkg) => pkg.name === 'helper').dependencies = [{ name: 'unrelated', kind: 'dev' }];
  const names = (ids) => resolveLaneCargoInputs(ids, fixture(), details, { root }).packages.map(({ name }) => name);
  assert.deepEqual(names(['live']), ['codec', 'consumer']);
  assert.deepEqual(names(['consumer']), ['codec', 'consumer', 'helper']);
  // Directly testing codec independently arms codec's own dev dependency.
  assert.deepEqual(names(['consumer', 'codec']), ['codec', 'consumer', 'helper', 'unrelated']);
  assert.deepEqual(names(['clippy']), ['codec', 'consumer', 'helper', 'unrelated']);
  for (const kind of [null, 'build']) {
    details.packages.find((pkg) => pkg.name === 'codec').dependencies = [{ name: 'helper', kind }];
    assert.deepEqual(names(['live']), ['codec', 'consumer', 'helper']);
  }
});

test('explicit binary builds select only their own supplements and retain profile identity', () => {
  const value = fixture();
  value.lanes.release = { ...lane(['node', 'release.mjs']), cargo_inputs: { builds: [{ target: 'codec/bin/export', profile: 'release' }] } };
  value.lanes.debug = { ...lane(['node', 'debug.mjs']), cargo_inputs: { builds: [{ target: 'codec/bin/export', profile: 'dev' }] } };
  const resolved = resolveLaneCargoInputs(['release', 'debug', 'release'], value, metadata(), { root });
  assert.deepEqual(resolved.targets, ['codec/bin/export']);
  assert.deepEqual(resolved.builds, [{ target: 'codec/bin/export', profile: 'dev' }, { target: 'codec/bin/export', profile: 'release' }]);
  assert.deepEqual(paths(edges(['release'], value)).sort(), ['fixtures/export.json', 'fixtures/runtime.json']);
});

test('direct cargo commands infer test targets independently of behavioral areas and assertion metadata', () => {
  const value = fixture();
  value.lanes.direct = lane(['cargo', 'test', '-p', 'codec', '--test', 'contract']);
  value.lanes.default = lane(['cargo', 'test', '-p', 'codec']);
  value.lanes.check = lane(['cargo', 'check', '-p', 'consumer', '--all-targets']);
  value.areas.push({ crate: 'unrelated', lanes: ['direct', 'default', 'check'] });
  const direct = resolveLaneCargoInputs(['direct'], value, metadata(), { root });
  assert.deepEqual(direct.targets, ['codec/bin/export', 'codec/test/contract']);
  assert.deepEqual(direct.packages.map(({ name }) => name), ['codec']);
  assert.deepEqual(resolveLaneCargoInputs(['default'], value, metadata(), { root }).targets, ['codec/bin/export', 'codec/lib', 'codec/test/contract']);
  assert.ok(paths(edges(['check'], value)).includes('fixtures/build.json'));
});

test('check and clippy test or bench harnesses include root dev dependencies for lib-only crates', () => {
  const details = metadata();
  details.packages.find((pkg) => pkg.name === 'consumer').targets = [packageTarget('consumer', 'lib')];
  for (const command of ['check', 'clippy']) {
    for (const flag of ['--tests', '--benches', '--all-targets']) {
      const value = fixture();
      delete value.lanes.live;
      value.lanes.check = lane(['cargo', command, '-p', 'consumer', flag]);
      const resolved = resolveLaneCargoInputs(['check'], value, details, { root });
      assert.deepEqual(resolved.packages.map(({ name }) => name), ['codec', 'consumer', 'helper'], `${command} ${flag}`);
      assert.deepEqual(resolved.targets, ['consumer/lib']);
    }
    const library = fixture();
    delete library.lanes.live;
    library.lanes.check = lane(['cargo', command, '-p', 'consumer', '--lib']);
    assert.deepEqual(resolveLaneCargoInputs(['check'], library, details, { root }).packages.map(({ name }) => name), ['codec', 'consumer']);
  }
});

test('Cargo equals and attached package arguments retain target fixtures and dev dependency mode', () => {
  const value = fixture();
  for (const packageArg of ['--package=codec', '-pcodec', '-p=codec']) {
    value.lanes.check = lane(['cargo', 'check', packageArg, '--test=contract']);
    const resolved = resolveLaneCargoInputs(['check'], value, metadata(), { root });
    assert.deepEqual(resolved.packages.map(({ name }) => name), ['codec']);
    assert.deepEqual(resolved.targets, ['codec/bin/export', 'codec/test/contract']);
    assert.ok(paths(edges(['check'], value)).includes('fixtures/contract.json'));
  }
  value.lanes.export.execution.argv = ['cargo', 'run', '-pcodec', '--bin=export', '--profile=release'];
  assert.deepEqual(edges(['export'], value), edges(['export']));
  value.lanes.export.execution.argv = ['cargo', 'run', '-pcodec', '--bin=missing'];
  assert.throws(() => edges(['export'], value), /unknown or ambiguous bin target missing/);
  value.lanes.check = lane(['cargo', 'check', '--package=consumer', '--test=missing']);
  assert.throws(() => edges(['check'], value), /unknown or ambiguous test target missing/);
});

test('opaque Cargo scopes reject missing, malformed and contradictory build declarations', () => {
  for (const executionClass of ['browser', 'cargo', 'postgres']) {
    const value = fixture();
    delete value.lanes.browser.cargo_inputs;
    value.lanes.browser.execution.class = executionClass;
    assert.throws(() => validateCacheInputContract(value), /requires explicit cargo_inputs builds/);
  }
  const valid = { target: 'codec/bin/export', profile: 'dev' };
  for (const cargoInputs of [
    null, [], {}, { builds: null }, { builds: [], optional: true },
    { builds: [null] }, { builds: [{ target: 'codec/bin/export' }] },
    { builds: [{ ...valid, profile: 'test' }] }, { builds: [{ ...valid, optional: true }] },
    { builds: [{ ...valid, target: 'codec/lib' }] }, { builds: [{ ...valid, target: 'codec/test/contract' }] },
    { builds: [{ ...valid, target: 'codec/bin/missing' }] }, { builds: [{ ...valid, target: 'absent/bin/export' }] },
    { builds: [valid, valid] }, { builds: [valid, { ...valid, profile: 'release' }] },
  ]) {
    const value = fixture();
    value.lanes.browser.cargo_inputs = cargoInputs;
    assert.throws(() => validateCacheInputContract(value, { metadata: metadata() }), JSON.stringify(cargoInputs));
  }
  const direct = fixture();
  direct.lanes.codec.cargo_inputs = { builds: [] };
  assert.throws(() => validateCacheInputContract(direct), /direct Cargo command/);
  const assertions = fixture();
  assertions.lanes.browser.assertion_targets = ['codec/lib'];
  assert.throws(() => validateCacheInputContract(assertions), /combine cargo_inputs with assertion targets/);
});

test('cache inputs and execution edges deduplicate while preserving ownership provenance', () => {
  const value = fixture();
  value.lanes.codec.execution_inputs.push(file('fixtures/runtime.json'));
  assert.deepEqual(declaredLaneCacheInputs(['browser', 'browser'], value), [file('Cargo.lock'), prefix('frontend/')]);
  const repeated = edges(['codec', 'codec'], value);
  assert.deepEqual(repeated, edges(['codec'], value));
  assert.equal(repeated.filter((edge) => edge.selector.path === 'fixtures/runtime.json').length, 2);
  assert.deepEqual(new Set(repeated.filter((edge) => edge.selector.path === 'fixtures/runtime.json').map((edge) => edge.scope)), new Set(['package', 'lane']));
});

test('typed selectors preserve literal route brackets and match absent additions, deletions and rename origins', () => {
  const literal = file('frontend/src/routes/[game]/+page.svelte');
  assert.ok(executionInputMatches(literal.path, literal));
  assert.ok(!executionInputMatches('frontend/src/routes/g/+page.svelte', literal));
  const collection = glob('fixtures/*.json');
  for (const absentPath of ['fixtures/new.json', 'fixtures/deleted.json', 'fixtures/old-name.json', 'fixtures/new-name.json']) {
    assert.ok(executionInputMatches(absentPath, collection));
  }
  assert.ok(!executionInputMatches('unrelated/old-name.json', collection));
});

test('missing contracts, metadata and undeclared lanes fail closed', () => {
  assert.throws(() => validateCacheInputContract({ lanes: {} }), /input contract must be an object/);
  const value = fixture();
  delete value.lanes.codec.execution_inputs;
  assert.throws(() => validateCacheInputContract(value), /codec execution inputs must be a selector array/);
  assert.throws(() => edges(['missing']), /unknown proof lane missing/);
  assert.throws(() => resolveLaneCargoInputs(['codec'], fixture(), undefined, { root }), /complete workspace Cargo metadata/);
  assert.throws(() => resolveLaneCargoInputs(['codec'], fixture(), metadata()), /repository root/);
});

test('unknown groups, package names and Cargo target identities are rejected', () => {
  const unknownGroup = fixture();
  unknownGroup.lanes.codec.cache_inputs.groups.push('misspelled');
  assert.throws(() => validateCacheInputContract(unknownGroup), /unknown group/);
  assert.throws(() => validateCacheInputContract(fixture(), { packageNames: ['other'] }), /unknown package codec/);
  const unknownTarget = fixture();
  unknownTarget.execution_inputs.targets['codec/test/missing'] = [file('x')];
  assert.throws(() => validateCacheInputContract(unknownTarget, { metadata: metadata() }), /unknown target codec\/test\/missing/);
  const badLane = fixture();
  badLane.lanes.codec.assertion_targets.push('codec/test/missing');
  assert.throws(() => edges(['consumer'], badLane), /unknown target codec\/test\/missing/);
  const badPackage = fixture();
  badPackage.lanes.codec.execution.argv = ['cargo', 'test', '-p', 'missing'];
  assert.throws(() => edges(['codec'], badPackage), /unknown package missing/);
  const badRun = fixture();
  badRun.lanes.export.execution.argv = ['cargo', 'run', '-p', 'codec', '--bin', 'missing'];
  assert.throws(() => edges(['export'], badRun), /unknown or ambiguous bin target missing/);
  assert.equal(validateCacheInputContract(fixture(), { metadata: metadata() }), true);
});

test('malformed selectors, escaping paths, old package contracts and unknown fields are rejected', () => {
  for (const selector of [
    file('../secret'), file('/absolute'), file('a/../secret'), file('a\\secret'), file('a//secret'),
    file('dir/'), prefix(''), glob('not-a-glob'), { kind: 'automatic', path: 'route/[game]' }, { ...file('file'), optional: true },
  ]) {
    const value = fixture();
    value.lanes.codec.execution_inputs = [selector];
    assert.throws(() => validateCacheInputContract(value));
  }
  const duplicate = fixture();
  duplicate.lanes.codec.execution_inputs = [file('source'), file('source')];
  assert.throws(() => validateCacheInputContract(duplicate), /duplicate selector/);
  const old = fixture();
  old.cache_inputs.packages = {};
  assert.throws(() => validateCacheInputContract(old), /unknown field packages/);
  const escaping = metadata();
  escaping.packages[0].manifest_path = '/external/codec/Cargo.toml';
  assert.throws(() => edges(['codec'], fixture(), escaping), /must be inside the repository/);
});

test('manifest catalog separates production packs and proof manifest from test documents and fixtures', () => {
  const cargo = readFileSync(new URL('../Cargo.toml', import.meta.url), 'utf8');
  const packageNames = [...cargo.matchAll(/"crates\/([^"/]+)"/g)].map((match) => match[1]);
  assert.equal(validateCacheInputContract(manifest, { packageNames }), true);
  const declaredTargets = new Set(Object.values(manifest.lanes).flatMap((lane) => lane.assertion_targets ?? []));
  for (const id of Object.keys(manifest.execution_inputs.targets)) assert.ok(declaredTargets.has(id), `unclaimed target ${id}`);
  assert.deepEqual(manifest.execution_inputs.packages.operator_proof, [file('docs/ops/proof-runs.json')]);
  assert.equal(manifest.execution_inputs.packages.domain, undefined);
  assert.ok(manifest.execution_inputs.targets['domain/test/result_contract'].some(({ path }) => path.endsWith('day_vote_resolution.fmarch.json')));
  assert.ok(manifest.execution_inputs.targets['operator_proof/lib'].some(({ path }) => path === 'docs/arch/09-engine-and-packs.md'));
  assert.ok(manifest.execution_inputs.targets['operator_api/lib'].some(({ path }) => path === 'docs/arch/09-engine-and-packs.md'));
  const packs = manifest.execution_inputs.packages.content_registry;
  assert.ok(packs.some((selector) => executionInputMatches('packs/default_open/pack.json', selector)));
  assert.ok(!packs.some((selector) => executionInputMatches('packs/default_open/golden/scenario.json', selector)));
  assert.ok(!packs.some((selector) => executionInputMatches('programs/README.md', selector)));
  assert.ok(manifest.cache_inputs.global.some(({ path }) => path === 'tools/proof_input_paths.mjs'));
});
