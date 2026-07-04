import { buildAppShell } from "../../../../lib/app/app-shell-model.mjs";
import { buildAppSurfaceHeaderViewModel } from "../../../../lib/app/app-surface-header-model.mjs";
import { fetchJson } from "../../../../lib/app/cold-load.mjs";
import { resolveHostConsoleAccess } from "../host/host-route-model.mjs";

export const HOST_SETUP_ROUTE_CONTRACT = Object.freeze({
  surfaceTestId: "host-setup-surface",
  capabilityTestId: "host-setup-capability",
  requiredText: "Ready to start",
});

export async function buildHostSetupRouteData({
  game,
  capabilities = [],
  principalUserId = "host_h",
  fetchImpl = null,
  apiBaseUrl = "",
}) {
  const gameId = normalizeId(game, "game");
  const principal = normalizeId(principalUserId, "principalUserId");
  const access = resolveHostConsoleAccess({ game: gameId, capabilities });
  const setupState = normalizeHostSetupState(
    await fetchJson({
      fetchImpl,
      fallback: hostSetupFixtureState({ game: gameId }),
      url: hostSetupStateUrl({ apiBaseUrl, game: gameId, principalUserId: principal }),
    }),
    { game: gameId },
  );
  const readiness = buildHostSetupReadiness(setupState);

  return Object.freeze({
    shell: buildAppShell({
      game: gameId,
      activeSurface: "moderator",
      principalUserId: principal,
      capabilities,
    }),
    surfaceHeader: buildAppSurfaceHeaderViewModel({
      surface: "host-setup",
      eyebrow: gameId,
      title: "Host setup",
      summary: "Roster, roles, post policy, invites, and start readiness.",
      capabilityLabel: access.capabilityLabel,
      capabilityTestId: HOST_SETUP_ROUTE_CONTRACT.capabilityTestId,
    }),
    access,
    game: Object.freeze({
      id: gameId,
      label: gameId,
    }),
    session: Object.freeze({
      principalUserId: principal,
    }),
    commandEndpoint: "/commands",
    setupStateEndpoint: hostSetupStateUrl({
      apiBaseUrl,
      game: gameId,
      principalUserId: principal,
    }),
    setupState,
    readiness,
    start: Object.freeze({
      defaultPhase: readiness.defaultStartPhase,
      available: readiness.startAvailable,
      hostHref: `/g/${gameId}/host`,
    }),
  });
}

export function hostSetupStateUrl({ apiBaseUrl = "", game, principalUserId }) {
  const params = new URLSearchParams({
    principal_user_id: normalizeId(principalUserId, "principalUserId"),
  });
  return `${apiBaseUrl}/games/${encodeURIComponent(
    normalizeId(game, "game"),
  )}/setup-state?${params.toString()}`;
}

export function normalizeHostSetupState(raw, { game }) {
  const pack = raw?.pack ?? {};
  const slots = Array.isArray(raw?.slots) ? raw.slots : [];
  const policies = Array.isArray(raw?.post_policies) ? raw.post_policies : [];
  return Object.freeze({
    game: normalizeId(raw?.game ?? game, "game"),
    created: raw?.created === true,
    pack: Object.freeze({
      key: normalizeOptionalText(pack.key) ?? "unknown",
      name: normalizeOptionalText(pack.name) ?? normalizeOptionalText(pack.key) ?? "Unknown pack",
      valid: pack.valid === true,
      roleKeys: Object.freeze(
        Array.isArray(pack.role_keys)
          ? pack.role_keys.map((role) => String(role)).sort()
          : [],
      ),
      startPhaseOptions: Object.freeze(
        Array.isArray(pack.start_phase_options) && pack.start_phase_options.length > 0
          ? pack.start_phase_options.map((phase) => String(phase))
          : ["D01"],
      ),
    }),
    phase: raw?.phase
      ? Object.freeze({
          phaseId: String(raw.phase.phase_id),
          locked: raw.phase.locked === true,
          deadline: raw.phase.deadline ?? null,
        })
      : null,
    slots: Object.freeze(
      slots.map((slot) =>
        Object.freeze({
          slotId: normalizeId(slot.slot_id, "slot.slot_id"),
          occupantUserId: normalizeOptionalText(slot.occupant_user_id),
          alive: slot.alive !== false,
          status: normalizeOptionalText(slot.status) ?? "alive",
          statusTags: Object.freeze(
            Array.isArray(slot.status_tags)
              ? slot.status_tags.map((tag) => String(tag))
              : [],
          ),
          roleKey: normalizeOptionalText(slot.role_key),
        }),
      ),
    ),
    postPolicies: Object.freeze(
      policies.map((policy) =>
        Object.freeze({
          channelId: normalizeOptionalText(policy.channel_id) ?? "main",
          allowMediaOnly: policy.allow_media_only === true,
        }),
      ),
    ),
  });
}

export function buildHostSetupReadiness(setupState) {
  const mainPolicy =
    setupState.postPolicies.find((policy) => policy.channelId === "main") ??
    Object.freeze({ channelId: "main", allowMediaOnly: false });
  const slotsExist = setupState.slots.length > 0;
  const occupied = slotsExist && setupState.slots.every((slot) => slot.occupantUserId !== null);
  const rolesAssigned = slotsExist && setupState.slots.every((slot) => slot.roleKey !== null);
  const defaultStartPhase = setupState.pack.startPhaseOptions[0] ?? "D01";
  const checks = Object.freeze([
    readinessCheck("game-created", "Game created", setupState.created),
    readinessCheck("pack-valid", "Pack selected", setupState.pack.valid),
    readinessCheck("slots-exist", "Slots exist", slotsExist),
    readinessCheck("slots-occupied", "Slots have occupants", occupied),
    readinessCheck("roles-assigned", "Slots have roles", rolesAssigned),
    readinessCheck("policy-acknowledged", "Main post policy acknowledged", mainPolicy !== null),
    readinessCheck("start-phase", "Start phase selected", defaultStartPhase !== ""),
  ]);
  const startAvailable =
    setupState.phase === null && checks.every((check) => check.state === "ready");
  return Object.freeze({
    checks,
    mainPolicy,
    defaultStartPhase,
    startAvailable,
    summary: startAvailable
      ? "Ready to start"
      : setupState.phase !== null
        ? `Started at ${setupState.phase.phaseId}`
        : "Setup still needs attention",
  });
}

export function occupiedSetupInviteTargets(setupState) {
  return Object.freeze(
    setupState.slots
      .filter((slot) => slot.occupantUserId !== null)
      .map((slot) =>
        Object.freeze({
          slotId: slot.slotId,
          principalUserId: slot.occupantUserId,
          expectedOccupantUserId: slot.occupantUserId,
          targetLabel: `${slotLabel(slot.slotId)} / ${slot.occupantUserId}`,
        }),
      ),
  );
}

function readinessCheck(id, label, ready) {
  return Object.freeze({
    id,
    label,
    state: ready ? "ready" : "blocked",
  });
}

function hostSetupFixtureState({ game }) {
  return Object.freeze({
    game,
    created: true,
    pack: Object.freeze({
      key: "mafiascum",
      name: "Mafiascum",
      valid: true,
      role_keys: Object.freeze(["mafia_goon", "vanilla_townie"]),
      start_phase_options: Object.freeze(["D01", "N01"]),
    }),
    phase: null,
    slots: Object.freeze([
      Object.freeze({
        slot_id: "slot_1",
        occupant_user_id: "player_mira",
        alive: true,
        status: "alive",
        status_tags: Object.freeze([]),
        role_key: "vanilla_townie",
      }),
      Object.freeze({
        slot_id: "slot_2",
        occupant_user_id: null,
        alive: true,
        status: "alive",
        status_tags: Object.freeze([]),
        role_key: null,
      }),
    ]),
    post_policies: Object.freeze([
      Object.freeze({
        channel_id: "main",
        allow_media_only: false,
      }),
    ]),
  });
}

function slotLabel(slotId) {
  return String(slotId).replace(/^slot[-_]?/i, "Slot ");
}

function normalizeOptionalText(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function normalizeId(value, field) {
  const normalized = normalizeOptionalText(value);
  if (normalized === null) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return normalized;
}
