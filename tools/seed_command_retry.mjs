import { setTimeout as delay } from "node:timers/promises";

// Fixture setup may race background writers. Retry only the protocol's explicit
// stream conflict, with the exact serialized command and idempotency identity.
export async function postSeedCommand(url, options, { fetchResponse, pause = delay }) {
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetchResponse(url, options);
    const result = await response.json();
    const reject = result.body;
    const conflict = response.status === 409 && reject?.kind === "Reject"
      && reject.body?.error === "StreamConflict" && reject.body?.retryable === true;
    if (conflict && attempt < maxAttempts) {
      await pause(25 * attempt);
      continue;
    }
    if (!response.ok || result.body?.kind !== "Ack") {
      throw new Error(`seed command failed after ${attempt} attempt(s): HTTP ${response.status}: ${JSON.stringify(result)}`);
    }
    return result;
  }
}
