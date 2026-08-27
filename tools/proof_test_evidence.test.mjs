import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { parseEvidenceClaims, verifyEvidenceClaims } from "./proof_test_evidence.mjs";

test("specialized evidence consumes one named claim from each broad producer", () => {
  const root = mkdtempSync(join(tmpdir(), "fmarch-proof-evidence-"));
  try {
    const first = join(root, "first");
    const second = join(root, "second");
    for (const [directory, lane, name] of [[first, "cargo:first", "one"], [second, "cargo:second", "two"]]) {
      mkdirSync(directory);
      writeFileSync(join(directory, "cargo-test-evidence.json"), JSON.stringify({
        schema: 1,
        kind: "fmarch-cargo-test-evidence",
        status: "passed",
        lane_id: lane,
        required_tests: [{ required: name, observed: `module::${name}` }],
      }));
    }
    const claims = parseEvidenceClaims(["--claim", "FIRST:one", "--claim", "SECOND:two"]);
    assert.deepEqual(verifyEvidenceClaims(claims, { FIRST: first, SECOND: second }), [
      { environment: "FIRST", test: "one", observed: "module::one", producer_lane: "cargo:first" },
      { environment: "SECOND", test: "two", observed: "module::two", producer_lane: "cargo:second" },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
