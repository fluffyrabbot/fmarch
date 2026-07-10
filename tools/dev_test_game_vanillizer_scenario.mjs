export const vanillizerRoleActionLaneId = "vanillizer-role-action";

export function vanillizerRoleActionScenario() {
  return Object.freeze({
    laneId: vanillizerRoleActionLaneId,
    label: "Vanillizer role action mutates a target through role URLs",
    phaseId: "N01",
    nextEligiblePhaseId: "N02",
    templateId: "vanillaize",
    actor: Object.freeze({
      principalUserId: "player-vanillizer",
      slotId: "slot_1",
      roleKey: "vanillizer",
    }),
    target: Object.freeze({
      principalUserId: "player-cop",
      slotId: "slot_2",
      initialRoleKey: "cop",
      initialActionTemplateId: "cop_investigate",
      resolvedRoleKey: "vanilla_townie",
    }),
  });
}

export function vanillizerSeedCommandPlan(game) {
  const scenario = vanillizerRoleActionScenario();
  return [
    ["host_h", { CreateGame: { game, pack: "mafiascum" } }],
    ...[
      [scenario.actor.slotId, scenario.actor.principalUserId, scenario.actor.roleKey],
      [
        scenario.target.slotId,
        scenario.target.principalUserId,
        scenario.target.initialRoleKey,
      ],
      ["slot_3", "player-mafia", "mafia_goon"],
      ["slot_4", "player-town", "vanilla_townie"],
    ].flatMap(([slot, user, roleKey]) => [
      ["host_h", { AddSlot: { game, slot } }],
      ["host_h", { AssignSlot: { game, slot, user } }],
      ["host_h", { AssignRole: { game, slot, role_key: roleKey } }],
    ]),
    ["host_h", { StartGame: { game, phase: scenario.phaseId } }],
  ];
}

export function buildVanillizerRoleActionProofFixture(game) {
  const roleCard = (roleKey, name) => ({ roleKey, name });
  const actorAtNextNightCommandState = {
    phase: { phaseId: "N02" },
    role: { key: "vanillizer" },
    actions: [{ templateId: "vanillaize", targetOptions: ["slot_2"] }],
  };
  const resolvedTargetCommandState = {
    phase: { phaseId: "N02" },
    role: { key: "vanilla_townie" },
    actions: [],
  };
  return {
    status: "passed",
    game,
    proof:
      "Seeded Vanillizer, Cop target, and host role URLs prove vanillaize submission, resolution, durable role mutation, and loss of the Cop action at N02.",
    actorRoleUrl: `http://127.0.0.1:5173/g/${game}`,
    targetRoleUrl: `http://127.0.0.1:5173/g/${game}`,
    hostRoleUrl: `http://127.0.0.1:5173/g/${game}/host`,
    actorBefore: {
      commandState: {
        phase: { phaseId: "N01" },
        role: { key: "vanillizer" },
        actions: [{ templateId: "vanillaize", targetOptions: ["slot_2"] }],
      },
      roleCard: roleCard("vanillizer", "Vanillizer"),
    },
    targetBefore: {
      commandState: {
        phase: { phaseId: "N01" },
        role: { key: "cop" },
        actions: [{ templateId: "cop_investigate" }],
      },
      roleCard: roleCard("cop", "Cop"),
    },
    selectedTarget: "slot_2",
    submit: {
      state: "ack",
      requestEnvelope: {
        body: {
          body: {
            command: {
              SubmitAction: {
                actor_slot: "slot_1",
                template_id: "vanillaize",
                targets: ["slot_2"],
              },
            },
          },
        },
      },
    },
    actorAfterSubmit: {
      currentActions: [
        { templateId: "vanillaize", targets: ["slot_2"] },
      ],
    },
    resolveNight: { state: "ack" },
    advanceDay: { state: "ack" },
    resolveDay: { state: "ack" },
    advanceNextNight: { state: "ack" },
    targetAfterResolve: {
      commandState: resolvedTargetCommandState,
      roleCard: roleCard("vanilla_townie", "Vanilla townie"),
    },
    targetAfterReload: {
      commandState: resolvedTargetCommandState,
      roleCard: roleCard("vanilla_townie", "Vanilla townie"),
    },
    actorAtNextNight: { commandState: actorAtNextNightCommandState },
    apiTargetAfterReload: { role_key: "vanilla_townie" },
  };
}

export function vanillizerRoleActionProofPassed(proof, expectedGame = null) {
  const scenario = vanillizerRoleActionScenario();
  const submitted =
    proof?.submit?.requestEnvelope?.body?.body?.command?.SubmitAction;
  return (
    proof?.status === "passed" &&
    typeof proof?.game === "string" &&
    (expectedGame === null || proof.game === expectedGame) &&
    proof?.actorRoleUrl?.includes(`/g/${proof.game}`) === true &&
    proof?.targetRoleUrl?.includes(`/g/${proof.game}`) === true &&
    proof?.hostRoleUrl?.includes(`/g/${proof.game}/host`) === true &&
    proof?.actorBefore?.commandState?.role?.key === scenario.actor.roleKey &&
    proof?.actorBefore?.commandState?.actions?.some(
      (action) =>
        action.templateId === scenario.templateId &&
        action.targetOptions?.includes(scenario.target.slotId),
    ) === true &&
    proof?.actorBefore?.roleCard?.roleKey === scenario.actor.roleKey &&
    proof?.actorBefore?.roleCard?.name === "Vanillizer" &&
    proof?.targetBefore?.commandState?.role?.key ===
      scenario.target.initialRoleKey &&
    proof?.targetBefore?.commandState?.actions?.some(
      (action) => action.templateId === scenario.target.initialActionTemplateId,
    ) === true &&
    proof?.targetBefore?.roleCard?.roleKey === scenario.target.initialRoleKey &&
    proof?.targetBefore?.roleCard?.name === "Cop" &&
    proof?.selectedTarget === scenario.target.slotId &&
    proof?.submit?.state === "ack" &&
    submitted?.actor_slot === scenario.actor.slotId &&
    submitted?.template_id === scenario.templateId &&
    submitted?.targets?.length === 1 &&
    submitted.targets[0] === scenario.target.slotId &&
    proof?.actorAfterSubmit?.currentActions?.some(
      (action) =>
        action.templateId === scenario.templateId &&
        action.targets?.[0] === scenario.target.slotId,
    ) === true &&
    proof?.resolveNight?.state === "ack" &&
    proof?.advanceDay?.state === "ack" &&
    proof?.resolveDay?.state === "ack" &&
    proof?.advanceNextNight?.state === "ack" &&
    proof?.targetAfterResolve?.commandState?.role?.key ===
      scenario.target.resolvedRoleKey &&
    proof?.targetAfterResolve?.roleCard?.roleKey ===
      scenario.target.resolvedRoleKey &&
    proof?.targetAfterResolve?.roleCard?.name === "Vanilla townie" &&
    proof?.targetAfterReload?.commandState?.phase?.phaseId ===
      scenario.nextEligiblePhaseId &&
    proof?.targetAfterReload?.commandState?.role?.key ===
      scenario.target.resolvedRoleKey &&
    proof?.targetAfterReload?.commandState?.actions?.length === 0 &&
    proof?.targetAfterReload?.roleCard?.roleKey ===
      scenario.target.resolvedRoleKey &&
    proof?.targetAfterReload?.roleCard?.name === "Vanilla townie" &&
    proof?.actorAtNextNight?.commandState?.phase?.phaseId ===
      scenario.nextEligiblePhaseId &&
    proof?.actorAtNextNight?.commandState?.role?.key === scenario.actor.roleKey &&
    proof?.actorAtNextNight?.commandState?.actions?.some(
      (action) => action.templateId === scenario.templateId,
    ) === true &&
    proof?.apiTargetAfterReload?.role_key === scenario.target.resolvedRoleKey
  );
}

export function assertVanillizerRoleActionBrowserProof({
  proof,
  expectedGame = null,
  includeEvidenceInError = false,
}) {
  if (!vanillizerRoleActionProofPassed(proof, expectedGame)) {
    const suffix = includeEvidenceInError ? `: ${JSON.stringify(proof)}` : "";
    throw new Error(`vanillizer role action browser proof drifted${suffix}`);
  }
  return proof;
}
