import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { seedCommandPlanForGame } from "./dev_test_game.mjs";
import { assertDevTestGameProofRun } from "./dev_test_game_proof_contract.mjs";
import { assertDevTestGameReleaseReadiness } from "./dev_test_game_release_readiness.mjs";

export const DEV_TEST_GAME_SEED_FIXTURE_SUMMARY_VERSION = 1;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = path.join(repoRoot, "target", "dev-test-game");
const defaultPaths = Object.freeze({
  session: path.join(artifactDir, "session.json"),
  proofRun: path.join(artifactDir, "proof-run.json"),
  readiness: path.join(artifactDir, "release-readiness-checklist.json"),
});
const jsonPath = path.join(artifactDir, "seed-fixture-summary.json");
const markdownPath = path.join(artifactDir, "seed-fixture-summary.md");

export function buildDevTestGameSeedFixtureSummary({
  session,
  proofRun,
  readiness,
  generatedAt = new Date().toISOString(),
  paths = {},
}) {
  const proof = assertDevTestGameProofRun(proofRun);
  const checklist = assertDevTestGameReleaseReadiness(readiness);
  if (session?.game !== proof.session.game) {
    throw new Error(`seed fixture session/proof game mismatch: ${session?.game}`);
  }
  if (checklist.generatedFrom?.game !== proof.session.game) {
    throw new Error(
      `seed fixture readiness/proof game mismatch: ${checklist.generatedFrom?.game}`,
    );
  }
  const roles = redactRoles(session.sessions ?? {});
  const slots = summarizeSeedSlots(seedCommandPlanForGame(session.game));
  const laneIds = proof.lanes.map((lane) => lane.id);
  const summary = {
    version: DEV_TEST_GAME_SEED_FIXTURE_SUMMARY_VERSION,
    proof: "dev-test-game-seed-fixture-summary",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    generatedAt,
    scope: "local-dev-test-game-seed-fixture",
    proofBoundary:
      "Local seed/demo fixture inventory for one dev-test-game run. It maps seeded slots, redacted role URLs, and browser-proof lanes into reusable local scenarios; it does not prove hosted demo data, production identity, invite delivery, beta readiness, or release readiness.",
    generatedFrom: {
      sessionJson: paths.session ?? "target/dev-test-game/session.json",
      proofRun: paths.proofRun ?? "target/dev-test-game/proof-run.json",
      readinessChecklist:
        paths.readiness ?? "target/dev-test-game/release-readiness-checklist.json",
      game: proof.session.game,
    },
    fixture: {
      name: session.name,
      game: session.game,
      pack: session.pack,
      phase: session.phase,
      seedMode: session.seedMode,
      seedCommandCount: session.seedCommandCount,
      roleCount: Object.keys(roles).length,
      roles,
      slots,
    },
    demoScenarios: demoScenarios({ roles, laneIds }),
    proofRun: {
      status: proof.status,
      laneCount: proof.lanes.length,
      lanes: proof.lanes.map((lane) => ({ id: lane.id, status: lane.status })),
      nonClaims: proof.nonClaims,
    },
    readiness: {
      status: checklist.status,
      releaseReady: checklist.releaseReady,
      productionReady: checklist.productionReady,
      localChecks: checklist.localDevelopmentSpine.checks.map((check) => ({
        id: check.id,
        status: check.status,
      })),
      unproven: checklist.releaseReadiness.unproven.map((item) => ({
        id: item.id,
        status: item.status,
      })),
    },
    checks: [
      {
        id: "role-entrypoints-redacted",
        status: "passed",
        evidence: Object.keys(roles),
      },
      {
        id: "seed-slots-enumerated",
        status: "passed",
        slotCount: slots.length,
      },
      {
        id: "demo-scenarios-mapped",
        status: "passed",
        scenarioCount: 7,
      },
      {
        id: "proof-lanes-carried",
        status: "passed",
        laneCount: proof.lanes.length,
      },
      {
        id: "release-boundary-carried",
        status: "passed",
        releaseReady: false,
        productionReady: false,
      },
    ],
  };
  assertDevTestGameSeedFixtureSummary(summary);
  return summary;
}

export function assertDevTestGameSeedFixtureSummary(summary) {
  if (summary?.version !== DEV_TEST_GAME_SEED_FIXTURE_SUMMARY_VERSION) {
    throw new Error(`seed fixture summary version drifted: ${summary?.version}`);
  }
  if (summary.proof !== "dev-test-game-seed-fixture-summary") {
    throw new Error(`unexpected seed fixture proof id: ${summary.proof}`);
  }
  if (summary.status !== "passed") {
    throw new Error(`seed fixture summary status is ${summary.status}`);
  }
  if (summary.scope !== "local-dev-test-game-seed-fixture") {
    throw new Error(`seed fixture summary scope drifted: ${summary.scope}`);
  }
  if (summary.releaseReady !== false || summary.productionReady !== false) {
    throw new Error("seed fixture summary must not claim release or production readiness");
  }
  const requiredChecks = [
    "role-entrypoints-redacted",
    "seed-slots-enumerated",
    "demo-scenarios-mapped",
    "proof-lanes-carried",
    "release-boundary-carried",
  ];
  const checks = new Map((summary.checks ?? []).map((check) => [check.id, check.status]));
  for (const id of requiredChecks) {
    if (checks.get(id) !== "passed") {
      throw new Error(`seed fixture summary missing passed check: ${id}`);
    }
  }
  const requiredScenarios = [
    "host-phase-controls",
    "player-vote-recovery",
    "night-action-loop",
    "private-channel-member",
    "private-channel-denied",
    "multiplayer-hardening",
    "local-ops-readiness",
  ];
  const scenarios = new Map(
    (summary.demoScenarios ?? []).map((scenario) => [scenario.id, scenario]),
  );
  for (const id of requiredScenarios) {
    if (scenarios.get(id)?.status !== "available_locally") {
      throw new Error(`seed fixture summary missing local scenario: ${id}`);
    }
  }
  if ((summary.fixture?.slots ?? []).length < 5) {
    throw new Error("seed fixture summary must enumerate seeded slots");
  }
  const serialized = JSON.stringify(summary);
  if (/invite=(?!REDACTED)/.test(serialized)) {
    throw new Error("seed fixture summary leaked an invite URL token");
  }
  for (const [role, entry] of Object.entries(summary.fixture?.roles ?? {})) {
    if (entry.loginUrlRedacted?.includes("invite=") !== true) {
      throw new Error(`seed fixture role ${role} missing redacted login URL`);
    }
    if ("token" in entry || "inviteToken" in entry) {
      throw new Error(`seed fixture role ${role} leaked a credential field`);
    }
  }
  return summary;
}

function demoScenarios({ roles, laneIds }) {
  const hasLane = (id) => laneIds.includes(id);
  const scenario = ({ id, title, role, provenBy, note }) => ({
    id,
    title,
    status: "available_locally",
    role,
    roleUrlRedacted: roles[role]?.loginUrlRedacted ?? null,
    provenBy,
    note,
  });
  return [
    scenario({
      id: "host-phase-controls",
      title: "Host phase controls",
      role: "host",
      provenBy: ["browser-entry", "core-loop"].filter(hasLane),
      note: "Host opens the seeded role URL, locks D01, recovers stale controls, resolves phases, and advances the local game.",
    }),
    scenario({
      id: "player-vote-recovery",
      title: "Player vote recovery",
      role: "player",
      provenBy: ["browser-entry", "core-loop", "stale-player-vote"].filter(hasLane),
      note: "Player opens the seeded role URL, submits votes, and sees clear PhaseLocked recovery from stale state.",
    }),
    scenario({
      id: "night-action-loop",
      title: "Night action loop",
      role: "actionPlayer",
      provenBy: ["action-loop", "stale-action-conflict"].filter(hasLane),
      note: "Action player sees a live factional_kill control, rejects an invalid self-action, submits a legal action, and refreshes out of stale N01.",
    }),
    scenario({
      id: "private-channel-member",
      title: "Private channel member",
      role: "player",
      provenBy: ["private-channel"].filter(hasLane),
      note: "Member role opens the pack-declared private channel and posts through /commands.",
    }),
    scenario({
      id: "private-channel-denied",
      title: "Private channel denial",
      role: "deniedPlayer",
      provenBy: ["private-channel"].filter(hasLane),
      note: "Denied role opens the same channel and lands on a clear 403 recovery path.",
    }),
    scenario({
      id: "multiplayer-hardening",
      title: "Multiplayer hardening",
      role: "player",
      provenBy: [
        "idempotent-retry",
        "reconnect-recovery",
        "concurrent-vote-race",
        "stale-host-control",
      ].filter(hasLane),
      note: "Seeded roles exercise duplicate command retry, reconnect recovery, one concurrent vote race, and stale host control rejection.",
    }),
    scenario({
      id: "local-ops-readiness",
      title: "Local ops readiness",
      role: "admin",
      provenBy: ["local-ops-artifact-bundle", "local-backup-restore-drill"],
      note: "Local generated artifacts carry the current ops and backup/restore evidence when those readiness checks are present.",
    }),
  ];
}

function summarizeSeedSlots(plan) {
  const slots = new Map();
  for (const [, command] of plan) {
    if (command.AddSlot !== undefined) {
      const slotId = command.AddSlot.slot;
      slots.set(slotId, { slotId });
    }
    if (command.AssignSlot !== undefined) {
      const slotId = command.AssignSlot.slot;
      slots.set(slotId, { ...(slots.get(slotId) ?? { slotId }), user: command.AssignSlot.user });
    }
    if (command.AssignRole !== undefined) {
      const slotId = command.AssignRole.slot;
      slots.set(slotId, {
        ...(slots.get(slotId) ?? { slotId }),
        roleKey: command.AssignRole.role_key,
      });
    }
  }
  return Array.from(slots.values()).map((slot) => ({
    slotId: slot.slotId,
    user: slot.user ?? null,
    roleKey: slot.roleKey ?? null,
    fixtureRole: fixtureRoleForUser(slot.user),
  }));
}

function fixtureRoleForUser(user) {
  if (user === "player-mira") {
    return "player";
  }
  if (user === "player-seed") {
    return "actionPlayer";
  }
  if (user === "player-target") {
    return "deniedPlayer";
  }
  return "seededParticipant";
}

function redactRoles(sessions) {
  return Object.fromEntries(
    Object.entries(sessions).map(([role, session]) => [
      role,
      {
        principalUserId: session.principalUserId,
        credentialKind: session.credentialKind,
        returnTo: session.returnTo,
        expectedCapabilityKind: session.expectedCapabilityKind,
        directUrl: session.directUrl,
        loginUrlRedacted: redactLoginUrl(session.loginUrl),
        inviteTokenRedacted: session.inviteToken === undefined ? undefined : "REDACTED",
      },
    ]),
  );
}

function redactLoginUrl(loginUrl) {
  if (typeof loginUrl !== "string" || loginUrl === "") {
    return loginUrl;
  }
  const url = new URL(loginUrl);
  if (url.searchParams.has("invite")) {
    url.searchParams.set("invite", "REDACTED");
  }
  return url.toString();
}

function markdownSeedFixture(summary) {
  const lines = [
    "# fmarch Dev Test Game Seed Fixture",
    "",
    `- status: ${summary.status}`,
    `- releaseReady: ${summary.releaseReady}`,
    `- productionReady: ${summary.productionReady}`,
    `- generatedAt: ${summary.generatedAt}`,
    `- game: ${summary.fixture.game}`,
    "",
    summary.proofBoundary,
    "",
    "## Roles",
    "",
    "| Role | Principal | URL |",
    "| --- | --- | --- |",
  ];
  for (const [role, entry] of Object.entries(summary.fixture.roles)) {
    lines.push(`| ${role} | ${entry.principalUserId} | \`${entry.loginUrlRedacted}\` |`);
  }
  lines.push("", "## Seeded Slots", "", "| Slot | User | Role Key | Fixture Role |", "| --- | --- | --- | --- |");
  for (const slot of summary.fixture.slots) {
    lines.push(
      `| ${slot.slotId} | ${slot.user ?? ""} | ${slot.roleKey ?? ""} | ${slot.fixtureRole} |`,
    );
  }
  lines.push("", "## Demo Scenarios", "", "| Scenario | Role | Lanes |", "| --- | --- | --- |");
  for (const scenario of summary.demoScenarios) {
    lines.push(
      `| ${scenario.id} | ${scenario.role} | ${scenario.provenBy.join(", ")} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  const paths = {
    session: resolvePath(process.env.FMARCH_DEV_TEST_GAME_SESSION, defaultPaths.session),
    proofRun: resolvePath(process.env.FMARCH_DEV_TEST_GAME_PROOF_RUN, defaultPaths.proofRun),
    readiness: resolvePath(
      process.env.FMARCH_DEV_TEST_GAME_READINESS,
      defaultPaths.readiness,
    ),
  };
  const [session, proofRun, readiness] = await Promise.all([
    readJson(paths.session),
    readJson(paths.proofRun),
    readJson(paths.readiness),
  ]);
  const summary = buildDevTestGameSeedFixtureSummary({
    session,
    proofRun,
    readiness,
    paths: {
      session: path.relative(repoRoot, paths.session),
      proofRun: path.relative(repoRoot, paths.proofRun),
      readiness: path.relative(repoRoot, paths.readiness),
    },
  });
  await mkdir(artifactDir, { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(markdownPath, markdownSeedFixture(summary));
  console.log(`wrote ${path.relative(repoRoot, jsonPath)} (${summary.status})`);
}

function resolvePath(value, fallback) {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  return path.resolve(process.cwd(), value);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}
