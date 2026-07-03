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
});

test("local admin proof builders use shared audit surface ids", async () => {
  const rawIds = [
    ...Object.values(localAdminAuditIds),
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
    for (const rawId of rawIds) {
      assert.equal(
        source.includes(JSON.stringify(rawId)),
        false,
        `${sourceFile} should import the local admin audit id for ${rawId}`,
      );
    }
  }
});
