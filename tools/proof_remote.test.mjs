import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseRemoteMode } from './proof_remote.mjs';
test('remote proof accepts only bounded repository modes, with full default', () => {
  assert.equal(parseRemoteMode([]), 'full');
  for (const mode of ['push', 'sprint', 'full']) assert.equal(parseRemoteMode(['--mode', mode]), mode);
  for (const args of [['--mode'], ['--mode','only'], ['--mode','push','--skip','cargo:api'], ['--base','HEAD'], ['--mode','push; true']]) assert.throws(() => parseRemoteMode(args));
});
test('narrow Linux modes use controller-pinned base and the common heavy workflow', () => {
  const p = JSON.parse(fs.readFileSync(new URL('../.fluffyfleet.json', import.meta.url))).profiles.linux;
  assert.equal(p.resourceClass, 'heavy');
  for (const mode of ['push','sprint']) assert.deepEqual(p.verificationModes[mode], [`bash scripts/linux-proof.sh --mode ${mode} --base "$FLEET_COMPARISON_SHA" --jobs 2 --keep-going`]);
  assert.match(p.verify[0], /--mode full/);
});
