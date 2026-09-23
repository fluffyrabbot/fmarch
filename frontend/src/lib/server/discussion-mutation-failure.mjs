import { fail } from "@sveltejs/kit";

const PASSTHROUGH_STATUSES = new Set([400, 401, 403, 404, 409, 429]);

/**
 * Map a rejected discussion write to a form failure. The unsent draft rides
 * back with every rejection so a plain form post never loses the member's
 * text; a posting-budget rejection (429) also names its wait.
 */
export async function discussionMutationFailure(response, fallback, { id = "discussion-mutation", draft = null } = {}) {
  const payload = await response.json().catch(() => null);
  const status = PASSTHROUGH_STATUSES.has(response.status) ? response.status : 502;
  const retryAfterSeconds = status === 429 ? retryAfterHeaderSeconds(response) : null;
  return fail(status, {
    id,
    state: "reject",
    message: status === 429
      ? postingRateLimitMessage(retryAfterSeconds, { draftKept: draft !== null })
      : typeof payload?.message === "string" ? payload.message : fallback,
    ...(status === 429 ? { rateLimited: true, retryAfterSeconds } : {}),
    ...(draft === null ? {} : { draft }),
  });
}

export function postingRateLimitMessage(retryAfterSeconds, { draftKept = true } = {}) {
  const wait = `You are posting faster than the community limit allows. Try again in ${waitLabel(retryAfterSeconds)}`;
  return draftKept ? `${wait}; your text is kept below.` : `${wait}.`;
}

/** Unique mention handles from submitted `{ handle, offset, len }` spans. */
export function draftMentionHandles(mentions) {
  return [...new Set(mentions.map((mention) => mention.handle))];
}

function waitLabel(seconds) {
  if (!Number.isInteger(seconds) || seconds <= 0) return "a moment";
  if (seconds < 60) return seconds === 1 ? "1 second" : `${seconds} seconds`;
  const minutes = Math.ceil(seconds / 60);
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

function retryAfterHeaderSeconds(response) {
  const value = response?.headers?.get?.("retry-after");
  if (typeof value !== "string" || !/^[0-9]{1,6}$/u.test(value.trim())) return null;
  return Math.max(1, Number(value.trim()));
}
