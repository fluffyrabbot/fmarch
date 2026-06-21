import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzePngScreenshot } from "./frontend_screenshot_pixels.mjs";
import {
  boardScenario,
  forbiddenRoutes,
  routeStateScenarios,
  roles,
  viewports,
} from "./frontend_role_smoke_scenarios.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = path.join(repoRoot, "target", "frontend-role-smoke-imported");
const evidencePath = path.join(artifactDir, "imported-role-smoke.json");
const defaultSource = path.join(repoRoot, "target", "frontend-role-smoke", "role-smoke.json");
const sourceRoleSmoke = sourcePathFromArgs();
const importedRoot = importedRootFromSource(sourceRoleSmoke);
const roleSmoke = await readJson(sourceRoleSmoke);

assert.equal(
  [
    "passed",
    "static-dom-fallback-passed",
    "static-fallback-passed",
    "static-render-fallback-passed",
  ].includes(roleSmoke.status),
  true,
);

const imported =
  roleSmoke.status === "passed"
    ? await importedPassedEvidence()
    : sourceBlockedEvidence();

await mkdir(artifactDir, { recursive: true });
await writeFile(evidencePath, `${JSON.stringify(imported, null, 2)}\n`);
console.log(`wrote ${path.relative(repoRoot, evidencePath)}`);

async function importedPassedEvidence() {
  assert.deepEqual(roleSmoke.viewports, viewports);
  assert.equal((roleSmoke.board ?? []).length, viewports.length);
  assert.equal((roleSmoke.routeStates ?? []).length, viewports.length * routeStateScenarios.length);
  assert.equal((roleSmoke.playerPrivateChannel ?? []).length, viewports.length);
  assertRoleEntries();
  assertForbiddenRoutes();
  assertRoleSmokeEvidenceComplete();

  const screenshotChecks = [];
  for (const entry of [
    ...(roleSmoke.board ?? []),
    ...(roleSmoke.roles ?? []),
    ...(roleSmoke.playerPrivateChannel ?? []),
    ...(roleSmoke.routeStates ?? []),
    ...(roleSmoke.forbidden ?? []),
  ]) {
    screenshotChecks.push(await validateScreenshot(entry));
  }

  return {
    status: "imported-passed",
    proof: "frontend-role-smoke-imported-contract",
    boundary:
      "Validates a passed localhost dev-server role-smoke artifact without binding localhost or launching Chromium locally. It rechecks board/admin/player/moderator, forbidden-route, and route-state screenshots; screenshot PNG pixels; focus traversal evidence; overlap-checked targets; tablet thumb-zone geometry; admin session-grant/recovery-gate form evidence; player main-thread and role-PM SubmitPost ACK evidence; player tablet-media request evidence; and moderator SetSlotStatus lifecycle evidence. It does not prove that the imported artifact was produced by this exact checkout unless the operator imports evidence from a matching commit.",
    generatedFrom: {
      sourceRoleSmoke: relativeOrAbsolute(sourceRoleSmoke),
    },
    sourceRoleSmoke: sourceSummary(),
    promotionEligible: true,
    validated: {
      viewportCount: roleSmoke.viewports.length,
      boardCount: roleSmoke.board.length,
      roleCount: roleSmoke.roles.length,
      playerPrivateChannelCount: roleSmoke.playerPrivateChannel.length,
      routeStateCount: roleSmoke.routeStates.length,
      forbiddenRouteCount: roleSmoke.forbidden?.length ?? 0,
      screenshotCheckCount: screenshotChecks.length,
      screenshotChecks,
    },
    blocking: [],
  };
}

function sourceBlockedEvidence() {
  return {
    status: "source-blocked",
    proof: "frontend-role-smoke-imported-contract",
    boundary:
      "The selected localhost dev-server role-smoke artifact is not passed, so no imported full-app browser evidence was promoted. This preserves the source status and fallback boundary for a later Chromium-capable role-smoke run.",
    generatedFrom: {
      sourceRoleSmoke: relativeOrAbsolute(sourceRoleSmoke),
    },
    sourceRoleSmoke: sourceSummary(),
    promotionEligible: false,
    validated: {
      viewportCount: 0,
      boardCount: 0,
      roleCount: 0,
      playerPrivateChannelCount: 0,
      routeStateCount: 0,
      forbiddenRouteCount: 0,
      screenshotCheckCount: 0,
      screenshotChecks: [],
    },
    blocking: [
      `source role-smoke status is ${roleSmoke.status}, expected passed`,
      "Run npm run test:frontend-role-smoke in a Chromium-capable environment, then import target/frontend-role-smoke/role-smoke.json plus its referenced screenshots.",
    ],
  };
}

function assertRoleEntries() {
  const roleIds = new Set((roleSmoke.roles ?? []).map((entry) => entry.role));
  assert.deepEqual([...roleIds].sort(), roles.map((role) => role.id).sort());
  for (const role of roles) {
    const entries = roleSmoke.roles.filter((entry) => entry.role === role.id);
    assert.equal(entries.length, viewports.length);
    for (const entry of entries) {
      assert.equal(entry.path, role.path);
      assert.equal(entry.overlapCheckedTargets > 0, true);
      assert.equal(Array.isArray(entry.focusTraversal?.focusedTestIds), true);
    }
  }
}

function assertForbiddenRoutes() {
  const entries = roleSmoke.forbidden ?? [];
  assert.equal(entries.length, viewports.length * forbiddenRoutes.length);
  const expectedIds = new Set(forbiddenRoutes.map((route) => route.id));
  for (const entry of entries) {
    assert.equal(expectedIds.has(entry.scenario), true);
    assert.equal(entry.role, "forbidden");
    assert.equal(entry.overlapCheckedTargets > 0, true);
  }
}

function assertRoleSmokeEvidenceComplete() {
  assert.equal(browserRoleSmokeEvidenceComplete(roleSmoke), true);
}

async function validateScreenshot(entry) {
  assert.equal(typeof entry.screenshot, "string");
  assert.notEqual(entry.screenshotPixels, undefined);
  const screenshotPath = resolveImportedPath(entry.screenshot);
  const png = await readFile(screenshotPath);
  const pixels = analyzePngScreenshot(
    png,
    `imported role smoke ${entry.role ?? entry.scenario ?? "surface"}`,
  );
  assert.deepEqual(pixels, entry.screenshotPixels);
  assert.equal(pixels.width, entry.viewport.width);
  assert.equal(pixels.height >= entry.viewport.height, true);
  assert.equal(pixels.uniqueColorBuckets >= 8, true);
  assert.equal(pixels.changedPixelRatio >= 0.005, true);
  return {
    viewport: entry.viewport.name,
    screenshot: path.relative(repoRoot, screenshotPath),
    screenshotPixels: pixels,
  };
}

function browserRoleSmokeEvidenceComplete(smoke) {
  if (smoke.status !== "passed") {
    return false;
  }
  const roleIds = new Set((smoke.roles ?? []).map((entry) => entry.role));
  for (const id of ["admin", "player", "moderator"]) {
    if (!roleIds.has(id)) {
      return false;
    }
  }
  return (
    Array.isArray(smoke.board) &&
    smoke.board.length > 0 &&
    Array.isArray(smoke.routeStates) &&
    smoke.routeStates.length > 0 &&
    (smoke.roles ?? []).every((entry) => entry.screenshotPixels !== undefined) &&
    roleSmokeThumbZoneEvidenceComplete(smoke) &&
    adminBrowserOperationalEvidenceComplete(smoke) &&
    playerBrowserPostEvidenceComplete(smoke) &&
    playerPrivateChannelBrowserPostEvidenceComplete(smoke) &&
    playerBrowserMediaEvidenceComplete(smoke) &&
    moderatorBrowserSlotLifecycleEvidenceComplete(smoke)
  );
}

function roleSmokeThumbZoneEvidenceComplete(smoke) {
  const viewportCount = smoke.viewports?.length ?? 0;
  if (viewportCount === 0) {
    return false;
  }
  return expectedThumbZoneCounts().every(({ role, zones }) => {
    const entries = (smoke.roles ?? []).filter((entry) => entry.role === role);
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
    { role: "player", zones: [["player-primary-action-zone", 3]] },
    { role: "moderator", zones: [["moderator-primary-action-zone", 10]] },
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

function adminBrowserOperationalEvidenceComplete(smoke) {
  const viewportCount = smoke.viewports?.length ?? 0;
  const adminEntries = (smoke.roles ?? []).filter((entry) => entry.role === "admin");
  if (viewportCount === 0 || adminEntries.length < viewportCount) {
    return false;
  }
  return adminEntries.every((entry) =>
    entry.commandResult?.sessionGrant?.focus?.initialFocus?.testId ===
      "admin-command-confirm-session-grants" &&
    entry.commandResult?.sessionGrant?.form?.action === "?/grantSession" &&
    includesAll(entry.commandResult?.sessionGrant?.form?.fieldTestIds, [
      "admin-session-grant-token",
      "admin-session-grant-principal",
      "admin-session-grant-expires-at",
      "admin-session-grant-global-mod",
    ]) &&
    entry.commandResult?.recovery?.state === "ack" &&
    entry.commandResult?.recovery?.focus?.initialFocus?.testId ===
      "admin-recovery-confirm-recovery-gate" &&
    entry.commandResult?.recovery?.form?.action === "?/checkRecoveryGate" &&
    includesAll(entry.commandResult?.recovery?.form?.fieldNames, [
      "game",
      "principalUserId",
    ]) &&
    entry.commandResult?.activity?.acknowledged?.state === "ack",
  );
}

function playerBrowserPostEvidenceComplete(smoke) {
  const viewportCount = smoke.viewports?.length ?? 0;
  const playerEntries = (smoke.roles ?? []).filter((entry) => entry.role === "player");
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

function playerPrivateChannelBrowserPostEvidenceComplete(smoke) {
  const viewportCount = smoke.viewports?.length ?? 0;
  const entries = smoke.playerPrivateChannel ?? [];
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

function playerBrowserMediaEvidenceComplete(smoke) {
  const viewportCount = smoke.viewports?.length ?? 0;
  const playerEntries = (smoke.roles ?? []).filter((entry) => entry.role === "player");
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

function moderatorBrowserSlotLifecycleEvidenceComplete(smoke) {
  const viewportCount = smoke.viewports?.length ?? 0;
  const moderatorEntries = (smoke.roles ?? []).filter(
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
  return expected.every((entry) => actual.includes(entry));
}

function resolveImportedPath(candidate) {
  if (path.isAbsolute(candidate)) {
    return candidate;
  }
  const importedRelative = path.join(importedRoot, candidate);
  return path.isAbsolute(importedRelative)
    ? importedRelative
    : path.join(repoRoot, importedRelative);
}

function importedRootFromSource(source) {
  const dir = path.dirname(source);
  if (path.basename(dir) === "frontend-role-smoke") {
    return path.dirname(path.dirname(dir));
  }
  return repoRoot;
}

function sourceSummary() {
  return {
    path: relativeOrAbsolute(sourceRoleSmoke),
    status: roleSmoke.status,
    boundary: roleSmoke.boundary ?? null,
    viewportCount: roleSmoke.viewports?.length ?? 0,
    boardCount: roleSmoke.board?.length ?? 0,
    roleCount: roleSmoke.roles?.length ?? 0,
    routeStateCount: roleSmoke.routeStates?.length ?? 0,
  };
}

function sourcePathFromArgs() {
  const arg = process.argv.find((item) => item.startsWith("--source="));
  const raw =
    arg?.slice("--source=".length) ??
    process.env.FMARCH_ROLE_SMOKE_IMPORT ??
    defaultSource;
  return path.resolve(repoRoot, raw);
}

function relativeOrAbsolute(candidate) {
  return candidate.startsWith(repoRoot)
    ? path.relative(repoRoot, candidate)
    : candidate;
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}
