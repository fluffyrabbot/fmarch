import assert from "node:assert/strict";
import { test } from "node:test";
import { authReturnPath, sameOriginAuthPath } from "./auth-return-path.mjs";

test("authReturnPath preserves normalized same-origin application paths", () => {
  for (const [value, expected] of [
    ["/", "/"],
    ["/admin", "/admin"],
    ["/g/game-1/host?tab=queue#now", "/g/game-1/host?tab=queue#now"],
    ["  /g/game 1  ", "/g/game%201"],
  ]) {
    assert.equal(authReturnPath(value), expected, value);
  }
});

test("authReturnPath rejects cross-origin, ambiguous, control, and auth-loop forms", () => {
  for (const value of [
    null,
    undefined,
    42,
    "",
    "   ",
    "admin",
    "https://evil.example/phish",
    "javascript:alert(1)",
    "//evil.example/phish",
    "///evil.example/phish",
    "/\\evil.example/phish",
    "/safe\\evil.example/phish",
    "/%5cevil.example/phish",
    "/%2fevil.example/phish",
    "/safe\nLocation: https://evil.example",
    "/safe\r",
    "/safe\0path",
    "/safe\u007fpath",
    "/safe%0apath",
    "/bad-percent%",
    "/auth",
    "/auth/",
    "/auth/login",
    "/AUTH/login?returnTo=/admin",
    "/auth%2flogin",
    "/safe/../auth/logout",
  ]) {
    assert.equal(authReturnPath(value), "/", String(value));
    assert.equal(sameOriginAuthPath(value), null, String(value));
  }
});

test("only the exact explicitly allowed auth path can cross the sealed callback boundary", () => {
  const options = { allowAuthPath: "/auth/account/security" };
  assert.equal(
    sameOriginAuthPath(
      "/auth/account/security?fmarchWorkosFlow=link&returnTo=%2Fadmin",
      options,
    ),
    "/auth/account/security?fmarchWorkosFlow=link&returnTo=%2Fadmin",
  );
  for (const value of [
    "/auth/account/security/",
    "/auth/account/recovery",
    "/auth/login",
    "/auth%2faccount%2fsecurity",
  ]) {
    assert.equal(sameOriginAuthPath(value, options), null, value);
  }
});
