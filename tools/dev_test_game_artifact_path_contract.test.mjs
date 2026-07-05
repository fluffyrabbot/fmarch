import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const artifactPathPattern =
  /target\/(?:dev-test-game\/(?:ops-artifacts|seed-fixture-summary|race-coverage|hosted-concurrent-race-matrix|hosted-target-preflight|hosted-evidence-lane|hosted-evidence-lane-demo-proof|hosted-ops-signals|hosted-identity-evidence|hosted-identity-progression-summary|real-hosted-observability-handoff)\.json|auth-invite-role-proof\/invite-role-proof\.json|live-stack-backup-restore-drill\/(?:local-backup-restore-proof\.json|local-live-stack\.dump))/g;

const approvedSourceFiles = new Set([
  "tools/dev_test_game_adjacent_artifact_paths.mjs",
]);

const scanRoots = [
  "tools",
  "frontend/src/lib/server",
  "frontend/src/routes/admin",
];

test("spine-adjacent artifact paths are owned by the shared path module", async () => {
  const findings = [];
  for (const root of scanRoots) {
    for (const file of await runtimeSourceFiles(path.join(repoRoot, root))) {
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
  }

  assert.deepEqual(findings, []);
});

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
