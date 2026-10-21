import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { loadManifest } from './proof_lane_select.mjs';
import { PREBUILT_PLAN_ENV, prebuiltBinary, proofBinarySpawn } from './proof_cargo_builds.mjs';
import {
  CARGO_DEPS_DIR_ENV,
  RUN_PHASE_CARGO_EXIT_CODE,
  buildBinaries,
  buildTests,
  cargoConfigEnvironment,
  parseCargoTestArgs,
  prebuildInvocations,
  runPhaseCargoShim,
  runTests,
  validatePrebuild,
} from './proof_prebuild.mjs';

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), 'fmarch-prebuild-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, '.cargo'), { recursive: true });
  await writeFile(join(root, '.cargo', 'config.toml'), '[env]\nRUST_TEST_THREADS = { value = "4", force = false }\n');
  for (const name of ['lib-a1', 'pipeline-b2', 'admin-c3']) {
    await mkdir(join(root, 'target', 'debug', 'deps'), { recursive: true });
    await writeFile(join(root, 'target', 'debug', 'deps', name), name);
  }
  await writeFile(join(root, 'target', 'debug', 'fmarch-admin'), 'admin');
  await mkdir(join(root, 'crates', 'commands'), { recursive: true });
  return root;
}

function child({ stdout = '', status = 0 } = {}) {
  const emitter = new EventEmitter();
  emitter.stdout = new EventEmitter();
  setImmediate(() => {
    if (stdout) emitter.stdout.emit('data', Buffer.from(stdout));
    emitter.emit('close', status, null);
  });
  return emitter;
}

function artifacts(root) {
  const manifestPath = join(root, 'crates', 'commands', 'Cargo.toml');
  const packageId = `path+file://${join(root, 'crates', 'commands')}#0.1.0`;
  const message = (target, executable, testProfile) => JSON.stringify({
    reason: 'compiler-artifact', package_id: packageId, manifest_path: manifestPath,
    target: { ...target, src_path: join(root, 'crates', 'commands', target.src) },
    profile: { test: testProfile }, executable,
  });
  return [
    message({ kind: ['test'], name: 'pipeline', src: 'tests/pipeline.rs' }, join(root, 'target/debug/deps/pipeline-b2'), true),
    'Compiling noise that is not JSON',
    message({ kind: ['lib'], name: 'commands', src: 'src/lib.rs' }, join(root, 'target/debug/deps/lib-a1'), true),
    message({ kind: ['lib'], name: 'commands', src: 'src/lib.rs' }, null, false),
    message({ kind: ['bin'], name: 'fmarch-admin', src: 'src/bin/admin.rs' }, join(root, 'target/debug/fmarch-admin'), false),
  ].join('\n');
}

function fakeCargo(root, calls) {
  return (file, args, options) => {
    calls.push({ file, args, options });
    if (args[0] === 'metadata') {
      return child({ stdout: JSON.stringify({ packages: [{
        name: 'commands', version: '0.1.0-rc.1', authors: ['a', 'b'],
        manifest_path: join(root, 'crates', 'commands', 'Cargo.toml'),
      }] }) });
    }
    return child({ stdout: artifacts(root) });
  };
}

test('cargo test arguments split into compilation selection and forwarded test arguments', () => {
  assert.deepEqual(
    parseCargoTestArgs(['--no-fail-fast', '-p', 'projections', '--lib', '--test=e2e', '-pcommands', '--features', 'x', 'scheduler_', '--', '--test-threads=1']),
    {
      selection: ['-p', 'projections', '--lib', '--test', 'e2e', '-p', 'commands', '--features', 'x'],
      filters: ['scheduler_'],
      testArgs: ['--test-threads=1'],
      noFailFast: true,
    },
  );
  for (const [args, pattern] of [
    [['-p', 'x'], /explicit --lib\/--bin\/--test/],
    [['-p', 'x', '--doc'], /does not support --doc/],
    [['-p', 'x', '--lib', '--no-run'], /does not support --no-run/],
    [['-p', 'x', '--lib', '-q'], /does not support -q/],
    [['-p', 'x', '--lib', '--frobnicate'], /does not recognize --frobnicate/],
    [['--lib', '-p'], /requires a value/],
    [['--lib', '--test', '--', 'x'], /requires a value/],
  ]) assert.throws(() => parseCargoTestArgs(args), pattern);
});

test('every real cargo-test lane parses, and its build and run argv bind the same selection', () => {
  const manifest = loadManifest();
  let checked = 0;
  for (const [id, lane] of Object.entries(manifest.lanes)) {
    if (lane.execution.prebuild !== 'cargo-test') continue;
    checked += 1;
    assert.equal(validatePrebuild(id, lane), 'cargo-test');
    const { build, run } = prebuildInvocations(id, lane, { planPath: '/run/plan.json' });
    assert.deepEqual(build.slice(0, 6), ['node', 'tools/proof_prebuild.mjs', 'build-tests', '--plan', '/run/plan.json', '--']);
    const cargoIndex = lane.execution.argv.indexOf('cargo');
    assert.deepEqual(build.slice(6), lane.execution.argv.slice(cargoIndex + 2));
    assert.deepEqual(run.slice(0, cargoIndex), lane.execution.argv.slice(0, cargoIndex), `${id} keeps its evidence wrapper`);
    assert.deepEqual(run.slice(cargoIndex, cargoIndex + 6), ['node', 'tools/proof_prebuild.mjs', 'run-tests', '--plan', '/run/plan.json', '--']);
    assert.deepEqual(run.slice(cargoIndex + 6), build.slice(6));
    assert.ok(!run.includes('cargo'), `${id} run phase must not invoke Cargo`);
  }
  assert.ok(checked >= 30);
  const live = manifest.lanes['test:dev-test-game-profile'];
  assert.deepEqual(prebuildInvocations('test:dev-test-game-profile', live, { planPath: '/p.json' }), {
    build: ['node', 'tools/proof_prebuild.mjs', 'build-binaries', '--plan', '/p.json', '--lane', 'test:dev-test-game-profile'],
    run: live.execution.argv,
  });
});

test('a cargo-test build compiles the exact selection and pins executables by hard link', async (t) => {
  const root = await workspace(t);
  const calls = [];
  const planPath = join(root, 'lane', 'prebuild-plan.json');
  await mkdir(join(root, 'lane'), { recursive: true });
  const plan = await buildTests({ planPath, args: ['-p', 'commands', '--lib', '--test', 'pipeline', 'filter', '--', '--test-threads=4'], root, env: {}, spawn: fakeCargo(root, calls) });
  assert.deepEqual(calls[0].args, ['test', '--no-run', '--message-format=json-render-diagnostics', '-p', 'commands', '--lib', '--test', 'pipeline']);
  assert.equal(calls[1].args[0], 'metadata');
  // Cargo order: libraries, then binaries, then integration tests.
  assert.deepEqual(plan.tests.map((entry) => `${entry.kind}:${entry.name}`), ['lib:commands', 'test:pipeline']);
  assert.equal(plan.tests[1].src_path, 'tests/pipeline.rs');
  const linked = plan.tests[0].path;
  assert.equal(linked, join(root, 'lane', 'prebuilt', 'tests', 'lib-a1'));
  assert.equal((await stat(linked)).ino, (await stat(join(root, 'target/debug/deps/lib-a1'))).ino);
  assert.equal(plan.binaries['commands/fmarch-admin'], join(root, 'lane', 'prebuilt', 'bin', 'commands', 'fmarch-admin'));
  assert.equal(plan.packages.commands.CARGO_PKG_VERSION_PRE, 'rc.1');
  assert.equal(plan.packages.commands.CARGO_PKG_AUTHORS, 'a:b');
  assert.deepEqual(JSON.parse(await readFile(planPath, 'utf8')), plan);
});

test('run-tests reproduces cargo test execution without Cargo', async (t) => {
  const root = await workspace(t);
  const planPath = join(root, 'lane', 'prebuild-plan.json');
  await mkdir(join(root, 'lane'), { recursive: true });
  const args = ['-p', 'commands', '--lib', '--test', 'pipeline', 'scheduler_', '--', '--test-threads=1'];
  await buildTests({ planPath, args, root, env: {}, spawn: fakeCargo(root, []) });
  const runs = [];
  const status = await runTests({
    planPath, args, root, log: () => {},
    env: { PATH: '/bin', RUST_TEST_THREADS: undefined },
    spawn(file, forwarded, options) {
      runs.push({ file, forwarded, options });
      return child();
    },
  });
  assert.equal(status, 0);
  assert.equal(runs.length, 2);
  for (const entry of runs) {
    assert.ok(!entry.file.includes('target/debug'), 'tests run from the lane-pinned links');
    assert.deepEqual(entry.forwarded, ['scheduler_', '--test-threads=1']);
    assert.equal(entry.options.cwd, join(root, 'crates', 'commands'));
    assert.equal(entry.options.env.CARGO_MANIFEST_DIR, join(root, 'crates', 'commands'));
    assert.equal(entry.options.env.CARGO_PKG_NAME, 'commands');
    assert.equal(entry.options.env.RUST_TEST_THREADS, '4', '.cargo/config.toml [env] applies when unset');
    assert.equal(entry.options.env['CARGO_BIN_EXE_fmarch-admin'],
      join(root, 'lane', 'prebuilt', 'bin', 'commands', 'fmarch-admin'));
    assert.equal(entry.options.env[CARGO_DEPS_DIR_ENV], join(root, 'target', 'debug', 'deps'),
      'a relocated test can still find the rlibs Cargo built beside it');
  }
  assert.equal(runs[0].options.env.CARGO_CRATE_NAME, 'commands');
  assert.equal(runs[1].options.env.CARGO_CRATE_NAME, 'pipeline');

  const overridden = [];
  await runTests({
    planPath, args, root, log: () => {}, env: { RUST_TEST_THREADS: '1' },
    spawn(file, forwarded, options) { overridden.push(options.env.RUST_TEST_THREADS); return child(); },
  });
  assert.deepEqual(overridden, ['1', '1'], 'force = false keeps the caller value');
});

test('run-tests stops at the first failing executable unless --no-fail-fast', async (t) => {
  const root = await workspace(t);
  const planPath = join(root, 'lane', 'prebuild-plan.json');
  await mkdir(join(root, 'lane'), { recursive: true });
  for (const [noFailFast, expectedRuns] of [[false, 1], [true, 2]]) {
    const args = [...(noFailFast ? ['--no-fail-fast'] : []), '-p', 'commands', '--lib', '--test', 'pipeline'];
    await buildTests({ planPath, args, root, env: {}, spawn: fakeCargo(root, []) });
    let runs = 0;
    const lines = [];
    const status = await runTests({
      planPath, args, root, env: {}, log: (line) => lines.push(line),
      spawn() { runs += 1; return child({ status: 101 }); },
    });
    assert.equal(status, 101);
    assert.equal(runs, expectedRuns);
    assert.ok(lines.some((line) => line.includes('error: test failed')));
  }
});

test('run-tests refuses a plan compiled for a different selection or missing executables', async (t) => {
  const root = await workspace(t);
  const planPath = join(root, 'lane', 'prebuild-plan.json');
  await mkdir(join(root, 'lane'), { recursive: true });
  await buildTests({ planPath, args: ['-p', 'commands', '--lib'], root, env: {}, spawn: fakeCargo(root, []) });
  await assert.rejects(
    runTests({ planPath, args: ['-p', 'commands', '--lib', '--test', 'pipeline'], root, env: {}, spawn: () => child(), log: () => {} }),
    /different selection/,
  );
  // Test-name filters and forwarded arguments are runtime, not selection.
  assert.equal(await runTests({ planPath, args: ['-p', 'commands', '--lib', 'name', '--', '--exact'], root, env: {}, spawn: () => child(), log: () => {} }), 0);
  await rm(join(root, 'lane', 'prebuilt'), { recursive: true });
  await assert.rejects(
    runTests({ planPath, args: ['-p', 'commands', '--lib'], root, env: {}, spawn: () => child(), log: () => {} }),
    /prebuilt test executable is missing/,
  );
});

test('cargo-builds prebuilds each declared binary and harnesses resolve only declared ones', async (t) => {
  const root = await workspace(t);
  const planPath = join(root, 'lane', 'prebuild-plan.json');
  await mkdir(join(root, 'lane'), { recursive: true });
  await mkdir(join(root, 'crates', 'server'), { recursive: true });
  for (const name of ['server', 'fmarch-migrate']) await writeFile(join(root, 'target', 'debug', name), name);
  const manifest = { lanes: { live: { cargo_inputs: { builds: [
    { target: 'server/bin/server', profile: 'dev' },
    { target: 'server/bin/fmarch-migrate', profile: 'dev' },
  ] } } } };
  const calls = [];
  const plan = await buildBinaries({
    planPath, laneId: 'live', manifest, root, env: {},
    spawn(file, args) {
      calls.push(args);
      const name = args[args.indexOf('--bin') + 1];
      return child({ stdout: [
        JSON.stringify({ reason: 'compiler-artifact', package_id: `path+file://${join(root, 'crates', 'server')}#0.1.0`,
          manifest_path: join(root, 'crates', 'server', 'Cargo.toml'), target: { kind: ['bin'], name },
          profile: { test: false }, executable: join(root, 'target', 'debug', name) }),
        JSON.stringify({ reason: 'build-finished', success: true }),
      ].join('\n') });
    },
  });
  assert.deepEqual(calls, [
    ['build', '--locked', '--profile', 'dev', '-p', 'server', '--bin', 'server', '--message-format=json-render-diagnostics'],
    ['build', '--locked', '--profile', 'dev', '-p', 'server', '--bin', 'fmarch-migrate', '--message-format=json-render-diagnostics'],
  ]);
  const server = join(root, 'lane', 'prebuilt', 'bin', 'dev', 'server', 'server');
  assert.equal(plan.binaries['server/bin/server@dev'], server);

  const env = { [PREBUILT_PLAN_ENV]: planPath };
  assert.equal(prebuiltBinary({ target: 'server/bin/server', env }), server);
  assert.deepEqual(proofBinarySpawn({ laneId: 'live', manifest, target: 'server/bin/server', args: ['--x'], env }), [server, ['--x']]);
  assert.throws(() => prebuiltBinary({ target: 'server/bin/server', profile: 'release', env }), /no prebuilt server\/bin\/server \(release\)/);
  assert.throws(() => prebuiltBinary({ target: 'operator_proof/bin/audit', env }), /declare it in cargo_inputs/);
  // Without a plan, direct developer runs still go through `cargo run`.
  assert.deepEqual(proofBinarySpawn({ laneId: 'live', manifest, target: 'server/bin/server', env: {} }),
    ['cargo', ['run', '--locked', '--profile', 'dev', '-p', 'server', '--bin', 'server']]);
});

test('the repository Cargo [env] table parses and unknown shapes fail closed', () => {
  const real = cargoConfigEnvironment(readFileSync(new URL('../.cargo/config.toml', import.meta.url), 'utf8'));
  assert.deepEqual(real.RUST_TEST_THREADS, { value: '4', force: false });
  assert.deepEqual(cargoConfigEnvironment('[build]\njobs = 2\n[env]\nA = "x" # comment\nB = { value = "y", force = true }\n'), {
    A: { value: 'x', force: false }, B: { value: 'y', force: true },
  });
  assert.throws(() => cargoConfigEnvironment('[env]\nA = 1\n'), /unsupported/);
  assert.throws(() => cargoConfigEnvironment('[env]\nA = { value = "x", relative = true }\n'), /unsupported/);
});

test('the run-phase cargo shim refuses with a distinct exit code', () => {
  const shim = runPhaseCargoShim();
  assert.match(shim, /^#!\/bin\/sh\n/);
  assert.match(shim, new RegExp(`exit ${RUN_PHASE_CARGO_EXIT_CODE}\\n$`));
  assert.match(shim, /invoked cargo during its run phase/);
});
