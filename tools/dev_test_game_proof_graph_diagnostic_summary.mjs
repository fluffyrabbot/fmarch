export const proofGraphDiagnosticProofSummaryId = "diagnostic-non-terminal";
export const proofGraphDiagnosticSummaryTraceStrategy =
  "proof-graph-diagnostics-before-readiness";
export const proofGraphDiagnosticSummaryCheckId =
  "proof-graph-diagnostic-summary";

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

export function buildProofGraphDiagnosticSummaryTrace(
  proofGraph,
  { source = "" } = {},
) {
  if (proofGraph === null || proofGraph === undefined) {
    return unavailableProofGraphDiagnosticSummaryTrace();
  }
  const summary = normalizeProofGraphDiagnosticProofSummary(
    proofGraph.summary?.diagnosticProofSummary,
    { nodes: proofGraph.nodes },
  );
  return normalizeProofGraphDiagnosticSummaryTrace({
    strategy: proofGraphDiagnosticSummaryTraceStrategy,
    status: summary.diagnosticCount === 0 ? "empty" : "recorded",
    source,
    diagnosticCount: summary.diagnosticCount,
    promotesFreshnessCount: summary.promotesFreshnessCount,
    terminalArtifactCount: summary.terminalArtifactCount,
    selected: false,
    rows: summary.rows,
  });
}

export function normalizeProofGraphDiagnosticSummaryTrace(trace) {
  if (
    trace === null ||
    typeof trace !== "object" ||
    trace.strategy !== proofGraphDiagnosticSummaryTraceStrategy
  ) {
    return unavailableProofGraphDiagnosticSummaryTrace();
  }
  const rows = Array.isArray(trace.rows)
    ? trace.rows.map((row) => normalizeProofGraphDiagnosticSummaryTraceRow(row))
    : [];
  return Object.freeze({
    strategy: proofGraphDiagnosticSummaryTraceStrategy,
    status: String(trace.status ?? "unavailable"),
    source: String(trace.source ?? ""),
    diagnosticCount: Number(trace.diagnosticCount ?? rows.length),
    promotesFreshnessCount: Number(trace.promotesFreshnessCount ?? 0),
    terminalArtifactCount: Number(trace.terminalArtifactCount ?? 0),
    selected: trace.selected === true,
    rows: Object.freeze(rows),
  });
}

export function assertProofGraphDiagnosticSummaryTrace(
  trace,
  { label = "proof graph diagnostic summary trace" } = {},
) {
  if (
    trace === null ||
    typeof trace !== "object" ||
    trace.strategy !== proofGraphDiagnosticSummaryTraceStrategy
  ) {
    throw new Error(`${label} is missing or malformed`);
  }
  const normalized = normalizeProofGraphDiagnosticSummaryTrace(trace);
  if (
    !["recorded", "empty", "unavailable"].includes(normalized.status) ||
    normalized.selected !== false ||
    !Number.isInteger(normalized.diagnosticCount) ||
    !Number.isInteger(normalized.promotesFreshnessCount) ||
    !Number.isInteger(normalized.terminalArtifactCount) ||
    normalized.diagnosticCount !== normalized.rows.length
  ) {
    throw new Error(`${label} is missing or malformed`);
  }
  if (
    normalized.promotesFreshnessCount !== 0 ||
    normalized.terminalArtifactCount !== 0
  ) {
    throw new Error(`${label} promoted a terminal or freshness artifact`);
  }
  for (const row of normalized.rows) {
    if (
      row.id === "" ||
      row.diagnosticReason === "" ||
      row.artifact === "" ||
      row.proofCommand === "" ||
      row.recoveryCommand === "" ||
      row.promotesFreshness !== false ||
      row.terminalArtifact !== false
    ) {
      throw new Error(`${label} row is malformed: ${row.id}`);
    }
  }
  return normalized;
}

export function proofGraphDiagnosticSummaryCheckIds(trace) {
  const normalized = normalizeProofGraphDiagnosticSummaryTrace(trace);
  return normalized.status === "unavailable"
    ? Object.freeze([])
    : Object.freeze([
        proofGraphDiagnosticSummaryCheckId,
        ...normalized.rows.map((row) => `proof-graph-diagnostic-${row.id}`),
      ]);
}

export function assertProofGraphDiagnosticSummaryVisibleChecks(
  trace,
  visibleChecks,
  { label = "proof graph diagnostic summary" } = {},
) {
  const normalized = assertProofGraphDiagnosticSummaryTrace(trace, { label });
  const checks = Array.isArray(visibleChecks) ? visibleChecks : [];
  for (const checkId of proofGraphDiagnosticSummaryCheckIds(normalized)) {
    if (!checks.includes(checkId)) {
      throw new Error(`${label} missing visible check: ${checkId}`);
    }
  }
  return normalized;
}

function unavailableProofGraphDiagnosticSummaryTrace() {
  return Object.freeze({
    strategy: proofGraphDiagnosticSummaryTraceStrategy,
    status: "unavailable",
    source: "",
    diagnosticCount: 0,
    promotesFreshnessCount: 0,
    terminalArtifactCount: 0,
    selected: false,
    rows: Object.freeze([]),
  });
}

function normalizeProofGraphDiagnosticSummaryTraceRow(row) {
  return Object.freeze({
    id: String(row?.id ?? ""),
    status: String(row?.status ?? "unknown"),
    artifact: String(row?.artifact ?? ""),
    diagnosticReason: String(row?.diagnosticReason ?? ""),
    proofCommand: String(row?.proofCommand ?? ""),
    recoveryCommand: String(row?.recoveryCommand ?? ""),
    promotesFreshness: row?.promotesFreshness === true,
    terminalArtifact: row?.terminalArtifact === true,
  });
}

function proofGraphDiagnosticProofCountLabel(count) {
  return `${count} diagnostic non-terminal ${count === 1 ? "proof" : "proofs"}`;
}
