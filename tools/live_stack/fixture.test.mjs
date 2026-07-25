import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createLiveStackFixtureTools,
  sqlLiteral,
  stopChild,
} from "./fixture.mjs";

test("live-stack fixture requires an explicit process root", () => {
  assert.throws(
    () => createLiveStackFixtureTools(),
    /fixture cwd is required/,
  );
});

test("live-stack fixture exposes one cohesive scratch-stack toolset", () => {
  const fixture = createLiveStackFixtureTools({
    artifactDir: "/tmp/fmarch-live-stack-contract",
    cwd: "/tmp",
  });

  assert.deepEqual(
    Object.keys(fixture).sort(),
    [
      "createScratchDatabase",
      "dropScratchDatabase",
      "freePort",
      "runProcess",
      "runSql",
      "runSqlScalar",
      "stopChild",
      "writeProgress",
    ],
  );
  assert.equal(Object.isFrozen(fixture), true);
});

test("live-stack SQL literals escape quote boundaries", () => {
  assert.equal(sqlLiteral("player's token"), "'player''s token'");
});

test("stopChild is a no-op for an exited process", async () => {
  let killed = false;
  await stopChild({
    exitCode: 0,
    signalCode: null,
    kill() {
      killed = true;
    },
  });
  assert.equal(killed, false);
});
