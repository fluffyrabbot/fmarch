import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertPrivateChannelContext,
  assertPrivateChannelId,
  assertPrivateChannelRouteContext,
  assertPrivateThreadPagerVisible,
} from "./dev_test_game_core_loop_private_channel_context_assertions.mjs";

test("private-channel context assertion accepts scoped channel member context", () => {
  assert.doesNotThrow(() =>
    assertPrivateChannelContext({
      context: {
        channelId: "private:mafia_day_chat",
        actorSlot: "slot_4",
        actorStatus: "alive",
        capabilityLabel: "ChannelMember(private:mafia_day_chat)",
      },
      expectedChannelId: "private:mafia_day_chat",
      expectedActorSlot: "slot_4",
      expectedActorStatus: "alive",
      requireCapabilityLabel: true,
    }),
  );
});

test("private-channel context assertion rejects wrong actor or capability", () => {
  assert.throws(
    () =>
      assertPrivateChannelContext({
        context: {
          channelId: "private:mafia_day_chat",
          actorSlot: "slot-7",
          capabilityLabel: "ChannelMember(main)",
        },
        expectedChannelId: "private:mafia_day_chat",
        expectedActorSlot: "slot_4",
        requireCapabilityLabel: true,
        includeEvidenceInError: true,
      }),
    /private-channel context drifted: .*slot-7/,
  );
});

test("private-channel route context includes thread pager visibility", () => {
  assert.doesNotThrow(() =>
    assertPrivateChannelRouteContext({
      context: {
        channelId: "role-pm",
        actorSlot: "slot-7",
      },
      expectedChannelId: "role-pm",
      expectedActorSlot: "slot-7",
      privateThreadPagerVisible: true,
    }),
  );
  assert.throws(
    () =>
      assertPrivateChannelRouteContext({
        context: {
          channelId: "role-pm",
          actorSlot: "slot-7",
        },
        expectedChannelId: "role-pm",
        expectedActorSlot: "slot-7",
        privateThreadPagerVisible: false,
      }),
    /private-channel route context drifted/,
  );
});

test("private-channel id and pager helpers reject drift", () => {
  assert.doesNotThrow(() =>
    assertPrivateChannelId({
      channelId: "role-pm",
      expectedChannelId: "role-pm",
    }),
  );
  assert.doesNotThrow(() =>
    assertPrivateThreadPagerVisible({
      visible: true,
    }),
  );
  assert.throws(
    () =>
      assertPrivateChannelId({
        channelId: "main",
        expectedChannelId: "role-pm",
      }),
    /private-channel id drifted/,
  );
  assert.throws(
    () =>
      assertPrivateThreadPagerVisible({
        visible: false,
      }),
    /private-channel thread pager drifted/,
  );
});
