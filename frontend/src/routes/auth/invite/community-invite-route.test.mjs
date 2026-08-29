import assert from "node:assert/strict";
import { test } from "node:test";
import { actions, load } from "./+page.server.js";

test("community invitation entry seals the credential and redirects to a clean URL", () => {
  const cookies = cookieJar();
  assert.throws(
    () =>
      load({
        cookies,
        url: new URL(
          "http://localhost/auth/invite?invite=fmci_example&account=Member%40Example.test&returnTo=%2Fg%2Fmidsummer",
        ),
      }),
    (error) =>
      error.status === 303 &&
      error.location ===
        "/auth/invite?returnTo=%2Fg%2Fmidsummer&account=Member%40Example.test",
  );
  assert.equal(cookies.values.get("fmarch_pending_community_invitation"), "fmci_example");

  assert.deepEqual(
    load({
      cookies,
      url: new URL(
        "http://localhost/auth/invite?account=Member%40Example.test&returnTo=%2Fg%2Fmidsummer",
      ),
    }),
    {
      admission: {
        invitationReady: true,
        accountId: "Member@Example.test",
        returnTo: "/g/midsummer",
      },
    },
  );
});

test("community invitation entry redirects into the chooser without credential query data", async () => {
  const cookies = cookieJar({ fmarch_pending_community_invitation: "fmci_example" });
  await assert.rejects(
    actions.default({
      cookies,
      request: formRequest({
        invitationCredential: "",
        accountId: "member@example.test",
        returnTo: "/g/midsummer",
      }),
      url: new URL("http://localhost/auth/invite"),
    }),
    (error) =>
      error.status === 303 &&
      error.location ===
        "/auth/register?account=member%40example.test&returnTo=%2Fg%2Fmidsummer" &&
      !error.location.includes("fmci_"),
  );
});

test("community invitation entry rejects incomplete or external-target submissions", async () => {
  const result = await actions.default({
    cookies: cookieJar(),
    request: formRequest({
      invitationCredential: "",
      accountId: "member@example.test",
      returnTo: "//evil.example/",
    }),
    url: new URL("http://localhost/auth/invite"),
  });
  assert.equal(result.status, 400);
  assert.equal(result.data.returnTo, "/");
});

function cookieJar(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    get(name) {
      return values.get(name);
    },
    set(name, value) {
      values.set(name, value);
    },
    delete(name) {
      values.delete(name);
    },
  };
}

function formRequest(fields) {
  return {
    async formData() {
      return new Map(Object.entries(fields));
    },
  };
}
