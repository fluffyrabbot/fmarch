import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  assertHostStaleControlCoverageSummary,
  buildHostStaleControlCoverageSummary,
  cohostDeadlineRecoveryLaneIds,
  cohostDeadlineStaleControlCases,
  cohostDeadlineStaleControlCaseDefinitions,
  hostCohostRaceRecoveryLaneIds,
  hostGenericStaleControlLaneIds,
  cohostDeadlineActionSet,
  hostLockedPhaseActionSet,
  hostOpenPhaseActionSet,
  hostPhaseRaceCoverageCellCases,
  hostPhaseRaceCoverageCellDefinitions,
  hostStaleControlCoverageFamilies,
  hostStaleControlCoverageFamilyDefinitions,
  hostPhaseStaleControlCase,
  hostStaleControlLaneIds,
  hostPhaseStaleControlCases,
  hostPhaseStaleControlCaseDefinitions,
  hostPhaseStaleRecoveryLaneIds,
  hostPhaseStaleControlLaneIds,
  hostPromptStaleControlLaneIds,
  hostRaceReloadLaneIds,
  hostStandaloneStaleControlLaneIds,
  hostStaleAdvanceControlCase,
  hostStaleAdvanceControlLaneId,
  hostStaleAdvanceReloadLaneId,
  hostStaleResolveControlCase,
  hostStaleResolveControlLaneId,
  hostStaleResolveReloadLaneId,
  hostedMatrixReconnectLaneIds,
} from "./dev_test_game_host_stale_control_scenarios.mjs";
import {
  assertStaleConflictMessageCoverageSummary,
  assertStaleConflictMessageSurfaceCoverage,
  buildStaleConflictMessageCoverageSummary,
  hostedMatrixStaleConflictLaneIds,
  staleConflictMessageCoverageFamilies,
  staleConflictMessageCoverageFamilyDefinitions,
  staleConflictMessageNoSurfaceYetCases,
  replacementStaleConflictMessageSpineLaneCase,
  staleConflictMessageSurfaceCases,
  staleConflictMessageSurfaceCheckIds,
  staleConflictMessageLaneIds,
} from "./dev_test_game_stale_conflict_scenarios.mjs";
import {
  replacementSessionRecoveryLaneIds,
} from "./dev_test_game_replacement_handoff_scenario_cases.mjs";
import {
  playerActionConflictRecoveryLaneIds,
  playerActionFoundationLaneIds,
  promotedStalePlayerCommandLaneIds,
  stalePlayerCommandLaneIds,
} from "./dev_test_game_player_recovery_scenarios.mjs";
import {
  completedGameHardeningSpineCycleId,
  completedGameHardeningSpineLaneCases,
  completedGameStaleRecoverySpineLaneCase,
} from "./dev_test_game_core_loop_completed_game_cases.mjs";

test("hardening lane cases share stale conflict-message IDs", () => {
  assert.deepEqual(staleConflictMessageLaneIds, [
    "replacement-stale-conflict-message",
    "stale-action-conflict-message",
    "stale-dead-action-conflict",
    "stale-host-deadline",
    "stale-cohost-deadline",
  ]);
  assert.deepEqual(
    {
      laneId: replacementStaleConflictMessageSpineLaneCase().laneId,
      role: replacementStaleConflictMessageSpineLaneCase().role,
    },
    {
      laneId: "replacement-stale-conflict-message",
      role: "host",
    },
  );
  assert.deepEqual(staleConflictMessageSurfaceCases(), [
    {
      id: "replacement-stale-conflict-message-surface",
      checkId: "stale-conflict-message-surface-replacement-stale-conflict-message",
      laneId: "replacement-stale-conflict-message",
      label: "Replacement stale conflict message surface",
      role: "host",
      expectedRejectError: "InvalidTarget",
      expectedReceiptFragment: "replacement target is stale",
      expectedActionId: "process_replacement_stale_success",
      expectedActivitySource: "outcome",
      expectedDispatchKind: "process_replacement",
      expectedCommandOutgoing: "player-mira",
      expectedCurrentOccupant: "player-rowan",
      proofBoundary:
        "Seeded host role URL proof that a stale replacement command rejects with an explicit InvalidTarget conflict message and preserves the current slot occupant.",
    },
    {
      id: "stale-action-conflict-message-surface",
      checkId: "stale-conflict-message-surface-stale-action-conflict-message",
      laneId: "stale-action-conflict-message",
      label: "Stale action conflict message surface",
      role: "player",
      expectedRejectError: "PhaseLocked",
      expectedTemplateId: "factional_kill",
      expectedStalePhase: "N01",
      expectedRefreshedPhase: "D02",
      expectedReceiptFragment: "stale action state",
      proofBoundary:
        "Seeded player role URL proof that a stale factional_kill action rejects with an explicit PhaseLocked conflict message and refreshes into current action controls.",
    },
    {
      id: "stale-dead-action-conflict-surface",
      checkId: "stale-conflict-message-surface-stale-dead-action-conflict",
      laneId: "stale-dead-action-conflict",
      label: "Stale dead-action conflict message surface",
      role: "player",
      expectedRejectError: "SlotNotAlive",
      expectedTemplateId: "factional_kill",
      expectedStalePhase: "N01",
      expectedRejectMessageFragment: "actor is no longer alive",
      expectedActorStatusAfterReject: "dead",
      expectedActionVisibleAfterRefresh: false,
      expectedRestoredActorStatus: "alive",
      proofBoundary:
        "Seeded player role URL proof that a stale factional_kill action rejects after actor death with an explicit SlotNotAlive conflict message and refreshes with action controls removed.",
    },
    {
      id: "stale-host-deadline-surface",
      checkId: "stale-conflict-message-surface-stale-host-deadline",
      laneId: "stale-host-deadline",
      label: "Stale host deadline conflict message surface",
      role: "host",
      expectedRejectError: "PhaseLocked",
      expectedStalePhase: "D01",
      expectedReceiptFragment: "stale phase state",
      expectedStaleClickActionId: "extend_deadline",
      expectedStaleClickRefreshKeys: ["host"],
      expectedActivitySource: "outcome",
      expectedPhaseId: "D02",
      expectedLocked: false,
      expectedDeadlineActions: ["extend_deadline"],
      expectedPhaseActions: ["lock_thread", "resolve_phase"],
      proofBoundary:
        "Seeded host role URL proof that a stale deadline control rejects with an explicit PhaseLocked conflict message and refreshes into current host phase controls.",
    },
    {
      id: "stale-cohost-deadline-surface",
      checkId: "stale-conflict-message-surface-stale-cohost-deadline",
      laneId: "stale-cohost-deadline",
      label: "Stale cohost deadline conflict message surface",
      role: "cohost",
      expectedRejectError: "PhaseLocked",
      expectedStalePhase: "D01",
      expectedReceiptFragment: "stale phase state",
      expectedStaleClickActionId: "extend_deadline",
      expectedStaleClickRefreshKeys: ["host"],
      expectedActivitySource: "outcome",
      expectedPhaseId: "D02",
      expectedCurrentActions: ["extend_deadline"],
      proofBoundary:
        "Seeded cohost role URL proof that a delegated stale deadline control rejects with an explicit PhaseLocked conflict message and refreshes into current delegated controls.",
    },
  ]);
  assert.deepEqual(staleConflictMessageSurfaceCheckIds(), [
    "stale-conflict-message-surface-replacement-stale-conflict-message",
    "stale-conflict-message-surface-stale-action-conflict-message",
    "stale-conflict-message-surface-stale-dead-action-conflict",
    "stale-conflict-message-surface-stale-host-deadline",
    "stale-conflict-message-surface-stale-cohost-deadline",
  ]);
  assert.deepEqual(staleConflictMessageNoSurfaceYetCases(), []);
  assert.doesNotThrow(() => assertStaleConflictMessageSurfaceCoverage());
});

test("hardening lane cases summarize stale conflict-message coverage", () => {
  assert(Object.isFrozen(staleConflictMessageCoverageFamilyDefinitions));
  assert.deepEqual(
    staleConflictMessageCoverageFamilies().map((family) => ({
      id: family.id,
      laneIds: family.laneIds,
    })),
    [
      {
        id: "replacement-conflict-message",
        laneIds: ["replacement-stale-conflict-message"],
      },
      {
        id: "player-action-conflict-messages",
        laneIds: ["stale-action-conflict-message", "stale-dead-action-conflict"],
      },
      {
        id: "host-deadline-conflict-messages",
        laneIds: ["stale-host-deadline", "stale-cohost-deadline"],
      },
    ],
  );
  const lanes = staleConflictMessageLaneIds.map((id) => ({
    id,
    status: "passed",
  }));
  const summary = buildStaleConflictMessageCoverageSummary(lanes);
  assert.deepEqual(summary.sourceLaneIds, staleConflictMessageLaneIds);
  assert.equal(summary.laneCount, staleConflictMessageLaneIds.length);
  assert.equal(summary.passedLaneCount, staleConflictMessageLaneIds.length);
  assert.equal(summary.familyCount, 3);
  assert.doesNotThrow(() =>
    assertStaleConflictMessageCoverageSummary({ summary, lanes }),
  );
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

test("hardening lane cases summarize host stale-control coverage", () => {
  assert(Object.isFrozen(hostStaleControlCoverageFamilyDefinitions));
  assert.deepEqual(
    hostStaleControlCoverageFamilies().map((family) => ({
      id: family.id,
      laneIds: family.laneIds,
    })),
    [
      {
        id: "standalone-host-controls",
        laneIds: hostStandaloneStaleControlLaneIds,
      },
      {
        id: "prompt-controls",
        laneIds: hostPromptStaleControlLaneIds,
      },
      {
        id: "completed-game-stale-commands",
        laneIds: [
          "stale-host-complete",
          "stale-host-complete-reload",
          "stale-host-complete-reconnect-recovery",
        ],
      },
      {
        id: "generic-host-control",
        laneIds: hostGenericStaleControlLaneIds,
      },
      {
        id: "phase-controls",
        laneIds: hostPhaseStaleControlLaneIds,
      },
    ],
  );

  const lanes = hostStaleControlLaneIds.map((id) => ({
    id,
    status: "passed",
  }));
  const summary = buildHostStaleControlCoverageSummary(lanes);
  assert.deepEqual(summary.sourceLaneIds, hostStaleControlLaneIds);
  assert.equal(summary.laneCount, hostStaleControlLaneIds.length);
  assert.equal(summary.passedLaneCount, hostStaleControlLaneIds.length);
  assert.equal(summary.familyCount, 5);
  assert.doesNotThrow(() =>
    assertHostStaleControlCoverageSummary({ summary, lanes }),
  );
});

test("hardening lane cases share completed-game spine rows", () => {
  assert.equal(completedGameHardeningSpineCycleId, "hardening-completed-game");
  assert.deepEqual(
    completedGameHardeningSpineLaneCases().map(({ id, role }) => ({
      id,
      role,
    })),
    [
      {
        id: "stale-host-complete-reload",
        role: "host",
      },
      {
        id: "stale-host-complete-reconnect-recovery",
        role: "host",
      },
      {
        id: "stale-player-complete-reload",
        role: "player",
      },
    ],
  );
  assert.deepEqual(
    {
      id: completedGameStaleRecoverySpineLaneCase().id,
      role: completedGameStaleRecoverySpineLaneCase().role,
    },
    {
      id: "stale-host-complete-reload",
      role: "host",
    },
  );
});

test("host stale-control production callers use the shared scenario module", async () => {
  const callerPaths = [
    "tools/dev_test_game_next_action.mjs",
    "tools/dev_test_game_release_readiness.mjs",
    "tools/dev_test_game_proof_contract.mjs",
    "tools/dev_test_game_core_loop_scenarios.mjs",
    "tools/dev_test_game_hardening_admin_proof.mjs",
    "tools/dev_test_game_seed_scenario_cases.mjs",
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

test("stale conflict production callers use the shared scenario module", async () => {
  const callerPaths = [
    "tools/dev_test_game_next_action.mjs",
    "tools/dev_test_game_release_readiness.mjs",
    "tools/dev_test_game_proof_contract.mjs",
    "tools/dev_test_game_hardening_admin_proof.mjs",
    "tools/dev_test_game_proof_graph_handoff_cases.mjs",
    "tools/dev_test_game.test.mjs",
    "tools/dev_test_game_proof_graph_handoff_cases.test.mjs",
    "tools/dev_test_game_proof_graph_handoffs.test.mjs",
    "tools/dev_test_game_admin_audit_handoff_contract.test.mjs",
    "frontend/src/routes/admin/admin-route-model.test.mjs",
  ];
  const forbiddenHardeningImports = [
    "hostedMatrixStaleConflictLaneIds",
    "staleConflictMessageLaneIds",
  ];

  for (const callerPath of callerPaths) {
    const source = await readFile(callerPath, "utf8");
    assert(
      source.includes("./dev_test_game_stale_conflict_scenarios.mjs") ||
        source.includes(
          "./dev_test_game_hosted_concurrent_race_matrix_cases.mjs",
        ) ||
        source.includes(
          "../../../../tools/dev_test_game_stale_conflict_scenarios.mjs",
        ),
      `${callerPath} should import stale conflict definitions through the scenario module`,
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
  assert.deepEqual(hostOpenPhaseActionSet(), {
    phaseIncludes: ["resolve_phase", "lock_thread"],
    phaseExcludes: [],
    deadlineIncludes: ["extend_deadline"],
  });
  assert.deepEqual(hostLockedPhaseActionSet({ excludeOpen: true }), {
    phaseIncludes: ["unlock_thread", "advance_phase"],
    phaseExcludes: ["resolve_phase", "lock_thread"],
    deadlineIncludes: ["extend_deadline"],
  });
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
      commandKind: scenario.commandKind,
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
        commandKind: "ResolvePhase",
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
        commandKind: "AdvancePhase",
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
        commandKind: "ExtendDeadline",
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
  assert.notEqual(
    hostPhaseStaleControlCases()[0].expectedCurrentActions.phaseIncludes,
    hostPhaseStaleControlCaseDefinitions[0].expectedCurrentActions.phaseIncludes,
  );
  assert.equal(hostPhaseStaleControlCase("resolve").baseLaneId, "stale-host-resolve");
  assert.equal(hostStaleResolveControlCase().rejectError, "PhaseLocked");
  assert.equal(hostStaleResolveControlLaneId, "stale-host-resolve");
  assert.equal(hostStaleResolveReloadLaneId, "stale-host-resolve-reload");
  assert.equal(hostPhaseStaleControlCase("advance").baseLaneId, "stale-host-advance");
  assert.equal(hostStaleAdvanceControlCase().rejectError, "InvalidTarget");
  assert.equal(hostStaleAdvanceControlLaneId, "stale-host-advance");
  assert.equal(hostStaleAdvanceReloadLaneId, "stale-host-advance-reload");
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
  assert(Object.isFrozen(hostPhaseRaceCoverageCellDefinitions));
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
  assert.deepEqual(
    hostPhaseRaceCoverageCellCases().flatMap((scenario) => [
      scenario.raceLaneId,
      scenario.reloadLaneId,
    ]),
    hostRaceReloadLaneIds,
  );
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
  assert.deepEqual(cohostDeadlineActionSet(), {
    phaseIncludes: [],
    phaseExcludes: [],
    deadlineIncludes: ["extend_deadline"],
  });
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
      commandKind: scenario.commandKind,
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
        commandKind: "ExtendDeadline",
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
  assert.notEqual(
    cohostDeadlineStaleControlCases()[0].expectedCurrentActions.deadlineIncludes,
    cohostDeadlineStaleControlCaseDefinitions[0].expectedCurrentActions.deadlineIncludes,
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
    "private-channel-stale-action-reconnect-recovery",
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
    replacementSessionRecoveryLaneIds.at(-1),
    "replacement-action-reconnect",
    "replacement-stale-private-post-reconnect",
    "stale-action-reconnect-recovery",
    "private-channel-stale-action-reconnect-recovery",
    "stale-host-complete-reconnect-recovery",
    "stale-host-resolve-reconnect-recovery",
    "stale-host-advance-reconnect-recovery",
    "stale-host-deadline-reconnect-recovery",
    "stale-cohost-deadline-reconnect-recovery",
  ]);
});
