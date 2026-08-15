import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontendRoot = path.join(root, "frontend");
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
    FMARCH_API_BASE_URL: origin,
    FMARCH_API_INTERNAL_URL: "http://fmarch.railway.internal:8080",
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
  const page = await browser.newPage();
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
  assert.deepEqual(violations, []);
  console.log("production nonce CSP browser proof passed");
} finally {
  await browser?.close();
  if (server.exitCode === null) {
    server.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => server.once("exit", resolve)),
      delay(2_000),
    ]);
  }
}

function cspNonce(csp) {
  const match = csp.match(/'nonce-([A-Za-z0-9+/=]+)'/);
  assert.ok(match, "CSP must contain a nonce source");
  return match[1];
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
