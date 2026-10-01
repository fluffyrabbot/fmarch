import assert from "node:assert/strict";
import test from "node:test";

import { lockedProofCargoInvocation, proofCargoArgs, validateCargoBuilds } from "./proof_cargo_builds.mjs";

const manifest = {
  lanes: {
    live: { cargo_inputs: { builds: [
      { target: "server/bin/server", profile: "dev" },
      { target: "server/bin/fmarch-migrate", profile: "dev" },
    ] } },
    tls: { cargo_inputs: { builds: [
      { target: "server/bin/fmarch-migrate", profile: "release" },
    ] } },
    static: { cargo_inputs: { builds: [] } },
  },
};
const options = { manifest, env: {}, laneId: "live", target: "server/bin/server" };

test("opaque builds derive one exact locked binary and profile", () => {
  assert.deepEqual(proofCargoArgs(options), [
    "run", "--locked", "--profile", "dev", "-p", "server", "--bin", "server",
  ]);
  assert.deepEqual(proofCargoArgs({ ...options, command: "build", quiet: true }), [
    "build", "--locked", "--quiet", "--profile", "dev", "-p", "server", "--bin", "server",
  ]);
  assert.deepEqual(proofCargoArgs({
    ...options, laneId: "tls", target: "server/bin/fmarch-migrate", profile: "release",
    args: ["--operation-id", "fixed", "--profile", "runtime-argument"],
  }), [
    "run", "--locked", "--profile", "release", "-p", "server", "--bin", "fmarch-migrate",
    "--", "--operation-id", "fixed", "--profile", "runtime-argument",
  ]);
});

test("harness declarations reject undeclared binaries, profiles and static builds", () => {
  for (const changes of [
    { target: "server/bin/fmarch-schema-epoch-reset" },
    { profile: "release" },
    { laneId: "static" },
  ]) assert.throws(() => proofCargoArgs({ ...options, ...changes }), /does not declare/);
  assert.throws(() => proofCargoArgs({ ...options, laneId: "missing" }), /unknown proof Cargo lane/);
  assert.throws(() => proofCargoArgs({ ...options, laneId: "missing", manifest: { lanes: { missing: {} } } }), /must be an object/);
});

test("direct npm and runner-inherited lane claims share the same membership check", () => {
  const expected = proofCargoArgs(options);
  assert.deepEqual(proofCargoArgs({ ...options, env: { FMARCH_PROOF_LANE_ID: "live" } }), expected);
  assert.deepEqual(proofCargoArgs({ ...options, laneId: undefined, env: { FMARCH_PROOF_LANE_ID: "live" } }), expected);
  assert.throws(() => proofCargoArgs({ ...options, env: { FMARCH_PROOF_LANE_ID: "static" } }), /lane mismatch/);
  assert.throws(() => proofCargoArgs({ ...options, laneId: undefined, env: { FMARCH_PROOF_LANE_ID: "static" } }), /does not declare/);
});

test("generic local development still names an explicit binary and retains admission locking", () => {
  const invocation = lockedProofCargoInvocation({ cwd: "/repo", target: "server/bin/fmarch-migrate", env: {} });
  assert.equal(invocation.command, "python3");
  assert.deepEqual(invocation.args, [
    "/repo/scripts/with-heavy-build-lock.py", "--", "cargo", "run", "--locked",
    "--profile", "dev", "-p", "server", "--bin", "fmarch-migrate",
  ]);
  assert.throws(() => proofCargoArgs({ env: {} }), /exact package\/bin\/target/);
});

test("malformed build declarations and command boundaries fail closed", () => {
  const invalid = [
    undefined, {}, { builds: "all" }, { builds: [], fallback: true },
    { builds: [{ target: "server/lib", profile: "dev" }] },
    { builds: [{ target: "../server/bin/server", profile: "dev" }] },
    { builds: [{ target: "server/bin/server", profile: "debug" }] },
    { builds: [{ target: "server/bin/server" }] },
    { builds: [{ target: "server/bin/server", profile: "dev", features: [] }] },
    { builds: [{ target: "server/bin/server", profile: "dev" }, { target: "server/bin/server", profile: "release" }] },
  ];
  for (const declaration of invalid) assert.throws(() => validateCargoBuilds(declaration));
  assert.deepEqual(validateCargoBuilds({ builds: [] }), []);
  assert.throws(() => proofCargoArgs({ ...options, command: "test" }), /unsupported/);
  assert.throws(() => proofCargoArgs({ ...options, command: "build", args: ["--all-targets"] }), /cannot receive binary arguments/);
  assert.throws(() => proofCargoArgs({ ...options, args: [undefined] }), /must be strings/);
});
