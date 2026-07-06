const roleUrlKeys = Object.freeze(["sourceRoleUrl"]);
const visitedPathKeys = Object.freeze(["visitedRolePath"]);

export function coreLoopCommandProofRoleUrlRows(proof) {
  return collectCommandProofRoleUrlRows({
    value: proof,
    path: [],
    parentRoleUrl: undefined,
    parentVisitedPath: undefined,
  });
}

export function assertCoreLoopCommandProofRoleUrls({
  proof,
  includeEvidenceInError = false,
}) {
  const rows = coreLoopCommandProofRoleUrlRows(proof);
  const missingRows = rows.filter((row) => row.status !== "passed");
  if (missingRows.length > 0) {
    const summary = missingRows.map((row) => row.path).join(", ");
    if (includeEvidenceInError) {
      throw new Error(
        `core-loop command proof role URL audit failed: ${summary}: ${JSON.stringify(
          missingRows,
        )}`,
      );
    }
    throw new Error(`core-loop command proof role URL audit failed: ${summary}`);
  }
  return rows;
}

function collectCommandProofRoleUrlRows({
  value,
  path,
  parentRoleUrl,
  parentVisitedPath,
}) {
  if (value === null || typeof value !== "object") {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((child, index) =>
      collectCommandProofRoleUrlRows({
        value: child,
        path: [...path, String(index)],
        parentRoleUrl,
        parentVisitedPath,
      }),
    );
  }

  const selfRoleUrl = roleUrlKeys
    .map((key) => value[key])
    .find((candidate) => typeof candidate === "string");
  const selfVisitedPath = visitedPathKeys
    .map((key) => value[key])
    .find((candidate) => typeof candidate === "string");
  const inheritedRoleUrl = selfRoleUrl ?? parentRoleUrl;
  const inheritedVisitedPath = selfVisitedPath ?? parentVisitedPath;
  const rows = [];

  if (isPassedCommandProof(value)) {
    rows.push(
      commandProofRoleUrlRow({
        proof: value,
        path: path.join("."),
        parentRoleUrl,
        parentVisitedPath,
      }),
    );
  }

  for (const [key, child] of Object.entries(value)) {
    rows.push(
      ...collectCommandProofRoleUrlRows({
        value: child,
        path: [...path, key],
        parentRoleUrl: inheritedRoleUrl,
        parentVisitedPath: inheritedVisitedPath,
      }),
    );
  }

  return rows;
}

function commandProofRoleUrlRow({
  proof,
  path,
  parentRoleUrl,
  parentVisitedPath,
}) {
  const errors = [];
  if (typeof proof.sourceRoleUrl !== "string" || !proof.sourceRoleUrl.includes("/g/")) {
    errors.push("missing-source-role-url");
  }
  if (
    typeof proof.visitedRolePath !== "string" ||
    !proof.visitedRolePath.includes("/g/")
  ) {
    errors.push("missing-visited-role-path");
  }
  if (
    typeof parentRoleUrl === "string" &&
    typeof proof.sourceRoleUrl === "string" &&
    proof.sourceRoleUrl !== parentRoleUrl
  ) {
    errors.push("source-role-url-parent-mismatch");
  }
  if (
    typeof parentVisitedPath === "string" &&
    typeof proof.visitedRolePath === "string" &&
    proof.visitedRolePath !== parentVisitedPath
  ) {
    errors.push("visited-role-path-parent-mismatch");
  }
  return {
    path,
    status: errors.length === 0 ? "passed" : "failed",
    errors,
    sourceRoleUrl: proof.sourceRoleUrl,
    visitedRolePath: proof.visitedRolePath,
    parentRoleUrl,
    parentVisitedPath,
    commandKind: proof.commandKind,
    clickedAction: proof.clickedAction,
  };
}

function isPassedCommandProof(value) {
  return (
    value.status === "passed" &&
    (Object.prototype.hasOwnProperty.call(value, "commandKind") ||
      Object.prototype.hasOwnProperty.call(value, "clickedAction"))
  );
}
