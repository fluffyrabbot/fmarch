import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  assertHostStaleControlCoverageSummary,
  buildHostStaleControlCoverageSummary,
  cohostDeadlineRecoveryLaneIds,
  cohostStaleDeadlineReconnectLaneId,
  cohostStaleDeadlineControlLaneId,
  cohostStaleDeadlineReloadLaneId,
  cohostDeadlineStaleControlCases,
  cohostDeadlineStaleControlCaseDefinitions,
  coreLoopHostStaleCommandHighlightedLaneIds,
  hardeningHostStaleCommandHighlightedLaneIds,
  hostCohostRaceRecoveryLaneIds,
  hostGenericStaleControlLaneIds,
  cohostDeadlineActionSet,
  hostLifecycleRaceLaneIds,
  hostLockedPhaseActionSet,
  hostOpenPhaseActionSet,
  hostStaleAdvanceReconnectLaneId,
  hostPhaseRaceCoverageCellCases,
  hostPhaseRaceCoverageCellDefinitions,
  hostPhaseRaceReloadSpineTargetCases,
  hostStaleControlCoverageFamilies,
  hostStaleControlCoverageFamilyDefinitions,
  hostPhaseStaleControlCase,
  hostStaleControlLaneIds,
  hostPhaseStaleControlCases,
  hostPhaseStaleControlCaseDefinitions,
  hostPhaseStaleRecoveryLaneIds,
  hostPhaseStaleControlLaneIds,
  hostPromptStaleControlLaneIds,
  hostPublishRaceLaneIds,
  hostRaceReloadLaneIds,
  hostStandaloneRaceCoverageCellCases,
  hostStandaloneRaceCoverageCellDefinitions,
  hostStandaloneRaceReloadLaneIds,
  hostStandaloneRaceReloadSpineTargetCases,
  hostStandaloneStaleControlLaneIds,
  hostStaleAdvanceControlCase,
  hostStaleAdvanceControlLaneId,
  hostStaleAdvanceReloadLaneId,
  hostStaleControlStatusExpectations,
  hostStaleDeadlineReconnectLaneId,
  hostStaleDeadlineControlLaneId,
  hostStaleDeadlineReloadLaneId,
  hostStaleReconnectExpectations,
  hostStaleResolveReconnectLaneId,
  hostStaleResolveControlCase,
  hostStaleResolveControlLaneId,
  hostStaleResolveReloadLaneId,
} from "./dev_test_game_host_stale_recovery_scenarios.mjs";
import {
  assertStaleConflictMessageCoverageSummary,
  assertStaleConflictMessageSurfaceCoverage,
  buildStaleConflictMessageCoverageSummary,
  completedHostStaleCompleteReconnectLaneId,
  hardeningRecoveryAuditLaneIds,
  hardeningRecoveryHighlightedLaneIds,
  hostedMatrixStaleConflictLaneIds,
  hardeningStaleConflictHighlightedLaneIds,
  hostedMatrixReconnectLaneIds,
  hostedMatrixRecoveryLaneIds,
  playerLiveReconnectLaneId,
  privateChannelStaleActionConflictMessageLaneId,
  privateChannelStaleActionReconnectExpectation,
  privateChannelStaleActionReconnectLaneId,
  reconnectHardeningSpineTargetCases,
  replacementStaleConflictMessageLaneId,
  replacementActionReconnectLaneId,
  replacementPrivatePostReconnectLaneId,
  replacementSessionReconnectLaneId,
  staleClientReconnectCases,
  staleClientReconnectCaseDefinitions,
  staleClientReconnectLaneIds,
  staleCohostDeadlineConflictLaneId,
  staleConflictMessageCoverageFamilies,
  staleConflictMessageCoverageFamilyDefinitions,
  staleConflictMessageNoSurfaceYetCases,
  staleActionConflictMessageLaneId,
  staleConflictMessageStatusExpectations,
  replacementStaleConflictMessageSpineLaneCase,
  staleDeadActionConflictLaneId,
  staleHostDeadlineConflictLaneId,
  staleConflictMessageSurfaceCases,
  staleConflictMessageSurfaceCheckIds,
  staleConflictMessageLaneIds,
  stalePlayerActionReconnectExpectation,
  stalePlayerActionReconnectLaneId,
} from "./dev_test_game_hardening_recovery_scenarios.mjs";
import {
  replacementSessionRecoveryLaneIds,
} from "./dev_test_game_replacement_handoff_scenario_cases.mjs";
import {
  concurrentActionRaceLaneId,
  concurrentActionRaceReloadLaneId,
  hardeningPlayerRecoveryHighlightedLaneIds,
  playerActionConflictRecoveryLaneIds,
  playerActionFoundationLaneIds,
  playerRecoveryRaceLaneIds,
  playerRecoveryStatusExpectations,
  promotedStalePlayerCommandLaneIds,
  staleActionConflictLaneId,
  stalePlayerCommandLaneIds,
  staleSameActionRecoveryLaneId,
} from "./dev_test_game_player_recovery_scenarios.mjs";
import {
  completedGameHardeningSpineCycleId,
  completedGameHardeningSpineLaneCases,
  completedGameHardeningSpineTargetCases,
  completedGameStaleRecoverySpineLaneCase,
} from "./dev_test_game_core_loop_completed_terminal_scenario_assertions.mjs";
import {
  cohostHostRaceLaneIds,
  crossRoleRaceReloadSpineTargetCases,
  crossRoleRaceLaneIds,
  playerHostRaceLaneIds,
} from "./dev_test_game_cross_role_race_scenarios.mjs";

test("hardening lane cases share stale conflict-message IDs", () => {
  assert.deepEqual(staleConflictMessageLaneIds, [
    "replacement-stale-conflict-message",
    "stale-action-conflict-message",
    "private-channel-stale-action-conflict-message",
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
      id: "private-channel-stale-action-conflict-message-surface",
      checkId:
        "stale-conflict-message-surface-private-channel-stale-action-conflict-message",
      laneId: "private-channel-stale-action-conflict-message",
      label: "Private channel stale action conflict message surface",
      role: "player",
      expectedRejectError: "PhaseLocked",
      expectedTemplateId: "factional_kill",
      expectedStalePhase: "N01",
      expectedRefreshedPhase: "D02",
      expectedReceiptFragment: "stale action state",
      expectedChannelId: "private:mafia_day_chat",
      expectedRoleUrlFragment: "/c/private%3Amafia_day_chat",
      expectedPrivateThreadPagerVisible: true,
      proofBoundary:
        "Seeded private-channel player role URL proof that a stale factional_kill action rejects with an explicit PhaseLocked conflict message, preserves private channel scope, and refreshes into current action controls.",
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
      expectedDeadlineActions: [
        "extend_deadline",
        "extend_deadline_24h",
        "extend_deadline_48h",
      ],
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
      expectedCurrentActions: [
        "extend_deadline",
        "extend_deadline_24h",
        "extend_deadline_48h",
      ],
      proofBoundary:
        "Seeded cohost role URL proof that a delegated stale deadline control rejects with an explicit PhaseLocked conflict message and refreshes into current delegated controls.",
    },
  ]);
  assert.deepEqual(staleConflictMessageSurfaceCheckIds(), [
    "stale-conflict-message-surface-replacement-stale-conflict-message",
    "stale-conflict-message-surface-stale-action-conflict-message",
    "stale-conflict-message-surface-private-channel-stale-action-conflict-message",
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
        laneIds: [
          "stale-action-conflict-message",
          "private-channel-stale-action-conflict-message",
          "stale-dead-action-conflict",
        ],
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
  assert.equal(summary.expectedLaneCount, staleConflictMessageLaneIds.length);
  assert.equal(summary.expectedFamilyCount, 3);
  assert.doesNotThrow(() =>
    assertStaleConflictMessageCoverageSummary({ summary, lanes }),
  );
});

test("hardening lane cases share stale conflict-message status expectations", () => {
  assert.deepEqual(
    staleConflictMessageStatusExpectations().map((expectation) => ({
      laneId: expectation.laneId,
      role: expectation.role,
      rejectError: expectation.rejectError,
      receiptStatusText: expectation.receiptStatusText,
      receiptFragment: expectation.receiptFragment,
      rejectMessageFragment: expectation.rejectMessageFragment,
      actorStatusAfterReject: expectation.actorStatusAfterReject,
      actionVisibleAfterRefresh: expectation.actionVisibleAfterRefresh,
      refreshedPhase: expectation.refreshedPhase,
      currentOccupant: expectation.currentOccupant,
    })),
    [
      {
        laneId: replacementStaleConflictMessageLaneId,
        role: "host",
        rejectError: "InvalidTarget",
        receiptStatusText: undefined,
        receiptFragment: "replacement target is stale",
        rejectMessageFragment: undefined,
        actorStatusAfterReject: undefined,
        actionVisibleAfterRefresh: undefined,
        refreshedPhase: undefined,
        currentOccupant: "player-rowan",
      },
      {
        laneId: staleActionConflictMessageLaneId,
        role: "player",
        rejectError: "PhaseLocked",
        receiptStatusText:
          "Reject PhaseLocked: phase locked; stale action state, refresh and use current action controls",
        receiptFragment: undefined,
        rejectMessageFragment: undefined,
        actorStatusAfterReject: undefined,
        actionVisibleAfterRefresh: undefined,
        refreshedPhase: "D02",
        currentOccupant: undefined,
      },
      {
        laneId: privateChannelStaleActionConflictMessageLaneId,
        role: "player",
        rejectError: "PhaseLocked",
        receiptStatusText:
          "Reject PhaseLocked: phase locked; stale action state, refresh and use current action controls",
        receiptFragment: undefined,
        rejectMessageFragment: undefined,
        actorStatusAfterReject: undefined,
        actionVisibleAfterRefresh: undefined,
        refreshedPhase: "D02",
        currentOccupant: undefined,
      },
      {
        laneId: staleDeadActionConflictLaneId,
        role: "player",
        rejectError: "SlotNotAlive",
        receiptStatusText: undefined,
        receiptFragment: undefined,
        rejectMessageFragment: "actor is no longer alive",
        actorStatusAfterReject: "dead",
        actionVisibleAfterRefresh: false,
        refreshedPhase: undefined,
        currentOccupant: undefined,
      },
      {
        laneId: staleHostDeadlineConflictLaneId,
        role: "host",
        rejectError: "PhaseLocked",
        receiptStatusText: undefined,
        receiptFragment: "stale phase state",
        rejectMessageFragment: undefined,
        actorStatusAfterReject: undefined,
        actionVisibleAfterRefresh: undefined,
        refreshedPhase: undefined,
        currentOccupant: undefined,
      },
      {
        laneId: staleCohostDeadlineConflictLaneId,
        role: "cohost",
        rejectError: "PhaseLocked",
        receiptStatusText: undefined,
        receiptFragment: "stale phase state",
        rejectMessageFragment: undefined,
        actorStatusAfterReject: undefined,
        actionVisibleAfterRefresh: undefined,
        refreshedPhase: undefined,
        currentOccupant: undefined,
      },
    ],
  );
  assert.deepEqual(hardeningStaleConflictHighlightedLaneIds, [
    staleSameActionRecoveryLaneId,
    staleDeadActionConflictLaneId,
    staleActionConflictLaneId,
    staleActionConflictMessageLaneId,
    privateChannelStaleActionConflictMessageLaneId,
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
  assert.equal(summary.expectedLaneCount, hostStaleControlLaneIds.length);
  assert.equal(summary.expectedFamilyCount, 5);
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
  assert.deepEqual(
    completedGameHardeningSpineTargetCases().map((target) => [
      target.targetKey,
      target.featureSlotId,
      target.roleUrlId,
      target.role,
    ]),
    [
      [
        "completedGameStaleRecovery",
        "completed-game-stale-recovery",
        "stale-host-complete-reload",
        "host",
      ],
      [
        "completedGameStaleReconnectRecovery",
        "completed-game-stale-reconnect-recovery",
        "stale-host-complete-reconnect-recovery",
        "host",
      ],
      [
        "completedGameStalePlayerReloadRecovery",
        "completed-game-stale-player-reload-recovery",
        "stale-player-complete-reload",
        "player",
      ],
    ],
  );
});

test("host stale-control production callers use the shared recovery facade", async () => {
  const callerPaths = [
    "tools/dev_test_game_next_action_recovery_traces.mjs",
    "tools/dev_test_game_hardening_feature_spine_targets.mjs",
    "tools/dev_test_game_release_readiness.mjs",
    "tools/dev_test_game_proof_contract.mjs",
    "tools/dev_test_game_core_loop_scenarios.mjs",
    "tools/dev_test_game_hardening_admin_proof.mjs",
    "tools/dev_test_game_hardening_lane_cases.mjs",
    "tools/dev_test_game_hardening_scenarios.mjs",
    "tools/dev_test_game_race_coverage.mjs",
    "tools/dev_test_game_seed_scenario_cases.mjs",
    "frontend/src/routes/admin/admin-route-model.test.mjs",
    "frontend/src/lib/app/local-proof-lane-status.mjs",
  ];

  for (const callerPath of callerPaths) {
    const source = await readFile(callerPath, "utf8");
    assert(
      source.includes("./dev_test_game_host_stale_recovery_scenarios.mjs") ||
        source.includes(
          "../../../../tools/dev_test_game_host_stale_recovery_scenarios.mjs",
        ),
      `${callerPath} should import host stale-control definitions through the recovery facade`,
    );
    assert(
      !source.includes("./dev_test_game_host_stale_control_scenarios.mjs") &&
        !source.includes(
          "../../../../tools/dev_test_game_host_stale_control_scenarios.mjs",
        ),
      `${callerPath} should not bypass the host stale recovery facade`,
    );
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
    "tools/dev_test_game_next_action_recovery_traces.mjs",
    "tools/dev_test_game_release_readiness.mjs",
    "tools/dev_test_game_proof_contract.mjs",
    "tools/dev_test_game_hardening_admin_proof.mjs",
    "tools/dev_test_game_proof_graph_handoff_cases.mjs",
    "tools/dev_test_game_hosted_concurrent_race_matrix_cases.mjs",
    "frontend/src/lib/app/local-proof-lane-status.mjs",
  ];

  for (const callerPath of callerPaths) {
    const source = await readFile(callerPath, "utf8");
    assert(
      source.includes("./dev_test_game_hardening_recovery_scenarios.mjs") ||
        source.includes(
          "../../../../tools/dev_test_game_hardening_recovery_scenarios.mjs",
        ),
      `${callerPath} should import stale conflict definitions through the hardening recovery scenario module`,
    );
    assert(
      !source.includes("./dev_test_game_stale_conflict_scenarios.mjs") &&
        !source.includes(
          "../../../../tools/dev_test_game_stale_conflict_scenarios.mjs",
        ),
      `${callerPath} should not bypass the hardening recovery facade for stale conflict definitions`,
    );
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

test("hardening lane cases share host stale-control status expectations", () => {
  assert.deepEqual(
    hostStaleControlStatusExpectations().map((expectation) => ({
      laneId: expectation.laneId,
      role: expectation.role,
      rejectError: expectation.rejectError,
      rejectReceipt: expectation.rejectReceipt,
      locked: expectation.locked,
      apiDeadline: expectation.apiDeadline,
      phaseActions: expectation.phaseActions,
    })),
    [
      {
        laneId: hostStaleResolveControlLaneId,
        role: "host",
        rejectError: "PhaseLocked",
        rejectReceipt: undefined,
        locked: true,
        apiDeadline: undefined,
        phaseActions: undefined,
      },
      {
        laneId: hostStaleResolveReloadLaneId,
        role: "host",
        rejectError: undefined,
        rejectReceipt:
          "Reject PhaseLocked: phase locked; stale phase state, refresh and use current controls",
        locked: true,
        apiDeadline: undefined,
        phaseActions: undefined,
      },
      {
        laneId: hostStaleAdvanceControlLaneId,
        role: "host",
        rejectError: "InvalidTarget",
        rejectReceipt: undefined,
        locked: false,
        apiDeadline: undefined,
        phaseActions: undefined,
      },
      {
        laneId: hostStaleAdvanceReloadLaneId,
        role: "host",
        rejectError: undefined,
        rejectReceipt:
          "Reject InvalidTarget: invalid target; stale phase state, refresh and use current controls",
        locked: false,
        apiDeadline: undefined,
        phaseActions: undefined,
      },
      {
        laneId: hostStaleDeadlineControlLaneId,
        role: "host",
        rejectError: "PhaseLocked",
        rejectReceipt: undefined,
        locked: false,
        apiDeadline: null,
        phaseActions: undefined,
      },
      {
        laneId: hostStaleDeadlineReloadLaneId,
        role: "host",
        rejectError: undefined,
        rejectReceipt:
          "Reject PhaseLocked: phase locked; stale phase state, refresh and use current controls",
        locked: false,
        apiDeadline: null,
        phaseActions: undefined,
      },
      {
        laneId: cohostStaleDeadlineControlLaneId,
        role: "cohost",
        rejectError: "PhaseLocked",
        rejectReceipt: undefined,
        locked: undefined,
        apiDeadline: null,
        phaseActions: [],
      },
      {
        laneId: cohostStaleDeadlineReloadLaneId,
        role: "cohost",
        rejectError: undefined,
        rejectReceipt:
          "Reject PhaseLocked: phase locked; stale phase state, refresh and use current controls",
        locked: false,
        apiDeadline: null,
        phaseActions: [],
      },
    ],
  );
  assert.deepEqual(coreLoopHostStaleCommandHighlightedLaneIds, [
    hostStaleResolveControlLaneId,
    hostStaleResolveReloadLaneId,
    hostStaleAdvanceControlLaneId,
    hostStaleAdvanceReloadLaneId,
  ]);
  assert.deepEqual(hardeningHostStaleCommandHighlightedLaneIds, [
    hostStaleResolveControlLaneId,
    hostStaleResolveReloadLaneId,
    hostStaleAdvanceControlLaneId,
    hostStaleDeadlineControlLaneId,
    cohostStaleDeadlineControlLaneId,
  ]);
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
  assert(Object.isFrozen(hostStandaloneRaceCoverageCellDefinitions));
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
  assert.deepEqual(
    hostPhaseRaceReloadSpineTargetCases().map((target) => [
      target.targetKey,
      target.featureSlotId,
      target.reloadLaneId,
      target.role,
    ]),
    [
      [
        "hostConcurrentResolveRaceReload",
        "host-concurrent-resolve-race-reload",
        "concurrent-host-resolve-race-reload",
        "host",
      ],
      [
        "hostConcurrentAdvanceRaceReload",
        "host-concurrent-advance-race-reload",
        "concurrent-host-advance-race-reload",
        "host",
      ],
      [
        "hostConcurrentDeadlineAdvanceRaceReload",
        "host-concurrent-deadline-advance-race-reload",
        "concurrent-host-deadline-advance-race-reload",
        "host",
      ],
      [
        "hostConcurrentMixedAdvanceRaceReload",
        "host-concurrent-mixed-advance-race-reload",
        "concurrent-host-mixed-advance-race-reload",
        "host",
      ],
    ],
  );
  assert.deepEqual(hostPublishRaceLaneIds, [
    "concurrent-host-publish-race",
    "concurrent-host-publish-race-reload",
  ]);
  assert.deepEqual(hostLifecycleRaceLaneIds, [
    "concurrent-host-lifecycle-race",
    "concurrent-host-lifecycle-race-reload",
  ]);
  assert.deepEqual(hostStandaloneRaceReloadLaneIds, [
    ...hostPublishRaceLaneIds,
    ...hostLifecycleRaceLaneIds,
  ]);
  assert.deepEqual(hostStandaloneRaceReloadSpineTargetCases(), [
    {
      targetKey: "hostConcurrentPublishRaceReload",
      featureSlotId: "host-concurrent-publish-race-reload",
      reloadLaneId: hostPublishRaceLaneIds[1],
      role: "host",
    },
    {
      targetKey: "hostConcurrentLifecycleRaceReload",
      featureSlotId: "host-concurrent-lifecycle-race-reload",
      reloadLaneId: hostLifecycleRaceLaneIds[1],
      role: "host",
    },
  ]);
  assert.deepEqual(
    hostStandaloneRaceCoverageCellCases().map((cell) => ({
      id: cell.id,
      raceLaneId: cell.raceLaneId,
      reloadLaneId: cell.reloadLaneId,
      roleSurfaces: cell.roleSurfaces,
    })),
    [
      {
        id: "host-votecount-publication",
        raceLaneId: "concurrent-host-publish-race",
        reloadLaneId: "concurrent-host-publish-race-reload",
        roleSurfaces: ["host", "player"],
      },
      {
        id: "host-lifecycle",
        raceLaneId: "concurrent-host-lifecycle-race",
        reloadLaneId: "concurrent-host-lifecycle-race-reload",
        roleSurfaces: ["host"],
      },
    ],
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
    concurrentActionRaceLaneId,
    concurrentActionRaceReloadLaneId,
    playerLiveReconnectLaneId,
  ]);
});

test("hardening lane cases share player recovery status expectations", () => {
  assert.deepEqual(
    playerRecoveryStatusExpectations().map((expectation) => ({
      laneId: expectation.laneId,
      ackState: expectation.ackState,
      rejectError: expectation.rejectError,
      targetSlot: expectation.targetSlot,
      apiTargetAlive: expectation.apiTargetAlive,
      refreshedPhase: expectation.refreshedPhase,
      actionVisibleAfterRefresh: expectation.actionVisibleAfterRefresh,
    })),
    [
      {
        laneId: concurrentActionRaceLaneId,
        ackState: "ack",
        rejectError: "ActionAlreadySubmitted",
        targetSlot: undefined,
        apiTargetAlive: undefined,
        refreshedPhase: undefined,
        actionVisibleAfterRefresh: undefined,
      },
      {
        laneId: concurrentActionRaceReloadLaneId,
        ackState: undefined,
        rejectError: undefined,
        targetSlot: "slot-2",
        apiTargetAlive: false,
        refreshedPhase: undefined,
        actionVisibleAfterRefresh: undefined,
      },
      {
        laneId: staleSameActionRecoveryLaneId,
        ackState: undefined,
        rejectError: "ActionAlreadySubmitted",
        targetSlot: undefined,
        apiTargetAlive: undefined,
        refreshedPhase: "N01",
        actionVisibleAfterRefresh: false,
      },
      {
        laneId: staleActionConflictLaneId,
        ackState: undefined,
        rejectError: "PhaseLocked",
        targetSlot: undefined,
        apiTargetAlive: undefined,
        refreshedPhase: "D02",
        actionVisibleAfterRefresh: false,
      },
    ],
  );
  assert.deepEqual(hardeningPlayerRecoveryHighlightedLaneIds, [
    concurrentActionRaceLaneId,
    concurrentActionRaceReloadLaneId,
  ]);
});

test("hardening lane cases share cross-role race IDs", async () => {
  assert.deepEqual(playerHostRaceLaneIds, [
    "concurrent-player-vote-resolve-race",
    "concurrent-player-vote-resolve-race-reload",
    "concurrent-player-action-advance-race",
    "concurrent-player-action-advance-race-reload",
  ]);
  assert.deepEqual(cohostHostRaceLaneIds, [
    "concurrent-cohost-deadline-resolve-race",
    "concurrent-cohost-deadline-resolve-race-reload",
  ]);
  assert.deepEqual(crossRoleRaceLaneIds, [
    ...playerHostRaceLaneIds,
    ...cohostHostRaceLaneIds,
  ]);
  assert.deepEqual(playerRecoveryRaceLaneIds, [
    "concurrent-vote-race",
    "concurrent-vote-race-reload",
    ...playerHostRaceLaneIds,
  ]);
  assert.deepEqual(
    crossRoleRaceReloadSpineTargetCases().map((target) => [
      target.targetKey,
      target.featureSlotId,
      target.reloadLaneId,
      target.role,
    ]),
    [
      [
        "playerHostVoteResolveRaceReload",
        "player-host-vote-resolve-race-reload",
        "concurrent-player-vote-resolve-race-reload",
        "host",
      ],
      [
        "playerHostActionAdvanceRaceReload",
        "player-host-action-advance-race-reload",
        "concurrent-player-action-advance-race-reload",
        "host",
      ],
      [
        "cohostHostDeadlineResolveRaceReload",
        "cohost-host-deadline-resolve-race-reload",
        "concurrent-cohost-deadline-resolve-race-reload",
        "host",
      ],
    ],
  );

  for (const callerPath of [
    "tools/dev_test_game_hardening_feature_spine_targets.mjs",
    "tools/dev_test_game_hardening_scenarios.mjs",
    "tools/dev_test_game_seed_scenario_cases.mjs",
    "tools/dev_test_game_player_recovery_scenarios.mjs",
    "tools/dev_test_game_proof_contract.mjs",
  ]) {
    const source = await readFile(callerPath, "utf8");
    assert(
      source.includes("./dev_test_game_cross_role_race_scenarios.mjs"),
      `${callerPath} should import cross-role race lanes from the shared scenario module`,
    );
  }
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
    staleSameActionRecoveryLaneId,
    staleActionConflictLaneId,
    stalePlayerActionReconnectLaneId,
    privateChannelStaleActionReconnectLaneId,
  ]);
});

test("hardening lane cases share stale-client reconnect scenarios", async () => {
  assert(Object.isFrozen(staleClientReconnectCaseDefinitions));
  assert.deepEqual(
    staleClientReconnectCases().map((scenario) => ({
      id: scenario.id,
      laneId: scenario.laneId,
      role: scenario.role,
      family: scenario.family,
    })),
    [
      {
        id: "player-live-projection-reconnect",
        laneId: playerLiveReconnectLaneId,
        role: "player",
        family: "live-projection-reconnect",
      },
      {
        id: "replacement-session-reconnect",
        laneId: replacementSessionReconnectLaneId,
        role: "replacement-player",
        family: "replacement-session-reconnect",
      },
      {
        id: "replacement-action-reconnect",
        laneId: replacementActionReconnectLaneId,
        role: "replacement-player",
        family: "replacement-action-reconnect",
      },
      {
        id: "replacement-private-post-reconnect",
        laneId: replacementPrivatePostReconnectLaneId,
        role: "replacement-player",
        family: "replacement-private-channel-reconnect",
      },
      {
        id: "stale-player-action-reconnect",
        laneId: stalePlayerActionReconnectLaneId,
        role: "player",
        family: "stale-player-action-reconnect",
      },
      {
        id: "private-channel-stale-action-reconnect",
        laneId: privateChannelStaleActionReconnectLaneId,
        role: "player",
        family: "private-channel-stale-action-reconnect",
      },
      {
        id: "completed-host-stale-complete-reconnect",
        laneId: completedHostStaleCompleteReconnectLaneId,
        role: "host",
        family: "completed-host-stale-command-reconnect",
      },
      {
        id: "host-stale-resolve-reconnect",
        laneId: hostStaleResolveReconnectLaneId,
        role: "host",
        family: "host-stale-phase-reconnect",
      },
      {
        id: "host-stale-advance-reconnect",
        laneId: hostStaleAdvanceReconnectLaneId,
        role: "host",
        family: "host-stale-phase-reconnect",
      },
      {
        id: "host-stale-deadline-reconnect",
        laneId: hostStaleDeadlineReconnectLaneId,
        role: "host",
        family: "host-stale-deadline-reconnect",
      },
      {
        id: "cohost-stale-deadline-reconnect",
        laneId: cohostStaleDeadlineReconnectLaneId,
        role: "cohost",
        family: "cohost-stale-deadline-reconnect",
      },
    ],
  );
  assert.deepEqual(staleClientReconnectLaneIds(), hostedMatrixReconnectLaneIds);
  assert.deepEqual(
    reconnectHardeningSpineTargetCases().map((target) => ({
      targetKey: target.targetKey,
      featureSlotId: target.featureSlotId,
      laneId: target.laneId,
      role: target.role,
      roleUrlSource: target.roleUrlSource,
      channelId: target.channelId,
    })),
    [
      {
        targetKey: "staleActionReconnectRecovery",
        featureSlotId: "stale-action-reconnect-recovery",
        laneId: stalePlayerActionReconnectLaneId,
        role: "player",
        roleUrlSource: "direct",
        channelId: undefined,
      },
      {
        targetKey: "privateChannelStaleActionReconnectRecovery",
        featureSlotId: "private-channel-stale-action-reconnect-recovery",
        laneId: privateChannelStaleActionReconnectLaneId,
        role: "private-channel",
        roleUrlSource: "direct",
        channelId: "private:mafia_day_chat",
      },
      {
        targetKey: "hostStaleResolveReconnectRecovery",
        featureSlotId: "host-stale-resolve-reconnect-recovery",
        laneId: hostStaleResolveReconnectLaneId,
        role: "host",
        roleUrlSource: "synthesized",
        channelId: undefined,
      },
      {
        targetKey: "hostStaleAdvanceReconnectRecovery",
        featureSlotId: "host-stale-advance-reconnect-recovery",
        laneId: hostStaleAdvanceReconnectLaneId,
        role: "host",
        roleUrlSource: "synthesized",
        channelId: undefined,
      },
      {
        targetKey: "hostStaleDeadlineReconnectRecovery",
        featureSlotId: "host-stale-deadline-reconnect-recovery",
        laneId: hostStaleDeadlineReconnectLaneId,
        role: "host",
        roleUrlSource: "synthesized",
        channelId: undefined,
      },
      {
        targetKey: "cohostStaleDeadlineReconnectRecovery",
        featureSlotId: "cohost-stale-deadline-reconnect-recovery",
        laneId: cohostStaleDeadlineReconnectLaneId,
        role: "host",
        roleUrlSource: "synthesized",
        channelId: undefined,
      },
    ],
  );
  assert.deepEqual(
    {
      laneId: stalePlayerActionReconnectExpectation().laneId,
      rejectError: stalePlayerActionReconnectExpectation().rejectError,
      commandAction: stalePlayerActionReconnectExpectation().commandAction,
      recoveredPhaseId:
        stalePlayerActionReconnectExpectation().recoveredPhaseId,
      recoveredActionCount:
        stalePlayerActionReconnectExpectation().recoveredActionCount,
    },
    {
      laneId: stalePlayerActionReconnectLaneId,
      rejectError: "PhaseLocked",
      commandAction: "submit_action:factional_kill",
      recoveredPhaseId: "D02",
      recoveredActionCount: 0,
    },
  );
  assert.deepEqual(
    {
      laneId: privateChannelStaleActionReconnectExpectation().laneId,
      channelId: privateChannelStaleActionReconnectExpectation().channelId,
      roleUrlFragment:
        privateChannelStaleActionReconnectExpectation().roleUrlFragment,
      privateThreadPagerVisible:
        privateChannelStaleActionReconnectExpectation()
          .privateThreadPagerVisible,
    },
    {
      laneId: privateChannelStaleActionReconnectLaneId,
      channelId: "private:mafia_day_chat",
      roleUrlFragment: "/c/private%3Amafia_day_chat",
      privateThreadPagerVisible: true,
    },
  );
  assert.deepEqual(
    hostStaleReconnectExpectations().map((expectation) => ({
      laneId: expectation.laneId,
      role: expectation.role,
      reconnectingState: expectation.reconnectingState,
      recoveryState: expectation.recoveryState,
      reconnectAttempt: expectation.reconnectAttempt,
      recoveredPhaseId: expectation.recoveredPhaseId,
      recoveredLocked: expectation.recoveredLocked,
      apiDeadline: expectation.apiDeadline,
      phaseActions: expectation.phaseActions,
    })),
    [
      {
        laneId: hostStaleResolveReconnectLaneId,
        role: "host",
        reconnectingState: "reconnecting",
        recoveryState: "recovered",
        reconnectAttempt: 1,
        recoveredPhaseId: "D02",
        recoveredLocked: true,
        apiDeadline: undefined,
        phaseActions: undefined,
      },
      {
        laneId: hostStaleAdvanceReconnectLaneId,
        role: "host",
        reconnectingState: "reconnecting",
        recoveryState: "recovered",
        reconnectAttempt: 1,
        recoveredPhaseId: "D02",
        recoveredLocked: false,
        apiDeadline: undefined,
        phaseActions: undefined,
      },
      {
        laneId: hostStaleDeadlineReconnectLaneId,
        role: "host",
        reconnectingState: "reconnecting",
        recoveryState: "recovered",
        reconnectAttempt: 1,
        recoveredPhaseId: "D02",
        recoveredLocked: false,
        apiDeadline: null,
        phaseActions: undefined,
      },
      {
        laneId: cohostStaleDeadlineReconnectLaneId,
        role: "cohost",
        reconnectingState: "reconnecting",
        recoveryState: "recovered",
        reconnectAttempt: 1,
        recoveredPhaseId: "D02",
        recoveredLocked: false,
        apiDeadline: null,
        phaseActions: [],
      },
    ],
  );

  for (const callerPath of [
    "tools/dev_test_game_hardening_feature_spine_targets.mjs",
    "tools/dev_test_game_hosted_concurrent_race_matrix_cases.mjs",
    "tools/dev_test_game_proof_contract.mjs",
    "tools/dev_test_game_hardening_lane_cases.mjs",
    "frontend/src/lib/app/local-proof-lane-status.mjs",
  ]) {
    const source = await readFile(callerPath, "utf8");
    assert(
      source.includes("./dev_test_game_hardening_recovery_scenarios.mjs") ||
        source.includes(
          "../../../../tools/dev_test_game_hardening_recovery_scenarios.mjs",
        ),
      `${callerPath} should import stale-client reconnect lanes from the hardening recovery scenario module`,
    );
    assert(
      !source.includes("./dev_test_game_stale_client_reconnect_scenarios.mjs") &&
        !source.includes(
          "../../../../tools/dev_test_game_stale_client_reconnect_scenarios.mjs",
        ),
      `${callerPath} should not bypass the hardening recovery facade for reconnect definitions`,
    );
  }
});

test("hardening lane cases derive hosted stale-conflict matrix IDs", () => {
  assert.deepEqual(hostedMatrixStaleConflictLaneIds, [
    ...staleConflictMessageLaneIds,
    "stale-host-control",
  ]);
});

test("hardening lane cases derive hosted matrix reconnect IDs", () => {
  assert.deepEqual(hostedMatrixReconnectLaneIds, [
    playerLiveReconnectLaneId,
    replacementSessionRecoveryLaneIds.at(-1),
    replacementActionReconnectLaneId,
    replacementPrivatePostReconnectLaneId,
    stalePlayerActionReconnectLaneId,
    privateChannelStaleActionReconnectLaneId,
    completedHostStaleCompleteReconnectLaneId,
    hostStaleResolveReconnectLaneId,
    hostStaleAdvanceReconnectLaneId,
    hostStaleDeadlineReconnectLaneId,
    cohostStaleDeadlineReconnectLaneId,
  ]);
});

test("hardening lane cases derive recovery clusters from stale conflict and reconnect cases", () => {
  assert.deepEqual(hardeningRecoveryAuditLaneIds, [
    ...staleConflictMessageLaneIds,
    ...staleClientReconnectLaneIds(),
  ]);
  assert.deepEqual(hardeningRecoveryHighlightedLaneIds, [
    ...hardeningStaleConflictHighlightedLaneIds,
    ...[
      playerLiveReconnectLaneId,
      stalePlayerActionReconnectLaneId,
      privateChannelStaleActionReconnectLaneId,
      completedHostStaleCompleteReconnectLaneId,
      hostStaleResolveReconnectLaneId,
      hostStaleAdvanceReconnectLaneId,
      hostStaleDeadlineReconnectLaneId,
      cohostStaleDeadlineReconnectLaneId,
    ],
  ]);
  assert.deepEqual(hostedMatrixRecoveryLaneIds, [
    ...hostedMatrixReconnectLaneIds,
    ...hostedMatrixStaleConflictLaneIds,
  ]);
});
