import { pathToFileURL } from "node:url";
import { devTestGameOpsSpinePlan } from "./dev_test_game_ops_spine.mjs";
import { readinessEvidenceEnv } from "./dev_test_game_ops_artifact_dependencies.mjs";
import { releaseReadinessStep } from "./dev_test_game_spine_readiness_steps.mjs";
import { devTestGameSeedFixtureSpinePlan } from "./dev_test_game_seed_fixture_spine.mjs";
import { runSpinePlan } from "./dev_test_game_spine_runner.mjs";
import {
  devTestGameProofGraphPath,
} from "./dev_test_game_proof_graph_paths.mjs";
import {
  devTestGameHostedIdentityProgressionAdminProofBatchScript,
  hostedIdentityProgressionAdminProofBatchArtifactPaths,
} from "./dev_test_game_hosted_identity_progression_admin_proof_batch.mjs";

const identityReadinessArtifactIds = [
  "opsArtifacts",
  "seedFixture",
  "seedAdminProof",
  "identityAdapterProof",
  "identityAdminProof",
  "hostedIdentityEvidence",
  "hostedIdentityProgressionSummary",
];

export const identityReadinessEnv = readinessEvidenceEnv(
  identityReadinessArtifactIds,
);

const identityOperatorReadinessArtifactIds = [
  ...identityReadinessArtifactIds,
  "hostedIdentityOperatorAdminProof",
];

export const identityOperatorReadinessEnv = readinessEvidenceEnv(
  identityOperatorReadinessArtifactIds,
);

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
    changedArtifactIds: identityReadinessArtifactIds.slice(3),
    additionalChangedInputs: hostedIdentityProgressionAdminProofBatchArtifactPaths,
    env: identityReadinessEnv,
  }),
];

export const devTestGameIdentityOperatorSpinePlan = [
  ...devTestGameIdentityBaseSpineSteps,
  releaseReadinessStep({
    reason: "identity-adapter-and-hosted-evidence",
    changedArtifactIds: identityReadinessArtifactIds.slice(3),
    additionalChangedInputs: hostedIdentityProgressionAdminProofBatchArtifactPaths,
    env: identityReadinessEnv,
  }),
  {
    kind: "node",
    script: "tools/dev_test_game_hosted_identity_operator_admin_proof.mjs",
    preconditions: [hostedIdentityOperatorProofGraphDependencyPrecondition],
  },
  releaseReadinessStep({
    reason: "identity-operator-hosted-evidence-predicate",
    changedArtifactIds: ["hostedIdentityOperatorAdminProof"],
    env: identityOperatorReadinessEnv,
  }),
];

const devTestGameIdentityStandalonePrerequisitePlan = [
  ...devTestGameOpsSpinePlan,
  ...devTestGameSeedFixtureSpinePlan,
];

export const devTestGameIdentityStandaloneSpinePlan = [
  ...devTestGameIdentityStandalonePrerequisitePlan,
  ...devTestGameIdentitySpinePlan,
];

export const devTestGameIdentityOperatorStandaloneSpinePlan = [
  ...devTestGameIdentityStandalonePrerequisitePlan,
  ...devTestGameIdentityOperatorSpinePlan,
];

export function devTestGameIdentitySpinePlanForArgs(
  args = process.argv.slice(2),
  { standalone = false } = {},
) {
  const identityPlan = args.includes("--operator")
    ? devTestGameIdentityOperatorSpinePlan
    : devTestGameIdentitySpinePlan;
  return standalone
    ? [...devTestGameIdentityStandalonePrerequisitePlan, ...identityPlan]
    : identityPlan;
}

export async function runDevTestGameIdentitySpine({ standalone = false } = {}) {
  await runSpinePlan(devTestGameIdentitySpinePlanForArgs(undefined, { standalone }));
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  await runDevTestGameIdentitySpine({ standalone: true });
}
