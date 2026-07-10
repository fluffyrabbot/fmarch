import { pathToFileURL } from "node:url";
import { runDevTestGameAdminSpine } from "./dev_test_game_admin_spine.mjs";
import { runDevTestGameBackupRestoreSpine } from "./dev_test_game_backup_restore_spine.mjs";
import { runDevTestGameIdentitySpine } from "./dev_test_game_identity_spine.mjs";
import {
  devTestGameCoreLoopAdminProofPath,
  devTestGameHardeningAdminProofPath,
} from "./dev_test_game_local_admin_proof_paths.mjs";
import { releaseReadinessStep } from "./dev_test_game_spine_readiness_steps.mjs";
import {
  devTestGameProofRunPath,
} from "./dev_test_game_spine_artifact_paths.mjs";
import {
  devTestGameEarliestReachedProofPath,
} from "./dev_test_game_earliest_reached_proof_contract.mjs";
import {
  devTestGameHostDecidesProofPath,
} from "./dev_test_game_host_decides_proof_contract.mjs";
import {
  devTestGameHostDecidesRaceProofPath,
} from "./dev_test_game_host_decides_race_proof_contract.mjs";
import { runSpinePlan } from "./dev_test_game_spine_runner.mjs";
import {
  devTestGameRaceCoveragePath,
} from "./dev_test_game_race_coverage_contracts.mjs";
import {
  recoveryReceiptProofPlanSteps,
  recoveryReceiptProofTargets,
} from "./dev_test_game_recovery_receipt_catalog.mjs";
import {
  devTestGameHostSetupProofPath,
} from "./dev_test_game_host_setup_feature_spine_targets.mjs";

const coreLoopRecoveryReceiptSelector = {
  provingNodeId: "admin-proof:core-loop",
};
const hardeningRecoveryReceiptSelector = {
  provingNodeId: "admin-proof:hardening",
};

export const devTestGameCoreLiveSpinePlan = [
  { kind: "npm", script: "dev:test-game:prebuild" },
  { kind: "node", script: "tools/dev_test_game_live_proof.mjs" },
  { kind: "node", script: "tools/dev_test_game_earliest_reached_proof_contract.mjs" },
  { kind: "node", script: "tools/dev_test_game_host_decides_proof_contract.mjs" },
  { kind: "node", script: "tools/dev_test_game_proof_contract.mjs" },
  { kind: "node", script: "tools/dev_test_game_core_loop_admin_proof.mjs" },
  ...recoveryReceiptProofPlanSteps(coreLoopRecoveryReceiptSelector),
  { kind: "node", script: "tools/dev_test_game_host_decides_race_proof_contract.mjs" },
  { kind: "node", script: "tools/dev_test_game_hardening_admin_proof.mjs" },
  ...recoveryReceiptProofPlanSteps(hardeningRecoveryReceiptSelector),
  { kind: "node", script: "tools/dev_test_game_race_coverage.mjs" },
  releaseReadinessStep({
    reason: "core-live-gameplay-admin-surfaces",
    changedInputs: [
      devTestGameProofRunPath,
      devTestGameEarliestReachedProofPath,
      devTestGameHostDecidesProofPath,
      devTestGameHostDecidesRaceProofPath,
      devTestGameHostSetupProofPath,
      devTestGameCoreLoopAdminProofPath,
      ...recoveryReceiptProofTargets(coreLoopRecoveryReceiptSelector),
      devTestGameHardeningAdminProofPath,
      ...recoveryReceiptProofTargets(hardeningRecoveryReceiptSelector),
      devTestGameRaceCoveragePath,
    ],
  }),
];

export const devTestGameLiveSpinePlan = [
  ...devTestGameCoreLiveSpinePlan,
  { kind: "node", script: "tools/dev_test_game_seed_fixture_summary.mjs" },
  { kind: "node", script: "tools/dev_test_game_seed_admin_proof.mjs" },
  { kind: "custom", script: "backup-restore", label: "Backup/restore spine" },
  { kind: "custom", script: "identity", label: "Identity spine" },
  { kind: "custom", script: "admin", label: "Admin spine" },
];

export async function runDevTestGameCoreLiveSpine() {
  await runSpinePlan(devTestGameCoreLiveSpinePlan);
}

export async function runDevTestGameLiveSpine() {
  await runSpinePlan(devTestGameLiveSpinePlan, {
    custom: {
      "backup-restore": runDevTestGameBackupRestoreSpine,
      identity: runDevTestGameIdentitySpine,
      admin: runDevTestGameAdminSpine,
    },
  });
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  if (process.argv.includes("--core")) {
    await runDevTestGameCoreLiveSpine();
  } else {
    await runDevTestGameLiveSpine();
  }
}
