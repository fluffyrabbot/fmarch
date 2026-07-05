import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = path.join(repoRoot, "target", "frontend-readiness-summary");
const jsonPath = path.join(artifactDir, "readiness-summary.json");
const markdownPath = path.join(artifactDir, "readiness-summary.md");

const sources = {
  completionAudit: "target/frontend-completion-audit/completion-audit.json",
  roleSmoke: "target/frontend-role-smoke/role-smoke.json",
  renderSmoke: "target/frontend-role-render-smoke/render-smoke.json",
  routeStateRender: "target/frontend-route-state-render/route-state-render.json",
  dispatchBridge: "target/frontend-dispatch-bridge/dispatch-bridge.json",
  hydratedHandlers: "target/frontend-hydrated-handlers/hydrated-handlers.json",
  hydratedSurfaces: "target/frontend-hydrated-surfaces/hydrated-surfaces.json",
  componentInteractions:
    "target/frontend-component-interactions/component-interactions.json",
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
};

const artifacts = Object.fromEntries(
  await Promise.all(
    Object.entries(sources).map(async ([key, source]) => [
      key,
      await readArtifact(source),
    ]),
  ),
);

const localhostProofState = localhostState(
  artifacts.roleSmoke,
  artifacts.importedRoleSmoke,
);
const noBindProofState = noBindState(artifacts.renderSmoke);
const noBindInteractionProofState = noBindInteractionState(
  artifacts.noBindInteractions,
);
const noBindKeyboardProofState = noBindKeyboardState(
  artifacts.keyboardTraversal,
);
const localhostPromotionFailures = localhostFailureReasons(artifacts.roleSmoke);
const noBindPromotionFailures = noBindFailureReasons(artifacts.renderSmoke);
const noBindInteractionPromotionFailures = noBindInteractionFailureReasons(
  artifacts.noBindInteractions,
);
const noBindKeyboardPromotionFailures = noBindKeyboardFailureReasons(
  artifacts.keyboardTraversal,
);

assert.equal(["passed", "incomplete"].includes(artifacts.completionAudit.status), true);
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
assert.equal(artifacts.tabletInteraction.thumbZones.admin.zones.length, 2);
assert.equal(artifacts.tabletInteraction.thumbZones.player.zones.length, 1);
assert.equal(
  artifacts.tabletInteraction.thumbZones.moderator.zones[0].descendantCount,
  9,
);
assert.equal(artifacts.routeLive.status, "passed");
assert.equal(artifacts.routeLive.proof, "frontend-route-live-contract");
assert.equal(artifacts.hostConfirmations.status, "passed");
assert.equal(artifacts.hostConfirmations.proof, "host-confirmation-static-dom-contract");
assert.equal(artifacts.hostConfirmations.actionCount, 9);
assert.equal(artifacts.routeLive.sources.player.onMountConnects, true);
assert.equal(artifacts.routeLive.sources.moderator.onMountConnects, true);
assert.equal(artifacts.routeLive.runtime.player.finalStatus.state, "recovered");
assert.equal(artifacts.routeLive.runtime.moderator.finalStatus.state, "recovered");
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
assert.equal(artifacts.staticContract.status, "passed");
assert.equal(artifacts.inAppBrowserPage.status, "page-generated");
assert.equal(artifacts.inAppBrowserStaticDom.status, "passed");
assert.equal(inAppBrowserFixtureComplete(artifacts.inAppBrowserPage), true);
assert.equal(
  inAppBrowserStaticDomEvidenceComplete(artifacts.inAppBrowserStaticDom),
  true,
);
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
assert.equal(
  ["passed", "incomplete"].includes(artifacts.browserAcceptanceBoundary.status),
  true,
);
assert.equal(
  artifacts.browserAcceptanceBoundary.proof,
  "frontend-browser-acceptance-boundary",
);

const requirements = Object.fromEntries(
  artifacts.completionAudit.requirements.map((requirement) => [
    requirement.id,
    requirement,
  ]),
);

const summary = {
  status: artifacts.completionAudit.status,
  proof: "frontend-readiness-summary",
  generatedFrom: sources,
  boundary:
    "Generated operator-readable summary of current frontend proof artifacts. It reports model/SSR/DOM readiness separately from diagnostic Chromium no-bind lanes and promotes completion only when the full localhost dev-server role smoke is proven.",
  promotionRules: {
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
      "noBindInteractions.interactions includes admin cohost, admin session-grant, admin recovery-gate, player vote, player post, player private-channel post, and all 9 moderator critical host confirmations",
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
      "playerPrivateChannel roleSmoke entries include role-pm SubmitPost ACK evidence",
      "player roleSmoke entries include tablet-media browser request evidence without original/full/desktop URLs",
      "moderator roleSmoke entries include SetSlotStatus ACK and slot lifecycle projection evidence",
    ],
    inAppBrowserFixtureRequires: [
      "inAppBrowserPage.status == page-generated",
      "inAppBrowserPage.surfaces includes board-player, admin, player, and moderator",
      "inAppBrowserPage.scenarios includes admin cohost, admin session-grant, admin recovery-gate, player vote, player post, player private-channel post, and all 9 moderator critical host confirmations",
      "inAppBrowserPage.hydratedSurfaceScenarios includes shared shell, admin audit, admin operational forms, player private disclosure/vote/post, moderator host-prompt, and moderator slot-lifecycle controls",
      "inAppBrowserStaticDom.status == passed",
      "inAppBrowserStaticDom.scenarios includes every fixture command target with role-pm route evidence",
      "inAppBrowserPage.pageUrl is a file URL prepared for manual/in-app browser execution",
    ],
    inAppBrowserRunRequires: [
      "inAppBrowserRun.status == passed",
      "inAppBrowserRun.runs includes every proof viewport",
      "all inAppBrowserRun entries include clicked target, activeElement, targetBox, and screenshotPixels",
      "all 9 moderator critical host confirmation run entries include alertdialog focus metadata and object/outcome text",
      "player private-channel run entries include active role-pm route evidence",
      "player private disclosure toggles from aria-expanded=false to aria-expanded=true",
    ],
    inAppBrowserLocalhostRunRequires: [
      "inAppBrowserLocalhostRun.status == passed",
      "inAppBrowserLocalhostRun.pageUrl is a localhost URL",
      "inAppBrowserLocalhostRun.runs includes every proof viewport",
      "all inAppBrowserLocalhostRun entries include clicked target, activeElement, targetBox, and screenshotPixels",
      "all 9 moderator critical host confirmation run entries include alertdialog focus metadata and object/outcome text",
    ],
    inAppBrowserImportedRunRequires: [
      "inAppBrowserImportedRun.status == imported-passed",
      "inAppBrowserImportedRun.validated.runCount covers every proof viewport",
      "inAppBrowserImportedRun.validated.plannedInteractionCount covers all 21 fixture interactions",
      "inAppBrowserImportedRun.validated.moderatorCriticalConfirmationCount is 9",
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
  },
  overall: artifacts.completionAudit.overall,
  roles: [
    roleSummary({
      id: "admin",
      label: "Admin/operator",
      requirement: requirements["admin-operator-surface"],
      staticRoleId: "admin",
      routeEvidence: [
        "routeStateRender.adminSurface",
        "routeStateRender.adminAuditDetailSurface",
        "routeStateRender.feedbackRailMarkup.admin",
      ],
      domEvidence: ["domSmoke.surfaces[admin]", "domSmoke.surfaces[admin-audit-detail]"],
      commandEvidence: "staticContract.commandPaths[admin]",
      dispatchEvidence: "dispatchBridge.rolePlans[admin]",
      handlerEvidence: "hydratedHandlers.roles[admin]",
      hydratedSurfaceEvidence: "hydratedSurfaces.admin",
      componentInteractionEvidence: "componentInteractions.interactions[admin]",
      noBindInteractionEvidence: "noBindInteractions.interactions[admin]",
      staticFocusabilityEvidence: "staticFocusability.surfaces[admin]",
      keyboardTraversalEvidence: "keyboardTraversal.surfaces[admin]",
      feedbackEvidence: {
        component: artifacts.routeStateRender.feedbackRailMarkup.admin.component,
        itemTestId: artifacts.routeStateRender.feedbackRailMarkup.admin.itemTestId,
        statusTestId: artifacts.routeStateRender.feedbackRailMarkup.admin.statusTestId,
        statusState: artifacts.routeStateRender.feedbackRailMarkup.admin.statusState,
      },
    }),
    roleSummary({
      id: "player",
      label: "Player",
      requirement: requirements["player-surface"],
      staticRoleId: "player",
      routeEvidence: [
        "routeStateRender.playerSurface",
        "routeStateRender.playerSurface.media",
        "routeStateRender.playerPrivateReviewRoute",
        "routeStateRender.playerPrivateChannelRoute",
        "routeStateRender.feedbackRailMarkup.player",
      ],
      domEvidence: [
        "domSmoke.surfaces[player]",
        "domSmoke.surfaces[player-private-review]",
        "domSmoke.surfaces[player-private-channel]",
      ],
      commandEvidence: "staticContract.commandPaths[player]",
      dispatchEvidence: "dispatchBridge.rolePlans[player]",
      handlerEvidence: "hydratedHandlers.roles[player]",
      hydratedSurfaceEvidence: "hydratedSurfaces.player",
      componentInteractionEvidence: "componentInteractions.interactions[player]",
      noBindInteractionEvidence: "noBindInteractions.interactions[player]",
      staticFocusabilityEvidence: "staticFocusability.surfaces[player]",
      routeLiveEvidence: [
        "routeLive.sources[player]",
        "routeLive.runtime[player]",
      ],
      keyboardTraversalEvidence: "keyboardTraversal.surfaces[player]",
      feedbackEvidence: {
        component: artifacts.routeStateRender.feedbackRailMarkup.player.component,
        itemTestId: artifacts.routeStateRender.feedbackRailMarkup.player.itemTestId,
        statusTestId: artifacts.routeStateRender.feedbackRailMarkup.player.statusTestId,
        statusState: artifacts.routeStateRender.feedbackRailMarkup.player.statusState,
      },
    }),
    roleSummary({
      id: "moderator",
      label: "Moderator/host",
      requirement: requirements["moderator-host-surface"],
      staticRoleId: "moderator",
      routeEvidence: [
        "routeStateRender.moderatorSurface",
        "routeStateRender.confirmationMarkup.moderatorHostPrompt",
        "routeStateRender.feedbackRailMarkup.moderator",
      ],
      domEvidence: ["domSmoke.surfaces[moderator]"],
      commandEvidence: "staticContract.commandPaths[moderator]",
      dispatchEvidence: "dispatchBridge.rolePlans[moderator]",
      handlerEvidence: "hydratedHandlers.roles[moderator]",
      hydratedSurfaceEvidence: "hydratedSurfaces.moderator",
      componentInteractionEvidence: "componentInteractions.interactions[moderator]",
      hostConfirmationEvidence: "hostConfirmations.actions",
      noBindInteractionEvidence: "noBindInteractions.interactions[moderator]",
      staticFocusabilityEvidence: "staticFocusability.surfaces[moderator]",
      routeLiveEvidence: [
        "routeLive.sources[moderator]",
        "routeLive.runtime[moderator]",
      ],
      keyboardTraversalEvidence: "keyboardTraversal.surfaces[moderator]",
      feedbackEvidence: {
        component: artifacts.routeStateRender.feedbackRailMarkup.moderator.component,
        itemTestId: artifacts.routeStateRender.feedbackRailMarkup.moderator.itemTestId,
        statusTestId: artifacts.routeStateRender.feedbackRailMarkup.moderator.statusTestId,
        statusState: artifacts.routeStateRender.feedbackRailMarkup.moderator.statusState,
      },
    }),
  ],
  shared: {
    requirement: requirementSummary(requirements["shared-app-shell"]),
    singleRootShell: {
      requirement: requirementSummary(requirements["single-root-shell-architecture"]),
      routeEvidence: "routeStateRender.singleRootShell",
      sourceContract:
        artifacts.routeStateRender.singleRootShell.sourceContract,
      surfaceShellCounts:
        artifacts.routeStateRender.singleRootShell.surfaces.map((surface) => ({
          id: surface.id,
          shellComponentCount: surface.shellComponentCount,
        })),
      routeStateShellCounts:
        artifacts.routeStateRender.singleRootShell.routeStates.map((surface) => ({
          id: surface.id,
          shellComponentCount: surface.shellComponentCount,
        })),
    },
    routeStates: requirementSummary(requirements["route-states"]),
    tabletInteraction: {
      requirement: requirementSummary(
        requirements["tablet-native-interaction-posture"],
      ),
      scannedFileCount: artifacts.tabletInteraction.scanned.fileCount,
      appShellTouchTargetMinPx:
        artifacts.tabletInteraction.sharedAppCss.appShellTouchTargetMinPx,
      hostTouchTargetMinPx:
        artifacts.tabletInteraction.hostTouchCss.touchTargetMinPx,
      forbiddenMatchCount: artifacts.tabletInteraction.forbiddenMatches.length,
      thumbZoneRoles: ["admin", "player", "moderator"].filter(
        (role) => artifacts.tabletInteraction.thumbZones[role] !== undefined,
      ),
      moderatorCriticalActionCount:
        artifacts.tabletInteraction.thumbZones.moderator.zones[0].descendantCount,
    },
    routeError: {
      requirement: requirementSummary(requirements["route-error-shell"]),
      routeEvidence: "routeStateRender.errorSurface",
      domEvidence: "domSmoke.errorSurface",
      status: artifacts.routeStateRender.errorSurface.status,
      path: artifacts.routeStateRender.errorSurface.path,
      activeNavTestId: artifacts.routeStateRender.errorSurface.activeNavTestId,
      sessionPrincipal: artifacts.routeStateRender.errorSurface.sessionPrincipal,
      capabilitySummary: artifacts.routeStateRender.errorSurface.capabilitySummary,
      touchTargets: artifacts.domSmoke.errorSurface.touchTargets,
    },
  },
  browserAcceptance: {
    requirement: requirementSummary(requirements["browser-acceptance"]),
    localhost: localhostSummary(artifacts.roleSmoke),
    noBindChromium: noBindSummary(artifacts.renderSmoke),
    noBindInteractions: noBindInteractionSummary(artifacts.noBindInteractions),
    noBindKeyboard: noBindKeyboardSummary(artifacts.keyboardTraversal),
    inAppBrowserFixture: inAppBrowserFixtureSummary(
      artifacts.inAppBrowserPage,
    ),
    inAppBrowserStaticDom: inAppBrowserStaticDomSummary(
      artifacts.inAppBrowserStaticDom,
    ),
    inAppBrowserRun: inAppBrowserRunSummary(artifacts.inAppBrowserRun, {
      label: "File-backed fixture",
    }),
    inAppBrowserLocalhostRun: inAppBrowserRunSummary(
      artifacts.inAppBrowserLocalhostRun,
      { label: "Localhost-served fixture" },
    ),
    inAppBrowserImportedRun: inAppBrowserImportedRunSummary(
      artifacts.inAppBrowserImportedRun,
    ),
    importedRoleSmoke: importedRoleSmokeSummary(artifacts.importedRoleSmoke),
    boundaryArtifact: {
      status: artifacts.browserAcceptanceBoundary.status,
      proof: artifacts.browserAcceptanceBoundary.proof,
      lanes: artifacts.browserAcceptanceBoundary.lanes.map((lane) => ({
        id: lane.id,
        status: lane.status,
        artifactStatus: lane.artifactStatus,
        promotionEligible: lane.promotionEligible,
      })),
      blockers: artifacts.browserAcceptanceBoundary.overall.blockers,
      diagnosticBlockers:
        artifacts.browserAcceptanceBoundary.overall.diagnosticBlockers ?? [],
    },
  },
};

await mkdir(artifactDir, { recursive: true });
await writeFile(jsonPath, `${JSON.stringify(summary, null, 2)}\n`);
await writeFile(markdownPath, `${renderMarkdown(summary)}\n`);
console.log(renderConsole(summary));
console.log(`wrote ${path.relative(repoRoot, jsonPath)}`);
console.log(`wrote ${path.relative(repoRoot, markdownPath)}`);

function roleSummary({
  id,
  label,
  requirement,
  staticRoleId,
  routeEvidence,
  domEvidence,
  commandEvidence,
  dispatchEvidence,
  handlerEvidence,
  hydratedSurfaceEvidence,
  componentInteractionEvidence,
  hostConfirmationEvidence = null,
  noBindInteractionEvidence,
  staticFocusabilityEvidence,
  routeLiveEvidence = null,
  keyboardTraversalEvidence,
  feedbackEvidence,
}) {
  const staticRole = artifacts.staticContract.roles.find((role) => role.id === staticRoleId);
  const commandPath = artifacts.staticContract.commandPaths.find(
    (entry) => entry.role === staticRoleId,
  );
  assert.equal(staticRole !== undefined, true, `missing static role ${staticRoleId}`);
  assert.equal(commandPath !== undefined, true, `missing command path ${staticRoleId}`);
  const surfaces = {
    model: "proven",
    ssr: "proven",
    dom: "proven",
    staticFocusability: "proven",
    routeLive: routeLiveEvidence === null ? "not_applicable" : "proven",
    noBindInteraction: noBindInteractionProofState,
    noBindKeyboard: noBindKeyboardProofState,
    noBindChromium: noBindProofState,
    localhostBrowser: localhostProofState,
  };
  return {
    id,
    label,
    readiness: promotedReadiness(surfaces),
    requirement: requirementSummary(requirement),
    surfaces,
    promotionFailures: promotionFailuresForSurfaces(surfaces),
    evidence: {
      staticRole: `staticContract.roles[${staticRoleId}]`,
      staticLayout: `staticContract.firstViewportLayoutContract.roles[${staticRoleId}]`,
      commandPath: commandEvidence,
      dispatchBridge: dispatchEvidence,
      hydratedHandler: handlerEvidence,
      hydratedSurface: hydratedSurfaceEvidence,
      componentInteraction: componentInteractionEvidence,
      hostConfirmation: hostConfirmationEvidence,
      noBindInteraction: noBindInteractionEvidence,
      staticFocusability: staticFocusabilityEvidence,
      routeLive: routeLiveEvidence,
      noBindKeyboard: keyboardTraversalEvidence,
      route: routeEvidence,
      dom: domEvidence,
      feedback: feedbackEvidence,
    },
    blocked: blockedReasonsForSurfaces(surfaces, requirement.missing),
  };
}

function requirementSummary(requirement) {
  return {
    id: requirement.id,
    label: requirement.label,
    state: requirement.state,
    proven: requirement.proven,
    missing: requirement.missing,
  };
}

function localhostSummary(roleSmoke) {
  return {
    status: localhostProofState,
    artifactStatus: roleSmoke.status,
    boundary: roleSmoke.boundary,
    promotionFailures: localhostPromotionFailures,
    blockedReason:
      localhostProofState === "browser_proven"
        ? null
        : "localhost bind is denied before the dev-server browser proof can run",
  };
}

function noBindSummary(renderSmoke) {
  return {
    status: noBindProofState,
    artifactStatus: renderSmoke.status,
    boundary: renderSmoke.boundary,
    promotionFailures: noBindPromotionFailures,
    blockedReason:
      noBindProofState === "chromium_no_bind_proven"
        ? null
        : "Chromium launch is denied before no-bind screenshots or geometry can run",
  };
}

function noBindInteractionSummary(noBindInteractions) {
  return {
    status: noBindInteractionProofState,
    artifactStatus: noBindInteractions.status,
    boundary: noBindInteractions.boundary,
    promotionFailures: noBindInteractionPromotionFailures,
    blockedReason:
      noBindInteractionProofState === "chromium_no_bind_interactions_proven"
        ? null
        : "Chromium launch is denied before no-bind click/focus interactions can run",
  };
}

function noBindKeyboardSummary(keyboardTraversal) {
  return {
    status: noBindKeyboardProofState,
    artifactStatus: keyboardTraversal.status,
    boundary: keyboardTraversal.boundary,
    promotionFailures: noBindKeyboardPromotionFailures,
    blockedReason:
      noBindKeyboardProofState === "chromium_no_bind_keyboard_proven"
        ? null
        : "Chromium launch is denied before no-bind keyboard traversal can run",
  };
}

function inAppBrowserFixtureSummary(inAppBrowserPage) {
  return {
    status: inAppBrowserFixtureComplete(inAppBrowserPage)
      ? "fixture_prepared"
      : "incomplete",
    artifactStatus: inAppBrowserPage.status,
    boundary: inAppBrowserPage.boundary,
    page: inAppBrowserPage.page,
    pageUrl: inAppBrowserPage.pageUrl,
    surfaces: (inAppBrowserPage.surfaces ?? []).map((surface) => ({
      id: surface.id,
      role: surface.role,
      render: surface.render,
      surfaceTestId: surface.surfaceTestId,
    })),
    scenarios: (inAppBrowserPage.scenarios ?? []).map((scenario) => ({
      id: scenario.id,
      role: scenario.role,
      render: scenario.render,
      renderArgs: scenario.renderArgs,
      targetTestId: scenario.targetTestId,
      targetAction: scenario.targetAction,
    })),
    hydratedSurfaceScenarios: (inAppBrowserPage.hydratedSurfaceScenarios ?? []).map(
      (scenario) => ({
        id: scenario.id,
        role: scenario.role,
        source: scenario.source,
        commandKind: scenario.command?.commandKind,
        visibleState: scenario.command?.visibleState,
        postCommandKind: scenario.postCommand?.commandKind,
        postVisibleState: scenario.postCommand?.visibleState,
        slotLifecycleCommandKind: scenario.slotLifecycleCommand?.commandKind,
        slotLifecycleVisibleState:
          scenario.slotLifecycleCommand?.visibleState,
      }),
    ),
    stabilityChecks: stabilityCheckSummaries(inAppBrowserPage.stabilityChecks),
    blockedReason:
      "Prepared file-backed fixture has not produced browser click/focus/screenshot evidence.",
  };
}

function inAppBrowserStaticDomSummary(inAppBrowserStaticDom) {
  const playerPrivateChannel = (inAppBrowserStaticDom.scenarios ?? []).find(
    (scenario) => scenario.id === "player-private-channel-submit-post-click",
  );
  const routeError = (inAppBrowserStaticDom.scenarios ?? []).find(
    (scenario) => scenario.id === "route-error-back-to-board-click",
  );
  return {
    status: inAppBrowserStaticDomEvidenceComplete(inAppBrowserStaticDom)
      ? "static_dom_proven"
      : "incomplete",
    artifactStatus: inAppBrowserStaticDom.status,
    boundary: inAppBrowserStaticDom.boundary,
    scenarioCount: inAppBrowserStaticDom.scenarioCount,
    hydratedScenarioCount: inAppBrowserStaticDom.hydratedScenarioCount,
    stabilityChecks: stabilityCheckSummaries(inAppBrowserStaticDom.stabilityChecks),
    playerPrivateChannelRoute: playerPrivateChannel?.route ?? null,
    routeError: routeError?.errorSurface ?? null,
    forbidden: inAppBrowserStaticDom.forbidden,
  };
}

function inAppBrowserRunSummary(inAppBrowserRun, { label } = {}) {
  const runLabel = label ?? "Fixture";
  return {
    status: inAppBrowserRunEvidenceComplete(inAppBrowserRun)
      ? "browser_run_proven"
      : "blocked",
    artifactStatus: inAppBrowserRun.status,
    boundary: inAppBrowserRun.boundary,
    pageUrl: inAppBrowserRun.pageUrl,
    plannedInteractionIds: (inAppBrowserRun.plannedInteractions ?? []).map(
      (interaction) => interaction.id,
    ),
    plannedStabilityCheckIds: (inAppBrowserRun.plannedStabilityChecks ?? []).map(
      (check) => check.id,
    ),
    runCount: inAppBrowserRun.runs?.length ?? 0,
    interactionIds: [
      ...new Set(
        (inAppBrowserRun.runs ?? []).flatMap((run) =>
          (run.interactions ?? []).map((interaction) => interaction.id),
        ),
      ),
    ],
    promotionFailures: inAppBrowserRunFailureReasons(inAppBrowserRun),
    blockedReason: inAppBrowserRunEvidenceComplete(inAppBrowserRun)
      ? null
      : `${runLabel} browser-run evidence has not completed.`,
  };
}

function inAppBrowserImportedRunSummary(inAppBrowserImportedRun) {
  const proven = inAppBrowserImportedRunEvidenceComplete(inAppBrowserImportedRun);
  return {
    status: proven ? "imported_browser_run_proven" : "source_blocked",
    artifactStatus: inAppBrowserImportedRun.status,
    boundary: inAppBrowserImportedRun.boundary,
    promotionEligible: inAppBrowserImportedRun.promotionEligible === true,
    sourceBrowserRun: inAppBrowserImportedRun.sourceBrowserRun ?? null,
    validated: {
      viewportCount: inAppBrowserImportedRun.validated?.viewportCount ?? 0,
      runCount: inAppBrowserImportedRun.validated?.runCount ?? 0,
      plannedInteractionCount:
        inAppBrowserImportedRun.validated?.plannedInteractionCount ?? 0,
      plannedStabilityCheckCount:
        inAppBrowserImportedRun.validated?.plannedStabilityCheckCount ?? 0,
      stabilityCheckTileCount:
        inAppBrowserImportedRun.validated?.stabilityCheckTileCount ?? 0,
      moderatorCriticalConfirmationCount:
        inAppBrowserImportedRun.validated?.moderatorCriticalConfirmationCount ?? 0,
      screenshotCheckCount:
        inAppBrowserImportedRun.validated?.screenshotChecks?.length ?? 0,
    },
    blocking: inAppBrowserImportedRun.blocking ?? [],
    blockedReason: proven
      ? null
      : "No passed external file-backed browser-run artifact has been imported.",
  };
}

function importedRoleSmokeSummary(importedRoleSmoke) {
  const proven = importedRoleSmokeEvidenceComplete(importedRoleSmoke);
  return {
    status: proven ? "imported_role_smoke_proven" : "source_blocked",
    artifactStatus: importedRoleSmoke.status,
    boundary: importedRoleSmoke.boundary,
    promotionEligible: importedRoleSmoke.promotionEligible === true,
    sourceRoleSmoke: importedRoleSmoke.sourceRoleSmoke ?? null,
    validated: {
      viewportCount: importedRoleSmoke.validated?.viewportCount ?? 0,
      boardCount: importedRoleSmoke.validated?.boardCount ?? 0,
      roleCount: importedRoleSmoke.validated?.roleCount ?? 0,
      playerPrivateChannelCount:
        importedRoleSmoke.validated?.playerPrivateChannelCount ?? 0,
      routeStateCount: importedRoleSmoke.validated?.routeStateCount ?? 0,
      forbiddenRouteCount: importedRoleSmoke.validated?.forbiddenRouteCount ?? 0,
      screenshotCheckCount:
        importedRoleSmoke.validated?.screenshotChecks?.length ?? 0,
    },
    blocking: importedRoleSmoke.blocking ?? [],
    blockedReason: proven
      ? null
      : "No passed external localhost role-smoke artifact has been imported.",
  };
}

function stabilityCheckSummaries(checks = []) {
  return checks.map((check) => ({
    id: check.id,
    role: check.role,
    surfaceId: check.surfaceId,
    mode: check.mode,
    statusFloorMinBlockSizePx: check.statusFloorMinBlockSizePx,
    tileCount: check.tileCount ?? check.tiles?.length ?? 0,
  }));
}

function localhostState(roleSmoke, importedRoleSmoke) {
  if (browserRoleSmokeEvidenceComplete(roleSmoke)) {
    return "browser_proven";
  }
  if (importedRoleSmokeEvidenceComplete(importedRoleSmoke)) {
    return "imported_browser_proven";
  }
  if (roleSmoke.status !== "passed") {
    return "blocked";
  }
  return "incomplete";
}

function noBindState(renderSmoke) {
  if (renderSmoke.status !== "passed") {
    return "blocked";
  }
  return noBindRenderEvidenceComplete(renderSmoke)
    ? "chromium_no_bind_proven"
    : "incomplete";
}

function noBindInteractionState(noBindInteractions) {
  if (noBindInteractions.status !== "passed") {
    return "blocked";
  }
  return noBindInteractionEvidenceComplete(noBindInteractions)
    ? "chromium_no_bind_interactions_proven"
    : "incomplete";
}

function noBindKeyboardState(keyboardTraversal) {
  if (keyboardTraversal.status !== "passed") {
    return "blocked";
  }
  return noBindKeyboardEvidenceComplete(keyboardTraversal)
    ? "chromium_no_bind_keyboard_proven"
    : "incomplete";
}

function inAppBrowserFixtureComplete(inAppBrowserPage) {
  if (inAppBrowserPage.status !== "page-generated") {
    return false;
  }
  const surfaceIds = new Set(
    (inAppBrowserPage.surfaces ?? []).map((surface) => surface.id),
  );
  for (const id of ["board-player", "admin", "player", "moderator"]) {
    if (!surfaceIds.has(id)) {
      return false;
    }
  }
  const scenarioIds = new Set(
    (inAppBrowserPage.scenarios ?? []).map((scenario) => scenario.id),
  );
  for (const id of inAppBrowserCommandScenarioIds()) {
    if (!scenarioIds.has(id)) {
      return false;
    }
  }
  const hydratedScenarioIds = new Set(
    (inAppBrowserPage.hydratedSurfaceScenarios ?? []).map(
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
    inAppBrowserPage.hydratedSurfaceScenarios ?? []
  ).find((scenario) => scenario.id === "moderator-host-prompt-confirmation");
  const moderatorSlotLifecycleScenario = (
    inAppBrowserPage.hydratedSurfaceScenarios ?? []
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
    inAppBrowserPage.page ===
      "target/frontend-in-app-browser-interactions/interaction-page.html" &&
    typeof inAppBrowserPage.pageUrl === "string" &&
    inAppBrowserPage.pageUrl.startsWith("file://")
  );
}

function inAppBrowserStaticDomEvidenceComplete(inAppBrowserStaticDom) {
  if (
    inAppBrowserStaticDom.status !== "passed" ||
    inAppBrowserStaticDom.proof !== "in-app-browser-static-dom-contract" ||
    inAppBrowserStaticDom.scenarioCount < 16 ||
    inAppBrowserStaticDom.hydratedScenarioCount < 6
  ) {
    return false;
  }
  const playerPrivateChannel = (inAppBrowserStaticDom.scenarios ?? []).find(
    (entry) => entry.id === "player-private-channel-submit-post-click",
  );
  const routeError = (inAppBrowserStaticDom.scenarios ?? []).find(
    (entry) => entry.id === "route-error-back-to-board-click",
  );
  return (
    playerPrivateChannel?.route?.path === "/g/midsummer/c/role-pm" &&
    playerPrivateChannel.route.activeChannelTestId === "player-channel-role-pm" &&
    playerPrivateChannel.route.activeChannelCurrent === "page" &&
    playerPrivateChannel.route.privateReviewHref ===
      "/g/midsummer/c/role-pm?private=notification-1" &&
    routeError?.errorSurface?.path === "/g/midsummer/c/role-pm" &&
    routeError.errorSurface.status === 403 &&
    routeError.errorSurface.actionHref === "/" &&
    routeError.errorSurface.activeNavCurrent === "page" &&
    (inAppBrowserStaticDom.forbidden ?? []).some(
      (entry) =>
        entry.label === "file-backed player private-channel fixture" &&
        entry.present === false,
    )
  );
}

function inAppBrowserRunEvidenceComplete(inAppBrowserRun) {
  if (inAppBrowserRun.status !== "passed") {
    return false;
  }
  const runs = inAppBrowserRun.runs ?? [];
  const viewportCount = inAppBrowserRun.viewports?.length ?? 0;
  if (viewportCount === 0 || runs.length < viewportCount) {
    return false;
  }
  for (const run of runs) {
    const ids = new Set((run.interactions ?? []).map((entry) => entry.id));
    for (const id of inAppBrowserRunInteractionIds()) {
      if (!ids.has(id)) {
        return false;
      }
    }
    if (run.screenshotPixels === undefined) {
      return false;
    }
    for (const entry of run.interactions ?? []) {
      if (
        entry.clicked === undefined ||
        entry.activeElement === undefined ||
        entry.targetBox === undefined
      ) {
        return false;
      }
    }
    for (const id of moderatorCriticalConfirmationScenarioIds()) {
      const entry = (run.interactions ?? []).find((interaction) => interaction.id === id);
      if (!hasModeratorBrowserConfirmationEvidence(entry)) {
        return false;
      }
    }
    const playerPrivateChannel = (run.interactions ?? []).find(
      (entry) => entry.id === "player-private-channel-submit-post-click",
    );
    if (
      playerPrivateChannel?.route?.path !== "/g/midsummer/c/role-pm" ||
      playerPrivateChannel.route.activeChannelTestId !== "player-channel-role-pm" ||
      playerPrivateChannel.route.activeChannelCurrent !== "page" ||
      playerPrivateChannel.route.privateReviewHref !==
        "/g/midsummer/c/role-pm?private=notification-1"
    ) {
      return false;
    }
    const playerDisclosure = (run.interactions ?? []).find(
      (entry) => entry.id === "player-private-disclosure-vote-and-post",
    );
    if (
      playerDisclosure?.disclosureBefore?.ariaExpanded !== "false" ||
      playerDisclosure?.disclosureAfter?.ariaExpanded !== "true" ||
      playerDisclosure?.disclosureAfter?.detailHidden !== false
    ) {
      return false;
    }
    const stabilityIds = new Set(
      (run.stabilityChecks ?? []).map((check) => check.id),
    );
    for (const check of inAppBrowserRun.plannedStabilityChecks ?? []) {
      if (!stabilityIds.has(check.id)) {
        return false;
      }
    }
    for (const check of run.stabilityChecks ?? []) {
      if (
        check.mode !== "reserved-status-floor" ||
        check.statusFloorMinBlockSizePx !== 44 ||
        check.tileCount !== (check.tiles?.length ?? 0) ||
        !check.tiles?.every((tile) =>
          tile.triggerPrecedesStatusFloor === true &&
          tile.statusFloorBox !== undefined &&
          tile.statusFloorBox.height >= check.statusFloorMinBlockSizePx
        )
      ) {
        return false;
      }
    }
  }
  return true;
}

function inAppBrowserImportedRunEvidenceComplete(inAppBrowserImportedRun) {
  if (inAppBrowserImportedRun.status !== "imported-passed") {
    return false;
  }
  const validated = inAppBrowserImportedRun.validated ?? {};
  return (
    validated.viewportCount > 0 &&
    validated.runCount >= validated.viewportCount &&
    validated.plannedInteractionCount >= inAppBrowserRunInteractionIds().length &&
    validated.moderatorCriticalConfirmationCount ===
      moderatorCriticalConfirmationScenarioIds().length &&
    Array.isArray(validated.screenshotChecks) &&
    validated.screenshotChecks.length >= validated.viewportCount &&
    validated.screenshotChecks.every((check) =>
      check.screenshotPixels?.uniqueColorBuckets >= 8 &&
      check.screenshotPixels?.changedPixelRatio >= 0.005
    )
  );
}

function importedRoleSmokeEvidenceComplete(importedRoleSmoke) {
  if (importedRoleSmoke.status !== "imported-passed") {
    return false;
  }
  const validated = importedRoleSmoke.validated ?? {};
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

function inAppBrowserCommandScenarioIds() {
  return [
    "admin-cohost-confirm-click",
    "admin-session-grant-confirm-click",
    "admin-recovery-gate-confirm-click",
    "player-submit-vote-click",
    "player-submit-post-click",
    "player-private-channel-submit-post-click",
    "route-error-back-to-board-click",
    ...moderatorCriticalConfirmationScenarioIds(),
  ];
}

function inAppBrowserRunInteractionIds() {
  return [
    ...inAppBrowserCommandScenarioIds(),
    "admin-audit-native-flow",
    "admin-operational-forms",
    "player-private-disclosure-vote-and-post",
    "moderator-host-prompt-confirmation",
    "moderator-slot-lifecycle-confirmation",
  ];
}

function moderatorCriticalConfirmationScenarioIds() {
  return [
    "moderator-extend_deadline-confirm-click",
    "moderator-process_replacement-confirm-click",
    "moderator-resolve_phase-confirm-click",
    "moderator-lock_thread-confirm-click",
    "moderator-publish_votecount-confirm-click",
    "moderator-mark_dead-confirm-click",
    "moderator-modkill_slot-confirm-click",
    "moderator-complete_game-confirm-click",
    "moderator-resolve_host_prompt-D01-skip_next_day-slot_1-confirm-click",
  ];
}

function hasModeratorBrowserConfirmationEvidence(entry) {
  return (
    entry?.confirmation?.role === "alertdialog" &&
    entry.confirmation.initialFocusTestId === "critical-host-action-confirm" &&
    entry.confirmation.returnFocusTestId === "critical-host-action-trigger" &&
    entry.confirmation.escapeCancels === "true" &&
    entry.confirmation.tabContainment === "confirm-cancel" &&
    typeof entry.confirmation.actionId === "string" &&
    typeof entry.confirmation.payloadKind === "string" &&
    typeof entry.confirmation.messageText === "string" &&
    entry.confirmation.messageText.includes(entry.confirmation.objectLabel) &&
    entry.confirmation.messageText.includes(entry.confirmation.outcomeLabel)
  );
}

function promotedReadiness(surfaces) {
  if (
    surfaces.localhostBrowser === "browser_proven" ||
    surfaces.localhostBrowser === "imported_browser_proven"
  ) {
    return "browser_proven";
  }
  if (surfaces.noBindInteraction === "chromium_no_bind_interactions_proven") {
    return "model_ssr_dom_chromium_no_bind_interactions_proven_localhost_blocked";
  }
  if (surfaces.noBindKeyboard === "chromium_no_bind_keyboard_proven") {
    return "model_ssr_dom_chromium_no_bind_keyboard_proven_localhost_blocked";
  }
  if (surfaces.noBindChromium === "chromium_no_bind_proven") {
    return "model_ssr_dom_chromium_no_bind_proven_localhost_blocked";
  }
  if (
    surfaces.model === "proven" &&
    surfaces.ssr === "proven" &&
    surfaces.dom === "proven"
  ) {
    return "model_ssr_dom_proven_browser_blocked";
  }
  return "incomplete";
}

function blockedReasonsForSurfaces(surfaces, fallbackMissing) {
  if (
    surfaces.localhostBrowser === "browser_proven" ||
    surfaces.localhostBrowser === "imported_browser_proven"
  ) {
    return [];
  }
  if (surfaces.noBindChromium === "chromium_no_bind_proven") {
    return [
      "localhost browser proof for hydrated focus, pointer, navigation, and command dispatch remains blocked.",
    ];
  }
  if (surfaces.noBindInteraction === "chromium_no_bind_interactions_proven") {
    return [
      "No-bind screenshot geometry and localhost browser proof for hydrated navigation and command dispatch remain blocked.",
    ];
  }
  if (surfaces.noBindKeyboard === "chromium_no_bind_keyboard_proven") {
    return [
      "No-bind click/focus interaction, screenshot geometry, and localhost browser proof remain blocked.",
    ];
  }
  return fallbackMissing;
}

function promotionFailuresForSurfaces(surfaces) {
  if (
    surfaces.localhostBrowser === "browser_proven" ||
    surfaces.localhostBrowser === "imported_browser_proven"
  ) {
    return [];
  }
  return [
    ...noBindInteractionPromotionFailures.map(
      (reason) => `noBindInteraction: ${reason}`,
    ),
    ...noBindKeyboardPromotionFailures.map(
      (reason) => `noBindKeyboard: ${reason}`,
    ),
    ...noBindPromotionFailures.map((reason) => `noBindChromium: ${reason}`),
    ...localhostPromotionFailures.map((reason) => `localhostBrowser: ${reason}`),
  ];
}

function browserRoleSmokeEvidenceComplete(roleSmoke) {
  const roleIds = new Set((roleSmoke.roles ?? []).map((entry) => entry.role));
  for (const id of ["admin", "player", "moderator"]) {
    if (!roleIds.has(id)) {
      return false;
    }
  }
  return (
    Array.isArray(roleSmoke.board) &&
    roleSmoke.board.length > 0 &&
    roleSmokeSetupWorkbenchEvidenceComplete(roleSmoke) &&
    Array.isArray(roleSmoke.routeStates) &&
    roleSmoke.routeStates.length > 0 &&
    (roleSmoke.roles ?? []).every((entry) => entry.screenshotPixels !== undefined) &&
    roleSmokeThumbZoneEvidenceComplete(roleSmoke) &&
    adminBrowserOperationalEvidenceComplete(roleSmoke) &&
    playerBrowserPostEvidenceComplete(roleSmoke) &&
    playerPrivateChannelBrowserPostEvidenceComplete(roleSmoke) &&
    playerBrowserMediaEvidenceComplete(roleSmoke) &&
    moderatorBrowserSlotLifecycleEvidenceComplete(roleSmoke)
  );
}

function adminBrowserOperationalEvidenceComplete(roleSmoke) {
  const viewportCount = roleSmoke.viewports?.length ?? 0;
  const adminEntries = (roleSmoke.roles ?? []).filter(
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

function playerBrowserPostEvidenceComplete(roleSmoke) {
  const viewportCount = roleSmoke.viewports?.length ?? 0;
  const playerEntries = (roleSmoke.roles ?? []).filter(
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

function playerBrowserMediaEvidenceComplete(roleSmoke) {
  const viewportCount = roleSmoke.viewports?.length ?? 0;
  const playerEntries = (roleSmoke.roles ?? []).filter(
    (entry) => entry.role === "player",
  );
  if (viewportCount === 0 || playerEntries.length < viewportCount) {
    return false;
  }
  return playerEntries.every((entry) =>
    entry.commandResult?.media?.renderedVariant === "tablet" &&
    entry.commandResult?.media?.mediaTestId === "thread-post-media-receipt-442" &&
    entry.commandResult?.media?.requestedOriginal === false &&
    Array.isArray(entry.commandResult?.media?.requested) &&
    entry.commandResult.media.requested.length > 0 &&
    entry.commandResult.media.requested.every((request) =>
      ["tablet", "small", "thumb", "thumbnail"].includes(request.variant),
    ),
  );
}

function playerPrivateChannelBrowserPostEvidenceComplete(roleSmoke) {
  const viewportCount = roleSmoke.viewports?.length ?? 0;
  const entries = roleSmoke.playerPrivateChannel ?? [];
  if (viewportCount === 0 || entries.length < viewportCount) {
    return false;
  }
  return entries.every((entry) =>
    entry.path === "/g/midsummer/c/role-pm" &&
    entry.activeChannelTestId === "player-channel-role-pm" &&
    entry.privateReviewHref === "/g/midsummer/c/role-pm?private=notification-1" &&
    entry.commandResult?.requestCommand?.game === "midsummer" &&
    entry.commandResult?.requestCommand?.channel_id === "role-pm" &&
    entry.commandResult?.requestCommand?.actor_slot === "slot-7" &&
    entry.commandResult?.requestCommand?.body === "Browser smoke role-pm post" &&
    entry.commandResult?.refreshedPostTestId === "thread-post-446" &&
    entry.screenshotPixels !== undefined,
  );
}

function moderatorBrowserSlotLifecycleEvidenceComplete(roleSmoke) {
  const viewportCount = roleSmoke.viewports?.length ?? 0;
  const moderatorEntries = (roleSmoke.roles ?? []).filter(
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

function noBindRenderEvidenceComplete(renderSmoke) {
  const viewportCount = renderSmoke.viewports?.length ?? 0;
  if (viewportCount === 0) {
    return false;
  }
  return (
    (renderSmoke.surfaces?.length ?? 0) >= viewportCount * 7 &&
    (renderSmoke.feedbackRails?.length ?? 0) >= viewportCount * 3 &&
    (renderSmoke.routeStates?.length ?? 0) > 0 &&
    renderSmokeThumbZoneEvidenceComplete(renderSmoke) &&
    (renderSmoke.surfaces ?? []).every((entry) => entry.screenshotPixels !== undefined) &&
    (renderSmoke.feedbackRails ?? []).every((entry) => entry.screenshotPixels !== undefined) &&
    (renderSmoke.routeStates ?? []).every((entry) => entry.screenshotPixels !== undefined)
  );
}

function roleSmokeThumbZoneEvidenceComplete(roleSmoke) {
  const viewportCount = roleSmoke.viewports?.length ?? 0;
  if (viewportCount === 0) {
    return false;
  }
  return expectedThumbZoneCounts().every(({ role, zones }) => {
    const entries = (roleSmoke.roles ?? []).filter((entry) => entry.role === role);
    return (
      entries.length >= viewportCount &&
      entries.every((entry) => thumbZonesComplete(entry.thumbZones, zones))
    );
  });
}

function roleSmokeSetupWorkbenchEvidenceComplete(roleSmoke) {
  const setupEntries = roleSmoke.setup ?? [];
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

function renderSmokeThumbZoneEvidenceComplete(renderSmoke) {
  const viewportCount = renderSmoke.viewports?.length ?? 0;
  if (viewportCount === 0) {
    return false;
  }
  return expectedThumbZoneCounts().every(({ role, zones }) => {
    const entries = (renderSmoke.surfaces ?? []).filter(
      (entry) => entry.role === role && entry.id === role,
    );
    return (
      entries.length >= viewportCount &&
      entries.every((entry) => thumbZonesComplete(entry.thumbZones, zones))
    );
  });
}

function expectedThumbZoneCounts() {
  return [
    {
      role: "admin",
      zones: [
        ["admin-setup-action-zone", 3],
        ["admin-recovery-action-zone", 1],
      ],
    },
    { role: "player", zones: [["player-primary-action-zone", 4]] },
    { role: "moderator", zones: [["moderator-primary-action-zone", 9]] },
  ];
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

function noBindInteractionEvidenceComplete(noBindInteractions) {
  const viewportCount = noBindInteractions.viewports?.length ?? 0;
  if (viewportCount === 0) {
    return false;
  }
  for (const [role, scenarioIds] of Object.entries(noBindInteractionScenarioIds())) {
    const entries = noBindInteractions.interactions?.[role];
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

function noBindKeyboardEvidenceComplete(keyboardTraversal) {
  const viewportCount = keyboardTraversal.viewports?.length ?? 0;
  if (viewportCount === 0) {
    return false;
  }
  const surfaceIds = new Set(
    (keyboardTraversal.surfaces ?? []).map((entry) => entry.id),
  );
  for (const id of ["board", "admin", "player", "moderator"]) {
    if (!surfaceIds.has(id)) {
      return false;
    }
  }
  return (
    (keyboardTraversal.surfaces?.length ?? 0) >= viewportCount * 4 &&
    (keyboardTraversal.routeStates?.length ?? 0) > 0 &&
    [...(keyboardTraversal.surfaces ?? []), ...(keyboardTraversal.routeStates ?? [])]
      .every((entry) =>
        Array.isArray(entry.focusTraversal?.expectedOrder) &&
        Array.isArray(entry.focusTraversal?.sequence) &&
        entry.focusTraversal.sequence.length > 0,
      )
  );
}

function localhostFailureReasons(roleSmoke) {
  const failures = [];
  if (roleSmoke.status !== "passed") {
    failures.push(`roleSmoke.status is ${String(roleSmoke.status)}, expected passed`);
  }
  const roleIds = new Set((roleSmoke.roles ?? []).map((entry) => entry.role));
  for (const id of ["admin", "player", "moderator"]) {
    if (!roleIds.has(id)) {
      failures.push(`roleSmoke.roles missing ${id}`);
    }
  }
  if (!Array.isArray(roleSmoke.board) || roleSmoke.board.length === 0) {
    failures.push("roleSmoke.board is empty or absent");
  }
  if (!roleSmokeSetupWorkbenchEvidenceComplete(roleSmoke)) {
    failures.push(
      "roleSmoke.setup missing /g/midsummer/setup workbench geometry evidence",
    );
  }
  if (!Array.isArray(roleSmoke.routeStates) || roleSmoke.routeStates.length === 0) {
    failures.push("roleSmoke.routeStates is empty or absent");
  }
  for (const entry of roleSmoke.roles ?? []) {
    if (entry.screenshotPixels === undefined) {
      failures.push(`roleSmoke.roles[${entry.role}] missing screenshotPixels`);
    }
  }
  if (!adminBrowserOperationalEvidenceComplete(roleSmoke)) {
    failures.push(
      "roleSmoke.roles[admin] missing session-grant form or recovery-gate ACK evidence",
    );
  }
  if (!roleSmokeThumbZoneEvidenceComplete(roleSmoke)) {
    failures.push(
      "roleSmoke.roles missing tablet thumb-zone geometry evidence",
    );
  }
  if (!playerBrowserPostEvidenceComplete(roleSmoke)) {
    failures.push("roleSmoke.roles[player] missing SubmitPost browser ACK evidence");
  }
  if (!playerBrowserMediaEvidenceComplete(roleSmoke)) {
    failures.push("roleSmoke.roles[player] missing tablet-media browser request evidence");
  }
  if (!playerPrivateChannelBrowserPostEvidenceComplete(roleSmoke)) {
    failures.push(
      "roleSmoke.playerPrivateChannel missing role-pm SubmitPost browser ACK evidence",
    );
  }
  if (!moderatorBrowserSlotLifecycleEvidenceComplete(roleSmoke)) {
    failures.push(
      "roleSmoke.roles[moderator] missing SetSlotStatus browser ACK evidence",
    );
  }
  return failures;
}

function includesAll(actual, expected) {
  if (!Array.isArray(actual)) {
    return false;
  }
  const values = new Set(actual);
  return expected.every((value) => values.has(value));
}

function noBindFailureReasons(renderSmoke) {
  const failures = [];
  if (renderSmoke.status !== "passed") {
    failures.push(`renderSmoke.status is ${String(renderSmoke.status)}, expected passed`);
  }
  const viewportCount = renderSmoke.viewports?.length ?? 0;
  if (viewportCount === 0) {
    failures.push("renderSmoke.viewports is empty or absent");
  }
  if (!Array.isArray(renderSmoke.surfaces) || renderSmoke.surfaces.length === 0) {
    failures.push("renderSmoke.surfaces is empty or absent");
  }
  if (!Array.isArray(renderSmoke.feedbackRails) || renderSmoke.feedbackRails.length === 0) {
    failures.push("renderSmoke.feedbackRails is empty or absent");
  }
  if ((renderSmoke.surfaces?.length ?? 0) < viewportCount * 7) {
    failures.push(
      `renderSmoke.surfaces has ${renderSmoke.surfaces?.length ?? 0}, expected at least ${viewportCount * 7}`,
    );
  }
  if ((renderSmoke.feedbackRails?.length ?? 0) < viewportCount * 3) {
    failures.push(
      `renderSmoke.feedbackRails has ${renderSmoke.feedbackRails?.length ?? 0}, expected at least ${viewportCount * 3}`,
    );
  }
  if ((renderSmoke.routeStates?.length ?? 0) === 0) {
    failures.push("renderSmoke.routeStates is empty or absent");
  }
  for (const entry of renderSmoke.surfaces ?? []) {
    if (entry.screenshotPixels === undefined) {
      failures.push(`renderSmoke.surfaces[${entry.id}] missing screenshotPixels`);
    }
  }
  for (const entry of renderSmoke.feedbackRails ?? []) {
    if (entry.screenshotPixels === undefined) {
      failures.push(`renderSmoke.feedbackRails[${entry.id}] missing screenshotPixels`);
    }
  }
  for (const entry of renderSmoke.routeStates ?? []) {
    if (entry.screenshotPixels === undefined) {
      failures.push(`renderSmoke.routeStates[${entry.id}] missing screenshotPixels`);
    }
  }
  if (!renderSmokeThumbZoneEvidenceComplete(renderSmoke)) {
    failures.push(
      "renderSmoke.surfaces missing tablet thumb-zone geometry evidence",
    );
  }
  return failures;
}

function noBindInteractionFailureReasons(noBindInteractions) {
  const failures = [];
  if (noBindInteractions.status !== "passed") {
    failures.push(
      `noBindInteractions.status is ${String(noBindInteractions.status)}, expected passed`,
    );
  }
  const viewportCount = noBindInteractions.viewports?.length ?? 0;
  if (viewportCount === 0) {
    failures.push("noBindInteractions.viewports is empty or absent");
  }
  for (const [role, scenarioIds] of Object.entries(noBindInteractionScenarioIds())) {
    const entries = noBindInteractions.interactions?.[role];
    if (!Array.isArray(entries) || entries.length === 0) {
      failures.push(`noBindInteractions.interactions[${role}] is empty or absent`);
      continue;
    }
    if (entries.length < viewportCount * scenarioIds.length) {
      failures.push(
        `noBindInteractions.interactions[${role}] has ${entries.length}, expected at least ${viewportCount * scenarioIds.length}`,
      );
    }
    const actualIds = new Set(entries.map((entry) => entry.id));
    for (const id of scenarioIds) {
      if (!actualIds.has(id)) {
        failures.push(`noBindInteractions.interactions[${role}] missing ${id}`);
      }
    }
    for (const entry of entries) {
      if (entry.clicked === undefined) {
        failures.push(`noBindInteractions.interactions[${role}] missing clicked`);
      }
      if (entry.activeElement === undefined) {
        failures.push(`noBindInteractions.interactions[${role}] missing activeElement`);
      }
      if (entry.targetBox === undefined) {
        failures.push(`noBindInteractions.interactions[${role}] missing targetBox`);
      }
    }
  }
  return failures;
}

function noBindKeyboardFailureReasons(keyboardTraversal) {
  const failures = [];
  if (keyboardTraversal.status !== "passed") {
    failures.push(
      `keyboardTraversal.status is ${String(keyboardTraversal.status)}, expected passed`,
    );
  }
  const viewportCount = keyboardTraversal.viewports?.length ?? 0;
  if (viewportCount === 0) {
    failures.push("keyboardTraversal.viewports is empty or absent");
  }
  const surfaceIds = new Set(
    (keyboardTraversal.surfaces ?? []).map((entry) => entry.id),
  );
  for (const id of ["board", "admin", "player", "moderator"]) {
    if (!surfaceIds.has(id)) {
      failures.push(`keyboardTraversal.surfaces missing ${id}`);
    }
  }
  if ((keyboardTraversal.surfaces?.length ?? 0) < viewportCount * 4) {
    failures.push(
      `keyboardTraversal.surfaces has ${keyboardTraversal.surfaces?.length ?? 0}, expected at least ${viewportCount * 4}`,
    );
  }
  if ((keyboardTraversal.routeStates?.length ?? 0) === 0) {
    failures.push("keyboardTraversal.routeStates is empty or absent");
  }
  for (const entry of [
    ...(keyboardTraversal.surfaces ?? []),
    ...(keyboardTraversal.routeStates ?? []),
  ]) {
    if (!Array.isArray(entry.focusTraversal?.expectedOrder)) {
      failures.push(`keyboardTraversal[${entry.id}] missing expectedOrder`);
    }
    if (!Array.isArray(entry.focusTraversal?.sequence)) {
      failures.push(`keyboardTraversal[${entry.id}] missing sequence`);
    }
  }
  return failures;
}

function inAppBrowserRunFailureReasons(inAppBrowserRun) {
  const failures = [];
  if (inAppBrowserRun.status !== "passed") {
    failures.push(
      `inAppBrowserRun.status is ${String(inAppBrowserRun.status)}, expected passed`,
    );
  }
  const runs = inAppBrowserRun.runs ?? [];
  const viewportCount = inAppBrowserRun.viewports?.length ?? 0;
  if (viewportCount === 0) {
    failures.push("inAppBrowserRun.viewports is empty or absent");
  }
  if (runs.length < viewportCount) {
    failures.push(
      `inAppBrowserRun.runs has ${runs.length}, expected at least ${viewportCount}`,
    );
  }
  for (const run of runs) {
    const ids = new Set((run.interactions ?? []).map((entry) => entry.id));
    for (const id of inAppBrowserRunInteractionIds()) {
      if (!ids.has(id)) {
        failures.push(`inAppBrowserRun[${run.viewport?.name ?? "unknown"}] missing ${id}`);
      }
    }
    if (run.screenshotPixels === undefined) {
      failures.push(
        `inAppBrowserRun[${run.viewport?.name ?? "unknown"}] missing screenshotPixels`,
      );
    }
    for (const entry of run.interactions ?? []) {
      if (entry.clicked === undefined) {
        failures.push(`inAppBrowserRun[${entry.id}] missing clicked`);
      }
      if (entry.activeElement === undefined) {
        failures.push(`inAppBrowserRun[${entry.id}] missing activeElement`);
      }
      if (entry.targetBox === undefined) {
        failures.push(`inAppBrowserRun[${entry.id}] missing targetBox`);
      }
    }
    for (const id of moderatorCriticalConfirmationScenarioIds()) {
      const entry = (run.interactions ?? []).find((interaction) => interaction.id === id);
      if (!hasModeratorBrowserConfirmationEvidence(entry)) {
        failures.push(`inAppBrowserRun[${id}] missing moderator confirmation metadata`);
      }
    }
    const playerPrivateChannel = (run.interactions ?? []).find(
      (entry) => entry.id === "player-private-channel-submit-post-click",
    );
    if (playerPrivateChannel === undefined) {
      failures.push("inAppBrowserRun missing player private-channel proof");
    } else {
      if (playerPrivateChannel.route?.path !== "/g/midsummer/c/role-pm") {
        failures.push("inAppBrowserRun player private-channel path is not role-pm");
      }
      if (
        playerPrivateChannel.route?.activeChannelTestId !== "player-channel-role-pm" ||
        playerPrivateChannel.route?.activeChannelCurrent !== "page"
      ) {
        failures.push("inAppBrowserRun player private-channel active route is absent");
      }
      if (
        playerPrivateChannel.route?.privateReviewHref !==
        "/g/midsummer/c/role-pm?private=notification-1"
      ) {
        failures.push("inAppBrowserRun player private-channel review href is absent");
      }
    }
    const playerDisclosure = (run.interactions ?? []).find(
      (entry) => entry.id === "player-private-disclosure-vote-and-post",
    );
    if (playerDisclosure === undefined) {
      failures.push("inAppBrowserRun missing player private disclosure proof");
    } else {
      if (playerDisclosure.disclosureBefore?.ariaExpanded !== "false") {
        failures.push("inAppBrowserRun player disclosure before state is not collapsed");
      }
      if (playerDisclosure.disclosureAfter?.ariaExpanded !== "true") {
        failures.push("inAppBrowserRun player disclosure after state is not expanded");
      }
      if (playerDisclosure.disclosureAfter?.detailHidden !== false) {
        failures.push("inAppBrowserRun player disclosure detail did not become visible");
      }
    }
    const stabilityIds = new Set(
      (run.stabilityChecks ?? []).map((check) => check.id),
    );
    for (const check of inAppBrowserRun.plannedStabilityChecks ?? []) {
      if (!stabilityIds.has(check.id)) {
        failures.push(`inAppBrowserRun missing stability check ${check.id}`);
      }
    }
    for (const check of run.stabilityChecks ?? []) {
      if (check.mode !== "reserved-status-floor") {
        failures.push(`inAppBrowserRun[${check.id}] stability mode is not reserved-status-floor`);
      }
      if (check.statusFloorMinBlockSizePx !== 44) {
        failures.push(`inAppBrowserRun[${check.id}] status floor is not 44px`);
      }
      for (const tile of check.tiles ?? []) {
        if (tile.triggerPrecedesStatusFloor !== true) {
          failures.push(`inAppBrowserRun[${check.id}/${tile.id}] trigger is after status floor`);
        }
        if (
          tile.statusFloorBox === undefined ||
          tile.statusFloorBox.height < check.statusFloorMinBlockSizePx
        ) {
          failures.push(`inAppBrowserRun[${check.id}/${tile.id}] missing status floor geometry`);
        }
      }
    }
  }
  return failures;
}

async function readArtifact(relativePath) {
  return JSON.parse(await readFile(path.join(repoRoot, relativePath), "utf8"));
}

function renderConsole(summary) {
  const lines = [
    "Frontend readiness summary",
    `overall: ${summary.overall.state}`,
    "role | model/SSR/DOM | static focusability | route live | no-bind keyboard | no-bind interactions | no-bind Chromium | localhost browser",
  ];
  for (const role of summary.roles) {
    lines.push(
      `${role.id} | ${role.readiness} | ${role.surfaces.staticFocusability} | ${role.surfaces.routeLive} | ${role.surfaces.noBindKeyboard} | ${role.surfaces.noBindInteraction} | ${role.surfaces.noBindChromium} | ${role.surfaces.localhostBrowser}`,
    );
  }
  lines.push(
    `single root shell | ${summary.shared.singleRootShell.requirement.state}`,
  );
  lines.push(
    `browser acceptance | ${summary.browserAcceptance.requirement.state} | n/a | n/a | ${summary.browserAcceptance.noBindKeyboard.status} | ${summary.browserAcceptance.noBindInteractions.status} | ${summary.browserAcceptance.noBindChromium.status} | ${summary.browserAcceptance.localhost.status}`,
  );
  lines.push(
    `in-app file fixture | ${summary.browserAcceptance.inAppBrowserFixture.status}`,
  );
  lines.push(
    `in-app file browser-run | ${summary.browserAcceptance.inAppBrowserRun.status}`,
  );
  lines.push(
    `in-app localhost browser-run | ${summary.browserAcceptance.inAppBrowserLocalhostRun.status}`,
  );
  lines.push(
    `in-app imported browser-run | ${summary.browserAcceptance.inAppBrowserImportedRun.status}`,
  );
  lines.push(
    `imported role smoke | ${summary.browserAcceptance.importedRoleSmoke.status}`,
  );
  return lines.join("\n");
}

function renderMarkdown(summary) {
  const rows = summary.roles
    .map((role) =>
      [
        role.label,
        role.readiness,
        role.surfaces.staticFocusability,
        role.surfaces.routeLive,
        role.surfaces.noBindKeyboard,
        role.surfaces.noBindInteraction,
        role.surfaces.noBindChromium,
        role.surfaces.localhostBrowser,
        role.evidence.feedback.statusTestId,
      ].join(" | "),
    )
    .join("\n");
  return [
    "# Frontend Readiness Summary",
    "",
    `Overall: \`${summary.overall.state}\``,
    "",
    "| Surface | Model/SSR/DOM | Static focusability | Route live | No-bind keyboard | No-bind interactions | No-bind Chromium | Localhost browser | Feedback status proof |",
    "|---|---|---|---|---|---|---|---|---|",
    rows,
    "",
    "## Browser Acceptance",
    "",
    `- Localhost: \`${summary.browserAcceptance.localhost.status}\``,
    `- No-bind keyboard: \`${summary.browserAcceptance.noBindKeyboard.status}\``,
    `- No-bind interactions: \`${summary.browserAcceptance.noBindInteractions.status}\``,
    `- No-bind Chromium: \`${summary.browserAcceptance.noBindChromium.status}\``,
    `- In-app file fixture: \`${summary.browserAcceptance.inAppBrowserFixture.status}\``,
    `- In-app file browser-run: \`${summary.browserAcceptance.inAppBrowserRun.status}\``,
    `- In-app localhost browser-run: \`${summary.browserAcceptance.inAppBrowserLocalhostRun.status}\``,
    `- In-app imported browser-run: \`${summary.browserAcceptance.inAppBrowserImportedRun.status}\``,
    `- Imported role smoke: \`${summary.browserAcceptance.importedRoleSmoke.status}\``,
    "",
    "## Shared Proof",
    "",
    `- Single root shell: \`${summary.shared.singleRootShell.requirement.state}\` (${summary.shared.singleRootShell.surfaceShellCounts.length} first-view surfaces, ${summary.shared.singleRootShell.routeStateShellCounts.length} route-state surfaces)`,
    `- Tablet interaction posture: \`${summary.shared.tabletInteraction.requirement.state}\` (${summary.shared.tabletInteraction.scannedFileCount} files scanned, ${summary.shared.tabletInteraction.forbiddenMatchCount} forbidden interaction matches, ${summary.shared.tabletInteraction.thumbZoneRoles.length} thumb-zone roles)`,
    `- Route states: \`${summary.shared.routeStates.state}\``,
    `- Route error shell: \`${summary.shared.routeError.requirement.state}\` at \`${summary.shared.routeError.path}\` with \`${summary.shared.routeError.capabilitySummary}\``,
    "",
    "## Promotion Failures",
    "",
    ...summary.roles.flatMap((role) => [
      `### ${role.label}`,
      "",
      ...role.promotionFailures.map((failure) => `- ${failure}`),
      "",
    ]),
    "",
    "## Sources",
    "",
    ...Object.entries(summary.generatedFrom).map(([key, source]) => `- ${key}: \`${source}\``),
  ].join("\n");
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
      path: "/g/midsummer/c/role-pm",
      status: 403,
      surface: "player",
      surfaceTestId: "route-error-surface",
      panelTestId: "route-error-panel",
      actionTestId: "route-error-action",
      actionHref: "/",
      activeNavTestId: "role-nav-player",
      sessionPrincipal: "player_mira",
      capabilitySummary: "ChannelMember + SlotOccupant",
      message: "Channel role-pm is not visible.",
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
