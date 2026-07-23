import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HOST_SETUP_WORKFLOW_CONTRACT,
  buildHostSetupWorkflow,
} from "./setup-workflow-model.mjs";

const checks = [
  ["game-created", "Game created", "ready"],
  ["pack-valid", "Pack selected", "ready"],
  ["slots-exist", "Slots exist", "ready"],
  ["slots-occupied", "Slots have occupants", "blocked"],
  ["roles-assigned", "Slots have roles", "blocked"],
  ["policy-acknowledged", "Main post policy acknowledged", "ready"],
  ["start-phase", "Start phase selected", "ready"],
].map(([id, label, state]) => ({ id, label, state }));

test("setup workflow selects the first stage with a fixable blocker", () => {
  const workflow = buildHostSetupWorkflow({
    setupState: { phase: null },
    readiness: { checks, summary: "Setup still needs attention", startAvailable: false },
  });

  assert.deepEqual(
    workflow.stages.map((stage) => [stage.id, stage.state]),
    [
      ["pack", "ready"],
      ["roster", "blocked"],
      ["roles", "blocked"],
      ["rules", "ready"],
      ["program", "ready"],
      ["review", "blocked"],
    ],
  );
  assert.equal(workflow.selectedStageId, "roster");
  assert.equal(workflow.root.data.mode, HOST_SETUP_WORKFLOW_CONTRACT.mode);
  assert.deepEqual(
    workflow.corrections.map((correction) => [correction.checkId, correction.stageId]),
    [["slots-occupied", "roster"], ["roles-assigned", "roles"]],
  );
});

test("setup workflow preserves explicit navigation and routes ready setups to review", () => {
  const readyChecks = checks.map((check) => ({ ...check, state: "ready" }));
  const ready = buildHostSetupWorkflow({
    setupState: { phase: null },
    readiness: { checks: readyChecks, summary: "Ready to start", startAvailable: true },
  });
  assert.equal(ready.selectedStageId, "review");
  assert.equal(ready.stepper.readyCount, 6);
  assert.equal(
    ready.stages.find((stage) => stage.id === "program").statusLabel,
    "Optional",
  );

  const selected = buildHostSetupWorkflow({
    setupState: { phase: null },
    readiness: { checks, startAvailable: false },
    selectedStageId: "rules",
  });
  assert.equal(selected.selectedStageId, "rules");
});

test("started setup marks every stage complete", () => {
  const workflow = buildHostSetupWorkflow({
    setupState: { phase: { phaseId: "D01" } },
    readiness: { checks, startAvailable: false, summary: "Started at D01" },
  });
  assert.equal(workflow.stages.every((stage) => stage.state === "complete"), true);
});
