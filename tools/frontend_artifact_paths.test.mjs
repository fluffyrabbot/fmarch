import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const visualSource = readFileSync(
  path.join(repoRoot, "tools", "frontend_visual_regression.mjs"),
  "utf8",
);
const routeStateSource = readFileSync(
  path.join(repoRoot, "tools", "frontend_route_state_render_contract.mjs"),
  "utf8",
);
const tabletInteractionSource = readFileSync(
  path.join(repoRoot, "tools", "frontend_tablet_interaction_contract.mjs"),
  "utf8",
);
const roleDomSource = readFileSync(
  path.join(repoRoot, "tools", "frontend_role_dom_smoke.mjs"),
  "utf8",
);

test("visual baselines cover only screenshots declared by the live role-smoke receipt", () => {
  const expected = [
    "desktop-admin.json",
    "mobile-admin.json",
    "mobile-board-player.json",
    "mobile-forbidden-player-signed-out.json",
    "mobile-moderator-confirmation.json",
    "mobile-moderator-interrupted.json",
    "mobile-moderator-pending.json",
    "mobile-moderator.json",
    "mobile-player-composer-ack.json",
    "mobile-player-interrupted.json",
    "mobile-player-pending.json",
    "mobile-player-receipt.json",
    "mobile-player.json",
    "mobile-route-state-player-reject.json",
    "tablet-moderator.json",
    "tablet-player.json",
  ];
  const baselineDir = path.join(repoRoot, "tools", "fixtures", "frontend-visual-baselines");
  const actual = readdirSync(baselineDir).filter((name) => name.endsWith(".json")).sort();

  assert.deepEqual(actual, expected);
  assert.match(visualSource, /role-smoke\.json/);
  assert.match(visualSource, /screenshotEvidencePaths\(roleSmokeEvidence\)/);
  for (const stale of [
    "mobile-admin-confirmation.png",
    "mobile-admin-pending.png",
    "mobile-admin-interrupted.png",
  ]) {
    assert.doesNotMatch(visualSource, new RegExp(`"${stale.replace(".", "\\.")}"`));
  }
  for (const baseline of actual) {
    const sample = JSON.parse(readFileSync(path.join(baselineDir, baseline), "utf8"));
    assert.equal(sample.screenshot, baseline.replace(/\.json$/, ".png"));
  }
});

test("route-state render keeps generated entry modules under its lane artifact root", () => {
  assert.match(
    routeStateSource,
    /const tempEntryDir = path\.join\(artifactDir, "\.tmp-route-state-render"\)/,
  );
  assert.doesNotMatch(
    routeStateSource,
    /path\.join\(frontendRoot, "\.tmp-route-state-render"\)/,
  );
  assert.match(routeStateSource, /FMARCH_PROOF_ARTIFACT_DIR/);
  assert.match(tabletInteractionSource, /FMARCH_PROOF_ARTIFACT_DIR/);
  assert.match(tabletInteractionSource, /FMARCH_ROUTE_STATE_RENDER_ARTIFACT_DIR/);
  assert.match(roleDomSource, /FMARCH_PROOF_ARTIFACT_DIR/);
  assert.match(roleDomSource, /FMARCH_ROUTE_STATE_RENDER_ARTIFACT_DIR/);
  assert.match(routeStateSource, /const generatedFrontendAlias = "@fmarch-route-state-frontend"/);
  assert.match(
    routeStateSource,
    /replaceAll\("\.\.\/src\/", `\$\{generatedFrontendAlias\}\/src\/`\)/,
  );
});

test('theme evidence rejects incomplete matrices, preferences, contrasts, and missing screenshots', async t => {
  const {mkdtemp, mkdir, writeFile, rm} = await import('node:fs/promises');
  const {tmpdir} = await import('node:os');
  const {THEMES} = await import('../frontend/src/lib/app/theme.mjs');
  const {validateThemeEvidence} = await import('./frontend_theme_evidence.mjs');
  const root = await mkdtemp(path.join(tmpdir(), 'fmarch-theme-evidence-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(path.join(root, 'themes'));
  const cases = [];
  for (const viewport of ['desktop', 'mobile']) for (const {id: themeId} of THEMES)
    for (const role of ['player', 'player-normal', 'moderator']) for (const phase of ['day', 'night', 'twilight']) {
      const screenshot = `themes/${viewport}-${themeId}-${role}-${phase}.png`;
      cases.push({themeId, role, viewport, phase, palette:phase, screenshot});
      await writeFile(path.join(root, screenshot), Buffer.from([137,80,78,71,13,10,26,10,0]));
    }
  for (const {id: themeId} of THEMES) cases.push({themeId, contrast: Array.from({length:45}, (_, i) => ({phase:['day','night','twilight'][Math.floor(i / 15)], pair:`pair${i % 15}`, ratio:4.5, minimum:4.5}))});
  cases.push(...[
    {preference:'light', system:'dark', phase:'night', palette:'day'},
    {preference:'dark', system:'dark', phase:'night', palette:'night'},
    {preference:'system', system:'dark', phase:'night', palette:'night'},
    {preference:'system', system:'light', phase:'night', palette:'day'},
  ]);
  const evidence = {status:'passed', browser:{name:'chromium', version:'test'}, cases};
  await validateThemeEvidence(evidence, 'chromium', root);
  await assert.rejects(validateThemeEvidence({...evidence, cases:cases.slice(1)}, 'chromium', root));
  await assert.rejects(validateThemeEvidence({...evidence, cases:cases.slice(0, -1)}, 'chromium', root));
  const badContrast = structuredClone(evidence);
  badContrast.cases.find(item => item.contrast).contrast[0].ratio = 1;
  await assert.rejects(validateThemeEvidence(badContrast, 'chromium', root));
  await rm(path.join(root, cases[0].screenshot));
  await assert.rejects(validateThemeEvidence(evidence, 'chromium', root), /ENOENT/);
});
