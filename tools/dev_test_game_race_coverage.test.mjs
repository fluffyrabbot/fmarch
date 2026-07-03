import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  completedGameRaceCoverageCellCases,
  completedGameRaceCoverageCellDefinitions,
} from "./dev_test_game_core_loop_completed_scenarios.mjs";
import {
  cohostHostRaceCoverageCellCases,
  cohostHostRaceCoverageCellDefinitions,
  playerHostRaceCoverageCellCases,
  playerHostRaceCoverageCellDefinitions,
} from "./dev_test_game_cross_role_race_scenarios.mjs";
import {
  hostPhaseRaceCoverageCellCases,
  hostPhaseRaceCoverageCellDefinitions,
  hostStandaloneRaceCoverageCellCases,
  hostStandaloneRaceCoverageCellDefinitions,
} from "./dev_test_game_host_stale_control_scenarios.mjs";
import {
  cohostDeadlineRaceCoveragePromotedReloadGroup,
  completedHostRaceCoveragePromotedReloadGroup,
  completedPlayerRaceCoveragePromotedReloadGroup,
  raceCoverageLocalReadinessMilestoneCases,
  raceCoverageLocalReadinessMilestoneDefinitions,
  raceCoveragePromotedReloadGroup,
  raceCoveragePromotedReloadGroups,
  replacementRaceCoveragePromotedReloadGroup,
} from "./dev_test_game_race_coverage.mjs";

test("race coverage imports host phase race cells from shared scenarios", () => {
  assert(Object.isFrozen(hostPhaseRaceCoverageCellDefinitions));
  assert.deepEqual(
    hostPhaseRaceCoverageCellCases().map((cell) => ({
      id: cell.id,
      raceLaneId: cell.raceLaneId,
      reloadLaneId: cell.reloadLaneId,
      roleSurfaces: cell.roleSurfaces,
      commandFacts: cell.commandFacts,
    })),
    [
      {
        id: "host-resolve",
        raceLaneId: "concurrent-host-resolve-race",
        reloadLaneId: "concurrent-host-resolve-race-reload",
        roleSurfaces: ["host"],
        commandFacts: [
          { actionId: "resolve_phase", commandKind: "ResolvePhase" },
        ],
      },
      {
        id: "host-advance",
        raceLaneId: "concurrent-host-advance-race",
        reloadLaneId: "concurrent-host-advance-race-reload",
        roleSurfaces: ["host"],
        commandFacts: [
          { actionId: "advance_phase", commandKind: "AdvancePhase" },
        ],
      },
      {
        id: "host-deadline-advance",
        raceLaneId: "concurrent-host-deadline-advance-race",
        reloadLaneId: "concurrent-host-deadline-advance-race-reload",
        roleSurfaces: ["host"],
        commandFacts: [
          {
            actionId: "advance_phase_by_deadline",
            commandKind: "AdvancePhaseByDeadline",
          },
        ],
      },
      {
        id: "host-mixed-advance",
        raceLaneId: "concurrent-host-mixed-advance-race",
        reloadLaneId: "concurrent-host-mixed-advance-race-reload",
        roleSurfaces: ["host"],
        commandFacts: [
          { actionId: "advance_phase", commandKind: "AdvancePhase" },
          {
            actionId: "advance_phase_by_deadline",
            commandKind: "AdvancePhaseByDeadline",
          },
        ],
      },
    ],
  );
  assert.notEqual(
    hostPhaseRaceCoverageCellCases()[0],
    hostPhaseRaceCoverageCellDefinitions[0],
  );
  assert.notEqual(
    hostPhaseRaceCoverageCellCases()[0].commandFacts,
    hostPhaseRaceCoverageCellDefinitions[0].commandFacts,
  );
});

test("race coverage imports standalone host race cells from shared scenarios", async () => {
  assert(Object.isFrozen(hostStandaloneRaceCoverageCellDefinitions));
  assert.deepEqual(
    hostStandaloneRaceCoverageCellCases().map((cell) => ({
      id: cell.id,
      raceLaneId: cell.raceLaneId,
      reloadLaneId: cell.reloadLaneId,
      roleSurfaces: cell.roleSurfaces,
      commandFacts: cell.commandFacts,
    })),
    [
      {
        id: "host-votecount-publication",
        raceLaneId: "concurrent-host-publish-race",
        reloadLaneId: "concurrent-host-publish-race-reload",
        roleSurfaces: ["host", "player"],
        commandFacts: [],
      },
      {
        id: "host-lifecycle",
        raceLaneId: "concurrent-host-lifecycle-race",
        reloadLaneId: "concurrent-host-lifecycle-race-reload",
        roleSurfaces: ["host"],
        commandFacts: [],
      },
    ],
  );
  assert.notEqual(
    hostStandaloneRaceCoverageCellCases()[0],
    hostStandaloneRaceCoverageCellDefinitions[0],
  );

  const source = await readFile("tools/dev_test_game_race_coverage.mjs", "utf8");
  assert(
    importsFromModule({
      source,
      importedName: "hostStandaloneRaceCoverageCellCases",
      moduleSpecifier: "./dev_test_game_host_stale_control_scenarios.mjs",
    }),
    "race coverage should import standalone host race cells from the shared scenario module",
  );
  assert(
    !source.includes('commandFamily: "host lifecycle controls"') &&
      !source.includes(
        'commandFamily: "official votecount publication"',
      ),
    "race coverage should not locally own standalone host race cells",
  );
});

test("race coverage imports cross-role race cells from shared scenarios", async () => {
  assert(Object.isFrozen(playerHostRaceCoverageCellDefinitions));
  assert(Object.isFrozen(cohostHostRaceCoverageCellDefinitions));
  assert.deepEqual(
    [
      ...playerHostRaceCoverageCellCases(),
      ...cohostHostRaceCoverageCellCases(),
    ].map((cell) => ({
      id: cell.id,
      raceLaneId: cell.raceLaneId,
      reloadLaneId: cell.reloadLaneId,
      actorPair: cell.actorPair,
      commandFamily: cell.commandFamily,
      roleSurfaces: cell.roleSurfaces,
      commandFacts: cell.commandFacts,
    })),
    [
      {
        id: "player-vote-vs-host-resolve",
        raceLaneId: "concurrent-player-vote-resolve-race",
        reloadLaneId: "concurrent-player-vote-resolve-race-reload",
        actorPair: "player vs host",
        commandFamily: "vote resolution",
        roleSurfaces: ["player", "host"],
        commandFacts: [],
      },
      {
        id: "player-action-vs-host-advance",
        raceLaneId: "concurrent-player-action-advance-race",
        reloadLaneId: "concurrent-player-action-advance-race-reload",
        actorPair: "player vs host",
        commandFamily: "action submission and phase advance",
        roleSurfaces: ["player", "host"],
        commandFacts: [],
      },
      {
        id: "cohost-deadline-vs-host-resolve",
        raceLaneId: "concurrent-cohost-deadline-resolve-race",
        reloadLaneId: "concurrent-cohost-deadline-resolve-race-reload",
        actorPair: "cohost vs host",
        commandFamily: "deadline and resolution",
        roleSurfaces: ["cohost", "host"],
        commandFacts: [],
      },
    ],
  );
  assert.notEqual(
    playerHostRaceCoverageCellCases()[0],
    playerHostRaceCoverageCellDefinitions[0],
  );

  const source = await readFile("tools/dev_test_game_race_coverage.mjs", "utf8");
  assert(
    importsFromModule({
      source,
      importedName: "playerHostRaceCoverageCellCases",
      moduleSpecifier: "./dev_test_game_cross_role_race_scenarios.mjs",
    }) &&
      importsFromModule({
        source,
        importedName: "cohostHostRaceCoverageCellCases",
        moduleSpecifier: "./dev_test_game_cross_role_race_scenarios.mjs",
      }),
    "race coverage should import cross-role race cells from the shared scenario module",
  );
  for (const commandFamily of [
    'commandFamily: "vote resolution"',
    'commandFamily: "action submission and phase advance"',
    'commandFamily: "deadline and resolution"',
  ]) {
    assert(
      !source.includes(commandFamily),
      `race coverage should not locally own ${commandFamily}`,
    );
  }
});

test("race coverage imports completed-game cells from shared scenarios", () => {
  assert(Object.isFrozen(completedGameRaceCoverageCellDefinitions));
  assert.deepEqual(
    completedGameRaceCoverageCellCases().map((cell) => ({
      id: cell.id,
      raceLaneId: cell.raceLaneId,
      reloadLaneId: cell.reloadLaneId,
      proofGroup: cell.proofGroup,
      promotedReloadGroupId: cell.promotedReloadGroupId,
      roleSurfaces: cell.roleSurfaces,
    })),
    [
      {
        id: "host-complete-game",
        raceLaneId: "concurrent-host-complete-race",
        reloadLaneId: "concurrent-host-complete-race-reload",
        proofGroup: "host-complete-race",
        promotedReloadGroupId: "host-concurrent-race-reload",
        roleSurfaces: ["host", "player"],
      },
      {
        id: "player-vs-completed-game",
        raceLaneId: "concurrent-player-complete-race",
        reloadLaneId: "public-player-complete-reload",
        proofGroup: "player-complete-race",
        promotedReloadGroupId: "player-concurrent-action-reload",
        roleSurfaces: ["player", "host"],
      },
    ],
  );
  assert.notEqual(
    completedGameRaceCoverageCellCases()[0],
    completedGameRaceCoverageCellDefinitions[0],
  );
  assert.notEqual(
    completedGameRaceCoverageCellCases()[0].roleSurfaces,
    completedGameRaceCoverageCellDefinitions[0].roleSurfaces,
  );
  assert.equal(
    completedHostRaceCoveragePromotedReloadGroup().id,
    "host-concurrent-race-reload",
  );
  assert.equal(
    completedPlayerRaceCoveragePromotedReloadGroup().id,
    "player-concurrent-action-reload",
  );
});

function importsFromModule({ source, importedName, moduleSpecifier }) {
  const importPattern = new RegExp(
    `import\\s*\\{([^}]*)\\}\\s*from\\s*"${escapeRegExp(moduleSpecifier)}";`,
    "g",
  );
  return Array.from(source.matchAll(importPattern)).some((match) =>
    match[1]
      .split(",")
      .map((entry) => entry.trim())
      .some((entry) =>
        new RegExp(`\\b${escapeRegExp(importedName)}\\b`).test(entry),
      ),
  );
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("race coverage exposes promoted reload groups from one contract", () => {
  assert.deepEqual(
    raceCoveragePromotedReloadGroups.map((group) => ({
      id: group.id,
      label: group.label,
      cellIds: [...group.cellIds],
    })),
    [
      {
        id: "replacement-race-reload",
        label: "Replacement race reload",
        cellIds: [
          "replacement-private-post",
          "replacement-vote",
          "replacement-action",
        ],
      },
      {
        id: "host-concurrent-race-reload",
        label: "Host concurrent race reload",
        cellIds: [
          "host-resolve",
          "host-advance",
          "host-deadline-advance",
          "host-lifecycle",
          "host-mixed-advance",
          "host-votecount-publication",
          "host-complete-game",
        ],
      },
      {
        id: "player-concurrent-action-reload",
        label: "Player concurrent action reload",
        cellIds: [
          "player-vote-change",
          "player-night-action",
          "player-vote-vs-host-resolve",
          "player-action-vs-host-advance",
          "player-vs-completed-game",
        ],
      },
      {
        id: "cohost-deadline-race-reload",
        label: "Cohost deadline race reload",
        cellIds: ["cohost-deadline-vs-host-resolve"],
      },
    ],
  );
  assert.equal(
    replacementRaceCoveragePromotedReloadGroup().id,
    "replacement-race-reload",
  );
  assert.equal(
    cohostDeadlineRaceCoveragePromotedReloadGroup().id,
    "cohost-deadline-race-reload",
  );
});

test("race coverage promoted reload groups fail closed for unknown ids", () => {
  assert.throws(
    () => raceCoveragePromotedReloadGroup("missing-group"),
    /unknown race coverage promoted reload group: missing-group/,
  );
});

test("release readiness consumes named race promoted group helpers", async () => {
  const source = await readFile(
    "tools/dev_test_game_release_readiness.mjs",
    "utf8",
  );
  for (const helperName of [
    "replacementRaceCoveragePromotedReloadGroup",
    "completedHostRaceCoveragePromotedReloadGroup",
    "completedPlayerRaceCoveragePromotedReloadGroup",
    "cohostDeadlineRaceCoveragePromotedReloadGroup",
  ]) {
    assert(
      source.includes(helperName),
      `release readiness should consume ${helperName}`,
    );
  }
  for (const groupId of [
    "replacement-race-reload",
    "host-concurrent-race-reload",
    "player-concurrent-action-reload",
    "cohost-deadline-race-reload",
  ]) {
    assert(
      !source.includes(`raceCoveragePromotedReloadGroup("${groupId}")`),
      `release readiness should not duplicate promoted group id ${groupId}`,
    );
  }
});

test("core proof fixture consumes named race promoted group helpers", async () => {
  const source = await readFile("tools/dev_test_game.test.mjs", "utf8");
  assert(
    source.includes("replacementRaceCoveragePromotedReloadGroup"),
    "core proof fixture should consume replacement promoted group helper",
  );
  assert(
    source.includes("cohostDeadlineRaceCoveragePromotedReloadGroup"),
    "core proof fixture should consume cohost deadline promoted group helper",
  );
  for (const groupId of [
    "replacement-race-reload",
    "cohost-deadline-race-reload",
  ]) {
    assert(
      !source.includes(`raceCoveragePromotedReloadGroup("${groupId}")`),
      `core proof fixture should not duplicate promoted group id ${groupId}`,
    );
  }
});

test("race coverage exposes local readiness milestones from promoted groups", () => {
  assert(Object.isFrozen(raceCoverageLocalReadinessMilestoneDefinitions));
  assert.deepEqual(
    raceCoverageLocalReadinessMilestoneCases().map((milestone) => ({
      id: milestone.id,
      groupId: milestone.groupId,
      label: milestone.label,
      proofBoundary: milestone.proofBoundary,
      cellIds: milestone.cellIds,
    })),
    [
      {
        id: "local-host-concurrent-race-reload-milestone",
        groupId: "host-concurrent-race-reload",
        label: "Host concurrent race reload coverage",
        proofBoundary:
          "Local race-coverage proof that host resolve, advance, deadline, lifecycle, mixed advance, votecount publication, and complete-game races all have reload recovery coverage.",
        cellIds: [
          "host-resolve",
          "host-advance",
          "host-deadline-advance",
          "host-lifecycle",
          "host-mixed-advance",
          "host-votecount-publication",
          "host-complete-game",
        ],
      },
      {
        id: "local-player-concurrent-action-reload-milestone",
        groupId: "player-concurrent-action-reload",
        label: "Player concurrent action reload coverage",
        proofBoundary:
          "Local race-coverage proof that player vote changes, night actions, player-vs-host phase races, and completed-game reload recovery all have reload coverage.",
        cellIds: [
          "player-vote-change",
          "player-night-action",
          "player-vote-vs-host-resolve",
          "player-action-vs-host-advance",
          "player-vs-completed-game",
        ],
      },
      {
        id: "local-cohost-deadline-race-reload-milestone",
        groupId: "cohost-deadline-race-reload",
        label: "Cohost deadline race reload coverage",
        proofBoundary:
          "Local race-coverage proof that the cohost deadline extension versus host resolve race has reload recovery coverage.",
        cellIds: ["cohost-deadline-vs-host-resolve"],
      },
    ],
  );
  assert.notEqual(
    raceCoverageLocalReadinessMilestoneCases()[0].cellIds,
    raceCoverageLocalReadinessMilestoneDefinitions[0].cellIds,
  );
});
