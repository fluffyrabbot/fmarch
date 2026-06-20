export const APP_STATUS_STRIP_CONTRACT = Object.freeze({
  rootClassName: "fm-status-strip",
  itemClassName: "fm-status-strip__item",
  statusClassName: "fm-status-strip__status",
  componentName: "app-status-strip",
});

export function statusStripRootClassName(className = "") {
  return joinClassNames(APP_STATUS_STRIP_CONTRACT.rootClassName, className);
}

export function statusStripItemClassName(className = "") {
  return joinClassNames(APP_STATUS_STRIP_CONTRACT.itemClassName, className);
}

export function statusStripStatusClassName(className = "") {
  return joinClassNames(APP_STATUS_STRIP_CONTRACT.statusClassName, className);
}

function joinClassNames(...classNames) {
  return classNames
    .map((className) => String(className ?? "").trim())
    .filter(Boolean)
    .join(" ");
}
