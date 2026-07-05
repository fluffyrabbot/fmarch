import {
  CONFIRMATION_ACTION_CONTRACT,
  buildConfirmationActionViewModel,
} from "../../app/confirmation-action-model.mjs";

export const ADMIN_SURFACE_CONTRACT = Object.freeze({
  minTouchTargetPx: 44,
  operatorRailClassName: "admin-surface__operator-actions",
  operatorRailMode: "flow-admin-operator-actions",
  operatorRailStickyTopPx: 0,
  operatorRailUnstickBelowPx: 0,
  setupThumbZone: "admin-setup-actions",
  setupThumbZoneTestId: "admin-setup-action-zone",
  recoveryThumbZone: "admin-recovery-actions",
  recoveryThumbZoneTestId: "admin-recovery-action-zone",
  actionTileClassName: "admin-surface__action-tile",
  actionTileStabilityMode: "reserved-status-floor",
  commandStatusFloorClassName: "admin-surface__command-status-floor",
  commandStatusFloorMinBlockSizePx: 44,
});

export const ADMIN_CONFIRMATION_CONTRACT = Object.freeze({
  role: CONFIRMATION_ACTION_CONTRACT.role,
  ariaModal: CONFIRMATION_ACTION_CONTRACT.ariaModal,
  initialFocus: CONFIRMATION_ACTION_CONTRACT.initialFocus,
  returnFocus: CONFIRMATION_ACTION_CONTRACT.returnFocus,
  escapeCancels: CONFIRMATION_ACTION_CONTRACT.escapeCancels,
  tabContainment: CONFIRMATION_ACTION_CONTRACT.defaultTabContainment,
});

export const ADMIN_READINESS_STRIP_CONTRACT = Object.freeze({
  rootClassName: "admin-readiness-strip",
  componentName: "admin-readiness-strip",
  surface: "readiness",
  testIdPrefix: "admin-readiness",
  statusTestIdPrefix: "admin-readiness-status",
  itemIds: Object.freeze(["authority", "setup", "audit", "recovery"]),
});

export const ADMIN_COMMAND_ACTIVITY_CONTRACT = Object.freeze({
  componentName: "admin-command-activity",
  rootClassName: "admin-command-activity",
  listClassName: "admin-command-activity__list",
  itemClassName: "admin-command-activity__item",
  emptyClassName: "admin-command-activity__empty",
  maxItems: 4,
});

export function buildAdminReadinessStripViewModel({
  operator = {},
  gameSetup = [],
  audit = [],
  recoveryTasks = [],
} = {}) {
  const proofState = adminAuditRollupState(audit);
  const recoveryCount = recoveryTasks.length;
  return Object.freeze({
    root: Object.freeze({
      className: ADMIN_READINESS_STRIP_CONTRACT.rootClassName,
      ariaLabel: "Operator readiness",
    }),
    items: Object.freeze([
      Object.freeze({
        id: "authority",
        label: "Authority",
        value: operator.capabilityLabel ?? "No admin authority",
        detail: operator.principalUserId ?? "No principal",
        status: Object.freeze({
          state: isAdminAuthority(operator.capabilityLabel) ? "ack" : "reject",
          message: isAdminAuthority(operator.capabilityLabel)
            ? "Admin surface authority resolved"
            : "Admin surface authority missing",
        }),
        testId: adminReadinessTestId("authority"),
        statusTestId: adminReadinessStatusTestId("authority"),
      }),
      Object.freeze({
        id: "setup",
        label: "Setup",
        value: countLabel(gameSetup.length, "gated action", "gated actions"),
        detail: joinLabels(gameSetup),
        status: Object.freeze({
          state: gameSetup.length > 0 ? "pending" : "reject",
          message:
            gameSetup.length > 0
              ? "Explicit command boundaries staged"
              : "No setup command boundaries available",
        }),
        testId: adminReadinessTestId("setup"),
        statusTestId: adminReadinessStatusTestId("setup"),
      }),
      Object.freeze({
        id: "audit",
        label: "Audit",
        value: adminAuditRollupValue(audit),
        detail: adminAuditRollupDetail(audit),
        status: Object.freeze({
          state: proofState,
          message: adminAuditRollupMessage(audit, proofState),
        }),
        testId: adminReadinessTestId("audit"),
        statusTestId: adminReadinessStatusTestId("audit"),
      }),
      Object.freeze({
        id: "recovery",
        label: "Recovery",
        value: countLabel(recoveryCount, "gated check", "gated checks"),
        detail: joinLabels(recoveryTasks),
        status: Object.freeze({
          state: recoveryCount > 0 ? "pending" : "reject",
          message:
            recoveryCount > 0
              ? "Recovery checks require explicit confirmation"
              : "No recovery checks exposed",
        }),
        testId: adminReadinessTestId("recovery"),
        statusTestId: adminReadinessStatusTestId("recovery"),
      }),
    ]),
  });
}

export function adminReadinessTestId(id) {
  return `${ADMIN_READINESS_STRIP_CONTRACT.testIdPrefix}-${id}`;
}

export function adminReadinessStatusTestId(id) {
  return `${ADMIN_READINESS_STRIP_CONTRACT.statusTestIdPrefix}-${id}`;
}

export function buildAdminCommandActivityViewModel({
  commandStatuses = {},
} = {}) {
  const items = Object.entries(commandStatuses)
    .map(([actionId, status]) => adminCommandActivityItem({ actionId, status }))
    .slice(-ADMIN_COMMAND_ACTIVITY_CONTRACT.maxItems)
    .reverse();

  return Object.freeze({
    root: Object.freeze({
      className: ADMIN_COMMAND_ACTIVITY_CONTRACT.rootClassName,
      ariaLabel: "Admin command activity",
      data: Object.freeze({
        component: ADMIN_COMMAND_ACTIVITY_CONTRACT.componentName,
      }),
    }),
    heading: "Command activity",
    summary:
      items.length === 0
        ? "Ready for admin commands"
        : `${items.length} recent admin command ${items.length === 1 ? "event" : "events"}`,
    empty: Object.freeze({
      className: ADMIN_COMMAND_ACTIVITY_CONTRACT.emptyClassName,
      testId: "admin-command-activity-empty",
      state: "idle",
      message: "No admin commands in flight.",
    }),
    listClassName: ADMIN_COMMAND_ACTIVITY_CONTRACT.listClassName,
    items: Object.freeze(items),
  });
}

function adminCommandActivityItem({ actionId, status }) {
  const normalizedActionId = String(actionId);
  const state = String(status?.state ?? "info");
  return Object.freeze({
    actionId: normalizedActionId,
    state,
    label: adminCommandActivityLabel(normalizedActionId),
    message: String(status?.message ?? status?.error ?? "Command updated"),
    testId: `admin-command-activity-${normalizedActionId}`,
    statusTestId: `admin-command-activity-status-${normalizedActionId}`,
    confirmationTrace: status?.confirmationTrace ?? null,
    className: ADMIN_COMMAND_ACTIVITY_CONTRACT.itemClassName,
  });
}

export function buildAdminSetupGridViewModel({
  items = [],
  commandStatuses = {},
  sessionGrant,
} = {}) {
  return Object.freeze({
    root: Object.freeze({
      className: "fm-grid fm-grid--three",
      ariaLabel: "Game setup",
      testId: ADMIN_SURFACE_CONTRACT.setupThumbZoneTestId,
      data: Object.freeze({
        thumbZone: ADMIN_SURFACE_CONTRACT.setupThumbZone,
        actionTileStabilityMode: ADMIN_SURFACE_CONTRACT.actionTileStabilityMode,
      }),
    }),
    items: Object.freeze(
      items.map((item) => {
        const status = commandStatuses[item.id] ?? null;
        return Object.freeze({
          ...baseAdminItem(item, "admin-setup"),
          buttonLabel: item.buttonLabel,
          href: item.href ?? null,
          minTouchTargetPx: ADMIN_SURFACE_CONTRACT.minTouchTargetPx,
          status,
          statusTestId: `admin-command-status-${item.id}`,
          statusFloorTestId: `admin-command-status-floor-${item.id}`,
          statusFloorMinBlockSizePx:
            ADMIN_SURFACE_CONTRACT.commandStatusFloorMinBlockSizePx,
          actionTileClassName: ADMIN_SURFACE_CONTRACT.actionTileClassName,
          statusFloorClassName: ADMIN_SURFACE_CONTRACT.commandStatusFloorClassName,
          confirmTestId: `admin-command-confirm-${item.id}`,
          cancelTestId: `admin-command-cancel-${item.id}`,
          triggerTestId: `admin-command-trigger-${item.id}`,
          confirmation: adminConfirmationView(item, "admin-command", status),
          isSessionGrant: item.commandAction === "grant_session",
          sessionGrant,
        });
      }),
    ),
  });
}

export function buildAdminAuditPanelViewModel({ audit = [] } = {}) {
  return Object.freeze({
    root: Object.freeze({
      className: "fm-grid",
      ariaLabel: "Audit",
    }),
    items: Object.freeze(
      audit.map((item) =>
        Object.freeze({
          ...item,
          inspectHref: item.inspectHref ?? item.href,
          testId: `admin-audit-${item.id}`,
          linkTestId: `admin-audit-link-${item.id}`,
          boundaryTestId: `admin-audit-boundary-${item.id}`,
          evidenceTestId: `admin-audit-evidence-${item.id}`,
          buttonLabel: "Inspect",
          authority: item.authority ?? "GlobalAdmin or GlobalMod",
          boundary: item.boundary ?? "Read-only operator proof",
          boundaryDetail:
            item.boundaryDetail ?? "/operator/proof-runs machine-readable report",
          statusView: Object.freeze({
            state: adminAuditStatusState(item.status),
            message: item.status,
          }),
          statusTestId: `admin-audit-status-${item.id}`,
          minTouchTargetPx: ADMIN_SURFACE_CONTRACT.minTouchTargetPx,
        }),
      ),
    ),
  });
}

export function buildAdminRecoveryPanelViewModel({
  tasks = [],
  commandStatuses = {},
  game,
  principalUserId,
} = {}) {
  return Object.freeze({
    root: Object.freeze({
      className: "fm-grid",
      ariaLabel: "Recovery",
      testId: ADMIN_SURFACE_CONTRACT.recoveryThumbZoneTestId,
      data: Object.freeze({
        thumbZone: ADMIN_SURFACE_CONTRACT.recoveryThumbZone,
        actionTileStabilityMode: ADMIN_SURFACE_CONTRACT.actionTileStabilityMode,
      }),
    }),
    items: Object.freeze(
      tasks.map((item) => {
        const status = commandStatuses[item.id] ?? null;
        return Object.freeze({
          ...baseAdminItem(item, "admin-recovery"),
          buttonLabel: item.buttonLabel,
          minTouchTargetPx: ADMIN_SURFACE_CONTRACT.minTouchTargetPx,
          status,
          statusTestId: `admin-recovery-status-${item.id}`,
          statusFloorTestId: `admin-recovery-status-floor-${item.id}`,
          statusFloorMinBlockSizePx:
            ADMIN_SURFACE_CONTRACT.commandStatusFloorMinBlockSizePx,
          actionTileClassName: ADMIN_SURFACE_CONTRACT.actionTileClassName,
          statusFloorClassName: ADMIN_SURFACE_CONTRACT.commandStatusFloorClassName,
          formTestId: `admin-recovery-form-${item.id}`,
          confirmTestId: `admin-recovery-confirm-${item.id}`,
          cancelTestId: `admin-recovery-cancel-${item.id}`,
          triggerTestId: `admin-recovery-trigger-${item.id}`,
          confirmation: adminConfirmationView(item, "admin-recovery", status),
          form: Object.freeze({
            action: "?/checkRecoveryGate",
            game,
            principalUserId,
          }),
        });
      }),
    ),
  });
}

export function buildAdminEscalationPanelViewModel({ escalations = [] } = {}) {
  return Object.freeze({
    root: Object.freeze({
      className: "fm-grid",
      ariaLabel: "Escalation",
    }),
    items: Object.freeze(
      escalations.map((item) =>
        Object.freeze({
          ...item,
          testId: `admin-escalation-${item.id}`,
        }),
      ),
    ),
  });
}

function baseAdminItem(item, testIdPrefix) {
  return {
    ...item,
    testId: `${testIdPrefix}-${item.id}`,
    boundaryTestId:
      testIdPrefix === "admin-recovery"
        ? `admin-recovery-boundary-${item.id}`
        : `admin-boundary-${item.id}`,
  };
}

function adminConfirmationView(item, testIdPrefix, status) {
  const triggerTestId =
    testIdPrefix === "admin-recovery"
      ? `admin-recovery-trigger-${item.id}`
      : `admin-command-trigger-${item.id}`;
  return buildConfirmationActionViewModel({
    surface: testIdPrefix === "admin-recovery" ? "admin-recovery" : "admin-setup",
    actionId: item.id,
    label: item.label,
    message: status?.message ?? item.confirmMessage ?? `Confirm ${item.label}`,
    messageIdPrefix: `${testIdPrefix}-confirmation-message`,
    confirmTestId: `${testIdPrefix}-confirm-${item.id}`,
    cancelTestId: `${testIdPrefix}-cancel-${item.id}`,
    triggerTestId,
    tabContainment: ADMIN_CONFIRMATION_CONTRACT.tabContainment,
  });
}

function adminAuditStatusState(status) {
  const normalized = String(status ?? "").toLowerCase();
  if (/(blocked|fail|reject|non.?trusted|needs? review)/.test(normalized)) {
    return "reject";
  }
  if (/(green|trusted|available|live|ready|current|no destructive)/.test(normalized)) {
    return "ack";
  }
  return "pending";
}

function adminAuditRollupState(audit) {
  const states = audit.map((item) => adminAuditStatusState(item.status));
  if (states.length === 0 || states.includes("reject")) {
    return "reject";
  }
  if (states.includes("pending")) {
    return "pending";
  }
  return "ack";
}

function adminAuditRollupValue(audit) {
  if (audit.length === 0) {
    return "No proof surfaces";
  }
  const trusted = audit.filter(
    (item) => adminAuditStatusState(item.status) === "ack",
  ).length;
  return `${trusted}/${audit.length} proof surfaces current`;
}

function adminAuditRollupDetail(audit) {
  if (audit.length === 0) {
    return "Operator proof data unavailable";
  }
  const firstAttention = audit.find(
    (item) => adminAuditStatusState(item.status) !== "ack",
  );
  if (firstAttention !== undefined) {
    return `${firstAttention.label}: ${firstAttention.status}`;
  }
  return joinLabels(audit);
}

function adminAuditRollupMessage(audit, state) {
  if (audit.length === 0) {
    return "Audit proof surfaces unavailable";
  }
  if (state === "reject") {
    return "Audit proof needs operator review";
  }
  if (state === "pending") {
    return "Audit proof has pending evidence";
  }
  return "Audit proof links are current";
}

function isAdminAuthority(capabilityLabel) {
  return capabilityLabel === "GlobalAdmin" || capabilityLabel === "GlobalMod";
}

function adminCommandActivityLabel(actionId) {
  return String(actionId).replaceAll("_", " ").replaceAll("-", " ");
}

function joinLabels(items) {
  if (items.length === 0) {
    return "None";
  }
  return items.map((item) => item.label).join(", ");
}

function countLabel(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}
