import { createHash } from "node:crypto";

// Must remain byte-for-byte aligned with `principal::PrincipalId::fixture`.
// Fixture aliases are readable proof inputs; this UUID is the only authority
// value that may cross a canonical API, session, SQL, or command boundary.
export const PRINCIPAL_FIXTURE_NAMESPACE =
  "3f1076f9-0813-5eae-8105-dcd8739f5f2d";

const namespaceBytes = Buffer.from(
  PRINCIPAL_FIXTURE_NAMESPACE.replaceAll("-", ""),
  "hex",
);
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidString(bytes) {
  const hex = Buffer.from(bytes).toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

/**
 * Deterministically derive the UUID-backed authority for a local fixture
 * alias. Production principals are always minted by the identity service.
 */
export function principalFixtureId(label) {
  const labelBytes = Buffer.from(String(label), "utf8");
  const digest = createHash("sha1")
    .update(namespaceBytes)
    .update(labelBytes)
    .digest();
  const uuid = Buffer.from(digest.subarray(0, 16));
  uuid[6] = (uuid[6] & 0x0f) | 0x50;
  uuid[8] = (uuid[8] & 0x3f) | 0x80;
  return uuidString(uuid);
}

/** True when a value is already a UUID principal authority value. */
export function isPrincipalId(value) {
  return uuidPattern.test(String(value));
}

/**
 * Turns a readable local fixture alias into its canonical UUID authority.
 * Real services mint production principals; this belongs only in proof setup.
 */
export function fixturePrincipalAuthorityId(aliasOrId) {
  if (typeof aliasOrId !== "string" || aliasOrId.trim() === "") {
    throw new Error("fixture principal authority requires a non-empty string");
  }
  return isPrincipalId(aliasOrId)
    ? aliasOrId
    : principalFixtureId(aliasOrId);
}

/**
 * Fails closed when a serialized authority field is not a UUID. It makes the
 * transport boundary explicit, so a new raw label cannot silently reach an
 * API, session, SQL, or command endpoint.
 */
export function requirePrincipalAuthorityId(value, boundary = "principal transport") {
  if (!isPrincipalId(value)) {
    throw new Error(
      `${boundary} requires a UUID principal authority, received ${JSON.stringify(value)}`,
    );
  }
  return String(value);
}

/**
 * Clones a JSON-shaped command/request and canonicalizes every snake-case
 * principal authority field. Call this exactly at the outgoing transport
 * boundary; aliases remain readable in the proof scenario itself.
 */
export function fixturePrincipalTransport(value, boundary = "principal transport") {
  const transport = structuredClone(value);
  canonicalizePrincipalFields(transport);
  assertPrincipalTransport(transport, boundary);
  return transport;
}

/**
 * Guards a payload that has already crossed an authority conversion boundary.
 * Use this for browser-originated commands: they must already carry UUIDs and
 * must never receive fixture-alias normalization on their way to the API.
 */
export function assertPrincipalTransport(value, boundary = "principal transport") {
  assertCanonicalPrincipalFields(value, boundary);
  return value;
}

function canonicalizePrincipalFields(value) {
  if (Array.isArray(value)) {
    value.forEach(canonicalizePrincipalFields);
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (isPrincipalAuthorityField(key)) {
      value[key] = fixturePrincipalAuthorityId(item);
    } else {
      canonicalizePrincipalFields(item);
    }
  }
}

function assertCanonicalPrincipalFields(value, boundary) {
  if (Array.isArray(value)) {
    value.forEach((item) => assertCanonicalPrincipalFields(item, boundary));
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (isPrincipalAuthorityField(key)) {
      requirePrincipalAuthorityId(item, `${boundary} field ${key}`);
    } else {
      assertCanonicalPrincipalFields(item, boundary);
    }
  }
}

function isPrincipalAuthorityField(key) {
  return key === "principal_id" || key.endsWith("_principal_id");
}
