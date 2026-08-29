import assert from "node:assert/strict";
import { test } from "node:test";
import { load } from "./+page.server.js";

test("registration chooser requires a server-held invitation and preserves the local return path", () => {
  assert.deepEqual(
    load({
      cookies: invitationCookies(),
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
  assert.throws(
    () =>
      load({
        cookies: { get() {} },
        url: new URL("http://localhost/auth/register?returnTo=//evil.test/"),
      }),
    (error) => error.status === 303 && error.location === "/auth/invite?returnTo=%2F",
  );
});

function invitationCookies() {
  return {
    get(name) {
      return name === "fmarch_pending_community_invitation" ? "fmci_example" : undefined;
    },
  };
}
