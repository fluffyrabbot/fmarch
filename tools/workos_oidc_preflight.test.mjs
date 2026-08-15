import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

import {
  preflightWorkosOidc,
  validateWorkosOidcConfiguration,
  workosDiscoveryUrl,
} from "./workos_oidc_preflight.mjs";

const clientId = "client_01TESTCLIENT0000000000000000";
const issuer = `https://api.workos.com/user_management/${clientId}`;
const jwksUrl = `https://api.workos.com/sso/jwks/${clientId}`;
const discovery = { issuer, jwks_uri: jwksUrl };
const publicJwk = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({
  format: "jwk",
});
const jwks = {
  keys: [{ ...publicJwk, kid: "key_01M01Y3G6TQWRJ", use: "sig", alg: "RS256" }],
};

test("discovery endpoint is scoped to one WorkOS application client", () => {
  assert.equal(
    workosDiscoveryUrl(clientId),
    `${issuer}/.well-known/openid-configuration`,
  );
  assert.throws(() => workosDiscoveryUrl("client_replace_me"), /application client id/);
});

test("OIDC configuration must exactly match public discovery metadata", () => {
  assert.doesNotThrow(() =>
    validateWorkosOidcConfiguration({
      label: "staging",
      clientId,
      issuer,
      jwksUrl,
      discovery,
      jwks,
    }),
  );
  assert.throws(
    () =>
      validateWorkosOidcConfiguration({
        label: "staging",
        clientId,
        issuer: "https://api.workos.com/",
        jwksUrl,
        discovery,
        jwks,
      }),
    /WORKOS_ISSUER must exactly match OIDC discovery/,
  );
  assert.throws(
    () =>
      validateWorkosOidcConfiguration({
        label: "staging",
        clientId,
        issuer,
        jwksUrl: `${jwksUrl}-wrong`,
        discovery,
        jwks,
      }),
    /WORKOS_JWKS_URL must exactly match OIDC discovery/,
  );
  assert.throws(
    () =>
      validateWorkosOidcConfiguration({
        label: "staging",
        clientId,
        issuer: issuer.replace("https:", "http:"),
        jwksUrl,
        discovery,
        jwks,
      }),
    /must use HTTPS/,
  );
  assert.throws(
    () =>
      validateWorkosOidcConfiguration({
        label: "staging",
        clientId,
        issuer,
        jwksUrl,
        discovery,
        jwks: { keys: [] },
      }),
    /at least one keyed RS256 signing key/,
  );
  assert.throws(
    () =>
      validateWorkosOidcConfiguration({
        label: "staging",
        clientId,
        issuer,
        jwksUrl,
        discovery,
        jwks: {
          keys: [{ kid: "metadata-only", kty: "RSA", use: "sig", alg: "RS256" }],
        },
      }),
    /at least one keyed RS256 signing key/,
  );
});

test("live preflight reads discovery first and then its advertised JWKS", async () => {
  const requested = [];
  const fetchImpl = async (url, options) => {
    requested.push({ url, options });
    const body = url.endsWith("openid-configuration") ? discovery : jwks;
    return {
      ok: true,
      status: 200,
      async json() {
        return body;
      },
    };
  };
  const result = await preflightWorkosOidc({
    label: "staging",
    clientId,
    issuer,
    jwksUrl,
    fetchImpl,
  });
  assert.deepEqual(
    requested.map(({ url }) => url),
    [workosDiscoveryUrl(clientId), jwksUrl],
  );
  assert.equal(requested.every(({ options }) => options.headers.accept === "application/json"), true);
  assert.equal(result.signingKeyCount, 1);
});

test("live preflight fails closed on discovery transport and metadata drift", async () => {
  await assert.rejects(
    preflightWorkosOidc({
      label: "staging",
      clientId,
      issuer,
      jwksUrl,
      fetchImpl: async () => ({ ok: false, status: 503 }),
    }),
    /OIDC discovery returned HTTP 503/,
  );
  await assert.rejects(
    preflightWorkosOidc({
      label: "staging",
      clientId,
      issuer,
      jwksUrl,
      fetchImpl: async (url) => ({
        ok: true,
        status: 200,
        async json() {
          return url.endsWith("openid-configuration")
            ? { ...discovery, issuer: `${issuer}-drifted` }
            : jwks;
        },
      }),
    }),
    /WORKOS_ISSUER must exactly match OIDC discovery/,
  );

  const requested = [];
  await assert.rejects(
    preflightWorkosOidc({
      label: "staging",
      clientId,
      issuer,
      jwksUrl,
      fetchImpl: async (url) => {
        requested.push(url);
        return {
          ok: true,
          status: 200,
          async json() {
            return { ...discovery, jwks_uri: "https://untrusted.example.test/jwks" };
          },
        };
      },
    }),
    /WORKOS_JWKS_URL must exactly match OIDC discovery/,
  );
  assert.deepEqual(requested, [workosDiscoveryUrl(clientId)]);
});
