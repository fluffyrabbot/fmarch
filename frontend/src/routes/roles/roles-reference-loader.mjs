import {
  normalizePackCatalog,
  normalizePackRoleReference,
} from "../../lib/components/role-card/role-reference-model.mjs";
import {
  fixturePackCatalog,
  fixturePackRoleReference,
} from "../../lib/dev/pack-role-reference-fixture.mjs";
import { fetchUpstreamJson } from "../../lib/server/upstream-client.mjs";

export const DEFAULT_ROLE_PACK = "mafia_universe";
const PACK_KEY = /^[a-z0-9_]{1,64}$/u;

/**
 * Load the public pack catalog and one pack's role reference (RFC 0009).
 * Both reads are game-free. An unknown or absent pack resolves to the default
 * pack (or the first listed); upstream failures surface as a degraded result,
 * never as an empty reference.
 */
export async function loadRoleReference({
  fetchImpl,
  apiBaseUrl,
  packKey,
  signal,
  fixture = false,
}) {
  if (fixture) {
    const catalog = normalizePackCatalog(fixturePackCatalog());
    const key = resolvePackKey(catalog, packKey);
    return ok(catalog, normalizePackRoleReference(fixturePackRoleReference(key)));
  }
  let catalog = null;
  const catalogResult = await fetchUpstreamJson({
    fetchImpl,
    url: `${apiBaseUrl}/packs`,
    signal,
    validate(value) {
      catalog = normalizePackCatalog(value);
      return catalog !== null && catalog.length > 0;
    },
  });
  if (catalogResult.kind !== "ok") return catalogResult;
  const key = resolvePackKey(catalog, packKey);
  let reference = null;
  const referenceResult = await fetchUpstreamJson({
    fetchImpl,
    url: `${apiBaseUrl}/packs/${encodeURIComponent(key)}/roles`,
    signal,
    validate(value) {
      reference = normalizePackRoleReference(value);
      return reference !== null && reference.pack.key === key;
    },
  });
  return referenceResult.kind === "ok" ? ok(catalog, reference) : referenceResult;
}

export function resolvePackKey(catalog, requested) {
  const keys = (catalog ?? []).map((pack) => pack.key);
  if (typeof requested === "string" && PACK_KEY.test(requested) && keys.includes(requested)) return requested;
  return keys.includes(DEFAULT_ROLE_PACK) ? DEFAULT_ROLE_PACK : keys[0] ?? DEFAULT_ROLE_PACK;
}

function ok(catalog, reference) {
  return Object.freeze({ kind: "ok", catalog, reference });
}
