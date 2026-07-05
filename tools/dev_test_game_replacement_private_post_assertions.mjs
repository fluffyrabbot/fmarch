const hasCapability = (entry, capability) =>
  entry?.capabilityKinds?.includes(capability) === true;

const replacementCommand = (proof) =>
  proof?.replacement?.requestEnvelope?.body?.body?.command?.ProcessReplacement;

const completedCommand = (proof) =>
  proof?.complete?.commandStatus?.requestEnvelope?.body?.body?.command
    ?.CompleteGame;

const rejectedSubmitPostCommand = (proof) =>
  proof?.reject?.requestEnvelope?.body?.body?.command?.SubmitPost;

const ackedSubmitPostCommand = (proof) =>
  proof?.stalePost?.requestEnvelope?.body?.body?.command?.SubmitPost;

const principalUserIdFromAckedPost = (proof) =>
  proof?.stalePost?.requestEnvelope?.body?.body?.principal_user_id;

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

const lockedDayOneCommandStateMatches = (
  commandState,
  scenario,
  { requireActorStatus = false, requireNoVoteTargets = true } = {},
) =>
  commandState?.actorSlot === scenario.actorSlot &&
  (!requireActorStatus || commandState?.actorStatus === "alive") &&
  commandState?.phase?.phaseId === "D01" &&
  commandState?.phase?.locked === true &&
  (!requireNoVoteTargets || commandState?.voteTargets?.length === 0);

const lockedDayOneApiCommandStateMatches = (commandState) =>
  commandState?.phase?.phase_id === "D01" &&
  commandState?.phase?.locked === true &&
  commandState?.vote_targets?.length === 0;

const disabledButtons = (buttons) =>
  buttons?.some((button) => button.disabled !== true) === false;

const enabledSubmitPostButtonPresent = (buttons, scenario) =>
  buttons?.some(
    (button) =>
      button.action === scenario.commandAction && button.disabled === false,
  ) === true;

const noVoteButtonsPresent = (buttons) =>
  buttons?.some((button) => button.action?.startsWith("submit_vote")) === false;

const channelContextMatches = (context, scenario) =>
  context?.channelId === scenario.channelId &&
  context?.actorSlot === scenario.actorSlot;

const channelContextHasMemberCapability = (context, scenario) =>
  channelContextMatches(context, scenario) &&
  context?.capabilityLabel?.includes(`ChannelMember(${scenario.channelId})`) ===
    true;

const threadDoesNotIncludePost = (posts, proof) =>
  posts?.includes(proof?.postBody) === false;

const threadIncludesPost = (posts, postBody) => posts?.includes(postBody) === true;

const submitPostCommandProof = ({ proof, commandStatus, postBody }) => {
  const command = commandStatus?.requestEnvelope?.body?.body?.command?.SubmitPost ??
    commandStatus?.command?.SubmitPost ??
    {};
  return {
    game: proof?.game ?? command.game ?? null,
    channel_id: command.channel_id ?? null,
    actor_slot: command.actor_slot ?? null,
    body: command.body ?? postBody ?? null,
  };
};

const bridgePlanProof = ({ scenario, finalState, refreshKeys }) => ({
  role: "player",
  commandKind: scenario.commandKind,
  commandEndpoint: "/commands",
  finalState,
  projectionRefreshKeys: refreshKeys,
});

const receiptList = (receipt) => (receipt === undefined ? [] : [receipt]);

const buttonsDisabled = (buttons) =>
  Array.isArray(buttons) && buttons.some((button) => button.disabled !== true) === false;

export function buildReplacementResolvedPrivatePostAckProof(proof, scenario) {
  const refreshKeys = proof?.dispatchPlan?.projectionRefreshKeys ?? [];
  return {
    status: replacementResolvedPrivatePostAckMatches(proof, scenario)
      ? "passed"
      : "failed",
    clickedAction: scenario.commandAction,
    commandKind: scenario.commandKind,
    command: submitPostCommandProof({
      proof,
      commandStatus: proof?.stalePost,
      postBody: proof?.postBody,
    }),
    commandStatus: proof?.stalePost ?? null,
    bridgePlan: bridgePlanProof({
      scenario,
      finalState: "ack",
      refreshKeys,
    }),
    receipts: receiptList(proof?.currentReceipt),
    privatePostBody: proof?.postBody ?? null,
    projectionCommandState: proof?.commandStateAfterAck ?? null,
    channelContext: proof?.channelContextAfterAck ?? null,
    projectionThread: {
      posts: [proof?.projectedPost].filter(Boolean),
      postBodies: proof?.apiThreadPostBodies ?? [],
    },
    staleOutgoingRouteStatus: proof?.staleOutgoingRouteAfterAck?.status ?? null,
    staleOutgoingThreadStatus: proof?.staleOutgoingThreadAfterAck?.status ?? null,
    receiptStatusText: proof?.receiptStatusText ?? null,
    receiptRefreshKeys: refreshKeys.join(","),
  };
}

export function buildReplacementResolvedPrivatePostReconnectProof(
  proof,
  reconnectProof,
  scenario,
) {
  const reconnectCommand = reconnectProof?.reconnectCommand?.command?.SubmitPost;
  return {
    status: replacementResolvedPrivatePostReconnectMatches(
      proof,
      reconnectProof,
      scenario,
    )
      ? "passed"
      : "failed",
    clickedAction: scenario.commandAction,
    commandKind: scenario.commandKind,
    command: {
      game: proof?.game ?? reconnectCommand?.game ?? null,
      channel_id: reconnectCommand?.channel_id ?? null,
      actor_slot: reconnectCommand?.actor_slot ?? null,
      body: reconnectCommand?.body ?? reconnectProof?.reconnectPostBody ?? null,
    },
    principalUserId: reconnectProof?.reconnectCommand?.principalUserId ?? null,
    reconnectingStatus: reconnectProof?.reconnectingStatus ?? null,
    reconnectRecoveryEvent: reconnectProof?.reconnectRecoveryEvent ?? null,
    recoveredCommandState: reconnectProof?.recoveredCommandState ?? null,
    channelContext:
      reconnectProof?.reconnectChannelContextAfterRecovery ?? null,
    reconnectPostBody: reconnectProof?.reconnectPostBody ?? null,
    recoveredSnapshotContainsPost:
      reconnectProof?.recoveredSnapshotContainsPost ?? null,
    apiThreadPostBodiesAfterReconnect:
      reconnectProof?.apiThreadPostBodiesAfterReconnect ?? [],
    staleOutgoingThreadStatus:
      reconnectProof?.staleOutgoingThreadAfterReconnect?.status ?? null,
  };
}

export function buildReplacementCompletedPrivatePostRejectProof(
  proof,
  scenario,
) {
  const refreshKeys = proof?.dispatchPlan?.projectionRefreshKeys ?? [];
  return {
    status: replacementCompletedPrivatePostRejectMatches(proof, scenario)
      ? "passed"
      : "failed",
    clickedAction: scenario.commandAction,
    commandKind: scenario.commandKind,
    command: submitPostCommandProof({
      proof,
      commandStatus: proof?.reject,
      postBody: proof?.postBody,
    }),
    commandStatus: proof?.reject ?? null,
    bridgePlan: bridgePlanProof({
      scenario,
      finalState: "reject",
      refreshKeys,
    }),
    receipts: receiptList(proof?.currentReceipt),
    privatePostBody: proof?.postBody ?? null,
    projectionCommandState: proof?.commandStateAfterReject ?? null,
    channelContext: proof?.channelContextAfterReject ?? null,
    buttonsDisabled: buttonsDisabled(proof?.buttonsAfterReject),
    threadPostPresent:
      proof?.apiThreadPostBodies?.includes(proof?.postBody) ?? null,
    staleOutgoingRouteStatus:
      proof?.staleOutgoingRouteAfterReject?.status ?? null,
    staleOutgoingThreadStatus:
      proof?.staleOutgoingThreadAfterReject?.status ?? null,
    receiptStatusText: proof?.receiptStatusText ?? null,
    receiptRefreshKeys: refreshKeys.join(","),
  };
}

export function buildReplacementCompletedPrivatePostReloadProof(
  proof,
  reloadProof,
  scenario,
) {
  return {
    status: replacementCompletedPrivatePostReloadMatches(
      proof,
      reloadProof,
      scenario,
    )
      ? "passed"
      : "failed",
    clickedAction: scenario.commandAction,
    commandKind: scenario.commandKind,
    routeResponseStatus: reloadProof?.routeResponseStatus ?? null,
    threadPagerVisible: reloadProof?.threadPagerVisible ?? null,
    recoveredCommandState: reloadProof?.recoveredCommandState ?? null,
    channelContext: reloadProof?.reloadChannelContext ?? null,
    buttonsDisabled: buttonsDisabled(reloadProof?.reloadButtons),
    reloadRejectedPostVisible: reloadProof?.reloadRejectedPostVisible ?? null,
    reloadThreadPostBodies: reloadProof?.reloadThreadPostBodies ?? [],
    apiThreadPostBodiesAfterReload:
      reloadProof?.apiThreadPostBodiesAfterReload ?? [],
    staleOutgoingRouteStatus:
      reloadProof?.staleOutgoingRouteAfterReload?.status ?? null,
    staleOutgoingRouteResponseStatus:
      reloadProof?.staleOutgoingRouteAfterReload?.responseStatus ?? null,
    staleOutgoingThreadStatus:
      reloadProof?.staleOutgoingThreadAfterReload?.status ?? null,
    privatePostBody: proof?.postBody ?? null,
  };
}

export function replacementResolvedPrivatePostAckMatches(proof, scenario) {
  const replacement = replacementCommand(proof);
  const ackedPost = ackedSubmitPostCommand(proof);
  return (
    proof?.status === "passed" &&
    proof?.channel === scenario.channelId &&
    hasCapability(proof?.hostEntry, "HostOf") &&
    hasCapability(proof?.staleOutgoingEntry, "SlotOccupant") &&
    hasCapability(proof?.replacementEntry, "SlotOccupant") &&
    proof?.replacement?.state === "ack" &&
    proof?.replacement?.serverEnvelope?.body?.kind === "Ack" &&
    replacement?.slot === scenario.actorSlot &&
    replacement?.incoming_user === scenario.replacementPrincipalUserId &&
    proof?.hostReplacementAfterProcess?.occupantLabel ===
      scenario.replacementOccupantLabel &&
    proof?.commandStateBeforeClose?.actorSlot === scenario.actorSlot &&
    proof?.commandStateBeforeClose?.actorStatus === "alive" &&
    proof?.commandStateBeforeClose?.phase?.phaseId === "D01" &&
    proof?.commandStateBeforeClose?.phase?.locked === false &&
    channelContextHasMemberCapability(
      proof?.channelContextBeforeClose,
      scenario,
    ) &&
    proof?.submitPostBeforeClose?.disabled === false &&
    proof?.closedStatus?.state === "closed" &&
    proof?.resolveDay?.commandStatus?.state === "ack" &&
    proof?.hostPhaseAfterResolve?.id === "D01" &&
    proof?.hostPhaseAfterResolve?.locked === true &&
    proof?.apiCommandStateAfterResolve?.phase?.locked === true &&
    proof?.stalePost?.state === "ack" &&
    proof?.stalePost?.serverEnvelope?.body?.kind === "Ack" &&
    Array.isArray(proof?.stalePost?.streamSeqs) === true &&
    principalUserIdFromAckedPost(proof) ===
      scenario.replacementPrincipalUserId &&
    ackedPost?.channel_id === scenario.channelId &&
    ackedPost?.actor_slot === scenario.actorSlot &&
    ackedPost?.body === proof?.postBody &&
    proof?.dispatchPlan?.projectionRefreshKeys?.includes("thread") === true &&
    proof?.dispatchPlan?.projectionRefreshKeys?.includes("commandState") ===
      true &&
    proof?.currentReceipt?.actionId === scenario.commandAction &&
    proof?.currentReceipt?.state === "ack" &&
    lockedDayOneCommandStateMatches(proof?.commandStateAfterAck, scenario, {
      requireActorStatus: true,
    }) &&
    channelContextMatches(proof?.channelContextAfterAck, scenario) &&
    proof?.projectedPost?.authorSlot === scenario.actorSlot &&
    threadIncludesPost(proof?.apiThreadPostBodies, proof?.postBody) &&
    proof?.rowanPrivateIsolationAfterAck?.targetKillVisible === false &&
    proof?.rowanPrivateIsolationAfterAck?.actionResultVisible === false &&
    proof?.staleOutgoingRouteAfterAck?.status === 403 &&
    proof?.staleOutgoingThreadAfterAck?.status === 403
  );
}

export function replacementResolvedPrivatePostReconnectMatches(
  proof,
  reconnectProof,
  scenario,
) {
  const reconnectPost = reconnectProof?.reconnectCommand?.command?.SubmitPost;
  return (
    proof?.status === "passed" &&
    reconnectProof?.status === "passed" &&
    proof?.channel === scenario.channelId &&
    lockedDayOneCommandStateMatches(
      reconnectProof?.reconnectCommandStateBeforeDrop,
      scenario,
      { requireNoVoteTargets: false },
    ) &&
    channelContextMatches(
      reconnectProof?.reconnectChannelContextBeforeDrop,
      scenario,
    ) &&
    noVoteButtonsPresent(reconnectProof?.reconnectButtonsBeforeDrop) &&
    reconnectProof?.reconnectingStatus?.state === "reconnecting" &&
    reconnectProof?.reconnectCommand?.principalUserId ===
      scenario.replacementPrincipalUserId &&
    reconnectPost?.channel_id === scenario.channelId &&
    reconnectPost?.actor_slot === scenario.actorSlot &&
    reconnectPost?.body === reconnectProof?.reconnectPostBody &&
    reconnectProof?.reconnectRecoveryEvent?.state === "recovered" &&
    reconnectProof?.reconnectRecoveryEvent?.attempt === 1 &&
    reconnectProof?.recoveredSnapshotContainsPost === true &&
    lockedDayOneCommandStateMatches(
      reconnectProof?.recoveredCommandState,
      scenario,
    ) &&
    channelContextMatches(
      reconnectProof?.reconnectChannelContextAfterRecovery,
      scenario,
    ) &&
    noVoteButtonsPresent(reconnectProof?.reconnectButtonsAfterRecovery) &&
    enabledSubmitPostButtonPresent(
      reconnectProof?.reconnectButtonsAfterRecovery,
      scenario,
    ) &&
    threadIncludesPost(
      reconnectProof?.apiThreadPostBodiesAfterReconnect,
      proof?.postBody,
    ) &&
    threadIncludesPost(
      reconnectProof?.apiThreadPostBodiesAfterReconnect,
      reconnectProof?.reconnectPostBody,
    ) &&
    lockedDayOneApiCommandStateMatches(
      reconnectProof?.apiCommandStateAfterReconnect,
    ) &&
    reconnectProof?.staleOutgoingThreadAfterReconnect?.status === 403
  );
}

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
