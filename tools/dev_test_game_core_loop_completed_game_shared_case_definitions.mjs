import {
  hostAdvancePhaseCommandFacts,
  hostCompleteGameCommandFacts,
  hostResolvePhaseCommandFacts,
} from "./dev_test_game_core_loop_host_phase_scenarios.mjs";

const cloneScenarioCase = (scenario) => ({ ...scenario });
const freezeScenarioCase = (scenario) =>
  Object.freeze(cloneScenarioCase(scenario));
const freezeScenarioCases = (scenarios) =>
  Object.freeze(scenarios.map(freezeScenarioCase));
const freezeLaneCase = (scenario) => Object.freeze(cloneScenarioCase(scenario));
const freezeLaneCases = (scenarios) =>
  Object.freeze(scenarios.map(freezeLaneCase));

export const completedHostStaleCommandCaseDefinitions = Object.freeze([
  Object.freeze({
    proofField: "completedHostStaleResolveRecoveryProof",
    commandId: "completed-host-stale-resolve",
    ...hostResolvePhaseCommandFacts(),
    transitionToken: "host:stale_resolve_phase:reject:GameAlreadyCompleted",
    boundary:
      "Seeded browser completed host stale ResolvePhase rejected into completed host controls.",
  }),
  Object.freeze({
    proofField: "completedHostStaleAdvanceRecoveryProof",
    commandId: "completed-host-stale-advance",
    ...hostAdvancePhaseCommandFacts(),
    transitionToken: "host:stale_advance_phase:reject:GameAlreadyCompleted",
    boundary:
      "Seeded browser completed host stale AdvancePhase rejected into completed host controls.",
  }),
  Object.freeze({
    proofField: "completedHostStaleCompleteRecoveryProof",
    commandId: "completed-host-stale-complete",
    ...hostCompleteGameCommandFacts(),
    transitionToken: "host:stale_complete_game:reject:GameAlreadyCompleted",
    boundary:
      "Seeded browser completed host stale CompleteGame rejected into completed host controls.",
  }),
]);

export function completedHostStaleCommandCases() {
  return freezeScenarioCases(completedHostStaleCommandCaseDefinitions);
}

function completedHostStaleCompleteCommandCaseDefinition() {
  const scenario = completedHostStaleCommandCaseDefinitions.find(
    (candidate) => candidate.commandKind === "CompleteGame",
  );
  if (scenario === undefined) {
    throw new Error("completed host stale CompleteGame scenario is missing");
  }
  return scenario;
}

export function completedHostStaleCommandHardeningLaneCaseDefinitions() {
  completedHostStaleCompleteCommandCaseDefinition();
  return freezeLaneCases([
    {
      id: "stale-host-complete",
      label: "Stale complete-game reveal rejects after live completion",
      family: "completed-host-stale-command",
      seedGroup: "demo-only",
      proofGroup: "stale-host-complete",
      proofStep: "reject",
    },
    {
      id: "stale-host-complete-reload",
      label: "Stale host complete recovery reloads revealed console",
      family: "completed-host-stale-command",
      seedGroup: "required",
      proofGroup: "stale-host-complete",
      proofStep: "reload",
    },
    {
      id: "stale-host-complete-reconnect-recovery",
      label: "Stale host complete recovery reconnects revealed console",
      family: "completed-host-stale-command",
      seedGroup: "required",
      proofGroup: "stale-host-complete",
      proofStep: "reconnect",
    },
  ]);
}

export function completedHostStaleCommandHardeningLaneCases() {
  return completedHostStaleCommandHardeningLaneCaseDefinitions().map(
    cloneScenarioCase,
  );
}

export const completedPlayerReloadCaseDefinitions = Object.freeze([
  Object.freeze({
    proofField: "completedPlayerReloadProof",
    sourceRoleUrlField: "sourceActionPlayerRoleUrl",
    transitionToken: "actionPlayer:reload:complete",
    cookieValue: "fixture-player",
    commandStateKind: "action-player",
    expectedSlot: "slot-7",
    expectedBoundaryText: "completed action-player role URL reloaded",
    principalUserId: "player_mira",
    boundary:
      "Seeded browser completed action-player role URL reloaded into durable endgame controls.",
  }),
  Object.freeze({
    proofField: "completedNormalPlayerReloadProof",
    sourceRoleUrlField: "sourceNormalPlayerRoleUrl",
    transitionToken: "normalPlayer:reload:complete",
    cookieValue: "fixture-normal",
    commandStateKind: "normal-player",
    expectedSlot: "slot-4",
    expectedBoundaryText: "completed normal-player role URL reloaded",
    principalUserId: "player_rowan",
    boundary:
      "Seeded browser completed normal-player role URL reloaded into durable endgame controls.",
  }),
  Object.freeze({
    proofField: "completedDeadPlayerReloadProof",
    sourceRoleUrlField: "sourceDeadPlayerRoleUrl",
    transitionToken: "deadPlayer:reload:complete",
    cookieValue: "fixture-target",
    commandStateKind: "dead-player",
    expectedSlot: "slot-2",
    expectedActorAlive: false,
    expectedActorStatus: "dead",
    expectedBoundaryText: "completed dead-player role URL reloaded",
    principalUserId: "player_ilya",
    boundary:
      "Seeded browser completed dead-player role URL reloaded into durable endgame controls.",
  }),
]);

export function completedPlayerReloadCases() {
  return freezeScenarioCases(completedPlayerReloadCaseDefinitions);
}

export function completedPlayerReloadHardeningLaneCaseDefinitions() {
  if (completedPlayerReloadCaseDefinitions.length === 0) {
    throw new Error("completed player reload scenarios are missing");
  }
  return freezeLaneCases([
    {
      id: "public-player-complete-reload",
      label: "Public player board reloads completed game truth",
      family: "completed-player-reload",
      seedGroup: "required",
      proofGroup: "player-complete-race",
      proofStep: "reload",
    },
    {
      id: "stale-player-complete-reload",
      label: "Stale public player complete recovery reloads completed board",
      family: "completed-player-reload",
      seedGroup: "required",
      proofGroup: "stale-player-complete",
      proofStep: "reload",
    },
  ]);
}

export function completedPlayerReloadHardeningLaneCases() {
  return completedPlayerReloadHardeningLaneCaseDefinitions().map(
    cloneScenarioCase,
  );
}

export const staleCompletedGamePlayerCommandCaseDefinitions = Object.freeze([
  Object.freeze({
    proofField: "staleCompletedVoteRecoveryProof",
    transitionToken: "stale:D05:submit_vote:reject:GameAlreadyCompleted",
    clickedAction: "submit_vote:no_lynch",
    commandKind: "SubmitVote",
    commandSelector: "SubmitVote",
    commandButtonSelector:
      '[data-testid="player-composer"] button[data-action="submit_vote:no_lynch"]',
    setupReadySelector:
      '[data-testid="player-composer"] button[data-action="submit_vote:no_lynch"]',
    rejectedBoundary:
      "Seeded browser GameAlreadyCompleted stale D05 vote refreshed into completed endgame controls.",
    staleBoundary:
      "Seeded browser stale completed-game vote proof opened with old Day 5 no-lynch controls.",
    expectedRefreshKeys: ["votecount", "commandState"],
  }),
  Object.freeze({
    proofField: "staleCompletedPostRecoveryProof",
    transitionToken: "stale:D05:submit_post:reject:GameAlreadyCompleted",
    clickedAction: "submit_post",
    commandKind: "SubmitPost",
    commandSelector: "SubmitPost",
    commandButtonSelector:
      '[data-testid="player-composer"] button[data-action="submit_post"]',
    setupReadySelector:
      '[data-testid="player-composer"] button[data-action="submit_post"]',
    postBody: "Stale completed game proof post",
    rejectedBoundary:
      "Seeded browser GameAlreadyCompleted stale D05 post refreshed into completed endgame controls.",
    staleBoundary:
      "Seeded browser stale completed-game post proof opened with old Day 5 post controls.",
    expectedRefreshKeys: [
      "thread",
      "votecount",
      "commandState",
      "dayVoteOutcomes",
    ],
  }),
]);

export function staleCompletedGamePlayerCommandCases() {
  return freezeScenarioCases(staleCompletedGamePlayerCommandCaseDefinitions);
}

export function staleCompletedGamePlayerCommandHardeningLaneCaseDefinitions() {
  if (staleCompletedGamePlayerCommandCaseDefinitions.length === 0) {
    throw new Error("stale completed-game player command scenarios are missing");
  }
  return freezeLaneCases([
    {
      id: "stale-player-complete",
      label: "Stale player command rejects after live completion",
      family: "completed-player-stale-command",
      seedGroup: "demo-only",
      proofGroup: "stale-player-complete",
      proofStep: "reject",
    },
  ]);
}

export function staleCompletedGamePlayerCommandHardeningLaneCases() {
  return staleCompletedGamePlayerCommandHardeningLaneCaseDefinitions().map(
    cloneScenarioCase,
  );
}

export function completedGameStaleRecoverySpineLaneCase() {
  const cases = completedHostStaleCommandHardeningLaneCases().filter(
    (scenario) =>
      scenario.proofGroup === "stale-host-complete" &&
      scenario.proofStep === "reload",
  );
  if (cases.length !== 1) {
    throw new Error("completed-game stale recovery shared lane drifted");
  }
  return { ...cases[0], role: "host" };
}
