import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acquireLocalProofDatabase,
  localProofDatabaseName,
} from "./dev_test_game_local_database.mjs";
import { localDevTestGameEnvironment } from "./dev_test_game_local.mjs";

test("local proof database names are disposable and bounded", () => {
  assert.equal(
    localProofDatabaseName("dev test game", { pid: 42, timestamp: 1000 }),
    "fmarch_proof_dev_test_game_16_rs",
  );
  const longName = localProofDatabaseName("A very long local proof purpose with punctuation!", {
    pid: 99,
    timestamp: 999999,
  });
  assert.match(longName, /^fmarch_proof_[a-z0-9_]+$/);
  assert.ok(longName.length <= 63);
});

test("an explicit migration URL remains caller-owned", async () => {
  const lease = await acquireLocalProofDatabase("ignored", {
    DATABASE_MIGRATION_URL: "postgres://example.invalid/caller_owned",
  });
  assert.equal(lease.url, "postgres://example.invalid/caller_owned");
  assert.equal(lease.database, null);
  assert.equal(lease.owned, false);
  await lease.release();
  await lease.release();
});

test("the one-command local harness always enables deterministic development auth", () => {
  assert.deepEqual(
    localDevTestGameEnvironment({ FMARCH_DEV_AUTH: "0", KEEP: "yes" }),
    { FMARCH_DEV_AUTH: "1", KEEP: "yes" },
  );
});
