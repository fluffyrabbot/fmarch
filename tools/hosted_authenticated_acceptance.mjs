// Live staging journeys over two independently admitted, real account sessions.
// No local-proof issuer, route mocking, or imported success packet is accepted.
import assert from 'node:assert/strict';
import {readFile, stat} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

export const stagingOrigins = Object.freeze({api: 'https://fmarch-staging.up.railway.app', frontend: 'https://fmarch-frontend-staging.up.railway.app'});
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function authenticatedConfig(env, target) {
  assert.equal(target.api, stagingOrigins.api, 'Authenticated acceptance is staging-only');
  assert.equal(target.frontend, stagingOrigins.frontend, 'Authenticated acceptance is staging-only');
  const game = env.FMARCH_HOSTED_ACCEPTANCE_GAME;
  const channel = env.FMARCH_HOSTED_ACCEPTANCE_CHANNEL;
  assert.match(game ?? '', uuid, 'A dedicated acceptance game UUID is required');
  assert.match(channel ?? '', /^private:role_pm:[a-zA-Z0-9_-]{1,64}$/, 'A dedicated player role-PM channel is required');
  assert.equal(env.FMARCH_HOSTED_ACCEPTANCE_CONFIRM, `staging:${game}`, 'Confirm the dedicated game before posting acceptance markers');
  const member = env.FMARCH_HOSTED_ACCEPTANCE_MEMBER_STATE;
  const outsider = env.FMARCH_HOSTED_ACCEPTANCE_OUTSIDER_STATE;
  assert.ok(member && outsider && member !== outsider, 'Two separate admitted test-account state files are required');
  return {game, channel, member, outsider};
}
export function sessionFromState(state, target, now = Date.now() / 1000) {
  assert.ok(Array.isArray(state?.cookies), 'Expected Playwright storage state');
  const cookies = state.cookies.filter(c => c.name === 'fmarch_session');
  assert.equal(cookies.length, 1, 'Exactly one app session is required');
  const c = cookies[0];
  assert.equal(c.domain, new URL(target.frontend).hostname, 'Session must be scoped to the exact staging host');
  assert.equal(c.path, '/');
  assert.equal(c.secure, true);
  assert.equal(c.httpOnly, true);
  assert.ok(c.expires === -1 || c.expires > now, 'Session has expired');
  assert.ok(typeof c.value === 'string' && c.value.length > 20, 'Missing app session');
  // Only the scoped app cookie enters the browser, never unrelated provider state.
  return c;
}
export async function readSession(file, target) {
  const metadata = await stat(file);
  assert.ok(metadata.isFile() && metadata.size < 1_000_000, 'Invalid session file');
  assert.equal(metadata.mode & 0o077, 0, 'Session file must be private (mode 0600)');
  let state;
  try {state = JSON.parse(await readFile(file, 'utf8'));} catch {throw Error('Malformed session state');}
  return sessionFromState(state, target);
}
export async function prepareAuthenticatedAcceptance(env, target) {
  const config = authenticatedConfig(env, target);
  const member = await readSession(config.member, target);
  const outsider = await readSession(config.outsider, target);
  assert.ok(member.value !== outsider.value, 'The accounts must have different sessions');
  return {config, member, outsider};
}
export async function authenticatedPrincipal(target, cookie, game) {
  const response = await fetch(`${target.api}/auth/session?game=${game}`, {
    headers: {authorization: `Bearer ${cookie.value}`}, redirect: 'error', signal: AbortSignal.timeout(15_000),
  });
  assert.equal(response.status, 200, 'Test account is not authenticated');
  const body = await response.json();
  assert.match(body.principal_id ?? '', uuid, 'Authenticated principal is missing');
  // A session-only dev credential is insufficient: require an active account method.
  const methods = await fetch(`${target.api}/auth/account/methods`, {
    headers: {authorization: `Bearer ${cookie.value}`}, redirect: 'error', signal: AbortSignal.timeout(15_000),
  });
  assert.equal(methods.status, 200, 'A real account authentication method is required');
  const account = await methods.json();
  assert.equal(account.principal_id, body.principal_id);
  assert.ok(account.methods?.some(m => m.kind === 'workos' && m.status === 'active'), 'An active WorkOS identity is required');
  return body.principal_id;
}
export async function runAuthenticatedAcceptance(browser, target, prepared) {
  const {config, member, outsider} = prepared;
  assert.notEqual(await authenticatedPrincipal(target, member, config.game), await authenticatedPrincipal(target, outsider, config.game), 'Accounts must resolve to different principals');
  const contexts = [], errors = [];
  const create = async cookie => {
    const c = await browser.newContext({storageState: {cookies: [cookie], origins: []}});
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
    const url = `${target.frontend}/g/${config.game}/c/${encodeURIComponent(config.channel)}`;
    const response = await page.goto(url, {waitUntil: 'networkidle', timeout: 30_000});
    assert.equal(response?.status(), 200, 'Member private channel did not load');
    assert.equal(page.url(), url, 'Member navigation unexpectedly redirected');
    await page.getByTestId('player-surface').waitFor({state: 'visible'});
    assert.equal(await page.getByTestId(`player-channel-${config.channel}`).getAttribute('aria-current'), 'page');
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
    await authenticatedPrincipal(target, outsider, config.game); // denial must not be explained by expired login
    return {status: 'passed', scope: 'live-authenticated-staging', commandAcknowledged: true, socketReconnected: true, missedUpdateRecovered: true, durableFreshContext: true, authenticatedPrivateDenial: true, freshProviderLogin: 'unproven'};
  } finally {for (const context of contexts.reverse()) await context.close();}
}
export function assertAuthenticatedReceipt(receipt) {
  assert.equal(receipt?.status, 'passed');
  assert.equal(receipt.scope, 'live-authenticated-staging');
  for (const key of ['commandAcknowledged', 'socketReconnected', 'missedUpdateRecovered', 'durableFreshContext', 'authenticatedPrivateDenial']) assert.equal(receipt[key], true, `Missing authenticated evidence: ${key}`);
  return receipt;
}
