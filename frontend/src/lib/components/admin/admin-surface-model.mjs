import {
  CONFIRMATION_ACTION_CONTRACT,
  buildConfirmationActionViewModel,
} from "../../app/confirmation-action-model.mjs";
import { humanizeCapabilityLabel } from "../../app/presentation-copy.mjs";

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
  rootClassName: "fm-ledger",
  listClassName: "fm-ledger__list",
  itemClassName: "fm-ledger__row",
  emptyClassName: "fm-ledger__empty",
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
        label: "Your access",
        value: operator.capabilityLabel
          ? humanizeCapabilityLabel(operator.capabilityLabel)
          : "No administrator access",
        detail: operator.principalUserId ? `Signed in as @${operator.principalUserId}` : "Signed out",
        status: Object.freeze({
          state: isAdminAuthority(operator.capabilityLabel) ? "ack" : "reject",
          message: isAdminAuthority(operator.capabilityLabel)
            ? "Administrator access confirmed"
            : "Administrator access is unavailable",
        }),
        testId: adminReadinessTestId("authority"),
        statusTestId: adminReadinessStatusTestId("authority"),
      }),
      Object.freeze({
        id: "setup",
        label: "Actions",
        value: countLabel(gameSetup.length, "available action", "available actions"),
        detail: joinLabels(gameSetup),
        status: Object.freeze({
          state: gameSetup.length > 0 ? "pending" : "reject",
          message:
            gameSetup.length > 0
              ? "Game and account actions are ready"
              : "No administrator actions are available",
        }),
        testId: adminReadinessTestId("setup"),
        statusTestId: adminReadinessStatusTestId("setup"),
      }),
      Object.freeze({
        id: "audit",
        label: "System checks",
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
        value: countLabel(recoveryCount, "check to review", "checks to review"),
        detail: joinLabels(recoveryTasks),
        status: Object.freeze({
          state: recoveryCount > 0 ? "pending" : "reject",
          message:
            recoveryCount > 0
              ? "Review before making recovery changes"
              : "No recovery checks are available",
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
  const label = adminCommandActivityLabel(normalizedActionId);
  const rawMessage = String(status?.message ?? status?.error ?? "Command updated");
  return Object.freeze({
    actionId: normalizedActionId,
    state,
    label,
    message: activityStatusMessage({ label, state, rawMessage }),
    rawMessage,
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
      className: "admin-action-grid",
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
        const commandPending = status?.state === "pending";
        const visibleStatus = status === null
          ? null
          : Object.freeze({
              ...status,
              message: adminSetupStatusMessage(item, status),
            });
        return Object.freeze({
          ...baseAdminItem(item, "admin-setup"),
          buttonLabel: item.buttonLabel,
          href: item.href ?? null,
          minTouchTargetPx: ADMIN_SURFACE_CONTRACT.minTouchTargetPx,
          commandPending,
          triggerDisabled: commandPending,
          status: visibleStatus,
          protocolStatusMessage: status?.message ?? "",
          statusTestId: `admin-command-status-${item.id}`,
          statusFloorTestId: `admin-command-status-floor-${item.id}`,
          statusFloorMinBlockSizePx:
            ADMIN_SURFACE_CONTRACT.commandStatusFloorMinBlockSizePx,
          actionTileClassName: ADMIN_SURFACE_CONTRACT.actionTileClassName,
          statusFloorClassName: ADMIN_SURFACE_CONTRACT.commandStatusFloorClassName,
          confirmTestId: `admin-command-confirm-${item.id}`,
          cancelTestId: `admin-command-cancel-${item.id}`,
          triggerTestId: `admin-command-trigger-${item.id}`,
          confirmation: adminConfirmationView(item, "admin-command", visibleStatus),
          isSessionGrant: item.commandAction === "grant_session",
          sessionGrant,
        });
      }),
    ),
  });
}

export function buildAdminAuditPanelViewModel({ audit = [] } = {}) {
  const items = Object.freeze(
    audit.map((item) => {
      const state = adminAuditStatusState(item.status);
      return Object.freeze({
        ...item,
        inspectHref: item.inspectHref ?? item.href,
        testId: `admin-audit-${item.id}`,
        linkTestId: `admin-audit-link-${item.id}`,
        boundaryTestId: `admin-audit-boundary-${item.id}`,
        evidenceTestId: `admin-audit-evidence-${item.id}`,
        buttonLabel: state === "ack" ? "View details" : "Review check",
        authority: item.authority ?? "GlobalAdmin or GlobalMod",
        displayAuthority: humanizeCapabilityLabel(
          item.authority ?? "GlobalAdmin or GlobalMod",
        ),
        boundary: item.boundary ?? "Read-only operator proof",
        boundaryDetail:
          item.boundaryDetail ?? "/operator/proof-runs machine-readable report",
        statusView: Object.freeze({
          state,
          message: item.status,
        }),
        statusTestId: `admin-audit-status-${item.id}`,
        minTouchTargetPx: ADMIN_SURFACE_CONTRACT.minTouchTargetPx,
      });
    }),
  );
  const attentionItems = Object.freeze(
    items.filter((item) => item.statusView.state !== "ack"),
  );
  const healthyItems = Object.freeze(
    items.filter((item) => item.statusView.state === "ack"),
  );
  return Object.freeze({
    root: Object.freeze({
      className: "admin-audit-panel",
      ariaLabel: "System checks",
    }),
    items,
    attentionItems,
    healthyItems,
    allCurrentMessage:
      attentionItems.length === 0 ? "No system checks need attention." : null,
    healthyDisclosure: Object.freeze({
      testId: "admin-current-system-checks",
      label: countLabel(healthyItems.length, "current check", "current checks"),
      summary: "Healthy diagnostics are collapsed by default.",
    }),
  });
}

export function buildAdminAuditEvidenceDisclosure({
  rowTestId,
  count = 0,
  expanded = true,
} = {}) {
  const normalizedTestId = String(rowTestId ?? "admin-audit-row");
  const open = expanded !== false;
  const evidenceCount = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  return Object.freeze({
    className: "admin-audit-detail__evidence fm-disclosure",
    toggleClassName: "fm-touch-button fm-touch-button--secondary",
    toggleTestId: `${normalizedTestId}-evidence-toggle`,
    detailTestId: `${normalizedTestId}-evidence`,
    label: open
      ? "Hide evidence"
      : `Review evidence (${evidenceCount})`,
    ariaExpanded: String(open),
    expanded: open,
    minTouchTargetPx: ADMIN_SURFACE_CONTRACT.minTouchTargetPx,
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
    displayValue: adminSetupDisplayValue(item),
    displayConfirmLabel: humanizeAdminMessage(item.confirmLabel),
    displayAuthority: humanizeCapabilityLabel(item.authority),
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

function adminSetupDisplayValue(item) {
  const value = String(item.value ?? "");
  if (item.commandAction === "grant_session") {
    return humanizeAdminMessage(value);
  }
  if (item.commandAction === "add_cohost") {
    return value.startsWith("@") ? value : `@${value}`;
  }
  if (item.commandAction === "navigate") {
    const game = value.match(/^\/g\/([^/]+)\/setup$/)?.[1];
    return game ? `${game} setup` : value || "Open game setup";
  }
  return value;
}

function adminSetupStatusMessage(item, status) {
  const state = String(status?.state ?? "info");
  if (state === "confirm") {
    return humanizeAdminMessage(status?.message ?? item.confirmMessage);
  }
  return activityStatusMessage({
    label: item.label,
    state,
    rawMessage: String(status?.message ?? status?.error ?? "Action updated"),
  });
}

function humanizeAdminMessage(message) {
  if (message === null || message === undefined) {
    return "Continue";
  }
  return String(message)
    .replaceAll("Grant GlobalMod", "Grant community moderator access")
    .replaceAll("GlobalMod for ", "Community moderator for @")
    .replace(/\bto (mod_[A-Za-z0-9_-]+)\b/g, "to @$1")
    .replace(/\bDelegate (cohost_[A-Za-z0-9_-]+)\b/g, "Delegate @$1");
}

function activityStatusMessage({ label, state, rawMessage }) {
  if (state === "pending") {
    return `${label} is in progress.`;
  }
  if (state === "ack") {
    return `${label} completed.`;
  }
  if (state === "reject") {
    return /conflict|stale/i.test(rawMessage)
      ? `${label} needs refreshed information. Reload and try again.`
      : `${label} could not be completed.`;
  }
  return humanizeAdminMessage(rawMessage);
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
    return "No checks available";
  }
  const trusted = audit.filter(
    (item) => adminAuditStatusState(item.status) === "ack",
  ).length;
  return `${trusted} of ${audit.length} checks current`;
}

function adminAuditRollupDetail(audit) {
  if (audit.length === 0) {
    return "System check data is unavailable";
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
    return "System checks are unavailable";
  }
  if (state === "reject") {
    return "A system check needs review";
  }
  if (state === "pending") {
    return "A system check is still running";
  }
  return "System checks are current";
}

function isAdminAuthority(capabilityLabel) {
  return capabilityLabel === "GlobalAdmin" || capabilityLabel === "GlobalMod";
}

function adminCommandActivityLabel(actionId) {
  const label = String(actionId).replaceAll("_", " ").replaceAll("-", " ");
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
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
