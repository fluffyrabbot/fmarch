import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { image, runContainerBrowser } from './frontend_container_browser.mjs';
import { validateThemeEvidence } from './frontend_theme_evidence.mjs';

if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('Theme proof requires the canonical Linux x64 worker');
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.resolve(process.env.FMARCH_PROOF_ARTIFACT_DIR ?? path.join(root, 'target/frontend-themes'));
await mkdir(output, {recursive: true});
const browsers = [];
for (const name of ['chromium', 'firefox', 'webkit']) {
  const artifactDir = path.join(output, name);
  await mkdir(artifactDir, {recursive: true});
  try {
    let evidence;
    if (name === 'chromium') {
      const child = spawnSync(process.execPath, ['tools/frontend_theme_browser.mjs'], {
        cwd: root, env: {...process.env, FMARCH_PROOF_BROWSER: name, FMARCH_PROOF_ARTIFACT_DIR: artifactDir},
        encoding: 'utf8', timeout: 850_000, maxBuffer: 8 * 1024 * 1024,
      });
      await writeFile(path.join(artifactDir, 'browser.log'), `${child.stdout ?? ''}\n${child.stderr ?? ''}`);
      process.stdout.write(child.stdout ?? '');
      process.stderr.write(child.stderr ?? '');
      if (child.error) throw child.error;
      assert.equal(child.status, 0, 'Chromium themes failed');
      evidence = JSON.parse(await readFile(path.join(artifactDir, 'theme-browser.json'), 'utf8'));
    } else {
      evidence = await runContainerBrowser({name, artifactDir, script: 'tools/frontend_theme_browser.mjs', evidenceFile: 'theme-browser.json'});
    }
    await validateThemeEvidence(evidence, name, artifactDir);
    browsers.push({...evidence.browser, status: 'passed', cases: evidence.cases.length});
    console.log(`${name}: complete theme matrix passed`);
  } catch (error) {
    browsers.push({name, status: 'failed', error: error.message});
    break; // Fail before spending time on another engine or the broad journeys.
  }
}
const passed = browsers.length === 3 && browsers.every(browser => browser.status === 'passed');
await writeFile(path.join(output, 'themes.json'), JSON.stringify({status: passed ? 'passed' : 'failed', image, browsers,
  boundary: 'Local fixture-backed Chromium, Firefox and WebKit themes; native Safari and hosted acceptance remain separate.'}, null, 2) + '\n');
assert.ok(passed, 'Theme proof failed; inspect per-engine evidence');
