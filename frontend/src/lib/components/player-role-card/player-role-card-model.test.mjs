import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PLAYER_ROLE_CARD_CONTRACT,
  buildPlayerRoleCardViewModel,
  humanizeRoleTag,
} from "./player-role-card-model.mjs";

test("role card renders the actor's own role, alignment chip, and description", () => {
  const card = buildPlayerRoleCardViewModel({
    commandState: {
      actorSlot: "slot-7",
      actorStatus: "alive",
      roleKey: "mafia_goon",
      role: {
        key: "mafia_goon",
        alignment: "mafia",
        description:
          "Mafia Goon. Carries out the nightly factional kill (one per night, faction-shared).",
      },
    },
    player: { slotId: "slot-7", status: "alive" },
  });
  assert.equal(card.root.testId, PLAYER_ROLE_CARD_CONTRACT.rootTestId);
  assert.equal(card.root.data.roleState, "assigned");
  assert.equal(card.root.data.roleKey, "mafia_goon");
  assert.equal(card.root.data.roleAlignment, "mafia");
  assert.equal(card.name.value, "Mafia goon");
  assert.equal(card.alignment.label, "Mafia");
  assert.match(card.description.value, /nightly factional kill/u);
  assert.equal(card.status.state, "ack");
});

test("role card stays self-scoped when details are not published", () => {
  const card = buildPlayerRoleCardViewModel({
    commandState: { roleKey: "town_cop", role: null, actorStatus: "alive" },
  });
  assert.equal(card.root.data.roleState, "unpublished");
  assert.equal(card.name.value, "Town cop");
  assert.equal(card.alignment.label, "Not published");
  assert.match(card.description.value, /Role PM channel remains the authoritative text/u);
  assert.equal(card.status.state, "pending");
});

test("role card shows the pending-replacement boundary without inventing a role", () => {
  const card = buildPlayerRoleCardViewModel({
    commandState: {
      roleKey: null,
      role: null,
      actorStatus: "pending_replacement",
    },
    player: { status: "pending_replacement" },
  });
  assert.equal(card.root.data.roleState, "pending_replacement");
  assert.equal(card.name.value, "Role pending");
  assert.equal(card.root.data.roleKey, "");
  assert.equal(card.status.state, "pending");
});

test("role card reports unassigned slots plainly", () => {
  const card = buildPlayerRoleCardViewModel({
    commandState: { roleKey: null, role: null, actorStatus: "alive" },
  });
  assert.equal(card.root.data.roleState, "unassigned");
  assert.equal(card.name.value, "No role assigned");
  assert.equal(card.alignment.label, "Unassigned");
});

test("dead actors keep their own role card", () => {
  const card = buildPlayerRoleCardViewModel({
    commandState: {
      actorStatus: "dead",
      roleKey: "vanilla_townie",
      role: { key: "vanilla_townie", alignment: "town", description: "Vanilla." },
    },
  });
  assert.equal(card.root.data.roleState, "assigned");
  assert.equal(card.name.value, "Vanilla townie");
  assert.equal(card.alignment.label, "Town");
});

test("humanizeRoleTag spaces underscores and capitalizes once", () => {
  assert.equal(humanizeRoleTag("two_shot_vigilante"), "Two shot vigilante");
  assert.equal(humanizeRoleTag(""), "Unknown");
  assert.equal(humanizeRoleTag(null), "Unknown");
});

test("missing alignment renders as Unaligned without leaking empty chips", () => {
  const card = buildPlayerRoleCardViewModel({
    commandState: {
      roleKey: "survivor",
      role: { key: "survivor", alignment: null, description: "Live to the end." },
    },
  });
  assert.equal(card.alignment.label, "Unaligned");
  assert.equal(card.root.data.roleAlignment, "");
});
