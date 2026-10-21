// Fixture-mode role reference: a snapshot of the registry projection that the
// content_registry test `frontend_role_reference_fixture_matches_the_projection`
// holds byte-for-byte to the Rust output. Raw wire documents; callers
// normalize them exactly as they would an API response.
import fixture from "./pack-role-reference.fixture.json" with { type: "json" };

export function fixturePackCatalog() {
  return fixture.catalog;
}

export function fixturePackRoleReference(packKey) {
  return Object.hasOwn(fixture.references, packKey) ? fixture.references[packKey] : null;
}
