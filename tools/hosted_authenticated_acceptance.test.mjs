import assert from 'node:assert/strict';
import {chmod, mkdtemp, rm, stat, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {acceptanceGameCommands, assertAuthenticatedReceipt, mintAcceptanceSessions, provisionAcceptanceGame, sessionCookie, signOutAcceptanceSessions, stagingOrigins} from './hosted_authenticated_acceptance.mjs';
import {generateReleaseAcceptanceKey, readReleaseAcceptanceKey, releaseAcceptanceKeyDigest, RELEASE_ACCEPTANCE_KEY_HEADER} from './release_acceptance_key.mjs';
import {assertHostedReleaseAcceptance} from './release_coordinator_contract.mjs';

const key = 'f'.repeat(64);
const principals = {member: '22222222-2222-4222-8222-222222222222', outsider: '33333333-3333-4333-8333-333333333333'};
const json = (status, body) => ({status, json: async () => body});
const mintedBody = role => ({principal_id: principals[role], session_token: `fmss_${(role === 'member' ? 'a' : 'b').repeat(64)}`, expires_at: 2_000_000_000, capabilities: []});

test('acceptance sessions are minted only from staging, by role, with the key header', async () => {
  const calls = [];
  const sessions = await mintAcceptanceSessions(stagingOrigins, key, async (url, init) => {
    calls.push({url, init});
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal);
    return json(200, mintedBody(JSON.parse(init.body).role));
  });
  assert.deepEqual(calls.map(call => JSON.parse(call.init.body).role), ['member', 'outsider']);
  for (const call of calls) {
    assert.equal(call.url, `${stagingOrigins.api}/auth/release-acceptance-sessions`);
    assert.equal(call.init.headers[RELEASE_ACCEPTANCE_KEY_HEADER], key);
  }
  assert.equal(sessions.member.principal, principals.member);
  assert.equal(sessions.outsider.principal, principals.outsider);
  await assert.rejects(mintAcceptanceSessions({...stagingOrigins, api: 'https://fmarch-production.up.railway.app'}, key, async () => json(200, mintedBody('member'))), /staging-only/);
});

test('minting refuses refusals, malformed sessions, global power and a shared principal', async () => {
  for (const response of [
    json(401, {}),
    json(200, {...mintedBody('member'), session_token: 'not-a-session'}),
    json(200, {...mintedBody('member'), capabilities: [{GlobalAdmin: null}]}),
  ]) await assert.rejects(mintAcceptanceSessions(stagingOrigins, key, async () => response));
  await assert.rejects(mintAcceptanceSessions(stagingOrigins, key, async () => json(200, mintedBody('member'))), /different principals/);
});

test('each run creates a fresh game seating only the member through domain commands', async () => {
  const member = {role: 'member', principal: principals.member, token: `fmss_${'a'.repeat(64)}`};
  const commands = [];
  const fetcher = async (url, init) => {
    assert.equal(url, `${stagingOrigins.api}/commands`);
    assert.equal(init.headers.authorization, `Bearer ${member.token}`);
    commands.push(JSON.parse(init.body).body.body.command);
    return json(200, {body: {kind: 'Ack'}});
  };
  const first = await provisionAcceptanceGame(stagingOrigins, member, fetcher);
  const second = await provisionAcceptanceGame(stagingOrigins, member, fetcher);
  assert.notEqual(first.game, second.game);
  assert.equal(first.channel, 'private:role_pm:slot_1');
  assert.deepEqual(commands.slice(0, 5), acceptanceGameCommands(first.game, principals.member));
  assert.deepEqual(commands.slice(0, 5).map(c => Object.keys(c)[0]), ['CreateGame', 'AddSlot', 'SeatPersona', 'AssignRole', 'StartGame']);
  assert.equal(JSON.stringify(commands).includes('GlobalAdmin'), false);
  await assert.rejects(provisionAcceptanceGame(stagingOrigins, member, async () => json(200, {body: {kind: 'Reject'}})), /rejected/);
});

test('sessions enter the browser only as the exact staging session cookie', () => {
  const cookie = sessionCookie(stagingOrigins, {token: `fmss_${'a'.repeat(64)}`, expiresAt: 2_000_000_000});
  assert.deepEqual(cookie, {name: 'fmarch_session', value: `fmss_${'a'.repeat(64)}`, domain: new URL(stagingOrigins.frontend).hostname, path: '/', secure: true, httpOnly: true, sameSite: 'Lax', expires: 2_000_000_000});
});

test('sign-out must leave every acceptance session unauthenticated', async () => {
  const session = {role: 'member', token: `fmss_${'a'.repeat(64)}`};
  await signOutAcceptanceSessions(stagingOrigins, [session], async url => json(url.endsWith('/auth/session-logout') ? 200 : 401, {}));
  await assert.rejects(signOutAcceptanceSessions(stagingOrigins, [session], async () => json(200, {})), /survived sign-out/);
});

test('the release acceptance key is private, never overwritten, and published only as a digest', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fmarch-release-acceptance-key-'));
  try {
    const file = path.join(directory, 'nested', 'release-acceptance.key');
    const digest = await generateReleaseAcceptanceKey(file);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    const generated = await readReleaseAcceptanceKey(file);
    assert.equal(releaseAcceptanceKeyDigest(generated), digest);
    assert.notEqual(digest, generated);
    await assert.rejects(generateReleaseAcceptanceKey(file), /never overwritten/);
    await chmod(file, 0o644);
    await assert.rejects(readReleaseAcceptanceKey(file), /mode 0600/);
    const malformed = path.join(directory, 'malformed.key');
    await writeFile(malformed, 'ABC\n', {mode: 0o600});
    await assert.rejects(readReleaseAcceptanceKey(malformed), /lowercase hex/);
    await assert.rejects(readReleaseAcceptanceKey(path.join(directory, 'absent.key')), /--generate/);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('release acceptance rejects missing, partial and differently attributed evidence', () => {
  const commit = 'a'.repeat(40);
  const journeys = {status: 'passed', scope: 'live-authenticated-staging', commandAcknowledged: true, socketReconnected: true, missedUpdateRecovered: true, durableFreshContext: true, authenticatedPrivateDenial: true};
  const receipt = {status: 'passed', generatedAt: '2026-09-07T00:00:00.000Z', checkerCommit: commit, target: {...stagingOrigins, commit}, authenticatedJourneys: journeys};
  assertHostedReleaseAcceptance(receipt, commit);
  assert.throws(() => assertHostedReleaseAcceptance(null, commit));
  for (const evidence of ['commandAcknowledged', 'socketReconnected', 'missedUpdateRecovered', 'durableFreshContext', 'authenticatedPrivateDenial']) assert.throws(() => assertAuthenticatedReceipt({...journeys, [evidence]: false}));
  assert.throws(() => assertHostedReleaseAcceptance({...receipt, checkerCommit: 'b'.repeat(40)}, commit));
  assert.throws(() => assertHostedReleaseAcceptance({...receipt, target: {...receipt.target, commit: 'b'.repeat(40)}}, commit));
  assert.throws(() => assertHostedReleaseAcceptance({...receipt, authenticatedJourneys: 'unproven'}, commit));
});
