import path from "node:path";
import {
  coreLoopHighlightedLaneEvidence,
  coreLoopSpineStatus,
} from "../frontend/src/lib/app/local-proof-lane-status.mjs";
import {
  assertCompletedGameEndgameSurfaceAssertionCases,
  assertCompletedGameEndgameTransition,
  assertCompletedHostStaleCommandRecoveryProofCase,
  assertCompletedPlayerReloadProofCase,
  completedGameEndgameTransition,
  completedGameEndgameSurfaceAssertionCases,
  completedHostStaleCommandCases,
  completedPlayerReloadCases,
  completedPlayerReloadProofCases,
  assertStaleCompletedGamePlayerCommandRecoveryProofCase,
  staleCompletedGamePlayerCommandCases,
} from "./dev_test_game_core_loop_completed_scenarios.mjs";
import {
  playerActionSubmissionScenario,
  playerInvalidActionRecoveryScenario,
  staleNightFourActionRecoveryScenario,
} from "./dev_test_game_core_loop_action_scenarios.mjs";
import {
  completedPrivateChannelReloadScenario,
  completedPrivateChannelTransition,
  privateChannelSubmitPostScenario,
  privateReceiptAssertionArgs,
  privateReceiptProofArgs,
  privateReceiptScenario,
  assertCompletedPrivateChannelReloadProofCase,
  assertCompletedPrivateChannelProofCases,
  assertStaleCompletedPrivatePostRecoveryProofCase,
  completedPrivateChannelProofAssertionCases,
  staleCompletedPrivatePostScenario,
  stalePrivateChannelPostPhaseLockedScenario,
} from "./dev_test_game_core_loop_private_receipt_scenarios.mjs";
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
    const nightActionResolutionReceiptSurface =
      await proveNightActionResolutionReceiptSurface({
        browser,
        frontendBaseUrl,
        roleUrl: targetResolutionReceiptRoleUrl(
          spineRows.roleUrlHrefs["d02-n02-actionPlayer"],
        ),
      });
    const normalNightActionResolutionPrivacySurface =
      await proveNormalNightActionResolutionPrivacySurface({
        browser,
        frontendBaseUrl,
        roleUrl: normalResolutionPrivacyRoleUrl(
          spineRows.roleUrlHrefs["d02-n02-normalPlayer"],
        ),
      });
    const hostNightActionTransitionSurface =
      await proveHostNightActionTransitionSurface({
        browser,
        frontendBaseUrl,
        hostRoleUrl: spineRows.roleUrlHrefs["d02-n02-host"],
        actionPlayerRoleUrl: spineRows.roleUrlHrefs["d02-n02-actionPlayer"],
        nightTargetRoleUrl: targetResolutionReceiptRoleUrl(
          spineRows.roleUrlHrefs["d02-n02-actionPlayer"],
        ),
        normalRoleUrl: normalResolutionPrivacyRoleUrl(
          spineRows.roleUrlHrefs["d02-n02-normalPlayer"],
        ),
      });
    const dayThreeVoteResolutionSurface =
      await proveDayThreeVoteResolutionSurface({
        browser,
        frontendBaseUrl,
        actionPlayerRoleUrl: spineRows.roleUrlHrefs["d02-n02-actionPlayer"],
        hostRoleUrl: spineRows.roleUrlHrefs["d02-n02-host"],
      });
    const postDayThreeResolutionSurface =
      await provePostDayThreeResolutionSurface({
        browser,
        frontendBaseUrl,
        hostRoleUrl: spineRows.roleUrlHrefs["d02-n02-host"],
        actionPlayerRoleUrl: spineRows.roleUrlHrefs["d02-n02-actionPlayer"],
        targetRoleUrl: targetResolutionReceiptRoleUrl(
          spineRows.roleUrlHrefs["d02-n02-normalPlayer"],
        ),
      });
    const nightThreeEmptyResolutionSurface =
      await proveNightThreeEmptyResolutionSurface({
        browser,
        frontendBaseUrl,
        hostRoleUrl: spineRows.roleUrlHrefs["d02-n02-host"],
        actionPlayerRoleUrl: spineRows.roleUrlHrefs["d02-n02-actionPlayer"],
      });
    const dayFourSurvivorRoleSurface = await proveDayFourSurvivorRoleSurface({
      browser,
      frontendBaseUrl,
      roleUrl: spineRows.roleUrlHrefs["d02-n02-actionPlayer"],
    });
    const nightFourActionSubmissionSurface =
      await proveNightFourActionSubmissionSurface({
        browser,
        frontendBaseUrl,
        hostRoleUrl: spineRows.roleUrlHrefs["d02-n02-host"],
        actionPlayerRoleUrl: spineRows.roleUrlHrefs["d02-n02-actionPlayer"],
      });
    const nightFourResolutionReceiptSurface =
      await proveNightFourResolutionReceiptSurface({
        browser,
        frontendBaseUrl,
        hostRoleUrl: spineRows.roleUrlHrefs["d02-n02-host"],
        actionPlayerRoleUrl: spineRows.roleUrlHrefs["d02-n02-actionPlayer"],
        survivorRoleUrl: targetResolutionReceiptRoleUrl(
          spineRows.roleUrlHrefs["d02-n02-actionPlayer"],
        ),
      });
    const postNightFourTransitionSurface =
      await provePostNightFourTransitionSurface({
        browser,
        frontendBaseUrl,
        hostRoleUrl: spineRows.roleUrlHrefs["d02-n02-host"],
        actionPlayerRoleUrl: spineRows.roleUrlHrefs["d02-n02-actionPlayer"],
        survivorRoleUrl: targetResolutionReceiptRoleUrl(
          spineRows.roleUrlHrefs["d02-n02-actionPlayer"],
        ),
      });
    const dayFiveNoLynchResolutionSurface =
      await proveDayFiveNoLynchResolutionSurface({
        browser,
        frontendBaseUrl,
        hostRoleUrl: spineRows.roleUrlHrefs["d02-n02-host"],
        actionPlayerRoleUrl: spineRows.roleUrlHrefs["d02-n02-actionPlayer"],
      });
    const completedGameEndgameSurface = await proveCompletedGameEndgameSurface({
      browser,
      frontendBaseUrl,
      hostRoleUrl: spineRows.roleUrlHrefs["d02-n02-host"],
      actionPlayerRoleUrl: spineRows.roleUrlHrefs["d02-n02-actionPlayer"],
      normalPlayerRoleUrl: spineRows.roleUrlHrefs["d02-n02-normalPlayer"],
      deadPlayerRoleUrl: targetResolutionReceiptRoleUrl(
        spineRows.roleUrlHrefs["d02-n02-target"],
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
      nightActionResolutionReceiptSurface,
      normalNightActionResolutionPrivacySurface,
      hostNightActionTransitionSurface,
      dayThreeVoteResolutionSurface,
      postDayThreeResolutionSurface,
      nightThreeEmptyResolutionSurface,
      dayFourSurvivorRoleSurface,
      nightFourActionSubmissionSurface,
      nightFourResolutionReceiptSurface,
      postNightFourTransitionSurface,
      dayFiveNoLynchResolutionSurface,
      completedGameEndgameSurface,
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
      "Local SvelteKit admin role URL with fixture admin authority over the dev-test-game core-loop proof-run lanes. Proves the saved host-control, lynch and no-lynch day-vote resolution, player-action, day/night, second-night action-resolution receipt/privacy, host Night 2 resolution to Day 3 transition, Day 3 player-vote submission and host resolution, post-Day 3 receipt/privacy and advance to Night 3, empty Night 3 host resolution and advance to Day 4 player vote controls, a living Day 4 survivor role URL, Day 4 no-lynch resolution into Night 4, Night 4 action submission against the survivor, Night 4 target receipt/privacy after host resolution, post-Night 4 advance to Day 5 with dead-player/no-lynch surfaces plus stale Night 4 action recovery, Day 5 no-lynch resolution into Night 5 with stale Day 5 vote recovery, and host CompleteGame into completed endgame host/player surfaces with role URL reload closure plus stale completed-game vote recovery; official-votecount publication, private-channel, replacement, stale outgoing-player recovery, and incoming replacement-player evidence is discoverable from the seeded admin overview and inspectable in a native admin audit detail route; it does not prove hosted deployment, production identity, exhaustive action/race coverage, beta readiness, or production readiness.",
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
    nightActionResolutionReceiptSurface:
      surfaces.nightActionResolutionReceiptSurface,
    normalNightActionResolutionPrivacySurface:
      surfaces.normalNightActionResolutionPrivacySurface,
    hostNightActionTransitionSurface: surfaces.hostNightActionTransitionSurface,
    dayThreeVoteResolutionSurface: surfaces.dayThreeVoteResolutionSurface,
    postDayThreeResolutionSurface: surfaces.postDayThreeResolutionSurface,
    nightThreeEmptyResolutionSurface:
      surfaces.nightThreeEmptyResolutionSurface,
    dayFourSurvivorRoleSurface: surfaces.dayFourSurvivorRoleSurface,
    nightFourActionSubmissionSurface:
      surfaces.nightFourActionSubmissionSurface,
    nightFourResolutionReceiptSurface:
      surfaces.nightFourResolutionReceiptSurface,
    postNightFourTransitionSurface:
      surfaces.postNightFourTransitionSurface,
    dayFiveNoLynchResolutionSurface:
      surfaces.dayFiveNoLynchResolutionSurface,
    completedGameEndgameSurface:
      surfaces.completedGameEndgameSurface,
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

async function proveHostNightActionTransitionSurface({
  browser,
  frontendBaseUrl,
  hostRoleUrl,
  actionPlayerRoleUrl,
  nightTargetRoleUrl,
  normalRoleUrl,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const visitedHostRolePath = rolePathFromUrl(hostRoleUrl);
  const commandRequests = [];
  try {
    await installHostNightActionTransitionBrowserRoutes(page, { commandRequests });
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
      streamSeq: 905,
      expectedPhaseId: "N02",
      expectedPhaseState: "locked",
      expectedDeadlineAffordance: "unlock_thread,advance_phase",
    });
    const advanceProof = await proveHostPhaseActionClick({
      page,
      commandRequests,
      actionId: "advance_phase",
      commandKind: "AdvancePhase",
      streamSeq: 906,
      expectedPhaseId: "D03",
      expectedPhaseState: "open",
      expectedDeadlineAffordance: "resolve_phase,lock_thread",
    });
    const actionPlayerObservationProof = await proveDayThreePlayerObservation({
      browser,
      frontendBaseUrl,
      roleUrl: actionPlayerRoleUrl,
      cookieValue: "fixture-player",
      expectedPrincipalUserId: "player_mira",
      expectedSlot: "slot-7",
      slotField: "actionPlayerSlot",
      commandState: seededDayThreeActionPlayerCommandState({
        boundary:
          "Seeded browser action player observed host AdvancePhase from resolved N02 into open D03.",
      }),
      notifications: [],
    });
    const nightTargetObservationProof = await proveDayThreePlayerObservation({
      browser,
      frontendBaseUrl,
      roleUrl: nightTargetRoleUrl,
      cookieValue: "fixture-night-target",
      expectedPrincipalUserId: "player-seed",
      expectedSlot: "slot-3",
      slotField: "targetSlot",
      commandState: seededDayThreeNightTargetCommandState({
        boundary:
          "Seeded browser killed target stayed dead with factional_kill receipt after host advanced N02 to D03.",
      }),
      notifications: [
        {
          effect: "player_killed",
          phase_id: "N02",
          status: "factional_kill",
        },
      ],
    });
    const normalObservationProof = await proveDayThreePlayerObservation({
      browser,
      frontendBaseUrl,
      roleUrl: normalRoleUrl,
      cookieValue: "fixture-normal",
      expectedPrincipalUserId: "player_rowan",
      expectedSlot: "slot-4",
      slotField: "normalSlot",
      commandState: seededDayThreeNormalCommandState({
        boundary:
          "Seeded browser normal player observed open D03 with no target-only private receipt after host advanced N02.",
      }),
      notifications: [],
    });
    const bodyText = await page.locator("body").innerText();
    if (/invite=(?!REDACTED)/.test(bodyText)) {
      throw new Error("host night action transition proof leaked an invite URL token");
    }
    return {
      status: "passed",
      sourceHostRoleUrl: String(hostRoleUrl),
      sourceActionPlayerRoleUrl: String(actionPlayerRoleUrl),
      sourceNightTargetRoleUrl: String(nightTargetRoleUrl),
      sourceNormalRoleUrl: String(normalRoleUrl),
      visitedHostRolePath,
      surfaceTestId: "host-console-surface",
      clickedThroughFromRoleUrl: true,
      transition:
        "resolve_phase:ack:905 -> advance_phase:ack:906 -> actionPlayer:D03 -> target:D03 -> normal:D03",
      resolveProof,
      advanceProof,
      actionPlayerObservationProof,
      nightTargetObservationProof,
      normalObservationProof,
      releaseReady: false,
      productionReady: false,
    };
  } finally {
    await page.close();
  }
}

async function proveDayThreePlayerObservation({
  browser,
  frontendBaseUrl,
  roleUrl,
  cookieValue,
  expectedPrincipalUserId,
  expectedSlot,
  slotField,
  commandState,
  notifications,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const visitedRolePath = rolePathFromUrl(roleUrl);
  try {
    await installDayThreePlayerObservationRoutes(page, {
      commandState,
      notifications,
    });
    await page.context().addCookies([
      {
        name: "fmarch_fixture_session",
        value: cookieValue,
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
      return window.__fmarchTriggerPlayerResync(906);
    });
    await page.waitForFunction(
      ({ slot }) =>
        window.__fmarchPlayerProjection?.commandState?.actorSlot === slot &&
        window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "D03",
      { slot: expectedSlot },
      { timeout: 15000 },
    );
    const checkpoint = page.getByTestId("player-action-submission-checkpoint");
    await checkpoint.waitFor({ state: "visible", timeout: 15000 });
    const privateQueue = page.locator('[data-component="player-private-queue"]');
    await privateQueue.waitFor({ state: "visible", timeout: 15000 });
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
    const actionStatusText = await page
      .getByTestId("player-action-submission-status")
      .innerText();
    const projection = await page.evaluate(() => window.__fmarchPlayerProjection);
    const coldLoadEndpoints = await page.evaluate(
      () => window.__fmarchPlayerColdLoadEndpoints,
    );
    const proof = {
      status: "passed",
      sourceRoleUrl: String(roleUrl),
      visitedRolePath,
      surfaceTestId: "player-surface",
      clickedThroughFromRoleUrl: true,
      [slotField]: expectedSlot,
      principalUserId: expectedPrincipalUserId,
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
      projectionCommandState: projection?.commandState ?? null,
      projectionNotifications: projection?.notifications ?? null,
      resyncFromSeq: 906,
      resyncSnapshotCommandState: resyncSnapshot?.commandState ?? null,
      resyncSnapshotNotifications: resyncSnapshot?.notifications ?? null,
      coldLoadEndpoints,
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    };
    if (privateCount > 0) {
      const privateNotice = page.getByTestId("player-private-notification-1");
      await privateNotice.waitFor({ state: "visible", timeout: 15000 });
      const privateNoticeDetail = page.getByTestId(
        "player-private-detail-notification-1",
      );
      await privateNoticeDetail.waitFor({ state: "visible", timeout: 15000 });
      proof.privateNotice = {
        id: "notification-1",
        kind: await privateNotice.getAttribute("data-kind"),
        text: await privateNotice.innerText(),
        detailText: await privateNoticeDetail.innerText(),
      };
    } else {
      const privateEmpty = page.getByTestId("player-private-empty");
      await privateEmpty.waitFor({ state: "visible", timeout: 15000 });
      proof.privateEmptyText = await privateEmpty.innerText();
    }
    const bodyText = await page.locator("body").innerText();
    if (/invite=(?!REDACTED)/.test(bodyText)) {
      throw new Error("day three player observation leaked an invite URL token");
    }
    if (notifications.length === 0 && bodyText.includes("factional_kill")) {
      throw new Error("day three player observation rendered target-only receipt");
    }
    return proof;
  } finally {
    await page.close();
  }
}

async function proveDayThreeVoteResolutionSurface({
  browser,
  frontendBaseUrl,
  actionPlayerRoleUrl,
  hostRoleUrl,
}) {
  const playerVoteProof = await proveDayThreePlayerVoteSubmission({
    browser,
    frontendBaseUrl,
    roleUrl: actionPlayerRoleUrl,
  });
  const hostResolutionProof = await proveDayThreeHostVoteResolution({
    browser,
    frontendBaseUrl,
    roleUrl: hostRoleUrl,
  });
  return {
    status: "passed",
    sourceActionPlayerRoleUrl: String(actionPlayerRoleUrl),
    sourceHostRoleUrl: String(hostRoleUrl),
    clickedThroughFromRoleUrl: true,
    transition: "player:submit_vote:ack:907 -> host:resolve_phase:ack:908",
    playerVoteProof,
    hostResolutionProof,
    releaseReady: false,
    productionReady: false,
  };
}

async function proveDayThreePlayerVoteSubmission({
  browser,
  frontendBaseUrl,
  roleUrl,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const visitedRolePath = rolePathFromUrl(roleUrl);
  const commandRequests = [];
  try {
    await installDayThreeVoteSubmissionBrowserRoutes(page, { commandRequests });
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
    const setupSnapshot = await page.evaluate(async () => {
      if (typeof window.__fmarchTriggerPlayerResync !== "function") {
        throw new Error("player resync hook is unavailable");
      }
      return window.__fmarchTriggerPlayerResync(906);
    });
    await page.waitForFunction(
      () =>
        window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "D03" &&
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
        window.__fmarchPlayerCommandStatus?.state === "ack" &&
        window.__fmarchPlayerCommandStatus?.message?.includes(
          "Ack: stream seqs 907",
        ) &&
        window.__fmarchPlayerCommandDispatchBridgePlan?.commandKind ===
          "SubmitVote",
      null,
      { timeout: 15000 },
    );
    await page.waitForFunction(
      () =>
        window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "D03" &&
        window.__fmarchPlayerProjection?.commandState?.currentVote?.slotId ===
          "slot-4" &&
        window.__fmarchPlayerProjection?.votecount?.[0]?.target ===
          "slot-4 / Rowan",
      null,
      { timeout: 15000 },
    );
    const commandStatus = await page.evaluate(() => window.__fmarchPlayerCommandStatus);
    const bridgePlan = await page.evaluate(
      () => window.__fmarchPlayerCommandDispatchBridgePlan,
    );
    const receipts = await page.evaluate(() => window.__fmarchPlayerCommandReceipts);
    const projection = await page.evaluate(() => window.__fmarchPlayerProjection);
    const currentVote = page.getByTestId("player-current-vote");
    await currentVote.waitFor({ state: "visible", timeout: 15000 });
    const currentVoteHasVote = await currentVote.getAttribute("data-has-vote");
    const currentVoteText = await currentVote.innerText();
    const voteReceipt = page.getByTestId("player-command-receipt-submit_vote");
    await voteReceipt.waitFor({ state: "visible", timeout: 15000 });
    const receiptRefreshKeys = await voteReceipt.getAttribute(
      "data-command-refresh-keys",
    );
    const receiptCount = Number.parseInt(
      await page.getByTestId("player-command-receipt-count").innerText(),
      10,
    );
    const receiptStatusText = await page.getByTestId("player-command-status").innerText();
    const bodyText = await page.locator("body").innerText();
    if (/invite=(?!REDACTED)/.test(bodyText)) {
      throw new Error("Day 3 player vote proof leaked an invite URL token");
    }
    if (bodyText.includes("factional_kill")) {
      throw new Error("Day 3 player vote proof rendered target-only night receipt");
    }
    const command = commandRequests.at(-1)?.SubmitVote ?? null;
    return {
      status: "passed",
      sourceRoleUrl: String(roleUrl),
      visitedRolePath,
      surfaceTestId: "player-surface",
      clickedThroughFromRoleUrl: true,
      clickedAction: "submit_vote",
      commandKind: command === null ? null : "SubmitVote",
      command,
      commandStatus,
      bridgePlan,
      receipts,
      projectionCommandState: projection?.commandState ?? null,
      projectionVotecount: projection?.votecount ?? null,
      projectionDayVoteOutcomes: projection?.dayVoteOutcomes ?? null,
      setupResyncFromSeq: 906,
      setupSnapshotCommandState: setupSnapshot?.commandState ?? null,
      currentVote: {
        hasVote: currentVoteHasVote,
        text: currentVoteText,
      },
      receiptCount,
      receiptStatusText,
      receiptRefreshKeys,
      rawInviteTokensVisible: false,
      targetOnlyReceiptVisible: false,
      releaseReady: false,
      productionReady: false,
    };
  } finally {
    await page.close();
  }
}

async function proveDayThreeHostVoteResolution({
  browser,
  frontendBaseUrl,
  roleUrl,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const visitedRolePath = rolePathFromUrl(roleUrl);
  const commandRequests = [];
  try {
    await installDayThreeHostVoteResolutionBrowserRoutes(page, {
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
    const resolveProof = await proveHostPhaseActionClick({
      page,
      commandRequests,
      actionId: "resolve_phase",
      commandKind: "ResolvePhase",
      streamSeq: 908,
      expectedPhaseId: "D03",
      expectedPhaseState: "locked",
      expectedDeadlineAffordance: "unlock_thread,advance_phase",
    });
    const hostVotecountProjection = await page.evaluate(
      () => window.__fmarchHostVotecountProjection,
    );
    const hostDayVoteOutcomesProjection = await page.evaluate(
      () => window.__fmarchHostDayVoteOutcomesProjection,
    );
    const bodyText = await page.locator("body").innerText();
    if (/invite=(?!REDACTED)/.test(bodyText)) {
      throw new Error("Day 3 host vote resolution proof leaked an invite URL token");
    }
    return {
      status: "passed",
      sourceRoleUrl: String(roleUrl),
      visitedRolePath,
      surfaceTestId: "host-console-surface",
      clickedThroughFromRoleUrl: true,
      resolveProof,
      hostVotecountProjection,
      hostDayVoteOutcomesProjection,
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    };
  } finally {
    await page.close();
  }
}

async function provePostDayThreeResolutionSurface({
  browser,
  frontendBaseUrl,
  hostRoleUrl,
  actionPlayerRoleUrl,
  targetRoleUrl,
}) {
  const targetReceiptScenario = privateReceiptScenario("d03-target-receipt");
  const actionPlayerPrivacyScenario = privateReceiptScenario(
    "d03-action-player-privacy",
  );
  const targetReceiptProof = await provePostDayThreePlayerSurface({
    browser,
    frontendBaseUrl,
    roleUrl: targetRoleUrl,
    cookieValue: "fixture-normal",
    ...privateReceiptProofArgs(targetReceiptScenario),
    commandState: seededPostDayThreeVoteTargetCommandState({
      boundary:
        "Seeded browser target role received day_vote private receipt after D03 resolution.",
    }),
    threadBody: "Day 3 has resolved.",
  });
  const actionPlayerPrivacyProof = await provePostDayThreePlayerSurface({
    browser,
    frontendBaseUrl,
    roleUrl: actionPlayerRoleUrl,
    cookieValue: "fixture-player",
    ...privateReceiptProofArgs(actionPlayerPrivacyScenario),
    commandState: seededPostDayThreeActionPlayerCommandState({
      boundary:
        "Seeded browser action player stayed alive with no target-only D03 receipt after host resolved Day 3.",
    }),
    threadBody: "Day 3 has resolved.",
  });
  const hostAdvanceProof = await provePostDayThreeHostAdvance({
    browser,
    frontendBaseUrl,
    roleUrl: hostRoleUrl,
  });
  const actionPlayerNightThreeProof = await provePostDayThreePlayerSurface({
    browser,
    frontendBaseUrl,
    roleUrl: actionPlayerRoleUrl,
    cookieValue: "fixture-player",
    expectedSlot: "slot-7",
    principalUserId: "player_mira",
    slotField: "actionPlayerSlot",
    commandState: seededNightThreeActionPlayerCommandState({
      boundary:
        "Seeded browser action player observed host AdvancePhase from locked D03 into open N03.",
    }),
    notifications: [],
    resyncFromSeq: 909,
    threadBody: "Night 3 has opened.",
  });
  return {
    status: "passed",
    sourceHostRoleUrl: String(hostRoleUrl),
    sourceActionPlayerRoleUrl: String(actionPlayerRoleUrl),
    sourceTargetRoleUrl: String(targetRoleUrl),
    clickedThroughFromRoleUrl: true,
    transition:
      "target:D03:day_vote -> actionPlayer:D03:privacy -> host:advance_phase:ack:909 -> actionPlayer:N03",
    targetReceiptProof,
    actionPlayerPrivacyProof,
    hostAdvanceProof,
    actionPlayerNightThreeProof,
    releaseReady: false,
    productionReady: false,
  };
}

async function proveNightThreeEmptyResolutionSurface({
  browser,
  frontendBaseUrl,
  hostRoleUrl,
  actionPlayerRoleUrl,
}) {
  const actionPlayerNoActionProof = await provePostDayThreePlayerSurface({
    browser,
    frontendBaseUrl,
    roleUrl: actionPlayerRoleUrl,
    cookieValue: "fixture-player",
    expectedSlot: "slot-7",
    principalUserId: "player_mira",
    slotField: "actionPlayerSlot",
    commandState: seededNightThreeActionPlayerCommandState({
      boundary:
        "Seeded browser action player opened N03 with no legal night action after D03 attrition.",
    }),
    notifications: [],
    resyncFromSeq: 909,
    threadBody: "Night 3 has opened.",
  });
  const hostTransitionProof = await proveNightThreeEmptyHostTransition({
    browser,
    frontendBaseUrl,
    roleUrl: hostRoleUrl,
  });
  const actionPlayerDayFourProof = await provePostDayThreePlayerSurface({
    browser,
    frontendBaseUrl,
    roleUrl: actionPlayerRoleUrl,
    cookieValue: "fixture-player",
    expectedSlot: "slot-7",
    principalUserId: "player_mira",
    slotField: "actionPlayerSlot",
    commandState: seededDayFourActionPlayerCommandState({
      boundary:
        "Seeded browser action player observed host AdvancePhase from empty N03 into open D04 no-lynch voting.",
    }),
    notifications: [],
    resyncFromSeq: 911,
    threadBody: "Day 4 has opened.",
    expectedVoteButtonCount: 1,
  });
  return {
    status: "passed",
    sourceHostRoleUrl: String(hostRoleUrl),
    sourceActionPlayerRoleUrl: String(actionPlayerRoleUrl),
    clickedThroughFromRoleUrl: true,
    transition:
      "actionPlayer:N03:no_action -> host:resolve_phase:ack:910 -> host:advance_phase:ack:911 -> actionPlayer:D04:no_lynch_vote",
    actionPlayerNoActionProof,
    hostTransitionProof,
    actionPlayerDayFourProof,
    releaseReady: false,
    productionReady: false,
  };
}

async function proveDayFourSurvivorRoleSurface({
  browser,
  frontendBaseUrl,
  roleUrl,
}) {
  const survivorProof = await provePostDayThreePlayerSurface({
    browser,
    frontendBaseUrl,
    roleUrl,
    cookieValue: "fixture-survivor",
    expectedSlot: "slot-5",
    principalUserId: "player_sage",
    slotField: "survivorSlot",
    commandState: seededDayFourSurvivorCommandState({
      boundary:
        "Seeded browser survivor role opened D04 as a living vote target for the next night-action loop.",
    }),
    notifications: [],
    resyncFromSeq: 911,
    threadBody: "Day 4 has opened.",
    expectedVoteButtonCount: 2,
  });
  return {
    status: "passed",
    sourceRoleUrl: String(roleUrl),
    clickedThroughFromRoleUrl: true,
    survivorProof,
    releaseReady: false,
    productionReady: false,
  };
}

async function proveNightFourActionSubmissionSurface({
  browser,
  frontendBaseUrl,
  hostRoleUrl,
  actionPlayerRoleUrl,
}) {
  const dayFourVoteProof = await proveDayFourNoLynchVoteSubmission({
    browser,
    frontendBaseUrl,
    roleUrl: actionPlayerRoleUrl,
  });
  const hostTransitionProof = await proveDayFourNoLynchHostTransition({
    browser,
    frontendBaseUrl,
    roleUrl: hostRoleUrl,
  });
  const nightFourActionProof = await proveNightFourPlayerActionSubmission({
    browser,
    frontendBaseUrl,
    roleUrl: actionPlayerRoleUrl,
  });
  return {
    status: "passed",
    sourceHostRoleUrl: String(hostRoleUrl),
    sourceActionPlayerRoleUrl: String(actionPlayerRoleUrl),
    clickedThroughFromRoleUrl: true,
    transition:
      "player:D04:no_lynch:ack:912 -> host:D04:resolve_phase:ack:913 -> host:advance_phase:ack:914 -> player:N04:submit_action:slot-5:ack:915",
    dayFourVoteProof,
    hostTransitionProof,
    nightFourActionProof,
    releaseReady: false,
    productionReady: false,
  };
}

async function proveNightFourResolutionReceiptSurface({
  browser,
  frontendBaseUrl,
  hostRoleUrl,
  actionPlayerRoleUrl,
  survivorRoleUrl,
}) {
  const survivorReceiptScenario = privateReceiptScenario("n04-survivor-receipt");
  const actionPlayerPrivacyScenario = privateReceiptScenario(
    "n04-action-player-privacy",
  );
  const hostResolutionProof = await proveNightFourHostResolution({
    browser,
    frontendBaseUrl,
    roleUrl: hostRoleUrl,
  });
  const survivorReceiptProof = await provePostDayThreePlayerSurface({
    browser,
    frontendBaseUrl,
    roleUrl: survivorRoleUrl,
    cookieValue: "fixture-survivor",
    ...privateReceiptProofArgs(survivorReceiptScenario),
    commandState: seededNightFourSurvivorKilledCommandState({
      boundary:
        "Seeded browser survivor target received factional_kill private receipt after N04 resolution.",
    }),
    threadBody: "Night 4 has resolved.",
    dayVoteOutcomesRows: [
      ...dayTwoVoteOutcomeRows(),
      dayThreeVoteOutcomeRow(),
      dayFourNoLynchOutcomeRow(),
    ],
  });
  const actionPlayerPrivacyProof = await provePostDayThreePlayerSurface({
    browser,
    frontendBaseUrl,
    roleUrl: actionPlayerRoleUrl,
    cookieValue: "fixture-player",
    ...privateReceiptProofArgs(actionPlayerPrivacyScenario),
    commandState: seededNightFourActionPlayerResolvedCommandState({
      boundary:
        "Seeded browser action player stayed alive with no target-only N04 receipt after host resolved Night 4.",
    }),
    threadBody: "Night 4 has resolved.",
    dayVoteOutcomesRows: [
      ...dayTwoVoteOutcomeRows(),
      dayThreeVoteOutcomeRow(),
      dayFourNoLynchOutcomeRow(),
    ],
  });
  return {
    status: "passed",
    sourceHostRoleUrl: String(hostRoleUrl),
    sourceActionPlayerRoleUrl: String(actionPlayerRoleUrl),
    sourceSurvivorRoleUrl: String(survivorRoleUrl),
    clickedThroughFromRoleUrl: true,
    transition:
      "host:N04:resolve_phase:ack:916 -> survivor:N04:factional_kill_receipt -> actionPlayer:N04:privacy",
    hostResolutionProof,
    survivorReceiptProof,
    actionPlayerPrivacyProof,
    releaseReady: false,
    productionReady: false,
  };
}

async function provePostNightFourTransitionSurface({
  browser,
  frontendBaseUrl,
  hostRoleUrl,
  actionPlayerRoleUrl,
  survivorRoleUrl,
}) {
  const hostAdvanceProof = await provePostNightFourHostAdvance({
    browser,
    frontendBaseUrl,
    roleUrl: hostRoleUrl,
  });
  const survivorDayFiveProof = await provePostDayThreePlayerSurface({
    browser,
    frontendBaseUrl,
    roleUrl: survivorRoleUrl,
    cookieValue: "fixture-survivor",
    expectedSlot: "slot-5",
    principalUserId: "player_sage",
    slotField: "survivorSlot",
    commandState: seededDayFiveSurvivorKilledCommandState({
      boundary:
        "Seeded browser survivor stayed dead with no controls after N04 advanced to Day 5.",
    }),
    notifications: [
      {
        effect: "player_killed",
        phase_id: "N04",
        status: "factional_kill",
      },
    ],
    resyncFromSeq: 917,
    threadBody: "Day 5 has opened.",
    dayVoteOutcomesRows: [
      ...dayTwoVoteOutcomeRows(),
      dayThreeVoteOutcomeRow(),
      dayFourNoLynchOutcomeRow(),
    ],
  });
  const actionPlayerDayFiveProof = await provePostDayThreePlayerSurface({
    browser,
    frontendBaseUrl,
    roleUrl: actionPlayerRoleUrl,
    cookieValue: "fixture-player",
    expectedSlot: "slot-7",
    principalUserId: "player_mira",
    slotField: "actionPlayerSlot",
    commandState: seededDayFiveActionPlayerCommandState({
      boundary:
        "Seeded browser action player observed open Day 5 no-lynch controls after Night 4 advanced.",
    }),
    notifications: [],
    resyncFromSeq: 917,
    threadBody: "Day 5 has opened.",
    expectedVoteButtonCount: 1,
    dayVoteOutcomesRows: [
      ...dayTwoVoteOutcomeRows(),
      dayThreeVoteOutcomeRow(),
      dayFourNoLynchOutcomeRow(),
    ],
  });
  const staleNightFourActionRecoveryProof =
    await proveStaleNightFourActionRecovery({
      browser,
      frontendBaseUrl,
      roleUrl: actionPlayerRoleUrl,
    });
  return {
    status: "passed",
    sourceHostRoleUrl: String(hostRoleUrl),
    sourceActionPlayerRoleUrl: String(actionPlayerRoleUrl),
    sourceSurvivorRoleUrl: String(survivorRoleUrl),
    clickedThroughFromRoleUrl: true,
    transition:
      "host:N04:advance_phase:ack:917 -> survivor:D05:dead_no_controls -> actionPlayer:D05:no_lynch_controls -> stale:N04:submit_action:reject:PhaseLocked",
    hostAdvanceProof,
    survivorDayFiveProof,
    actionPlayerDayFiveProof,
    staleNightFourActionRecoveryProof,
    releaseReady: false,
    productionReady: false,
  };
}

async function proveDayFiveNoLynchResolutionSurface({
  browser,
  frontendBaseUrl,
  hostRoleUrl,
  actionPlayerRoleUrl,
}) {
  const dayFiveVoteProof = await proveDayFiveNoLynchVoteSubmission({
    browser,
    frontendBaseUrl,
    roleUrl: actionPlayerRoleUrl,
  });
  const hostTransitionProof = await proveDayFiveNoLynchHostTransition({
    browser,
    frontendBaseUrl,
    roleUrl: hostRoleUrl,
  });
  const actionPlayerNightFiveProof = await provePostDayThreePlayerSurface({
    browser,
    frontendBaseUrl,
    roleUrl: actionPlayerRoleUrl,
    cookieValue: "fixture-player",
    expectedSlot: "slot-7",
    principalUserId: "player_mira",
    slotField: "actionPlayerSlot",
    commandState: seededNightFiveActionPlayerCommandState({
      boundary:
        "Seeded browser action player observed host AdvancePhase from Day 5 no-lynch into open Night 5 with no legal action.",
    }),
    notifications: [],
    resyncFromSeq: 920,
    threadBody: "Night 5 has opened.",
    dayVoteOutcomesRows: [
      ...dayTwoVoteOutcomeRows(),
      dayThreeVoteOutcomeRow(),
      dayFourNoLynchOutcomeRow(),
      dayFiveNoLynchOutcomeRow(),
    ],
  });
  const staleDayFiveVoteRecoveryProof = await proveStaleDayFiveVoteRecovery({
    browser,
    frontendBaseUrl,
    roleUrl: actionPlayerRoleUrl,
  });
  return {
    status: "passed",
    sourceHostRoleUrl: String(hostRoleUrl),
    sourceActionPlayerRoleUrl: String(actionPlayerRoleUrl),
    clickedThroughFromRoleUrl: true,
    transition:
      "player:D05:no_lynch:ack:918 -> host:D05:resolve_phase:ack:919 -> host:advance_phase:ack:920 -> actionPlayer:N05:no_action -> stale:D05:submit_vote:reject:PhaseLocked",
    dayFiveVoteProof,
    hostTransitionProof,
    actionPlayerNightFiveProof,
    staleDayFiveVoteRecoveryProof,
    releaseReady: false,
    productionReady: false,
  };
}

async function proveCompletedGameEndgameSurface({
  browser,
  frontendBaseUrl,
  hostRoleUrl,
  actionPlayerRoleUrl,
  normalPlayerRoleUrl,
  deadPlayerRoleUrl,
}) {
  const hostCompleteProof = await proveHostCompleteGameFromNightFive({
    browser,
    frontendBaseUrl,
    roleUrl: hostRoleUrl,
  });
  const completedHostReloadProof = await proveCompletedHostRoleReload({
    browser,
    frontendBaseUrl,
    roleUrl: hostRoleUrl,
  });
  const completedHostStaleRecoveryProofs =
    await proveCompletedHostStaleCommandRecoveryCases({
      browser,
      frontendBaseUrl,
      roleUrl: hostRoleUrl,
      cases: completedHostStaleCommandCases(),
    });
  const actionPlayerCompletedProof = await provePostDayThreePlayerSurface({
    browser,
    frontendBaseUrl,
    roleUrl: actionPlayerRoleUrl,
    cookieValue: "fixture-player",
    expectedSlot: "slot-7",
    principalUserId: "player_mira",
    slotField: "actionPlayerSlot",
    commandState: seededCompletedActionPlayerCommandState({
      boundary:
        "Seeded browser action player observed completed game endgame state with no vote, post, or action controls.",
    }),
    notifications: [],
    resyncFromSeq: 921,
    threadBody: "The game is complete.",
    dayVoteOutcomesRows: [
      ...dayTwoVoteOutcomeRows(),
      dayThreeVoteOutcomeRow(),
      dayFourNoLynchOutcomeRow(),
      dayFiveNoLynchOutcomeRow(),
    ],
  });
  const completedPlayerReloadProofs = await proveCompletedPlayerRoleReloadCases({
    browser,
    frontendBaseUrl,
    cases: completedPlayerReloadProofCases({
      actionPlayerRoleUrl,
      normalPlayerRoleUrl,
      deadPlayerRoleUrl,
      commandStateBuilders: completedPlayerReloadCommandStateBuilders(),
    }),
  });
  const completedDeadPlayerStaleVoteRecoveryProof =
    await proveCompletedDeadPlayerStaleVoteRecovery({
      browser,
      frontendBaseUrl,
      roleUrl: deadPlayerRoleUrl,
    });
  const staleCompletedPlayerRecoveryProofs =
    await proveStaleCompletedGamePlayerCommandRecoveryCases({
      browser,
      frontendBaseUrl,
      roleUrl: actionPlayerRoleUrl,
      cases: staleCompletedGamePlayerCommandCases(),
    });
  return {
    status: "passed",
    sourceHostRoleUrl: String(hostRoleUrl),
    sourceActionPlayerRoleUrl: String(actionPlayerRoleUrl),
    sourceNormalPlayerRoleUrl: String(normalPlayerRoleUrl),
    sourceDeadPlayerRoleUrl: String(deadPlayerRoleUrl),
    clickedThroughFromRoleUrl: true,
    transition: completedGameEndgameTransition(),
    hostCompleteProof,
    completedHostReloadProof,
    ...completedHostStaleRecoveryProofs,
    actionPlayerCompletedProof,
    ...completedPlayerReloadProofs,
    completedDeadPlayerStaleVoteRecoveryProof,
    ...staleCompletedPlayerRecoveryProofs,
    releaseReady: false,
    productionReady: false,
  };
}

async function proveNightFourHostResolution({
  browser,
  frontendBaseUrl,
  roleUrl,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const visitedRolePath = rolePathFromUrl(roleUrl);
  const commandRequests = [];
  try {
    await installNightFourHostResolutionBrowserRoutes(page, { commandRequests });
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
      return window.__fmarchTriggerHostResync(915);
    });
    await page.waitForFunction(
      () => {
        const checkpoint = document.querySelector(
          '[data-testid="host-lifecycle-control-checkpoint"]',
        );
        return (
          checkpoint?.getAttribute("data-phase-id") === "N04" &&
          checkpoint?.getAttribute("data-phase-state") === "open" &&
          checkpoint?.getAttribute("data-deadline-affordance") ===
            "resolve_phase,lock_thread"
        );
      },
      null,
      { timeout: 15000 },
    );
    const resolveProof = await proveHostPhaseActionClick({
      page,
      commandRequests,
      actionId: "resolve_phase",
      commandKind: "ResolvePhase",
      streamSeq: 916,
      expectedPhaseId: "N04",
      expectedPhaseState: "locked",
      expectedDeadlineAffordance: "unlock_thread,advance_phase",
    });
    const bodyText = await page.locator("body").innerText();
    if (/invite=(?!REDACTED)/.test(bodyText)) {
      throw new Error("Night 4 host resolution proof leaked an invite URL token");
    }
    return {
      status: "passed",
      sourceRoleUrl: String(roleUrl),
      visitedRolePath,
      surfaceTestId: "host-console-surface",
      clickedThroughFromRoleUrl: true,
      setupResyncFromSeq: 915,
      setupSnapshotHost: setupSnapshot?.host ?? null,
      resolveProof,
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    };
  } finally {
    await page.close();
  }
}

async function proveDayFourNoLynchVoteSubmission({
  browser,
  frontendBaseUrl,
  roleUrl,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const visitedRolePath = rolePathFromUrl(roleUrl);
  const commandRequests = [];
  try {
    await installDayFourNoLynchVoteSubmissionBrowserRoutes(page, {
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
    const setupSnapshot = await page.evaluate(async () => {
      if (typeof window.__fmarchTriggerPlayerResync !== "function") {
        throw new Error("player resync hook is unavailable");
      }
      return window.__fmarchTriggerPlayerResync(911);
    });
    await page.waitForFunction(
      () =>
        window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "D04" &&
        document.querySelector(
          '[data-testid="player-composer"] button[data-action="submit_vote:no_lynch"]',
        ) !== null,
      null,
      { timeout: 15000 },
    );
    const voteButton = page.locator(
      '[data-testid="player-composer"] button[data-action="submit_vote:no_lynch"]',
    );
    await voteButton.waitFor({ state: "visible", timeout: 15000 });
    await voteButton.click();
    await page.waitForFunction(
      () =>
        window.__fmarchPlayerCommandStatus?.state === "ack" &&
        window.__fmarchPlayerCommandStatus?.message?.includes(
          "Ack: stream seqs 912",
        ) &&
        window.__fmarchPlayerCommandDispatchBridgePlan?.commandKind ===
          "SubmitVote",
      null,
      { timeout: 15000 },
    );
    await page.waitForFunction(
      () =>
        window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "D04" &&
        window.__fmarchPlayerProjection?.commandState?.currentVote?.kind ===
          "no_lynch" &&
        window.__fmarchPlayerProjection?.votecount?.[0]?.target === "No lynch",
      null,
      { timeout: 15000 },
    );
    const commandStatus = await page.evaluate(() => window.__fmarchPlayerCommandStatus);
    const bridgePlan = await page.evaluate(
      () => window.__fmarchPlayerCommandDispatchBridgePlan,
    );
    const receipts = await page.evaluate(() => window.__fmarchPlayerCommandReceipts);
    const projection = await page.evaluate(() => window.__fmarchPlayerProjection);
    const currentVote = page.getByTestId("player-current-vote");
    await currentVote.waitFor({ state: "visible", timeout: 15000 });
    const currentVoteHasVote = await currentVote.getAttribute("data-has-vote");
    const currentVoteText = await currentVote.innerText();
    const voteReceipt = page.getByTestId(
      "player-command-receipt-submit_vote:no_lynch",
    );
    await voteReceipt.waitFor({ state: "visible", timeout: 15000 });
    const receiptRefreshKeys = await voteReceipt.getAttribute(
      "data-command-refresh-keys",
    );
    const receiptCount = Number.parseInt(
      await page.getByTestId("player-command-receipt-count").innerText(),
      10,
    );
    const receiptStatusText = await page.getByTestId("player-command-status").innerText();
    const bodyText = await page.locator("body").innerText();
    if (/invite=(?!REDACTED)/.test(bodyText)) {
      throw new Error("Day 4 no-lynch vote proof leaked an invite URL token");
    }
    if (bodyText.includes("factional_kill")) {
      throw new Error("Day 4 no-lynch vote proof rendered target-only night receipt");
    }
    const command = commandRequests.at(-1)?.SubmitVote ?? null;
    return {
      status: "passed",
      sourceRoleUrl: String(roleUrl),
      visitedRolePath,
      surfaceTestId: "player-surface",
      clickedThroughFromRoleUrl: true,
      clickedAction: "submit_vote:no_lynch",
      commandKind: command === null ? null : "SubmitVote",
      command,
      commandStatus,
      bridgePlan,
      receipts,
      projectionCommandState: projection?.commandState ?? null,
      projectionVotecount: projection?.votecount ?? null,
      projectionDayVoteOutcomes: projection?.dayVoteOutcomes ?? null,
      setupResyncFromSeq: 911,
      setupSnapshotCommandState: setupSnapshot?.commandState ?? null,
      currentVote: {
        hasVote: currentVoteHasVote,
        text: currentVoteText,
      },
      receiptCount,
      receiptStatusText,
      receiptRefreshKeys,
      rawInviteTokensVisible: false,
      targetOnlyReceiptVisible: false,
      releaseReady: false,
      productionReady: false,
    };
  } finally {
    await page.close();
  }
}

async function proveDayFourNoLynchHostTransition({
  browser,
  frontendBaseUrl,
  roleUrl,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const visitedRolePath = rolePathFromUrl(roleUrl);
  const commandRequests = [];
  try {
    await installDayFourNoLynchHostTransitionBrowserRoutes(page, {
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
    const setupSnapshot = await page.evaluate(async () => {
      if (typeof window.__fmarchTriggerHostResync !== "function") {
        throw new Error("host resync hook is unavailable");
      }
      return window.__fmarchTriggerHostResync(912);
    });
    await page.waitForFunction(
      () => {
        const checkpoint = document.querySelector(
          '[data-testid="host-lifecycle-control-checkpoint"]',
        );
        return (
          checkpoint?.getAttribute("data-phase-id") === "D04" &&
          checkpoint?.getAttribute("data-phase-state") === "open" &&
          checkpoint?.getAttribute("data-deadline-affordance") ===
            "resolve_phase,lock_thread"
        );
      },
      null,
      { timeout: 15000 },
    );
    const resolveProof = await proveHostPhaseActionClick({
      page,
      commandRequests,
      actionId: "resolve_phase",
      commandKind: "ResolvePhase",
      streamSeq: 913,
      expectedPhaseId: "D04",
      expectedPhaseState: "locked",
      expectedDeadlineAffordance: "unlock_thread,advance_phase",
    });
    const advanceProof = await proveHostPhaseActionClick({
      page,
      commandRequests,
      actionId: "advance_phase",
      commandKind: "AdvancePhase",
      streamSeq: 914,
      expectedPhaseId: "N04",
      expectedPhaseState: "open",
      expectedDeadlineAffordance: "resolve_phase,lock_thread",
    });
    const bodyText = await page.locator("body").innerText();
    if (/invite=(?!REDACTED)/.test(bodyText)) {
      throw new Error("Day 4 no-lynch host transition proof leaked an invite URL token");
    }
    return {
      status: "passed",
      sourceRoleUrl: String(roleUrl),
      visitedRolePath,
      surfaceTestId: "host-console-surface",
      clickedThroughFromRoleUrl: true,
      setupResyncFromSeq: 912,
      setupSnapshotHost: setupSnapshot?.host ?? null,
      resolveProof,
      advanceProof,
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    };
  } finally {
    await page.close();
  }
}

async function proveDayFiveNoLynchVoteSubmission({
  browser,
  frontendBaseUrl,
  roleUrl,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const visitedRolePath = rolePathFromUrl(roleUrl);
  const commandRequests = [];
  try {
    await installDayFiveNoLynchVoteSubmissionBrowserRoutes(page, {
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
    const setupSnapshot = await page.evaluate(async () => {
      if (typeof window.__fmarchTriggerPlayerResync !== "function") {
        throw new Error("player resync hook is unavailable");
      }
      return window.__fmarchTriggerPlayerResync(917);
    });
    await page.waitForFunction(
      () =>
        window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "D05" &&
        document.querySelector(
          '[data-testid="player-composer"] button[data-action="submit_vote:no_lynch"]',
        ) !== null,
      null,
      { timeout: 15000 },
    );
    const voteButton = page.locator(
      '[data-testid="player-composer"] button[data-action="submit_vote:no_lynch"]',
    );
    await voteButton.waitFor({ state: "visible", timeout: 15000 });
    await voteButton.click();
    await page.waitForFunction(
      () =>
        window.__fmarchPlayerCommandStatus?.state === "ack" &&
        window.__fmarchPlayerCommandStatus?.message?.includes(
          "Ack: stream seqs 918",
        ) &&
        window.__fmarchPlayerCommandDispatchBridgePlan?.commandKind ===
          "SubmitVote",
      null,
      { timeout: 15000 },
    );
    await page.waitForFunction(
      () =>
        window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "D05" &&
        window.__fmarchPlayerProjection?.commandState?.currentVote?.kind ===
          "no_lynch" &&
        window.__fmarchPlayerProjection?.votecount?.[0]?.target === "No lynch",
      null,
      { timeout: 15000 },
    );
    const commandStatus = await page.evaluate(() => window.__fmarchPlayerCommandStatus);
    const bridgePlan = await page.evaluate(
      () => window.__fmarchPlayerCommandDispatchBridgePlan,
    );
    const receipts = await page.evaluate(() => window.__fmarchPlayerCommandReceipts);
    const projection = await page.evaluate(() => window.__fmarchPlayerProjection);
    const currentVote = page.getByTestId("player-current-vote");
    await currentVote.waitFor({ state: "visible", timeout: 15000 });
    const currentVoteHasVote = await currentVote.getAttribute("data-has-vote");
    const currentVoteText = await currentVote.innerText();
    const voteReceipt = page.getByTestId(
      "player-command-receipt-submit_vote:no_lynch",
    );
    await voteReceipt.waitFor({ state: "visible", timeout: 15000 });
    const receiptRefreshKeys = await voteReceipt.getAttribute(
      "data-command-refresh-keys",
    );
    const receiptCount = Number.parseInt(
      await page.getByTestId("player-command-receipt-count").innerText(),
      10,
    );
    const receiptStatusText = await page.getByTestId("player-command-status").innerText();
    const bodyText = await page.locator("body").innerText();
    if (/invite=(?!REDACTED)/.test(bodyText)) {
      throw new Error("Day 5 no-lynch vote proof leaked an invite URL token");
    }
    if (bodyText.includes("factional_kill")) {
      throw new Error("Day 5 no-lynch vote proof rendered target-only night receipt");
    }
    const command = commandRequests.at(-1)?.SubmitVote ?? null;
    return {
      status: "passed",
      sourceRoleUrl: String(roleUrl),
      visitedRolePath,
      surfaceTestId: "player-surface",
      clickedThroughFromRoleUrl: true,
      clickedAction: "submit_vote:no_lynch",
      commandKind: command === null ? null : "SubmitVote",
      command,
      commandStatus,
      bridgePlan,
      receipts,
      projectionCommandState: projection?.commandState ?? null,
      projectionVotecount: projection?.votecount ?? null,
      projectionDayVoteOutcomes: projection?.dayVoteOutcomes ?? null,
      setupResyncFromSeq: 917,
      setupSnapshotCommandState: setupSnapshot?.commandState ?? null,
      currentVote: {
        hasVote: currentVoteHasVote,
        text: currentVoteText,
      },
      receiptCount,
      receiptStatusText,
      receiptRefreshKeys,
      rawInviteTokensVisible: false,
      targetOnlyReceiptVisible: false,
      releaseReady: false,
      productionReady: false,
    };
  } finally {
    await page.close();
  }
}

async function proveDayFiveNoLynchHostTransition({
  browser,
  frontendBaseUrl,
  roleUrl,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const visitedRolePath = rolePathFromUrl(roleUrl);
  const commandRequests = [];
  try {
    await installDayFiveNoLynchHostTransitionBrowserRoutes(page, {
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
    const setupSnapshot = await page.evaluate(async () => {
      if (typeof window.__fmarchTriggerHostResync !== "function") {
        throw new Error("host resync hook is unavailable");
      }
      return window.__fmarchTriggerHostResync(918);
    });
    await page.waitForFunction(
      () => {
        const checkpoint = document.querySelector(
          '[data-testid="host-lifecycle-control-checkpoint"]',
        );
        return (
          checkpoint?.getAttribute("data-phase-id") === "D05" &&
          checkpoint?.getAttribute("data-phase-state") === "open" &&
          checkpoint?.getAttribute("data-deadline-affordance") ===
            "resolve_phase,lock_thread"
        );
      },
      null,
      { timeout: 15000 },
    );
    const resolveProof = await proveHostPhaseActionClick({
      page,
      commandRequests,
      actionId: "resolve_phase",
      commandKind: "ResolvePhase",
      streamSeq: 919,
      expectedPhaseId: "D05",
      expectedPhaseState: "locked",
      expectedDeadlineAffordance: "unlock_thread,advance_phase",
    });
    const advanceProof = await proveHostPhaseActionClick({
      page,
      commandRequests,
      actionId: "advance_phase",
      commandKind: "AdvancePhase",
      streamSeq: 920,
      expectedPhaseId: "N05",
      expectedPhaseState: "open",
      expectedDeadlineAffordance: "resolve_phase,lock_thread",
    });
    const bodyText = await page.locator("body").innerText();
    if (/invite=(?!REDACTED)/.test(bodyText)) {
      throw new Error("Day 5 no-lynch host transition proof leaked an invite URL token");
    }
    return {
      status: "passed",
      sourceRoleUrl: String(roleUrl),
      visitedRolePath,
      surfaceTestId: "host-console-surface",
      clickedThroughFromRoleUrl: true,
      setupResyncFromSeq: 918,
      setupSnapshotHost: setupSnapshot?.host ?? null,
      resolveProof,
      advanceProof,
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    };
  } finally {
    await page.close();
  }
}

async function proveStaleDayFiveVoteRecovery({
  browser,
  frontendBaseUrl,
  roleUrl,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const visitedRolePath = rolePathFromUrl(roleUrl);
  const commandRequests = [];
  try {
    await installStaleDayFiveVoteRecoveryBrowserRoutes(page, { commandRequests });
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
    const setupSnapshot = await page.evaluate(async () => {
      if (typeof window.__fmarchTriggerPlayerResync !== "function") {
        throw new Error("player resync hook is unavailable");
      }
      return window.__fmarchTriggerPlayerResync(918);
    });
    await page.waitForFunction(
      () =>
        window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "D05" &&
        document.querySelector(
          '[data-testid="player-composer"] button[data-action="submit_vote:no_lynch"]',
        ) !== null,
      null,
      { timeout: 15000 },
    );
    const voteButton = page.locator(
      '[data-testid="player-composer"] button[data-action="submit_vote:no_lynch"]',
    );
    await voteButton.waitFor({ state: "visible", timeout: 15000 });
    await voteButton.click();
    await page.waitForFunction(
      () =>
        window.__fmarchPlayerCommandStatus?.state === "reject" &&
        window.__fmarchPlayerCommandStatus?.error === "PhaseLocked" &&
        window.__fmarchPlayerCommandDispatchBridgePlan?.commandKind ===
          "SubmitVote" &&
        window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "N05",
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
          ?.getAttribute("data-phase-id") === "N05",
      null,
      { timeout: 15000 },
    );
    const proof = await collectPlayerStaleCommandProof({
      page,
      commandRequests,
      clickedAction: "submit_vote:no_lynch",
      commandKind: "SubmitVote",
      commandSelector: "SubmitVote",
    });
    const bodyText = await page.locator("body").innerText();
    if (/invite=(?!REDACTED)/.test(bodyText)) {
      throw new Error("Day 5 stale vote proof leaked an invite URL token");
    }
    if (bodyText.includes("factional_kill")) {
      throw new Error("Day 5 stale vote proof leaked target-only night receipt");
    }
    return {
      ...proof,
      sourceRoleUrl: String(roleUrl),
      visitedRolePath,
      surfaceTestId: "player-surface",
      clickedThroughFromRoleUrl: true,
      setupResyncFromSeq: 918,
      setupSnapshotCommandState: setupSnapshot?.commandState ?? null,
      rawInviteTokensVisible: false,
      targetOnlyReceiptVisible: false,
      releaseReady: false,
      productionReady: false,
    };
  } finally {
    await page.close();
  }
}

async function proveHostCompleteGameFromNightFive({
  browser,
  frontendBaseUrl,
  roleUrl,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const visitedRolePath = rolePathFromUrl(roleUrl);
  const commandRequests = [];
  try {
    await installHostCompleteGameFromNightFiveBrowserRoutes(page, {
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
    const setupSnapshot = await page.evaluate(async () => {
      if (typeof window.__fmarchTriggerHostResync !== "function") {
        throw new Error("host resync hook is unavailable");
      }
      return window.__fmarchTriggerHostResync(920);
    });
    await page.waitForFunction(
      () => {
        const checkpoint = document.querySelector(
          '[data-testid="host-lifecycle-control-checkpoint"]',
        );
        return (
          checkpoint?.getAttribute("data-phase-id") === "N05" &&
          checkpoint?.getAttribute("data-phase-state") === "open" &&
          checkpoint?.getAttribute("data-deadline-affordance") ===
            "resolve_phase,lock_thread"
        );
      },
      null,
      { timeout: 15000 },
    );
    const completeProof = await proveHostPhaseActionClick({
      page,
      commandRequests,
      actionId: "complete_game",
      commandKind: "CompleteGame",
      streamSeq: 921,
      expectedPhaseId: "N05",
      expectedPhaseState: "open",
      expectedDeadlineAffordance: "none",
    });
    const bodyText = await page.locator("body").innerText();
    if (/invite=(?!REDACTED)/.test(bodyText)) {
      throw new Error("completed-game host proof leaked an invite URL token");
    }
    return {
      status: "passed",
      sourceRoleUrl: String(roleUrl),
      visitedRolePath,
      surfaceTestId: "host-console-surface",
      clickedThroughFromRoleUrl: true,
      setupResyncFromSeq: 920,
      setupSnapshotHost: setupSnapshot?.host ?? null,
      completeProof,
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    };
  } finally {
    await page.close();
  }
}

async function proveCompletedHostRoleReload({
  browser,
  frontendBaseUrl,
  roleUrl,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const visitedRolePath = rolePathFromUrl(roleUrl);
  try {
    await installCompletedHostRoleReloadBrowserRoutes(page);
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
    const initialResyncSnapshot = await page.evaluate(async () => {
      if (typeof window.__fmarchTriggerHostResync !== "function") {
        throw new Error("host resync hook is unavailable");
      }
      return window.__fmarchTriggerHostResync(921);
    });
    await page.waitForFunction(
      () =>
        window.__fmarchHostProjection?.completed === true &&
        window.__fmarchHostProjection?.phase?.id === "N05",
      null,
      { timeout: 15000 },
    );
    const initialSnapshot = await collectCompletedHostReloadSnapshot(page);
    await page.reload({ waitUntil: "networkidle" });
    await page.getByTestId("host-console-surface").waitFor({
      state: "visible",
      timeout: 15000,
    });
    const reloadedResyncSnapshot = await page.evaluate(async () => {
      if (typeof window.__fmarchTriggerHostResync !== "function") {
        throw new Error("host resync hook is unavailable after reload");
      }
      return window.__fmarchTriggerHostResync(921);
    });
    await page.waitForFunction(
      () =>
        window.__fmarchHostProjection?.completed === true &&
        window.__fmarchHostProjection?.phase?.id === "N05",
      null,
      { timeout: 15000 },
    );
    const reloadedSnapshot = await collectCompletedHostReloadSnapshot(page);
    const bodyText = await page.locator("body").innerText();
    if (/invite=(?!REDACTED)/.test(bodyText)) {
      throw new Error("completed host reload proof leaked an invite URL token");
    }
    return {
      status: "passed",
      sourceRoleUrl: String(roleUrl),
      visitedRolePath,
      surfaceTestId: "host-console-surface",
      clickedThroughFromRoleUrl: true,
      resyncFromSeq: 921,
      initialResyncSnapshotHost: initialResyncSnapshot?.host ?? null,
      reloadedResyncSnapshotHost: reloadedResyncSnapshot?.host ?? null,
      initialSnapshot,
      reloadedSnapshot,
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    };
  } finally {
    await page.close();
  }
}

async function proveCompletedHostStaleCommandRecoveryCases({
  browser,
  frontendBaseUrl,
  roleUrl,
  cases,
}) {
  const proofEntries = [];
  for (const scenario of cases) {
    proofEntries.push([
      scenario.proofField,
      await proveCompletedHostStaleCommandRecovery({
        browser,
        frontendBaseUrl,
        roleUrl,
        scenario,
      }),
    ]);
  }
  return Object.fromEntries(proofEntries);
}

async function proveCompletedHostStaleCommandRecovery({
  browser,
  frontendBaseUrl,
  roleUrl,
  scenario,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const visitedRolePath = rolePathFromUrl(roleUrl);
  const expectedGame = gameFromRoleUrl(roleUrl);
  const commandRequests = [];
  try {
    await installCompletedHostStaleCommandRecoveryBrowserRoutes(page, {
      commandRequests,
      scenario,
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
    const setupResyncSnapshot = await page.evaluate(async () => {
      if (typeof window.__fmarchTriggerHostResync !== "function") {
        throw new Error("host resync hook is unavailable");
      }
      return window.__fmarchTriggerHostResync(921);
    });
    await page.waitForFunction(
      () =>
        window.__fmarchHostProjection?.completed === true &&
        window.__fmarchHostProjection?.phase?.id === "N05",
      null,
      { timeout: 15000 },
    );
    const commandResponse = await page.evaluate(async ({ game, scenario }) => {
      const command = {
        [scenario.commandKind]: {
          game,
        },
      };
      const response = await fetch("/commands", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          v: 1,
          id: scenario.commandId,
          body: {
            kind: "IssueCommand",
            body: {
              command,
            },
          },
        }),
      });
      return {
        ok: response.ok,
        status: response.status,
        body: await response.json(),
      };
    }, { game: expectedGame, scenario });
    const recoveryResyncSnapshot = await page.evaluate(async () => {
      if (typeof window.__fmarchTriggerHostResync !== "function") {
        throw new Error("host resync hook is unavailable after reject");
      }
      return window.__fmarchTriggerHostResync(921);
    });
    await page.waitForFunction(
      () =>
        window.__fmarchHostProjection?.completed === true &&
        window.__fmarchHostProjection?.phase?.id === "N05",
      null,
      { timeout: 15000 },
    );
    const recoverySnapshot = await collectCompletedHostReloadSnapshot(page);
    const bodyText = await page.locator("body").innerText();
    if (/invite=(?!REDACTED)/.test(bodyText)) {
      throw new Error(
        `completed host stale ${scenario.commandKind} proof leaked an invite URL token`,
      );
    }
    return {
      status: "passed",
      sourceRoleUrl: String(roleUrl),
      visitedRolePath,
      surfaceTestId: "host-console-surface",
      clickedThroughFromRoleUrl: true,
      commandEndpoint: "/commands",
      commandKind: scenario.commandKind,
      command: commandRequests.at(-1)?.[scenario.commandKind] ?? null,
      commandResponse,
      setupResyncFromSeq: 921,
      setupResyncSnapshotHost: setupResyncSnapshot?.host ?? null,
      recoveryResyncFromSeq: 921,
      recoveryResyncSnapshotHost: recoveryResyncSnapshot?.host ?? null,
      recoverySnapshot,
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    };
  } finally {
    await page.close();
  }
}

async function proveStaleCompletedGamePlayerCommandRecoveryCases({
  browser,
  frontendBaseUrl,
  roleUrl,
  cases,
}) {
  const proofEntries = [];
  for (const scenario of cases) {
    proofEntries.push([
      scenario.proofField,
      await proveStaleCompletedGamePlayerCommandRecovery({
        browser,
        frontendBaseUrl,
        roleUrl,
        scenario,
      }),
    ]);
  }
  return Object.fromEntries(proofEntries);
}

async function proveStaleCompletedGamePlayerCommandRecovery({
  browser,
  frontendBaseUrl,
  roleUrl,
  scenario,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const visitedRolePath = rolePathFromUrl(roleUrl);
  const commandRequests = [];
  try {
    await installStaleCompletedGamePlayerCommandRecoveryBrowserRoutes(page, {
      commandRequests,
      scenario,
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
    const setupSnapshot = await page.evaluate(async () => {
      if (typeof window.__fmarchTriggerPlayerResync !== "function") {
        throw new Error("player resync hook is unavailable");
      }
      return window.__fmarchTriggerPlayerResync(918);
    });
    await page.waitForFunction(
      (selector) =>
        window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "D05" &&
        document.querySelector(selector) !== null,
      scenario.setupReadySelector,
      { timeout: 15000 },
    );
    const commandButton = page.locator(scenario.commandButtonSelector);
    await commandButton.waitFor({ state: "visible", timeout: 15000 });
    if (scenario.postBody !== undefined) {
      await page.locator('[data-testid="player-composer"] textarea').fill(
        scenario.postBody,
      );
    }
    await commandButton.click();
    await page.waitForFunction(
      (commandKind) =>
        window.__fmarchPlayerCommandStatus?.state === "reject" &&
        window.__fmarchPlayerCommandStatus?.error === "GameAlreadyCompleted" &&
        window.__fmarchPlayerCommandDispatchBridgePlan?.commandKind ===
          commandKind &&
        window.__fmarchPlayerProjection?.commandState?.gameCompleted === true,
      scenario.commandKind,
      { timeout: 15000 },
    );
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="player-action-submission-checkpoint"]')
          ?.getAttribute("data-receipt-state") ===
          "reject:GameAlreadyCompleted" &&
        document
          .querySelector('[data-testid="player-action-submission-checkpoint"]')
          ?.getAttribute("data-action-state") === "disabled:game complete",
      null,
      { timeout: 15000 },
    );
    const proof = await collectPlayerStaleCommandProof({
      page,
      commandRequests,
      clickedAction: scenario.clickedAction,
      commandKind: scenario.commandKind,
      commandSelector: scenario.commandSelector,
    });
    const bodyText = await page.locator("body").innerText();
    if (/invite=(?!REDACTED)/.test(bodyText)) {
      throw new Error(
        `completed-game stale ${scenario.commandKind} proof leaked an invite URL token`,
      );
    }
    if (bodyText.includes("factional_kill")) {
      throw new Error(
        `completed-game stale ${scenario.commandKind} proof leaked target-only night receipt`,
      );
    }
    return {
      ...proof,
      sourceRoleUrl: String(roleUrl),
      visitedRolePath,
      surfaceTestId: "player-surface",
      clickedThroughFromRoleUrl: true,
      setupResyncFromSeq: 918,
      setupSnapshotCommandState: setupSnapshot?.commandState ?? null,
      stalePostBody: scenario.postBody,
      rawInviteTokensVisible: false,
      targetOnlyReceiptVisible: false,
      releaseReady: false,
      productionReady: false,
    };
  } finally {
    await page.close();
  }
}

function completedPlayerReloadCommandStateBuilders() {
  return {
    "action-player": seededCompletedActionPlayerCommandState,
    "normal-player": seededCompletedNormalPlayerCommandState,
    "dead-player": seededCompletedDeadPlayerCommandState,
  };
}

async function proveCompletedPlayerRoleReloadCases({
  browser,
  frontendBaseUrl,
  cases,
}) {
  const proofEntries = [];
  for (const scenario of cases) {
    proofEntries.push([
      scenario.proofField,
      await proveCompletedPlayerRoleReload({
        browser,
        frontendBaseUrl,
        roleUrl: scenario.roleUrl,
        cookieValue: scenario.cookieValue,
        commandState: scenario.commandState,
      }),
    ]);
  }
  return Object.fromEntries(proofEntries);
}

async function proveCompletedPlayerRoleReload({
  browser,
  frontendBaseUrl,
  roleUrl,
  cookieValue,
  commandState,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const visitedRolePath = rolePathFromUrl(roleUrl);
  try {
    await installPostDayThreePlayerBrowserRoutes(page, {
      commandState,
      notifications: [],
      threadBody: "The game is complete.",
      threadSeq: 921,
      dayVoteOutcomesRows: [
        ...dayTwoVoteOutcomeRows(),
        dayThreeVoteOutcomeRow(),
        dayFourNoLynchOutcomeRow(),
        dayFiveNoLynchOutcomeRow(),
      ],
    });
    await page.context().addCookies([
      {
        name: "fmarch_fixture_session",
        value: cookieValue,
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
    const initialResyncSnapshot = await page.evaluate(async () => {
      if (typeof window.__fmarchTriggerPlayerResync !== "function") {
        throw new Error("player resync hook is unavailable");
      }
      return window.__fmarchTriggerPlayerResync(921);
    });
    await page.waitForFunction(
      () =>
        window.__fmarchPlayerProjection?.commandState?.gameCompleted === true &&
        window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "N05",
      null,
      { timeout: 15000 },
    );
    const initialSnapshot = await collectCompletedPlayerReloadSnapshot(page);
    await page.reload({ waitUntil: "networkidle" });
    await page.getByTestId("player-surface").waitFor({
      state: "visible",
      timeout: 15000,
    });
    const reloadedResyncSnapshot = await page.evaluate(async () => {
      if (typeof window.__fmarchTriggerPlayerResync !== "function") {
        throw new Error("player resync hook is unavailable after reload");
      }
      return window.__fmarchTriggerPlayerResync(921);
    });
    await page.waitForFunction(
      () =>
        window.__fmarchPlayerProjection?.commandState?.gameCompleted === true &&
        window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "N05",
      null,
      { timeout: 15000 },
    );
    const reloadedSnapshot = await collectCompletedPlayerReloadSnapshot(page);
    const bodyText = await page.locator("body").innerText();
    if (/invite=(?!REDACTED)/.test(bodyText)) {
      throw new Error("completed player reload proof leaked an invite URL token");
    }
    if (bodyText.includes("factional_kill")) {
      throw new Error("completed player reload proof leaked target-only action controls");
    }
    return {
      status: "passed",
      sourceRoleUrl: String(roleUrl),
      visitedRolePath,
      surfaceTestId: "player-surface",
      clickedThroughFromRoleUrl: true,
      resyncFromSeq: 921,
      initialResyncSnapshotCommandState:
        initialResyncSnapshot?.commandState ?? null,
      reloadedResyncSnapshotCommandState:
        reloadedResyncSnapshot?.commandState ?? null,
      initialSnapshot,
      reloadedSnapshot,
      rawInviteTokensVisible: false,
      targetOnlyActionVisible: false,
      releaseReady: false,
      productionReady: false,
    };
  } finally {
    await page.close();
  }
}

async function proveCompletedDeadPlayerStaleVoteRecovery({
  browser,
  frontendBaseUrl,
  roleUrl,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const visitedRolePath = rolePathFromUrl(roleUrl);
  const expectedGame = gameFromRoleUrl(roleUrl);
  const commandRequests = [];
  try {
    await page.route("**/commands", async (route) => {
      const commandEnvelope = route.request().postDataJSON();
      const command = commandEnvelope?.body?.body?.command;
      commandRequests.push(command);
      if (command?.SubmitVote !== undefined) {
        await fulfillJson(
          route,
          {
            v: 1,
            id: commandEnvelope.id,
            body: {
              kind: "Reject",
              body: {
                error: "GameAlreadyCompleted",
                retryable: false,
                message: "Reject GameAlreadyCompleted: game already completed",
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
          id:
            commandEnvelope?.id ??
            "completed-dead-player-stale-vote-recovery-reject",
          body: {
            kind: "Reject",
            body: {
              error: "WrongCompletedDeadPlayerProofCommand",
              retryable: false,
              message:
                "completed dead-player stale proof only accepts SubmitVote",
            },
          },
        },
        409,
      );
    });
    await installPostDayThreePlayerBrowserRoutes(page, {
      commandState: seededCompletedDeadPlayerCommandState({
        boundary:
          "Seeded browser completed dead-player stale vote rejected into durable endgame controls.",
      }),
      notifications: [],
      threadBody: "The game is complete.",
      threadSeq: 921,
      dayVoteOutcomesRows: [
        ...dayTwoVoteOutcomeRows(),
        dayThreeVoteOutcomeRow(),
        dayFourNoLynchOutcomeRow(),
        dayFiveNoLynchOutcomeRow(),
      ],
    });
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
    const setupResyncSnapshot = await page.evaluate(async () => {
      if (typeof window.__fmarchTriggerPlayerResync !== "function") {
        throw new Error("player resync hook is unavailable");
      }
      return window.__fmarchTriggerPlayerResync(921);
    });
    await page.waitForFunction(
      () =>
        window.__fmarchPlayerProjection?.commandState?.gameCompleted === true &&
        window.__fmarchPlayerProjection?.commandState?.actorSlot === "slot-2",
      null,
      { timeout: 15000 },
    );
    const commandResponse = await page.evaluate(async (game) => {
      const response = await fetch("/commands", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          v: 1,
          id: "completed-dead-player-stale-vote",
          body: {
            kind: "IssueCommand",
            body: {
              command: {
                SubmitVote: {
                  game,
                  actor_slot: "slot-2",
                  target: "NoLynch",
                },
              },
            },
          },
        }),
      });
      return {
        ok: response.ok,
        status: response.status,
        body: await response.json(),
      };
    }, expectedGame);
    const recoveryResyncSnapshot = await page.evaluate(async () => {
      if (typeof window.__fmarchTriggerPlayerResync !== "function") {
        throw new Error("player resync hook is unavailable after reject");
      }
      return window.__fmarchTriggerPlayerResync(921);
    });
    await page.waitForFunction(
      () =>
        window.__fmarchPlayerProjection?.commandState?.gameCompleted === true &&
        window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "N05",
      null,
      { timeout: 15000 },
    );
    const recoverySnapshot = await collectCompletedPlayerReloadSnapshot(page);
    const bodyText = await page.locator("body").innerText();
    if (/invite=(?!REDACTED)/.test(bodyText)) {
      throw new Error(
        "completed dead-player stale vote proof leaked an invite URL token",
      );
    }
    if (bodyText.includes("factional_kill")) {
      throw new Error(
        "completed dead-player stale vote proof leaked target-only action controls",
      );
    }
    return {
      status: "passed",
      sourceRoleUrl: String(roleUrl),
      visitedRolePath,
      surfaceTestId: "player-surface",
      clickedThroughFromRoleUrl: true,
      commandEndpoint: "/commands",
      commandKind: "SubmitVote",
      command: commandRequests.at(-1)?.SubmitVote ?? null,
      commandResponse,
      setupResyncFromSeq: 921,
      setupResyncSnapshotCommandState:
        setupResyncSnapshot?.commandState ?? null,
      recoveryResyncFromSeq: 921,
      recoveryResyncSnapshotCommandState:
        recoveryResyncSnapshot?.commandState ?? null,
      recoverySnapshot,
      rawInviteTokensVisible: false,
      targetOnlyActionVisible: false,
      releaseReady: false,
      productionReady: false,
    };
  } finally {
    await page.close();
  }
}

async function proveNightFourPlayerActionSubmission({
  browser,
  frontendBaseUrl,
  roleUrl,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const visitedRolePath = rolePathFromUrl(roleUrl);
  const commandRequests = [];
  try {
    await installNightFourActionSubmissionBrowserRoutes(page, {
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
    const setupSnapshot = await page.evaluate(async () => {
      if (typeof window.__fmarchTriggerPlayerResync !== "function") {
        throw new Error("player resync hook is unavailable");
      }
      return window.__fmarchTriggerPlayerResync(914);
    });
    await page.waitForFunction(
      () =>
        window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "N04" &&
        document.querySelector(
          '[data-testid="player-action-commands"] button[data-action="submit_action:factional_kill"]',
        ) !== null,
      null,
      { timeout: 15000 },
    );
    const clickProof = await provePlayerActionSubmissionClick({
      page,
      commandRequests,
    });
    return {
      status: "passed",
      sourceRoleUrl: String(roleUrl),
      visitedRolePath,
      surfaceTestId: "player-surface",
      clickedThroughFromRoleUrl: true,
      setupResyncFromSeq: 914,
      setupSnapshotCommandState: setupSnapshot?.commandState ?? null,
      clickProof,
      releaseReady: false,
      productionReady: false,
    };
  } finally {
    await page.close();
  }
}

async function proveNightThreeEmptyHostTransition({
  browser,
  frontendBaseUrl,
  roleUrl,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const visitedRolePath = rolePathFromUrl(roleUrl);
  const commandRequests = [];
  try {
    await installNightThreeEmptyHostTransitionBrowserRoutes(page, {
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
    const setupSnapshot = await page.evaluate(async () => {
      if (typeof window.__fmarchTriggerHostResync !== "function") {
        throw new Error("host resync hook is unavailable");
      }
      return window.__fmarchTriggerHostResync(909);
    });
    await page.waitForFunction(
      () => {
        const checkpoint = document.querySelector(
          '[data-testid="host-lifecycle-control-checkpoint"]',
        );
        return (
          checkpoint?.getAttribute("data-phase-id") === "N03" &&
          checkpoint?.getAttribute("data-phase-state") === "open" &&
          checkpoint?.getAttribute("data-deadline-affordance") ===
            "resolve_phase,lock_thread"
        );
      },
      null,
      { timeout: 15000 },
    );
    const resolveProof = await proveHostPhaseActionClick({
      page,
      commandRequests,
      actionId: "resolve_phase",
      commandKind: "ResolvePhase",
      streamSeq: 910,
      expectedPhaseId: "N03",
      expectedPhaseState: "locked",
      expectedDeadlineAffordance: "unlock_thread,advance_phase",
    });
    const advanceProof = await proveHostPhaseActionClick({
      page,
      commandRequests,
      actionId: "advance_phase",
      commandKind: "AdvancePhase",
      streamSeq: 911,
      expectedPhaseId: "D04",
      expectedPhaseState: "open",
      expectedDeadlineAffordance: "resolve_phase,lock_thread",
    });
    const bodyText = await page.locator("body").innerText();
    if (/invite=(?!REDACTED)/.test(bodyText)) {
      throw new Error("empty Night 3 host transition proof leaked an invite URL token");
    }
    return {
      status: "passed",
      sourceRoleUrl: String(roleUrl),
      visitedRolePath,
      surfaceTestId: "host-console-surface",
      clickedThroughFromRoleUrl: true,
      setupResyncFromSeq: 909,
      setupSnapshotHost: setupSnapshot?.host ?? null,
      resolveProof,
      advanceProof,
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    };
  } finally {
    await page.close();
  }
}

async function provePostDayThreePlayerSurface({
  browser,
  frontendBaseUrl,
  roleUrl,
  cookieValue,
  expectedSlot,
  principalUserId,
  slotField,
  commandState,
  notifications,
  resyncFromSeq,
  threadBody,
  expectedVoteButtonCount = 0,
  dayVoteOutcomesRows = [...dayTwoVoteOutcomeRows(), dayThreeVoteOutcomeRow()],
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const visitedRolePath = rolePathFromUrl(roleUrl);
  try {
    await installPostDayThreePlayerBrowserRoutes(page, {
      commandState,
      notifications,
      threadBody,
      threadSeq: resyncFromSeq,
      dayVoteOutcomesRows,
    });
    await page.context().addCookies([
      {
        name: "fmarch_fixture_session",
        value: cookieValue,
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
    const resyncSnapshot = await page.evaluate(async (fromSeq) => {
      if (typeof window.__fmarchTriggerPlayerResync !== "function") {
        throw new Error("player resync hook is unavailable");
      }
      return window.__fmarchTriggerPlayerResync(fromSeq);
    }, resyncFromSeq);
    await page.waitForFunction(
      ({ slot, phaseId }) =>
        window.__fmarchPlayerProjection?.commandState?.actorSlot === slot &&
        window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === phaseId,
      {
        slot: expectedSlot,
        phaseId: commandState.phase.phaseId,
      },
      { timeout: 15000 },
    );
    const checkpoint = page.getByTestId("player-action-submission-checkpoint");
    await checkpoint.waitFor({ state: "visible", timeout: 15000 });
    const privateQueue = page.locator('[data-component="player-private-queue"]');
    await privateQueue.waitFor({ state: "visible", timeout: 15000 });
    const checkpointPhaseId = await checkpoint.getAttribute("data-phase-id");
    const checkpointPhaseState = await checkpoint.getAttribute("data-phase-state");
    const checkpointActorSlot = await checkpoint.getAttribute("data-actor-slot");
    const checkpointActionState = await checkpoint.getAttribute("data-action-state");
    const checkpointReceiptState = await checkpoint.getAttribute("data-receipt-state");
    const actionStatusText = await page
      .getByTestId("player-action-submission-status")
      .innerText();
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
    const voteButtonCount = await page.locator(
      '[data-testid="player-composer"] button[data-action^="submit_vote"]',
    ).count();
    if (voteButtonCount !== expectedVoteButtonCount) {
      throw new Error(
        `post-Day 3 player proof expected ${expectedVoteButtonCount} vote buttons, got ${voteButtonCount}`,
      );
    }
    const projection = await page.evaluate(() => window.__fmarchPlayerProjection);
    const coldLoadEndpoints = await page.evaluate(
      () => window.__fmarchPlayerColdLoadEndpoints,
    );
    const proof = {
      status: "passed",
      sourceRoleUrl: String(roleUrl),
      visitedRolePath,
      surfaceTestId: "player-surface",
      clickedThroughFromRoleUrl: true,
      [slotField]: expectedSlot,
      principalUserId,
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
      voteButtonCount,
      projectionCommandState: projection?.commandState ?? null,
      projectionNotifications: projection?.notifications ?? null,
      projectionDayVoteOutcomes: projection?.dayVoteOutcomes ?? null,
      resyncFromSeq,
      resyncSnapshotCommandState: resyncSnapshot?.commandState ?? null,
      resyncSnapshotNotifications: resyncSnapshot?.notifications ?? null,
      coldLoadEndpoints,
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    };
    if (privateCount > 0) {
      const privateNotice = page.getByTestId("player-private-notification-1");
      await privateNotice.waitFor({ state: "visible", timeout: 15000 });
      const privateNoticeDetail = page.getByTestId(
        "player-private-detail-notification-1",
      );
      await privateNoticeDetail.waitFor({ state: "visible", timeout: 15000 });
      proof.privateNotice = {
        id: "notification-1",
        kind: await privateNotice.getAttribute("data-kind"),
        text: await privateNotice.innerText(),
        detailText: await privateNoticeDetail.innerText(),
      };
    } else {
      const privateEmpty = page.getByTestId("player-private-empty");
      await privateEmpty.waitFor({ state: "visible", timeout: 15000 });
      proof.privateEmptyText = await privateEmpty.innerText();
    }
    const bodyText = await page.locator("body").innerText();
    if (/invite=(?!REDACTED)/.test(bodyText)) {
      throw new Error("post-Day 3 player proof leaked an invite URL token");
    }
    if (notifications.length === 0 && bodyText.includes("day_vote")) {
      throw new Error("post-Day 3 privacy proof rendered target-only receipt");
    }
    return proof;
  } finally {
    await page.close();
  }
}

async function provePostNightFourHostAdvance({
  browser,
  frontendBaseUrl,
  roleUrl,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const visitedRolePath = rolePathFromUrl(roleUrl);
  const commandRequests = [];
  try {
    await installPostNightFourHostAdvanceBrowserRoutes(page, { commandRequests });
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
      return window.__fmarchTriggerHostResync(916);
    });
    await page.waitForFunction(
      () => {
        const checkpoint = document.querySelector(
          '[data-testid="host-lifecycle-control-checkpoint"]',
        );
        return (
          checkpoint?.getAttribute("data-phase-id") === "N04" &&
          checkpoint?.getAttribute("data-phase-state") === "locked" &&
          checkpoint?.getAttribute("data-deadline-affordance") ===
            "unlock_thread,advance_phase"
        );
      },
      null,
      { timeout: 15000 },
    );
    const advanceProof = await proveHostPhaseActionClick({
      page,
      commandRequests,
      actionId: "advance_phase",
      commandKind: "AdvancePhase",
      streamSeq: 917,
      expectedPhaseId: "D05",
      expectedPhaseState: "open",
      expectedDeadlineAffordance: "resolve_phase,lock_thread",
    });
    const bodyText = await page.locator("body").innerText();
    if (/invite=(?!REDACTED)/.test(bodyText)) {
      throw new Error("post-Night 4 host advance proof leaked an invite URL token");
    }
    return {
      status: "passed",
      sourceRoleUrl: String(roleUrl),
      visitedRolePath,
      surfaceTestId: "host-console-surface",
      clickedThroughFromRoleUrl: true,
      setupResyncFromSeq: 916,
      setupSnapshotHost: setupSnapshot?.host ?? null,
      advanceProof,
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    };
  } finally {
    await page.close();
  }
}

async function proveStaleNightFourActionRecovery({
  browser,
  frontendBaseUrl,
  roleUrl,
}) {
  const scenario = staleNightFourActionRecoveryScenario();
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const visitedRolePath = rolePathFromUrl(roleUrl);
  const commandRequests = [];
  try {
    await installStaleNightFourActionRecoveryBrowserRoutes(page, {
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
    const setupSnapshot = await page.evaluate(async (fromSeq) => {
      if (typeof window.__fmarchTriggerPlayerResync !== "function") {
        throw new Error("player resync hook is unavailable");
      }
      return window.__fmarchTriggerPlayerResync(fromSeq);
    }, scenario.setupResyncFromSeq);
    await page.waitForFunction(
      (proofScenario) =>
        window.__fmarchPlayerProjection?.commandState?.phase?.phaseId ===
          proofScenario.setupPhaseId &&
        document.querySelector(proofScenario.commandButtonSelector) !== null,
      scenario,
      { timeout: 15000 },
    );
    const actionButton = page.locator(scenario.commandButtonSelector);
    await actionButton.waitFor({ state: "visible", timeout: 15000 });
    await actionButton.click();
    await page.waitForFunction(
      (proofScenario) =>
        window.__fmarchPlayerCommandStatus?.state === proofScenario.finalState &&
        window.__fmarchPlayerCommandStatus?.error === proofScenario.error &&
        window.__fmarchPlayerCommandDispatchBridgePlan?.commandKind ===
          proofScenario.commandKind &&
        window.__fmarchPlayerProjection?.commandState?.phase?.phaseId ===
          proofScenario.refreshedPhaseId,
      scenario,
      { timeout: 15000 },
    );
    await page.waitForFunction(
      (proofScenario) =>
        document
          .querySelector('[data-testid="player-action-submission-checkpoint"]')
          ?.getAttribute("data-receipt-state") ===
          proofScenario.checkpointReceiptState &&
        document
          .querySelector('[data-testid="player-action-submission-checkpoint"]')
          ?.getAttribute("data-phase-id") === proofScenario.refreshedPhaseId &&
        document
          .querySelector('[data-testid="player-action-submission-checkpoint"]')
          ?.getAttribute("data-action-state") ===
          proofScenario.checkpointActionState,
      scenario,
      { timeout: 15000 },
    );
    const proof = await collectPlayerStaleCommandProof({
      page,
      commandRequests,
      clickedAction: scenario.clickedAction,
      commandKind: scenario.commandKind,
      commandSelector: scenario.commandSelector,
    });
    const bodyText = await page.locator("body").innerText();
    if (/invite=(?!REDACTED)/.test(bodyText)) {
      throw new Error("post-Night 4 stale action proof leaked an invite URL token");
    }
    if (bodyText.includes("player_killed") || bodyText.includes("factional_kill")) {
      throw new Error("post-Night 4 stale action proof leaked target receipt");
    }
    return {
      ...proof,
      sourceRoleUrl: String(roleUrl),
      visitedRolePath,
      surfaceTestId: "player-surface",
      clickedThroughFromRoleUrl: true,
      setupResyncFromSeq: scenario.setupResyncFromSeq,
      setupSnapshotCommandState: setupSnapshot?.commandState ?? null,
      rawInviteTokensVisible: false,
      targetOnlyReceiptVisible: false,
      releaseReady: false,
      productionReady: false,
    };
  } finally {
    await page.close();
  }
}

async function provePostDayThreeHostAdvance({
  browser,
  frontendBaseUrl,
  roleUrl,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const visitedRolePath = rolePathFromUrl(roleUrl);
  const commandRequests = [];
  try {
    await installPostDayThreeHostAdvanceBrowserRoutes(page, { commandRequests });
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
      return window.__fmarchTriggerHostResync(908);
    });
    await page.waitForFunction(
      () => {
        const checkpoint = document.querySelector(
          '[data-testid="host-lifecycle-control-checkpoint"]',
        );
        return (
          checkpoint?.getAttribute("data-phase-id") === "D03" &&
          checkpoint?.getAttribute("data-phase-state") === "locked" &&
          checkpoint?.getAttribute("data-deadline-affordance") ===
            "unlock_thread,advance_phase"
        );
      },
      null,
      { timeout: 15000 },
    );
    const advanceProof = await proveHostPhaseActionClick({
      page,
      commandRequests,
      actionId: "advance_phase",
      commandKind: "AdvancePhase",
      streamSeq: 909,
      expectedPhaseId: "N03",
      expectedPhaseState: "open",
      expectedDeadlineAffordance: "resolve_phase,lock_thread",
    });
    const bodyText = await page.locator("body").innerText();
    if (/invite=(?!REDACTED)/.test(bodyText)) {
      throw new Error("post-Day 3 host advance proof leaked an invite URL token");
    }
    return {
      status: "passed",
      sourceRoleUrl: String(roleUrl),
      visitedRolePath,
      surfaceTestId: "host-console-surface",
      clickedThroughFromRoleUrl: true,
      setupResyncFromSeq: 908,
      setupSnapshotHost: setupSnapshot?.host ?? null,
      advanceProof,
      rawInviteTokensVisible: false,
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
  const votecountProjection = await page.evaluate(
    () => window.__fmarchHostVotecountProjection,
  );
  const dayVoteOutcomesProjection = await page.evaluate(
    () => window.__fmarchHostDayVoteOutcomesProjection,
  );
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
    votecountProjection,
    dayVoteOutcomesProjection,
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

async function installHostNightActionTransitionBrowserRoutes(
  page,
  { commandRequests },
) {
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
            stream_seqs: [905],
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
            stream_seqs: [906],
          },
        },
      });
      return;
    }

    await fulfillJson(
      route,
      {
        v: 1,
        id: commandEnvelope?.id ?? "host-night-action-transition-reject",
        body: {
          kind: "Reject",
          body: {
            error: "WrongHostNightActionTransitionProofCommand",
            retryable: false,
            message:
              "host night action transition proof only accepts phase controls",
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
        phaseId: hostPhaseState === "advanced" ? "D03" : "N02",
        locked: hostPhaseState === "resolved",
        seq: hostPhaseState === "advanced" ? 906 : 905,
        boundary:
          hostPhaseState === "advanced"
            ? "Seeded browser AdvancePhase ACK advanced the host projection to Day 3."
            : "Seeded browser ResolvePhase ACK locked Night 2 for host advancement.",
      }),
    );
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

async function collectCompletedHostReloadSnapshot(page) {
  return page.evaluate(() => {
    const checkpoint = document.querySelector(
      '[data-testid="host-lifecycle-control-checkpoint"]',
    );
    const actionTiles = Array.from(document.querySelectorAll("[data-action-id]")).map(
      (tile) => ({
        actionId: tile.getAttribute("data-action-id"),
        text: tile.textContent?.trim() ?? "",
      }),
    );
    const triggerButtons = Array.from(
      document.querySelectorAll('[data-testid="critical-host-action-trigger"]'),
    ).map((button) => ({
      disabled: button.disabled,
      text: button.textContent?.trim() ?? "",
    }));
    return {
      checkpoint: {
        phaseId: checkpoint?.getAttribute("data-phase-id") ?? null,
        phaseState: checkpoint?.getAttribute("data-phase-state") ?? null,
        slotId: checkpoint?.getAttribute("data-slot-id") ?? null,
        actionState: checkpoint?.getAttribute("data-action-state") ?? null,
        deadlineAffordance:
          checkpoint?.getAttribute("data-deadline-affordance") ?? null,
      },
      projection: window.__fmarchHostProjection ?? null,
      votecount: window.__fmarchHostVotecountProjection ?? null,
      dayVoteOutcomes: window.__fmarchHostDayVoteOutcomesProjection ?? null,
      hostPrompts: window.__fmarchHostPromptsProjection ?? null,
      actionTiles,
      triggerButtons,
    };
  });
}

async function collectCompletedPlayerReloadSnapshot(page) {
  return page.evaluate(() => {
    const checkpoint = document.querySelector(
      '[data-testid="player-action-submission-checkpoint"]',
    );
    const buttons = Array.from(document.querySelectorAll("button[data-action]")).map(
      (button) => ({
        action: button.getAttribute("data-action"),
        disabled: button.disabled,
        text: button.textContent?.trim() ?? "",
      }),
    );
    const mutatingButtons = buttons.filter(
      (button) =>
        button.action === "submit_post" ||
        String(button.action ?? "").startsWith("submit_vote") ||
        String(button.action ?? "").startsWith("submit_action"),
    );
    return {
      checkpoint: {
        phaseId: checkpoint?.getAttribute("data-phase-id") ?? null,
        phaseState: checkpoint?.getAttribute("data-phase-state") ?? null,
        actorSlot: checkpoint?.getAttribute("data-actor-slot") ?? null,
        actionState: checkpoint?.getAttribute("data-action-state") ?? null,
        receiptState: checkpoint?.getAttribute("data-receipt-state") ?? null,
        targetSlots: checkpoint?.getAttribute("data-target-slots") ?? null,
      },
      commandState: window.__fmarchPlayerProjection?.commandState ?? null,
      notifications: window.__fmarchPlayerProjection?.notifications ?? null,
      dayVoteOutcomes: window.__fmarchPlayerProjection?.dayVoteOutcomes ?? null,
      coldLoadEndpoints: window.__fmarchPlayerColdLoadEndpoints ?? null,
      buttons,
      enabledMutatingButtons: mutatingButtons.filter((button) => !button.disabled),
      disabledMutatingButtons: mutatingButtons.filter((button) => button.disabled),
    };
  });
}

async function collectCompletedPrivateChannelSnapshot(page) {
  return page.evaluate(() => {
    const checkpoint = document.querySelector(
      '[data-testid="player-action-submission-checkpoint"]',
    );
    const commandPanel = document.querySelector(
      '[data-testid="player-primary-action-zone"]',
    );
    const channelContext = document.querySelector(
      '[data-testid="player-command-channel-context"]',
    );
    const buttons = Array.from(document.querySelectorAll("button[data-action]")).map(
      (button) => ({
        action: button.getAttribute("data-action"),
        disabled: button.disabled,
        reason: button.getAttribute("data-disabled-reason"),
        text: button.textContent?.trim() ?? "",
      }),
    );
    const threadPostBodies = (
      window.__fmarchPlayerProjection?.thread?.posts ?? []
    ).map((post) => String(post?.body ?? ""));
    return {
      checkpoint: {
        phaseId: checkpoint?.getAttribute("data-phase-id") ?? null,
        phaseState: checkpoint?.getAttribute("data-phase-state") ?? null,
        actorSlot: checkpoint?.getAttribute("data-actor-slot") ?? null,
        actionState: checkpoint?.getAttribute("data-action-state") ?? null,
        receiptState: checkpoint?.getAttribute("data-receipt-state") ?? null,
      },
      commandPanelChannelId:
        commandPanel?.getAttribute("data-channel-id") ?? null,
      channelContext: {
        channelId: channelContext?.getAttribute("data-channel-id") ?? null,
        actorSlot: channelContext?.getAttribute("data-actor-slot") ?? null,
        capabilityLabel:
          channelContext?.getAttribute("data-capability-label") ?? null,
        actorStatus: channelContext?.getAttribute("data-actor-status") ?? null,
      },
      commandState: window.__fmarchPlayerProjection?.commandState ?? null,
      threadPostBodies,
      buttons,
      enabledMutatingButtons: buttons.filter(
        (button) =>
          !button.disabled &&
          (button.action === "submit_post" ||
            String(button.action ?? "").startsWith("submit_vote") ||
            String(button.action ?? "").startsWith("submit_action")),
      ),
    };
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
  const scenario = playerActionSubmissionScenario();
  await page.route("**/commands", async (route) => {
    const commandEnvelope = route.request().postDataJSON();
    const command = commandEnvelope?.body?.body?.command;
    commandRequests.push(command);
    if (command?.[scenario.commandSelector] !== undefined) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          v: 1,
          id: commandEnvelope.id,
          body: {
            kind: "Ack",
            body: {
              stream_seqs: [scenario.streamSeq],
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
  const scenario = playerInvalidActionRecoveryScenario();
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
    const invalidButton = page.locator(scenario.commandButtonSelector);
    await invalidButton.waitFor({ state: "visible", timeout: 15000 });
    await invalidButton.click();
    await page.waitForFunction(
      (proofScenario) =>
        window.__fmarchPlayerCommandStatus?.state === proofScenario.finalState &&
        window.__fmarchPlayerCommandStatus?.error === proofScenario.error &&
        window.__fmarchPlayerCommandDispatchBridgePlan?.commandKind ===
          proofScenario.commandKind,
      scenario,
      { timeout: 15000 },
    );
    await page.waitForFunction(
      (proofScenario) =>
        document
          .querySelector('[data-testid="player-action-submission-checkpoint"]')
          ?.getAttribute("data-receipt-state") ===
        proofScenario.checkpointReceiptState,
      scenario,
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
    const command = commandRequests.at(-1)?.[scenario.commandSelector] ?? null;
    return {
      status: "passed",
      clickedAction: scenario.clickedAction,
      commandKind: command === null ? null : scenario.commandKind,
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
  const scenario = playerInvalidActionRecoveryScenario();
  await page.route("**/commands", async (route) => {
    const commandEnvelope = route.request().postDataJSON();
    const command = commandEnvelope?.body?.body?.command;
    commandRequests.push(command);
    if (
      command?.[scenario.commandSelector]?.action_id === scenario.actionId
    ) {
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

async function proveNightActionResolutionReceiptSurface({
  browser,
  frontendBaseUrl,
  roleUrl,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const visitedRolePath = rolePathFromUrl(roleUrl);
  try {
    await installNightActionResolutionReceiptBrowserRoutes(page);
    await page.context().addCookies([
      {
        name: "fmarch_fixture_session",
        value: "fixture-night-target",
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
      return window.__fmarchTriggerPlayerResync(904);
    });
    await page.waitForFunction(
      () =>
        window.__fmarchPlayerProjection?.commandState?.actorSlot === "slot-3" &&
        window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "N02" &&
        window.__fmarchPlayerProjection?.notifications?.[0]?.status ===
          "factional_kill",
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
      throw new Error("night action resolution receipt proof leaked an invite URL token");
    }
    return {
      status: "passed",
      sourceRoleUrl: String(roleUrl),
      visitedRolePath,
      surfaceTestId: "player-surface",
      clickedThroughFromRoleUrl: true,
      targetSlot: "slot-3",
      principalUserId: "player-seed",
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
      resyncFromSeq: 904,
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

async function installNightActionResolutionReceiptBrowserRoutes(page) {
  await installNightActionResolutionCommonRoutes(page, {
    notifications: [
      {
        effect: "player_killed",
        phase_id: "N02",
        status: "factional_kill",
      },
    ],
    commandState: seededNightActionResolutionTargetCommandState({
      boundary:
        "Seeded browser night target role received factional_kill private receipt after N02 resolution.",
    }),
  });
}

async function proveNormalNightActionResolutionPrivacySurface({
  browser,
  frontendBaseUrl,
  roleUrl,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const visitedRolePath = rolePathFromUrl(roleUrl);
  try {
    await installNormalNightActionResolutionPrivacyBrowserRoutes(page);
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
      return window.__fmarchTriggerPlayerResync(904);
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
      throw new Error("normal night action privacy proof leaked an invite URL token");
    }
    if (bodyText.includes("player_killed") || bodyText.includes("factional_kill")) {
      throw new Error("normal night action privacy proof rendered target-only receipt");
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
      resyncFromSeq: 904,
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

async function installNormalNightActionResolutionPrivacyBrowserRoutes(page) {
  await installNightActionResolutionCommonRoutes(page, {
    notifications: [],
    commandState: seededNightActionResolutionNormalCommandState({
      boundary:
        "Seeded browser normal role received no target-only private receipt after N02 resolution.",
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

async function installNightActionResolutionCommonRoutes(
  page,
  { notifications, commandState },
) {
  await page.route("**/games/*/thread?**", async (route) => {
    await fulfillJson(route, {
      next_before_seq: null,
      posts: [
        {
          source_seq: 904,
          stream_seq: 904,
          author_slot: "host",
          author_user: "host_h",
          body: "Night 2 has resolved.",
          occurred_at: 1782100800,
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

async function installDayThreePlayerObservationRoutes(
  page,
  { notifications, commandState },
) {
  await page.route("**/games/*/thread?**", async (route) => {
    await fulfillJson(route, {
      next_before_seq: null,
      posts: [
        {
          source_seq: 906,
          stream_seq: 906,
          author_slot: "host",
          author_user: "host_h",
          body: "Day 3 has opened.",
          occurred_at: 1782187200,
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

async function installDayThreeVoteSubmissionBrowserRoutes(
  page,
  { commandRequests },
) {
  let voteSubmitted = false;
  await page.route("**/commands", async (route) => {
    const commandEnvelope = route.request().postDataJSON();
    const command = commandEnvelope?.body?.body?.command;
    commandRequests.push(command);
    if (command?.SubmitVote !== undefined) {
      voteSubmitted = true;
      await fulfillJson(route, {
        v: 1,
        id: commandEnvelope.id,
        body: {
          kind: "Ack",
          body: {
            stream_seqs: [907],
          },
        },
      });
      return;
    }

    await fulfillJson(
      route,
      {
        v: 1,
        id: commandEnvelope?.id ?? "day-three-vote-submission-reject",
        body: {
          kind: "Reject",
          body: {
            error: "WrongDayThreeVoteProofCommand",
            retryable: false,
            message: "Day 3 vote proof only accepts SubmitVote",
          },
        },
      },
      409,
    );
  });
  await page.route("**/games/*/thread?**", async (route) => {
    await fulfillJson(route, {
      next_before_seq: null,
      posts: [
        {
          source_seq: 906,
          stream_seq: 906,
          author_slot: "host",
          author_user: "host_h",
          body: "Day 3 has opened.",
          occurred_at: 1782187200,
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
    await fulfillJson(route, voteSubmitted ? dayThreeVotecountRows() : []);
  });
  await page.route("**/games/*/day-vote-outcomes?**", async (route) => {
    await fulfillJson(route, dayTwoVoteOutcomeRows());
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
      seededDayThreeActionPlayerCommandState({
        boundary: voteSubmitted
          ? "Seeded browser Day 3 vote ACK refreshed current vote and votecount projection."
          : "Seeded browser Day 3 vote proof opened with live vote controls.",
        currentVote: voteSubmitted
          ? { kind: "slot", slotId: "slot-4", label: "Slot 4" }
          : null,
      }),
    );
  });
}

async function installDayFourNoLynchVoteSubmissionBrowserRoutes(
  page,
  { commandRequests },
) {
  let voteSubmitted = false;
  await page.route("**/commands", async (route) => {
    const commandEnvelope = route.request().postDataJSON();
    const command = commandEnvelope?.body?.body?.command;
    commandRequests.push(command);
    if (command?.SubmitVote !== undefined) {
      voteSubmitted = true;
      await fulfillJson(route, {
        v: 1,
        id: commandEnvelope.id,
        body: {
          kind: "Ack",
          body: {
            stream_seqs: [912],
          },
        },
      });
      return;
    }

    await fulfillJson(
      route,
      {
        v: 1,
        id: commandEnvelope?.id ?? "day-four-no-lynch-vote-reject",
        body: {
          kind: "Reject",
          body: {
            error: "WrongDayFourNoLynchVoteProofCommand",
            retryable: false,
            message: "Day 4 no-lynch vote proof only accepts SubmitVote",
          },
        },
      },
      409,
    );
  });
  await page.route("**/games/*/thread?**", async (route) => {
    await fulfillJson(route, {
      next_before_seq: null,
      posts: [
        {
          source_seq: 911,
          stream_seq: 911,
          author_slot: "host",
          author_user: "host_h",
          body: "Day 4 has opened.",
          occurred_at: 1782360000,
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
    await fulfillJson(route, voteSubmitted ? dayFourNoLynchVotecountRows() : []);
  });
  await page.route("**/games/*/day-vote-outcomes?**", async (route) => {
    await fulfillJson(route, [
      ...dayTwoVoteOutcomeRows(),
      dayThreeVoteOutcomeRow(),
    ]);
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
      seededDayFourActionPlayerCommandState({
        boundary: voteSubmitted
          ? "Seeded browser Day 4 no-lynch vote ACK refreshed current vote and votecount projection."
          : "Seeded browser Day 4 no-lynch vote proof opened with live vote controls.",
        currentVote: voteSubmitted
          ? { kind: "no_lynch", slotId: null, label: "No lynch" }
          : null,
      }),
    );
  });
}

async function installDayThreeHostVoteResolutionBrowserRoutes(
  page,
  { commandRequests },
) {
  let resolved = false;
  await page.route("**/commands", async (route) => {
    const commandEnvelope = route.request().postDataJSON();
    const command = commandEnvelope?.body?.body?.command;
    commandRequests.push(command);
    if (command?.ResolvePhase !== undefined) {
      resolved = true;
      await fulfillJson(route, {
        v: 1,
        id: commandEnvelope.id,
        body: {
          kind: "Ack",
          body: {
            stream_seqs: [908],
          },
        },
      });
      return;
    }

    await fulfillJson(
      route,
      {
        v: 1,
        id: commandEnvelope?.id ?? "day-three-host-resolution-reject",
        body: {
          kind: "Reject",
          body: {
            error: "WrongDayThreeHostResolutionProofCommand",
            retryable: false,
            message: "Day 3 host resolution proof only accepts ResolvePhase",
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
        phaseId: "D03",
        locked: resolved,
        seq: resolved ? 908 : 907,
        boundary: resolved
          ? "Seeded browser ResolvePhase ACK locked Day 3 after the projected slot-4 vote."
          : "Seeded browser host opened Day 3 with a projected slot-4 vote.",
      }),
    );
  });
  await page.route("**/games/*/votecount?**", async (route) => {
    await fulfillJson(route, dayThreeVotecountRows());
  });
  await page.route("**/games/*/day-vote-outcomes?**", async (route) => {
    await fulfillJson(
      route,
      resolved
        ? [...dayTwoVoteOutcomeRows(), dayThreeVoteOutcomeRow()]
        : dayTwoVoteOutcomeRows(),
    );
  });
  await page.route("**/games/*/host-prompts?**", async (route) => {
    await fulfillJson(route, []);
  });
}

async function installDayFourNoLynchHostTransitionBrowserRoutes(
  page,
  { commandRequests },
) {
  let phaseState = "open-d04";
  await page.route("**/commands", async (route) => {
    const commandEnvelope = route.request().postDataJSON();
    const command = commandEnvelope?.body?.body?.command;
    commandRequests.push(command);
    if (command?.ResolvePhase !== undefined) {
      phaseState = "locked-d04";
      await fulfillJson(route, {
        v: 1,
        id: commandEnvelope.id,
        body: {
          kind: "Ack",
          body: {
            stream_seqs: [913],
          },
        },
      });
      return;
    }
    if (command?.AdvancePhase !== undefined) {
      phaseState = "open-n04";
      await fulfillJson(route, {
        v: 1,
        id: commandEnvelope.id,
        body: {
          kind: "Ack",
          body: {
            stream_seqs: [914],
          },
        },
      });
      return;
    }

    await fulfillJson(
      route,
      {
        v: 1,
        id: commandEnvelope?.id ?? "day-four-no-lynch-host-transition-reject",
        body: {
          kind: "Reject",
          body: {
            error: "WrongDayFourNoLynchHostTransitionProofCommand",
            retryable: false,
            message:
              "Day 4 no-lynch host transition proof only accepts ResolvePhase or AdvancePhase",
          },
        },
      },
      409,
    );
  });
  await page.route("**/games/*/host-console-state?**", async (route) => {
    const hostState =
      phaseState === "open-n04"
        ? {
            phaseId: "N04",
            locked: false,
            seq: 914,
            boundary:
              "Seeded browser AdvancePhase ACK advanced the host projection from Day 4 no-lynch to Night 4.",
          }
        : {
            phaseId: "D04",
            locked: phaseState === "locked-d04",
            seq: phaseState === "locked-d04" ? 913 : 912,
            boundary:
              phaseState === "locked-d04"
                ? "Seeded browser ResolvePhase ACK locked Day 4 after the projected no-lynch vote."
                : "Seeded browser host opened Day 4 with a projected no-lynch vote.",
          };
    await fulfillJson(route, hostPhaseTransitionConsoleState(hostState));
  });
  await page.route("**/games/*/votecount?**", async (route) => {
    await fulfillJson(route, dayFourNoLynchVotecountRows());
  });
  await page.route("**/games/*/day-vote-outcomes?**", async (route) => {
    await fulfillJson(
      route,
      phaseState === "open-n04" || phaseState === "locked-d04"
        ? [
            ...dayTwoVoteOutcomeRows(),
            dayThreeVoteOutcomeRow(),
            dayFourNoLynchOutcomeRow(),
          ]
        : [...dayTwoVoteOutcomeRows(), dayThreeVoteOutcomeRow()],
    );
  });
  await page.route("**/games/*/host-prompts?**", async (route) => {
    await fulfillJson(route, []);
  });
}

async function installDayFiveNoLynchVoteSubmissionBrowserRoutes(
  page,
  { commandRequests },
) {
  let voteSubmitted = false;
  await page.route("**/commands", async (route) => {
    const commandEnvelope = route.request().postDataJSON();
    const command = commandEnvelope?.body?.body?.command;
    commandRequests.push(command);
    if (command?.SubmitVote !== undefined) {
      voteSubmitted = true;
      await fulfillJson(route, {
        v: 1,
        id: commandEnvelope.id,
        body: {
          kind: "Ack",
          body: {
            stream_seqs: [918],
          },
        },
      });
      return;
    }

    await fulfillJson(
      route,
      {
        v: 1,
        id: commandEnvelope?.id ?? "day-five-no-lynch-vote-reject",
        body: {
          kind: "Reject",
          body: {
            error: "WrongDayFiveNoLynchVoteProofCommand",
            retryable: false,
            message: "Day 5 no-lynch vote proof only accepts SubmitVote",
          },
        },
      },
      409,
    );
  });
  await page.route("**/games/*/thread?**", async (route) => {
    await fulfillJson(route, {
      next_before_seq: null,
      posts: [
        {
          source_seq: 917,
          stream_seq: 917,
          author_slot: "host",
          author_user: "host_h",
          body: "Day 5 has opened.",
          occurred_at: 1782532800,
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
    await fulfillJson(route, voteSubmitted ? dayFiveNoLynchVotecountRows() : []);
  });
  await page.route("**/games/*/day-vote-outcomes?**", async (route) => {
    await fulfillJson(route, [
      ...dayTwoVoteOutcomeRows(),
      dayThreeVoteOutcomeRow(),
      dayFourNoLynchOutcomeRow(),
    ]);
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
      seededDayFiveActionPlayerCommandState({
        boundary: voteSubmitted
          ? "Seeded browser Day 5 no-lynch vote ACK refreshed current vote and votecount projection."
          : "Seeded browser Day 5 no-lynch vote proof opened with live vote controls.",
        currentVote: voteSubmitted
          ? { kind: "no_lynch", slotId: null, label: "No lynch" }
          : null,
      }),
    );
  });
}

async function installDayFiveNoLynchHostTransitionBrowserRoutes(
  page,
  { commandRequests },
) {
  let phaseState = "open-d05";
  await page.route("**/commands", async (route) => {
    const commandEnvelope = route.request().postDataJSON();
    const command = commandEnvelope?.body?.body?.command;
    commandRequests.push(command);
    if (command?.ResolvePhase !== undefined) {
      phaseState = "locked-d05";
      await fulfillJson(route, {
        v: 1,
        id: commandEnvelope.id,
        body: {
          kind: "Ack",
          body: {
            stream_seqs: [919],
          },
        },
      });
      return;
    }
    if (command?.AdvancePhase !== undefined) {
      phaseState = "open-n05";
      await fulfillJson(route, {
        v: 1,
        id: commandEnvelope.id,
        body: {
          kind: "Ack",
          body: {
            stream_seqs: [920],
          },
        },
      });
      return;
    }

    await fulfillJson(
      route,
      {
        v: 1,
        id: commandEnvelope?.id ?? "day-five-no-lynch-host-transition-reject",
        body: {
          kind: "Reject",
          body: {
            error: "WrongDayFiveNoLynchHostTransitionProofCommand",
            retryable: false,
            message:
              "Day 5 no-lynch host transition proof only accepts ResolvePhase or AdvancePhase",
          },
        },
      },
      409,
    );
  });
  await page.route("**/games/*/host-console-state?**", async (route) => {
    const hostState =
      phaseState === "open-n05"
        ? {
            phaseId: "N05",
            locked: false,
            seq: 920,
            boundary:
              "Seeded browser AdvancePhase ACK advanced the host projection from Day 5 no-lynch to Night 5.",
          }
        : {
            phaseId: "D05",
            locked: phaseState === "locked-d05",
            seq: phaseState === "locked-d05" ? 919 : 918,
            boundary:
              phaseState === "locked-d05"
                ? "Seeded browser ResolvePhase ACK locked Day 5 after the projected no-lynch vote."
                : "Seeded browser host opened Day 5 with a projected no-lynch vote.",
          };
    await fulfillJson(route, hostPhaseTransitionConsoleState(hostState));
  });
  await page.route("**/games/*/votecount?**", async (route) => {
    await fulfillJson(route, dayFiveNoLynchVotecountRows());
  });
  await page.route("**/games/*/day-vote-outcomes?**", async (route) => {
    await fulfillJson(
      route,
      phaseState === "open-n05" || phaseState === "locked-d05"
        ? [
            ...dayTwoVoteOutcomeRows(),
            dayThreeVoteOutcomeRow(),
            dayFourNoLynchOutcomeRow(),
            dayFiveNoLynchOutcomeRow(),
          ]
        : [
            ...dayTwoVoteOutcomeRows(),
            dayThreeVoteOutcomeRow(),
            dayFourNoLynchOutcomeRow(),
          ],
    );
  });
  await page.route("**/games/*/host-prompts?**", async (route) => {
    await fulfillJson(route, []);
  });
}

async function installNightFourActionSubmissionBrowserRoutes(
  page,
  { commandRequests },
) {
  let actionSubmitted = false;
  await page.route("**/commands", async (route) => {
    const commandEnvelope = route.request().postDataJSON();
    const command = commandEnvelope?.body?.body?.command;
    commandRequests.push(command);
    if (command?.SubmitAction?.action_id === "factional_kill") {
      actionSubmitted = true;
      await fulfillJson(route, {
        v: 1,
        id: commandEnvelope.id,
        body: {
          kind: "Ack",
          body: {
            stream_seqs: [915],
          },
        },
      });
      return;
    }

    await fulfillJson(
      route,
      {
        v: 1,
        id: commandEnvelope?.id ?? "night-four-action-submission-reject",
        body: {
          kind: "Reject",
          body: {
            error: "WrongNightFourActionSubmissionProofCommand",
            retryable: false,
            message:
              "Night 4 action submission proof only accepts factional_kill SubmitAction",
          },
        },
      },
      409,
    );
  });
  await page.route("**/games/*/thread?**", async (route) => {
    await fulfillJson(route, {
      next_before_seq: null,
      posts: [
        {
          source_seq: 914,
          stream_seq: 914,
          author_slot: "host",
          author_user: "host_h",
          body: "Night 4 has opened.",
          occurred_at: 1782446400,
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
      ...dayTwoVoteOutcomeRows(),
      dayThreeVoteOutcomeRow(),
      dayFourNoLynchOutcomeRow(),
    ]);
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
      seededNightFourActionPlayerCommandState({
        boundary: actionSubmitted
          ? "Seeded browser Night 4 action ACK refreshed action state after targeting slot-5."
          : "Seeded browser Night 4 action proof opened with slot-5 target controls.",
        actionSubmitted,
      }),
    );
  });
}

async function installNightFourHostResolutionBrowserRoutes(
  page,
  { commandRequests },
) {
  let resolved = false;
  await page.route("**/commands", async (route) => {
    const commandEnvelope = route.request().postDataJSON();
    const command = commandEnvelope?.body?.body?.command;
    commandRequests.push(command);
    if (command?.ResolvePhase !== undefined) {
      resolved = true;
      await fulfillJson(route, {
        v: 1,
        id: commandEnvelope.id,
        body: {
          kind: "Ack",
          body: {
            stream_seqs: [916],
          },
        },
      });
      return;
    }

    await fulfillJson(
      route,
      {
        v: 1,
        id: commandEnvelope?.id ?? "night-four-host-resolution-reject",
        body: {
          kind: "Reject",
          body: {
            error: "WrongNightFourHostResolutionProofCommand",
            retryable: false,
            message: "Night 4 host resolution proof only accepts ResolvePhase",
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
        phaseId: "N04",
        locked: resolved,
        seq: resolved ? 916 : 915,
        boundary: resolved
          ? "Seeded browser ResolvePhase ACK locked Night 4 after the slot-5 factional kill."
          : "Seeded browser host opened Night 4 with a submitted slot-5 factional kill.",
      }),
    );
  });
  await page.route("**/games/*/votecount?**", async (route) => {
    await fulfillJson(route, []);
  });
  await page.route("**/games/*/day-vote-outcomes?**", async (route) => {
    await fulfillJson(route, [
      ...dayTwoVoteOutcomeRows(),
      dayThreeVoteOutcomeRow(),
      dayFourNoLynchOutcomeRow(),
    ]);
  });
  await page.route("**/games/*/host-prompts?**", async (route) => {
    await fulfillJson(route, []);
  });
}

async function installPostNightFourHostAdvanceBrowserRoutes(
  page,
  { commandRequests },
) {
  let advanced = false;
  await page.route("**/commands", async (route) => {
    const commandEnvelope = route.request().postDataJSON();
    const command = commandEnvelope?.body?.body?.command;
    commandRequests.push(command);
    if (command?.AdvancePhase !== undefined) {
      advanced = true;
      await fulfillJson(route, {
        v: 1,
        id: commandEnvelope.id,
        body: {
          kind: "Ack",
          body: {
            stream_seqs: [917],
          },
        },
      });
      return;
    }

    await fulfillJson(
      route,
      {
        v: 1,
        id: commandEnvelope?.id ?? "post-night-four-host-advance-reject",
        body: {
          kind: "Reject",
          body: {
            error: "WrongPostNightFourHostAdvanceProofCommand",
            retryable: false,
            message: "post-Night 4 host advance proof only accepts AdvancePhase",
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
        phaseId: advanced ? "D05" : "N04",
        locked: !advanced,
        seq: advanced ? 917 : 916,
        boundary: advanced
          ? "Seeded browser AdvancePhase ACK advanced the host projection to Day 5."
          : "Seeded browser host opened locked Night 4 after factional kill resolution.",
      }),
    );
  });
  await page.route("**/games/*/votecount?**", async (route) => {
    await fulfillJson(route, []);
  });
  await page.route("**/games/*/day-vote-outcomes?**", async (route) => {
    await fulfillJson(route, [
      ...dayTwoVoteOutcomeRows(),
      dayThreeVoteOutcomeRow(),
      dayFourNoLynchOutcomeRow(),
    ]);
  });
  await page.route("**/games/*/host-prompts?**", async (route) => {
    await fulfillJson(route, []);
  });
}

async function installStaleNightFourActionRecoveryBrowserRoutes(
  page,
  { commandRequests },
) {
  let rejected = false;
  await page.route("**/commands", async (route) => {
    const commandEnvelope = route.request().postDataJSON();
    const command = commandEnvelope?.body?.body?.command;
    commandRequests.push(command);
    if (command?.SubmitAction !== undefined) {
      rejected = true;
      await fulfillJson(
        route,
        {
          v: 1,
          id: commandEnvelope.id,
          body: {
            kind: "Reject",
            body: {
              error: "PhaseLocked",
              retryable: true,
              message:
                "Reject PhaseLocked: phase locked; stale action state, refresh and use current action controls",
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
        id: commandEnvelope?.id ?? "stale-night-four-action-recovery-reject",
        body: {
          kind: "Reject",
          body: {
            error: "WrongPostNightFourStaleActionProofCommand",
            retryable: false,
            message:
              "post-Night 4 stale action proof only accepts SubmitAction",
          },
        },
      },
      409,
    );
  });
  await page.route("**/games/*/thread?**", async (route) => {
    await fulfillJson(route, {
      next_before_seq: null,
      posts: [
        {
          source_seq: rejected ? 917 : 916,
          stream_seq: rejected ? 917 : 916,
          author_slot: "host",
          author_user: "host_h",
          body: rejected
            ? "Day 5 has opened."
            : "Night 4 has resolved but this client still has stale action controls.",
          occurred_at: 1782446400,
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
      ...dayTwoVoteOutcomeRows(),
      dayThreeVoteOutcomeRow(),
      dayFourNoLynchOutcomeRow(),
    ]);
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
      rejected
        ? seededDayFiveActionPlayerCommandState({
            boundary:
              "Seeded browser PhaseLocked stale N04 action refreshed into current Day 5 controls.",
          })
        : seededNightFourActionPlayerCommandState({
            boundary:
              "Seeded browser stale Night 4 action proof opened with old slot-5 target controls.",
            actionSubmitted: false,
          }),
    );
  });
}

async function installStaleDayFiveVoteRecoveryBrowserRoutes(
  page,
  { commandRequests },
) {
  let rejected = false;
  await page.route("**/commands", async (route) => {
    const commandEnvelope = route.request().postDataJSON();
    const command = commandEnvelope?.body?.body?.command;
    commandRequests.push(command);
    if (command?.SubmitVote !== undefined) {
      rejected = true;
      await fulfillJson(
        route,
        {
          v: 1,
          id: commandEnvelope.id,
          body: {
            kind: "Reject",
            body: {
              error: "PhaseLocked",
              retryable: true,
              message:
                "Reject PhaseLocked: phase locked; stale vote state, refresh and use current vote controls",
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
        id: commandEnvelope?.id ?? "stale-day-five-vote-recovery-reject",
        body: {
          kind: "Reject",
          body: {
            error: "WrongDayFiveStaleVoteProofCommand",
            retryable: false,
            message: "Day 5 stale vote proof only accepts SubmitVote",
          },
        },
      },
      409,
    );
  });
  await page.route("**/games/*/thread?**", async (route) => {
    await fulfillJson(route, {
      next_before_seq: null,
      posts: [
        {
          source_seq: rejected ? 920 : 917,
          stream_seq: rejected ? 920 : 917,
          author_slot: "host",
          author_user: "host_h",
          body: rejected
            ? "Night 5 has opened."
            : "Day 5 has opened but this client still has stale vote controls.",
          occurred_at: rejected ? 1782619200 : 1782532800,
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
    await fulfillJson(route, rejected ? [] : dayFiveNoLynchVotecountRows());
  });
  await page.route("**/games/*/day-vote-outcomes?**", async (route) => {
    await fulfillJson(
      route,
      rejected
        ? [
            ...dayTwoVoteOutcomeRows(),
            dayThreeVoteOutcomeRow(),
            dayFourNoLynchOutcomeRow(),
            dayFiveNoLynchOutcomeRow(),
          ]
        : [
            ...dayTwoVoteOutcomeRows(),
            dayThreeVoteOutcomeRow(),
            dayFourNoLynchOutcomeRow(),
          ],
    );
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
      rejected
        ? seededNightFiveActionPlayerCommandState({
            boundary:
              "Seeded browser PhaseLocked stale D05 vote refreshed into current Night 5 controls.",
          })
        : seededDayFiveActionPlayerCommandState({
            boundary:
              "Seeded browser stale Day 5 vote proof opened with old no-lynch controls.",
          }),
    );
  });
}

async function installHostCompleteGameFromNightFiveBrowserRoutes(
  page,
  { commandRequests },
) {
  let completed = false;
  await page.route("**/commands", async (route) => {
    const commandEnvelope = route.request().postDataJSON();
    const command = commandEnvelope?.body?.body?.command;
    commandRequests.push(command);
    if (command?.CompleteGame !== undefined) {
      completed = true;
      await fulfillJson(route, {
        v: 1,
        id: commandEnvelope.id,
        body: {
          kind: "Ack",
          body: {
            stream_seqs: [921],
          },
        },
      });
      return;
    }

    await fulfillJson(
      route,
      {
        v: 1,
        id: commandEnvelope?.id ?? "host-complete-game-reject",
        body: {
          kind: "Reject",
          body: {
            error: "WrongCompletedGameHostProofCommand",
            retryable: false,
            message: "completed-game host proof only accepts CompleteGame",
          },
        },
      },
      409,
    );
  });
  await page.route("**/games/*/host-console-state?**", async (route) => {
    await fulfillJson(
      route,
      hostCompletedConsoleState({
        completed,
        phaseId: "N05",
        locked: false,
        seq: completed ? 921 : 920,
        boundary: completed
          ? "Seeded browser CompleteGame ACK revealed endgame role and alignment facts."
          : "Seeded browser host opened Night 5 with final completion control available.",
      }),
    );
  });
  await page.route("**/games/*/votecount?**", async (route) => {
    await fulfillJson(route, []);
  });
  await page.route("**/games/*/day-vote-outcomes?**", async (route) => {
    await fulfillJson(route, [
      ...dayTwoVoteOutcomeRows(),
      dayThreeVoteOutcomeRow(),
      dayFourNoLynchOutcomeRow(),
      dayFiveNoLynchOutcomeRow(),
    ]);
  });
  await page.route("**/games/*/host-prompts?**", async (route) => {
    await fulfillJson(route, []);
  });
}

async function installCompletedHostRoleReloadBrowserRoutes(page) {
  await page.route("**/commands", async (route) => {
    const commandEnvelope = route.request().postDataJSON();
    await fulfillJson(
      route,
      {
        v: 1,
        id: commandEnvelope?.id ?? "completed-host-reload-reject",
        body: {
          kind: "Reject",
          body: {
            error: "WrongCompletedHostReloadProofCommand",
            retryable: false,
            message: "completed-host reload proof does not accept commands",
          },
        },
      },
      409,
    );
  });
  await page.route("**/games/*/host-console-state?**", async (route) => {
    await fulfillJson(
      route,
      hostCompletedConsoleState({
        completed: true,
        phaseId: "N05",
        locked: false,
        seq: 921,
        boundary:
          "Seeded browser completed host role URL reloaded with no live host controls.",
      }),
    );
  });
  await page.route("**/games/*/votecount?**", async (route) => {
    await fulfillJson(route, []);
  });
  await page.route("**/games/*/day-vote-outcomes?**", async (route) => {
    await fulfillJson(route, [
      ...dayTwoVoteOutcomeRows(),
      dayThreeVoteOutcomeRow(),
      dayFourNoLynchOutcomeRow(),
      dayFiveNoLynchOutcomeRow(),
    ]);
  });
  await page.route("**/games/*/host-prompts?**", async (route) => {
    await fulfillJson(route, []);
  });
}

async function installCompletedHostStaleCommandRecoveryBrowserRoutes(
  page,
  { commandRequests, scenario },
) {
  await page.route("**/commands", async (route) => {
    const commandEnvelope = route.request().postDataJSON();
    const command = commandEnvelope?.body?.body?.command;
    commandRequests.push(command);
    if (command?.[scenario.commandKind] !== undefined) {
      await fulfillJson(
        route,
        {
          v: 1,
          id: commandEnvelope.id,
          body: {
            kind: "Reject",
            body: {
              error: "GameAlreadyCompleted",
              retryable: false,
              message: "Reject GameAlreadyCompleted: game already completed",
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
        id: commandEnvelope?.id ?? `${scenario.commandId}-reject`,
        body: {
          kind: "Reject",
          body: {
            error: "WrongCompletedHostStaleProofCommand",
            retryable: false,
            message: `completed-host stale proof only accepts ${scenario.commandKind}`,
          },
        },
      },
      409,
    );
  });
  await page.route("**/games/*/host-console-state?**", async (route) => {
    await fulfillJson(
      route,
      hostCompletedConsoleState({
        completed: true,
        phaseId: "N05",
        locked: false,
        seq: 921,
        boundary: scenario.boundary,
      }),
    );
  });
  await page.route("**/games/*/votecount?**", async (route) => {
    await fulfillJson(route, []);
  });
  await page.route("**/games/*/day-vote-outcomes?**", async (route) => {
    await fulfillJson(route, [
      ...dayTwoVoteOutcomeRows(),
      dayThreeVoteOutcomeRow(),
      dayFourNoLynchOutcomeRow(),
      dayFiveNoLynchOutcomeRow(),
    ]);
  });
  await page.route("**/games/*/host-prompts?**", async (route) => {
    await fulfillJson(route, []);
  });
}

async function installStaleCompletedGamePlayerCommandRecoveryBrowserRoutes(
  page,
  { commandRequests, scenario },
) {
  let rejected = false;
  await page.route("**/commands", async (route) => {
    const commandEnvelope = route.request().postDataJSON();
    const command = commandEnvelope?.body?.body?.command;
    commandRequests.push(command);
    if (command?.[scenario.commandKind] !== undefined) {
      rejected = true;
      await fulfillJson(
        route,
        {
          v: 1,
          id: commandEnvelope.id,
          body: {
            kind: "Reject",
            body: {
              error: "GameAlreadyCompleted",
              retryable: false,
              message: "Reject GameAlreadyCompleted: game already completed",
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
        id: commandEnvelope?.id ?? `stale-completed-game-${scenario.commandKind}-reject`,
        body: {
          kind: "Reject",
          body: {
            error: "WrongCompletedGameStalePlayerProofCommand",
            retryable: false,
            message: `completed-game stale proof only accepts ${scenario.commandKind}`,
          },
        },
      },
      409,
    );
  });
  await page.route("**/games/*/thread?**", async (route) => {
    await fulfillJson(route, {
      next_before_seq: null,
      posts: [
        {
          source_seq: rejected ? 921 : 917,
          stream_seq: rejected ? 921 : 917,
          author_slot: "host",
          author_user: "host_h",
          body: rejected
            ? "The game is complete."
            : "Day 5 has opened but this client still has stale controls.",
          occurred_at: rejected ? 1782619200 : 1782532800,
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
    await fulfillJson(route, rejected ? [] : dayFiveNoLynchVotecountRows());
  });
  await page.route("**/games/*/day-vote-outcomes?**", async (route) => {
    await fulfillJson(route, [
      ...dayTwoVoteOutcomeRows(),
      dayThreeVoteOutcomeRow(),
      dayFourNoLynchOutcomeRow(),
      dayFiveNoLynchOutcomeRow(),
    ]);
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
      rejected
        ? seededCompletedActionPlayerCommandState({
            boundary: scenario.rejectedBoundary,
          })
        : seededDayFiveActionPlayerCommandState({
            boundary: scenario.staleBoundary,
          }),
    );
  });
}

async function installPostDayThreePlayerBrowserRoutes(
  page,
  {
    commandState,
    notifications,
    threadBody,
    threadSeq,
    dayVoteOutcomesRows = [...dayTwoVoteOutcomeRows(), dayThreeVoteOutcomeRow()],
  },
) {
  await page.route("**/games/*/thread?**", async (route) => {
    await fulfillJson(route, {
      next_before_seq: null,
      posts: [
        {
          source_seq: threadSeq,
          stream_seq: threadSeq,
          author_slot: "host",
          author_user: "host_h",
          body: threadBody,
          occurred_at: 1782273600,
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
    await fulfillJson(route, dayVoteOutcomesRows);
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

async function installPostDayThreeHostAdvanceBrowserRoutes(
  page,
  { commandRequests },
) {
  let advanced = false;
  await page.route("**/commands", async (route) => {
    const commandEnvelope = route.request().postDataJSON();
    const command = commandEnvelope?.body?.body?.command;
    commandRequests.push(command);
    if (command?.AdvancePhase !== undefined) {
      advanced = true;
      await fulfillJson(route, {
        v: 1,
        id: commandEnvelope.id,
        body: {
          kind: "Ack",
          body: {
            stream_seqs: [909],
          },
        },
      });
      return;
    }

    await fulfillJson(
      route,
      {
        v: 1,
        id: commandEnvelope?.id ?? "post-day-three-host-advance-reject",
        body: {
          kind: "Reject",
          body: {
            error: "WrongPostDayThreeHostAdvanceProofCommand",
            retryable: false,
            message: "post-Day 3 host advance proof only accepts AdvancePhase",
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
        phaseId: advanced ? "N03" : "D03",
        locked: !advanced,
        seq: advanced ? 909 : 908,
        boundary: advanced
          ? "Seeded browser AdvancePhase ACK advanced the host projection to Night 3."
          : "Seeded browser host opened locked Day 3 after vote resolution.",
      }),
    );
  });
  await page.route("**/games/*/votecount?**", async (route) => {
    await fulfillJson(route, []);
  });
  await page.route("**/games/*/day-vote-outcomes?**", async (route) => {
    await fulfillJson(route, [...dayTwoVoteOutcomeRows(), dayThreeVoteOutcomeRow()]);
  });
  await page.route("**/games/*/host-prompts?**", async (route) => {
    await fulfillJson(route, []);
  });
}

async function installNightThreeEmptyHostTransitionBrowserRoutes(
  page,
  { commandRequests },
) {
  let phaseState = "open-n03";
  await page.route("**/commands", async (route) => {
    const commandEnvelope = route.request().postDataJSON();
    const command = commandEnvelope?.body?.body?.command;
    commandRequests.push(command);
    if (command?.ResolvePhase !== undefined) {
      phaseState = "locked-n03";
      await fulfillJson(route, {
        v: 1,
        id: commandEnvelope.id,
        body: {
          kind: "Ack",
          body: {
            stream_seqs: [910],
          },
        },
      });
      return;
    }
    if (command?.AdvancePhase !== undefined) {
      phaseState = "open-d04";
      await fulfillJson(route, {
        v: 1,
        id: commandEnvelope.id,
        body: {
          kind: "Ack",
          body: {
            stream_seqs: [911],
          },
        },
      });
      return;
    }

    await fulfillJson(
      route,
      {
        v: 1,
        id: commandEnvelope?.id ?? "night-three-empty-host-transition-reject",
        body: {
          kind: "Reject",
          body: {
            error: "WrongNightThreeEmptyHostTransitionProofCommand",
            retryable: false,
            message:
              "empty Night 3 host transition proof only accepts ResolvePhase or AdvancePhase",
          },
        },
      },
      409,
    );
  });
  await page.route("**/games/*/host-console-state?**", async (route) => {
    const hostState =
      phaseState === "open-d04"
        ? {
            phaseId: "D04",
            locked: false,
            seq: 911,
            boundary:
              "Seeded browser AdvancePhase ACK advanced the host projection from empty Night 3 to Day 4.",
          }
        : {
            phaseId: "N03",
            locked: phaseState === "locked-n03",
            seq: phaseState === "locked-n03" ? 910 : 909,
            boundary:
              phaseState === "locked-n03"
                ? "Seeded browser ResolvePhase ACK locked empty Night 3."
                : "Seeded browser host opened Night 3 with no legal player action available.",
          };
    await fulfillJson(route, hostPhaseTransitionConsoleState(hostState));
  });
  await page.route("**/games/*/votecount?**", async (route) => {
    await fulfillJson(route, []);
  });
  await page.route("**/games/*/day-vote-outcomes?**", async (route) => {
    await fulfillJson(route, [...dayTwoVoteOutcomeRows(), dayThreeVoteOutcomeRow()]);
  });
  await page.route("**/games/*/host-prompts?**", async (route) => {
    await fulfillJson(route, []);
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
  const scenario = playerActionSubmissionScenario();
  const actionButton = page.locator(scenario.commandButtonSelector);
  await actionButton.waitFor({ state: "visible", timeout: 15000 });
  await actionButton.click();
  await page.waitForFunction(
    (proofScenario) =>
      window.__fmarchPlayerCommandStatus?.state === proofScenario.finalState &&
      window.__fmarchPlayerCommandDispatchBridgePlan?.commandKind ===
        proofScenario.commandKind,
    scenario,
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
  const command = commandRequests.at(-1)?.[scenario.commandSelector] ?? null;
  return {
    status: "passed",
    clickedAction: scenario.clickedAction,
    commandKind: command === null ? null : scenario.commandKind,
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
  const scenario = privateChannelSubmitPostScenario();
  const privatePostBody = scenario.postBody;
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
    const completedPrivateChannelProof =
      await proveCompletedPrivateChannelRoleSurface({
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
        clickedAction: scenario.clickedAction,
        commandKind: command === null ? null : scenario.commandKind,
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
      completedPrivateChannelProof,
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
  const scenario = stalePrivateChannelPostPhaseLockedScenario();
  const stalePrivatePostBody = scenario.stalePostBody;
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
      scenario.currentThreadBody,
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
      clickedAction: scenario.clickedAction,
      commandKind: command === null ? null : scenario.commandKind,
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

async function proveCompletedPrivateChannelRoleSurface({
  browser,
  frontendBaseUrl,
  roleUrl,
}) {
  const reloadProof = await proveCompletedPrivateChannelReload({
    browser,
    frontendBaseUrl,
    roleUrl,
  });
  const staleCompletedPostRecoveryProof =
    await provePrivateChannelStaleCompletedPostRecovery({
      browser,
      frontendBaseUrl,
      roleUrl,
    });
  return {
    status: "passed",
    sourceRoleUrl: String(roleUrl),
    visitedRolePath: rolePathFromUrl(roleUrl),
    clickedThroughFromRoleUrl: true,
    transition: completedPrivateChannelTransition(),
    reloadProof,
    staleCompletedPostRecoveryProof,
    releaseReady: false,
    productionReady: false,
  };
}

async function proveCompletedPrivateChannelReload({
  browser,
  frontendBaseUrl,
  roleUrl,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const visitedRolePath = rolePathFromUrl(roleUrl);
  const scenario = completedPrivateChannelReloadScenario();
  try {
    await installCompletedPrivateChannelBrowserRoutes(page);
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
    const initialResyncSnapshot = await page.evaluate(async () => {
      if (typeof window.__fmarchTriggerPlayerResync !== "function") {
        throw new Error("player resync hook is unavailable");
      }
      return window.__fmarchTriggerPlayerResync(921);
    });
    await page.waitForFunction(
      (completedThreadBody) =>
        window.__fmarchPlayerProjection?.commandState?.gameCompleted === true &&
        window.__fmarchPlayerProjection?.thread?.posts?.some?.((post) =>
          String(post?.body ?? "").includes(completedThreadBody),
        ) === true,
      scenario.completedThreadBody,
      { timeout: 15000 },
    );
    const initialSnapshot = await collectCompletedPrivateChannelSnapshot(page);
    await page.reload({ waitUntil: "networkidle" });
    await page.getByTestId("player-surface").waitFor({
      state: "visible",
      timeout: 15000,
    });
    const reloadedResyncSnapshot = await page.evaluate(async () => {
      if (typeof window.__fmarchTriggerPlayerResync !== "function") {
        throw new Error("player resync hook is unavailable after reload");
      }
      return window.__fmarchTriggerPlayerResync(921);
    });
    await page.waitForFunction(
      (completedThreadBody) =>
        window.__fmarchPlayerProjection?.commandState?.gameCompleted === true &&
        window.__fmarchPlayerProjection?.thread?.posts?.some?.((post) =>
          String(post?.body ?? "").includes(completedThreadBody),
        ) === true,
      scenario.completedThreadBody,
      { timeout: 15000 },
    );
    const reloadedSnapshot = await collectCompletedPrivateChannelSnapshot(page);
    const bodyText = await page.locator("body").innerText();
    if (/invite=(?!REDACTED)/.test(bodyText)) {
      throw new Error("completed private channel reload leaked an invite URL token");
    }
    return {
      status: "passed",
      sourceRoleUrl: String(roleUrl),
      visitedRolePath,
      surfaceTestId: "player-surface",
      clickedThroughFromRoleUrl: true,
      resyncFromSeq: 921,
      initialResyncSnapshotCommandState:
        initialResyncSnapshot?.commandState ?? null,
      reloadedResyncSnapshotCommandState:
        reloadedResyncSnapshot?.commandState ?? null,
      initialSnapshot,
      reloadedSnapshot,
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    };
  } finally {
    await page.close();
  }
}

async function provePrivateChannelStaleCompletedPostRecovery({
  browser,
  frontendBaseUrl,
  roleUrl,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const visitedRolePath = rolePathFromUrl(roleUrl);
  const commandRequests = [];
  const scenario = staleCompletedPrivatePostScenario();
  const stalePrivatePostBody = scenario.stalePostBody;
  try {
    await installStaleCompletedPrivateChannelBrowserRoutes(page, {
      commandRequests,
      stalePrivatePostBody,
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
    const submitButton = page.locator(
      `[data-testid="player-composer"] button[data-action="${scenario.clickedAction}"]`,
    );
    await submitButton.waitFor({ state: "visible", timeout: 15000 });
    const submitDisabledBeforeReject = await submitButton.isDisabled();
    await page.locator('[data-testid="player-composer"] textarea').fill(
      stalePrivatePostBody,
    );
    await submitButton.click();
    await page.waitForFunction(
      ({ commandError, commandKind }) =>
        window.__fmarchPlayerCommandStatus?.state === "reject" &&
        window.__fmarchPlayerCommandStatus?.error === commandError &&
        window.__fmarchPlayerProjection?.commandState?.gameCompleted === true &&
        window.__fmarchPlayerCommandDispatchBridgePlan?.commandKind ===
          commandKind,
      {
        commandError: scenario.commandError,
        commandKind: scenario.commandKind,
      },
      { timeout: 15000 },
    );
    const stalePostReceipt = page.getByTestId(
      `player-command-receipt-${scenario.clickedAction}`,
    );
    await stalePostReceipt.waitFor({ state: "visible", timeout: 15000 });
    const commandStatus = await page.evaluate(() => window.__fmarchPlayerCommandStatus);
    const bridgePlan = await page.evaluate(
      () => window.__fmarchPlayerCommandDispatchBridgePlan,
    );
    const receipts = await page.evaluate(() => window.__fmarchPlayerCommandReceipts);
    const receiptRefreshKeys = await stalePostReceipt.getAttribute(
      "data-command-refresh-keys",
    );
    const receiptStatusText = await page.getByTestId("player-command-status").innerText();
    const snapshotAfterReject = await collectCompletedPrivateChannelSnapshot(page);
    await page.reload({ waitUntil: "networkidle" });
    await page.getByTestId("player-surface").waitFor({
      state: "visible",
      timeout: 15000,
    });
    const reloadedResyncSnapshot = await page.evaluate(async () => {
      if (typeof window.__fmarchTriggerPlayerResync !== "function") {
        throw new Error("player resync hook is unavailable after completed reject reload");
      }
      return window.__fmarchTriggerPlayerResync(921);
    });
    await page.waitForFunction(
      () =>
        window.__fmarchPlayerProjection?.commandState?.gameCompleted === true,
      null,
      { timeout: 15000 },
    );
    const snapshotAfterReload = await collectCompletedPrivateChannelSnapshot(page);
    const bodyText = await page.locator("body").innerText();
    if (/invite=(?!REDACTED)/.test(bodyText)) {
      throw new Error("completed private channel stale post leaked an invite URL token");
    }
    const command = commandRequests.at(-1)?.SubmitPost ?? null;
    return {
      status: "passed",
      sourceRoleUrl: String(roleUrl),
      visitedRolePath,
      clickedThroughFromRoleUrl: true,
      clickedAction: scenario.clickedAction,
      commandKind: command === null ? null : scenario.commandKind,
      command,
      commandStatus,
      bridgePlan,
      receipts,
      stalePrivatePostBody,
      submitDisabledBeforeReject,
      snapshotAfterReject,
      snapshotAfterReload,
      reloadedResyncSnapshotCommandState:
        reloadedResyncSnapshot?.commandState ?? null,
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
  const scenario = privateChannelSubmitPostScenario();
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
            stream_seqs: [scenario.ackSeq],
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
          source_seq: scenario.ackSeq,
          stream_seq: scenario.ackSeq,
          author_slot: scenario.actorSlot,
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
      boundary: scenario.routeBoundary,
    }));
  });
}

async function installPrivateChannelStalePostBrowserRoutes(page, { commandRequests }) {
  const scenario = stalePrivateChannelPostPhaseLockedScenario();
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
          body: scenario.currentThreadBody,
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
        boundary: scenario.routeBoundary,
      }),
    );
  });
}

async function installCompletedPrivateChannelBrowserRoutes(page) {
  await page.route("**/commands", async (route) => {
    const commandEnvelope = route.request().postDataJSON();
    await fulfillJson(
      route,
      {
        v: 1,
        id: commandEnvelope?.id ?? "completed-private-channel-reject",
        body: {
          kind: "Reject",
          body: {
            error: "WrongCompletedPrivateChannelProofCommand",
            retryable: false,
            message: "completed private channel reload proof does not accept commands",
          },
        },
      },
      409,
    );
  });
  await installCompletedPrivateChannelProjectionRoutes(page);
}

async function installStaleCompletedPrivateChannelBrowserRoutes(
  page,
  { commandRequests, stalePrivatePostBody },
) {
  const scenario = staleCompletedPrivatePostScenario();
  let rejected = false;
  await page.route("**/commands", async (route) => {
    const commandEnvelope = route.request().postDataJSON();
    const command = commandEnvelope?.body?.body?.command;
    commandRequests.push(command);
    if (command?.[scenario.commandKind] !== undefined) {
      rejected = true;
      await fulfillJson(
        route,
        {
          v: 1,
          id: commandEnvelope.id,
          body: {
            kind: "Reject",
            body: {
              error: scenario.commandError,
              retryable: false,
              message: scenario.commandMessage,
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
        id: commandEnvelope?.id ?? "completed-private-channel-stale-reject",
        body: {
          kind: "Reject",
          body: {
            error: "WrongCompletedPrivateChannelProofCommand",
            retryable: false,
            message: `completed private channel stale proof only accepts ${scenario.commandKind}`,
          },
        },
      },
      409,
    );
  });
  await page.route("**/games/*/channels/role-pm/thread?**", async (route) => {
    await fulfillJson(
      route,
      rejected
        ? completedPrivateChannelThread()
        : {
            next_before_seq: null,
            posts: [
              {
                source_seq: 920,
                stream_seq: 920,
                author_slot: "slot-7",
                author_user: "player_mira",
                body: "Stale private channel still accepts a local draft before completion refresh.",
                occurred_at: 1782615600,
              },
            ],
          },
    );
  });
  await page.route("**/games/*/votecount?**", async (route) => {
    await fulfillJson(route, []);
  });
  await page.route("**/games/*/day-vote-outcomes?**", async (route) => {
    await fulfillJson(route, [
      ...dayTwoVoteOutcomeRows(),
      dayThreeVoteOutcomeRow(),
      dayFourNoLynchOutcomeRow(),
      dayFiveNoLynchOutcomeRow(),
    ]);
  });
  await page.route("**/games/*/player-command-state?**", async (route) => {
    await fulfillJson(
      route,
      rejected
        ? completedPrivateChannelCommandState({
            boundary: scenario.routeBoundary,
          })
        : seededPrivateChannelPostOpenCommandState({
            boundary: scenario.staleBoundary,
        }),
    );
  });
  await page.route("**/games/*/notifications?**", async (route) => {
    await fulfillJson(route, []);
  });
  await page.route("**/games/*/investigation-results?**", async (route) => {
    await fulfillJson(route, []);
  });
}

async function installCompletedPrivateChannelProjectionRoutes(page) {
  const scenario = completedPrivateChannelReloadScenario();
  await page.route("**/games/*/channels/role-pm/thread?**", async (route) => {
    await fulfillJson(route, completedPrivateChannelThread());
  });
  await page.route("**/games/*/votecount?**", async (route) => {
    await fulfillJson(route, []);
  });
  await page.route("**/games/*/day-vote-outcomes?**", async (route) => {
    await fulfillJson(route, [
      ...dayTwoVoteOutcomeRows(),
      dayThreeVoteOutcomeRow(),
      dayFourNoLynchOutcomeRow(),
      dayFiveNoLynchOutcomeRow(),
    ]);
  });
  await page.route("**/games/*/player-command-state?**", async (route) => {
    await fulfillJson(
      route,
      completedPrivateChannelCommandState({
        boundary: scenario.routeBoundary,
      }),
    );
  });
  await page.route("**/games/*/notifications?**", async (route) => {
    await fulfillJson(route, []);
  });
  await page.route("**/games/*/investigation-results?**", async (route) => {
    await fulfillJson(route, []);
  });
}

function completedPrivateChannelThread() {
  const scenario = completedPrivateChannelReloadScenario();
  return {
    next_before_seq: null,
    posts: [
      {
        source_seq: 921,
        stream_seq: 921,
        author_slot: "host",
        author_user: "host_h",
        body: scenario.completedThreadBody,
        occurred_at: 1782619200,
      },
    ],
  };
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
        detail: "factional_kill -> slot-3",
        targets: ["slot-3"],
        targetOptions: ["slot-2", "slot-3"],
        grantId: "grant-factional-kill",
      },
    ],
    voteTargets: [],
    currentVote: null,
    boundary,
  };
}

function seededPrivateChannelPostOpenCommandState({ boundary }) {
  return {
    game: "seeded-private-channel-post-open",
    actorSlot: "slot-7",
    actorAlive: true,
    actorStatus: "alive",
    roleKey: "mafia_goon",
    gameCompleted: false,
    phase: {
      phaseId: "N05",
      phaseKind: "Night",
      phaseNumber: 5,
      locked: false,
    },
    actions: [],
    voteTargets: [],
    currentVote: null,
    boundary,
  };
}

function completedPrivateChannelCommandState({ boundary }) {
  return {
    game: "seeded-completed-private-channel",
    actorSlot: "slot-7",
    actorAlive: true,
    actorStatus: "alive",
    roleKey: "mafia_goon",
    gameCompleted: true,
    phase: {
      phaseId: "N05",
      phaseKind: "Night",
      phaseNumber: 5,
      locked: false,
    },
    actions: [],
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

function seededNightActionResolutionTargetCommandState({ boundary }) {
  return {
    game: "seeded-night-action-resolution-target",
    actorSlot: "slot-3",
    actorAlive: false,
    actorStatus: "dead",
    roleKey: null,
    gameCompleted: false,
    phase: {
      phaseId: "N02",
      phaseKind: "Night",
      phaseNumber: 2,
      locked: true,
    },
    actions: [],
    voteTargets: [],
    currentVote: null,
    boundary,
  };
}

function seededNightActionResolutionNormalCommandState({ boundary }) {
  return {
    game: "seeded-night-action-resolution-normal",
    actorSlot: "slot-4",
    actorAlive: true,
    actorStatus: "alive",
    roleKey: null,
    gameCompleted: false,
    phase: {
      phaseId: "N02",
      phaseKind: "Night",
      phaseNumber: 2,
      locked: true,
    },
    actions: [],
    voteTargets: [],
    currentVote: null,
    boundary,
  };
}

function seededDayThreeActionPlayerCommandState({ boundary, currentVote = null }) {
  return {
    game: "seeded-day-three-action-player",
    actorSlot: "slot-7",
    actorAlive: true,
    actorStatus: "alive",
    roleKey: "mafia_goon",
    gameCompleted: false,
    phase: {
      phaseId: "D03",
      phaseKind: "Day",
      phaseNumber: 3,
      locked: false,
      deadline: 1782187200,
    },
    actions: [],
    voteTargets: [
      { kind: "slot", slotId: "slot-4", label: "Slot 4" },
      { kind: "no_lynch", slotId: null, label: "No lynch" },
    ],
    currentVote,
    boundary,
  };
}

function seededDayThreeNightTargetCommandState({ boundary }) {
  return {
    game: "seeded-day-three-night-target",
    actorSlot: "slot-3",
    actorAlive: false,
    actorStatus: "dead",
    roleKey: null,
    gameCompleted: false,
    phase: {
      phaseId: "D03",
      phaseKind: "Day",
      phaseNumber: 3,
      locked: false,
      deadline: 1782187200,
    },
    actions: [],
    voteTargets: [],
    currentVote: null,
    boundary,
  };
}

function seededDayThreeNormalCommandState({ boundary }) {
  return {
    game: "seeded-day-three-normal",
    actorSlot: "slot-4",
    actorAlive: true,
    actorStatus: "alive",
    roleKey: null,
    gameCompleted: false,
    phase: {
      phaseId: "D03",
      phaseKind: "Day",
      phaseNumber: 3,
      locked: false,
      deadline: 1782187200,
    },
    actions: [],
    voteTargets: [
      { kind: "slot", slotId: "slot-7", label: "Slot 7" },
      { kind: "no_lynch", slotId: null, label: "No lynch" },
    ],
    currentVote: null,
    boundary,
  };
}

function seededPostDayThreeVoteTargetCommandState({ boundary }) {
  return {
    game: "seeded-post-day-three-vote-target",
    actorSlot: "slot-4",
    actorAlive: false,
    actorStatus: "dead",
    roleKey: null,
    gameCompleted: false,
    phase: {
      phaseId: "D03",
      phaseKind: "Day",
      phaseNumber: 3,
      locked: true,
      deadline: 1782187200,
    },
    actions: [],
    voteTargets: [],
    currentVote: null,
    boundary,
  };
}

function seededPostDayThreeActionPlayerCommandState({ boundary }) {
  return {
    game: "seeded-post-day-three-action-player",
    actorSlot: "slot-7",
    actorAlive: true,
    actorStatus: "alive",
    roleKey: "mafia_goon",
    gameCompleted: false,
    phase: {
      phaseId: "D03",
      phaseKind: "Day",
      phaseNumber: 3,
      locked: true,
      deadline: 1782187200,
    },
    actions: [],
    voteTargets: [],
    currentVote: null,
    boundary,
  };
}

function seededNightThreeActionPlayerCommandState({ boundary }) {
  return {
    game: "seeded-night-three-action-player",
    actorSlot: "slot-7",
    actorAlive: true,
    actorStatus: "alive",
    roleKey: "mafia_goon",
    gameCompleted: false,
    phase: {
      phaseId: "N03",
      phaseKind: "Night",
      phaseNumber: 3,
      locked: false,
    },
    actions: [],
    voteTargets: [],
    currentVote: null,
    boundary,
  };
}

function seededDayFourActionPlayerCommandState({ boundary, currentVote = null }) {
  return {
    game: "seeded-day-four-action-player",
    actorSlot: "slot-7",
    actorAlive: true,
    actorStatus: "alive",
    roleKey: "mafia_goon",
    gameCompleted: false,
    phase: {
      phaseId: "D04",
      phaseKind: "Day",
      phaseNumber: 4,
      locked: false,
      deadline: 1782360000,
    },
    actions: [],
    voteTargets: [{ kind: "no_lynch", slotId: null, label: "No lynch" }],
    currentVote,
    boundary,
  };
}

function seededDayFourSurvivorCommandState({ boundary }) {
  return {
    game: "seeded-day-four-survivor",
    actorSlot: "slot-5",
    actorAlive: true,
    actorStatus: "alive",
    roleKey: null,
    gameCompleted: false,
    phase: {
      phaseId: "D04",
      phaseKind: "Day",
      phaseNumber: 4,
      locked: false,
      deadline: 1782360000,
    },
    actions: [],
    voteTargets: [
      { kind: "slot", slotId: "slot-7", label: "Slot 7" },
      { kind: "no_lynch", slotId: null, label: "No lynch" },
    ],
    currentVote: null,
    boundary,
  };
}

function seededNightFourActionPlayerCommandState({
  boundary,
  actionSubmitted = false,
}) {
  return {
    game: "seeded-night-four-action-player",
    actorSlot: "slot-7",
    actorAlive: true,
    actorStatus: "alive",
    roleKey: "mafia_goon",
    gameCompleted: false,
    phase: {
      phaseId: "N04",
      phaseKind: "Night",
      phaseNumber: 4,
      locked: false,
    },
    actions: actionSubmitted
      ? []
      : [
          {
            action: "submit_action:factional_kill",
            commandKind: "submit_action",
            actionId: "factional_kill",
            templateId: "factional_kill",
            ability: "Kill",
            window: "Night",
            label: "Submit factional kill",
            detail: "factional_kill -> slot-5",
            targets: ["slot-5"],
            targetOptions: ["slot-5"],
            grantId: "grant-factional-kill-n04",
          },
        ],
    voteTargets: [],
    currentVote: null,
    boundary,
  };
}

function seededNightFourSurvivorKilledCommandState({ boundary }) {
  return {
    game: "seeded-night-four-survivor-killed",
    actorSlot: "slot-5",
    actorAlive: false,
    actorStatus: "dead",
    roleKey: null,
    gameCompleted: false,
    phase: {
      phaseId: "N04",
      phaseKind: "Night",
      phaseNumber: 4,
      locked: true,
    },
    actions: [],
    voteTargets: [],
    currentVote: null,
    boundary,
  };
}

function seededNightFourActionPlayerResolvedCommandState({ boundary }) {
  return {
    game: "seeded-night-four-action-player-resolved",
    actorSlot: "slot-7",
    actorAlive: true,
    actorStatus: "alive",
    roleKey: "mafia_goon",
    gameCompleted: false,
    phase: {
      phaseId: "N04",
      phaseKind: "Night",
      phaseNumber: 4,
      locked: true,
    },
    actions: [],
    voteTargets: [],
    currentVote: null,
    boundary,
  };
}

function seededDayFiveSurvivorKilledCommandState({ boundary }) {
  return {
    game: "seeded-day-five-survivor-killed",
    actorSlot: "slot-5",
    actorAlive: false,
    actorStatus: "dead",
    roleKey: null,
    gameCompleted: false,
    phase: {
      phaseId: "D05",
      phaseKind: "Day",
      phaseNumber: 5,
      locked: false,
      deadline: 1782532800,
    },
    actions: [],
    voteTargets: [],
    currentVote: null,
    boundary,
  };
}

function seededDayFiveActionPlayerCommandState({ boundary, currentVote = null }) {
  return {
    game: "seeded-day-five-action-player",
    actorSlot: "slot-7",
    actorAlive: true,
    actorStatus: "alive",
    roleKey: "mafia_goon",
    gameCompleted: false,
    phase: {
      phaseId: "D05",
      phaseKind: "Day",
      phaseNumber: 5,
      locked: false,
      deadline: 1782532800,
    },
    actions: [],
    voteTargets: [{ kind: "no_lynch", slotId: null, label: "No lynch" }],
    currentVote,
    boundary,
  };
}

function seededNightFiveActionPlayerCommandState({ boundary }) {
  return {
    game: "seeded-night-five-action-player",
    actorSlot: "slot-7",
    actorAlive: true,
    actorStatus: "alive",
    roleKey: "mafia_goon",
    gameCompleted: false,
    phase: {
      phaseId: "N05",
      phaseKind: "Night",
      phaseNumber: 5,
      locked: false,
    },
    actions: [],
    voteTargets: [],
    currentVote: null,
    boundary,
  };
}

function seededCompletedActionPlayerCommandState({ boundary }) {
  return {
    game: "seeded-completed-action-player",
    actorSlot: "slot-7",
    actorAlive: true,
    actorStatus: "alive",
    roleKey: "mafia_goon",
    gameCompleted: true,
    phase: {
      phaseId: "N05",
      phaseKind: "Night",
      phaseNumber: 5,
      locked: false,
    },
    actions: [],
    voteTargets: [],
    currentVote: null,
    boundary,
  };
}

function seededCompletedNormalPlayerCommandState({ boundary }) {
  return {
    game: "seeded-completed-normal-player",
    actorSlot: "slot-4",
    actorAlive: true,
    actorStatus: "alive",
    roleKey: "vanilla_townie",
    gameCompleted: true,
    phase: {
      phaseId: "N05",
      phaseKind: "Night",
      phaseNumber: 5,
      locked: false,
    },
    actions: [],
    voteTargets: [],
    currentVote: null,
    boundary,
  };
}

function seededCompletedDeadPlayerCommandState({ boundary }) {
  return {
    game: "seeded-completed-dead-player",
    actorSlot: "slot-2",
    actorAlive: false,
    actorStatus: "dead",
    roleKey: null,
    gameCompleted: true,
    phase: {
      phaseId: "N05",
      phaseKind: "Night",
      phaseNumber: 5,
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

function hostPhaseTransitionConsoleState({
  phaseId,
  locked,
  boundary,
  seq = locked ? 801 : 802,
}) {
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
        seq,
        author_slot: "host",
        body: boundary,
      },
    ],
  };
}

function hostCompletedConsoleState({
  completed,
  phaseId,
  locked,
  boundary,
  seq,
}) {
  return {
    completed,
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
        alignment: "mafia",
        role_revealed: completed,
        alignment_revealed: completed,
      },
      {
        slot_id: "slot-5",
        occupant_user_id: "player-sage",
        alive: false,
        status: "dead",
        status_tags: ["dead"],
        role_key: "vanilla_townie",
        alignment: "town",
        role_revealed: completed,
        alignment_revealed: completed,
      },
    ],
    thread_posts: [
      {
        seq,
        author_slot: "host",
        body: boundary,
      },
    ],
  };
}

function dayTwoVoteOutcomeRows() {
  return [
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
  ];
}

function dayThreeVotecountRows() {
  return [
    {
      target: "slot-4 / Rowan",
      count: 2,
      needed: 2,
    },
  ];
}

function dayThreeVoteOutcomeRow() {
  return {
    phase_id: "D03",
    source_seq: 908,
    event_index: 0,
    status: "Lynch",
    winner_slot: "slot-4",
    tallies: { "slot-4": 2 },
    majority: 2,
    reason: null,
  };
}

function dayFourNoLynchVotecountRows() {
  return [
    {
      target: "No lynch",
      count: 1,
      needed: 1,
    },
  ];
}

function dayFourNoLynchOutcomeRow() {
  return {
    phase_id: "D04",
    source_seq: 913,
    event_index: 0,
    status: "NoLynch",
    winner_slot: null,
    tallies: { no_lynch: 1 },
    majority: 1,
    reason: null,
  };
}

function dayFiveNoLynchVotecountRows() {
  return [
    {
      target: "No lynch",
      count: 1,
      needed: 1,
    },
  ];
}

function dayFiveNoLynchOutcomeRow() {
  return {
    phase_id: "D05",
    source_seq: 919,
    event_index: 0,
    status: "NoLynch",
    winner_slot: null,
    tallies: { no_lynch: 1 },
    majority: 1,
    reason: null,
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
  assertNightActionResolutionReceiptSurface(
    evidence.nightActionResolutionReceiptSurface,
  );
  assertNormalNightActionResolutionPrivacySurface(
    evidence.normalNightActionResolutionPrivacySurface,
  );
  assertHostNightActionTransitionSurface(evidence.hostNightActionTransitionSurface);
  assertDayThreeVoteResolutionSurface(evidence.dayThreeVoteResolutionSurface);
  assertPostDayThreeResolutionSurface(evidence.postDayThreeResolutionSurface);
  assertNightThreeEmptyResolutionSurface(
    evidence.nightThreeEmptyResolutionSurface,
  );
  assertDayFourSurvivorRoleSurface(evidence.dayFourSurvivorRoleSurface);
  assertNightFourActionSubmissionSurface(
    evidence.nightFourActionSubmissionSurface,
  );
  assertNightFourResolutionReceiptSurface(
    evidence.nightFourResolutionReceiptSurface,
  );
  assertPostNightFourTransitionSurface(evidence.postNightFourTransitionSurface);
  assertDayFiveNoLynchResolutionSurface(
    evidence.dayFiveNoLynchResolutionSurface,
  );
  assertCompletedGameEndgameSurface(evidence.completedGameEndgameSurface);
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
  const scenario = playerActionSubmissionScenario();
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
    checkpoint.actorSlot !== scenario.actorSlot ||
    checkpoint.actionState !== `enabled:${scenario.clickedAction}` ||
    checkpoint.selectedAction !== scenario.actionId ||
    checkpoint.targetSlots !== scenario.targetSlot ||
    checkpoint.receiptState !== "idle" ||
    !checkpoint.targetText?.includes(
      `${scenario.actionId} -> ${scenario.targetSlot}`,
    ) ||
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
  const scenario = playerActionSubmissionScenario();
  if (
    clickProof?.status !== "passed" ||
    clickProof.clickedAction !== scenario.clickedAction ||
    clickProof.commandKind !== scenario.commandKind ||
    clickProof.command?.game !== expectedGame ||
    clickProof.command.action_id !== scenario.actionId ||
    clickProof.command.actor_slot !== scenario.actorSlot ||
    clickProof.command.template_id !== scenario.templateId ||
    clickProof.command.targets?.[0] !== scenario.targetSlot ||
    clickProof.command.grant_id !== scenario.grantId ||
    clickProof.commandStatus?.state !== scenario.finalState ||
    !clickProof.commandStatus?.message?.includes(
      `Ack: stream seqs ${scenario.streamSeq}`,
    ) ||
    clickProof.bridgePlan?.role !== "player" ||
    clickProof.bridgePlan.commandKind !== scenario.commandKind ||
    clickProof.bridgePlan.commandEndpoint !== "/commands" ||
    clickProof.bridgePlan.finalState !== scenario.finalState ||
    !sameStringArray(
      clickProof.bridgePlan.projectionRefreshKeys,
      scenario.expectedRefreshKeys,
    ) ||
    clickProof.receipts?.at?.(-1)?.state !== scenario.finalState ||
    clickProof.projectionCommandState?.phase?.phaseId !==
      scenario.refreshedPhaseId ||
    clickProof.projectionCommandState?.actions?.length !== 0 ||
    !String(clickProof.checkpointReceiptState ?? "").startsWith("ack:") ||
    clickProof.checkpointActionStateAfterAck !== scenario.checkpointActionState ||
    clickProof.receiptCount !== 1 ||
    !String(clickProof.receiptStatusText ?? "")
      .toLowerCase()
      .includes(`ack: stream seqs ${scenario.streamSeq}`)
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
  assertPrivateReceiptRoleSurface({
    proof: targetSurface,
    ...privateReceiptAssertionArgs({
      scenario: privateReceiptScenario("n01-target-receipt"),
      expectedGame,
      sourceRoleUrl: targetSurface?.sourceRoleUrl,
    }),
    errorMessage: "core-loop admin proof missing target resolution receipt surface",
  });
}

function assertNormalResolutionPrivacySurface(normalSurface) {
  const expectedGame = gameFromRoleUrl(normalSurface?.sourceRoleUrl);
  assertPrivateReceiptRoleSurface({
    proof: normalSurface,
    ...privateReceiptAssertionArgs({
      scenario: privateReceiptScenario("n01-normal-privacy"),
      expectedGame,
      sourceRoleUrl: normalSurface?.sourceRoleUrl,
    }),
    errorMessage: "core-loop admin proof missing normal resolution privacy surface",
  });
}

function assertTargetDayVoteReceiptSurface(targetSurface) {
  const expectedGame = gameFromRoleUrl(targetSurface?.sourceRoleUrl);
  assertPrivateReceiptRoleSurface({
    proof: targetSurface,
    ...privateReceiptAssertionArgs({
      scenario: privateReceiptScenario("d02-target-receipt"),
      expectedGame,
      sourceRoleUrl: targetSurface?.sourceRoleUrl,
    }),
    errorMessage: "core-loop admin proof missing target day-vote receipt surface",
  });
}

function assertNormalDayVotePrivacySurface(normalSurface) {
  const expectedGame = gameFromRoleUrl(normalSurface?.sourceRoleUrl);
  assertPrivateReceiptRoleSurface({
    proof: normalSurface,
    ...privateReceiptAssertionArgs({
      scenario: privateReceiptScenario("d02-normal-privacy"),
      expectedGame,
      sourceRoleUrl: normalSurface?.sourceRoleUrl,
    }),
    errorMessage: "core-loop admin proof missing normal day-vote privacy surface",
  });
}

function assertPrivateReceiptRoleSurface({
  proof,
  sourceRoleUrl,
  expectedSlot,
  slotField,
  expectedPrincipalUserId,
  expectedPhaseId,
  expectedPhaseState,
  expectedActorAlive,
  expectedActorStatus,
  expectedActionState,
  expectedStatusText,
  expectedPrivateCount,
  expectedPrivateReceipt,
  expectedBoundaryText,
  expectedResyncFromSeq,
  expectedPrivateReceiptStatus,
  expectedPrivateReceiptPhaseId,
  expectedResyncNotificationEffect,
  expectedResyncNotificationStatus,
  expectedPrivateQueueBoundaryStatus,
  expectedProjectionPhaseId,
  expectedProjectionLocked,
  expectedResyncSnapshotPhaseId,
  expectedCommandStateEndpoint,
  expectedNotificationsEndpoint,
  errorMessage,
}) {
  if (
    proof?.status !== "passed" ||
    proof.clickedThroughFromRoleUrl !== true ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.rawInviteTokensVisible !== false ||
    proof[slotField] !== expectedSlot ||
    proof.principalUserId !== expectedPrincipalUserId ||
    (!expectedPrivateReceipt && proof.targetReceiptVisible !== false) ||
    typeof proof.sourceRoleUrl !== "string" ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    !proof.sourceRoleUrl.includes("/g/") ||
    !proof.sourceRoleUrl.includes("private=notification-1") ||
    typeof proof.visitedRolePath !== "string" ||
    !proof.visitedRolePath.includes("/g/") ||
    !proof.visitedRolePath.includes("private=notification-1") ||
    proof.surfaceTestId !== "player-surface" ||
    proof.checkpoint?.phaseId !== expectedPhaseId ||
    proof.checkpoint.phaseState !== expectedPhaseState ||
    proof.checkpoint.actorSlot !== expectedSlot ||
    proof.checkpoint.actionState !== expectedActionState ||
    proof.checkpoint.receiptState !== "idle" ||
    !String(proof.checkpoint.statusText ?? "")
      .toLowerCase()
      .includes(`player action unavailable: ${expectedStatusText}`) ||
    proof.privateQueueBoundary?.status !== expectedPrivateQueueBoundaryStatus ||
    proof.privateQueueBoundary.count !== expectedPrivateCount ||
    !String(proof.privateQueueBoundary.text ?? "").includes(
      "principal-scoped endpoints",
    ) ||
    proof.projectionCommandState?.actorSlot !== expectedSlot ||
    proof.projectionCommandState?.actorAlive !== expectedActorAlive ||
    proof.projectionCommandState?.actorStatus !== expectedActorStatus ||
    (expectedProjectionPhaseId !== null &&
      proof.projectionCommandState?.phase?.phaseId !== expectedProjectionPhaseId) ||
    (expectedProjectionLocked !== null &&
      proof.projectionCommandState?.phase?.locked !== expectedProjectionLocked) ||
    proof.projectionCommandState?.actions?.length !== 0 ||
    !String(proof.projectionCommandState?.boundary ?? "").includes(
      expectedBoundaryText,
    ) ||
    proof.resyncFromSeq !== expectedResyncFromSeq ||
    proof.resyncSnapshotCommandState?.actorSlot !== expectedSlot ||
    (expectedResyncSnapshotPhaseId !== null &&
      proof.resyncSnapshotCommandState?.phase?.phaseId !==
        expectedResyncSnapshotPhaseId) ||
    proof.coldLoadEndpoints?.notificationsEndpoint !==
      expectedNotificationsEndpoint ||
    proof.coldLoadEndpoints?.commandStateEndpoint !== expectedCommandStateEndpoint
  ) {
    throw new Error(`${errorMessage}: ${JSON.stringify(proof)}`);
  }
  if (
    expectedPrivateReceipt &&
    (proof.privateNotice?.id !== "notification-1" ||
      proof.privateNotice.kind !== "notification" ||
      !String(proof.privateNotice.text ?? "").includes("player_killed") ||
      !String(proof.privateNotice.text ?? "").includes(
        expectedPrivateReceiptStatus,
      ) ||
      proof.privateNotice.detailText !==
        `Phase ${expectedPrivateReceiptPhaseId}` ||
      proof.projectionNotifications?.[0]?.effect !== "player_killed" ||
      proof.projectionNotifications?.[0]?.status !==
        expectedPrivateReceiptStatus ||
      (expectedResyncNotificationEffect !== null &&
        proof.resyncSnapshotNotifications?.[0]?.effect !==
          expectedResyncNotificationEffect) ||
      (expectedResyncNotificationStatus !== null &&
        proof.resyncSnapshotNotifications?.[0]?.status !==
          expectedResyncNotificationStatus))
  ) {
    throw new Error(`${errorMessage}: ${JSON.stringify(proof)}`);
  }
  if (
    !expectedPrivateReceipt &&
    (!String(proof.privateEmptyText ?? "").includes("No private results visible") ||
      proof.projectionNotifications?.length !== 0 ||
      proof.resyncSnapshotNotifications?.length !== 0 ||
      proof.privateNotice !== undefined)
  ) {
    throw new Error(`${errorMessage}: ${JSON.stringify(proof)}`);
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

function assertNightActionResolutionReceiptSurface(targetSurface) {
  const expectedGame = gameFromRoleUrl(targetSurface?.sourceRoleUrl);
  const scenario = privateReceiptScenario("n02-target-receipt");
  if (
    targetSurface?.status !== "passed" ||
    targetSurface.clickedThroughFromRoleUrl !== true ||
    targetSurface.releaseReady !== false ||
    targetSurface.productionReady !== false ||
    targetSurface.rawInviteTokensVisible !== false ||
    targetSurface.targetSlot !== scenario.expectedSlot ||
    targetSurface.principalUserId !== scenario.principalUserId ||
    typeof targetSurface.sourceRoleUrl !== "string" ||
    !targetSurface.sourceRoleUrl.includes("/g/") ||
    !targetSurface.sourceRoleUrl.includes("private=notification-1") ||
    typeof targetSurface.visitedRolePath !== "string" ||
    !targetSurface.visitedRolePath.includes("/g/") ||
    !targetSurface.visitedRolePath.includes("private=notification-1") ||
    targetSurface.surfaceTestId !== "player-surface" ||
    targetSurface.checkpoint?.phaseId !== scenario.phaseId ||
    targetSurface.checkpoint.phaseState !== scenario.phaseState ||
    targetSurface.checkpoint.actorSlot !== scenario.expectedSlot ||
    targetSurface.checkpoint.actionState !== scenario.actionState ||
    targetSurface.checkpoint.receiptState !== "idle" ||
    !String(targetSurface.checkpoint.statusText ?? "")
      .toLowerCase()
      .includes(`player action unavailable: ${scenario.statusText}`) ||
    targetSurface.privateQueueBoundary?.status !==
      "principal-scoped-private-projections" ||
    targetSurface.privateQueueBoundary.count !== 1 ||
    !String(targetSurface.privateQueueBoundary.text ?? "").includes(
      "principal-scoped endpoints",
    ) ||
    targetSurface.privateNotice?.id !== "notification-1" ||
    targetSurface.privateNotice.kind !== "notification" ||
    !String(targetSurface.privateNotice.text ?? "").includes("player_killed") ||
    !String(targetSurface.privateNotice.text ?? "").includes(
      scenario.privateReceiptStatus,
    ) ||
    targetSurface.privateNotice.detailText !==
      `Phase ${scenario.privateReceiptPhaseId}` ||
    targetSurface.projectionCommandState?.actorSlot !== scenario.expectedSlot ||
    targetSurface.projectionCommandState?.actorAlive !== scenario.actorAlive ||
    targetSurface.projectionCommandState?.actorStatus !== scenario.actorStatus ||
    targetSurface.projectionCommandState?.phase?.phaseId !== scenario.phaseId ||
    targetSurface.projectionCommandState?.phase?.locked !== true ||
    targetSurface.projectionCommandState?.actions?.length !== 0 ||
    !String(targetSurface.projectionCommandState?.boundary ?? "").includes(
      scenario.boundaryText,
    ) ||
    targetSurface.projectionNotifications?.[0]?.effect !== "player_killed" ||
    targetSurface.projectionNotifications?.[0]?.status !==
      scenario.privateReceiptStatus ||
    targetSurface.resyncFromSeq !== scenario.resyncFromSeq ||
    targetSurface.resyncSnapshotCommandState?.actorSlot !== scenario.expectedSlot ||
    targetSurface.resyncSnapshotCommandState?.phase?.phaseId !==
      scenario.phaseId ||
    targetSurface.resyncSnapshotNotifications?.[0]?.status !==
      scenario.privateReceiptStatus ||
    targetSurface.coldLoadEndpoints?.notificationsEndpoint !==
      `/games/${expectedGame}/notifications?principal_user_id=${scenario.principalUserId}` ||
    targetSurface.coldLoadEndpoints?.commandStateEndpoint !==
      `/games/${expectedGame}/player-command-state?principal_user_id=${scenario.principalUserId}&slot_id=${scenario.expectedSlot}`
  ) {
    throw new Error(
      `core-loop admin proof missing night action resolution receipt surface: ${JSON.stringify(
        targetSurface,
      )}`,
    );
  }
}

function assertNormalNightActionResolutionPrivacySurface(normalSurface) {
  const expectedGame = gameFromRoleUrl(normalSurface?.sourceRoleUrl);
  const scenario = privateReceiptScenario("n02-normal-privacy");
  if (
    normalSurface?.status !== "passed" ||
    normalSurface.clickedThroughFromRoleUrl !== true ||
    normalSurface.releaseReady !== false ||
    normalSurface.productionReady !== false ||
    normalSurface.rawInviteTokensVisible !== false ||
    normalSurface.normalSlot !== scenario.expectedSlot ||
    normalSurface.principalUserId !== scenario.principalUserId ||
    normalSurface.targetReceiptVisible !== false ||
    typeof normalSurface.sourceRoleUrl !== "string" ||
    !normalSurface.sourceRoleUrl.includes("/g/") ||
    !normalSurface.sourceRoleUrl.includes("private=notification-1") ||
    typeof normalSurface.visitedRolePath !== "string" ||
    !normalSurface.visitedRolePath.includes("/g/") ||
    !normalSurface.visitedRolePath.includes("private=notification-1") ||
    normalSurface.surfaceTestId !== "player-surface" ||
    normalSurface.checkpoint?.phaseId !== scenario.phaseId ||
    normalSurface.checkpoint.phaseState !== scenario.phaseState ||
    normalSurface.checkpoint.actorSlot !== scenario.expectedSlot ||
    normalSurface.checkpoint.actionState !== scenario.actionState ||
    normalSurface.checkpoint.receiptState !== "idle" ||
    !String(normalSurface.checkpoint.statusText ?? "")
      .toLowerCase()
      .includes(`player action unavailable: ${scenario.statusText}`) ||
    normalSurface.privateQueueBoundary?.status !==
      "principal-scoped-private-projections" ||
    normalSurface.privateQueueBoundary.count !== 0 ||
    !String(normalSurface.privateQueueBoundary.text ?? "").includes(
      "principal-scoped endpoints",
    ) ||
    !String(normalSurface.privateEmptyText ?? "").includes(
      "No private results visible",
    ) ||
    normalSurface.projectionCommandState?.actorSlot !== scenario.expectedSlot ||
    normalSurface.projectionCommandState?.actorAlive !== scenario.actorAlive ||
    normalSurface.projectionCommandState?.actorStatus !== scenario.actorStatus ||
    normalSurface.projectionCommandState?.phase?.phaseId !== scenario.phaseId ||
    normalSurface.projectionCommandState?.phase?.locked !== true ||
    normalSurface.projectionCommandState?.actions?.length !== 0 ||
    !String(normalSurface.projectionCommandState?.boundary ?? "").includes(
      scenario.boundaryText,
    ) ||
    normalSurface.projectionNotifications?.length !== 0 ||
    normalSurface.resyncFromSeq !== scenario.resyncFromSeq ||
    normalSurface.resyncSnapshotCommandState?.actorSlot !==
      scenario.expectedSlot ||
    normalSurface.resyncSnapshotCommandState?.phase?.phaseId !==
      scenario.phaseId ||
    normalSurface.resyncSnapshotNotifications?.length !== 0 ||
    normalSurface.coldLoadEndpoints?.notificationsEndpoint !==
      `/games/${expectedGame}/notifications?principal_user_id=${scenario.principalUserId}` ||
    normalSurface.coldLoadEndpoints?.commandStateEndpoint !==
      `/games/${expectedGame}/player-command-state?principal_user_id=${scenario.principalUserId}&slot_id=${scenario.expectedSlot}`
  ) {
    throw new Error(
      `core-loop admin proof missing normal night action resolution privacy surface: ${JSON.stringify(
        normalSurface,
      )}`,
    );
  }
}

function assertPlayerActionInvalidRecoveryProof({
  invalidRecoveryProof,
  expectedGame,
}) {
  const scenario = playerInvalidActionRecoveryScenario();
  if (
    invalidRecoveryProof?.status !== "passed" ||
    invalidRecoveryProof.clickedAction !== scenario.clickedAction ||
    invalidRecoveryProof.commandKind !== scenario.commandKind ||
    invalidRecoveryProof.command?.game !== expectedGame ||
    invalidRecoveryProof.command.action_id !== scenario.actionId ||
    invalidRecoveryProof.command.actor_slot !== scenario.actorSlot ||
    invalidRecoveryProof.command.template_id !== scenario.templateId ||
    invalidRecoveryProof.command.targets?.[0] !== scenario.targetSlot ||
    invalidRecoveryProof.command.grant_id !== scenario.grantId ||
    invalidRecoveryProof.commandStatus?.state !== scenario.finalState ||
    invalidRecoveryProof.commandStatus.error !== scenario.error ||
    !invalidRecoveryProof.commandStatus?.message?.includes(
      scenario.messageIncludes,
    ) ||
    invalidRecoveryProof.bridgePlan?.role !== "player" ||
    invalidRecoveryProof.bridgePlan.commandKind !== scenario.commandKind ||
    invalidRecoveryProof.bridgePlan.commandEndpoint !== "/commands" ||
    invalidRecoveryProof.bridgePlan.finalState !== scenario.finalState ||
    !sameStringArray(
      invalidRecoveryProof.bridgePlan.projectionRefreshKeys,
      scenario.expectedRefreshKeys,
    ) ||
    invalidRecoveryProof.receipts?.at?.(-1)?.state !== scenario.finalState ||
    invalidRecoveryProof.projectionCommandState?.phase?.phaseId !==
      scenario.refreshedPhaseId ||
    invalidRecoveryProof.projectionCommandState?.actions?.[0]?.templateId !==
      scenario.refreshedActionTemplateId ||
    invalidRecoveryProof.checkpointReceiptState !==
      scenario.checkpointReceiptState ||
    invalidRecoveryProof.checkpointActionStateAfterReject !==
      scenario.checkpointActionState ||
    invalidRecoveryProof.checkpointTargetSlotsAfterReject !==
      scenario.checkpointTargetSlots ||
    invalidRecoveryProof.receiptCount !== 1 ||
    !String(invalidRecoveryProof.receiptStatusText ?? "")
      .toLowerCase()
      .includes(scenario.messageIncludes.toLowerCase())
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
    playerObservationProof.checkpointTargetSlots !== "slot-3" ||
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

function assertHostNightActionTransitionSurface(hostNightActionTransitionSurface) {
  const expectedGame = gameFromRoleUrl(
    hostNightActionTransitionSurface?.sourceHostRoleUrl,
  );
  const resolveProof = hostNightActionTransitionSurface?.resolveProof;
  const advanceProof = hostNightActionTransitionSurface?.advanceProof;
  const actionPlayerObservationProof =
    hostNightActionTransitionSurface?.actionPlayerObservationProof;
  const nightTargetObservationProof =
    hostNightActionTransitionSurface?.nightTargetObservationProof;
  const normalObservationProof =
    hostNightActionTransitionSurface?.normalObservationProof;
  if (
    hostNightActionTransitionSurface?.status !== "passed" ||
    hostNightActionTransitionSurface.clickedThroughFromRoleUrl !== true ||
    hostNightActionTransitionSurface.releaseReady !== false ||
    hostNightActionTransitionSurface.productionReady !== false ||
    typeof hostNightActionTransitionSurface.sourceHostRoleUrl !== "string" ||
    !hostNightActionTransitionSurface.sourceHostRoleUrl.includes("/g/") ||
    !hostNightActionTransitionSurface.sourceHostRoleUrl.endsWith("/host") ||
    typeof hostNightActionTransitionSurface.sourceActionPlayerRoleUrl !==
      "string" ||
    !hostNightActionTransitionSurface.sourceActionPlayerRoleUrl.includes("/g/") ||
    typeof hostNightActionTransitionSurface.sourceNightTargetRoleUrl !==
      "string" ||
    !hostNightActionTransitionSurface.sourceNightTargetRoleUrl.includes("/g/") ||
    typeof hostNightActionTransitionSurface.sourceNormalRoleUrl !== "string" ||
    !hostNightActionTransitionSurface.sourceNormalRoleUrl.includes("/g/") ||
    typeof hostNightActionTransitionSurface.visitedHostRolePath !== "string" ||
    !hostNightActionTransitionSurface.visitedHostRolePath.endsWith("/host") ||
    hostNightActionTransitionSurface.surfaceTestId !== "host-console-surface" ||
    !String(hostNightActionTransitionSurface.transition ?? "").includes(
      "resolve_phase:ack:905",
    ) ||
    !String(hostNightActionTransitionSurface.transition ?? "").includes(
      "advance_phase:ack:906",
    ) ||
    !String(hostNightActionTransitionSurface.transition ?? "").includes(
      "actionPlayer:D03",
    ) ||
    !String(hostNightActionTransitionSurface.transition ?? "").includes(
      "target:D03",
    ) ||
    !String(hostNightActionTransitionSurface.transition ?? "").includes(
      "normal:D03",
    )
  ) {
    throw new Error(
      `core-loop admin proof missing host night action transition surface: ${JSON.stringify(
        hostNightActionTransitionSurface,
      )}`,
    );
  }
  assertHostPhaseTransitionActionProof({
    proof: resolveProof,
    expectedGame,
    actionId: "resolve_phase",
    commandKind: "ResolvePhase",
    streamSeq: 905,
    expectedPhaseId: "N02",
    expectedPhaseState: "locked",
    expectedDeadlineAffordance: "unlock_thread,advance_phase",
    expectedRefreshKeys: ["host", "votecount", "dayVoteOutcomes", "hostPrompts"],
  });
  assertHostPhaseTransitionActionProof({
    proof: advanceProof,
    expectedGame,
    actionId: "advance_phase",
    commandKind: "AdvancePhase",
    streamSeq: 906,
    expectedPhaseId: "D03",
    expectedPhaseState: "open",
    expectedDeadlineAffordance: "resolve_phase,lock_thread",
    expectedRefreshKeys: [],
  });
  assertDayThreePlayerObservationProof({
    proof: actionPlayerObservationProof,
    expectedGame,
    sourceRoleUrl: hostNightActionTransitionSurface.sourceActionPlayerRoleUrl,
    expectedPrincipalUserId: "player_mira",
    expectedSlot: "slot-7",
    slotField: "actionPlayerSlot",
    expectedActorAlive: true,
    expectedActorStatus: "alive",
    expectedActionState: "disabled:no legal action available",
    expectedStatusText: "no legal action available",
    expectedPrivateCount: 0,
    expectedPrivateReceipt: false,
    expectedBoundaryText: "action player observed host AdvancePhase",
    expectedCommandStateEndpoint:
      `/games/${expectedGame}/player-command-state?principal_user_id=player_mira&slot_id=slot-7`,
    expectedNotificationsEndpoint:
      `/games/${expectedGame}/notifications?principal_user_id=player_mira`,
  });
  assertDayThreePlayerObservationProof({
    proof: nightTargetObservationProof,
    expectedGame,
    sourceRoleUrl: hostNightActionTransitionSurface.sourceNightTargetRoleUrl,
    expectedPrincipalUserId: "player-seed",
    expectedSlot: "slot-3",
    slotField: "targetSlot",
    expectedActorAlive: false,
    expectedActorStatus: "dead",
    expectedActionState: "disabled:actor is not alive",
    expectedStatusText: "actor is not alive",
    expectedPrivateCount: 1,
    expectedPrivateReceipt: true,
    expectedBoundaryText: "killed target stayed dead",
    expectedCommandStateEndpoint:
      `/games/${expectedGame}/player-command-state?principal_user_id=player-seed&slot_id=slot-3`,
    expectedNotificationsEndpoint:
      `/games/${expectedGame}/notifications?principal_user_id=player-seed`,
  });
  assertDayThreePlayerObservationProof({
    proof: normalObservationProof,
    expectedGame,
    sourceRoleUrl: hostNightActionTransitionSurface.sourceNormalRoleUrl,
    expectedPrincipalUserId: "player_rowan",
    expectedSlot: "slot-4",
    slotField: "normalSlot",
    expectedActorAlive: true,
    expectedActorStatus: "alive",
    expectedActionState: "disabled:no legal action available",
    expectedStatusText: "no legal action available",
    expectedPrivateCount: 0,
    expectedPrivateReceipt: false,
    expectedBoundaryText: "normal player observed open D03",
    expectedCommandStateEndpoint:
      `/games/${expectedGame}/player-command-state?principal_user_id=player_rowan&slot_id=slot-4`,
    expectedNotificationsEndpoint:
      `/games/${expectedGame}/notifications?principal_user_id=player_rowan`,
  });
}

function assertDayThreePlayerObservationProof({
  proof,
  sourceRoleUrl,
  expectedPrincipalUserId,
  expectedSlot,
  slotField,
  expectedActorAlive,
  expectedActorStatus,
  expectedActionState,
  expectedStatusText,
  expectedPrivateCount,
  expectedPrivateReceipt,
  expectedBoundaryText,
  expectedPhaseId,
  expectedPhaseState,
  expectedResyncFromSeq,
  expectedPrivateReceiptStatus,
  expectedPrivateReceiptPhaseId,
  expectedPrivateQueueBoundaryStatus,
  expectedCommandStateEndpoint,
  expectedNotificationsEndpoint,
}) {
  if (
    proof?.status !== "passed" ||
    proof.clickedThroughFromRoleUrl !== true ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.rawInviteTokensVisible !== false ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    typeof proof.visitedRolePath !== "string" ||
    !proof.visitedRolePath.includes("/g/") ||
    proof.surfaceTestId !== "player-surface" ||
    proof[slotField] !== expectedSlot ||
    proof.principalUserId !== expectedPrincipalUserId ||
    proof.checkpoint?.phaseId !== "D03" ||
    proof.checkpoint.phaseState !== "open" ||
    proof.checkpoint.actorSlot !== expectedSlot ||
    proof.checkpoint.actionState !== expectedActionState ||
    proof.checkpoint.receiptState !== "idle" ||
    !String(proof.checkpoint.statusText ?? "")
      .toLowerCase()
      .includes(expectedStatusText) ||
    proof.privateQueueBoundary?.status !==
      "principal-scoped-private-projections" ||
    proof.privateQueueBoundary.count !== expectedPrivateCount ||
    !String(proof.privateQueueBoundary.text ?? "").includes(
      "principal-scoped endpoints",
    ) ||
    proof.projectionCommandState?.actorSlot !== expectedSlot ||
    proof.projectionCommandState?.actorAlive !== expectedActorAlive ||
    proof.projectionCommandState?.actorStatus !== expectedActorStatus ||
    proof.projectionCommandState?.phase?.phaseId !== "D03" ||
    proof.projectionCommandState?.phase?.locked !== false ||
    proof.projectionCommandState?.actions?.length !== 0 ||
    !String(proof.projectionCommandState?.boundary ?? "").includes(
      expectedBoundaryText,
    ) ||
    proof.resyncFromSeq !== 906 ||
    proof.resyncSnapshotCommandState?.actorSlot !== expectedSlot ||
    proof.resyncSnapshotCommandState?.phase?.phaseId !== "D03" ||
    proof.coldLoadEndpoints?.notificationsEndpoint !==
      expectedNotificationsEndpoint ||
    proof.coldLoadEndpoints?.commandStateEndpoint !== expectedCommandStateEndpoint
  ) {
    throw new Error(
      `core-loop admin proof missing Day 3 role observation: ${JSON.stringify(
        proof,
      )}`,
    );
  }
  if (
    expectedPrivateReceipt &&
    (proof.privateNotice?.id !== "notification-1" ||
      proof.privateNotice.kind !== "notification" ||
      !String(proof.privateNotice.text ?? "").includes("player_killed") ||
      !String(proof.privateNotice.text ?? "").includes("factional_kill") ||
      proof.privateNotice.detailText !== "Phase N02" ||
      proof.projectionNotifications?.[0]?.effect !== "player_killed" ||
      proof.projectionNotifications?.[0]?.status !== "factional_kill" ||
      proof.resyncSnapshotNotifications?.[0]?.status !== "factional_kill")
  ) {
    throw new Error(
      `core-loop admin proof missing Day 3 target private receipt: ${JSON.stringify(
        proof,
      )}`,
    );
  }
  if (
    !expectedPrivateReceipt &&
    (!String(proof.privateEmptyText ?? "").includes("No private results visible") ||
      proof.projectionNotifications?.length !== 0 ||
      proof.resyncSnapshotNotifications?.length !== 0 ||
      proof.privateNotice !== undefined)
  ) {
    throw new Error(
      `core-loop admin proof leaked Day 3 target receipt: ${JSON.stringify(
        proof,
      )}`,
    );
  }
}

function assertDayThreeVoteResolutionSurface(dayThreeVoteResolutionSurface) {
  const expectedGame = gameFromRoleUrl(
    dayThreeVoteResolutionSurface?.sourceActionPlayerRoleUrl,
  );
  const playerVoteProof = dayThreeVoteResolutionSurface?.playerVoteProof;
  const hostResolutionProof = dayThreeVoteResolutionSurface?.hostResolutionProof;
  if (
    dayThreeVoteResolutionSurface?.status !== "passed" ||
    dayThreeVoteResolutionSurface.clickedThroughFromRoleUrl !== true ||
    dayThreeVoteResolutionSurface.releaseReady !== false ||
    dayThreeVoteResolutionSurface.productionReady !== false ||
    typeof dayThreeVoteResolutionSurface.sourceActionPlayerRoleUrl !== "string" ||
    !dayThreeVoteResolutionSurface.sourceActionPlayerRoleUrl.includes("/g/") ||
    typeof dayThreeVoteResolutionSurface.sourceHostRoleUrl !== "string" ||
    !dayThreeVoteResolutionSurface.sourceHostRoleUrl.includes("/g/") ||
    !dayThreeVoteResolutionSurface.sourceHostRoleUrl.endsWith("/host") ||
    !String(dayThreeVoteResolutionSurface.transition ?? "").includes(
      "player:submit_vote:ack:907",
    ) ||
    !String(dayThreeVoteResolutionSurface.transition ?? "").includes(
      "host:resolve_phase:ack:908",
    )
  ) {
    throw new Error(
      `core-loop admin proof missing Day 3 vote resolution surface: ${JSON.stringify(
        dayThreeVoteResolutionSurface,
      )}`,
    );
  }
  assertDayThreePlayerVoteProof({
    proof: playerVoteProof,
    expectedGame,
    sourceRoleUrl: dayThreeVoteResolutionSurface.sourceActionPlayerRoleUrl,
  });
  assertDayThreeHostVoteResolutionProof({
    proof: hostResolutionProof,
    expectedGame,
    sourceRoleUrl: dayThreeVoteResolutionSurface.sourceHostRoleUrl,
  });
}

function assertDayThreePlayerVoteProof({ proof, expectedGame, sourceRoleUrl }) {
  if (
    proof?.status !== "passed" ||
    proof.clickedThroughFromRoleUrl !== true ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.rawInviteTokensVisible !== false ||
    proof.targetOnlyReceiptVisible !== false ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    typeof proof.visitedRolePath !== "string" ||
    !proof.visitedRolePath.includes("/g/") ||
    proof.surfaceTestId !== "player-surface" ||
    proof.clickedAction !== "submit_vote" ||
    proof.commandKind !== "SubmitVote" ||
    proof.command?.game !== expectedGame ||
    proof.command.actor_slot !== "slot-7" ||
    proof.command.target?.Slot !== "slot-4" ||
    proof.commandStatus?.state !== "ack" ||
    !proof.commandStatus?.message?.includes("Ack: stream seqs 907") ||
    proof.bridgePlan?.role !== "player" ||
    proof.bridgePlan.commandKind !== "SubmitVote" ||
    proof.bridgePlan.commandEndpoint !== "/commands" ||
    proof.bridgePlan.finalState !== "ack" ||
    !sameStringArray(proof.bridgePlan.projectionRefreshKeys, [
      "votecount",
      "commandState",
    ]) ||
    proof.receipts?.at?.(-1)?.state !== "ack" ||
    proof.projectionCommandState?.actorSlot !== "slot-7" ||
    proof.projectionCommandState?.phase?.phaseId !== "D03" ||
    proof.projectionCommandState?.phase?.locked !== false ||
    proof.projectionCommandState?.currentVote?.slotId !== "slot-4" ||
    !String(proof.projectionCommandState?.boundary ?? "").includes(
      "Day 3 vote ACK",
    ) ||
    proof.projectionVotecount?.[0]?.target !== "slot-4 / Rowan" ||
    proof.projectionVotecount?.[0]?.count !== 2 ||
    proof.projectionVotecount?.[0]?.needed !== 2 ||
    proof.projectionDayVoteOutcomes?.[0]?.phaseId !== "D02" ||
    proof.setupResyncFromSeq !== 906 ||
    proof.setupSnapshotCommandState?.phase?.phaseId !== "D03" ||
    proof.currentVote?.hasVote !== "true" ||
    !String(proof.currentVote?.text ?? "").includes("Slot 4") ||
    proof.receiptCount !== 1 ||
    !String(proof.receiptStatusText ?? "")
      .toLowerCase()
      .includes("ack: stream seqs 907") ||
    proof.receiptRefreshKeys !== "votecount,commandState"
  ) {
    throw new Error(
      `core-loop admin proof missing Day 3 player vote ACK: ${JSON.stringify(
        proof,
      )}`,
    );
  }
}

function assertDayThreeHostVoteResolutionProof({
  proof,
  expectedGame,
  sourceRoleUrl,
}) {
  if (
    proof?.status !== "passed" ||
    proof.clickedThroughFromRoleUrl !== true ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.rawInviteTokensVisible !== false ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    typeof proof.visitedRolePath !== "string" ||
    !proof.visitedRolePath.endsWith("/host") ||
    proof.surfaceTestId !== "host-console-surface" ||
    proof.hostVotecountProjection?.[0]?.target !== "slot-4 / Rowan" ||
    proof.hostVotecountProjection?.[0]?.count !== 2 ||
    proof.hostVotecountProjection?.[0]?.needed !== 2 ||
    proof.hostDayVoteOutcomesProjection?.[1]?.phaseId !== "D03" ||
    proof.hostDayVoteOutcomesProjection?.[1]?.status !== "Lynch" ||
    proof.hostDayVoteOutcomesProjection?.[1]?.winnerSlot !== "slot-4"
  ) {
    throw new Error(
      `core-loop admin proof missing Day 3 host vote resolution surface: ${JSON.stringify(
        proof,
      )}`,
    );
  }
  assertHostPhaseTransitionActionProof({
    proof: proof.resolveProof,
    expectedGame,
    actionId: "resolve_phase",
    commandKind: "ResolvePhase",
    streamSeq: 908,
    expectedPhaseId: "D03",
    expectedPhaseState: "locked",
    expectedDeadlineAffordance: "unlock_thread,advance_phase",
    expectedRefreshKeys: ["host", "votecount", "dayVoteOutcomes", "hostPrompts"],
  });
  if (
    proof.resolveProof?.votecountProjection?.[0]?.target !== "slot-4 / Rowan" ||
    proof.resolveProof?.dayVoteOutcomesProjection?.[1]?.phaseId !== "D03"
  ) {
    throw new Error(
      `core-loop admin proof missing Day 3 host resolve projections: ${JSON.stringify(
        proof.resolveProof,
      )}`,
    );
  }
}

function assertPostDayThreeResolutionSurface(postDayThreeResolutionSurface) {
  const expectedGame = gameFromRoleUrl(
    postDayThreeResolutionSurface?.sourceHostRoleUrl,
  );
  const targetReceiptProof = postDayThreeResolutionSurface?.targetReceiptProof;
  const actionPlayerPrivacyProof =
    postDayThreeResolutionSurface?.actionPlayerPrivacyProof;
  const hostAdvanceProof = postDayThreeResolutionSurface?.hostAdvanceProof;
  const actionPlayerNightThreeProof =
    postDayThreeResolutionSurface?.actionPlayerNightThreeProof;
  if (
    postDayThreeResolutionSurface?.status !== "passed" ||
    postDayThreeResolutionSurface.clickedThroughFromRoleUrl !== true ||
    postDayThreeResolutionSurface.releaseReady !== false ||
    postDayThreeResolutionSurface.productionReady !== false ||
    typeof postDayThreeResolutionSurface.sourceHostRoleUrl !== "string" ||
    !postDayThreeResolutionSurface.sourceHostRoleUrl.endsWith("/host") ||
    typeof postDayThreeResolutionSurface.sourceActionPlayerRoleUrl !== "string" ||
    !postDayThreeResolutionSurface.sourceActionPlayerRoleUrl.includes("/g/") ||
    typeof postDayThreeResolutionSurface.sourceTargetRoleUrl !== "string" ||
    !postDayThreeResolutionSurface.sourceTargetRoleUrl.includes("/g/") ||
    !String(postDayThreeResolutionSurface.transition ?? "").includes(
      "target:D03:day_vote",
    ) ||
    !String(postDayThreeResolutionSurface.transition ?? "").includes(
      "host:advance_phase:ack:909",
    ) ||
    !String(postDayThreeResolutionSurface.transition ?? "").includes(
      "actionPlayer:N03",
    )
  ) {
    throw new Error(
      `core-loop admin proof missing post-Day 3 resolution surface: ${JSON.stringify(
        postDayThreeResolutionSurface,
      )}`,
    );
  }
  const targetReceiptScenario = privateReceiptScenario("d03-target-receipt");
  const actionPlayerPrivacyScenario = privateReceiptScenario(
    "d03-action-player-privacy",
  );
  assertPostDayThreePlayerSurfaceProof({
    proof: targetReceiptProof,
    ...privateReceiptAssertionArgs({
      scenario: targetReceiptScenario,
      expectedGame,
      sourceRoleUrl: postDayThreeResolutionSurface.sourceTargetRoleUrl,
    }),
  });
  assertPostDayThreePlayerSurfaceProof({
    proof: actionPlayerPrivacyProof,
    ...privateReceiptAssertionArgs({
      scenario: actionPlayerPrivacyScenario,
      expectedGame,
      sourceRoleUrl: postDayThreeResolutionSurface.sourceActionPlayerRoleUrl,
    }),
  });
  assertPostDayThreeHostAdvanceProof({
    proof: hostAdvanceProof,
    expectedGame,
    sourceRoleUrl: postDayThreeResolutionSurface.sourceHostRoleUrl,
  });
  assertPostDayThreePlayerSurfaceProof({
    proof: actionPlayerNightThreeProof,
    expectedGame,
    sourceRoleUrl: postDayThreeResolutionSurface.sourceActionPlayerRoleUrl,
    expectedSlot: "slot-7",
    slotField: "actionPlayerSlot",
    expectedPrincipalUserId: "player_mira",
    expectedPhaseId: "N03",
    expectedPhaseState: "open",
    expectedActorAlive: true,
    expectedActorStatus: "alive",
    expectedActionState: "disabled:no legal action available",
    expectedStatusText: "no legal action available",
    expectedPrivateCount: 0,
    expectedPrivateReceipt: false,
    expectedBoundaryText: "observed host AdvancePhase",
    expectedResyncFromSeq: 909,
    expectedCommandStateEndpoint:
      `/games/${expectedGame}/player-command-state?principal_user_id=player_mira&slot_id=slot-7`,
    expectedNotificationsEndpoint:
      `/games/${expectedGame}/notifications?principal_user_id=player_mira`,
  });
}

function assertNightThreeEmptyResolutionSurface(nightThreeEmptyResolutionSurface) {
  const expectedGame = gameFromRoleUrl(
    nightThreeEmptyResolutionSurface?.sourceHostRoleUrl,
  );
  if (
    nightThreeEmptyResolutionSurface?.status !== "passed" ||
    nightThreeEmptyResolutionSurface.clickedThroughFromRoleUrl !== true ||
    nightThreeEmptyResolutionSurface.releaseReady !== false ||
    nightThreeEmptyResolutionSurface.productionReady !== false ||
    typeof nightThreeEmptyResolutionSurface.sourceHostRoleUrl !== "string" ||
    !nightThreeEmptyResolutionSurface.sourceHostRoleUrl.endsWith("/host") ||
    typeof nightThreeEmptyResolutionSurface.sourceActionPlayerRoleUrl !==
      "string" ||
    !nightThreeEmptyResolutionSurface.sourceActionPlayerRoleUrl.includes("/g/") ||
    !String(nightThreeEmptyResolutionSurface.transition ?? "").includes(
      "actionPlayer:N03:no_action",
    ) ||
    !String(nightThreeEmptyResolutionSurface.transition ?? "").includes(
      "resolve_phase:ack:910",
    ) ||
    !String(nightThreeEmptyResolutionSurface.transition ?? "").includes(
      "advance_phase:ack:911",
    ) ||
    !String(nightThreeEmptyResolutionSurface.transition ?? "").includes(
      "actionPlayer:D04:no_lynch_vote",
    )
  ) {
    throw new Error(
      `core-loop admin proof missing empty Night 3 resolution surface: ${JSON.stringify(
        nightThreeEmptyResolutionSurface,
      )}`,
    );
  }
  assertPostDayThreePlayerSurfaceProof({
    proof: nightThreeEmptyResolutionSurface.actionPlayerNoActionProof,
    expectedGame,
    sourceRoleUrl: nightThreeEmptyResolutionSurface.sourceActionPlayerRoleUrl,
    expectedSlot: "slot-7",
    slotField: "actionPlayerSlot",
    expectedPrincipalUserId: "player_mira",
    expectedPhaseId: "N03",
    expectedPhaseState: "open",
    expectedActorAlive: true,
    expectedActorStatus: "alive",
    expectedActionState: "disabled:no legal action available",
    expectedStatusText: "no legal action available",
    expectedPrivateCount: 0,
    expectedPrivateReceipt: false,
    expectedBoundaryText: "opened N03 with no legal night action",
    expectedResyncFromSeq: 909,
    expectedCommandStateEndpoint:
      `/games/${expectedGame}/player-command-state?principal_user_id=player_mira&slot_id=slot-7`,
    expectedNotificationsEndpoint:
      `/games/${expectedGame}/notifications?principal_user_id=player_mira`,
  });
  assertNightThreeEmptyHostTransitionProof({
    proof: nightThreeEmptyResolutionSurface.hostTransitionProof,
    expectedGame,
    sourceRoleUrl: nightThreeEmptyResolutionSurface.sourceHostRoleUrl,
  });
  assertPostDayThreePlayerSurfaceProof({
    proof: nightThreeEmptyResolutionSurface.actionPlayerDayFourProof,
    expectedGame,
    sourceRoleUrl: nightThreeEmptyResolutionSurface.sourceActionPlayerRoleUrl,
    expectedSlot: "slot-7",
    slotField: "actionPlayerSlot",
    expectedPrincipalUserId: "player_mira",
    expectedPhaseId: "D04",
    expectedPhaseState: "open",
    expectedActorAlive: true,
    expectedActorStatus: "alive",
    expectedActionState: "disabled:no legal action available",
    expectedStatusText: "no legal action available",
    expectedPrivateCount: 0,
    expectedPrivateReceipt: false,
    expectedBoundaryText: "open D04 no-lynch voting",
    expectedResyncFromSeq: 911,
    expectedCommandStateEndpoint:
      `/games/${expectedGame}/player-command-state?principal_user_id=player_mira&slot_id=slot-7`,
    expectedNotificationsEndpoint:
      `/games/${expectedGame}/notifications?principal_user_id=player_mira`,
    expectedVoteButtonCount: 1,
    expectedVoteTargetCount: 1,
  });
}

function assertDayFourSurvivorRoleSurface(dayFourSurvivorRoleSurface) {
  const expectedGame = gameFromRoleUrl(dayFourSurvivorRoleSurface?.sourceRoleUrl);
  if (
    dayFourSurvivorRoleSurface?.status !== "passed" ||
    dayFourSurvivorRoleSurface.clickedThroughFromRoleUrl !== true ||
    dayFourSurvivorRoleSurface.releaseReady !== false ||
    dayFourSurvivorRoleSurface.productionReady !== false ||
    typeof dayFourSurvivorRoleSurface.sourceRoleUrl !== "string" ||
    !dayFourSurvivorRoleSurface.sourceRoleUrl.includes("/g/")
  ) {
    throw new Error(
      `core-loop admin proof missing Day 4 survivor role surface: ${JSON.stringify(
        dayFourSurvivorRoleSurface,
      )}`,
    );
  }
  assertPostDayThreePlayerSurfaceProof({
    proof: dayFourSurvivorRoleSurface.survivorProof,
    expectedGame,
    sourceRoleUrl: dayFourSurvivorRoleSurface.sourceRoleUrl,
    expectedSlot: "slot-5",
    slotField: "survivorSlot",
    expectedPrincipalUserId: "player_sage",
    expectedPhaseId: "D04",
    expectedPhaseState: "open",
    expectedActorAlive: true,
    expectedActorStatus: "alive",
    expectedActionState: "disabled:no legal action available",
    expectedStatusText: "no legal action available",
    expectedPrivateCount: 0,
    expectedPrivateReceipt: false,
    expectedBoundaryText: "survivor role opened D04",
    expectedResyncFromSeq: 911,
    expectedCommandStateEndpoint:
      `/games/${expectedGame}/player-command-state?principal_user_id=player_sage&slot_id=slot-5`,
    expectedNotificationsEndpoint:
      `/games/${expectedGame}/notifications?principal_user_id=player_sage`,
    expectedVoteButtonCount: 2,
    expectedVoteTargetCount: 2,
  });
}

function assertNightFourActionSubmissionSurface(nightFourActionSubmissionSurface) {
  const expectedGame = gameFromRoleUrl(
    nightFourActionSubmissionSurface?.sourceHostRoleUrl,
  );
  if (
    nightFourActionSubmissionSurface?.status !== "passed" ||
    nightFourActionSubmissionSurface.clickedThroughFromRoleUrl !== true ||
    nightFourActionSubmissionSurface.releaseReady !== false ||
    nightFourActionSubmissionSurface.productionReady !== false ||
    typeof nightFourActionSubmissionSurface.sourceHostRoleUrl !== "string" ||
    !nightFourActionSubmissionSurface.sourceHostRoleUrl.endsWith("/host") ||
    typeof nightFourActionSubmissionSurface.sourceActionPlayerRoleUrl !==
      "string" ||
    !nightFourActionSubmissionSurface.sourceActionPlayerRoleUrl.includes("/g/") ||
    !String(nightFourActionSubmissionSurface.transition ?? "").includes(
      "player:D04:no_lynch:ack:912",
    ) ||
    !String(nightFourActionSubmissionSurface.transition ?? "").includes(
      "host:D04:resolve_phase:ack:913",
    ) ||
    !String(nightFourActionSubmissionSurface.transition ?? "").includes(
      "host:advance_phase:ack:914",
    ) ||
    !String(nightFourActionSubmissionSurface.transition ?? "").includes(
      "player:N04:submit_action:slot-5:ack:915",
    )
  ) {
    throw new Error(
      `core-loop admin proof missing Night 4 action submission surface: ${JSON.stringify(
        nightFourActionSubmissionSurface,
      )}`,
    );
  }
  assertDayFourNoLynchVoteProof({
    proof: nightFourActionSubmissionSurface.dayFourVoteProof,
    expectedGame,
    sourceRoleUrl: nightFourActionSubmissionSurface.sourceActionPlayerRoleUrl,
  });
  assertDayFourNoLynchHostTransitionProof({
    proof: nightFourActionSubmissionSurface.hostTransitionProof,
    expectedGame,
    sourceRoleUrl: nightFourActionSubmissionSurface.sourceHostRoleUrl,
  });
  assertNightFourPlayerActionSubmissionProof({
    proof: nightFourActionSubmissionSurface.nightFourActionProof,
    expectedGame,
    sourceRoleUrl: nightFourActionSubmissionSurface.sourceActionPlayerRoleUrl,
  });
}

function assertNightFourResolutionReceiptSurface(
  nightFourResolutionReceiptSurface,
) {
  const expectedGame = gameFromRoleUrl(
    nightFourResolutionReceiptSurface?.sourceHostRoleUrl,
  );
  if (
    nightFourResolutionReceiptSurface?.status !== "passed" ||
    nightFourResolutionReceiptSurface.clickedThroughFromRoleUrl !== true ||
    nightFourResolutionReceiptSurface.releaseReady !== false ||
    nightFourResolutionReceiptSurface.productionReady !== false ||
    typeof nightFourResolutionReceiptSurface.sourceHostRoleUrl !== "string" ||
    !nightFourResolutionReceiptSurface.sourceHostRoleUrl.endsWith("/host") ||
    typeof nightFourResolutionReceiptSurface.sourceActionPlayerRoleUrl !==
      "string" ||
    !nightFourResolutionReceiptSurface.sourceActionPlayerRoleUrl.includes("/g/") ||
    typeof nightFourResolutionReceiptSurface.sourceSurvivorRoleUrl !== "string" ||
    !nightFourResolutionReceiptSurface.sourceSurvivorRoleUrl.includes("/g/") ||
    !String(nightFourResolutionReceiptSurface.transition ?? "").includes(
      "host:N04:resolve_phase:ack:916",
    ) ||
    !String(nightFourResolutionReceiptSurface.transition ?? "").includes(
      "survivor:N04:factional_kill_receipt",
    ) ||
    !String(nightFourResolutionReceiptSurface.transition ?? "").includes(
      "actionPlayer:N04:privacy",
    )
  ) {
    throw new Error(
      `core-loop admin proof missing Night 4 resolution receipt surface: ${JSON.stringify(
        nightFourResolutionReceiptSurface,
      )}`,
    );
  }
  const survivorReceiptScenario = privateReceiptScenario("n04-survivor-receipt");
  const actionPlayerPrivacyScenario = privateReceiptScenario(
    "n04-action-player-privacy",
  );
  assertNightFourHostResolutionProof({
    proof: nightFourResolutionReceiptSurface.hostResolutionProof,
    expectedGame,
    sourceRoleUrl: nightFourResolutionReceiptSurface.sourceHostRoleUrl,
  });
  assertNightFourResolutionPlayerSurfaceProof({
    proof: nightFourResolutionReceiptSurface.survivorReceiptProof,
    ...privateReceiptAssertionArgs({
      scenario: survivorReceiptScenario,
      expectedGame,
      sourceRoleUrl: nightFourResolutionReceiptSurface.sourceSurvivorRoleUrl,
    }),
  });
  assertNightFourResolutionPlayerSurfaceProof({
    proof: nightFourResolutionReceiptSurface.actionPlayerPrivacyProof,
    ...privateReceiptAssertionArgs({
      scenario: actionPlayerPrivacyScenario,
      expectedGame,
      sourceRoleUrl: nightFourResolutionReceiptSurface.sourceActionPlayerRoleUrl,
    }),
  });
}

function assertNightFourHostResolutionProof({
  proof,
  expectedGame,
  sourceRoleUrl,
}) {
  if (
    proof?.status !== "passed" ||
    proof.clickedThroughFromRoleUrl !== true ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.rawInviteTokensVisible !== false ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    typeof proof.visitedRolePath !== "string" ||
    !proof.visitedRolePath.endsWith("/host") ||
    proof.surfaceTestId !== "host-console-surface" ||
    proof.setupResyncFromSeq !== 915 ||
    proof.setupSnapshotHost?.phase?.id !== "N04" ||
    proof.setupSnapshotHost?.phase?.state !== "open"
  ) {
    throw new Error(
      `core-loop admin proof missing Night 4 host resolution: ${JSON.stringify(
        proof,
      )}`,
    );
  }
  assertHostPhaseTransitionActionProof({
    proof: proof.resolveProof,
    expectedGame,
    actionId: "resolve_phase",
    commandKind: "ResolvePhase",
    streamSeq: 916,
    expectedPhaseId: "N04",
    expectedPhaseState: "locked",
    expectedDeadlineAffordance: "unlock_thread,advance_phase",
    expectedRefreshKeys: ["host", "votecount", "dayVoteOutcomes", "hostPrompts"],
  });
}

function assertNightFourResolutionPlayerSurfaceProof({
  proof,
  sourceRoleUrl,
  expectedSlot,
  slotField,
  expectedPrincipalUserId,
  expectedActorAlive,
  expectedActorStatus,
  expectedActionState,
  expectedStatusText,
  expectedPrivateCount,
  expectedPrivateReceipt,
  expectedBoundaryText,
  expectedPhaseId,
  expectedPhaseState,
  expectedResyncFromSeq,
  expectedPrivateReceiptStatus,
  expectedPrivateReceiptPhaseId,
  expectedPrivateQueueBoundaryStatus,
  expectedCommandStateEndpoint,
  expectedNotificationsEndpoint,
}) {
  if (
    proof?.status !== "passed" ||
    proof.clickedThroughFromRoleUrl !== true ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.rawInviteTokensVisible !== false ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    typeof proof.visitedRolePath !== "string" ||
    !proof.visitedRolePath.includes("/g/") ||
    proof.surfaceTestId !== "player-surface" ||
    proof[slotField] !== expectedSlot ||
    proof.principalUserId !== expectedPrincipalUserId ||
    proof.checkpoint?.phaseId !== expectedPhaseId ||
    proof.checkpoint.phaseState !== expectedPhaseState ||
    proof.checkpoint.actorSlot !== expectedSlot ||
    proof.checkpoint.actionState !== expectedActionState ||
    proof.checkpoint.receiptState !== "idle" ||
    !String(proof.checkpoint.statusText ?? "")
      .toLowerCase()
      .includes(expectedStatusText) ||
    proof.privateQueueBoundary?.status !== expectedPrivateQueueBoundaryStatus ||
    proof.privateQueueBoundary.count !== expectedPrivateCount ||
    !String(proof.privateQueueBoundary.text ?? "").includes(
      "principal-scoped endpoints",
    ) ||
    proof.voteButtonCount !== 0 ||
    proof.projectionCommandState?.actorSlot !== expectedSlot ||
    proof.projectionCommandState?.actorAlive !== expectedActorAlive ||
    proof.projectionCommandState?.actorStatus !== expectedActorStatus ||
    proof.projectionCommandState?.phase?.phaseId !== expectedPhaseId ||
    proof.projectionCommandState?.phase?.locked !==
      (expectedPhaseState === "locked") ||
    proof.projectionCommandState?.actions?.length !== 0 ||
    proof.projectionCommandState?.voteTargets?.length !== 0 ||
    !String(proof.projectionCommandState?.boundary ?? "").includes(
      expectedBoundaryText,
    ) ||
    proof.projectionDayVoteOutcomes?.at?.(-1)?.phaseId !== "D04" ||
    proof.resyncFromSeq !== expectedResyncFromSeq ||
    proof.resyncSnapshotCommandState?.actorSlot !== expectedSlot ||
    proof.resyncSnapshotCommandState?.phase?.phaseId !== expectedPhaseId ||
    proof.coldLoadEndpoints?.notificationsEndpoint !==
      expectedNotificationsEndpoint ||
    proof.coldLoadEndpoints?.commandStateEndpoint !== expectedCommandStateEndpoint
  ) {
    throw new Error(
      `core-loop admin proof missing Night 4 player surface: ${JSON.stringify(
        proof,
      )}`,
    );
  }
  if (
    expectedPrivateReceipt &&
    (proof.privateNotice?.id !== "notification-1" ||
      proof.privateNotice.kind !== "notification" ||
      !String(proof.privateNotice.text ?? "").includes("player_killed") ||
      !String(proof.privateNotice.text ?? "").includes(
        expectedPrivateReceiptStatus,
      ) ||
      proof.privateNotice.detailText !==
        `Phase ${expectedPrivateReceiptPhaseId}` ||
      proof.projectionNotifications?.[0]?.effect !== "player_killed" ||
      proof.projectionNotifications?.[0]?.status !==
        expectedPrivateReceiptStatus ||
      proof.resyncSnapshotNotifications?.[0]?.status !==
        expectedPrivateReceiptStatus)
  ) {
    throw new Error(
      `core-loop admin proof missing Night 4 survivor receipt: ${JSON.stringify(
        proof,
      )}`,
    );
  }
  if (
    !expectedPrivateReceipt &&
    (!String(proof.privateEmptyText ?? "").includes("No private results visible") ||
      proof.projectionNotifications?.length !== 0 ||
      proof.resyncSnapshotNotifications?.length !== 0 ||
      proof.privateNotice !== undefined)
  ) {
    throw new Error(
      `core-loop admin proof leaked Night 4 target receipt: ${JSON.stringify(
        proof,
      )}`,
    );
  }
}

function assertPostNightFourTransitionSurface(postNightFourTransitionSurface) {
  const expectedGame = gameFromRoleUrl(
    postNightFourTransitionSurface?.sourceHostRoleUrl,
  );
  if (
    postNightFourTransitionSurface?.status !== "passed" ||
    postNightFourTransitionSurface.clickedThroughFromRoleUrl !== true ||
    postNightFourTransitionSurface.releaseReady !== false ||
    postNightFourTransitionSurface.productionReady !== false ||
    typeof postNightFourTransitionSurface.sourceHostRoleUrl !== "string" ||
    !postNightFourTransitionSurface.sourceHostRoleUrl.endsWith("/host") ||
    typeof postNightFourTransitionSurface.sourceActionPlayerRoleUrl !==
      "string" ||
    !postNightFourTransitionSurface.sourceActionPlayerRoleUrl.includes("/g/") ||
    typeof postNightFourTransitionSurface.sourceSurvivorRoleUrl !== "string" ||
    !postNightFourTransitionSurface.sourceSurvivorRoleUrl.includes("/g/") ||
    !String(postNightFourTransitionSurface.transition ?? "").includes(
      "host:N04:advance_phase:ack:917",
    ) ||
    !String(postNightFourTransitionSurface.transition ?? "").includes(
      "survivor:D05:dead_no_controls",
    ) ||
    !String(postNightFourTransitionSurface.transition ?? "").includes(
      "actionPlayer:D05:no_lynch_controls",
    ) ||
    !String(postNightFourTransitionSurface.transition ?? "").includes(
      "stale:N04:submit_action:reject:PhaseLocked",
    )
  ) {
    throw new Error(
      `core-loop admin proof missing post-Night 4 transition surface: ${JSON.stringify(
        postNightFourTransitionSurface,
      )}`,
    );
  }
  assertPostNightFourHostAdvanceProof({
    proof: postNightFourTransitionSurface.hostAdvanceProof,
    expectedGame,
    sourceRoleUrl: postNightFourTransitionSurface.sourceHostRoleUrl,
  });
  assertPostDayThreePlayerSurfaceProof({
    proof: postNightFourTransitionSurface.survivorDayFiveProof,
    expectedGame,
    sourceRoleUrl: postNightFourTransitionSurface.sourceSurvivorRoleUrl,
    expectedSlot: "slot-5",
    slotField: "survivorSlot",
    expectedPrincipalUserId: "player_sage",
    expectedPhaseId: "D05",
    expectedPhaseState: "open",
    expectedActorAlive: false,
    expectedActorStatus: "dead",
    expectedActionState: "disabled:actor is not alive",
    expectedStatusText: "actor is not alive",
    expectedPrivateCount: 1,
    expectedPrivateReceipt: true,
    expectedBoundaryText: "survivor stayed dead with no controls",
    expectedResyncFromSeq: 917,
    expectedCommandStateEndpoint:
      `/games/${expectedGame}/player-command-state?principal_user_id=player_sage&slot_id=slot-5`,
    expectedNotificationsEndpoint:
      `/games/${expectedGame}/notifications?principal_user_id=player_sage`,
    expectedLastVoteOutcomePhaseId: "D04",
    expectedPrivateReceiptStatus: "factional_kill",
    expectedPrivateReceiptPhaseId: "N04",
  });
  assertPostDayThreePlayerSurfaceProof({
    proof: postNightFourTransitionSurface.actionPlayerDayFiveProof,
    expectedGame,
    sourceRoleUrl: postNightFourTransitionSurface.sourceActionPlayerRoleUrl,
    expectedSlot: "slot-7",
    slotField: "actionPlayerSlot",
    expectedPrincipalUserId: "player_mira",
    expectedPhaseId: "D05",
    expectedPhaseState: "open",
    expectedActorAlive: true,
    expectedActorStatus: "alive",
    expectedActionState: "disabled:no legal action available",
    expectedStatusText: "no legal action available",
    expectedPrivateCount: 0,
    expectedPrivateReceipt: false,
    expectedBoundaryText: "open Day 5 no-lynch controls",
    expectedResyncFromSeq: 917,
    expectedCommandStateEndpoint:
      `/games/${expectedGame}/player-command-state?principal_user_id=player_mira&slot_id=slot-7`,
    expectedNotificationsEndpoint:
      `/games/${expectedGame}/notifications?principal_user_id=player_mira`,
    expectedVoteButtonCount: 1,
    expectedVoteTargetCount: 1,
    expectedLastVoteOutcomePhaseId: "D04",
  });
  assertStaleNightFourActionRecoveryProof({
    proof: postNightFourTransitionSurface.staleNightFourActionRecoveryProof,
    expectedGame,
    sourceRoleUrl: postNightFourTransitionSurface.sourceActionPlayerRoleUrl,
  });
}

function assertPostNightFourHostAdvanceProof({
  proof,
  expectedGame,
  sourceRoleUrl,
}) {
  if (
    proof?.status !== "passed" ||
    proof.clickedThroughFromRoleUrl !== true ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.rawInviteTokensVisible !== false ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    typeof proof.visitedRolePath !== "string" ||
    !proof.visitedRolePath.endsWith("/host") ||
    proof.surfaceTestId !== "host-console-surface" ||
    proof.setupResyncFromSeq !== 916 ||
    proof.setupSnapshotHost?.phase?.id !== "N04" ||
    proof.setupSnapshotHost?.phase?.state !== "locked"
  ) {
    throw new Error(
      `core-loop admin proof missing post-Night 4 host advance: ${JSON.stringify(
        proof,
      )}`,
    );
  }
  assertHostPhaseTransitionActionProof({
    proof: proof.advanceProof,
    expectedGame,
    actionId: "advance_phase",
    commandKind: "AdvancePhase",
    streamSeq: 917,
    expectedPhaseId: "D05",
    expectedPhaseState: "open",
    expectedDeadlineAffordance: "resolve_phase,lock_thread",
    expectedRefreshKeys: [],
  });
  if (proof.advanceProof?.dayVoteOutcomesProjection?.at?.(-1)?.phaseId !== "D04") {
    throw new Error(
      `core-loop admin proof missing post-Night 4 host outcome context: ${JSON.stringify(
        proof.advanceProof,
      )}`,
    );
  }
}

function assertStaleNightFourActionRecoveryProof({
  proof,
  expectedGame,
  sourceRoleUrl,
}) {
  const scenario = staleNightFourActionRecoveryScenario();
  if (
    proof?.status !== "passed" ||
    proof.clickedThroughFromRoleUrl !== true ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.rawInviteTokensVisible !== false ||
    proof.targetOnlyReceiptVisible !== false ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    typeof proof.visitedRolePath !== "string" ||
    !proof.visitedRolePath.includes("/g/") ||
    proof.surfaceTestId !== "player-surface" ||
    proof.clickedAction !== scenario.clickedAction ||
    proof.commandKind !== scenario.commandKind ||
    proof.setupResyncFromSeq !== scenario.setupResyncFromSeq ||
    proof.setupSnapshotCommandState?.phase?.phaseId !== scenario.setupPhaseId ||
    proof.setupSnapshotCommandState?.actions?.[0]?.targets?.[0] !==
      scenario.targetSlot ||
    proof.command?.game !== expectedGame ||
    proof.command.actor_slot !== scenario.actorSlot ||
    proof.command.action_id !== scenario.actionId ||
    proof.command.template_id !== scenario.templateId ||
    proof.command.targets?.[0] !== scenario.targetSlot ||
    proof.command.grant_id !== scenario.grantId ||
    proof.commandStatus?.state !== scenario.finalState ||
    proof.commandStatus.error !== scenario.error ||
    !String(proof.commandStatus.message ?? "").includes(
      scenario.messageIncludes,
    ) ||
    proof.bridgePlan?.role !== "player" ||
    proof.bridgePlan.commandKind !== scenario.commandKind ||
    proof.bridgePlan.commandEndpoint !== "/commands" ||
    proof.bridgePlan.finalState !== scenario.finalState ||
    !sameStringArray(
      proof.bridgePlan.projectionRefreshKeys,
      scenario.expectedRefreshKeys,
    ) ||
    proof.receipts?.at?.(-1)?.state !== scenario.finalState ||
    proof.projectionCommandState?.actorSlot !== scenario.actorSlot ||
    proof.projectionCommandState?.phase?.phaseId !== scenario.refreshedPhaseId ||
    proof.projectionCommandState?.phase?.locked !== false ||
    proof.projectionCommandState?.actions?.length !== 0 ||
    proof.projectionCommandState?.voteTargets?.[0]?.kind !== "no_lynch" ||
    !String(proof.projectionCommandState?.boundary ?? "").includes(
      scenario.refreshedBoundary,
    ) ||
    proof.checkpointReceiptState !== scenario.checkpointReceiptState ||
    proof.checkpointPhaseIdAfterReject !== scenario.refreshedPhaseId ||
    proof.checkpointActionStateAfterReject !==
      scenario.checkpointActionState ||
    proof.checkpointTargetSlotsAfterReject !== scenario.checkpointTargetSlots ||
    !String(proof.recoveryText ?? "").includes(`Reject ${scenario.error}`) ||
    !String(proof.recoveryText ?? "").includes("refresh") ||
    proof.receiptCount !== 1 ||
    !String(proof.receiptStatusText ?? "")
      .toLowerCase()
      .includes(`reject ${scenario.error.toLowerCase()}`)
  ) {
    throw new Error(
      `core-loop admin proof missing stale Night 4 action recovery: ${JSON.stringify(
        proof,
      )}`,
    );
  }
}

function assertDayFiveNoLynchResolutionSurface(dayFiveNoLynchResolutionSurface) {
  const expectedGame = gameFromRoleUrl(
    dayFiveNoLynchResolutionSurface?.sourceHostRoleUrl,
  );
  if (
    dayFiveNoLynchResolutionSurface?.status !== "passed" ||
    dayFiveNoLynchResolutionSurface.clickedThroughFromRoleUrl !== true ||
    dayFiveNoLynchResolutionSurface.releaseReady !== false ||
    dayFiveNoLynchResolutionSurface.productionReady !== false ||
    typeof dayFiveNoLynchResolutionSurface.sourceHostRoleUrl !== "string" ||
    !dayFiveNoLynchResolutionSurface.sourceHostRoleUrl.endsWith("/host") ||
    typeof dayFiveNoLynchResolutionSurface.sourceActionPlayerRoleUrl !==
      "string" ||
    !dayFiveNoLynchResolutionSurface.sourceActionPlayerRoleUrl.includes("/g/") ||
    !String(dayFiveNoLynchResolutionSurface.transition ?? "").includes(
      "player:D05:no_lynch:ack:918",
    ) ||
    !String(dayFiveNoLynchResolutionSurface.transition ?? "").includes(
      "host:D05:resolve_phase:ack:919",
    ) ||
    !String(dayFiveNoLynchResolutionSurface.transition ?? "").includes(
      "host:advance_phase:ack:920",
    ) ||
    !String(dayFiveNoLynchResolutionSurface.transition ?? "").includes(
      "actionPlayer:N05:no_action",
    ) ||
    !String(dayFiveNoLynchResolutionSurface.transition ?? "").includes(
      "stale:D05:submit_vote:reject:PhaseLocked",
    )
  ) {
    throw new Error(
      `core-loop admin proof missing Day 5 no-lynch resolution surface: ${JSON.stringify(
        dayFiveNoLynchResolutionSurface,
      )}`,
    );
  }
  assertDayFiveNoLynchVoteProof({
    proof: dayFiveNoLynchResolutionSurface.dayFiveVoteProof,
    expectedGame,
    sourceRoleUrl: dayFiveNoLynchResolutionSurface.sourceActionPlayerRoleUrl,
  });
  assertDayFiveNoLynchHostTransitionProof({
    proof: dayFiveNoLynchResolutionSurface.hostTransitionProof,
    expectedGame,
    sourceRoleUrl: dayFiveNoLynchResolutionSurface.sourceHostRoleUrl,
  });
  assertPostDayThreePlayerSurfaceProof({
    proof: dayFiveNoLynchResolutionSurface.actionPlayerNightFiveProof,
    expectedGame,
    sourceRoleUrl: dayFiveNoLynchResolutionSurface.sourceActionPlayerRoleUrl,
    expectedSlot: "slot-7",
    slotField: "actionPlayerSlot",
    expectedPrincipalUserId: "player_mira",
    expectedPhaseId: "N05",
    expectedPhaseState: "open",
    expectedActorAlive: true,
    expectedActorStatus: "alive",
    expectedActionState: "disabled:no legal action available",
    expectedStatusText: "no legal action available",
    expectedPrivateCount: 0,
    expectedPrivateReceipt: false,
    expectedBoundaryText: "open Night 5 with no legal action",
    expectedResyncFromSeq: 920,
    expectedCommandStateEndpoint:
      `/games/${expectedGame}/player-command-state?principal_user_id=player_mira&slot_id=slot-7`,
    expectedNotificationsEndpoint:
      `/games/${expectedGame}/notifications?principal_user_id=player_mira`,
    expectedLastVoteOutcomePhaseId: "D05",
  });
  assertStaleDayFiveVoteRecoveryProof({
    proof: dayFiveNoLynchResolutionSurface.staleDayFiveVoteRecoveryProof,
    expectedGame,
    sourceRoleUrl: dayFiveNoLynchResolutionSurface.sourceActionPlayerRoleUrl,
  });
}

function assertDayFiveNoLynchVoteProof({ proof, expectedGame, sourceRoleUrl }) {
  if (
    proof?.status !== "passed" ||
    proof.clickedThroughFromRoleUrl !== true ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.rawInviteTokensVisible !== false ||
    proof.targetOnlyReceiptVisible !== false ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    typeof proof.visitedRolePath !== "string" ||
    !proof.visitedRolePath.includes("/g/") ||
    proof.surfaceTestId !== "player-surface" ||
    proof.clickedAction !== "submit_vote:no_lynch" ||
    proof.commandKind !== "SubmitVote" ||
    proof.command?.game !== expectedGame ||
    proof.command.actor_slot !== "slot-7" ||
    proof.command.target !== "NoLynch" ||
    proof.commandStatus?.state !== "ack" ||
    !proof.commandStatus?.message?.includes("Ack: stream seqs 918") ||
    proof.bridgePlan?.role !== "player" ||
    proof.bridgePlan.commandKind !== "SubmitVote" ||
    proof.bridgePlan.commandEndpoint !== "/commands" ||
    proof.bridgePlan.finalState !== "ack" ||
    !sameStringArray(proof.bridgePlan.projectionRefreshKeys, [
      "votecount",
      "commandState",
    ]) ||
    proof.receipts?.at?.(-1)?.state !== "ack" ||
    proof.projectionCommandState?.actorSlot !== "slot-7" ||
    proof.projectionCommandState?.phase?.phaseId !== "D05" ||
    proof.projectionCommandState?.phase?.locked !== false ||
    proof.projectionCommandState?.currentVote?.kind !== "no_lynch" ||
    !String(proof.projectionCommandState?.boundary ?? "").includes(
      "Day 5 no-lynch vote ACK",
    ) ||
    proof.projectionVotecount?.[0]?.target !== "No lynch" ||
    proof.projectionVotecount?.[0]?.count !== 1 ||
    proof.projectionVotecount?.[0]?.needed !== 1 ||
    proof.projectionDayVoteOutcomes?.at?.(-1)?.phaseId !== "D04" ||
    proof.setupResyncFromSeq !== 917 ||
    proof.setupSnapshotCommandState?.phase?.phaseId !== "D05" ||
    proof.currentVote?.hasVote !== "true" ||
    !String(proof.currentVote?.text ?? "").includes("No lynch") ||
    proof.receiptCount !== 1 ||
    !String(proof.receiptStatusText ?? "")
      .toLowerCase()
      .includes("ack: stream seqs 918") ||
    proof.receiptRefreshKeys !== "votecount,commandState"
  ) {
    throw new Error(
      `core-loop admin proof missing Day 5 no-lynch vote ACK: ${JSON.stringify(
        proof,
      )}`,
    );
  }
}

function assertDayFiveNoLynchHostTransitionProof({
  proof,
  expectedGame,
  sourceRoleUrl,
}) {
  if (
    proof?.status !== "passed" ||
    proof.clickedThroughFromRoleUrl !== true ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.rawInviteTokensVisible !== false ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    typeof proof.visitedRolePath !== "string" ||
    !proof.visitedRolePath.endsWith("/host") ||
    proof.surfaceTestId !== "host-console-surface" ||
    proof.setupResyncFromSeq !== 918 ||
    proof.setupSnapshotHost?.phase?.id !== "D05" ||
    proof.setupSnapshotHost?.phase?.state !== "open"
  ) {
    throw new Error(
      `core-loop admin proof missing Day 5 no-lynch host transition: ${JSON.stringify(
        proof,
      )}`,
    );
  }
  assertHostPhaseTransitionActionProof({
    proof: proof.resolveProof,
    expectedGame,
    actionId: "resolve_phase",
    commandKind: "ResolvePhase",
    streamSeq: 919,
    expectedPhaseId: "D05",
    expectedPhaseState: "locked",
    expectedDeadlineAffordance: "unlock_thread,advance_phase",
    expectedRefreshKeys: ["host", "votecount", "dayVoteOutcomes", "hostPrompts"],
  });
  assertHostPhaseTransitionActionProof({
    proof: proof.advanceProof,
    expectedGame,
    actionId: "advance_phase",
    commandKind: "AdvancePhase",
    streamSeq: 920,
    expectedPhaseId: "N05",
    expectedPhaseState: "open",
    expectedDeadlineAffordance: "resolve_phase,lock_thread",
    expectedRefreshKeys: [],
  });
  if (
    proof.resolveProof?.votecountProjection?.[0]?.target !== "No lynch" ||
    proof.resolveProof?.dayVoteOutcomesProjection?.at?.(-1)?.phaseId !== "D05" ||
    proof.resolveProof?.dayVoteOutcomesProjection?.at?.(-1)?.status !==
      "NoLynch"
  ) {
    throw new Error(
      `core-loop admin proof missing Day 5 no-lynch host projections: ${JSON.stringify(
        proof.resolveProof,
      )}`,
    );
  }
}

function assertStaleDayFiveVoteRecoveryProof({
  proof,
  expectedGame,
  sourceRoleUrl,
}) {
  if (
    proof?.status !== "passed" ||
    proof.clickedThroughFromRoleUrl !== true ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.rawInviteTokensVisible !== false ||
    proof.targetOnlyReceiptVisible !== false ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    typeof proof.visitedRolePath !== "string" ||
    !proof.visitedRolePath.includes("/g/") ||
    proof.surfaceTestId !== "player-surface" ||
    proof.clickedAction !== "submit_vote:no_lynch" ||
    proof.commandKind !== "SubmitVote" ||
    proof.setupResyncFromSeq !== 918 ||
    proof.setupSnapshotCommandState?.phase?.phaseId !== "D05" ||
    proof.setupSnapshotCommandState?.voteTargets?.[0]?.kind !== "no_lynch" ||
    proof.command?.game !== expectedGame ||
    proof.command.actor_slot !== "slot-7" ||
    proof.command.target !== "NoLynch" ||
    proof.commandStatus?.state !== "reject" ||
    proof.commandStatus.error !== "PhaseLocked" ||
    !String(proof.commandStatus.message ?? "").includes(
      "stale vote state, refresh and use current vote controls",
    ) ||
    proof.bridgePlan?.role !== "player" ||
    proof.bridgePlan.commandKind !== "SubmitVote" ||
    proof.bridgePlan.commandEndpoint !== "/commands" ||
    proof.bridgePlan.finalState !== "reject" ||
    !sameStringArray(proof.bridgePlan.projectionRefreshKeys, [
      "votecount",
      "commandState",
      "dayVoteOutcomes",
    ]) ||
    proof.receipts?.at?.(-1)?.state !== "reject" ||
    proof.projectionCommandState?.actorSlot !== "slot-7" ||
    proof.projectionCommandState?.phase?.phaseId !== "N05" ||
    proof.projectionCommandState?.phase?.locked !== false ||
    proof.projectionCommandState?.actions?.length !== 0 ||
    proof.projectionCommandState?.voteTargets?.length !== 0 ||
    !String(proof.projectionCommandState?.boundary ?? "").includes(
      "stale D05 vote refreshed into current Night 5 controls",
    ) ||
    proof.checkpointReceiptState !== "reject:PhaseLocked" ||
    proof.checkpointPhaseIdAfterReject !== "N05" ||
    proof.checkpointActionStateAfterReject !==
      "disabled:no legal action available" ||
    proof.checkpointTargetSlotsAfterReject !== "" ||
    !String(proof.recoveryText ?? "").includes("Reject PhaseLocked") ||
    !String(proof.recoveryText ?? "").includes("refresh") ||
    proof.receiptCount !== 1 ||
    !String(proof.receiptStatusText ?? "")
      .toLowerCase()
      .includes("reject phaselocked")
  ) {
    throw new Error(
      `core-loop admin proof missing stale Day 5 vote recovery: ${JSON.stringify(
        proof,
      )}`,
    );
  }
}

function assertCompletedGameEndgameSurface(completedGameEndgameSurface) {
  const expectedGame = gameFromRoleUrl(
    completedGameEndgameSurface?.sourceHostRoleUrl,
  );
  if (
    completedGameEndgameSurface?.status !== "passed" ||
    completedGameEndgameSurface.clickedThroughFromRoleUrl !== true ||
    completedGameEndgameSurface.releaseReady !== false ||
    completedGameEndgameSurface.productionReady !== false ||
    typeof completedGameEndgameSurface.sourceHostRoleUrl !== "string" ||
    !completedGameEndgameSurface.sourceHostRoleUrl.endsWith("/host") ||
    typeof completedGameEndgameSurface.sourceActionPlayerRoleUrl !== "string" ||
    !completedGameEndgameSurface.sourceActionPlayerRoleUrl.includes("/g/") ||
    typeof completedGameEndgameSurface.sourceNormalPlayerRoleUrl !== "string" ||
    !completedGameEndgameSurface.sourceNormalPlayerRoleUrl.includes("/g/") ||
    typeof completedGameEndgameSurface.sourceDeadPlayerRoleUrl !== "string" ||
    !completedGameEndgameSurface.sourceDeadPlayerRoleUrl.includes("/g/")
  ) {
    throw new Error(
      `core-loop admin proof missing completed-game endgame surface: ${JSON.stringify(
        completedGameEndgameSurface,
      )}`,
    );
  }
  assertCompletedGameEndgameTransition({
    transition: completedGameEndgameSurface.transition,
    failureMessage:
      "core-loop admin proof missing completed-game endgame transition",
  });
  assertCompletedGameEndgameSurfaceAssertionCases({
    completedGameEndgameSurface,
    includeEvidenceInError: true,
    cases: completedGameEndgameSurfaceAssertionCases({
      completedGameEndgameSurface,
      expectedGame,
      assertHostCompleteGameProof,
      assertCompletedHostReloadProof,
      assertActionPlayerCompletedProof: assertPostDayThreePlayerSurfaceProof,
      assertCompletedHostStaleCommandRecoveryProof,
      assertCompletedDeadPlayerStaleVoteRecoveryProof,
      assertCompletedPlayerReloadProof,
      assertStaleCompletedGamePlayerCommandRecoveryProof,
    }),
  });
}

function assertHostCompleteGameProof({ proof, expectedGame, sourceRoleUrl }) {
  if (
    proof?.status !== "passed" ||
    proof.clickedThroughFromRoleUrl !== true ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.rawInviteTokensVisible !== false ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    typeof proof.visitedRolePath !== "string" ||
    !proof.visitedRolePath.endsWith("/host") ||
    proof.surfaceTestId !== "host-console-surface" ||
    proof.setupResyncFromSeq !== 920 ||
    proof.setupSnapshotHost?.phase?.id !== "N05" ||
    proof.setupSnapshotHost?.phase?.state !== "open" ||
    proof.setupSnapshotHost?.completed !== false
  ) {
    throw new Error(
      `core-loop admin proof missing host complete-game setup: ${JSON.stringify(
        proof,
      )}`,
    );
  }
  assertHostPhaseTransitionActionProof({
    proof: proof.completeProof,
    expectedGame,
    actionId: "complete_game",
    commandKind: "CompleteGame",
    streamSeq: 921,
    expectedPhaseId: "N05",
    expectedPhaseState: "open",
    expectedDeadlineAffordance: "none",
    expectedRefreshKeys: [],
  });
  if (
    proof.completeProof?.projection?.completed !== true ||
    proof.completeProof?.projection?.slots?.[0]?.role_revealed !== true ||
    proof.completeProof?.projection?.slots?.[0]?.alignment_revealed !== true
  ) {
    throw new Error(
      `core-loop admin proof missing completed host projection: ${JSON.stringify(
        proof.completeProof,
      )}`,
    );
  }
}

function assertCompletedHostReloadProof({ proof, sourceRoleUrl }) {
  if (
    proof?.status !== "passed" ||
    proof.clickedThroughFromRoleUrl !== true ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.rawInviteTokensVisible !== false ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    typeof proof.visitedRolePath !== "string" ||
    !proof.visitedRolePath.endsWith("/host") ||
    proof.surfaceTestId !== "host-console-surface" ||
    proof.resyncFromSeq !== 921 ||
    proof.initialResyncSnapshotHost?.completed !== true ||
    proof.reloadedResyncSnapshotHost?.completed !== true
  ) {
    throw new Error(
      `core-loop admin proof missing completed host reload shell: ${JSON.stringify(
        proof,
      )}`,
    );
  }
  for (const [label, snapshot] of [
    ["initial", proof.initialSnapshot],
    ["reloaded", proof.reloadedSnapshot],
  ]) {
    if (
      snapshot?.checkpoint?.phaseId !== "N05" ||
      snapshot.checkpoint.phaseState !== "open" ||
      snapshot.checkpoint.deadlineAffordance !== "none" ||
      !String(snapshot.checkpoint.actionState ?? "").startsWith("disabled:") ||
      snapshot.projection?.completed !== true ||
      snapshot.projection?.phase?.id !== "N05" ||
      snapshot.projection?.phase?.state !== "open" ||
      snapshot.projection?.slots?.[0]?.role_revealed !== true ||
      snapshot.projection?.slots?.[0]?.alignment_revealed !== true ||
      snapshot.projection?.slots?.[1]?.role_revealed !== true ||
      snapshot.projection?.slots?.[1]?.alignment_revealed !== true ||
      snapshot.dayVoteOutcomes?.at?.(-1)?.phaseId !== "D05" ||
      snapshot.hostPrompts?.length !== 0 ||
      snapshot.actionTiles?.length !== 0 ||
      snapshot.triggerButtons?.length !== 0
    ) {
      throw new Error(
        `core-loop admin proof missing ${label} completed host reload closure: ${JSON.stringify(
          snapshot,
        )}`,
      );
    }
  }
}

function assertCompletedHostStaleCommandRecoveryProof({
  proof,
  expectedGame,
  sourceRoleUrl,
  expectedCommandKind,
}) {
  assertCompletedHostStaleCommandRecoveryProofCase({
    proof,
    expectedGame,
    sourceRoleUrl,
    expectedCommandKind,
    includeEvidenceInError: true,
  });
}

function assertCompletedPlayerReloadProof({
  proof,
  sourceRoleUrl,
  expectedSlot,
  expectedBoundaryText,
  expectedCommandStateEndpoint,
  expectedNotificationsEndpoint,
}) {
  assertCompletedPlayerReloadProofCase({
    proof,
    sourceRoleUrl,
    expectedSlot,
    expectedBoundaryText,
    expectedCommandStateEndpoint,
    expectedNotificationsEndpoint,
    includeEvidenceInError: true,
  });
}

function assertCompletedDeadPlayerStaleVoteRecoveryProof({
  proof,
  expectedGame,
  sourceRoleUrl,
}) {
  const snapshot = proof?.recoverySnapshot;
  if (
    proof?.status !== "passed" ||
    proof.clickedThroughFromRoleUrl !== true ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.rawInviteTokensVisible !== false ||
    proof.targetOnlyActionVisible !== false ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    typeof proof.visitedRolePath !== "string" ||
    !proof.visitedRolePath.includes("/g/") ||
    proof.surfaceTestId !== "player-surface" ||
    proof.commandEndpoint !== "/commands" ||
    proof.commandKind !== "SubmitVote" ||
    proof.command?.game !== expectedGame ||
    proof.command.actor_slot !== "slot-2" ||
    proof.command.target !== "NoLynch" ||
    proof.commandResponse?.ok !== false ||
    proof.commandResponse?.status !== 409 ||
    proof.commandResponse?.body?.body?.kind !== "Reject" ||
    proof.commandResponse?.body?.body?.body?.error !== "GameAlreadyCompleted" ||
    !String(proof.commandResponse?.body?.body?.body?.message ?? "").includes(
      "Reject GameAlreadyCompleted: game already completed",
    ) ||
    proof.setupResyncFromSeq !== 921 ||
    proof.setupResyncSnapshotCommandState?.actorSlot !== "slot-2" ||
    proof.setupResyncSnapshotCommandState?.gameCompleted !== true ||
    proof.recoveryResyncFromSeq !== 921 ||
    proof.recoveryResyncSnapshotCommandState?.actorSlot !== "slot-2" ||
    proof.recoveryResyncSnapshotCommandState?.gameCompleted !== true ||
    snapshot?.checkpoint?.phaseId !== "N05" ||
    snapshot.checkpoint.phaseState !== "open" ||
    snapshot.checkpoint.actorSlot !== "slot-2" ||
    snapshot.checkpoint.actionState !== "disabled:game complete" ||
    snapshot.checkpoint.receiptState !== "idle" ||
    snapshot.commandState?.actorSlot !== "slot-2" ||
    snapshot.commandState?.actorAlive !== false ||
    snapshot.commandState?.actorStatus !== "dead" ||
    snapshot.commandState?.phase?.phaseId !== "N05" ||
    snapshot.commandState?.gameCompleted !== true ||
    snapshot.commandState?.actions?.length !== 0 ||
    snapshot.commandState?.voteTargets?.length !== 0 ||
    !String(snapshot.commandState?.boundary ?? "").includes(
      "completed dead-player stale vote rejected",
    ) ||
    snapshot.coldLoadEndpoints?.commandStateEndpoint !==
      `/games/${expectedGame}/player-command-state?principal_user_id=player_ilya&slot_id=slot-2` ||
    snapshot.coldLoadEndpoints?.notificationsEndpoint !==
      `/games/${expectedGame}/notifications?principal_user_id=player_ilya` ||
    snapshot.enabledMutatingButtons?.length !== 0
  ) {
    throw new Error(
      `core-loop admin proof missing completed dead-player stale vote recovery: ${JSON.stringify(
        proof,
      )}`,
    );
  }
}

function assertStaleCompletedGamePlayerCommandRecoveryProof({
  proof,
  expectedGame,
  sourceRoleUrl,
  scenario,
}) {
  assertStaleCompletedGamePlayerCommandRecoveryProofCase({
    proof,
    expectedGame,
    sourceRoleUrl,
    scenario,
    includeEvidenceInError: true,
  });
}

function assertDayFourNoLynchVoteProof({ proof, expectedGame, sourceRoleUrl }) {
  if (
    proof?.status !== "passed" ||
    proof.clickedThroughFromRoleUrl !== true ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.rawInviteTokensVisible !== false ||
    proof.targetOnlyReceiptVisible !== false ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    typeof proof.visitedRolePath !== "string" ||
    !proof.visitedRolePath.includes("/g/") ||
    proof.surfaceTestId !== "player-surface" ||
    proof.clickedAction !== "submit_vote:no_lynch" ||
    proof.commandKind !== "SubmitVote" ||
    proof.command?.game !== expectedGame ||
    proof.command.actor_slot !== "slot-7" ||
    proof.command.target !== "NoLynch" ||
    proof.commandStatus?.state !== "ack" ||
    !proof.commandStatus?.message?.includes("Ack: stream seqs 912") ||
    proof.bridgePlan?.role !== "player" ||
    proof.bridgePlan.commandKind !== "SubmitVote" ||
    proof.bridgePlan.commandEndpoint !== "/commands" ||
    proof.bridgePlan.finalState !== "ack" ||
    !sameStringArray(proof.bridgePlan.projectionRefreshKeys, [
      "votecount",
      "commandState",
    ]) ||
    proof.receipts?.at?.(-1)?.state !== "ack" ||
    proof.projectionCommandState?.actorSlot !== "slot-7" ||
    proof.projectionCommandState?.phase?.phaseId !== "D04" ||
    proof.projectionCommandState?.phase?.locked !== false ||
    proof.projectionCommandState?.currentVote?.kind !== "no_lynch" ||
    !String(proof.projectionCommandState?.boundary ?? "").includes(
      "Day 4 no-lynch vote ACK",
    ) ||
    proof.projectionVotecount?.[0]?.target !== "No lynch" ||
    proof.projectionVotecount?.[0]?.count !== 1 ||
    proof.projectionVotecount?.[0]?.needed !== 1 ||
    proof.projectionDayVoteOutcomes?.at?.(-1)?.phaseId !== "D03" ||
    proof.setupResyncFromSeq !== 911 ||
    proof.setupSnapshotCommandState?.phase?.phaseId !== "D04" ||
    proof.currentVote?.hasVote !== "true" ||
    !String(proof.currentVote?.text ?? "").includes("No lynch") ||
    proof.receiptCount !== 1 ||
    !String(proof.receiptStatusText ?? "")
      .toLowerCase()
      .includes("ack: stream seqs 912") ||
    proof.receiptRefreshKeys !== "votecount,commandState"
  ) {
    throw new Error(
      `core-loop admin proof missing Day 4 no-lynch vote ACK: ${JSON.stringify(
        proof,
      )}`,
    );
  }
}

function assertDayFourNoLynchHostTransitionProof({
  proof,
  expectedGame,
  sourceRoleUrl,
}) {
  if (
    proof?.status !== "passed" ||
    proof.clickedThroughFromRoleUrl !== true ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.rawInviteTokensVisible !== false ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    typeof proof.visitedRolePath !== "string" ||
    !proof.visitedRolePath.endsWith("/host") ||
    proof.surfaceTestId !== "host-console-surface" ||
    proof.setupResyncFromSeq !== 912 ||
    proof.setupSnapshotHost?.phase?.id !== "D04" ||
    proof.setupSnapshotHost?.phase?.state !== "open"
  ) {
    throw new Error(
      `core-loop admin proof missing Day 4 no-lynch host transition: ${JSON.stringify(
        proof,
      )}`,
    );
  }
  assertHostPhaseTransitionActionProof({
    proof: proof.resolveProof,
    expectedGame,
    actionId: "resolve_phase",
    commandKind: "ResolvePhase",
    streamSeq: 913,
    expectedPhaseId: "D04",
    expectedPhaseState: "locked",
    expectedDeadlineAffordance: "unlock_thread,advance_phase",
    expectedRefreshKeys: ["host", "votecount", "dayVoteOutcomes", "hostPrompts"],
  });
  assertHostPhaseTransitionActionProof({
    proof: proof.advanceProof,
    expectedGame,
    actionId: "advance_phase",
    commandKind: "AdvancePhase",
    streamSeq: 914,
    expectedPhaseId: "N04",
    expectedPhaseState: "open",
    expectedDeadlineAffordance: "resolve_phase,lock_thread",
    expectedRefreshKeys: [],
  });
  if (
    proof.resolveProof?.votecountProjection?.[0]?.target !== "No lynch" ||
    proof.resolveProof?.dayVoteOutcomesProjection?.at?.(-1)?.phaseId !== "D04" ||
    proof.resolveProof?.dayVoteOutcomesProjection?.at?.(-1)?.status !==
      "NoLynch"
  ) {
    throw new Error(
      `core-loop admin proof missing Day 4 no-lynch host projections: ${JSON.stringify(
        proof.resolveProof,
      )}`,
    );
  }
}

function assertNightFourPlayerActionSubmissionProof({
  proof,
  expectedGame,
  sourceRoleUrl,
}) {
  const clickProof = proof?.clickProof;
  if (
    proof?.status !== "passed" ||
    proof.clickedThroughFromRoleUrl !== true ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    typeof proof.visitedRolePath !== "string" ||
    !proof.visitedRolePath.includes("/g/") ||
    proof.surfaceTestId !== "player-surface" ||
    proof.setupResyncFromSeq !== 914 ||
    proof.setupSnapshotCommandState?.phase?.phaseId !== "N04" ||
    proof.setupSnapshotCommandState?.actions?.[0]?.targets?.[0] !== "slot-5" ||
    clickProof?.status !== "passed" ||
    clickProof.clickedAction !== "submit_action:factional_kill" ||
    clickProof.commandKind !== "SubmitAction" ||
    clickProof.command?.game !== expectedGame ||
    clickProof.command.actor_slot !== "slot-7" ||
    clickProof.command.action_id !== "factional_kill" ||
    clickProof.command.template_id !== "factional_kill" ||
    clickProof.command.targets?.[0] !== "slot-5" ||
    clickProof.command.grant_id !== "grant-factional-kill-n04" ||
    clickProof.commandStatus?.state !== "ack" ||
    !clickProof.commandStatus?.message?.includes("Ack: stream seqs 915") ||
    clickProof.bridgePlan?.role !== "player" ||
    clickProof.bridgePlan.commandKind !== "SubmitAction" ||
    clickProof.bridgePlan.commandEndpoint !== "/commands" ||
    clickProof.bridgePlan.finalState !== "ack" ||
    !sameStringArray(clickProof.bridgePlan.projectionRefreshKeys, [
      "notifications",
      "investigationResults",
      "commandState",
    ]) ||
    clickProof.receipts?.at?.(-1)?.state !== "ack" ||
    clickProof.projectionCommandState?.phase?.phaseId !== "N04" ||
    clickProof.projectionCommandState?.actions?.length !== 0 ||
    !String(clickProof.projectionCommandState?.boundary ?? "").includes(
      "Night 4 action ACK",
    ) ||
    !String(clickProof.checkpointReceiptState ?? "").includes(
      "Ack: stream seqs 915",
    ) ||
    clickProof.checkpointActionStateAfterAck !==
      "disabled:no legal action available" ||
    clickProof.receiptCount !== 1 ||
    !String(clickProof.receiptStatusText ?? "")
      .toLowerCase()
      .includes("ack: stream seqs 915")
  ) {
    throw new Error(
      `core-loop admin proof missing Night 4 player action ACK: ${JSON.stringify(
        proof,
      )}`,
    );
  }
}

function assertPostDayThreePlayerSurfaceProof({
  proof,
  sourceRoleUrl,
  expectedSlot,
  slotField,
  expectedPrincipalUserId,
  expectedPhaseId,
  expectedPhaseState,
  expectedActorAlive,
  expectedActorStatus,
  expectedActionState,
  expectedStatusText,
  expectedPrivateCount,
  expectedPrivateReceipt,
  expectedBoundaryText,
  expectedResyncFromSeq,
  expectedCommandStateEndpoint,
  expectedNotificationsEndpoint,
  expectedVoteButtonCount = 0,
  expectedVoteTargetCount = 0,
  expectedLastVoteOutcomePhaseId = "D03",
  expectedPrivateReceiptStatus = "day_vote",
  expectedPrivateReceiptPhaseId = "D03",
}) {
  if (
    proof?.status !== "passed" ||
    proof.clickedThroughFromRoleUrl !== true ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.rawInviteTokensVisible !== false ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    typeof proof.visitedRolePath !== "string" ||
    !proof.visitedRolePath.includes("/g/") ||
    proof.surfaceTestId !== "player-surface" ||
    proof[slotField] !== expectedSlot ||
    proof.principalUserId !== expectedPrincipalUserId ||
    proof.checkpoint?.phaseId !== expectedPhaseId ||
    proof.checkpoint.phaseState !== expectedPhaseState ||
    proof.checkpoint.actorSlot !== expectedSlot ||
    proof.checkpoint.actionState !== expectedActionState ||
    proof.checkpoint.receiptState !== "idle" ||
    !String(proof.checkpoint.statusText ?? "")
      .toLowerCase()
      .includes(expectedStatusText) ||
    proof.privateQueueBoundary?.status !==
      "principal-scoped-private-projections" ||
    proof.privateQueueBoundary.count !== expectedPrivateCount ||
    !String(proof.privateQueueBoundary.text ?? "").includes(
      "principal-scoped endpoints",
    ) ||
    proof.voteButtonCount !== expectedVoteButtonCount ||
    proof.projectionCommandState?.actorSlot !== expectedSlot ||
    proof.projectionCommandState?.actorAlive !== expectedActorAlive ||
    proof.projectionCommandState?.actorStatus !== expectedActorStatus ||
    proof.projectionCommandState?.phase?.phaseId !== expectedPhaseId ||
    proof.projectionCommandState?.phase?.locked !==
      (expectedPhaseState === "locked") ||
    proof.projectionCommandState?.actions?.length !== 0 ||
    proof.projectionCommandState?.voteTargets?.length !== expectedVoteTargetCount ||
    !String(proof.projectionCommandState?.boundary ?? "").includes(
      expectedBoundaryText,
    ) ||
    proof.projectionDayVoteOutcomes?.at?.(-1)?.phaseId !==
      expectedLastVoteOutcomePhaseId ||
    proof.resyncFromSeq !== expectedResyncFromSeq ||
    proof.resyncSnapshotCommandState?.actorSlot !== expectedSlot ||
    proof.resyncSnapshotCommandState?.phase?.phaseId !== expectedPhaseId ||
    proof.coldLoadEndpoints?.notificationsEndpoint !==
      expectedNotificationsEndpoint ||
    proof.coldLoadEndpoints?.commandStateEndpoint !== expectedCommandStateEndpoint
  ) {
    throw new Error(
      `core-loop admin proof missing post-Day 3 player surface: ${JSON.stringify(
        proof,
      )}`,
    );
  }
  if (
    expectedPrivateReceipt &&
    (proof.privateNotice?.id !== "notification-1" ||
      proof.privateNotice.kind !== "notification" ||
      !String(proof.privateNotice.text ?? "").includes("player_killed") ||
      !String(proof.privateNotice.text ?? "").includes(
        expectedPrivateReceiptStatus,
      ) ||
      proof.privateNotice.detailText !==
        `Phase ${expectedPrivateReceiptPhaseId}` ||
      proof.projectionNotifications?.[0]?.effect !== "player_killed" ||
      proof.projectionNotifications?.[0]?.status !==
        expectedPrivateReceiptStatus ||
      proof.resyncSnapshotNotifications?.[0]?.status !==
        expectedPrivateReceiptStatus)
  ) {
    throw new Error(
      `core-loop admin proof missing post-Day 3 target receipt: ${JSON.stringify(
        proof,
      )}`,
    );
  }
  if (
    !expectedPrivateReceipt &&
    (!String(proof.privateEmptyText ?? "").includes("No private results visible") ||
      proof.projectionNotifications?.length !== 0 ||
      proof.resyncSnapshotNotifications?.length !== 0 ||
      proof.privateNotice !== undefined)
  ) {
    throw new Error(
      `core-loop admin proof leaked post-Day 3 target receipt: ${JSON.stringify(
        proof,
      )}`,
    );
  }
}

function assertPostDayThreeHostAdvanceProof({ proof, expectedGame, sourceRoleUrl }) {
  if (
    proof?.status !== "passed" ||
    proof.clickedThroughFromRoleUrl !== true ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.rawInviteTokensVisible !== false ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    typeof proof.visitedRolePath !== "string" ||
    !proof.visitedRolePath.endsWith("/host") ||
    proof.surfaceTestId !== "host-console-surface" ||
    proof.setupResyncFromSeq !== 908 ||
    proof.setupSnapshotHost?.phase?.id !== "D03" ||
    proof.setupSnapshotHost?.phase?.state !== "locked"
  ) {
    throw new Error(
      `core-loop admin proof missing post-Day 3 host advance surface: ${JSON.stringify(
        proof,
      )}`,
    );
  }
  assertHostPhaseTransitionActionProof({
    proof: proof.advanceProof,
    expectedGame,
    actionId: "advance_phase",
    commandKind: "AdvancePhase",
    streamSeq: 909,
    expectedPhaseId: "N03",
    expectedPhaseState: "open",
    expectedDeadlineAffordance: "resolve_phase,lock_thread",
    expectedRefreshKeys: [],
  });
}

function assertNightThreeEmptyHostTransitionProof({
  proof,
  expectedGame,
  sourceRoleUrl,
}) {
  if (
    proof?.status !== "passed" ||
    proof.clickedThroughFromRoleUrl !== true ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.rawInviteTokensVisible !== false ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    typeof proof.visitedRolePath !== "string" ||
    !proof.visitedRolePath.endsWith("/host") ||
    proof.surfaceTestId !== "host-console-surface" ||
    proof.setupResyncFromSeq !== 909 ||
    proof.setupSnapshotHost?.phase?.id !== "N03" ||
    proof.setupSnapshotHost?.phase?.state !== "open"
  ) {
    throw new Error(
      `core-loop admin proof missing empty Night 3 host transition: ${JSON.stringify(
        proof,
      )}`,
    );
  }
  assertHostPhaseTransitionActionProof({
    proof: proof.resolveProof,
    expectedGame,
    actionId: "resolve_phase",
    commandKind: "ResolvePhase",
    streamSeq: 910,
    expectedPhaseId: "N03",
    expectedPhaseState: "locked",
    expectedDeadlineAffordance: "unlock_thread,advance_phase",
    expectedRefreshKeys: ["host", "votecount", "dayVoteOutcomes", "hostPrompts"],
  });
  assertHostPhaseTransitionActionProof({
    proof: proof.advanceProof,
    expectedGame,
    actionId: "advance_phase",
    commandKind: "AdvancePhase",
    streamSeq: 911,
    expectedPhaseId: "D04",
    expectedPhaseState: "open",
    expectedDeadlineAffordance: "resolve_phase,lock_thread",
    expectedRefreshKeys: [],
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
    staleProof.checkpointTargetSlotsAfterReject !== "slot-3" ||
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
    staleProof.command.targets?.[0] !== "slot-3" ||
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
    staleProof.checkpointTargetSlotsAfterReject !== "slot-3" ||
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
  const completedProof =
    privateChannelRoleSurface?.completedPrivateChannelProof;
  const expectedGame = gameFromRoleUrl(privateChannelRoleSurface?.sourceRoleUrl);
  const submitPostScenario = privateChannelSubmitPostScenario();
  const stalePostScenario = stalePrivateChannelPostPhaseLockedScenario();
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
    submitPostProof.clickedAction !== submitPostScenario.clickedAction ||
    submitPostProof.commandKind !== submitPostScenario.commandKind ||
    submitPostProof.command?.game !== expectedGame ||
    submitPostProof.command.channel_id !== submitPostScenario.channelId ||
    submitPostProof.command.actor_slot !== submitPostScenario.actorSlot ||
    submitPostProof.command.body !== submitPostProof.privatePostBody ||
    submitPostProof.privatePostBody !== submitPostScenario.postBody ||
    submitPostProof.commandStatus?.state !== "ack" ||
    !submitPostProof.commandStatus?.message?.includes(
      `Ack: stream seqs ${submitPostScenario.ackSeq}`,
    ) ||
    submitPostProof.bridgePlan?.role !== "player" ||
    submitPostProof.bridgePlan.commandKind !== submitPostScenario.commandKind ||
    submitPostProof.bridgePlan.commandEndpoint !== "/commands" ||
    submitPostProof.bridgePlan.finalState !== "ack" ||
    !sameStringArray(
      submitPostProof.bridgePlan.projectionRefreshKeys,
      submitPostScenario.expectedRefreshKeys,
    ) ||
    submitPostProof.receipts?.at?.(-1)?.state !== "ack" ||
    submitPostProof.projectionThread?.posts?.at?.(-1)?.body !==
      submitPostProof.privatePostBody ||
    submitPostProof.receiptCount !== 1 ||
    !String(submitPostProof.receiptStatusText ?? "")
      .toLowerCase()
      .includes(`ack: stream seqs ${submitPostScenario.ackSeq}`) ||
    submitPostProof.receiptRefreshKeys !==
      submitPostScenario.expectedRefreshKeys.join(",")
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
    stalePostProof.clickedAction !== stalePostScenario.clickedAction ||
    stalePostProof.commandKind !== stalePostScenario.commandKind ||
    stalePostProof.command?.game !== expectedGame ||
    stalePostProof.command.channel_id !== stalePostScenario.channelId ||
    stalePostProof.command.actor_slot !== stalePostScenario.actorSlot ||
    stalePostProof.command.body !== stalePostProof.stalePrivatePostBody ||
    stalePostProof.stalePrivatePostBody !== stalePostScenario.stalePostBody ||
    stalePostProof.commandStatus?.state !== "reject" ||
    stalePostProof.commandStatus.error !== stalePostScenario.commandError ||
    !String(stalePostProof.commandStatus.message ?? "").includes(
      stalePostScenario.commandMessageFragment,
    ) ||
    stalePostProof.bridgePlan?.role !== "player" ||
    stalePostProof.bridgePlan.commandKind !== stalePostScenario.commandKind ||
    stalePostProof.bridgePlan.commandEndpoint !== "/commands" ||
    stalePostProof.bridgePlan.finalState !== "reject" ||
    !sameStringArray(
      stalePostProof.bridgePlan.projectionRefreshKeys,
      stalePostScenario.expectedRefreshKeys,
    ) ||
    stalePostProof.receipts?.at?.(-1)?.state !== "reject" ||
    stalePostProof.projectionCommandState?.phase?.phaseId !==
      stalePostScenario.expectedPhaseId ||
    stalePostProof.projectionCommandState?.phase?.locked !==
      stalePostScenario.expectedLocked ||
    !String(stalePostProof.projectionCommandState?.boundary ?? "").includes(
      "private post PhaseLocked recovery",
    ) ||
    stalePostProof.projectionThread?.posts?.at?.(-1)?.body !==
      stalePostScenario.currentThreadBody ||
    stalePostProof.projectionThread?.posts?.some?.(
      (post) => post?.body === stalePostProof.stalePrivatePostBody,
    ) === true ||
    !String(stalePostProof.currentThreadText ?? "").includes(
      stalePostScenario.currentThreadBody,
    ) ||
    stalePostProof.checkpointPhaseId !== stalePostScenario.expectedPhaseId ||
    stalePostProof.checkpointActionState !==
      stalePostScenario.expectedActionState ||
    stalePostProof.checkpointReceiptState !==
      stalePostScenario.expectedReceiptState ||
    !String(stalePostProof.receiptStatusText ?? "")
      .toLowerCase()
      .includes(stalePostScenario.expectedReceiptStatusFragment) ||
    stalePostProof.receiptRefreshKeys !==
      stalePostScenario.expectedRefreshKeys.join(",") ||
    stalePostProof.rawInviteTokensVisible !== false
  ) {
    throw new Error(
      `core-loop admin proof missing private channel stale post recovery: ${JSON.stringify(
        stalePostProof,
      )}`,
    );
  }
  assertCompletedPrivateChannelProof({
    proof: completedProof,
    expectedGame,
    sourceRoleUrl: privateChannelRoleSurface.sourceRoleUrl,
    visitedRolePath: privateChannelRoleSurface.visitedRolePath,
  });
}

function assertCompletedPrivateChannelProof({
  proof,
  expectedGame,
  sourceRoleUrl,
  visitedRolePath,
}) {
  assertCompletedPrivateChannelProofCases({
    proof,
    sourceRoleUrl,
    visitedRolePath,
    includeEvidenceInError: true,
    cases: completedPrivateChannelProofAssertionCases({
      proof,
      expectedGame,
      sourceRoleUrl,
      visitedRolePath,
      assertCompletedPrivateChannelReloadProof,
      assertStaleCompletedPrivatePostRecoveryProof,
    }),
  });
}

function assertCompletedPrivateChannelReloadProof({
  proof,
  sourceRoleUrl,
  visitedRolePath,
}) {
  assertCompletedPrivateChannelReloadProofCase({
    proof,
    sourceRoleUrl,
    visitedRolePath,
    includeEvidenceInError: true,
  });
}

function assertStaleCompletedPrivatePostRecoveryProof({
  proof,
  expectedGame,
  sourceRoleUrl,
  visitedRolePath,
}) {
  assertStaleCompletedPrivatePostRecoveryProofCase({
    proof,
    expectedGame,
    sourceRoleUrl,
    visitedRolePath,
    includeEvidenceInError: true,
  });
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
