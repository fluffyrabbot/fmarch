import { SESSION_COOKIE_NAME } from "./session-capabilities.mjs";
import { fetchUpstreamJson } from "./upstream-client.mjs";

const ACCOUNT_METHODS_TIMEOUT_MS = 2_000;
const ACCOUNT_METHOD_KINDS = new Set(["classic_password", "workos"]);
const ACCOUNT_METHOD_STATUSES = new Set(["active", "disabled"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function loadAccountMethods({
  cookies,
  fetchImpl,
  principalId,
  url,
  timeoutMs = ACCOUNT_METHODS_TIMEOUT_MS,
}) {
  const sessionToken = cookies?.get?.(SESSION_COOKIE_NAME);
  if (typeof sessionToken !== "string" || sessionToken.trim() === "") {
    return unavailableMethods("missing_session");
  }
  const result = await fetchUpstreamJson({
    fetchImpl,
    url,
    timeoutMs,
    init: {
      method: "GET",
      headers: {
        authorization: `Bearer ${sessionToken}`,
        accept: "application/json",
      },
    },
    validate: (value) => validateAccountMethodsResponse(value, principalId),
  });
  if (result.kind !== "ok") {
    return Object.freeze({
      kind: "unavailable",
      methods: Object.freeze([]),
      failure: Object.freeze({
        kind: result.kind,
        reason: result.reason,
        status: result.status,
        requestId: result.requestId,
        retryAfterSeconds: result.retryAfterSeconds,
      }),
    });
  }
  return Object.freeze({
    kind: "ready",
    methods: Object.freeze(
      result.value.methods.map((method) =>
        Object.freeze({
          methodId: method.method_id,
          kind: method.kind,
          status: method.status,
          createdAt: method.created_at,
          lastAuthenticatedAt: method.last_authenticated_at ?? null,
          loginName: method.login_name ?? null,
          displayLabel: method.display_label ?? null,
        }),
      ),
    ),
    failure: null,
  });
}

function validateAccountMethodsResponse(value, principalId) {
  return (
    isExactObject(value, ["principal_id", "methods"]) &&
    typeof principalId === "string" &&
    value.principal_id === principalId &&
    Array.isArray(value.methods) &&
    value.methods.every(validateAccountMethod)
  );
}

function validateAccountMethod(value) {
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, [
      "method_id",
      "kind",
      "status",
      "created_at",
      "last_authenticated_at",
      "login_name",
      "display_label",
    ]) ||
    !hasKeys(value, ["method_id", "kind", "status", "created_at"])
  ) {
    return false;
  }
  return (
    typeof value.method_id === "string" &&
    UUID.test(value.method_id) &&
    ACCOUNT_METHOD_KINDS.has(value.kind) &&
    ACCOUNT_METHOD_STATUSES.has(value.status) &&
    Number.isSafeInteger(value.created_at) &&
    optionalSafeInteger(value.last_authenticated_at) &&
    optionalNonEmptyString(value.login_name) &&
    optionalNonEmptyString(value.display_label)
  );
}

function unavailableMethods(reason) {
  return Object.freeze({
    kind: "unavailable",
    methods: Object.freeze([]),
    failure: Object.freeze({
      kind: "unavailable",
      reason,
      status: null,
      requestId: null,
      retryAfterSeconds: null,
    }),
  });
}

function isExactObject(value, keys) {
  return isObject(value) && hasKeys(value, keys) && hasOnlyKeys(value, keys);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasKeys(value, keys) {
  return keys.every((key) => Object.hasOwn(value, key));
}

function hasOnlyKeys(value, keys) {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function optionalSafeInteger(value) {
  return value === undefined || Number.isSafeInteger(value);
}

function optionalNonEmptyString(value) {
  return value === undefined || (typeof value === "string" && value.trim() !== "");
}
