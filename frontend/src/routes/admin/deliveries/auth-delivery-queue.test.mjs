import assert from "node:assert/strict";
import test from "node:test";
import { buildAuthDeliveryQueueView } from "./auth-delivery-queue.mjs";

test("delivery queue exposes only server-authorized retry actions", () => {
  const view = buildAuthDeliveryQueueView([
    {
      delivery_id: "11111111-1111-4111-8111-111111111111",
      delivery_kind: "recovery",
      account_id: "host",
      principal_user_id: "host_h",
      status: "retryable_failed",
      attempt_count: 1,
      provider_id: "http-json",
      outcome_code: "provider_unavailable",
      retry_eligible: true,
    },
    {
      delivery_id: "22222222-2222-4222-8222-222222222222",
      delivery_kind: "invite",
      account_id: "player",
      principal_user_id: "player_p",
      status: "cancelled",
      attempt_count: 0,
      provider_id: "http-json",
      outcome_code: "invite_revoked",
      retry_eligible: false,
    },
  ]);
  assert.equal(view.attentionCount, 1);
  assert.equal(view.retryCount, 1);
  assert.equal(view.items[0].retryEligible, true);
  assert.equal(view.items[1].retryEligible, false);
  assert.equal(view.items[1].statusLabel, "cancelled");
});

test("delivery queue rejects malformed rows instead of inventing actions", () => {
  const view = buildAuthDeliveryQueueView([{ status: "retryable_failed", retry_eligible: true }]);
  assert.equal(view.empty, true);
  assert.equal(view.retryCount, 0);
});
