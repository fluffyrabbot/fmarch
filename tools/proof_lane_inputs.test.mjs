import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { declaredLaneCacheInputs, validateCacheInputContract } from './proof_lane_inputs.mjs';

const file = (path) => ({ kind: 'file', path });
const prefix = (path) => ({ kind: 'prefix', path });
const glob = (path) => ({ kind: 'glob', path });
const manifest = JSON.parse(readFileSync(new URL('../docs/ops/proof-lane-manifest.json', import.meta.url), 'utf8'));
const fixture = () => ({
  cache_inputs: {
    version: 1,
    global: [file('Cargo.lock')],
    groups: { browser: [prefix('frontend/')] },
    packages: { codec: [file('fixtures/codec.json')] },
  },
  lanes: {
    source: { cache_inputs: { groups: [], paths: [file('source.mjs')] } },
    browser: { cache_inputs: { groups: ['browser'], paths: [file('frontend/src/routes/[game]/+page.svelte')] } },
  },
});

test('explicit contract composes hard-dependency lanes and transitive package fixtures', () => {
  assert.deepEqual(declaredLaneCacheInputs(['source', 'browser'], fixture(), ['codec']), [
    file('Cargo.lock'),
    file('fixtures/codec.json'),
    file('frontend/src/routes/[game]/+page.svelte'),
    file('source.mjs'),
    prefix('frontend/'),
  ]);
});

test('declarations deduplicate shared inputs and retain literal selector identity', () => {
  const value = fixture();
  value.lanes.browser.cache_inputs.paths.push(file('Cargo.lock'));
  assert.equal(declaredLaneCacheInputs(['browser', 'browser'], value).filter(({ path }) => path === 'Cargo.lock').length, 1);
  assert.ok(declaredLaneCacheInputs(['browser'], value).some(({ kind, path }) =>
    kind === 'file' && path === 'frontend/src/routes/[game]/+page.svelte'));
});

test('missing contracts and undeclared lanes fail closed', () => {
  assert.throws(() => validateCacheInputContract({ lanes: {} }), /input contract must be an object/);
  const value = fixture();
  delete value.lanes.source.cache_inputs;
  assert.throws(() => validateCacheInputContract(value), /source cache inputs must be an object/);
  assert.throws(() => declaredLaneCacheInputs(['missing'], fixture()), /unknown proof lane missing/);
});

test('unknown groups and packages cannot silently drop required inputs', () => {
  const value = fixture();
  value.lanes.source.cache_inputs.groups.push('misspelled');
  assert.throws(() => validateCacheInputContract(value), /unknown group/);
  assert.throws(() => validateCacheInputContract(fixture(), { packageNames: ['other'] }), /unknown package codec/);
  assert.equal(validateCacheInputContract(fixture(), { packageNames: ['codec', 'other'] }), true);
});

test('malformed selectors, escaping paths and unknown fields are rejected', () => {
  for (const selector of [
    file('../secret'), file('/absolute'), file('a/../secret'), file('a\\secret'),
    file('a//secret'), file('dir/'), prefix(''), glob('not-a-glob'),
    { kind: 'automatic', path: 'route/[game]' }, { ...file('file'), optional: true },
  ]) {
    const value = fixture();
    value.lanes.source.cache_inputs.paths = [selector];
    assert.throws(() => validateCacheInputContract(value));
  }
  const value = fixture();
  value.lanes.source.cache_inputs.paths.push(file('source.mjs'));
  assert.throws(() => validateCacheInputContract(value), /duplicate selector/);
});

test('real manifest explicitly covers every lane and every supplemental package exists', () => {
  const cargo = readFileSync(new URL('../Cargo.toml', import.meta.url), 'utf8');
  const packageNames = [...cargo.matchAll(/"crates\/([^"/]+)"/g)].map((match) => match[1]);
  assert.equal(validateCacheInputContract(manifest, { packageNames }), true);
  assert.ok(Object.keys(manifest.lanes).length >= 80);
});

test('pure Rust declarations avoid unrelated browser tools while imported fixtures propagate', () => {
  const actor = declaredLaneCacheInputs(['cargo:event-actor'], manifest, ['event_actor']);
  assert.ok(!actor.some(({ kind, path }) => kind === 'prefix' && ['frontend/', 'tools/'].includes(path)));
  assert.ok(!actor.some(({ path }) => path === 'tools/host_console_live_stack_smoke.mjs'));
  const domain = declaredLaneCacheInputs(['cargo:domain'], manifest, ['domain']);
  assert.ok(domain.some(({ path }) => path === 'tools/fixtures/im_human_v4/day_vote_resolution.fmarch.json'));
  const consumer = declaredLaneCacheInputs(['cargo:api'], manifest, ['api', 'operator_proof', 'content_registry']);
  for (const path of ['docs/ops/proof-runs.json', 'docs/arch/09-engine-and-packs.md', 'packs/', 'programs/']) {
    assert.ok(consumer.some((entry) => entry.path === path), `missing transitive fixture ${path}`);
  }
});

test('source-inspecting Rust tests declare inputs outside Cargo dependency closure', () => {
  const eventstore = declaredLaneCacheInputs(['cargo:eventstore'], manifest, ['eventstore']);
  assert.ok(eventstore.some(({ kind, path }) => kind === 'glob' && path === 'crates/*/src/**/*.rs'));
  const identity = declaredLaneCacheInputs(['cargo:identity'], manifest, ['identity']);
  assert.ok(identity.some(({ kind, path }) => kind === 'glob' && path === 'crates/*/Cargo.toml'));
  const projections = declaredLaneCacheInputs(['cargo:projections'], manifest, ['projections']);
  assert.ok(projections.some(({ path }) => path === 'crates/forum_postgres/src/lib.rs'));
});

test('generated outputs and intentional collection globs remain explicit cache inputs', () => {
  const wire = declaredLaneCacheInputs(['check:wire-types'], manifest, ['wire']);
  assert.ok(wire.some(({ kind, path }) => kind === 'file' && path === 'frontend/src/lib/wire/types.ts'));
  const goldens = declaredLaneCacheInputs(['check:command-goldens'], manifest, ['commands']);
  for (const path of ['crates/domain/src/**/*.rs', 'packs/*/pack.json', 'packs/*/golden/*.json']) {
    assert.ok(goldens.some((entry) => entry.kind === 'glob' && entry.path === path));
  }
});
