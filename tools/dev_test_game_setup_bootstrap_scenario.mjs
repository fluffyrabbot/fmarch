import { setTimeout as delay } from "node:timers/promises";

export const seededSetupRoster = Object.freeze([
  Object.freeze({
    slot: "slot-7",
    user: "player-mira",
    roleKey: "encryptor",
  }),
  Object.freeze({
    slot: "slot-2",
    user: "player-target",
    roleKey: "vanilla_townie",
  }),
  Object.freeze({
    slot: "slot-3",
    user: "player-seed",
    roleKey: "vanilla_townie",
  }),
  Object.freeze({
    slot: "slot_4",
    user: "player-goon-a",
    roleKey: "mafia_goon",
  }),
  Object.freeze({
    slot: "slot_5",
    user: "player-goon-b",
    roleKey: "vanilla_townie",
  }),
]);

export const setupCommandEvidenceKeys = Object.freeze([
  "addSlot",
  "assignSlot",
  "assignRole",
  "setPostPolicy",
  "startGame",
]);

export const setupCommandEvidenceKindByKey = Object.freeze({
  addSlot: "AddSlot",
  assignSlot: "AssignSlot",
  assignRole: "AssignRole",
  setPostPolicy: "SetPostPolicy",
  startGame: "StartGame",
});

export function seedPreSetupCommandPlanForGame(game) {
  return [["host_h", { CreateGame: { game, pack: "mafiascum" } }]];
}

export function seedSetupCommandPlanForGame(game) {
  return [
    ...seedPreSetupCommandPlanForGame(game),
    ...seededSetupRoster.map((row) => [
      "host_h",
      { AddSlot: { game, slot: row.slot } },
    ]),
    ...seededSetupRoster.flatMap((row) => [
      ["host_h", { AssignSlot: { game, slot: row.slot, user: row.user } }],
      [
        "host_h",
        { AssignRole: { game, slot: row.slot, role_key: row.roleKey } },
      ],
    ]),
    [
      "host_h",
      { SetPostPolicy: { game, channel_id: "main", allow_media_only: true } },
    ],
    [
      "host_h",
      { SetPostPolicy: { game, channel_id: "main", allow_media_only: false } },
    ],
    ["host_h", { StartGame: { game, phase: "D01" } }],
  ];
}

export async function runSeededSetupBootstrapScenario({
  setupPage,
  game,
  frontendBaseUrl,
  bootstrapSession,
  roster = seededSetupRoster,
}) {
  const roleUrl = `${frontendBaseUrl}/g/${game}/setup`;
  await setupPage.getByTestId("host-setup-surface").waitFor({
    state: "visible",
    timeout: 15000,
  });
  await setupPage.getByTestId("host-setup-add-slot-form").waitFor({
    state: "visible",
    timeout: 15000,
  });
  const commands = [];
  for (const row of roster) {
    commands.push(await addSetupSlot({ setupPage, slotId: row.slot }));
  }
  for (const row of roster) {
    commands.push(
      await assignSetupSlot({
        setupPage,
        slotId: row.slot,
        principalUserId: row.user,
      }),
    );
    commands.push(
      await assignSetupRole({
        setupPage,
        slotId: row.slot,
        roleKey: row.roleKey,
      }),
    );
  }
  const policyCommand = await verifyHostSetupPolicyCommandRoundTrip(setupPage);
  commands.push(policyCommand.enabled, policyCommand.restored);
  commands.push(await startSetupGame(setupPage));
  const [readinessSummary, setupState, dispatchPlan, capabilityLabel] =
    await Promise.all([
      setupPage.getByTestId("host-setup-readiness-summary").innerText(),
      setupPage.evaluate(() => window.__fmarchHostSetupState ?? null),
      setupPage.evaluate(
        () => window.__fmarchHostSetupCommandDispatchBridgePlan ?? null,
      ),
      setupPage.getByTestId("host-setup-capability").innerText(),
    ]);
  const slotIds = (setupState?.slots ?? []).map((slot) => slot.slotId);
  const roleAssignments = Object.fromEntries(
    (setupState?.slots ?? []).map((slot) => [slot.slotId, slot.roleKey]),
  );
  if (
    setupPage.url() !== roleUrl ||
    readinessSummary !== "Started at D01" ||
    setupState?.phase?.phaseId !== "D01" ||
    roster.some(
      (row) =>
        !slotIds.includes(row.slot) ||
        roleAssignments[row.slot] !== row.roleKey,
    )
  ) {
    throw new Error(
      `seeded setup bootstrap drifted: ${JSON.stringify({
        url: setupPage.url(),
        expectedUrl: roleUrl,
        readinessSummary,
        phase: setupState?.phase ?? null,
        slotIds,
        roleAssignments,
      })}`,
    );
  }
  return {
    status: "passed",
    proof:
      "Seeded local game bootstrap used the /setup route to add slots, assign occupants, assign roles, round-trip main post policy, and start D01 before gameplay priming.",
    roleUrl,
    sessionPrincipalUserId: bootstrapSession.principalUserId,
    credentialKind: bootstrapSession.credentialKind,
    capabilityLabel,
    readinessSummary,
    phaseId: setupState.phase.phaseId,
    commandCount: commands.length,
    commands,
    slotIds,
    roleAssignments,
    policyCommand,
    setupCommandEvidence: buildSetupBootstrapCommandEvidence({
      commands,
      policyCommand,
    }),
    startDispatchPlan: dispatchPlan,
  };
}

export function buildSetupCommandEvidence({
  addSlot,
  assignSlot,
  assignRole,
  setPostPolicy,
  startGame,
}) {
  return {
    addSlot: compactSetupCommandEvidence(addSlot),
    assignSlot: compactSetupCommandEvidence(assignSlot),
    assignRole: compactSetupCommandEvidence(assignRole),
    setPostPolicy: compactSetupCommandEvidence(setPostPolicy),
    startGame: compactSetupCommandEvidence(startGame),
  };
}

export function buildSetupBootstrapCommandEvidence({ commands, policyCommand }) {
  const commandList = Array.isArray(commands) ? commands : [];
  return buildSetupCommandEvidence({
    addSlot: commandList.find((command) => command?.commandKind === "AddSlot"),
    assignSlot: commandList.find(
      (command) => command?.commandKind === "AssignSlot",
    ),
    assignRole: commandList.find(
      (command) => command?.commandKind === "AssignRole",
    ),
    setPostPolicy:
      policyCommand?.restored ??
      commandList.find((command) => command?.commandKind === "SetPostPolicy"),
    startGame: commandList.find(
      (command) => command?.commandKind === "StartGame",
    ),
  });
}

export function compactSetupCommandEvidence(commandEvidence) {
  if (commandEvidence === null || commandEvidence === undefined) {
    return null;
  }
  return {
    status: commandEvidence.status ?? null,
    commandKind: commandEvidence.commandKind ?? null,
    command: commandEvidence.command ?? null,
    streamSeqs: Array.isArray(commandEvidence.streamSeqs)
      ? [...commandEvidence.streamSeqs]
      : [],
    readinessSummary: commandEvidence.readinessSummary ?? null,
  };
}

export function hasCompleteSetupCommandEvidence(evidence) {
  if (evidence === null || typeof evidence !== "object") {
    return false;
  }
  return setupCommandEvidenceKeys.every((key) => {
    const row = evidence[key];
    return (
      row?.status === "ack" &&
      row?.commandKind === setupCommandEvidenceKindByKey[key] &&
      row?.command !== null &&
      Array.isArray(row?.streamSeqs)
    );
  });
}

export async function addSetupSlot({ setupPage, slotId }) {
  const form = setupPage.getByTestId("host-setup-add-slot-form");
  await form.locator('input[name="slotId"]').fill(slotId);
  await form.getByRole("button", { name: "Add slot" }).click();
  return await waitForHostSetupCommand({
    setupPage,
    statusTestId: "host-setup-add-slot-status",
    commandKind: "AddSlot",
    commandPredicate: (command) => command?.slot === slotId,
    statePredicate: (setupState) =>
      setupState?.slots?.some((slot) => slot.slotId === slotId),
  });
}

export async function assignSetupSlot({
  setupPage,
  slotId,
  principalUserId,
}) {
  const row = setupPage.getByTestId(`host-setup-slot-${slotId}`);
  await row.locator('input[name="principalUserId"]').fill(principalUserId);
  await row.getByRole("button", { name: "Assign", exact: true }).click();
  return await waitForHostSetupCommand({
    setupPage,
    statusTestId: "host-setup-assign-slot-status",
    commandKind: "AssignSlot",
    commandPredicate: (command) =>
      command?.slot === slotId && command?.user === principalUserId,
    statePredicate: (setupState) =>
      setupState?.slots?.some(
        (slot) =>
          slot.slotId === slotId && slot.occupantUserId === principalUserId,
      ),
  });
}

export async function assignSetupRole({ setupPage, slotId, roleKey }) {
  const row = setupPage.getByTestId(`host-setup-role-${slotId}`);
  await row.locator('select[name="roleKey"]').selectOption(roleKey);
  await row.getByRole("button", { name: "Assign role", exact: true }).click();
  return await waitForHostSetupCommand({
    setupPage,
    statusTestId: "host-setup-assign-role-status",
    commandKind: "AssignRole",
    commandPredicate: (command) =>
      command?.slot === slotId && command?.role_key === roleKey,
    statePredicate: (setupState) =>
      setupState?.slots?.some(
        (slot) => slot.slotId === slotId && slot.roleKey === roleKey,
      ),
  });
}

export async function startSetupGame(setupPage) {
  await setupPage.getByTestId("host-setup-start-review").click();
  await setupPage.getByTestId("host-setup-start-confirmation").waitFor({
    state: "visible",
    timeout: 15000,
  });
  await setupPage
    .getByTestId("host-setup-start-confirmation")
    .getByRole("button", { name: "Start game" })
    .click();
  return await waitForHostSetupCommand({
    setupPage,
    statusTestId: "host-setup-start-status",
    commandKind: "StartGame",
    commandPredicate: (command) => command?.phase === "D01",
    statePredicate: (setupState) => setupState?.phase?.phaseId === "D01",
  });
}

export async function waitForHostSetupCommand({
  setupPage,
  statusTestId,
  commandKind,
  expectedState = "ack",
  expectedError = null,
  commandPredicate,
  statePredicate,
}) {
  try {
    await setupPage.waitForFunction(
      ({ commandKind: expectedKind, expectedState }) => {
        const outcome = window.__fmarchHostSetupCommandOutcome;
        if (outcome?.state !== expectedState) {
          return false;
        }
        const command =
          outcome?.requestEnvelope?.body?.body?.command?.[expectedKind];
        return command !== undefined;
      },
      { commandKind, expectedState },
      { timeout: 15000 },
    );
    await setupPage.waitForFunction(
      ({ commandKind: expectedKind, expectedState }) => {
        const outcome = window.__fmarchHostSetupCommandOutcome;
        if (outcome?.state !== expectedState) {
          return false;
        }
        const command =
          outcome?.requestEnvelope?.body?.body?.command?.[expectedKind];
        return command !== undefined && window.__fmarchHostSetupState !== undefined;
      },
      { commandKind, expectedState },
      { timeout: 15000 },
    );
    await setupPage.getByTestId(statusTestId).waitFor({
      state: "visible",
      timeout: 15000,
    });
    await setupPage.waitForFunction(
      ({ statusTestId: expectedTestId, expectedState }) =>
        document
          .querySelector(`[data-testid="${expectedTestId}"]`)
          ?.getAttribute("data-state") === expectedState,
      { statusTestId, expectedState },
      { timeout: 15000 },
    );
  } catch (error) {
    throw new Error(
      `host setup ${commandKind} command wait timed out: ${JSON.stringify({
        statusTestId,
        snapshot: await hostSetupPolicyCommandSnapshot(setupPage),
        error: error instanceof Error ? error.message : String(error),
      })}`,
    );
  }
  let snapshot = null;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const [statusState, statusText, outcome, setupState, readiness] =
      await Promise.all([
        setupPage.getByTestId(statusTestId).getAttribute("data-state"),
        setupPage.getByTestId(statusTestId).innerText(),
        setupPage.evaluate(() => window.__fmarchHostSetupCommandOutcome ?? null),
        setupPage.evaluate(() => window.__fmarchHostSetupState ?? null),
        setupPage.evaluate(() => window.__fmarchHostSetupReadiness ?? null),
      ]);
    const command =
      outcome?.requestEnvelope?.body?.body?.command?.[commandKind] ?? null;
    const settledState = outcome?.state ?? statusState;
    snapshot = {
      statusState,
      settledState,
      statusText,
      expectedState,
      expectedError,
      commandMatches: commandPredicate(command) === true,
      stateMatches: statePredicate(setupState) === true,
      command,
      setupState,
      readiness,
      outcome,
    };
    if (
      snapshot.settledState === expectedState &&
      (expectedError === null || outcome?.error === expectedError) &&
      snapshot.commandMatches === true &&
      snapshot.stateMatches === true
    ) {
      break;
    }
    await delay(50);
  }
  if (
    snapshot?.settledState !== expectedState ||
    (expectedError !== null && snapshot?.outcome?.error !== expectedError) ||
    snapshot?.commandMatches !== true ||
    snapshot?.stateMatches !== true
  ) {
    throw new Error(
      `host setup ${commandKind} command drifted: ${JSON.stringify(snapshot)}`,
    );
  }
  return {
    status: snapshot.settledState,
    statusText: snapshot.statusText,
    commandKind,
    error: snapshot.outcome.error ?? null,
    retryable: snapshot.outcome.retryable ?? false,
    command: snapshot.command,
    streamSeqs: snapshot.outcome.streamSeqs,
    requestEnvelope: snapshot.outcome.requestEnvelope,
    serverEnvelope: snapshot.outcome.serverEnvelope,
    readinessSummary: snapshot.readiness?.summary ?? null,
  };
}

export async function verifyHostSetupPolicyCommandRoundTrip(setupPage) {
  await setupPage.getByRole("button", { name: "Enable media-only" }).click();
  const enabled = await waitForHostSetupPolicyCommand({
    setupPage,
    allowMediaOnly: true,
    expectedPolicyText: "Media-only posts are enabled.",
  });
  await setupPage.getByRole("button", { name: "Disable media-only" }).click();
  const restored = await waitForHostSetupPolicyCommand({
    setupPage,
    allowMediaOnly: false,
    expectedPolicyText: "Media-only posts are disabled.",
  });
  return {
    status: "passed",
    actionId: "set-post-policy",
    commandKind: "SetPostPolicy",
    channelId: "main",
    allowMediaOnlySequence: [true, false],
    finalPolicyText: restored.policyText,
    enabled,
    restored,
  };
}

async function waitForHostSetupPolicyCommand({
  setupPage,
  allowMediaOnly,
  expectedPolicyText,
}) {
  try {
    await setupPage.waitForFunction(
      ({ allowMediaOnly: expected }) =>
        window.__fmarchHostSetupCommandOutcome?.state === "ack" &&
        window.__fmarchHostSetupCommandOutcome?.requestEnvelope?.body?.body
          ?.command?.SetPostPolicy?.allow_media_only === expected &&
        window.__fmarchHostSetupReadiness?.mainPolicy?.allowMediaOnly === expected,
      { allowMediaOnly },
      { timeout: 15000 },
    );
  } catch (error) {
    throw new Error(
      `host setup policy command wait timed out: ${JSON.stringify({
        allowMediaOnly,
        expectedPolicyText,
        snapshot: await hostSetupPolicyCommandSnapshot(setupPage),
        error: error instanceof Error ? error.message : String(error),
      })}`,
    );
  }
  await setupPage
    .getByTestId("host-setup-main-policy")
    .waitFor({ state: "visible", timeout: 15000 });
  const [policyText, statusState, statusText, outcome, readiness] =
    await Promise.all([
      setupPage.getByTestId("host-setup-main-policy").innerText(),
      setupPage.getByTestId("host-setup-policy-status").getAttribute("data-state"),
      setupPage.getByTestId("host-setup-policy-status").innerText(),
      setupPage.evaluate(() => window.__fmarchHostSetupCommandOutcome ?? null),
      setupPage.evaluate(() => window.__fmarchHostSetupReadiness ?? null),
    ]);
  if (
    policyText !== expectedPolicyText ||
    statusState !== "ack" ||
    outcome?.requestEnvelope?.body?.body?.principal_user_id !== "host_h" ||
    outcome?.requestEnvelope?.body?.body?.command?.SetPostPolicy?.channel_id !==
      "main" ||
    outcome?.requestEnvelope?.body?.body?.command?.SetPostPolicy
      ?.allow_media_only !== allowMediaOnly ||
    readiness?.mainPolicy?.allowMediaOnly !== allowMediaOnly
  ) {
    throw new Error(
      `host setup policy command drifted: ${JSON.stringify({
        allowMediaOnly,
        expectedPolicyText,
        policyText,
        statusState,
        statusText,
        outcome,
        readiness,
      })}`,
    );
  }
  return {
    status: statusState,
    commandKind: "SetPostPolicy",
    command:
      outcome.requestEnvelope.body.body.command.SetPostPolicy ?? null,
    policyText,
    statusText,
    streamSeqs: outcome.streamSeqs,
    requestEnvelope: outcome.requestEnvelope,
    serverEnvelope: outcome.serverEnvelope,
    refreshedAllowMediaOnly: readiness.mainPolicy.allowMediaOnly,
    readinessSummary: readiness.summary ?? null,
  };
}

async function hostSetupPolicyCommandSnapshot(setupPage) {
  return await setupPage.evaluate(() => ({
    policyText:
      document.querySelector('[data-testid="host-setup-main-policy"]')?.textContent ??
      null,
    statusState:
      document
        .querySelector('[data-testid="host-setup-policy-status"]')
        ?.getAttribute("data-state") ?? null,
    statusText:
      document.querySelector('[data-testid="host-setup-policy-status"]')?.textContent ??
      null,
    buttonText: Array.from(document.querySelectorAll("button"))
      .map((button) => button.textContent?.trim())
      .filter(Boolean),
    outcome: window.__fmarchHostSetupCommandOutcome ?? null,
    commandStatuses: window.__fmarchHostSetupCommandStatuses ?? null,
    readiness: window.__fmarchHostSetupReadiness ?? null,
  }));
}
