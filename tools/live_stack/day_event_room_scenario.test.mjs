import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DAY_EVENT_ROOM_SCOPE,
  createDayEventRoomFixture,
  createDayEventRoomSessions,
  seedDayEventRoom,
} from "./day_event_room_scenario.mjs";

test("DayEvent room fixture owns stable scenario identity and fresh credentials", () => {
  const ids = ["game-id", "outgoing-token-id", "incoming-token-id"];
  const fixture = createDayEventRoomFixture({
    randomUUID: () => ids.shift(),
  });

  assert.equal(DAY_EVENT_ROOM_SCOPE, "day-event-room");
  assert.equal(fixture.game, "game-id");
  assert.equal(fixture.eventId, "event-browser-room");
  assert.equal(fixture.channelId, "private:event:event-browser-room");
  assert.equal(fixture.outgoing.slotId, "event-room-slot");
  assert.match(fixture.outgoing.sessionToken, /outgoing-token-id$/);
  assert.match(fixture.incoming.sessionToken, /incoming-token-id$/);
  assert.equal(Object.isFrozen(fixture), true);
  assert.equal(Object.isFrozen(fixture.outgoing), true);
});

test("DayEvent room seeding preserves the full command-owned lifecycle boundary", async () => {
  const fixture = createDayEventRoomFixture({
    randomUUID: sequence(["game-id", "outgoing-token-id", "incoming-token-id"]),
  });
  const observed = [];
  const seed = await seedDayEventRoom({
    fixture,
    sendCommand: async (principalUserId, command) => {
      observed.push({ principalUserId, command });
      return { sequence: observed.length };
    },
  });

  assert.equal(observed.length, 7);
  assert.deepEqual(
    observed.map(({ principalUserId }) => principalUserId),
    Array(7).fill("host_h"),
  );
  assert.deepEqual(observed[0].command, {
    CreateGame: { game: "game-id", pack: "mafiascum" },
  });
  assert.deepEqual(observed.at(-1).command, {
    OpenDayEvent: {
      game: "game-id",
      event_id: "event-browser-room",
    },
  });
  const scheduled = observed.find(({ command }) => command.ScheduleDayEvent);
  assert.equal(
    scheduled.command.ScheduleDayEvent.event.channel_policy.membership,
    "participants",
  );
  assert.equal(seed.commands.length, 7);
  assert.equal(seed.channelId, fixture.channelId);
});

test("DayEvent room sessions are created through the enabled-account boundary", async () => {
  const fixture = createDayEventRoomFixture({
    randomUUID: sequence(["game-id", "outgoing-token-id", "incoming-token-id"]),
  });
  const observed = [];
  const sessions = await createDayEventRoomSessions({
    fixture,
    createAccountSession: async (input) => {
      observed.push(input);
      return { principalUserId: input.principalUserId };
    },
  });

  assert.deepEqual(
    observed.map(({ label, principalUserId }) => ({ label, principalUserId })),
    [
      {
        label: "day-event-room-outgoing",
        principalUserId: "event-room-outgoing",
      },
      {
        label: "day-event-room-incoming",
        principalUserId: "event-room-incoming",
      },
    ],
  );
  assert.equal(sessions.outgoing.principalUserId, "event-room-outgoing");
  assert.equal(sessions.incoming.principalUserId, "event-room-incoming");
});

function sequence(values) {
  return () => {
    const value = values.shift();
    if (value === undefined) throw new Error("deterministic UUID sequence exhausted");
    return value;
  };
}
