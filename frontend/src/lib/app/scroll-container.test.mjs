import assert from "node:assert/strict";
import { test } from "node:test";
import { scrollContainerFor, scrollerFor } from "./scroll-container.mjs";

test("elements inside a marked container scroll that container, others scroll the window", () => {
  const container = { id: "sheet-body" };
  const inside = { closest: (selector) => selector === "[data-scroll-container]" ? container : null };
  const outside = { closest: () => null };
  const windowRef = { scrollBy() {} };
  assert.equal(scrollContainerFor(inside), container);
  assert.equal(scrollContainerFor(outside), null);
  assert.equal(scrollContainerFor(null), null);
  assert.equal(scrollerFor(inside, windowRef), container);
  assert.equal(scrollerFor(outside, windowRef), windowRef);
});
