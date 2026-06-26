import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSessionCard,
  createTokenSet,
  markdownSessionCard,
  parseArgs,
  seedCommandPlanForGame,
  selectGame,
} from "./dev_test_game.mjs";

test("dev test-game args expose reset reuse naming and verification controls", () => {
  assert.deepEqual(
    parseArgs([
      "--name",
      "morning",
      "--reset",
      "--api-port",
      "4101",
      "--frontend-port",
      "4102",
      "--verify",
      "--no-keepalive",
    ]),
    {
      name: "morning",
      reset: true,
      apiPort: 4101,
      frontendPort: 4102,
      verify: true,
      noKeepalive: true,
    },
  );

  assert.throws(() => parseArgs(["--frontend-port", "nope"]), /positive integer/);
});

test("named game selection is idempotent by default with explicit reset and reuse", () => {
  const registry = {
    local: { game: "11111111-1111-4111-8111-111111111111" },
  };
  assert.deepEqual(
    selectGame({ args: {}, gameName: "local", registry }),
    {
      game: "11111111-1111-4111-8111-111111111111",
      seedMode: "reuse-if-present",
    },
  );
  assert.deepEqual(
    selectGame({
      args: { reset: true },
      gameName: "local",
      registry,
      randomUuid: () => "22222222-2222-4222-8222-222222222222",
    }),
    {
      game: "22222222-2222-4222-8222-222222222222",
      seedMode: "seed",
    },
  );
  assert.deepEqual(
    selectGame({ args: { reuse: true }, gameName: "local", registry }),
    {
      game: "11111111-1111-4111-8111-111111111111",
      seedMode: "reuse",
    },
  );
  assert.throws(
    () => selectGame({ args: { reuse: true }, gameName: "missing", registry: {} }),
    /no named game 'missing'/,
  );
});

test("seed plan creates a playable mafiascum D01 game shape", () => {
  const game = "33333333-3333-4333-8333-333333333333";
  const plan = seedCommandPlanForGame(game);
  assert.equal(plan.length, 20);
  assert.deepEqual(plan[0], ["host_h", { CreateGame: { game, pack: "mafiascum" } }]);
  assert(plan.some(([, command]) => command.AddCohost?.user === "cohost_c"));
  assert(plan.some(([, command]) => command.StartGame?.phase === "D01"));
  assert(plan.some(([, command]) => command.SubmitVote?.target?.Slot === "slot-2"));
  assert(plan.some(([, command]) => command.SubmitPost?.channel_id === "main"));
});

test("session card and markdown include role entry URLs and tokens", () => {
  const game = "44444444-4444-4444-8444-444444444444";
  const tokens = createTokenSet("dev-test-card");
  const card = buildSessionCard({
    gameName: "card",
    game,
    seedMode: "seeded",
    databaseUrl: "postgres://db/fmarch",
    apiBaseUrl: "http://127.0.0.1:4101",
    frontendBaseUrl: "http://127.0.0.1:4102",
    seedCommands: [{ command: { CreateGame: { game, pack: "mafiascum" } } }],
    sessions: {
      host: {
        principalUserId: "host_h",
        token: tokens.host,
        returnTo: `/g/${game}/host`,
        capabilityKinds: ["HostOf"],
      },
      player: {
        principalUserId: "player-mira",
        token: tokens.player,
        returnTo: `/g/${game}`,
        capabilityKinds: ["SlotOccupant"],
      },
    },
  });

  assert.equal(card.name, "card");
  assert.equal(card.seedCommandCount, 1);
  assert.equal(
    card.sessions.host.loginUrl,
    `http://127.0.0.1:4102/auth/login?returnTo=%2Fg%2F${game}%2Fhost`,
  );
  assert.equal(card.sessions.player.token, "dev-test-card-player");
  const markdown = markdownSessionCard(card);
  assert(markdown.includes("# fmarch Dev Test Game"));
  assert(markdown.includes("dev-test-card-host"));
  assert(markdown.includes(`returnTo=%2Fg%2F${game}`));
});
