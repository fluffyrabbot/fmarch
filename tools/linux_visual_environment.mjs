import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
export async function digestFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export async function linuxVisualEnvironment() {
  if (process.platform !== 'linux') throw new Error('Linux visual identity requires Linux');
  const command = (name, args) => execFileSync(name, args, {encoding:'utf8', timeout:30_000}).trim();
  const files = [...new Set(command('fc-list', ['--format', '%{file}\n']).split('\n').filter(Boolean))].sort();
  if (!files.length) throw new Error('Linux browser proof requires installed fonts');
  const fonts = [];
  for (const file of files) fonts.push({file, sha256:await digestFile(file)});
  const identity = {
    platform:process.platform, arch:process.arch,
    chromium:{version:command(chromium.executablePath(), ['--version']), sha256:await digestFile(chromium.executablePath())},
    fontsSha256:createHash('sha256').update(JSON.stringify(fonts)).digest('hex'),
  };
  return {...identity, sha256:createHash('sha256').update(JSON.stringify(identity)).digest('hex')};
}
