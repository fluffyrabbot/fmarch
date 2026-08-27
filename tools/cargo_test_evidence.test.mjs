import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  matchRequiredTests,
  parseCargoEvidenceArguments,
  passedRustTestNames,
  runCargoTestEvidence,
} from "./cargo_test_evidence.mjs";

test("cargo evidence parses passed names and requires one exact or qualified body", () => {
  const output = "running 2 tests\ntest module::named_case ... ok\ntest second_case ... ok\n";
  assert.deepEqual(passedRustTestNames(output), ["module::named_case", "second_case"]);
  assert.deepEqual(matchRequiredTests(passedRustTestNames(output), ["named_case"]), [
    { required: "named_case", observed: "module::named_case" },
  ]);
  assert.throws(() => matchRequiredTests(["a::same", "b::same"], ["same"]), /matched 2/);
  assert.throws(() => matchRequiredTests([], ["renamed"]), /matched 0/);
});

test("cargo evidence arguments require unique named claims before an argv command", () => {
  assert.deepEqual(
    parseCargoEvidenceArguments(["--required", "one", "--", "cargo", "test"]),
    { required: ["one"], command: ["cargo", "test"] },
  );
  assert.throws(
    () => parseCargoEvidenceArguments(["--required", "one", "--required", "one", "--", "cargo"]),
    /unique/,
  );
});

test("cargo evidence persists the named passed body", async () => {
  const directory = mkdtempSync(join(tmpdir(), "fmarch-cargo-evidence-"));
  try {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const promise = runCargoTestEvidence({
      argv: ["--required", "named_case", "--", "cargo", "test"],
      outputDir: directory,
      env: { FMARCH_PROOF_LANE_ID: "cargo:fixture" },
      now: (() => { let value = 0; return () => value += 100; })(),
      spawnCommand: () => child,
    });
    child.stdout.write("running 1 test\ntest module::named_case ... ok\n");
    child.stdout.end();
    child.stderr.end();
    child.emit("close", 0, null);
    assert.equal(await promise, 0);
    const report = JSON.parse(readFileSync(join(directory, "cargo-test-evidence.json"), "utf8"));
    assert.equal(report.status, "passed");
    assert.deepEqual(report.required_tests, [{ required: "named_case", observed: "module::named_case" }]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
