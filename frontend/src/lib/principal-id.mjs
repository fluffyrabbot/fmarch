// Principal IDs cross the browser boundary as canonical UUID strings. Keep
// this deliberately strict: accepting an alternate spelling here would make
// a display label or legacy provider identifier look like application
// authority.
const CANONICAL_PRINCIPAL_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Readable fixture aliases remain useful in copy and test descriptions, but
// their authority values must remain UUIDs. These match the Rust fixture
// namespace used by the local proof harness.
export const FIXTURE_PRINCIPAL_IDS = Object.freeze({
  hostH: "aef8cdd1-0914-5e70-97fa-fdf58ecf0f55",
  cohostC: "7a307e53-2831-59f8-bcec-95eb9af60565",
  playerMira: "906cbcd0-5c86-5c71-9ec5-314f8002390b",
  playerRowan: "ef2c585a-07a4-5436-aa1f-abe4c8c3170b",
  setupPlayerMira: "29afde20-3cb5-5071-8682-d4413efdcc3f",
  setupPlayerGoon: "934e70c3-f4e2-5d31-ba4c-7e41c9e61198",
});

// Fixture-session selectors remain readable (`fixture-admin`,
// `fixture-player`, and so on), but their principal identities follow the
// same UUID-v5 derivation as Rust's `PrincipalId::fixture`. These values are
// authority, never display aliases.
export const FIXTURE_SESSION_PRINCIPAL_IDS = Object.freeze({
  admin: "66efd889-2941-583a-abc3-d5b95cb5f173",
  player: FIXTURE_PRINCIPAL_IDS.setupPlayerMira,
  target: "6deb6b9b-f478-5622-b5e6-f3cdd40f0af4",
  nightTarget: "1c2cf715-fb8b-524f-9b51-98241c860005",
  normal: "534eb312-6583-5fc5-841a-388a87be7b48",
  survivor: "bc41ea34-0f53-5192-9c37-4f5501270802",
  host: FIXTURE_PRINCIPAL_IDS.hostH,
});

export function canonicalPrincipalId(value) {
  return typeof value === "string" && CANONICAL_PRINCIPAL_ID.test(value)
    ? value
    : null;
}

export function isCanonicalPrincipalId(value) {
  return canonicalPrincipalId(value) !== null;
}
