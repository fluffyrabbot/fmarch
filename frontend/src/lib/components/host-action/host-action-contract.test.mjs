import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  HOST_ACTION_CONTRACT,
  TOUCH_CONTROL_CONTRACT,
  buildHostActionViewModel,
  createHostActionController,
} from "./host-action-contract.mjs";

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
  assert.equal(view.confirmation.role, HOST_ACTION_CONTRACT.confirmationRole);
  assert.match(view.confirmation.message, /Slot 7 \/ Mira/);
  assert.match(view.confirmation.message, /mark dead and lock voting power/);

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
    },
  ]);
});

test("canceling a confirmation does not dispatch", () => {
  const dispatched = [];
  const action = createHostActionController(
    {
      id: "advance-phase",
      label: "Advance phase",
      objectLabel: "Day 2",
      outcomeLabel: "close thread and enter night",
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
          id: "advance-phase",
          label: "Advance phase",
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
          id: "advance-phase",
          label: "Advance phase",
          objectLabel: "Day 2",
          irreversible: true,
        },
        () => {},
      ),
    /intended outcome/,
  );
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
