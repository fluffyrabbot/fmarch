export function normalizeSpineRowKind(row) {
  return row?.rowKind === "recovery-hook" ? "recovery-hook" : "checkpoint";
}

export function selectedSpineDeclarationStatus(declaration) {
  return `${declaration.featureSlotId}:${[
    declaration.cycleId,
    selectedSpineRowStatusId(declaration),
    declaration.roleUrlId,
    declaration.adminCheckId,
  ].join("/")}`;
}

export function selectedSpineTargetStatus(target) {
  return [
    target.cycleId,
    selectedSpineRowStatusId(target),
    target.roleUrlId,
    target.adminCheckId,
  ].join("/");
}

export function selectedSpineDrilldownStatus(drilldown) {
  return `${drilldown.featureSlotId}:${[
    drilldown.cycleRowId,
    selectedSpineDrilldownRowStatusId(drilldown),
    drilldown.roleUrlRowId,
    drilldown.adminCheckId,
  ].join("/")}`;
}

function selectedSpineRowStatusId(row) {
  return (
    normalizeSpineRowKind(row) === "recovery-hook" &&
    row.recoveryHookId !== ""
  )
    ? `recovery-hook:${row.recoveryHookId}`
    : row.checkpointId;
}

function selectedSpineDrilldownRowStatusId(row) {
  return (
    normalizeSpineRowKind(row) === "recovery-hook" &&
    row.recoveryHookRowId !== ""
  )
    ? `recovery-hook:${row.recoveryHookRowId}`
    : row.checkpointRowId;
}
