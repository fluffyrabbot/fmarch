import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  HOST_ACTION_CONTRACT,
  TOUCH_CONTROL_CONTRACT,
  buildHostActionViewModel,
  createHostActionController,
} from "./host-action-contract.mjs";
import {
  buildHostConsoleActionGroups,
  HOST_CONSOLE_CRITICAL_ACTIONS,
  buildHostConsoleCriticalActions,
} from "./host-console-critical-action.mjs";

test("touch-control CSS exposes the minimum target and spacing variables", async () => {
  const css = await readFile(
    new URL("./touch-control.css", import.meta.url),
    "utf8",
  );

  assert.match(
    css,
    new RegExp(
      `${escapeRegExp(TOUCH_CONTROL_CONTRACT.minTargetVar)}:\\s*${escapeRegExp(
        TOUCH_CONTROL_CONTRACT.minTargetValue,
      )}`,
    ),
  );
  assert.match(
    css,
    new RegExp(
      `${escapeRegExp(TOUCH_CONTROL_CONTRACT.minGapVar)}:\\s*${escapeRegExp(
        TOUCH_CONTROL_CONTRACT.minGapValue,
      )}`,
    ),
  );
  assert.match(
    css,
    new RegExp(
      `min-block-size:\\s*var\\(${escapeRegExp(
        TOUCH_CONTROL_CONTRACT.minTargetVar,
      )}\\)`,
    ),
  );
  assert.match(
    css,
    new RegExp(
      `min-inline-size:\\s*var\\(${escapeRegExp(
        TOUCH_CONTROL_CONTRACT.minTargetVar,
      )}\\)`,
    ),
  );
  assert.match(
    css,
    new RegExp(`gap:\\s*var\\(${escapeRegExp(TOUCH_CONTROL_CONTRACT.minGapVar)}\\)`),
  );
});

test("host action view model binds the shared touch-control contract", () => {
  const view = buildHostActionViewModel({
    id: "extend-deadline",
    label: "Extend deadline",
  });

  assert.equal(view.root.className, HOST_ACTION_CONTRACT.rootClassName);
  assert.equal(view.root.data.component, HOST_ACTION_CONTRACT.componentName);
  assert.equal(view.trigger.role, HOST_ACTION_CONTRACT.triggerRole);
  assert.match(view.trigger.className, /\btouch-control\b/);
  assert.match(view.trigger.className, /\bhost-action__trigger\b/);
  assert.equal(view.confirmation, null);
});

test("reversible host actions dispatch immediately", () => {
  const dispatched = [];
  const action = createHostActionController(
    {
      id: "force-recount",
      label: "Force recount",
      payload: { gameId: "g-1" },
    },
    (event) => dispatched.push(event),
  );

  action.activate();

  assert.equal(action.state.confirmationOpen, false);
  assert.deepEqual(dispatched, [
    {
      type: "host-action/dispatch",
      actionId: "force-recount",
      label: "Force recount",
      objectLabel: null,
      outcomeLabel: null,
      payload: { gameId: "g-1" },
      confirmationTrace: null,
    },
  ]);
});

test("irreversible host actions open a named confirmation before dispatch", () => {
  const dispatched = [];
  const action = createHostActionController(
    {
      id: "modkill-slot",
      label: "Modkill",
      objectLabel: "Slot 7 / Mira",
      outcomeLabel: "mark dead and lock voting power",
      confirmationText:
        "Modkill Slot 7 / Mira: mark dead and lock voting power.",
      irreversible: true,
      payload: { slotId: "slot-7" },
    },
    (event) => dispatched.push(event),
  );

  action.activate();

  assert.equal(action.state.confirmationOpen, true);
  assert.equal(action.state.confirmation.objectLabel, "Slot 7 / Mira");
  assert.equal(
    action.state.confirmation.outcomeLabel,
    "mark dead and lock voting power",
  );
  assert.equal(dispatched.length, 0);

  const view = action.viewModel();
  assert.equal(view.trigger.ariaExpanded, "true");
  assert.equal(view.confirmation.kind, "confirmation-action");
  assert.equal(view.confirmation.surface, "moderator-host");
  assert.equal(view.confirmation.actionId, "modkill-slot");
  assert.equal(view.confirmation.role, HOST_ACTION_CONTRACT.confirmationRole);
  assert.equal(view.confirmation.ariaModal, HOST_ACTION_CONTRACT.confirmationAriaModal);
  assert.equal(view.confirmation.ariaLabel, "Confirm Modkill");
  assert.equal(
    view.confirmation.messageId,
    "host-action-confirmation-message-modkill-slot",
  );
  assert.match(view.confirmation.message, /Slot 7 \/ Mira/);
  assert.match(view.confirmation.message, /mark dead and lock voting power/);
  assert.equal(
    view.confirmation.message,
    "Modkill Slot 7 / Mira: mark dead and lock voting power.",
  );
  assert.deepEqual(
    {
      triggerTestId: view.confirmation.triggerTestId,
      confirmationTestId: view.confirmation.confirmationTestId,
      messageTestId: view.confirmation.messageTestId,
      confirmTestId: view.confirmation.confirmTestId,
      cancelTestId: view.confirmation.cancelTestId,
      initialFocusTestId: view.confirmation.initialFocusTestId,
      returnFocusTestId: view.confirmation.returnFocusTestId,
      escapeCancels: view.confirmation.escapeCancels,
      tabContainment: view.confirmation.tabContainment,
    },
    {
      triggerTestId: HOST_ACTION_CONTRACT.triggerTestId,
      confirmationTestId: HOST_ACTION_CONTRACT.confirmationTestId,
      messageTestId: HOST_ACTION_CONTRACT.confirmationMessageTestId,
      confirmTestId: HOST_ACTION_CONTRACT.confirmTestId,
      cancelTestId: HOST_ACTION_CONTRACT.cancelTestId,
      initialFocusTestId: HOST_ACTION_CONTRACT.initialFocusTestId,
      returnFocusTestId: HOST_ACTION_CONTRACT.returnFocusTestId,
      escapeCancels: true,
      tabContainment: "confirm-cancel",
    },
  );

  action.confirm();

  assert.equal(action.state.confirmationOpen, false);
  assert.deepEqual(dispatched, [
    {
      type: "host-action/dispatch",
      actionId: "modkill-slot",
      label: "Modkill",
      objectLabel: "Slot 7 / Mira",
      outcomeLabel: "mark dead and lock voting power",
      payload: { slotId: "slot-7" },
      confirmationTrace: {
        kind: "confirmation-command-trace",
        confirmationKind: "confirmation-action",
        surface: "moderator-host",
        actionId: "modkill-slot",
        statusKey: "modkill-slot",
        dispatchKind: "modkill-slot",
      },
    },
  ]);
});

test("canceling a confirmation does not dispatch", () => {
  const dispatched = [];
  const action = createHostActionController(
    {
      id: "extend_deadline",
      label: "Extend deadline",
      objectLabel: "Day 2 deadline",
      outcomeLabel: "move the deadline to June 19, 2026 at 9:00 PM PT",
      confirmationText:
        "Extend Day 2 deadline: move the deadline to June 19, 2026 at 9:00 PM PT for Day 2 deadline.",
      requiresConfirmation: true,
    },
    (event) => dispatched.push(event),
  );

  action.activate();
  action.cancel();

  assert.equal(action.state.confirmationOpen, false);
  assert.deepEqual(dispatched, []);
});

test("controller methods can be passed directly to component handlers", () => {
  const dispatched = [];
  const action = createHostActionController(
    {
      id: "post-votecount",
      label: "Post official votecount",
      payload: { phaseId: "day-3" },
    },
    (event) => dispatched.push(event),
  );

  const { activate } = action;
  const state = activate();

  assert.equal(state.confirmationOpen, false);
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].actionId, "post-votecount");
});

test("irreversible host actions must name the object and outcome", () => {
  assert.throws(
    () =>
      createHostActionController(
        {
          id: "extend_deadline",
          label: "Extend deadline",
          outcomeLabel: "enter night",
          irreversible: true,
        },
        () => {},
      ),
    /affected object/,
  );

  assert.throws(
    () =>
      createHostActionController(
        {
          id: "extend_deadline",
          label: "Extend deadline",
          objectLabel: "Day 2",
          irreversible: true,
        },
        () => {},
      ),
    /intended outcome/,
  );

  assert.throws(
    () =>
      createHostActionController(
        {
          id: "extend_deadline",
          label: "Extend deadline",
          objectLabel: "Day 2",
          outcomeLabel: "enter night",
          irreversible: true,
        },
        () => {},
      ),
    /confirmation text/,
  );

  assert.throws(
    () =>
      createHostActionController(
        {
          id: "extend_deadline",
          label: "Extend deadline",
          objectLabel: "Day 2",
          outcomeLabel: "enter night",
          confirmationText: "Advance now: enter night.",
          irreversible: true,
        },
        () => {},
      ),
    /affected object/,
  );

  assert.throws(
    () =>
      createHostActionController(
        {
          id: "extend_deadline",
          label: "Extend deadline",
          objectLabel: "Day 2",
          outcomeLabel: "enter night",
          confirmationText: "Advance Day 2 now.",
          irreversible: true,
        },
        () => {},
      ),
    /intended outcome/,
  );
});

test("host console proof actions cover the roadmap-critical irreversible actions", () => {
  assert.deepEqual(
    HOST_CONSOLE_CRITICAL_ACTIONS.map((action) => action.id),
    [
      "extend_deadline",
      "process_replacement",
      "resolve_phase",
      "lock_thread",
      "unlock_thread",
      "advance_phase",
      "publish_votecount",
      "mark_dead",
      "modkill_slot",
      "complete_game",
    ],
  );

  for (const actionConfig of HOST_CONSOLE_CRITICAL_ACTIONS) {
    const dispatched = [];
    const action = createHostActionController(actionConfig, (event) =>
      dispatched.push(event),
    );

    action.activate();

    assert.equal(action.state.confirmationOpen, true);
    assert.equal(action.state.confirmation.message, actionConfig.confirmationText);
    assert.match(
      action.state.confirmation.message,
      new RegExp(escapeRegExp(actionConfig.objectLabel)),
    );
    assert.match(
      action.state.confirmation.message,
      new RegExp(escapeRegExp(actionConfig.outcomeLabel)),
    );
    assert.equal(actionConfig.payload.kind, actionConfig.id);

    action.confirm();

    assert.equal(dispatched.length, 1);
    assert.equal(dispatched[0].actionId, actionConfig.id);
    assert.deepEqual(dispatched[0].payload, actionConfig.payload);
  }
});

test("host console action groups turn typed commands into moderator control bays", () => {
  const actions = buildHostConsoleCriticalActions("midsummer", {
    hostPrompts: [
      {
        id: "D01:tie:slot_2",
        label: "tie",
        value: "host_decides_tie",
        status: "pending",
        phaseId: "D01",
        subjectSlot: "slot_2",
        decisionKind: "acknowledge",
      },
    ],
  });
  const groups = buildHostConsoleActionGroups({
    actions,
    pendingPromptCount: 1,
    votecountCount: 2,
  });

  assert.deepEqual(
    groups.map((group) => group.id),
    [
      "deadline",
      "phase",
      "votecount",
      "replacement",
      "host-prompts",
      "slot-lifecycle",
      "roles",
    ],
  );
  assert.deepEqual(
    groups
      .find((group) => group.id === "deadline")
      .actions.map((action) => action.id),
    ["extend_deadline"],
  );
  assert.deepEqual(
    groups
      .find((group) => group.id === "phase")
      .actions.map((action) => action.id),
    ["resolve_phase", "lock_thread", "unlock_thread", "advance_phase"],
  );
  assert.deepEqual(
    groups
      .find((group) => group.id === "host-prompts")
      .actions.map((action) => action.payload.promptId),
    ["D01:tie:slot_2"],
  );
  assert.equal(
    groups.find((group) => group.id === "votecount").boundary,
    "Typed command",
  );
  assert.deepEqual(
    groups
      .find((group) => group.id === "votecount")
      .actions.map((action) => action.id),
    ["publish_votecount"],
  );
  assert.deepEqual(
    groups
      .find((group) => group.id === "roles")
      .actions.map((action) => action.id),
    ["complete_game"],
  );
  assert.match(
    groups.find((group) => group.id === "roles").boundaryDetail,
    /CompleteGame/,
  );

  const cohostActions = buildHostConsoleCriticalActions("midsummer", {
    capabilityKind: "CohostOf",
    hostPrompts: [
      {
        id: "D01:tie:slot_2",
        label: "tie",
        status: "pending",
        decisionKind: "acknowledge",
      },
    ],
  });
  assert.deepEqual(
    cohostActions.map((action) => action.id),
    ["extend_deadline"],
  );
  const cohostGroups = buildHostConsoleActionGroups({
    actions: cohostActions,
    capabilityKind: "CohostOf",
    pendingPromptCount: 1,
    votecountCount: 2,
  });
  assert.deepEqual(
    cohostGroups.map((group) => [group.id, group.authority]),
    [["deadline", "CohostOf(game)"]],
  );
});

test("host console prompt rows become confirmable typed host actions", () => {
  const actions = buildHostConsoleCriticalActions("game-a", {
    hostPrompts: [
      {
        id: "D01:skip_next_day:slot_1",
        label: "skip_next_day",
        value: "beloved_princess_death",
        status: "pending",
        subjectSlot: "slot_1",
        decisionKind: "acknowledge",
      },
    ],
  });

  const promptAction = actions.find((action) =>
    action.id.startsWith("resolve_host_prompt-"),
  );

  assert.equal(promptAction.label, "Resolve prompt");
  assert.equal(promptAction.payload.kind, "resolve_host_prompt");
  assert.equal(promptAction.payload.promptId, "D01:skip_next_day:slot_1");
  assert.deepEqual(promptAction.payload.decision, { kind: "acknowledge" });
  assert.match(promptAction.confirmationText, /skip_next_day/);
  assert.match(promptAction.confirmationText, /acknowledge prompt/);
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
