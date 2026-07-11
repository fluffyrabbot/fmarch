import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { handleLocalhostBindFailure, preflightLocalhostBindOrExit } from "./frontend_smoke_bind_preflight.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontendRoot = path.join(repoRoot, "frontend");
const frontendRequire = createRequire(path.join(frontendRoot, "package.json"));
const artifactDir = path.join(repoRoot, "target", "profile-role-proof");
const evidencePath = path.join(artifactDir, "profile-proof.json");
const databaseUrl = process.env.DATABASE_URL;
const host = "127.0.0.1";
if (!databaseUrl) throw new Error("DATABASE_URL is required for the local profile role proof");
await preflightLocalhostBindOrExit({ host, repoRoot, artifactDir, evidencePath, smokeName: "profile-role-proof" });

let database; let server; let vite; let browser; let serverOutput = "";
const previousApiBaseUrl = process.env.FMARCH_API_BASE_URL;
try {
  await mkdir(artifactDir, { recursive: true });
  database = await scratchDatabase(databaseUrl);
  const api = await startApi(database.url);
  const frontend = await startFrontend(api);
  browser = await chromium.launch();
  const sessions = await createAccountSessions(api);
  const owner = await browser.newContext(); const other = await browser.newContext(); const anonymous = await browser.newContext();
  await cookie(owner, frontend, sessions.owner); await cookie(other, frontend, sessions.other);
  try {
    const created = await createProfile(owner, frontend);
    const publicView = await provePublic(anonymous, frontend);
    const edited = await editProfile(owner, frontend);
    const denied = await proveDenied(other, frontend);
    const privacy = await makeMembersOnly(owner, anonymous, frontend);
    const evidence = {
      version: 1, proof: "profile-role-proof", status: "passed", scope: "local-profile-role-proof",
      releaseReady: false, productionReady: false,
      proofBoundary: "Local scratch-Postgres, local Rust API, two real local account sessions, SvelteKit profile role URLs, and Chromium proof. It proves owner profile creation and edit/reload, anonymous public view, members-only withdrawal, and denied cross-account editing. It does not prove hosted privacy, moderation, retention, legal policy, direct messages, follower graphs, search, ranking, recommendations, or release readiness.",
      roleUrl: `${frontend}/u/owner_profile/edit`, created, publicView, edited, denied, privacy,
    };
    if (evidence.created.status !== "passed" || evidence.publicView.status !== "passed" || evidence.edited.reloadBio !== "Updated public bio." || evidence.denied.statusCode !== 403 || evidence.privacy.unavailable !== true) throw new Error("profile proof contract drifted");
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(`wrote ${path.relative(repoRoot, evidencePath)}`);
  } finally { await owner.close(); await other.close(); await anonymous.close(); }
} catch (error) {
  const handled = await handleLocalhostBindFailure({ error, repoRoot, artifactDir, evidencePath, smokeName: "profile-role-proof", stage: "profile-proof-listen" });
  if (!handled) { error.serverOutput = serverOutput.slice(-4000); throw error; }
} finally {
  if (browser) await browser.close(); if (vite) await vite.close(); if (server) await stop(server); if (database) await dropDatabase(database);
  if (previousApiBaseUrl === undefined) delete process.env.FMARCH_API_BASE_URL; else process.env.FMARCH_API_BASE_URL = previousApiBaseUrl;
}

async function createAccountSessions(api) {
  const admin = "profile-proof-admin";
  await json(`${api}/auth/dev-session`, { method: "POST", headers: jsonHeaders(), body: JSON.stringify({ token: admin, principal_user_id: "profile_admin", expires_at: 4102444800, global_capabilities: ["GlobalAdmin"] }) });
  const accounts = [
    ["profile-owner@example.test", "profile_owner", "profile-owner-session"],
    ["profile-other@example.test", "profile_other", "profile-other-session"],
  ];
  for (const [account_id, principal_user_id, session_token] of accounts) {
    await json(`${api}/auth/accounts`, { method: "POST", headers: { ...jsonHeaders(), authorization: `Bearer ${admin}` }, body: JSON.stringify({ account_id, principal_user_id, password: "correct horse battery" }) });
    await json(`${api}/auth/accounts/login`, { method: "POST", headers: jsonHeaders(), body: JSON.stringify({ account_id, password: "correct horse battery", session_token, expires_at: 4102444800 }) });
  }
  return { owner: accounts[0][2], other: accounts[1][2] };
}
async function cookie(context, url, value) { await context.addCookies([{ name: "fmarch_session", value, url, httpOnly: true }]); }
async function createProfile(context, frontend) {
  const page = await context.newPage({ viewport: { width: 1024, height: 768 } });
  try {
    await page.goto(`${frontend}/profile/edit`, { waitUntil: "networkidle" });
    await page.getByTestId("profile-handle").fill("owner_profile"); await page.getByTestId("profile-display-name").fill("Owner Profile"); await page.getByTestId("profile-bio").fill("Opening public bio.");
    await Promise.all([page.waitForURL(/\/u\/owner_profile\/edit/, { timeout: 15000 }), page.getByTestId("profile-create-submit").click()]);
    await page.getByTestId("profile-editor-surface").waitFor({ state: "visible" });
    return { status: "passed", editorTestId: "profile-editor-surface" };
  } finally { await page.close(); }
}
async function provePublic(context, frontend) {
  const page = await context.newPage({ viewport: { width: 1024, height: 768 } });
  try {
    await page.goto(`${frontend}/u/owner_profile`, { waitUntil: "networkidle" });
    await page.getByTestId("profile-public-card").waitFor({ state: "visible" });
    return { status: "passed", displayName: await page.getByTestId("profile-public-display-name").innerText() };
  } finally { await page.close(); }
}
async function editProfile(context, frontend) {
  const page = await context.newPage({ viewport: { width: 1024, height: 768 } });
  try {
    await page.goto(`${frontend}/u/owner_profile/edit`, { waitUntil: "networkidle" });
    await page.getByTestId("profile-bio").fill("Updated public bio.");
    await Promise.all([page.waitForLoadState("networkidle"), page.getByTestId("profile-update-submit").click()]);
    await page.reload({ waitUntil: "networkidle" });
    return { status: "passed", reloadBio: await page.getByTestId("profile-bio").inputValue() };
  } finally { await page.close(); }
}
async function proveDenied(context, frontend) {
  const page = await context.newPage();
  try { const response = await page.goto(`${frontend}/u/owner_profile/edit`, { waitUntil: "networkidle" }); return { status: "passed", statusCode: response?.status() ?? 0 }; } finally { await page.close(); }
}
async function makeMembersOnly(owner, anonymous, frontend) {
  const editor = await owner.newPage(); const publicPage = await anonymous.newPage();
  try {
    await editor.goto(`${frontend}/u/owner_profile/edit`, { waitUntil: "networkidle" }); await editor.getByTestId("profile-visibility").selectOption("members");
    await Promise.all([editor.waitForLoadState("networkidle"), editor.getByTestId("profile-update-submit").click()]);
    await publicPage.goto(`${frontend}/u/owner_profile`, { waitUntil: "networkidle" }); await publicPage.getByTestId("profile-public-unavailable").waitFor({ state: "visible" });
    return { status: "passed", unavailable: true, testId: "profile-public-unavailable" };
  } finally { await editor.close(); await publicPage.close(); }
}
function jsonHeaders() { return { "content-type": "application/json", accept: "application/json" }; }
async function json(url, options) { const response = await fetch(url, options); const body = await response.json().catch(() => null); if (!response.ok) throw new Error(`${url} ${response.status}: ${JSON.stringify(body)}`); return body; }
async function scratchDatabase(sourceUrl) { const admin = new URL(sourceUrl); admin.pathname = "/postgres"; const scratch = new URL(sourceUrl); const name = `fmarch_profile_${process.pid}_${Date.now()}`; scratch.pathname = `/${name}`; await command("psql", [admin.toString(), "-v", "ON_ERROR_STOP=1", "-c", `CREATE DATABASE "${name}"`]); return { name, adminUrl: admin.toString(), url: scratch.toString() }; }
async function dropDatabase({ adminUrl, name }) { await command("psql", [adminUrl, "-v", "ON_ERROR_STOP=1", "-c", `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}'`]); await command("psql", [adminUrl, "-v", "ON_ERROR_STOP=1", "-c", `DROP DATABASE IF EXISTS "${name}"`]); }
async function startApi(url) { const port = await portNumber(); const base = `http://${host}:${port}`; const mediaRoot = path.join(artifactDir, "media-store"); await mkdir(mediaRoot, { recursive: true, mode: 0o700 }); server = spawn("cargo", ["run", "-p", "server"], { cwd: repoRoot, env: { ...process.env, DATABASE_URL: url, FMARCH_BIND: `${host}:${port}`, FMARCH_MEDIA_ROOT: mediaRoot, FMARCH_DEV_AUTH: "1", RUST_LOG: "warn" }, stdio: ["ignore", "pipe", "pipe"] }); server.stdout.on("data", c => { serverOutput += c; }); server.stderr.on("data", c => { serverOutput += c; }); const until = Date.now() + 30000; while (Date.now() < until) { try { if ((await fetch(`${base}/healthz`)).ok) return base; } catch {} await delay(100); } throw new Error("profile API did not become healthy"); }
async function startFrontend(api) { process.env.FMARCH_API_BASE_URL = api; const cwd = process.cwd(); process.chdir(frontendRoot); try { const { createServer } = await import(frontendRequire.resolve("vite")); vite = await createServer({ root: frontendRoot, server: { host, port: 0 }, logLevel: "error" }); } finally { process.chdir(cwd); } await vite.listen(); const address = vite.httpServer?.address(); if (!address || typeof address !== "object") throw new Error("profile frontend did not bind"); return `http://${host}:${address.port}`; }
async function portNumber() { return new Promise((resolve, reject) => { const listener = net.createServer(); listener.once("error", reject); listener.listen(0, host, () => { const address = listener.address(); listener.close(error => error ? reject(error) : resolve(address.port)); }); }); }
async function stop(child) { if (child.exitCode !== null) return; child.kill("SIGTERM"); await new Promise(resolve => child.once("exit", resolve)); }
async function command(program, args) { await new Promise((resolve, reject) => { const child = spawn(program, args, { stdio: "ignore" }); child.once("error", reject); child.once("exit", code => code === 0 ? resolve() : reject(new Error(`${program} exited ${code}`))); }); }
