import assert from "node:assert/strict";
import { test } from "node:test";
import { load } from "./+page.server.js";

test("registration chooser preserves the local game return path", () => {
  assert.deepEqual(
    load({
      url: new URL(
        "http://localhost/auth/register?account=New%40Example.test&returnTo=%2Fg%2Fmidsummer",
      ),
    }),
    {
      chooser: {
        accountId: "New@Example.test",
        returnTo: "/g/midsummer",
        workosAvailable: false,
      },
    },
  );
  assert.deepEqual(
    load({
      url: new URL("http://localhost/auth/register?returnTo=//evil.test/"),
    }),
    { chooser: { accountId: "", returnTo: "/", workosAvailable: false } },
  );
});
