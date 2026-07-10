import {
  devTestGameBackupRestoreDumpPath,
  devTestGameBackupRestoreProofPath,
  devTestGameOpsArtifactsPath,
} from "./dev_test_game_adjacent_artifact_paths.mjs";
import {
  devTestGameCoreLoopAdminProofPath,
  devTestGameHardeningAdminProofPath,
  devTestGameOpsAdminProofPath,
} from "./dev_test_game_local_admin_proof_paths.mjs";
import {
  devTestGameProofRunPath,
  devTestGameReleaseReadinessPath,
  devTestGameSessionPath,
} from "./dev_test_game_spine_artifact_paths.mjs";

const artifactContracts = Object.freeze([
  artifactContract({
    id: "backup-restore",
    script: "tools/live_stack_backup_restore_drill.mjs",
    outputs: [devTestGameBackupRestoreProofPath, devTestGameBackupRestoreDumpPath],
  }),
  artifactContract({
    id: "ops-artifacts",
    script: "tools/dev_test_game_ops_artifacts.mjs",
    inputs: [
      devTestGameSessionPath,
      devTestGameProofRunPath,
      devTestGameCoreLoopAdminProofPath,
      devTestGameHardeningAdminProofPath,
    ],
    envInputs: {
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
    inputs: [devTestGameOpsArtifactsPath],
    outputs: [devTestGameOpsAdminProofPath],
  }),
  artifactContract({
    id: "release-readiness",
    script: "tools/dev_test_game_release_readiness.mjs",
    inputs: [
      devTestGameProofRunPath,
      devTestGameCoreLoopAdminProofPath,
      devTestGameHardeningAdminProofPath,
    ],
    envInputs: {
      FMARCH_DEV_TEST_GAME_OPS_ARTIFACTS: devTestGameOpsArtifactsPath,
      FMARCH_DEV_TEST_GAME_OPS_ADMIN_PROOF: devTestGameOpsAdminProofPath,
      FMARCH_DEV_TEST_GAME_BACKUP_RESTORE_PROOF:
        devTestGameBackupRestoreProofPath,
      FMARCH_DEV_TEST_GAME_BACKUP_RESTORE_DUMP:
        devTestGameBackupRestoreDumpPath,
    },
    outputs: [devTestGameReleaseReadinessPath],
  }),
]);

export const devTestGameOpsArtifactDependencyGraph = Object.freeze(
  artifactContracts.map((contract) =>
    Object.freeze({
      id: contract.id,
      inputs: Object.freeze([
        ...contract.inputs,
        ...Object.values(contract.envInputs),
      ]),
      outputs: contract.outputs,
    }),
  ),
);

export function assertDevTestGameOpsArtifactDependencyGraph() {
  const producerByOutput = new Map();
  for (const contract of artifactContracts) {
    for (const output of contract.outputs) {
      if (producerByOutput.has(output)) {
        throw new Error(`ops artifact output has multiple producers: ${output}`);
      }
      producerByOutput.set(output, contract.id);
    }
  }
  const dependenciesById = new Map(
    artifactContracts.map((contract) => [
      contract.id,
      new Set(
        [...contract.inputs, ...Object.values(contract.envInputs)]
          .map((input) => producerByOutput.get(input))
          .filter((id) => id !== undefined),
      ),
    ]),
  );
  const visiting = new Set();
  const visited = new Set();
  function visit(id, path = []) {
    if (visiting.has(id)) {
      throw new Error(`ops artifact dependency cycle: ${[...path, id].join(" -> ")}`);
    }
    if (visited.has(id)) {
      return;
    }
    visiting.add(id);
    for (const dependency of dependenciesById.get(id) ?? []) {
      visit(dependency, [...path, id]);
    }
    visiting.delete(id);
    visited.add(id);
  }
  for (const contract of artifactContracts) {
    visit(contract.id);
  }
  return devTestGameOpsArtifactDependencyGraph;
}

export function assertOpsArtifactPlanOrder(plan) {
  assertDevTestGameOpsArtifactDependencyGraph();
  const contractByScript = new Map(
    artifactContracts.map((contract) => [contract.script, contract]),
  );
  const producerIndexesByOutput = new Map();
  plan.forEach((step, index) => {
    const contract = contractByScript.get(step.script);
    for (const output of contract?.outputs ?? []) {
      const indexes = producerIndexesByOutput.get(output) ?? [];
      indexes.push(index);
      producerIndexesByOutput.set(output, indexes);
    }
  });
  plan.forEach((step, index) => {
    const contract = contractByScript.get(step.script);
    if (contract === undefined) {
      return;
    }
    const declaredInputs = [
      ...contract.inputs,
      ...Object.entries(contract.envInputs)
        .filter(([env]) => step.env?.[env] !== undefined)
        .map(([, input]) => input),
    ];
    for (const input of declaredInputs) {
      const producerIndexes = producerIndexesByOutput.get(input) ?? [];
      if (
        producerIndexes.length > 0 &&
        producerIndexes.every((producerIndex) => producerIndex >= index)
      ) {
        throw new Error(
          `ops artifact plan consumes ${input} before its producer at step ${index}`,
        );
      }
    }
  });
  return plan;
}

function artifactContract({ id, script, inputs = [], envInputs = {}, outputs }) {
  return Object.freeze({
    id,
    script,
    inputs: Object.freeze([...inputs]),
    envInputs: Object.freeze({ ...envInputs }),
    outputs: Object.freeze([...outputs]),
  });
}
