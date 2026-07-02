import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  ackedReplacementCommandMatches,
  replacementCommandEnvelopeMatches,
  replacementCurrentOwnerMatches,
  staleOutgoingCommandStateForbidden,
} from "./dev_test_game_replacement_assertions.mjs";
import {
  replacementIncomingActionScenario,
} from "./dev_test_game_replacement_action_scenario_cases.mjs";
import {
  replacementConcurrentPrivatePostRaceScenario,
} from "./dev_test_game_replacement_private_scenario_cases.mjs";

test("replacement command assertions match shared command envelope", () => {
  const scenario = replacementIncomingActionScenario();
  const commandStatus = {
    state: "ack",
    serverEnvelope: { body: { kind: "Ack" } },
    requestEnvelope: {
      body: {
        body: {
          principal_user_id: scenario.hostPrincipalUserId,
          command: {
            ProcessReplacement: {
              game: scenario.gameFixtureId,
              slot: scenario.actorSlot,
              outgoing_user: scenario.staleOutgoingPrincipalUserId,
              incoming_user: scenario.replacementPrincipalUserId,
            },
          },
        },
      },
    },
  };
  assert.equal(
    replacementCommandEnvelopeMatches(commandStatus, scenario, scenario.gameFixtureId),
    true,
  );
  assert.equal(
    ackedReplacementCommandMatches(commandStatus, scenario, scenario.gameFixtureId),
    true,
  );
  assert.equal(
    ackedReplacementCommandMatches(
      {
        ...commandStatus,
        serverEnvelope: { body: { kind: "Reject" } },
      },
      scenario,
      scenario.gameFixtureId,
    ),
    false,
  );
});

test("replacement owner assertion accepts current host and API owner", () => {
  const scenario = replacementConcurrentPrivatePostRaceScenario();
  assert.equal(
    replacementCurrentOwnerMatches(
      {
        hostProjection: {
          slotId: scenario.actorSlot,
          occupantLabel: scenario.replacementOccupantLabel,
          historyLabel: `history for ${scenario.actorSlot}`,
        },
        apiSlot: {
          slot_id: scenario.actorSlot,
          occupant_user_id: scenario.replacementPrincipalUserId,
        },
      },
      scenario,
    ),
    true,
  );
  assert.equal(
    replacementCurrentOwnerMatches(
      {
        apiSlot: {
          slot_id: scenario.actorSlot,
          occupant_user_id: scenario.staleOutgoingPrincipalUserId,
        },
      },
      scenario,
    ),
    false,
  );
});

test("stale outgoing assertion accepts scenario rejection boundary", () => {
  const scenario = replacementIncomingActionScenario();
  assert.equal(
    staleOutgoingCommandStateForbidden(
      { status: 403, error: scenario.staleOutgoingError },
      scenario,
    ),
    true,
  );
  assert.equal(
    staleOutgoingCommandStateForbidden({ status: 200, error: null }, scenario),
    false,
  );
});

test("replacement proof contract imports shared replacement assertions", async () => {
  const source = await readFile("tools/dev_test_game_proof_contract.mjs", "utf8");
  assert(source.includes("ackedReplacementCommandMatches"));
  assert(source.includes("replacementCurrentOwnerMatches"));
  assert(source.includes("staleOutgoingCommandStateForbidden"));
});
