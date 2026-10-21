// Live staging journeys over two release-minted acceptance sessions: a member
// seated in a game created for this run, and an admitted outsider who must be
// denied it. The coordinator mints both from the staging API with the release
// acceptance key, so no human, browser login, mailbox, or identity provider is
// involved. No local-proof issuer, route mocking, or imported success packet
// is accepted.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {RELEASE_ACCEPTANCE_KEY_HEADER} from './release_acceptance_key.mjs';

export const stagingOrigins = Object.freeze({api: 'https://fmarch-staging.up.railway.app', frontend: 'https://fmarch-frontend-staging.up.railway.app'});
export const ACCEPTANCE_CHANNEL = 'private:role_pm:slot_1';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const request = (fetcher, url, init = {}) => fetcher(url, {redirect: 'error', signal: AbortSignal.timeout(20_000), ...init});

export function assertStagingTarget(target) {
  assert.equal(target.api, stagingOrigins.api, 'Authenticated acceptance is staging-only');
  assert.equal(target.frontend, stagingOrigins.frontend, 'Authenticated acceptance is staging-only');
}

/** Mint the member and outsider sessions; each mint revokes that role's previous sessions. */
export async function mintAcceptanceSessions(target, key, fetcher = fetch) {
  assertStagingTarget(target);
  const mint = async role => {
    const response = await request(fetcher, `${target.api}/auth/release-acceptance-sessions`, {
      method: 'POST',
      headers: {'content-type': 'application/json', [RELEASE_ACCEPTANCE_KEY_HEADER]: key},
      body: JSON.stringify({role}),
    });
    assert.equal(response.status, 200, `Release acceptance ${role} session was not minted (HTTP ${response.status})`);
    const body = await response.json();
    assert.match(body.principal_id ?? '', uuid, `Release acceptance ${role} principal is missing`);
    assert.match(body.session_token ?? '', /^fmss_[0-9a-f]{64}$/u, `Release acceptance ${role} session is missing`);
    assert.ok(Number.isSafeInteger(body.expires_at), `Release acceptance ${role} expiry is missing`);
    assert.deepEqual(body.capabilities, [], `Release acceptance ${role} session must carry no global capability`);
    return {role, principal: body.principal_id, token: body.session_token, expiresAt: body.expires_at};
  };
  const member = await mint('member');
  const outsider = await mint('outsider');
  assert.notEqual(member.principal, outsider.principal, 'Acceptance roles must resolve to different principals');
  return {member, outsider};
}

/** The exact frontend session cookie a signed-in browser would hold. */
export function sessionCookie(target, session) {
  return {name: 'fmarch_session', value: session.token, domain: new URL(target.frontend).hostname, path: '/', secure: true, httpOnly: true, sameSite: 'Lax', expires: session.expiresAt};
}

export function acceptanceGameCommands(game, member) {
  return [
    {CreateGame: {game, pack: 'mafiascum', cohost_denied: []}},
    {AddSlot: {game, slot: 'slot_1'}},
    {SeatPersona: {game, slot: 'slot_1', principal_id: member, public_name: 'Acceptance player'}},
    {AssignRole: {game, slot: 'slot_1', role_key: 'vanilla_townie'}},
    {StartGame: {game, phase: 'D01'}},
  ];
}

/** Create this run's game through ordinary domain commands, seating only the member. */
export async function provisionAcceptanceGame(target, member, fetcher = fetch) {
  assertStagingTarget(target);
  const game = randomUUID();
  for (const [index, command] of acceptanceGameCommands(game, member.principal).entries()) {
    const response = await request(fetcher, `${target.api}/commands`, {
      method: 'POST',
      headers: {'content-type': 'application/json', authorization: `Bearer ${member.token}`},
      body: JSON.stringify({v: 3, id: index + 1, body: {kind: 'Command', body: {command_id: randomUUID(), command}}}),
    });
    assert.equal(response.status, 200, `Acceptance game command ${Object.keys(command)[0]} failed (HTTP ${response.status})`);
    const envelope = await response.json();
    assert.equal(envelope.body?.kind, 'Ack', `Acceptance game command ${Object.keys(command)[0]} was rejected`);
  }
  return {game, channel: ACCEPTANCE_CHANNEL};
}

/** End both sessions and prove they no longer authenticate. */
export async function signOutAcceptanceSessions(target, sessions, fetcher = fetch) {
  for (const session of sessions) {
    const logout = await request(fetcher, `${target.api}/auth/session-logout`, {method: 'POST', headers: {authorization: `Bearer ${session.token}`}});
    assert.ok([200, 401].includes(logout.status), `Acceptance ${session.role} sign-out failed (HTTP ${logout.status})`);
    const probe = await request(fetcher, `${target.api}/auth/session`, {headers: {authorization: `Bearer ${session.token}`}});
    assert.equal(probe.status, 401, `Acceptance ${session.role} session survived sign-out`);
  }
}

export async function authenticatedPrincipal(target, session, game, fetcher = fetch) {
  const response = await request(fetcher, `${target.api}/auth/session?game=${game}`, {headers: {authorization: `Bearer ${session.token}`}});
  assert.equal(response.status, 200, `Acceptance ${session.role} is not authenticated`);
  const body = await response.json();
  assert.equal(body.principal_id, session.principal, `Acceptance ${session.role} resolved to another principal`);
  const methods = await request(fetcher, `${target.api}/auth/account/methods`, {headers: {authorization: `Bearer ${session.token}`}});
  assert.equal(methods.status, 200, `Acceptance ${session.role} has no account method`);
  const account = await methods.json();
  assert.equal(account.principal_id, session.principal);
  assert.ok(account.methods?.some(m => m.kind === 'release_acceptance' && m.status === 'active'), `Acceptance ${session.role} must hold an active release acceptance method`);
  return body.principal_id;
}
export async function runAuthenticatedAcceptance(browser, target, prepared) {
  const {game, channel, member, outsider} = prepared;
  assert.notEqual(await authenticatedPrincipal(target, member, game), await authenticatedPrincipal(target, outsider, game), 'Accounts must resolve to different principals');
  const contexts = [], errors = [];
  const create = async session => {
    const c = await browser.newContext({storageState: {cookies: [sessionCookie(target, session)], origins: []}});
    c.on('page', page => page.on('pageerror', () => errors.push('pageerror')));
    contexts.push(c);
    return c;
  };
  try {
    const context = await create(member);
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    let sockets = 0, closed = 0;
    page.on('websocket', socket => {sockets += 1; socket.on('close', () => {closed += 1;});});
    const url = `${target.frontend}/g/${game}/c/${encodeURIComponent(channel)}`;
    const response = await page.goto(url, {waitUntil: 'networkidle', timeout: 30_000});
    assert.equal(response?.status(), 200, 'Member private channel did not load');
    assert.equal(page.url(), url, 'Member navigation unexpectedly redirected');
    await page.getByTestId('player-surface').waitFor({state: 'visible'});
    assert.equal(await page.getByTestId(`player-channel-${channel}`).getAttribute('aria-current'), 'page');
    const marker = `fmarch acceptance ${randomUUID()}`;
    await page.getByTestId('player-composer').locator('textarea').fill(marker);
    await page.getByTestId('player-composer').locator('[data-action="submit_post"]').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="player-command-status"]')?.getAttribute('data-state') === 'ack');
    await page.getByText(marker, {exact: true}).waitFor({state: 'visible'});
    assert.ok(sockets > 0, 'No real live connection was established');
    const priorSockets = sockets, priorClosed = closed;
    // Hold this client offline while a second real client changes the channel.
    await context.setOffline(true);
    await page.evaluate(() => {
      if (typeof window.__fmarchDropPlayerLiveProjection !== 'function') throw Error('Live connection controls unavailable');
      window.__fmarchDropPlayerLiveProjection();
    });
    const peer = await create(member), peerPage = await peer.newPage();
    assert.equal((await peerPage.goto(url, {waitUntil: 'networkidle', timeout: 30_000}))?.status(), 200);
    const missedMarker = `fmarch acceptance reconnect ${randomUUID()}`;
    await peerPage.getByTestId('player-composer').locator('textarea').fill(missedMarker);
    await peerPage.getByTestId('player-composer').locator('[data-action="submit_post"]').click();
    await peerPage.waitForFunction(() => document.querySelector('[data-testid="player-command-status"]')?.getAttribute('data-state') === 'ack');
    await peerPage.getByText(missedMarker, {exact: true}).waitFor({state: 'visible'});
    await context.setOffline(false);
    for (const deadline = Date.now() + 20_000; (closed <= priorClosed || sockets <= priorSockets) && Date.now() < deadline;) await page.waitForTimeout(100);
    assert.ok(closed > priorClosed && sockets > priorSockets, 'Socket did not close and reconnect');
    await page.waitForFunction(() => window.__fmarchLiveProjectionStatus?.state === 'connected');
    await page.getByText(missedMarker, {exact: true}).waitFor({state: 'visible'});
    await page.reload({waitUntil: 'networkidle'});
    await page.getByText(marker, {exact: true}).waitFor({state: 'visible'});
    // A fresh context eliminates in-memory and local-storage reconstruction.
    const fresh = await create(member), freshPage = await fresh.newPage();
    const freshResponse = await freshPage.goto(url, {waitUntil: 'networkidle', timeout: 30_000});
    assert.equal(freshResponse?.status(), 200);
    await freshPage.getByText(marker, {exact: true}).waitFor({state: 'visible', timeout: 20_000});
    await freshPage.getByText(missedMarker, {exact: true}).waitFor({state: 'visible', timeout: 20_000});
    const deniedContext = await create(outsider), deniedPage = await deniedContext.newPage();
    const denied = await deniedPage.goto(url, {waitUntil: 'networkidle', timeout: 30_000});
    assert.ok([403, 404].includes(denied?.status()), 'Authenticated outsider was not denied the private route');
    assert.equal(await deniedPage.getByText(marker, {exact: true}).count(), 0, 'Private marker leaked to outsider');
    assert.deepEqual(errors, [], 'Member browser had JavaScript errors');
    await authenticatedPrincipal(target, outsider, game); // denial must not be explained by an expired session
    return {status: 'passed', scope: 'live-authenticated-staging', commandAcknowledged: true, socketReconnected: true, missedUpdateRecovered: true, durableFreshContext: true, authenticatedPrivateDenial: true, sessionOrigin: 'release-acceptance', freshProviderLogin: 'unproven'};
  } finally {for (const context of contexts.reverse()) await context.close();}
}
export function assertAuthenticatedReceipt(receipt) {
  assert.equal(receipt?.status, 'passed');
  assert.equal(receipt.scope, 'live-authenticated-staging');
  for (const key of ['commandAcknowledged', 'socketReconnected', 'missedUpdateRecovered', 'durableFreshContext', 'authenticatedPrivateDenial']) assert.equal(receipt[key], true, `Missing authenticated evidence: ${key}`);
  return receipt;
}
