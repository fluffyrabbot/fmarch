import assert from "node:assert/strict";
import test from "node:test";
import {
  HOST_SETUP_ROLE_SMOKE_CONTRACT,
  expectedHostSetupLayout,
} from "./frontend_host_setup_proof_contract.mjs";
import {
  assertBrowserRoleSmokeEvidence,
  adminBrowserOperationalEvidenceComplete,
  browserRoleSmokeEvidenceComplete,
  liveRoleSmokeThumbZoneEvidenceComplete,
  liveRoleSmokeThumbZoneExpectations,
  moderatorBrowserSlotLifecycleEvidenceComplete,
  playerBrowserMediaEvidenceComplete,
  playerBrowserPostEvidenceComplete,
  playerPrivateChannelBrowserPostEvidenceComplete,
} from "./frontend_role_smoke_evidence_contract.mjs";
import {
  boardScenario,
  browserRoleScenario,
  forbiddenRoutes,
  roles,
  routeStateScenarios,
  viewports,
} from "./frontend_role_smoke_scenarios.mjs";

test("browser role-smoke contract accepts exact live evidence", () => {
  const evidence = validRoleSmoke();
  assert.equal(browserRoleSmokeEvidenceComplete(evidence), true);
  assert.equal(assertBrowserRoleSmokeEvidence(evidence), evidence);
  assert.equal(liveRoleSmokeThumbZoneEvidenceComplete(evidence), true);
  assert.equal(adminBrowserOperationalEvidenceComplete(evidence), true);
  assert.equal(playerBrowserPostEvidenceComplete(evidence), true);
  assert.equal(playerPrivateChannelBrowserPostEvidenceComplete(evidence), true);
  assert.equal(playerBrowserMediaEvidenceComplete(evidence), true);
  assert.equal(moderatorBrowserSlotLifecycleEvidenceComplete(evidence), true);
  assert.deepEqual(
    liveRoleSmokeThumbZoneExpectations().find(({ role }) => role === "admin")
      ?.zones.map(({ testId, targetCount }) => [testId, targetCount]),
    [
      ["admin-setup-action-zone", 1],
      ["admin-recovery-action-zone", 1],
    ],
  );
});

test("browser role-smoke contract fails closed on structural drift", () => {
  const mutations = [
    {
      label: "source did not pass",
      mutate: (evidence) => {
        evidence.status = "static-fallback-passed";
      },
    },
    {
      label: "viewport dimensions drifted",
      mutate: (evidence) => {
        evidence.viewports[1].width += 1;
      },
    },
    {
      label: "role viewport is missing",
      mutate: (evidence) => {
        evidence.roles.splice(
          evidence.roles.findIndex(
            (entry) =>
              entry.role === "player" && entry.viewport.name === "tablet",
          ),
          1,
        );
      },
    },
    {
      label: "live role path drifted",
      mutate: (evidence) => {
        roleEntry(evidence, "admin").path = "/admin";
      },
    },
    {
      label: "setup lost the program stage",
      mutate: (evidence) => {
        evidence.setup[0].stageIds = evidence.setup[0].stageIds.filter(
          (stageId) => stageId !== "program",
        );
      },
    },
    {
      label: "setup responsive layout drifted",
      mutate: (evidence) => {
        evidence.setup[1].layout = "stacked";
      },
    },
    {
      label: "route-state path drifted",
      mutate: (evidence) => {
        evidence.routeStates[0].path = "/wrong";
      },
    },
    {
      label: "forbidden route coverage is incomplete",
      mutate: (evidence) => {
        evidence.forbidden.pop();
      },
    },
  ];

  for (const { label, mutate } of mutations) {
    const evidence = validRoleSmoke();
    mutate(evidence);
    assert.equal(browserRoleSmokeEvidenceComplete(evidence), false, label);
  }
});

test("live admin evidence rejects static, legacy, and non-native substitutes", () => {
  const mutations = [
    {
      label: "static admin setup thumb count",
      mutate: (admin) => {
        admin.thumbZones[0].targetCount = 2;
        admin.thumbZones[0].targets.push({ selector: "legacy-cohost" });
      },
    },
    {
      label: "legacy cohost and recovery-only evidence",
      mutate: (admin) => {
        admin.commandResult = {
          cohost: {
            focus: {
              initialFocus: { testId: "admin-command-confirm-cohost" },
            },
          },
          recovery: { state: "ack" },
        };
      },
    },
    {
      label: "legacy admin paradigm",
      mutate: (admin) => {
        admin.roleParadigm.mode = "setup-and-recovery-columns";
      },
    },
    {
      label: "wrong responsive canvas layout",
      mutate: (admin) => {
        admin.roleParadigm.layout = "queue-canvas";
      },
    },
    {
      label: "audit link is not the proof-runs detail route",
      mutate: (admin) => {
        admin.linkAffordances[0].hrefPath = "/admin";
      },
    },
    {
      label: "audit click proof omitted native machine-evidence href",
      mutate: (admin) => {
        admin.linkClickProofs[0].evidenceHref = null;
      },
    },
  ];

  for (const { label, mutate } of mutations) {
    const evidence = validRoleSmoke();
    mutate(roleEntry(evidence, "admin"));
    assert.equal(adminBrowserOperationalEvidenceComplete(evidence), false, label);
    assert.equal(browserRoleSmokeEvidenceComplete(evidence), false, label);
  }
});

test("player and moderator component predicates reject lost operational proof", () => {
  const cases = [
    {
      label: "player main post body",
      predicate: playerBrowserPostEvidenceComplete,
      mutate: (evidence) => {
        roleEntry(evidence, "player").commandResult.postCommand.requestCommand.body =
          "wrong";
      },
    },
    {
      label: "player private channel path",
      predicate: playerPrivateChannelBrowserPostEvidenceComplete,
      mutate: (evidence) => {
        evidence.playerPrivateChannel[0].path = "/g/midsummer";
      },
    },
    {
      label: "player media requested original",
      predicate: playerBrowserMediaEvidenceComplete,
      mutate: (evidence) => {
        roleEntry(evidence, "player").commandResult.media.requestedOriginal = true;
      },
    },
    {
      label: "moderator lifecycle did not ack",
      predicate: moderatorBrowserSlotLifecycleEvidenceComplete,
      mutate: (evidence) => {
        roleEntry(evidence, "moderator").commandResult.slotLifecycle.state =
          "reject";
      },
    },
  ];

  for (const { label, predicate, mutate } of cases) {
    const evidence = validRoleSmoke();
    mutate(evidence);
    assert.equal(predicate(evidence), false, label);
    assert.equal(browserRoleSmokeEvidenceComplete(evidence), false, label);
  }
});

test("browser role-smoke assertion reports the failing component", () => {
  const evidence = validRoleSmoke();
  roleEntry(evidence, "admin").roleParadigm.visibleCanvasCount = 2;
  assert.throws(
    () => assertBrowserRoleSmokeEvidence(evidence, { label: "fixture" }),
    /fixture\.roles admin operational evidence drifted/u,
  );
});

function validRoleSmoke() {
  return {
    status: "passed",
    viewports: viewports.map((viewport) => ({ ...viewport })),
    board: viewports.map((viewport) => ({
      scenario: boardScenario.id,
      viewport: { ...viewport },
      path: boardScenario.path,
      focusTraversal: focusTraversal(),
      overlapCheckedTargets: 1,
      ...screenshotEvidence(viewport, `${viewport.name}-${boardScenario.id}`),
    })),
    setup: validHostSetupEvidence(),
    roles: viewports.flatMap((viewport) =>
      roles.map((role) => validRoleEntry(browserRoleScenario(role), viewport)),
    ),
    playerPrivateChannel: viewports.map(validPrivateChannelEntry),
    routeStates: viewports.flatMap((viewport) =>
      routeStateScenarios.map((scenario) => ({
        scenario: scenario.id,
        role: scenario.role,
        viewport: { ...viewport },
        path: scenario.path,
        focusTraversal: focusTraversal(),
        overlapCheckedTargets: 1,
        ...screenshotEvidence(
          viewport,
          `${viewport.name}-route-state-${scenario.id}`,
        ),
      })),
    ),
    forbidden: viewports.flatMap((viewport) =>
      forbiddenRoutes.map((scenario) => ({
        role: "forbidden",
        scenario: scenario.id,
        viewport: { ...viewport },
        path: scenario.path,
        status: scenario.status,
        overlapCheckedTargets: 1,
        ...screenshotEvidence(
          viewport,
          `${viewport.name}-forbidden-${scenario.id}`,
        ),
      })),
    ),
  };
}

function validRoleEntry(scenario, viewport) {
  const base = {
    role: scenario.id,
    viewport: { ...viewport },
    path: scenario.path,
    capability: `Capability for ${scenario.id}`,
    focusTraversal: focusTraversal(),
    overlapCheckedTargets: 1,
    thumbZones: scenario.thumbZones.map((zone) => ({
      testId: zone.testId,
      thumbZone: zone.zone,
      targetCount: zone.targetSelectors.length,
      targets: zone.targetSelectors.map((selector) => ({ selector })),
    })),
    ...screenshotEvidence(viewport, `${viewport.name}-${scenario.id}`),
  };
  if (scenario.id === "admin") {
    return { ...base, ...validAdminEvidence(scenario, viewport) };
  }
  if (scenario.id === "player") {
    return { ...base, commandResult: validPlayerCommandResult() };
  }
  return { ...base, commandResult: validModeratorCommandResult() };
}

function validAdminEvidence(scenario, viewport) {
  const layout = viewport.width <= 820 ? "stacked" : "queue-canvas";
  const queueBox = geometryBox({ x: 0, y: 20, width: 260, height: 100 });
  const canvasBox =
    layout === "stacked"
      ? geometryBox({ x: 0, y: 120, width: 300, height: 100 })
      : geometryBox({ x: 260, y: 20, width: 300, height: 100 });
  return {
    commandResult: null,
    roleParadigm: {
      mode: "exception-inbox-decision-canvas",
      initialCanvasCount: 1,
      visibleCanvasCount: 1,
      selectedTaskId: "admin-inbox-task-setup-host-setup",
      taskCount: 5,
      layout,
      expectedLayout: layout,
      noHorizontalOverflow: true,
      inboxBox: geometryBox(),
      queueBox,
      canvasBox,
    },
    linkAffordances: scenario.linkAffordances.map((link) => ({
      testId: link.testId,
      hrefPath: link.hrefPath,
      searchParams: { ...link.searchParams },
    })),
    linkClickProofs: [
      {
        testId: "admin-audit-link-proof-runs",
        path: "/admin/audit/proof-runs",
        searchParams: { game: "midsummer" },
        surfaceTestId: "admin-audit-detail-surface",
        auditId: "proof-runs",
        capability: "Site administrator",
        statusRegion: {
          state: "ack",
          role: "status",
          ariaLive: "polite",
          ariaAtomic: "true",
        },
        evidenceTestId: "admin-audit-detail-evidence",
        evidenceHref: "/games/midsummer/operator/proof-runs",
        backTestId: "admin-audit-detail-back",
        backHref: "/admin?game=midsummer",
        overlapCheckedTargets: 2,
        viewport: { ...viewport },
        ...screenshotEvidence(
          viewport,
          `${viewport.name}-admin-audit-detail-proof-runs`,
        ),
      },
    ],
  };
}

function validPlayerCommandResult() {
  return {
    postCommandReceipt: { state: "ack" },
    postCommand: {
      state: "ack",
      requestCommand: {
        game: "midsummer",
        channel_id: "main",
        actor_slot: "slot-7",
        body: "Browser smoke player post",
      },
      refreshedPostTestId: "thread-post-445",
    },
    media: validPlayerMedia(),
  };
}

function validPrivateChannelEntry(viewport) {
  return {
    role: "player-private-channel",
    viewport: { ...viewport },
    path: "/g/midsummer/c/private%3Arole_pm%3Aslot-7",
    activeChannelTestId: "player-channel-private:role_pm:slot-7",
    privateReviewHref:
      "/g/midsummer/c/private%3Arole_pm%3Aslot-7?private=notification-1",
    focusTraversal: focusTraversal(),
    overlapCheckedTargets: 1,
    commandResult: {
      state: "ack",
      receipt: { state: "ack" },
      requestCommand: {
        game: "midsummer",
        channel_id: "private:role_pm:slot-7",
        actor_slot: "slot-7",
        body: "Browser smoke private:role_pm:slot-7 post",
      },
      refreshedPostTestId: "thread-post-446",
    },
    media: validPlayerMedia(),
    ...screenshotEvidence(viewport, `${viewport.name}-player-private-channel`),
  };
}

function validPlayerMedia() {
  return {
    boundaryTestId: "thread-post-media-boundary-442",
    mediaTestId:
      "thread-post-media-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    renderedVariant: "tablet",
    requestedOriginal: false,
    requested: [
      {
        url: "/media/midsummer/thread/receipt-442-tablet.png",
        variant: "tablet",
        resourceType: "image",
      },
    ],
    image: { complete: true, naturalWidth: 2, naturalHeight: 2 },
  };
}

function validModeratorCommandResult() {
  return {
    slotLifecycle: {
      actionId: "modkill_slot",
      state: "ack",
      requestCommand: {
        SetSlotStatus: {
          game: "midsummer",
          slot: "slot-7",
          status: "modkilled",
        },
      },
      projection: { lifecycleLabel: "Modkilled" },
    },
  };
}

function validHostSetupEvidence() {
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
    ...screenshotEvidence(viewport, `${viewport.name}-${contract.scenario.id}`),
  }));
}

function roleEntry(evidence, role, viewport = "mobile") {
  return evidence.roles.find(
    (entry) => entry.role === role && entry.viewport.name === viewport,
  );
}

function focusTraversal() {
  return { focusedTestIds: ["focusable-control"] };
}

function screenshotEvidence(viewport, name) {
  return {
    screenshot: `target/frontend-role-smoke/${name}.png`,
    screenshotPixels: {
      width: viewport.width,
      height: viewport.height,
      uniqueColorBuckets: 8,
      changedPixelRatio: 0.005,
    },
  };
}

function geometryBox(overrides = {}) {
  return { x: 0, y: 20, width: 300, height: 100, ...overrides };
}
