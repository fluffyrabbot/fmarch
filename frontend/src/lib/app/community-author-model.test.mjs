import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ARCHIVED_COMMUNITY_AUTHOR,
  buildCommunityAuthorView,
} from "./community-author-model.mjs";

test("community author view recognizes only an explicit public profile", () => {
  assert.deepEqual(
    buildCommunityAuthorView({ handle: "mira-r", display_name: "Mira Rowan" }),
    {
      kind: "profile",
      handle: "mira-r",
      displayName: "Mira Rowan",
      label: "Mira Rowan",
      href: "/u/mira-r",
    },
  );
  assert.deepEqual(buildCommunityAuthorView({ display_name: "No handle" }), ARCHIVED_COMMUNITY_AUTHOR);
  assert.deepEqual(buildCommunityAuthorView(null), ARCHIVED_COMMUNITY_AUTHOR);
});
