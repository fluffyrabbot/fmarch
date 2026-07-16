import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { load } from "./+page.server.js";
import { GET } from "./session/+server.js";

const previousFixtureMode = process.env.FMARCH_FRONTEND_FIXTURE_SESSION;

afterEach(() => {
  if (previousFixtureMode === undefined) {
    delete process.env.FMARCH_FRONTEND_FIXTURE_SESSION;
  } else {
    process.env.FMARCH_FRONTEND_FIXTURE_SESSION = previousFixtureMode;
  }
});

test("the workbench is unavailable outside explicit fixture mode", () => {
  delete process.env.FMARCH_FRONTEND_FIXTURE_SESSION;
  assert.throws(() => load(), (failure) => failure.status === 404);
  assert.throws(
    () => GET(requestContext("http://localhost/_dev/ui/session?scenario=player")),
    (failure) => failure.status === 404,
  );
});

test("the workbench publishes canonical viewports and scenario groups", () => {
  process.env.FMARCH_FRONTEND_FIXTURE_SESSION = "1";
  const data = load();
  assert.deepEqual(data.viewports.map((viewport) => viewport.id), [
    "mobile",
    "tablet",
    "desktop",
  ]);
  assert.ok(data.scenarioGroups.flatMap((group) => group.scenarios).length >= 6);
});

test("session switching writes the fixture cookie and redirects to the real route", () => {
  process.env.FMARCH_FRONTEND_FIXTURE_SESSION = "1";
  const observed = {};
  assert.throws(
    () =>
      GET(
        requestContext(
          "http://localhost/_dev/ui/session?scenario=moderator&state=reject",
          observed,
        ),
      ),
    (failure) =>
      failure.status === 303 &&
      failure.location === "/g/midsummer/host?__fmarch_route_state=reject",
  );
  assert.deepEqual(observed.cookie, {
    name: "fmarch_fixture_session",
    value: "fixture-host",
    options: { path: "/", httpOnly: true, sameSite: "lax", secure: false },
  });
});

test("unknown scenarios return to the workbench without writing a cookie", () => {
  process.env.FMARCH_FRONTEND_FIXTURE_SESSION = "1";
  const observed = {};
  assert.throws(
    () =>
      GET(
        requestContext(
          "http://localhost/_dev/ui/session?scenario=missing",
          observed,
        ),
      ),
    (failure) => failure.status === 303 && failure.location === "/_dev/ui",
  );
  assert.equal(observed.cookie, undefined);
});

function requestContext(href, observed = {}) {
  return {
    url: new URL(href),
    cookies: {
      set(name, value, options) {
        observed.cookie = { name, value, options };
      },
    },
  };
}
