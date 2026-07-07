import { pathToFileURL } from "node:url";
import {
  devTestGameHostedIdentityEvidencePath,
  devTestGameHostedIdentityOperatorAdminProofPath,
  devTestGameHostedIdentityProgressionSummaryPath,
} from "./dev_test_game_hosted_identity_evidence.mjs";
import {
  devTestGameIdentityAdminProofPath,
  devTestGameSeedAdminProofPath,
} from "./dev_test_game_local_admin_proof_paths.mjs";
import {
  devTestGameIdentityAdapterProofPath,
  devTestGameOpsArtifactsPath,
  devTestGameSeedFixturePath,
} from "./dev_test_game_adjacent_artifact_paths.mjs";
import { releaseReadinessStep } from "./dev_test_game_spine_readiness_steps.mjs";
import { runSpinePlan } from "./dev_test_game_spine_runner.mjs";
import {
  devTestGameProofGraphPath,
} from "./dev_test_game_proof_graph_paths.mjs";
import {
  devTestGameHostedIdentityProgressionAdminProofBatchScript,
  hostedIdentityProgressionAdminProofBatchArtifactPaths,
} from "./dev_test_game_hosted_identity_progression_admin_proof_batch.mjs";

export const identityReadinessEnv = {
  FMARCH_DEV_TEST_GAME_OPS_ARTIFACTS: devTestGameOpsArtifactsPath,
  FMARCH_DEV_TEST_GAME_SEED_FIXTURE_SUMMARY: devTestGameSeedFixturePath,
  FMARCH_DEV_TEST_GAME_SEED_ADMIN_PROOF: devTestGameSeedAdminProofPath,
  FMARCH_DEV_TEST_GAME_IDENTITY_ADAPTER_PROOF:
    devTestGameIdentityAdapterProofPath,
  FMARCH_DEV_TEST_GAME_IDENTITY_ADMIN_PROOF:
    devTestGameIdentityAdminProofPath,
  FMARCH_DEV_TEST_GAME_HOSTED_IDENTITY_EVIDENCE:
    devTestGameHostedIdentityEvidencePath,
  FMARCH_DEV_TEST_GAME_HOSTED_IDENTITY_PROGRESSION_SUMMARY:
    devTestGameHostedIdentityProgressionSummaryPath,
};

export const identityOperatorReadinessEnv = {
  ...identityReadinessEnv,
  FMARCH_DEV_TEST_GAME_HOSTED_IDENTITY_EVIDENCE_ADMIN_PROOF:
    devTestGameHostedIdentityOperatorAdminProofPath,
};

export const hostedIdentityOperatorProofGraphDependencyPrecondition =
  Object.freeze({
    kind: "hosted-identity-proof-graph-dependency",
    path: devTestGameProofGraphPath,
    id: "hosted-identity-proof-graph-dependency",
    label: "Hosted identity proof graph dependency",
  });

const devTestGameIdentityBaseSpineSteps = [
  { kind: "node", script: "tools/auth_invite_role_proof.mjs" },
  { kind: "node", script: "tools/dev_test_game_identity_admin_proof.mjs" },
  { kind: "node", script: "tools/dev_test_game_hosted_identity_evidence.mjs" },
  {
    kind: "node",
    script: "tools/dev_test_game_hosted_identity_progression_summary.mjs",
  },
  {
    kind: "node",
    script: devTestGameHostedIdentityProgressionAdminProofBatchScript,
  },
];

export const devTestGameIdentitySpinePlan = [
  ...devTestGameIdentityBaseSpineSteps,
  releaseReadinessStep({
    reason: "identity-adapter-and-hosted-evidence",
    changedInputs: [
      devTestGameIdentityAdapterProofPath,
      devTestGameIdentityAdminProofPath,
      devTestGameHostedIdentityEvidencePath,
      devTestGameHostedIdentityProgressionSummaryPath,
      ...hostedIdentityProgressionAdminProofBatchArtifactPaths,
    ],
    env: identityReadinessEnv,
  }),
];

export const devTestGameIdentityOperatorSpinePlan = [
  ...devTestGameIdentityBaseSpineSteps,
  releaseReadinessStep({
    reason: "identity-adapter-and-hosted-evidence",
    changedInputs: [
      devTestGameIdentityAdapterProofPath,
      devTestGameIdentityAdminProofPath,
      devTestGameHostedIdentityEvidencePath,
      devTestGameHostedIdentityProgressionSummaryPath,
      ...hostedIdentityProgressionAdminProofBatchArtifactPaths,
    ],
    env: identityReadinessEnv,
  }),
  {
    kind: "node",
    script: "tools/dev_test_game_hosted_identity_operator_admin_proof.mjs",
    preconditions: [hostedIdentityOperatorProofGraphDependencyPrecondition],
  },
  releaseReadinessStep({
    reason: "identity-operator-hosted-evidence-predicate",
    changedInputs: [devTestGameHostedIdentityOperatorAdminProofPath],
    env: identityOperatorReadinessEnv,
  }),
];

export function devTestGameIdentitySpinePlanForArgs(
  args = process.argv.slice(2),
) {
  return args.includes("--operator")
    ? devTestGameIdentityOperatorSpinePlan
    : devTestGameIdentitySpinePlan;
}

export async function runDevTestGameIdentitySpine() {
  await runSpinePlan(devTestGameIdentitySpinePlanForArgs());
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  await runDevTestGameIdentitySpine();
}
