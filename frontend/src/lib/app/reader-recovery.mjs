export function readerRecoveryMessage({ state, intent }) {
  if (state === "pending") return intent === "newest" ? "Loading the newest posts…" : "Finding your place in the thread…";
  if (state === "denied") return "You no longer have access to this channel.";
  if (state === "unavailable") return intent === "newest" ? "The newest posts are unavailable." : "The original post is unavailable.";
  if (state === "cancelled") return "Recovery cancelled. Your place is still saved.";
  if (state === "error") return intent === "newest" ? "Could not load the newest posts. Your place is still saved." : "Could not restore your place. Retry when your connection is available.";
  return "";
}
