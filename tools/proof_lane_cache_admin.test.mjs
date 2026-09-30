import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  PROOF_CACHE_INPUT_SCHEMA,
  computeLaneProofKey,
  loadProofCacheHits,
  persistProofCacheEntries,
  proofCacheArtifactDigest,
  proofCachePaths,
  readProofCacheEntry,
} from './proof_lane_cache.mjs';
import {
  auditProofCacheMaintenance,
  applyProofCacheGc,
  applyReviewedProofCacheGcPlan,
  createProofCacheGcPlanReceipt,
  explainProofCacheLane,
  parseProofCacheArguments,
  planProofCacheGc,
  quarantineProofCacheReceiptStaging,
  readProofCacheGcPlan,
  requiresProofCacheMutationLock,
  scanProofCache,
  scanProofCacheReceiptStaging,
  writeImmutableReceipt,
  writeProofCacheGcRecovery,
  writeProofCacheGcPlan,
} from './proof_lane_cache_admin.mjs';

const toolchain = {
  platform: 'test', arch: 'test', os_release: 'test', node: 'test', npm: 'test',
  cargo: 'test', rustc: 'test', psql: 'test', postgres: 'test', pg_config: 'test',
};
const CRASH_FIXTURE = fileURLToPath(new URL('./proof_lane_cache_crash_fixture.mjs', import.meta.url));

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function receiptSha256(value) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function fixtureManifest() {
  return {
    cache_inputs: { version: 2, global: [], groups: {} },
    execution_inputs: { version: 1, packages: {}, targets: {} },
    lanes: {
      audit: {
        kind: 'shell', command: 'cargo test -p commands --test semantic_audit', assertion_targets: ['commands/test/semantic_audit'],
        execution: { class: 'cargo', timeout_seconds: 10, argv: ['cargo', 'test', '-p', 'commands'], resources: [] },
        cache_inputs: { groups: [], paths: [] },
        execution_inputs: [],
      },
    },
    areas: [{ id: 'audit', tier: 'frozen', paths: ['crates/commands/'], lanes: ['audit'] }],
  };
}

function fixtureMetadata(root) {
  return { packages: [{
    name: 'commands', manifest_path: join(root, 'crates/commands/Cargo.toml'), dependencies: [],
    targets: [
      { name: 'commands', kind: ['lib'], src_path: join(root, 'crates/commands/src/lib.rs') },
      { name: 'semantic_audit', kind: ['test'], src_path: join(root, 'crates/commands/tests/semantic_audit/main.rs') },
    ],
  }] };
}

function fixtureRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'fmarch-proof-cache-admin-'));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const contents = {
    'Cargo.lock': 'lock-v1',
    'Cargo.toml': '[workspace]',
    'package.json': '{}',
    'package-lock.json': '{}',
    'frontend/package.json': '{}',
    'frontend/package-lock.json': '{}',
    'rust-toolchain.toml': 'channel = "test"',
    'tools/proof_lane_cache.mjs': 'cache-v1',
    'tools/proof_lane_execution.mjs': 'execution-v1',
    'tools/proof_lane_select.mjs': 'selector-v1',
    'crates/commands/Cargo.toml': '[package]\nname="commands"',
    'crates/commands/src/lib.rs': 'version-0',
    'crates/database_schema/migrations/0001.sql': 'select 1;',
  };
  for (const [path, content] of Object.entries(contents)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return { root, files: Object.keys(contents).sort(), manifest: fixtureManifest(), metadata: fixtureMetadata(root) };
}

function computed(fixture) {
  return computeLaneProofKey('audit', fixture.manifest, {
    root: fixture.root, files: fixture.files, metadata: fixture.metadata, toolchain,
  });
}

function store(fixture, id) {
  const key = computed(fixture);
  const runDir = join(fixture.root, 'target/proof-lanes/runs', id);
  const artifactDir = join(runDir, 'artifacts/audit');
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(join(artifactDir, 'evidence.json'), `${JSON.stringify({ id })}\n`);
  const receiptPath = join(runDir, 'receipt.json');
  const receipt = { id, state: 'passed', lanes: { audit: { state: 'passed', status: 0, artifact_dir: artifactDir } } };
  writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`);
  assert.deepEqual(
    persistProofCacheEntries({ run: { runDir, receiptPath }, receipt }, new Map([['audit', key]]), { root: fixture.root }),
    ['audit'],
  );
  return key;
}

// Write the prior envelope and payload directly: the current writer must never
// be able to publish new evidence under this unsafe input contract.
function storeHistorical(fixture, id, inputSchema = 1) {
  const current = computed(fixture).payload;
  const payload = {
    schema: inputSchema,
    lane_id: 'audit',
    dependency_lane_ids: current.dependency_lane_ids,
    lanes: current.lanes,
    ...(inputSchema === 1 ? { areas: fixture.manifest.areas } : { runner: current.runner }),
    matchers: inputSchema === 1 ? fixture.files : current.matchers,
    inputs: current.inputs,
    toolchain: current.toolchain,
  };
  const key = { proofKey: receiptSha256(payload), payload };
  const paths = proofCachePaths(fixture.root, 'audit', key.proofKey);
  mkdirSync(paths.artifacts, { recursive: true });
  writeFileSync(join(paths.artifacts, 'evidence.json'), `${JSON.stringify({ id })}\n`);
  const lane = { state: 'passed', status: 0, artifact_dir: `historical-run/${id}/audit` };
  const sourceReceipt = JSON.stringify({ id, state: 'passed', lanes: { audit: lane } });
  const entry = {
    schema: 1,
    lane_id: 'audit',
    proof_key: key.proofKey,
    state: 'passed',
    created_at: '2026-08-30T10:00:00.000Z',
    source_receipt_id: id,
    source_receipt_sha256: createHash('sha256').update(sourceReceipt).digest('hex'),
    source_receipt: sourceReceipt,
    artifact_sha256: proofCacheArtifactDigest(paths.artifacts),
    lane,
    inputs: payload,
  };
  writeFileSync(paths.receipt, `${JSON.stringify(entry, null, 2)}\n`);
  return key;
}

function writeRunReceipt(root, id, receipt) {
  const directory = join(root, 'target/proof-lanes/runs', id);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'receipt.json'), `${JSON.stringify({ id, ...receipt })}\n`);
}

test('cache explanation deterministically identifies every changed input fingerprint', (t) => {
  const fixture = fixtureRoot(t);
  const prior = store(fixture, 'prior');
  writeFileSync(join(fixture.root, 'crates/commands/src/lib.rs'), 'version-1');
  const current = computed(fixture);
  const explanation = explainProofCacheLane('audit', fixture.manifest, {
    root: fixture.root,
    files: fixture.files,
    metadata: fixture.metadata,
    toolchain,
    computed: current,
  });

  assert.equal(explanation.status, 'miss');
  assert.equal(explanation.compared_to.proof_key, prior.proofKey);
  assert.deepEqual(explanation.changes.inputs.map(({ kind, path }) => ({ kind, path })), [
    { kind: 'changed', path: 'crates/commands/src/lib.rs' },
  ]);
  assert.equal(explanation.changes.toolchain.length, 0);
  assert.equal(explanation.changes.contract.length, 0);
});

for (const inputSchema of [1, 2]) test(`historical schema ${inputSchema} remains inspectable custody but cannot qualify current reuse`, (t) => {
  const fixture = fixtureRoot(t);
  const old = storeHistorical(fixture, 'historical', inputSchema);
  const paths = proofCachePaths(fixture.root, 'audit', old.proofKey);
  const originalBytes = readFileSync(paths.receipt);
  const options = {
    root: fixture.root, files: fixture.files, metadata: fixture.metadata, toolchain,
  };

  assert.throws(
    () => readProofCacheEntry(fixture.root, 'audit', old.proofKey),
    new RegExp(`cache input contract schema ${inputSchema} is obsolete; expected 3`),
  );
  const inspected = scanProofCache({ root: fixture.root });
  assert.equal(inspected[0].valid, true);
  assert.equal(inspected[0].inputSchema, inputSchema);
  assert.equal(inspected[0].inputContractCompatible, false);
  assert.equal(inspected[0].reason, undefined, 'obsolete evidence is not corrupt');

  const explanation = explainProofCacheLane('audit', fixture.manifest, options);
  assert.equal(explanation.status, 'miss');
  assert.equal(explanation.reason, 'input-contract-changed');
  assert.equal(explanation.compared_to.proof_key, old.proofKey);
  assert.equal(explanation.compared_to.input_contract_compatible, false);
  assert.deepEqual(explanation.changes.contract.find(({ field }) => field === 'schema'), {
    field: 'schema', before: inputSchema, after: PROOF_CACHE_INPUT_SCHEMA,
    before_sha256: receiptSha256(inputSchema), after_sha256: receiptSha256(PROOF_CACHE_INPUT_SCHEMA),
  });
  assert.equal(explanation.candidates[0].reuse_rejection, 'input-contract-changed');

  // Even an injected exact historical key cannot make the operator surface
  // claim reuse is safe under the new admission contract.
  const syntheticExact = explainProofCacheLane('audit', fixture.manifest, { ...options, computed: old });
  assert.equal(syntheticExact.status, 'miss');
  assert.equal(syntheticExact.reason, 'input-contract-changed');
  assert.equal(syntheticExact.exact_entry.valid, true);
  assert.equal(syntheticExact.exact_entry.input_contract_compatible, false);
  const reuse = loadProofCacheHits(['audit'], fixture.manifest, { ...options, computedKeys: new Map([['audit', old]]) });
  assert.equal(reuse.hits.size, 0);
  assert.match(reuse.misses.get('audit').reason, new RegExp(`schema ${inputSchema} is obsolete; expected 3`));
  assert.equal(readProofCacheEntry(fixture.root, 'audit', old.proofKey, { allowHistoricalInputs: true }).entry.inputs.schema, inputSchema);
  assert.deepEqual(readFileSync(paths.receipt), originalBytes, 'inspection preserves immutable evidence');
});

test('historical custody obeys receipt retention and immutable maintenance audit without schema reinterpretation', (t) => {
  const fixture = fixtureRoot(t);
  const retained = storeHistorical(fixture, 'historical-retained');
  writeFileSync(join(fixture.root, 'crates/commands/src/lib.rs'), 'unreferenced-history');
  const unreferenced = storeHistorical(fixture, 'historical-unreferenced');
  const current = computed(fixture);
  const currentProofKeys = new Map([['audit', current]]);
  const receipts = [{ receipt: {
    id: 'historical-full', state: 'passed', finished_at: '2026-08-30T10:01:00.000Z',
    context: { mode: 'full' }, lanes: { audit: { proof_key: retained.proofKey } },
  } }];
  const plan = planProofCacheGc({
    root: fixture.root, currentProofKeys, receipts, keepReceipts: 1,
    now: new Date('2026-08-30T10:02:00.000Z'),
  });
  assert.equal(plan.entries.find(({ proofKey }) => proofKey === retained.proofKey).action, 'retain');
  assert.equal(plan.entries.find(({ proofKey }) => proofKey === unreferenced.proofKey).action, 'delete');
  const saved = writeProofCacheGcPlan(plan);
  assert.equal(saved.receipt.schema, 1);
  for (const entry of saved.receipt.inventory) {
    assert.equal(entry.valid, true);
    assert.equal(entry.reason, null);
    assert.equal('input_schema' in entry, false, 'historical inventory hash shape remains unchanged');
    assert.equal('input_contract_compatible' in entry, false);
  }
  const applied = applyReviewedProofCacheGcPlan(saved.path, {
    root: fixture.root, currentProofKeys, receipts, now: new Date('2026-08-30T10:03:00.000Z'),
  });
  assert.equal(applied.application.intent.schema, 1);
  assert.equal(applied.result.receipt.schema, 1);
  assert.deepEqual(applied.changed, [{ action: 'delete', lane_id: 'audit', proof_key: unreferenced.proofKey }]);
  assert.equal(existsSync(proofCachePaths(fixture.root, 'audit', retained.proofKey).receipt), true);
  assert.equal(auditProofCacheMaintenance({ root: fixture.root }).state, 'clean');

  // Audit binds the recorded post-inventory, not today's cache admission policy
  // or today's inventory. Later additions must not rewrite historical truth.
  store(fixture, 'new-contract');
  assert.equal(auditProofCacheMaintenance({ root: fixture.root }).state, 'clean');
});

test('historical cache inspection still rejects corruption and unknown input contracts', (t) => {
  const fixture = fixtureRoot(t);
  const corrupt = storeHistorical(fixture, 'historical-corrupt');
  const corruptPaths = proofCachePaths(fixture.root, 'audit', corrupt.proofKey);
  writeFileSync(join(corruptPaths.artifacts, 'evidence.json'), 'corrupt');
  const scanned = scanProofCache({ root: fixture.root });
  assert.equal(scanned[0].valid, false);
  assert.match(scanned[0].reason, /artifact digest/);
  const plan = planProofCacheGc({ root: fixture.root, currentProofKeys: new Map([['audit', corrupt]]), keepReceipts: 0 });
  assert.equal(plan.entries[0].action, 'quarantine');

  writeFileSync(join(fixture.root, 'crates/commands/src/lib.rs'), 'unknown-contract');
  const unknown = storeHistorical(fixture, 'unknown');
  const unknownPaths = proofCachePaths(fixture.root, 'audit', unknown.proofKey);
  const entry = JSON.parse(readFileSync(unknownPaths.receipt, 'utf8'));
  entry.inputs.schema = 999;
  entry.proof_key = receiptSha256(entry.inputs);
  const moved = proofCachePaths(fixture.root, 'audit', entry.proof_key);
  cpSync(unknownPaths.directory, moved.directory, { recursive: true });
  writeFileSync(moved.receipt, `${JSON.stringify(entry, null, 2)}\n`);
  assert.throws(
    () => readProofCacheEntry(fixture.root, 'audit', entry.proof_key, { allowHistoricalInputs: true }),
    /input contract schema/,
  );
});

test('GC protects a preempted receipt because the sweep supervisor will resume it', (t) => {
  const fixture = fixtureRoot(t);
  writeFileSync(join(fixture.root, 'crates/commands/src/lib.rs'), 'preempted-key');
  const preemptedKey = store(fixture, 'source-preempted');
  writeFileSync(join(fixture.root, 'crates/commands/src/lib.rs'), 'current-key');
  const currentKey = store(fixture, 'source-current');

  // `preempted` is terminal-looking but resumable: evicting what it references
  // between the preemption and the auto-resume silently forces a re-run.
  writeRunReceipt(fixture.root, 'preempted', {
    state: 'preempted', updated_at: '2026-08-30T10:01:00.000Z', context: { mode: 'full' },
    lanes: { audit: { reused_from_proof_key: preemptedKey.proofKey } },
  });

  const plan = planProofCacheGc({
    root: fixture.root,
    currentProofKeys: new Map([['audit', currentKey]]),
    keepReceipts: 1,
    receipts: undefined,
  });
  assert.deepEqual(plan.in_flight_receipts.map(({ id }) => id), ['preempted']);
  assert.equal(plan.entries.find((entry) => entry.proofKey === preemptedKey.proofKey).action, 'retain');
});

test('in-flight protection is bounded by recency so abandoned runners cannot wedge GC', (t) => {
  const fixture = fixtureRoot(t);
  const stale = [];
  // Nothing ever reaps these: a SIGKILLed runner stays `running` and every
  // preemption leaves a permanent `preempted` receipt. Protecting all of them
  // would raise the protected floor until no plan can satisfy a disk budget.
  for (const [index, state] of ['running', 'preempted', 'running', 'preempted'].entries()) {
    writeFileSync(join(fixture.root, 'crates/commands/src/lib.rs'), `abandoned-${index}`);
    const key = store(fixture, `abandoned-${index}`);
    stale.push(key);
    writeRunReceipt(fixture.root, `abandoned-${index}`, {
      state, updated_at: `2026-08-2${index}T10:00:00.000Z`, context: { mode: 'full' },
      lanes: { audit: { reused_from_proof_key: key.proofKey } },
    });
  }
  writeFileSync(join(fixture.root, 'crates/commands/src/lib.rs'), 'live-key');
  const liveKey = store(fixture, 'live');
  writeRunReceipt(fixture.root, 'live', {
    state: 'running', updated_at: '2026-09-04T10:00:00.000Z', context: { mode: 'full' },
    lanes: { audit: { reused_from_proof_key: liveKey.proofKey } },
  });
  writeFileSync(join(fixture.root, 'crates/commands/src/lib.rs'), 'current-key');
  const currentKey = store(fixture, 'source-current');

  const plan = planProofCacheGc({
    root: fixture.root,
    currentProofKeys: new Map([['audit', currentKey]]),
    keepReceipts: 2,
    receipts: undefined,
  });
  // The two most recently updated in-flight receipts keep their keys; the
  // older abandoned pair is reclaimable like any other unreachable history.
  assert.deepEqual(plan.in_flight_receipts.map(({ id }) => id), ['live', 'abandoned-3']);
  const action = (key) => plan.entries.find((entry) => entry.proofKey === key.proofKey).action;
  assert.equal(action(liveKey), 'retain');
  assert.equal(action(stale[3]), 'retain');
  assert.equal(action(stale[0]), 'delete');
  assert.equal(action(stale[1]), 'delete');
  assert.equal(action(stale[2]), 'delete');
});

test('a failed receipt awaiting --resume is not protected, because a resume never reads the cache', (t) => {
  const fixture = fixtureRoot(t);
  writeFileSync(join(fixture.root, 'crates/commands/src/lib.rs'), 'failed-key');
  const failedKey = store(fixture, 'source-failed');
  writeFileSync(join(fixture.root, 'crates/commands/src/lib.rs'), 'current-key');
  const currentKey = store(fixture, 'source-current');

  // `--resume` rebuilds reuse from the receipt's own lane records and builds no
  // cache plan at all, so an evicted entry costs a pending resume nothing. The
  // set of resumable failed receipts is unbounded, so protecting them would
  // eventually make the protected floor unsatisfiable.
  writeRunReceipt(fixture.root, 'failed', {
    state: 'failed', updated_at: '2026-09-04T10:00:00.000Z', context: { mode: 'full' },
    lanes: { audit: { reused_from_proof_key: failedKey.proofKey } },
  });

  const plan = planProofCacheGc({
    root: fixture.root,
    currentProofKeys: new Map([['audit', currentKey]]),
    keepReceipts: 10,
    receipts: undefined,
  });
  assert.deepEqual(plan.in_flight_receipts, []);
  assert.equal(plan.entries.find((entry) => entry.proofKey === failedKey.proofKey).action, 'delete');
});

test('GC retains current, recent receipt, and in-flight keys while deleting unreachable history', (t) => {
  const fixture = fixtureRoot(t);
  writeFileSync(join(fixture.root, 'crates/commands/src/lib.rs'), 'receipt-key');
  const receiptKey = store(fixture, 'source-receipt');
  writeFileSync(join(fixture.root, 'crates/commands/src/lib.rs'), 'old-key');
  const oldKey = store(fixture, 'source-old');
  writeFileSync(join(fixture.root, 'crates/commands/src/lib.rs'), 'in-flight-key');
  const inFlightKey = store(fixture, 'source-running');
  writeFileSync(join(fixture.root, 'crates/commands/src/lib.rs'), 'current-key');
  const currentKey = store(fixture, 'source-current');

  writeRunReceipt(fixture.root, 'terminal-new', {
    state: 'passed', finished_at: '2026-08-30T10:00:00.000Z', context: { mode: 'full' },
    lanes: { audit: { proof_key: receiptKey.proofKey } },
  });
  writeRunReceipt(fixture.root, 'terminal-old', {
    state: 'passed', finished_at: '2026-08-29T10:00:00.000Z', context: { mode: 'full' },
    lanes: { audit: { proof_key: oldKey.proofKey } },
  });
  writeRunReceipt(fixture.root, 'running', {
    state: 'running', updated_at: '2026-08-30T10:01:00.000Z', context: { mode: 'full' },
    lanes: { audit: { reused_from_proof_key: inFlightKey.proofKey } },
  });

  const plan = planProofCacheGc({
    root: fixture.root,
    currentProofKeys: new Map([['audit', currentKey]]),
    keepReceipts: 1,
    receipts: undefined,
  });
  const action = (proofKey) => plan.entries.find((entry) => entry.proofKey === proofKey).action;
  assert.equal(action(receiptKey.proofKey), 'retain');
  assert.equal(action(oldKey.proofKey), 'delete');
  assert.equal(action(inFlightKey.proofKey), 'retain');
  assert.equal(action(currentKey.proofKey), 'retain');
  assert.deepEqual(plan.terminal_receipts.map(({ id }) => id), ['terminal-new']);
  assert.deepEqual(plan.in_flight_receipts.map(({ id }) => id), ['running']);
  assert.deepEqual(applyProofCacheGc(plan), [
    { action: 'delete', lane_id: 'audit', proof_key: oldKey.proofKey },
  ]);
  assert.equal(existsSync(proofCachePaths(fixture.root, 'audit', oldKey.proofKey).directory), false);
  assert.equal(existsSync(proofCachePaths(fixture.root, 'audit', receiptKey.proofKey).directory), true);
  assert.equal(existsSync(proofCachePaths(fixture.root, 'audit', inFlightKey.proofKey).directory), true);
  assert.equal(existsSync(proofCachePaths(fixture.root, 'audit', currentKey.proofKey).directory), true);
});

test('GC dry-run is inert and apply quarantines corrupt entries', (t) => {
  const fixture = fixtureRoot(t);
  const key = store(fixture, 'corrupt-source');
  const paths = proofCachePaths(fixture.root, 'audit', key.proofKey);
  writeFileSync(join(paths.artifacts, 'evidence.json'), 'corrupt');
  const before = scanProofCache({ root: fixture.root });
  assert.equal(before[0].valid, false);

  const plan = planProofCacheGc({ root: fixture.root, currentProofKeys: new Map(), keepReceipts: 0 });
  assert.equal(plan.entries[0].action, 'quarantine');
  assert.equal(existsSync(paths.directory), true, 'planning must remain a dry-run');
  assert.deepEqual(applyProofCacheGc(plan), [{ action: 'quarantine', lane_id: 'audit', proof_key: key.proofKey }]);
  assert.equal(existsSync(paths.directory), false);
  assert.equal(existsSync(plan.entries[0].quarantine), true);
});

test('disk budget fails closed when protected evidence alone exceeds it', (t) => {
  const fixture = fixtureRoot(t);
  const current = store(fixture, 'current');
  const plan = planProofCacheGc({
    root: fixture.root,
    currentProofKeys: new Map([['audit', current]]),
    keepReceipts: 0,
    maxBytes: 0,
  });
  assert.equal(plan.entries[0].action, 'retain');
  assert.equal(plan.budget_satisfied, false);
  assert.ok(plan.retained_bytes > 0);
});

test('only mutating maintenance commands require the proof host lock', () => {
  assert.equal(requiresProofCacheMutationLock(['gc', '--apply', 'plan.json']), true);
  assert.equal(requiresProofCacheMutationLock(['audit', '--recover', 'plan-id']), true);
  assert.equal(requiresProofCacheMutationLock(['audit', '--quarantine-staging']), true);
  assert.equal(requiresProofCacheMutationLock(['audit']), false);
  assert.equal(requiresProofCacheMutationLock(['gc', '--dry-run']), false);
  assert.equal(requiresProofCacheMutationLock(['explain', 'audit']), false);
});

test('cache CLI rejects contradictory mutation intent and GC flags on explain', () => {
  assert.throws(
    () => parseProofCacheArguments(['gc', '--apply', 'plan.json', '--dry-run']),
    /mutually exclusive/,
  );
  assert.throws(
    () => parseProofCacheArguments(['gc', '--apply', 'plan.json', '--keep-receipts', '2']),
    /policy comes from/,
  );
  assert.throws(
    () => parseProofCacheArguments(['gc']),
    /requires either/,
  );
  assert.throws(
    () => parseProofCacheArguments(['gc', '--apply', '--json']),
    /requires an immutable plan path/,
  );
  assert.throws(
    () => parseProofCacheArguments(['explain', 'audit', '--max-bytes', '1']),
    /accepts only/,
  );
  assert.deepEqual(parseProofCacheArguments(['audit', '--json']), {
    command: 'audit', json: true, recover: null, quarantineStaging: false,
    keepReceipts: 10, maxBytes: Number.POSITIVE_INFINITY,
  });
  assert.equal(parseProofCacheArguments(['audit', '--quarantine-staging']).quarantineStaging, true);
  assert.throws(
    () => parseProofCacheArguments(['audit', '--quarantine-staging', '--recover', 'plan-id']),
    /mutually exclusive/,
  );
  assert.throws(() => parseProofCacheArguments(['audit', '--max-bytes', '1']), /requires --recover/);
});

test('immutable GC plan receipts detect tampering before revalidation', (t) => {
  const fixture = fixtureRoot(t);
  const current = store(fixture, 'current');
  const plan = planProofCacheGc({
    root: fixture.root,
    currentProofKeys: new Map([['audit', current]]),
    keepReceipts: 0,
    now: new Date('2026-08-30T12:00:00.000Z'),
    receipts: [],
  });
  const created = createProofCacheGcPlanReceipt(plan);
  assert.equal(created.basis_sha256.length, 64);
  assert.equal(created.plan_sha256.length, 64);
  const saved = writeProofCacheGcPlan(plan);
  const raw = JSON.parse(readFileSync(saved.path, 'utf8'));
  raw.summary.retained_bytes += 1;
  writeFileSync(saved.path, `${JSON.stringify(raw, null, 2)}\n`);
  assert.throws(() => readProofCacheGcPlan(saved.path, { root: fixture.root }), /digest does not match/);
});

test('reviewed GC apply rejects stale cache state without creating an intent', (t) => {
  const fixture = fixtureRoot(t);
  const old = store(fixture, 'old');
  writeFileSync(join(fixture.root, 'crates/commands/src/lib.rs'), 'current');
  const current = computed(fixture);
  const plan = planProofCacheGc({
    root: fixture.root,
    currentProofKeys: new Map([['audit', current]]),
    keepReceipts: 0,
    now: new Date('2026-08-30T12:01:00.000Z'),
    receipts: [],
  });
  const saved = writeProofCacheGcPlan(plan);
  writeFileSync(join(proofCachePaths(fixture.root, 'audit', old.proofKey).artifacts, 'evidence.json'), 'changed-after-review');

  assert.throws(
    () => applyReviewedProofCacheGcPlan(saved.path, {
      root: fixture.root,
      currentProofKeys: new Map([['audit', current]]),
      receipts: [],
      now: new Date('2026-08-30T12:02:00.000Z'),
    }),
    /plan is stale/,
  );
  assert.equal(existsSync(proofCachePaths(fixture.root, 'audit', old.proofKey).directory), true);
  assert.equal(existsSync(join(fixture.root, 'target/proof-lanes/cache-maintenance/applications', saved.receipt.id)), false);
});

test('reviewed GC apply executes exactly once and writes intent and result receipts', (t) => {
  const fixture = fixtureRoot(t);
  const old = store(fixture, 'old');
  writeFileSync(join(fixture.root, 'crates/commands/src/lib.rs'), 'current');
  const current = computed(fixture);
  const plan = planProofCacheGc({
    root: fixture.root,
    currentProofKeys: new Map([['audit', current]]),
    keepReceipts: 0,
    now: new Date('2026-08-30T12:03:00.000Z'),
    receipts: [],
  });
  const saved = writeProofCacheGcPlan(plan);
  const applied = applyReviewedProofCacheGcPlan(saved.path, {
    root: fixture.root,
    currentProofKeys: new Map([['audit', current]]),
    receipts: [],
    now: new Date('2026-08-30T12:04:00.000Z'),
  });

  assert.deepEqual(applied.changed, [{ action: 'delete', lane_id: 'audit', proof_key: old.proofKey }]);
  assert.equal(existsSync(proofCachePaths(fixture.root, 'audit', old.proofKey).directory), false);
  assert.equal(JSON.parse(readFileSync(applied.application.path, 'utf8')).state, 'applying');
  assert.equal(JSON.parse(readFileSync(applied.result.path, 'utf8')).state, 'applied');
  assert.throws(
    () => applyReviewedProofCacheGcPlan(saved.path, {
      root: fixture.root,
      currentProofKeys: new Map([['audit', current]]),
      receipts: [],
    }),
    /already attempted/,
  );
});

test('maintenance audit proves application hashes, linkage, actions, and historical post-inventory', (t) => {
  const fixture = fixtureRoot(t);
  const old = store(fixture, 'old');
  writeFileSync(join(fixture.root, 'crates/commands/src/lib.rs'), 'current');
  const current = computed(fixture);
  const plan = planProofCacheGc({
    root: fixture.root,
    currentProofKeys: new Map([['audit', current]]),
    keepReceipts: 0,
    now: new Date('2026-08-30T13:00:00.000Z'),
    receipts: [],
  });
  const saved = writeProofCacheGcPlan(plan);
  const applied = applyReviewedProofCacheGcPlan(saved.path, {
    root: fixture.root,
    currentProofKeys: new Map([['audit', current]]),
    receipts: [],
    now: new Date('2026-08-30T13:01:00.000Z'),
  });
  assert.equal(auditProofCacheMaintenance({ root: fixture.root }).state, 'clean');

  const result = JSON.parse(readFileSync(applied.result.path, 'utf8'));
  result.post_inventory_sha256 = '0'.repeat(64);
  const { result_sha256: ignored, ...base } = result;
  result.result_sha256 = receiptSha256(base);
  writeFileSync(applied.result.path, `${JSON.stringify(result, null, 2)}\n`);
  const audit = auditProofCacheMaintenance({ root: fixture.root });
  assert.equal(audit.state, 'attention');
  assert.deepEqual(audit.issues.map(({ code }) => code), ['invalid-application-result']);
  assert.match(audit.issues[0].message, /post-inventory digest/);
  assert.equal(existsSync(proofCachePaths(fixture.root, 'audit', old.proofKey).directory), false);
});

test('interrupted applications recover through a fresh linked plan and never replay the source', (t) => {
  const fixture = fixtureRoot(t);
  store(fixture, 'old');
  writeFileSync(join(fixture.root, 'crates/commands/src/lib.rs'), 'current');
  const current = computed(fixture);
  const sourcePlan = planProofCacheGc({
    root: fixture.root,
    currentProofKeys: new Map([['audit', current]]),
    keepReceipts: 0,
    now: new Date('2026-08-30T14:00:00.000Z'),
    receipts: [],
  });
  const source = writeProofCacheGcPlan(sourcePlan);
  const sourceApplication = applyReviewedProofCacheGcPlan(source.path, {
    root: fixture.root,
    currentProofKeys: new Map([['audit', current]]),
    receipts: [],
    now: new Date('2026-08-30T14:01:00.000Z'),
  });
  rmSync(sourceApplication.result.path);
  let audit = auditProofCacheMaintenance({ root: fixture.root });
  assert.deepEqual(audit.issues.map(({ code }) => code), ['application-orphaned']);

  const recovery = writeProofCacheGcRecovery(source.receipt.id, {
    root: fixture.root,
    currentProofKeys: new Map([['audit', current]]),
    keepReceipts: 0,
    receipts: [],
    now: new Date('2026-08-30T14:02:00.000Z'),
  });
  assert.notEqual(recovery.saved.receipt.id, source.receipt.id);
  audit = auditProofCacheMaintenance({ root: fixture.root });
  assert.deepEqual(audit.issues.map(({ code }) => code), ['recovery-pending']);
  assert.throws(
    () => applyReviewedProofCacheGcPlan(source.path, {
      root: fixture.root, currentProofKeys: new Map([['audit', current]]), receipts: [],
    }),
    /already attempted/,
  );

  applyReviewedProofCacheGcPlan(recovery.saved.path, {
    root: fixture.root,
    currentProofKeys: new Map([['audit', current]]),
    receipts: [],
    now: new Date('2026-08-30T14:03:00.000Z'),
  });
  audit = auditProofCacheMaintenance({ root: fixture.root });
  assert.equal(audit.state, 'clean');
  assert.deepEqual(audit.recoveries, [{ source_plan_id: source.receipt.id, recovery_plan_id: recovery.saved.receipt.id }]);
});

test('immutable receipt publication is exclusive and leaves no staging after durable completion', (t) => {
  const fixture = fixtureRoot(t);
  const path = join(fixture.root, 'receipt-publication', 'receipt.json');
  const receipt = { schema: 1, kind: 'publication-proof', payload: 'durable' };
  assert.equal(writeImmutableReceipt(path, receipt), path);
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), receipt);
  assert.deepEqual(readdirSync(join(fixture.root, 'receipt-publication')), ['receipt.json']);
  assert.throws(() => writeImmutableReceipt(path, receipt), /already exists/);
});

test('SIGKILL at every receipt publication stage exposes only absent or complete final receipts', (t) => {
  const stages = [
    'after-stage-create',
    'after-stage-directory-sync',
    'after-stage-write',
    'after-file-sync',
    'after-publish',
    'after-publish-directory-sync',
    'after-stage-remove',
    'after-directory-sync',
  ];
  const receipt = { schema: 1, kind: 'publication-proof', payload: 'x'.repeat(4096) };
  const expectedBytes = `${JSON.stringify(receipt, null, 2)}\n`;

  for (const [index, crashAt] of stages.entries()) {
    const fixture = fixtureRoot(t);
    const directory = join(fixture.root, 'receipt-publication');
    const receiptPath = join(directory, 'receipt.json');
    const configPath = join(fixture.root, 'publication-crash.json');
    writeFileSync(configPath, `${JSON.stringify({
      mode: 'receipt-publication',
      receipt_path: receiptPath,
      receipt,
      crash_at: crashAt,
    }, null, 2)}\n`);

    const child = spawnSync(process.execPath, [CRASH_FIXTURE, configPath], { encoding: 'utf8' });
    assert.ifError(child.error);
    assert.equal(child.signal, 'SIGKILL', `${crashAt}: ${child.stderr}`);
    assert.equal(child.status, null, `${crashAt}: ${child.stderr}`);

    const finalExpected = index >= stages.indexOf('after-publish');
    const stageExpected = index <= stages.indexOf('after-publish-directory-sync');
    assert.equal(existsSync(receiptPath), finalExpected, `${crashAt} final publication state`);
    if (finalExpected) assert.equal(readFileSync(receiptPath, 'utf8'), expectedBytes, `${crashAt} published torn bytes`);
    const names = readdirSync(directory);
    assert.equal(names.some((name) => name.startsWith('.receipt.json.stage-')), stageExpected, `${crashAt} staging state`);
  }
});

test('maintenance audit identifies and safely quarantines abandoned receipt staging', (t) => {
  const fixture = fixtureRoot(t);
  const receiptPath = join(fixture.root, 'target/proof-lanes/cache-maintenance/plans/probe.json');
  const receipt = { schema: 1, kind: 'publication-proof', payload: 'staged' };
  const configPath = join(fixture.root, 'publication-crash.json');
  writeFileSync(configPath, `${JSON.stringify({
    mode: 'receipt-publication',
    receipt_path: receiptPath,
    receipt,
    crash_at: 'after-stage-write',
  }, null, 2)}\n`);
  const child = spawnSync(process.execPath, [CRASH_FIXTURE, configPath], { encoding: 'utf8' });
  assert.equal(child.signal, 'SIGKILL');

  let audit = auditProofCacheMaintenance({ root: fixture.root });
  assert.equal(audit.state, 'attention');
  assert.equal(audit.summary.staging_count, 1);
  assert.deepEqual(audit.issues.map(({ code }) => code), ['abandoned-receipt-staging']);
  const [staging] = scanProofCacheReceiptStaging({ root: fixture.root });
  assert.equal(staging.valid, true);
  assert.ok(staging.bytes > 0);

  const [moved] = quarantineProofCacheReceiptStaging({
    root: fixture.root,
    now: new Date('2026-08-30T18:00:00.000Z'),
  });
  assert.equal(moved.source, staging.path);
  assert.equal(existsSync(moved.source), false);
  assert.equal(existsSync(moved.destination), true);
  assert.deepEqual(JSON.parse(readFileSync(moved.destination, 'utf8')), receipt);
  audit = auditProofCacheMaintenance({ root: fixture.root });
  assert.equal(audit.state, 'clean');
  assert.equal(audit.summary.staging_count, 0);
});

test('maintenance quarantine never takes staging from a live writer pid', (t) => {
  const fixture = fixtureRoot(t);
  const receiptPath = join(fixture.root, 'target/proof-lanes/cache-maintenance/plans/probe.json');
  assert.throws(
    () => writeImmutableReceipt(receiptPath, { kind: 'publication-proof' }, {
      onCheckpoint: ({ name }) => {
        if (name === 'after-stage-write') throw new Error('hold live staging');
      },
    }),
    /hold live staging/,
  );
  const audit = auditProofCacheMaintenance({ root: fixture.root });
  assert.equal(audit.state, 'clean');
  assert.equal(audit.summary.staging_count, 1);
  assert.equal(audit.summary.active_staging_count, 1);
  assert.deepEqual(quarantineProofCacheReceiptStaging({ root: fixture.root }), []);
  assert.equal(scanProofCacheReceiptStaging({ root: fixture.root }).length, 1);
});

test('real process death at every GC persistence boundary recovers without losing protected evidence', (t) => {
  const scenarios = [
    { crashAt: 'after-intent', oldEntriesRemaining: 2, hour: 15 },
    { crashAt: 'after-action:1', oldEntriesRemaining: 1, hour: 16 },
    { crashAt: 'before-result', oldEntriesRemaining: 0, hour: 17 },
  ];

  for (const scenario of scenarios) {
    const fixture = fixtureRoot(t);
    writeFileSync(join(fixture.root, 'crates/commands/src/lib.rs'), `${scenario.crashAt}-old-a`);
    const oldA = store(fixture, `${scenario.crashAt}-old-a`);
    writeFileSync(join(fixture.root, 'crates/commands/src/lib.rs'), `${scenario.crashAt}-old-b`);
    const oldB = store(fixture, `${scenario.crashAt}-old-b`);
    writeFileSync(join(fixture.root, 'crates/commands/src/lib.rs'), `${scenario.crashAt}-current`);
    const current = store(fixture, `${scenario.crashAt}-current`);
    const prefix = `2026-08-30T${String(scenario.hour).padStart(2, '0')}`;
    const sourcePlan = planProofCacheGc({
      root: fixture.root,
      currentProofKeys: new Map([['audit', current]]),
      keepReceipts: 0,
      now: new Date(`${prefix}:00:00.000Z`),
      receipts: [],
    });
    assert.equal(sourcePlan.entries.filter(({ action }) => action === 'delete').length, 2);
    const source = writeProofCacheGcPlan(sourcePlan);
    const configPath = join(fixture.root, 'crash-config.json');
    writeFileSync(configPath, `${JSON.stringify({
      root: fixture.root,
      plan_path: source.path,
      current_proof_keys: { audit: current.proofKey },
      now: `${prefix}:01:00.000Z`,
      crash_at: scenario.crashAt,
    }, null, 2)}\n`);

    const child = spawnSync(process.execPath, [CRASH_FIXTURE, configPath], { encoding: 'utf8' });
    assert.ifError(child.error);
    assert.equal(child.signal, 'SIGKILL', `${scenario.crashAt}: ${child.stderr}`);
    assert.equal(child.status, null, `${scenario.crashAt}: ${child.stderr}`);

    let audit = auditProofCacheMaintenance({ root: fixture.root });
    assert.deepEqual(audit.issues.map(({ code }) => code), ['application-orphaned'], scenario.crashAt);
    assert.equal(
      existsSync(proofCachePaths(fixture.root, 'audit', current.proofKey).directory),
      true,
      `${scenario.crashAt} removed protected current evidence`,
    );
    const oldKeys = [oldA, oldB];
    assert.equal(
      oldKeys.filter((key) => existsSync(proofCachePaths(fixture.root, 'audit', key.proofKey).directory)).length,
      scenario.oldEntriesRemaining,
      `${scenario.crashAt} stopped at the wrong mutation boundary`,
    );
    assert.throws(
      () => applyReviewedProofCacheGcPlan(source.path, {
        root: fixture.root,
        currentProofKeys: new Map([['audit', current]]),
        receipts: [],
      }),
      /already attempted/,
      `${scenario.crashAt} source plan was replayable`,
    );

    const recovery = writeProofCacheGcRecovery(source.receipt.id, {
      root: fixture.root,
      currentProofKeys: new Map([['audit', current]]),
      keepReceipts: 0,
      receipts: [],
      now: new Date(`${prefix}:02:00.000Z`),
    });
    assert.notEqual(recovery.saved.receipt.id, source.receipt.id);
    applyReviewedProofCacheGcPlan(recovery.saved.path, {
      root: fixture.root,
      currentProofKeys: new Map([['audit', current]]),
      receipts: [],
      now: new Date(`${prefix}:03:00.000Z`),
    });

    audit = auditProofCacheMaintenance({ root: fixture.root });
    assert.equal(audit.state, 'clean', `${scenario.crashAt}: ${JSON.stringify(audit.issues)}`);
    assert.equal(existsSync(proofCachePaths(fixture.root, 'audit', current.proofKey).directory), true);
    for (const old of oldKeys) {
      assert.equal(existsSync(proofCachePaths(fixture.root, 'audit', old.proofKey).directory), false);
    }
  }
});
