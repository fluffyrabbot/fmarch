import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  FRONTEND_FIXTURE_MODE_ENV,
  PRODUCTION_FIXTURE_MODE_ERROR,
  frontendFixtureMode,
} from "./runtime-mode.mjs";

test("fixture mode is an explicit non-production runtime mode", () => {
  assert.equal(frontendFixtureMode({}), false);
  assert.equal(frontendFixtureMode({ [FRONTEND_FIXTURE_MODE_ENV]: "0" }), false);
  assert.equal(frontendFixtureMode({ [FRONTEND_FIXTURE_MODE_ENV]: "true" }), false);
  assert.equal(frontendFixtureMode({ [FRONTEND_FIXTURE_MODE_ENV]: "1" }), true);
  assert.equal(
    frontendFixtureMode({
      NODE_ENV: "development",
      [FRONTEND_FIXTURE_MODE_ENV]: "1",
    }),
    true,
  );
});

test("production fails closed when frontend fixture mode is enabled", () => {
  assert.throws(
    () =>
      frontendFixtureMode({
        NODE_ENV: "production",
        [FRONTEND_FIXTURE_MODE_ENV]: "1",
      }),
    (failure) => {
      assert.equal(failure.name, PRODUCTION_FIXTURE_MODE_ERROR.name);
      assert.equal(failure.code, PRODUCTION_FIXTURE_MODE_ERROR.code);
      assert.equal(failure.message, PRODUCTION_FIXTURE_MODE_ERROR.message);
      return true;
    },
  );
});

test("runtime modules cannot bypass the centralized fixture-mode guard", async () => {
  const sourceRoot = new URL("../../", import.meta.url);
  const entries = await readdir(sourceRoot, { recursive: true });
  const exemptions = new Set([
    "lib/server/runtime-mode.mjs",
  ]);
  const productionModules = entries.filter(
    (entry) =>
      /\.(?:js|mjs)$/u.test(entry) &&
      !entry.endsWith(".test.mjs") &&
      !exemptions.has(entry),
  );

  for (const modulePath of productionModules) {
    const source = await readFile(new URL(modulePath, sourceRoot), "utf8");
    assert.doesNotMatch(
      source,
      /FMARCH_FRONTEND_FIXTURE_SESSION/u,
      `${modulePath} bypasses frontendFixtureMode`,
    );
  }
});
