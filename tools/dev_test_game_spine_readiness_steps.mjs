export const devTestGameReleaseReadinessScript =
  "tools/dev_test_game_release_readiness.mjs";
export {
  devTestGameReleaseReadinessMarkdownPath,
  devTestGameReleaseReadinessPath,
} from "./dev_test_game_spine_artifact_paths.mjs";

export function releaseReadinessStep({ reason, changedInputs, env } = {}) {
  if (typeof reason !== "string" || reason.trim() === "") {
    throw new Error("release-readiness spine step is missing a reason");
  }
  if (
    !Array.isArray(changedInputs) ||
    changedInputs.length === 0 ||
    changedInputs.some((input) => typeof input !== "string" || input.trim() === "")
  ) {
    throw new Error("release-readiness spine step is missing changed inputs");
  }
  return {
    kind: "node",
    script: devTestGameReleaseReadinessScript,
    ...(env === undefined ? {} : { env }),
    readinessReason: reason,
    changedInputs: [...changedInputs],
  };
}

export function releaseReadinessSteps(plan) {
  return plan.filter((step) => step.script === devTestGameReleaseReadinessScript);
}
