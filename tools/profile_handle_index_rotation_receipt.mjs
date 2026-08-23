import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const writerNames = Object.freeze([
  "legacy_profile_writer_sweep",
  "operator_maintenance_job",
  "profile_projection_rebuild",
  "subject_erasure_worker",
]);
const recoveryWindowDays = 30;
const retentionYears = 7;
const kidPattern = /^[A-Za-z0-9._-]{1,128}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const commitPattern = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const deploymentIdPattern = /^[A-Za-z0-9_-]{1,128}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const utcTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

export function rotationReceiptSha256(receiptBytes) {
  requireCondition(
    Buffer.isBuffer(receiptBytes) || typeof receiptBytes === "string",
    "rotation receipt bytes must be supplied",
  );
  return createHash("sha256").update(receiptBytes).digest("hex");
}

export function validateRotationReceipt(receipt) {
  requireExactKeys(receipt, [
    "environment",
    "operator_shell",
    "pre_drain_plan",
    "post_drain_plan",
    "record_type",
    "recorded_at",
    "recovery_escrow",
    "redeploy",
    "reindex",
    "release",
    "rotation_id",
    "schema_version",
    "status",
    "transition",
    "writer_drain",
  ], "rotation receipt");
  requireCondition(receipt.schema_version === 1, "rotation receipt schema version is invalid");
  requireCondition(
    receipt.record_type === "profile_handle_index_rotation",
    "rotation receipt type is invalid",
  );
  requireCondition(receipt.status === "redeployed", "rotation receipt status is invalid");
  requireUuid(receipt.rotation_id, "rotation receipt id is invalid");
  requireUtcTimestamp(receipt.recorded_at, "rotation receipt time is invalid");
  requireEnvironment(receipt.environment, "rotation receipt environment is invalid");

  validateRelease(receipt.release);
  const transition = validateTransition(receipt.transition);
  validateOperatorShell(receipt.operator_shell);
  validateWriterDrain(receipt.writer_drain);
  validatePlanReport(receipt.pre_drain_plan, transition, "pre-drain plan is invalid");
  validatePlanReport(receipt.post_drain_plan, transition, "post-drain plan is invalid");
  validateReindexReport(receipt.reindex, transition);
  requireCondition(
    receipt.post_drain_plan.active_profile_count === receipt.reindex.active_profile_count,
    "post-drain and reindex counts must match",
  );
  validateRedeploy(receipt.redeploy);
  validateRecoveryEscrow(receipt.recovery_escrow, receipt.recorded_at, transition.from_kid);
  return true;
}

export function validateEscrowDestructionReceipt({
  rotationReceipt,
  rotationReceiptBytes,
  destructionReceipt,
}) {
  validateRotationReceipt(rotationReceipt);
  requireExactKeys(destructionReceipt, [
    "environment",
    "escrow_destroyed",
    "record_type",
    "recorded_at",
    "recovery_window_days",
    "retain_until",
    "retention_years",
    "retired_kid",
    "rotation_id",
    "rotation_receipt_sha256",
    "schema_version",
  ], "escrow destruction receipt");
  requireCondition(
    destructionReceipt.schema_version === 1,
    "escrow destruction receipt schema version is invalid",
  );
  requireCondition(
    destructionReceipt.record_type === "profile_handle_index_escrow_destruction",
    "escrow destruction receipt type is invalid",
  );
  requireUuid(destructionReceipt.rotation_id, "escrow destruction rotation id is invalid");
  requireUtcTimestamp(destructionReceipt.recorded_at, "escrow destruction time is invalid");
  requireEnvironment(destructionReceipt.environment, "escrow destruction environment is invalid");
  requireKid(destructionReceipt.retired_kid, "escrow destruction retired KID is invalid");
  requireCondition(
    sha256Pattern.test(destructionReceipt.rotation_receipt_sha256),
    "escrow destruction parent hash is invalid",
  );
  requireCondition(
    destructionReceipt.recovery_window_days === recoveryWindowDays,
    "escrow destruction recovery window is invalid",
  );
  requireCondition(
    destructionReceipt.retention_years === retentionYears,
    "escrow destruction retention period is invalid",
  );
  requireUtcTimestamp(destructionReceipt.retain_until, "escrow destruction retention time is invalid");
  requireCondition(
    destructionReceipt.escrow_destroyed === true,
    "escrow destruction state is invalid",
  );
  requireCondition(
    destructionReceipt.rotation_id === rotationReceipt.rotation_id,
    "escrow destruction must link its rotation id",
  );
  requireCondition(
    destructionReceipt.environment === rotationReceipt.environment,
    "escrow destruction must link its environment",
  );
  requireCondition(
    destructionReceipt.retired_kid === rotationReceipt.transition.from_kid,
    "escrow destruction must link its retired KID",
  );
  requireCondition(
    destructionReceipt.rotation_receipt_sha256 === rotationReceiptSha256(rotationReceiptBytes),
    "escrow destruction must link the exact parent receipt bytes",
  );
  const destructionTime = parseUtcTimestamp(destructionReceipt.recorded_at);
  const escrowNotBefore = parseUtcTimestamp(rotationReceipt.recovery_escrow.not_before);
  requireCondition(
    destructionTime.getTime() >= escrowNotBefore.getTime(),
    "escrow destruction precedes the recovery window",
  );
  const retentionEnd = parseUtcTimestamp(destructionReceipt.retain_until);
  requireCondition(
    retentionEnd.getTime() >= addUtcCalendarYears(destructionTime, retentionYears).getTime(),
    "escrow destruction retention period is too short",
  );
  return true;
}

export function parseArguments(argv) {
  let rotationPath;
  let destructionPath;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--rotation") {
      rotationPath = argv[++index];
    } else if (argument === "--destruction") {
      destructionPath = argv[++index];
    } else {
      throw new Error("unknown profile-handle-index receipt argument");
    }
    requireCondition(typeof (argument === "--rotation" ? rotationPath : destructionPath) === "string", "receipt path is required");
  }
  requireCondition(typeof rotationPath === "string", "rotation receipt path is required");
  return { rotationPath, destructionPath };
}

async function main() {
  try {
    const { rotationPath, destructionPath } = parseArguments(process.argv.slice(2));
    const rotationReceiptBytes = await readFile(rotationPath);
    const rotationReceipt = parseReceipt(rotationReceiptBytes);
    validateRotationReceipt(rotationReceipt);
    if (destructionPath) {
      const destructionReceipt = parseReceipt(await readFile(destructionPath));
      validateEscrowDestructionReceipt({
        rotationReceipt,
        rotationReceiptBytes,
        destructionReceipt,
      });
    }
    console.log("profile-handle-index receipt validation passed");
    console.log(`rotation_receipt_sha256=${rotationReceiptSha256(rotationReceiptBytes)}`);
  } catch {
    console.error("profile-handle-index receipt validation failed");
    process.exitCode = 1;
  }
}

function validateRelease(release) {
  requireExactKeys(release, ["api_commit", "api_deployment_id"], "rotation release");
  requireCondition(commitPattern.test(release.api_commit), "rotation release commit is invalid");
  requireCondition(
    deploymentIdPattern.test(release.api_deployment_id),
    "rotation release deployment id is invalid",
  );
}

function validateTransition(transition) {
  requireExactKeys(transition, ["from_kid", "to_kid"], "rotation transition");
  requireKid(transition.from_kid, "rotation source KID is invalid");
  requireKid(transition.to_kid, "rotation replacement KID is invalid");
  requireCondition(transition.from_kid !== transition.to_kid, "rotation KIDs must differ");
  return transition;
}

function validateOperatorShell(operatorShell) {
  requireExactKeys(operatorShell, [
    "child_environment",
    "database_transport",
    "env_allowlist",
    "outer_environment_persisted",
    "replacement_service_variable_created",
    "source_service_role",
    "transport",
  ], "rotation operator shell");
  requireCondition(
    operatorShell.transport === "railway_ssh_database_tunnel",
    "rotation transport is invalid",
  );
  requireCondition(
    operatorShell.database_transport === "sslmode_require",
    "rotation database transport is invalid",
  );
  requireCondition(
    operatorShell.source_service_role === "api",
    "rotation source service role is invalid",
  );
  requireCondition(
    operatorShell.env_allowlist === "deploy/railway/profile-index-admin.env.example",
    "rotation allowlist is invalid",
  );
  requireCondition(
    operatorShell.child_environment === "node_spawn_exact_allowlist",
    "rotation child environment is invalid",
  );
  requireCondition(
    operatorShell.outer_environment_persisted === false,
    "rotation outer environment persistence is invalid",
  );
  requireCondition(
    operatorShell.replacement_service_variable_created === false,
    "rotation replacement variable state is invalid",
  );
}

function validateWriterDrain(writerDrain) {
  requireExactKeys(writerDrain, [
    "api_scaled_to_zero",
    "expected_api_replicas",
    "out_of_band_inventory_complete",
    "out_of_band_writers",
    "zero_live_api_replicas_confirmed",
  ], "rotation writer drain");
  requireCondition(writerDrain.expected_api_replicas === 2, "rotation replica target is invalid");
  requireCondition(writerDrain.api_scaled_to_zero === true, "rotation API drain is invalid");
  requireCondition(
    writerDrain.zero_live_api_replicas_confirmed === true,
    "rotation zero-replica confirmation is invalid",
  );
  requireCondition(
    writerDrain.out_of_band_inventory_complete === true,
    "rotation writer inventory is invalid",
  );
  requireExactKeys(writerDrain.out_of_band_writers, writerNames, "rotation writer inventory");
  for (const writerState of Object.values(writerDrain.out_of_band_writers)) {
    requireCondition(
      writerState === "stopped" || writerState === "absent",
      "rotation writer state is invalid",
    );
  }
}

function validatePlanReport(report, transition, reason) {
  requireExactKeys(report, [
    "active_profile_count",
    "current_kid",
    "read_only",
    "replacement_kid",
    "requires_writer_drain",
    "status",
  ], reason);
  requireCondition(report.status === "planned", reason);
  requireCondition(report.read_only === true, reason);
  requireCondition(report.requires_writer_drain === true, reason);
  requireProfileCount(report.active_profile_count, reason);
  requireCondition(report.current_kid === transition.from_kid, reason);
  requireCondition(report.replacement_kid === transition.to_kid, reason);
}

function validateReindexReport(report, transition) {
  requireExactKeys(report, [
    "active_profile_count",
    "current_kid",
    "executed",
    "read_only",
    "replacement_kid",
    "status",
    "writers_drained",
  ], "rotation reindex report");
  requireCondition(report.status === "reindexed", "rotation reindex report is invalid");
  requireCondition(report.read_only === false, "rotation reindex report is invalid");
  requireCondition(report.writers_drained === true, "rotation reindex report is invalid");
  requireCondition(report.executed === true, "rotation reindex report is invalid");
  requireProfileCount(report.active_profile_count, "rotation reindex report is invalid");
  requireCondition(report.current_kid === transition.from_kid, "rotation reindex report is invalid");
  requireCondition(report.replacement_kid === transition.to_kid, "rotation reindex report is invalid");
}

function validateRedeploy(redeploy) {
  requireExactKeys(redeploy, [
    "api_deployment_status",
    "api_replica_target",
    "duplicate_handle_rejected",
    "owner_profile_read_passed",
    "readyz_passed",
    "replacement_key_absent_from_api",
    "two_live_api_replicas_confirmed",
  ], "rotation redeploy proof");
  requireCondition(redeploy.api_replica_target === 2, "rotation redeploy replica target is invalid");
  requireCondition(
    redeploy.api_deployment_status === "SUCCESS",
    "rotation redeploy status is invalid",
  );
  for (const field of [
    "two_live_api_replicas_confirmed",
    "readyz_passed",
    "owner_profile_read_passed",
    "duplicate_handle_rejected",
    "replacement_key_absent_from_api",
  ]) {
    requireCondition(redeploy[field] === true, "rotation redeploy proof is invalid");
  }
}

function validateRecoveryEscrow(escrow, recordedAt, oldKid) {
  requireExactKeys(escrow, ["not_before", "old_kid", "recovery_window_days", "state"], "rotation recovery escrow");
  requireKid(escrow.old_kid, "rotation recovery escrow KID is invalid");
  requireCondition(escrow.old_kid === oldKid, "rotation recovery escrow must link its old KID");
  requireCondition(escrow.state === "held", "rotation recovery escrow state is invalid");
  requireCondition(
    escrow.recovery_window_days === recoveryWindowDays,
    "rotation recovery escrow window is invalid",
  );
  requireUtcTimestamp(escrow.not_before, "rotation recovery escrow time is invalid");
  requireCondition(
    parseUtcTimestamp(escrow.not_before).getTime() >= addUtcCalendarDays(parseUtcTimestamp(recordedAt), recoveryWindowDays).getTime(),
    "rotation recovery escrow window is too short",
  );
}

function requireExactKeys(value, expectedKeys, reason) {
  requireCondition(isObject(value), `${reason} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  requireCondition(
    actual.length === expected.length && actual.every((key, index) => key === expected[index]),
    `${reason} fields are invalid`,
  );
}

function requireProfileCount(value, reason) {
  requireCondition(Number.isSafeInteger(value) && value >= 0, reason);
}

function requireKid(value, reason) {
  requireCondition(typeof value === "string" && kidPattern.test(value), reason);
}

function requireUuid(value, reason) {
  requireCondition(typeof value === "string" && uuidPattern.test(value), reason);
}

function requireEnvironment(value, reason) {
  requireCondition(value === "staging" || value === "production", reason);
}

function requireUtcTimestamp(value, reason) {
  requireCondition(typeof value === "string" && utcTimestampPattern.test(value), reason);
  requireCondition(Number.isFinite(Date.parse(value)), reason);
}

function parseUtcTimestamp(value) {
  return new Date(value);
}

function addUtcCalendarDays(date, days) {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function addUtcCalendarYears(date, years) {
  const result = new Date(date.getTime());
  result.setUTCFullYear(result.getUTCFullYear() + years);
  return result;
}

function parseReceipt(bytes) {
  return JSON.parse(bytes.toString("utf8"));
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
