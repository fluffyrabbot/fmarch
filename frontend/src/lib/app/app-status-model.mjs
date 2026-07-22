export const APP_STATUS_BASE_CLASS = "fm-status";

export function buildAppStatusViewModel({
  status = null,
  testId,
  className = "",
  politeness = "polite",
} = {}) {
  if (status === null || status === undefined) {
    return Object.freeze({ visible: false });
  }

  const state = String(status.state ?? "info");
  return Object.freeze({
    visible: true,
    className: [APP_STATUS_BASE_CLASS, className].filter(Boolean).join(" "),
    state,
    message: String(status.message ?? ""),
    testId,
    role: "status",
    ariaLive:
      state === "reject" || state === "error" || state === "interrupted"
        ? "assertive"
        : politeness,
    ariaAtomic: "true",
  });
}
