import assert from 'node:assert/strict';
import test from 'node:test';
import {hostedAcceptanceConfig, checkHostedReadiness} from './hosted_acceptance.mjs';
const env = {FMARCH_HOSTED_EXPECTED_COMMIT: 'a'.repeat(40), FMARCH_HOSTED_MATRIX_API_URL: 'https://api.example.com', FMARCH_HOSTED_MATRIX_FRONTEND_URL: 'https://app.example.com'};
const config = hostedAcceptanceConfig(env);
const healthy = {release_commit: config.commit, ok: true, database_schema: true, event_encryption: true, object_storage: true, subject_authority: true, status: 'ok'};
test('hosted config requires exact commit and external credential-free HTTPS origins', () => {
  assert.throws(() => hostedAcceptanceConfig({}));
  for (const url of ['http://example.com', 'https://localhost', 'https://127.0.0.1', 'https://user:secret@example.com', 'https://example.com/path']) assert.throws(() => hostedAcceptanceConfig({...env, FMARCH_HOSTED_MATRIX_API_URL: url}));
});
test('live readiness rejects unhealthy and stale deployments', async () => {
  for (const body of [{...healthy, release_commit: 'b'.repeat(40)}, {...healthy, subject_authority: false}, {...healthy, object_storage: false}]) {
    await assert.rejects(checkHostedReadiness(config, async () => ({ok: true, json: async () => body})));
  }
  await assert.rejects(checkHostedReadiness(config, async () => ({ok: false, status: 503})));
  assert.equal((await checkHostedReadiness(config, async (url, options) => {
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal);
    return {ok: true, json: async () => healthy};
  })).length, 2);
});
