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
