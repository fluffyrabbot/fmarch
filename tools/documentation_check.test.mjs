import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkDocumentation, npmCommands } from './documentation_check.mjs';

test('checks parsed links, duplicate heading anchors, source lines and package-specific commands without execution', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fmarch-docs-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = {
    'package.json': JSON.stringify({ scripts: { safe: 'touch SHOULD_NOT_EXIST' } }),
    'frontend/package.json': JSON.stringify({ scripts: { build: 'unused' } }),
    'docs/a.md': '# Héllo\n# Héllo\n[valid](#héllo-1)\n[ref][target]\n\n[target]: ../source.rs#L2\n\n`npm run safe`\n```sh\nnpm --prefix frontend run build\n```\n```md\n[ignored](missing)\n```\n[broken](#héllo-2)\n[missing](absent.md)\n`npm run unknown`\n`npm --prefix frontend run safe`\n[bad line](../source.rs#L90)\n',
    'source.rs': '// one\n// two\n',
  };
  for (const [file, body] of Object.entries(files)) { await mkdir(path.dirname(path.join(root, file)), { recursive: true }); await writeFile(path.join(root, file), body); }
  const issues = await checkDocumentation(root, Object.keys(files));
  assert.equal(issues.length, 5, issues.join('\n'));
  assert.match(issues.join('\n'), /missing heading/);
  assert.match(issues.join('\n'), /missing local link/);
  assert.match(issues.join('\n'), /unknown npm script: frontend: safe/);
  assert.match(issues.join('\n'), /invalid source line/);
  const { existsSync } = await import('node:fs');
  assert.equal(existsSync(path.join(root, 'SHOULD_NOT_EXIST')), false);
});
test('recognizes multiline root and prefix invocations, excluding placeholders', () => {
  assert.deepEqual(npmCommands('npm run\n check:docs; npm run --prefix frontend build; npm run <script>'), [
    { prefix: '.', name: 'check:docs' }, { prefix: 'frontend', name: 'build' },
  ]);
});
