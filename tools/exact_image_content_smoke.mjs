#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  });
  if (result.error) {
    throw new Error(`${command} ${args.join(' ')} could not start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const details = options.capture ? `\n${result.stdout}\n${result.stderr}` : '';
    throw new Error(`${command} ${args.join(' ')} failed (${result.status})${details}`);
  }
  return result.stdout ?? '';
}

function availableEngine() {
  const requested = process.env.FMARCH_CONTAINER_ENGINE;
  const candidates = requested ? [requested] : ['docker', 'podman'];
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['info'], { encoding: 'utf8', stdio: 'pipe' });
    if (probe.status === 0) return candidate;
  }
  throw new Error(
    `no working container engine found (tried ${candidates.join(', ')}); ` +
      'set FMARCH_CONTAINER_ENGINE to the exact Docker-compatible engine',
  );
}

const engine = availableEngine();
const image = `localhost/fmarch-exact-content:${process.pid}`;
const scratch = mkdtempSync(join(tmpdir(), 'fmarch-exact-image-'));
const iidFile = join(scratch, 'image-id');
const checkScript = [
  'test "$(id -u)" = "10001"',
  'test -x /usr/local/bin/fmarch-server',
  'test -x /usr/local/bin/fmarch-migrate',
  'test -x /usr/local/bin/fmarch-event-key-admin',
  'test ! -e /packs',
  'test ! -e /programs',
  'test ! -e /app',
  '/usr/local/bin/fmarch-server --check-content',
].join(' && ');

try {
  const hostOutput = run(
    'cargo',
    ['run', '--quiet', '-p', 'server', '--', '--check-content'],
    { capture: true },
  ).trim();
  const hostReport = JSON.parse(hostOutput);
  run(engine, ['build', '--file', 'Dockerfile', '--tag', image, '--iidfile', iidFile, '.']);
  const imageId = readFileSync(iidFile, 'utf8').trim();
  if (!imageId) throw new Error('container build did not report an immutable image id');
  const first = run(
    engine,
    ['run', '--rm', '--entrypoint', '/bin/sh', imageId, '-c', checkScript],
    { capture: true },
  ).trim();
  const second = run(
    engine,
    ['run', '--rm', imageId, '/usr/local/bin/fmarch-server', '--check-content'],
    { capture: true },
  ).trim();
  if (first !== second) {
    throw new Error(`content check is not deterministic:\nfirst=${first}\nsecond=${second}`);
  }
  const report = JSON.parse(first);
  const packKeys = report.packs?.map((pack) => pack.key).sort();
  const programIds = report.programs?.map((program) => program.id).sort();
  const expectedPackKeys = [
    'chinese_structured',
    'default_open',
    'epicmafia',
    'mafia_universe',
    'mafiascum',
  ];
  const expectedProgramIds = [
    'host-judged-showcase',
    'mash-scale-acceptance',
    'opt-in-quest',
    'private-opt-in-circle',
    'raffle',
  ];
  const packRefsMatchHost =
    JSON.stringify(report.packs) === JSON.stringify(hostReport.packs);
  const programRefsMatchHost =
    JSON.stringify(report.programs) === JSON.stringify(hostReport.programs);
  if (
    report.status !== 'ok' ||
    report.pack_count !== 5 ||
    report.program_count !== 5 ||
    !/^[0-9a-f]{64}$/.test(report.registry_hash) ||
    JSON.stringify(packKeys) !== JSON.stringify(expectedPackKeys) ||
    JSON.stringify(programIds) !== JSON.stringify(expectedProgramIds) ||
    report.registry_hash !== hostReport.registry_hash ||
    report.pack_count !== hostReport.pack_count ||
    report.program_count !== hostReport.program_count ||
    !packRefsMatchHost ||
    !programRefsMatchHost
  ) {
    throw new Error(
      `image content does not exactly match the host registry:\nhost=${hostOutput}\nimage=${first}`,
    );
  }
  process.stdout.write(
    `${JSON.stringify({
      status: 'ok',
      engine,
      image_id: imageId,
      runtime_uid: 10001,
      event_key_admin_binary: true,
      runtime_content_directories: false,
      registry_hash: report.registry_hash,
      host_registry_match: true,
      exact_pack_refs: report.packs,
      exact_program_refs: report.programs,
      pack_count: report.pack_count,
      program_count: report.program_count,
    })}\n`,
  );
} finally {
  spawnSync(engine, ['image', 'rm', '--force', image], { stdio: 'ignore' });
  rmSync(scratch, { recursive: true, force: true });
}
