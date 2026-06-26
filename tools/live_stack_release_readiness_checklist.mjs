import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertLiveStackReadiness,
  buildLiveStackReadiness,
} from "./live_stack_readiness_contract.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = path.join(repoRoot, "target", "live-stack-release-readiness");
const jsonPath = path.join(artifactDir, "release-readiness-checklist.json");
const markdownPath = path.join(artifactDir, "release-readiness-checklist.md");
const defaultSources = Object.freeze({
  liveStackProof: "target/host-console-live-stack-smoke/live-stack-proof.json",
  inviteRoleProof: "target/auth-invite-role-proof/invite-role-proof.json",
  backupRestoreProof:
    "target/live-stack-backup-restore-drill/local-backup-restore-proof.json",
  backupRestoreDump: "target/live-stack-backup-restore-drill/local-live-stack.dump",
});
const maxArtifactAgeHours = Number.parseFloat(
  process.env.FMARCH_RELEASE_READINESS_MAX_ARTIFACT_AGE_HOURS ?? "24",
);
const maxArtifactAgeMs = maxArtifactAgeHours * 60 * 60 * 1000;

if (!Number.isFinite(maxArtifactAgeMs) || maxArtifactAgeMs <= 0) {
  throw new Error(
    "FMARCH_RELEASE_READINESS_MAX_ARTIFACT_AGE_HOURS must be a positive number",
  );
}

const sources = {
  liveStackProof: resolveSource(process.env.FMARCH_LIVE_STACK_PROOF),
  inviteRoleProof: resolveSource(process.env.FMARCH_INVITE_ROLE_PROOF),
  backupRestoreProof: resolveSource(process.env.FMARCH_BACKUP_RESTORE_PROOF),
  backupRestoreDump: resolveSource(process.env.FMARCH_BACKUP_RESTORE_DUMP),
};

const now = new Date();
const sourceArtifacts = {
  liveStackProof: await readFreshJsonArtifact(
    sources.liveStackProof,
    defaultSources.liveStackProof,
    now,
  ),
  backupRestoreProof: await readFreshJsonArtifact(
    sources.backupRestoreProof,
    defaultSources.backupRestoreProof,
    now,
  ),
  inviteRoleProof: await readFreshJsonArtifact(
    sources.inviteRoleProof,
    defaultSources.inviteRoleProof,
    now,
  ),
  backupRestoreDump: await readFreshBinaryArtifact(
    sources.backupRestoreDump,
    defaultSources.backupRestoreDump,
    now,
  ),
};

const liveStackEvidence = validateLiveStackProof(sourceArtifacts.liveStackProof);
const inviteRoleEvidence = validateInviteRoleProof(sourceArtifacts.inviteRoleProof);
const backupRestoreEvidence = validateBackupRestoreProof(
  sourceArtifacts.backupRestoreProof,
  sourceArtifacts.backupRestoreDump,
);

const checklist = buildChecklist({
  generatedAt: now.toISOString(),
  maxArtifactAgeHours,
  sources,
  sourceArtifacts,
  liveStackEvidence,
  inviteRoleEvidence,
  backupRestoreEvidence,
});

assertChecklist(checklist);

await mkdir(artifactDir, { recursive: true });
await writeFile(jsonPath, `${JSON.stringify(checklist, null, 2)}\n`);
await writeFile(markdownPath, markdownChecklist(checklist));

console.log(
  `wrote ${path.relative(repoRoot, jsonPath)} (${checklist.localDevelopmentSpine.status})`,
);

function resolveSource(override) {
  if (override === undefined || override.trim() === "") {
    return undefined;
  }
  return path.relative(repoRoot, path.resolve(process.cwd(), override));
}

async function readFreshJsonArtifact(source, defaultSource, now) {
  const artifactPath = source ?? defaultSource;
  const absolutePath = path.resolve(repoRoot, artifactPath);
  const metadata = await artifactMetadata(absolutePath, now);
  const parsed = JSON.parse(await readFile(absolutePath, "utf8"));
  return {
    path: path.relative(repoRoot, absolutePath),
    ...metadata,
    data: parsed,
  };
}

async function readFreshBinaryArtifact(source, defaultSource, now) {
  const artifactPath = source ?? defaultSource;
  const absolutePath = path.resolve(repoRoot, artifactPath);
  const metadata = await artifactMetadata(absolutePath, now);
  return {
    path: path.relative(repoRoot, absolutePath),
    ...metadata,
  };
}

async function artifactMetadata(absolutePath, now) {
  const metadata = await stat(absolutePath);
  const ageMs = now.getTime() - metadata.mtime.getTime();
  if (ageMs < 0) {
    throw new Error(`${path.relative(repoRoot, absolutePath)} has a future mtime`);
  }
  if (ageMs > maxArtifactAgeMs) {
    throw new Error(
      `${path.relative(repoRoot, absolutePath)} is stale: ${formatAge(ageMs)} old`,
    );
  }
  return {
    mtime: metadata.mtime.toISOString(),
    ageSeconds: Math.round(ageMs / 1000),
    sizeBytes: metadata.size,
  };
}

function validateLiveStackProof(artifact) {
  const proof = artifact.data;
  if (proof.status !== "passed") {
    throw new Error(`live-stack proof status is ${proof.status}`);
  }
  const recalculated = buildLiveStackReadiness(proof);
  assertLiveStackReadiness(recalculated);
  if (JSON.stringify(proof.readiness) !== JSON.stringify(recalculated)) {
    throw new Error("live-stack readiness is stale or missing");
  }
  if (recalculated.scope !== "local-live-stack-harness") {
    throw new Error(`live-stack scope drifted: ${recalculated.scope}`);
  }
  return {
    status: "passed",
    path: artifact.path,
    artifactMtime: artifact.mtime,
    checkCount: recalculated.checks.length,
    proofBoundary: recalculated.proofBoundary,
    scope: recalculated.scope,
    productionReady: recalculated.productionReady,
  };
}

function validateBackupRestoreProof(proofArtifact, dumpArtifact) {
  const proof = proofArtifact.data;
  const requiredChecks = [
    "dump-created",
    "event-log-restored",
    "projection-fingerprints-restored",
    "auth-sessions-restored",
    "restored-api-capabilities",
  ];
  if (proof.version !== 1) {
    throw new Error(`backup/restore proof version drifted: ${proof.version}`);
  }
  if (proof.status !== "passed") {
    throw new Error(`backup/restore proof status is ${proof.status}`);
  }
  if (proof.scope !== "local-live-stack-backup-restore-drill") {
    throw new Error(`backup/restore scope drifted: ${proof.scope}`);
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
  if (proof.artifact?.dump !== dumpArtifact.path) {
    throw new Error(
      `backup/restore dump path drifted: ${proof.artifact?.dump} != ${dumpArtifact.path}`,
    );
  }
  return {
    status: "passed",
    path: proofArtifact.path,
    dumpPath: dumpArtifact.path,
    artifactMtime: proofArtifact.mtime,
    dumpMtime: dumpArtifact.mtime,
    checkCount: requiredChecks.length,
    eventRows: proof.fingerprints.source.events.total,
    restoredSessions: proof.restoredApiEvidence.restoredSessions,
    proofBoundary: proof.proofBoundary,
    scope: proof.scope,
    productionReady: proof.productionReady,
  };
}

function validateInviteRoleProof(artifact) {
  const proof = artifact.data;
  if (proof.status !== "passed") {
    throw new Error(`invite role proof status is ${proof.status}`);
  }
  if (proof.scope !== "local-auth-invite-role-proof") {
    throw new Error(`invite role proof scope drifted: ${proof.scope}`);
  }
  if (proof.productionReady !== false) {
    throw new Error("invite role proof must not claim production readiness");
  }
  const required = new Map([
    ["admin", "GlobalAdmin"],
    ["host", "HostOf"],
    ["player", "SlotOccupant"],
  ]);
  for (const [role, capability] of required) {
    const roleEvidence = proof.roles?.[role];
    if (!roleEvidence?.capabilityKinds?.includes(capability)) {
      throw new Error(`invite role proof missing ${role} ${capability}`);
    }
    if (roleEvidence.cookie?.valuePrefix !== "invite-session-") {
      throw new Error(`invite role proof did not issue an invite session for ${role}`);
    }
  }
  return {
    status: "passed",
    path: artifact.path,
    artifactMtime: artifact.mtime,
    roleCount: required.size,
    roles: Object.fromEntries(
      [...required.keys()].map((role) => [
        role,
        {
          principalUserId: proof.roles[role].principalUserId,
          capabilityKinds: proof.roles[role].capabilityKinds,
          returnTo: proof.roles[role].returnTo,
        },
      ]),
    ),
    proofBoundary: proof.proofBoundary,
    scope: proof.scope,
    productionReady: proof.productionReady,
  };
}

function buildChecklist({
  generatedAt,
  maxArtifactAgeHours,
  sources,
  sourceArtifacts,
  liveStackEvidence,
  inviteRoleEvidence,
  backupRestoreEvidence,
}) {
  const localChecks = [
    {
      id: "live-stack-role-browser-proof",
      label: "Seeded role URLs and browser proof",
      status: "passed",
      evidence: liveStackEvidence.path,
      proofBoundary: liveStackEvidence.proofBoundary,
    },
    {
      id: "invite-issued-role-url-proof",
      label: "Invite-issued role URLs preserve role surfaces",
      status: "passed",
      evidence: inviteRoleEvidence.path,
      proofBoundary: inviteRoleEvidence.proofBoundary,
    },
    {
      id: "local-backup-restore-drill",
      label: "Local dump/restore drill",
      status: "passed",
      evidence: backupRestoreEvidence.path,
      proofBoundary: backupRestoreEvidence.proofBoundary,
    },
  ];
  const unprovenReleaseItems = [
    {
      id: "hosted-deployment",
      status: "unproven",
      requiredEvidence: "Hosted API/frontend deployment proof with external URL and health checks",
    },
    {
      id: "production-identity",
      status: "unproven",
      requiredEvidence: "Hosted real accounts, sessions, and invite delivery replacing local/dev tokens",
    },
    {
      id: "key-escrow-and-secret-rotation",
      status: "unproven",
      requiredEvidence: "Documented and exercised key escrow, restore, and rotation drill",
    },
    {
      id: "point-in-time-recovery",
      status: "unproven",
      requiredEvidence: "PITR restore proof from managed or production-like backup storage",
    },
    {
      id: "multi-node-failover",
      status: "unproven",
      requiredEvidence: "Concurrent/multi-node failover or rolling restart proof",
    },
    {
      id: "human-release-runbook",
      status: "unproven",
      requiredEvidence: "Human-executed beta/release checklist with rollback and support contacts",
    },
  ];
  return {
    version: 1,
    status: "passed",
    releaseReady: false,
    generatedAt,
    scope: "local-live-stack-release-readiness-checklist",
    proofBoundary:
      "Derived local checklist over fresh live-stack, invite-role, and backup/restore artifacts. Passing means the local development-spine evidence is coherent; it does not mean beta, hosted, production, or human release readiness.",
    maxArtifactAgeHours,
    generatedFrom: {
      liveStackProof: sources.liveStackProof ?? defaultSources.liveStackProof,
      inviteRoleProof: sources.inviteRoleProof ?? defaultSources.inviteRoleProof,
      backupRestoreProof:
        sources.backupRestoreProof ?? defaultSources.backupRestoreProof,
      backupRestoreDump:
        sources.backupRestoreDump ?? defaultSources.backupRestoreDump,
    },
    localDevelopmentSpine: {
      status: "passed",
      checks: localChecks,
      evidence: {
        liveStack: liveStackEvidence,
        inviteRole: inviteRoleEvidence,
        backupRestore: backupRestoreEvidence,
      },
      artifacts: {
        liveStackProof: artifactSummary(sourceArtifacts.liveStackProof),
        inviteRoleProof: artifactSummary(sourceArtifacts.inviteRoleProof),
        backupRestoreProof: artifactSummary(sourceArtifacts.backupRestoreProof),
        backupRestoreDump: artifactSummary(sourceArtifacts.backupRestoreDump),
      },
    },
    releaseReadiness: {
      status: "not_ready",
      reason:
        "Only local harness evidence has passed. Production identity, hosted operations, and release runbook evidence remain unproven.",
      unproven: unprovenReleaseItems,
    },
  };
}

function assertChecklist(checklist) {
  if (checklist.status !== "passed") {
    throw new Error(`release-readiness checklist status is ${checklist.status}`);
  }
  if (checklist.releaseReady !== false) {
    throw new Error("release-readiness checklist must not claim releaseReady");
  }
  if (checklist.localDevelopmentSpine.status !== "passed") {
    throw new Error("local development spine checklist did not pass");
  }
  if (checklist.releaseReadiness.status !== "not_ready") {
    throw new Error("release readiness must remain not_ready until production proof exists");
  }
  for (const item of checklist.releaseReadiness.unproven) {
    if (item.status !== "unproven") {
      throw new Error(`release item ${item.id} must remain unproven`);
    }
  }
}

function markdownChecklist(checklist) {
  const lines = [
    "# fmarch Live-Stack Release Readiness Checklist",
    "",
    `- status: ${checklist.status}`,
    `- releaseReady: ${checklist.releaseReady}`,
    `- generatedAt: ${checklist.generatedAt}`,
    `- scope: ${checklist.scope}`,
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

function artifactSummary(artifact) {
  return {
    path: artifact.path,
    mtime: artifact.mtime,
    ageSeconds: artifact.ageSeconds,
    sizeBytes: artifact.sizeBytes,
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
