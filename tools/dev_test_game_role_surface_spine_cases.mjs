import {
  cohostFeatureSpineSource,
  cohostFeatureSpineTargetRows,
} from "./dev_test_game_cohost_feature_spine_targets.mjs";
import {
  hostSetupFeatureSpineSource,
  hostSetupFeatureSpineTargetRows,
} from "./dev_test_game_host_setup_feature_spine_targets.mjs";
import {
  replacementFeatureSpineSource,
  replacementFeatureSpineTargetRows,
} from "./dev_test_game_replacement_feature_spine_targets.mjs";
import {
  replacementActionFeatureSpineSource,
  replacementActionFeatureSpineTargetRows,
} from "./dev_test_game_replacement_action_feature_spine_targets.mjs";
import {
  replacementPrivateFeatureSpineSource,
  replacementPrivateFeatureSpineTargetRows,
} from "./dev_test_game_replacement_private_feature_spine_targets.mjs";

export const roleSurfaceSpineCases = Object.freeze({
  hostSetup: Object.freeze({
    generatedFromKey: "hostSetupFeatureTarget",
    label: "host setup",
    readinessLabel: "Host setup role URL, policy, roster, and recovery proof",
    source: hostSetupFeatureSpineSource,
    targetRow: hostSetupFeatureSpineTargetRows.hostSetupRoute,
    visibleAdminCheckIds: Object.freeze(["start-phase"]),
    readinessDetails: (evidence) => ({
      capabilityLabel: evidence.capabilityLabel,
      readyCheckIds: evidence.readyCheckIds,
      browserWorkbench: evidence.browserWorkbench,
      setupMutationStatus: evidence.setupMutationStatus,
      policyCommandStatus: evidence.policyCommandStatus,
    }),
  }),
  cohost: Object.freeze({
    generatedFromKey: "cohostFeatureTarget",
    label: "cohost console",
    readinessLabel: "Cohost role URL delegated host-console proof",
    proofBoundary:
      "Seeded dev-test-game cohost role URL proof from proof-run. Proves delegated deadline control and NotHost rejection for host-only resolve; does not prove hosted identity, multi-node races, release readiness, or production readiness.",
    source: cohostFeatureSpineSource,
    targetRow: cohostFeatureSpineTargetRows.cohostConsole,
    visibleAdminCheckIds: Object.freeze(["cohost-console"]),
    readinessDetails: (evidence) => ({
      capabilityLabel: evidence.capabilityLabel,
      extendDeadlineState: evidence.extendDeadlineState,
      extendDeadlinePrincipal: evidence.extendDeadlinePrincipal,
      hostOnlyRejectError: evidence.hostOnlyRejectError,
      hostOnlyRejectPrincipal: evidence.hostOnlyRejectPrincipal,
      phaseAfterRejectId: evidence.phaseAfterRejectId,
      phaseAfterRejectLocked: evidence.phaseAfterRejectLocked,
    }),
  }),
  replacement: Object.freeze({
    generatedFromKey: "replacementFeatureTarget",
    label: "replacement player",
    readinessLabel: "Replacement player role URL proof",
    proofBoundary:
      "Seeded dev-test-game replacement player role URL proof from proof-run. Proves host-issued replacement URL, fresh replacement session recovery, incoming player slot authority, stale outgoing player rejection, and private-channel authority transfer; does not prove hosted identity, invite delivery, multi-node races, release readiness, or production readiness.",
    source: replacementFeatureSpineSource,
    targetRow: replacementFeatureSpineTargetRows.replacementPlayer,
    visibleAdminCheckIds: Object.freeze([
      "replacement-incoming-player",
      "replacement-stale-player",
    ]),
    buildVisibleAdminCheckIds: Object.freeze([
      "replacement-host-issued-invite",
      "replacement-session-refresh-recovery",
      "replacement-incoming-player",
      "replacement-stale-player",
      "replacement-stale-private-channel",
      "replacement-stale-private-receipts",
    ]),
    readinessDetails: (evidence) => ({
      principalUserId: evidence.principalUserId,
      commandStateSlot: evidence.commandStateSlot,
      capabilityKinds: evidence.capabilityKinds,
      hostIssuedInvite: evidence.hostIssuedInvite,
      sessionRefresh: evidence.sessionRefresh,
      incomingPlayer: evidence.incomingPlayer,
      staleOutgoing: evidence.staleOutgoing,
      privateAuthority: evidence.privateAuthority,
    }),
  }),
  replacementAction: Object.freeze({
    generatedFromKey: "replacementActionFeatureTarget",
    label: "replacement action",
    readinessLabel: "Replacement action recovery role URL proof",
    proofBoundary:
      "Seeded dev-test-game replacement action role URL proof from proof-run. Proves incoming replacement factional_kill submission, reconnect into locked resolved state, stale replacement action PhaseLocked recovery, and scoped target receipt visibility; does not prove hosted identity, hosted transport, multi-node races, release readiness, or production readiness.",
    source: replacementActionFeatureSpineSource,
    targetRow: replacementActionFeatureSpineTargetRows.replacementActionRecovery,
    visibleAdminCheckIds: Object.freeze([
      "replacement-incoming-action",
      "replacement-action-reconnect",
      "replacement-stale-action-after-resolve",
    ]),
    readinessDetails: (evidence) => ({
      incomingAction: evidence.incomingAction,
      reconnect: evidence.reconnect,
      staleAction: evidence.staleAction,
    }),
  }),
  replacementPrivate: Object.freeze({
    generatedFromKey: "replacementPrivateFeatureTarget",
    label: "replacement private",
    readinessLabel: "Replacement private-channel recovery role URL proof",
    proofBoundary:
      "Seeded dev-test-game replacement private-channel role URL proof from proof-run. Proves current replacement private-channel authority, stale outgoing private-channel and receipt denial, stale private-post ACK and reconnect recovery after resolution, completed-game private-post rejection, and completed private-channel reload; does not prove hosted identity, hosted transport, release readiness, or production readiness.",
    source: replacementPrivateFeatureSpineSource,
    targetRow: replacementPrivateFeatureSpineTargetRows.replacementPrivateChannel,
    visibleAdminCheckIds: Object.freeze([
      "replacement-stale-private-channel",
      "replacement-stale-private-post-after-complete-reload",
    ]),
    buildVisibleAdminCheckIds: Object.freeze([
      "replacement-stale-private-channel",
      "replacement-stale-private-receipts",
      "replacement-stale-private-post-after-resolve",
      "replacement-stale-private-post-reconnect",
      "replacement-stale-private-post-after-complete",
      "replacement-stale-private-post-after-complete-reload",
    ]),
    readinessDetails: (evidence) => ({
      authority: evidence.authority,
      receipts: evidence.receipts,
      resolvedPost: evidence.resolvedPost,
      reconnect: evidence.reconnect,
      completedPost: evidence.completedPost,
      completedReload: evidence.completedReload,
    }),
  }),
});

export const roleSurfaceSpineCaseList = Object.freeze(
  Object.values(roleSurfaceSpineCases),
);

export function roleSurfaceBrowserWorkbenchEvidence(roleSurfaceCase, roleUrl) {
  const route = String(roleUrl ?? "").replace(/^https?:\/\/[^/]+/, "");
  const roleSurface = String(roleSurfaceCase.label ?? "")
    .trim()
    .replace(/\s+/g, "-");
  return Object.freeze({
    status: "passed",
    route,
    roleUrl: String(roleUrl ?? ""),
    roleSurface,
    featureSlotId: String(roleSurfaceCase.targetRow?.featureSlotId ?? ""),
    requiredEvidence: `Seeded ${roleSurfaceCase.label} role URL opens ${route} in the browser proof before ${roleSurfaceCase.targetRow.adminCheckId} recovery is trusted.`,
  });
}
