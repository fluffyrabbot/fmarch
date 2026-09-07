// Content identity for the Linux browser/font/runtime environment. No dates or
// checkout paths enter the digest; source identity lives in the proof key.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { arch, release } from 'node:os';
import { chromium } from 'playwright';
const root = new URL('../', import.meta.url);
const command = (name, args) => execFileSync(name, args, {encoding: 'utf8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024}).trim();
async function digestFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
if (process.platform !== 'linux') throw new Error('Linux proof environment requires Linux');
const fonts = [...new Set(command('fc-list', ['--format', '%{file}\n']).split('\n').filter(Boolean))].sort();
if (!fonts.length) throw new Error('Linux browser proof requires installed fonts');
const fontIdentities = [];
for (const file of fonts) fontIdentities.push({file, sha256: await digestFile(file)});
const snapshot = {
  schemaVersion: 1, platform: 'linux', arch: arch(), kernel: release(),
  node: process.version, npm: command('npm', ['--version']),
  rustc: command('rustc', ['--version', '--verbose']),
  postgres: {version: command('postgres', ['--version']), configure: command('pg_config', ['--configure']), sha256: await digestFile(command('pg_config', ['--bindir']) + '/postgres')},
  packages: command('pacman', ['-Q']).split('\n').sort(),
  browsers: JSON.parse(await readFile(new URL('node_modules/playwright-core/browsers.json', root), 'utf8')),
  chromium: {version: command(chromium.executablePath(), ['--version']), sha256: await digestFile(chromium.executablePath())},
  fonts: fontIdentities,
};
const content = JSON.stringify(snapshot, null, 2) + '\n';
const sha = createHash('sha256').update(content).digest('hex');
const directory = new URL('target/proof-environments/', root);
await mkdir(directory, {recursive: true});
try { await writeFile(new URL(`${sha}.json`, directory), content, {flag: 'wx'}); }
catch (error) {
  if (error.code !== 'EEXIST') throw error;
  if (await readFile(new URL(`${sha}.json`, directory), 'utf8') !== content) throw new Error('Proof environment snapshot is corrupt');
}
console.log(sha);
