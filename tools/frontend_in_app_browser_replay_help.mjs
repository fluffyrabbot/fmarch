import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXPECTED_COUNTS } from "./frontend_proof_expectations.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = path.join(repoRoot, "target", "frontend-in-app-browser-replay-help");
const jsonPath = path.join(artifactDir, "replay-help.json");
const markdownPath = path.join(artifactDir, "replay-help.md");
const shellPath = path.join(artifactDir, "replay-help.sh");

const sources = {
  manifest: "target/frontend-in-app-browser-interactions/interaction-page-manifest.json",
  replayHandoff: "target/frontend-in-app-browser-interactions/replay-handoff.json",
  bundleManifest: "target/frontend-in-app-browser-bundle/bundle-manifest.json",
  operatorRunbook: "target/frontend-in-app-browser-operator-runbook/runbook.json",
};

const manifest = await readJson(sources.manifest);
const handoff = await readJson(sources.replayHandoff);
const bundle = await readJson(sources.bundleManifest);
const runbook = await readJson(sources.operatorRunbook);

assert.equal(manifest.status, "page-generated");
assert.equal(manifest.proof, "in-app-browser-file-interaction-page");
assert.equal(handoff.status, "handoff-ready");
assert.equal(handoff.proof, "in-app-browser-fixture-replay-handoff");
assert.equal(bundle.status, "bundle-ready");
assert.equal(bundle.proof, "in-app-browser-fixture-replay-bundle");
assert.equal(
  ["awaiting-external-browser-replay", "browser-evidence-imported"].includes(
    runbook.status,
  ),
  true,
);
assert.equal(runbook.proof, "in-app-browser-external-replay-operator-runbook");
assert.equal(handoff.fixture.plannedInteractionCount, EXPECTED_COUNTS.plannedInteractions);
assert.equal(bundle.fixture.plannedInteractionCount, EXPECTED_COUNTS.plannedInteractions);
assert.equal(handoff.fixture.plannedStabilityCheckCount, 2);
assert.equal(bundle.fixture.plannedStabilityCheckCount, 2);
assert.equal(handoff.fixture.stabilityCheckTileCount, EXPECTED_COUNTS.stabilityCheckTiles);
assert.equal(bundle.fixture.stabilityCheckTileCount, EXPECTED_COUNTS.stabilityCheckTiles);
assert.deepEqual(
  bundle.fixture.plannedStabilityChecks,
  handoff.fixture.plannedStabilityChecks,
);

const routeErrorScenario = manifest.scenarios.find(
  (scenario) => scenario.id === "route-error-back-to-board-click",
);
assert(routeErrorScenario, "route-error fixture scenario is missing");
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

const localFreshenCommand = [
  "npm run test:frontend-iab-interaction-page",
  "npm run test:frontend-iab-static-dom",
  "npm run test:frontend-iab-localhost-fixture-smoke",
  "npm run test:frontend-iab-fixture-handoff",
  "FMARCH_ALLOW_STATIC_ROLE_FALLBACK=1 npm run test:frontend-role-smoke",
  "npm run test:frontend-role-smoke-import",
  "npm run test:frontend-iab-fixture-bundle",
  "npm run test:frontend-iab-operator-runbook",
].join(" && ");
const chromiumReplayCommand = [
  "tar -xf target/frontend-in-app-browser-bundle/fixture-replay-bundle.tar",
  "npm run test:frontend-iab-fixture-replay",
  "npm run test:frontend-iab-localhost-fixture-smoke",
  "npm run test:frontend-role-smoke",
  "npm run test:frontend-role-smoke-import",
  "npm run test:frontend-iab-fixture-bundle",
].join(" && ");
const importReturnedCommand = [
  "FMARCH_IAB_FIXTURE_BUNDLE_IMPORT=<returned>/fixture-replay-bundle.tar npm run test:frontend-iab-fixture-bundle-import",
  "npm run test:frontend-browser-acceptance-boundary",
  "npm run test:frontend-completion-audit",
  "npm run test:frontend-readiness-summary",
  "npm run test:frontend-iab-operator-runbook",
  "npm run test:frontend-iab-replay-help",
].join(" && ");

const replayHelp = {
  status: runbook.status === "browser-evidence-imported"
    ? "replay-evidence-imported"
    : "ready-for-external-replay",
  proof: "in-app-browser-external-replay-help",
  boundary:
    "Condensed operator helper for replaying the generated in-app browser fixture plus full role-smoke outside the sandbox and importing the returned bundle. It records exact commands, route-error promotion requirements, returned files, and current proof status for file-backed fixture, localhost-served fixture, and role-smoke browser runs. It does not prove browser behavior by itself, Svelte hydration, command side effects, TCP transport, WebSocket delivery, dev-server routing, or full localhost app acceptance.",
  generatedFrom: sources,
  fixture: {
    page: manifest.page,
    pageUrl: manifest.pageUrl,
    viewports: manifest.viewports.map(({ name, width, height }) => ({
      name,
      width,
      height,
    })),
    commandScenarioCount: manifest.scenarios.length,
    hydratedScenarioCount: manifest.hydratedSurfaceScenarios.length,
    plannedInteractionCount: handoff.fixture.plannedInteractionCount,
    plannedInteractionIds: handoff.fixture.plannedInteractionIds,
    plannedStabilityCheckCount: handoff.fixture.plannedStabilityCheckCount,
    stabilityCheckTileCount: handoff.fixture.stabilityCheckTileCount,
    plannedStabilityChecks: handoff.fixture.plannedStabilityChecks,
    routeErrorScenario: {
      id: routeErrorScenario.id,
      targetTestId: routeErrorScenario.targetTestId,
      expectedText: routeErrorScenario.expectedText,
      errorSurface: routeErrorScenario.errorSurface,
    },
  },
  bundle: {
    archive: bundle.archive,
    archiveSha256: bundle.archiveSha256,
    contents: bundle.contents.length,
    screenshotCount: bundle.fixture.screenshotCount,
  },
  commands: {
    freshenLocal: localFreshenCommand,
    replayOnChromiumRunner: chromiumReplayCommand,
    importReturnedBundle: importReturnedCommand,
  },
  expectedReturnedFiles: [
    "target/frontend-in-app-browser-interactions/browser-run.json",
    "target/frontend-in-app-browser-interactions/browser-run-*.png",
    "target/frontend-in-app-browser-localhost/browser-run.json",
    "target/frontend-in-app-browser-localhost/browser-run-*.png",
    "target/frontend-role-smoke/role-smoke.json",
    "target/frontend-role-smoke/*.png",
    "target/frontend-in-app-browser-bundle/fixture-replay-bundle.tar",
  ],
  promotionChecks: [
    "returned browser-run.json has status passed",
    "returned localhost browser-run.json has status passed when proving the localhost-served fixture lane",
    `returned browser-run plannedInteractions includes ${EXPECTED_COUNTS.plannedInteractions} admin/player/moderator/error interactions`,
    `returned browser-run plannedStabilityChecks includes 2 reserved status-floor checks covering ${EXPECTED_COUNTS.stabilityCheckTiles} admin/moderator action tiles`,
    "all returned reserved status floors render at least 44px before promotion",
    "route-error-back-to-board-click records 403 player private-channel shell evidence and Back to board click/focus evidence",
    "returned bundle includes browser-run-*.png screenshot files for every proof viewport",
    "returned bundle includes localhost browser-run-*.png screenshot files for every proof viewport when localhost fixture browser-run passed",
    "returned role-smoke.json has status passed with referenced role-smoke screenshots",
    "bundle import writes bundle-imported-passed",
    "bundle import writes imported role-smoke as imported-passed",
    "browser acceptance boundary marks in-app-file-browser-run proven",
    "browser acceptance boundary marks in-app-localhost-fixture-browser-run proven when restored localhost fixture browser-run passed",
    "browser acceptance boundary marks imported-localhost-role-smoke proven when returned role-smoke passed",
    "completion audit records imported browser evidence before readiness is summarized",
    "full localhost app acceptance is tracked by the localhost dev-server role-smoke lane; fixture replay lanes are diagnostic browser evidence, not a replacement for that full app lane",
  ],
  currentStatus: runbook.currentStatus,
  blocking: runbook.blocking,
};

await mkdir(artifactDir, { recursive: true });
await writeFile(jsonPath, `${JSON.stringify(replayHelp, null, 2)}\n`);
await writeFile(markdownPath, `${renderMarkdown(replayHelp)}\n`);
await writeFile(shellPath, `${renderShell(replayHelp)}\n`);
console.log(`wrote ${path.relative(repoRoot, jsonPath)}`);
console.log(`wrote ${path.relative(repoRoot, markdownPath)}`);
console.log(`wrote ${path.relative(repoRoot, shellPath)}`);

function renderMarkdown(replayHelp) {
  return [
    "# In-App Browser External Replay Help",
    "",
    `Status: \`${replayHelp.status}\``,
    "",
    `Export bundle: \`${replayHelp.bundle.archive}\``,
    `Export bundle SHA-256: \`${replayHelp.bundle.archiveSha256}\``,
    `Fixture file URL: ${replayHelp.fixture.pageUrl}`,
    `Planned stability checks: ${replayHelp.fixture.plannedStabilityCheckCount}`,
    `Reserved status-floor tiles: ${replayHelp.fixture.stabilityCheckTileCount}`,
    "",
    "Commands:",
    "",
    `1. Local freshen: \`${replayHelp.commands.freshenLocal}\``,
    `2. Chromium runner replay: \`${replayHelp.commands.replayOnChromiumRunner}\``,
    `3. Local import: \`${replayHelp.commands.importReturnedBundle}\``,
    "",
    "Expected returned files:",
    "",
    ...replayHelp.expectedReturnedFiles.map((file) => `- \`${file}\``),
    "",
    "Route-error promotion:",
    "",
    `- scenario: \`${replayHelp.fixture.routeErrorScenario.id}\``,
    `- target: \`${replayHelp.fixture.routeErrorScenario.targetTestId}\``,
    `- path: \`${replayHelp.fixture.routeErrorScenario.errorSurface.path}\``,
    `- status: \`${replayHelp.fixture.routeErrorScenario.errorSurface.status}\``,
    "",
    "Promotion checks:",
    "",
    ...replayHelp.promotionChecks.map((check) => `- ${check}`),
    "",
    "Current blocking:",
    "",
    ...(replayHelp.blocking.length === 0
      ? ["- none"]
      : replayHelp.blocking.map((item) => `- ${item}`)),
  ].join("\n");
}

function renderShell(replayHelp) {
  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "",
    "case \"${1:-}\" in",
    "  freshen)",
    `    ${replayHelp.commands.freshenLocal}`,
    "    ;;",
    "  replay)",
    `    ${replayHelp.commands.replayOnChromiumRunner}`,
    "    ;;",
    "  import)",
    "    if [[ -z \"${FMARCH_IAB_FIXTURE_BUNDLE_IMPORT:-}\" ]]; then",
    "      echo \"set FMARCH_IAB_FIXTURE_BUNDLE_IMPORT=<returned>/fixture-replay-bundle.tar\" >&2",
    "      exit 2",
    "    fi",
    `    ${replayHelp.commands.importReturnedBundle.replace(
      "FMARCH_IAB_FIXTURE_BUNDLE_IMPORT=<returned>/fixture-replay-bundle.tar ",
      "",
    )}`,
    "    ;;",
    "  *)",
    "    echo \"usage: $0 {freshen|replay|import}\" >&2",
    "    exit 2",
    "    ;;",
    "esac",
  ].join("\n");
}

async function readJson(source) {
  return JSON.parse(await readFile(path.join(repoRoot, source), "utf8"));
}
