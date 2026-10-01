import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { roleProofContext, openRoleProofDatabase, observeProofProcess, stopProofProcess,
  runProofCommand, serverExecutableFromBuild, waitForRoleProofHealth, closeRoleProofResources, proofGroupHasLiveMembers } from "./live_role_proof_runtime.mjs";

const laneId = "test:dev-test-game-profile";
const baseEnv = { DATABASE_MIGRATION_URL: "postgres://owner:secret@127.0.0.1:5544/source" };
const runnerEnv = { ...baseEnv, FMARCH_PROOF_LANE_ID: laneId, FMARCH_PROOF_RUN_ID: "run-exact", FMARCH_PROOF_ARTIFACT_DIR: "/proof/run-exact/profile" };
const context = env => roleProofContext({ repoRoot: "/repo", laneId, artifactName: "profile-role-proof", env });

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.signals = [];
  child.kill = signal => { child.signals.push(signal); return true; };
  return child;
}

test("canonical role context requires exact lane and complete resource identity", () => {
  const value = context(runnerEnv);
  assert.equal(value.artifactDir, "/proof/run-exact/profile");
  assert.deepEqual(value.execution, { laneId, runId: "run-exact", databaseLifecycle: "runner-owned-disposable-per-proof-run" });
  for (const changed of [
    { FMARCH_PROOF_LANE_ID: "test:dev-test-game-completed-export" },
    { FMARCH_PROOF_RUN_ID: "" }, { FMARCH_PROOF_ARTIFACT_DIR: "" },
    { FMARCH_MEDIA_ROOT: "/ambient/media" }, { FMARCH_ALLOW_STATIC_ROLE_FALLBACK: "1" },
  ]) assert.throws(() => context({ ...runnerEnv, ...changed }));
  assert.throws(() => context({ ...baseEnv, FMARCH_PROOF_RUN_ID: "foreign" }));
});

test("standalone role context is explicit about local database and artifact ownership", () => {
  const value = context(baseEnv);
  assert.equal(value.artifactDir, "/repo/target/profile-role-proof");
  assert.deepEqual(value.execution, { laneId, runId: null, databaseLifecycle: "harness-owned-disposable-per-proof-run" });
  for (const url of [undefined, "", "https://localhost/source", "postgres://remote.example/source", "postgres://localhost/"]) {
    assert.throws(() => context({ DATABASE_MIGRATION_URL: url }));
  }
});

test("runner database remains entirely under runner custody on success or failure", async () => {
  const database = await openRoleProofDatabase(context(runnerEnv), { run: () => assert.fail("runner leaf must not create or drop a database") });
  assert.equal(database.migrationUrl, baseEnv.DATABASE_MIGRATION_URL);
  await database.close();
  await database.close();
});

test("standalone database creates and removes only its fresh generated scratch name", async () => {
  const calls = [];
  const database = await openRoleProofDatabase(context(baseEnv), { id: () => "1234-abcd", run: async (...args) => calls.push(args) });
  assert.equal(new URL(database.migrationUrl).pathname, "/fmarch_role_1234abcd");
  await database.close();
  assert.deepEqual(calls.map(([, args]) => args.at(-1)), [
    'CREATE DATABASE "fmarch_role_1234abcd"',
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'fmarch_role_1234abcd'",
    'DROP DATABASE IF EXISTS "fmarch_role_1234abcd"',
  ]);
  for (const [command, args, options] of calls) {
    assert.equal(command, "psql");
    assert.equal(new URL(args[0]).pathname, "/postgres");
    assert.equal(options.timeoutMs, 5_000);
    assert.ok(args.includes("-X"));
  }
});

test("invalid standalone database identity is rejected before a SQL command", async () => {
  await assert.rejects(openRoleProofDatabase(context(baseEnv), { id: () => "bad';DROP", run: () => assert.fail("unsafe SQL") }), /invalid standalone/);
});

const serverArtifact = { reason: "compiler-artifact", package_id: "path+file:///repo/crates/server#0.1.0", manifest_path: "/repo/crates/server/Cargo.toml", target: { name: "server", kind: ["bin"] }, executable: "/build/debug/server" };
test("API startup launches only the unique binary reported by its own server package", () => {
  const output = `${JSON.stringify({ reason: "build-finished", success: true })}\n${JSON.stringify(serverArtifact)}\n`;
  assert.equal(serverExecutableFromBuild(output, "/repo"), "/build/debug/server");
  for (const artifact of [
    { ...serverArtifact, target: { name: "server", kind: ["lib"] } },
    { ...serverArtifact, target: { name: "other", kind: ["bin"] } },
    { ...serverArtifact, package_id: "path+file:///elsewhere/server#0.1.0" },
    { ...serverArtifact, manifest_path: "/elsewhere/server/Cargo.toml" },
    { ...serverArtifact, executable: "relative/server" },
  ]) assert.throws(() => serverExecutableFromBuild(JSON.stringify(artifact), "/repo"), /exactly one/);
  assert.throws(() => serverExecutableFromBuild(`${output}${output}`, "/repo"), /exactly one/);
  assert.throws(() => serverExecutableFromBuild("not JSON", "/repo"), /exactly one/);
});

test("child observation retains final output through close and bounds diagnostics", async () => {
  const child = fakeChild();
  const observed = observeProofProcess(child);
  child.stdout.write("a".repeat(300_000));
  child.emit("exit", 0, null);
  assert.equal(observed.result(), null);
  child.stdout.write("final artifact\n");
  child.stderr.write("stderr tail\n");
  child.emit("close", 0, null);
  await observed.closed;
  assert.equal(observed.stdout().length, 256 * 1024);
  assert.match(observed.stdout(), /final artifact\n$/);
  assert.match(observed.output(), /stderr tail\n$/);
});

test("API readiness surfaces spawn failure immediately", async () => {
  const child = fakeChild();
  const observed = observeProofProcess(child);
  child.emit("error", new Error("spawn ENOENT"));
  await assert.rejects(waitForRoleProofHealth(observed, "http://localhost:1", { fetchHealth: () => assert.fail("no fetch after spawn error") }), /spawn ENOENT/);
});

test("API readiness rejects signal exit even without a numeric status", async () => {
  const child = fakeChild();
  const observed = observeProofProcess(child);
  child.emit("close", null, "SIGKILL");
  await assert.rejects(waitForRoleProofHealth(observed, "http://localhost:1"), /SIGKILL/);
});

test("API readiness bounds a hung health request by its remaining deadline", async () => {
  const child = fakeChild();
  const observed = observeProofProcess(child);
  const keepAlive = setInterval(() => {}, 1000);
  try {
    await assert.rejects(waitForRoleProofHealth(observed, "http://localhost:1", {
      deadline: Date.now() + 20,
      fetchHealth: async (_url, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })),
    }), /readiness deadline/);
  } finally { clearInterval(keepAlive); }
});

test("server exit interrupts a pending health request instead of waiting its timeout", async () => {
  const child = fakeChild();
  const observed = observeProofProcess(child);
  const promise = waitForRoleProofHealth(observed, "http://localhost:1", { fetchHealth: async () => new Promise(() => {}) });
  child.emit("close", 2, null);
  await assert.rejects(promise, /code=2/);
});

test("teardown escalates from TERM to KILL and waits for closure", async () => {
  const child = fakeChild();
  child.kill = signal => { child.signals.push(signal); if (signal === "SIGKILL") queueMicrotask(() => child.emit("close", null, signal)); return true; };
  await stopProofProcess(observeProofProcess(child), { graceMs: 1, killMs: 20 });
  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
});

test("teardown fails closed when a process cannot be reaped", async () => {
  await assert.rejects(stopProofProcess(observeProofProcess(fakeChild()), { graceMs: 1, killMs: 1 }), /did not close/);
});

test("all cleanup resources run after a rejection or hung close", async () => {
  const closed = [];
  await assert.rejects(closeRoleProofResources([
    { close: async () => { closed.push("browser"); throw new Error("browser close failed"); } },
    { close: async () => { closed.push("vite"); await new Promise(() => {}); } },
    { close: async () => { closed.push("server"); } },
    { close: async () => { closed.push("database"); } },
  ], { timeoutMs: 5 }), error => error instanceof AggregateError && error.errors.length === 2);
  assert.deepEqual(closed, ["browser", "vite", "server", "database"]);
});

test("bounded command reports spawn errors, signal interruption, and successful stdout", async () => {
  await assert.rejects(runProofCommand("/nonexistent-fmarch-command", []), /ENOENT/);
  await assert.rejects(runProofCommand(process.execPath, ["-e", "process.kill(process.pid, 'SIGTERM')"]), /SIGTERM/);
  assert.equal(await runProofCommand(process.execPath, ["-e", "process.stdout.write('artifact');process.stderr.write('diagnostic')"]), "artifact");
});

test("bounded command stops a real child when its deadline expires", async () => {
  let child;
  await assert.rejects(runProofCommand(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    timeoutMs: 30, spawnProcess: (...args) => { child = spawn(...args); return child; },
  }), /deadline/);
  assert.notEqual(child.signalCode, null);
  await delay(1);
});

async function assertPidStopped(pid) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { process.kill(pid, 0); }
    catch (error) { if (error.code === "ESRCH") return; throw error; }
    // An orphan can briefly await init's reap, but cannot retain pipes or work.
    if (process.platform === "linux") {
      const stat = await readFile(`/proc/${pid}/stat`, "utf8").catch(() => "");
      if (!stat || stat.slice(stat.lastIndexOf(")") + 2).startsWith("Z ")) return;
    }
    await delay(20);
  }
  assert.fail(`proof descendant ${pid} remained alive after cleanup`);
}

for (const held of [true, false]) test(`heavy lock ${held ? "held" : "standalone"} timeout reaps a real nested child`, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "fmarch-role-timeout-"));
  const pidPath = path.join(directory, "pids.json");
  let completed = false;
  t.after(async () => {
    if (!completed) {
      const pids = JSON.parse(await readFile(pidPath, "utf8").catch(() => "{}"));
      for (const pid of Object.values(pids)) try { process.kill(pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
    }
    await rm(directory, { recursive: true, force: true });
  });
  const childCode = `require('node:fs').writeFileSync(${JSON.stringify(pidPath)}, JSON.stringify({ child: process.pid, parent: process.ppid })); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);`;
  const parentCode = `process.on('SIGTERM', () => {}); require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(childCode)}], { stdio: 'inherit' }); setInterval(() => {}, 1000);`;
  const env = { ...process.env, HOST_HEAVY_BUILD_LOCK_PATH: path.join(directory, "lock"), HOST_ALLOW_UNREGISTERED_CARGO: "1" };
  delete env.HOST_HEAVY_BUILD_LOCK_HELD;
  delete env.MESH_HEAVY_BUILD_LOCK_HELD;
  if (held) env.HOST_HEAVY_BUILD_LOCK_HELD = "1";
  const wrapper = fileURLToPath(new URL("../scripts/with-heavy-build-lock.py", import.meta.url));
  await assert.rejects(runProofCommand("python3", [wrapper, "--", "python3", wrapper, "--", process.execPath, "-e", parentCode], { env, timeoutMs: 750 }), /deadline/);
  const pids = JSON.parse(await readFile(pidPath, "utf8"));
  await assertPidStopped(pids.child);
  await assertPidStopped(pids.parent);
  completed = true;
});

test("held lock drains an exited wrapper's surviving descendants", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "fmarch-role-orphan-"));
  const pidPath = path.join(directory, "child.pid");
  let completed = false;
  t.after(async () => {
    if (!completed) {
      const pid = Number(await readFile(pidPath, "utf8").catch(() => "0"));
      if (pid > 0) try { process.kill(pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
    }
    await rm(directory, { recursive: true, force: true });
  });
  const childCode = `process.on('SIGTERM', () => {}); require('node:fs').writeFileSync(${JSON.stringify(pidPath)}, String(process.pid)); setInterval(() => {}, 1000);`;
  const parentCode = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(childCode)}], { stdio: 'ignore' }); setInterval(() => { if (require('node:fs').existsSync(${JSON.stringify(pidPath)})) process.exit(0); }, 10);`;
  const wrapper = fileURLToPath(new URL("../scripts/with-heavy-build-lock.py", import.meta.url));
  await assert.rejects(runProofCommand("python3", [wrapper, "--", process.execPath, "-e", parentCode], { env: { ...process.env, HOST_HEAVY_BUILD_LOCK_HELD: "1" }, timeoutMs: 3000 }), /left live descendants/);
  await assertPidStopped(Number(await readFile(pidPath, "utf8")));
  completed = true;
});


test("outer harness cancellation kills all detached held-lock command groups", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "fmarch-role-cancel-"));
  const pidPaths = [path.join(directory, "first.json"), path.join(directory, "second.json")];
  let harness;
  let completed = false;
  t.after(async () => {
    if (!completed) {
      for (const pidPath of pidPaths) {
        const pids = JSON.parse(await readFile(pidPath, "utf8").catch(() => "{}"));
        for (const pid of Object.values(pids)) try { process.kill(pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
      }
      if (harness?.exitCode === null && harness.signalCode === null) harness.kill("SIGKILL");
    }
    await rm(directory, { recursive: true, force: true });
  });
  const helper = new URL("./live_role_proof_runtime.mjs", import.meta.url).href;
  const wrapper = fileURLToPath(new URL("../scripts/with-heavy-build-lock.py", import.meta.url));
  const jobs = pidPaths.map(pidPath => {
    const childCode = `process.on('SIGTERM', () => {}); require('node:fs').writeFileSync(${JSON.stringify(pidPath)}, JSON.stringify({ child: process.pid, parent: process.ppid })); setInterval(() => {}, 1000);`;
    return `runProofCommand('python3', [${JSON.stringify(wrapper)}, '--', process.execPath, '-e', ${JSON.stringify(childCode)}], { env: { ...process.env, HOST_HEAVY_BUILD_LOCK_HELD: '1' }, timeoutMs: 20000 })`;
  });
  harness = spawn(process.execPath, ["--input-type=module", "-e", `import { runProofCommand } from ${JSON.stringify(helper)}; await Promise.all([${jobs.join(",")}]);`], { stdio: ["ignore", "pipe", "pipe"] });
  const observed = observeProofProcess(harness);
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await Promise.all(pidPaths.map(file => readFile(file, "utf8").catch(() => null)))).every(Boolean)) break;
    await delay(20);
  }
  const records = await Promise.all(pidPaths.map(async file => JSON.parse(await readFile(file, "utf8"))));
  harness.kill("SIGTERM");
  assert.equal(await Promise.race([observed.closed.then(result => result.signal), delay(2000).then(() => "timeout")]), "SIGTERM");
  for (const record of records) for (const pid of Object.values(record)) await assertPidStopped(pid);
  completed = true;
});

test("completed held-lock commands remove their temporary signal handlers", async () => {
  const before = [process.listenerCount("SIGTERM"), process.listenerCount("SIGINT")];
  await Promise.all([1, 2].map(() => runProofCommand(process.execPath, ["-e", "process.stdout.write('ok')"], { env: { ...process.env, HOST_HEAVY_BUILD_LOCK_HELD: "1" } })));
  assert.deepEqual([process.listenerCount("SIGTERM"), process.listenerCount("SIGINT")], before);
});


test("group liveness distinguishes zombie-only groups without ignoring live members", () => {
  assert.equal(proofGroupHasLiveMembers(12, "12 Z\n12 ZN\n13 S+\n"), false);
  assert.equal(proofGroupHasLiveMembers(12, "12 Z\n12 R+\n"), true);
  assert.equal(proofGroupHasLiveMembers(12, "13 S\n"), false);
  assert.equal(proofGroupHasLiveMembers(12, ""), false);
  assert.throws(() => proofGroupHasLiveMembers(12, "malformed row"), /invalid.*inventory/);
});
