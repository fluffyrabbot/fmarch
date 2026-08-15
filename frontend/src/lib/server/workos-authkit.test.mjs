import assert from "node:assert/strict";
import { test } from "node:test";
import {
  beginWorkosAuthorization,
  createWorkosAuthKit,
  workosAuthKitConfigured,
} from "./workos-authkit.mjs";

const TEST_ENV = Object.freeze({
  WORKOS_CLIENT_ID: "client_123",
  WORKOS_API_KEY: "test-api-key",
  WORKOS_REDIRECT_URI: "https://fmarch.example/auth/callback",
  WORKOS_COOKIE_PASSWORD: "a-long-random-cookie-password-value",
});

test("WorkOS AuthKit configuration is all-or-nothing", () => {
  assert.equal(workosAuthKitConfigured({}), false);
  assert.equal(
    workosAuthKitConfigured(TEST_ENV),
    true,
  );
  assert.throws(
    () => workosAuthKitConfigured({ WORKOS_CLIENT_ID: "client_123" }),
    /missing WORKOS_API_KEY, WORKOS_REDIRECT_URI, WORKOS_COOKIE_PASSWORD/u,
  );
});

test("the real SDK round-trip keeps only a short-lived PKCE verifier cookie", async () => {
  const cookies = cookieJar();
  const authKit = createWorkosAuthKit(TEST_ENV, {
    client: fakeWorkosClient(),
    encryption: transparentTestEncryption(),
  });

  const authorization = await authKit.createSignIn(cookies, {
    returnPathname: "/admin",
  });
  const state = new URL(authorization.url).searchParams.get("state");
  assert.equal(typeof state, "string");
  assert.equal(cookies.values.get(authorization.cookieName), state);
  assert.deepEqual(cookies.options.get(authorization.cookieName), {
    path: "/",
    maxAge: 600,
    httpOnly: true,
    secure: true,
    sameSite: "lax",
  });

  const callback = await authKit.handleCallback(cookies, cookies, {
    code: "code_a",
    state,
  });
  assert.equal(callback.authResponse.accessToken, "access-code_a");
  assert.equal(callback.returnPathname, "/admin");
  assert.equal(cookies.values.has(authorization.cookieName), false);
  assert.equal(cookies.values.has("wos-session"), false);
});

test("authorization starts through the PKCE service without request middleware", async () => {
  const observed = [];
  const cookies = { set() {}, get() {}, delete() {} };
  const authKit = {
    async createSignIn(response, options) {
      observed.push({ method: "sign-in", response, options });
      return { url: "https://authkit.example/sign-in" };
    },
    async createSignUp(response, options) {
      observed.push({ method: "sign-up", response, options });
      return { url: "https://authkit.example/sign-up" };
    },
  };
  const dependencies = { loadAuthKitImpl: async () => authKit, env: {} };

  assert.equal(
    await beginWorkosAuthorization(
      {
        cookies,
        intent: "sign-in",
        returnTo: "/admin",
        loginHint: "admin@example.test",
      },
      dependencies,
    ),
    "https://authkit.example/sign-in",
  );
  assert.equal(
    await beginWorkosAuthorization(
      { cookies, intent: "sign-up", returnTo: "/", loginHint: null },
      dependencies,
    ),
    "https://authkit.example/sign-up",
  );
  assert.deepEqual(observed, [
    {
      method: "sign-in",
      response: cookies,
      options: { returnPathname: "/admin", loginHint: "admin@example.test" },
    },
    {
      method: "sign-up",
      response: cookies,
      options: { returnPathname: "/" },
    },
  ]);
});

function cookieJar() {
  const values = new Map();
  const options = new Map();
  return {
    values,
    options,
    get(name) {
      return values.get(name);
    },
    set(name, value, cookieOptions) {
      values.set(name, value);
      options.set(name, cookieOptions);
    },
    delete(name) {
      values.delete(name);
    },
  };
}

function fakeWorkosClient() {
  return {
    pkce: {
      async generate() {
        return {
          codeVerifier: "verifier-abcdefghijklmnopqrstuvwxyz0123456789",
          codeChallenge: "challenge",
          codeChallengeMethod: "S256",
        };
      },
    },
    userManagement: {
      getAuthorizationUrl(options) {
        const query = new URLSearchParams({
          state: options.state,
          code_challenge: options.codeChallenge,
        });
        return `https://authkit.example/authorize?${query}`;
      },
      async authenticateWithCode({ code }) {
        return {
          accessToken: `access-${code}`,
          refreshToken: `refresh-${code}`,
          user: {
            id: "user_test",
            email: "admin@example.test",
            emailVerified: true,
          },
        };
      },
    },
  };
}

function transparentTestEncryption() {
  return {
    async sealData(value) {
      return Buffer.from(JSON.stringify(value)).toString("base64url");
    },
    async unsealData(value) {
      return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    },
  };
}
