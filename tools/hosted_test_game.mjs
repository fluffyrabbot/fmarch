// Provision a dedicated game through the hosted command API after real admission.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {stagingOrigins, readSession, authenticatedPrincipal} from './hosted_authenticated_acceptance.mjs';
import {checkHostedReadiness, hostedAcceptanceConfig} from './hosted_acceptance.mjs';
export function hostedGameCommands(game, member) {
  return [
    {CreateGame: {game, pack: 'mafiascum', cohost_denied: []}},
    {AddSlot: {game, slot: 'slot_1'}},
    {SeatPersona: {game, slot: 'slot_1', principal_id: member, public_name: 'Acceptance player'}},
    {AssignRole: {game, slot: 'slot_1', role_key: 'vanilla_townie'}},
    {StartGame: {game, phase: 'D01'}},
  ];
}
export async function provisionHostedTestGame(env = process.env) {
  const target = hostedAcceptanceConfig(env);
  assert.equal(target.api, stagingOrigins.api);
  assert.equal(target.frontend, stagingOrigins.frontend);
  await checkHostedReadiness(target);
  const member = await readSession(env.FMARCH_HOSTED_ACCEPTANCE_MEMBER_STATE, target);
  const outsider = await readSession(env.FMARCH_HOSTED_ACCEPTANCE_OUTSIDER_STATE, target);
  const game = randomUUID();
  const principal = await authenticatedPrincipal(target, member, game);
  assert.notEqual(principal, await authenticatedPrincipal(target, outsider, game), 'Separate admitted accounts are required');
  const commands = hostedGameCommands(game, principal).map(command => ({command_id: randomUUID(), command}));
  const directory = path.resolve(env.FMARCH_HOSTED_ACCEPTANCE_OUTPUT ?? 'target/hosted-acceptance');
  await mkdir(directory, {recursive: true, mode: 0o700});
  const file = path.join(directory, `${game}.preparation.json`);
  const record = {status: 'preparing', game, channel: 'private:role_pm:slot_1', expectedCommit: target.commit, commands, acknowledged: 0};
  await writeFile(file, JSON.stringify(record, null, 2) + '\n', {flag: 'wx', mode: 0o600});
  try {
    for (const [index, command] of commands.entries()) {
      const response = await fetch(`${target.api}/commands`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000),
        headers: {'content-type': 'application/json', authorization: `Bearer ${member.value}`},
        body: JSON.stringify({v: 3, id: index + 1, body: {kind: 'Command', body: command}}),
      });
      assert.equal(response.status, 200, 'Hosted preparation command failed');
      const envelope = await response.json();
      assert.equal(envelope.body?.kind, 'Ack', 'Hosted preparation command was rejected');
      record.acknowledged += 1;
      await writeFile(file, JSON.stringify(record, null, 2) + '\n', {mode: 0o600});
    }
    await checkHostedReadiness(target);
    record.status = 'prepared';
    await writeFile(file, JSON.stringify(record, null, 2) + '\n', {mode: 0o600});
    console.log(JSON.stringify({status: 'prepared', game, channel: record.channel, confirmation: `staging:${game}`, receipt: file}));
    return record;
  } catch {
    throw Error(`Hosted game preparation did not complete; retain ${file} for the exact game and acknowledged commands. No acceptance has been claimed.`);
  }
}
if (pathToFileURL(process.argv[1] ?? '').href === import.meta.url) provisionHostedTestGame().catch(error => {console.error(error.message);process.exitCode = 1;});
