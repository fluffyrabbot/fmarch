import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  EXPECTED_COUNTS,
  MODERATOR_CRITICAL_ACTION_IDS,
  MODERATOR_CRITICAL_CONFIRMATION_SCENARIO_IDS,
} from "./frontend_proof_expectations.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  boardScenario,
  forbiddenRoutes,
  hostSetupScenario,
  navFocusCoverage,
  routeStateScenarios,
  roles,
  setupViewports,
  viewports,
} from "./frontend_role_smoke_scenarios.mjs";
import {
  COMMAND_TRACE_CONTRACT,
} from "../frontend/src/lib/app/command-trace-model.mjs";
import {
  APP_SHELL_CONTRACT,
  roleNavTestId,
} from "../frontend/src/lib/app/app-shell-model.mjs";
import {
  APP_ROUTE_STATE_CONTRACT,
} from "../frontend/src/lib/app/app-route-state-model.mjs";
import {
  APP_SURFACE_HEADER_CONTRACT,
} from "../frontend/src/lib/app/app-surface-header-model.mjs";
import {
  COMMAND_DISPATCH_BRIDGE_CONTRACT,
} from "../frontend/src/lib/app/command-dispatch-bridge.mjs";
import {
  CONFIRMATION_ACTION_CONTRACT,
} from "../frontend/src/lib/app/confirmation-action-model.mjs";
import {
  CONFIRMATION_COMMAND_TRACE_CONTRACT,
} from "../frontend/src/lib/app/confirmation-command-trace-model.mjs";
import {
  PLAYER_COMMAND_PANEL_CONTRACT,
} from "../frontend/src/lib/components/player-command/player-command-panel-model.mjs";
import {
  PLAYER_COMMAND_RECEIPT_CONTRACT,
} from "../frontend/src/lib/components/player-command/player-command-receipt-model.mjs";
import {
  PLAYER_THREAD_MEDIA_CONTRACT,
  PLAYER_THREAD_PAGER_CONTRACT,
} from "../frontend/src/lib/components/player-thread/player-thread-model.mjs";
import {
  adminReadinessTestId,
} from "../frontend/src/lib/components/admin/admin-surface-model.mjs";
import {
  HOST_CONTROL_SURFACE_CONTRACT,
} from "../frontend/src/lib/components/host-action/host-control-surface.mjs";
import {
  hostOperationTestId,
} from "../frontend/src/lib/components/host-action/host-operations-strip.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const staticContractPath = path.join(
  repoRoot,
  "target",
  "frontend-static-role-contract",
  "role-contract.json",
);
const roleSmokePath = path.join(
  repoRoot,
  "target",
  "frontend-role-smoke",
  "role-smoke.json",
);
const renderSmokePath = path.join(
  repoRoot,
  "target",
  "frontend-role-render-smoke",
  "render-smoke.json",
);
const importedRoleSmokePath = path.join(
  repoRoot,
  "target",
  "frontend-role-smoke-imported",
  "imported-role-smoke.json",
);
const roleDomSmokePath = path.join(
  repoRoot,
  "target",
  "frontend-role-dom-smoke",
  "dom-smoke.json",
);
const completionAuditPath = path.join(
  repoRoot,
  "target",
  "frontend-completion-audit",
  "completion-audit.json",
);
const readinessSummaryPath = path.join(
  repoRoot,
  "target",
  "frontend-readiness-summary",
  "readiness-summary.json",
);
const routeStateRenderPath = path.join(
  repoRoot,
  "target",
  "frontend-route-state-render",
  "route-state-render.json",
);
const dispatchBridgePath = path.join(
  repoRoot,
  "target",
  "frontend-dispatch-bridge",
  "dispatch-bridge.json",
);
const hydratedHandlersPath = path.join(
  repoRoot,
  "target",
  "frontend-hydrated-handlers",
  "hydrated-handlers.json",
);
const hydratedSurfacesPath = path.join(
  repoRoot,
  "target",
  "frontend-hydrated-surfaces",
  "hydrated-surfaces.json",
);
const componentInteractionsPath = path.join(
  repoRoot,
  "target",
  "frontend-component-interactions",
  "component-interactions.json",
);
const noBindInteractionsPath = path.join(
  repoRoot,
  "target",
  "frontend-no-bind-interactions",
  "no-bind-interactions.json",
);
const staticFocusabilityPath = path.join(
  repoRoot,
  "target",
  "frontend-static-focusability",
  "focusability.json",
);
const tabletInteractionPath = path.join(
  repoRoot,
  "target",
  "frontend-tablet-interaction",
  "tablet-interaction.json",
);
const routeLivePath = path.join(
  repoRoot,
  "target",
  "frontend-route-live-contract",
  "route-live-contract.json",
);
const hostConfirmationStaticDomPath = path.join(
  repoRoot,
  "target",
  "frontend-host-confirmation-static-dom",
  "static-dom.json",
);
// The payload-kind column is bespoke (e.g. extend_deadline_24h drives the
// extend_deadline command), so this table stays local; its action-id column is
// tied to the single source below so a moderator action can't silently drift.
const moderatorCriticalConfirmationActions = Object.freeze([
  ["extend_deadline", "extend_deadline"],
  ["extend_deadline_24h", "extend_deadline"],
  ["extend_deadline_48h", "extend_deadline"],
  ["process_replacement", "process_replacement"],
  ["resolve_phase", "resolve_phase"],
  ["lock_thread", "lock_thread"],
  ["publish_votecount", "publish_votecount"],
  ["mark_dead", "mark_dead"],
  ["modkill_slot", "modkill_slot"],
  ["complete_game", "complete_game"],
  ["resolve_host_prompt-D01-skip_next_day-slot_1", "resolve_host_prompt"],
]);
assert.deepEqual(
  moderatorCriticalConfirmationActions.map(([actionId]) => actionId),
  [...MODERATOR_CRITICAL_ACTION_IDS],
  "moderator confirmation table action ids must track frontend_proof_expectations",
);
const moderatorCriticalConfirmationScenarioIds =
  MODERATOR_CRITICAL_CONFIRMATION_SCENARIO_IDS;
const expectedPlannedStabilityChecks = Object.freeze([
  {
    id: "admin-operator-action-status-floors",
    role: "admin",
    surfaceId: "admin",
    mode: "reserved-status-floor",
    statusFloorMinBlockSizePx: 44,
    tileCount: EXPECTED_COUNTS.adminStabilityFloorTiles,
    tileIds: [
      "admin-setup-create-game",
      "admin-setup-session-grants",
      "admin-setup-cohost",
      "admin-recovery-recovery-gate",
    ],
  },
  {
    id: "moderator-primary-action-status-floors",
    role: "moderator",
    surfaceId: "moderator",
    mode: "reserved-status-floor",
    statusFloorMinBlockSizePx: 44,
    tileCount: EXPECTED_COUNTS.moderatorCriticalActions,
    tileIds: MODERATOR_CRITICAL_ACTION_IDS.map((id) => `moderator-${id}`),
  },
]);
const keyboardTraversalPath = path.join(
  repoRoot,
  "target",
  "frontend-keyboard-traversal",
  "keyboard-traversal.json",
);
const inAppBrowserInteractionManifestPath = path.join(
  repoRoot,
  "target",
  "frontend-in-app-browser-interactions",
  "interaction-page-manifest.json",
);
const inAppBrowserInteractionPagePath = path.join(
  repoRoot,
  "target",
  "frontend-in-app-browser-interactions",
  "interaction-page.html",
);
const inAppBrowserStaticDomPath = path.join(
  repoRoot,
  "target",
  "frontend-in-app-browser-static-dom",
  "static-dom.json",
);
const inAppBrowserRunPath = path.join(
  repoRoot,
  "target",
  "frontend-in-app-browser-interactions",
  "browser-run.json",
);
const inAppBrowserReplayHandoffPath = path.join(
  repoRoot,
  "target",
  "frontend-in-app-browser-interactions",
  "replay-handoff.json",
);
const inAppBrowserImportedRunPath = path.join(
  repoRoot,
  "target",
  "frontend-in-app-browser-imported-run",
  "imported-run.json",
);
const inAppBrowserFixtureBundleManifestPath = path.join(
  repoRoot,
  "target",
  "frontend-in-app-browser-bundle",
  "bundle-manifest.json",
);
const inAppBrowserFixtureBundleArchivePath = path.join(
  repoRoot,
  "target",
  "frontend-in-app-browser-bundle",
  "fixture-replay-bundle.tar",
);
const inAppBrowserFixtureBundleImportPath = path.join(
  repoRoot,
  "target",
  "frontend-in-app-browser-bundle-import",
  "bundle-import.json",
);
const inAppBrowserOperatorRunbookPath = path.join(
  repoRoot,
  "target",
  "frontend-in-app-browser-operator-runbook",
  "runbook.json",
);
const inAppBrowserReplayHelpPath = path.join(
  repoRoot,
  "target",
  "frontend-in-app-browser-replay-help",
  "replay-help.json",
);
const browserAcceptanceBoundaryPath = path.join(
  repoRoot,
  "target",
  "frontend-browser-acceptance-boundary",
  "browser-acceptance-boundary.json",
);

test("static role contract artifact records shared nav focus and route state matrices", async () => {
  const staticContract = await readJsonArtifact(staticContractPath);

  assert.equal(staticContract.status, "passed");
  assert.equal(staticContract.proof, "static-no-bind-role-contract");
  assert.deepEqual(staticContract.viewports, viewports);
  assert.deepEqual(staticContract.appShellContract, {
    component: APP_SHELL_CONTRACT.component,
    navLabel: APP_SHELL_CONTRACT.navLabel,
    skipLinkLabel: APP_SHELL_CONTRACT.skipLinkLabel,
    skipLinkTestId: APP_SHELL_CONTRACT.skipLinkTestId,
    mainTargetId: APP_SHELL_CONTRACT.mainTargetId,
    mainTargetTestId: APP_SHELL_CONTRACT.mainTargetTestId,
    sessionTestId: APP_SHELL_CONTRACT.sessionTestId,
    sessionPrincipalTestId: APP_SHELL_CONTRACT.sessionPrincipalTestId,
    sessionCapabilityTestId: APP_SHELL_CONTRACT.sessionCapabilityTestId,
    sessionGameTestId: APP_SHELL_CONTRACT.sessionGameTestId,
    topbarTestId: APP_SHELL_CONTRACT.topbarTestId,
    topbarMode: APP_SHELL_CONTRACT.topbarMode,
    topbarStickyTopPx: APP_SHELL_CONTRACT.topbarStickyTopPx,
    topbarBlockSizePx: APP_SHELL_CONTRACT.topbarBlockSizePx,
    stickyRailGapPx: APP_SHELL_CONTRACT.stickyRailGapPx,
    surfaceOrder: APP_SHELL_CONTRACT.surfaceOrder,
    navTestIds: APP_SHELL_CONTRACT.surfaceOrder.map((surface) =>
      roleNavTestId(surface),
    ),
    sessionModel: {
      testId: APP_SHELL_CONTRACT.sessionTestId,
      principalTestId: APP_SHELL_CONTRACT.sessionPrincipalTestId,
      capabilityTestId: APP_SHELL_CONTRACT.sessionCapabilityTestId,
      gameTestId: APP_SHELL_CONTRACT.sessionGameTestId,
      state: "signed-in",
      principalLabel: "player_mira",
      gameLabel: "midsummer",
      capabilityCount: 1,
      capabilityKinds: ["SlotOccupant"],
      capabilitySummary: "SlotOccupant",
    },
    minTouchTargetPx: APP_SHELL_CONTRACT.minTouchTargetPx,
    responsiveColumns: "4/1",
    deniedNavVisibleInert: true,
    deniedNavVisibleReason: true,
  });
  assert.deepEqual(staticContract.surfaceHeaderContract, {
    component: APP_SURFACE_HEADER_CONTRACT.component,
    defaultClassName: APP_SURFACE_HEADER_CONTRACT.defaultClassName,
    capabilityClassName: APP_SURFACE_HEADER_CONTRACT.capabilityClassName,
    liveStatusClassName: APP_SURFACE_HEADER_CONTRACT.liveStatusClassName,
    statusStackClassName: APP_SURFACE_HEADER_CONTRACT.statusStackClassName,
    minTouchTargetPx: APP_SURFACE_HEADER_CONTRACT.minTouchTargetPx,
  });
  assert.deepEqual(staticContract.board.surfaceHeader, {
    component: APP_SURFACE_HEADER_CONTRACT.component,
    surface: "board",
    eyebrow: "Board",
    title: "Games",
    summary: "Public active and completed games.",
    capabilityTestId: null,
    capabilityMinTouchTargetPx: null,
    liveStatusTestId: null,
  });
  assert.deepEqual(
    staticContract.roles.map((role) => [
      role.id,
      role.surfaceHeader.component,
      role.surfaceHeader.capabilityMinTouchTargetPx,
      role.surfaceHeader.liveStatusTestId,
      role.auditDetailSurfaceHeader?.capabilityTestId ?? null,
    ]),
    [
      [
        "admin",
        APP_SURFACE_HEADER_CONTRACT.component,
        44,
        null,
        "admin-audit-detail-capability",
      ],
      [
        "player",
        APP_SURFACE_HEADER_CONTRACT.component,
        44,
        "player-live-status",
        null,
      ],
      [
        "moderator",
        APP_SURFACE_HEADER_CONTRACT.component,
        44,
        "host-live-status",
        null,
      ],
    ],
  );
  assert.deepEqual(
    staticContract.surfaceHeaderCoverage.entries.map((entry) => [
      entry.id,
      entry.title,
      entry.capabilityTestId,
      entry.capabilityMinTouchTargetPx,
      entry.liveStatusTestId,
    ]),
    [
      ["board", "Games", null, null, null],
      ["admin", "Operations", "admin-capability", 44, null],
      [
        "admin-audit-detail",
        "Proof runs",
        "admin-audit-detail-capability",
        44,
        null,
      ],
      ["player", "Day 2", "player-capability", 44, "player-live-status"],
      [
        "moderator",
        "Host console",
        "host-console-capability",
        44,
        "host-live-status",
      ],
    ],
  );
  assert.deepEqual(staticContract.confirmationShellContract, {
    boundary:
      "Static source contract proves admin and moderator confirmations use the shared ConfirmationShell wrapper for alertdialog, aria, test-id, and focus-contract attributes. Browser smoke is still required to prove runtime focus behavior.",
    component: "ConfirmationShell",
    element: "svelte:element",
    shellOwnedAttributes: [
      "role",
      "aria-modal",
      "aria-label",
      "aria-describedby",
      "data-initial-focus-testid",
      "data-return-focus-testid",
      "data-escape-cancels",
      "data-tab-containment",
      "data-testid",
    ],
    surfaces: [
      {
        id: "admin-setup",
        shellUsages: 2,
        rawAttributesAbsent: [
          "data-initial-focus-testid=",
          "data-return-focus-testid=",
          "data-escape-cancels=",
          "data-tab-containment=",
          "aria-modal=",
          "aria-describedby=",
        ],
      },
      {
        id: "admin-recovery",
        shellUsages: 1,
        rawAttributesAbsent: [
          "data-initial-focus-testid=",
          "data-return-focus-testid=",
          "data-escape-cancels=",
          "data-tab-containment=",
          "aria-modal=",
          "aria-describedby=",
        ],
      },
      {
        id: "host-action",
        shellUsages: 1,
        rawAttributesAbsent: [
          "data-initial-focus-testid=",
          "data-return-focus-testid=",
          "data-escape-cancels=",
          "data-tab-containment=",
          "aria-modal=",
          "aria-describedby=",
        ],
      },
    ],
  });
  assert.deepEqual(staticContract.confirmationActionContract, {
    boundary:
      "Static model contract proves admin and moderator confirmations are shaped by the shared confirmation action model before the ConfirmationShell renders them. Browser smoke is still required to prove runtime focus traversal and pointer behavior.",
    model: "confirmation-action-model",
    kind: CONFIRMATION_ACTION_CONTRACT.kind,
    role: CONFIRMATION_ACTION_CONTRACT.role,
    ariaModal: CONFIRMATION_ACTION_CONTRACT.ariaModal,
    focusContract: {
      initialFocus: CONFIRMATION_ACTION_CONTRACT.initialFocus,
      returnFocus: CONFIRMATION_ACTION_CONTRACT.returnFocus,
      escapeCancels: CONFIRMATION_ACTION_CONTRACT.escapeCancels,
    },
    surfaces: [
      {
        surface: "admin-setup",
        actionId: "session-grants",
        messageId: "admin-command-confirmation-message-session-grants",
        confirmTestId: "admin-command-confirm-session-grants",
        cancelTestId: "admin-command-cancel-session-grants",
        triggerTestId: "admin-command-trigger-session-grants",
        tabContainment: "local-confirmation-controls",
      },
      {
        surface: "admin-recovery",
        actionId: "recovery-gate",
        messageId: "admin-recovery-confirmation-message-recovery-gate",
        confirmTestId: "admin-recovery-confirm-recovery-gate",
        cancelTestId: "admin-recovery-cancel-recovery-gate",
        triggerTestId: "admin-recovery-trigger-recovery-gate",
        tabContainment: "local-confirmation-controls",
      },
      {
        surface: "moderator-host",
        actionId: "modkill-slot",
        messageId: "host-action-confirmation-message-modkill-slot",
        confirmTestId: "critical-host-action-confirm",
        cancelTestId: "critical-host-action-cancel",
        triggerTestId: "critical-host-action-trigger",
        tabContainment: "confirm-cancel",
      },
    ],
  });
  assert.deepEqual(staticContract.confirmationCommandTraceContract, {
    boundary:
      "Static model contract proves admin and moderator command activity rows carry shared confirmation-command traces that bind confirmation action ids to command status keys. Browser smoke is still required to prove hydrated confirm-to-dispatch interaction.",
    model: "confirmation-command-trace-model",
    kind: CONFIRMATION_COMMAND_TRACE_CONTRACT.kind,
    confirmationKind: CONFIRMATION_COMMAND_TRACE_CONTRACT.confirmationKind,
    surfaces: [
      {
        surface: "admin-recovery",
        actionId: "recovery-gate",
        statusKey: "recovery-gate",
        dispatchKind: "check_recovery_gate",
      },
      {
        surface: "admin-setup",
        actionId: "session-grants",
        statusKey: "session-grants",
        dispatchKind: "grant_session",
      },
      {
        surface: "moderator-host",
        actionId: "extend_deadline",
        statusKey: "extend_deadline",
        dispatchKind: "extend_deadline",
      },
    ],
  });
  assert.deepEqual(staticContract.commandTraceContract, {
    boundary:
      "Static model contract proves player command receipt rows carry shared command traces that bind action ids to status keys, dispatch kinds, and projection refresh keys. Browser smoke is still required to prove hydrated click-to-dispatch interaction.",
    model: "command-trace-model",
    kind: COMMAND_TRACE_CONTRACT.kind,
    surfaces: [
      {
        surface: "player",
        actionId: "submit_vote",
        statusKey: "submit_vote",
        dispatchKind: "submit_vote",
        projectionRefreshKeys: ["votecount", "commandState"],
      },
      {
        surface: "player",
        actionId: "submit_post",
        statusKey: "submit_post",
        dispatchKind: "submit_post",
        projectionRefreshKeys: ["thread", "votecount", "commandState", "dayVoteOutcomes"],
      },
    ],
  });
  assert.deepEqual(staticContract.navFocusCoverage.surfaces, navFocusCoverage.surfaces);
  assert.deepEqual(staticContract.linkAffordanceCoverage.roles, [
    {
      role: "admin",
      path: "/admin",
      links: [
        {
          testId: "admin-audit-link-proof-runs",
          hrefPath: "/admin/audit/proof-runs",
          searchParams: {
            game: "midsummer",
          },
        },
      ],
    },
  ]);
  assert.deepEqual(
    staticContract.routeStateCoverage.surfaces.map((surface) => surface.surface),
    APP_ROUTE_STATE_CONTRACT.surfaces,
  );
  for (const surface of staticContract.routeStateCoverage.surfaces) {
    assert.deepEqual(
      surface.states.map((state) => state.state),
      APP_ROUTE_STATE_CONTRACT.states,
    );
  }
  assert.deepEqual(
    staticContract.routeStateFixtureCoverage.scenarios.map((scenario) => [
      scenario.role,
      scenario.state,
      scenario.path,
      scenario.focus,
    ]),
    routeStateScenarios.map((scenario) => [
      scenario.role,
      scenario.state,
      scenario.path,
      scenario.focus,
    ]),
  );
  assert.deepEqual(
    staticContract.firstViewportSmokeCoverage.roles.map((role) => role.role),
    roles.map((role) => role.id),
  );
  assert.deepEqual(staticContract.firstViewportLayoutContract.css, {
    rootClassName: "fm-status-strip",
    itemClassName: "fm-status-strip__item",
    desktopColumns: 4,
    tabletColumns: "adaptive 200px minimum",
    mobileColumns: 1,
    tabletBreakpointPx: 1180,
    mobileBreakpointPx: 840,
    minBlockSizePx: 136,
    tabletMinBlockSizePx: 112,
    minInlineSizeZero: true,
    overflowWrapAnywhere: true,
  });
  assert.deepEqual(
    staticContract.firstViewportLayoutContract.roles.map((role) => [
      role.role,
      role.path,
      role.surface,
      role.itemCount,
      role.itemIds,
      role.viewportColumns.map((viewport) => [
        viewport.name,
        viewport.width,
        viewport.expectedColumns,
      ]),
    ]),
    [
      [
        "admin",
        "/admin",
        "readiness",
        4,
        ["authority", "setup", "audit", "recovery"],
        [
          ["tablet", 1024, "adaptive"],
          ["tablet-wide", 1180, "adaptive"],
          ["tablet-landscape", 1280, 4],
          ["desktop", 1440, 4],
        ],
      ],
      [
        "player",
        "/g/midsummer",
        "posture",
        3,
        ["phase", "deadline", "private"],
        [
          ["tablet", 1024, "adaptive"],
          ["tablet-wide", 1180, "adaptive"],
          ["tablet-landscape", 1280, 4],
          ["desktop", 1440, 4],
        ],
      ],
      [
        "moderator",
        "/g/midsummer/host",
        "operations",
        4,
        ["phase", "votecount", "prompts", "lifecycle"],
        [
          ["tablet", 1024, "adaptive"],
          ["tablet-wide", 1180, "adaptive"],
          ["tablet-landscape", 1280, 4],
          ["desktop", 1440, 4],
        ],
      ],
    ],
  );
  for (const role of staticContract.firstViewportLayoutContract.roles) {
    assert.equal(role.items.length, role.itemCount);
    assert.equal(role.items.length >= 3, true);
    for (const item of role.items) {
      assert.equal(item.labelLength <= 24, true);
      assert.equal(item.valueLength <= 80, true);
      assert.equal(item.detailLength <= 140, true);
      assert.equal(item.statusMessageLength <= 96, true);
    }
  }
  const adminStaticRole = staticContract.roles.find((role) => role.id === "admin");
  assert.deepEqual(adminStaticRole.surfaces.audit[0], {
    id: "proof-runs",
    statusState: "ack",
    statusTestId: "admin-audit-status-proof-runs",
    linkTestId: "admin-audit-link-proof-runs",
    href: "/games/midsummer/operator/proof-runs?principal_user_id=admin_a",
    inspectHref: "/admin/audit/proof-runs?game=midsummer",
    boundaryTestId: "admin-audit-boundary-proof-runs",
    evidenceTestId: "admin-audit-evidence-proof-runs",
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Read-only operator proof",
  });
  assert.deepEqual(adminStaticRole.commandActivity, {
    component: "admin-command-activity",
    summary: "4 recent admin command events",
    itemTestIds: [
      "admin-command-activity-recovery-gate",
      "admin-command-activity-cohost",
      "admin-command-activity-session-grants",
      "admin-command-activity-create-game",
    ],
    confirmationTraces: [
      {
        actionId: "recovery-gate",
        statusTestId: "admin-command-activity-status-recovery-gate",
        trace: {
          kind: CONFIRMATION_COMMAND_TRACE_CONTRACT.kind,
          confirmationKind: CONFIRMATION_COMMAND_TRACE_CONTRACT.confirmationKind,
          surface: "admin-recovery",
          actionId: "recovery-gate",
          statusKey: "recovery-gate",
          dispatchKind: "check_recovery_gate",
        },
      },
      {
        actionId: "cohost",
        statusTestId: "admin-command-activity-status-cohost",
        trace: {
          kind: CONFIRMATION_COMMAND_TRACE_CONTRACT.kind,
          confirmationKind: CONFIRMATION_COMMAND_TRACE_CONTRACT.confirmationKind,
          surface: "admin-setup",
          actionId: "cohost",
          statusKey: "cohost",
          dispatchKind: "add_cohost",
        },
      },
      {
        actionId: "session-grants",
        statusTestId: "admin-command-activity-status-session-grants",
        trace: {
          kind: CONFIRMATION_COMMAND_TRACE_CONTRACT.kind,
          confirmationKind: CONFIRMATION_COMMAND_TRACE_CONTRACT.confirmationKind,
          surface: "admin-setup",
          actionId: "session-grants",
          statusKey: "session-grants",
          dispatchKind: "grant_session",
        },
      },
      {
        actionId: "create-game",
        statusTestId: "admin-command-activity-status-create-game",
        trace: {
          kind: CONFIRMATION_COMMAND_TRACE_CONTRACT.kind,
          confirmationKind: CONFIRMATION_COMMAND_TRACE_CONTRACT.confirmationKind,
          surface: "admin-setup",
          actionId: "create-game",
          statusKey: "create-game",
          dispatchKind: "create_game",
        },
      },
    ],
  });
  const playerStaticRole = staticContract.roles.find((role) => role.id === "player");
  assert.equal(
    playerStaticRole.commandRailStabilityMode,
    "primary-controls-before-live-receipts",
  );
  assert.deepEqual(playerStaticRole.commandChannelContext, {
    testId: PLAYER_COMMAND_PANEL_CONTRACT.channelContextTestId,
    channelId: "main",
    channelLabel: "Main thread",
    capabilityLabel: "SlotOccupant or ChannelMember(main)",
    slotId: "slot-7",
    actorAlive: "unknown",
    actorStatus: "",
    label: "Posting target",
    value: "Main thread as slot-7",
    audienceLabel: "Everyone at the table reads this",
  });
  assert.deepEqual(playerStaticRole.commandReceipt, {
    component: "player-command-receipt",
    summary: "1 recent player command receipt",
    itemTestIds: ["player-command-receipt-submit_vote"],
    currentStatusTestId: PLAYER_COMMAND_RECEIPT_CONTRACT.currentStatusTestId,
    commandTraces: [
      {
        actionId: "submit_vote",
        statusTestId: "player-command-status",
        trace: {
          kind: COMMAND_TRACE_CONTRACT.kind,
          surface: "player",
          actionId: "submit_vote",
          statusKey: "submit_vote",
          dispatchKind: "submit_vote",
          projectionRefreshKeys: ["votecount", "commandState"],
        },
      },
    ],
  });
  assert.deepEqual(playerStaticRole.media, {
    component: PLAYER_THREAD_MEDIA_CONTRACT.component,
    preferredVariants: PLAYER_THREAD_MEDIA_CONTRACT.preferredVariants,
    forbiddenVariants: PLAYER_THREAD_MEDIA_CONTRACT.forbiddenVariants,
    fixtureIncludesOriginalVariant: false,
    renderedVariant: "tablet",
    renderedSrc: "/media/midsummer/thread/receipt-442-tablet.png",
    renderedSrcset:
      "/media/midsummer/thread/receipt-442-small.png 480w, /media/midsummer/thread/receipt-442-tablet.png 960w",
    originalUrlRendered: false,
    originalOnlyWithheld: true,
  });
  assert.deepEqual(playerStaticRole.threadPager, {
    component: PLAYER_THREAD_PAGER_CONTRACT.component,
    rootTestId: PLAYER_THREAD_PAGER_CONTRACT.rootTestId,
    state: "ready",
    busy: "false",
    cursorTestId: PLAYER_THREAD_PAGER_CONTRACT.cursorTestId,
    cursorLabel: "Older before #441",
    buttonTestId: PLAYER_THREAD_PAGER_CONTRACT.buttonTestId,
    buttonLabel: "Load older",
    buttonDisabled: false,
    buttonDisabledReason: null,
    minTouchTargetPx: PLAYER_THREAD_PAGER_CONTRACT.minTouchTargetPx,
    nextBeforeSeq: 441,
  });
  const moderatorStaticRole = staticContract.roles.find(
    (role) => role.id === "moderator",
  );
  assert.deepEqual(moderatorStaticRole.commandActivity, {
    component: "host-command-activity",
    summary: "2 recent host command events",
    itemTestIds: [
      "host-command-activity-extend_deadline",
      "host-command-activity-advance_phase",
    ],
    confirmationTraces: [
      {
        actionId: "extend_deadline",
        statusTestId: "host-command-activity-status-extend_deadline",
        trace: {
          kind: CONFIRMATION_COMMAND_TRACE_CONTRACT.kind,
          confirmationKind: CONFIRMATION_COMMAND_TRACE_CONTRACT.confirmationKind,
          surface: "moderator-host",
          actionId: "extend_deadline",
          statusKey: "extend_deadline",
          dispatchKind: "extend_deadline",
        },
      },
      {
        actionId: "advance_phase",
        statusTestId: "host-command-activity-status-advance_phase",
        trace: null,
      },
    ],
  });
  assert.deepEqual(moderatorStaticRole.commandContext, {
    testId: HOST_CONTROL_SURFACE_CONTRACT.commandContextTestId,
    label: "Command authority",
    value: "HostOf(midsummer) as host_h",
    gameId: "midsummer",
    principalUserId: "host_h",
    capabilityLabel: "HostOf(midsummer)",
    commandEndpoint: "/commands",
  });
  assert.deepEqual(
    staticContract.confirmationCoverage.admin.setup.map((item) => [
      item.id,
      item.confirmationRole,
      item.ariaModal,
      item.commandAction,
      item.statusState,
      item.triggerTestId,
      item.confirmTestId,
      item.cancelTestId,
      item.initialFocusTestId,
      item.returnFocusTestId,
      item.escapeCancels,
      item.tabContainment,
      item.minTouchTargetPx,
    ]),
    [
      [
        "create-game",
        "alertdialog",
        "true",
        "create_game",
        "confirm",
        "admin-command-trigger-create-game",
        "admin-command-confirm-create-game",
        "admin-command-cancel-create-game",
        "admin-command-confirm-create-game",
        "admin-command-trigger-create-game",
        true,
        "local-confirmation-controls",
        44,
      ],
      [
        "session-grants",
        "alertdialog",
        "true",
        "grant_session",
        "confirm",
        "admin-command-trigger-session-grants",
        "admin-command-confirm-session-grants",
        "admin-command-cancel-session-grants",
        "admin-command-confirm-session-grants",
        "admin-command-trigger-session-grants",
        true,
        "local-confirmation-controls",
        44,
      ],
      [
        "cohost",
        "alertdialog",
        "true",
        "add_cohost",
        "confirm",
        "admin-command-trigger-cohost",
        "admin-command-confirm-cohost",
        "admin-command-cancel-cohost",
        "admin-command-confirm-cohost",
        "admin-command-trigger-cohost",
        true,
        "local-confirmation-controls",
        44,
      ],
    ],
  );
  assert.deepEqual(
    staticContract.confirmationCoverage.admin.recovery.map((item) => [
      item.id,
      item.confirmationRole,
      item.ariaModal,
      item.action,
      item.statusState,
      item.triggerTestId,
      item.confirmTestId,
      item.cancelTestId,
      item.initialFocusTestId,
      item.returnFocusTestId,
      item.escapeCancels,
      item.tabContainment,
      item.formAction,
      item.minTouchTargetPx,
    ]),
    [
      [
        "recovery-gate",
        "alertdialog",
        "true",
        "check_recovery_gate",
        "confirm",
        "admin-recovery-trigger-recovery-gate",
        "admin-recovery-confirm-recovery-gate",
        "admin-recovery-cancel-recovery-gate",
        "admin-recovery-confirm-recovery-gate",
        "admin-recovery-trigger-recovery-gate",
        true,
        "local-confirmation-controls",
        "?/checkRecoveryGate",
        44,
      ],
    ],
  );
  assert.deepEqual(
    staticContract.confirmationCoverage.moderator.actions
      .filter((action) => !action.id.startsWith("resolve_host_prompt-"))
      .map((action) => [
        action.id,
        action.payloadKind,
        action.confirmationRole,
        action.ariaModal,
        action.confirmationTestId,
        action.confirmTestId,
        action.cancelTestId,
        action.initialFocusTestId,
        action.returnFocusTestId,
        action.escapeCancels,
        action.tabContainment,
        action.triggerDanger,
      ]),
    [
      [
        "extend_deadline",
        "extend_deadline",
        "alertdialog",
        "true",
        "critical-host-action-confirmation",
        "critical-host-action-confirm",
        "critical-host-action-cancel",
        "critical-host-action-confirm",
        "critical-host-action-trigger",
        true,
        "confirm-cancel",
        "true",
      ],
      [
        "extend_deadline_24h",
        "extend_deadline",
        "alertdialog",
        "true",
        "critical-host-action-confirmation",
        "critical-host-action-confirm",
        "critical-host-action-cancel",
        "critical-host-action-confirm",
        "critical-host-action-trigger",
        true,
        "confirm-cancel",
        "false",
      ],
      [
        "extend_deadline_48h",
        "extend_deadline",
        "alertdialog",
        "true",
        "critical-host-action-confirmation",
        "critical-host-action-confirm",
        "critical-host-action-cancel",
        "critical-host-action-confirm",
        "critical-host-action-trigger",
        true,
        "confirm-cancel",
        "false",
      ],
      [
        "process_replacement",
        "process_replacement",
        "alertdialog",
        "true",
        "critical-host-action-confirmation",
        "critical-host-action-confirm",
        "critical-host-action-cancel",
        "critical-host-action-confirm",
        "critical-host-action-trigger",
        true,
        "confirm-cancel",
        "true",
      ],
      [
        "resolve_phase",
        "resolve_phase",
        "alertdialog",
        "true",
        "critical-host-action-confirmation",
        "critical-host-action-confirm",
        "critical-host-action-cancel",
        "critical-host-action-confirm",
        "critical-host-action-trigger",
        true,
        "confirm-cancel",
        "true",
      ],
      [
        "lock_thread",
        "lock_thread",
        "alertdialog",
        "true",
        "critical-host-action-confirmation",
        "critical-host-action-confirm",
        "critical-host-action-cancel",
        "critical-host-action-confirm",
        "critical-host-action-trigger",
        true,
        "confirm-cancel",
        "false",
      ],
      [
        "publish_votecount",
        "publish_votecount",
        "alertdialog",
        "true",
        "critical-host-action-confirmation",
        "critical-host-action-confirm",
        "critical-host-action-cancel",
        "critical-host-action-confirm",
        "critical-host-action-trigger",
        true,
        "confirm-cancel",
        "false",
      ],
      [
        "mark_dead",
        "mark_dead",
        "alertdialog",
        "true",
        "critical-host-action-confirmation",
        "critical-host-action-confirm",
        "critical-host-action-cancel",
        "critical-host-action-confirm",
        "critical-host-action-trigger",
        true,
        "confirm-cancel",
        "true",
      ],
      [
        "modkill_slot",
        "modkill_slot",
        "alertdialog",
        "true",
        "critical-host-action-confirmation",
        "critical-host-action-confirm",
        "critical-host-action-cancel",
        "critical-host-action-confirm",
        "critical-host-action-trigger",
        true,
        "confirm-cancel",
        "true",
      ],
      [
        "complete_game",
        "complete_game",
        "alertdialog",
        "true",
        "critical-host-action-confirmation",
        "critical-host-action-confirm",
        "critical-host-action-cancel",
        "critical-host-action-confirm",
        "critical-host-action-trigger",
        true,
        "confirm-cancel",
        "true",
      ],
    ],
  );
  assert.equal(
    staticContract.confirmationCoverage.moderator.actions.some((action) =>
      action.id.startsWith("resolve_host_prompt-"),
    ),
    true,
  );
  const moderatorCommandPath = staticContract.commandPaths.find(
    (path) => path.role === "moderator",
  );
  assert.deepEqual(moderatorCommandPath.hostPrompt, {
    action: "resolve_host_prompt-D01-skip_next_day-slot_1",
    state: "ack",
    message: "Ack: host prompt resolved",
    promptProjectionApplied: 1,
    remainingPromptActions: 0,
    hydratedRefreshApplied: 1,
    hydratedRemainingPromptActions: 0,
  });
});

test("route-state render artifact covers every forced board and role page state", async () => {
  const routeStateRender = await readJsonArtifact(routeStateRenderPath);

  assert.equal(routeStateRender.status, "passed");
  assert.equal(routeStateRender.proof, "svelte-ssr-route-state-render");
  assert.equal(
    routeStateRender.boundary,
    "Build-mode Svelte SSR renders the board, admin, player, player private-channel, and moderator pages with fixture route-state data, including the native admin audit detail route, the shared route-loading component, the root navigation-pending layer, and the real SvelteKit error page with session-aware shell context. This proves page/component wiring and live-region/error markup without opening localhost; Chromium pixel, pointer, and focus traversal proof is still required.",
  );
  assert.deepEqual(routeStateRender.appShellContract, {
    component: APP_SHELL_CONTRACT.component,
    navLabel: APP_SHELL_CONTRACT.navLabel,
    skipLinkLabel: APP_SHELL_CONTRACT.skipLinkLabel,
    skipLinkTestId: APP_SHELL_CONTRACT.skipLinkTestId,
    mainTargetId: APP_SHELL_CONTRACT.mainTargetId,
    mainTargetTestId: APP_SHELL_CONTRACT.mainTargetTestId,
    sessionTestId: APP_SHELL_CONTRACT.sessionTestId,
    sessionPrincipalTestId: APP_SHELL_CONTRACT.sessionPrincipalTestId,
    sessionCapabilityTestId: APP_SHELL_CONTRACT.sessionCapabilityTestId,
    sessionGameTestId: APP_SHELL_CONTRACT.sessionGameTestId,
    topbarTestId: APP_SHELL_CONTRACT.topbarTestId,
    topbarMode: APP_SHELL_CONTRACT.topbarMode,
    topbarStickyTopPx: APP_SHELL_CONTRACT.topbarStickyTopPx,
    topbarBlockSizePx: APP_SHELL_CONTRACT.topbarBlockSizePx,
    stickyRailGapPx: APP_SHELL_CONTRACT.stickyRailGapPx,
    surfaceOrder: APP_SHELL_CONTRACT.surfaceOrder,
    navTestIds: APP_SHELL_CONTRACT.surfaceOrder.map((surface) =>
      roleNavTestId(surface),
    ),
    minTouchTargetPx: APP_SHELL_CONTRACT.minTouchTargetPx,
  });
  assert.deepEqual(
    routeStateRender.scenarios.map((scenario) => [
      scenario.role,
      scenario.state,
      scenario.path,
      scenario.rootTestId,
      scenario.statusTestId,
      scenario.actionTestId,
      scenario.statusState,
      scenario.ariaLive,
    ]),
    routeStateScenarios.map((scenario) => [
      scenario.role,
      scenario.state,
      scenario.path,
      scenario.rootTestId,
      scenario.statusTestId,
      scenario.actionTestId,
      scenario.statusState,
      scenario.ariaLive,
    ]),
  );
  assert.equal(
    routeStateRender.scenarios.every((scenario) => scenario.htmlBytes > 0),
    true,
  );
  assert.equal(
    routeStateRender.shellNavCoverage.boundary,
    "Build-mode Svelte SSR proves the app shell rendered the same role navigation matrix as the shared fixture smoke scenarios for board, admin, player, moderator, and every route-state page. Browser focus traversal and pointer behavior remain covered by their own lanes.",
  );
  assert.deepEqual(
    routeStateRender.shellNavCoverage.surfaces.map(shellNavCoverageSummary),
    [
      shellNavCoverageExpected({
        id: boardScenario.id,
        render: "renderBoardPlayerSurface",
        navigation: boardScenario.nav,
      }),
      ...roles.map((role) =>
        shellNavCoverageExpected({
          id: role.id,
          render: renderFunctionForRole(role.id),
          navigation: role.nav,
        }),
      ),
    ],
  );
  assert.deepEqual(
    routeStateRender.shellNavCoverage.routeStates.map(shellNavCoverageSummary),
    routeStateScenarios.map((scenario) =>
      shellNavCoverageExpected({
        id: scenario.id,
        render: "renderScenario",
        navigation: scenario.nav,
      }),
    ),
  );
  for (const entry of [
    ...routeStateRender.shellNavCoverage.surfaces,
    ...routeStateRender.shellNavCoverage.routeStates,
  ]) {
    assert.equal(entry.htmlBytes > 0, true);
    assert.equal(entry.navItems.length, APP_SHELL_CONTRACT.surfaceOrder.length);
    assert.equal(
      entry.navItems.every((item) => item.expected === item.rendered),
      true,
    );
  }
  assert.equal(routeStateRender.singleRootShell.status, "passed");
  assert.equal(routeStateRender.singleRootShell.proof, "single-root-app-shell");
  assert.deepEqual(
    routeStateRender.singleRootShell.surfaces,
    [
      { id: boardScenario.id, render: "renderBoardPlayerSurface", shellComponentCount: 1 },
      ...roles.map((role) => ({
        id: role.id,
        render: renderFunctionForRole(role.id),
        shellComponentCount: 1,
      })),
    ],
  );
  assert.deepEqual(
    routeStateRender.singleRootShell.routeStates,
    routeStateScenarios.map((scenario) => ({
      id: scenario.id,
      render: "renderScenario",
      shellComponentCount: 1,
    })),
  );
  assert.deepEqual(routeStateRender.playerSurface, {
    role: "player",
    path: "/g/midsummer",
    surfaceTestId: "player-surface",
    deadlineTestId: PLAYER_COMMAND_PANEL_CONTRACT.deadlineTestId,
    deadlineValue: "Jun 19, 2026, 9:00 PM",
    deadlineState: "open",
    deadlineProjected: true,
    commandReceiptTestId: "player-command-receipt",
    commandReceiptEmptyTestId: "player-command-receipt-empty",
    commandReceiptCurrentStatusTestId:
      PLAYER_COMMAND_RECEIPT_CONTRACT.currentStatusTestId,
    commandChannelContext: {
      testId: PLAYER_COMMAND_PANEL_CONTRACT.channelContextTestId,
      channelId: "main",
      channelLabel: "Main thread",
      capabilityLabel: "SlotOccupant or ChannelMember(main)",
      actorSlot: "slot-7",
    },
    threadPager: {
      component: PLAYER_THREAD_PAGER_CONTRACT.component,
      rootTestId: PLAYER_THREAD_PAGER_CONTRACT.rootTestId,
      state: "ready",
      busy: "false",
      cursorTestId: PLAYER_THREAD_PAGER_CONTRACT.cursorTestId,
      cursorLabel: "Older before #441",
      buttonTestId: PLAYER_THREAD_PAGER_CONTRACT.buttonTestId,
      buttonLabel: "Load older",
      buttonDisabled: false,
      buttonDisabledReason: null,
      minTouchTargetPx: PLAYER_THREAD_PAGER_CONTRACT.minTouchTargetPx,
      nextBeforeSeq: 441,
    },
    primaryControlsBeforeReceipts: true,
    media: {
      component: PLAYER_THREAD_MEDIA_CONTRACT.component,
      renderedTestId: `thread-post-media-${"e".repeat(64)}`,
      renderedVariant: "tablet",
      renderedSrc: "/media/midsummer/thread/receipt-442-tablet.png",
      originalUrlRendered: false,
      preferredVariants: PLAYER_THREAD_MEDIA_CONTRACT.preferredVariants,
      forbiddenVariants: PLAYER_THREAD_MEDIA_CONTRACT.forbiddenVariants,
    },
    htmlBytes: routeStateRender.playerSurface.htmlBytes,
  });
  assert.equal(routeStateRender.playerSurface.htmlBytes > 0, true);
  assert.deepEqual(routeStateRender.playerThreadPagerStates, {
    boundary:
      "Build-mode Svelte SSR renders player thread pager disabled states with visible button reasons for pending duplicate-load prevention and complete oldest-page state. This proves the touch control does not rely on hidden title text; browser focus and pointer behavior remain covered by browser lanes.",
    states: [
      {
        state: "pending",
        label: "Loading older",
        reason: "Loading older posts",
        busy: "true",
        buttonTestId: PLAYER_THREAD_PAGER_CONTRACT.buttonTestId,
        htmlBytes: routeStateRender.playerThreadPagerStates.states[0].htmlBytes,
      },
      {
        state: "complete",
        label: "No older posts",
        reason: "At oldest loaded post",
        busy: "false",
        buttonTestId: PLAYER_THREAD_PAGER_CONTRACT.buttonTestId,
        htmlBytes: routeStateRender.playerThreadPagerStates.states[1].htmlBytes,
      },
    ],
  });
  assert.equal(
    routeStateRender.playerThreadPagerStates.states.every(
      (state) => state.htmlBytes > 0,
    ),
    true,
  );
  assert.deepEqual(routeStateRender.playerPrivateReviewRoute, {
    role: "player",
    path: "/g/midsummer?private=notification-1",
    surfaceTestId: "player-surface",
    reviewTestId: "player-private-review-notification-1",
    reviewLinkTestId: "player-private-link-notification-1",
    reviewHref: "/g/midsummer?private=notification-1",
    reviewLinkLabel: "Open Commuted review",
    detailTestId: "player-private-detail-notification-1",
    ariaExpanded: "true",
    detailRendered: true,
    hostOnlyCopyExcluded: true,
    htmlBytes: routeStateRender.playerPrivateReviewRoute.htmlBytes,
  });
  assert.equal(routeStateRender.playerPrivateReviewRoute.htmlBytes > 0, true);
  assert.deepEqual(routeStateRender.playerPrivateChannelRoute, {
    role: "player",
    path: "/g/midsummer/c/private%3Arole_pm%3Aslot-7",
    channel: "private:role_pm:slot-7",
    surfaceTestId: "player-surface",
    activeChannelTestId: "player-channel-private:role_pm:slot-7",
    activeChannelHref: "/g/midsummer/c/private%3Arole_pm%3Aslot-7",
    commandChannelContext: {
      testId: PLAYER_COMMAND_PANEL_CONTRACT.channelContextTestId,
      channelId: "private:role_pm:slot-7",
      channelLabel: "Role PM",
      capabilityLabel: "ChannelMember(private:role_pm:slot-7)",
      actorSlot: "slot-7",
    },
    privateReviewLinkTestId: "player-private-link-notification-1",
    privateReviewHref: "/g/midsummer/c/private%3Arole_pm%3Aslot-7?private=notification-1",
    privateReviewLinkLabel: "Open Commuted review",
    privateBoundaryStatus: "principal-scoped-private-projections",
    mediaVariant: "tablet",
    hostOnlyCopyExcluded: true,
    htmlBytes: routeStateRender.playerPrivateChannelRoute.htmlBytes,
  });
  assert.equal(routeStateRender.playerPrivateChannelRoute.htmlBytes > 0, true);
  assert.deepEqual(routeStateRender.errorSurface, {
    role: "player",
    path: "/g/midsummer/c/private%3Arole_pm%3Aslot-7",
    status: 403,
    surface: "player",
    surfaceTestId: "route-error-surface",
    panelTestId: "route-error-panel",
    actionTestId: "route-error-action",
    actionHref: "/",
    activeNavTestId: roleNavTestId("player"),
    sessionPrincipal: "player_mira",
    capabilitySummary: "ChannelMember + SlotOccupant",
    message: "Channel private:role_pm:slot-7 is not visible.",
    htmlBytes: routeStateRender.errorSurface.htmlBytes,
  });
  assert.equal(routeStateRender.errorSurface.htmlBytes > 0, true);
  assert.deepEqual(routeStateRender.loadingSurface, {
    role: "player",
    path: "/g/midsummer/c/private%3Arole_pm%3Aslot-7",
    surface: "player",
    surfaceTestId: "route-loading-surface",
    routeStateTestId: "route-state-player-loading",
    statusTestId: "route-state-status-player-loading",
    actionTestId: "route-state-action-player-loading",
    activeNavTestId: roleNavTestId("player"),
    sessionPrincipal: "player_mira",
    capabilitySummary: "ChannelMember + SlotOccupant",
    htmlBytes: routeStateRender.loadingSurface.htmlBytes,
  });
  assert.equal(routeStateRender.loadingSurface.htmlBytes > 0, true);
  assert.deepEqual(routeStateRender.navigationPending, {
    path: "/g/midsummer/c/private%3Arole_pm%3Aslot-7",
    surface: "player",
    rootTestId: "app-navigation-pending",
    statusTestId: "app-navigation-pending-status",
    activeNavTestId: roleNavTestId("player"),
    sessionPrincipal: "player_mira",
    capabilitySummary: "ChannelMember + SlotOccupant",
    hiddenHtmlBytes: routeStateRender.navigationPending.hiddenHtmlBytes,
    htmlBytes: routeStateRender.navigationPending.htmlBytes,
  });
  assert.equal(routeStateRender.navigationPending.hiddenHtmlBytes >= 0, true);
  assert.equal(routeStateRender.navigationPending.htmlBytes > 0, true);
  assert.deepEqual(routeStateRender.adminSurface, {
    role: "admin",
    path: "/admin",
    surfaceTestId: "admin-surface",
    readinessTestIds: ["authority", "setup", "audit", "recovery"].map((id) =>
      adminReadinessTestId(id),
    ),
    setupTestId: "admin-setup-create-game",
    auditLinkTestId: "admin-audit-link-proof-runs",
    auditInspectHref: "/admin/audit/proof-runs?game=midsummer",
    auditBoundaryTestId: "admin-audit-boundary-proof-runs",
    auditEvidenceTestId: "admin-audit-evidence-proof-runs",
    recoveryTestId: "admin-recovery-recovery-gate",
    commandActivityTestId: "admin-command-activity",
    commandActivityEmptyTestId: "admin-command-activity-empty",
    htmlBytes: routeStateRender.adminSurface.htmlBytes,
  });
  assert.equal(routeStateRender.adminSurface.htmlBytes > 0, true);
  assert.deepEqual(routeStateRender.adminAuditDetailSurface, {
    role: "admin",
    path: "/admin/audit/proof-runs?game=midsummer",
    surfaceTestId: "admin-audit-detail-surface",
    auditId: "proof-runs",
    capabilityTestId: "admin-audit-detail-capability",
    statusTestId: "admin-audit-detail-status",
    statusState: "ack",
    evidenceTestId: "admin-audit-detail-evidence",
    evidenceHref: "/games/midsummer/operator/proof-runs?principal_user_id=admin_a",
    backTestId: "admin-audit-detail-back",
    backHref: "/admin?game=midsummer",
    htmlBytes: routeStateRender.adminAuditDetailSurface.htmlBytes,
  });
  assert.equal(routeStateRender.adminAuditDetailSurface.htmlBytes > 0, true);
  assert.deepEqual(routeStateRender.moderatorSurface, {
    role: "moderator",
    path: "/g/midsummer/host",
    surfaceTestId: "host-console-surface",
    operationTestIds: ["phase", "votecount", "prompts", "lifecycle"].map((id) =>
      hostOperationTestId(id),
    ),
    criticalActionTestIds: [
      "critical-host-action-extend_deadline",
      "critical-host-action-resolve_phase",
      "critical-host-action-lock_thread",
      "critical-host-action-publish_votecount",
      "critical-host-action-process_replacement",
      "critical-host-action-mark_dead",
      "critical-host-action-modkill_slot",
      "critical-host-action-complete_game",
      "critical-host-action-resolve_host_prompt-D01-skip_next_day-slot_1",
    ],
    hostPromptControlTestId: "moderator-control-host-prompts",
    hostPromptActionTestId:
      "critical-host-action-resolve_host_prompt-D01-skip_next_day-slot_1",
    commandContext: {
      testId: HOST_CONTROL_SURFACE_CONTRACT.commandContextTestId,
      gameId: "midsummer",
      principalUserId: "host_h",
      capabilityLabel: "HostOf(midsummer)",
      commandEndpoint: "/commands",
    },
    commandActivityTestId: "host-command-activity",
    commandActivityEmptyTestId: "host-command-activity-empty",
    htmlBytes: routeStateRender.moderatorSurface.htmlBytes,
  });
  assert.equal(routeStateRender.moderatorSurface.htmlBytes > 0, true);
  assert.deepEqual(routeStateRender.feedbackRailMarkup.admin, {
    role: "admin",
    render: "renderAdminCommandActivity",
    component: "admin-command-activity",
    testId: "admin-command-activity",
    itemTestId: "admin-command-activity-recovery-gate",
    statusTestId: "admin-command-activity-status-recovery-gate",
    statusState: "ack",
    confirmationTrace: {
      kind: "confirmation-command-trace",
      surface: "admin-recovery",
      actionId: "recovery-gate",
      statusKey: "recovery-gate",
      dispatchKind: "check_recovery_gate",
    },
    htmlBytes: routeStateRender.feedbackRailMarkup.admin.htmlBytes,
  });
  assert.deepEqual(routeStateRender.feedbackRailMarkup.player, {
    role: "player",
    render: "renderPlayerCommandReceipt",
    component: "player-command-receipt",
    testId: "player-command-receipt",
    itemTestId: "player-command-receipt-submit_vote",
    statusTestId: PLAYER_COMMAND_RECEIPT_CONTRACT.currentStatusTestId,
    statusState: "reject",
    commandTrace: {
      kind: "command-trace",
      surface: "player",
      actionId: "submit_vote",
      statusKey: "submit_vote",
      dispatchKind: "submit_vote",
      refreshKeys: "votecount,commandState",
    },
    htmlBytes: routeStateRender.feedbackRailMarkup.player.htmlBytes,
  });
  assert.deepEqual(routeStateRender.feedbackRailMarkup.moderator, {
    role: "moderator",
    render: "renderModeratorCommandActivity",
    component: "host-command-activity",
    testId: "host-command-activity",
    itemTestId: "host-command-activity-resolve_host_prompt-D01-skip_next_day-slot_1",
    statusTestId:
      "host-command-activity-status-resolve_host_prompt-D01-skip_next_day-slot_1",
    statusState: "ack",
    confirmationTrace: {
      kind: "confirmation-command-trace",
      surface: "moderator-host",
      actionId: "resolve_host_prompt-D01-skip_next_day-slot_1",
      statusKey: "resolve_host_prompt-D01-skip_next_day-slot_1",
      dispatchKind: "resolve_host_prompt",
    },
    htmlBytes: routeStateRender.feedbackRailMarkup.moderator.htmlBytes,
  });
  assert.equal(routeStateRender.feedbackRailMarkup.admin.htmlBytes > 0, true);
  assert.equal(routeStateRender.feedbackRailMarkup.player.htmlBytes > 0, true);
  assert.equal(routeStateRender.feedbackRailMarkup.moderator.htmlBytes > 0, true);
  assert.deepEqual(routeStateRender.playerPrivateDisclosure, {
    boundary:
      "Build-mode Svelte SSR renders player private queue disclosure markup in collapsed and expanded states. This proves principal-scoped disclosure attributes and host-copy exclusion, not hydrated click/focus behavior.",
    collapsed: {
      reviewTestId: "player-private-review-notification-1",
      reviewLinkTestId: "player-private-link-notification-1",
      reviewHref: "/g/midsummer?private=notification-1",
      reviewLinkLabel: "Open Commuted review",
      detailTestId: "player-private-detail-notification-1",
      ariaExpanded: "false",
      detailRendered: false,
      htmlBytes: routeStateRender.playerPrivateDisclosure.collapsed.htmlBytes,
    },
    expanded: {
      reviewTestId: "player-private-review-notification-1",
      reviewLinkTestId: "player-private-link-notification-1",
      reviewHref: "/g/midsummer?private=notification-1",
      reviewLinkLabel: "Open Commuted review",
      detailTestId: "player-private-detail-notification-1",
      ariaExpanded: "true",
      detailRendered: true,
      htmlBytes: routeStateRender.playerPrivateDisclosure.expanded.htmlBytes,
    },
    hostOnlyCopyExcluded: true,
  });
  assert.equal(routeStateRender.playerPrivateDisclosure.collapsed.htmlBytes > 0, true);
  assert.equal(routeStateRender.playerPrivateDisclosure.expanded.htmlBytes > 0, true);
  assert.deepEqual(routeStateRender.confirmationMarkup.adminSetup, {
    role: "admin",
    surface: "setup",
    confirmTestIds: [
      "admin-command-confirm-session-grants",
      "admin-command-confirm-cohost",
    ],
    cancelTestIds: [
      "admin-command-cancel-session-grants",
      "admin-command-cancel-cohost",
    ],
    messageTestIds: [
      "admin-command-confirmation-message-session-grants",
      "admin-command-confirmation-message-cohost",
    ],
    formFieldTestIds: [
      "admin-session-grant-token",
      "admin-session-grant-principal",
      "admin-session-grant-expires-at",
      "admin-session-grant-global-mod",
    ],
    focusContracts: [
      {
        initialFocusTestId: "admin-command-confirm-session-grants",
        returnFocusTestId: "admin-command-trigger-session-grants",
        escapeCancels: true,
        tabContainment: "local-confirmation-controls",
      },
      {
        initialFocusTestId: "admin-command-confirm-cohost",
        returnFocusTestId: "admin-command-trigger-cohost",
        escapeCancels: true,
        tabContainment: "local-confirmation-controls",
      },
    ],
    htmlBytes: routeStateRender.confirmationMarkup.adminSetup.htmlBytes,
  });
  assert.equal(routeStateRender.confirmationMarkup.adminSetup.htmlBytes > 0, true);
  assert.deepEqual(routeStateRender.confirmationMarkup.adminRecovery, {
    role: "admin",
    surface: "recovery",
    confirmTestIds: ["admin-recovery-confirm-recovery-gate"],
    cancelTestIds: ["admin-recovery-cancel-recovery-gate"],
    messageTestIds: ["admin-recovery-confirmation-message-recovery-gate"],
    focusContracts: [
      {
        initialFocusTestId: "admin-recovery-confirm-recovery-gate",
        returnFocusTestId: "admin-recovery-trigger-recovery-gate",
        escapeCancels: true,
        tabContainment: "local-confirmation-controls",
      },
    ],
    htmlBytes: routeStateRender.confirmationMarkup.adminRecovery.htmlBytes,
  });
  assert.equal(routeStateRender.confirmationMarkup.adminRecovery.htmlBytes > 0, true);
  assert.deepEqual(routeStateRender.confirmationMarkup.moderator, {
    role: "moderator",
    actionId: "extend_deadline",
    confirmTestIds: ["critical-host-action-confirm"],
    cancelTestIds: ["critical-host-action-cancel"],
    messageTestIds: ["critical-host-action-confirmation-message"],
    focusContracts: [
      {
        initialFocusTestId: "critical-host-action-confirm",
        returnFocusTestId: "critical-host-action-trigger",
        escapeCancels: true,
        tabContainment: "confirm-cancel",
      },
    ],
    htmlBytes: routeStateRender.confirmationMarkup.moderator.htmlBytes,
  });
  assert.equal(routeStateRender.confirmationMarkup.moderator.htmlBytes > 0, true);
  assert.deepEqual(routeStateRender.confirmationMarkup.moderatorHostPrompt, {
    role: "moderator",
    actionId: "resolve_host_prompt-D01-skip_next_day-slot_1",
    confirmTestIds: ["critical-host-action-confirm"],
    cancelTestIds: ["critical-host-action-cancel"],
    messageTestIds: ["critical-host-action-confirmation-message"],
    focusContracts: [
      {
        initialFocusTestId: "critical-host-action-confirm",
        returnFocusTestId: "critical-host-action-trigger",
        escapeCancels: true,
        tabContainment: "confirm-cancel",
      },
    ],
    htmlBytes: routeStateRender.confirmationMarkup.moderatorHostPrompt.htmlBytes,
  });
  assert.equal(
    routeStateRender.confirmationMarkup.moderatorHostPrompt.htmlBytes > 0,
    true,
  );
  assert.deepEqual(routeStateRender.confirmationMarkup.moderatorSlotLifecycle, {
    role: "moderator",
    actionId: "modkill_slot",
    confirmTestIds: ["critical-host-action-confirm"],
    cancelTestIds: ["critical-host-action-cancel"],
    messageTestIds: ["critical-host-action-confirmation-message"],
    focusContracts: [
      {
        initialFocusTestId: "critical-host-action-confirm",
        returnFocusTestId: "critical-host-action-trigger",
        escapeCancels: true,
        tabContainment: "confirm-cancel",
      },
    ],
    htmlBytes:
      routeStateRender.confirmationMarkup.moderatorSlotLifecycle.htmlBytes,
  });
  assert.equal(
    routeStateRender.confirmationMarkup.moderatorSlotLifecycle.htmlBytes > 0,
    true,
  );
});

test("dispatch bridge artifact maps trace metadata into typed command lifecycles", async () => {
  const dispatchBridge = await readJsonArtifact(dispatchBridgePath);

  assert.equal(dispatchBridge.status, "passed");
  assert.equal(dispatchBridge.proof, COMMAND_DISPATCH_BRIDGE_CONTRACT.proof);
  assert.equal(dispatchBridge.boundary, COMMAND_DISPATCH_BRIDGE_CONTRACT.boundary);
  assert.deepEqual(Object.keys(dispatchBridge.rolePlans), [
    "admin",
    "player",
    "moderator",
    "host-setup",
  ]);
  assert.deepEqual(dispatchBridge.rolePlans.admin, {
    role: "admin",
    boundary: COMMAND_DISPATCH_BRIDGE_CONTRACT.boundary,
    trace: {
      kind: "confirmation-command-trace",
      surface: "admin-setup",
      actionId: "cohost",
      statusKey: "cohost",
      dispatchKind: "add_cohost",
    },
    commandKind: "AddCohost",
    commandEndpoint: "/commands",
    principalUserId: "admin_a",
    optimisticState: "pending",
    finalState: "ack",
    projectionRefreshKeys: [],
    exposureKey: "__fmarchAdminCommandDispatchBridgePlan",
    statusKey: "cohost",
    ackStatus: {
      state: "ack",
      message: "Ack: stream seqs 61",
    },
    rejectStatus: {
      state: "reject",
      message: "Reject Unauthorized: cohost scope missing",
    },
  });
  assert.equal(dispatchBridge.rolePlans.player.commandKind, "SubmitVote");
  assert.equal(dispatchBridge.rolePlans.player.trace.kind, "command-trace");
  assert.equal(dispatchBridge.rolePlans.player.trace.actionId, "submit_vote");
  assert.equal(dispatchBridge.rolePlans.player.trace.dispatchKind, "submit_vote");
  assert.deepEqual(dispatchBridge.rolePlans.player.projectionRefreshKeys, [
    "votecount",
  ]);
  assert.deepEqual(
    dispatchBridge.rolePlans.player.ackPath.optimisticReceipt.state,
    "pending",
  );
  assert.equal(dispatchBridge.rolePlans.player.ackPath.finalReceipt.state, "ack");
  assert.deepEqual(dispatchBridge.rolePlans.player.ackPath.refreshed, [
    ["votecount"],
  ]);
  assert.equal(
    dispatchBridge.rolePlans.player.rejectPath.finalReceipt.state,
    "reject",
  );
  assert.deepEqual(dispatchBridge.rolePlans.player.rejectPath.refreshed, []);
  assert.equal(dispatchBridge.rolePlans.player.postPath.commandKind, "SubmitPost");
  assert.equal(dispatchBridge.rolePlans.player.postPath.finalReceipt.state, "ack");
  assert.deepEqual(dispatchBridge.rolePlans.player.postPath.refreshed, [
    ["thread", "votecount", "dayVoteOutcomes"],
  ]);
  assert.equal(dispatchBridge.rolePlans.moderator.commandKind, "ResolveHostPrompt");
  assert.equal(
    dispatchBridge.rolePlans.moderator.trace.actionId,
    "resolve_host_prompt-D01-skip_next_day-slot_1",
  );
  assert.equal(
    dispatchBridge.rolePlans.moderator.trace.dispatchKind,
    "resolve_host_prompt",
  );
  assert.deepEqual(dispatchBridge.rolePlans.moderator.projectionRefreshKeys, [
    "hostPrompts",
  ]);
  assert.equal(dispatchBridge.rolePlans.moderator.dispatchedCount, 1);
  assert.equal(dispatchBridge.rolePlans.moderator.commandOutcomeCount, 1);
  assert.equal(dispatchBridge.rolePlans.moderator.ackStatus.state, "ack");
  assert.equal(dispatchBridge.rolePlans.moderator.rejectStatus.state, "reject");
  assert.equal(dispatchBridge.rolePlans["host-setup"].role, "host-setup");
  assert.equal(dispatchBridge.rolePlans["host-setup"].commandKind, "StartGame");
  assert.deepEqual(dispatchBridge.rolePlans["host-setup"].projectionRefreshKeys, [
    "setupState",
  ]);
  assert.equal(
    dispatchBridge.rolePlans.moderator.slotLifecyclePath.commandKind,
    "SetSlotStatus",
  );
  assert.equal(
    dispatchBridge.rolePlans.moderator.slotLifecyclePath.trace.actionId,
    "modkill_slot",
  );
  assert.equal(
    dispatchBridge.rolePlans.moderator.slotLifecyclePath.trace.dispatchKind,
    "modkill_slot",
  );
  assert.deepEqual(
    dispatchBridge.rolePlans.moderator.slotLifecyclePath.requestCommand,
    {
      SetSlotStatus: {
        game: "midsummer",
        slot: "slot-7",
        status: "modkilled",
      },
    },
  );
  assert.deepEqual(
    dispatchBridge.rolePlans.moderator.slotLifecyclePath.projectionRefreshKeys,
    [],
  );
  assert.deepEqual(
    dispatchBridge.rolePlans.moderator.slotLifecyclePath.refreshed,
    [],
  );
  assert.equal(
    dispatchBridge.rolePlans.moderator.slotLifecyclePath.dispatchedCount,
    1,
  );
  assert.equal(
    dispatchBridge.rolePlans.moderator.slotLifecyclePath.commandOutcomeCount,
    1,
  );
  assert.equal(
    dispatchBridge.rolePlans.moderator.slotLifecyclePath.ackStatus.state,
    "ack",
  );
  assert.deepEqual(dispatchBridge.routeHandlerOwnership, {
    boundary:
      "Static source ownership proof that each Svelte route handler calls its role-owned dispatch bridge helper and exposes the resulting plan for smoke evidence. This does not prove browser event delivery.",
    routes: [
      {
        role: "admin",
        path: "frontend/src/routes/admin/+page.svelte",
        requiredSnippets: [
          "buildAdminCommandDispatchBridgePlan",
          "exposeAdminCommandDispatchBridgePlan",
          "exposeAdminFormResult",
          "confirmationStatus",
          "optimisticStatus",
        ],
        exposureKey: "__fmarchAdminCommandDispatchBridgePlan",
      },
      {
        role: "player",
        path: "frontend/src/routes/g/[game]/+page.svelte",
        requiredSnippets: [
          "buildPlayerCommandDispatchBridgePlan",
          "exposePlayerCommandDispatchBridgePlan",
          "optimisticStatus",
          "finalStatus: commandStatus",
        ],
        exposureKey: "__fmarchPlayerCommandDispatchBridgePlan",
      },
      {
        role: "moderator",
        path: "frontend/src/routes/g/[game]/host/+page.svelte",
        requiredSnippets: [
          "buildHostCommandDispatchBridgePlan",
          "exposeHostCommandDispatchBridgePlan",
          "optimisticStatus",
          "finalStatus: tracedOutcome",
        ],
        exposureKey: "__fmarchHostCommandDispatchBridgePlan",
      },
      {
        role: "host-setup",
        path: "frontend/src/routes/g/[game]/setup/+page.svelte",
        requiredSnippets: [
          "buildSetupCommandDispatchBridgePlan",
          "exposeSetupRouteWindowState",
          "confirmationStatus",
          "optimisticStatus",
        ],
        exposureKey: "__fmarchHostSetupCommandDispatchBridgePlan",
      },
    ],
  });
});

test("hydrated handler artifact records DOM-facing command outcomes without localhost", async () => {
  const hydratedHandlers = await readJsonArtifact(hydratedHandlersPath);

  assert.equal(hydratedHandlers.status, "passed");
  assert.equal(hydratedHandlers.proof, "frontend-hydrated-handler-contract");
  assert.equal(
    hydratedHandlers.boundary,
    "No-localhost command handler harness. It executes the same controller and browser-bridge functions used by hydrated admin, player, and moderator route handlers, then verifies DOM-facing view models and smoke-exposed bridge plans. It does not prove browser pointer events, Svelte hydration scheduling, focus traversal, pixels, TCP transport, or WebSocket delivery.",
  );
  assert.deepEqual(hydratedHandlers.roles.admin, {
    component: "admin-command-activity",
    actionId: "cohost",
    commandKind: "AddCohost",
    exposureKey: "__fmarchAdminCommandDispatchBridgePlan",
    ack: {
      actionId: "cohost",
      state: "ack",
      message: "Ack: stream seqs 61",
      testId: "admin-command-activity-cohost",
      statusTestId: "admin-command-activity-status-cohost",
    },
    reject: {
      actionId: "cohost",
      state: "reject",
      message: "Reject Unauthorized: cohost scope missing",
      testId: "admin-command-activity-cohost",
      statusTestId: "admin-command-activity-status-cohost",
    },
    forms: {
      sessionGrant: {
        actionId: "session-grants",
        state: "ack",
        message: "Granted GlobalMod to mod_a",
        testId: "admin-command-activity-session-grants",
        statusTestId: "admin-command-activity-status-session-grants",
      },
      recoveryGate: {
        actionId: "recovery-gate",
        state: "ack",
        message: "Recovery gate trusted: 3/3 production artifacts trusted",
        testId: "admin-command-activity-recovery-gate",
        statusTestId: "admin-command-activity-status-recovery-gate",
      },
      exposureKeys: [
        "__fmarchAdminFormResults",
        "__fmarchAdminSessionGrantResult",
        "__fmarchAdminRecoveryGateResult",
      ],
    },
  });
  assert.deepEqual(hydratedHandlers.roles.player, {
    component: "player-command-receipt",
    exposureKey: "__fmarchPlayerCommandDispatchBridgePlan",
    commands: {
      vote: {
        actionId: "submit_vote",
        commandKind: "SubmitVote",
        ack: {
          actionId: "submit_vote",
          state: "ack",
          message: "Ack: stream seqs 71",
          testId: "player-command-receipt-submit_vote",
          statusTestId: "player-command-status",
        },
        reject: {
          actionId: "submit_vote",
          state: "reject",
          message: "Reject PhaseLocked: reload and retry",
          testId: "player-command-receipt-submit_vote",
          statusTestId: "player-command-status",
        },
        ackRefreshKeys: ["votecount"],
        rejectRefreshKeys: [],
      },
      post: {
        actionId: "submit_post",
        commandKind: "SubmitPost",
        ack: {
          actionId: "submit_post",
          state: "ack",
          message: "Ack: stream seqs 72",
          testId: "player-command-receipt-submit_post",
          statusTestId: "player-command-status",
        },
        ackRefreshKeys: ["thread", "votecount", "dayVoteOutcomes"],
        channelId: "private:role_pm:slot-7",
      },
    },
  });
  assert.deepEqual(hydratedHandlers.roles.moderator, {
    component: "host-command-activity",
    exposureKey: "__fmarchHostCommandDispatchBridgePlan",
    commands: {
      hostPrompt: {
        actionId: "resolve_host_prompt-D01-skip_next_day-slot_1",
        commandKind: "ResolveHostPrompt",
        ack: {
          actionId: "resolve_host_prompt-D01-skip_next_day-slot_1",
          state: "ack",
          message: "Ack",
          testId:
            "host-command-activity-resolve_host_prompt-D01-skip_next_day-slot_1",
          statusTestId:
            "host-command-activity-status-resolve_host_prompt-D01-skip_next_day-slot_1",
        },
        reject: {
          actionId: "resolve_host_prompt-D01-skip_next_day-slot_1",
          state: "reject",
          message: "Reject PhaseLocked: prompt already resolved",
          testId:
            "host-command-activity-resolve_host_prompt-D01-skip_next_day-slot_1",
          statusTestId:
            "host-command-activity-status-resolve_host_prompt-D01-skip_next_day-slot_1",
        },
        ackRefreshKeys: ["hostPrompts"],
        rejectRefreshKeys: [
          ["host", "votecount", "dayVoteOutcomes", "hostPrompts"],
        ],
      },
      slotLifecycle: {
        actionId: "modkill_slot",
        commandKind: "SetSlotStatus",
        ack: {
          actionId: "modkill_slot",
          state: "ack",
          message: "Ack: stream seqs 73",
          testId: "host-command-activity-modkill_slot",
          statusTestId: "host-command-activity-status-modkill_slot",
        },
        ackRefreshKeys: [],
        requestCommand: {
          SetSlotStatus: {
            game: "midsummer",
            slot: "slot-7",
            status: "modkilled",
          },
        },
        projection: {
          lifecycleLabel: "Modkilled",
          historyLabel: "Slot history remains attached to slot-7",
        },
      },
    },
  });
});

test("hydrated surface artifact records route-backed surface adapters without localhost", async () => {
  const hydratedSurfaces = await readJsonArtifact(hydratedSurfacesPath);

  assert.equal(hydratedSurfaces.status, "passed");
  assert.equal(hydratedSurfaces.proof, "frontend-hydrated-surface-contract");
  assert.equal(
    hydratedSurfaces.boundary,
    "No-localhost hydrated-surface adapter contract. It executes real route data, shared surface headers, native audit navigation, player private disclosure, and representative admin/player/moderator command adapter flows through the same controller and browser-bridge functions used by hydrated Svelte pages. It does not prove Svelte client scheduling, DOM event delivery, focus traversal, CSS geometry, screenshots, TCP transport, or WebSocket delivery.",
  );
  assert.deepEqual(
    hydratedSurfaces.sharedShell.surfaces.map((surface) => [
      surface.id,
      surface.headerTitle,
      surface.capabilityTestId,
      surface.liveStatusTestId,
    ]),
    [
      ["board", "Games", null, null],
      ["admin", "Operations", "admin-capability", null],
      ["admin-audit-detail", "Proof runs", "admin-audit-detail-capability", null],
      ["player", "Day 2", "player-capability", "player-live-status"],
      ["moderator", "Host console", "host-console-capability", "host-live-status"],
    ],
  );
  assert.deepEqual(hydratedSurfaces.admin.auditNavigation, {
    listHref: "/admin/audit/proof-runs?game=midsummer",
    detailTitle: "Proof runs",
    evidenceHref: "/games/midsummer/operator/proof-runs?principal_user_id=admin_a",
    overviewHref: "/admin?game=midsummer",
  });
  assert.deepEqual(hydratedSurfaces.admin.forms, {
    sessionGrant: {
      actionId: "session-grants",
      exposureKey: "__fmarchAdminSessionGrantResult",
      visible: {
        actionId: "session-grants",
        state: "ack",
        message: "Granted GlobalMod to mod_a",
        testId: "admin-command-activity-session-grants",
        statusTestId: "admin-command-activity-status-session-grants",
      },
    },
    recoveryGate: {
      actionId: "recovery-gate",
      exposureKey: "__fmarchAdminRecoveryGateResult",
      visible: {
        actionId: "recovery-gate",
        state: "ack",
        message: "Recovery gate trusted: 3/3 production artifacts trusted",
        testId: "admin-command-activity-recovery-gate",
        statusTestId: "admin-command-activity-status-recovery-gate",
      },
    },
  });
  assert.deepEqual(
    [
      hydratedSurfaces.admin.command.commandKind,
      hydratedSurfaces.admin.command.visible.state,
      hydratedSurfaces.player.command.commandKind,
      hydratedSurfaces.player.command.visible.state,
      hydratedSurfaces.player.postCommand.commandKind,
      hydratedSurfaces.player.postCommand.visible.state,
      hydratedSurfaces.moderator.command.commandKind,
      hydratedSurfaces.moderator.command.visible.state,
      hydratedSurfaces.moderator.slotLifecycleCommand.commandKind,
      hydratedSurfaces.moderator.slotLifecycleCommand.visible.state,
    ],
    [
      "AddCohost",
      "ack",
      "SubmitVote",
      "ack",
      "SubmitPost",
      "ack",
      "ResolveHostPrompt",
      "ack",
      "SetSlotStatus",
      "ack",
    ],
  );
  assert.deepEqual(hydratedSurfaces.player.postCommand.refreshed, [
    "thread",
    "votecount",
    "commandState",
    "dayVoteOutcomes",
  ]);
  assert.deepEqual(hydratedSurfaces.player.privateDisclosure, {
    itemId: "notification-1",
    before: "false",
    after: "true",
    reviewHref: "/g/midsummer?private=notification-1",
    hostOnlyCopyPresent: false,
  });
  assert.deepEqual(hydratedSurfaces.player.threadPager.pending, {
    status: {
      state: "pending",
      message: "Loading older posts",
    },
    rootState: "pending",
    busy: "true",
    buttonLabel: "Loading older",
    buttonDisabled: true,
    buttonDisabledReason: "Loading older posts",
    ariaDisabled: "true",
    minTouchTargetPx: 44,
    nextBeforeSeq: 441,
  });
  assert.deepEqual(hydratedSurfaces.player.threadPager.ack.status, {
    state: "ack",
    message: "Loaded 2 older posts",
  });
  assert.equal(hydratedSurfaces.player.threadPager.ack.rootState, "complete");
  assert.equal(hydratedSurfaces.player.threadPager.ack.buttonLabel, "No older posts");
  assert.equal(hydratedSurfaces.player.threadPager.ack.buttonDisabled, true);
  assert.equal(
    hydratedSurfaces.player.threadPager.ack.buttonDisabledReason,
    "At oldest loaded post",
  );
  assert.equal(hydratedSurfaces.player.threadPager.ack.postCount > 2, true);
  assert.deepEqual(hydratedSurfaces.player.threadPager.reject.status, {
    state: "reject",
    message: "Thread page rejected: 503",
  });
  assert.equal(hydratedSurfaces.player.threadPager.reject.rootState, "ready");
  assert.equal(hydratedSurfaces.player.threadPager.reject.buttonLabel, "Load older");
  assert.equal(hydratedSurfaces.player.threadPager.reject.buttonDisabled, false);
  assert.equal(hydratedSurfaces.player.threadPager.reject.buttonDisabledReason, null);
  assert.deepEqual(hydratedSurfaces.moderator.confirmation, {
    actionId: "resolve_host_prompt-D01-skip_next_day-slot_1",
    confirmationOpen: true,
    confirmTestId: "critical-host-action-confirm",
    dispatchKind: "resolve_host_prompt",
  });
  assert.equal(hydratedSurfaces.moderator.command.remainingPromptActions, 0);
  assert.deepEqual(hydratedSurfaces.moderator.slotLifecycleConfirmation, {
    actionId: "modkill_slot",
    confirmationOpen: true,
    confirmTestId: "critical-host-action-confirm",
    dispatchKind: "modkill_slot",
  });
  assert.deepEqual(hydratedSurfaces.moderator.slotLifecycleCommand.requestCommand, {
    SetSlotStatus: {
      game: "midsummer",
      slot: "slot-7",
      status: "modkilled",
    },
  });
  assert.deepEqual(hydratedSurfaces.moderator.slotLifecycleCommand.projection, {
    lifecycleLabel: "Modkilled",
    historyLabel: "Slot history remains attached to slot-7",
  });
});

test("component interaction artifact records no-bind command component wiring", async () => {
  const componentInteractions = await readJsonArtifact(componentInteractionsPath);

  assert.equal(componentInteractions.status, "passed");
  assert.equal(componentInteractions.proof, "frontend-component-interaction-contract");
  assert.equal(
    componentInteractions.boundary,
    "No-bind compiled-component interaction contract. It verifies command component source event bindings, renders command controls and status rows through a Svelte SSR bundle, directly invokes the same callback/controller action ids, and re-renders DOM-facing ACK rows. It does not prove browser pointer delivery, Svelte client scheduling, focus traversal, CSS geometry, screenshots, TCP transport, or WebSocket delivery.",
  );
  assert.deepEqual(
    componentInteractions.sourceContracts.map((contract) => [
      contract.component,
      contract.path,
    ]),
    [
      [
        "AdminSetupGrid",
        "frontend/src/lib/components/admin/AdminSetupGrid.svelte",
      ],
      [
        "AdminRecoveryPanel",
        "frontend/src/lib/components/admin/AdminRecoveryPanel.svelte",
      ],
      [
        "PlayerCommandPanel",
        "frontend/src/lib/components/player-command/PlayerCommandPanel.svelte",
      ],
      [
        "HostControlSurface",
        "frontend/src/lib/components/host-action/HostControlSurface.svelte",
      ],
      [
        "HostAction",
        "frontend/src/lib/components/host-action/HostAction.svelte",
      ],
    ],
  );
  assert.deepEqual(componentInteractions.interactions.admin, {
    component: "AdminSetupGrid/AdminRecoveryPanel/AdminCommandActivity",
    actions: [
      {
        action: "add_cohost",
        triggerTestId: "admin-command-trigger-cohost",
        confirmTestId: "admin-command-confirm-cohost",
        visibleRowTestId: "admin-command-activity-cohost",
        statusTestId: "admin-command-activity-status-cohost",
        renderedConfirmBytes:
          componentInteractions.interactions.admin.actions[0].renderedConfirmBytes,
      },
      {
        action: "grant_session",
        triggerTestId: "admin-command-trigger-session-grants",
        confirmTestId: "admin-command-confirm-session-grants",
        formAction: "?/grantSession",
        formFieldTestIds: [
          "admin-session-grant-token",
          "admin-session-grant-principal",
          "admin-session-grant-expires-at",
          "admin-session-grant-global-mod",
        ],
        visibleRowTestId: "admin-command-activity-session-grants",
        statusTestId: "admin-command-activity-status-session-grants",
        renderedConfirmBytes:
          componentInteractions.interactions.admin.actions[1].renderedConfirmBytes,
      },
      {
        action: "check_recovery_gate",
        triggerTestId: "admin-recovery-trigger-recovery-gate",
        confirmTestId: "admin-recovery-confirm-recovery-gate",
        formAction: "?/checkRecoveryGate",
        visibleRowTestId: "admin-command-activity-recovery-gate",
        statusTestId: "admin-command-activity-status-recovery-gate",
        renderedConfirmBytes:
          componentInteractions.interactions.admin.actions[2].renderedConfirmBytes,
      },
    ],
    renderedAckBytes: componentInteractions.interactions.admin.renderedAckBytes,
  });
  for (const action of componentInteractions.interactions.admin.actions) {
    assert.equal(action.renderedConfirmBytes > 0, true);
  }
  assert.equal(componentInteractions.interactions.admin.renderedAckBytes > 0, true);
  assert.deepEqual(componentInteractions.interactions.player, {
    component: "PlayerCommandPanel/PlayerCommandReceipt",
    actions: [
      {
        action: "submit_vote",
        actionAttribute: "submit_vote",
        visibleRowTestId: "player-command-receipt-submit_vote",
      },
      {
        action: "submit_post",
        actionAttribute: "submit_post",
        visibleRowTestId: "player-command-receipt-submit_post",
      },
    ],
    statusTestId: "player-command-status",
    renderedPanelBytes:
      componentInteractions.interactions.player.renderedPanelBytes,
    renderedVoteAckBytes:
      componentInteractions.interactions.player.renderedVoteAckBytes,
    renderedPostAckBytes:
      componentInteractions.interactions.player.renderedPostAckBytes,
  });
  assert.equal(componentInteractions.interactions.player.renderedPanelBytes > 0, true);
  assert.equal(
    componentInteractions.interactions.player.renderedVoteAckBytes > 0,
    true,
  );
  assert.equal(
    componentInteractions.interactions.player.renderedPostAckBytes > 0,
    true,
  );
  assert.deepEqual(componentInteractions.interactions.moderator, {
    component: "HostAction/HostCommandActivity",
    actions: [
      {
        actionId: "resolve_host_prompt-D01-skip_next_day-slot_1",
        dispatchKind: "resolve_host_prompt",
        confirmTestId: "critical-host-action-confirm",
        visibleRowTestId:
          "host-command-activity-resolve_host_prompt-D01-skip_next_day-slot_1",
        statusTestId:
          "host-command-activity-status-resolve_host_prompt-D01-skip_next_day-slot_1",
        renderedControlsBytes:
          componentInteractions.interactions.moderator.actions[0]
            .renderedControlsBytes,
        renderedAckBytes:
          componentInteractions.interactions.moderator.actions[0]
            .renderedAckBytes,
      },
      {
        actionId: "modkill_slot",
        dispatchKind: "modkill_slot",
        confirmTestId: "critical-host-action-confirm",
        visibleRowTestId: "host-command-activity-modkill_slot",
        statusTestId: "host-command-activity-status-modkill_slot",
        renderedControlsBytes:
          componentInteractions.interactions.moderator.actions[1]
            .renderedControlsBytes,
        renderedAckBytes:
          componentInteractions.interactions.moderator.actions[1]
            .renderedAckBytes,
      },
    ],
  });
  for (const action of componentInteractions.interactions.moderator.actions) {
    assert.equal(action.renderedControlsBytes > 0, true);
    assert.equal(action.renderedAckBytes > 0, true);
  }
});

test("no-bind browser interaction artifact records click focus evidence or a Chromium block", async () => {
  const noBindInteractions = await readJsonArtifact(noBindInteractionsPath);

  assert.equal(noBindInteractions.proof, "chromium-ssr-no-bind-interactions");
  assert.equal(
    ["passed", "chromium-launch-blocked"].includes(noBindInteractions.status),
    true,
  );

  if (noBindInteractions.status === "chromium-launch-blocked") {
    assert.equal(
      noBindInteractions.boundary,
      "Build-mode Svelte SSR route-state render passed, but Chromium could not launch in this sandbox. No no-bind browser click delivery, focus landing, touch target geometry, client hydration, pointer, or network behavior was exercised.",
    );
    assert.deepEqual(noBindInteractions.interactions, {
      admin: [],
      player: [],
      moderator: [],
    });
    assert.equal(
      noBindInteractions.routeStateRenderArtifact,
      "target/frontend-route-state-render/route-state-render.json",
    );
    assertNoBindPlannedInteractions(noBindInteractions.plannedInteractions);
    assert.equal(typeof noBindInteractions.error?.message, "string");
    return;
  }

  assert.equal(
    noBindInteractions.boundary,
    "Loads build-mode Svelte SSR markup into Chromium with page.setContent, without opening a TCP listener. It proves real browser hit-testing, click delivery to the expected command controls, focus landing after click, and touch target geometry for representative admin, player, player private-channel controls plus every moderator critical host confirmation. It does not prove Svelte client hydration, Svelte event scheduling, command dispatch side effects, dev-server routing, TCP/network transport, or WebSocket delivery.",
  );
  assertNoBindPlannedInteractions(noBindInteractions.plannedInteractions);
  assert.deepEqual(noBindInteractions.viewports, viewports);
  assertNoBindInteractionEntries(noBindInteractions.interactions.admin, {
    id: "admin-cohost-confirm-click",
    render: "renderAdminSetupConfirmation",
    targetSelector: '[data-testid="admin-command-confirm-cohost"]',
    targetTestId: "admin-command-confirm-cohost",
  });
  assertNoBindInteractionEntries(noBindInteractions.interactions.admin, {
    id: "admin-session-grant-confirm-click",
    render: "renderAdminSetupConfirmation",
    targetSelector: '[data-testid="admin-command-confirm-session-grants"]',
    targetTestId: "admin-command-confirm-session-grants",
    form: {
      action: "?/grantSession",
      fieldTestIds: [
        "admin-session-grant-token",
        "admin-session-grant-principal",
        "admin-session-grant-expires-at",
        "admin-session-grant-global-mod",
      ],
    },
  });
  assertNoBindInteractionEntries(noBindInteractions.interactions.admin, {
    id: "admin-recovery-gate-confirm-click",
    render: "renderAdminRecoveryConfirmation",
    targetSelector: '[data-testid="admin-recovery-confirm-recovery-gate"]',
    targetTestId: "admin-recovery-confirm-recovery-gate",
    form: {
      action: "?/checkRecoveryGate",
      fieldNames: ["game", "principalUserId"],
    },
  });
  assertNoBindInteractionEntries(noBindInteractions.interactions.player, {
    id: "player-submit-vote-click",
    render: "renderPlayerSurface",
    targetSelector: '[data-action="submit_vote"]',
    targetAction: "submit_vote",
  });
  assertNoBindInteractionEntries(noBindInteractions.interactions.player, {
    id: "player-submit-post-click",
    render: "renderPlayerSurface",
    targetSelector: '[data-action="submit_post"]',
    targetAction: "submit_post",
    media: {
      boundaryTestId: "thread-post-media-boundary-442",
      mediaTestId: "thread-post-media-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      renderedVariant: "tablet",
      originalUrlRendered: false,
    },
  });
  assertNoBindInteractionEntries(noBindInteractions.interactions.player, {
    id: "player-private-channel-submit-post-click",
    render: "renderPlayerPrivateChannelRoute",
    targetSelector: '[data-action="submit_post"]',
    targetAction: "submit_post",
    route: {
      path: "/g/midsummer/c/private%3Arole_pm%3Aslot-7",
      activeChannelTestId: "player-channel-private:role_pm:slot-7",
      activeChannelHref: "/g/midsummer/c/private%3Arole_pm%3Aslot-7",
      activeChannelCurrent: "page",
      privateReviewHref: "/g/midsummer/c/private%3Arole_pm%3Aslot-7?private=notification-1",
    },
    media: {
      boundaryTestId: "thread-post-media-boundary-442",
      mediaTestId: "thread-post-media-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      renderedVariant: "tablet",
      originalUrlRendered: false,
    },
  });
  assertNoBindInteractionEntries(noBindInteractions.interactions.player, {
    id: "player-action-target-pick-confirm-click",
    render: "renderPlayerActionTargetConfirmation",
    targetSelector: '[data-testid="player-action-confirm-factional_kill"]',
    targetTestId: "player-action-confirm-factional_kill",
  });
  assertNoBindInteractionEntries(noBindInteractions.interactions.player, {
    id: "player-action-withdraw-confirm-click",
    render: "renderPlayerActionWithdrawConfirmation",
    targetSelector: '[data-testid="player-action-withdraw-confirm-factional_kill"]',
    targetTestId: "player-action-withdraw-confirm-factional_kill",
  });
  for (const [actionId, payloadKind] of moderatorCriticalConfirmationActions) {
    assertNoBindInteractionEntries(noBindInteractions.interactions.moderator, {
      id: `moderator-${actionId}-confirm-click`,
      render: "renderModeratorActionConfirmation",
      renderArgs: [actionId],
      targetSelector: '[data-testid="critical-host-action-confirm"]',
      targetTestId: "critical-host-action-confirm",
      confirmation: {
        actionId,
        payloadKind,
      },
    });
  }
});

test("static focusability artifact proves modeled focus ids in SSR markup", async () => {
  const staticFocusability = await readJsonArtifact(staticFocusabilityPath);

  assert.equal(staticFocusability.status, "passed");
  assert.equal(staticFocusability.proof, "ssr-static-focusability-contract");
  assert.equal(
    staticFocusability.boundary,
    "Parses build-mode Svelte SSR markup without opening localhost or launching Chromium. This proves every modeled keyboard focus target owns a real enabled focusable element and every forbidden focus id is absent from the static tab order. It does not prove CSS focus-ring visibility, browser Tab traversal, pointer behavior, hydration, command dispatch, TCP transport, or WebSocket delivery.",
  );
  assert.deepEqual(
    staticFocusability.surfaces.map((entry) => [
      entry.id,
      entry.expectedFocusCount,
      entry.forbiddenFocusCount,
      entry.focusability.expected.map((item) => item.testId),
      entry.focusability.forbidden.map((item) => item.testId),
    ]),
    [
      [
        "board",
        boardScenario.focus.expectedOrder.length,
        boardScenario.focus.forbiddenTestIds.length,
        boardScenario.focus.expectedOrder,
        boardScenario.focus.forbiddenTestIds,
      ],
      ...roles.map((role) => [
        role.id,
        role.focus.expectedOrder.length,
        role.focus.forbiddenTestIds.length,
        role.focus.expectedOrder,
        role.focus.forbiddenTestIds,
      ]),
    ],
  );
  assert.deepEqual(
    staticFocusability.routeStates.map((entry) => [
      entry.id,
      entry.expectedFocusCount,
      entry.forbiddenFocusCount,
      entry.focusability.expected.map((item) => item.testId),
      entry.focusability.forbidden.map((item) => item.testId),
    ]),
    routeStateScenarios.map((scenario) => [
      scenario.id,
      scenario.focus.expectedOrder.length,
      scenario.focus.forbiddenTestIds.length,
      scenario.focus.expectedOrder,
      scenario.focus.forbiddenTestIds,
    ]),
  );
  for (const entry of [
    ...staticFocusability.surfaces,
    ...staticFocusability.routeStates,
  ]) {
    assert.equal(entry.htmlBytes > 0, true);
    assert.equal(
      entry.focusability.expected.every((item) => item.focusableTag.length > 0),
      true,
    );
    assert.equal(
      entry.focusability.forbidden.every((item) => item.disabled || item.ariaDisabled === "true"),
      true,
    );
  }
});

test("tablet interaction artifact proves tap-first source posture", async () => {
  const tabletInteraction = await readJsonArtifact(tabletInteractionPath);

  assert.equal(tabletInteraction.status, "passed");
  assert.equal(tabletInteraction.proof, "frontend-tablet-interaction-contract");
  assert.equal(
    tabletInteraction.boundary,
    "Scans the current frontend source for forbidden tap-first interaction regressions, including hover-triggered preload, hover-only selectors, hover media queries, and hover-style handlers; verifies the shared tablet touch/focus CSS contracts; and parses build-mode SSR role surfaces for explicit thumb-zone placement without opening localhost or launching Chromium. It proves source and SSR posture for tablet-first affordances, not browser pointer delivery, pixel overlap, Svelte hydration, or real focus traversal.",
  );
  assert.equal(tabletInteraction.scanned.root, "frontend/src");
  assert.equal(tabletInteraction.scanned.fileCount > 0, true);
  assert.deepEqual(tabletInteraction.scanned.extensions, [
    ".css",
    ".html",
    ".js",
    ".mjs",
    ".svelte",
  ]);
  assert.deepEqual(
    tabletInteraction.forbiddenPatterns.map((pattern) => pattern.id),
    [
      "hover-preload-trigger",
      "css-hover-selector",
      "hover-media-query",
      "mouse-enter-handler",
      "pointer-enter-handler",
    ],
  );
  assert.deepEqual(tabletInteraction.forbiddenMatches, []);
  assert.deepEqual(tabletInteraction.rootAppHtml, {
    viewportFit: "cover",
    preloadTrigger: "tap",
  });
  assert.deepEqual(tabletInteraction.sharedAppCss.scanStripColumns, {
    desktop: 4,
    tablet: "adaptive 200px minimum",
    narrow: 1,
  });
  assert.equal(tabletInteraction.sharedAppCss.tabletScanStripMinBlockSizePx, 112);
  assert.equal(
    tabletInteraction.sharedAppCss.tabletScanStripDetailMode,
    "visually-hidden",
  );
  assert.equal(tabletInteraction.sharedAppCss.appShellTouchTargetMinPx, 44);
  assert.equal(tabletInteraction.sharedAppCss.edgeToEdgeViewport, true);
  assert.deepEqual(tabletInteraction.sharedAppCss.safeAreaInsets, [
    "top",
    "right",
    "bottom",
    "left",
  ]);
  assert.deepEqual(tabletInteraction.sharedAppCss.overscroll, {
    html: "none",
    body: "contain",
  });
  assert.deepEqual(tabletInteraction.sharedAppCss.stickyTopbar, {
    mode: "sticky-safe-area-role-session-topbar",
    topPx: 0,
    blockSizePx: 76,
    railGapPx: 22,
    safeAreaAware: true,
  });
  assert.deepEqual(tabletInteraction.adminOperatorSurfaceCss, {
    controlRailMode: "flow-admin-operator-actions",
    stickyTopPx: 0,
    topbarOffsetPx: 76,
    safeAreaAware: false,
    internalScroll: false,
    overscroll: "visible",
    unstickBelowPx: 0,
    setupAndRecoveryBeforeStatusReadouts: true,
    actionTileStabilityMode: "reserved-status-floor",
    actionTileStatusFloorMinBlockSizePx: 44,
    primaryActionBeforeStatusFloor: true,
  });
  assert.deepEqual(tabletInteraction.playerRouteLayoutCss, {
    commandRailMode: "sticky-tablet-command-rail",
    stickyTopPx: 22,
    topbarOffsetPx: 76,
    safeAreaAware: true,
    internalScroll: true,
    overscroll: "contain",
    unstickBelowPx: 960,
    stabilityMode: "primary-controls-before-live-receipts",
    primaryControlsBeforeReceipts: true,
  });
  assert.deepEqual(tabletInteraction.moderatorControlSurfaceCss, {
    controlRailMode: "flow-host-control-actions",
    stickyTopPx: 0,
    topbarOffsetPx: 76,
    safeAreaAware: false,
    internalScroll: false,
    overscroll: "visible",
    unstickBelowPx: 0,
    primaryControlsBeforeStatusReadouts: true,
    actionTileStabilityMode: "reserved-status-floor",
    actionTileStatusFloorMinBlockSizePx: 44,
    primaryActionBeforeStatusFloor: true,
  });
  assert.equal(tabletInteraction.sharedAppCss.touchButtonMinInlinePx, 44);
  assert.equal(tabletInteraction.sharedAppCss.touchAction, "manipulation");
  assert.equal(tabletInteraction.hostTouchCss.touchTargetMinPx, 44);
  assert.equal(tabletInteraction.hostTouchCss.touchGapMinPx, 8);
  assert.equal(tabletInteraction.hostTouchCss.confirmationActionsWrap, true);
  assert.deepEqual(
    tabletInteraction.thumbZones.admin.zones.map((zone) => [
      zone.testId,
      zone.thumbZone,
      zone.descendantCount,
    ]),
    [
      ["admin-setup-action-zone", "admin-setup-actions", 3],
      ["admin-recovery-action-zone", "admin-recovery-actions", 1],
    ],
  );
  assert.deepEqual(
    tabletInteraction.thumbZones.player.zones.map((zone) => [
      zone.testId,
      zone.thumbZone,
      zone.descendants.map((descendant) => descendant.value),
    ]),
    [
      [
        "player-primary-action-zone",
        "player-primary-actions",
        ["submit_vote", "submit_vote:no_lynch", "withdraw_vote", "submit_post"],
      ],
    ],
  );
  assert.equal(
    tabletInteraction.thumbZones.moderator.zones[0].testId,
    "moderator-primary-action-zone",
  );
  assert.equal(
    tabletInteraction.thumbZones.moderator.zones[0].descendantCount,
    11,
  );
});

test("no-bind keyboard traversal artifact records tab order evidence or a Chromium block", async () => {
  const keyboardTraversal = await readJsonArtifact(keyboardTraversalPath);

  assert.equal(keyboardTraversal.proof, "chromium-ssr-keyboard-traversal");
  assert.equal(
    ["passed", "chromium-launch-blocked"].includes(keyboardTraversal.status),
    true,
  );

  if (keyboardTraversal.status === "chromium-launch-blocked") {
    assert.equal(
      keyboardTraversal.boundary,
      "Build-mode Svelte SSR route-state render passed, but Chromium could not launch in this sandbox. No no-bind browser Tab traversal, visible focus outline, disabled-control exclusion, client hydration, pointer, or network behavior was exercised.",
    );
    assert.deepEqual(keyboardTraversal.surfaces, []);
    assert.deepEqual(keyboardTraversal.routeStates, []);
    assert.equal(
      keyboardTraversal.routeStateRenderArtifact,
      "target/frontend-route-state-render/route-state-render.json",
    );
    assert.equal(typeof keyboardTraversal.error?.message, "string");
    return;
  }

  assert.equal(
    keyboardTraversal.boundary,
    "Loads build-mode Svelte SSR markup into Chromium with page.setContent, without opening a TCP listener. This proves real browser Tab traversal, visible focus outlines, disabled-control exclusion, and shared skip-link-first keyboard order for the board, admin, player, moderator, and route-state surfaces. It does not prove Svelte hydration, dev-server routing, command dispatch, pointer behavior, fetch mocks, TCP transport, or WebSocket delivery.",
  );
  assert.deepEqual(keyboardTraversal.viewports, viewports);
  assert.deepEqual(
    keyboardTraversal.surfaces.map((entry) => [
      entry.id,
      entry.focusTraversal.expectedOrder[0],
    ]),
    viewports.flatMap(() =>
      ["board", ...roles.map((role) => role.id)].map((id) => [
        id,
        APP_SHELL_CONTRACT.skipLinkTestId,
      ]),
    ),
  );
  assert.deepEqual(
    keyboardTraversal.routeStates.map((entry) => [
      entry.id,
      entry.focusTraversal.expectedOrder[0],
    ]),
    viewports.flatMap(() =>
      routeStateScenarios.map((scenario) => [
        scenario.id,
        APP_SHELL_CONTRACT.skipLinkTestId,
      ]),
    ),
  );
  for (const entry of [
    ...keyboardTraversal.surfaces,
    ...keyboardTraversal.routeStates,
  ]) {
    assert.equal(entry.focusTraversal.sequence[0], APP_SHELL_CONTRACT.skipLinkTestId);
    assert.equal(
      entry.focusTraversal.stops.every((stop) => stop.outlineWidth > 0),
      true,
    );
  }
});

test("route live contract records Svelte onMount websocket and resync evidence", async () => {
  const routeLive = await readJsonArtifact(routeLivePath);

  assert.equal(routeLive.status, "passed");
  assert.equal(routeLive.proof, "frontend-route-live-contract");
  assert.deepEqual(routeLive.generatedFrom, {
    playerRoutePage: "frontend/src/routes/g/[game]/+page.svelte",
    moderatorRoutePage: "frontend/src/routes/g/[game]/host/+page.svelte",
    liveTransport: "frontend/src/lib/app/live-transport.mjs",
    projectionStore: "frontend/src/lib/app/projection-store.mjs",
  });
  assert.deepEqual(
    [
      routeLive.sources.player.onMountConnects,
      routeLive.sources.moderator.onMountConnects,
      routeLive.runtime.player.liveTransportStatus,
      routeLive.runtime.moderator.liveTransportStatus,
    ],
    [
      true,
      true,
      "json-ws-command-projection-deltas-with-resync-and-reconnect",
      "json-ws-command-projection-deltas-with-resync-and-reconnect",
    ],
  );
  assert.deepEqual(routeLive.runtime.player.resyncKeys, [
    "thread",
    "votecount",
    "dayVoteOutcomes",
    "endgameSummary",
    "notifications",
    "investigationResults",
    "commandState",
  ]);
  assert.deepEqual(routeLive.runtime.moderator.resyncKeys, [
    "host",
    "votecount",
    "dayVoteOutcomes",
    "hostPrompts",
  ]);
  assert.deepEqual(routeLive.runtime.player.eventKinds, [
    "open",
    "hello",
    "delta",
    "resync-required",
  ]);
  assert.deepEqual(routeLive.runtime.moderator.eventKinds, [
    "open",
    "hello",
    "delta",
    "resync-required",
  ]);
  assert.equal(routeLive.runtime.player.finalStatus.state, "recovered");
  assert.equal(routeLive.runtime.moderator.finalStatus.state, "recovered");
});

test("host confirmation static DOM artifact covers destructive moderator actions", async () => {
  const hostConfirmations = await readJsonArtifact(hostConfirmationStaticDomPath);

  assert.equal(hostConfirmations.status, "passed");
  assert.equal(hostConfirmations.proof, "host-confirmation-static-dom-contract");
  assert.equal(
    hostConfirmations.boundary,
    "Parses build-mode Svelte SSR for every moderator critical host action with its confirmation already open. This proves each deadline, replacement, phase/thread lock, votecount, host-prompt, slot-lifecycle, and role-reveal action owns exactly one alertdialog confirmation with confirm/cancel controls, DOM-visible message text naming the affected object and outcome, initial-focus/return-focus/Escape/tab-containment metadata, and shared 44px touch-control classes. It does not prove browser focus movement, Tab trapping, Escape handling, pointer delivery, command dispatch, TCP transport, WebSocket delivery, or localhost-backed app acceptance.",
  );
  assert.deepEqual(hostConfirmations.generatedFrom, {
    routeStateRender: "target/frontend-route-state-render/route-state-render.json",
    routeStateBundle: "target/frontend-route-state-render/bundle/entry.js",
  });
  assert.equal(hostConfirmations.actionCount, EXPECTED_COUNTS.moderatorCriticalActions);
  assert.deepEqual(
    hostConfirmations.actions.map((action) => [action.id, action.payloadKind]),
    [
      ["extend_deadline", "extend_deadline"],
      ["extend_deadline_24h", "extend_deadline"],
      ["extend_deadline_48h", "extend_deadline"],
      ["process_replacement", "process_replacement"],
      ["resolve_phase", "resolve_phase"],
      ["lock_thread", "lock_thread"],
      ["publish_votecount", "publish_votecount"],
      ["mark_dead", "mark_dead"],
      ["modkill_slot", "modkill_slot"],
      ["complete_game", "complete_game"],
      ["resolve_host_prompt-D01-skip_next_day-slot_1", "resolve_host_prompt"],
    ],
  );
  for (const action of hostConfirmations.actions) {
    assert.equal(action.root.role, "group");
    assert.equal(action.root.component, "host-action");
    assert.equal(action.root.actionId, action.id);
    assert.deepEqual(action.confirmation, {
      role: "alertdialog",
      ariaModal: "true",
      ariaDescribedBy: `host-action-confirmation-message-${action.id}`,
      messageId: `host-action-confirmation-message-${action.id}`,
      initialFocusTestId: "critical-host-action-confirm",
      returnFocusTestId: "critical-host-action-trigger",
      escapeCancels: "true",
      tabContainment: "confirm-cancel",
    });
    assert.equal(action.messageText.includes(action.objectLabel), true);
    assert.equal(action.messageText.includes(action.outcomeLabel), true);
    assert.deepEqual(
      action.controls.map((control) => [
        control.tag,
        control.testId,
        control.touchControl,
        control.focusable,
      ]),
      [
        ["button", "critical-host-action-trigger", true, true],
        ["button", "critical-host-action-confirm", true, true],
        ["button", "critical-host-action-cancel", true, true],
      ],
    );
  }
});

test("in-app browser interaction page fixture records role command targets", async () => {
  const manifest = await readJsonArtifact(inAppBrowserInteractionManifestPath);
  const page = await readFile(inAppBrowserInteractionPagePath, "utf8");

  assert.equal(manifest.status, "page-generated");
  assert.equal(manifest.proof, "in-app-browser-file-interaction-page");
  assert.equal(
    manifest.boundary,
    `Generates a file-backed page from build-mode Svelte SSR first-viewport role surfaces, the real player private-channel error surface, command controls, player private-channel controls, all ${EXPECTED_COUNTS.moderatorCriticalActions} moderator critical host confirmations, and hydrated-surface scenario controls for manual/in-app-browser proof. The page can record native browser click delivery and focus landing for representative admin, player, player private-channel, route-error, and moderator critical host confirmation targets without opening localhost or launching a separate Playwright browser. It does not prove browser behavior unless the generated file is opened and exercised, and it does not prove Svelte hydration, Svelte event scheduling, command dispatch side effects, TCP/network transport, WebSocket delivery, or dev-server routing.`,
  );
  assert.equal(
    manifest.page,
    "target/frontend-in-app-browser-interactions/interaction-page.html",
  );
  assert.match(manifest.pageUrl, /^file:\/\//);
  assert.deepEqual(manifest.viewports, viewports);
  assert.deepEqual(manifest.appShellContract, {
    component: APP_SHELL_CONTRACT.component,
    navLabel: APP_SHELL_CONTRACT.navLabel,
    surfaceOrder: APP_SHELL_CONTRACT.surfaceOrder,
    navTestIds: APP_SHELL_CONTRACT.surfaceOrder.map((surface) =>
      roleNavTestId(surface),
    ),
    sessionTestId: APP_SHELL_CONTRACT.sessionTestId,
    sessionPrincipalTestId: APP_SHELL_CONTRACT.sessionPrincipalTestId,
    sessionCapabilityTestId: APP_SHELL_CONTRACT.sessionCapabilityTestId,
    sessionGameTestId: APP_SHELL_CONTRACT.sessionGameTestId,
    topbarTestId: APP_SHELL_CONTRACT.topbarTestId,
    topbarMode: APP_SHELL_CONTRACT.topbarMode,
    topbarStickyTopPx: APP_SHELL_CONTRACT.topbarStickyTopPx,
    topbarBlockSizePx: APP_SHELL_CONTRACT.topbarBlockSizePx,
    stickyRailGapPx: APP_SHELL_CONTRACT.stickyRailGapPx,
    minTouchTargetPx: APP_SHELL_CONTRACT.minTouchTargetPx,
  });
  assert.deepEqual(
    manifest.surfaces.map((surface) => [
      surface.id,
      surface.role,
      surface.path,
      surface.render,
      surface.surfaceTestId,
      surface.minTouchTargetPx,
      surface.nav,
    ]),
    [
      [
        boardScenario.id,
        "board",
        boardScenario.path,
        "renderBoardPlayerSurface",
        boardScenario.surfaceTestId,
        APP_SHELL_CONTRACT.minTouchTargetPx,
        boardScenario.nav,
      ],
      ...roles.map((role) => [
        role.id,
        role.id,
        role.path,
        renderFunctionForRole(role.id),
        role.surfaceTestId,
        APP_SHELL_CONTRACT.minTouchTargetPx,
        role.nav,
      ]),
      [
        "route-error-player-private-channel",
        "player",
        "/g/midsummer/c/private%3Arole_pm%3Aslot-7",
        "renderRouteErrorSurface",
        "route-error-surface",
        APP_SHELL_CONTRACT.minTouchTargetPx,
        {
          board: "link",
          player: "link",
          moderator: "blocked",
          admin: "blocked",
        },
      ],
    ],
  );
  for (const surface of manifest.surfaces) {
    assert.equal(surface.htmlBytes > 0, true);
    assert.equal(surface.requiredText.length > 0, true);
    assert.equal(surface.requiredSelectors.length > 0, true);
  }
  assert.deepEqual(
    manifest.scenarios.map((scenario) => [
      scenario.id,
      scenario.role,
      scenario.render,
      scenario.renderArgs,
      scenario.targetSelector,
      scenario.targetTestId,
      scenario.targetAction,
    ]),
    [
      [
        "admin-cohost-confirm-click",
        "admin",
        "renderAdminSetupConfirmation",
        undefined,
        '[data-testid="admin-command-confirm-cohost"]',
        "admin-command-confirm-cohost",
        undefined,
      ],
      [
        "admin-session-grant-confirm-click",
        "admin",
        "renderAdminSetupConfirmation",
        undefined,
        '[data-testid="admin-command-confirm-session-grants"]',
        "admin-command-confirm-session-grants",
        undefined,
      ],
      [
        "admin-recovery-gate-confirm-click",
        "admin",
        "renderAdminRecoveryConfirmation",
        undefined,
        '[data-testid="admin-recovery-confirm-recovery-gate"]',
        "admin-recovery-confirm-recovery-gate",
        undefined,
      ],
      [
        "player-submit-vote-click",
        "player",
        "renderPlayerSurface",
        undefined,
        '[data-action="submit_vote"]',
        undefined,
        "submit_vote",
      ],
      [
        "player-submit-post-click",
        "player",
        "renderPlayerSurface",
        undefined,
        '[data-action="submit_post"]',
        undefined,
        "submit_post",
      ],
      [
        "player-private-channel-submit-post-click",
        "player",
        "renderPlayerPrivateChannelRoute",
        undefined,
        '[data-action="submit_post"]',
        undefined,
        "submit_post",
      ],
      [
        "player-action-target-pick-confirm-click",
        "player",
        "renderPlayerActionTargetConfirmation",
        undefined,
        '[data-testid="player-action-confirm-factional_kill"]',
        "player-action-confirm-factional_kill",
        undefined,
      ],
      [
        "player-action-withdraw-confirm-click",
        "player",
        "renderPlayerActionWithdrawConfirmation",
        undefined,
        '[data-testid="player-action-withdraw-confirm-factional_kill"]',
        "player-action-withdraw-confirm-factional_kill",
        undefined,
      ],
      [
        "route-error-back-to-board-click",
        "player",
        "renderRouteErrorSurface",
        undefined,
        '[data-testid="route-error-action"]',
        "route-error-action",
        undefined,
      ],
      ...moderatorCriticalConfirmationActions.map(([actionId]) => [
        `moderator-${actionId}-confirm-click`,
        "moderator",
        "renderModeratorActionConfirmation",
        [actionId],
        '[data-testid="critical-host-action-confirm"]',
        "critical-host-action-confirm",
        undefined,
      ]),
    ],
  );
  for (const scenario of manifest.scenarios) {
    assert.equal(scenario.minTouchTargetPx, 44);
    assert.equal(scenario.htmlBytes > 0, true);
  }
  const playerPrivateChannelScenario = manifest.scenarios.find(
    (scenario) => scenario.id === "player-private-channel-submit-post-click",
  );
  assert.deepEqual(playerPrivateChannelScenario.route, {
    path: "/g/midsummer/c/private%3Arole_pm%3Aslot-7",
    activeChannelTestId: "player-channel-private:role_pm:slot-7",
    activeChannelHref: "/g/midsummer/c/private%3Arole_pm%3Aslot-7",
    privateReviewHref: "/g/midsummer/c/private%3Arole_pm%3Aslot-7?private=notification-1",
  });
  const routeErrorScenario = manifest.scenarios.find(
    (scenario) => scenario.id === "route-error-back-to-board-click",
  );
  assert.deepEqual(routeErrorScenario.errorSurface, {
    path: "/g/midsummer/c/private%3Arole_pm%3Aslot-7",
    status: 403,
    surfaceTestId: "route-error-surface",
    panelTestId: "route-error-panel",
    actionHref: "/",
    activeNavTestId: "role-nav-player",
    sessionPrincipal: "player_mira",
    capabilitySummary: "ChannelMember + SlotOccupant",
  });
  assert.deepEqual(
    manifest.hydratedSurfaceScenarios.map((scenario) => [
      scenario.id,
      scenario.role,
      scenario.source,
    ]),
    [
      [
        "shared-shell-header-coverage",
        "shared",
        "hydratedSurfaces.sharedShell",
      ],
      ["admin-audit-native-flow", "admin", "hydratedSurfaces.admin"],
      ["admin-operational-forms", "admin", "hydratedSurfaces.admin"],
      [
        "player-private-disclosure-vote-and-post",
        "player",
        "hydratedSurfaces.player",
      ],
      [
        "moderator-host-prompt-confirmation",
        "moderator",
        "hydratedSurfaces.moderator",
      ],
      [
        "moderator-slot-lifecycle-confirmation",
        "moderator",
        "hydratedSurfaces.moderator",
      ],
    ],
  );
  const sharedHeaderScenario = manifest.hydratedSurfaceScenarios.find(
    (scenario) => scenario.id === "shared-shell-header-coverage",
  );
  assert.deepEqual(
    sharedHeaderScenario.surfaces.map((surface) => [
      surface.id,
      surface.activeSurface,
      surface.headerTitle,
      surface.liveStatusTestId,
    ]),
    [
      ["board", "board", "Games", null],
      ["admin", "admin", "Operations", null],
      ["admin-audit-detail", "admin", "Proof runs", null],
      ["player", "player", "Day 2", "player-live-status"],
      ["moderator", "moderator", "Host console", "host-live-status"],
    ],
  );
  const adminHydratedScenario = manifest.hydratedSurfaceScenarios.find(
    (scenario) => scenario.id === "admin-audit-native-flow",
  );
  assert.deepEqual(adminHydratedScenario.auditNavigation, {
    listHref: "/admin/audit/proof-runs?game=midsummer",
    detailTitle: "Proof runs",
    evidenceHref: "/games/midsummer/operator/proof-runs?principal_user_id=admin_a",
    overviewHref: "/admin?game=midsummer",
  });
  assert.equal(adminHydratedScenario.command.commandKind, "AddCohost");
  assert.equal(adminHydratedScenario.command.visibleState, "ack");
  assert.deepEqual(
    adminHydratedScenario.controls.map((control) => control.testId),
    [
      "iab-admin-audit-detail-link",
      "iab-admin-audit-evidence-link",
      "iab-admin-command-ack",
    ],
  );
  const adminFormsHydratedScenario = manifest.hydratedSurfaceScenarios.find(
    (scenario) => scenario.id === "admin-operational-forms",
  );
  assert.deepEqual(
    adminFormsHydratedScenario.controls.map((control) => [
      control.testId,
      control.kind,
      control.exposureKey,
    ]),
    [
      [
        "iab-admin-session-grant-ack",
        "button",
        "__fmarchAdminSessionGrantResult",
      ],
      [
        "iab-admin-recovery-gate-ack",
        "button",
        "__fmarchAdminRecoveryGateResult",
      ],
    ],
  );
  const playerHydratedScenario = manifest.hydratedSurfaceScenarios.find(
    (scenario) => scenario.id === "player-private-disclosure-vote-and-post",
  );
  assert.deepEqual(playerHydratedScenario.privateDisclosure, {
    itemId: "notification-1",
    before: "false",
    after: "true",
    reviewHref: "/g/midsummer?private=notification-1",
    hostOnlyCopyPresent: false,
  });
  assert.equal(playerHydratedScenario.command.commandKind, "SubmitVote");
  assert.equal(playerHydratedScenario.command.visibleState, "ack");
  assert.deepEqual(playerHydratedScenario.command.refreshed, [
    "votecount",
    "commandState",
  ]);
  assert.equal(playerHydratedScenario.postCommand.commandKind, "SubmitPost");
  assert.equal(playerHydratedScenario.postCommand.visibleState, "ack");
  assert.deepEqual(playerHydratedScenario.postCommand.refreshed, [
    "thread",
    "votecount",
    "commandState",
    "dayVoteOutcomes",
  ]);
  assert.deepEqual(playerHydratedScenario.threadPager.pending, {
    status: {
      state: "pending",
      message: "Loading older posts",
    },
    rootState: "pending",
    busy: "true",
    buttonLabel: "Loading older",
    buttonDisabled: true,
    buttonDisabledReason: "Loading older posts",
    ariaDisabled: "true",
    minTouchTargetPx: 44,
    nextBeforeSeq: 441,
  });
  assert.deepEqual(playerHydratedScenario.threadPager.ack.status, {
    state: "ack",
    message: "Loaded 2 older posts",
  });
  assert.equal(playerHydratedScenario.threadPager.ack.rootState, "complete");
  assert.equal(playerHydratedScenario.threadPager.ack.buttonLabel, "No older posts");
  assert.equal(playerHydratedScenario.threadPager.ack.buttonDisabled, true);
  assert.equal(
    playerHydratedScenario.threadPager.ack.buttonDisabledReason,
    "At oldest loaded post",
  );
  assert.deepEqual(playerHydratedScenario.threadPager.reject.status, {
    state: "reject",
    message: "Thread page rejected: 503",
  });
  assert.equal(playerHydratedScenario.threadPager.reject.buttonLabel, "Load older");
  assert.equal(playerHydratedScenario.threadPager.reject.buttonDisabled, false);
  assert.equal(playerHydratedScenario.threadPager.reject.buttonDisabledReason, null);
  assert.deepEqual(
    playerHydratedScenario.controls.map((control) => control.testId),
    [
      "iab-player-private-toggle",
      "iab-player-private-review-link",
      "iab-player-command-ack",
      "iab-player-post-command-ack",
      "iab-player-thread-pager-pending",
      "iab-player-thread-pager-ack",
      "iab-player-thread-pager-reject",
    ],
  );
  const moderatorHydratedScenario = manifest.hydratedSurfaceScenarios.find(
    (scenario) => scenario.id === "moderator-host-prompt-confirmation",
  );
  assert.equal(moderatorHydratedScenario.confirmation.confirmationOpen, true);
  assert.equal(
    moderatorHydratedScenario.confirmation.confirmTestId,
    "critical-host-action-confirm",
  );
  assert.equal(moderatorHydratedScenario.command.commandKind, "ResolveHostPrompt");
  assert.equal(moderatorHydratedScenario.command.visibleState, "ack");
  assert.equal(moderatorHydratedScenario.command.remainingPromptActions, 0);
  assert.deepEqual(
    moderatorHydratedScenario.controls.map((control) => control.testId),
    [
      "iab-moderator-prompt-confirm",
      "iab-moderator-command-ack",
    ],
  );
  const moderatorSlotLifecycleScenario = manifest.hydratedSurfaceScenarios.find(
    (scenario) => scenario.id === "moderator-slot-lifecycle-confirmation",
  );
  assert.equal(
    moderatorSlotLifecycleScenario.slotLifecycleCommand.commandKind,
    "SetSlotStatus",
  );
  assert.equal(
    moderatorSlotLifecycleScenario.slotLifecycleCommand.visibleState,
    "ack",
  );
  assert.deepEqual(moderatorSlotLifecycleScenario.slotLifecycleCommand.projection, {
    lifecycleLabel: "Modkilled",
    historyLabel: "Slot history remains attached to slot-7",
  });
  assert.deepEqual(moderatorSlotLifecycleScenario.slotLifecycleConfirmation, {
    actionId: "modkill_slot",
    confirmationOpen: true,
    confirmTestId: "critical-host-action-confirm",
    dispatchKind: "modkill_slot",
  });
  assert.deepEqual(
    moderatorSlotLifecycleScenario.controls.map((control) => control.testId),
    [
      "iab-moderator-slot-lifecycle-confirm",
      "iab-moderator-slot-lifecycle-ack",
    ],
  );
  assert.match(page, /window\.__fmarchIabProof/);
  assert.match(page, /window\.__fmarchHydratedSurfaceScenarios/);
  assert.match(page, /data-testid="iab-proof-surfaces"/);
  assert.match(page, /data-testid="iab-proof-hydrated-scenarios"/);
  assert.match(page, /data-testid="iab-surface-board-player"/);
  assert.match(page, /data-testid="iab-surface-admin"/);
  assert.match(page, /data-testid="iab-surface-player"/);
  assert.match(page, /data-testid="iab-surface-moderator"/);
  assert.match(page, /data-component="fm-app-shell"/);
  assert.match(page, /data-testid="role-nav-admin"/);
  assert.match(page, /data-testid="role-nav-player"/);
  assert.match(page, /data-testid="role-nav-moderator"/);
  assert.match(page, /data-iab-scenario-id="admin-cohost-confirm-click"/);
  assert.match(page, /data-testid="admin-command-confirm-cohost"/);
  assert.match(page, /data-iab-scenario-id="admin-session-grant-confirm-click"/);
  assert.match(page, /data-testid="admin-command-confirm-session-grants"/);
  assert.match(page, /data-iab-scenario-id="admin-recovery-gate-confirm-click"/);
  assert.match(page, /data-testid="admin-recovery-confirm-recovery-gate"/);
  assert.match(page, /data-action="submit_vote"/);
  assert.match(page, /data-action="submit_post"/);
  assert.match(page, /data-iab-scenario-id="player-private-channel-submit-post-click"/);
  assert.match(page, /data-iab-scenario-id="route-error-back-to-board-click"/);
  assert.match(
    page,
    /data-iab-scenario-id="player-action-target-pick-confirm-click"/,
  );
  assert.match(
    page,
    /data-iab-scenario-id="player-action-withdraw-confirm-click"/,
  );
  assert.match(page, /data-testid="player-action-withdraw-confirm-factional_kill"/);
  assert.match(page, /data-testid="route-error-action"/);
  assert.match(page, /data-testid="player-channel-private:role_pm:slot-7"/);
  assert.match(page, /data-testid="critical-host-action-confirm"/);
  assert.match(page, /data-iab-hydrated-scenario-id="admin-audit-native-flow"/);
  assert.match(page, /data-testid="iab-admin-audit-detail-link"/);
  assert.match(page, /data-testid="iab-admin-audit-evidence-link"/);
  assert.match(page, /data-iab-hydrated-scenario-id="admin-operational-forms"/);
  assert.match(page, /data-testid="iab-admin-session-grant-ack"/);
  assert.match(page, /data-testid="iab-admin-recovery-gate-ack"/);
  assert.match(page, /data-testid="iab-player-private-toggle"/);
  assert.match(page, /data-testid="iab-player-private-review-link"/);
  assert.match(page, /data-testid="iab-player-post-command-ack"/);
  assert.match(page, /data-testid="iab-player-thread-pager-pending"/);
  assert.match(page, /data-testid="iab-player-thread-pager-ack"/);
  assert.match(page, /data-testid="iab-player-thread-pager-reject"/);
  assert.match(page, /data-testid="iab-player-thread-page-ack-status"/);
  assert.match(page, /data-testid="iab-moderator-prompt-confirm"/);
  assert.match(page, /data-iab-scenario-id="moderator-extend_deadline-confirm-click"/);
  assert.match(
    page,
    /data-iab-hydrated-scenario-id="moderator-slot-lifecycle-confirmation"/,
  );
  assert.match(page, /data-testid="iab-moderator-slot-lifecycle-confirm"/);
  assert.match(
    page,
    /data-iab-scenario-id="moderator-resolve_host_prompt-D01-skip_next_day-slot_1-confirm-click"/,
  );
});

test("in-app browser static DOM artifact verifies generated fixture structure", async () => {
  const staticDom = await readJsonArtifact(inAppBrowserStaticDomPath);

  assert.equal(staticDom.status, "passed");
  assert.equal(staticDom.proof, "in-app-browser-static-dom-contract");
  assert.equal(
    staticDom.boundary,
    `Parses the generated file-backed in-app browser fixture HTML without opening localhost or launching Chromium. This proves every manifest command/error scenario owns exactly one target inside its scenario root, all ${EXPECTED_COUNTS.moderatorCriticalActions} moderator critical host confirmation scenarios carry DOM-visible object/outcome text and alertdialog focus metadata, modeled route evidence is present for the player role-PM scenario, modeled error-surface evidence is present for the player private-channel 403, hydrated-surface controls exist inside their scenario roots, touch-floor metadata is present where the rendered control models it, and player private fixture markup excludes host-only copy. It does not prove CSS layout pixels, browser click delivery, focus landing, Svelte hydration, command dispatch side effects, TCP transport, WebSocket delivery, or localhost-backed app acceptance.`,
  );
  assert.deepEqual(staticDom.generatedFrom, {
    manifest: "target/frontend-in-app-browser-interactions/interaction-page-manifest.json",
    page: "target/frontend-in-app-browser-interactions/interaction-page.html",
  });
  assert.equal(staticDom.scenarioCount, EXPECTED_COUNTS.commandScenarios);
  assert.equal(staticDom.hydratedScenarioCount, 6);
  assert.deepEqual(
    staticDom.scenarios.map((scenario) => [
      scenario.id,
      scenario.role,
      scenario.target.tag,
      scenario.target.testId,
      scenario.target.action,
      scenario.touchFloor.value,
    ]),
    [
      [
        "admin-cohost-confirm-click",
        "admin",
        "button",
        "admin-command-confirm-cohost",
        null,
        44,
      ],
      [
        "admin-session-grant-confirm-click",
        "admin",
        "button",
        "admin-command-confirm-session-grants",
        null,
        44,
      ],
      [
        "admin-recovery-gate-confirm-click",
        "admin",
        "button",
        "admin-recovery-confirm-recovery-gate",
        null,
        44,
      ],
      ["player-submit-vote-click", "player", "button", null, "submit_vote", 44],
      ["player-submit-post-click", "player", "button", null, "submit_post", 44],
      [
        "player-private-channel-submit-post-click",
        "player",
        "button",
        null,
        "submit_post",
        44,
      ],
      [
        "player-action-target-pick-confirm-click",
        "player",
        "button",
        "player-action-confirm-factional_kill",
        null,
        44,
      ],
      [
        "player-action-withdraw-confirm-click",
        "player",
        "button",
        "player-action-withdraw-confirm-factional_kill",
        null,
        44,
      ],
      [
        "route-error-back-to-board-click",
        "player",
        "a",
        "route-error-action",
        null,
        44,
      ],
      ...moderatorCriticalConfirmationActions.map(([actionId]) => [
        `moderator-${actionId}-confirm-click`,
        "moderator",
        "button",
        "critical-host-action-confirm",
        null,
        44,
      ]),
    ],
  );
  for (const [actionId, payloadKind] of moderatorCriticalConfirmationActions) {
    const scenario = staticDom.scenarios.find(
      (entry) => entry.id === `moderator-${actionId}-confirm-click`,
    );
    assert.equal(scenario.render, "renderModeratorActionConfirmation");
    assert.deepEqual(scenario.renderArgs, [actionId]);
    assert.equal(scenario.confirmation.actionId, actionId);
    assert.equal(scenario.confirmation.payloadKind, payloadKind);
    assert.equal(scenario.confirmation.role, "alertdialog");
    assert.equal(scenario.confirmation.initialFocusTestId, "critical-host-action-confirm");
    assert.equal(scenario.confirmation.returnFocusTestId, "critical-host-action-trigger");
    assert.equal(scenario.confirmation.escapeCancels, "true");
    assert.equal(scenario.confirmation.tabContainment, "confirm-cancel");
  }
  const playerPrivateChannel = staticDom.scenarios.find(
    (scenario) => scenario.id === "player-private-channel-submit-post-click",
  );
  assert.deepEqual(playerPrivateChannel.route, {
    path: "/g/midsummer/c/private%3Arole_pm%3Aslot-7",
    activeChannelTestId: "player-channel-private:role_pm:slot-7",
    activeChannelHref: "/g/midsummer/c/private%3Arole_pm%3Aslot-7",
    activeChannelCurrent: "page",
    privateReviewHref: "/g/midsummer/c/private%3Arole_pm%3Aslot-7?private=notification-1",
  });
  const routeError = staticDom.scenarios.find(
    (scenario) => scenario.id === "route-error-back-to-board-click",
  );
  assert.deepEqual(routeError.errorSurface, {
    path: "/g/midsummer/c/private%3Arole_pm%3Aslot-7",
    status: 403,
    surfaceTestId: "route-error-surface",
    panelTestId: "route-error-panel",
    actionHref: "/",
    activeNavTestId: "role-nav-player",
    activeNavCurrent: "page",
    sessionPrincipal: "player_mira",
    capabilitySummary: "ChannelMember + SlotOccupant",
  });
  assert.deepEqual(
    staticDom.hydratedSurfaceScenarios.map((scenario) => scenario.id),
    [
      "shared-shell-header-coverage",
      "admin-audit-native-flow",
      "admin-operational-forms",
      "player-private-disclosure-vote-and-post",
      "moderator-host-prompt-confirmation",
      "moderator-slot-lifecycle-confirmation",
    ],
  );
  const playerStaticDomScenario = staticDom.hydratedSurfaceScenarios.find(
    (scenario) => scenario.id === "player-private-disclosure-vote-and-post",
  );
  const pendingPagerControl = playerStaticDomScenario.controls.find(
    (control) => control.testId === "iab-player-thread-pager-pending",
  );
  assert.deepEqual(pendingPagerControl, {
    testId: "iab-player-thread-pager-pending",
    kind: "button",
    tag: "button",
    href: null,
    focusable: false,
    touchFloor: "44",
    disabled: true,
    statusState: null,
  });
  assert.deepEqual(
    playerStaticDomScenario.controls
      .filter((control) => control.testId.includes("thread-pager-"))
      .map((control) => [control.testId, control.statusState, control.touchFloor]),
    [
      ["iab-player-thread-pager-pending", null, "44"],
      ["iab-player-thread-pager-ack", "ack", "44"],
      ["iab-player-thread-pager-reject", "reject", "44"],
    ],
  );
  assert.deepEqual(playerStaticDomScenario.threadPager, {
    pendingDisabled: true,
    statusStates: ["ack", "reject"],
    liveRegionTestIds: [
      "iab-player-thread-page-ack-status",
      "iab-player-thread-page-reject-status",
      "iab-player-thread-page-status",
    ],
  });
  assert.deepEqual(staticDom.forbidden, [
    {
      label: "file-backed player private-channel fixture",
      strings: ["host prompt", "moderator", "resolve_host_prompt"],
      present: false,
    },
  ]);
});

test("in-app browser fixture smoke records browser-run evidence or block", async () => {
  const browserRun = await readJsonArtifact(inAppBrowserRunPath);

  assert.equal(browserRun.proof, "in-app-browser-file-fixture-smoke");
  assert.equal(
    [
      "passed",
      "chromium-launch-blocked",
      "file-navigation-blocked",
    ].includes(browserRun.status),
    true,
  );
  assert.equal(
    ["generate-and-run", "replay-existing"].includes(browserRun.mode),
    true,
  );
  assert.equal(browserRun.regeneratedFixture, browserRun.mode === "generate-and-run");
  assert.deepEqual(browserRun.generatedFrom, {
    manifest: "target/frontend-in-app-browser-interactions/interaction-page-manifest.json",
    ...(browserRun.status === "passed"
      ? { page: "target/frontend-in-app-browser-interactions/interaction-page.html" }
      : {}),
  });
  assert.match(browserRun.pageUrl, /^file:\/\//);

  if (browserRun.status !== "passed") {
    assert.deepEqual(browserRun.runs, []);
    assertInAppBrowserPlannedInteractions(browserRun.plannedInteractions);
    assert.match(
      browserRun.boundary,
      /No file URL navigation|could not complete file URL navigation/,
    );
    return;
  }

  const expectedPassedBoundary = browserRun.mode === "replay-existing"
    ? `Loads the existing file-backed in-app browser fixture in Chromium using its file URL without regenerating SSR artifacts first. It proves native browser navigation to the prepared page, click delivery, focus landing, 44px touch geometry, player private-channel route evidence, player disclosure toggle behavior, all ${EXPECTED_COUNTS.moderatorCriticalActions} moderator critical host confirmation metadata records, and nonblank screenshot pixels for the fixture controls across the proof viewports. It does not prove fixture freshness, Svelte client hydration, Svelte event scheduling, command dispatch side effects, dev-server routing, TCP/network transport, WebSocket delivery, or localhost-backed app acceptance.`
    : `Loads the generated file-backed in-app browser fixture in Chromium using its file URL. It proves native browser navigation to the prepared page, click delivery, focus landing, 44px touch geometry, player private-channel route evidence, player disclosure toggle behavior, all ${EXPECTED_COUNTS.moderatorCriticalActions} moderator critical host confirmation metadata records, and nonblank screenshot pixels for the fixture controls across the proof viewports. It does not prove Svelte client hydration, Svelte event scheduling, command dispatch side effects, dev-server routing, TCP/network transport, WebSocket delivery, or localhost-backed app acceptance.`;
  assert.equal(
    browserRun.boundary,
    expectedPassedBoundary,
  );
  assertInAppBrowserPlannedInteractions(browserRun.plannedInteractions);
  assert.deepEqual(browserRun.viewports, viewports);
  assert.equal(browserRun.runs.length, viewports.length);
  for (const run of browserRun.runs) {
    assert.equal(run.pageReady.status, "ready");
    assert.equal(run.pageReady.scenarioCount >= EXPECTED_COUNTS.commandScenarios, true);
    assert.equal(run.pageReady.hydratedScenarioCount >= 5, true);
    assertPixelEvidence([run], "in-app browser fixture screenshots");
    const ids = new Set(run.interactions.map((interaction) => interaction.id));
    for (const id of [
      "admin-cohost-confirm-click",
      "admin-session-grant-confirm-click",
      "admin-recovery-gate-confirm-click",
      "player-submit-vote-click",
      "player-submit-post-click",
      "player-private-channel-submit-post-click",
      "player-action-target-pick-confirm-click",
      "player-action-withdraw-confirm-click",
      "route-error-back-to-board-click",
      ...moderatorCriticalConfirmationScenarioIds,
      "admin-audit-native-flow",
      "admin-operational-forms",
      "player-private-disclosure-vote-and-post",
      "moderator-host-prompt-confirmation",
      "moderator-slot-lifecycle-confirmation",
    ]) {
      assert.equal(ids.has(id), true, `browser run missing ${id}`);
    }
    for (const interaction of run.interactions) {
      assert.notEqual(interaction.clicked, undefined);
      assert.notEqual(interaction.activeElement, undefined);
      assert.notEqual(interaction.targetBox, undefined);
      assert.equal(interaction.targetBox.width >= interaction.minTouchTargetPx, true);
      assert.equal(interaction.targetBox.height >= interaction.minTouchTargetPx, true);
    }
    for (const [actionId, payloadKind] of moderatorCriticalConfirmationActions) {
      const interaction = run.interactions.find(
        (entry) => entry.id === `moderator-${actionId}-confirm-click`,
      );
      assert.equal(interaction.confirmation.actionId, actionId);
      assert.equal(interaction.confirmation.payloadKind, payloadKind);
      assert.equal(interaction.confirmation.role, "alertdialog");
      assert.equal(
        interaction.confirmation.initialFocusTestId,
        "critical-host-action-confirm",
      );
      assert.equal(
        interaction.confirmation.returnFocusTestId,
        "critical-host-action-trigger",
      );
      assert.equal(interaction.confirmation.escapeCancels, "true");
      assert.equal(interaction.confirmation.tabContainment, "confirm-cancel");
      assert.equal(
        interaction.confirmation.messageText.includes(
          interaction.confirmation.objectLabel,
        ),
        true,
      );
      assert.equal(
        interaction.confirmation.messageText.includes(
          interaction.confirmation.outcomeLabel,
        ),
        true,
      );
    }
    const playerDisclosure = run.interactions.find(
      (interaction) => interaction.id === "player-private-disclosure-vote-and-post",
    );
    const playerPrivateChannel = run.interactions.find(
      (interaction) => interaction.id === "player-private-channel-submit-post-click",
    );
    const routeError = run.interactions.find(
      (interaction) => interaction.id === "route-error-back-to-board-click",
    );
    assert.deepEqual(playerPrivateChannel.route, {
      path: "/g/midsummer/c/private%3Arole_pm%3Aslot-7",
      activeChannelTestId: "player-channel-private:role_pm:slot-7",
      activeChannelHref: "/g/midsummer/c/private%3Arole_pm%3Aslot-7",
      activeChannelCurrent: "page",
      privateReviewHref: "/g/midsummer/c/private%3Arole_pm%3Aslot-7?private=notification-1",
    });
    assert.deepEqual(routeError.errorSurface, {
      path: "/g/midsummer/c/private%3Arole_pm%3Aslot-7",
      status: 403,
      surfaceTestId: "route-error-surface",
      panelTestId: "route-error-panel",
      actionHref: "/",
      activeNavTestId: "role-nav-player",
      activeNavCurrent: "page",
      sessionPrincipal: "player_mira",
      capabilitySummary: "ChannelMember + SlotOccupant",
    });
    assert.equal(playerDisclosure.disclosureBefore.ariaExpanded, "false");
    assert.equal(playerDisclosure.disclosureAfter.ariaExpanded, "true");
    assert.equal(playerDisclosure.disclosureAfter.detailHidden, false);
  }
});

test("in-app browser fixture replay handoff records portable rerun instructions", async () => {
  const handoff = await readJsonArtifact(inAppBrowserReplayHandoffPath);

  assert.equal(handoff.status, "handoff-ready");
  assert.equal(handoff.proof, "in-app-browser-fixture-replay-handoff");
  assert.equal(
    handoff.boundary,
    "Portable handoff for replaying the generated file-backed in-app browser fixture in a Chromium-capable environment. It records the exact fixture file URL, replay command, expected output artifact, planned interaction matrix, and promotion checks. It does not prove browser behavior by itself, fixture freshness after edits, Svelte client hydration, command side effects, TCP transport, WebSocket delivery, dev-server routing, or localhost-backed app acceptance.",
  );
  assert.deepEqual(handoff.generatedFrom, {
    manifest: "target/frontend-in-app-browser-interactions/interaction-page-manifest.json",
    staticDom: "target/frontend-in-app-browser-static-dom/static-dom.json",
    browserRun: "target/frontend-in-app-browser-interactions/browser-run.json",
  });
  assert.equal(
    handoff.fixture.page,
    "target/frontend-in-app-browser-interactions/interaction-page.html",
  );
  assert.match(handoff.fixture.pageUrl, /^file:\/\//);
  assert.equal(handoff.fixture.viewportCount, viewports.length);
  assert.equal(handoff.fixture.commandScenarioCount, EXPECTED_COUNTS.commandScenarios);
  assert.equal(handoff.fixture.hydratedScenarioCount, 6);
  assert.equal(handoff.fixture.plannedInteractionCount, EXPECTED_COUNTS.plannedInteractions);
  assert.equal(handoff.fixture.plannedStabilityCheckCount, 2);
  assert.equal(handoff.fixture.stabilityCheckTileCount, EXPECTED_COUNTS.stabilityCheckTiles);
  assert.deepEqual(
    handoff.fixture.plannedStabilityChecks,
    expectedPlannedStabilityChecks,
  );
  assert.deepEqual(handoff.fixture.moderatorCriticalConfirmationIds, [
    ...moderatorCriticalConfirmationScenarioIds,
  ]);
  assert.deepEqual(handoff.fixture.plannedInteractionIds, [
    "admin-cohost-confirm-click",
    "admin-session-grant-confirm-click",
    "admin-recovery-gate-confirm-click",
    "player-submit-vote-click",
    "player-submit-post-click",
    "player-private-channel-submit-post-click",
    "player-action-target-pick-confirm-click",
    "player-action-withdraw-confirm-click",
    "route-error-back-to-board-click",
    ...moderatorCriticalConfirmationScenarioIds,
    "admin-audit-native-flow",
    "admin-operational-forms",
    "player-private-disclosure-vote-and-post",
    "moderator-host-prompt-confirmation",
    "moderator-slot-lifecycle-confirmation",
  ]);
  assert.deepEqual(handoff.replay, {
    command: "npm run test:frontend-iab-fixture-replay",
    expectedArtifact:
      "target/frontend-in-app-browser-interactions/browser-run.json",
    expectedPassedStatus: "passed",
    freshnessCommands: [
      "npm run test:frontend-iab-interaction-page",
      "npm run test:frontend-iab-static-dom",
    ],
  });
  assert.equal(
    ["passed", "chromium-launch-blocked", "file-navigation-blocked"].includes(
      handoff.latestBrowserRun.status,
    ),
    true,
  );
  assert.equal(
    ["generate-and-run", "replay-existing"].includes(handoff.latestBrowserRun.mode),
    true,
  );
  assert.equal(handoff.latestBrowserRun.plannedInteractionCount, EXPECTED_COUNTS.plannedInteractions);
  assert.equal(handoff.latestBrowserRun.plannedStabilityCheckCount, 2);
  assert.equal(handoff.latestBrowserRun.stabilityCheckTileCount, EXPECTED_COUNTS.stabilityCheckTiles);
  assert.equal(
    handoff.latestBrowserRun.promotionEligible,
    handoff.latestBrowserRun.status === "passed",
  );
  for (const requiredCheck of [
    "target/frontend-in-app-browser-interactions/browser-run.json has status passed.",
    `browser-run plannedInteractions includes ${EXPECTED_COUNTS.plannedInteractions} admin/player/moderator/error interactions.`,
    `browser-run plannedStabilityChecks includes 2 reserved status-floor checks covering ${EXPECTED_COUNTS.stabilityCheckTiles} admin/moderator action tiles.`,
    "route-error interaction includes player private-channel 403 shell evidence.",
    "all reserved status floors advertise and render at least 44px before promotion.",
    `all ${EXPECTED_COUNTS.moderatorCriticalActions} moderator critical host confirmation interactions include alertdialog focus metadata and object/outcome text.`,
    "Treat this as file-backed fixture proof only; full localhost app acceptance is tracked by the localhost dev-server role-smoke lane.",
  ]) {
    assert.equal(handoff.promotionChecks.includes(requiredCheck), true);
  }
});

test("in-app browser imported run contract validates external browser-run evidence", async () => {
  const importedRun = await readJsonArtifact(inAppBrowserImportedRunPath);

  assert.equal(importedRun.proof, "in-app-browser-imported-run-contract");
  assert.equal(
    ["imported-passed", "source-blocked"].includes(importedRun.status),
    true,
  );
  assert.equal(
    importedRun.generatedFrom.manifest,
    "target/frontend-in-app-browser-interactions/interaction-page-manifest.json",
  );
  assert.equal(
    importedRun.generatedFrom.staticDom,
    "target/frontend-in-app-browser-static-dom/static-dom.json",
  );
  assert.equal(
    importedRun.generatedFrom.replayHandoff,
    "target/frontend-in-app-browser-interactions/replay-handoff.json",
  );
  assert.equal(
    [
      "target/frontend-in-app-browser-interactions/browser-run.json",
      "target/frontend-in-app-browser-bundle-import/extracted/target/frontend-in-app-browser-interactions/browser-run.json",
    ].includes(importedRun.generatedFrom.sourceBrowserRun),
    true,
  );
  assert.equal(
    [
      "target/frontend-in-app-browser-interactions/browser-run.json",
      "target/frontend-in-app-browser-bundle-import/extracted/target/frontend-in-app-browser-interactions/browser-run.json",
    ].includes(importedRun.sourceBrowserRun.path),
    true,
  );
  assert.equal(
    ["passed", "chromium-launch-blocked", "file-navigation-blocked"].includes(
      importedRun.sourceBrowserRun.status,
    ),
    true,
  );
  assert.equal(importedRun.validated.plannedInteractionCount, EXPECTED_COUNTS.plannedInteractions);
  assert.equal(importedRun.validated.moderatorCriticalConfirmationCount, 11);
  assert.equal(
    importedRun.promotionEligible,
    importedRun.status === "imported-passed",
  );

  if (importedRun.status === "source-blocked") {
    assert.equal(importedRun.validated.viewportCount, 0);
    assert.equal(importedRun.validated.runCount, 0);
    assert.deepEqual(importedRun.validated.screenshotChecks, []);
    assert.equal(importedRun.blocking.length > 0, true);
    assert.match(importedRun.blocking[0], /expected passed/);
    return;
  }

  assert.equal(importedRun.boundary.includes("without launching Chromium"), true);
  assert.equal(importedRun.validated.viewportCount, viewports.length);
  assert.equal(importedRun.validated.runCount, viewports.length);
  assert.equal(importedRun.validated.screenshotChecks.length, viewports.length);
  for (const check of importedRun.validated.screenshotChecks) {
    assert.equal(typeof check.viewport, "string");
    assert.match(
      check.screenshot,
      /^(target\/frontend-in-app-browser-interactions\/|target\/frontend-in-app-browser-bundle-import\/extracted\/target\/frontend-in-app-browser-interactions\/)/,
    );
    assert.equal(check.screenshotPixels.uniqueColorBuckets >= 8, true);
    assert.equal(check.screenshotPixels.changedPixelRatio >= 0.005, true);
  }
});

test("in-app browser fixture bundle records deterministic portable payload", async () => {
  const bundle = await readJsonArtifact(inAppBrowserFixtureBundleManifestPath);
  const archive = await readFile(inAppBrowserFixtureBundleArchivePath);

  assert.equal(bundle.status, "bundle-ready");
  assert.equal(bundle.proof, "in-app-browser-fixture-replay-bundle");
  assert.equal(
    bundle.boundary,
    "Deterministic tar bundle for carrying the generated in-app browser fixture to a Chromium-capable environment and returning file-backed, localhost-served, and full role-smoke browser evidence for local import validation. The bundle includes the fixture HTML, manifest, replay handoff, latest file and localhost browser-run statuses, imported-run status, latest role-smoke/import status, and any browser-run or role-smoke screenshot PNGs that exist. It does not prove browser behavior by itself, Svelte hydration, command side effects, TCP transport, WebSocket delivery, dev-server routing, or full localhost app acceptance.",
  );
  assert.deepEqual(bundle.generatedFrom, {
    manifest: "target/frontend-in-app-browser-interactions/interaction-page-manifest.json",
    replayHandoff: "target/frontend-in-app-browser-interactions/replay-handoff.json",
    browserRun: "target/frontend-in-app-browser-interactions/browser-run.json",
    localhostBrowserRun:
      "target/frontend-in-app-browser-localhost/browser-run.json",
    importedRun: "target/frontend-in-app-browser-imported-run/imported-run.json",
    roleSmoke: "target/frontend-role-smoke/role-smoke.json",
    importedRoleSmoke:
      "target/frontend-role-smoke-imported/imported-role-smoke.json",
  });
  assert.equal(
    bundle.archive,
    "target/frontend-in-app-browser-bundle/fixture-replay-bundle.tar",
  );
  assert.equal(bundle.archiveFormat, "ustar");
  assert.equal(bundle.archiveSha256, sha256(archive));
  assert.equal(archive.length % 512, 0);
  assert.deepEqual(bundle.deterministic, {
    order: "lexicographic archivePath",
    mtime: 0,
    uid: 0,
    gid: 0,
    mode: "0644",
  });
  const expectedRequiredPayload = [
    "target/frontend-in-app-browser-imported-run/imported-run.json",
    "target/frontend-in-app-browser-interactions/browser-run.json",
    "target/frontend-in-app-browser-interactions/interaction-page-manifest.json",
    "target/frontend-in-app-browser-interactions/interaction-page.html",
    "target/frontend-in-app-browser-interactions/replay-handoff.json",
    "target/frontend-in-app-browser-interactions/replay-handoff.md",
    "target/frontend-in-app-browser-localhost/browser-run.json",
    "target/frontend-role-smoke-imported/imported-role-smoke.json",
    "target/frontend-role-smoke/role-smoke.json",
  ].sort();
  assert.deepEqual(
    bundle.contents.filter((entry) => entry.required).map((entry) => entry.path).sort(),
    expectedRequiredPayload,
  );
  assert.deepEqual(
    parseTarEntryNames(archive),
    bundle.contents.map((entry) => entry.archivePath),
  );
  for (const entry of bundle.contents) {
    assert.match(entry.sha256, /^[a-f0-9]{64}$/);
    assert.equal(entry.bytes > 0, true);
  }
  assert.equal(
    bundle.fixture.plannedInteractionCount,
    EXPECTED_COUNTS.plannedInteractions,
  );
  assert.equal(bundle.fixture.moderatorCriticalConfirmationCount, 11);
  assert.equal(bundle.fixture.plannedStabilityCheckCount, 2);
  assert.equal(bundle.fixture.stabilityCheckTileCount, EXPECTED_COUNTS.stabilityCheckTiles);
  assert.deepEqual(
    bundle.fixture.plannedStabilityChecks,
    expectedPlannedStabilityChecks,
  );
  assert.equal(
    bundle.fixture.screenshotCount,
    bundle.contents.filter((entry) =>
      entry.screenshot &&
      entry.path.startsWith("target/frontend-in-app-browser-interactions/")
    ).length,
  );
  assert.equal(
    bundle.fixture.localhostScreenshotCount,
    bundle.contents.filter((entry) =>
      entry.screenshot &&
      entry.path.startsWith("target/frontend-in-app-browser-localhost/")
    ).length,
  );
  assert.equal(
    bundle.fixture.roleSmokeScreenshotCount,
    bundle.contents.filter((entry) =>
      entry.screenshot && entry.path.startsWith("target/frontend-role-smoke/")
    ).length,
  );
  assert.deepEqual(bundle.commands.freshen, [
    "npm run test:frontend-iab-interaction-page",
    "npm run test:frontend-iab-static-dom",
    "npm run test:frontend-iab-localhost-fixture-smoke",
  ]);
  assert.equal(bundle.commands.replay, "npm run test:frontend-iab-fixture-replay");
  assert.equal(
    bundle.commands.replayLocalhost,
    "npm run test:frontend-iab-localhost-fixture-smoke",
  );
  assert.equal(bundle.commands.replayRoleSmoke, "npm run test:frontend-role-smoke");
  assert.match(bundle.commands.import, /npm run test:frontend-iab-imported-run/);
  assert.match(
    bundle.commands.importRoleSmoke,
    /npm run test:frontend-role-smoke-import/,
  );
  assert.equal(
    ["chromium-launch-blocked", "file-navigation-blocked", "passed"].includes(
      bundle.latest.browserRunStatus,
    ),
    true,
  );
  assert.equal(
    [
      "localhost-bind-blocked",
      "chromium-launch-blocked",
      "localhost-navigation-blocked",
      "passed",
    ].includes(bundle.latest.localhostBrowserRunStatus),
    true,
  );
  assert.equal(
    ["source-blocked", "imported-passed"].includes(bundle.latest.importedRunStatus),
    true,
  );
  assert.equal(
    ["static-dom-fallback-passed", "passed"].includes(bundle.latest.roleSmokeStatus),
    true,
  );
  assert.equal(
    ["source-blocked", "imported-passed"].includes(
      bundle.latest.importedRoleSmokeStatus,
    ),
    true,
  );
});

test("in-app browser fixture bundle import validates returned archive", async () => {
  const bundleImport = await readJsonArtifact(inAppBrowserFixtureBundleImportPath);
  const archive = await readFile(inAppBrowserFixtureBundleArchivePath);

  assert.equal(bundleImport.proof, "in-app-browser-fixture-bundle-import");
  assert.equal(
    ["bundle-imported-passed", "bundle-source-blocked"].includes(bundleImport.status),
    true,
  );
  assert.equal(
    bundleImport.boundary,
    "Validates a returned deterministic in-app browser fixture bundle without launching Chromium. It parses the tar payload, verifies required fixture/replay/import/role-smoke files, extracts the bundle into a local proof directory, restores returned localhost fixture browser-run artifacts, then runs the imported browser-run contract against the extracted file-backed browser-run.json and the imported role-smoke contract against the extracted role-smoke.json. It promotes imported file evidence only when that imported-run contract is imported-passed, and it lets the browser-acceptance boundary separately evaluate the restored localhost fixture artifact and imported full role-smoke artifact. It does not prove Svelte hydration, command side effects, TCP transport, WebSocket delivery, dev-server routing, or full localhost app acceptance.",
  );
  assert.deepEqual(bundleImport.generatedFrom, {
    sourceArchive:
      "target/frontend-in-app-browser-bundle/fixture-replay-bundle.tar",
    importedRun: "target/frontend-in-app-browser-imported-run/imported-run.json",
    importedRoleSmoke:
      "target/frontend-role-smoke-imported/imported-role-smoke.json",
    restoredLocalhostBrowserRun:
      "target/frontend-in-app-browser-localhost/browser-run.json",
  });
  assert.equal(
    bundleImport.archive.path,
    "target/frontend-in-app-browser-bundle/fixture-replay-bundle.tar",
  );
  assert.equal(bundleImport.archive.sha256, sha256(archive));
  assert.equal(bundleImport.archive.entryCount >= 6, true);
  const importedEntryPaths = bundleImport.archive.entries.map((entry) => entry.path);
  for (const requiredPath of [
    "target/frontend-in-app-browser-imported-run/imported-run.json",
    "target/frontend-in-app-browser-interactions/browser-run.json",
    "target/frontend-in-app-browser-interactions/interaction-page-manifest.json",
    "target/frontend-in-app-browser-interactions/interaction-page.html",
    "target/frontend-in-app-browser-interactions/replay-handoff.json",
    "target/frontend-in-app-browser-interactions/replay-handoff.md",
    "target/frontend-in-app-browser-localhost/browser-run.json",
    "target/frontend-role-smoke-imported/imported-role-smoke.json",
    "target/frontend-role-smoke/role-smoke.json",
  ]) {
    assert.equal(importedEntryPaths.includes(requiredPath), true);
  }
  assert.deepEqual(bundleImport.extracted, {
    root: "target/frontend-in-app-browser-bundle-import/extracted",
    browserRun:
      "target/frontend-in-app-browser-bundle-import/extracted/target/frontend-in-app-browser-interactions/browser-run.json",
    localhostBrowserRun:
      "target/frontend-in-app-browser-bundle-import/extracted/target/frontend-in-app-browser-localhost/browser-run.json",
    roleSmoke:
      "target/frontend-in-app-browser-bundle-import/extracted/target/frontend-role-smoke/role-smoke.json",
  });
  assert.equal(
    bundleImport.restored.localhostArtifacts.includes(
      "target/frontend-in-app-browser-localhost/browser-run.json",
    ),
    true,
  );
  assert.equal(
    ["imported-passed", "source-blocked"].includes(bundleImport.importedRun.status),
    true,
  );
  assert.equal(
    bundleImport.promotionEligible,
    bundleImport.status === "bundle-imported-passed",
  );
  assert.equal(bundleImport.importedRun.validated.plannedInteractionCount, EXPECTED_COUNTS.plannedInteractions);
  assert.equal(
    bundleImport.importedRun.validated.moderatorCriticalConfirmationCount,
    11,
  );
  assert.equal(bundleImport.importedRun.validated.plannedStabilityCheckCount, 2);
  assert.equal(bundleImport.importedRun.validated.stabilityCheckTileCount, EXPECTED_COUNTS.stabilityCheckTiles);
  if (bundleImport.status === "bundle-source-blocked") {
    assert.equal(bundleImport.importedRun.blocking.length > 0, true);
  }
  assert.equal(
    ["imported-passed", "source-blocked"].includes(
      bundleImport.importedRoleSmoke.status,
    ),
    true,
  );
  assert.equal(
    bundleImport.importedRoleSmoke.promotionEligible,
    bundleImport.importedRoleSmoke.status === "imported-passed",
  );
  assert.equal(
    Number.isInteger(bundleImport.importedRoleSmoke.validated.screenshotCheckCount),
    true,
  );
  if (bundleImport.importedRoleSmoke.status === "source-blocked") {
    assert.equal(bundleImport.importedRoleSmoke.blocking.length > 0, true);
  }
});

test("in-app browser operator runbook records external replay workflow", async () => {
  const runbook = await readJsonArtifact(inAppBrowserOperatorRunbookPath);

  assert.equal(runbook.proof, "in-app-browser-external-replay-operator-runbook");
  assert.equal(
    ["awaiting-external-browser-replay", "browser-evidence-imported"].includes(
      runbook.status,
    ),
    true,
  );
  assert.equal(
    runbook.boundary,
    "Operator runbook for moving the generated in-app browser fixture and full role-smoke proof through one external Chromium-capable replay bundle and back into local import validation. It records exact commands, expected returned files, and current proof statuses for file-backed fixture, localhost-served fixture, and role-smoke runs. It does not prove browser behavior by itself, Svelte hydration, command side effects, TCP transport, WebSocket delivery, dev-server routing, or full localhost app acceptance.",
  );
  assert.deepEqual(runbook.generatedFrom, {
    bundleManifest: "target/frontend-in-app-browser-bundle/bundle-manifest.json",
    bundleImport: "target/frontend-in-app-browser-bundle-import/bundle-import.json",
    replayHandoff: "target/frontend-in-app-browser-interactions/replay-handoff.json",
    importedRun: "target/frontend-in-app-browser-imported-run/imported-run.json",
    importedRoleSmoke:
      "target/frontend-role-smoke-imported/imported-role-smoke.json",
    completionAudit: "target/frontend-completion-audit/completion-audit.json",
    readinessSummary: "target/frontend-readiness-summary/readiness-summary.json",
  });
  assert.equal(runbook.currentStatus.bundle, "bundle-ready");
  assert.equal(
    ["bundle-imported-passed", "bundle-source-blocked"].includes(
      runbook.currentStatus.bundleImport,
    ),
    true,
  );
  assert.equal(
    ["imported-passed", "source-blocked"].includes(runbook.currentStatus.importedRun),
    true,
  );
  assert.equal(
    ["imported-passed", "source-blocked"].includes(
      runbook.currentStatus.importedRoleSmoke,
    ),
    true,
  );
  assert.equal(
    ["complete", "not_complete"].includes(runbook.currentStatus.completionAudit),
    true,
  );
  assert.equal(
    ["complete", "not_complete"].includes(runbook.currentStatus.readiness),
    true,
  );
  assert.equal(
    ["passed", "chromium-launch-blocked", "file-navigation-blocked"].includes(
      runbook.currentStatus.browserRunStatus,
    ),
    true,
  );
  assert.equal(
    [
      "passed",
      "localhost-bind-blocked",
      "chromium-launch-blocked",
      "localhost-navigation-blocked",
    ].includes(runbook.currentStatus.localhostBrowserRunStatus),
    true,
  );
  assert.equal(typeof runbook.currentStatus.promotionEligible, "boolean");
  assert.deepEqual(runbook.fixture, {
    plannedInteractionCount: EXPECTED_COUNTS.plannedInteractions,
    moderatorCriticalConfirmationCount: EXPECTED_COUNTS.moderatorCriticalActions,
    plannedStabilityCheckCount: 2,
    stabilityCheckTileCount: EXPECTED_COUNTS.stabilityCheckTiles,
    plannedStabilityChecks: expectedPlannedStabilityChecks,
  });
  assert.equal(
    runbook.artifacts.exportBundle,
    "target/frontend-in-app-browser-bundle/fixture-replay-bundle.tar",
  );
  assert.match(runbook.artifacts.exportBundleSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(
    runbook.workflow.map((step) => [step.step, step.where, step.command]),
    [
      [
        "freshen-local-fixture",
        "local sandbox",
        "npm run test:frontend-iab-interaction-page && npm run test:frontend-iab-static-dom && npm run test:frontend-iab-localhost-fixture-smoke && npm run test:frontend-iab-fixture-handoff && FMARCH_ALLOW_STATIC_ROLE_FALLBACK=1 npm run test:frontend-role-smoke && npm run test:frontend-role-smoke-import && npm run test:frontend-iab-fixture-bundle",
      ],
      [
        "unpack-on-chromium-runner",
        "Chromium-capable repo checkout",
        "tar -xf target/frontend-in-app-browser-bundle/fixture-replay-bundle.tar",
      ],
      [
        "replay-file-fixture-and-role-smoke",
        "Chromium-capable repo checkout",
        "npm run test:frontend-iab-fixture-replay && npm run test:frontend-iab-localhost-fixture-smoke && npm run test:frontend-role-smoke && npm run test:frontend-role-smoke-import && npm run test:frontend-iab-fixture-bundle",
      ],
      [
        "import-returned-bundle",
        "local sandbox",
        "FMARCH_IAB_FIXTURE_BUNDLE_IMPORT=<returned>/fixture-replay-bundle.tar npm run test:frontend-iab-fixture-bundle-import && npm run test:frontend-browser-acceptance-boundary && npm run test:frontend-completion-audit && npm run test:frontend-readiness-summary",
      ],
    ],
  );
  for (const check of [
    "returned browser-run.json has status passed",
    "returned localhost browser-run.json has status passed when proving the localhost-served fixture lane",
    `returned browser-run plannedStabilityChecks includes 2 reserved status-floor checks covering ${EXPECTED_COUNTS.stabilityCheckTiles} admin/moderator action tiles`,
    "all returned reserved status floors render at least 44px before promotion",
    "returned bundle includes browser-run-*.png screenshot files for every proof viewport",
    "returned bundle includes localhost browser-run-*.png screenshot files for every proof viewport when localhost fixture browser-run passed",
    "npm run test:frontend-iab-fixture-bundle-import writes imported role-smoke as imported-passed when returned role-smoke evidence is complete",
    "npm run test:frontend-completion-audit records imported browser evidence before readiness is summarized",
    "npm run test:frontend-browser-acceptance-boundary marks in-app-localhost-fixture-browser-run proven when restored localhost fixture browser-run passed",
    "npm run test:frontend-browser-acceptance-boundary marks imported-localhost-role-smoke proven when returned role-smoke passed",
    "full localhost app acceptance is tracked by the localhost dev-server role-smoke lane; fixture replay lanes are diagnostic browser evidence, not a replacement for that full app lane",
  ]) {
    assert.equal(runbook.promotionChecks.includes(check), true);
  }
  if (runbook.currentStatus.promotionEligible) {
    assert.deepEqual(runbook.blocking, []);
  } else {
    assert.equal(runbook.blocking.length > 0, true);
  }
});

test("in-app browser replay help records condensed external proof commands", async () => {
  const replayHelp = await readJsonArtifact(inAppBrowserReplayHelpPath);

  assert.equal(replayHelp.proof, "in-app-browser-external-replay-help");
  assert.equal(
    ["ready-for-external-replay", "replay-evidence-imported"].includes(
      replayHelp.status,
    ),
    true,
  );
  assert.equal(
    replayHelp.boundary,
    "Condensed operator helper for replaying the generated in-app browser fixture plus full role-smoke outside the sandbox and importing the returned bundle. It records exact commands, route-error promotion requirements, returned files, and current proof status for file-backed fixture, localhost-served fixture, and role-smoke browser runs. It does not prove browser behavior by itself, Svelte hydration, command side effects, TCP transport, WebSocket delivery, dev-server routing, or full localhost app acceptance.",
  );
  assert.deepEqual(replayHelp.generatedFrom, {
    manifest: "target/frontend-in-app-browser-interactions/interaction-page-manifest.json",
    replayHandoff: "target/frontend-in-app-browser-interactions/replay-handoff.json",
    bundleManifest: "target/frontend-in-app-browser-bundle/bundle-manifest.json",
    operatorRunbook: "target/frontend-in-app-browser-operator-runbook/runbook.json",
  });
  assert.equal(
    replayHelp.fixture.page,
    "target/frontend-in-app-browser-interactions/interaction-page.html",
  );
  assert.match(replayHelp.fixture.pageUrl, /^file:\/\//);
  assert.deepEqual(replayHelp.fixture.viewports, viewports);
  assert.equal(replayHelp.fixture.commandScenarioCount, EXPECTED_COUNTS.commandScenarios);
  assert.equal(replayHelp.fixture.hydratedScenarioCount, 6);
  assert.equal(replayHelp.fixture.plannedInteractionCount, EXPECTED_COUNTS.plannedInteractions);
  assert.equal(replayHelp.fixture.plannedStabilityCheckCount, 2);
  assert.equal(replayHelp.fixture.stabilityCheckTileCount, EXPECTED_COUNTS.stabilityCheckTiles);
  assert.deepEqual(
    replayHelp.fixture.plannedStabilityChecks,
    expectedPlannedStabilityChecks,
  );
  assert.equal(
    replayHelp.fixture.plannedInteractionIds.includes(
      "route-error-back-to-board-click",
    ),
    true,
  );
  assert.deepEqual(replayHelp.fixture.routeErrorScenario, {
    id: "route-error-back-to-board-click",
    targetTestId: "route-error-action",
    expectedText: "Back to board",
    errorSurface: {
      path: "/g/midsummer/c/private%3Arole_pm%3Aslot-7",
      status: 403,
      surfaceTestId: "route-error-surface",
      panelTestId: "route-error-panel",
      actionHref: "/",
      activeNavTestId: "role-nav-player",
      sessionPrincipal: "player_mira",
      capabilitySummary: "ChannelMember + SlotOccupant",
    },
  });
  assert.equal(
    replayHelp.bundle.archive,
    "target/frontend-in-app-browser-bundle/fixture-replay-bundle.tar",
  );
  assert.match(replayHelp.bundle.archiveSha256, /^[a-f0-9]{64}$/);
  assert.equal(replayHelp.bundle.contents >= 6, true);
  assert.equal(
    replayHelp.commands.freshenLocal,
    "npm run test:frontend-iab-interaction-page && npm run test:frontend-iab-static-dom && npm run test:frontend-iab-localhost-fixture-smoke && npm run test:frontend-iab-fixture-handoff && FMARCH_ALLOW_STATIC_ROLE_FALLBACK=1 npm run test:frontend-role-smoke && npm run test:frontend-role-smoke-import && npm run test:frontend-iab-fixture-bundle && npm run test:frontend-iab-operator-runbook",
  );
  assert.equal(
    replayHelp.commands.replayOnChromiumRunner,
    "tar -xf target/frontend-in-app-browser-bundle/fixture-replay-bundle.tar && npm run test:frontend-iab-fixture-replay && npm run test:frontend-iab-localhost-fixture-smoke && npm run test:frontend-role-smoke && npm run test:frontend-role-smoke-import && npm run test:frontend-iab-fixture-bundle",
  );
  assert.equal(
    replayHelp.commands.importReturnedBundle,
    "FMARCH_IAB_FIXTURE_BUNDLE_IMPORT=<returned>/fixture-replay-bundle.tar npm run test:frontend-iab-fixture-bundle-import && npm run test:frontend-browser-acceptance-boundary && npm run test:frontend-completion-audit && npm run test:frontend-readiness-summary && npm run test:frontend-iab-operator-runbook && npm run test:frontend-iab-replay-help",
  );
  assert.deepEqual(replayHelp.expectedReturnedFiles, [
    "target/frontend-in-app-browser-interactions/browser-run.json",
    "target/frontend-in-app-browser-interactions/browser-run-*.png",
    "target/frontend-in-app-browser-localhost/browser-run.json",
    "target/frontend-in-app-browser-localhost/browser-run-*.png",
    "target/frontend-role-smoke/role-smoke.json",
    "target/frontend-role-smoke/*.png",
    "target/frontend-in-app-browser-bundle/fixture-replay-bundle.tar",
  ]);
  for (const check of [
    "returned browser-run.json has status passed",
    "returned localhost browser-run.json has status passed when proving the localhost-served fixture lane",
    `returned browser-run plannedInteractions includes ${EXPECTED_COUNTS.plannedInteractions} admin/player/moderator/error interactions`,
    `returned browser-run plannedStabilityChecks includes 2 reserved status-floor checks covering ${EXPECTED_COUNTS.stabilityCheckTiles} admin/moderator action tiles`,
    "all returned reserved status floors render at least 44px before promotion",
    "route-error-back-to-board-click records 403 player private-channel shell evidence and Back to board click/focus evidence",
    "returned role-smoke.json has status passed with referenced role-smoke screenshots",
    "bundle import writes imported role-smoke as imported-passed",
    "browser acceptance boundary marks in-app-file-browser-run proven",
    "browser acceptance boundary marks in-app-localhost-fixture-browser-run proven when restored localhost fixture browser-run passed",
    "browser acceptance boundary marks imported-localhost-role-smoke proven when returned role-smoke passed",
    "completion audit records imported browser evidence before readiness is summarized",
  ]) {
    assert.equal(replayHelp.promotionChecks.includes(check), true);
  }
  assert.equal(
    ["bundle-source-blocked", "bundle-imported-passed"].includes(
      replayHelp.currentStatus.bundleImport,
    ),
    true,
  );
});

test("browser acceptance boundary records blocked and prepared browser lanes", async () => {
  const boundary = await readJsonArtifact(browserAcceptanceBoundaryPath);

  assert.equal(["passed", "incomplete"].includes(boundary.status), true);
  assert.equal(boundary.proof, "frontend-browser-acceptance-boundary");
  assert.deepEqual(boundary.generatedFrom, {
    roleSmoke: "target/frontend-role-smoke/role-smoke.json",
    renderSmoke: "target/frontend-role-render-smoke/render-smoke.json",
    noBindInteractions:
      "target/frontend-no-bind-interactions/no-bind-interactions.json",
    keyboardTraversal: "target/frontend-keyboard-traversal/keyboard-traversal.json",
    inAppBrowserPage:
      "target/frontend-in-app-browser-interactions/interaction-page-manifest.json",
    inAppBrowserStaticDom:
      "target/frontend-in-app-browser-static-dom/static-dom.json",
    inAppBrowserRun:
      "target/frontend-in-app-browser-interactions/browser-run.json",
    inAppBrowserLocalhostRun:
      "target/frontend-in-app-browser-localhost/browser-run.json",
    inAppBrowserImportedRun:
      "target/frontend-in-app-browser-imported-run/imported-run.json",
    importedRoleSmoke:
      "target/frontend-role-smoke-imported/imported-role-smoke.json",
  });
  assert.equal(
    boundary.boundary,
    "Generated browser acceptance boundary over the current frontend proof artifacts. It distinguishes proven browser evidence from blocked or prepared-only lanes, and does not promote model/SSR/DOM evidence to hydrated browser acceptance.",
  );
  assert.equal(
    boundary.promotionRule,
    "Full app browser acceptance is proven by the localhost dev-server role smoke, either run locally or imported through the role-smoke import contract, when it passes with board, setup, admin, player, moderator, forbidden-route, and route-state screenshots, screenshot pixel evidence, setup workbench geometry for /g/midsummer/setup, overlap-checked target evidence, tablet thumb-zone geometry evidence, admin session-grant/recovery-gate form evidence, player main-thread SubmitPost ACK refresh evidence, player private:role_pm:slot-7 SubmitPost ACK evidence, player tablet-media browser request evidence, and moderator SetSlotStatus projection evidence. Passed file-backed or localhost-served fixture browser-runs promote their fixture lanes only; prepared fixtures, bind blocks, and Chromium launch blocks do not promote full app acceptance.",
  );
  const laneById = new Map(boundary.lanes.map((lane) => [lane.id, lane]));
  assert.deepEqual([...laneById.keys()], [
    "localhost-dev-server-role-smoke",
    "chromium-no-bind-render",
    "chromium-no-bind-interactions",
    "chromium-no-bind-keyboard",
    "in-app-file-static-dom",
    "in-app-file-backed-fixture",
    "in-app-file-browser-run",
    "in-app-localhost-fixture-browser-run",
    "in-app-file-imported-browser-run",
    "imported-localhost-role-smoke",
  ]);
  assert.equal(laneById.get("localhost-dev-server-role-smoke").promotionEligible, true);
  assert.equal(laneById.get("chromium-no-bind-render").promotionEligible, false);
  assert.equal(laneById.get("in-app-file-static-dom").status, "proven");
  assert.equal(laneById.get("in-app-file-backed-fixture").status, "fixture_prepared");
  assert.equal(laneById.get("imported-localhost-role-smoke").promotionEligible, true);
  if (boundary.status === "passed") {
    assert.equal(boundary.overall.state, "browser_proven");
    assert.deepEqual(boundary.overall.blockers, []);
  } else {
    assert.equal(boundary.overall.state, "not_complete");
    assert.equal(boundary.overall.blockers.length > 0, true);
  }
  assert.equal(boundary.overall.diagnosticBlockers.length > 0, true);
});

test("role smoke artifact carries the same static matrices as its proof source", async () => {
  const staticContract = await readJsonArtifact(staticContractPath);
  const roleSmoke = await readJsonArtifact(roleSmokePath);

  if (roleSmoke.status === "passed") {
    assert.deepEqual(roleSmoke.viewports, viewports);
    assert.deepEqual(roleSmoke.navFocusCoverage.surfaces, navFocusCoverage.surfaces);
    assert.equal(roleSmoke.board.length, viewports.length);
    assertPixelEvidence(roleSmoke.board, "board screenshots");
    assertPixelEvidence(roleSmoke.roles, "role screenshots");
    assertBrowserSetupWorkbenchEvidence(roleSmoke.setup);
    assertBrowserConfirmationFocusEvidence(roleSmoke.roles);
    assertBrowserPlayerPrivateDisclosureEvidence(roleSmoke.roles);
    assertBrowserPlayerPrivateChannelEvidence(roleSmoke.playerPrivateChannel);
    assertBrowserAdminAuditDetailClickEvidence(roleSmoke.roles);
    assert.deepEqual(
      roleSmoke.routeStates.map((scenario) => [
        scenario.viewport.name,
        scenario.role,
        scenario.path,
      ]),
      viewports.flatMap((viewport) =>
        routeStateScenarios.map((scenario) => [
          viewport.name,
          scenario.role,
          scenario.path,
        ]),
      ),
    );
    assertPixelEvidence(roleSmoke.routeStates, "route-state screenshots");
    return;
  }

  assert.ok(
    [
      "static-dom-fallback-passed",
      "static-fallback-passed",
      "static-render-fallback-passed",
    ].includes(
      roleSmoke.status,
    ),
    `unexpected fallback status ${roleSmoke.status}`,
  );
  assert.equal(
    roleSmoke.fallback.command,
    "npm run test:frontend-static-role-contract && npm run test:frontend-role-dom-smoke && npm run test:frontend-role-render-smoke",
  );
  assert.equal(roleSmoke.fallback.artifact, "target/frontend-static-role-contract/role-contract.json");
  assert.equal(
    roleSmoke.fallback.domArtifact,
    "target/frontend-role-dom-smoke/dom-smoke.json",
  );
  assert.equal(
    roleSmoke.fallback.renderArtifact,
    "target/frontend-role-render-smoke/render-smoke.json",
  );
  assert.equal(roleSmoke.staticRoleContract.status, staticContract.status);
  assert.equal(roleSmoke.staticRoleContract.proof, staticContract.proof);
  assert.deepEqual(
    roleSmoke.staticRoleContract.appShellContract,
    staticContract.appShellContract,
  );
  assert.deepEqual(
    roleSmoke.staticRoleContract.navFocusCoverage,
    staticContract.navFocusCoverage,
  );
  assert.deepEqual(
    roleSmoke.staticRoleContract.linkAffordanceCoverage,
    staticContract.linkAffordanceCoverage,
  );
  assert.deepEqual(
    roleSmoke.staticRoleContract.routeStateCoverage,
    staticContract.routeStateCoverage,
  );
  assert.deepEqual(
    roleSmoke.staticRoleContract.routeStateFixtureCoverage,
    staticContract.routeStateFixtureCoverage,
  );
  assert.deepEqual(
    roleSmoke.staticRoleContract.firstViewportSmokeCoverage,
    staticContract.firstViewportSmokeCoverage,
  );
  assert.deepEqual(
    roleSmoke.staticRoleContract.firstViewportLayoutContract,
    staticContract.firstViewportLayoutContract,
  );
  assert.deepEqual(
    roleSmoke.staticRoleContract.confirmationCoverage,
    staticContract.confirmationCoverage,
  );
  assert.deepEqual(
    roleSmoke.staticRoleContract.navFocusCoverage.surfaces,
    navFocusCoverage.surfaces,
  );
  await assertRoleDomFallbackEvidence(roleSmoke);
  assertRoleRenderFallbackEvidence(roleSmoke);
});

test("imported role smoke artifact validates or preserves full-app browser evidence boundary", async () => {
  const imported = await readJsonArtifact(importedRoleSmokePath);

  assert.equal(
    ["imported-passed", "source-blocked"].includes(imported.status),
    true,
  );
  assert.equal(imported.proof, "frontend-role-smoke-imported-contract");
  assert.deepEqual(imported.generatedFrom, {
    sourceRoleSmoke: "target/frontend-role-smoke/role-smoke.json",
  });
  assert.equal(imported.sourceRoleSmoke.path, "target/frontend-role-smoke/role-smoke.json");

  if (imported.status === "imported-passed") {
    assert.equal(imported.promotionEligible, true);
    assert.equal(imported.validated.viewportCount, viewports.length);
    assert.equal(imported.validated.boardCount, viewports.length);
    assert.equal(imported.validated.roleCount, viewports.length * roles.length);
    assert.equal(imported.validated.setupCount, setupViewports.length);
    assert.equal(imported.validated.playerPrivateChannelCount, viewports.length);
    assert.equal(imported.validated.routeStateCount, viewports.length * routeStateScenarios.length);
    assert.equal(imported.validated.forbiddenRouteCount, viewports.length * forbiddenRoutes.length);
    assert.equal(imported.validated.screenshotCheckCount > 0, true);
    assert.equal(imported.blocking.length, 0);
    return;
  }

  assert.equal(imported.promotionEligible, false);
  assert.equal(imported.validated.viewportCount, 0);
  assert.equal(imported.blocking.length > 0, true);
  assert.equal(
    imported.blocking.some((entry) =>
      entry.includes("source role-smoke status"),
    ),
    true,
  );
});

test("frontend completion audit summarizes proven and blocked requirements", async () => {
  const audit = await readJsonArtifact(completionAuditPath);

  assert.equal(["passed", "incomplete"].includes(audit.status), true);
  assert.equal(audit.proof, "frontend-completion-audit");
  assert.deepEqual(audit.generatedFrom, {
    staticContract: "target/frontend-static-role-contract/role-contract.json",
    routeStateRender: "target/frontend-route-state-render/route-state-render.json",
    dispatchBridge: "target/frontend-dispatch-bridge/dispatch-bridge.json",
    hydratedHandlers: "target/frontend-hydrated-handlers/hydrated-handlers.json",
    hydratedSurfaces: "target/frontend-hydrated-surfaces/hydrated-surfaces.json",
    componentInteractions:
      "target/frontend-component-interactions/component-interactions.json",
    hostConfirmations:
      "target/frontend-host-confirmation-static-dom/static-dom.json",
    noBindInteractions:
      "target/frontend-no-bind-interactions/no-bind-interactions.json",
    staticFocusability:
      "target/frontend-static-focusability/focusability.json",
    tabletInteraction:
      "target/frontend-tablet-interaction/tablet-interaction.json",
    routeLive:
      "target/frontend-route-live-contract/route-live-contract.json",
    keyboardTraversal:
      "target/frontend-keyboard-traversal/keyboard-traversal.json",
    domSmoke: "target/frontend-role-dom-smoke/dom-smoke.json",
    renderSmoke: "target/frontend-role-render-smoke/render-smoke.json",
    roleSmoke: "target/frontend-role-smoke/role-smoke.json",
    inAppBrowserPage:
      "target/frontend-in-app-browser-interactions/interaction-page-manifest.json",
    inAppBrowserStaticDom:
      "target/frontend-in-app-browser-static-dom/static-dom.json",
    inAppBrowserRun:
      "target/frontend-in-app-browser-interactions/browser-run.json",
    inAppBrowserLocalhostRun:
      "target/frontend-in-app-browser-localhost/browser-run.json",
    inAppBrowserImportedRun:
      "target/frontend-in-app-browser-imported-run/imported-run.json",
    importedRoleSmoke:
      "target/frontend-role-smoke-imported/imported-role-smoke.json",
    browserAcceptanceBoundary:
      "target/frontend-browser-acceptance-boundary/browser-acceptance-boundary.json",
  });
  const expectedRequirementStates =
    audit.status === "passed"
      ? [
          ["shared-app-shell", "browser_proven"],
          ["tablet-native-interaction-posture", "browser_proven"],
          ["single-root-shell-architecture", "ssr_and_source_proven"],
          ["host-setup-workbench", "browser_proven"],
          ["player-surface", "browser_proven"],
          ["moderator-host-surface", "browser_proven"],
          ["admin-operator-surface", "browser_proven"],
          ["route-states", "browser_proven"],
          ["route-error-shell", "browser_proven"],
          ["browser-acceptance", "browser_proven"],
        ]
      : [
          ["shared-app-shell", "dom_proven_browser_blocked"],
          [
            "tablet-native-interaction-posture",
            "source_css_ssr_proven_browser_blocked",
          ],
          ["single-root-shell-architecture", "ssr_and_source_proven"],
          ["host-setup-workbench", "browser_geometry_missing"],
          ["player-surface", "dom_and_model_proven_browser_blocked"],
          ["moderator-host-surface", "dom_and_model_proven_browser_blocked"],
          ["admin-operator-surface", "dom_and_model_proven_browser_blocked"],
          ["route-states", "ssr_and_dom_proven"],
          ["route-error-shell", "ssr_and_dom_proven"],
          ["browser-acceptance", "blocked_by_localhost_and_chromium_sandbox"],
        ];
  assert.deepEqual(
    audit.requirements.map((requirement) => [requirement.id, requirement.state]),
    expectedRequirementStates,
  );
  for (const requirement of audit.requirements) {
    assert.equal(requirement.proven.length > 0, true);
    assert.equal(requirement.evidence.length > 0, true);
    if (audit.status === "passed" && requirement.id === "browser-acceptance") {
      if (requirement.missing.length > 0) {
        assert.deepEqual(requirement.missing, [
          "localhost bind is denied before dev-server browser proof can run.",
          "The imported file-backed browser-run does not prove Svelte hydration, command dispatch side effects, TCP transport, WebSocket delivery, dev-server routing, or localhost app acceptance.",
        ]);
      }
    } else if (audit.status === "passed") {
      assert.equal(requirement.missing.length, 0);
    } else if (requirement.id !== "single-root-shell-architecture") {
      assert.equal(requirement.missing.length > 0, true);
    }
  }
  const playerRequirement = audit.requirements.find(
    (requirement) => requirement.id === "player-surface",
  );
  const moderatorRequirement = audit.requirements.find(
    (requirement) => requirement.id === "moderator-host-surface",
  );
  const routeErrorRequirement = audit.requirements.find(
    (requirement) => requirement.id === "route-error-shell",
  );
  const tabletRequirement = audit.requirements.find(
    (requirement) => requirement.id === "tablet-native-interaction-posture",
  );
  const hostSetupRequirement = audit.requirements.find(
    (requirement) => requirement.id === "host-setup-workbench",
  );
  const browserRequirement = audit.requirements.find(
    (requirement) => requirement.id === "browser-acceptance",
  );
  assert.deepEqual(tabletRequirement.evidence, [
    "tabletInteraction.forbiddenMatches",
    "tabletInteraction.sharedAppCss",
    "tabletInteraction.adminOperatorSurfaceCss",
    "tabletInteraction.playerRouteLayoutCss",
    "tabletInteraction.moderatorControlSurfaceCss",
    "tabletInteraction.hostTouchCss",
    "tabletInteraction.thumbZones",
  ]);
  assert.deepEqual(hostSetupRequirement.evidence, [
    "roleSmoke.setup",
    "roleSmoke.setup[*].slotCards",
    "roleSmoke.setup[*].screenshotPixels",
    "importedRoleSmoke.validated.setupCount",
    "importedRoleSmoke.validated.screenshotChecks",
    "browserAcceptanceBoundary.lanes[localhost-dev-server-role-smoke]",
    "browserAcceptanceBoundary.lanes[imported-localhost-role-smoke]",
  ]);
  assert.equal(
    hostSetupRequirement.proven.some((entry) =>
      entry.includes("/g/midsummer/setup") &&
      entry.includes("slot workbench"),
    ),
    true,
  );
  assert.equal(
    tabletRequirement.proven.some((entry) =>
      entry.includes("frontend/src .css/.html/.js/.mjs/.svelte") &&
      entry.includes("hover-preload-trigger"),
    ),
    true,
  );
  assert.equal(playerRequirement.evidence.includes("routeLive.runtime[player]"), true);
  assert.equal(
    playerRequirement.evidence.includes("staticContract.roles[player].threadPager"),
    true,
  );
  assert.equal(
    playerRequirement.evidence.includes("hydratedSurfaces.player.threadPager"),
    true,
  );
  assert.equal(
    playerRequirement.evidence.includes("routeStateRender.playerSurface.threadPager"),
    true,
  );
  assert.equal(
    playerRequirement.evidence.includes(
      "inAppBrowserPage.hydratedSurfaceScenarios[player].threadPager",
    ),
    true,
  );
  assert.equal(
    playerRequirement.evidence.includes(
      "inAppBrowserStaticDom.hydratedSurfaceScenarios[player].threadPager",
    ),
    true,
  );
  assert.equal(
    playerRequirement.evidence.includes("routeStateRender.playerSurface.media"),
    true,
  );
  assert.equal(
    moderatorRequirement.evidence.includes("routeLive.runtime[moderator]"),
    true,
  );
  assert.deepEqual(routeErrorRequirement.evidence, [
    "routeStateRender.errorSurface",
    "domSmoke.errorSurface",
  ]);
  assert.equal(
    browserRequirement.evidence.includes(
      "browserAcceptanceBoundary.lanes[in-app-file-imported-browser-run]",
    ),
    true,
  );
  assert.equal(
    routeErrorRequirement.proven.some((entry) =>
      entry.includes("real SvelteKit error page"),
    ),
    true,
  );
  assert.equal(audit.overall.state, audit.status === "passed" ? "complete" : "not_complete");
  const singleRootShellRequirement = audit.requirements.find(
    (requirement) => requirement.id === "single-root-shell-architecture",
  );
  assert.deepEqual(singleRootShellRequirement.missing, []);
  assert.equal(
    singleRootShellRequirement.evidence.includes("routeStateRender.singleRootShell"),
    true,
  );
});

test("frontend readiness summary reports role proof layers without promoting browser blocks", async () => {
  const summary = await readJsonArtifact(readinessSummaryPath);

  assert.equal(["passed", "incomplete"].includes(summary.status), true);
  assert.equal(summary.proof, "frontend-readiness-summary");
  assert.equal(
    summary.overall.state,
    summary.status === "passed" ? "complete" : "not_complete",
  );
  assert.equal(summary.roles.find((role) => role.id === "admin").surfaces.routeLive, "not_applicable");
  assert.equal(summary.roles.find((role) => role.id === "player").surfaces.routeLive, "proven");
  assert.equal(summary.roles.find((role) => role.id === "moderator").surfaces.routeLive, "proven");
  assert.deepEqual(summary.shared.singleRootShell.requirement, {
    id: "single-root-shell-architecture",
    label: "Single root-owned app shell architecture",
    state: "ssr_and_source_proven",
    proven: summary.shared.singleRootShell.requirement.proven,
    missing: [],
  });
  assert.deepEqual(summary.shared.singleRootShell.surfaceShellCounts, [
    { id: "board-player", shellComponentCount: 1 },
    { id: "admin", shellComponentCount: 1 },
    { id: "player", shellComponentCount: 1 },
    { id: "moderator", shellComponentCount: 1 },
  ]);
  assert.equal(
    summary.shared.singleRootShell.routeStateShellCounts.every(
      (entry) => entry.shellComponentCount === 1,
    ),
    true,
  );
  assert.deepEqual(summary.shared.hostSetupWorkbench.requirement, {
    id: "host-setup-workbench",
    label: "Host setup workbench geometry",
    state:
      summary.status === "passed"
        ? "browser_proven"
        : "browser_geometry_missing",
    proven: summary.shared.hostSetupWorkbench.requirement.proven,
    missing: summary.shared.hostSetupWorkbench.requirement.missing,
  });
  assert.deepEqual(
    summary.shared.hostSetupWorkbench.local.viewportLayouts.map((entry) => [
      entry.viewport,
      entry.layout,
      entry.slotCount,
      entry.noHorizontalOverflow,
    ]),
    [
      ["mobile", "stacked", 2, true],
      ["tablet", "co-located-columns", 2, true],
      ["desktop", "co-located-columns", 2, true],
    ],
  );
  assert.equal(
    summary.shared.hostSetupWorkbench.local.screenshotCount >= 3,
    true,
  );
  assert.equal(
    summary.shared.hostSetupWorkbench.imported.setupCount >= 3,
    true,
  );
  assert.deepEqual(summary.shared.tabletInteraction, {
    requirement: {
      id: "tablet-native-interaction-posture",
      label: "Tablet-native interaction posture",
      state:
        summary.status === "passed"
          ? "browser_proven"
          : "source_css_ssr_proven_browser_blocked",
      proven: summary.shared.tabletInteraction.requirement.proven,
      missing: summary.shared.tabletInteraction.requirement.missing,
    },
    scannedFileCount: summary.shared.tabletInteraction.scannedFileCount,
    appShellTouchTargetMinPx: 44,
    hostTouchTargetMinPx: 44,
    forbiddenMatchCount: 0,
    thumbZoneRoles: ["admin", "player", "moderator"],
    moderatorCriticalActionCount: EXPECTED_COUNTS.moderatorCriticalActions,
  });
  assert.equal(summary.shared.tabletInteraction.scannedFileCount > 0, true);
  assert.deepEqual(summary.roles.find((role) => role.id === "player").evidence.routeLive, [
    "routeLive.sources[player]",
    "routeLive.runtime[player]",
  ]);
  assert.deepEqual(summary.shared.routeError, {
    requirement: {
      id: "route-error-shell",
      label: "Route error shell and session context",
      state: summary.status === "passed" ? "browser_proven" : "ssr_and_dom_proven",
      proven: summary.shared.routeError.requirement.proven,
      missing: summary.shared.routeError.requirement.missing,
    },
    routeEvidence: "routeStateRender.errorSurface",
    domEvidence: "domSmoke.errorSurface",
    status: 403,
    path: "/g/midsummer/c/private%3Arole_pm%3Aslot-7",
    activeNavTestId: "role-nav-player",
    sessionPrincipal: "player_mira",
    capabilitySummary: "ChannelMember + SlotOccupant",
    touchTargets: {
      count: summary.shared.routeError.touchTargets.count,
      minPx: summary.shared.routeError.touchTargets.minPx,
    },
  });
  assert.equal(summary.shared.routeError.requirement.proven.length > 0, true);
  if (summary.status === "passed") {
    assert.equal(summary.shared.routeError.requirement.missing.length, 0);
  } else {
    assert.equal(summary.shared.routeError.requirement.missing.length > 0, true);
  }
  assert.equal(summary.shared.routeError.touchTargets.count > 0, true);
  assert.equal(summary.shared.routeError.touchTargets.minPx >= 44, true);
  assert.deepEqual(summary.promotionRules, {
    roleReadinessOrder: [
      "model_ssr_dom_proven_browser_blocked",
      "model_ssr_dom_chromium_no_bind_keyboard_proven_localhost_blocked",
      "model_ssr_dom_chromium_no_bind_interactions_proven_localhost_blocked",
      "model_ssr_dom_chromium_no_bind_proven_localhost_blocked",
      "browser_proven",
    ],
    noBindInteractionRequires: [
      "noBindInteractions.status == passed",
      "noBindInteractions.viewports is nonempty",
      `noBindInteractions.interactions includes admin cohost, admin session-grant, admin recovery-gate, player vote, player post, player private-channel post, and all ${EXPECTED_COUNTS.moderatorCriticalActions} moderator critical host confirmations`,
      "all noBindInteractions entries include clicked target, activeElement, and targetBox",
    ],
    staticFocusabilityRequires: [
      "staticFocusability.status == passed",
      "staticFocusability.surfaces includes board, admin, player, and moderator",
      "staticFocusability.routeStates is nonempty",
      "all staticFocusability entries include expected and forbidden focusability checks",
    ],
    noBindKeyboardRequires: [
      "keyboardTraversal.status == passed",
      "keyboardTraversal.viewports is nonempty",
      "keyboardTraversal.surfaces includes board, admin, player, and moderator",
      "keyboardTraversal.routeStates is nonempty",
      "all keyboardTraversal entries include focusTraversal with expectedOrder and sequence",
    ],
    noBindChromiumRequires: [
      "renderSmoke.status == passed",
      "renderSmoke.viewports is nonempty",
      "renderSmoke.surfaces includes at least 7 surfaces per viewport including player private-channel",
      "renderSmoke.feedbackRails includes at least 3 active feedback rails per viewport",
      "renderSmoke.routeStates is nonempty",
      "renderSmoke admin/player/moderator surface entries include tablet thumb-zone geometry for setup/recovery, player primary actions, and moderator critical actions",
      "all renderSmoke surface, feedback rail, and route-state entries include screenshotPixels",
    ],
    localhostBrowserRequires: [
      "roleSmoke.status == passed",
      "roleSmoke.roles includes admin, player, and moderator",
      "roleSmoke.board is nonempty",
      "roleSmoke.setup includes /g/midsummer/setup workbench geometry for mobile, tablet, and desktop",
      "roleSmoke.routeStates is nonempty",
      "all roleSmoke role entries include screenshotPixels",
      "roleSmoke admin/player/moderator entries include tablet thumb-zone geometry for setup/recovery, player vote/post, and moderator critical actions",
      "admin roleSmoke entries include session-grant form evidence and recovery-gate ACK evidence",
      "player roleSmoke entries include SubmitPost ACK and refreshed thread evidence",
      "playerPrivateChannel roleSmoke entries include private:role_pm:slot-7 SubmitPost ACK evidence",
      "player roleSmoke entries include tablet-media browser request evidence without original/full/desktop URLs",
      "moderator roleSmoke entries include SetSlotStatus ACK and slot lifecycle projection evidence",
    ],
    inAppBrowserFixtureRequires: [
      "inAppBrowserPage.status == page-generated",
      "inAppBrowserPage.surfaces includes board-player, admin, player, and moderator",
      `inAppBrowserPage.scenarios includes admin cohost, admin session-grant, admin recovery-gate, player vote, player post, player private-channel post, and all ${EXPECTED_COUNTS.moderatorCriticalActions} moderator critical host confirmations`,
      "inAppBrowserPage.hydratedSurfaceScenarios includes shared shell, admin audit, admin operational forms, player private disclosure/vote/post, moderator host-prompt, and moderator slot-lifecycle controls",
      "inAppBrowserStaticDom.status == passed",
      "inAppBrowserStaticDom.scenarios includes every fixture command target with private:role_pm:slot-7 route evidence",
      "inAppBrowserPage.pageUrl is a file URL prepared for manual/in-app browser execution",
    ],
    inAppBrowserRunRequires: [
      "inAppBrowserRun.status == passed",
      "inAppBrowserRun.runs includes every proof viewport",
      "all inAppBrowserRun entries include clicked target, activeElement, targetBox, and screenshotPixels",
      `all ${EXPECTED_COUNTS.moderatorCriticalActions} moderator critical host confirmation run entries include alertdialog focus metadata and object/outcome text`,
      "player private-channel run entries include active private:role_pm:slot-7 route evidence",
      "player private disclosure toggles from aria-expanded=false to aria-expanded=true",
    ],
    inAppBrowserLocalhostRunRequires: [
      "inAppBrowserLocalhostRun.status == passed",
      "inAppBrowserLocalhostRun.pageUrl is a localhost URL",
      "inAppBrowserLocalhostRun.runs includes every proof viewport",
      "all inAppBrowserLocalhostRun entries include clicked target, activeElement, targetBox, and screenshotPixels",
      `all ${EXPECTED_COUNTS.moderatorCriticalActions} moderator critical host confirmation run entries include alertdialog focus metadata and object/outcome text`,
    ],
    inAppBrowserImportedRunRequires: [
      "inAppBrowserImportedRun.status == imported-passed",
      "inAppBrowserImportedRun.validated.runCount covers every proof viewport",
      `inAppBrowserImportedRun.validated.plannedInteractionCount covers all ${EXPECTED_COUNTS.plannedInteractions} fixture interactions`,
      "inAppBrowserImportedRun.validated.moderatorCriticalConfirmationCount is 11",
      "inAppBrowserImportedRun.validated.screenshotChecks re-read nonblank PNG evidence",
    ],
    importedRoleSmokeRequires: [
      "importedRoleSmoke.status == imported-passed",
      "importedRoleSmoke.validated.boardCount covers every proof viewport",
      "importedRoleSmoke.validated.setupCount covers setup workbench geometry",
      "importedRoleSmoke.validated.roleCount covers admin, player, and moderator for every proof viewport",
      "importedRoleSmoke.validated.playerPrivateChannelCount covers every proof viewport",
      "importedRoleSmoke.validated.routeStateCount and forbiddenRouteCount are nonempty",
      "importedRoleSmoke.validated.screenshotChecks re-read nonblank PNG evidence",
    ],
  });
  assert.deepEqual(summary.generatedFrom, {
    completionAudit: "target/frontend-completion-audit/completion-audit.json",
    roleSmoke: "target/frontend-role-smoke/role-smoke.json",
    renderSmoke: "target/frontend-role-render-smoke/render-smoke.json",
    routeStateRender: "target/frontend-route-state-render/route-state-render.json",
    dispatchBridge: "target/frontend-dispatch-bridge/dispatch-bridge.json",
    hydratedHandlers: "target/frontend-hydrated-handlers/hydrated-handlers.json",
    hydratedSurfaces: "target/frontend-hydrated-surfaces/hydrated-surfaces.json",
    componentInteractions:
      "target/frontend-component-interactions/component-interactions.json",
    hostConfirmations:
      "target/frontend-host-confirmation-static-dom/static-dom.json",
    noBindInteractions:
      "target/frontend-no-bind-interactions/no-bind-interactions.json",
    staticFocusability:
      "target/frontend-static-focusability/focusability.json",
    tabletInteraction:
      "target/frontend-tablet-interaction/tablet-interaction.json",
    routeLive:
      "target/frontend-route-live-contract/route-live-contract.json",
    keyboardTraversal:
      "target/frontend-keyboard-traversal/keyboard-traversal.json",
    domSmoke: "target/frontend-role-dom-smoke/dom-smoke.json",
    staticContract: "target/frontend-static-role-contract/role-contract.json",
    inAppBrowserPage:
      "target/frontend-in-app-browser-interactions/interaction-page-manifest.json",
    inAppBrowserStaticDom:
      "target/frontend-in-app-browser-static-dom/static-dom.json",
    inAppBrowserRun:
      "target/frontend-in-app-browser-interactions/browser-run.json",
    inAppBrowserLocalhostRun:
      "target/frontend-in-app-browser-localhost/browser-run.json",
    inAppBrowserImportedRun:
      "target/frontend-in-app-browser-imported-run/imported-run.json",
    importedRoleSmoke:
      "target/frontend-role-smoke-imported/imported-role-smoke.json",
    browserAcceptanceBoundary:
      "target/frontend-browser-acceptance-boundary/browser-acceptance-boundary.json",
  });
  const roleProofRows = summary.roles.map((role) => [
    role.id,
    role.readiness,
    role.surfaces.model,
    role.surfaces.ssr,
    role.surfaces.dom,
    role.surfaces.staticFocusability,
    role.surfaces.noBindInteraction,
    role.surfaces.noBindKeyboard,
    role.surfaces.noBindChromium,
    role.surfaces.localhostBrowser,
    role.evidence.dispatchBridge,
    role.evidence.hydratedHandler,
    role.evidence.hydratedSurface,
    role.evidence.componentInteraction,
    role.evidence.hostConfirmation,
    role.evidence.noBindInteraction,
    role.evidence.staticFocusability,
    role.evidence.noBindKeyboard,
    role.evidence.feedback.statusTestId,
    role.promotionFailures,
  ]);
  if (summary.browserAcceptance.requirement.state === "browser_proven") {
    const fullBrowserSurface =
      summary.browserAcceptance.localhost.status === "browser_proven"
        ? "browser_proven"
        : "imported_browser_proven";
    const renderSmoke = await readJsonArtifact(renderSmokePath).catch(() => null);
    const noBindChromiumSurface =
      renderSmoke?.status === "passed" ? "chromium_no_bind_proven" : "blocked";
    assert.deepEqual(roleProofRows, [
      [
        "admin",
        "browser_proven",
        "proven",
        "proven",
        "proven",
        "proven",
        "chromium_no_bind_interactions_proven",
        "chromium_no_bind_keyboard_proven",
        noBindChromiumSurface,
        fullBrowserSurface,
        "dispatchBridge.rolePlans[admin]",
        "hydratedHandlers.roles[admin]",
        "hydratedSurfaces.admin",
        "componentInteractions.interactions[admin]",
        null,
        "noBindInteractions.interactions[admin]",
        "staticFocusability.surfaces[admin]",
        "keyboardTraversal.surfaces[admin]",
        "admin-command-activity-status-recovery-gate",
        [],
      ],
      [
        "player",
        "browser_proven",
        "proven",
        "proven",
        "proven",
        "proven",
        "chromium_no_bind_interactions_proven",
        "chromium_no_bind_keyboard_proven",
        noBindChromiumSurface,
        fullBrowserSurface,
        "dispatchBridge.rolePlans[player]",
        "hydratedHandlers.roles[player]",
        "hydratedSurfaces.player",
        "componentInteractions.interactions[player]",
        null,
        "noBindInteractions.interactions[player]",
        "staticFocusability.surfaces[player]",
        "keyboardTraversal.surfaces[player]",
        "player-command-status",
        [],
      ],
      [
        "moderator",
        "browser_proven",
        "proven",
        "proven",
        "proven",
        "proven",
        "chromium_no_bind_interactions_proven",
        "chromium_no_bind_keyboard_proven",
        noBindChromiumSurface,
        fullBrowserSurface,
        "dispatchBridge.rolePlans[moderator]",
        "hydratedHandlers.roles[moderator]",
        "hydratedSurfaces.moderator",
        "componentInteractions.interactions[moderator]",
        "hostConfirmations.actions",
        "noBindInteractions.interactions[moderator]",
        "staticFocusability.surfaces[moderator]",
        "keyboardTraversal.surfaces[moderator]",
        "host-command-activity-status-resolve_host_prompt-D01-skip_next_day-slot_1",
        [],
      ],
    ]);
  } else {
    assert.deepEqual(
      roleProofRows,
      [
      [
        "admin",
        "model_ssr_dom_proven_browser_blocked",
        "proven",
        "proven",
        "proven",
        "proven",
        "blocked",
        "blocked",
        "blocked",
        "blocked",
        "dispatchBridge.rolePlans[admin]",
        "hydratedHandlers.roles[admin]",
        "hydratedSurfaces.admin",
        "componentInteractions.interactions[admin]",
        null,
        "noBindInteractions.interactions[admin]",
        "staticFocusability.surfaces[admin]",
        "keyboardTraversal.surfaces[admin]",
        "admin-command-activity-status-recovery-gate",
        [
          "noBindInteraction: noBindInteractions.status is chromium-launch-blocked, expected passed",
          "noBindInteraction: noBindInteractions.viewports is empty or absent",
          "noBindInteraction: noBindInteractions.interactions[admin] is empty or absent",
          "noBindInteraction: noBindInteractions.interactions[player] is empty or absent",
          "noBindInteraction: noBindInteractions.interactions[moderator] is empty or absent",
          "noBindKeyboard: keyboardTraversal.status is chromium-launch-blocked, expected passed",
          "noBindKeyboard: keyboardTraversal.viewports is empty or absent",
          "noBindKeyboard: keyboardTraversal.surfaces missing board",
          "noBindKeyboard: keyboardTraversal.surfaces missing admin",
          "noBindKeyboard: keyboardTraversal.surfaces missing player",
          "noBindKeyboard: keyboardTraversal.surfaces missing moderator",
          "noBindKeyboard: keyboardTraversal.routeStates is empty or absent",
          "noBindChromium: renderSmoke.status is chromium-launch-blocked, expected passed",
          "noBindChromium: renderSmoke.viewports is empty or absent",
          "noBindChromium: renderSmoke.surfaces is empty or absent",
          "noBindChromium: renderSmoke.feedbackRails is empty or absent",
          "noBindChromium: renderSmoke.routeStates is empty or absent",
          "noBindChromium: renderSmoke.surfaces missing tablet thumb-zone geometry evidence",
          "localhostBrowser: roleSmoke.status is static-dom-fallback-passed, expected passed",
          "localhostBrowser: roleSmoke.roles missing admin",
          "localhostBrowser: roleSmoke.roles missing player",
          "localhostBrowser: roleSmoke.roles missing moderator",
          "localhostBrowser: roleSmoke.board is empty or absent",
          "localhostBrowser: roleSmoke.setup missing /g/midsummer/setup workbench geometry evidence",
          "localhostBrowser: roleSmoke.routeStates is empty or absent",
          "localhostBrowser: roleSmoke.roles[admin] missing session-grant form or recovery-gate ACK evidence",
          "localhostBrowser: roleSmoke.roles missing tablet thumb-zone geometry evidence",
          "localhostBrowser: roleSmoke.roles[player] missing SubmitPost browser ACK evidence",
          "localhostBrowser: roleSmoke.roles[player] missing tablet-media browser request evidence",
          "localhostBrowser: roleSmoke.playerPrivateChannel missing private:role_pm:slot-7 SubmitPost browser ACK evidence",
          "localhostBrowser: roleSmoke.roles[moderator] missing SetSlotStatus browser ACK evidence",
        ],
      ],
      [
        "player",
        "model_ssr_dom_proven_browser_blocked",
        "proven",
        "proven",
        "proven",
        "proven",
        "blocked",
        "blocked",
        "blocked",
        "blocked",
        "dispatchBridge.rolePlans[player]",
        "hydratedHandlers.roles[player]",
        "hydratedSurfaces.player",
        "componentInteractions.interactions[player]",
        null,
        "noBindInteractions.interactions[player]",
        "staticFocusability.surfaces[player]",
        "keyboardTraversal.surfaces[player]",
        "player-command-status",
        [
          "noBindInteraction: noBindInteractions.status is chromium-launch-blocked, expected passed",
          "noBindInteraction: noBindInteractions.viewports is empty or absent",
          "noBindInteraction: noBindInteractions.interactions[admin] is empty or absent",
          "noBindInteraction: noBindInteractions.interactions[player] is empty or absent",
          "noBindInteraction: noBindInteractions.interactions[moderator] is empty or absent",
          "noBindKeyboard: keyboardTraversal.status is chromium-launch-blocked, expected passed",
          "noBindKeyboard: keyboardTraversal.viewports is empty or absent",
          "noBindKeyboard: keyboardTraversal.surfaces missing board",
          "noBindKeyboard: keyboardTraversal.surfaces missing admin",
          "noBindKeyboard: keyboardTraversal.surfaces missing player",
          "noBindKeyboard: keyboardTraversal.surfaces missing moderator",
          "noBindKeyboard: keyboardTraversal.routeStates is empty or absent",
          "noBindChromium: renderSmoke.status is chromium-launch-blocked, expected passed",
          "noBindChromium: renderSmoke.viewports is empty or absent",
          "noBindChromium: renderSmoke.surfaces is empty or absent",
          "noBindChromium: renderSmoke.feedbackRails is empty or absent",
          "noBindChromium: renderSmoke.routeStates is empty or absent",
          "noBindChromium: renderSmoke.surfaces missing tablet thumb-zone geometry evidence",
          "localhostBrowser: roleSmoke.status is static-dom-fallback-passed, expected passed",
          "localhostBrowser: roleSmoke.roles missing admin",
          "localhostBrowser: roleSmoke.roles missing player",
          "localhostBrowser: roleSmoke.roles missing moderator",
          "localhostBrowser: roleSmoke.board is empty or absent",
          "localhostBrowser: roleSmoke.setup missing /g/midsummer/setup workbench geometry evidence",
          "localhostBrowser: roleSmoke.routeStates is empty or absent",
          "localhostBrowser: roleSmoke.roles[admin] missing session-grant form or recovery-gate ACK evidence",
          "localhostBrowser: roleSmoke.roles missing tablet thumb-zone geometry evidence",
          "localhostBrowser: roleSmoke.roles[player] missing SubmitPost browser ACK evidence",
          "localhostBrowser: roleSmoke.roles[player] missing tablet-media browser request evidence",
          "localhostBrowser: roleSmoke.playerPrivateChannel missing private:role_pm:slot-7 SubmitPost browser ACK evidence",
          "localhostBrowser: roleSmoke.roles[moderator] missing SetSlotStatus browser ACK evidence",
        ],
      ],
      [
        "moderator",
        "model_ssr_dom_proven_browser_blocked",
        "proven",
        "proven",
        "proven",
        "proven",
        "blocked",
        "blocked",
        "blocked",
        "blocked",
        "dispatchBridge.rolePlans[moderator]",
        "hydratedHandlers.roles[moderator]",
        "hydratedSurfaces.moderator",
        "componentInteractions.interactions[moderator]",
        "hostConfirmations.actions",
        "noBindInteractions.interactions[moderator]",
        "staticFocusability.surfaces[moderator]",
        "keyboardTraversal.surfaces[moderator]",
        "host-command-activity-status-resolve_host_prompt-D01-skip_next_day-slot_1",
        [
          "noBindInteraction: noBindInteractions.status is chromium-launch-blocked, expected passed",
          "noBindInteraction: noBindInteractions.viewports is empty or absent",
          "noBindInteraction: noBindInteractions.interactions[admin] is empty or absent",
          "noBindInteraction: noBindInteractions.interactions[player] is empty or absent",
          "noBindInteraction: noBindInteractions.interactions[moderator] is empty or absent",
          "noBindKeyboard: keyboardTraversal.status is chromium-launch-blocked, expected passed",
          "noBindKeyboard: keyboardTraversal.viewports is empty or absent",
          "noBindKeyboard: keyboardTraversal.surfaces missing board",
          "noBindKeyboard: keyboardTraversal.surfaces missing admin",
          "noBindKeyboard: keyboardTraversal.surfaces missing player",
          "noBindKeyboard: keyboardTraversal.surfaces missing moderator",
          "noBindKeyboard: keyboardTraversal.routeStates is empty or absent",
          "noBindChromium: renderSmoke.status is chromium-launch-blocked, expected passed",
          "noBindChromium: renderSmoke.viewports is empty or absent",
          "noBindChromium: renderSmoke.surfaces is empty or absent",
          "noBindChromium: renderSmoke.feedbackRails is empty or absent",
          "noBindChromium: renderSmoke.routeStates is empty or absent",
          "noBindChromium: renderSmoke.surfaces missing tablet thumb-zone geometry evidence",
          "localhostBrowser: roleSmoke.status is static-dom-fallback-passed, expected passed",
          "localhostBrowser: roleSmoke.roles missing admin",
          "localhostBrowser: roleSmoke.roles missing player",
          "localhostBrowser: roleSmoke.roles missing moderator",
          "localhostBrowser: roleSmoke.board is empty or absent",
          "localhostBrowser: roleSmoke.setup missing /g/midsummer/setup workbench geometry evidence",
          "localhostBrowser: roleSmoke.routeStates is empty or absent",
          "localhostBrowser: roleSmoke.roles[admin] missing session-grant form or recovery-gate ACK evidence",
          "localhostBrowser: roleSmoke.roles missing tablet thumb-zone geometry evidence",
          "localhostBrowser: roleSmoke.roles[player] missing SubmitPost browser ACK evidence",
          "localhostBrowser: roleSmoke.roles[player] missing tablet-media browser request evidence",
          "localhostBrowser: roleSmoke.playerPrivateChannel missing private:role_pm:slot-7 SubmitPost browser ACK evidence",
          "localhostBrowser: roleSmoke.roles[moderator] missing SetSlotStatus browser ACK evidence",
        ],
      ],
    ],
  );
  }

  if (summary.browserAcceptance.requirement.state === "browser_proven") {
    assert.deepEqual(summary.browserAcceptance.requirement, {
      id: "browser-acceptance",
      label: "Full Playwright/Chromium role acceptance",
      state: "browser_proven",
      proven: summary.browserAcceptance.requirement.proven,
      missing: summary.browserAcceptance.requirement.missing,
    });
    assert.equal(summary.browserAcceptance.requirement.proven.length > 0, true);
    if (summary.browserAcceptance.localhost.status === "browser_proven") {
      assert.deepEqual(
        [
          summary.browserAcceptance.localhost.artifactStatus,
          summary.browserAcceptance.localhost.promotionFailures,
          summary.browserAcceptance.localhost.blockedReason,
        ],
        ["passed", [], null],
      );
    } else {
      assert.deepEqual(
        [
          summary.browserAcceptance.localhost.status,
          summary.browserAcceptance.localhost.artifactStatus,
          summary.browserAcceptance.localhost.promotionFailures,
          summary.browserAcceptance.localhost.blockedReason,
        ],
        [
          "imported_browser_proven",
          "passed",
          ["roleSmoke.roles missing tablet thumb-zone geometry evidence"],
          "localhost bind is denied before the dev-server browser proof can run",
        ],
      );
    }
    if (summary.browserAcceptance.noBindChromium.status === "chromium_no_bind_proven") {
      assert.deepEqual(
        [
          summary.browserAcceptance.noBindChromium.artifactStatus,
          summary.browserAcceptance.noBindChromium.blockedReason,
        ],
        ["passed", null],
      );
    } else {
      assert.deepEqual(
        [
          summary.browserAcceptance.noBindChromium.status,
          summary.browserAcceptance.noBindChromium.artifactStatus,
          summary.browserAcceptance.noBindChromium.blockedReason,
        ],
        [
          "blocked",
          "chromium-launch-blocked",
          "Chromium launch is denied before no-bind screenshots or geometry can run",
        ],
      );
    }
    assert.deepEqual(
      [
        summary.browserAcceptance.noBindInteractions.status,
        summary.browserAcceptance.noBindInteractions.artifactStatus,
        summary.browserAcceptance.noBindInteractions.promotionFailures,
        summary.browserAcceptance.noBindInteractions.blockedReason,
      ],
      ["chromium_no_bind_interactions_proven", "passed", [], null],
    );
    assert.deepEqual(
      [
        summary.browserAcceptance.noBindKeyboard.status,
        summary.browserAcceptance.noBindKeyboard.artifactStatus,
        summary.browserAcceptance.noBindKeyboard.promotionFailures,
        summary.browserAcceptance.noBindKeyboard.blockedReason,
      ],
      ["chromium_no_bind_keyboard_proven", "passed", [], null],
    );
    assert.deepEqual(
      [
        summary.browserAcceptance.inAppBrowserRun.status,
        summary.browserAcceptance.inAppBrowserRun.artifactStatus,
        summary.browserAcceptance.inAppBrowserRun.runCount,
        summary.browserAcceptance.inAppBrowserRun.promotionFailures,
      ],
      ["browser_run_proven", "passed", viewports.length, []],
    );
    assert.deepEqual(
      [
        summary.browserAcceptance.inAppBrowserLocalhostRun.status,
        summary.browserAcceptance.inAppBrowserLocalhostRun.artifactStatus,
        summary.browserAcceptance.inAppBrowserLocalhostRun.runCount,
        summary.browserAcceptance.inAppBrowserLocalhostRun.promotionFailures,
      ],
      ["browser_run_proven", "passed", viewports.length, []],
    );
    assert.deepEqual(
      [
        summary.browserAcceptance.inAppBrowserImportedRun.status,
        summary.browserAcceptance.inAppBrowserImportedRun.artifactStatus,
        summary.browserAcceptance.inAppBrowserImportedRun.promotionEligible,
        summary.browserAcceptance.inAppBrowserImportedRun.validated.runCount,
        summary.browserAcceptance.inAppBrowserImportedRun.validated.screenshotCheckCount,
        summary.browserAcceptance.inAppBrowserImportedRun.blocking,
      ],
      [
        "imported_browser_run_proven",
        "imported-passed",
        true,
        viewports.length,
        viewports.length,
        [],
      ],
    );
    assert.equal(
      [
        "imported_role_smoke_proven",
        "source_blocked",
      ].includes(summary.browserAcceptance.importedRoleSmoke.status),
      true,
    );
    if (summary.browserAcceptance.importedRoleSmoke.status === "imported_role_smoke_proven") {
      assert.deepEqual(
        [
          summary.browserAcceptance.importedRoleSmoke.artifactStatus,
          summary.browserAcceptance.importedRoleSmoke.promotionEligible,
          summary.browserAcceptance.importedRoleSmoke.validated.viewportCount,
          summary.browserAcceptance.importedRoleSmoke.validated.screenshotCheckCount > 0,
          summary.browserAcceptance.importedRoleSmoke.blocking,
        ],
        ["imported-passed", true, viewports.length, true, []],
      );
    }
    assert.deepEqual(
      summary.browserAcceptance.boundaryArtifact.lanes.map((lane) => [
        lane.id,
        lane.status,
        lane.artifactStatus,
        lane.promotionEligible,
      ]),
      [
        [
          "localhost-dev-server-role-smoke",
          summary.browserAcceptance.localhost.status === "browser_proven"
            ? "proven"
            : "blocked",
          "passed",
          true,
        ],
        [
          "chromium-no-bind-render",
          summary.browserAcceptance.noBindChromium.status ===
          "chromium_no_bind_proven"
            ? "proven"
            : "blocked",
          summary.browserAcceptance.noBindChromium.artifactStatus,
          false,
        ],
        ["chromium-no-bind-interactions", "proven", "passed", false],
        ["chromium-no-bind-keyboard", "proven", "passed", false],
        ["in-app-file-static-dom", "proven", "passed", false],
        ["in-app-file-backed-fixture", "fixture_prepared", "page-generated", false],
        ["in-app-file-browser-run", "proven", "passed", true],
        ["in-app-localhost-fixture-browser-run", "proven", "passed", true],
        ["in-app-file-imported-browser-run", "proven", "imported-passed", true],
        [
          "imported-localhost-role-smoke",
          summary.browserAcceptance.importedRoleSmoke.status ===
          "imported_role_smoke_proven"
            ? "proven"
            : "blocked",
          summary.browserAcceptance.importedRoleSmoke.artifactStatus,
          true,
        ],
      ],
    );
    assert.deepEqual(summary.browserAcceptance.boundaryArtifact.blockers, []);
    assert.equal(
      summary.browserAcceptance.boundaryArtifact.diagnosticBlockers.length > 0,
      true,
    );
  } else {
    assert.deepEqual(summary.browserAcceptance, {
    requirement: {
      id: "browser-acceptance",
      label: "Full Playwright/Chromium role acceptance",
      state: "blocked_by_localhost_and_chromium_sandbox",
      proven: [
        "No-browser fallback artifacts are green and record the blocked browser boundary.",
        `File-backed in-app browser fixture is generated and statically verified for role shells, representative admin/player controls including admin session-grant/recovery-gate forms and player role-PM private-channel post, all ${EXPECTED_COUNTS.moderatorCriticalActions} moderator critical host confirmations, plus separate hydrated-surface admin forms, host-prompt, and slot-lifecycle scenario controls, but it has not produced browser click/focus evidence.`,
        "A localhost-served fixture run is modeled separately from the file URL lane and records the current localhost bind/Chromium boundary before promotion.",
      ],
      missing: [
        "localhost bind is denied before dev-server browser proof can run.",
        "Chromium launch is denied before no-bind render proof can run.",
        "Chromium launch is denied before no-bind click/focus interaction proof can run.",
        "Chromium launch is denied before no-bind keyboard traversal proof can run.",
        "File-backed in-app browser page has not been opened and exercised successfully, so it remains a prepared fixture rather than browser acceptance evidence.",
        "File-backed in-app browser-run evidence is absent or blocked.",
        "Localhost-served fixture browser-run evidence is absent or blocked.",
        "No passed external file-backed browser-run artifact has been imported.",
      ],
    },
    localhost: {
      status: "blocked",
      artifactStatus: "static-dom-fallback-passed",
      boundary:
        "Dev-server browser smoke did not run because localhost bind was denied. Static route contracts and no-browser SSR DOM evidence were recorded, but no-bind Chromium SSR render proof was blocked before launch.",
      promotionFailures: [
        "roleSmoke.status is static-dom-fallback-passed, expected passed",
        "roleSmoke.roles missing admin",
        "roleSmoke.roles missing player",
        "roleSmoke.roles missing moderator",
        "roleSmoke.board is empty or absent",
        "roleSmoke.setup missing /g/midsummer/setup workbench geometry evidence",
        "roleSmoke.routeStates is empty or absent",
        "roleSmoke.roles[admin] missing session-grant form or recovery-gate ACK evidence",
        "roleSmoke.roles missing tablet thumb-zone geometry evidence",
        "roleSmoke.roles[player] missing SubmitPost browser ACK evidence",
        "roleSmoke.roles[player] missing tablet-media browser request evidence",
        "roleSmoke.playerPrivateChannel missing private:role_pm:slot-7 SubmitPost browser ACK evidence",
        "roleSmoke.roles[moderator] missing SetSlotStatus browser ACK evidence",
      ],
      blockedReason:
        "localhost bind is denied before the dev-server browser proof can run",
    },
    noBindChromium: {
      status: "blocked",
      artifactStatus: "chromium-launch-blocked",
      boundary:
        "Build-mode Svelte SSR route-state render passed, including active feedback-rail markup, but Chromium could not launch in this sandbox. No no-bind Chromium pixels, geometry, overlap, focus, pointer, or hydration behavior were exercised.",
      promotionFailures: [
        "renderSmoke.status is chromium-launch-blocked, expected passed",
        "renderSmoke.viewports is empty or absent",
        "renderSmoke.surfaces is empty or absent",
        "renderSmoke.feedbackRails is empty or absent",
        "renderSmoke.routeStates is empty or absent",
        "renderSmoke.surfaces missing tablet thumb-zone geometry evidence",
      ],
      blockedReason:
        "Chromium launch is denied before no-bind screenshots or geometry can run",
    },
    noBindInteractions: {
      status: "blocked",
      artifactStatus: "chromium-launch-blocked",
      boundary:
        "Build-mode Svelte SSR route-state render passed, but Chromium could not launch in this sandbox. No no-bind browser click delivery, focus landing, touch target geometry, client hydration, pointer, or network behavior was exercised.",
      promotionFailures: [
        "noBindInteractions.status is chromium-launch-blocked, expected passed",
        "noBindInteractions.viewports is empty or absent",
        "noBindInteractions.interactions[admin] is empty or absent",
        "noBindInteractions.interactions[player] is empty or absent",
        "noBindInteractions.interactions[moderator] is empty or absent",
      ],
      blockedReason:
        "Chromium launch is denied before no-bind click/focus interactions can run",
    },
    noBindKeyboard: {
      status: "blocked",
      artifactStatus: "chromium-launch-blocked",
      boundary:
        "Build-mode Svelte SSR route-state render passed, but Chromium could not launch in this sandbox. No no-bind browser Tab traversal, visible focus outline, disabled-control exclusion, client hydration, pointer, or network behavior was exercised.",
      promotionFailures: [
        "keyboardTraversal.status is chromium-launch-blocked, expected passed",
        "keyboardTraversal.viewports is empty or absent",
        "keyboardTraversal.surfaces missing board",
        "keyboardTraversal.surfaces missing admin",
        "keyboardTraversal.surfaces missing player",
        "keyboardTraversal.surfaces missing moderator",
        "keyboardTraversal.routeStates is empty or absent",
      ],
      blockedReason:
        "Chromium launch is denied before no-bind keyboard traversal can run",
    },
    inAppBrowserFixture: {
      status: "fixture_prepared",
      artifactStatus: "page-generated",
      boundary:
        `Generates a file-backed page from build-mode Svelte SSR first-viewport role surfaces, the real player private-channel error surface, command controls, player private-channel controls, all ${EXPECTED_COUNTS.moderatorCriticalActions} moderator critical host confirmations, and hydrated-surface scenario controls for manual/in-app-browser proof. The page can record native browser click delivery and focus landing for representative admin, player, player private-channel, route-error, and moderator critical host confirmation targets without opening localhost or launching a separate Playwright browser. It does not prove browser behavior unless the generated file is opened and exercised, and it does not prove Svelte hydration, Svelte event scheduling, command dispatch side effects, TCP/network transport, WebSocket delivery, or dev-server routing.`,
      page: "target/frontend-in-app-browser-interactions/interaction-page.html",
      pageUrl: summary.browserAcceptance.inAppBrowserFixture.pageUrl,
      surfaces: [
        {
          id: boardScenario.id,
          role: "board",
          render: "renderBoardPlayerSurface",
          surfaceTestId: boardScenario.surfaceTestId,
        },
        ...roles.map((role) => ({
          id: role.id,
          role: role.id,
          render: renderFunctionForRole(role.id),
          surfaceTestId: role.surfaceTestId,
        })),
        {
          id: "route-error-player-private-channel",
          role: "player",
          render: "renderRouteErrorSurface",
          surfaceTestId: "route-error-surface",
        },
      ],
      scenarios: [
        {
          id: "admin-cohost-confirm-click",
          role: "admin",
          render: "renderAdminSetupConfirmation",
          targetTestId: "admin-command-confirm-cohost",
        },
        {
          id: "admin-session-grant-confirm-click",
          role: "admin",
          render: "renderAdminSetupConfirmation",
          targetTestId: "admin-command-confirm-session-grants",
        },
        {
          id: "admin-recovery-gate-confirm-click",
          role: "admin",
          render: "renderAdminRecoveryConfirmation",
          targetTestId: "admin-recovery-confirm-recovery-gate",
        },
        {
          id: "player-submit-vote-click",
          role: "player",
          render: "renderPlayerSurface",
          targetAction: "submit_vote",
        },
        {
          id: "player-submit-post-click",
          role: "player",
          render: "renderPlayerSurface",
          targetAction: "submit_post",
        },
        {
          id: "player-private-channel-submit-post-click",
          role: "player",
          render: "renderPlayerPrivateChannelRoute",
          targetAction: "submit_post",
        },
        {
          id: "player-action-target-pick-confirm-click",
          role: "player",
          render: "renderPlayerActionTargetConfirmation",
          targetTestId: "player-action-confirm-factional_kill",
        },
        {
          id: "player-action-withdraw-confirm-click",
          role: "player",
          render: "renderPlayerActionWithdrawConfirmation",
          targetTestId: "player-action-withdraw-confirm-factional_kill",
        },
        {
          id: "route-error-back-to-board-click",
          role: "player",
          render: "renderRouteErrorSurface",
          targetTestId: "route-error-action",
        },
        ...moderatorCriticalConfirmationActions.map(([actionId]) => ({
          id: `moderator-${actionId}-confirm-click`,
          role: "moderator",
          render: "renderModeratorActionConfirmation",
          renderArgs: [actionId],
          targetTestId: "critical-host-action-confirm",
        })),
      ],
      hydratedSurfaceScenarios: [
        {
          id: "shared-shell-header-coverage",
          role: "shared",
          source: "hydratedSurfaces.sharedShell",
        },
        {
          id: "admin-audit-native-flow",
          role: "admin",
          source: "hydratedSurfaces.admin",
          commandKind: "AddCohost",
          visibleState: "ack",
        },
        {
          id: "admin-operational-forms",
          role: "admin",
          source: "hydratedSurfaces.admin",
        },
        {
          id: "player-private-disclosure-vote-and-post",
          role: "player",
          source: "hydratedSurfaces.player",
          commandKind: "SubmitVote",
          visibleState: "ack",
          postCommandKind: "SubmitPost",
          postVisibleState: "ack",
        },
        {
          id: "moderator-host-prompt-confirmation",
          role: "moderator",
          source: "hydratedSurfaces.moderator",
          commandKind: "ResolveHostPrompt",
          visibleState: "ack",
        },
        {
          id: "moderator-slot-lifecycle-confirmation",
          role: "moderator",
          source: "hydratedSurfaces.moderator",
          slotLifecycleCommandKind: "SetSlotStatus",
          slotLifecycleVisibleState: "ack",
        },
      ],
      stabilityChecks: [
        {
          id: "admin-operator-action-status-floors",
          role: "admin",
          surfaceId: "admin",
          mode: "reserved-status-floor",
          statusFloorMinBlockSizePx: 44,
          tileCount: EXPECTED_COUNTS.adminStabilityFloorTiles,
        },
        {
          id: "moderator-primary-action-status-floors",
          role: "moderator",
          surfaceId: "moderator",
          mode: "reserved-status-floor",
          statusFloorMinBlockSizePx: 44,
          tileCount: EXPECTED_COUNTS.moderatorCriticalActions,
        },
      ],
      blockedReason:
        "Prepared file-backed fixture has not produced browser click/focus/screenshot evidence.",
    },
    inAppBrowserStaticDom: {
      status: "static_dom_proven",
      artifactStatus: "passed",
      boundary:
        `Parses the generated file-backed in-app browser fixture HTML without opening localhost or launching Chromium. This proves every manifest command/error scenario owns exactly one target inside its scenario root, all ${EXPECTED_COUNTS.moderatorCriticalActions} moderator critical host confirmation scenarios carry DOM-visible object/outcome text and alertdialog focus metadata, modeled route evidence is present for the player role-PM scenario, modeled error-surface evidence is present for the player private-channel 403, hydrated-surface controls exist inside their scenario roots, touch-floor metadata is present where the rendered control models it, and player private fixture markup excludes host-only copy. It does not prove CSS layout pixels, browser click delivery, focus landing, Svelte hydration, command dispatch side effects, TCP transport, WebSocket delivery, or localhost-backed app acceptance.`,
      scenarioCount: EXPECTED_COUNTS.commandScenarios,
      hydratedScenarioCount: 6,
      stabilityChecks: [
        {
          id: "admin-operator-action-status-floors",
          role: "admin",
          surfaceId: "admin",
          mode: "reserved-status-floor",
          statusFloorMinBlockSizePx: 44,
          tileCount: EXPECTED_COUNTS.adminStabilityFloorTiles,
        },
        {
          id: "moderator-primary-action-status-floors",
          role: "moderator",
          surfaceId: "moderator",
          mode: "reserved-status-floor",
          statusFloorMinBlockSizePx: 44,
          tileCount: EXPECTED_COUNTS.moderatorCriticalActions,
        },
      ],
      playerPrivateChannelRoute: {
        path: "/g/midsummer/c/private%3Arole_pm%3Aslot-7",
        activeChannelTestId: "player-channel-private:role_pm:slot-7",
        activeChannelHref: "/g/midsummer/c/private%3Arole_pm%3Aslot-7",
        activeChannelCurrent: "page",
        privateReviewHref: "/g/midsummer/c/private%3Arole_pm%3Aslot-7?private=notification-1",
      },
      routeError: {
        path: "/g/midsummer/c/private%3Arole_pm%3Aslot-7",
        status: 403,
        surfaceTestId: "route-error-surface",
        panelTestId: "route-error-panel",
        actionHref: "/",
        activeNavTestId: "role-nav-player",
        activeNavCurrent: "page",
        sessionPrincipal: "player_mira",
        capabilitySummary: "ChannelMember + SlotOccupant",
      },
      forbidden: [
        {
          label: "file-backed player private-channel fixture",
          strings: ["host prompt", "moderator", "resolve_host_prompt"],
          present: false,
        },
      ],
    },
    inAppBrowserRun: {
      status: "blocked",
      artifactStatus: "chromium-launch-blocked",
      boundary:
        "The file-backed in-app browser fixture was generated, but Chromium could not launch in this sandbox. No file URL navigation, native click delivery, focus landing, touch geometry, disclosure toggle, or screenshot pixels were exercised.",
      pageUrl: summary.browserAcceptance.inAppBrowserRun.pageUrl,
      plannedInteractionIds: [
        "admin-cohost-confirm-click",
        "admin-session-grant-confirm-click",
        "admin-recovery-gate-confirm-click",
        "player-submit-vote-click",
        "player-submit-post-click",
        "player-private-channel-submit-post-click",
        "player-action-target-pick-confirm-click",
        "player-action-withdraw-confirm-click",
        "route-error-back-to-board-click",
        ...moderatorCriticalConfirmationScenarioIds,
        "admin-audit-native-flow",
        "admin-operational-forms",
        "player-private-disclosure-vote-and-post",
        "moderator-host-prompt-confirmation",
        "moderator-slot-lifecycle-confirmation",
      ],
      plannedStabilityCheckIds: [
        "admin-operator-action-status-floors",
        "moderator-primary-action-status-floors",
      ],
      runCount: 0,
      interactionIds: [],
      promotionFailures: [
        "inAppBrowserRun.status is chromium-launch-blocked, expected passed",
        "inAppBrowserRun.viewports is empty or absent",
      ],
      blockedReason:
        "File-backed fixture browser-run evidence has not completed.",
    },
    inAppBrowserLocalhostRun: {
      status: "blocked",
      artifactStatus: "localhost-bind-blocked",
      boundary:
        "The in-app browser fixture was generated, but a localhost fixture server could not bind in this sandbox. No localhost browser navigation, native click delivery, focus landing, touch geometry, disclosure toggle, or screenshot pixels were exercised.",
      pageUrl: summary.browserAcceptance.inAppBrowserLocalhostRun.pageUrl,
      plannedInteractionIds: [
        "admin-cohost-confirm-click",
        "admin-session-grant-confirm-click",
        "admin-recovery-gate-confirm-click",
        "player-submit-vote-click",
        "player-submit-post-click",
        "player-private-channel-submit-post-click",
        "player-action-target-pick-confirm-click",
        "player-action-withdraw-confirm-click",
        "route-error-back-to-board-click",
        ...moderatorCriticalConfirmationScenarioIds,
        "admin-audit-native-flow",
        "admin-operational-forms",
        "player-private-disclosure-vote-and-post",
        "moderator-host-prompt-confirmation",
        "moderator-slot-lifecycle-confirmation",
      ],
      plannedStabilityCheckIds: [
        "admin-operator-action-status-floors",
        "moderator-primary-action-status-floors",
      ],
      runCount: 0,
      interactionIds: [],
      promotionFailures: [
        "inAppBrowserRun.status is localhost-bind-blocked, expected passed",
        "inAppBrowserRun.viewports is empty or absent",
      ],
      blockedReason:
        "Localhost-served fixture browser-run evidence has not completed.",
    },
    inAppBrowserImportedRun: {
      status: "source_blocked",
      artifactStatus: "source-blocked",
      boundary:
        "The selected file-backed in-app browser browser-run artifact is not passed, so no imported browser evidence was promoted. This artifact preserves the source status and planned interaction matrix for a later Chromium-capable replay/import.",
      promotionEligible: false,
      sourceBrowserRun: {
        path: summary.browserAcceptance.inAppBrowserImportedRun.sourceBrowserRun.path,
        status: "chromium-launch-blocked",
        mode: "generate-and-run",
        regeneratedFixture: true,
        pageUrl: summary.browserAcceptance.inAppBrowserImportedRun.sourceBrowserRun.pageUrl,
        plannedInteractionCount: EXPECTED_COUNTS.plannedInteractions,
        plannedStabilityCheckCount: 2,
      },
      validated: {
        viewportCount: 0,
        runCount: 0,
        plannedInteractionCount: EXPECTED_COUNTS.plannedInteractions,
        plannedStabilityCheckCount: 2,
        stabilityCheckTileCount: EXPECTED_COUNTS.stabilityCheckTiles,
        moderatorCriticalConfirmationCount: EXPECTED_COUNTS.moderatorCriticalActions,
        screenshotCheckCount: 0,
      },
      blocking: [
        "source browser-run status is chromium-launch-blocked, expected passed",
        "Run npm run test:frontend-iab-fixture-replay in a Chromium-capable environment and import the resulting browser-run.json plus screenshots.",
      ],
      blockedReason:
        "No passed external file-backed browser-run artifact has been imported.",
    },
    importedRoleSmoke: {
      status: "source_blocked",
      artifactStatus: "source-blocked",
      boundary:
        "The selected localhost dev-server role-smoke artifact is not passed, so no imported full-app browser evidence was promoted. This preserves the source status and fallback boundary for a later Chromium-capable role-smoke run.",
      promotionEligible: false,
      sourceRoleSmoke: {
        path: "target/frontend-role-smoke/role-smoke.json",
        status: "static-dom-fallback-passed",
        boundary:
          "Dev-server browser smoke did not run because localhost bind was denied. Static route contracts and no-browser SSR DOM evidence were recorded, but no-bind Chromium SSR render proof was blocked before launch.",
        viewportCount: 0,
        boardCount: 0,
        roleCount: 0,
        routeStateCount: 0,
      },
      validated: {
        viewportCount: 0,
        boardCount: 0,
        roleCount: 0,
        playerPrivateChannelCount: 0,
        routeStateCount: 0,
        forbiddenRouteCount: 0,
        screenshotCheckCount: 0,
      },
      blocking: [
        "source role-smoke status is static-dom-fallback-passed, expected passed",
        "Run npm run test:frontend-role-smoke in a Chromium-capable environment, then import target/frontend-role-smoke/role-smoke.json plus its referenced screenshots.",
      ],
      blockedReason:
        "No passed external localhost role-smoke artifact has been imported.",
    },
    boundaryArtifact: {
      status: "incomplete",
      proof: "frontend-browser-acceptance-boundary",
      lanes: [
        {
          id: "localhost-dev-server-role-smoke",
          status: "blocked",
          artifactStatus: "static-dom-fallback-passed",
          promotionEligible: true,
        },
        {
          id: "chromium-no-bind-render",
          status: "blocked",
          artifactStatus: "chromium-launch-blocked",
          promotionEligible: false,
        },
        {
          id: "chromium-no-bind-interactions",
          status: "blocked",
          artifactStatus: "chromium-launch-blocked",
          promotionEligible: false,
        },
        {
          id: "chromium-no-bind-keyboard",
          status: "blocked",
          artifactStatus: "chromium-launch-blocked",
          promotionEligible: false,
        },
        {
          id: "in-app-file-static-dom",
          status: "proven",
          artifactStatus: "passed",
          promotionEligible: false,
        },
        {
          id: "in-app-file-backed-fixture",
          status: "fixture_prepared",
          artifactStatus: "page-generated",
          promotionEligible: false,
        },
        {
          id: "in-app-file-browser-run",
          status: "blocked",
          artifactStatus: "chromium-launch-blocked",
          promotionEligible: true,
        },
        {
          id: "in-app-localhost-fixture-browser-run",
          status: "blocked",
          artifactStatus: "localhost-bind-blocked",
          promotionEligible: true,
        },
        {
          id: "in-app-file-imported-browser-run",
          status: "blocked",
          artifactStatus: "source-blocked",
          promotionEligible: true,
        },
        {
          id: "imported-localhost-role-smoke",
          status: "blocked",
          artifactStatus: "source-blocked",
          promotionEligible: true,
        },
      ],
      blockers: summary.browserAcceptance.boundaryArtifact.blockers,
      diagnosticBlockers:
        summary.browserAcceptance.boundaryArtifact.diagnosticBlockers,
    },
  });
  }
  if (summary.browserAcceptance.requirement.state !== "browser_proven") {
    assert.equal(summary.browserAcceptance.boundaryArtifact.blockers.length > 0, true);
  }
});

function assertPixelEvidence(entries, label) {
  assert.equal(entries.length > 0, true, `${label} missing entries`);
  for (const entry of entries) {
    assert.equal(typeof entry.screenshot, "string", `${label} screenshot path missing`);
    assert.equal(entry.screenshot.endsWith(".png"), true);
    assert.equal(
      typeof entry.screenshotPixels?.width,
      "number",
      `${label} width missing`,
    );
    assert.equal(
      typeof entry.screenshotPixels?.height,
      "number",
      `${label} height missing`,
    );
    assert.equal(
      entry.screenshotPixels.width,
      entry.viewport.width,
      `${label} width must match viewport`,
    );
    assert.equal(
      entry.screenshotPixels.height >= entry.viewport.height,
      true,
      `${label} height must cover viewport`,
    );
    assert.equal(
      entry.screenshotPixels.uniqueColorBuckets >= 8,
      true,
      `${label} color buckets prove nonblank pixels`,
    );
    assert.equal(
      entry.screenshotPixels.changedPixelRatio >= 0.005,
      true,
      `${label} changed pixel ratio proves nonblank pixels`,
    );
  }
}

function assertBrowserSetupWorkbenchEvidence(setupEntries) {
  assert.equal(
    Array.isArray(setupEntries),
    true,
    "host setup browser geometry evidence missing",
  );
  assert.equal(setupEntries.length, setupViewports.length);
  assert.deepEqual(
    setupEntries.map((entry) => [entry.viewport.name, entry.role, entry.path]),
    setupViewports.map((viewport) => [
      viewport.name,
      hostSetupScenario.role,
      hostSetupScenario.path,
    ]),
  );

  for (const entry of setupEntries) {
    const expectedLayout =
      entry.viewport.width <= 820 ? "stacked" : "co-located-columns";
    assert.equal(entry.surfaceTestId, hostSetupScenario.surfaceTestId);
    assert.equal(entry.capabilityTestId, hostSetupScenario.capabilityTestId);
    assert.equal(entry.layout, expectedLayout);
    assert.equal(entry.noHorizontalOverflow, true);
    assert.equal(entry.overflow.scrollWidth <= entry.overflow.clientWidth + 1, true);
    assert.equal(entry.overlapCheckedTargets >= 11, true);
    assert.deepEqual(
      entry.slotCards.map((slot) => [
        slot.slotId,
        slot.layout,
        slot.roleCellContainedInCard,
        slot.assignmentContainedInCard,
      ]),
      hostSetupScenario.slotIds.map((slotId) => [
        slotId,
        expectedLayout,
        true,
        true,
      ]),
    );
    assertPixelEvidence([entry], "host setup workbench screenshots");
  }
}

function assertBrowserConfirmationFocusEvidence(roleEntries) {
  const adminEntries = roleEntries.filter((entry) => entry.role === "admin");
  const moderatorEntries = roleEntries.filter((entry) => entry.role === "moderator");
  assert.equal(adminEntries.length > 0, true, "admin browser focus evidence missing");
  assert.equal(
    moderatorEntries.length > 0,
    true,
    "moderator browser focus evidence missing",
  );

  for (const entry of adminEntries) {
    assert.deepEqual(
      entry.commandResult.sessionGrant.focus.contract,
      {
        initialFocusTestId: "admin-command-confirm-session-grants",
        returnFocusTestId: "admin-command-trigger-session-grants",
        escapeCancels: "true",
        tabContainment: "local-confirmation-controls",
      },
    );
    assert.deepEqual(
      entry.commandResult.sessionGrant.focus.initialFocus.testId,
      "admin-command-confirm-session-grants",
    );
    assert.deepEqual(
      entry.commandResult.sessionGrant.focus.tabSequence.map((focus) => focus.testId),
      [
        "admin-command-cancel-session-grants",
        "admin-session-grant-token",
        "admin-session-grant-principal",
        "admin-session-grant-expires-at",
        "admin-session-grant-global-mod",
        "admin-command-confirm-session-grants",
      ],
    );
    assert.deepEqual(
      entry.commandResult.sessionGrant.focus.shiftTabReturnFocus.testId,
      "admin-command-cancel-session-grants",
    );
    assert.deepEqual(
      entry.commandResult.sessionGrant.focus.escapeReturnFocus.testId,
      "admin-command-trigger-session-grants",
    );
    assert.deepEqual(entry.commandResult.sessionGrant.form, {
      formTestId: "admin-session-grant-form",
      action: "?/grantSession",
      fieldTestIds: [
        "admin-session-grant-token",
        "admin-session-grant-principal",
        "admin-session-grant-expires-at",
        "admin-session-grant-global-mod",
      ],
      fieldNames: [],
    });
    assert.deepEqual(
      entry.commandResult.cohost.focus.contract,
      {
        initialFocusTestId: "admin-command-confirm-cohost",
        returnFocusTestId: "admin-command-trigger-cohost",
        escapeCancels: "true",
        tabContainment: "local-confirmation-controls",
      },
    );
    assert.deepEqual(
      entry.commandResult.cohost.focus.tabSequence.map((focus) => focus.testId),
      [
        "admin-command-cancel-cohost",
        "admin-command-confirm-cohost",
        "admin-command-cancel-cohost",
      ],
    );
    assert.deepEqual(
      entry.commandResult.cohost.focus.escapeReturnFocus.testId,
      "admin-command-trigger-cohost",
    );
    assert.deepEqual(
      entry.commandResult.recovery.focus.contract,
      {
        initialFocusTestId: "admin-recovery-confirm-recovery-gate",
        returnFocusTestId: "admin-recovery-trigger-recovery-gate",
        escapeCancels: "true",
        tabContainment: "local-confirmation-controls",
      },
    );
    assert.deepEqual(
      entry.commandResult.recovery.focus.tabSequence.map((focus) => focus.testId),
      [
        "admin-recovery-cancel-recovery-gate",
        "admin-recovery-confirm-recovery-gate",
        "admin-recovery-cancel-recovery-gate",
      ],
    );
    assert.deepEqual(
      entry.commandResult.recovery.focus.escapeReturnFocus.testId,
      "admin-recovery-trigger-recovery-gate",
    );
    assert.deepEqual(entry.commandResult.recovery.form, {
      formTestId: "admin-recovery-form-recovery-gate",
      action: "?/checkRecoveryGate",
      fieldTestIds: [],
      fieldNames: ["game", "principalUserId"],
    });
    assert.deepEqual(entry.commandResult.activity.rejected, {
      activityTestId: "admin-command-activity",
      activityItemTestId: "admin-command-activity-cohost",
      statusTestId: "admin-command-activity-status-cohost",
      state: "reject",
      message: "Reject StreamConflict: reload and retry",
      statusRegion: {
        state: "reject",
        role: "status",
        ariaLive: "assertive",
        ariaAtomic: "true",
      },
    });
    assert.equal(
      entry.commandResult.activity.acknowledged.activityTestId,
      "admin-command-activity",
    );
    assert.equal(
      entry.commandResult.activity.acknowledged.activityItemTestId,
      "admin-command-activity-recovery-gate",
    );
    assert.equal(
      entry.commandResult.activity.acknowledged.statusTestId,
      "admin-command-activity-status-recovery-gate",
    );
    assert.equal(entry.commandResult.activity.acknowledged.state, "ack");
    assert.match(
      entry.commandResult.activity.acknowledged.message,
      /Recovery gate trusted:/,
    );
    assert.deepEqual(entry.commandResult.activity.acknowledged.statusRegion, {
      state: "ack",
      role: "status",
      ariaLive: "polite",
      ariaAtomic: "true",
    });
    assert.deepEqual(entry.linkAffordances, [
      {
        testId: "admin-audit-link-proof-runs",
        hrefPath: "/admin/audit/proof-runs",
        searchParams: {
          game: "midsummer",
        },
      },
    ]);
  }

  for (const entry of moderatorEntries) {
    assert.deepEqual(
      entry.commandResult.focus.contract,
      {
        initialFocusTestId: "critical-host-action-confirm",
        returnFocusTestId: "critical-host-action-trigger",
        escapeCancels: "true",
        tabContainment: "confirm-cancel",
      },
    );
    assert.deepEqual(
      entry.commandResult.focus.initialFocus.testId,
      "critical-host-action-confirm",
    );
    assert.deepEqual(
      entry.commandResult.focus.tabSequence.map((focus) => focus.testId),
      [
        "critical-host-action-cancel",
        "critical-host-action-confirm",
        "critical-host-action-cancel",
      ],
    );
    assert.deepEqual(
      entry.commandResult.focus.escapeReturnFocus.testId,
      "critical-host-action-trigger",
    );
    assert.deepEqual(entry.commandResult.activity.rejected, {
      activityTestId: "host-command-activity",
      activityItemTestId: "host-command-activity-extend_deadline",
      statusTestId: "host-command-activity-status-extend_deadline",
      state: "reject",
      message: "Reject StreamConflict: reload and retry",
      statusRegion: {
        state: "reject",
        role: "status",
        ariaLive: "assertive",
        ariaAtomic: "true",
      },
    });
    assert.deepEqual(entry.commandResult.activity.acknowledged, {
      activityTestId: "host-command-activity",
      activityItemTestId:
        "host-command-activity-resolve_host_prompt-D01-skip_next_day-slot_1",
      statusTestId:
        "host-command-activity-status-resolve_host_prompt-D01-skip_next_day-slot_1",
      state: "ack",
      message: "Ack: stream seqs 91",
      statusRegion: {
        state: "ack",
        role: "status",
        ariaLive: "polite",
        ariaAtomic: "true",
      },
    });
    assert.deepEqual(entry.commandResult.activity.slotLifecycle, {
      activityTestId: "host-command-activity",
      activityItemTestId: "host-command-activity-modkill_slot",
      statusTestId: "host-command-activity-status-modkill_slot",
      state: "ack",
      message: "Ack: stream seqs 73",
      statusRegion: {
        state: "ack",
        role: "status",
        ariaLive: "polite",
        ariaAtomic: "true",
      },
    });
    assert.equal(
      entry.commandResult.hostPrompt.actionId,
      "resolve_host_prompt-D01-skip_next_day-slot_1",
    );
    assert.equal(entry.commandResult.hostPrompt.state, "ack");
    assert.deepEqual(entry.commandResult.hostPrompt.streamSeqs, [91]);
    assert.deepEqual(entry.commandResult.hostPrompt.requestCommand, {
      ResolveHostPrompt: {
        game: "midsummer",
        prompt_id: "D01:skip_next_day:slot_1",
        decision: "Acknowledge",
      },
    });
    assert.deepEqual(entry.commandResult.hostPrompt.dispatchedPayload, {
      kind: "resolve_host_prompt",
      gameId: "midsummer",
      promptId: "D01:skip_next_day:slot_1",
      decision: {
        kind: "acknowledge",
      },
    });
    assert.deepEqual(
      entry.commandResult.hostPrompt.focus.contract,
      {
        initialFocusTestId: "critical-host-action-confirm",
        returnFocusTestId: "critical-host-action-trigger",
        escapeCancels: "true",
        tabContainment: "confirm-cancel",
      },
    );
    assert.deepEqual(
      entry.commandResult.hostPrompt.focus.tabSequence.map((focus) => focus.testId),
      [
        "critical-host-action-cancel",
        "critical-host-action-confirm",
        "critical-host-action-cancel",
      ],
    );
    assert.deepEqual(
      entry.commandResult.hostPrompt.focus.escapeReturnFocus.testId,
      "critical-host-action-trigger",
    );
    assert.deepEqual(
      entry.commandResult.hostPrompt.cancelFocus.testId,
      "critical-host-action-trigger",
    );
    assert.equal(entry.commandResult.hostPrompt.promptProjectionRows, 0);
    assert.equal(entry.commandResult.hostPrompt.actionDetached, true);
    assert.equal(entry.commandResult.hostPrompt.emptyLabelRendered, true);
    assert.equal(entry.commandResult.slotLifecycle.actionId, "modkill_slot");
    assert.equal(entry.commandResult.slotLifecycle.state, "ack");
    assert.deepEqual(entry.commandResult.slotLifecycle.streamSeqs, [73]);
    assert.deepEqual(entry.commandResult.slotLifecycle.requestCommand, {
      SetSlotStatus: {
        game: "midsummer",
        slot: "slot-7",
        status: "modkilled",
      },
    });
    assert.deepEqual(entry.commandResult.slotLifecycle.dispatchedPayload, {
      kind: "modkill_slot",
      gameId: "midsummer",
      slotId: "slot-7",
      status: "modkilled",
    });
    assert.deepEqual(entry.commandResult.slotLifecycle.projection, {
      lifecycleLabel: "Modkilled",
      historyLabel: "Slot history remains attached to slot-7",
    });
    assert.deepEqual(
      entry.commandResult.slotLifecycle.focus.contract,
      {
        initialFocusTestId: "critical-host-action-confirm",
        returnFocusTestId: "critical-host-action-trigger",
        escapeCancels: "true",
        tabContainment: "confirm-cancel",
      },
    );
    assert.deepEqual(
      entry.commandResult.slotLifecycle.focus.tabSequence.map(
        (focus) => focus.testId,
      ),
      [
        "critical-host-action-cancel",
        "critical-host-action-confirm",
        "critical-host-action-cancel",
      ],
    );
    assert.deepEqual(
      entry.commandResult.slotLifecycle.focus.escapeReturnFocus.testId,
      "critical-host-action-trigger",
    );
  }
}

function assertBrowserAdminAuditDetailClickEvidence(roleEntries) {
  const adminEntries = roleEntries.filter((entry) => entry.role === "admin");
  assert.equal(adminEntries.length > 0, true, "admin browser click evidence missing");

  for (const entry of adminEntries) {
    assert.deepEqual(entry.linkClickProofs.map((proof) => proof.testId), [
      "admin-audit-link-proof-runs",
    ]);
    const proof = entry.linkClickProofs[0];
    assert.equal(proof.path, "/admin/audit/proof-runs");
    assert.deepEqual(proof.searchParams, { game: "midsummer" });
    assert.equal(proof.surfaceTestId, "admin-audit-detail-surface");
    assert.equal(proof.auditId, "proof-runs");
    assert.match(proof.capability, /GlobalAdmin/);
    assert.deepEqual(proof.statusRegion, {
      state: "ack",
      role: "status",
      ariaLive: "polite",
      ariaAtomic: "true",
    });
    assert.equal(proof.evidenceTestId, "admin-audit-detail-evidence");
    assert.equal(
      proof.evidenceHref,
      "/games/midsummer/operator/proof-runs?principal_user_id=admin_a",
    );
    assert.equal(proof.backTestId, "admin-audit-detail-back");
    assert.equal(proof.backHref, "/admin?game=midsummer");
    assert.equal(proof.overlapCheckedTargets >= 2, true);
    assertPixelEvidence([proof], "admin audit detail click screenshots");
  }
}

function assertBrowserPlayerPrivateDisclosureEvidence(roleEntries) {
  const playerEntries = roleEntries.filter((entry) => entry.role === "player");
  assert.equal(playerEntries.length > 0, true, "player private disclosure evidence missing");

  for (const entry of playerEntries) {
    assert.deepEqual(entry.commandResult.commandReceipt, {
      receiptTestId: "player-command-receipt",
      receiptItemTestId: "player-command-receipt-submit_vote",
      statusTestId: "player-command-status",
      state: "reject",
      message: "Reject StreamConflict: reload and retry",
      exportedReceipts: [
        {
          actionId: "submit_vote",
          state: "reject",
          message: "Reject StreamConflict: reload and retry",
          commandTrace:
            entry.commandResult.commandReceipt.exportedReceipts[0].commandTrace,
          current: true,
        },
      ],
      statusRegion: {
        state: "reject",
        role: "status",
        ariaLive: "assertive",
        ariaAtomic: "true",
      },
    });
    assert.match(
      entry.commandResult.liveThread.refreshedPost,
      /Browser smoke refreshed player post\./,
    );
    assert.deepEqual(entry.commandResult.postCommand.requestCommand, {
      game: "midsummer",
      channel_id: "main",
      actor_slot: "slot-7",
      body: "Browser smoke player post",
    });
    assert.deepEqual(entry.commandResult.postCommand.statusRegion, {
      state: "ack",
      role: "status",
      ariaLive: "polite",
      ariaAtomic: "true",
    });
    assert.equal(entry.commandResult.postCommand.state, "ack");
    assert.match(entry.commandResult.postCommand.message, /Ack: stream seqs 72/);
    assert.equal(
      entry.commandResult.postCommand.refreshedPostTestId,
      "thread-post-445",
    );
    assert.deepEqual(entry.commandResult.postCommandReceipt, {
      receiptTestId: "player-command-receipt",
      receiptItemTestId: "player-command-receipt-submit_post",
      statusTestId: "player-command-status",
      state: "ack",
      message: "Ack: stream seqs 72",
      exportedReceipts: [
        {
          actionId: "submit_vote",
          state: "reject",
          message: "Reject StreamConflict: reload and retry",
          commandTrace:
            entry.commandResult.postCommandReceipt.exportedReceipts[0].commandTrace,
          current: false,
        },
        {
          actionId: "submit_post",
          state: "ack",
          message: "Ack: stream seqs 72",
          commandTrace:
            entry.commandResult.postCommandReceipt.exportedReceipts[1].commandTrace,
          current: true,
        },
      ],
      statusRegion: {
        state: "ack",
        role: "status",
        ariaLive: "polite",
        ariaAtomic: "true",
      },
    });
    assert.equal(entry.commandResult.media.mediaTestId, "thread-post-media-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");
    assert.equal(entry.commandResult.media.renderedVariant, "tablet");
    assert.equal(entry.commandResult.media.requestedOriginal, false);
    assert.equal(entry.commandResult.media.requested.length > 0, true);
    assert.equal(
      entry.commandResult.media.requested.every((request) =>
        ["tablet", "small", "thumb", "thumbnail"].includes(request.variant),
      ),
      true,
    );
    assert.equal(entry.commandResult.media.image.src.includes("original"), false);
    assert.equal(String(entry.commandResult.media.image.srcset ?? "").includes("original"), false);
    const disclosure = entry.commandResult.privateDisclosure;
    assert.equal(disclosure.reviewTestId, "player-private-review-notification-1");
    assert.equal(disclosure.reviewLinkTestId, "player-private-link-notification-1");
    assert.equal(disclosure.reviewHref, "/g/midsummer?private=notification-1");
    assert.equal(disclosure.detailTestId, "player-private-detail-notification-1");
    assert.deepEqual(disclosure.routeReview.searchParams, {
      private: "notification-1",
    });
    assert.equal(disclosure.routeReview.path, "/g/midsummer");
    assert.equal(disclosure.routeReview.reviewHref, "/g/midsummer?private=notification-1");
    assert.equal(disclosure.routeReview.detailTestId, "player-private-detail-notification-1");
    assert.equal(disclosure.routeReview.ariaExpanded, "true");
    assert.equal(disclosure.routeReview.detailRendered, true);
    assert.equal(disclosure.routeReview.hostOnlyCopyExcluded, true);
    assert.match(disclosure.routeReview.detail, /Phase N02/);
    assert.equal(disclosure.collapsed.ariaExpanded, "false");
    assert.equal(disclosure.collapsed.detailRendered, false);
    assert.equal(disclosure.expanded.ariaExpanded, "true");
    assert.equal(disclosure.expanded.detailRendered, true);
    assert.equal(disclosure.focusStayedOnButton, true);
    assert.equal(disclosure.hostOnlyCopyExcluded, true);
    assert.match(disclosure.detail, /Phase N02/);
    assertPixelEvidence(
      [disclosure.collapsed],
      "player private disclosure collapsed screenshots",
    );
    assertPixelEvidence(
      [disclosure.expanded],
      "player private disclosure expanded screenshots",
    );
    assertPixelEvidence(
      [disclosure.routeReview],
      "player private review URL screenshots",
    );
  }
}

function assertBrowserPlayerPrivateChannelEvidence(entries) {
  assert.equal(
    Array.isArray(entries) && entries.length > 0,
    true,
    "player private-channel browser evidence missing",
  );

  for (const entry of entries) {
    assert.equal(entry.role, "player-private-channel");
    assert.equal(entry.path, "/g/midsummer/c/private%3Arole_pm%3Aslot-7");
    assert.equal(entry.activeChannelTestId, "player-channel-private:role_pm:slot-7");
    assert.equal(
      entry.privateReviewHref,
      "/g/midsummer/c/private%3Arole_pm%3Aslot-7?private=notification-1",
    );
    assert.equal(entry.commandResult.state, "ack");
    assert.match(entry.commandResult.message, /Ack: stream seqs 172/);
    assert.deepEqual(entry.commandResult.requestCommand, {
      game: "midsummer",
      channel_id: "private:role_pm:slot-7",
      actor_slot: "slot-7",
      body: "Browser smoke private:role_pm:slot-7 post",
    });
    assert.equal(entry.commandResult.refreshedPostTestId, "thread-post-446");
    assert.match(
      entry.commandResult.refreshedPost,
      /Browser smoke refreshed private channel post\./,
    );
    assert.deepEqual(entry.commandResult.statusRegion, {
      state: "ack",
      role: "status",
      ariaLive: "polite",
      ariaAtomic: "true",
    });
    assert.deepEqual(entry.commandResult.receipt, {
      receiptTestId: "player-command-receipt",
      receiptItemTestId: "player-command-receipt-submit_post",
      statusTestId: "player-command-status",
      state: "ack",
      message: "Ack: stream seqs 172",
      exportedReceipts: [
        {
          actionId: "submit_post",
          state: "ack",
          message: "Ack: stream seqs 172",
          commandTrace:
            entry.commandResult.receipt.exportedReceipts[0].commandTrace,
          current: true,
        },
      ],
      statusRegion: {
        state: "ack",
        role: "status",
        ariaLive: "polite",
        ariaAtomic: "true",
      },
    });
    assert.equal(entry.media.mediaTestId, "thread-post-media-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");
    assert.equal(entry.media.renderedVariant, "tablet");
    assert.equal(entry.media.requestedOriginal, false);
    assert.equal(entry.media.requested.length > 0, true);
    assert.deepEqual(
      entry.focusTraversal.expectedOrder,
      [
        "app-shell-skip-link",
        "role-nav-board",
        "role-nav-player",
        "player-channel-main",
        "player-channel-private:role_pm:slot-7",
        "player-thread-load-older",
      ],
    );
    assert.equal(entry.overlapCheckedTargets >= 3, true);
    assertPixelEvidence([entry], "player private-channel screenshots");
  }
}

async function assertRoleDomFallbackEvidence(roleSmoke) {
  const domSmoke = await readJsonArtifact(roleDomSmokePath);

  assert.equal(roleSmoke.domSmoke.status, "passed");
  assert.equal(roleSmoke.domSmoke.proof, "ssr-dom-static-role-smoke");
  assert.equal(roleSmoke.domSmoke.status, domSmoke.status);
  assert.equal(roleSmoke.domSmoke.proof, domSmoke.proof);
  assert.equal(roleSmoke.domSmoke.surfaceCount, 8);
  assert.equal(roleSmoke.domSmoke.surfaceCount, domSmoke.surfaces.length);
  assert.equal(roleSmoke.domSmoke.routeStateCount, routeStateScenarios.length);
  assert.equal(roleSmoke.domSmoke.routeStateCount, domSmoke.routeStates.length);
  assert.deepEqual(
    roleSmoke.domSmoke.surfaces.map((surface) => [
      surface.id,
      surface.role,
      surface.path,
      surface.surfaceTestId,
    ]),
    [
      ["board", "board", "/", "board-surface"],
      ["board-player-blocked-actions", "board", "/", "board-surface"],
      ["admin", "admin", "/admin", "admin-surface"],
      [
        "admin-audit-detail",
        "admin",
        "/admin/audit/proof-runs?game=midsummer",
        "admin-audit-detail-surface",
      ],
      ["player", "player", "/g/midsummer", "player-surface"],
      [
        "player-private-review",
        "player",
        "/g/midsummer?private=notification-1",
        "player-surface",
      ],
      [
        "player-private-channel",
        "player",
        "/g/midsummer/c/private%3Arole_pm%3Aslot-7",
        "player-surface",
      ],
      ["moderator", "moderator", "/g/midsummer/host", "host-console-surface"],
    ],
  );
  for (const surface of roleSmoke.domSmoke.surfaces) {
    assert.equal(surface.htmlBytes > 0, true);
    assert.equal(surface.touchTargets.count > 0, true);
    assert.equal(surface.touchTargets.minPx >= 44, true);
  }
  const domErrorSurface = roleSmoke.domSmoke.errorSurface ?? domSmoke.errorSurface;
  assert.deepEqual(domErrorSurface, {
    role: "player",
    path: "/g/midsummer/c/private%3Arole_pm%3Aslot-7",
    status: 403,
    surface: "player",
    surfaceTestId: "route-error-surface",
    panelTestId: "route-error-panel",
    actionTestId: "route-error-action",
    actionHref: "/",
    activeNavTestId: roleNavTestId("player"),
    sessionPrincipal: "player_mira",
    capabilitySummary: "ChannelMember + SlotOccupant",
    message: "Channel private:role_pm:slot-7 is not visible.",
    touchTargets: {
      count: domErrorSurface.touchTargets.count,
      minPx: domErrorSurface.touchTargets.minPx,
    },
    htmlBytes: domErrorSurface.htmlBytes,
  });
  assert.equal(domErrorSurface.touchTargets.count > 0, true);
  assert.equal(domErrorSurface.touchTargets.minPx >= 44, true);
  assert.equal(domErrorSurface.htmlBytes > 0, true);
  const domFeedbackTraces = roleSmoke.domSmoke.feedbackTraces ?? domSmoke.feedbackTraces;
  assert.deepEqual(domFeedbackTraces, {
    boundary:
      "Build-mode Svelte SSR renders active admin, player, and moderator feedback rows with command trace attributes. This proves the rendered DOM carries trace metadata, not hydrated click-to-dispatch behavior.",
    admin: {
      component: "admin-command-activity",
      rowTestId: "admin-command-activity-recovery-gate",
      statusTestId: "admin-command-activity-status-recovery-gate",
      confirmationTrace: {
        kind: "confirmation-command-trace",
        surface: "admin-recovery",
        actionId: "recovery-gate",
        statusKey: "recovery-gate",
        dispatchKind: "check_recovery_gate",
      },
      htmlBytes: domFeedbackTraces.admin.htmlBytes,
    },
    player: {
      component: "player-command-receipt",
      rowTestId: "player-command-receipt-submit_vote",
      statusTestId: "player-command-status",
      commandTrace: {
        kind: "command-trace",
        surface: "player",
        actionId: "submit_vote",
        statusKey: "submit_vote",
        dispatchKind: "submit_vote",
        refreshKeys: "votecount,commandState",
      },
      htmlBytes: domFeedbackTraces.player.htmlBytes,
    },
    moderator: {
      component: "host-command-activity",
      rowTestId: "host-command-activity-resolve_host_prompt-D01-skip_next_day-slot_1",
      statusTestId:
        "host-command-activity-status-resolve_host_prompt-D01-skip_next_day-slot_1",
      confirmationTrace: {
        kind: "confirmation-command-trace",
        surface: "moderator-host",
        actionId: "resolve_host_prompt-D01-skip_next_day-slot_1",
        statusKey: "resolve_host_prompt-D01-skip_next_day-slot_1",
        dispatchKind: "resolve_host_prompt",
      },
      htmlBytes: domFeedbackTraces.moderator.htmlBytes,
    },
  });
  assert.equal(domFeedbackTraces.admin.htmlBytes > 0, true);
  assert.equal(domFeedbackTraces.player.htmlBytes > 0, true);
  assert.equal(domFeedbackTraces.moderator.htmlBytes > 0, true);
  assert.deepEqual(
    roleSmoke.domSmoke.routeStates.map((scenario) => [
      scenario.id,
      scenario.role,
      scenario.state,
      scenario.statusState,
      scenario.ariaLive,
    ]),
    routeStateScenarios.map((scenario) => [
      scenario.id,
      scenario.role,
      scenario.state,
      scenario.statusState,
      scenario.ariaLive,
    ]),
  );
}

function assertRoleRenderFallbackEvidence(roleSmoke) {
  assert.equal(typeof roleSmoke.renderSmoke?.status, "string");

  if (roleSmoke.renderSmoke.status === "passed") {
    assert.equal(roleSmoke.status, "static-render-fallback-passed");
    assert.equal(roleSmoke.renderSmoke.proof, "chromium-ssr-no-bind-render");
    assert.deepEqual(roleSmoke.renderSmoke.viewports, viewports);
    assert.equal(roleSmoke.renderSmoke.surfaceCount, viewports.length * 7);
    assert.equal(roleSmoke.renderSmoke.feedbackRailCount, viewports.length * 3);
    assert.equal(
      roleSmoke.renderSmoke.routeStateCount,
      viewports.length * routeStateScenarios.length,
    );
    assertPixelEvidence(
      roleSmoke.renderSmoke.surfaceScreenshots,
      "no-bind render surface screenshots",
    );
    assertPixelEvidence(
      roleSmoke.renderSmoke.feedbackRailScreenshots,
      "no-bind render feedback rail screenshots",
    );
    assertPixelEvidence(
      roleSmoke.renderSmoke.routeStateScreenshots,
      "no-bind render route-state screenshots",
    );
    return;
  }

  assert.equal(roleSmoke.status, "static-dom-fallback-passed");
  assert.equal(roleSmoke.renderSmoke.status, "chromium-launch-blocked");
  assert.equal(roleSmoke.renderSmoke.proof, "chromium-ssr-no-bind-render");
  assert.equal(
    roleSmoke.renderSmoke.routeStateRenderArtifact,
    "target/frontend-route-state-render/route-state-render.json",
  );
  assert.match(roleSmoke.renderSmoke.error.message, /browserType\.launch|Chromium/i);
}

function assertNoBindInteractionEntries(entries, expected) {
  assert.equal(Array.isArray(entries), true);
  const matchingEntries = entries.filter((entry) => entry.id === expected.id);
  assert.equal(matchingEntries.length, viewports.length);
  assert.deepEqual(
    matchingEntries.map((entry) => [
      entry.id,
      entry.render,
      entry.renderArgs,
      entry.targetSelector,
    ]),
    viewports.map(() => [
      expected.id,
      expected.render,
      expected.renderArgs,
      expected.targetSelector,
    ]),
  );
  for (const entry of matchingEntries) {
    assert.deepEqual(entry.viewport, viewports.find((viewport) =>
      viewport.name === entry.viewport.name
    ));
    assert.equal(entry.minTouchTargetPx, 44);
    assert.equal(entry.targetBox.width >= 44, true);
    assert.equal(entry.targetBox.height >= 44, true);
    assert.equal(entry.clicked.tagName, "button");
    assert.equal(entry.activeElement.tagName, "button");
    if (expected.targetTestId !== undefined) {
      assert.equal(entry.targetTestId, expected.targetTestId);
      assert.equal(entry.clicked.testId, expected.targetTestId);
      assert.equal(entry.activeElement.testId, expected.targetTestId);
    }
    if (expected.targetAction !== undefined) {
      assert.equal(entry.targetAction, expected.targetAction);
      assert.equal(entry.clicked.action, expected.targetAction);
      assert.equal(entry.activeElement.action, expected.targetAction);
    }
    if (expected.form !== undefined) {
      assert.deepEqual(entry.form, expected.form);
    }
    if (expected.route !== undefined) {
      assert.deepEqual(entry.route, expected.route);
    }
    if (expected.media !== undefined) {
      assert.equal(entry.media.boundaryTestId, expected.media.boundaryTestId);
      assert.equal(entry.media.mediaTestId, expected.media.mediaTestId);
      assert.equal(entry.media.renderedVariant, expected.media.renderedVariant);
      assert.equal(entry.media.originalUrlRendered, expected.media.originalUrlRendered);
      assert.equal(
        entry.media.requested.every((request) =>
          ["tablet", "small", "thumb", "thumbnail"].includes(request.variant),
        ),
        true,
      );
      assert.equal(entry.media.image.src.includes("original"), false);
      assert.equal(String(entry.media.image.srcset ?? "").includes("original"), false);
    }
    if (expected.confirmation !== undefined) {
      assert.equal(entry.confirmation.actionId, expected.confirmation.actionId);
      assert.equal(entry.confirmation.payloadKind, expected.confirmation.payloadKind);
      assert.equal(entry.confirmation.role, "alertdialog");
      assert.equal(
        entry.confirmation.initialFocusTestId,
        "critical-host-action-confirm",
      );
      assert.equal(
        entry.confirmation.returnFocusTestId,
        "critical-host-action-trigger",
      );
      assert.equal(entry.confirmation.escapeCancels, "true");
      assert.equal(entry.confirmation.tabContainment, "confirm-cancel");
      assert.equal(
        entry.confirmation.messageText.includes(entry.confirmation.objectLabel),
        true,
      );
      assert.equal(
        entry.confirmation.messageText.includes(entry.confirmation.outcomeLabel),
        true,
      );
    }
  }
}

function assertNoBindPlannedInteractions(plannedInteractions) {
  assert.deepEqual(
    plannedInteractions.admin.map((entry) => entry.id),
    [
      "admin-cohost-confirm-click",
      "admin-session-grant-confirm-click",
      "admin-recovery-gate-confirm-click",
    ],
  );
  assert.deepEqual(
    plannedInteractions.player.map((entry) => entry.id),
    [
      "player-submit-vote-click",
      "player-submit-post-click",
      "player-private-channel-submit-post-click",
      "player-action-target-pick-confirm-click",
      "player-action-withdraw-confirm-click",
    ],
  );
  assert.deepEqual(
    plannedInteractions.moderator.map((entry) => [
      entry.id,
      entry.render,
      entry.renderArgs,
      entry.confirmation.actionId,
      entry.confirmation.payloadKind,
    ]),
    moderatorCriticalConfirmationActions.map(([actionId, payloadKind]) => [
      `moderator-${actionId}-confirm-click`,
      "renderModeratorActionConfirmation",
      [actionId],
      actionId,
      payloadKind,
    ]),
  );
}

function assertInAppBrowserPlannedInteractions(plannedInteractions) {
  assert.deepEqual(
    plannedInteractions.map((entry) => [
      entry.id,
      entry.role,
      entry.source,
      entry.targetTestId,
      entry.targetAction,
      entry.confirmation?.actionId,
      entry.confirmation?.payloadKind,
    ]),
    [
      [
        "admin-cohost-confirm-click",
        "admin",
        "manifest.scenarios",
        "admin-command-confirm-cohost",
        undefined,
        undefined,
        undefined,
      ],
      [
        "admin-session-grant-confirm-click",
        "admin",
        "manifest.scenarios",
        "admin-command-confirm-session-grants",
        undefined,
        undefined,
        undefined,
      ],
      [
        "admin-recovery-gate-confirm-click",
        "admin",
        "manifest.scenarios",
        "admin-recovery-confirm-recovery-gate",
        undefined,
        undefined,
        undefined,
      ],
      [
        "player-submit-vote-click",
        "player",
        "manifest.scenarios",
        undefined,
        "submit_vote",
        undefined,
        undefined,
      ],
      [
        "player-submit-post-click",
        "player",
        "manifest.scenarios",
        undefined,
        "submit_post",
        undefined,
        undefined,
      ],
      [
        "player-private-channel-submit-post-click",
        "player",
        "manifest.scenarios",
        undefined,
        "submit_post",
        undefined,
        undefined,
      ],
      [
        "player-action-target-pick-confirm-click",
        "player",
        "manifest.scenarios",
        "player-action-confirm-factional_kill",
        undefined,
        undefined,
        undefined,
      ],
      [
        "player-action-withdraw-confirm-click",
        "player",
        "manifest.scenarios",
        "player-action-withdraw-confirm-factional_kill",
        undefined,
        undefined,
        undefined,
      ],
      [
        "route-error-back-to-board-click",
        "player",
        "manifest.scenarios",
        "route-error-action",
        undefined,
        undefined,
        undefined,
      ],
      ...moderatorCriticalConfirmationActions.map(([actionId, payloadKind]) => [
        `moderator-${actionId}-confirm-click`,
        "moderator",
        "manifest.scenarios",
        "critical-host-action-confirm",
        undefined,
        actionId,
        payloadKind,
      ]),
      [
        "admin-audit-native-flow",
        "admin",
        "manifest.hydratedSurfaceScenarios",
        "iab-admin-audit-detail-link",
        undefined,
        undefined,
        undefined,
      ],
      [
        "admin-operational-forms",
        "admin",
        "manifest.hydratedSurfaceScenarios",
        "iab-admin-session-grant-ack",
        undefined,
        undefined,
        undefined,
      ],
      [
        "player-private-disclosure-vote-and-post",
        "player",
        "manifest.hydratedSurfaceScenarios",
        "iab-player-private-toggle",
        undefined,
        undefined,
        undefined,
      ],
      [
        "moderator-host-prompt-confirmation",
        "moderator",
        "manifest.hydratedSurfaceScenarios",
        "iab-moderator-prompt-confirm",
        undefined,
        undefined,
        undefined,
      ],
      [
        "moderator-slot-lifecycle-confirmation",
        "moderator",
        "manifest.hydratedSurfaceScenarios",
        "iab-moderator-slot-lifecycle-confirm",
        undefined,
        undefined,
        undefined,
      ],
    ],
  );
}

function shellNavCoverageSummary(entry) {
  return {
    id: entry.id,
    render: entry.render,
    navigation: entry.navigation,
    linkedNavTestIds: entry.linkedNavTestIds,
    blockedNavTestIds: entry.blockedNavTestIds,
    shellComponentCount: entry.shellComponentCount,
  };
}

function shellNavCoverageExpected({ id, render, navigation }) {
  return {
    id,
    render,
    navigation,
    linkedNavTestIds: navTestIds(navigation, "link"),
    blockedNavTestIds: navTestIds(navigation, "blocked"),
    shellComponentCount: 1,
  };
}

function navTestIds(navigation, state) {
  return Object.entries(navigation)
    .filter(([, value]) => value === state)
    .map(([surface]) => roleNavTestId(surface));
}

function renderFunctionForRole(role) {
  if (role === "admin") {
    return "renderAdminSurface";
  }
  if (role === "player") {
    return "renderPlayerSurface";
  }
  if (role === "moderator") {
    return "renderModeratorSurface";
  }
  throw new Error(`unknown shell nav role ${role}`);
}

async function readJsonArtifact(artifactPath) {
  try {
    return JSON.parse(await readFile(artifactPath, "utf8"));
  } catch (error) {
    error.message = `${path.relative(repoRoot, artifactPath)} is missing or invalid. Run npm run test:frontend-static-role-contract and FMARCH_ALLOW_STATIC_ROLE_FALLBACK=1 npm run test:frontend-role-smoke before this verifier.\n${error.message}`;
    throw error;
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseTarEntryNames(archive) {
  const names = [];
  let offset = 0;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      break;
    }
    const name = header
      .subarray(0, 100)
      .toString("utf8")
      .replace(/\0.*$/u, "");
    const sizeText = header
      .subarray(124, 136)
      .toString("ascii")
      .replace(/\0.*$/u, "")
      .trim();
    names.push(name);
    offset += 512 + Math.ceil(Number.parseInt(sizeText, 8) / 512) * 512;
  }
  return names;
}
