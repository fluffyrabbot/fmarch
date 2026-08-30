import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { computeLaneProofKey, persistProofCacheEntries, proofCachePaths } from './proof_lane_cache.mjs';
import {
  applyProofCacheGc,
  explainProofCacheLane,
  parseProofCacheArguments,
  planProofCacheGc,
  requiresProofCacheMutationLock,
  scanProofCache,
} from './proof_lane_cache_admin.mjs';

const toolchain = {
  platform: 'test', arch: 'test', os_release: 'test', node: 'test', npm: 'test',
  cargo: 'test', rustc: 'test', psql: 'test', postgres: 'test', pg_config: 'test',
};

function fixtureManifest() {
  return {
    lanes: {
      audit: {
        kind: 'shell', command: 'cargo test -p commands --test semantic_audit', assertion_targets: ['commands/test/semantic_audit'],
        execution: { class: 'cargo', timeout_seconds: 10, argv: ['cargo', 'test', '-p', 'commands'], resources: [] },
      },
    },
    areas: [{ id: 'audit', tier: 'frozen', paths: ['crates/commands/'], lanes: ['audit'] }],
  };
}

function fixtureMetadata(root) {
  return { packages: [{ name: 'commands', manifest_path: join(root, 'crates/commands/Cargo.toml'), dependencies: [] }] };
}

function fixtureRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'fmarch-proof-cache-admin-'));
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
  assert.deepEqual(plan.terminal_receipts, ['terminal-new']);
  assert.deepEqual(plan.in_flight_receipts, ['running']);
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

test('only an applying GC requires the proof host mutation lock', () => {
  assert.equal(requiresProofCacheMutationLock(['gc', '--apply']), true);
  assert.equal(requiresProofCacheMutationLock(['gc', '--dry-run']), false);
  assert.equal(requiresProofCacheMutationLock(['explain', 'audit']), false);
});

test('cache CLI rejects contradictory mutation intent and GC flags on explain', () => {
  assert.throws(
    () => parseProofCacheArguments(['gc', '--apply', '--dry-run']),
    /mutually exclusive/,
  );
  assert.throws(
    () => parseProofCacheArguments(['explain', 'audit', '--max-bytes', '1']),
    /accepts only/,
  );
});
