import { buildAppShell } from "../../lib/app/app-shell-model.mjs";
import { buildAppSurfaceHeaderViewModel } from "../../lib/app/app-surface-header-model.mjs";
import { resolveSurfaceAccess } from "../../lib/app/capabilities.mjs";
import {
  loadAdminColdData,
  operatorProofRunUrl,
} from "../../lib/app/cold-load.mjs";

export const ADMIN_ROUTE_CONTRACT = Object.freeze({
  surfaceTestId: "admin-surface",
  capabilityTestId: "admin-capability",
  requiredText: "Operations",
});

export async function buildAdminRouteData({
  principalUserId,
  capabilities = [],
  game = "midsummer",
  fetchImpl = null,
  apiBaseUrl = "",
}) {
  const access = resolveSurfaceAccess({
    surface: "admin",
    game: null,
    capabilities,
  });
  const coldData = await loadAdminColdData({
    game,
    principalUserId,
    fetchImpl,
    apiBaseUrl,
    fallback: adminFixtureColdLoad({ game, principalUserId }),
  });

  return Object.freeze({
    shell: buildAppShell({
      game,
      activeSurface: "admin",
      principalUserId,
      capabilities,
    }),
    surfaceHeader: buildAppSurfaceHeaderViewModel({
      surface: "admin",
      eyebrow: "Admin",
      title: "Operations",
      summary:
        "Game setup, scoped session grants, audit reports, and recovery queues.",
      capabilityLabel: access.capabilityLabel,
      capabilityTestId: ADMIN_ROUTE_CONTRACT.capabilityTestId,
    }),
    access,
    operator: Object.freeze({
      principalUserId,
      capabilityLabel: access.capabilityLabel,
    }),
    command: Object.freeze({
      endpoint: "/commands",
      createGame: Object.freeze({
        action: "create_game",
        game,
        pack: "mafiascum",
      }),
      cohost: Object.freeze({
        action: "add_cohost",
        game,
        user: "cohost_c",
      }),
      sessionGrant: Object.freeze({
        action: "grant_session",
        token: `session-grant-${game}`,
        principalUserId: "mod_a",
        expiresAt: 4_102_444_800,
        globalCapabilities: Object.freeze(["GlobalMod"]),
      }),
    }),
    gameSetup: Object.freeze([
      Object.freeze({
        id: "create-game",
        label: "Create game",
        value: "Pack mafiascum",
        authority: "GlobalAdmin",
        boundary: "Command pipeline",
        boundaryDetail: "/commands CreateGame Ack/Reject",
        commandAction: "create_game",
        buttonLabel: "Create",
      }),
      Object.freeze({
        id: "session-grants",
        label: "Session grants",
        value: "GlobalMod for mod_a",
        authority: "GlobalAdmin",
        boundary: "Authenticated session grant",
        boundaryDetail: "/auth/session-grants requires active GlobalAdmin session",
        commandAction: "grant_session",
        confirmLabel: "Grant GlobalMod",
        confirmMessage: "Grant GlobalMod to mod_a",
        buttonLabel: "Review",
      }),
      Object.freeze({
        id: "cohost",
        label: "Cohost delegation",
        value: "cohost_c",
        authority: "HostOf(game)",
        boundary: "Command pipeline",
        boundaryDetail: "/commands AddCohost host-gated by committed game grants",
        commandAction: "add_cohost",
        confirmLabel: "Delegate cohost_c",
        confirmMessage: "Delegate cohost_c as cohost for this game",
        buttonLabel: "Review",
      }),
    ]),
    ...coldData,
    audit: withAdminAuditInspectLinks(coldData.audit, { game }),
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
          game,
          principalUserId,
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

export async function buildAdminAuditDetailData({
  audit,
  principalUserId,
  capabilities = [],
  game = "midsummer",
  fetchImpl = null,
  apiBaseUrl = "",
}) {
  const data = await buildAdminRouteData({
    principalUserId,
    capabilities,
    game,
    fetchImpl,
    apiBaseUrl,
  });
  const auditId = requiredAuditId(audit);
  const item = data.audit.find((candidate) => candidate.id === auditId);

  return Object.freeze({
    shell: data.shell,
    access: data.access,
    operator: data.operator,
    surfaceHeader: buildAppSurfaceHeaderViewModel({
      surface: "admin",
      eyebrow: "Admin audit",
      title: item?.label ?? auditId,
      summary: item?.boundaryDetail ?? "Audit row unavailable.",
      capabilityLabel: data.operator.capabilityLabel,
      capabilityTestId: "admin-audit-detail-capability",
    }),
    game: Object.freeze({
      id: game,
      label: game,
    }),
    overviewHref: adminOverviewHref({ game }),
    audit: item ?? null,
    auditId,
    status: item === undefined ? "missing" : "available",
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

function adminFixtureColdLoad({ game, principalUserId }) {
  return Object.freeze({
    audit: Object.freeze([
      Object.freeze({
        id: "proof-runs",
        label: "Proof runs",
        status: "Current local report available",
        authority: "GlobalAdmin or GlobalMod",
        boundary: "Read-only operator proof",
        boundaryDetail: "/operator/proof-runs machine-readable report",
        href: operatorProofRunUrl({ game, principalUserId }),
      }),
      Object.freeze({
        id: "command-receipts",
        label: "Command receipts",
        status: "Durable ack path live",
        authority: "GlobalAdmin or GlobalMod",
        boundary: "Committed command audit",
        boundaryDetail: "/operator command receipt inspection",
        href: operatorProofRunUrl({
          game,
          principalUserId,
          path: "operator",
        }),
      }),
      Object.freeze({
        id: "recovery",
        label: "Recovery queue",
        status: "No destructive action armed",
        authority: "GlobalAdmin or GlobalMod",
        boundary: "Read-only recovery proof",
        boundaryDetail: "/operator/proof-runs/go-no-go/view saved report",
        href: operatorProofRunUrl({
          game,
          principalUserId,
          path: "operator/proof-runs/go-no-go/view",
        }),
      }),
    ]),
  });
}

function withAdminAuditInspectLinks(audit, { game }) {
  return Object.freeze(
    audit.map((item) =>
      Object.freeze({
        ...item,
        inspectHref: adminAuditInspectHref({
          game,
          audit: item.id,
        }),
      }),
    ),
  );
}

export function adminAuditInspectHref({ game, audit }) {
  const params = new URLSearchParams({
    game: normalizeRoutePart(game, "game"),
  });
  return `/admin/audit/${encodeURIComponent(
    normalizeRoutePart(audit, "audit"),
  )}?${params.toString()}`;
}

export function adminOverviewHref({ game }) {
  const params = new URLSearchParams({
    game: normalizeRoutePart(game, "game"),
  });
  return `/admin?${params.toString()}`;
}

function requiredAuditId(audit) {
  return normalizeRoutePart(audit, "audit");
}

function normalizeRoutePart(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`admin ${field} must be a non-empty string`);
  }
  return value;
}
