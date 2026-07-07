import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ADMIN_COMMAND_ACTIVITY_CONTRACT,
  ADMIN_CONFIRMATION_CONTRACT,
  ADMIN_SURFACE_CONTRACT,
  buildAdminAuditEvidenceDisclosure,
  buildAdminAuditPanelViewModel,
  buildAdminCommandActivityViewModel,
  buildAdminEscalationPanelViewModel,
  buildAdminReadinessStripViewModel,
  buildAdminRecoveryPanelViewModel,
  buildAdminSetupGridViewModel,
} from "./admin-surface-model.mjs";

test("admin readiness strip summarizes authority and operator proof boundaries", () => {
  assert.deepEqual(
    buildAdminReadinessStripViewModel({
      operator: {
        principalUserId: "admin_a",
        capabilityLabel: "GlobalAdmin",
      },
      gameSetup: [
        { id: "create-game", label: "Create game" },
        { id: "session-grants", label: "Session grants" },
      ],
      audit: [
        {
          id: "proof-runs",
          label: "Proof runs",
          status: "Current local report available",
        },
        {
          id: "recovery",
          label: "Recovery queue",
          status: "No destructive action armed",
        },
      ],
      recoveryTasks: [
        { id: "recovery-gate", label: "Recovery go/no-go" },
      ],
    }).items.map((item) => ({
      id: item.id,
      value: item.value,
      detail: item.detail,
      status: item.status,
      testId: item.testId,
      statusTestId: item.statusTestId,
    })),
    [
      {
        id: "authority",
        value: "GlobalAdmin",
        detail: "admin_a",
        status: {
          state: "ack",
          message: "Admin surface authority resolved",
        },
        testId: "admin-readiness-authority",
        statusTestId: "admin-readiness-status-authority",
      },
      {
        id: "setup",
        value: "2 gated actions",
        detail: "Create game, Session grants",
        status: {
          state: "pending",
          message: "Explicit command boundaries staged",
        },
        testId: "admin-readiness-setup",
        statusTestId: "admin-readiness-status-setup",
      },
      {
        id: "audit",
        value: "2/2 proof surfaces current",
        detail: "Proof runs, Recovery queue",
        status: {
          state: "ack",
          message: "Audit proof links are current",
        },
        testId: "admin-readiness-audit",
        statusTestId: "admin-readiness-status-audit",
      },
      {
        id: "recovery",
        value: "1 gated check",
        detail: "Recovery go/no-go",
        status: {
          state: "pending",
          message: "Recovery checks require explicit confirmation",
        },
        testId: "admin-readiness-recovery",
        statusTestId: "admin-readiness-status-recovery",
      },
    ],
  );
});

test("admin readiness strip fails closed when authority or proof data is missing", () => {
  assert.deepEqual(
    buildAdminReadinessStripViewModel({
      operator: {
        principalUserId: "host_h",
        capabilityLabel: "HostOf(midsummer)",
      },
      audit: [
        {
          id: "go-no-go",
          label: "Go/no-go",
          status: "blocked: proof needs review",
        },
      ],
    }).items.map((item) => [item.id, item.status.state, item.value, item.detail]),
    [
      ["authority", "reject", "HostOf(midsummer)", "host_h"],
      ["setup", "reject", "0 gated actions", "None"],
      [
        "audit",
        "reject",
        "0/1 proof surfaces current",
        "Go/no-go: blocked: proof needs review",
      ],
      ["recovery", "reject", "0 gated checks", "None"],
    ],
  );
});

test("admin command activity summarizes recent setup and recovery status", () => {
  const view = buildAdminCommandActivityViewModel({
    commandStatuses: {
      "create-game": {
        state: "reject",
        message: "Reject DuplicateGame: already exists",
      },
      "session-grants": {
        state: "confirm",
        message: "Grant GlobalMod to mod_a",
        confirmationTrace: {
          kind: "confirmation-command-trace",
          confirmationKind: "confirmation-action",
          surface: "admin-setup",
          actionId: "session-grants",
          statusKey: "session-grants",
          dispatchKind: "grant_session",
        },
      },
      "recovery-gate": {
        state: "pending",
        message: "Checking saved proof artifacts",
      },
    },
  });

  assert.equal(view.root.className, ADMIN_COMMAND_ACTIVITY_CONTRACT.rootClassName);
  assert.equal(view.root.data.component, "admin-command-activity");
  assert.equal(view.summary, "3 recent admin command events");
  assert.deepEqual(
    view.items.map((item) => ({
      actionId: item.actionId,
      state: item.state,
      label: item.label,
      message: item.message,
      testId: item.testId,
      statusTestId: item.statusTestId,
      confirmationTrace: item.confirmationTrace,
    })),
    [
      {
        actionId: "recovery-gate",
        state: "pending",
        label: "recovery gate",
        message: "Checking saved proof artifacts",
        testId: "admin-command-activity-recovery-gate",
        statusTestId: "admin-command-activity-status-recovery-gate",
        confirmationTrace: null,
      },
      {
        actionId: "session-grants",
        state: "confirm",
        label: "session grants",
        message: "Grant GlobalMod to mod_a",
        testId: "admin-command-activity-session-grants",
        statusTestId: "admin-command-activity-status-session-grants",
        confirmationTrace: {
          kind: "confirmation-command-trace",
          confirmationKind: "confirmation-action",
          surface: "admin-setup",
          actionId: "session-grants",
          statusKey: "session-grants",
          dispatchKind: "grant_session",
        },
      },
      {
        actionId: "create-game",
        state: "reject",
        label: "create game",
        message: "Reject DuplicateGame: already exists",
        testId: "admin-command-activity-create-game",
        statusTestId: "admin-command-activity-status-create-game",
        confirmationTrace: null,
      },
    ],
  );
});

test("admin command activity has a stable empty state", () => {
  const view = buildAdminCommandActivityViewModel();

  assert.equal(view.summary, "Ready for admin commands");
  assert.equal(view.items.length, 0);
  assert.deepEqual(view.empty, {
    className: ADMIN_COMMAND_ACTIVITY_CONTRACT.emptyClassName,
    testId: "admin-command-activity-empty",
    state: "idle",
    message: "No admin commands in flight.",
  });
});

test("admin setup grid view model binds command status and confirmation metadata", () => {
  const sessionGrant = {
    token: "session-grant-midsummer",
    principalUserId: "mod_a",
    expiresAt: 4102444800,
    globalCapabilities: ["GlobalMod"],
  };
  const view = buildAdminSetupGridViewModel({
    items: [
      {
        id: "session-grants",
        label: "Session grants",
        authority: "GlobalAdmin",
        boundary: "Authenticated session grant",
        boundaryDetail: "/auth/session-grants requires active GlobalAdmin session",
        commandAction: "grant_session",
        buttonLabel: "Review",
        confirmLabel: "Grant GlobalMod",
      },
      {
        id: "cohost",
        label: "Cohost delegation",
        authority: "HostOf(game)",
        boundary: "Command pipeline",
        boundaryDetail: "/commands AddCohost",
        commandAction: "add_cohost",
        buttonLabel: "Review",
      },
    ],
    commandStatuses: {
      "session-grants": {
        state: "confirm",
        message: "Grant GlobalMod to mod_a",
      },
    },
    sessionGrant,
  });

  assert.equal(view.root.ariaLabel, "Game setup");
  assert.equal(ADMIN_SURFACE_CONTRACT.operatorRailClassName, "admin-surface__operator-actions");
  assert.equal(ADMIN_SURFACE_CONTRACT.operatorRailMode, "flow-admin-operator-actions");
  assert.equal(ADMIN_SURFACE_CONTRACT.operatorRailStickyTopPx, 0);
  assert.equal(ADMIN_SURFACE_CONTRACT.operatorRailUnstickBelowPx, 0);
  assert.equal(view.root.data.thumbZone, "admin-setup-actions");
  assert.equal(view.root.data.actionTileStabilityMode, "reserved-status-floor");
  assert.equal(view.root.testId, "admin-setup-action-zone");
  assert.equal(view.items[0].testId, "admin-setup-session-grants");
  assert.equal(view.items[0].boundaryTestId, "admin-boundary-session-grants");
  assert.equal(view.items[0].statusTestId, "admin-command-status-session-grants");
  assert.equal(
    view.items[0].statusFloorTestId,
    "admin-command-status-floor-session-grants",
  );
  assert.equal(view.items[0].statusFloorMinBlockSizePx, 44);
  assert.equal(view.items[0].actionTileClassName, "admin-surface__action-tile");
  assert.equal(
    view.items[0].statusFloorClassName,
    "admin-surface__command-status-floor",
  );
  assert.equal(view.items[0].confirmTestId, "admin-command-confirm-session-grants");
  assert.equal(view.items[0].cancelTestId, "admin-command-cancel-session-grants");
  assert.equal(view.items[0].triggerTestId, "admin-command-trigger-session-grants");
  assert.equal(view.items[0].minTouchTargetPx, 44);
  assert.equal(view.items[0].isSessionGrant, true);
  assert.equal(view.items[0].sessionGrant, sessionGrant);
  assert.deepEqual(view.items[0].status, {
    state: "confirm",
    message: "Grant GlobalMod to mod_a",
  });
  assert.deepEqual(view.items[0].confirmation, {
    kind: "confirmation-action",
    surface: "admin-setup",
    actionId: "session-grants",
    role: ADMIN_CONFIRMATION_CONTRACT.role,
    ariaModal: ADMIN_CONFIRMATION_CONTRACT.ariaModal,
    ariaLabel: "Confirm Session grants",
    label: "Session grants",
    message: "Grant GlobalMod to mod_a",
    messageId: "admin-command-confirmation-message-session-grants",
    messageTestId: "admin-command-confirmation-message-session-grants",
    confirmationTestId: null,
    confirmTestId: "admin-command-confirm-session-grants",
    cancelTestId: "admin-command-cancel-session-grants",
    triggerTestId: "admin-command-trigger-session-grants",
    initialFocusTestId: "admin-command-confirm-session-grants",
    returnFocusTestId: "admin-command-trigger-session-grants",
    escapeCancels: true,
    tabContainment: "local-confirmation-controls",
    className: null,
    actionsClassName: null,
    objectLabel: null,
    outcomeLabel: null,
  });
  assert.equal(view.items[1].isSessionGrant, false);
  assert.equal(view.items[1].status, null);
});

test("admin setup grid treats create-game as an explicit confirmation action", () => {
  const view = buildAdminSetupGridViewModel({
    items: [
      {
        id: "create-game",
        label: "Create game",
        authority: "GlobalAdmin",
        boundary: "Command pipeline",
        boundaryDetail: "/commands CreateGame Ack/Reject",
        commandAction: "create_game",
        buttonLabel: "Review",
        confirmLabel: "Create game",
        confirmMessage: "Create game midsummer from pack mafiascum",
      },
    ],
    commandStatuses: {
      "create-game": {
        state: "confirm",
        message: "Create game midsummer from pack mafiascum",
      },
    },
  });

  assert.equal(view.items[0].buttonLabel, "Review");
  assert.equal(view.items[0].confirmTestId, "admin-command-confirm-create-game");
  assert.equal(view.items[0].cancelTestId, "admin-command-cancel-create-game");
  assert.equal(view.items[0].triggerTestId, "admin-command-trigger-create-game");
  assert.equal(view.items[0].isSessionGrant, false);
  assert.deepEqual(view.items[0].confirmation, {
    kind: "confirmation-action",
    surface: "admin-setup",
    actionId: "create-game",
    role: ADMIN_CONFIRMATION_CONTRACT.role,
    ariaModal: ADMIN_CONFIRMATION_CONTRACT.ariaModal,
    ariaLabel: "Confirm Create game",
    label: "Create game",
    message: "Create game midsummer from pack mafiascum",
    messageId: "admin-command-confirmation-message-create-game",
    messageTestId: "admin-command-confirmation-message-create-game",
    confirmationTestId: null,
    confirmTestId: "admin-command-confirm-create-game",
    cancelTestId: "admin-command-cancel-create-game",
    triggerTestId: "admin-command-trigger-create-game",
    initialFocusTestId: "admin-command-confirm-create-game",
    returnFocusTestId: "admin-command-trigger-create-game",
    escapeCancels: true,
    tabContainment: "local-confirmation-controls",
    className: null,
    actionsClassName: null,
    objectLabel: null,
    outcomeLabel: null,
  });
});

test("admin audit and escalation models expose stable test ids", () => {
  assert.deepEqual(
    buildAdminAuditPanelViewModel({
      audit: [
        {
          id: "proof-runs",
          label: "Proof runs",
          status: "Current local report available",
          authority: "GlobalAdmin",
          boundary: "Machine proof",
          boundaryDetail: "/operator/proof-runs/status",
          href: "/games/midsummer/operator/proof-runs",
          inspectHref: "/admin/audit/proof-runs?game=midsummer",
        },
      ],
    }).items,
    [
      {
        id: "proof-runs",
        label: "Proof runs",
        status: "Current local report available",
        href: "/games/midsummer/operator/proof-runs",
        inspectHref: "/admin/audit/proof-runs?game=midsummer",
        testId: "admin-audit-proof-runs",
        linkTestId: "admin-audit-link-proof-runs",
        boundaryTestId: "admin-audit-boundary-proof-runs",
        evidenceTestId: "admin-audit-evidence-proof-runs",
        buttonLabel: "Inspect",
        authority: "GlobalAdmin",
        boundary: "Machine proof",
        boundaryDetail: "/operator/proof-runs/status",
        statusView: {
          state: "ack",
          message: "Current local report available",
        },
        statusTestId: "admin-audit-status-proof-runs",
        minTouchTargetPx: 44,
      },
    ],
  );

  assert.deepEqual(
    buildAdminAuditPanelViewModel({
      audit: [
        {
          id: "go-no-go",
          label: "Go/no-go",
          status: "blocked: proof needs review",
          href: "/operator/go-no-go",
        },
        {
          id: "queued",
          label: "Queued proof",
          status: "queued",
          href: "/operator/queued",
        },
      ],
    }).items.map((item) => [
      item.id,
      item.statusView.state,
      item.boundaryTestId,
      item.evidenceTestId,
      item.authority,
      item.boundary,
      item.boundaryDetail,
    ]),
    [
      [
        "go-no-go",
        "reject",
        "admin-audit-boundary-go-no-go",
        "admin-audit-evidence-go-no-go",
        "GlobalAdmin or GlobalMod",
        "Read-only operator proof",
        "/operator/proof-runs machine-readable report",
      ],
      [
        "queued",
        "pending",
        "admin-audit-boundary-queued",
        "admin-audit-evidence-queued",
        "GlobalAdmin or GlobalMod",
        "Read-only operator proof",
        "/operator/proof-runs machine-readable report",
      ],
    ],
  );

  assert.deepEqual(
    buildAdminEscalationPanelViewModel({
      escalations: [
        {
          id: "visibility",
          label: "Visibility review",
          value: "Private-channel bytes stay server-filtered",
        },
      ],
    }).items,
    [
      {
        id: "visibility",
        label: "Visibility review",
        value: "Private-channel bytes stay server-filtered",
        testId: "admin-escalation-visibility",
      },
    ],
  );
});

test("admin recovery model binds proof-gate form and status metadata", () => {
  const view = buildAdminRecoveryPanelViewModel({
    tasks: [
      {
        id: "recovery-gate",
        label: "Recovery go/no-go",
        authority: "GlobalAdmin or GlobalMod",
        boundary: "Read-only operator proof",
        boundaryDetail: "/operator/proof-runs/go-no-go",
        buttonLabel: "Check gate",
        confirmLabel: "Run check",
      },
    ],
    commandStatuses: {
      "recovery-gate": {
        state: "confirm",
        message: "Read saved go/no-go proof artifacts for this game",
      },
    },
    game: "midsummer",
    principalUserId: "admin_a",
  });

  assert.equal(view.root.ariaLabel, "Recovery");
  assert.equal(view.root.data.thumbZone, "admin-recovery-actions");
  assert.equal(view.root.data.actionTileStabilityMode, "reserved-status-floor");
  assert.equal(view.root.testId, "admin-recovery-action-zone");
  assert.equal(view.items[0].testId, "admin-recovery-recovery-gate");
  assert.equal(view.items[0].boundaryTestId, "admin-recovery-boundary-recovery-gate");
  assert.equal(view.items[0].statusTestId, "admin-recovery-status-recovery-gate");
  assert.equal(
    view.items[0].statusFloorTestId,
    "admin-recovery-status-floor-recovery-gate",
  );
  assert.equal(view.items[0].statusFloorMinBlockSizePx, 44);
  assert.equal(view.items[0].actionTileClassName, "admin-surface__action-tile");
  assert.equal(
    view.items[0].statusFloorClassName,
    "admin-surface__command-status-floor",
  );
  assert.equal(view.items[0].formTestId, "admin-recovery-form-recovery-gate");
  assert.equal(view.items[0].confirmTestId, "admin-recovery-confirm-recovery-gate");
  assert.equal(view.items[0].cancelTestId, "admin-recovery-cancel-recovery-gate");
  assert.equal(view.items[0].triggerTestId, "admin-recovery-trigger-recovery-gate");
  assert.equal(view.items[0].minTouchTargetPx, 44);
  assert.deepEqual(view.items[0].form, {
    action: "?/checkRecoveryGate",
    game: "midsummer",
    principalUserId: "admin_a",
  });
  assert.deepEqual(view.items[0].status, {
    state: "confirm",
    message: "Read saved go/no-go proof artifacts for this game",
  });
  assert.deepEqual(view.items[0].confirmation, {
    kind: "confirmation-action",
    surface: "admin-recovery",
    actionId: "recovery-gate",
    role: ADMIN_CONFIRMATION_CONTRACT.role,
    ariaModal: ADMIN_CONFIRMATION_CONTRACT.ariaModal,
    ariaLabel: "Confirm Recovery go/no-go",
    label: "Recovery go/no-go",
    message: "Read saved go/no-go proof artifacts for this game",
    messageId: "admin-recovery-confirmation-message-recovery-gate",
    messageTestId: "admin-recovery-confirmation-message-recovery-gate",
    confirmationTestId: null,
    confirmTestId: "admin-recovery-confirm-recovery-gate",
    cancelTestId: "admin-recovery-cancel-recovery-gate",
    triggerTestId: "admin-recovery-trigger-recovery-gate",
    initialFocusTestId: "admin-recovery-confirm-recovery-gate",
    returnFocusTestId: "admin-recovery-trigger-recovery-gate",
    escapeCancels: true,
    tabContainment: "local-confirmation-controls",
    className: null,
    actionsClassName: null,
    objectLabel: null,
    outcomeLabel: null,
  });
});

test("admin audit evidence disclosure defaults to expanded with aria wiring", () => {
  const expanded = buildAdminAuditEvidenceDisclosure({
    rowTestId: "admin-audit-spine-cycle-day-1",
    count: 2,
  });

  assert.equal(expanded.className, "admin-audit-detail__evidence fm-disclosure");
  assert.equal(expanded.toggleClassName, "fm-touch-button fm-touch-button--secondary");
  assert.equal(expanded.toggleTestId, "admin-audit-spine-cycle-day-1-evidence-toggle");
  assert.equal(expanded.detailTestId, "admin-audit-spine-cycle-day-1-evidence");
  assert.equal(expanded.label, "Hide evidence");
  assert.equal(expanded.ariaExpanded, "true");
  assert.equal(expanded.expanded, true);
  assert.equal(expanded.minTouchTargetPx, ADMIN_SURFACE_CONTRACT.minTouchTargetPx);

  const collapsed = buildAdminAuditEvidenceDisclosure({
    rowTestId: "admin-audit-spine-cycle-day-1",
    count: 2,
    expanded: false,
  });
  assert.equal(collapsed.label, "Review evidence (2)");
  assert.equal(collapsed.ariaExpanded, "false");
  assert.equal(collapsed.expanded, false);
});
