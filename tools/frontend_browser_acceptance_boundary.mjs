import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = path.join(repoRoot, "target", "frontend-browser-acceptance-boundary");
const evidencePath = path.join(artifactDir, "browser-acceptance-boundary.json");

const sources = {
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
};

const artifacts = Object.fromEntries(
  await Promise.all(
    Object.entries(sources).map(async ([key, source]) => [
      key,
      await readArtifact(source),
    ]),
  ),
);

assert.equal(
  [
    "passed",
    "static-dom-fallback-passed",
    "static-fallback-passed",
    "static-render-fallback-passed",
  ].includes(artifacts.roleSmoke.status),
  true,
);
assert.equal(
  ["passed", "chromium-launch-blocked"].includes(artifacts.renderSmoke.status),
  true,
);
assert.equal(
  ["passed", "chromium-launch-blocked"].includes(artifacts.noBindInteractions.status),
  true,
);
assert.equal(
  ["passed", "chromium-launch-blocked"].includes(artifacts.keyboardTraversal.status),
  true,
);
assert.equal(artifacts.inAppBrowserPage.status, "page-generated");
assert.equal(artifacts.inAppBrowserStaticDom.status, "passed");
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

const lanes = [
  localhostLane(artifacts.roleSmoke),
  noBindRenderLane(artifacts.renderSmoke),
  noBindInteractionLane(artifacts.noBindInteractions),
  noBindKeyboardLane(artifacts.keyboardTraversal),
  inAppStaticDomLane(artifacts.inAppBrowserStaticDom),
  inAppFileLane(artifacts.inAppBrowserPage),
  inAppFileBrowserRunLane(
    artifacts.inAppBrowserRun,
    artifacts.inAppBrowserImportedRun,
  ),
  inAppLocalhostBrowserRunLane(artifacts.inAppBrowserLocalhostRun),
  inAppImportedBrowserRunLane(artifacts.inAppBrowserImportedRun),
  importedRoleSmokeLane(artifacts.importedRoleSmoke),
];
const fullAppLane = lanes.find((lane) => lane.id === "localhost-dev-server-role-smoke");
const importedFullAppLane = lanes.find((lane) => lane.id === "imported-localhost-role-smoke");
const fullAppBrowserProven =
  fullAppLane?.status === "proven" || importedFullAppLane?.status === "proven";
const diagnosticBlockers = lanes
  .filter((lane) => lane.status !== "proven")
  .flatMap((lane) =>
    lane.missing.map((missing) => `${lane.id}: ${missing}`),
  );
const completionBlockers = fullAppBrowserProven
  ? []
  : fullAppLane?.missing.map((missing) => `${fullAppLane.id}: ${missing}`) ?? [
      "localhost-dev-server-role-smoke: full app browser smoke is missing",
    ];

const boundary = {
  status: fullAppBrowserProven ? "passed" : "incomplete",
  proof: "frontend-browser-acceptance-boundary",
  generatedFrom: sources,
  boundary:
    "Generated browser acceptance boundary over the current frontend proof artifacts. It distinguishes proven browser evidence from blocked or prepared-only lanes, and does not promote model/SSR/DOM evidence to hydrated browser acceptance.",
  promotionRule:
    "Full app browser acceptance is proven by the localhost dev-server role smoke, either run locally or imported through the role-smoke import contract, when it passes with board, setup, admin, player, moderator, forbidden-route, and route-state screenshots, screenshot pixel evidence, setup workbench geometry for /g/midsummer/setup, overlap-checked target evidence, tablet thumb-zone geometry evidence, admin session-grant/recovery-gate form evidence, player main-thread SubmitPost ACK refresh evidence, player role-pm SubmitPost ACK evidence, player tablet-media browser request evidence, and moderator SetSlotStatus projection evidence. Passed file-backed or localhost-served fixture browser-runs promote their fixture lanes only; prepared fixtures, bind blocks, and Chromium launch blocks do not promote full app acceptance.",
  lanes,
  overall: {
    state: fullAppBrowserProven ? "browser_proven" : "not_complete",
    blockers: completionBlockers,
    diagnosticBlockers,
  },
};

await mkdir(artifactDir, { recursive: true });
await writeFile(evidencePath, `${JSON.stringify(boundary, null, 2)}\n`);
console.log(`wrote ${path.relative(repoRoot, evidencePath)}`);

function localhostLane(roleSmoke) {
  const proven = browserRoleSmokeEvidenceComplete(roleSmoke);
  return {
    id: "localhost-dev-server-role-smoke",
    label: "Localhost dev-server Playwright role smoke",
    artifact: sources.roleSmoke,
    artifactStatus: roleSmoke.status,
    status: proven ? "proven" : "blocked",
    attemptKind: "npm-script",
    promotionEligible: true,
    evidence: proven
      ? [
          "roleSmoke.status == passed",
          "roleSmoke.roles includes admin/player/moderator screenshot pixel evidence",
          "roleSmoke.setup includes /g/midsummer/setup workbench geometry evidence",
          "roleSmoke admin/player/moderator entries include tablet thumb-zone geometry evidence",
          "roleSmoke admin entries include session-grant/recovery-gate form evidence",
          "roleSmoke player entries include SubmitPost ACK and refreshed thread evidence",
          "roleSmoke playerPrivateChannel entries include role-pm SubmitPost ACK evidence",
          "roleSmoke player entries include tablet-media browser request evidence without original/full/desktop URLs",
          "roleSmoke moderator entries include SetSlotStatus ACK and refreshed slot lifecycle evidence",
          "roleSmoke.board and roleSmoke.routeStates are nonempty",
        ]
      : [],
    missing: proven
      ? []
      : [
          "localhost bind is denied before dev-server browser proof can run",
          "admin/player/moderator browser screenshots are absent",
          "setup workbench browser geometry evidence is absent",
          "board and route-state browser screenshots are absent",
          "admin/player/moderator tablet thumb-zone geometry evidence is absent",
          "admin session-grant/recovery-gate browser form evidence is absent",
          "player role-pm SubmitPost browser ACK evidence is absent",
          "player tablet-media browser request evidence is absent",
        ],
  };
}

function noBindRenderLane(renderSmoke) {
  const proven = noBindRenderEvidenceComplete(renderSmoke);
  return {
    id: "chromium-no-bind-render",
    label: "No-bind Chromium SSR render smoke",
    artifact: sources.renderSmoke,
    artifactStatus: renderSmoke.status,
    status: proven ? "proven" : "blocked",
    attemptKind: "npm-script",
    promotionEligible: false,
    evidence: proven
      ? [
          "renderSmoke.status == passed",
          "surface, feedback rail, route-state, and tablet thumb-zone screenshot geometry evidence exists",
        ]
      : [],
    missing: proven
      ? []
      : [
          "Chromium launch is denied before no-bind screenshots or geometry can run",
        ],
  };
}

function noBindInteractionLane(noBindInteractions) {
  const proven = noBindInteractionEvidenceComplete(noBindInteractions);
  return {
    id: "chromium-no-bind-interactions",
    label: "No-bind Chromium command click/focus smoke",
    artifact: sources.noBindInteractions,
    artifactStatus: noBindInteractions.status,
    status: proven ? "proven" : "blocked",
    attemptKind: "npm-script",
    promotionEligible: false,
    evidence: proven
      ? [
          "noBindInteractions.status == passed",
          "admin cohost/session-grant/recovery-gate, player vote/post/private-channel post, and moderator clicked target and activeElement evidence exists",
        ]
      : [],
    missing: proven
      ? []
      : [
          "Chromium launch is denied before no-bind click/focus interactions can run",
        ],
  };
}

function noBindKeyboardLane(keyboardTraversal) {
  const proven = noBindKeyboardEvidenceComplete(keyboardTraversal);
  return {
    id: "chromium-no-bind-keyboard",
    label: "No-bind Chromium keyboard traversal smoke",
    artifact: sources.keyboardTraversal,
    artifactStatus: keyboardTraversal.status,
    status: proven ? "proven" : "blocked",
    attemptKind: "npm-script",
    promotionEligible: false,
    evidence: proven
      ? [
          "keyboardTraversal.status == passed",
          "board/admin/player/moderator and route-state Tab traversal evidence exists",
        ]
      : [],
    missing: proven
      ? []
      : [
          "Chromium launch is denied before no-bind keyboard traversal can run",
        ],
  };
}

function inAppFileLane(inAppBrowserPage) {
  const prepared = inAppBrowserFixtureComplete(inAppBrowserPage);
  return {
    id: "in-app-file-backed-fixture",
    label: "File-backed in-app browser fixture",
    artifact: sources.inAppBrowserPage,
    artifactStatus: inAppBrowserPage.status,
    status: prepared ? "fixture_prepared" : "incomplete",
    attemptKind: "generated-fixture",
    promotionEligible: false,
    evidence: prepared
      ? [
          "inAppBrowserPage.status == page-generated",
          "first-viewport board/admin/player/moderator shells are present",
          "admin cohost/session-grant/recovery-gate, player main/private-channel, and all 9 moderator critical host confirmation controls are present",
          "hydrated-surface admin operational forms, player, moderator host-prompt, and slot-lifecycle scenario controls are present",
        ]
      : [],
    missing: [
      "generated fixture has not produced browser click/focus/screenshot evidence",
      "file-backed fixture does not prove Svelte hydration, command dispatch side effects, TCP transport, WebSocket delivery, or dev-server routing",
    ],
    page: inAppBrowserPage.page,
    pageUrl: inAppBrowserPage.pageUrl,
  };
}

function inAppStaticDomLane(inAppBrowserStaticDom) {
  const proven = inAppBrowserStaticDomEvidenceComplete(inAppBrowserStaticDom);
  return {
    id: "in-app-file-static-dom",
    label: "File-backed in-app browser fixture static DOM",
    artifact: sources.inAppBrowserStaticDom,
    artifactStatus: inAppBrowserStaticDom.status,
    status: proven ? "proven" : "incomplete",
    attemptKind: "no-browser-static-dom",
    promotionEligible: false,
    evidence: proven
      ? [
          "inAppBrowserStaticDom.status == passed",
          "fixture HTML contains every manifest command target inside its scenario root",
          "player private-channel fixture root records active role-pm route evidence without host operational leakage",
          "hydrated-surface fixture controls exist inside their scenario roots",
        ]
      : [],
    missing: proven
      ? []
      : [
          "file-backed fixture static DOM contract is missing or incomplete",
        ],
  };
}

function inAppFileBrowserRunLane(inAppBrowserRun, inAppBrowserImportedRun) {
  const directProven = inAppBrowserRunEvidenceComplete(inAppBrowserRun);
  const importedProven = inAppBrowserImportedRunEvidenceComplete(
    inAppBrowserImportedRun,
  );
  const proven = directProven || importedProven;
  return {
    id: "in-app-file-browser-run",
    label: "File-backed in-app browser fixture run",
    artifact: sources.inAppBrowserRun,
    artifactStatus: inAppBrowserRun.status,
    importedArtifact: sources.inAppBrowserImportedRun,
    importedArtifactStatus: inAppBrowserImportedRun.status,
    status: proven ? "proven" : "blocked",
    attemptKind: "file-url-browser-smoke",
    promotionEligible: true,
    evidence: proven
      ? directProven
        ? [
          "inAppBrowserRun.status == passed",
          "fixture file URL loaded in Chromium for every proof viewport",
          "admin cohost/session-grant/recovery-gate, player main/private-channel, route-error, all 9 moderator critical host confirmations, and hydrated-surface controls recorded click/focus evidence",
          "moderator critical host confirmation records include alertdialog focus metadata and object/outcome text",
          "fixture screenshots include nonblank pixel evidence",
        ]
        : [
          "inAppBrowserImportedRun.status == imported-passed",
          "imported browser-run artifact was validated without relaunching Chromium",
          "imported browser-run includes every proof viewport and all 21 planned interactions",
          "all 9 moderator critical host confirmation records include alertdialog focus metadata and object/outcome text",
          "referenced fixture screenshots were re-read as PNGs and matched nonblank pixel evidence",
        ]
      : [],
    missing: proven
      ? []
      : [
          "file-backed fixture has not produced browser click/focus/screenshot evidence",
          "no imported passed browser-run artifact has been validated",
          "file-backed fixture run does not prove Svelte hydration, command dispatch side effects, TCP transport, WebSocket delivery, dev-server routing, or localhost app acceptance",
        ],
    pageUrl: inAppBrowserRun.pageUrl,
  };
}

function inAppLocalhostBrowserRunLane(inAppBrowserLocalhostRun) {
  const proven = inAppBrowserRunEvidenceComplete(inAppBrowserLocalhostRun);
  return {
    id: "in-app-localhost-fixture-browser-run",
    label: "Localhost-served in-app browser fixture run",
    artifact: sources.inAppBrowserLocalhostRun,
    artifactStatus: inAppBrowserLocalhostRun.status,
    status: proven ? "proven" : "blocked",
    attemptKind: "localhost-fixture-browser-smoke",
    promotionEligible: true,
    evidence: proven
      ? [
          "inAppBrowserLocalhostRun.status == passed",
          "fixture loaded from localhost for every proof viewport",
          "admin cohost/session-grant/recovery-gate, player main/private-channel, route-error, all 9 moderator critical host confirmations, and hydrated-surface controls recorded click/focus evidence",
          "moderator critical host confirmation records include alertdialog focus metadata and object/outcome text",
          "fixture screenshots include nonblank pixel evidence",
        ]
      : [],
    missing: proven
      ? []
      : [
          "localhost-served fixture has not produced browser click/focus/screenshot evidence",
          "localhost fixture server bind or Chromium launch is blocked in this sandbox",
          "localhost-served fixture run does not prove Svelte hydration, command dispatch side effects, dev-server routing, TCP transport, WebSocket delivery, or full localhost app acceptance",
        ],
    pageUrl: inAppBrowserLocalhostRun.pageUrl,
    sourcePageUrl: inAppBrowserLocalhostRun.sourcePageUrl,
  };
}

function inAppImportedBrowserRunLane(inAppBrowserImportedRun) {
  const proven = inAppBrowserImportedRunEvidenceComplete(inAppBrowserImportedRun);
  return {
    id: "in-app-file-imported-browser-run",
    label: "Imported file-backed in-app browser fixture run",
    artifact: sources.inAppBrowserImportedRun,
    artifactStatus: inAppBrowserImportedRun.status,
    status: proven ? "proven" : "blocked",
    attemptKind: "external-browser-run-import",
    promotionEligible: true,
    evidence: proven
      ? [
          "inAppBrowserImportedRun.status == imported-passed",
          "source browser-run evidence was validated without launching Chromium locally",
          "imported browser-run includes every proof viewport and all 21 planned interactions",
          "imported browser-run includes 2 reserved status-floor checks covering 13 admin/moderator action tiles",
          "referenced fixture screenshots were re-read as PNGs and matched nonblank pixel evidence",
        ]
      : [],
    missing: proven
      ? []
      : [
          "no imported passed browser-run artifact has been validated",
          "external browser-run import requires a returned fixture replay bundle or browser-run.json with status passed",
        ],
    sourceBrowserRun: inAppBrowserImportedRun.sourceBrowserRun ?? null,
    validated: inAppBrowserImportedRun.validated ?? null,
  };
}

function importedRoleSmokeLane(importedRoleSmoke) {
  const proven = importedRoleSmokeEvidenceComplete(importedRoleSmoke);
  return {
    id: "imported-localhost-role-smoke",
    label: "Imported localhost dev-server role smoke",
    artifact: sources.importedRoleSmoke,
    artifactStatus: importedRoleSmoke.status,
    status: proven ? "proven" : "blocked",
    attemptKind: "external-full-app-browser-smoke-import",
    promotionEligible: true,
    evidence: proven
      ? [
          "importedRoleSmoke.status == imported-passed",
          "imported role-smoke evidence was validated without relaunching Chromium locally",
          "imported role-smoke includes board/admin/player/moderator, forbidden-route, and route-state screenshots",
          "imported role-smoke includes admin session-grant/recovery-gate, player SubmitPost/private-channel/media, and moderator SetSlotStatus evidence",
          "referenced role-smoke screenshots were re-read as PNGs and matched nonblank pixel evidence",
        ]
      : [],
    missing: proven
      ? []
      : [
          "no imported passed localhost role-smoke artifact has been validated",
          "external role-smoke import requires role-smoke.json with status passed plus referenced screenshots",
        ],
    sourceRoleSmoke: importedRoleSmoke.sourceRoleSmoke ?? null,
    validated: importedRoleSmoke.validated ?? null,
  };
}

function browserRoleSmokeEvidenceComplete(roleSmoke) {
  if (roleSmoke.status !== "passed") {
    return false;
  }
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
  if (renderSmoke.status !== "passed" || viewportCount === 0) {
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
  if (noBindInteractions.status !== "passed" || viewportCount === 0) {
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
    moderator: moderatorCriticalConfirmationScenarioIds(),
  };
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

function noBindKeyboardEvidenceComplete(keyboardTraversal) {
  const viewportCount = keyboardTraversal.viewports?.length ?? 0;
  if (keyboardTraversal.status !== "passed" || viewportCount === 0) {
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
  for (const id of [
    "admin-cohost-confirm-click",
    "admin-session-grant-confirm-click",
    "admin-recovery-gate-confirm-click",
    "player-submit-vote-click",
    "player-submit-post-click",
    "player-private-channel-submit-post-click",
    ...moderatorCriticalConfirmationScenarioIds(),
  ]) {
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
    typeof inAppBrowserPage.pageUrl === "string"
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
    for (const id of [
      "admin-cohost-confirm-click",
      "admin-session-grant-confirm-click",
      "admin-recovery-gate-confirm-click",
      "player-submit-vote-click",
      "player-submit-post-click",
      "player-private-channel-submit-post-click",
      "route-error-back-to-board-click",
      ...moderatorCriticalConfirmationScenarioIds(),
      "admin-audit-native-flow",
      "admin-operational-forms",
      "player-private-disclosure-vote-and-post",
      "moderator-host-prompt-confirmation",
      "moderator-slot-lifecycle-confirmation",
    ]) {
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
    const routeError = (run.interactions ?? []).find(
      (entry) => entry.id === "route-error-back-to-board-click",
    );
    if (
      routeError?.errorSurface?.path !== "/g/midsummer/c/role-pm" ||
      routeError.errorSurface.status !== 403 ||
      routeError.errorSurface.actionHref !== "/" ||
      routeError.errorSurface.activeNavCurrent !== "page"
    ) {
      return false;
    }
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
  return (
    inAppBrowserImportedRun.status === "imported-passed" &&
    inAppBrowserImportedRun.promotionEligible === true &&
    inAppBrowserImportedRun.validated?.viewportCount > 0 &&
    inAppBrowserImportedRun.validated.runCount >=
      inAppBrowserImportedRun.validated.viewportCount &&
    inAppBrowserImportedRun.validated.plannedInteractionCount === 21 &&
    inAppBrowserImportedRun.validated.plannedStabilityCheckCount === 2 &&
    inAppBrowserImportedRun.validated.stabilityCheckTileCount >= 13 &&
    inAppBrowserImportedRun.validated.moderatorCriticalConfirmationCount === 9 &&
    (inAppBrowserImportedRun.validated.screenshotChecks?.length ?? 0) >=
      inAppBrowserImportedRun.validated.viewportCount
  );
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

function includesAll(actual, expected) {
  if (!Array.isArray(actual)) {
    return false;
  }
  const values = new Set(actual);
  return expected.every((value) => values.has(value));
}

async function readArtifact(relativePath) {
  return JSON.parse(await readFile(path.join(repoRoot, relativePath), "utf8"));
}
