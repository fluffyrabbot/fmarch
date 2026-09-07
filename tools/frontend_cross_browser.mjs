// Run the same role/confirmation/focus/private-channel journeys in both engines.
// These artifacts never feed the Chromium pixel baseline.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.resolve(process.env.FMARCH_PROOF_ARTIFACT_DIR ?? path.join(root, 'target/frontend-cross-browser'));
await mkdir(output, {recursive: true});
const results = [];
for (const name of ['firefox', 'webkit']) {
  const artifactDir = path.join(output, name);
  const child = spawnSync(process.execPath, ['tools/frontend_role_smoke.mjs'], {
    cwd: root, stdio: 'inherit', timeout: 850_000,
    env: {...process.env, FMARCH_PROOF_BROWSER: name, FMARCH_ALLOW_STATIC_ROLE_FALLBACK: '0', FMARCH_PROOF_ARTIFACT_DIR: artifactDir},
  });
  if (child.error) throw child.error;
  assert.equal(child.status, 0, `${name} role journeys failed`);
  const evidence = JSON.parse(await readFile(path.join(artifactDir, 'role-smoke.json'), 'utf8'));
  assert.equal(evidence.status, 'passed');
  assert.equal(evidence.browser?.name, name);
  assert.ok(evidence.browser.version);
  results.push(evidence.browser);
}
await writeFile(path.join(output, 'cross-browser.json'), JSON.stringify({status: 'passed', browsers: results, boundary: 'Local fixture-backed browser journeys; not real Safari/device or hosted acceptance.'}, null, 2) + '\n');
