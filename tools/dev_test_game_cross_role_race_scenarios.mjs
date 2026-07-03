const cloneRaceCoverageCell = (cell) => ({
  ...cell,
  roleSurfaces: [...cell.roleSurfaces],
  commandFacts: cell.commandFacts.map((facts) => ({ ...facts })),
});

export const playerHostRaceCoverageCellDefinitions = Object.freeze([
  Object.freeze({
    id: "player-vote-vs-host-resolve",
    actorPair: "player vs host",
    commandFamily: "vote resolution",
    raceLaneId: "concurrent-player-vote-resolve-race",
    reloadLaneId: "concurrent-player-vote-resolve-race-reload",
    roleSurfaces: Object.freeze(["player", "host"]),
    commandFacts: Object.freeze([]),
  }),
  Object.freeze({
    id: "player-action-vs-host-advance",
    actorPair: "player vs host",
    commandFamily: "action submission and phase advance",
    raceLaneId: "concurrent-player-action-advance-race",
    reloadLaneId: "concurrent-player-action-advance-race-reload",
    roleSurfaces: Object.freeze(["player", "host"]),
    commandFacts: Object.freeze([]),
  }),
]);

export const cohostHostRaceCoverageCellDefinitions = Object.freeze([
  Object.freeze({
    id: "cohost-deadline-vs-host-resolve",
    actorPair: "cohost vs host",
    commandFamily: "deadline and resolution",
    raceLaneId: "concurrent-cohost-deadline-resolve-race",
    reloadLaneId: "concurrent-cohost-deadline-resolve-race-reload",
    roleSurfaces: Object.freeze(["cohost", "host"]),
    commandFacts: Object.freeze([]),
  }),
]);

export function playerHostRaceCoverageCellCases() {
  return playerHostRaceCoverageCellDefinitions.map(cloneRaceCoverageCell);
}

export function playerHostRaceCoverageCellIds() {
  return playerHostRaceCoverageCellCases().map((cell) => cell.id);
}

export function cohostHostRaceCoverageCellCases() {
  return cohostHostRaceCoverageCellDefinitions.map(cloneRaceCoverageCell);
}

export function cohostHostRaceCoverageCellIds() {
  return cohostHostRaceCoverageCellCases().map((cell) => cell.id);
}

export const playerHostRaceLaneIds = Object.freeze(
  playerHostRaceCoverageCellDefinitions.flatMap((cell) => [
    cell.raceLaneId,
    cell.reloadLaneId,
  ]),
);

export const cohostHostRaceLaneIds = Object.freeze(
  cohostHostRaceCoverageCellDefinitions.flatMap((cell) => [
    cell.raceLaneId,
    cell.reloadLaneId,
  ]),
);

export const crossRoleRaceLaneIds = Object.freeze([
  ...playerHostRaceLaneIds,
  ...cohostHostRaceLaneIds,
]);
