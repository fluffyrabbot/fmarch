import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { THEMES } from '../frontend/src/lib/app/theme.mjs';

// Reject partial matrices and missing artifacts before publishing lane success.
export async function validateThemeEvidence(evidence, browser, artifactDir) {
  assert.equal(evidence.status, 'passed');
  assert.equal(evidence.browser?.name, browser);
  assert.ok(evidence.browser.version);
  const expected = [];
  for (const viewport of ['desktop', 'mobile']) for (const {id: themeId} of THEMES)
    for (const role of ['player', 'player-normal', 'moderator']) for (const phase of ['day', 'night', 'twilight']) {
      const screenshot = `themes/${viewport}-${themeId}-${role}-${phase}.png`;
      expected.push({themeId, role, viewport, phase, palette: phase, screenshot});
      const bytes = await readFile(path.join(artifactDir, screenshot));
      assert.ok(bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])), `Invalid screenshot: ${screenshot}`);
    }
  assert.deepEqual(evidence.cases.filter(item => item.screenshot), expected);
  const contrasts = evidence.cases.filter(item => item.contrast);
  assert.deepEqual(contrasts.map(item => item.themeId), THEMES.map(theme => theme.id));
  for (const {contrast} of contrasts) {
    assert.equal(contrast.length, 45);
    assert.equal(new Set(contrast.map(check => `${check.phase}/${check.pair}`)).size, 45);
    for (const phase of ['day', 'night', 'twilight']) assert.equal(contrast.filter(check => check.phase === phase).length, 15);
    for (const check of contrast) assert.ok(check.ratio >= check.minimum && check.minimum >= 3);
  }
  assert.deepEqual(evidence.cases.filter(item => item.preference), [
    {preference:'light', system:'dark', phase:'night', palette:'day'},
    {preference:'dark', system:'dark', phase:'night', palette:'night'},
    {preference:'system', system:'dark', phase:'night', palette:'night'},
    {preference:'system', system:'light', phase:'night', palette:'day'},
  ]);
  assert.equal(evidence.cases.length, expected.length + contrasts.length + 4);
}
