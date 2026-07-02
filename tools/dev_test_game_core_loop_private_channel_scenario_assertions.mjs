import {
  completedPrivateChannelReloadScenario,
  completedPrivateChannelTransitionTokens,
  staleCompletedPrivatePostScenario,
} from "./dev_test_game_core_loop_private_channel_scenario_case_definitions.mjs";

export {
  completedPrivateChannelReloadScenario,
  completedPrivateChannelSnapshot,
  completedPrivateChannelTransition,
  completedPrivateChannelTransitionTokens,
  privateChannelSubmitPostCommandFacts,
  privateChannelSubmitPostScenario,
  staleCompletedPrivatePostCommandFacts,
  staleCompletedPrivatePostScenario,
  stalePrivateChannelPostPhaseLockedScenario,
} from "./dev_test_game_core_loop_private_channel_scenario_case_definitions.mjs";

export function assertCompletedPrivateChannelTransition({
  transition,
  transitionTokens = completedPrivateChannelTransitionTokens(),
  failureMessage = "completed private-channel transition missing shared scenario tokens",
}) {
  const transitionText = String(transition ?? "");
  const missingTokens = transitionTokens.filter((token) =>
    !transitionText.includes(token),
  );
  if (missingTokens.length > 0) {
    throw new Error(`${failureMessage}: ${missingTokens.join(", ")}`);
  }
}

export function completedPrivateChannelProofAssertionCases({
  proof,
  expectedGame,
  sourceRoleUrl,
  visitedRolePath,
  assertCompletedPrivateChannelReloadProof,
  assertStaleCompletedPrivatePostRecoveryProof,
  reloadScenario = completedPrivateChannelReloadScenario(),
  staleCompletedPostScenario = staleCompletedPrivatePostScenario(),
}) {
  return [
    completedPrivateChannelReloadAssertionCase({
      proof,
      sourceRoleUrl,
      visitedRolePath,
      assertCompletedPrivateChannelReloadProof,
      scenario: reloadScenario,
    }),
    staleCompletedPrivatePostAssertionCase({
      proof,
      expectedGame,
      sourceRoleUrl,
      visitedRolePath,
      assertStaleCompletedPrivatePostRecoveryProof,
      scenario: staleCompletedPostScenario,
    }),
  ];
}

export function completedPrivateChannelReloadAssertionCase({
  proof,
  sourceRoleUrl,
  visitedRolePath,
  assertCompletedPrivateChannelReloadProof,
  scenario = completedPrivateChannelReloadScenario(),
}) {
  return {
    assertProof: assertCompletedPrivateChannelReloadProof,
    proof: proof?.reloadProof,
    scenario,
    ...completedPrivateChannelReloadProofArgs({
      sourceRoleUrl,
      visitedRolePath,
    }),
  };
}

export function completedPrivateChannelReloadProofArgs({
  sourceRoleUrl,
  visitedRolePath,
}) {
  return {
    sourceRoleUrl,
    visitedRolePath,
  };
}

export function staleCompletedPrivatePostAssertionCase({
  proof,
  expectedGame,
  sourceRoleUrl,
  visitedRolePath,
  assertStaleCompletedPrivatePostRecoveryProof,
  scenario = staleCompletedPrivatePostScenario(),
}) {
  return {
    assertProof: assertStaleCompletedPrivatePostRecoveryProof,
    proof: proof?.staleCompletedPostRecoveryProof,
    scenario,
    ...staleCompletedPrivatePostProofArgs({
      expectedGame,
      sourceRoleUrl,
      visitedRolePath,
    }),
  };
}

export function staleCompletedPrivatePostProofArgs({
  expectedGame,
  sourceRoleUrl,
  visitedRolePath,
}) {
  return {
    expectedGame,
    sourceRoleUrl,
    visitedRolePath,
  };
}

export function completedPrivateChannelReloadSnapshotAssertionCases({
  proof,
  scenario = completedPrivateChannelReloadScenario(),
}) {
  return [
    completedPrivateChannelReloadInitialSnapshotCase({ proof, scenario }),
    completedPrivateChannelReloadedSnapshotCase({ proof, scenario }),
  ];
}

export function completedPrivateChannelReloadInitialSnapshotCase({
  proof,
  scenario = completedPrivateChannelReloadScenario(),
}) {
  return completedPrivateChannelReloadSnapshotCase({
    label: "initial",
    snapshot: proof?.initialSnapshot,
    scenario,
  });
}

export function completedPrivateChannelReloadedSnapshotCase({
  proof,
  scenario = completedPrivateChannelReloadScenario(),
}) {
  return completedPrivateChannelReloadSnapshotCase({
    label: "reloaded",
    snapshot: proof?.reloadedSnapshot,
    scenario,
  });
}

export function completedPrivateChannelReloadSnapshotCase({
  label,
  snapshot,
  scenario = completedPrivateChannelReloadScenario(),
}) {
  return {
    label,
    snapshot,
    expectedBoundary: scenario.expectedBoundary,
  };
}

export function staleCompletedPrivatePostSnapshotAssertionCases({
  proof,
  scenario = staleCompletedPrivatePostScenario(),
}) {
  return [
    staleCompletedPrivatePostAfterRejectSnapshotCase({ proof, scenario }),
    staleCompletedPrivatePostAfterReloadSnapshotCase({ proof, scenario }),
  ];
}

export function staleCompletedPrivatePostAfterRejectSnapshotCase({
  proof,
  scenario = staleCompletedPrivatePostScenario(),
}) {
  return staleCompletedPrivatePostSnapshotCase({
    label: "afterReject",
    snapshot: proof?.snapshotAfterReject,
    rejectedBody: proof?.stalePrivatePostBody,
    scenario,
  });
}

export function staleCompletedPrivatePostAfterReloadSnapshotCase({
  proof,
  scenario = staleCompletedPrivatePostScenario(),
}) {
  return staleCompletedPrivatePostSnapshotCase({
    label: "afterReload",
    snapshot: proof?.snapshotAfterReload,
    rejectedBody: proof?.stalePrivatePostBody,
    scenario,
  });
}

export function staleCompletedPrivatePostSnapshotCase({
  label,
  snapshot,
  rejectedBody,
  scenario = staleCompletedPrivatePostScenario(),
}) {
  return {
    label,
    snapshot,
    expectedBoundary: scenario.expectedBoundary,
    rejectedBody,
  };
}
