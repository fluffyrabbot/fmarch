import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { main } from "./dev_test_game.mjs";
import { devTestGameHelp } from "./dev_test_game_configuration.mjs";

const sourcePaths = Object.freeze({
  root: "tools/dev_test_game.mjs",
  configuration: "tools/dev_test_game_configuration.mjs",
  artifacts: "tools/dev_test_game_session_artifacts.mjs",
});

const authenticatedPrivateReadSources = Object.freeze([
  "tools/dev_test_game.mjs",
  "tools/host_console_live_stack_smoke.mjs",
  "tools/live_stack_backup_restore_drill.mjs",
  "tools/live_stack/day_event_room_scenario.mjs",
  "tools/completed_game_export_role_proof.mjs",
  "tools/frontend_dispatch_bridge_contract.mjs",
  "tools/frontend_component_interaction_contract.mjs",
  "tools/frontend_role_smoke_artifact_contract.test.mjs",
]);

test("composition root preserves help return and verification validation before I/O", async () => {
  const calls = [];
  const originalLog = console.log;
  console.log = (...values) => calls.push(values);
  try {
    await main(["--help"], {});
  } finally {
    console.log = originalLog;
  }
  assert.deepEqual(calls, [[devTestGameHelp()]]);
  await assert.rejects(
    () => main(["--verify", "--verify-host-setup-only"], {}),
    /only one dev-test-game verification mode may be selected/,
  );
});

test("dev-test-game composition root delegates configuration and artifact ownership", async () => {
  const [root, configuration, artifacts] = await Promise.all(
    Object.values(sourcePaths).map((file) => readFile(file, "utf8")),
  );

  assert.match(root, /from "\.\/dev_test_game_configuration\.mjs"/);
  assert.match(root, /from "\.\/dev_test_game_session_artifacts\.mjs"/);
  for (const use of [
    "normalizeDevTestGameConfiguration({ rawArgs, env })",
    "completeDevTestGameConfiguration({",
    "sessionArtifactsForConfiguration(",
    "sessionArtifactWrites({",
    "verificationProofArtifactWrites({",
    "proofRunArtifactWrite({ proofRun, paths: configuration.paths })",
    "sessionCardConsoleLines(card)",
  ]) {
    assert.ok(root.includes(use), `composition root should use ${use}`);
  }

  for (const retiredOwner of [
    /export function parseArgs\(/,
    /export function selectGame\(/,
    /export function liveProjectionProofConfig\(/,
    /export function buildSessionCard\(/,
    /export function markdownSessionCard\(/,
    /export function buildDevTestGameHostSetupProof\(/,
    /function sessionArtifactsForPaths\(/,
  ]) {
    assert.doesNotMatch(root, retiredOwner);
  }
  assert.doesNotMatch(root, /target", "dev-test-game/);
  assert.doesNotMatch(root, /const configuredMediaRoot = process\.env/);
  assert.doesNotMatch(root, /devTestGameEarliestReachedProofPath/);
  assert.doesNotMatch(root, /devTestGameHostDecidesProofPath/);
  assert.doesNotMatch(root, /devTestGameHostDecidesRaceProofPath/);

  assert.match(configuration, /export function parseArgs\(/);
  assert.match(configuration, /export function selectGame\(/);
  assert.match(configuration, /export function buildDevTestGamePaths\(/);
  assert.match(configuration, /export function normalizeDevTestGameConfiguration\(/);
  assert.match(configuration, /export function completeDevTestGameConfiguration\(/);
  assert.match(configuration, /only one dev-test-game verification mode may be selected/);
  assert.match(configuration, /FMARCH_MEDIA_ROOT must not be empty/);

  assert.match(artifacts, /export function buildSessionCard\(/);
  assert.match(artifacts, /export function markdownSessionCard\(/);
  assert.match(artifacts, /export function verificationProofArtifactWrites\(/);
  assert.match(artifacts, /export function jsonArtifactDocument\(/);
  assert.match(artifacts, /export function sessionCardConsoleLines\(/);
});

test("configuration and artifact owners remain pure values below orchestration", async () => {
  const [root, configuration, artifacts] = await Promise.all(
    Object.values(sourcePaths).map((file) => readFile(file, "utf8")),
  );

  for (const source of [configuration, artifacts]) {
    assert.doesNotMatch(source, /node:child_process/);
    assert.doesNotMatch(source, /node:fs/);
    assert.doesNotMatch(source, /node:net/);
    assert.doesNotMatch(source, /playwright/);
    assert.doesNotMatch(source, /\bspawn\(/);
    assert.doesNotMatch(source, /\bfetch\(/);
    assert.doesNotMatch(source, /process\.on\(/);
    assert.doesNotMatch(source, /console\.(?:log|error|warn)\(/);
  }
  assert.doesNotMatch(configuration, /dev_test_game_session_artifacts/);
  assert.doesNotMatch(artifacts, /dev_test_game_configuration/);
  assert.doesNotMatch(artifacts, /assertDevTestGameProofRun/);

  for (const retainedOwner of [
    /export async function main\(/,
    /async function startApi\(/,
    /async function startFrontend\(/,
    /async function verifySessionCard\(/,
    /async function fetchWithTimeout\(/,
    /async function shutdown\(/,
    /assertDevTestGameProofRun\(proofRun\)/,
    /process\.on\("SIGINT"/,
    /process\.on\("SIGTERM"/,
    /await writeFile\(write\.filePath, write\.contents\)/,
  ]) {
    assert.match(root, retainedOwner);
  }
});

test("matching contracts import the extracted owners directly without a facade", async () => {
  const [testSource, configurationTest, artifactTest] = await Promise.all([
    readFile("tools/dev_test_game.test.mjs", "utf8"),
    readFile("tools/dev_test_game_configuration.test.mjs", "utf8"),
    readFile("tools/dev_test_game_session_artifacts.test.mjs", "utf8"),
  ]);
  assert.match(
    configurationTest,
    /from "\.\/dev_test_game_configuration\.mjs"/,
  );
  assert.match(
    artifactTest,
    /from "\.\/dev_test_game_session_artifacts\.mjs"/,
  );
  const rootImport = testSource.match(
    /import\s*\{([^}]*)\}\s*from "\.\/dev_test_game\.mjs";/s,
  )?.[0];
  assert.notEqual(rootImport, undefined);
  for (const extractedExport of [
    "parseArgs",
    "selectGame",
    "liveProjectionProofConfig",
    "buildSessionCard",
    "markdownSessionCard",
    "buildDevTestGameHostSetupProof",
  ]) {
    assert.doesNotMatch(rootImport, new RegExp(`\\b${extractedExport}\\b`));
  }
});

test("private game reads derive principals only from authenticated sessions", async () => {
  const sources = await Promise.all(
    authenticatedPrivateReadSources.map(async (file) => ({
      file,
      source: await readFile(file, "utf8"),
    })),
  );

  for (const { file, source } of sources) {
    assert.doesNotMatch(
      source,
      /[?&]principal_user_id=/,
      `${file} must not select a private-read principal through the URL`,
    );
  }
});

test("host live-stack fixture inspects sealed events only at the opaque storage boundary", async () => {
  const source = await readFile(
    "tools/host_console_live_stack_smoke.mjs",
    "utf8",
  );

  for (const retiredPlaintextAccess of [
    /payload\s*->/,
    /payload\s*\?/,
    /NEW\.(?:payload|actor|causation_id|meta)\b/,
    /INSERT\s+INTO\s+events\b/i,
    /UPDATE\s+events\b/i,
    /DELETE\s+FROM\s+events\b/i,
  ]) {
    assert.doesNotMatch(source, retiredPlaintextAccess);
  }
  for (const sealedBoundary of [
    /sealed_version\s*=\s*3/,
    /stream_key_epoch\s*>\s*0/,
    /octet_length\(sealed_nonce\)\s*=\s*24/,
    /octet_length\(sealed_body\)\s*>=\s*16/,
    /FROM vote_ballot/,
    /FROM command_receipt/,
    /\/resolution-audit/,
    /\/resolution-traces/,
  ]) {
    assert.match(source, sealedBoundary);
  }

});

test("scratch server proofs isolate disposable subject authorities from repo state", async () => {
  // A scratch database must never reuse the repo-default erasure journal. A
  // journal is deliberately authoritative across database restores, so sharing
  // it with an unrelated ephemeral database must fail server readiness.
  for (const file of [
    "tools/auth_invite_role_proof.mjs",
    "tools/host_console_live_stack_smoke.mjs",
  ]) {
    const source = await readFile(file, "utf8");
    assert.match(
      source,
      /mkdtemp\(path\.join\(artifactDir, "subject-authority-"\)\)/,
      `${file} must allocate an authority unique to its scratch database`,
    );
    assert.match(source, /FMARCH_SUBJECT_KEY_DIR:\s*subjectKeyRoot/);
    assert.match(source, /rm\(subjectKeyRoot, \{ recursive: true, force: true \}\)/);
  }
});
