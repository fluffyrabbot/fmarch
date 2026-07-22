import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  _requireDevOps,
  _rewriteDevOpsLinks,
} from "./+page.server.js";

test("local proof explorer is available only in fixture mode", () => {
  assert.throws(
    () => _requireDevOps({ FMARCH_FRONTEND_FIXTURE_SESSION: "0" }),
    (error) => error.status === 404,
  );
  assert.doesNotThrow(() =>
    _requireDevOps({ FMARCH_FRONTEND_FIXTURE_SESSION: "1" }),
  );
});

test("local proof links stay inside the gated dev portal", () => {
  assert.deepEqual(
    _rewriteDevOpsLinks({
      overviewHref: "/admin?game=midsummer",
      audit: [{ inspectHref: "/admin/audit/core-loop?game=midsummer" }],
      artifactHref:
        "/admin/artifact?game=midsummer&path=target/dev-test-game/proof-run.json",
    }),
    {
      overviewHref: "/_dev/ops?game=midsummer",
      audit: [{ inspectHref: "/_dev/ops/audit/core-loop?game=midsummer" }],
      artifactHref:
        "/_dev/ops/artifact?game=midsummer&path=target/dev-test-game/proof-run.json",
    },
  );
});

test("production admin loader has no filesystem proof dependency", async () => {
  const source = await readFile(
    new URL("../../admin/+page.server.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /local-ops-artifacts/u);
  assert.doesNotMatch(source, /readLocal/u);
  assert.match(source, /buildAdminRuntimeRouteData/u);
});
