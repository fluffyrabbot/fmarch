// Resource-aware execution for the proof-lane selector.
//
// Selection deliberately remains in proof_lane_select.mjs.  This module owns
// only the hard dependency closure, scoped resources, process lifecycle, and
// run receipt so measuring/recording can retain their serial semantics.

import { spawn as spawnChild } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertLocalProofEndpoint,
  buildConfig,
  createDisposableDatabase,
  createDisposableDatabaseAtLocalEndpoint,
  databaseUrl,
  dropDisposableDatabase,
  startRepoLocalPostgres,
} from './dev_postgres.mjs';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const PROOF_RUNS_DIR = join(REPO_ROOT, 'target', 'proof-lanes', 'runs');
const RESOURCE_KINDS = new Set(['lock', 'artifact-dir', 'artifact-input', 'postgres']);
const EXECUTION_CLASSES = new Set(['legacy', 'hermetic', 'cargo', 'postgres', 'browser', 'container', 'hosted']);
const DEFAULT_CLEANUP_TIMEOUT_MS = 30_000;
const DEFAULT_TERMINATION_GRACE_MS = 5_000;
const RESERVED_ENV = new Set([
  'FMARCH_PROOF_RUN_ID',
  'FMARCH_PROOF_RUN_DIR',
  'FMARCH_PROOF_LANE_ID',
  'FMARCH_PROOF_LANE_DIR',
  'FMARCH_PROOF_ARTIFACT_DIR',
]);

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function validEnvironmentName(value) {
  return typeof value === 'string' && /^[A-Z_][A-Z0-9_]*$/.test(value);
}

function safePathSegment(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._-]+$/.test(value) || value === '.' || value === '..') {
    throw new Error(`${label} must contain only letters, numbers, dot, underscore, or dash`);
  }
  return value;
}

function laneExecution(laneId, lane) {
  const declared = lane.execution ?? {};
  const legacy = !lane.execution;
  let argv = declared.argv;
  if (!argv) {
    if (lane.kind === 'npm') argv = ['npm', 'run', laneId];
    else argv = [process.env.SHELL ?? '/bin/sh', '-lc', lane.command];
  }
  return {
    legacy,
    class: declared.class ?? 'legacy',
    timeoutSeconds: declared.timeout_seconds ?? 3600,
    argv,
    env: declared.env ?? {},
    resources: declared.resources ?? [{ kind: 'lock', name: 'legacy' }],
  };
}

function laneLabel(laneId, lane) {
  const execution = laneExecution(laneId, lane);
  return execution.argv.map((part) => String(part)).join(' ');
}

function lockClaims(laneId, lane, capacities) {
  const execution = laneExecution(laneId, lane);
  const claims = new Map();
  for (const resource of execution.resources) {
    if (resource.kind === 'lock') {
      claims.set(resource.name, (claims.get(resource.name) ?? 0) + 1);
    }
    // Database create/drop is an administrative operation against the shared
    // repo-local cluster.  Keep that whole first-generation database lane
    // serialized until profiling proves that provisioning and test bodies can
    // be safely decoupled.
    if (resource.kind === 'postgres' && capacities['postgres-admin']) {
      claims.set('postgres-admin', (claims.get('postgres-admin') ?? 0) + 1);
    }
  }
  return claims;
}

function dependenciesFor(laneId, manifest) {
  return manifest.lanes[laneId]?.depends_on ?? [];
}

// Hard dependencies are a closure edge, unlike `after`, which remains only an
// optional execution-order hint for the legacy planner.
export function expandHardDependencies(selectedIds, manifest) {
  const selected = new Set();
  const visiting = new Set();
  const visited = new Set();
  const result = [];

  const visit = (laneId) => {
    if (!manifest.lanes[laneId]) throw new Error(`proof lane dependency references unknown lane ${laneId}`);
    if (visited.has(laneId)) return;
    if (visiting.has(laneId)) throw new Error(`proof lane dependency cycle includes ${laneId}`);
    visiting.add(laneId);
    for (const dependency of dependenciesFor(laneId, manifest)) {
      visit(dependency);
    }
    visiting.delete(laneId);
    visited.add(laneId);
    selected.add(laneId);
    result.push(laneId);
  };

  for (const laneId of selectedIds) visit(laneId);
  return result;
}

export function validateExecutionManifest(manifest) {
  if (!manifest?.lanes || typeof manifest.lanes !== 'object') {
    throw new Error('proof lane manifest must define a lanes object');
  }
  const capacities = manifest.runner?.lock_capacities ?? { legacy: 1 };
  if (!capacities || typeof capacities !== 'object') {
    throw new Error('proof lane runner must define lock_capacities');
  }
  for (const [name, capacity] of Object.entries(capacities)) {
    safePathSegment(name, `runner lock ${name}`);
    positiveInteger(capacity, `runner lock ${name} capacity`);
  }
  if (manifest.runner?.max_parallel !== undefined) {
    positiveInteger(manifest.runner.max_parallel, 'runner max_parallel');
  }

  const laneDirectoryNames = new Set();
  for (const [laneId, lane] of Object.entries(manifest.lanes)) {
    const directoryName = safePathSegment(laneId.replaceAll(':', '_'), `proof lane ${laneId} directory`);
    if (laneDirectoryNames.has(directoryName)) {
      throw new Error(`proof lanes must not collide after ':' becomes '_': ${laneId}`);
    }
    laneDirectoryNames.add(directoryName);
    const execution = laneExecution(laneId, lane);
    if (!EXECUTION_CLASSES.has(execution.class)) {
      throw new Error(`proof lane ${laneId} has unknown execution class ${execution.class}`);
    }
    positiveInteger(execution.timeoutSeconds, `proof lane ${laneId} timeout_seconds`);
    if (!Array.isArray(execution.argv) || execution.argv.length === 0 || execution.argv.some((arg) => typeof arg !== 'string' || arg.length === 0)) {
      throw new Error(`proof lane ${laneId} execution argv must be a non-empty string array`);
    }
    if (!execution.env || typeof execution.env !== 'object' || Array.isArray(execution.env)) {
      throw new Error(`proof lane ${laneId} execution env must be an object`);
    }

    const resourceEnvironment = new Set(RESERVED_ENV);
    // `resourceEnvironment` protects the child from static execution.env
    // shadowing a runner-provided value.  Keep resource claims separately so
    // two resources cannot silently overwrite one another either.
    const claimedResourceEnvironment = new Map();
    const declaredOutputs = new Set();
    const claimResourceEnvironment = (name, resourceKind) => {
      const allowedRunnerArtifactRoot = resourceKind === 'artifact-dir' && name === 'FMARCH_PROOF_ARTIFACT_DIR';
      if (RESERVED_ENV.has(name) && !allowedRunnerArtifactRoot) {
        throw new Error(`proof lane ${laneId} resource ${resourceKind} may not claim runner-owned ${name}`);
      }
      const existing = claimedResourceEnvironment.get(name);
      if (existing) {
        throw new Error(`proof lane ${laneId} resource ${resourceKind} conflicts with ${existing} over ${name}`);
      }
      claimedResourceEnvironment.set(name, resourceKind);
      resourceEnvironment.add(name);
    };
    for (const resource of execution.resources) {
      if (!resource || !RESOURCE_KINDS.has(resource.kind)) {
        throw new Error(`proof lane ${laneId} has an unknown execution resource`);
      }
      if (resource.kind === 'lock') {
        if (!capacities[resource.name]) {
          throw new Error(`proof lane ${laneId} claims unknown lock ${resource.name}`);
        }
      }
      if (resource.kind === 'artifact-dir') {
        if (!validEnvironmentName(resource.env)) {
          throw new Error(`proof lane ${laneId} artifact-dir requires an uppercase env name`);
        }
        if (declaredOutputs.has(resource.env)) {
          throw new Error(`proof lane ${laneId} declares artifact output ${resource.env} more than once`);
        }
        declaredOutputs.add(resource.env);
        claimResourceEnvironment(resource.env, 'artifact-dir');
      }
      if (resource.kind === 'artifact-input') {
        if (!validEnvironmentName(resource.env)) {
          throw new Error(`proof lane ${laneId} artifact-input requires an uppercase env name`);
        }
        if (!manifest.lanes[resource.from]) {
          throw new Error(`proof lane ${laneId} consumes artifact from unknown lane ${resource.from}`);
        }
        if (!dependenciesFor(laneId, manifest).includes(resource.from)) {
          throw new Error(`proof lane ${laneId} must hard-depend on artifact producer ${resource.from}`);
        }
        claimResourceEnvironment(resource.env, 'artifact-input');
      }
      if (resource.kind === 'postgres') {
        if (!['lane-isolated', 'shared-serial'].includes(resource.mode)) {
          throw new Error(`proof lane ${laneId} has invalid Postgres mode ${resource.mode}`);
        }
        if (!validEnvironmentName(resource.url_env)) {
          throw new Error(`proof lane ${laneId} postgres resource requires an uppercase url_env`);
        }
        claimResourceEnvironment(resource.url_env, 'postgres');
        if (/\bDATABASE_URL=postgres:\/\//.test(lane.command ?? '')) {
          throw new Error(`proof lane ${laneId} hard-codes DATABASE_URL despite runner-owned Postgres`);
        }
      }
    }
    for (const key of Object.keys(execution.env)) {
      if (!validEnvironmentName(key)) {
        throw new Error(`proof lane ${laneId} has invalid execution env name ${key}`);
      }
      if (resourceEnvironment.has(key)) {
        throw new Error(`proof lane ${laneId} static env may not shadow resource-owned ${key}`);
      }
    }
  }

  expandHardDependencies(Object.keys(manifest.lanes), manifest);
  return true;
}

function generatedRunId() {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').toLowerCase();
  return `run-${timestamp}-${randomUUID().slice(0, 8)}`;
}

export function createRunContext({ root = REPO_ROOT, runId = generatedRunId() } = {}) {
  const workspaceRoot = resolve(root);
  const id = safePathSegment(runId, 'proof run id');
  const runDir = join(workspaceRoot, 'target', 'proof-lanes', 'runs', id);
  const laneDirectory = (laneId) => join(runDir, 'lanes', safePathSegment(laneId.replaceAll(':', '_'), 'lane id'));
  const artifactDirectory = (laneId) => join(runDir, 'artifacts', safePathSegment(laneId.replaceAll(':', '_'), 'lane id'));
  return {
    id,
    root: workspaceRoot,
    runDir,
    receiptPath: join(runDir, 'receipt.json'),
    laneDirectory,
    artifactDirectory,
  };
}

function assertInsideRun(run, candidate, label) {
  const relativePath = relative(run.runDir, candidate);
  if (relativePath.startsWith('..') || relativePath === '' || relativePath.startsWith('/')) {
    throw new Error(`${label} escapes proof run directory`);
  }
  return candidate;
}

function disposableDatabaseName(run, laneId) {
  const runPart = run.id.replaceAll(/[^a-z0-9]/gi, '').toLowerCase().slice(-18) || 'run';
  const lanePart = laneId.replaceAll(/[^a-z0-9]/gi, '_').toLowerCase().slice(0, 28) || 'lane';
  return `fmarch_proof_${runPart}_${lanePart}`.slice(0, 63);
}

export function createRepoLocalPostgresProvider({ env = process.env } = {}) {
  let configPromise;
  const config = async () => {
    if (!configPromise) {
      configPromise = Promise.resolve(buildConfig({}, env));
    }
    return await configPromise;
  };

  return {
    async acquire({ run, laneId, resource, signal }) {
      const local = await config();
      // Runner-owned proof databases are never allowed to follow an ambient
      // host override off this machine.  `DATABASE_URL` is already ignored;
      // guard the narrower dev-postgres knobs too before either provision path.
      assertLocalProofEndpoint(local);
      if (resource.mode === 'shared-serial') {
        return {
          database: local.database,
          url: databaseUrl(local),
          retained: false,
          async release() {},
        };
      }
      const database = disposableDatabaseName(run, laneId);
      let disposable;
      try {
        // This is the declared local proof endpoint (never DATABASE_URL).  It
        // covers the standard Podman/Docker setup at 127.0.0.1:5544.
        disposable = await createDisposableDatabaseAtLocalEndpoint(local, database, { signal });
      } catch (endpointError) {
        // On a machine without that container endpoint, initialize/reuse the
        // repo-owned cluster instead.  If another process owns the port, the
        // helper fails closed rather than adopting it.
        try {
          await startRepoLocalPostgres(local, { signal });
          disposable = await createDisposableDatabase(local, database, { ensureStarted: false, signal });
        } catch (repoLocalError) {
          throw new Error(
            `could not provision local proof database ${database}: ${endpointError.message}; ${repoLocalError.message}`,
          );
        }
      }
      return {
        database,
        url: databaseUrl(disposable),
        retained: false,
        async release({ success, signal }) {
          const keepFailed = env.FMARCH_PROOF_CLEANUP_FAILED_DATABASES !== '1';
          if (!success && keepFailed) {
            this.retained = true;
            return;
          }
          await dropDisposableDatabase(local, database, { signal });
        },
      };
    },
  };
}

function abortReason(signal, fallback) {
  if (signal?.reason instanceof Error) return signal.reason;
  if (signal?.reason) return new Error(String(signal.reason));
  return new Error(fallback);
}

function createBoundedAbortScope({
  parentSignal,
  timeoutMilliseconds,
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout,
  label,
}) {
  const controller = new AbortController();
  let timedOut = false;
  let parentAbortHandler = null;
  const abortFromParent = () => {
    if (!controller.signal.aborted) controller.abort(abortReason(parentSignal, `${label} aborted`));
  };
  if (parentSignal) {
    if (parentSignal.aborted) abortFromParent();
    else {
      parentAbortHandler = abortFromParent;
      parentSignal.addEventListener('abort', parentAbortHandler, { once: true });
    }
  }
  const timeout = setTimeoutFn(() => {
    if (controller.signal.aborted) return;
    timedOut = true;
    controller.abort(new Error(`${label} timed out after ${Math.ceil(timeoutMilliseconds / 1_000)}s`));
  }, timeoutMilliseconds);
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose() {
      clearTimeoutFn(timeout);
      if (parentAbortHandler) parentSignal.removeEventListener('abort', parentAbortHandler);
    },
  };
}

async function awaitAbortable(operation, signal) {
  if (signal?.aborted) throw abortReason(signal, 'proof lane operation aborted');
  return await new Promise((resolveOperation, rejectOperation) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      callback(value);
    };
    const onAbort = () => finish(rejectOperation, abortReason(signal, 'proof lane operation aborted'));
    signal?.addEventListener('abort', onAbort, { once: true });
    Promise.resolve()
      .then(operation)
      .then(
        (value) => finish(resolveOperation, value),
        (error) => finish(rejectOperation, error),
      );
  });
}

async function releaseLeases(resources, { success, signal }) {
  const releases = await Promise.allSettled(resources.map((resource) => resource.release({ success, signal })));
  const failure = releases.find((result) => result.status === 'rejected');
  if (failure) throw failure.reason;
}

function resourceCleanupError(error, cleanupError, resources, cleanupScope) {
  const detail = cleanupScope.timedOut()
    ? `resource cleanup timed out: ${cleanupError?.message ?? cleanupError}`
    : `resource cleanup failed: ${cleanupError?.message ?? cleanupError}`;
  const wrapped = new Error(`${error?.message ?? error}; ${detail}`, { cause: error });
  const database = resources.find((resource) => resource?.database);
  wrapped.cleanupError = detail;
  wrapped.database = database?.database ?? null;
  wrapped.databaseRetained = Boolean(database);
  return wrapped;
}

// Builds a child-process invocation after allocating only resources declared by
// the lane.  Callers own lifecycle cleanup through `releaseResources`.
export async function prepareLaneInvocation({
  laneId,
  manifest,
  run,
  completedArtifacts = new Map(),
  env = process.env,
  databaseProvider = createRepoLocalPostgresProvider({ env }),
  signal,
  cleanupSignal,
  cleanupTimeoutMs = DEFAULT_CLEANUP_TIMEOUT_MS,
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout,
} = {}) {
  const lane = manifest?.lanes?.[laneId];
  if (!lane) throw new Error(`unknown proof lane ${laneId}`);
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('proof lane preparation aborted');
  const execution = laneExecution(laneId, lane);
  const laneDir = assertInsideRun(run, run.laneDirectory(laneId), `lane ${laneId} directory`);
  const artifactDir = assertInsideRun(run, run.artifactDirectory(laneId), `lane ${laneId} artifact directory`);
  await Promise.all([mkdir(laneDir, { recursive: true }), mkdir(artifactDir, { recursive: true })]);

  const childEnv = {
    ...env,
    ...execution.env,
    FMARCH_PROOF_RUN_ID: run.id,
    FMARCH_PROOF_RUN_DIR: run.runDir,
    FMARCH_PROOF_LANE_ID: laneId,
    FMARCH_PROOF_LANE_DIR: laneDir,
    FMARCH_PROOF_ARTIFACT_DIR: artifactDir,
  };
  const resources = [];
  let database = null;
  try {
    for (const resource of execution.resources) {
      if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('proof lane preparation aborted');
      if (resource.kind === 'artifact-dir') {
        childEnv[resource.env] = artifactDir;
      } else if (resource.kind === 'artifact-input') {
        const source = completedArtifacts.get(resource.from);
        if (!source) {
          throw new Error(`proof lane ${laneId} needs artifact from ${resource.from}, but the producer has no successful output`);
        }
        assertInsideRun(run, source, `artifact input ${resource.from}`);
        childEnv[resource.env] = source;
      } else if (resource.kind === 'postgres') {
        database = await databaseProvider.acquire({ run, laneId, resource, signal });
        resources.push(database);
        childEnv[resource.url_env] = database.url;
      }
    }
  } catch (error) {
    if (resources.length === 0) throw error;
    const cleanupScope = createBoundedAbortScope({
      parentSignal: cleanupSignal,
      timeoutMilliseconds: cleanupTimeoutMs,
      setTimeoutFn,
      clearTimeoutFn,
      label: `proof lane ${laneId} resource cleanup`,
    });
    try {
      await awaitAbortable(
        () => releaseLeases(resources, { success: false, signal: cleanupScope.signal }),
        cleanupScope.signal,
      );
    } catch (cleanupError) {
      throw resourceCleanupError(error, cleanupError, resources, cleanupScope);
    } finally {
      cleanupScope.dispose();
    }
    const databaseResource = resources.find((resource) => resource?.database);
    if (databaseResource) {
      const wrapped = error instanceof Error ? error : new Error(String(error));
      wrapped.database = databaseResource.database;
      wrapped.databaseRetained = databaseResource.retained ?? false;
      throw wrapped;
    }
    throw error;
  }

  return {
    laneId,
    lane,
    execution,
    file: execution.argv[0],
    args: execution.argv.slice(1),
    command: laneLabel(laneId, lane),
    cwd: run.root,
    env: childEnv,
    laneDir,
    artifactDir,
    database,
    async releaseResources({ success, signal }) {
      await releaseLeases(resources, { success, signal });
    },
  };
}

function terminateChildProcess(child, signal, detached) {
  // The runner creates a separate process group on POSIX.  Killing that group
  // prevents a timed-out npm/shell wrapper from leaving Cargo, Vite, or a
  // browser descendant behind to collide with the next lane.
  if (detached && Number.isSafeInteger(child.pid) && child.pid > 0) {
    try {
      process.kill(-child.pid, signal);
      return true;
    } catch (error) {
      if (error?.code === 'ESRCH') return false;
      // A non-POSIX fake or a platform-specific spawn may not have made the
      // child a group leader. Fall through to the direct child signal.
    }
  }
  return child.kill?.(signal) ?? false;
}

function processGroupIsAlive(child, detached) {
  if (!detached || !Number.isSafeInteger(child.pid) || child.pid <= 0) return false;
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

function observeChildResult(child, {
  timeoutSeconds,
  setTimeoutFn,
  clearTimeoutFn,
  terminate,
  groupIsAlive,
  terminationGraceMilliseconds = DEFAULT_TERMINATION_GRACE_MS,
}) {
  let requestTermination;
  const result = new Promise((resolveResult) => {
    let settled = false;
    let timedOut = false;
    let terminationReason = null;
    let killTimer = null;
    let groupPollTimer = null;
    let leaderResult = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeoutFn(timeout);
      if (killTimer) clearTimeoutFn(killTimer);
      if (groupPollTimer) clearTimeoutFn(groupPollTimer);
      resolveResult({
        ...leaderResult,
        timedOut,
        groupTerminatedAfterLeaderExit: terminationReason === 'leader-exit' && leaderResult?.exitCode === 0,
      });
    };
    requestTermination = (reason = 'external') => {
      if (terminationReason) return;
      terminationReason = reason;
      terminate('SIGTERM');
      killTimer = setTimeoutFn(() => terminate('SIGKILL'), terminationGraceMilliseconds);
    };
    const waitForGroup = () => {
      if (!leaderResult || settled) return;
      if (!groupIsAlive()) {
        finish();
        return;
      }
      // A shell/npm leader can exit while a child server or browser remains in
      // its process group. A passed leader is not a passed lane until that
      // group is gone; terminate/drain it before releasing lane resources.
      requestTermination('leader-exit');
      groupPollTimer = setTimeoutFn(waitForGroup, 25);
    };
    const timeout = setTimeoutFn(() => {
      timedOut = true;
      requestTermination('timeout');
      waitForGroup();
    }, timeoutSeconds * 1_000);
    child.once('close', (exitCode, signal) => {
      leaderResult = { exitCode, signal, spawnError: null };
      waitForGroup();
    });
    child.once('error', (error) => {
      leaderResult = { exitCode: null, signal: null, spawnError: error?.message ?? String(error) };
      finish();
    });
  });
  return { result, requestTermination };
}

function hasCapacity(claims, used, capacities) {
  for (const [name, amount] of claims) {
    if ((used.get(name) ?? 0) + amount > capacities[name]) return false;
  }
  return true;
}

function claim(claims, used) {
  for (const [name, amount] of claims) used.set(name, (used.get(name) ?? 0) + amount);
}

function release(claims, used) {
  for (const [name, amount] of claims) {
    const remaining = (used.get(name) ?? 0) - amount;
    if (remaining <= 0) used.delete(name);
    else used.set(name, remaining);
  }
}

function lockPath(root, name, slot) {
  return join(root, 'target', 'proof-lanes', 'locks', safePathSegment(name, 'runner lock'), String(slot));
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM still proves that a live process owns the pid; only ESRCH is stale.
    return error?.code !== 'ESRCH';
  }
}

async function staleLockDirectory(directory, now) {
  try {
    const owner = JSON.parse(await readFile(join(directory, 'owner.json'), 'utf8'));
    return !processIsAlive(owner.pid);
  } catch {
    // A process can be between mkdir and owner write.  Never reclaim that
    // ownerless state automatically: stealing it after a delay creates an ABA
    // race in which the original process can overwrite a newer owner's record.
    // It is intentionally fail-closed and requires explicit cleanup after a
    // crash in that tiny window.
    return false;
  }
}

class CrossRunLockManager {
  constructor({ root, runId, capacities, now = Date.now }) {
    this.root = root;
    this.runId = runId;
    this.capacities = capacities;
    this.now = now;
  }

  async acquire(claims, laneId) {
    const entries = [];
    try {
      for (const [name, amount] of claims) {
        const capacity = this.capacities[name];
        for (let claimIndex = 0; claimIndex < amount; claimIndex += 1) {
          const entry = await this.acquireOne(name, capacity, laneId);
          if (!entry) {
            await this.release(entries);
            return null;
          }
          entries.push(entry);
        }
      }
      return {
        entries,
        release: async () => await this.release(entries),
      };
    } catch (error) {
      await this.release(entries);
      throw error;
    }
  }

  async acquireOne(name, capacity, laneId) {
    for (let slot = 0; slot < capacity; slot += 1) {
      const directory = lockPath(this.root, name, slot);
      await mkdir(dirname(directory), { recursive: true });
      try {
        await mkdir(directory);
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        if (await staleLockDirectory(directory, this.now)) {
          await rm(directory, { recursive: true, force: true });
          // Another runner may win the race to recreate it; retry this slot on
          // the next scheduling pass rather than assuming ownership.
          continue;
        }
        continue;
      }
      try {
        const token = randomUUID();
        await writeFile(
          join(directory, 'owner.json'),
          `${JSON.stringify({ pid: process.pid, token, run_id: this.runId, lane_id: laneId, started_at: new Date(this.now()).toISOString() })}\n`,
        );
        return { directory, token };
      } catch (error) {
        await rm(directory, { recursive: true, force: true });
        throw error;
      }
    }
    return null;
  }

  async release(entries) {
    const releaseEntry = async (entry) => {
      const owner = JSON.parse(await readFile(join(entry.directory, 'owner.json'), 'utf8'));
      if (owner.token !== entry.token) {
        throw new Error(`cross-run lock ownership changed before release: ${entry.directory}`);
      }
      await rm(entry.directory, { recursive: true, force: true });
    };
    const results = await Promise.allSettled(entries.map(releaseEntry));
    const failure = results.find((result) => result.status === 'rejected');
    if (failure) throw failure.reason;
  }
}

let receiptSequence = 0;
async function writeReceiptFile(path, receipt) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${receiptSequence += 1}.tmp`;
  await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`);
  await rename(temporary, path);
}

function serializableLane(record) {
  return {
    state: record.state,
    command: record.command,
    started_at: record.startedAt ?? null,
    finished_at: record.finishedAt ?? null,
    seconds: record.seconds ?? null,
    status: record.status ?? null,
    exit_code: record.exitCode ?? null,
    signal: record.signal ?? null,
    timed_out: record.timedOut ?? false,
    group_terminated_after_leader_exit: record.groupTerminatedAfterLeaderExit ?? false,
    spawn_error: record.spawnError ?? null,
    blocked_by: record.blockedBy ?? null,
    artifact_dir: record.artifactDir ?? null,
    lane_dir: record.laneDir ?? null,
    database: record.database ?? null,
    database_retained: record.databaseRetained ?? false,
    cleanup_error: record.cleanupError ?? null,
    interrupted_by: record.interruptedBy ?? null,
  };
}

// Runs a closed dependency graph.  `jobs` is intentionally opt-in at the CLI;
// the manifest's locks make a larger value safe without claiming it is faster.
export async function runExecutionPlan(
  laneIds,
  manifest,
  {
    jobs = 1,
    root = REPO_ROOT,
    runId,
    env = process.env,
    spawn = spawnChild,
    now = Date.now,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    cleanupTimeoutMs = DEFAULT_CLEANUP_TIMEOUT_MS,
    terminationGraceMilliseconds = DEFAULT_TERMINATION_GRACE_MS,
    signalSource = process,
    persistReceipt = writeReceiptFile,
    databaseProvider = createRepoLocalPostgresProvider({ env }),
    onStart = () => {},
    onResult = () => {},
    log = console.log,
  } = {},
) {
  validateExecutionManifest(manifest);
  positiveInteger(jobs, 'proof lane jobs');
  positiveInteger(cleanupTimeoutMs, 'proof lane cleanup timeout milliseconds');
  positiveInteger(terminationGraceMilliseconds, 'proof lane termination grace milliseconds');
  const maximumJobs = manifest.runner?.max_parallel;
  if (maximumJobs !== undefined && jobs > maximumJobs) {
    throw new Error(`proof lane jobs ${jobs} exceeds runner max_parallel ${maximumJobs}`);
  }
  const capacities = manifest.runner?.lock_capacities ?? { legacy: 1 };
  const planned = expandHardDependencies(laneIds, manifest);
  const run = createRunContext({ root, runId });
  await mkdir(run.runDir, { recursive: true });
  const records = new Map(
    planned.map((laneId) => [laneId, { state: 'pending', command: laneLabel(laneId, manifest.lanes[laneId]) }]),
  );
  const receipt = {
    schema: 1,
    id: run.id,
    state: 'running',
    started_at: new Date(now()).toISOString(),
    updated_at: new Date(now()).toISOString(),
    run_dir: run.runDir,
    lanes: {},
  };
  let receiptWrite = Promise.resolve();
  const refreshReceipt = async () => {
    receipt.updated_at = new Date(now()).toISOString();
    receipt.lanes = Object.fromEntries([...records].map(([id, record]) => [id, serializableLane(record)]));
    // Starts and finishes may race, but receipt persistence must not.  Capture
    // the state for this transition and queue one writer so a slower earlier
    // rename can never overwrite a newer snapshot.
    const snapshot = JSON.parse(JSON.stringify(receipt));
    receiptWrite = receiptWrite.then(async () => await persistReceipt(run.receiptPath, snapshot));
    await receiptWrite;
  };
  await refreshReceipt();

  const used = new Map();
  const running = new Map();
  const completedArtifacts = new Map();
  const crossRunLocks = new CrossRunLockManager({
    root: run.root,
    runId: run.id,
    capacities,
    now,
  });
  const activeProcesses = new Map();
  const activePreparations = new Map();
  const runnerAbort = new AbortController();
  let interruptedSignal = null;
  const interrupt = (signal) => {
    interruptedSignal ??= signal;
    failureSeen = true;
    if (!runnerAbort.signal.aborted) {
      runnerAbort.abort(new Error(`proof runner interrupted by ${interruptedSignal}`));
    }
    for (const controller of activePreparations.values()) {
      if (!controller.signal.aborted) controller.abort(runnerAbort.signal.reason);
    }
    // Active children must enter the monitor's TERM → KILL drain state, not
    // receive a one-shot TERM that a shell, browser, or test helper can ignore.
    for (const active of activeProcesses.values()) active.requestTermination('external');
  };
  const signalHandlers = new Map(
    ['SIGINT', 'SIGTERM', 'SIGHUP'].map((signal) => {
      const handler = () => interrupt(signal);
      signalSource.on(signal, handler);
      return [signal, handler];
    }),
  );
  const removeSignalHandlers = () => {
    for (const [signal, handler] of signalHandlers) signalSource.off(signal, handler);
  };
  let failureSeen = false;

  const start = async (laneId, claims, externalLocks) => {
    const record = records.get(laneId);
    const execution = laneExecution(laneId, manifest.lanes[laneId]);
    const preparationAbort = new AbortController();
    const abortPreparationForRunner = () => {
      if (!preparationAbort.signal.aborted) preparationAbort.abort(runnerAbort.signal.reason);
    };
    if (runnerAbort.signal.aborted) abortPreparationForRunner();
    else runnerAbort.signal.addEventListener('abort', abortPreparationForRunner, { once: true });
    const deadlineStartedAt = Date.now();
    let preparationTimedOut = false;
    const preparationDeadline = globalThis.setTimeout(() => {
      if (preparationAbort.signal.aborted) return;
      preparationTimedOut = true;
      preparationAbort.abort(new Error(`proof lane ${laneId} preparation timed out after ${execution.timeoutSeconds}s`));
    }, execution.timeoutSeconds * 1_000);
    activePreparations.set(laneId, preparationAbort);
    let invocation;
    let resourcesReleased = false;
    const fail = (error) => {
      record.state = 'failed';
      record.status = 1;
      const detail = error?.message ?? String(error);
      record.spawnError = record.spawnError ? `${record.spawnError}; ${detail}` : detail;
      failureSeen = true;
    };
    const releaseInvocation = async (success) => {
      if (!invocation || resourcesReleased) return;
      // Cleanup may itself fail; never retry a non-idempotent provider release.
      resourcesReleased = true;
      const cleanupScope = createBoundedAbortScope({
        parentSignal: runnerAbort.signal,
        timeoutMilliseconds: cleanupTimeoutMs,
        setTimeoutFn,
        clearTimeoutFn,
        label: `proof lane ${laneId} resource cleanup`,
      });
      try {
        await awaitAbortable(
          () => invocation.releaseResources({ success, signal: cleanupScope.signal }),
          cleanupScope.signal,
        );
      } catch (error) {
        const detail = cleanupScope.timedOut()
          ? `resource cleanup timed out: ${error?.message ?? error}`
          : `resource cleanup failed: ${error?.message ?? error}`;
        record.cleanupError = detail;
        // A failed provider release leaves database lifetime unknown. Treat it
        // as retained so operators never assume the disposable evidence is gone.
        if (invocation.database) record.databaseRetained = true;
        fail(new Error(detail));
      } finally {
        cleanupScope.dispose();
        record.databaseRetained ||= invocation.database?.retained ?? false;
        if (interruptedSignal) record.interruptedBy ??= interruptedSignal;
      }
    };
    claim(claims, used);
    record.state = 'running';
    record.startedAt = new Date(now()).toISOString();
    try {
      await refreshReceipt();
      onStart(laneId, { command: record.command, run, claims: Object.fromEntries(claims) });
      invocation = await prepareLaneInvocation({
        laneId,
        manifest,
        run,
        completedArtifacts,
        env,
        databaseProvider,
        signal: preparationAbort.signal,
        cleanupSignal: runnerAbort.signal,
        cleanupTimeoutMs,
        setTimeoutFn,
        clearTimeoutFn,
      });
      globalThis.clearTimeout(preparationDeadline);
      if (preparationAbort.signal.aborted) {
        throw preparationAbort.signal.reason instanceof Error
          ? preparationAbort.signal.reason
          : new Error(`proof lane ${laneId} preparation timed out`);
      }
      activePreparations.delete(laneId);
      record.artifactDir = invocation.artifactDir;
      record.laneDir = invocation.laneDir;
      record.database = invocation.database?.database ?? null;
      // A crash during the child process must still leave an exact diagnostic
      // directory/database identity in the receipt.
      await refreshReceipt();
      await appendFile(join(invocation.laneDir, 'lane.log'), `${record.command}\n`);
      log(`\n[proof ${run.id}] ${laneId}: ${record.command}`);
      if (interruptedSignal) throw new Error(`proof runner interrupted by ${interruptedSignal}`);
      const started = now();
      const detached = process.platform !== 'win32';
      const child = spawn(invocation.file, invocation.args, {
        cwd: invocation.cwd,
        env: invocation.env,
        stdio: 'inherit',
        detached,
      });
      const childMonitor = observeChildResult(child, {
        timeoutSeconds: Math.max(0.001, (deadlineStartedAt + execution.timeoutSeconds * 1_000 - Date.now()) / 1_000),
        setTimeoutFn,
        clearTimeoutFn,
        terminate: (signal) => terminateChildProcess(child, signal, detached),
        groupIsAlive: () => processGroupIsAlive(child, detached),
        terminationGraceMilliseconds,
      });
      const activeProcess = {
        requestTermination: (reason) => childMonitor.requestTermination(reason),
      };
      activeProcesses.set(laneId, activeProcess);
      if (interruptedSignal) activeProcess.requestTermination('external');
      const processResult = await childMonitor.result;
      activeProcesses.delete(laneId);
      record.seconds = Math.round((now() - started) / 100) / 10;
      record.exitCode = processResult.exitCode;
      record.signal = processResult.signal;
      record.timedOut = processResult.timedOut;
      record.spawnError = processResult.spawnError;
      record.groupTerminatedAfterLeaderExit = processResult.groupTerminatedAfterLeaderExit;
      if (processResult.groupTerminatedAfterLeaderExit) {
        record.spawnError = 'child process group outlived a successful leader and was terminated';
      }
      record.status = processResult.exitCode === 0 && !processResult.spawnError && !processResult.timedOut && !processResult.groupTerminatedAfterLeaderExit ? 0 : 1;
      if (interruptedSignal) {
        record.interruptedBy = interruptedSignal;
        record.status = 1;
        record.spawnError ??= `proof runner interrupted by ${interruptedSignal}`;
      }
      record.state = record.status === 0 ? 'passed' : 'failed';
      if (record.status !== 0) failureSeen = true;
      await releaseInvocation(record.status === 0);
      if (record.status === 0) completedArtifacts.set(laneId, invocation.artifactDir);
      await appendFile(join(invocation.laneDir, 'lane.log'), `${record.state} after ${record.seconds}s\n`);
    } catch (error) {
      if (preparationTimedOut) {
        record.timedOut = true;
        record.seconds ??= Math.round((now() - new Date(record.startedAt).getTime()) / 100) / 10;
      }
      if (interruptedSignal) record.interruptedBy ??= interruptedSignal;
      if (error?.cleanupError) record.cleanupError ??= error.cleanupError;
      if (error?.database) record.database ??= error.database;
      if (error?.databaseRetained) record.databaseRetained = true;
      fail(error);
      record.finishedAt = new Date(now()).toISOString();
    } finally {
      globalThis.clearTimeout(preparationDeadline);
      runnerAbort.signal.removeEventListener('abort', abortPreparationForRunner);
      activePreparations.delete(laneId);
      activeProcesses.delete(laneId);
      await releaseInvocation(false);
      try {
        await externalLocks.release();
      } catch (error) {
        fail(new Error(`cross-run lock cleanup failed: ${error?.message ?? error}`));
      }
      record.finishedAt ??= new Date(now()).toISOString();
      if (interruptedSignal) record.interruptedBy ??= interruptedSignal;
      release(claims, used);
      await refreshReceipt();
      onResult(laneId, {
        seconds: record.seconds ?? 0,
        measured_at: record.finishedAt,
        command: record.command,
        status: record.status ?? 1,
        artifact_dir: record.artifactDir ?? null,
        database: record.database ?? null,
      });
    }
  };

  try {
  while (true) {
    if (interruptedSignal) failureSeen = true;
    let changed = false;
    for (const laneId of planned) {
      const record = records.get(laneId);
      if (record.state !== 'pending') continue;
      const dependencies = dependenciesFor(laneId, manifest);
      const failedDependency = dependencies.find((dependency) => records.get(dependency)?.state === 'failed' || records.get(dependency)?.state === 'blocked');
      if (failedDependency) {
        record.state = 'blocked';
        record.blockedBy = failedDependency;
        changed = true;
      }
    }
    if (failureSeen) {
      for (const record of records.values()) {
        if (record.state === 'pending') {
          record.state = 'blocked';
          record.blockedBy = 'another lane failed';
          changed = true;
        }
      }
    }
    if (changed) await refreshReceipt();

    let startedAny = false;
    let waitingForCrossRunLock = false;
    if (!failureSeen) {
      for (const laneId of planned) {
        if (running.size >= jobs) break;
        const record = records.get(laneId);
        if (record.state !== 'pending') continue;
        if (!dependenciesFor(laneId, manifest).every((dependency) => records.get(dependency)?.state === 'passed')) continue;
        const claims = lockClaims(laneId, manifest.lanes[laneId], capacities);
        if (!hasCapacity(claims, used, capacities)) continue;
        let externalLocks;
        try {
          externalLocks = await crossRunLocks.acquire(claims, laneId);
        } catch (error) {
          record.state = 'failed';
          record.status = 1;
          record.spawnError = `could not acquire cross-run locks: ${error?.message ?? error}`;
          failureSeen = true;
          await refreshReceipt();
          continue;
        }
        if (!externalLocks) {
          waitingForCrossRunLock = true;
          continue;
        }
        const promise = start(laneId, claims, externalLocks).finally(() => running.delete(laneId));
        running.set(laneId, promise);
        startedAny = true;
      }
    }

    if (running.size > 0) {
      // Let all immediately compatible lanes start before waiting.  When no
      // lane started in this pass, capacity or dependencies require a finish.
      if (!startedAny || running.size >= jobs) await Promise.race(running.values());
      else await Promise.resolve();
      continue;
    }
    if (![...records.values()].some((record) => record.state === 'pending')) break;
    if (waitingForCrossRunLock) {
      // Another proof process owns one of the manifest resources.  This run
      // remains schedulable; leave its receipt running and retry admission
      // without consuming a job slot or treating a safe wait as failure.
      await new Promise((resolve) => setTimeout(resolve, 50));
      continue;
    }
    // A pending lane with no active work can only be invalid resource metadata;
    // convert it to a useful failed receipt instead of spinning forever.
    const stranded = [...records.entries()].find(([, record]) => record.state === 'pending');
    stranded[1].state = 'failed';
    stranded[1].status = 1;
    stranded[1].spawnError = `no schedulable resource capacity for ${stranded[0]}`;
    failureSeen = true;
    await refreshReceipt();
  }

  const finalizeReceipt = async () => {
    if (interruptedSignal) {
      failureSeen = true;
      receipt.interrupted_by = interruptedSignal;
    }
    receipt.state = failureSeen ? 'failed' : 'passed';
    receipt.finished_at = new Date(now()).toISOString();
    await refreshReceipt();
  };
  await finalizeReceipt();
  // A signal can arrive while the first terminal receipt is being persisted.
  // Persist a corrected terminal state before returning so cancellation cannot
  // escape as a successful proof run.
  if (interruptedSignal && receipt.state !== 'failed') await finalizeReceipt();
  return { run, receipt, success: !failureSeen && !interruptedSignal };
  } finally {
    removeSignalHandlers();
  }
}
