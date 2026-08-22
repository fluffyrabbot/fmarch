import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontendRoot = path.join(root, "frontend");
const providerLogoutUrl =
  "https://api.workos.com/user_management/sessions/logout?session_id=session_01JNXQF0S5V5TQ0M9K2R8E7C6D";
const build = spawnSync("npm", ["run", "build"], {
  cwd: frontendRoot,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
assert.equal(
  build.status,
  0,
  `production frontend build failed:\n${`${build.stdout ?? ""}${build.stderr ?? ""}`.slice(-4000)}`,
);
const host = "127.0.0.1";
const certificateDir = mkdtempSync(path.join(os.tmpdir(), "fmarch-csp-browser-"));
const certificatePath = path.join(certificateDir, "certificate.pem");
const privateKeyPath = path.join(certificateDir, "private-key.pem");
generateLocalCertificate({ certificatePath, privateKeyPath });
const apiRequests = [];
const apiServer = https.createServer(
  {
    cert: readFileSync(certificatePath),
    key: readFileSync(privateKeyPath),
  },
  (request, response) => {
    apiRequests.push({
      authorization: request.headers.authorization ?? null,
      method: request.method,
      url: request.url,
    });
    if (request.method === "POST" && request.url === "/auth/session-logout") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          status: "logged_out",
          principal_id: "admin_a",
          provider_logout_url: providerLogoutUrl,
        }),
      );
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
  },
);
await listen(apiServer, host);
const apiAddress = apiServer.address();
assert.ok(typeof apiAddress === "object" && apiAddress !== null);
const apiOrigin = `https://${host}:${apiAddress.port}`;
const port = await availablePort(host);
const origin = `http://${host}:${port}`;
const proofUrl = `${origin}/auth/login`;
const output = [];
const server = spawn("node", ["build"], {
  cwd: frontendRoot,
  env: {
    ...process.env,
    HOST: host,
    PORT: String(port),
    ORIGIN: origin,
    NODE_ENV: "production",
    NODE_EXTRA_CA_CERTS: certificatePath,
    FMARCH_API_BASE_URL: apiOrigin,
    FMARCH_API_INTERNAL_URL: "",
    FMARCH_FRONTEND_FIXTURE_SESSION: "1",
    FMARCH_SSR_FETCH_TIMEOUT_MS: "50",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (chunk) => output.push(chunk.toString()));
server.stderr.on("data", (chunk) => output.push(chunk.toString()));

let browser;
try {
  await waitForHealth();
  const first = await fetch(proofUrl);
  const second = await fetch(proofUrl);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  const firstCsp = first.headers.get("content-security-policy");
  const secondCsp = second.headers.get("content-security-policy");
  assert.ok(firstCsp, "production HTML must carry CSP");
  assert.ok(secondCsp, "repeat production HTML must carry CSP");
  assert.match(firstCsp, /script-src[^;]*'nonce-[A-Za-z0-9+/=]+'/);
  assert.match(firstCsp, /script-src[^;]*'strict-dynamic'/);
  assert.match(firstCsp, /script-src-attr 'none'/);
  assert.match(
    firstCsp,
    /style-src-attr 'unsafe-hashes' 'sha256-S8qMpvofolR8Mpjy4kQvEm7m1q8clzU4dfDH0AmvZjo='/,
  );
  assert.match(firstCsp, /object-src 'none'/);
  assert.match(firstCsp, /frame-ancestors 'none'/);
  assert.doesNotMatch(firstCsp, /unsafe-inline|unsafe-eval/);
  const firstNonce = cspNonce(firstCsp);
  const secondNonce = cspNonce(secondCsp);
  assert.notEqual(firstNonce, secondNonce, "CSP nonce must be unique per response");

  const html = await first.text();
  const inlineExecutableTags = [
    ...html.matchAll(/<(?:script|style)\b[^>]*>(?:[\s\S]*?)<\/(?:script|style)>/gi),
  ].map((match) => match[0]);
  assert.ok(inlineExecutableTags.length > 0, "page must exercise generated executable tags");
  for (const tag of inlineExecutableTags) {
    assert.match(tag, new RegExp(`\\bnonce="${escapeRegex(firstNonce)}"`));
  }

  browser = await chromium.launch();
  const browserContext = await browser.newContext();
  const page = await browserContext.newPage();
  const violations = [];
  page.on("console", (message) => {
    if (/content security policy|refused to/i.test(message.text())) violations.push(message.text());
  });
  page.on("pageerror", (error) => violations.push(error.message));
  const response = await page.goto(proofUrl, { waitUntil: "networkidle" });
  assert.equal(response?.status(), 200);
  assert.equal(
    await page.evaluate(() => document.querySelectorAll("script[nonce], style[nonce]").length > 0),
    true,
    "browser must receive nonce-bearing executable elements",
  );

  const logoutProofUrl = `${origin}/auth/logout?returnTo=%2Fadmin`;
  const noJavaScriptContext = await browser.newContext({ javaScriptEnabled: false });
  await setFixtureSession(noJavaScriptContext, origin);
  const noJavaScriptProviderRequests = [];
  await noJavaScriptContext.route("https://api.workos.com/**", async (route) => {
    noJavaScriptProviderRequests.push(route.request().url());
    await route.fulfill({ status: 204 });
  });
  const noJavaScriptPage = await noJavaScriptContext.newPage();
  const noJavaScriptInitialResponse = await noJavaScriptPage.goto(logoutProofUrl);
  assert.equal(noJavaScriptInitialResponse?.status(), 200);
  const [fallbackResponse] = await Promise.all([
    noJavaScriptPage.waitForResponse(isLogoutFormResponse),
    noJavaScriptPage.getByTestId("auth-logout-submit").click(),
  ]);
  assertContinuationHeaders(fallbackResponse);
  assert.equal(
    await noJavaScriptPage.getByTestId("auth-provider-logout-continuation").isVisible(),
    true,
    "the no-JavaScript response must render the provider logout continuation",
  );
  const fallback = noJavaScriptPage.getByTestId("auth-provider-logout-continue");
  assert.equal(await fallback.isVisible(), true, "provider logout fallback must be visible");
  assert.equal(await fallback.getAttribute("href"), providerLogoutUrl);
  await assertIdentityCookiesDeleted(noJavaScriptContext, origin);
  const [noJavaScriptProviderRequest] = await Promise.all([
    noJavaScriptPage.waitForRequest(providerLogoutUrl),
    fallback.click(),
  ]);
  assert.equal(noJavaScriptProviderRequest.method(), "GET");
  assert.equal(noJavaScriptProviderRequest.isNavigationRequest(), true);
  assert.equal(noJavaScriptProviderRequest.frame(), noJavaScriptPage.mainFrame());
  assert.deepEqual(
    noJavaScriptProviderRequests,
    [providerLogoutUrl],
    "activating the no-JavaScript fallback must request provider logout exactly once",
  );
  await noJavaScriptContext.close();

  await setFixtureSession(browserContext, origin);
  const providerRequests = [];
  await browserContext.route(providerLogoutUrl, async (route) => {
    providerRequests.push(route.request());
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>provider logout reached</title>",
    });
  });
  const logoutPageResponse = await page.goto(logoutProofUrl);
  assert.equal(logoutPageResponse?.status(), 200);
  const [continuationResponse, providerRequest] = await Promise.all([
    page.waitForResponse(isLogoutFormResponse),
    page.waitForRequest(providerLogoutUrl),
    page.getByTestId("auth-logout-submit").click(),
  ]);
  assertContinuationHeaders(continuationResponse);
  await assertIdentityCookiesDeleted(browserContext, origin);
  assert.equal(providerRequest.method(), "GET");
  assert.equal(providerRequest.isNavigationRequest(), true);
  assert.equal(providerRequest.frame(), page.mainFrame());
  assert.deepEqual(
    providerRequests.map((request) => request.url()),
    [providerLogoutUrl],
    "a successful native form submit must request provider logout exactly once",
  );
  assert.deepEqual(apiRequests, [
    {
      authorization: "Bearer fixture-admin",
      method: "POST",
      url: "/auth/session-logout",
    },
    {
      authorization: "Bearer fixture-admin",
      method: "POST",
      url: "/auth/session-logout",
    },
  ]);
  assert.deepEqual(violations, []);
  console.log("production nonce CSP and provider logout continuation browser proof passed");
} finally {
  await browser?.close();
  if (server.exitCode === null) {
    server.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => server.once("exit", resolve)),
      delay(2_000),
    ]);
  }
  await closeServer(apiServer);
  rmSync(certificateDir, { force: true, recursive: true });
}

function assertContinuationHeaders(response) {
  assert.equal(response.status(), 200);
  const headers = response.headers();
  assert.equal(headers["cache-control"], "no-store");
  assert.match(headers["content-security-policy"] ?? "", /(?:^|;)\s*form-action 'self'(?:;|$)/u);
}

function isLogoutFormResponse(response) {
  return response.url().startsWith(`${origin}/auth/logout`) && response.request().method() === "POST";
}

async function setFixtureSession(context, appOrigin) {
  await context.addCookies([
    {
      name: "fmarch_session",
      value: "fixture-admin",
      url: appOrigin,
    },
    {
      name: "wos-session",
      value: "synthetic-provider-session",
      url: appOrigin,
    },
  ]);
}

async function assertIdentityCookiesDeleted(context, appOrigin) {
  const remainingNames = (await context.cookies(appOrigin)).map((cookie) => cookie.name);
  assert.equal(remainingNames.includes("fmarch_session"), false);
  assert.equal(remainingNames.includes("wos-session"), false);
}

function cspNonce(csp) {
  const match = csp.match(/'nonce-([A-Za-z0-9+/=]+)'/);
  assert.ok(match, "CSP must contain a nonce source");
  return match[1];
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function generateLocalCertificate({ certificatePath, privateKeyPath }) {
  const generated = spawnSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-sha256",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=127.0.0.1",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
      "-keyout",
      privateKeyPath,
      "-out",
      certificatePath,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  assert.equal(
    generated.status,
    0,
    `local TLS certificate generation failed:\n${`${generated.stdout ?? ""}${generated.stderr ?? ""}`.slice(-4000)}`,
  );
}

async function listen(server, bindHost) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, bindHost, resolve);
  });
}

async function closeServer(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function waitForHealth() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`frontend exited before healthcheck:\n${output.join("").slice(-4000)}`);
    }
    try {
      const response = await fetch(`${origin}/healthz`);
      if (response.ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error(`frontend healthcheck timed out:\n${output.join("").slice(-4000)}`);
}

async function availablePort(bindHost) {
  return await new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once("error", reject);
    listener.listen(0, bindHost, () => {
      const address = listener.address();
      const selected = typeof address === "object" && address ? address.port : null;
      listener.close((error) => (error ? reject(error) : resolve(selected)));
    });
  });
}
