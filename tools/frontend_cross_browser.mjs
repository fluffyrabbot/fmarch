// Critical role/confirmation/focus/private-channel journeys in both engines.
// An immutable Ubuntu browser image isolates their ABI from rolling CachyOS.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const image = 'mcr.microsoft.com/playwright@sha256:83192064c7510f7ee73dd63dc5f22a5e01a92c81a2e6a9c715d9e3fe55471fd9'; // v1.60.0-noble, linux/amd64
const root = fileURLToPath(new URL('../', import.meta.url));
if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('Cross-browser proof requires the canonical Linux x64 worker');
if (process.argv.includes('--provision')) {
  const result = spawnSync('podman', ['pull', image], {stdio: 'inherit', timeout: 300_000});
  if (result.error) throw result.error;
  assert.equal(result.status, 0, 'Pinned browser image provisioning failed');
} else {
  const output = path.resolve(process.env.FMARCH_PROOF_ARTIFACT_DIR ?? path.join(root, 'target/frontend-cross-browser'));
  await mkdir(output, {recursive: true});
  const results = [];
  for (const name of ['firefox', 'webkit']) {
    try {
      const artifactDir = path.join(output, name);
      await mkdir(artifactDir, {recursive: true});
      const child = spawnSync('podman', [
        'run', '--rm', '--init', '--pull=never', '--network=none',
        // Inherit the fleet service cgroup instead of escaping into a sibling
        // libpod scope. The worker's aggregate memory/CPU caps include browsers.
        '--cgroups=disabled', '--shm-size=512m', '--timeout=830',
        '--volume', `${root}:/workspace`, '--volume', `${artifactDir}:/proof-artifacts`,
        '--workdir', '/workspace', '--env', `FMARCH_PROOF_BROWSER=${name}`,
        '--env', 'FMARCH_ALLOW_STATIC_ROLE_FALLBACK=0', '--env', 'FMARCH_PROOF_ARTIFACT_DIR=/proof-artifacts',
        image, 'node', 'tools/frontend_role_smoke.mjs',
      ], {cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 850_000});
      await writeFile(path.join(artifactDir, 'browser.log'), `${child.stdout ?? ''}\n${child.stderr ?? ''}`);
      process.stdout.write(child.stdout ?? '');
      process.stderr.write(child.stderr ?? '');
      if (child.error) throw child.error;
      assert.equal(child.status, 0, `${name} role journeys failed`);
      const evidence = JSON.parse(await readFile(path.join(artifactDir, 'role-smoke.json'), 'utf8'));
      assert.equal(evidence.status, 'passed');
      assert.equal(evidence.browser?.name, name);
      assert.ok(evidence.browser.version);
      results.push({...evidence.browser, status: 'passed'});
    } catch (error) {
      results.push({name, status: 'failed', error: error.message});
    }
  }
  const passed = results.every(result => result.status === 'passed');
  await writeFile(path.join(output, 'cross-browser.json'), JSON.stringify({status: passed ? 'passed' : 'failed', image, browsers: results, boundary: 'Local fixture-backed browser journeys; not real Safari/device or hosted acceptance.'}, null, 2) + '\n');
  assert.ok(passed, 'Cross-browser journeys failed; inspect per-engine evidence');
}
