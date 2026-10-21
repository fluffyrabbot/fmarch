import { ROLE_ALIGNMENTS, ROLE_CATALOG, ROLE_PACK, findRole } from "../../lib/components/role-card/role-catalog.mjs";
import { buildRoleCardViewModel, roleAlignment, roleWindows } from "../../lib/components/role-card/role-card-model.mjs";

export const ROLES_ROUTE_CONTRACT = Object.freeze({
  path: "/roles",
  surfaceTestId: "roles-surface",
  searchTestId: "roles-search",
  tableTestId: "roles-table",
  gridTestId: "roles-grid",
  detailTestId: "roles-detail",
  emptyTestId: "roles-empty",
  modalTestId: "roles-modal",
  rowTestIdPrefix: "roles-row",
});

const ALIGNMENT_FILTERS = Object.freeze(["all", ...ROLE_ALIGNMENTS.map((alignment) => alignment.id)]);
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
const DEFAULTS = Object.freeze({ q: "", alignment: "all", acts: "any", view: "table", role: null });

export function parseRolesQuery(searchParams) {
  const read = (name) => String(searchParams?.get?.(name) ?? "").trim();
  const q = read("q").slice(0, 80);
  const alignment = ALIGNMENT_FILTERS.includes(read("alignment")) ? read("alignment") : DEFAULTS.alignment;
  const acts = ACTS_FILTERS.some((option) => option.id === read("acts")) ? read("acts") : DEFAULTS.acts;
  const view = VIEWS.some((option) => option.id === read("view")) ? read("view") : DEFAULTS.view;
  const role = findRole(read("role")) ? read("role") : null;
  return Object.freeze({ q, alignment, acts, view, role });
}

export function rolesHref(query, overrides = {}) {
  const next = { ...DEFAULTS, ...query, ...overrides };
  const params = new URLSearchParams();
  for (const name of ["q", "alignment", "acts", "view", "role"]) {
    if (next[name] !== null && next[name] !== DEFAULTS[name]) params.set(name, next[name]);
  }
  const search = params.toString();
  return search === "" ? ROLES_ROUTE_CONTRACT.path : `${ROLES_ROUTE_CONTRACT.path}?${search}`;
}

function matches(entry, query) {
  if (query.alignment !== "all" && entry.alignment !== query.alignment) return false;
  const windows = roleWindows(entry).map((window) => window.id);
  if (query.acts !== "any" && !windows.includes(query.acts)) return false;
  if (query.q === "") return true;
  const haystack = [
    entry.name,
    entry.key,
    entry.summary,
    ...entry.actions.map((action) => action.label),
    ...entry.traits.map((trait) => trait.text),
  ].join(" ").toLowerCase();
  return haystack.includes(query.q.toLowerCase());
}

export function buildRolesRouteData({ query = DEFAULTS } = {}) {
  const visible = ROLE_CATALOG.filter((entry) => matches(entry, query));
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

  const option = (current, id, label, overrides) => Object.freeze({
    id,
    label,
    current: current === id,
    href: rolesHref(query, overrides),
  });

  return Object.freeze({
    contract: ROLES_ROUTE_CONTRACT,
    pack: ROLE_PACK,
    query,
    counts: Object.freeze(ROLE_ALIGNMENTS.map((alignment) => Object.freeze({
      id: alignment.id,
      label: alignment.label,
      count: ROLE_CATALOG.filter((entry) => entry.alignment === alignment.id).length,
    }))),
    alignmentOptions: Object.freeze([
      option(query.alignment, "all", "All", { alignment: "all", role: null }),
      ...ROLE_ALIGNMENTS.map((alignment) => option(query.alignment, alignment.id, alignment.label, { alignment: alignment.id, role: null })),
    ]),
    actsOptions: Object.freeze(ACTS_FILTERS.map((acts) => option(query.acts, acts.id, acts.label, { acts: acts.id, role: null }))),
    viewOptions: Object.freeze(VIEWS.map((view) => option(query.view, view.id, view.label, { view: view.id }))),
    rows: Object.freeze(rows),
    resultLine: rows.length === ROLE_CATALOG.length
      ? `Showing all ${ROLE_CATALOG.length} roles`
      : `Showing ${rows.length} of ${ROLE_CATALOG.length} roles`,
    clearHref: rolesHref({ view: query.view }),
    selected: selectedKey === null ? null : Object.freeze({
      key: selectedKey,
      card: buildRoleCardViewModel({ roleKey: selectedKey, variant: "full" }),
    }),
  });
}
