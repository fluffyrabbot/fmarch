export function replacementCommandEnvelopeMatches(commandStatus, scenario, game) {
  const body = commandStatus?.requestEnvelope?.body?.body;
  const command = body?.command?.ProcessReplacement;
  return (
    command?.game === game &&
    command?.slot === scenario.actorSlot &&
    command?.outgoing_user === scenario.staleOutgoingPrincipalUserId &&
    command?.incoming_user === scenario.replacementPrincipalUserId &&
    (scenario.hostPrincipalUserId === undefined ||
      body?.principal_user_id === undefined ||
      body.principal_user_id === scenario.hostPrincipalUserId)
  );
}

export function ackedReplacementCommandMatches(commandStatus, scenario, game) {
  return (
    commandStatus?.state === "ack" &&
    commandStatus?.serverEnvelope?.body?.kind === "Ack" &&
    replacementCommandEnvelopeMatches(commandStatus, scenario, game)
  );
}

export function replacementCurrentOwnerMatches(
  { hostProjection = null, apiSlot = null } = {},
  scenario,
) {
  const expectedLabel =
    scenario.replacementOccupantLabel ?? scenario.replacementPrincipalUserId;
  return (
    (hostProjection === null ||
      ((hostProjection?.slotId === undefined ||
        hostProjection.slotId === scenario.actorSlot) &&
        hostProjection?.occupantLabel === expectedLabel &&
        (hostProjection?.historyLabel === undefined ||
          hostProjection.historyLabel.includes(scenario.actorSlot)))) &&
    (apiSlot === null ||
      ((apiSlot?.slot_id === undefined || apiSlot.slot_id === scenario.actorSlot) &&
        apiSlot?.occupant_user_id === scenario.replacementPrincipalUserId))
  );
}

export function staleOutgoingCommandStateForbidden(commandState, scenario) {
  const expectedError =
    scenario.staleOutgoingError ?? scenario.rejectionError ?? "NotYourSlot";
  return commandState?.status === 403 && commandState?.error === expectedError;
}
