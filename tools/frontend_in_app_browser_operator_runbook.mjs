import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = path.join(repoRoot, "target", "frontend-in-app-browser-operator-runbook");
const jsonPath = path.join(artifactDir, "runbook.json");
const markdownPath = path.join(artifactDir, "runbook.md");

const sources = {
  bundleManifest: "target/frontend-in-app-browser-bundle/bundle-manifest.json",
  bundleImport: "target/frontend-in-app-browser-bundle-import/bundle-import.json",
  replayHandoff: "target/frontend-in-app-browser-interactions/replay-handoff.json",
  importedRun: "target/frontend-in-app-browser-imported-run/imported-run.json",
  importedRoleSmoke:
    "target/frontend-role-smoke-imported/imported-role-smoke.json",
  completionAudit: "target/frontend-completion-audit/completion-audit.json",
  readinessSummary: "target/frontend-readiness-summary/readiness-summary.json",
};

const bundle = await readJson(sources.bundleManifest);
const bundleImport = await readJson(sources.bundleImport);
const handoff = await readJson(sources.replayHandoff);
const importedRun = await readJson(sources.importedRun);
const importedRoleSmoke = await readJson(sources.importedRoleSmoke);
const completionAudit = await readJson(sources.completionAudit);
const readiness = await readJson(sources.readinessSummary);

assert.equal(bundle.status, "bundle-ready");
assert.equal(handoff.status, "handoff-ready");
assert.equal(
  ["bundle-imported-passed", "bundle-source-blocked"].includes(bundleImport.status),
  true,
);
assert.equal(["imported-passed", "source-blocked"].includes(importedRun.status), true);
assert.equal(
  ["imported-passed", "source-blocked"].includes(importedRoleSmoke.status),
  true,
);
assert.equal(["complete", "not_complete"].includes(completionAudit.overall.state), true);
assert.equal(["complete", "not_complete"].includes(readiness.overall.state), true);
assert.equal(bundle.fixture.plannedStabilityCheckCount, 2);
assert.equal(bundle.fixture.stabilityCheckTileCount, 14);
assert.deepEqual(
  bundle.fixture.plannedStabilityChecks,
  handoff.fixture.plannedStabilityChecks,
);

const runbook = {
  status: bundleImport.status === "bundle-imported-passed"
    ? "browser-evidence-imported"
    : "awaiting-external-browser-replay",
  proof: "in-app-browser-external-replay-operator-runbook",
  boundary:
    "Operator runbook for moving the generated in-app browser fixture and full role-smoke proof through one external Chromium-capable replay bundle and back into local import validation. It records exact commands, expected returned files, and current proof statuses for file-backed fixture, localhost-served fixture, and role-smoke runs. It does not prove browser behavior by itself, Svelte hydration, command side effects, TCP transport, WebSocket delivery, dev-server routing, or full localhost app acceptance.",
  generatedFrom: sources,
  fixture: {
    plannedInteractionCount: bundle.fixture.plannedInteractionCount,
    moderatorCriticalConfirmationCount:
      bundle.fixture.moderatorCriticalConfirmationCount,
    plannedStabilityCheckCount: bundle.fixture.plannedStabilityCheckCount,
    stabilityCheckTileCount: bundle.fixture.stabilityCheckTileCount,
    plannedStabilityChecks: bundle.fixture.plannedStabilityChecks,
  },
  currentStatus: {
    bundle: bundle.status,
    bundleImport: bundleImport.status,
    importedRun: importedRun.status,
    importedRoleSmoke: importedRoleSmoke.status,
    completionAudit: completionAudit.overall.state,
    readiness: readiness.overall.state,
    browserRunStatus: bundle.latest.browserRunStatus,
    localhostBrowserRunStatus: bundle.latest.localhostBrowserRunStatus,
    promotionEligible: bundleImport.promotionEligible,
  },
  artifacts: {
    exportBundle: bundle.archive,
    exportBundleSha256: bundle.archiveSha256,
    returnedBundleImport:
      "target/frontend-in-app-browser-bundle-import/bundle-import.json",
    importedRun: "target/frontend-in-app-browser-imported-run/imported-run.json",
    browserRun:
      "target/frontend-in-app-browser-interactions/browser-run.json",
    localhostBrowserRun:
      "target/frontend-in-app-browser-localhost/browser-run.json",
    screenshots: "target/frontend-in-app-browser-interactions/browser-run-*.png",
    localhostScreenshots: "target/frontend-in-app-browser-localhost/browser-run-*.png",
  },
  workflow: [
    {
      step: "freshen-local-fixture",
      where: "local sandbox",
      command:
        "npm run test:frontend-iab-interaction-page && npm run test:frontend-iab-static-dom && npm run test:frontend-iab-localhost-fixture-smoke && npm run test:frontend-iab-fixture-handoff && FMARCH_ALLOW_STATIC_ROLE_FALLBACK=1 npm run test:frontend-role-smoke && npm run test:frontend-role-smoke-import && npm run test:frontend-iab-fixture-bundle",
      expects: [
        "target/frontend-in-app-browser-bundle/fixture-replay-bundle.tar",
        "target/frontend-in-app-browser-bundle/bundle-manifest.json",
      ],
    },
    {
      step: "unpack-on-chromium-runner",
      where: "Chromium-capable repo checkout",
      command:
        "tar -xf target/frontend-in-app-browser-bundle/fixture-replay-bundle.tar",
      expects: [
        "target/frontend-in-app-browser-interactions/interaction-page.html",
        "target/frontend-in-app-browser-interactions/interaction-page-manifest.json",
      ],
    },
    {
      step: "replay-file-fixture-and-role-smoke",
      where: "Chromium-capable repo checkout",
      command:
        "npm run test:frontend-iab-fixture-replay && npm run test:frontend-iab-localhost-fixture-smoke && npm run test:frontend-role-smoke && npm run test:frontend-role-smoke-import && npm run test:frontend-iab-fixture-bundle",
      expects: [
        "target/frontend-in-app-browser-interactions/browser-run.json with status passed",
        "target/frontend-in-app-browser-localhost/browser-run.json with status passed when localhost bind is allowed",
        "target/frontend-role-smoke/role-smoke.json with status passed",
        "target/frontend-role-smoke/*.png screenshots referenced by role-smoke.json",
        "browser-run plannedStabilityChecks covering 2 checks and 14 reserved status-floor tiles",
        "target/frontend-in-app-browser-interactions/browser-run-*.png for each proof viewport",
        "target/frontend-in-app-browser-localhost/browser-run-*.png for each proof viewport when localhost fixture browser-run passed",
        "target/frontend-in-app-browser-bundle/fixture-replay-bundle.tar containing returned browser evidence",
      ],
    },
    {
      step: "import-returned-bundle",
      where: "local sandbox",
      command:
        "FMARCH_IAB_FIXTURE_BUNDLE_IMPORT=<returned>/fixture-replay-bundle.tar npm run test:frontend-iab-fixture-bundle-import && npm run test:frontend-browser-acceptance-boundary && npm run test:frontend-completion-audit && npm run test:frontend-readiness-summary",
      expects: [
        "target/frontend-in-app-browser-bundle-import/bundle-import.json",
        "target/frontend-role-smoke-imported/imported-role-smoke.json",
        "bundle import status bundle-imported-passed when returned browser-run passed",
        "bundle import restores and validates imported-passed role-smoke when returned role-smoke and screenshots passed",
        "completion audit records imported file-backed browser evidence before readiness is summarized",
        "in-app-file-browser-run lane proven in browser acceptance boundary when imported run is imported-passed",
        "in-app-localhost-fixture-browser-run lane proven in browser acceptance boundary when restored localhost fixture browser-run passed",
        "imported-localhost-role-smoke lane proven in browser acceptance boundary when returned role-smoke passed",
      ],
    },
  ],
  promotionChecks: [
    "returned browser-run.json has status passed",
    "returned localhost browser-run.json has status passed when proving the localhost-served fixture lane",
    "returned browser-run plannedStabilityChecks includes 2 reserved status-floor checks covering 14 admin/moderator action tiles",
    "all returned reserved status floors render at least 44px before promotion",
    "returned bundle includes browser-run-*.png screenshot files for every proof viewport",
    "returned bundle includes localhost browser-run-*.png screenshot files for every proof viewport when localhost fixture browser-run passed",
    "npm run test:frontend-iab-fixture-bundle-import writes bundle-imported-passed",
    "npm run test:frontend-iab-fixture-bundle-import writes imported role-smoke as imported-passed when returned role-smoke evidence is complete",
    "npm run test:frontend-browser-acceptance-boundary marks in-app-file-browser-run proven",
    "npm run test:frontend-browser-acceptance-boundary marks in-app-localhost-fixture-browser-run proven when restored localhost fixture browser-run passed",
    "npm run test:frontend-browser-acceptance-boundary marks imported-localhost-role-smoke proven when returned role-smoke passed",
    "npm run test:frontend-completion-audit records imported browser evidence before readiness is summarized",
    "full localhost app acceptance is tracked by the localhost dev-server role-smoke lane; fixture replay lanes are diagnostic browser evidence, not a replacement for that full app lane",
  ],
  blocking: bundleImport.status === "bundle-imported-passed"
    ? []
    : bundleImport.importedRun.blocking,
};

await mkdir(artifactDir, { recursive: true });
await writeFile(jsonPath, `${JSON.stringify(runbook, null, 2)}\n`);
await writeFile(markdownPath, `${renderMarkdown(runbook)}\n`);
console.log(`wrote ${path.relative(repoRoot, jsonPath)}`);
console.log(`wrote ${path.relative(repoRoot, markdownPath)}`);

function renderMarkdown(runbook) {
  return [
    "# In-App Browser External Replay Runbook",
    "",
    `Status: \`${runbook.status}\``,
    "",
    `Export bundle: \`${runbook.artifacts.exportBundle}\``,
    `Export bundle SHA-256: \`${runbook.artifacts.exportBundleSha256}\``,
    `Planned stability checks: ${runbook.fixture.plannedStabilityCheckCount}`,
    `Reserved status-floor tiles: ${runbook.fixture.stabilityCheckTileCount}`,
    "",
    "Workflow:",
    "",
    ...runbook.workflow.flatMap((step, index) => [
      `${index + 1}. ${step.step} (${step.where})`,
      "",
      `   \`${step.command}\``,
      "",
      ...step.expects.map((expectation) => `   - ${expectation}`),
      "",
    ]),
    "Promotion checks:",
    "",
    ...runbook.promotionChecks.map((check) => `- ${check}`),
    "",
    "Current blocking:",
    "",
    ...(runbook.blocking.length === 0
      ? ["- none"]
      : runbook.blocking.map((item) => `- ${item}`)),
  ].join("\n");
}

async function readJson(source) {
  return JSON.parse(await readFile(path.join(repoRoot, source), "utf8"));
}
