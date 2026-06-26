import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertDevTestGameProofRun } from "./dev_test_game_proof_contract.mjs";

export const DEV_TEST_GAME_RELEASE_READINESS_VERSION = 1;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = path.join(repoRoot, "target", "dev-test-game");
const defaultProofPath = path.join(artifactDir, "proof-run.json");
const defaultBackupRestoreProofPath = path.join(
  repoRoot,
  "target",
  "live-stack-backup-restore-drill",
  "local-backup-restore-proof.json",
);
const defaultBackupRestoreDumpPath = path.join(
  repoRoot,
  "target",
  "live-stack-backup-restore-drill",
  "local-live-stack.dump",
);
const defaultOpsArtifactsPath = path.join(artifactDir, "ops-artifacts.json");
const defaultSeedFixtureSummaryPath = path.join(
  artifactDir,
  "seed-fixture-summary.json",
);
const jsonPath = path.join(artifactDir, "release-readiness-checklist.json");
const markdownPath = path.join(artifactDir, "release-readiness-checklist.md");
const maxBackupArtifactAgeHours = Number.parseFloat(
  process.env.FMARCH_DEV_TEST_GAME_READINESS_MAX_ARTIFACT_AGE_HOURS ?? "24",
);

if (!Number.isFinite(maxBackupArtifactAgeHours) || maxBackupArtifactAgeHours <= 0) {
  throw new Error(
    "FMARCH_DEV_TEST_GAME_READINESS_MAX_ARTIFACT_AGE_HOURS must be a positive number",
  );
}

export function buildDevTestGameReleaseReadiness(proofRun, options = {}) {
  const proof = assertDevTestGameProofRun(proofRun);
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const sourcePath = options.sourcePath ?? "target/dev-test-game/proof-run.json";
  const backupRestoreEvidence = options.backupRestoreProof
    ? validateDevTestGameBackupRestoreProof(options.backupRestoreProof, {
        proofPath:
          options.backupRestoreProofPath ??
          "target/live-stack-backup-restore-drill/local-backup-restore-proof.json",
        dumpPath:
          options.backupRestoreDumpPath ??
          "target/live-stack-backup-restore-drill/local-live-stack.dump",
        proofArtifact: options.backupRestoreProofArtifact,
        dumpArtifact: options.backupRestoreDumpArtifact,
      })
    : undefined;
  const opsArtifactsEvidence = options.opsArtifacts
    ? validateDevTestGameOpsArtifacts(options.opsArtifacts, {
        path: options.opsArtifactsPath ?? "target/dev-test-game/ops-artifacts.json",
        artifact: options.opsArtifactsArtifact,
      })
    : undefined;
  const seedFixtureEvidence = options.seedFixtureSummary
    ? validateDevTestGameSeedFixtureSummary(options.seedFixtureSummary, {
        path:
          options.seedFixtureSummaryPath ??
          "target/dev-test-game/seed-fixture-summary.json",
        artifact: options.seedFixtureSummaryArtifact,
      })
    : undefined;
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
        "stale-action-conflict",
        "stale-host-control",
      ],
    },
  ];
  if (backupRestoreEvidence !== undefined) {
    localChecks.push({
      id: "local-backup-restore-drill",
      label: "Local dump/restore drill",
      status: "passed",
      evidence: backupRestoreEvidence.path,
      dump: backupRestoreEvidence.dumpPath,
      proofBoundary: backupRestoreEvidence.proofBoundary,
    });
  }
  if (opsArtifactsEvidence !== undefined) {
    localChecks.push({
      id: "local-ops-artifact-bundle",
      label: "Local ops artifact bundle",
      status: "passed",
      evidence: opsArtifactsEvidence.path,
      proofBoundary: opsArtifactsEvidence.proofBoundary,
    });
  }
  if (seedFixtureEvidence !== undefined) {
    localChecks.push({
      id: "local-seed-demo-fixture",
      label: "Local seed/demo fixture summary",
      status: "passed",
      evidence: seedFixtureEvidence.path,
      proofBoundary: seedFixtureEvidence.proofBoundary,
      scenarioCount: seedFixtureEvidence.scenarioCount,
    });
  }
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
    ...(seedFixtureEvidence === undefined
      ? [
          {
            id: "seed-demo-fixtures",
            status: "unproven",
            requiredEvidence:
              "Machine-readable seeded local demo fixture and scenario inventory tied to this proof run",
          },
        ]
      : [
          {
            id: "hosted-demo-fixtures",
            status: "unproven",
            requiredEvidence:
              "Hosted/demo environment fixtures, sanitized demo data policy, and release-safe invite delivery",
          },
        ]),
    ...(backupRestoreEvidence === undefined
      ? [
          {
            id: "backup-restore-drill",
            status: "unproven",
            requiredEvidence:
              "Local or production-like backup/restore drill tied to this dev-test-game spine",
          },
        ]
      : [
          {
            id: "production-backup-recovery",
            status: "unproven",
            requiredEvidence:
              "Production-like backup storage, PITR restore, key escrow, and secret rotation evidence",
          },
        ]),
    {
      id: "exhaustive-race-coverage",
      status: "unproven",
      requiredEvidence:
        "Broader concurrent command race matrix beyond the single proven concurrent vote convergence lane",
    },
    ...(opsArtifactsEvidence === undefined
      ? [
          {
            id: "observability-and-operations",
            status: "unproven",
            requiredEvidence:
              "Saved local proof artifacts, redacted role entrypoints, checksums, logs/metrics/traces, and operator runbook evidence for the seeded game flow",
          },
        ]
      : [
          {
            id: "hosted-observability-and-operations",
            status: "unproven",
            requiredEvidence:
              "Hosted logs, metrics, traces, paging/SLOs, and incident response evidence",
          },
        ]),
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
      ...(backupRestoreEvidence === undefined
        ? {}
        : {
            backupRestoreProof: backupRestoreEvidence.path,
            backupRestoreDump: backupRestoreEvidence.dumpPath,
          }),
      ...(opsArtifactsEvidence === undefined
        ? {}
        : {
            opsArtifacts: opsArtifactsEvidence.path,
          }),
      ...(seedFixtureEvidence === undefined
        ? {}
        : {
            seedFixtureSummary: seedFixtureEvidence.path,
          }),
    },
    localDevelopmentSpine: {
      status: "passed",
      checks: localChecks,
      ...((backupRestoreEvidence === undefined &&
        opsArtifactsEvidence === undefined &&
        seedFixtureEvidence === undefined)
        ? {}
        : {
            evidence: {
              ...(backupRestoreEvidence === undefined
                ? {}
                : { backupRestore: backupRestoreEvidence }),
              ...(opsArtifactsEvidence === undefined
                ? {}
                : { opsArtifacts: opsArtifactsEvidence }),
              ...(seedFixtureEvidence === undefined
                ? {}
                : { seedFixture: seedFixtureEvidence }),
            },
          }),
    },
    releaseReadiness: {
      status: "not_ready",
      reason: releaseReadinessReason({
        backupRestoreEvidence,
        opsArtifactsEvidence,
        seedFixtureEvidence,
      }),
      unproven,
    },
    proofBoundary:
      "Derived from the local dev-test-game proof-run artifact. Passing means the local harness evidence is coherent; it does not mean production, hosted, beta, or release readiness.",
  };
}

function releaseReadinessReason({
  backupRestoreEvidence,
  opsArtifactsEvidence,
  seedFixtureEvidence,
}) {
  const passed = [
    "the local development-spine proof",
    ...(backupRestoreEvidence === undefined ? [] : ["local backup/restore drill"]),
    ...(opsArtifactsEvidence === undefined ? [] : ["local ops artifact bundle"]),
    ...(seedFixtureEvidence === undefined ? [] : ["local seed/demo fixture"]),
  ];
  const missing = [
    "production identity",
    "hosted operations",
    seedFixtureEvidence === undefined ? "seed/demo fixtures" : "hosted demo fixtures",
    backupRestoreEvidence === undefined ? "backup/restore" : "production backup/PITR",
    "exhaustive races",
    opsArtifactsEvidence === undefined ? "observability" : "hosted observability",
    "human release evidence",
  ];
  return `${joinEnglish(passed)} passed, but ${joinEnglish(missing)} remain unproven.`;
}

function joinEnglish(items) {
  if (items.length <= 1) {
    return items.join("");
  }
  if (items.length === 2) {
    return `${items[0]} and ${items[1]}`;
  }
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

export function validateDevTestGameBackupRestoreProof(proof, options = {}) {
  const requiredChecks = [
    "dump-created",
    "event-log-restored",
    "projection-fingerprints-restored",
    "auth-sessions-restored",
    "restored-api-capabilities",
  ];
  if (proof?.version !== 1) {
    throw new Error(`backup/restore proof version drifted: ${proof?.version}`);
  }
  if (proof.status !== "passed") {
    throw new Error(`backup/restore proof status is ${proof.status}`);
  }
  if (proof.scope !== "local-live-stack-backup-restore-drill") {
    throw new Error(`backup/restore proof scope drifted: ${proof.scope}`);
  }
  if (proof.productionReady !== false) {
    throw new Error("backup/restore proof must not claim production readiness");
  }
  const checks = new Map((proof.checks ?? []).map((check) => [check.id, check.status]));
  for (const id of requiredChecks) {
    if (checks.get(id) !== "passed") {
      throw new Error(`backup/restore check failed or missing: ${id}`);
    }
  }
  assertDeepEqual(
    proof.fingerprints?.restored,
    proof.fingerprints?.source,
    "backup/restore source and restored fingerprints",
  );
  if ((proof.fingerprints?.source?.events?.total ?? 0) <= 0) {
    throw new Error("backup/restore proof has no event rows");
  }
  assertSessionCapability(proof, "host", "HostOf");
  assertSessionCapability(proof, "player", "SlotOccupant");
  assertSessionCapability(proof, "player", "ChannelMember");
  assertSessionCapability(proof, "admin", "GlobalAdmin");
  const dumpPath =
    options.dumpPath ?? "target/live-stack-backup-restore-drill/local-live-stack.dump";
  if (proof.artifact?.dump !== dumpPath) {
    throw new Error(`backup/restore dump path drifted: ${proof.artifact?.dump} != ${dumpPath}`);
  }
  return {
    status: "passed",
    path:
      options.proofPath ??
      "target/live-stack-backup-restore-drill/local-backup-restore-proof.json",
    dumpPath,
    checkCount: requiredChecks.length,
    eventRows: proof.fingerprints.source.events.total,
    restoredSessions: proof.restoredApiEvidence.restoredSessions,
    proofBoundary: proof.proofBoundary,
    scope: proof.scope,
    productionReady: proof.productionReady,
    ...(options.proofArtifact === undefined
      ? {}
      : { artifact: options.proofArtifact }),
    ...(options.dumpArtifact === undefined ? {} : { dumpArtifact: options.dumpArtifact }),
  };
}

export function validateDevTestGameOpsArtifacts(ops, options = {}) {
  const requiredChecks = [
    "source-artifacts-checksummed",
    "role-entrypoints-redacted",
    "proof-lanes-summarized",
    "release-boundary-carried",
  ];
  if (ops?.version !== 1) {
    throw new Error(`ops artifact version drifted: ${ops?.version}`);
  }
  if (ops.proof !== "dev-test-game-ops-artifacts") {
    throw new Error(`unexpected ops artifact proof id: ${ops.proof}`);
  }
  if (ops.status !== "passed") {
    throw new Error(`ops artifact status is ${ops.status}`);
  }
  if (ops.scope !== "local-dev-test-game-ops-artifacts") {
    throw new Error(`ops artifact scope drifted: ${ops.scope}`);
  }
  if (ops.productionReady !== false || ops.releaseReady !== false) {
    throw new Error("ops artifact must not claim production or release readiness");
  }
  const checks = new Map((ops.checks ?? []).map((check) => [check.id, check.status]));
  for (const id of requiredChecks) {
    if (checks.get(id) !== "passed") {
      throw new Error(`ops artifact missing passed check: ${id}`);
    }
  }
  if (/invite=(?!REDACTED)/.test(JSON.stringify(ops))) {
    throw new Error("ops artifact leaked an invite URL token");
  }
  return {
    status: "passed",
    path: options.path ?? "target/dev-test-game/ops-artifacts.json",
    checkCount: requiredChecks.length,
    roleCount: ops.run?.roleCount ?? 0,
    laneCount: ops.proofRun?.laneCount ?? 0,
    proofBoundary: ops.proofBoundary,
    scope: ops.scope,
    productionReady: ops.productionReady,
    ...(options.artifact === undefined ? {} : { artifact: options.artifact }),
  };
}

export function validateDevTestGameSeedFixtureSummary(summary, options = {}) {
  const requiredChecks = [
    "role-entrypoints-redacted",
    "seed-slots-enumerated",
    "demo-scenarios-mapped",
    "proof-lanes-carried",
    "release-boundary-carried",
  ];
  const requiredScenarios = [
    "host-phase-controls",
    "player-vote-recovery",
    "night-action-loop",
    "private-channel-member",
    "private-channel-denied",
    "multiplayer-hardening",
    "local-ops-readiness",
  ];
  if (summary?.version !== 1) {
    throw new Error(`seed fixture summary version drifted: ${summary?.version}`);
  }
  if (summary.proof !== "dev-test-game-seed-fixture-summary") {
    throw new Error(`unexpected seed fixture summary proof id: ${summary.proof}`);
  }
  if (summary.status !== "passed") {
    throw new Error(`seed fixture summary status is ${summary.status}`);
  }
  if (summary.scope !== "local-dev-test-game-seed-fixture") {
    throw new Error(`seed fixture summary scope drifted: ${summary.scope}`);
  }
  if (summary.productionReady !== false || summary.releaseReady !== false) {
    throw new Error("seed fixture summary must not claim production or release readiness");
  }
  const checks = new Map((summary.checks ?? []).map((check) => [check.id, check.status]));
  for (const id of requiredChecks) {
    if (checks.get(id) !== "passed") {
      throw new Error(`seed fixture summary missing passed check: ${id}`);
    }
  }
  const scenarios = new Map(
    (summary.demoScenarios ?? []).map((scenario) => [scenario.id, scenario.status]),
  );
  for (const id of requiredScenarios) {
    if (scenarios.get(id) !== "available_locally") {
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
  return {
    status: "passed",
    path: options.path ?? "target/dev-test-game/seed-fixture-summary.json",
    checkCount: requiredChecks.length,
    scenarioCount: requiredScenarios.length,
    roleCount: summary.fixture?.roleCount ?? 0,
    slotCount: summary.fixture?.slots?.length ?? 0,
    proofBoundary: summary.proofBoundary,
    scope: summary.scope,
    productionReady: summary.productionReady,
    ...(options.artifact === undefined ? {} : { artifact: options.artifact }),
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
  for (const check of checklist.localDevelopmentSpine?.checks ?? []) {
    if (check.status !== "passed") {
      throw new Error(`dev-test-game local check ${check.id} did not pass`);
    }
  }
  if (checklist.releaseReadiness?.status !== "not_ready") {
    throw new Error("dev-test-game release readiness must remain not_ready");
  }
  const hasBackupCheck = checklist.localDevelopmentSpine?.checks?.some(
    (check) => check.id === "local-backup-restore-drill" && check.status === "passed",
  );
  const hasBackupUnproven = checklist.releaseReadiness?.unproven?.some(
    (item) => item.id === "backup-restore-drill",
  );
  if (hasBackupCheck && hasBackupUnproven) {
    throw new Error("dev-test-game backup/restore cannot be both passed and unproven");
  }
  const hasOpsCheck = checklist.localDevelopmentSpine?.checks?.some(
    (check) => check.id === "local-ops-artifact-bundle" && check.status === "passed",
  );
  const hasOpsUnproven = checklist.releaseReadiness?.unproven?.some(
    (item) => item.id === "observability-and-operations",
  );
  if (hasOpsCheck && hasOpsUnproven) {
    throw new Error("dev-test-game ops artifacts cannot be both passed and unproven");
  }
  const hasSeedFixtureCheck = checklist.localDevelopmentSpine?.checks?.some(
    (check) => check.id === "local-seed-demo-fixture" && check.status === "passed",
  );
  const hasSeedFixtureUnproven = checklist.releaseReadiness?.unproven?.some(
    (item) => item.id === "seed-demo-fixtures",
  );
  if (hasSeedFixtureCheck && hasSeedFixtureUnproven) {
    throw new Error("dev-test-game seed fixtures cannot be both passed and unproven");
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
  const [backupRestoreOptions, opsArtifactsOptions, seedFixtureOptions] =
    await Promise.all([
      readOptionalBackupRestoreArtifacts(),
      readOptionalOpsArtifacts(),
      readOptionalSeedFixtureSummary(),
    ]);
  const checklist = buildDevTestGameReleaseReadiness(proofRun, {
    sourcePath: path.relative(repoRoot, proofPath),
    ...(backupRestoreOptions ?? {}),
    ...(opsArtifactsOptions ?? {}),
    ...(seedFixtureOptions ?? {}),
  });
  assertDevTestGameReleaseReadiness(checklist);
  await mkdir(artifactDir, { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(checklist, null, 2)}\n`);
  await writeFile(markdownPath, markdownChecklist(checklist));
  console.log(
    `wrote ${path.relative(repoRoot, jsonPath)} (${checklist.releaseReadiness.status})`,
  );
}

async function readOptionalOpsArtifacts() {
  const override = process.env.FMARCH_DEV_TEST_GAME_OPS_ARTIFACTS;
  if (override === undefined || override.trim() === "") {
    return undefined;
  }
  const now = new Date();
  const opsPath = resolveArtifactPath(override, defaultOpsArtifactsPath);
  const artifact = await readFreshArtifactMetadata(opsPath, now);
  return {
    opsArtifacts: JSON.parse(await readFile(opsPath, "utf8")),
    opsArtifactsPath: path.relative(repoRoot, opsPath),
    opsArtifactsArtifact: artifact,
  };
}

async function readOptionalSeedFixtureSummary() {
  const override = process.env.FMARCH_DEV_TEST_GAME_SEED_FIXTURE_SUMMARY;
  if (override === undefined || override.trim() === "") {
    return undefined;
  }
  const now = new Date();
  const fixturePath = resolveArtifactPath(override, defaultSeedFixtureSummaryPath);
  const artifact = await readFreshArtifactMetadata(fixturePath, now);
  return {
    seedFixtureSummary: JSON.parse(await readFile(fixturePath, "utf8")),
    seedFixtureSummaryPath: path.relative(repoRoot, fixturePath),
    seedFixtureSummaryArtifact: artifact,
  };
}

async function readOptionalBackupRestoreArtifacts() {
  const proofOverride = process.env.FMARCH_DEV_TEST_GAME_BACKUP_RESTORE_PROOF;
  const dumpOverride = process.env.FMARCH_DEV_TEST_GAME_BACKUP_RESTORE_DUMP;
  if ((proofOverride === undefined) !== (dumpOverride === undefined)) {
    throw new Error(
      "FMARCH_DEV_TEST_GAME_BACKUP_RESTORE_PROOF and FMARCH_DEV_TEST_GAME_BACKUP_RESTORE_DUMP must be set together",
    );
  }
  if (proofOverride === undefined) {
    return undefined;
  }
  const now = new Date();
  const proofPath = resolveArtifactPath(proofOverride, defaultBackupRestoreProofPath);
  const dumpPath = resolveArtifactPath(dumpOverride, defaultBackupRestoreDumpPath);
  const [proofArtifact, dumpArtifact] = await Promise.all([
    readFreshArtifactMetadata(proofPath, now),
    readFreshArtifactMetadata(dumpPath, now),
  ]);
  return {
    backupRestoreProof: JSON.parse(await readFile(proofPath, "utf8")),
    backupRestoreProofPath: path.relative(repoRoot, proofPath),
    backupRestoreDumpPath: path.relative(repoRoot, dumpPath),
    backupRestoreProofArtifact: proofArtifact,
    backupRestoreDumpArtifact: dumpArtifact,
  };
}

function resolveArtifactPath(value, fallback) {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  return path.resolve(process.cwd(), value);
}

async function readFreshArtifactMetadata(absolutePath, now) {
  const metadata = await stat(absolutePath);
  const ageMs = now.getTime() - metadata.mtime.getTime();
  if (ageMs < 0) {
    throw new Error(`${path.relative(repoRoot, absolutePath)} has a future mtime`);
  }
  const maxAgeMs = maxBackupArtifactAgeHours * 60 * 60 * 1000;
  if (ageMs > maxAgeMs) {
    throw new Error(
      `${path.relative(repoRoot, absolutePath)} is stale: ${formatAge(ageMs)} old`,
    );
  }
  return {
    path: path.relative(repoRoot, absolutePath),
    mtime: metadata.mtime.toISOString(),
    ageSeconds: Math.round(ageMs / 1000),
    sizeBytes: metadata.size,
  };
}

function assertSessionCapability(proof, sessionKey, capability) {
  const capabilities = proof.restoredApiEvidence?.restoredSessions?.[sessionKey] ?? [];
  if (!capabilities.includes(capability)) {
    throw new Error(`restored ${sessionKey} session missing ${capability}`);
  }
}

function assertDeepEqual(actual, expected, label) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${label} mismatch\nactual: ${actualJson}\nexpected: ${expectedJson}`);
  }
}

function formatAge(ageMs) {
  const hours = Math.floor(ageMs / (60 * 60 * 1000));
  const minutes = Math.floor((ageMs % (60 * 60 * 1000)) / (60 * 1000));
  return `${hours}h ${minutes}m`;
}
