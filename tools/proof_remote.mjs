#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
function git(...args) {
  const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 30_000 });
  if (r.status !== 0) throw new Error(r.stderr || `git ${args[0]} failed`);
  return r.stdout.trim();
}
if (process.argv.length > 2) throw new Error('proof:remote submits the complete repository workflow; it accepts no local command overrides');
if (git('status', '--porcelain')) throw new Error('Commit and push the task checkpoint before remote proof');
const branch = git('branch', '--show-current');
if (!branch) throw new Error('Remote proof requires a named pushed task branch');
const sha = git('rev-parse', 'HEAD');
const fleet = join(process.env.FLUFFYFLEET_ROOT || join(homedir(), 'apps', 'fluffyfleet'), 'scripts', 'fleet.mjs');
const result = spawnSync(process.execPath, [fleet, 'enqueue', 'fmarch', '--host', 'cachy',
  '--remote-ref', branch, '--expected-sha', sha, '--verify-only', '--keep-worktree',
  '--goal', `Verify fmarch checkpoint ${sha} on canonical Linux resources`],
{ stdio: 'inherit', timeout: 60_000, env: {...process.env, GIT_TERMINAL_PROMPT: '0'} });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
