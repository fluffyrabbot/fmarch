import assert from "node:assert/strict";
import { test } from "node:test";
import { load } from "./+page.server.js";
import {
  buildHostConsoleRouteData,
  hostConsoleForbiddenMessage,
  resolveHostConsoleAccess,
  resolveHostRouteCapabilities,
} from "./host-route-model.mjs";

test("host console route data is allowed for HostOf scoped to the current game", () => {
  const data = buildHostConsoleRouteData({
    game: "midsummer",
    capabilities: [{ kind: "HostOf", game: "midsummer" }],
  });

  assert.equal(data.access.allowed, true);
  assert.equal(data.access.capabilityLabel, "HostOf(midsummer)");
  assert.deepEqual(
    data.criticalActions.map((action) => action.payload.gameId),
    ["midsummer", "midsummer"],
  );
  assert.deepEqual(
    data.criticalActions.map((action) => action.id),
    ["extend_deadline", "process_replacement"],
  );
});

test("host console route data is allowed for CohostOf scoped to the current game", () => {
  const access = resolveHostConsoleAccess({
    game: "midsummer",
    capabilities: [{ kind: "CohostOf", game: "midsummer" }],
  });

  assert.equal(access.allowed, true);
  assert.equal(access.capabilityLabel, "CohostOf(midsummer)");
});

test("host console access rejects missing and wrong-game capabilities", () => {
  assert.equal(
    resolveHostConsoleAccess({
      game: "midsummer",
      capabilities: [],
    }).allowed,
    false,
  );
  assert.equal(
    resolveHostConsoleAccess({
      game: "midsummer",
      capabilities: [{ kind: "HostOf", game: "other-game" }],
    }).allowed,
    false,
  );
  assert.deepEqual(
    resolveHostConsoleAccess({
      game: "midsummer",
      capabilities: [{ kind: "SlotOccupant", game: "midsummer" }],
    }).required,
    ["HostOf(midsummer)", "CohostOf(midsummer)"],
  );
});

test("load returns host shell data when locals carry a resolved host capability", () => {
  const data = load({
    params: { game: "midsummer" },
    locals: {
      principalUserId: "host_h",
      resolvedCapabilities: [{ kind: "HostOf", game: "midsummer" }],
    },
  });

  assert.equal(data.game.id, "midsummer");
  assert.equal(data.access.capabilityLabel, "HostOf(midsummer)");
  assert.equal(data.session.principalUserId, "host_h");
  assert.equal(data.commandEndpoint, "/commands");
});

test("load rejects non-host access before the shell renders", () => {
  assert.throws(
    () =>
      load({
        params: { game: "midsummer" },
        locals: {
          principalUserId: "user_a",
          resolvedCapabilities: [{ kind: "SlotOccupant", game: "midsummer" }],
        },
      }),
    (err) =>
      err.status === 403 &&
      err.body.message === hostConsoleForbiddenMessage("midsummer"),
  );
});

test("load rejects host capability without an authenticated principal", () => {
  assert.throws(
    () =>
      load({
        params: { game: "midsummer" },
        locals: {
          resolvedCapabilities: [{ kind: "HostOf", game: "midsummer" }],
        },
      }),
    (err) =>
      err.status === 403 &&
      err.body.message === "Host console requires an authenticated host session.",
  );
});

test("route model does not grant tablet smoke access by itself", () => {
  const capabilities = resolveHostRouteCapabilities({
    game: "00000000-0000-0000-0000-000000000002",
    locals: {},
  });

  assert.deepEqual(capabilities, []);
});
