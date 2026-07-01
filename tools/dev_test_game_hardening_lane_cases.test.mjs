import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  cohostDeadlineRecoveryLaneIds,
  cohostDeadlineStaleControlCases,
  cohostDeadlineStaleControlCaseDefinitions,
  hostCohostRaceRecoveryLaneIds,
  hostGenericStaleControlLaneIds,
  hostStaleControlLaneIds,
  hostPhaseStaleControlCases,
  hostPhaseStaleControlCaseDefinitions,
  hostPhaseStaleRecoveryLaneIds,
  hostPhaseStaleControlLaneIds,
  hostPromptStaleControlLaneIds,
  hostRaceReloadLaneIds,
  hostStandaloneStaleControlLaneIds,
  hostedMatrixReconnectLaneIds,
} from "./dev_test_game_host_stale_control_scenarios.mjs";
import {
  hostedMatrixStaleConflictLaneIds,
  staleConflictMessageLaneIds,
} from "./dev_test_game_hardening_lane_cases.mjs";
import {
  playerActionConflictRecoveryLaneIds,
  playerActionFoundationLaneIds,
  promotedStalePlayerCommandLaneIds,
  stalePlayerCommandLaneIds,
} from "./dev_test_game_player_recovery_scenarios.mjs";

test("hardening lane cases share stale conflict-message IDs", () => {
  assert.deepEqual(staleConflictMessageLaneIds, [
    "replacement-stale-conflict-message",
    "stale-action-conflict-message",
    "stale-dead-action-conflict",
  ]);
});

test("hardening lane cases share host stale-control IDs", () => {
  assert.deepEqual(hostStandaloneStaleControlLaneIds, [
    "stale-host-publish",
    "stale-host-lifecycle",
    "stale-host-lifecycle-reload",
    "stale-host-modkill",
    "stale-host-modkill-reload",
  ]);
  assert.deepEqual(hostPromptStaleControlLaneIds, [
    "stale-host-prompt",
    "stale-host-prompt-reload",
  ]);
  assert.deepEqual(hostGenericStaleControlLaneIds, ["stale-host-control"]);
  assert.deepEqual(hostPhaseStaleControlLaneIds, [
    "stale-host-resolve",
    "stale-host-resolve-reload",
    "stale-host-resolve-reconnect-recovery",
    "stale-host-advance",
    "stale-host-advance-reload",
    "stale-host-advance-reconnect-recovery",
    "stale-host-deadline",
    "stale-host-deadline-reload",
    "stale-host-deadline-reconnect-recovery",
  ]);
  assert.deepEqual(hostStaleControlLaneIds, [
    ...hostStandaloneStaleControlLaneIds,
    ...hostPromptStaleControlLaneIds,
    "stale-host-complete",
    "stale-host-complete-reload",
    "stale-host-complete-reconnect-recovery",
    ...hostGenericStaleControlLaneIds,
    ...hostPhaseStaleControlLaneIds,
  ]);
});

test("host stale-control production callers use the shared scenario module", async () => {
  const callerPaths = [
    "tools/dev_test_game_next_action.mjs",
    "tools/dev_test_game_release_readiness.mjs",
    "tools/dev_test_game_proof_contract.mjs",
    "tools/dev_test_game_hardening_admin_proof.mjs",
    "tools/dev_test_game_seed_scenario_cases.mjs",
    "tools/dev_test_game_hosted_concurrent_race_matrix.mjs",
    "tools/dev_test_game.test.mjs",
    "frontend/src/routes/admin/admin-route-model.test.mjs",
  ];
  const forbiddenHardeningImports = [
    "cohostDeadlineRecoveryLaneIds",
    "cohostDeadlineStaleControlCases",
    "hostCohostRaceRecoveryLaneIds",
    "hostGenericStaleControlLaneIds",
    "hostPhaseStaleControlCases",
    "hostPhaseStaleRecoveryLaneIds",
    "hostPromptStaleControlLaneIds",
    "hostRaceReloadLaneIds",
    "hostStandaloneStaleControlLaneIds",
    "hostStaleControlLaneIds",
    "hostedMatrixReconnectLaneIds",
  ];

  for (const callerPath of callerPaths) {
    const source = await readFile(callerPath, "utf8");
    assert(
      source.includes("./dev_test_game_host_stale_control_scenarios.mjs") ||
        source.includes(
          "../../../../tools/dev_test_game_host_stale_control_scenarios.mjs",
        ),
      `${callerPath} should import host stale-control definitions through the scenario module`,
    );

    for (const importBlock of hardeningLaneImportBlocks(source)) {
      for (const forbiddenImport of forbiddenHardeningImports) {
        assert(
          !importBlock.includes(forbiddenImport),
          `${callerPath} should not import ${forbiddenImport} from hardening lane cases`,
        );
      }
    }
  }
});

test("player recovery production callers use the shared scenario module", async () => {
  const callerPaths = [
    "tools/dev_test_game_release_readiness.mjs",
    "tools/dev_test_game_proof_contract.mjs",
    "tools/dev_test_game_hardening_admin_proof.mjs",
  ];
  const forbiddenHardeningImports = [
    "playerActionConflictRecoveryLaneIds",
    "playerActionFoundationLaneIds",
    "promotedStalePlayerCommandLaneIds",
    "stalePlayerCommandLaneIds",
  ];

  for (const callerPath of callerPaths) {
    const source = await readFile(callerPath, "utf8");
    assert(
      source.includes("./dev_test_game_player_recovery_scenarios.mjs"),
      `${callerPath} should import player recovery definitions through the scenario module`,
    );

    for (const importBlock of hardeningLaneImportBlocks(source)) {
      for (const forbiddenImport of forbiddenHardeningImports) {
        assert(
          !importBlock.includes(forbiddenImport),
          `${callerPath} should not import ${forbiddenImport} from hardening lane cases`,
        );
      }
    }
  }
});

test("hardening lane cases share host phase stale-control scenarios", () => {
  assert(Object.isFrozen(hostPhaseStaleControlCaseDefinitions));
  assert.deepEqual(
    hostPhaseStaleControlCases().map((scenario) => ({
      key: scenario.key,
      proofField: scenario.proofField,
      lanes: [
        scenario.baseLaneId,
        scenario.reloadLaneId,
        scenario.reconnectLaneId,
      ],
      actionId: scenario.actionId,
      rejectError: scenario.rejectError,
      stalePhase: scenario.expectedStalePhase,
      currentPhase: scenario.expectedCurrentPhase,
      currentPhaseIncludes: scenario.expectedCurrentActions.phaseIncludes,
      currentDeadlineIncludes:
        scenario.expectedCurrentActions.deadlineIncludes,
    })),
    [
      {
        key: "resolve",
        proofField: "staleHostResolve",
        lanes: [
          "stale-host-resolve",
          "stale-host-resolve-reload",
          "stale-host-resolve-reconnect-recovery",
        ],
        actionId: "resolve_phase",
        rejectError: "PhaseLocked",
        stalePhase: { id: "D02", locked: false },
        currentPhase: { id: "D02", locked: true },
        currentPhaseIncludes: ["unlock_thread", "advance_phase"],
        currentDeadlineIncludes: ["extend_deadline"],
      },
      {
        key: "advance",
        proofField: "staleHostAdvance",
        lanes: [
          "stale-host-advance",
          "stale-host-advance-reload",
          "stale-host-advance-reconnect-recovery",
        ],
        actionId: "advance_phase",
        rejectError: "InvalidTarget",
        stalePhase: { id: "D02", locked: true },
        currentPhase: { id: "D02", locked: false },
        currentPhaseIncludes: ["resolve_phase", "lock_thread"],
        currentDeadlineIncludes: ["extend_deadline"],
      },
      {
        key: "deadline",
        proofField: "staleHostDeadline",
        lanes: [
          "stale-host-deadline",
          "stale-host-deadline-reload",
          "stale-host-deadline-reconnect-recovery",
        ],
        actionId: "extend_deadline",
        rejectError: "PhaseLocked",
        stalePhase: { id: "D01", locked: false },
        currentPhase: { id: "D02", locked: false, deadline: null },
        currentPhaseIncludes: ["resolve_phase", "lock_thread"],
        currentDeadlineIncludes: ["extend_deadline"],
      },
    ],
  );
  assert.notEqual(
    hostPhaseStaleControlCases()[0],
    hostPhaseStaleControlCaseDefinitions[0],
  );
});

function hardeningLaneImportBlocks(source) {
  return Array.from(
    source.matchAll(
      /import\s*{([^}]*)}\s*from\s*["'][^"']*dev_test_game_hardening_lane_cases\.mjs["'];/g,
    ),
    (match) => match[1],
  );
}

test("hardening lane cases share host race/reload IDs", () => {
  assert.deepEqual(hostRaceReloadLaneIds, [
    "concurrent-host-resolve-race",
    "concurrent-host-resolve-race-reload",
    "concurrent-host-advance-race",
    "concurrent-host-advance-race-reload",
    "concurrent-host-deadline-advance-race",
    "concurrent-host-deadline-advance-race-reload",
    "concurrent-host-mixed-advance-race",
    "concurrent-host-mixed-advance-race-reload",
  ]);
});

test("hardening lane cases share host/cohost stale recovery IDs", () => {
  assert.deepEqual(hostPhaseStaleRecoveryLaneIds, [
    "stale-host-resolve-reload",
    "stale-host-resolve-reconnect-recovery",
    "stale-host-advance-reload",
    "stale-host-advance-reconnect-recovery",
    "stale-host-deadline-reload",
    "stale-host-deadline-reconnect-recovery",
  ]);
  assert.deepEqual(cohostDeadlineRecoveryLaneIds, [
    "stale-cohost-deadline-reload",
    "stale-cohost-deadline-reconnect-recovery",
  ]);
});

test("hardening lane cases share cohost deadline stale-control scenario", () => {
  assert(Object.isFrozen(cohostDeadlineStaleControlCaseDefinitions));
  assert.deepEqual(
    cohostDeadlineStaleControlCases().map((scenario) => ({
      key: scenario.key,
      proofField: scenario.proofField,
      lanes: [
        scenario.baseLaneId,
        scenario.reloadLaneId,
        scenario.reconnectLaneId,
      ],
      actionId: scenario.actionId,
      rejectError: scenario.rejectError,
      stalePhase: scenario.expectedStalePhase,
      currentPhase: scenario.expectedCurrentPhase,
      currentPhaseIncludes: scenario.expectedCurrentActions.phaseIncludes,
      currentDeadlineIncludes:
        scenario.expectedCurrentActions.deadlineIncludes,
    })),
    [
      {
        key: "cohost-deadline",
        proofField: "staleCohostDeadline",
        lanes: [
          "stale-cohost-deadline",
          "stale-cohost-deadline-reload",
          "stale-cohost-deadline-reconnect-recovery",
        ],
        actionId: "extend_deadline",
        rejectError: "PhaseLocked",
        stalePhase: { id: "D01", locked: false },
        currentPhase: { id: "D02", locked: false, deadline: null },
        currentPhaseIncludes: [],
        currentDeadlineIncludes: ["extend_deadline"],
      },
    ],
  );
  assert.notEqual(
    cohostDeadlineStaleControlCases()[0],
    cohostDeadlineStaleControlCaseDefinitions[0],
  );
});

test("hardening lane cases share seed-order host/cohost race recovery IDs", () => {
  assert.deepEqual(hostCohostRaceRecoveryLaneIds, [
    "concurrent-host-resolve-race",
    "concurrent-host-resolve-race-reload",
    "stale-host-resolve-reload",
    "stale-host-resolve-reconnect-recovery",
    "concurrent-host-advance-race",
    "concurrent-host-advance-race-reload",
    "stale-host-advance-reload",
    "stale-host-advance-reconnect-recovery",
    "stale-host-deadline-reload",
    "stale-host-deadline-reconnect-recovery",
    "stale-cohost-deadline-reload",
    "stale-cohost-deadline-reconnect-recovery",
    "concurrent-host-deadline-advance-race",
    "concurrent-host-deadline-advance-race-reload",
    "concurrent-host-mixed-advance-race",
    "concurrent-host-mixed-advance-race-reload",
  ]);
});

test("hardening lane cases share player action foundation IDs", () => {
  assert.deepEqual(playerActionFoundationLaneIds, [
    "idempotent-retry",
    "action-idempotent-retry",
    "concurrent-action-race",
    "concurrent-action-race-reload",
    "reconnect-recovery",
  ]);
});

test("hardening lane cases share stale player command IDs", () => {
  assert.deepEqual(stalePlayerCommandLaneIds, [
    "stale-player-vote",
    "stale-player-vote-after-change",
    "stale-player-withdraw-after-change",
    "stale-player-withdraw-after-phase-closure",
    "stale-player-vote-after-phase-closure",
    "stale-player-post-after-phase-closure",
  ]);
  assert.deepEqual(promotedStalePlayerCommandLaneIds, ["stale-player-vote"]);
});

test("hardening lane cases share player action conflict recovery IDs", () => {
  assert.deepEqual(playerActionConflictRecoveryLaneIds, [
    "stale-same-action-recovery",
    "stale-action-conflict",
    "stale-action-reconnect-recovery",
  ]);
});

test("hardening lane cases derive hosted stale-conflict matrix IDs", () => {
  assert.deepEqual(hostedMatrixStaleConflictLaneIds, [
    ...staleConflictMessageLaneIds,
    "stale-host-control",
  ]);
});

test("hardening lane cases derive hosted matrix reconnect IDs", () => {
  assert.deepEqual(hostedMatrixReconnectLaneIds, [
    "reconnect-recovery",
    "replacement-reconnect-recovery",
    "replacement-action-reconnect",
    "replacement-stale-private-post-reconnect",
    "stale-action-reconnect-recovery",
    "stale-host-complete-reconnect-recovery",
    "stale-host-resolve-reconnect-recovery",
    "stale-host-advance-reconnect-recovery",
    "stale-host-deadline-reconnect-recovery",
    "stale-cohost-deadline-reconnect-recovery",
  ]);
});
