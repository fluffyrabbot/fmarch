import assert from "node:assert/strict";
import { test } from "node:test";
import { load as loadDevArtifact } from "../_dev/ops/artifact/+page.server.js";
import { load as loadProductionArtifact } from "./artifact/+page.server.js";

process.env.FMARCH_FRONTEND_FIXTURE_SESSION = "1";

test("dev proof explorer reads local dev-test-game JSON proof artifacts", async () => {
  const data = await loadDevArtifact({
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

test("dev proof explorer accepts global moderation authority", async () => {
  const data = await loadDevArtifact({
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

test("dev proof explorer rejects game-scoped authority and non-proof paths", async () => {
  await assert.rejects(
    async () =>
      await loadDevArtifact({
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
      await loadDevArtifact({
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

test("production admin artifact route does not expose local files", async () => {
  await assert.rejects(
    async () => await loadProductionArtifact(),
    (err) => err.status === 404,
  );
});
