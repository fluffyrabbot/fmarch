import { fetchUpstreamJson } from "./upstream-client.mjs";
import { authenticatedApiFetch } from "./session-capabilities.mjs";
import { validPrivateAttention } from "../app/private-attention.mjs";

export async function loadPrivateAttention({ game, cookies, fetch, apiBaseUrl, fixtureMode, enabled }) {
  if (!enabled) return { state: "unavailable", reviewedIds: [] };
  if (fixtureMode) return { state: "ready", reviewedIds: [] };
  const result = await fetchUpstreamJson({
    fetchImpl: authenticatedApiFetch({ cookies, fetchImpl: fetch }),
    url: `${apiBaseUrl}/games/${encodeURIComponent(game)}/private-attention`,
    validate: validPrivateAttention,
  });
  return result.kind === "ok" ? { state: "ready", reviewedIds: result.value.reviewed_ids }
    : { state: "unavailable", reviewedIds: [] };
}
