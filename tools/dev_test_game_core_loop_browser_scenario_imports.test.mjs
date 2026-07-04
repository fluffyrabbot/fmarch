import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const browserScenarioModules = Object.freeze([
  Object.freeze({
    moduleSpecifier:
      "./dev_test_game_core_loop_terminal_recovery_scenarios.mjs",
    imports: [
      "assertTerminalRecoveryBrowserProof",
      "terminalRecoveryBrowserScenario",
    ],
    usages: [
      "const terminalScenario = terminalRecoveryBrowserScenario();",
      "assertTerminalRecoveryBrowserProof({",
    ],
  }),
  Object.freeze({
    moduleSpecifier:
      "./dev_test_game_core_loop_revote_progression_scenarios.mjs",
    imports: [
      "assertRevoteProgressionBrowserProof",
      "revoteNoLynchTargetFromCommandState",
      "revoteProgressionBrowserScenario",
      "revoteProgressionVoteActionId",
    ],
    usages: [
      "const revoteScenario = revoteProgressionBrowserScenario();",
      "assertRevoteProgressionBrowserProof({",
    ],
  }),
  Object.freeze({
    moduleSpecifier:
      "./dev_test_game_core_loop_night_three_progression_scenarios.mjs",
    imports: [
      "assertNightThreeProgressionBrowserProof",
      "nightThreeActionTargetFromCommandState",
      "nightThreeProgressionActionId",
      "nightThreeProgressionBrowserScenario",
    ],
    usages: [
      "const n03Scenario = nightThreeProgressionBrowserScenario();",
      "assertNightThreeProgressionBrowserProof({",
    ],
  }),
]);

test("dev test game browser proof consumes extracted core-loop scenario assertions", async () => {
  const source = await readFile("tools/dev_test_game.mjs", "utf8");

  for (const scenarioModule of browserScenarioModules) {
    assert(
      source.includes(scenarioModule.moduleSpecifier),
      `dev_test_game.mjs should import ${scenarioModule.moduleSpecifier}`,
    );
    for (const importedName of scenarioModule.imports) {
      assert(
        importsFromModule({
          source,
          importedName,
          moduleSpecifier: scenarioModule.moduleSpecifier,
        }),
        `dev_test_game.mjs should import ${importedName} from ${scenarioModule.moduleSpecifier}`,
      );
    }
    for (const usage of scenarioModule.usages) {
      assert(
        source.includes(usage),
        `dev_test_game.mjs should use extracted browser scenario assertion: ${usage}`,
      );
    }
  }

  for (const retiredInlineDriftMessage of [
    "D03 revote boundary drifted",
    "D03/N03 core loop browser proof drifted",
    "night three progression browser proof drifted",
  ]) {
    assert(
      !source.includes(retiredInlineDriftMessage),
      `dev_test_game.mjs should not keep retired inline drift guard ${retiredInlineDriftMessage}`,
    );
  }
});

test("dev test game shares stale host prompt recovery choreography", async () => {
  const source = await readFile("tools/dev_test_game.mjs", "utf8");

  assert(
    source.includes("async function prepareStaleHostPromptRecovery({"),
    "dev_test_game.mjs should own one stale host-prompt recovery choreography helper",
  );
  assert(
    source.includes("const staleD03R2PolicyRecovery = await prepareStaleHostPromptRecovery({"),
    "D03R2 stale policy proof should prepare stale prompt recovery through the shared helper",
  );
  assert(
    source.includes("stalePromptRecovery = await prepareStaleHostPromptRecovery({"),
    "standalone stale host-prompt proof should prepare stale prompt recovery through the shared helper",
  );
  assert.equal(
    occurrenceCount(source, "await freezeStaleHostPromptPage({"),
    1,
    "stale host-prompt pages should be frozen only inside the shared helper",
  );
  assert.equal(
    occurrenceCount(source, "=>\n        submitStaleHostPromptRecovery({"),
    1,
    "stale host-prompt recovery submission should be wired only inside the shared helper",
  );
});

test("dev test game shares host phase action and projection snapshot verbs", async () => {
  const source = await readFile("tools/dev_test_game.mjs", "utf8");

  assert(
    source.includes("async function confirmHostPhaseAction("),
    "dev_test_game.mjs should own one host action plus phase-wait helper",
  );
  assert(
    source.includes("async function hostProjectionSnapshot("),
    "dev_test_game.mjs should own one host projection snapshot helper",
  );
  for (const usage of [
    'const resolveD03 = await confirmHostPhaseAction(hostEntry.page, "resolve_phase"',
    "const hostAfterResolveD03 = await hostProjectionSnapshot(hostEntry.page",
    'const resolveD03R1 = await confirmHostPhaseAction(hostEntry.page, "resolve_phase"',
    "const hostAfterResolveD03R1 = await hostProjectionSnapshot(hostEntry.page",
    'const resolveD03R2 = await confirmHostPhaseAction(hostEntry.page, "resolve_phase"',
    "const hostAfterResolveD03R2 = await hostProjectionSnapshot(hostEntry.page",
    'const resolveN03 = await confirmHostPhaseAction(hostEntry.page, "resolve_phase"',
    "const d04HostSurface = await hostProjectionSnapshot(hostEntry.page",
  ]) {
    assert(
      source.includes(usage),
      `dev_test_game.mjs should use shared host browser verb: ${usage}`,
    );
  }
});

test("dev test game shares player command and projection snapshot verbs", async () => {
  const source = await readFile("tools/dev_test_game.mjs", "utf8");

  assert(
    source.includes("async function submitPlayerCommandAndWait({"),
    "dev_test_game.mjs should own one player command submit plus wait helper",
  );
  assert(
    source.includes("async function playerProjectionSnapshot("),
    "dev_test_game.mjs should own one player projection snapshot helper",
  );
  for (const usage of [
    "const n02ActionSubmission = await submitPlayerCommandAndWait({",
    "const n02ActionAfterSubmit = await playerProjectionSnapshot(actionEntry.page",
    "const d03TerminalVoteSubmission = await submitPlayerCommandAndWait({",
    "const d03TerminalPlayerAfterVote = await playerProjectionSnapshot(",
    "const d03RevoteVoteSubmission = await submitPlayerCommandAndWait({",
    "const d03RevoteActionAfterVote = await playerProjectionSnapshot(",
    "const d03R2RevoteVoteSubmission = await submitPlayerCommandAndWait({",
    "const d03R2RevoteActionAfterVote = await playerProjectionSnapshot(",
    "const n03ActionSubmission = await submitPlayerCommandAndWait({",
    "const n03ActionAfterSubmit = await playerProjectionSnapshot(actionEntry.page",
    "const d04TargetSurface = await playerProjectionSnapshot(playerEntry.page",
  ]) {
    assert(
      source.includes(usage),
      `dev_test_game.mjs should use shared player browser verb: ${usage}`,
    );
  }
});

function importsFromModule({ source, importedName, moduleSpecifier }) {
  const importPattern = new RegExp(
    `import\\s*\\{([^}]*)\\}\\s*from\\s*"${escapeRegExp(moduleSpecifier)}";`,
    "g",
  );
  return Array.from(source.matchAll(importPattern)).some((match) =>
    match[1]
      .split(",")
      .map((entry) => entry.trim())
      .some((entry) =>
        new RegExp(`\\b${escapeRegExp(importedName)}\\b`).test(entry),
      ),
  );
}

function occurrenceCount(source, needle) {
  return source.split(needle).length - 1;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
