import assert from 'node:assert/strict';
import { existsSync, globSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  MANIFEST_PATH,
  REPO_ROOT,
  artifactPathMatches,
  crateGraphFromMetadata,
  deduplicateLaneIds,
  gitChangedFiles,
  laneCommand,
  laneExecutionKey,
  loadManifest,
  mergeTimings,
  orderedExecutionPlan,
  pathMatches,
  reverseCrateClosure,
  regenerateArtifact,
  costEstimates,
  isCostObservation,
  isDiffSensitive,
  measureLane,
  measureLanes,
  pruneUnknownLanes,
  runLanes,
  selectLanes,
  usesRunnerOwnedPostgres,
  warmupCommand,
  workspaceCrateGraph,
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
  operator_proof: ['commands'],
  wire: ['domain', 'projections', 'commands'],
  api: ['domain', 'identity', 'wire'],
  operator_api: ['commands', 'operator_proof', 'wire'],
  server: ['api', 'identity', 'operator_api'],
};

test('command audit is a dedicated exact-size integration target', () => {
  const ordinaryPath = join(
    REPO_ROOT,
    'crates',
    'commands',
    'tests',
    'pipeline',
    'residual_cases.rs',
  );
  const auditPath = join(
    REPO_ROOT,
    'crates',
    'commands',
    'tests',
    'semantic_audit',
    'cases.rs',
  );
  const witnessPath = join(
    REPO_ROOT,
    'crates',
    'commands',
    'tests',
    'semantic_audit',
    'golden_witness.rs',
  );
  const testAttribute = /^#\[(?:sqlx::test|tokio::test|test)\b/gm;
  const ordinarySource = readFileSync(ordinaryPath, 'utf8');
  const auditSource = readFileSync(auditPath, 'utf8');
  const witnessSource = readFileSync(witnessPath, 'utf8');

  assert.equal([...ordinarySource.matchAll(testAttribute)].length, 107);
  assert.equal([...auditSource.matchAll(testAttribute)].length, 29);
  assert.equal([...witnessSource.matchAll(testAttribute)].length, 3);
  assert.ok(!ordinarySource.includes('#[ignore'));
  assert.ok(!auditSource.includes('#[ignore'));
  assert.ok(!witnessSource.includes('#[ignore'));
  assert.ok(
    !ordinarySource.includes('run_minimizer('),
    'ordinary pipeline must not run semantic minimizer replays',
  );
  assert.ok(!existsSync(join(REPO_ROOT, 'crates', 'commands', 'tests', 'pipeline.rs')));
  assert.match(manifest.lanes['cargo:commands-pg'].command, /--test pipeline\b/);
  assert.match(manifest.lanes['cargo:commands-audit'].command, /--test semantic_audit\b/);
  assert.doesNotMatch(manifest.lanes['cargo:commands-audit'].command, /--ignored\b/);
});

test('host_resolve_phase tests cite a golden or are adapter-only, and witnessed goldens replace handwritten cases', () => {
  const auditDir = join(REPO_ROOT, 'crates', 'commands', 'tests', 'semantic_audit');
  const auditSource = readFileSync(join(auditDir, 'cases.rs'), 'utf8');
  const witnessManifest = JSON.parse(
    readFileSync(join(auditDir, 'golden_command_witnesses.json'), 'utf8'),
  );
  assert.ok(Array.isArray(witnessManifest.packs));
  assert.ok(witnessManifest.packs.length > 0);

  for (const pack of witnessManifest.packs) {
    assert.ok(pack.pack);
    assert.ok(pack.stems.length > 0, `${pack.pack} must list command-witness stems`);
    for (const stem of pack.stems) {
      const goldenPath = join(REPO_ROOT, 'packs', pack.pack, 'golden', `${stem}.json`);
      assert.ok(existsSync(goldenPath), `witness golden missing: ${goldenPath}`);
    }
    for (const excluded of pack.excluded ?? []) {
      const goldenPath = join(REPO_ROOT, 'packs', pack.pack, 'golden', `${excluded.stem}.json`);
      assert.ok(existsSync(goldenPath), `excluded golden missing: ${goldenPath}`);
      assert.ok(excluded.reason, `${excluded.stem} needs an exclusion reason`);
      assert.ok(
        !pack.stems.includes(excluded.stem),
        `${excluded.stem} cannot be both witnessed and excluded`,
      );
    }
    for (const testName of pack.replaced_tests ?? []) {
      assert.equal(
        auditSource.includes(`async fn ${testName}(`),
        false,
        `replaced handwritten test still present: ${testName}`,
      );
    }
  }

  const hostFns = [...auditSource.matchAll(/async fn (host_resolve_phase_[a-z0-9_]+)\(/g)].map(
    (match) => match[1],
  );
  assert.ok(hostFns.length > 0);
  const cited = [
    ...auditSource.matchAll(
      /\/\/ (golden: \S+|adapter-only: .+)\nasync fn (host_resolve_phase_[a-z0-9_]+)\(/g,
    ),
  ];
  assert.equal(cited.length, hostFns.length, 'every host_resolve_phase test must be cited');
  for (const match of cited) {
    const [, citation, name] = match;
    if (citation.startsWith('golden: ')) {
      const relative = citation.slice('golden: '.length);
      assert.ok(
        existsSync(join(REPO_ROOT, relative)),
        `${name} cites missing golden ${relative}`,
      );
    }
  }

  const witnessSource = readFileSync(join(auditDir, 'golden_witness.rs'), 'utf8');
  const leftoverDispatcher = witnessSource.slice(
    witnessSource.indexOf('leftover_host_resolve_phase_cases_share_one_migrated_database'),
  );
  assert.ok(leftoverDispatcher.length > 0, 'leftover host_resolve dispatcher must exist');
  assert.match(
    witnessSource,
    new RegExp(`const LEFTOVER_HOST_RESOLVE_PHASE_CASES: usize = ${hostFns.length};`),
  );
  for (const name of hostFns) {
    assert.ok(
      leftoverDispatcher.includes(name),
      `leftover host_resolve dispatcher missing ${name}`,
    );
  }
});

test('workspace crate graph excludes test-only reverse dependencies', () => {
  const graph = crateGraphFromMetadata({
    packages: [
      {
        name: 'commands',
        dependencies: [
          { name: 'domain', kind: null },
          { name: 'operator_proof', kind: 'dev' },
        ],
      },
      { name: 'domain', dependencies: [] },
      { name: 'operator_proof', dependencies: [{ name: 'commands', kind: null }] },
    ],
  });
  assert.deepEqual(graph.commands, ['domain']);
  assert.deepEqual(graph.operator_proof, ['commands']);
});

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

test('every Rust crate change arms pinned strict workspace Clippy', () => {
  assert.equal(
    manifest.lanes['cargo:clippy-workspace'].command,
    'cargo clippy --workspace --all-targets --all-features -- -D warnings',
  );
  for (const area of manifest.areas.filter((area) => area.crate || area.closure_crate)) {
    assert.ok(
      area.lanes.includes('cargo:clippy-workspace'),
      `${area.id} must arm strict workspace Clippy`,
    );
  }
  const workspaceArea = manifest.areas.find((area) => area.id === 'workspace:manifests');
  assert.ok(workspaceArea.paths.includes('rust-toolchain.toml'));
  assert.ok(workspaceArea.lanes.includes('cargo:clippy-workspace'));
});

test('generated artifacts have one owner, a writer, and exact freshness selection', () => {
  assert.equal(manifest.version, 6);
  const outputOwners = new Map();
  const artifactLanes = Object.entries(manifest.lanes).filter(
    ([, lane]) => lane.inputs || lane.outputs || lane.write_command,
  );
  assert.ok(artifactLanes.length > 0);

  for (const [laneId, lane] of artifactLanes) {
    assert.ok(lane.inputs?.length > 0, `generated artifact lane ${laneId} needs inputs`);
    assert.ok(lane.outputs?.length > 0, `generated artifact lane ${laneId} needs outputs`);
    assert.ok(lane.write_command?.length > 0, `generated artifact lane ${laneId} needs a writer`);
    assert.notEqual(lane.write_command, laneCommand(laneId, manifest));
    assert.equal(
      new Set([...lane.inputs, ...lane.outputs]).size,
      lane.inputs.length + lane.outputs.length,
      `generated artifact lane ${laneId} repeats an input or output`,
    );

    const expand = (entry) => /[*?\[\]{}]/.test(entry)
      ? globSync(entry, { cwd: REPO_ROOT }).sort()
      : [entry];
    const inputPaths = lane.inputs.flatMap(expand);
    const outputPaths = lane.outputs.flatMap(expand);
    const concreteInputs = new Set(inputPaths);
    assert.deepEqual(
      outputPaths.filter((outputPath) => concreteInputs.has(outputPath)),
      [],
      `generated artifact lane ${laneId} overlaps concrete inputs and outputs`,
    );
    for (const [entryType, entries, paths] of [
      ['input', lane.inputs, inputPaths],
      ['output', lane.outputs, outputPaths],
    ]) {
      for (const entry of entries) {
        assert.ok(!entry.startsWith('/') && !entry.includes('..'), `${laneId} has unsafe ${entryType} ${entry}`);
        assert.ok(expand(entry).length > 0, `${laneId} ${entryType} ${entry} matches no files`);
      }
      for (const artifactPath of paths) {
        assert.ok(existsSync(join(REPO_ROOT, artifactPath)));
      }
    }

    for (const outputPath of outputPaths) {
      assert.ok(
        !outputOwners.has(outputPath),
        `${outputPath} is also owned by ${outputOwners.get(outputPath)}`,
      );
      outputOwners.set(outputPath, laneId);
    }

    for (const artifactPath of [...inputPaths, ...outputPaths]) {
      const selection = selectLanes({
        changed: [artifactPath],
        manifest,
        crateGraph: FIXTURE_GRAPH,
      });
      assert.deepEqual(selection.unmapped, [], `${artifactPath} needs one area owner`);
      assert.equal(
        selection.touched.filter(({ reasons }) => reasons.includes(artifactPath)).length,
        1,
        `${artifactPath} needs exactly one direct area owner`,
      );
      assert.equal(
        selection.laneIds.filter((selected) => selected === laneId).length,
        1,
        `${artifactPath} must select ${laneId} exactly once`,
      );
      const directTriggers = selection.artifactTriggers.filter(
        (trigger) => trigger.laneId === laneId,
      );
      assert.deepEqual(
        directTriggers,
        [{ laneId, reasons: [artifactPath] }],
      );
    }

    const combined = selectLanes({
      changed: [...inputPaths, ...outputPaths],
      manifest,
      crateGraph: FIXTURE_GRAPH,
    });
    assert.equal(combined.laneIds.filter((selected) => selected === laneId).length, 1);
    assert.equal(combined.artifactTriggers.filter((trigger) => trigger.laneId === laneId).length, 1);
  }
});

test('artifact path matching supports exact files and collection globs', () => {
  assert.ok(artifactPathMatches('packs/mafiascum/golden/kill_vs_doctor.json', 'packs/*/golden/*.json'));
  assert.ok(artifactPathMatches('crates/wire/generated/types.ts', 'crates/wire/generated/types.ts'));
  assert.ok(!artifactPathMatches('packs/mafiascum/pack.json', 'packs/*/golden/*.json'));
});

test('regeneration writes then checks one declared artifact lane', () => {
  const calls = [];
  regenerateArtifact(
    'artifact',
    {
      lanes: {
        artifact: {
          kind: 'shell',
          command: 'check-command',
          write_command: 'write-command',
        },
      },
    },
    {
      spawn(command) {
        calls.push(command);
        return { status: 0 };
      },
    },
  );
  assert.deepEqual(calls, ['write-command', 'check-command']);
  const failedCalls = [];
  assert.throws(
    () => regenerateArtifact(
      'artifact',
      {
        lanes: {
          artifact: {
            kind: 'shell',
            command: 'check-command',
            write_command: 'write-command',
          },
        },
      },
      {
        spawn(command) {
          failedCalls.push(command);
          return { status: 7 };
        },
      },
    ),
    /regenerate command for artifact failed \(exit 7\)/,
  );
  assert.deepEqual(failedCalls, ['write-command']);
  assert.throws(
    () => regenerateArtifact('cargo:wire', manifest, { spawn: () => ({ status: 0 }) }),
    /not a generated artifact lane/,
  );
});

test('Postgres-backed npm lanes own a role-appropriate repo-local database default', () => {
  const localRuntimeDatabase =
    /DATABASE_URL=\$\{DATABASE_URL:-postgres:\/\/fmarch:fmarch@127\.0\.0\.1:5544\/fmarch\}/;
  const localMigrationDatabase =
    /DATABASE_MIGRATION_URL=\$\{DATABASE_MIGRATION_URL:-postgres:\/\/fmarch:fmarch@127\.0\.0\.1:5544\/fmarch\}/;
  assert.match(packageScripts['test:mash-scale-acceptance'], localMigrationDatabase);
  assert.match(packageScripts['test:release-topology'], localRuntimeDatabase);
  assert.match(packageScripts['test:event-key-rotation-rehearsal'], localRuntimeDatabase);
  assert.match(packageScripts['test:auth-invite-role-proof'], localMigrationDatabase);
  assert.match(packageScripts['test:public-search-role-proof'], localMigrationDatabase);
  assert.match(packageScripts['test:dev-test-game-search'], localMigrationDatabase);
  assert.match(packageScripts['test:live-stack-backup-restore-drill'], localMigrationDatabase);
  assert.match(
    packageScripts['test:host-console-day-event-room-live-stack'],
    localMigrationDatabase,
  );
});

test('migrated mutable proof leaves consume runner-owned database and artifact resources', () => {
  for (const [laneId, databaseEnvironments] of [
    ['test:auth-invite-role-proof', ['DATABASE_MIGRATION_URL']],
    ['test:host-console-day-event-room-live-stack', ['DATABASE_MIGRATION_URL']],
    ['test:live-stack-backup-restore-drill', ['DATABASE_MIGRATION_URL', 'DATABASE_RESTORE_MIGRATION_URL']],
    ['test:mash-scale-acceptance', ['DATABASE_MIGRATION_URL']],
    ['test:event-key-rotation-rehearsal', ['DATABASE_URL']],
  ]) {
    const lane = manifest.lanes[laneId];
    assert.equal(usesRunnerOwnedPostgres(lane), true, `${laneId} must lease a disposable database`);
    assert.deepEqual(
      lane.execution.resources
        .filter((resource) => resource.kind === 'postgres')
        .map((resource) => resource.url_env),
      databaseEnvironments,
      `${laneId} must declare every database resource by its injected URL environment`,
    );
    assert.ok(
      lane.execution.resources.some(
        (resource) => resource.kind === 'artifact-dir' && resource.env === 'FMARCH_PROOF_ARTIFACT_DIR',
      ),
      `${laneId} must receive a runner-scoped artifact directory`,
    );
    assert.ok(
      !lane.execution.resources.some((resource) => resource.kind === 'lock' && resource.name === 'legacy'),
      `${laneId} must not retain the legacy lock`,
    );
    assert.ok(
      lane.execution.resources.some((resource) => resource.kind === 'lock' && resource.name === 'cargo-target'),
      `${laneId} must serialize its Cargo build access`,
    );
  }

  for (const sourcePath of [
    join(REPO_ROOT, 'tools', 'auth_invite_role_proof.mjs'),
    join(REPO_ROOT, 'tools', 'host_console_live_stack_smoke.mjs'),
    join(REPO_ROOT, 'tools', 'live_stack_backup_restore_drill.mjs'),
    join(REPO_ROOT, 'tools', 'mash_scale_acceptance.mjs'),
  ]) {
    const source = readFileSync(sourcePath, 'utf8');
    assert.match(source, /FMARCH_PROOF_ARTIFACT_DIR/);
    assert.match(source, /FMARCH_PROOF_LANE_ID/);
    assert.match(source, /runnerOwnedDatabase/);
  }

  const exactImage = manifest.lanes['test:exact-image-content'];
  assert.ok(
    !exactImage.execution.resources.some((resource) => resource.kind === 'lock' && resource.name === 'legacy'),
    'exact-image must retain only typed container resources',
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

test('execution planning respects declared artifact producer ordering', () => {
  const fixtureManifest = {
    lanes: {
      capture: { kind: 'shell', command: 'capture' },
      compare: { kind: 'shell', command: 'compare', after: ['capture'] },
      fast: { kind: 'shell', command: 'fast' },
    },
  };
  const timings = {
    lanes: {
      capture: { seconds: 120 },
      compare: { seconds: 1 },
      fast: { seconds: 0.1 },
    },
  };

  assert.deepEqual(
    orderedExecutionPlan(['compare', 'capture', 'fast'], fixtureManifest, timings),
    ['fast', 'capture', 'compare'],
  );
  assert.throws(
    () =>
      orderedExecutionPlan(
        ['compare'],
        {
          lanes: {
            compare: { kind: 'shell', command: 'compare', after: ['missing'] },
          },
        },
        timings,
      ),
    /orders after unknown lane missing/,
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
    'test:database-schema:static',
    'cargo:commands-unit',
    'cargo:commands-pg',
    'cargo:commands-concurrency',
    'cargo:projections',
  ]) {
    assert.ok(workspace.laneIds.includes(lane), `workspace manifest must arm ${lane}`);
  }
  assert.ok(!workspace.laneIds.includes('test:local-postgres-ci'));

  const commandSource = selectLanes({
    changed: ['crates/commands/src/lib.rs'],
    manifest,
    crateGraph: FIXTURE_GRAPH,
    mode: 'inner',
  });
  assert.ok(commandSource.laneIds.includes('cargo:commands-pg'));
  assert.ok(!commandSource.laneIds.includes('cargo:commands-audit'));

  const ordinaryPipeline = selectLanes({
    changed: ['crates/commands/tests/pipeline/residual_cases.rs'],
    manifest,
    crateGraph: FIXTURE_GRAPH,
    mode: 'inner',
  });
  assert.ok(ordinaryPipeline.laneIds.includes('cargo:commands-pg'));
  assert.ok(!ordinaryPipeline.laneIds.includes('cargo:commands-audit'));

  const sharedPipelineSupport = selectLanes({
    changed: ['crates/commands/tests/pipeline/residual_support.rs'],
    manifest,
    crateGraph: FIXTURE_GRAPH,
    mode: 'inner',
  });
  assert.ok(sharedPipelineSupport.laneIds.includes('cargo:commands-pg'));
  assert.ok(sharedPipelineSupport.laneIds.includes('cargo:commands-audit'));

  const commandTargetManifest = selectLanes({
    changed: ['crates/commands/Cargo.toml'],
    manifest,
    crateGraph: FIXTURE_GRAPH,
    mode: 'inner',
  });
  assert.ok(commandTargetManifest.laneIds.includes('cargo:commands-pg'));
  assert.ok(commandTargetManifest.laneIds.includes('cargo:commands-audit'));

  const semanticAudit = selectLanes({
    changed: ['crates/commands/tests/semantic_audit/cases.rs'],
    manifest,
    crateGraph: FIXTURE_GRAPH,
    mode: 'inner',
  });
  assert.ok(semanticAudit.laneIds.includes('cargo:commands-audit'));
  assert.ok(!semanticAudit.laneIds.includes('cargo:commands-pg'));

  const goldenWitness = selectLanes({
    changed: ['crates/commands/tests/semantic_audit/golden_witness.rs'],
    manifest,
    crateGraph: FIXTURE_GRAPH,
    mode: 'inner',
  });
  assert.ok(goldenWitness.laneIds.includes('cargo:commands-audit'));
  assert.ok(!goldenWitness.laneIds.includes('cargo:commands-pg'));

  const minimizer = selectLanes({
    changed: ['crates/operator_proof/src/minimizer.rs'],
    manifest,
    crateGraph: FIXTURE_GRAPH,
    mode: 'inner',
  });
  assert.deepEqual(minimizer.touched.map((area) => area.id), ['operator-proof:minimizer']);
  assert.ok(minimizer.laneIds.includes('cargo:operator-proof'));
  assert.ok(minimizer.laneIds.includes('cargo:commands-audit'));
  assert.ok(!minimizer.laneIds.includes('cargo:operator_api'));

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

test('WorkOS callback and hosted configuration changes arm identity and deployment contracts', () => {
  for (const changed of [
    'frontend/src/routes/auth/callback/+server.js',
    'deploy/railway/api.env.example',
    'tools/workos_oidc_preflight.mjs',
    'docs/arch/06-security.md',
    'docs/ops/railway-staging-target.md',
  ]) {
    const selection = selectLanes({
      changed: [changed],
      manifest,
      crateGraph: FIXTURE_GRAPH,
      mode: 'inner',
    });
    for (const lane of [
      'test:workos-oidc-preflight',
      'test:production-promotion',
      'test:railway-staging-target',
    ]) {
      assert.ok(selection.laneIds.includes(lane), `${changed} must arm ${lane}`);
    }
  }
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
  // A deleted/renamed crate directory can remain present in a dirty worktree
  // with no Cargo package. The proof graph must model the actual workspace,
  // rather than treating that filesystem residue as an executable crate.
  const crateDirs = Object.keys(workspaceCrateGraph());
  const crateAreas = manifest.areas.filter((a) => a.crate).map((a) => a.crate);
  for (const crate of crateDirs) {
    assert.equal(
      crateAreas.filter((c) => c === crate).length,
      1,
      `crate ${crate} must be owned by exactly one area`,
    );
  }
});

test('specialized closure areas reference one canonical workspace crate', () => {
  const canonicalCrates = new Set(
    manifest.areas.filter((area) => area.crate).map((area) => area.crate),
  );
  for (const area of manifest.areas.filter((area) => area.closure_crate)) {
    assert.equal(
      Boolean(area.crate),
      false,
      `${area.id} must not compete with a canonical crate owner`,
    );
    assert.ok(
      canonicalCrates.has(area.closure_crate),
      `${area.id} references unknown closure crate ${area.closure_crate}`,
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
    ['api', 'commands', 'operator_api', 'operator_proof', 'projections', 'server', 'wire'],
  );

  const selection = selectLanes({
    changed: ['crates/eventstore/src/lib.rs'],
    manifest,
    crateGraph: FIXTURE_GRAPH,
  });
  const touchedIds = new Set(selection.touched.map((t) => t.id));
  for (const id of [
    'crate:eventstore',
    'crate:projections',
    'crate:commands',
    'crate:operator-proof',
    'crate:wire',
    'crate:api',
    'crate:operator_api',
    'crate:server',
  ]) {
    assert.ok(touchedIds.has(id), `expected ${id} in closure`);
  }
  assert.ok(!touchedIds.has('crate:domain'), 'dependencies (not dependents) must stay untouched');
});

test('test-target edits stay out of reverse crate closure while retaining target precision', () => {
  const cases = [
    {
      source: 'crates/domain/tests/determinism_guard.rs',
      includes: ['cargo:domain'],
    },
    {
      source: 'crates/domain/src/pack/validation_tests.rs',
      includes: ['cargo:domain'],
    },
    {
      source: 'crates/eventstore/tests/concurrency.rs',
      includes: ['cargo:eventstore'],
    },
    {
      source: 'crates/identity/tests/workos_erasure_lock_order.rs',
      includes: ['cargo:identity'],
    },
    {
      source: 'crates/projections/tests/e2e.rs',
      includes: ['cargo:projections'],
    },
    {
      source: 'crates/operator_proof/tests/boundary.rs',
      includes: ['cargo:operator-proof'],
    },
    {
      source: 'crates/wire/tests/typescript.rs',
      includes: ['cargo:wire'],
    },
    {
      source: 'crates/media/tests/variant_read_boundary.rs',
      includes: ['cargo:media'],
    },
    {
      source: 'crates/api/tests/auth_methods.rs',
      includes: ['cargo:api'],
    },
    {
      source: 'crates/operator_api/tests/operator_routes.rs',
      includes: ['cargo:operator_api'],
    },
    {
      source: 'crates/server/tests/event_key_admin_rehearsal.rs',
      includes: ['cargo:server'],
    },
    {
      source: 'crates/commands/tests/action_submission_boundary.rs',
      includes: ['cargo:commands-unit'],
    },
    {
      source: 'crates/commands/tests/runtime_cancellation.rs',
      includes: ['cargo:commands-concurrency'],
    },
    {
      source: 'crates/commands/tests/pipeline/residual_cases.rs',
      includes: ['cargo:commands-pg', 'cargo:operator-proof', 'cargo:operator_api'],
      excludes: ['cargo:commands-audit'],
    },
    {
      source: 'crates/commands/tests/semantic_audit/cases.rs',
      includes: ['cargo:commands-audit', 'cargo:operator-proof', 'cargo:operator_api'],
      excludes: ['cargo:commands-pg'],
    },
    {
      source: 'crates/commands/tests/pipeline/day_events.rs',
      includes: ['cargo:commands-pg', 'cargo:operator-proof', 'cargo:operator_api'],
      excludes: ['cargo:commands-audit'],
    },
    {
      source: 'crates/commands/tests/pipeline/residual_support.rs',
      includes: ['cargo:commands-pg', 'cargo:commands-audit'],
    },
    {
      source: 'crates/commands/tests/pipeline/common.rs',
      includes: [
        'cargo:commands-pg',
        'cargo:commands-audit',
        'cargo:commands-concurrency',
        'cargo:clippy-workspace',
      ],
    },
  ];

  for (const { source, includes, excludes = [] } of cases) {
    const selection = selectLanes({
      changed: [source],
      manifest,
      crateGraph: FIXTURE_GRAPH,
      mode: 'inner',
    });
    const closureTouches = selection.touched.filter(({ reasons }) =>
      reasons.some((reason) => reason.startsWith('crate-closure:')),
    );

    assert.deepEqual(
      closureTouches,
      [],
      `${source} is test-only and must not arm downstream crate areas`,
    );
    for (const lane of includes) {
      assert.ok(selection.laneIds.includes(lane), `${source} must arm ${lane}`);
    }
    for (const lane of excludes) {
      assert.ok(!selection.laneIds.includes(lane), `${source} must not arm ${lane}`);
    }
  }
});

test('specialized Cargo inputs retain their crate closure', () => {
  const selection = selectLanes({
    changed: ['crates/commands/Cargo.toml'],
    manifest,
    crateGraph: FIXTURE_GRAPH,
    mode: 'inner',
  });
  const touched = new Map(selection.touched.map((area) => [area.id, area.reasons]));

  for (const lane of [
    'cargo:commands-unit',
    'cargo:commands-pg',
    'cargo:commands-concurrency',
    'cargo:commands-audit',
    'cargo:operator-proof',
    'cargo:operator_api',
  ]) {
    assert.ok(selection.laneIds.includes(lane), `Cargo input must arm ${lane}`);
  }
  assert.ok(
    touched.get('crate:operator-proof')?.includes('crate-closure:commands'),
    'Cargo input must retain the true reverse Cargo closure',
  );
});

test('direct proof-tool sources select their owning proof lanes', () => {
  const cases = [
    ['tools/frontend_role_smoke_scenarios.test.mjs', 'test:frontend-contract'],
    ['tools/frontend_static_role_contract.mjs', 'test:frontend-static-role-contract'],
    [
      'tools/frontend_role_smoke.mjs',
      ['test:frontend-role-smoke', 'test:frontend-visual-regression'],
    ],
    [
      'tools/frontend_role_smoke_flows.mjs',
      ['test:frontend-role-smoke', 'test:frontend-visual-regression'],
    ],
    ['tools/frontend_route_live_contract.mjs', 'test:frontend-route-live-contract'],
    ['tools/frontend_route_state_render_contract.mjs', 'test:frontend-route-state-render'],
    ['tools/frontend_tablet_interaction_contract.mjs', 'test:frontend-tablet-interaction'],
    ['tools/frontend_role_dom_smoke.mjs', 'test:frontend-role-dom-smoke'],
    [
      'tools/frontend_visual_regression.mjs',
      ['test:frontend-role-smoke', 'test:frontend-visual-regression'],
    ],
    [
      'tools/fixtures/frontend-visual-baselines/mobile-player.json',
      ['test:frontend-role-smoke', 'test:frontend-visual-regression'],
    ],
    [
      'tools/frontend_screenshot_pixels.mjs',
      ['test:frontend-role-smoke', 'test:frontend-visual-regression'],
    ],
    ['tools/auth_invite_role_proof.mjs', 'test:auth-invite-role-proof'],
    ['tools/public_search_role_proof.mjs', 'test:public-search-role-proof'],
    [
      'tools/capacity_overload_proof.mjs',
      [
        'test:capacity-overload-contract',
        'test:public-search-staging-slo',
        'test:capacity-overload',
      ],
    ],
    [
      'tools/capacity_overload_contract.mjs',
      [
        'test:capacity-overload-contract',
        'test:public-search-staging-slo',
        'test:capacity-overload',
      ],
    ],
    ['tools/live_stack_backup_restore_drill.mjs', 'test:live-stack-backup-restore-drill'],
    ['tools/dev_test_game_backup_restore_spine.mjs', 'test:live-stack-backup-restore-drill'],
    ['tools/dev_test_game_identity_spine.mjs', 'test:auth-invite-role-proof'],
    [
      'tools/dev_test_game_spine_artifact_dependencies.mjs',
      ['test:auth-invite-role-proof', 'test:live-stack-backup-restore-drill'],
    ],
    ['tools/database_schema_contract.mjs', 'test:database-schema:static'],
    ['tools/database_schema_contract.test.mjs', 'test:database-schema:static'],
    ['tools/completeness_scorecard.mjs', 'test:completeness-scorecard'],
    ['tools/completeness_scorecard.test.mjs', 'test:completeness-scorecard'],
    [
      'tools/live_stack_readiness_contract.mjs',
      ['test:host-console-live-stack-contract', 'test:host-console-day-event-room-live-stack'],
    ],
    [
      'tools/live_stack_proof_summary.mjs',
      ['test:host-console-live-stack-contract', 'test:host-console-day-event-room-live-stack'],
    ],
    [
      'tools/railway_staging_target_contract.mjs',
      'test:railway-staging-target',
    ],
    ['tools/frontend_csp_browser_proof.mjs', 'test:frontend-csp-browser'],
  ];

  for (const [source, expectedLanes] of cases) {
    const lanes = Array.isArray(expectedLanes) ? expectedLanes : [expectedLanes];
    const selection = selectLanes({
      changed: [source],
      manifest,
      crateGraph: FIXTURE_GRAPH,
      mode: 'inner',
    });
    const directOwners = selection.touched.filter(({ reasons }) => reasons.includes(source));

    assert.equal(directOwners.length, 1, `${source} must have one direct owner`);
    const owner = manifest.areas.find((area) => area.id === directOwners[0].id);
    assert.ok(
      owner.paths.some((entry) => entry !== 'tools/' && pathMatches(source, entry)),
      `${source} must be owned by a source-specific proof area`,
    );
    for (const lane of lanes) {
      assert.ok(manifest.lanes[lane], `${source} names an undeclared lane ${lane}`);
      assert.ok(selection.laneIds.includes(lane), `${source} must arm ${lane}`);
    }
  }
});

test('public search role proof is selected from search, projections, and public-platform HTTP', () => {
  for (const source of [
    'crates/projections/src/lib.rs',
    'crates/database_schema/migrations/0001_current_schema.sql',
    'crates/api/src/public_platform_http.rs',
    'frontend/src/routes/search/+page.svelte',
    'tools/public_search_role_proof.mjs',
  ]) {
    const selection = selectLanes({
      changed: [source],
      manifest,
      crateGraph: FIXTURE_GRAPH,
    });
    assert.ok(
      selection.laneIds.includes('test:public-search-role-proof'),
      `${source} must arm public search role proof`,
    );
  }
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

test('warm-up runs the lane command itself, never a build-only stand-in', () => {
  // Regression: warming `cargo test` with `--no-run` built the test binaries but
  // left the doctest target cold, so the timed run absorbed a one-time rustdoc
  // build of the crate and its dependencies. `cargo test -p domain` measured
  // 229s against a true warm cost of 10.6s. Warm-up must run what is measured.
  for (const command of [
    'DATABASE_URL=postgres://x cargo test -p api -- --test-threads=4',
    'cargo test -p domain',
    'cargo run -p wire --bin export_types -- --check',
    'cargo clippy --workspace --all-targets --all-features -- -D warnings',
    'npm run test:frontend-contract',
  ]) {
    assert.equal(warmupCommand(command), command);
  }

  // Every manifest lane, not just the shapes spelled out above.
  for (const laneId of Object.keys(manifest.lanes)) {
    const command = laneCommand(laneId, manifest);
    assert.equal(warmupCommand(command), command, `lane ${laneId} must warm with its real command`);
  }
  // Guard the code, not the comment above `warmupCommand` that explains the bug.
  const executableSource = readFileSync(join(REPO_ROOT, 'tools', 'proof_lane_select.mjs'), 'utf8')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
  assert.ok(
    !executableSource.includes('--no-run'),
    'the build-only warm-up must not come back',
  );
});

test('direct timing paths refuse lanes that require runner-owned disposable Postgres', () => {
  const fixtureManifest = {
    lanes: {
      pg: {
        kind: 'shell',
        command: 'cargo test -p pg',
        execution: {
          class: 'postgres',
          timeout_seconds: 60,
          argv: ['cargo', 'test', '-p', 'pg'],
          resources: [{ kind: 'postgres', mode: 'lane-isolated', url_env: 'DATABASE_URL' }],
        },
      },
    },
  };
  assert.equal(usesRunnerOwnedPostgres(fixtureManifest.lanes.pg), true);
  assert.throws(() => measureLane('pg', fixtureManifest), /runner-owned disposable Postgres/);
});

test('measurement records the warm run, not the compilation before it', () => {
  const fixtureManifest = {
    lanes: { 'cargo:x': { kind: 'shell', command: 'cargo test -p x -- --test-threads=1' } },
  };
  const commands = [];
  const times = [0, 90_000, 90_000, 100_600];
  const measurement = measureLane('cargo:x', fixtureManifest, {
    log: () => {},
    spawn: (command) => {
      commands.push(command);
      return { status: 0 };
    },
    now: () => times.shift(),
  });

  assert.deepEqual(commands, [
    'cargo test -p x -- --test-threads=1',
    'cargo test -p x -- --test-threads=1',
  ]);
  assert.equal(measurement.warmup_seconds, 90);
  assert.equal(measurement.seconds, 10.6);
  assert.equal(measurement.method, 'isolated');
  assert.equal(measurement.failedPhase, null);
});

test('a failed warm-up leaves the tracked baseline untouched', () => {
  const fixtureManifest = {
    lanes: {
      good: { kind: 'shell', command: 'npm run good' },
      bad: { kind: 'shell', command: 'npm run bad' },
    },
  };
  const timings = { version: 1, lanes: { good: { seconds: 130 }, bad: { seconds: 42 } } };
  const persisted = [];
  const results = measureLanes(['good', 'bad'], fixtureManifest, {
    log: () => {},
    logError: () => {},
    spawn: (command) => ({ status: command === 'npm run bad' ? 3 : 0 }),
    now: (() => {
      const times = [0, 1_000, 1_000, 11_600, 11_600, 12_000];
      return () => times.shift();
    })(),
    timings,
    persist: (next) => persisted.push(structuredClone(next)),
  });

  assert.equal(timings.lanes.good.seconds, 10.6);
  assert.equal(timings.lanes.good.method, 'isolated');
  assert.equal(timings.lanes.bad.seconds, 42, 'failed lane keeps its previous baseline');
  assert.equal(persisted.length, 1, 'only the successful lane is persisted');
  assert.equal(results[0].previousSeconds, 130);
  assert.equal(results[1].failedPhase, 'warm');
});

test('diff-sensitive lanes are never measured by repetition', () => {
  // Repeating a lint pass with no edit between runs measures an empty run, so
  // the sweep must refuse rather than record a floor as if it were a cost.
  assert.ok(
    isDiffSensitive('cargo:clippy-workspace', manifest),
    'workspace clippy is diff-sensitive and must be annotated as such',
  );

  const fixtureManifest = {
    lanes: {
      lint: { kind: 'shell', command: 'cargo clippy', measurement: 'diff-sensitive' },
      unit: { kind: 'shell', command: 'npm run unit' },
    },
  };
  const timings = { version: 1, lanes: { lint: { seconds: 511.6 } } };
  const ran = [];
  const results = measureLanes(['lint', 'unit'], fixtureManifest, {
    log: () => {},
    logError: () => {},
    spawn: (command) => {
      ran.push(command);
      return { status: 0 };
    },
    now: (() => {
      const times = [0, 1_000, 1_000, 3_400];
      return () => times.shift();
    })(),
    timings,
    persist: () => {},
  });

  assert.deepEqual(ran, ['npm run unit', 'npm run unit'], 'the lint lane is never executed');
  assert.equal(timings.lanes.lint.seconds, 511.6, 'its baseline is left alone');
  assert.equal(results[0].skipped, 'diff-sensitive');
  assert.equal(results[1].seconds, 2.4);
});

test('a failed lane\'s duration never becomes a cost estimate', () => {
  // Regression: a `cargo:api` run that exited 101 after 64.4s was merged into the
  // selector's estimates, advertising a 269s lane as the cheapest Rust work.
  assert.equal(isCostObservation({ seconds: 64.4, status: 101 }), false);
  assert.equal(isCostObservation({ seconds: 269.2, status: 0 }), true);
  assert.equal(isCostObservation({ seconds: 0.2 }), true, 'legacy entries carry no status');

  const merged = mergeTimings(
    { version: 1, lanes: { 'cargo:api': { seconds: 269.2, status: 0 } } },
    { version: 1, lanes: { 'cargo:api': { seconds: 64.4, status: 101 } } },
  );
  assert.deepEqual(
    merged.lanes,
    { 'cargo:api': { seconds: 269.2, status: 0 } },
    'the failed observation is ignored and the measured baseline shows through',
  );

  // A lane known only from a failed run has no estimate at all, rather than a fast one.
  assert.deepEqual(
    mergeTimings({ version: 1, lanes: {} }, { version: 1, lanes: { solo: { seconds: 3, status: 9 } } }).lanes,
    {},
  );
});

test('the tracked baseline outranks runtime observations, which only fill gaps', () => {
  // Regression: a --run sweep's exhaust shadowed the measured baseline, so the
  // selector advertised test:release-topology at 6.3m when it measures 3.5s warm.
  const fixtureManifest = { lanes: { measured: {}, 'never-measured': {} } };
  const baseline = { version: 1, lanes: { measured: { seconds: 3.5, status: 0, method: 'isolated' } } };
  const runtime = {
    version: 1,
    lanes: { measured: { seconds: 376.3, status: 0 }, 'never-measured': { seconds: 91.2, status: 0 } },
  };

  const estimates = costEstimates(baseline, runtime, fixtureManifest);
  assert.equal(estimates.lanes.measured.seconds, 3.5, 'runtime must not override a measured lane');
  assert.equal(
    estimates.lanes['never-measured'].seconds,
    91.2,
    'an overstated estimate still beats no estimate for ordering',
  );

  // A deliberate --record entry carries no method, and must win just the same:
  // it was timed against a representative edit, which the sweep cannot be.
  const recorded = { version: 1, lanes: { measured: { seconds: 193.6, status: 0 } } };
  assert.equal(costEstimates(recorded, runtime, fixtureManifest).lanes.measured.seconds, 193.6);
});

test('runtime observations for lanes the manifest dropped are pruned', () => {
  // cargo:commands was split into three leaves and deleted from the manifest,
  // but its observation sat in the runtime file for weeks afterwards.
  const fixtureManifest = { lanes: { 'cargo:commands-pg': {} } };
  const runtime = {
    version: 1,
    lanes: { 'cargo:commands-pg': { seconds: 180.7 }, 'cargo:commands': { seconds: 911 } },
  };

  assert.deepEqual(pruneUnknownLanes(runtime, fixtureManifest).lanes, {
    'cargo:commands-pg': { seconds: 180.7 },
  });
  assert.ok(!('cargo:commands' in costEstimates({ version: 1, lanes: {} }, runtime, fixtureManifest).lanes));

  // Every lane in the tracked baseline must still be one the manifest declares.
  for (const laneId of Object.keys(timingBaseline.lanes)) {
    assert.ok(manifest.lanes[laneId], `baseline times unknown lane ${laneId}`);
  }
});

test('a failed runtime observation falls through to the baseline, not to nothing', () => {
  const fixtureManifest = { lanes: { 'cargo:api': {} } };
  const estimates = costEstimates(
    { version: 1, lanes: { 'cargo:api': { seconds: 127.1, status: 0, method: 'isolated' } } },
    { version: 1, lanes: { 'cargo:api': { seconds: 64.4, status: 101 } } },
    fixtureManifest,
  );
  assert.equal(estimates.lanes['cargo:api'].seconds, 127.1);
});
