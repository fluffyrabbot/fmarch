export async function loadPlayerColdData({
  game,
  activeChannel = "main",
  principalUserId,
  actorSlot = null,
  fetchImpl,
  apiBaseUrl = "",
  fallback,
}) {
  const canLoadPrivate =
    typeof principalUserId === "string" && principalUserId.trim() !== "";
  const canLoadCommandState =
    canLoadPrivate && typeof actorSlot === "string" && actorSlot.trim() !== "";
  const [
    thread,
    votecount,
    dayVoteOutcomes,
    notifications,
    investigationResults,
    commandState,
  ] = await Promise.all([
    fetchJson({
      fetchImpl,
      fallback: fallback.thread,
      url: playerThreadUrl({
        apiBaseUrl,
        game,
        channel: activeChannel,
        principalUserId,
        limit: 50,
      }),
    }),
    fetchJson({
      fetchImpl,
      fallback: fallback.votecount,
      url: playerVotecountUrl({ apiBaseUrl, game }),
    }),
    fetchJson({
      fetchImpl,
      fallback: fallback.dayVoteOutcomes ?? [],
      url: dayVoteOutcomesUrl({ apiBaseUrl, game }),
    }),
    canLoadPrivate
      ? fetchJson({
          fetchImpl,
          fallback: fallback.notifications ?? [],
          url: principalScopedGameUrl({
            apiBaseUrl,
            game,
            path: "notifications",
            principalUserId,
          }),
        })
      : [],
    canLoadPrivate
      ? fetchJson({
          fetchImpl,
          fallback: fallback.investigationResults ?? [],
          url: principalScopedGameUrl({
            apiBaseUrl,
            game,
            path: "investigation-results",
            principalUserId,
          }),
        })
      : [],
    canLoadCommandState
      ? fetchJson({
          fetchImpl,
          fallback: fallback.commandState ?? EMPTY_PLAYER_COMMAND_STATE,
          url: playerCommandStateUrl({
            apiBaseUrl,
            game,
            principalUserId,
            slotId: actorSlot,
          }),
        })
      : fallback.commandState ?? EMPTY_PLAYER_COMMAND_STATE,
  ]);

  return Object.freeze({
    thread: normalizeThreadPage(thread, fallback.thread),
    votecount: normalizeVotecount(votecount, fallback.votecount),
    dayVoteOutcomes: normalizeDayVoteOutcomes(
      dayVoteOutcomes,
      fallback.dayVoteOutcomes ?? [],
    ),
    notifications: Object.freeze(
      Array.isArray(notifications) ? notifications : [],
    ),
    investigationResults: Object.freeze(
      Array.isArray(investigationResults) ? investigationResults : [],
    ),
    commandState: normalizePlayerCommandState(
      commandState,
      fallback.commandState ?? EMPTY_PLAYER_COMMAND_STATE,
    ),
  });
}

export async function loadAdminColdData({
  game,
  principalUserId,
  fetchImpl,
  apiBaseUrl = "",
  sessionToken = null,
  identityPrincipalUserId = "host_h",
  fallback,
}) {
  const [proofStatus, identityLifecycleAudit] = await Promise.all([
    fetchJson({
      fetchImpl,
      fallback: null,
      url: principalScopedGameUrl({
        apiBaseUrl,
        game,
        path: "operator/proof-runs/status",
        principalUserId,
      }),
    }),
    sessionToken === null || sessionToken === undefined || sessionToken.trim() === ""
      ? null
      : fetchJson({
          fetchImpl,
          fallback: null,
          url: identityLifecycleAuditUrl({
            apiBaseUrl,
            principalUserId: identityPrincipalUserId,
          }),
          headers: {
            authorization: `Bearer ${sessionToken}`,
          },
        }),
  ]);
  const audit = normalizeAdminAudit(proofStatus, fallback.audit, {
    game,
    principalUserId,
  });

  return Object.freeze({
    audit: appendIdentityLifecycleAudit(audit, identityLifecycleAudit, {
      game,
      identityPrincipalUserId,
    }),
  });
}

export async function loadHostColdData({
  game,
  principalUserId,
  fetchImpl,
  apiBaseUrl = "",
  fallback,
}) {
  const [hostPrompts, votecount, dayVoteOutcomes] = await Promise.all([
    fetchJson({
      fetchImpl,
      fallback: fallback.hostPrompts,
      url: hostPromptsUrl({
        apiBaseUrl,
        game,
        principalUserId,
      }),
    }),
    fetchJson({
      fetchImpl,
      fallback: fallback.votecount,
      url: hostVotecountUrl({ apiBaseUrl, game }),
    }),
    fetchJson({
      fetchImpl,
      fallback: fallback.dayVoteOutcomes ?? [],
      url: dayVoteOutcomesUrl({ apiBaseUrl, game }),
    }),
  ]);

  return Object.freeze({
    hostPrompts: normalizeHostPrompts(hostPrompts, fallback.hostPrompts),
    votecount: normalizeVotecount(votecount, fallback.votecount),
    dayVoteOutcomes: normalizeDayVoteOutcomes(
      dayVoteOutcomes,
      fallback.dayVoteOutcomes ?? [],
    ),
  });
}

export async function fetchJson({ fetchImpl, url, fallback, headers = null }) {
  return await fetchJsonWithInit({ fetchImpl, url, fallback, headers });
}

export async function fetchJsonWithInit({ fetchImpl, url, fallback, headers = null }) {
  if (typeof fetchImpl !== "function") {
    return fallback;
  }

  try {
    const response = await fetchImpl(url, {
      headers: {
        accept: "application/json",
        ...(headers ?? {}),
      },
    });
    if (!response?.ok) {
      return fallback;
    }
    return await response.json();
  } catch {
    return fallback;
  }
}

export function normalizeHostPrompts(rows, fallback) {
  if (!Array.isArray(rows)) {
    return fallback;
  }

  return Object.freeze(
    rows.map((row, index) =>
      Object.freeze({
        id: String(
          row.prompt_id ?? row.promptId ?? row.id ?? `prompt-${index + 1}`,
        ),
        label: String(row.kind ?? row.label ?? "Host prompt"),
        value: String(row.reason ?? row.value ?? "Awaiting host decision"),
        status: String(row.status ?? "pending"),
        phaseId: String(row.phase_id ?? row.phaseId ?? ""),
        subjectSlot: row.subject_slot ?? row.subjectSlot ?? null,
        decisionKind: decisionKindForPrompt(row),
      }),
    ),
  );
}

export function normalizeThreadPage(page, fallback) {
  if (page === null || typeof page !== "object" || !Array.isArray(page.posts)) {
    return fallback;
  }

  return Object.freeze({
    nextBeforeSeq: page.next_before_seq ?? page.nextBeforeSeq ?? null,
    posts: Object.freeze(page.posts.map((post) => normalizeThreadPost(post))),
  });
}

export function normalizeThreadPost(post, { fallbackMeta = "cold load" } = {}) {
  const media = normalizeThreadPostMedia(post?.media ?? post?.attachments ?? post?.images);
  return Object.freeze({
    seq: post?.source_seq ?? post?.sourceSeq ?? post?.seq ?? null,
    streamSeq: post?.stream_seq ?? post?.streamSeq ?? null,
    authorSlot: post?.author_slot ?? post?.authorSlot ?? null,
    authorLabel:
      post?.author_user ??
      post?.authorUser ??
      post?.authorLabel ??
      post?.author_slot ??
      post?.authorSlot ??
      "Unknown",
    body: typeof post?.body === "string" ? post.body : "",
    meta:
      post?.meta ??
      formatOccurredAt(post?.occurred_at ?? post?.occurredAt, {
        fallback: fallbackMeta,
      }),
    ...(media.length === 0 ? {} : { media }),
  });
}

export function normalizeThreadPostMedia(value) {
  if (!Array.isArray(value)) {
    return Object.freeze([]);
  }
  return Object.freeze(
    value
      .map((item, index) => normalizeThreadMediaItem(item, index))
      .filter(Boolean),
  );
}

function normalizeThreadMediaItem(item, index) {
  if (item === null || typeof item !== "object") {
    return null;
  }
  const variants = normalizeThreadMediaVariants(item.variants ?? item.sources ?? {});
  if (Object.keys(variants).length === 0) {
    return null;
  }
  return Object.freeze({
    id: String(item.id ?? item.media_id ?? item.mediaId ?? `media-${index + 1}`),
    kind: String(item.kind ?? item.type ?? "image"),
    alt: String(item.alt ?? item.alt_text ?? item.altText ?? "Thread image"),
    variants,
  });
}

function normalizeThreadMediaVariants(value) {
  if (Array.isArray(value)) {
    return Object.freeze(
      Object.fromEntries(
        value
          .map((variant) => [
            variant?.name ?? variant?.variant ?? variant?.id,
            normalizeThreadMediaVariant(variant),
          ])
          .filter(([name, variant]) => typeof name === "string" && variant !== null),
      ),
    );
  }
  if (value === null || typeof value !== "object") {
    return Object.freeze({});
  }
  return Object.freeze(
    Object.fromEntries(
      Object.entries(value)
        .map(([name, variant]) => [name, normalizeThreadMediaVariant(variant)])
        .filter(([, variant]) => variant !== null),
    ),
  );
}

function normalizeThreadMediaVariant(variant) {
  if (typeof variant === "string") {
    return Object.freeze({ url: variant, width: null, height: null });
  }
  if (variant === null || typeof variant !== "object") {
    return null;
  }
  const url = variant.url ?? variant.href ?? variant.src;
  if (typeof url !== "string" || url.trim() === "") {
    return null;
  }
  return Object.freeze({
    url,
    width: normalizePositiveNumber(variant.width ?? variant.w),
    height: normalizePositiveNumber(variant.height ?? variant.h),
  });
}

function normalizePositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function normalizeVotecount(deltas, fallback) {
  if (!Array.isArray(deltas)) {
    return fallback;
  }

  const rows = deltas
    .map((delta) => {
      if (delta?.kind === "VoteCountChanged") {
        return delta.body;
      }
      return delta?.VoteCountChanged ?? delta?.body?.VoteCountChanged ?? null;
    })
    .filter(Boolean)
    .map((delta) =>
      Object.freeze({
        target: delta.candidate_slot ?? delta.candidateSlot ?? "unknown",
        count: Number(delta.count ?? 0),
        needed: Number(delta.majority ?? 7),
      }),
    );

  if (rows.length === 0 && deltas.length > 0) {
    const normalizedRows = deltas
      .filter((delta) => typeof delta?.target === "string")
      .map((delta) =>
        Object.freeze({
          target: delta.target,
          count: Number(delta.count ?? 0),
          needed: Number(delta.needed ?? 7),
        }),
      );
    if (normalizedRows.length > 0) {
      return Object.freeze(normalizedRows);
    }
  }

  return Object.freeze(rows);
}

export function normalizeDayVoteOutcomes(payload, fallback = []) {
  const rows = normalizeDayVoteOutcomePayload(payload);
  if (rows.length === 0) {
    return Array.isArray(payload) ? Object.freeze([]) : fallback;
  }
  if (Array.isArray(payload)) {
    return sortDayVoteOutcomeRows(rows);
  }
  const existing = Array.isArray(fallback) ? fallback : [];
  const merged = new Map();
  for (const row of [...existing, ...rows]) {
    merged.set(dayVoteOutcomeKey(row), row);
  }
  return sortDayVoteOutcomeRows([...merged.values()]);
}

function normalizeDayVoteOutcomePayload(payload) {
  const items = Array.isArray(payload) ? payload : [payload];
  return items
    .flatMap((item) => {
      if (Array.isArray(item)) {
        return normalizeDayVoteOutcomePayload(item);
      }
      const body =
        item?.kind === "DayVoteOutcomeApplied"
          ? item.body
          : item?.DayVoteOutcomeApplied ??
            item?.body?.DayVoteOutcomeApplied ??
            item?.body ??
            item;
      const normalized = normalizeDayVoteOutcomeRow(body);
      return normalized === null ? [] : [normalized];
    });
}

function normalizeDayVoteOutcomeRow(row) {
  if (row === null || typeof row !== "object") {
    return null;
  }
  const phaseId = row.phase_id ?? row.phaseId;
  const status = row.status;
  if (typeof phaseId !== "string" || phaseId.trim() === "" || typeof status !== "string") {
    return null;
  }
  return Object.freeze({
    game: row.game ?? null,
    phaseId,
    sourceSeq: Number(row.source_seq ?? row.sourceSeq ?? 0),
    eventIndex: Number(row.event_index ?? row.eventIndex ?? 0),
    status,
    winnerSlot: row.winner_slot ?? row.winnerSlot ?? null,
    tallies: normalizeNumericRecord(row.tallies),
    majority: normalizeNullableNumber(row.majority),
    reason: typeof row.reason === "string" && row.reason.trim() !== "" ? row.reason : null,
  });
}

function dayVoteOutcomeKey(row) {
  return `${row.phaseId}:${row.sourceSeq}:${row.eventIndex}`;
}

function sortDayVoteOutcomeRows(rows) {
  return Object.freeze(
    [...rows].sort((left, right) => {
      const sourceSeqDelta = Number(left.sourceSeq ?? 0) - Number(right.sourceSeq ?? 0);
      if (sourceSeqDelta !== 0) {
        return sourceSeqDelta;
      }
      return Number(left.eventIndex ?? 0) - Number(right.eventIndex ?? 0);
    }),
  );
}

function normalizeNumericRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return Object.freeze({});
  }
  return Object.freeze(
    Object.fromEntries(
      Object.entries(value)
        .map(([key, count]) => [key, Number(count)])
        .filter(([, count]) => Number.isFinite(count)),
    ),
  );
}

function normalizeNullableNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export const EMPTY_PLAYER_COMMAND_STATE = Object.freeze({
  game: null,
  actorSlot: null,
  actorAlive: null,
  actorStatus: null,
  roleKey: null,
  gameCompleted: false,
  phase: null,
  actions: Object.freeze([]),
  voteTargets: Object.freeze([]),
  currentVote: null,
  boundary:
    "No live player command-state endpoint was available; the route renders no role action controls.",
});

export function normalizePlayerCommandState(payload, fallback = EMPTY_PLAYER_COMMAND_STATE) {
  if (payload === null || typeof payload !== "object") {
    return fallback;
  }
  const actions = Array.isArray(payload.actions) ? payload.actions : [];
  const voteTargets = Array.isArray(payload.vote_targets)
    ? payload.vote_targets
    : Array.isArray(payload.voteTargets)
      ? payload.voteTargets
      : [];
  return Object.freeze({
    game: payload.game ?? fallback.game ?? null,
    actorSlot: payload.actor_slot ?? payload.actorSlot ?? fallback.actorSlot ?? null,
    actorAlive:
      typeof payload.actor_alive === "boolean"
        ? payload.actor_alive
        : typeof payload.actorAlive === "boolean"
          ? payload.actorAlive
          : fallback.actorAlive ?? null,
    actorStatus: String(
      payload.actor_status ?? payload.actorStatus ?? fallback.actorStatus ?? "",
    ),
    roleKey: payload.role_key ?? payload.roleKey ?? fallback.roleKey ?? null,
    gameCompleted:
      typeof payload.game_completed === "boolean"
        ? payload.game_completed
        : typeof payload.gameCompleted === "boolean"
          ? payload.gameCompleted
          : fallback.gameCompleted === true,
    phase: normalizePlayerCommandPhase(payload.phase ?? null),
    actions: Object.freeze(actions.map(normalizePlayerCommandAction).filter(Boolean)),
    voteTargets: Object.freeze(
      voteTargets.map(normalizePlayerVoteTarget).filter(Boolean),
    ),
    currentVote: normalizePlayerVoteTarget(
      payload.current_vote ?? payload.currentVote ?? null,
    ),
    boundary: String(payload.boundary ?? fallback.boundary ?? ""),
  });
}

function normalizePlayerCommandPhase(phase) {
  if (phase === null || typeof phase !== "object") {
    return null;
  }
  return Object.freeze({
    phaseId: String(phase.phase_id ?? phase.phaseId ?? ""),
    phaseKind: String(phase.phase_kind ?? phase.phaseKind ?? "Unknown"),
    phaseNumber: Number(phase.phase_number ?? phase.phaseNumber ?? 0),
    locked: phase.locked === true,
    deadline: phase.deadline ?? null,
  });
}

function normalizePlayerCommandAction(action) {
  if (action === null || typeof action !== "object") {
    return null;
  }
  const templateId = action.template_id ?? action.templateId;
  if (typeof templateId !== "string" || templateId.trim() === "") {
    return null;
  }
  const targets = normalizeStringArray(action.targets);
  return Object.freeze({
    source: String(action.source ?? "role"),
    action: String(action.action ?? `submit_action:${templateId}`),
    commandKind: String(action.command_kind ?? action.commandKind ?? "submit_action"),
    label: String(action.label ?? `Submit ${templateId.replaceAll("_", " ")}`),
    detail: String(
      action.detail ?? (targets.length === 0 ? templateId : `${templateId} -> ${targets.join(", ")}`),
    ),
    actionId: String(action.action_id ?? action.actionId ?? `role_${templateId}`),
    templateId,
    targets,
    targetOptions: normalizeStringArray(action.target_options ?? action.targetOptions),
    grantId: action.grant_id ?? action.grantId ?? null,
    ability: String(action.ability ?? ""),
    window: String(action.window ?? ""),
  });
}

function normalizePlayerVoteTarget(target) {
  if (target === null || typeof target !== "object") {
    return null;
  }
  const kind = String(target.kind ?? "").trim();
  if (kind === "slot") {
    const slotId = String(target.slot_id ?? target.slotId ?? "").trim();
    if (slotId === "") {
      return null;
    }
    return Object.freeze({
      kind,
      slotId,
      label: String(target.label ?? slotId),
    });
  }
  if (kind === "no_lynch") {
    return Object.freeze({
      kind,
      slotId: null,
      label: String(target.label ?? "No lynch"),
    });
  }
  return null;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return Object.freeze([]);
  }
  return Object.freeze(value.map((item) => String(item)));
}

export function normalizeAdminAudit(proofStatus, fallback, context = {}) {
  if (proofStatus === null || typeof proofStatus !== "object") {
    return fallback;
  }

  const rows = Array.isArray(proofStatus.rows)
    ? proofStatus.rows
    : Array.isArray(proofStatus.proof_runs)
      ? proofStatus.proof_runs
      : Array.isArray(proofStatus.required)
        ? proofStatus.required
        : operatorStatusRows(proofStatus);
  if (rows.length === 0) {
    return fallback;
  }

  return Object.freeze(
    rows.slice(0, 4).map((row, index) =>
      Object.freeze({
        id: String(row.id ?? row.name ?? row.proof_id ?? `proof-${index + 1}`),
        label: String(row.label ?? row.name ?? row.id ?? `Proof ${index + 1}`),
        status: String(row.status ?? row.state ?? row.summary ?? "Available"),
        authority: String(row.authority ?? "GlobalAdmin or GlobalMod"),
        boundary: String(row.boundary ?? "Read-only operator proof"),
        boundaryDetail: String(
          row.boundaryDetail ??
            row.boundary_detail ??
            "/operator/proof-runs machine-readable report",
        ),
        href:
          typeof row.href === "string" && row.href.trim() !== ""
            ? row.href
            : operatorProofRunUrl({
                game: context.game,
                principalUserId: context.principalUserId,
              }),
      }),
    ),
  );
}

export function appendIdentityLifecycleAudit(audit, identityLifecycleAudit, context = {}) {
  const identityRow = normalizeIdentityLifecycleAudit(identityLifecycleAudit, context);
  if (identityRow === null) {
    return audit;
  }
  const withoutExisting = audit.filter((item) => item.id !== identityRow.id);
  return Object.freeze([...withoutExisting, identityRow]);
}

export function normalizeIdentityLifecycleAudit(payload, context = {}) {
  if (payload === null || typeof payload !== "object" || !Array.isArray(payload.entries)) {
    return null;
  }
  const entries = payload.entries
    .map(normalizeIdentityLifecycleEntry)
    .filter(Boolean);
  if (entries.length === 0) {
    return null;
  }
  const eventKinds = [...new Set(entries.map((entry) => entry.eventKind))].sort();
  const requiredEvents = [
    "account_created",
    "account_disabled",
    "account_enabled",
    "account_session_created",
    "invite_revoked",
    "session_revoked",
    "session_rotated",
  ];
  const complete = requiredEvents.every((eventKind) => eventKinds.includes(eventKind));
  const principalUserId = String(context.identityPrincipalUserId ?? entries[0].principalUserId);

  return Object.freeze({
    id: "identity-lifecycle",
    label: "Identity lifecycle",
    status: complete
      ? `${eventKinds.length} lifecycle audit events available`
      : "Lifecycle audit is missing required events",
    authority: "GlobalAdmin",
    boundary: "Local identity lifecycle audit",
    boundaryDetail:
      "/auth/identity-lifecycle-audit records account, session, and invite lifecycle events without raw credential echoes",
    href: adminIdentityLifecycleAuditHref({
      game: context.game,
      principalUserId,
    }),
    inspectHref: adminIdentityLifecycleAuditHref({
      game: context.game,
      principalUserId,
    }),
    entries: Object.freeze(entries),
    eventKinds: Object.freeze(eventKinds),
    principalUserId,
    accountControls: identityLifecycleAccountControls({
      entries,
      principalUserId,
    }),
    rawTokensStored: false,
  });
}

function identityLifecycleAccountControls({ entries, principalUserId }) {
  const accountEntry = entries.find(
    (entry) =>
      typeof entry.metadata?.account_id === "string" &&
      entry.metadata.account_id.trim() !== "",
  );
  if (accountEntry === undefined) {
    return null;
  }
  const accountId = accountEntry.metadata.account_id.trim();
  const latestLifecycleEntry = entries.find(
    (entry) =>
      entry.metadata?.account_id === accountId &&
      ["account_disabled", "account_enabled", "account_created"].includes(
        entry.eventKind,
      ),
  );
  const currentDisabled = latestLifecycleEntry?.eventKind === "account_disabled";
  return Object.freeze({
    accountId,
    principalUserId,
    currentDisabled,
    disableAction: "?/disableAccount",
    enableAction: "?/enableAccount",
    revokeSessions: true,
  });
}

function normalizeIdentityLifecycleEntry(entry) {
  if (entry === null || typeof entry !== "object") {
    return null;
  }
  const eventKind = firstNonEmptyString(entry.event_kind, entry.eventKind);
  const principalUserId = firstNonEmptyString(
    entry.principal_user_id,
    entry.principalUserId,
  );
  if (eventKind === null || principalUserId === null) {
    return null;
  }
  return Object.freeze({
    id: Number(entry.id ?? 0),
    eventAt: Number(entry.event_at ?? entry.eventAt ?? 0),
    eventKind,
    actorUserId: firstNonEmptyString(entry.actor_user_id, entry.actorUserId),
    principalUserId,
    metadata: entry.metadata ?? {},
  });
}

function operatorStatusRows(proofStatus) {
  if (!Array.isArray(proofStatus.families)) {
    return [];
  }
  return proofStatus.families.flatMap((family) => {
    if (!Array.isArray(family?.runs)) {
      return [];
    }
    return family.runs.map((run) => ({
      id: run.id ?? run.row_id,
      label: run.id ?? run.row_id,
      status: run.artifact?.state ?? run.scope ?? family.heading,
    }));
  });
}

export function identityLifecycleAuditUrl({
  apiBaseUrl = "",
  principalUserId,
  limit = 10,
}) {
  if (typeof principalUserId !== "string" || principalUserId.trim() === "") {
    throw new TypeError("principalUserId is required for identity lifecycle audit URLs");
  }
  const params = new URLSearchParams({
    principal_user_id: principalUserId,
    limit: String(limit),
  });
  return `${apiBaseUrl}/auth/identity-lifecycle-audit?${params.toString()}`;
}

export function adminIdentityLifecycleAuditHref({ game, principalUserId }) {
  const params = new URLSearchParams({
    game,
    principal_user_id: principalUserId,
  });
  return `/admin/audit/identity-lifecycle?${params.toString()}`;
}

export function operatorProofRunUrl({
  apiBaseUrl = "",
  game,
  principalUserId,
  path = "operator/proof-runs",
}) {
  return principalScopedGameUrl({
    apiBaseUrl,
    game,
    principalUserId,
    path,
  });
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") {
      return value;
    }
  }
  return null;
}

export function playerThreadUrl({
  apiBaseUrl = "",
  game,
  channel = "main",
  principalUserId = null,
  limit = 50,
  beforeSeq = null,
}) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (beforeSeq !== null && beforeSeq !== undefined) {
    params.set("before_seq", String(beforeSeq));
  }
  if (channel !== "main") {
    if (typeof principalUserId === "string" && principalUserId.trim() !== "") {
      params.set("principal_user_id", principalUserId);
    }
    return `${apiBaseUrl}/games/${encodeURIComponent(game)}/channels/${encodeURIComponent(channel)}/thread?${params.toString()}`;
  }
  return `${apiBaseUrl}/games/${encodeURIComponent(game)}/thread?${params.toString()}`;
}

export function playerVotecountUrl({ apiBaseUrl = "", game }) {
  return `${apiBaseUrl}/games/${encodeURIComponent(game)}/votecount`;
}

export function dayVoteOutcomesUrl({ apiBaseUrl = "", game }) {
  return `${apiBaseUrl}/games/${encodeURIComponent(game)}/day-vote-outcomes`;
}

export function playerCommandStateUrl({
  apiBaseUrl = "",
  game,
  principalUserId,
  slotId,
}) {
  const params = new URLSearchParams({
    principal_user_id: principalUserId,
    slot_id: slotId,
  });
  return `${apiBaseUrl}/games/${encodeURIComponent(game)}/player-command-state?${params.toString()}`;
}

export function hostVotecountUrl({ apiBaseUrl = "", game }) {
  return playerVotecountUrl({ apiBaseUrl, game });
}

export function principalScopedGameUrl({
  apiBaseUrl = "",
  game,
  path,
  principalUserId,
}) {
  if (typeof principalUserId !== "string" || principalUserId.trim() === "") {
    throw new TypeError("principalUserId is required for principal-scoped game URLs");
  }
  const params = new URLSearchParams({
    principal_user_id: principalUserId,
  });
  return `${apiBaseUrl}/games/${encodeURIComponent(game)}/${path}?${params.toString()}`;
}

export function hostPromptsUrl({ apiBaseUrl = "", game, principalUserId }) {
  return principalScopedGameUrl({
    apiBaseUrl,
    game,
    path: "host-prompts",
    principalUserId,
  });
}

function formatOccurredAt(value, { fallback = "cold load" } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return new Date(value * 1000).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Los_Angeles",
  });
}

function decisionKindForPrompt(row) {
  if (row?.decision_kind === "select_slot" || row?.decisionKind === "select_slot") {
    return "select_slot";
  }
  return "acknowledge";
}
