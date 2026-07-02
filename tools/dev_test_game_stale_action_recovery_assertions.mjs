const hasKey = (container, key) =>
  Array.isArray(container) && container.includes(key);

const includesAll = (container, keys = []) =>
  keys.every((key) => hasKey(container, key));

const excludesAll = (container, keys = []) =>
  keys.every((key) => !hasKey(container, key));

const includesAllText = (text, fragments = []) =>
  fragments.every((fragment) => String(text ?? "").includes(fragment));

const submitActionCommandFromReject = (reject) =>
  reject?.requestEnvelope?.body?.body?.command?.SubmitAction;

const browserCommandStateMatches = (commandState, expected = {}) =>
  (expected.actorSlot === undefined ||
    commandState?.actorSlot === expected.actorSlot) &&
  (expected.actorAlive === undefined ||
    commandState?.actorAlive === expected.actorAlive) &&
  (expected.actorStatus === undefined ||
    commandState?.actorStatus === expected.actorStatus) &&
  (expected.phaseId === undefined ||
    commandState?.phase?.phaseId === expected.phaseId) &&
  (expected.locked === undefined ||
    commandState?.phase?.locked === expected.locked) &&
  (expected.actionCount === undefined ||
    commandState?.actions?.length === expected.actionCount);

const apiCommandStateMatches = (commandState, expected = {}) =>
  (expected.actorSlot === undefined ||
    commandState?.actor_slot === expected.actorSlot) &&
  (expected.actorAlive === undefined ||
    commandState?.actor_alive === expected.actorAlive) &&
  (expected.actorStatus === undefined ||
    commandState?.actor_status === expected.actorStatus) &&
  (expected.phaseId === undefined ||
    commandState?.phase?.phase_id === expected.phaseId) &&
  (expected.locked === undefined ||
    commandState?.phase?.locked === expected.locked) &&
  (expected.actionCount === undefined ||
    commandState?.actions?.length === expected.actionCount);

export function staleActionRejectRecoveryMatches(
  proof,
  {
    error,
    actorSlot,
    actionId,
    templateId,
    targetSlot,
    commandAction,
    messageFragments = [],
    dispatchRefreshKeys = [],
    forbiddenDispatchRefreshKeys = [],
    receiptRefreshKeys = [],
    forbiddenReceiptRefreshKeys = [],
    receiptStatusFragments = [],
    stalePhaseId,
    browserCommandState = {},
    apiCommandState = {},
    actionHidden = true,
  } = {},
) {
  const reject = proof?.reject;
  const submitAction = submitActionCommandFromReject(reject);
  const dispatchKeys = proof?.dispatchPlan?.projectionRefreshKeys;
  const receiptKeys = proof?.currentReceipt?.commandTrace?.projectionRefreshKeys;
  return (
    reject?.state === "reject" &&
    (error === undefined || reject?.error === error) &&
    reject?.serverEnvelope?.body?.kind === "Reject" &&
    Array.isArray(reject?.streamSeqs) === false &&
    (actorSlot === undefined || submitAction?.actor_slot === actorSlot) &&
    (actionId === undefined || submitAction?.action_id === actionId) &&
    (templateId === undefined || submitAction?.template_id === templateId) &&
    (targetSlot === undefined || submitAction?.targets?.[0] === targetSlot) &&
    includesAllText(reject?.message, messageFragments) &&
    includesAll(dispatchKeys, dispatchRefreshKeys) &&
    excludesAll(dispatchKeys, forbiddenDispatchRefreshKeys) &&
    (commandAction === undefined ||
      proof?.currentReceipt?.actionId === commandAction) &&
    proof?.currentReceipt?.state === "reject" &&
    includesAll(receiptKeys, receiptRefreshKeys) &&
    excludesAll(receiptKeys, forbiddenReceiptRefreshKeys) &&
    includesAllText(proof?.receiptStatusText, receiptStatusFragments) &&
    (stalePhaseId === undefined ||
      proof?.staleN01Phase?.phaseId === stalePhaseId) &&
    browserCommandStateMatches(
      proof?.commandStateAfterReject,
      browserCommandState,
    ) &&
    apiCommandStateMatches(proof?.apiCommandStateAfterReject, apiCommandState) &&
    (actionHidden !== true ||
      proof?.actionVisibleAfterRefresh === false ||
      proof?.buttonsAfterReject?.some(
        (button) => button.action === commandAction,
      ) === false)
  );
}
