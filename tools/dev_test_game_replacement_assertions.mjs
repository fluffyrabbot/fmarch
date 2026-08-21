export function replacementCommandEnvelopeMatches(commandStatus, scenario, game) {
  const body = commandStatus?.requestEnvelope?.body?.body;
  const command = body?.command?.ProcessReplacement;
  return (
    command?.game === game &&
    command?.slot === scenario.actorSlot &&
    typeof command?.outgoing_persona_id === "string" &&
    command.outgoing_persona_id.trim() !== "" &&
    command?.incoming_principal_id === scenario.replacementPrincipalUserId &&
    body?.principal_user_id === undefined
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
  return (
    (hostProjection === null ||
      ((hostProjection?.slotId === undefined ||
        hostProjection.slotId === scenario.actorSlot) &&
        hostProjection?.assignedPrincipalId ===
          scenario.replacementPrincipalUserId &&
        (hostProjection?.historyLabel === undefined ||
          hostProjection.historyLabel.includes(scenario.actorSlot)))) &&
    (apiSlot === null ||
      ((apiSlot?.slot_id === undefined || apiSlot.slot_id === scenario.actorSlot) &&
        apiSlot?.assigned_principal_id === scenario.replacementPrincipalUserId))
  );
}

export function staleOutgoingCommandStateForbidden(commandState, scenario) {
  const expectedError =
    scenario.staleOutgoingError ?? scenario.rejectionError ?? "NotYourSlot";
  return commandState?.status === 403 && commandState?.error === expectedError;
}
