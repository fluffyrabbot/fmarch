import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  MANIFEST_PATH,
  REPO_ROOT,
  deduplicateLaneIds,
  gitChangedFiles,
  laneCommand,
  laneExecutionKey,
  loadManifest,
  mergeTimings,
  orderedExecutionPlan,
  pathMatches,
  reverseCrateClosure,
  runLanes,
  selectLanes,
} from './proof_lane_select.mjs';

const manifest = loadManifest(MANIFEST_PATH);
const registry = JSON.parse(
  readFileSync(join(REPO_ROOT, 'docs', 'ops', 'completion-registry.json'), 'utf8'),
);
const packageScripts = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).scripts;
const timingBaseline = JSON.parse(
  readFileSync(join(REPO_ROOT, 'docs', 'ops', 'proof-lane-timings.json'), 'utf8'),
);

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

test('every area lane and push sentinel is defined in the lane table', () => {
  const laneIds = new Set(Object.keys(manifest.lanes));
  for (const area of manifest.areas) {
    for (const lane of area.lanes) {
      assert.ok(laneIds.has(lane), `area ${area.id} references undefined lane ${lane}`);
    }
  }
  for (const lane of manifest.push_sentinels) {
    assert.ok(laneIds.has(lane), `push_sentinels references undefined lane ${lane}`);
  }
});

test('remote trunk is canonical and the push sentinel set fits its measured budget', () => {
  assert.equal(manifest.base_ref, 'origin/main');
  assert.ok(manifest.push_sentinel_budget_seconds > 0);
  let measuredSeconds = 0;
  for (const lane of manifest.push_sentinels) {
    const timing = timingBaseline.lanes[lane];
    assert.ok(timing, `push sentinel ${lane} needs a tracked timing baseline`);
    assert.equal(timing.command, laneCommand(lane, manifest));
    assert.ok(Number.isFinite(timing.seconds) && timing.seconds >= 0);
    measuredSeconds += timing.seconds;
  }
  assert.ok(
    measuredSeconds <= manifest.push_sentinel_budget_seconds,
    `push sentinels cost ${measuredSeconds}s, over ${manifest.push_sentinel_budget_seconds}s budget`,
  );
});

test('remote trunk avoids false history when a worktree-local main ref is stale', () => {
  const git = (...args) => {
    const command = args.join(' ');
    if (command === 'merge-base main HEAD') return 'stale-main\n';
    if (command === 'merge-base origin/main HEAD') return 'current-head\n';
    if (command === 'diff --name-only stale-main..HEAD') {
      return 'crates/commands/src/lib.rs\n';
    }
    if (command === 'diff --name-only current-head..HEAD') return '';
    if (command === 'status --porcelain=v1') return ' M tools/proof_lane_select.mjs\n';
    throw new Error(`unexpected git command: ${command}`);
  };

  assert.deepEqual(gitChangedFiles('origin/main', git), ['tools/proof_lane_select.mjs']);
  assert.deepEqual(
    gitChangedFiles('main', git),
    ['crates/commands/src/lib.rs', 'tools/proof_lane_select.mjs'],
  );
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

test('Postgres-backed mash acceptance owns a repo-local database default', () => {
  assert.match(
    packageScripts['test:mash-scale-acceptance'],
    /DATABASE_URL=\$\{DATABASE_URL:-postgres:\/\/fmarch:fmarch@127\.0\.0\.1:5544\/fmarch\}/,
  );
});

test('manifest lanes are executable leaves, while human aggregate aliases stay outside the graph', () => {
  const declared = new Set(Object.keys(manifest.lanes));
  for (const [laneId, lane] of Object.entries(manifest.lanes)) {
    if (lane.kind !== 'npm') continue;
    const nested = [
      ...packageScripts[laneId].matchAll(/\bnpm run ([A-Za-z0-9:_-]+)/g),
    ].map((match) => match[1]).filter((nestedId) => declared.has(nestedId));
    assert.deepEqual(
      nested,
      [],
      `manifest lane ${laneId} nests declared lane(s): ${nested.join(', ')}`,
    );
  }

  for (const alias of ['test:local-postgres-ci', 'test:frontend-role-proof:quick']) {
    assert.ok(packageScripts[alias], `human aggregate alias ${alias} must remain available`);
    assert.ok(!declared.has(alias), `aggregate alias ${alias} must not be a manifest leaf`);
  }
});

test('canonical execution planning runs an equivalent command only once', () => {
  const fixtureManifest = {
    lanes: {
      slow: { kind: 'shell', command: 'cargo test -p commands' },
      duplicate: { kind: 'shell', command: '  cargo   test -p commands  ' },
      fast: { kind: 'shell', command: 'cargo test -p projections' },
    },
  };
  const timings = {
    lanes: {
      slow: { seconds: 800 },
      duplicate: { seconds: 900 },
      fast: { seconds: 10 },
    },
  };

  assert.equal(
    laneExecutionKey('slow', fixtureManifest),
    laneExecutionKey('duplicate', fixtureManifest),
  );
  assert.deepEqual(
    orderedExecutionPlan(['slow', 'duplicate', 'fast'], fixtureManifest, timings),
    ['fast', 'slow'],
  );
  assert.deepEqual(
    deduplicateLaneIds(['duplicate', 'slow'], fixtureManifest),
    ['duplicate'],
  );
  const calls = [];
  runLanes(['fast', 'slow', 'duplicate'], fixtureManifest, {
    spawn(command) {
      calls.push(command);
      return { status: 0 };
    },
  });
  assert.deepEqual(calls, [
    'cargo test -p projections',
    'cargo test -p commands',
  ]);

  const fullPlan = orderedExecutionPlan(
    Object.keys(manifest.lanes),
    manifest,
    { lanes: {} },
  );
  assert.equal(
    fullPlan.length,
    Object.keys(manifest.lanes).length,
    'real manifest must not declare duplicate canonical execution keys',
  );
});

test('lane execution emits automatic timing observations for every attempted lane', () => {
  const fixtureManifest = {
    lanes: {
      pass: { kind: 'shell', command: 'pass-command' },
      fail: { kind: 'shell', command: 'fail-command' },
    },
  };
  const times = [1_000, 1_240, 2_000, 2_710];
  const observations = [];
  assert.throws(
    () =>
      runLanes(['pass', 'fail'], fixtureManifest, {
        spawn: (command) => ({ status: command === 'fail-command' ? 9 : 0 }),
        now: () => times.shift(),
        onResult: (laneId, entry) => observations.push([laneId, entry]),
      }),
    /lane fail failed \(exit 9\)/,
  );
  assert.deepEqual(
    observations.map(([laneId, entry]) => ({
      laneId,
      seconds: entry.seconds,
      command: entry.command,
      status: entry.status,
    })),
    [
      { laneId: 'pass', seconds: 0.2, command: 'pass-command', status: 0 },
      { laneId: 'fail', seconds: 0.7, command: 'fail-command', status: 9 },
    ],
  );

  assert.deepEqual(
    mergeTimings(
      { version: 1, lanes: { pass: { seconds: 4 } } },
      { version: 1, lanes: { pass: { seconds: 0.2 }, fail: { seconds: 0.7 } } },
    ),
    {
      version: 1,
      lanes: {
        pass: { seconds: 0.2 },
        fail: { seconds: 0.7 },
      },
    },
  );
});

test('aggregate coverage expands to atomic Postgres and frontend leaves', () => {
  const workspace = selectLanes({
    changed: ['package.json'],
    manifest,
    crateGraph: FIXTURE_GRAPH,
    mode: 'inner',
  });
  for (const lane of [
    'check:build-posture',
    'test:projection-baseline:static',
    'cargo:commands',
    'cargo:projections',
  ]) {
    assert.ok(workspace.laneIds.includes(lane), `workspace manifest must arm ${lane}`);
  }
  assert.ok(!workspace.laneIds.includes('test:local-postgres-ci'));

  const frontend = selectLanes({
    changed: ['frontend/src/routes/g/demo/+page.svelte'],
    manifest,
    crateGraph: FIXTURE_GRAPH,
    mode: 'inner',
  });
  for (const lane of [
    'test:frontend-contract',
    'test:frontend-route-state-render',
    'test:frontend-static-role-contract',
    'test:frontend-tablet-interaction',
    'test:frontend-role-dom-smoke',
  ]) {
    assert.ok(frontend.laneIds.includes(lane), `frontend game area must arm ${lane}`);
  }
  assert.ok(!frontend.laneIds.includes('test:frontend-role-proof:quick'));
});

test('lane execution preserves selected order and stops at the first failure', () => {
  const calls = [];
  const spawn = (command) => {
    calls.push(command);
    return { status: command.includes('test:proof-lane-contract') ? 7 : 0 };
  };
  assert.throws(
    () =>
      runLanes(
        ['check:build-posture', 'test:proof-lane-contract', 'test:completeness-scorecard'],
        manifest,
        { spawn },
      ),
    /test:proof-lane-contract failed \(exit 7\)/,
  );
  assert.deepEqual(calls, [
    'npm run check:build-posture',
    'npm run test:proof-lane-contract',
  ]);
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

test('inner, push, sprint, and full modes escalate coverage deliberately', () => {
  const changed = ['frontend/src/routes/auth/login/+page.svelte'];
  const inner = selectLanes({ changed, manifest, crateGraph: FIXTURE_GRAPH, mode: 'inner' });
  assert.ok(!inner.laneIds.includes('test:frontend-role-smoke'), 'frozen game lanes stay out of inner loop');
  assert.ok(inner.frozenSkipped.includes('frontend:game'));

  const push = selectLanes({ changed, manifest, crateGraph: FIXTURE_GRAPH, mode: 'push' });
  assert.ok(push.laneIds.includes('test:completeness-scorecard'), 'push sentinels apply');
  assert.ok(!push.laneIds.includes('cargo:identity'), 'unrelated active lanes stay out of push');
  assert.ok(!push.laneIds.includes('test:frontend-visual-regression'), 'untouched frozen lanes stay out of push');

  const sprint = selectLanes({ changed, manifest, crateGraph: FIXTURE_GRAPH, mode: 'sprint' });
  assert.ok(sprint.laneIds.includes('cargo:identity'), 'active-tier lanes join sprint mode');
  assert.ok(sprint.laneIds.includes('test:completeness-scorecard'), 'sprint retains sentinels');
  assert.ok(
    !sprint.laneIds.includes('test:frontend-visual-regression'),
    'untouched frozen lanes stay out of sprint',
  );

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
