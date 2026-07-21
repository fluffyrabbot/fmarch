export const devTestGameReleaseReadinessScript =
  "tools/dev_test_game_release_readiness.mjs";
export {
  devTestGameReleaseReadinessMarkdownPath,
  devTestGameReleaseReadinessPath,
} from "./dev_test_game_spine_artifact_paths.mjs";
import { readinessArtifactPaths } from "./dev_test_game_spine_artifact_dependencies.mjs";

export function releaseReadinessStep({
  reason,
  changedArtifactIds,
  changedInputs,
  additionalChangedInputs = [],
  env,
} = {}) {
  if (typeof reason !== "string" || reason.trim() === "") {
    throw new Error("release-readiness spine step is missing a reason");
  }
  if (changedArtifactIds !== undefined && changedInputs !== undefined) {
    throw new Error(
      "release-readiness spine step cannot declare both artifact ids and input paths",
    );
  }
  const resolvedChangedInputs =
    changedArtifactIds === undefined
      ? changedInputs
      : [...readinessArtifactPaths(changedArtifactIds), ...additionalChangedInputs];
  if (
    !Array.isArray(resolvedChangedInputs) ||
    resolvedChangedInputs.length === 0 ||
    resolvedChangedInputs.some(
      (input) => typeof input !== "string" || input.trim() === "",
    )
  ) {
    throw new Error("release-readiness spine step is missing changed inputs");
  }
  return {
    kind: "node",
    script: devTestGameReleaseReadinessScript,
    ...(env === undefined ? {} : { env }),
    readinessReason: reason,
    changedInputs: [...resolvedChangedInputs],
  };
}

export function releaseReadinessSteps(plan) {
  return plan.filter((step) => step.script === devTestGameReleaseReadinessScript);
}
