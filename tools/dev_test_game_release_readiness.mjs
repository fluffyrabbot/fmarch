import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertDevTestGameProofRun } from "./dev_test_game_proof_contract.mjs";

export const DEV_TEST_GAME_RELEASE_READINESS_VERSION = 1;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = path.join(repoRoot, "target", "dev-test-game");
const defaultProofPath = path.join(artifactDir, "proof-run.json");
const jsonPath = path.join(artifactDir, "release-readiness-checklist.json");
const markdownPath = path.join(artifactDir, "release-readiness-checklist.md");

export function buildDevTestGameReleaseReadiness(proofRun, options = {}) {
  const proof = assertDevTestGameProofRun(proofRun);
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const sourcePath = options.sourcePath ?? "target/dev-test-game/proof-run.json";
  const localChecks = [
    {
      id: "local-role-url-browser-proof",
      label: "Seeded role URLs and browser proof",
      status: "passed",
      evidence: sourcePath,
      laneIds: proof.lanes.map((lane) => lane.id),
    },
    {
      id: "local-core-loop-proof",
      label: "Host controls, player actions, private channels, and day/night loop",
      status: "passed",
      evidence: sourcePath,
      laneIds: ["core-loop", "action-loop", "private-channel"],
    },
    {
      id: "local-hardening-proof",
      label: "Idempotency, reconnect, stale-client, and one concurrent vote race",
      status: "passed",
      evidence: sourcePath,
      laneIds: [
        "idempotent-retry",
        "reconnect-recovery",
        "stale-player-vote",
        "concurrent-vote-race",
        "stale-host-control",
      ],
    },
  ];
  const unproven = [
    {
      id: "production-identity",
      status: "unproven",
      requiredEvidence:
        "Real accounts, sessions, and invite delivery replacing local dev tokens without changing role surfaces",
    },
    {
      id: "hosted-deployment",
      status: "unproven",
      requiredEvidence: "Hosted API/frontend deployment proof with external health checks",
    },
    {
      id: "backup-restore-drill",
      status: "unproven",
      requiredEvidence: "Local or production-like backup/restore drill tied to this dev-test-game spine",
    },
    {
      id: "exhaustive-race-coverage",
      status: "unproven",
      requiredEvidence:
        "Broader concurrent command race matrix beyond the single proven concurrent vote convergence lane",
    },
    {
      id: "observability-and-operations",
      status: "unproven",
      requiredEvidence: "Saved logs/metrics/traces and operator runbook evidence for the seeded game flow",
    },
    {
      id: "human-release-runbook",
      status: "unproven",
      requiredEvidence: "Human-executed beta/release checklist with rollback and support path",
    },
  ];
  return {
    version: DEV_TEST_GAME_RELEASE_READINESS_VERSION,
    proof: "dev-test-game-release-readiness",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    generatedAt,
    scope: "local-dev-test-game-release-readiness-checklist",
    generatedFrom: {
      proofRun: sourcePath,
      proofGeneratedAt: proof.generatedAt,
      game: proof.session.game,
    },
    localDevelopmentSpine: {
      status: "passed",
      checks: localChecks,
    },
    releaseReadiness: {
      status: "not_ready",
      reason:
        "The local development-spine proof passed, but production identity, hosted operations, backup/restore, exhaustive races, observability, and human release evidence remain unproven.",
      unproven,
    },
    proofBoundary:
      "Derived from the local dev-test-game proof-run artifact. Passing means the local harness evidence is coherent; it does not mean production, hosted, beta, or release readiness.",
  };
}

export function assertDevTestGameReleaseReadiness(checklist) {
  if (checklist?.version !== DEV_TEST_GAME_RELEASE_READINESS_VERSION) {
    throw new Error(
      `dev-test-game release readiness version drifted: ${checklist?.version}`,
    );
  }
  if (checklist.proof !== "dev-test-game-release-readiness") {
    throw new Error(`unexpected dev-test-game readiness proof id: ${checklist.proof}`);
  }
  if (checklist.status !== "passed") {
    throw new Error(`dev-test-game readiness status is ${checklist.status}`);
  }
  if (checklist.productionReady !== false || checklist.releaseReady !== false) {
    throw new Error("dev-test-game readiness must not claim production or release readiness");
  }
  if (checklist.localDevelopmentSpine?.status !== "passed") {
    throw new Error("dev-test-game local development spine did not pass");
  }
  if (checklist.releaseReadiness?.status !== "not_ready") {
    throw new Error("dev-test-game release readiness must remain not_ready");
  }
  for (const item of checklist.releaseReadiness?.unproven ?? []) {
    if (item.status !== "unproven") {
      throw new Error(`release item ${item.id} must remain unproven`);
    }
  }
  return checklist;
}

function markdownChecklist(checklist) {
  const lines = [
    "# fmarch Dev Test Game Release Readiness",
    "",
    `- status: ${checklist.status}`,
    `- releaseReady: ${checklist.releaseReady}`,
    `- productionReady: ${checklist.productionReady}`,
    `- generatedAt: ${checklist.generatedAt}`,
    `- game: ${checklist.generatedFrom.game}`,
    "",
    checklist.proofBoundary,
    "",
    "## Local Development Spine",
    "",
    `Status: ${checklist.localDevelopmentSpine.status}`,
    "",
    "| Check | Status | Evidence |",
    "| --- | --- | --- |",
  ];
  for (const check of checklist.localDevelopmentSpine.checks) {
    lines.push(`| ${check.label} | ${check.status} | \`${check.evidence}\` |`);
  }
  lines.push(
    "",
    "## Release Readiness",
    "",
    `Status: ${checklist.releaseReadiness.status}`,
    "",
    checklist.releaseReadiness.reason,
    "",
    "| Item | Status | Required Evidence |",
    "| --- | --- | --- |",
  );
  for (const item of checklist.releaseReadiness.unproven) {
    lines.push(`| ${item.id} | ${item.status} | ${item.requiredEvidence} |`);
  }
  return `${lines.join("\n")}\n`;
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  const proofPath = process.argv[2]
    ? path.resolve(process.cwd(), process.argv[2])
    : defaultProofPath;
  const proofRun = JSON.parse(await readFile(proofPath, "utf8"));
  const checklist = buildDevTestGameReleaseReadiness(proofRun, {
    sourcePath: path.relative(repoRoot, proofPath),
  });
  assertDevTestGameReleaseReadiness(checklist);
  await mkdir(artifactDir, { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(checklist, null, 2)}\n`);
  await writeFile(markdownPath, markdownChecklist(checklist));
  console.log(
    `wrote ${path.relative(repoRoot, jsonPath)} (${checklist.releaseReadiness.status})`,
  );
}
