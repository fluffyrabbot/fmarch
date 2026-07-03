import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  localAdminAuditHandoffCheckIds,
  localAdminAuditIds,
  localAdminAuditRoleUrl,
} from "./dev_test_game_admin_audit_surface_ids.mjs";

test("local admin audit surface ids build stable seeded role URLs", () => {
  assert.deepEqual(localAdminAuditIds, {
    coreLoop: "local-core-loop",
    hardening: "local-hardening",
    playerRecovery: "local-player-recovery",
    identityAdapter: "local-identity-adapter",
    hostedIdentityEvidence: "local-hosted-identity-evidence",
    backupRestore: "local-backup-restore",
    opsArtifacts: "local-ops-artifacts",
    seedFixtures: "local-seed-fixtures",
    releaseReadiness: "local-release-readiness",
    releaseRunbook: "local-release-runbook",
    raceCoverage: "local-race-coverage",
    hostedTargetPreflight: "local-hosted-target-preflight",
    hostedEvidenceLane: "local-hosted-evidence-lane",
    hostedConcurrentRaceMatrix: "local-hosted-concurrent-race-matrix",
    hostedOpsSignals: "local-hosted-ops-signals",
    adminSpine: "local-admin-spine",
    spineManifest: "local-spine-manifest",
    proofGraph: "local-proof-graph",
    proofFreshness: "local-proof-freshness",
    nextAction: "local-next-action",
  });
  assert.deepEqual(localAdminAuditHandoffCheckIds, {
    proofFreshness: "proof-freshness-handoff",
    nextAction: "next-action-handoff",
    spineManifest: "spine-manifest-handoff",
  });
  assert.equal(
    localAdminAuditRoleUrl(localAdminAuditIds.nextAction),
    "/admin/audit/local-next-action?game=<seeded-game>",
  );
  assert.equal(
    localAdminAuditRoleUrl(localAdminAuditIds.proofGraph, { game: "midsummer" }),
    "/admin/audit/local-proof-graph?game=midsummer",
  );
});

test("local admin proof builders use shared audit surface ids", async () => {
  const terminalRawIds = [
    localAdminAuditIds.adminSpine,
    localAdminAuditIds.spineManifest,
    localAdminAuditIds.proofGraph,
    localAdminAuditIds.proofFreshness,
    localAdminAuditIds.nextAction,
    ...Object.values(localAdminAuditHandoffCheckIds),
  ];
  for (const sourceFile of [
    "dev_test_game_local_readiness_dependencies.mjs",
    "dev_test_game_proof_freshness_admin_proof.mjs",
    "dev_test_game_spine_manifest_admin_proof.mjs",
    "dev_test_game_admin_spine_admin_proof.mjs",
    "dev_test_game_next_action_admin_proof.mjs",
    "dev_test_game_proof_graph.mjs",
    "dev_test_game_spine_manifest.mjs",
    "dev_test_game_release_readiness.mjs",
  ]) {
    const source = await readFile(new URL(sourceFile, import.meta.url), "utf8");
    for (const rawId of terminalRawIds) {
      assert.equal(
        source.includes(JSON.stringify(rawId)),
        false,
        `${sourceFile} should import the local admin audit id for ${rawId}`,
      );
    }
  }
});

test("dev-test-game proof surface fixtures use shared core and hardening role URLs", async () => {
  const source = await readFile(
    new URL("dev_test_game.test.mjs", import.meta.url),
    "utf8",
  );
  for (const rawValue of [
    localAdminAuditRoleUrl(localAdminAuditIds.coreLoop),
    localAdminAuditRoleUrl(localAdminAuditIds.hardening),
    `admin-audit-link-${localAdminAuditIds.coreLoop}`,
    `admin-audit-link-${localAdminAuditIds.hardening}`,
  ]) {
    assert.equal(
      source.includes(JSON.stringify(rawValue)),
      false,
      `dev_test_game.test.mjs should derive ${rawValue} from shared admin audit ids`,
    );
  }
});

test("next-action spine fixtures use shared feature audit role URLs", async () => {
  const source = await readFile(
    new URL("dev_test_game_next_action_spine_fixtures.mjs", import.meta.url),
    "utf8",
  );
  for (const rawValue of [
    localAdminAuditRoleUrl(localAdminAuditIds.coreLoop),
    localAdminAuditRoleUrl(localAdminAuditIds.identityAdapter),
  ]) {
    assert.equal(
      source.includes(JSON.stringify(rawValue)),
      false,
      `dev_test_game_next_action_spine_fixtures.mjs should derive ${rawValue} from shared admin audit ids`,
    );
  }
});

test("admin proof handoff builders use shared audit surface ids", async () => {
  const rawIds = [
    ...Object.values(localAdminAuditIds),
    ...Object.values(localAdminAuditHandoffCheckIds),
  ];
  for (const sourceFile of [
    "dev_test_game_proof_graph_handoff_cases.mjs",
    "dev_test_game_proof_graph_admin_proof.mjs",
    "dev_test_game_admin_audit_handoff_contract.mjs",
    "dev_test_game_hardening_admin_proof.mjs",
    "dev_test_game_hosted_concurrent_race_matrix_cases.mjs",
    "dev_test_game_hosted_ops_signal_cases.mjs",
    "../frontend/src/routes/admin/admin-route-model.mjs",
    "../frontend/src/routes/admin/admin-route-model.test.mjs",
  ]) {
    const source = await readFile(new URL(sourceFile, import.meta.url), "utf8");
    for (const rawId of rawIds) {
      assert.equal(
        source.includes(JSON.stringify(rawId)),
        false,
        `${sourceFile} should import the local admin audit id for ${rawId}`,
      );
    }
  }
});
