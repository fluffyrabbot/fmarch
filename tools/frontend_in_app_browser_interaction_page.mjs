import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  boardScenario,
  roles,
  viewports,
} from "./frontend_role_smoke_scenarios.mjs";
import { loadRenderCss } from "./frontend_render_css.mjs";
import { EXPECTED_COUNTS } from "./frontend_proof_expectations.mjs";
import { iabCommandScenarioDefs } from "./frontend_proof_scenarios.mjs";
import {
  APP_SHELL_CONTRACT,
  roleNavTestId,
} from "../frontend/src/lib/app/app-shell-model.mjs";
import {
  ADMIN_SURFACE_CONTRACT,
} from "../frontend/src/lib/components/admin/admin-surface-model.mjs";
import {
  HOST_TASK_WORKSPACE_CONTRACT,
} from "../frontend/src/lib/components/host-action/host-task-workspace.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = path.join(
  repoRoot,
  "target",
  "frontend-in-app-browser-interactions",
);
const pagePath = path.join(artifactDir, "interaction-page.html");
const manifestPath = path.join(artifactDir, "interaction-page-manifest.json");
const hydratedSurfacesPath = path.join(
  repoRoot,
  "target",
  "frontend-hydrated-surfaces",
  "hydrated-surfaces.json",
);
const routeStateBundle = path.join(
  repoRoot,
  "target",
  "frontend-route-state-render",
  "bundle",
  "entry.js",
);

await mkdir(artifactDir, { recursive: true });
await runRouteStateRenderContract();
await runHydratedSurfaceContract();

const bundle = await import(`${pathToFileURL(routeStateBundle).href}?t=${Date.now()}`);
const hydratedSurfaces = await readJson(hydratedSurfacesPath);
const css = await loadRenderCss({
  repoRoot,
  componentStyleFiles: [
    "frontend/src/lib/components/admin/AdminSetupGrid.svelte",
    "frontend/src/lib/components/admin/AdminRecoveryPanel.svelte",
  ],
});
const surfaces = await buildSurfaces(bundle);
const moderatorActionManifest = await bundle.renderModeratorCriticalActionManifest();
const scenarios = await buildCommandScenarios(bundle, moderatorActionManifest);
const hydratedSurfaceScenarios = buildHydratedSurfaceScenarios(hydratedSurfaces);
const stabilityChecks = buildStabilityChecks(moderatorActionManifest);
const manifest = {
  status: "page-generated",
  proof: "in-app-browser-file-interaction-page",
  boundary:
    `Generates a file-backed page from build-mode Svelte SSR first-viewport role surfaces, the real player private-channel error surface, command controls, player private-channel controls, all ${EXPECTED_COUNTS.moderatorCriticalActions} moderator critical host confirmations, and hydrated-surface scenario controls for manual/in-app-browser proof. The page can record native browser click delivery and focus landing for representative admin, player, player private-channel, route-error, and moderator critical host confirmation targets without opening localhost or launching a separate Playwright browser. It does not prove browser behavior unless the generated file is opened and exercised, and it does not prove Svelte hydration, Svelte event scheduling, command dispatch side effects, TCP/network transport, WebSocket delivery, or dev-server routing.`,
  page: path.relative(repoRoot, pagePath),
  pageUrl: pathToFileURL(pagePath).href,
  viewports,
  appShellContract: {
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
  },
  surfaces: surfaces.map(({ html, ...surface }) => ({
    ...proofMetadata(surface),
    htmlBytes: Buffer.byteLength(html),
  })),
  scenarios: scenarios.map(({ html, ...scenario }) => ({
    ...proofMetadata(scenario),
    htmlBytes: Buffer.byteLength(html),
  })),
  hydratedSurfaceScenarios,
  stabilityChecks,
};

await writeFile(pagePath, renderPage({
  css,
  surfaces,
  scenarios,
  hydratedSurfaceScenarios,
}));
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${path.relative(repoRoot, pagePath)}`);
console.log(`wrote ${path.relative(repoRoot, manifestPath)}`);

async function buildSurfaces(bundle) {
  const roleById = Object.fromEntries(roles.map((role) => [role.id, role]));
  return [
    {
      id: boardScenario.id,
      role: "board",
      path: boardScenario.path,
      render: "renderBoardPlayerSurface",
      surfaceTestId: boardScenario.surfaceTestId,
      requiredText: boardScenario.requiredText,
      requiredSelectors: [
        `[data-testid="${roleNavTestId("board")}"]`,
        `[data-testid="${roleNavTestId("player")}"]`,
      ],
      nav: boardScenario.nav,
      minTouchTargetPx: APP_SHELL_CONTRACT.minTouchTargetPx,
      ...(await renderedFragment(bundle.renderBoardPlayerSurface())),
    },
    {
      id: "admin",
      role: "admin",
      path: roleById.admin.path,
      render: "renderAdminSurface",
      surfaceTestId: roleById.admin.surfaceTestId,
      requiredText: roleById.admin.requiredText,
      requiredSelectors: [
        `[data-testid="${roleNavTestId("admin")}"]`,
        '[data-testid="admin-setup-create-game"]',
        '[data-testid="admin-audit-link-proof-runs"]',
      ],
      nav: roleById.admin.nav,
      minTouchTargetPx: APP_SHELL_CONTRACT.minTouchTargetPx,
      ...(await renderedFragment(bundle.renderAdminSurface())),
    },
    {
      id: "player",
      role: "player",
      path: roleById.player.path,
      render: "renderPlayerSurface",
      surfaceTestId: roleById.player.surfaceTestId,
      requiredText: roleById.player.requiredText,
      requiredSelectors: [
        `[data-testid="${roleNavTestId("player")}"]`,
        '[data-testid="player-channel-main"]',
        '[data-testid="player-private-link-notification-1"]',
      ],
      nav: roleById.player.nav,
      minTouchTargetPx: APP_SHELL_CONTRACT.minTouchTargetPx,
      ...(await renderedFragment(bundle.renderPlayerSurface())),
    },
    {
      id: "moderator",
      role: "moderator",
      path: roleById.moderator.path,
      render: "renderModeratorSurface",
      surfaceTestId: roleById.moderator.surfaceTestId,
      requiredText: roleById.moderator.requiredText,
      requiredSelectors: [
        `[data-testid="${roleNavTestId("moderator")}"]`,
        '[data-testid="moderator-control-engine-host-prompt-D01-skip_next_day-slot_1"]',
        '[data-testid="critical-host-action-resolve_host_prompt-D01-skip_next_day-slot_1"]',
        '[data-testid="critical-host-action-modkill_slot"]',
      ],
      nav: roleById.moderator.nav,
      minTouchTargetPx: APP_SHELL_CONTRACT.minTouchTargetPx,
      ...(await renderedFragment(bundle.renderModeratorSurface())),
    },
    {
      id: "route-error-player-private-channel",
      role: "player",
      path: "/g/midsummer/c/private%3Arole_pm%3Aslot-7",
      render: "renderRouteErrorSurface",
      surfaceTestId: "route-error-surface",
      requiredText: "Access blocked",
      requiredSelectors: [
        '[data-testid="route-error-surface"]',
        '[data-testid="route-error-panel"]',
        '[data-testid="route-error-action"]',
        `[data-testid="${roleNavTestId("player")}"]`,
      ],
      nav: {
        board: "link",
        player: "link",
        moderator: "blocked",
        admin: "blocked",
      },
      minTouchTargetPx: APP_SHELL_CONTRACT.minTouchTargetPx,
      ...(await renderedFragment(bundle.renderRouteErrorSurface())),
    },
  ];
}

async function buildCommandScenarios(bundle, moderatorActionManifest) {
  const named = await Promise.all(
    iabCommandScenarioDefs().map(async (def) => ({
      ...def,
      ...(await renderedFragment(bundle[def.render](...(def.renderArgs ?? [])))),
    })),
  );
  return [
    ...named,
    ...(await Promise.all(
      moderatorActionManifest.actions.map((action) =>
        moderatorCriticalConfirmationScenario(bundle, action),
      ),
    )),
  ];
}

function buildStabilityChecks(moderatorActionManifest) {
  return [
    {
      id: "admin-operator-action-status-floors",
      role: "admin",
      surfaceId: "admin",
      rootSelector: '[data-testid="iab-surface-admin"]',
      mode: ADMIN_SURFACE_CONTRACT.actionTileStabilityMode,
      statusFloorMinBlockSizePx:
        ADMIN_SURFACE_CONTRACT.commandStatusFloorMinBlockSizePx,
      tiles: [
        ...["create-game", "session-grants", "cohost"].map((id) => ({
          id: `admin-setup-${id}`,
          tileSelector: `[data-testid="admin-setup-${id}"]`,
          triggerSelector: `[data-testid="admin-command-trigger-${id}"]`,
          statusFloorSelector: `[data-testid="admin-command-status-floor-${id}"]`,
        })),
        {
          id: "admin-recovery-recovery-gate",
          tileSelector: '[data-testid="admin-recovery-recovery-gate"]',
          triggerSelector: '[data-testid="admin-recovery-trigger-recovery-gate"]',
          statusFloorSelector:
            '[data-testid="admin-recovery-status-floor-recovery-gate"]',
        },
      ],
    },
    {
      id: "moderator-primary-action-status-floors",
      role: "moderator",
      surfaceId: "moderator",
      rootSelector: '[data-testid="iab-surface-moderator"]',
      mode: HOST_TASK_WORKSPACE_CONTRACT.actionTileStabilityMode,
      statusFloorMinBlockSizePx:
        HOST_TASK_WORKSPACE_CONTRACT.statusFloorMinBlockSizePx,
      tiles: moderatorActionManifest.actions.map((action) => ({
        id: `moderator-${action.id}`,
        tileSelector: `[data-testid="critical-host-action-${action.id}"]`,
        triggerSelector: '[data-testid="critical-host-action-trigger"]',
        statusFloorSelector: `[data-testid="host-command-status-floor-${action.id}"]`,
      })),
    },
  ];
}

async function moderatorCriticalConfirmationScenario(bundle, action) {
  return {
    id: `moderator-${action.id}-confirm-click`,
    role: "moderator",
    render: "renderModeratorActionConfirmation",
    renderArgs: [action.id],
    targetSelector: '[data-testid="critical-host-action-confirm"]',
    targetTestId: "critical-host-action-confirm",
    expectedText: action.outcomeLabel,
    minTouchTargetPx: 44,
    confirmation: {
      actionId: action.id,
      payloadKind: action.payloadKind,
      objectLabel: action.objectLabel,
      outcomeLabel: action.outcomeLabel,
    },
    ...(await renderedFragment(bundle.renderModeratorActionConfirmation(action.id))),
  };
}

function buildHydratedSurfaceScenarios(evidence) {
  assertHydratedSurfaceEvidence(evidence);
  return [
    {
      id: "shared-shell-header-coverage",
      role: "shared",
      source: "hydratedSurfaces.sharedShell",
      boundary: evidence.sharedShell.boundary,
      surfaces: evidence.sharedShell.surfaces.map((surface) => ({
        id: surface.id,
        activeSurface: surface.activeSurface,
        headerTitle: surface.headerTitle,
        liveStatusTestId: surface.liveStatusTestId,
        linkedNavTestIds: surface.linkedNavTestIds,
      })),
    },
    {
      id: "admin-audit-native-flow",
      role: "admin",
      source: "hydratedSurfaces.admin",
      auditNavigation: evidence.admin.auditNavigation,
      command: commandScenarioSummary(evidence.admin.command),
      controls: [
        {
          testId: "iab-admin-audit-detail-link",
          kind: "link",
          href: evidence.admin.auditNavigation.listHref,
          expectedText: evidence.admin.auditNavigation.detailTitle,
        },
        {
          testId: "iab-admin-audit-evidence-link",
          kind: "link",
          href: evidence.admin.auditNavigation.evidenceHref,
          expectedText: "Machine evidence",
        },
        {
          testId: "iab-admin-command-ack",
          kind: "button",
          expectedText: evidence.admin.command.visible.message,
        },
      ],
    },
    {
      id: "admin-operational-forms",
      role: "admin",
      source: "hydratedSurfaces.admin",
      forms: evidence.admin.forms,
      controls: [
        {
          testId: "iab-admin-session-grant-ack",
          kind: "button",
          expectedText: evidence.admin.forms.sessionGrant.visible.message,
          exposureKey: evidence.admin.forms.sessionGrant.exposureKey,
        },
        {
          testId: "iab-admin-recovery-gate-ack",
          kind: "button",
          expectedText: evidence.admin.forms.recoveryGate.visible.message,
          exposureKey: evidence.admin.forms.recoveryGate.exposureKey,
        },
      ],
    },
    {
      id: "player-private-disclosure-vote-and-post",
      role: "player",
      source: "hydratedSurfaces.player",
      privateDisclosure: evidence.player.privateDisclosure,
      command: commandScenarioSummary(evidence.player.command),
      postCommand: commandScenarioSummary(evidence.player.postCommand),
      threadPager: evidence.player.threadPager,
      controls: [
        {
          testId: "iab-player-private-toggle",
          kind: "button",
          expectedExpandedBefore: evidence.player.privateDisclosure.before,
          expectedExpandedAfter: evidence.player.privateDisclosure.after,
        },
        {
          testId: "iab-player-private-review-link",
          kind: "link",
          href: evidence.player.privateDisclosure.reviewHref,
          expectedText: "Open private review",
        },
        {
          testId: "iab-player-command-ack",
          kind: "button",
          expectedText: evidence.player.command.visible.message,
        },
        {
          testId: "iab-player-post-command-ack",
          kind: "button",
          expectedText: evidence.player.postCommand.visible.message,
        },
        {
          testId: "iab-player-thread-pager-pending",
          kind: "button",
          expectedText: evidence.player.threadPager.pending.buttonLabel,
          expectedDisabled: true,
        },
        {
          testId: "iab-player-thread-pager-ack",
          kind: "button",
          expectedText: evidence.player.threadPager.ack.status.message,
          statusTargetTestId: "iab-player-thread-page-status",
          expectedStatusState: "ack",
        },
        {
          testId: "iab-player-thread-pager-reject",
          kind: "button",
          expectedText: evidence.player.threadPager.reject.status.message,
          statusTargetTestId: "iab-player-thread-page-status",
          expectedStatusState: "reject",
        },
      ],
    },
    {
      id: "moderator-host-prompt-confirmation",
      role: "moderator",
      source: "hydratedSurfaces.moderator",
      confirmation: evidence.moderator.confirmation,
      command: commandScenarioSummary(evidence.moderator.command),
      controls: [
        {
          testId: "iab-moderator-prompt-confirm",
          kind: "button",
          expectedText: "Confirm host prompt",
        },
        {
          testId: "iab-moderator-command-ack",
          kind: "button",
          expectedText: evidence.moderator.command.visible.message,
        },
      ],
    },
    {
      id: "moderator-slot-lifecycle-confirmation",
      role: "moderator",
      source: "hydratedSurfaces.moderator",
      slotLifecycleConfirmation: evidence.moderator.slotLifecycleConfirmation,
      slotLifecycleCommand: commandScenarioSummary(
        evidence.moderator.slotLifecycleCommand,
      ),
      controls: [
        {
          testId: "iab-moderator-slot-lifecycle-confirm",
          kind: "button",
          expectedText: "Confirm slot lifecycle",
        },
        {
          testId: "iab-moderator-slot-lifecycle-ack",
          kind: "button",
          expectedText: evidence.moderator.slotLifecycleCommand.visible.message,
        },
      ],
    },
  ];
}

function commandScenarioSummary(command) {
  return {
    actionId: command.actionId,
    commandKind: command.commandKind,
    exposureKey: command.exposureKey,
    visibleState: command.visible.state,
    visibleMessage: command.visible.message,
    visibleTestId: command.visible.testId,
    visibleStatusTestId: command.visible.statusTestId,
    refreshed: command.refreshed,
    remainingPromptActions: command.remainingPromptActions,
    projection: command.projection,
  };
}

function assertHydratedSurfaceEvidence(evidence) {
  if (evidence.status !== "passed") {
    throw new Error("hydrated surface evidence must be passed before generating IAB fixture");
  }
  for (const id of [
    "board",
    "admin",
    "admin-audit-detail",
    "player",
    "moderator",
  ]) {
    if (!evidence.sharedShell.surfaces.some((surface) => surface.id === id)) {
      throw new Error(`hydrated surface evidence missing shared shell ${id}`);
    }
  }
  if (evidence.admin.command.visible.state !== "ack") {
    throw new Error("hydrated admin evidence missing ACK command row");
  }
  if (evidence.admin.forms?.sessionGrant?.visible?.state !== "ack") {
    throw new Error("hydrated admin evidence missing session-grant ACK row");
  }
  if (evidence.admin.forms?.recoveryGate?.visible?.state !== "ack") {
    throw new Error("hydrated admin evidence missing recovery-gate ACK row");
  }
  if (evidence.player.privateDisclosure.hostOnlyCopyPresent !== false) {
    throw new Error("hydrated player evidence leaked host-only private copy");
  }
  if (evidence.player.command.visible.state !== "ack") {
    throw new Error("hydrated player evidence missing ACK command row");
  }
  if (evidence.player.postCommand.visible.state !== "ack") {
    throw new Error("hydrated player evidence missing ACK post command row");
  }
  if (evidence.moderator.command.remainingPromptActions !== 0) {
    throw new Error("hydrated moderator evidence did not remove prompt action");
  }
  if (evidence.moderator.slotLifecycleCommand.visible.state !== "ack") {
    throw new Error("hydrated moderator evidence missing slot lifecycle ACK row");
  }
  if (
    evidence.moderator.slotLifecycleCommand.projection.lifecycleLabel !==
    "Modkilled"
  ) {
    throw new Error("hydrated moderator evidence missing Modkilled projection");
  }
}

async function renderedFragment(renderedPromise) {
  const rendered = await renderedPromise;
  return {
    html: rendered.html,
    head: rendered.head ?? "",
  };
}

function proofMetadata({ html: _html, head: _head, ...metadata }) {
  return metadata;
}

function renderedHeadStyles({ surfaces, scenarios }) {
  return [
    ...new Set(
      [...surfaces, ...scenarios]
        .map((item) => item.head)
        .filter((head) => typeof head === "string" && head.trim() !== ""),
    ),
  ].join("\n");
}

function renderPage({ css, surfaces, scenarios, hydratedSurfaceScenarios }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>fmarch in-app browser interaction proof</title>
    ${renderedHeadStyles({ surfaces, scenarios })}
    <style>
      ${css}
      *,
      *::before,
      *::after {
        box-sizing: border-box;
      }
      html {
        overflow-x: hidden;
      }
      body {
        background: #f4f1ea;
        color: #17212b;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        margin: 0;
        overflow-x: hidden;
      }
      .proof-page {
        display: grid;
        gap: 24px;
        margin: 0 auto;
        max-width: 1180px;
        padding: 24px;
        width: 100%;
      }
      .proof-page > header {
        border-block-end: 1px solid #b7c1bd;
        display: grid;
        gap: 4px;
        padding-block-end: 12px;
      }
      .proof-page h1 {
        font-size: 22px;
        line-height: 1.2;
        margin: 0;
      }
      .proof-page header p {
        color: #4e5c59;
        margin: 0;
      }
      .proof-section {
        display: grid;
        gap: 12px;
        min-width: 0;
      }
      .proof-section > h2 {
        font-size: 16px;
        line-height: 1.25;
        margin: 0;
      }
      .proof-surface {
        display: grid;
        min-width: 0;
        max-width: 100%;
        overflow-x: auto;
      }
      .proof-meta {
        color: #4e5c59;
        font-size: 13px;
        margin: 0;
      }
      .proof-controls {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .proof-controls a,
      .proof-controls button {
        min-height: 44px;
      }
    </style>
  </head>
  <body>
    <main class="proof-page" data-testid="iab-proof-page">
      <header>
        <h1>fmarch in-app browser interaction proof</h1>
        <p>File-backed SSR role surfaces and controls for native click, focus, and touch target proof.</p>
      </header>
      <section class="proof-section" data-testid="iab-proof-surfaces">
        <h2>Role surfaces</h2>
        <p class="proof-meta">First-viewport app shells generated from the same SSR bundle as the role proof.</p>
        ${surfaces.map(renderSurface).join("\n")}
      </section>
      <section class="proof-section" data-testid="iab-proof-commands">
        <h2>Command controls</h2>
        <p class="proof-meta">Click controls in this section to populate <code>window.__fmarchIabProof.clicks</code>.</p>
      ${scenarios.map(renderScenario).join("\n")}
      </section>
      <section class="proof-section" data-testid="iab-proof-hydrated-scenarios">
        <h2>Hydrated surface scenarios</h2>
        <p class="proof-meta">Prepared controls and links that mirror the no-localhost hydrated-surface contract.</p>
      ${hydratedSurfaceScenarios.map(renderHydratedSurfaceScenario).join("\n")}
      </section>
    </main>
    <script>
      window.__fmarchIabProof = {
        status: "ready",
        clicks: [],
        surfaces: ${JSON.stringify(surfaces.map(proofMetadata))},
        scenarios: ${JSON.stringify(scenarios.map(proofMetadata))},
        hydratedSurfaceScenarios: ${JSON.stringify(hydratedSurfaceScenarios)},
        stabilityChecks: ${JSON.stringify(stabilityChecks)},
      };
      window.__fmarchHydratedSurfaceScenarios = window.__fmarchIabProof.hydratedSurfaceScenarios;
      document.addEventListener("click", (event) => {
        const root = event.target.closest("[data-iab-scenario-id], [data-iab-hydrated-scenario-id]");
        const control = event.target.closest("[data-testid], [data-action]");
        if (!root || !control) {
          return;
        }
        const tagName = control.tagName.toLowerCase();
        const type = control.getAttribute("type") || "";
        if (
          tagName === "a" ||
          (tagName === "button" && type.toLowerCase() === "submit")
        ) {
          event.preventDefault();
        }
        if (control.getAttribute("data-testid") === "iab-player-private-toggle") {
          const detail = root.querySelector('[data-testid="iab-player-private-detail"]');
          control.setAttribute("aria-expanded", "true");
          if (detail) {
            detail.hidden = false;
          }
        }
        if (control.hasAttribute("data-thread-page-status")) {
          const status = root.querySelector('[data-testid="iab-player-thread-page-status"]');
          if (status) {
            status.textContent = control.textContent || "";
            status.setAttribute("data-state", control.getAttribute("data-thread-page-status"));
          }
        }
        const box = control.getBoundingClientRect();
        window.__fmarchIabProof.clicks.push({
          scenarioId: root.getAttribute("data-iab-scenario-id") || root.getAttribute("data-iab-hydrated-scenario-id"),
          role: root.getAttribute("data-iab-role"),
          tagName: control.tagName.toLowerCase(),
          testId: control.getAttribute("data-testid"),
          action: control.getAttribute("data-action"),
          text: (control.textContent || "").trim().replace(/\\s+/g, " "),
          box: {
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
          },
        });
      }, true);
    </script>
  </body>
</html>
`;
}

function renderSurface(surface) {
  return `<article
  class="proof-section"
  data-testid="iab-surface-${surface.id}"
  data-iab-role="${surface.role}"
  data-iab-surface-id="${surface.id}"
>
  <h2>${surface.role}</h2>
  <div class="proof-surface">
    ${surface.html}
  </div>
</article>`;
}

function renderScenario(scenario) {
  return `<section
  class="proof-section"
  data-testid="iab-proof-${scenario.role}"
  data-iab-role="${scenario.role}"
  data-iab-scenario-id="${scenario.id}"
>
  <h2>${scenario.role}</h2>
  <div class="proof-surface">
    ${scenario.html}
  </div>
</section>`;
}

function renderHydratedSurfaceScenario(scenario) {
  if (scenario.id === "shared-shell-header-coverage") {
    return `<section
  class="proof-section"
  data-testid="iab-hydrated-${scenario.id}"
  data-iab-role="${scenario.role}"
  data-iab-hydrated-scenario-id="${scenario.id}"
>
  <h2>shared shell headers</h2>
  <ul>
    ${scenario.surfaces.map((surface) => `<li data-testid="iab-shared-shell-${escapeAttr(surface.id)}">${escapeHtml(surface.headerTitle)}</li>`).join("\n")}
  </ul>
</section>`;
  }
  if (scenario.id === "admin-audit-native-flow") {
    return `<section
  class="proof-section"
  data-testid="iab-hydrated-${scenario.id}"
  data-iab-role="${scenario.role}"
  data-iab-hydrated-scenario-id="${scenario.id}"
>
  <h2>admin audit navigation</h2>
  <div class="proof-controls">
    <a data-testid="iab-admin-audit-detail-link" href="${escapeAttr(scenario.auditNavigation.listHref)}">${escapeHtml(scenario.auditNavigation.detailTitle)}</a>
    <a data-testid="iab-admin-audit-evidence-link" href="${escapeAttr(scenario.auditNavigation.evidenceHref)}">Machine evidence</a>
    <a data-testid="iab-admin-audit-overview-link" href="${escapeAttr(scenario.auditNavigation.overviewHref)}">Overview</a>
    <button data-testid="iab-admin-command-ack" type="button">${escapeHtml(scenario.command.visibleMessage)}</button>
  </div>
</section>`;
  }
  if (scenario.id === "admin-operational-forms") {
    return `<section
  class="proof-section"
  data-testid="iab-hydrated-${scenario.id}"
  data-iab-role="${scenario.role}"
  data-iab-hydrated-scenario-id="${scenario.id}"
>
  <h2>admin operational forms</h2>
  <div class="proof-controls">
    <button data-testid="iab-admin-session-grant-ack" type="button">${escapeHtml(scenario.forms.sessionGrant.visible.message)}</button>
    <button data-testid="iab-admin-recovery-gate-ack" type="button">${escapeHtml(scenario.forms.recoveryGate.visible.message)}</button>
  </div>
</section>`;
  }
  if (scenario.id === "player-private-disclosure-vote-and-post") {
    return `<section
  class="proof-section"
  data-testid="iab-hydrated-${scenario.id}"
  data-iab-role="${scenario.role}"
  data-iab-hydrated-scenario-id="${scenario.id}"
>
  <h2>player private disclosure, vote, and post</h2>
  <div class="proof-controls">
    <button data-testid="iab-player-private-toggle" type="button" aria-expanded="${escapeAttr(scenario.privateDisclosure.before)}">Private item ${escapeHtml(scenario.privateDisclosure.itemId)}</button>
    <a data-testid="iab-player-private-review-link" href="${escapeAttr(scenario.privateDisclosure.reviewHref)}">Open private review</a>
    <button data-testid="iab-player-command-ack" type="button">${escapeHtml(scenario.command.visibleMessage)}</button>
    <button data-testid="iab-player-post-command-ack" type="button">${escapeHtml(scenario.postCommand.visibleMessage)}</button>
    <button data-testid="iab-player-thread-pager-pending" type="button" disabled aria-disabled="true" aria-busy="${escapeAttr(scenario.threadPager.pending.busy)}" data-thread-pager-state="${escapeAttr(scenario.threadPager.pending.rootState)}" data-min-touch-target-px="${escapeAttr(String(scenario.threadPager.pending.minTouchTargetPx))}">${escapeHtml(scenario.threadPager.pending.buttonLabel)}</button>
    <button data-testid="iab-player-thread-pager-ack" type="button" data-thread-page-status="${escapeAttr(scenario.threadPager.ack.status.state)}" data-thread-pager-state="${escapeAttr(scenario.threadPager.ack.rootState)}" data-min-touch-target-px="${escapeAttr(String(scenario.threadPager.pending.minTouchTargetPx))}">${escapeHtml(scenario.threadPager.ack.status.message)}</button>
    <button data-testid="iab-player-thread-pager-reject" type="button" data-thread-page-status="${escapeAttr(scenario.threadPager.reject.status.state)}" data-thread-pager-state="${escapeAttr(scenario.threadPager.reject.rootState)}" data-min-touch-target-px="${escapeAttr(String(scenario.threadPager.pending.minTouchTargetPx))}">${escapeHtml(scenario.threadPager.reject.status.message)}</button>
  </div>
  <p data-testid="iab-player-private-detail" hidden>Private disclosure expanded without host-only copy.</p>
  <p data-testid="iab-player-thread-page-ack-status" role="status" aria-live="polite" data-state="${escapeAttr(scenario.threadPager.ack.status.state)}">${escapeHtml(scenario.threadPager.ack.status.message)}</p>
  <p data-testid="iab-player-thread-page-reject-status" role="status" aria-live="polite" data-state="${escapeAttr(scenario.threadPager.reject.status.state)}">${escapeHtml(scenario.threadPager.reject.status.message)}</p>
  <p data-testid="iab-player-thread-page-status" role="status" aria-live="polite" data-state="${escapeAttr(scenario.threadPager.pending.status.state)}">${escapeHtml(scenario.threadPager.pending.status.message)}</p>
</section>`;
  }
  if (scenario.id === "moderator-host-prompt-confirmation") {
    return `<section
  class="proof-section"
  data-testid="iab-hydrated-${scenario.id}"
  data-iab-role="${scenario.role}"
  data-iab-hydrated-scenario-id="${scenario.id}"
>
  <h2>moderator host prompt</h2>
  <div class="proof-controls">
    <button data-testid="iab-moderator-prompt-confirm" type="button">Confirm host prompt</button>
    <button data-testid="iab-moderator-command-ack" type="button">${escapeHtml(scenario.command.visibleMessage)}</button>
  </div>
</section>`;
  }
  if (scenario.id === "moderator-slot-lifecycle-confirmation") {
    return `<section
  class="proof-section"
  data-testid="iab-hydrated-${scenario.id}"
  data-iab-role="${scenario.role}"
  data-iab-hydrated-scenario-id="${scenario.id}"
>
  <h2>moderator slot lifecycle</h2>
  <div class="proof-controls">
    <button data-testid="iab-moderator-slot-lifecycle-confirm" type="button">Confirm slot lifecycle</button>
    <button data-testid="iab-moderator-slot-lifecycle-ack" type="button">${escapeHtml(scenario.slotLifecycleCommand.visibleMessage)}</button>
  </div>
</section>`;
  }
  throw new Error(`unknown hydrated surface scenario ${scenario.id}`);
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

async function runHydratedSurfaceContract() {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["tools/frontend_hydrated_surface_contract.mjs"], {
      cwd: repoRoot,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (code !== 0) {
    throw new Error(`frontend hydrated surface contract failed with exit ${code}`);
  }
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('"', "&quot;");
}
