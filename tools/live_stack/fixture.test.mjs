import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createLiveStackViteLogger,
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

test("live-stack Vite logger suppresses only expected websocket disconnects", () => {
  const errors = [];
  const baseLogger = {
    error(message, options) {
      errors.push({ message, options });
    },
  };
  const logger = createLiveStackViteLogger({
    logger: baseLogger,
  });
  const websocketMessage = "\u001b[31mws proxy error:\u001b[39m\nError: write EPIPE";

  logger.error(websocketMessage, { error: { code: "EPIPE" } });
  logger.error("\u001b[31mhttp proxy error: /games\u001b[39m", {
    error: { code: "EPIPE" },
  });
  logger.error("\u001b[31mws proxy error:\u001b[39m", {
    error: { code: "ETIMEDOUT" },
  });

  assert.deepEqual(
    errors.map(({ options }) => options.error.code),
    ["EPIPE", "ETIMEDOUT"],
  );
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
