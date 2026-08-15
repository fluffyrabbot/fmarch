import assert from "node:assert/strict";
import { test } from "node:test";
import { workosProviderLogoutUrl } from "./workos-provider-logout.mjs";

test("workosProviderLogoutUrl accepts only the canonical backend-minted URL", () => {
  for (const value of [
    "https://api.workos.com/user_management/sessions/logout?session_id=session_a",
    "https://api.workos.com/user_management/sessions/logout?session_id=session_01ABC-xyz",
  ]) {
    assert.equal(workosProviderLogoutUrl(value), value);
  }
});

test("workosProviderLogoutUrl rejects alternate origins, shapes, and parameters", () => {
  for (const value of [
    null,
    undefined,
    "",
    " https://api.workos.com/user_management/sessions/logout?session_id=session_a",
    "http://api.workos.com/user_management/sessions/logout?session_id=session_a",
    "https://attacker.example/user_management/sessions/logout?session_id=session_a",
    "https://user@api.workos.com/user_management/sessions/logout?session_id=session_a",
    "https://api.workos.com:443/user_management/sessions/logout?session_id=session_a",
    "https://api.workos.com:8443/user_management/sessions/logout?session_id=session_a",
    "https://API.WORKOS.COM/user_management/sessions/logout?session_id=session_a",
    "https://api.workos.com/user_management/sessions/logout/?session_id=session_a",
    "https://api.workos.com/user_management/sessions/logout",
    "https://api.workos.com/user_management/sessions/logout?session_id=",
    "https://api.workos.com/user_management/sessions/logout?session_id=other_a",
    "https://api.workos.com/user_management/sessions/logout?session_id=session_a%2Fescape",
    "https://api.workos.com/user_management/sessions/logout?session_id=session_a&session_id=session_b",
    "https://api.workos.com/user_management/sessions/logout?session_id=session_a&return_to=https%3A%2F%2Fevil.example",
    "https://api.workos.com/user_management/sessions/logout?session_id=session_a#fragment",
  ]) {
    assert.equal(workosProviderLogoutUrl(value), null, String(value));
  }
});
