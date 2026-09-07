// Explicit, read-only hosted gate. Never part of hermetic application proof.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertFullCommit, validateHealth } from './release_coordinator_contract.mjs';
import { isExternallyHostedUrl } from './dev_test_game_hosted_target_url_policy.mjs';

export function hostedAcceptanceConfig(env) {
  const commit = assertFullCommit(env.FMARCH_HOSTED_EXPECTED_COMMIT);
  const origins = {};
  for (const [kind, key] of [['api', 'FMARCH_HOSTED_MATRIX_API_URL'], ['frontend', 'FMARCH_HOSTED_MATRIX_FRONTEND_URL']]) {
    const url = new URL(env[key]);
    assert.ok(isExternallyHostedUrl(url.href) && url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash, `${key} must be an external HTTPS origin`);
    origins[kind] = url.origin;
  }
  return {commit, ...origins};
}

export async function checkHostedReadiness(config, fetcher = fetch) {
  const checks = [];
  for (const [kind, endpoint] of [['api', '/readyz'], ['frontend', '/healthz']]) {
    const response = await fetcher(config[kind] + endpoint, {redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15_000)});
    assert.equal(response.ok, true, `${kind} readiness HTTP ${response.status}`);
    const body = await response.json();
    validateHealth(body, config.commit, kind);
    checks.push({kind, endpoint, status: 'passed', release_commit: body.release_commit});
  }
  return checks;
}

export async function runHostedAcceptance(env = process.env) {
  const config = hostedAcceptanceConfig(env);
  const {chromium} = await import('playwright');
  const {BOARD_ROUTE_CONTRACT} = await import('../frontend/src/lib/app/app-shell-model.mjs');
  const checks = await checkHostedReadiness(config);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.name));
    const response = await page.goto(config.frontend, {waitUntil: 'networkidle', timeout: 30_000});
    assert.ok(response?.ok(), 'hosted frontend navigation failed');
    assert.equal(new URL(page.url()).origin, config.frontend, 'unexpected frontend redirect');
    await page.getByTestId(BOARD_ROUTE_CONTRACT.surfaceTestId).waitFor({state: 'visible', timeout: 10_000});
    await page.getByTestId(BOARD_ROUTE_CONTRACT.indexTestId).waitFor({state: 'visible', timeout: 10_000});
    assert.equal(await page.getByTestId(BOARD_ROUTE_CONTRACT.unavailableTestId).count(), 0, 'hosted game index is degraded');
    assert.deepEqual(errors, [], 'hosted frontend JavaScript errors');
    checks.push({kind: 'browser', status: 'passed', version: browser.version()});
    // Detect a deployment moving during browser acceptance.
    await checkHostedReadiness(config);
  } finally { await browser.close(); }
  const directory = path.resolve(env.FMARCH_HOSTED_ACCEPTANCE_OUTPUT ?? 'target/hosted-acceptance');
  await mkdir(directory, {recursive: true});
  const receipt = {status: 'passed', scope: 'live-hosted-readiness-and-public-browser', generatedAt: new Date().toISOString(), target: config, checks, authenticatedJourneys: 'unproven', realSafariAndDevices: 'unproven', releaseReady: false};
  const file = path.join(directory, `${randomUUID()}.json`);
  await writeFile(file, JSON.stringify(receipt, null, 2) + '\n', {flag: 'wx'});
  console.log(`Hosted readiness/public-browser gate passed: ${file}`);
  return receipt;
}
if (pathToFileURL(process.argv[1] ?? '').href === import.meta.url) {
  runHostedAcceptance().catch(error => { console.error(error.message); process.exitCode = 1; });
}
