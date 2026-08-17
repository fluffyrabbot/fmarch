import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COMMAND_RECOVERY_STORAGE_PREFIX,
  clearInterruptedCommandAttempts,
  commandRecoveryStorageKey,
  persistInterruptedCommandAttempts,
  readInterruptedCommandAttempts,
} from "./command-recovery-storage.mjs";

test("persists interrupted command identities and drops route data", () => {
  const storage = memoryStorage();
  const written = persistInterruptedCommandAttempts({
    storage,
    game: "midsummer",
    surface: "player",
    attempts: {
      submit_vote: {
        commandId: "stable-vote-id",
        action: "submit_vote",
        interruption: "timeout",
        composerBody: "unused",
        data: { secrets: "do-not-store" },
      },
    },
  });

  assert.equal(written, true);
  assert.equal(
    commandRecoveryStorageKey({ game: "midsummer", surface: "player" }),
    `${COMMAND_RECOVERY_STORAGE_PREFIX}player:midsummer`,
  );
  assert.deepEqual(
    readInterruptedCommandAttempts({
      storage,
      game: "midsummer",
      surface: "player",
    }),
    {
      submit_vote: {
        commandId: "stable-vote-id",
        actionId: "submit_vote",
        action: "submit_vote",
        interruption: "timeout",
        composerBody: "unused",
      },
    },
  );
  assert.equal(
    JSON.parse(storage.getItem(`${COMMAND_RECOVERY_STORAGE_PREFIX}player:midsummer`))
      .attempts.submit_vote.data,
    undefined,
  );
});

test("clears storage when the last interrupted command is dismissed", () => {
  const storage = memoryStorage();
  persistInterruptedCommandAttempts({
    storage,
    game: "midsummer",
    surface: "moderator",
    attempts: {
      extend_deadline: {
        commandId: "host-command-1",
        actionId: "extend_deadline",
        interruption: "connection_lost",
        event: { actionId: "extend_deadline", hours: 12 },
      },
    },
  });

  persistInterruptedCommandAttempts({
    storage,
    game: "midsummer",
    surface: "moderator",
    attempts: {},
  });
  assert.deepEqual(
    readInterruptedCommandAttempts({
      storage,
      game: "midsummer",
      surface: "moderator",
    }),
    {},
  );
  assert.equal(clearInterruptedCommandAttempts({ storage: null, game: "midsummer", surface: "player" }), false);
});

test("rejects corrupt or mismatched recovery records instead of replaying them", () => {
  const storage = memoryStorage();
  const key = commandRecoveryStorageKey({ game: "midsummer", surface: "player" });
  storage.setItem(key, "{not-json");
  assert.deepEqual(
    readInterruptedCommandAttempts({
      storage,
      game: "midsummer",
      surface: "player",
    }),
    {},
  );

  persistInterruptedCommandAttempts({
    storage,
    game: "midsummer",
    surface: "player",
    attempts: {
      submit_post: { commandId: "post-1", action: "submit_post" },
    },
  });
  assert.deepEqual(
    readInterruptedCommandAttempts({
      storage,
      game: "other-game",
      surface: "player",
    }),
    {},
  );
  assert.deepEqual(
    readInterruptedCommandAttempts({
      storage: null,
      game: "midsummer",
      surface: "player",
    }),
    {},
  );
});

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}
