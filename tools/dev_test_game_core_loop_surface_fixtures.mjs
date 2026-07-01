import {
  hostPhaseTransitionActionFixture,
  seededCoreLoopHostSurfaceFixture,
  seededCoreLoopPlayerSurfaceFixture,
  seededCoreLoopRoleUrl,
} from "./dev_test_game_core_loop_proof_fixtures.mjs";

export function postDayThreeResolutionSurfaceFixture({
  game = "00000000-0000-0000-0000-000000000002",
} = {}) {
  const baseRoleUrl = seededCoreLoopRoleUrl({ game });
  return {
    status: "passed",
    sourceHostRoleUrl: seededCoreLoopRoleUrl({ game, suffix: "/host" }),
    sourceActionPlayerRoleUrl: baseRoleUrl,
    sourceTargetRoleUrl: seededCoreLoopRoleUrl({
      game,
      suffix: "?private=notification-1",
    }),
    clickedThroughFromRoleUrl: true,
    transition:
      "target:D03:day_vote -> actionPlayer:D03:privacy -> host:advance_phase:ack:909 -> actionPlayer:N03",
    targetReceiptProof: seededCoreLoopPlayerSurfaceFixture({
      game,
      roleUrlSuffix: "?private=notification-1",
      slotField: "targetSlot",
      slot: "slot-4",
      principalUserId: "player_rowan",
      phaseId: "D03",
      phaseState: "locked",
      actorAlive: false,
      actorStatus: "dead",
      actionState: "disabled:actor is not alive",
      statusText: "Player action unavailable: actor is not alive",
      privateCount: 1,
      privateReceipt: true,
      boundary:
        "Seeded browser target role received day_vote private receipt after D03 resolution.",
      resyncFromSeq: 908,
    }),
    actionPlayerPrivacyProof: seededCoreLoopPlayerSurfaceFixture({
      game,
      slotField: "actionPlayerSlot",
      slot: "slot-7",
      principalUserId: "player_mira",
      phaseId: "D03",
      phaseState: "locked",
      actorAlive: true,
      actorStatus: "alive",
      actionState: "disabled:phase locked",
      statusText: "Player action unavailable: phase locked",
      privateCount: 0,
      privateReceipt: false,
      boundary:
        "Seeded browser action player stayed alive with no target-only D03 receipt after host resolved Day 3.",
      resyncFromSeq: 908,
    }),
    hostAdvanceProof: seededCoreLoopHostSurfaceFixture({
      game,
      setupResyncFromSeq: 908,
      setupPhaseId: "D03",
      setupPhaseState: "locked",
      advanceProof: hostPhaseTransitionActionFixture({
        actionId: "advance_phase",
        commandKind: "AdvancePhase",
        streamSeq: 909,
        phaseId: "N03",
        phaseState: "open",
        deadlineAffordance: "resolve_phase,lock_thread",
        projectionRefreshKeys: [],
        command: {
          game,
        },
      }),
    }),
    actionPlayerNightThreeProof: seededCoreLoopPlayerSurfaceFixture({
      game,
      slotField: "actionPlayerSlot",
      slot: "slot-7",
      principalUserId: "player_mira",
      phaseId: "N03",
      phaseState: "open",
      actorAlive: true,
      actorStatus: "alive",
      actionState: "disabled:no legal action available",
      statusText: "Player action unavailable: no legal action available",
      privateCount: 0,
      privateReceipt: false,
      boundary:
        "Seeded browser action player observed host AdvancePhase from locked D03 into open N03.",
      resyncFromSeq: 909,
    }),
    releaseReady: false,
    productionReady: false,
  };
}
