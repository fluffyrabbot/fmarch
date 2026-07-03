import { pathToFileURL } from "node:url";
import { devTestGameRaceCoveragePath } from "./dev_test_game_race_coverage.mjs";
import { devTestGameHostedConcurrentRaceMatrixPath } from "./dev_test_game_hosted_concurrent_race_matrix.mjs";
import { devTestGameHostedEvidenceLanePath } from "./dev_test_game_hosted_evidence_lane.mjs";
import {
  devTestGameHostedIdentityEvidencePath,
} from "./dev_test_game_hosted_identity_evidence.mjs";
import { devTestGameHostedTargetPreflightPath } from "./dev_test_game_hosted_target_preflight.mjs";
import { runAdminSpineProof } from "./dev_test_game_admin_spine_proof.mjs";
import {
  devTestGameProofGraphAdminProofPath,
  devTestGameProofGraphPath,
} from "./dev_test_game_proof_graph_paths.mjs";
import {
  devTestGameRealHostedObservabilityHandoffPath,
} from "./dev_test_game_real_hosted_observability_handoff_cases.mjs";
import {
  nextActionAdminProofPath,
  proofFreshnessAdminProofPath,
} from "./dev_test_game_next_action_paths.mjs";
import { runNodeScript } from "./dev_test_game_spine_runner.mjs";

export const adminSpineProofPath = "target/dev-test-game/admin-spine-proof.json";

export const adminSpineReadinessEvidenceEnv = {
  FMARCH_DEV_TEST_GAME_CORE_LOOP_ADMIN_PROOF:
    "target/dev-test-game/core-loop-admin-proof.json",
  FMARCH_DEV_TEST_GAME_HARDENING_ADMIN_PROOF:
    "target/dev-test-game/hardening-admin-proof.json",
  FMARCH_DEV_TEST_GAME_BACKUP_RESTORE_PROOF:
    "target/live-stack-backup-restore-drill/local-backup-restore-proof.json",
  FMARCH_DEV_TEST_GAME_BACKUP_RESTORE_DUMP:
    "target/live-stack-backup-restore-drill/local-live-stack.dump",
  FMARCH_DEV_TEST_GAME_BACKUP_ADMIN_PROOF:
    "target/dev-test-game/backup-admin-proof.json",
  FMARCH_DEV_TEST_GAME_OPS_ARTIFACTS: "target/dev-test-game/ops-artifacts.json",
  FMARCH_DEV_TEST_GAME_OPS_ADMIN_PROOF: "target/dev-test-game/ops-admin-proof.json",
  FMARCH_DEV_TEST_GAME_HOSTED_OPS_SIGNALS:
    "target/dev-test-game/hosted-ops-signals.json",
  FMARCH_DEV_TEST_GAME_HOSTED_OPS_SIGNALS_ADMIN_PROOF:
    "target/dev-test-game/hosted-ops-signals-admin-proof.json",
  FMARCH_DEV_TEST_GAME_REAL_HOSTED_OBSERVABILITY_HANDOFF:
    devTestGameRealHostedObservabilityHandoffPath,
  FMARCH_DEV_TEST_GAME_REAL_HOSTED_OBSERVABILITY_HANDOFF_ADMIN_PROOF:
    "target/dev-test-game/real-hosted-observability-handoff-admin-proof.json",
  FMARCH_DEV_TEST_GAME_SEED_FIXTURE_SUMMARY:
    "target/dev-test-game/seed-fixture-summary.json",
  FMARCH_DEV_TEST_GAME_SEED_ADMIN_PROOF: "target/dev-test-game/seed-admin-proof.json",
  FMARCH_DEV_TEST_GAME_RELEASE_RUNBOOK:
    "target/dev-test-game/release-runbook.json",
  FMARCH_DEV_TEST_GAME_RELEASE_RUNBOOK_ADMIN_PROOF:
    "target/dev-test-game/release-runbook-admin-proof.json",
  FMARCH_DEV_TEST_GAME_IDENTITY_ADAPTER_PROOF:
    "target/auth-invite-role-proof/invite-role-proof.json",
  FMARCH_DEV_TEST_GAME_IDENTITY_ADMIN_PROOF:
    "target/dev-test-game/identity-admin-proof.json",
  FMARCH_DEV_TEST_GAME_HOSTED_IDENTITY_EVIDENCE:
    devTestGameHostedIdentityEvidencePath,
  FMARCH_DEV_TEST_GAME_HOSTED_IDENTITY_EVIDENCE_ADMIN_PROOF:
    "target/dev-test-game/hosted-identity-evidence-admin-proof.json",
  FMARCH_DEV_TEST_GAME_SPINE_MANIFEST: "target/dev-test-game/spine-manifest.json",
  FMARCH_DEV_TEST_GAME_SPINE_MANIFEST_ADMIN_PROOF:
    "target/dev-test-game/spine-manifest-admin-proof.json",
  FMARCH_DEV_TEST_GAME_ADMIN_SPINE_PROOF: "target/dev-test-game/admin-spine-proof.json",
  FMARCH_DEV_TEST_GAME_ADMIN_SPINE_ADMIN_PROOF:
    "target/dev-test-game/admin-spine-admin-proof.json",
  FMARCH_DEV_TEST_GAME_RACE_COVERAGE: devTestGameRaceCoveragePath,
  FMARCH_DEV_TEST_GAME_RACE_COVERAGE_ADMIN_PROOF:
    "target/dev-test-game/race-coverage-admin-proof.json",
  FMARCH_DEV_TEST_GAME_HOSTED_CONCURRENT_RACE_MATRIX:
    devTestGameHostedConcurrentRaceMatrixPath,
  FMARCH_DEV_TEST_GAME_HOSTED_CONCURRENT_RACE_MATRIX_ADMIN_PROOF:
    "target/dev-test-game/hosted-concurrent-race-matrix-admin-proof.json",
  FMARCH_DEV_TEST_GAME_HOSTED_TARGET_PREFLIGHT:
    devTestGameHostedTargetPreflightPath,
  FMARCH_DEV_TEST_GAME_HOSTED_TARGET_PREFLIGHT_ADMIN_PROOF:
    "target/dev-test-game/hosted-target-preflight-admin-proof.json",
  FMARCH_DEV_TEST_GAME_HOSTED_EVIDENCE_LANE:
    devTestGameHostedEvidenceLanePath,
  FMARCH_DEV_TEST_GAME_HOSTED_EVIDENCE_LANE_ADMIN_PROOF:
    "target/dev-test-game/hosted-evidence-lane-admin-proof.json",
  FMARCH_DEV_TEST_GAME_PROOF_GRAPH: devTestGameProofGraphPath,
  FMARCH_DEV_TEST_GAME_PROOF_GRAPH_ADMIN_PROOF: devTestGameProofGraphAdminProofPath,
  FMARCH_DEV_TEST_GAME_PROOF_FRESHNESS_ADMIN_PROOF: proofFreshnessAdminProofPath,
  FMARCH_DEV_TEST_GAME_NEXT_ACTION_ADMIN_PROOF: nextActionAdminProofPath,
};

export const adminSpinePreGraphReadinessEvidenceEnv = Object.fromEntries(
  Object.entries(adminSpineReadinessEvidenceEnv).filter(
    ([key]) =>
      ![
        "FMARCH_DEV_TEST_GAME_PROOF_GRAPH",
        "FMARCH_DEV_TEST_GAME_PROOF_GRAPH_ADMIN_PROOF",
        "FMARCH_DEV_TEST_GAME_PROOF_FRESHNESS_ADMIN_PROOF",
        "FMARCH_DEV_TEST_GAME_NEXT_ACTION_ADMIN_PROOF",
      ].includes(key),
  ),
);

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  await runDevTestGameAdminSpine();
}

export async function runDevTestGameAdminSpine() {
  await runNodeScript("tools/dev_test_game_race_coverage.mjs");
  await runNodeScript("tools/dev_test_game_release_readiness.mjs");
  await runNodeScript("tools/dev_test_game_hosted_concurrent_race_matrix.mjs");
  await runNodeScript("tools/dev_test_game_hosted_identity_evidence.mjs");
  await runNodeScript("tools/dev_test_game_hosted_target_preflight.mjs");
  await runNodeScript("tools/dev_test_game_hosted_evidence_lane.mjs");
  await runNodeScript("tools/dev_test_game_hosted_evidence_lane_demo_proof.mjs");
  await runNodeScript("tools/dev_test_game_hosted_ops_signals.mjs");
  await runNodeScript("tools/dev_test_game_real_hosted_observability_handoff.mjs");
  await runNodeScript("tools/dev_test_game_release_runbook.mjs");
  const evidence = await runAdminSpineProof();
  console.log(`wrote ${adminSpineProofPath} (${evidence.status})`);
  await runNodeScript("tools/dev_test_game_admin_spine_admin_proof.mjs");
  await runNodeScript("tools/dev_test_game_release_readiness.mjs", {
    env: adminSpinePreGraphReadinessEvidenceEnv,
  });
  await runNodeScript("tools/dev_test_game_spine_manifest.mjs");
  await runNodeScript("tools/dev_test_game_next_action.mjs");
  await runNodeScript("tools/dev_test_game_proof_graph.mjs");
  await runNodeScript("tools/dev_test_game_proof_graph_admin_proof.mjs");
  await runNodeScript("tools/dev_test_game_proof_freshness_admin_proof.mjs");
  await runNodeScript("tools/dev_test_game_next_action_admin_proof.mjs");
  await runNodeScript("tools/dev_test_game_release_readiness.mjs", {
    env: adminSpineReadinessEvidenceEnv,
  });
  await runNodeScript("tools/dev_test_game_next_action.mjs");
  await runNodeScript("tools/dev_test_game_proof_freshness_admin_proof.mjs");
  await runNodeScript("tools/dev_test_game_next_action_admin_proof.mjs");
  await runNodeScript("tools/dev_test_game_release_readiness.mjs", {
    env: adminSpineReadinessEvidenceEnv,
  });
}
