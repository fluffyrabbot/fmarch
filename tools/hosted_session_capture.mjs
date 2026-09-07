// Capture only a backend-issued staging app cookie after ordinary browser login.
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {stagingOrigins, sessionFromState, authenticatedPrincipal} from './hosted_authenticated_acceptance.mjs';
assert.equal(process.platform, 'linux', 'Run session capture on the canonical Linux desktop');
const output = process.env.FMARCH_HOSTED_SESSION_OUTPUT;
assert.ok(output, 'Set FMARCH_HOSTED_SESSION_OUTPUT to a new private session file');
const {chromium} = await import('playwright');
const browser = await chromium.launch({headless: false});
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${stagingOrigins.frontend}/auth/sign-in`, {timeout: 30_000});
  console.log('Complete normal WorkOS sign-in with an admitted staging test account in the browser. Capture expires after five minutes.');
  let cookie;
  for (const deadline = Date.now() + 300_000; Date.now() < deadline;) {
    const cookies = (await context.cookies(stagingOrigins.frontend)).filter(c => c.name === 'fmarch_session');
    if (cookies.length) {cookie = sessionFromState({cookies}, stagingOrigins);break;}
    await page.waitForTimeout(500);
  }
  assert.ok(cookie, 'No admitted staging session was established');
  await authenticatedPrincipal(stagingOrigins, cookie, '00000000-0000-4000-8000-000000000000');
  await mkdir(path.dirname(path.resolve(output)), {recursive: true, mode: 0o700});
  await writeFile(output, JSON.stringify({cookies: [cookie], origins: []}) + '\n', {flag: 'wx', mode: 0o600});
  console.log('Captured a private staging session file. No provider credentials were retained.');
} finally {await browser.close();}
