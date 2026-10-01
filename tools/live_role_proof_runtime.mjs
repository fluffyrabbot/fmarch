import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { lockedProofCargoInvocation } from "./proof_cargo_builds.mjs";
import { serverRuntimeEnvironment } from "./run_fmarch_migrations.mjs";

const roleLanes = new Set(["test:dev-test-game-profile", "test:dev-test-game-completed-export"]);
const outputLimit = 256 * 1024;

/** Bind a role proof to its runner's resource ownership before any side effects. */
export function roleProofContext({ repoRoot, laneId, artifactName, env = process.env }) {
  if (!roleLanes.has(laneId)) throw new Error(`unsupported live role proof lane ${laneId}`);
  const runnerOwned = env.FMARCH_PROOF_LANE_ID !== undefined;
  if (runnerOwned && env.FMARCH_PROOF_LANE_ID !== laneId) throw new Error(`live role proof lane mismatch: ${env.FMARCH_PROOF_LANE_ID} != ${laneId}`);
  if (!runnerOwned && env.FMARCH_PROOF_RUN_ID !== undefined) throw new Error("proof run ID requires its canonical lane ID");
  if (runnerOwned && (!env.FMARCH_PROOF_RUN_ID?.trim() || !env.FMARCH_PROOF_ARTIFACT_DIR?.trim())) throw new Error("runner-owned role proof requires run ID and artifact directory");
  if (runnerOwned && env.FMARCH_MEDIA_ROOT !== undefined) throw new Error("runner-owned role proof may not override FMARCH_MEDIA_ROOT");
  if (runnerOwned && env.FMARCH_ALLOW_STATIC_ROLE_FALLBACK === "1") throw new Error("canonical role proof requires live browser evidence");
  if (env.FMARCH_PROOF_ARTIFACT_DIR !== undefined && !env.FMARCH_PROOF_ARTIFACT_DIR.trim()) throw new Error("proof artifact directory must not be empty");
  const migrationUrl = localMigrationUrl(env.DATABASE_MIGRATION_URL);
  return Object.freeze({
    laneId, runnerOwned, migrationUrl,
    artifactDir: path.resolve(env.FMARCH_PROOF_ARTIFACT_DIR ?? path.join(repoRoot, "target", artifactName)),
    execution: Object.freeze({ laneId, runId: runnerOwned ? env.FMARCH_PROOF_RUN_ID : null,
      databaseLifecycle: runnerOwned ? "runner-owned-disposable-per-proof-run" : "harness-owned-disposable-per-proof-run" }),
  });
}

function localMigrationUrl(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("DATABASE_MIGRATION_URL is required for live role proof");
  const url = new URL(value);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("live role proof requires a loopback Postgres URL");
  if (!decodeURIComponent(url.pathname).replace(/^\/+/, "")) throw new Error("DATABASE_MIGRATION_URL must name a database");
  return url.toString();
}

/** Runner databases are never created, terminated, or dropped by a leaf harness. */
export async function openRoleProofDatabase(context, { run = runProofCommand, id = randomUUID } = {}) {
  if (context.runnerOwned) return { migrationUrl: context.migrationUrl, close: async () => {} };
  const admin = new URL(context.migrationUrl);
  admin.pathname = "/postgres";
  const scratch = new URL(context.migrationUrl);
  const name = `fmarch_role_${id().replaceAll("-", "")}`;
  if (!/^fmarch_role_[a-zA-Z0-9_]{1,48}$/u.test(name)) throw new Error("invalid standalone proof database name");
  scratch.pathname = `/${name}`;
  const psql = (sql) => run("psql", [admin.toString(), "-X", "-v", "ON_ERROR_STOP=1", "-c", sql], { timeoutMs: 5_000 });
  await psql(`CREATE DATABASE "${name}"`);
  return { migrationUrl: scratch.toString(), close: async () => {
    await psql(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}'`);
    await psql(`DROP DATABASE IF EXISTS "${name}"`);
  } };
}

/** Observe errors immediately and drain bounded diagnostics until stdio closes. */
export function observeProofProcess(child, { ownsGroup = false } = {}) {
  let result = null;
  let output = "";
  let stdout = "";
  let finish;
  const closed = new Promise(resolve => { finish = resolve; });
  const record = value => { if (result === null) { result = value; finish(value); } };
  child.once("error", error => record({ error, code: null, signal: null }));
  child.once("close", (code, signal) => record({ code, signal, error: null }));
  for (const stream of [child.stdout, child.stderr]) stream?.on("data", chunk => { output = (output + chunk.toString()).slice(-outputLimit); });
  child.stdout?.on("data", chunk => { stdout = (stdout + chunk.toString()).slice(-outputLimit); });
  return { child, ownsGroup, closed, result: () => result, output: () => output, stdout: () => stdout };
}

function describeProcess(observed) {
  const result = observed.result();
  return `${result?.error?.message ?? `code=${result?.code} signal=${result?.signal ?? "none"}`}: ${observed.output().slice(-4000)}`;
}

async function settlesWithin(promise, timeoutMs) {
  let timer;
  try { return await Promise.race([promise.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); })]); }
  finally { clearTimeout(timer); }
}

export function proofGroupHasLiveMembers(groupId, table) {
  let live = false;
  for (const line of table.split("\n").filter(line => line.trim())) {
    const fields = line.trim().split(/\s+/u);
    if (fields.length !== 2 || !/^[0-9]+$/u.test(fields[0]) || !/^[A-Za-z][A-Za-z+<>=-]*$/u.test(fields[1])) throw new Error("invalid proof process group inventory");
    if (Number(fields[0]) === groupId && !fields[1].startsWith("Z")) live = true;
  }
  return live;
}

function groupHasLiveMembers(observed) {
  const table = execFileSync("ps", ["-axo", "pgid=,stat="], { encoding: "utf8", timeout: 1_000, maxBuffer: 4 * 1024 * 1024 });
  return proofGroupHasLiveMembers(observed.child.pid, table);
}

function groupIsAlive(observed) {
  if (!observed.ownsGroup || !Number.isSafeInteger(observed.child.pid)) return false;
  try {
    process.kill(-observed.child.pid, 0);
    return observed.groupForceKilled ? groupHasLiveMembers(observed) : true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    // macOS can deny killpg(0) for a group containing only reparented zombies.
    // Only an independent bounded inventory can turn that denial into stopped.
    if (error.code === "EPERM" && !groupHasLiveMembers(observed)) return false;
    throw error;
  }
}

function signalProofProcess(observed, signal) {
  if (!observed.ownsGroup) return observed.child.kill(signal);
  try {
    process.kill(-observed.child.pid, signal);
    if (signal === "SIGKILL") observed.groupForceKilled = true;
  } catch (error) {
    if (error.code === "ESRCH") return;
    if (error.code === "EPERM" && !groupHasLiveMembers(observed)) return;
    throw error;
  }
}

async function waitForProcessStop(observed, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  do {
    if (observed.result() && !groupIsAlive(observed)) return true;
    await delay(Math.min(20, Math.max(1, deadline - Date.now())));
  } while (Date.now() < deadline);
  return observed.result() !== null && !groupIsAlive(observed);
}

/** Groups retain custody when their wrapper exits before a Cargo descendant. */
export async function stopProofProcess(observed, { graceMs = 6_000, killMs = 5_000 } = {}) {
  if (!observed || observed.result() && !groupIsAlive(observed)) return;
  signalProofProcess(observed, "SIGTERM");
  if (await waitForProcessStop(observed, graceMs)) return;
  signalProofProcess(observed, "SIGKILL");
  if (!await waitForProcessStop(observed, killMs)) throw new Error("proof process did not close after SIGKILL");
}

// A runner owns its lane group. Held-lock commands get a smaller owned group
// so a local build deadline can drain descendants without signalling the lane.
// If the outer runner cancels this harness, kill every such group before
// re-raising its signal. One handler pair avoids recursion for concurrent calls.
const activeCommandGroups = new Set();
const onTerm = () => interruptCommandGroups("SIGTERM");
const onInt = () => interruptCommandGroups("SIGINT");
function removeInterruptHandlers() {
  process.off("SIGTERM", onTerm);
  process.off("SIGINT", onInt);
}
function interruptCommandGroups(signal) {
  const owned = [...activeCommandGroups];
  activeCommandGroups.clear();
  removeInterruptHandlers();
  for (const observed of owned) signalProofProcess(observed, "SIGKILL");
  process.kill(process.pid, signal);
}
function registerCommandGroup(observed) {
  if (!observed.ownsGroup || !Number.isSafeInteger(observed.child.pid)) return () => {};
  if (activeCommandGroups.size === 0) {
    process.on("SIGTERM", onTerm);
    process.on("SIGINT", onInt);
  }
  activeCommandGroups.add(observed);
  return () => {
    activeCommandGroups.delete(observed);
    if (activeCommandGroups.size === 0) removeInterruptHandlers();
  };
}

export async function runProofCommand(command, args, { timeoutMs = 240_000, spawnProcess = spawn, ...options } = {}) {
  const env = options.env ?? process.env;
  const ownsGroup = process.platform !== "win32" && (env.HOST_HEAVY_BUILD_LOCK_HELD === "1" || env.MESH_HEAVY_BUILD_LOCK_HELD === "1");
  const observed = observeProofProcess(spawnProcess(command, args, { ...options, detached: ownsGroup, stdio: ["ignore", "pipe", "pipe"] }), { ownsGroup });
  const unregister = registerCommandGroup(observed);
  try {
    if (!await settlesWithin(observed.closed, timeoutMs)) throw new Error(`${command} exceeded its ${timeoutMs}ms deadline`);
    if (observed.result().error || observed.result().code !== 0) throw new Error(`${command} failed: ${describeProcess(observed)}`);
    if (groupIsAlive(observed)) throw new Error(`${command} left live descendants after exit`);
    return observed.stdout();
  } finally {
    try { await stopProofProcess(observed); }
    finally { unregister(); }
  }
}

export function serverExecutableFromBuild(output, repoRoot) {
  const manifestPath = path.join(repoRoot, "crates", "server", "Cargo.toml");
  const packageSource = `path+${pathToFileURL(path.dirname(manifestPath)).href}`;
  const artifacts = output.split("\n").flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  const executables = artifacts.filter(item => item.reason === "compiler-artifact" && item.target?.name === "server" && item.target?.kind?.includes("bin") && item.manifest_path === manifestPath && item.package_id?.split("#")[0] === packageSource && typeof item.executable === "string" && path.isAbsolute(item.executable));
  if (executables.length !== 1) throw new Error("Cargo did not identify exactly one server binary artifact");
  return executables[0].executable;
}

export async function waitForRoleProofHealth(observed, baseUrl, { deadline = Date.now() + 240_000, fetchHealth = fetch, pollMs = 100 } = {}) {
  while (Date.now() < deadline) {
    if (observed.result()) throw new Error(`role proof API exited before readiness: ${describeProcess(observed)}`);
    const remaining = deadline - Date.now();
    const response = await Promise.race([
      fetchHealth(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(Math.max(1, Math.min(2_000, remaining))) }).catch(() => null),
      observed.closed.then(() => null),
    ]);
    if (observed.result()) throw new Error(`role proof API exited before readiness: ${describeProcess(observed)}`);
    await response?.body?.cancel();
    if (response?.ok) return;
    await delay(Math.min(pollMs, Math.max(1, deadline - Date.now())));
  }
  throw new Error(`role proof API readiness deadline exceeded: ${observed.output().slice(-4000)}`);
}

export async function startRoleProofApi({ repoRoot, context, applicationUrl, localProofAuth, host = "127.0.0.1", env = process.env }) {
  const deadline = Date.now() + 240_000;
  const applicationEnv = serverRuntimeEnvironment({ applicationUrl, env });
  const invocation = lockedProofCargoInvocation({ cwd: repoRoot, laneId: context.laneId, target: "server/bin/server", profile: "dev", command: "build", env });
  const output = await runProofCommand(invocation.command, [...invocation.args, "--message-format=json"], { cwd: repoRoot, env: applicationEnv, timeoutMs: Math.max(1, deadline - Date.now()) });
  const executable = serverExecutableFromBuild(output, repoRoot);
  const port = await freePort(host);
  const baseUrl = `http://${host}:${port}`;
  const mediaRoot = path.join(context.artifactDir, "media-store");
  await mkdir(mediaRoot, { recursive: true, mode: 0o700 });
  const observed = observeProofProcess(spawn(executable, [], { cwd: repoRoot, env: localProofAuth.serverEnvironment({
    ...applicationEnv, FMARCH_BIND: `${host}:${port}`, FMARCH_MEDIA_ROOT: mediaRoot, RUST_LOG: "warn",
  }), stdio: ["ignore", "pipe", "pipe"] }));
  try { await waitForRoleProofHealth(observed, baseUrl, { deadline }); }
  catch (error) { await stopProofProcess(observed); throw error; }
  return { baseUrl, output: observed.output, close: () => stopProofProcess(observed) };
}

async function freePort(host) {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once("error", reject);
    listener.listen(0, host, () => { const address = listener.address(); listener.close(error => error ? reject(error) : resolve(address.port)); });
  });
}

/** Finish every cleanup, even when one resource rejects or never settles. */
export async function closeRoleProofResources(resources, { timeoutMs = 12_000 } = {}) {
  const errors = [];
  for (const resource of resources) {
    if (!resource) continue;
    let timer;
    try { await Promise.race([Promise.resolve().then(() => resource.close()), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("role proof resource cleanup timed out")), timeoutMs); })]); }
    catch (error) { errors.push(error); }
    finally { clearTimeout(timer); }
  }
  if (errors.length) throw new AggregateError(errors, "role proof resource cleanup failed");
}
