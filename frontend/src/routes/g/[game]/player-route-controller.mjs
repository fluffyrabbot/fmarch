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
import {
  CommandInterruptedError,
  commandInterruptionStatus,
  executeCommandProjectionRecovery,
} from "../../../lib/app/command-interruption.mjs";
import {
  persistInterruptedCommandAttempts,
  readInterruptedCommandAttempts,
} from "../../../lib/app/command-recovery-storage.mjs";
import {
  validateDayVoteOutcomesResponse,
  validateEndgameSummaryResponse,
  validateGameplayThreadPageResponse,
  validatePlayerInvestigationResultsResponse,
  validatePlayerNotificationsResponse,
  validatePlayerPrivateLiveDelta,
  validatePlayerCommandStateResponse,
  validateSlotMentionsResponse,
  validateVotecountResponse,
} from "../../../lib/app/gameplay-response-schema.mjs";

export function playerComposerDraftFromState({
  body = "",
  mediaAlt = "",
  mediaFiles,
  quotations = [],
  mentions = [],
  embedUrl = "",
} = {}) {
  return Object.freeze({
    body: String(body ?? ""),
    mediaAlt: String(mediaAlt ?? ""),
    mediaFiles,
    quotations: Object.freeze([...(Array.isArray(quotations) ? quotations : [])]),
    // Seats are attached per channel: a roster is a property of the room, so
    // an address carried into another room would name a seat that cannot read
    // it.
    mentions: Object.freeze([...(Array.isArray(mentions) ? mentions : [])]),
    embedUrl: String(embedUrl ?? ""),
  });
}

export function clearedPlayerComposerDraft() {
  return playerComposerDraftFromState();
}

export function applyPlayerComposerChannelDraft({
  drafts = {},
  previousChannel,
  nextChannel,
  current = {},
} = {}) {
  const previous = String(previousChannel ?? "");
  const next = String(nextChannel ?? "");
  const nextDrafts = { ...drafts };
  if (previous !== "" && previous !== next) {
    nextDrafts[previous] = playerComposerDraftFromState({
      body: current.body,
      quotations: current.quotations,
      mentions: current.mentions,
      embedUrl: current.embedUrl,
    });
  }
  return Object.freeze({
    drafts: Object.freeze(nextDrafts),
    draft: nextDrafts[next] ?? clearedPlayerComposerDraft(),
  });
}

export function playerAllowMediaOnlyPost(data, channelId) {
  const channel = String(
    channelId ?? data?.threadPager?.channel ?? data?.channel?.channel ?? "main",
  );
  const policies = Array.isArray(data?.commandState?.postPolicies)
    ? data.commandState.postPolicies
    : Array.isArray(data?.composer?.postPolicies)
      ? data.composer.postPolicies
      : [];
  return policies.some(
    (policy) =>
      String(policy?.channelId ?? policy?.channel_id ?? "") === channel &&
      (policy?.allowMediaOnly === true || policy?.allow_media_only === true),
  );
}

export function buildPlayerProjectionInitialSnapshot(data) {
  return Object.freeze({
    thread: data.thread,
    votecount: data.votecount,
    dayVoteOutcomes: data.dayVoteOutcomes,
    endgameSummary: data.endgameSummary,
    notifications: data.notifications,
    investigationResults: data.investigationResults,
    slotMentions: data.slotMentions,
    commandState: data.commandState,
  });
}

export function buildPlayerProjectionColdLoads(data) {
  const privateThread = String(data.threadPager?.channel ?? "main") !== "main";
  return Object.freeze({
    thread: Object.freeze({
      url: data.coldLoad.threadEndpoint,
      validate: (payload) =>
        validateGameplayThreadPageResponse(payload, {
          game: data.game.id,
          channel: data.threadPager?.channel ?? "main",
        }),
      normalize: normalizeThreadPage,
      ...(privateThread
        ? {
            revoke: () => Object.freeze({
              posts: Object.freeze([]),
              nextBeforeSeq: null,
            }),
          }
        : {}),
    }),
    votecount: Object.freeze({
      url: data.coldLoad.votecountEndpoint,
      validate: (payload) =>
        validateVotecountResponse(payload, { game: data.game.id }),
      normalize: normalizeVotecount,
    }),
    dayVoteOutcomes: Object.freeze({
      url: data.coldLoad.dayVoteOutcomesEndpoint,
      validate: (payload) =>
        validateDayVoteOutcomesResponse(payload, { game: data.game.id }),
      normalize: normalizeDayVoteOutcomes,
    }),
    endgameSummary: Object.freeze({
      url: data.coldLoad.endgameSummaryEndpoint,
      validate: (payload) =>
        validateEndgameSummaryResponse(payload, { game: data.game.id }),
      normalize: normalizeEndgameSummary,
    }),
    ...(data.coldLoad.notificationsEndpoint === null
      ? {}
      : {
          notifications: Object.freeze({
            url: data.coldLoad.notificationsEndpoint,
            validate: (payload) =>
              validatePlayerNotificationsResponse(payload, {
                game: data.game.id,
                actorSlot: data.player.slotId,
              }),
            validateLiveDelta: (delta) =>
              validatePlayerPrivateLiveDelta(delta, {
                game: data.game.id,
                actorSlot: data.player.slotId,
              }),
            normalize: normalizePrivateRows,
            revoke: Object.freeze([]),
          }),
        }),
    ...(data.coldLoad.investigationResultsEndpoint === null
      ? {}
      : {
          investigationResults: Object.freeze({
            url: data.coldLoad.investigationResultsEndpoint,
            validate: (payload) =>
              validatePlayerInvestigationResultsResponse(payload, {
                game: data.game.id,
                actorSlot: data.player.slotId,
              }),
            validateLiveDelta: (delta) =>
              validatePlayerPrivateLiveDelta(delta, {
                game: data.game.id,
                actorSlot: data.player.slotId,
              }),
            normalize: normalizePrivateRows,
            revoke: Object.freeze([]),
          }),
        }),
    ...(data.coldLoad.slotMentionsEndpoint === null
      ? {}
      : {
          slotMentions: Object.freeze({
            url: data.coldLoad.slotMentionsEndpoint,
            validate: (payload) =>
              validateSlotMentionsResponse(payload, {
                game: data.game.id,
                actorSlot: data.player.slotId,
              }),
            validateLiveDelta: (delta) =>
              validatePlayerPrivateLiveDelta(delta, {
                game: data.game.id,
                actorSlot: data.player.slotId,
              }),
            normalize: normalizePrivateRows,
            revoke: Object.freeze([]),
          }),
        }),
    ...(data.coldLoad.commandStateEndpoint == null
      ? {}
      : {
          commandState: Object.freeze({
            url: data.coldLoad.commandStateEndpoint,
            validate: (payload) =>
              validatePlayerCommandStateResponse(payload, {
                game: data.game.id,
                actorSlot: data.player.slotId,
              }),
            normalize: normalizePlayerCommandState,
            normalizeError: normalizePlayerCommandStateRefreshError,
            revoke: () => revokedPlayerCommandState({
              game: data.game.id,
              actorSlot: data.player.slotId,
            }),
          }),
        }),
  });
}

export function revokedPlayerCommandState({ game, actorSlot }) {
  return Object.freeze({
    game,
    actorSlot,
    actorAlive: false,
    actorStatus: "replaced",
    roleKey: null,
    role: null,
    gameCompleted: false,
    phase: null,
    actions: Object.freeze([]),
    currentActions: Object.freeze([]),
    voteTargets: Object.freeze([]),
    currentVote: null,
    dayEvents: Object.freeze([]),
    dayEventRooms: Object.freeze([]),
    postPolicies: Object.freeze([]),
    boundary:
      "Live ticket authority was denied. Player-private state and commands were revoked.",
  });
}

export function normalizePlayerCommandStateRefreshError({ status, previous }) {
  if (status !== 403 || previous === null || typeof previous !== "object") {
    return undefined;
  }
  return Object.freeze({
    ...previous,
    actorAlive: false,
    actorStatus: "replaced",
    roleKey: null,
    role: null,
    actions: Object.freeze([]),
    currentActions: Object.freeze([]),
    voteTargets: Object.freeze([]),
    currentVote: null,
    dayEvents: Object.freeze([]),
    dayEventRooms: Object.freeze([]),
    boundary:
      "Slot authority changed. Player-private command state and room discovery were revoked.",
  });
}

export function playerReconnectRefreshKeys(data) {
  return Object.freeze([
    "thread",
    "votecount",
    "dayVoteOutcomes",
    "endgameSummary",
    ...(data.coldLoad.notificationsEndpoint === null ? [] : ["notifications"]),
    ...(data.coldLoad.investigationResultsEndpoint === null
      ? []
      : ["investigationResults"]),
    ...(data.coldLoad.slotMentionsEndpoint === null ? [] : ["slotMentions"]),
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

export function persistPlayerInterruptedCommands({
  storage,
  game,
  principalId,
  actorSlot,
  attempts,
}) {
  return persistInterruptedCommandAttempts({
    storage,
    game,
    surface: "player",
    authority: playerRecoveryAuthority({ principalId, actorSlot }),
    attempts,
  });
}

export function restorePlayerInterruptedCommands({
  storage,
  game,
  principalId,
  actorSlot,
}) {
  const attempts = readInterruptedCommandAttempts({
    storage,
    game,
    surface: "player",
    authority: playerRecoveryAuthority({ principalId, actorSlot }),
  });
  let commandStatus = null;
  let commandReceipts = Object.freeze([]);
  for (const [action, attempt] of Object.entries(attempts)) {
    const status = playerCommandInterruptedStatus(
      new CommandInterruptedError(attempt.interruption),
      { action, commandId: attempt.commandId },
    );
    if (status === null) {
      continue;
    }
    commandStatus = status;
    commandReceipts = recordPlayerCommandReceipt(commandReceipts, action, status);
  }
  return Object.freeze({
    attempts,
    commandStatus,
    commandReceipts,
  });
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
  if (
    normalizedAction.startsWith("submit_day_event:") ||
    normalizedAction.startsWith("withdraw_day_event:")
  ) {
    return Object.freeze(["commandState"]);
  }
  switch (normalizedAction) {
    case "submit_post":
      // A post can address a seat, and that delivery lands in the author's own
      // rail too when they addressed themselves out of a room they still read.
      return Object.freeze([
        "thread",
        "votecount",
        "commandState",
        "dayVoteOutcomes",
        "slotMentions",
      ]);
    case "withdraw_vote":
      return Object.freeze(["votecount", "commandState"]);
    default:
      return Object.freeze([]);
  }
}

export function buildPlayerCommandRequest({
  data,
  action,
  composerBody,
  media = [],
  quotations = [],
  mentions = [],
  embedUrl = "",
}) {
  const actionConfig = playerActionConfig(data, action);
  return Object.freeze({
    endpoint: data.composer.commandEndpoint,
    command: buildPlayerCommand({
      action,
      game: data.game.id,
      channelId: data.threadPager.channel,
      actorSlot: data.player.slotId,
      body: composerBody,
      media,
      quotations,
      mentions,
      embedUrl,
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
  quotations = [],
  mentions = [],
  embedUrl = "",
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
    quotations,
    mentions,
    embedUrl,
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
  quotations = [],
  mentions = [],
  embedUrl = "",
  commandIdFactory,
  signal,
  data,
  fetchImpl,
  projectionStore,
  preparedCommand = null,
  sendCommandImpl = sendCommand,
  projectionRecoveryTimeoutMs,
}) {
  const commandStatus = await dispatchPlayerRouteCommand({
    action,
    composerBody,
    media,
    quotations,
    mentions,
    embedUrl,
    commandIdFactory,
    signal,
    data,
    fetchImpl,
    projectionStore,
    preparedCommand,
    sendCommandImpl,
  });
  return recoverPlayerRouteCommand({
    action,
    data,
    fetchImpl,
    projectionStore,
    commandStatus,
    projectionRecoveryTimeoutMs,
  });
}

export async function dispatchPlayerRouteCommand({
  action,
  composerBody,
  media = [],
  quotations = [],
  mentions = [],
  embedUrl = "",
  commandIdFactory,
  signal,
  data,
  fetchImpl,
  projectionStore,
  preparedCommand = null,
  sendCommandImpl = sendCommand,
}) {
  if (data?.commandsEnabled !== true) {
    throw new Error("player commands are disabled without an authoritative route snapshot");
  }
  if (projectionStore?.isReady?.() !== true) {
    throw new Error(
      "player commands are disabled until authoritative projection freshness is restored",
    );
  }
  const currentCommandState = projectionStore.getSnapshot()?.commandState;
  const dispatchData = Object.freeze({
    ...data,
    commandState: currentCommandState,
  });
  if (!playerCommandAuthorityIsCurrent({
    data: dispatchData,
    commandState: currentCommandState,
  })) {
    throw new Error("player command authority changed before dispatch");
  }
  if (!playerActionIsCurrentlyAfforded({
    data: dispatchData,
    commandState: currentCommandState,
    action,
  })) {
    throw new Error(`player action ${String(action)} is no longer authoritative`);
  }
  const currentRequest = buildPlayerCommandRequest({
    data: dispatchData,
    action,
    composerBody,
    media,
    quotations,
    mentions,
    embedUrl,
  });
  if (
    preparedCommand !== null &&
    canonicalJson(preparedCommand) !== canonicalJson(currentRequest.command)
  ) {
    throw new Error(
      `player action ${String(action)} no longer matches the interrupted command body`,
    );
  }
  return sendCommandImpl({
    endpoint: currentRequest.endpoint,
    command: preparedCommand ?? currentRequest.command,
    commandIdFactory,
    fetchImpl,
    signal,
  });
}

export async function recoverPlayerRouteCommand({
  action,
  data,
  fetchImpl,
  projectionStore,
  commandStatus,
  projectionRecoveryTimeoutMs,
  executeProjectionRecoveryImpl = executeCommandProjectionRecovery,
}) {
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
    try {
      await executeProjectionRecoveryImpl({
        timeoutMs: projectionRecoveryTimeoutMs,
        operation: ({ signal }) =>
          projectionStore.refresh(refreshKeys, { fetchImpl, signal }),
      });
    } catch (error) {
      projectionStore.invalidate?.(undefined, {
        reason: "confirmed_player_command_projection_recovery_failed",
      });
      return Object.freeze({
        commandStatus: projectionUnavailablePlayerCommandStatus(
          commandStatus,
          error,
        ),
        snapshot: projectionStore.getSnapshot(),
      });
    }
  }
  return Object.freeze({
    commandStatus,
    snapshot: projectionStore.getSnapshot(),
  });
}

export function playerCommandAuthorityIsCurrent({ data, commandState }) {
  return (
    commandState !== null &&
    typeof commandState === "object" &&
    commandState.actorSlot === data?.player?.slotId &&
    commandState.actorStatus !== "replaced" &&
    commandState.actorStatus !== "pending_replacement" &&
    commandState.gameCompleted !== true
  );
}

function playerActionIsCurrentlyAfforded({ data, commandState, action }) {
  const normalizedAction = String(action);
  if (normalizedAction === "submit_post") {
    return data?.channel?.allowed === true;
  }
  if (normalizedAction === "withdraw_vote") {
    return commandState.currentVote !== null && commandState.phase?.locked !== true;
  }
  if (normalizedAction === "submit_vote" || normalizedAction.startsWith("submit_vote:")) {
    const voteTarget = playerActionConfig(data, action)?.voteTarget;
    return commandState.voteTargets?.some((target) =>
      voteTarget === "NoLynch"
        ? target.kind === "no_lynch"
        : target.kind === "slot" && target.slotId === voteTarget?.Slot,
    ) === true;
  }
  if (
    normalizedAction.startsWith("submit_action") ||
    normalizedAction.startsWith("submit_invalid_action")
  ) {
    const requested = playerActionConfig(data, action);
    return commandState.actions?.some(
      (current) =>
        current.templateId === requested?.templateId &&
        current.actionId === requested?.actionId &&
        requested.targets?.every((target) =>
          current.targets?.includes(target) || current.targetOptions?.includes(target),
        ) === true,
    ) === true;
  }
  if (normalizedAction.startsWith("withdraw_action:")) {
    const requested = playerActionConfig(data, action);
    return commandState.currentActions?.some(
      (current) =>
        current.templateId === requested?.templateId &&
        current.actionId === requested?.actionId,
    ) === true;
  }
  if (
    normalizedAction.startsWith("submit_day_event:") ||
    normalizedAction.startsWith("withdraw_day_event:")
  ) {
    const eventId = normalizedAction.slice(normalizedAction.indexOf(":") + 1);
    return commandState.dayEvents?.some(
      (event) =>
        event.eventId === eventId &&
        (normalizedAction.startsWith("submit_")
          ? event.canSubmit === true
          : event.canWithdraw === true),
    ) === true;
  }
  return false;
}

function projectionUnavailablePlayerCommandStatus(commandStatus, error) {
  const committed = commandStatus?.state === "ack";
  return Object.freeze({
    ...commandStatus,
    retryable: false,
    projectionUnavailable: true,
    message: committed
      ? `${commandStatus.message}. Command committed; authoritative state refresh is unavailable. Do not retry.`
      : `${commandStatus?.message ?? errorMessage(error)}. Authoritative state refresh is unavailable.`,
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
  if (
    commandStatus?.state === "reject" &&
    [
      "DuplicateParticipation",
      "ParticipationNotFound",
      "ParticipationNotAllowed",
      "DayEventStateConflict",
    ].includes(commandStatus?.error) &&
    (String(action).startsWith("submit_day_event:") ||
      String(action).startsWith("withdraw_day_event:"))
  ) {
    return playerRefreshKeysForDataActionWithCommandState(data, action);
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
  if (String(action) === "submit_post") {
    return Object.freeze({
      allowMediaOnlyPost: playerAllowMediaOnlyPost(data),
    });
  }
  return (
    data.composer.voteCommands?.find(
      (command) => String(command.action) === String(action),
    ) ??
    data.composer.actionCommands?.find(
      (command) => String(command.action) === String(action),
    ) ??
    data.composer.dayEventCommands?.find(
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

function playerRecoveryAuthority({ principalId, actorSlot }) {
  const principal = String(principalId ?? "").trim();
  const slot = String(actorSlot ?? "").trim();
  if (principal === "" || slot === "") {
    throw new TypeError("player command recovery requires principal and actor slot");
  }
  return `player:${principal}:${slot}`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function errorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
