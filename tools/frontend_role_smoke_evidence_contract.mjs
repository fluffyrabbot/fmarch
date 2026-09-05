import assert from "node:assert/strict";
import {
  ADMIN_OPERATOR_INBOX_CONTRACT,
} from "../frontend/src/routes/admin/admin-operator-inbox.mjs";
import {
  hostSetupWorkflowEvidenceComplete,
} from "./frontend_host_setup_proof_contract.mjs";
import {
  boardScenario,
  browserRoleScenario,
  forbiddenRoutes,
  roles,
  routeStateScenarios,
  viewports,
} from "./frontend_role_smoke_scenarios.mjs";

const liveRoleScenarios = Object.freeze(roles.map(browserRoleScenario));
const privateChannelContract = Object.freeze({
  role: "player-private-channel",
  path: "/g/midsummer/c/private%3Arole_pm%3Aslot-7",
  activeChannelTestId: "player-channel-private:role_pm:slot-7",
  privateReviewHref:
    "/g/midsummer/c/private%3Arole_pm%3Aslot-7?private=notification-1",
});
const adminAuditDetailContract = Object.freeze({
  selectedTaskId: "admin-inbox-task-setup-host-setup",
  linkTestId: "admin-audit-link-proof-runs",
  path: "/admin/audit/proof-runs",
  searchParams: Object.freeze({ game: "midsummer" }),
  surfaceTestId: "admin-audit-detail-surface",
  auditId: "proof-runs",
  capability: "Site administrator",
  evidenceTestId: "admin-audit-detail-evidence",
  evidenceHref: "/games/midsummer/operator/proof-runs",
  backTestId: "admin-audit-detail-back",
  backHref: "/admin?game=midsummer",
});
const allowedPlayerMediaVariants = Object.freeze([
  "tablet",
  "small",
  "thumb",
  "thumbnail",
]);

export const LIVE_ROLE_SMOKE_EVIDENCE_CONTRACT = Object.freeze({
  viewports,
  roles: liveRoleScenarios,
  privateChannel: privateChannelContract,
  admin: Object.freeze({
    inbox: ADMIN_OPERATOR_INBOX_CONTRACT,
    auditDetail: adminAuditDetailContract,
  }),
});

export function liveRoleSmokeThumbZoneExpectations() {
  return liveRoleScenarios.map((scenario) => ({
    role: scenario.id,
    zones: (scenario.thumbZones ?? []).map((zone) => ({
      testId: zone.testId,
      thumbZone: zone.zone,
      targetCount: zone.targetSelectors.length,
    })),
  }));
}

export function assertBrowserRoleSmokeEvidence(
  roleSmoke,
  { label = "roleSmoke" } = {},
) {
  assert.equal(roleSmoke?.status, "passed", `${label}.status`);
  assert.equal(
    exactViewportList(roleSmoke.viewports),
    true,
    `${label}.viewports must exactly match the browser viewport contract`,
  );
  assert.equal(
    boardEvidenceComplete(roleSmoke),
    true,
    `${label}.board evidence drifted`,
  );
  assert.equal(
    hostSetupWorkflowEvidenceComplete(roleSmoke.setup),
    true,
    `${label}.setup evidence drifted`,
  );
  assert.equal(
    exactRoleSurfaceEvidenceComplete(roleSmoke),
    true,
    `${label}.roles must exactly cover every live role and viewport`,
  );
  assert.equal(
    routeStateEvidenceComplete(roleSmoke),
    true,
    `${label}.routeStates evidence drifted`,
  );
  assert.equal(
    forbiddenRouteEvidenceComplete(roleSmoke),
    true,
    `${label}.forbidden evidence drifted`,
  );
  assert.equal(
    liveRoleSmokeThumbZoneEvidenceComplete(roleSmoke),
    true,
    `${label}.roles thumb-zone evidence drifted`,
  );
  assert.equal(
    adminBrowserOperationalEvidenceComplete(roleSmoke),
    true,
    `${label}.roles admin operational evidence drifted`,
  );
  assert.equal(
    playerBrowserPostEvidenceComplete(roleSmoke),
    true,
    `${label}.roles player main-thread post evidence drifted`,
  );
  assert.equal(
    playerPrivateChannelBrowserPostEvidenceComplete(roleSmoke),
    true,
    `${label}.playerPrivateChannel evidence drifted`,
  );
  assert.equal(
    playerBrowserMediaEvidenceComplete(roleSmoke),
    true,
    `${label}.roles player media evidence drifted`,
  );
  assert.equal(
    moderatorBrowserSlotLifecycleEvidenceComplete(roleSmoke),
    true,
    `${label}.roles moderator lifecycle evidence drifted`,
  );
  return roleSmoke;
}

export function browserRoleSmokeEvidenceComplete(roleSmoke) {
  try {
    assertBrowserRoleSmokeEvidence(roleSmoke);
    return true;
  } catch (error) {
    if (error instanceof assert.AssertionError) {
      return false;
    }
    throw error;
  }
}

export function liveRoleSmokeThumbZoneEvidenceComplete(roleSmoke) {
  for (const expectation of liveRoleSmokeThumbZoneExpectations()) {
    const entries = exactRoleEntries(roleSmoke, expectation.role);
    if (entries === null) {
      return false;
    }
    for (const entry of entries) {
      if (!thumbZoneEvidenceComplete(entry, expectation.zones)) {
        return false;
      }
    }
  }
  return true;
}

export function adminBrowserOperationalEvidenceComplete(roleSmoke) {
  const entries = exactRoleEntries(roleSmoke, "admin");
  if (entries === null) {
    return false;
  }
  const expectedZones = liveRoleSmokeThumbZoneExpectations().find(
    (expectation) => expectation.role === "admin",
  )?.zones;
  return entries.every((entry) => {
    const expectedLayout =
      entry.viewport.width <= ADMIN_OPERATOR_INBOX_CONTRACT.stackBelowPx
        ? "stacked"
        : "queue-canvas";
    const paradigm = entry.roleParadigm;
    return (
      entry.commandResult === null &&
      thumbZoneEvidenceComplete(entry, expectedZones) &&
      paradigm?.mode === ADMIN_OPERATOR_INBOX_CONTRACT.mode &&
      paradigm.initialCanvasCount ===
        ADMIN_OPERATOR_INBOX_CONTRACT.initialCanvasCount &&
      paradigm.visibleCanvasCount ===
        ADMIN_OPERATOR_INBOX_CONTRACT.initialCanvasCount &&
      paradigm.selectedTaskId === adminAuditDetailContract.selectedTaskId &&
      Number.isInteger(paradigm.taskCount) &&
      paradigm.taskCount >= paradigm.visibleCanvasCount &&
      paradigm.layout === expectedLayout &&
      paradigm.expectedLayout === expectedLayout &&
      paradigm.noHorizontalOverflow === true &&
      responsiveAdminGeometryComplete(paradigm, expectedLayout) &&
      adminLinkAffordanceComplete(entry) &&
      adminAuditDetailClickProofComplete(entry)
    );
  });
}

function thumbZoneEvidenceComplete(entry, expectedZones) {
  const actual = entry?.thumbZones;
  if (
    !Array.isArray(expectedZones) ||
    !Array.isArray(actual) ||
    actual.length !== expectedZones.length
  ) {
    return false;
  }
  return expectedZones.every((expectedZone) => {
    const matches = actual.filter(
      (zone) => zone?.testId === expectedZone.testId,
    );
    return (
      matches.length === 1 &&
      matches[0].thumbZone === expectedZone.thumbZone &&
      matches[0].targetCount === expectedZone.targetCount &&
      Array.isArray(matches[0].targets) &&
      matches[0].targets.length === expectedZone.targetCount
    );
  });
}

export function playerBrowserPostEvidenceComplete(roleSmoke) {
  const entries = exactRoleEntries(roleSmoke, "player");
  if (entries === null) {
    return false;
  }
  return entries.every((entry) => {
    const result = entry.commandResult;
    const command = result?.postCommand?.requestCommand;
    return (
      result?.postCommandReceipt?.state === "ack" &&
      result?.postCommand?.state === "ack" &&
      command?.game === "midsummer" &&
      command?.channel_id === "main" &&
      command?.actor_slot === "slot-7" &&
      command?.body === "Browser smoke player post" &&
      result.postCommand.refreshedPostTestId === "thread-post-445"
    );
  });
}

export function playerPrivateChannelBrowserPostEvidenceComplete(roleSmoke) {
  const entries = exactPrivateChannelEntries(roleSmoke);
  if (entries === null) {
    return false;
  }
  return entries.every((entry) => {
    const result = entry.commandResult;
    const command = result?.requestCommand;
    return (
      entry.role === privateChannelContract.role &&
      entry.path === privateChannelContract.path &&
      entry.activeChannelTestId === privateChannelContract.activeChannelTestId &&
      entry.privateReviewHref === privateChannelContract.privateReviewHref &&
      result?.state === "ack" &&
      result?.receipt?.state === "ack" &&
      command?.game === "midsummer" &&
      command?.channel_id === "private:role_pm:slot-7" &&
      command?.actor_slot === "slot-7" &&
      command?.body === "Browser smoke private:role_pm:slot-7 post" &&
      result.refreshedPostTestId === "thread-post-446" &&
      entry.overlapCheckedTargets > 0 &&
      focusTraversalEvidenceComplete(entry.focusTraversal) &&
      screenshotEvidenceComplete(entry, entry.viewport)
    );
  });
}

export function playerBrowserMediaEvidenceComplete(roleSmoke) {
  const entries = exactRoleEntries(roleSmoke, "player");
  if (entries === null) {
    return false;
  }
  return entries.every((entry) => playerMediaEvidenceComplete(entry.commandResult?.media));
}

export function moderatorBrowserSlotLifecycleEvidenceComplete(roleSmoke) {
  const entries = exactRoleEntries(roleSmoke, "moderator");
  if (entries === null) {
    return false;
  }
  return entries.every((entry) => {
    const lifecycle = entry.commandResult?.slotLifecycle;
    const command = lifecycle?.requestCommand?.SetSlotStatus;
    return (
      lifecycle?.actionId === "modkill_slot" &&
      lifecycle?.state === "ack" &&
      command?.game === "midsummer" &&
      command?.slot === "slot-7" &&
      command?.status === "modkilled" &&
      lifecycle?.projection?.lifecycleLabel === "Modkilled"
    );
  });
}

function exactViewportList(actual) {
  return (
    Array.isArray(actual) &&
    actual.length === viewports.length &&
    actual.every((viewport, index) => sameViewport(viewport, viewports[index]))
  );
}

function exactRoleSurfaceEvidenceComplete(roleSmoke) {
  if (
    !Array.isArray(roleSmoke?.roles) ||
    roleSmoke.roles.length !== liveRoleScenarios.length * viewports.length
  ) {
    return false;
  }
  return liveRoleScenarios.every((scenario) => {
    const entries = exactRoleEntries(roleSmoke, scenario.id);
    return (
      entries !== null &&
      entries.every((entry) => roleSurfaceEvidenceComplete(entry, scenario))
    );
  });
}

function exactRoleEntries(roleSmoke, roleId) {
  const scenario = liveRoleScenarios.find((candidate) => candidate.id === roleId);
  if (scenario === undefined || !Array.isArray(roleSmoke?.roles)) {
    return null;
  }
  const roleEntries = roleSmoke.roles.filter((entry) => entry?.role === roleId);
  if (roleEntries.length !== viewports.length) {
    return null;
  }
  const ordered = [];
  for (const viewport of viewports) {
    const matches = roleEntries.filter((entry) =>
      sameViewport(entry?.viewport, viewport),
    );
    if (matches.length !== 1 || matches[0].path !== scenario.path) {
      return null;
    }
    ordered.push(matches[0]);
  }
  return ordered;
}

function exactPrivateChannelEntries(roleSmoke) {
  const entries = roleSmoke?.playerPrivateChannel;
  if (!Array.isArray(entries) || entries.length !== viewports.length) {
    return null;
  }
  const ordered = [];
  for (const viewport of viewports) {
    const matches = entries.filter((entry) =>
      sameViewport(entry?.viewport, viewport),
    );
    if (matches.length !== 1 || matches[0].path !== privateChannelContract.path) {
      return null;
    }
    ordered.push(matches[0]);
  }
  return ordered;
}

function roleSurfaceEvidenceComplete(entry, scenario) {
  return (
    entry?.role === scenario.id &&
    entry.path === scenario.path &&
    typeof entry.capability === "string" &&
    entry.capability.trim() !== "" &&
    entry.overlapCheckedTargets > 0 &&
    focusTraversalEvidenceComplete(entry.focusTraversal) &&
    screenshotEvidenceComplete(entry, entry.viewport)
  );
}

function boardEvidenceComplete(roleSmoke) {
  const entries = roleSmoke?.board;
  if (!Array.isArray(entries) || entries.length !== viewports.length) {
    return false;
  }
  return viewports.every((viewport) => {
    const matches = entries.filter((entry) =>
      sameViewport(entry?.viewport, viewport),
    );
    if (matches.length !== 1) {
      return false;
    }
    const entry = matches[0];
    return (
      entry.scenario === boardScenario.id &&
      entry.path === boardScenario.path &&
      entry.overlapCheckedTargets > 0 &&
      focusTraversalEvidenceComplete(entry.focusTraversal) &&
      screenshotEvidenceComplete(entry, viewport)
    );
  });
}

function routeStateEvidenceComplete(roleSmoke) {
  const entries = roleSmoke?.routeStates;
  if (
    !Array.isArray(entries) ||
    entries.length !== viewports.length * routeStateScenarios.length
  ) {
    return false;
  }
  return viewports.every((viewport) =>
    routeStateScenarios.every((scenario) => {
      const matches = entries.filter(
        (entry) =>
          entry?.scenario === scenario.id &&
          sameViewport(entry.viewport, viewport),
      );
      if (matches.length !== 1) {
        return false;
      }
      const entry = matches[0];
      return (
        entry.role === scenario.role &&
        entry.path === scenario.path &&
        entry.overlapCheckedTargets > 0 &&
        focusTraversalEvidenceComplete(entry.focusTraversal) &&
        screenshotEvidenceComplete(entry, viewport)
      );
    }),
  );
}

function forbiddenRouteEvidenceComplete(roleSmoke) {
  const entries = roleSmoke?.forbidden;
  if (
    !Array.isArray(entries) ||
    entries.length !== viewports.length * forbiddenRoutes.length
  ) {
    return false;
  }
  return viewports.every((viewport) =>
    forbiddenRoutes.every((scenario) => {
      const matches = entries.filter(
        (entry) =>
          entry?.scenario === scenario.id &&
          sameViewport(entry.viewport, viewport),
      );
      if (matches.length !== 1) {
        return false;
      }
      const entry = matches[0];
      return (
        entry.role === "forbidden" &&
        entry.path === scenario.path &&
        entry.status === scenario.status &&
        entry.overlapCheckedTargets > 0 &&
        screenshotEvidenceComplete(entry, viewport)
      );
    }),
  );
}

function responsiveAdminGeometryComplete(paradigm, expectedLayout) {
  if (
    !geometryBoxComplete(paradigm?.inboxBox) ||
    !geometryBoxComplete(paradigm?.queueBox) ||
    !geometryBoxComplete(paradigm?.canvasBox)
  ) {
    return false;
  }
  if (expectedLayout === "stacked") {
    return (
      paradigm.canvasBox.y >=
      paradigm.queueBox.y + paradigm.queueBox.height - 1
    );
  }
  return (
    paradigm.canvasBox.x >=
      paradigm.queueBox.x + paradigm.queueBox.width - 1 &&
    Math.abs(paradigm.canvasBox.y - paradigm.queueBox.y) <= 1
  );
}

function adminLinkAffordanceComplete(entry) {
  const scenario = liveRoleScenarios.find((candidate) => candidate.id === "admin");
  const expectedLinks = scenario?.linkAffordances ?? [];
  if (
    !Array.isArray(entry.linkAffordances) ||
    entry.linkAffordances.length !== expectedLinks.length
  ) {
    return false;
  }
  return expectedLinks.every((expected) => {
    const matches = entry.linkAffordances.filter(
      (actual) => actual?.testId === expected.testId,
    );
    return (
      matches.length === 1 &&
      matches[0].hrefPath === expected.hrefPath &&
      sameStringRecord(matches[0].searchParams, expected.searchParams ?? null)
    );
  });
}

function adminAuditDetailClickProofComplete(entry) {
  const proofs = entry.linkClickProofs;
  if (!Array.isArray(proofs) || proofs.length !== 1) {
    return false;
  }
  const proof = proofs[0];
  return (
    proof?.testId === adminAuditDetailContract.linkTestId &&
    proof.path === adminAuditDetailContract.path &&
    sameStringRecord(proof.searchParams, adminAuditDetailContract.searchParams) &&
    proof.surfaceTestId === adminAuditDetailContract.surfaceTestId &&
    proof.auditId === adminAuditDetailContract.auditId &&
    proof.capability === adminAuditDetailContract.capability &&
    proof.statusRegion?.state === "ack" &&
    proof.statusRegion?.role === "status" &&
    proof.statusRegion?.ariaLive === "polite" &&
    proof.statusRegion?.ariaAtomic === "true" &&
    proof.evidenceTestId === adminAuditDetailContract.evidenceTestId &&
    proof.evidenceHref === adminAuditDetailContract.evidenceHref &&
    proof.backTestId === adminAuditDetailContract.backTestId &&
    proof.backHref === adminAuditDetailContract.backHref &&
    proof.overlapCheckedTargets > 0 &&
    sameViewport(proof.viewport, entry.viewport) &&
    screenshotEvidenceComplete(proof, entry.viewport)
  );
}

function playerMediaEvidenceComplete(media) {
  return (
    media?.boundaryTestId === "thread-post-media-boundary-442" &&
    media?.renderedVariant === "tablet" &&
    media?.mediaTestId ===
      "thread-post-media-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" &&
    media?.requestedOriginal === false &&
    Array.isArray(media?.requested) &&
    media.requested.length > 0 &&
    media.requested.every(
      (request) =>
        allowedPlayerMediaVariants.includes(request?.variant) &&
        request?.resourceType === "image" &&
        typeof request?.url === "string" &&
        !/(?:original|full|desktop)/u.test(request.url),
    ) &&
    media.image?.complete === true &&
    media.image?.naturalWidth > 0 &&
    media.image?.naturalHeight > 0
  );
}

function screenshotEvidenceComplete(entry, viewport) {
  const pixels = entry?.screenshotPixels;
  return (
    typeof entry?.screenshot === "string" &&
    entry.screenshot.trim() !== "" &&
    pixels?.width === viewport?.width &&
    Number.isInteger(pixels?.height) &&
    pixels.height >= viewport.height &&
    pixels.uniqueColorBuckets >= 8 &&
    pixels.changedPixelRatio >= 0.005
  );
}

function focusTraversalEvidenceComplete(focusTraversal) {
  return (
    Array.isArray(focusTraversal?.focusedTestIds) &&
    focusTraversal.focusedTestIds.length > 0
  );
}

function geometryBoxComplete(box) {
  return (
    Number.isFinite(box?.x) &&
    Number.isFinite(box?.y) &&
    Number.isFinite(box?.width) &&
    box.width > 0 &&
    Number.isFinite(box?.height) &&
    box.height > 0
  );
}

function sameViewport(actual, expected) {
  return (
    actual !== null &&
    typeof actual === "object" &&
    Object.keys(actual).length === 3 &&
    actual.name === expected.name &&
    actual.width === expected.width &&
    actual.height === expected.height
  );
}

function sameStringRecord(actual, expected) {
  if (actual === null || expected === null) {
    return actual === expected;
  }
  if (
    actual === undefined ||
    expected === undefined ||
    typeof actual !== "object" ||
    typeof expected !== "object"
  ) {
    return false;
  }
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index]) &&
    actualKeys.every(
      (key) =>
        typeof actual[key] === "string" && actual[key] === expected[key],
    )
  );
}
