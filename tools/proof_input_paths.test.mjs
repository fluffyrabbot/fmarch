import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { assertNoIgnoredProofInputs, assertProofInputPaths, UnsafeProofInputError } from './proof_input_paths.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'fmarch-input-paths-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (path, text = 'fixture') => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  const check = (files, selectors) => assertProofInputPaths({ root, files, selectors });
  return { root, write, check };
}

test('direct and dangling selected source symlinks fail closed', t => {
  const { root, write, check } = fixture(t);
  write('real.json');
  for (const [name, target] of [['fixture.json', 'real.json'], ['missing.json', 'absent.json']]) {
    symlinkSync(target, join(root, name));
    assert.throws(() => check([name], [{ kind: 'file', path: name }]), UnsafeProofInputError);
  }
});

test('missing selected files do not hide symlink ancestors', t => {
  const { root, check } = fixture(t);
  symlinkSync('absent-directory', join(root, 'fixtures'));
  assert.throws(() => check([], [{ kind: 'file', path: 'fixtures/missing.json' }]), /Unsafe proof input fixtures/);
  assert.throws(() => check(['fixtures/missing.json'], [{ kind: 'glob', path: '**/*.json' }]), /Unsafe proof input fixtures/);
});

test('Git-visible directory links cannot hide prefix and glob inputs', t => {
  const { root, write, check } = fixture(t);
  write('outside/a.json');
  mkdirSync(join(root, 'fixtures'));
  symlinkSync('../outside', join(root, 'fixtures/linked'));
  for (const selector of [
    { kind: 'prefix', path: 'fixtures/linked/' },
    { kind: 'glob', path: 'fixtures/**/*.json' },
    { kind: 'glob', path: 'fixtures/*/*.json' },
    { kind: 'glob', path: '**/a.json' },
    { kind: 'glob', path: '{fixtures/linked,other}/a.json' },
  ]) assert.throws(() => check(['fixtures/linked'], [selector]), /symlinks are not allowed/, selector.path);
});

test('literal bracket routes retain literal path semantics', t => {
  const { root, write, check } = fixture(t);
  write('routes/[game]/+page.svelte');
  check(['routes/[game]/+page.svelte'], [{ kind: 'file', path: 'routes/[game]/+page.svelte' }]);
  rmSync(join(root, 'routes/[game]'), { recursive: true });
  symlinkSync('missing', join(root, 'routes/[game]'));
  assert.throws(() => check(['routes/[game]'], [{ kind: 'prefix', path: 'routes/[game]/' }]), /symlinks/);
});

test('unrelated links remain outside selected source scope', t => {
  const { root, write, check } = fixture(t);
  write('fixtures/a.json');
  symlinkSync('absent', join(root, 'unrelated'));
  mkdirSync(join(root, 'crates/example'), { recursive: true });
  symlinkSync('absent', join(root, 'crates/example/src'));
  check(['unrelated', 'fixtures/a.json', 'crates/example/src'], [
    { kind: 'prefix', path: 'fixtures/' }, { kind: 'glob', path: 'crates/*/Cargo.toml' },
  ]);
});

test('ordinary file additions deletions and renames remain valid inputs', t => {
  const { root, write, check } = fixture(t);
  const selectors = [{ kind: 'prefix', path: 'fixtures/' }];
  check([], selectors);
  write('fixtures/old.json');
  check(['fixtures/old.json'], selectors);
  renameSync(join(root, 'fixtures/old.json'), join(root, 'fixtures/new.json'));
  check(['fixtures/old.json', 'fixtures/new.json'], selectors);
  rmSync(join(root, 'fixtures/new.json'));
  check(['fixtures/old.json', 'fixtures/new.json'], selectors);
});

test('opaque directories and special files cannot be accepted as Git input files', t => {
  const { root, check } = fixture(t);
  mkdirSync(join(root, 'opaque'));
  assert.throws(() => check(['opaque'], [{ kind: 'prefix', path: 'opaque/' }]), /opaque directory/);
  execFileSync('mkfifo', [join(root, 'pipe')]);
  assert.throws(() => check(['pipe'], [{ kind: 'file', path: 'pipe' }]), /unsupported filesystem type/);
});

function gitFixture(t) {
  const value = fixture(t);
  const git = (...args) => execFileSync('git', args, { cwd: value.root });
  git('init', '--quiet');
  return { ...value, git, admit: selectors => assertNoIgnoredProofInputs({ root: value.root, selectors }) };
}

test('ignored modules under consumed Cargo source roots are rejected', t => {
  const { write, git, admit } = gitFixture(t);
  write('.gitignore', '/crates/codec/src/local_fixture.rs\n');
  write('crates/codec/src/lib.rs', 'mod local_fixture;');
  write('crates/codec/src/local_fixture.rs', 'pub const VALUE: u32 = 1;');
  git('add', '.gitignore', 'crates/codec/src/lib.rs');
  assert.throws(() => admit([{ kind: 'prefix', path: 'crates/codec/src/' }]),
    /Unsafe proof input crates\/codec\/src\/local_fixture.rs: ignored source or fixture/);
});

test('exact ignored fixtures reject while tracked fixtures retain literal bracket paths', t => {
  const { write, git, admit } = gitFixture(t);
  write('.gitignore', '/fixtures/\n');
  write('fixtures/[game]/input.json', '{}');
  const selectors = [{ kind: 'file', path: 'fixtures/[game]/input.json' }];
  assert.throws(() => admit(selectors), /ignored source or fixture/);
  git('add', '--force', 'fixtures/[game]/input.json');
  admit(selectors);
});

test('ignored directory and linked roots cannot hide selected descendants', async t => {
  for (const linked of [false, true]) {
    await t.test(linked ? 'linked root' : 'directory root', t => {
      const { root, write, admit } = gitFixture(t);
      write('.gitignore', '/crates/codec/src/hidden\n');
      write('crates/codec/src/lib.rs');
      if (linked) symlinkSync('missing-external-directory', join(root, 'crates/codec/src/hidden'));
      else write('crates/codec/src/hidden/module.rs');
      assert.throws(() => admit([{ kind: 'glob', path: 'crates/*/src/**/*.rs' }]),
        /Unsafe proof input crates\/codec\/src\/hidden: ignored source or fixture/);
    });
  }
});

test('unrelated ignored dependency and build trees remain outside consumed selectors', t => {
  const { root, write, admit } = gitFixture(t);
  write('.gitignore', 'node_modules/\ntarget/\nbuild/\n/crates/other/src/ignored.rs\n');
  write('node_modules/dependency/nested/input.json');
  write('frontend/node_modules/dependency/nested/input.json');
  write('crates/codec/target/generated/input.rs');
  write('crates/codec/build/generated/input.rs');
  write('crates/other/src/ignored.rs');
  symlinkSync('missing-external-directory', join(root, 'node_modules/linked'));
  write('crates/codec/src/lib.rs');
  write('fixtures/input.json');
  admit([
    { kind: 'prefix', path: 'crates/codec/src/' },
    { kind: 'file', path: 'fixtures/input.json' },
  ]);
});

test('ignored inventory does not mistake unignored ancestors for selected input directories', t => {
  const { write, admit } = gitFixture(t);
  write('.gitignore', '*.txt\n');
  // Without tracked or visible siblings, git ls-files --directory also reports
  // unignored crates/, codec/, and src/ ancestors. Only the txt file is ignored.
  write('crates/codec/src/notes.txt');
  admit([{ kind: 'glob', path: 'crates/*/src/**/*.rs' }]);
});

test('ignored admission accepts no matches and ordinary visible additions and deletions', t => {
  const { root, write, git, admit } = gitFixture(t);
  const selectors = [{ kind: 'prefix', path: 'crates/codec/src/' }];
  admit([]);
  admit(selectors);
  write('crates/codec/src/new.rs');
  admit(selectors);
  git('add', 'crates/codec/src/new.rs');
  renameSync(join(root, 'crates/codec/src/new.rs'), join(root, 'crates/codec/src/renamed.rs'));
  admit(selectors);
  rmSync(join(root, 'crates/codec/src/renamed.rs'));
  admit(selectors);
});
