import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readDeclaration, rustTokens, renderReference, checkReference, SOURCES, OUTPUT } from './rust_reference.mjs';

test('reads nested payloads while ignoring comments, attributes and quoted Rust', () => {
  const source = '/* outer /* nested */ pub enum E {} */\nconst S: &str = r##"pub enum E { Fake }"##;\npub enum E { Unit, Tuple(Vec<(u8, String)>, crate::Id), Named { #[serde(default)] value: Option<Vec<u8>>, }, }';
  assert.deepEqual(readDeclaration(source, 'E'), { name: 'E', kind: 'enum', line: 3, members: [
    { name: 'Unit', declaration: 'unit' }, { name: 'Tuple', declaration: '(Vec<(u8, String)>, crate::Id)' }, { name: 'Named', declaration: '{ value: Option<Vec<u8>> }' },
  ] });
  assert.deepEqual(readDeclaration('pub struct S { pub(crate) id: crate::Id }', 'S').members, [{ name: 'id', declaration: 'id: crate::Id' }]);
});
test('fails closed for missing, ambiguous, conditional and unsupported selected shapes', () => {
  for (const source of ['', 'pub enum E { A } pub enum E { B }', 'pub enum E<T> { A(T) }', 'pub enum E { A = 1 }', 'pub enum E { #[cfg(foo)] A }', 'pub enum E { A(']) assert.throws(() => readDeclaration(source, 'E'));
  for (const source of ['/* open', 'r#"open', '"open']) assert.throws(() => rustTokens(source));
});
test('freshness rejects source changes and missing output', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fmarch-reference-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [file, names] of SOURCES) { await mkdir(path.dirname(path.join(root, file)), { recursive: true }); await writeFile(path.join(root, file), names.map(name => `pub enum ${name} { A }`).join('\n')); }
  await assert.rejects(checkReference(root), /stale or missing/);
  await mkdir(path.dirname(path.join(root, OUTPUT)), { recursive: true });
  await writeFile(path.join(root, OUTPUT), await renderReference(root));
  await checkReference(root);
  const [file, names] = SOURCES[0];
  await writeFile(path.join(root, file), names.map(name => `pub enum ${name} { A, Added }`).join('\n'));
  await assert.rejects(checkReference(root), /stale or missing/);
});

test('renders nongeneric aliases and tuple newtypes without treating private fields as public constructors', () => {
  assert.deepEqual(readDeclaration('pub type Seed = u64;', 'Seed'), {
    name: 'Seed', kind: 'type', line: 1, members: [{ name: 'Target', declaration: 'u64' }],
  });
  assert.deepEqual(readDeclaration('pub struct Seconds(i64);', 'Seconds').members, [{ name: '0', declaration: 'i64' }]);
  assert.deepEqual(readDeclaration('pub struct Pair(pub Vec<(u8, String)>, crate::Id);', 'Pair').members, [
    { name: '0', declaration: 'Vec<(u8, String)>' }, { name: '1', declaration: 'crate::Id' },
  ]);
  for (const source of ['pub type Seed<T> = T;', 'pub type Seed =;', 'pub type Seed = Vec<u8;', 'pub struct Seconds(i64) where T: Copy;']) {
    assert.throws(() => readDeclaration(source, source.includes('Seconds') ? 'Seconds' : 'Seed'));
  }
});

test('architecture chapters link to references instead of copying Rust type inventories', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fromMarkdown } = await import('mdast-util-from-markdown');
  for (const chapter of ['09-engine-and-packs', '10-event-schema', '14-mash-and-manual-frontier']) {
    const source = await readFile(new URL(`../docs/arch/${chapter}.md`, import.meta.url), 'utf8');
    const visit = node => {
      if (node.type === 'code' && node.lang === 'rust') {
        assert.doesNotMatch(node.value, /^(?:pub\s+)?(?:struct|enum|type)\s+\w+/m, `${chapter}: link to the generated declaration instead`);
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(fromMarkdown(source));
  }
});
