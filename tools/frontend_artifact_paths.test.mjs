import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const visualSource = readFileSync(
  path.join(repoRoot, "tools", "frontend_visual_regression.mjs"),
  "utf8",
);
const routeStateSource = readFileSync(
  path.join(repoRoot, "tools", "frontend_route_state_render_contract.mjs"),
  "utf8",
);
const tabletInteractionSource = readFileSync(
  path.join(repoRoot, "tools", "frontend_tablet_interaction_contract.mjs"),
  "utf8",
);
const roleDomSource = readFileSync(
  path.join(repoRoot, "tools", "frontend_role_dom_smoke.mjs"),
  "utf8",
);

test("visual baselines cover only screenshots declared by the live role-smoke receipt", () => {
  const expected = [
    "desktop-admin.json",
    "mobile-admin.json",
    "mobile-board-player.json",
    "mobile-forbidden-player-signed-out.json",
    "mobile-moderator-confirmation.json",
    "mobile-moderator-interrupted.json",
    "mobile-moderator-pending.json",
    "mobile-moderator.json",
    "mobile-player-composer-ack.json",
    "mobile-player-interrupted.json",
    "mobile-player-pending.json",
    "mobile-player-receipt.json",
    "mobile-player.json",
    "mobile-route-state-player-reject.json",
    "tablet-moderator.json",
    "tablet-player.json",
  ];
  const baselineDir = path.join(repoRoot, "tools", "fixtures", "frontend-visual-baselines");
  const actual = readdirSync(baselineDir).filter((name) => name.endsWith(".json")).sort();

  assert.deepEqual(actual, expected);
  assert.match(visualSource, /role-smoke\.json/);
  assert.match(visualSource, /screenshotEvidencePaths\(roleSmokeEvidence\)/);
  for (const stale of [
    "mobile-admin-confirmation.png",
    "mobile-admin-pending.png",
    "mobile-admin-interrupted.png",
  ]) {
    assert.doesNotMatch(visualSource, new RegExp(`"${stale.replace(".", "\\.")}"`));
  }
  for (const baseline of actual) {
    const sample = JSON.parse(readFileSync(path.join(baselineDir, baseline), "utf8"));
    assert.equal(sample.screenshot, baseline.replace(/\.json$/, ".png"));
  }
});

test("route-state render keeps generated entry modules under its lane artifact root", () => {
  assert.match(
    routeStateSource,
    /const tempEntryDir = path\.join\(artifactDir, "\.tmp-route-state-render"\)/,
  );
  assert.doesNotMatch(
    routeStateSource,
    /path\.join\(frontendRoot, "\.tmp-route-state-render"\)/,
  );
  assert.match(routeStateSource, /FMARCH_PROOF_ARTIFACT_DIR/);
  assert.match(tabletInteractionSource, /FMARCH_PROOF_ARTIFACT_DIR/);
  assert.match(tabletInteractionSource, /FMARCH_ROUTE_STATE_RENDER_ARTIFACT_DIR/);
  assert.match(roleDomSource, /FMARCH_PROOF_ARTIFACT_DIR/);
  assert.match(roleDomSource, /FMARCH_ROUTE_STATE_RENDER_ARTIFACT_DIR/);
  assert.match(routeStateSource, /const generatedFrontendAlias = "@fmarch-route-state-frontend"/);
  assert.match(
    routeStateSource,
    /replaceAll\("\.\.\/src\/", `\$\{generatedFrontendAlias\}\/src\/`\)/,
  );
});
