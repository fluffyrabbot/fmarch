import { buildRoleCardViewModel, roleAlignment, roleWindows } from "../../lib/components/role-card/role-card-model.mjs";
import { DEFAULT_ROLE_PACK } from "./roles-reference-loader.mjs";

export const ROLES_ROUTE_CONTRACT = Object.freeze({
  path: "/roles",
  surfaceTestId: "roles-surface",
  searchTestId: "roles-search",
  packsTestId: "roles-packs",
  tableTestId: "roles-table",
  gridTestId: "roles-grid",
  detailTestId: "roles-detail",
  emptyTestId: "roles-empty",
  unavailableTestId: "roles-unavailable",
  modalTestId: "roles-modal",
  rowTestIdPrefix: "roles-row",
});

const UNALIGNED_FILTER = "none";
const ACTS_FILTERS = Object.freeze([
  Object.freeze({ id: "any", label: "Any time" }),
  Object.freeze({ id: "night", label: "Night" }),
  Object.freeze({ id: "day", label: "Day" }),
  Object.freeze({ id: "passive", label: "Passive" }),
]);
const VIEWS = Object.freeze([
  Object.freeze({ id: "table", label: "Table" }),
  Object.freeze({ id: "cards", label: "Cards" }),
]);
const DEFAULTS = Object.freeze({
  pack: DEFAULT_ROLE_PACK,
  q: "",
  alignment: "all",
  acts: "any",
  view: "table",
  role: null,
});
const QUERY_ORDER = Object.freeze(["pack", "q", "alignment", "acts", "view", "role"]);
const TOKEN = /^[a-z0-9_]{1,64}$/u;

// Syntax only: which packs, alignments and roles exist is a fact of the
// loaded reference, checked in buildRolesRouteData.
export function parseRolesQuery(searchParams) {
  const read = (name) => String(searchParams?.get?.(name) ?? "").trim();
  const token = (name, fallback) => (TOKEN.test(read(name)) ? read(name) : fallback);
  return Object.freeze({
    pack: token("pack", DEFAULTS.pack),
    q: read("q").slice(0, 80),
    alignment: token("alignment", DEFAULTS.alignment),
    acts: ACTS_FILTERS.some((option) => option.id === read("acts")) ? read("acts") : DEFAULTS.acts,
    view: VIEWS.some((option) => option.id === read("view")) ? read("view") : DEFAULTS.view,
    role: token("role", DEFAULTS.role),
  });
}

export function rolesHref(query, overrides = {}) {
  const next = { ...DEFAULTS, ...query, ...overrides };
  const params = new URLSearchParams();
  for (const name of QUERY_ORDER) {
    if (next[name] !== null && next[name] !== DEFAULTS[name]) params.set(name, next[name]);
  }
  const search = params.toString();
  return search === "" ? ROLES_ROUTE_CONTRACT.path : `${ROLES_ROUTE_CONTRACT.path}?${search}`;
}

function alignmentFilterId(entry) {
  return entry.alignment.unaligned ? UNALIGNED_FILTER : entry.alignment.key;
}

function matches(entry, query) {
  if (query.alignment !== "all" && alignmentFilterId(entry) !== query.alignment) return false;
  const windows = roleWindows(entry).map((window) => window.id);
  if (query.acts !== "any" && !windows.includes(query.acts)) return false;
  if (query.q === "") return true;
  const haystack = [
    entry.name,
    entry.key,
    entry.summary,
    entry.alignment.label,
    ...entry.actions.map((action) => action.label),
    ...entry.traits.map((trait) => trait.text),
  ].join(" ").toLowerCase();
  return haystack.includes(query.q.toLowerCase());
}

/**
 * `reference` is a normalized PackRoleReference (null when the upstream read
 * failed); `catalog` lists the product packs. The query is re-validated
 * against the reference so a stale link degrades to the defaults.
 */
export function buildRolesRouteData({ query: rawQuery = DEFAULTS, catalog = [], reference = null } = {}) {
  if (reference === null) {
    return Object.freeze({
      contract: ROLES_ROUTE_CONTRACT,
      status: "unavailable",
      pack: Object.freeze({ key: rawQuery.pack, name: "Role reference" }),
      query: rawQuery,
      packOptions: Object.freeze([]),
    });
  }
  const roles = reference.roles;
  const alignmentIds = new Set(roles.map(alignmentFilterId));
  const query = Object.freeze({
    ...rawQuery,
    pack: reference.pack.key,
    alignment: rawQuery.alignment === "all" || alignmentIds.has(rawQuery.alignment) ? rawQuery.alignment : "all",
    role: roles.some((entry) => entry.key === rawQuery.role) ? rawQuery.role : null,
  });
  const visible = roles.filter((entry) => matches(entry, query));
  const selectedKey = query.role ?? visible[0]?.key ?? null;

  const rows = visible.map((entry) => Object.freeze({
    key: entry.key,
    name: entry.name,
    alignment: roleAlignment(entry.alignment),
    windows: roleWindows(entry),
    abilitiesText: entry.actions.length > 0 ? entry.actions.map((action) => action.label).join(", ") : "None",
    traitsText: entry.traits.length > 0 ? entry.traits.map((trait) => trait.short).join(", ") : null,
    href: rolesHref(query, { role: entry.key }),
    selected: entry.key === selectedKey,
    testId: `${ROLES_ROUTE_CONTRACT.rowTestIdPrefix}-${entry.key}`,
    compactCard: buildRoleCardViewModel({ role: entry, variant: "compact" }),
  }));

  const option = (current, id, label, overrides, extra = {}) => Object.freeze({
    id,
    label,
    current: current === id,
    href: rolesHref(query, overrides),
    ...extra,
  });

  const alignments = [
    ...reference.alignments
      .filter((alignment) => alignmentIds.has(alignment.key))
      .map((alignment) => Object.freeze({ id: alignment.key, label: alignment.label, family: alignment.id })),
    ...(alignmentIds.has(UNALIGNED_FILTER)
      ? [Object.freeze({ id: UNALIGNED_FILTER, label: "Unaligned", family: "independent" })]
      : []),
  ];
  const selected = roles.find((entry) => entry.key === selectedKey) ?? null;

  return Object.freeze({
    contract: ROLES_ROUTE_CONTRACT,
    status: "ready",
    pack: Object.freeze({ key: reference.pack.key, name: reference.pack.name }),
    query,
    packOptions: Object.freeze(catalog.map((pack) => option(query.pack, pack.key, pack.name, {
      pack: pack.key,
      q: "",
      alignment: "all",
      acts: "any",
      role: null,
    }, { roleCount: pack.roleCount }))),
    counts: Object.freeze(alignments.map((alignment) => Object.freeze({
      ...alignment,
      count: roles.filter((entry) => alignmentFilterId(entry) === alignment.id).length,
    }))),
    alignmentOptions: Object.freeze([
      option(query.alignment, "all", "All", { alignment: "all", role: null }),
      ...alignments.map((alignment) => option(query.alignment, alignment.id, alignment.label, { alignment: alignment.id, role: null })),
    ]),
    actsOptions: Object.freeze(ACTS_FILTERS.map((acts) => option(query.acts, acts.id, acts.label, { acts: acts.id, role: null }))),
    viewOptions: Object.freeze(VIEWS.map((view) => option(query.view, view.id, view.label, { view: view.id }))),
    rows: Object.freeze(rows),
    resultLine: rows.length === roles.length
      ? `Showing all ${roles.length} roles`
      : `Showing ${rows.length} of ${roles.length} roles`,
    clearHref: rolesHref({ pack: query.pack, view: query.view }),
    selected: selected === null ? null : Object.freeze({
      key: selected.key,
      card: buildRoleCardViewModel({ role: selected, variant: "full" }),
    }),
  });
}
