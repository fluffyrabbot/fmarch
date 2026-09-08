import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { main } from "./dev_test_game.mjs";
import { devTestGameHelp } from "./dev_test_game_configuration.mjs";

const sourcePaths = Object.freeze({
  root: "tools/dev_test_game.mjs",
  configuration: "tools/dev_test_game_configuration.mjs",
  artifacts: "tools/dev_test_game_session_artifacts.mjs",
});

const authenticatedPrivateReadSources = Object.freeze([
  "tools/dev_test_game.mjs",
  "tools/host_console_live_stack_smoke.mjs",
  "tools/live_stack_backup_restore_drill.mjs",
  "tools/live_stack/day_event_room_scenario.mjs",
  "tools/completed_game_export_role_proof.mjs",
  "tools/frontend_dispatch_bridge_contract.mjs",
  "tools/frontend_component_interaction_contract.mjs",
  "tools/frontend_role_smoke_artifact_contract.test.mjs",
]);

test("composition root preserves help return and verification validation before I/O", async () => {
  const calls = [];
  const originalLog = console.log;
  console.log = (...values) => calls.push(values);
  try {
    await main(["--help"], {});
  } finally {
    console.log = originalLog;
  }
  assert.deepEqual(calls, [[devTestGameHelp()]]);
  await assert.rejects(
    () => main(["--verify", "--verify-host-setup-only"], {}),
    /only one dev-test-game verification mode may be selected/,
  );
  await assert.rejects(
    () => main(["--api-base-url", "http://127.0.0.1:4101"], {}),
    /cannot seed process-bound local proof sessions/,
  );
});

test("dev-test-game composition root delegates configuration and artifact ownership", async () => {
  const [root, configuration, artifacts] = await Promise.all(
    Object.values(sourcePaths).map((file) => readFile(file, "utf8")),
  );

  assert.match(root, /from "\.\/dev_test_game_configuration\.mjs"/);
  assert.match(root, /from "\.\/dev_test_game_session_artifacts\.mjs"/);
  for (const use of [
    "normalizeDevTestGameConfiguration({ rawArgs, env })",
    "completeDevTestGameConfiguration({",
    "sessionArtifactsForConfiguration(",
    "sessionArtifactWrites({",
    "verificationProofArtifactWrites({",
    "proofRunArtifactWrite({ proofRun, paths: configuration.paths })",
    "sessionCardConsoleLines(card)",
  ]) {
    assert.ok(root.includes(use), `composition root should use ${use}`);
  }

  for (const retiredOwner of [
    /export function parseArgs\(/,
    /export function selectGame\(/,
    /export function liveProjectionProofConfig\(/,
    /export function buildSessionCard\(/,
    /export function markdownSessionCard\(/,
    /export function buildDevTestGameHostSetupProof\(/,
    /function sessionArtifactsForPaths\(/,
  ]) {
    assert.doesNotMatch(root, retiredOwner);
  }
  assert.doesNotMatch(root, /target", "dev-test-game/);
  assert.doesNotMatch(root, /const configuredMediaRoot = process\.env/);
  assert.doesNotMatch(root, /devTestGameEarliestReachedProofPath/);
  assert.doesNotMatch(root, /devTestGameHostDecidesProofPath/);
  assert.doesNotMatch(root, /devTestGameHostDecidesRaceProofPath/);

  assert.match(configuration, /export function parseArgs\(/);
  assert.match(configuration, /export function selectGame\(/);
  assert.match(configuration, /export function buildDevTestGamePaths\(/);
  assert.match(configuration, /export function normalizeDevTestGameConfiguration\(/);
  assert.match(configuration, /export function completeDevTestGameConfiguration\(/);
  assert.match(configuration, /only one dev-test-game verification mode may be selected/);
  assert.match(configuration, /FMARCH_MEDIA_ROOT must not be empty/);

  assert.match(artifacts, /export function buildSessionCard\(/);
  assert.match(artifacts, /export function markdownSessionCard\(/);
  assert.match(artifacts, /export function verificationProofArtifactWrites\(/);
  assert.match(artifacts, /export function jsonArtifactDocument\(/);
  assert.match(artifacts, /export function sessionCardConsoleLines\(/);
});

test("configuration and artifact owners remain pure values below orchestration", async () => {
  const [root, configuration, artifacts] = await Promise.all(
    Object.values(sourcePaths).map((file) => readFile(file, "utf8")),
  );

  for (const source of [configuration, artifacts]) {
    assert.doesNotMatch(source, /node:child_process/);
    assert.doesNotMatch(source, /node:fs/);
    assert.doesNotMatch(source, /node:net/);
    assert.doesNotMatch(source, /playwright/);
    assert.doesNotMatch(source, /\bspawn\(/);
    assert.doesNotMatch(source, /\bfetch\(/);
    assert.doesNotMatch(source, /process\.on\(/);
    assert.doesNotMatch(source, /console\.(?:log|error|warn)\(/);
  }
  assert.doesNotMatch(configuration, /dev_test_game_session_artifacts/);
  assert.doesNotMatch(artifacts, /dev_test_game_configuration/);
  assert.doesNotMatch(artifacts, /assertDevTestGameProofRun/);

  for (const retainedOwner of [
    /export async function main\(/,
    /async function startApi\(/,
    /async function startFrontend\(/,
    /async function verifySessionCard\(/,
    /async function fetchWithTimeout\(/,
    /async function shutdown\(/,
    /assertDevTestGameProofRun\(proofRun\)/,
    /process\.on\("SIGINT"/,
    /process\.on\("SIGTERM"/,
    /await writeFile\(write\.filePath, write\.contents\)/,
  ]) {
    assert.match(root, retainedOwner);
  }
});

test("matching contracts import the extracted owners directly without a facade", async () => {
  const [testSource, configurationTest, artifactTest] = await Promise.all([
    readFile("tools/dev_test_game.test.mjs", "utf8"),
    readFile("tools/dev_test_game_configuration.test.mjs", "utf8"),
    readFile("tools/dev_test_game_session_artifacts.test.mjs", "utf8"),
  ]);
  assert.match(
    configurationTest,
    /from "\.\/dev_test_game_configuration\.mjs"/,
  );
  assert.match(
    artifactTest,
    /from "\.\/dev_test_game_session_artifacts\.mjs"/,
  );
  const rootImport = testSource.match(
    /import\s*\{([^}]*)\}\s*from "\.\/dev_test_game\.mjs";/s,
  )?.[0];
  assert.notEqual(rootImport, undefined);
  for (const extractedExport of [
    "parseArgs",
    "selectGame",
    "liveProjectionProofConfig",
    "buildSessionCard",
    "markdownSessionCard",
    "buildDevTestGameHostSetupProof",
  ]) {
    assert.doesNotMatch(rootImport, new RegExp(`\\b${extractedExport}\\b`));
  }
});

test("private game reads derive principals only from authenticated sessions", async () => {
  const sources = await Promise.all(
    authenticatedPrivateReadSources.map(async (file) => ({
      file,
      source: await readFile(file, "utf8"),
    })),
  );

  for (const { file, source } of sources) {
    assert.doesNotMatch(
      source,
      /[?&]principal_id=/,
      `${file} must not select a private-read principal through the URL`,
    );
  }
});

test("host live-stack fixture inspects sealed events only at the opaque storage boundary", async () => {
  const source = await readFile(
    "tools/host_console_live_stack_smoke.mjs",
    "utf8",
  );

  for (const retiredPlaintextAccess of [
    /payload\s*->/,
    /payload\s*\?/,
    /NEW\.(?:payload|actor|causation_id|meta)\b/,
    /INSERT\s+INTO\s+events\b/i,
    /UPDATE\s+events\b/i,
    /DELETE\s+FROM\s+events\b/i,
  ]) {
    assert.doesNotMatch(source, retiredPlaintextAccess);
  }
  for (const sealedBoundary of [
    /sealed_version\s*=\s*3/,
    /stream_key_epoch\s*>\s*0/,
    /octet_length\(sealed_nonce\)\s*=\s*24/,
    /octet_length\(sealed_body\)\s*>=\s*16/,
    /FROM vote_ballot/,
    /FROM command_receipt/,
    /\/resolution-audit/,
    /\/resolution-traces/,
  ]) {
    assert.match(source, sealedBoundary);
  }

});

test("scratch server proofs isolate disposable subject authorities from repo state", async () => {
  // A scratch database must never reuse the repo-default erasure journal. A
  // journal is deliberately authoritative across database restores, so sharing
  // it with an unrelated ephemeral database must fail server readiness.
  for (const file of [
    "tools/game_invitation_role_proof.mjs",
    "tools/host_console_live_stack_smoke.mjs",
  ]) {
    const source = await readFile(file, "utf8");
    assert.match(
      source,
      /mkdtemp\(path\.join\(artifactDir, "subject-authority-"\)\)/,
      `${file} must allocate an authority unique to its scratch database`,
    );
    assert.match(source, /FMARCH_SUBJECT_KEY_DIR:\s*subjectKeyRoot/);
    assert.match(source, /rm\(subjectKeyRoot, \{ recursive: true, force: true \}\)/);
  }
});

test("owned proof servers mint Dev authority through their exact process-bound control", async () => {
  for (const file of [
    "tools/dev_test_game.mjs",
    "tools/game_invitation_role_proof.mjs",
    "tools/host_console_live_stack_smoke.mjs",
  ]) {
    const source = await readFile(file, "utf8");
    assert.match(source, /createLocalProofAuth\(\)/, file);
    assert.match(source, /\.serverEnvironment\(\{/, file);
    assert.match(source, /\/auth\/local-proof\/sessions/, file);
    assert.match(source, /\.requestHeaders\(\{/, file);
    assert.doesNotMatch(source, /INSERT INTO auth_session/, file);
    assert.doesNotMatch(source, /local_proof_instance_id|\binstance_id\b/, file);
  }
});

test("active JavaScript proofs cannot manufacture auth_session rows or instance ids", async () => {
  const files = (await readdir("tools"))
    .filter((file) => file.endsWith(".mjs") && !file.endsWith(".test.mjs"))
    .filter((file) => file !== "database_schema_upgrade_proof.mjs");
  for (const file of files) {
    const source = await readFile(`tools/${file}`, "utf8");
    assert.doesNotMatch(
      source,
      /INSERT\s+INTO\s+(?:public\.)?auth_session/u,
      `${file} must use an authentication control rather than storage writes`,
    );
    assert.doesNotMatch(
      source,
      /local_proof_instance_id/u,
      `${file} must leave process instance derivation to the backend`,
    );
  }
});

test("auth invite scratch proof owns a deterministic database capacity budget", async () => {
  const source = await readFile("tools/game_invitation_role_proof.mjs", "utf8");

  const capacityBlock = source.match(
    /const scratchApiDatabaseCapacity = Object\.freeze\(\{(?<body>[^}]+)\}\);/,
  )?.groups?.body;
  assert.notEqual(capacityBlock, undefined);
  const capacity = Object.fromEntries(
    [...capacityBlock.matchAll(/^\s*(\w+): "(\d+)",$/gmu)].map((match) => [
      match[1],
      Number(match[2]),
    ]),
  );
  assert.deepEqual(capacity, {
    maxConnections: 32,
    acquireTimeoutMs: 3000,
    statementTimeoutMs: 5000,
    identityDeliveryProviderTimeoutMs: 10000,
    identityDeliveryDatabaseTimeoutMs: 9000,
    identityDeliveryClaimLeaseMs: 45000,
    identityDeliveryProviderClockSkewMarginMs: 5000,
    identityDeliveryRetryMaxSeconds: 300,
    httpRequestTimeoutMs: 55000,
    workerReadinessGraceMs: 10000,
    shutdownDrainTimeoutMs: 60000,
  });
  const oneDatabaseOperation =
    capacity.acquireTimeoutMs + capacity.statementTimeoutMs;
  const authenticationDatabaseBudget =
    capacity.acquireTimeoutMs + 2 * capacity.statementTimeoutMs;
  assert.ok(capacity.workerReadinessGraceMs > oneDatabaseOperation);
  assert.ok(
    capacity.identityDeliveryDatabaseTimeoutMs > oneDatabaseOperation,
  );
  assert.ok(
    capacity.identityDeliveryClaimLeaseMs >
      capacity.identityDeliveryProviderTimeoutMs +
        3 * capacity.identityDeliveryDatabaseTimeoutMs +
        capacity.identityDeliveryProviderClockSkewMarginMs +
        1000,
  );
  assert.ok(
    capacity.httpRequestTimeoutMs >
      authenticationDatabaseBudget +
        capacity.identityDeliveryProviderTimeoutMs +
        3 * capacity.identityDeliveryDatabaseTimeoutMs +
        1000,
  );
  assert.ok(
    capacity.shutdownDrainTimeoutMs >
      capacity.httpRequestTimeoutMs + 1000,
  );
  const deliveryObservationBudget =
    capacity.workerReadinessGraceMs +
    capacity.identityDeliveryProviderTimeoutMs +
    3 * capacity.identityDeliveryDatabaseTimeoutMs +
    5000;
  assert.ok(
    deliveryObservationBudget >
      capacity.workerReadinessGraceMs +
        capacity.identityDeliveryProviderTimeoutMs +
        3 * capacity.identityDeliveryDatabaseTimeoutMs,
  );
  const defaultFetchTimeoutMs = 15000;
  const explicitRetryBackoffMarginMs = 5000;
  const explicitRetryBackoffSeconds =
    Math.ceil(
      (deliveryObservationBudget +
        2 * defaultFetchTimeoutMs +
        explicitRetryBackoffMarginMs) /
        1000,
    );
  assert.ok(
    explicitRetryBackoffSeconds * 1000 >
      deliveryObservationBudget + 2 * defaultFetchTimeoutMs,
  );
  assert.ok(
    explicitRetryBackoffSeconds < capacity.identityDeliveryRetryMaxSeconds,
  );
  for (const budgetTerm of [
    "scratchApiDatabaseCapacity.workerReadinessGraceMs",
    "scratchApiDatabaseCapacity.identityDeliveryProviderTimeoutMs",
    "3 * Number(scratchApiDatabaseCapacity.identityDeliveryDatabaseTimeoutMs)",
    "deliveryIntentPollMarginMs",
  ]) {
    assert.ok(source.includes(budgetTerm), `delivery observer budget omits ${budgetTerm}`);
  }
  for (const [variable, property] of Object.entries({
    FMARCH_DB_MAX_CONNECTIONS: "maxConnections",
    FMARCH_DB_ACQUIRE_TIMEOUT_MS: "acquireTimeoutMs",
    FMARCH_DB_STATEMENT_TIMEOUT_MS: "statementTimeoutMs",
    FMARCH_IDENTITY_DELIVERY_PROVIDER_TIMEOUT_MS:
      "identityDeliveryProviderTimeoutMs",
    FMARCH_IDENTITY_DELIVERY_DATABASE_TIMEOUT_MS:
      "identityDeliveryDatabaseTimeoutMs",
    FMARCH_IDENTITY_DELIVERY_CLAIM_LEASE_MS: "identityDeliveryClaimLeaseMs",
    FMARCH_IDENTITY_DELIVERY_PROVIDER_CLOCK_SKEW_MARGIN_MS:
      "identityDeliveryProviderClockSkewMarginMs",
    FMARCH_IDENTITY_DELIVERY_RETRY_MAX_SECONDS:
      "identityDeliveryRetryMaxSeconds",
    FMARCH_HTTP_REQUEST_TIMEOUT_MS: "httpRequestTimeoutMs",
    FMARCH_WORKER_READINESS_GRACE_MS: "workerReadinessGraceMs",
    FMARCH_SHUTDOWN_DRAIN_TIMEOUT_MS: "shutdownDrainTimeoutMs",
  })) {
    assert.match(
      source,
      new RegExp(`${variable}:\\s*scratchApiDatabaseCapacity\\.${property}`),
    );
    assert.doesNotMatch(source, new RegExp(`process\\.env\\.${variable}`));
  }
});

test("auth invite proof observes provider backoff before an explicit admin retry", async () => {
  const source = await readFile("tools/game_invitation_role_proof.mjs", "utf8");

  for (const contract of [
    "deliveryProvider.armRetryableFailure({",
    "const retryableFailureArms = [];",
    "const outcomesByAttempt = new Map();",
    "const latestOutcomeByDelivery = new Map();",
    "function planIdentityDeliveryProviderTransition({",
    "function identityDeliveryEffectIdentityFromRequest(delivery)",
    "function identityDeliveryEffectIdentityMatchesRequest(effectIdentity, delivery)",
    "function resolveCachedIdentityDeliveryProviderAttempt({ delivery, cachedAttempt })",
    "function identityDeliveryProviderCaptureFromRequest(delivery)",
    "function commitIdentityDeliveryProviderTransition({",
    "function retryableFailureArmFor(delivery)",
    "credential: recoveryInviteToken",
    "expectedAccountId: hostAccount.accountId",
    "if (delivery.attempt_number !== 1) return null;",
    "retryableFailureArms.splice(failureArmIndex, 1);",
    "cachedAttempt: outcomesByAttempt.get(attemptKey)",
    'if (cachedAttempt.kind === "miss")',
    'transitionKind = "start";',
    'transitionKind = "reclaim";',
    'transitionKind = "retry";',
    'transitionKind = "reconcile";',
    'previous.status === "retryable_failure"',
    'previous.status === "delivered"',
    "delivery.attempt_number === previous.attemptNumber + 1",
    "...previous.outcome",
    "attempt_token: delivery.attempt_token",
    "retryableFailureArm: retryableFailureArmFor(delivery)",
    "outcomesByAttempt.set(attemptKey, transition.next);",
    "latestOutcomeByDelivery.set(",
    "captures.set(deliveryId, transition.capture);",
    "delivery fault injection requires exactly one credential or account target",
    "retryAfterSeconds: explicitRetryBackoffSeconds",
    "retry_after_seconds: retryAfterSeconds",
    "2 * defaultFetchTimeoutMs",
    "explicitRetryBackoffMarginMs",
    "explicitRetryBackoffSeconds >=",
    "waitForRetryableDeliveryIntent({",
    "lastDelivery.nextAttemptAt > Math.floor(Date.now() / 1000)",
    "expected_attempt_count: delivery.attemptCount",
    "backoffOverridden: true",
    "delivery lookup requires exactly one delivery id or credential hash",
    "timeoutMs: Math.min(deliveryIntentObservationTimeoutMs, remainingMs)",
    'import { runBoundedProcess } from "./proof_process.mjs"',
  ]) {
    assert.equal(source.includes(contract), true, `missing delivery retry contract: ${contract}`);
  }
  assert.doesNotMatch(
    source,
    /await delay\(1100\)/u,
    "admin retry must wait on durable delivery state rather than a wall-clock guess",
  );
  assert.equal(
    source.match(/deliveryProvider\.armRetryableFailure\(\{/gu)?.length,
    2,
    "only the intended invite and recovery scenarios may arm provider failure",
  );
  assert.doesNotMatch(
    source,
    /const outcome =\s*delivery\.attempt_number === 1\s*\?/u,
    "provider failure must never be ambient for every delivery's first attempt",
  );
  assert.doesNotMatch(
    source,
    /structuredClone\(delivery\)/u,
    "provider effects must be committed from an explicit request projection",
  );
  const generationValidation = source.indexOf(
    "function planIdentityDeliveryProviderTransition({",
  );
  const acceptedOutcomeState = source.indexOf("latestOutcomeByDelivery.set(");
  const deliveredCapturePublication = source.indexOf("captures.set(deliveryId, transition.capture);");
  assert.ok(
    generationValidation < acceptedOutcomeState &&
      acceptedOutcomeState < deliveredCapturePublication,
    "provider capture publication must follow attempt-generation validation and accepted outcome state",
  );
  const providerHandlerStart = source.indexOf("const provider = createServer(");
  const providerHandlerEnd = source.indexOf("await new Promise((resolve, reject) => {", providerHandlerStart);
  const providerHandler = source.slice(providerHandlerStart, providerHandlerEnd);
  assert.ok(
    providerHandler.indexOf("responseBody = JSON.stringify(transition.outcome);") <
      providerHandler.indexOf("outcome = commitIdentityDeliveryProviderTransition({"),
    "a new provider response must serialize before its outcome/effect is committed",
  );
  assert.match(
    providerHandler,
    /outcomeCommitted = true;[\s\S]*?commitIdentityDeliveryProviderTransition\(\{[\s\S]*?if \(outcomeCommitted\) \{[\s\S]*?closeProviderResponse\(response\)/u,
    "errors after the commit boundary must close for reconciliation, never synthesize a failure response",
  );
  const retryStart = source.indexOf("async function retryFailedDelivery({");
  const retryEnd = source.indexOf("async function retryFailedDeliveryForCredential", retryStart);
  const retrySource = source.slice(retryStart, retryEnd);
  assert.ok(
    retrySource.indexOf("waitForRetryableDeliveryIntent({") <
      retrySource.indexOf("/admin/auth-delivery-provider/probe") &&
      retrySource.indexOf("/admin/auth-delivery-provider/probe") <
        retrySource.indexOf("/retry"),
    "every deliberately failed delivery must be observed, recovered by GlobalAdmin probe, and only then retried",
  );
  const recoveryInviteArm = source.indexOf("credential: recoveryInviteToken");
  const recoveryInviteRetry = source.indexOf("const inviteDelivery = await retryFailedDelivery({");
  const recoveryCredentialArm = source.indexOf("expectedAccountId: hostAccount.accountId");
  const recoveryCredentialRetry = source.indexOf(
    "const recoveryDelivery = await retryFailedDeliveryForCredential({",
  );
  assert.ok(
    recoveryInviteArm < recoveryInviteRetry &&
      recoveryInviteRetry < recoveryCredentialArm &&
      recoveryCredentialArm < recoveryCredentialRetry,
    "each explicit one-shot outage must terminate at its own probe-and-retry recovery boundary",
  );
});

test("auth invite provider transition model executes delivery, retry, reclaim, reconciliation, and stale rejection", async () => {
  const source = await readFile("tools/game_invitation_role_proof.mjs", "utf8");
  const modelStart = source.indexOf("// BEGIN identity delivery provider transition model");
  const modelEnd = source.indexOf(
    "// END identity delivery provider transition model",
    modelStart,
  );
  assert.ok(modelStart >= 0 && modelEnd > modelStart, "provider transition model is extractable");
  const modelSource = source.slice(modelStart, modelEnd);
  const {
    planIdentityDeliveryProviderTransition,
    commitIdentityDeliveryProviderTransition,
    resolveCachedIdentityDeliveryProviderAttempt,
  } = Function(
    `"use strict"; ${modelSource}; return { planIdentityDeliveryProviderTransition, commitIdentityDeliveryProviderTransition, resolveCachedIdentityDeliveryProviderAttempt };`,
  )();
  const delivery = ({
    deliveryId,
    attemptToken,
    attemptNumber,
  }) => ({
    schema: "fmarch.identity-delivery.v2",
    provider_generation: "local-deterministic",
    delivery_id: deliveryId,
    attempt_token: attemptToken,
    lease_expires_at: 4_102_444_800,
    clock_skew_margin_seconds: 5,
    delivery_kind: "invite",
    account_id: "provider-model@example.test",
    principal_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    credential: "provider-model-credential",
    attempt_number: attemptNumber,
    idempotency_key: deliveryId,
  });
  const commitStores = () => ({
    outcomesByAttempt: new Map(),
    latestOutcomeByDelivery: new Map(),
    captures: new Map(),
    retryableFailureArms: [],
  });
  const commit = (transition, request, stores) =>
    commitIdentityDeliveryProviderTransition({
      transition,
      deliveryKey: `local-deterministic:${request.delivery_id}`,
      attemptKey: `local-deterministic:${request.delivery_id}:${request.attempt_token}`,
      deliveryId: request.delivery_id,
      ...stores,
    });

  const deliveredRequest = delivery({
    deliveryId: "11111111-1111-4111-8111-111111111111",
    attemptToken: "aaaaaaaa-1111-4111-8111-111111111111",
    attemptNumber: 1,
  });
  const delivered = planIdentityDeliveryProviderTransition({
    delivery: deliveredRequest,
    previous: undefined,
    retryableFailureArm: null,
    retryAfterSeconds: 60,
  });
  assert.equal(delivered.kind, "accepted");
  assert.equal(delivered.transitionKind, "start");
  assert.equal(delivered.outcome.status, "delivered");
  assert.notStrictEqual(delivered.capture, deliveredRequest);
  assert.deepEqual(Object.keys(delivered.capture).sort(), Object.keys(deliveredRequest).sort());
  const deliveredStores = commitStores();
  assert.equal(commit(delivered, deliveredRequest, deliveredStores), delivered.outcome);
  assert.equal(deliveredStores.captures.get(deliveredRequest.delivery_id), delivered.capture);
  const deliveredAttempt = deliveredStores.outcomesByAttempt.get(
    `local-deterministic:${deliveredRequest.delivery_id}:${deliveredRequest.attempt_token}`,
  );
  const exactCachedAttempt = resolveCachedIdentityDeliveryProviderAttempt({
    delivery: deliveredRequest,
    cachedAttempt: deliveredAttempt,
  });
  assert.equal(exactCachedAttempt.kind, "cached");
  assert.equal(exactCachedAttempt.outcome, delivered.outcome);
  assert.deepEqual(
    resolveCachedIdentityDeliveryProviderAttempt({
      delivery: { ...deliveredRequest, attempt_number: 2 },
      cachedAttempt: deliveredAttempt,
    }),
    { kind: "rejected", reason: "attempt_generation_rejected" },
  );
  for (const [field, value] of [
    ["delivery_kind", "recovery"],
    ["account_id", "mutated@example.test"],
    ["principal_id", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
    ["credential", "mutated-provider-credential"],
  ]) {
    const mutatedReplay = { ...deliveredRequest, [field]: value };
    assert.deepEqual(
      resolveCachedIdentityDeliveryProviderAttempt({
        delivery: mutatedReplay,
        cachedAttempt: deliveredAttempt,
      }),
      { kind: "rejected", reason: "effect_identity_rejected" },
      `exact attempt-token replay may not mutate ${field}`,
    );
    assert.deepEqual(
      planIdentityDeliveryProviderTransition({
        delivery: {
          ...mutatedReplay,
          attempt_token: "99999999-1111-4111-8111-111111111111",
          attempt_number: 2,
        },
        previous: deliveredStores.latestOutcomeByDelivery.get(
          `local-deterministic:${deliveredRequest.delivery_id}`,
        ),
        retryableFailureArm: null,
        retryAfterSeconds: 60,
      }),
      { kind: "rejected", reason: "effect_identity_rejected" },
      `later delivery generation may not mutate ${field}`,
    );
  }
  assert.equal(deliveredStores.outcomesByAttempt.size, 1);
  assert.equal(deliveredStores.captures.size, 1);

  const reconciledRequest = delivery({
    deliveryId: deliveredRequest.delivery_id,
    attemptToken: "ffffffff-1111-4111-8111-111111111111",
    attemptNumber: 2,
  });
  const reconciled = planIdentityDeliveryProviderTransition({
    delivery: reconciledRequest,
    previous: deliveredStores.latestOutcomeByDelivery.get(
      `local-deterministic:${deliveredRequest.delivery_id}`,
    ),
    retryableFailureArm: null,
    retryAfterSeconds: 60,
  });
  assert.equal(reconciled.transitionKind, "reconcile");
  assert.equal(reconciled.outcome.status, "delivered");
  assert.equal(reconciled.outcome.attempt_token, reconciledRequest.attempt_token);
  assert.equal(
    reconciled.outcome.provider_receipt_id,
    delivered.outcome.provider_receipt_id,
  );
  assert.equal(reconciled.capture, null);
  commit(reconciled, reconciledRequest, deliveredStores);
  assert.equal(
    deliveredStores.captures.size,
    1,
    "lost acknowledgement reconciliation must not repeat the provider effect",
  );

  const retryId = "22222222-2222-4222-8222-222222222222";
  const failedRequest = delivery({
    deliveryId: retryId,
    attemptToken: "bbbbbbbb-2222-4222-8222-222222222222",
    attemptNumber: 1,
  });
  const failureArm = Object.freeze({
    expectedKind: "invite",
    credential: failedRequest.credential,
    expectedAccountId: undefined,
  });
  const failed = planIdentityDeliveryProviderTransition({
    delivery: failedRequest,
    previous: undefined,
    retryableFailureArm: failureArm,
    retryAfterSeconds: 60,
  });
  assert.equal(failed.transitionKind, "start");
  assert.equal(failed.outcome.status, "retryable_failure");
  assert.equal(failed.capture, null);
  const missingArmStores = commitStores();
  assert.throws(
    () => commit(failed, failedRequest, missingArmStores),
    /planned delivery failure arm is no longer available/u,
  );
  assert.equal(missingArmStores.outcomesByAttempt.size, 0);
  assert.equal(missingArmStores.latestOutcomeByDelivery.size, 0);
  assert.equal(missingArmStores.captures.size, 0);
  const retryStores = commitStores();
  retryStores.retryableFailureArms.push(failureArm);
  commit(failed, failedRequest, retryStores);
  assert.equal(
    retryStores.retryableFailureArms.length,
    0,
    "the matched one-shot arm must be consumed by the outcome commit",
  );

  const reclaimedRequest = delivery({
    deliveryId: retryId,
    attemptToken: "cccccccc-2222-4222-8222-222222222222",
    attemptNumber: 1,
  });
  const reclaimed = planIdentityDeliveryProviderTransition({
    delivery: reclaimedRequest,
    previous: retryStores.latestOutcomeByDelivery.get(`local-deterministic:${retryId}`),
    retryableFailureArm: null,
    retryAfterSeconds: 60,
  });
  assert.equal(reclaimed.transitionKind, "reclaim");
  assert.equal(reclaimed.outcome.status, "retryable_failure");
  assert.equal(reclaimed.outcome.attempt_token, reclaimedRequest.attempt_token);
  assert.equal(reclaimed.capture, null, "reclaim must not repeat a provider side effect");
  commit(reclaimed, reclaimedRequest, retryStores);

  const retryRequest = delivery({
    deliveryId: retryId,
    attemptToken: "dddddddd-2222-4222-8222-222222222222",
    attemptNumber: 2,
  });
  const retried = planIdentityDeliveryProviderTransition({
    delivery: retryRequest,
    previous: retryStores.latestOutcomeByDelivery.get(`local-deterministic:${retryId}`),
    retryableFailureArm: null,
    retryAfterSeconds: 60,
  });
  assert.equal(retried.transitionKind, "retry");
  assert.equal(retried.outcome.status, "delivered");
  commit(retried, retryRequest, retryStores);

  const staleRequest = delivery({
    deliveryId: retryId,
    attemptToken: "eeeeeeee-2222-4222-8222-222222222222",
    attemptNumber: 4,
  });
  const stale = planIdentityDeliveryProviderTransition({
    delivery: staleRequest,
    previous: retryStores.latestOutcomeByDelivery.get(`local-deterministic:${retryId}`),
    retryableFailureArm: null,
    retryAfterSeconds: 60,
  });
  assert.deepEqual(stale, {
    kind: "rejected",
    reason: "attempt_generation_rejected",
  });
  assert.equal(retryStores.outcomesByAttempt.size, 3);
  assert.equal(retryStores.latestOutcomeByDelivery.get(`local-deterministic:${retryId}`).attemptNumber, 2);

  const serializationStores = commitStores();
  const serializationArm = Object.freeze({
    expectedKind: "invite",
    credential: "serialization-failure-credential",
    expectedAccountId: undefined,
  });
  serializationStores.retryableFailureArms.push(serializationArm);
  const rejectedBeforeCommit = planIdentityDeliveryProviderTransition({
    delivery: delivery({
      deliveryId: "33333333-3333-4333-8333-333333333333",
      attemptToken: "bbbbbbbb-3333-4333-8333-333333333333",
      attemptNumber: 2,
    }),
    previous: undefined,
    retryableFailureArm: serializationArm,
    retryAfterSeconds: 60,
  });
  assert.equal(rejectedBeforeCommit.kind, "rejected");
  assert.equal(serializationStores.retryableFailureArms.length, 1);
  assert.equal(serializationStores.outcomesByAttempt.size, 0);
  assert.equal(serializationStores.latestOutcomeByDelivery.size, 0);
  assert.equal(serializationStores.captures.size, 0);
  const unserializableRequest = {
    ...delivery({
      deliveryId: "33333333-3333-4333-8333-333333333333",
      attemptToken: "aaaaaaaa-3333-4333-8333-333333333333",
      attemptNumber: 1,
    }),
    provider_generation: 1n,
  };
  const unserializable = planIdentityDeliveryProviderTransition({
    delivery: unserializableRequest,
    previous: undefined,
    retryableFailureArm: serializationArm,
    retryAfterSeconds: 60,
  });
  assert.throws(() => JSON.stringify(unserializable.outcome), TypeError);
  assert.equal(serializationStores.retryableFailureArms.length, 1);
  assert.equal(serializationStores.outcomesByAttempt.size, 0);
  assert.equal(serializationStores.latestOutcomeByDelivery.size, 0);
  assert.equal(serializationStores.captures.size, 0);
});

test("auth invite provider diagnostics are bounded, sanitized, and all credential delivery is durably acknowledged", async () => {
  const source = await readFile("tools/game_invitation_role_proof.mjs", "utf8");

  for (const reason of [
    "request_authentication_rejected",
    "request_body_too_large",
    "request_json_rejected",
    "probe_contract_rejected",
    "delivery_shape_rejected",
    "delivery_schema_rejected",
    "provider_generation_rejected",
    "attempt_token_rejected",
    "effect_deadline_rejected",
    "clock_skew_margin_rejected",
    "idempotency_key_rejected",
    "effect_deadline_elapsed_before_commit",
    "attempt_generation_rejected",
    "effect_identity_rejected",
    "provider_handler_authentication_stage_failed",
    "provider_handler_body_stage_failed",
    "provider_handler_dispatch_stage_failed",
    "provider_handler_probe_response_stage_failed",
    "provider_handler_delivery_validation_stage_failed",
    "provider_handler_transition_lookup_stage_failed",
    "provider_handler_transition_plan_stage_failed",
    "provider_handler_transition_commit_stage_failed",
    "provider_handler_outcome_diagnostic_stage_failed",
    "provider_handler_response_serialization_stage_failed",
    "provider_handler_response_write_stage_failed",
    "provider_handler_unclassified_stage_failed",
    "fault_injected_provider_unavailable",
    "delivered",
  ]) {
    assert.ok(source.includes(`"${reason}"`), `missing sanitized provider diagnostic ${reason}`);
  }
  const diagnosticStart = source.indexOf("function recordDiagnostic(");
  const diagnosticEnd = source.indexOf("function rejectProvider(", diagnosticStart);
  const diagnosticShape = source.slice(diagnosticStart, diagnosticEnd);
  assert.match(source, /const maximumDiagnostics = 64;/u);
  assert.match(
    source,
    /const canonicalDeliveryIdPattern =\s*\/\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{12\}\$\/u;/u,
  );
  assert.match(
    diagnosticShape,
    /diagnostics\.length > maximumDiagnostics\) diagnostics\.shift\(\)/u,
  );
  assert.match(diagnosticShape, /reason,[\s\S]*status,[\s\S]*deliveryId:[\s\S]*attemptNumber:/u);
  assert.match(
    diagnosticShape,
    /canonicalDeliveryIdPattern\.test\(delivery\.delivery_id\)[\s\S]*\? delivery\.delivery_id[\s\S]*: null/u,
    "diagnostic delivery ids must be fixed-width canonical UUIDs",
  );
  assert.doesNotMatch(
    diagnosticShape,
    /credential|account_id|principal_id|authorization|authToken|probe_token/u,
    "provider diagnostics must never retain credential, account, principal, auth, or probe-token material",
  );
  assert.match(
    source,
    /error\.message = `\$\{error\.message\}; identity delivery provider diagnostics=/u,
  );

  const bootstrapStart = source.indexOf("async function createInvites(");
  const bootstrapEnd = source.indexOf("async function createAccounts(", bootstrapStart);
  const bootstrapSource = source.slice(bootstrapStart, bootstrapEnd);
  assert.match(
    bootstrapSource,
    /for \(const \[role, invitation\] of invitations\)[\s\S]*await createInvite\([\s\S]*await waitForDeliveredProviderCapture\([\s\S]*issued\[role\] = receipt/u,
    "bootstrap invitations must prove one delivery before the next credential is issued",
  );
  const deliveryAcknowledgementStart = source.indexOf(
    "function deliveryCredentialMatchesExpectation(",
  );
  const deliveryAcknowledgementEnd = source.indexOf(
    "async function issueCommunityInvitation(",
    deliveryAcknowledgementStart,
  );
  const deliveryAcknowledgement = source.slice(
    deliveryAcknowledgementStart,
    deliveryAcknowledgementEnd,
  );
  assert.match(deliveryAcknowledgement, /let deliveryObservationFailureCount = 0;/u);
  assert.match(
    deliveryAcknowledgement,
    /try \{[\s\S]*persisted = await storedDeliveryIntent\(\{[\s\S]*timeoutMs: Math\.min\(deliveryIntentObservationTimeoutMs, remainingMs\)[\s\S]*\} catch \{[\s\S]*deliveryObservationFailureCount \+= 1;[\s\S]*continue;/u,
    "transient delivery-observation failures must retry within the existing deadline",
  );
  assert.doesNotMatch(
    deliveryAcknowledgement,
    /catch \(error\)|error\.message|error\.stack|String\(error\)|DATABASE_(?:MIGRATION_)?URL|JSON\.stringify\((?:capture|credentialExpectation|expectedAccountId)\)/u,
    "delivery observation diagnostics must not retain database errors, URLs, identities, or credentials",
  );
  assert.match(
    deliveryAcknowledgement,
    /new Set\(\["delivered", "retryable_failed", "permanent_failed", "cancelled"\]\)/u,
    "every terminal persisted delivery state must fail closed unless the delivered contract matched",
  );
  assert.match(
    deliveryAcknowledgement,
    /diagnostics=\$\{JSON\.stringify\(\{[\s\S]*deliveryObservationFailureCount,[\s\S]*providerDiagnostics:/u,
  );
  for (const durableContract of [
    'persisted.status === "delivered"',
    "Number.isInteger(persisted.attemptCount)",
    "persisted.attemptCount >= capture.attempt_number",
    'persisted.providerId === "local-deterministic"',
    'persisted.outcomeKind === "delivered"',
    "persisted.outcomeCode === null",
  ]) {
    assert.ok(
      deliveryAcknowledgement.includes(durableContract),
      `bootstrap delivery acknowledgement omits ${durableContract}`,
    );
  }
  assert.ok(
    deliveryAcknowledgement.indexOf("persisted = await storedDeliveryIntent({") <
      deliveryAcknowledgement.indexOf("deliveryProvider.captures.delete(deliveryId)"),
    "provider capture must remain pending until the durable delivered receipt is observed",
  );
  assert.match(
    deliveryAcknowledgement,
    /if \(expectation\.kind === "exact"\)[\s\S]*if \(expectation\.kind === "prefix"\)/u,
    "the shared acknowledgement must support exact and prefix-only secret expectations",
  );
  const communityInvitationStart = source.indexOf(
    "async function issueCommunityInvitation(",
  );
  const communityInvitationEnd = source.indexOf(
    "async function storeCommunityInvitationCookie(",
    communityInvitationStart,
  );
  const communityInvitation = source.slice(
    communityInvitationStart,
    communityInvitationEnd,
  );
  assert.match(
    communityInvitation,
    /return await waitForDeliveredProviderCapture\(\{[\s\S]*expectedKind: "community_invitation"[\s\S]*kind: "prefix"[\s\S]*value: "fmci_"/u,
    "community invitation credentials require the shared capture plus durable-intent acknowledgement",
  );
  assert.doesNotMatch(
    communityInvitation,
    /deliveryProvider\.captures\.(?:get|delete)|while \(Date\.now\(\) <= deadline\)/u,
    "community invitation issuance must not bypass the shared durable acknowledgement",
  );
});

test("auth invite provider enforces one skew-guarded side-effect deadline", async () => {
  const source = await readFile("tools/game_invitation_role_proof.mjs", "utf8");

  assert.match(source, /function deliveryLeaseIsLive\(delivery\)/u);
  assert.match(
    source,
    /function deliveryClockSkewMarginCoversCrossClockBound\(delivery\)/u,
  );
  assert.match(
    source,
    /identityDeliveryProviderMaximumDatabaseClockLeadAndQuiescenceSeconds = 5/u,
  );
  assert.ok(
    source.indexOf(
      "const identityDeliveryProviderMaximumDatabaseClockLeadAndQuiescenceSeconds = 5;",
    ) < source.indexOf("await preflightLocalhostBindOrExit({"),
    "provider handler dependencies must initialize before top-level orchestration can serve requests",
  );
  assert.equal(
    source.match(/deliveryLeaseIsLive\(delivery\)/gu)?.length,
    3,
    "the helper definition, admission check, and final pre-effect check must remain explicit",
  );
  assert.match(
    source,
    /if \(!deliveryLeaseIsLive\(delivery\)\) \{[\s\S]*?outcome = commitIdentityDeliveryProviderTransition\(\{/u,
    "the final lease guard must precede the synchronous provider commit",
  );
  assert.match(source, /schema: "fmarch\.identity-delivery-result\.v2"/u);
  for (const field of ["provider_generation", "delivery_id", "attempt_token"]) {
    assert.match(
      source,
      new RegExp(`${field}: delivery\\.${field}`, "u"),
      `provider completion must echo ${field}`,
    );
  }
});
