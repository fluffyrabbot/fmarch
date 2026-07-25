export function normalizeDayEventRoom(value) {
  if (value === null || typeof value !== "object") {
    return null;
  }
  const eventId = String(value.event_id ?? value.eventId ?? "").trim();
  const channelId = String(value.channel_id ?? value.channelId ?? "").trim();
  if (eventId === "" || !channelId.startsWith("private:event:")) {
    return null;
  }
  const state = String(value.state ?? "scheduled").trim().toLowerCase();
  const rawMemberCount = Number(value.member_count ?? value.memberCount ?? 0);
  return Object.freeze({
    eventId,
    channelId,
    templateKey: String(value.template_key ?? value.templateKey ?? "").trim(),
    state,
    membership: String(value.membership ?? ""),
    memberCount: Number.isFinite(rawMemberCount) ? Math.max(0, rawMemberCount) : 0,
    postingAllowed:
      (value.posting_allowed === true || value.postingAllowed === true) &&
      state === "open",
  });
}

export function dayEventRoomLabel(room) {
  const source = String(room?.templateKey ?? room?.eventId ?? "")
    .split(/[.:/]/u)
    .filter(Boolean)
    .at(-1)
    ?.replace(/[-_]+/gu, " ")
    .trim();
  if (!source) {
    return "Event room";
  }
  return `${source.charAt(0).toUpperCase()}${source.slice(1)} room`;
}

export function dayEventRoomStateLabel(room) {
  const state = String(room?.state ?? "scheduled");
  return state === "open"
    ? "Open for posting"
    : `${state.charAt(0).toUpperCase()}${state.slice(1)} · read-only`;
}
