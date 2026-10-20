import { seatNames } from "./seat-presenter.mjs";

export const GAME_THREAD_AUTHOR_KINDS = Object.freeze([
  "slot",
  "host_narrator",
  "system",
]);

export function normalizeGameThreadAuthor(value) {
  const kind = typeof value?.kind === "string" ? value.kind : "";
  if (kind === "slot") {
    const slotId = String(value.slot_id ?? value.slotId ?? "").trim();
    if (slotId !== "") {
      return Object.freeze({ kind, slotId });
    }
  }
  if (kind === "host_narrator" || kind === "system") {
    return Object.freeze({ kind });
  }
  return Object.freeze({ kind: "unknown" });
}

/**
 * An author for display. A seat author is named through the roster as of the
 * post's sequence, so a post keeps the name its author held when writing it.
 */
export function gameThreadAuthorLabel(author, { names = seatNames(), at = null } = {}) {
  switch (author?.kind) {
    case "slot":
      return String(author.slotId ?? "").trim() === "" ? "Unknown player" : names.label(author.slotId, { at });
    case "host_narrator":
      return "Host";
    case "system":
      return "System";
    default:
      return "Unknown";
  }
}

export function isHostNarrator(author) {
  return author?.kind === "host_narrator";
}
