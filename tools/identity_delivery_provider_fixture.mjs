import { createServer } from "node:http";
import { TextDecoder } from "node:util";

import {
  createIdentityDeliveryProviderModel,
  identityDeliveryProviderSupportsKind,
} from "./identity_delivery_provider_model.mjs";

const maximumRequestBodyBytes = 64 * 1024;
const maximumDiagnostics = 64;
const canonicalDeliveryIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const fatalUtf8Decoder = new TextDecoder("utf-8", { fatal: true });
const maximumPositiveI32 = 2_147_483_647;
const handlerFailureReasonByStage = Object.freeze({
  request_authentication: "provider_handler_authentication_stage_failed",
  request_body: "provider_handler_body_stage_failed",
  request_dispatch: "provider_handler_dispatch_stage_failed",
  probe_response: "provider_handler_probe_response_stage_failed",
  delivery_validation: "provider_handler_delivery_validation_stage_failed",
  transition_lookup: "provider_handler_transition_lookup_stage_failed",
  transition_commit: "provider_handler_transition_commit_stage_failed",
  outcome_diagnostic: "provider_handler_outcome_diagnostic_stage_failed",
  response_serialization: "provider_handler_response_serialization_stage_failed",
  response_write: "provider_handler_response_write_stage_failed",
});

export function identityDeliveryLeaseIsLive(
  delivery,
  { nowSeconds = currentUnixTimeSeconds } = {},
) {
  if (typeof nowSeconds !== "function") {
    throw new TypeError("identity delivery provider nowSeconds must be a function");
  }
  const currentTime = nowSeconds();
  return (
    Number.isSafeInteger(currentTime) &&
    currentTime >= 0 &&
    Number.isSafeInteger(delivery?.lease_expires_at) &&
    delivery.lease_expires_at >= 0 &&
    delivery.lease_expires_at > currentTime
  );
}

export function identityDeliveryClockSkewMarginCoversBound(
  delivery,
  { minimumClockSkewMarginSeconds } = {},
) {
  return (
    Number.isSafeInteger(minimumClockSkewMarginSeconds) &&
    minimumClockSkewMarginSeconds >= 0 &&
    Number.isSafeInteger(delivery?.clock_skew_margin_seconds) &&
    delivery.clock_skew_margin_seconds >= 0 &&
    delivery.clock_skew_margin_seconds >= minimumClockSkewMarginSeconds
  );
}

export async function startIdentityDeliveryProviderFixture({
  host = "127.0.0.1",
  authToken,
  providerGeneration,
  retryAfterSeconds,
  minimumClockSkewMarginSeconds,
  nowSeconds = currentUnixTimeSeconds,
} = {}) {
  assertNonEmptyString(host, "host");
  assertNonEmptyString(authToken, "authToken");
  assertNonEmptyString(providerGeneration, "providerGeneration");
  if (
    !Number.isSafeInteger(minimumClockSkewMarginSeconds) ||
    minimumClockSkewMarginSeconds < 0
  ) {
    throw new TypeError(
      "identity delivery provider minimumClockSkewMarginSeconds must be a non-negative safe integer",
    );
  }
  if (typeof nowSeconds !== "function") {
    throw new TypeError("identity delivery provider nowSeconds must be a function");
  }

  const model = createIdentityDeliveryProviderModel({ retryAfterSeconds });
  const diagnostics = [];
  const postCommitDisconnectAttempts = new Set();

  function diagnosticsSnapshot() {
    return Object.freeze([...diagnostics]);
  }

  function recordDiagnostic(reason, status, delivery = undefined) {
    try {
      diagnostics.push(
        Object.freeze({
          reason,
          status,
          deliveryId:
            typeof delivery?.delivery_id === "string" &&
            canonicalDeliveryIdPattern.test(delivery.delivery_id)
              ? delivery.delivery_id
              : null,
          attemptNumber:
            Number.isInteger(delivery?.attempt_number)
              ? delivery.attempt_number
              : null,
        }),
      );
      if (diagnostics.length > maximumDiagnostics) diagnostics.shift();
    } catch {
      // Diagnostics are bounded, best-effort observations. They must never
      // alter a provider outcome or turn a committed effect into a failure.
    }
  }

  function closeProviderResponse(response) {
    try {
      response.destroy();
    } catch {
      // The connection is already unusable; there is no response left to send.
    }
  }

  function rejectProvider(response, reason, status, delivery = undefined) {
    recordDiagnostic(reason, status, delivery);
    try {
      if (!response.headersSent && !response.writableEnded) {
        response.writeHead(status).end();
      } else {
        closeProviderResponse(response);
      }
    } catch {
      closeProviderResponse(response);
    }
  }

  function armPostCommitDisconnect({ deliveryId, attemptToken } = {}) {
    if (
      typeof deliveryId !== "string" ||
      !canonicalDeliveryIdPattern.test(deliveryId) ||
      typeof attemptToken !== "string" ||
      !canonicalDeliveryIdPattern.test(attemptToken)
    ) {
      throw new Error(
        "post-commit disconnect requires canonical deliveryId and attemptToken values",
      );
    }
    const attemptKey = postCommitDisconnectAttemptKey({
      deliveryId,
      attemptToken,
    });
    if (postCommitDisconnectAttempts.has(attemptKey)) {
      throw new Error("post-commit disconnect target is already armed");
    }
    postCommitDisconnectAttempts.add(attemptKey);
  }

  function consumePostCommitDisconnect(delivery) {
    return postCommitDisconnectAttempts.delete(
      postCommitDisconnectAttemptKey({
        deliveryId: delivery.delivery_id,
        attemptToken: delivery.attempt_token,
      }),
    );
  }

  const provider = createServer(async (request, response) => {
    let delivery;
    let handlerStage = "request_authentication";
    let outcomeCommitted = false;
    try {
      if (
        request.method !== "POST" ||
        request.headers.authorization !== `Bearer ${authToken}`
      ) {
        rejectProvider(response, "request_authentication_rejected", 401);
        return;
      }

      handlerStage = "request_body";
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > maximumRequestBodyBytes) {
          rejectProvider(response, "request_body_too_large", 413);
          return;
        }
        chunks.push(chunk);
      }
      try {
        delivery = JSON.parse(fatalUtf8Decoder.decode(Buffer.concat(chunks)));
      } catch {
        rejectProvider(response, "request_json_rejected", 400);
        return;
      }

      handlerStage = "request_dispatch";
      if (
        delivery === null ||
        typeof delivery !== "object" ||
        Array.isArray(delivery)
      ) {
        rejectProvider(response, "delivery_shape_rejected", 409);
        return;
      }
      if (delivery.schema === "fmarch.identity-delivery-provider-probe.v1") {
        if (
          delivery.provider_generation !== providerGeneration ||
          typeof delivery.probe_token !== "string" ||
          !canonicalDeliveryIdPattern.test(delivery.probe_token)
        ) {
          rejectProvider(response, "probe_contract_rejected", 409);
          return;
        }
        handlerStage = "probe_response";
        const probeBody = JSON.stringify({
          schema: delivery.schema,
          provider_generation: delivery.provider_generation,
          probe_token: delivery.probe_token,
          status: "available",
        });
        recordDiagnostic("probe_available", 200);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(probeBody);
        return;
      }

      handlerStage = "delivery_validation";
      const rejectedContract = [
        [
          delivery.schema !== "fmarch.identity-delivery.v2",
          "delivery_schema_rejected",
        ],
        [
          delivery.provider_generation !== providerGeneration,
          "provider_generation_rejected",
        ],
        [typeof delivery.attempt_token !== "string", "attempt_token_rejected"],
        [
          typeof delivery.delivery_id !== "string" ||
            typeof delivery.attempt_token !== "string" ||
            !canonicalDeliveryIdPattern.test(delivery.delivery_id) ||
            !canonicalDeliveryIdPattern.test(delivery.attempt_token) ||
            !identityDeliveryProviderSupportsKind(delivery.delivery_kind) ||
            typeof delivery.account_id !== "string" ||
            delivery.account_id.length === 0 ||
            typeof delivery.principal_id !== "string" ||
            !canonicalDeliveryIdPattern.test(delivery.principal_id) ||
            typeof delivery.credential !== "string" ||
            delivery.credential.length === 0 ||
            !Number.isSafeInteger(delivery.attempt_number) ||
            delivery.attempt_number < 1 ||
            delivery.attempt_number > maximumPositiveI32 ||
            !Number.isSafeInteger(delivery.lease_expires_at) ||
            delivery.lease_expires_at < 0 ||
            !Number.isSafeInteger(delivery.clock_skew_margin_seconds) ||
            delivery.clock_skew_margin_seconds < 0,
          "delivery_shape_rejected",
        ],
        [
          !identityDeliveryLeaseIsLive(delivery, { nowSeconds }),
          "effect_deadline_rejected",
        ],
        [
          !identityDeliveryClockSkewMarginCoversBound(delivery, {
            minimumClockSkewMarginSeconds,
          }),
          "clock_skew_margin_rejected",
        ],
        [
          delivery.idempotency_key !== delivery.delivery_id,
          "idempotency_key_rejected",
        ],
      ].find(([rejected]) => rejected);
      if (rejectedContract !== undefined) {
        rejectProvider(response, rejectedContract[1], 409, delivery);
        return;
      }

      handlerStage = "transition_lookup";
      const prepared = model.prepare(delivery);
      if (prepared.kind === "rejected") {
        rejectProvider(response, prepared.reason, 409, delivery);
        return;
      }

      let outcome;
      let responseBody;
      if (prepared.kind === "prepared") {
        handlerStage = "response_serialization";
        responseBody = JSON.stringify(prepared.outcome);

        // Delivery-v2 defines the lease as the effect's execution/commit
        // deadline, not only an admission condition. Nothing asynchronous may
        // occur between this final clock read and the synchronous publication.
        handlerStage = "delivery_validation";
        if (!identityDeliveryLeaseIsLive(delivery, { nowSeconds })) {
          rejectProvider(
            response,
            "effect_deadline_elapsed_before_commit",
            409,
            delivery,
          );
          return;
        }

        handlerStage = "transition_commit";
        // From this point a collection write could have partially published
        // provider state. Every subsequent failure closes the connection and
        // leaves the caller to reconcile; it must never synthesize a 4xx ack.
        outcomeCommitted = true;
        outcome = model.commit(prepared);

        if (
          prepared.outcome.status === "delivered" &&
          (prepared.transitionKind === "start" ||
            prepared.transitionKind === "retry") &&
          consumePostCommitDisconnect(delivery)
        ) {
          recordDiagnostic("fault_injected_post_commit_disconnect", 0, delivery);
          closeProviderResponse(response);
          return;
        }
      } else {
        // A cached outcome crossed its commit boundary in an earlier request.
        // Serialization or transport failure must therefore reconcile too.
        outcome = prepared.outcome;
        outcomeCommitted = true;
        handlerStage = "response_serialization";
        responseBody = JSON.stringify(outcome);
      }

      handlerStage = "outcome_diagnostic";
      recordDiagnostic(
        outcome.status === "delivered"
          ? "delivered"
          : "fault_injected_provider_unavailable",
        200,
        delivery,
      );
      handlerStage = "response_write";
      response.writeHead(200, { "content-type": "application/json" });
      response.end(responseBody);
    } catch {
      const reason =
        handlerFailureReasonByStage[handlerStage] ??
        "provider_handler_unclassified_stage_failed";
      if (outcomeCommitted) {
        recordDiagnostic(reason, 0, delivery);
        closeProviderResponse(response);
      } else {
        rejectProvider(response, reason, 400, delivery);
      }
    }
  });

  await new Promise((resolve, reject) => {
    provider.once("error", reject);
    provider.listen(0, host, () => {
      provider.off("error", reject);
      resolve();
    });
  });

  let closePromise;
  function close() {
    if (closePromise !== undefined) return closePromise;
    closePromise = new Promise((resolve, reject) => {
      provider.close((error) => {
        if (error === undefined || error.code === "ERR_SERVER_NOT_RUNNING") {
          resolve();
        } else {
          reject(error);
        }
      });
      provider.closeIdleConnections?.();
      provider.closeAllConnections?.();
    });
    return closePromise;
  }

  const address = provider.address();
  if (address === null || typeof address === "string") {
    await close();
    throw new Error("local identity delivery provider did not bind a TCP port");
  }

  return Object.freeze({
    endpoint: `http://${host}:${address.port}/deliver`,
    authToken,
    providerGeneration,
    armRetryableFailure: model.armRetryableFailure,
    armPostCommitDisconnect,
    captureFor: model.captureFor,
    acknowledgeCapture: model.acknowledgeCapture,
    captureCount: model.captureCount,
    diagnosticsSnapshot,
    close,
  });
}

function currentUnixTimeSeconds() {
  return Math.floor(Date.now() / 1_000);
}

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`identity delivery provider ${name} must be non-empty`);
  }
}

function postCommitDisconnectAttemptKey({ deliveryId, attemptToken }) {
  return JSON.stringify([deliveryId, attemptToken]);
}
