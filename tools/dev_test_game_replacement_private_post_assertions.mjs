const hasCapability = (entry, capability) =>
  entry?.capabilityKinds?.includes(capability) === true;

const replacementCommand = (proof) =>
  proof?.replacement?.requestEnvelope?.body?.body?.command?.ProcessReplacement;

const completedCommand = (proof) =>
  proof?.complete?.commandStatus?.requestEnvelope?.body?.body?.command
    ?.CompleteGame;

const rejectedSubmitPostCommand = (proof) =>
  proof?.reject?.requestEnvelope?.body?.body?.command?.SubmitPost;

const principalUserIdFromReject = (proof) =>
  proof?.reject?.requestEnvelope?.body?.body?.principal_user_id;

const completedCommandStateMatches = (commandState, scenario) =>
  commandState?.actorSlot === scenario.actorSlot &&
  commandState?.gameCompleted === true &&
  commandState?.actions?.length === 0 &&
  commandState?.voteTargets?.length === 0 &&
  commandState?.boundary?.includes(scenario.commandStateBoundaryFragment) ===
    true;

const completedApiCommandStateMatches = (commandState) =>
  commandState?.game_completed === true &&
  commandState?.actions?.length === 0 &&
  commandState?.vote_targets?.length === 0;

const disabledButtons = (buttons) =>
  buttons?.some((button) => button.disabled !== true) === false;

const channelContextMatches = (context, scenario) =>
  context?.channelId === scenario.channelId &&
  context?.actorSlot === scenario.actorSlot;

const channelContextHasMemberCapability = (context, scenario) =>
  channelContextMatches(context, scenario) &&
  context?.capabilityLabel?.includes(`ChannelMember(${scenario.channelId})`) ===
    true;

const threadDoesNotIncludePost = (posts, proof) =>
  posts?.includes(proof?.postBody) === false;

export function replacementCompletedPrivatePostRejectMatches(
  proof,
  scenario,
) {
  const replacement = replacementCommand(proof);
  const rejectedPost = rejectedSubmitPostCommand(proof);
  return (
    proof?.status === "passed" &&
    proof?.channel === scenario.channelId &&
    hasCapability(proof?.hostEntry, "HostOf") &&
    hasCapability(proof?.staleOutgoingEntry, "SlotOccupant") &&
    hasCapability(proof?.replacementEntry, "SlotOccupant") &&
    proof?.replacement?.state === "ack" &&
    replacement?.slot === scenario.actorSlot &&
    replacement?.incoming_user === scenario.replacementPrincipalUserId &&
    proof?.hostReplacementAfterProcess?.occupantLabel ===
      scenario.replacementOccupantLabel &&
    proof?.commandStateBeforeClose?.actorSlot === scenario.actorSlot &&
    proof?.commandStateBeforeClose?.gameCompleted === false &&
    channelContextHasMemberCapability(
      proof?.channelContextBeforeClose,
      scenario,
    ) &&
    proof?.submitPostBeforeClose?.disabled === false &&
    proof?.closedStatus?.state === "closed" &&
    proof?.complete?.commandStatus?.state === "ack" &&
    completedCommand(proof)?.game === proof?.game &&
    proof?.hostSlotsAfterComplete?.some(
      (slot) => slot.role_revealed !== true || slot.alignment_revealed !== true,
    ) === false &&
    proof?.hostActionsAfterComplete?.includes("complete_game") === false &&
    proof?.apiStateAfterComplete?.completed === true &&
    proof?.reject?.state === "reject" &&
    proof?.reject?.error === scenario.commandError &&
    proof?.reject?.serverEnvelope?.body?.kind === "Reject" &&
    Array.isArray(proof?.reject?.streamSeqs) === false &&
    principalUserIdFromReject(proof) === scenario.replacementPrincipalUserId &&
    rejectedPost?.channel_id === scenario.channelId &&
    rejectedPost?.actor_slot === scenario.actorSlot &&
    rejectedPost?.body === proof?.postBody &&
    proof?.dispatchPlan?.projectionRefreshKeys?.includes("commandState") ===
      true &&
    proof?.currentReceipt?.actionId === scenario.commandAction &&
    proof?.currentReceipt?.state === "reject" &&
    proof?.receiptStatusText?.includes(`Reject ${scenario.commandError}`) ===
      true &&
    completedCommandStateMatches(proof?.commandStateAfterReject, scenario) &&
    channelContextMatches(proof?.channelContextAfterReject, scenario) &&
    disabledButtons(proof?.buttonsAfterReject) &&
    completedApiCommandStateMatches(proof?.apiCommandStateAfterReject) &&
    threadDoesNotIncludePost(proof?.apiThreadPostBodies, proof) &&
    proof?.staleOutgoingRouteAfterReject?.status === 403 &&
    proof?.staleOutgoingThreadAfterReject?.status === 403
  );
}

export function replacementCompletedPrivatePostReloadMatches(
  proof,
  reloadProof,
  scenario,
) {
  return (
    proof?.status === "passed" &&
    proof?.channel === scenario.channelId &&
    proof?.reject?.error === scenario.commandError &&
    reloadProof?.status === "passed" &&
    reloadProof?.routeResponseStatus === 200 &&
    reloadProof?.threadPagerVisible === true &&
    completedCommandStateMatches(reloadProof?.recoveredCommandState, scenario) &&
    channelContextHasMemberCapability(
      reloadProof?.reloadChannelContext,
      scenario,
    ) &&
    disabledButtons(reloadProof?.reloadButtons) &&
    reloadProof?.reloadRejectedPostVisible === false &&
    threadDoesNotIncludePost(reloadProof?.reloadThreadPostBodies, proof) &&
    completedApiCommandStateMatches(reloadProof?.apiCommandStateAfterReload) &&
    threadDoesNotIncludePost(
      reloadProof?.apiThreadPostBodiesAfterReload,
      proof,
    ) &&
    reloadProof?.staleOutgoingRouteAfterReload?.status === 403 &&
    reloadProof?.staleOutgoingRouteAfterReload?.responseStatus === 403 &&
    reloadProof?.staleOutgoingThreadAfterReload?.status === 403
  );
}
