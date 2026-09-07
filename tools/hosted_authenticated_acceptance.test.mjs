import assert from 'node:assert/strict';
import test from 'node:test';
import {authenticatedConfig, sessionFromState, stagingOrigins, assertAuthenticatedReceipt} from './hosted_authenticated_acceptance.mjs';
import {assertHostedReleaseAcceptance} from './release_coordinator_contract.mjs';
const game = '11111111-1111-4111-8111-111111111111';
const env = {FMARCH_HOSTED_ACCEPTANCE_GAME: game, FMARCH_HOSTED_ACCEPTANCE_CHANNEL: 'private:role_pm:slot_1', FMARCH_HOSTED_ACCEPTANCE_CONFIRM: `staging:${game}`, FMARCH_HOSTED_ACCEPTANCE_MEMBER_STATE: '/secure/member.json', FMARCH_HOSTED_ACCEPTANCE_OUTSIDER_STATE: '/secure/outsider.json'};
test('authenticated acceptance requires an explicitly selected staging test game and separate accounts', () => {
  assert.equal(authenticatedConfig(env, stagingOrigins).game, game);
  for (const key of Object.keys(env)) assert.throws(() => authenticatedConfig({...env, [key]: ''}, stagingOrigins));
  assert.throws(() => authenticatedConfig({...env, FMARCH_HOSTED_ACCEPTANCE_OUTSIDER_STATE: env.FMARCH_HOSTED_ACCEPTANCE_MEMBER_STATE}, stagingOrigins));
  assert.throws(() => authenticatedConfig(env, {...stagingOrigins, api: 'https://fmarch-production.up.railway.app'}));
});
test('session imports reject broad, insecure, ambiguous and expired cookies', () => {
  const cookie = {name: 'fmarch_session', value: 'test-session-value-'.repeat(3), domain: new URL(stagingOrigins.frontend).hostname, path: '/', secure: true, httpOnly: true, expires: 100};
  assert.equal(sessionFromState({cookies: [cookie]}, stagingOrigins, 50), cookie);
  for (const patch of [{domain: '.up.railway.app'}, {path: '/g'}, {secure: false}, {httpOnly: false}, {expires: 40}, {value: ''}]) assert.throws(() => sessionFromState({cookies: [{...cookie, ...patch}]}, stagingOrigins, 50));
  assert.throws(() => sessionFromState({cookies: [cookie,cookie]}, stagingOrigins, 50));
});
test('release acceptance rejects missing, partial and differently attributed evidence', () => {
  const commit = 'a'.repeat(40);
  const journeys = {status: 'passed', scope: 'live-authenticated-staging', commandAcknowledged: true, socketReconnected: true, missedUpdateRecovered: true, durableFreshContext: true, authenticatedPrivateDenial: true};
  const receipt = {status: 'passed', generatedAt: '2026-09-07T00:00:00.000Z', checkerCommit: commit, target: {...stagingOrigins, commit}, authenticatedJourneys: journeys};
  assertHostedReleaseAcceptance(receipt, commit);
  assert.throws(() => assertHostedReleaseAcceptance(null, commit));
  for (const key of ['commandAcknowledged','socketReconnected','missedUpdateRecovered','durableFreshContext','authenticatedPrivateDenial']) assert.throws(() => assertAuthenticatedReceipt({...journeys,[key]:false}));
  assert.throws(() => assertHostedReleaseAcceptance({...receipt, checkerCommit: 'b'.repeat(40)}, commit));
  assert.throws(() => assertHostedReleaseAcceptance({...receipt, target: {...receipt.target, commit: 'b'.repeat(40)}}, commit));
  assert.throws(() => assertHostedReleaseAcceptance({...receipt, authenticatedJourneys: 'unproven'}, commit));
});

test('preparation grants only its dedicated game seat and starts through domain commands', async () => {
  const {hostedGameCommands} = await import('./hosted_test_game.mjs');
  const member = '22222222-2222-4222-8222-222222222222';
  const commands = hostedGameCommands(game, member);
  assert.deepEqual(commands.map(c => Object.keys(c)[0]), ['CreateGame','AddSlot','SeatPersona','AssignRole','StartGame']);
  assert.ok(commands.every(c => Object.values(c)[0].game === game));
  assert.equal(commands[2].SeatPersona.principal_id, member);
  assert.equal(commands[2].SeatPersona.slot, commands[1].AddSlot.slot);
  assert.equal(commands[3].AssignRole.slot, commands[1].AddSlot.slot);
  assert.equal(JSON.stringify(commands).includes('GlobalAdmin'), false);
});
