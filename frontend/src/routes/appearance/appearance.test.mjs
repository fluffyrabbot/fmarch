import assert from "node:assert/strict";
import { test } from "node:test";
import { actions } from "./+page.server.js";
import { safeReturnPath } from "../../lib/app/theme.mjs";

test("appearance persists a validated browser preference with safe cookie attributes", async () => {
  const calls = [];
  const request = new Request("https://fmarch.test/appearance", { method: "POST", headers: { origin: "https://fmarch.test" }, body: new URLSearchParams({ themeId: "slate", scheme: "dark" }) });
  await assert.rejects(actions.default({ request, url: new URL(request.url), cookies: { set: (...args) => calls.push(args) } }), error => error.status === 303 && error.location === "/appearance");
  assert.deepEqual(calls, [["fmarch_appearance", "slate:dark", { path: "/", httpOnly: true, sameSite: "lax", secure: true, maxAge: 31536000 }]]);
});
test("invalid and cross-origin preferences never write cookies", async () => {
  for (const [origin, themeId, status] of [["https://elsewhere.test", "paper", 403], ["https://fmarch.test", "missing", 400]]) {
    const request = new Request("https://fmarch.test/appearance", { method: "POST", headers: { origin }, body: new URLSearchParams({ themeId, scheme: "light" }) });
    const result = await actions.default({ request, url: new URL(request.url), cookies: { set() { assert.fail("unexpected cookie mutation"); } } });
    assert.equal(result.status, status);
  }
});
test("the quick switch returns only to same-origin paths", async () => {
  const request = new Request("https://fmarch.test/appearance", { method: "POST", headers: { origin: "https://fmarch.test" }, body: new URLSearchParams({ themeId: "den", scheme: "light", return_to: "/discussions/general?cursor=a" }) });
  await assert.rejects(actions.default({ request, url: new URL(request.url), cookies: { set() {} } }), error => error.status === 303 && error.location === "/discussions/general?cursor=a");
  for (const unsafe of [null, "", "https://evil.test/", "//evil.test", "/\\evil.test", "javascript:alert(1)", "/ok\nSet-Cookie: x", "/" + "a".repeat(2048)]) {
    assert.equal(safeReturnPath(unsafe), "/appearance");
  }
  assert.equal(safeReturnPath("/games/hollow-creek#thread-post-4"), "/games/hollow-creek#thread-post-4");
});
