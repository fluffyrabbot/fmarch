// Abrupt-process fixture for proof-cache maintenance recovery tests.
//
// This helper deliberately kills itself without unwinding at one durability
// checkpoint. Production code exposes only checkpoint callbacks; process
// termination remains confined to this test executable.

import { readFileSync } from 'node:fs';

import { applyReviewedProofCacheGcPlan, writeImmutableReceipt } from './proof_lane_cache_admin.mjs';

const [configPath] = process.argv.slice(2);
if (!configPath) throw new Error('usage: proof_lane_cache_crash_fixture.mjs <config-path>');

const config = JSON.parse(readFileSync(configPath, 'utf8'));
const checkpointId = (checkpoint) => checkpoint.name === 'after-action'
  ? `${checkpoint.name}:${checkpoint.action_index}`
  : checkpoint.name;

const killAtConfiguredCheckpoint = (checkpoint) => {
  if (checkpointId(checkpoint) === config.crash_at) process.kill(process.pid, 'SIGKILL');
};

if (config.mode === 'receipt-publication') {
  writeImmutableReceipt(config.receipt_path, config.receipt, {
    onCheckpoint: killAtConfiguredCheckpoint,
  });
  throw new Error(`receipt publication completed without reaching crash checkpoint ${config.crash_at}`);
}

applyReviewedProofCacheGcPlan(config.plan_path, {
  root: config.root,
  currentProofKeys: new Map(Object.entries(config.current_proof_keys)),
  receipts: [],
  now: new Date(config.now),
  onApplicationCheckpoint: killAtConfiguredCheckpoint,
  onReceiptCheckpoint: killAtConfiguredCheckpoint,
});

throw new Error(`application completed without reaching crash checkpoint ${config.crash_at}`);
