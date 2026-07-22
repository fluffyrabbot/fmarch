import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  MANIFEST_PATH,
  REPO_ROOT,
  laneCommand,
  loadManifest,
  pathMatches,
  reverseCrateClosure,
  selectLanes,
} from './proof_lane_select.mjs';

const manifest = loadManifest(MANIFEST_PATH);
const registry = JSON.parse(
  readFileSync(join(REPO_ROOT, 'docs', 'ops', 'completion-registry.json'), 'utf8'),
);
const packageScripts = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).scripts;

// Fixture mirroring the real workspace DAG shape; keeps selection tests
// hermetic (no cargo invocation).
const FIXTURE_GRAPH = {
  domain: [],
  identity: [],
  eventstore: ['domain'],
  projections: ['domain', 'eventstore'],
  commands: ['domain', 'eventstore', 'projections'],
  wire: ['domain', 'projections', 'commands'],
  api: ['domain', 'identity', 'wire'],
  server: ['api', 'identity'],
};

test('every area lane and push_always lane is defined in the lane table', () => {
  const laneIds = new Set(Object.keys(manifest.lanes));
  for (const area of manifest.areas) {
    for (const lane of area.lanes) {
      assert.ok(laneIds.has(lane), `area ${area.id} references undefined lane ${lane}`);
    }
  }
  for (const lane of manifest.push_always) {
    assert.ok(laneIds.has(lane), `push_always references undefined lane ${lane}`);
  }
});

test('npm lanes exist as package.json scripts and shell lanes carry commands', () => {
  for (const [laneId, lane] of Object.entries(manifest.lanes)) {
    if (lane.kind === 'npm') {
      assert.ok(packageScripts[laneId], `npm lane ${laneId} missing from package.json scripts`);
    } else {
      assert.equal(lane.kind, 'shell', `lane ${laneId} has unknown kind ${lane.kind}`);
      assert.ok(lane.command?.length > 0, `shell lane ${laneId} has no command`);
      assert.equal(laneCommand(laneId, manifest), lane.command);
    }
  }
});

test('every manifest path entry exists in the repo', () => {
  for (const area of manifest.areas) {
    for (const entry of area.paths) {
      // Prefix entries ending in '.' (e.g. frontend/src/hooks.server.) name a
      // file stem; verify at least one match exists in the parent directory.
      if (entry.endsWith('.') && !entry.endsWith('/')) {
        const slash = entry.lastIndexOf('/');
        const dir = join(REPO_ROOT, entry.slice(0, slash));
        const stem = entry.slice(slash + 1);
        const hits = readdirSync(dir).filter((name) => name.startsWith(stem));
        assert.ok(hits.length > 0, `area ${area.id} stem ${entry} matches nothing`);
      } else {
        assert.ok(
          existsSync(join(REPO_ROOT, entry.replace(/\/$/, ''))),
          `area ${area.id} path ${entry} does not exist`,
        );
      }
    }
  }
});

test('every workspace crate is covered by exactly one crate area', () => {
  const crateDirs = readdirSync(join(REPO_ROOT, 'crates'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  const crateAreas = manifest.areas.filter((a) => a.crate).map((a) => a.crate);
  for (const crate of crateDirs) {
    assert.equal(
      crateAreas.filter((c) => c === crate).length,
      1,
      `crate ${crate} must be owned by exactly one area`,
    );
  }
});

test('frozen areas cite registry capabilities that are all complete', () => {
  const statusById = new Map(registry.items.map((item) => [item.id, item.status]));
  for (const area of manifest.areas.filter((a) => a.tier === 'frozen')) {
    assert.ok(
      area.capabilities?.length > 0,
      `frozen area ${area.id} must cite at least one registry capability`,
    );
    for (const capability of area.capabilities) {
      assert.equal(
        statusById.get(capability),
        'complete',
        `frozen area ${area.id} cites ${capability} which is not complete`,
      );
    }
  }
});

test('area tiers are declared and also_triggers point at real areas', () => {
  const ids = new Set(manifest.areas.map((a) => a.id));
  for (const area of manifest.areas) {
    assert.ok(['frozen', 'active'].includes(area.tier), `area ${area.id} has bad tier`);
    for (const target of area.also_triggers ?? []) {
      assert.ok(ids.has(target), `area ${area.id} also_triggers unknown area ${target}`);
    }
  }
});

test('path matching: prefixes need trailing slash or dot, longest match wins', () => {
  assert.ok(pathMatches('crates/wire/src/lib.rs', 'crates/wire/'));
  assert.ok(!pathMatches('crates/wireless/src/lib.rs', 'crates/wire'));
  assert.ok(pathMatches('frontend/src/hooks.server.test.mjs', 'frontend/src/hooks.server.'));
  assert.ok(pathMatches('Dockerfile', 'Dockerfile'));
  assert.ok(!pathMatches('Dockerfile.frontend', 'Dockerfile'));

  const selection = selectLanes({
    changed: ['frontend/src/routes/admin/+page.server.js'],
    manifest,
    crateGraph: FIXTURE_GRAPH,
  });
  assert.deepEqual(
    selection.touched.map((t) => t.id),
    ['frontend:admin'],
    'admin route must map to frontend:admin, not the frontend/ catch-all',
  );
});

test('crate closure arms dependent crate areas', () => {
  const closure = reverseCrateClosure(FIXTURE_GRAPH);
  assert.deepEqual(
    [...closure.get('eventstore')].sort(),
    ['api', 'commands', 'projections', 'server', 'wire'],
  );

  const selection = selectLanes({
    changed: ['crates/eventstore/src/lib.rs'],
    manifest,
    crateGraph: FIXTURE_GRAPH,
  });
  const touchedIds = new Set(selection.touched.map((t) => t.id));
  for (const id of ['crate:eventstore', 'crate:projections', 'crate:commands', 'crate:wire', 'crate:api', 'crate:server']) {
    assert.ok(touchedIds.has(id), `expected ${id} in closure`);
  }
  assert.ok(!touchedIds.has('crate:domain'), 'dependencies (not dependents) must stay untouched');
});

test('also_triggers re-arms cross-boundary areas: wire thaws frontend:game and tools', () => {
  const selection = selectLanes({
    changed: ['crates/wire/src/lib.rs'],
    manifest,
    crateGraph: FIXTURE_GRAPH,
  });
  const touchedIds = new Set(selection.touched.map((t) => t.id));
  assert.ok(touchedIds.has('frontend:game'));
  assert.ok(touchedIds.has('tools:proof-infra'));
  assert.ok(selection.laneIds.includes('test:frontend-role-smoke'));
  assert.ok(!selection.frozenSkipped.includes('frontend:game'));
});

test('inner mode skips untouched frozen lanes; push adds active tier; full has everything', () => {
  const changed = ['frontend/src/routes/auth/login/+page.svelte'];
  const inner = selectLanes({ changed, manifest, crateGraph: FIXTURE_GRAPH, mode: 'inner' });
  assert.ok(!inner.laneIds.includes('test:frontend-role-smoke'), 'frozen game lanes stay out of inner loop');
  assert.ok(inner.frozenSkipped.includes('frontend:game'));

  const push = selectLanes({ changed, manifest, crateGraph: FIXTURE_GRAPH, mode: 'push' });
  assert.ok(push.laneIds.includes('test:completeness-scorecard'), 'push_always applies');
  assert.ok(push.laneIds.includes('cargo:identity'), 'active-tier lanes join push mode');
  assert.ok(!push.laneIds.includes('test:frontend-visual-regression'), 'untouched frozen lanes stay out of push');

  const full = selectLanes({ changed, manifest, crateGraph: FIXTURE_GRAPH, mode: 'full' });
  assert.deepEqual([...full.laneIds].sort(), Object.keys(manifest.lanes).sort());
  assert.deepEqual(full.frozenSkipped, []);
});

test('unmapped files are reported; missing crate graph arms all crate areas', () => {
  const selection = selectLanes({
    changed: ['README.totally-new', 'crates/domain/src/lib.rs'],
    manifest,
    crateGraph: null,
  });
  assert.deepEqual(selection.unmapped, ['README.totally-new']);
  assert.ok(selection.crateFallback);
  const touchedIds = new Set(selection.touched.map((t) => t.id));
  for (const area of manifest.areas.filter((a) => a.crate)) {
    assert.ok(touchedIds.has(area.id), `fallback must arm ${area.id}`);
  }
});
