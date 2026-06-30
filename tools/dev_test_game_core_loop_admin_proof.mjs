import path from "node:path";
import {
  coreLoopHighlightedLaneEvidence,
  coreLoopSpineStatus,
} from "../frontend/src/lib/app/local-proof-lane-status.mjs";
import { assertDevTestGameProofRun } from "./dev_test_game_proof_contract.mjs";
import {
  artifactDir,
  proveAdminAuditDetail,
  readJson,
  repoRoot,
  runAdminAuditProof,
} from "./dev_test_game_admin_audit_proof_helper.mjs";

const proofRunPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_PROOF_RUN ??
    "target/dev-test-game/proof-run.json",
);
const proofRunRelativePath = path.relative(repoRoot, proofRunPath);
const evidencePath = path.join(artifactDir, "core-loop-admin-proof.json");
const requiredChecks = [
  "core-loop-spine",
  "core-loop",
  "day-vote-resolution",
  "day-vote-no-lynch",
  "action-loop",
  "host-deadline-advance",
  "stale-deadline-advance",
  "invalid-action-recovery",
  "resolution-receipts",
  "dead-player-recovery",
  "player-action-boundary",
  "private-channel",
  "host-votecount-publication",
  "host-lifecycle-control",
  "host-modkill-control",
  "replacement-host-issued-invite",
  "replacement-pending-player",
  "replacement-invalid-target-recovery",
  "replacement-console",
  "stale-host-invite-recovery",
  "replacement-stale-success-recovery",
  "replacement-stale-player",
  "replacement-stale-action",
  "replacement-stale-private-channel",
  "replacement-stale-private-receipts",
  "replacement-incoming-player",
];

const requiredSpineRows = (proofRun) => {
  const cycles = Array.isArray(proofRun?.coreLoopSpine?.cycles)
    ? proofRun.coreLoopSpine.cycles
    : [];
  return {
    cycles: cycles.map((cycle) => String(cycle.id)),
    roleUrls: cycles.flatMap((cycle) =>
      Object.keys(cycle.roleUrls ?? {}).map(
        (roleId) => `${String(cycle.id)}-${String(roleId)}`,
      ),
    ),
    roleUrlHrefs: Object.fromEntries(
      cycles.flatMap((cycle) =>
        Object.entries(cycle.roleUrls ?? {}).map(([roleId, href]) => [
          `${String(cycle.id)}-${String(roleId)}`,
          String(href ?? ""),
        ]),
      ),
    ),
    checkpoints: cycles.flatMap((cycle) =>
      (cycle.checkpoints ?? []).map(
        (checkpoint) => `${String(cycle.id)}-${String(checkpoint.id)}`,
      ),
    ),
    recoveryHooks: Object.keys(proofRun?.coreLoopSpine?.recoveryHooks ?? {}),
  };
};

await runAdminAuditProof({
  smokeName: "dev-test-game-core-loop-admin-proof",
  stage: "core-loop-admin-proof-listen",
  evidencePath,
  envOverrides: {
    FMARCH_DEV_TEST_GAME_PROOF_RUN: proofRunRelativePath,
  },
  loadSource: async () => assertDevTestGameProofRun(await readJson(proofRunPath)),
  prove: async ({ browser, frontendBaseUrl, source: proofRun }) => {
    const spineRows = requiredSpineRows(proofRun);
    const adminRoleSurface = await proveAdminAuditDetail({
      browser,
      frontendBaseUrl,
      game: proofRun.session.game,
      auditId: "local-core-loop",
      requiredChecks,
      requiredCheckStatuses: {
        "core-loop-spine": coreLoopSpineStatus(proofRun),
        ...coreLoopHighlightedLaneEvidence(proofRun),
      },
      requiredSpineCycles: spineRows.cycles,
      requiredSpineRoleUrls: spineRows.roleUrls,
      requiredSpineCheckpoints: spineRows.checkpoints,
      requiredSpineRecoveryHooks: spineRows.recoveryHooks,
    });
    const hostRoleSurface = await proveHostLifecycleControlCheckpoint({
      browser,
      frontendBaseUrl,
      game: proofRun.session.game,
      roleUrl: spineRows.roleUrlHrefs["d02-n02-host"],
    });
    const playerRoleSurface = await provePlayerActionSubmissionCheckpoint({
      browser,
      frontendBaseUrl,
      roleUrl: spineRows.roleUrlHrefs["d02-n02-actionPlayer"],
    });
    const targetResolutionReceiptSurface =
      await proveTargetResolutionReceiptSurface({
        browser,
        frontendBaseUrl,
        roleUrl: targetResolutionReceiptRoleUrl(
          spineRows.roleUrlHrefs["d01-n01-d02-target"],
        ),
      });
    const normalResolutionPrivacySurface =
      await proveNormalResolutionPrivacySurface({
        browser,
        frontendBaseUrl,
        roleUrl: normalResolutionPrivacyRoleUrl(
          spineRows.roleUrlHrefs["d01-n01-d02-normalPlayer"],
        ),
      });
    const targetDayVoteReceiptSurface = await proveTargetDayVoteReceiptSurface({
      browser,
      frontendBaseUrl,
      roleUrl: targetResolutionReceiptRoleUrl(
        spineRows.roleUrlHrefs["d02-n02-target"],
      ),
    });
    const normalDayVotePrivacySurface = await proveNormalDayVotePrivacySurface({
      browser,
      frontendBaseUrl,
      roleUrl: normalResolutionPrivacyRoleUrl(
        spineRows.roleUrlHrefs["d02-n02-normalPlayer"],
      ),
    });
    const hostPhaseTransitionSurface = await proveHostPhaseTransitionSurface({
      browser,
      frontendBaseUrl,
      hostRoleUrl: spineRows.roleUrlHrefs["d02-n02-host"],
      playerRoleUrl: spineRows.roleUrlHrefs["d02-n02-actionPlayer"],
    });
    const targetPostDayVoteAdvanceSurface =
      await proveTargetPostDayVoteAdvanceSurface({
        browser,
        frontendBaseUrl,
        roleUrl: targetResolutionReceiptRoleUrl(
          spineRows.roleUrlHrefs["d02-n02-target"],
        ),
      });
    const normalPostDayVoteAdvanceSurface =
      await proveNormalPostDayVoteAdvanceSurface({
        browser,
        frontendBaseUrl,
        roleUrl: normalResolutionPrivacyRoleUrl(
          spineRows.roleUrlHrefs["d02-n02-normalPlayer"],
        ),
      });
    const privateChannelRoleSurface = await provePrivateChannelRoleSurface({
      browser,
      frontendBaseUrl,
      roleUrl: privateChannelRoleUrlFromPlayerRoleUrl(
        spineRows.roleUrlHrefs["d02-n02-actionPlayer"],
      ),
    });
    return {
      adminRoleSurface,
      hostRoleSurface,
      playerRoleSurface,
      targetResolutionReceiptSurface,
      normalResolutionPrivacySurface,
      targetDayVoteReceiptSurface,
      normalDayVotePrivacySurface,
      hostPhaseTransitionSurface,
      targetPostDayVoteAdvanceSurface,
      normalPostDayVoteAdvanceSurface,
      privateChannelRoleSurface,
    };
  },
  buildEvidence: ({ source: proofRun, adminRoleSurface: surfaces }) => ({
    version: 1,
    proof: "dev-test-game-core-loop-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-core-loop-admin-surface",
    proofBoundary:
      "Local SvelteKit admin role URL with fixture admin authority over the dev-test-game core-loop proof-run lanes. Proves the saved host-control, lynch and no-lynch day-vote resolution, player-action, day/night, official-votecount publication, private-channel, replacement, stale outgoing-player recovery, and incoming replacement-player evidence is discoverable from the seeded admin overview and inspectable in a native admin audit detail route; it does not prove hosted deployment, production identity, exhaustive action/race coverage, beta readiness, or production readiness.",
    generatedFrom: {
      proofRun: proofRunRelativePath,
      game: proofRun.session.game,
      coreLoopSpineStatus: coreLoopSpineStatus(proofRun),
      coreLoopSpineRows: requiredSpineRows(proofRun),
      highlightedLaneEvidence: coreLoopHighlightedLaneEvidence(proofRun),
    },
    adminRoleSurface: surfaces.adminRoleSurface,
    hostRoleSurface: surfaces.hostRoleSurface,
    playerRoleSurface: surfaces.playerRoleSurface,
    targetResolutionReceiptSurface: surfaces.targetResolutionReceiptSurface,
    normalResolutionPrivacySurface: surfaces.normalResolutionPrivacySurface,
    targetDayVoteReceiptSurface: surfaces.targetDayVoteReceiptSurface,
    normalDayVotePrivacySurface: surfaces.normalDayVotePrivacySurface,
    hostPhaseTransitionSurface: surfaces.hostPhaseTransitionSurface,
    targetPostDayVoteAdvanceSurface: surfaces.targetPostDayVoteAdvanceSurface,
    normalPostDayVoteAdvanceSurface: surfaces.normalPostDayVoteAdvanceSurface,
    privateChannelRoleSurface: surfaces.privateChannelRoleSurface,
  }),
  assertEvidence: assertCoreLoopAdminProof,
});

async function proveHostLifecycleControlCheckpoint({
  browser,
  frontendBaseUrl,
  game,
  roleUrl,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const visitedRolePath = rolePathFromUrl(roleUrl);
  const commandRequests = [];
  try {
    await installHostLifecycleControlBrowserRoutes(page, { commandRequests });
    await page.context().addCookies([
      {
        name: "fmarch_fixture_session",
        value: "fixture-host",
        url: frontendBaseUrl,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto(`${frontendBaseUrl}${visitedRolePath}`, { waitUntil: "networkidle" });
    await page.getByTestId("host-console-surface").waitFor({
      state: "visible",
      timeout: 15000,
    });
    const checkpoint = page.getByTestId("host-lifecycle-control-checkpoint");
    await checkpoint.waitFor({ state: "visible", timeout: 15000 });
    const proofCheckId = await checkpoint.getAttribute("data-proof-check-id");
    const phaseId = await checkpoint.getAttribute("data-phase-id");
    const phaseState = await checkpoint.getAttribute("data-phase-state");
    const slotId = await checkpoint.getAttribute("data-slot-id");
    const actionState = await checkpoint.getAttribute("data-action-state");
    const deadlineAffordance = await checkpoint.getAttribute(
      "data-deadline-affordance",
    );
    const visibleRows = [];
    for (const [id, testId] of Object.entries({
      phase: "host-lifecycle-control-phase",
      slot: "host-lifecycle-control-slot",
      actionState: "host-lifecycle-control-action-state",
      deadlineAffordance: "host-lifecycle-control-deadline-affordance",
      recovery: "host-lifecycle-control-recovery",
    })) {
      await page.getByTestId(testId).waitFor({ state: "visible", timeout: 15000 });
      visibleRows.push(id);
    }
    const recoveryText = await page
      .getByTestId("host-lifecycle-control-recovery")
      .innerText();
    const statusText = await page
      .getByTestId("host-lifecycle-control-status")
      .innerText();
    const bodyText = await page.locator("body").innerText();
    if (/invite=(?!REDACTED)/.test(bodyText)) {
      throw new Error("host lifecycle checkpoint leaked an invite URL token");
    }
    const clickProof = await proveHostLifecycleControlClick({
      page,
      commandRequests,
    });
    const staleRejectProof = await proveHostLifecycleStaleReject({
      browser,
      frontendBaseUrl,
      roleUrl,
    });
    return {
      status: "passed",
      sourceRoleUrl: String(roleUrl),
      visitedRolePath,
      surfaceTestId: "host-console-surface",
      checkpointTestId: "host-lifecycle-control-checkpoint",
      clickedThroughFromRoleUrl: true,
      hostLifecycleControlCheckpoint: {
        proofCheckId,
        phaseId,
        phaseState,
        slotId,
        actionState,
        deadlineAffordance,
        visibleRows,
        recoveryText,
        statusText,
      },
      hostLifecycleControlClickProof: clickProof,
      hostLifecycleStaleRejectProof: staleRejectProof,
      releaseReady: false,
      productionReady: false,
    };
  } finally {
    await page.close();
  }
}

async function installHostLifecycleControlBrowserRoutes(page, { commandRequests }) {
  await page.route("**/commands", async (route) => {
    const commandEnvelope = route.request().postDataJSON();
    const command = commandEnvelope?.body?.body?.command;
    commandRequests.push(command);
    if (command?.LockThread !== undefined) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          v: 1,
          id: commandEnvelope.id,
          body: {
            kind: "Ack",
            body: {
              stream_seqs: [601],
            },
          },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        v: 1,
        id: commandEnvelope?.id ?? "host-lifecycle-control-reject",
        body: {
          kind: "Reject",
          body: {
            error: "WrongHostLifecycleProofCommand",
            retryable: false,
            message: "host lifecycle proof only accepts LockThread",
          },
        },
      }),
    });
  });
  await page.route("**/games/*/host-console-state?**", async (route) => {
    await fulfillJson(route, hostLockedConsoleState());
  });
}

async function proveHostLifecycleControlClick({ page, commandRequests }) {
  const actionTile = page.getByTestId("critical-host-action-lock_thread");
  await actionTile.waitFor({ state: "visible", timeout: 15000 });
  await actionTile.getByTestId("critical-host-action-trigger").click();
  await actionTile.getByTestId("critical-host-action-confirm").waitFor({
    state: "visible",
    timeout: 15000,
  });
  await actionTile.getByTestId("critical-host-action-confirm").click();
  await page.waitForFunction(
    () =>
      window.__fmarchHostCommandStatuses?.lock_thread?.state === "ack" &&
      window.__fmarchHostCommandDispatchBridgePlan?.commandKind === "LockThread",
    null,
    { timeout: 15000 },
  );
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="host-lifecycle-control-checkpoint"]')
        ?.getAttribute("data-phase-state") === "locked",
    null,
    { timeout: 15000 },
  );
  const commandStatuses = await page.evaluate(
    () => window.__fmarchHostCommandStatuses,
  );
  const commandOutcomes = await page.evaluate(
    () => window.__fmarchHostCommandOutcomes,
  );
  const bridgePlan = await page.evaluate(
    () => window.__fmarchHostCommandDispatchBridgePlan,
  );
  const projection = await page.evaluate(() => window.__fmarchHostProjection);
  const checkpoint = page.getByTestId("host-lifecycle-control-checkpoint");
  const phaseStateAfterAck = await checkpoint.getAttribute("data-phase-state");
  const deadlineAffordanceAfterAck = await checkpoint.getAttribute(
    "data-deadline-affordance",
  );
  const activityCountText = await page
    .getByTestId("host-command-activity-count")
    .innerText();
  const activityStatusText = await page
    .getByTestId("host-command-activity-status-lock_thread")
    .innerText();
  const command = commandRequests.at(-1)?.LockThread ?? null;
  return {
    status: "passed",
    clickedAction: "lock_thread",
    commandKind: command === null ? null : "LockThread",
    command,
    commandStatus: commandStatuses?.lock_thread ?? null,
    commandOutcome: commandOutcomes?.at?.(-1) ?? null,
    bridgePlan,
    projection,
    checkpointPhaseStateAfterAck: phaseStateAfterAck,
    checkpointDeadlineAffordanceAfterAck: deadlineAffordanceAfterAck,
    statusText: commandStatuses?.lock_thread?.message ?? null,
    activityCount: Number.parseInt(activityCountText, 10),
    activityStatusText,
  };
}

async function proveHostLifecycleStaleReject({
  browser,
  frontendBaseUrl,
  roleUrl,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const visitedRolePath = rolePathFromUrl(roleUrl);
  const commandRequests = [];
  try {
    await installHostLifecycleStaleRejectBrowserRoutes(page, {
      commandRequests,
    });
    await page.context().addCookies([
      {
        name: "fmarch_fixture_session",
        value: "fixture-host",
        url: frontendBaseUrl,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto(`${frontendBaseUrl}${visitedRolePath}`, {
      waitUntil: "networkidle",
    });
    await page.getByTestId("host-console-surface").waitFor({
      state: "visible",
      timeout: 15000,
    });
    const actionTile = page.getByTestId("critical-host-action-lock_thread");
    await actionTile.waitFor({ state: "visible", timeout: 15000 });
    await actionTile.getByTestId("critical-host-action-trigger").click();
    await actionTile.getByTestId("critical-host-action-confirm").waitFor({
      state: "visible",
      timeout: 15000,
    });
    await actionTile.getByTestId("critical-host-action-confirm").click();
    await page.waitForFunction(
      () =>
        window.__fmarchHostCommandStatuses?.lock_thread?.state === "reject" &&
        window.__fmarchHostCommandStatuses?.lock_thread?.error === "PhaseLocked" &&
        window.__fmarchHostCommandDispatchBridgePlan?.finalState === "reject",
      null,
      { timeout: 15000 },
    );
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="host-lifecycle-control-checkpoint"]')
          ?.getAttribute("data-deadline-affordance") ===
        "resolve_phase,lock_thread",
      null,
      { timeout: 15000 },
    );
    const commandStatuses = await page.evaluate(
      () => window.__fmarchHostCommandStatuses,
    );
    const commandOutcomes = await page.evaluate(
      () => window.__fmarchHostCommandOutcomes,
    );
    const bridgePlan = await page.evaluate(
      () => window.__fmarchHostCommandDispatchBridgePlan,
    );
    const projection = await page.evaluate(() => window.__fmarchHostProjection);
    const checkpoint = page.getByTestId("host-lifecycle-control-checkpoint");
    const phaseStateAfterReject = await checkpoint.getAttribute("data-phase-state");
    const deadlineAffordanceAfterReject = await checkpoint.getAttribute(
      "data-deadline-affordance",
    );
    const recoveryText = await page
      .getByTestId("host-lifecycle-control-recovery")
      .innerText();
    const activityCountText = await page
      .getByTestId("host-command-activity-count")
      .innerText();
    const activityStatusText = await page
      .getByTestId("host-command-activity-status-lock_thread")
      .innerText();
    const bodyText = await page.locator("body").innerText();
    if (/invite=(?!REDACTED)/.test(bodyText)) {
      throw new Error("host lifecycle stale reject proof leaked an invite URL token");
    }
    const command = commandRequests.at(-1)?.LockThread ?? null;
    return {
      status: "passed",
      clickedAction: "lock_thread",
      commandKind: command === null ? null : "LockThread",
      command,
      commandStatus: commandStatuses?.lock_thread ?? null,
      commandOutcome: commandOutcomes?.at?.(-1) ?? null,
      bridgePlan,
      projection,
      checkpointPhaseStateAfterReject: phaseStateAfterReject,
      checkpointDeadlineAffordanceAfterReject: deadlineAffordanceAfterReject,
      recoveryText,
      activityCount: Number.parseInt(activityCountText, 10),
      activityStatusText,
    };
  } finally {
    await page.close();
  }
}

async function installHostLifecycleStaleRejectBrowserRoutes(
  page,
  { commandRequests },
) {
  await page.route("**/commands", async (route) => {
    const commandEnvelope = route.request().postDataJSON();
    const command = commandEnvelope?.body?.body?.command;
    commandRequests.push(command);
    if (command?.LockThread !== undefined) {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          v: 1,
          id: commandEnvelope.id,
          body: {
            kind: "Reject",
            body: {
              error: "PhaseLocked",
              retryable: false,
              message: "phase locked",
            },
          },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        v: 1,
        id: commandEnvelope?.id ?? "host-lifecycle-stale-reject",
        body: {
          kind: "Reject",
          body: {
            error: "WrongHostLifecycleProofCommand",
            retryable: false,
            message: "host stale lifecycle proof only accepts LockThread",
          },
        },
      }),
    });
  });
  await page.route("**/games/*/host-console-state?**", async (route) => {
    await fulfillJson(route, hostOpenConsoleState({
      boundary: "Seeded browser PhaseLocked recovery kept current phase controls.",
    }));
  });
}

async function proveHostPhaseTransitionSurface({
  browser,
  frontendBaseUrl,
  hostRoleUrl,
  playerRoleUrl,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const visitedHostRolePath = rolePathFromUrl(hostRoleUrl);
  const commandRequests = [];
  try {
    await installHostPhaseTransitionBrowserRoutes(page, { commandRequests });
    await page.context().addCookies([
      {
        name: "fmarch_fixture_session",
        value: "fixture-host",
        url: frontendBaseUrl,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto(`${frontendBaseUrl}${visitedHostRolePath}`, {
      waitUntil: "networkidle",
    });
    await page.getByTestId("host-console-surface").waitFor({
      state: "visible",
      timeout: 15000,
    });
    const resolveProof = await proveHostPhaseActionClick({
      page,
      commandRequests,
      actionId: "resolve_phase",
      commandKind: "ResolvePhase",
      streamSeq: 801,
      expectedPhaseId: "D02",
      expectedPhaseState: "locked",
      expectedDeadlineAffordance: "unlock_thread,advance_phase",
    });
    const advanceProof = await proveHostPhaseActionClick({
      page,
      commandRequests,
      actionId: "advance_phase",
      commandKind: "AdvancePhase",
      streamSeq: 802,
      expectedPhaseId: "N02",
      expectedPhaseState: "open",
      expectedDeadlineAffordance: "resolve_phase,lock_thread",
    });
    const staleHostAdvanceRecoveryProof =
      await proveHostStaleAdvanceAfterTransition({
        browser,
        frontendBaseUrl,
        roleUrl: hostRoleUrl,
      });
    const playerObservationProof = await provePlayerPhaseTransitionObservation({
      browser,
      frontendBaseUrl,
      roleUrl: playerRoleUrl,
    });
    const bodyText = await page.locator("body").innerText();
    if (/invite=(?!REDACTED)/.test(bodyText)) {
      throw new Error("host phase transition proof leaked an invite URL token");
    }
    return {
      status: "passed",
      sourceHostRoleUrl: String(hostRoleUrl),
      sourcePlayerRoleUrl: String(playerRoleUrl),
      visitedHostRolePath,
      surfaceTestId: "host-console-surface",
      clickedThroughFromRoleUrl: true,
      transition: "resolve_phase:ack:801 -> advance_phase:ack:802 -> player:N02",
      resolveProof,
      advanceProof,
      staleHostAdvanceRecoveryProof,
      playerObservationProof,
      releaseReady: false,
      productionReady: false,
    };
  } finally {
    await page.close();
  }
}

async function proveHostPhaseActionClick({
  page,
  commandRequests,
  actionId,
  commandKind,
  streamSeq,
  expectedPhaseId,
  expectedPhaseState,
  expectedDeadlineAffordance,
}) {
  const actionTile = page.getByTestId(`critical-host-action-${actionId}`);
  await actionTile.waitFor({ state: "visible", timeout: 15000 });
  await actionTile.getByTestId("critical-host-action-trigger").click();
  await actionTile.getByTestId("critical-host-action-confirm").waitFor({
    state: "visible",
    timeout: 15000,
  });
  await actionTile.getByTestId("critical-host-action-confirm").click();
  await page.waitForFunction(
    ({ actionId: expectedActionId, commandKind: expectedCommandKind, streamSeq: expectedSeq }) =>
      window.__fmarchHostCommandStatuses?.[expectedActionId]?.state === "ack" &&
      window.__fmarchHostCommandStatuses?.[expectedActionId]?.message?.includes(
        `Ack: stream seqs ${expectedSeq}`,
      ) &&
      window.__fmarchHostCommandDispatchBridgePlan?.commandKind ===
        expectedCommandKind,
    { actionId, commandKind, streamSeq },
    { timeout: 15000 },
  );
  await page.waitForFunction(
    ({
      phaseId,
      phaseState,
      deadlineAffordance,
    }) => {
      const checkpoint = document.querySelector(
        '[data-testid="host-lifecycle-control-checkpoint"]',
      );
      return (
        checkpoint?.getAttribute("data-phase-id") === phaseId &&
        checkpoint?.getAttribute("data-phase-state") === phaseState &&
        checkpoint?.getAttribute("data-deadline-affordance") ===
          deadlineAffordance
      );
    },
    {
      phaseId: expectedPhaseId,
      phaseState: expectedPhaseState,
      deadlineAffordance: expectedDeadlineAffordance,
    },
    { timeout: 15000 },
  );
  const commandStatuses = await page.evaluate(
    () => window.__fmarchHostCommandStatuses,
  );
  const commandOutcomes = await page.evaluate(
    () => window.__fmarchHostCommandOutcomes,
  );
  const bridgePlan = await page.evaluate(
    () => window.__fmarchHostCommandDispatchBridgePlan,
  );
  const projection = await page.evaluate(() => window.__fmarchHostProjection);
  const checkpoint = page.getByTestId("host-lifecycle-control-checkpoint");
  const checkpointPhaseId = await checkpoint.getAttribute("data-phase-id");
  const checkpointPhaseState = await checkpoint.getAttribute("data-phase-state");
  const checkpointDeadlineAffordance = await checkpoint.getAttribute(
    "data-deadline-affordance",
  );
  const activityStatusText = await page
    .getByTestId(`host-command-activity-status-${actionId}`)
    .innerText();
  const command = commandRequests.at(-1)?.[commandKind] ?? null;
  return {
    status: "passed",
    clickedAction: actionId,
    commandKind: command === null ? null : commandKind,
    command,
    commandStatus: commandStatuses?.[actionId] ?? null,
    commandOutcome: commandOutcomes?.at?.(-1) ?? null,
    bridgePlan,
    projection,
    checkpointPhaseId,
    checkpointPhaseState,
    checkpointDeadlineAffordance,
    activityStatusText,
  };
}

async function proveHostStaleAdvanceAfterTransition({
  browser,
  frontendBaseUrl,
  roleUrl,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const visitedRolePath = rolePathFromUrl(roleUrl);
  const commandRequests = [];
  try {
    await installHostStaleAdvanceBrowserRoutes(page, { commandRequests });
    await page.context().addCookies([
      {
        name: "fmarch_fixture_session",
        value: "fixture-host",
        url: frontendBaseUrl,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto(`${frontendBaseUrl}${visitedRolePath}`, {
      waitUntil: "networkidle",
    });
    await page.getByTestId("host-console-surface").waitFor({
      state: "visible",
      timeout: 15000,
    });
    const setupSnapshot = await page.evaluate(async () => {
      if (typeof window.__fmarchTriggerHostResync !== "function") {
        throw new Error("host resync hook is unavailable");
      }
      return window.__fmarchTriggerHostResync(801);
    });
    await page.waitForFunction(
      () => {
        const checkpoint = document.querySelector(
          '[data-testid="host-lifecycle-control-checkpoint"]',
        );
        return (
          checkpoint?.getAttribute("data-phase-id") === "D02" &&
          checkpoint?.getAttribute("data-phase-state") === "locked" &&
          checkpoint?.getAttribute("data-deadline-affordance") ===
            "unlock_thread,advance_phase"
        );
      },
      null,
      { timeout: 15000 },
    );
    const actionTile = page.getByTestId("critical-host-action-advance_phase");
    await actionTile.waitFor({ state: "visible", timeout: 15000 });
    await actionTile.getByTestId("critical-host-action-trigger").click();
    await actionTile.getByTestId("critical-host-action-confirm").waitFor({
      state: "visible",
      timeout: 15000,
    });
    await actionTile.getByTestId("critical-host-action-confirm").click();
    await page.waitForFunction(
      () =>
        window.__fmarchHostCommandStatuses?.advance_phase?.state === "reject" &&
        window.__fmarchHostCommandStatuses?.advance_phase?.error ===
          "InvalidTarget" &&
        window.__fmarchHostCommandDispatchBridgePlan?.commandKind ===
          "AdvancePhase",
      null,
      { timeout: 15000 },
    );
    await page.waitForFunction(
      () => {
        const checkpoint = document.querySelector(
          '[data-testid="host-lifecycle-control-checkpoint"]',
        );
        return (
          checkpoint?.getAttribute("data-phase-id") === "N02" &&
          checkpoint?.getAttribute("data-phase-state") === "open" &&
          checkpoint?.getAttribute("data-deadline-affordance") ===
            "resolve_phase,lock_thread"
        );
      },
      null,
      { timeout: 15000 },
    );
    const commandStatuses = await page.evaluate(
      () => window.__fmarchHostCommandStatuses,
    );
    const commandOutcomes = await page.evaluate(
      () => window.__fmarchHostCommandOutcomes,
    );
    const bridgePlan = await page.evaluate(
      () => window.__fmarchHostCommandDispatchBridgePlan,
    );
    const projection = await page.evaluate(() => window.__fmarchHostProjection);
    const checkpoint = page.getByTestId("host-lifecycle-control-checkpoint");
    const checkpointPhaseIdAfterReject = await checkpoint.getAttribute(
      "data-phase-id",
    );
    const checkpointPhaseStateAfterReject = await checkpoint.getAttribute(
      "data-phase-state",
    );
    const checkpointDeadlineAffordanceAfterReject = await checkpoint.getAttribute(
      "data-deadline-affordance",
    );
    const activityStatusText = await page
      .getByTestId("host-command-activity-status-advance_phase")
      .innerText();
    const bodyText = await page.locator("body").innerText();
    if (/invite=(?!REDACTED)/.test(bodyText)) {
      throw new Error("host stale advance proof leaked an invite URL token");
    }
    const command = commandRequests.at(-1)?.AdvancePhase ?? null;
    return {
      status: "passed",
      sourceRoleUrl: String(roleUrl),
      visitedRolePath,
      surfaceTestId: "host-console-surface",
      setupResyncFromSeq: 801,
      setupSnapshotHost: setupSnapshot?.host ?? null,
      clickedAction: "advance_phase",
      commandKind: command === null ? null : "AdvancePhase",
      command,
      commandStatus: commandStatuses?.advance_phase ?? null,
      commandOutcome: commandOutcomes?.at?.(-1) ?? null,
      bridgePlan,
      projection,
      checkpointPhaseIdAfterReject,
      checkpointPhaseStateAfterReject,
      checkpointDeadlineAffordanceAfterReject,
      activityStatusText,
      releaseReady: false,
      productionReady: false,
    };
  } finally {
    await page.close();
  }
}

async function installHostStaleAdvanceBrowserRoutes(page, { commandRequests }) {
  let hostPhaseState = "stale-locked";
  await page.route("**/commands", async (route) => {
    const commandEnvelope = route.request().postDataJSON();
    const command = commandEnvelope?.body?.body?.command;
    commandRequests.push(command);
    if (command?.AdvancePhase !== undefined) {
      hostPhaseState = "current-open";
      await fulfillJson(
        route,
        {
          v: 1,
          id: commandEnvelope.id,
          body: {
            kind: "Reject",
            body: {
              error: "InvalidTarget",
              retryable: false,
              message: "invalid target",
            },
          },
        },
        409,
      );
      return;
    }

    await fulfillJson(
      route,
      {
        v: 1,
        id: commandEnvelope?.id ?? "host-stale-advance-reject",
        body: {
          kind: "Reject",
          body: {
            error: "WrongHostStaleAdvanceProofCommand",
            retryable: false,
            message: "host stale advance proof only accepts AdvancePhase",
          },
        },
      },
      409,
    );
  });
  await page.route("**/games/*/host-console-state?**", async (route) => {
    await fulfillJson(
      route,
      hostPhaseTransitionConsoleState({
        phaseId: hostPhaseState === "current-open" ? "N02" : "D02",
        locked: hostPhaseState !== "current-open",
        boundary:
          hostPhaseState === "current-open"
            ? "Seeded browser InvalidTarget recovery refreshed host projection to Night 2."
            : "Seeded browser stale host view still showed locked Day 2 advance controls.",
      }),
    );
  });
  await page.route("**/games/*/votecount?**", async (route) => {
    await fulfillJson(route, []);
  });
  await page.route("**/games/*/day-vote-outcomes?**", async (route) => {
    await fulfillJson(route, []);
  });
  await page.route("**/games/*/host-prompts?**", async (route) => {
    await fulfillJson(route, []);
  });
}

async function installHostPhaseTransitionBrowserRoutes(page, { commandRequests }) {
  let hostPhaseState = "open";
  await page.route("**/commands", async (route) => {
    const commandEnvelope = route.request().postDataJSON();
    const command = commandEnvelope?.body?.body?.command;
    commandRequests.push(command);
    if (command?.ResolvePhase !== undefined) {
      hostPhaseState = "resolved";
      await fulfillJson(route, {
        v: 1,
        id: commandEnvelope.id,
        body: {
          kind: "Ack",
          body: {
            stream_seqs: [801],
          },
        },
      });
      return;
    }
    if (command?.AdvancePhase !== undefined) {
      hostPhaseState = "advanced";
      await fulfillJson(route, {
        v: 1,
        id: commandEnvelope.id,
        body: {
          kind: "Ack",
          body: {
            stream_seqs: [802],
          },
        },
      });
      return;
    }

    await fulfillJson(
      route,
      {
        v: 1,
        id: commandEnvelope?.id ?? "host-phase-transition-reject",
        body: {
          kind: "Reject",
          body: {
            error: "WrongHostPhaseTransitionProofCommand",
            retryable: false,
            message: "host phase transition proof only accepts phase controls",
          },
        },
      },
      409,
    );
  });
  await page.route("**/games/*/host-console-state?**", async (route) => {
    await fulfillJson(
      route,
      hostPhaseTransitionConsoleState({
        phaseId: hostPhaseState === "advanced" ? "N02" : "D02",
        locked: hostPhaseState === "resolved",
        boundary:
          hostPhaseState === "advanced"
            ? "Seeded browser AdvancePhase ACK advanced the host projection to Night 2."
            : "Seeded browser ResolvePhase ACK locked Day 2 for host advancement.",
      }),
    );
  });
  await page.route("**/games/*/votecount?**", async (route) => {
    await fulfillJson(route, []);
  });
  await page.route("**/games/*/day-vote-outcomes?**", async (route) => {
    await fulfillJson(route, []);
  });
  await page.route("**/games/*/host-prompts?**", async (route) => {
    await fulfillJson(route, []);
  });
}

async function provePlayerPhaseTransitionObservation({
  browser,
  frontendBaseUrl,
  roleUrl,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const visitedRolePath = rolePathFromUrl(roleUrl);
  const commandRequests = [];
  try {
    await installPlayerPhaseTransitionObservationRoutes(page, { commandRequests });
    await page.context().addCookies([
      {
        name: "fmarch_fixture_session",
        value: "fixture-player",
        url: frontendBaseUrl,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto(`${frontendBaseUrl}${visitedRolePath}`, {
      waitUntil: "networkidle",
    });
    await page.getByTestId("player-surface").waitFor({
      state: "visible",
      timeout: 15000,
    });
    const staleVoteRecoveryProof = await provePlayerStaleVoteAfterTransition({
      page,
      commandRequests,
    });
    const staleActionRecoveryProof = await provePlayerStaleActionAfterTransition({
      page,
      commandRequests,
    });
    const resyncSnapshot = await page.evaluate(async () => {
      if (typeof window.__fmarchTriggerPlayerResync !== "function") {
        throw new Error("player resync hook is unavailable");
      }
      return window.__fmarchTriggerPlayerResync(802);
    });
    await page.waitForFunction(
      () =>
        window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "N02" &&
        document
          .querySelector('[data-testid="player-action-submission-checkpoint"]')
          ?.getAttribute("data-phase-id") === "N02",
      null,
      { timeout: 15000 },
    );
    const resyncKeys = await page.evaluate(() => window.__fmarchPlayerResyncKeys);
    const projection = await page.evaluate(() => window.__fmarchPlayerProjection);
    const checkpoint = page.getByTestId("player-action-submission-checkpoint");
    const checkpointPhaseId = await checkpoint.getAttribute("data-phase-id");
    const checkpointPhaseState = await checkpoint.getAttribute("data-phase-state");
    const checkpointActionState = await checkpoint.getAttribute("data-action-state");
    const checkpointTargetSlots = await checkpoint.getAttribute("data-target-slots");
    const checkpointReceiptState = await checkpoint.getAttribute("data-receipt-state");
    const bodyText = await page.locator("body").innerText();
    if (/invite=(?!REDACTED)/.test(bodyText)) {
      throw new Error("player phase transition observation leaked an invite URL token");
    }
    return {
      status: "passed",
      sourceRoleUrl: String(roleUrl),
      visitedRolePath,
      surfaceTestId: "player-surface",
      resyncFromSeq: 802,
      resyncKeys,
      staleVoteRecoveryProof,
      staleActionRecoveryProof,
      resyncSnapshotCommandState: resyncSnapshot?.commandState ?? null,
      projectionCommandState: projection?.commandState ?? null,
      checkpointPhaseId,
      checkpointPhaseState,
      checkpointActionState,
      checkpointTargetSlots,
      checkpointReceiptState,
      releaseReady: false,
      productionReady: false,
    };
  } finally {
    await page.close();
  }
}

async function provePlayerStaleVoteAfterTransition({ page, commandRequests }) {
  const setupSnapshot = await page.evaluate(async () => {
    if (typeof window.__fmarchTriggerPlayerResync !== "function") {
      throw new Error("player resync hook is unavailable");
    }
    return window.__fmarchTriggerPlayerResync(801);
  });
  await page.waitForFunction(
    () =>
      window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "D02" &&
      document.querySelector(
        '[data-testid="player-composer"] button[data-action="submit_vote"]',
      ) !== null,
    null,
    { timeout: 15000 },
  );
  const voteButton = page.locator(
    '[data-testid="player-composer"] button[data-action="submit_vote"]',
  );
  await voteButton.waitFor({ state: "visible", timeout: 15000 });
  await voteButton.click();
  await page.waitForFunction(
    () =>
      window.__fmarchPlayerCommandStatus?.state === "reject" &&
      window.__fmarchPlayerCommandStatus?.error === "PhaseLocked" &&
      window.__fmarchPlayerCommandDispatchBridgePlan?.commandKind === "SubmitVote",
    null,
    { timeout: 15000 },
  );
  const proof = await collectPlayerStaleCommandProof({
    page,
    commandRequests,
    clickedAction: "submit_vote",
    commandKind: "SubmitVote",
    commandSelector: "SubmitVote",
  });
  return {
    ...proof,
    setupResyncFromSeq: 801,
    setupSnapshotCommandState: setupSnapshot?.commandState ?? null,
  };
}

async function provePlayerStaleActionAfterTransition({ page, commandRequests }) {
  const actionButton = page.locator(
    '[data-testid="player-action-commands"] button[data-action="submit_action:factional_kill"]',
  );
  await actionButton.waitFor({ state: "visible", timeout: 15000 });
  await actionButton.click();
  await page.waitForFunction(
    () =>
      window.__fmarchPlayerCommandStatus?.state === "reject" &&
      window.__fmarchPlayerCommandStatus?.error === "PhaseLocked" &&
      window.__fmarchPlayerCommandDispatchBridgePlan?.commandKind ===
        "SubmitAction",
    null,
    { timeout: 15000 },
  );
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="player-action-submission-checkpoint"]')
        ?.getAttribute("data-receipt-state") === "reject:PhaseLocked" &&
      document
        .querySelector('[data-testid="player-action-submission-checkpoint"]')
        ?.getAttribute("data-action-state") ===
        "enabled:submit_action:factional_kill",
    null,
    { timeout: 15000 },
  );
  return collectPlayerStaleCommandProof({
    page,
    commandRequests,
    clickedAction: "submit_action:factional_kill",
    commandKind: "SubmitAction",
    commandSelector: "SubmitAction",
  });
}

async function collectPlayerStaleCommandProof({
  page,
  commandRequests,
  clickedAction,
  commandKind,
  commandSelector,
}) {
  const commandStatus = await page.evaluate(() => window.__fmarchPlayerCommandStatus);
  const bridgePlan = await page.evaluate(
    () => window.__fmarchPlayerCommandDispatchBridgePlan,
  );
  const receipts = await page.evaluate(() => window.__fmarchPlayerCommandReceipts);
  const projection = await page.evaluate(() => window.__fmarchPlayerProjection);
  const checkpoint = page.getByTestId("player-action-submission-checkpoint");
  const receiptState = await checkpoint.getAttribute("data-receipt-state");
  const phaseIdAfterReject = await checkpoint.getAttribute("data-phase-id");
  const actionStateAfterReject = await checkpoint.getAttribute("data-action-state");
  const targetSlotsAfterReject = await checkpoint.getAttribute("data-target-slots");
  const recoveryText = await page
    .getByTestId("player-action-submission-recovery")
    .innerText();
  const receiptCountText = await page
    .getByTestId("player-command-receipt-count")
    .innerText();
  const receiptStatusText = await page.getByTestId("player-command-status").innerText();
  const command = commandRequests.at(-1)?.[commandSelector] ?? null;
  return {
    status: "passed",
    clickedAction,
    commandKind: command === null ? null : commandKind,
    command,
    commandStatus,
    bridgePlan,
    receipts,
    projectionCommandState: projection?.commandState ?? null,
    checkpointReceiptState: receiptState,
    checkpointPhaseIdAfterReject: phaseIdAfterReject,
    checkpointActionStateAfterReject: actionStateAfterReject,
    checkpointTargetSlotsAfterReject: targetSlotsAfterReject,
    recoveryText,
    receiptCount: Number.parseInt(receiptCountText, 10),
    receiptStatusText,
  };
}

async function installPlayerPhaseTransitionObservationRoutes(
  page,
  { commandRequests },
) {
  let playerCommandStateMode = "day-vote";
  await page.route("**/commands", async (route) => {
    const commandEnvelope = route.request().postDataJSON();
    const command = commandEnvelope?.body?.body?.command;
    commandRequests.push(command);
    if (command?.SubmitVote !== undefined) {
      playerCommandStateMode = "night-action";
      await fulfillJson(
        route,
        {
          v: 1,
          id: commandEnvelope.id,
          body: {
            kind: "Reject",
            body: {
              error: "PhaseLocked",
              retryable: false,
              message: "phase locked",
            },
          },
        },
        409,
      );
      return;
    }
    if (command?.SubmitAction?.action_id === "factional_kill") {
      playerCommandStateMode = "night-action";
      await fulfillJson(
        route,
        {
          v: 1,
          id: commandEnvelope.id,
          body: {
            kind: "Reject",
            body: {
              error: "PhaseLocked",
              retryable: false,
              message: "phase locked",
            },
          },
        },
        409,
      );
      return;
    }

    await fulfillJson(
      route,
      {
        v: 1,
        id: commandEnvelope?.id ?? "player-stale-action-transition-reject",
        body: {
          kind: "Reject",
            body: {
              error: "WrongPlayerStaleActionProofCommand",
              retryable: false,
              message: "player stale command proof only accepts stale vote or factional kill",
            },
          },
        },
      409,
    );
  });
  await page.route("**/games/*/thread?**", async (route) => {
    await fulfillJson(route, {
      next_before_seq: null,
      posts: [],
    });
  });
  await page.route("**/games/*/channels/*/thread?**", async (route) => {
    await fulfillJson(route, {
      next_before_seq: null,
      posts: [],
    });
  });
  await page.route("**/games/*/votecount?**", async (route) => {
    await fulfillJson(route, []);
  });
  await page.route("**/games/*/day-vote-outcomes?**", async (route) => {
    await fulfillJson(route, []);
  });
  await page.route("**/games/*/notifications?**", async (route) => {
    await fulfillJson(route, []);
  });
  await page.route("**/games/*/investigation-results?**", async (route) => {
    await fulfillJson(route, []);
  });
  await page.route("**/games/*/player-command-state?**", async (route) => {
    await fulfillJson(
      route,
      playerCommandStateMode === "day-vote"
        ? seededDayVoteOpenCommandState({
            boundary:
              "Seeded browser stale Day 2 vote view before host AdvancePhase recovery.",
          })
        : seededActionOpenCommandState({
            boundary:
              "Seeded browser PhaseLocked recovery and player resync observed host AdvancePhase into Night 2.",
          }),
    );
  });
}

async function provePlayerActionSubmissionCheckpoint({
  browser,
  frontendBaseUrl,
  roleUrl,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const visitedRolePath = rolePathFromUrl(roleUrl);
  const commandRequests = [];
  try {
    await installPlayerActionSubmissionBrowserRoutes(page, { commandRequests });
    await page.context().addCookies([
      {
        name: "fmarch_fixture_session",
        value: "fixture-player",
        url: frontendBaseUrl,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto(`${frontendBaseUrl}${visitedRolePath}`, { waitUntil: "networkidle" });
    await page.getByTestId("player-surface").waitFor({
      state: "visible",
      timeout: 15000,
    });
    const checkpoint = page.getByTestId("player-action-submission-checkpoint");
    await checkpoint.waitFor({ state: "visible", timeout: 15000 });
    const proofCheckId = await checkpoint.getAttribute("data-proof-check-id");
    const phaseId = await checkpoint.getAttribute("data-phase-id");
    const phaseState = await checkpoint.getAttribute("data-phase-state");
    const actorSlot = await checkpoint.getAttribute("data-actor-slot");
    const actionState = await checkpoint.getAttribute("data-action-state");
    const selectedAction = await checkpoint.getAttribute("data-selected-action");
    const targetSlots = await checkpoint.getAttribute("data-target-slots");
    const receiptState = await checkpoint.getAttribute("data-receipt-state");
    const visibleRows = [];
    for (const [id, testId] of Object.entries({
      phase: "player-action-submission-phase",
      actor: "player-action-submission-actor",
      actionState: "player-action-submission-action-state",
      target: "player-action-submission-target",
      receipt: "player-action-submission-receipt",
      recovery: "player-action-submission-recovery",
    })) {
      await page.getByTestId(testId).waitFor({ state: "visible", timeout: 15000 });
      visibleRows.push(id);
    }
    const targetText = await page
      .getByTestId("player-action-submission-target")
      .innerText();
    const recoveryText = await page
      .getByTestId("player-action-submission-recovery")
      .innerText();
    const statusText = await page
      .getByTestId("player-action-submission-status")
      .innerText();
    const bodyText = await page.locator("body").innerText();
    if (/invite=(?!REDACTED)/.test(bodyText)) {
      throw new Error("player action checkpoint leaked an invite URL token");
    }
    const clickProof = await provePlayerActionSubmissionClick({
      page,
      commandRequests,
    });
    const invalidRecoveryProof = await provePlayerActionInvalidRecovery({
      browser,
      frontendBaseUrl,
      roleUrl,
    });
    return {
      status: "passed",
      sourceRoleUrl: String(roleUrl),
      visitedRolePath,
      surfaceTestId: "player-surface",
      checkpointTestId: "player-action-submission-checkpoint",
      clickedThroughFromRoleUrl: true,
      playerActionSubmissionCheckpoint: {
        proofCheckId,
        phaseId,
        phaseState,
        actorSlot,
        actionState,
        selectedAction,
        targetSlots,
        receiptState,
        visibleRows,
        targetText,
        recoveryText,
        statusText,
      },
      playerActionSubmissionClickProof: clickProof,
      playerActionInvalidRecoveryProof: invalidRecoveryProof,
      releaseReady: false,
      productionReady: false,
    };
  } finally {
    await page.close();
  }
}

async function installPlayerActionSubmissionBrowserRoutes(page, { commandRequests }) {
  await page.route("**/commands", async (route) => {
    const commandEnvelope = route.request().postDataJSON();
    const command = commandEnvelope?.body?.body?.command;
    commandRequests.push(command);
    if (command?.SubmitAction !== undefined) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          v: 1,
          id: commandEnvelope.id,
          body: {
            kind: "Ack",
            body: {
              stream_seqs: [501],
            },
          },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        v: 1,
        id: commandEnvelope?.id ?? "player-action-submission-reject",
        body: {
          kind: "Reject",
          body: {
            error: "WrongPlayerActionProofCommand",
            retryable: false,
          },
        },
      }),
    });
  });
  await page.route("**/games/*/notifications?**", async (route) => {
    await fulfillJson(route, []);
  });
  await page.route("**/games/*/investigation-results?**", async (route) => {
    await fulfillJson(route, []);
  });
  await page.route("**/games/*/player-command-state?**", async (route) => {
    await fulfillJson(route, {
      game: "seeded-action-open",
      actorSlot: "slot-7",
      actorAlive: true,
      actorStatus: "alive",
      roleKey: "mafia_goon",
      gameCompleted: false,
      phase: {
        phaseId: "N02",
        phaseKind: "Night",
        phaseNumber: 2,
        locked: false,
      },
      actions: [],
      voteTargets: [],
      currentVote: null,
      boundary: "Seeded browser ACK refreshed action state.",
    });
  });
}

async function provePlayerActionInvalidRecovery({
  browser,
  frontendBaseUrl,
  roleUrl,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const visitedRolePath = rolePathFromUrl(roleUrl);
  const commandRequests = [];
  try {
    await installPlayerActionInvalidRecoveryBrowserRoutes(page, {
      commandRequests,
    });
    await page.context().addCookies([
      {
        name: "fmarch_fixture_session",
        value: "fixture-player",
        url: frontendBaseUrl,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto(`${frontendBaseUrl}${visitedRolePath}`, {
      waitUntil: "networkidle",
    });
    await page.getByTestId("player-surface").waitFor({
      state: "visible",
      timeout: 15000,
    });
    const invalidButton = page.locator(
      '[data-testid="player-action-commands"] button[data-action="submit_invalid_action:factional_kill"]',
    );
    await invalidButton.waitFor({ state: "visible", timeout: 15000 });
    await invalidButton.click();
    await page.waitForFunction(
      () =>
        window.__fmarchPlayerCommandStatus?.state === "reject" &&
        window.__fmarchPlayerCommandStatus?.error === "InvalidTarget" &&
        window.__fmarchPlayerCommandDispatchBridgePlan?.commandKind ===
          "SubmitAction",
      null,
      { timeout: 15000 },
    );
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="player-action-submission-checkpoint"]')
          ?.getAttribute("data-receipt-state") === "reject:InvalidTarget",
      null,
      { timeout: 15000 },
    );
    const commandStatus = await page.evaluate(() => window.__fmarchPlayerCommandStatus);
    const bridgePlan = await page.evaluate(
      () => window.__fmarchPlayerCommandDispatchBridgePlan,
    );
    const receipts = await page.evaluate(() => window.__fmarchPlayerCommandReceipts);
    const projection = await page.evaluate(() => window.__fmarchPlayerProjection);
    const checkpoint = page.getByTestId("player-action-submission-checkpoint");
    const receiptState = await checkpoint.getAttribute("data-receipt-state");
    const actionStateAfterReject = await checkpoint.getAttribute("data-action-state");
    const targetSlotsAfterReject = await checkpoint.getAttribute("data-target-slots");
    const receiptCountText = await page
      .getByTestId("player-command-receipt-count")
      .innerText();
    const receiptStatusText = await page.getByTestId("player-command-status").innerText();
    const bodyText = await page.locator("body").innerText();
    if (/invite=(?!REDACTED)/.test(bodyText)) {
      throw new Error("player invalid action proof leaked an invite URL token");
    }
    const command = commandRequests.at(-1)?.SubmitAction ?? null;
    return {
      status: "passed",
      clickedAction: "submit_invalid_action:factional_kill",
      commandKind: command === null ? null : "SubmitAction",
      command,
      commandStatus,
      bridgePlan,
      receipts,
      projectionCommandState: projection?.commandState ?? null,
      checkpointReceiptState: receiptState,
      checkpointActionStateAfterReject: actionStateAfterReject,
      checkpointTargetSlotsAfterReject: targetSlotsAfterReject,
      receiptCount: Number.parseInt(receiptCountText, 10),
      receiptStatusText,
    };
  } finally {
    await page.close();
  }
}

async function installPlayerActionInvalidRecoveryBrowserRoutes(
  page,
  { commandRequests },
) {
  await page.route("**/commands", async (route) => {
    const commandEnvelope = route.request().postDataJSON();
    const command = commandEnvelope?.body?.body?.command;
    commandRequests.push(command);
    if (command?.SubmitAction?.action_id === "invalid_self_factional_kill") {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          v: 1,
          id: commandEnvelope.id,
          body: {
            kind: "Reject",
            body: {
              error: "InvalidTarget",
              retryable: false,
              message: "invalid target",
            },
          },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        v: 1,
        id: commandEnvelope?.id ?? "player-invalid-action-reject",
        body: {
          kind: "Reject",
          body: {
            error: "WrongPlayerInvalidActionProofCommand",
            retryable: false,
            message: "invalid action proof only accepts invalid self action",
          },
        },
      }),
    });
  });
  await page.route("**/games/*/notifications?**", async (route) => {
    await fulfillJson(route, []);
  });
  await page.route("**/games/*/investigation-results?**", async (route) => {
    await fulfillJson(route, []);
  });
  await page.route("**/games/*/player-command-state?**", async (route) => {
    await fulfillJson(route, seededActionOpenCommandState({
      boundary: "Seeded browser InvalidTarget recovery kept legal action controls.",
    }));
  });
}

async function proveTargetResolutionReceiptSurface({
  browser,
  frontendBaseUrl,
  roleUrl,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const visitedRolePath = rolePathFromUrl(roleUrl);
  try {
    await installTargetResolutionReceiptBrowserRoutes(page);
    await page.context().addCookies([
      {
        name: "fmarch_fixture_session",
        value: "fixture-target",
        url: frontendBaseUrl,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto(`${frontendBaseUrl}${visitedRolePath}`, {
      waitUntil: "networkidle",
    });
    await page.getByTestId("player-surface").waitFor({
      state: "visible",
      timeout: 15000,
    });
    const resyncSnapshot = await page.evaluate(async () => {
      if (typeof window.__fmarchTriggerPlayerResync !== "function") {
        throw new Error("player resync hook is unavailable");
      }
      return window.__fmarchTriggerPlayerResync(901);
    });
    await page.waitForFunction(
      () =>
        window.__fmarchPlayerProjection?.commandState?.actorSlot === "slot-2" &&
        window.__fmarchPlayerProjection?.notifications?.[0]?.effect ===
          "player_killed",
      null,
      { timeout: 15000 },
    );
    const checkpoint = page.getByTestId("player-action-submission-checkpoint");
    await checkpoint.waitFor({ state: "visible", timeout: 15000 });
    const privateQueue = page.locator('[data-component="player-private-queue"]');
    await privateQueue.waitFor({ state: "visible", timeout: 15000 });
    const privateNotice = page.getByTestId("player-private-notification-1");
    await privateNotice.waitFor({ state: "visible", timeout: 15000 });
    const privateNoticeDetail = page.getByTestId(
      "player-private-detail-notification-1",
    );
    await privateNoticeDetail.waitFor({ state: "visible", timeout: 15000 });
    const checkpointPhaseId = await checkpoint.getAttribute("data-phase-id");
    const checkpointPhaseState = await checkpoint.getAttribute("data-phase-state");
    const checkpointActorSlot = await checkpoint.getAttribute("data-actor-slot");
    const checkpointActionState = await checkpoint.getAttribute("data-action-state");
    const checkpointReceiptState = await checkpoint.getAttribute("data-receipt-state");
    const privateBoundaryStatus = await privateQueue.getAttribute(
      "data-boundary-status",
    );
    const privateCount = Number.parseInt(
      await page.getByTestId("player-private-count").innerText(),
      10,
    );
    const privateBoundaryText = await page
      .getByTestId("player-private-boundary")
      .innerText();
    const privateNoticeKind = await privateNotice.getAttribute("data-kind");
    const privateNoticeText = await privateNotice.innerText();
    const privateNoticeDetailText = await privateNoticeDetail.innerText();
    const actionStatusText = await page
      .getByTestId("player-action-submission-status")
      .innerText();
    const projection = await page.evaluate(() => window.__fmarchPlayerProjection);
    const coldLoadEndpoints = await page.evaluate(
      () => window.__fmarchPlayerColdLoadEndpoints,
    );
    const bodyText = await page.locator("body").innerText();
    if (/invite=(?!REDACTED)/.test(bodyText)) {
      throw new Error("target resolution receipt proof leaked an invite URL token");
    }
    return {
      status: "passed",
      sourceRoleUrl: String(roleUrl),
      visitedRolePath,
      surfaceTestId: "player-surface",
      clickedThroughFromRoleUrl: true,
      targetSlot: "slot-2",
      principalUserId: "player_ilya",
      checkpoint: {
        phaseId: checkpointPhaseId,
        phaseState: checkpointPhaseState,
        actorSlot: checkpointActorSlot,
        actionState: checkpointActionState,
        receiptState: checkpointReceiptState,
        statusText: actionStatusText,
      },
      privateQueueBoundary: {
        status: privateBoundaryStatus,
        count: privateCount,
        text: privateBoundaryText,
      },
      privateNotice: {
        id: "notification-1",
        kind: privateNoticeKind,
        text: privateNoticeText,
        detailText: privateNoticeDetailText,
      },
      projectionCommandState: projection?.commandState ?? null,
      projectionNotifications: projection?.notifications ?? null,
      resyncFromSeq: 901,
      resyncSnapshotCommandState: resyncSnapshot?.commandState ?? null,
      resyncSnapshotNotifications: resyncSnapshot?.notifications ?? null,
      coldLoadEndpoints,
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    };
  } finally {
    await page.close();
  }
}

async function installTargetResolutionReceiptBrowserRoutes(page) {
  await page.route("**/games/*/thread?**", async (route) => {
    await fulfillJson(route, {
      next_before_seq: null,
      posts: [
        {
          source_seq: 901,
          stream_seq: 901,
          author_slot: "host",
          author_user: "host_h",
          body: "Night 1 has resolved.",
          occurred_at: 1781841600,
        },
      ],
    });
  });
  await page.route("**/games/*/channels/*/thread?**", async (route) => {
    await fulfillJson(route, {
      next_before_seq: null,
      posts: [],
    });
  });
  await page.route("**/games/*/votecount?**", async (route) => {
    await fulfillJson(route, []);
  });
  await page.route("**/games/*/day-vote-outcomes?**", async (route) => {
    await fulfillJson(route, []);
  });
  await page.route("**/games/*/notifications?**", async (route) => {
    await fulfillJson(route, [
      {
        effect: "player_killed",
        phase_id: "N01",
        status: "factional_kill",
      },
    ]);
  });
  await page.route("**/games/*/investigation-results?**", async (route) => {
    await fulfillJson(route, []);
  });
  await page.route("**/games/*/player-command-state?**", async (route) => {
    await fulfillJson(route, seededTargetKilledCommandState({
      boundary:
        "Seeded browser target role received factional_kill private receipt after N01 resolution.",
    }));
  });
}

async function proveNormalResolutionPrivacySurface({
  browser,
  frontendBaseUrl,
  roleUrl,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const visitedRolePath = rolePathFromUrl(roleUrl);
  try {
    await installNormalResolutionPrivacyBrowserRoutes(page);
    await page.context().addCookies([
      {
        name: "fmarch_fixture_session",
        value: "fixture-normal",
        url: frontendBaseUrl,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto(`${frontendBaseUrl}${visitedRolePath}`, {
      waitUntil: "networkidle",
    });
    await page.getByTestId("player-surface").waitFor({
      state: "visible",
      timeout: 15000,
    });
    const resyncSnapshot = await page.evaluate(async () => {
      if (typeof window.__fmarchTriggerPlayerResync !== "function") {
        throw new Error("player resync hook is unavailable");
      }
      return window.__fmarchTriggerPlayerResync(901);
    });
    await page.waitForFunction(
      () =>
        window.__fmarchPlayerProjection?.commandState?.actorSlot === "slot-4" &&
        Array.isArray(window.__fmarchPlayerProjection?.notifications) &&
        window.__fmarchPlayerProjection.notifications.length === 0,
      null,
      { timeout: 15000 },
    );
    const checkpoint = page.getByTestId("player-action-submission-checkpoint");
    await checkpoint.waitFor({ state: "visible", timeout: 15000 });
    const privateQueue = page.locator('[data-component="player-private-queue"]');
    await privateQueue.waitFor({ state: "visible", timeout: 15000 });
    const privateEmpty = page.getByTestId("player-private-empty");
    await privateEmpty.waitFor({ state: "visible", timeout: 15000 });
    const checkpointPhaseId = await checkpoint.getAttribute("data-phase-id");
    const checkpointPhaseState = await checkpoint.getAttribute("data-phase-state");
    const checkpointActorSlot = await checkpoint.getAttribute("data-actor-slot");
    const checkpointActionState = await checkpoint.getAttribute("data-action-state");
    const checkpointReceiptState = await checkpoint.getAttribute("data-receipt-state");
    const privateBoundaryStatus = await privateQueue.getAttribute(
      "data-boundary-status",
    );
    const privateCount = Number.parseInt(
      await page.getByTestId("player-private-count").innerText(),
      10,
    );
    const privateBoundaryText = await page
      .getByTestId("player-private-boundary")
      .innerText();
    const privateEmptyText = await privateEmpty.innerText();
    const actionStatusText = await page
      .getByTestId("player-action-submission-status")
      .innerText();
    const projection = await page.evaluate(() => window.__fmarchPlayerProjection);
    const coldLoadEndpoints = await page.evaluate(
      () => window.__fmarchPlayerColdLoadEndpoints,
    );
    const bodyText = await page.locator("body").innerText();
    if (/invite=(?!REDACTED)/.test(bodyText)) {
      throw new Error("normal resolution privacy proof leaked an invite URL token");
    }
    if (bodyText.includes("player_killed") || bodyText.includes("factional_kill")) {
      throw new Error("normal resolution privacy proof rendered target-only receipt");
    }
    return {
      status: "passed",
      sourceRoleUrl: String(roleUrl),
      visitedRolePath,
      surfaceTestId: "player-surface",
      clickedThroughFromRoleUrl: true,
      normalSlot: "slot-4",
      principalUserId: "player_rowan",
      checkpoint: {
        phaseId: checkpointPhaseId,
        phaseState: checkpointPhaseState,
        actorSlot: checkpointActorSlot,
        actionState: checkpointActionState,
        receiptState: checkpointReceiptState,
        statusText: actionStatusText,
      },
      privateQueueBoundary: {
        status: privateBoundaryStatus,
        count: privateCount,
        text: privateBoundaryText,
      },
      privateEmptyText,
      targetReceiptVisible: false,
      projectionCommandState: projection?.commandState ?? null,
      projectionNotifications: projection?.notifications ?? null,
      resyncFromSeq: 901,
      resyncSnapshotCommandState: resyncSnapshot?.commandState ?? null,
      resyncSnapshotNotifications: resyncSnapshot?.notifications ?? null,
      coldLoadEndpoints,
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    };
  } finally {
    await page.close();
  }
}

async function installNormalResolutionPrivacyBrowserRoutes(page) {
  await page.route("**/games/*/thread?**", async (route) => {
    await fulfillJson(route, {
      next_before_seq: null,
      posts: [
        {
          source_seq: 901,
          stream_seq: 901,
          author_slot: "host",
          author_user: "host_h",
          body: "Night 1 has resolved.",
          occurred_at: 1781841600,
        },
      ],
    });
  });
  await page.route("**/games/*/channels/*/thread?**", async (route) => {
    await fulfillJson(route, {
      next_before_seq: null,
      posts: [],
    });
  });
  await page.route("**/games/*/votecount?**", async (route) => {
    await fulfillJson(route, []);
  });
  await page.route("**/games/*/day-vote-outcomes?**", async (route) => {
    await fulfillJson(route, []);
  });
  await page.route("**/games/*/notifications?**", async (route) => {
    await fulfillJson(route, []);
  });
  await page.route("**/games/*/investigation-results?**", async (route) => {
    await fulfillJson(route, []);
  });
  await page.route("**/games/*/player-command-state?**", async (route) => {
    await fulfillJson(route, seededNormalResolvedCommandState({
      boundary:
        "Seeded browser normal role received no target-only private receipt after N01 resolution.",
    }));
  });
}

async function proveTargetDayVoteReceiptSurface({
  browser,
  frontendBaseUrl,
  roleUrl,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const visitedRolePath = rolePathFromUrl(roleUrl);
  try {
    await installTargetDayVoteReceiptBrowserRoutes(page);
    await page.context().addCookies([
      {
        name: "fmarch_fixture_session",
        value: "fixture-target",
        url: frontendBaseUrl,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto(`${frontendBaseUrl}${visitedRolePath}`, {
      waitUntil: "networkidle",
    });
    await page.getByTestId("player-surface").waitFor({
      state: "visible",
      timeout: 15000,
    });
    const resyncSnapshot = await page.evaluate(async () => {
      if (typeof window.__fmarchTriggerPlayerResync !== "function") {
        throw new Error("player resync hook is unavailable");
      }
      return window.__fmarchTriggerPlayerResync(902);
    });
    await page.waitForFunction(
      () =>
        window.__fmarchPlayerProjection?.commandState?.actorSlot === "slot-2" &&
        window.__fmarchPlayerProjection?.notifications?.[0]?.status ===
          "day_vote",
      null,
      { timeout: 15000 },
    );
    const checkpoint = page.getByTestId("player-action-submission-checkpoint");
    await checkpoint.waitFor({ state: "visible", timeout: 15000 });
    const privateQueue = page.locator('[data-component="player-private-queue"]');
    await privateQueue.waitFor({ state: "visible", timeout: 15000 });
    const privateNotice = page.getByTestId("player-private-notification-1");
    await privateNotice.waitFor({ state: "visible", timeout: 15000 });
    const privateNoticeDetail = page.getByTestId(
      "player-private-detail-notification-1",
    );
    await privateNoticeDetail.waitFor({ state: "visible", timeout: 15000 });
    const checkpointPhaseId = await checkpoint.getAttribute("data-phase-id");
    const checkpointPhaseState = await checkpoint.getAttribute("data-phase-state");
    const checkpointActorSlot = await checkpoint.getAttribute("data-actor-slot");
    const checkpointActionState = await checkpoint.getAttribute("data-action-state");
    const checkpointReceiptState = await checkpoint.getAttribute("data-receipt-state");
    const privateBoundaryStatus = await privateQueue.getAttribute(
      "data-boundary-status",
    );
    const privateCount = Number.parseInt(
      await page.getByTestId("player-private-count").innerText(),
      10,
    );
    const privateBoundaryText = await page
      .getByTestId("player-private-boundary")
      .innerText();
    const privateNoticeKind = await privateNotice.getAttribute("data-kind");
    const privateNoticeText = await privateNotice.innerText();
    const privateNoticeDetailText = await privateNoticeDetail.innerText();
    const actionStatusText = await page
      .getByTestId("player-action-submission-status")
      .innerText();
    const projection = await page.evaluate(() => window.__fmarchPlayerProjection);
    const coldLoadEndpoints = await page.evaluate(
      () => window.__fmarchPlayerColdLoadEndpoints,
    );
    const bodyText = await page.locator("body").innerText();
    if (/invite=(?!REDACTED)/.test(bodyText)) {
      throw new Error("target day-vote receipt proof leaked an invite URL token");
    }
    return {
      status: "passed",
      sourceRoleUrl: String(roleUrl),
      visitedRolePath,
      surfaceTestId: "player-surface",
      clickedThroughFromRoleUrl: true,
      targetSlot: "slot-2",
      principalUserId: "player_ilya",
      checkpoint: {
        phaseId: checkpointPhaseId,
        phaseState: checkpointPhaseState,
        actorSlot: checkpointActorSlot,
        actionState: checkpointActionState,
        receiptState: checkpointReceiptState,
        statusText: actionStatusText,
      },
      privateQueueBoundary: {
        status: privateBoundaryStatus,
        count: privateCount,
        text: privateBoundaryText,
      },
      privateNotice: {
        id: "notification-1",
        kind: privateNoticeKind,
        text: privateNoticeText,
        detailText: privateNoticeDetailText,
      },
      projectionCommandState: projection?.commandState ?? null,
      projectionNotifications: projection?.notifications ?? null,
      resyncFromSeq: 902,
      resyncSnapshotCommandState: resyncSnapshot?.commandState ?? null,
      resyncSnapshotNotifications: resyncSnapshot?.notifications ?? null,
      coldLoadEndpoints,
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    };
  } finally {
    await page.close();
  }
}

async function installTargetDayVoteReceiptBrowserRoutes(page) {
  await installDayVoteResolvedCommonRoutes(page, {
    notifications: [
      {
        effect: "player_killed",
        phase_id: "D02",
        status: "day_vote",
      },
    ],
    commandState: seededDayVoteTargetKilledCommandState({
      boundary:
        "Seeded browser target role received day_vote private receipt after D02 resolution.",
    }),
  });
}

async function proveNormalDayVotePrivacySurface({
  browser,
  frontendBaseUrl,
  roleUrl,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const visitedRolePath = rolePathFromUrl(roleUrl);
  try {
    await installNormalDayVotePrivacyBrowserRoutes(page);
    await page.context().addCookies([
      {
        name: "fmarch_fixture_session",
        value: "fixture-normal",
        url: frontendBaseUrl,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto(`${frontendBaseUrl}${visitedRolePath}`, {
      waitUntil: "networkidle",
    });
    await page.getByTestId("player-surface").waitFor({
      state: "visible",
      timeout: 15000,
    });
    const resyncSnapshot = await page.evaluate(async () => {
      if (typeof window.__fmarchTriggerPlayerResync !== "function") {
        throw new Error("player resync hook is unavailable");
      }
      return window.__fmarchTriggerPlayerResync(902);
    });
    await page.waitForFunction(
      () =>
        window.__fmarchPlayerProjection?.commandState?.actorSlot === "slot-4" &&
        Array.isArray(window.__fmarchPlayerProjection?.notifications) &&
        window.__fmarchPlayerProjection.notifications.length === 0,
      null,
      { timeout: 15000 },
    );
    const checkpoint = page.getByTestId("player-action-submission-checkpoint");
    await checkpoint.waitFor({ state: "visible", timeout: 15000 });
    const privateQueue = page.locator('[data-component="player-private-queue"]');
    await privateQueue.waitFor({ state: "visible", timeout: 15000 });
    const privateEmpty = page.getByTestId("player-private-empty");
    await privateEmpty.waitFor({ state: "visible", timeout: 15000 });
    const checkpointPhaseId = await checkpoint.getAttribute("data-phase-id");
    const checkpointPhaseState = await checkpoint.getAttribute("data-phase-state");
    const checkpointActorSlot = await checkpoint.getAttribute("data-actor-slot");
    const checkpointActionState = await checkpoint.getAttribute("data-action-state");
    const checkpointReceiptState = await checkpoint.getAttribute("data-receipt-state");
    const privateBoundaryStatus = await privateQueue.getAttribute(
      "data-boundary-status",
    );
    const privateCount = Number.parseInt(
      await page.getByTestId("player-private-count").innerText(),
      10,
    );
    const privateBoundaryText = await page
      .getByTestId("player-private-boundary")
      .innerText();
    const privateEmptyText = await privateEmpty.innerText();
    const actionStatusText = await page
      .getByTestId("player-action-submission-status")
      .innerText();
    const projection = await page.evaluate(() => window.__fmarchPlayerProjection);
    const coldLoadEndpoints = await page.evaluate(
      () => window.__fmarchPlayerColdLoadEndpoints,
    );
    const bodyText = await page.locator("body").innerText();
    if (/invite=(?!REDACTED)/.test(bodyText)) {
      throw new Error("normal day-vote privacy proof leaked an invite URL token");
    }
    if (bodyText.includes("player_killed") || bodyText.includes("day_vote")) {
      throw new Error("normal day-vote privacy proof rendered target-only receipt");
    }
    return {
      status: "passed",
      sourceRoleUrl: String(roleUrl),
      visitedRolePath,
      surfaceTestId: "player-surface",
      clickedThroughFromRoleUrl: true,
      normalSlot: "slot-4",
      principalUserId: "player_rowan",
      checkpoint: {
        phaseId: checkpointPhaseId,
        phaseState: checkpointPhaseState,
        actorSlot: checkpointActorSlot,
        actionState: checkpointActionState,
        receiptState: checkpointReceiptState,
        statusText: actionStatusText,
      },
      privateQueueBoundary: {
        status: privateBoundaryStatus,
        count: privateCount,
        text: privateBoundaryText,
      },
      privateEmptyText,
      targetReceiptVisible: false,
      projectionCommandState: projection?.commandState ?? null,
      projectionNotifications: projection?.notifications ?? null,
      resyncFromSeq: 902,
      resyncSnapshotCommandState: resyncSnapshot?.commandState ?? null,
      resyncSnapshotNotifications: resyncSnapshot?.notifications ?? null,
      coldLoadEndpoints,
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    };
  } finally {
    await page.close();
  }
}

async function installNormalDayVotePrivacyBrowserRoutes(page) {
  await installDayVoteResolvedCommonRoutes(page, {
    notifications: [],
    commandState: seededDayVoteNormalResolvedCommandState({
      boundary:
        "Seeded browser normal role received no target-only private receipt after D02 resolution.",
    }),
  });
}

async function proveTargetPostDayVoteAdvanceSurface({
  browser,
  frontendBaseUrl,
  roleUrl,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const visitedRolePath = rolePathFromUrl(roleUrl);
  try {
    await installTargetPostDayVoteAdvanceBrowserRoutes(page);
    await page.context().addCookies([
      {
        name: "fmarch_fixture_session",
        value: "fixture-target",
        url: frontendBaseUrl,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto(`${frontendBaseUrl}${visitedRolePath}`, {
      waitUntil: "networkidle",
    });
    await page.getByTestId("player-surface").waitFor({
      state: "visible",
      timeout: 15000,
    });
    const resyncSnapshot = await page.evaluate(async () => {
      if (typeof window.__fmarchTriggerPlayerResync !== "function") {
        throw new Error("player resync hook is unavailable");
      }
      return window.__fmarchTriggerPlayerResync(903);
    });
    await page.waitForFunction(
      () =>
        window.__fmarchPlayerProjection?.commandState?.actorSlot === "slot-2" &&
        window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "N02" &&
        window.__fmarchPlayerProjection?.notifications?.[0]?.status ===
          "day_vote",
      null,
      { timeout: 15000 },
    );
    const checkpoint = page.getByTestId("player-action-submission-checkpoint");
    await checkpoint.waitFor({ state: "visible", timeout: 15000 });
    const privateQueue = page.locator('[data-component="player-private-queue"]');
    await privateQueue.waitFor({ state: "visible", timeout: 15000 });
    const privateNotice = page.getByTestId("player-private-notification-1");
    await privateNotice.waitFor({ state: "visible", timeout: 15000 });
    const privateNoticeDetail = page.getByTestId(
      "player-private-detail-notification-1",
    );
    await privateNoticeDetail.waitFor({ state: "visible", timeout: 15000 });
    const checkpointPhaseId = await checkpoint.getAttribute("data-phase-id");
    const checkpointPhaseState = await checkpoint.getAttribute("data-phase-state");
    const checkpointActorSlot = await checkpoint.getAttribute("data-actor-slot");
    const checkpointActionState = await checkpoint.getAttribute("data-action-state");
    const checkpointReceiptState = await checkpoint.getAttribute("data-receipt-state");
    const privateBoundaryStatus = await privateQueue.getAttribute(
      "data-boundary-status",
    );
    const privateCount = Number.parseInt(
      await page.getByTestId("player-private-count").innerText(),
      10,
    );
    const privateBoundaryText = await page
      .getByTestId("player-private-boundary")
      .innerText();
    const privateNoticeKind = await privateNotice.getAttribute("data-kind");
    const privateNoticeText = await privateNotice.innerText();
    const privateNoticeDetailText = await privateNoticeDetail.innerText();
    const actionStatusText = await page
      .getByTestId("player-action-submission-status")
      .innerText();
    const projection = await page.evaluate(() => window.__fmarchPlayerProjection);
    const coldLoadEndpoints = await page.evaluate(
      () => window.__fmarchPlayerColdLoadEndpoints,
    );
    const bodyText = await page.locator("body").innerText();
    if (/invite=(?!REDACTED)/.test(bodyText)) {
      throw new Error("target post-day-vote advance proof leaked an invite URL token");
    }
    return {
      status: "passed",
      sourceRoleUrl: String(roleUrl),
      visitedRolePath,
      surfaceTestId: "player-surface",
      clickedThroughFromRoleUrl: true,
      targetSlot: "slot-2",
      principalUserId: "player_ilya",
      checkpoint: {
        phaseId: checkpointPhaseId,
        phaseState: checkpointPhaseState,
        actorSlot: checkpointActorSlot,
        actionState: checkpointActionState,
        receiptState: checkpointReceiptState,
        statusText: actionStatusText,
      },
      privateQueueBoundary: {
        status: privateBoundaryStatus,
        count: privateCount,
        text: privateBoundaryText,
      },
      privateNotice: {
        id: "notification-1",
        kind: privateNoticeKind,
        text: privateNoticeText,
        detailText: privateNoticeDetailText,
      },
      projectionCommandState: projection?.commandState ?? null,
      projectionNotifications: projection?.notifications ?? null,
      resyncFromSeq: 903,
      resyncSnapshotCommandState: resyncSnapshot?.commandState ?? null,
      resyncSnapshotNotifications: resyncSnapshot?.notifications ?? null,
      coldLoadEndpoints,
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    };
  } finally {
    await page.close();
  }
}

async function installTargetPostDayVoteAdvanceBrowserRoutes(page) {
  await installPostDayVoteAdvanceCommonRoutes(page, {
    notifications: [
      {
        effect: "player_killed",
        phase_id: "D02",
        status: "day_vote",
      },
    ],
    commandState: seededPostDayVoteAdvanceTargetCommandState({
      boundary:
        "Seeded browser target role remained dead after host advanced D02 to open N02.",
    }),
  });
}

async function proveNormalPostDayVoteAdvanceSurface({
  browser,
  frontendBaseUrl,
  roleUrl,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const visitedRolePath = rolePathFromUrl(roleUrl);
  try {
    await installNormalPostDayVoteAdvanceBrowserRoutes(page);
    await page.context().addCookies([
      {
        name: "fmarch_fixture_session",
        value: "fixture-normal",
        url: frontendBaseUrl,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto(`${frontendBaseUrl}${visitedRolePath}`, {
      waitUntil: "networkidle",
    });
    await page.getByTestId("player-surface").waitFor({
      state: "visible",
      timeout: 15000,
    });
    const resyncSnapshot = await page.evaluate(async () => {
      if (typeof window.__fmarchTriggerPlayerResync !== "function") {
        throw new Error("player resync hook is unavailable");
      }
      return window.__fmarchTriggerPlayerResync(903);
    });
    await page.waitForFunction(
      () =>
        window.__fmarchPlayerProjection?.commandState?.actorSlot === "slot-4" &&
        window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "N02" &&
        Array.isArray(window.__fmarchPlayerProjection?.notifications) &&
        window.__fmarchPlayerProjection.notifications.length === 0,
      null,
      { timeout: 15000 },
    );
    const checkpoint = page.getByTestId("player-action-submission-checkpoint");
    await checkpoint.waitFor({ state: "visible", timeout: 15000 });
    const privateQueue = page.locator('[data-component="player-private-queue"]');
    await privateQueue.waitFor({ state: "visible", timeout: 15000 });
    const privateEmpty = page.getByTestId("player-private-empty");
    await privateEmpty.waitFor({ state: "visible", timeout: 15000 });
    const checkpointPhaseId = await checkpoint.getAttribute("data-phase-id");
    const checkpointPhaseState = await checkpoint.getAttribute("data-phase-state");
    const checkpointActorSlot = await checkpoint.getAttribute("data-actor-slot");
    const checkpointActionState = await checkpoint.getAttribute("data-action-state");
    const checkpointReceiptState = await checkpoint.getAttribute("data-receipt-state");
    const privateBoundaryStatus = await privateQueue.getAttribute(
      "data-boundary-status",
    );
    const privateCount = Number.parseInt(
      await page.getByTestId("player-private-count").innerText(),
      10,
    );
    const privateBoundaryText = await page
      .getByTestId("player-private-boundary")
      .innerText();
    const privateEmptyText = await privateEmpty.innerText();
    const actionStatusText = await page
      .getByTestId("player-action-submission-status")
      .innerText();
    const projection = await page.evaluate(() => window.__fmarchPlayerProjection);
    const coldLoadEndpoints = await page.evaluate(
      () => window.__fmarchPlayerColdLoadEndpoints,
    );
    const bodyText = await page.locator("body").innerText();
    if (/invite=(?!REDACTED)/.test(bodyText)) {
      throw new Error("normal post-day-vote advance proof leaked an invite URL token");
    }
    if (bodyText.includes("player_killed") || bodyText.includes("day_vote")) {
      throw new Error(
        "normal post-day-vote advance proof rendered target-only receipt",
      );
    }
    return {
      status: "passed",
      sourceRoleUrl: String(roleUrl),
      visitedRolePath,
      surfaceTestId: "player-surface",
      clickedThroughFromRoleUrl: true,
      normalSlot: "slot-4",
      principalUserId: "player_rowan",
      checkpoint: {
        phaseId: checkpointPhaseId,
        phaseState: checkpointPhaseState,
        actorSlot: checkpointActorSlot,
        actionState: checkpointActionState,
        receiptState: checkpointReceiptState,
        statusText: actionStatusText,
      },
      privateQueueBoundary: {
        status: privateBoundaryStatus,
        count: privateCount,
        text: privateBoundaryText,
      },
      privateEmptyText,
      targetReceiptVisible: false,
      projectionCommandState: projection?.commandState ?? null,
      projectionNotifications: projection?.notifications ?? null,
      resyncFromSeq: 903,
      resyncSnapshotCommandState: resyncSnapshot?.commandState ?? null,
      resyncSnapshotNotifications: resyncSnapshot?.notifications ?? null,
      coldLoadEndpoints,
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    };
  } finally {
    await page.close();
  }
}

async function installNormalPostDayVoteAdvanceBrowserRoutes(page) {
  await installPostDayVoteAdvanceCommonRoutes(page, {
    notifications: [],
    commandState: seededPostDayVoteAdvanceNormalCommandState({
      boundary:
        "Seeded browser normal role stayed alive with no target-only receipt after host advanced D02 to open N02.",
    }),
  });
}

async function installDayVoteResolvedCommonRoutes(
  page,
  { notifications, commandState },
) {
  await page.route("**/games/*/thread?**", async (route) => {
    await fulfillJson(route, {
      next_before_seq: null,
      posts: [
        {
          source_seq: 902,
          stream_seq: 902,
          author_slot: "host",
          author_user: "host_h",
          body: "Day 2 has resolved.",
          occurred_at: 1782014400,
        },
      ],
    });
  });
  await page.route("**/games/*/channels/*/thread?**", async (route) => {
    await fulfillJson(route, {
      next_before_seq: null,
      posts: [],
    });
  });
  await page.route("**/games/*/votecount?**", async (route) => {
    await fulfillJson(route, []);
  });
  await page.route("**/games/*/day-vote-outcomes?**", async (route) => {
    await fulfillJson(route, [
      {
        phase_id: "D02",
        source_seq: 902,
        event_index: 0,
        status: "Lynch",
        winner_slot: "slot-2",
        tallies: { "slot-2": 4 },
        majority: 4,
        reason: null,
      },
    ]);
  });
  await page.route("**/games/*/notifications?**", async (route) => {
    await fulfillJson(route, notifications);
  });
  await page.route("**/games/*/investigation-results?**", async (route) => {
    await fulfillJson(route, []);
  });
  await page.route("**/games/*/player-command-state?**", async (route) => {
    await fulfillJson(route, commandState);
  });
}

async function installPostDayVoteAdvanceCommonRoutes(
  page,
  { notifications, commandState },
) {
  await page.route("**/games/*/thread?**", async (route) => {
    await fulfillJson(route, {
      next_before_seq: null,
      posts: [
        {
          source_seq: 903,
          stream_seq: 903,
          author_slot: "host",
          author_user: "host_h",
          body: "Night 2 has opened.",
          occurred_at: 1782018000,
        },
      ],
    });
  });
  await page.route("**/games/*/channels/*/thread?**", async (route) => {
    await fulfillJson(route, {
      next_before_seq: null,
      posts: [],
    });
  });
  await page.route("**/games/*/votecount?**", async (route) => {
    await fulfillJson(route, []);
  });
  await page.route("**/games/*/day-vote-outcomes?**", async (route) => {
    await fulfillJson(route, [
      {
        phase_id: "D02",
        source_seq: 902,
        event_index: 0,
        status: "Lynch",
        winner_slot: "slot-2",
        tallies: { "slot-2": 4 },
        majority: 4,
        reason: null,
      },
    ]);
  });
  await page.route("**/games/*/notifications?**", async (route) => {
    await fulfillJson(route, notifications);
  });
  await page.route("**/games/*/investigation-results?**", async (route) => {
    await fulfillJson(route, []);
  });
  await page.route("**/games/*/player-command-state?**", async (route) => {
    await fulfillJson(route, commandState);
  });
}

async function provePlayerActionSubmissionClick({ page, commandRequests }) {
  const actionButton = page.locator(
    '[data-testid="player-action-commands"] button[data-action="submit_action:factional_kill"]',
  );
  await actionButton.waitFor({ state: "visible", timeout: 15000 });
  await actionButton.click();
  await page.waitForFunction(
    () =>
      window.__fmarchPlayerCommandStatus?.state === "ack" &&
      window.__fmarchPlayerCommandDispatchBridgePlan?.commandKind === "SubmitAction",
    null,
    { timeout: 15000 },
  );
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="player-action-submission-checkpoint"]')
        ?.getAttribute("data-receipt-state")
        ?.startsWith("ack:") === true,
    null,
    { timeout: 15000 },
  );
  const commandStatus = await page.evaluate(() => window.__fmarchPlayerCommandStatus);
  const bridgePlan = await page.evaluate(
    () => window.__fmarchPlayerCommandDispatchBridgePlan,
  );
  const receipts = await page.evaluate(() => window.__fmarchPlayerCommandReceipts);
  const projection = await page.evaluate(() => window.__fmarchPlayerProjection);
  const checkpoint = page.getByTestId("player-action-submission-checkpoint");
  const receiptState = await checkpoint.getAttribute("data-receipt-state");
  const actionStateAfterAck = await checkpoint.getAttribute("data-action-state");
  const receiptCountText = await page
    .getByTestId("player-command-receipt-count")
    .innerText();
  const receiptStatusText = await page.getByTestId("player-command-status").innerText();
  const command = commandRequests.at(-1)?.SubmitAction ?? null;
  return {
    status: "passed",
    clickedAction: "submit_action:factional_kill",
    commandKind: command === null ? null : "SubmitAction",
    command,
    commandStatus,
    bridgePlan,
    receipts,
    projectionCommandState: projection?.commandState ?? null,
    checkpointReceiptState: receiptState,
    checkpointActionStateAfterAck: actionStateAfterAck,
    receiptCount: Number.parseInt(receiptCountText, 10),
    receiptStatusText,
  };
}

async function provePrivateChannelRoleSurface({
  browser,
  frontendBaseUrl,
  roleUrl,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const visitedRolePath = rolePathFromUrl(roleUrl);
  const commandRequests = [];
  const privatePostBody = "Private role proof post";
  try {
    await installPrivateChannelBrowserRoutes(page, {
      commandRequests,
      privatePostBody,
    });
    await page.context().addCookies([
      {
        name: "fmarch_fixture_session",
        value: "fixture-player",
        url: frontendBaseUrl,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto(`${frontendBaseUrl}${visitedRolePath}`, {
      waitUntil: "networkidle",
    });
    await page.getByTestId("player-surface").waitFor({
      state: "visible",
      timeout: 15000,
    });
    const privateChannel = page.getByTestId("player-channel-role-pm");
    await privateChannel.waitFor({ state: "visible", timeout: 15000 });
    const channelAriaCurrent = await privateChannel.getAttribute("aria-current");
    const commandPanel = page.getByTestId("player-primary-action-zone");
    await commandPanel.waitFor({ state: "visible", timeout: 15000 });
    const commandPanelChannelId = await commandPanel.getAttribute("data-channel-id");
    const channelContext = page.getByTestId("player-command-channel-context");
    await channelContext.waitFor({ state: "visible", timeout: 15000 });
    const channelContextChannelId = await channelContext.getAttribute(
      "data-channel-id",
    );
    const channelContextCapabilityLabel = await channelContext.getAttribute(
      "data-capability-label",
    );
    const boundary = page.getByTestId("player-private-boundary");
    await boundary.waitFor({ state: "visible", timeout: 15000 });
    const privateQueue = page.locator('[data-component="player-private-queue"]');
    const privateBoundaryStatus = await privateQueue.getAttribute(
      "data-boundary-status",
    );
    const privateBoundaryText = await boundary.innerText();
    const privateCount = Number.parseInt(
      await page.getByTestId("player-private-count").innerText(),
      10,
    );
    const expandedPrivateDetail = page.getByTestId(
      "player-private-detail-notification-1",
    );
    await expandedPrivateDetail.waitFor({ state: "visible", timeout: 15000 });
    const expandedPrivateDetailText = await expandedPrivateDetail.innerText();
    await page.locator('[data-testid="player-composer"] textarea').fill(
      privatePostBody,
    );
    await page
      .locator('[data-testid="player-composer"] button[data-action="submit_post"]')
      .click();
    await page.waitForFunction(
      () =>
        window.__fmarchPlayerCommandStatus?.state === "ack" &&
        window.__fmarchPlayerCommandDispatchBridgePlan?.commandKind ===
          "SubmitPost",
      null,
      { timeout: 15000 },
    );
    await page.getByText(privatePostBody).waitFor({
      state: "visible",
      timeout: 15000,
    });
    const commandStatus = await page.evaluate(() => window.__fmarchPlayerCommandStatus);
    const bridgePlan = await page.evaluate(
      () => window.__fmarchPlayerCommandDispatchBridgePlan,
    );
    const receipts = await page.evaluate(() => window.__fmarchPlayerCommandReceipts);
    const projection = await page.evaluate(() => window.__fmarchPlayerProjection);
    const receiptCountText = await page
      .getByTestId("player-command-receipt-count")
      .innerText();
    const receiptStatusText = await page
      .getByTestId("player-command-status")
      .innerText();
    const submitPostReceipt = page.getByTestId("player-command-receipt-submit_post");
    await submitPostReceipt.waitFor({ state: "visible", timeout: 15000 });
    const receiptRefreshKeys = await submitPostReceipt.getAttribute(
      "data-command-refresh-keys",
    );
    const bodyText = await page.locator("body").innerText();
    if (/invite=(?!REDACTED)/.test(bodyText)) {
      throw new Error("private channel role proof leaked an invite URL token");
    }
    const command = commandRequests.at(-1)?.SubmitPost ?? null;
    const stalePostAfterPhaseTransitionProof =
      await provePrivateChannelStalePostAfterPhaseTransition({
        browser,
        frontendBaseUrl,
        roleUrl,
      });
    return {
      status: "passed",
      sourceRoleUrl: String(roleUrl),
      visitedRolePath,
      surfaceTestId: "player-surface",
      channelRailTestId: "player-channel-role-pm",
      clickedThroughFromRoleUrl: true,
      channelId: "role-pm",
      channelAriaCurrent,
      commandPanelChannelId,
      channelContextChannelId,
      channelContextCapabilityLabel,
      privateQueueBoundary: {
        status: privateBoundaryStatus,
        count: privateCount,
        text: privateBoundaryText,
      },
      expandedPrivateItem: {
        id: "notification-1",
        detailTestId: "player-private-detail-notification-1",
        detailText: expandedPrivateDetailText,
      },
      submitPostProof: {
        status: "passed",
        clickedAction: "submit_post",
        commandKind: command === null ? null : "SubmitPost",
        command,
        commandStatus,
        bridgePlan,
        receipts,
        projectionThread: projection?.thread ?? null,
        privatePostBody,
        receiptCount: Number.parseInt(receiptCountText, 10),
        receiptStatusText,
        receiptRefreshKeys,
      },
      stalePostAfterPhaseTransitionProof,
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    };
  } finally {
    await page.close();
  }
}

async function provePrivateChannelStalePostAfterPhaseTransition({
  browser,
  frontendBaseUrl,
  roleUrl,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const visitedRolePath = rolePathFromUrl(roleUrl);
  const commandRequests = [];
  const stalePrivatePostBody = "Stale private phase proof post";
  try {
    await installPrivateChannelStalePostBrowserRoutes(page, {
      commandRequests,
    });
    await page.context().addCookies([
      {
        name: "fmarch_fixture_session",
        value: "fixture-player",
        url: frontendBaseUrl,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto(`${frontendBaseUrl}${visitedRolePath}`, {
      waitUntil: "networkidle",
    });
    await page.getByTestId("player-surface").waitFor({
      state: "visible",
      timeout: 15000,
    });
    await page
      .locator('[data-testid="player-composer"] textarea')
      .fill(stalePrivatePostBody);
    await page
      .locator('[data-testid="player-composer"] button[data-action="submit_post"]')
      .click();
    await page.waitForFunction(
      () =>
        window.__fmarchPlayerCommandStatus?.state === "reject" &&
        window.__fmarchPlayerCommandStatus?.error === "PhaseLocked" &&
        window.__fmarchPlayerCommandDispatchBridgePlan?.commandKind ===
          "SubmitPost",
      null,
      { timeout: 15000 },
    );
    await page.waitForFunction(
      () =>
        window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "D02" &&
        window.__fmarchPlayerProjection?.commandState?.phase?.locked === true,
      null,
      { timeout: 15000 },
    );
    const stalePostReceipt = page.getByTestId("player-command-receipt-submit_post");
    await stalePostReceipt.waitFor({ state: "visible", timeout: 15000 });
    const commandStatus = await page.evaluate(() => window.__fmarchPlayerCommandStatus);
    const bridgePlan = await page.evaluate(
      () => window.__fmarchPlayerCommandDispatchBridgePlan,
    );
    const receipts = await page.evaluate(() => window.__fmarchPlayerCommandReceipts);
    const projection = await page.evaluate(() => window.__fmarchPlayerProjection);
    const checkpoint = page.getByTestId("player-action-submission-checkpoint");
    const checkpointPhaseId = await checkpoint.getAttribute("data-phase-id");
    const checkpointActionState = await checkpoint.getAttribute("data-action-state");
    const checkpointReceiptState = await checkpoint.getAttribute("data-receipt-state");
    const receiptRefreshKeys = await stalePostReceipt.getAttribute(
      "data-command-refresh-keys",
    );
    const receiptStatusText = await page.getByTestId("player-command-status").innerText();
    const currentThreadText = await page.getByText(
      "Current role-pm thread after stale private post reject",
    ).innerText();
    const bodyText = await page.locator("body").innerText();
    if (/invite=(?!REDACTED)/.test(bodyText)) {
      throw new Error("stale private channel proof leaked an invite URL token");
    }
    const command = commandRequests.at(-1)?.SubmitPost ?? null;
    return {
      status: "passed",
      sourceRoleUrl: String(roleUrl),
      visitedRolePath,
      clickedAction: "submit_post",
      commandKind: command === null ? null : "SubmitPost",
      command,
      commandStatus,
      bridgePlan,
      receipts,
      projectionCommandState: projection?.commandState ?? null,
      projectionThread: projection?.thread ?? null,
      stalePrivatePostBody,
      currentThreadText,
      checkpointPhaseId,
      checkpointActionState,
      checkpointReceiptState,
      receiptStatusText,
      receiptRefreshKeys,
      rawInviteTokensVisible: false,
    };
  } finally {
    await page.close();
  }
}

async function installPrivateChannelBrowserRoutes(
  page,
  { commandRequests, privatePostBody },
) {
  await page.route("**/commands", async (route) => {
    const commandEnvelope = route.request().postDataJSON();
    const command = commandEnvelope?.body?.body?.command;
    commandRequests.push(command);
    if (command?.SubmitPost !== undefined) {
      await fulfillJson(route, {
        v: 1,
        id: commandEnvelope.id,
        body: {
          kind: "Ack",
          body: {
            stream_seqs: [701],
          },
        },
      });
      return;
    }

    await fulfillJson(
      route,
      {
        v: 1,
        id: commandEnvelope?.id ?? "private-channel-role-reject",
        body: {
          kind: "Reject",
          body: {
            error: "WrongPrivateChannelProofCommand",
            retryable: false,
            message: "private channel proof only accepts SubmitPost",
          },
        },
      },
      409,
    );
  });
  await page.route("**/games/*/channels/role-pm/thread?**", async (route) => {
    await fulfillJson(route, {
      next_before_seq: null,
      posts: [
        {
          source_seq: 701,
          stream_seq: 701,
          author_slot: "slot-7",
          author_user: "player_mira",
          body: privatePostBody,
          occurred_at: 1781928000,
        },
      ],
    });
  });
  await page.route("**/games/*/votecount?**", async (route) => {
    await fulfillJson(route, []);
  });
  await page.route("**/games/*/day-vote-outcomes?**", async (route) => {
    await fulfillJson(route, []);
  });
  await page.route("**/games/*/player-command-state?**", async (route) => {
    await fulfillJson(route, seededActionOpenCommandState({
      boundary: "Seeded browser private post ACK refreshed role-pm state.",
    }));
  });
}

async function installPrivateChannelStalePostBrowserRoutes(page, { commandRequests }) {
  await page.route("**/commands", async (route) => {
    const commandEnvelope = route.request().postDataJSON();
    const command = commandEnvelope?.body?.body?.command;
    commandRequests.push(command);
    if (command?.SubmitPost !== undefined) {
      await fulfillJson(
        route,
        {
          v: 1,
          id: commandEnvelope.id,
          body: {
            kind: "Reject",
            body: {
              error: "PhaseLocked",
              retryable: false,
              message: "phase locked",
            },
          },
        },
        409,
      );
      return;
    }

    await fulfillJson(
      route,
      {
        v: 1,
        id: commandEnvelope?.id ?? "private-channel-stale-post-reject",
        body: {
          kind: "Reject",
          body: {
            error: "WrongPrivateChannelProofCommand",
            retryable: false,
            message: "stale private channel proof only accepts SubmitPost",
          },
        },
      },
      409,
    );
  });
  await page.route("**/games/*/channels/role-pm/thread?**", async (route) => {
    await fulfillJson(route, {
      next_before_seq: null,
      posts: [
        {
          source_seq: 802,
          stream_seq: 802,
          author_slot: "host",
          author_user: "host_h",
          body: "Current role-pm thread after stale private post reject",
          occurred_at: 1782014400,
        },
      ],
    });
  });
  await page.route("**/games/*/votecount?**", async (route) => {
    await fulfillJson(route, []);
  });
  await page.route("**/games/*/day-vote-outcomes?**", async (route) => {
    await fulfillJson(route, [
      {
        phase_id: "D02",
        source_seq: 802,
        event_index: 0,
        status: "pending",
        winner_slot: null,
        tallies: {},
        majority: 4,
        reason: "stale-private-post-phase-transition",
      },
    ]);
  });
  await page.route("**/games/*/player-command-state?**", async (route) => {
    await fulfillJson(
      route,
      seededDayVoteOpenCommandState({
        locked: true,
        boundary:
          "Seeded browser private post PhaseLocked recovery refreshed role-pm into locked Day 2.",
      }),
    );
  });
}

async function fulfillJson(route, payload, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(payload),
  });
}

function seededActionOpenCommandState({ boundary }) {
  return {
    game: "seeded-action-open",
    actorSlot: "slot-7",
    actorAlive: true,
    actorStatus: "alive",
    roleKey: "mafia_goon",
    gameCompleted: false,
    phase: {
      phaseId: "N02",
      phaseKind: "Night",
      phaseNumber: 2,
      locked: false,
    },
    actions: [
      {
        action: "submit_action:factional_kill",
        commandKind: "submit_action",
        actionId: "factional_kill",
        templateId: "factional_kill",
        ability: "Kill",
        window: "Night",
        label: "Submit factional kill",
        detail: "factional_kill -> slot-2",
        targets: ["slot-2"],
        targetOptions: ["slot-2", "slot-3"],
        grantId: "grant-factional-kill",
      },
    ],
    voteTargets: [],
    currentVote: null,
    boundary,
  };
}

function seededTargetKilledCommandState({ boundary }) {
  return {
    game: "seeded-target-killed",
    actorSlot: "slot-2",
    actorAlive: false,
    actorStatus: "dead",
    roleKey: null,
    gameCompleted: false,
    phase: {
      phaseId: "N01",
      phaseKind: "Night",
      phaseNumber: 1,
      locked: true,
    },
    actions: [],
    voteTargets: [],
    currentVote: null,
    boundary,
  };
}

function seededNormalResolvedCommandState({ boundary }) {
  return {
    game: "seeded-normal-resolved",
    actorSlot: "slot-4",
    actorAlive: true,
    actorStatus: "alive",
    roleKey: null,
    gameCompleted: false,
    phase: {
      phaseId: "N01",
      phaseKind: "Night",
      phaseNumber: 1,
      locked: true,
    },
    actions: [],
    voteTargets: [],
    currentVote: null,
    boundary,
  };
}

function seededDayVoteTargetKilledCommandState({ boundary }) {
  return {
    game: "seeded-day-vote-target-killed",
    actorSlot: "slot-2",
    actorAlive: false,
    actorStatus: "dead",
    roleKey: null,
    gameCompleted: false,
    phase: {
      phaseId: "D02",
      phaseKind: "Day",
      phaseNumber: 2,
      locked: true,
      deadline: 1782014400,
    },
    actions: [],
    voteTargets: [],
    currentVote: null,
    boundary,
  };
}

function seededDayVoteNormalResolvedCommandState({ boundary }) {
  return {
    game: "seeded-day-vote-normal-resolved",
    actorSlot: "slot-4",
    actorAlive: true,
    actorStatus: "alive",
    roleKey: null,
    gameCompleted: false,
    phase: {
      phaseId: "D02",
      phaseKind: "Day",
      phaseNumber: 2,
      locked: true,
      deadline: 1782014400,
    },
    actions: [],
    voteTargets: [],
    currentVote: null,
    boundary,
  };
}

function seededPostDayVoteAdvanceTargetCommandState({ boundary }) {
  return {
    game: "seeded-post-day-vote-advance-target",
    actorSlot: "slot-2",
    actorAlive: false,
    actorStatus: "dead",
    roleKey: null,
    gameCompleted: false,
    phase: {
      phaseId: "N02",
      phaseKind: "Night",
      phaseNumber: 2,
      locked: false,
    },
    actions: [],
    voteTargets: [],
    currentVote: null,
    boundary,
  };
}

function seededPostDayVoteAdvanceNormalCommandState({ boundary }) {
  return {
    game: "seeded-post-day-vote-advance-normal",
    actorSlot: "slot-4",
    actorAlive: true,
    actorStatus: "alive",
    roleKey: null,
    gameCompleted: false,
    phase: {
      phaseId: "N02",
      phaseKind: "Night",
      phaseNumber: 2,
      locked: false,
    },
    actions: [],
    voteTargets: [],
    currentVote: null,
    boundary,
  };
}

function seededDayVoteOpenCommandState({ boundary, locked = false }) {
  return {
    game: "seeded-day-vote-open",
    actorSlot: "slot-7",
    actorAlive: true,
    actorStatus: "alive",
    roleKey: "mafia_goon",
    gameCompleted: false,
    phase: {
      phaseId: "D02",
      phaseKind: "Day",
      phaseNumber: 2,
      locked,
      deadline: 1781928000,
    },
    actions: [],
    voteTargets: [
      { kind: "slot", slotId: "slot-2", label: "Slot 2" },
      { kind: "no_lynch", slotId: null, label: "No lynch" },
    ],
    currentVote: null,
    boundary,
  };
}

function hostLockedConsoleState() {
  return {
    completed: false,
    phase: {
      phase_id: "D01",
      locked: true,
      deadline: null,
    },
    slots: [
      {
        slot_id: "slot-7",
        occupant_user_id: "player-mira",
        alive: true,
        status: "alive",
        status_tags: ["alive"],
        role_key: "mafia_goon",
      },
    ],
    thread_posts: [
      {
        seq: 41,
        author_slot: "slot-7",
      },
    ],
  };
}

function hostOpenConsoleState({ boundary }) {
  return {
    completed: false,
    phase: {
      phase_id: "D01",
      locked: false,
      deadline: null,
    },
    slots: [
      {
        slot_id: "slot-7",
        occupant_user_id: "player-mira",
        alive: true,
        status: "alive",
        status_tags: ["alive"],
        role_key: "mafia_goon",
      },
    ],
    thread_posts: [
      {
        seq: 41,
        author_slot: "slot-7",
        body: boundary,
      },
    ],
  };
}

function hostPhaseTransitionConsoleState({ phaseId, locked, boundary }) {
  return {
    completed: false,
    phase: {
      phase_id: phaseId,
      locked,
      deadline: null,
    },
    slots: [
      {
        slot_id: "slot-7",
        occupant_user_id: "player-mira",
        alive: true,
        status: "alive",
        status_tags: ["alive"],
        role_key: "mafia_goon",
      },
    ],
    thread_posts: [
      {
        seq: locked ? 801 : 802,
        author_slot: "host",
        body: boundary,
      },
    ],
  };
}

function rolePathFromUrl(roleUrl) {
  if (typeof roleUrl !== "string" || roleUrl.trim() === "") {
    throw new Error("core-loop role proof missing source role URL");
  }
  const parsed = new URL(roleUrl);
  return `${parsed.pathname}${parsed.search}`;
}

function privateChannelRoleUrlFromPlayerRoleUrl(roleUrl) {
  if (typeof roleUrl !== "string" || roleUrl.trim() === "") {
    throw new Error("private channel proof missing source player role URL");
  }
  const parsed = new URL(roleUrl);
  const basePath = parsed.pathname.replace(/\/$/u, "");
  parsed.pathname = `${basePath}/c/role-pm`;
  parsed.search = "?private=notification-1";
  return parsed.toString();
}

function targetResolutionReceiptRoleUrl(roleUrl) {
  if (typeof roleUrl !== "string" || roleUrl.trim() === "") {
    throw new Error("target resolution proof missing source role URL");
  }
  const parsed = new URL(roleUrl);
  parsed.search = "?private=notification-1";
  return parsed.toString();
}

function normalResolutionPrivacyRoleUrl(roleUrl) {
  if (typeof roleUrl !== "string" || roleUrl.trim() === "") {
    throw new Error("normal resolution proof missing source role URL");
  }
  const parsed = new URL(roleUrl);
  parsed.search = "?private=notification-1";
  return parsed.toString();
}

export function assertCoreLoopAdminProof(evidence) {
  if (
    evidence?.version !== 1 ||
    evidence.proof !== "dev-test-game-core-loop-admin-proof" ||
    evidence.status !== "passed" ||
    evidence.releaseReady !== false ||
    evidence.productionReady !== false ||
    evidence.scope !== "local-dev-test-game-core-loop-admin-surface"
  ) {
    throw new Error("core-loop admin proof must pass locally without release claims");
  }
  if (
    evidence.adminRoleSurface?.clickedThroughFromOverview !== true ||
    evidence.adminRoleSurface?.rawInviteTokensVisible !== false
  ) {
    throw new Error("core-loop admin proof did not prove admin overview click-through");
  }
  for (const checkId of requiredChecks) {
    if (!evidence.adminRoleSurface?.visibleChecks?.includes(checkId)) {
      throw new Error(`core-loop admin proof missing visible check: ${checkId}`);
    }
  }
  if (
    !evidence.adminRoleSurface?.visibleCheckStatuses?.["core-loop-spine"]?.includes(
      evidence.generatedFrom?.coreLoopSpineStatus,
    )
  ) {
    throw new Error("core-loop admin proof missing visible core-loop spine status");
  }
  assertVisibleRows(
    "core-loop admin proof missing visible spine cycle",
    evidence.adminRoleSurface?.visibleSpineCycles,
    evidence.generatedFrom?.coreLoopSpineRows?.cycles,
  );
  assertVisibleRows(
    "core-loop admin proof missing visible spine role URL",
    evidence.adminRoleSurface?.visibleSpineRoleUrls,
    evidence.generatedFrom?.coreLoopSpineRows?.roleUrls,
  );
  const roleUrlHrefs = evidence.generatedFrom?.coreLoopSpineRows?.roleUrlHrefs ?? {};
  for (const rowId of evidence.generatedFrom?.coreLoopSpineRows?.roleUrls ?? []) {
    const href = roleUrlHrefs[rowId];
    if (typeof href !== "string" || !href.includes("/g/")) {
      throw new Error(`core-loop admin proof missing actionable role URL: ${rowId}`);
    }
  }
  assertVisibleRows(
    "core-loop admin proof missing visible spine checkpoint",
    evidence.adminRoleSurface?.visibleSpineCheckpoints,
    evidence.generatedFrom?.coreLoopSpineRows?.checkpoints,
  );
  assertVisibleRows(
    "core-loop admin proof missing visible spine recovery hook",
    evidence.adminRoleSurface?.visibleSpineRecoveryHooks,
    evidence.generatedFrom?.coreLoopSpineRows?.recoveryHooks,
  );
  for (const [checkId, expectedStatus] of Object.entries(
    evidence.generatedFrom?.highlightedLaneEvidence ?? {},
  )) {
    if (
      expectedStatus !== "" &&
      !evidence.adminRoleSurface?.visibleCheckStatuses?.[checkId]?.includes(
        expectedStatus,
      )
    ) {
      throw new Error(
        `core-loop admin proof missing visible status for ${checkId}: ${expectedStatus}`,
      );
    }
  }
  assertHostLifecycleControlCheckpoint(evidence.hostRoleSurface);
  assertPlayerActionSubmissionCheckpoint(evidence.playerRoleSurface);
  assertTargetResolutionReceiptSurface(evidence.targetResolutionReceiptSurface);
  assertNormalResolutionPrivacySurface(evidence.normalResolutionPrivacySurface);
  assertTargetDayVoteReceiptSurface(evidence.targetDayVoteReceiptSurface);
  assertNormalDayVotePrivacySurface(evidence.normalDayVotePrivacySurface);
  assertHostPhaseTransitionSurface(evidence.hostPhaseTransitionSurface);
  assertTargetPostDayVoteAdvanceSurface(evidence.targetPostDayVoteAdvanceSurface);
  assertNormalPostDayVoteAdvanceSurface(evidence.normalPostDayVoteAdvanceSurface);
  assertPrivateChannelRoleSurface(evidence.privateChannelRoleSurface);
  return evidence;
}

function assertHostLifecycleControlCheckpoint(hostRoleSurface) {
  const checkpoint = hostRoleSurface?.hostLifecycleControlCheckpoint;
  const clickProof = hostRoleSurface?.hostLifecycleControlClickProof;
  const staleRejectProof = hostRoleSurface?.hostLifecycleStaleRejectProof;
  if (
    hostRoleSurface?.status !== "passed" ||
    hostRoleSurface.clickedThroughFromRoleUrl !== true ||
    hostRoleSurface.releaseReady !== false ||
    hostRoleSurface.productionReady !== false ||
    typeof hostRoleSurface.sourceRoleUrl !== "string" ||
    !hostRoleSurface.sourceRoleUrl.includes("/g/") ||
    typeof hostRoleSurface.visitedRolePath !== "string" ||
    !hostRoleSurface.visitedRolePath.endsWith("/host") ||
    hostRoleSurface.surfaceTestId !== "host-console-surface" ||
    hostRoleSurface.checkpointTestId !== "host-lifecycle-control-checkpoint" ||
    checkpoint?.proofCheckId !== "host-lifecycle-control" ||
    checkpoint.phaseId !== "D01" ||
    checkpoint.phaseState !== "open" ||
    checkpoint.slotId !== "slot-7" ||
    checkpoint.actionState !== "enabled:mark_dead,modkill_slot" ||
    !checkpoint.deadlineAffordance?.includes("resolve_phase") ||
    !checkpoint.recoveryText?.includes("Reject PhaseLocked") ||
    !checkpoint.statusText?.includes(
      "Host lifecycle controls are reachable from this role URL",
    )
  ) {
    throw new Error("core-loop admin proof missing host lifecycle role checkpoint");
  }
  for (const rowId of [
    "phase",
    "slot",
    "actionState",
    "deadlineAffordance",
    "recovery",
  ]) {
    if (!checkpoint.visibleRows?.includes(rowId)) {
      throw new Error(`host lifecycle checkpoint missing visible row: ${rowId}`);
    }
  }
  assertHostLifecycleControlClickProof({
    clickProof,
    expectedGame: gameFromRoleUrl(hostRoleSurface.sourceRoleUrl),
  });
  assertHostLifecycleStaleRejectProof({
    staleRejectProof,
    expectedGame: gameFromRoleUrl(hostRoleSurface.sourceRoleUrl),
  });
}

function assertHostLifecycleControlClickProof({ clickProof, expectedGame }) {
  if (
    clickProof?.status !== "passed" ||
    clickProof.clickedAction !== "lock_thread" ||
    clickProof.commandKind !== "LockThread" ||
    clickProof.command?.game !== expectedGame ||
    clickProof.commandStatus?.state !== "ack" ||
    !clickProof.commandStatus?.message?.includes("Ack: stream seqs 601") ||
    clickProof.commandOutcome?.state !== "ack" ||
    !clickProof.commandOutcome?.message?.includes("Ack: stream seqs 601") ||
    clickProof.bridgePlan?.role !== "moderator" ||
    clickProof.bridgePlan.commandKind !== "LockThread" ||
    clickProof.bridgePlan.commandEndpoint !== "/commands" ||
    clickProof.bridgePlan.finalState !== "ack" ||
    clickProof.bridgePlan.projectionRefreshKeys?.length !== 0 ||
    clickProof.projection?.phase?.id !== "D01" ||
    clickProof.projection?.phase?.locked !== true ||
    clickProof.checkpointPhaseStateAfterAck !== "locked" ||
    clickProof.checkpointDeadlineAffordanceAfterAck !==
      "unlock_thread,advance_phase" ||
    !String(clickProof.statusText ?? "")
      .toLowerCase()
      .includes("ack: stream seqs 601") ||
    clickProof.activityCount !== 1 ||
    !String(clickProof.activityStatusText ?? "")
      .toLowerCase()
      .includes("ack: stream seqs 601")
  ) {
    throw new Error(
      `core-loop admin proof missing host lifecycle click ACK: ${JSON.stringify(
        clickProof,
      )}`,
    );
  }
}

function assertHostLifecycleStaleRejectProof({ staleRejectProof, expectedGame }) {
  if (
    staleRejectProof?.status !== "passed" ||
    staleRejectProof.clickedAction !== "lock_thread" ||
    staleRejectProof.commandKind !== "LockThread" ||
    staleRejectProof.command?.game !== expectedGame ||
    staleRejectProof.commandStatus?.state !== "reject" ||
    staleRejectProof.commandStatus.error !== "PhaseLocked" ||
    !staleRejectProof.commandStatus?.message?.includes(
      "Reject PhaseLocked: phase locked",
    ) ||
    staleRejectProof.commandOutcome?.state !== "reject" ||
    staleRejectProof.commandOutcome.error !== "PhaseLocked" ||
    !staleRejectProof.commandOutcome?.message?.includes(
      "Reject PhaseLocked: phase locked",
    ) ||
    staleRejectProof.bridgePlan?.role !== "moderator" ||
    staleRejectProof.bridgePlan.commandKind !== "LockThread" ||
    staleRejectProof.bridgePlan.commandEndpoint !== "/commands" ||
    staleRejectProof.bridgePlan.finalState !== "reject" ||
    staleRejectProof.bridgePlan.projectionRefreshKeys?.[0] !== "host" ||
    staleRejectProof.bridgePlan.projectionRefreshKeys?.length !== 1 ||
    staleRejectProof.projection?.phase?.id !== "D01" ||
    staleRejectProof.projection?.phase?.locked !== false ||
    staleRejectProof.checkpointPhaseStateAfterReject !== "open" ||
    staleRejectProof.checkpointDeadlineAffordanceAfterReject !==
      "resolve_phase,lock_thread" ||
    !String(staleRejectProof.recoveryText ?? "").includes("Reject PhaseLocked") ||
    staleRejectProof.activityCount !== 1 ||
    !String(staleRejectProof.activityStatusText ?? "")
      .toLowerCase()
      .includes("reject phaselocked: phase locked")
  ) {
    throw new Error(
      `core-loop admin proof missing host stale lifecycle recovery: ${JSON.stringify(
        staleRejectProof,
      )}`,
    );
  }
}

function assertPlayerActionSubmissionCheckpoint(playerRoleSurface) {
  const checkpoint = playerRoleSurface?.playerActionSubmissionCheckpoint;
  const clickProof = playerRoleSurface?.playerActionSubmissionClickProof;
  const invalidRecoveryProof = playerRoleSurface?.playerActionInvalidRecoveryProof;
  if (
    playerRoleSurface?.status !== "passed" ||
    playerRoleSurface.clickedThroughFromRoleUrl !== true ||
    playerRoleSurface.releaseReady !== false ||
    playerRoleSurface.productionReady !== false ||
    typeof playerRoleSurface.sourceRoleUrl !== "string" ||
    !playerRoleSurface.sourceRoleUrl.includes("/g/") ||
    typeof playerRoleSurface.visitedRolePath !== "string" ||
    !playerRoleSurface.visitedRolePath.includes("/g/") ||
    playerRoleSurface.surfaceTestId !== "player-surface" ||
    playerRoleSurface.checkpointTestId !== "player-action-submission-checkpoint" ||
    checkpoint?.proofCheckId !== "player-action-submission" ||
    checkpoint.phaseId !== "N02" ||
    checkpoint.phaseState !== "open" ||
    checkpoint.actorSlot !== "slot-7" ||
    checkpoint.actionState !== "enabled:submit_action:factional_kill" ||
    checkpoint.selectedAction !== "factional_kill" ||
    checkpoint.targetSlots !== "slot-2" ||
    checkpoint.receiptState !== "idle" ||
    !checkpoint.targetText?.includes("factional_kill -> slot-2") ||
    !checkpoint.recoveryText?.includes("Reject PhaseLocked") ||
    !String(checkpoint.statusText ?? "")
      .toLowerCase()
      .includes("player action submission is reachable from this role url")
  ) {
    throw new Error(
      `core-loop admin proof missing player action role checkpoint: ${JSON.stringify(
        {
          surface: {
            status: playerRoleSurface?.status,
            sourceRoleUrl: playerRoleSurface?.sourceRoleUrl,
            visitedRolePath: playerRoleSurface?.visitedRolePath,
            surfaceTestId: playerRoleSurface?.surfaceTestId,
            checkpointTestId: playerRoleSurface?.checkpointTestId,
            clickedThroughFromRoleUrl: playerRoleSurface?.clickedThroughFromRoleUrl,
            releaseReady: playerRoleSurface?.releaseReady,
            productionReady: playerRoleSurface?.productionReady,
          },
          checkpoint,
        },
      )}`,
    );
  }
  for (const rowId of [
    "phase",
    "actor",
    "actionState",
    "target",
    "receipt",
    "recovery",
  ]) {
    if (!checkpoint.visibleRows?.includes(rowId)) {
      throw new Error(`player action checkpoint missing visible row: ${rowId}`);
    }
  }
  assertPlayerActionSubmissionClickProof({
    clickProof,
    expectedGame: gameFromRoleUrl(playerRoleSurface.sourceRoleUrl),
  });
  assertPlayerActionInvalidRecoveryProof({
    invalidRecoveryProof,
    expectedGame: gameFromRoleUrl(playerRoleSurface.sourceRoleUrl),
  });
}

function assertPlayerActionSubmissionClickProof({ clickProof, expectedGame }) {
  if (
    clickProof?.status !== "passed" ||
    clickProof.clickedAction !== "submit_action:factional_kill" ||
    clickProof.commandKind !== "SubmitAction" ||
    clickProof.command?.game !== expectedGame ||
    clickProof.command.action_id !== "factional_kill" ||
    clickProof.command.actor_slot !== "slot-7" ||
    clickProof.command.template_id !== "factional_kill" ||
    clickProof.command.targets?.[0] !== "slot-2" ||
    clickProof.commandStatus?.state !== "ack" ||
    !clickProof.commandStatus?.message?.includes("Ack: stream seqs 501") ||
    clickProof.bridgePlan?.role !== "player" ||
    clickProof.bridgePlan.commandKind !== "SubmitAction" ||
    clickProof.bridgePlan.commandEndpoint !== "/commands" ||
    clickProof.bridgePlan.finalState !== "ack" ||
    !clickProof.bridgePlan.projectionRefreshKeys?.includes("commandState") ||
    clickProof.receipts?.at?.(-1)?.state !== "ack" ||
    clickProof.projectionCommandState?.phase?.phaseId !== "N02" ||
    clickProof.projectionCommandState?.actions?.length !== 0 ||
    !String(clickProof.checkpointReceiptState ?? "").startsWith("ack:") ||
    clickProof.checkpointActionStateAfterAck !== "disabled:no legal action available" ||
    clickProof.receiptCount !== 1 ||
    !String(clickProof.receiptStatusText ?? "")
      .toLowerCase()
      .includes("ack: stream seqs 501")
  ) {
    throw new Error(
      `core-loop admin proof missing player action click ACK: ${JSON.stringify(
        clickProof,
      )}`,
    );
  }
}

function assertTargetResolutionReceiptSurface(targetSurface) {
  const expectedGame = gameFromRoleUrl(targetSurface?.sourceRoleUrl);
  if (
    targetSurface?.status !== "passed" ||
    targetSurface.clickedThroughFromRoleUrl !== true ||
    targetSurface.releaseReady !== false ||
    targetSurface.productionReady !== false ||
    targetSurface.rawInviteTokensVisible !== false ||
    targetSurface.targetSlot !== "slot-2" ||
    targetSurface.principalUserId !== "player_ilya" ||
    typeof targetSurface.sourceRoleUrl !== "string" ||
    !targetSurface.sourceRoleUrl.includes("/g/") ||
    !targetSurface.sourceRoleUrl.includes("private=notification-1") ||
    typeof targetSurface.visitedRolePath !== "string" ||
    !targetSurface.visitedRolePath.includes("/g/") ||
    !targetSurface.visitedRolePath.includes("private=notification-1") ||
    targetSurface.surfaceTestId !== "player-surface" ||
    targetSurface.checkpoint?.phaseId !== "N01" ||
    targetSurface.checkpoint.phaseState !== "locked" ||
    targetSurface.checkpoint.actorSlot !== "slot-2" ||
    targetSurface.checkpoint.actionState !== "disabled:actor is not alive" ||
    targetSurface.checkpoint.receiptState !== "idle" ||
    !String(targetSurface.checkpoint.statusText ?? "")
      .toLowerCase()
      .includes("player action unavailable: actor is not alive") ||
    targetSurface.privateQueueBoundary?.status !==
      "principal-scoped-private-projections" ||
    targetSurface.privateQueueBoundary.count !== 1 ||
    !String(targetSurface.privateQueueBoundary.text ?? "").includes(
      "principal-scoped endpoints",
    ) ||
    targetSurface.privateNotice?.id !== "notification-1" ||
    targetSurface.privateNotice.kind !== "notification" ||
    !String(targetSurface.privateNotice.text ?? "").includes("player_killed") ||
    !String(targetSurface.privateNotice.text ?? "").includes("factional_kill") ||
    targetSurface.privateNotice.detailText !== "Phase N01" ||
    targetSurface.projectionCommandState?.actorSlot !== "slot-2" ||
    targetSurface.projectionCommandState?.actorAlive !== false ||
    targetSurface.projectionCommandState?.actorStatus !== "dead" ||
    targetSurface.projectionCommandState?.actions?.length !== 0 ||
    !String(targetSurface.projectionCommandState?.boundary ?? "").includes(
      "target role received factional_kill private receipt",
    ) ||
    targetSurface.projectionNotifications?.[0]?.effect !== "player_killed" ||
    targetSurface.projectionNotifications?.[0]?.status !== "factional_kill" ||
    targetSurface.resyncFromSeq !== 901 ||
    targetSurface.resyncSnapshotCommandState?.actorSlot !== "slot-2" ||
    targetSurface.resyncSnapshotNotifications?.[0]?.effect !== "player_killed" ||
    targetSurface.coldLoadEndpoints?.notificationsEndpoint !==
      `/games/${expectedGame}/notifications?principal_user_id=player_ilya` ||
    targetSurface.coldLoadEndpoints?.commandStateEndpoint !==
      `/games/${expectedGame}/player-command-state?principal_user_id=player_ilya&slot_id=slot-2`
  ) {
    throw new Error(
      `core-loop admin proof missing target resolution receipt surface: ${JSON.stringify(
        targetSurface,
      )}`,
    );
  }
}

function assertNormalResolutionPrivacySurface(normalSurface) {
  const expectedGame = gameFromRoleUrl(normalSurface?.sourceRoleUrl);
  if (
    normalSurface?.status !== "passed" ||
    normalSurface.clickedThroughFromRoleUrl !== true ||
    normalSurface.releaseReady !== false ||
    normalSurface.productionReady !== false ||
    normalSurface.rawInviteTokensVisible !== false ||
    normalSurface.normalSlot !== "slot-4" ||
    normalSurface.principalUserId !== "player_rowan" ||
    normalSurface.targetReceiptVisible !== false ||
    typeof normalSurface.sourceRoleUrl !== "string" ||
    !normalSurface.sourceRoleUrl.includes("/g/") ||
    !normalSurface.sourceRoleUrl.includes("private=notification-1") ||
    typeof normalSurface.visitedRolePath !== "string" ||
    !normalSurface.visitedRolePath.includes("/g/") ||
    !normalSurface.visitedRolePath.includes("private=notification-1") ||
    normalSurface.surfaceTestId !== "player-surface" ||
    normalSurface.checkpoint?.phaseId !== "N01" ||
    normalSurface.checkpoint.phaseState !== "locked" ||
    normalSurface.checkpoint.actorSlot !== "slot-4" ||
    normalSurface.checkpoint.actionState !== "disabled:phase locked" ||
    normalSurface.checkpoint.receiptState !== "idle" ||
    !String(normalSurface.checkpoint.statusText ?? "")
      .toLowerCase()
      .includes("player action unavailable: phase locked") ||
    normalSurface.privateQueueBoundary?.status !==
      "principal-scoped-private-projections" ||
    normalSurface.privateQueueBoundary.count !== 0 ||
    !String(normalSurface.privateQueueBoundary.text ?? "").includes(
      "principal-scoped endpoints",
    ) ||
    !String(normalSurface.privateEmptyText ?? "").includes(
      "No private results visible",
    ) ||
    normalSurface.projectionCommandState?.actorSlot !== "slot-4" ||
    normalSurface.projectionCommandState?.actorAlive !== true ||
    normalSurface.projectionCommandState?.actorStatus !== "alive" ||
    normalSurface.projectionCommandState?.phase?.phaseId !== "N01" ||
    normalSurface.projectionCommandState?.phase?.locked !== true ||
    normalSurface.projectionCommandState?.actions?.length !== 0 ||
    !String(normalSurface.projectionCommandState?.boundary ?? "").includes(
      "normal role received no target-only private receipt",
    ) ||
    normalSurface.projectionNotifications?.length !== 0 ||
    normalSurface.resyncFromSeq !== 901 ||
    normalSurface.resyncSnapshotCommandState?.actorSlot !== "slot-4" ||
    normalSurface.resyncSnapshotNotifications?.length !== 0 ||
    normalSurface.coldLoadEndpoints?.notificationsEndpoint !==
      `/games/${expectedGame}/notifications?principal_user_id=player_rowan` ||
    normalSurface.coldLoadEndpoints?.commandStateEndpoint !==
      `/games/${expectedGame}/player-command-state?principal_user_id=player_rowan&slot_id=slot-4`
  ) {
    throw new Error(
      `core-loop admin proof missing normal resolution privacy surface: ${JSON.stringify(
        normalSurface,
      )}`,
    );
  }
}

function assertTargetDayVoteReceiptSurface(targetSurface) {
  const expectedGame = gameFromRoleUrl(targetSurface?.sourceRoleUrl);
  if (
    targetSurface?.status !== "passed" ||
    targetSurface.clickedThroughFromRoleUrl !== true ||
    targetSurface.releaseReady !== false ||
    targetSurface.productionReady !== false ||
    targetSurface.rawInviteTokensVisible !== false ||
    targetSurface.targetSlot !== "slot-2" ||
    targetSurface.principalUserId !== "player_ilya" ||
    typeof targetSurface.sourceRoleUrl !== "string" ||
    !targetSurface.sourceRoleUrl.includes("/g/") ||
    !targetSurface.sourceRoleUrl.includes("private=notification-1") ||
    typeof targetSurface.visitedRolePath !== "string" ||
    !targetSurface.visitedRolePath.includes("/g/") ||
    !targetSurface.visitedRolePath.includes("private=notification-1") ||
    targetSurface.surfaceTestId !== "player-surface" ||
    targetSurface.checkpoint?.phaseId !== "D02" ||
    targetSurface.checkpoint.phaseState !== "locked" ||
    targetSurface.checkpoint.actorSlot !== "slot-2" ||
    targetSurface.checkpoint.actionState !== "disabled:actor is not alive" ||
    targetSurface.checkpoint.receiptState !== "idle" ||
    !String(targetSurface.checkpoint.statusText ?? "")
      .toLowerCase()
      .includes("player action unavailable: actor is not alive") ||
    targetSurface.privateQueueBoundary?.status !==
      "principal-scoped-private-projections" ||
    targetSurface.privateQueueBoundary.count !== 1 ||
    !String(targetSurface.privateQueueBoundary.text ?? "").includes(
      "principal-scoped endpoints",
    ) ||
    targetSurface.privateNotice?.id !== "notification-1" ||
    targetSurface.privateNotice.kind !== "notification" ||
    !String(targetSurface.privateNotice.text ?? "").includes("player_killed") ||
    !String(targetSurface.privateNotice.text ?? "").includes("day_vote") ||
    targetSurface.privateNotice.detailText !== "Phase D02" ||
    targetSurface.projectionCommandState?.actorSlot !== "slot-2" ||
    targetSurface.projectionCommandState?.actorAlive !== false ||
    targetSurface.projectionCommandState?.actorStatus !== "dead" ||
    targetSurface.projectionCommandState?.phase?.phaseId !== "D02" ||
    targetSurface.projectionCommandState?.phase?.locked !== true ||
    targetSurface.projectionCommandState?.actions?.length !== 0 ||
    !String(targetSurface.projectionCommandState?.boundary ?? "").includes(
      "target role received day_vote private receipt",
    ) ||
    targetSurface.projectionNotifications?.[0]?.effect !== "player_killed" ||
    targetSurface.projectionNotifications?.[0]?.status !== "day_vote" ||
    targetSurface.resyncFromSeq !== 902 ||
    targetSurface.resyncSnapshotCommandState?.actorSlot !== "slot-2" ||
    targetSurface.resyncSnapshotNotifications?.[0]?.status !== "day_vote" ||
    targetSurface.coldLoadEndpoints?.notificationsEndpoint !==
      `/games/${expectedGame}/notifications?principal_user_id=player_ilya` ||
    targetSurface.coldLoadEndpoints?.commandStateEndpoint !==
      `/games/${expectedGame}/player-command-state?principal_user_id=player_ilya&slot_id=slot-2`
  ) {
    throw new Error(
      `core-loop admin proof missing target day-vote receipt surface: ${JSON.stringify(
        targetSurface,
      )}`,
    );
  }
}

function assertNormalDayVotePrivacySurface(normalSurface) {
  const expectedGame = gameFromRoleUrl(normalSurface?.sourceRoleUrl);
  if (
    normalSurface?.status !== "passed" ||
    normalSurface.clickedThroughFromRoleUrl !== true ||
    normalSurface.releaseReady !== false ||
    normalSurface.productionReady !== false ||
    normalSurface.rawInviteTokensVisible !== false ||
    normalSurface.normalSlot !== "slot-4" ||
    normalSurface.principalUserId !== "player_rowan" ||
    normalSurface.targetReceiptVisible !== false ||
    typeof normalSurface.sourceRoleUrl !== "string" ||
    !normalSurface.sourceRoleUrl.includes("/g/") ||
    !normalSurface.sourceRoleUrl.includes("private=notification-1") ||
    typeof normalSurface.visitedRolePath !== "string" ||
    !normalSurface.visitedRolePath.includes("/g/") ||
    !normalSurface.visitedRolePath.includes("private=notification-1") ||
    normalSurface.surfaceTestId !== "player-surface" ||
    normalSurface.checkpoint?.phaseId !== "D02" ||
    normalSurface.checkpoint.phaseState !== "locked" ||
    normalSurface.checkpoint.actorSlot !== "slot-4" ||
    normalSurface.checkpoint.actionState !== "disabled:phase locked" ||
    normalSurface.checkpoint.receiptState !== "idle" ||
    !String(normalSurface.checkpoint.statusText ?? "")
      .toLowerCase()
      .includes("player action unavailable: phase locked") ||
    normalSurface.privateQueueBoundary?.status !==
      "principal-scoped-private-projections" ||
    normalSurface.privateQueueBoundary.count !== 0 ||
    !String(normalSurface.privateQueueBoundary.text ?? "").includes(
      "principal-scoped endpoints",
    ) ||
    !String(normalSurface.privateEmptyText ?? "").includes(
      "No private results visible",
    ) ||
    normalSurface.projectionCommandState?.actorSlot !== "slot-4" ||
    normalSurface.projectionCommandState?.actorAlive !== true ||
    normalSurface.projectionCommandState?.actorStatus !== "alive" ||
    normalSurface.projectionCommandState?.phase?.phaseId !== "D02" ||
    normalSurface.projectionCommandState?.phase?.locked !== true ||
    normalSurface.projectionCommandState?.actions?.length !== 0 ||
    !String(normalSurface.projectionCommandState?.boundary ?? "").includes(
      "normal role received no target-only private receipt",
    ) ||
    normalSurface.projectionNotifications?.length !== 0 ||
    normalSurface.resyncFromSeq !== 902 ||
    normalSurface.resyncSnapshotCommandState?.actorSlot !== "slot-4" ||
    normalSurface.resyncSnapshotNotifications?.length !== 0 ||
    normalSurface.coldLoadEndpoints?.notificationsEndpoint !==
      `/games/${expectedGame}/notifications?principal_user_id=player_rowan` ||
    normalSurface.coldLoadEndpoints?.commandStateEndpoint !==
      `/games/${expectedGame}/player-command-state?principal_user_id=player_rowan&slot_id=slot-4`
  ) {
    throw new Error(
      `core-loop admin proof missing normal day-vote privacy surface: ${JSON.stringify(
        normalSurface,
      )}`,
    );
  }
}

function assertTargetPostDayVoteAdvanceSurface(targetSurface) {
  const expectedGame = gameFromRoleUrl(targetSurface?.sourceRoleUrl);
  if (
    targetSurface?.status !== "passed" ||
    targetSurface.clickedThroughFromRoleUrl !== true ||
    targetSurface.releaseReady !== false ||
    targetSurface.productionReady !== false ||
    targetSurface.rawInviteTokensVisible !== false ||
    targetSurface.targetSlot !== "slot-2" ||
    targetSurface.principalUserId !== "player_ilya" ||
    typeof targetSurface.sourceRoleUrl !== "string" ||
    !targetSurface.sourceRoleUrl.includes("/g/") ||
    !targetSurface.sourceRoleUrl.includes("private=notification-1") ||
    typeof targetSurface.visitedRolePath !== "string" ||
    !targetSurface.visitedRolePath.includes("/g/") ||
    !targetSurface.visitedRolePath.includes("private=notification-1") ||
    targetSurface.surfaceTestId !== "player-surface" ||
    targetSurface.checkpoint?.phaseId !== "N02" ||
    targetSurface.checkpoint.phaseState !== "open" ||
    targetSurface.checkpoint.actorSlot !== "slot-2" ||
    targetSurface.checkpoint.actionState !== "disabled:actor is not alive" ||
    targetSurface.checkpoint.receiptState !== "idle" ||
    !String(targetSurface.checkpoint.statusText ?? "")
      .toLowerCase()
      .includes("player action unavailable: actor is not alive") ||
    targetSurface.privateQueueBoundary?.status !==
      "principal-scoped-private-projections" ||
    targetSurface.privateQueueBoundary.count !== 1 ||
    !String(targetSurface.privateQueueBoundary.text ?? "").includes(
      "principal-scoped endpoints",
    ) ||
    targetSurface.privateNotice?.id !== "notification-1" ||
    targetSurface.privateNotice.kind !== "notification" ||
    !String(targetSurface.privateNotice.text ?? "").includes("player_killed") ||
    !String(targetSurface.privateNotice.text ?? "").includes("day_vote") ||
    targetSurface.privateNotice.detailText !== "Phase D02" ||
    targetSurface.projectionCommandState?.actorSlot !== "slot-2" ||
    targetSurface.projectionCommandState?.actorAlive !== false ||
    targetSurface.projectionCommandState?.actorStatus !== "dead" ||
    targetSurface.projectionCommandState?.phase?.phaseId !== "N02" ||
    targetSurface.projectionCommandState?.phase?.locked !== false ||
    targetSurface.projectionCommandState?.actions?.length !== 0 ||
    !String(targetSurface.projectionCommandState?.boundary ?? "").includes(
      "target role remained dead",
    ) ||
    targetSurface.projectionNotifications?.[0]?.effect !== "player_killed" ||
    targetSurface.projectionNotifications?.[0]?.status !== "day_vote" ||
    targetSurface.resyncFromSeq !== 903 ||
    targetSurface.resyncSnapshotCommandState?.actorSlot !== "slot-2" ||
    targetSurface.resyncSnapshotCommandState?.phase?.phaseId !== "N02" ||
    targetSurface.resyncSnapshotNotifications?.[0]?.status !== "day_vote" ||
    targetSurface.coldLoadEndpoints?.notificationsEndpoint !==
      `/games/${expectedGame}/notifications?principal_user_id=player_ilya` ||
    targetSurface.coldLoadEndpoints?.commandStateEndpoint !==
      `/games/${expectedGame}/player-command-state?principal_user_id=player_ilya&slot_id=slot-2`
  ) {
    throw new Error(
      `core-loop admin proof missing target post-day-vote advance surface: ${JSON.stringify(
        targetSurface,
      )}`,
    );
  }
}

function assertNormalPostDayVoteAdvanceSurface(normalSurface) {
  const expectedGame = gameFromRoleUrl(normalSurface?.sourceRoleUrl);
  if (
    normalSurface?.status !== "passed" ||
    normalSurface.clickedThroughFromRoleUrl !== true ||
    normalSurface.releaseReady !== false ||
    normalSurface.productionReady !== false ||
    normalSurface.rawInviteTokensVisible !== false ||
    normalSurface.normalSlot !== "slot-4" ||
    normalSurface.principalUserId !== "player_rowan" ||
    normalSurface.targetReceiptVisible !== false ||
    typeof normalSurface.sourceRoleUrl !== "string" ||
    !normalSurface.sourceRoleUrl.includes("/g/") ||
    !normalSurface.sourceRoleUrl.includes("private=notification-1") ||
    typeof normalSurface.visitedRolePath !== "string" ||
    !normalSurface.visitedRolePath.includes("/g/") ||
    !normalSurface.visitedRolePath.includes("private=notification-1") ||
    normalSurface.surfaceTestId !== "player-surface" ||
    normalSurface.checkpoint?.phaseId !== "N02" ||
    normalSurface.checkpoint.phaseState !== "open" ||
    normalSurface.checkpoint.actorSlot !== "slot-4" ||
    normalSurface.checkpoint.actionState !==
      "disabled:no legal action available" ||
    normalSurface.checkpoint.receiptState !== "idle" ||
    !String(normalSurface.checkpoint.statusText ?? "")
      .toLowerCase()
      .includes("player action unavailable: no legal action available") ||
    normalSurface.privateQueueBoundary?.status !==
      "principal-scoped-private-projections" ||
    normalSurface.privateQueueBoundary.count !== 0 ||
    !String(normalSurface.privateQueueBoundary.text ?? "").includes(
      "principal-scoped endpoints",
    ) ||
    !String(normalSurface.privateEmptyText ?? "").includes(
      "No private results visible",
    ) ||
    normalSurface.projectionCommandState?.actorSlot !== "slot-4" ||
    normalSurface.projectionCommandState?.actorAlive !== true ||
    normalSurface.projectionCommandState?.actorStatus !== "alive" ||
    normalSurface.projectionCommandState?.phase?.phaseId !== "N02" ||
    normalSurface.projectionCommandState?.phase?.locked !== false ||
    normalSurface.projectionCommandState?.actions?.length !== 0 ||
    !String(normalSurface.projectionCommandState?.boundary ?? "").includes(
      "normal role stayed alive",
    ) ||
    normalSurface.projectionNotifications?.length !== 0 ||
    normalSurface.resyncFromSeq !== 903 ||
    normalSurface.resyncSnapshotCommandState?.actorSlot !== "slot-4" ||
    normalSurface.resyncSnapshotCommandState?.phase?.phaseId !== "N02" ||
    normalSurface.resyncSnapshotNotifications?.length !== 0 ||
    normalSurface.coldLoadEndpoints?.notificationsEndpoint !==
      `/games/${expectedGame}/notifications?principal_user_id=player_rowan` ||
    normalSurface.coldLoadEndpoints?.commandStateEndpoint !==
      `/games/${expectedGame}/player-command-state?principal_user_id=player_rowan&slot_id=slot-4`
  ) {
    throw new Error(
      `core-loop admin proof missing normal post-day-vote advance surface: ${JSON.stringify(
        normalSurface,
      )}`,
    );
  }
}

function assertPlayerActionInvalidRecoveryProof({
  invalidRecoveryProof,
  expectedGame,
}) {
  if (
    invalidRecoveryProof?.status !== "passed" ||
    invalidRecoveryProof.clickedAction !== "submit_invalid_action:factional_kill" ||
    invalidRecoveryProof.commandKind !== "SubmitAction" ||
    invalidRecoveryProof.command?.game !== expectedGame ||
    invalidRecoveryProof.command.action_id !== "invalid_self_factional_kill" ||
    invalidRecoveryProof.command.actor_slot !== "slot-7" ||
    invalidRecoveryProof.command.template_id !== "factional_kill" ||
    invalidRecoveryProof.command.targets?.[0] !== "slot-7" ||
    invalidRecoveryProof.commandStatus?.state !== "reject" ||
    invalidRecoveryProof.commandStatus.error !== "InvalidTarget" ||
    !invalidRecoveryProof.commandStatus?.message?.includes(
      "Reject InvalidTarget: invalid target",
    ) ||
    invalidRecoveryProof.bridgePlan?.role !== "player" ||
    invalidRecoveryProof.bridgePlan.commandKind !== "SubmitAction" ||
    invalidRecoveryProof.bridgePlan.commandEndpoint !== "/commands" ||
    invalidRecoveryProof.bridgePlan.finalState !== "reject" ||
    !invalidRecoveryProof.bridgePlan.projectionRefreshKeys?.includes("commandState") ||
    invalidRecoveryProof.receipts?.at?.(-1)?.state !== "reject" ||
    invalidRecoveryProof.projectionCommandState?.phase?.phaseId !== "N02" ||
    invalidRecoveryProof.projectionCommandState?.actions?.[0]?.templateId !==
      "factional_kill" ||
    invalidRecoveryProof.checkpointReceiptState !== "reject:InvalidTarget" ||
    invalidRecoveryProof.checkpointActionStateAfterReject !==
      "enabled:submit_action:factional_kill" ||
    invalidRecoveryProof.checkpointTargetSlotsAfterReject !== "slot-2" ||
    invalidRecoveryProof.receiptCount !== 1 ||
    !String(invalidRecoveryProof.receiptStatusText ?? "")
      .toLowerCase()
      .includes("reject invalidtarget: invalid target")
  ) {
    throw new Error(
      `core-loop admin proof missing player invalid-action recovery: ${JSON.stringify(
        invalidRecoveryProof,
      )}`,
    );
  }
}

function assertHostPhaseTransitionSurface(hostPhaseTransitionSurface) {
  const expectedGame = gameFromRoleUrl(
    hostPhaseTransitionSurface?.sourceHostRoleUrl,
  );
  const resolveProof = hostPhaseTransitionSurface?.resolveProof;
  const advanceProof = hostPhaseTransitionSurface?.advanceProof;
  const staleHostAdvanceRecoveryProof =
    hostPhaseTransitionSurface?.staleHostAdvanceRecoveryProof;
  const playerObservationProof =
    hostPhaseTransitionSurface?.playerObservationProof;
  if (
    hostPhaseTransitionSurface?.status !== "passed" ||
    hostPhaseTransitionSurface.clickedThroughFromRoleUrl !== true ||
    hostPhaseTransitionSurface.releaseReady !== false ||
    hostPhaseTransitionSurface.productionReady !== false ||
    typeof hostPhaseTransitionSurface.sourceHostRoleUrl !== "string" ||
    !hostPhaseTransitionSurface.sourceHostRoleUrl.includes("/g/") ||
    !hostPhaseTransitionSurface.sourceHostRoleUrl.endsWith("/host") ||
    typeof hostPhaseTransitionSurface.sourcePlayerRoleUrl !== "string" ||
    !hostPhaseTransitionSurface.sourcePlayerRoleUrl.includes("/g/") ||
    typeof hostPhaseTransitionSurface.visitedHostRolePath !== "string" ||
    !hostPhaseTransitionSurface.visitedHostRolePath.endsWith("/host") ||
    hostPhaseTransitionSurface.surfaceTestId !== "host-console-surface" ||
    !String(hostPhaseTransitionSurface.transition ?? "").includes(
      "resolve_phase:ack:801",
    ) ||
    !String(hostPhaseTransitionSurface.transition ?? "").includes(
      "advance_phase:ack:802",
    ) ||
    !String(hostPhaseTransitionSurface.transition ?? "").includes("player:N02")
  ) {
    throw new Error(
      `core-loop admin proof missing host phase transition surface: ${JSON.stringify(
        hostPhaseTransitionSurface,
      )}`,
    );
  }
  assertHostPhaseTransitionActionProof({
    proof: resolveProof,
    expectedGame,
    actionId: "resolve_phase",
    commandKind: "ResolvePhase",
    streamSeq: 801,
    expectedPhaseId: "D02",
    expectedPhaseState: "locked",
    expectedDeadlineAffordance: "unlock_thread,advance_phase",
    expectedRefreshKeys: ["host", "votecount", "dayVoteOutcomes", "hostPrompts"],
  });
  assertHostPhaseTransitionActionProof({
    proof: advanceProof,
    expectedGame,
    actionId: "advance_phase",
    commandKind: "AdvancePhase",
    streamSeq: 802,
    expectedPhaseId: "N02",
    expectedPhaseState: "open",
    expectedDeadlineAffordance: "resolve_phase,lock_thread",
    expectedRefreshKeys: [],
  });
  assertHostStaleAdvanceAfterTransitionProof({
    staleProof: staleHostAdvanceRecoveryProof,
    expectedGame,
  });
  if (
    playerObservationProof?.status !== "passed" ||
    playerObservationProof.releaseReady !== false ||
    playerObservationProof.productionReady !== false ||
    playerObservationProof.sourceRoleUrl !==
      hostPhaseTransitionSurface.sourcePlayerRoleUrl ||
    !playerObservationProof.visitedRolePath?.includes("/g/") ||
    playerObservationProof.surfaceTestId !== "player-surface" ||
    playerObservationProof.resyncFromSeq !== 802 ||
    !playerObservationProof.resyncKeys?.includes("commandState") ||
    playerObservationProof.resyncSnapshotCommandState?.phase?.phaseId !== "N02" ||
    playerObservationProof.projectionCommandState?.phase?.phaseId !== "N02" ||
    !String(playerObservationProof.projectionCommandState?.boundary ?? "").includes(
      "AdvancePhase",
    ) ||
    playerObservationProof.checkpointPhaseId !== "N02" ||
    playerObservationProof.checkpointPhaseState !== "open" ||
    playerObservationProof.checkpointActionState !==
      "enabled:submit_action:factional_kill" ||
    playerObservationProof.checkpointTargetSlots !== "slot-2" ||
    playerObservationProof.checkpointReceiptState !== "reject:PhaseLocked"
  ) {
    throw new Error(
      `core-loop admin proof missing player phase transition observation: ${JSON.stringify(
        playerObservationProof,
      )}`,
    );
  }
  assertPlayerStaleVoteAfterTransitionProof({
    staleProof: playerObservationProof.staleVoteRecoveryProof,
    expectedGame,
  });
  assertPlayerStaleActionAfterTransitionProof({
    staleProof: playerObservationProof.staleActionRecoveryProof,
    expectedGame,
  });
}

function assertHostStaleAdvanceAfterTransitionProof({ staleProof, expectedGame }) {
  if (
    staleProof?.status !== "passed" ||
    staleProof.releaseReady !== false ||
    staleProof.productionReady !== false ||
    typeof staleProof.sourceRoleUrl !== "string" ||
    !staleProof.sourceRoleUrl.endsWith("/host") ||
    typeof staleProof.visitedRolePath !== "string" ||
    !staleProof.visitedRolePath.endsWith("/host") ||
    staleProof.surfaceTestId !== "host-console-surface" ||
    staleProof.setupResyncFromSeq !== 801 ||
    staleProof.setupSnapshotHost?.phase?.id !== "D02" ||
    staleProof.setupSnapshotHost?.phase?.state !== "locked" ||
    staleProof.clickedAction !== "advance_phase" ||
    staleProof.commandKind !== "AdvancePhase" ||
    staleProof.command?.game !== expectedGame ||
    staleProof.commandStatus?.state !== "reject" ||
    staleProof.commandStatus.error !== "InvalidTarget" ||
    !String(staleProof.commandStatus.message ?? "").includes(
      "stale phase state, refresh and use current controls",
    ) ||
    staleProof.commandOutcome?.state !== "reject" ||
    staleProof.commandOutcome.error !== "InvalidTarget" ||
    !String(staleProof.commandOutcome.message ?? "").includes(
      "stale phase state, refresh and use current controls",
    ) ||
    staleProof.bridgePlan?.role !== "moderator" ||
    staleProof.bridgePlan.commandKind !== "AdvancePhase" ||
    staleProof.bridgePlan.commandEndpoint !== "/commands" ||
    staleProof.bridgePlan.finalState !== "reject" ||
    !sameStringArray(staleProof.bridgePlan.projectionRefreshKeys, ["host"]) ||
    staleProof.projection?.phase?.id !== "N02" ||
    staleProof.projection?.phase?.state !== "open" ||
    staleProof.projection?.phase?.locked !== false ||
    staleProof.checkpointPhaseIdAfterReject !== "N02" ||
    staleProof.checkpointPhaseStateAfterReject !== "open" ||
    staleProof.checkpointDeadlineAffordanceAfterReject !==
      "resolve_phase,lock_thread" ||
    !String(staleProof.activityStatusText ?? "")
      .toLowerCase()
      .includes("reject invalidtarget: invalid target")
  ) {
    throw new Error(
      `core-loop admin proof missing host stale advance recovery after transition: ${JSON.stringify(
        staleProof,
      )}`,
    );
  }
}

function assertHostPhaseTransitionActionProof({
  proof,
  expectedGame,
  actionId,
  commandKind,
  streamSeq,
  expectedPhaseId,
  expectedPhaseState,
  expectedDeadlineAffordance,
  expectedRefreshKeys,
}) {
  if (
    proof?.status !== "passed" ||
    proof.clickedAction !== actionId ||
    proof.commandKind !== commandKind ||
    proof.command?.game !== expectedGame ||
    (commandKind === "ResolvePhase" && proof.command.seed !== 918273) ||
    proof.commandStatus?.state !== "ack" ||
    !proof.commandStatus?.message?.includes(`Ack: stream seqs ${streamSeq}`) ||
    proof.commandOutcome?.state !== "ack" ||
    !proof.commandOutcome?.message?.includes(`Ack: stream seqs ${streamSeq}`) ||
    proof.bridgePlan?.role !== "moderator" ||
    proof.bridgePlan.commandKind !== commandKind ||
    proof.bridgePlan.commandEndpoint !== "/commands" ||
    proof.bridgePlan.finalState !== "ack" ||
    !sameStringArray(proof.bridgePlan.projectionRefreshKeys, expectedRefreshKeys) ||
    proof.projection?.phase?.id !== expectedPhaseId ||
    proof.projection?.phase?.state !== expectedPhaseState ||
    proof.projection?.phase?.locked !== (expectedPhaseState === "locked") ||
    proof.checkpointPhaseId !== expectedPhaseId ||
    proof.checkpointPhaseState !== expectedPhaseState ||
    proof.checkpointDeadlineAffordance !== expectedDeadlineAffordance ||
    !String(proof.activityStatusText ?? "")
      .toLowerCase()
      .includes(`ack: stream seqs ${streamSeq}`)
  ) {
    throw new Error(
      `core-loop admin proof missing host ${actionId} transition ACK: ${JSON.stringify(
        proof,
      )}`,
    );
  }
}

function assertPlayerStaleVoteAfterTransitionProof({ staleProof, expectedGame }) {
  if (
    staleProof?.status !== "passed" ||
    staleProof.clickedAction !== "submit_vote" ||
    staleProof.commandKind !== "SubmitVote" ||
    staleProof.setupResyncFromSeq !== 801 ||
    staleProof.setupSnapshotCommandState?.phase?.phaseId !== "D02" ||
    staleProof.setupSnapshotCommandState?.voteTargets?.[0]?.slotId !== "slot-2" ||
    staleProof.command?.game !== expectedGame ||
    staleProof.command.actor_slot !== "slot-7" ||
    staleProof.command.target?.Slot !== "slot-2" ||
    staleProof.commandStatus?.state !== "reject" ||
    staleProof.commandStatus.error !== "PhaseLocked" ||
    !String(staleProof.commandStatus.message ?? "").includes(
      "stale vote state, refresh and use current vote controls",
    ) ||
    staleProof.bridgePlan?.role !== "player" ||
    staleProof.bridgePlan.commandKind !== "SubmitVote" ||
    staleProof.bridgePlan.commandEndpoint !== "/commands" ||
    staleProof.bridgePlan.finalState !== "reject" ||
    !staleProof.bridgePlan.projectionRefreshKeys?.includes("votecount") ||
    !staleProof.bridgePlan.projectionRefreshKeys?.includes("commandState") ||
    !staleProof.bridgePlan.projectionRefreshKeys?.includes("dayVoteOutcomes") ||
    staleProof.receipts?.at?.(-1)?.state !== "reject" ||
    staleProof.projectionCommandState?.phase?.phaseId !== "N02" ||
    !String(staleProof.projectionCommandState?.boundary ?? "").includes(
      "PhaseLocked recovery",
    ) ||
    staleProof.checkpointReceiptState !== "reject:PhaseLocked" ||
    staleProof.checkpointPhaseIdAfterReject !== "N02" ||
    staleProof.checkpointActionStateAfterReject !==
      "enabled:submit_action:factional_kill" ||
    staleProof.checkpointTargetSlotsAfterReject !== "slot-2" ||
    !String(staleProof.recoveryText ?? "").includes("Reject PhaseLocked") ||
    staleProof.receiptCount !== 1 ||
    !String(staleProof.receiptStatusText ?? "")
      .toLowerCase()
      .includes("stale vote state")
  ) {
    throw new Error(
      `core-loop admin proof missing stale player vote recovery after transition: ${JSON.stringify(
        staleProof,
      )}`,
    );
  }
}

function assertPlayerStaleActionAfterTransitionProof({ staleProof, expectedGame }) {
  if (
    staleProof?.status !== "passed" ||
    staleProof.clickedAction !== "submit_action:factional_kill" ||
    staleProof.commandKind !== "SubmitAction" ||
    staleProof.command?.game !== expectedGame ||
    staleProof.command.action_id !== "factional_kill" ||
    staleProof.command.actor_slot !== "slot-7" ||
    staleProof.command.template_id !== "factional_kill" ||
    staleProof.command.targets?.[0] !== "slot-2" ||
    staleProof.commandStatus?.state !== "reject" ||
    staleProof.commandStatus.error !== "PhaseLocked" ||
    !String(staleProof.commandStatus.message ?? "").includes(
      "stale action state, refresh and use current action controls",
    ) ||
    staleProof.bridgePlan?.role !== "player" ||
    staleProof.bridgePlan.commandKind !== "SubmitAction" ||
    staleProof.bridgePlan.commandEndpoint !== "/commands" ||
    staleProof.bridgePlan.finalState !== "reject" ||
    !staleProof.bridgePlan.projectionRefreshKeys?.includes("commandState") ||
    staleProof.receipts?.at?.(-1)?.state !== "reject" ||
    staleProof.projectionCommandState?.phase?.phaseId !== "N02" ||
    !String(staleProof.projectionCommandState?.boundary ?? "").includes(
      "PhaseLocked recovery",
    ) ||
    staleProof.checkpointReceiptState !== "reject:PhaseLocked" ||
    staleProof.checkpointPhaseIdAfterReject !== "N02" ||
    staleProof.checkpointActionStateAfterReject !==
      "enabled:submit_action:factional_kill" ||
    staleProof.checkpointTargetSlotsAfterReject !== "slot-2" ||
    !String(staleProof.recoveryText ?? "").includes("Reject PhaseLocked") ||
    staleProof.receiptCount !== 2 ||
    !String(staleProof.receiptStatusText ?? "")
      .toLowerCase()
      .includes("reject phaselocked: phase locked")
  ) {
    throw new Error(
      `core-loop admin proof missing stale player action recovery after transition: ${JSON.stringify(
        staleProof,
      )}`,
    );
  }
}

function assertPrivateChannelRoleSurface(privateChannelRoleSurface) {
  const submitPostProof = privateChannelRoleSurface?.submitPostProof;
  const stalePostProof =
    privateChannelRoleSurface?.stalePostAfterPhaseTransitionProof;
  const expectedGame = gameFromRoleUrl(privateChannelRoleSurface?.sourceRoleUrl);
  if (
    privateChannelRoleSurface?.status !== "passed" ||
    privateChannelRoleSurface.clickedThroughFromRoleUrl !== true ||
    privateChannelRoleSurface.releaseReady !== false ||
    privateChannelRoleSurface.productionReady !== false ||
    privateChannelRoleSurface.rawInviteTokensVisible !== false ||
    typeof privateChannelRoleSurface.sourceRoleUrl !== "string" ||
    !privateChannelRoleSurface.sourceRoleUrl.includes("/g/") ||
    typeof privateChannelRoleSurface.visitedRolePath !== "string" ||
    !privateChannelRoleSurface.visitedRolePath.includes("/c/role-pm") ||
    !privateChannelRoleSurface.visitedRolePath.includes("private=notification-1") ||
    privateChannelRoleSurface.surfaceTestId !== "player-surface" ||
    privateChannelRoleSurface.channelRailTestId !== "player-channel-role-pm" ||
    privateChannelRoleSurface.channelId !== "role-pm" ||
    privateChannelRoleSurface.channelAriaCurrent !== "page" ||
    privateChannelRoleSurface.commandPanelChannelId !== "role-pm" ||
    privateChannelRoleSurface.channelContextChannelId !== "role-pm" ||
    privateChannelRoleSurface.channelContextCapabilityLabel !==
      "ChannelMember(role-pm)" ||
    privateChannelRoleSurface.privateQueueBoundary?.status !==
      "principal-scoped-private-projections" ||
    privateChannelRoleSurface.privateQueueBoundary?.count < 1 ||
    !String(privateChannelRoleSurface.privateQueueBoundary?.text ?? "").includes(
      "principal-scoped endpoints",
    ) ||
    privateChannelRoleSurface.expandedPrivateItem?.id !== "notification-1" ||
    privateChannelRoleSurface.expandedPrivateItem?.detailTestId !==
      "player-private-detail-notification-1" ||
    !String(privateChannelRoleSurface.expandedPrivateItem?.detailText ?? "").includes(
      "Phase",
    )
  ) {
    throw new Error(
      `core-loop admin proof missing private channel role URL surface: ${JSON.stringify(
        privateChannelRoleSurface,
      )}`,
    );
  }
  if (
    submitPostProof?.status !== "passed" ||
    submitPostProof.clickedAction !== "submit_post" ||
    submitPostProof.commandKind !== "SubmitPost" ||
    submitPostProof.command?.game !== expectedGame ||
    submitPostProof.command.channel_id !== "role-pm" ||
    submitPostProof.command.actor_slot !== "slot-7" ||
    submitPostProof.command.body !== submitPostProof.privatePostBody ||
    submitPostProof.commandStatus?.state !== "ack" ||
    !submitPostProof.commandStatus?.message?.includes("Ack: stream seqs 701") ||
    submitPostProof.bridgePlan?.role !== "player" ||
    submitPostProof.bridgePlan.commandKind !== "SubmitPost" ||
    submitPostProof.bridgePlan.commandEndpoint !== "/commands" ||
    submitPostProof.bridgePlan.finalState !== "ack" ||
    !submitPostProof.bridgePlan.projectionRefreshKeys?.includes("thread") ||
    !submitPostProof.bridgePlan.projectionRefreshKeys?.includes("dayVoteOutcomes") ||
    submitPostProof.receipts?.at?.(-1)?.state !== "ack" ||
    submitPostProof.projectionThread?.posts?.at?.(-1)?.body !==
      submitPostProof.privatePostBody ||
    submitPostProof.receiptCount !== 1 ||
    !String(submitPostProof.receiptStatusText ?? "")
      .toLowerCase()
      .includes("ack: stream seqs 701") ||
    submitPostProof.receiptRefreshKeys !==
      "thread,votecount,commandState,dayVoteOutcomes"
  ) {
    throw new Error(
      `core-loop admin proof missing private channel SubmitPost ACK: ${JSON.stringify(
        submitPostProof,
      )}`,
    );
  }
  if (
    stalePostProof?.status !== "passed" ||
    stalePostProof.sourceRoleUrl !== privateChannelRoleSurface.sourceRoleUrl ||
    stalePostProof.visitedRolePath !== privateChannelRoleSurface.visitedRolePath ||
    stalePostProof.clickedAction !== "submit_post" ||
    stalePostProof.commandKind !== "SubmitPost" ||
    stalePostProof.command?.game !== expectedGame ||
    stalePostProof.command.channel_id !== "role-pm" ||
    stalePostProof.command.actor_slot !== "slot-7" ||
    stalePostProof.command.body !== stalePostProof.stalePrivatePostBody ||
    stalePostProof.commandStatus?.state !== "reject" ||
    stalePostProof.commandStatus.error !== "PhaseLocked" ||
    !String(stalePostProof.commandStatus.message ?? "").includes(
      "Reject PhaseLocked: phase locked; stale projection, refresh and use current controls",
    ) ||
    stalePostProof.bridgePlan?.role !== "player" ||
    stalePostProof.bridgePlan.commandKind !== "SubmitPost" ||
    stalePostProof.bridgePlan.commandEndpoint !== "/commands" ||
    stalePostProof.bridgePlan.finalState !== "reject" ||
    !sameStringArray(stalePostProof.bridgePlan.projectionRefreshKeys, [
      "thread",
      "votecount",
      "commandState",
      "dayVoteOutcomes",
    ]) ||
    stalePostProof.receipts?.at?.(-1)?.state !== "reject" ||
    stalePostProof.projectionCommandState?.phase?.phaseId !== "D02" ||
    stalePostProof.projectionCommandState?.phase?.locked !== true ||
    !String(stalePostProof.projectionCommandState?.boundary ?? "").includes(
      "private post PhaseLocked recovery",
    ) ||
    stalePostProof.projectionThread?.posts?.at?.(-1)?.body !==
      "Current role-pm thread after stale private post reject" ||
    stalePostProof.projectionThread?.posts?.some?.(
      (post) => post?.body === stalePostProof.stalePrivatePostBody,
    ) === true ||
    !String(stalePostProof.currentThreadText ?? "").includes(
      "Current role-pm thread after stale private post reject",
    ) ||
    stalePostProof.checkpointPhaseId !== "D02" ||
    stalePostProof.checkpointActionState !== "disabled:phase locked" ||
    stalePostProof.checkpointReceiptState !== "reject:PhaseLocked" ||
    !String(stalePostProof.receiptStatusText ?? "")
      .toLowerCase()
      .includes("reject phaselocked: phase locked") ||
    stalePostProof.receiptRefreshKeys !==
      "thread,votecount,commandState,dayVoteOutcomes" ||
    stalePostProof.rawInviteTokensVisible !== false
  ) {
    throw new Error(
      `core-loop admin proof missing private channel stale post recovery: ${JSON.stringify(
        stalePostProof,
      )}`,
    );
  }
}

function gameFromRoleUrl(roleUrl) {
  try {
    return new URL(roleUrl).pathname.split("/")[2] ?? "";
  } catch {
    return "";
  }
}

function assertVisibleRows(message, visibleRows, requiredRows) {
  const visible = Array.isArray(visibleRows) ? visibleRows : [];
  for (const rowId of requiredRows ?? []) {
    if (!visible.includes(rowId)) {
      throw new Error(`${message}: ${rowId}`);
    }
  }
}

function sameStringArray(actual, expected) {
  if (!Array.isArray(actual) || !Array.isArray(expected)) {
    return false;
  }
  return (
    actual.length === expected.length &&
    actual.every((item, index) => item === expected[index])
  );
}
