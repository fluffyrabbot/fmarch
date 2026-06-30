import path from "node:path";
import {
  coreLoopHighlightedLaneEvidence,
  coreLoopSpineStatus,
} from "../frontend/src/lib/app/local-proof-lane-status.mjs";
import { assertDevTestGameProofRun } from "./dev_test_game_proof_contract.mjs";
import {
  artifactDir,
  proveAdminAuditDetail,
  readJson,
  repoRoot,
  runAdminAuditProof,
} from "./dev_test_game_admin_audit_proof_helper.mjs";

const proofRunPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_PROOF_RUN ??
    "target/dev-test-game/proof-run.json",
);
const proofRunRelativePath = path.relative(repoRoot, proofRunPath);
const evidencePath = path.join(artifactDir, "core-loop-admin-proof.json");
const requiredChecks = [
  "core-loop-spine",
  "core-loop",
  "day-vote-resolution",
  "day-vote-no-lynch",
  "action-loop",
  "host-deadline-advance",
  "stale-deadline-advance",
  "invalid-action-recovery",
  "resolution-receipts",
  "dead-player-recovery",
  "player-action-boundary",
  "private-channel",
  "host-votecount-publication",
  "host-lifecycle-control",
  "host-modkill-control",
  "replacement-host-issued-invite",
  "replacement-pending-player",
  "replacement-invalid-target-recovery",
  "replacement-console",
  "stale-host-invite-recovery",
  "replacement-stale-success-recovery",
  "replacement-stale-player",
  "replacement-stale-action",
  "replacement-stale-private-channel",
  "replacement-stale-private-receipts",
  "replacement-incoming-player",
];

const requiredSpineRows = (proofRun) => {
  const cycles = Array.isArray(proofRun?.coreLoopSpine?.cycles)
    ? proofRun.coreLoopSpine.cycles
    : [];
  return {
    cycles: cycles.map((cycle) => String(cycle.id)),
    roleUrls: cycles.flatMap((cycle) =>
      Object.keys(cycle.roleUrls ?? {}).map(
        (roleId) => `${String(cycle.id)}-${String(roleId)}`,
      ),
    ),
    roleUrlHrefs: Object.fromEntries(
      cycles.flatMap((cycle) =>
        Object.entries(cycle.roleUrls ?? {}).map(([roleId, href]) => [
          `${String(cycle.id)}-${String(roleId)}`,
          String(href ?? ""),
        ]),
      ),
    ),
    checkpoints: cycles.flatMap((cycle) =>
      (cycle.checkpoints ?? []).map(
        (checkpoint) => `${String(cycle.id)}-${String(checkpoint.id)}`,
      ),
    ),
    recoveryHooks: Object.keys(proofRun?.coreLoopSpine?.recoveryHooks ?? {}),
  };
};

await runAdminAuditProof({
  smokeName: "dev-test-game-core-loop-admin-proof",
  stage: "core-loop-admin-proof-listen",
  evidencePath,
  envOverrides: {
    FMARCH_DEV_TEST_GAME_PROOF_RUN: proofRunRelativePath,
  },
  loadSource: async () => assertDevTestGameProofRun(await readJson(proofRunPath)),
  prove: async ({ browser, frontendBaseUrl, source: proofRun }) => {
    const spineRows = requiredSpineRows(proofRun);
    const adminRoleSurface = await proveAdminAuditDetail({
      browser,
      frontendBaseUrl,
      game: proofRun.session.game,
      auditId: "local-core-loop",
      requiredChecks,
      requiredCheckStatuses: {
        "core-loop-spine": coreLoopSpineStatus(proofRun),
        ...coreLoopHighlightedLaneEvidence(proofRun),
      },
      requiredSpineCycles: spineRows.cycles,
      requiredSpineRoleUrls: spineRows.roleUrls,
      requiredSpineCheckpoints: spineRows.checkpoints,
      requiredSpineRecoveryHooks: spineRows.recoveryHooks,
    });
    const hostRoleSurface = await proveHostLifecycleControlCheckpoint({
      browser,
      frontendBaseUrl,
      game: proofRun.session.game,
      roleUrl: spineRows.roleUrlHrefs["d02-n02-host"],
    });
    const playerRoleSurface = await provePlayerActionSubmissionCheckpoint({
      browser,
      frontendBaseUrl,
      roleUrl: spineRows.roleUrlHrefs["d02-n02-actionPlayer"],
    });
    return { adminRoleSurface, hostRoleSurface, playerRoleSurface };
  },
  buildEvidence: ({ source: proofRun, adminRoleSurface: surfaces }) => ({
    version: 1,
    proof: "dev-test-game-core-loop-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-core-loop-admin-surface",
    proofBoundary:
      "Local SvelteKit admin role URL with fixture admin authority over the dev-test-game core-loop proof-run lanes. Proves the saved host-control, lynch and no-lynch day-vote resolution, player-action, day/night, official-votecount publication, private-channel, replacement, stale outgoing-player recovery, and incoming replacement-player evidence is discoverable from the seeded admin overview and inspectable in a native admin audit detail route; it does not prove hosted deployment, production identity, exhaustive action/race coverage, beta readiness, or production readiness.",
    generatedFrom: {
      proofRun: proofRunRelativePath,
      game: proofRun.session.game,
      coreLoopSpineStatus: coreLoopSpineStatus(proofRun),
      coreLoopSpineRows: requiredSpineRows(proofRun),
      highlightedLaneEvidence: coreLoopHighlightedLaneEvidence(proofRun),
    },
    adminRoleSurface: surfaces.adminRoleSurface,
    hostRoleSurface: surfaces.hostRoleSurface,
    playerRoleSurface: surfaces.playerRoleSurface,
  }),
  assertEvidence: assertCoreLoopAdminProof,
});

async function proveHostLifecycleControlCheckpoint({
  browser,
  frontendBaseUrl,
  game,
  roleUrl,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const visitedRolePath = rolePathFromUrl(roleUrl);
  const commandRequests = [];
  try {
    await installHostLifecycleControlBrowserRoutes(page, { commandRequests });
    await page.context().addCookies([
      {
        name: "fmarch_fixture_session",
        value: "fixture-host",
        url: frontendBaseUrl,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto(`${frontendBaseUrl}${visitedRolePath}`, { waitUntil: "networkidle" });
    await page.getByTestId("host-console-surface").waitFor({
      state: "visible",
      timeout: 15000,
    });
    const checkpoint = page.getByTestId("host-lifecycle-control-checkpoint");
    await checkpoint.waitFor({ state: "visible", timeout: 15000 });
    const proofCheckId = await checkpoint.getAttribute("data-proof-check-id");
    const phaseId = await checkpoint.getAttribute("data-phase-id");
    const phaseState = await checkpoint.getAttribute("data-phase-state");
    const slotId = await checkpoint.getAttribute("data-slot-id");
    const actionState = await checkpoint.getAttribute("data-action-state");
    const deadlineAffordance = await checkpoint.getAttribute(
      "data-deadline-affordance",
    );
    const visibleRows = [];
    for (const [id, testId] of Object.entries({
      phase: "host-lifecycle-control-phase",
      slot: "host-lifecycle-control-slot",
      actionState: "host-lifecycle-control-action-state",
      deadlineAffordance: "host-lifecycle-control-deadline-affordance",
      recovery: "host-lifecycle-control-recovery",
    })) {
      await page.getByTestId(testId).waitFor({ state: "visible", timeout: 15000 });
      visibleRows.push(id);
    }
    const recoveryText = await page
      .getByTestId("host-lifecycle-control-recovery")
      .innerText();
    const statusText = await page
      .getByTestId("host-lifecycle-control-status")
      .innerText();
    const bodyText = await page.locator("body").innerText();
    if (/invite=(?!REDACTED)/.test(bodyText)) {
      throw new Error("host lifecycle checkpoint leaked an invite URL token");
    }
    const clickProof = await proveHostLifecycleControlClick({
      page,
      commandRequests,
    });
    return {
      status: "passed",
      sourceRoleUrl: String(roleUrl),
      visitedRolePath,
      surfaceTestId: "host-console-surface",
      checkpointTestId: "host-lifecycle-control-checkpoint",
      clickedThroughFromRoleUrl: true,
      hostLifecycleControlCheckpoint: {
        proofCheckId,
        phaseId,
        phaseState,
        slotId,
        actionState,
        deadlineAffordance,
        visibleRows,
        recoveryText,
        statusText,
      },
      hostLifecycleControlClickProof: clickProof,
      releaseReady: false,
      productionReady: false,
    };
  } finally {
    await page.close();
  }
}

async function installHostLifecycleControlBrowserRoutes(page, { commandRequests }) {
  await page.route("**/commands", async (route) => {
    const commandEnvelope = route.request().postDataJSON();
    const command = commandEnvelope?.body?.body?.command;
    commandRequests.push(command);
    if (command?.LockThread !== undefined) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          v: 1,
          id: commandEnvelope.id,
          body: {
            kind: "Ack",
            body: {
              stream_seqs: [601],
            },
          },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        v: 1,
        id: commandEnvelope?.id ?? "host-lifecycle-control-reject",
        body: {
          kind: "Reject",
          body: {
            error: "WrongHostLifecycleProofCommand",
            retryable: false,
            message: "host lifecycle proof only accepts LockThread",
          },
        },
      }),
    });
  });
  await page.route("**/games/*/host-console-state?**", async (route) => {
    await fulfillJson(route, hostLockedConsoleState());
  });
}

async function proveHostLifecycleControlClick({ page, commandRequests }) {
  const actionTile = page.getByTestId("critical-host-action-lock_thread");
  await actionTile.waitFor({ state: "visible", timeout: 15000 });
  await actionTile.getByTestId("critical-host-action-trigger").click();
  await actionTile.getByTestId("critical-host-action-confirm").waitFor({
    state: "visible",
    timeout: 15000,
  });
  await actionTile.getByTestId("critical-host-action-confirm").click();
  await page.waitForFunction(
    () =>
      window.__fmarchHostCommandStatuses?.lock_thread?.state === "ack" &&
      window.__fmarchHostCommandDispatchBridgePlan?.commandKind === "LockThread",
    null,
    { timeout: 15000 },
  );
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="host-lifecycle-control-checkpoint"]')
        ?.getAttribute("data-phase-state") === "locked",
    null,
    { timeout: 15000 },
  );
  const commandStatuses = await page.evaluate(
    () => window.__fmarchHostCommandStatuses,
  );
  const commandOutcomes = await page.evaluate(
    () => window.__fmarchHostCommandOutcomes,
  );
  const bridgePlan = await page.evaluate(
    () => window.__fmarchHostCommandDispatchBridgePlan,
  );
  const projection = await page.evaluate(() => window.__fmarchHostProjection);
  const checkpoint = page.getByTestId("host-lifecycle-control-checkpoint");
  const phaseStateAfterAck = await checkpoint.getAttribute("data-phase-state");
  const deadlineAffordanceAfterAck = await checkpoint.getAttribute(
    "data-deadline-affordance",
  );
  const activityCountText = await page
    .getByTestId("host-command-activity-count")
    .innerText();
  const activityStatusText = await page
    .getByTestId("host-command-activity-status-lock_thread")
    .innerText();
  const command = commandRequests.at(-1)?.LockThread ?? null;
  return {
    status: "passed",
    clickedAction: "lock_thread",
    commandKind: command === null ? null : "LockThread",
    command,
    commandStatus: commandStatuses?.lock_thread ?? null,
    commandOutcome: commandOutcomes?.at?.(-1) ?? null,
    bridgePlan,
    projection,
    checkpointPhaseStateAfterAck: phaseStateAfterAck,
    checkpointDeadlineAffordanceAfterAck: deadlineAffordanceAfterAck,
    statusText: commandStatuses?.lock_thread?.message ?? null,
    activityCount: Number.parseInt(activityCountText, 10),
    activityStatusText,
  };
}

async function provePlayerActionSubmissionCheckpoint({
  browser,
  frontendBaseUrl,
  roleUrl,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const visitedRolePath = rolePathFromUrl(roleUrl);
  const commandRequests = [];
  try {
    await installPlayerActionSubmissionBrowserRoutes(page, { commandRequests });
    await page.context().addCookies([
      {
        name: "fmarch_fixture_session",
        value: "fixture-player",
        url: frontendBaseUrl,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto(`${frontendBaseUrl}${visitedRolePath}`, { waitUntil: "networkidle" });
    await page.getByTestId("player-surface").waitFor({
      state: "visible",
      timeout: 15000,
    });
    const checkpoint = page.getByTestId("player-action-submission-checkpoint");
    await checkpoint.waitFor({ state: "visible", timeout: 15000 });
    const proofCheckId = await checkpoint.getAttribute("data-proof-check-id");
    const phaseId = await checkpoint.getAttribute("data-phase-id");
    const phaseState = await checkpoint.getAttribute("data-phase-state");
    const actorSlot = await checkpoint.getAttribute("data-actor-slot");
    const actionState = await checkpoint.getAttribute("data-action-state");
    const selectedAction = await checkpoint.getAttribute("data-selected-action");
    const targetSlots = await checkpoint.getAttribute("data-target-slots");
    const receiptState = await checkpoint.getAttribute("data-receipt-state");
    const visibleRows = [];
    for (const [id, testId] of Object.entries({
      phase: "player-action-submission-phase",
      actor: "player-action-submission-actor",
      actionState: "player-action-submission-action-state",
      target: "player-action-submission-target",
      receipt: "player-action-submission-receipt",
      recovery: "player-action-submission-recovery",
    })) {
      await page.getByTestId(testId).waitFor({ state: "visible", timeout: 15000 });
      visibleRows.push(id);
    }
    const targetText = await page
      .getByTestId("player-action-submission-target")
      .innerText();
    const recoveryText = await page
      .getByTestId("player-action-submission-recovery")
      .innerText();
    const statusText = await page
      .getByTestId("player-action-submission-status")
      .innerText();
    const bodyText = await page.locator("body").innerText();
    if (/invite=(?!REDACTED)/.test(bodyText)) {
      throw new Error("player action checkpoint leaked an invite URL token");
    }
    const clickProof = await provePlayerActionSubmissionClick({
      page,
      commandRequests,
    });
    const invalidRecoveryProof = await provePlayerActionInvalidRecovery({
      browser,
      frontendBaseUrl,
      roleUrl,
    });
    return {
      status: "passed",
      sourceRoleUrl: String(roleUrl),
      visitedRolePath,
      surfaceTestId: "player-surface",
      checkpointTestId: "player-action-submission-checkpoint",
      clickedThroughFromRoleUrl: true,
      playerActionSubmissionCheckpoint: {
        proofCheckId,
        phaseId,
        phaseState,
        actorSlot,
        actionState,
        selectedAction,
        targetSlots,
        receiptState,
        visibleRows,
        targetText,
        recoveryText,
        statusText,
      },
      playerActionSubmissionClickProof: clickProof,
      playerActionInvalidRecoveryProof: invalidRecoveryProof,
      releaseReady: false,
      productionReady: false,
    };
  } finally {
    await page.close();
  }
}

async function installPlayerActionSubmissionBrowserRoutes(page, { commandRequests }) {
  await page.route("**/commands", async (route) => {
    const commandEnvelope = route.request().postDataJSON();
    const command = commandEnvelope?.body?.body?.command;
    commandRequests.push(command);
    if (command?.SubmitAction !== undefined) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          v: 1,
          id: commandEnvelope.id,
          body: {
            kind: "Ack",
            body: {
              stream_seqs: [501],
            },
          },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        v: 1,
        id: commandEnvelope?.id ?? "player-action-submission-reject",
        body: {
          kind: "Reject",
          body: {
            error: "WrongPlayerActionProofCommand",
            retryable: false,
          },
        },
      }),
    });
  });
  await page.route("**/games/*/notifications?**", async (route) => {
    await fulfillJson(route, []);
  });
  await page.route("**/games/*/investigation-results?**", async (route) => {
    await fulfillJson(route, []);
  });
  await page.route("**/games/*/player-command-state?**", async (route) => {
    await fulfillJson(route, {
      game: "seeded-action-open",
      actorSlot: "slot-7",
      actorAlive: true,
      actorStatus: "alive",
      roleKey: "mafia_goon",
      gameCompleted: false,
      phase: {
        phaseId: "N02",
        phaseKind: "Night",
        phaseNumber: 2,
        locked: false,
      },
      actions: [],
      voteTargets: [],
      currentVote: null,
      boundary: "Seeded browser ACK refreshed action state.",
    });
  });
}

async function provePlayerActionInvalidRecovery({
  browser,
  frontendBaseUrl,
  roleUrl,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const visitedRolePath = rolePathFromUrl(roleUrl);
  const commandRequests = [];
  try {
    await installPlayerActionInvalidRecoveryBrowserRoutes(page, {
      commandRequests,
    });
    await page.context().addCookies([
      {
        name: "fmarch_fixture_session",
        value: "fixture-player",
        url: frontendBaseUrl,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto(`${frontendBaseUrl}${visitedRolePath}`, {
      waitUntil: "networkidle",
    });
    await page.getByTestId("player-surface").waitFor({
      state: "visible",
      timeout: 15000,
    });
    const invalidButton = page.locator(
      '[data-testid="player-action-commands"] button[data-action="submit_invalid_action:factional_kill"]',
    );
    await invalidButton.waitFor({ state: "visible", timeout: 15000 });
    await invalidButton.click();
    await page.waitForFunction(
      () =>
        window.__fmarchPlayerCommandStatus?.state === "reject" &&
        window.__fmarchPlayerCommandStatus?.error === "InvalidTarget" &&
        window.__fmarchPlayerCommandDispatchBridgePlan?.commandKind ===
          "SubmitAction",
      null,
      { timeout: 15000 },
    );
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="player-action-submission-checkpoint"]')
          ?.getAttribute("data-receipt-state") === "reject:InvalidTarget",
      null,
      { timeout: 15000 },
    );
    const commandStatus = await page.evaluate(() => window.__fmarchPlayerCommandStatus);
    const bridgePlan = await page.evaluate(
      () => window.__fmarchPlayerCommandDispatchBridgePlan,
    );
    const receipts = await page.evaluate(() => window.__fmarchPlayerCommandReceipts);
    const projection = await page.evaluate(() => window.__fmarchPlayerProjection);
    const checkpoint = page.getByTestId("player-action-submission-checkpoint");
    const receiptState = await checkpoint.getAttribute("data-receipt-state");
    const actionStateAfterReject = await checkpoint.getAttribute("data-action-state");
    const targetSlotsAfterReject = await checkpoint.getAttribute("data-target-slots");
    const receiptCountText = await page
      .getByTestId("player-command-receipt-count")
      .innerText();
    const receiptStatusText = await page.getByTestId("player-command-status").innerText();
    const bodyText = await page.locator("body").innerText();
    if (/invite=(?!REDACTED)/.test(bodyText)) {
      throw new Error("player invalid action proof leaked an invite URL token");
    }
    const command = commandRequests.at(-1)?.SubmitAction ?? null;
    return {
      status: "passed",
      clickedAction: "submit_invalid_action:factional_kill",
      commandKind: command === null ? null : "SubmitAction",
      command,
      commandStatus,
      bridgePlan,
      receipts,
      projectionCommandState: projection?.commandState ?? null,
      checkpointReceiptState: receiptState,
      checkpointActionStateAfterReject: actionStateAfterReject,
      checkpointTargetSlotsAfterReject: targetSlotsAfterReject,
      receiptCount: Number.parseInt(receiptCountText, 10),
      receiptStatusText,
    };
  } finally {
    await page.close();
  }
}

async function installPlayerActionInvalidRecoveryBrowserRoutes(
  page,
  { commandRequests },
) {
  await page.route("**/commands", async (route) => {
    const commandEnvelope = route.request().postDataJSON();
    const command = commandEnvelope?.body?.body?.command;
    commandRequests.push(command);
    if (command?.SubmitAction?.action_id === "invalid_self_factional_kill") {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          v: 1,
          id: commandEnvelope.id,
          body: {
            kind: "Reject",
            body: {
              error: "InvalidTarget",
              retryable: false,
              message: "invalid target",
            },
          },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        v: 1,
        id: commandEnvelope?.id ?? "player-invalid-action-reject",
        body: {
          kind: "Reject",
          body: {
            error: "WrongPlayerInvalidActionProofCommand",
            retryable: false,
            message: "invalid action proof only accepts invalid self action",
          },
        },
      }),
    });
  });
  await page.route("**/games/*/notifications?**", async (route) => {
    await fulfillJson(route, []);
  });
  await page.route("**/games/*/investigation-results?**", async (route) => {
    await fulfillJson(route, []);
  });
  await page.route("**/games/*/player-command-state?**", async (route) => {
    await fulfillJson(route, seededActionOpenCommandState({
      boundary: "Seeded browser InvalidTarget recovery kept legal action controls.",
    }));
  });
}

async function provePlayerActionSubmissionClick({ page, commandRequests }) {
  const actionButton = page.locator(
    '[data-testid="player-action-commands"] button[data-action="submit_action:factional_kill"]',
  );
  await actionButton.waitFor({ state: "visible", timeout: 15000 });
  await actionButton.click();
  await page.waitForFunction(
    () =>
      window.__fmarchPlayerCommandStatus?.state === "ack" &&
      window.__fmarchPlayerCommandDispatchBridgePlan?.commandKind === "SubmitAction",
    null,
    { timeout: 15000 },
  );
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="player-action-submission-checkpoint"]')
        ?.getAttribute("data-receipt-state")
        ?.startsWith("ack:") === true,
    null,
    { timeout: 15000 },
  );
  const commandStatus = await page.evaluate(() => window.__fmarchPlayerCommandStatus);
  const bridgePlan = await page.evaluate(
    () => window.__fmarchPlayerCommandDispatchBridgePlan,
  );
  const receipts = await page.evaluate(() => window.__fmarchPlayerCommandReceipts);
  const projection = await page.evaluate(() => window.__fmarchPlayerProjection);
  const checkpoint = page.getByTestId("player-action-submission-checkpoint");
  const receiptState = await checkpoint.getAttribute("data-receipt-state");
  const actionStateAfterAck = await checkpoint.getAttribute("data-action-state");
  const receiptCountText = await page
    .getByTestId("player-command-receipt-count")
    .innerText();
  const receiptStatusText = await page.getByTestId("player-command-status").innerText();
  const command = commandRequests.at(-1)?.SubmitAction ?? null;
  return {
    status: "passed",
    clickedAction: "submit_action:factional_kill",
    commandKind: command === null ? null : "SubmitAction",
    command,
    commandStatus,
    bridgePlan,
    receipts,
    projectionCommandState: projection?.commandState ?? null,
    checkpointReceiptState: receiptState,
    checkpointActionStateAfterAck: actionStateAfterAck,
    receiptCount: Number.parseInt(receiptCountText, 10),
    receiptStatusText,
  };
}

async function fulfillJson(route, payload, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(payload),
  });
}

function seededActionOpenCommandState({ boundary }) {
  return {
    game: "seeded-action-open",
    actorSlot: "slot-7",
    actorAlive: true,
    actorStatus: "alive",
    roleKey: "mafia_goon",
    gameCompleted: false,
    phase: {
      phaseId: "N02",
      phaseKind: "Night",
      phaseNumber: 2,
      locked: false,
    },
    actions: [
      {
        action: "submit_action:factional_kill",
        commandKind: "submit_action",
        actionId: "factional_kill",
        templateId: "factional_kill",
        ability: "Kill",
        window: "Night",
        label: "Submit factional kill",
        detail: "factional_kill -> slot-2",
        targets: ["slot-2"],
        targetOptions: ["slot-2", "slot-3"],
        grantId: "grant-factional-kill",
      },
    ],
    voteTargets: [],
    currentVote: null,
    boundary,
  };
}

function hostLockedConsoleState() {
  return {
    completed: false,
    phase: {
      phase_id: "D01",
      locked: true,
      deadline: null,
    },
    slots: [
      {
        slot_id: "slot-7",
        occupant_user_id: "player-mira",
        alive: true,
        status: "alive",
        status_tags: ["alive"],
        role_key: "mafia_goon",
      },
    ],
    thread_posts: [
      {
        seq: 41,
        author_slot: "slot-7",
      },
    ],
  };
}

function rolePathFromUrl(roleUrl) {
  if (typeof roleUrl !== "string" || roleUrl.trim() === "") {
    throw new Error("core-loop role proof missing source role URL");
  }
  const parsed = new URL(roleUrl);
  return `${parsed.pathname}${parsed.search}`;
}

export function assertCoreLoopAdminProof(evidence) {
  if (
    evidence?.version !== 1 ||
    evidence.proof !== "dev-test-game-core-loop-admin-proof" ||
    evidence.status !== "passed" ||
    evidence.releaseReady !== false ||
    evidence.productionReady !== false ||
    evidence.scope !== "local-dev-test-game-core-loop-admin-surface"
  ) {
    throw new Error("core-loop admin proof must pass locally without release claims");
  }
  if (
    evidence.adminRoleSurface?.clickedThroughFromOverview !== true ||
    evidence.adminRoleSurface?.rawInviteTokensVisible !== false
  ) {
    throw new Error("core-loop admin proof did not prove admin overview click-through");
  }
  for (const checkId of requiredChecks) {
    if (!evidence.adminRoleSurface?.visibleChecks?.includes(checkId)) {
      throw new Error(`core-loop admin proof missing visible check: ${checkId}`);
    }
  }
  if (
    !evidence.adminRoleSurface?.visibleCheckStatuses?.["core-loop-spine"]?.includes(
      evidence.generatedFrom?.coreLoopSpineStatus,
    )
  ) {
    throw new Error("core-loop admin proof missing visible core-loop spine status");
  }
  assertVisibleRows(
    "core-loop admin proof missing visible spine cycle",
    evidence.adminRoleSurface?.visibleSpineCycles,
    evidence.generatedFrom?.coreLoopSpineRows?.cycles,
  );
  assertVisibleRows(
    "core-loop admin proof missing visible spine role URL",
    evidence.adminRoleSurface?.visibleSpineRoleUrls,
    evidence.generatedFrom?.coreLoopSpineRows?.roleUrls,
  );
  const roleUrlHrefs = evidence.generatedFrom?.coreLoopSpineRows?.roleUrlHrefs ?? {};
  for (const rowId of evidence.generatedFrom?.coreLoopSpineRows?.roleUrls ?? []) {
    const href = roleUrlHrefs[rowId];
    if (typeof href !== "string" || !href.includes("/g/")) {
      throw new Error(`core-loop admin proof missing actionable role URL: ${rowId}`);
    }
  }
  assertVisibleRows(
    "core-loop admin proof missing visible spine checkpoint",
    evidence.adminRoleSurface?.visibleSpineCheckpoints,
    evidence.generatedFrom?.coreLoopSpineRows?.checkpoints,
  );
  assertVisibleRows(
    "core-loop admin proof missing visible spine recovery hook",
    evidence.adminRoleSurface?.visibleSpineRecoveryHooks,
    evidence.generatedFrom?.coreLoopSpineRows?.recoveryHooks,
  );
  for (const [checkId, expectedStatus] of Object.entries(
    evidence.generatedFrom?.highlightedLaneEvidence ?? {},
  )) {
    if (
      expectedStatus !== "" &&
      !evidence.adminRoleSurface?.visibleCheckStatuses?.[checkId]?.includes(
        expectedStatus,
      )
    ) {
      throw new Error(
        `core-loop admin proof missing visible status for ${checkId}: ${expectedStatus}`,
      );
    }
  }
  assertHostLifecycleControlCheckpoint(evidence.hostRoleSurface);
  assertPlayerActionSubmissionCheckpoint(evidence.playerRoleSurface);
  return evidence;
}

function assertHostLifecycleControlCheckpoint(hostRoleSurface) {
  const checkpoint = hostRoleSurface?.hostLifecycleControlCheckpoint;
  const clickProof = hostRoleSurface?.hostLifecycleControlClickProof;
  if (
    hostRoleSurface?.status !== "passed" ||
    hostRoleSurface.clickedThroughFromRoleUrl !== true ||
    hostRoleSurface.releaseReady !== false ||
    hostRoleSurface.productionReady !== false ||
    typeof hostRoleSurface.sourceRoleUrl !== "string" ||
    !hostRoleSurface.sourceRoleUrl.includes("/g/") ||
    typeof hostRoleSurface.visitedRolePath !== "string" ||
    !hostRoleSurface.visitedRolePath.endsWith("/host") ||
    hostRoleSurface.surfaceTestId !== "host-console-surface" ||
    hostRoleSurface.checkpointTestId !== "host-lifecycle-control-checkpoint" ||
    checkpoint?.proofCheckId !== "host-lifecycle-control" ||
    checkpoint.phaseId !== "D01" ||
    checkpoint.phaseState !== "open" ||
    checkpoint.slotId !== "slot-7" ||
    checkpoint.actionState !== "enabled:mark_dead,modkill_slot" ||
    !checkpoint.deadlineAffordance?.includes("resolve_phase") ||
    !checkpoint.recoveryText?.includes("Reject PhaseLocked") ||
    !checkpoint.statusText?.includes(
      "Host lifecycle controls are reachable from this role URL",
    )
  ) {
    throw new Error("core-loop admin proof missing host lifecycle role checkpoint");
  }
  for (const rowId of [
    "phase",
    "slot",
    "actionState",
    "deadlineAffordance",
    "recovery",
  ]) {
    if (!checkpoint.visibleRows?.includes(rowId)) {
      throw new Error(`host lifecycle checkpoint missing visible row: ${rowId}`);
    }
  }
  assertHostLifecycleControlClickProof({
    clickProof,
    expectedGame: gameFromRoleUrl(hostRoleSurface.sourceRoleUrl),
  });
}

function assertHostLifecycleControlClickProof({ clickProof, expectedGame }) {
  if (
    clickProof?.status !== "passed" ||
    clickProof.clickedAction !== "lock_thread" ||
    clickProof.commandKind !== "LockThread" ||
    clickProof.command?.game !== expectedGame ||
    clickProof.commandStatus?.state !== "ack" ||
    !clickProof.commandStatus?.message?.includes("Ack: stream seqs 601") ||
    clickProof.commandOutcome?.state !== "ack" ||
    !clickProof.commandOutcome?.message?.includes("Ack: stream seqs 601") ||
    clickProof.bridgePlan?.role !== "moderator" ||
    clickProof.bridgePlan.commandKind !== "LockThread" ||
    clickProof.bridgePlan.commandEndpoint !== "/commands" ||
    clickProof.bridgePlan.finalState !== "ack" ||
    clickProof.bridgePlan.projectionRefreshKeys?.length !== 0 ||
    clickProof.projection?.phase?.id !== "D01" ||
    clickProof.projection?.phase?.locked !== true ||
    clickProof.checkpointPhaseStateAfterAck !== "locked" ||
    clickProof.checkpointDeadlineAffordanceAfterAck !==
      "unlock_thread,advance_phase" ||
    !String(clickProof.statusText ?? "")
      .toLowerCase()
      .includes("ack: stream seqs 601") ||
    clickProof.activityCount !== 1 ||
    !String(clickProof.activityStatusText ?? "")
      .toLowerCase()
      .includes("ack: stream seqs 601")
  ) {
    throw new Error(
      `core-loop admin proof missing host lifecycle click ACK: ${JSON.stringify(
        clickProof,
      )}`,
    );
  }
}

function assertPlayerActionSubmissionCheckpoint(playerRoleSurface) {
  const checkpoint = playerRoleSurface?.playerActionSubmissionCheckpoint;
  const clickProof = playerRoleSurface?.playerActionSubmissionClickProof;
  const invalidRecoveryProof = playerRoleSurface?.playerActionInvalidRecoveryProof;
  if (
    playerRoleSurface?.status !== "passed" ||
    playerRoleSurface.clickedThroughFromRoleUrl !== true ||
    playerRoleSurface.releaseReady !== false ||
    playerRoleSurface.productionReady !== false ||
    typeof playerRoleSurface.sourceRoleUrl !== "string" ||
    !playerRoleSurface.sourceRoleUrl.includes("/g/") ||
    typeof playerRoleSurface.visitedRolePath !== "string" ||
    !playerRoleSurface.visitedRolePath.includes("/g/") ||
    playerRoleSurface.surfaceTestId !== "player-surface" ||
    playerRoleSurface.checkpointTestId !== "player-action-submission-checkpoint" ||
    checkpoint?.proofCheckId !== "player-action-submission" ||
    checkpoint.phaseId !== "N02" ||
    checkpoint.phaseState !== "open" ||
    checkpoint.actorSlot !== "slot-7" ||
    checkpoint.actionState !== "enabled:submit_action:factional_kill" ||
    checkpoint.selectedAction !== "factional_kill" ||
    checkpoint.targetSlots !== "slot-2" ||
    checkpoint.receiptState !== "idle" ||
    !checkpoint.targetText?.includes("factional_kill -> slot-2") ||
    !checkpoint.recoveryText?.includes("Reject PhaseLocked") ||
    !String(checkpoint.statusText ?? "")
      .toLowerCase()
      .includes("player action submission is reachable from this role url")
  ) {
    throw new Error(
      `core-loop admin proof missing player action role checkpoint: ${JSON.stringify(
        {
          surface: {
            status: playerRoleSurface?.status,
            sourceRoleUrl: playerRoleSurface?.sourceRoleUrl,
            visitedRolePath: playerRoleSurface?.visitedRolePath,
            surfaceTestId: playerRoleSurface?.surfaceTestId,
            checkpointTestId: playerRoleSurface?.checkpointTestId,
            clickedThroughFromRoleUrl: playerRoleSurface?.clickedThroughFromRoleUrl,
            releaseReady: playerRoleSurface?.releaseReady,
            productionReady: playerRoleSurface?.productionReady,
          },
          checkpoint,
        },
      )}`,
    );
  }
  for (const rowId of [
    "phase",
    "actor",
    "actionState",
    "target",
    "receipt",
    "recovery",
  ]) {
    if (!checkpoint.visibleRows?.includes(rowId)) {
      throw new Error(`player action checkpoint missing visible row: ${rowId}`);
    }
  }
  assertPlayerActionSubmissionClickProof({
    clickProof,
    expectedGame: gameFromRoleUrl(playerRoleSurface.sourceRoleUrl),
  });
  assertPlayerActionInvalidRecoveryProof({
    invalidRecoveryProof,
    expectedGame: gameFromRoleUrl(playerRoleSurface.sourceRoleUrl),
  });
}

function assertPlayerActionSubmissionClickProof({ clickProof, expectedGame }) {
  if (
    clickProof?.status !== "passed" ||
    clickProof.clickedAction !== "submit_action:factional_kill" ||
    clickProof.commandKind !== "SubmitAction" ||
    clickProof.command?.game !== expectedGame ||
    clickProof.command.action_id !== "factional_kill" ||
    clickProof.command.actor_slot !== "slot-7" ||
    clickProof.command.template_id !== "factional_kill" ||
    clickProof.command.targets?.[0] !== "slot-2" ||
    clickProof.commandStatus?.state !== "ack" ||
    !clickProof.commandStatus?.message?.includes("Ack: stream seqs 501") ||
    clickProof.bridgePlan?.role !== "player" ||
    clickProof.bridgePlan.commandKind !== "SubmitAction" ||
    clickProof.bridgePlan.commandEndpoint !== "/commands" ||
    clickProof.bridgePlan.finalState !== "ack" ||
    !clickProof.bridgePlan.projectionRefreshKeys?.includes("commandState") ||
    clickProof.receipts?.at?.(-1)?.state !== "ack" ||
    clickProof.projectionCommandState?.phase?.phaseId !== "N02" ||
    clickProof.projectionCommandState?.actions?.length !== 0 ||
    !String(clickProof.checkpointReceiptState ?? "").startsWith("ack:") ||
    clickProof.checkpointActionStateAfterAck !== "disabled:no legal action available" ||
    clickProof.receiptCount !== 1 ||
    !String(clickProof.receiptStatusText ?? "")
      .toLowerCase()
      .includes("ack: stream seqs 501")
  ) {
    throw new Error(
      `core-loop admin proof missing player action click ACK: ${JSON.stringify(
        clickProof,
      )}`,
    );
  }
}

function assertPlayerActionInvalidRecoveryProof({
  invalidRecoveryProof,
  expectedGame,
}) {
  if (
    invalidRecoveryProof?.status !== "passed" ||
    invalidRecoveryProof.clickedAction !== "submit_invalid_action:factional_kill" ||
    invalidRecoveryProof.commandKind !== "SubmitAction" ||
    invalidRecoveryProof.command?.game !== expectedGame ||
    invalidRecoveryProof.command.action_id !== "invalid_self_factional_kill" ||
    invalidRecoveryProof.command.actor_slot !== "slot-7" ||
    invalidRecoveryProof.command.template_id !== "factional_kill" ||
    invalidRecoveryProof.command.targets?.[0] !== "slot-7" ||
    invalidRecoveryProof.commandStatus?.state !== "reject" ||
    invalidRecoveryProof.commandStatus.error !== "InvalidTarget" ||
    !invalidRecoveryProof.commandStatus?.message?.includes(
      "Reject InvalidTarget: invalid target",
    ) ||
    invalidRecoveryProof.bridgePlan?.role !== "player" ||
    invalidRecoveryProof.bridgePlan.commandKind !== "SubmitAction" ||
    invalidRecoveryProof.bridgePlan.commandEndpoint !== "/commands" ||
    invalidRecoveryProof.bridgePlan.finalState !== "reject" ||
    !invalidRecoveryProof.bridgePlan.projectionRefreshKeys?.includes("commandState") ||
    invalidRecoveryProof.receipts?.at?.(-1)?.state !== "reject" ||
    invalidRecoveryProof.projectionCommandState?.phase?.phaseId !== "N02" ||
    invalidRecoveryProof.projectionCommandState?.actions?.[0]?.templateId !==
      "factional_kill" ||
    invalidRecoveryProof.checkpointReceiptState !== "reject:InvalidTarget" ||
    invalidRecoveryProof.checkpointActionStateAfterReject !==
      "enabled:submit_action:factional_kill" ||
    invalidRecoveryProof.checkpointTargetSlotsAfterReject !== "slot-2" ||
    invalidRecoveryProof.receiptCount !== 1 ||
    !String(invalidRecoveryProof.receiptStatusText ?? "")
      .toLowerCase()
      .includes("reject invalidtarget: invalid target")
  ) {
    throw new Error(
      `core-loop admin proof missing player invalid-action recovery: ${JSON.stringify(
        invalidRecoveryProof,
      )}`,
    );
  }
}

function gameFromRoleUrl(roleUrl) {
  try {
    return new URL(roleUrl).pathname.split("/")[2] ?? "";
  } catch {
    return "";
  }
}

function assertVisibleRows(message, visibleRows, requiredRows) {
  const visible = Array.isArray(visibleRows) ? visibleRows : [];
  for (const rowId of requiredRows ?? []) {
    if (!visible.includes(rowId)) {
      throw new Error(`${message}: ${rowId}`);
    }
  }
}
