const hasCapability = (entry, capability) =>
  entry?.capabilityKinds?.includes(capability) === true;

const phaseClosureOutcomePresent = (rows) =>
  rows?.some(
    (row) =>
      row.phaseId === "D01" &&
      row.status === "Lynch" &&
      row.winnerSlot === "slot-2",
  ) === true;

const phaseClosureSetupMatches = (proof) =>
  proof?.status === "passed" &&
  hasCapability(proof?.hostEntry, "HostOf") &&
  hasCapability(proof?.playerEntry, "SlotOccupant") &&
  proof?.commandStateBeforeClose?.actorSlot === "slot-7" &&
  proof?.commandStateBeforeClose?.phase?.phaseId === "D01" &&
  proof?.commandStateBeforeClose?.phase?.locked === false &&
  proof?.commandStateBeforeClose?.currentVote?.slotId === "slot-2" &&
  proof?.currentVoteBeforeClose?.hasVote === "true" &&
  proof?.closedStatus?.state === "closed" &&
  proof?.resolveDay?.commandStatus?.state === "ack" &&
  proof?.hostAfterResolve?.phase?.locked === true &&
  phaseClosureOutcomePresent(proof?.hostAfterResolve?.dayVoteOutcomes) &&
  proof?.apiCommandStateAfterResolve?.phase?.locked === true &&
  proof?.apiCommandStateAfterResolve?.current_vote === null &&
  proof?.apiCommandStateAfterResolve?.vote_targets?.length === 0;

const currentClosedCommandStateMatches = (commandState) =>
  commandState?.phase?.locked === true &&
  commandState?.voteTargets?.length === 0 &&
  commandState?.currentVote === null;

const currentClosedApiCommandStateMatches = (commandState) =>
  commandState?.phase?.locked === true &&
  commandState?.vote_targets?.length === 0 &&
  commandState?.current_vote === null;

const currentNoVoteControlsMatch = ({
  currentVote,
  withdraw,
  buttons,
}) =>
  currentVote?.hasVote === "false" &&
  withdraw?.disabled === true &&
  withdraw?.reason === "No current vote" &&
  buttons?.some((button) => button.action?.startsWith("submit_vote")) ===
    false &&
  buttons?.some(
    (button) => button.action === "submit_post" && button.disabled === false,
  ) === true;

const projectionRefreshKeysInclude = (proof, keys) =>
  keys.every(
    (key) => proof?.dispatchPlan?.projectionRefreshKeys?.includes(key) === true,
  );

export function stalePlayerPhaseClosureRejectMatches(
  proof,
  {
    commandField,
    commandName,
    beforeCommandMatches = () => true,
  },
) {
  const staleCommand = proof?.[commandField];
  return (
    phaseClosureSetupMatches(proof) &&
    beforeCommandMatches(proof) &&
    staleCommand?.state === "reject" &&
    staleCommand?.error === "PhaseLocked" &&
    staleCommand?.serverEnvelope?.body?.kind === "Reject" &&
    Array.isArray(staleCommand?.streamSeqs) === false &&
    staleCommand?.requestEnvelope?.body?.body?.command?.[commandName]
      ?.actor_slot === "slot-7" &&
    projectionRefreshKeysInclude(proof, ["votecount", "commandState"]) &&
    currentClosedCommandStateMatches(proof?.commandStateAfterReject) &&
    currentNoVoteControlsMatch({
      currentVote: proof?.currentVoteAfterReject,
      withdraw: proof?.withdrawAfterReject,
      buttons: proof?.buttonsAfterReject,
    }) &&
    phaseClosureOutcomePresent(proof?.dayVoteOutcomesAfterReject) &&
    currentClosedApiCommandStateMatches(proof?.apiCommandStateAfterReject)
  );
}

export function stalePlayerPhaseClosurePostAckMatches(proof) {
  const stalePost = proof?.stalePost;
  return (
    phaseClosureSetupMatches(proof) &&
    proof?.submitPostBeforeClose?.disabled === false &&
    stalePost?.state === "ack" &&
    stalePost?.serverEnvelope?.body?.kind === "Ack" &&
    Array.isArray(stalePost?.streamSeqs) === true &&
    stalePost.streamSeqs.length > 0 &&
    stalePost?.requestEnvelope?.body?.body?.command?.SubmitPost?.actor_slot ===
      "slot-7" &&
    stalePost?.requestEnvelope?.body?.body?.command?.SubmitPost?.channel_id ===
      "main" &&
    stalePost?.requestEnvelope?.body?.body?.command?.SubmitPost?.body ===
      proof?.postBody &&
    projectionRefreshKeysInclude(proof, [
      "thread",
      "votecount",
      "commandState",
      "dayVoteOutcomes",
    ]) &&
    proof?.projectedPost?.body === proof?.postBody &&
    proof?.projectedPost?.authorSlot === "slot-7" &&
    currentClosedCommandStateMatches(proof?.commandStateAfterAck) &&
    currentNoVoteControlsMatch({
      currentVote: proof?.currentVoteAfterAck,
      withdraw: proof?.withdrawAfterAck,
      buttons: proof?.buttonsAfterAck,
    }) &&
    phaseClosureOutcomePresent(proof?.dayVoteOutcomesAfterAck) &&
    currentClosedApiCommandStateMatches(proof?.apiCommandStateAfterAck) &&
    proof?.apiThreadAfterAck?.posts?.some(
      (post) => post.body === proof?.postBody && post.author_slot === "slot-7",
    ) === true
  );
}
