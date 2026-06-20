import assert from "node:assert/strict";
import { test } from "node:test";
import {
  capabilityLabel,
  normalizeCapabilities,
  resolveSurfaceAccess,
} from "./capabilities.mjs";

test("normalizes documented capability vocabulary without ambient roles", () => {
  const capabilities = normalizeCapabilities([
    { kind: "GlobalAdmin" },
    { kind: "GlobalMod" },
    { kind: "HostOf", body: { game: "midsummer" } },
    { kind: "CohostOf", game: "midsummer" },
    { kind: "SlotOccupant", game: "midsummer", slot: "slot-7" },
    { kind: "ChannelMember", body: { game: "midsummer", channel: "main" } },
    { kind: "DeadViewer", game: "midsummer" },
    { kind: "UnknownAmbientAdmin" },
  ]);

  assert.deepEqual(
    capabilities.map((capability) => capability.kind),
    [
      "GlobalAdmin",
      "GlobalMod",
      "HostOf",
      "CohostOf",
      "SlotOccupant",
      "ChannelMember",
      "DeadViewer",
    ],
  );
  assert.equal(capabilityLabel(capabilities[2]), "HostOf(midsummer)");
});

test("role surface access is explicit and scoped", () => {
  assert.equal(
    resolveSurfaceAccess({
      surface: "admin",
      capabilities: [{ kind: "GlobalAdmin" }],
    }).allowed,
    true,
  );
  assert.equal(
    resolveSurfaceAccess({
      surface: "moderator",
      game: "midsummer",
      capabilities: [{ kind: "HostOf", game: "other" }],
    }).allowed,
    false,
  );
  assert.equal(
    resolveSurfaceAccess({
      surface: "player",
      game: "midsummer",
      capabilities: [{ kind: "ChannelMember", game: "midsummer", channel: "main" }],
    }).capabilityLabel,
    "ChannelMember(midsummer)",
  );
  assert.equal(
    resolveSurfaceAccess({
      surface: "player",
      game: "midsummer",
      capabilities: [{ kind: "DeadViewer", game: "midsummer" }],
    }).capabilityLabel,
    "DeadViewer(midsummer)",
  );
});
