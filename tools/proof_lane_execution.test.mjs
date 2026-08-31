import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { loadManifest } from './proof_lane_select.mjs';
import {
  createRepoLocalPostgresProvider,
  createRunContext,
  disposableDatabaseName,
  expandHardDependencies,
  prepareLaneInvocation,
  runExecutionPlan,
  validateExecutionManifest,
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

test('Postgres provisioning claims the administrative capacity for the whole conservative lane', async (t) => {
  const root = await temporaryRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const active = new Set();
  let maximum = 0;
  const provider = {
    async acquire({ laneId }) {
      return {
        database: `fmarch_proof_test_${laneId}`,
        url: `postgres://local/fmarch_proof_test_${laneId}`,
        async release() {},
      };
    },
  };
  const manifest = fixture({
    first: lane(['first'], [{ kind: 'postgres', mode: 'lane-isolated', url_env: 'DATABASE_URL' }]),
    second: lane(['second'], [{ kind: 'postgres', mode: 'lane-isolated', url_env: 'DATABASE_URL' }]),
  }, { 'postgres-admin': 1 });
  const result = await runExecutionPlan(['first', 'second'], manifest, {
    jobs: 2,
    root,
    databaseProvider: provider,
    spawn(file) {
      const child = new EventEmitter();
      child.kill = () => true;
      active.add(file);
      maximum = Math.max(maximum, active.size);
      setTimeout(() => {
        active.delete(file);
        child.emit('close', 0, null);
      }, 8);
      return child;
    },
    log: () => {},
  });
  assert.equal(result.success, true);
  assert.equal(maximum, 1);
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
  assert.deepEqual(
    Object.keys(result.receipt.lanes.independent.timing),
    ['resource_setup_seconds', 'command_execution_seconds', 'cleanup_seconds'],
  );
  assert.ok(
    Object.values(result.receipt.lanes.independent.timing)
      .every((seconds) => Number.isFinite(seconds) && seconds >= 0),
  );
  const receipt = JSON.parse(await readFile(result.run.receiptPath, 'utf8'));
  assert.equal(receipt.schema, 3);
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
  await writeFile(join(cachedArtifacts, 'evidence.json'), '{"passed":true}\n');
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
      return childThatCloses(0);
    },
    log: () => {},
  });
  assert.equal(result.success, true);
  assert.notEqual(producerArtifacts, cachedArtifacts);
  assert.match(producerArtifacts, /runs\/.*\/artifacts\/producer$/);
  assert.equal(await readFile(join(producerArtifacts, 'evidence.json'), 'utf8'), '{"passed":true}\n');
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

test('a multi-database lane holds one postgres-admin admission and records every lease', async (t) => {
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
  assert.deepEqual(claims, { 'postgres-admin': 1 });
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
