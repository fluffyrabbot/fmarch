import {
  devTestGameBackupRestoreDumpPath,
  devTestGameBackupRestoreProofPath,
  devTestGameIdentityAdapterProofPath,
  devTestGameOpsArtifactsPath,
  devTestGameSeedFixturePath,
} from "./dev_test_game_adjacent_artifact_paths.mjs";
import {
  devTestGameBackupAdminProofPath,
  devTestGameCoreLoopAdminProofPath,
  devTestGameHardeningAdminProofPath,
  devTestGameIdentityAdminProofPath,
  devTestGameOpsAdminProofPath,
  devTestGameSeedAdminProofPath,
} from "./dev_test_game_local_admin_proof_paths.mjs";
import {
  devTestGameProofGraphAdminProofPath,
  devTestGameProofGraphPath,
} from "./dev_test_game_proof_graph_paths.mjs";
import {
  nextActionAdminProofPath,
  nextActionPath,
  proofFreshnessAdminProofPath,
} from "./dev_test_game_next_action_paths.mjs";
import {
  adminSpineProofPath,
  adminSpineTerminalBatchProofPath,
  devTestGameProofRunPath,
  devTestGameReleaseReadinessPath,
  devTestGameSessionPath,
  spineManifestPath,
} from "./dev_test_game_spine_artifact_paths.mjs";
import {
  devTestGameHostedIdentityEvidencePath,
  devTestGameHostedIdentityOperatorAdminProofPath,
  devTestGameHostedIdentityProgressionSummaryPath,
} from "./dev_test_game_hosted_identity_evidence.mjs";
import {
  devTestGameHostedIdentityEvidenceAdminProofPath,
} from "./dev_test_game_hosted_identity_evidence_cases.mjs";

// Upstream evidence is safe to order as a DAG. Presentation snapshots may read
// one another across successive refreshes, so they are recorded separately.
const artifactContracts = Object.freeze([
  artifactContract({
    id: "seeded-session",
    script: "dev:test-game:prebuild",
    outputs: [devTestGameSessionPath],
  }),
  artifactContract({
    id: "live-proof",
    script: "tools/dev_test_game_live_proof.mjs",
    upstreamEvidence: [devTestGameSessionPath],
    outputs: [devTestGameProofRunPath],
  }),
  artifactContract({
    id: "core-loop-admin-proof",
    script: "tools/dev_test_game_core_loop_admin_proof.mjs",
    upstreamEvidence: [devTestGameProofRunPath],
    outputs: [devTestGameCoreLoopAdminProofPath],
  }),
  artifactContract({
    id: "hardening-admin-proof",
    script: "tools/dev_test_game_hardening_admin_proof.mjs",
    upstreamEvidence: [devTestGameProofRunPath],
    outputs: [devTestGameHardeningAdminProofPath],
  }),
  artifactContract({
    id: "backup-restore",
    script: "tools/live_stack_backup_restore_drill.mjs",
    outputs: [devTestGameBackupRestoreProofPath, devTestGameBackupRestoreDumpPath],
  }),
  artifactContract({
    id: "ops-artifacts",
    script: "tools/dev_test_game_ops_artifacts.mjs",
    upstreamEvidence: [
      devTestGameSessionPath,
      devTestGameProofRunPath,
      devTestGameCoreLoopAdminProofPath,
      devTestGameHardeningAdminProofPath,
    ],
    envEvidence: {
      FMARCH_DEV_TEST_GAME_OPS_BACKUP_RESTORE_PROOF:
        devTestGameBackupRestoreProofPath,
      FMARCH_DEV_TEST_GAME_OPS_BACKUP_RESTORE_DUMP:
        devTestGameBackupRestoreDumpPath,
    },
    outputs: [devTestGameOpsArtifactsPath],
  }),
  artifactContract({
    id: "ops-admin-proof",
    script: "tools/dev_test_game_ops_admin_proof.mjs",
    upstreamEvidence: [devTestGameOpsArtifactsPath],
    outputs: [devTestGameOpsAdminProofPath],
  }),
  artifactContract({
    id: "seed-fixture-summary",
    script: "tools/dev_test_game_seed_fixture_summary.mjs",
    outputs: [devTestGameSeedFixturePath],
  }),
  artifactContract({
    id: "seed-admin-proof",
    script: "tools/dev_test_game_seed_admin_proof.mjs",
    upstreamEvidence: [devTestGameSeedFixturePath],
    outputs: [devTestGameSeedAdminProofPath],
  }),
  artifactContract({
    id: "identity-adapter-proof",
    script: "tools/auth_invite_role_proof.mjs",
    outputs: [devTestGameIdentityAdapterProofPath],
  }),
  artifactContract({
    id: "identity-admin-proof",
    script: "tools/dev_test_game_identity_admin_proof.mjs",
    upstreamEvidence: [devTestGameIdentityAdapterProofPath],
    outputs: [devTestGameIdentityAdminProofPath],
  }),
  artifactContract({
    id: "release-readiness",
    script: "tools/dev_test_game_release_readiness.mjs",
    upstreamEvidence: [
      devTestGameProofRunPath,
      devTestGameCoreLoopAdminProofPath,
      devTestGameHardeningAdminProofPath,
    ],
    envEvidence: {
      FMARCH_DEV_TEST_GAME_BACKUP_RESTORE_PROOF: devTestGameBackupRestoreProofPath,
      FMARCH_DEV_TEST_GAME_BACKUP_RESTORE_DUMP: devTestGameBackupRestoreDumpPath,
      FMARCH_DEV_TEST_GAME_BACKUP_ADMIN_PROOF: devTestGameBackupAdminProofPath,
      FMARCH_DEV_TEST_GAME_OPS_ARTIFACTS: devTestGameOpsArtifactsPath,
      FMARCH_DEV_TEST_GAME_OPS_ADMIN_PROOF: devTestGameOpsAdminProofPath,
      FMARCH_DEV_TEST_GAME_SEED_FIXTURE_SUMMARY: devTestGameSeedFixturePath,
      FMARCH_DEV_TEST_GAME_SEED_ADMIN_PROOF: devTestGameSeedAdminProofPath,
      FMARCH_DEV_TEST_GAME_IDENTITY_ADAPTER_PROOF: devTestGameIdentityAdapterProofPath,
      FMARCH_DEV_TEST_GAME_IDENTITY_ADMIN_PROOF: devTestGameIdentityAdminProofPath,
    },
    presentationInputs: [
      spineManifestPath,
      devTestGameProofGraphAdminProofPath,
      proofFreshnessAdminProofPath,
      nextActionAdminProofPath,
      adminSpineProofPath,
      adminSpineTerminalBatchProofPath,
    ],
    outputs: [devTestGameReleaseReadinessPath],
  }),
  artifactContract({
    id: "spine-manifest",
    script: "tools/dev_test_game_spine_manifest.mjs",
    outputs: [spineManifestPath],
  }),
  artifactContract({
    id: "next-action",
    script: "tools/dev_test_game_next_action.mjs",
    upstreamEvidence: [
      spineManifestPath,
      devTestGameReleaseReadinessPath,
      devTestGameOpsArtifactsPath,
    ],
    presentationInputs: [devTestGameProofGraphPath],
    outputs: [nextActionPath],
  }),
  artifactContract({
    id: "proof-graph",
    script: "tools/dev_test_game_proof_graph.mjs",
    upstreamEvidence: [
      spineManifestPath,
      adminSpineProofPath,
      nextActionPath,
      devTestGameReleaseReadinessPath,
    ],
    outputs: [devTestGameProofGraphPath],
  }),
  artifactContract({
    id: "proof-graph-admin-proof",
    script: "tools/dev_test_game_proof_graph_admin_proof.mjs",
    upstreamEvidence: [devTestGameProofGraphPath],
    outputs: [devTestGameProofGraphAdminProofPath],
  }),
  artifactContract({
    id: "proof-freshness-admin-proof",
    script: "tools/dev_test_game_proof_freshness_admin_proof.mjs",
    upstreamEvidence: [spineManifestPath, devTestGameReleaseReadinessPath],
    outputs: [proofFreshnessAdminProofPath],
  }),
  artifactContract({
    id: "next-action-admin-proof",
    script: "tools/dev_test_game_next_action_admin_proof.mjs",
    upstreamEvidence: [nextActionPath],
    outputs: [nextActionAdminProofPath],
  }),
  artifactContract({
    id: "admin-spine-proof",
    script: "admin-spine-proof",
    outputs: [adminSpineProofPath],
  }),
  artifactContract({
    id: "admin-spine-terminal-batches",
    script: "admin-spine-terminal-validation-receipt",
    outputs: [adminSpineTerminalBatchProofPath],
  }),
]);

export const devTestGameSpineArtifactDependencyGraph = Object.freeze(
  artifactContracts.map((contract) =>
    Object.freeze({
      id: contract.id,
      inputs: Object.freeze([
        ...contract.upstreamEvidence,
        ...Object.values(contract.envEvidence),
      ]),
      upstreamEvidence: contract.upstreamEvidence,
      envEvidence: contract.envEvidence,
      presentationInputs: contract.presentationInputs,
      outputs: contract.outputs,
    }),
  ),
);

const readinessArtifactRegistry = Object.freeze([
  readinessArtifact({
    id: "coreLoopAdminProof",
    path: devTestGameCoreLoopAdminProofPath,
    envVar: "FMARCH_DEV_TEST_GAME_CORE_LOOP_ADMIN_PROOF",
  }),
  readinessArtifact({
    id: "hardeningAdminProof",
    path: devTestGameHardeningAdminProofPath,
    envVar: "FMARCH_DEV_TEST_GAME_HARDENING_ADMIN_PROOF",
  }),
  readinessArtifact({
    id: "backupRestoreProof",
    path: devTestGameBackupRestoreProofPath,
    envVar: "FMARCH_DEV_TEST_GAME_BACKUP_RESTORE_PROOF",
  }),
  readinessArtifact({
    id: "backupRestoreDump",
    path: devTestGameBackupRestoreDumpPath,
    envVar: "FMARCH_DEV_TEST_GAME_BACKUP_RESTORE_DUMP",
  }),
  readinessArtifact({
    id: "backupAdminProof",
    path: devTestGameBackupAdminProofPath,
    envVar: "FMARCH_DEV_TEST_GAME_BACKUP_ADMIN_PROOF",
  }),
  readinessArtifact({
    id: "opsArtifacts",
    path: devTestGameOpsArtifactsPath,
    envVar: "FMARCH_DEV_TEST_GAME_OPS_ARTIFACTS",
  }),
  readinessArtifact({
    id: "opsAdminProof",
    path: devTestGameOpsAdminProofPath,
    envVar: "FMARCH_DEV_TEST_GAME_OPS_ADMIN_PROOF",
  }),
  readinessArtifact({
    id: "seedFixture",
    path: devTestGameSeedFixturePath,
    envVar: "FMARCH_DEV_TEST_GAME_SEED_FIXTURE_SUMMARY",
  }),
  readinessArtifact({
    id: "seedAdminProof",
    path: devTestGameSeedAdminProofPath,
    envVar: "FMARCH_DEV_TEST_GAME_SEED_ADMIN_PROOF",
  }),
  readinessArtifact({
    id: "identityAdapterProof",
    path: devTestGameIdentityAdapterProofPath,
    envVar: "FMARCH_DEV_TEST_GAME_IDENTITY_ADAPTER_PROOF",
  }),
  readinessArtifact({
    id: "identityAdminProof",
    path: devTestGameIdentityAdminProofPath,
    envVar: "FMARCH_DEV_TEST_GAME_IDENTITY_ADMIN_PROOF",
  }),
  readinessArtifact({
    id: "hostedIdentityEvidence",
    path: devTestGameHostedIdentityEvidencePath,
    envVar: "FMARCH_DEV_TEST_GAME_HOSTED_IDENTITY_EVIDENCE",
  }),
  readinessArtifact({
    id: "hostedIdentityProgressionSummary",
    path: devTestGameHostedIdentityProgressionSummaryPath,
    envVar: "FMARCH_DEV_TEST_GAME_HOSTED_IDENTITY_PROGRESSION_SUMMARY",
  }),
  readinessArtifact({
    id: "hostedIdentityEvidenceAdminProof",
    path: devTestGameHostedIdentityEvidenceAdminProofPath,
    envVar: "FMARCH_DEV_TEST_GAME_HOSTED_IDENTITY_EVIDENCE_ADMIN_PROOF",
  }),
  readinessArtifact({
    id: "hostedIdentityOperatorAdminProof",
    path: devTestGameHostedIdentityOperatorAdminProofPath,
    envVar: "FMARCH_DEV_TEST_GAME_HOSTED_IDENTITY_EVIDENCE_ADMIN_PROOF",
  }),
]);

const readinessArtifactById = new Map(
  readinessArtifactRegistry.map((artifact) => [artifact.id, artifact]),
);

export function readinessArtifactPaths(ids) {
  return ids.map((id) => readinessArtifactForId(id).path);
}

export function readinessEvidenceEnv(ids) {
  return Object.fromEntries(
    ids.map((id) => {
      const artifact = readinessArtifactForId(id);
      return [artifact.envVar, artifact.path];
    }),
  );
}

export function assertDevTestGameSpineArtifactDependencyGraph() {
  const producerByOutput = new Map();
  for (const contract of artifactContracts) {
    for (const output of contract.outputs) {
      if (producerByOutput.has(output)) {
        throw new Error(`spine artifact output has multiple producers: ${output}`);
      }
      producerByOutput.set(output, contract.id);
    }
  }
  const dependenciesById = new Map(
    artifactContracts.map((contract) => [
      contract.id,
      new Set(
        [...contract.upstreamEvidence, ...Object.values(contract.envEvidence)]
          .map((input) => producerByOutput.get(input))
          .filter((id) => id !== undefined),
      ),
    ]),
  );
  const visiting = new Set();
  const visited = new Set();
  function visit(id, path = []) {
    if (visiting.has(id)) {
      throw new Error(`spine upstream artifact dependency cycle: ${[...path, id].join(" -> ")}`);
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of dependenciesById.get(id) ?? []) {
      visit(dependency, [...path, id]);
    }
    visiting.delete(id);
    visited.add(id);
  }
  for (const contract of artifactContracts) visit(contract.id);
  return devTestGameSpineArtifactDependencyGraph;
}

export function assertSpineArtifactPlanOrder(plan, { customPlans = {} } = {}) {
  assertDevTestGameSpineArtifactDependencyGraph();
  const steps = flattenPlan(plan, customPlans);
  const contractByScript = new Map(
    artifactContracts.map((contract) => [contract.script, contract]),
  );
  const producerIndexesByOutput = new Map();
  steps.forEach((step, index) => {
    for (const output of contractByScript.get(step.script)?.outputs ?? []) {
      const indexes = producerIndexesByOutput.get(output) ?? [];
      indexes.push(index);
      producerIndexesByOutput.set(output, indexes);
    }
  });
  steps.forEach((step, index) => {
    const contract = contractByScript.get(step.script);
    if (contract === undefined) return;
    for (const input of inputsForStep(contract, step)) {
      const producerIndexes = producerIndexesByOutput.get(input) ?? [];
      if (producerIndexes.length > 0 && producerIndexes.every((producer) => producer >= index)) {
        throw new Error(
          `spine artifact plan consumes ${input} before its producer at step ${index}`,
        );
      }
    }
  });
  return plan;
}

export function assertDevTestGameFullLiveArtifactPlanOrder({
  livePlan,
  backupRestorePlan,
  identityPlan,
  adminPlan,
}) {
  return assertSpineArtifactPlanOrder(livePlan, {
    customPlans: {
      "backup-restore": backupRestorePlan,
      identity: identityPlan,
      admin: adminPlan,
    },
  });
}

function flattenPlan(plan, customPlans, seenCustom = new Set()) {
  return plan.flatMap((step) => {
    const nestedPlan = step.kind === "custom" ? customPlans[step.script] : undefined;
    if (nestedPlan === undefined) return [step];
    if (seenCustom.has(step.script)) {
      throw new Error(`spine custom plan cycle: ${[...seenCustom, step.script].join(" -> ")}`);
    }
    return flattenPlan(nestedPlan, customPlans, new Set([...seenCustom, step.script]));
  });
}

function artifactContract({
  id,
  script,
  upstreamEvidence = [],
  envEvidence = {},
  presentationInputs = [],
  outputs,
}) {
  return Object.freeze({
    id,
    script,
    upstreamEvidence: Object.freeze([...upstreamEvidence]),
    envEvidence: Object.freeze({ ...envEvidence }),
    presentationInputs: Object.freeze([...presentationInputs]),
    outputs: Object.freeze([...outputs]),
  });
}

function inputsForStep(contract, step) {
  return [
    ...contract.upstreamEvidence,
    ...Object.entries(contract.envEvidence)
      .filter(([env]) => step.env?.[env] !== undefined)
      .map(([, artifact]) => artifact),
  ];
}

function readinessArtifactForId(id) {
  const artifact = readinessArtifactById.get(id);
  if (artifact === undefined) {
    throw new Error(`unknown release-readiness artifact id: ${id}`);
  }
  return artifact;
}

function readinessArtifact({ id, path, envVar }) {
  return Object.freeze({ id, path, envVar });
}
