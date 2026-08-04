import crypto from "node:crypto";

export const DAY_EVENT_ROOM_SCOPE = "day-event-room";

export function createDayEventRoomFixture({ randomUUID = crypto.randomUUID } = {}) {
  const eventId = "event-browser-room";
  return Object.freeze({
    game: randomUUID(),
    eventId,
    channelId: `private:event:${eventId}`,
    outgoing: Object.freeze({
      slotId: "event-room-slot",
      principalUserId: "event-room-outgoing",
      sessionToken: `host-console-live-stack-event-room-outgoing-${randomUUID()}`,
    }),
    incoming: Object.freeze({
      principalUserId: "event-room-incoming",
      sessionToken: `host-console-live-stack-event-room-incoming-${randomUUID()}`,
    }),
  });
}

export async function seedDayEventRoom({ fixture, sendCommand }) {
  const commands = [];
  for (const command of [
    { CreateGame: { game: fixture.game, pack: "mafiascum" } },
    { AddSlot: { game: fixture.game, slot: fixture.outgoing.slotId } },
    {
      AssignSlot: {
        game: fixture.game,
        slot: fixture.outgoing.slotId,
        user: fixture.outgoing.principalUserId,
      },
    },
    {
      AssignRole: {
        game: fixture.game,
        slot: fixture.outgoing.slotId,
        role_key: "vanilla_townie",
      },
    },
    { StartGame: { game: fixture.game, phase: "D01" } },
    {
      ScheduleDayEvent: {
        game: fixture.game,
        event: {
          id: fixture.eventId,
          program_id: "program-browser-proof",
          template_key: "theme.raffle",
          phase_scope: { kind: "during_day", number: 1 },
          schedule: { kind: "host_opened" },
          participation: {
            who: "alive_slots",
            mode: "opt_in",
            limits: { minimum: 1, maximum: null },
          },
          state: "scheduled",
          resolution: "host_decision",
          rewards: [{
            reward_key: "cookie",
            display_name_theme_key: "theme.cookie",
            effects: [{
              recipient: { kind: "winner" },
              operation: { kind: "mark", effect: "bomb" },
            }],
          }],
          narrative: {
            opened: null,
            locked: null,
            resolved: null,
            cancelled: null,
          },
          channel_policy: {
            visibility: "private",
            membership: "participants",
          },
        },
      },
    },
    {
      OpenDayEvent: {
        game: fixture.game,
        event_id: fixture.eventId,
      },
    },
  ]) {
    commands.push(await sendCommand("host_h", command));
  }
  return {
    game: fixture.game,
    eventId: fixture.eventId,
    channelId: fixture.channelId,
    slotId: fixture.outgoing.slotId,
    commands,
    boundary:
      "A real host-opened, participant-scoped private DayEvent begins with no room members; the browser owns every subsequent membership and room-lifecycle transition.",
  };
}

export async function createDayEventRoomSessions({
  fixture,
  createAccountSession,
}) {
  return {
    outgoing: await createAccountSession({
      token: fixture.outgoing.sessionToken,
      principalUserId: fixture.outgoing.principalUserId,
      label: "day-event-room-outgoing",
    }),
    incoming: await createAccountSession({
      token: fixture.incoming.sessionToken,
      principalUserId: fixture.incoming.principalUserId,
      label: "day-event-room-incoming",
    }),
  };
}

export async function driveDayEventRoomBrowser({
  apiBaseUrl,
  browser,
  fetchJson,
  fixture,
  frontendBaseUrl,
  seed,
  sendCommand,
  sessionTokenFor = (token) => token,
  hostSessionToken,
  viewport,
}) {
  const secret = "DayEvent browser room history survives its lifecycle";
  const browserContextWithSession = async (token) => {
    const context = await browser.newContext({ viewport });
    await context.addCookies([{
      name: "fmarch_session",
      value: sessionTokenFor(token),
      domain: new URL(frontendBaseUrl).hostname,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    }]);
    return context;
  };
  const outgoingContext = await browserContextWithSession(
    fixture.outgoing.sessionToken,
  );
  const outgoingPage = await outgoingContext.newPage();
  const mainUrl = `${frontendBaseUrl}/g/${fixture.game}`;
  const roomUrl =
    `${frontendBaseUrl}/g/${fixture.game}/c/${encodeURIComponent(fixture.channelId)}`;
  const initial = await outgoingPage.goto(mainUrl, { waitUntil: "networkidle" });
  if (initial === null || !initial.ok()) {
    throw new Error(`DayEvent outgoing player route failed (${initial?.status()})`);
  }
  try {
    await outgoingPage.getByTestId(`player-day-event-${fixture.eventId}`).waitFor({
      state: "visible",
      timeout: 15_000,
    });
  } catch {
    const apiCommandState = await fetchJson(
      `${apiBaseUrl}/games/${fixture.game}/player-command-state?slot_id=${fixture.outgoing.slotId}`,
      {
        headers: {
          authorization: `Bearer ${sessionTokenFor(fixture.outgoing.sessionToken)}`,
        },
      },
    );
    throw new Error(
      `seeded DayEvent was absent from the outgoing player route: browser=${JSON.stringify(await outgoingPage.evaluate(() => ({
        url: location.href,
        body: document.body.innerText,
        projection: window.__fmarchPlayerProjection,
      })))} api=${JSON.stringify(apiCommandState)}`,
    );
  }
  if (await outgoingPage.getByTestId(`player-channel-${fixture.channelId}`).count()) {
    throw new Error("participant-scoped DayEvent room appeared before joining");
  }

  const [joinResponse] = await Promise.all([
    outgoingPage.waitForResponse(
      (response) =>
        response.url().endsWith("/commands") &&
        response.request().method() === "POST",
    ),
    outgoingPage.locator(`[data-action="submit_day_event:${fixture.eventId}"]`).click(),
  ]);
  const roomTab = outgoingPage.getByTestId(
    `player-channel-${fixture.channelId}`,
  );
  try {
    await roomTab.waitFor({ state: "visible", timeout: 15_000 });
  } catch {
    const browserState = await outgoingPage.evaluate(() => ({
      status: window.__fmarchPlayerCommandStatus,
      commandState: window.__fmarchPlayerProjection?.commandState,
      body: document.body.innerText,
    }));
    const apiCommandState = await fetchJson(
      `${apiBaseUrl}/games/${fixture.game}/player-command-state?slot_id=${fixture.outgoing.slotId}`,
      {
        headers: {
          authorization: `Bearer ${sessionTokenFor(fixture.outgoing.sessionToken)}`,
        },
      },
    );
    throw new Error(
      `joined DayEvent room did not appear: command=${await joinResponse.text()} browser=${JSON.stringify(browserState)} api=${JSON.stringify(apiCommandState)}`,
    );
  }
  if ((await roomTab.getAttribute("data-room-state")) !== "open") {
    throw new Error("joined DayEvent room did not project open state");
  }

  await roomTab.click();
  await outgoingPage.waitForURL(roomUrl);
  try {
    await outgoingPage.getByTestId("player-composer").waitFor({
      state: "visible",
      timeout: 15_000,
    });
  } catch {
    throw new Error(
      `joined DayEvent room did not expose composer: ${JSON.stringify(await outgoingPage.evaluate(() => ({
        url: location.href,
        body: document.body.innerText,
        readOnly: document.querySelector('[data-testid="player-composer-read-only"]')?.innerText,
        projection: window.__fmarchPlayerProjection,
      })))}`,
    );
  }
  await outgoingPage.getByTestId("player-composer").locator("textarea").fill(secret);
  await Promise.all([
    outgoingPage.waitForResponse(
      (response) =>
        response.url().endsWith("/commands") &&
        response.request().method() === "POST",
    ),
    outgoingPage.locator('[data-action="submit_post"]').click(),
  ]);
  await outgoingPage.getByText(secret, { exact: false }).waitFor({ state: "visible" });

  await Promise.all([
    outgoingPage.waitForResponse(
      (response) =>
        response.url().endsWith("/commands") &&
        response.request().method() === "POST",
    ),
    outgoingPage
      .locator(`[data-action="withdraw_day_event:${fixture.eventId}"]`)
      .click(),
  ]);
  await outgoingPage.getByTestId("player-composer-read-only").waitFor({
    state: "visible",
  });
  if (await outgoingPage.getByText(secret, { exact: false }).count()) {
    throw new Error("withdrawn DayEvent member retained private history in the DOM");
  }
  if (await roomTab.count()) {
    throw new Error("withdrawn DayEvent room remained in channel discovery");
  }

  await Promise.all([
    outgoingPage.waitForResponse(
      (response) =>
        response.url().endsWith("/commands") &&
        response.request().method() === "POST",
    ),
    outgoingPage.locator(`[data-action="submit_day_event:${fixture.eventId}"]`).click(),
  ]);
  await roomTab.waitFor({ state: "visible" });
  await outgoingPage.goto(roomUrl, { waitUntil: "networkidle" });
  await outgoingPage.getByText(secret, { exact: false }).waitFor({ state: "visible" });

  const replacement = await sendCommand("host_h", {
    ProcessReplacement: {
      game: fixture.game,
      slot: fixture.outgoing.slotId,
      outgoing_user: fixture.outgoing.principalUserId,
      incoming_user: fixture.incoming.principalUserId,
    },
  });
  await outgoingPage.evaluate(async () => {
    await window.__fmarchTriggerPlayerResync?.();
  });
  await outgoingPage.waitForFunction(
    (channelTestId) =>
      window.__fmarchPlayerProjection?.commandState?.actorStatus === "replaced" &&
      document.querySelector(`[data-testid="${channelTestId}"]`) === null,
    `player-channel-${fixture.channelId}`,
  );
  if (await outgoingPage.getByText(secret, { exact: false }).count()) {
    throw new Error("replaced DayEvent occupant retained private history in the DOM");
  }

  const incomingContext = await browserContextWithSession(
    fixture.incoming.sessionToken,
  );
  const incomingPage = await incomingContext.newPage();
  const incoming = await incomingPage.goto(roomUrl, { waitUntil: "networkidle" });
  if (incoming === null || !incoming.ok()) {
    throw new Error(`incoming DayEvent replacement route failed (${incoming?.status()})`);
  }
  await incomingPage.getByText(secret, { exact: false }).waitFor({ state: "visible" });
  const incomingTab = incomingPage.getByTestId(
    `player-channel-${fixture.channelId}`,
  );
  if ((await incomingTab.getAttribute("data-room-state")) !== "open") {
    throw new Error("replacement did not inherit the open DayEvent room descriptor");
  }

  const lock = await sendCommand("host_h", {
    LockDayEvent: {
      game: fixture.game,
      event_id: fixture.eventId,
    },
  });
  await incomingPage.evaluate(async () => {
    await window.__fmarchTriggerPlayerResync?.();
  });
  await incomingPage.waitForFunction(
    (testId) =>
      document.querySelector(`[data-testid="${testId}"]`)?.getAttribute(
        "data-room-state",
      ) === "locked",
    `player-channel-${fixture.channelId}`,
  );
  await incomingPage.getByTestId("player-composer-read-only").waitFor({
    state: "visible",
  });
  await incomingPage.getByText(secret, { exact: false }).waitFor({ state: "visible" });

  const hostState = await fetchJson(
    `${apiBaseUrl}/games/${fixture.game}/host-console-state?principal_user_id=host_h&slot_id=${fixture.outgoing.slotId}`,
    { headers: { authorization: `Bearer ${hostSessionToken}` } },
  );
  const hostRoom = hostState.day_events?.find(
    (event) => event.event_id === fixture.eventId,
  )?.room;
  if (
    hostRoom?.channel_id !== fixture.channelId ||
    hostRoom?.member_count !== 1 ||
    hostRoom?.posting_allowed !== false
  ) {
    throw new Error(
      `host DayEvent room membership projection drifted: ${JSON.stringify(hostRoom)}`,
    );
  }

  await Promise.all(
    [outgoingPage, incomingPage].map((page) =>
      page.evaluate(() => window.__fmarchClosePlayerLiveProjection?.()),
    ),
  );
  await Promise.all(
    [outgoingPage, incomingPage].map((page) =>
      page.waitForLoadState("networkidle", { timeout: 5_000 }),
    ),
  );
  await outgoingContext.close();
  await incomingContext.close();
  return {
    status: "passed",
    game: fixture.game,
    eventId: fixture.eventId,
    channelId: fixture.channelId,
    seed,
    replacement,
    lock,
    finalHostRoom: hostRoom,
    proof:
      "A browser joined a participant-scoped DayEvent, discovered its typed room, posted history, withdrew and immediately lost room/history DOM access, rejoined, transferred the slot to a replacement who inherited history, then retained that history with a lifecycle-aware read-only composer after host lock; the host projection reported one retained member.",
  };
}
