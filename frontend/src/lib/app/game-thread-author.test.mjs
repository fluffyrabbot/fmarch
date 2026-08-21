import assert from "node:assert/strict";
import { test } from "node:test";
import {
  gameThreadAuthorLabel,
  isHostNarrator,
  normalizeGameThreadAuthor,
} from "./game-thread-author.mjs";

test("game-thread authors normalize only the closed tagged representation", () => {
  assert.deepEqual(
    normalizeGameThreadAuthor({ kind: "slot", slot_id: "slot-7" }),
    { kind: "slot", slotId: "slot-7" },
  );
  assert.deepEqual(
    normalizeGameThreadAuthor({ kind: "slot", slotId: "slot-3" }),
    { kind: "slot", slotId: "slot-3" },
  );
  assert.deepEqual(normalizeGameThreadAuthor({ kind: "host_narrator" }), {
    kind: "host_narrator",
  });
  assert.deepEqual(normalizeGameThreadAuthor({ kind: "system" }), {
    kind: "system",
  });
  assert.deepEqual(
    normalizeGameThreadAuthor({ author_slot: "slot-7", author_user: "Mira" }),
    { kind: "unknown" },
  );
  assert.deepEqual(normalizeGameThreadAuthor({ kind: "slot" }), {
    kind: "unknown",
  });
});

test("game-thread author presentation derives from kind instead of profile identity", () => {
  const player = normalizeGameThreadAuthor({ kind: "slot", slot_id: "slot-7" });
  const narrator = normalizeGameThreadAuthor({ kind: "host_narrator" });
  const system = normalizeGameThreadAuthor({ kind: "system" });

  assert.equal(gameThreadAuthorLabel(player), "slot-7");
  assert.equal(isHostNarrator(player), false);
  assert.equal(gameThreadAuthorLabel(narrator), "Host");
  assert.equal(isHostNarrator(narrator), true);
  assert.equal(gameThreadAuthorLabel(system), "System");
});
