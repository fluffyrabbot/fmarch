import {
  liveProjectionStatusForEvent,
  recoverLiveProjection,
} from "../../../../lib/app/live-transport.mjs";

export function exposeHostRouteWindowState({
  windowRef,
  dispatched,
  commandOutcomes,
  commandStatuses,
  projection,
  votecount,
  hostPrompts,
}) {
  if (windowRef === undefined || windowRef === null) {
    return false;
  }
  windowRef.__fmarchHostActionEvents = dispatched;
  windowRef.__fmarchHostCommandOutcomes = commandOutcomes;
  windowRef.__fmarchHostCommandStatuses = commandStatuses;
  windowRef.__fmarchHostProjection = projection;
  windowRef.__fmarchHostVotecountProjection = votecount;
  windowRef.__fmarchHostPromptsProjection = hostPrompts;
  return true;
}

export function exposeHostLiveProjectionEndpoint({ windowRef, endpoint }) {
  if (windowRef === undefined || windowRef === null) {
    return false;
  }
  windowRef.__fmarchHostLiveProjectionEndpoint = endpoint;
  return true;
}

export function recordHostLiveProjectionEvent({
  windowRef,
  message,
  snapshot,
  currentStatus,
  statusForEvent = liveProjectionStatusForEvent,
}) {
  const liveStatus = statusForEvent(message, currentStatus);
  if (windowRef === undefined || windowRef === null) {
    return liveStatus;
  }
  windowRef.__fmarchHostLiveProjectionEvents = [
    ...(windowRef.__fmarchHostLiveProjectionEvents ?? []),
    message,
  ];
  windowRef.__fmarchHostLiveProjectionStatus = liveStatus;
  if (snapshot !== null) {
    windowRef.__fmarchHostVotecountProjection = snapshot.votecount;
    windowRef.__fmarchHostPromptsProjection = snapshot.hostPrompts;
  }
  return liveStatus;
}

export async function triggerHostLiveProjectionResync({
  windowRef,
  projectionStore,
  resyncKeys,
  fetchImpl,
  fromSeq = 0,
  currentStatus,
  recoverLiveProjectionImpl = recoverLiveProjection,
  statusForEvent = liveProjectionStatusForEvent,
}) {
  const recovery = await recoverLiveProjectionImpl({
    projectionStore,
    resyncKeys,
    fetchImpl,
    message: { kind: "resync-required", fromSeq },
  });
  const liveStatus = recordHostLiveProjectionEvent({
    windowRef,
    message: recovery.message,
    snapshot: recovery.snapshot,
    currentStatus,
    statusForEvent,
  });
  return Object.freeze({
    liveStatus,
    message: recovery.message,
    snapshot: recovery.snapshot,
  });
}

export function dispatchHostCommandResult({
  windowRef,
  outcome,
  CustomEventCtor = windowRef?.CustomEvent ?? globalThis.CustomEvent,
}) {
  if (
    windowRef === undefined ||
    windowRef === null ||
    typeof windowRef.dispatchEvent !== "function" ||
    typeof CustomEventCtor !== "function"
  ) {
    return false;
  }
  return windowRef.dispatchEvent(
    new CustomEventCtor("host-command-result", {
      detail: outcome,
    }),
  );
}

export function exposeHostCommandDispatchBridgePlan({ windowRef, plan }) {
  if (windowRef === undefined || windowRef === null) {
    return false;
  }
  windowRef.__fmarchHostCommandDispatchBridgePlan = plan;
  return true;
}
