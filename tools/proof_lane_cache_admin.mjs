// Explain and retain content-addressed proof-lane cache entries.
//
// This operator surface is intentionally separate from cache lookup/execution:
// inspection is read-only, while mutation is serialized by the same host lock
// as proof execution and is planned before any entry is moved or removed.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  computeLaneProofKey,
  frozenLaneIds,
  proofToolchain,
  readProofCacheEntry,
  safeProofLaneSegment,
  workspaceFiles,
  workspaceMetadata,
} from './proof_lane_cache.mjs';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const MANIFEST_PATH = join(REPO_ROOT, 'docs', 'ops', 'proof-lane-manifest.json');
const HOST_LOCK_SCRIPT = join(REPO_ROOT, 'scripts', 'with-heavy-build-lock.py');
const KEY_PATTERN = /^[a-f0-9]{64}$/;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stable(value)) ?? 'undefined';
}

function inside(root, candidate) {
  const path = relative(resolve(root), resolve(candidate));
  return path !== '' && !path.startsWith('..') && !path.startsWith('/');
}

function directoryBytes(directory) {
  let bytes = 0;
  const visit = (path) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      const metadata = lstatSync(child);
      if (metadata.isSymbolicLink()) throw new Error(`cache entry contains symlink ${child}`);
      if (metadata.isDirectory()) visit(child);
      else if (metadata.isFile()) bytes += metadata.size;
      else throw new Error(`cache entry contains unsupported file type ${child}`);
    }
  };
  visit(directory);
  return bytes;
}

function cacheRoots(root) {
  const base = join(root, 'target', 'proof-lanes');
  return {
    cache: join(base, 'cache'),
    quarantine: join(base, 'cache-quarantine'),
    runs: join(base, 'runs'),
  };
}

function timestamp(value) {
  const parsed = Date.parse(value ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
}

export function scanProofCache({ root }) {
  const { cache } = cacheRoots(root);
  if (!existsSync(cache)) return [];
  const entries = [];
  for (const laneDirectory of readdirSync(cache, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const lanePath = join(cache, laneDirectory.name);
    if (!laneDirectory.isDirectory() || lstatSync(lanePath).isSymbolicLink()) {
      entries.push({ valid: false, directory: lanePath, laneId: null, proofKey: null, bytes: 0, reason: 'cache lane path is not a real directory' });
      continue;
    }
    for (const keyDirectory of readdirSync(lanePath, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const directory = join(lanePath, keyDirectory.name);
      let laneId = null;
      let proofKey = KEY_PATTERN.test(keyDirectory.name) ? keyDirectory.name : null;
      let bytes = 0;
      try {
        if (!keyDirectory.isDirectory() || lstatSync(directory).isSymbolicLink()) {
          throw new Error('cache key path is not a real directory');
        }
        bytes = directoryBytes(directory);
        const raw = JSON.parse(readFileSync(join(directory, 'entry.json'), 'utf8'));
        laneId = raw.lane_id;
        if (typeof laneId !== 'string' || safeProofLaneSegment(laneId) !== laneDirectory.name) {
          throw new Error('cache entry lane identity does not match its directory');
        }
        if (!proofKey || raw.proof_key !== proofKey) {
          throw new Error('cache entry proof key does not match its directory');
        }
        const { entry } = readProofCacheEntry(root, laneId, proofKey);
        entries.push({
          valid: true,
          directory,
          laneId,
          proofKey,
          bytes,
          createdAt: entry.created_at ?? null,
          entry,
        });
      } catch (error) {
        entries.push({
          valid: false,
          directory,
          laneId,
          proofKey,
          bytes,
          reason: error.message,
        });
      }
    }
  }
  return entries.sort((left, right) => left.directory.localeCompare(right.directory));
}

function mapInputs(payload) {
  return new Map((payload?.inputs ?? []).map((input) => [input.path, input]));
}

function inputChanges(beforePayload, afterPayload) {
  const before = mapInputs(beforePayload);
  const after = mapInputs(afterPayload);
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  return paths.flatMap((path) => {
    const oldInput = before.get(path);
    const newInput = after.get(path);
    if (!oldInput) return [{ kind: 'added', path, after: newInput }];
    if (!newInput) return [{ kind: 'removed', path, before: oldInput }];
    if (stableJson(oldInput) !== stableJson(newInput)) {
      return [{ kind: 'changed', path, before: oldInput, after: newInput }];
    }
    return [];
  });
}

function objectChanges(before = {}, after = {}) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().flatMap((field) => (
    stableJson(before[field]) === stableJson(after[field])
      ? []
      : [{ field, before: before[field] ?? null, after: after[field] ?? null }]
  ));
}

function contractChanges(beforePayload, afterPayload) {
  const fields = ['schema', 'dependency_lane_ids', 'lanes', 'areas', 'matchers'];
  return fields.flatMap((field) => {
    const before = beforePayload?.[field];
    const after = afterPayload?.[field];
    if (stableJson(before) === stableJson(after)) return [];
    return [{
      field,
      before_sha256: sha256(stableJson(before)),
      after_sha256: sha256(stableJson(after)),
      ...(field === 'dependency_lane_ids' || field === 'matchers' || field === 'schema' ? { before, after } : {}),
    }];
  });
}

export function explainProofCacheLane(laneId, manifest, options) {
  if (!manifest.lanes[laneId]) throw new Error(`unknown proof lane ${laneId}`);
  const computed = options.computed ?? computeLaneProofKey(laneId, manifest, options);
  const candidates = scanProofCache(options)
    .filter((candidate) => candidate.laneId === laneId)
    .sort((left, right) => timestamp(right.createdAt) - timestamp(left.createdAt) || String(left.proofKey).localeCompare(String(right.proofKey)));
  const exact = candidates.find((candidate) => candidate.proofKey === computed.proofKey);
  const baseline = candidates.find((candidate) => candidate.valid && candidate.proofKey !== computed.proofKey) ?? null;
  const changes = baseline ? {
    inputs: inputChanges(baseline.entry.inputs, computed.payload),
    toolchain: objectChanges(baseline.entry.inputs?.toolchain, computed.payload.toolchain),
    contract: contractChanges(baseline.entry.inputs, computed.payload),
  } : { inputs: [], toolchain: [], contract: [] };
  return {
    lane_id: laneId,
    eligible: frozenLaneIds(manifest).has(laneId),
    status: exact?.valid ? 'hit' : exact ? 'corrupt' : 'miss',
    proof_key: computed.proofKey,
    exact_entry: exact ? {
      valid: exact.valid,
      created_at: exact.createdAt ?? null,
      source_receipt_id: exact.entry?.source_receipt_id ?? null,
      reason: exact.reason ?? null,
    } : null,
    compared_to: baseline ? {
      proof_key: baseline.proofKey,
      created_at: baseline.createdAt,
      source_receipt_id: baseline.entry.source_receipt_id,
    } : null,
    changes,
    candidates: candidates.map((candidate) => ({
      proof_key: candidate.proofKey,
      valid: candidate.valid,
      created_at: candidate.createdAt ?? null,
      source_receipt_id: candidate.entry?.source_receipt_id ?? null,
      bytes: candidate.bytes,
      reason: candidate.reason ?? null,
    })),
  };
}

function receiptReferences(receipt) {
  const references = [];
  for (const [laneId, lane] of Object.entries(receipt.lanes ?? {})) {
    for (const proofKey of [lane?.proof_key, lane?.reused_from_proof_key]) {
      if (typeof proofKey === 'string' && KEY_PATTERN.test(proofKey)) references.push({ laneId, proofKey });
    }
  }
  return references;
}

export function scanProofReceipts({ root }) {
  const { runs } = cacheRoots(root);
  if (!existsSync(runs)) return [];
  const receipts = [];
  for (const run of readdirSync(runs, { withFileTypes: true })) {
    if (!run.isDirectory()) continue;
    const path = join(runs, run.name, 'receipt.json');
    try {
      const receipt = JSON.parse(readFileSync(path, 'utf8'));
      receipts.push({ path, receipt });
    } catch {
      // An unreadable run receipt proves no cache reachability. It is left in
      // place for separate run-receipt diagnostics and never treated as proof.
    }
  }
  return receipts;
}

function referenceId(laneId, proofKey) {
  return `${laneId}\0${proofKey}`;
}

function addProtection(protectedEntries, laneId, proofKey, reason) {
  if (!KEY_PATTERN.test(proofKey)) return;
  const id = referenceId(laneId, proofKey);
  if (!protectedEntries.has(id)) protectedEntries.set(id, []);
  if (!protectedEntries.get(id).includes(reason)) protectedEntries.get(id).push(reason);
}

export function planProofCacheGc({
  root,
  currentProofKeys,
  keepReceipts = 10,
  maxBytes = Number.POSITIVE_INFINITY,
  now = new Date(),
  receipts = scanProofReceipts({ root }),
} = {}) {
  if (!Number.isSafeInteger(keepReceipts) || keepReceipts < 0) throw new Error('keepReceipts must be a non-negative integer');
  if (!(maxBytes === Number.POSITIVE_INFINITY || (Number.isSafeInteger(maxBytes) && maxBytes >= 0))) {
    throw new Error('maxBytes must be a non-negative integer');
  }
  const protectedEntries = new Map();
  for (const [laneId, computed] of currentProofKeys) {
    addProtection(protectedEntries, laneId, typeof computed === 'string' ? computed : computed.proofKey, 'current-key');
  }

  const terminal = receipts
    .filter(({ receipt }) => receipt.state === 'passed' &&
      (['full', 'release'].includes(receipt.context?.mode) || receipt.context?.release_checkpoint === true))
    .sort((left, right) =>
      timestamp(right.receipt.finished_at ?? right.receipt.updated_at) - timestamp(left.receipt.finished_at ?? left.receipt.updated_at) ||
      String(left.receipt.id).localeCompare(String(right.receipt.id)))
    .slice(0, keepReceipts);
  for (const { receipt } of terminal) {
    for (const { laneId, proofKey } of receiptReferences(receipt)) {
      addProtection(protectedEntries, laneId, proofKey, `receipt:${receipt.id}`);
    }
  }
  const inFlight = receipts.filter(({ receipt }) => receipt.state === 'running');
  for (const { receipt } of inFlight) {
    for (const { laneId, proofKey } of receiptReferences(receipt)) {
      addProtection(protectedEntries, laneId, proofKey, `in-flight:${receipt.id}`);
    }
  }

  const roots = cacheRoots(root);
  const scanned = scanProofCache({ root });
  const stamp = now.toISOString().replaceAll(/[^0-9A-Za-z.-]/g, '-');
  let quarantineIndex = 0;
  const entries = scanned.map((entry) => {
    const protection = entry.valid ? (protectedEntries.get(referenceId(entry.laneId, entry.proofKey)) ?? []) : [];
    if (!entry.valid) {
      const name = `${stamp}-${String(quarantineIndex++).padStart(3, '0')}-${entry.proofKey ?? 'invalid'}`;
      return { ...entry, action: 'quarantine', protection, quarantine: join(roots.quarantine, name) };
    }
    return { ...entry, action: protection.length > 0 ? 'retain' : 'delete', protection };
  });
  const retainedBytes = entries.filter((entry) => entry.action === 'retain').reduce((sum, entry) => sum + entry.bytes, 0);
  const reclaimedBytes = entries.filter((entry) => entry.action !== 'retain').reduce((sum, entry) => sum + entry.bytes, 0);
  return {
    root,
    generated_at: now.toISOString(),
    keep_receipts: keepReceipts,
    max_bytes: Number.isFinite(maxBytes) ? maxBytes : null,
    budget_satisfied: retainedBytes <= maxBytes,
    retained_bytes: retainedBytes,
    reclaimed_bytes: reclaimedBytes,
    terminal_receipts: terminal.map(({ receipt }) => receipt.id),
    in_flight_receipts: inFlight.map(({ receipt }) => receipt.id),
    entries,
  };
}

export function applyProofCacheGc(plan) {
  const roots = cacheRoots(plan.root);
  const changed = [];
  for (const entry of plan.entries) {
    if (entry.action === 'retain') continue;
    if (!inside(roots.cache, entry.directory)) throw new Error(`refusing cache mutation outside ${roots.cache}`);
    if (entry.protection.length > 0) throw new Error(`refusing to remove protected cache entry ${entry.directory}`);
    if (entry.action === 'delete') {
      rmSync(entry.directory, { recursive: true, force: true });
    } else if (entry.action === 'quarantine') {
      if (!inside(roots.quarantine, entry.quarantine)) throw new Error('refusing quarantine outside cache quarantine root');
      mkdirSync(dirname(entry.quarantine), { recursive: true });
      renameSync(entry.directory, entry.quarantine);
    } else throw new Error(`unknown cache GC action ${entry.action}`);
    changed.push({ action: entry.action, lane_id: entry.laneId, proof_key: entry.proofKey });
  }
  return changed;
}

export function requiresProofCacheMutationLock(argv) {
  return argv[0] === 'gc' && argv.includes('--apply');
}

export function parseProofCacheArguments(argv) {
  const [command, subject, ...rest] = argv;
  const options = { command, subject, json: false, apply: false, keepReceipts: 10, maxBytes: Number.POSITIVE_INFINITY };
  const args = command === 'explain' ? rest : [subject, ...rest].filter((value) => value !== undefined);
  let sawApply = false;
  let sawDryRun = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--apply') { options.apply = true; sawApply = true; }
    else if (arg === '--dry-run') { options.apply = false; sawDryRun = true; }
    else if (arg === '--keep-receipts') options.keepReceipts = Number(args[++index]);
    else if (arg === '--max-bytes') options.maxBytes = Number(args[++index]);
    else throw new Error(`unknown proof cache option ${arg}`);
  }
  if (!['explain', 'gc'].includes(command)) throw new Error('usage: proof:cache explain <lane-id> [--json] | proof:cache gc [--dry-run|--apply] [--keep-receipts N] [--max-bytes N] [--json]');
  if (command === 'explain' && !subject) throw new Error('proof:cache explain requires a lane id');
  if (sawApply && sawDryRun) throw new Error('--apply and --dry-run are mutually exclusive');
  if (command === 'explain' && (sawApply || sawDryRun || options.keepReceipts !== 10 || Number.isFinite(options.maxBytes))) {
    throw new Error('proof:cache explain accepts only a lane id and --json');
  }
  return options;
}

function sharedInputs(root) {
  return {
    root,
    files: workspaceFiles(root),
    metadata: workspaceMetadata(root),
    toolchain: proofToolchain(),
    fingerprints: new Map(),
  };
}

function formatExplanation(explanation) {
  const lines = [
    `${explanation.lane_id}: ${explanation.status}${explanation.eligible ? '' : ' (not frozen-cache eligible)'}`,
    `  current proof key: ${explanation.proof_key}`,
  ];
  if (explanation.exact_entry?.source_receipt_id) lines.push(`  source receipt: ${explanation.exact_entry.source_receipt_id}`);
  if (explanation.exact_entry?.reason) lines.push(`  corruption: ${explanation.exact_entry.reason}`);
  if (explanation.compared_to) lines.push(`  compared with: ${explanation.compared_to.proof_key} (${explanation.compared_to.source_receipt_id})`);
  for (const change of explanation.changes.inputs) {
    lines.push(`  ${change.kind} input ${change.path}: ${change.before?.sha256 ?? '-'} -> ${change.after?.sha256 ?? '-'}`);
  }
  for (const change of explanation.changes.toolchain) {
    lines.push(`  toolchain ${change.field}: ${JSON.stringify(change.before)} -> ${JSON.stringify(change.after)}`);
  }
  for (const change of explanation.changes.contract) {
    lines.push(`  contract ${change.field}: ${change.before_sha256} -> ${change.after_sha256}`);
  }
  if (explanation.status !== 'hit' && !explanation.compared_to && !explanation.exact_entry) lines.push('  no prior entry exists for comparison');
  return lines.join('\n');
}

function formatGc(plan, apply) {
  const counts = Object.fromEntries(['retain', 'delete', 'quarantine'].map((action) => [action, plan.entries.filter((entry) => entry.action === action).length]));
  const lines = [
    `proof cache GC ${apply ? 'applied' : 'dry-run'}`,
    `  retain ${counts.retain}; delete ${counts.delete}; quarantine ${counts.quarantine}`,
    `  retained bytes ${plan.retained_bytes}; reclaimable bytes ${plan.reclaimed_bytes}`,
    `  terminal receipts ${plan.terminal_receipts.length}; in-flight receipts ${plan.in_flight_receipts.length}`,
  ];
  if (!plan.budget_satisfied) lines.push(`  budget unsatisfied: protected entries exceed ${plan.max_bytes} bytes`);
  for (const entry of plan.entries.filter((candidate) => candidate.action !== 'retain')) {
    lines.push(`  ${entry.action} ${entry.laneId ?? 'unknown'} ${entry.proofKey ?? relative(plan.root, entry.directory)}${entry.reason ? ` (${entry.reason})` : ''}`);
  }
  return lines.join('\n');
}

export async function main(argv = process.argv.slice(2), { root = REPO_ROOT } = {}) {
  const args = parseProofCacheArguments(argv);
  const manifest = JSON.parse(readFileSync(join(root, 'docs', 'ops', 'proof-lane-manifest.json'), 'utf8'));
  const inputs = sharedInputs(root);
  if (args.command === 'explain') {
    const explanation = explainProofCacheLane(args.subject, manifest, inputs);
    console.log(args.json ? JSON.stringify(explanation, null, 2) : formatExplanation(explanation));
    return explanation;
  }
  const currentProofKeys = new Map(
    [...frozenLaneIds(manifest)].map((laneId) => [laneId, computeLaneProofKey(laneId, manifest, inputs)]),
  );
  const plan = planProofCacheGc({ root, currentProofKeys, keepReceipts: args.keepReceipts, maxBytes: args.maxBytes });
  if (args.apply) applyProofCacheGc(plan);
  console.log(args.json ? JSON.stringify({ ...plan, entries: plan.entries.map(({ entry, ...rest }) => rest) }, null, 2) : formatGc(plan, args.apply));
  if (!plan.budget_satisfied) process.exitCode = 2;
  return plan;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const argv = process.argv.slice(2);
  const lockHeld = process.env.HOST_HEAVY_BUILD_LOCK_HELD === '1' || process.env.MESH_HEAVY_BUILD_LOCK_HELD === '1';
  if (requiresProofCacheMutationLock(argv) && !lockHeld) {
    const result = spawnSync('python3', [HOST_LOCK_SCRIPT, '--', process.execPath, fileURLToPath(import.meta.url), ...argv], {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } else {
    main(argv).catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}
