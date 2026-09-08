export function buildAuthDeliveryQueueView(deliveries = []) {
  const items = Array.isArray(deliveries)
    ? deliveries.map(normalizeDelivery).filter(Boolean)
    : [];
  return Object.freeze({
    items: Object.freeze(items),
    attentionCount: items.filter((item) => item.attention).length,
    retryCount: items.filter((item) => item.retryEligible).length,
    empty: items.length === 0,
  });
}

function normalizeDelivery(delivery) {
  const id = nonemptyString(delivery?.delivery_id);
  const kind = nonemptyString(delivery?.delivery_kind);
  const status = nonemptyString(delivery?.status);
  const attemptCount = nonnegativeInt32(delivery?.attempt_count);
  if (id === null || kind === null || status === null || attemptCount === null) return null;
  const retryEligible = status === "retryable_failed" && delivery.retry_eligible === true;
  return Object.freeze({
    id,
    kind,
    accountId: nonemptyString(delivery.account_id) ?? "unknown account",
    principalId: nonemptyString(delivery.principal_id) ?? "unknown principal",
    status,
    statusLabel: status.replaceAll("_", " "),
    attemptCount,
    providerId: nonemptyString(delivery.provider_id) ?? "unknown provider",
    outcomeCode: nonemptyString(delivery.outcome_code),
    nextAttemptAt: safeInteger(delivery.next_attempt_at),
    expiresAt: safeInteger(delivery.credential_expires_at),
    updatedAt: safeInteger(delivery.updated_at),
    retryEligible,
    attention: ["retryable_failed", "permanent_failed"].includes(status),
  });
}

function nonemptyString(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function safeInteger(value) {
  return Number.isSafeInteger(value) ? value : null;
}

function nonnegativeInt32(value) {
  return Number.isInteger(value) && value >= 0 && value <= 2_147_483_647 ? value : null;
}
