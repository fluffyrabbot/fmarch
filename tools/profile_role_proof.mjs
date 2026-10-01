import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { handleLocalhostBindFailure, preflightLocalhostBindOrExit } from "./frontend_smoke_bind_preflight.mjs";
import { runFmarchMigrations } from "./run_fmarch_migrations.mjs";
import { createLocalProofAuth } from "./local_proof_auth.mjs";
import { fixturePrincipalAuthorityId } from "./principal_fixture.mjs";

import { roleProofContext, openRoleProofDatabase, startRoleProofApi, closeRoleProofResources } from "./live_role_proof_runtime.mjs";
import { assertProfileProofEvidence } from "./profile_export_proof_evidence.mjs";

const proofLane = "test:dev-test-game-profile";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontendRoot = path.join(repoRoot, "frontend");
const frontendRequire = createRequire(path.join(frontendRoot, "package.json"));
const proofContext = roleProofContext({ repoRoot, laneId: proofLane, artifactName: "profile-role-proof" });
const artifactDir = proofContext.artifactDir;
const evidencePath = path.join(artifactDir, "profile-proof.json");
const host = "127.0.0.1";
const localProofAuth = createLocalProofAuth();
await preflightLocalhostBindOrExit({ host, repoRoot, artifactDir, evidencePath, smokeName: "profile-role-proof" });

let database; let server; let vite; let browser;
const previousApiBaseUrl = process.env.FMARCH_API_BASE_URL;
try {
  await mkdir(artifactDir, { recursive: true });
  database = await openRoleProofDatabase(proofContext);
  const authority = await runFmarchMigrations({ proofLane, profile: "dev", cwd: repoRoot, migrationUrl: database.migrationUrl });
  server = await startRoleProofApi({ repoRoot, context: proofContext, applicationUrl: authority.applicationUrl, localProofAuth });
  const api = server.baseUrl;
  const frontend = await startFrontend(api);
  browser = await chromium.launch();
  const sessions = await createAccountSessions(api);
  const owner = await browser.newContext(); const other = await browser.newContext(); const anonymous = await browser.newContext();
  await cookie(owner, frontend, sessions.owner); await cookie(other, frontend, sessions.other);
  try {
    const created = await createProfile(owner, frontend);
    const publicView = await provePublic(anonymous, frontend);
    const edited = await editProfile(owner, frontend);
    const ownerScope = await proveOwnerScope(other, frontend);
    const privacy = await makePrivate(owner, anonymous, frontend, api);
    const evidence = {
      version: 1, proof: "profile-role-proof", status: "passed", scope: "local-profile-role-proof",
      releaseReady: false, productionReady: false, execution: proofContext.execution,
      proofBoundary: "Local scratch-Postgres, local Rust API, two real local account sessions, SvelteKit profile role URLs, and Chromium proof. It proves owner profile creation and revision-aware edit/reload through the sole owner route, anonymous public view, private-profile withdrawal, and that a second account resolves its own profile state rather than an owner-addressed editor. It does not prove hosted privacy, moderation, retention, legal policy, direct messages, follower graphs, search, ranking, recommendations, or release readiness.",
      roleUrl: `${frontend}/profile/edit`, created, publicView, edited, ownerScope, privacy,
    };
    assertProfileProofEvidence(evidence);
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(`wrote ${path.relative(repoRoot, evidencePath)}`);
  } finally { await closeRoleProofResources([owner, other, anonymous]); }
} catch (error) {
  const handled = await handleLocalhostBindFailure({ error, repoRoot, artifactDir, evidencePath, smokeName: "profile-role-proof", stage: "profile-proof-listen" });
  if (!handled) { error.serverOutput = server?.output().slice(-4000) ?? ""; throw error; }
} finally {
  try { await closeRoleProofResources([browser, vite, server, database]); }
  finally { if (previousApiBaseUrl === undefined) delete process.env.FMARCH_API_BASE_URL; else process.env.FMARCH_API_BASE_URL = previousApiBaseUrl; }
}

async function createAccountSessions(api) {
  const admin = requiredSessionToken(await json(`${api}/auth/local-proof/sessions`, { method: "POST", headers: localProofAuth.requestHeaders(jsonHeaders()), body: JSON.stringify({ principal_id: fixturePrincipalAuthorityId("profile_admin"), expires_at: 4102444800, global_capabilities: ["GlobalAdmin"] }) }));
  const accounts = [
    ["profile-owner@example.test", "profile_owner"],
    ["profile-other@example.test", "profile_other"],
  ];
  const issuedSessions = [];
  for (const [account_id, principal_id] of accounts) {
    await json(`${api}/auth/accounts`, { method: "POST", headers: { ...jsonHeaders(), authorization: `Bearer ${admin}` }, body: JSON.stringify({ account_id, principal_id: fixturePrincipalAuthorityId(principal_id), password: "correct horse battery" }) });
    issuedSessions.push(requiredSessionToken(await json(`${api}/auth/accounts/login`, { method: "POST", headers: jsonHeaders(), body: JSON.stringify({ account_id, password: "correct horse battery" }) })));
  }
  return { owner: issuedSessions[0], other: issuedSessions[1] };
}
function requiredSessionToken(session) { if (typeof session?.session_token !== "string" || session.session_token === "") throw new Error("auth response omitted its backend-issued session token"); return session.session_token; }
async function cookie(context, url, value) { await context.addCookies([{ name: "fmarch_session", value, url, httpOnly: true }]); }
async function createProfile(context, frontend) {
  const page = await context.newPage({ viewport: { width: 1024, height: 768 } });
  try {
    await page.goto(`${frontend}/profile/edit`, { waitUntil: "networkidle" });
    await page.getByTestId("profile-handle").fill("owner_profile"); await page.getByTestId("profile-display-name").fill("Owner Profile"); await page.getByTestId("profile-bio").fill("Opening public bio.");
    await page.getByTestId("profile-create-submit").click();
    await page.getByTestId("profile-editor-surface").waitFor({ state: "visible" });
    return { status: "passed", editorTestId: "profile-editor-surface" };
  } finally { await closeRoleProofResources([page]); }
}
async function provePublic(context, frontend) {
  const page = await context.newPage({ viewport: { width: 1024, height: 768 } });
  try {
    await page.goto(`${frontend}/u/owner_profile`, { waitUntil: "networkidle" });
    await page.getByTestId("profile-public-card").waitFor({ state: "visible" });
    return { status: "passed", displayName: await page.getByTestId("profile-public-display-name").innerText() };
  } finally { await closeRoleProofResources([page]); }
}
async function editProfile(context, frontend) {
  const page = await context.newPage({ viewport: { width: 1024, height: 768 } });
  try {
    await page.goto(`${frontend}/profile/edit`, { waitUntil: "networkidle" });
    const expectedRevision = await page.getByTestId("profile-expected-revision").inputValue();
    await page.getByTestId("profile-bio").fill("Updated public bio.");
    await Promise.all([page.waitForNavigation({ waitUntil: "networkidle" }), page.getByTestId("profile-update-submit").click()]);
    await page.reload({ waitUntil: "networkidle" });
    return { status: "passed", expectedRevision, reloadBio: await page.getByTestId("profile-bio").inputValue() };
  } finally { await closeRoleProofResources([page]); }
}
async function proveOwnerScope(context, frontend) {
  const page = await context.newPage();
  try {
    await page.goto(`${frontend}/profile/edit`, { waitUntil: "networkidle" });
    await page.getByTestId("profile-create-surface").waitFor({ state: "visible" });
    return { status: "passed", createSurface: true };
  } finally { await closeRoleProofResources([page]); }
}
async function makePrivate(owner, anonymous, frontend, api) {
  const editor = await owner.newPage(); const publicPage = await anonymous.newPage();
  try {
    await editor.goto(`${frontend}/profile/edit`, { waitUntil: "networkidle" }); await editor.getByTestId("profile-visibility").selectOption("private");
    await Promise.all([editor.waitForNavigation({ waitUntil: "networkidle" }), editor.getByTestId("profile-update-submit").click()]);
    await editor.reload({ waitUntil: "networkidle" });
    const ownerVisibility = await editor.getByTestId("profile-visibility").inputValue();
    const apiResponse = await fetch(`${api}/profiles/owner_profile`, { signal: AbortSignal.timeout(15_000) });
    const apiStatus = apiResponse.status;
    await apiResponse.body?.cancel();
    await publicPage.goto(`${frontend}/u/owner_profile`, { waitUntil: "networkidle" }); await publicPage.getByTestId("profile-public-unavailable").waitFor({ state: "visible" });
    return { status: "passed", unavailable: true, testId: "profile-public-unavailable", ownerVisibility, apiStatus };
  } finally { await closeRoleProofResources([editor, publicPage]); }
}
function jsonHeaders() { return { "content-type": "application/json", accept: "application/json" }; }
async function json(url, options) { const response = await fetch(url, { ...options, signal: AbortSignal.timeout(15_000) }); const body = await response.json().catch(() => null); if (!response.ok) throw new Error(`${url} ${response.status}: ${JSON.stringify(body)}`); return body; }
async function startFrontend(api) { process.env.FMARCH_API_BASE_URL = api; const cwd = process.cwd(); process.chdir(frontendRoot); try { const { createServer } = await import(frontendRequire.resolve("vite")); vite = await createServer({ root: frontendRoot, server: { host, port: 0 }, logLevel: "error" }); } finally { process.chdir(cwd); } await vite.listen(); const address = vite.httpServer?.address(); if (!address || typeof address !== "object") throw new Error("profile frontend did not bind"); return `http://${host}:${address.port}`; }
