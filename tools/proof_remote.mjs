#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
function git(...args) {
  const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 30_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o ConnectTimeout=10' } });
  if (r.status !== 0) throw new Error(r.stderr || `git ${args[0]} failed`);
  return r.stdout.trim();
}
export function parseRemoteMode(args) {
  const mode = args.length === 0 ? 'full' : args.length === 2 && args[0] === '--mode' ? args[1] : null;
  if (!['push', 'sprint', 'full', 'audit'].includes(mode)) throw new Error('Usage: proof:remote [--mode push|sprint|full|audit]');
  return mode;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
const mode = parseRemoteMode(process.argv.slice(2));
if (git('status', '--porcelain')) throw new Error('Commit and push the task checkpoint before remote proof');
const branch = git('branch', '--show-current');
if (!branch || branch === 'main' || branch === 'production') throw new Error('Remote proof requires a named pushed task branch');
const sha = git('rev-parse', 'HEAD');
const fleet = join(process.env.FLUFFYFLEET_ROOT || join(homedir(), 'apps', 'fluffyfleet'), 'scripts', 'fleet.mjs');
const result = spawnSync(process.execPath, [fleet, 'enqueue', 'fmarch', '--host', 'cachy',
  '--verification-mode', mode === 'full' ? 'default' : mode, '--remote-ref', branch, '--expected-sha', sha, '--verify-only', '--keep-worktree',
  '--goal', `Verify fmarch ${mode} checkpoint ${sha} on canonical Linux resources`],
{ stdio: 'inherit', timeout: 60_000, env: {...process.env, GIT_TERMINAL_PROMPT: '0'} });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
}
