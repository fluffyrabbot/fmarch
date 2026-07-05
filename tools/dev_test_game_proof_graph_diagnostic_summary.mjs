export const proofGraphDiagnosticProofSummaryId = "diagnostic-non-terminal";

export function buildProofGraphDiagnosticProofSummary({ nodes } = {}) {
  const rows = (Array.isArray(nodes) ? nodes : [])
    .filter((node) => node?.diagnostic === true)
    .map((node) =>
      Object.freeze({
        id: String(node.id ?? ""),
        label: String(node.label ?? node.id ?? ""),
        status: String(node.status ?? "recorded"),
        artifact: String(node.artifact ?? ""),
        roleUrl: String(node.roleUrl ?? ""),
        proofCommand: String(node.proofCommand ?? ""),
        recoveryCommand: String(node.recoveryCommand ?? ""),
        diagnosticReason: String(node.diagnosticReason ?? ""),
        promotesFreshness: node.promotesFreshness === true,
        terminalArtifact: node.terminalArtifact === true,
      }),
    );
  return Object.freeze({
    id: proofGraphDiagnosticProofSummaryId,
    label: "Diagnostic non-terminal proofs",
    status: proofGraphDiagnosticProofCountLabel(rows.length),
    diagnosticCount: rows.length,
    promotesFreshnessCount: rows.filter((row) => row.promotesFreshness).length,
    terminalArtifactCount: rows.filter((row) => row.terminalArtifact).length,
    rows: Object.freeze(rows),
  });
}

export function normalizeProofGraphDiagnosticProofSummary(
  summary,
  { nodes } = {},
) {
  if (summary === null || typeof summary !== "object") {
    return buildProofGraphDiagnosticProofSummary({ nodes });
  }
  const rows = Array.isArray(summary.rows)
    ? summary.rows.map((row) =>
        Object.freeze({
          id: String(row?.id ?? ""),
          label: String(row?.label ?? row?.id ?? ""),
          status: String(row?.status ?? "recorded"),
          artifact: String(row?.artifact ?? ""),
          roleUrl: String(row?.roleUrl ?? ""),
          proofCommand: String(row?.proofCommand ?? ""),
          recoveryCommand: String(row?.recoveryCommand ?? ""),
          diagnosticReason: String(row?.diagnosticReason ?? ""),
          promotesFreshness: row?.promotesFreshness === true,
          terminalArtifact: row?.terminalArtifact === true,
        }),
      )
    : buildProofGraphDiagnosticProofSummary({ nodes }).rows;
  return Object.freeze({
    id: String(summary.id ?? proofGraphDiagnosticProofSummaryId),
    label: String(summary.label ?? "Diagnostic non-terminal proofs"),
    status: String(summary.status ?? proofGraphDiagnosticProofCountLabel(rows.length)),
    diagnosticCount: Number(summary.diagnosticCount ?? rows.length),
    promotesFreshnessCount: Number(
      summary.promotesFreshnessCount ??
        rows.filter((row) => row.promotesFreshness).length,
    ),
    terminalArtifactCount: Number(
      summary.terminalArtifactCount ??
        rows.filter((row) => row.terminalArtifact).length,
    ),
    rows: Object.freeze(rows),
  });
}

export function assertProofGraphDiagnosticProofSummary(summary, { nodes } = {}) {
  const actual = normalizeProofGraphDiagnosticProofSummary(summary, { nodes });
  const expected = buildProofGraphDiagnosticProofSummary({ nodes });
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("proof graph diagnostic proof summary drifted");
  }
  if (actual.promotesFreshnessCount !== 0 || actual.terminalArtifactCount !== 0) {
    throw new Error(
      "proof graph diagnostic proof summary promoted a terminal or freshness artifact",
    );
  }
  return actual;
}

function proofGraphDiagnosticProofCountLabel(count) {
  return `${count} diagnostic non-terminal ${count === 1 ? "proof" : "proofs"}`;
}
