import assert from "node:assert/strict";
import { test } from "node:test";
import { load } from "./artifact/+page.server.js";

test("admin artifact load reads local dev-test-game JSON proof artifacts", async () => {
  const data = await load({
    locals: {
      resolvedCapabilities: [{ kind: "GlobalAdmin" }],
    },
    url: new URL(
      "http://localhost/admin/artifact?game=midsummer&path=target/dev-test-game/next-action-hosted-identity.json",
    ),
  });

  assert.equal(
    data.artifact.path,
    "target/dev-test-game/next-action-hosted-identity.json",
  );
  assert.equal(data.artifact.game, "midsummer");
  assert.match(data.artifact.contents, /target\/dev-test-game\/next-action\.json/);
});

test("admin artifact load accepts global moderation authority", async () => {
  const data = await load({
    locals: {
      resolvedCapabilities: [{ kind: "GlobalMod" }],
    },
    url: new URL(
      "http://localhost/admin/artifact?game=midsummer&path=target/dev-test-game/next-action-hosted-identity.json",
    ),
  });

  assert.equal(
    data.artifact.path,
    "target/dev-test-game/next-action-hosted-identity.json",
  );
});

test("admin artifact load rejects game-scoped authority and non-proof paths", async () => {
  await assert.rejects(
    async () =>
      await load({
        locals: {
          resolvedCapabilities: [{ kind: "HostOf", game: "midsummer" }],
        },
        url: new URL(
          "http://localhost/admin/artifact?game=midsummer&path=target/dev-test-game/next-action.json",
        ),
      }),
    (err) => err.status === 403,
  );
  await assert.rejects(
    async () =>
      await load({
        locals: {
          resolvedCapabilities: [{ kind: "GlobalAdmin" }],
        },
        url: new URL(
          "http://localhost/admin/artifact?game=midsummer&path=../package.json",
        ),
      }),
    (err) => err.status === 400,
  );
});
