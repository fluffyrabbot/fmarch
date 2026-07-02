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

const normalizedVotecountRows = (apiVotecount) => {
  const rows = Array.isArray(apiVotecount) ? apiVotecount : [];
  return rows
    .map((delta) =>
      delta?.kind === "VoteCountChanged"
        ? delta.body
        : delta?.VoteCountChanged ?? delta?.body?.VoteCountChanged ?? null,
    )
    .filter(Boolean)
    .map((delta) => ({
      target: delta.candidate_slot ?? delta.candidateSlot ?? "unknown",
      phaseId: delta.phase_id ?? delta.phaseId ?? "unknown",
      count: Number(delta.count ?? 0),
    }));
};

const votecountRowsInclude = (rows, expected) =>
  rows?.some(
    (row) =>
      (expected.phaseId === undefined || row.phaseId === expected.phaseId) &&
      row.target === expected.target &&
      row.count === expected.count,
  ) === true;

const apiVotecountRowsInclude = (apiVotecount, expected) =>
  votecountRowsInclude(normalizedVotecountRows(apiVotecount), expected);

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

export function stalePlayerVoteAfterChangeAckMatches(proof) {
  const staleTargetSlot = proof?.staleVoteTarget?.slotId;
  return (
    proof?.status === "passed" &&
    proof?.commandStateBeforeClose?.currentVote === null &&
    proof?.commandStateBeforeClose?.voteTargets?.some(
      (target) => target.kind === "slot" && target.slotId === staleTargetSlot,
    ) === true &&
    proof?.staleVoteButton?.disabled === false &&
    proof?.closedStatus?.state === "closed" &&
    proof?.actionVote?.state === "ack" &&
    apiVotecountRowsInclude(proof?.apiVotecountAfterActionVote, {
      phaseId: "D02",
      target: "no_lynch",
      count: 1,
    }) &&
    proof?.staleVote?.state === "ack" &&
    proof?.staleVote?.requestEnvelope?.body?.body?.command?.SubmitVote?.target
      ?.Slot === staleTargetSlot &&
    proof?.commandStateAfterAck?.currentVote?.slotId === staleTargetSlot &&
    votecountRowsInclude(proof?.votecountAfterAck, {
      target: "no_lynch",
      count: 1,
    }) &&
    votecountRowsInclude(proof?.votecountAfterAck, {
      target: staleTargetSlot,
      count: 1,
    }) &&
    projectionRefreshKeysInclude(proof, ["votecount", "commandState"]) &&
    proof?.currentVoteAfterAck?.hasVote === "true" &&
    apiVotecountRowsInclude(proof?.apiVotecountAfterAck, {
      phaseId: "D02",
      target: "no_lynch",
      count: 1,
    }) &&
    apiVotecountRowsInclude(proof?.apiVotecountAfterAck, {
      phaseId: "D02",
      target: staleTargetSlot,
      count: 1,
    }) &&
    proof?.apiCommandStateAfterAck?.current_vote?.slot_id === staleTargetSlot &&
    proof?.withdrawPlayer?.state === "ack" &&
    proof?.withdrawAction?.state === "ack" &&
    normalizedVotecountRows(proof?.apiVotecountAfterCleanup).length === 0 &&
    proof?.apiCommandStateAfterCleanup?.current_vote === null
  );
}

export function stalePlayerWithdrawAfterChangeAckMatches(proof) {
  const staleTargetSlot = proof?.staleVoteTarget?.slotId;
  return (
    proof?.status === "passed" &&
    proof?.commandStateBeforeVote?.currentVote === null &&
    proof?.staleVoteTarget?.kind === "slot" &&
    proof?.staleVoteButton?.disabled === false &&
    proof?.initialVote?.state === "ack" &&
    proof?.commandStateBeforeClose?.currentVote?.slotId === staleTargetSlot &&
    proof?.currentVoteBeforeClose?.hasVote === "true" &&
    proof?.withdrawBeforeClose?.exists === true &&
    proof?.withdrawBeforeClose?.disabled === false &&
    proof?.closedStatus?.state === "closed" &&
    proof?.liveChangeVote?.state === "ack" &&
    proof?.apiCommandStateAfterLiveChange?.current_vote?.kind === "no_lynch" &&
    apiVotecountRowsInclude(proof?.apiVotecountAfterLiveChange, {
      phaseId: "D02",
      target: "no_lynch",
      count: 1,
    }) &&
    normalizedVotecountRows(proof?.apiVotecountAfterLiveChange).some(
      (row) => row.phaseId === "D02" && row.target === staleTargetSlot,
    ) === false &&
    proof?.staleWithdraw?.state === "ack" &&
    proof?.staleWithdraw?.requestEnvelope?.body?.body?.command?.WithdrawVote
      ?.actor_slot === "slot-7" &&
    proof?.commandStateAfterWithdraw?.currentVote === null &&
    proof?.votecountAfterWithdraw?.length === 0 &&
    projectionRefreshKeysInclude(proof, ["votecount", "commandState"]) &&
    proof?.currentVoteAfterWithdraw?.hasVote === "false" &&
    proof?.currentVoteAfterWithdraw?.text?.includes("No current vote") === true &&
    proof?.withdrawAfterAck?.disabled === true &&
    proof?.withdrawAfterAck?.reason === "No current vote" &&
    proof?.apiCommandStateAfterWithdraw?.current_vote === null &&
    normalizedVotecountRows(proof?.apiVotecountAfterWithdraw).length === 0
  );
}
