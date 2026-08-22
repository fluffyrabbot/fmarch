import assert from "node:assert/strict";
import { test } from "node:test";
import { actions as logoutActions } from "../../routes/auth/logout/+page.server.js";
import { createWorkosCallbackHandler } from "./workos-callback.mjs";

const ENV = Object.freeze({
  WORKOS_CLIENT_ID: "client_test",
  WORKOS_API_KEY: "sk_test_secret",
  WORKOS_REDIRECT_URI: "https://fmarch.example.test/auth/callback",
  WORKOS_COOKIE_PASSWORD: "0123456789abcdef0123456789abcdef",
  FMARCH_API_INTERNAL_URL: "http://fmarch.railway.internal:8080",
});
const PRINCIPAL_ID = "00000000-0000-5000-8000-000000000001";

test("callback exchanges the typed AuthKit result directly for one backend session", async () => {
  const cookies = cookieJar({ "wos-session": "legacy-session" });
  const observed = { callback: null, request: null, logs: [] };
  const authKit = callbackService({ returnPathname: "/admin", accessToken: "provider-token" });
  authKit.onCallback = (request, response, options) => {
    observed.callback = { request, response, options };
  };
  const handler = callbackHandler(authKit, observed.logs);
  const response = await handler(
    callbackEvent({
      cookies,
      url: "https://fmarch.example.test/auth/callback?code=code_a&state=state_a",
      fetchImpl: async (url, init) => {
        observed.request = { url, init };
        return jsonResponse({ principal_id: PRINCIPAL_ID, session_token: "fmss_session-a" });
      },
    }),
  );

  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/admin");
  assert.deepEqual(observed.callback.options, { code: "code_a", state: "state_a" });
  assert.equal(observed.callback.request, cookies);
  assert.equal(observed.callback.response, cookies);
  assert.equal(
    observed.request.url,
    "http://fmarch.railway.internal:8080/auth/sessions",
  );
  assert.equal(observed.request.init.headers.authorization, "Bearer provider-token");
  assert.deepEqual(JSON.parse(observed.request.init.body), { method: "workos" });
  assert.equal(cookies.values.get("fmarch_session"), "fmss_session-a");
  assert.equal(cookies.values.has("wos-session"), false);
  assert.equal(logReason(observed.logs), "session_created");
  assert.equal(observed.logs.join(" ").includes("provider-token"), false);
});

test("callback collapses an unsafe SDK return target before emitting Location", async () => {
  for (const returnPathname of [
    "/\\evil.example/phish",
    "//evil.example/phish",
    "/auth/login?returnTo=/admin",
  ]) {
    const response = await callbackHandler(
      callbackService({ returnPathname }),
      [],
    )(callbackEvent());
    assert.equal(response.headers.get("location"), "/", returnPathname);
  }
});

test("callback preserves a safe provider error code and drops provider descriptions", async () => {
  const cookies = cookieJar();
  const observed = { logs: [] };
  const authKit = callbackService();
  const handler = callbackHandler(authKit, observed.logs);
  const response = await handler(
    callbackEvent({
      cookies,
      url:
        "https://fmarch.example.test/auth/callback?error=access_denied&error_description=private-email%40example.test&state=state_a",
      fetchImpl: async () => assert.fail("provider rejection must not call the API"),
    }),
  );

  assert.equal(response.headers.get("location"), "/auth/login?error=workos_provider_access_denied");
  assert.deepEqual(authKit.cleared, ["state_a"]);
  assert.equal(observed.logs.join(" ").includes("private-email"), false);
  assert.equal(logReason(observed.logs), "provider_access_denied");
});

test("callback rejects missing state before code exchange", async () => {
  const authKit = callbackService();
  const logs = [];
  const response = await callbackHandler(authKit, logs)(
    callbackEvent({ url: "https://fmarch.example.test/auth/callback?code=code_a" }),
  );
  assert.equal(response.headers.get("location"), "/auth/login?error=workos_state_missing");
  assert.equal(authKit.callbackCount, 0);
  assert.deepEqual(authKit.cleared, []);
  assert.equal(logReason(logs), "state_missing");
});

for (const [name, expected] of [
  ["PKCECookieMissingError", "pkce_cookie_missing"],
  ["OAuthStateMismatchError", "state_mismatch"],
]) {
  test(`callback classifies ${name} without exposing the SDK error`, async () => {
    const error = new Error("secret verifier bytes");
    error.name = name;
    const authKit = callbackService({ callbackError: error });
    const logs = [];
    const response = await callbackHandler(authKit, logs)(callbackEvent());
    assert.equal(response.headers.get("location"), `/auth/login?error=workos_${expected}`);
    assert.deepEqual(authKit.cleared, ["state_a"]);
    assert.equal(logReason(logs), expected);
    assert.equal(logs.join(" ").includes("secret verifier bytes"), false);
  });
}

test("callback gives API network, rejection, and malformed responses distinct reasons", async (t) => {
  const cases = [
    {
      name: "network",
      fetchImpl: async () => {
        throw new Error("private network address");
      },
      location: "/auth/login?error=workos_api_unavailable",
      reason: "api_unavailable",
    },
    {
      name: "non-2xx",
      fetchImpl: async () => ({ ok: false, status: 401 }),
      location: "/auth/login?error=workos_api_rejected",
      reason: "api_rejected_401",
    },
    {
      name: "malformed",
      fetchImpl: async () => jsonResponse({ session_token: "not-an-app-session" }),
      location: "/auth/login?error=workos_api_response_malformed",
      reason: "api_response_malformed",
    },
  ];
  for (const item of cases) {
    await t.test(item.name, async () => {
      const logs = [];
      const response = await callbackHandler(
        callbackService({ accessToken: "provider-token" }),
        logs,
      )(callbackEvent({ fetchImpl: item.fetchImpl }));
      assert.equal(response.headers.get("location"), item.location);
      assert.equal(logReason(logs), item.reason);
      assert.equal(logs.join(" ").includes("provider-token"), false);
    });
  }
});

test("callback rejects missing or noncanonical principal IDs from the session API", async (t) => {
  for (const [name, body] of [
    ["missing", { session_token: "fmss_missing-principal" }],
    ["label", { principal_id: "principal_a", session_token: "fmss_label-principal" }],
  ]) {
    await t.test(name, async () => {
      const logs = [];
      const response = await callbackHandler(callbackService(), logs)(
        callbackEvent({ fetchImpl: async () => jsonResponse(body) }),
      );

      assert.equal(response.headers.get("location"), "/auth/login?error=workos_api_response_malformed");
      assert.equal(logReason(logs), "api_response_malformed");
    });
  }
});

test("callback closes an exactly typed tombstoned provider session at WorkOS", async () => {
  const cookies = cookieJar({ "wos-session": "transient-provider-session" });
  const logs = [];
  const providerLogoutUrl =
    "https://api.workos.com/user_management/sessions/logout?session_id=session_recovery_a";
  const response = await callbackHandler(
    callbackService({ accessToken: "provider-token" }),
    logs,
  )(
    callbackEvent({
      cookies,
      fetchImpl: async () =>
        jsonResponse(
          {
            error: "WorkosProviderSessionLogoutRequired",
            provider_logout_url: providerLogoutUrl,
          },
          { ok: false, status: 409 },
        ),
    }),
  );

  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), providerLogoutUrl);
  assert.equal(cookies.values.has("wos-session"), false);
  assert.equal(cookies.values.has("fmarch_session"), false);
  assert.equal(logReason(logs), "provider_session_logout_required");
  assert.equal(logs.join(" ").includes("provider-token"), false);
});

test("callback never treats a near-match tombstone rejection as provider navigation", async (t) => {
  const providerLogoutUrl =
    "https://api.workos.com/user_management/sessions/logout?session_id=session_recovery_a";
  const exactBody = {
    error: "WorkosProviderSessionLogoutRequired",
    provider_logout_url: providerLogoutUrl,
  };
  const cases = [
    {
      name: "wrong status",
      status: 401,
      body: exactBody,
    },
    {
      name: "wrong error",
      status: 409,
      body: { ...exactBody, error: "NotAuthorized" },
    },
    {
      name: "missing URL",
      status: 409,
      body: { error: exactBody.error },
    },
    {
      name: "extra key",
      status: 409,
      body: { ...exactBody, reason: "logout" },
    },
    {
      name: "untrusted URL",
      status: 409,
      body: { ...exactBody, provider_logout_url: "https://attacker.example/logout" },
    },
    {
      name: "non-canonical URL",
      status: 409,
      body: { ...exactBody, provider_logout_url: `${providerLogoutUrl}&return_to=/admin` },
    },
    {
      name: "subject erasure remains generic",
      status: 401,
      body: { error: "NotAuthorized", retryable: false, message: "unauthorized session" },
    },
  ];

  for (const item of cases) {
    await t.test(item.name, async () => {
      const logs = [];
      const response = await callbackHandler(callbackService(), logs)(
        callbackEvent({
          fetchImpl: async () =>
            jsonResponse(item.body, { ok: false, status: item.status }),
        }),
      );

      assert.equal(response.headers.get("location"), "/auth/login?error=workos_api_rejected");
      assert.equal(logReason(logs), `api_rejected_${item.status}`);
    });
  }
});

test("callback keeps malformed 409 recovery bodies local", async (t) => {
  const cases = [
    {
      name: "unreadable JSON",
      response: {
        ok: false,
        status: 409,
        async json() {
          throw new Error("truncated body");
        },
      },
    },
    { name: "null JSON", response: jsonResponse(null, { ok: false, status: 409 }) },
    { name: "array JSON", response: jsonResponse([], { ok: false, status: 409 }) },
  ];

  for (const item of cases) {
    await t.test(item.name, async () => {
      const logs = [];
      const response = await callbackHandler(callbackService(), logs)(
        callbackEvent({ fetchImpl: async () => item.response }),
      );
      assert.equal(response.headers.get("location"), "/auth/login?error=workos_api_rejected");
      assert.equal(logReason(logs), "api_rejected_409");
    });
  }
});

test("callback never sends a provider assertion to an unpinned internal API origin", async () => {
  const logs = [];
  let fetchCalled = false;
  const handler = callbackHandler(callbackService({ accessToken: "provider-token" }), logs, {
    ...ENV,
    FMARCH_API_INTERNAL_URL: "http://attacker.example:8080",
  });
  const response = await handler(
    callbackEvent({
      fetchImpl: async () => {
        fetchCalled = true;
        return jsonResponse({ session_token: "fmss_should-not-exist" });
      },
    }),
  );

  assert.equal(fetchCalled, false);
  assert.equal(response.headers.get("location"), "/auth/login?error=workos_api_unavailable");
  assert.equal(logReason(logs), "api_unavailable");
  assert.equal(logs.join(" ").includes("provider-token"), false);
});

test("callback links WorkOS to an authenticated principal without replacing its session", async () => {
  const cookies = cookieJar({
    fmarch_session: "fmss_classic",
    "wos-session": "legacy-provider-session",
  });
  const logs = [];
  let request;
  const response = await callbackHandler(
    callbackService({
      accessToken: "link-assertion",
      returnPathname:
        "/auth/account/security?fmarchWorkosFlow=link&returnTo=%2Fadmin",
    }),
    logs,
  )(
    callbackEvent({
      cookies,
      fetchImpl: async (url, init) => {
        request = { url, init };
        return jsonResponse({
          status: "attached",
          method_id: "00000000-0000-0000-0000-000000000001",
          principal_id: PRINCIPAL_ID,
          provider_logout_url:
            "https://api.workos.com/user_management/sessions/logout?session_id=session_link_a",
        });
      },
    }),
  );

  assert.equal(
    request.url,
    "http://fmarch.railway.internal:8080/auth/account/methods/workos",
  );
  assert.equal(request.init.headers.authorization, "Bearer fmss_classic");
  assert.deepEqual(JSON.parse(request.init.body), { provider_assertion: "link-assertion" });
  assert.equal(
    response.headers.get("location"),
    "https://api.workos.com/user_management/sessions/logout?session_id=session_link_a",
  );
  assert.equal(cookies.values.get("fmarch_session"), "fmss_classic");
  assert.equal(cookies.values.has("wos-session"), false);
  assert.equal(logReason(logs), "method_linked");
});

test("link callback closes an exactly typed tombstoned provider session at WorkOS", async () => {
  const cookies = cookieJar({
    fmarch_session: "fmss_classic",
    "wos-session": "transient-provider-session",
  });
  const logs = [];
  let attempts = 0;
  const providerLogoutUrl =
    "https://api.workos.com/user_management/sessions/logout?session_id=session_link_recovery_a";
  const response = await callbackHandler(
    callbackService({
      accessToken: "link-assertion",
      returnPathname:
        "/auth/account/security?fmarchWorkosFlow=link&returnTo=%2Fadmin",
    }),
    logs,
  )(
    callbackEvent({
      cookies,
      fetchImpl: async () => {
        attempts += 1;
        return jsonResponse(
          {
            error: "WorkosProviderSessionLogoutRequired",
            provider_logout_url: providerLogoutUrl,
          },
          { ok: false, status: 409 },
        );
      },
    }),
  );

  assert.equal(attempts, 1);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), providerLogoutUrl);
  assert.equal(cookies.values.get("fmarch_session"), "fmss_classic");
  assert.equal(cookies.values.has("wos-session"), false);
  assert.equal(logReason(logs), "link_provider_session_logout_required");
  assert.equal(logs.join(" ").includes("link-assertion"), false);
});

test("link callback keeps nonexact provider-session recovery responses local", async (t) => {
  const providerLogoutUrl =
    "https://api.workos.com/user_management/sessions/logout?session_id=session_link_recovery_a";
  const exactBody = {
    error: "WorkosProviderSessionLogoutRequired",
    provider_logout_url: providerLogoutUrl,
  };
  const cases = [
    {
      name: "wrong status",
      status: 401,
      body: exactBody,
    },
    {
      name: "wrong error",
      status: 409,
      body: { ...exactBody, error: "NotAuthorized" },
    },
    {
      name: "extra key",
      status: 409,
      body: { ...exactBody, message: "logout required" },
    },
    {
      name: "attacker URL",
      status: 409,
      body: {
        ...exactBody,
        provider_logout_url:
          "https://attacker.example/user_management/sessions/logout?session_id=session_link_recovery_a",
      },
    },
  ];

  for (const item of cases) {
    await t.test(item.name, async () => {
      const cookies = cookieJar({ fmarch_session: "fmss_classic" });
      const logs = [];
      let attempts = 0;
      const response = await callbackHandler(
        callbackService({
          accessToken: "link-assertion",
          returnPathname:
            "/auth/account/security?fmarchWorkosFlow=link&returnTo=%2Fadmin",
        }),
        logs,
      )(
        callbackEvent({
          cookies,
          fetchImpl: async () => {
            attempts += 1;
            return jsonResponse(item.body, { ok: false, status: item.status });
          },
        }),
      );

      assert.equal(attempts, 1);
      assert.equal(
        response.headers.get("location"),
        "/auth/account/security?returnTo=%2Fadmin&workosError=rejected",
      );
      assert.equal(cookies.values.get("fmarch_session"), "fmss_classic");
      assert.equal(logReason(logs), "link_api_rejected");
    });
  }
});

test("link callback retries once with the identical request after response loss", async () => {
  const cookies = cookieJar({ fmarch_session: "fmss_classic" });
  const logs = [];
  const requests = [];
  let committed = false;
  const response = await callbackHandler(
    callbackService({
      accessToken: "link-assertion",
      returnPathname:
        "/auth/account/security?fmarchWorkosFlow=link&returnTo=%2Fadmin",
    }),
    logs,
  )(
    callbackEvent({
      cookies,
      fetchImpl: async (url, init) => {
        requests.push({ url, init });
        if (!committed) {
          committed = true;
          throw new Error("response lost after commit");
        }
        return jsonResponse({
          status: "attached",
          method_id: "00000000-0000-0000-0000-000000000001",
          principal_id: PRINCIPAL_ID,
          provider_logout_url:
            "https://api.workos.com/user_management/sessions/logout?session_id=session_link_a",
        });
      },
    }),
  );

  assert.equal(committed, true);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, requests[1].url);
  assert.equal(requests[0].init, requests[1].init);
  assert.equal(requests[0].init.headers.authorization, "Bearer fmss_classic");
  assert.equal(requests[0].init.body, JSON.stringify({ provider_assertion: "link-assertion" }));
  assert.equal(
    response.headers.get("location"),
    "https://api.workos.com/user_management/sessions/logout?session_id=session_link_a",
  );
  assert.deepEqual(
    logs.map((line) => JSON.parse(line)).find((entry) => entry.event === "workos_callback_retry"),
    {
      event: "workos_callback_retry",
      outcome: "retrying",
      reason: "link_api_transport_failure",
    },
  );
  assert.equal(logReason(logs), "method_linked");
  assert.equal(logs.join(" ").includes("link-assertion"), false);
});

test("link callback replays one ambiguous successful response", async (t) => {
  const ambiguousResponses = [
    {
      name: "unreadable body",
      response: {
        ok: true,
        status: 200,
        async json() {
          throw new Error("truncated response body");
        },
      },
    },
    {
      name: "malformed body",
      response: jsonResponse({
        status: "attached",
        method_id: "00000000-0000-0000-0000-000000000001",
        principal_id: PRINCIPAL_ID,
      }),
    },
  ];

  for (const item of ambiguousResponses) {
    await t.test(item.name, async () => {
      const logs = [];
      const requests = [];
      const response = await callbackHandler(
        callbackService({
          accessToken: "link-assertion",
          returnPathname:
            "/auth/account/security?fmarchWorkosFlow=link&returnTo=%2Fadmin",
        }),
        logs,
      )(
        callbackEvent({
          cookies: cookieJar({ fmarch_session: "fmss_classic" }),
          fetchImpl: async (url, init) => {
            requests.push({ url, init });
            if (requests.length === 1) return item.response;
            return jsonResponse({
              status: "attached",
              method_id: "00000000-0000-0000-0000-000000000001",
              principal_id: PRINCIPAL_ID,
              provider_logout_url:
                "https://api.workos.com/user_management/sessions/logout?session_id=session_link_a",
            });
          },
        }),
      );

      assert.equal(requests.length, 2);
      assert.equal(requests[0].url, requests[1].url);
      assert.equal(requests[0].init, requests[1].init);
      assert.equal(
        response.headers.get("location"),
        "https://api.workos.com/user_management/sessions/logout?session_id=session_link_a",
      );
      assert.equal(
        logs.map((line) => JSON.parse(line)).find((entry) => entry.event === "workos_callback_retry")
          ?.reason,
        "link_api_response_malformed",
      );
      assert.equal(logReason(logs), "method_linked");
    });
  }
});

test("link callback stops locally after two malformed successful responses", async () => {
  const logs = [];
  let attempts = 0;
  const response = await callbackHandler(
    callbackService({
      accessToken: "link-assertion",
      returnPathname:
        "/auth/account/security?fmarchWorkosFlow=link&returnTo=%2Fadmin",
    }),
    logs,
  )(
    callbackEvent({
      cookies: cookieJar({ fmarch_session: "fmss_classic" }),
      fetchImpl: async () => {
        attempts += 1;
        if (attempts === 1) {
          return {
            ok: true,
            status: 200,
            async json() {
              throw new Error("truncated response body");
            },
          };
        }
        return jsonResponse({ status: "attached" });
      },
    }),
  );

  assert.equal(attempts, 2);
  assert.equal(
    response.headers.get("location"),
    "/auth/account/security?returnTo=%2Fadmin&workosError=malformed_response",
  );
  assert.equal(logReason(logs), "link_api_response_malformed");
  assert.equal(
    logs.filter((line) => JSON.parse(line).event === "workos_callback_retry").length,
    1,
  );
});

test("link callback rejects a noncanonical principal response", async () => {
  const logs = [];
  let attempts = 0;
  const response = await callbackHandler(
    callbackService({
      accessToken: "link-assertion",
      returnPathname:
        "/auth/account/security?fmarchWorkosFlow=link&returnTo=%2Fadmin",
    }),
    logs,
  )(
    callbackEvent({
      cookies: cookieJar({ fmarch_session: "fmss_classic" }),
      fetchImpl: async () => {
        attempts += 1;
        return jsonResponse({
          status: "attached",
          method_id: "00000000-0000-0000-0000-000000000001",
          principal_id: "principal_a",
          provider_logout_url:
            "https://api.workos.com/user_management/sessions/logout?session_id=session_link_a",
        });
      },
    }),
  );

  assert.equal(attempts, 2);
  assert.equal(
    response.headers.get("location"),
    "/auth/account/security?returnTo=%2Fadmin&workosError=malformed_response",
  );
  assert.equal(logReason(logs), "link_api_response_malformed");
});

test("link callback stops locally after two transport failures", async () => {
  const logs = [];
  let attempts = 0;
  const response = await callbackHandler(
    callbackService({
      accessToken: "link-assertion",
      returnPathname:
        "/auth/account/security?fmarchWorkosFlow=link&returnTo=%2Fadmin",
    }),
    logs,
  )(
    callbackEvent({
      cookies: cookieJar({ fmarch_session: "fmss_classic" }),
      fetchImpl: async () => {
        attempts += 1;
        throw new Error("network unavailable");
      },
    }),
  );

  assert.equal(attempts, 2);
  assert.equal(
    response.headers.get("location"),
    "/auth/account/security?returnTo=%2Fadmin&workosError=unavailable",
  );
  assert.equal(logReason(logs), "link_api_unavailable");
  assert.equal(
    logs.filter((line) => JSON.parse(line).event === "workos_callback_retry").length,
    1,
  );
});

test("link callback never retries a received HTTP rejection", async (t) => {
  for (const status of [409, 503]) {
    await t.test(String(status), async () => {
      const logs = [];
      let attempts = 0;
      const response = await callbackHandler(
        callbackService({
          accessToken: "link-assertion",
          returnPathname:
            "/auth/account/security?fmarchWorkosFlow=link&returnTo=%2Fadmin",
        }),
        logs,
      )(
        callbackEvent({
          cookies: cookieJar({ fmarch_session: "fmss_classic" }),
          fetchImpl: async () => {
            attempts += 1;
            return { ok: false, status };
          },
        }),
      );

      assert.equal(attempts, 1);
      assert.equal(
        response.headers.get("location"),
        "/auth/account/security?returnTo=%2Fadmin&workosError=rejected",
      );
      assert.equal(logReason(logs), "link_api_rejected");
      assert.equal(
        logs.some((line) => JSON.parse(line).event === "workos_callback_retry"),
        false,
      );
    });
  }
});

test("linked identity never navigates to an absent or malformed provider logout URL", async (t) => {
  for (const [name, providerLogoutUrl] of [
    ["missing", undefined],
    ["untrusted", "https://attacker.example/logout?session_id=session_link_a"],
    [
      "caller return",
      "https://api.workos.com/user_management/sessions/logout?session_id=session_link_a&return_to=https%3A%2F%2Fevil.example",
    ],
  ]) {
    await t.test(name, async () => {
      const cookies = cookieJar({ fmarch_session: "fmss_classic" });
      const logs = [];
      let attempts = 0;
      const response = await callbackHandler(
        callbackService({
          accessToken: "link-assertion",
          returnPathname:
            "/auth/account/security?fmarchWorkosFlow=link&returnTo=%2Fadmin",
        }),
        logs,
      )(
        callbackEvent({
          cookies,
          fetchImpl: async () => {
            attempts += 1;
            return jsonResponse({
              status: "attached",
              method_id: "00000000-0000-0000-0000-000000000001",
              principal_id: PRINCIPAL_ID,
              ...(providerLogoutUrl === undefined
                ? {}
                : { provider_logout_url: providerLogoutUrl }),
            });
          },
        }),
      );

      assert.equal(
        response.headers.get("location"),
        "/auth/account/security?returnTo=%2Fadmin&workosError=malformed_response",
      );
      assert.equal(cookies.values.get("fmarch_session"), "fmss_classic");
      assert.equal(attempts, 2);
      assert.equal(logReason(logs), "link_api_response_malformed");
    });
  }
});

test("two WorkOS login/logout/login cycles do not depend on retained AuthKit state", async () => {
  const cookies = cookieJar();
  const callbackResults = [
    { authResponse: { accessToken: "provider-one" }, returnPathname: "/admin" },
    { authResponse: { accessToken: "provider-two" }, returnPathname: "/admin" },
  ];
  const authKit = callbackService();
  authKit.handleCallback = async () => callbackResults.shift();
  const handler = callbackHandler(authKit, []);
  let created = 0;
  const loginFetch = async () => {
    created += 1;
    return jsonResponse({ principal_id: PRINCIPAL_ID, session_token: `fmss_cycle-${created}` });
  };

  const first = await handler(
    callbackEvent({
      cookies,
      url: "https://fmarch.example.test/auth/callback?code=one&state=state_one",
      fetchImpl: loginFetch,
    }),
  );
  assert.equal(first.headers.get("location"), "/admin");
  assert.equal(cookies.values.get("fmarch_session"), "fmss_cycle-1");

  assert.deepEqual(
    await logoutActions.default({
      cookies,
      fetch: async () =>
        jsonResponse({
          status: "logged_out",
          principal_id: PRINCIPAL_ID,
          provider_logout_url:
            "https://api.workos.com/user_management/sessions/logout?session_id=session_one",
        }),
      request: formRequest({ returnTo: "/admin" }),
    }),
    {
      state: "provider_logout",
      providerLogoutUrl:
        "https://api.workos.com/user_management/sessions/logout?session_id=session_one",
    },
  );
  assert.equal(cookies.values.has("fmarch_session"), false);

  const second = await handler(
    callbackEvent({
      cookies,
      url: "https://fmarch.example.test/auth/callback?code=two&state=state_two",
      fetchImpl: loginFetch,
    }),
  );
  assert.equal(second.headers.get("location"), "/admin");
  assert.equal(cookies.values.get("fmarch_session"), "fmss_cycle-2");
  assert.equal(created, 2);
  assert.equal(callbackResults.length, 0);
});

function callbackHandler(authKit, logs, env = ENV) {
  return createWorkosCallbackHandler({
    env,
    loadAuthKitImpl: async () => authKit,
    logger: {
      info(message) {
        logs.push(message);
      },
      warn(message) {
        logs.push(message);
      },
    },
  });
}

function callbackService({
  accessToken = "provider-token",
  returnPathname = "/",
  callbackError = null,
} = {}) {
  return {
    callbackCount: 0,
    cleared: [],
    onCallback: null,
    async handleCallback(request, response, options) {
      this.callbackCount += 1;
      this.onCallback?.(request, response, options);
      if (callbackError !== null) throw callbackError;
      return { authResponse: { accessToken }, returnPathname };
    },
    async clearPendingVerifier(_cookies, { state }) {
      this.cleared.push(state);
    },
  };
}

function callbackEvent({
  cookies = cookieJar(),
  url = "https://fmarch.example.test/auth/callback?code=code_a&state=state_a",
  fetchImpl = async () => jsonResponse({ principal_id: PRINCIPAL_ID, session_token: "fmss_default" }),
} = {}) {
  return { cookies, url: new URL(url), fetch: fetchImpl };
}

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

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, async json() { return body; } };
}

function formRequest(fields) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return new Request("https://fmarch.example.test/auth/logout", {
    method: "POST",
    body: formData,
  });
}

function logReason(logs) {
  const entry = logs.map((line) => JSON.parse(line)).find((item) => item.event === "workos_callback");
  return entry?.reason;
}
