import { APP_ROUTE_STATE_CONTRACT } from "../app/app-route-state-model.mjs";

export const UI_WORKBENCH_PATH = "/_dev/ui";
export const UI_WORKBENCH_SESSION_PATH = `${UI_WORKBENCH_PATH}/session`;

export const UI_WORKBENCH_VIEWPORTS = Object.freeze([
  Object.freeze({ id: "mobile", label: "Mobile", size: "390 × 844" }),
  Object.freeze({ id: "tablet", label: "Tablet", size: "1024 × 768" }),
  Object.freeze({ id: "desktop", label: "Desktop", size: "1440 × 920" }),
]);

export const UI_WORKBENCH_GROUPS = Object.freeze([
  Object.freeze({
    id: "core",
    label: "Core role surfaces",
    summary: "The real application routes, loaded from deterministic local projections.",
    scenarios: Object.freeze([
      scenario({
        id: "board",
        label: "Game board",
        description: "Public game discovery and capability-gated entry actions.",
        token: "fixture-player",
        path: "/",
        surface: "board",
      }),
      scenario({
        id: "player",
        label: "Player · main thread",
        description: "Day thread, live votecount, private queue, and player commands.",
        token: "fixture-player",
        path: "/g/midsummer",
        surface: "player",
      }),
      scenario({
        id: "player-private",
        label: "Player · private channel",
        description: "Capability-scoped role PM with the same player shell and command boundary.",
        token: "fixture-player",
        path: "/g/midsummer/c/private%3Arole_pm%3Aslot-7",
        surface: "player",
      }),
      scenario({
        id: "moderator",
        label: "Moderator console",
        description: "Phase, votecount, prompts, lifecycle controls, and command confirmations.",
        token: "fixture-host",
        path: "/g/midsummer/host",
        surface: "moderator",
      }),
      scenario({
        id: "host-setup",
        label: "Host setup",
        description: "Pre-game configuration, role slots, and setup readiness.",
        token: "fixture-host",
        path: "/g/midsummer/setup",
        surface: null,
      }),
      scenario({
        id: "admin",
        label: "Admin operations",
        description: "Setup, authority, proof artifacts, recovery, and escalation posture.",
        token: "fixture-admin",
        path: "/admin?game=midsummer",
        surface: "admin",
      }),
    ]),
  }),
  Object.freeze({
    id: "personas",
    label: "Player personas",
    summary: "The same game projection under distinct capability and survival postures.",
    scenarios: Object.freeze([
      scenario({
        id: "player-target",
        label: "Target player",
        description: "A second occupied slot for cross-player and targeting review.",
        token: "fixture-target",
        path: "/g/midsummer",
        surface: "player",
      }),
      scenario({
        id: "player-normal",
        label: "Vanilla player",
        description: "A standard living player without private-channel membership.",
        token: "fixture-normal",
        path: "/g/midsummer",
        surface: "player",
      }),
      scenario({
        id: "player-survivor",
        label: "Survivor posture",
        description: "A distinct occupied slot for endgame and status-copy review.",
        token: "fixture-survivor",
        path: "/g/midsummer",
        surface: "player",
      }),
    ]),
  }),
]);

const SCENARIOS_BY_ID = new Map(
  UI_WORKBENCH_GROUPS.flatMap((group) => group.scenarios).map((entry) => [entry.id, entry]),
);

export function uiWorkbenchEnabled(env = process.env) {
  return env?.FMARCH_FRONTEND_FIXTURE_SESSION === "1";
}

export function uiWorkbenchScenario(id) {
  return typeof id === "string" ? SCENARIOS_BY_ID.get(id) ?? null : null;
}

export function uiWorkbenchSessionHref({ scenarioId, state = null } = {}) {
  const search = new URLSearchParams({ scenario: String(scenarioId ?? "") });
  if (state !== null) {
    search.set("state", String(state));
  }
  return `${UI_WORKBENCH_SESSION_PATH}?${search.toString()}`;
}

export function uiWorkbenchDestination({ scenarioId, state = null } = {}) {
  const selected = uiWorkbenchScenario(scenarioId);
  if (selected === null) {
    return null;
  }
  if (state === null || state === "") {
    return selected.path;
  }
  if (
    selected.surface === null ||
    !APP_ROUTE_STATE_CONTRACT.states.includes(state)
  ) {
    return null;
  }

  const destination = new URL(selected.path, "http://fmarch.local");
  destination.searchParams.set(APP_ROUTE_STATE_CONTRACT.fixtureQueryParam, state);
  return `${destination.pathname}${destination.search}`;
}

function scenario({ id, label, description, token, path, surface }) {
  return Object.freeze({
    id,
    label,
    description,
    token,
    path,
    surface,
    href: uiWorkbenchSessionHref({ scenarioId: id }),
    states:
      surface === null
        ? Object.freeze([])
        : Object.freeze(
            APP_ROUTE_STATE_CONTRACT.states.map((state) =>
              Object.freeze({
                id: state,
                label: state[0].toUpperCase() + state.slice(1),
                href: uiWorkbenchSessionHref({ scenarioId: id, state }),
              }),
            ),
          ),
  });
}
