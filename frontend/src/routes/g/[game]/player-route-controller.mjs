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
  normalizeDayVoteOutcomes,
  normalizeEndgameSummary,
  normalizePlayerCommandState,
  normalizeVotecount,
  playerThreadUrl,
} from "../../../lib/app/cold-load.mjs";
import {
  mergeThreadPage,
  threadPageStatusForResult,
} from "../../../lib/components/player-thread/player-thread-model.mjs";
import { commandInterruptionStatus } from "../../../lib/app/command-interruption.mjs";

export function buildPlayerProjectionInitialSnapshot(data) {
  return Object.freeze({
    thread: data.thread,
    votecount: data.votecount,
    dayVoteOutcomes: data.dayVoteOutcomes,
    endgameSummary: data.endgameSummary,
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
    dayVoteOutcomes: Object.freeze({
      url: data.coldLoad.dayVoteOutcomesEndpoint,
      normalize: normalizeDayVoteOutcomes,
    }),
    endgameSummary: Object.freeze({
      url: data.coldLoad.endgameSummaryEndpoint,
      normalize: normalizeEndgameSummary,
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
    "dayVoteOutcomes",
    "endgameSummary",
    ...(data.coldLoad.notificationsEndpoint === null ? [] : ["notifications"]),
    ...(data.coldLoad.investigationResultsEndpoint === null
      ? []
      : ["investigationResults"]),
    ...(data.coldLoad.commandStateEndpoint == null ? [] : ["commandState"]),
  ]);
}

export function playerRefreshKeysForLiveDelta(data, message) {
  if (message?.kind !== "delta") {
    return Object.freeze([]);
  }
  const keys = [];
  if (message.delta?.kind === "DayVoteOutcomeApplied") {
    keys.push("dayVoteOutcomes");
  }
  if (data.coldLoad.commandStateEndpoint != null) {
    keys.push("commandState");
  }
  return Object.freeze(keys);
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

export function playerCommandInterruptedStatus(error, { action, commandId }) {
  const status = commandInterruptionStatus(error, {
    actionId: action,
    commandId,
  });
  return status === null
    ? null
    : attachCommandTrace(status, playerCommandTrace(action));
}

export function recordPlayerCommandReceipt(
  commandReceipts,
  action,
  status,
  projectionRefreshKeys = null,
) {
  const commandTrace =
    status?.commandTrace ?? playerCommandTrace(String(action));
  const receipt = Object.freeze({
    actionId: String(action),
    state: String(status?.state ?? "info"),
    message: String(status?.message ?? "Command updated"),
    commandTrace:
      projectionRefreshKeys === null
        ? commandTrace
        : Object.freeze({
            ...commandTrace,
            projectionRefreshKeys: Object.freeze([...projectionRefreshKeys]),
          }),
    current: true,
  });
  return Object.freeze([
    ...commandReceipts
      .filter((item) => item.actionId !== receipt.actionId)
      .map((item) => Object.freeze({ ...item, current: false })),
    receipt,
  ]);
}

export function clearPlayerCommandReceipt(commandReceipts, action) {
  return Object.freeze(
    commandReceipts.filter((item) => item.actionId !== String(action)),
  );
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
  if (
    normalizedAction === "submit_vote" ||
    normalizedAction.startsWith("submit_vote:")
  ) {
    return Object.freeze(["votecount", "commandState"]);
  }
  if (
    normalizedAction === "withdraw_action" ||
    normalizedAction.startsWith("withdraw_action:")
  ) {
    return Object.freeze(["commandState"]);
  }
  switch (normalizedAction) {
    case "submit_post":
      return Object.freeze(["thread", "votecount", "commandState", "dayVoteOutcomes"]);
    case "withdraw_vote":
      return Object.freeze(["votecount", "commandState"]);
    default:
      return Object.freeze([]);
  }
}

export function buildPlayerCommandRequest({ data, action, composerBody, media = [] }) {
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
      media,
      target: data.composer.voteTargetSlot,
      actionConfig,
    }),
  });
}

export function buildPlayerCommandDispatchBridgePlan({
  data,
  action,
  composerBody,
  media = [],
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
    media,
  });
  return buildDispatchBridgePlanFromRequest({
    role: "player",
    trace,
    request,
    optimisticStatus,
    finalStatus,
    projectionRefreshKeys: playerRefreshKeysForCommandOutcome({
      data,
      action: trace.dispatchKind,
      commandStatus: finalStatus,
    }),
  });
}

export async function submitPlayerRouteCommand({
  action,
  composerBody,
  media = [],
  commandIdFactory,
  signal,
  data,
  fetchImpl,
  projectionStore,
  sendCommandImpl = sendCommand,
}) {
  const commandStatus = await sendCommandImpl({
    ...buildPlayerCommandRequest({ data, action, composerBody, media }),
    commandIdFactory,
    fetchImpl,
    signal,
  });
  if (commandStatus?.state === "reject" && commandStatus?.error === "NotYourSlot") {
    projectionStore.applySnapshot({
      commandState: staleSlotOwnershipCommandState({ data, commandStatus }),
    });
    return Object.freeze({
      commandStatus,
      snapshot: projectionStore.getSnapshot(),
    });
  }
  const refreshKeys = playerRefreshKeysForCommandOutcome({
    data,
    action,
    commandStatus,
  });
  if (refreshKeys.length > 0) {
    await projectionStore.refresh(refreshKeys, { fetchImpl, signal });
  }
  return Object.freeze({
    commandStatus,
    snapshot: projectionStore.getSnapshot(),
  });
}

export async function uploadPlayerPostMedia({
  data,
  file,
  alt,
  fetchImpl,
}) {
  if (file === null || file === undefined) {
    return Object.freeze([]);
  }
  if (typeof fetchImpl !== "function") {
    throw new TypeError("media upload requires fetch");
  }
  const contentType = String(file.type ?? "").toLowerCase();
  const allowedTypes = data.composer.mediaUploadTypes ?? ["image/png", "image/jpeg"];
  if (!allowedTypes.includes(contentType)) {
    throw new TypeError("Choose a PNG or JPEG image");
  }
  const size = Number(file.size);
  if (
    !Number.isFinite(size) ||
    size <= 0 ||
    size > Number(data.composer.mediaMaxEncodedBytes ?? 12 * 1024 * 1024)
  ) {
    throw new TypeError("Image must be non-empty and no larger than 12 MiB");
  }
  const normalizedAlt = String(alt ?? "").trim();
  if (normalizedAlt === "" || normalizedAlt.length > 1_000) {
    throw new TypeError("Image alt text must contain 1 to 1000 characters");
  }
  const response = await fetchImpl(data.composer.mediaUploadEndpoint, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": contentType,
    },
    body: file,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.message ?? `Media upload failed with ${response.status}`);
  }
  const contentId = String(payload?.content_id ?? "");
  if (!/^[0-9a-f]{64}$/u.test(contentId)) {
    throw new Error("Media upload returned an invalid content id");
  }
  return Object.freeze([
    Object.freeze({
      content_id: contentId,
      alt: normalizedAlt,
    }),
  ]);
}

export function playerRefreshKeysForCommandOutcome({ data, action, commandStatus }) {
  if (commandStatus?.state === "ack") {
    return playerRefreshKeysForDataAction(data, action);
  }
  if (commandStatus?.state === "reject" && commandStatus?.error === "PhaseLocked") {
    return playerRefreshKeysForStalePhase(data, action);
  }
  if (commandStatus?.state === "reject" && commandStatus?.error === "ActionAlreadySubmitted") {
    return playerRefreshKeysForDataAction(data, action);
  }
  if (commandStatus?.state === "reject" && commandStatus?.error === "SlotNotAlive") {
    return playerRefreshKeysForDataActionWithCommandState(data, action);
  }
  if (commandStatus?.state === "reject" && commandStatus?.error === "GameAlreadyCompleted") {
    return playerRefreshKeysForCompletedGame(data, action);
  }
  if (
    commandStatus?.state === "reject" &&
    commandStatus?.error === "InvalidTarget" &&
    (String(action).startsWith("submit_action") ||
      String(action).startsWith("submit_invalid_action") ||
      String(action).startsWith("submit_vote"))
  ) {
    return playerRefreshKeysForDataActionWithCommandState(data, action);
  }
  if (
    commandStatus?.state === "reject" &&
    (commandStatus?.retryable === true || commandStatus?.error === "StreamConflict")
  ) {
    return playerRefreshKeysForDataAction(data, action);
  }
  return Object.freeze([]);
}

export function staleSlotOwnershipCommandState({ data, commandStatus }) {
  const previous = data.commandState ?? {};
  const slotId = data.player?.slotId ?? previous.actorSlot ?? null;
  return Object.freeze({
    ...previous,
    game: data.game?.id ?? previous.game ?? null,
    actorSlot: slotId,
    actorAlive: false,
    actorStatus: "replaced",
    roleKey: null,
    actions: Object.freeze([]),
    boundary: `${commandStatus?.message ?? "Reject NotYourSlot"}. The current session no longer owns ${slotId ?? "this slot"}; reload with a current role URL.`,
  });
}

function playerRefreshKeysForDataAction(data, action) {
  const keys = playerRefreshKeysForAction(action);
  if (data.coldLoad?.commandStateEndpoint != null) {
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

function playerRefreshKeysForCompletedGame(data, action) {
  const keys = [...playerRefreshKeysForDataActionWithCommandState(data, action)];
  if (
    data.coldLoad.endgameSummaryEndpoint != null &&
    !keys.includes("endgameSummary")
  ) {
    keys.push("endgameSummary");
  }
  return Object.freeze(keys);
}

function playerRefreshKeysForStalePhase(data, action) {
  const keys = [...playerRefreshKeysForDataActionWithCommandState(data, action)];
  if (
    data.coldLoad?.dayVoteOutcomesEndpoint != null &&
    !keys.includes("dayVoteOutcomes")
  ) {
    keys.push("dayVoteOutcomes");
  }
  return Object.freeze(keys);
}

export function playerActionConfig(data, action) {
  return (
    data.composer.voteCommands?.find(
      (command) => String(command.action) === String(action),
    ) ??
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
