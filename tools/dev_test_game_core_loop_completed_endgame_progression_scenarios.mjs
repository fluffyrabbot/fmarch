import {
  assertCompletedGameProofReadinessSurfaceProof,
  completedGameProofReadinessProofScenarioCases,
  completedGameProofReadinessScenarioFamilies,
  completedGameProofReadinessScenarioFamily,
  completedGameProofReadinessTransition,
} from "./dev_test_game_core_loop_completed_game_proof_readiness_contract.mjs";
import {
  completedHostCompleteRaceHardeningLaneCases,
  completedGameHardeningLaneIds,
  completedHostStaleCommandHardeningLaneCases,
  completedPlayerCompleteRaceHardeningLaneCases,
  completedStalePlayerCompleteHardeningLaneCases,
} from "./dev_test_game_core_loop_completed_terminal_scenario_assertions.mjs";

export const coreLoopCompletedEndgameProgressionFamilyId =
  "core-loop-completed-endgame-progression";

export const coreLoopCompletedEndgameProgressionLaneIds = Object.freeze(
  completedGameHardeningLaneIds(),
);

export function coreLoopCompletedEndgameProgressionScenarioFamilies() {
  return completedGameProofReadinessScenarioFamilies();
}

export function coreLoopCompletedEndgameProgressionProofScenarioCases({
  actionPlayerRoleUrl,
  normalPlayerRoleUrl,
  deadPlayerRoleUrl,
  commandStateBuilders,
  scenarioFamilies = coreLoopCompletedEndgameProgressionScenarioFamilies(),
}) {
  return completedGameProofReadinessProofScenarioCases({
    actionPlayerRoleUrl,
    normalPlayerRoleUrl,
    deadPlayerRoleUrl,
    commandStateBuilders,
    scenarioFamilies,
  });
}

export function assertCoreLoopCompletedEndgameProgressionSurfaceProof({
  scenarioFamilies = coreLoopCompletedEndgameProgressionScenarioFamilies(),
  ...proofArgs
}) {
  assertCompletedGameProofReadinessSurfaceProof({
    ...proofArgs,
    scenarioFamilies,
  });
}

export function coreLoopCompletedGameHardeningLaneDescriptors({ hardening }) {
  const lanesById = new Map(
    [
      ...completedHostStaleCompleteProofLaneDescriptors({ hardening }),
      ...completedHostCompleteRaceProofLaneDescriptors({ hardening }),
      ...completedPlayerCompleteRaceProofLaneDescriptors({ hardening }),
      ...completedStalePlayerCompleteProofLaneDescriptors({ hardening }),
    ].map((completedLane) => [completedLane.id, completedLane]),
  );
  return completedGameHardeningLaneIds().map((id) => {
    const completedLane = lanesById.get(id);
    if (completedLane === undefined) {
      throw new Error(`completed-game proof lane builder missing: ${id}`);
    }
    return completedLane;
  });
}

export function completedHostStaleCompleteProofLaneDescriptors({ hardening }) {
  const [rejectLane, reloadLane, reconnectLane] =
    completedHostStaleCommandHardeningLaneCases();
  return [
    completedGameLaneDescriptor(rejectLane, {
      game: hardening.staleHostComplete?.game ?? null,
      rejectError: hardening.staleHostComplete?.reject?.error ?? null,
      liveCompleteSeqs:
        hardening.staleHostComplete?.liveComplete?.commandStatus?.streamSeqs ?? null,
      revealTextAfterReject:
        hardening.staleHostComplete?.revealTextAfterReject ?? null,
      roleActionsAfterReject:
        hardening.staleHostComplete?.roleActionsAfterReject ?? null,
      apiCompleted:
        hardening.staleHostComplete?.apiStateAfterReject?.completed ?? null,
      apiRevealedSlots:
        hardening.staleHostComplete?.apiStateAfterReject?.slots?.filter(
          (slot) => slot.role_revealed === true && slot.alignment_revealed === true,
        ).length ?? null,
      passed:
        hardening.staleHostComplete?.status === "passed" &&
        typeof hardening.staleHostComplete?.game === "string" &&
        hardening.staleHostComplete.game.length > 0 &&
        hardening.staleHostComplete?.setup?.roleActions?.includes("complete_game") ===
          true &&
        hardening.staleHostComplete?.setup?.slots?.length === 1 &&
        hardening.staleHostComplete?.setup?.slots?.every(
          (slot) => slot.role_revealed === false && slot.alignment_revealed === false,
        ) === true &&
        hardening.staleHostComplete?.liveComplete?.commandStatus?.state === "ack" &&
        Array.isArray(
          hardening.staleHostComplete?.liveComplete?.commandStatus?.streamSeqs,
        ) &&
        hardening.staleHostComplete.liveComplete.commandStatus.streamSeqs.length ===
          1 &&
        hardening.staleHostComplete?.reject?.state === "reject" &&
        hardening.staleHostComplete?.reject?.error === "GameAlreadyCompleted" &&
        hardening.staleHostComplete?.reject?.serverEnvelope?.body?.kind ===
          "Reject" &&
        Array.isArray(hardening.staleHostComplete?.reject?.streamSeqs) === false &&
        hardening.staleHostComplete?.slotsAfterReject?.length === 1 &&
        hardening.staleHostComplete?.slotsAfterReject?.every(
          (slot) => slot.role_revealed === true && slot.alignment_revealed === true,
        ) === true &&
        hardening.staleHostComplete?.revealTextAfterReject ===
          "All 1 slots revealed" &&
        hardening.staleHostComplete?.activityRow?.source === "outcome" &&
        hardening.staleHostComplete?.activityRow?.actionId === "complete_game" &&
        hardening.staleHostComplete?.activityRow?.dispatchKind ===
          "complete_game" &&
        hardening.staleHostComplete?.dispatchPlan?.projectionRefreshKeys?.includes(
          "host",
        ) === true &&
        hardening.staleHostComplete?.roleActionsAfterReject?.includes(
          "complete_game",
        ) === false &&
        hardening.staleHostComplete?.apiStateAfterReject?.completed === true &&
        hardening.staleHostComplete?.apiStateAfterReject?.slots?.length === 1 &&
        hardening.staleHostComplete?.apiStateAfterReject?.slots?.every(
          (slot) => slot.role_revealed === true && slot.alignment_revealed === true,
        ) === true,
    }),
    completedGameLaneDescriptor(
      reloadLane,
      {
        game: hardening.staleHostComplete?.game ?? null,
        routeStatus:
          hardening.staleHostComplete?.staleHostReloadAfterReject
            ?.routeResponseStatus ?? null,
        rejectReceipt:
          hardening.staleHostComplete?.staleHostReloadAfterReject
            ?.rejectReceiptStatusText ?? null,
        revealedSlots:
          hardening.staleHostComplete?.staleHostReloadAfterReject
            ?.slotsAfterReload?.filter(
              (slot) =>
                slot.role_revealed === true && slot.alignment_revealed === true,
            ).length ?? null,
        completeActionVisible:
          hardening.staleHostComplete?.staleHostReloadAfterReject
            ?.roleActionsAfterReload?.includes("complete_game") ?? null,
        passed:
          hardening.staleHostComplete?.status === "passed" &&
          hardening.staleHostComplete?.reject?.error === "GameAlreadyCompleted" &&
          hardening.staleHostComplete?.staleHostReloadAfterReject?.status ===
            "passed" &&
          hardening.staleHostComplete?.staleHostReloadAfterReject
            ?.routeResponseStatus === 200 &&
          hardening.staleHostComplete?.staleHostReloadAfterReject
            ?.rejectReceiptStatusText?.includes("Reject GameAlreadyCompleted") ===
            true &&
          hardening.staleHostComplete?.staleHostReloadAfterReject?.surfaceText?.includes(
            "All 1 slots revealed",
          ) === true &&
          hardening.staleHostComplete?.staleHostReloadAfterReject
            ?.slotsAfterReload?.length === 1 &&
          hardening.staleHostComplete?.staleHostReloadAfterReject
            ?.slotsAfterReload?.every(
              (slot) =>
                slot.role_revealed === true && slot.alignment_revealed === true,
            ) === true &&
          hardening.staleHostComplete?.staleHostReloadAfterReject
            ?.revealTextAfterReload?.includes("All 1 slots revealed") === true &&
          hardening.staleHostComplete?.staleHostReloadAfterReject
            ?.roleActionsAfterReload?.includes("complete_game") === false &&
          hardening.staleHostComplete?.staleHostReloadAfterReject
            ?.apiStateAfterReload?.completed === true &&
          hardening.staleHostComplete?.staleHostReloadAfterReject
            ?.apiStateAfterReload?.slots?.length === 1 &&
          hardening.staleHostComplete?.staleHostReloadAfterReject
            ?.apiStateAfterReload?.slots?.every(
              (slot) =>
                slot.role_revealed === true && slot.alignment_revealed === true,
            ) === true,
      },
    ),
    completedGameLaneDescriptor(
      reconnectLane,
      {
        game: hardening.staleHostComplete?.game ?? null,
        reconnectingState:
          hardening.staleHostComplete?.reconnectAfterReject?.reconnectingStatus
            ?.state ?? null,
        recoveryState:
          hardening.staleHostComplete?.reconnectAfterReject?.reconnectRecoveryEvent
            ?.state ?? null,
        recoveredCompleted:
          hardening.staleHostComplete?.reconnectAfterReject
            ?.recoveredHostProjection?.completed ?? null,
        revealedSlots:
          hardening.staleHostComplete?.reconnectAfterReject
            ?.recoveredHostProjection?.slots?.filter(
              (slot) =>
                slot.role_revealed === true && slot.alignment_revealed === true,
            ).length ?? null,
        completeActionVisible:
          hardening.staleHostComplete?.roleActionsAfterReconnect?.includes(
            "complete_game",
          ) ?? null,
        passed:
          hardening.staleHostComplete?.status === "passed" &&
          hardening.staleHostComplete?.reject?.error === "GameAlreadyCompleted" &&
          hardening.staleHostComplete?.reconnectAfterReject?.status === "passed" &&
          hardening.staleHostComplete?.reconnectAfterReject?.reconnectingStatus
            ?.state === "reconnecting" &&
          hardening.staleHostComplete?.reconnectAfterReject?.reconnectRecoveryEvent
            ?.state === "recovered" &&
          hardening.staleHostComplete?.reconnectAfterReject?.reconnectRecoveryEvent
            ?.attempt === 1 &&
          hardening.staleHostComplete?.reconnectAfterReject
            ?.recoveredHostProjection?.completed === true &&
          hardening.staleHostComplete?.reconnectAfterReject
            ?.recoveredHostProjection?.slots?.length === 1 &&
          hardening.staleHostComplete?.reconnectAfterReject
            ?.recoveredHostProjection?.slots?.every(
              (slot) =>
                slot.role_revealed === true && slot.alignment_revealed === true,
            ) === true &&
          hardening.staleHostComplete?.roleActionsAfterReconnect?.includes(
            "complete_game",
          ) === false,
      },
    ),
  ];
}

export function completedHostCompleteRaceProofLaneDescriptors({ hardening }) {
  const [raceLane, reloadLane] = completedHostCompleteRaceHardeningLaneCases();
  return [
    completedGameLaneDescriptor(raceLane, {
      game: hardening.concurrentHostCompleteRace?.game ?? null,
      ackRaceRole: hardening.concurrentHostCompleteRace?.ackRaceRole ?? null,
      rejectRaceRole: hardening.concurrentHostCompleteRace?.rejectRaceRole ?? null,
      rejectError: hardening.concurrentHostCompleteRace?.reject?.error ?? null,
      apiCompleted:
        hardening.concurrentHostCompleteRace?.apiStateAfterRace?.completed ?? null,
      apiRevealedSlots:
        hardening.concurrentHostCompleteRace?.apiStateAfterRace?.slots?.filter(
          (slot) => slot.role_revealed === true && slot.alignment_revealed === true,
        ).length ?? null,
      passed:
        hardening.concurrentHostCompleteRace?.status === "passed" &&
        hardening.concurrentHostCompleteRace?.setup?.firstRoleActions?.includes(
          "complete_game",
        ) === true &&
        hardening.concurrentHostCompleteRace?.setup?.secondRoleActions?.includes(
          "complete_game",
        ) === true &&
        hardening.concurrentHostCompleteRace?.setup?.firstSlots?.length === 1 &&
        hardening.concurrentHostCompleteRace?.setup?.secondSlots?.length === 1 &&
        hardening.concurrentHostCompleteRace?.setup?.firstSlots?.every(
          (slot) => slot.role_revealed === false && slot.alignment_revealed === false,
        ) === true &&
        hardening.concurrentHostCompleteRace?.setup?.secondSlots?.every(
          (slot) => slot.role_revealed === false && slot.alignment_revealed === false,
        ) === true &&
        hardening.concurrentHostCompleteRace?.setup?.firstRevealText?.includes(
          "0/1 slots revealed",
        ) === true &&
        hardening.concurrentHostCompleteRace?.setup?.secondRevealText?.includes(
          "0/1 slots revealed",
        ) === true &&
        ["first", "second"].includes(
          hardening.concurrentHostCompleteRace?.ackRaceRole,
        ) &&
        ["first", "second"].includes(
          hardening.concurrentHostCompleteRace?.rejectRaceRole,
        ) &&
        hardening.concurrentHostCompleteRace?.ackRaceRole !==
          hardening.concurrentHostCompleteRace?.rejectRaceRole &&
        hardening.concurrentHostCompleteRace?.ack?.state === "ack" &&
        hardening.concurrentHostCompleteRace?.ack?.serverEnvelope?.body?.kind ===
          "Ack" &&
        Array.isArray(hardening.concurrentHostCompleteRace?.ack?.streamSeqs) &&
        hardening.concurrentHostCompleteRace.ack.streamSeqs.length === 1 &&
        hardening.concurrentHostCompleteRace?.reject?.state === "reject" &&
        hardening.concurrentHostCompleteRace?.reject?.error ===
          "GameAlreadyCompleted" &&
        hardening.concurrentHostCompleteRace?.reject?.serverEnvelope?.body?.kind ===
          "Reject" &&
        Array.isArray(hardening.concurrentHostCompleteRace?.reject?.streamSeqs) ===
          false &&
        hardening.concurrentHostCompleteRace?.ack?.commandId !==
          hardening.concurrentHostCompleteRace?.reject?.commandId &&
        hardening.concurrentHostCompleteRace?.ack?.requestEnvelope?.body?.body
          ?.command?.CompleteGame?.game ===
          hardening.concurrentHostCompleteRace?.game &&
        hardening.concurrentHostCompleteRace?.reject?.requestEnvelope?.body?.body
          ?.command?.CompleteGame?.game ===
          hardening.concurrentHostCompleteRace?.game &&
        hardening.concurrentHostCompleteRace?.firstSlotsAfterRace?.length === 1 &&
        hardening.concurrentHostCompleteRace?.secondSlotsAfterRace?.length === 1 &&
        hardening.concurrentHostCompleteRace?.firstSlotsAfterRace?.every(
          (slot) => slot.role_revealed === true && slot.alignment_revealed === true,
        ) === true &&
        hardening.concurrentHostCompleteRace?.secondSlotsAfterRace?.every(
          (slot) => slot.role_revealed === true && slot.alignment_revealed === true,
        ) === true &&
        hardening.concurrentHostCompleteRace?.firstRevealTextAfterRace?.includes(
          "All 1 slots revealed",
        ) === true &&
        hardening.concurrentHostCompleteRace?.secondRevealTextAfterRace?.includes(
          "All 1 slots revealed",
        ) === true &&
        hardening.concurrentHostCompleteRace?.firstRoleActionsAfterRace?.includes(
          "complete_game",
        ) === false &&
        hardening.concurrentHostCompleteRace?.secondRoleActionsAfterRace?.includes(
          "complete_game",
        ) === false &&
        [
          hardening.concurrentHostCompleteRace?.firstActivityStatusText,
          hardening.concurrentHostCompleteRace?.secondActivityStatusText,
        ].some((text) => String(text).includes("Ack")) === true &&
        [
          hardening.concurrentHostCompleteRace?.firstActivityStatusText,
          hardening.concurrentHostCompleteRace?.secondActivityStatusText,
        ].some((text) => String(text).includes("Reject GameAlreadyCompleted")) ===
          true &&
        [
          hardening.concurrentHostCompleteRace?.firstDispatchPlan,
          hardening.concurrentHostCompleteRace?.secondDispatchPlan,
        ].some(
          (plan) => plan?.projectionRefreshKeys?.includes("host") === true,
        ) === true &&
        hardening.concurrentHostCompleteRace?.apiStateAfterRace?.completed === true &&
        hardening.concurrentHostCompleteRace?.apiStateAfterRace?.slots?.length ===
          1 &&
        hardening.concurrentHostCompleteRace?.apiStateAfterRace?.slots?.every(
          (slot) => slot.role_revealed === true && slot.alignment_revealed === true,
        ) === true,
    }),
    completedGameLaneDescriptor(
      reloadLane,
      {
        game: hardening.concurrentHostCompleteRace?.game ?? null,
        firstRouteStatus:
          hardening.concurrentHostCompleteRace?.roleReloadAfterRace
            ?.firstRouteStatus ?? null,
        secondRouteStatus:
          hardening.concurrentHostCompleteRace?.roleReloadAfterRace
            ?.secondRouteStatus ?? null,
        apiCompleted:
          hardening.concurrentHostCompleteRace?.roleReloadAfterRace
            ?.apiStateAfterReload?.completed ?? null,
        firstRevealedSlots:
          hardening.concurrentHostCompleteRace?.roleReloadAfterRace
            ?.firstSlotsAfterReload?.filter(
              (slot) =>
                slot.role_revealed === true && slot.alignment_revealed === true,
            ).length ?? null,
        secondRevealedSlots:
          hardening.concurrentHostCompleteRace?.roleReloadAfterRace
            ?.secondSlotsAfterReload?.filter(
              (slot) =>
                slot.role_revealed === true && slot.alignment_revealed === true,
            ).length ?? null,
        passed:
          hardening.concurrentHostCompleteRace?.status === "passed" &&
          hardening.concurrentHostCompleteRace?.roleReloadAfterRace?.status ===
            "passed" &&
          hardening.concurrentHostCompleteRace?.roleReloadAfterRace
            ?.firstRouteStatus === 200 &&
          hardening.concurrentHostCompleteRace?.roleReloadAfterRace
            ?.secondRouteStatus === 200 &&
          hardening.concurrentHostCompleteRace?.roleReloadAfterRace
            ?.firstSlotsAfterReload?.length === 1 &&
          hardening.concurrentHostCompleteRace?.roleReloadAfterRace
            ?.secondSlotsAfterReload?.length === 1 &&
          hardening.concurrentHostCompleteRace?.roleReloadAfterRace
            ?.firstSlotsAfterReload?.every(
              (slot) =>
                slot.role_revealed === true && slot.alignment_revealed === true,
            ) === true &&
          hardening.concurrentHostCompleteRace?.roleReloadAfterRace
            ?.secondSlotsAfterReload?.every(
              (slot) =>
                slot.role_revealed === true && slot.alignment_revealed === true,
            ) === true &&
          hardening.concurrentHostCompleteRace?.roleReloadAfterRace
            ?.firstRevealTextAfterReload?.includes("All 1 slots revealed") ===
            true &&
          hardening.concurrentHostCompleteRace?.roleReloadAfterRace
            ?.secondRevealTextAfterReload?.includes("All 1 slots revealed") ===
            true &&
          hardening.concurrentHostCompleteRace?.roleReloadAfterRace
            ?.firstRoleActionsAfterReload?.includes("complete_game") === false &&
          hardening.concurrentHostCompleteRace?.roleReloadAfterRace
            ?.secondRoleActionsAfterReload?.includes("complete_game") === false &&
          hardening.concurrentHostCompleteRace?.roleReloadAfterRace
            ?.apiStateAfterReload?.completed === true &&
          hardening.concurrentHostCompleteRace?.roleReloadAfterRace
            ?.apiStateAfterReload?.slots?.length === 1 &&
          hardening.concurrentHostCompleteRace?.roleReloadAfterRace
            ?.apiStateAfterReload?.slots?.every(
              (slot) =>
                slot.role_revealed === true && slot.alignment_revealed === true,
            ) === true,
      },
    ),
  ];
}

export function completedPlayerCompleteRaceProofLaneDescriptors({ hardening }) {
  const [raceLane, reloadLane] = completedPlayerCompleteRaceHardeningLaneCases();
  return [
    completedGameLaneDescriptor(raceLane, {
      game: hardening.concurrentPlayerCompleteRace?.game ?? null,
      postState: hardening.concurrentPlayerCompleteRace?.post?.state ?? null,
      postError: hardening.concurrentPlayerCompleteRace?.post?.error ?? null,
      postSeq: hardening.concurrentPlayerCompleteRace?.postSeq ?? null,
      completeSeq: hardening.concurrentPlayerCompleteRace?.completeSeq ?? null,
      apiCompleted:
        hardening.concurrentPlayerCompleteRace?.apiStateAfterRace?.completed ?? null,
      apiThreadHasPost:
        hardening.concurrentPlayerCompleteRace?.apiThreadHasPost ?? null,
      passed:
        hardening.concurrentPlayerCompleteRace?.status === "passed" &&
        hardening.concurrentPlayerCompleteRace?.setupCommandState?.gameCompleted === false &&
        hardening.concurrentPlayerCompleteRace?.setupCommandState?.actorSlot ===
          "slot-7" &&
        hardening.concurrentPlayerCompleteRace?.setupPostButton?.action ===
          "submit_post" &&
        hardening.concurrentPlayerCompleteRace?.setupPostButton?.disabled === false &&
        hardening.concurrentPlayerCompleteRace?.setupHostActions?.includes(
          "complete_game",
        ) === true &&
        hardening.concurrentPlayerCompleteRace?.setupHostSlots?.length === 1 &&
        hardening.concurrentPlayerCompleteRace?.setupHostSlots?.every(
          (slot) => slot.role_revealed === false && slot.alignment_revealed === false,
        ) === true &&
        hardening.concurrentPlayerCompleteRace?.complete?.state === "ack" &&
        hardening.concurrentPlayerCompleteRace?.complete?.serverEnvelope?.body?.kind ===
          "Ack" &&
        Array.isArray(hardening.concurrentPlayerCompleteRace?.complete?.streamSeqs) &&
        hardening.concurrentPlayerCompleteRace.complete.streamSeqs.length === 1 &&
        hardening.concurrentPlayerCompleteRace?.complete?.requestEnvelope?.body?.body
          ?.command?.CompleteGame?.game ===
          hardening.concurrentPlayerCompleteRace?.game &&
        hardening.concurrentPlayerCompleteRace?.post?.requestEnvelope?.body?.body
          ?.command?.SubmitPost?.body ===
          hardening.concurrentPlayerCompleteRace?.postBody &&
        ((hardening.concurrentPlayerCompleteRace?.post?.state === "ack" &&
          hardening.concurrentPlayerCompleteRace?.post?.serverEnvelope?.body?.kind ===
            "Ack" &&
          Array.isArray(hardening.concurrentPlayerCompleteRace?.post?.streamSeqs) &&
          hardening.concurrentPlayerCompleteRace.post.streamSeqs.length === 1 &&
          hardening.concurrentPlayerCompleteRace.postSeq <
            hardening.concurrentPlayerCompleteRace.completeSeq &&
          hardening.concurrentPlayerCompleteRace?.apiThreadHasPost === true) ||
          (hardening.concurrentPlayerCompleteRace?.post?.state === "reject" &&
            hardening.concurrentPlayerCompleteRace?.post?.error ===
              "GameAlreadyCompleted" &&
            hardening.concurrentPlayerCompleteRace?.post?.serverEnvelope?.body?.kind ===
              "Reject" &&
            Array.isArray(hardening.concurrentPlayerCompleteRace?.post?.streamSeqs) ===
              false &&
            hardening.concurrentPlayerCompleteRace?.apiThreadHasPost === false)) &&
        hardening.concurrentPlayerCompleteRace?.commandStateAfterRace?.gameCompleted ===
          true &&
        hardening.concurrentPlayerCompleteRace?.commandStateAfterRace?.actions?.length ===
          0 &&
        hardening.concurrentPlayerCompleteRace?.commandStateAfterRace?.voteTargets
          ?.length === 0 &&
        hardening.concurrentPlayerCompleteRace?.buttonsAfterRace?.every(
          (button) => button.disabled === true,
        ) === true &&
        hardening.concurrentPlayerCompleteRace?.hostSlotsAfterRace?.length === 1 &&
        hardening.concurrentPlayerCompleteRace?.hostSlotsAfterRace?.every(
          (slot) => slot.role_revealed === true && slot.alignment_revealed === true,
        ) === true &&
        hardening.concurrentPlayerCompleteRace?.apiCommandStateAfterRace
          ?.game_completed === true &&
        hardening.concurrentPlayerCompleteRace?.apiCommandStateAfterRace?.actions
          ?.length === 0 &&
        hardening.concurrentPlayerCompleteRace?.apiCommandStateAfterRace?.vote_targets
          ?.length === 0 &&
        hardening.concurrentPlayerCompleteRace?.apiStateAfterRace?.completed === true &&
        hardening.concurrentPlayerCompleteRace?.apiStateAfterRace?.slots?.length ===
          1 &&
        hardening.concurrentPlayerCompleteRace?.apiStateAfterRace?.slots?.every(
          (slot) => slot.role_revealed === true && slot.alignment_revealed === true,
        ) === true,
    }),
    completedGameLaneDescriptor(reloadLane, {
      game: hardening.concurrentPlayerCompleteRace?.game ?? null,
      routeStatus:
        hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace
          ?.routeResponseStatus ?? null,
      gameCompleted:
        hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace
          ?.recoveredCommandState?.gameCompleted ?? null,
      postState: hardening.concurrentPlayerCompleteRace?.post?.state ?? null,
      reloadPostCount:
        hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace
          ?.reloadPostCount ?? null,
      passed:
        hardening.concurrentPlayerCompleteRace?.status === "passed" &&
        hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace?.status ===
          "passed" &&
        hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace
          ?.routeResponseStatus === 200 &&
        hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace
          ?.threadPagerVisible === true &&
        hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace?.surfaceText?.includes(
          "Endgame",
        ) === true &&
        hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace?.surfaceText?.includes(
          "The game is complete.",
        ) === true &&
        hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace
          ?.recoveredCommandState?.actorSlot === "slot-7" &&
        hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace
          ?.recoveredCommandState?.gameCompleted === true &&
        hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace
          ?.recoveredCommandState?.actions?.length === 0 &&
        hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace
          ?.recoveredCommandState?.voteTargets?.length === 0 &&
        hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace
          ?.recoveredCommandState?.boundary?.includes("game is complete") === true &&
        hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace
          ?.reloadButtons?.some((button) => button.disabled !== true) === false &&
        hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace
          ?.apiCommandStateAfterReload?.game_completed === true &&
        hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace
          ?.apiCommandStateAfterReload?.actions?.length === 0 &&
        hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace
          ?.apiCommandStateAfterReload?.vote_targets?.length === 0 &&
        hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace
          ?.apiStateAfterReload?.completed === true &&
        hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace
          ?.apiStateAfterReload?.slots?.length === 1 &&
        hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace
          ?.apiStateAfterReload?.slots?.every(
            (slot) => slot.role_revealed === true && slot.alignment_revealed === true,
          ) === true &&
        ((hardening.concurrentPlayerCompleteRace?.post?.state === "ack" &&
          hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace
            ?.reloadPostCount === 1 &&
          hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace
            ?.reloadPostVisible === true &&
          hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace
            ?.apiThreadPostCount === 1 &&
          hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace
            ?.reloadThreadPostBodies?.includes(
              hardening.concurrentPlayerCompleteRace?.postBody,
            ) === true &&
          hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace
            ?.apiThreadPostBodiesAfterReload?.includes(
              hardening.concurrentPlayerCompleteRace?.postBody,
            ) === true) ||
          (hardening.concurrentPlayerCompleteRace?.post?.state === "reject" &&
            hardening.concurrentPlayerCompleteRace?.post?.error ===
              "GameAlreadyCompleted" &&
            hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace
              ?.reloadPostCount === 0 &&
            hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace
              ?.reloadPostVisible === false &&
            hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace
              ?.apiThreadPostCount === 0 &&
            hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace
              ?.reloadThreadPostBodies?.includes(
                hardening.concurrentPlayerCompleteRace?.postBody,
              ) === false &&
            hardening.concurrentPlayerCompleteRace?.publicReloadAfterRace
              ?.apiThreadPostBodiesAfterReload?.includes(
                hardening.concurrentPlayerCompleteRace?.postBody,
              ) === false)),
    }),
  ];
}

export function completedStalePlayerCompleteProofLaneDescriptors({ hardening }) {
  const [rejectLane, reloadLane, resyncLane] =
    completedStalePlayerCompleteHardeningLaneCases();
  return [
    completedGameLaneDescriptor(rejectLane, {
      game: hardening.stalePlayerComplete?.game ?? null,
      rejectError: hardening.stalePlayerComplete?.reject?.error ?? null,
      gameCompleted:
        hardening.stalePlayerComplete?.commandStateAfterReject?.gameCompleted ?? null,
      disabledButtons:
        hardening.stalePlayerComplete?.buttonsAfterReject?.filter(
          (button) => button.disabled === true,
        ).length ?? null,
      voteTargetsAfterReject:
        hardening.stalePlayerComplete?.commandStateAfterReject?.voteTargets?.length ?? null,
      passed:
        hardening.stalePlayerComplete?.status === "passed" &&
        typeof hardening.stalePlayerComplete?.game === "string" &&
        hardening.stalePlayerComplete.game.length > 0 &&
        hardening.stalePlayerComplete?.setupCommandState?.gameCompleted === false &&
        hardening.stalePlayerComplete?.setupCommandState?.voteTargets?.some(
          (target) => target.kind === "no_lynch",
        ) &&
        hardening.stalePlayerComplete?.staleVoteButton?.action?.startsWith(
          "submit_vote",
        ) === true &&
        hardening.stalePlayerComplete?.staleVoteButton?.disabled === false &&
        hardening.stalePlayerComplete?.liveComplete?.state === "ack" &&
        hardening.stalePlayerComplete?.reject?.state === "reject" &&
        hardening.stalePlayerComplete?.reject?.error === "GameAlreadyCompleted" &&
        hardening.stalePlayerComplete?.reject?.serverEnvelope?.body?.kind ===
          "Reject" &&
        Array.isArray(hardening.stalePlayerComplete?.reject?.streamSeqs) ===
          false &&
        hardening.stalePlayerComplete?.dispatchPlan?.projectionRefreshKeys?.includes(
          "commandState",
        ) === true &&
        hardening.stalePlayerComplete?.commandStateAfterReject?.gameCompleted ===
          true &&
        hardening.stalePlayerComplete?.commandStateAfterReject?.actions?.length ===
          0 &&
        hardening.stalePlayerComplete?.commandStateAfterReject?.voteTargets?.length ===
          0 &&
        hardening.stalePlayerComplete?.buttonsAfterReject?.every(
          (button) => button.disabled === true,
        ) === true &&
        hardening.stalePlayerComplete?.apiCommandStateAfterReject?.game_completed ===
          true &&
        hardening.stalePlayerComplete?.apiCommandStateAfterReject?.actions?.length ===
          0 &&
        hardening.stalePlayerComplete?.apiCommandStateAfterReject?.vote_targets?.length ===
          0,
    }),
    completedGameLaneDescriptor(
      reloadLane,
      {
        game: hardening.stalePlayerComplete?.game ?? null,
        routeStatus:
          hardening.stalePlayerComplete?.stalePublicReloadAfterReject
            ?.routeResponseStatus ?? null,
        gameCompleted:
          hardening.stalePlayerComplete?.stalePublicReloadAfterReject
            ?.recoveredCommandState?.gameCompleted ?? null,
        currentVote:
          hardening.stalePlayerComplete?.stalePublicReloadAfterReject
            ?.reloadCurrentVote?.hasVote ?? null,
        threadPostCount:
          hardening.stalePlayerComplete?.stalePublicReloadAfterReject
            ?.reloadThreadPostBodies?.length ?? null,
        passed:
          hardening.stalePlayerComplete?.status === "passed" &&
          hardening.stalePlayerComplete?.reject?.error ===
            "GameAlreadyCompleted" &&
          hardening.stalePlayerComplete?.currentVoteAfterReject?.hasVote ===
            "false" &&
          hardening.stalePlayerComplete?.currentVoteAfterReject?.text?.includes(
            "No current vote",
          ) === true &&
          hardening.stalePlayerComplete?.stalePublicReloadAfterReject?.status ===
            "passed" &&
          hardening.stalePlayerComplete?.stalePublicReloadAfterReject
            ?.routeResponseStatus === 200 &&
          hardening.stalePlayerComplete?.stalePublicReloadAfterReject
            ?.threadPagerVisible === true &&
          hardening.stalePlayerComplete?.stalePublicReloadAfterReject
            ?.surfaceText?.includes("Endgame") === true &&
          hardening.stalePlayerComplete?.stalePublicReloadAfterReject
            ?.surfaceText?.includes("The game is complete.") === true &&
          hardening.stalePlayerComplete?.stalePublicReloadAfterReject
            ?.recoveredCommandState?.actorSlot === "slot-7" &&
          hardening.stalePlayerComplete?.stalePublicReloadAfterReject
            ?.recoveredCommandState?.gameCompleted === true &&
          hardening.stalePlayerComplete?.stalePublicReloadAfterReject
            ?.recoveredCommandState?.actions?.length === 0 &&
          hardening.stalePlayerComplete?.stalePublicReloadAfterReject
            ?.recoveredCommandState?.voteTargets?.length === 0 &&
          hardening.stalePlayerComplete?.stalePublicReloadAfterReject
            ?.recoveredCommandState?.boundary?.includes("game is complete") ===
            true &&
          hardening.stalePlayerComplete?.stalePublicReloadAfterReject
            ?.reloadButtons?.some((button) => button.disabled !== true) ===
            false &&
          hardening.stalePlayerComplete?.stalePublicReloadAfterReject
            ?.reloadCurrentVote?.hasVote === "false" &&
          hardening.stalePlayerComplete?.stalePublicReloadAfterReject
            ?.reloadCurrentVote?.text?.includes("No current vote") === true &&
          hardening.stalePlayerComplete?.stalePublicReloadAfterReject
            ?.reloadThreadPostBodies?.length === 0 &&
          hardening.stalePlayerComplete?.stalePublicReloadAfterReject
            ?.apiCommandStateAfterReload?.game_completed === true &&
          hardening.stalePlayerComplete?.stalePublicReloadAfterReject
            ?.apiCommandStateAfterReload?.actions?.length === 0 &&
          hardening.stalePlayerComplete?.stalePublicReloadAfterReject
            ?.apiCommandStateAfterReload?.vote_targets?.length === 0 &&
          hardening.stalePlayerComplete?.stalePublicReloadAfterReject
            ?.apiThreadPostBodiesAfterReload?.length === 0 &&
          hardening.stalePlayerComplete?.stalePublicReloadAfterReject
            ?.apiStateAfterReload?.completed === true &&
          hardening.stalePlayerComplete?.stalePublicReloadAfterReject
            ?.apiStateAfterReload?.slots?.length === 1 &&
          hardening.stalePlayerComplete?.stalePublicReloadAfterReject
            ?.apiStateAfterReload?.slots?.every(
              (slot) =>
                slot.role_revealed === true && slot.alignment_revealed === true,
            ) === true,
      },
    ),
    completedGameLaneDescriptor(resyncLane, {
      game: hardening.stalePlayerComplete?.game ?? null,
      resyncFromSeq:
        hardening.stalePlayerComplete?.manualEndgameResync?.fromSeq ?? null,
      resyncKeys: hardening.stalePlayerComplete?.resyncKeysAfterReject ?? null,
      summaryCompleted:
        hardening.stalePlayerComplete?.manualEndgameResync
          ?.snapshotEndgameSummary?.completed ?? null,
      summaryState:
        hardening.stalePlayerComplete?.manualEndgameResync?.surface?.state ?? null,
      passed:
        hardening.stalePlayerComplete?.status === "passed" &&
        hardening.stalePlayerComplete?.resyncKeysAfterReject?.includes(
          "endgameSummary",
        ) === true &&
        hardening.stalePlayerComplete?.manualEndgameResync?.fromSeq === 0 &&
        hardening.stalePlayerComplete?.manualEndgameResync
          ?.snapshotEndgameSummary?.completed === true &&
        hardening.stalePlayerComplete?.manualEndgameResync
          ?.snapshotEndgameSummary?.slots?.some(
            (slot) =>
              slot.slotId === "slot-7" &&
              slot.roleKey === "godfather" &&
              slot.alignment === "mafia" &&
              slot.roleRevealed === true &&
              slot.alignmentRevealed === true,
          ) === true &&
        hardening.stalePlayerComplete?.manualEndgameResync?.surface?.state ===
          "revealed" &&
        hardening.stalePlayerComplete?.manualEndgameResync?.surface?.revealRows?.some(
          (row) =>
            row.testId === "player-endgame-reveal-slot-7" &&
            row.text.includes("Godfather") &&
            row.text.includes("Mafia"),
        ) === true,
    }),
  ];
}

function completedGameLaneDescriptor(scenario, evidence) {
  return {
    id: scenario.id,
    label: scenario.label,
    evidence,
  };
}

export function coreLoopCompletedEndgameProgressionTransition({
  scenarioFamilies = coreLoopCompletedEndgameProgressionScenarioFamilies(),
} = {}) {
  return completedGameProofReadinessTransition({ scenarioFamilies });
}

export function coreLoopCompletedEndgameProgressionScenarioFamily({
  scenarioFamilies = coreLoopCompletedEndgameProgressionScenarioFamilies(),
} = {}) {
  const family = completedGameProofReadinessScenarioFamily({ scenarioFamilies });
  return {
    ...family,
    id: coreLoopCompletedEndgameProgressionFamilyId,
    laneIds: [...coreLoopCompletedEndgameProgressionLaneIds],
  };
}
