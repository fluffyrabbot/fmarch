import assert from "node:assert/strict";
import test from "node:test";

import {
  assertNoSensitiveEvidence,
  redactSecurityEvidence,
  validateTelemetrySource,
} from "./security_release_baseline.mjs";

test("security evidence recursively redacts credentials, identities, personal data, and signatures", () => {
  const raw = {
    authorization: "Bearer secret-token-value",
    nested: {
      principal_user_id: "principal-private",
      contact: "person@private.invalid",
      signed: "https://objects.example.test/a?X-Amz-Signature=private-signature",
      session: "fmss_private-session-token",
    },
  };
  const redacted = redactSecurityEvidence(raw);
  assert.deepEqual(redacted.authorization, "[redacted]");
  assert.deepEqual(redacted.nested.principal_user_id, "[redacted]");
  assert.deepEqual(redacted.nested.session, "[redacted]");
  assert.match(redacted.nested.contact, /\[redacted-email\]/);
  assert.match(redacted.nested.signed, /X-Amz-Signature=\[redacted\]/);
  assert.doesNotThrow(() => assertNoSensitiveEvidence(redacted));
  assert.throws(() => assertNoSensitiveEvidence(raw), /security evidence contains|must be redacted/);
});

test("telemetry source rejects concrete identities and unbounded error or path fields", () => {
  assert.doesNotThrow(() =>
    validateTelemetrySource(
      'tracing::warn!(event = "dependency_unavailable", "request failed");',
      "safe.rs",
    ),
  );
  assert.throws(
    () =>
      validateTelemetrySource(
        'tracing::warn!(principal_user_id = %principal, "capacity");',
        "identity.rs",
      ),
    /concrete identity/,
  );
  assert.throws(
    () => validateTelemetrySource('tracing::error!(error = %error, "failed");', "error.rs"),
    /unbounded error/,
  );
});
