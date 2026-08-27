import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertCompleteExactImageTiming,
  assertImmutableRuntimeReference,
  exactImageRuntimeBinaries,
  runExactImageContentSmoke,
  validateStaticRuntimePolicy,
} from "./exact_image_content_smoke.mjs";

test("static runtime contract includes every shipped binary", () => {
  assert.deepEqual(exactImageRuntimeBinaries, [
    "fmarch-server",
    "fmarch-migrate",
    "fmarch-schema-gate",
    "fmarch-schema-epoch-reset",
    "fmarch-staging-search-corpus",
    "fmarch-event-key-admin",
    "fmarch-profile-index-admin",
  ]);
});

test("full-proof image policy is static and writes complete evidence", () => {
  const artifactDirectory = mkdtempSync(join(tmpdir(), "fmarch-static-image-policy-"));
  try {
    const report = runExactImageContentSmoke({
      env: { ...process.env, FMARCH_PROOF_ARTIFACT_DIR: artifactDirectory },
    });
    assert.equal(report.status, "passed");
    assert.equal(report.runtime_uid, 10001);
    assert.deepEqual(report.binary_inventory, exactImageRuntimeBinaries);
    assert.equal(report.runtime_content_directories, false);
    assert.match(report.dockerfile_sha256, /^[0-9a-f]{64}$/u);
    assert.equal(assertCompleteExactImageTiming(report.timing), true);
    assert.deepEqual(JSON.parse(readFileSync(join(artifactDirectory, "report.json"), "utf8")), report);
  } finally {
    rmSync(artifactDirectory, { recursive: true, force: true });
  }
});

test("runtime policy rejects missing binaries and mutable image references", () => {
  const minimal = [
    "FROM runtime-base AS runtime",
    "RUN useradd --create-home --uid 10001 fmarch",
    "USER fmarch",
    'CMD ["/bin/false"]',
  ].join("\n");
  assert.throws(
    () => validateStaticRuntimePolicy({ dockerfile: minimal, serverSource: '"--check-content"' }),
    /binary inventory drifted/,
  );
  const digest = `sha256:${"a".repeat(64)}`;
  assert.equal(
    assertImmutableRuntimeReference(`ghcr.io/example/runtime@${digest}`),
    `ghcr.io/example/runtime@${digest}`,
  );
  assert.throws(
    () => assertImmutableRuntimeReference("ghcr.io/example/runtime:latest"),
    /immutable repository@sha256/,
  );
});
