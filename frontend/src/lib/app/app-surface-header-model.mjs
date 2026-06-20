export const APP_SURFACE_HEADER_CONTRACT = Object.freeze({
  component: "fm-surface-header",
  capabilityClassName: "fm-capability-pill",
  defaultClassName: "fm-surface__masthead",
  eyebrowClassName: "fm-eyebrow",
  liveStatusClassName: "fm-live-status",
  statusStackClassName: "fm-status-stack",
  minTouchTargetPx: 44,
});

export function buildAppSurfaceHeaderViewModel({
  surface,
  eyebrow,
  title,
  summary = null,
  capabilityLabel = null,
  capabilityTestId = null,
  liveStatusTestId = null,
  className = APP_SURFACE_HEADER_CONTRACT.defaultClassName,
} = {}) {
  const existing = arguments[0];
  if (isBuiltHeader(existing)) {
    return existing;
  }

  const surfaceId = requiredText(surface, "surface");
  const heading = requiredText(title, "title");

  return Object.freeze({
    component: APP_SURFACE_HEADER_CONTRACT.component,
    surface: surfaceId,
    className,
    eyebrowClassName: APP_SURFACE_HEADER_CONTRACT.eyebrowClassName,
    statusStackClassName: APP_SURFACE_HEADER_CONTRACT.statusStackClassName,
    eyebrow: optionalText(eyebrow),
    title: heading,
    summary: optionalText(summary),
    capability:
      capabilityLabel === null || capabilityLabel === undefined
        ? Object.freeze({ visible: false })
        : Object.freeze({
            visible: true,
            label: requiredText(capabilityLabel, "capabilityLabel"),
            testId: capabilityTestId,
            className: APP_SURFACE_HEADER_CONTRACT.capabilityClassName,
            minTouchTargetPx: APP_SURFACE_HEADER_CONTRACT.minTouchTargetPx,
          }),
    liveStatus:
      liveStatusTestId === null || liveStatusTestId === undefined
        ? Object.freeze({ visible: false })
        : Object.freeze({
            visible: true,
            testId: liveStatusTestId,
            className: APP_SURFACE_HEADER_CONTRACT.liveStatusClassName,
          }),
  });
}

function isBuiltHeader(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    value.component === APP_SURFACE_HEADER_CONTRACT.component &&
    typeof value.surface === "string" &&
    typeof value.title === "string" &&
    value.capability !== undefined &&
    value.liveStatus !== undefined
  );
}

function requiredText(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`surface header ${field} must be a non-empty string`);
  }
  return value;
}

function optionalText(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(value).trim();
  return text === "" ? null : text;
}
