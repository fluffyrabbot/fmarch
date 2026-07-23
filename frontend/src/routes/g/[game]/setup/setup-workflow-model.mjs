export const HOST_SETUP_WORKFLOW_CONTRACT = Object.freeze({
  componentName: "host-setup-workflow",
  mode: "guided-stage-canvas",
  rootTestId: "host-setup-workflow",
  stepperTestId: "host-setup-stepper",
  canvasTestId: "host-setup-stage-canvas",
  stageIds: Object.freeze(["pack", "roster", "roles", "rules", "program", "review"]),
});

const STAGES = Object.freeze([
  Object.freeze({ id: "pack", number: 1, label: "Pack", checkIds: ["game-created", "pack-valid"] }),
  Object.freeze({ id: "roster", number: 2, label: "Roster", checkIds: ["slots-exist", "slots-occupied"] }),
  Object.freeze({ id: "roles", number: 3, label: "Roles", checkIds: ["roles-assigned"] }),
  Object.freeze({ id: "rules", number: 4, label: "Rules", checkIds: ["policy-acknowledged"] }),
  Object.freeze({ id: "program", number: 5, label: "Program", checkIds: [] }),
  Object.freeze({ id: "review", number: 6, label: "Review", checkIds: ["start-phase"] }),
]);

const CHECK_STAGE = Object.freeze({
  "game-created": "pack",
  "pack-valid": "pack",
  "slots-exist": "roster",
  "slots-occupied": "roster",
  "roles-assigned": "roles",
  "policy-acknowledged": "rules",
  "start-phase": "review",
});

export function buildHostSetupWorkflow({
  setupState = {},
  readiness = {},
  selectedStageId = null,
} = {}) {
  const checks = Array.isArray(readiness.checks) ? readiness.checks : [];
  const checkById = new Map(checks.map((check) => [check.id, check]));
  const started = setupState.phase != null;
  const stages = STAGES.map((stage) => buildStage({ stage, checkById, readiness, started }));
  const defaultStage = stages.find((stage) => stage.state === "blocked")?.id ?? "review";
  const resolvedSelectedStageId = stages.some((stage) => stage.id === selectedStageId)
    ? selectedStageId
    : defaultStage;
  const selectedStage = stages.find((stage) => stage.id === resolvedSelectedStageId);
  const corrections = checks
    .filter((check) => check.state !== "ready")
    .map((check) => Object.freeze({
      checkId: check.id,
      label: check.label,
      stageId: CHECK_STAGE[check.id] ?? "review",
      testId: `host-setup-correction-${check.id}`,
    }));
  const readyCount = stages.filter((stage) => stage.state === "ready" || stage.state === "complete").length;

  return Object.freeze({
    root: Object.freeze({
      testId: HOST_SETUP_WORKFLOW_CONTRACT.rootTestId,
      data: Object.freeze({
        component: HOST_SETUP_WORKFLOW_CONTRACT.componentName,
        mode: HOST_SETUP_WORKFLOW_CONTRACT.mode,
      }),
    }),
    stepper: Object.freeze({
      testId: HOST_SETUP_WORKFLOW_CONTRACT.stepperTestId,
      label: "Setup workflow",
      progress: `${readyCount} of ${stages.length} stages ready`,
      readyCount,
      totalCount: stages.length,
    }),
    canvas: Object.freeze({ testId: HOST_SETUP_WORKFLOW_CONTRACT.canvasTestId }),
    stages: Object.freeze(stages),
    selectedStageId: resolvedSelectedStageId,
    selectedStage,
    corrections: Object.freeze(corrections),
    summary: String(readiness.summary ?? "Setup still needs attention"),
    startAvailable: readiness.startAvailable === true,
  });
}

function buildStage({ stage, checkById, readiness, started }) {
  const checks = stage.id === "review"
    ? [...checkById.values()]
    : stage.checkIds.map((id) => checkById.get(id)).filter(Boolean);
  const blockedCount = checks.filter((check) => check.state !== "ready").length;
  const state = started
    ? "complete"
    : stage.id === "program"
      ? "ready"
    : stage.id === "review"
      ? readiness.startAvailable === true ? "ready" : "blocked"
      : blockedCount === 0 && checks.length === stage.checkIds.length ? "ready" : "blocked";
  return Object.freeze({
    ...stage,
    state,
    statusLabel:
      stage.id === "program" && !started
        ? "Optional"
        : state === "complete"
          ? "Complete"
          : state === "ready"
            ? "Ready"
            : `${blockedCount} to fix`,
    testId: `host-setup-step-${stage.id}`,
    panelTestId: `host-setup-stage-${stage.id}`,
  });
}
