import {
  dayOneNightOneDayTwoRoleUrlsFrom,
} from "./dev_test_game_core_loop_day_one_night_one_scenarios.mjs";
import {
  dayTwoNightTwoRoleUrlsFrom,
} from "./dev_test_game_core_loop_day_two_night_two_scenarios.mjs";
import {
  privateChannelRoleUrlWithFallback,
} from "./dev_test_game_core_loop_private_channel_recovery_scenarios.mjs";
import {
  normalResolutionPrivacyRoleUrl,
  targetResolutionReceiptRoleUrl,
} from "./dev_test_game_core_loop_private_receipt_surface_scenarios.mjs";

export const buildCoreLoopRoleProofUrls = (roleUrlHrefs) => {
  const dayOneNightOneDayTwo =
    dayOneNightOneDayTwoRoleUrlsFrom(roleUrlHrefs);
  const dayTwoNightTwo = dayTwoNightTwoRoleUrlsFrom(roleUrlHrefs);
  return {
    dayOneNightOneDayTwo,
    dayTwoNightTwo,
    proof: {
      earlyTargetResolutionReceipt: targetResolutionReceiptRoleUrl(
        dayOneNightOneDayTwo.target,
      ),
      earlyNormalResolutionPrivacy: normalResolutionPrivacyRoleUrl(
        dayOneNightOneDayTwo.normalPlayer,
      ),
      targetDayVoteReceipt: targetResolutionReceiptRoleUrl(
        dayTwoNightTwo.target,
      ),
      normalDayVotePrivacy: normalResolutionPrivacyRoleUrl(
        dayTwoNightTwo.normalPlayer,
      ),
      targetPostDayVoteAdvance: targetResolutionReceiptRoleUrl(
        dayTwoNightTwo.target,
      ),
      normalPostDayVoteAdvance: normalResolutionPrivacyRoleUrl(
        dayTwoNightTwo.normalPlayer,
      ),
      nightActionResolutionReceipt: targetResolutionReceiptRoleUrl(
        dayTwoNightTwo.actionPlayer,
      ),
      normalNightActionResolutionPrivacy: normalResolutionPrivacyRoleUrl(
        dayTwoNightTwo.normalPlayer,
      ),
      postDayThreeResolutionTarget: targetResolutionReceiptRoleUrl(
        dayTwoNightTwo.normalPlayer,
      ),
      deadPlayerReceipt: targetResolutionReceiptRoleUrl(
        dayTwoNightTwo.target,
      ),
      privateChannel: privateChannelRoleUrlWithFallback({
        privateChannelRoleUrl: dayOneNightOneDayTwo.privateChannel,
        playerRoleUrl: dayTwoNightTwo.actionPlayer,
      }),
    },
  };
};

export const coreLoopRoleSurfaceProofCases = [
  {
    surfaceKey: "hostRoleSurface",
    proofKey: "hostLifecycleControlCheckpoint",
    argsFrom: ({ proofRun, roleProofUrls }) => ({
      game: proofRun.session.game,
      roleUrl: roleProofUrls.dayTwoNightTwo.host,
    }),
  },
  {
    surfaceKey: "playerRoleSurface",
    proofKey: "playerActionSubmissionCheckpoint",
    argsFrom: ({ roleProofUrls }) => ({
      roleUrl: roleProofUrls.dayTwoNightTwo.actionPlayer,
    }),
  },
  {
    surfaceKey: "targetResolutionReceiptSurface",
    proofKey: "targetResolutionReceiptSurface",
    argsFrom: ({ roleProofUrls }) => ({
      roleUrl: roleProofUrls.proof.earlyTargetResolutionReceipt,
    }),
  },
  {
    surfaceKey: "normalResolutionPrivacySurface",
    proofKey: "normalResolutionPrivacySurface",
    argsFrom: ({ roleProofUrls }) => ({
      roleUrl: roleProofUrls.proof.earlyNormalResolutionPrivacy,
    }),
  },
  {
    surfaceKey: "targetDayVoteReceiptSurface",
    proofKey: "targetDayVoteReceiptSurface",
    argsFrom: ({ roleProofUrls }) => ({
      roleUrl: roleProofUrls.proof.targetDayVoteReceipt,
    }),
  },
  {
    surfaceKey: "normalDayVotePrivacySurface",
    proofKey: "normalDayVotePrivacySurface",
    argsFrom: ({ roleProofUrls }) => ({
      roleUrl: roleProofUrls.proof.normalDayVotePrivacy,
    }),
  },
  {
    surfaceKey: "hostPhaseTransitionSurface",
    proofKey: "hostPhaseTransitionSurface",
    argsFrom: ({ roleProofUrls }) => ({
      hostRoleUrl: roleProofUrls.dayTwoNightTwo.host,
      playerRoleUrl: roleProofUrls.dayTwoNightTwo.actionPlayer,
    }),
  },
  {
    surfaceKey: "targetPostDayVoteAdvanceSurface",
    proofKey: "targetPostDayVoteAdvanceSurface",
    argsFrom: ({ roleProofUrls }) => ({
      roleUrl: roleProofUrls.proof.targetPostDayVoteAdvance,
    }),
  },
  {
    surfaceKey: "normalPostDayVoteAdvanceSurface",
    proofKey: "normalPostDayVoteAdvanceSurface",
    argsFrom: ({ roleProofUrls }) => ({
      roleUrl: roleProofUrls.proof.normalPostDayVoteAdvance,
    }),
  },
  {
    surfaceKey: "nightActionResolutionReceiptSurface",
    proofKey: "nightActionResolutionReceiptSurface",
    argsFrom: ({ roleProofUrls }) => ({
      roleUrl: roleProofUrls.proof.nightActionResolutionReceipt,
    }),
  },
  {
    surfaceKey: "normalNightActionResolutionPrivacySurface",
    proofKey: "normalNightActionResolutionPrivacySurface",
    argsFrom: ({ roleProofUrls }) => ({
      roleUrl: roleProofUrls.proof.normalNightActionResolutionPrivacy,
    }),
  },
  {
    surfaceKey: "hostNightActionTransitionSurface",
    proofKey: "hostNightActionTransitionSurface",
    argsFrom: ({ roleProofUrls }) => ({
      hostRoleUrl: roleProofUrls.dayTwoNightTwo.host,
      actionPlayerRoleUrl: roleProofUrls.dayTwoNightTwo.actionPlayer,
      nightTargetRoleUrl: roleProofUrls.proof.nightActionResolutionReceipt,
      normalRoleUrl: roleProofUrls.proof.normalNightActionResolutionPrivacy,
    }),
  },
  {
    surfaceKey: "dayThreeVoteResolutionSurface",
    proofKey: "dayThreeVoteResolutionSurface",
    argsFrom: ({ roleProofUrls }) => ({
      actionPlayerRoleUrl: roleProofUrls.dayTwoNightTwo.actionPlayer,
      hostRoleUrl: roleProofUrls.dayTwoNightTwo.host,
    }),
  },
  {
    surfaceKey: "postDayThreeResolutionSurface",
    proofKey: "postDayThreeResolutionSurface",
    argsFrom: ({ roleProofUrls }) => ({
      hostRoleUrl: roleProofUrls.dayTwoNightTwo.host,
      actionPlayerRoleUrl: roleProofUrls.dayTwoNightTwo.actionPlayer,
      targetRoleUrl: roleProofUrls.proof.postDayThreeResolutionTarget,
    }),
  },
  {
    surfaceKey: "nightThreeEmptyResolutionSurface",
    proofKey: "nightThreeEmptyResolutionSurface",
    argsFrom: ({ roleProofUrls }) => ({
      hostRoleUrl: roleProofUrls.dayTwoNightTwo.host,
      actionPlayerRoleUrl: roleProofUrls.dayTwoNightTwo.actionPlayer,
    }),
  },
  {
    surfaceKey: "dayFourSurvivorRoleSurface",
    proofKey: "dayFourSurvivorRoleSurface",
    argsFrom: ({ roleProofUrls }) => ({
      roleUrl: roleProofUrls.dayTwoNightTwo.actionPlayer,
    }),
  },
  {
    surfaceKey: "nightFourNoActionSurface",
    proofKey: "nightFourNoActionSurface",
    argsFrom: ({ roleProofUrls }) => ({
      hostRoleUrl: roleProofUrls.dayTwoNightTwo.host,
      actionPlayerRoleUrl: roleProofUrls.dayTwoNightTwo.actionPlayer,
    }),
  },
  {
    surfaceKey: "nightFourNoActionResolutionSurface",
    proofKey: "nightFourNoActionResolutionSurface",
    argsFrom: ({ roleProofUrls }) => ({
      hostRoleUrl: roleProofUrls.dayTwoNightTwo.host,
      actionPlayerRoleUrl: roleProofUrls.dayTwoNightTwo.actionPlayer,
    }),
  },
  {
    surfaceKey: "postNightFourTransitionSurface",
    proofKey: "postNightFourTransitionSurface",
    argsFrom: ({ roleProofUrls }) => ({
      hostRoleUrl: roleProofUrls.dayTwoNightTwo.host,
      actionPlayerRoleUrl: roleProofUrls.dayTwoNightTwo.actionPlayer,
      deadPlayerRoleUrl: roleProofUrls.proof.deadPlayerReceipt,
    }),
  },
  {
    surfaceKey: "dayFiveNoLynchResolutionSurface",
    proofKey: "dayFiveNoLynchResolutionSurface",
    argsFrom: ({ roleProofUrls }) => ({
      hostRoleUrl: roleProofUrls.dayTwoNightTwo.host,
      actionPlayerRoleUrl: roleProofUrls.dayTwoNightTwo.actionPlayer,
    }),
  },
  {
    surfaceKey: "completedGameEndgameSurface",
    proofKey: "completedGameEndgameSurface",
    argsFrom: ({ roleProofUrls }) => ({
      hostRoleUrl: roleProofUrls.dayTwoNightTwo.host,
      actionPlayerRoleUrl: roleProofUrls.dayTwoNightTwo.actionPlayer,
      normalPlayerRoleUrl: roleProofUrls.dayTwoNightTwo.normalPlayer,
      deadPlayerRoleUrl: roleProofUrls.proof.deadPlayerReceipt,
    }),
  },
  {
    surfaceKey: "privateChannelRoleSurface",
    proofKey: "privateChannelRoleSurface",
    argsFrom: ({ roleProofUrls }) => ({
      roleUrl: roleProofUrls.proof.privateChannel,
    }),
  },
];

export function coreLoopRoleSurfaceProofCaseKeys() {
  return coreLoopRoleSurfaceProofCases.map(({ surfaceKey }) => surfaceKey);
}

export function coreLoopRoleSurfaceProofInventory() {
  return {
    rows: coreLoopRoleSurfaceProofCases.map(({ surfaceKey, proofKey }) => ({
      surfaceKey,
      proofKey,
    })),
  };
}

export function coreLoopRoleSurfaceProofEvidenceKeys({ omit = [] } = {}) {
  const omittedKeys = new Set(omit);
  return coreLoopRoleSurfaceProofCaseKeys().filter(
    (surfaceKey) => !omittedKeys.has(surfaceKey),
  );
}

export function coreLoopRoleSurfaceProofEvidence(surfaces, options) {
  return Object.fromEntries(
    coreLoopRoleSurfaceProofEvidenceKeys(options).map((surfaceKey) => [
      surfaceKey,
      surfaces[surfaceKey],
    ]),
  );
}
