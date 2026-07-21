import { buildAppShell } from "../../lib/app/app-shell-model.mjs";
import { buildAppSurfaceHeaderViewModel } from "../../lib/app/app-surface-header-model.mjs";

const FILTERS = new Set(["all", "discussions", "profiles", "games"]);

export async function load({ locals, fetch, url }) {
  const query = optionalText(url.searchParams.get("q"));
  const requestedFilter = optionalText(url.searchParams.get("filter")) ?? "all";
  const filter = FILTERS.has(requestedFilter) ? requestedFilter : "all";
  const cursor = optionalText(url.searchParams.get("cursor"));
  const page = query !== null && query.length >= 2
    ? await loadSearchPage({ fetch, query, filter, cursor })
    : null;
  const status = query === null
    ? "idle"
    : query.length < 2
      ? "invalid"
      : page === null
        ? "unavailable"
        : "ready";
  return {
    shellOwner: "layout",
    shell: buildAppShell({
      activeSurface: "search",
      principalUserId: locals.principalUserId,
      capabilities: locals.resolvedCapabilities,
    }),
    surfaceHeader: buildAppSurfaceHeaderViewModel({
      surface: "board",
      eyebrow: "Community",
      title: "Public search",
      summary: "Find public discussions, profiles, games, and main-thread posts.",
    }),
    search: {
      status,
      query: query ?? "",
      filter,
      results: Array.isArray(page?.results) ? page.results : [],
      nextHref: searchHref({ query, filter, cursor: page?.next_cursor }),
    },
  };
}

async function loadSearchPage({ fetch, query, filter, cursor }) {
  const apiBaseUrl = process.env.FMARCH_API_BASE_URL ?? "";
  const search = new URLSearchParams({ q: query, filter, limit: "20" });
  if (cursor !== null) search.set("cursor", cursor);
  const response = await fetch(`${apiBaseUrl}/search?${search.toString()}`);
  if (!response.ok) return null;
  const page = await response.json().catch(() => null);
  return page !== null && typeof page === "object" ? page : null;
}

function searchHref({ query, filter, cursor }) {
  if (query === null || typeof cursor !== "string" || cursor === "") return null;
  const search = new URLSearchParams({ q: query, filter, cursor });
  return `/search?${search.toString()}`;
}

function optionalText(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}
