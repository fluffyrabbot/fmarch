import {
  completedGameRaceCoverageCellIdsForPromotedGroup,
} from "./dev_test_game_core_loop_completed_scenarios.mjs";
import {
  cohostHostRaceCoverageCellIds,
  playerHostRaceCoverageCellIds,
} from "./dev_test_game_cross_role_race_scenarios.mjs";
import {
  hostPhaseRaceCoverageCellIds,
  hostStandaloneRaceCoverageCellIds,
} from "./dev_test_game_host_stale_recovery_scenarios.mjs";
import {
  devTestGameRaceCoveragePath,
} from "./dev_test_game_adjacent_artifact_paths.mjs";

export { devTestGameRaceCoveragePath };

export const hostLifecycleRaceCoverageCellId = "host-lifecycle";
export const hostVotecountPublicationRaceCoverageCellId =
  "host-votecount-publication";
export const hostPromptSelectionRaceCoverageCellId =
  "host-prompt-selection";

export const raceCoveragePromotedReloadGroups = Object.freeze(
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
        ...hostPhaseRaceCoverageCellIds().filter(
          (id) => id !== "host-mixed-advance",
        ),
        hostLifecycleRaceCoverageCellId,
        "host-mixed-advance",
        ...hostStandaloneRaceCoverageCellIds().filter(
          (id) => id === hostVotecountPublicationRaceCoverageCellId,
        ),
        ...hostStandaloneRaceCoverageCellIds().filter(
          (id) => id === hostPromptSelectionRaceCoverageCellId,
        ),
        ...completedGameRaceCoverageCellIdsForPromotedGroup(
          "host-concurrent-race-reload",
        ),
      ],
    },
    {
      id: "player-concurrent-action-reload",
      label: "Player concurrent action reload",
      cellIds: [
        "player-vote-change",
        "player-night-action",
        ...playerHostRaceCoverageCellIds(),
        ...completedGameRaceCoverageCellIdsForPromotedGroup(
          "player-concurrent-action-reload",
        ),
      ],
    },
    {
      id: "cohost-deadline-race-reload",
      label: "Cohost deadline race reload",
      cellIds: cohostHostRaceCoverageCellIds(),
    },
  ].map((group) =>
    Object.freeze({
      ...group,
      cellIds: Object.freeze([...group.cellIds]),
    }),
  ),
);

export function raceCoveragePromotedReloadGroup(groupId) {
  const group = raceCoveragePromotedReloadGroups.find(
    (candidate) => candidate.id === groupId,
  );
  if (group === undefined) {
    throw new Error(`unknown race coverage promoted reload group: ${groupId}`);
  }
  return group;
}

export function replacementRaceCoveragePromotedReloadGroup() {
  return raceCoveragePromotedReloadGroup("replacement-race-reload");
}

export function cohostDeadlineRaceCoveragePromotedReloadGroup() {
  return raceCoveragePromotedReloadGroup("cohost-deadline-race-reload");
}
