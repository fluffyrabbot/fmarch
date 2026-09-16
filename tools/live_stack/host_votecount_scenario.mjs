export async function proveHostInitialVoteDelivery({
  page,
  game,
  sendCommand,
  diagnostics = {},
}) {
  let before;
  try {
    // Hello recovers current REST state; it does not replay historical deltas.
    // Cast this fixture vote only after the host has completed that recovery.
    await page.waitForFunction(
      (expectedGame) =>
        window.__fmarchHostLiveProjectionEvents?.some(
          (event) =>
            event?.kind === "hello" &&
            event.state === "recovered" &&
            event.body?.protocol_v === 3 &&
            event.body.scope?.game === expectedGame,
        ),
      game,
    );
    before = await snapshot(page);
    const command = await sendCommand("player-seed", {
      SubmitVote: {
        game,
        actor_slot: "slot-3",
        target: { Slot: "slot_1" },
      },
    });
    await page.waitForFunction(
      ({ expectedGame, eventStart }) =>
        window.__fmarchHostLiveProjectionEvents?.slice(eventStart).some(
          (event) =>
            event?.delta?.kind === "VoteCountChanged" &&
            event.delta.body?.game === expectedGame &&
            event.delta.body?.candidate_slot === "slot_1" &&
            event.delta.body?.count === 1,
        ),
      { expectedGame: game, eventStart: before.eventCount },
    );
    await page.waitForFunction(() =>
      window.__fmarchHostVotecountProjection?.some(
        (row) => row.target === "slot_1" && row.count === 1,
      ),
    );
    return {
      status: "passed",
      command,
      before,
      after: await snapshot(page),
      proof:
        "After the host accepted its exact protocol-v3 Hello and recovered current projections, a new slot-3 vote ACKed, delivered a fresh VoteCountChanged for slot_1, and updated the host projection to count 1 before the player loop began.",
    };
  } catch (error) {
    throw new Error(
      `host initial live vote delivery failed: ${JSON.stringify({
        before,
        after: await snapshot(page),
        ...diagnostics,
      })}`,
      { cause: error },
    );
  }
}

async function snapshot(page) {
  return await page.evaluate(() => ({
    endpoint: window.__fmarchHostLiveProjectionEndpoint,
    eventCount: (window.__fmarchHostLiveProjectionEvents ?? []).length,
    events: window.__fmarchHostLiveProjectionEvents ?? [],
    projection: window.__fmarchHostVotecountProjection ?? [],
  }));
}
