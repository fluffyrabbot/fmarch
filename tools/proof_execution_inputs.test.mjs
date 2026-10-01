import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import { executionInputMatches } from './proof_lane_inputs.mjs';
import { computeLaneProofKey, laneProofInputs, validateLaneProofInputPaths } from './proof_lane_cache.mjs';
import { expandHardDependencies } from './proof_lane_execution.mjs';
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

test('compiled package inputs follow direct dev dependencies and declared live builds', () => {
  const selection = select(['docs/ops/proof-runs.json'], withoutAreas);
  for (const id of ['cargo:commands-audit', 'cargo:operator-proof', 'test:host-console-live-stack-smoke']) {
    assert.ok(selection.laneIds.includes(id), id);
  }
  for (const id of ['cargo:api', 'check:release-topology-evidence', 'test:frontend-role-smoke']) {
    assert.ok(!selection.laneIds.includes(id), `${id} does not compile operator_proof`);
  }
});

const staticBrowserLanes = [
  'test:frontend-themes', 'test:frontend-cross-browser',
  'test:frontend-role-smoke', 'test:frontend-csp-browser',
];
const staticFrontendLanes = [...staticBrowserLanes, 'test:frontend-visual-regression'];

test('frontend fixture browsers explicitly build no Cargo targets, regardless of behavioral owners', () => {
  const spec = {
    ...manifest,
    areas: [...manifest.areas, { id: 'additional-behavioral-owner', crate: 'server', lanes: staticBrowserLanes }],
  };
  for (const id of staticBrowserLanes) assert.deepEqual(spec.lanes[id].cargo_inputs, { builds: [] }, id);
  for (const id of staticFrontendLanes) {
    const inputs = laneProofInputs([id], spec, { root: REPO_ROOT, metadata });
    assert.deepEqual(inputs.cargo.packages, [], id);
    assert.deepEqual(inputs.cargo.targets, [], id);
    assert.ok(inputs.edges.every(edge => edge.scope === 'lane'), id);
  }
});

test('server and operator Rust changes select live proof without arming fixture browsers', () => {
  for (const path of ['crates/server/src/main.rs', 'crates/operator_proof/src/lib.rs', 'docs/ops/proof-runs.json']) {
    const selection = select([path], withoutAreas);
    for (const id of staticFrontendLanes) {
      assert.ok(!selection.laneIds.includes(id), `${path} must not select ${id}`);
      assert.ok(!selection.executionTriggers.some(trigger => trigger.laneId === id), `${path} must not be an execution input for ${id}`);
    }
    for (const id of ['test:host-console-live-stack-smoke', 'test:auth-invite-role-proof', 'test:capacity-overload']) {
      assert.ok(selection.laneIds.includes(id), `${path} selects ${id}`);
    }
  }
});

test('wire behavioral contracts still arm frontend proof without claiming a frontend Rust build', () => {
  const path = 'crates/wire/src/lib.rs';
  const selection = select([path]);
  assert.ok(selection.behavioralAreas.includes('frontend:game'));
  for (const id of ['test:frontend-contract', 'test:frontend-role-smoke', 'test:frontend-cross-browser', 'test:frontend-visual-regression']) {
    assert.ok(selection.laneIds.includes(id), id);
    assert.ok(selection.laneReasons[id].some(reason => reason.startsWith('behavior:frontend:game:')), id);
    assert.ok(!selection.executionTriggers.some(trigger => trigger.laneId === id), `${id} must not compile wire`);
  }
});

test('theme mutations retain the theme, role-smoke and visual prerequisite chain', () => {
  const selection = select(['tools/frontend_theme_browser.mjs']);
  for (const id of ['test:frontend-themes', 'test:frontend-role-smoke', 'test:frontend-cross-browser', 'test:frontend-visual-regression']) {
    assert.ok(selection.laneIds.includes(id), id);
  }
  assert.deepEqual([...expandHardDependencies(['test:frontend-visual-regression'], manifest)].sort(), [
    'test:frontend-role-smoke', 'test:frontend-themes', 'test:frontend-visual-regression',
  ]);
  assert.deepEqual(laneProofInputs(['test:frontend-visual-regression'], manifest, { root: REPO_ROOT, metadata }).dependencyLaneIds, [
    'test:frontend-role-smoke', 'test:frontend-themes', 'test:frontend-visual-regression',
  ]);
});

test('live proofs bind their declared migrator and schema targets without the epoch-reset executable', () => {
  const expected = new Map([
    ['test:host-console-live-stack-smoke', ['operator_proof/bin/audit_resolution', 'server/bin/fmarch-migrate', 'server/bin/server']],
    ['test:host-console-day-event-room-live-stack', ['server/bin/fmarch-migrate', 'server/bin/server']],
    ['test:capacity-overload', ['server/bin/fmarch-migrate', 'server/bin/server']],
    ['test:dev-test-game-profile', ['server/bin/fmarch-migrate', 'server/bin/server']],
    ['test:dev-test-game-completed-export', ['server/bin/fmarch-migrate', 'server/bin/server']],
    ['test:live-stack-backup-restore-drill', ['server/bin/fmarch-migrate', 'server/bin/server']],
    ['test:database-schema-upgrade', ['server/bin/fmarch-migrate']],
    ['test:database-tls-boundary', ['server/bin/fmarch-migrate', 'server/bin/fmarch-schema-gate']],
    ['test:mash-scale-acceptance', ['api/bin/audit_mash_scale_acceptance', 'server/bin/fmarch-migrate']],
  ]);
  for (const [id, targets] of expected) {
    assert.deepEqual(manifest.lanes[id].cargo_inputs.builds.map(build => build.target).sort(), targets, id);
    for (const build of manifest.lanes[id].cargo_inputs.builds) {
      assert.equal(build.profile, id === 'test:database-tls-boundary' ? 'release' : 'dev', `${id}: ${build.target}`);
    }
    const inputs = laneProofInputs([id], manifest, { root: REPO_ROOT, metadata });
    assert.deepEqual(inputs.cargo.targets, targets, id);
    for (const target of targets) {
      const [packageName, , targetName] = target.split('/');
      const source = metadata.packages.find(pkg => pkg.name === packageName).targets.find(item => item.name === targetName).src_path;
      const path = relative(REPO_ROOT, source).replaceAll('\\', '/');
      const selection = select([path], withoutAreas);
      assert.ok(selection.laneIds.includes(id), `${path} selects ${id}`);
      for (const staticId of staticFrontendLanes) assert.ok(!selection.laneIds.includes(staticId), `${path} must not select ${staticId}`);
    }
  }
  const epoch = 'crates/database_schema/schema/epoch.json';
  const selection = select([epoch], withoutAreas);
  assert.ok(selection.laneIds.includes('cargo:server'));
  assert.ok(selection.laneIds.includes('cargo:clippy-workspace'));
  assert.ok(!selection.laneIds.includes('test:capacity-overload'));
  const capacity = laneProofInputs(['test:capacity-overload'], manifest, { root: REPO_ROOT, metadata });
  assert.ok(![...capacity.cargo.selectors, ...capacity.edges.map(edge => edge.selector)].some(selector => executionInputMatches(epoch, selector)));
  // Repository contract context intentionally remains broader than execution
  // ownership: it can invalidate a key without selecting a lane to execute.
  assert.ok(capacity.matchers.some(selector => executionInputMatches(epoch, selector)));
});

test('profile/export execution inputs select exact routes and shared lifecycle without behavioral ownership', () => {
  const profile = 'test:dev-test-game-profile';
  const exported = 'test:dev-test-game-completed-export';
  for (const [source, required, excluded] of [
    ['tools/profile_role_proof.mjs', [profile], [exported]],
    ['tools/completed_game_export_role_proof.mjs', [exported], [profile]],
    ['frontend/src/routes/profile/edit/+page.svelte', [profile], [exported]],
    ['frontend/src/routes/u/[handle]/+page.server.js', [profile], [exported]],
    ['frontend/src/routes/g/[game]/host/export/+page.svelte', [exported], [profile]],
    ['frontend/src/routes/g/g/host/export/+page.svelte', [], [profile, exported]],
    ['tools/live_role_proof_runtime.mjs', [profile, exported], []],
    ['tools/profile_export_proof_evidence.mjs', [profile, exported], []],
    ['tools/run_fmarch_migrations.mjs', [profile, exported], []],
    ['frontend/src/lib/server/session-capabilities.mjs', [profile, exported], []],
    ['frontend/src/lib/app/AppSurfaceHeader.svelte', [profile, exported], []],
    ['frontend/src/lib/app/app-surface-header-model.mjs', [profile, exported], []],
    ['frontend/src/routes/+layout.server.js', [profile, exported], []],
    ['frontend/src/routes/+layout.svelte', [profile, exported], []],
    ['frontend/src/lib/app/app-shell-model.mjs', [profile, exported], []],
    ['frontend/src/lib/app/AppShell.svelte', [profile, exported], []],
    ['frontend/src/lib/app/theme-context.mjs', [profile, exported], []],
  ]) {
    const selection = select([source], withoutAreas);
    for (const laneId of required) {
      assert.ok(selection.laneIds.includes(laneId), `${source} selects ${laneId}`);
      const inputs = laneProofInputs([laneId], manifest, { root: REPO_ROOT, metadata });
      assert.ok(inputs.edges.some(edge => executionInputMatches(source, edge.selector)), `${source} is fingerprinted for ${laneId}`);
    }
    for (const laneId of excluded) assert.ok(!selection.laneIds.includes(laneId), `${source} must not select ${laneId}`);
  }
});

test('completion evidence declarations participate in their lane proof key', () => {
  const profile = 'test:dev-test-game-profile';
  const exported = 'test:dev-test-game-completed-export';
  const options = { root: REPO_ROOT, metadata, files: [], toolchain: { fixture: 'fixed' } };
  const before = new Map([profile, exported].map(id => [id, computeLaneProofKey(id, manifest, options).proofKey]));
  for (const field of ['capability', 'artifact', 'proof']) {
    const changed = structuredClone(manifest);
    changed.lanes[profile].completion_evidence[0][field] += '-changed';
    assert.notEqual(computeLaneProofKey(profile, changed, options).proofKey, before.get(profile), field);
    assert.equal(computeLaneProofKey(exported, changed, options).proofKey, before.get(exported), `${field} stays lane-scoped`);
  }
});

test('Rust and runtime mutations preserve static frontend keys while changing live proof keys', t => {
  const { root } = gitFixture(t);
  const paths = [
    'crates/operator_proof/src/lib.rs', 'crates/server/src/main.rs',
    'docs/ops/proof-runs.json', 'packs/example/pack.json', 'programs/example.program.json',
    'tools/frontend_theme_browser.mjs', 'frontend/src/app.css',
  ];
  for (const path of paths) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), 'initial');
  }
  const members = new Set(metadata.workspace_members);
  const relocatedMetadata = {
    ...metadata,
    packages: metadata.packages.filter(pkg => members.has(pkg.id)).map(pkg => ({
      ...pkg,
      manifest_path: join(root, relative(REPO_ROOT, pkg.manifest_path)),
      targets: pkg.targets.map(target => ({ ...target, src_path: join(root, relative(REPO_ROOT, target.src_path)) })),
    })),
  };
  const compute = id => computeLaneProofKey(id, manifest, { root, metadata: relocatedMetadata, toolchain: { fixture: 'fixed' } });
  const liveId = 'test:host-console-live-stack-smoke';
  const ids = [...staticFrontendLanes, liveId];
  const before = new Map(ids.map(id => [id, compute(id)]));
  for (const path of paths.slice(0, 5)) {
    writeFileSync(join(root, path), `changed ${path}`);
    for (const id of staticFrontendLanes) {
      assert.ok(!before.get(id).payload.inputs.some(input => input.path === path), `${id} excludes ${path}`);
      assert.equal(compute(id).proofKey, before.get(id).proofKey, `${id} remains unchanged by ${path}`);
    }
    assert.ok(before.get(liveId).payload.inputs.some(input => input.path === path), `${liveId} includes ${path}`);
    assert.notEqual(compute(liveId).proofKey, before.get(liveId).proofKey, `${liveId} reacts to ${path}`);
    writeFileSync(join(root, path), 'initial');
  }
  for (const path of paths.slice(5)) {
    writeFileSync(join(root, path), `changed ${path}`);
    for (const id of staticFrontendLanes) {
      assert.notEqual(compute(id).proofKey, before.get(id).proofKey, `${id} reacts to ${path}`);
    }
    writeFileSync(join(root, path), 'initial');
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
