// Build the committed release Dockerfile on the admitted Linux worker. This
// produces local, content-addressed image evidence without publishing a release.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exactImageRuntimeBinaries } from './exact_image_content_smoke.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const digest = (value) => createHash('sha256').update(value).digest('hex');

export function validateImageEvidence({ image, commit, expected, first, second }) {
  assert.match(image.Id, /^sha256:[a-f0-9]{64}$/u, 'image must have an immutable local ID');
  assert.equal(image.Os, 'linux');
  assert.equal(image.Architecture, 'amd64');
  assert.equal(image.Config?.Labels?.['org.opencontainers.image.revision'], commit);
  assert.equal(image.Config?.User, 'fmarch');
  assert.deepEqual(image.Config?.Cmd, ['/bin/false']);
  assert.equal(first, second, 'runtime content must be deterministic');
  const actual = JSON.parse(first);
  assert.equal(actual.status, 'ok');
  assert.equal(actual.pack_count, 5);
  assert.equal(actual.program_count, 5);
  assert.match(actual.registry_hash, /^[a-f0-9]{64}$/u);
  assert.deepEqual(actual, expected, 'image content must match the canonical source');
  return { image_id: image.Id, registry_hash: actual.registry_hash };
}

export function main() {
  assert.equal(process.platform, 'linux', 'release image proof requires canonical Linux');
  assert.equal(process.arch, 'x64');
  assert.equal(process.env.FLEET_VERIFICATION_MODE, 'audit');
  assert.equal(process.env.HOST_HEAVY_BUILD_LOCK_HELD, '1', 'image build must hold the shared host lock');
  const run = (command, args, options = {}) => execFileSync(command, args, {
    cwd: root, encoding: 'utf8', timeout: 120_000, maxBuffer: 32 * 1024 * 1024,
    ...options,
  })?.trim() ?? '';
  const commit = run('git', ['rev-parse', 'HEAD']);
  assert.match(commit, /^[a-f0-9]{40}$/u);
  const clean = () => {
    assert.equal(run('git', ['rev-parse', 'HEAD']), commit);
    assert.equal(run('git', ['status', '--porcelain']), '', 'image source must be clean');
  };
  clean();
  run('python3', ['scripts/check-rust-toolchain.py', '--runtime']);
  const parent = join(root, 'target', 'release-image-proof');
  mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(join(parent, `${commit}-`));
  const started = Date.now();
  const evidence = { version: 1, kind: 'fmarch-release-image-proof', commit, platform: 'linux/amd64' };
  try {
    const archive = join(directory, 'source.tar');
    const context = join(directory, 'context');
    mkdirSync(context);
    run('git', ['archive', '--format=tar', `--output=${archive}`, commit]);
    run('tar', ['-xf', archive, '-C', context]);
    evidence.dockerfile_sha256 = digest(readFileSync(join(context, 'Dockerfile')));
    evidence.rustc = run('rustc', ['--version', '--verbose']);
    const iidfile = join(directory, 'image-id');
    // Chroot isolation keeps build processes inside the admitted fleet cgroup.
    // Cargo parallelism is bounded inside the Dockerfile as well as on the host.
    run('podman', ['build', '--isolation=chroot', '--jobs=1', '--platform=linux/amd64',
      '--build-arg', `FMARCH_RELEASE_COMMIT=${commit}`, '--iidfile', iidfile,
      '--file', join(context, 'Dockerfile'), context], {
      timeout: 3_600_000, stdio: ['ignore', 'inherit', 'inherit'],
    });
    const id = readFileSync(iidfile, 'utf8').trim();
    assert.match(id, /^sha256:[a-f0-9]{64}$/u);
    const [image] = JSON.parse(run('podman', ['image', 'inspect', id]));
    const expected = JSON.parse(run('cargo', ['run', '--quiet', '-p', 'server', '--bin', 'server', '--', '--check-content'], { timeout: 1_200_000 }));
    const args = ['run', '--rm', '--cgroups=disabled', '--network=none', '--pull=never'];
    const check = ['test "$(id -u)" = 10001',
      ...exactImageRuntimeBinaries.map((binary) => `test -x /usr/local/bin/${binary}`),
      'test ! -e /app && test ! -e /packs && test ! -e /programs',
      '/usr/local/bin/fmarch-server --check-content'].join(' && ');
    const first = run('podman', [...args, '--entrypoint', '/bin/sh', id, '-c', check]);
    const second = run('podman', [...args, id, '/usr/local/bin/fmarch-server', '--check-content']);
    Object.assign(evidence, validateImageEvidence({ image, commit, expected, first, second }));
    clean();
    evidence.status = 'passed';
  } catch (error) {
    evidence.status = 'failed';
    evidence.error = error.message;
    throw error;
  } finally {
    evidence.elapsed_seconds = (Date.now() - started) / 1000;
    writeFileSync(join(directory, 'report.json'), JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify(evidence));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
