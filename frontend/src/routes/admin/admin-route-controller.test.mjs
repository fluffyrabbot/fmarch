import assert from "node:assert/strict";
import { test } from "node:test";
import {
  adminConfirmStatus,
  adminConfirmationDispatchKind,
  adminConfirmationSurface,
  buildAdminCommandDispatchBridgePlan,
  exposeAdminFormResult,
  adminFormStatusKey,
  adminPendingStatus,
  adminInterruptedStatus,
  adminReadOnlyStatus,
  adminRejectStatus,
  adminSetupActionMode,
  clearAdminCommandStatus,
  commandConfigForAdminItem,
  exposeAdminCommandDispatchBridgePlan,
  exposeAdminCommandOutcome,
  recordAdminCommandStatus,
  recordAdminFormStatus,
  sendAdminSetupCommand,
} from "./admin-route-controller.mjs";
import { CommandInterruptedError } from "../../lib/app/command-interruption.mjs";

test("admin route controller records server form results once per status key", () => {
  const form = {
    id: "session-grants",
    state: "ack",
    message: "Granted GlobalMod to mod_a",
  };

  assert.equal(
    adminFormStatusKey(form),
    "session-grants:ack:Granted GlobalMod to mod_a",
  );

  const recorded = recordAdminFormStatus({
    commandStatuses: {},
    form,
    lastFormStatusKey: "",
  });
  assert.equal(recorded.recorded, true);
  assert.equal(recorded.lastFormStatusKey, adminFormStatusKey(form));
  assert.deepEqual(recorded.commandStatuses, {
    "session-grants": form,
  });

  const skipped = recordAdminFormStatus({
    commandStatuses: recorded.commandStatuses,
    form,
    lastFormStatusKey: recorded.lastFormStatusKey,
  });
  assert.equal(skipped.recorded, false);
  assert.equal(skipped.commandStatuses, recorded.commandStatuses);
});

test("admin route controller maps setup actions to send confirm or readonly modes", () => {
  assert.equal(adminSetupActionMode({ commandAction: "create_game" }), "confirm");
  assert.equal(adminSetupActionMode({ commandAction: "add_cohost" }), "confirm");
  assert.equal(adminSetupActionMode({ commandAction: "grant_session" }), "confirm");
  assert.equal(adminSetupActionMode({ commandAction: "audit_only" }), "readonly");

  assert.deepEqual(
    adminConfirmStatus({
      id: "create-game",
      commandAction: "create_game",
      confirmMessage: "Create game midsummer from pack mafiascum",
    }),
    {
      state: "confirm",
      message: "Create game midsummer from pack mafiascum",
      confirmationTrace: {
        kind: "confirmation-command-trace",
        confirmationKind: "confirmation-action",
        surface: "admin-setup",
        actionId: "create-game",
        statusKey: "create-game",
        dispatchKind: "create_game",
      },
    },
  );
  assert.deepEqual(
    adminConfirmStatus({
      id: "cohost",
      commandAction: "add_cohost",
      confirmMessage: "Delegate cohost_c as cohost for this game",
    }),
    {
      state: "confirm",
      message: "Delegate cohost_c as cohost for this game",
      confirmationTrace: {
        kind: "confirmation-command-trace",
        confirmationKind: "confirmation-action",
        surface: "admin-setup",
        actionId: "cohost",
        statusKey: "cohost",
        dispatchKind: "add_cohost",
      },
    },
  );
  assert.equal(adminConfirmationSurface({ commandAction: "create_game" }), "admin-setup");
  assert.equal(adminConfirmationSurface({ id: "recovery-gate" }), "admin-recovery");
  assert.equal(
    adminConfirmationDispatchKind({ id: "recovery-gate" }),
    "check_recovery_gate",
  );
  assert.deepEqual(adminReadOnlyStatus({ label: "Proof runs" }), {
    state: "idle",
    message: "Proof runs boundary is read-only",
  });
  assert.deepEqual(adminPendingStatus(), {
    state: "pending",
    message: "Sending command",
  });
  assert.deepEqual(adminRejectStatus(new Error("backend down")), {
    state: "reject",
    message: "backend down",
  });
});

test("admin route controller updates immutable command status maps", () => {
  const statuses = recordAdminCommandStatus({}, "create-game", {
    state: "pending",
  });
  assert.deepEqual(statuses, {
    "create-game": { state: "pending" },
  });
  assert.deepEqual(clearAdminCommandStatus(statuses, "create-game"), {});
});

test("admin interruption status preserves confirmation and retry identity", () => {
  const item = {
    id: "create-game",
    commandAction: "create_game",
    confirmMessage: "Create midsummer",
  };
  const confirmationStatus = adminConfirmStatus(item);
  const status = adminInterruptedStatus(
    new CommandInterruptedError("timeout"),
    { item, commandId: "admin-command-1", confirmationStatus },
  );

  assert.equal(status.state, "interrupted");
  assert.equal(status.commandId, "admin-command-1");
  assert.equal(status.confirmationTrace.actionId, "create-game");
});

test("admin route controller selects typed admin command config without ambient authority", () => {
  const data = fixtureData();

  assert.deepEqual(
    commandConfigForAdminItem({
      item: { commandAction: "create_game" },
      data,
    }),
    data.command.createGame,
  );
  assert.deepEqual(
    commandConfigForAdminItem({
      item: { commandAction: "add_cohost" },
      data,
    }),
    data.command.cohost,
  );
  assert.throws(
    () =>
      commandConfigForAdminItem({
        item: { commandAction: "grant_session" },
        data,
      }),
    /authenticated server action/,
  );
  assert.throws(
    () =>
      commandConfigForAdminItem({
        item: { commandAction: "unknown" },
        data,
      }),
    /unsupported admin command action/,
  );
});

test("admin route controller derives dispatch bridge plans from setup commands", () => {
  const item = {
    id: "cohost",
    commandAction: "add_cohost",
    confirmMessage: "Delegate cohost_c as cohost for this game",
  };
  const confirmationStatus = adminConfirmStatus(item);
  const plan = buildAdminCommandDispatchBridgePlan({
    item,
    data: fixtureData(),
    confirmationStatus,
    optimisticStatus: adminPendingStatus(),
    finalStatus: {
      state: "ack",
      message: "Ack: stream seqs 61",
    },
  });

  assert.deepEqual(plan, {
    role: "admin",
    boundary:
      "No-browser bridge contract for command trace metadata. It proves trace attributes can be normalized into role dispatch plans and reconciled with typed command requests, local feedback rows, and projection refresh keys. It does not prove pointer events, focus traversal, browser hydration, or network transport.",
    trace: {
      kind: "confirmation-command-trace",
      surface: "admin-setup",
      actionId: "cohost",
      statusKey: "cohost",
      dispatchKind: "add_cohost",
    },
    commandKind: "AddCohost",
    commandEndpoint: "/commands",
    principalUserId: "admin_a",
    optimisticState: "pending",
    finalState: "ack",
    projectionRefreshKeys: [],
  });
});

test("admin route controller sends setup commands through the typed command boundary", async () => {
  const sent = [];
  const result = await sendAdminSetupCommand({
    item: { commandAction: "create_game" },
    data: fixtureData(),
    fetchImpl: async () => {
      throw new Error("fetch should stay inside sendCommandImpl");
    },
    sendCommandImpl: async (request) => {
      sent.push(request);
      return {
        state: "ack",
        message: "Ack: stream seqs 10",
      };
    },
  });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].principalUserId, "admin_a");
  assert.equal(sent[0].endpoint, "/commands");
  assert.deepEqual(sent[0].command, {
    CreateGame: {
      game: "midsummer",
      pack: "mafiascum",
    },
  });
  assert.deepEqual(result.outcome, {
    state: "ack",
    message: "Ack: stream seqs 10",
  });
});

test("admin route controller exposes command and form results for smoke evidence", () => {
  const windowRef = {};
  const outcome = { state: "ack", message: "Ack" };
  const commandStatuses = {
    "create-game": outcome,
  };
  const form = {
    id: "session-grants",
    state: "ack",
    message: "Granted GlobalMod to mod_a",
  };
  const recoveryForm = {
    id: "recovery-gate",
    state: "ack",
    message: "Recovery gate trusted",
  };

  assert.equal(
    exposeAdminCommandOutcome({
      windowRef,
      commandStatuses,
      outcome,
    }),
    true,
  );
  assert.equal(
    exposeAdminFormResult({
      windowRef,
      form,
    }),
    true,
  );
  assert.equal(
    exposeAdminFormResult({
      windowRef,
      form: recoveryForm,
    }),
    true,
  );
  assert.equal(
    exposeAdminCommandDispatchBridgePlan({
      windowRef,
      plan: { role: "admin", commandKind: "AddCohost" },
    }),
    true,
  );
  assert.equal(windowRef.__fmarchAdminCommandStatuses, commandStatuses);
  assert.equal(windowRef.__fmarchAdminCommandOutcome, outcome);
  assert.deepEqual(windowRef.__fmarchAdminFormResults, [form, recoveryForm]);
  assert.equal(windowRef.__fmarchAdminLatestFormResult, recoveryForm);
  assert.equal(windowRef.__fmarchAdminSessionGrantResult, form);
  assert.equal(windowRef.__fmarchAdminRecoveryGateResult, recoveryForm);
  assert.deepEqual(windowRef.__fmarchAdminCommandDispatchBridgePlan, {
    role: "admin",
    commandKind: "AddCohost",
  });
  assert.equal(
    exposeAdminCommandOutcome({
      windowRef: null,
      commandStatuses,
      outcome,
    }),
    false,
  );
  assert.equal(
    exposeAdminFormResult({
      windowRef: null,
      form,
    }),
    false,
  );
  assert.equal(
    exposeAdminCommandDispatchBridgePlan({
      windowRef: null,
      plan: { role: "admin" },
    }),
    false,
  );
});

function fixtureData() {
  return {
    operator: {
      principalUserId: "admin_a",
    },
    command: {
      endpoint: "/commands",
      createGame: {
        action: "create_game",
        game: "midsummer",
        pack: "mafiascum",
      },
      cohost: {
        action: "add_cohost",
        game: "midsummer",
        user: "cohost_c",
      },
    },
  };
}
