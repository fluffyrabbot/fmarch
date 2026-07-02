export function hostPhaseStaleBasePassed({ proof, session, scenario }) {
  const liveCommandProof =
    scenario.key === "resolve"
      ? proof?.liveResolve
      : scenario.key === "advance"
        ? proof?.liveUnlock
        : null;
  return (
    proof?.status === "passed" &&
    typeof proof?.setup?.roleUrl === "string" &&
    proof.setup.roleUrl.includes(`/g/${session?.game ?? ""}/host`) === true &&
    proof?.staleClickBrowserProof?.roleUrl === proof.setup.roleUrl &&
    proof?.staleClickBrowserProof?.clickedActionId === scenario.actionId &&
    proof?.staleClickBrowserProof?.receiptStatusText?.includes(
      `Reject ${scenario.rejectError}`,
    ) === true &&
    proof?.staleClickBrowserProof?.dispatchRefreshKeys?.includes("host") ===
      true &&
    hostPhaseMatches(
      proof?.staleClickBrowserProof?.phaseAfterReject,
      scenario.expectedCurrentPhase,
    ) &&
    hostPhaseActionsMatch(
      proof?.staleClickBrowserProof?.phaseActionsAfterReject,
      scenario.expectedCurrentActions,
    ) &&
    hostPhaseStaleClickDeadlinePassed({ proof, scenario }) &&
    hostPhaseMatches(proof?.setup?.stalePhase, scenario.expectedStalePhase) &&
    hostPhaseActionsMatch(
      proof?.setup?.phaseActions,
      scenario.expectedSetupActions,
    ) &&
    hostDeadlineActionsMatch(
      proof?.setup?.deadlineActions,
      scenario.expectedSetupActions,
    ) &&
    (liveCommandProof === null || hostCommandAckedWithSeqs(liveCommandProof)) &&
    proof?.reject?.state === "reject" &&
    proof?.reject?.error === scenario.rejectError &&
    hostPhaseStaleRejectEnvelopePassed({ proof, scenario }) &&
    Array.isArray(proof?.reject?.streamSeqs) === false &&
    proof?.reject?.message?.includes("stale phase state") === true &&
    hostPhaseMatches(proof?.phaseAfterReject, scenario.expectedCurrentPhase) &&
    hostPhaseActionsMatch(
      proof?.phaseActionsAfterReject,
      scenario.expectedCurrentActions,
    ) &&
    hostDeadlineActionsMatch(
      proof?.deadlineActionsAfterReject,
      scenario.expectedCurrentActions,
    ) &&
    proof?.activityRow?.source === "outcome" &&
    proof?.activityRow?.actionId === scenario.actionId &&
    proof?.dispatchPlan?.projectionRefreshKeys?.includes("host") === true &&
    hostApiPhaseMatches(proof?.apiPhaseAfterReject, scenario.expectedCurrentPhase) &&
    hostPhaseStaleRestorePassed({ proof, scenario })
  );
}

export function hostPhaseStaleReloadPassed({ proof, reloadProof, scenario }) {
  return (
    proof?.status === "passed" &&
    proof?.reject?.error === scenario.rejectError &&
    reloadProof?.status === "passed" &&
    reloadProof?.routeResponseStatus === 200 &&
    reloadProof?.rejectReceiptStatusText?.includes(
      `Reject ${scenario.rejectError}`,
    ) === true &&
    hostPhaseMatches(reloadProof?.phaseAfterReload, scenario.expectedCurrentPhase) &&
    hostPhaseActionsMatch(
      reloadProof?.phaseActionsAfterReload,
      scenario.expectedCurrentActions,
    ) &&
    hostDeadlineActionsMatch(
      reloadProof?.deadlineActionsAfterReload,
      scenario.expectedCurrentActions,
    ) &&
    hostApiPhaseMatches(
      reloadProof?.apiPhaseAfterReload,
      scenario.expectedCurrentPhase,
    )
  );
}

export function hostPhaseStaleReconnectPassed({
  proof,
  reconnectProof,
  scenario,
}) {
  return (
    proof?.status === "passed" &&
    proof?.reject?.error === scenario.rejectError &&
    reconnectProof?.status === "passed" &&
    reconnectProof?.reconnectingStatus?.state === "reconnecting" &&
    reconnectProof?.reconnectRecoveryEvent?.state === "recovered" &&
    reconnectProof?.reconnectRecoveryEvent?.attempt === 1 &&
    hostPhaseMatches(
      reconnectProof?.recoveredHostProjection?.phase,
      scenario.expectedCurrentPhase,
    ) &&
    hostPhaseActionsMatch(
      proof?.phaseActionsAfterReconnect,
      scenario.expectedCurrentActions,
    ) &&
    hostDeadlineActionsMatch(
      proof?.deadlineActionsAfterReconnect,
      scenario.expectedCurrentActions,
    ) &&
    hostPhaseStaleReconnectApiPassed({ proof, scenario })
  );
}

export function cohostDeadlineStaleBasePassed({ proof, session, scenario }) {
  return (
    proof?.status === "passed" &&
    typeof proof?.setup?.roleUrl === "string" &&
    proof.setup.roleUrl.includes(`/g/${session?.game ?? ""}/host`) === true &&
    proof?.staleClickBrowserProof?.roleUrl === proof.setup.roleUrl &&
    proof?.staleClickBrowserProof?.clickedActionId === scenario.actionId &&
    proof?.staleClickBrowserProof?.receiptStatusText?.includes(
      `Reject ${scenario.rejectError}`,
    ) === true &&
    proof?.staleClickBrowserProof?.dispatchRefreshKeys?.includes("host") ===
      true &&
    hostPhaseMatches(
      proof?.staleClickBrowserProof?.phaseAfterReject,
      scenario.expectedCurrentPhase,
    ) &&
    hostDeadlineActionsMatch(
      proof?.staleClickBrowserProof?.deadlineActionsAfterReject,
      scenario.expectedCurrentActions,
    ) &&
    emptyActionList(proof?.staleClickBrowserProof?.phaseActionsAfterReject) &&
    hostApiPhaseMatches(
      proof?.staleClickBrowserProof?.apiPhaseAfterReject,
      scenario.expectedCurrentPhase,
    ) &&
    hostPhaseMatches(proof?.setup?.stalePhase, scenario.expectedStalePhase) &&
    hostDeadlineActionsMatch(
      proof?.setup?.deadlineActions,
      scenario.expectedSetupActions,
    ) &&
    emptyActionList(proof?.setup?.phaseActions) &&
    proof?.reject?.error === scenario.rejectError &&
    proof?.reject?.message?.includes("stale phase state") === true &&
    hostPhaseMatches(proof?.phaseAfterReject, scenario.expectedCurrentPhase) &&
    hostDeadlineActionsMatch(
      proof?.deadlineActionsAfterReject,
      scenario.expectedCurrentActions,
    ) &&
    emptyActionList(proof?.phaseActionsAfterReject) &&
    proof?.activityRow?.source === "outcome" &&
    proof?.activityRow?.actionId === scenario.actionId &&
    proof?.dispatchPlan?.projectionRefreshKeys?.includes("host") === true &&
    hostApiPhaseMatches(proof?.apiPhaseAfterReject, scenario.expectedCurrentPhase)
  );
}

export function cohostDeadlineStaleReloadPassed({
  proof,
  reloadProof,
  scenario,
}) {
  return (
    proof?.status === "passed" &&
    proof?.reject?.error === scenario.rejectError &&
    reloadProof?.status === "passed" &&
    reloadProof?.routeResponseStatus === 200 &&
    reloadProof?.rejectReceiptStatusText?.includes(
      `Reject ${scenario.rejectError}`,
    ) === true &&
    hostPhaseMatches(reloadProof?.phaseAfterReload, scenario.expectedCurrentPhase) &&
    hostDeadlineActionsMatch(
      reloadProof?.deadlineActionsAfterReload,
      scenario.expectedCurrentActions,
    ) &&
    emptyActionList(reloadProof?.phaseActionsAfterReload) &&
    hostApiPhaseMatches(
      reloadProof?.apiPhaseAfterReload,
      scenario.expectedCurrentPhase,
    )
  );
}

export function cohostDeadlineStaleReconnectPassed({
  proof,
  reconnectProof,
  scenario,
}) {
  return (
    proof?.status === "passed" &&
    proof?.reject?.error === scenario.rejectError &&
    reconnectProof?.status === "passed" &&
    reconnectProof?.reconnectingStatus?.state === "reconnecting" &&
    reconnectProof?.reconnectRecoveryEvent?.state === "recovered" &&
    reconnectProof?.reconnectRecoveryEvent?.attempt === 1 &&
    hostPhaseMatches(
      reconnectProof?.recoveredHostProjection?.phase,
      scenario.expectedCurrentPhase,
    ) &&
    hostDeadlineActionsMatch(
      proof?.deadlineActionsAfterReconnect,
      scenario.expectedCurrentActions,
    ) &&
    emptyActionList(proof?.phaseActionsAfterReconnect) &&
    hostApiPhaseMatches(
      proof?.apiPhaseAfterReconnect,
      scenario.expectedCurrentPhase,
    )
  );
}

function hostPhaseStaleRestorePassed({ proof, scenario }) {
  if (scenario.key !== "resolve") {
    return true;
  }
  return (
    proof?.restoreAfterReject?.commandStatus?.state === "ack" &&
    proof?.apiPhaseAfterRestore?.phase_id === "D02" &&
    proof?.apiPhaseAfterRestore?.locked === false
  );
}

function hostPhaseStaleClickDeadlinePassed({ proof, scenario }) {
  if (scenario.key !== "deadline") {
    return true;
  }
  return (
    hostDeadlineActionsMatch(
      proof?.staleClickBrowserProof?.deadlineActionsAfterReject,
      scenario.expectedCurrentActions,
    ) &&
    hostApiPhaseMatches(
      proof?.staleClickBrowserProof?.apiPhaseAfterReject,
      scenario.expectedCurrentPhase,
    )
  );
}

function hostPhaseStaleRejectEnvelopePassed({ proof, scenario }) {
  if (scenario.key === "deadline") {
    return true;
  }
  return proof?.reject?.serverEnvelope?.body?.kind === "Reject";
}

function hostPhaseStaleReconnectApiPassed({ proof, scenario }) {
  if (!Object.hasOwn(scenario.expectedCurrentPhase, "deadline")) {
    return true;
  }
  return hostApiPhaseMatches(
    proof?.apiPhaseAfterReconnect,
    scenario.expectedCurrentPhase,
  );
}

function hostCommandAckedWithSeqs(commandProof) {
  return (
    commandProof?.commandStatus?.state === "ack" &&
    Array.isArray(commandProof?.commandStatus?.streamSeqs) &&
    commandProof.commandStatus.streamSeqs.length > 0
  );
}

function hostPhaseMatches(phase, expectedPhase) {
  return (
    phase?.id === expectedPhase.id &&
    phase?.locked === expectedPhase.locked
  );
}

function hostApiPhaseMatches(apiPhase, expectedPhase) {
  return (
    apiPhase?.phase_id === expectedPhase.id &&
    apiPhase?.locked === expectedPhase.locked &&
    (!Object.hasOwn(expectedPhase, "deadline") ||
      apiPhase?.deadline === expectedPhase.deadline)
  );
}

function hostPhaseActionsMatch(actions, expectedActions) {
  return (
    actionsIncludeAll(actions, expectedActions.phaseIncludes) &&
    actionsExcludeAll(actions, expectedActions.phaseExcludes)
  );
}

function hostDeadlineActionsMatch(actions, expectedActions) {
  return actionsIncludeAll(actions, expectedActions.deadlineIncludes);
}

function actionsIncludeAll(actions, expectedActions) {
  return (expectedActions ?? []).every(
    (actionId) => actions?.includes(actionId) === true,
  );
}

function actionsExcludeAll(actions, expectedActions) {
  return (expectedActions ?? []).every(
    (actionId) => actions?.includes(actionId) === false,
  );
}

function emptyActionList(actions) {
  return Array.isArray(actions) && actions.length === 0;
}
