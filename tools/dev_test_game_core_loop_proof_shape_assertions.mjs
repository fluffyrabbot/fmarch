const roleUrlKeys = Object.freeze(["sourceRoleUrl"]);
const visitedPathKeys = Object.freeze(["visitedRolePath"]);

export const coreLoopCommandProofRoleUrlAuditExpectation = Object.freeze({
  status: "passed",
  checkedCount: 36,
});

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

export function buildCoreLoopCommandProofRoleUrlAudit(proof) {
  const rows = assertCoreLoopCommandProofRoleUrls({ proof });
  return {
    status: "passed",
    checkedCount: rows.length,
  };
}

export function assertCoreLoopCommandProofRoleUrlAudit({
  proof,
  audit,
  includeEvidenceInError = false,
}) {
  const expectedAudit = buildCoreLoopCommandProofRoleUrlAudit(proof);
  if (
    audit?.status !== expectedAudit.status ||
    audit?.checkedCount !== expectedAudit.checkedCount
  ) {
    const message = `core-loop command proof role URL audit summary drifted: expected ${expectedAudit.checkedCount}, got ${audit?.checkedCount}`;
    if (includeEvidenceInError) {
      throw new Error(`${message}: ${JSON.stringify({ audit, expectedAudit })}`);
    }
    throw new Error(message);
  }
  return expectedAudit;
}

export function assertCoreLoopCommandProofRoleUrlAuditExpectation({
  audit,
  includeEvidenceInError = false,
}) {
  if (
    audit?.status !== coreLoopCommandProofRoleUrlAuditExpectation.status ||
    audit?.checkedCount !==
      coreLoopCommandProofRoleUrlAuditExpectation.checkedCount
  ) {
    const message = `core-loop command proof role URL audit expectation drifted: expected ${coreLoopCommandProofRoleUrlAuditExpectation.checkedCount}, got ${audit?.checkedCount}`;
    if (includeEvidenceInError) {
      throw new Error(
        `${message}: ${JSON.stringify({
          audit,
          expected: coreLoopCommandProofRoleUrlAuditExpectation,
        })}`,
      );
    }
    throw new Error(message);
  }
  return coreLoopCommandProofRoleUrlAuditExpectation;
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
