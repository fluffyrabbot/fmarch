export const CONFIRMATION_FOCUS_SELECTOR =
  'button, input:not([type="hidden"]), select, textarea, a[href], [tabindex]:not([tabindex="-1"])';

export function focusFirstNewConfirmation({
  items = [],
  focusedConfirmations,
  confirmButtonRefs,
  tick,
  isBrowser = typeof window !== "undefined",
} = {}) {
  if (!isBrowser) {
    return null;
  }
  requireFocusArgs({ focusedConfirmations, confirmButtonRefs, tick });

  const openIds = items
    .filter((item) => item.status?.state === "confirm")
    .map((item) => item.id);
  for (const id of Array.from(focusedConfirmations)) {
    if (!openIds.includes(id)) {
      focusedConfirmations.delete(id);
    }
  }
  for (const id of openIds) {
    if (!focusedConfirmations.has(id)) {
      focusedConfirmations.add(id);
      tick().then(() => confirmButtonRefs[id]?.focus());
      return id;
    }
  }

  return null;
}

export async function returnFocusToTrigger({ item, triggerButtonRefs, tick }) {
  if (item === null || typeof item !== "object") {
    throw new TypeError("confirmation focus return requires an item");
  }
  if (triggerButtonRefs === null || typeof triggerButtonRefs !== "object") {
    throw new TypeError("confirmation focus return requires trigger refs");
  }
  if (typeof tick !== "function") {
    throw new TypeError("confirmation focus return requires a tick function");
  }

  await tick();
  triggerButtonRefs[item.id]?.focus();
}

export function containTabWithinConfirmation(
  event,
  activeElement = globalThis.document?.activeElement,
) {
  if (event?.key !== "Tab") {
    return false;
  }

  const focusable = focusableConfirmationControls(event.currentTarget);
  const first = focusable[0];
  const last = focusable.at(-1);
  if (first === undefined || last === undefined) {
    return false;
  }

  if (event.shiftKey && activeElement === first) {
    event.preventDefault();
    last.focus();
    return true;
  }

  if (!event.shiftKey && activeElement === last) {
    event.preventDefault();
    first.focus();
    return true;
  }

  return false;
}

export function focusableConfirmationControls(root) {
  if (root === null || typeof root !== "object") {
    return [];
  }
  if (typeof root.querySelectorAll !== "function") {
    return [];
  }

  return Array.from(root.querySelectorAll(CONFIRMATION_FOCUS_SELECTOR)).filter(
    (node) =>
      !node.disabled &&
      node.getAttribute("aria-hidden") !== "true" &&
      node.getAttribute("type") !== "hidden",
  );
}

function requireFocusArgs({ focusedConfirmations, confirmButtonRefs, tick }) {
  if (!(focusedConfirmations instanceof Set)) {
    throw new TypeError("confirmation focus tracker requires a Set");
  }
  if (confirmButtonRefs === null || typeof confirmButtonRefs !== "object") {
    throw new TypeError("confirmation focus tracker requires confirm refs");
  }
  if (typeof tick !== "function") {
    throw new TypeError("confirmation focus tracker requires a tick function");
  }
}
