import assert from "node:assert/strict";
import { test } from "node:test";
import { workosAuthKitConfigured } from "./workos-authkit.mjs";

test("WorkOS AuthKit configuration is all-or-nothing", () => {
  assert.equal(workosAuthKitConfigured({}), false);
  assert.equal(
    workosAuthKitConfigured({
      WORKOS_CLIENT_ID: "client_123",
      WORKOS_API_KEY: "test-api-key",
      WORKOS_REDIRECT_URI: "https://fmarch.example/auth/callback",
      WORKOS_COOKIE_PASSWORD: "a-long-random-cookie-password-value",
    }),
    true,
  );
  assert.throws(
    () => workosAuthKitConfigured({ WORKOS_CLIENT_ID: "client_123" }),
    /missing WORKOS_API_KEY, WORKOS_REDIRECT_URI, WORKOS_COOKIE_PASSWORD/u,
  );
});
