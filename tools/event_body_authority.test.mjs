import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { containsDirectEventBodySql, inspectEventBodyAuthority } from "./event_body_authority.mjs";
import { proofSourceFiles } from "./proof_input_paths.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "fmarch-event-body-authority-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  await mkdir(path.join(root, "crates"));
  return root;
}

async function write(root, filename, contents) {
  const destination = path.join(root, filename);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, contents);
}

test("both forbidden SQL-source forms fail after Rust-compatible normalization", async (t) => {
  const root = await fixture(t);
  await write(root, "crates/api/src/direct.rs", 'let sql = "SELECT\u0085PAYLOAD\n FROM\tEVENTS";');
  await write(root, "crates/commands/src/nested/json.rs", 'let sql = "SELECT payload->>\'body\' FROM events";');
  assert.deepEqual((await inspectEventBodyAuthority(root)).violations, [
    "crates/api/src/direct.rs", "crates/commands/src/nested/json.rs",
  ]);
  assert.equal(containsDirectEventBodySql('// FROM events\n// other text payload->'), true,
    "the retained guard tests same-file co-occurrence, including comments");
});

test("permitted source reads remain permitted", async (t) => {
  const root = await fixture(t);
  await write(root, "crates/api/src/lib.rs", 'let sql = "SELECT stream_seq FROM events";');
  await write(root, "crates/projections/src/lib.rs", 'let sql = "SELECT payload->>\'body\' FROM projection_rows";');
  await write(root, "crates/commands/src/lib.rs", 'let events = eventstore::load_stream(pool, stream).await?;');
  const result = await inspectEventBodyAuthority(root);
  assert.equal(result.scannedFiles.length, 3);
  assert.deepEqual(result.violations, []);
});

test("eventstore, integration tests, and non-Rust files are excluded", async (t) => {
  const root = await fixture(t);
  const forbidden = "SELECT payload FROM events";
  await write(root, "crates/eventstore/src/nested/body.rs", forbidden);
  await write(root, "crates/api/tests/boundary.rs", forbidden);
  await write(root, "crates/api/src/query.sql", forbidden);
  await write(root, "crates/api/src/lib.rs", "pub fn harmless() {}");
  await write(root, "tools/source.rs", forbidden);
  assert.deepEqual(await inspectEventBodyAuthority(root), {
    scannedFiles: ["crates/api/src/lib.rs"], violations: [],
  });
});

test("new and deleted scanned files are observed on every inspection", async (t) => {
  const root = await fixture(t);
  await write(root, "crates/api/src/lib.rs", "pub fn harmless() {}");
  const before = await inspectEventBodyAuthority(root);
  const added = "crates/new_context/src/nested/query.rs";
  await write(root, added, "SELECT payload FROM events");
  const during = await inspectEventBodyAuthority(root);
  assert.deepEqual(during.scannedFiles, [...before.scannedFiles, added]);
  assert.deepEqual(during.violations, [added]);
  execFileSync("git", ["add", added], { cwd: root });
  await rm(path.join(root, added));
  assert.ok(proofSourceFiles(root).includes(added), "Git still lists the deleted tracked path");
  assert.deepEqual(await inspectEventBodyAuthority(root), before);
});

test("ignored source and symlinks stay outside both scanner and proof source inventories", async (t) => {
  const root = await fixture(t);
  await write(root, ".gitignore", "crates/api/src/scratch/\n");
  await write(root, "crates/api/src/lib.rs", "pub fn harmless() {}");
  await write(root, "crates/api/src/scratch/bad.rs", "SELECT payload FROM events");
  const link = "crates/api/src/scratch/link.rs";
  await symlink("bad.rs", path.join(root, link));
  const files = proofSourceFiles(root);
  assert.equal(files.some((filename) => filename.startsWith("crates/api/src/scratch/")), false);
  assert.deepEqual(await inspectEventBodyAuthority(root), {
    scannedFiles: ["crates/api/src/lib.rs"], violations: [],
  });
  execFileSync("git", ["add", "--force", link], { cwd: root });
  assert.ok(proofSourceFiles(root).includes(link), "tracking a previously ignored link makes it visible");
  await assert.rejects(inspectEventBodyAuthority(root), /symlink/);
});

test("symlinks fail closed at every scanned tree boundary", async (t) => {
  for (const location of ["crates", "crates/api", "crates/api/src", "crates/api/src/nested", "crates/api/src/query.rs"]) {
    await t.test(location, async (t) => {
      const root = await fixture(t);
      const target = path.join(root, "outside");
      await mkdir(target);
      await writeFile(path.join(target, "query.rs"), "SELECT payload FROM events");
      const link = path.join(root, location);
      if (location === "crates") await rm(link, { recursive: true });
      await mkdir(path.dirname(link), { recursive: true });
      await symlink(location.endsWith(".rs") ? path.join(target, "query.rs") : target, link);
      await assert.rejects(inspectEventBodyAuthority(root), /symlink|real directory/);
    });
  }
});

test("CLI fails on violations and invalid roots instead of reporting a pass", async (t) => {
  const root = await fixture(t);
  const script = fileURLToPath(new URL("./event_body_authority.mjs", import.meta.url));
  const run = (...argv) => spawnSync(process.execPath, [script, ...argv], { encoding: "utf8", timeout: 5_000 });
  assert.equal(run("--root", root).status, 0);
  await write(root, "crates/api/src/lib.rs", "SELECT payload FROM events");
  const rejected = run("--root", root);
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /crates\/api\/src\/lib\.rs/);
  assert.equal(run("--root", path.join(root, "missing")).status, 1);
  assert.match(run("--unknown").stderr, /usage:/);
});
