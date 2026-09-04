import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const [policy, deny, lock, packageJson, frontendPackageJson] = await Promise.all([
  readJson("docs/ops/dependency-policy.json"),
  readText("deny.toml"),
  readText("Cargo.lock"),
  readJson("package.json"),
  readJson("frontend/package.json"),
]);

assert.equal(policy.version, 1, "dependency policy version must be 1");
assert.ok(policy.boundary, "dependency policy must define its proof boundary");
assert.deepEqual(policy.rust.checks, ["advisories", "licenses", "sources", "bans"]);
assert.equal(policy.npm.audit_level, "moderate");
assert.equal(packageJson.private, true, "root npm package must remain private");
assert.equal(frontendPackageJson.private, true, "frontend npm package must remain private");

for (const [crate, minimum] of Object.entries(policy.rust.minimums)) {
  assert.match(
    lock,
    new RegExp(`name = "${escapeRegex(crate)}"\\nversion = "${escapeRegex(minimum)}"`),
    `${crate} must resolve to the reviewed minimum ${minimum}`,
  );
}
for (const packageSpec of policy.rust.forbidden_lock_packages) {
  const separator = packageSpec.lastIndexOf("@");
  const crate = packageSpec.slice(0, separator);
  const version = packageSpec.slice(separator + 1);
  assert.doesNotMatch(
    lock,
    new RegExp(`name = "${escapeRegex(crate)}"\\nversion = "${escapeRegex(version)}"`),
    `forbidden lock package remains: ${packageSpec}`,
  );
}

const denyAdvisories = [...deny.matchAll(/id\s*=\s*"(RUSTSEC-\d{4}-\d{4})"/g)].map(
  (match) => match[1],
);
assert.deepEqual(
  denyAdvisories.sort(),
  policy.exceptions.map((entry) => entry.advisory).sort(),
  "deny.toml advisory exceptions must exactly match the governed policy",
);
for (const exception of [...policy.exceptions, ...policy.license_exceptions]) {
  assert.match(exception.review_by, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(
    Date.parse(`${exception.review_by}T23:59:59Z`) >= Date.now(),
    `dependency exception review expired: ${exception.id ?? exception.crates.join(", ")}`,
  );
}
for (const exception of policy.exceptions) {
  const [crate, version] = exception.crate.split("@");
  assert.match(
    lock,
    new RegExp(`name = "${escapeRegex(crate)}"\\nversion = "${escapeRegex(version)}"`),
    `governed exception package is absent: ${exception.crate}`,
  );
  assert.ok(exception.reason && exception.scope && exception.remove_when);
}

const expectedOfflineScript =
  "node tools/dependency_policy.mjs && cargo deny check --hide-inclusion-graph advisories licenses sources bans";
const expectedAuditScript =
  "npm_config_fetch_timeout=300000 npm_config_fetch_retries=5 npm audit --audit-level=moderate && npm_config_fetch_timeout=300000 npm_config_fetch_retries=5 npm --prefix frontend audit --audit-level=moderate";
assert.equal(
  packageJson.scripts?.["test:dependency-policy:offline"],
  expectedOfflineScript,
  "offline dependency proof command drifted",
);
assert.equal(
  packageJson.scripts?.["test:dependency-policy:audit"],
  expectedAuditScript,
  "dependency audit command drifted",
);
assert.equal(
  packageJson.scripts?.["test:dependency-policy"],
  "npm run test:dependency-policy:offline && npm run test:dependency-policy:audit",
  "dependency policy aggregate drifted",
);

console.log("dependency policy source contract passed");

async function readJson(relativePath) {
  return JSON.parse(await readText(relativePath));
}

async function readText(relativePath) {
  return await readFile(path.join(root, relativePath), "utf8");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
