import assert from "node:assert/strict";
import test from "node:test";
import {
  commandFlows,
  commandMockScenarios,
  fixtureApiRoutes,
  flowHookNames,
  flowRestartStepTypes,
  flowStepTypes,
  privateChannelCommandMockScenarios,
} from "./frontend_role_smoke_flows.mjs";
import { roles } from "./frontend_role_smoke_scenarios.mjs";

const ASSEMBLY_STEP_TYPES = new Set([
  "read-attr",
  "read-text",
  "set-from-value",
  "set-result",
]);

function resolveBudgetRef(role, budgetRef) {
  let value = role;
  for (const key of budgetRef.split(".")) {
    value = value?.[key];
  }
  return value;
}

test("every command flow is bound to a declared role", () => {
  const roleIds = new Set(roles.map((role) => role.id));
  for (const flowRole of Object.keys(commandFlows)) {
    assert.ok(roleIds.has(flowRole), `flow role ${flowRole} is not a declared role`);
  }
});

test("flow steps use registered types and resolvable references", () => {
  for (const [flowRole, flow] of Object.entries(commandFlows)) {
    const role = roles.find((candidate) => candidate.id === flowRole);
    const seenIds = new Set();
    const label = (step, index) => `${flowRole} step ${index} (${step.type})`;
    flow.steps.forEach((step, index) => {
      assert.ok(
        flowStepTypes.includes(step.type),
        `${label(step, index)} is not a registered step type`,
      );
      if (step.id !== undefined) {
        assert.ok(!seenIds.has(step.id), `${label(step, index)} reuses id ${step.id}`);
        seenIds.add(step.id);
      }
      for (const refField of ["baselineId", "geometryBaselineId", "interruptedId", "statusRegionId"]) {
        if (step[refField] !== undefined) {
          assert.ok(
            seenIds.has(step[refField]),
            `${label(step, index)} references undefined id ${step[refField]}`,
          );
        }
      }
      for (const refObject of [step.actionIdFrom, step.from]) {
        if (refObject !== undefined) {
          assert.ok(
            seenIds.has(refObject.id),
            `${label(step, index)} references undefined id ${refObject.id}`,
          );
        }
      }
      for (const budgetField of ["budgetRef", "continuityBudgetRef"]) {
        if (step[budgetField] !== undefined) {
          assert.notEqual(
            resolveBudgetRef(role, step[budgetField]),
            undefined,
            `${label(step, index)} ${budgetField} ${step[budgetField]} does not resolve on the ${flowRole} role`,
          );
        }
      }
      if (step.type === "hook") {
        assert.ok(
          flowHookNames.includes(step.name),
          `${label(step, index)} uses unregistered hook ${step.name}`,
        );
      }
      if (step.type === "screenshot") {
        assert.equal(typeof step.name, "string");
        assert.equal(typeof step.labelPrefix, "string");
      }
      if (step.type === "capture-interrupted-recovery") {
        for (const restartStep of step.restartSteps) {
          assert.ok(
            flowRestartStepTypes.includes(restartStep.type),
            `${label(step, index)} restart step type ${restartStep.type} is not allowed`,
          );
        }
      }
      if (step.resultPath !== undefined) {
        assert.ok(
          ASSEMBLY_STEP_TYPES.has(step.type),
          `${label(step, index)} sets resultPath but is not an assembly step`,
        );
      }
    });
  }
});

test("command mock scenarios declare distinct commands with responses", () => {
  for (const scenarios of [commandMockScenarios, privateChannelCommandMockScenarios]) {
    const commands = scenarios.map((scenario) => scenario.command);
    assert.equal(new Set(commands).size, commands.length);
    for (const scenario of scenarios) {
      assert.equal(typeof scenario.respond.kind, "string");
    }
  }
});

test("paginated thread fixture route stays registered last", () => {
  const last = fixtureApiRoutes.at(-1);
  assert.equal(last.pattern, "**/games/*/thread?*before_seq=*");
  const generic = fixtureApiRoutes.find(
    (route) => route.passthroughWhen?.urlIncludes === "before_seq=",
  );
  assert.ok(generic, "generic thread route must pass paginated requests through");
  assert.ok(
    fixtureApiRoutes.indexOf(generic) < fixtureApiRoutes.length - 1,
    "generic thread route must register before the paginated route",
  );
});
