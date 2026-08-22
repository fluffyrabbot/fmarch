import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";
import {
  actions as ownerActions,
  load as loadOwner,
  _profileBody,
  _profileRevision,
} from "./profile/edit/+page.server.js";

test("profile creation keeps the visibility contract limited to public and private", () => {
  const body = _profileBody(formData({
    handle: "quiet_member",
    displayName: "Quiet Member",
    bio: "Private biography.",
    visibility: "private",
  }));

  assert.deepEqual(body, {
    handle: "quiet_member",
    display_name: "Quiet Member",
    bio: "Private biography.",
    visibility: "private",
  });
  assert.equal("expected_revision" in body, false);
});

test("profile updates preserve the revision read by the editor", () => {
  const form = formData({
    displayName: "Quiet Member",
    bio: "Updated biography.",
    visibility: "public",
    expected_revision: "42",
  });

  assert.equal(_profileRevision(form), 42);
  assert.deepEqual(_profileBody(form, {
    includeHandle: false,
    expectedRevision: _profileRevision(form),
  }), {
    display_name: "Quiet Member",
    bio: "Updated biography.",
    visibility: "public",
    expected_revision: 42,
  });
  assert.equal(_profileRevision(formData({ expected_revision: "42.5" })), null);
  assert.equal(_profileRevision(formData({ expected_revision: "-1" })), null);
  assert.equal(_profileRevision(formData({ expected_revision: "9007199254740992" })), null);
});

test("owner profile editor reads and writes through the authenticated session", async () => {
  let readRequest = null;
  const loaded = await loadOwner({
    locals: { principalId: "principal-a" },
    cookies: { get: () => "editor-session" },
    fetch: async (url, init) => {
      readRequest = { url, init };
      return jsonResponse({
        handle: "quiet_member",
        display_name: "Quiet Member",
        bio: "Private biography.",
        visibility: "private",
        revision: 42,
      });
    },
  });

  assert.equal(readRequest.url, "/profiles/me/editor");
  assert.equal(readRequest.init.headers.authorization, "Bearer editor-session");
  assert.equal(loaded.profile.revision, 42);

  let updateRequest = null;
  await assert.rejects(
    ownerActions.update({
      locals: { principalId: "principal-a" },
      cookies: { get: () => "editor-session" },
      request: requestWithForm({
        displayName: "Quiet Member",
        bio: "Updated biography.",
        visibility: "private",
        expected_revision: "42",
      }),
      fetch: async (url, init) => {
        updateRequest = { url, init };
        return jsonResponse({});
      },
    }),
    (failure) => failure.status === 303 && failure.location === "/profile/edit",
  );

  assert.equal(updateRequest.url, "/profiles/me");
  assert.equal(updateRequest.init.headers.authorization, "Bearer editor-session");
  assert.deepEqual(JSON.parse(updateRequest.init.body), {
    display_name: "Quiet Member",
    bio: "Updated biography.",
    visibility: "private",
    expected_revision: 42,
  });
});

test("owner profile editor rejects an update without a valid revision before it reaches the API", async () => {
  let called = false;
  const result = await ownerActions.update({
    locals: { principalId: "principal-a" },
    cookies: { get: () => "editor-session" },
    request: requestWithForm({
      displayName: "Quiet Member",
      bio: "Updated biography.",
      visibility: "private",
      expected_revision: "",
    }),
    fetch: async () => { called = true; },
  });

  assert.equal(called, false);
  assert.equal(result.status, 400);
  assert.equal(result.data.message, "This profile version is invalid. Reload the page and try again.");
});

test("owner profile editor distinguishes an absent profile from an unavailable owner endpoint", async () => {
  const data = await loadOwner({
    locals: { principalId: "principal-a" },
    cookies: { get: () => "editor-session" },
    fetch: async () => new Response(null, { status: 404 }),
  });

  assert.deepEqual(data, { profile: null });
});

test("the handle-addressed profile editor route is removed", async () => {
  await assert.rejects(
    access(new URL("./u/[handle]/edit/+page.server.js", import.meta.url)),
    { code: "ENOENT" },
  );
});

function formData(values) {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

function requestWithForm(values) {
  return new Request("http://localhost/profile/edit?/update", {
    method: "POST",
    body: formData(values),
  });
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
