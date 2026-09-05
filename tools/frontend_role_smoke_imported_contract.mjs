import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzePngScreenshot } from "./frontend_screenshot_pixels.mjs";
import {
  browserRoleScenario,
  forbiddenRoutes,
  routeStateScenarios,
  roles,
  setupViewports,
  viewports,
} from "./frontend_role_smoke_scenarios.mjs";
import {
  assertHostSetupWorkflowEvidence,
} from "./frontend_host_setup_proof_contract.mjs";
import {
  assertBrowserRoleSmokeEvidence,
} from "./frontend_role_smoke_evidence_contract.mjs";

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
  assert.equal((roleSmoke.setup ?? []).length, setupViewports.length);
  assert.equal((roleSmoke.routeStates ?? []).length, viewports.length * routeStateScenarios.length);
  assert.equal((roleSmoke.playerPrivateChannel ?? []).length, viewports.length);
  assertHostSetupWorkflowEvidence(roleSmoke.setup);
  assertRoleEntries();
  assertForbiddenRoutes();
  assertRoleSmokeEvidenceComplete();

  const screenshotChecks = [];
  for (const entry of [
    ...(roleSmoke.board ?? []),
    ...(roleSmoke.setup ?? []),
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
      "Validates a passed localhost dev-server role-smoke artifact without binding localhost or launching Chromium locally. It rechecks board/admin/player/moderator/setup, forbidden-route, and route-state screenshots; screenshot PNG pixels; focus traversal evidence; overlap-checked targets; exact guided host-setup workflow geometry; live thumb-zone geometry; admin exception-inbox decision-canvas and native audit-detail navigation evidence; player main-thread and role-PM SubmitPost ACK evidence; player tablet-media request evidence; and moderator SetSlotStatus lifecycle evidence. It does not prove that the imported artifact was produced by this exact checkout unless the operator imports evidence from a matching commit.",
    generatedFrom: {
      sourceRoleSmoke: relativeOrAbsolute(sourceRoleSmoke),
    },
    sourceRoleSmoke: sourceSummary(),
    promotionEligible: true,
    validated: {
      viewportCount: roleSmoke.viewports.length,
      boardCount: roleSmoke.board.length,
      setupCount: roleSmoke.setup.length,
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
    const browserRole = browserRoleScenario(role);
    const entries = roleSmoke.roles.filter((entry) => entry.role === role.id);
    assert.equal(entries.length, viewports.length);
    for (const entry of entries) {
      assert.equal(entry.path, browserRole.path);
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
  assertBrowserRoleSmokeEvidence(roleSmoke);
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
    setupCount: roleSmoke.setup?.length ?? 0,
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
