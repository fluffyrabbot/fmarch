// The pinned image isolates Firefox/WebKit from the rolling worker ABI.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const image = 'mcr.microsoft.com/playwright@sha256:83192064c7510f7ee73dd63dc5f22a5e01a92c81a2e6a9c715d9e3fe55471fd9'; // v1.60.0-noble, linux/amd64
const root = fileURLToPath(new URL('../', import.meta.url));
const OUTPUT_LIMIT = 8 * 1024 * 1024;

// Engines of one lane run concurrently against the same checkout, so each
// engine's Vite cache and SvelteKit output live in its own scratch directory.
export async function engineScratchDir(name) {
  const base = process.env.FMARCH_FRONTEND_SCRATCH_DIR ?? await mkdtemp(path.join(tmpdir(), 'fmarch-frontend-'));
  const directory = path.join(base, `engine-${name}`);
  await mkdir(directory, {recursive: true});
  return directory;
}

/** Run a child to completion, keeping the last OUTPUT_LIMIT bytes of each stream. */
export function runToCompletion(command, args, {timeoutMs, ...options}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {...options, stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '';
    let stderr = '';
    const keep = (current, chunk) => (current + chunk.toString()).slice(-OUTPUT_LIMIT);
    child.stdout.on('data', chunk => { stdout = keep(stdout, chunk); });
    child.stderr.on('data', chunk => { stderr = keep(stderr, chunk); });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.once('error', error => { clearTimeout(timer); resolve({status: null, error, stdout, stderr}); });
    child.once('close', status => { clearTimeout(timer); resolve({status, error: null, stdout, stderr}); });
  });
}

export async function runContainerBrowser({name, artifactDir, script, evidenceFile}) {
  await mkdir(artifactDir, {recursive: true});
  const scratch = await engineScratchDir(name);
  const child = await runToCompletion('podman', [
    'run', '--rm', '--init', '--pull=never', '--network=none',
    // Inherit the fleet service cgroup instead of escaping into a sibling
    // libpod scope. The worker's aggregate memory/CPU caps include browsers.
    '--cgroups=disabled', '--shm-size=512m', '--timeout=830',
    '--volume', `${root}:/workspace`, '--volume', `${artifactDir}:/proof-artifacts`,
    '--volume', `${scratch}:/proof-scratch`,
    '--workdir', '/workspace', '--env', `FMARCH_PROOF_BROWSER=${name}`,
    '--env', 'FMARCH_ALLOW_STATIC_ROLE_FALLBACK=0', '--env', 'FMARCH_PROOF_ARTIFACT_DIR=/proof-artifacts',
    '--env', 'FMARCH_FRONTEND_SCRATCH_DIR=/proof-scratch',
    image, 'node', script,
  ], {cwd: root, timeoutMs: 850_000});
  await writeFile(path.join(artifactDir, 'browser.log'), `${child.stdout}\n${child.stderr}`);
  process.stdout.write(`[${name}]\n${child.stdout}`);
  process.stderr.write(child.stderr);
  if (child.error) throw child.error;
  assert.equal(child.status, 0, `${name} ${script} failed`);
  const evidence = JSON.parse(await readFile(path.join(artifactDir, evidenceFile), 'utf8'));
  assert.equal(evidence.status, 'passed');
  assert.equal(evidence.browser?.name, name);
  assert.ok(evidence.browser.version);
  return evidence;
}
