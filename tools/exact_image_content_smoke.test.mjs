import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  exactImageRuntimeBinaries,
  requiredExactImageEngine,
  resolveExactImageEngine,
  runExactImageContentSmoke,
} from "./exact_image_content_smoke.mjs";

test("exact-image runtime contract includes every shipped server binary", () => {
  assert.deepEqual(exactImageRuntimeBinaries, [
    "fmarch-server",
    "fmarch-migrate",
    "fmarch-schema-gate",
    "fmarch-event-key-admin",
    "fmarch-profile-index-admin",
  ]);
});

test("exact-image content smoke selects Podman only", () => {
  assert.equal(requiredExactImageEngine, "podman");
  assert.equal(resolveExactImageEngine({}), "podman");
  assert.equal(resolveExactImageEngine({ FMARCH_CONTAINER_ENGINE: "podman" }), "podman");
  assert.throws(
    () => resolveExactImageEngine({ FMARCH_CONTAINER_ENGINE: "docker" }),
    /not supported; exact-image proof requires podman/,
  );
  assert.throws(
    () => resolveExactImageEngine({ FMARCH_CONTAINER_ENGINE: "nerdctl" }),
    /not supported; exact-image proof requires podman/,
  );
});

test("rejected container engines leave failed Podman-policy evidence", () => {
  const artifactDirectory = mkdtempSync(join(tmpdir(), "fmarch-exact-image-policy-"));
  try {
    assert.throws(
      () =>
        runExactImageContentSmoke({
          env: {
            ...process.env,
            FMARCH_CONTAINER_ENGINE: "docker",
            FMARCH_PROOF_ARTIFACT_DIR: artifactDirectory,
          },
        }),
      /not supported; exact-image proof requires podman/,
    );
    const report = JSON.parse(readFileSync(join(artifactDirectory, "report.json"), "utf8"));
    assert.equal(report.status, "failed");
    assert.equal(report.timing.failed_phase, "engine_probe");
    assert.equal(report.timing.phases.length, 1);
    assert.equal(report.timing.phases[0].name, "engine_probe");
    assert.equal(report.timing.phases[0].status, "failed");
    assert.ok(report.timing.phases[0].milliseconds >= 0);
  } finally {
    rmSync(artifactDirectory, { recursive: true, force: true });
  }
});
