import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COMMAND_RECOVERY_STORAGE_PREFIX,
  clearInterruptedCommandAttempts,
  commandRecoveryStorageAvailable,
  commandRecoveryStorageKey,
  persistInterruptedCommandAttempts,
  readInterruptedCommandAttempts,
  resolveCommandRecoveryStorage,
} from "./command-recovery-storage.mjs";

test("persists exact interrupted commands and drops route data", () => {
  const storage = memoryStorage();
  const written = persistInterruptedCommandAttempts({
    storage,
    game: "midsummer",
    surface: "player",
    authority: "player:principal-a:slot-7",
    attempts: {
      submit_vote: {
        commandId: "stable-vote-id",
        action: "submit_vote",
        interruption: "timeout",
        composerBody: "unused",
        command: { SubmitVote: { game: "midsummer", actor_slot: "slot-7", target: { Slot: "slot-2" } } },
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
      authority: "player:principal-a:slot-7",
    }),
    {
      submit_vote: {
        commandId: "stable-vote-id",
        actionId: "submit_vote",
        action: "submit_vote",
        interruption: "timeout",
        command: { SubmitVote: { game: "midsummer", actor_slot: "slot-7", target: { Slot: "slot-2" } } },
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
    authority: "host:principal-a",
    attempts: {
      extend_deadline: {
        commandId: "host-command-1",
        actionId: "extend_deadline",
        interruption: "connection_lost",
        command: { ExtendDeadline: { game: "midsummer", phase: "D01", at: 1_800_000_000 } },
        event: { actionId: "extend_deadline", hours: 12 },
      },
    },
  });

  persistInterruptedCommandAttempts({
    storage,
    game: "midsummer",
    surface: "moderator",
    authority: "host:principal-a",
    attempts: {},
  });
  assert.deepEqual(
    readInterruptedCommandAttempts({
      storage,
      game: "midsummer",
      surface: "moderator",
      authority: "host:principal-a",
    }),
    {},
  );
  assert.equal(clearInterruptedCommandAttempts({ storage: null, game: "midsummer", surface: "player" }), false);
});

test("moderator recovery refuses records that do not contain the exact wire command", () => {
  const storage = memoryStorage();
  persistInterruptedCommandAttempts({
    storage,
    game: "midsummer",
    surface: "moderator",
    authority: "host:principal-a",
    attempts: {
      extend_deadline: {
        commandId: "host-command-1",
        actionId: "extend_deadline",
        event: { actionId: "extend_deadline" },
      },
    },
  });

  assert.deepEqual(
    readInterruptedCommandAttempts({
      storage,
      game: "midsummer",
      surface: "moderator",
      authority: "host:principal-a",
    }),
    {},
  );
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
      authority: "player:principal-a:slot-7",
    }),
    {},
  );

  persistInterruptedCommandAttempts({
    storage,
    game: "midsummer",
    surface: "player",
    authority: "player:principal-a:slot-7",
    attempts: {
      submit_post: {
        commandId: "post-1",
        action: "submit_post",
        command: { SubmitPost: { game: "midsummer", actor_slot: "slot-7" } },
      },
    },
  });
  assert.deepEqual(
    readInterruptedCommandAttempts({
      storage,
      game: "other-game",
      surface: "player",
      authority: "player:principal-a:slot-7",
    }),
    {},
  );
  assert.deepEqual(
    readInterruptedCommandAttempts({
      storage: null,
      game: "midsummer",
      surface: "player",
      authority: "player:principal-a:slot-7",
    }),
    {},
  );
});

test("rejects a recovery record after the session authority changes", () => {
  const storage = memoryStorage();
  persistInterruptedCommandAttempts({
    storage,
    game: "midsummer",
    surface: "player",
    authority: "player:principal-a:slot-7",
    attempts: {
      submit_vote: {
        commandId: "vote-1",
        action: "submit_vote",
        command: { SubmitVote: { game: "midsummer", actor_slot: "slot-7", target: { Slot: "slot-2" } } },
      },
    },
  });

  assert.deepEqual(
    readInterruptedCommandAttempts({
      storage,
      game: "midsummer",
      surface: "player",
      authority: "player:principal-b:slot-7",
    }),
    {},
  );
});

test("reports recovery storage availability without mutating it", () => {
  const storage = memoryStorage();
  assert.equal(commandRecoveryStorageAvailable(storage), true);
  assert.equal(commandRecoveryStorageAvailable(null), false);
  assert.equal(storage.size(), 0);

  const throwingGetter = new Proxy(
    {},
    {
      get() {
        throw storageError("SecurityError");
      },
    },
  );
  assert.equal(commandRecoveryStorageAvailable(throwingGetter), false);

  const throwingRead = throwingStorage({ get: "SecurityError" });
  assert.equal(commandRecoveryStorageAvailable(throwingRead), false);
});

test("resolves session storage without trusting browser getters or probes", () => {
  const storage = memoryStorage();
  assert.equal(resolveCommandRecoveryStorage({ sessionStorage: storage }), storage);
  assert.equal(resolveCommandRecoveryStorage(null), null);
  assert.equal(
    resolveCommandRecoveryStorage({
      get sessionStorage() {
        throw storageError("SecurityError");
      },
    }),
    null,
  );
  assert.equal(
    resolveCommandRecoveryStorage({
      sessionStorage: throwingStorage({ get: "SecurityError" }),
    }),
    null,
  );
  assert.equal(storage.size(), 0);
});

test("browser storage exceptions never escape recovery operations", () => {
  const throwingRead = throwingStorage({ get: "SecurityError" });
  assert.deepEqual(
    readInterruptedCommandAttempts({
      storage: throwingRead,
      game: "midsummer",
      surface: "player",
      authority: "player:principal-a:slot-7",
    }),
    {},
  );

  const quotaExceeded = throwingStorage({ set: "QuotaExceededError" });
  assert.equal(
    persistInterruptedCommandAttempts({
      storage: quotaExceeded,
      game: "midsummer",
      surface: "player",
      authority: "player:principal-a:slot-7",
      attempts: recoverablePlayerAttempts(),
    }),
    false,
  );

  const throwingRemove = throwingStorage({ remove: "SecurityError" });
  assert.equal(
    persistInterruptedCommandAttempts({
      storage: throwingRemove,
      game: "midsummer",
      surface: "player",
      authority: "player:principal-a:slot-7",
      attempts: {},
    }),
    false,
  );
  assert.equal(
    clearInterruptedCommandAttempts({
      storage: throwingRemove,
      game: "midsummer",
      surface: "player",
    }),
    false,
  );

  const corruptAndUnremovable = throwingStorage({
    value: "{not-json",
    remove: "SecurityError",
  });
  assert.deepEqual(
    readInterruptedCommandAttempts({
      storage: corruptAndUnremovable,
      game: "midsummer",
      surface: "player",
      authority: "player:principal-a:slot-7",
    }),
    {},
  );
});

test("JSON serialization failures make persistence unavailable without throwing", () => {
  const storage = memoryStorage();
  const circularCommand = {};
  circularCommand.self = circularCommand;

  assert.equal(
    persistInterruptedCommandAttempts({
      storage,
      game: "midsummer",
      surface: "player",
      authority: "player:principal-a:slot-7",
      attempts: {
        submit_vote: {
          commandId: "vote-circular",
          action: "submit_vote",
          command: circularCommand,
        },
      },
    }),
    false,
  );
  assert.equal(storage.size(), 0);
});

function memoryStorage() {
  const values = new Map();
  return {
    size() {
      return values.size;
    },
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

function throwingStorage({ value = null, get = null, set = null, remove = null } = {}) {
  return {
    getItem() {
      if (get !== null) throw storageError(get);
      return value;
    },
    setItem() {
      if (set !== null) throw storageError(set);
    },
    removeItem() {
      if (remove !== null) throw storageError(remove);
    },
  };
}

function storageError(name) {
  const error = new Error(name);
  error.name = name;
  return error;
}

function recoverablePlayerAttempts() {
  return {
    submit_vote: {
      commandId: "vote-1",
      action: "submit_vote",
      command: {
        SubmitVote: {
          game: "midsummer",
          actor_slot: "slot-7",
          target: { Slot: "slot-2" },
        },
      },
    },
  };
}
