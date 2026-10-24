// A sheet body or the desktop rail scrolls on its own; the document scrolls
// everything else. Position restoration must move the container that holds
// the element, or it moves the wrong thing.
export function scrollContainerFor(element) {
  return element?.closest?.("[data-scroll-container]") ?? null;
}

/** Something with `scrollBy({ top, behavior })` for `element`'s scroller. */
export function scrollerFor(element, windowRef = window) {
  return scrollContainerFor(element) ?? windowRef;
}
