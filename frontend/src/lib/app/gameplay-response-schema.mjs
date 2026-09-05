import { isCanonicalPrincipalId } from "../principal-id.mjs";

const HOST_ROUTE_CAPABILITY_KINDS = new Set(["HostOf", "CohostOf"]);
const COHOST_PERMISSION_CLASSES = new Set([
  "setup",
  "phase_resolve",
  "host_prompt_resolve",
  "lifecycle",
  "replacement",
  "deadline",
  "narrative",
  "ita_control",
  "effect_spec",
  "day_event_ops",
  "day_event_resolve",
  "program_attach",
]);
const HOST_TASK_KINDS = new Set(["engine_host_prompt", "day_event_resolve"]);
const HOST_TASK_COMMAND_KINDS = new Set([
  "resolve_host_prompt",
  "resolve_day_event",
]);
const MAX_U64_DECIMAL = "18446744073709551615";
const INVESTIGATION_RESULT_BOOLEAN_FIELDS = new Set([
  "vanilla",
  "vanilla_town",
  "has_gun",
  "killer",
  "specialist",
  "motion",
  "prior_motion",
  "changed",
]);
const INVESTIGATION_RESULT_STRING_FIELDS = new Set([
  "role",
  "alignment",
  "previous",
  "current",
]);
const INVESTIGATION_RESULT_STRING_ARRAY_FIELDS = new Set([
  "pt_access",
  "visited",
  "visitors",
  "visitor_roles",
  "actions",
  "action_types",
]);
const INVESTIGATION_RESULT_FIELDS = new Set([
  ...INVESTIGATION_RESULT_BOOLEAN_FIELDS,
  ...INVESTIGATION_RESULT_STRING_FIELDS,
  ...INVESTIGATION_RESULT_STRING_ARRAY_FIELDS,
]);

/**
 * This remains only for nested JSON columns whose schema is intentionally
 * owned elsewhere (for example DayEvent definitions). It must never be used
 * as an aggregate endpoint validator: a plain object is not a projection DTO.
 */
export function validateGameplayObjectRowArray(value) {
  return Array.isArray(value) && value.every(isPlainObject);
}

export function validateGameplayThreadPageResponse(
  value,
  { game, channel = "main" } = {},
) {
  if (!isPlainObject(value) || !nonEmptyString(channel)) {
    return false;
  }
  // The public main-thread page carries a GameIndexEntry. Private channel
  // pages do not, so every post is instead scope-bound below.
  if (value.game !== undefined && !isGameIndexEntryFor(value.game, game)) {
    return false;
  }
  return (
    isNullableSafeInteger(value.next_before_seq) &&
    Array.isArray(value.posts) &&
    value.posts.every((post) => isThreadPostFor(post, { game, channel }))
  );
}

export function validateVotecountResponse(value, { game } = {}) {
  return (
    Array.isArray(value) &&
    value.every((delta) =>
      isProjectionEnvelope(delta, "VoteCountChanged", (body) =>
        isVoteCountFor(body, game),
      ),
    )
  );
}

export function validateDayVoteOutcomesResponse(value, { game } = {}) {
  return (
    Array.isArray(value) &&
    value.every((delta) =>
      isProjectionEnvelope(delta, "DayVoteOutcomeApplied", (body) =>
        isDayVoteOutcomeFor(body, game),
      ),
    )
  );
}

export function validateEndgameSummaryResponse(value, { game } = {}) {
  return (
    value === null ||
    (isPlainObject(value) &&
      matchesExpectedGame(value.game, game) &&
      typeof value.completed === "boolean" &&
      isNullableEndgameWinner(value.winner) &&
      Array.isArray(value.slots) &&
      value.slots.every(isEndgameSlotReveal) &&
      Array.isArray(value.vote_history) &&
      value.vote_history.every(isEndgameDayVote) &&
      nonEmptyString(value.boundary))
  );
}

export function validateHostPromptsResponse(value, { game } = {}) {
  return (
    Array.isArray(value) &&
    value.every((prompt) => isHostPromptFor(prompt, game))
  );
}

function isProjectionEnvelope(value, kind, validateBody) {
  return (
    isPlainObject(value) &&
    value.kind === kind &&
    isPlainObject(value.body) &&
    validateBody(value.body)
  );
}

function isGameIndexEntryFor(value, game) {
  return (
    isPlainObject(value) &&
    matchesExpectedGame(value.game, game) &&
    nonEmptyString(value.pack) &&
    nonEmptyString(value.status) &&
    isNullableString(value.phase_id) &&
    isSafeInteger(value.updated_seq) &&
    isNullableSafeInteger(value.completed_seq)
  );
}

function isThreadPostFor(value, { game, channel }) {
  return (
    isPlainObject(value) &&
    matchesExpectedGame(value.game, game) &&
    isSafeInteger(value.source_seq) &&
    isSafeInteger(value.stream_seq) &&
    value.channel_id === channel &&
    isGameThreadAuthor(value.author) &&
    isNullableString(value.phase_id) &&
    typeof value.body === "string" &&
    Array.isArray(value.media) &&
    value.media.every(isThreadPostMedia) &&
    Array.isArray(value.quotations) &&
    value.quotations.every(isQuotation) &&
    (value.mentions === undefined ||
      (Array.isArray(value.mentions) && value.mentions.every(isThreadPostMention))) &&
    (value.embed == null || isPostEmbed(value.embed)) &&
    isSafeInteger(value.citation_count) &&
    isSafeInteger(value.occurred_at)
  );
}

function isThreadPostMention(mention) {
  return (
    isPlainObject(mention) &&
    nonEmptyString(mention.slot_id) &&
    Number.isSafeInteger(mention.offset) && mention.offset >= 0 &&
    Number.isSafeInteger(mention.len) && mention.len > 0
  );
}

function isThreadPostMedia(value) {
  return (
    isPlainObject(value) &&
    nonEmptyString(value.content_id) &&
    typeof value.alt === "string" &&
    isPlainObject(value.variants) &&
    Object.keys(value.variants).length > 0 &&
    Object.values(value.variants).every(
      (variant) =>
        isPlainObject(variant) &&
        nonEmptyString(variant.avif_url) &&
        nonEmptyString(variant.webp_url) &&
        isPositiveSafeInteger(variant.width) &&
        isPositiveSafeInteger(variant.height),
    )
  );
}

function isQuotation(value) {
  return (
    isPlainObject(value) &&
    isPostRef(value.target) &&
    typeof value.excerpt === "string"
  );
}

function isPostRef(value) {
  return (
    isPlainObject(value) &&
    (value.kind === "game_post" || value.kind === "discussion_post") &&
    nonEmptyString(value.scope_id) &&
    isSafeInteger(value.source_seq)
  );
}

function isPostEmbed(value) {
  return (
    isPlainObject(value) &&
    value.provider === "youtube" &&
    nonEmptyString(value.provider_id) &&
    (value.start_seconds === undefined || isNonnegativeSafeInteger(value.start_seconds)) &&
    (value.snapshot === undefined || isEmbedSnapshot(value.snapshot))
  );
}

function isEmbedSnapshot(value) {
  return (
    isPlainObject(value) &&
    nonEmptyString(value.title) &&
    (value.author === undefined || isNullableString(value.author)) &&
    (value.poster === undefined ||
      (isPlainObject(value.poster) && nonEmptyString(value.poster.content_id)))
  );
}

function isVoteCountFor(value, game) {
  return (
    isPlainObject(value) &&
    matchesExpectedGame(value.game, game) &&
    nonEmptyString(value.phase_id) &&
    nonEmptyString(value.candidate_slot) &&
    isNonnegativeSafeInteger(value.count)
  );
}

function isDayVoteOutcomeFor(value, game) {
  return (
    isPlainObject(value) &&
    matchesExpectedGame(value.game, game) &&
    nonEmptyString(value.phase_id) &&
    isSafeInteger(value.source_seq) &&
    isNonnegativeSafeInteger(value.event_index) &&
    nonEmptyString(value.status) &&
    isNullableString(value.winner_slot) &&
    isStringArray(value.contenders) &&
    isNonnegativeNumberRecord(value.tallies) &&
    isStringRecord(value.votes) &&
    isNonnegativeNumberRecord(value.weights) &&
    isNullableNonnegativeNumber(value.majority) &&
    isNonnegativeNumberRecord(value.thresholds) &&
    isNonnegativeNumber(value.total_weight) &&
    isNullableString(value.tiebreak) &&
    isNullableString(value.reason)
  );
}

function isNullableEndgameWinner(value) {
  return (
    value === null ||
    (isPlainObject(value) &&
      nonEmptyString(value.alignment) &&
      nonEmptyString(value.reason) &&
      nonEmptyString(value.phase_id))
  );
}

function isEndgameSlotReveal(value) {
  return (
    isPlainObject(value) &&
    nonEmptyString(value.slot_id) &&
    typeof value.alive === "boolean" &&
    nonEmptyString(value.status) &&
    isNullableString(value.role_key) &&
    isNullableString(value.alignment) &&
    typeof value.role_revealed === "boolean" &&
    typeof value.alignment_revealed === "boolean"
  );
}

function isEndgameDayVote(value) {
  return (
    isPlainObject(value) &&
    nonEmptyString(value.phase_id) &&
    isSafeInteger(value.source_seq) &&
    isNonnegativeSafeInteger(value.event_index) &&
    nonEmptyString(value.status) &&
    isNullableString(value.winner_slot) &&
    isNonnegativeNumberRecord(value.tallies) &&
    isStringRecord(value.votes) &&
    isNullableNonnegativeNumber(value.majority) &&
    isNullableString(value.reason)
  );
}

function isHostPromptFor(value, game) {
  return (
    isPlainObject(value) &&
    value.game === game &&
    nonEmptyString(value.phase_id) &&
    isNonnegativeSafeInteger(value.event_index) &&
    nonEmptyString(value.prompt_id) &&
    nonEmptyString(value.kind) &&
    isNullableString(value.subject_slot) &&
    nonEmptyString(value.reason) &&
    isHostPromptMetadata(value.metadata) &&
    nonEmptyString(value.status) &&
    isNullableHostPromptDecision(value.decision) &&
    isNullableHostPromptResolution(value.public_resolution) &&
    isNullableSafeInteger(value.resolved_at)
  );
}

function isHostPromptMetadata(value) {
  const allowed = new Set([
    "policy",
    "status",
    "contenders",
    "tiebreak",
    "outcome_reason",
    "death_cause",
    "role",
  ]);
  return (
    isPlainObject(value) &&
    Object.entries(value).every(([key, entry]) =>
      allowed.has(key)
        ? key === "contenders"
          ? isStringArray(entry)
          : isNullableString(entry)
        : false,
    )
  );
}

function isNullableHostPromptDecision(value) {
  if (value === null) return true;
  if (!isPlainObject(value)) return false;
  if (value.kind === "select_slot") return nonEmptyString(value.slot);
  if (value.kind === "select_policy") return nonEmptyString(value.policy);
  return value.kind === "acknowledge";
}

function isNullableHostPromptResolution(value) {
  if (value === null) return true;
  if (!isPlainObject(value)) return false;
  if (value.kind === "day_vote_elimination") {
    return (
      nonEmptyString(value.phase_id) &&
      nonEmptyString(value.selected_slot) &&
      nonEmptyString(value.reason)
    );
  }
  if (value.kind === "phase_advance") {
    return (
      nonEmptyString(value.source_phase_id) &&
      nonEmptyString(value.target_phase_id) &&
      nonEmptyString(value.reason) &&
      (value.skipped_phase_id === undefined || isNullableString(value.skipped_phase_id))
    );
  }
  return (
    value.kind === "acknowledged" &&
    nonEmptyString(value.phase_id) &&
    nonEmptyString(value.reason)
  );
}

/**
 * Player notifications are private projection rows. A structurally valid row
 * for another game or audience is not valid for this browser/session scope.
 */
export function validatePlayerNotificationRow(
  value,
  { game, actorSlot } = {},
) {
  return (
    isPlainObject(value) &&
    nonEmptyString(game) &&
    value.game === game &&
    nonEmptyString(actorSlot) &&
    value.audience_slot === actorSlot &&
    nonEmptyString(value.phase_id) &&
    Number.isInteger(value.event_index) &&
    nonEmptyString(value.effect) &&
    nonEmptyString(value.status)
  );
}

export function validatePlayerNotificationsResponse(
  value,
  { game, actorSlot } = {},
) {
  const expectations = { game, actorSlot };
  return (
    nonEmptyString(game) &&
    nonEmptyString(actorSlot) &&
    Array.isArray(value) &&
    value.every((row) => validatePlayerNotificationRow(row, expectations))
  );
}

/**
 * Investigation rows use the canonical wire union for `result`: either one
 * non-empty label or the closed typed field bag emitted by the API.
 */
export function validatePlayerInvestigationResultRow(
  value,
  { game, actorSlot } = {},
) {
  return (
    isPlainObject(value) &&
    nonEmptyString(game) &&
    value.game === game &&
    nonEmptyString(actorSlot) &&
    value.audience_slot === actorSlot &&
    nonEmptyString(value.phase_id) &&
    Number.isInteger(value.event_index) &&
    nonEmptyString(value.mode) &&
    nonEmptyString(value.target_slot) &&
    isInvestigationResultBody(value.result)
  );
}

export function validatePlayerInvestigationResultsResponse(
  value,
  { game, actorSlot } = {},
) {
  const expectations = { game, actorSlot };
  return (
    nonEmptyString(game) &&
    nonEmptyString(actorSlot) &&
    Array.isArray(value) &&
    value.every((row) =>
      validatePlayerInvestigationResultRow(row, expectations),
    )
  );
}

/**
 * A slot mention names a seat and the room it was addressed in, and nothing
 * about who occupies that seat (RFC 0007 §7). `phase_id` is nullable because
 * setup discussion is deliberately outside a phase.
 */
export function validateSlotMentionRow(value, { game, actorSlot } = {}) {
  return (
    isPlainObject(value) &&
    nonEmptyString(game) &&
    value.game === game &&
    nonEmptyString(actorSlot) &&
    value.audience_slot === actorSlot &&
    nonEmptyString(value.channel_id) &&
    Number.isInteger(value.source_seq) &&
    value.source_seq > 0 &&
    (value.phase_id === null || nonEmptyString(value.phase_id)) &&
    Number.isInteger(value.occurred_at)
  );
}

export function validateSlotMentionsResponse(value, { game, actorSlot } = {}) {
  const expectations = { game, actorSlot };
  return (
    nonEmptyString(game) &&
    nonEmptyString(actorSlot) &&
    Array.isArray(value) &&
    value.every((row) => validateSlotMentionRow(row, expectations))
  );
}

/**
 * Browser live wiring may validate the complete private delta before
 * extracting its rows. Repeating the game on the envelope and every row makes
 * cross-game/cross-audience delivery fail closed at either layer.
 */
export function validatePlayerPrivateLiveDelta(
  delta,
  { game, actorSlot } = {},
) {
  if (
    !isPlainObject(delta) ||
    !isPlainObject(delta.body) ||
    !nonEmptyString(game) ||
    !nonEmptyString(actorSlot)
  ) {
    return false;
  }
  const expectations = { game, actorSlot };
  if (delta.kind === "PlayerNotificationsChanged") {
    return (
      delta.body.game === game &&
      validatePlayerNotificationsResponse(
        delta.body.notifications,
        expectations,
      )
    );
  }
  if (delta.kind === "PlayerInvestigationResultsChanged") {
    return (
      delta.body.game === game &&
      validatePlayerInvestigationResultsResponse(
        delta.body.results,
        expectations,
      )
    );
  }
  if (delta.kind === "SlotMentionsChanged") {
    return (
      delta.body.game === game &&
      validateSlotMentionsResponse(delta.body.mentions, expectations)
    );
  }
  return false;
}

/**
 * Player-private command state is authority only for the game and actor slot
 * that requested it. Both SSR and browser resync share this exact validator.
 */
export function validatePlayerCommandStateResponse(
  value,
  { game, actorSlot } = {},
) {
  return (
    isPlainObject(value) &&
    nonEmptyString(game) &&
    value.game === game &&
    nonEmptyString(actorSlot) &&
    value.actor_slot === actorSlot &&
    typeof value.actor_alive === "boolean" &&
    typeof value.actor_status === "string" &&
    typeof value.game_completed === "boolean" &&
    isNullablePlayerCommandRole(value.role) &&
    isNullablePlayerCommandPhase(value.phase) &&
    Array.isArray(value.actions) && value.actions.every(isPlayerCommandAction) &&
    Array.isArray(value.current_actions) && value.current_actions.every(isPlayerCurrentAction) &&
    Array.isArray(value.vote_targets) && value.vote_targets.every(isPlayerVoteTarget) &&
    (value.current_vote === null || isPlayerVoteTarget(value.current_vote)) &&
    Array.isArray(value.day_events) && value.day_events.every(isPlayerDayEventAttention) &&
    Array.isArray(value.day_event_rooms) && value.day_event_rooms.every(isDayEventRoom) &&
    Array.isArray(value.post_policies) && value.post_policies.every(isPostPolicy) &&
    nonEmptyString(value.boundary)
  );
}

function isNullablePlayerCommandRole(value) {
  return (
    value === null ||
    (isPlainObject(value) &&
      nonEmptyString(value.key) &&
      isNullableString(value.alignment) &&
      typeof value.description === "string")
  );
}

function isNullablePlayerCommandPhase(value) {
  return (
    value === null ||
    (isPlainObject(value) &&
      nonEmptyString(value.phase_id) &&
      typeof value.locked === "boolean" &&
      isNullableSafeInteger(value.deadline))
  );
}

function isPlayerCommandAction(value) {
  return (
    isPlainObject(value) &&
    nonEmptyString(value.source) &&
    nonEmptyString(value.template_id) &&
    nonEmptyString(value.ability) &&
    nonEmptyString(value.window) &&
    nonEmptyString(value.label) &&
    typeof value.detail === "string" &&
    isStringArray(value.targets) &&
    isStringArray(value.target_options) &&
    isNullableString(value.grant_id)
  );
}

function isPlayerCurrentAction(value) {
  return (
    isPlainObject(value) &&
    nonEmptyString(value.action_id) &&
    nonEmptyString(value.template_id) &&
    isStringArray(value.targets) &&
    isNullableString(value.grant_id)
  );
}

function isPlayerVoteTarget(value) {
  return (
    isPlainObject(value) &&
    nonEmptyString(value.kind) &&
    isNullableString(value.slot_id) &&
    nonEmptyString(value.label)
  );
}

function isPlayerDayEventAttention(value) {
  return (
    isPlainObject(value) &&
    nonEmptyString(value.event_id) &&
    nonEmptyString(value.template_key) &&
    isNullableString(value.phase_id) &&
    nonEmptyString(value.participation_status) &&
    isNonnegativeSafeInteger(value.participant_count) &&
    isNonnegativeSafeInteger(value.minimum_participants) &&
    isNullableNonnegativeSafeInteger(value.maximum_participants) &&
    isStringArray(value.reward_keys) &&
    typeof value.can_submit === "boolean" &&
    typeof value.can_withdraw === "boolean"
  );
}

function isDayEventRoom(value) {
  return (
    isPlainObject(value) &&
    nonEmptyString(value.event_id) &&
    nonEmptyString(value.channel_id) &&
    nonEmptyString(value.template_key) &&
    nonEmptyString(value.state) &&
    (value.membership === "eligible_slots" || value.membership === "participants") &&
    isNonnegativeSafeInteger(value.member_count) &&
    typeof value.posting_allowed === "boolean"
  );
}

function isPostPolicy(value) {
  return (
    isPlainObject(value) &&
    nonEmptyString(value.channel_id) &&
    typeof value.allow_media_only === "boolean"
  );
}

export function validateHostConsoleAuthorityExpectation({
  expectedPrincipalId,
  expectedCapabilityKind,
} = {}) {
  return (
    isCanonicalPrincipalId(expectedPrincipalId) &&
    HOST_ROUTE_CAPABILITY_KINDS.has(expectedCapabilityKind)
  );
}

/**
 * Host console state is authority only when its complete projection schema,
 * game, principal, and route capability all match the requesting session.
 */
export function validateHostConsoleStateResponse(
  value,
  { game, expectedPrincipalId, expectedCapabilityKind } = {},
) {
  return (
    isPlainObject(value) &&
    nonEmptyString(game) &&
    value.game === game &&
    validateHostConsoleAuthorityExpectation({
      expectedPrincipalId,
      expectedCapabilityKind,
    }) &&
    isHostConsoleAuthority(
      value.authority,
      expectedPrincipalId,
      expectedCapabilityKind,
    ) &&
    typeof value.completed === "boolean" &&
    isHostConsolePhase(value.phase) &&
    isHostConsoleSlotArray(value.slots) &&
    isHostConsoleThreadPostArray(value.thread_posts) &&
    isDayEventScheduler(value.day_event_scheduler) &&
    isHostDayEventArray(value.day_events) &&
    isHostTaskArray(value.tasks)
  );
}

/**
 * Validates one canonical host-console live delta before it can mutate a
 * previously authorized browser snapshot. Cell deltas do not repeat session
 * authority, so they require a valid expected authority contract and an exact
 * game match; full/header deltas additionally prove the embedded authority.
 */
export function validateHostConsoleLiveDelta(
  delta,
  { game, expectedPrincipalId, expectedCapabilityKind } = {},
) {
  if (
    !isPlainObject(delta) ||
    !isPlainObject(delta.body) ||
    !nonEmptyString(game) ||
    !validateHostConsoleAuthorityExpectation({
      expectedPrincipalId,
      expectedCapabilityKind,
    })
  ) {
    return false;
  }

  const { body } = delta;
  switch (delta.kind) {
    case "HostConsoleStateChanged":
      return validateHostConsoleStateResponse(body, {
        game,
        expectedPrincipalId,
        expectedCapabilityKind,
      });
    case "HostConsoleHeaderChanged":
      return (
        body.game === game &&
        isHostConsoleAuthority(
          body.authority,
          expectedPrincipalId,
          expectedCapabilityKind,
        ) &&
        typeof body.completed === "boolean" &&
        isHostConsolePhase(body.phase)
      );
    case "HostConsoleSlotsChanged":
      return (
        body.game === game &&
        isHostConsoleSlotArray(body.slots) &&
        isStringArray(body.removed_slot_ids)
      );
    case "HostConsoleThreadPostsChanged":
      return (
        body.game === game &&
        isHostConsoleThreadPostArray(body.posts)
      );
    case "HostConsoleThreadPostRemoved":
      return body.game === game && Number.isInteger(body.stream_seq);
    case "HostConsoleDayEventsChanged":
      return (
        body.game === game &&
        isHostDayEventArray(body.day_events) &&
        isStringArray(body.removed_event_ids)
      );
    case "HostConsoleSchedulerChanged":
      return (
        body.game === game &&
        isDayEventScheduler(body.day_event_scheduler)
      );
    case "HostConsoleTasksChanged":
      return body.game === game && isHostTaskArray(body.tasks);
    default:
      return false;
  }
}

function isHostConsoleAuthority(
  value,
  expectedPrincipalId,
  expectedCapabilityKind,
) {
  return (
    isPlainObject(value) &&
    isCanonicalPrincipalId(value.principal_id) &&
    value.principal_id === expectedPrincipalId &&
    HOST_ROUTE_CAPABILITY_KINDS.has(value.capability) &&
    value.capability === expectedCapabilityKind &&
    isUniqueEnumArray(value.allowed_classes, COHOST_PERMISSION_CLASSES) &&
    isUniqueEnumArray(value.denied_classes, COHOST_PERMISSION_CLASSES) &&
    value.allowed_classes.every(
      (permissionClass) => !value.denied_classes.includes(permissionClass),
    )
  );
}

function isHostConsolePhase(value) {
  return (
    value === null ||
    (isPlainObject(value) &&
      nonEmptyString(value.phase_id) &&
      typeof value.locked === "boolean" &&
      isNullableInteger(value.deadline))
  );
}

function isHostConsoleSlotArray(value) {
  return Array.isArray(value) && value.every(isHostConsoleSlot);
}

function isHostConsoleSlot(value) {
  return (
    isPlainObject(value) &&
    nonEmptyString(value.slot_id) &&
    nonEmptyString(value.occupancy_id) &&
    nonEmptyString(value.persona_id) &&
    nonEmptyString(value.public_name) &&
    isCanonicalPrincipalId(value.assigned_principal_id) &&
    typeof value.alive === "boolean" &&
    nonEmptyString(value.status) &&
    isStringArray(value.status_tags) &&
    isNullableString(value.role_key) &&
    isNullableString(value.alignment) &&
    typeof value.role_revealed === "boolean" &&
    typeof value.alignment_revealed === "boolean"
  );
}

function isHostConsoleThreadPostArray(value) {
  return Array.isArray(value) && value.every(isHostConsoleThreadPost);
}

function isHostConsoleThreadPost(value) {
  return (
    isPlainObject(value) &&
    Number.isInteger(value.stream_seq) &&
    isGameThreadAuthor(value.author) &&
    isNullableString(value.phase_id) &&
    typeof value.body === "string" &&
    validateGameplayObjectRowArray(value.quotations)
  );
}

function isGameThreadAuthor(value) {
  if (!isPlainObject(value)) return false;
  if (value.kind === "slot") return nonEmptyString(value.slot_id);
  return value.kind === "host_narrator" || value.kind === "system";
}

function isDayEventScheduler(value) {
  return (
    value === null ||
    (isPlainObject(value) &&
      typeof value.pending === "boolean" &&
      isNullableInteger(value.next_due_at) &&
      typeof value.auto_resolve_pending === "boolean" &&
      typeof value.narrative_pending === "boolean" &&
      Number.isInteger(value.wake_seq) &&
      Number.isInteger(value.last_observed_wake_seq) &&
      isNullableInteger(value.lease_until) &&
      isNullableInteger(value.retry_not_before) &&
      isNullableInteger(value.last_attempt_at) &&
      isNullableInteger(value.last_success_at) &&
      isNullableInteger(value.last_failure_at) &&
      Number.isInteger(value.consecutive_failures) &&
      Number.isInteger(value.total_attempts) &&
      Number.isInteger(value.total_successes) &&
      isNullableString(value.last_error))
  );
}

function isHostDayEventArray(value) {
  return Array.isArray(value) && value.every(isHostDayEvent);
}

function isHostDayEvent(value) {
  return (
    isPlainObject(value) &&
    nonEmptyString(value.event_id) &&
    nonEmptyString(value.state) &&
    isNullableString(value.phase_id) &&
    isPlainObject(value.definition) &&
    (value.room === null || isPlainObject(value.room)) &&
    isStringArray(value.participant_slots) &&
    isNullableInteger(value.open_due_at) &&
    isNullableInteger(value.open_observed_at) &&
    isNullableInteger(value.lock_due_at) &&
    isNullableInteger(value.lock_observed_at) &&
    isNullableDayEventAuditSeed(value.auto_seed) &&
    isNullableDayEventResolutionEvidence(value.resolution_evidence) &&
    (value.resolution_evidence?.kind !== "auto" ||
      value.auto_seed === value.resolution_evidence.seed) &&
    (value.resolution_evidence?.kind !== "host_decision" ||
      value.auto_seed === null) &&
    isStringArray(value.winner_slots) &&
    isStringArray(value.reward_keys_applied) &&
    validateGameplayObjectRowArray(value.narratives)
  );
}

function isNullableDayEventResolutionEvidence(value) {
  if (value === null) return true;
  if (!isPlainObject(value)) return false;
  if (value.kind === "host_decision") {
    return hasExactKeys(value, ["kind", "participant_slots"]) &&
      isStringArray(value.participant_slots);
  }
  if (value.kind !== "auto" ||
      !hasExactKeys(value, ["kind", "policy", "seed", "participant_slots"]) ||
      !isPlainObject(value.policy) ||
      !hasExactKeys(value.policy, ["kind", "winners"]) ||
      !isPositiveSafeInteger(value.policy.winners) ||
      !isStringArray(value.participant_slots)) {
    return false;
  }
  if (value.policy.kind === "first_n") return value.seed === null;
  return value.policy.kind === "seeded_random" &&
    isCanonicalDayEventAuditSeed(value.seed);
}

function isNullableDayEventAuditSeed(value) {
  return value === null || isCanonicalDayEventAuditSeed(value);
}

function isCanonicalDayEventAuditSeed(value) {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(value)) {
    return false;
  }
  return value.length < MAX_U64_DECIMAL.length ||
    (value.length === MAX_U64_DECIMAL.length && value <= MAX_U64_DECIMAL);
}

function hasExactKeys(value, expectedKeys) {
  const actualKeys = Object.keys(value).sort();
  const canonicalExpectedKeys = [...expectedKeys].sort();
  return actualKeys.length === canonicalExpectedKeys.length &&
    actualKeys.every((key, index) => key === canonicalExpectedKeys[index]);
}

function isHostTaskArray(value) {
  return Array.isArray(value) && value.every(isHostTask);
}

function isHostTask(value) {
  return (
    isPlainObject(value) &&
    nonEmptyString(value.id) &&
    HOST_TASK_KINDS.has(value.kind) &&
    (value.state === "ready" || value.state === "blocked") &&
    value.urgency === "attention" &&
    typeof value.intent === "string" &&
    typeof value.consequence === "string" &&
    (value.phase_id === undefined || nonEmptyString(value.phase_id)) &&
    isNullableString(value.subject_slot) &&
    nonEmptyString(value.source_id) &&
    Array.isArray(value.allowed_commands) &&
    value.allowed_commands.every(isHostTaskAllowedCommand) &&
    isNullableString(value.blocked_reason)
  );
}

function isHostTaskAllowedCommand(value) {
  return (
    isPlainObject(value) &&
    HOST_TASK_COMMAND_KINDS.has(value.kind) &&
    COHOST_PERMISSION_CLASSES.has(value.permission_class)
  );
}

function isUniqueEnumArray(value, allowed) {
  return (
    Array.isArray(value) &&
    value.every((entry) => allowed.has(entry)) &&
    new Set(value).size === value.length
  );
}

function isInvestigationResultBody(value) {
  if (nonEmptyString(value)) return true;
  if (!isPlainObject(value)) return false;
  return Object.entries(value).every(([field, fieldValue]) => {
    if (!INVESTIGATION_RESULT_FIELDS.has(field)) return false;
    if (INVESTIGATION_RESULT_BOOLEAN_FIELDS.has(field)) {
      return typeof fieldValue === "boolean";
    }
    if (INVESTIGATION_RESULT_STRING_FIELDS.has(field)) {
      return nonEmptyString(fieldValue);
    }
    return isStringArray(fieldValue);
  });
}

function isStringArray(value) {
  return Array.isArray(value) && value.every(nonEmptyString);
}

function isStringRecord(value) {
  return (
    isPlainObject(value) &&
    Object.entries(value).every(
      ([key, entry]) => nonEmptyString(key) && nonEmptyString(entry),
    )
  );
}

function isNonnegativeNumberRecord(value) {
  return (
    isPlainObject(value) &&
    Object.entries(value).every(
      ([key, entry]) => nonEmptyString(key) && isNonnegativeNumber(entry),
    )
  );
}

function isNonnegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNullableNonnegativeNumber(value) {
  return value === null || isNonnegativeNumber(value);
}

function isSafeInteger(value) {
  return Number.isSafeInteger(value);
}

function isNonnegativeSafeInteger(value) {
  return isSafeInteger(value) && value >= 0;
}

function isPositiveSafeInteger(value) {
  return isSafeInteger(value) && value > 0;
}

function isNullableSafeInteger(value) {
  return value === null || isSafeInteger(value);
}

function isNullableNonnegativeSafeInteger(value) {
  return value === null || isNonnegativeSafeInteger(value);
}

function isNullableString(value) {
  return value === null || nonEmptyString(value);
}

function isNullableInteger(value) {
  return value === null || Number.isInteger(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function matchesExpectedGame(value, expected) {
  return nonEmptyString(value) &&
    (!nonEmptyString(expected) || value === expected);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
