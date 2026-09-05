import assert from "node:assert/strict";
import {
  HOST_SETUP_WORKFLOW_CONTRACT,
} from "../frontend/src/routes/g/[game]/setup/setup-workflow-model.mjs";
import {
  hostSetupScenario,
  setupViewports,
} from "./frontend_role_smoke_scenarios.mjs";

const correctionTargets = Object.freeze([
  Object.freeze({ checkId: "slots-occupied", stageId: "roster" }),
  Object.freeze({ checkId: "roles-assigned", stageId: "roles" }),
]);

export const HOST_SETUP_ROLE_SMOKE_CONTRACT = Object.freeze({
  workflowMode: HOST_SETUP_WORKFLOW_CONTRACT.mode,
  stageIds: HOST_SETUP_WORKFLOW_CONTRACT.stageIds,
  scenario: hostSetupScenario,
  viewports: setupViewports,
  responsiveLayout: Object.freeze({
    stackedMaxWidthPx: 820,
    stacked: "stacked",
    expanded: "stepper-canvas",
  }),
  defaultSelectedStageId: correctionTargets[0].stageId,
  correctedStageId: correctionTargets[1].stageId,
  correctionTargets,
  minimumOverlapCheckedTargets: 3,
  screenshotPixels: Object.freeze({
    minimumUniqueColorBuckets: 8,
    minimumChangedPixelRatio: 0.005,
  }),
});

export function expectedHostSetupLayout(viewport) {
  return viewport.width <=
    HOST_SETUP_ROLE_SMOKE_CONTRACT.responsiveLayout.stackedMaxWidthPx
    ? HOST_SETUP_ROLE_SMOKE_CONTRACT.responsiveLayout.stacked
    : HOST_SETUP_ROLE_SMOKE_CONTRACT.responsiveLayout.expanded;
}

export function assertHostSetupWorkflowEvidence(
  setupEntries,
  { label = "roleSmoke.setup" } = {},
) {
  assert.equal(Array.isArray(setupEntries), true, `${label} must be an array`);
  assert.equal(
    setupEntries.length,
    HOST_SETUP_ROLE_SMOKE_CONTRACT.viewports.length,
    `${label} must contain exactly the contracted setup viewports`,
  );

  for (const viewport of HOST_SETUP_ROLE_SMOKE_CONTRACT.viewports) {
    const matches = setupEntries.filter(
      (entry) => entry?.viewport?.name === viewport.name,
    );
    assert.equal(
      matches.length,
      1,
      `${label} must contain exactly one ${viewport.name} entry`,
    );
    assertHostSetupWorkflowEntry(matches[0], viewport, {
      label: `${label}[${viewport.name}]`,
    });
  }

  return setupEntries;
}

export function hostSetupWorkflowEvidenceComplete(setupEntries) {
  try {
    assertHostSetupWorkflowEvidence(setupEntries);
    return true;
  } catch (error) {
    if (error instanceof assert.AssertionError) {
      return false;
    }
    throw error;
  }
}

export function projectHostSetupWorkflowEvidence(setupEntries) {
  if (!Array.isArray(setupEntries)) {
    return [];
  }
  return setupEntries.map((entry) => ({
    viewport: entry?.viewport?.name ?? "unknown",
    layout: entry?.layout ?? "unknown",
    workflowMode: entry?.workflowMode ?? "unknown",
    stageIds: Array.isArray(entry?.stageIds) ? [...entry.stageIds] : [],
    defaultSelectedStageId: entry?.defaultSelectedStageId ?? null,
    correctedStageId: entry?.correctedStageId ?? null,
    screenshot: entry?.screenshot ?? null,
    rosterCardCount: Array.isArray(entry?.rosterCards)
      ? entry.rosterCards.length
      : 0,
    roleCardCount: Array.isArray(entry?.roleCards) ? entry.roleCards.length : 0,
    correctionTargets: Array.isArray(entry?.correctionTargets)
      ? entry.correctionTargets.map((target) => ({ ...target }))
      : [],
    noHorizontalOverflow: entry?.noHorizontalOverflow === true,
  }));
}

function assertHostSetupWorkflowEntry(entry, viewport, { label }) {
  const scenario = HOST_SETUP_ROLE_SMOKE_CONTRACT.scenario;
  assert.equal(entry?.role, scenario.role, `${label}.role`);
  assert.equal(entry.path, scenario.path, `${label}.path`);
  assert.equal(
    entry.surfaceTestId,
    scenario.surfaceTestId,
    `${label}.surfaceTestId`,
  );
  assert.equal(
    entry.capabilityTestId,
    scenario.capabilityTestId,
    `${label}.capabilityTestId`,
  );
  assert.deepEqual(entry.viewport, viewport, `${label}.viewport`);
  assert.equal(
    entry.workflowMode,
    HOST_SETUP_ROLE_SMOKE_CONTRACT.workflowMode,
    `${label}.workflowMode`,
  );
  assert.deepEqual(
    entry.stageIds,
    HOST_SETUP_ROLE_SMOKE_CONTRACT.stageIds,
    `${label}.stageIds`,
  );
  assert.equal(entry.layout, expectedHostSetupLayout(viewport), `${label}.layout`);
  assert.equal(
    entry.defaultSelectedStageId,
    HOST_SETUP_ROLE_SMOKE_CONTRACT.defaultSelectedStageId,
    `${label}.defaultSelectedStageId`,
  );
  assert.equal(
    entry.correctedStageId,
    HOST_SETUP_ROLE_SMOKE_CONTRACT.correctedStageId,
    `${label}.correctedStageId`,
  );
  assert.deepEqual(
    entry.correctionTargets,
    HOST_SETUP_ROLE_SMOKE_CONTRACT.correctionTargets,
    `${label}.correctionTargets`,
  );
  assert.equal("slotCards" in entry, false, `${label} retains legacy slotCards`);
  assertCardEvidence(entry.rosterCards, `${label}.rosterCards`);
  assertCardEvidence(entry.roleCards, `${label}.roleCards`);

  assert.equal(
    entry.noHorizontalOverflow,
    true,
    `${label}.noHorizontalOverflow`,
  );
  assert.deepEqual(
    Object.keys(entry.overflow ?? {}).sort(),
    ["clientWidth", "scrollWidth"],
    `${label}.overflow fields`,
  );
  assert.equal(
    Number.isFinite(entry.overflow.clientWidth) && entry.overflow.clientWidth > 0,
    true,
    `${label}.overflow.clientWidth`,
  );
  assert.equal(
    Number.isFinite(entry.overflow.scrollWidth) && entry.overflow.scrollWidth > 0,
    true,
    `${label}.overflow.scrollWidth`,
  );
  assert.equal(
    entry.overflow.scrollWidth <= entry.overflow.clientWidth + 1,
    true,
    `${label} has horizontal overflow`,
  );

  for (const boxName of [
    "surfaceBox",
    "capabilityBox",
    "workflowBox",
    "stepperBox",
    "canvasBox",
    "rosterBox",
    "rolesBox",
    "reviewBox",
    "startReviewBox",
  ]) {
    assertGeometryBox(entry[boxName], `${label}.${boxName}`);
  }
  assert.equal(
    Number.isInteger(entry.overlapCheckedTargets) &&
      entry.overlapCheckedTargets >=
        HOST_SETUP_ROLE_SMOKE_CONTRACT.minimumOverlapCheckedTargets,
    true,
    `${label}.overlapCheckedTargets`,
  );

  assert.equal(
    typeof entry.screenshot === "string" &&
      entry.screenshot.endsWith(`${viewport.name}-${scenario.id}.png`),
    true,
    `${label}.screenshot`,
  );
  const screenshotPixels = entry.screenshotPixels ?? {};
  assert.equal(screenshotPixels.width, viewport.width, `${label}.screenshotPixels.width`);
  assert.equal(
    Number.isInteger(screenshotPixels.height) &&
      screenshotPixels.height >= viewport.height,
    true,
    `${label}.screenshotPixels.height`,
  );
  assert.equal(
    screenshotPixels.uniqueColorBuckets >=
      HOST_SETUP_ROLE_SMOKE_CONTRACT.screenshotPixels.minimumUniqueColorBuckets,
    true,
    `${label}.screenshotPixels.uniqueColorBuckets`,
  );
  assert.equal(
    screenshotPixels.changedPixelRatio >=
      HOST_SETUP_ROLE_SMOKE_CONTRACT.screenshotPixels.minimumChangedPixelRatio,
    true,
    `${label}.screenshotPixels.changedPixelRatio`,
  );
}

function assertCardEvidence(cards, label) {
  assert.equal(Array.isArray(cards), true, `${label} must be an array`);
  assert.deepEqual(
    cards.map((card) => card?.slotId),
    HOST_SETUP_ROLE_SMOKE_CONTRACT.scenario.slotIds,
    `${label} slot ids`,
  );
  for (const [index, card] of cards.entries()) {
    assert.deepEqual(
      Object.keys(card ?? {}).sort(),
      ["cardBox", "slotId"],
      `${label}[${index}] fields`,
    );
    assertGeometryBox(card.cardBox, `${label}[${index}].cardBox`);
  }
}

function assertGeometryBox(box, label) {
  assert.deepEqual(
    Object.keys(box ?? {}).sort(),
    ["height", "width", "x", "y"],
    `${label} fields`,
  );
  assert.equal(Number.isFinite(box.x), true, `${label}.x`);
  assert.equal(Number.isFinite(box.y), true, `${label}.y`);
  assert.equal(
    Number.isFinite(box.width) && box.width > 0,
    true,
    `${label}.width`,
  );
  assert.equal(
    Number.isFinite(box.height) && box.height > 0,
    true,
    `${label}.height`,
  );
}
