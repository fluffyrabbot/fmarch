import {
  EMPTY_PLAYER_COMMAND_STATE,
  authenticatedGameReadUrl,
  dayVoteOutcomesUrl,
  endgameSummaryUrl,
  hostPromptsUrl,
  hostVotecountUrl,
  normalizeDayVoteOutcomes,
  normalizeEndgameSummary,
  normalizeHostPrompts,
  normalizePlayerCommandState,
  normalizeThreadPage,
  normalizeVotecount,
  playerCommandStateUrl,
  playerThreadUrl,
  playerVotecountUrl,
  slotMentionsUrl,
  ssrFetchTimeoutMs,
} from "../app/cold-load.mjs";
import {
  validateEndgameSummaryResponse,
  validateGameplayThreadPageResponse,
  validateDayVoteOutcomesResponse,
  validateHostConsoleAuthorityExpectation,
  validateHostConsoleStateResponse,
  validateHostPromptsResponse,
  validatePlayerCommandStateResponse,
  validatePlayerInvestigationResultsResponse,
  validatePlayerNotificationsResponse,
  validateSlotMentionsResponse,
  validateVotecountResponse,
} from "../app/gameplay-response-schema.mjs";
import { fetchUpstreamJson } from "./upstream-client.mjs";

const EMPTY_ROWS = Object.freeze([]);
const EMPTY_THREAD_PAGE = Object.freeze({
  nextBeforeSeq: null,
  posts: EMPTY_ROWS,
});

export const EMPTY_PLAYER_GAMEPLAY_SNAPSHOT = Object.freeze({
  thread: EMPTY_THREAD_PAGE,
  votecount: EMPTY_ROWS,
  dayVoteOutcomes: EMPTY_ROWS,
  endgameSummary: null,
  notifications: EMPTY_ROWS,
  investigationResults: EMPTY_ROWS,
  slotMentions: EMPTY_ROWS,
  commandState: EMPTY_PLAYER_COMMAND_STATE,
});

export const EMPTY_HOST_GAMEPLAY_SNAPSHOT = Object.freeze({
  hostPrompts: EMPTY_ROWS,
  votecount: EMPTY_ROWS,
  dayVoteOutcomes: EMPTY_ROWS,
  hostConsoleState: null,
});

/**
 * Loads the complete server-rendered player projection as one authority unit.
 * A single failed or malformed endpoint invalidates the whole aggregate; no
 * mixture of live and substitute state crosses this boundary.
 */
export async function loadPlayerGameplaySnapshot({
  game,
  activeChannel = "main",
  principalId,
  actorSlot = null,
  fetchImpl,
  apiBaseUrl = "",
  timeoutMs = ssrFetchTimeoutMs(),
}) {
  const hasPlayerScope =
    nonEmptyString(principalId) && nonEmptyString(actorSlot);
  const requests = [
    request("thread", {
      fetchImpl,
      timeoutMs,
      url: playerThreadUrl({
        apiBaseUrl,
        game,
        channel: activeChannel,
        limit: 50,
      }),
      validate: (value) =>
        validateGameplayThreadPageResponse(value, {
          game,
          channel: activeChannel,
        }),
    }),
    request("votecount", {
      fetchImpl,
      timeoutMs,
      url: playerVotecountUrl({ apiBaseUrl, game }),
      validate: (value) => validateVotecountResponse(value, { game }),
    }),
    request("dayVoteOutcomes", {
      fetchImpl,
      timeoutMs,
      url: dayVoteOutcomesUrl({ apiBaseUrl, game }),
      validate: (value) => validateDayVoteOutcomesResponse(value, { game }),
    }),
    request("endgameSummary", {
      fetchImpl,
      timeoutMs,
      url: endgameSummaryUrl({ apiBaseUrl, game }),
      validate: (value) => validateEndgameSummaryResponse(value, { game }),
    }),
    ...(hasPlayerScope
      ? [
          request("notifications", {
            fetchImpl,
            timeoutMs,
            url: authenticatedGameReadUrl({
              apiBaseUrl,
              game,
              path: "notifications",
            }),
            validate: (value) =>
              validatePlayerNotificationsResponse(value, {
                game,
                actorSlot,
              }),
          }),
          request("investigationResults", {
            fetchImpl,
            timeoutMs,
            url: authenticatedGameReadUrl({
              apiBaseUrl,
              game,
              path: "investigation-results",
            }),
            validate: (value) =>
              validatePlayerInvestigationResultsResponse(value, {
                game,
                actorSlot,
              }),
          }),
          request("slotMentions", {
            fetchImpl,
            timeoutMs,
            url: slotMentionsUrl({ apiBaseUrl, game }),
            validate: (value) =>
              validateSlotMentionsResponse(value, {
                game,
                actorSlot,
              }),
          }),
          request("commandState", {
            fetchImpl,
            timeoutMs,
            url: playerCommandStateUrl({
              apiBaseUrl,
              game,
              slotId: actorSlot,
            }),
            validate: (value) =>
              validatePlayerCommandStateResponse(value, {
                game,
                actorSlot,
              }),
          }),
        ]
      : []),
  ];

  const results = await Promise.all(requests.map(({ promise }) => promise));
  const failure = firstFailure(requests, results);
  if (failure !== null) {
    return failedSnapshot(failure, EMPTY_PLAYER_GAMEPLAY_SNAPSHOT);
  }

  const values = valuesByEndpoint(requests, results);
  return readySnapshot(
    Object.freeze({
      thread: normalizeThreadPage(values.thread, EMPTY_THREAD_PAGE),
      votecount: normalizeVotecount(values.votecount, EMPTY_ROWS),
      dayVoteOutcomes: normalizeDayVoteOutcomes(
        values.dayVoteOutcomes,
        EMPTY_ROWS,
      ),
      endgameSummary: normalizeEndgameSummary(values.endgameSummary, null),
      notifications: hasPlayerScope
        ? freezeJson(values.notifications)
        : EMPTY_ROWS,
      investigationResults: hasPlayerScope
        ? freezeJson(values.investigationResults)
        : EMPTY_ROWS,
      slotMentions: hasPlayerScope ? freezeJson(values.slotMentions) : EMPTY_ROWS,
      commandState: hasPlayerScope
        ? normalizePlayerCommandState(
            values.commandState,
            EMPTY_PLAYER_COMMAND_STATE,
          )
        : EMPTY_PLAYER_COMMAND_STATE,
    }),
  );
}

/**
 * Loads the host read model as one authority unit. In particular, the host
 * console authority object is never replaced by a fixture after a read fails.
 */
export async function loadHostGameplaySnapshot({
  game,
  expectedPrincipalId = null,
  expectedCapabilityKind = null,
  fetchImpl,
  apiBaseUrl = "",
  hostConsoleStateEndpoint = null,
  timeoutMs = ssrFetchTimeoutMs(),
}) {
  const hasConsoleEndpoint = nonEmptyString(hostConsoleStateEndpoint);
  if (!hasConsoleEndpoint) {
    return failedSnapshot(
      {
        endpoint: "hostConsoleState",
        result: Object.freeze({
          kind: "unavailable",
          status: null,
          reason: "missing_endpoint",
          requestId: null,
          retryAfterSeconds: null,
        }),
      },
      EMPTY_HOST_GAMEPLAY_SNAPSHOT,
    );
  }
  if (!validateHostConsoleAuthorityExpectation({
    expectedPrincipalId,
    expectedCapabilityKind,
  })) {
    return failedSnapshot(
      {
        endpoint: "hostConsoleState",
        result: Object.freeze({
          kind: "unavailable",
          status: null,
          reason: "missing_authority_contract",
          requestId: null,
          retryAfterSeconds: null,
        }),
      },
      EMPTY_HOST_GAMEPLAY_SNAPSHOT,
    );
  }
  const requests = [
    request("hostPrompts", {
      fetchImpl,
      timeoutMs,
      url: hostPromptsUrl({ apiBaseUrl, game }),
      validate: (value) => validateHostPromptsResponse(value, { game }),
    }),
    request("votecount", {
      fetchImpl,
      timeoutMs,
      url: hostVotecountUrl({ apiBaseUrl, game }),
      validate: (value) => validateVotecountResponse(value, { game }),
    }),
    request("dayVoteOutcomes", {
      fetchImpl,
      timeoutMs,
      url: dayVoteOutcomesUrl({ apiBaseUrl, game }),
      validate: (value) => validateDayVoteOutcomesResponse(value, { game }),
    }),
    request("hostConsoleState", {
      fetchImpl,
      timeoutMs,
      url: hostConsoleStateEndpoint,
      validate: (value) =>
        validateHostConsoleStateResponse(value, {
          game,
          expectedPrincipalId,
          expectedCapabilityKind,
        }),
    }),
  ];

  const results = await Promise.all(requests.map(({ promise }) => promise));
  const failure = firstFailure(requests, results);
  if (failure !== null) {
    return failedSnapshot(failure, EMPTY_HOST_GAMEPLAY_SNAPSHOT);
  }

  const values = valuesByEndpoint(requests, results);
  return readySnapshot(
    Object.freeze({
      hostPrompts: normalizeHostPrompts(values.hostPrompts, EMPTY_ROWS),
      votecount: normalizeVotecount(values.votecount, EMPTY_ROWS),
      dayVoteOutcomes: normalizeDayVoteOutcomes(
        values.dayVoteOutcomes,
        EMPTY_ROWS,
      ),
      hostConsoleState: freezeJson(values.hostConsoleState),
    }),
  );
}

function request(endpoint, input) {
  return Object.freeze({
    endpoint,
    promise: fetchUpstreamJson(input),
  });
}

function firstFailure(requests, results) {
  for (let index = 0; index < requests.length; index += 1) {
    const result = results[index];
    if (result?.kind !== "ok") {
      return Object.freeze({ endpoint: requests[index].endpoint, result });
    }
  }
  return null;
}

function valuesByEndpoint(requests, results) {
  return Object.fromEntries(
    requests.map(({ endpoint }, index) => [endpoint, results[index].value]),
  );
}

function readySnapshot(data) {
  return Object.freeze({
    kind: "ready",
    data: freezeJson(data),
  });
}

function failedSnapshot({ endpoint, result }, emptyData) {
  return Object.freeze({
    kind: result?.kind ?? "unavailable",
    endpoint,
    status: result?.status ?? null,
    reason: result?.reason ?? "unknown_failure",
    requestId: result?.requestId ?? null,
    retryAfterSeconds: result?.retryAfterSeconds ?? null,
    data: emptyData,
  });
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function freezeJson(value) {
  if (value === null || typeof value !== "object") {
    return value;
  }
  for (const child of Object.values(value)) {
    freezeJson(child);
  }
  return Object.isFrozen(value) ? value : Object.freeze(value);
}
