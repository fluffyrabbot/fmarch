import { buildAppShell } from "../../../../lib/app/app-shell-model.mjs";
import { buildAppSurfaceHeaderViewModel } from "../../../../lib/app/app-surface-header-model.mjs";
import { fetchJson } from "../../../../lib/app/cold-load.mjs";
import { resolveHostConsoleAccess } from "../host/host-route-model.mjs";
import { buildHostSetupWorkflow } from "./setup-workflow-model.mjs";

export const HOST_SETUP_ROUTE_CONTRACT = Object.freeze({
  surfaceTestId: "host-setup-surface",
  capabilityTestId: "host-setup-capability",
  requiredText: "Setup workflow",
});

export async function buildHostSetupRouteData({
  game,
  capabilities = [],
  principalUserId = "host_h",
  fetchImpl = null,
  apiBaseUrl = "",
  sessionToken = null,
}) {
  const gameId = normalizeId(game, "game");
  const principal = normalizeId(principalUserId, "principalUserId");
  const access = resolveHostConsoleAccess({ game: gameId, capabilities });
  const serverSetupStateEndpoint = hostSetupStateUrl({
    apiBaseUrl,
    game: gameId,
    principalUserId: principal,
  });
  const browserSetupStateEndpoint = hostSetupStateUrl({
    game: gameId,
    principalUserId: principal,
  });
  const setupState = normalizeHostSetupState(
    await fetchJson({
      fetchImpl,
      fallback: hostSetupFixtureState({ game: gameId }),
      url: serverSetupStateEndpoint,
      headers: authenticatedReadHeaders(sessionToken),
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
    setupStateEndpoint: browserSetupStateEndpoint,
    setupState,
    readiness,
    workflow: buildHostSetupWorkflow({ setupState, readiness }),
    start: Object.freeze({
      defaultPhase: readiness.defaultStartPhase,
      available: readiness.startAvailable,
      hostHref: `/g/${gameId}/host`,
    }),
  });
}

export function hostSetupStateUrl({ apiBaseUrl = "", game, principalUserId }) {
  normalizeId(principalUserId, "principalUserId");
  const base = apiBaseUrl === "" ? "/api/gameplay" : apiBaseUrl;
  return `${base}/games/${encodeURIComponent(
    normalizeId(game, "game"),
  )}/setup-state`;
}

export function normalizeHostSetupState(raw, { game }) {
  const pack = raw?.pack ?? {};
  const slots = Array.isArray(raw?.slots) ? raw.slots : [];
  const policies = Array.isArray(raw?.post_policies) ? raw.post_policies : [];
  const programCatalog = Array.isArray(raw?.program_catalog) ? raw.program_catalog : [];
  const attachedPrograms = Array.isArray(raw?.attached_programs) ? raw.attached_programs : [];
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
      roles: Object.freeze(
        Array.isArray(pack.roles) && pack.roles.length > 0
          ? pack.roles.map((role) => Object.freeze({
              key: normalizeId(role.key, "pack.roles.key"),
              label: normalizeOptionalText(role.label) ?? humanizeIdentifier(role.key),
              description: normalizeOptionalText(role.description) ?? "",
            }))
          : (Array.isArray(pack.role_keys) ? pack.role_keys : []).map((key) => Object.freeze({
              key: String(key),
              label: humanizeIdentifier(key),
              description: "",
            })),
      ),
      startPhaseOptions: Object.freeze(
        Array.isArray(pack.start_phase_options) && pack.start_phase_options.length > 0
          ? pack.start_phase_options.map((phase) => String(phase))
          : ["D01"],
      ),
    }),
    programCatalog: Object.freeze(
      programCatalog.map((option) => {
        const document = structuredCloneValue(option.document);
        return Object.freeze({
          id: normalizeId(document.id, "program_catalog.document.id"),
          version: Number(document.version),
          displayName:
            normalizeOptionalText(document.display_name) ?? humanizeIdentifier(document.id),
          themeRef: normalizeOptionalText(document.theme_ref),
          contentHash: normalizeId(option.content_hash, "program_catalog.content_hash"),
          eventCount: Array.isArray(document.events) ? document.events.length : 0,
          compatibility: Object.freeze({
            attachable: option.compatibility?.attachable === true,
            issues: Object.freeze(
              (Array.isArray(option.compatibility?.issues)
                ? option.compatibility.issues
                : []
              ).map((issue) =>
                Object.freeze({
                  code: normalizeId(issue.code, "program_catalog.compatibility.issue.code"),
                  eventId: normalizeOptionalText(issue.event_id),
                  message: normalizeId(
                    issue.message,
                    "program_catalog.compatibility.issue.message",
                  ),
                }),
              ),
            ),
          }),
          document: deepFreeze(document),
        });
      }),
    ),
    attachedPrograms: Object.freeze(
      attachedPrograms.map((program) =>
        Object.freeze({
          id: normalizeId(program.program_id, "attached_programs.program_id"),
          version: Number(program.version),
          displayName:
            normalizeOptionalText(program.display_name) ?? humanizeIdentifier(program.program_id),
          themeRef: normalizeOptionalText(program.theme_ref),
          contentHash: normalizeId(program.content_hash, "attached_programs.content_hash"),
          eventCount: Number(program.event_count),
        }),
      ),
    ),
    accounts: Object.freeze(
      (Array.isArray(raw?.accounts) ? raw.accounts : []).map((account) =>
        Object.freeze({
          accountId: normalizeId(account.account_id, "accounts.account_id"),
          principalUserId: normalizeId(
            account.principal_user_id,
            "accounts.principal_user_id",
          ),
          label: normalizeOptionalText(account.label) ?? String(account.account_id),
        }),
      ),
    ),
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
          accountId: setupState.accounts.find(
            (account) => account.principalUserId === slot.occupantUserId,
          )?.accountId ?? "",
          targetLabel: `${slotLabel(slot.slotId)} / ${accountLabel(setupState, slot.occupantUserId)}`,
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
      roles: Object.freeze([
        Object.freeze({ key: "mafia_goon", label: "Mafia Goon", description: "Mafia Goon." }),
        Object.freeze({ key: "vanilla_townie", label: "Vanilla Townie", description: "Vanilla Townie." }),
      ]),
      start_phase_options: Object.freeze(["D01", "N01"]),
    }),
    accounts: Object.freeze([
      Object.freeze({ account_id: "mira@example.test", principal_user_id: "player_mira", label: "mira@example.test" }),
    ]),
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
    program_catalog: Object.freeze([
      Object.freeze({
        content_hash: "0000000000000000000000000000000000000000000000000000000000000000",
        compatibility: Object.freeze({
          attachable: true,
          issues: Object.freeze([]),
        }),
        document: Object.freeze({
          id: "bakery",
          version: 1,
          display_name: "Bakery",
          theme_ref: "theme.bakery",
          events: Object.freeze([
            Object.freeze({
              id: "bakery-cookie-d1",
              template_key: "theme.bakery.cookie_raffle",
            }),
          ]),
        }),
      }),
    ]),
    attached_programs: Object.freeze([]),
  });
}

function slotLabel(slotId) {
  return String(slotId).replace(/^slot[-_]?/i, "Slot ");
}

function accountLabel(setupState, principalUserId) {
  return setupState.accounts.find((account) => account.principalUserId === principalUserId)?.label
    ?? "Assigned account";
}

function authenticatedReadHeaders(sessionToken) {
  return typeof sessionToken === "string" && sessionToken.trim() !== ""
    ? Object.freeze({ authorization: `Bearer ${sessionToken}` })
    : null;
}

function humanizeIdentifier(value) {
  return String(value)
    .split(/[_-]/u)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function normalizeOptionalText(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function structuredCloneValue(value) {
  return value == null ? {} : JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function normalizeId(value, field) {
  const normalized = normalizeOptionalText(value);
  if (normalized === null) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return normalized;
}
