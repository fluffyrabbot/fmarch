import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  routeStateScenarios,
} from "./frontend_role_smoke_scenarios.mjs";
import {
  APP_SHELL_CONTRACT,
  roleNavTestId,
} from "../frontend/src/lib/app/app-shell-model.mjs";
import {
  PLAYER_COMMAND_PANEL_CONTRACT,
} from "../frontend/src/lib/components/player-command/player-command-panel-model.mjs";
import {
  PLAYER_THREAD_PAGER_CONTRACT,
} from "../frontend/src/lib/components/player-thread/player-thread-model.mjs";
import {
  HOST_TASK_WORKSPACE_CONTRACT,
} from "../frontend/src/lib/components/host-action/host-task-workspace.mjs";

const FIXTURE_THREAD_MEDIA_TEST_ID = `thread-post-media-${"e".repeat(64)}`;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = path.join(repoRoot, "target", "frontend-role-dom-smoke");
const evidencePath = path.join(artifactDir, "dom-smoke.json");
const routeStateBundle = path.join(
  repoRoot,
  "target",
  "frontend-route-state-render",
  "bundle",
  "entry.js",
);

await mkdir(artifactDir, { recursive: true });
await runRouteStateRenderContract();

const bundle = await import(`${pathToFileURL(routeStateBundle).href}?t=${Date.now()}`);

const evidence = {
  status: "passed",
  proof: "ssr-dom-static-role-smoke",
  boundary:
    "Renders build-mode Svelte SSR markup and verifies deterministic DOM contracts without opening localhost or launching Chromium. This proves shared shell IDs, route-state live-region attributes, real error-surface shell context, link affordances, touch target metadata, and private/host boundary strings. It does not prove CSS layout pixels, browser focus traversal, pointer events, hydration, fetch mocks, command dispatch, or WebSocket behavior.",
  surfaces: [],
  routeStates: [],
  errorSurface: null,
  feedbackTraces: null,
};

for (const surface of surfaceScenarios()) {
  const rendered = await bundle[surface.render]();
  const html = rendered.html;
  assertAppShell(html, surface);
  assertIncludes(html, `data-testid="${surface.surfaceTestId}"`, `${surface.id} surface`);
  for (const text of surface.requiredText) {
    assertIncludes(html, text, `${surface.id} required text`);
  }
  for (const testId of surface.requiredTestIds) {
    assertIncludes(html, `data-testid="${testId}"`, `${surface.id} required test id`);
  }
  for (const link of surface.links) {
    assertLink(html, link, surface.id);
  }
  for (const attribute of surface.requiredAttributes) {
    assertIncludes(html, attribute, `${surface.id} required attribute`);
  }
  for (const forbidden of surface.forbiddenText) {
    assertExcludesLower(html, forbidden, `${surface.id} forbidden text`);
  }
  const touchTargets = assertTouchTargetMetadata(html, surface.id);

  evidence.surfaces.push({
    id: surface.id,
    role: surface.role,
    path: surface.path,
    render: surface.render,
    surfaceTestId: surface.surfaceTestId,
    requiredTestIds: surface.requiredTestIds,
    links: surface.links,
    touchTargets,
    htmlBytes: Buffer.byteLength(html),
  });
}

for (const scenario of routeStateScenarios) {
  const rendered = await bundle.renderScenario(scenario.role, scenario.state);
  const html = rendered.html;
  assertAppShell(html, {
    id: scenario.id,
    role: scenario.surface,
  });
  assertIncludes(html, `data-testid="${scenario.rootTestId}"`, `${scenario.id} root`);
  assertIncludes(html, `data-testid="${scenario.statusTestId}"`, `${scenario.id} status`);
  assertIncludes(html, `data-testid="${scenario.actionTestId}"`, `${scenario.id} action`);
  assertIncludes(html, `data-state="${scenario.statusState}"`, `${scenario.id} state`);
  assertIncludes(html, `aria-live="${scenario.ariaLive}"`, `${scenario.id} aria-live`);
  assertTouchTargetMetadata(html, scenario.id);
  evidence.routeStates.push({
    id: scenario.id,
    role: scenario.role,
    surface: scenario.surface,
    state: scenario.state,
    path: scenario.path,
    rootTestId: scenario.rootTestId,
    statusTestId: scenario.statusTestId,
    actionTestId: scenario.actionTestId,
    statusState: scenario.statusState,
    ariaLive: scenario.ariaLive,
    htmlBytes: Buffer.byteLength(html),
  });
}

evidence.errorSurface = await proveRouteErrorSurface(bundle);
evidence.feedbackTraces = await proveFeedbackTraceMarkup(bundle);

await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`wrote ${path.relative(repoRoot, evidencePath)}`);

async function proveRouteErrorSurface(bundle) {
  const rendered = await bundle.renderRouteErrorSurface();
  const html = rendered.html;
  assertAppShell(html, {
    id: "route-error",
    role: "player",
  });
  assertIncludes(html, 'data-testid="route-error-surface"', "route error surface");
  assertIncludes(html, 'data-status="403"', "route error status");
  assertIncludes(html, 'data-testid="route-error-panel"', "route error panel");
  assertIncludes(html, 'data-testid="route-error-action"', "route error action");
  assertIncludes(html, 'href="/"', "route error action href");
  assertIncludes(html, "Access blocked", "route error title");
  assertIncludes(
    html,
    "Channel private:role_pm:slot-7 is not visible.",
    "route error message",
  );
  assertIncludes(html, "/g/midsummer/c/private%3Arole_pm%3Aslot-7", "route error path");
  assertIncludes(html, "player_mira", "route error session principal");
  assertIncludes(
    html,
    "ChannelMember + SlotOccupant",
    "route error session capabilities",
  );
  const playerNav = tagWithTestId(html, roleNavTestId("player"));
  assert.notEqual(playerNav, null, "route error player nav missing");
  assert.equal(
    playerNav.includes('aria-current="page"'),
    true,
    "route error player nav is not active",
  );
  const touchTargets = assertTouchTargetMetadata(html, "route-error");

  return {
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
    touchTargets,
    htmlBytes: Buffer.byteLength(html),
  };
}

async function proveFeedbackTraceMarkup(bundle) {
  const admin = await proveAdminFeedbackTrace(bundle);
  const player = await provePlayerFeedbackTrace(bundle);
  const moderator = await proveModeratorFeedbackTrace(bundle);

  return {
    boundary:
      "Build-mode Svelte SSR renders active admin, player, and moderator feedback rows with command trace attributes. This proves the rendered DOM carries trace metadata, not hydrated click-to-dispatch behavior.",
    admin,
    player,
    moderator,
  };
}

async function proveAdminFeedbackTrace(bundle) {
  const { html } = await bundle.renderAdminCommandActivity();
  return {
    component: "admin-command-activity",
    rowTestId: "admin-command-activity-recovery-gate",
    statusTestId: "admin-command-activity-status-recovery-gate",
    confirmationTrace: assertConfirmationTraceAttributes(html, {
      testId: "admin-command-activity-recovery-gate",
      surface: "admin-recovery",
      actionId: "recovery-gate",
      statusKey: "recovery-gate",
      dispatchKind: "check_recovery_gate",
    }),
    htmlBytes: Buffer.byteLength(html),
  };
}

async function provePlayerFeedbackTrace(bundle) {
  const { html } = await bundle.renderPlayerCommandReceipt();
  return {
    component: "player-command-receipt",
    rowTestId: "player-command-receipt-submit_vote",
    statusTestId: "player-command-status",
    commandTrace: assertCommandTraceAttributes(html, {
      testId: "player-command-receipt-submit_vote",
      surface: "player",
      actionId: "submit_vote",
      statusKey: "submit_vote",
      dispatchKind: "submit_vote",
      refreshKeys: "votecount,commandState",
    }),
    htmlBytes: Buffer.byteLength(html),
  };
}

async function proveModeratorFeedbackTrace(bundle) {
  const { html } = await bundle.renderModeratorCommandActivity();
  return {
    component: "host-command-activity",
    rowTestId: "host-command-activity-resolve_host_prompt-D01-skip_next_day-slot_1",
    statusTestId:
      "host-command-activity-status-resolve_host_prompt-D01-skip_next_day-slot_1",
    confirmationTrace: assertConfirmationTraceAttributes(html, {
      testId: "host-command-activity-resolve_host_prompt-D01-skip_next_day-slot_1",
      surface: "moderator-host",
      actionId: "resolve_host_prompt-D01-skip_next_day-slot_1",
      statusKey: "resolve_host_prompt-D01-skip_next_day-slot_1",
      dispatchKind: "resolve_host_prompt",
    }),
    htmlBytes: Buffer.byteLength(html),
  };
}

function surfaceScenarios() {
  return [
    {
      id: "board",
      role: "board",
      path: "/",
      render: "renderBoardSurface",
      surfaceTestId: "board-surface",
      requiredText: ["Games", "Mafiascum game"],
      requiredTestIds: [
        "game-action-midsummer-player",
        "game-action-midsummer-moderator",
      ],
      links: [
        {
          testId: "game-action-midsummer-player",
          href: "/g/midsummer",
        },
        {
          testId: "game-action-midsummer-moderator",
          href: "/moderation",
        },
      ],
      requiredAttributes: [],
      forbiddenText: [],
    },
    {
      id: "board-player-blocked-actions",
      role: "board",
      path: "/",
      render: "renderBoardPlayerSurface",
      surfaceTestId: "board-surface",
      requiredText: [
        "Games",
        "Mafiascum game",
        "Hosts only",
      ],
      requiredTestIds: [
        "game-action-midsummer-moderator",
      ],
      links: [
        {
          testId: "game-action-midsummer-player",
          href: "/g/midsummer",
        },
      ],
      requiredAttributes: [
        'data-blocked-reason="Requires GlobalAdmin(midsummer) or GlobalMod(midsummer) or HostOf(midsummer) or CohostOf(midsummer)"',
      ],
      forbiddenText: [],
    },
    {
      id: "admin",
      role: "admin",
      path: "/admin",
      render: "renderAdminSurface",
      surfaceTestId: "admin-surface",
      requiredText: ["Game setup", "Recovery"],
      requiredTestIds: [
        "admin-operator-inbox",
        "admin-operator-decision-canvas",
        "admin-command-activity",
        "admin-command-activity-empty",
        "admin-inbox-task-setup-session-grants",
        "admin-audit-link-proof-runs",
        "admin-recovery-trigger-recovery-gate",
      ],
      links: [
        {
          testId: "admin-audit-link-proof-runs",
          href: "/admin/audit/proof-runs?game=midsummer",
        },
      ],
      requiredAttributes: [
        'data-inbox-mode="exception-inbox-decision-canvas"',
        'data-selection-mode="url-addressable-roving-tablist"',
        'data-initial-canvas-count="1"',
        'role="tablist"',
        'role="tabpanel"',
        'data-component="admin-command-activity"',
      ],
      forbiddenText: [],
    },
    {
      id: "admin-audit-detail",
      role: "admin",
      path: "/admin/audit/proof-runs?game=midsummer",
      render: "renderAdminAuditDetailSurface",
      surfaceTestId: "admin-audit-detail-surface",
      requiredText: ["Proof runs", "Machine evidence"],
      requiredTestIds: [
        "admin-audit-detail-back",
        "admin-audit-detail-evidence",
      ],
      links: [
        {
          testId: "admin-audit-detail-back",
          href: "/admin?game=midsummer",
        },
        {
          testId: "admin-audit-detail-evidence",
          href: "/games/midsummer/operator/proof-runs",
        },
      ],
      requiredAttributes: [
        'data-testid="admin-audit-detail-status"',
        'data-state="ack"',
        'aria-live="polite"',
      ],
      forbiddenText: [],
    },
    {
      id: "player",
      role: "player",
      path: "/g/midsummer",
      render: "renderPlayerSurface",
      surfaceTestId: "player-surface",
      requiredText: ["Full votecount", "Private queue"],
      requiredTestIds: [
        "player-composer",
        PLAYER_COMMAND_PANEL_CONTRACT.channelContextTestId,
        PLAYER_THREAD_PAGER_CONTRACT.rootTestId,
        PLAYER_THREAD_PAGER_CONTRACT.buttonTestId,
        "player-game-bar-deadline",
        FIXTURE_THREAD_MEDIA_TEST_ID,
        "thread-post-media-boundary-442",
        "player-private-link-notification-1",
        "player-live-status",
      ],
      links: [
        {
          testId: "player-private-link-notification-1",
          href: "/g/midsummer?private=notification-1",
        },
      ],
      requiredAttributes: [
        'data-boundary-status="principal-scoped-private-projections"',
        'data-channel-id="main"',
        'data-capability-label="SlotOccupant or ChannelMember(main)"',
        `data-component="${PLAYER_THREAD_PAGER_CONTRACT.component}"`,
        'data-state="ready"',
        'data-component="player-thread-media"',
        'data-media-variant="tablet"',
      ],
      forbiddenText: ["host prompt", "host-only", "resolve_host_prompt"],
    },
    {
      id: "player-private-review",
      role: "player",
      path: "/g/midsummer?private=notification-1",
      render: "renderPlayerPrivateReviewRoute",
      surfaceTestId: "player-surface",
      requiredText: ["Private queue", "Phase N02"],
      requiredTestIds: [
        "player-private-review-notification-1",
        "player-private-link-notification-1",
        "player-private-detail-notification-1",
      ],
      links: [
        {
          testId: "player-private-link-notification-1",
          href: "/g/midsummer?private=notification-1",
        },
      ],
      requiredAttributes: [
        'aria-expanded="true"',
        'data-boundary-status="principal-scoped-private-projections"',
      ],
      forbiddenText: ["host prompt", "host-only", "resolve_host_prompt"],
    },
    {
      id: "player-private-channel",
      role: "player",
      path: "/g/midsummer/c/private%3Arole_pm%3Aslot-7",
      render: "renderPlayerPrivateChannelRoute",
      surfaceTestId: "player-surface",
      requiredText: ["Role PM", "Private queue"],
      requiredTestIds: [
        "player-channel-private:role_pm:slot-7",
        PLAYER_COMMAND_PANEL_CONTRACT.channelContextTestId,
        "player-private-link-notification-1",
        FIXTURE_THREAD_MEDIA_TEST_ID,
      ],
      links: [
        {
          testId: "player-channel-private:role_pm:slot-7",
          href: "/g/midsummer/c/private%3Arole_pm%3Aslot-7",
        },
        {
          testId: "player-private-link-notification-1",
          href: "/g/midsummer/c/private%3Arole_pm%3Aslot-7?private=notification-1",
        },
      ],
      requiredAttributes: [
        'aria-current="page"',
        'data-channel-id="private:role_pm:slot-7"',
        'data-capability-label="ChannelMember(private:role_pm:slot-7)"',
        'data-boundary-status="principal-scoped-private-projections"',
        'data-component="player-thread-media"',
        'data-media-variant="tablet"',
      ],
      forbiddenText: ["host prompt", "host-only", "resolve_host_prompt"],
    },
    {
      id: "moderator",
      role: "moderator",
      path: "/g/midsummer/host",
      render: "renderModeratorSurface",
      surfaceTestId: "host-console-surface",
      requiredText: ["Host queue", "Votecount"],
      requiredTestIds: [
        "host-console-bar",
        HOST_TASK_WORKSPACE_CONTRACT.queueTestId,
        HOST_TASK_WORKSPACE_CONTRACT.canvasTestId,
        "host-command-activity",
        "host-command-activity-empty",
        HOST_TASK_WORKSPACE_CONTRACT.commandContextTestId,
        "critical-host-action-extend_deadline",
        "critical-host-action-resolve_host_prompt-D01-skip_next_day-slot_1",
        "host-console-votecount",
      ],
      links: [],
      requiredAttributes: [
        'data-component="host-console-route"',
        'data-component="host-task-workspace"',
        'data-component="host-command-activity"',
        'data-game-id="midsummer"',
        'data-principal-user-id="host_h"',
        'data-capability-label="HostOf(midsummer)"',
        'data-command-endpoint="/commands"',
      ],
      forbiddenText: [],
    },
  ];
}

function assertAppShell(html, { id, role }) {
  assertIncludes(html, 'data-component="fm-app-shell"', `${id} app shell`);
  assertIncludes(html, `data-surface="${role}"`, `${id} shell surface`);
  assertIncludes(
    html,
    `data-testid="${APP_SHELL_CONTRACT.sessionTestId}"`,
    `${id} shell session capsule`,
  );
  assertIncludes(
    html,
    `data-testid="${APP_SHELL_CONTRACT.sessionPrincipalTestId}"`,
    `${id} shell session principal`,
  );
  assertIncludes(
    html,
    `data-testid="${APP_SHELL_CONTRACT.sessionCapabilityTestId}"`,
    `${id} shell session capabilities`,
  );
  assertIncludes(
    html,
    `data-testid="${APP_SHELL_CONTRACT.sessionGameTestId}"`,
    `${id} shell session game`,
  );
  for (const surface of APP_SHELL_CONTRACT.surfaceOrder) {
    assertIncludes(
      html,
      `data-testid="${roleNavTestId(surface)}"`,
      `${id} ${surface} nav`,
    );
  }
}

function assertTouchTargetMetadata(html, label) {
  const matches = [...html.matchAll(/data-min-touch-target-px="([^"]+)"/g)];
  assert.equal(matches.length > 0, true, `${label} touch target metadata missing`);
  const minValues = matches.map((match) => Number(match[1]));
  for (const value of minValues) {
    assert.equal(
      Number.isFinite(value) && value >= APP_SHELL_CONTRACT.minTouchTargetPx,
      true,
      `${label} touch target ${value} below floor`,
    );
  }
  return {
    count: matches.length,
    minPx: Math.min(...minValues),
  };
}

function assertLink(html, { testId, href }, label) {
  const tag = tagWithTestId(html, testId);
  assert.notEqual(tag, null, `${label} missing ${testId}`);
  assert.equal(
    tag.includes(`href="${href}"`),
    true,
    `${label} ${testId} missing href ${href}`,
  );
}

function tagWithTestId(html, testId) {
  const pattern = new RegExp(`<[^>]+data-testid="${escapeRegExp(testId)}"[^>]*>`, "u");
  return html.match(pattern)?.[0] ?? null;
}

function assertCommandTraceAttributes(html, expected) {
  const tag = tagWithTestId(html, expected.testId);
  assert.notEqual(tag, null, `${expected.testId} command trace row missing`);
  const trace = {
    kind: attributeValue(tag, "data-command-trace-kind"),
    surface: attributeValue(tag, "data-command-surface"),
    actionId: attributeValue(tag, "data-command-action-id"),
    statusKey: attributeValue(tag, "data-command-status-key"),
    dispatchKind: attributeValue(tag, "data-command-dispatch-kind"),
    refreshKeys: attributeValue(tag, "data-command-refresh-keys"),
  };
  assert.deepEqual(trace, {
    kind: "command-trace",
    surface: expected.surface,
    actionId: expected.actionId,
    statusKey: expected.statusKey,
    dispatchKind: expected.dispatchKind,
    refreshKeys: expected.refreshKeys,
  });
  return trace;
}

function assertConfirmationTraceAttributes(html, expected) {
  const tag = tagWithTestId(html, expected.testId);
  assert.notEqual(tag, null, `${expected.testId} confirmation trace row missing`);
  const trace = {
    kind: attributeValue(tag, "data-confirmation-trace-kind"),
    surface: attributeValue(tag, "data-confirmation-surface"),
    actionId: attributeValue(tag, "data-confirmation-action-id"),
    statusKey: attributeValue(tag, "data-confirmation-status-key"),
    dispatchKind: attributeValue(tag, "data-confirmation-dispatch-kind"),
  };
  assert.deepEqual(trace, {
    kind: "confirmation-command-trace",
    surface: expected.surface,
    actionId: expected.actionId,
    statusKey: expected.statusKey,
    dispatchKind: expected.dispatchKind,
  });
  return trace;
}

function attributeValue(tag, attribute) {
  return tag.match(new RegExp(`${escapeRegExp(attribute)}="([^"]*)"`, "u"))?.[1] ?? null;
}

function assertIncludes(haystack, needle, label) {
  assert.equal(haystack.includes(needle), true, `${label} missing ${needle}`);
}

function assertExcludesLower(haystack, needle, label) {
  assert.equal(
    haystack.toLowerCase().includes(needle),
    false,
    `${label} unexpectedly included ${needle}`,
  );
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function runRouteStateRenderContract() {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["tools/frontend_route_state_render_contract.mjs"], {
      cwd: repoRoot,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (code !== 0) {
    throw new Error(`frontend route-state render contract failed with exit ${code}`);
  }
}
