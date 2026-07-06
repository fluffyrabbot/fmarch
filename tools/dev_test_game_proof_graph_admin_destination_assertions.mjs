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

function summaryRowTextVisible(row, visibleStatus) {
  return [row.label, ...String(row.status ?? "").split("\n")]
    .map((token) => String(token ?? "").trim())
    .filter((token) => token !== "")
    .every((token) => String(visibleStatus ?? "").includes(token));
}
