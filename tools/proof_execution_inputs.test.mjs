import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { executionInputMatches } from './proof_lane_inputs.mjs';
import { laneProofInputs, validateLaneProofInputPaths } from './proof_lane_cache.mjs';
import { gitChangedFiles, loadManifest, lockedCargoMetadata, REPO_ROOT, selectLanes } from './proof_lane_select.mjs';

const manifest = loadManifest();
const metadata = lockedCargoMetadata();
const select = (changed, spec = manifest) => selectLanes({ changed, manifest: spec, metadata, crateGraph: {}, root: REPO_ROOT });

// The catalog is exercised independently of behavioral area ownership, so an
// area accidentally overlapping a fixture cannot disguise a missing input edge.
const withoutAreas = { ...manifest, areas: [] };

test('test-only fixture and architecture docs select consuming targets without downstream runtime tests', () => {
  for (const [path, required] of [
    ['tools/fixtures/im_human_v4/day_vote_resolution.fmarch.json', ['cargo:domain', 'cargo:clippy-workspace']],
    ['docs/arch/09-engine-and-packs.md', ['cargo:operator-proof', 'cargo:operator_api', 'cargo:clippy-workspace']],
    ['docs/arch/11-engine-port-checklist.md', ['cargo:operator-proof', 'cargo:operator_api', 'cargo:clippy-workspace']],
  ]) {
    const selection = select([path], withoutAreas);
    for (const id of required) assert.ok(selection.laneIds.includes(id), `${path} requires ${id}`);
    for (const id of ['cargo:api', 'test:frontend-role-smoke']) assert.ok(!selection.laneIds.includes(id), `${path} must not arm ${id}`);
    assert.deepEqual(selection.unmapped, []);
    assert.deepEqual(selection.behavioralAreas, []);
  }
});

test('compiled package inputs follow dev dependencies and prerequisite artifacts', () => {
  const selection = select(['docs/ops/proof-runs.json'], withoutAreas);
  for (const id of ['cargo:commands-audit', 'cargo:operator-proof', 'cargo:api', 'test:frontend-role-smoke', 'check:release-topology-evidence']) {
    assert.ok(selection.laneIds.includes(id), id);
  }
});

test('declared input consumers and cache input consumers agree through hard dependencies', () => {
  const paths = [
    'tools/fixtures/im_human_v4/day_vote_resolution.fmarch.json',
    'docs/arch/09-engine-and-packs.md',
    'docs/ops/proof-runs.json',
    'packs/nested/example/golden/new.json',
    'crates/database_schema/schema/epoch.json',
    'crates/operator_proof/src/lib.rs',
  ];
  for (const path of paths) {
    const selection = select([path]);
    for (const laneId of Object.keys(manifest.lanes)) {
      const inputs = laneProofInputs([laneId], manifest, { root: REPO_ROOT, metadata });
      const selectors = [...inputs.cargo.selectors, ...inputs.edges.map(edge => edge.selector)];
      if (selectors.some(selector => executionInputMatches(path, selector))) {
        assert.ok(selection.laneIds.includes(laneId), `${path} selects its cache consumer ${laneId}`);
      }
    }
  }
});

test('Rust source audit is independently selected without eventstore database proof', () => {
  const selection = select(['crates/event_actor/src/lib.rs'], withoutAreas);
  assert.ok(selection.laneIds.includes('test:event-body-authority'));
  assert.ok(!selection.laneIds.includes('cargo:eventstore'));
  assert.equal(manifest.lanes['test:event-body-authority'].execution.class, 'hermetic');
  assert.deepEqual(manifest.lanes['test:event-body-authority'].execution.resources, []);
});

test('broad cache context is not an execution edge or unmapped-path exemption', () => {
  const fixture = {
    ...manifest, areas: [],
    lanes: { context: { kind: 'npm', cache_inputs: { groups: ['repository-contracts'], paths: [] }, execution_inputs: [], execution: { class: 'hermetic', argv: ['true'], resources: [] } } },
  };
  const selection = select(['docs/unowned-new.md'], fixture);
  assert.deepEqual(selection.laneIds, []);
  assert.deepEqual(selection.unmapped, ['docs/unowned-new.md']);
});

function gitFixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'fmarch-input-selection-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q');
  git('config', 'user.name', 'Proof fixture');
  git('config', 'user.email', 'proof@example.invalid');
  return { root, git };
}

test('Git discovery preserves both sides of committed staged and unstaged renames with literal names', t => {
  const { root, git } = gitFixture(t);
  const originals = ['committed -> [old].json', 'staged\nold.json', 'unstaged [old].json'];
  for (const path of originals) writeFileSync(join(root, path), path);
  git('add', '.'); git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD').trim();
  const destinations = ['committed -> [new].json', 'staged\nnew.json', 'unstaged [new].json'];
  git('mv', originals[0], destinations[0]); git('commit', '-qm', 'rename committed');
  git('mv', originals[1], destinations[1]);
  renameSync(join(root, originals[2]), join(root, destinations[2]));
  assert.deepEqual(gitChangedFiles(base, git), [...originals, ...destinations].sort());
});

test('execution-only lanes reject selected links before cache reuse is considered', t => {
  const { root } = gitFixture(t);
  mkdirSync(join(root, 'fixtures'));
  writeFileSync(join(root, 'real.json'), '{}');
  symlinkSync('../real.json', join(root, 'fixtures', 'input.json'));
  const spec = {
    cache_inputs: { version: 2, global: [], groups: {} },
    execution_inputs: { version: 1, packages: {}, targets: {} }, areas: [],
    lanes: { check: { cache: false, cache_inputs: { groups: [], paths: [] }, execution_inputs: [{ kind: 'file', path: 'fixtures/input.json' }], execution: { class: 'hermetic', argv: ['true'], resources: [] } } },
  };
  assert.throws(() => validateLaneProofInputPaths(['check'], spec, { root, metadata: { packages: [] } }), error => error.code === 'UNSAFE_PROOF_INPUT');
});
