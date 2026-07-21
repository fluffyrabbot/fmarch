import assert from "node:assert/strict";
import test from "node:test";
import { load } from "./+page.server.js";

test("GlobalMod queue loads typed summaries and a selected audit detail", async () => {
  const requests = [];
  const data = await load({
    cookies: { get: () => "moderator-session" },
    locals: {
      principalUserId: "moderator_a",
      resolvedCapabilities: [{ kind: "GlobalMod", source: "auth-session" }],
    },
    url: new URL("http://localhost/moderation?status=all&case=case-1"),
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (String(url).includes("/moderation/cases?")) {
        return Response.json({ cases: [{ case_id: "case-1", status: "open" }], next_cursor: null });
      }
      return Response.json({ case: { case_id: "case-1", status: "open" }, reports: [], history: [] });
    },
  });
  assert.equal(data.shell.activeSurface, "moderator");
  assert.equal(data.moderation.cases[0].case_id, "case-1");
  assert.equal(data.moderation.detail.case.status, "open");
  assert.equal(requests.length, 2);
  assert.equal(requests[0].options.headers.authorization, "Bearer moderator-session");
});

test("member without GlobalMod cannot load the queue", async () => {
  await assert.rejects(
    load({
      cookies: { get: () => "member-session" },
      locals: { principalUserId: "member", resolvedCapabilities: [] },
      url: new URL("http://localhost/moderation"),
      fetch: async () => { throw new Error("unreachable"); },
    }),
    (error) => error?.status === 403,
  );
});
