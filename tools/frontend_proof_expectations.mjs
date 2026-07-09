import { HOST_CONSOLE_CRITICAL_ACTIONS } from "../frontend/src/lib/components/host-action/host-console-critical-action.mjs";
import { COMMAND_SCENARIOS } from "./frontend_proof_scenarios.mjs";

// Single source for cross-lane proof expectations. The ordered moderator list
// below is the one tripwire: when the host console gains or loses a critical
// action, update it here and every proof lane's counts, id tables, and
// count-bearing boundary strings follow.
export const MODERATOR_CRITICAL_ACTION_IDS = Object.freeze([
  "extend_deadline",
  "extend_deadline_24h",
  "extend_deadline_48h",
  "process_replacement",
  "resolve_phase",
  "lock_thread",
  "publish_votecount",
  "mark_dead",
  "modkill_slot",
  "complete_game",
  "resolve_host_prompt-D01-skip_next_day-slot_1",
]);

const contractActionIds = new Set(
  HOST_CONSOLE_CRITICAL_ACTIONS.map((action) => action.id),
);
for (const id of MODERATOR_CRITICAL_ACTION_IDS) {
  if (id.startsWith("resolve_host_prompt-")) {
    continue;
  }
  if (!contractActionIds.has(id)) {
    throw new Error(
      `frontend_proof_expectations: ${id} is not a host console critical action`,
    );
  }
}

export const MODERATOR_CRITICAL_CONFIRMATION_SCENARIO_IDS = Object.freeze(
  MODERATOR_CRITICAL_ACTION_IDS.map((id) => `moderator-${id}-confirm-click`),
);

// The named command scenarios are single-sourced from the rich manifest in
// frontend_proof_scenarios.mjs (which also owns their per-lane membership); the
// moderator confirmations follow the ordered critical-action list above.
export const COMMAND_SCENARIO_IDS = Object.freeze([
  ...COMMAND_SCENARIOS.map((scenario) => scenario.id),
  ...MODERATOR_CRITICAL_CONFIRMATION_SCENARIO_IDS,
]);

export const HYDRATED_SURFACE_INTERACTION_IDS = Object.freeze([
  "admin-audit-native-flow",
  "admin-operational-forms",
  "player-private-disclosure-vote-and-post",
  "moderator-host-prompt-confirmation",
  "moderator-slot-lifecycle-confirmation",
]);

export const PLANNED_INTERACTION_IDS = Object.freeze([
  ...COMMAND_SCENARIO_IDS,
  ...HYDRATED_SURFACE_INTERACTION_IDS,
]);

export const EXPECTED_COUNTS = Object.freeze({
  moderatorCriticalActions: MODERATOR_CRITICAL_ACTION_IDS.length,
  commandScenarios: COMMAND_SCENARIO_IDS.length,
  plannedInteractions: PLANNED_INTERACTION_IDS.length,
  adminStabilityFloorTiles: 4,
  stabilityCheckTiles: 4 + MODERATOR_CRITICAL_ACTION_IDS.length,
  adminSetupZoneTargets: 3,
  adminRecoveryZoneTargets: 1,
  playerPrimaryZoneTargets: 3,
});

export function expectedThumbZoneCounts() {
  return [
    {
      role: "admin",
      zones: [
        ["admin-setup-action-zone", EXPECTED_COUNTS.adminSetupZoneTargets],
        ["admin-recovery-action-zone", EXPECTED_COUNTS.adminRecoveryZoneTargets],
      ],
    },
    {
      role: "player",
      zones: [
        [
          "player-primary-action-zone",
          EXPECTED_COUNTS.playerPrimaryZoneTargets,
        ],
      ],
    },
    {
      role: "moderator",
      zones: [
        ["moderator-primary-action-zone", EXPECTED_COUNTS.moderatorCriticalActions],
      ],
    },
  ];
}

export function expectedStabilityCheckShape() {
  return [
    [
      "admin-operator-action-status-floors",
      "reserved-status-floor",
      EXPECTED_COUNTS.adminStabilityFloorTiles,
    ],
    [
      "moderator-primary-action-status-floors",
      "reserved-status-floor",
      EXPECTED_COUNTS.moderatorCriticalActions,
    ],
  ];
}
