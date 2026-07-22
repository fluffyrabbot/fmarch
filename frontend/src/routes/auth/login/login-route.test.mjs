import assert from "node:assert/strict";
import { test } from "node:test";
import { load } from "./+page.server.js";

test("login chooser preserves only local return paths", () => {
  assert.deepEqual(
    load({
      locals: {},
      url: new URL("http://localhost/auth/login?returnTo=/admin"),
    }),
    {
      chooser: {
        principalUserId: null,
        accountId: "",
        returnTo: "/admin",
        workosAvailable: false,
      },
    },
  );

  assert.deepEqual(
    load({
      locals: { principalUserId: "admin_a" },
      url: new URL(
        "http://localhost/auth/login?returnTo=/auth/login%3FreturnTo%3D/admin",
      ),
    }),
    {
      chooser: {
        principalUserId: "admin_a",
        accountId: "",
        returnTo: "/",
        workosAvailable: false,
      },
    },
  );

  assert.deepEqual(
    load({
      locals: {},
      url: new URL(
        "http://localhost/auth/login?returnTo=/g/midsummer/host&account=host%40example.test",
      ),
    }),
    {
      chooser: {
        principalUserId: null,
        accountId: "host@example.test",
        returnTo: "/g/midsummer/host",
        workosAvailable: false,
      },
    },
  );
});

test("login chooser offers WorkOS only when its configuration is complete", () => {
  const workosEnv = {
    WORKOS_CLIENT_ID: "client_x",
    WORKOS_API_KEY: "sk_test",
    WORKOS_REDIRECT_URI: "http://localhost/auth/callback",
    WORKOS_COOKIE_PASSWORD: "0123456789abcdef0123456789abcdef",
  };
  const previous = {};
  for (const [name, value] of Object.entries(workosEnv)) {
    previous[name] = process.env[name];
    process.env[name] = value;
  }
  try {
    const result = load({
      locals: {},
      url: new URL("http://localhost/auth/login?returnTo=/admin"),
    });
    assert.equal(result.chooser.workosAvailable, true);
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
