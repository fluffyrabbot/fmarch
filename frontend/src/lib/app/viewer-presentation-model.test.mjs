import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildViewerPresentation,
  normalizeViewerProfile,
} from "./viewer-presentation-model.mjs";

test("viewer presentation never turns an authority principal into public profile copy", () => {
  assert.deepEqual(buildViewerPresentation(), {
    state: "signed-out",
    kind: "anonymous",
    label: "Signed out",
    initials: "?",
    profile: null,
  });

  assert.deepEqual(buildViewerPresentation({ principalId: "principal-opaque-7" }), {
    state: "signed-in",
    kind: "account",
    label: "Your account",
    initials: "YA",
    profile: null,
  });
});

test("viewer presentation accepts an explicit social-profile summary only", () => {
  const presentation = buildViewerPresentation({
    principalId: "principal-opaque-7",
    profile: { handle: "mira-r", display_name: "Mira Rowan" },
  });

  assert.deepEqual(presentation, {
    state: "signed-in",
    kind: "profile",
    label: "Mira Rowan",
    initials: "MR",
    profile: {
      handle: "mira-r",
      displayName: "Mira Rowan",
      href: "/u/mira-r",
    },
  });
  assert.equal(normalizeViewerProfile({ handle: "mira-r" }), null);
  assert.equal(
    buildViewerPresentation({
      profile: { handle: "mira-r", displayName: "Mira Rowan" },
    }).kind,
    "anonymous",
  );
});
