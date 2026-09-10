// The pinned image isolates Firefox/WebKit from the rolling worker ABI.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const image = 'mcr.microsoft.com/playwright@sha256:83192064c7510f7ee73dd63dc5f22a5e01a92c81a2e6a9c715d9e3fe55471fd9'; // v1.60.0-noble, linux/amd64
const root = fileURLToPath(new URL('../', import.meta.url));
export async function runContainerBrowser({name, artifactDir, script, evidenceFile}) {
  await mkdir(artifactDir, {recursive: true});
  const child = spawnSync('podman', [
    'run', '--rm', '--init', '--pull=never', '--network=none',
    // Inherit the fleet service cgroup instead of escaping into a sibling
    // libpod scope. The worker's aggregate memory/CPU caps include browsers.
    '--cgroups=disabled', '--shm-size=512m', '--timeout=830',
    '--volume', `${root}:/workspace`, '--volume', `${artifactDir}:/proof-artifacts`,
    '--workdir', '/workspace', '--env', `FMARCH_PROOF_BROWSER=${name}`,
    '--env', 'FMARCH_ALLOW_STATIC_ROLE_FALLBACK=0', '--env', 'FMARCH_PROOF_ARTIFACT_DIR=/proof-artifacts',
    image, 'node', script,
  ], {cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 850_000});
  await writeFile(path.join(artifactDir, 'browser.log'), `${child.stdout ?? ''}\n${child.stderr ?? ''}`);
  process.stdout.write(child.stdout ?? '');
  process.stderr.write(child.stderr ?? '');
  if (child.error) throw child.error;
  assert.equal(child.status, 0, `${name} ${script} failed`);
  const evidence = JSON.parse(await readFile(path.join(artifactDir, evidenceFile), 'utf8'));
  assert.equal(evidence.status, 'passed');
  assert.equal(evidence.browser?.name, name);
  assert.ok(evidence.browser.version);
  return evidence;
}
