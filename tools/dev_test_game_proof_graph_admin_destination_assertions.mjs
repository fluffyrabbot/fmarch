export function assertProofGraphAdminVisibleRelatedDestinations({
  proof,
  generatedDestinations,
  expectedDestinations,
  idKey,
  requiredIdKey = idKey,
  requiredIdsKey,
  visibleIdsKey,
  requiredTextKey,
  visibleTextKey,
  missingDestinationMessage,
  missingLinkMessage,
  missingVisitMessage,
  missingTextMessage,
}) {
  const visibleDestinations = Array.isArray(
    proof?.adminRoleSurface?.visibleRelatedDestinations,
  )
    ? proof.adminRoleSurface.visibleRelatedDestinations
    : [];
  const destinationById = new Map(
    (generatedDestinations ?? []).map((destination) => [
      destination?.[idKey],
      destination,
    ]),
  );
  for (const expectedDestination of expectedDestinations ?? []) {
    const destinationId = expectedDestination?.[idKey];
    const requiredId = expectedDestination?.[requiredIdKey];
    const destination = destinationById.get(destinationId);
    if (
      destination?.linkId !== expectedDestination.linkId ||
      destination?.auditId !== expectedDestination.auditId ||
      destination?.detailRoleUrl !== expectedDestination.detailRoleUrl ||
      !destination?.[requiredIdsKey]?.includes(requiredId)
    ) {
      throw new Error(missingDestinationMessage(destinationId));
    }
    if (
      !proof?.adminRoleSurface?.visibleRelatedLinks?.includes(
        destination.linkId,
      )
    ) {
      throw new Error(missingLinkMessage({ destination, destinationId }));
    }
    const visibleDestination = visibleDestinations.find(
      (item) =>
        item.linkId === destination.linkId &&
        item.auditId === destination.auditId,
    );
    if (
      visibleDestination?.detailRoleUrl !== expectedDestination.detailRoleUrl ||
      !visibleDestination?.[visibleIdsKey]?.includes(requiredId)
    ) {
      throw new Error(missingVisitMessage(destinationId));
    }
    if (
      requiredTextKey === undefined ||
      visibleTextKey === undefined ||
      missingTextMessage === undefined
    ) {
      continue;
    }
    const visibleText =
      visibleDestination?.[visibleTextKey]?.[destinationId] ?? "";
    for (const token of expectedDestination?.[requiredTextKey]?.[
      destinationId
    ] ?? []) {
      if (!visibleText.includes(token)) {
        throw new Error(missingTextMessage({ destinationId, token }));
      }
    }
  }
}

export function assertProofGraphAdminVisibleSummaryRows({
  proof,
  rows,
  visibleRowIdsKey,
  visibleRowStatusesKey,
  missingRowMessage,
  textDriftMessage,
}) {
  for (const row of rows ?? []) {
    if (!proof?.adminRoleSurface?.[visibleRowIdsKey]?.includes(row.id)) {
      throw new Error(missingRowMessage(row.id));
    }
    const visibleStatus =
      proof?.adminRoleSurface?.[visibleRowStatusesKey]?.[row.id] ?? "";
    if (!summaryRowTextVisible(row, visibleStatus)) {
      throw new Error(textDriftMessage(row.id));
    }
  }
}

export function assertProofGraphAdminProductionFeatureDestinationTargetRows({
  proof,
  summary,
  destinations,
}) {
  const rows = Array.isArray(summary?.rows) ? summary.rows : [];
  const productionRows = rows.filter((row) =>
    String(row?.id ?? "").startsWith("production-feature:"),
  );
  if (productionRows.length !== destinations.length) {
    throw new Error(
      "proof graph admin proof production feature destination row count drifted",
    );
  }
  const visibleRowIds = Array.isArray(
    proof?.adminRoleSurface?.visibleProductionFeatureDestinationSummaries,
  )
    ? proof.adminRoleSurface.visibleProductionFeatureDestinationSummaries
    : [];
  const visibleRowStatuses =
    proof?.adminRoleSurface?.visibleProductionFeatureDestinationSummaryStatuses ??
    {};
  for (const destination of destinations) {
    const matchingRows = productionRows.filter(
      (row) => row.id === destination.linkId,
    );
    if (matchingRows.length !== 1) {
      throw new Error(
        `proof graph admin proof missing exact production feature destination row: ${destination.linkId}`,
      );
    }
    const row = matchingRows[0];
    const visibleCount = visibleRowIds.filter(
      (rowId) => rowId === destination.linkId,
    ).length;
    if (visibleCount !== 1) {
      throw new Error(
        `proof graph admin proof missing exact visible production feature destination row: ${destination.linkId}`,
      );
    }
    const expectedDetailRoleUrl =
      destination.kind === "admin-audit"
        ? destination.detailRoleUrl
        : destination.adminDetailRoleUrl;
    if (
      row.targetRoleUrl !== destination.targetRoleUrl ||
      (destination.kind === "admin-audit" &&
        row.detailRoleUrl !== destination.detailRoleUrl) ||
      (destination.kind === "role-url" &&
        row.roleUrl !== destination.roleUrl) ||
      (expectedDetailRoleUrl !== undefined &&
        expectedDetailRoleUrl !== "" &&
        row.adminDetailRoleUrl !== expectedDetailRoleUrl &&
        row.detailRoleUrl !== expectedDetailRoleUrl)
    ) {
      throw new Error(
        `proof graph admin proof production feature destination row drifted: ${destination.linkId}`,
      );
    }
    const visibleStatus = String(visibleRowStatuses[destination.linkId] ?? "");
    for (const token of [
      row.targetRoleUrl,
      expectedDetailRoleUrl,
      destination.adminCheckId,
      destination.sourceCheckId,
    ]) {
      if (String(token ?? "") !== "" && !visibleStatus.includes(token)) {
        throw new Error(
          `proof graph admin proof production feature destination row text drifted: ${destination.linkId}`,
        );
      }
    }
  }
}

function summaryRowTextVisible(row, visibleStatus) {
  return [row.label, ...String(row.status ?? "").split("\n")]
    .map((token) => String(token ?? "").trim())
    .filter((token) => token !== "")
    .every((token) => String(visibleStatus ?? "").includes(token));
}
