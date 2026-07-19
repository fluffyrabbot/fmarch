import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXPECTED_COUNTS,
  expectedThumbZoneCounts,
} from "./frontend_proof_expectations.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = path.join(repoRoot, "target", "frontend-completion-audit");
const evidencePath = path.join(artifactDir, "completion-audit.json");

const artifacts = {
  staticContract: await readArtifact("target/frontend-static-role-contract/role-contract.json"),
  routeStateRender: await readArtifact("target/frontend-route-state-render/route-state-render.json"),
  dispatchBridge: await readArtifact("target/frontend-dispatch-bridge/dispatch-bridge.json"),
  hydratedHandlers: await readArtifact("target/frontend-hydrated-handlers/hydrated-handlers.json"),
  hydratedSurfaces: await readArtifact("target/frontend-hydrated-surfaces/hydrated-surfaces.json"),
  componentInteractions: await readArtifact("target/frontend-component-interactions/component-interactions.json"),
  noBindInteractions: await readArtifact("target/frontend-no-bind-interactions/no-bind-interactions.json"),
  staticFocusability: await readArtifact("target/frontend-static-focusability/focusability.json"),
  tabletInteraction: await readArtifact(
    "target/frontend-tablet-interaction/tablet-interaction.json",
  ),
  routeLive: await readArtifact(
    "target/frontend-route-live-contract/route-live-contract.json",
  ),
  hostConfirmations: await readArtifact(
    "target/frontend-host-confirmation-static-dom/static-dom.json",
  ),
  keyboardTraversal: await readArtifact("target/frontend-keyboard-traversal/keyboard-traversal.json"),
  domSmoke: await readArtifact("target/frontend-role-dom-smoke/dom-smoke.json"),
  renderSmoke: await readArtifact("target/frontend-role-render-smoke/render-smoke.json"),
  roleSmoke: await readArtifact("target/frontend-role-smoke/role-smoke.json"),
  inAppBrowserPage: await readArtifact(
    "target/frontend-in-app-browser-interactions/interaction-page-manifest.json",
  ),
  inAppBrowserStaticDom: await readArtifact(
    "target/frontend-in-app-browser-static-dom/static-dom.json",
  ),
  inAppBrowserRun: await readArtifact(
    "target/frontend-in-app-browser-interactions/browser-run.json",
  ),
  inAppBrowserLocalhostRun: await readArtifact(
    "target/frontend-in-app-browser-localhost/browser-run.json",
  ),
  inAppBrowserImportedRun: await readArtifact(
    "target/frontend-in-app-browser-imported-run/imported-run.json",
  ),
  importedRoleSmoke: await readArtifact(
    "target/frontend-role-smoke-imported/imported-role-smoke.json",
  ),
  browserAcceptanceBoundary: await readArtifact(
    "target/frontend-browser-acceptance-boundary/browser-acceptance-boundary.json",
  ),
};

assert.equal(artifacts.staticContract.status, "passed");
assert.equal(artifacts.routeStateRender.status, "passed");
assert.equal(artifacts.dispatchBridge.status, "passed");
assert.equal(artifacts.hydratedHandlers.status, "passed");
assert.equal(artifacts.hydratedSurfaces.status, "passed");
assert.equal(artifacts.hydratedSurfaces.proof, "frontend-hydrated-surface-contract");
assert.equal(artifacts.componentInteractions.status, "passed");
assert.equal(
  ["passed", "chromium-launch-blocked"].includes(artifacts.noBindInteractions.status),
  true,
);
assert.equal(artifacts.staticFocusability.status, "passed");
assert.equal(artifacts.tabletInteraction.status, "passed");
assert.equal(
  artifacts.tabletInteraction.proof,
  "frontend-tablet-interaction-contract",
);
assert.equal(artifacts.tabletInteraction.forbiddenMatches.length, 0);
assert.equal(artifacts.tabletInteraction.sharedAppCss.appShellTouchTargetMinPx, 44);
assert.equal(
  artifacts.tabletInteraction.adminOperatorSurfaceCss.controlRailMode,
  "flow-admin-operator-actions",
);
assert.equal(
  artifacts.tabletInteraction.adminOperatorSurfaceCss.setupAndRecoveryBeforeStatusReadouts,
  true,
);
assert.equal(
  artifacts.tabletInteraction.adminOperatorSurfaceCss.actionTileStabilityMode,
  "reserved-status-floor",
);
assert.equal(
  artifacts.tabletInteraction.adminOperatorSurfaceCss.primaryActionBeforeStatusFloor,
  true,
);
assert.equal(
  artifacts.tabletInteraction.playerRouteLayoutCss.commandRailMode,
  "sticky-tablet-command-column",
);
assert.equal(artifacts.tabletInteraction.playerRouteLayoutCss.safeAreaAware, true);
assert.equal(
  artifacts.tabletInteraction.playerRouteLayoutCss.primaryControlsBeforeReceipts,
  true,
);
assert.equal(
  artifacts.tabletInteraction.moderatorControlSurfaceCss.controlRailMode,
  "flow-host-control-actions",
);
assert.equal(
  artifacts.tabletInteraction.moderatorControlSurfaceCss.primaryControlsBeforeStatusReadouts,
  true,
);
assert.equal(
  artifacts.tabletInteraction.moderatorControlSurfaceCss.actionTileStabilityMode,
  "reserved-status-floor",
);
assert.equal(
  artifacts.tabletInteraction.moderatorControlSurfaceCss.primaryActionBeforeStatusFloor,
  true,
);
assert.equal(artifacts.tabletInteraction.hostTouchCss.touchTargetMinPx, 44);
assert.equal(artifacts.tabletInteraction.thumbZones.admin.zones.length, 2);
assert.equal(artifacts.tabletInteraction.thumbZones.player.zones.length, 1);
assert.equal(
  artifacts.tabletInteraction.thumbZones.moderator.zones[0].descendantCount,
  11,
);
assert.equal(artifacts.routeLive.status, "passed");
assert.equal(artifacts.routeLive.proof, "frontend-route-live-contract");
assert.equal(artifacts.hostConfirmations.status, "passed");
assert.equal(artifacts.hostConfirmations.proof, "host-confirmation-static-dom-contract");
assert.equal(artifacts.hostConfirmations.actionCount, EXPECTED_COUNTS.moderatorCriticalActions);
assert.equal(artifacts.routeLive.sources.player.onMountConnects, true);
assert.equal(artifacts.routeLive.sources.moderator.onMountConnects, true);
assert.deepEqual(artifacts.routeLive.runtime.player.eventKinds, [
  "open",
  "hello",
  "delta",
  "resync-required",
]);
assert.deepEqual(artifacts.routeLive.runtime.moderator.eventKinds, [
  "open",
  "hello",
  "delta",
  "resync-required",
]);
assert.equal(
  ["passed", "chromium-launch-blocked"].includes(artifacts.keyboardTraversal.status),
  true,
);
assert.equal(artifacts.domSmoke.status, "passed");
assertRouteErrorSurface(artifacts.routeStateRender.errorSurface, {
  artifact: "routeStateRender.errorSurface",
  includesTouchTargets: false,
});
assertRouteErrorSurface(artifacts.domSmoke.errorSurface, {
  artifact: "domSmoke.errorSurface",
  includesTouchTargets: true,
});
assert.equal(
  [
    "passed",
    "static-dom-fallback-passed",
    "static-fallback-passed",
    "static-render-fallback-passed",
  ].includes(artifacts.roleSmoke.status),
  true,
);
assert.equal(artifacts.inAppBrowserPage.status, "page-generated");
assert.equal(iabFixtureEvidenceComplete(), true);
assert.equal(artifacts.inAppBrowserStaticDom.status, "passed");
assert.equal(iabStaticDomEvidenceComplete(), true);
assert.equal(
  [
    "passed",
    "chromium-launch-blocked",
    "file-navigation-blocked",
  ].includes(artifacts.inAppBrowserRun.status),
  true,
);
assert.equal(
  [
    "passed",
    "localhost-bind-blocked",
    "chromium-launch-blocked",
    "localhost-navigation-blocked",
  ].includes(artifacts.inAppBrowserLocalhostRun.status),
  true,
);
assert.equal(
  ["imported-passed", "source-blocked"].includes(
    artifacts.inAppBrowserImportedRun.status,
  ),
  true,
);
assert.equal(
  ["imported-passed", "source-blocked"].includes(
    artifacts.importedRoleSmoke.status,
  ),
  true,
);
assert.equal(["passed", "incomplete"].includes(artifacts.browserAcceptanceBoundary.status), true);
assert.equal(
  artifacts.browserAcceptanceBoundary.proof,
  "frontend-browser-acceptance-boundary",
);
const fullBrowserProof =
  browserRoleSmokeEvidenceComplete() || importedRoleSmokeEvidenceComplete();
const hostSetupWorkbenchProof =
  roleSmokeSetupWorkbenchEvidenceComplete() ||
  importedRoleSmokeSetupWorkbenchEvidenceComplete();
assert.equal(
  artifacts.browserAcceptanceBoundary.status,
  fullBrowserProof ? "passed" : "incomplete",
);

const commandPaths = Object.fromEntries(
  artifacts.staticContract.commandPaths.map((entry) => [entry.role, entry]),
);
const domSurfaceIds = new Set(artifacts.domSmoke.surfaces.map((surface) => surface.id));
const routeStateIds = new Set(
  artifacts.routeStateRender.scenarios.map((scenario) => scenario.id),
);
assert.equal(artifacts.routeStateRender.singleRootShell.status, "passed");
assert.equal(artifacts.routeStateRender.singleRootShell.proof, "single-root-app-shell");
assert.deepEqual(
  artifacts.routeStateRender.singleRootShell.surfaces.map((surface) => [
    surface.id,
    surface.shellComponentCount,
  ]),
  [
    ["board-player", 1],
    ["admin", 1],
    ["player", 1],
    ["moderator", 1],
  ],
);
assert.equal(
  artifacts.routeStateRender.singleRootShell.routeStates.every(
    (surface) => surface.shellComponentCount === 1,
  ),
  true,
);

for (const id of [
  "board",
  "admin",
  "admin-audit-detail",
  "player",
  "player-private-review",
  "moderator",
]) {
  assert.equal(domSurfaceIds.has(id), true, `DOM smoke missing ${id}`);
}

for (const role of ["admin", "player", "moderator"]) {
  assert.equal(commandPaths[role] !== undefined, true, `missing ${role} command path`);
}

for (const state of ["empty", "loading", "reject"]) {
  for (const role of ["admin", "player", "moderator"]) {
    assert.equal(
      routeStateIds.has(`${role}-${state}`),
      true,
      `missing route-state scenario ${role}-${state}`,
    );
  }
}

const audit = {
  status: fullBrowserProof ? "passed" : "incomplete",
  proof: "frontend-completion-audit",
  generatedFrom: {
    staticContract: "target/frontend-static-role-contract/role-contract.json",
    routeStateRender: "target/frontend-route-state-render/route-state-render.json",
    dispatchBridge: "target/frontend-dispatch-bridge/dispatch-bridge.json",
    hydratedHandlers: "target/frontend-hydrated-handlers/hydrated-handlers.json",
    hydratedSurfaces: "target/frontend-hydrated-surfaces/hydrated-surfaces.json",
    componentInteractions: "target/frontend-component-interactions/component-interactions.json",
    noBindInteractions:
      "target/frontend-no-bind-interactions/no-bind-interactions.json",
    staticFocusability:
      "target/frontend-static-focusability/focusability.json",
    tabletInteraction:
      "target/frontend-tablet-interaction/tablet-interaction.json",
    routeLive:
      "target/frontend-route-live-contract/route-live-contract.json",
    hostConfirmations:
      "target/frontend-host-confirmation-static-dom/static-dom.json",
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
  },
  boundary:
    "This audit summarizes current frontend proof artifacts against the requested tablet-first admin/player/moderator SPA objective. It records what is proven by model, SSR, and no-browser DOM evidence, and keeps browser/runtime acceptance incomplete when localhost or Chromium is blocked.",
  overall: {
    state: fullBrowserProof ? "complete" : "not_complete",
    reason: fullBrowserProof
      ? "Core route models, SSR markup, DOM contracts, command envelopes, tablet posture, forbidden access, overlap-checked browser screenshots, and full admin/player/moderator dev-server role smoke are proven."
      : "Core route models, SSR markup, DOM contracts, command envelopes, and fallback artifacts are proven, but full hydrated browser acceptance remains blocked in this sandbox.",
  },
  requirements: [
    requirement({
      id: "shared-app-shell",
      label: "Shared capability-gated app shell",
      state: fullBrowserProof ? "browser_proven" : "dom_proven_browser_blocked",
      proven: [
        "Board/admin/player/moderator nav order and 44px touch metadata are model-owned.",
        "Board/admin/admin-audit/player/moderator first-viewport headers render from the shared surface header contract with model-owned capability touch metadata and live-status slots where applicable.",
        "No-localhost hydrated-surface adapter proof exercises real route data for board, admin, admin audit detail, player, and moderator headers plus shell keyboard metadata.",
        "Board, admin, player, moderator, and route-state pages render through the shared app shell in SSR DOM proof.",
        "Static first-viewport layout contract proves admin/player/moderator scan strips share responsive 4/2/1 CSS columns, stable four-tile models, fixed minimum tile height, min-inline-size:0, and overflow-wrap guardrails.",
        `Tablet interaction source contract scans ${tabletInteractionSourceSummary()} for ${tabletInteractionForbiddenSummary()} and verifies shared focus-visible, touch-action, 44px touch target, wrapping, and 4/2/1 scan-strip CSS guardrails.`,
        "Denied surfaces remain visible and inert in static model coverage.",
        "Static SSR focusability proof verifies modeled shell focus targets own enabled focusable elements and forbidden ids remain inert.",
        "File-backed in-app browser fixture includes first-viewport board/admin/player/moderator shells with shared shell nav and 44px touch metadata plus shared-header hydrated scenario controls for manual browser proof.",
        "No-browser static DOM proof verifies the generated file-backed fixture owns every command target inside its scenario root before browser execution.",
        ...noBindKeyboardProof(
          "real no-localhost Chromium Tab traversal and visible focus outlines for shared shell surfaces",
        ),
        ...fullBrowserProofLines(
          "Dev-server role smoke proves board/admin/player/moderator shell screenshots, route-state screenshots, forbidden-route screenshots, overlap-checked targets, focus traversal, and screenshot pixel evidence across tablet and desktop viewports.",
        ),
      ],
      evidence: [
        "staticContract.appShellContract",
        "staticContract.surfaceHeaderContract",
        "staticContract.surfaceHeaderCoverage",
        "staticContract.firstViewportLayoutContract",
        "tabletInteraction",
        "staticContract.roles[*].surfaceHeader",
        "hydratedSurfaces.sharedShell.surfaces",
        "staticContract.navFocusCoverage",
        "staticFocusability.surfaces",
        "keyboardTraversal.surfaces",
        "routeStateRender.appShellContract",
        "domSmoke.surfaces[board/admin/player/moderator]",
        "inAppBrowserPage.surfaces[board/admin/player/moderator]",
        "inAppBrowserStaticDom.scenarios",
      ],
      missing: fullBrowserProof
        ? []
        : [
            ...noBindKeyboardMissing(),
            "Pointer behavior, overlap proof, and dev-server browser focus traversal remain blocked when localhost or Chromium is denied.",
          ],
    }),
    requirement({
      id: "tablet-native-interaction-posture",
      label: "Tablet-native interaction posture",
      state: fullBrowserProof
        ? "browser_proven"
        : "source_css_ssr_proven_browser_blocked",
      proven: [
        `The tablet interaction contract scanned ${tabletInteractionSourceSummary()} and found no ${tabletInteractionForbiddenSummary()}.`,
        "Shared app CSS proves edge-to-edge safe-area shell padding, a sticky safe-area role/session topbar, controlled overscroll, visible focus outlines, skip-link focus reveal, 44px app-shell/touch-button floors, touch-action: manipulation, wrapping touch rows, overflow-wrap guardrails, and 4/2/1 scan-strip columns.",
        "Admin route CSS proves a safe-area-aware sticky operator action rail offset below the shared app topbar, keeping setup and recovery controls together before command activity, audit, and escalation readouts.",
        "Player route CSS proves a safe-area-aware sticky tablet command column for the vote/post thumb zone, offset below the shared app topbar with primary controls rendered before live command receipts, internal scroll containment, and a normal-flow fallback below 840px.",
        "Moderator route CSS proves a safe-area-aware sticky host control rail for the primary moderator action zone, offset below the shared app topbar with internal scroll containment, narrow fallback, and route order before status readouts.",
        "Host touch-control CSS proves the 44px target variable, 8px minimum gaps, touch-action: manipulation, visible focus outline, and wrapping confirmation actions used by moderator/admin-style destructive confirmations.",
        `Build-mode SSR proves admin setup/recovery, player vote/post, and all ${EXPECTED_COUNTS.moderatorCriticalActions} moderator critical host actions are descendants of explicit thumb-zone containers.`,
        ...fullBrowserProofLines(
          "Dev-server role smoke proves touch target geometry, thumb-zone target counts, setup workbench geometry for /g/midsummer/setup, overlap-checked visible targets, nonblank screenshots, and focus traversal across mobile, tablet, 1024, 1180, 1280, and desktop viewports.",
        ),
      ],
      evidence: [
        "tabletInteraction.forbiddenMatches",
        "tabletInteraction.sharedAppCss",
        "tabletInteraction.adminOperatorSurfaceCss",
        "tabletInteraction.playerRouteLayoutCss",
        "tabletInteraction.moderatorControlSurfaceCss",
        "tabletInteraction.hostTouchCss",
        "tabletInteraction.thumbZones",
      ],
      missing: fullBrowserProof
        ? []
        : [
            "Real Chromium proof is still required for physical thumb reach, pointer delivery, pixel overlap, visible focus rings, and actual Tab traversal.",
          ],
    }),
    requirement({
      id: "single-root-shell-architecture",
      label: "Single root-owned app shell architecture",
      state: "ssr_and_source_proven",
      proven: [
        "The root layout is the only first-class app-route AppShell owner.",
        "Board, admin overview, admin audit detail, player, player channel, and moderator page components are surface-only and their loaders opt into shellOwner: layout.",
        "Build-mode Svelte SSR proves board/admin/player/moderator first-view routes and every forced route-state page render exactly one AppShell through the root layout.",
      ],
      evidence: [
        "routeStateRender.singleRootShell",
        "routeStateRender.shellNavCoverage.surfaces[*].shellComponentCount",
        "routeStateRender.shellNavCoverage.routeStates[*].shellComponentCount",
        "frontend/src/routes/root-shell-contract.test.mjs",
      ],
      missing: [],
    }),
    requirement({
      id: "host-setup-workbench",
      label: "Host setup workbench geometry",
      state: hostSetupWorkbenchProof ? "browser_proven" : "browser_geometry_missing",
      proven: [
        "The setup workbench proof is scoped to /g/midsummer/setup and records the host setup surface, capability label, roster, slot workbench, slot cards, role cells, and command touch targets.",
        ...(roleSmokeSetupWorkbenchEvidenceComplete()
          ? [
              "Localhost role smoke records mobile stacked layout plus tablet and desktop co-located slot/role columns with no horizontal overflow and nonblank screenshots.",
            ]
          : []),
        ...(importedRoleSmokeSetupWorkbenchEvidenceComplete()
          ? [
              "Imported role-smoke validation preserves setup workbench screenshot and geometry evidence for portable browser acceptance.",
            ]
          : []),
      ],
      evidence: [
        "roleSmoke.setup",
        "roleSmoke.setup[*].slotCards",
        "roleSmoke.setup[*].screenshotPixels",
        "importedRoleSmoke.validated.setupCount",
        "importedRoleSmoke.validated.screenshotChecks",
        "browserAcceptanceBoundary.lanes[localhost-dev-server-role-smoke]",
        "browserAcceptanceBoundary.lanes[imported-localhost-role-smoke]",
      ],
      missing: hostSetupWorkbenchProof
        ? []
        : [
            "Run or import a passed frontend role smoke with /g/midsummer/setup workbench geometry for mobile, tablet, and desktop.",
          ],
    }),
    requirement({
      id: "player-surface",
      label: "Player thread, channel, command, votecount, and private queue",
      state: fullBrowserProof ? "browser_proven" : "dom_and_model_proven_browser_blocked",
      proven: [
        "Player route model covers thread paging, capability-scoped channels, vote command envelope, live projection store, votecount/deadline, and private projection boundaries.",
        "Static model and SSR proof expose the player thread pager as a first-class touch control with ready/pending/complete state, cursor metadata, duplicate-load disabling, and a 44px target floor.",
        "Static model and SSR proof render player thread image media only through tablet/small/thumb variants, prove original-only images are withheld, and keep original/desktop URLs out of rendered thread markup.",
        "SSR and DOM proof render player first viewport, command receipt strip, private review link, URL-addressed private disclosure, and host-copy exclusions.",
        "Static command proof records player submit_vote reject handling.",
        "Static model and SSR DOM proof record command traces from player actions into command receipt rows.",
        "No-browser dispatch bridge proof maps player command trace metadata through the player route handler into the real SubmitVote ACK/reject path and the SubmitPost ACK path, including receipt rows, smoke-exposed bridge plans, and distinct votecount versus thread/votecount refresh keys.",
        "No-localhost hydrated-handler proof records player SubmitVote ACK/reject and SubmitPost ACK outcomes into DOM-facing command receipt view models.",
        "No-localhost hydrated-surface adapter proof records player private disclosure expansion without host-only copy, thread pager pending/ack/reject lifecycle, plus SubmitVote and SubmitPost ACKs through real route data, command adapters, browser bridges, and projection refresh seams.",
        "File-backed in-app browser fixture statically exposes player thread pager pending/ack/reject controls and live-region status rows for manual browser proof.",
        "No-bind component interaction proof records player vote/post command button wiring and re-rendered SubmitVote/SubmitPost ACK rows through compiled Svelte components.",
        "Static SSR focusability proof verifies player focus targets and denied nav ids against rendered markup.",
        "No-browser route-live contract source-checks the player Svelte page onMount WebSocket connection, then drives open/hello/delta/resync frames through the same projection store and player browser bridge to a recovered thread snapshot.",
        ...noBindInteractionProof(
          "player",
          "player command and private-channel click hit-testing and focus landing",
        ),
        ...noBindKeyboardProof("player surface Tab traversal, visible focus outlines, and denied-control exclusion"),
        ...fullBrowserProofLines(
          "Dev-server role smoke proves player screenshots, focus traversal, vote/post ACK refresh evidence, role-PM SubmitPost evidence, private disclosure expansion, tablet-safe media request evidence, overlap-checked targets, and thumb-zone geometry.",
        ),
      ],
      evidence: [
        "staticContract.roles[player]",
        "staticContract.roles[player].threadPager",
        "staticContract.roles[player].media",
        "staticContract.commandPaths[player]",
        "staticContract.commandTraceContract",
        "dispatchBridge.rolePlans[player]",
        "dispatchBridge.routeHandlerOwnership[player]",
        "hydratedHandlers.roles[player]",
        "hydratedSurfaces.player",
        "hydratedSurfaces.player.threadPager",
        "componentInteractions.interactions[player]",
        "noBindInteractions.interactions[player]",
        "staticFocusability.surfaces[player]",
        "routeLive.sources[player]",
        "routeLive.runtime[player]",
        "keyboardTraversal.surfaces[player]",
        "domSmoke.feedbackTraces[player]",
        "routeStateRender.playerSurface",
        "routeStateRender.playerSurface.threadPager",
        "routeStateRender.playerSurface.media",
        "routeStateRender.playerPrivateReviewRoute",
        "routeStateRender.playerPrivateChannelRoute",
        "inAppBrowserPage.hydratedSurfaceScenarios[player].threadPager",
        "inAppBrowserStaticDom.hydratedSurfaceScenarios[player].threadPager",
        "domSmoke.surfaces[player/player-private-review/player-private-channel]",
      ],
      missing: fullBrowserProof
        ? []
        : [
            ...noBindInteractionMissing(),
            ...noBindKeyboardMissing(),
            "Hydrated browser proof for Svelte event scheduling, command side effects, focus retention, nonblank screenshots, and dev-server pointer behavior remains blocked.",
          ],
    }),
    requirement({
      id: "moderator-host-surface",
      label: "Moderator/host touch control surface",
      state: fullBrowserProof ? "browser_proven" : "dom_and_model_proven_browser_blocked",
      proven: [
        "Host route model exposes deadline, votecount, replacement, phase/thread lock, host prompts, slot lifecycle, and role controls.",
        "Command model covers moderator ACK, host-prompt resolution, post-ACK projection patching, and hydrated refresh removal path.",
        "Static source proof records shared ConfirmationShell ownership for moderator confirmation wrapper attributes.",
        "Static model proof records shared confirmation-action ownership for moderator destructive action payloads.",
        "Static model and SSR DOM proof record confirmation-command traces from moderator confirmations into command activity rows.",
        "No-browser dispatch bridge proof maps moderator host-prompt and slot-lifecycle confirmation trace metadata through the host route handler into real ResolveHostPrompt and SetSlotStatus envelopes, pending/ACK/reject activity states, smoke-exposed bridge plans, and the host-prompt-only post-ACK hostPrompts refresh key.",
        "No-localhost hydrated-handler proof records moderator ResolveHostPrompt ACK/reject plus SetSlotStatus ACK outcomes into DOM-facing host command activity view models, including Modkilled projection evidence.",
        "No-localhost hydrated-surface adapter proof records moderator host-prompt confirmation open, confirm dispatch, ResolveHostPrompt ACK, prompt projection removal, plus modkill_slot confirmation-to-SetSlotStatus ACK and Modkilled projection through real route data.",
        "No-bind component interaction proof records moderator HostAction confirmation wiring for host prompt and slot lifecycle controls, plus re-rendered ResolveHostPrompt and SetSlotStatus ACK rows through compiled Svelte components.",
        `No-browser static DOM proof verifies all ${EXPECTED_COUNTS.moderatorCriticalActions} moderator critical host confirmations, including deadline, replacement, phase/thread lock, votecount, slot lifecycle, role reveal, and host-prompt actions, own alertdialog metadata, confirm/cancel controls, focus-return/Escape/tab-containment attributes, and message text naming object plus outcome.`,
        "Static SSR focusability proof verifies moderator focus targets and denied nav ids against rendered markup.",
        "No-browser route-live contract source-checks the moderator Svelte page onMount WebSocket connection, then drives open/hello/delta/resync frames through the same projection store and host browser bridge to a recovered host-prompt projection.",
        ...noBindInteractionProof(`moderator", "all ${EXPECTED_COUNTS.moderatorCriticalActions} moderator critical host confirmation click hit-testing and focus landing`),
        ...noBindKeyboardProof("moderator surface Tab traversal, visible focus outlines, and denied-control exclusion"),
        "SSR and DOM proof render host console, host operations, command activity rail, votecount panel, critical actions, host-prompt action controls, and DOM-visible confirmation focus/escape/tab metadata.",
        ...fullBrowserProofLines(
          `Dev-server role smoke proves moderator screenshots, focus traversal, all ${EXPECTED_COUNTS.moderatorCriticalActions} critical host action confirmations, SetSlotStatus ACK with refreshed slot lifecycle projection, overlap-checked targets, and moderator thumb-zone geometry.`,
        ),
      ],
      evidence: [
        "staticContract.roles[moderator]",
        "staticContract.commandPaths[moderator]",
        "staticContract.confirmationShellContract",
        "staticContract.confirmationActionContract",
        "staticContract.confirmationCommandTraceContract",
        "dispatchBridge.rolePlans[moderator]",
        "dispatchBridge.routeHandlerOwnership[moderator]",
        "hydratedHandlers.roles[moderator]",
        "hydratedSurfaces.moderator",
        "componentInteractions.interactions[moderator]",
        "hostConfirmations.actions",
        "noBindInteractions.interactions[moderator]",
        "staticFocusability.surfaces[moderator]",
        "routeLive.sources[moderator]",
        "routeLive.runtime[moderator]",
        "keyboardTraversal.surfaces[moderator]",
        "domSmoke.feedbackTraces[moderator]",
        "routeStateRender.moderatorSurface",
        "routeStateRender.confirmationMarkup.moderatorHostPrompt",
        "domSmoke.surfaces[moderator]",
      ],
      missing: fullBrowserProof
        ? []
        : [
            ...noBindInteractionMissing(),
            ...noBindKeyboardMissing(),
            "Real tablet Chromium proof for focus trap, visible focus rings, overlap, Svelte client scheduling, and hydrated command dispatch remains blocked.",
          ],
    }),
    requirement({
      id: "admin-operator-surface",
      label: "Admin/operator setup, audit, and recovery",
      state: fullBrowserProof ? "browser_proven" : "dom_and_model_proven_browser_blocked",
      proven: [
        "Admin route model exposes setup, readiness, audit, recovery, session grant, and recovery-gate actions without ambient superuser checks.",
        "Admin audit list links to native SvelteKit detail route with principal-scoped machine evidence endpoint.",
        "Static source proof records shared ConfirmationShell ownership for admin setup/recovery confirmation wrapper attributes.",
        "Static model proof records shared confirmation-action ownership for admin setup/recovery payloads.",
        "Static model and SSR DOM proof record confirmation-command traces from admin confirmations into command activity rows.",
        "No-browser dispatch bridge proof maps admin setup confirmation trace metadata through the admin route handler into the real AddCohost request plus pending, ACK, reject command activity states, smoke-exposed bridge plan, and route-owned generic admin form result exposure.",
        "No-localhost hydrated-handler proof records admin AddCohost ACK/reject plus distinct session-grant and recovery-gate server form ACK outcomes into DOM-facing admin command activity view models and smoke-exposed form result keys.",
        "No-localhost hydrated-surface adapter proof records native admin audit-list to audit-detail route data, machine evidence href, overview return href, AddCohost ACK through the admin command adapter and browser bridge, plus session-grant and recovery-gate server form ACK rows through the route form-result bridge.",
        "No-bind component interaction proof records admin cohost, session-grant, and recovery-gate confirmation/form wiring plus re-rendered ACK rows through compiled Svelte components.",
        "Static SSR focusability proof verifies admin focus targets and denied nav ids against rendered markup.",
        ...noBindInteractionProof("admin", "admin cohost, session-grant, and recovery-gate confirm click hit-testing and focus landing"),
        ...noBindKeyboardProof("admin surface Tab traversal, visible focus outlines, and denied-control exclusion"),
        "SSR and DOM proof render admin setup/recovery confirmations with DOM-visible focus/escape/tab metadata plus a single admin command activity rail for setup/recovery command feedback.",
        "Static command proof records admin create_game reject handling.",
        ...fullBrowserProofLines(
          "Dev-server role smoke proves admin screenshots, audit-detail click-through evidence, session-grant and recovery-gate ACK evidence, setup/recovery thumb zones, overlap-checked targets, and focus traversal.",
        ),
      ],
      evidence: [
        "staticContract.roles[admin]",
        "staticContract.commandPaths[admin]",
        "staticContract.confirmationShellContract",
        "staticContract.confirmationActionContract",
        "staticContract.confirmationCommandTraceContract",
        "dispatchBridge.rolePlans[admin]",
        "dispatchBridge.routeHandlerOwnership[admin]",
        "hydratedHandlers.roles[admin]",
        "hydratedSurfaces.admin",
        "componentInteractions.interactions[admin]",
        "noBindInteractions.interactions[admin]",
        "staticFocusability.surfaces[admin]",
        "keyboardTraversal.surfaces[admin]",
        "domSmoke.feedbackTraces[admin]",
        "routeStateRender.adminSurface",
        "routeStateRender.adminAuditDetailSurface",
        "domSmoke.surfaces[admin/admin-audit-detail]",
      ],
      missing: fullBrowserProof
        ? []
        : [
            ...noBindInteractionMissing(),
            ...noBindKeyboardMissing(),
            "Hydrated browser proof for admin Svelte confirmation scheduling, focus traversal, and audit click-through screenshots remains blocked.",
          ],
    }),
    requirement({
      id: "route-states",
      label: "Empty/loading/reject route states",
      state: fullBrowserProof ? "browser_proven" : "ssr_and_dom_proven",
      proven: [
        "Admin, player, and moderator empty/loading/reject route-state scenarios render in build-mode SSR.",
        "DOM proof verifies root, status, action, state, aria-live, and touch metadata for all route-state pages.",
        "Static SSR focusability proof verifies every route-state recovery action is keyboard-focusable and denied nav ids remain inert.",
        ...noBindKeyboardProof("route-state Tab traversal, visible focus outlines, and route-state action reachability"),
        ...fullBrowserProofLines(
          "Dev-server role smoke proves every forced empty/loading/reject route-state surface renders nonblank screenshots across proof viewports.",
        ),
      ],
      evidence: [
        "routeStateRender.scenarios",
        "domSmoke.routeStates",
        "staticFocusability.routeStates",
        "keyboardTraversal.routeStates",
      ],
      missing: fullBrowserProof
        ? []
        : [
            ...noBindKeyboardMissing(),
            "Browser pixel layout and dev-server route-state focus traversal remain blocked.",
          ],
    }),
    requirement({
      id: "route-error-shell",
      label: "Route error shell and session context",
      state: fullBrowserProof ? "browser_proven" : "ssr_and_dom_proven",
      proven: [
        "The real SvelteKit error page renders in build-mode SSR through the shared app shell.",
        "A player private-channel 403 keeps the failed /g/midsummer/c/private%3Arole_pm%3Aslot-7 path inside the player surface.",
        "SSR and DOM proof preserve the principal and capability summary from root layout session context.",
        "DOM proof verifies the error surface owns shell touch metadata and the active player nav.",
        ...fullBrowserProofLines(
          "Dev-server role smoke proves forbidden admin, moderator, and signed-out player routes render expected reject/error screenshots with overlap-checked targets.",
        ),
      ],
      evidence: [
        "routeStateRender.errorSurface",
        "domSmoke.errorSurface",
      ],
      missing: fullBrowserProof
        ? []
        : [
            ...noBindKeyboardMissing(),
            "Browser pixel layout, visible focus, pointer behavior, and dev-server error navigation remain blocked.",
          ],
    }),
    requirement({
      id: "browser-acceptance",
      label: "Full Playwright/Chromium role acceptance",
      state: browserAcceptanceState(),
      proven:
        browserRoleSmokeEvidenceComplete()
          ? [
              "Dev-server Chromium role smoke passed, generated screenshots, recorded setup workbench geometry for /g/midsummer/setup, recorded tablet thumb-zone geometry, and recorded admin session-grant/recovery-gate form evidence, player main-thread SubmitPost ACK, player private:role_pm:slot-7 SubmitPost ACK, player tablet-media browser request evidence, and moderator SetSlotStatus ACK evidence with refreshed projections.",
            ]
          : inAppBrowserImportedRunEvidenceComplete()
            ? [
                "No-browser fallback artifacts are green and record the blocked localhost browser boundary.",
                `File-backed in-app browser fixture is generated, statically verified, and an external Chromium browser-run artifact was imported and validated for every proof viewport, all ${EXPECTED_COUNTS.plannedInteractions} fixture interactions, all ${EXPECTED_COUNTS.moderatorCriticalActions} moderator critical confirmations, player private-channel/disclosure evidence, and nonblank screenshot PNGs.`,
              ]
          : [
              "No-browser fallback artifacts are green and record the blocked browser boundary.",
              `File-backed in-app browser fixture is generated and statically verified for role shells, representative admin/player controls including admin session-grant/recovery-gate forms and player role-PM private-channel post, all ${EXPECTED_COUNTS.moderatorCriticalActions} moderator critical host confirmations, plus separate hydrated-surface admin forms, host-prompt, and slot-lifecycle scenario controls, but it has not produced browser click/focus evidence.`,
              "A localhost-served fixture run is modeled separately from the file URL lane and records the current localhost bind/Chromium boundary before promotion.",
            ],
      evidence: [
        "roleSmoke.status",
        "roleSmoke.boundary",
        "renderSmoke.status",
        "noBindInteractions.status",
        "staticFocusability.status",
        "keyboardTraversal.status",
        "inAppBrowserPage.status",
        "inAppBrowserPage.surfaces",
        "inAppBrowserPage.scenarios",
        "inAppBrowserPage.hydratedSurfaceScenarios",
        "inAppBrowserStaticDom.status",
        "inAppBrowserStaticDom.scenarios",
        "inAppBrowserRun.status",
        "inAppBrowserRun.runs",
        "inAppBrowserLocalhostRun.status",
        "inAppBrowserLocalhostRun.pageUrl",
        "inAppBrowserImportedRun.status",
        "inAppBrowserImportedRun.validated",
        "importedRoleSmoke.status",
        "importedRoleSmoke.validated",
        "browserAcceptanceBoundary.lanes",
        "browserAcceptanceBoundary.lanes[imported-localhost-role-smoke]",
        "browserAcceptanceBoundary.lanes[in-app-localhost-fixture-browser-run]",
        "browserAcceptanceBoundary.lanes[in-app-file-imported-browser-run]",
      ],
      missing:
        browserRoleSmokeEvidenceComplete()
          ? []
          : inAppBrowserImportedRunEvidenceComplete()
            ? [
                "localhost bind is denied before dev-server browser proof can run.",
                "The imported file-backed browser-run does not prove Svelte hydration, command dispatch side effects, TCP transport, WebSocket delivery, dev-server routing, or localhost app acceptance.",
              ]
          : [
              "localhost bind is denied before dev-server browser proof can run.",
              "Chromium launch is denied before no-bind render proof can run.",
              "Chromium launch is denied before no-bind click/focus interaction proof can run.",
              "Chromium launch is denied before no-bind keyboard traversal proof can run.",
              "File-backed in-app browser page has not been opened and exercised successfully, so it remains a prepared fixture rather than browser acceptance evidence.",
              "File-backed in-app browser-run evidence is absent or blocked.",
              "Localhost-served fixture browser-run evidence is absent or blocked.",
              "No passed external file-backed browser-run artifact has been imported.",
            ],
    }),
  ],
};

await mkdir(artifactDir, { recursive: true });
await writeFile(evidencePath, `${JSON.stringify(audit, null, 2)}\n`);
console.log(`wrote ${path.relative(repoRoot, evidencePath)}`);

function requirement({ id, label, state, proven, evidence, missing }) {
  return {
    id,
    label,
    state,
    proven,
    evidence,
    missing,
  };
}

function fullBrowserProofLines(...lines) {
  return fullBrowserProof ? lines : [];
}

function browserAcceptanceState() {
  if (browserRoleSmokeEvidenceComplete() || importedRoleSmokeEvidenceComplete()) {
    return "browser_proven";
  }
  if (inAppBrowserImportedRunEvidenceComplete()) {
    return "file_fixture_browser_imported_proven_localhost_blocked";
  }
  if (noBindInteractionEvidenceComplete()) {
    return "dev_server_browser_blocked_no_bind_interactions_proven";
  }
  if (artifacts.keyboardTraversal.status === "passed") {
    return "dev_server_browser_blocked_no_bind_keyboard_proven";
  }
  if (artifacts.renderSmoke.status === "passed") {
    return "dev_server_browser_blocked_no_bind_render_proven";
  }
  return "blocked_by_localhost_and_chromium_sandbox";
}

function inAppBrowserImportedRunEvidenceComplete() {
  if (artifacts.inAppBrowserImportedRun.status !== "imported-passed") {
    return false;
  }
  const validated = artifacts.inAppBrowserImportedRun.validated ?? {};
  return (
    validated.viewportCount > 0 &&
    validated.runCount >= validated.viewportCount &&
    validated.plannedInteractionCount >= EXPECTED_COUNTS.plannedInteractions &&
    validated.moderatorCriticalConfirmationCount === EXPECTED_COUNTS.moderatorCriticalActions &&
    Array.isArray(validated.screenshotChecks) &&
    validated.screenshotChecks.length >= validated.viewportCount &&
    validated.screenshotChecks.every((check) =>
      check.screenshotPixels?.uniqueColorBuckets >= 8 &&
      check.screenshotPixels?.changedPixelRatio >= 0.005
    )
  );
}

function importedRoleSmokeEvidenceComplete() {
  if (artifacts.importedRoleSmoke.status !== "imported-passed") {
    return false;
  }
  const validated = artifacts.importedRoleSmoke.validated ?? {};
  return (
    validated.viewportCount > 0 &&
    validated.boardCount >= validated.viewportCount &&
    validated.setupCount >= 3 &&
    validated.roleCount >= validated.viewportCount * 3 &&
    validated.playerPrivateChannelCount >= validated.viewportCount &&
    validated.routeStateCount > 0 &&
    validated.forbiddenRouteCount > 0 &&
    validated.screenshotCheckCount > 0 &&
    Array.isArray(validated.screenshotChecks) &&
    validated.screenshotChecks.length === validated.screenshotCheckCount &&
    validated.screenshotChecks.every((check) =>
      check.screenshotPixels?.uniqueColorBuckets >= 8 &&
      check.screenshotPixels?.changedPixelRatio >= 0.005
    )
  );
}

function tabletInteractionSourceSummary() {
  return `${artifacts.tabletInteraction.scanned.root} ${artifacts.tabletInteraction.scanned.extensions.join("/")}`;
}

function tabletInteractionForbiddenSummary() {
  return artifacts.tabletInteraction.forbiddenPatterns
    .map((pattern) => pattern.id)
    .join(", ");
}

function importedRoleSmokeSetupWorkbenchEvidenceComplete() {
  if (artifacts.importedRoleSmoke.status !== "imported-passed") {
    return false;
  }
  const validated = artifacts.importedRoleSmoke.validated ?? {};
  return (
    validated.setupCount >= 3 &&
    Array.isArray(validated.screenshotChecks) &&
    validated.screenshotChecks.some((check) =>
      String(check.screenshot ?? "").includes("host-setup"),
    )
  );
}

function browserRoleSmokeEvidenceComplete() {
  if (artifacts.roleSmoke.status !== "passed") {
    return false;
  }
  const roleIds = new Set((artifacts.roleSmoke.roles ?? []).map((entry) => entry.role));
  for (const id of ["admin", "player", "moderator"]) {
    if (!roleIds.has(id)) {
      return false;
    }
  }
  return (
    Array.isArray(artifacts.roleSmoke.board) &&
    artifacts.roleSmoke.board.length > 0 &&
    roleSmokeSetupWorkbenchEvidenceComplete() &&
    Array.isArray(artifacts.roleSmoke.routeStates) &&
    artifacts.roleSmoke.routeStates.length > 0 &&
    (artifacts.roleSmoke.roles ?? []).every(
      (entry) => entry.screenshotPixels !== undefined,
    ) &&
    roleSmokeThumbZoneEvidenceComplete() &&
    adminBrowserOperationalEvidenceComplete() &&
    playerBrowserPostEvidenceComplete() &&
    playerPrivateChannelBrowserPostEvidenceComplete() &&
    playerBrowserMediaEvidenceComplete() &&
    moderatorBrowserSlotLifecycleEvidenceComplete()
  );
}

function roleSmokeThumbZoneEvidenceComplete() {
  const viewportCount = artifacts.roleSmoke.viewports?.length ?? 0;
  if (viewportCount === 0) {
    return false;
  }
  return expectedThumbZoneCounts().every(({ role, zones }) => {
    const entries = (artifacts.roleSmoke.roles ?? []).filter(
      (entry) => entry.role === role,
    );
    return (
      entries.length >= viewportCount &&
      entries.every((entry) => thumbZonesComplete(entry.thumbZones, zones))
    );
  });
}

function roleSmokeSetupWorkbenchEvidenceComplete() {
  const setupEntries = artifacts.roleSmoke.setup ?? [];
  const viewportNames = new Set(setupEntries.map((entry) => entry.viewport?.name));
  return (
    setupEntries.length >= 3 &&
    ["mobile", "tablet", "desktop"].every((name) => viewportNames.has(name)) &&
    setupEntries.every((entry) =>
      entry.role === "host-setup" &&
      entry.path === "/g/midsummer/setup" &&
      entry.surfaceTestId === "host-setup-surface" &&
      entry.capabilityTestId === "host-setup-capability" &&
      entry.noHorizontalOverflow === true &&
      entry.screenshotPixels !== undefined &&
      Array.isArray(entry.slotCards) &&
      entry.slotCards.length >= 2 &&
      entry.slotCards.every(
        (slot) =>
          slot.roleCellContainedInCard === true &&
          slot.assignmentContainedInCard === true,
      )
    )
  );
}


function thumbZonesComplete(actual, expectedZones) {
  if (!Array.isArray(actual)) {
    return false;
  }
  const byTestId = new Map(actual.map((zone) => [zone.testId, zone]));
  return expectedZones.every(([testId, targetCount]) => {
    const zone = byTestId.get(testId);
    return zone?.targetCount === targetCount;
  });
}

function adminBrowserOperationalEvidenceComplete() {
  const viewportCount = artifacts.roleSmoke.viewports?.length ?? 0;
  const adminEntries = (artifacts.roleSmoke.roles ?? []).filter(
    (entry) => entry.role === "admin",
  );
  if (viewportCount === 0 || adminEntries.length < viewportCount) {
    return false;
  }
  return adminEntries.every((entry) =>
    entry.commandResult?.sessionGrant?.focus?.initialFocus?.testId ===
      "admin-command-confirm-session-grants" &&
    entry.commandResult?.sessionGrant?.form?.action === "?/grantSession" &&
    includesAll(
      entry.commandResult?.sessionGrant?.form?.fieldTestIds,
      [
        "admin-session-grant-token",
        "admin-session-grant-principal",
        "admin-session-grant-expires-at",
        "admin-session-grant-global-mod",
      ],
    ) &&
    entry.commandResult?.recovery?.state === "ack" &&
    entry.commandResult?.recovery?.focus?.initialFocus?.testId ===
      "admin-recovery-confirm-recovery-gate" &&
    entry.commandResult?.recovery?.form?.action === "?/checkRecoveryGate" &&
    includesAll(
      entry.commandResult?.recovery?.form?.fieldNames,
      ["game", "principalUserId"],
    ) &&
    entry.commandResult?.activity?.acknowledged?.state === "ack",
  );
}

function playerBrowserPostEvidenceComplete() {
  const viewportCount = artifacts.roleSmoke.viewports?.length ?? 0;
  const playerEntries = (artifacts.roleSmoke.roles ?? []).filter(
    (entry) => entry.role === "player",
  );
  if (viewportCount === 0 || playerEntries.length < viewportCount) {
    return false;
  }
  return playerEntries.every((entry) =>
    entry.commandResult?.postCommandReceipt?.state === "ack" &&
    entry.commandResult?.postCommand?.requestCommand?.body ===
      "Browser smoke player post" &&
    entry.commandResult?.postCommand?.requestCommand?.channel_id === "main" &&
    entry.commandResult?.postCommand?.refreshedPostTestId === "thread-post-445",
  );
}

function playerBrowserMediaEvidenceComplete() {
  const viewportCount = artifacts.roleSmoke.viewports?.length ?? 0;
  const playerEntries = (artifacts.roleSmoke.roles ?? []).filter(
    (entry) => entry.role === "player",
  );
  if (viewportCount === 0 || playerEntries.length < viewportCount) {
    return false;
  }
  return playerEntries.every((entry) =>
    entry.commandResult?.media?.renderedVariant === "tablet" &&
    entry.commandResult?.media?.mediaTestId === "thread-post-media-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" &&
    entry.commandResult?.media?.requestedOriginal === false &&
    Array.isArray(entry.commandResult?.media?.requested) &&
    entry.commandResult.media.requested.length > 0 &&
    entry.commandResult.media.requested.every((request) =>
      ["tablet", "small", "thumb", "thumbnail"].includes(request.variant),
    ),
  );
}

function playerPrivateChannelBrowserPostEvidenceComplete() {
  const viewportCount = artifacts.roleSmoke.viewports?.length ?? 0;
  const entries = artifacts.roleSmoke.playerPrivateChannel ?? [];
  if (viewportCount === 0 || entries.length < viewportCount) {
    return false;
  }
  return entries.every((entry) =>
    entry.path === "/g/midsummer/c/private%3Arole_pm%3Aslot-7" &&
    entry.activeChannelTestId === "player-channel-private:role_pm:slot-7" &&
    entry.privateReviewHref === "/g/midsummer/c/private%3Arole_pm%3Aslot-7?private=notification-1" &&
    entry.commandResult?.requestCommand?.game === "midsummer" &&
    entry.commandResult?.requestCommand?.channel_id === "private:role_pm:slot-7" &&
    entry.commandResult?.requestCommand?.actor_slot === "slot-7" &&
    entry.commandResult?.requestCommand?.body === "Browser smoke private:role_pm:slot-7 post" &&
    entry.commandResult?.refreshedPostTestId === "thread-post-446" &&
    entry.screenshotPixels !== undefined,
  );
}

function moderatorBrowserSlotLifecycleEvidenceComplete() {
  const viewportCount = artifacts.roleSmoke.viewports?.length ?? 0;
  const moderatorEntries = (artifacts.roleSmoke.roles ?? []).filter(
    (entry) => entry.role === "moderator",
  );
  if (viewportCount === 0 || moderatorEntries.length < viewportCount) {
    return false;
  }
  return moderatorEntries.every((entry) =>
    entry.commandResult?.slotLifecycle?.state === "ack" &&
    entry.commandResult?.slotLifecycle?.requestCommand?.SetSlotStatus?.game ===
      "midsummer" &&
    entry.commandResult?.slotLifecycle?.requestCommand?.SetSlotStatus?.slot ===
      "slot-7" &&
    entry.commandResult?.slotLifecycle?.requestCommand?.SetSlotStatus?.status ===
      "modkilled" &&
    entry.commandResult?.slotLifecycle?.projection?.lifecycleLabel === "Modkilled",
  );
}

function includesAll(actual, expected) {
  if (!Array.isArray(actual)) {
    return false;
  }
  const values = new Set(actual);
  return expected.every((value) => values.has(value));
}

function iabFixtureEvidenceComplete() {
  if (artifacts.inAppBrowserPage.status !== "page-generated") {
    return false;
  }
  const surfaceIds = new Set(
    (artifacts.inAppBrowserPage.surfaces ?? []).map((surface) => surface.id),
  );
  for (const id of ["board-player", "admin", "player", "moderator"]) {
    if (!surfaceIds.has(id)) {
      return false;
    }
  }
  const scenarioIds = new Set(
    (artifacts.inAppBrowserPage.scenarios ?? []).map((scenario) => scenario.id),
  );
  for (const id of [
    "admin-cohost-confirm-click",
    "admin-session-grant-confirm-click",
    "admin-recovery-gate-confirm-click",
    "player-submit-vote-click",
    "player-submit-post-click",
    "player-private-channel-submit-post-click",
    "route-error-back-to-board-click",
    "moderator-extend_deadline-confirm-click",
    "moderator-extend_deadline_24h-confirm-click",
    "moderator-extend_deadline_48h-confirm-click",
    "moderator-process_replacement-confirm-click",
    "moderator-resolve_phase-confirm-click",
    "moderator-lock_thread-confirm-click",
    "moderator-publish_votecount-confirm-click",
    "moderator-mark_dead-confirm-click",
    "moderator-modkill_slot-confirm-click",
    "moderator-complete_game-confirm-click",
    "moderator-resolve_host_prompt-D01-skip_next_day-slot_1-confirm-click",
  ]) {
    if (!scenarioIds.has(id)) {
      return false;
    }
  }
  const hydratedScenarioIds = new Set(
    (artifacts.inAppBrowserPage.hydratedSurfaceScenarios ?? []).map(
      (scenario) => scenario.id,
    ),
  );
  for (const id of [
    "shared-shell-header-coverage",
    "admin-audit-native-flow",
    "admin-operational-forms",
    "player-private-disclosure-vote-and-post",
    "moderator-host-prompt-confirmation",
    "moderator-slot-lifecycle-confirmation",
  ]) {
    if (!hydratedScenarioIds.has(id)) {
      return false;
    }
  }
  const moderatorHydratedScenario = (
    artifacts.inAppBrowserPage.hydratedSurfaceScenarios ?? []
  ).find((scenario) => scenario.id === "moderator-host-prompt-confirmation");
  const moderatorSlotLifecycleScenario = (
    artifacts.inAppBrowserPage.hydratedSurfaceScenarios ?? []
  ).find((scenario) => scenario.id === "moderator-slot-lifecycle-confirmation");
  if (
    moderatorHydratedScenario?.command?.commandKind !== "ResolveHostPrompt" ||
    moderatorHydratedScenario?.command?.visibleState !== "ack"
  ) {
    return false;
  }
  if (
    moderatorSlotLifecycleScenario?.slotLifecycleCommand?.commandKind !==
      "SetSlotStatus" ||
    moderatorSlotLifecycleScenario?.slotLifecycleCommand?.visibleState !== "ack"
  ) {
    return false;
  }
  return (
    artifacts.inAppBrowserPage.page ===
      "target/frontend-in-app-browser-interactions/interaction-page.html" &&
    typeof artifacts.inAppBrowserPage.pageUrl === "string"
  );
}

function iabStaticDomEvidenceComplete() {
  if (
    artifacts.inAppBrowserStaticDom.status !== "passed" ||
    artifacts.inAppBrowserStaticDom.proof !== "in-app-browser-static-dom-contract" ||
    artifacts.inAppBrowserStaticDom.scenarioCount < EXPECTED_COUNTS.commandScenarios ||
    artifacts.inAppBrowserStaticDom.hydratedScenarioCount < 6
  ) {
    return false;
  }
  const playerPrivateChannel = (artifacts.inAppBrowserStaticDom.scenarios ?? []).find(
    (entry) => entry.id === "player-private-channel-submit-post-click",
  );
  const routeError = (artifacts.inAppBrowserStaticDom.scenarios ?? []).find(
    (entry) => entry.id === "route-error-back-to-board-click",
  );
  return (
    playerPrivateChannel?.route?.path === "/g/midsummer/c/private%3Arole_pm%3Aslot-7" &&
    playerPrivateChannel.route.activeChannelTestId === "player-channel-private:role_pm:slot-7" &&
    playerPrivateChannel.route.activeChannelCurrent === "page" &&
    playerPrivateChannel.route.privateReviewHref ===
      "/g/midsummer/c/private%3Arole_pm%3Aslot-7?private=notification-1" &&
    routeError?.errorSurface?.path === "/g/midsummer/c/private%3Arole_pm%3Aslot-7" &&
    routeError.errorSurface.status === 403 &&
    routeError.errorSurface.actionHref === "/" &&
    routeError.errorSurface.activeNavCurrent === "page" &&
    (artifacts.inAppBrowserStaticDom.forbidden ?? []).some(
      (entry) =>
        entry.label === "file-backed player private-channel fixture" &&
        entry.present === false,
    )
  );
}

function noBindInteractionProof(role, description) {
  return noBindInteractionEvidenceComplete() &&
    artifacts.noBindInteractions.interactions?.[role]?.length > 0
    ? [`No-bind Chromium interaction proof records ${description}.`]
    : [];
}

function noBindInteractionMissing() {
  return noBindInteractionEvidenceComplete()
    ? []
    : ["No-bind Chromium click/focus interaction proof remains blocked by Chromium launch."];
}

function noBindInteractionEvidenceComplete() {
  const viewportCount = artifacts.noBindInteractions.viewports?.length ?? 0;
  if (artifacts.noBindInteractions.status !== "passed" || viewportCount === 0) {
    return false;
  }
  for (const [role, scenarioIds] of Object.entries(noBindInteractionScenarioIds())) {
    const entries = artifacts.noBindInteractions.interactions?.[role];
    if (!Array.isArray(entries) || entries.length < viewportCount * scenarioIds.length) {
      return false;
    }
    const actualIds = new Set(entries.map((entry) => entry.id));
    for (const id of scenarioIds) {
      if (!actualIds.has(id)) {
        return false;
      }
    }
    for (const entry of entries) {
      if (
        entry.clicked === undefined ||
        entry.activeElement === undefined ||
        entry.targetBox === undefined
      ) {
        return false;
      }
    }
  }
  return true;
}

function noBindInteractionScenarioIds() {
  return {
    admin: [
      "admin-cohost-confirm-click",
      "admin-session-grant-confirm-click",
      "admin-recovery-gate-confirm-click",
    ],
    player: [
      "player-submit-vote-click",
      "player-submit-post-click",
      "player-private-channel-submit-post-click",
    ],
    moderator: [
      "moderator-extend_deadline-confirm-click",
      "moderator-extend_deadline_24h-confirm-click",
      "moderator-extend_deadline_48h-confirm-click",
      "moderator-process_replacement-confirm-click",
      "moderator-resolve_phase-confirm-click",
      "moderator-lock_thread-confirm-click",
      "moderator-publish_votecount-confirm-click",
      "moderator-mark_dead-confirm-click",
      "moderator-modkill_slot-confirm-click",
      "moderator-complete_game-confirm-click",
      "moderator-resolve_host_prompt-D01-skip_next_day-slot_1-confirm-click",
    ],
  };
}

function noBindKeyboardProof(description) {
  return artifacts.keyboardTraversal.status === "passed"
    ? [`No-bind Chromium keyboard traversal proof records ${description}.`]
    : [];
}

function noBindKeyboardMissing() {
  return artifacts.keyboardTraversal.status === "passed"
    ? []
    : ["No-bind Chromium keyboard traversal proof remains blocked by Chromium launch."];
}

function assertRouteErrorSurface(errorSurface, { artifact, includesTouchTargets }) {
  assert.deepEqual(
    {
      role: errorSurface?.role,
      path: errorSurface?.path,
      status: errorSurface?.status,
      surface: errorSurface?.surface,
      surfaceTestId: errorSurface?.surfaceTestId,
      panelTestId: errorSurface?.panelTestId,
      actionTestId: errorSurface?.actionTestId,
      actionHref: errorSurface?.actionHref,
      activeNavTestId: errorSurface?.activeNavTestId,
      sessionPrincipal: errorSurface?.sessionPrincipal,
      capabilitySummary: errorSurface?.capabilitySummary,
      message: errorSurface?.message,
    },
    {
      role: "player",
      path: "/g/midsummer/c/private%3Arole_pm%3Aslot-7",
      status: 403,
      surface: "player",
      surfaceTestId: "route-error-surface",
      panelTestId: "route-error-panel",
      actionTestId: "route-error-action",
      actionHref: "/",
      activeNavTestId: "role-nav-player",
      sessionPrincipal: "player_mira",
      capabilitySummary: "ChannelMember + SlotOccupant",
      message: "Channel private:role_pm:slot-7 is not visible.",
    },
    `${artifact} route error surface drifted`,
  );
  assert.equal(errorSurface.htmlBytes > 0, true, `${artifact} htmlBytes missing`);
  if (includesTouchTargets) {
    assert.equal(
      errorSurface.touchTargets?.count > 0,
      true,
      `${artifact} touch target count missing`,
    );
    assert.equal(
      errorSurface.touchTargets?.minPx >= 44,
      true,
      `${artifact} touch target floor missing`,
    );
  }
}

async function readArtifact(relativePath) {
  return JSON.parse(await readFile(path.join(repoRoot, relativePath), "utf8"));
}
