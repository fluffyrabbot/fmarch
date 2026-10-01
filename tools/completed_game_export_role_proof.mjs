import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { handleLocalhostBindFailure, preflightLocalhostBindOrExit } from "./frontend_smoke_bind_preflight.mjs";
import { runFmarchMigrations } from "./run_fmarch_migrations.mjs";
import { createLocalProofAuth } from "./local_proof_auth.mjs";
import {
  fixturePrincipalAuthorityId,
  fixturePrincipalTransport,
} from "./principal_fixture.mjs";

import { roleProofContext, openRoleProofDatabase, startRoleProofApi, closeRoleProofResources } from "./live_role_proof_runtime.mjs";
import { createCompletedExportFetchObserver } from "./completed_game_export_fetch.mjs";
import { assertCompletedExportProofEvidence } from "./profile_export_proof_evidence.mjs";

const proofLane = "test:dev-test-game-completed-export";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontendRoot = path.join(root, "frontend");
const frontendRequire = createRequire(path.join(frontendRoot, "package.json"));
const proofContext = roleProofContext({ repoRoot: root, laneId: proofLane, artifactName: "completed-game-export-role-proof" });
const artifactDir = proofContext.artifactDir;
const evidencePath = path.join(artifactDir, "completed-game-export-proof.json");
const host = "127.0.0.1";
const localProofAuth = createLocalProofAuth();
await preflightLocalhostBindOrExit({ host, repoRoot: root, artifactDir, evidencePath, smokeName: "completed-game-export-role-proof" });
let database; let server; let vite; let browser; let restoreFetch; const priorApi = process.env.FMARCH_API_BASE_URL;
try {
  await mkdir(artifactDir, { recursive: true });
  database = await openRoleProofDatabase(proofContext);
  const authority = await runFmarchMigrations({ proofLane, profile: "dev", cwd: root, migrationUrl: database.migrationUrl });
  server = await startRoleProofApi({ repoRoot: root, context: proofContext, applicationUrl: authority.applicationUrl, localProofAuth });
  const api = server.baseUrl;
  const game = randomUUID(); const hostPrincipalAlias = "export_role_host";
  const token = requiredSessionToken(await request(`${api}/auth/local-proof/sessions`, { method: "POST", headers: localProofAuth.requestHeaders(headers()), body: JSON.stringify({ principal_id: fixturePrincipalAuthorityId(hostPrincipalAlias), expires_at: 4102444800, global_capabilities: [] }) }));
  const bootstrapToken = requiredSessionToken(await request(`${api}/auth/local-proof/sessions`, { method: "POST", headers: localProofAuth.requestHeaders(headers()), body: JSON.stringify({ principal_id: fixturePrincipalAuthorityId(hostPrincipalAlias), expires_at: 4102444800, global_capabilities: ["GlobalAdmin"] }) }));
  await command(api, 1, bootstrapToken, { CreateGame: { game, pack: "mafiascum" } });
  await command(api, 2, token, { CompleteGame: { game } });
  // Archive DEKs receive fresh wrapping nonces on every export. Compare the
  // browser with the exact live response its loader consumed, not another export.
  const priorFetch = globalThis.fetch;
  const exportObserver = createCompletedExportFetchObserver({ exportUrl: `${api}/games/${game}/export`, sessionToken: token, fetchImpl: priorFetch });
  globalThis.fetch = exportObserver.fetch;
  restoreFetch = () => { globalThis.fetch = priorFetch; };
  const frontend = await startFrontend(api);
  browser = await chromium.launch(); const context = await browser.newContext();
  await context.addCookies([{ name: "fmarch_session", value: token, url: frontend, httpOnly: true }]);
  const page = await context.newPage({ viewport: { width: 1024, height: 768 } });
  const response = await page.goto(`${frontend}/g/${game}/host/export`, { waitUntil: "networkidle" });
  await page.getByTestId("completed-game-export-manifest").waitFor({ state: "visible" });
  const checksum = await page.getByTestId("completed-game-export-checksum").innerText();
  const eventCount = Number((await page.getByTestId("completed-game-export-event-count").innerText()).split(" ")[0]);
  const manifest = await exportObserver.manifest();
  await closeRoleProofResources([page, context]);
  const evidence = { version: 1, proof: "completed-game-export-role-proof", status: "passed", scope: "local-completed-game-export-role-proof", releaseReady: false, productionReady: false, execution: proofContext.execution, proofBoundary: "Local scratch-Postgres, local Rust API, host session, SvelteKit host export route, and Chromium proof. It proves a completed game's role URL exposes the checksum-bearing manifest from the exact authenticated API response consumed by its loader. Isolated import/rebuild audit and checksum-tamper rejection are covered by Postgres integration tests. It does not prove hosted archival storage, legal retention, public discovery, compatibility guarantees, or release readiness.", roleUrl: `${frontend}/g/${game}/host/export`, manifest: { version: manifest.version, eventCount, checksum, apiChecksum: manifest.checksum_sha256, apiEventCount: manifest.events.length, completedEventPresent: manifest.events.some(event => event.kind === "GameCompleted"), roleResponseStatus: response?.status() ?? 0 } };
  assertCompletedExportProofEvidence(evidence);
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`); console.log(`wrote ${path.relative(root, evidencePath)}`);
} catch (error) { const handled = await handleLocalhostBindFailure({ error, repoRoot: root, artifactDir, evidencePath, smokeName: "completed-game-export-role-proof", stage: "export-role-proof-listen" }); if (!handled) { error.serverOutput = server?.output().slice(-4000) ?? ""; throw error; } }
finally {
  restoreFetch?.();
  try { await closeRoleProofResources([browser, vite, server, database]); }
  finally { if (priorApi === undefined) delete process.env.FMARCH_API_BASE_URL; else process.env.FMARCH_API_BASE_URL = priorApi; }
}

async function command(api, id, sessionToken, commandValue) { const result = await request(`${api}/commands`, { method: "POST", headers: headers(sessionToken), body: JSON.stringify({ v: 3, id, body: { kind: "Command", body: { command_id: randomUUID(), command: fixturePrincipalTransport(commandValue, "completed export command transport") } } }) }); if (result.body?.kind !== "Ack") throw new Error(`seed command rejected ${JSON.stringify(result)}`); }
function requiredSessionToken(session) { if (typeof session?.session_token !== "string" || session.session_token === "") throw new Error("dev session response omitted its backend-issued token"); return session.session_token; }
function headers(sessionToken) { return { ...(sessionToken ? { authorization: `Bearer ${sessionToken}` } : {}), "content-type": "application/json", accept: "application/json" }; }
async function request(url, options) { const response = await fetch(url, { ...options, signal: AbortSignal.timeout(15_000) }); const body = await response.json().catch(() => null); if (!response.ok) throw new Error(`${url} ${response.status}: ${JSON.stringify(body)}`); return body; }
async function startFrontend(api) { process.env.FMARCH_API_BASE_URL = api; const cwd = process.cwd(); process.chdir(frontendRoot); try { const { createServer } = await import(frontendRequire.resolve("vite")); vite = await createServer({ root: frontendRoot, server: { host, port: 0 }, logLevel: "error" }); } finally { process.chdir(cwd); } await vite.listen(); const address = vite.httpServer?.address(); if (!address || typeof address !== "object") throw new Error("export proof frontend did not bind"); return `http://${host}:${address.port}`; }
