import assert from "node:assert/strict";
import test from "node:test";
import {
  HOST_SETUP_ROLE_SMOKE_CONTRACT,
  assertHostSetupWorkflowEvidence,
  expectedHostSetupLayout,
  hostSetupWorkflowEvidenceComplete,
  projectHostSetupWorkflowEvidence,
} from "./frontend_host_setup_proof_contract.mjs";

function geometryBox() {
  return { x: 0, y: 20, width: 300, height: 100 };
}

function validEntries() {
  const contract = HOST_SETUP_ROLE_SMOKE_CONTRACT;
  return contract.viewports.map((viewport) => ({
    role: contract.scenario.role,
    viewport: { ...viewport },
    path: contract.scenario.path,
    surfaceTestId: contract.scenario.surfaceTestId,
    capabilityTestId: contract.scenario.capabilityTestId,
    layout: expectedHostSetupLayout(viewport),
    workflowMode: contract.workflowMode,
    stageIds: [...contract.stageIds],
    defaultSelectedStageId: contract.defaultSelectedStageId,
    correctedStageId: contract.correctedStageId,
    correctionTargets: contract.correctionTargets.map((target) => ({ ...target })),
    noHorizontalOverflow: true,
    overflow: { clientWidth: viewport.width, scrollWidth: viewport.width },
    surfaceBox: geometryBox(),
    capabilityBox: geometryBox(),
    workflowBox: geometryBox(),
    stepperBox: geometryBox(),
    canvasBox: geometryBox(),
    rosterBox: geometryBox(),
    rolesBox: geometryBox(),
    reviewBox: geometryBox(),
    startReviewBox: geometryBox(),
    rosterCards: contract.scenario.slotIds.map((slotId) => ({
      slotId,
      cardBox: geometryBox(),
    })),
    roleCards: contract.scenario.slotIds.map((slotId) => ({
      slotId,
      cardBox: geometryBox(),
    })),
    overlapCheckedTargets: contract.minimumOverlapCheckedTargets,
    screenshot: `target/frontend-role-smoke/${viewport.name}-${contract.scenario.id}.png`,
    screenshotPixels: {
      width: viewport.width,
      height: viewport.height,
      uniqueColorBuckets: contract.screenshotPixels.minimumUniqueColorBuckets,
      changedPixelRatio: contract.screenshotPixels.minimumChangedPixelRatio,
    },
  }));
}

test("host setup proof accepts the exact guided workflow evidence", () => {
  const entries = validEntries();
  assert.equal(hostSetupWorkflowEvidenceComplete(entries), true);
  assert.equal(assertHostSetupWorkflowEvidence(entries), entries);
  assert.deepEqual(
    projectHostSetupWorkflowEvidence(entries).map((entry) => ({
      viewport: entry.viewport,
      layout: entry.layout,
      workflowMode: entry.workflowMode,
      stageIds: entry.stageIds,
      defaultSelectedStageId: entry.defaultSelectedStageId,
      correctedStageId: entry.correctedStageId,
      rosterCardCount: entry.rosterCardCount,
      roleCardCount: entry.roleCardCount,
      correctionTargets: entry.correctionTargets,
      noHorizontalOverflow: entry.noHorizontalOverflow,
    })),
    HOST_SETUP_ROLE_SMOKE_CONTRACT.viewports.map((viewport) => ({
      viewport: viewport.name,
      layout: expectedHostSetupLayout(viewport),
      workflowMode: HOST_SETUP_ROLE_SMOKE_CONTRACT.workflowMode,
      stageIds: [...HOST_SETUP_ROLE_SMOKE_CONTRACT.stageIds],
      defaultSelectedStageId:
        HOST_SETUP_ROLE_SMOKE_CONTRACT.defaultSelectedStageId,
      correctedStageId: HOST_SETUP_ROLE_SMOKE_CONTRACT.correctedStageId,
      rosterCardCount: HOST_SETUP_ROLE_SMOKE_CONTRACT.scenario.slotIds.length,
      roleCardCount: HOST_SETUP_ROLE_SMOKE_CONTRACT.scenario.slotIds.length,
      correctionTargets: HOST_SETUP_ROLE_SMOKE_CONTRACT.correctionTargets.map(
        (target) => ({ ...target }),
      ),
      noHorizontalOverflow: true,
    })),
  );
});

test("host setup proof fails closed on legacy or incomplete evidence", () => {
  const mutations = [
    (entries) => entries.pop(),
    (entries) => entries[0].stageIds.splice(-2, 1),
    (entries) => { entries[0].workflowMode = "legacy-workbench"; },
    (entries) => { entries[1].layout = "stacked"; },
    (entries) => { entries[0].slotCards = []; },
    (entries) => { entries[0].rosterCards[0].slotId = "wrong-slot"; },
    (entries) => { entries[0].roleCards[0].cardBox.width = 0; },
    (entries) => { entries[0].correctionTargets[0].extra = true; },
    (entries) => { entries[0].correctedStageId = "review"; },
    (entries) => { entries[0].overflow.scrollWidth += 2; },
    (entries) => { entries[0].screenshotPixels.changedPixelRatio = 0; },
  ];

  for (const mutate of mutations) {
    const entries = validEntries();
    mutate(entries);
    assert.equal(hostSetupWorkflowEvidenceComplete(entries), false);
  }
});

test("host setup assertion reports the failing evidence field", () => {
  const entries = validEntries();
  entries[0].roleCards[1].cardBox.height = 0;
  assert.throws(
    () => assertHostSetupWorkflowEvidence(entries, { label: "fixture.setup" }),
    /fixture\.setup\[mobile\]\.roleCards\[1\]\.cardBox\.height/u,
  );
});
