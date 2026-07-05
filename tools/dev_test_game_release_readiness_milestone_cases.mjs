export const recoveryMilestoneCoverageCases = Object.freeze([
  Object.freeze({
    checkId: "local-stale-conflict-message-milestone",
    generatedFromKey: "staleConflictMessageMilestone",
    coverageKey: "staleConflictMessageCoverage",
    label: "Stale-client conflict messages",
    proofBoundary:
      "Local seeded-game proof that stale replacement, player action, dead-actor action, host deadline, and cohost deadline paths show explicit conflict messages and current-control recovery hints.",
    hasSurfaceCoverage: true,
    hasSurfaceChecks: true,
  }),
  Object.freeze({
    checkId: "local-host-stale-control-milestone",
    generatedFromKey: "hostStaleControlMilestone",
    coverageKey: "hostStaleControlCoverage",
    label: "Host stale-control recovery",
    proofBoundary:
      "Local seeded-game proof that stale host publish, lifecycle, modkill, prompt, complete, resolve, advance, and deadline controls reject drift and recover through current host role surfaces.",
  }),
  Object.freeze({
    checkId: "local-private-channel-recovery-milestone",
    generatedFromKey: "privateChannelRecoveryMilestone",
    coverageKey: "coreLoopPrivateChannelRecoveryCoverage",
    label: "Private-channel recovery",
    proofBoundary:
      "Local seeded-game proof that stale replacement private-channel authority, private receipts, stale private posts after phase resolution, private-channel invalid action recovery, reconnect recovery, and completed-game private-channel reloads preserve current player scope and recovery hints.",
  }),
  Object.freeze({
    checkId: "local-replacement-private-recovery-milestone",
    generatedFromKey: "replacementPrivateRecoveryMilestone",
    coverageKey: "replacementPrivateChannelRecoveryCoverage",
    label: "Replacement private-channel recovery",
    proofBoundary:
      "Local seeded-game proof that replacement private-channel authority, private receipts, stale replacement private posts after phase resolution, reconnect recovery, and completed-game reloads preserve current replacement player scope and stale outgoing denial.",
  }),
  Object.freeze({
    checkId: "local-replacement-action-recovery-milestone",
    generatedFromKey: "replacementActionRecoveryMilestone",
    coverageKey: "replacementActionRecoveryCoverage",
    label: "Replacement action recovery",
    proofBoundary:
      "Local seeded-game proof that incoming replacement factional_kill actions resolve, reconnect to locked post-resolution state, and stale replacement action controls reject after phase resolution without leaking target receipts.",
  }),
  Object.freeze({
    checkId: "local-replacement-handoff-recovery-milestone",
    generatedFromKey: "replacementHandoffRecoveryMilestone",
    coverageKey: "replacementHandoffRecoveryCoverage",
    label: "Replacement handoff recovery",
    proofBoundary:
      "Local seeded-game proof that host-issued replacement role URLs, pending and invalid replacement states, replacement session recovery, stale and duplicate replacement commands, stale outgoing authority, private-channel authority, reconnect recovery, and incoming player control all preserve current slot ownership.",
  }),
]);

export const proofRunLaneCoverageMilestoneIds = Object.freeze(
  recoveryMilestoneCoverageCases.map((scenario) => scenario.checkId),
);
