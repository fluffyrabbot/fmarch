export const HOST_LIFECYCLE_CONTROL_CHECKPOINT_CONTRACT = Object.freeze({
  proofCheckId: "host-lifecycle-control",
  rootClassName: "host-console-critical-path__lifecycle-checkpoint fm-section",
  rootTestId: "host-lifecycle-control-checkpoint",
  phaseTestId: "host-lifecycle-control-phase",
  slotTestId: "host-lifecycle-control-slot",
  actionStateTestId: "host-lifecycle-control-action-state",
  deadlineAffordanceTestId: "host-lifecycle-control-deadline-affordance",
  recoveryTestId: "host-lifecycle-control-recovery",
  statusTestId: "host-lifecycle-control-status",
  componentName: "host-lifecycle-control-checkpoint",
});

export function buildHostLifecycleControlCheckpoint({
  phase = {},
  replacement = {},
  actionGroups = [],
  commandContext = {},
} = {}) {
  const phaseActionIds = actionIdsForGroup(actionGroups, "phase");
  const lifecycleActionIds = actionIdsForGroup(actionGroups, "slot-lifecycle");
  const phaseState = phaseStateLabel(phase);
  const slotId = String(replacement.slotId ?? "slot-7");
  const lifecycleLabel = String(replacement.lifecycleLabel ?? "Unknown lifecycle");
  const enabled = lifecycleActionIds.length > 0;
  const disabledReason = enabled
    ? ""
    : lifecycleDisabledReason({ lifecycleLabel, capabilityLabel: commandContext.capabilityLabel });
  const actionState = enabled
    ? `enabled:${lifecycleActionIds.join(",")}`
    : `disabled:${disabledReason}`;
  const deadlineAffordance = phaseAffordanceLabel(phaseActionIds);

  return Object.freeze({
    root: Object.freeze({
      className: HOST_LIFECYCLE_CONTROL_CHECKPOINT_CONTRACT.rootClassName,
      testId: HOST_LIFECYCLE_CONTROL_CHECKPOINT_CONTRACT.rootTestId,
      data: Object.freeze({
        component: HOST_LIFECYCLE_CONTROL_CHECKPOINT_CONTRACT.componentName,
        proofCheckId: HOST_LIFECYCLE_CONTROL_CHECKPOINT_CONTRACT.proofCheckId,
        phaseId: String(phase.id ?? ""),
        phaseState,
        slotId,
        actionState,
        deadlineAffordance,
      }),
    }),
    heading: "Slot lifecycle checkpoint",
    proofCheckId: HOST_LIFECYCLE_CONTROL_CHECKPOINT_CONTRACT.proofCheckId,
    phase: Object.freeze({
      testId: HOST_LIFECYCLE_CONTROL_CHECKPOINT_CONTRACT.phaseTestId,
      label: "Current phase",
      value: `${String(phase.label ?? phase.id ?? "Unknown phase")} / ${phaseState}`,
    }),
    slot: Object.freeze({
      testId: HOST_LIFECYCLE_CONTROL_CHECKPOINT_CONTRACT.slotTestId,
      label: "Target slot",
      value: `${slotId} / ${lifecycleLabel}`,
    }),
    actionState: Object.freeze({
      testId: HOST_LIFECYCLE_CONTROL_CHECKPOINT_CONTRACT.actionStateTestId,
      label: "Action state",
      value: actionState,
    }),
    deadlineAffordance: Object.freeze({
      testId: HOST_LIFECYCLE_CONTROL_CHECKPOINT_CONTRACT.deadlineAffordanceTestId,
      label: "Phase affordance",
      value: deadlineAffordance,
    }),
    recovery: Object.freeze({
      testId: HOST_LIFECYCLE_CONTROL_CHECKPOINT_CONTRACT.recoveryTestId,
      label: "Stale recovery",
      value: "Reject PhaseLocked: refresh host projection and use current lifecycle controls.",
    }),
    status: Object.freeze({
      testId: HOST_LIFECYCLE_CONTROL_CHECKPOINT_CONTRACT.statusTestId,
      state: enabled ? "ack" : "pending",
      message: enabled
        ? "Host lifecycle controls are reachable from this role URL"
        : `Host lifecycle controls unavailable: ${disabledReason}`,
    }),
  });
}

function actionIdsForGroup(actionGroups, groupId) {
  const group = actionGroups.find((candidate) => candidate?.id === groupId);
  if (!Array.isArray(group?.actions)) {
    return [];
  }
  return group.actions.map((action) => String(action.id)).filter((id) => id !== "");
}

function phaseStateLabel(phase) {
  if (phase?.locked === true || phase?.state === "locked") {
    return "locked";
  }
  if (phase?.locked === false || phase?.state === "open") {
    return "open";
  }
  return "unknown";
}

function phaseAffordanceLabel(actionIds) {
  const affordances = actionIds.filter((id) =>
    ["resolve_phase", "advance_phase", "advance_phase_by_deadline", "lock_thread", "unlock_thread"].includes(id),
  );
  return affordances.length === 0 ? "none" : affordances.join(",");
}

function lifecycleDisabledReason({ lifecycleLabel, capabilityLabel }) {
  if (!/^HostOf\(/.test(String(capabilityLabel ?? ""))) {
    return "requires HostOf capability";
  }
  if (/dead|modkill/i.test(lifecycleLabel)) {
    return "slot lifecycle is terminal";
  }
  return "no lifecycle command available";
}
