import path from "node:path";
import {
  coreLoopHighlightedLaneEvidence,
  coreLoopSpineStatus,
} from "../frontend/src/lib/app/local-proof-lane-status.mjs";
import {
  assertCompletedGameProofReadinessSurfaceProof,
  completedGameProofReadinessProofScenarioCases,
  completedGameProofReadinessScenarioFamilies,
  completedGameProofReadinessTransition,
} from "./dev_test_game_core_loop_completed_game_proof_readiness_cases.mjs";
import {
  assertPlayerStaleActionAfterTransitionProofCase,
  assertPlayerStaleVoteAfterTransitionProofCase,
} from "./dev_test_game_core_loop_action_scenarios.mjs";
import {
  playerActionSubmissionScenario,
  playerInvalidActionRecoveryScenario,
  staleNightFourActionRecoveryScenario,
} from "./dev_test_game_core_loop_action_scenario_cases.mjs";
import {
  assertPlayerActionRoleSurfaceProof,
  coreLoopPlayerActionRecoveryFamilyId,
  coreLoopPlayerActionRecoveryScenarioFamily,
} from "./dev_test_game_core_loop_player_action_recovery_scenarios.mjs";
import {
  assertEmptyNightThreeHostTransitionProofCase,
  assertHostLifecycleControlRoleSurfaceCase,
  assertHostNightActionTransitionSurfaceCase,
  assertHostPhaseTransitionActionProofCase,
  assertHostStaleAdvanceAfterTransitionProofCase,
  hostAdvancePhaseTransitionCase,
  hostCompleteGameCommandFacts,
  hostDeadlineAffordanceForPhaseState,
  hostResolvePhaseTransitionCase,
} from "./dev_test_game_core_loop_host_phase_scenarios.mjs";
import {
  assertPostNightFourTransitionSurfaceCase,
} from "./dev_test_game_core_loop_post_night_four_transition_scenarios.mjs";
import {
  assertHostPhaseTransitionSurfaceProof,
  assertStaleNightFourActionRecoveryProofCase,
} from "./dev_test_game_core_loop_transition_recovery_scenario_assertions.mjs";
import {
  assertDayThreePlayerObservationProofCase,
  assertPostDayThreePlayerSurfaceProofCase,
  privateReceiptProofArgs,
  privateReceiptScenario,
  assertPrivateChannelRoleSurfaceProof,
} from "./dev_test_game_core_loop_private_receipt_scenarios.mjs";
import {
  assertNightActionResolutionReceiptSurfaceProof,
  assertNormalDayVotePrivacySurfaceProof,
  assertNormalNightActionResolutionPrivacySurfaceProof,
  assertNormalResolutionPrivacySurfaceProof,
  assertTargetDayVoteReceiptSurfaceProof,
  assertTargetResolutionReceiptSurfaceProof,
  coreLoopPrivateReceiptSurfaceFamilyId,
  coreLoopPrivateReceiptSurfaceScenarioFamily,
} from "./dev_test_game_core_loop_private_receipt_surface_scenarios.mjs";
import {
  assertNormalPostDayVoteAdvanceSurfaceProof,
  assertTargetPostDayVoteAdvanceSurfaceProof,
  coreLoopPostDayVoteAdvanceFamilyId,
  coreLoopPostDayVoteAdvanceScenarioFamily,
} from "./dev_test_game_core_loop_post_day_vote_advance_scenarios.mjs";
import {
  assertDayThreeVoteResolutionSurfaceCase,
  coreLoopVoteResolutionFamilyId,
  coreLoopVoteResolutionScenarioFamily,
} from "./dev_test_game_core_loop_vote_resolution_scenarios.mjs";
import {
  assertDayFourSurvivorRoleSurfaceCase,
  assertNightThreeEmptyResolutionSurfaceCase,
  coreLoopPhaseProgressionFamilyId,
  coreLoopPhaseProgressionScenarioFamily,
} from "./dev_test_game_core_loop_phase_progression_scenarios.mjs";
import {
  assertNightFourActionSubmissionSurfaceCase,
  coreLoopLateActionProgressionFamilyId,
  coreLoopLateActionProgressionScenarioFamily,
} from "./dev_test_game_core_loop_late_action_progression_scenarios.mjs";
import {
  assertNightFourResolutionReceiptSurfaceCase,
  assertPostDayThreeResolutionSurfaceCase,
  coreLoopResolutionReceiptPrivacyFamilyId,
  coreLoopResolutionReceiptPrivacyScenarioFamily,
} from "./dev_test_game_core_loop_resolution_receipt_privacy_scenarios.mjs";
import {
  assertDayFourNoLynchHostTransitionProofCase,
  assertDayFourNoLynchVoteProofCase,
  coreLoopNoLynchProgressionFamilyId,
  coreLoopNoLynchProgressionScenarioFamily,
} from "./dev_test_game_core_loop_no_lynch_progression_scenarios.mjs";
import {
  assertDayFiveNoLynchResolutionSurfaceProof,
  coreLoopDayFiveProgressionFamilyId,
  coreLoopDayFiveProgressionScenarioFamily,
} from "./dev_test_game_core_loop_day_five_progression_scenarios.mjs";
import {
  coreLoopHostControlFamilyId,
  coreLoopHostControlScenarioFamily,
} from "./dev_test_game_core_loop_host_control_scenarios.mjs";
import {
  coreLoopCompletedEndgameProgressionFamilyId,
  coreLoopCompletedEndgameProgressionScenarioFamily,
} from "./dev_test_game_core_loop_completed_endgame_progression_scenarios.mjs";
import {
  coreLoopPrivateChannelRecoveryFamilyId,
  coreLoopPrivateChannelRecoveryLaneIds,
  coreLoopPrivateChannelRecoveryScenarioFamily,
  completedPrivateChannelReloadScenario,
  completedPrivateChannelTransition,
  privateChannelSubmitPostScenario,
  staleCompletedPrivatePostScenario,
  stalePrivateChannelPostPhaseLockedScenario,
} from "./dev_test_game_core_loop_private_channel_recovery_scenarios.mjs";
import {
  coreLoopAdminCheckIds,
  coreLoopCompletedGameCoverageCheckId,
  coreLoopSpineCheckId,
} from "./dev_test_game_core_loop_scenarios.mjs";
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
const requiredChecks = coreLoopAdminCheckIds;

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

function completedGameHardeningCoverageStatus(proofRun) {
  const coverage = proofRun?.completedGameHardeningCoverage;
  const status = String(coverage?.status ?? "unknown");
  const passedLaneCount = Number(coverage?.passedLaneCount ?? 0);
  const laneCount = Number(coverage?.laneCount ?? 0);
  const familyCount = Number(coverage?.familyCount ?? 0);
  const expectedLaneCount = Number(coverage?.expectedLaneCount);
  const expectedFamilyCount = Number(coverage?.expectedFamilyCount);
  if (
    laneCount !== expectedLaneCount ||
    familyCount !== expectedFamilyCount
  ) {
    return `drift: ${status} artifact reports ${passedLaneCount}/${laneCount} completed-game lanes across ${familyCount} families; expected ${expectedLaneCount} lanes across ${expectedFamilyCount} shared families`;
  }
  return `${status}: ${passedLaneCount}/${laneCount} completed-game lanes across ${familyCount} families`;
}

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
        [coreLoopSpineCheckId]: coreLoopSpineStatus(proofRun),
        [coreLoopCompletedGameCoverageCheckId]:
          completedGameHardeningCoverageStatus(proofRun),
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
      roleUrl:
        spineRows.roleUrlHrefs["d01-n01-d02-privateChannel"] ??
        privateChannelRoleUrlFromPlayerRoleUrl(
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
      completedGameHardeningCoverage:
        proofRun.completedGameHardeningCoverage,
      completedGameHardeningCoverageStatus:
        completedGameHardeningCoverageStatus(proofRun),
      hostControlFamily: coreLoopHostControlScenarioFamily(),
      playerActionRecoveryFamily:
        coreLoopPlayerActionRecoveryScenarioFamily(),
      privateReceiptSurfaceFamily:
        coreLoopPrivateReceiptSurfaceScenarioFamily(),
      postDayVoteAdvanceFamily:
        coreLoopPostDayVoteAdvanceScenarioFamily(),
      voteResolutionFamily: coreLoopVoteResolutionScenarioFamily(),
      phaseProgressionFamily: coreLoopPhaseProgressionScenarioFamily(),
      lateActionProgressionFamily:
        coreLoopLateActionProgressionScenarioFamily(),
      resolutionReceiptPrivacyFamily:
        coreLoopResolutionReceiptPrivacyScenarioFamily(),
      noLynchProgressionFamily:
        coreLoopNoLynchProgressionScenarioFamily(),
      dayFiveProgressionFamily: coreLoopDayFiveProgressionScenarioFamily(),
      completedEndgameProgressionFamily:
        coreLoopCompletedEndgameProgressionScenarioFamily(),
      privateChannelRecoveryFamily:
        coreLoopPrivateChannelRecoveryScenarioFamily(),
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
      (expectedDeadlineAffordance) =>
        document
          .querySelector('[data-testid="host-lifecycle-control-checkpoint"]')
          ?.getAttribute("data-deadline-affordance") ===
        expectedDeadlineAffordance,
      hostDeadlineAffordanceForPhaseState("open"),
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
      ...hostResolvePhaseTransitionCase({
        streamSeq: 801,
        expectedPhaseId: "D02",
      }),
    });
    const advanceProof = await proveHostPhaseActionClick({
      page,
      commandRequests,
      ...hostAdvancePhaseTransitionCase({
        streamSeq: 802,
        expectedPhaseId: "N02",
      }),
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
      ...hostResolvePhaseTransitionCase({
        streamSeq: 905,
        expectedPhaseId: "N02",
      }),
    });
    const advanceProof = await proveHostPhaseActionClick({
      page,
      commandRequests,
      ...hostAdvancePhaseTransitionCase({
        streamSeq: 906,
        expectedPhaseId: "D03",
      }),
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
      ...hostResolvePhaseTransitionCase({
        streamSeq: 908,
        expectedPhaseId: "D03",
      }),
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
  const scenarioFamilies = completedGameProofReadinessScenarioFamilies();
  const completedScenarioCases =
    completedGameProofReadinessProofScenarioCases({
      actionPlayerRoleUrl,
      normalPlayerRoleUrl,
      deadPlayerRoleUrl,
      commandStateBuilders: completedPlayerReloadCommandStateBuilders(),
      scenarioFamilies,
    });
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
      cases: completedScenarioCases.completedHostStaleCommandCases,
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
    cases: completedScenarioCases.completedPlayerReloadCases,
  });
  const completedDeadPlayerStaleVoteRecoveryProof =
    await proveCompletedDeadPlayerStaleVoteRecovery({
      browser,
      frontendBaseUrl,
      roleUrl: deadPlayerRoleUrl,
      scenario: completedScenarioCases.completedDeadPlayerStaleVoteCase,
    });
  const staleCompletedPlayerRecoveryProofs =
    await proveStaleCompletedGamePlayerCommandRecoveryCases({
      browser,
      frontendBaseUrl,
      roleUrl: actionPlayerRoleUrl,
      cases: completedScenarioCases.staleCompletedGamePlayerCommandCases,
    });
  return {
    status: "passed",
    sourceHostRoleUrl: String(hostRoleUrl),
    sourceActionPlayerRoleUrl: String(actionPlayerRoleUrl),
    sourceNormalPlayerRoleUrl: String(normalPlayerRoleUrl),
    sourceDeadPlayerRoleUrl: String(deadPlayerRoleUrl),
    clickedThroughFromRoleUrl: true,
    transition: completedGameProofReadinessTransition({
      scenarioFamilies,
    }),
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
      (expectedDeadlineAffordance) => {
        const checkpoint = document.querySelector(
          '[data-testid="host-lifecycle-control-checkpoint"]',
        );
        return (
          checkpoint?.getAttribute("data-phase-id") === "N04" &&
          checkpoint?.getAttribute("data-phase-state") === "open" &&
          checkpoint?.getAttribute("data-deadline-affordance") ===
            expectedDeadlineAffordance
        );
      },
      hostDeadlineAffordanceForPhaseState("open"),
      { timeout: 15000 },
    );
    const resolveProof = await proveHostPhaseActionClick({
      page,
      commandRequests,
      ...hostResolvePhaseTransitionCase({
        streamSeq: 916,
        expectedPhaseId: "N04",
      }),
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
      (expectedDeadlineAffordance) => {
        const checkpoint = document.querySelector(
          '[data-testid="host-lifecycle-control-checkpoint"]',
        );
        return (
          checkpoint?.getAttribute("data-phase-id") === "D04" &&
          checkpoint?.getAttribute("data-phase-state") === "open" &&
          checkpoint?.getAttribute("data-deadline-affordance") ===
            expectedDeadlineAffordance
        );
      },
      hostDeadlineAffordanceForPhaseState("open"),
      { timeout: 15000 },
    );
    const resolveProof = await proveHostPhaseActionClick({
      page,
      commandRequests,
      ...hostResolvePhaseTransitionCase({
        streamSeq: 913,
        expectedPhaseId: "D04",
      }),
    });
    const advanceProof = await proveHostPhaseActionClick({
      page,
      commandRequests,
      ...hostAdvancePhaseTransitionCase({
        streamSeq: 914,
        expectedPhaseId: "N04",
      }),
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
      (expectedDeadlineAffordance) => {
        const checkpoint = document.querySelector(
          '[data-testid="host-lifecycle-control-checkpoint"]',
        );
        return (
          checkpoint?.getAttribute("data-phase-id") === "D05" &&
          checkpoint?.getAttribute("data-phase-state") === "open" &&
          checkpoint?.getAttribute("data-deadline-affordance") ===
            expectedDeadlineAffordance
        );
      },
      hostDeadlineAffordanceForPhaseState("open"),
      { timeout: 15000 },
    );
    const resolveProof = await proveHostPhaseActionClick({
      page,
      commandRequests,
      ...hostResolvePhaseTransitionCase({
        streamSeq: 919,
        expectedPhaseId: "D05",
      }),
    });
    const advanceProof = await proveHostPhaseActionClick({
      page,
      commandRequests,
      ...hostAdvancePhaseTransitionCase({
        streamSeq: 920,
        expectedPhaseId: "N05",
      }),
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
      (expectedDeadlineAffordance) => {
        const checkpoint = document.querySelector(
          '[data-testid="host-lifecycle-control-checkpoint"]',
        );
        return (
          checkpoint?.getAttribute("data-phase-id") === "N05" &&
          checkpoint?.getAttribute("data-phase-state") === "open" &&
          checkpoint?.getAttribute("data-deadline-affordance") ===
            expectedDeadlineAffordance
        );
      },
      hostDeadlineAffordanceForPhaseState("open"),
      { timeout: 15000 },
    );
    const completeProof = await proveHostPhaseActionClick({
      page,
      commandRequests,
      ...hostCompleteGameCommandFacts(),
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
  scenario,
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
        boundary: `Seeded browser ${scenario.expectedBoundaryText} into durable endgame controls.`,
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
    const setupResyncSnapshot = await triggerPlayerResync(page, 921, {
      unavailableMessage: "player resync hook is unavailable",
    });
    await page.waitForFunction(
      (expectedSlot) =>
        window.__fmarchPlayerProjection?.commandState?.gameCompleted === true &&
        window.__fmarchPlayerProjection?.commandState?.actorSlot ===
          expectedSlot,
      scenario.expectedSlot,
      { timeout: 15000 },
    );
    const commandResponse = await page.evaluate(
      async ({ expectedGame, scenario }) => {
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
                    game: expectedGame,
                    actor_slot: scenario.expectedSlot,
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
      },
      { expectedGame, scenario },
    );
    const recoveryResyncSnapshot = await triggerPlayerResync(page, 921, {
      unavailableMessage: "player resync hook is unavailable after reject",
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
      commandKind: scenario.commandKind,
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

async function triggerPlayerResync(
  page,
  fromSeq,
  { unavailableMessage = "player resync hook is unavailable" } = {},
) {
  try {
    await page.waitForFunction(
      () => typeof window.__fmarchTriggerPlayerResync === "function",
      null,
      { timeout: 15000 },
    );
  } catch {
    throw new Error(unavailableMessage);
  }
  return await page.evaluate(
    async (seq) => window.__fmarchTriggerPlayerResync(seq),
    fromSeq,
  );
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
      (expectedDeadlineAffordance) => {
        const checkpoint = document.querySelector(
          '[data-testid="host-lifecycle-control-checkpoint"]',
        );
        return (
          checkpoint?.getAttribute("data-phase-id") === "N03" &&
          checkpoint?.getAttribute("data-phase-state") === "open" &&
          checkpoint?.getAttribute("data-deadline-affordance") ===
            expectedDeadlineAffordance
        );
      },
      hostDeadlineAffordanceForPhaseState("open"),
      { timeout: 15000 },
    );
    const resolveProof = await proveHostPhaseActionClick({
      page,
      commandRequests,
      ...hostResolvePhaseTransitionCase({
        streamSeq: 910,
        expectedPhaseId: "N03",
      }),
    });
    const advanceProof = await proveHostPhaseActionClick({
      page,
      commandRequests,
      ...hostAdvancePhaseTransitionCase({
        streamSeq: 911,
        expectedPhaseId: "D04",
      }),
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
      (expectedDeadlineAffordance) => {
        const checkpoint = document.querySelector(
          '[data-testid="host-lifecycle-control-checkpoint"]',
        );
        return (
          checkpoint?.getAttribute("data-phase-id") === "N04" &&
          checkpoint?.getAttribute("data-phase-state") === "locked" &&
          checkpoint?.getAttribute("data-deadline-affordance") ===
            expectedDeadlineAffordance
        );
      },
      hostDeadlineAffordanceForPhaseState("locked"),
      { timeout: 15000 },
    );
    const advanceProof = await proveHostPhaseActionClick({
      page,
      commandRequests,
      ...hostAdvancePhaseTransitionCase({
        streamSeq: 917,
        expectedPhaseId: "D05",
      }),
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
      (expectedDeadlineAffordance) => {
        const checkpoint = document.querySelector(
          '[data-testid="host-lifecycle-control-checkpoint"]',
        );
        return (
          checkpoint?.getAttribute("data-phase-id") === "D03" &&
          checkpoint?.getAttribute("data-phase-state") === "locked" &&
          checkpoint?.getAttribute("data-deadline-affordance") ===
            expectedDeadlineAffordance
        );
      },
      hostDeadlineAffordanceForPhaseState("locked"),
      { timeout: 15000 },
    );
    const advanceProof = await proveHostPhaseActionClick({
      page,
      commandRequests,
      ...hostAdvancePhaseTransitionCase({
        streamSeq: 909,
        expectedPhaseId: "N03",
      }),
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
  expectedDeadlineAffordance = hostDeadlineAffordanceForPhaseState(
    expectedPhaseState,
  ),
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
      (expectedDeadlineAffordance) => {
        const checkpoint = document.querySelector(
          '[data-testid="host-lifecycle-control-checkpoint"]',
        );
        return (
          checkpoint?.getAttribute("data-phase-id") === "D02" &&
          checkpoint?.getAttribute("data-phase-state") === "locked" &&
          checkpoint?.getAttribute("data-deadline-affordance") ===
            expectedDeadlineAffordance
        );
      },
      hostDeadlineAffordanceForPhaseState("locked"),
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
      (expectedDeadlineAffordance) => {
        const checkpoint = document.querySelector(
          '[data-testid="host-lifecycle-control-checkpoint"]',
        );
        return (
          checkpoint?.getAttribute("data-phase-id") === "N02" &&
          checkpoint?.getAttribute("data-phase-state") === "open" &&
          checkpoint?.getAttribute("data-deadline-affordance") ===
            expectedDeadlineAffordance
        );
      },
      hostDeadlineAffordanceForPhaseState("open"),
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
  const visitedRolePath = privateChannelFocusedRolePathFromUrl(roleUrl);
  const commandRequests = [];
  const channelId = channelIdFromPrivateChannelRoleUrl(roleUrl);
  const scenario = privateChannelScenarioForRoleUrl({
    roleUrl,
    scenario: privateChannelSubmitPostScenario(),
  });
  const channelRailTestId = `player-channel-${channelId}`;
  const privatePostBody = scenario.postBody;
  try {
    await installPrivateChannelBrowserRoutes(page, {
      commandRequests,
      roleUrl,
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
    const privateChannel = page.getByTestId(channelRailTestId);
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
      channelRailTestId,
      clickedThroughFromRoleUrl: true,
      channelId,
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
  const visitedRolePath = privateChannelFocusedRolePathFromUrl(roleUrl);
  const commandRequests = [];
  const scenario = privateChannelScenarioForRoleUrl({
    roleUrl,
    scenario: stalePrivateChannelPostPhaseLockedScenario(),
  });
  const stalePrivatePostBody = scenario.stalePostBody;
  try {
    await installPrivateChannelStalePostBrowserRoutes(page, {
      commandRequests,
      roleUrl,
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
    visitedRolePath: privateChannelFocusedRolePathFromUrl(roleUrl),
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
  const visitedRolePath = privateChannelFocusedRolePathFromUrl(roleUrl);
  const scenario = privateChannelScenarioForRoleUrl({
    roleUrl,
    scenario: completedPrivateChannelReloadScenario(),
  });
  try {
    await installCompletedPrivateChannelBrowserRoutes(page, { roleUrl });
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
  const visitedRolePath = privateChannelFocusedRolePathFromUrl(roleUrl);
  const commandRequests = [];
  const scenario = privateChannelScenarioForRoleUrl({
    roleUrl,
    scenario: staleCompletedPrivatePostScenario(),
  });
  const stalePrivatePostBody = scenario.stalePostBody;
  try {
    await installStaleCompletedPrivateChannelBrowserRoutes(page, {
      commandRequests,
      roleUrl,
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
  { commandRequests, roleUrl, privatePostBody },
) {
  const scenario = privateChannelScenarioForRoleUrl({
    roleUrl,
    scenario: privateChannelSubmitPostScenario(),
  });
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
  await page.route("**/games/*/channels/*/thread?**", async (route) => {
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

async function installPrivateChannelStalePostBrowserRoutes(
  page,
  { commandRequests, roleUrl },
) {
  const scenario = privateChannelScenarioForRoleUrl({
    roleUrl,
    scenario: stalePrivateChannelPostPhaseLockedScenario(),
  });
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
  await page.route("**/games/*/channels/*/thread?**", async (route) => {
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

async function installCompletedPrivateChannelBrowserRoutes(page, { roleUrl }) {
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
  await installCompletedPrivateChannelProjectionRoutes(page, { roleUrl });
}

async function installStaleCompletedPrivateChannelBrowserRoutes(
  page,
  { commandRequests, roleUrl, stalePrivatePostBody },
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
  await page.route("**/games/*/channels/*/thread?**", async (route) => {
    await fulfillJson(
      route,
      rejected
        ? completedPrivateChannelThread({ roleUrl })
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

async function installCompletedPrivateChannelProjectionRoutes(page, { roleUrl }) {
  const scenario = privateChannelScenarioForRoleUrl({
    roleUrl,
    scenario: completedPrivateChannelReloadScenario(),
  });
  await page.route("**/games/*/channels/*/thread?**", async (route) => {
    await fulfillJson(route, completedPrivateChannelThread({ roleUrl }));
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

function completedPrivateChannelThread({ roleUrl } = {}) {
  const scenario =
    roleUrl === undefined
      ? completedPrivateChannelReloadScenario()
      : privateChannelScenarioForRoleUrl({
          roleUrl,
          scenario: completedPrivateChannelReloadScenario(),
        });
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

function privateChannelScenarioForRoleUrl({ roleUrl, scenario }) {
  return {
    ...scenario,
    channelId: channelIdFromPrivateChannelRoleUrl(roleUrl),
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

function privateChannelFocusedRolePathFromUrl(roleUrl) {
  const parsed = new URL(roleUrl);
  if (!parsed.searchParams.has("private")) {
    parsed.searchParams.set("private", "notification-1");
  }
  return `${parsed.pathname}${parsed.search}`;
}

function channelIdFromPrivateChannelRoleUrl(roleUrl) {
  if (typeof roleUrl !== "string" || roleUrl.trim() === "") {
    throw new Error("private channel proof missing channel role URL");
  }
  const parts = new URL(roleUrl).pathname.split("/");
  const channelIndex = parts.indexOf("c") + 1;
  return decodeURIComponent(parts[channelIndex] ?? "role-pm");
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
  if (
    !evidence.adminRoleSurface?.visibleCheckStatuses?.[
      coreLoopCompletedGameCoverageCheckId
    ]?.includes(evidence.generatedFrom?.completedGameHardeningCoverageStatus)
  ) {
    throw new Error(
      "core-loop admin proof missing visible completed-game coverage status",
    );
  }
  if (
    evidence.generatedFrom?.hostControlFamily?.id !==
      coreLoopHostControlFamilyId ||
    !Array.isArray(evidence.generatedFrom?.hostControlFamily?.laneIds)
  ) {
    throw new Error("core-loop admin proof missing host-control family");
  }
  if (
    evidence.generatedFrom?.playerActionRecoveryFamily?.id !==
      coreLoopPlayerActionRecoveryFamilyId ||
    !Array.isArray(evidence.generatedFrom?.playerActionRecoveryFamily?.laneIds)
  ) {
    throw new Error(
      "core-loop admin proof missing player-action recovery family",
    );
  }
  if (
    evidence.generatedFrom?.privateReceiptSurfaceFamily?.id !==
      coreLoopPrivateReceiptSurfaceFamilyId ||
    !Array.isArray(evidence.generatedFrom?.privateReceiptSurfaceFamily?.laneIds)
  ) {
    throw new Error(
      "core-loop admin proof missing private receipt surface family",
    );
  }
  if (
    evidence.generatedFrom?.postDayVoteAdvanceFamily?.id !==
      coreLoopPostDayVoteAdvanceFamilyId ||
    !Array.isArray(evidence.generatedFrom?.postDayVoteAdvanceFamily?.laneIds)
  ) {
    throw new Error(
      "core-loop admin proof missing post-day-vote advance family",
    );
  }
  if (
    evidence.generatedFrom?.voteResolutionFamily?.id !==
      coreLoopVoteResolutionFamilyId ||
    !Array.isArray(evidence.generatedFrom?.voteResolutionFamily?.laneIds)
  ) {
    throw new Error("core-loop admin proof missing vote-resolution family");
  }
  if (
    evidence.generatedFrom?.phaseProgressionFamily?.id !==
      coreLoopPhaseProgressionFamilyId ||
    !Array.isArray(evidence.generatedFrom?.phaseProgressionFamily?.laneIds)
  ) {
    throw new Error("core-loop admin proof missing phase progression family");
  }
  if (
    evidence.generatedFrom?.lateActionProgressionFamily?.id !==
      coreLoopLateActionProgressionFamilyId ||
    !Array.isArray(evidence.generatedFrom?.lateActionProgressionFamily?.laneIds)
  ) {
    throw new Error("core-loop admin proof missing late action progression family");
  }
  if (
    evidence.generatedFrom?.resolutionReceiptPrivacyFamily?.id !==
      coreLoopResolutionReceiptPrivacyFamilyId ||
    !Array.isArray(
      evidence.generatedFrom?.resolutionReceiptPrivacyFamily?.laneIds,
    )
  ) {
    throw new Error(
      "core-loop admin proof missing resolution receipt/privacy family",
    );
  }
  if (
    evidence.generatedFrom?.noLynchProgressionFamily?.id !==
      coreLoopNoLynchProgressionFamilyId ||
    !Array.isArray(evidence.generatedFrom?.noLynchProgressionFamily?.laneIds)
  ) {
    throw new Error("core-loop admin proof missing no-lynch progression family");
  }
  if (
    evidence.generatedFrom?.dayFiveProgressionFamily?.id !==
      coreLoopDayFiveProgressionFamilyId ||
    !Array.isArray(evidence.generatedFrom?.dayFiveProgressionFamily?.laneIds)
  ) {
    throw new Error("core-loop admin proof missing Day 5 progression family");
  }
  if (
    evidence.generatedFrom?.completedEndgameProgressionFamily?.id !==
      coreLoopCompletedEndgameProgressionFamilyId ||
    !Array.isArray(
      evidence.generatedFrom?.completedEndgameProgressionFamily?.laneIds,
    )
  ) {
    throw new Error(
      "core-loop admin proof missing completed endgame progression family",
    );
  }
  if (
    evidence.generatedFrom?.privateChannelRecoveryFamily?.id !==
      coreLoopPrivateChannelRecoveryFamilyId ||
    !sameStringArray(
      evidence.generatedFrom?.privateChannelRecoveryFamily?.laneIds,
      coreLoopPrivateChannelRecoveryLaneIds,
    )
  ) {
    throw new Error(
      "core-loop admin proof missing private-channel recovery family",
    );
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
  assertPrivateChannelRoleSurfaceProof({
    privateChannelRoleSurface: evidence.privateChannelRoleSurface,
    scenarioFamily: coreLoopPrivateChannelRecoveryScenarioFamily(),
    includeEvidenceInError: true,
  });
  return evidence;
}

function assertHostLifecycleControlCheckpoint(hostRoleSurface) {
  const scenarioFamily = coreLoopHostControlScenarioFamily();
  assertHostLifecycleControlRoleSurfaceCase({
    hostRoleSurface,
    expectedGame: gameFromRoleUrl(hostRoleSurface?.sourceRoleUrl),
    scenario: scenarioFamily.surfaces.hostLifecycleControl,
    includeEvidenceInError: true,
  });
}

function assertPlayerActionSubmissionCheckpoint(playerRoleSurface) {
  assertPlayerActionRoleSurfaceProof({
    playerRoleSurface,
    scenarioFamily: coreLoopPlayerActionRecoveryScenarioFamily(),
    includeEvidenceInError: true,
  });
}

function assertTargetResolutionReceiptSurface(targetSurface) {
  const expectedGame = gameFromRoleUrl(targetSurface?.sourceRoleUrl);
  assertTargetResolutionReceiptSurfaceProof({
    proof: targetSurface,
    expectedGame,
    sourceRoleUrl: targetSurface?.sourceRoleUrl,
    includeEvidenceInError: true,
  });
}

function assertNormalResolutionPrivacySurface(normalSurface) {
  const expectedGame = gameFromRoleUrl(normalSurface?.sourceRoleUrl);
  assertNormalResolutionPrivacySurfaceProof({
    proof: normalSurface,
    expectedGame,
    sourceRoleUrl: normalSurface?.sourceRoleUrl,
    includeEvidenceInError: true,
  });
}

function assertTargetDayVoteReceiptSurface(targetSurface) {
  const expectedGame = gameFromRoleUrl(targetSurface?.sourceRoleUrl);
  assertTargetDayVoteReceiptSurfaceProof({
    proof: targetSurface,
    expectedGame,
    sourceRoleUrl: targetSurface?.sourceRoleUrl,
    includeEvidenceInError: true,
  });
}

function assertNormalDayVotePrivacySurface(normalSurface) {
  const expectedGame = gameFromRoleUrl(normalSurface?.sourceRoleUrl);
  assertNormalDayVotePrivacySurfaceProof({
    proof: normalSurface,
    expectedGame,
    sourceRoleUrl: normalSurface?.sourceRoleUrl,
    includeEvidenceInError: true,
  });
}

function assertTargetPostDayVoteAdvanceSurface(targetSurface) {
  const expectedGame = gameFromRoleUrl(targetSurface?.sourceRoleUrl);
  assertTargetPostDayVoteAdvanceSurfaceProof({
    proof: targetSurface,
    expectedGame,
    sourceRoleUrl: targetSurface?.sourceRoleUrl,
    includeEvidenceInError: true,
  });
}

function assertNormalPostDayVoteAdvanceSurface(normalSurface) {
  const expectedGame = gameFromRoleUrl(normalSurface?.sourceRoleUrl);
  assertNormalPostDayVoteAdvanceSurfaceProof({
    proof: normalSurface,
    expectedGame,
    sourceRoleUrl: normalSurface?.sourceRoleUrl,
    includeEvidenceInError: true,
  });
}

function assertNightActionResolutionReceiptSurface(targetSurface) {
  const expectedGame = gameFromRoleUrl(targetSurface?.sourceRoleUrl);
  assertNightActionResolutionReceiptSurfaceProof({
    proof: targetSurface,
    expectedGame,
    sourceRoleUrl: targetSurface?.sourceRoleUrl,
    includeEvidenceInError: true,
  });
}

function assertNormalNightActionResolutionPrivacySurface(normalSurface) {
  const expectedGame = gameFromRoleUrl(normalSurface?.sourceRoleUrl);
  assertNormalNightActionResolutionPrivacySurfaceProof({
    proof: normalSurface,
    expectedGame,
    sourceRoleUrl: normalSurface?.sourceRoleUrl,
    includeEvidenceInError: true,
  });
}

function assertHostPhaseTransitionSurface(hostPhaseTransitionSurface) {
  assertHostPhaseTransitionSurfaceProof({
    hostPhaseTransitionSurface,
    assertHostPhaseTransitionActionProof,
    includeEvidenceInError: true,
  });
}

function assertHostNightActionTransitionSurface(hostNightActionTransitionSurface) {
  const expectedGame = gameFromRoleUrl(
    hostNightActionTransitionSurface?.sourceHostRoleUrl,
  );
  assertHostNightActionTransitionSurfaceCase({
    hostNightActionTransitionSurface,
    expectedGame,
    assertPlayerObservationProof: assertDayThreePlayerObservationProof,
    includeEvidenceInError: true,
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
  assertDayThreePlayerObservationProofCase({
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
    expectedCommandStateEndpoint,
    expectedNotificationsEndpoint,
    includeEvidenceInError: true,
  });
}

function assertDayThreeVoteResolutionSurface(dayThreeVoteResolutionSurface) {
  const expectedGame = gameFromRoleUrl(
    dayThreeVoteResolutionSurface?.sourceActionPlayerRoleUrl,
  );
  assertDayThreeVoteResolutionSurfaceCase({
    dayThreeVoteResolutionSurface,
    expectedGame,
    assertHostPhaseTransitionActionProof,
    includeEvidenceInError: true,
  });
}

function assertPostDayThreeResolutionSurface(postDayThreeResolutionSurface) {
  const expectedGame = gameFromRoleUrl(
    postDayThreeResolutionSurface?.sourceHostRoleUrl,
  );
  assertPostDayThreeResolutionSurfaceCase({
    postDayThreeResolutionSurface,
    expectedGame,
    assertPostDayThreePlayerSurfaceProof,
    assertHostPhaseTransitionActionProof,
    includeEvidenceInError: true,
  });
}

function assertNightThreeEmptyResolutionSurface(nightThreeEmptyResolutionSurface) {
  assertNightThreeEmptyResolutionSurfaceCase({
    nightThreeEmptyResolutionSurface,
    assertPostDayThreePlayerSurfaceProof,
    assertNightThreeEmptyHostTransitionProof,
    includeEvidenceInError: true,
  });
}

function assertDayFourSurvivorRoleSurface(dayFourSurvivorRoleSurface) {
  assertDayFourSurvivorRoleSurfaceCase({
    dayFourSurvivorRoleSurface,
    assertPostDayThreePlayerSurfaceProof,
    includeEvidenceInError: true,
  });
}

function assertNightFourActionSubmissionSurface(nightFourActionSubmissionSurface) {
  const expectedGame = gameFromRoleUrl(
    nightFourActionSubmissionSurface?.sourceHostRoleUrl,
  );
  assertNightFourActionSubmissionSurfaceCase({
    nightFourActionSubmissionSurface,
    expectedGame,
    assertDayFourNoLynchVoteProof: assertDayFourNoLynchVoteProof,
    assertDayFourNoLynchHostTransitionProof:
      assertDayFourNoLynchHostTransitionProof,
    includeEvidenceInError: true,
  });
}

function assertNightFourResolutionReceiptSurface(
  nightFourResolutionReceiptSurface,
) {
  const expectedGame = gameFromRoleUrl(
    nightFourResolutionReceiptSurface?.sourceHostRoleUrl,
  );
  assertNightFourResolutionReceiptSurfaceCase({
    nightFourResolutionReceiptSurface,
    expectedGame,
    assertHostPhaseTransitionActionProof,
    includeEvidenceInError: true,
  });
}

function assertPostNightFourTransitionSurface(postNightFourTransitionSurface) {
  const expectedGame = gameFromRoleUrl(
    postNightFourTransitionSurface?.sourceHostRoleUrl,
  );
  assertPostNightFourTransitionSurfaceCase({
    postNightFourTransitionSurface,
    expectedGame,
    assertHostPhaseTransitionActionProof,
    assertPlayerSurfaceProof: assertPostDayThreePlayerSurfaceProof,
    assertStaleActionRecoveryProof: assertStaleNightFourActionRecoveryProof,
    includeEvidenceInError: true,
  });
}

function assertStaleNightFourActionRecoveryProof({
  proof,
  expectedGame,
  sourceRoleUrl,
}) {
  assertStaleNightFourActionRecoveryProofCase({
    proof,
    expectedGame,
    sourceRoleUrl,
    includeEvidenceInError: true,
  });
}

function assertDayFiveNoLynchResolutionSurface(dayFiveNoLynchResolutionSurface) {
  assertDayFiveNoLynchResolutionSurfaceProof({
    dayFiveNoLynchResolutionSurface,
    assertHostPhaseTransitionActionProof,
    assertPostDayThreePlayerSurfaceProof,
    includeEvidenceInError: true,
  });
}
function assertCompletedGameEndgameSurface(completedGameEndgameSurface) {
  const scenarioFamilies = completedGameProofReadinessScenarioFamilies();
  assertCompletedGameProofReadinessSurfaceProof({
    completedGameEndgameSurface,
    scenarioFamilies,
    assertHostPhaseTransitionActionProof,
    assertPostDayThreePlayerSurfaceProof,
    includeEvidenceInError: true,
  });
}

function assertDayFourNoLynchVoteProof({ proof, expectedGame, sourceRoleUrl }) {
  assertDayFourNoLynchVoteProofCase({
    proof,
    expectedGame,
    sourceRoleUrl,
    includeEvidenceInError: true,
  });
}

function assertDayFourNoLynchHostTransitionProof({
  proof,
  expectedGame,
  sourceRoleUrl,
}) {
  assertDayFourNoLynchHostTransitionProofCase({
    proof,
    expectedGame,
    sourceRoleUrl,
    assertHostPhaseTransitionActionProof,
    includeEvidenceInError: true,
  });
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
  assertPostDayThreePlayerSurfaceProofCase({
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
    expectedVoteButtonCount,
    expectedVoteTargetCount,
    expectedLastVoteOutcomePhaseId,
    expectedPrivateReceiptStatus,
    expectedPrivateReceiptPhaseId,
    includeEvidenceInError: true,
  });
}

function assertNightThreeEmptyHostTransitionProof({
  proof,
  expectedGame,
  sourceRoleUrl,
}) {
  assertEmptyNightThreeHostTransitionProofCase({
    proof,
    expectedGame,
    sourceRoleUrl,
    assertHostPhaseTransitionActionProof,
    includeEvidenceInError: true,
  });
}

function assertHostStaleAdvanceAfterTransitionProof({ staleProof, expectedGame }) {
  assertHostStaleAdvanceAfterTransitionProofCase({
    proof: staleProof,
    expectedGame,
    includeEvidenceInError: true,
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
  expectedDeadlineAffordance = hostDeadlineAffordanceForPhaseState(
    expectedPhaseState,
  ),
  expectedRefreshKeys,
}) {
  assertHostPhaseTransitionActionProofCase({
    proof,
    expectedGame,
    actionId,
    commandKind,
    streamSeq,
    expectedPhaseId,
    expectedPhaseState,
    expectedDeadlineAffordance,
    expectedRefreshKeys,
    includeEvidenceInError: true,
  });
}

function assertPlayerStaleVoteAfterTransitionProof({ staleProof, expectedGame }) {
  assertPlayerStaleVoteAfterTransitionProofCase({
    proof: staleProof,
    expectedGame,
    includeEvidenceInError: true,
  });
}

function assertPlayerStaleActionAfterTransitionProof({ staleProof, expectedGame }) {
  assertPlayerStaleActionAfterTransitionProofCase({
    proof: staleProof,
    expectedGame,
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
