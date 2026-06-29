export const HOST_PHASE_SUMMARY_CONTRACT = Object.freeze({
  rootClassName: "host-console-critical-path__phase",
  factsClassName: "host-console-critical-path__facts",
  statusClassName: "host-console-critical-path__status",
  componentName: "host-phase-summary",
});

export function buildHostPhaseSummaryViewModel({
  phase,
  projection,
} = {}) {
  const livePhase = projection?.phase ?? {};
  const replacement = projection?.replacement ?? {};
  const revealSummary = endgameRevealSummary(projection?.slots);
  const slotLabel = slotDisplayLabel(replacement.slotId ?? "slot-7");

  return Object.freeze({
    root: Object.freeze({
      className: HOST_PHASE_SUMMARY_CONTRACT.rootClassName,
      ariaLabelledby: "phase-heading",
      data: Object.freeze({
        component: HOST_PHASE_SUMMARY_CONTRACT.componentName,
      }),
    }),
    eyebrow: String(phase?.state ?? "unknown"),
    heading: String(phase?.label ?? "Current phase"),
    headingId: "phase-heading",
    summary: String(phase?.summary ?? "Phase state is loading."),
    statusClassName: HOST_PHASE_SUMMARY_CONTRACT.statusClassName,
    factsClassName: HOST_PHASE_SUMMARY_CONTRACT.factsClassName,
    facts: Object.freeze([
      fact({
        label: "Deadline",
        value: livePhase.deadlineLabel ?? phase?.deadlineLabel ?? "No deadline committed",
        testId: "host-console-deadline",
      }),
      fact({
        label: "Thread",
        value: livePhase.lockedLabel ?? phase?.lockedLabel ?? "Thread state unknown",
        testId: "host-console-thread-lock",
      }),
      fact({
        label: `${slotLabel} occupant`,
        value: replacement.occupantLabel ?? "Unknown occupant",
        testId: "host-console-slot-occupant",
      }),
      fact({
        label: "Lifecycle",
        value: replacement.lifecycleLabel ?? "Unknown lifecycle",
        testId: "host-console-slot-lifecycle",
      }),
      fact({
        label: "Slot history",
        value: replacement.historyLabel ?? "Slot history unavailable",
        testId: "host-console-history",
      }),
      fact({
        label: "Endgame reveal",
        value: revealSummary,
        testId: "host-console-endgame-reveal",
      }),
    ]),
  });
}

function fact({ label, value, testId }) {
  return Object.freeze({
    label,
    value: String(value),
    testId,
  });
}

function slotDisplayLabel(slotId) {
  return String(slotId)
    .replace(/^slot[-_]/, "Slot ")
    .replace(/[-_]+/g, " ");
}

function endgameRevealSummary(slots) {
  if (!Array.isArray(slots) || slots.length === 0) {
    return "Role sheet private";
  }
  const revealedCount = slots.filter(
    (slot) => slot.role_revealed === true && slot.alignment_revealed === true,
  ).length;
  if (revealedCount === slots.length) {
    return `All ${slots.length} slots revealed`;
  }
  return `${revealedCount}/${slots.length} slots revealed`;
}
