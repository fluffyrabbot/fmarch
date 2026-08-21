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

export function gameThreadAuthorLabel(author) {
  switch (author?.kind) {
    case "slot":
      return String(author.slotId ?? "").trim() || "Unknown player";
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
