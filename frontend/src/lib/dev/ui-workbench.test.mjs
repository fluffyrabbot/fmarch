import assert from "node:assert/strict";
import { test } from "node:test";
import {
  UI_WORKBENCH_GROUPS,
  uiWorkbenchDestination,
  uiWorkbenchEnabled,
  uiWorkbenchScenario,
} from "./ui-workbench.mjs";

test("the UI workbench exposes unique deterministic role scenarios", () => {
  const scenarios = UI_WORKBENCH_GROUPS.flatMap((group) => group.scenarios);
  assert.equal(new Set(scenarios.map((scenario) => scenario.id)).size, scenarios.length);
  assert.equal(uiWorkbenchScenario("moderator")?.token, "fixture-host");
  assert.equal(uiWorkbenchDestination({ scenarioId: "admin" }), "/admin?game=midsummer");
});

test("fixture route states preserve existing scenario search parameters", () => {
  assert.equal(
    uiWorkbenchDestination({ scenarioId: "admin", state: "reject" }),
    "/admin?game=midsummer&__fmarch_route_state=reject",
  );
  assert.equal(
    uiWorkbenchDestination({ scenarioId: "player", state: "loading" }),
    "/g/midsummer?__fmarch_route_state=loading",
  );
  assert.equal(uiWorkbenchDestination({ scenarioId: "host-setup", state: "empty" }), null);
  assert.equal(uiWorkbenchDestination({ scenarioId: "missing" }), null);
  assert.equal(uiWorkbenchDestination({ scenarioId: "player", state: "unknown" }), null);
});

test("the workbench requires explicit local fixture mode", () => {
  assert.equal(uiWorkbenchEnabled({ FMARCH_FRONTEND_FIXTURE_SESSION: "1" }), true);
  assert.equal(uiWorkbenchEnabled({ FMARCH_FRONTEND_FIXTURE_SESSION: "0" }), false);
  assert.equal(uiWorkbenchEnabled({}), false);
});
