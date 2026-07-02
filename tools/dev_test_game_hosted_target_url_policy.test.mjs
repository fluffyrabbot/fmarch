import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDevTestGameHostedTargetPreflight,
} from "./dev_test_game_hosted_target_preflight.mjs";
import {
  isExternallyHostedUrl,
} from "./dev_test_game_hosted_target_url_policy.mjs";

test("hosted target URL policy accepts public http(s) targets", () => {
  for (const url of [
    "https://fmarch.example.test",
    "https://api.fmarch.example.test/status",
    "http://8.8.8.8",
    "https://[2001:4860:4860::8888]",
  ]) {
    assert.equal(isExternallyHostedUrl(url), true, url);
  }
});

test("hosted target URL policy rejects local and non-http targets", () => {
  for (const url of [
    "ftp://fmarch.example.test",
    "file:///tmp/fmarch",
    "http://localhost:5173",
    "http://dev.localhost",
    "http://127.0.0.1:5173",
    "http://[::1]:5173",
  ]) {
    assert.equal(isExternallyHostedUrl(url), false, url);
  }
});

test("hosted target URL policy rejects private and reserved IP literals", () => {
  for (const url of [
    "https://0.0.0.0",
    "https://10.1.2.3",
    "https://100.64.0.1",
    "https://169.254.1.1",
    "https://172.16.0.1",
    "https://172.31.255.255",
    "https://192.168.1.50",
    "https://198.18.0.1",
    "https://198.51.100.42",
    "https://203.0.113.42",
    "https://224.0.0.1",
    "https://[::]",
    "https://[fc00::1]",
    "https://[fd00::1]",
    "https://[fe80::1]",
  ]) {
    assert.equal(isExternallyHostedUrl(url), false, url);
  }
});

test("hosted target preflight rejects private-network target URLs", async () => {
  const preflight = await buildDevTestGameHostedTargetPreflight({
    generatedAt: "2026-07-02T00:00:00.000Z",
    env: {
      FMARCH_HOSTED_MATRIX_FRONTEND_URL: "https://192.168.1.20",
      FMARCH_HOSTED_MATRIX_API_URL: "https://10.0.0.5",
    },
  });
  const checks = new Map(preflight.checks.map((check) => [check.id, check]));

  assert.equal(preflight.status, "blocked");
  assert.equal(checks.get("hosted-frontend-url-configured").status, "passed");
  assert.equal(checks.get("hosted-api-url-configured").status, "passed");
  assert.equal(checks.get("hosted-targets-external").status, "blocked");
  assert.match(
    checks.get("hosted-targets-external").requiredEvidence,
    /private-network, link-local, or reserved IP targets/,
  );
});
