import assert from "node:assert/strict";
import test from "node:test";
import { buildCommunityStewardshipView } from "./community-stewardship.mjs";

const ROOT = "11111111-1111-4111-8111-111111111111";
const CHILD = "22222222-2222-4222-8222-222222222222";
const INVITE = "33333333-3333-4333-8333-333333333333";

test("stewardship view preserves provenance and only accepts blind target fingerprints", () => {
  const view = buildCommunityStewardshipView({
    metrics: { active_memberships: 2, pending_invitations: 1 },
    invitation_quota: { max_open_per_sponsor: 10, max_issued_per_rolling_7_days: 20 },
    memberships: [
      { membership_id: ROOT, depth: 0, status: "active", open_invitation_count: 0 },
      { membership_id: CHILD, sponsoring_membership_id: ROOT, depth: 1, status: "suspended", quota_state: "near_limit" },
    ],
    pending_invitations: [
      { invitation_id: INVITE, sponsoring_membership_id: ROOT, target_fingerprint: "abcdef012345", delivery_status: "queued" },
      { invitation_id: INVITE, sponsoring_membership_id: ROOT, target_fingerprint: "person@example.test" },
    ],
  });
  assert.equal(view.memberships[1].sponsorId, ROOT);
  assert.equal(view.memberships[1].canRestore, true);
  assert.equal(view.pendingInvitations.length, 1);
  assert.equal(view.pendingInvitations[0].targetFingerprint, "abcdef012345");
  assert.equal(view.quotaLabel, "10 open · 20 / 7 days");
});
