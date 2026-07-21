import assert from "node:assert/strict";
import { test } from "node:test";
import {
  APP_SURFACE_HEADER_CONTRACT,
  buildAppSurfaceHeaderViewModel,
} from "./app-surface-header-model.mjs";

test("surface header owns role identity and capability touch metadata", () => {
  const header = buildAppSurfaceHeaderViewModel({
    surface: "player",
    eyebrow: "Midsummer Invitational",
    title: "Day 2",
    summary: "Seven votes to hammer. Thread is open.",
    capabilityLabel: "SlotOccupant(slot-7)",
    capabilityTestId: "player-capability",
    liveStatusTestId: "player-live-status",
  });

  assert.equal(header.component, APP_SURFACE_HEADER_CONTRACT.component);
  assert.equal(header.surface, "player");
  assert.equal(header.className, "fm-surface__masthead");
  assert.equal(header.eyebrowClassName, "fm-eyebrow");
  assert.equal(header.statusStackClassName, "fm-status-stack");
  assert.equal(header.eyebrow, "Midsummer Invitational");
  assert.equal(header.title, "Day 2");
  assert.equal(header.summary, "Seven votes to hammer. Thread is open.");
  assert.deepEqual(header.capability, {
    visible: true,
    label: "Playing as slot 7",
    testId: "player-capability",
    className: "fm-capability-pill",
    minTouchTargetPx: 44,
  });
  assert.deepEqual(header.liveStatus, {
    visible: true,
    testId: "player-live-status",
    className: "fm-live-status",
  });
});

test("surface header supports admin surfaces without a live transport slot", () => {
  const header = buildAppSurfaceHeaderViewModel({
    surface: "admin",
    eyebrow: "Admin",
    title: "Operations",
    capabilityLabel: "GlobalAdmin",
    capabilityTestId: "admin-capability",
  });

  assert.equal(header.summary, null);
  assert.deepEqual(header.liveStatus, { visible: false });
  assert.equal(header.capability.minTouchTargetPx, 44);
});

test("surface header builder accepts already-built route view models", () => {
  const header = buildAppSurfaceHeaderViewModel({
    surface: "moderator",
    title: "Host console",
    capabilityLabel: "HostOf(midsummer)",
    capabilityTestId: "host-console-capability",
    liveStatusTestId: "host-live-status",
  });

  assert.equal(buildAppSurfaceHeaderViewModel(header), header);
});

test("surface header fails closed for missing required text", () => {
  assert.throws(
    () => buildAppSurfaceHeaderViewModel({ title: "Operations" }),
    /surface header surface must be a non-empty string/,
  );
  assert.throws(
    () => buildAppSurfaceHeaderViewModel({ surface: "admin" }),
    /surface header title must be a non-empty string/,
  );
});
