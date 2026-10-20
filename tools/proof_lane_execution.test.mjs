import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { screenshotEvidencePaths } from './frontend_role_smoke_paths.mjs';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { loadManifest, REPO_ROOT } from './proof_lane_select.mjs';
import {
  PREEMPTED_EXIT_CODE,
  createRepoLocalPostgresProvider,
  createRunContext,
  defaultPreemptionSignalPath,
  disposableDatabaseName,
  expandHardDependencies,
  lockClaims,
  prepareLaneInvocation,
  readPreemptedRunReceiptPath,
  runExecutionPlan,
  summarizeLaneStates,
  validateExecutionManifest,
  validateQuarantine,
} from './proof_lane_execution.mjs';

function fixture(lanes, capacities = { cargo: 1, browser: 1 }) {
  return {
    version: 5,
    runner: { lock_capacities: capacities },
    lanes,
  };
}

function lane(argv, resources = [], extra = {}) {
  return {
    kind: 'shell',
    command: argv.join(' '),
    execution: {
      class: 'hermetic',
      timeout_seconds: 10,
      argv,
      resources,
      ...extra,
    },
  };
}

function childThatCloses(status = 0, delay = 1) {
  const child = new EventEmitter();
  child.kill = () => true;
  setTimeout(() => child.emit('close', status, null), delay);
  return child;
}

async function temporaryRoot() {
  return await mkdtemp(join(tmpdir(), 'fmarch-proof-lane-'));
}

async function waitForFileContents(path, attempts = 100) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await readFile(path, 'utf8');
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw lastError ?? new Error(`timed out waiting for ${path}`);
}

async function waitForProcessExit(pid, attempts = 100) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error?.code === 'ESRCH') return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`process ${pid} remained alive after its proof lane completed`);
}

test('hard dependencies expand once and reject missing or cyclic graphs', () => {
  const manifest = fixture({
    producer: lane(['producer']),
    consumer: { ...lane(['consumer']), depends_on: ['producer'] },
  });
  assert.deepEqual(expandHardDependencies(['consumer', 'producer'], manifest), ['producer', 'consumer']);
  assert.throws(
    () => expandHardDependencies(['consumer'], fixture({ consumer: { ...lane(['consumer']), depends_on: ['gone'] } })),
    /unknown lane gone/,
  );
  assert.throws(
    () => expandHardDependencies(['a'], fixture({ a: { ...lane(['a']), depends_on: ['b'] }, b: { ...lane(['b']), depends_on: ['a'] } })),
    /dependency cycle/,
  );
});

test('runner max_parallel is a hard opt-in ceiling', async (t) => {
  const root = await temporaryRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifest = fixture({ only: lane(['only'], []) });
  manifest.runner.max_parallel = 1;
  await assert.rejects(
    runExecutionPlan(['only'], manifest, { jobs: 2, root, log: () => {} }),
    /exceeds runner max_parallel 1/,
  );
});

test('manifest validation reserves resource-owned environment and validates the real v8 metadata', () => {
  assert.equal(validateExecutionManifest(loadManifest()), true);
  assert.throws(
    () => validateExecutionManifest(fixture({ implicit: { kind: 'npm' } })),
    /must declare execution metadata/,
  );
  assert.throws(() => createRunContext({ runId: '..' }), /proof run id/);
  assert.throws(
    () => validateExecutionManifest(fixture({
      bad: lane(['bad'], [{ kind: 'artifact-dir', env: 'FMARCH_OUTPUT' }], { env: { FMARCH_OUTPUT: 'shadowed' } }),
    })),
    /may not shadow resource-owned/,
  );
  assert.throws(
    () => validateExecutionManifest(fixture({
      bad: {
        ...lane(['bad'], [{ kind: 'postgres', mode: 'lane-isolated', url_env: 'DATABASE_URL' }]),
        command: 'DATABASE_URL=postgres://other/proof cargo test',
      },
    })),
    /hard-codes DATABASE_URL/,
  );
  assert.throws(
    () => validateExecutionManifest(fixture({ 'a:b': lane(['first']), a_b: lane(['second']) })),
    /must not collide/,
  );
  assert.throws(
    () => validateExecutionManifest(fixture({
      bad: lane(['bad'], [
        { kind: 'artifact-dir', env: 'FMARCH_SHARED_ARTIFACT' },
        { kind: 'postgres', mode: 'lane-isolated', url_env: 'FMARCH_SHARED_ARTIFACT' },
      ]),
    })),
    /resource postgres conflicts with artifact-dir/,
  );
  assert.throws(
    () => validateExecutionManifest(fixture({
      bad: lane(['bad'], [{ kind: 'artifact-dir', env: 'FMARCH_PROOF_RUN_ID' }]),
    })),
    /may not claim runner-owned FMARCH_PROOF_RUN_ID/,
  );
});

test('lane invocation has a root-contained artifact directory and injects only declared producer output', async (t) => {
  const root = await temporaryRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifest = fixture({
    producer: lane(['producer'], [{ kind: 'artifact-dir', env: 'FMARCH_PROOF_ARTIFACT_DIR' }]),
    consumer: {
      ...lane(['consumer'], [
        { kind: 'artifact-dir', env: 'FMARCH_PROOF_ARTIFACT_DIR' },
        { kind: 'artifact-input', from: 'producer', env: 'FMARCH_PRODUCER_ARTIFACT_DIR' },
      ]),
      depends_on: ['producer'],
    },
  });
  validateExecutionManifest(manifest);
  const run = createRunContext({ root, runId: 'artifact-input' });
  const producerDir = run.artifactDirectory('producer');
  await mkdir(producerDir, { recursive: true });
  const invocation = await prepareLaneInvocation({
    laneId: 'consumer',
    manifest,
    run,
    completedArtifacts: new Map([['producer', producerDir]]),
    env: { FMARCH_PROOF_ARTIFACT_DIR: '/ambient/incorrect' },
  });
  assert.match(invocation.artifactDir, /target\/proof-lanes\/runs\/artifact-input\/artifacts\/consumer$/);
  assert.equal(invocation.env.FMARCH_PROOF_ARTIFACT_DIR, invocation.artifactDir);
  assert.equal(invocation.env.FMARCH_PRODUCER_ARTIFACT_DIR, producerDir);
  assert.notEqual(invocation.env.FMARCH_PROOF_ARTIFACT_DIR, '/ambient/incorrect');
});

test('compatible lanes overlap while a shared lock serializes atomically', async (t) => {
  const root = await temporaryRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const active = new Set();
  let maximum = 0;
  const spawn = (file) => {
    const child = new EventEmitter();
    child.kill = () => true;
    active.add(file);
    maximum = Math.max(maximum, active.size);
    setTimeout(() => {
      active.delete(file);
      child.emit('close', 0, null);
    }, 12);
    return child;
  };
  const concurrent = fixture({ first: lane(['first'], []), second: lane(['second'], []) });
  const parallel = await runExecutionPlan(['first', 'second'], concurrent, { jobs: 2, root, spawn, log: () => {} });
  assert.equal(parallel.success, true);
  assert.equal(maximum, 2);

  active.clear();
  maximum = 0;
  const locked = fixture({
    first: lane(['first'], [{ kind: 'lock', name: 'cargo' }]),
    second: lane(['second'], [{ kind: 'lock', name: 'cargo' }]),
  });
  const serial = await runExecutionPlan(['first', 'second'], locked, { jobs: 2, root, runId: 'locked', spawn, log: () => {} });
  assert.equal(serial.success, true);
  assert.equal(maximum, 1);
});

test('postgres-admin serializes database create/drop while lane bodies overlap', async (t) => {
  const root = await temporaryRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const running = new Set();
  let maximumRunning = 0;
  let administering = 0;
  let maximumAdministering = 0;
  const administer = async () => {
    administering += 1;
    maximumAdministering = Math.max(maximumAdministering, administering);
    await new Promise((resolve) => setTimeout(resolve, 5));
    administering -= 1;
  };
  const provider = {
    async acquire({ laneId }) {
      await administer();
      return {
        database: `fmarch_proof_test_${laneId}`,
        url: `postgres://local/fmarch_proof_test_${laneId}`,
        async release() { await administer(); },
      };
    },
  };
  const manifest = fixture({
    first: lane(['first'], [{ kind: 'postgres', mode: 'lane-isolated', url_env: 'DATABASE_URL' }]),
    second: lane(['second'], [{ kind: 'postgres', mode: 'lane-isolated', url_env: 'DATABASE_URL' }]),
  }, { 'postgres-admin': 1 });
  const claims = {};
  const result = await runExecutionPlan(['first', 'second'], manifest, {
    jobs: 2,
    root,
    databaseProvider: provider,
    onStart(laneId, details) { claims[laneId] = details.claims; },
    spawn(file) {
      const child = new EventEmitter();
      child.kill = () => true;
      running.add(file);
      maximumRunning = Math.max(maximumRunning, running.size);
      setTimeout(() => {
        running.delete(file);
        child.emit('close', 0, null);
      }, 40);
      return child;
    },
    log: () => {},
  });
  assert.equal(result.success, true);
  assert.deepEqual(claims, { first: {}, second: {} });
  assert.equal(maximumAdministering, 1, 'create/drop must never race on the shared cluster');
  assert.equal(maximumRunning, 2, 'isolated database lanes run their bodies concurrently');
});

test('real timing lanes exclude browser work even when Cargo and browser prerequisites are reused', async (t) => {
  const root = await temporaryRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const actual = loadManifest();
  const cargo = 'cargo:event-actor';
  const themes = 'test:frontend-themes';
  const browser = 'test:frontend-role-smoke';
  const reusedLanes = new Map([cargo, themes].map((id) => [id, {
    receipt_id: 'prior-passing-run',
    proof_key: 'a'.repeat(64),
  }]));
  const databaseProvider = {
    async acquire() {
      return {
        database: 'fmarch_proof_timing_isolation',
        url: 'postgres://local/fmarch_proof_timing_isolation',
        async release() {},
      };
    },
  };

  for (const timing of ['test:capacity-overload', 'test:mash-scale-acceptance']) {
    for (const first of [browser, timing]) {
      const second = first === browser ? timing : browser;
      const active = new Set();
      const started = [];
      let maximum = 0;
      const result = await runExecutionPlan([cargo, first, second], actual, {
        root,
        runId: `${timing.replaceAll(':', '_')}-${first === browser ? 'browser-first' : 'timing-first'}`,
        jobs: 2,
        reusedLanes,
        databaseProvider,
        onStart(id) {
          active.add(id);
          maximum = Math.max(maximum, active.size);
        },
        onResult(id) { active.delete(id); },
        spawn(_file, _args, options) {
          started.push(options.env.FMARCH_PROOF_LANE_ID);
          return childThatCloses(0, 25);
        },
        log() {},
      });
      assert.equal(result.success, true);
      assert.deepEqual(started, [first, second]);
      assert.equal(maximum, 1, `${timing} must not overlap ${browser} in either queue order`);
      for (const id of [cargo, themes]) {
        assert.equal(result.receipt.lanes[id].reused_from_receipt, 'prior-passing-run');
      }
    }
  }
});

test('cross-run locks serialize the same mutable resource across runner processes', async (t) => {
  const root = await temporaryRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  let active = 0;
  let maximum = 0;
  const manifest = fixture({ only: lane(['only'], [{ kind: 'lock', name: 'cargo' }]) });
  const spawn = () => {
    const child = new EventEmitter();
    child.kill = () => true;
    active += 1;
    maximum = Math.max(maximum, active);
    setTimeout(() => {
      active -= 1;
      child.emit('close', 0, null);
    }, 20);
    return child;
  };
  const [first, second] = await Promise.all([
    runExecutionPlan(['only'], manifest, { root, runId: 'first-run', spawn, log: () => {} }),
    runExecutionPlan(['only'], manifest, { root, runId: 'second-run', spawn, log: () => {} }),
  ]);
  assert.equal(first.success, true);
  assert.equal(second.success, true);
  assert.equal(maximum, 1);
});

test('a failed prerequisite blocks its consumer while an already started independent lane is recorded', async (t) => {
  const root = await temporaryRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const started = [];
  const manifest = fixture({
    producer: lane(['producer'], []),
    consumer: { ...lane(['consumer'], []), depends_on: ['producer'] },
    independent: lane(['independent'], []),
  });
  const result = await runExecutionPlan(['consumer', 'independent'], manifest, {
    jobs: 2,
    root,
    spawn(file) {
      started.push(file);
      return childThatCloses(file === 'producer' ? 1 : 0, 5);
    },
    log: () => {},
  });
  assert.equal(result.success, false);
  assert.deepEqual(started.sort(), ['independent', 'producer']);
  assert.equal(result.receipt.lanes.consumer.state, 'blocked');
  assert.equal(result.receipt.lanes.independent.state, 'passed');
  const { timing } = result.receipt.lanes.independent;
  assert.deepEqual(Object.keys(timing), [
    'build_execution_seconds', 'run_lock_wait_seconds',
    'resource_setup_seconds', 'command_execution_seconds', 'cleanup_seconds',
  ]);
  // A lane without prebuild has only a run phase.
  assert.equal(timing.build_execution_seconds, null);
  assert.equal(timing.run_lock_wait_seconds, null);
  assert.equal(result.receipt.lanes.independent.phases, null);
  assert.ok(
    [timing.resource_setup_seconds, timing.command_execution_seconds, timing.cleanup_seconds]
      .every((seconds) => Number.isFinite(seconds) && seconds >= 0),
  );
  const receipt = JSON.parse(await readFile(result.run.receiptPath, 'utf8'));
  assert.equal(receipt.schema, 4);
  assert.equal(receipt.state, 'failed');
});

test('resumed execution records inherited successes without spawning them again', async (t) => {
  const root = await temporaryRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifest = fixture({
    inherited: lane(['inherited'], []),
    retry: lane(['retry'], []),
  });
  const started = [];
  const result = await runExecutionPlan(['inherited', 'retry'], manifest, {
    root,
    reusedLanes: new Map([[
      'inherited',
      {
        receipt_id: 'prior-run',
        seconds: 1.5,
        started_at: '2026-08-27T00:00:00.000Z',
        finished_at: '2026-08-27T00:00:01.500Z',
      },
    ]]),
    spawn(file) {
      started.push(file);
      return childThatCloses(0);
    },
    log: () => {},
  });
  assert.equal(result.success, true);
  assert.deepEqual(started, ['retry']);
  assert.equal(result.receipt.lanes.inherited.state, 'passed');
  assert.equal(result.receipt.lanes.inherited.reused_from_receipt, 'prior-run');
});

test('content-addressed reuse materializes producer artifacts into the new run', async (t) => {
  const root = await temporaryRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const cachedArtifacts = join(root, 'target', 'proof-lanes', 'cache', 'producer', 'key', 'artifacts');
  await mkdir(cachedArtifacts, { recursive: true });
  const sourceRoot = 'target/proof-lanes/runs/original/artifacts/producer';
  const receiptBytes = JSON.stringify({ status: 'passed', artifactRoot: sourceRoot, board: [{ screenshot: `${sourceRoot}/mobile-board-player.png` }] }) + '\n';
  await writeFile(join(cachedArtifacts, 'role-smoke.json'), receiptBytes);
  await writeFile(join(cachedArtifacts, 'mobile-board-player.png'), 'immutable screenshot fixture');
  const manifest = fixture({
    producer: lane(
      ['producer'],
      [{ kind: 'artifact-dir', env: 'FMARCH_PROOF_ARTIFACT_DIR' }],
    ),
    consumer: {
      ...lane(
        ['consumer'],
        [{ kind: 'artifact-input', from: 'producer', env: 'PRODUCER_ARTIFACTS' }],
      ),
      depends_on: ['producer'],
    },
  });
  let producerArtifacts;
  const result = await runExecutionPlan(['producer', 'consumer'], manifest, {
    root,
    reusedLanes: new Map([['producer', {
      receipt_id: 'cached-run',
      proof_key: 'a'.repeat(64),
      artifact_source_dir: cachedArtifacts,
    }]]),
    spawn(_file, _args, options) {
      producerArtifacts = options.env.PRODUCER_ARTIFACTS;
      const evidence = JSON.parse(readFileSync(join(producerArtifacts, 'role-smoke.json'), 'utf8'));
      const declared = screenshotEvidencePaths(evidence, { artifactDir: producerArtifacts });
      assert.ok(declared.has(join(producerArtifacts, 'mobile-board-player.png')));
      assert.equal(readFileSync([...declared][0], 'utf8'), 'immutable screenshot fixture');
      return childThatCloses(0);
    },
    log: () => {},
  });
  assert.equal(result.success, true);
  assert.notEqual(producerArtifacts, cachedArtifacts);
  assert.match(producerArtifacts, /runs\/.*\/artifacts\/producer$/);
  assert.equal(await readFile(join(producerArtifacts, 'role-smoke.json'), 'utf8'), receiptBytes);
  assert.equal(await readFile(join(cachedArtifacts, 'role-smoke.json'), 'utf8'), receiptBytes);
  assert.equal(result.receipt.lanes.producer.reused_from_proof_key, 'a'.repeat(64));
  assert.equal(result.receipt.lanes.producer.artifact_dir, producerArtifacts);
});

test('a resource cleanup failure finalizes the receipt and blocks later work', async (t) => {
  const root = await temporaryRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const provider = {
    async acquire() {
      return {
        database: 'fmarch_proof_cleanup_failure',
        url: 'postgres://local/fmarch_proof_cleanup_failure',
        async release() { throw new Error('intentional database cleanup failure'); },
      };
    },
  };
  const manifest = fixture({
    producer: lane(['producer'], [{ kind: 'postgres', mode: 'lane-isolated', url_env: 'DATABASE_URL' }]),
    consumer: { ...lane(['consumer'], []), depends_on: ['producer'] },
  }, { 'postgres-admin': 1 });
  const result = await runExecutionPlan(['consumer'], manifest, {
    root,
    databaseProvider: provider,
    spawn: () => childThatCloses(0),
    log: () => {},
  });
  assert.equal(result.success, false);
  assert.equal(result.receipt.state, 'failed');
  assert.equal(result.receipt.lanes.producer.state, 'failed');
  assert.equal(result.receipt.lanes.consumer.state, 'blocked');
  const receipt = JSON.parse(await readFile(result.run.receiptPath, 'utf8'));
  assert.equal(receipt.state, 'failed');
  assert.match(receipt.lanes.producer.spawn_error, /cleanup failure/);
  assert.equal(receipt.lanes.producer.database_retained, true);
  assert.match(receipt.lanes.producer.cleanup_error, /cleanup failure/);
});

test('cleanup is abortable, deadline-bounded, and retains an uncertain disposable database', async (t) => {
  const root = await temporaryRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  let releaseSignal;
  const provider = {
    async acquire() {
      return {
        database: 'fmarch_proof_cleanup_timeout',
        url: 'postgres://local/fmarch_proof_cleanup_timeout',
        async release({ signal }) {
          releaseSignal = signal;
          return await new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          });
        },
      };
    },
  };
  const manifest = fixture({
    cleanup: lane(['cleanup'], [{ kind: 'postgres', mode: 'lane-isolated', url_env: 'DATABASE_URL' }]),
  }, { 'postgres-admin': 1 });
  const result = await runExecutionPlan(['cleanup'], manifest, {
    root,
    databaseProvider: provider,
    cleanupTimeoutMs: 15,
    spawn: () => childThatCloses(0),
    log: () => {},
  });
  assert.equal(result.success, false);
  assert.equal(releaseSignal.aborted, true);
  assert.equal(result.receipt.lanes.cleanup.state, 'failed');
  assert.equal(result.receipt.lanes.cleanup.database_retained, true);
  assert.match(result.receipt.lanes.cleanup.cleanup_error, /cleanup timed out/);
  const receipt = JSON.parse(await readFile(result.run.receiptPath, 'utf8'));
  assert.equal(receipt.lanes.cleanup.database_retained, true);
  assert.match(receipt.lanes.cleanup.cleanup_error, /cleanup timed out/);
});

test('the lane deadline aborts a stalled resource provision before it can hold locks forever', async (t) => {
  const root = await temporaryRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const provider = {
    async acquire({ signal }) {
      return await new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    },
  };
  const manifest = fixture({
    stalled: lane(['stalled'], [{ kind: 'postgres', mode: 'lane-isolated', url_env: 'DATABASE_URL' }], { timeout_seconds: 1 }),
  }, { 'postgres-admin': 1 });
  const result = await runExecutionPlan(['stalled'], manifest, {
    root,
    databaseProvider: provider,
    spawn: () => { throw new Error('a timed-out preparation must not spawn a child'); },
    log: () => {},
  });
  assert.equal(result.success, false);
  assert.equal(result.receipt.lanes.stalled.timed_out, true);
  assert.match(result.receipt.lanes.stalled.spawn_error, /preparation timed out/);
  const receipt = JSON.parse(await readFile(result.run.receiptPath, 'utf8'));
  assert.equal(receipt.state, 'failed');
});

test('external interruption during preparation is recorded as interruption, not a timeout', async (t) => {
  const root = await temporaryRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const signalSource = new EventEmitter();
  let provisionStarted;
  const started = new Promise((resolve) => { provisionStarted = resolve; });
  const provider = {
    async acquire({ signal }) {
      provisionStarted();
      return await new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    },
  };
  const manifest = fixture({
    preparing: lane(['preparing'], [{ kind: 'postgres', mode: 'lane-isolated', url_env: 'DATABASE_URL' }]),
  }, { 'postgres-admin': 1 });
  const resultPromise = runExecutionPlan(['preparing'], manifest, {
    root,
    databaseProvider: provider,
    signalSource,
    spawn: () => { throw new Error('an interrupted preparation must not spawn a child'); },
    log: () => {},
  });
  await started;
  signalSource.emit('SIGINT');
  const result = await resultPromise;
  assert.equal(result.success, false);
  assert.equal(result.receipt.lanes.preparing.timed_out, false);
  assert.equal(result.receipt.lanes.preparing.interrupted_by, 'SIGINT');
  assert.match(result.receipt.lanes.preparing.spawn_error, /interrupted by SIGINT/);
});

test('a signal during final receipt persistence cannot return a successful proof', async (t) => {
  const root = await temporaryRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const signalSource = new EventEmitter();
  let injected = false;
  const result = await runExecutionPlan(['only'], fixture({ only: lane(['only'], []) }), {
    root,
    signalSource,
    spawn: () => childThatCloses(0),
    persistReceipt: async (_path, receipt) => {
      if (receipt.state === 'passed' && !injected) {
        injected = true;
        signalSource.emit('SIGTERM');
      }
    },
    log: () => {},
  });
  assert.equal(injected, true);
  assert.equal(result.success, false);
  assert.equal(result.receipt.state, 'failed');
  assert.equal(result.receipt.interrupted_by, 'SIGTERM');
});

test('a lane timeout records the signal and preserves its diagnostic receipt', async (t) => {
  const root = await temporaryRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  let fireTimeout;
  const signals = [];
  let spawnOptions;
  let startedResolve;
  const started = new Promise((resolve) => { startedResolve = resolve; });
  const resultPromise = runExecutionPlan(['slow'], fixture({ slow: lane(['slow'], []) }), {
    root,
    spawn(...args) {
      spawnOptions = args[2];
      const child = new EventEmitter();
      child.kill = (signal) => {
        signals.push(signal);
        if (signal === 'SIGTERM') queueMicrotask(() => child.emit('close', null, 'SIGTERM'));
        return true;
      };
      startedResolve();
      return child;
    },
    setTimeoutFn(callback) {
      fireTimeout ??= callback;
      return 1;
    },
    clearTimeoutFn() {},
    log: () => {},
  });
  await started;
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(fireTimeout, 'runner must arm a timeout for the child process');
  assert.equal(spawnOptions.detached, process.platform !== 'win32');
  fireTimeout();
  const result = await resultPromise;
  assert.equal(result.success, false);
  assert.deepEqual(signals, ['SIGTERM']);
  assert.equal(result.receipt.lanes.slow.timed_out, true);
  assert.equal(result.receipt.lanes.slow.signal, 'SIGTERM');
  assert.equal(result.receipt.lanes.slow.artifact_dir.includes('artifacts/slow'), true);
});

test('external interruption drains a SIGTERM-ignoring POSIX child through SIGKILL', async (t) => {
  if (process.platform === 'win32') t.skip('POSIX process groups are not available on Windows');
  const root = await temporaryRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const pidPath = join(root, 'stubborn.pid');
  let childPid;
  t.after(() => {
    if (!childPid) return;
    try { process.kill(childPid, 'SIGKILL'); } catch {}
  });
  const source = new EventEmitter();
  const script = [
    "const fs = require('node:fs');",
    "process.on('SIGTERM', () => {});",
    `fs.writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));`,
    'setInterval(() => {}, 1_000);',
  ].join(' ');
  const manifest = fixture({
    stubborn: lane([process.execPath, '-e', script], [], { timeout_seconds: 10 }),
  });
  const resultPromise = runExecutionPlan(['stubborn'], manifest, {
    root,
    signalSource: source,
    terminationGraceMilliseconds: 15,
    log: () => {},
  });
  childPid = Number((await waitForFileContents(pidPath)).trim());
  source.emit('SIGTERM');
  const result = await resultPromise;
  assert.equal(result.success, false);
  assert.equal(result.receipt.lanes.stubborn.interrupted_by, 'SIGTERM');
  assert.equal(result.receipt.lanes.stubborn.timed_out, false);
  assert.equal(result.receipt.lanes.stubborn.signal, 'SIGKILL');
  await waitForProcessExit(childPid);
});

test('a successful shell leader cannot leave a live child group and still pass', async (t) => {
  if (process.platform === 'win32') t.skip('POSIX process groups are not available on Windows');
  const root = await temporaryRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const pidPath = join(root, 'orphan.pid');
  let backgroundPid;
  t.after(() => {
    if (!backgroundPid) return;
    try { process.kill(backgroundPid, 'SIGKILL'); } catch {}
  });
  const manifest = fixture({
    shell: lane(['/bin/sh', '-c', `sleep 30 & echo $! > ${pidPath}; exit 0`], [], { timeout_seconds: 10 }),
  });
  const result = await runExecutionPlan(['shell'], manifest, { root, log: () => {} });
  backgroundPid = Number((await readFile(pidPath, 'utf8')).trim());
  assert.equal(result.success, false);
  assert.equal(result.receipt.lanes.shell.group_terminated_after_leader_exit, true);
  assert.match(result.receipt.lanes.shell.spawn_error, /outlived/);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.throws(() => process.kill(backgroundPid, 0), { code: 'ESRCH' });
});

test('a timeout terminates the POSIX child process group before releasing the lane', async (t) => {
  if (process.platform === 'win32') t.skip('POSIX process groups are not available on Windows');
  const root = await temporaryRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const pidPath = join(root, 'background.pid');
  let backgroundPid;
  t.after(() => {
    if (!backgroundPid) return;
    try { process.kill(backgroundPid, 'SIGKILL'); } catch {}
  });
  const manifest = fixture({
    shell: lane(['/bin/sh', '-c', `sleep 30 & echo $! > ${pidPath}; wait`], [], { timeout_seconds: 1 }),
  });
  const result = await runExecutionPlan(['shell'], manifest, { root, log: () => {} });
  backgroundPid = Number((await readFile(pidPath, 'utf8')).trim());
  assert.equal(result.success, false);
  assert.equal(result.receipt.lanes.shell.timed_out, true);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.throws(() => process.kill(backgroundPid, 0), { code: 'ESRCH' });
});

test('runner-owned Postgres overrides ambient URLs and releases successful disposable databases', async (t) => {
  const root = await temporaryRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const acquired = [];
  const released = [];
  const provider = {
    async acquire({ laneId }) {
      const database = `fmarch_proof_run_${laneId}`;
      acquired.push(database);
      return {
        database,
        url: `postgres://local/${database}`,
        retained: false,
        async release({ success }) { released.push({ database, success }); },
      };
    },
  };
  const manifest = fixture({
    pg: lane(['pg'], [{ kind: 'postgres', mode: 'lane-isolated', url_env: 'DATABASE_URL' }]),
  });
  const run = createRunContext({ root, runId: 'database-env' });
  const invocation = await prepareLaneInvocation({
    laneId: 'pg',
    manifest,
    run,
    env: { DATABASE_URL: 'postgres://ambient/wrong' },
    databaseProvider: provider,
  });
  assert.equal(invocation.env.DATABASE_URL, 'postgres://local/fmarch_proof_run_pg');
  await invocation.releaseResources({ success: true });
  assert.deepEqual(acquired, ['fmarch_proof_run_pg']);
  assert.deepEqual(released, [{ database: 'fmarch_proof_run_pg', success: true }]);
});

test('disposable database names retain distinct full Postgres resource identities', () => {
  const run = { id: 'same-run' };
  const first = disposableDatabaseName(run, 'backup:restore', {
    kind: 'postgres', mode: 'lane-isolated', url_env: 'DATABASE_RESTORE_ONE_URL',
  });
  const second = disposableDatabaseName(run, 'backup:restore', {
    kind: 'postgres', mode: 'lane-isolated', url_env: 'DATABASE_RESTORE_TWO_URL',
  });

  // Both names alias under the old readable-prefix-only scheme.
  assert.notEqual(first, second);
  assert.match(first, /^fmarch_proof_[a-z0-9_]{1,48}$/);
  assert.match(second, /^fmarch_proof_[a-z0-9_]{1,48}$/);
});

test('mutable proof leaves bind real runner-owned databases and artifact roots without legacy serialization', async (t) => {
  const root = await temporaryRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifest = loadManifest();
  validateExecutionManifest(manifest);
  const acquired = [];
  const released = [];
  const provider = {
    async acquire({ laneId, resource }) {
      const database = `fmarch_proof_real_${laneId.replaceAll(':', '_')}_${resource.url_env.toLowerCase()}`;
      acquired.push({ laneId, urlEnv: resource.url_env, database });
      return {
        database,
        url: `postgres://local/${database}`,
        retained: false,
        async release({ success }) { released.push({ database, success }); },
      };
    },
  };
  const run = createRunContext({ root, runId: 'real-mutable-leaves' });
  for (const [laneId, databaseEnvironments] of [
    ['test:auth-invite-role-proof', ['DATABASE_MIGRATION_URL']],
    ['test:host-console-day-event-room-live-stack', ['DATABASE_MIGRATION_URL']],
    ['test:live-stack-backup-restore-drill', ['DATABASE_MIGRATION_URL', 'DATABASE_RESTORE_MIGRATION_URL']],
    ['test:mash-scale-acceptance', ['DATABASE_MIGRATION_URL']],
  ]) {
    const lane = manifest.lanes[laneId];
    assert.ok(
      !lane.execution.resources.some((resource) => resource.kind === 'lock' && resource.name === 'legacy'),
      `${laneId} must not retain the legacy lock`,
    );
    assert.ok(
      lane.execution.resources.some((resource) => resource.kind === 'lock' && resource.name === 'cargo-target'),
      `${laneId} must serialize its Cargo build access`,
    );
    const invocation = await prepareLaneInvocation({
      laneId,
      manifest,
      run,
      env: Object.fromEntries(
        databaseEnvironments.map((databaseEnvironment) => [databaseEnvironment, 'postgres://ambient/wrong']),
      ),
      databaseProvider: provider,
    });
    assert.equal(invocation.database, invocation.databases[0].lease);
    assert.deepEqual(
      invocation.databases.map(({ urlEnv }) => urlEnv),
      databaseEnvironments,
      `${laneId} must preserve every declared database lease`,
    );
    for (const { urlEnv, lease } of invocation.databases) {
      assert.equal(invocation.env[urlEnv], `postgres://local/${lease.database}`);
    }
    assert.equal(
      new Set(invocation.databases.map(({ lease }) => lease.database)).size,
      databaseEnvironments.length,
      `${laneId} must not alias distinct database resources`,
    );
    assert.equal(invocation.env.FMARCH_PROOF_ARTIFACT_DIR, invocation.artifactDir);
    await invocation.releaseResources({ success: true });
  }

  const exactImage = manifest.lanes['test:exact-image-content'];
  assert.deepEqual(exactImage.execution.resources, [
    { kind: 'artifact-dir', env: 'FMARCH_PROOF_ARTIFACT_DIR' },
  ]);
  const exactInvocation = await prepareLaneInvocation({
    laneId: 'test:exact-image-content',
    manifest,
    run,
    env: { FMARCH_PROOF_ARTIFACT_DIR: '/ambient/incorrect' },
  });
  assert.equal(exactInvocation.env.FMARCH_PROOF_ARTIFACT_DIR, exactInvocation.artifactDir);
  assert.equal(acquired.length, 5);
  assert.equal(released.length, 5);
});

test('a multi-database lane provisions under one postgres-admin admission and records every lease', async (t) => {
  const root = await temporaryRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const acquired = [];
  const provider = {
    async acquire({ resource }) {
      const database = `fmarch_proof_pair_${resource.url_env.toLowerCase()}`;
      acquired.push(database);
      return {
        database,
        url: `postgres://local/${database}`,
        retained: false,
        async release() {},
      };
    },
  };
  const manifest = fixture({
    backup: lane(['backup'], [
      { kind: 'postgres', mode: 'lane-isolated', url_env: 'DATABASE_MIGRATION_URL' },
      { kind: 'postgres', mode: 'lane-isolated', url_env: 'DATABASE_RESTORE_MIGRATION_URL' },
    ]),
  }, { 'postgres-admin': 1 });
  let claims;
  const result = await runExecutionPlan(['backup'], manifest, {
    root,
    databaseProvider: provider,
    spawn: () => childThatCloses(0),
    onStart(_laneId, details) { claims = details.claims; },
    log: () => {},
  });
  assert.equal(result.success, true);
  // postgres-admin is scoped to provisioning, never a lane-long claim.
  assert.deepEqual(claims, {});
  assert.deepEqual(acquired, [
    'fmarch_proof_pair_database_migration_url',
    'fmarch_proof_pair_database_restore_migration_url',
  ]);
  assert.deepEqual(result.receipt.lanes.backup.databases, [
    {
      url_env: 'DATABASE_MIGRATION_URL',
      database: 'fmarch_proof_pair_database_migration_url',
      retained: false,
    },
    {
      url_env: 'DATABASE_RESTORE_MIGRATION_URL',
      database: 'fmarch_proof_pair_database_restore_migration_url',
      retained: false,
    },
  ]);
});

test('runner-owned Postgres rejects a non-loopback dev-postgres override before provisioning', async (t) => {
  const root = await temporaryRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const provider = createRepoLocalPostgresProvider({ env: { FMARCH_DEV_POSTGRES_HOST: 'postgres.example.test' } });
  await assert.rejects(
    provider.acquire({
      run: createRunContext({ root, runId: 'remote-postgres' }),
      laneId: 'pg',
      resource: { kind: 'postgres', mode: 'lane-isolated', url_env: 'DATABASE_URL' },
    }),
    /loopback/,
  );
});

test('the real visual lane declares a hard producer dependency and runner-scoped handoff', async () => {
  const manifest = loadManifest();
  const visual = manifest.lanes['test:frontend-visual-regression'];
  assert.deepEqual(visual.depends_on, ['test:frontend-role-smoke']);
  assert.deepEqual(expandHardDependencies(['test:frontend-visual-regression'], manifest), [
    'test:frontend-themes',
    'test:frontend-role-smoke',
    'test:frontend-visual-regression',
  ]);
  assert.ok(visual.execution.resources.some((resource) => resource.kind === 'artifact-input' && resource.from === 'test:frontend-role-smoke'));
  const roleSource = await readFile(new URL('./frontend_role_smoke.mjs', import.meta.url), 'utf8');
  const visualSource = await readFile(new URL('./frontend_visual_regression.mjs', import.meta.url), 'utf8');
  const staticSource = await readFile(new URL('./frontend_static_role_contract.mjs', import.meta.url), 'utf8');
  const routeLiveSource = await readFile(new URL('./frontend_route_live_contract.mjs', import.meta.url), 'utf8');
  const routeStateSource = await readFile(new URL('./frontend_route_state_render_contract.mjs', import.meta.url), 'utf8');
  assert.match(roleSource, /FMARCH_PROOF_ARTIFACT_DIR/);
  assert.match(visualSource, /FMARCH_ROLE_SMOKE_ARTIFACT_DIR/);
  assert.match(visualSource, /FMARCH_PROOF_ARTIFACT_DIR/);
  for (const source of [staticSource, routeLiveSource, routeStateSource]) {
    assert.match(source, /FMARCH_PROOF_ARTIFACT_DIR/);
  }
});

test('keep-going runs every dependency-satisfied lane and blocks none on an unrelated failure', async (t) => {
  const root = await temporaryRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifest = fixture({
    failA: lane(['failA'], []),
    failB: lane(['failB'], []),
    ok: lane(['ok'], []),
  });
  const result = await runExecutionPlan(['failA', 'failB', 'ok'], manifest, {
    jobs: 1,
    root,
    keepGoing: true,
    spawn: (file) => childThatCloses(file === 'ok' ? 0 : 1, 3),
    log: () => {},
  });
  assert.equal(result.success, false);
  assert.equal(result.receipt.lanes.failA.state, 'failed');
  assert.equal(result.receipt.lanes.failB.state, 'failed');
  assert.equal(result.receipt.lanes.ok.state, 'passed');
  assert.ok(!Object.values(result.receipt.lanes).some((laneRecord) => laneRecord.state === 'blocked'));
});

test('without keep-going an unrelated failure blanket-blocks the remaining pending lanes', async (t) => {
  const root = await temporaryRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifest = fixture({
    failA: lane(['failA'], []),
    failB: lane(['failB'], []),
    ok: lane(['ok'], []),
  });
  const result = await runExecutionPlan(['failA', 'failB', 'ok'], manifest, {
    jobs: 1,
    root,
    spawn: (file) => childThatCloses(file === 'failA' ? 1 : 0, 3),
    log: () => {},
  });
  assert.equal(result.success, false);
  assert.equal(result.receipt.lanes.failA.state, 'failed');
  const blocked = Object.values(result.receipt.lanes).filter((laneRecord) => laneRecord.state === 'blocked').length;
  assert.equal(blocked, 2);
});

test('a skipped lane never runs, never passes, and blocks its dependents without gating unrelated work', async (t) => {
  const root = await temporaryRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const started = [];
  const manifest = fixture({
    skipme: lane(['skipme'], []),
    dependent: { ...lane(['dependent'], []), depends_on: ['skipme'] },
    other: lane(['other'], []),
  });
  const result = await runExecutionPlan(['skipme', 'dependent', 'other'], manifest, {
    jobs: 2,
    root,
    skippedLaneIds: new Set(['skipme']),
    spawn: (file) => { started.push(file); return childThatCloses(0, 3); },
    log: () => {},
  });
  assert.equal(result.receipt.lanes.skipme.state, 'skipped');
  assert.notEqual(result.receipt.lanes.skipme.state, 'passed');
  assert.ok(!started.includes('skipme'));
  assert.equal(result.receipt.lanes.dependent.state, 'blocked');
  assert.equal(result.receipt.lanes.other.state, 'passed');
  assert.equal(result.success, true);
});

test('a quarantined lane failure is recorded distinctly and does not gate the run', async (t) => {
  const root = await temporaryRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifest = fixture({ known_red: lane(['known_red'], []), healthy: lane(['healthy'], []) });
  const result = await runExecutionPlan(['known_red', 'healthy'], manifest, {
    jobs: 2,
    root,
    quarantinedLaneIds: new Set(['known_red']),
    spawn: (file) => childThatCloses(file === 'known_red' ? 1 : 0, 3),
    log: () => {},
  });
  assert.equal(result.receipt.lanes.known_red.state, 'quarantined');
  assert.equal(result.receipt.lanes.healthy.state, 'passed');
  assert.equal(result.success, true);
  assert.equal(result.receipt.state, 'passed');
});

test('a genuine failure still gates even when another lane is quarantined', async (t) => {
  const root = await temporaryRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifest = fixture({ known_red: lane(['known_red'], []), real_red: lane(['real_red'], []) });
  const result = await runExecutionPlan(['known_red', 'real_red'], manifest, {
    jobs: 2,
    root,
    keepGoing: true,
    quarantinedLaneIds: new Set(['known_red']),
    spawn: () => childThatCloses(1, 3),
    log: () => {},
  });
  assert.equal(result.receipt.lanes.known_red.state, 'quarantined');
  assert.equal(result.receipt.lanes.real_red.state, 'failed');
  assert.equal(result.success, false);
  assert.equal(result.receipt.state, 'failed');
});

test('a preemption marker records the in-flight lane as preempted rather than a red', async (t) => {
  const root = await temporaryRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const signalSource = new EventEmitter();
  const preemptionSignalPath = join(root, 'preemption-signal.json');
  let startedResolve;
  const started = new Promise((resolve) => { startedResolve = resolve; });
  const resultPromise = runExecutionPlan(['slow'], fixture({ slow: lane(['slow'], []) }), {
    root,
    signalSource,
    preemptionSignalPath,
    spawn() {
      const child = new EventEmitter();
      child.kill = (sig) => { queueMicrotask(() => child.emit('close', null, sig)); return true; };
      startedResolve();
      return child;
    },
    log: () => {},
  });
  await started;
  await writeFile(preemptionSignalPath, JSON.stringify({ pid: process.pid, competitors: ['pid=999 cargo build'], at: Date.now() }));
  signalSource.emit('SIGTERM');
  const result = await resultPromise;
  assert.equal(result.success, false);
  assert.equal(result.preempted, true);
  assert.equal(result.receipt.lanes.slow.state, 'preempted');
  assert.equal(result.receipt.state, 'preempted');
  assert.deepEqual(result.receipt.preempted_by, ['pid=999 cargo build']);
});

test('an interruption without a preemption marker stays an ordinary red, not a preemption', async (t) => {
  const root = await temporaryRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const signalSource = new EventEmitter();
  let startedResolve;
  const started = new Promise((resolve) => { startedResolve = resolve; });
  const resultPromise = runExecutionPlan(['slow'], fixture({ slow: lane(['slow'], []) }), {
    root,
    signalSource,
    preemptionSignalPath: join(root, 'absent-marker.json'),
    spawn() {
      const child = new EventEmitter();
      child.kill = (sig) => { queueMicrotask(() => child.emit('close', null, sig)); return true; };
      startedResolve();
      return child;
    },
    log: () => {},
  });
  await started;
  signalSource.emit('SIGTERM');
  const result = await resultPromise;
  assert.equal(result.preempted, false);
  assert.equal(result.receipt.lanes.slow.state, 'failed');
  assert.equal(result.receipt.lanes.slow.interrupted_by, 'SIGTERM');
});

test('quarantine shape validation requires a known lane, owner, reason, ISO expiry, and no duplicates', () => {
  const base = fixture({ a: lane(['a']), b: lane(['b']) });
  assert.equal(validateQuarantine(base), true);
  assert.equal(
    validateExecutionManifest({ ...base, quarantine: [{ lane: 'a', owner: '@x', reason: 'known red', expires: '2026-10-16' }] }),
    true,
  );
  assert.throws(() => validateQuarantine({ ...base, quarantine: 'nope' }), /must be an array/);
  assert.throws(() => validateQuarantine({ ...base, quarantine: [{ lane: 'gone', owner: '@x', reason: 'r', expires: '2026-10-16' }] }), /unknown lane gone/);
  assert.throws(() => validateQuarantine({ ...base, quarantine: [{ lane: 'a', owner: '', reason: 'r', expires: '2026-10-16' }] }), /non-empty owner/);
  assert.throws(() => validateQuarantine({ ...base, quarantine: [{ lane: 'a', owner: '@x', reason: '', expires: '2026-10-16' }] }), /non-empty reason/);
  assert.throws(() => validateQuarantine({ ...base, quarantine: [{ lane: 'a', owner: '@x', reason: 'r', expires: 'soon' }] }), /YYYY-MM-DD/);
  assert.throws(
    () => validateQuarantine({
      ...base,
      quarantine: [
        { lane: 'a', owner: '@x', reason: 'r', expires: '2026-10-16' },
        { lane: 'a', owner: '@y', reason: 'r2', expires: '2026-11-01' },
      ],
    }),
    /more than once/,
  );
});

test('the host build lock and executor agree on the preemption exit code', async () => {
  assert.equal(PREEMPTED_EXIT_CODE, 69);
  const lockScript = await readFile(new URL('../scripts/with-heavy-build-lock.py', import.meta.url), 'utf8');
  assert.match(lockScript, /PREEMPTED_EXIT_CODE = 69/);
  assert.match(lockScript, /write_preemption_signal\(process\.pid, competitors\)/);
});

test('a run whose quarantined lane strands a dependent reports the dependent as unproven', async (t) => {
  const root = await temporaryRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifest = fixture({
    known_red: lane(['known_red'], []),
    dependent: { ...lane(['dependent'], []), depends_on: ['known_red'] },
    healthy: lane(['healthy'], []),
  });
  const result = await runExecutionPlan(['known_red', 'dependent', 'healthy'], manifest, {
    jobs: 1,
    root,
    keepGoing: true,
    quarantinedLaneIds: new Set(['known_red']),
    spawn: (file) => childThatCloses(file === 'known_red' ? 1 : 0, 3),
    log: () => {},
  });
  assert.equal(result.receipt.lanes.dependent.state, 'blocked');
  assert.equal(result.receipt.lanes.dependent.blocked_by, 'known_red');
  const summary = summarizeLaneStates(result.receipt);
  assert.equal(summary.total, 3);
  assert.equal(summary.passed, 1);
  assert.deepEqual({ ...summary.counts }, { quarantined: 1, blocked: 1, passed: 1 });
  assert.deepEqual(summary.unproven, [
    { laneId: 'known_red', state: 'quarantined', blockedBy: null },
    { laneId: 'dependent', state: 'blocked', blockedBy: 'known_red' },
  ]);
});

test('quarantine absorbs a plain assertion red but never an infrastructure failure', async (t) => {
  const root = await temporaryRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifest = fixture({ known_red: lane(['known_red'], []) });
  const timedOut = await runExecutionPlan(['known_red'], manifest, {
    root,
    quarantinedLaneIds: new Set(['known_red']),
    spawn: () => {
      const child = new EventEmitter();
      child.kill = (signal) => { queueMicrotask(() => child.emit('close', null, signal ?? 'SIGKILL')); return true; };
      return child;
    },
    terminationGraceMilliseconds: 5,
    log: () => {},
    setTimeoutFn: (fn, ms) => setTimeout(fn, Math.min(ms, 20)),
  });
  assert.equal(timedOut.receipt.lanes.known_red.timed_out, true);
  assert.equal(timedOut.receipt.lanes.known_red.state, 'failed', 'a timeout is not the declared red');
  assert.equal(timedOut.success, false);

  const spawnFailed = await runExecutionPlan(['known_red'], manifest, {
    root,
    quarantinedLaneIds: new Set(['known_red']),
    spawn: () => { throw new Error('spawn EACCES'); },
    log: () => {},
  });
  assert.equal(spawnFailed.receipt.lanes.known_red.state, 'failed', 'a spawn failure is not the declared red');
  assert.equal(spawnFailed.success, false);
});

test('a lane child that closes before the runner sees SIGTERM is still labelled preempted', async (t) => {
  const root = await temporaryRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const signalPath = join(root, 'preemption-signal.json');
  const manifest = fixture({ slow: lane(['slow'], []) });
  const signalSource = new EventEmitter();
  const result = await runExecutionPlan(['slow'], manifest, {
    root,
    signalSource,
    preemptionSignalPath: signalPath,
    spawn: () => {
      const child = new EventEmitter();
      child.kill = () => true;
      // The marker lands and the group dies, but this run's own signal handler
      // has not fired yet: the lane must not be recorded as an ordinary red.
      setTimeout(async () => {
        await writeFile(signalPath, JSON.stringify({ pid: process.pid, competitors: ['rustc'], at: Date.now() }));
        child.emit('close', null, 'SIGTERM');
      }, 5);
      return child;
    },
    log: () => {},
  });
  assert.equal(result.receipt.lanes.slow.state, 'preempted');
  assert.equal(result.preempted, true);
  signalSource.removeAllListeners();
});

test('the preempted-run pointer is only actionable when it names the pid the lock killed', async (t) => {
  const root = await temporaryRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const pointerPath = join(root, 'target', 'proof-lanes', 'last-run.json');
  const signalPath = defaultPreemptionSignalPath(root);
  await mkdir(join(root, 'target', 'proof-lanes'), { recursive: true });
  await writeFile(pointerPath, JSON.stringify({ run_id: 'run-old', receipt: '/tmp/old/receipt.json', pid: 4242 }));

  assert.equal(readPreemptedRunReceiptPath(root), null, 'no marker means nothing was preempted');

  await writeFile(signalPath, JSON.stringify({ pid: 9999, competitors: ['cargo'], at: Date.now() }));
  assert.equal(
    readPreemptedRunReceiptPath(root),
    null,
    'a pointer from a run the lock did not kill must not be resumed',
  );

  await writeFile(signalPath, JSON.stringify({ pid: 4242, competitors: ['cargo'], at: Date.now() }));
  assert.equal(readPreemptedRunReceiptPath(root), '/tmp/old/receipt.json');
});

test('focused failure blocks acceptance even with spare resources and keep-going', async (t) => {
  const root = await temporaryRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifest = fixture({
    acceptance: { ...lane(['acceptance']), phase: 'acceptance' },
    focused: { ...lane(['focused']), phase: 'focused' },
    regression: lane(['regression']),
  });
  const started = [];
  const result = await runExecutionPlan(['acceptance', 'focused', 'regression'], manifest, {
    root, jobs: 3, keepGoing: true,
    spawn(file) { started.push(file); return childThatCloses(file === 'focused' ? 1 : 0, 10); },
    log() {},
  });
  assert.equal(result.success, false);
  assert.deepEqual(started.sort(), ['focused', 'regression']);
  assert.equal(result.receipt.lanes.acceptance.state, 'blocked');
  assert.equal(result.receipt.lanes.acceptance.blocked_by, 'focused');
});

test('acceptance starts only after focused hard prerequisites finish', async (t) => {
  const root = await temporaryRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifest = fixture({
    acceptance: { ...lane(['acceptance']), phase: 'acceptance' },
    focused: { ...lane(['focused']), phase: 'focused', depends_on: ['prerequisite'] },
    prerequisite: lane(['prerequisite']),
  });
  const order = [];
  const result = await runExecutionPlan(['acceptance', 'focused'], manifest, {
    root, jobs: 3,
    spawn(file) { order.push(file); return childThatCloses(0, 10); },
    log() {},
  });
  assert.equal(result.success, true);
  assert.deepEqual(order, ['prerequisite', 'focused', 'acceptance']);
});

test('theme failure blocks both real broad browser lanes even with keep-going', async t => {
  const root = await temporaryRoot();
  t.after(() => rm(root, {recursive: true, force: true}));
  const actual = loadManifest();
  const ids = ['test:frontend-themes', 'test:frontend-role-smoke', 'test:frontend-cross-browser'];
  const manifest = fixture(Object.fromEntries(ids.map(id => [id, {
    ...lane([id]), depends_on: actual.lanes[id].depends_on ?? [],
  }])));
  const started = [];
  const result = await runExecutionPlan(ids.slice(1), manifest, {
    root, jobs: 2, keepGoing: true,
    spawn(file) { started.push(file); return childThatCloses(1); }, log() {},
  });
  assert.deepEqual(started, ['test:frontend-themes']);
  assert.equal(result.success, false);
  for (const id of ids.slice(1)) assert.equal(result.receipt.lanes[id].state, 'blocked');
});

function prebuildLane(argv, resources = [], prebuild = 'cargo-test', extra = {}) {
  const base = lane(argv, [{ kind: 'lock', name: 'cargo-target', scope: 'build' }, ...resources], { prebuild, ...extra });
  return prebuild === 'cargo-builds'
    ? { ...base, cargo_inputs: { builds: [{ target: 'server/bin/server', profile: 'dev' }] } }
    : base;
}

function phaseOf(args) {
  return args.includes('build-tests') || args.includes('build-binaries') ? 'build' : 'run';
}

test('prebuild lanes hold the Cargo lock only while compiling and run without it', async (t) => {
  const root = await temporaryRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifest = fixture({
    first: prebuildLane(['cargo', 'test', '-p', 'first', '--lib']),
    second: prebuildLane(['cargo', 'test', '-p', 'second', '--lib']),
  }, { 'cargo-target': 1 });
  const active = { build: new Set(), run: new Set() };
  const overlaps = [];
  const spawned = [];
  const result = await runExecutionPlan(['first', 'second'], manifest, {
    jobs: 2,
    root,
    spawn(file, args, options) {
      const laneId = options.env.FMARCH_PROOF_LANE_ID;
      const phase = phaseOf(args);
      spawned.push({ laneId, phase, file, args, env: options.env });
      active[phase].add(laneId);
      if (active.build.size > 1) overlaps.push('two builds');
      if (active.build.size > 0 && active.run.size > 0) overlaps.push('build beside run');
      const child = new EventEmitter();
      child.kill = () => true;
      setTimeout(() => {
        active[phase].delete(laneId);
        child.emit('close', 0, null);
      }, phase === 'build' ? 10 : 40);
      return child;
    },
    log: () => {},
  });
  assert.equal(result.success, true);
  assert.ok(!overlaps.includes('two builds'), 'cargo-target must serialize the build phases');
  assert.ok(overlaps.includes('build beside run'), 'a run phase must not block the next build');
  const runs = spawned.filter((entry) => entry.phase === 'run');
  for (const entry of runs) {
    assert.deepEqual(entry.args.slice(0, 2), ['tools/proof_prebuild.mjs', 'run-tests']);
    assert.match(entry.env.PATH, /run-phase-tools/);
    assert.equal(entry.env.FMARCH_PROOF_PREBUILT_PLAN, undefined);
    const shim = await readFile(join(entry.env.PATH.split(':')[0], 'cargo'), 'utf8');
    assert.match(shim, /exit 97/);
  }
  for (const id of ['first', 'second']) {
    const record = result.receipt.lanes[id];
    assert.equal(record.state, 'passed');
    assert.deepEqual(record.phases.build.claims, { 'cargo-target': 1 });
    assert.deepEqual(record.phases.run.claims, {});
    assert.match(record.phases.build.command, /proof_prebuild\.mjs build-tests --plan .*prebuild-plan\.json -- -p/);
    assert.ok(record.timing.build_execution_seconds >= 0);
    assert.ok(record.timing.run_lock_wait_seconds >= 0);
    assert.ok(record.seconds >= record.timing.command_execution_seconds);
    assert.equal(record.command, `cargo test -p ${id} --lib`);
  }
});

test('a cargo-builds run phase resolves binaries through its plan, never PATH Cargo', async (t) => {
  const root = await temporaryRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const live = prebuildLane(['npm', 'run', 'live'], [{ kind: 'lock', name: 'browser' }], 'cargo-builds');
  const manifest = fixture({ live }, { 'cargo-target': 1, browser: 1 });
  const spawned = [];
  const result = await runExecutionPlan(['live'], manifest, {
    root,
    spawn(file, args, options) {
      spawned.push({ file, args, env: options.env, claimsPhase: phaseOf(args) });
      return childThatCloses(0);
    },
    onStart(_id, details) { spawned.push({ start: details }); },
    log: () => {},
  });
  assert.equal(result.success, true);
  assert.deepEqual(spawned[0].start, { command: 'npm run live', run: spawned[0].start.run, phase: 'build', claims: { 'cargo-target': 1 } });
  assert.deepEqual(spawned[1].args.slice(0, 4), ['tools/proof_prebuild.mjs', 'build-binaries', '--plan', join(result.run.laneDirectory('live'), 'prebuild-plan.json')]);
  assert.deepEqual([spawned[2].file, ...spawned[2].args], ['npm', 'run', 'live']);
  assert.equal(spawned[2].env.FMARCH_PROOF_PREBUILT_PLAN, join(result.run.laneDirectory('live'), 'prebuild-plan.json'));
  assert.equal(spawned[2].env.FMARCH_FRONTEND_SCRATCH_DIR, join(result.run.laneDirectory('live'), 'frontend-scratch'));
  assert.deepEqual(result.receipt.lanes.live.phases.run.claims, { browser: 1 });
});

test('a failed build phase never starts the run phase and releases its locks', async (t) => {
  const root = await temporaryRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const broken = prebuildLane(['cargo', 'test', '-p', 'broken', '--lib']);
  const after = lane(['after'], [{ kind: 'lock', name: 'cargo-target' }]);
  const manifest = fixture({ broken, after }, { 'cargo-target': 1 });
  const spawned = [];
  const result = await runExecutionPlan(['broken', 'after'], manifest, {
    jobs: 2,
    keepGoing: true,
    root,
    spawn(file, args) {
      spawned.push(phaseOf(args) === 'build' ? 'broken:build' : file);
      return childThatCloses(phaseOf(args) === 'build' ? 101 : 0);
    },
    log: () => {},
  });
  assert.equal(result.success, false);
  assert.deepEqual(spawned.sort(), ['after', 'broken:build']);
  const record = result.receipt.lanes.broken;
  assert.equal(record.state, 'failed');
  assert.equal(record.failed_phase, 'build');
  assert.equal(record.exit_code, 101);
  assert.equal(record.spawn_error, null, 'a compile failure is an ordinary red, not infrastructure');
  assert.equal(record.phases.run, undefined);
  assert.equal(result.receipt.lanes.after.state, 'passed');
});

test('a run phase waits for its run-scoped lock without spending its timeout', async (t) => {
  const root = await temporaryRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const holder = lane(['holder'], [{ kind: 'lock', name: 'browser' }]);
  const waiter = prebuildLane(['npm', 'run', 'waiter'], [{ kind: 'lock', name: 'browser' }], 'cargo-builds');
  waiter.execution.timeout_seconds = 1;
  const manifest = fixture({ holder, waiter }, { 'cargo-target': 1, browser: 1 });
  const order = [];
  const result = await runExecutionPlan(['holder', 'waiter'], manifest, {
    jobs: 2,
    root,
    spawn(file, args) {
      const name = file === 'holder' ? 'holder' : `waiter:${phaseOf(args)}`;
      order.push(`${name}:start`);
      const child = new EventEmitter();
      child.kill = () => true;
      setTimeout(() => {
        order.push(`${name}:end`);
        child.emit('close', 0, null);
      }, name === 'holder' ? 1_200 : 5);
      return child;
    },
    log: () => {},
  });
  assert.equal(result.success, true, JSON.stringify(result.receipt.lanes.waiter));
  assert.ok(order.indexOf('waiter:run:start') > order.indexOf('holder:end'));
  assert.ok(order.indexOf('waiter:build:end') < order.indexOf('holder:end'), 'the build phase needs no browser');
  assert.ok(result.receipt.lanes.waiter.timing.run_lock_wait_seconds >= 1);
});

test('an exclusive lane runs with nothing beside it', async (t) => {
  const root = await temporaryRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifest = fixture({
    a: lane(['a']),
    timing: lane(['timing'], [], { exclusive: true }),
    b: lane(['b']),
  });
  const active = new Set();
  const overlapped = [];
  const result = await runExecutionPlan(['a', 'timing', 'b'], manifest, {
    jobs: 3,
    root,
    spawn(file) {
      active.add(file);
      if (active.has('timing') && active.size > 1) overlapped.push([...active].sort().join('+'));
      const child = new EventEmitter();
      child.kill = () => true;
      setTimeout(() => {
        active.delete(file);
        child.emit('close', 0, null);
      }, 10);
      return child;
    },
    log: () => {},
  });
  assert.equal(result.success, true);
  assert.deepEqual(overlapped, []);
});

test('parallel admission starts the costliest lanes first; serial runs keep plan order', async (t) => {
  const root = await temporaryRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifest = fixture({ short: lane(['short']), long: lane(['long']), middle: lane(['middle']) });
  const priorities = new Map([['short', 1], ['long', 600], ['middle', 60]]);
  for (const [jobs, expected] of [[1, ['short', 'long', 'middle']], [2, ['long', 'middle', 'short']]]) {
    const started = [];
    const result = await runExecutionPlan(['short', 'long', 'middle'], manifest, {
      jobs,
      root,
      runId: `priority-${jobs}`,
      priorities,
      spawn(file) {
        started.push(file);
        return childThatCloses(0, 5);
      },
      log: () => {},
    });
    assert.equal(result.success, true);
    assert.deepEqual(started, expected);
  }
});

test('parallel admission ranks a cheap focused lane by the acceptance chain it gates', async (t) => {
  const root = await temporaryRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  // All three need the one cargo slot, as Cargo-bound lanes do on the worker.
  const cargo = [{ kind: 'lock', name: 'cargo' }];
  const manifest = fixture({
    long: lane(['long'], cargo),
    focused: { ...lane(['focused'], cargo), phase: 'focused' },
    middle: { ...lane(['middle'], cargo), depends_on: ['long'] },
    acceptance: { ...lane(['acceptance']), phase: 'acceptance' },
  });
  const priorities = new Map([['long', 300], ['focused', 1], ['middle', 10], ['acceptance', 600]]);
  const started = [];
  const result = await runExecutionPlan(['long', 'focused', 'middle', 'acceptance'], manifest, {
    jobs: 3,
    root,
    priorities,
    spawn(file) {
      started.push(file);
      return childThatCloses(0, 5);
    },
    log: () => {},
  });
  assert.equal(result.success, true);
  // Ranked by own cost the focused lane would queue behind `long` (300 s).
  assert.equal(started[0], 'focused');
  assert.deepEqual([...started].sort(), ['acceptance', 'focused', 'long', 'middle']);
});

test('lock amounts and exclusive mode count against capacity', async (t) => {
  const root = await temporaryRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifest = fixture({
    themes: lane(['themes'], [{ kind: 'lock', name: 'browser', amount: 3 }]),
    pair: lane(['pair'], [{ kind: 'lock', name: 'browser', amount: 2 }]),
    one: lane(['one'], [{ kind: 'lock', name: 'browser' }]),
    build: lane(['build'], [{ kind: 'lock', name: 'browser', mode: 'exclusive' }]),
  }, { browser: 3 });
  const active = new Map();
  let maximum = 0;
  const weights = { themes: 3, pair: 2, one: 1, build: 3 };
  const result = await runExecutionPlan(['themes', 'pair', 'one', 'build'], manifest, {
    jobs: 4,
    root,
    spawn(file) {
      active.set(file, weights[file]);
      maximum = Math.max(maximum, [...active.values()].reduce((sum, value) => sum + value, 0));
      const child = new EventEmitter();
      child.kill = () => true;
      setTimeout(() => {
        active.delete(file);
        child.emit('close', 0, null);
      }, 10);
      return child;
    },
    log: () => {},
  });
  assert.equal(result.success, true);
  assert.equal(maximum, 3);
});

test('phase, mode and amount declarations fail closed', () => {
  const capacities = { 'cargo-target': 1, browser: 2, 'postgres-admin': 1 };
  const cargoTest = ['cargo', 'test', '-p', 'x', '--lib'];
  const cases = [
    [lane(cargoTest, [{ kind: 'lock', name: 'cargo-target', scope: 'build' }]), /build-scoped but the lane declares no prebuild/],
    [lane(cargoTest, [{ kind: 'lock', name: 'cargo-target' }], { prebuild: 'cargo-test' }), /must hold cargo-target in its build scope/],
    [lane(cargoTest, [{ kind: 'lock', name: 'cargo-target', scope: 'build' }, { kind: 'lock', name: 'cargo-target' }], { prebuild: 'cargo-test' }), /may not also hold cargo-target in its run phase/],
    [lane(cargoTest, [{ kind: 'lock', name: 'cargo-target', scope: 'build' }], { prebuild: 'cargo-test', exclusive: true }), /may not combine prebuild with exclusive/],
    [lane(cargoTest, [{ kind: 'lock', name: 'cargo-target', scope: 'during' }]), /invalid scope during/],
    [lane(['x'], [{ kind: 'lock', name: 'browser', amount: 3 }]), /amount exceeds its capacity/],
    [lane(['x'], [{ kind: 'lock', name: 'browser', amount: 2, mode: 'exclusive' }]), /may not combine amount with exclusive/],
    [lane(['x'], [{ kind: 'lock', name: 'browser', mode: 'shared-ish' }]), /invalid mode/],
    [lane(['x'], [{ kind: 'lock', name: 'browser', slots: 2 }]), /unknown field slots/],
    [lane(['x'], [{ kind: 'lock', name: 'postgres-admin' }]), /may not claim postgres-admin/],
    [lane(['x'], [], { exclusive: 'yes' }), /exclusive must be a boolean/],
    [lane(['x'], [{ kind: 'lock', name: 'cargo-target', scope: 'build' }], { prebuild: 'cargo-test' }), /exactly one `cargo test`/],
    [lane(['cargo', 'test', '-p', 'x'], [{ kind: 'lock', name: 'cargo-target', scope: 'build' }], { prebuild: 'cargo-test' }), /explicit --lib\/--bin\/--test/],
    [lane(['npm', 'run', 'x'], [{ kind: 'lock', name: 'cargo-target', scope: 'build' }], { prebuild: 'cargo-builds' }), /must be an object/],
    [lane(cargoTest, [{ kind: 'lock', name: 'cargo-target', scope: 'build' }], { prebuild: 'nextest' }), /unknown prebuild nextest/],
  ];
  for (const [candidate, pattern] of cases) {
    assert.throws(() => validateExecutionManifest(fixture({ candidate }, capacities)), pattern);
  }
});

test('the real manifest splits every cargo test lane and keeps timing lanes exclusive', () => {
  const manifest = loadManifest();
  for (const [id, entry] of Object.entries(manifest.lanes)) {
    const argv = entry.execution.argv;
    const runsCargoTest = argv.some((value, index) => value === 'cargo' && argv[index + 1] === 'test');
    if (runsCargoTest) assert.equal(entry.execution.prebuild, 'cargo-test', `${id} must prebuild its tests`);
    const runClaims = Object.keys(lockClaimsForTest(id, entry, manifest));
    if (entry.execution.prebuild) assert.ok(!runClaims.includes('cargo-target'), `${id} run phase must not hold cargo-target`);
  }
  for (const id of ['test:capacity-overload', 'test:mash-scale-acceptance']) {
    assert.equal(manifest.lanes[id].execution.exclusive, true, `${id} measures the host and must run alone`);
  }
  assert.equal(manifest.runner.lock_capacities['cargo-target'], 1);
  assert.equal(manifest.runner.lock_capacities['postgres-admin'], 1);
});

function lockClaimsForTest(id, entry, manifest) {
  return Object.fromEntries(lockClaims(id, entry, manifest.runner.lock_capacities, 'run'));
}

test('browser capacity counts engines and only the production build owns the frontend worktree', () => {
  const manifest = loadManifest();
  const { lock_capacities: capacities } = manifest.runner;
  assert.equal(capacities.browser, 3);
  const engines = (id) => lockClaims(id, manifest.lanes[id], capacities, 'run').get('browser');
  assert.equal(engines('test:frontend-themes'), 3, 'themes runs chromium, firefox and webkit at once');
  assert.equal(engines('test:frontend-cross-browser'), 2, 'cross-browser runs firefox and webkit at once');
  const owners = Object.entries(manifest.lanes)
    .filter(([id, entry]) => lockClaims(id, entry, capacities, 'run').has('frontend-worktree'))
    .map(([id]) => id);
  // Every other lane keeps Vite and SvelteKit state in FMARCH_FRONTEND_SCRATCH_DIR.
  assert.deepEqual(owners, ['test:frontend-csp-browser']);
});

test('an artifact consumer waits until its producer has finished cleanup', async (t) => {
  const root = await temporaryRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const provider = {
    async acquire({ laneId }) {
      return {
        database: `fmarch_proof_test_${laneId}`,
        url: `postgres://local/fmarch_proof_test_${laneId}`,
        // A slow drop under postgres-admin releases a lock (waking admission)
        // while the producer already reads `passed`.
        async release() { await new Promise((resolve) => setTimeout(resolve, 30)); },
      };
    },
  };
  const manifest = fixture({
    producer: lane(['producer'], [
      { kind: 'postgres', mode: 'lane-isolated', url_env: 'DATABASE_URL' },
      { kind: 'artifact-dir', env: 'FMARCH_PROOF_ARTIFACT_DIR' },
    ]),
    consumer: {
      ...lane(['consumer'], [{ kind: 'artifact-input', from: 'producer', env: 'PRODUCER_DIR' }]),
      depends_on: ['producer'],
    },
    other: lane(['other'], [{ kind: 'postgres', mode: 'lane-isolated', url_env: 'DATABASE_URL' }]),
  }, { 'postgres-admin': 1 });
  const result = await runExecutionPlan(['producer', 'consumer', 'other'], manifest, {
    jobs: 3,
    root,
    databaseProvider: provider,
    spawn: () => childThatCloses(0, 5),
    log: () => {},
  });
  assert.equal(result.receipt.lanes.consumer.state, 'passed', JSON.stringify(result.receipt.lanes.consumer));
  assert.equal(result.success, true);
});

test('every compiling or test-running phase budgets its CPU against the worker quota', () => {
  const manifest = loadManifest();
  const { lock_capacities: capacities } = manifest.runner;
  assert.equal(capacities.cpu, 12, 'the Cachy worker runs under CPUQuota=1200%');
  const fleetJobs = Number(JSON.parse(readFileSync(join(REPO_ROOT, '.fluffyfleet.json'), 'utf8')).profiles.linux.environment.CARGO_BUILD_JOBS);
  const scriptJobs = Number(/^export CARGO_BUILD_JOBS=(\d+)$/m.exec(readFileSync(join(REPO_ROOT, 'scripts', 'linux-proof.sh'), 'utf8'))?.[1]);
  assert.equal(scriptJobs, fleetJobs, 'linux-proof.sh and the fleet profile agree on CARGO_BUILD_JOBS');
  for (const [id, entry] of Object.entries(manifest.lanes)) {
    const { execution } = entry;
    if (execution.exclusive) continue;
    const cpu = (scope) => lockClaims(id, entry, capacities, scope).get('cpu') ?? 0;
    if (execution.prebuild) assert.ok(cpu('build') >= fleetJobs, `${id} build phase runs CARGO_BUILD_JOBS=${fleetJobs} rustc processes`);
    if (lockClaims(id, entry, capacities, 'run').has('cargo-target')) {
      assert.ok(cpu('run') >= fleetJobs, `${id} compiles under cargo-target with CARGO_BUILD_JOBS=${fleetJobs} rustc processes`);
    }
    if (execution.prebuild === 'cargo-test') {
      const explicit = execution.argv.map((arg) => /^--test-threads=(\d+)$/.exec(arg)?.[1]).find(Boolean);
      const threads = Math.min(Number(explicit ?? 4), 4);
      const postgres = execution.resources.some((resource) => resource.kind === 'postgres');
      assert.ok(cpu('run') >= threads + (postgres ? 1 : 0), `${id} run phase must budget ${threads} test threads${postgres ? ' plus Postgres' : ''}`);
    }
    const engines = lockClaims(id, entry, capacities, 'run').get('browser') ?? 0;
    assert.ok(cpu('run') >= 2 * engines, `${id} must budget two cores per browser engine`);
  }
});
