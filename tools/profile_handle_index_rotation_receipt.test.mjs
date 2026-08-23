import assert from "node:assert/strict";
import test from "node:test";

import {
  parseArguments,
  rotationReceiptSha256,
  validateEscrowDestructionReceipt,
  validateRotationReceipt,
} from "./profile_handle_index_rotation_receipt.mjs";

test("rotation receipt accepts a complete drained two-replica cut", () => {
  const rotation = validRotationReceipt();
  const rotationBytes = receiptBytes(rotation);
  const destruction = validDestructionReceipt(rotation, rotationBytes);

  assert.equal(validateRotationReceipt(rotation), true);
  assert.equal(
    validateEscrowDestructionReceipt({
      rotationReceipt: rotation,
      rotationReceiptBytes: rotationBytes,
      destructionReceipt: destruction,
    }),
    true,
  );
});

test("rotation receipt rejects a post-drain count or recovery window mismatch", () => {
  const countMismatch = validRotationReceipt();
  countMismatch.reindex.active_profile_count += 1;
  assert.throws(() => validateRotationReceipt(countMismatch), /post-drain and reindex counts must match/);

  const earlyEscrow = validRotationReceipt();
  earlyEscrow.recovery_escrow.not_before = "2026-08-30T12:00:00Z";
  assert.throws(() => validateRotationReceipt(earlyEscrow), /recovery escrow window is too short/);
});

test("destruction receipt binds exact parent bytes, retired KID, and retention period", () => {
  const rotation = validRotationReceipt();
  const rotationBytes = receiptBytes(rotation);

  const wrongKid = validDestructionReceipt(rotation, rotationBytes);
  wrongKid.retired_kid = rotation.transition.to_kid;
  assert.throws(
    () =>
      validateEscrowDestructionReceipt({
        rotationReceipt: rotation,
        rotationReceiptBytes: rotationBytes,
        destructionReceipt: wrongKid,
      }),
    /must link its retired KID/,
  );

  const changedBytes = Buffer.from(`${JSON.stringify(rotation)}\n`);
  const wrongHash = validDestructionReceipt(rotation, rotationBytes);
  assert.throws(
    () =>
      validateEscrowDestructionReceipt({
        rotationReceipt: rotation,
        rotationReceiptBytes: changedBytes,
        destructionReceipt: wrongHash,
      }),
    /exact parent receipt bytes/,
  );

  const shortRetention = validDestructionReceipt(rotation, rotationBytes);
  shortRetention.retain_until = "2033-08-30T12:00:00Z";
  assert.throws(
    () =>
      validateEscrowDestructionReceipt({
        rotationReceipt: rotation,
        rotationReceiptBytes: rotationBytes,
        destructionReceipt: shortRetention,
      }),
    /retention period is too short/,
  );
});

test("receipt CLI arguments require an explicit rotation record", () => {
  assert.deepEqual(parseArguments(["--rotation", "rotation.json"]), {
    rotationPath: "rotation.json",
    destructionPath: undefined,
  });
  assert.deepEqual(
    parseArguments(["--rotation", "rotation.json", "--destruction", "destruction.json"]),
    { rotationPath: "rotation.json", destructionPath: "destruction.json" },
  );
  assert.throws(() => parseArguments([]), /rotation receipt path is required/);
  assert.throws(() => parseArguments(["--unknown"]), /unknown profile-handle-index receipt argument/);
});

function validRotationReceipt() {
  const transition = {
    from_kid: "staging-profile-handle-index-2026-08-22",
    to_kid: "staging-profile-handle-index-2026-09-21",
  };
  const plan = {
    status: "planned",
    read_only: true,
    current_kid: transition.from_kid,
    replacement_kid: transition.to_kid,
    active_profile_count: 3,
    requires_writer_drain: true,
  };
  return {
    schema_version: 1,
    record_type: "profile_handle_index_rotation",
    rotation_id: "11111111-1111-4111-8111-111111111111",
    recorded_at: "2026-08-01T12:00:00Z",
    environment: "staging",
    status: "redeployed",
    release: {
      api_commit: "a".repeat(40),
      api_deployment_id: "deployment_123",
    },
    transition,
    operator_shell: {
      transport: "railway_ssh_database_tunnel",
      database_transport: "sslmode_require",
      source_service_role: "api",
      env_allowlist: "deploy/railway/profile-index-admin.env.example",
      child_environment: "node_spawn_exact_allowlist",
      outer_environment_persisted: false,
      replacement_service_variable_created: false,
    },
    writer_drain: {
      expected_api_replicas: 2,
      api_scaled_to_zero: true,
      zero_live_api_replicas_confirmed: true,
      out_of_band_inventory_complete: true,
      out_of_band_writers: {
        subject_erasure_worker: "stopped",
        profile_projection_rebuild: "absent",
        operator_maintenance_job: "stopped",
        legacy_profile_writer_sweep: "absent",
      },
    },
    pre_drain_plan: structuredClone(plan),
    post_drain_plan: structuredClone(plan),
    reindex: {
      status: "reindexed",
      read_only: false,
      current_kid: transition.from_kid,
      replacement_kid: transition.to_kid,
      active_profile_count: 3,
      writers_drained: true,
      executed: true,
    },
    redeploy: {
      api_replica_target: 2,
      api_deployment_status: "SUCCESS",
      two_live_api_replicas_confirmed: true,
      readyz_passed: true,
      owner_profile_read_passed: true,
      duplicate_handle_rejected: true,
      replacement_key_absent_from_api: true,
    },
    recovery_escrow: {
      old_kid: transition.from_kid,
      state: "held",
      recovery_window_days: 30,
      not_before: "2026-08-31T12:00:00Z",
    },
  };
}

function validDestructionReceipt(rotation, rotationBytes) {
  return {
    schema_version: 1,
    record_type: "profile_handle_index_escrow_destruction",
    rotation_id: rotation.rotation_id,
    recorded_at: "2026-08-31T12:00:00Z",
    environment: rotation.environment,
    retired_kid: rotation.transition.from_kid,
    rotation_receipt_sha256: rotationReceiptSha256(rotationBytes),
    recovery_window_days: 30,
    retention_years: 7,
    retain_until: "2033-08-31T12:00:00Z",
    escrow_destroyed: true,
  };
}

function receiptBytes(receipt) {
  return Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
}
