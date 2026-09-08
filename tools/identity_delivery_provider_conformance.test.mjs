import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import test from "node:test";

import {
  identityDeliveryClockSkewMarginCoversBound,
  identityDeliveryLeaseIsLive,
  startIdentityDeliveryProviderFixture,
} from "./identity_delivery_provider_fixture.mjs";
import { createIdentityDeliveryProviderModel } from "./identity_delivery_provider_model.mjs";

const providerGeneration = "local-deterministic";
const providerAuthToken = "identity-provider-conformance-auth";
const providerNowSeconds = 2_000_000_000;
const minimumClockSkewMarginSeconds = 5;
const retryAfterSeconds = 7;
const requestTimeoutMs = 5_000;

function canonicalUuid(serial) {
  return `00000000-0000-4000-8000-${serial.toString(16).padStart(12, "0")}`;
}

function delivery(overrides = {}) {
  const deliveryId = overrides.delivery_id ?? canonicalUuid(1);
  return {
    schema: "fmarch.identity-delivery.v2",
    provider_generation: providerGeneration,
    delivery_id: deliveryId,
    attempt_token: canonicalUuid(101),
    lease_expires_at: providerNowSeconds + 60,
    clock_skew_margin_seconds: minimumClockSkewMarginSeconds,
    delivery_kind: "invite",
    account_id: "provider-conformance@example.test",
    principal_id: canonicalUuid(901),
    credential: "provider-conformance-credential",
    attempt_number: 1,
    idempotency_key: deliveryId,
    ...overrides,
  };
}

async function startFixture(testContext, overrides = {}) {
  const fixture = await startIdentityDeliveryProviderFixture({
    authToken: providerAuthToken,
    providerGeneration,
    retryAfterSeconds,
    minimumClockSkewMarginSeconds,
    nowSeconds: () => providerNowSeconds,
    ...overrides,
  });
  testContext.after(async () => {
    await fixture.close();
  });
  return fixture;
}

function requestBytes(
  endpoint,
  {
    method = "POST",
    authToken = providerAuthToken,
    body = Buffer.alloc(0),
    headers = {},
  } = {},
) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const requestHeaders = {
    connection: "close",
    "content-length": String(payload.length),
    "content-type": "application/json",
    ...headers,
  };
  if (authToken !== null) {
    requestHeaders.authorization = `Bearer ${authToken}`;
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout;
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };
    const fail = (error) => {
      const detail = error instanceof Error ? error.message : String(error);
      settle(
        reject,
        new Error(
          `identity delivery fixture connection closed before a complete response: ${detail}`,
          { cause: error },
        ),
      );
    };

    const clientRequest = httpRequest(
      endpoint,
      {
        agent: false,
        headers: requestHeaders,
        method,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.once("aborted", () => fail(new Error("response aborted")));
        response.once("error", fail);
        response.once("end", () => {
          settle(resolve, {
            body: Buffer.concat(chunks),
            headers: response.headers,
            status: response.statusCode,
          });
        });
      },
    );
    clientRequest.once("error", fail);
    timeout = setTimeout(() => {
      clientRequest.destroy(new Error("request timed out"));
    }, requestTimeoutMs);
    clientRequest.end(payload);
  });
}

function postJson(endpoint, value, options = {}) {
  return requestBytes(endpoint, {
    ...options,
    body: Buffer.from(JSON.stringify(value)),
  });
}

function parseSuccessfulJson(response) {
  assert.equal(response.status, 200);
  assert.match(response.headers["content-type"] ?? "", /^application\/json\b/u);
  return JSON.parse(response.body.toString("utf8"));
}

function assertLastDiagnostic(fixture, reason, status) {
  const diagnostic = fixture.diagnosticsSnapshot().at(-1);
  assert.equal(diagnostic?.reason, reason);
  assert.equal(diagnostic?.status, status);
  return diagnostic;
}

function assertEmptyRejection(response, status) {
  assert.equal(response.status, status);
  assert.equal(response.body.length, 0);
}

function assertDeliveredOutcome(outcome, request) {
  assert.deepEqual(Object.keys(outcome).sort(), [
    "attempt_token",
    "delivery_id",
    "provider_generation",
    "provider_receipt_id",
    "schema",
    "status",
  ]);
  assert.equal(outcome.schema, "fmarch.identity-delivery-result.v2");
  assert.equal(outcome.provider_generation, request.provider_generation);
  assert.equal(outcome.delivery_id, request.delivery_id);
  assert.equal(outcome.attempt_token, request.attempt_token);
  assert.equal(outcome.status, "delivered");
  assert.equal(outcome.provider_receipt_id, `local-${request.delivery_id}`);
}

function assertRetryableOutcome(outcome, request) {
  assert.deepEqual(Object.keys(outcome).sort(), [
    "attempt_token",
    "code",
    "delivery_id",
    "provider_generation",
    "retry_after_seconds",
    "schema",
    "status",
  ]);
  assert.equal(outcome.schema, "fmarch.identity-delivery-result.v2");
  assert.equal(outcome.provider_generation, request.provider_generation);
  assert.equal(outcome.delivery_id, request.delivery_id);
  assert.equal(outcome.attempt_token, request.attempt_token);
  assert.equal(outcome.status, "retryable_failure");
  assert.equal(outcome.code, "provider_unavailable");
  assert.equal(outcome.retry_after_seconds, retryAfterSeconds);
}

function paddedJsonBody(value, byteLength) {
  const encoded = Buffer.from(JSON.stringify(value));
  assert.ok(encoded.length <= byteLength, "fixture request must fit inside padding target");
  return Buffer.concat([
    encoded,
    Buffer.alloc(byteLength - encoded.length, " "),
  ]);
}

test("provider validators and configuration fail closed before binding", async () => {
  const request = delivery({ lease_expires_at: 101, clock_skew_margin_seconds: 5 });
  assert.equal(identityDeliveryLeaseIsLive(request, { nowSeconds: () => 100 }), true);
  assert.equal(identityDeliveryLeaseIsLive(request, { nowSeconds: () => 101 }), false);
  assert.equal(identityDeliveryLeaseIsLive(request, { nowSeconds: () => Number.NaN }), false);
  assert.throws(
    () => identityDeliveryLeaseIsLive(request, { nowSeconds: 100 }),
    /nowSeconds must be a function/u,
  );
  assert.equal(
    identityDeliveryClockSkewMarginCoversBound(request, {
      minimumClockSkewMarginSeconds: 5,
    }),
    true,
  );
  assert.equal(
    identityDeliveryClockSkewMarginCoversBound(request, {
      minimumClockSkewMarginSeconds: 6,
    }),
    false,
  );

  const validConfiguration = {
    authToken: providerAuthToken,
    providerGeneration,
    retryAfterSeconds,
    minimumClockSkewMarginSeconds,
    nowSeconds: () => providerNowSeconds,
  };
  for (const [overrides, pattern] of [
    [{ authToken: "" }, /authToken must be non-empty/u],
    [{ providerGeneration: "" }, /providerGeneration must be non-empty/u],
    [{ retryAfterSeconds: 0 }, /retryAfterSeconds must be a positive safe integer/u],
    [
      { minimumClockSkewMarginSeconds: -1 },
      /minimumClockSkewMarginSeconds must be a non-negative safe integer/u,
    ],
    [{ nowSeconds: 100 }, /nowSeconds must be a function/u],
  ]) {
    await assert.rejects(
      startIdentityDeliveryProviderFixture({
        ...validConfiguration,
        ...overrides,
      }),
      pattern,
    );
  }
});

test("provider model makes prepare mutation-free and commit an owned single-use publication", () => {
  const model = createIdentityDeliveryProviderModel({ retryAfterSeconds });
  const anotherModel = createIdentityDeliveryProviderModel({ retryAfterSeconds });
  const request = delivery();
  const firstPlan = model.prepare(request);
  const competingPlan = model.prepare(request);

  assert.equal(firstPlan.kind, "prepared");
  assert.equal(firstPlan.transitionKind, "start");
  assertDeliveredOutcome(firstPlan.outcome, request);
  assert.equal(model.captureCount(), 0, "planning must not publish a provider effect");
  assert.throws(
    () => anotherModel.commit(firstPlan),
    /was not prepared by this model/u,
  );

  assert.equal(model.commit(firstPlan), firstPlan.outcome);
  assert.equal(model.captureCount(), 1);
  assert.throws(() => model.commit(firstPlan), /already committed/u);
  assert.throws(() => model.commit(competingPlan), /prepared result is stale/u);
  assert.equal(model.captureCount(), 1, "a stale plan must not repeat the effect");

  const capture = model.captureFor(request.delivery_id);
  assert.notEqual(capture, request);
  assert.deepEqual(capture, request);
  assert.equal(Object.isFrozen(capture), true);

  const cached = model.prepare(request);
  assert.equal(cached.kind, "cached");
  assert.equal(cached.outcome, firstPlan.outcome);
  assert.throws(() => model.commit(cached), /was not prepared by this model/u);
  assert.equal(model.captureCount(), 1);

  assert.throws(
    () => model.acknowledgeCapture(request.delivery_id, canonicalUuid(999)),
    /acknowledgement token did not match/u,
  );
  assert.equal(model.captureCount(), 1);
  assert.equal(
    model.acknowledgeCapture(request.delivery_id, request.attempt_token),
    true,
  );
  assert.equal(model.acknowledgeCapture(request.delivery_id, request.attempt_token), false);
  assert.equal(model.captureCount(), 0);
});

test("provider model commits independently prepared deliveries while stale-fencing the same delivery", () => {
  const model = createIdentityDeliveryProviderModel({ retryAfterSeconds });
  const firstRequest = delivery({
    delivery_id: canonicalUuid(83),
    attempt_token: canonicalUuid(183),
    idempotency_key: canonicalUuid(83),
  });
  const secondRequest = delivery({
    delivery_id: canonicalUuid(84),
    attempt_token: canonicalUuid(184),
    credential: "second-independent-provider-credential",
    idempotency_key: canonicalUuid(84),
  });
  const firstPlan = model.prepare(firstRequest);
  const secondPlan = model.prepare(secondRequest);

  assertDeliveredOutcome(model.commit(firstPlan), firstRequest);
  assertDeliveredOutcome(model.commit(secondPlan), secondRequest);
  assert.deepEqual(model.captureFor(firstRequest.delivery_id), firstRequest);
  assert.deepEqual(model.captureFor(secondRequest.delivery_id), secondRequest);
  assert.equal(model.captureCount(), 2);

  const sameDelivery = delivery({
    delivery_id: canonicalUuid(85),
    attempt_token: canonicalUuid(185),
    idempotency_key: canonicalUuid(85),
  });
  const sameDeliveryPlan = model.prepare(sameDelivery);
  const competingSameDeliveryPlan = model.prepare(sameDelivery);
  assertDeliveredOutcome(model.commit(sameDeliveryPlan), sameDelivery);
  assert.throws(
    () => model.commit(competingSameDeliveryPlan),
    /prepared result is stale/u,
  );
  assert.deepEqual(model.captureFor(sameDelivery.delivery_id), sameDelivery);
  assert.equal(model.captureCount(), 3);
});

test("provider model leaves state and one-shot fault arms untouched when response serialization fails", () => {
  const model = createIdentityDeliveryProviderModel({ retryAfterSeconds });
  const credential = "serialization-failure-fault-target";
  model.armRetryableFailure({
    expectedKind: "invite",
    credential,
  });

  let generationSerializationCount = 0;
  const generationThatFailsOnlyWhenTheOutcomeSerializes = {
    toJSON() {
      generationSerializationCount += 1;
      return generationSerializationCount <= 2 ? providerGeneration : 1n;
    },
  };
  const unserializableRequest = delivery({
    delivery_id: canonicalUuid(81),
    attempt_token: canonicalUuid(181),
    credential,
    idempotency_key: canonicalUuid(81),
    provider_generation: generationThatFailsOnlyWhenTheOutcomeSerializes,
  });
  const prepared = model.prepare(unserializableRequest);
  assert.equal(prepared.kind, "prepared");
  assert.equal(prepared.transitionKind, "start");
  assert.equal(prepared.outcome.status, "retryable_failure");
  assert.throws(() => JSON.stringify(prepared.outcome), TypeError);
  assert.equal(model.captureCount(), 0);

  const correctedRequest = {
    ...unserializableRequest,
    provider_generation: providerGeneration,
  };
  const corrected = model.prepare(correctedRequest);
  assert.equal(corrected.kind, "prepared");
  assert.equal(corrected.transitionKind, "start");
  assertRetryableOutcome(corrected.outcome, correctedRequest);
  model.commit(corrected);
  assert.equal(model.captureCount(), 0);

  const armWasConsumedOnlyByTheCommit = delivery({
    delivery_id: canonicalUuid(82),
    attempt_token: canonicalUuid(182),
    credential,
    idempotency_key: canonicalUuid(82),
  });
  const delivered = model.prepare(armWasConsumedOnlyByTheCommit);
  assertDeliveredOutcome(delivered.outcome, armWasConsumedOnlyByTheCommit);
  model.commit(delivered);
  assert.equal(model.captureCount(), 1);
});

test("provider model fences exact-token and later-generation effect identity mutation", () => {
  const model = createIdentityDeliveryProviderModel({ retryAfterSeconds });
  const request = delivery();
  model.commit(model.prepare(request));

  for (const [field, value] of [
    ["delivery_kind", "recovery"],
    ["account_id", "mutated@example.test"],
    ["principal_id", canonicalUuid(902)],
    ["credential", "mutated-provider-credential"],
  ]) {
    assert.deepEqual(
      model.prepare({ ...request, [field]: value }),
      { kind: "rejected", reason: "effect_identity_rejected" },
      `exact attempt-token replay may not mutate ${field}`,
    );
    assert.deepEqual(
      model.prepare({
        ...request,
        [field]: value,
        attempt_number: 2,
        attempt_token: canonicalUuid(200 + field.length),
      }),
      { kind: "rejected", reason: "effect_identity_rejected" },
      `later delivery generation may not mutate ${field}`,
    );
  }

  assert.deepEqual(model.captureFor(request.delivery_id), request);
  assert.equal(model.captureCount(), 1);
});

test("provider model covers targeted retryable failure, reclaim, retry, reconciliation, and stale generations", () => {
  const model = createIdentityDeliveryProviderModel({ retryAfterSeconds });
  model.armRetryableFailure({
    expectedKind: "invite",
    credential: "armed-provider-credential",
  });
  assert.throws(
    () =>
      model.armRetryableFailure({
        expectedKind: "invite",
        credential: "armed-provider-credential",
      }),
    /already armed/u,
  );

  const nonmatching = delivery({
    delivery_id: canonicalUuid(2),
    attempt_token: canonicalUuid(102),
    credential: "different-provider-credential",
    idempotency_key: canonicalUuid(2),
  });
  const nonmatchingPlan = model.prepare(nonmatching);
  assertDeliveredOutcome(nonmatchingPlan.outcome, nonmatching);
  model.commit(nonmatchingPlan);

  const failedRequest = delivery({
    delivery_id: canonicalUuid(3),
    attempt_token: canonicalUuid(103),
    credential: "armed-provider-credential",
    idempotency_key: canonicalUuid(3),
  });
  const failedPlan = model.prepare(failedRequest);
  assert.equal(failedPlan.transitionKind, "start");
  assertRetryableOutcome(failedPlan.outcome, failedRequest);
  model.commit(failedPlan);
  assert.equal(model.captureFor(failedRequest.delivery_id), undefined);

  const consumedArmRequest = delivery({
    delivery_id: canonicalUuid(4),
    attempt_token: canonicalUuid(104),
    credential: "armed-provider-credential",
    idempotency_key: canonicalUuid(4),
  });
  const consumedArmPlan = model.prepare(consumedArmRequest);
  assertDeliveredOutcome(consumedArmPlan.outcome, consumedArmRequest);
  model.commit(consumedArmPlan);

  const exactFailedReplay = model.prepare(failedRequest);
  assert.equal(exactFailedReplay.kind, "cached");
  assertRetryableOutcome(exactFailedReplay.outcome, failedRequest);

  const reclaimedRequest = {
    ...failedRequest,
    attempt_token: canonicalUuid(203),
  };
  const reclaim = model.prepare(reclaimedRequest);
  assert.equal(reclaim.transitionKind, "reclaim");
  assertRetryableOutcome(reclaim.outcome, reclaimedRequest);
  model.commit(reclaim);
  assert.equal(model.captureFor(failedRequest.delivery_id), undefined);

  const retryRequest = {
    ...failedRequest,
    attempt_number: 2,
    attempt_token: canonicalUuid(303),
  };
  const retry = model.prepare(retryRequest);
  assert.equal(retry.transitionKind, "retry");
  assertDeliveredOutcome(retry.outcome, retryRequest);
  model.commit(retry);
  assert.deepEqual(model.captureFor(failedRequest.delivery_id), retryRequest);

  let previousReceipt = retry.outcome.provider_receipt_id;
  for (const [attemptNumber, attemptToken] of [
    [3, canonicalUuid(403)],
    [4, canonicalUuid(503)],
  ]) {
    const reconcileRequest = {
      ...failedRequest,
      attempt_number: attemptNumber,
      attempt_token: attemptToken,
    };
    const reconcile = model.prepare(reconcileRequest);
    assert.equal(reconcile.transitionKind, "reconcile");
    assertDeliveredOutcome(reconcile.outcome, reconcileRequest);
    assert.equal(reconcile.outcome.provider_receipt_id, previousReceipt);
    model.commit(reconcile);
    previousReceipt = reconcile.outcome.provider_receipt_id;
  }
  assert.deepEqual(
    model.captureFor(failedRequest.delivery_id),
    retryRequest,
    "reconciliation must not repeat or replace the delivered effect",
  );

  const historicalAttempt = model.prepare(failedRequest);
  assert.equal(historicalAttempt.kind, "cached");
  assertRetryableOutcome(historicalAttempt.outcome, failedRequest);
  assert.deepEqual(
    model.prepare({
      ...failedRequest,
      attempt_number: 2,
      attempt_token: canonicalUuid(603),
    }),
    { kind: "rejected", reason: "attempt_generation_rejected" },
  );
  assert.deepEqual(
    model.prepare({
      ...failedRequest,
      attempt_number: 6,
      attempt_token: canonicalUuid(703),
    }),
    { kind: "rejected", reason: "attempt_generation_rejected" },
  );
  assert.deepEqual(
    model.prepare(
      delivery({
        delivery_id: canonicalUuid(5),
        attempt_token: canonicalUuid(105),
        attempt_number: 2,
        idempotency_key: canonicalUuid(5),
      }),
    ),
    { kind: "rejected", reason: "attempt_generation_rejected" },
  );

  model.armRetryableFailure({
    expectedKind: "recovery",
    expectedAccountId: "account-target@example.test",
  });
  const accountTarget = delivery({
    delivery_id: canonicalUuid(6),
    attempt_token: canonicalUuid(106),
    delivery_kind: "recovery",
    account_id: "account-target@example.test",
    credential: "account-target-credential",
    idempotency_key: canonicalUuid(6),
  });
  const accountFailure = model.prepare(accountTarget);
  assertRetryableOutcome(accountFailure.outcome, accountTarget);
  model.commit(accountFailure);
});

test("loopback HTTP authenticates before parsing and keeps probes side-effect free", async (t) => {
  const fixture = await startFixture(t);
  const validRequest = delivery();

  const missingAuth = await postJson(fixture.endpoint, validRequest, {
    authToken: null,
  });
  assertEmptyRejection(missingAuth, 401);
  assertLastDiagnostic(fixture, "request_authentication_rejected", 401);

  const wrongAuthMalformedJson = await requestBytes(fixture.endpoint, {
    authToken: "wrong-auth-token",
    body: "{",
  });
  assertEmptyRejection(wrongAuthMalformedJson, 401);
  assertLastDiagnostic(fixture, "request_authentication_rejected", 401);

  const wrongMethod = await requestBytes(fixture.endpoint, {
    method: "GET",
  });
  assertEmptyRejection(wrongMethod, 401);
  assertLastDiagnostic(fixture, "request_authentication_rejected", 401);

  for (const malformed of [Buffer.alloc(0), Buffer.from("{")]) {
    const response = await requestBytes(fixture.endpoint, { body: malformed });
    assertEmptyRejection(response, 400);
    assertLastDiagnostic(fixture, "request_json_rejected", 400);
  }
  for (const invalidShape of [null, [], "delivery"]) {
    const response = await postJson(fixture.endpoint, invalidShape);
    assertEmptyRejection(response, 409);
    assertLastDiagnostic(fixture, "delivery_shape_rejected", 409);
  }

  const probe = {
    schema: "fmarch.identity-delivery-provider-probe.v1",
    provider_generation: providerGeneration,
    probe_token: canonicalUuid(801),
  };
  assert.deepEqual(parseSuccessfulJson(await postJson(fixture.endpoint, probe)), {
    ...probe,
    status: "available",
  });
  assertLastDiagnostic(fixture, "probe_available", 200);
  assert.equal(fixture.captureCount(), 0);

  for (const invalidProbe of [
    { ...probe, provider_generation: "other-generation" },
    { ...probe, probe_token: 801 },
    { ...probe, probe_token: "" },
    { ...probe, probe_token: "not-a-canonical-uuid" },
  ]) {
    const response = await postJson(fixture.endpoint, invalidProbe);
    assertEmptyRejection(response, 409);
    assertLastDiagnostic(fixture, "probe_contract_rejected", 409);
  }
  assert.equal(fixture.captureCount(), 0);
});

test("loopback HTTP rejects malformed UTF-8 without mutation and remains usable", async (t) => {
  const fixture = await startFixture(t);
  const validRequest = delivery({
    delivery_id: canonicalUuid(91),
    attempt_token: canonicalUuid(191),
    credential: "utf8-rejection-provider-credential",
    idempotency_key: canonicalUuid(91),
  });
  const encoded = Buffer.from(JSON.stringify(validRequest));
  const credentialOffset = encoded.indexOf(Buffer.from(validRequest.credential));
  assert.notEqual(credentialOffset, -1);
  const malformedUtf8 = Buffer.concat([
    encoded.subarray(0, credentialOffset),
    Buffer.from([0xc3, 0x28]),
    encoded.subarray(credentialOffset + Buffer.byteLength(validRequest.credential)),
  ]);

  const rejected = await requestBytes(fixture.endpoint, { body: malformedUtf8 });
  assertEmptyRejection(rejected, 400);
  assertLastDiagnostic(fixture, "request_json_rejected", 400);
  assert.equal(fixture.captureCount(), 0);
  assert.equal(fixture.captureFor(validRequest.delivery_id), undefined);

  assertDeliveredOutcome(
    parseSuccessfulJson(await postJson(fixture.endpoint, validRequest)),
    validRequest,
  );
  assert.deepEqual(fixture.captureFor(validRequest.delivery_id), validRequest);
  assert.equal(fixture.captureCount(), 1);
});

test("loopback HTTP enforces the request body limit in bytes at the exact boundary", async (t) => {
  const fixture = await startFixture(t);
  const exactRequest = delivery({
    delivery_id: canonicalUuid(11),
    attempt_token: canonicalUuid(111),
    idempotency_key: canonicalUuid(11),
  });
  const exactBody = paddedJsonBody(exactRequest, 64 * 1024);
  assert.equal(exactBody.length, 64 * 1024);
  assertDeliveredOutcome(
    parseSuccessfulJson(
      await requestBytes(fixture.endpoint, {
        body: exactBody,
      }),
    ),
    exactRequest,
  );
  assert.equal(fixture.captureCount(), 1);

  const oversizedRequest = delivery({
    delivery_id: canonicalUuid(12),
    attempt_token: canonicalUuid(112),
    idempotency_key: canonicalUuid(12),
  });
  const oversizedBody = paddedJsonBody(oversizedRequest, 64 * 1024 + 1);
  assert.equal(oversizedBody.length, 64 * 1024 + 1);
  const oversized = await requestBytes(fixture.endpoint, {
    body: oversizedBody,
  });
  assertEmptyRejection(oversized, 413);
  assertLastDiagnostic(fixture, "request_body_too_large", 413);
  assert.equal(fixture.captureCount(), 1);
  assert.equal(fixture.captureFor(oversizedRequest.delivery_id), undefined);
});

test("loopback HTTP rejects each delivery contract violation without publishing an effect", async (t) => {
  const fixture = await startFixture(t);
  const base = delivery({
    delivery_id: canonicalUuid(21),
    attempt_token: canonicalUuid(121),
    idempotency_key: canonicalUuid(21),
  });
  const cases = [
    [{ ...base, schema: "fmarch.identity-delivery.v1" }, "delivery_schema_rejected"],
    [
      { ...base, provider_generation: "other-generation" },
      "provider_generation_rejected",
    ],
    [{ ...base, attempt_token: 121 }, "attempt_token_rejected"],
    [{ ...base, attempt_token: "not-a-uuid" }, "delivery_shape_rejected"],
    [{ ...base, account_id: "" }, "delivery_shape_rejected"],
    [{ ...base, attempt_number: 0 }, "delivery_shape_rejected"],
    [
      { ...base, lease_expires_at: providerNowSeconds },
      "effect_deadline_rejected",
    ],
    [
      { ...base, clock_skew_margin_seconds: minimumClockSkewMarginSeconds - 1 },
      "clock_skew_margin_rejected",
    ],
    [{ ...base, idempotency_key: canonicalUuid(22) }, "idempotency_key_rejected"],
  ];

  for (const [invalidRequest, reason] of cases) {
    const response = await postJson(fixture.endpoint, invalidRequest);
    assertEmptyRejection(response, 409);
    assertLastDiagnostic(fixture, reason, 409);
    assert.equal(fixture.captureCount(), 0);
  }

  assertDeliveredOutcome(
    parseSuccessfulJson(await postJson(fixture.endpoint, base)),
    base,
  );
  assert.equal(fixture.captureCount(), 1);
});

test("loopback HTTP rejects unsupported delivery domains and unsafe wire integers without mutation", async (t) => {
  const fixture = await startFixture(t);
  const cases = [
    [{ delivery_kind: "" }, "delivery_shape_rejected"],
    [{ delivery_kind: "unknown_delivery_kind" }, "delivery_shape_rejected"],
    [{ principal_id: "" }, "delivery_shape_rejected"],
    [{ principal_id: "not-a-canonical-uuid" }, "delivery_shape_rejected"],
    [{ attempt_number: 2_147_483_648 }, "delivery_shape_rejected"],
    [{ attempt_number: Number.MAX_SAFE_INTEGER + 1 }, "delivery_shape_rejected"],
    [{ lease_expires_at: -1 }, "delivery_shape_rejected"],
    [
      { lease_expires_at: Number.MAX_SAFE_INTEGER + 1 },
      "delivery_shape_rejected",
    ],
    [{ clock_skew_margin_seconds: -1 }, "delivery_shape_rejected"],
    [
      { clock_skew_margin_seconds: Number.MAX_SAFE_INTEGER + 1 },
      "delivery_shape_rejected",
    ],
  ];

  for (const [index, [overrides, reason]] of cases.entries()) {
    const deliveryId = canonicalUuid(100 + index);
    const invalidRequest = delivery({
      delivery_id: deliveryId,
      attempt_token: canonicalUuid(300 + index),
      idempotency_key: deliveryId,
      ...overrides,
    });
    const response = await postJson(fixture.endpoint, invalidRequest);
    assertEmptyRejection(response, 409);
    assertLastDiagnostic(fixture, reason, 409);
    assert.equal(fixture.captureFor(deliveryId), undefined);
    assert.equal(fixture.captureCount(), 0);
  }
});

test("loopback HTTP commits concurrent unrelated deliveries independently", async (t) => {
  const fixture = await startFixture(t);
  const firstRequest = delivery({
    delivery_id: canonicalUuid(121),
    attempt_token: canonicalUuid(321),
    idempotency_key: canonicalUuid(121),
  });
  const secondRequest = delivery({
    delivery_id: canonicalUuid(122),
    attempt_token: canonicalUuid(322),
    credential: "concurrent-independent-provider-credential",
    idempotency_key: canonicalUuid(122),
  });

  const [firstResponse, secondResponse] = await Promise.all([
    postJson(fixture.endpoint, firstRequest),
    postJson(fixture.endpoint, secondRequest),
  ]);
  assertDeliveredOutcome(parseSuccessfulJson(firstResponse), firstRequest);
  assertDeliveredOutcome(parseSuccessfulJson(secondResponse), secondRequest);
  assert.deepEqual(fixture.captureFor(firstRequest.delivery_id), firstRequest);
  assert.deepEqual(fixture.captureFor(secondRequest.delivery_id), secondRequest);
  assert.equal(fixture.captureCount(), 2);
});

test("loopback HTTP rechecks the lease after planning and serialization before commit", async (t) => {
  const clockReads = [providerNowSeconds, providerNowSeconds + 1];
  const fixture = await startFixture(t, {
    nowSeconds: () => clockReads.shift() ?? providerNowSeconds,
  });
  const request = delivery({
    delivery_id: canonicalUuid(31),
    attempt_token: canonicalUuid(131),
    credential: "deadline-fault-target",
    idempotency_key: canonicalUuid(31),
    lease_expires_at: providerNowSeconds + 1,
  });
  fixture.armRetryableFailure({
    expectedKind: "invite",
    credential: request.credential,
  });

  const elapsed = await postJson(fixture.endpoint, request);
  assertEmptyRejection(elapsed, 409);
  assertLastDiagnostic(fixture, "effect_deadline_elapsed_before_commit", 409);
  assert.equal(fixture.captureCount(), 0);

  const accepted = parseSuccessfulJson(await postJson(fixture.endpoint, request));
  assertRetryableOutcome(accepted, request);
  assertLastDiagnostic(fixture, "fault_injected_provider_unavailable", 200);
  assert.equal(fixture.captureCount(), 0);
});

test("loopback HTTP preserves exact-token idempotency and reconciles later generations without repeated effects", async (t) => {
  const fixture = await startFixture(t);
  const initialRequest = delivery({
    delivery_id: canonicalUuid(41),
    attempt_token: canonicalUuid(141),
    idempotency_key: canonicalUuid(41),
  });
  const initialResponse = await postJson(fixture.endpoint, initialRequest);
  const initialOutcome = parseSuccessfulJson(initialResponse);
  assertDeliveredOutcome(initialOutcome, initialRequest);
  assert.equal(fixture.captureCount(), 1);

  const exactReplay = await postJson(fixture.endpoint, initialRequest);
  assert.equal(exactReplay.body.toString("utf8"), initialResponse.body.toString("utf8"));
  assert.equal(fixture.captureCount(), 1);

  for (const invalidReplay of [
    { ...initialRequest, attempt_number: 2 },
    { ...initialRequest, credential: "mutated-exact-token-credential" },
    {
      ...initialRequest,
      account_id: "mutated-later-generation@example.test",
      attempt_number: 2,
      attempt_token: canonicalUuid(241),
    },
  ]) {
    const response = await postJson(fixture.endpoint, invalidReplay);
    assertEmptyRejection(response, 409);
  }
  assert.equal(fixture.captureCount(), 1);

  let receipt = initialOutcome.provider_receipt_id;
  for (const [attemptNumber, attemptToken] of [
    [2, canonicalUuid(241)],
    [3, canonicalUuid(341)],
  ]) {
    const reconcileRequest = {
      ...initialRequest,
      attempt_number: attemptNumber,
      attempt_token: attemptToken,
    };
    const outcome = parseSuccessfulJson(
      await postJson(fixture.endpoint, reconcileRequest),
    );
    assertDeliveredOutcome(outcome, reconcileRequest);
    assert.equal(outcome.provider_receipt_id, receipt);
    assert.equal(fixture.captureCount(), 1);
    receipt = outcome.provider_receipt_id;
  }

  for (const staleRequest of [
    {
      ...initialRequest,
      attempt_number: 2,
      attempt_token: canonicalUuid(441),
    },
    {
      ...initialRequest,
      attempt_number: 5,
      attempt_token: canonicalUuid(541),
    },
  ]) {
    const response = await postJson(fixture.endpoint, staleRequest);
    assertEmptyRejection(response, 409);
    assertLastDiagnostic(fixture, "attempt_generation_rejected", 409);
  }
  assert.equal(fixture.captureCount(), 1);
  assert.deepEqual(fixture.captureFor(initialRequest.delivery_id), initialRequest);
});

test("loopback HTTP commits retryable failure, reclaim, retry, and reconciliation with one delivered capture", async (t) => {
  const fixture = await startFixture(t);
  const failedRequest = delivery({
    delivery_id: canonicalUuid(51),
    attempt_token: canonicalUuid(151),
    credential: "http-retryable-target",
    idempotency_key: canonicalUuid(51),
  });
  fixture.armRetryableFailure({
    expectedKind: "invite",
    credential: failedRequest.credential,
  });

  const failedResponse = await postJson(fixture.endpoint, failedRequest);
  const failedOutcome = parseSuccessfulJson(failedResponse);
  assertRetryableOutcome(failedOutcome, failedRequest);
  assert.equal(fixture.captureCount(), 0);
  const exactReplay = await postJson(fixture.endpoint, failedRequest);
  assert.equal(exactReplay.body.toString("utf8"), failedResponse.body.toString("utf8"));

  const reclaimRequest = {
    ...failedRequest,
    attempt_token: canonicalUuid(251),
  };
  const reclaimed = parseSuccessfulJson(
    await postJson(fixture.endpoint, reclaimRequest),
  );
  assertRetryableOutcome(reclaimed, reclaimRequest);
  assert.equal(fixture.captureCount(), 0);

  const retryRequest = {
    ...failedRequest,
    attempt_number: 2,
    attempt_token: canonicalUuid(351),
  };
  const retried = parseSuccessfulJson(await postJson(fixture.endpoint, retryRequest));
  assertDeliveredOutcome(retried, retryRequest);
  assert.equal(fixture.captureCount(), 1);
  assert.deepEqual(fixture.captureFor(failedRequest.delivery_id), retryRequest);

  const reconcileRequest = {
    ...failedRequest,
    attempt_number: 3,
    attempt_token: canonicalUuid(451),
  };
  const reconciled = parseSuccessfulJson(
    await postJson(fixture.endpoint, reconcileRequest),
  );
  assertDeliveredOutcome(reconciled, reconcileRequest);
  assert.equal(reconciled.provider_receipt_id, retried.provider_receipt_id);
  assert.equal(fixture.captureCount(), 1);
  assert.deepEqual(fixture.captureFor(failedRequest.delivery_id), retryRequest);
});

test("targeted post-commit disconnect yields transport uncertainty then exact replay and generation reconciliation", async (t) => {
  const fixture = await startFixture(t);
  const initialRequest = delivery({
    delivery_id: canonicalUuid(61),
    attempt_token: canonicalUuid(161),
    idempotency_key: canonicalUuid(61),
  });
  fixture.armPostCommitDisconnect({
    deliveryId: initialRequest.delivery_id,
    attemptToken: initialRequest.attempt_token,
  });
  assert.throws(
    () =>
      fixture.armPostCommitDisconnect({
        deliveryId: initialRequest.delivery_id,
        attemptToken: initialRequest.attempt_token,
      }),
    /already armed/u,
  );

  await assert.rejects(
    postJson(fixture.endpoint, initialRequest),
    /connection closed before a complete response/u,
  );
  assert.equal(fixture.captureCount(), 1);
  assert.deepEqual(fixture.captureFor(initialRequest.delivery_id), initialRequest);
  assert.deepEqual(
    fixture.diagnosticsSnapshot().find(
      ({ reason }) => reason === "fault_injected_post_commit_disconnect",
    ),
    {
      reason: "fault_injected_post_commit_disconnect",
      status: 0,
      deliveryId: initialRequest.delivery_id,
      attemptNumber: 1,
    },
  );

  const exactOutcome = parseSuccessfulJson(
    await postJson(fixture.endpoint, initialRequest),
  );
  assertDeliveredOutcome(exactOutcome, initialRequest);
  assert.equal(fixture.captureCount(), 1);

  const reconcileRequest = {
    ...initialRequest,
    attempt_number: 2,
    attempt_token: canonicalUuid(261),
  };
  const reconcileOutcome = parseSuccessfulJson(
    await postJson(fixture.endpoint, reconcileRequest),
  );
  assertDeliveredOutcome(reconcileOutcome, reconcileRequest);
  assert.equal(
    reconcileOutcome.provider_receipt_id,
    exactOutcome.provider_receipt_id,
  );
  assert.equal(fixture.captureCount(), 1);

  assert.throws(
    () =>
      fixture.acknowledgeCapture(
        initialRequest.delivery_id,
        reconcileRequest.attempt_token,
      ),
    /acknowledgement token did not match/u,
  );
  assert.equal(
    fixture.acknowledgeCapture(
      initialRequest.delivery_id,
      initialRequest.attempt_token,
    ),
    true,
  );
  assert.equal(fixture.captureCount(), 0);
});

test("loopback diagnostics are bounded, immutable, and exclude delivery secrets", async (t) => {
  const fixture = await startFixture(t);
  const rejectedAuthToken = "diagnostic-auth-secret-must-not-appear";
  for (let index = 0; index < 64; index += 1) {
    const response = await postJson(fixture.endpoint, { malformed: index }, {
      authToken: rejectedAuthToken,
    });
    assertEmptyRejection(response, 401);
  }

  const sensitiveRequest = delivery({
    delivery_id: canonicalUuid(71),
    attempt_token: canonicalUuid(171),
    account_id: "diagnostic-account-secret@example.test",
    principal_id: canonicalUuid(971),
    credential: "diagnostic-credential-secret-must-not-appear",
    idempotency_key: canonicalUuid(72),
  });
  const response = await postJson(fixture.endpoint, sensitiveRequest);
  assertEmptyRejection(response, 409);
  assertLastDiagnostic(fixture, "idempotency_key_rejected", 409);

  const diagnostics = fixture.diagnosticsSnapshot();
  assert.equal(diagnostics.length, 64);
  assert.equal(Object.isFrozen(diagnostics), true);
  assert.equal(diagnostics.every(Object.isFrozen), true);
  const serialized = JSON.stringify(diagnostics);
  for (const secret of [
    providerAuthToken,
    rejectedAuthToken,
    sensitiveRequest.account_id,
    sensitiveRequest.principal_id,
    sensitiveRequest.credential,
    sensitiveRequest.attempt_token,
  ]) {
    assert.equal(serialized.includes(secret), false, `diagnostics leaked ${secret}`);
  }
  assert.equal(serialized.includes(sensitiveRequest.delivery_id), true);
  assert.equal(fixture.captureCount(), 0);
});
