import {
  buildDispatchBridgePlanFromRequest,
  normalizeCommandTrace,
} from "../../../lib/app/command-dispatch-bridge.mjs";
import {
  attachCommandTrace,
  buildCommandTrace,
} from "../../../lib/app/command-trace-model.mjs";
import {
  buildPlayerCommand,
  sendCommand,
} from "../../../lib/app/command-boundary.mjs";
import {
  normalizeThreadPage,
  normalizePlayerCommandState,
  normalizeVotecount,
  playerThreadUrl,
} from "../../../lib/app/cold-load.mjs";
import {
  mergeThreadPage,
  threadPageStatusForResult,
} from "../../../lib/components/player-thread/player-thread-model.mjs";

export function buildPlayerProjectionInitialSnapshot(data) {
  return Object.freeze({
    thread: data.thread,
    votecount: data.votecount,
    notifications: data.notifications,
    investigationResults: data.investigationResults,
    commandState: data.commandState,
  });
}

export function buildPlayerProjectionColdLoads(data) {
  return Object.freeze({
    thread: Object.freeze({
      url: data.coldLoad.threadEndpoint,
      normalize: normalizeThreadPage,
    }),
    votecount: Object.freeze({
      url: data.coldLoad.votecountEndpoint,
      normalize: normalizeVotecount,
    }),
    ...(data.coldLoad.notificationsEndpoint === null
      ? {}
      : {
          notifications: Object.freeze({
            url: data.coldLoad.notificationsEndpoint,
            normalize: normalizePrivateRows,
          }),
        }),
    ...(data.coldLoad.investigationResultsEndpoint === null
      ? {}
      : {
          investigationResults: Object.freeze({
            url: data.coldLoad.investigationResultsEndpoint,
            normalize: normalizePrivateRows,
          }),
        }),
    ...(data.coldLoad.commandStateEndpoint == null
      ? {}
      : {
          commandState: Object.freeze({
            url: data.coldLoad.commandStateEndpoint,
            normalize: normalizePlayerCommandState,
          }),
        }),
  });
}

export function playerResyncKeys(data) {
  return Object.freeze([
    "thread",
    "votecount",
    ...(data.coldLoad.notificationsEndpoint === null ? [] : ["notifications"]),
    ...(data.coldLoad.investigationResultsEndpoint === null
      ? []
      : ["investigationResults"]),
    ...(data.coldLoad.commandStateEndpoint == null ? [] : ["commandState"]),
  ]);
}

export function playerRefreshKeysForLiveDelta(data, message) {
  if (
    data.coldLoad.commandStateEndpoint == null ||
    message?.kind !== "delta"
  ) {
    return Object.freeze([]);
  }
  return Object.freeze(["commandState"]);
}

export function playerCommandTrace(action) {
  return buildCommandTrace({
    surface: "player",
    actionId: action,
    statusKey: action,
    dispatchKind: action,
    projectionRefreshKeys: playerRefreshKeysForAction(action),
  });
}

export function playerCommandPendingStatus(action = null) {
  const status = {
    state: "pending",
    message: "Sending command",
  };
  return action === null
    ? Object.freeze(status)
    : attachCommandTrace(status, playerCommandTrace(action));
}

export function playerCommandErrorStatus(error, action = null) {
  const status = {
    state: "reject",
    message: errorMessage(error),
  };
  return action === null
    ? Object.freeze(status)
    : attachCommandTrace(status, playerCommandTrace(action));
}

export function recordPlayerCommandReceipt(commandReceipts, action, status) {
  const receipt = Object.freeze({
    actionId: String(action),
    state: String(status?.state ?? "info"),
    message: String(status?.message ?? "Command updated"),
    commandTrace: status?.commandTrace ?? playerCommandTrace(String(action)),
    current: true,
  });
  return Object.freeze([
    ...commandReceipts
      .filter((item) => item.actionId !== receipt.actionId)
      .map((item) => Object.freeze({ ...item, current: false })),
    receipt,
  ]);
}

export function playerThreadPendingStatus() {
  return Object.freeze({
    state: "pending",
    message: "Loading older posts",
  });
}

export function playerThreadNoOlderStatus() {
  return Object.freeze({
    state: "idle",
    message: "No older posts available",
  });
}

export function playerThreadErrorStatus(error) {
  return Object.freeze({
    state: "reject",
    message: errorMessage(error),
  });
}

export function togglePrivateItemExpansion(expandedPrivateItems, item) {
  const id = String(item.id);
  return Object.freeze({
    ...expandedPrivateItems,
    [id]: expandedPrivateItems[id] !== true,
  });
}

export function playerRefreshKeysForAction(action) {
  const normalizedAction = String(action);
  if (
    normalizedAction === "submit_action" ||
    normalizedAction.startsWith("submit_action:") ||
    normalizedAction === "submit_invalid_action" ||
    normalizedAction.startsWith("submit_invalid_action:")
  ) {
    return Object.freeze(["notifications", "investigationResults", "commandState"]);
  }
  switch (normalizedAction) {
    case "submit_post":
      return Object.freeze(["thread", "votecount"]);
    case "submit_vote":
    case "withdraw_vote":
      return Object.freeze(["votecount"]);
    default:
      return Object.freeze([]);
  }
}

export function buildPlayerCommandRequest({ data, action, composerBody }) {
  const actionConfig = playerActionConfig(data, action);
  return Object.freeze({
    principalUserId: data.player.principalUserId,
    endpoint: data.composer.commandEndpoint,
    command: buildPlayerCommand({
      action,
      game: data.game.id,
      channelId: data.threadPager.channel,
      actorSlot: data.player.slotId,
      body: composerBody,
      target: data.composer.voteTargetSlot,
      actionConfig,
    }),
  });
}

export function buildPlayerCommandDispatchBridgePlan({
  data,
  action,
  composerBody,
  optimisticStatus,
  finalStatus,
}) {
  const trace = normalizeCommandTrace(
    optimisticStatus?.commandTrace ??
      finalStatus?.commandTrace ??
      playerCommandTrace(action),
  );
  const request = buildPlayerCommandRequest({
    data,
    action: trace.dispatchKind,
    composerBody,
  });
  return buildDispatchBridgePlanFromRequest({
    role: "player",
    trace,
    request,
    optimisticStatus,
    finalStatus,
    projectionRefreshKeys: playerRefreshKeysForAction(trace.dispatchKind),
  });
}

export async function submitPlayerRouteCommand({
  action,
  composerBody,
  commandIdFactory,
  data,
  fetchImpl,
  projectionStore,
  sendCommandImpl = sendCommand,
}) {
  const commandStatus = await sendCommandImpl({
    ...buildPlayerCommandRequest({ data, action, composerBody }),
    commandIdFactory,
    fetchImpl,
  });
  const refreshKeys = playerRefreshKeysForCommandOutcome({
    data,
    action,
    commandStatus,
  });
  if (refreshKeys.length > 0) {
    await projectionStore.refresh(refreshKeys, { fetchImpl });
  }
  return Object.freeze({
    commandStatus,
    snapshot: projectionStore.getSnapshot(),
  });
}

export function playerRefreshKeysForCommandOutcome({ data, action, commandStatus }) {
  if (commandStatus?.state === "ack") {
    return playerRefreshKeysForDataAction(data, action);
  }
  if (commandStatus?.state === "reject" && commandStatus?.error === "PhaseLocked") {
    return playerRefreshKeysForDataActionWithCommandState(data, action);
  }
  if (commandStatus?.state === "reject" && commandStatus?.error === "ActionAlreadySubmitted") {
    return playerRefreshKeysForDataAction(data, action);
  }
  if (
    commandStatus?.state === "reject" &&
    commandStatus?.error === "InvalidTarget" &&
    playerRefreshKeysForAction(action).includes("commandState")
  ) {
    return playerRefreshKeysForDataAction(data, action);
  }
  if (
    commandStatus?.state === "reject" &&
    (commandStatus?.retryable === true || commandStatus?.error === "StreamConflict")
  ) {
    return playerRefreshKeysForDataAction(data, action);
  }
  return Object.freeze([]);
}

function playerRefreshKeysForDataAction(data, action) {
  const keys = playerRefreshKeysForAction(action);
  if (data.coldLoad.commandStateEndpoint != null) {
    return keys;
  }
  return Object.freeze(keys.filter((key) => key !== "commandState"));
}

function playerRefreshKeysForDataActionWithCommandState(data, action) {
  const keys = [...playerRefreshKeysForDataAction(data, action)];
  if (
    data.coldLoad.commandStateEndpoint != null &&
    !keys.includes("commandState")
  ) {
    keys.push("commandState");
  }
  return Object.freeze(keys);
}

export function playerActionConfig(data, action) {
  return (
    data.composer.actionCommands?.find(
      (command) => String(command.action) === String(action),
    ) ?? null
  );
}

export async function loadOlderPlayerThreadPage({
  data,
  fetchImpl,
  projectionStore,
  thread,
}) {
  if (thread.nextBeforeSeq === null) {
    return Object.freeze({
      threadPageStatus: playerThreadNoOlderStatus(),
      snapshot: projectionStore.getSnapshot(),
    });
  }

  const response = await fetchImpl(
    playerThreadUrl({
      game: data.game.id,
      channel: data.threadPager.channel,
      principalUserId: data.player.principalUserId,
      limit: data.threadPager.pageSize,
      beforeSeq: thread.nextBeforeSeq,
    }),
    {
      headers: { accept: "application/json" },
    },
  );
  if (!response.ok) {
    throw new Error(`Thread page rejected: ${response.status}`);
  }
  const olderPage = normalizeThreadPage(await response.json(), {
    nextBeforeSeq: thread.nextBeforeSeq,
    posts: [],
  });
  const mergedThread = mergeThreadPage(thread, olderPage);
  const snapshot = projectionStore.applySnapshot({
    thread: mergedThread,
  });
  return Object.freeze({
    threadPageStatus: threadPageStatusForResult(olderPage.posts.length),
    snapshot,
  });
}

export function normalizePrivateRows(payload, previous) {
  if (Array.isArray(payload)) {
    return Object.freeze(payload);
  }
  return previous;
}

function errorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
