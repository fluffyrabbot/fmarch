import assert from "node:assert/strict";
import { test } from "node:test";
import {
  containTabWithinConfirmation,
  focusFirstNewConfirmation,
  focusableConfirmationControls,
  returnFocusToTrigger,
} from "./confirmation-focus.mjs";

test("focusFirstNewConfirmation focuses only newly opened confirm rows", async () => {
  const focused = new Set(["closed"]);
  const focusedIds = [];
  const confirmButtonRefs = {
    open: {
      focus: () => focusedIds.push("open"),
    },
  };
  const tick = async () => {};

  const focusedId = focusFirstNewConfirmation({
    items: [
      { id: "closed", status: { state: "ack" } },
      { id: "open", status: { state: "confirm" } },
    ],
    focusedConfirmations: focused,
    confirmButtonRefs,
    tick,
    isBrowser: true,
  });
  await Promise.resolve();

  assert.equal(focusedId, "open");
  assert.deepEqual(Array.from(focused), ["open"]);
  assert.deepEqual(focusedIds, ["open"]);
});

test("focusFirstNewConfirmation is inert during SSR", () => {
  const focused = new Set();
  const focusedId = focusFirstNewConfirmation({
    items: [{ id: "open", status: { state: "confirm" } }],
    focusedConfirmations: focused,
    confirmButtonRefs: {},
    tick: async () => {},
    isBrowser: false,
  });

  assert.equal(focusedId, null);
  assert.equal(focused.size, 0);
});

test("returnFocusToTrigger waits for the DOM update before focusing trigger", async () => {
  const calls = [];
  await returnFocusToTrigger({
    item: { id: "cohost" },
    triggerButtonRefs: {
      cohost: {
        focus: () => calls.push("focus"),
      },
    },
    tick: async () => calls.push("tick"),
  });

  assert.deepEqual(calls, ["tick", "focus"]);
});

test("containTabWithinConfirmation loops focus at both edges", () => {
  const calls = [];
  const first = control("first", calls);
  const middle = control("middle", calls);
  const last = control("last", calls);
  const root = {
    querySelectorAll: () => [first, middle, last],
  };

  const forwardEvent = event({ currentTarget: root, shiftKey: false });
  assert.equal(containTabWithinConfirmation(forwardEvent, last), true);
  assert.equal(forwardEvent.prevented, true);
  assert.deepEqual(calls, ["first"]);

  const reverseEvent = event({ currentTarget: root, shiftKey: true });
  assert.equal(containTabWithinConfirmation(reverseEvent, first), true);
  assert.equal(reverseEvent.prevented, true);
  assert.deepEqual(calls, ["first", "last"]);

  const middleEvent = event({ currentTarget: root, shiftKey: false });
  assert.equal(containTabWithinConfirmation(middleEvent, middle), false);
  assert.equal(middleEvent.prevented, false);
});

test("focusableConfirmationControls ignores disabled and aria-hidden controls", () => {
  const enabled = control("enabled", []);
  const hidden = control("hidden", [], { ariaHidden: "true" });
  const hiddenInput = control("hidden-input", [], { type: "hidden" });
  const disabled = control("disabled", [], { disabled: true });
  const root = {
    querySelectorAll: () => [enabled, hidden, hiddenInput, disabled],
  };

  assert.deepEqual(focusableConfirmationControls(root), [enabled]);
});

function event({ currentTarget, shiftKey }) {
  return {
    key: "Tab",
    currentTarget,
    shiftKey,
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
  };
}

function control(
  id,
  calls,
  { disabled = false, ariaHidden = null, type = null } = {},
) {
  return {
    id,
    disabled,
    focus: () => calls.push(id),
    getAttribute(name) {
      if (name === "aria-hidden") {
        return ariaHidden;
      }
      if (name === "type") {
        return type;
      }
      return null;
    },
  };
}
