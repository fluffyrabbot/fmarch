import { buildAppShell } from "../../lib/app/app-shell-model.mjs";
import { buildAppSurfaceHeaderViewModel } from "../../lib/app/app-surface-header-model.mjs";
import { resolveSurfaceAccess } from "../../lib/app/capabilities.mjs";
import { loadAdminColdData, operatorProofRunUrl } from "../../lib/app/cold-load.mjs";
import { ADMIN_ROUTE_CONTRACT } from "./admin-route-contract.mjs";

export async function buildAdminRuntimeRouteData({
  principalUserId,
  capabilities = [],
  game = null,
  fetchImpl = null,
  apiBaseUrl = "",
  sessionToken = null,
  identityPrincipalUserId = "host_h",
  gameIndexPage = null,
}) {
  const gameSelection = normalizeAdminGameSelection(gameIndexPage, game);
  const selectedGame = gameSelection.selectedGame;
  const access = resolveSurfaceAccess({ surface: "admin", game: null, capabilities });
  const shell = buildAppShell({
    game: selectedGame,
    activeSurface: "admin",
    principalUserId,
    capabilities,
  });
  const surfaceHeader = adminSurfaceHeader(access.capabilityLabel);
  const operator = Object.freeze({
    principalUserId,
    capabilityLabel: access.capabilityLabel,
  });

  if (!access.allowed || selectedGame === null) {
    return Object.freeze({
      shell,
      surfaceHeader,
      access,
      operator,
      gameSelection,
      command: emptyAdminCommand(),
      gameSetup: Object.freeze([]),
      audit: Object.freeze([]),
      recoveryTasks: Object.freeze([]),
      escalations: Object.freeze([]),
    });
  }

  const coldData = await loadAdminColdData({
    game: selectedGame,
    principalUserId,
    fetchImpl,
    apiBaseUrl,
    sessionToken,
    identityPrincipalUserId,
    fallback: runtimeAuditFallback({ game: selectedGame }),
  });

  return Object.freeze({
    shell,
    surfaceHeader,
    access,
    operator,
    gameSelection,
    command: Object.freeze({
      endpoint: "/commands",
      createGame: Object.freeze({ action: "create_game", game: selectedGame, pack: "mafiascum" }),
      cohost: Object.freeze({ action: "add_cohost", game: selectedGame, user: "cohost_c" }),
      sessionGrant: null,
    }),
    gameSetup: Object.freeze([
      Object.freeze({
        id: "host-setup",
        label: "Host setup workflow",
        value: `${selectedGame} setup`,
        authority: "HostOf(game)",
        boundary: "Game-specific setup",
        boundaryDetail: "Roster, roles, policy, invites, and StartGame readiness",
        commandAction: "navigate",
        href: `/g/${encodeURIComponent(selectedGame)}/setup`,
        buttonLabel: "Open setup",
      }),
    ]),
    audit: Object.freeze([
      authDeliveryQueueAudit(),
      ...withRuntimeAuditLinks(coldData.audit, { game: selectedGame }),
    ]),
    recoveryTasks: Object.freeze([
      Object.freeze({
        id: "recovery-gate",
        label: "Recovery go/no-go",
        value: "Check saved production proof artifacts before recovery",
        authority: "GlobalAdmin or GlobalMod",
        boundary: "Read-only operator proof",
        boundaryDetail: "/operator/proof-runs/go-no-go machine-readable report",
        action: "check_recovery_gate",
        buttonLabel: "Check gate",
        confirmLabel: "Run check",
        confirmMessage: "Read saved go/no-go proof artifacts for this game",
        endpoint: operatorProofRunUrl({
          game: selectedGame,
          path: "operator/proof-runs/go-no-go",
        }),
      }),
    ]),
    escalations: Object.freeze([
      Object.freeze({
        id: "visibility",
        label: "Visibility review",
        value: "Private-channel bytes stay server-filtered",
      }),
      Object.freeze({
        id: "moderation",
        label: "Cross-game moderation",
        value: "GlobalMod only",
      }),
    ]),
  });
}

export async function loadAdminGameIndex({
  fetchImpl,
  apiBaseUrl = "",
  sessionToken = null,
  fallback = null,
}) {
  if (
    typeof fetchImpl !== "function" ||
    typeof sessionToken !== "string" ||
    sessionToken.trim() === ""
  ) {
    return fallback;
  }
  try {
    const response = await fetchImpl(`${apiBaseUrl}/admin/games?limit=100`, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${sessionToken}`,
      },
    });
    if (!response.ok) {
      return fallback;
    }
    const body = await response.json();
    return body !== null && typeof body === "object" ? body : fallback;
  } catch {
    return fallback;
  }
}

export function normalizeAdminGameSelection(page, requestedGame = null) {
  const games = Array.isArray(page?.games)
    ? page.games.map(normalizeAdminGameOption).filter(Boolean)
    : [];
  const requested = nonemptyString(requestedGame);
  const selected = games.find((entry) => entry.id === requested) ??
    games.find((entry) => entry.status !== "completed") ??
    games[0] ??
    null;
  return Object.freeze({
    status: page === null ? "unavailable" : "ready",
    selectedGame: selected?.id ?? requested,
    options: Object.freeze(
      games.map((entry) => Object.freeze({
        ...entry,
        selected: entry.id === selected?.id,
        href: `/admin?game=${encodeURIComponent(entry.id)}`,
      })),
    ),
  });
}

export async function buildAdminRuntimeAuditDetailData({ audit, ...context }) {
  const overview = await buildAdminRuntimeRouteData(context);
  const selected = overview.audit.find((item) => item.id === audit) ?? null;
  return Object.freeze({
    ...overview,
    surfaceHeader: buildAppSurfaceHeaderViewModel({
      surface: "admin",
      eyebrow: "Admin audit",
      title: selected?.label ?? "Audit unavailable",
      summary: selected?.boundaryDetail ?? "The requested live audit is not available.",
      capabilityLabel: overview.access.capabilityLabel,
      capabilityTestId: "admin-audit-detail-capability",
    }),
    auditId: audit,
    audit: selected,
    status: selected === null ? "missing" : "available",
    overviewHref: adminOverviewHref(context.game),
  });
}

export function adminForbiddenMessage() {
  return "Admin operations require GlobalAdmin or GlobalMod capability.";
}

export function summarizeRecoveryGate(body) {
  if (body === null || typeof body !== "object") {
    return Object.freeze({
      state: "reject",
      message: "Recovery gate returned malformed proof data",
    });
  }
  const production = body.production ?? {};
  const trusted = Number(production.trusted ?? 0);
  const total = Number(production.total_artifact_rows ?? 0);
  const nonTrusted = Number(production.non_trusted ?? 0);
  if (body.ok === true && nonTrusted === 0) {
    return Object.freeze({
      state: "ack",
      message: `Recovery gate trusted: ${trusted}/${total} production artifacts trusted`,
      trusted,
      total,
      nonTrusted,
    });
  }
  return Object.freeze({
    state: "reject",
    message: `Recovery gate blocked: ${nonTrusted}/${total} production artifacts need review`,
    trusted,
    total,
    nonTrusted,
  });
}

function adminSurfaceHeader(capabilityLabel) {
  return buildAppSurfaceHeaderViewModel({
    surface: "admin",
    eyebrow: "Admin",
    title: "Operations",
    summary: "Manage live games, access, recovery, and system health.",
    capabilityLabel,
    capabilityTestId: ADMIN_ROUTE_CONTRACT.capabilityTestId,
  });
}

function emptyAdminCommand() {
  return Object.freeze({ endpoint: "/commands", sessionGrant: null });
}

function runtimeAuditFallback({ game }) {
  return Object.freeze({
    audit: Object.freeze([
      Object.freeze({
        id: "proof-runs",
        label: "Proof runs",
        status: "Operator status unavailable",
        authority: "GlobalAdmin or GlobalMod",
        boundary: "Read-only operator proof",
        boundaryDetail: "/operator/proof-runs machine-readable report",
        href: operatorProofRunUrl({ game }),
      }),
    ]),
  });
}

function withRuntimeAuditLinks(audit, { game }) {
  return Object.freeze(
    audit.map((item) =>
      Object.freeze({
        ...item,
        inspectHref:
          typeof item.inspectHref === "string" && item.inspectHref.trim() !== ""
            ? item.inspectHref
            : `/admin/audit/${encodeURIComponent(item.id)}?game=${encodeURIComponent(game)}`,
      }),
    ),
  );
}

function authDeliveryQueueAudit() {
  return Object.freeze({
    id: "auth-deliveries",
    label: "Identity deliveries",
    status: "Review exceptions",
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Credential-safe operator queue",
    boundaryDetail: "Failures and cancellations are visible without credential material",
    href: "/admin/deliveries",
    inspectHref: "/admin/deliveries",
  });
}

function adminOverviewHref(game) {
  return game === null
    ? "/admin"
    : `/admin?game=${encodeURIComponent(game)}`;
}

function normalizeAdminGameOption(entry) {
  const id = nonemptyString(entry?.game, entry?.id);
  const pack = nonemptyString(entry?.pack);
  const status = nonemptyString(entry?.status);
  if (id === null || pack === null || !["setup", "active", "completed"].includes(status)) {
    return null;
  }
  const phase = nonemptyString(entry?.phase_id, entry?.phaseId);
  return Object.freeze({
    id,
    pack,
    status,
    label: `${pack} · ${status}${phase === null ? "" : ` · ${phase}`}`,
  });
}

function nonemptyString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }
  return null;
}
