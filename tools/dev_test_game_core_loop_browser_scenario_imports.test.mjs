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
