import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { handleLocalhostBindFailure, preflightLocalhostBindOrExit } from "./frontend_smoke_bind_preflight.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontendRoot = path.join(root, "frontend");
const frontendRequire = createRequire(path.join(frontendRoot, "package.json"));
const artifactDir = path.join(root, "target", "completed-game-export-role-proof");
const evidencePath = path.join(artifactDir, "completed-game-export-proof.json");
const databaseUrl = process.env.DATABASE_URL;
const host = "127.0.0.1";
if (!databaseUrl) throw new Error("DATABASE_URL is required for completed-game export proof");
await preflightLocalhostBindOrExit({ host, repoRoot: root, artifactDir, evidencePath, smokeName: "completed-game-export-role-proof" });
let database; let server; let vite; let browser; let output = ""; const priorApi = process.env.FMARCH_API_BASE_URL;
try {
  await mkdir(artifactDir, { recursive: true });
  database = await scratch(databaseUrl);
  const api = await startApi(database.url);
  const frontend = await startFrontend(api);
  const game = randomUUID(); const hostUser = "export_role_host"; const token = "export-role-host-session";
  await request(`${api}/auth/dev-session`, { method: "POST", headers: headers(), body: JSON.stringify({ token, principal_user_id: hostUser, expires_at: 4102444800, global_capabilities: [] }) });
  await command(api, 1, hostUser, { CreateGame: { game, pack: "mafiascum" } });
  await command(api, 2, hostUser, { CompleteGame: { game } });
  const manifest = await request(`${api}/games/${game}/export?principal_user_id=${hostUser}`);
  browser = await chromium.launch(); const context = await browser.newContext();
  await context.addCookies([{ name: "fmarch_session", value: token, url: frontend, httpOnly: true }]);
  const page = await context.newPage({ viewport: { width: 1024, height: 768 } });
  const response = await page.goto(`${frontend}/g/${game}/host/export`, { waitUntil: "networkidle" });
  await page.getByTestId("completed-game-export-manifest").waitFor({ state: "visible" });
  const checksum = await page.getByTestId("completed-game-export-checksum").innerText();
  const eventCount = Number((await page.getByTestId("completed-game-export-event-count").innerText()).split(" ")[0]);
  await page.close(); await context.close();
  const evidence = { version: 1, proof: "completed-game-export-role-proof", status: "passed", scope: "local-completed-game-export-role-proof", releaseReady: false, productionReady: false, proofBoundary: "Local scratch-Postgres, local Rust API, host session, SvelteKit host export route, and Chromium proof. It proves a completed game's role URL exposes the checksum-bearing manifest. Isolated import/rebuild audit and checksum-tamper rejection are covered by Postgres integration tests. It does not prove hosted archival storage, legal retention, public discovery, compatibility guarantees, or release readiness.", roleUrl: `${frontend}/g/${game}/host/export`, manifest: { version: manifest.version, eventCount, checksum, apiEventCount: manifest.events.length, completedEventPresent: manifest.events.some(event => event.kind === "GameCompleted"), roleResponseStatus: response?.status() ?? 0 } };
  if (checksum !== manifest.checksum_sha256 || checksum.length !== 64 || eventCount !== manifest.events.length || !evidence.manifest.completedEventPresent || evidence.manifest.roleResponseStatus !== 200) throw new Error("completed-game export browser evidence drifted");
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`); console.log(`wrote ${path.relative(root, evidencePath)}`);
} catch (error) { const handled = await handleLocalhostBindFailure({ error, repoRoot: root, artifactDir, evidencePath, smokeName: "completed-game-export-role-proof", stage: "export-role-proof-listen" }); if (!handled) { error.serverOutput = output.slice(-4000); throw error; } }
finally { if (browser) await browser.close(); if (vite) await vite.close(); if (server) await stop(server); if (database) await drop(database); if (priorApi === undefined) delete process.env.FMARCH_API_BASE_URL; else process.env.FMARCH_API_BASE_URL = priorApi; }

async function command(api, id, principal, commandValue) { const result = await request(`${api}/commands`, { method: "POST", headers: headers(), body: JSON.stringify({ v: 1, id, body: { kind: "Command", body: { command_id: randomUUID(), principal_user_id: principal, command: commandValue } } }) }); if (result.body?.kind !== "Ack") throw new Error(`seed command rejected ${JSON.stringify(result)}`); }
function headers() { return { "content-type": "application/json", accept: "application/json" }; }
async function request(url, options) { const response = await fetch(url, options); const body = await response.json().catch(() => null); if (!response.ok) throw new Error(`${url} ${response.status}: ${JSON.stringify(body)}`); return body; }
async function scratch(url) { const admin = new URL(url); admin.pathname = "/postgres"; const target = new URL(url); const name = `fmarch_export_proof_${process.pid}_${Date.now()}`; target.pathname = `/${name}`; await run("psql", [admin.toString(), "-v", "ON_ERROR_STOP=1", "-c", `CREATE DATABASE "${name}"`]); return { name, adminUrl: admin.toString(), url: target.toString() }; }
async function drop({ adminUrl, name }) { await run("psql", [adminUrl, "-v", "ON_ERROR_STOP=1", "-c", `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}'`]); await run("psql", [adminUrl, "-v", "ON_ERROR_STOP=1", "-c", `DROP DATABASE IF EXISTS "${name}"`]); }
async function startApi(url) { const port = await freePort(); const api = `http://${host}:${port}`; const mediaRoot = path.join(artifactDir, "media"); await mkdir(mediaRoot, { recursive: true }); server = spawn("cargo", ["run", "-p", "server"], { cwd: root, env: { ...process.env, DATABASE_URL: url, FMARCH_BIND: `${host}:${port}`, FMARCH_MEDIA_ROOT: mediaRoot, FMARCH_DEV_AUTH: "1", RUST_LOG: "warn" }, stdio: ["ignore", "pipe", "pipe"] }); server.stdout.on("data", chunk => output += chunk); server.stderr.on("data", chunk => output += chunk); for (let until = Date.now() + 30000; Date.now() < until; await delay(100)) { try { if ((await fetch(`${api}/healthz`)).ok) return api; } catch {} } throw new Error("export proof API did not become healthy"); }
async function startFrontend(api) { process.env.FMARCH_API_BASE_URL = api; const cwd = process.cwd(); process.chdir(frontendRoot); try { const { createServer } = await import(frontendRequire.resolve("vite")); vite = await createServer({ root: frontendRoot, server: { host, port: 0 }, logLevel: "error" }); } finally { process.chdir(cwd); } await vite.listen(); const address = vite.httpServer?.address(); if (!address || typeof address !== "object") throw new Error("export proof frontend did not bind"); return `http://${host}:${address.port}`; }
async function freePort() { return new Promise((resolve, reject) => { const listener = net.createServer(); listener.once("error", reject); listener.listen(0, host, () => { const address = listener.address(); listener.close(error => error ? reject(error) : resolve(address.port)); }); }); }
async function stop(child) { if (child.exitCode !== null) return; child.kill("SIGTERM"); await new Promise(resolve => child.once("exit", resolve)); }
async function run(program, args) { await new Promise((resolve, reject) => { const child = spawn(program, args, { stdio: "ignore" }); child.once("error", reject); child.once("exit", code => code === 0 ? resolve() : reject(new Error(`${program} exited ${code}`))); }); }
