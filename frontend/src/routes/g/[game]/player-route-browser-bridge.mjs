import {
  liveProjectionStatusForEvent,
  recoverLiveProjection,
} from "../../../lib/app/live-transport.mjs";

export function recordPlayerLiveProjectionEvent({
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
  windowRef.__fmarchLiveProjectionEvents = [
    ...(windowRef.__fmarchLiveProjectionEvents ?? []),
    message,
  ];
  windowRef.__fmarchLiveProjectionStatus = liveStatus;
  if (snapshot !== null) {
    windowRef.__fmarchPlayerProjection = snapshot;
  }
  return liveStatus;
}

export async function triggerPlayerLiveProjectionResync({
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
  const liveStatus = recordPlayerLiveProjectionEvent({
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

export function exposePlayerProjection({ windowRef, snapshot }) {
  if (windowRef === undefined || windowRef === null || snapshot === null) {
    return false;
  }
  windowRef.__fmarchPlayerProjection = snapshot;
  return true;
}

export function exposePlayerCommandStatus({ windowRef, commandStatus }) {
  if (windowRef === undefined || windowRef === null) {
    return false;
  }
  windowRef.__fmarchPlayerCommandStatus = commandStatus;
  return true;
}

export function exposePlayerCommandReceipts({ windowRef, commandReceipts }) {
  if (windowRef === undefined || windowRef === null) {
    return false;
  }
  windowRef.__fmarchPlayerCommandReceipts = commandReceipts;
  return true;
}

export function exposePlayerCommandDispatchBridgePlan({ windowRef, plan }) {
  if (windowRef === undefined || windowRef === null) {
    return false;
  }
  windowRef.__fmarchPlayerCommandDispatchBridgePlan = plan;
  return true;
}

export function exposePlayerThreadPageStatus({ windowRef, threadPageStatus }) {
  if (windowRef === undefined || windowRef === null) {
    return false;
  }
  windowRef.__fmarchPlayerThreadPageStatus = threadPageStatus;
  return true;
}
