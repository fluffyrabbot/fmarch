import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { authSourceHeader } from "./auth-source.mjs";

test("auth source attribution is signed with a short-lived timestamp", () => {
  const key = "test-auth-source-signing-key-with-at-least-32-bytes";
  const now = 1_750_000_000_000;
  const headers = authSourceHeader(
    "203.0.113.45",
    { FMARCH_AUTH_SOURCE_SIGNING_KEY: key },
    now,
  );
  assert.equal(headers["x-fmarch-auth-source"], "203.0.113.45");
  assert.equal(headers["x-fmarch-auth-source-timestamp"], "1750000000");
  assert.equal(
    headers["x-fmarch-auth-source-signature"],
    createHmac("sha256", key).update("1750000000\n203.0.113.45").digest("hex"),
  );
});

test("missing signing configuration never fabricates a signature", () => {
  assert.deepEqual(authSourceHeader("203.0.113.45", {}, 0), {
    "x-fmarch-auth-source": "203.0.113.45",
  });
  assert.deepEqual(authSourceHeader(null, {}, 0), {});
});
