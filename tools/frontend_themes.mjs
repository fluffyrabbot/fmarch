import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { engineScratchDir, image, runContainerBrowser, runToCompletion } from './frontend_container_browser.mjs';
import { validateThemeEvidence } from './frontend_theme_evidence.mjs';

if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('Theme proof requires the canonical Linux x64 worker');
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.resolve(process.env.FMARCH_PROOF_ARTIFACT_DIR ?? path.join(root, 'target/frontend-themes'));
await mkdir(output, {recursive: true});
const engines = ['chromium', 'firefox', 'webkit'];

async function runEngine(name) {
  const artifactDir = path.join(output, name);
  await mkdir(artifactDir, {recursive: true});
  if (name !== 'chromium') {
    return await runContainerBrowser({name, artifactDir, script: 'tools/frontend_theme_browser.mjs', evidenceFile: 'theme-browser.json'});
  }
  const child = await runToCompletion(process.execPath, ['tools/frontend_theme_browser.mjs'], {
    cwd: root, timeoutMs: 850_000,
    env: {...process.env, FMARCH_PROOF_BROWSER: name, FMARCH_PROOF_ARTIFACT_DIR: artifactDir,
      FMARCH_FRONTEND_SCRATCH_DIR: await engineScratchDir(name)},
  });
  await writeFile(path.join(artifactDir, 'browser.log'), `${child.stdout}\n${child.stderr}`);
  process.stdout.write(`[${name}]\n${child.stdout}`);
  process.stderr.write(child.stderr);
  if (child.error) throw child.error;
  assert.equal(child.status, 0, 'Chromium themes failed');
  return JSON.parse(await readFile(path.join(artifactDir, 'theme-browser.json'), 'utf8'));
}

// The three engines run at once; the lane claims one browser slot per engine.
const browsers = await Promise.all(engines.map(async name => {
  try {
    const evidence = await runEngine(name);
    await validateThemeEvidence(evidence, name, path.join(output, name));
    console.log(`${name}: complete theme matrix passed`);
    return {...evidence.browser, status: 'passed', cases: evidence.cases.length};
  } catch (error) {
    return {name, status: 'failed', error: error.message};
  }
}));
const passed = browsers.length === 3 && browsers.every(browser => browser.status === 'passed');
await writeFile(path.join(output, 'themes.json'), JSON.stringify({status: passed ? 'passed' : 'failed', image, browsers,
  boundary: 'Local fixture-backed Chromium, Firefox and WebKit themes; native Safari and hosted acceptance remain separate.'}, null, 2) + '\n');
assert.ok(passed, 'Theme proof failed; inspect per-engine evidence');
