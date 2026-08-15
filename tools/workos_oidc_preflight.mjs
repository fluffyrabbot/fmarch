import assert from "node:assert/strict";
import { createPublicKey } from "node:crypto";
import { fileURLToPath } from "node:url";

const WORKOS_API_ORIGIN = "https://api.workos.com";
const CLIENT_ID_PATTERN = /^client_[A-Za-z0-9]+$/u;

export function workosDiscoveryUrl(clientId) {
  assert.match(
    clientId ?? "",
    CLIENT_ID_PATTERN,
    "WORKOS_CLIENT_ID must be a WorkOS application client id",
  );
  return `${WORKOS_API_ORIGIN}/user_management/${clientId}/.well-known/openid-configuration`;
}

export function validateWorkosOidcConfiguration({
  label,
  clientId,
  issuer,
  jwksUrl,
  discovery,
  jwks,
}) {
  validateWorkosOidcMetadata({ label, clientId, issuer, jwksUrl, discovery });
  const subject = label || "WorkOS";
  const signingKeyCount = Array.isArray(jwks?.keys)
    ? jwks.keys.filter(isUsableRs256SigningKey).length
    : 0;
  assert.ok(
    signingKeyCount > 0,
    `${subject} discovered JWKS must contain at least one keyed RS256 signing key`,
  );
  return signingKeyCount;
}

function isUsableRs256SigningKey(key) {
  if (
    key?.use !== "sig" ||
    key?.kty !== "RSA" ||
    key?.alg !== "RS256" ||
    typeof key?.kid !== "string" ||
    key.kid.length === 0
  ) {
    return false;
  }
  try {
    return createPublicKey({ key, format: "jwk" }).asymmetricKeyType === "rsa";
  } catch {
    return false;
  }
}

export function validateWorkosOidcMetadata({
  label,
  clientId,
  issuer,
  jwksUrl,
  discovery,
}) {
  const subject = label || "WorkOS";
  workosDiscoveryUrl(clientId);
  validatePublicHttpsUrl(issuer, `${subject} WORKOS_ISSUER`);
  validatePublicHttpsUrl(jwksUrl, `${subject} WORKOS_JWKS_URL`);
  assert.equal(
    discovery?.issuer,
    issuer,
    `${subject} WORKOS_ISSUER must exactly match OIDC discovery`,
  );
  assert.equal(
    discovery?.jwks_uri,
    jwksUrl,
    `${subject} WORKOS_JWKS_URL must exactly match OIDC discovery`,
  );
}

export async function preflightWorkosOidc({
  label = "WorkOS",
  clientId,
  issuer,
  jwksUrl,
  fetchImpl = globalThis.fetch,
  timeoutMs = 10_000,
}) {
  assert.equal(typeof fetchImpl, "function", `${label} OIDC preflight requires fetch`);
  const discoveryUrl = workosDiscoveryUrl(clientId);
  const discovery = await fetchJson(fetchImpl, discoveryUrl, `${label} OIDC discovery`, timeoutMs);
  validateWorkosOidcMetadata({ label, clientId, issuer, jwksUrl, discovery });
  const jwks = await fetchJson(fetchImpl, jwksUrl, `${label} discovered JWKS`, timeoutMs);
  const signingKeyCount = validateWorkosOidcConfiguration({
    label,
    clientId,
    issuer,
    jwksUrl,
    discovery,
    jwks,
  });
  return Object.freeze({
    discoveryUrl,
    issuer: discovery.issuer,
    jwksUrl: discovery.jwks_uri,
    signingKeyCount,
  });
}

async function fetchJson(fetchImpl, url, label, timeoutMs) {
  const response = await fetchImpl(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  assert.equal(response.ok, true, `${label} returned HTTP ${response.status}`);
  return await response.json();
}

function validatePublicHttpsUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    assert.fail(`${label} must be a valid URL`);
  }
  assert.equal(url.protocol, "https:", `${label} must use HTTPS`);
  assert.equal(url.username, "", `${label} must not contain credentials`);
  assert.equal(url.password, "", `${label} must not contain credentials`);
  assert.equal(url.search, "", `${label} must not contain a query string`);
  assert.equal(url.hash, "", `${label} must not contain a fragment`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = await preflightWorkosOidc({
      clientId: process.env.WORKOS_CLIENT_ID,
      issuer: process.env.WORKOS_ISSUER,
      jwksUrl: process.env.WORKOS_JWKS_URL,
    });
    console.log(
      `WorkOS OIDC preflight passed with ${result.signingKeyCount} discovered signing key(s)`,
    );
  } catch (error) {
    console.error(`WorkOS OIDC preflight failed: ${error.message}`);
    process.exitCode = 1;
  }
}
