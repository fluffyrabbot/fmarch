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
    const hostPhaseTransitionSurface = await proveHostPhaseTransitionSurface({
      browser,
      frontendBaseUrl,
      hostRoleUrl: spineRows.roleUrlHrefs["d02-n02-host"],
      playerRoleUrl: spineRows.roleUrlHrefs["d02-n02-actionPlayer"],
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
      hostPhaseTransitionSurface,
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
    hostPhaseTransitionSurface: surfaces.hostPhaseTransitionSurface,
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
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
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

function seededDayVoteOpenCommandState({ boundary }) {
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
      locked: false,
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
  assertHostPhaseTransitionSurface(evidence.hostPhaseTransitionSurface);
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
