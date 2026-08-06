import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { buildDevTestGamePaths } from "./dev_test_game_configuration.mjs";
import {
  buildDevTestGameHostSetupProof,
  buildNamedGamesRegistry,
  buildSessionCard,
  canonicalSessionArtifacts,
  hostSetupSessionArtifacts,
  jsonArtifactDocument,
  markdownSessionCard,
  namedGamesRegistryDocument,
  parseNamedGamesRegistry,
  proofRunArtifactWrite,
  roleLoginUrl,
  sessionArtifactWrites,
  sessionArtifactsForConfiguration,
  sessionCardConsoleLines,
  verificationProofArtifactWrites,
  withSessionVerification,
} from "./dev_test_game_session_artifacts.mjs";

const repoRoot = path.resolve("/tmp/fmarch-dev-test-game-artifacts");
const paths = buildDevTestGamePaths({ repoRoot, env: {} });

function sessionCardFixture(overrides = {}) {
  return buildSessionCard({
    gameName: "local",
    game: "game-a",
    seedMode: "seed",
    databaseUrl: "postgres://db/fmarch",
    apiBaseUrl: "http://127.0.0.1:4101",
    frontendBaseUrl: "http://127.0.0.1:4102",
    seedCommands: [{ command: { CreateGame: { game: "game-a" } } }],
    sessions: {
      host: {
        principalUserId: "host_h",
        credentialKind: "invite",
        token: "host-token",
        inviteToken: "host-token",
        accountId: "host_h@local.fmarch.test",
        password: "host-password",
        returnTo: "/g/game-a/host",
        expectedCapabilityKind: "HostOf",
      },
      player: {
        principalUserId: "player-p",
        credentialKind: "account",
        accountId: "player-p@local.fmarch.test",
        password: "player-password",
        returnTo: "/g/game-a",
        expectedCapabilityKind: "SlotOccupant",
      },
    },
    ...overrides,
  });
}

test("session artifact references select canonical and focused paths immutably", () => {
  const canonical = sessionArtifactsForConfiguration(paths);
  const focused = sessionArtifactsForConfiguration(paths, {
    hostSetupOnly: true,
  });
  assert.deepEqual(canonical, canonicalSessionArtifacts);
  assert.deepEqual(focused, hostSetupSessionArtifacts);
  assert.equal(Object.isFrozen(canonical), true);
  assert.equal(Object.isFrozen(focused), true);
});

test("session card assembly owns role URLs and preserves the exact card schema", () => {
  const card = sessionCardFixture({
    setupBootstrap: {
      status: "passed",
      roleUrl: "http://127.0.0.1:4102/g/setup-game/setup",
      commandCount: 4,
    },
    identityBootstrap: {
      rootSessionSource: "auth_session",
      browserCredentialIssuer: "/auth/accounts + /auth/invites",
      devSessionEndpointEnabled: false,
    },
  });
  assert.deepEqual(Object.keys(card), [
    "status",
    "name",
    "game",
    "pack",
    "phase",
    "seedMode",
    "databaseUrl",
    "apiBaseUrl",
    "frontendBaseUrl",
    "seedCommandCount",
    "directSeedCommandCount",
    "setupBootstrap",
    "identityBootstrap",
    "sessions",
    "artifacts",
  ]);
  assert.equal(card.status, "ready");
  assert.equal(card.pack, "mafiascum");
  assert.equal(card.phase, "D01");
  assert.equal(card.seedCommandCount, 5);
  assert.equal(card.directSeedCommandCount, 1);
  assert.equal(
    card.sessions.host.loginUrl,
    "http://127.0.0.1:4102/auth/invite?returnTo=%2Fg%2Fgame-a%2Fhost&invite=host-token&account=host_h%40local.fmarch.test",
  );
  assert.equal(
    card.sessions.player.loginUrl,
    "http://127.0.0.1:4102/auth/login/classic?returnTo=%2Fg%2Fgame-a&account=player-p%40local.fmarch.test",
  );
  assert.equal(card.sessions.player.directUrl, "http://127.0.0.1:4102/g/game-a");
  assert.deepEqual(card.artifacts, canonicalSessionArtifacts);

  assert.equal(
    roleLoginUrl({
      frontendBaseUrl: "https://app.example.test",
      session: { returnTo: "/g/game-a", token: "legacy-token" },
    }),
    "https://app.example.test/auth/invite?returnTo=%2Fg%2Fgame-a",
  );
});

test("JSON, Markdown, and stdout assembly preserve credentials and formatting", () => {
  const card = sessionCardFixture();
  const writes = sessionArtifactWrites({ card, repoRoot });
  assert.equal(Object.isFrozen(writes), true);
  assert.equal(Object.isFrozen(writes[0]), true);
  assert.equal(
    writes[0].filePath,
    path.join(repoRoot, "target", "dev-test-game", "session.json"),
  );
  assert.equal(
    writes[1].filePath,
    path.join(repoRoot, "target", "dev-test-game", "session.md"),
  );
  assert.equal(writes[0].contents, jsonArtifactDocument(card));
  assert.equal(writes[1].contents, markdownSessionCard(card));
  assert.equal(writes[0].contents.endsWith("\n"), true);
  assert.match(writes[0].contents, /"password": "host-password"/);
  assert.match(writes[0].contents, /"inviteToken": "host-token"/);

  const markdown = writes[1].contents;
  assert.match(markdown, /^# fmarch Dev Test Game/);
  assert.match(markdown, /Credential token: host-token/);
  assert.match(markdown, /Account: host_h@local\.fmarch\.test/);
  assert.match(markdown, /Password: player-password/);
  assert.equal(markdown.endsWith("\n"), true);

  assert.deepEqual(sessionCardConsoleLines(card), [
    "\nfmarch dev test game is ready",
    "name: local",
    "game: game-a",
    "seed: seed",
    "frontend: http://127.0.0.1:4102",
    "api: http://127.0.0.1:4101",
    "artifact: target/dev-test-game/session.md",
    "\nhost",
    `  url:    ${card.sessions.host.loginUrl}`,
    "  token:  host-token",
    "  account: host_h@local.fmarch.test",
    "  password: host-password",
    "\nplayer",
    `  url:    ${card.sessions.player.loginUrl}`,
    "  account: player-p@local.fmarch.test",
    "  password: player-password",
  ]);

  assert.equal(
    jsonArtifactDocument({
      sha256: "abc123",
      diagnosticPassword: "<redacted>",
      omitted: undefined,
    }),
    '{\n  "sha256": "abc123",\n  "diagnosticPassword": "<redacted>"\n}\n',
  );
});

test("verification proof assembly preserves paths, schemas, fallback, and write order", () => {
  const card = sessionCardFixture();
  const hostSetup = { route: "/g/game-a/setup", status: "passed" };
  const mediaResponseGuard = { status: "passed", unexpected404Count: 0 };
  const directRace = { status: "passed", source: "direct" };
  const verification = {
    roles: ["host", "player"],
    earliestReachedTie: { status: "passed", tiebreak: "EarliestReached" },
    hostDecidesTie: { status: "passed", tiebreak: "HostDecides" },
    hostDecidesRace: directRace,
    multiplayerHardening: {
      concurrentHostPromptSelectionRace: { status: "passed", source: "fallback" },
    },
    hostSetup,
    mediaResponseGuard,
  };
  const writes = verificationProofArtifactWrites({
    card,
    verification,
    paths,
    generatedAt: "2026-08-06T12:00:00.000Z",
  });
  assert.deepEqual(
    writes.map((write) => write.filePath),
    [
      paths.proof.earliestReached,
      paths.proof.hostDecides,
      paths.proof.hostDecidesRace,
      paths.proof.hostSetup,
    ],
  );
  assert.deepEqual(JSON.parse(writes[2].contents), directRace);
  assert.deepEqual(JSON.parse(writes[3].contents), {
    proof: "dev-test-game-host-setup-proof",
    status: "passed",
    game: "game-a",
    generatedAt: "2026-08-06T12:00:00.000Z",
    proofBoundary:
      "Local dev-test-game host setup role URL browser proof over the seeded setup route plus a disposable setup game. Proves setup route rendering, policy round-trip, stale duplicate AddSlot rejection, setup refresh after reject, roster assignment, role assignment, and readiness recovery; it does not prove the full core loop, multiplayer hardening, hosted deployment, beta readiness, or production readiness.",
    hostSetup,
    mediaResponseGuard,
  });

  const fallbackWrites = verificationProofArtifactWrites({
    card,
    verification: {
      hostSetup,
      mediaResponseGuard,
      multiplayerHardening: {
        concurrentHostPromptSelectionRace: { status: "passed", source: "fallback" },
      },
    },
    paths,
    generatedAt: "2026-08-06T12:00:00.000Z",
  });
  assert.deepEqual(JSON.parse(fallbackWrites[0].contents), {
    status: "passed",
    source: "fallback",
  });
  assert.equal(fallbackWrites[0].filePath, paths.proof.hostDecidesRace);
  assert.equal(fallbackWrites[1].filePath, paths.proof.hostSetup);
});

test("host setup and proof-run values are assembled without assertion or I/O", () => {
  const card = sessionCardFixture();
  const proof = buildDevTestGameHostSetupProof(
    card,
    {
      hostSetup: { status: "passed" },
      mediaResponseGuard: { status: "passed" },
    },
    { generatedAt: "2026-08-06T12:00:00.000Z" },
  );
  assert.equal(proof.game, "game-a");
  assert.equal(proof.generatedAt, "2026-08-06T12:00:00.000Z");

  const proofRun = { proof: "dev-test-game", status: "passed", digest: "sha256:abc" };
  const write = proofRunArtifactWrite({ proofRun, paths });
  assert.equal(write.filePath, paths.session.canonical.proofRun);
  assert.equal(write.contents, jsonArtifactDocument(proofRun));

  const verified = withSessionVerification(card, { status: "passed" });
  assert.equal(card.verification, undefined);
  assert.deepEqual(verified.verification, { status: "passed" });
});

test("named-game registry assembly preserves selection inputs and JSON bytes", () => {
  const card = sessionCardFixture({ artifacts: hostSetupSessionArtifacts });
  const registry = { existing: { game: "game-old" } };
  const updated = buildNamedGamesRegistry(registry, "local", card, {
    updatedAt: "2026-08-06T12:00:00.000Z",
  });
  assert.deepEqual(registry, { existing: { game: "game-old" } });
  assert.deepEqual(updated.local, {
    game: "game-a",
    updatedAt: "2026-08-06T12:00:00.000Z",
    session: hostSetupSessionArtifacts,
  });
  const document = namedGamesRegistryDocument(registry, "local", card, {
    updatedAt: "2026-08-06T12:00:00.000Z",
  });
  assert.deepEqual(parseNamedGamesRegistry(document), updated);
  assert.deepEqual(parseNamedGamesRegistry("null"), {});
  assert.deepEqual(parseNamedGamesRegistry('"not-an-object"'), {});
  assert.deepEqual(parseNamedGamesRegistry("[]"), []);
  assert.equal(document.endsWith("\n"), true);
  assert.throws(() => parseNamedGamesRegistry("{"), SyntaxError);
});
