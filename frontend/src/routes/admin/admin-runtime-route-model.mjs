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
}) {
  const access = resolveSurfaceAccess({ surface: "admin", game: null, capabilities });
  const shell = buildAppShell({
    game,
    activeSurface: "admin",
    principalUserId,
    capabilities,
  });
  const surfaceHeader = adminSurfaceHeader(access.capabilityLabel);
  const operator = Object.freeze({
    principalUserId,
    capabilityLabel: access.capabilityLabel,
  });

  if (!access.allowed || game === null) {
    return Object.freeze({
      shell,
      surfaceHeader,
      access,
      operator,
      command: emptyAdminCommand(),
      gameSetup: Object.freeze([]),
      audit: Object.freeze([]),
      recoveryTasks: Object.freeze([]),
      escalations: Object.freeze([]),
    });
  }

  const coldData = await loadAdminColdData({
    game,
    principalUserId,
    fetchImpl,
    apiBaseUrl,
    sessionToken,
    identityPrincipalUserId,
    fallback: runtimeAuditFallback({ game }),
  });

  return Object.freeze({
    shell,
    surfaceHeader,
    access,
    operator,
    command: Object.freeze({
      endpoint: "/commands",
      createGame: Object.freeze({ action: "create_game", game, pack: "mafiascum" }),
      cohost: Object.freeze({ action: "add_cohost", game, user: "cohost_c" }),
      sessionGrant: null,
    }),
    gameSetup: Object.freeze([
      Object.freeze({
        id: "host-setup",
        label: "Host setup workflow",
        value: `${game} setup`,
        authority: "HostOf(game)",
        boundary: "Game-specific setup",
        boundaryDetail: "Roster, roles, policy, invites, and StartGame readiness",
        commandAction: "navigate",
        href: `/g/${encodeURIComponent(game)}/setup`,
        buttonLabel: "Open setup",
      }),
    ]),
    audit: withRuntimeAuditLinks(coldData.audit, { game }),
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

function adminOverviewHref(game) {
  return game === null
    ? "/admin"
    : `/admin?game=${encodeURIComponent(game)}`;
}
