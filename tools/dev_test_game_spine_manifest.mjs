import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  adminSpineProofPath,
  adminSpineReadinessEvidenceEnv,
} from "./dev_test_game_admin_spine.mjs";
import { devTestGameAdminSpineProofPlan } from "./dev_test_game_admin_spine_proof.mjs";
import {
  backupAwareOpsEnv,
  backupRestoreEvidenceEnv,
  backupRestoreFinalReadinessEnv,
  devTestGameBackupRestoreSpinePlan,
  opsReadinessEnv,
  seedReadinessEnv,
} from "./dev_test_game_backup_restore_spine.mjs";
import {
  devTestGameIdentitySpinePlan,
  identityReadinessEnv,
} from "./dev_test_game_identity_spine.mjs";
import { devTestGameLiveSpinePlan } from "./dev_test_game_live_spine.mjs";
import { repoRoot } from "./dev_test_game_spine_runner.mjs";

export const DEV_TEST_GAME_SPINE_MANIFEST_VERSION = 1;

export const spineManifestPath = "target/dev-test-game/spine-manifest.json";
export const spineManifestMarkdownPath = "target/dev-test-game/spine-manifest.md";
export const proofFreshnessAdminProofPath =
  "target/dev-test-game/proof-freshness-admin-proof.json";
export const proofFreshnessAdminProofCommand =
  "test:dev-test-game-proof-freshness-admin-proof";

const manifestJsonPath = path.join(repoRoot, spineManifestPath);
const manifestMarkdownPath = path.join(repoRoot, spineManifestMarkdownPath);

export function buildDevTestGameSpineManifest({
  generatedAt = new Date().toISOString(),
} = {}) {
  const evidenceEnv = {
    backupRestore: {
      backupRestoreEvidenceEnv,
      backupAwareOpsEnv,
      opsReadinessEnv,
      seedReadinessEnv,
      backupRestoreFinalReadinessEnv,
    },
    identity: {
      identityReadinessEnv,
    },
    adminSpine: {
      adminSpineReadinessEvidenceEnv,
    },
  };
  const manifest = {
    version: DEV_TEST_GAME_SPINE_MANIFEST_VERSION,
    proof: "dev-test-game-spine-manifest",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    generatedAt,
    scope: "local-dev-test-game-spine-manifest",
    proofBoundary:
      "Generated local dev-test-game orchestration manifest. It records proof command order and evidence env wiring; it does not prove hosted deployment, hosted identity, hosted operations, production readiness, beta readiness, or release readiness.",
    commands: {
      live: {
        script: "test:dev-test-game-live",
        plan: clonePlan(devTestGameLiveSpinePlan),
      },
      backupRestore: {
        script: "test:dev-test-game-backup-restore",
        plan: clonePlan(devTestGameBackupRestoreSpinePlan),
      },
      identity: {
        script: "test:dev-test-game-identity",
        plan: clonePlan(devTestGameIdentitySpinePlan),
      },
      adminSpine: {
        script: "test:dev-test-game-admin-spine",
        plan: cloneAdminProofPlan(devTestGameAdminSpineProofPlan),
        proofArtifact: adminSpineProofPath,
        readinessEnv: { ...adminSpineReadinessEvidenceEnv },
      },
      proofFreshness: {
        script: proofFreshnessAdminProofCommand,
        proofArtifact: proofFreshnessAdminProofPath,
        dependsOn: [
          spineManifestPath,
          adminSpineProofPath,
          "target/dev-test-game/release-readiness-checklist.json",
        ],
      },
    },
    evidenceEnv,
    artifacts: uniqueSorted([
      spineManifestPath,
      spineManifestMarkdownPath,
      adminSpineProofPath,
      proofFreshnessAdminProofPath,
      ...devTestGameAdminSpineProofPlan.map((step) => step.path),
      ...envValues(evidenceEnv.backupRestore.backupRestoreEvidenceEnv),
      ...envValues(evidenceEnv.backupRestore.backupAwareOpsEnv),
      ...envValues(evidenceEnv.backupRestore.opsReadinessEnv),
      ...envValues(evidenceEnv.backupRestore.seedReadinessEnv),
      ...envValues(evidenceEnv.backupRestore.backupRestoreFinalReadinessEnv),
      ...envValues(evidenceEnv.identity.identityReadinessEnv),
      ...envValues(evidenceEnv.adminSpine.adminSpineReadinessEvidenceEnv),
    ]),
    checks: [
      {
        id: "live-spine-order-recorded",
        status: "passed",
        evidence: devTestGameLiveSpinePlan.map((step) => step.script),
      },
      {
        id: "sub-spine-orders-recorded",
        status: "passed",
        evidence: [
          "test:dev-test-game-backup-restore",
          "test:dev-test-game-identity",
          "test:dev-test-game-admin-spine",
        ],
      },
      {
        id: "evidence-env-wiring-recorded",
        status: "passed",
        evidence: Object.keys(adminSpineReadinessEvidenceEnv),
      },
      {
        id: "freshness-proof-recorded",
        status: "passed",
        evidence: [proofFreshnessAdminProofCommand, proofFreshnessAdminProofPath],
      },
      {
        id: "release-boundary-carried",
        status: "passed",
        releaseReady: false,
        productionReady: false,
      },
    ],
  };
  assertDevTestGameSpineManifest(manifest);
  return manifest;
}

export function assertDevTestGameSpineManifest(manifest) {
  if (manifest?.version !== DEV_TEST_GAME_SPINE_MANIFEST_VERSION) {
    throw new Error(`spine manifest version drifted: ${manifest?.version}`);
  }
  if (manifest.proof !== "dev-test-game-spine-manifest") {
    throw new Error(`unexpected spine manifest proof id: ${manifest.proof}`);
  }
  if (manifest.status !== "passed") {
    throw new Error(`spine manifest status is ${manifest.status}`);
  }
  if (manifest.scope !== "local-dev-test-game-spine-manifest") {
    throw new Error(`spine manifest scope drifted: ${manifest.scope}`);
  }
  if (manifest.releaseReady !== false || manifest.productionReady !== false) {
    throw new Error("spine manifest must not claim production or release readiness");
  }
  const livePlan = manifest.commands?.live?.plan ?? [];
  assertPlanScripts(livePlan, [
    "dev:test-game:prebuild",
    "tools/dev_test_game_live_proof.mjs",
    "tools/dev_test_game_proof_contract.mjs",
    "tools/dev_test_game_release_readiness.mjs",
    "backup-restore",
    "identity",
    "admin",
  ]);
  assertPlanScripts(manifest.commands?.backupRestore?.plan ?? [], [
    "tools/live_stack_backup_restore_drill.mjs",
    "tools/dev_test_game_release_readiness.mjs",
    "tools/dev_test_game_ops_artifacts.mjs",
    "tools/dev_test_game_release_readiness.mjs",
    "tools/dev_test_game_seed_fixture_summary.mjs",
    "tools/dev_test_game_seed_admin_proof.mjs",
    "tools/dev_test_game_release_readiness.mjs",
    "tools/dev_test_game_backup_admin_proof.mjs",
    "tools/dev_test_game_release_readiness.mjs",
  ]);
  assertPlanScripts(manifest.commands?.identity?.plan ?? [], [
    "tools/auth_invite_role_proof.mjs",
    "tools/dev_test_game_identity_admin_proof.mjs",
    "tools/dev_test_game_release_readiness.mjs",
  ]);
  assertPlanScripts(manifest.commands?.adminSpine?.plan ?? [], [
    "tools/dev_test_game_core_loop_admin_proof.mjs",
    "tools/dev_test_game_hardening_admin_proof.mjs",
    "tools/dev_test_game_identity_admin_proof.mjs",
    "tools/dev_test_game_backup_admin_proof.mjs",
    "tools/dev_test_game_ops_admin_proof.mjs",
    "tools/dev_test_game_seed_admin_proof.mjs",
    "tools/dev_test_game_release_admin_proof.mjs",
    "tools/dev_test_game_spine_manifest_admin_proof.mjs",
  ]);
  if (manifest.commands?.proofFreshness?.script !== proofFreshnessAdminProofCommand) {
    throw new Error(
      `spine manifest proof freshness command drifted: ${manifest.commands?.proofFreshness?.script}`,
    );
  }
  if (manifest.commands.proofFreshness.proofArtifact !== proofFreshnessAdminProofPath) {
    throw new Error(
      `spine manifest proof freshness artifact drifted: ${manifest.commands.proofFreshness.proofArtifact}`,
    );
  }
  for (const path of [
    spineManifestPath,
    spineManifestMarkdownPath,
    "target/dev-test-game/admin-spine-proof.json",
    proofFreshnessAdminProofPath,
    "target/dev-test-game/core-loop-admin-proof.json",
    "target/dev-test-game/hardening-admin-proof.json",
    "target/dev-test-game/identity-admin-proof.json",
    "target/dev-test-game/release-admin-proof.json",
    "target/dev-test-game/spine-manifest-admin-proof.json",
    "target/dev-test-game/admin-spine-admin-proof.json",
    "target/live-stack-backup-restore-drill/local-backup-restore-proof.json",
    "target/live-stack-backup-restore-drill/local-live-stack.dump",
  ]) {
    if (!manifest.artifacts?.includes(path)) {
      throw new Error(`spine manifest missing artifact path: ${path}`);
    }
  }
  const checks = new Map((manifest.checks ?? []).map((check) => [check.id, check.status]));
  for (const id of [
    "live-spine-order-recorded",
    "sub-spine-orders-recorded",
    "evidence-env-wiring-recorded",
    "freshness-proof-recorded",
    "release-boundary-carried",
  ]) {
    if (checks.get(id) !== "passed") {
      throw new Error(`spine manifest missing passed check: ${id}`);
    }
  }
  return manifest;
}

export async function writeDevTestGameSpineManifest({
  generatedAt = new Date().toISOString(),
} = {}) {
  const manifest = buildDevTestGameSpineManifest({ generatedAt });
  await mkdir(path.dirname(manifestJsonPath), { recursive: true });
  await writeFile(manifestJsonPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(manifestMarkdownPath, markdownSpineManifest(manifest));
  return manifest;
}

function assertPlanScripts(plan, expectedScripts) {
  const actual = plan.map((step) => step.script);
  if (JSON.stringify(actual) !== JSON.stringify(expectedScripts)) {
    throw new Error(
      `spine manifest plan drifted: expected ${expectedScripts.join(", ")}, got ${actual.join(", ")}`,
    );
  }
}

function clonePlan(plan) {
  return plan.map((step) => ({
    ...step,
    ...(step.env === undefined ? {} : { env: { ...step.env } }),
  }));
}

function cloneAdminProofPlan(plan) {
  return plan.map(({ id, label, script, path }) => ({ id, label, script, path }));
}

function envValues(env) {
  return Object.values(env ?? {}).filter((value) => typeof value === "string");
}

function uniqueSorted(values) {
  return Array.from(new Set(values)).sort();
}

function markdownSpineManifest(manifest) {
  const lines = [
    "# fmarch Dev Test Game Spine Manifest",
    "",
    `- status: ${manifest.status}`,
    `- releaseReady: ${manifest.releaseReady}`,
    `- productionReady: ${manifest.productionReady}`,
    `- generatedAt: ${manifest.generatedAt}`,
    "",
    manifest.proofBoundary,
    "",
    "## Commands",
    "",
    "| Command | Steps |",
    "| --- | ---: |",
  ];
  for (const [id, command] of Object.entries(manifest.commands)) {
    lines.push(`| ${id} | ${command.plan?.length ?? 1} |`);
  }
  lines.push("", "## Live Spine", "", "| Step | Kind | Script |", "| ---: | --- | --- |");
  manifest.commands.live.plan.forEach((step, index) => {
    lines.push(`| ${index + 1} | ${step.kind} | ${step.script} |`);
  });
  lines.push("", "## Artifacts", "");
  for (const artifact of manifest.artifacts) {
    lines.push(`- ${artifact}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  const manifest = await writeDevTestGameSpineManifest();
  console.log(`wrote ${spineManifestPath} (${manifest.status})`);
  console.log(`wrote ${spineManifestMarkdownPath} (${manifest.status})`);
}
