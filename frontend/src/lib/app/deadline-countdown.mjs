// The game bar states a deadline as time remaining (RFC 0008, decision 5): a
// player asks "how long do I have", not "what date is it". The absolute time
// stays available beside it for screen readers and on hover.

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Time left until `deadlineAt` (epoch seconds) as of `now` (epoch ms), or
 * `null` when there is no committed deadline.
 */
export function deadlineCountdown(deadlineAt, now = Date.now()) {
  if (typeof deadlineAt !== "number" || !Number.isFinite(deadlineAt)) return null;
  const left = Math.floor(deadlineAt - now / 1000);
  if (left <= 0) return "Passed";
  if (left < MINUTE) return "Under a minute left";
  const days = Math.floor(left / DAY);
  const hours = Math.floor((left % DAY) / HOUR);
  const minutes = Math.floor((left % HOUR) / MINUTE);
  if (days > 0) return hours > 0 ? `${days}d ${hours}h left` : `${days}d left`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m left` : `${hours}h left`;
  return `${minutes}m left`;
}
