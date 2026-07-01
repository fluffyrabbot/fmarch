import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { seedCommandPlanForGame } from "./dev_test_game.mjs";
import { assertDevTestGameProofRun } from "./dev_test_game_proof_contract.mjs";
import { assertDevTestGameReleaseReadiness } from "./dev_test_game_release_readiness.mjs";
import {
  seedAggregateOnlyProofLaneIds,
  seedAliasOnlyProofLaneIds,
  seedDemoScenarioCatalog,
  seedDemoScenarioProofLaneCandidates,
  seedScenarioCoverageGroups,
  unclassifiedSeedProofLaneIds,
} from "./dev_test_game_seed_scenario_cases.mjs";

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
  const passedLaneIds = proof.lanes
    .filter((lane) => lane.status === "passed")
    .map((lane) => lane.id);
  const demoScenarioRows = demoScenarios({ roles, laneIds: passedLaneIds });
  const proofLaneCoverage = proofLaneCoverageForPassedLanes(passedLaneIds);
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
    demoScenarios: demoScenarioRows,
    proofLaneCoverage,
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
        scenarioCount: demoScenarioRows.length,
      },
      {
        id: "proof-lanes-carried",
        status: "passed",
        laneCount: proof.lanes.length,
        directSeededLaneCount: proofLaneCoverage.directSeeded.count,
        aliasOnlyLaneCount: proofLaneCoverage.aliasOnly.count,
        aggregateOnlyLaneCount: proofLaneCoverage.aggregateOnly.count,
        unclassifiedLaneCount: proofLaneCoverage.unclassified.count,
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
  const requiredScenarios = seedScenarioCoverageGroups.allDemo;
  const scenarioIds = (summary.demoScenarios ?? []).map((scenario) => scenario.id);
  if (
    scenarioIds.length !== requiredScenarios.length ||
    scenarioIds.some((id, index) => id !== requiredScenarios[index])
  ) {
    throw new Error("seed fixture summary scenario order drifted from shared demo catalog");
  }
  const scenarios = new Map(
    (summary.demoScenarios ?? []).map((scenario) => [scenario.id, scenario]),
  );
  for (const id of requiredScenarios) {
    if (scenarios.get(id)?.status !== "available_locally") {
      throw new Error(`seed fixture summary missing local scenario: ${id}`);
    }
  }
  assertSeedFixtureProofLaneCoverage(summary.proofLaneCoverage);
  if ((summary.fixture?.slots ?? []).length < 5) {
    throw new Error("seed fixture summary must enumerate seeded slots");
  }
  const serialized = JSON.stringify(summary);
  if (/invite=(?!REDACTED)/.test(serialized)) {
    throw new Error("seed fixture summary leaked an invite URL token");
  }
  for (const [role, entry] of Object.entries(summary.fixture?.roles ?? {})) {
    if (typeof entry.loginUrlRedacted !== "string" || entry.loginUrlRedacted === "") {
      throw new Error(`seed fixture role ${role} missing redacted login URL`);
    }
    if (
      entry.credentialKind === "invite" &&
      entry.loginUrlRedacted?.includes("invite=REDACTED") !== true
    ) {
      throw new Error(`seed fixture role ${role} missing redacted invite URL`);
    }
    if (
      entry.credentialKind === "session" &&
      entry.loginUrlRedacted?.includes("invite=") === true
    ) {
      throw new Error(`seed fixture role ${role} leaked invite query on session URL`);
    }
    if ("token" in entry || "inviteToken" in entry) {
      throw new Error(`seed fixture role ${role} leaked a credential field`);
    }
  }
  return summary;
}

function assertSeedFixtureProofLaneCoverage(coverage) {
  if (coverage?.status !== "passed") {
    throw new Error(`seed fixture proof lane coverage is ${coverage?.status}`);
  }
  if (!Number.isInteger(coverage.passedLaneCount) || coverage.passedLaneCount <= 0) {
    throw new Error("seed fixture proof lane coverage must count passed lanes");
  }
  for (const [id, expectedLaneIds] of [
    ["aliasOnly", seedAliasOnlyProofLaneIds],
    ["aggregateOnly", seedAggregateOnlyProofLaneIds],
  ]) {
    const laneIds = coverage[id]?.laneIds ?? [];
    for (const laneId of expectedLaneIds) {
      if (!laneIds.includes(laneId)) {
        throw new Error(`seed fixture proof lane coverage missing ${id} lane: ${laneId}`);
      }
    }
    if (coverage[id]?.count !== laneIds.length) {
      throw new Error(`seed fixture proof lane coverage count drifted for ${id}`);
    }
  }
  if ((coverage.directSeeded?.laneIds ?? []).length !== coverage.directSeeded?.count) {
    throw new Error("seed fixture direct seeded proof lane count drifted");
  }
  if ((coverage.unclassified?.laneIds ?? []).length !== 0) {
    throw new Error(
      `seed fixture proof lane coverage has unclassified lanes: ${coverage.unclassified.laneIds.join(", ")}`,
    );
  }
  if (coverage.unclassified?.count !== 0) {
    throw new Error("seed fixture proof lane coverage must have zero unclassified lanes");
  }
}

function demoScenarios({ roles, laneIds }) {
  const laneSet = new Set(laneIds);
  return seedDemoScenarioCatalog({
    provenByForId: (id) =>
      seedDemoScenarioProofLaneCandidates(id).filter((laneId) =>
        laneSet.has(laneId),
      ),
    roleUrlForRole: (role) => roles[role]?.loginUrlRedacted ?? null,
  });
}

function proofLaneCoverageForPassedLanes(passedLaneIds) {
  const passedLaneSet = new Set(passedLaneIds);
  const directScenarioSet = new Set(seedScenarioCoverageGroups.allDemo);
  const directSeeded = passedLaneIds.filter((id) => directScenarioSet.has(id));
  const aliasOnly = seedAliasOnlyProofLaneIds.filter((id) => passedLaneSet.has(id));
  const aggregateOnly = seedAggregateOnlyProofLaneIds.filter((id) =>
    passedLaneSet.has(id),
  );
  const unclassified = unclassifiedSeedProofLaneIds({ proofLaneIds: passedLaneIds });
  return {
    status: unclassified.length === 0 ? "passed" : "failed",
    passedLaneCount: passedLaneIds.length,
    directSeeded: {
      count: directSeeded.length,
      laneIds: directSeeded,
    },
    aliasOnly: {
      count: aliasOnly.length,
      laneIds: aliasOnly,
    },
    aggregateOnly: {
      count: aggregateOnly.length,
      laneIds: aggregateOnly,
    },
    unclassified: {
      count: unclassified.length,
      laneIds: unclassified,
    },
  };
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
  lines.push(
    "",
    "## Proof Lane Coverage",
    "",
    "| Classification | Count | Lanes |",
    "| --- | ---: | --- |",
  );
  for (const [label, entry] of [
    ["Direct seeded", summary.proofLaneCoverage.directSeeded],
    ["Alias-only", summary.proofLaneCoverage.aliasOnly],
    ["Aggregate-only", summary.proofLaneCoverage.aggregateOnly],
    ["Unclassified", summary.proofLaneCoverage.unclassified],
  ]) {
    lines.push(`| ${label} | ${entry.count} | ${entry.laneIds.join(", ")} |`);
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
