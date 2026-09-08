const retryableFailureDeliveryKinds = new Set([
  "invite",
  "recovery",
  "community_invitation",
]);

export function identityDeliveryProviderSupportsKind(deliveryKind) {
  return retryableFailureDeliveryKinds.has(deliveryKind);
}

export function createIdentityDeliveryProviderModel({ retryAfterSeconds } = {}) {
  if (!Number.isSafeInteger(retryAfterSeconds) || retryAfterSeconds <= 0) {
    throw new TypeError(
      "identity delivery provider retryAfterSeconds must be a positive safe integer",
    );
  }

  const capturesByDeliveryId = new Map();
  const retryableFailureArms = [];
  const outcomesByAttempt = new Map();
  const latestOutcomeByDelivery = new Map();
  const preparedTransactions = new WeakMap();

  function armRetryableFailure({
    expectedKind,
    credential,
    expectedAccountId,
  } = {}) {
    if (!identityDeliveryProviderSupportsKind(expectedKind)) {
      throw new Error(`invalid delivery fault kind: ${expectedKind}`);
    }
    const hasCredential =
      typeof credential === "string" && credential.length > 0;
    const hasAccount =
      typeof expectedAccountId === "string" && expectedAccountId.length > 0;
    if (hasCredential === hasAccount) {
      throw new Error(
        "delivery fault injection requires exactly one credential or account target",
      );
    }
    if (
      retryableFailureArms.some(
        (arm) =>
          arm.expectedKind === expectedKind &&
          arm.credential === credential &&
          arm.expectedAccountId === expectedAccountId,
      )
    ) {
      throw new Error("delivery fault injection target is already armed");
    }
    retryableFailureArms.push(
      Object.freeze({
        expectedKind,
        credential: hasCredential ? credential : undefined,
        expectedAccountId: hasAccount ? expectedAccountId : undefined,
      }),
    );
  }

  function prepare(delivery) {
    if (delivery === null || typeof delivery !== "object" || Array.isArray(delivery)) {
      throw new TypeError("identity delivery provider model requires a delivery object");
    }

    const deliveryKey = identityDeliveryKey(delivery);
    const attemptKey = identityDeliveryAttemptKey(delivery);
    const cachedAttempt = resolveCachedAttempt({
      delivery,
      cachedAttempt: outcomesByAttempt.get(attemptKey),
    });
    if (cachedAttempt.kind !== "miss") {
      return cachedAttempt;
    }

    const previous = latestOutcomeByDelivery.get(deliveryKey);
    const transition = planTransition({
      delivery,
      previous,
      retryableFailureArm: retryableFailureArmFor(delivery),
      retryAfterSeconds,
    });
    if (transition.kind === "rejected") {
      return transition;
    }

    const prepared = Object.freeze({
      kind: "prepared",
      transitionKind: transition.transitionKind,
      outcome: transition.outcome,
    });
    preparedTransactions.set(
      prepared,
      Object.freeze({
        transition,
        deliveryKey,
        attemptKey,
        deliveryId: delivery.delivery_id,
        expectedPrevious: previous,
      }),
    );
    return prepared;
  }

  function commit(prepared) {
    if (prepared === null || typeof prepared !== "object") {
      throw new TypeError("identity delivery provider commit requires a prepared result");
    }
    const transaction = preparedTransactions.get(prepared);
    if (transaction === undefined) {
      throw new TypeError(
        "identity delivery provider result was not prepared by this model or was already committed",
      );
    }
    if (
      latestOutcomeByDelivery.get(transaction.deliveryKey) !==
      transaction.expectedPrevious
    ) {
      preparedTransactions.delete(prepared);
      throw new TypeError("identity delivery provider prepared result is stale");
    }

    const { transition } = transaction;
    const failureArmIndex =
      transition.failureArm === null
        ? -1
        : retryableFailureArms.indexOf(transition.failureArm);
    if (transition.failureArm !== null && failureArmIndex === -1) {
      throw new TypeError("planned delivery failure arm is no longer available");
    }

    // Retire the prepared capability before beginning publication. If a
    // built-in collection operation were ever to fail partway through this
    // synchronous section, the caller must reconcile rather than replay a
    // transaction whose publication boundary is uncertain.
    preparedTransactions.delete(prepared);
    outcomesByAttempt.set(transaction.attemptKey, transition.next);
    latestOutcomeByDelivery.set(transaction.deliveryKey, transition.next);
    if (transition.capture !== null) {
      capturesByDeliveryId.set(transaction.deliveryId, transition.capture);
    }
    if (failureArmIndex !== -1) {
      retryableFailureArms.splice(failureArmIndex, 1);
    }
    return transition.outcome;
  }

  function captureFor(deliveryId) {
    return capturesByDeliveryId.get(deliveryId);
  }

  function acknowledgeCapture(deliveryId, expectedAttemptToken) {
    if (typeof deliveryId !== "string" || deliveryId.length === 0) {
      throw new TypeError(
        "identity delivery provider capture acknowledgement requires a delivery id",
      );
    }
    if (
      typeof expectedAttemptToken !== "string" ||
      expectedAttemptToken.length === 0
    ) {
      throw new TypeError(
        "identity delivery provider capture acknowledgement requires an attempt token",
      );
    }
    const capture = capturesByDeliveryId.get(deliveryId);
    if (capture === undefined) return false;
    if (capture.attempt_token !== expectedAttemptToken) {
      throw new Error(
        "identity delivery provider capture acknowledgement token did not match",
      );
    }
    capturesByDeliveryId.delete(deliveryId);
    return true;
  }

  function captureCount() {
    return capturesByDeliveryId.size;
  }

  function retryableFailureArmFor(delivery) {
    if (delivery.attempt_number !== 1) return null;
    return (
      retryableFailureArms.find(
        (arm) =>
          arm.expectedKind === delivery.delivery_kind &&
          (arm.credential !== undefined
            ? arm.credential === delivery.credential
            : arm.expectedAccountId === delivery.account_id),
      ) ?? null
    );
  }

  return Object.freeze({
    prepare,
    commit,
    armRetryableFailure,
    captureFor,
    acknowledgeCapture,
    captureCount,
  });
}

function identityDeliveryKey(delivery) {
  return JSON.stringify([
    delivery.provider_generation,
    delivery.delivery_id,
  ]);
}

function identityDeliveryAttemptKey(delivery) {
  return JSON.stringify([
    delivery.provider_generation,
    delivery.delivery_id,
    delivery.attempt_token,
  ]);
}

function identityDeliveryEffectIdentityFromRequest(delivery) {
  return Object.freeze({
    deliveryKind: delivery.delivery_kind,
    accountId: delivery.account_id,
    principalId: delivery.principal_id,
    credential: delivery.credential,
  });
}

function identityDeliveryEffectIdentityMatchesRequest(effectIdentity, delivery) {
  return (
    effectIdentity !== undefined &&
    effectIdentity.deliveryKind === delivery.delivery_kind &&
    effectIdentity.accountId === delivery.account_id &&
    effectIdentity.principalId === delivery.principal_id &&
    effectIdentity.credential === delivery.credential
  );
}

function resolveCachedAttempt({ delivery, cachedAttempt }) {
  if (cachedAttempt === undefined) {
    return Object.freeze({ kind: "miss" });
  }
  if (cachedAttempt.attemptNumber !== delivery.attempt_number) {
    return Object.freeze({
      kind: "rejected",
      reason: "attempt_generation_rejected",
    });
  }
  if (
    !identityDeliveryEffectIdentityMatchesRequest(
      cachedAttempt.effectIdentity,
      delivery,
    )
  ) {
    return Object.freeze({
      kind: "rejected",
      reason: "effect_identity_rejected",
    });
  }
  return Object.freeze({
    kind: "cached",
    outcome: cachedAttempt.outcome,
  });
}

function planTransition({
  delivery,
  previous,
  retryableFailureArm,
  retryAfterSeconds,
}) {
  const effectIdentity = identityDeliveryEffectIdentityFromRequest(delivery);
  if (
    previous !== undefined &&
    !identityDeliveryEffectIdentityMatchesRequest(
      previous.effectIdentity,
      delivery,
    )
  ) {
    return Object.freeze({
      kind: "rejected",
      reason: "effect_identity_rejected",
    });
  }

  let transitionKind;
  if (previous === undefined && delivery.attempt_number === 1) {
    transitionKind = "start";
  } else if (
    previous !== undefined &&
    delivery.attempt_number === previous.attemptNumber
  ) {
    transitionKind = "reclaim";
  } else if (
    previous !== undefined &&
    previous.status === "retryable_failure" &&
    delivery.attempt_number === previous.attemptNumber + 1
  ) {
    transitionKind = "retry";
  } else if (
    previous !== undefined &&
    previous.status === "delivered" &&
    delivery.attempt_number === previous.attemptNumber + 1
  ) {
    transitionKind = "reconcile";
  } else {
    return Object.freeze({
      kind: "rejected",
      reason: "attempt_generation_rejected",
    });
  }

  const failureArm =
    transitionKind === "start" && retryableFailureArm !== null
      ? retryableFailureArm
      : null;
  const outcome =
    transitionKind === "reclaim" || transitionKind === "reconcile"
      ? Object.freeze({
          ...previous.outcome,
          attempt_token: delivery.attempt_token,
        })
      : failureArm !== null
        ? Object.freeze({
            schema: "fmarch.identity-delivery-result.v2",
            provider_generation: delivery.provider_generation,
            delivery_id: delivery.delivery_id,
            attempt_token: delivery.attempt_token,
            status: "retryable_failure",
            code: "provider_unavailable",
            retry_after_seconds: retryAfterSeconds,
          })
        : Object.freeze({
            schema: "fmarch.identity-delivery-result.v2",
            provider_generation: delivery.provider_generation,
            delivery_id: delivery.delivery_id,
            attempt_token: delivery.attempt_token,
            status: "delivered",
            provider_receipt_id: `local-${delivery.delivery_id}`,
          });
  const next = Object.freeze({
    attemptNumber: delivery.attempt_number,
    status: outcome.status,
    outcome,
    effectIdentity,
  });
  const capture =
    outcome.status === "delivered" &&
    (transitionKind === "start" || transitionKind === "retry")
      ? identityDeliveryProviderCaptureFromRequest(delivery)
      : null;
  return Object.freeze({
    kind: "accepted",
    transitionKind,
    outcome,
    next,
    capture,
    failureArm,
  });
}

function identityDeliveryProviderCaptureFromRequest(delivery) {
  return Object.freeze({
    schema: delivery.schema,
    provider_generation: delivery.provider_generation,
    delivery_id: delivery.delivery_id,
    attempt_token: delivery.attempt_token,
    lease_expires_at: delivery.lease_expires_at,
    clock_skew_margin_seconds: delivery.clock_skew_margin_seconds,
    delivery_kind: delivery.delivery_kind,
    account_id: delivery.account_id,
    principal_id: delivery.principal_id,
    credential: delivery.credential,
    attempt_number: delivery.attempt_number,
    idempotency_key: delivery.idempotency_key,
  });
}
