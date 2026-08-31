import assert from "node:assert/strict";
import test from "node:test";

import {
  hardBanViolations,
  outstandingTargetDebt,
  parseCargoDependencies,
  ratchetViolations,
  rfcContractViolations,
} from "./architecture_fitness.mjs";

test("Cargo dependency parser includes production and target dependencies only", () => {
  const dependencies = parseCargoDependencies(`
[dependencies]
context = { path = "../context", version = "0.1.0" }
serde = "1"
renamed = { package = "canonical_name", path = "../canonical_name" }

[target.'cfg(unix)'.dependencies]
runtime = { path = "../runtime" }

[build-dependencies]
codegen = { path = "../codegen" }

[dependencies.table_style]
package = "table_package"
path = "../table_package"

[dev-dependencies]
test_support = { path = "../test_support" }
`);

  assert.deepEqual(
    dependencies,
    [
      { alias: "context", name: "context", workspacePath: true },
      { alias: "serde", name: "serde", workspacePath: false },
      { alias: "renamed", name: "canonical_name", workspacePath: true },
      { alias: "runtime", name: "runtime", workspacePath: true },
      { alias: "codegen", name: "codegen", workspacePath: true },
      { alias: "table_style", name: "table_package", workspacePath: true },
    ],
  );
});

test("hard bans reject a forbidden production edge", () => {
  const manifests = new Map([
    ["crate/Cargo.toml", parseCargoDependencies('[dependencies]\nsqlx = "1"\n')],
  ]);
  assert.deepEqual(
    hardBanViolations(manifests, [
      {
        id: "hard:test",
        manifests: ["crate/Cargo.toml"],
        dependencies: ["sqlx"],
      },
    ]),
    ["hard:test: crate/Cargo.toml depends on forbidden sqlx"],
  );
});

test("workspace dependency ratchets require baseline shrinkage and reject additions", () => {
  const policy = [
    {
      id: "ratchet:test",
      manifest: "crate/Cargo.toml",
      allowedWorkspaceDependencies: ["old_dependency"],
    },
  ];
  const reduced = new Map([["crate/Cargo.toml", []]]);
  assert.deepEqual(ratchetViolations(reduced, policy), [
    "ratchet:test: crate/Cargo.toml no longer depends on recorded workspace dependency old_dependency; remove the stale ratchet allowance in the same architecture migration",
  ]);
  assert.deepEqual(
    ratchetViolations(reduced, [{ ...policy[0], allowedWorkspaceDependencies: [] }]),
    [],
  );

  const expanded = new Map([
    [
      "crate/Cargo.toml",
      parseCargoDependencies(
        '[dependencies]\nold_dependency = { path = "../old" }\nnew_dependency = { path = "../new" }\n',
      ),
    ],
  ]);
  assert.deepEqual(ratchetViolations(expanded, policy), [
    "ratchet:test: crate/Cargo.toml added workspace dependency new_dependency; remove it or amend the ratchet in the same reviewed architecture migration",
  ]);

  const inheritedWorkspaceDependency = new Map([
    [
      "crate/Cargo.toml",
      parseCargoDependencies(
        '[dependencies]\nold_dependency = { path = "../old" }\nnew_dependency = { workspace = true }\n',
      ),
    ],
  ]);
  assert.deepEqual(
    ratchetViolations(inheritedWorkspaceDependency, policy, new Set(["new_dependency"])),
    [
      "ratchet:test: crate/Cargo.toml added workspace dependency new_dependency; remove it or amend the ratchet in the same reviewed architecture migration",
    ],
  );
});

test("target bans report debt without turning unlanded architecture into a false gate", () => {
  const manifests = new Map([
    [
      "crate/Cargo.toml",
      parseCargoDependencies('[dependencies]\nlegacy = { path = "../legacy" }\n'),
    ],
  ]);
  assert.deepEqual(
    outstandingTargetDebt(manifests, [
      { id: "target:test", manifest: "crate/Cargo.toml", dependencies: ["legacy", "gone"] },
    ]),
    ["target:test: crate/Cargo.toml -> legacy"],
  );
});

test("RFC contract distinguishes its governed sections and policy identifiers", () => {
  assert.deepEqual(rfcContractViolations("not an RFC").length > 0, true);
});
