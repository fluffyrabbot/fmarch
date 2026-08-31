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
  readlinkSync,
  renameSync,
  rmSync,
  writeFileSync,
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
export const PROOF_CACHE_GC_PLAN_SCHEMA = 1;
const PROOF_CACHE_GC_PLAN_KIND = 'fmarch-proof-cache-gc-plan';
const PROOF_CACHE_GC_APPLICATION_SCHEMA = 1;
const PROOF_CACHE_GC_RECOVERY_SCHEMA = 1;
const PROOF_CACHE_GC_RECOVERY_KIND = 'fmarch-proof-cache-gc-recovery';

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

function filesystemState(directory) {
  let bytes = 0;
  const entries = [];
  const visit = (path) => {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const child = join(path, entry.name);
      const metadata = lstatSync(child);
      const name = relative(directory, child).replaceAll('\\', '/');
      if (metadata.isSymbolicLink()) {
        entries.push({ path: name, kind: 'symlink', mode: metadata.mode, target: readlinkSync(child) });
      } else if (metadata.isDirectory()) {
        entries.push({ path: name, kind: 'directory', mode: metadata.mode });
        visit(child);
      } else if (metadata.isFile()) {
        bytes += metadata.size;
        entries.push({ path: name, kind: 'file', mode: metadata.mode, bytes: metadata.size, sha256: sha256(readFileSync(child)) });
      }
      else throw new Error(`cache entry contains unsupported file type ${child}`);
    }
  };
  const root = lstatSync(directory);
  if (root.isSymbolicLink()) {
    entries.push({ path: '.', kind: 'symlink', mode: root.mode, target: readlinkSync(directory) });
  } else if (root.isDirectory()) {
    visit(directory);
  } else if (root.isFile()) {
    bytes = root.size;
    entries.push({ path: '.', kind: 'file', mode: root.mode, bytes: root.size, sha256: sha256(readFileSync(directory)) });
  } else throw new Error(`cache entry has unsupported root type ${directory}`);
  return { bytes, sha256: sha256(stableJson(entries)) };
}

function cacheRoots(root) {
  const base = join(root, 'target', 'proof-lanes');
  return {
    cache: join(base, 'cache'),
    quarantine: join(base, 'cache-quarantine'),
    runs: join(base, 'runs'),
    maintenance: join(base, 'cache-maintenance'),
    plans: join(base, 'cache-maintenance', 'plans'),
    applications: join(base, 'cache-maintenance', 'applications'),
    recoveries: join(base, 'cache-maintenance', 'recoveries'),
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
      const state = filesystemState(lanePath);
      entries.push({ valid: false, directory: lanePath, laneId: null, proofKey: null, bytes: state.bytes, stateSha256: state.sha256, reason: 'cache lane path is not a real directory' });
      continue;
    }
    for (const keyDirectory of readdirSync(lanePath, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const directory = join(lanePath, keyDirectory.name);
      let laneId = null;
      let proofKey = KEY_PATTERN.test(keyDirectory.name) ? keyDirectory.name : null;
      let bytes = 0;
      let stateSha256 = null;
      try {
        const state = filesystemState(directory);
        bytes = state.bytes;
        stateSha256 = state.sha256;
        if (!keyDirectory.isDirectory() || lstatSync(directory).isSymbolicLink()) {
          throw new Error('cache key path is not a real directory');
        }
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
          stateSha256,
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
          stateSha256,
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
      const raw = readFileSync(path);
      const receipt = JSON.parse(raw.toString('utf8'));
      receipts.push({ path, receipt, sha256: sha256(raw) });
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

function receiptRoot({ receipt, sha256: digest }) {
  return { id: receipt.id, sha256: digest ?? sha256(stableJson(receipt)) };
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
  const inFlight = receipts
    .filter(({ receipt }) => receipt.state === 'running')
    .sort((left, right) => String(left.receipt.id).localeCompare(String(right.receipt.id)));
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
    current_keys: [...currentProofKeys]
      .map(([laneId, computed]) => ({ lane_id: laneId, proof_key: typeof computed === 'string' ? computed : computed.proofKey }))
      .sort((left, right) => left.lane_id.localeCompare(right.lane_id)),
    terminal_receipts: terminal.map(receiptRoot),
    in_flight_receipts: inFlight.map(receiptRoot),
    entries,
  };
}

function serializableGcEntry(root, entry) {
  return {
    directory: relative(root, entry.directory).replaceAll('\\', '/'),
    lane_id: entry.laneId,
    proof_key: entry.proofKey,
    valid: entry.valid,
    bytes: entry.bytes,
    state_sha256: entry.stateSha256,
    created_at: entry.createdAt ?? null,
    reason: entry.reason ?? null,
    action: entry.action,
    protection: [...entry.protection].sort(),
    quarantine: entry.quarantine ? relative(root, entry.quarantine).replaceAll('\\', '/') : null,
  };
}

function proofCacheGcPlanPayload(plan) {
  return stable({
    generated_at: plan.generated_at,
    repo_root: resolve(plan.root),
    policy: {
      keep_receipts: plan.keep_receipts,
      max_bytes: plan.max_bytes,
    },
    protected_roots: {
      current_keys: plan.current_keys,
      terminal_receipts: plan.terminal_receipts,
      in_flight_receipts: plan.in_flight_receipts,
    },
    inventory: plan.entries.map((entry) => serializableGcEntry(plan.root, entry)),
    summary: {
      budget_satisfied: plan.budget_satisfied,
      retained_bytes: plan.retained_bytes,
      reclaimed_bytes: plan.reclaimed_bytes,
      retain_count: plan.entries.filter((entry) => entry.action === 'retain').length,
      delete_count: plan.entries.filter((entry) => entry.action === 'delete').length,
      quarantine_count: plan.entries.filter((entry) => entry.action === 'quarantine').length,
    },
  });
}

export function createProofCacheGcPlanReceipt(plan) {
  const payload = proofCacheGcPlanPayload(plan);
  const basisSha256 = sha256(stableJson(payload));
  const stamp = plan.generated_at.replaceAll(/[^0-9A-Za-z.-]/g, '-');
  const base = {
    schema: PROOF_CACHE_GC_PLAN_SCHEMA,
    kind: PROOF_CACHE_GC_PLAN_KIND,
    id: `cache-gc-plan-${stamp}-${basisSha256.slice(0, 16)}`,
    state: 'planned',
    basis_sha256: basisSha256,
    ...payload,
  };
  return { ...base, plan_sha256: sha256(stableJson(base)) };
}

export function writeProofCacheGcPlan(plan) {
  const roots = cacheRoots(plan.root);
  const receipt = createProofCacheGcPlanReceipt(plan);
  const path = join(roots.plans, `${receipt.id}.json`);
  mkdirSync(roots.plans, { recursive: true });
  writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  return { path, receipt };
}

export function readProofCacheGcPlan(path, { root }) {
  const roots = cacheRoots(root);
  const resolved = resolve(path);
  if (!inside(roots.plans, resolved)) throw new Error(`GC plan must be under ${roots.plans}`);
  const metadata = lstatSync(resolved);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('GC plan must be a real file');
  const receipt = JSON.parse(readFileSync(resolved, 'utf8'));
  const { plan_sha256: claimed, ...base } = receipt;
  if (receipt.schema !== PROOF_CACHE_GC_PLAN_SCHEMA || receipt.kind !== PROOF_CACHE_GC_PLAN_KIND || receipt.state !== 'planned') {
    throw new Error('invalid proof cache GC plan receipt identity');
  }
  if (receipt.repo_root !== resolve(root)) throw new Error('proof cache GC plan belongs to another repository root');
  if (claimed !== sha256(stableJson(base))) throw new Error('proof cache GC plan receipt digest does not match');
  const payload = {
    generated_at: receipt.generated_at,
    repo_root: receipt.repo_root,
    policy: receipt.policy,
    protected_roots: receipt.protected_roots,
    inventory: receipt.inventory,
    summary: receipt.summary,
  };
  if (receipt.basis_sha256 !== sha256(stableJson(payload))) throw new Error('proof cache GC plan basis digest does not match');
  const stamp = receipt.generated_at.replaceAll(/[^0-9A-Za-z.-]/g, '-');
  if (receipt.id !== `cache-gc-plan-${stamp}-${receipt.basis_sha256.slice(0, 16)}`) throw new Error('proof cache GC plan id does not match its content');
  if (resolved !== join(roots.plans, `${receipt.id}.json`)) throw new Error('proof cache GC plan filename does not match its id');
  return { path: resolved, receipt };
}

export function validateProofCacheGcPlan(receipt, freshPlan) {
  const fresh = createProofCacheGcPlanReceipt(freshPlan);
  if (fresh.basis_sha256 !== receipt.basis_sha256) {
    throw new Error(`proof cache GC plan is stale: expected ${receipt.basis_sha256}, current ${fresh.basis_sha256}`);
  }
  return true;
}

function cacheInventorySha256(root) {
  return inventorySha256(scanProofCache({ root }).map((entry) => ({
    directory: relative(root, entry.directory).replaceAll('\\', '/'),
    lane_id: entry.laneId,
    proof_key: entry.proofKey,
    valid: entry.valid,
    bytes: entry.bytes,
    state_sha256: entry.stateSha256,
    reason: entry.reason ?? null,
  })));
}

function inventorySha256(inventory) {
  return sha256(stableJson(inventory.map((entry) => ({
    directory: entry.directory,
    lane_id: entry.lane_id,
    proof_key: entry.proof_key,
    valid: entry.valid,
    bytes: entry.bytes,
    state_sha256: entry.state_sha256,
    reason: entry.reason ?? null,
  }))));
}

function expectedAppliedChanges(plan) {
  return plan.inventory
    .filter((entry) => entry.action !== 'retain')
    .map((entry) => ({ action: entry.action, lane_id: entry.lane_id, proof_key: entry.proof_key }));
}

function expectedPostInventorySha256(plan) {
  return inventorySha256(plan.inventory.filter((entry) => entry.action === 'retain'));
}

function beginProofCacheGcApplication(planPath, receipt, { root, now }) {
  const roots = cacheRoots(root);
  mkdirSync(roots.applications, { recursive: true });
  const directory = join(roots.applications, receipt.id);
  mkdirSync(directory);
  const base = {
    schema: PROOF_CACHE_GC_APPLICATION_SCHEMA,
    kind: 'fmarch-proof-cache-gc-application-intent',
    state: 'applying',
    plan_id: receipt.id,
    plan_sha256: receipt.plan_sha256,
    plan_path: relative(root, planPath).replaceAll('\\', '/'),
    started_at: now.toISOString(),
  };
  const intent = { ...base, intent_sha256: sha256(stableJson(base)) };
  const path = join(directory, 'intent.json');
  writeFileSync(path, `${JSON.stringify(intent, null, 2)}\n`, { flag: 'wx' });
  return { directory, intent, path };
}

function finishProofCacheGcApplication(application, { root, state, changed, error, now }) {
  const base = {
    schema: PROOF_CACHE_GC_APPLICATION_SCHEMA,
    kind: 'fmarch-proof-cache-gc-application-result',
    state,
    plan_id: application.intent.plan_id,
    plan_sha256: application.intent.plan_sha256,
    finished_at: now.toISOString(),
    changed,
    error: error ?? null,
    post_inventory_sha256: cacheInventorySha256(root),
  };
  const result = { ...base, result_sha256: sha256(stableJson(base)) };
  const path = join(application.directory, 'result.json');
  writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  return { path, receipt: result };
}

export function applyProofCacheGc(plan, { onChange = () => {} } = {}) {
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
    const change = { action: entry.action, lane_id: entry.laneId, proof_key: entry.proofKey };
    changed.push(change);
    onChange(change);
  }
  return changed;
}

export function applyReviewedProofCacheGcPlan(planPath, {
  root,
  currentProofKeys,
  receipts = scanProofReceipts({ root }),
  now = new Date(),
  onApplicationCheckpoint = () => {},
} = {}) {
  const loaded = readProofCacheGcPlan(planPath, { root });
  const applicationDirectory = join(cacheRoots(root).applications, loaded.receipt.id);
  if (existsSync(applicationDirectory)) throw new Error(`proof cache GC plan ${loaded.receipt.id} was already attempted`);
  const freshPlan = planProofCacheGc({
    root,
    currentProofKeys,
    keepReceipts: loaded.receipt.policy.keep_receipts,
    maxBytes: loaded.receipt.policy.max_bytes ?? Number.POSITIVE_INFINITY,
    now: new Date(loaded.receipt.generated_at),
    receipts,
  });
  validateProofCacheGcPlan(loaded.receipt, freshPlan);
  if (!freshPlan.budget_satisfied) throw new Error('proof cache GC plan cannot apply because its protected floor exceeds the disk budget');
  const application = beginProofCacheGcApplication(loaded.path, loaded.receipt, { root, now });
  const changed = [];
  try {
    onApplicationCheckpoint({ name: 'after-intent', plan_id: loaded.receipt.id, changed: [] });
    applyProofCacheGc(freshPlan, { onChange: (change) => {
      changed.push(change);
      onApplicationCheckpoint({
        name: 'after-action',
        plan_id: loaded.receipt.id,
        action_index: changed.length,
        changed: [...changed],
      });
    } });
    onApplicationCheckpoint({ name: 'before-result', plan_id: loaded.receipt.id, changed: [...changed] });
    const result = finishProofCacheGcApplication(application, { root, state: 'applied', changed, error: null, now });
    return { plan: loaded, gcPlan: freshPlan, application, result, changed };
  } catch (error) {
    finishProofCacheGcApplication(application, { root, state: 'failed', changed, error: error.message, now });
    throw error;
  }
}

function readApplicationReceipt(path, { kind, digestField, states }) {
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`${kind} must be a real file`);
  const receipt = JSON.parse(readFileSync(path, 'utf8'));
  const { [digestField]: claimed, ...base } = receipt;
  if (receipt.schema !== PROOF_CACHE_GC_APPLICATION_SCHEMA || receipt.kind !== kind || !states.includes(receipt.state)) {
    throw new Error(`invalid ${kind} identity`);
  }
  if (claimed !== sha256(stableJson(base))) throw new Error(`${kind} digest does not match`);
  return receipt;
}

function maintenanceIssue(code, subject, message) {
  return { code, subject, message };
}

function directoryEntries(path) {
  return existsSync(path)
    ? readdirSync(path, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))
    : [];
}

function readRecoveryReceipt(path, { root }) {
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('recovery receipt must be a real file');
  const receipt = JSON.parse(readFileSync(path, 'utf8'));
  const { recovery_sha256: claimed, ...base } = receipt;
  if (receipt.schema !== PROOF_CACHE_GC_RECOVERY_SCHEMA || receipt.kind !== PROOF_CACHE_GC_RECOVERY_KIND || receipt.state !== 'planned') {
    throw new Error('invalid proof cache GC recovery receipt identity');
  }
  if (receipt.repo_root !== resolve(root)) throw new Error('proof cache GC recovery belongs to another repository root');
  if (claimed !== sha256(stableJson(base))) throw new Error('proof cache GC recovery receipt digest does not match');
  return receipt;
}

export function auditProofCacheMaintenance({ root }) {
  const roots = cacheRoots(root);
  const issues = [];
  const plans = new Map();
  const applications = new Map();
  const recoveries = [];

  for (const entry of directoryEntries(roots.plans)) {
    const path = join(roots.plans, entry.name);
    if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.json')) {
      issues.push(maintenanceIssue('unexpected-plan-entry', entry.name, 'plan storage contains an unexpected entry'));
      continue;
    }
    try {
      const loaded = readProofCacheGcPlan(path, { root });
      if (plans.has(loaded.receipt.id)) throw new Error('duplicate plan id');
      plans.set(loaded.receipt.id, loaded);
    } catch (error) {
      issues.push(maintenanceIssue('invalid-plan', entry.name, error.message));
    }
  }

  for (const entry of directoryEntries(roots.applications)) {
    const directory = join(roots.applications, entry.name);
    const record = { plan_id: entry.name, state: 'invalid', intent: null, result: null };
    applications.set(entry.name, record);
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      issues.push(maintenanceIssue('invalid-application-directory', entry.name, 'application storage entry must be a real directory'));
      continue;
    }
    const names = directoryEntries(directory).map((child) => child.name);
    for (const name of names.filter((name) => !['intent.json', 'result.json'].includes(name))) {
      issues.push(maintenanceIssue('unexpected-application-entry', `${entry.name}/${name}`, 'application directory contains an unexpected entry'));
    }
    const plan = plans.get(entry.name);
    if (!plan) issues.push(maintenanceIssue('missing-application-plan', entry.name, 'application has no valid immutable plan'));
    try {
      const intentPath = join(directory, 'intent.json');
      if (!existsSync(intentPath)) throw new Error('application intent is missing');
      record.intent = readApplicationReceipt(intentPath, {
        kind: 'fmarch-proof-cache-gc-application-intent', digestField: 'intent_sha256', states: ['applying'],
      });
      if (record.intent.plan_id !== entry.name) throw new Error('application intent plan id does not match its directory');
      if (plan) {
        if (record.intent.plan_sha256 !== plan.receipt.plan_sha256) throw new Error('application intent plan digest does not match its plan');
        if (resolve(root, record.intent.plan_path) !== plan.path) throw new Error('application intent plan path does not match its plan');
      }
      if (timestamp(record.intent.started_at) === 0) throw new Error('application intent started_at is invalid');
    } catch (error) {
      issues.push(maintenanceIssue('invalid-application-intent', entry.name, error.message));
      continue;
    }

    const resultPath = join(directory, 'result.json');
    if (!existsSync(resultPath)) {
      record.state = 'orphaned';
      continue;
    }
    try {
      record.result = readApplicationReceipt(resultPath, {
        kind: 'fmarch-proof-cache-gc-application-result', digestField: 'result_sha256', states: ['applied', 'failed'],
      });
      if (record.result.plan_id !== entry.name || record.result.plan_sha256 !== record.intent.plan_sha256) {
        throw new Error('application result does not link to its intent');
      }
      if (timestamp(record.result.finished_at) < timestamp(record.intent.started_at)) throw new Error('application result predates its intent');
      record.state = record.result.state;
      if (record.state === 'applied' && plan) {
        if (stableJson(record.result.changed) !== stableJson(expectedAppliedChanges(plan.receipt))) {
          throw new Error('application result changed-actions do not match its reviewed plan');
        }
        if (record.result.post_inventory_sha256 !== expectedPostInventorySha256(plan.receipt)) {
          throw new Error('application result post-inventory digest does not match its reviewed plan');
        }
      }
    } catch (error) {
      record.state = 'invalid';
      issues.push(maintenanceIssue('invalid-application-result', entry.name, error.message));
    }
  }

  for (const sourceEntry of directoryEntries(roots.recoveries)) {
    const sourceDirectory = join(roots.recoveries, sourceEntry.name);
    if (!sourceEntry.isDirectory() || sourceEntry.isSymbolicLink()) {
      issues.push(maintenanceIssue('invalid-recovery-directory', sourceEntry.name, 'recovery source entry must be a real directory'));
      continue;
    }
    for (const entry of directoryEntries(sourceDirectory)) {
      const path = join(sourceDirectory, entry.name);
      if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.json')) {
        issues.push(maintenanceIssue('unexpected-recovery-entry', `${sourceEntry.name}/${entry.name}`, 'recovery storage contains an unexpected entry'));
        continue;
      }
      try {
        const receipt = readRecoveryReceipt(path, { root });
        if (receipt.source_plan_id !== sourceEntry.name) throw new Error('recovery source does not match its directory');
        if (entry.name !== `${receipt.recovery_plan_id}.json`) throw new Error('recovery filename does not match its target plan');
        const source = applications.get(receipt.source_plan_id);
        const target = plans.get(receipt.recovery_plan_id);
        if (!source?.intent) throw new Error('recovery source application is missing or invalid');
        if (!['orphaned', 'failed'].includes(source.state)) throw new Error('recovery source application is not interrupted or failed');
        if (receipt.source_plan_sha256 !== source.intent.plan_sha256 || receipt.source_intent_sha256 !== source.intent.intent_sha256) {
          throw new Error('recovery source linkage does not match its application');
        }
        if ((receipt.source_result_sha256 ?? null) !== (source.result?.result_sha256 ?? null)) {
          throw new Error('recovery result linkage does not match its application');
        }
        if (!target || receipt.recovery_plan_sha256 !== target.receipt.plan_sha256) {
          throw new Error('recovery target plan is missing or does not match');
        }
        if (timestamp(receipt.created_at) === 0 || timestamp(receipt.created_at) < timestamp(source.intent.started_at)) {
          throw new Error('recovery creation time is invalid or predates its source application');
        }
        if (timestamp(target.receipt.generated_at) !== timestamp(receipt.created_at)) {
          throw new Error('recovery creation time does not match its fresh plan');
        }
        recoveries.push(receipt);
      } catch (error) {
        issues.push(maintenanceIssue('invalid-recovery', `${sourceEntry.name}/${entry.name}`, error.message));
      }
    }
  }

  const recoveryTargets = new Map();
  for (const receipt of recoveries) {
    if (!recoveryTargets.has(receipt.source_plan_id)) recoveryTargets.set(receipt.source_plan_id, []);
    recoveryTargets.get(receipt.source_plan_id).push(receipt.recovery_plan_id);
  }
  const resolves = (planId, seen = new Set()) => {
    if (seen.has(planId)) return false;
    const application = applications.get(planId);
    if (application?.state === 'applied') return true;
    const nextSeen = new Set(seen).add(planId);
    return (recoveryTargets.get(planId) ?? []).some((target) => resolves(target, nextSeen));
  };
  for (const application of applications.values()) {
    if (!['orphaned', 'failed'].includes(application.state)) continue;
    if (resolves(application.plan_id)) continue;
    const targets = recoveryTargets.get(application.plan_id) ?? [];
    issues.push(maintenanceIssue(
      targets.length > 0 ? 'recovery-pending' : `application-${application.state}`,
      application.plan_id,
      targets.length > 0
        ? `recovery plan has not completed: ${targets.join(', ')}`
        : `application is ${application.state}; generate and apply a fresh current-state recovery plan`,
    ));
  }

  return {
    state: issues.length === 0 ? 'clean' : 'attention',
    summary: {
      plan_count: plans.size,
      application_count: applications.size,
      recovery_count: recoveries.length,
      issue_count: issues.length,
    },
    plans: [...plans.keys()].sort(),
    applications: [...applications.values()].map(({ plan_id, state }) => ({ plan_id, state })),
    recoveries: recoveries.map(({ source_plan_id, recovery_plan_id }) => ({ source_plan_id, recovery_plan_id })),
    issues,
  };
}

export function writeProofCacheGcRecovery(sourcePlanId, {
  root,
  currentProofKeys,
  keepReceipts = 10,
  maxBytes = Number.POSITIVE_INFINITY,
  now = new Date(),
  receipts = scanProofReceipts({ root }),
} = {}) {
  const audit = auditProofCacheMaintenance({ root });
  const source = audit.applications.find((application) => application.plan_id === sourcePlanId);
  if (!source || !['orphaned', 'failed'].includes(source.state)) {
    throw new Error(`recovery source ${sourcePlanId} is not a valid interrupted or failed application`);
  }
  const sourceDirectory = join(cacheRoots(root).applications, sourcePlanId);
  const intent = readApplicationReceipt(join(sourceDirectory, 'intent.json'), {
    kind: 'fmarch-proof-cache-gc-application-intent', digestField: 'intent_sha256', states: ['applying'],
  });
  const resultPath = join(sourceDirectory, 'result.json');
  const result = existsSync(resultPath) ? readApplicationReceipt(resultPath, {
    kind: 'fmarch-proof-cache-gc-application-result', digestField: 'result_sha256', states: ['failed'],
  }) : null;
  const plan = planProofCacheGc({ root, currentProofKeys, keepReceipts, maxBytes, now, receipts });
  const saved = writeProofCacheGcPlan(plan);
  const base = {
    schema: PROOF_CACHE_GC_RECOVERY_SCHEMA,
    kind: PROOF_CACHE_GC_RECOVERY_KIND,
    state: 'planned',
    repo_root: resolve(root),
    source_plan_id: sourcePlanId,
    source_plan_sha256: intent.plan_sha256,
    source_intent_sha256: intent.intent_sha256,
    source_result_sha256: result?.result_sha256 ?? null,
    recovery_plan_id: saved.receipt.id,
    recovery_plan_sha256: saved.receipt.plan_sha256,
    created_at: now.toISOString(),
  };
  const receipt = { ...base, recovery_sha256: sha256(stableJson(base)) };
  const directory = join(cacheRoots(root).recoveries, sourcePlanId);
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `${saved.receipt.id}.json`);
  writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  return { plan, saved, receipt, path };
}

export function requiresProofCacheMutationLock(argv) {
  return (argv[0] === 'gc' && argv.includes('--apply')) || (argv[0] === 'audit' && argv.includes('--recover'));
}

export function parseProofCacheArguments(argv) {
  const command = argv[0];
  const usage = 'usage: proof:cache explain <lane-id> [--json] | proof:cache audit [--json] | proof:cache audit --recover <plan-id> [--keep-receipts N] [--max-bytes N] [--json] | proof:cache gc --dry-run [--keep-receipts N] [--max-bytes N] [--json] | proof:cache gc --apply <plan-path> [--json]';
  if (!['explain', 'audit', 'gc'].includes(command)) throw new Error(usage);
  if (command === 'explain') {
    const subject = argv[1];
    if (!subject) throw new Error('proof:cache explain requires a lane id');
    const rest = argv.slice(2);
    if (rest.some((arg) => arg !== '--json')) throw new Error('proof:cache explain accepts only a lane id and --json');
    return { command, subject, json: rest.includes('--json') };
  }

  if (command === 'audit') {
    const options = { command, json: false, recover: null, keepReceipts: 10, maxBytes: Number.POSITIVE_INFINITY };
    const args = argv.slice(1);
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      if (arg === '--json') options.json = true;
      else if (arg === '--recover') {
        if (options.recover) throw new Error('--recover may be specified only once');
        options.recover = args[++index];
        if (!options.recover || options.recover.startsWith('--')) throw new Error('--recover requires an interrupted or failed plan id');
      } else if (arg === '--keep-receipts') options.keepReceipts = Number(args[++index]);
      else if (arg === '--max-bytes') options.maxBytes = Number(args[++index]);
      else throw new Error(`unknown proof cache audit option ${arg}`);
    }
    if (!options.recover && (options.keepReceipts !== 10 || options.maxBytes !== Number.POSITIVE_INFINITY)) {
      throw new Error('audit recovery policy requires --recover <plan-id>');
    }
    return options;
  }

  const options = {
    command,
    json: false,
    applyPlan: null,
    dryRun: false,
    keepReceipts: 10,
    maxBytes: Number.POSITIVE_INFINITY,
    policySpecified: false,
  };
  const args = argv.slice(1);
  let sawApply = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--apply') {
      if (sawApply) throw new Error('--apply may be specified only once');
      sawApply = true;
      options.applyPlan = args[++index];
      if (!options.applyPlan || options.applyPlan.startsWith('--')) throw new Error('--apply requires an immutable plan path');
    } else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--keep-receipts') {
      options.keepReceipts = Number(args[++index]);
      options.policySpecified = true;
    } else if (arg === '--max-bytes') {
      options.maxBytes = Number(args[++index]);
      options.policySpecified = true;
    }
    else throw new Error(`unknown proof cache option ${arg}`);
  }
  if (options.applyPlan && options.dryRun) throw new Error('--apply and --dry-run are mutually exclusive');
  if (options.applyPlan && options.policySpecified) throw new Error('GC policy comes from the immutable plan when using --apply');
  if (!options.applyPlan && !options.dryRun) throw new Error('proof:cache gc requires either --dry-run or --apply <plan-path>');
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

function formatGc(plan, { planPath = null, applied = null } = {}) {
  const counts = Object.fromEntries(['retain', 'delete', 'quarantine'].map((action) => [action, plan.entries.filter((entry) => entry.action === action).length]));
  const lines = [
    `proof cache GC ${applied ? 'applied' : 'planned'}`,
    `  retain ${counts.retain}; delete ${counts.delete}; quarantine ${counts.quarantine}`,
    `  retained bytes ${plan.retained_bytes}; reclaimable bytes ${plan.reclaimed_bytes}`,
    `  terminal receipts ${plan.terminal_receipts.length}; in-flight receipts ${plan.in_flight_receipts.length}`,
  ];
  if (planPath) lines.push(`  immutable plan: ${planPath}`);
  if (applied) lines.push(`  application result: ${applied.result.path}`);
  if (!plan.budget_satisfied) lines.push(`  budget unsatisfied: protected entries exceed ${plan.max_bytes} bytes`);
  for (const entry of plan.entries.filter((candidate) => candidate.action !== 'retain')) {
    lines.push(`  ${entry.action} ${entry.laneId ?? 'unknown'} ${entry.proofKey ?? relative(plan.root, entry.directory)}${entry.reason ? ` (${entry.reason})` : ''}`);
  }
  return lines.join('\n');
}

function formatMaintenanceAudit(audit) {
  const lines = [
    `proof cache maintenance: ${audit.state}`,
    `  plans ${audit.summary.plan_count}; applications ${audit.summary.application_count}; recoveries ${audit.summary.recovery_count}; issues ${audit.summary.issue_count}`,
  ];
  for (const issue of audit.issues) lines.push(`  ${issue.code} ${issue.subject}: ${issue.message}`);
  return lines.join('\n');
}

function formatRecovery(recovery) {
  return [
    `proof cache recovery planned for ${recovery.receipt.source_plan_id}`,
    `  fresh immutable plan: ${recovery.saved.path}`,
    `  recovery linkage: ${recovery.path}`,
    '  review the fresh plan, then apply it with npm run proof:cache -- gc --apply <plan-path>',
  ].join('\n');
}

export async function main(argv = process.argv.slice(2), { root = REPO_ROOT } = {}) {
  const args = parseProofCacheArguments(argv);
  if (args.command === 'audit' && !args.recover) {
    const audit = auditProofCacheMaintenance({ root });
    console.log(args.json ? JSON.stringify(audit, null, 2) : formatMaintenanceAudit(audit));
    if (audit.state !== 'clean') process.exitCode = 2;
    return audit;
  }
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
  if (args.command === 'audit') {
    const recovery = writeProofCacheGcRecovery(args.recover, {
      root,
      currentProofKeys,
      keepReceipts: args.keepReceipts,
      maxBytes: args.maxBytes,
    });
    console.log(args.json ? JSON.stringify(recovery, null, 2) : formatRecovery(recovery));
    if (!recovery.plan.budget_satisfied) process.exitCode = 2;
    return recovery;
  }
  if (args.applyPlan) {
    const applied = applyReviewedProofCacheGcPlan(args.applyPlan, { root, currentProofKeys });
    console.log(args.json
      ? JSON.stringify({ plan_id: applied.plan.receipt.id, changed: applied.changed, application: applied.result }, null, 2)
      : formatGc(applied.gcPlan, { applied }));
    return applied;
  }
  const plan = planProofCacheGc({ root, currentProofKeys, keepReceipts: args.keepReceipts, maxBytes: args.maxBytes });
  const saved = writeProofCacheGcPlan(plan);
  console.log(args.json
    ? JSON.stringify({ plan_path: saved.path, receipt: saved.receipt }, null, 2)
    : formatGc(plan, { planPath: saved.path }));
  if (!plan.budget_satisfied) process.exitCode = 2;
  return { plan, saved };
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
