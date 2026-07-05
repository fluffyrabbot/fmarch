import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const artifactPathPattern =
  /target\/(?:dev-test-game\/(?:ops-artifacts|seed-fixture-summary|race-coverage|race-coverage-admin-proof|hosted-concurrent-race-matrix|hosted-concurrent-race-matrix-admin-proof|hosted-target-preflight|hosted-target-preflight-admin-proof|hosted-target-preflight-real-capture-admin-proof|hosted-target-preflight-real-capture-source|hosted-evidence-lane|hosted-evidence-lane-admin-proof|hosted-evidence-lane-real-capture-admin-proof|hosted-evidence-lane-real-capture-source|hosted-evidence-lane-demo-proof|hosted-evidence-lane-operator-fixture|hosted-evidence-lane-operator-fixture-admin-proof|hosted-matrix-raw-evidence-fixture-proof|real-hosted-matrix-raw-capture|hosted-ops-signals|hosted-identity-evidence|hosted-identity-evidence-admin-proof|hosted-identity-progression-summary|real-hosted-observability-handoff|real-hosted-observability-handoff-admin-proof|release-runbook|release-runbook-admin-proof|release-admin-proof)\.json|auth-invite-role-proof\/invite-role-proof\.json|live-stack-backup-restore-drill\/(?:local-backup-restore-proof\.json|local-live-stack\.dump))/g;

const approvedSourceFiles = new Set([
  "tools/dev_test_game_adjacent_artifact_paths.mjs",
  "tools/dev_test_game_hosted_concurrent_race_matrix_cases.mjs",
  "tools/dev_test_game_hosted_handoff_cases.mjs",
  "tools/dev_test_game_hosted_evidence_lane_operator_fixture_cases.mjs",
  "tools/dev_test_game_hosted_matrix_raw_evidence_fixture_proof.mjs",
  "tools/dev_test_game_real_hosted_matrix_raw_capture.mjs",
  "tools/dev_test_game_hosted_identity_evidence_cases.mjs",
  "tools/dev_test_game_hosted_target_preflight_cases.mjs",
  "tools/dev_test_game_race_coverage.mjs",
  "tools/dev_test_game_real_hosted_observability_handoff_cases.mjs",
  "tools/dev_test_game_release_artifact_paths.mjs",
]);

const scanRoots = [
  "tools",
  "frontend/src/lib/server",
  "frontend/src/routes/admin",
];

test("dev-test-game artifact paths are owned by approved path modules", async () => {
  const findings = [];
  for (const file of await scannedFiles()) {
    const relativePath = path.relative(repoRoot, file);
    if (approvedSourceFiles.has(relativePath)) {
      continue;
    }
    const source = await readFile(file, "utf8");
    const matches = source.match(artifactPathPattern) ?? [];
    for (const match of matches) {
      findings.push(`${relativePath}: ${match}`);
    }
  }

  assert.deepEqual(findings, []);
});

async function scannedFiles() {
  const files = [path.join(repoRoot, "package.json")];
  for (const root of scanRoots) {
    files.push(...(await runtimeSourceFiles(path.join(repoRoot, root))));
  }
  return files;
}

async function runtimeSourceFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await runtimeSourceFiles(fullPath)));
      continue;
    }
    if (!entry.name.endsWith(".mjs") || entry.name.endsWith(".test.mjs")) {
      continue;
    }
    files.push(fullPath);
  }
  return files;
}
