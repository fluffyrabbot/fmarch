export const HOST_PROMPT_RESOLUTION_HISTORY_CONTRACT = Object.freeze({
  rootClassName: "host-prompt-resolution-history",
  rowClassName: "host-prompt-resolution-history__row",
  rootTestId: "host-prompt-resolution-history",
  rowTestIdPrefix: "host-prompt-resolution",
});

export function buildHostPromptResolutionHistoryViewModel({
  hostPrompts = [],
} = {}) {
  const rows = Array.isArray(hostPrompts)
    ? hostPrompts
        .filter((prompt) => prompt?.status === "resolved")
        .map(hostPromptResolutionRow)
        .filter(Boolean)
    : [];

  return Object.freeze({
    root: Object.freeze({
      className: HOST_PROMPT_RESOLUTION_HISTORY_CONTRACT.rootClassName,
      testId: HOST_PROMPT_RESOLUTION_HISTORY_CONTRACT.rootTestId,
      ariaLabel: "Resolved host prompt outcomes",
    }),
    heading: "Resolved prompt outcomes",
    rows: Object.freeze(rows),
    empty: Object.freeze({
      message: "No resolved host prompt outcomes.",
      className: "host-console-critical-path__empty",
    }),
  });
}

function hostPromptResolutionRow(prompt) {
  const resolution = prompt.publicResolution ?? prompt.public_resolution;
  if (resolution === null || typeof resolution !== "object") {
    return null;
  }

  const promptId = String(prompt.id ?? prompt.prompt_id ?? "host-prompt");
  const row = {
    id: promptId,
    testId: `${HOST_PROMPT_RESOLUTION_HISTORY_CONTRACT.rowTestIdPrefix}-${promptId}`,
    className: HOST_PROMPT_RESOLUTION_HISTORY_CONTRACT.rowClassName,
  };
  switch (resolution.kind) {
    case "day_vote_elimination":
      return Object.freeze({
        ...row,
        label: `${resolution.phase_id ?? prompt.phaseId ?? "Day"} official elimination`,
        detail: `${slotLabel(resolution.selected_slot)} selected after host decision`,
      });
    case "phase_advance":
      return Object.freeze({
        ...row,
        label: `${resolution.source_phase_id} -> ${resolution.target_phase_id}`,
        detail: `${reasonLabel(resolution.reason)} recorded`,
      });
    case "acknowledged":
      return Object.freeze({
        ...row,
        label: `${resolution.phase_id ?? prompt.phaseId ?? "Phase"} acknowledgement`,
        detail: `${reasonLabel(resolution.reason)} recorded`,
      });
    default:
      return null;
  }
}

function slotLabel(slot) {
  const value = String(slot ?? "slot");
  const ordinal = value.match(/\d+$/)?.[0];
  return ordinal === undefined ? value : `Slot ${ordinal}`;
}

function reasonLabel(reason) {
  const value = String(reason ?? "Host resolution").replaceAll("_", " ");
  return value.charAt(0).toUpperCase() + value.slice(1);
}
